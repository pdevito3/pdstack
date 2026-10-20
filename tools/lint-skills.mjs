#!/usr/bin/env node
// Lints skill frontmatter, pdstack: references, and the manifest versions.
// Usage: node tools/lint-skills.mjs
import { resolve } from "node:path";
import { checkVersions, lintSkills } from "./lib/skills.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const errors = [...lintSkills(repoRoot), ...checkVersions(repoRoot)];
for (const error of errors) console.error(`lint: ${error}`);
if (errors.length) {
  console.error(`lint: ${errors.length} error(s)`);
  process.exit(1);
}
console.log("lint: ok");
