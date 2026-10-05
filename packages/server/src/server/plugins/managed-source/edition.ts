import { isAbsolute } from "node:path";

import { CloudServiceDisabledError, INTERNAL_EDITION } from "@getpaseo/protocol/internal-edition";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A local path, a file: URL, or a loopback URL never leaves this machine. */
function isLocalLocation(location: string): boolean {
  if (isAbsolute(location) || location.startsWith("./") || location.startsWith("../")) {
    return true;
  }
  try {
    const url = new URL(location);
    return url.protocol === "file:" || LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Internal edition: plugins install from this machine only. npm always resolves through a
 * configured registry, so it is refused outright; Git and plugin registries are refused
 * unless the location is local.
 */
export function assertPluginSourceLocal(
  input: { kind: "npm" } | { kind: "git" | "registry"; location: string },
): void {
  if (INTERNAL_EDITION.cloudServicesEnabled) {
    return;
  }
  if (input.kind !== "npm" && isLocalLocation(input.location)) {
    return;
  }
  throw new CloudServiceDisabledError(
    `Installing plugins from ${input.kind === "npm" ? "npm" : `a remote ${input.kind}`}`,
  );
}
