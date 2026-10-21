import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyRenames, expectedText, loadProvenance, PLUGIN_ROOT, PSTACK_CLAUDE_ROOT, SOURCES, upstreamPathFor } from "./provenance.mjs";

export const CURSOR = "cursor/plugins";
export const PSTACK_CLAUDE = "michael-denyer/pstack-claude";

// The cursor folders that pstack-claude ports, and where they land in pstack-claude
// (pstack-claude tools/upstream.json).
export const CURSOR_PORTS = [
  ["pstack/", `${PSTACK_CLAUDE_ROOT}/`],
  ["cursor-team-kit/skills/", `${PSTACK_CLAUDE_ROOT}/skills/`],
  ["thermos/", `${PSTACK_CLAUDE_ROOT}/`],
];

const CHANGE_KINDS = { A: "added", M: "modified", D: "deleted", T: "modified" };

// The upstream folders that pdstack copies from. For a pinned source, the first three
// path segments of each pin, for example `plugins/pstack/skills` or `skills/productivity/wait-what`.
export function copiedFolders(provenance, source) {
  if (source === CURSOR) return CURSOR_PORTS.map(([folder]) => folder);
  const folders = new Set();
  for (const pin of Object.values(provenance.pins)) {
    if (pin.source === source) folders.add(pin.path.split("/").slice(0, 3).join("/"));
  }
  return [...folders].sort();
}

// Parses `git log --format=%x1e%H%x1f%aI%x1f%s --name-status --no-renames`.
export function parseLog(text) {
  const commits = [];
  for (const record of text.split("\x1e")) {
    if (!record.trim()) continue;
    const [header, ...lines] = record.split("\n");
    const [sha, date, subject] = header.split("\x1f");
    const files = [];
    for (const line of lines) {
      const match = /^([AMDT])\t(.+)$/.exec(line.replace(/\r$/, ""));
      if (match) files.push({ path: match[2], change: CHANGE_KINDS[match[1]] });
    }
    commits.push({ sha, date, subject, files });
  }
  return commits;
}

// The cursor sha that a pstack-claude "Sync to upstream <sha>" subject names, or null.
export function parseSyncSha(subject) {
  return /\bsync to upstream ([0-9a-f]{7,40})\b/i.exec(subject)?.[1] ?? null;
}

// forks.json is { component: { path: { why, ... } } }. Returns path -> why.
export function forkReasons(forks) {
  const reasons = {};
  for (const component of Object.values(forks ?? {})) {
    for (const [path, entry] of Object.entries(component)) reasons[path] = entry.why;
  }
  return reasons;
}

// Maps an upstream file to the pdstack files it feeds: through a pin first, then through
// the pstack-claude path rule, then through the folder of a pin of the same source.
export function createMapper(provenance, localExists) {
  const { pins, renames } = provenance;
  const byUpstream = new Map();
  const folders = [];
  for (const [local, pin] of Object.entries(pins)) {
    const key = `${pin.source}\0${pin.path}`;
    byUpstream.set(key, [...(byUpstream.get(key) ?? []), local]);
    folders.push({ source: pin.source, upstream: `${dirname(pin.path)}/`, local: `${dirname(local)}/` });
  }
  folders.sort((a, b) => b.upstream.length - a.upstream.length);

  const entry = (path) => ({ path, pin: pins[path] ?? null, exists: localExists(path) });

  return function map(source, path) {
    if (source === CURSOR) {
      const port = CURSOR_PORTS.find(([folder]) => path.startsWith(folder));
      if (!port) return [];
      return map(PSTACK_CLAUDE, port[1] + path.slice(port[0].length));
    }
    const pinned = byUpstream.get(`${source}\0${path}`);
    if (pinned) return pinned.map(entry);
    if (source === PSTACK_CLAUDE) {
      if (!path.startsWith(`${PSTACK_CLAUDE_ROOT}/`)) return [];
      const local = `${PLUGIN_ROOT}/${applyRenames(path.slice(PSTACK_CLAUDE_ROOT.length + 1), renames)}`;
      return upstreamPathFor(local, renames) === path ? [entry(local)] : [];
    }
    const folder = folders.find((f) => f.source === source && path.startsWith(f.upstream));
    return folder ? [entry(folder.local + path.slice(folder.upstream.length))] : [];
  };
}

