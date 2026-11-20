#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { realpathSync, rmSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { DISPOSABLE } from "./worktree-audit.mjs";
import { foldersForWorktree } from "./xcode-derived-data.mjs";

// `--porcelain -z` output: NUL-separated fields, one record per worktree, the primary worktree first.
export function parseWorktrees(output) {
  const worktrees = [];
  for (const field of output.split("\0")) {
    if (field.startsWith("worktree ")) {
      worktrees.push({ path: field.slice("worktree ".length), branch: null, bare: false, prunable: false, locked: null });
    } else if (field === "bare") worktrees.at(-1).bare = true; else if (field.startsWith("branch refs/heads/")) worktrees.at(-1).branch = field.slice("branch refs/heads/".length);
    else if (field.startsWith("prunable")) worktrees.at(-1).prunable = true;
    else if (field.startsWith("locked")) worktrees.at(-1).locked = field.slice("locked ".length);
  }
  return worktrees;
}

export function plan({ pr, worktrees, localTip, localInPr, remoteTip, reflogOnly }) {
  const done = [];
  const held = [];
  if (pr.state !== "MERGED") {
    held.push({ target: `PR #${pr.number}`, reason: `PR is ${pr.state}, not merged` });
    return { done, held };
  }
  const branch = pr.headRefName;
  const lost = reflogOnly > 0
    ? `${reflogOnly} commit(s) that only a reflog reaches; keep them with git branch <name> <sha> first`
    : null;
  let branchFree = true;
  for (const tree of worktrees.filter((tree) => tree.branch === branch)) {
    const reason = tree.primary
      ? `the primary checkout is on ${branch}; switch it to ${pr.baseRefName}`
      : tree.locked !== null
        ? `worktree is locked: ${tree.locked || "no reason given"}`
        : tree.dirty.length
          ? `worktree has uncommitted work: ${tree.dirty.join(", ")}`
          : lost;
    if (reason) {
      held.push({ target: tree.path, reason });
      branchFree = false;
    } else {
      done.push({ action: "remove-worktree", path: tree.path });
      for (const folder of tree.derivedData) done.push({ action: "remove-derived-data", path: folder });
    }
  }
  if (localTip) {
    if (!localInPr) held.push({ target: branch, reason: "local branch has commits that are not in the merged PR" });
    else if (!branchFree) held.push({ target: branch, reason: "a held worktree still holds the local branch" });
    else if (lost) held.push({ target: branch, reason: lost });
    else done.push({ action: "delete-local-branch", branch });
  }
  if (remoteTip && !pr.isCrossRepository) {
    if (remoteTip === pr.headRefOid) done.push({ action: "delete-remote-branch", branch, expect: remoteTip });
    else held.push({ target: `origin/${branch}`, reason: "remote branch moved after the merge" });
  }
  const trunk = worktrees.find((tree) => tree.branch === pr.baseRefName);
  if (trunk?.modified.length) {
    held.push({ target: trunk.path, reason: `trunk checkout has uncommitted changes: ${trunk.modified.join(", ")}` });
  } else done.push({ action: "update-trunk", branch: pr.baseRefName, path: trunk?.path ?? null });
  return { done, held };
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: Infinity })
    .replace(/\n+$/, "");
}

function succeeds(run) {
  try {
    run();
    return true;
  } catch {
    return false;
  }
}

export function rebuildable(name) {
  return name.split("/").some((part) => DISPOSABLE.has(part));
}

// `--porcelain -z` records: "XY path", and a rename or copy adds its source path as the next field.
export function parseStatus(output) {
  const fields = output.split("\0");
  const entries = [];
  for (let i = 0; i < fields.length; i++) {
    if (!fields[i]) continue;
    const kind = fields[i].slice(0, 2);
    entries.push({ kind, name: fields[i].slice(3) });
    if (kind[0] === "R" || kind[0] === "C") i++;
  }
  return entries;
}

// An ignored folder that is not build output is listed file by file, so an empty one holds nothing.
function status(path) {
  const entries = parseStatus(git(path, "status", "--porcelain", "-z", "--untracked-files=all", "--ignored=matching", "--ignore-submodules=none"))
    .flatMap((entry) =>
      entry.kind === "!!" && entry.name.endsWith("/") && !rebuildable(entry.name)
        ? git(path, "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", entry.name)
          .split("\0")
          .filter(Boolean)
          .map((name) => ({ kind: "!!", name }))
        : [entry])
    .filter(({ kind, name }) => kind !== "!!" || !rebuildable(name));
  return {
    dirty: entries.map(({ name }) => name),
    modified: entries.filter(({ kind }) => kind !== "??" && kind !== "!!").map(({ name }) => name),
  };
}

