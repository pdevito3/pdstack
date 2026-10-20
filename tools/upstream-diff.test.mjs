import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { Upstreams } from "./lib/provenance.mjs";
import { applyPin, collectUpstreamDiff, copiedFolders, createMapper, parseLog, parseSyncSha, renderMarkdown } from "./lib/upstream-diff.mjs";

const CURSOR = "cursor/plugins";
const PC = "michael-denyer/pstack-claude";
const MATT = "mattpocock/skills";
const RENAMES = [["poteto-mode", "pdstack"], ["pstack:", "pdstack:"]];

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
}

function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    if (text === null) {
      rmSync(full);
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

function commit(repo, message, files) {
  write(repo, files);
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

function newRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "--quiet", "-b", "main");
  return dir;
}

// Three fake upstreams, their clones in an upstreams folder, and a pdstack repo.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pdstack-upstream-"));
  const cursor = newRepo(join(root, "src", "cursor"));
  const pc = newRepo(join(root, "src", "pstack-claude"));
  const matt = newRepo(join(root, "src", "matt"));
  const c = {};
  const p = {};
  const m = {};

  c.base = commit(cursor, "init", {
    "pstack/skills/poteto-mode/SKILL.md": "mode v1\n",
    "pstack/README.md": "readme\n",
    "other/x.md": "x\n",
  });
  c.mode = commit(cursor, "pstack: change mode", { "pstack/skills/poteto-mode/SKILL.md": "mode v2 pstack:deslop\n" });
  c.added = commit(cursor, "pstack: add a skill", { "pstack/skills/new-skill/SKILL.md": "new\n", "other/x.md": "x2\n" });
  c.outside = commit(cursor, "other: change x", { "other/x.md": "x3\n" });

  p.base = commit(pc, "init", {
    "plugins/pstack/skills/poteto-mode/SKILL.md": "mode v1\n",
    "plugins/pstack/skills/deslop/SKILL.md": "deslop v1\n",
    "plugins/pstack/skills/bro/SKILL.md": "bro\n",
    "tools/forks.json": "{}\n",
  });
  p.sync = commit(pc, `Sync to upstream ${c.mode.slice(0, 7)} (v1), release 0.1 (#1)`, { "plugins/pstack/skills/poteto-mode/SKILL.md": "mode v2 pstack:deslop\n" });
  p.own = commit(pc, "Tighten deslop and drop bro (#2)", {
    "plugins/pstack/skills/deslop/SKILL.md": "deslop v2\n",
    "plugins/pstack/skills/bro/SKILL.md": null,
    "tools/forks.json": JSON.stringify({ pstack: { "plugins/pstack/skills/deslop/SKILL.md": { kind: "policy", why: "Port rule." } } }),
  });

  m.base = commit(matt, "init", { "skills/productivity/wait-what/SKILL.md": "wait v1\n", "skills/other/z.md": "z\n" });
  m.change = commit(matt, "wait-what: add extra", { "skills/productivity/wait-what/SKILL.md": "wait v2\n", "skills/productivity/wait-what/EXTRA.md": "extra\n" });

  const upstreamsDir = join(root, "upstreams");
  mkdirSync(upstreamsDir);
  git(upstreamsDir, "clone", "--quiet", "--no-checkout", cursor, "cursor__plugins");
  git(upstreamsDir, "clone", "--quiet", "--no-checkout", pc, "michael-denyer__pstack-claude");
  git(upstreamsDir, "clone", "--quiet", "--no-checkout", matt, "mattpocock__skills");

  const repo = join(root, "pdstack");
  write(repo, {
    "plugins/pdstack/skills/pdstack/SKILL.md": "mode v1\n",
    "plugins/pdstack/skills/deslop/SKILL.md": "deslop local\n",
    "plugins/pdstack/skills/wait-what/SKILL.md": "wait v1\n",
    "provenance.json": `${JSON.stringify(
      {
        feeds: { [CURSOR]: c.base, [PC]: p.base, [MATT]: m.base },
        renames: RENAMES,
        pins: {
          "plugins/pdstack/skills/pdstack/SKILL.md": { source: PC, path: "plugins/pstack/skills/poteto-mode/SKILL.md", sha: p.base, status: "renamed" },
          "plugins/pdstack/skills/deslop/SKILL.md": { source: PC, path: "plugins/pstack/skills/deslop/SKILL.md", sha: p.base, status: "modified", why: "Local rule." },
          "plugins/pdstack/skills/wait-what/SKILL.md": { source: MATT, path: "skills/productivity/wait-what/SKILL.md", sha: m.base, status: "verbatim" },
        },
      },
      null,
      2,
    )}\n`,
  });
  return { repo, upstreams: new Upstreams(upstreamsDir), c, p, m };
}