// One feed report: one entry per upstream commit, with its files mapped to pdstack.
// `syncs` are the pstack-claude sync commits ({ sha, subject, cursorSha, reviewed }),
// oldest first, and `isAncestor(a, b)` tells if cursor commit a is at or before b.
export function buildFeedReport({ source, from, to, folders, commits, map, syncs = [], isAncestor, forks = {} }) {
  const changes = commits.map((commit) => {
    const change = {
      sha: commit.sha,
      subject: commit.subject,
      date: commit.date,
      files: commit.files.map((file) => ({ ...file, local: map(source, file.path) })),
    };
    if (source === CURSOR) {
      const by = syncs.find((sync) => isAncestor(commit.sha, sync.cursorSha));
      change.translation = by ? { state: "translated", by } : { state: "not translated" };
    }
    if (source === PSTACK_CLAUDE) {
      const syncOf = parseSyncSha(commit.subject);
      change.kind = syncOf ? "sync" : "own";
      if (syncOf) change.syncOf = syncOf;
      else {
        for (const file of change.files) if (forks[file.path]) file.forkReason = forks[file.path];
      }
    }
    return change;
  });
  return { source, from, to, folders, changes };
}

// A local path that has no pin, does not exist, and is not new upstream is only a guess: show "-".
function fileRow(file, local) {
  if (local?.pin) return `| ${file.change} | \`${file.path}\` | \`${local.path}\` | ${local.pin.hide ? `${local.pin.status}, hide` : local.pin.status} |`;
  if (local?.exists) return `| ${file.change} | \`${file.path}\` | \`${local.path}\` | pdstack file, no pin |`;
  if (local && file.change === "added") return `| ${file.change} | \`${file.path}\` | \`${local.path}\` | new upstream file, no pin |`;
  return `| ${file.change} | \`${file.path}\` | - | not copied |`;
}

const short = (sha) => sha.slice(0, 7);

export function renderMarkdown(report) {
  const out = ["# Upstream review", ""];
  for (const feed of report.feeds) {
    out.push(`## ${feed.source}`, "");
    out.push(`\`${short(feed.from)}..${short(feed.to)}\` in ${feed.folders.map((f) => `\`${f}\``).join(", ")}. ${feed.changes.length === 1 ? "1 change" : `${feed.changes.length} changes`}.`, "");
    for (const change of feed.changes) {
      out.push(`### ${short(change.sha)} ${change.subject}`, "", `Date: ${change.date.slice(0, 10)}`);
      if (change.translation) {
        const { by } = change.translation;
        out.push(
          by
            ? `Translation: translated by ${PSTACK_CLAUDE} ${short(by.sha)} (${by.subject})${by.reviewed ? ", already in the reviewed position" : ""}`
            : "Translation: not translated yet",
        );
      }
      if (change.kind === "sync") out.push(`Kind: sync of ${CURSOR} ${change.syncOf}`);
      if (change.kind === "own") out.push("Kind: pstack-claude change of its own");
      out.push("", "| Change | Upstream file | pdstack file | Pin |", "| --- | --- | --- | --- |");
      for (const file of change.files) {
        for (const local of file.local.length ? file.local : [null]) out.push(fileRow(file, local));
      }
      const reasons = change.files.filter((file) => file.forkReason);
      if (reasons.length) {
        out.push("", "Fork reasons:", "");
        for (const file of reasons) out.push(`- \`${file.path}\`: ${file.forkReason}`);
      }
      out.push("");
    }
    if (!feed.changes.length) out.push("No changes.", "");
  }
  return out.join("\n");
}

