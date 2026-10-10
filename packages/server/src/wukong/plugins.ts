// Wukong edition: plugins load from local directories only. Installing from npm, Git, or a
// plugin registry runs child processes the egress guard cannot see, so managed sources are
// switched off. Of the bundled plugins only Wukong's own starts; the rest (extra providers,
// vendor usage readers) do not.

import { BuiltinPluginLoader } from "../server/plugins/builtin/index.js";
import type { ManagedPluginSources } from "../server/plugins/managed-source.js";
import { isWukongActive } from "./policy.js";

export function wukongManagedSources(
  sources: ManagedPluginSources | undefined,
): ManagedPluginSources | undefined {
  return isWukongActive() ? undefined : sources;
}

export const WUKONG_BUILTIN_PLUGINS: readonly string[] = ["wukong-gitlab"];

export function wukongBuiltinPlugins(
  loader: BuiltinPluginLoader | undefined,
): BuiltinPluginLoader | undefined {
  return isWukongActive() ? new BuiltinPluginLoader(undefined, WUKONG_BUILTIN_PLUGINS) : loader;
}
