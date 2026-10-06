import { homedir } from "node:os";
import type { ForgeRepositorySummary, ForgeService } from "./forge-service.js";
import {
  resolveGitLabCloneTarget,
  type GitLabCloneProtocol,
  type GitLabForgeConfig,
} from "./gitlab-forge-config.js";
import { createGitLabService } from "./gitlab-service.js";

export interface ForgeCloneTarget {
  /** Directory name of the checkout. */
  name: string;
  /** Repository path shown to the user. */
  displayName: string;
  cloneUrl: string;
}

/**
 * Host-level repository catalog behind Add Project: search what the user can
 * clone and turn what they typed into a clone URL. It is not tied to a
 * checkout, so it runs from the home directory.
 */
export interface ForgeRepositoryCatalog {
  forge: string;
  searchRepositories(input: { query: string; limit?: number }): Promise<ForgeRepositorySummary[]>;
  resolveCloneTarget(input: {
    repo: string;
    cloneProtocol?: GitLabCloneProtocol;
  }): ForgeCloneTarget;
}

/** Internal edition: the configured GitLab is the only repository catalog. */
export function createGitLabRepositoryCatalog(options: {
  config: GitLabForgeConfig;
  service?: ForgeService;
}): ForgeRepositoryCatalog {
  const service = options.service ?? createGitLabService({ config: options.config });
  return {
    forge: "gitlab",
    async searchRepositories(input) {
      if (!service.searchRepositories) {
        throw new Error("GitLab repository search is unavailable");
      }
      return service.searchRepositories({ cwd: homedir(), ...input });
    },
    resolveCloneTarget: (input) => resolveGitLabCloneTarget(options.config, input),
  };
}
