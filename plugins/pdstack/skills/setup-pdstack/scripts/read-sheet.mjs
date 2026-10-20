#!/usr/bin/env node
// Decodes the sheet once, before any consumer interprets its lines. PowerShell
// 5.1 writes UTF-16LE; other writers may add a UTF-8 BOM or CRLF line endings.
// Prints the decoded sheet, or exits 1 when it cannot be read.
// Usage: node read-sheet.mjs <sheet>
import { readSheet } from "./sheet.mjs";

const sheet = process.argv[2];
const lines = sheet === undefined ? null : readSheet(sheet);
if (lines === null) process.exit(1);
process.stdout.write(`${lines.join("\n")}\n`);
