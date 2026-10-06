import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMocks = vi.hoisted(() => ({ execCommand: vi.fn(), spawnProcess: vi.fn() }));
vi.mock("../utils/spawn.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/spawn.js")>()),
  execCommand: spawnMocks.execCommand,
  spawnProcess: spawnMocks.spawnProcess,
}));

import { CloudServiceDisabledError } from "@getpaseo/protocol/internal-edition";
import { createDisabledGitHubService, isDisabledForgeService } from "./github-service-disabled.js";
import { createGitHubService } from "./github-service.js";

describe("disabled GitHub service (internal edition)", () => {
  beforeEach(() => {
    spawnMocks.execCommand.mockReset();
    spawnMocks.spawnProcess.mockReset();
  });

  it("rejects every forge call with CloudServiceDisabledError and never spawns gh", async () => {
    const service = createDisabledGitHubService();
    const calls = [
      () => service.searchIssuesAndPrs({ cwd: "/repo", query: "x" }),
      () => service.searchRepositories({ cwd: "/repo", query: "x" }),
      () => service.getCurrentPullRequestStatus({ cwd: "/repo", headRef: "main" }),
      () => service.listPullRequests({ cwd: "/repo" }),
      () => service.getPullRequestCheckoutTarget({ cwd: "/repo", number: 1 }),
      () => service.isAuthenticated({ cwd: "/repo" }),
      () =>
        service.createPullRequest({ cwd: "/repo", repo: "a/b", title: "t", head: "h", base: "b" }),
      () => service.mergePullRequest({ cwd: "/repo", prNumber: 1, mergeMethod: "merge" }),
    ];

    for (const call of calls) {
      await expect(call()).rejects.toBeInstanceOf(CloudServiceDisabledError);
    }
    expect(spawnMocks.execCommand).not.toHaveBeenCalled();
    expect(spawnMocks.spawnProcess).not.toHaveBeenCalled();
  });

  it("keeps invalidate, dispose and poll retention as no-ops", () => {
    const service = createDisabledGitHubService();

    expect(() => service.invalidate({ cwd: "/repo" })).not.toThrow();
    expect(() => service.dispose?.()).not.toThrow();
    expect(service.retainCurrentPullRequestStatusPoll?.({ cwd: "/repo", headRef: "x" })).toEqual({
      unsubscribe: expect.any(Function),
    });
  });

  it("is recognizable, unlike the real service", () => {
    expect(isDisabledForgeService(createDisabledGitHubService())).toBe(true);
    expect(isDisabledForgeService(createGitHubService())).toBe(false);
    expect(isDisabledForgeService(null)).toBe(false);
  });

  it("reports optional synchronous members as absent", () => {
    const service = createDisabledGitHubService();

    expect(service.supportsCrossRepoCheckoutWithoutRefs).toBeUndefined();
    expect(service.defaultCheckoutRefs).toBeUndefined();
    expect(service.buildPrLocalBranchName).toBeUndefined();
    expect("defaultCheckoutRefs" in service).toBe(false);
  });

  it("is not mistaken for a thenable when awaited", async () => {
    await expect(Promise.resolve(createDisabledGitHubService())).resolves.toBeDefined();
  });
});
