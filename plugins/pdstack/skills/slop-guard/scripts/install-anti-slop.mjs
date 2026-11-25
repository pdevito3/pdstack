#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { readGuard } from "./guard.mjs";

/** @typedef {Map<string, Buffer>} FileSet */

/**
 * @typedef {{ kind: "install", files: FileSet }
 *   | { kind: "record" }
 *   | { kind: "noop" }
 *   | { kind: "refuse", paths: string[], recordedSha: string | null }} InstallPlan
 */

export const ASSETS_PATH = "skills/install-anti-slop/assets/anti-slop";
export const DEST = "tools/oxlint/anti-slop";
const RECORD = "UPSTREAM.md";

const normalized = (buffer) => buffer.toString("utf8").replaceAll("\r\n", "\n");

/**
 * @param {FileSet} incoming
 * @param {FileSet | null} local
 * @param {string | null} recordedSha
 * @param {string} sha
 * @returns {InstallPlan}
 */
export function planInstall(incoming, local, recordedSha, sha) {
  if (local === null) return { kind: "install", files: incoming };
  const paths = [...new Set([...incoming.keys(), ...local.keys()])].sort();
  const changed = paths.filter((path) => !incoming.has(path) || !local.has(path) || normalized(incoming.get(path)) !== normalized(local.get(path)));
  if (changed.length) return { kind: "refuse", paths: changed, recordedSha };
  return recordedSha === sha ? { kind: "noop" } : { kind: "record" };
}

/** @param {{ repo: string, sha: string }} antiSlop @param {string} today */
export function upstreamRecord(antiSlop, today) {
  return [
    "# anti-slop upstream",
    "",
    "pdstack slop-guard vendored this plugin with `install-anti-slop.mjs`. That script refuses to run over a changed file here.",
    "",
    `- Repository: ${antiSlop.repo}`,
    `- Commit: ${antiSlop.sha}`,
    `- Path: ${ASSETS_PATH}/, and LICENSE from the repository root`,
    `- Installed: ${today}`,
    "- Deviations: none",
    "",
  ].join("\n");
}

export function recordedShaOf(text) {
  return /^- Commit: ([0-9a-f]{40})$/m.exec(text)?.[1] ?? null;
}

/** @param {InstallPlan} plan @param {{ repo: string, sha: string }} antiSlop */
export function planMessage(plan, antiSlop) {
  const short = antiSlop.sha.slice(0, 12);
  switch (plan.kind) {
    case "install":
      return `installed anti-slop ${short} at ${DEST} (${plan.files.size} files) and wrote ${RECORD}`;
    case "record":
      return `${DEST} matches anti-slop ${short}. Wrote ${RECORD}.`;
    case "noop":
      return `anti-slop ${short} is already installed at ${DEST}. Nothing changed.`;
    case "refuse": {
      const from = plan.recordedSha && plan.recordedSha !== antiSlop.sha ? `was installed from ${plan.recordedSha.slice(0, 12)} and ` : "";
      return [
        `refused: ${DEST} ${from}differs from anti-slop ${short} in these files:`,
        ...plan.paths.map((path) => `  ${path}`),
        "Keep a local edit, and merge upstream by hand per anti-slop's references/update.md. To take upstream as it is, remove the directory and run this again.",
      ].join("\n");
    }
  }
}

function git(args, options = {}) {
  return execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...options });
}

/** @param {{ repo: string, sha: string }} antiSlop @returns {FileSet} */
export function fetchPlugin(antiSlop) {
  const dir = mkdtempSync(join(tmpdir(), "anti-slop-"));
  try {
    git(["init", "--quiet", dir]);
    git(["fetch", "--quiet", "--depth", "1", antiSlop.repo, antiSlop.sha], { cwd: dir });
    const fetched = git(["rev-parse", "FETCH_HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    if (fetched !== antiSlop.sha) throw new Error(`fetched ${fetched}, not ${antiSlop.sha}`);
    const blob = (oid) => git(["cat-file", "blob", oid], { cwd: dir });
    const files = new Map();
    const tree = git(["ls-tree", "-r", "-z", "FETCH_HEAD", "--", `${ASSETS_PATH}/`, "LICENSE"], { cwd: dir, encoding: "utf8" });
    for (const entry of tree.split("\0").filter(Boolean)) {
      const [meta, path] = entry.split("\t");
      const oid = meta.split(" ")[2];
      files.set(path === "LICENSE" ? path : path.slice(ASSETS_PATH.length + 1), blob(oid));
    }
    if (!files.has("index.ts")) throw new Error(`${antiSlop.sha} has no ${ASSETS_PATH}/index.ts`);
    return files;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** @param {string} dir @returns {FileSet} */
function readTree(dir) {
  const files = new Map();
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.set(relative(dir, full).split(sep).join("/"), readFileSync(full));
    }
  };
  walk(dir);
  files.delete(RECORD);
  return files;
}

/** @param {FileSet} files @param {string} dir */
function writeTree(files, dir) {
  for (const [path, content] of files) {
    const target = join(dir, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

/**
 * @param {string} repoRoot
 * @param {{ repo: string, sha: string }} antiSlop
 * @param {string} today
 * @returns {InstallPlan}
 */
export function installAntiSlop(repoRoot, antiSlop, today) {
  const dest = join(repoRoot, ...DEST.split("/"));
  const recordPath = join(dest, RECORD);
  const local = existsSync(dest) ? readTree(dest) : null;
  const recordedSha = existsSync(recordPath) ? recordedShaOf(readFileSync(recordPath, "utf8")) : null;
  const plan = planInstall(fetchPlugin(antiSlop), local, recordedSha, antiSlop.sha);
  if (plan.kind === "install") {
    const partial = `${dest}.partial`;
    rmSync(partial, { recursive: true, force: true });
    writeTree(plan.files, partial);
    writeFileSync(join(partial, RECORD), upstreamRecord(antiSlop, today));
    renameSync(partial, dest);
  }
  if (plan.kind === "record") writeFileSync(recordPath, upstreamRecord(antiSlop, today));
  return plan;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!process.argv[2]) {
    console.error("usage: node install-anti-slop.mjs <repo-root>");
    process.exit(2);
  }
  const { antiSlop } = readGuard();
  const plan = installAntiSlop(resolve(process.argv[2]), antiSlop, new Date().toISOString().slice(0, 10));
  console.log(planMessage(plan, antiSlop));
  process.exitCode = plan.kind === "refuse" ? 1 : 0;
}
