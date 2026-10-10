import { describe, expect, it, vi } from "vitest";

import { pickDirectoryOnDaemon } from "./pick-directory";

describe("pickDirectoryOnDaemon", () => {
  it("asks the bundled plugin for the system dialog and returns the path", async () => {
    const invokePluginRpc = vi.fn().mockResolvedValue({ path: "C:\\work\\app" });
    expect(await pickDirectoryOnDaemon({ invokePluginRpc })).toBe("C:\\work\\app");
    expect(invokePluginRpc).toHaveBeenCalledWith("wukong-gitlab", "wukong.pick-folder", {});
  });

  it("returns null when the dialog is cancelled", async () => {
    const invokePluginRpc = vi.fn().mockResolvedValue({ path: null });
    expect(await pickDirectoryOnDaemon({ invokePluginRpc })).toBeNull();
  });

  it("fails without a connection and on a malformed answer", async () => {
    await expect(pickDirectoryOnDaemon(null)).rejects.toThrow(/Not connected/);
    const invokePluginRpc = vi.fn().mockResolvedValue({ nope: 1 });
    await expect(pickDirectoryOnDaemon({ invokePluginRpc })).rejects.toThrow();
  });
});
