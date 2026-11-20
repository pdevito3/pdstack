import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { folderHash, foldersForWorktree, orphanFolders, workspacePaths } from "./xcode-derived-data.mjs";

test("folderHash matches the hash in the name of the folder that Xcode made", () => {
  // `xcodebuild -showBuildSettings` in a Swift package at /tmp/Demo made Demo-dgbnrvmisyrsnvgglqgkiarkuoui, Xcode 26.
  assert.equal(folderHash("/tmp/Demo"), "dgbnrvmisyrsnvgglqgkiarkuoui");
});

test("workspacePaths finds each tracked project, workspace, and Swift package", () => {
  const files = ["App.xcodeproj/project.pbxproj", "App.xcodeproj/project.xcworkspace/contents.xcworkspacedata",
    "App.xcworkspace/contents.xcworkspacedata", "Sources/main.swift", "Pods/Pods.xcodeproj/project.pbxproj",
    "Package.swift", "Modules/Core/Package.swift"];
  assert.deepEqual(workspacePaths("/wt", files).sort(),
    ["/wt", "/wt/App.xcodeproj", "/wt/App.xcworkspace", "/wt/Modules/Core", "/wt/Pods/Pods.xcodeproj"]);
});

describe("against a real worktree and DerivedData folder", { skip: process.platform === "win32" }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "derived-data-")));
  after(() => rmSync(root, { recursive: true, force: true }));
  const worktree = join(root, "wt");
  mkdirSync(join(worktree, "App.xcodeproj"), { recursive: true });
  writeFileSync(join(worktree, "App.xcodeproj", "project.pbxproj"), "");
  execFileSync("git", ["init", "--quiet", worktree]);
  execFileSync("git", ["-C", worktree, "add", "."]);
  const derived = join(root, "DerivedData");
  writeFileSync(join(worktree, "Package.swift"), "");
  execFileSync("git", ["-C", worktree, "add", "."]);
  const project = join(derived, `App-${folderHash(join(worktree, "App.xcodeproj"))}`);
  // Xcode drops the /private that realpath adds on macOS.
  const pkg = join(derived, `Pkg-${folderHash(worktree.replace(/^\/private\//, "/"))}`);
  const other = join(derived, `App-${folderHash("/elsewhere/App.xcodeproj")}`);
  for (const folder of [project, pkg, other]) mkdirSync(join(folder, "Logs"), { recursive: true });

  test("foldersForWorktree finds the worktree's folders by hash and leaves other projects", () => {
    assert.deepEqual(foldersForWorktree(worktree, derived).sort(), [project, pkg].sort());
    assert.deepEqual(foldersForWorktree(worktree, join(root, "missing")), []);
  });

  test("orphanFolders finds a folder whose recorded workspace is gone", { skip: process.platform !== "darwin" }, () => {
    const gone = join(derived, "Gone-abc");
    mkdirSync(gone);
    execFileSync("plutil", ["-create", "xml1", join(gone, "info.plist")]);
    execFileSync("plutil", ["-insert", "WorkspacePath", "-string", join(root, "gone", "Gone.xcodeproj"), join(gone, "info.plist")]);
    assert.deepEqual(orphanFolders(derived), [gone]);
  });
});
