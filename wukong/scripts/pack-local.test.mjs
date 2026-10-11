import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildStamp,
  coreVersion,
  makeZip,
  parseArgs,
  staleBundle,
  staleTarball,
} from "./pack-local.mjs";

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

test("only bundles of the same scope count as leftovers", () => {
  assert.equal(staleBundle("wukong-0.11.2-wukong.1.zip", "wukong"), true);
  assert.equal(staleBundle("acme-1.0.0.zip", "wukong"), false);
  assert.equal(staleBundle("paseo-bots-0.2.0-offline.2.zip", "wukong"), false);
  assert.equal(staleBundle("wukong-cli-0.11.2-wukong.1.tgz", "wukong"), false);
});

// Lists a zip with whichever tool the machine has (bsdtar reads zip; GNU tar does not).
function zipEntries(zipFile) {
  for (const [command, args] of [
    ["tar", ["-tf", zipFile]],
    ["unzip", ["-Z1", zipFile]],
  ]) {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (!result.error && result.status === 0) {
      return result.stdout.split(/\r?\n/u).filter(Boolean);
    }
  }
  throw new Error("no tool to list a zip");
}

test("makeZip puts the given files at the top of one zip, and replaces an old one", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "wukong-zip-"));
  try {
    for (const name of ["a.tgz", "b.tgz", "windows-update.ps1", "INSTALL-WINDOWS.md"]) {
      writeFileSync(path.join(directory, name), name);
    }
    const zipFile = path.join(tmpdir(), `wukong-zip-test-${process.pid}.zip`);
    writeFileSync(zipFile, "stale");
    makeZip(zipFile, directory, ["a.tgz", "b.tgz", "windows-update.ps1", "INSTALL-WINDOWS.md"]);
    assert.deepEqual(zipEntries(zipFile).sort(), [
      "INSTALL-WINDOWS.md",
      "a.tgz",
      "b.tgz",
      "windows-update.ps1",
    ]);
    rmSync(zipFile);
    assert.equal(existsSync(zipFile), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("makeZip fails clearly when a member is missing", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "wukong-zip-"));
  try {
    const zipFile = path.join(directory, "out.zip");
    assert.throws(() => makeZip(zipFile, directory, ["nope.tgz"]), /Could not write the zip/);
    assert.equal(existsSync(zipFile), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
