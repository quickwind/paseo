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

describe("Wukong settings and Add Project", () => {
  const host = {
    serverId: "srv",
    label: "Mac",
    canAddProject: true,
    canBrowse: false,
    canCloneGithubRepositories: false,
    canSearchGithubRepositories: false,
    canCreateDirectory: true,
  } as never;

  it("offers every host section in an upstream build", async () => {
    const { isHostSectionOffered } = await load();
    expect(isHostSectionOffered("pair-device")).toBe(true);
    expect(isHostSectionOffered("usage")).toBe(true);
  });

  it("hides pairing but keeps usage and the rest in a Wukong build", async () => {
    vi.stubEnv("EXPO_PUBLIC_WUKONG", "1");
    const { isHostSectionOffered } = await load();
    expect(isHostSectionOffered("pair-device")).toBe(false);
    expect(isHostSectionOffered("usage")).toBe(true);
    for (const section of ["projects", "connections", "providers", "plugins"]) {
      expect(isHostSectionOffered(section)).toBe(true);
    }
  });

  it("turns the GitHub clone entry into a GitLab one that is always available", async () => {
    vi.stubEnv("EXPO_PUBLIC_WUKONG", "1");
    vi.resetModules();
    const { buildAddProjectMethods } = await import("@/add-project-flow/options");
    const entry = buildAddProjectMethods(host).find((method) => method.id === "github");
    expect(entry).toMatchObject({ label: "Clone from GitLab", disabled: false });
  });

  it("keeps the GitHub entry in an upstream build", async () => {
    vi.resetModules();
    const { buildAddProjectMethods } = await import("@/add-project-flow/options");
    const entry = buildAddProjectMethods(host).find((method) => method.id === "github");
    expect(entry?.label).toBe("Clone from GitHub");
  });

  it("offers Open folder (the daemon's system dialog) when the host can browse", async () => {
    vi.stubEnv("EXPO_PUBLIC_WUKONG", "1");
    vi.resetModules();
    const { buildAddProjectMethods } = await import("@/add-project-flow/options");
    const methods = buildAddProjectMethods({ ...(host as object), canBrowse: true } as never);
    expect(methods.find((method) => method.id === "browse")?.label).toBe("Open folder");
  });
});

describe("pluginSourceField", () => {
  const upstream = {
    label: "Plugin source",
    placeholder: "owner/slug or npm package",
    trailing: "docs",
  };

  it("is upstream's field in an upstream build", async () => {
    vi.resetModules();
    const { pluginSourceField } = await import("./plugin-source-field");
    expect(pluginSourceField(upstream)).toBe(upstream);
  });

  it("asks for a local folder and drops the docs link in a Wukong build", async () => {
    vi.stubEnv("EXPO_PUBLIC_WUKONG", "1");
    vi.resetModules();
    const { pluginSourceField } = await import("./plugin-source-field");
    expect(pluginSourceField(upstream)).toEqual({
      label: "Plugin folder",
      placeholder: "Path of a plugin folder on this machine",
      trailing: undefined,
    });
  });

  it("polls pinned usage only in a Wukong build", async () => {
    expect((await load()).usageRefetchInterval()).toBe(false);
    vi.stubEnv("EXPO_PUBLIC_WUKONG", "1");
    expect((await load()).usageRefetchInterval()).toBeGreaterThan(300_000);
  });
});
