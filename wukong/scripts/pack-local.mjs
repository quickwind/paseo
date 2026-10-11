// Builds the Wukong npm packages as tarballs the way the publish workflow does, without
// publishing anything. Runs on Windows, macOS and Linux.
//
// It works in a throwaway checkout of the last commit, so your working tree is left alone
// (commit first: uncommitted changes are not included).
//
// Usage: node wukong/scripts/pack-local.mjs --out <dir> [--scope wukong] [--work-dir <dir>] [--keep]
//   --out       where the .tgz files go (required); tarballs of an earlier build there are removed
//   --scope     npm scope, giving @<scope>/cli, @<scope>/server, ... (default: wukong)
//   --work-dir  where the throwaway checkout lives. Keep it short on Windows (default: a
//               short folder under the system temp directory)
//   --keep      leave the checkout in place afterwards (for debugging)

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = ["highlight", "relay", "protocol", "client", "plugin", "server", "cli"];
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

export function parseArgs(argv) {
  const args = { out: "", scope: "wukong", workDir: "", keep: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[index];
    };
    if (arg === "--out") args.out = next();
    else if (arg === "--scope") args.scope = next().replace(/^@/u, "");
    else if (arg === "--work-dir") args.workDir = next();
    else if (arg === "--keep") args.keep = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.out) throw new Error("--out is required");
  if (!SCOPE_PATTERN.test(args.scope)) {
    throw new Error("--scope must be a lowercase npm scope such as `wukong`");
  }
  if (args.scope === "getpaseo") throw new Error("Refusing to use the upstream @getpaseo scope");
  return args;
}

/** `0.11.2-beta.1` -> `0.11.2`: the upstream version without its prerelease. */
export function coreVersion(version) {
  return version.split("-")[0];
}

/** A build stamp that sorts in time order: 202610101530 (UTC). */
export function buildStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
  );
}

/** A tarball of this scope from an earlier build, such as `wukong-cli-0.11.2-wukong.1.tgz`. */
export function staleTarball(file, scope) {
  return file.startsWith(`${scope}-`) && file.endsWith(".tgz");
}

const isWindows = process.platform === "win32";

function quote(argument) {
  return /[\s"]/u.test(argument) ? `"${argument.replaceAll('"', '\\"')}"` : argument;
}

/** Runs a command, inheriting output. npm needs a shell on Windows because it is a .cmd file. */
function run(command, args, options = {}) {
  const useShell = isWindows && command === "npm";
  const result = useShell
    ? spawnSync([command, ...args].map(quote).join(" "), {
        stdio: "inherit",
        shell: true,
        ...options,
      })
    : spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}): ${command} ${args.join(" ")}`);
  }
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}): ${command} ${args.join(" ")}`);
  }
  return result.stdout.trim();
}

function removeTree(directory) {
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

export function main(argv) {
  const args = parseArgs(argv);
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const stamp = buildStamp();
  const work = path.resolve(args.workDir || path.join(tmpdir(), `wk-${stamp}`));
  const out = path.resolve(args.out);

  if (capture("git", ["status", "--porcelain"], { cwd: repo })) {
    process.stdout.write(
      "Note: the working tree has uncommitted changes. They are not included; only HEAD is.\n",
    );
  }
  if (existsSync(work)) throw new Error(`${work} already exists; pass another --work-dir`);

  // core.longpaths: node_modules nests deeply and Windows stops at 260 characters by default.
  run("git", ["-c", "core.longpaths=true", "worktree", "add", "--detach", work, "HEAD"], {
    cwd: repo,
  });

  try {
    const env = { ...process.env, EXPO_PUBLIC_WUKONG: "1", ONNXRUNTIME_NODE_INSTALL: "skip" };
    const node = process.execPath;
    const inWork = { cwd: work, env };

    run(node, ["wukong/scripts/rename-npm-scope.mjs", "--scope", args.scope], inWork);
    run(node, ["wukong/scripts/brand.mjs"], inWork);

    run(
      node,
      ["scripts/npm-retry.mjs", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      inWork,
    );
    run("npm", ["run", "postinstall"], inWork);

    const core = coreVersion(
      JSON.parse(
        capture(node, ["-p", "JSON.stringify(require('./package.json').version)"], inWork),
      ),
    );
    const version = `${core}-wukong.${stamp}`;
    run("npm", ["pkg", "set", `version=${version}`], inWork);
    run(node, ["scripts/sync-workspace-versions.mjs"], inWork);
    // The app is not published, and its Expo config only accepts x.y.z or x.y.z-beta.N.
    run("npm", ["pkg", "set", `version=${core}`, `--workspace=@${args.scope}/app`], inWork);

    // Apache-2.0 §4: every package ships upstream's LICENSE and a NOTICE.
    run(node, ["wukong/scripts/add-license.mjs"], inWork);

    const packed = path.join(work, "dist-npm");
    mkdirSync(packed, { recursive: true });
    for (const name of PACKAGES) {
      run(
        "npm",
        ["pack", `--workspace=@${args.scope}/${name}`, "--pack-destination", packed],
        inWork,
      );
    }

    mkdirSync(out, { recursive: true });
    // Tarballs of an earlier build in the same folder would be installed alongside the new ones.
    for (const file of readdirSync(out)) {
      if (staleTarball(file, args.scope)) rmSync(path.join(out, file), { force: true });
    }
    const tarballs = readdirSync(packed).filter((file) => file.endsWith(".tgz"));
    for (const file of tarballs) cpSync(path.join(packed, file), path.join(out, file));
    process.stdout.write(`\nPacked ${version}: ${tarballs.length} tarballs in ${out}\n`);
    for (const file of tarballs) process.stdout.write(`  ${file}\n`);
  } finally {
    if (args.keep) {
      process.stdout.write(`Kept the checkout at ${work}\n`);
    } else {
      removeTree(work);
      spawnSync("git", ["worktree", "prune"], { cwd: repo });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}
