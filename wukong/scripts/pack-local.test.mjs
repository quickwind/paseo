import assert from "node:assert/strict";
import test from "node:test";

import { buildStamp, coreVersion, parseArgs, staleTarball } from "./pack-local.mjs";

test("parses the options and defaults the scope to wukong", () => {
  assert.deepEqual(parseArgs(["--out", "dist"]), {
    out: "dist",
    scope: "wukong",
    workDir: "",
    keep: false,
  });
  assert.deepEqual(
    parseArgs(["--out", "d", "--scope", "@acme", "--work-dir", "C:\\wk", "--keep"]),
    {
      out: "d",
      scope: "acme",
      workDir: "C:\\wk",
      keep: true,
    },
  );
});

test("rejects a missing output, a bad scope, the upstream scope and unknown options", () => {
  assert.throws(() => parseArgs([]), /--out is required/);
  assert.throws(() => parseArgs(["--out", "d", "--scope", "Acme Corp"]), /lowercase npm scope/);
  assert.throws(() => parseArgs(["--out", "d", "--scope", "getpaseo"]), /upstream/);
  assert.throws(() => parseArgs(["--out", "d", "--nope"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--out"]), /needs a value/);
});

test("strips the prerelease and stamps the build in UTC", () => {
  assert.equal(coreVersion("0.11.2-beta.4"), "0.11.2");
  assert.equal(coreVersion("0.11.2"), "0.11.2");
  assert.equal(buildStamp(new Date(Date.UTC(2026, 9, 10, 3, 5))), "202610100305");
});

test("only tarballs of the same scope count as leftovers from an earlier build", () => {
  assert.equal(staleTarball("wukong-cli-0.11.2-wukong.1.tgz", "wukong"), true);
  assert.equal(staleTarball("acme-cli-1.0.0.tgz", "wukong"), false);
  assert.equal(staleTarball("INSTALL-WINDOWS.md", "wukong"), false);
});
