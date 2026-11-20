#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Claude Code marks a typed prompt with origin.kind "human". A transcript
// without origin fields also writes local commands, their output, background-task
// notifications, and compaction summaries as non-meta `user` records. An interrupt
// marker has no origin field even in a transcript that has them.
const NOT_TYPED =
  /^\s*(?:<(?:command-name|local-command-stdout|local-command-caveat|bash-input|bash-stdout|task-notification|system-reminder)>|\[Request interrupted by user(?: for tool use)?\]\s*$)/u;
const CONTEXT_CHARS = 400;

function text(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

// A prompt typed while the agent works is written only as a queued_command attachment.
function typedPrompt(record) {
  if (record?.type === "attachment" && record.attachment?.type === "queued_command") {
    const { origin, commandMode, prompt } = record.attachment;
    const typed = origin ? origin.kind === "human" : commandMode === "prompt";
    return typed && typeof prompt === "string" ? prompt : "";
  }
  if (record?.type !== "user" || record.isMeta || record.isCompactSummary) return "";
  const body = text(record.message?.content);
  if (record.origin) return record.origin.kind === "human" ? body : "";
  return NOT_TYPED.test(body) ? "" : body;
}

export function readSession(jsonl) {
  const skills = new Set();
  const turns = [];
  let agent = "";
  let command = null;
  jsonl.split("\n").forEach((raw, index) => {
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      return;
    }
    // A typed slash command that loads a skill is followed by this meta record; a built-in such as /clear is not.
    if (command && record?.isMeta && text(record.message?.content).startsWith("Base directory for this skill:")) {
      skills.add(command);
    }
    command = null;
    if (record?.type === "assistant") {
      const content = Array.isArray(record.message?.content) ? record.message.content : [];
      for (const block of content) {
        if (block?.type === "tool_use" && block.name === "Skill" && block.input?.skill) skills.add(block.input.skill);
      }
      agent = text(content) || agent;
    }
    const user = typedPrompt(record);
    if (!user.trim()) return;
    turns.push({ line: index + 1, agent: agent.slice(-CONTEXT_CHARS), user });
    command = /^\s*<command-message>([^<]+)<\/command-message>/u.exec(user)?.[1] ?? null;
  });
  return { skills: [...skills], turns };
}

function main(argv) {
  if (argv.length !== 1) {
    console.error("usage: user-turns.mjs <transcript.jsonl>");
    return 2;
  }
  const { skills, turns } = readSession(readFileSync(argv[0], "utf8"));
  if (!turns.length) {
    console.error(`no typed prompts in ${argv[0]}`);
    return 1;
  }
  console.log(`skills: ${skills.join(", ") || "none"}`);
  for (const turn of turns) {
    console.log(`--- line ${turn.line}`);
    if (turn.agent) console.log(`agent: ${turn.agent}`);
    console.log(`user: ${turn.user}`);
  }
  return 0;
}

// node leaves argv[1] unresolved and may set it to a non-file (`node -e ... arg`).
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (invokedDirectly()) process.exitCode = main(process.argv.slice(2));
