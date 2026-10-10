import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "publish.mjs");
const PACKAGES = ["highlight", "relay", "protocol", "client", "plugin", "server", "cli"];

function makeTarball(directory, name) {
  const staging = mkdtempSync(path.join(tmpdir(), "wukong-pkg-"));
  mkdirSync(path.join(staging, "package"));
  writeFileSync(
    path.join(staging, "package/package.json"),
    JSON.stringify({ name: `@acme/${name}`, version: "1.0.0-wukong.1" }),
  );
  execFileSync("tar", [
    "-czf",
    path.join(directory, `acme-${name}-1.0.0-wukong.1.tgz`),
    "-C",
    staging,
    "package",
  ]);
}

test("publishes every package in dependency order, naming tarballs by absolute path", () => {
  const work = mkdtempSync(path.join(tmpdir(), "wukong-publish-"));
  const tarballs = path.join(work, "dist-npm");
  mkdirSync(tarballs);
  for (const name of PACKAGES) makeTarball(tarballs, name);

  // A stand-in npm: `view` says nothing is published, `publish` records its arguments.
  const bin = path.join(work, "bin");
  mkdirSync(bin);
  const log = path.join(work, "calls.log");
  const fakeNpm = path.join(bin, "npm");
  writeFileSync(
    fakeNpm,
    `#!/bin/sh\nif [ "$1" = "view" ]; then exit 1; fi\necho "$@" >> "${log}"\n`,
  );
  chmodSync(fakeNpm, 0o755);

  // Relative --dir, as the workflow passes it.
  execFileSync("node", [script, "--dir", "dist-npm", "--scope", "acme", "--dry-run"], {
    cwd: work,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });

  const calls = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(calls.length, PACKAGES.length);
  calls.forEach((call, index) => {
    const tarball = call.split(" ")[1];
    assert.ok(path.isAbsolute(tarball), `${tarball} must be absolute`);
    assert.ok(tarball.includes(`acme-${PACKAGES[index]}-`), `${tarball} out of order`);
    assert.match(call, /--dry-run/);
  });
});

test("refuses the upstream scope", () => {
  assert.throws(
    () =>
      execFileSync("node", [script, "--dir", tmpdir(), "--scope", "getpaseo"], { stdio: "pipe" }),
    /Refusing to publish under the upstream scope/,
  );
});
