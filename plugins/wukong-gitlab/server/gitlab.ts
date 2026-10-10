import { execFile } from "node:child_process";
import { z } from "zod";
import type { GitLabProject } from "../shared/rpc.js";
import type { GitLabSettings } from "./config.js";

const TIMEOUT_MS = 30_000;

const ProjectRowSchema = z
  .object({
    path_with_namespace: z.string(),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    web_url: z.string().nullable().optional(),
    last_activity_at: z.string().nullable().optional(),
  })
  .passthrough();

/** A leading `@` makes python-gitlab read the value from a file; doubling it escapes that. */
function cliValue(value: string): string {
  return value.startsWith("@") ? `@${value}` : value;
}

function option(name: string, value: string | number | boolean): string {
  return `--${name}=${cliValue(String(value))}`;
}

function run(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(
            new Error(
              `\`${file}\` not found; install python-gitlab: uv tool install python-gitlab`,
            ),
          );
          return;
        }
        reject(new Error(stderr.trim() || error.message));
      },
    );
  });
}

export async function searchProjects(
  settings: GitLabSettings,
  query: string,
  limit: number,
): Promise<GitLabProject[]> {
  const [file = "gitlab", ...prefix] = settings.command;
  const trimmed = query.trim();
  const stdout = await run(file, [
    ...prefix,
    "--output=json",
    "--skip-login",
    `--server-url=${settings.url}`,
    ...(settings.configSection ? [`--gitlab=${settings.configSection}`] : []),
    "project",
    "list",
    option("membership", true),
    option("simple", true),
    option("order-by", "last_activity_at"),
    option("sort", "desc"),
    option("per-page", limit),
    "--no-get-all",
    ...(trimmed ? [option("search", trimmed)] : []),
  ]);
  return z
    .array(ProjectRowSchema)
    .parse(JSON.parse(stdout))
    .map((row) => ({
      path: row.path_with_namespace,
      name: row.name ?? row.path_with_namespace.split("/").at(-1) ?? row.path_with_namespace,
      description: row.description ?? null,
      webUrl: row.web_url ?? null,
      lastActivityAt: row.last_activity_at ?? null,
    }));
}

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/u;

/** `group/sub/project`, each segment a plain name: no `..`, no leading dash, no empty parts. */
export function assertProjectPath(path: string): void {
  const segments = path.split("/");
  if (
    segments.length < 2 ||
    !segments.every((segment) => SEGMENT.test(segment) && segment !== "..")
  ) {
    throw new Error("Project path must look like group/project");
  }
}

export function cloneUrl(settings: GitLabSettings, path: string): string {
  assertProjectPath(path);
  if (!settings.sshHost) {
    return `${settings.url}/${path}.git`;
  }
  const [host = "", port] = settings.sshHost.split(":");
  return port ? `ssh://git@${host}:${port}/${path}.git` : `git@${host}:${path}.git`;
}

export async function gitClone(url: string, directory: string): Promise<void> {
  await run("git", ["clone", "--", url, directory], { GIT_TERMINAL_PROMPT: "0" });
}

export async function remoteOf(directory: string): Promise<string | null> {
  try {
    return (await run("git", ["-C", directory, "remote", "get-url", "origin"])).trim();
  } catch {
    return null;
  }
}
