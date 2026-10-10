// Wukong's own home and port, so it never shares them with a Paseo installed on the same machine.
// Run from bin/wukong before the CLI starts. An explicit PASEO_HOME, or --home on the command
// line, still wins.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const WUKONG_DEFAULT_PORT = 6899;

export function wukongDefaultHome(homeDirectory: string = os.homedir()): string {
  return path.join(homeDirectory, ".wukong");
}

function expandHome(input: string, homeDirectory: string): string {
  if (input === "~") return homeDirectory;
  return /^~[\\/]/u.test(input) ? path.join(homeDirectory, input.slice(2)) : input;
}

/** Points the CLI at ~/.wukong and gives a fresh home a config that listens on port 6899. */
export function applyWukongDefaults(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = os.homedir(),
): void {
  env.PASEO_HOME ||= wukongDefaultHome(homeDirectory);
  const home = path.resolve(expandHome(env.PASEO_HOME, homeDirectory));
  const config = path.join(home, "config.json");
  if (existsSync(config)) return;
  mkdirSync(home, { recursive: true });
  writeFileSync(
    config,
    `${JSON.stringify({ version: 1, daemon: { listen: `127.0.0.1:${WUKONG_DEFAULT_PORT}` } }, null, 2)}\n`,
  );
}
