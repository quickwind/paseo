// Wukong edition: Claude Code and Devin CLI are the only agent providers. Devin ships as a
// configured ACP provider, not a built-in, so upstream's provider code stays untouched.

import type { ProviderOverride } from "../server/agent/provider-launch-config.js";

// Off until the daemon starts (see edition.ts), so upstream tests keep seeing every provider.
let active = false;

/** Turns the provider policy on; returns a function that turns it off again. */
export function activateWukongProviders(): () => void {
  active = true;
  return () => {
    active = false;
  };
}

export const WUKONG_PROVIDER_IDS: readonly string[] = ["claude", "devin"];

const DEFAULT_OVERRIDES: Record<string, ProviderOverride> = {
  devin: {
    extends: "acp",
    label: "Devin CLI",
    description: "Cognition's Devin for Terminal via Agent Client Protocol",
    command: ["devin", "acp"],
  },
};

/** Adds the Wukong providers; anything the user configured for them wins over the default. */
export function withWukongProviderOverrides(
  overrides: Record<string, ProviderOverride>,
): Record<string, ProviderOverride> {
  if (!active) {
    return overrides;
  }
  const merged = { ...overrides };
  for (const [id, fallback] of Object.entries(DEFAULT_OVERRIDES)) {
    merged[id] = { ...fallback, ...overrides[id] };
  }
  return merged;
}

/** Drops every provider outside the allowlist. Dev builds keep their mock providers. */
export function restrictToWukongProviders<T extends Record<string, unknown>>(
  registry: T,
  options: { isDev: boolean; devProviderIds: ReadonlySet<string> },
): T {
  if (!active) {
    return registry;
  }
  return Object.fromEntries(
    Object.entries(registry).filter(
      ([id]) =>
        WUKONG_PROVIDER_IDS.includes(id) || (options.isDev && options.devProviderIds.has(id)),
    ),
  ) as T;
}
