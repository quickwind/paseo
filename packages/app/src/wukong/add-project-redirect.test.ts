import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveGitLabProjectRoute } from "./add-project-redirect";

describe("resolveGitLabProjectRoute", () => {
  const route = "/h/srv-1/plugin/wukong-gitlab/surface/add-from-gitlab";

  it("prefers the host the request names, then the local daemon, then the first host", () => {
    expect(
      resolveGitLabProjectRoute({ preferredHostId: "srv-1", localServerId: "x", hostIds: ["y"] }),
    ).toBe(route);
    expect(resolveGitLabProjectRoute({ localServerId: "srv-1", hostIds: ["y"] })).toBe(route);
    expect(resolveGitLabProjectRoute({ localServerId: null, hostIds: ["srv-1", "y"] })).toBe(route);
  });

  it("has nowhere to go without a host", () => {
    expect(resolveGitLabProjectRoute({ localServerId: null, hostIds: [] })).toBeNull();
  });
});

describe("Wukong build flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function chatPresentation() {
    vi.resetModules();
    const { resolveComposerInputMode } = await import("@/composer/input-mode");
    return resolveComposerInputMode("chat");
  }

  it("keeps the voice button in upstream builds", async () => {
    expect((await chatPresentation()).showVoice).toBe(true);
  });

  it("removes the voice button in a Wukong build", async () => {
    vi.stubEnv("EXPO_PUBLIC_WUKONG", "1");
    expect((await chatPresentation()).showVoice).toBe(false);
  });
});
