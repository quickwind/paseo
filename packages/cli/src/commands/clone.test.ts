import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCloneCommand } from "./clone.js";

const cloneForgeProject = vi.fn();
const cloneGithubProject = vi.fn();
const close = vi.fn(async () => {});
let features: Record<string, boolean> = {};

vi.mock("../utils/client.js", () => ({
  connectToDaemon: vi.fn(async () => ({
    getLastServerInfoMessage: () => ({ features }),
    cloneForgeProject,
    cloneGithubProject,
    close,
  })),
}));

const BASE_OPTIONS = {
  daemonTarget: { kind: "endpoint", host: "example.test:12345" },
  dir: "~/workspace",
} as const;

describe("runCloneCommand (internal edition)", () => {
  beforeEach(() => {
    features = { forgeRepositories: true };
    cloneForgeProject.mockReset();
    cloneGithubProject.mockReset();
  });

  it("clones group/project shorthand through the forge RPC without requiring --protocol", async () => {
    cloneForgeProject.mockResolvedValue({
      requestId: "r",
      repo: "payments/core/billing",
      checkoutPath: "/home/dev/workspace/billing",
      project: { projectId: "prj_1", projectDisplayName: "billing" },
      error: null,
    });

    const result = await runCloneCommand("payments/core/billing", { ...BASE_OPTIONS }, {} as never);

    expect(cloneForgeProject).toHaveBeenCalledWith({
      repo: "payments/core/billing",
      targetDirectory: "~/workspace",
    });
    expect(cloneGithubProject).not.toHaveBeenCalled();
    expect(result.data).toEqual({
      repo: "payments/core/billing",
      checkoutPath: "/home/dev/workspace/billing",
      projectId: "prj_1",
      projectName: "billing",
    });
  });

  it("passes an explicit --protocol through", async () => {
    cloneForgeProject.mockResolvedValue({
      requestId: "r",
      repo: "a/b",
      checkoutPath: "/x/b",
      project: { projectId: "prj_1", projectDisplayName: "b" },
      error: null,
    });

    await runCloneCommand("a/b", { ...BASE_OPTIONS, protocol: "https" }, {} as never);

    expect(cloneForgeProject).toHaveBeenCalledWith({
      repo: "a/b",
      targetDirectory: "~/workspace",
      cloneProtocol: "https",
    });
  });

  it("explains how to configure GitLab when the daemon has no forge", async () => {
    features = {};

    await expect(runCloneCommand("a/b", { ...BASE_OPTIONS }, {} as never)).rejects.toMatchObject({
      code: "UNSUPPORTED_BY_HOST",
      message: "This daemon has no GitLab configured for cloning.",
    });
    expect(cloneForgeProject).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("reports the daemon's clone error", async () => {
    cloneForgeProject.mockResolvedValue({
      requestId: "r",
      repo: "https://github.com/a/b.git",
      checkoutPath: null,
      project: null,
      error: "Only repositories on git.corp.example can be cloned",
    });

    await expect(
      runCloneCommand("https://github.com/a/b.git", { ...BASE_OPTIONS }, {} as never),
    ).rejects.toMatchObject({
      code: "CLONE_FAILED",
      message:
        "Failed to clone GitLab project: Only repositories on git.corp.example can be cloned",
    });
  });

  it("requires --dir", async () => {
    await expect(
      runCloneCommand("a/b", { daemonTarget: BASE_OPTIONS.daemonTarget }, {} as never),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});
