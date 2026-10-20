#!/usr/bin/env node
// Proves each provenance pin against its upstream text.
// Usage: node tools/check-provenance.mjs [--upstreams <dir>]
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkProvenance, Upstreams } from "./lib/provenance.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const { values } = parseArgs({ options: { upstreams: { type: "string", default: join(repoRoot, ".upstreams") } } });

const errors = checkProvenance(repoRoot, new Upstreams(resolve(values.upstreams)));
for (const error of errors) console.error(`provenance: ${error}`);
if (errors.length) {
  console.error(`provenance: ${errors.length} error(s)`);
  process.exit(1);
}
console.log("provenance: ok");
