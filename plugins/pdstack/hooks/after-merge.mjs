#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MERGE = /(?:^|[\s;&|(])gh\s+pr\s+merge\b(?:\s+(\d+))?/;
const CLEANUP = join(resolve(import.meta.dirname, ".."), "skills", "pdstack", "scripts", "post-merge-cleanup.mjs");

export function reminder(event) {
  const command = event?.tool_input?.command;
  if (event?.tool_name !== "Bash" || typeof command !== "string") return null;
  const match = MERGE.exec(command);
  if (!match) return null;
  return [
    "pdstack plugin hook (PostToolUse): a PR merge command ran.",
    `pdstack's post-merge rule: once the PR reads merged, the agent that merged it runs \`node "${CLEANUP}" ${match[1] ?? "<pr>"}\` in the repository itself.`,
    "It clears a held item only when no work is lost, such as switching a clean primary checkout to trunk, and reruns the script.",
    "It reports each other held item to the user with its reason, and never deletes or discards work to clear one.",
  ].join(" ");
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

if (invokedDirectly()) {
  const text = reminder(JSON.parse(readFileSync(0, "utf8") || "{}"));
  if (text) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }));
}
