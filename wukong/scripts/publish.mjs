// Internal edition: publishes the seven npm packages as tarballs, in dependency order.
// The release workflow packs them first (so the web UI is built once), then calls this.
//
// Usage: node scripts/publish-internal-edition.mjs --dir <tarball dir> --scope <scope>
//          [--registry <url>] [--access public|restricted] [--tag latest] [--dry-run]
//
// A package whose exact version already exists on the registry is skipped, so re-running
// a half-finished release publishes only what is missing instead of failing on a 403.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// Dependency order: a package is published after everything it depends on.
const PACKAGE_ORDER = ["highlight", "relay", "protocol", "client", "plugin", "server", "cli"];

function parseArgs(argv) {
  const args = {
    dir: "",
    scope: "",
    registry: "",
    access: "restricted",
    tag: "latest",
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      return argv[index] ?? "";
    };
    if (arg === "--dir") args.dir = next();
    else if (arg === "--scope") args.scope = next().replace(/^@/u, "");
    else if (arg === "--registry") args.registry = next();
    else if (arg === "--access") args.access = next();
    else if (arg === "--tag") args.tag = next();
    else if (arg === "--dry-run") args.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.dir || !existsSync(args.dir)) throw new Error("--dir must be an existing directory");
  // npm reads `dir/file.tgz` as a GitHub `owner/repo` shorthand; only an absolute path is a file.
  args.dir = path.resolve(args.dir);
  if (!args.scope) throw new Error("--scope is required");
  if (args.scope === "getpaseo") throw new Error("Refusing to publish under the upstream scope");
  if (!["public", "restricted"].includes(args.access)) {
    throw new Error("--access must be public or restricted");
  }
  return args;
}

function findTarball(dir, scope, name) {
  const matches = readdirSync(dir).filter((file) =>
    new RegExp(`^${scope}-${name}-\\d.*\\.tgz$`, "u").test(file),
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one ${scope}-${name}-*.tgz in ${dir}, found ${matches.length}`);
  }
  return path.join(dir, matches[0]);
}

function registryArgs(registry) {
  return registry ? [`--registry=${registry}`] : [];
}

function readManifest(tarball) {
  const json = execFileSync("tar", ["-xzOf", tarball, "package/package.json"], {
    maxBuffer: 16 * 1024 * 1024,
  }).toString("utf8");
  const manifest = JSON.parse(json);
  return { name: manifest.name, version: manifest.version };
}

function alreadyPublished({ name, version }, registry) {
  const result = spawnSync(
    "npm",
    ["view", `${name}@${version}`, "version", ...registryArgs(registry)],
    {
      encoding: "utf8",
    },
  );
  return result.status === 0 && result.stdout.trim() === version;
}

const args = parseArgs(process.argv.slice(2));
const published = [];
const skipped = [];

for (const name of PACKAGE_ORDER) {
  const tarball = findTarball(args.dir, args.scope, name);
  const manifest = readManifest(tarball);
  if (!manifest.name.startsWith(`@${args.scope}/`)) {
    throw new Error(`${tarball} is ${manifest.name}, expected scope @${args.scope}`);
  }
  if (alreadyPublished(manifest, args.registry)) {
    process.stdout.write(`skip    ${manifest.name}@${manifest.version} (already published)\n`);
    skipped.push(manifest.name);
    continue;
  }
  const publishArgs = [
    "publish",
    tarball,
    `--access=${args.access}`,
    `--tag=${args.tag}`,
    ...registryArgs(args.registry),
    ...(args.dryRun ? ["--dry-run"] : []),
  ];
  process.stdout.write(
    `publish ${manifest.name}@${manifest.version}${args.dryRun ? " (dry run)" : ""}\n`,
  );
  const result = spawnSync("npm", publishArgs, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(
      `npm publish failed for ${manifest.name}@${manifest.version} (exit ${result.status}). ` +
        `Published so far: ${published.join(", ") || "none"}. Re-run to publish the rest.`,
    );
  }
  published.push(manifest.name);
}

process.stdout.write(
  `Done: ${published.length} published, ${skipped.length} skipped${args.dryRun ? " (dry run)" : ""}.\n`,
);
