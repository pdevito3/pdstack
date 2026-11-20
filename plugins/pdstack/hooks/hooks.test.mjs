import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { reminder } from "./after-merge.mjs";
import { REMINDER, shouldRemind } from "./route-follow-up.mjs";

const hook = (file, event) =>
  spawnSync(process.execPath, [join(import.meta.dirname, file)], { input: JSON.stringify(event), encoding: "utf8" });
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });

describe("after-merge", () => {
  test("names the cleanup script and the PR after a merge command", () => {
    const text = reminder(bash("gh pr merge 58 --repo o/r --squash --match-head-commit abc"));
    assert.match(text, /post-merge-cleanup\.mjs" 58`/);
    assert.match(reminder(bash("cd x && gh pr merge 3")), /post-merge-cleanup\.mjs" 3`/);
    assert.match(reminder(bash("gh pr merge --squash")), /post-merge-cleanup\.mjs" <pr>`/);
  });

  test("stays quiet for other commands", () => {
    assert.equal(reminder(bash("gh pr view 58")), null);
    assert.equal(reminder(bash("git merge --ff-only origin/main")), null);
    assert.equal(reminder(bash("echo ghpr merge")), null);
    assert.equal(reminder(bash("origin pr merge 3")), null);
    assert.equal(reminder({ tool_name: "Read", tool_input: { file_path: "gh pr merge" } }), null);
  });

  test("prints PostToolUse context that points at a script that exists", () => {
    const result = hook("after-merge.mjs", bash("gh pr merge 58"));
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(output.hookEventName, "PostToolUse");
    const script = /`node "([^"]+)" 58`/.exec(output.additionalContext)[1];
    assert.ok(readFileSync(script, "utf8").includes("post-merge"), script);
    assert.equal(hook("after-merge.mjs", bash("ls")).stdout, "");
  });
});

describe("route-follow-up", () => {
  const loaded = JSON.stringify({ type: "user", isMeta: true, message: { content: [{ type: "text", text: "Base directory for this skill: /home/u/pdstack/plugins/pdstack/skills/pdstack\n\n# Poteto mode" }] } });
  const otherSkill = JSON.stringify({ type: "user", isMeta: true, message: { content: [{ type: "text", text: "Base directory for this skill: /home/u/pdstack/plugins/pdstack/skills/pdstack-help\n\n# Help" }] } });
  const windows = JSON.stringify({ type: "user", isMeta: true, message: { content: [{ type: "text", text: "Base directory for this skill: C:\\u\\pdstack\\plugins\\pdstack\\skills\\pdstack\n\n# Poteto mode" }] } });

  test("reminds only in a session that loaded the pdstack skill", () => {
    assert.equal(shouldRemind("now merge it", loaded), true);
    assert.equal(shouldRemind("now merge it", windows), true);
    assert.equal(shouldRemind("now merge it", otherSkill), false);
    assert.equal(shouldRemind("now merge it", ""), false);
  });

  test("leaves a slash command to its own skill", () => {
    assert.equal(shouldRemind("/ketchup", loaded), false);
  });

  test("prints the reminder as plain context from the transcript on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "route-follow-up-"));
    try {
      const transcript = join(dir, "s.jsonl");
      writeFileSync(transcript, `${loaded}\n`);
      const result = hook("route-follow-up.mjs", { prompt: "clean up the old worktrees", transcript_path: transcript });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), REMINDER);
      const missing = hook("route-follow-up.mjs", { prompt: "hi", transcript_path: join(dir, "none.jsonl") });
      assert.equal(missing.status, 0, missing.stderr);
      assert.equal(missing.stdout, "");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
