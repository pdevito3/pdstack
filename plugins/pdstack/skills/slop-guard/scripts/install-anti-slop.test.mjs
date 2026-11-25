import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, test } from "node:test";
import { readGuard } from "./guard.mjs";
import { ASSETS_PATH, DEST, fetchPlugin, installAntiSlop, planInstall, planMessage, recordedShaOf, upstreamRecord } from "./install-anti-slop.mjs";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const files = (entries) => new Map(Object.entries(entries).map(([path, text]) => [path, Buffer.from(text)]));
const incoming = files({ "index.ts": "export {};\n", "rules/a.ts": "rule\n", LICENSE: "MIT\n" });

describe("planInstall", () => {
  test("installs every file into a repo with no plugin dir", () => {
    assert.deepEqual(planInstall(incoming, null, null, SHA), { kind: "install", files: incoming });
  });

  test("changes nothing when the files and the recorded commit match", () => {
    assert.deepEqual(planInstall(incoming, new Map(incoming), SHA, SHA), { kind: "noop" });
  });

  test("treats CRLF line endings as unchanged", () => {
    const local = files({ "index.ts": "export {};\r\n", "rules/a.ts": "rule\r\n", LICENSE: "MIT\r\n" });
    assert.deepEqual(planInstall(incoming, local, SHA, SHA), { kind: "noop" });
  });

  test("writes only the record when the files match and the record is missing or names another commit", () => {
    assert.deepEqual(planInstall(incoming, new Map(incoming), null, SHA), { kind: "record" });
    assert.deepEqual(planInstall(incoming, new Map(incoming), OTHER, SHA), { kind: "record" });
  });

  test("refuses and names each changed, added, and missing file", () => {
    const local = files({ "index.ts": "export {}; // local\n", "rules/b.ts": "rule\n", LICENSE: "MIT\n" });
    assert.deepEqual(planInstall(incoming, local, OTHER, SHA), { kind: "refuse", paths: ["index.ts", "rules/a.ts", "rules/b.ts"], recordedSha: OTHER });
  });
});

describe("planMessage", () => {
  const antiSlop = { repo: "https://example.com/anti-slop", sha: SHA };

  test("says a second run changed nothing", () => {
    assert.equal(planMessage({ kind: "noop" }, antiSlop), `anti-slop ${SHA.slice(0, 12)} is already installed at ${DEST}. Nothing changed.`);
  });

  test("names the commit a refused dir came from and each file", () => {
    const message = planMessage({ kind: "refuse", paths: ["index.ts"], recordedSha: OTHER }, antiSlop);
    assert.match(message, new RegExp(`^refused: ${DEST} was installed from ${OTHER.slice(0, 12)} and differs from anti-slop ${SHA.slice(0, 12)}`));
    assert.match(message, /\n {2}index\.ts\n/);
  });
});

test("the record names the repository and the commit, and reads back", () => {
  const record = upstreamRecord({ repo: "https://example.com/anti-slop", sha: SHA }, "2026-01-02");
  assert.match(record, /^- Repository: https:\/\/example\.com\/anti-slop$/m);
  assert.match(record, /^- Installed: 2026-01-02$/m);
  assert.equal(recordedShaOf(record), SHA);
});

describe("installAntiSlop against a local upstream", () => {
  const home = mkdtempSync(join(tmpdir(), "slop-guard-install-"));
  after(() => rmSync(home, { recursive: true, force: true }));
  const upstream = join(home, "upstream");
  const git = (...args) => execFileSync("git", ["-C", upstream, ...args], { encoding: "utf8" }).trim();
  mkdirSync(join(upstream, ASSETS_PATH, "rules"), { recursive: true });
  writeFileSync(join(upstream, ASSETS_PATH, "index.ts"), "export {};\n");
  writeFileSync(join(upstream, ASSETS_PATH, "rules", "a.ts"), "rule\n");
  writeFileSync(join(upstream, "LICENSE"), "MIT\n");
  writeFileSync(join(upstream, "README.md"), "not copied\n");
  git("init", "--quiet");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "pin");
  const antiSlop = { repo: pathToFileURL(upstream).href, sha: git("rev-parse", "HEAD") };
  const repo = join(home, "repo");
  const dest = join(repo, ...DEST.split("/"));

  test("copies the plugin and its license, then a second run is a no-op", () => {
    assert.equal(installAntiSlop(repo, antiSlop, "2026-01-02").kind, "install");
    assert.equal(readFileSync(join(dest, "rules", "a.ts"), "utf8"), "rule\n");
    assert.equal(readFileSync(join(dest, "LICENSE"), "utf8"), "MIT\n");
    assert.equal(existsSync(join(dest, "README.md")), false);
    assert.equal(recordedShaOf(readFileSync(join(dest, "UPSTREAM.md"), "utf8")), antiSlop.sha);
    const record = readFileSync(join(dest, "UPSTREAM.md"), "utf8");
    assert.equal(installAntiSlop(repo, antiSlop, "2026-02-03").kind, "noop");
    assert.equal(readFileSync(join(dest, "UPSTREAM.md"), "utf8"), record);
  });

  test("ignores .DS_Store and Thumbs.db that the OS wrote in the plugin dir", () => {
    writeFileSync(join(dest, ".DS_Store"), "junk");
    writeFileSync(join(dest, "rules", ".DS_Store"), "junk");
    writeFileSync(join(dest, "Thumbs.db"), "junk");
    assert.equal(installAntiSlop(repo, antiSlop, "2026-01-02").kind, "noop");
  });

  test("refuses over a local edit and leaves it in place", () => {
    writeFileSync(join(dest, "index.ts"), "export {}; // local\n");
    assert.deepEqual(installAntiSlop(repo, antiSlop, "2026-01-02"), { kind: "refuse", paths: ["index.ts"], recordedSha: antiSlop.sha });
    assert.equal(readFileSync(join(dest, "index.ts"), "utf8"), "export {}; // local\n");
  });
});

const guard = readGuard();
const online = spawnSync("git", ["ls-remote", "--exit-code", guard.antiSlop.repo, "HEAD"], { stdio: "ignore", timeout: 20_000 }).status === 0;

test("the pinned commit upstream holds the plugin and each anti-slop rule that guard.json requires", { skip: !online && "offline" }, () => {
  const plugin = fetchPlugin(guard.antiSlop);
  assert.ok(plugin.has("LICENSE"));
  for (const rule of guard.rules.filter((row) => row.tier === "anti-slop")) {
    const name = rule.id.slice("anti-slop/".length);
    assert.ok(plugin.has(`rules/${name}.ts`), `no rules/${name}.ts`);
    assert.match(plugin.get("index.ts").toString("utf8"), new RegExp(`"${name}":`));
  }
});