function readFacts(cwd, number) {
  const pr = JSON.parse(execFileSync("gh", ["pr", "view", number, "--json",
    "number,state,headRefName,headRefOid,baseRefName,isCrossRepository"], { cwd, encoding: "utf8" }));
  const records = parseWorktrees(git(cwd, "worktree", "list", "--porcelain", "-z"));
  const repo = records[0].path;
  const worktrees = records
    .map((tree, index) => ({ ...tree, primary: index === 0 }))
    .filter((tree) => !tree.bare && !tree.prunable && [pr.headRefName, pr.baseRefName].includes(tree.branch))
    .map((tree) => ({ ...tree, ...status(tree.path) }));
  for (const tree of worktrees) tree.derivedData = tree.branch === pr.headRefName ? foldersForWorktree(tree.path) : [];
  const localTip = succeeds(() => git(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${pr.headRefName}`))
    ? git(repo, "rev-parse", `refs/heads/${pr.headRefName}`)
    : null;
  if (localTip && !succeeds(() => git(repo, "cat-file", "-e", `${pr.headRefOid}^{commit}`))) {
    git(repo, "fetch", "--no-tags", "--no-write-fetch-head", "origin", `refs/pull/${pr.number}/head`);
  }
  const localInPr = localTip !== null && succeeds(() => git(repo, "merge-base", "--is-ancestor", localTip, pr.headRefOid));
  const remoteTip = /^([0-9a-f]+)\t/.exec(git(repo, "ls-remote", "--heads", "origin", `refs/heads/${pr.headRefName}`))?.[1] ?? null;
  const reflogOnly = countReflogOnly(repo, pr, worktrees.filter((tree) => tree.branch === pr.headRefName));
  return { repo, facts: { pr, worktrees, localTip, localInPr, remoteTip, reflogOnly } };
}

// Commits that removing the worktrees and deleting the branch would leave unreachable: those in
// their HEAD and branch reflogs that no other ref reaches. Commits pushed to the PR branch stay on the forge.
function countReflogOnly(repo, pr, trees) {
  const walk = (cwd, ref) => {
    try {
      return git(cwd, "rev-list", "--walk-reflogs", ref).split("\n").filter(Boolean);
    } catch {
      return [];
    }
  };
  const branch = `refs/heads/${pr.headRefName}`;
  const tracking = `refs/remotes/origin/${pr.headRefName}`;
  const candidates = new Set([...trees.flatMap((tree) => walk(tree.path, "HEAD")), ...walk(repo, branch)]);
  if (!candidates.size) return 0;
  const kept = git(repo, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags", "refs/remotes")
    .split("\n")
    .filter((ref) => ref && ref !== branch && ref !== tracking);
  const input = [...candidates, `^${pr.headRefOid}`, ...walk(repo, tracking).map((sha) => `^${sha}`), ...kept.map((ref) => `^${ref}`)];
  return Number(execFileSync("git", ["rev-list", "--count", "--stdin"], {
    cwd: repo, encoding: "utf8", input: `${input.join("\n")}\n`, stdio: ["pipe", "pipe", "pipe"], maxBuffer: Infinity,
  }).trim());
}

const ACTIONS = {
  "remove-worktree": (repo, { path }) => git(repo, "worktree", "remove", "--force", path),
  "remove-derived-data": (repo, { path }) => rmSync(path, { recursive: true, force: true }),
  "delete-local-branch": (repo, { branch }) => git(repo, "branch", "-D", branch),
  "delete-remote-branch": (repo, { branch, expect }) =>
    git(repo, "push", `--force-with-lease=refs/heads/${branch}:${expect}`, "origin", "--delete", branch),
  "update-trunk": (repo, { branch, path }) =>
    path
      ? git(path, "pull", "--ff-only", "origin", branch)
      : git(repo, "fetch", "origin", `refs/heads/${branch}:refs/heads/${branch}`),
};

function main(argv) {
  if (argv.length !== 1 || !/^\d+$/.test(argv[0])) {
    console.error("usage: post-merge-cleanup.mjs <pr>");
    return 2;
  }
  let repo;
  let facts;
  try {
    ({ repo, facts } = readFacts(process.cwd(), argv[0]));
  } catch (error) {
    console.error(`post-merge-cleanup: ${error.stderr?.toString().trim() || error.message}`);
    return 2;
  }
  const { done, held } = plan(facts);
  const report = { pr: facts.pr.number, done: [], held };
  for (const step of done) {
    try {
      ACTIONS[step.action](repo, step);
      report.done.push(step);
    } catch (error) {
      held.push({ target: step.path ?? step.branch, reason: `${step.action} failed: ${error.stderr?.toString().trim() || error.message}` });
    }
  }
  console.log(JSON.stringify(report, null, 2));
  return held.length ? 1 : 0;
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
