import { basename } from "path";
import { createHash } from "node:crypto";
import { parseGitHubRemoteUrl, parseGitRemoteLocation } from "@getpaseo/protocol/git-remote";
import { slugify } from "../utils/worktree.js";

export function parseGitHubRepoFromRemote(remoteUrl: string): string | null {
  return parseGitHubRemoteUrl(remoteUrl)?.repo ?? null;
}

export function parseGitHubRepoNameFromRemote(remoteUrl: string): string | null {
  const githubRepo = parseGitHubRepoFromRemote(remoteUrl);
  if (!githubRepo) {
    return null;
  }

  return githubRepo.split("/").pop() || null;
}

/**
 * Internal edition: the last path segment of any parseable remote, so a GitLab
 * `group/sub/project` names its project `project`. Upstream derived the name
 * from GitHub remotes only.
 */
function parseRemoteRepoName(remoteUrl: string): string | null {
  const path = parseGitRemoteLocation(remoteUrl)?.path;
  return path?.split("/").pop() || null;
}

export function deriveProjectSlug(cwd: string, remoteUrl: string | null = null): string {
  const remoteName = remoteUrl ? parseRemoteRepoName(remoteUrl) : null;
  const sourceName = remoteName ?? basename(cwd);
  return slugify(sourceName) || "untitled";
}

export function deriveProjectServiceSlug(project: { projectId: string; rootPath: string }): string {
  const identity = createHash("sha256").update(project.projectId).digest("hex").slice(0, 8);
  return `${deriveProjectSlug(project.rootPath)}-${identity}`;
}
