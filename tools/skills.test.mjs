import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkVersions, lintSkills, parseFrontmatter } from "./lib/skills.mjs";

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "pdstack-lint-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const skill = (name) => `---\nname: ${name}\ndescription: Does ${name}.\n---\nbody\n`;

test("parseFrontmatter reads keys and folded values", () => {
  assert.deepEqual(parseFrontmatter("---\nname: a\ndescription: >\n  long\n  text\n---\n"), { name: "a", description: "> long text" });
  assert.equal(parseFrontmatter("no frontmatter"), null);
});

test("lintSkills accepts valid skills and known references", () => {
  const root = repo({
    "plugins/pdstack/skills/deslop/SKILL.md": skill("deslop"),
    "plugins/pdstack/skills/pdstack/SKILL.md": `${skill("pdstack")}Call pdstack:deslop and pdstack:comment-sicko.\n`,
    "plugins/pdstack/agents/comment-sicko.md": "---\nname: comment-sicko\ndescription: c\n---\n",
  });
  assert.deepEqual(lintSkills(root), []);
});

test("lintSkills reports bad names, unknown references, and the old namespace", () => {
  const root = repo({
    "plugins/pdstack/skills/deslop/SKILL.md": skill("other"),
    "plugins/pdstack/skills/pdstack/SKILL.md": `${skill("pdstack")}Call pdstack:missing and pstack:deslop.\n`,
  });
  assert.deepEqual(lintSkills(root), [
    "plugins/pdstack/skills/deslop/SKILL.md: name other does not match folder deslop",
    "plugins/pdstack/skills/pdstack/SKILL.md: pdstack:missing names no skill or agent",
    "plugins/pdstack/skills/pdstack/SKILL.md: pstack:deslop uses the old namespace",
  ]);
});

test("checkVersions compares the two manifests", () => {
  const manifests = (a, b) =>
    repo({
      "plugins/pdstack/.claude-plugin/plugin.json": JSON.stringify({ version: a }),
      ".claude-plugin/marketplace.json": JSON.stringify({ plugins: [{ name: "pdstack", version: b }] }),
    });
  assert.deepEqual(checkVersions(manifests("0.1.0", "0.1.0")), []);
  assert.equal(checkVersions(manifests("0.1.0", "0.2.0")).length, 1);
});
