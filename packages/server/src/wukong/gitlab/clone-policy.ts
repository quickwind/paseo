import { parseGitRemoteLocation } from "@getpaseo/protocol/git-remote";

import { isWukongActive } from "../policy.js";
import { defaultConfig } from "./adapter.js";
import { matchesGitLabForgeHost, type GitLabForgeConfig } from "./config.js";

/**
 * Wukong clones only from the company GitLab. The daemon's clone request runs `git clone` in a
 * child process the egress guard cannot see, and accepts any remote URL, so the host is checked
 * here.
 */
export function assertCloneAllowed(
  cloneUrl: string,
  getConfig: () => GitLabForgeConfig | null = defaultConfig,
): void {
  if (!isWukongActive()) {
    return;
  }
  const config = getConfig();
  const host = parseGitRemoteLocation(cloneUrl)?.host;
  if (!config) {
    throw new Error(
      'GitLab is not configured. Set "gitlab.url" in wukong.json in the Paseo home, or WUKONG_GITLAB_URL.',
    );
  }
  if (!host || !matchesGitLabForgeHost(config, host)) {
    throw new Error(
      `Wukong only clones from ${new URL(config.url).host}. Use "Add project from GitLab".`,
    );
  }
}
