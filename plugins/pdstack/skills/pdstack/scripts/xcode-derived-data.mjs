#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Xcode names the folder <name>-<hash>. The hash is the MD5 of the path that Xcode opened, each 8-byte half read as a
// big-endian integer in 14 base-26 letters.
export function folderHash(workspacePath) {
  const digest = createHash("md5").update(workspacePath).digest();
  const letters = (half) => {
    let value = half.readBigUInt64BE(0);
    let out = "";
    for (let i = 0; i < 14; i++) {
      out = String.fromCharCode(97 + Number(value % 26n)) + out;
      value /= 26n;
    }
    return out;
  };
  return letters(digest.subarray(0, 8)) + letters(digest.subarray(8, 16));
}

// Xcode hashes /var and /tmp paths without the /private prefix that realpath gives them.
const xcodeForms = (path) => (path.startsWith("/private/") ? [path, path.slice("/private".length)] : [path]);

export function workspacePaths(worktree, trackedFiles) {
  const paths = new Set();
  for (const file of trackedFiles) {
    const bundle = /^(.*?\.(?:xcodeproj|xcworkspace))\//.exec(file);
    if (bundle) paths.add(join(worktree, bundle[1]));
    const manifest = /^(?:(.*)\/)?Package\.swift$/.exec(file);
    if (manifest) paths.add(manifest[1] ? join(worktree, manifest[1]) : worktree);
  }
  return [...paths];
}

export function derivedDataRoot() {
  try {
    const custom = execFileSync("defaults", ["read", "com.apple.dt.Xcode", "IDECustomDerivedDataLocation"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (custom) return custom;
  } catch {}
  return join(homedir(), "Library", "Developer", "Xcode", "DerivedData");
}

function recordedWorkspace(folder) {
  try {
    return execFileSync("plutil", ["-extract", "WorkspacePath", "raw", "-o", "-", join(folder, "info.plist")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// A folder that has only Logs and TestResults has no info.plist, so only its name finds it.
export function foldersForWorktree(worktree, root = derivedDataRoot()) {
  if (!existsSync(root)) return [];
  const tracked = execFileSync("git", ["-C", worktree, "ls-files", "-z"], { encoding: "utf8" }).split("\0");
  const hashes = new Set(workspacePaths(worktree, tracked).flatMap(xcodeForms).map(folderHash));
  const inside = worktree.endsWith(sep) ? worktree : worktree + sep;
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((folder) => hashes.has(basename(folder).split("-").at(-1)) || recordedWorkspace(folder)?.startsWith(inside));
}

export function orphanFolders(root = derivedDataRoot()) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((folder) => {
      const workspace = recordedWorkspace(folder);
      return workspace !== null && !existsSync(workspace);
    });
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
  const args = process.argv.slice(2);
  const remove = args.includes("--delete");
  const rest = args.filter((arg) => arg !== "--delete");
  if (rest.length === 0) {
    console.error("usage: xcode-derived-data.mjs [--delete] (--orphans | <worktree>...)");
    process.exit(2);
  }
  const folders = rest[0] === "--orphans"
    ? orphanFolders()
    : rest.flatMap((path) => foldersForWorktree(realpathSync(resolve(path))));
  for (const folder of folders) console.log(folder);
  if (remove) for (const folder of folders) rmSync(folder, { recursive: true, force: true });
}
