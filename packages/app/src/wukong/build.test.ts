import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  return import("./build");
}

describe("upstreamOnly", () => {
  const Component = () => "shown";

  it("returns the upstream component in an upstream build", async () => {
    const { upstreamOnly } = await load();
    expect(upstreamOnly(Component)).toBe(Component);
  });

  it("swaps in a component that renders nothing in a Wukong build", async () => {
    vi.stubEnv("EXPO_PUBLIC_WUKONG", "1");
    const { upstreamOnly } = await load();
    const Hidden = upstreamOnly(Component);
    expect(Hidden).not.toBe(Component);
    expect((Hidden as () => unknown)()).toBeNull();
  });
});
