import { isIP } from "node:net";

import { INTERNAL_EDITION } from "@getpaseo/protocol/internal-edition";

function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (normalized === "" || normalized === "localhost") {
    return true;
  }
  if (isIP(normalized) === 4) {
    return normalized.startsWith("127.");
  }
  if (isIP(normalized) === 6) {
    return normalized === "::1" || normalized.startsWith("::ffff:127.");
  }
  return false;
}

/**
 * Pipes, Unix sockets, bare ports, and loopback hosts stay on this machine. Anything
 * else would expose the daemon to the network, which the internal edition forbids.
 */
export function isLocalOnlyListen(listen: string): boolean {
  const trimmed = listen.trim();
  if (
    trimmed.startsWith("\\\\.\\pipe\\") ||
    trimmed.startsWith("pipe://") ||
    trimmed.startsWith("unix://") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("~") ||
    /^\d+$/.test(trimmed)
  ) {
    return true;
  }
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon === -1) {
    return false;
  }
  return isLoopbackHost(trimmed.slice(0, lastColon));
}

export function assertEditionListen(listen: string, setting: string): void {
  if (INTERNAL_EDITION.loopbackOnly && !isLocalOnlyListen(listen)) {
    throw new Error(
      `${setting} "${listen}" is not a loopback address. This internal edition of Paseo only listens on 127.0.0.1, ::1, localhost, or a local socket.`,
    );
  }
}
