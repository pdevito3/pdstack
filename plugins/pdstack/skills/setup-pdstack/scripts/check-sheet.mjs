#!/usr/bin/env node
// Checks a pdstack model sheet: every role has a line, every entry is
// inherit-parent, auto, a model ID, or `<family>:<model>` with an optional
// effort, every family entry has a `family <name>: <command>` line whose
// command holds `{model}`, and each panel names models from two vendors
// unless the sheet has `panel vendors: any`.
// Prints `sheet ok`, or `sheet invalid: <problems>` and exits 1.
// Usage: node check-sheet.mjs [sheet]
// The default sheet is GitHub Copilot's, as upstream has it.
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSheet, readSheet } from "./sheet.mjs";

const sheet = process.argv[2] ?? join(process.env.COPILOT_HOME || join(homedir(), ".copilot"), "pdstack-models.md");
const lines = readSheet(sheet);
if (lines === null) {
  console.log(`sheet invalid: cannot read ${sheet}`);
  process.exit(1);
}
const { problems } = parseSheet(lines);
if (problems.length) {
  console.log(`sheet invalid: ${problems.join("; ")}`);
  process.exit(1);
}
console.log("sheet ok");
