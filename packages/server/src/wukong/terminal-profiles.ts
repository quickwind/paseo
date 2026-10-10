import { DEFAULT_TERMINAL_PROFILES } from "@getpaseo/protocol/terminal-profiles";
import type { TerminalProfile } from "@getpaseo/protocol/messages";

import { isWukongActive } from "./policy.js";

const WUKONG_TERMINAL_PROFILES: readonly TerminalProfile[] = DEFAULT_TERMINAL_PROFILES.filter(
  (profile) => profile.id === "claude",
);

/**
 * Wukong's terminal profiles are Claude Code alone, whatever the config file says. The app
 * falls back to upstream's defaults (Codex, OpenCode, Pi) only when none are configured, so
 * the daemon always supplies this list.
 */
export function wukongTerminalProfiles(
  configured: TerminalProfile[] | undefined,
): TerminalProfile[] | undefined {
  return isWukongActive() ? [...WUKONG_TERMINAL_PROFILES] : configured;
}
