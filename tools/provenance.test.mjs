import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { applyDrops, applyRenames, checkProvenance, hideSkill, upstreamPathFor, validatePins } from "./lib/provenance.mjs";

const SHA = "a".repeat(40);
const RENAMES = [["poteto-mode", "pdstack"], ["poteto-agent", "pdstack-agent"], ["pstack:", "pdstack:"]];

class FakeUpstreams {
  constructor(files) {
    this.files = files;
  }
  show(source, sha, path) {
    const text = this.files[`${source}@${sha}:${path}`];
    return text === undefined ? null : Buffer.from(text);
  }
}

function repo(files, provenance) {
  const root = mkdtempSync(join(tmpdir(), "pdstack-prov-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  writeFileSync(join(root, "provenance.json"), JSON.stringify(provenance));
  return root;
}

test("applyRenames applies the table in order", () => {
  assert.equal(applyRenames("pstack:poteto-agent in /poteto-mode", RENAMES), "pdstack:pdstack-agent in /pdstack");
});

test("hideSkill adds user-invocable once", () => {
  const hidden = hideSkill("---\nname: a\ndescription: b\n---\nbody\n");
  assert.equal(hidden, "---\nname: a\ndescription: b\nuser-invocable: false\n---\nbody\n");
  assert.equal(hideSkill(hidden), hidden);
});

test("upstreamPathFor reverses the renames", () => {
  assert.equal(upstreamPathFor("plugins/pdstack/skills/pdstack/SKILL.md", RENAMES), "plugins/pstack/skills/poteto-mode/SKILL.md");
  assert.equal(upstreamPathFor("plugins/pdstack/agents/pdstack-agent.md", RENAMES), "plugins/pstack/agents/poteto-agent.md");
  assert.equal(upstreamPathFor("tools/x.mjs", RENAMES), null);
});

test("validatePins requires why only on modified pins", () => {
  const base = { source: "michael-denyer/pstack-claude", path: "p", sha: SHA };
  const errors = validatePins({
    feeds: {},
    renames: [],
    pins: { a: { ...base, status: "modified" }, b: { ...base, status: "verbatim", why: "x" }, c: { ...base, status: "verbatim", hide: true } },
  });
  assert.deepEqual(errors, ["a: a modified pin needs a why", "b: only a modified pin has a why", "c: hide needs status renamed"]);
});

test("checkProvenance proves verbatim, renamed, and hidden pins", () => {
  const src = "michael-denyer/pstack-claude";
  const upstreams = new FakeUpstreams({
    [`${src}@${SHA}:plugins/pstack/skills/deslop/SKILL.md`]: "---\nname: deslop\ndescription: d\n---\nsee /poteto-mode\n",
    [`${src}@${SHA}:plugins/pstack/README.md`]: "readme\n",
  });
  const pins = {
    "plugins/pdstack/skills/deslop/SKILL.md": { source: src, path: "plugins/pstack/skills/deslop/SKILL.md", sha: SHA, status: "renamed", hide: true },
    "plugins/pdstack/README.md": { source: src, path: "plugins/pstack/README.md", sha: SHA, status: "verbatim" },
  };
  const good = repo(
    {
      "plugins/pdstack/skills/deslop/SKILL.md": "---\nname: deslop\ndescription: d\nuser-invocable: false\n---\nsee /pdstack\n",
      "plugins/pdstack/README.md": "readme\n",
    },
    { feeds: { [src]: SHA }, renames: RENAMES, pins },
  );
  assert.deepEqual(checkProvenance(good, upstreams), []);

  const bad = repo(
    {
      "plugins/pdstack/skills/deslop/SKILL.md": "---\nname: deslop\ndescription: d\n---\nsee /pdstack\n",
      "plugins/pdstack/README.md": "changed\n",
    },
    { feeds: { [src]: SHA }, renames: RENAMES, pins },
  );
  assert.equal(checkProvenance(bad, upstreams).length, 2);
});

test("applyDrops removes each paragraph", () => {
  assert.equal(applyDrops("# A\n\nOn Codex, read x.\n\nbody\n", ["On Codex, read x.\n\n"]), "# A\n\nbody\n");
});

test("checkProvenance applies drops to renamed pins and flags an unused drop", () => {
  const src = "michael-denyer/pstack-claude";
  const upstreams = new FakeUpstreams({ [`${src}@${SHA}:plugins/pstack/skills/deslop/SKILL.md`]: "# Deslop\n\nSee poteto-mode.\n\nbody\n" });
  const pins = { "plugins/pdstack/skills/deslop/SKILL.md": { source: src, path: "plugins/pstack/skills/deslop/SKILL.md", sha: SHA, status: "renamed" } };
  const files = { "plugins/pdstack/skills/deslop/SKILL.md": "# Deslop\n\nbody\n" };
  assert.deepEqual(checkProvenance(repo(files, { feeds: { [src]: SHA }, renames: RENAMES, drops: ["See pdstack.\n\n"], pins }), upstreams), []);
  assert.deepEqual(checkProvenance(repo(files, { feeds: { [src]: SHA }, renames: RENAMES, drops: ["See pdstack.\n\n", "gone\n"], pins }), upstreams), [
    'drops: no renamed file has "gone\\n"',
  ]);
  assert.deepEqual(validatePins({ feeds: {}, renames: [], drops: [""], pins: {} }), ["drops: must be an array of non-empty strings"]);
});

test("checkProvenance flags an unpinned copy", () => {
  const src = "michael-denyer/pstack-claude";
  const upstreams = new FakeUpstreams({ [`${src}@${SHA}:plugins/pstack/skills/poteto-mode/SKILL.md`]: "x" });
  const root = repo({ "plugins/pdstack/skills/pdstack/SKILL.md": "x", "plugins/pdstack/skills/new/SKILL.md": "y" }, { feeds: { [src]: SHA }, renames: RENAMES, pins: {} });
  assert.deepEqual(checkProvenance(root, upstreams), [
    "plugins/pdstack/skills/pdstack/SKILL.md: copied from michael-denyer/pstack-claude:plugins/pstack/skills/poteto-mode/SKILL.md but has no pin",
  ]);
});
