import { afterEach, describe, expect, it } from "vitest";

import { activateWukongPolicy } from "./policy.js";
import { wukongTerminalProfiles } from "./terminal-profiles.js";

describe("wukongTerminalProfiles", () => {
  let deactivate: (() => void) | undefined;
  afterEach(() => deactivate?.());

  const custom = [{ id: "mine", name: "Mine", command: "mine" }];

  it("leaves the configured profiles alone until Wukong is active", () => {
    expect(wukongTerminalProfiles(custom)).toBe(custom);
    expect(wukongTerminalProfiles(undefined)).toBeUndefined();
  });

  it("is Claude Code alone once active, ignoring configured profiles", () => {
    deactivate = activateWukongPolicy();
    for (const configured of [undefined, custom]) {
      expect(wukongTerminalProfiles(configured)?.map((profile) => profile.id)).toEqual(["claude"]);
    }
  });
});
