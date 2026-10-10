import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { applyWukongDefaults, wukongDefaultHome } from "./defaults.js";

function freshHome() {
  return mkdtempSync(path.join(tmpdir(), "wukong-defaults-"));
}

describe("applyWukongDefaults", () => {
  it("uses ~/.wukong and writes a config that listens on 6899", () => {
    const home = freshHome();
    const env: NodeJS.ProcessEnv = {};
    applyWukongDefaults(env, home);
    expect(env.PASEO_HOME).toBe(wukongDefaultHome(home));
    const config = JSON.parse(readFileSync(path.join(env.PASEO_HOME ?? "", "config.json"), "utf8"));
    expect(config).toEqual({ version: 1, daemon: { listen: "127.0.0.1:6899" } });
  });

  it("leaves an explicit PASEO_HOME alone and writes its config there", () => {
    const home = freshHome();
    const explicit = path.join(freshHome(), "mine");
    const env: NodeJS.ProcessEnv = { PASEO_HOME: explicit };
    applyWukongDefaults(env, home);
    expect(env.PASEO_HOME).toBe(explicit);
    expect(existsSync(path.join(explicit, "config.json"))).toBe(true);
    expect(existsSync(path.join(home, ".wukong"))).toBe(false);
  });

  it("expands ~ in PASEO_HOME, including the Windows backslash form", () => {
    const home = freshHome();
    for (const spelling of ["~/work", "~\\work"]) {
      applyWukongDefaults({ PASEO_HOME: spelling }, home);
      expect(existsSync(path.join(home, "work", "config.json"))).toBe(true);
    }
  });

  it("never overwrites an existing config", () => {
    const home = freshHome();
    const env: NodeJS.ProcessEnv = { PASEO_HOME: home };
    writeFileSync(
      path.join(home, "config.json"),
      '{"version":1,"daemon":{"listen":"127.0.0.1:7000"}}',
    );
    applyWukongDefaults(env, home);
    expect(readFileSync(path.join(home, "config.json"), "utf8")).toContain("7000");
  });
});