const files = (change) => change.files.map((f) => [f.change, f.path, f.local.map((l) => [l.path, l.pin?.status ?? null, l.exists])]);

test("parseSyncSha reads both sync message styles", () => {
  assert.equal(parseSyncSha("Sync to upstream 7b353f7 (v0.15.27): add skills, release 0.9.94 (#291)"), "7b353f7");
  assert.equal(parseSyncSha("feat(pstack): sync to upstream df58112 (v0.15.15) (#234)"), "df58112");
  assert.equal(parseSyncSha("Restore upstream stop rules (#254)"), null);
});

test("parseLog groups files under their commit", () => {
  const text = "\x1eaaa\x1f2026-10-20T00:00:00Z\x1ffirst\n\nM\tpstack/a.md\nA\tpstack/b.md\n\x1ebbb\x1f2026-10-21T00:00:00Z\x1fsecond\n\nD\tpstack/a.md\n";
  assert.deepEqual(parseLog(text), [
    { sha: "aaa", date: "2026-10-20T00:00:00Z", subject: "first", files: [{ path: "pstack/a.md", change: "modified" }, { path: "pstack/b.md", change: "added" }] },
    { sha: "bbb", date: "2026-10-21T00:00:00Z", subject: "second", files: [{ path: "pstack/a.md", change: "deleted" }] },
  ]);
});

test("copiedFolders derives pinned folders and fixes the cursor folders", () => {
  const provenance = {
    pins: {
      a: { source: PC, path: "plugins/pstack/skills/x/SKILL.md" },
      b: { source: PC, path: "plugins/pstack/models.json" },
      c: { source: MATT, path: "skills/productivity/wait-what/SKILL.md" },
    },
  };
  assert.deepEqual(copiedFolders(provenance, PC), ["plugins/pstack/models.json", "plugins/pstack/skills"]);
  assert.deepEqual(copiedFolders(provenance, MATT), ["skills/productivity/wait-what"]);
  assert.deepEqual(copiedFolders(provenance, CURSOR), ["pstack/", "cursor-team-kit/skills/", "thermos/"]);
});

test("createMapper maps through pins, the pstack-claude rule, and pin folders", () => {
  const pin = { source: PC, path: "plugins/pstack/skills/poteto-mode/SKILL.md", status: "renamed" };
  const mattPin = { source: MATT, path: "skills/productivity/wait-what/SKILL.md", status: "verbatim" };
  const map = createMapper(
    { renames: RENAMES, pins: { "plugins/pdstack/skills/pdstack/SKILL.md": pin, "plugins/pdstack/skills/wait-what/SKILL.md": mattPin } },
    () => false,
  );
  assert.deepEqual(map(CURSOR, "pstack/skills/poteto-mode/SKILL.md"), [{ path: "plugins/pdstack/skills/pdstack/SKILL.md", pin, exists: false }]);
  assert.deepEqual(map(CURSOR, "thermos/skills/thermos/SKILL.md"), [{ path: "plugins/pdstack/skills/thermos/SKILL.md", pin: null, exists: false }]);
  assert.deepEqual(map(CURSOR, "cursor-team-kit/skills/deslop/SKILL.md"), [{ path: "plugins/pdstack/skills/deslop/SKILL.md", pin: null, exists: false }]);
  assert.deepEqual(map(CURSOR, "other/x.md"), []);
  assert.deepEqual(map(PC, "plugins/pstack/skills/poteto-mode/references/new.md"), [{ path: "plugins/pdstack/skills/pdstack/references/new.md", pin: null, exists: false }]);
  assert.deepEqual(map(PC, "tools/sync.mjs"), []);
  assert.deepEqual(map(MATT, "skills/productivity/wait-what/EXTRA.md"), [{ path: "plugins/pdstack/skills/wait-what/EXTRA.md", pin: null, exists: false }]);
  assert.deepEqual(map(MATT, "skills/other/z.md"), []);
});