function git(dir, args) {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trimEnd();
}

function isAncestorIn(dir, a, b) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: dir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function resolveSha(dir, sha) {
  try {
    return git(dir, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`]);
  } catch {
    return null;
  }
}

function requireSha(dir, source, sha) {
  const full = resolveSha(dir, sha);
  if (!full) throw new Error(`${source} has no commit ${sha}`);
  return full;
}

// Fetches the feeds and builds the report. `from` and `to` map a source to a sha that
// overrides its feed position or its remote HEAD.
export function collectUpstreamDiff({ repoRoot, upstreams, feeds = SOURCES, from = {}, to = {} }) {
  const provenance = loadProvenance(repoRoot);
  const fetched = new Map();
  const head = (source) => {
    if (!fetched.has(source)) {
      const dir = upstreams.repoDir(source);
      git(dir, ["fetch", "--quiet", "origin"]);
      fetched.set(source, { dir, to: requireSha(dir, source, to[source] ?? "origin/HEAD") });
    }
    return fetched.get(source);
  };

  const syncs = [];
  let forks = {};
  if (feeds.includes(CURSOR) || feeds.includes(PSTACK_CLAUDE)) {
    const pc = head(PSTACK_CLAUDE);
    forks = forkReasons(JSON.parse(upstreams.show(PSTACK_CLAUDE, pc.to, "tools/forks.json") ?? "{}"));
    if (feeds.includes(CURSOR)) {
      const cursorDir = head(CURSOR).dir;
      const reviewedAt = from[PSTACK_CLAUDE] ?? provenance.feeds[PSTACK_CLAUDE];
      const log = git(pc.dir, ["log", "--reverse", "-i", "--grep=sync to upstream", "--format=%H%x1f%s", pc.to]);
      for (const line of log ? log.split("\n") : []) {
        const [sha, subject] = line.split("\x1f");
        const cursorSha = resolveSha(cursorDir, parseSyncSha(subject) ?? "");
        if (cursorSha) syncs.push({ sha, subject, cursorSha, reviewed: isAncestorIn(pc.dir, sha, reviewedAt) });
      }
    }
  }

  const report = { feeds: [] };
  for (const source of feeds) {
    const { dir, to: toSha } = head(source);
    const position = from[source] ?? provenance.feeds[source];
    const fromSha = requireSha(dir, source, position);
    const folders = copiedFolders(provenance, source);
    const log = git(dir, ["log", "--reverse", "--no-merges", "--no-renames", "--name-status", "--format=%x1e%H%x1f%aI%x1f%s", `${fromSha}..${toSha}`, "--", ...folders]);
    report.feeds.push(
      buildFeedReport({
        source,
        from: fromSha,
        to: toSha,
        folders,
        commits: parseLog(log),
        map: createMapper(provenance, (path) => existsSync(join(repoRoot, path))),
        syncs,
        isAncestor: (a, b) => isAncestorIn(dir, a, b),
        forks,
      }),
    );
  }
  return report;
}

// Copies one verbatim or renamed file again from its source at `sha` and moves its pin there.
export function applyPin({ repoRoot, upstreams, local, sha }) {
  const provenance = loadProvenance(repoRoot);
  const pin = provenance.pins[local];
  if (!pin) throw new Error(`${local}: no pin. Add a pin with source, path, and status first.`);
  if (pin.status === "modified") throw new Error(`${local}: a modified pin is re-applied by hand, with its why as the guide`);
  const fullSha = requireSha(upstreams.ensureSha(pin.source, sha), pin.source, sha);
  const upstream = upstreams.show(pin.source, fullSha, pin.path);
  if (upstream === null) throw new Error(`${local}: ${pin.source}@${short(fullSha)} has no ${pin.path}`);
  const file = join(repoRoot, local);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, expectedText(upstream, pin, provenance.renames, provenance.drops));
  pin.sha = fullSha;
  writeFileSync(join(repoRoot, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  return fullSha;
}
