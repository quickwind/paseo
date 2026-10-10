import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clone, search } from "./projects.js";

const GITLAB = "https://gitlab.test";
const paseo = { workspaces: { open: async () => ({ id: "ws-1" }) } } as never;

let work: string;
let remotes: string;
const saved = { ...process.env };

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "wukong-gitlab-"));
  remotes = join(work, "remotes");
  mkdirSync(join(remotes, "group"), { recursive: true });

  // A real repository served at the project's clone URL through git's own URL rewriting.
  const bare = join(remotes, "group", "app.git");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", bare]);
  const seed = join(work, "seed");
  execFileSync("git", ["clone", bare, seed], { stdio: "ignore" });
  writeFileSync(join(seed, "README.md"), "hi");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", seed, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      stdio: "ignore",
    });
  git("add", ".");
  git("commit", "-m", "init");
  git("push", "origin", "HEAD:main");

  process.env.PASEO_HOME = join(work, "home");
  process.env.WUKONG_GITLAB_URL = GITLAB;
  process.env.WUKONG_CLONE_ROOT = join(work, "clones");
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(remotes).href}/.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = `${GITLAB}/`;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, saved);
});

// The command goes in wukong.json as an array: the environment variable splits on spaces, which
// breaks on a Windows path such as C:\\Program Files\\nodejs\\node.exe.
function fakeGitLab(rows: unknown[]): void {
  const script = join(work, "fake-gitlab.mjs");
  writeFileSync(
    script,
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(join(work, "argv.json"))}, JSON.stringify(process.argv.slice(2)));
console.log(${JSON.stringify(JSON.stringify(rows))});`,
  );
  mkdirSync(process.env.PASEO_HOME ?? "", { recursive: true });
  writeFileSync(
    join(process.env.PASEO_HOME ?? "", "wukong.json"),
    JSON.stringify({ gitlab: { command: [process.execPath, script] } }),
  );
}

describe("search", () => {
  it("lists the user's projects through python-gitlab and reports the clone root", async () => {
    fakeGitLab([
      {
        path_with_namespace: "group/app",
        name: "app",
        description: "An app",
        web_url: `${GITLAB}/group/app`,
      },
    ]);
    process.env.WUKONG_GITLAB_SECTION = "corp";

    const result = await search({ query: "app" });

    expect(result.cloneRoot).toBe(join(work, "clones"));
    expect(result.projects).toEqual([
      {
        path: "group/app",
        name: "app",
        description: "An app",
        webUrl: `${GITLAB}/group/app`,
        lastActivityAt: null,
      },
    ]);
    const argv = JSON.parse(readFileSync(join(work, "argv.json"), "utf8")) as string[];
    expect(argv).toEqual(
      expect.arrayContaining([
        `--server-url=${GITLAB}`,
        "--gitlab=corp",
        "--skip-login",
        "project",
        "list",
        "--search=app",
        "--membership=true",
      ]),
    );
  });

  it("escapes a query that python-gitlab would read as a file", async () => {
    fakeGitLab([]);
    await search({ query: "@secret" });
    const argv = JSON.parse(readFileSync(join(work, "argv.json"), "utf8")) as string[];
    expect(argv).toContain("--search=@@secret");
  });

  it("explains how to configure GitLab when nothing is set", async () => {
    delete process.env.WUKONG_GITLAB_URL;
    await expect(search({ query: "" })).rejects.toThrow(/not configured/);
  });
});

describe("clone", () => {
  it("clones into the clone root and opens the directory", async () => {
    const result = await clone({ path: "group/app" }, { paseo });
    expect(result).toEqual({
      directory: join(work, "clones", "app"),
      workspaceId: "ws-1",
      alreadyCloned: false,
    });
    expect(existsSync(join(result.directory, "README.md"))).toBe(true);
  });

  it("reuses an existing clone of the same project", async () => {
    await clone({ path: "group/app" }, { paseo });
    expect((await clone({ path: "group/app" }, { paseo })).alreadyCloned).toBe(true);
  });

  it("never writes into an unrelated folder", async () => {
    const taken = join(work, "clones", "app");
    mkdirSync(taken, { recursive: true });
    writeFileSync(join(taken, "other.txt"), "x");
    await expect(clone({ path: "group/app" }, { paseo })).rejects.toThrow(/not a clone/);
  });

  it("rejects paths that could escape or inject options", async () => {
    for (const path of ["app", "../x/app", "group/..", "-oProxy=x/app", "group//app", "a/b c"]) {
      await expect(clone({ path }, { paseo })).rejects.toThrow(/group\/project/);
    }
  });

  it("requires an absolute clone folder", async () => {
    await expect(
      clone({ path: "group/app", parentDirectory: "relative/dir" }, { paseo }),
    ).rejects.toThrow(/absolute/);
  });
});