test("collectUpstreamDiff groups each feed by commit with translation state and mapped files", () => {
  const { repo, upstreams, c, p, m } = fixture();
  const report = collectUpstreamDiff({ repoRoot: repo, upstreams });
  const [cursor, pc, matt] = report.feeds;

  assert.equal(cursor.from, c.base);
  assert.equal(cursor.to, c.outside);
  assert.deepEqual(cursor.changes.map((x) => x.sha), [c.mode, c.added]);
  assert.equal(cursor.changes[0].translation.state, "translated");
  assert.equal(cursor.changes[0].translation.by.sha, p.sync);
  assert.equal(cursor.changes[0].translation.by.reviewed, false);
  assert.equal(cursor.changes[1].translation.state, "not translated");
  assert.deepEqual(files(cursor.changes[0]), [["modified", "pstack/skills/poteto-mode/SKILL.md", [["plugins/pdstack/skills/pdstack/SKILL.md", "renamed", true]]]]);
  assert.deepEqual(files(cursor.changes[1]), [["added", "pstack/skills/new-skill/SKILL.md", [["plugins/pdstack/skills/new-skill/SKILL.md", null, false]]]]);

  assert.deepEqual(pc.folders, ["plugins/pstack/skills"]);
  assert.deepEqual(pc.changes.map((x) => [x.sha, x.kind, x.syncOf]), [[p.sync, "sync", c.mode.slice(0, 7)], [p.own, "own", undefined]]);
  assert.deepEqual(files(pc.changes[1]), [
    ["deleted", "plugins/pstack/skills/bro/SKILL.md", [["plugins/pdstack/skills/bro/SKILL.md", null, false]]],
    ["modified", "plugins/pstack/skills/deslop/SKILL.md", [["plugins/pdstack/skills/deslop/SKILL.md", "modified", true]]],
  ]);
  assert.equal(pc.changes[1].files[1].forkReason, "Port rule.");
  assert.equal(pc.changes[1].files[0].forkReason, undefined);

  assert.deepEqual(matt.changes.map((x) => x.sha), [m.change]);
  assert.deepEqual(files(matt.changes[0]), [
    ["added", "skills/productivity/wait-what/EXTRA.md", [["plugins/pdstack/skills/wait-what/EXTRA.md", null, false]]],
    ["modified", "skills/productivity/wait-what/SKILL.md", [["plugins/pdstack/skills/wait-what/SKILL.md", "verbatim", true]]],
  ]);

  const markdown = renderMarkdown(report);
  assert.match(markdown, new RegExp(`### ${c.mode.slice(0, 7)} pstack: change mode`));
  assert.match(markdown, new RegExp(`Translation: translated by ${PC} ${p.sync.slice(0, 7)}`));
  assert.match(markdown, /Translation: not translated yet/);
  assert.match(markdown, /\| deleted \| `plugins\/pstack\/skills\/bro\/SKILL.md` \| - \| not copied \|/);
  assert.match(markdown, /\| added \| `pstack\/skills\/new-skill\/SKILL.md` \| `plugins\/pdstack\/skills\/new-skill\/SKILL.md` \| new upstream file, no pin \|/);
  assert.match(markdown, /- `plugins\/pstack\/skills\/deslop\/SKILL.md`: Port rule\./);
});

test("collectUpstreamDiff honors from and to overrides and marks reviewed syncs", () => {
  const { repo, upstreams, c, p } = fixture();
  const report = collectUpstreamDiff({ repoRoot: repo, upstreams, feeds: [CURSOR], to: { [CURSOR]: c.mode } });
  assert.deepEqual(report.feeds.map((f) => f.source), [CURSOR]);
  assert.deepEqual(report.feeds[0].changes.map((x) => x.sha), [c.mode]);

  const reviewed = collectUpstreamDiff({ repoRoot: repo, upstreams, feeds: [CURSOR], from: { [PC]: p.own } });
  assert.equal(reviewed.feeds[0].changes[0].translation.by.reviewed, true);

  const empty = collectUpstreamDiff({ repoRoot: repo, upstreams, feeds: [MATT], from: { [MATT]: "HEAD" } });
  assert.deepEqual(empty.feeds[0].changes, []);
  assert.match(renderMarkdown(empty), /No changes\./);
});

test("applyPin copies a renamed file again and moves its pin", () => {
  const { repo, upstreams, p } = fixture();
  const sha = applyPin({ repoRoot: repo, upstreams, local: "plugins/pdstack/skills/pdstack/SKILL.md", sha: p.sync.slice(0, 10) });
  assert.equal(sha, p.sync);
  assert.equal(readFileSync(join(repo, "plugins/pdstack/skills/pdstack/SKILL.md"), "utf8"), "mode v2 pdstack:deslop\n");
  const provenance = JSON.parse(readFileSync(join(repo, "provenance.json"), "utf8"));
  assert.equal(provenance.pins["plugins/pdstack/skills/pdstack/SKILL.md"].sha, p.sync);

  assert.throws(() => applyPin({ repoRoot: repo, upstreams, local: "plugins/pdstack/skills/deslop/SKILL.md", sha: p.own }), /modified pin/);
  assert.throws(() => applyPin({ repoRoot: repo, upstreams, local: "plugins/pdstack/skills/nope/SKILL.md", sha: p.own }), /no pin/);
});
