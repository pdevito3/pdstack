#!/usr/bin/env node
// Diffs each upstream feed from its reviewed position to the remote HEAD, grouped by upstream commit.
// Usage:
//   node tools/upstream-diff.mjs [--json] [--feed <source>] [--to <sha>] [--from-feed <source>=<sha>]... [--upstreams <dir>]
//   node tools/upstream-diff.mjs --apply <local-path> --to <sha> [--upstreams <dir>]
// --to needs --feed in a diff. --from-feed overrides a feed position for this run only.
// --apply copies one verbatim or renamed file again from its source at <sha> and moves its pin.
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SOURCES, Upstreams } from "./lib/provenance.mjs";
import { applyPin, collectUpstreamDiff, renderMarkdown } from "./lib/upstream-diff.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    upstreams: { type: "string", default: join(repoRoot, ".upstreams") },
    feed: { type: "string" },
    to: { type: "string" },
    "from-feed": { type: "string", multiple: true, default: [] },
    json: { type: "boolean", default: false },
    apply: { type: "string" },
  },
});

function fail(message) {
  console.error(`upstream-diff: ${message}`);
  process.exit(1);
}

const upstreams = new Upstreams(resolve(values.upstreams));

if (values.apply) {
  if (!values.to) fail("--apply needs --to <sha>");
  try {
    const sha = applyPin({ repoRoot, upstreams, local: values.apply, sha: values.to });
    console.log(`upstream-diff: ${values.apply} copied from ${sha}`);
  } catch (error) {
    fail(error.message);
  }
  process.exit(0);
}

if (values.feed && !SOURCES.includes(values.feed)) fail(`unknown feed ${values.feed}. Feeds: ${SOURCES.join(", ")}`);
if (values.to && !values.feed) fail("--to needs --feed");
const from = {};
for (const pair of values["from-feed"]) {
  const at = pair.lastIndexOf("=");
  const source = pair.slice(0, at);
  if (at < 0 || !SOURCES.includes(source)) fail(`--from-feed needs <source>=<sha>, got ${pair}`);
  from[source] = pair.slice(at + 1);
}

let report;
try {
  report = collectUpstreamDiff({
    repoRoot,
    upstreams,
    feeds: values.feed ? [values.feed] : SOURCES,
    from,
    to: values.feed && values.to ? { [values.feed]: values.to } : {},
  });
} catch (error) {
  fail(error.message);
}
console.log(values.json ? JSON.stringify(report, null, 2) : renderMarkdown(report));
