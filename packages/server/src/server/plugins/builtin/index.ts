import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { INTERNAL_EDITION } from "@getpaseo/protocol/internal-edition";

const UPSTREAM_BUILTIN_PLUGINS = [
  "antigravity-provider",
  "claude-usage-source",
  "codex-usage-source",
  "copilot-usage-source",
  "cursor-usage-source",
  "grok-usage-source",
  "kimi-usage-source",
  "minimax-usage-source",
  "muse-provider",
  "opencode-go-usage-source",
  "zai-usage-source",
] as const;

// Internal edition: every bundled plugin is either a provider outside the allowlist or a
// usage source that calls a vendor API, so none start.
export const builtinPlugins: readonly string[] = INTERNAL_EDITION.cloudServicesEnabled
  ? UPSTREAM_BUILTIN_PLUGINS
  : [];

export function resolveBuiltinPluginsRoot(moduleUrl: string | URL = import.meta.url): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const archiveSegment = `${path.sep}app.asar${path.sep}`;
  const archiveIndex = moduleDir.indexOf(archiveSegment);
  if (archiveIndex !== -1) {
    // esbuild runs outside Electron's filesystem shim and cannot read archive entries.
    return path.join(moduleDir.slice(0, archiveIndex), "builtin-plugins");
  }
  const candidates = [
    path.resolve(moduleDir, "..", "..", "..", "builtin-plugins"),
    path.resolve(moduleDir, "..", "..", "..", "..", "..", "..", "plugins"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

export interface BuiltinPlugin {
  id: string;
  directory: string;
}

export class BuiltinPluginLoader {
  readonly ids: ReadonlySet<string>;

  constructor(
    private readonly root = resolveBuiltinPluginsRoot(),
    private readonly list: readonly string[] = builtinPlugins,
  ) {
    this.ids = new Set(list);
  }

  async load(start: (plugin: BuiltinPlugin) => Promise<void>): Promise<void> {
    for (const id of this.list) {
      await start({ id, directory: path.join(this.root, id) });
    }
  }
}
