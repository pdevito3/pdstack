import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readSession } from "./user-turns.mjs";

const user = (content, extra = {}) => ({ type: "user", message: { role: "user", content }, ...extra });
const human = { origin: { kind: "human" } };
const agent = (...content) => ({ type: "assistant", message: { role: "assistant", content } });
const say = (text) => ({ type: "text", text });
const skill = (name) => ({ type: "tool_use", name: "Skill", input: { skill: name } });
const queued = (prompt, origin) => ({
  type: "attachment",
  attachment: { type: "queued_command", prompt, commandMode: "task-notification", ...(origin && { origin: { kind: origin } }) },
});
const jsonl = (records) => records.map((record) => JSON.stringify(record)).join("\n");

const withOrigins = jsonl([
  { type: "summary", sessionId: "s" },
  user("<command-name>/clear</command-name>"),
  user("<command-message>pdstack:pdstack</command-message>\n<command-args>fix the flaky test</command-args>", human),
  user([say("Base directory for this skill: /x")], { isMeta: true }),
  agent(say("Your local clone is up to date."), skill("pdstack:deslop")),
  user([{ type: "tool_result", tool_use_id: "t", content: "ok" }]),
  user("<task-notification>\n<status>completed</status>\n</task-notification>", { origin: { kind: "task-notification" } }),
  user("i meant our claude code plugin usage", human),
  agent(skill("pdstack:deslop")),
  queued("maybe make the report an html file", "human"),
  queued("<task-notification>done</task-notification>", "task-notification"),
  user("This session is being continued from a previous conversation.", { isCompactSummary: true }),
  user([say("see the screenshot here"), { type: "image", source: {} }], human),
]);

test("keeps only the prompts the user typed, each after the last agent text before it", () => {
  assert.deepEqual(
    readSession(withOrigins).turns.map(({ line, agent: before, user: typed }) => [line, before, typed]),
    [
      [3, "", "<command-message>pdstack:pdstack</command-message>\n<command-args>fix the flaky test</command-args>"],
      [8, "Your local clone is up to date.", "i meant our claude code plugin usage"],
      [10, "Your local clone is up to date.", "maybe make the report an html file"],
      [13, "Your local clone is up to date.", "see the screenshot here"],
    ],
  );
});

test("lists each skill the session loaded once, by slash command or by the Skill tool", () => {
  assert.deepEqual(readSession(withOrigins).skills, ["pdstack:pdstack", "pdstack:deslop"]);
});

test("leaves out a slash command that loaded no skill", () => {
  const session = jsonl([
    user("<command-message>compact</command-message>", human),
    agent(say("Compacted.")),
    user([say("Base directory for this skill: /x")], { isMeta: true }),
  ]);
  assert.deepEqual(readSession(session).skills, []);
});

test("falls back to the record tags when a transcript has no origin fields", () => {
  const untagged = jsonl([
    user("<command-name>/clear</command-name>"),
    user("<local-command-stdout></local-command-stdout>"),
    user("<task-notification>done</task-notification>"),
    user("Summary of the earlier turns.", { isCompactSummary: true }),
    user([say("[Request interrupted by user]")]),
    user([say("[Request interrupted by user for tool use]")]),
    user("rename it", {}),
    { type: "attachment", attachment: { type: "queued_command", prompt: "and the test", commandMode: "prompt" } },
  ]);
  assert.deepEqual(
    readSession(untagged).turns.map((turn) => turn.user),
    ["rename it", "and the test"],
  );
});

function cli(contents) {
  const dir = mkdtempSync(join(tmpdir(), "user-turns-"));
  try {
    const path = join(dir, "s.jsonl");
    writeFileSync(path, contents);
    return spawnSync(process.execPath, [join(import.meta.dirname, "user-turns.mjs"), path], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("prints the skills and then the turns from the command line", () => {
  const result = cli(`${withOrigins}\n{not json`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^skills: pdstack:pdstack, pdstack:deslop\n/);
  assert.match(result.stdout, /--- line 8\nagent: Your local clone is up to date\.\nuser: i meant our claude code plugin usage\n/);
});

test("exits 1 when the file holds no typed prompt", () => {
  const result = cli(jsonl([user("<command-name>/clear</command-name>"), { type: "session", version: 3, cwd: "/x" }]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no typed prompts in /);
});
