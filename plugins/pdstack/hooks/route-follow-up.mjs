#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

// The skill's load record, JSON-escaped in the transcript: "...skills/pdstack\n".
const PDSTACK_LOADED = /Base directory for this skill: [^"]*?skills(?:\/|\\\\)pdstack\\n/;

export const REMINDER = [
  "pdstack is active in this session.",
  "Match this request to a playbook in pdstack's Playbooks section before you act, as for the first request.",
  "When it fits a different playbook from the current one, open that playbook and copy its steps into the todolist.",
  "A merge, a cleanup, or a fix to an open PR is a request too.",
].join(" ");

export function shouldRemind(prompt, transcript) {
  if (typeof prompt !== "string" || prompt.trimStart().startsWith("/")) return false;
  return PDSTACK_LOADED.test(transcript);
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
  const event = JSON.parse(readFileSync(0, "utf8") || "{}");
  let transcript = "";
  try {
    transcript = readFileSync(event.transcript_path, "utf8");
  } catch {}
  if (shouldRemind(event.prompt, transcript)) console.log(REMINDER);
}
