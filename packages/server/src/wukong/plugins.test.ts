import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BuiltinPluginLoader } from "../server/plugins/builtin/index.js";
import { ManagedPluginSources } from "../server/plugins/managed-source.js";
import { activateWukongPolicy } from "./policy.js";
import {
  pluginSourcesUnavailableMessage,
  wukongBuiltinPlugins,
  wukongManagedSources,
} from "./plugins.js";

describe("Wukong plugins", () => {
  const sources = new ManagedPluginSources("/tmp/wukong-test-home");
  const loader = new BuiltinPluginLoader();

  it("passes upstream wiring through until activated", () => {
    expect(wukongManagedSources(sources)).toBe(sources);
    expect(wukongBuiltinPlugins(loader)).toBe(loader);
  });

  describe("once active", () => {
    let deactivate: () => void;
    beforeEach(() => {
      deactivate = activateWukongPolicy();
    });
    afterEach(() => deactivate());

    it("drops managed (npm, Git, registry) sources", () => {
      expect(wukongManagedSources(sources)).toBeUndefined();
    });

    it("starts only Wukong's own bundled plugin", () => {
      expect([...(wukongBuiltinPlugins(loader)?.ids ?? [])]).toEqual(["wukong-gitlab"]);
    });
  });

  it("keeps upstream's message until active, then says to install from a local folder", () => {
    expect(pluginSourcesUnavailableMessage("upstream says no")).toBe("upstream says no");
    const deactivate = activateWukongPolicy();
    try {
      expect(pluginSourcesUnavailableMessage("upstream says no")).toMatch(
        /local folder only.*wukong plugin install <folder>/,
      );
    } finally {
      deactivate();
    }
  });
});
