// Internal edition policy. This fork runs only on company machines: no device
// pairing, no Paseo-initiated traffic to cloud services, and a fixed provider
// allowlist. Every package reads its restrictions from here so the fork's
// deviations from upstream stay in one place. See docs/internal-edition.md.

export const INTERNAL_EDITION_ALLOWED_PROVIDER_IDS: readonly string[] = ["claude", "devin"];

/**
 * Git forges that exist. Only the company's self-hosted GitLab, whose location
 * comes from the daemon's `forge.gitlab` config; every other host is "no forge".
 */
export const INTERNAL_EDITION_ALLOWED_FORGE_IDS: readonly string[] = ["gitlab"];

export const INTERNAL_EDITION = {
  /** QR/link pairing, the relay, and the Hub are unavailable. */
  pairingEnabled: false,
  /** Paseo never contacts cloud services (relay, Hub, push, updates, registries, OpenAI speech). */
  cloudServicesEnabled: false,
  /** Only the allowlisted built-in providers exist; users cannot add ACP or derived providers. */
  customProvidersEnabled: false,
  /** The daemon refuses to listen on anything but loopback or a Unix socket. */
  loopbackOnly: true,
  /** Add Project clones from the internal GitLab through the forge RPCs, not from GitHub. */
  forgeRepositoryClone: true,
} as const;

export function isProviderAllowedByEdition(providerId: string): boolean {
  return INTERNAL_EDITION_ALLOWED_PROVIDER_IDS.includes(providerId);
}

export function isForgeAllowedByEdition(forgeId: string): boolean {
  return INTERNAL_EDITION_ALLOWED_FORGE_IDS.includes(forgeId);
}

export class CloudServiceDisabledError extends Error {
  constructor(service: string) {
    super(`${service} is disabled in this internal edition of Wukong`);
    this.name = "CloudServiceDisabledError";
  }
}

/**
 * Internal edition brand. User-visible names and links read from here; code identifiers,
 * env vars (`PASEO_*`), `~/.paseo`, and protocol names keep the upstream name.
 */
export const INTERNAL_EDITION_BRAND = {
  name: "Wukong",
  cliName: "wukong",
  repositoryUrl: "https://github.com/quickwind/wukong",
  issuesUrl: "https://github.com/quickwind/wukong/issues/new",
  upstream: {
    name: "Paseo",
    url: "https://github.com/getpaseo/paseo",
    license: "Apache-2.0",
  },
} as const;
