import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, describe, test } from "node:test";

import { parseStatus, parseWorktrees, plan, rebuildable } from "./post-merge-cleanup.mjs";

const pr = { number: 7, state: "MERGED", headRefName: "feat", headRefOid: "f1", baseRefName: "main", isCrossRepository: false };
const tree = (path, branch, extra = {}) => ({ path, branch, locked: null, prunable: false, primary: false, dirty: [], modified: [], derivedData: [], ...extra });
const facts = (extra = {}) => ({
  pr,
  worktrees: [tree("/repo", "main", { primary: true }), tree("/wt/feat", "feat")],
  localTip: "f1",
  localInPr: true,
  remoteTip: "f1",
  reflogOnly: 0,
  ...extra,
});

describe("plan", () => {
  test("removes the worktree, deletes both branches, and updates trunk after a merge", () => {
    assert.deepEqual(plan(facts()), {
      done: [
        { action: "remove-worktree", path: "/wt/feat" },
        { action: "delete-local-branch", branch: "feat" },
        { action: "delete-remote-branch", branch: "feat", expect: "f1" },
        { action: "update-trunk", branch: "main", path: "/repo" },
      ],
      held: [],
    });
  });

  test("holds the worktree and the branch while a reflog holds the only copy of a commit", () => {
    const { held, done } = plan(facts({ reflogOnly: 1 }));
    assert.deepEqual(held.map((item) => item.target), ["/wt/feat", "feat"]);
    assert.match(held[0].reason, /^1 commit\(s\) that only a reflog reaches/);
    assert.ok(!done.some((step) => step.action === "remove-worktree" || step.action === "delete-local-branch"));
  });

  test("deletes the Xcode DerivedData of a removed worktree, and keeps it for a held one", () => {
    const xcode = (extra) => [tree("/repo", "main", { primary: true }), tree("/wt/feat", "feat", { derivedData: ["/dd/App-abc"], ...extra })];
    assert.deepEqual(plan(facts({ worktrees: xcode() })).done.slice(0, 2), [
      { action: "remove-worktree", path: "/wt/feat" },
      { action: "remove-derived-data", path: "/dd/App-abc" },
    ]);
    assert.ok(!plan(facts({ worktrees: xcode({ dirty: ["todo.md"] }) })).done.some((step) => step.action === "remove-derived-data"));
  });

  test("holds everything until the PR reads merged", () => {
    assert.deepEqual(plan(facts({ pr: { ...pr, state: "OPEN" } })), {
      done: [],
      held: [{ target: "PR #7", reason: "PR is OPEN, not merged" }],
    });
  });

  test("holds a dirty or locked worktree and the branch it holds", () => {
    const dirty = plan(facts({ worktrees: [tree("/repo", "main", { primary: true }), tree("/wt/feat", "feat", { dirty: ["todo.md"] })] }));
    assert.deepEqual(dirty.held, [
      { target: "/wt/feat", reason: "worktree has uncommitted work: todo.md" },
      { target: "feat", reason: "a held worktree still holds the local branch" },
    ]);
    const locked = plan(facts({ worktrees: [tree("/repo", "main", { primary: true }), tree("/wt/feat", "feat", { locked: "agent" })] }));
    assert.equal(locked.held[0].reason, "worktree is locked: agent");
  });

  test("keeps a local branch with commits the PR does not have", () => {
    assert.deepEqual(plan(facts({ localTip: "f2", localInPr: false })).held, [
      { target: "feat", reason: "local branch has commits that are not in the merged PR" },
    ]);
  });

  test("keeps a remote branch that moved after the merge, and leaves a fork's branch alone", () => {
    assert.deepEqual(plan(facts({ remoteTip: "f3" })).held, [{ target: "origin/feat", reason: "remote branch moved after the merge" }]);
    const fork = plan(facts({ pr: { ...pr, isCrossRepository: true } }));
    assert.ok(!fork.done.some((step) => step.action === "delete-remote-branch"));
  });

  test("holds trunk for a changed tracked file but not for an untracked one, and updates the ref when no checkout has it", () => {
    const changed = plan(facts({ worktrees: [tree("/repo", "main", { primary: true, dirty: ["a.txt"], modified: ["a.txt"] })] }));
    assert.deepEqual(changed.held, [{ target: "/repo", reason: "trunk checkout has uncommitted changes: a.txt" }]);
    const untracked = plan(facts({ worktrees: [tree("/repo", "main", { primary: true, dirty: [".DS_Store"] })] }));
    assert.deepEqual(untracked.held, []);
    const noCheckout = plan(facts({ worktrees: [tree("/repo", "other", { primary: true })] }));
    assert.deepEqual(noCheckout.done.at(-1), { action: "update-trunk", branch: "main", path: null });
  });

  test("does nothing but update trunk on a rerun", () => {
    const rerun = plan(facts({ worktrees: [tree("/repo", "main", { primary: true })], localTip: null, localInPr: false, remoteTip: null }));
    assert.deepEqual(rerun, { done: [{ action: "update-trunk", branch: "main", path: "/repo" }], held: [] });
  });
});

test("rebuildable accepts build output and not user files", () => {
  assert.ok(rebuildable("build/App.o"));
  assert.ok(rebuildable("Modules/Core/.build/debug"));
  assert.ok(!rebuildable(".swiftpm/configuration/registries.json"));
  assert.ok(!rebuildable(".env"));
});

test("parseStatus keeps names exact and skips the source path of a rename", () => {
  assert.deepEqual(parseStatus(["!! notes-café/", "R  new.txt", "old.txt", "?? a b.txt", ""].join("\0")), [
    { kind: "!!", name: "notes-café/" },
    { kind: "R ", name: "new.txt" },
    { kind: "??", name: "a b.txt" },
  ]);
});

test("parseWorktrees reads path, branch, lock, and prune state", () => {
  const output = ["worktree /repo", "HEAD a", "branch refs/heads/main", "", "worktree /wt/x", "HEAD b", "detached", "locked", "",
    "worktree /wt/y", "HEAD c", "branch refs/heads/y", "prunable gitdir file points to non-existent location", ""].join("\0");
  assert.deepEqual(parseWorktrees(output), [
    { path: "/repo", branch: "main", bare: false, prunable: false, locked: null },
    { path: "/wt/x", branch: null, bare: false, prunable: false, locked: "" },
    { path: "/wt/y", branch: "y", bare: false, prunable: true, locked: null },
  ]);
});

describe("post-merge-cleanup.mjs against real repositories", { skip: process.platform === "win32" }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "post-merge-")));
  after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "gitconfig"), "");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  function scenario(name, { amend = false } = {}) {
    const dir = join(root, name);
    mkdirSync(dir);
    const origin = join(dir, "origin.git");
    git(dir, "init", "--quiet", "--bare", "--initial-branch=main", origin);
    const repo = join(dir, "repo");
    git(dir, "clone", "--quiet", origin, repo);
    writeFileSync(join(repo, "a.txt"), "a\n");
    git(repo, "add", "a.txt");
    git(repo, "commit", "--quiet", "-m", "base");
    git(repo, "push", "--quiet", "origin", "main");
    const worktree = join(dir, "worktrees", "feat");
    git(repo, "worktree", "add", "--quiet", "-b", "feat", worktree);
    writeFileSync(join(worktree, "b.txt"), "b\n");
    git(worktree, "add", "b.txt");
    git(worktree, "commit", "--quiet", "-m", "feat");
    if (amend) git(worktree, "commit", "--quiet", "--amend", "-m", "feat, amended");
    git(worktree, "push", "--quiet", "origin", "feat");
    const head = git(worktree, "rev-parse", "HEAD");
    const merger = join(dir, "merger");
    git(dir, "clone", "--quiet", origin, merger);
    git(merger, "merge", "--quiet", "--squash", "origin/feat");
    git(merger, "commit", "--quiet", "-m", "feat (#7)");
    git(merger, "push", "--quiet", "origin", "main");
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const view = { number: 7, state: "MERGED", headRefName: "feat", headRefOid: head, baseRefName: "main", isCrossRepository: false };
    writeFileSync(join(bin, "gh"), `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(view))});\n`);
    chmodSync(join(bin, "gh"), 0o755);
    const run = (cwd = repo) => {
      const result = spawnSync(process.execPath, [join(import.meta.dirname, "post-merge-cleanup.mjs"), "7"], {
        cwd, env: { ...env, PATH: `${bin}${delimiter}${env.PATH}` }, encoding: "utf8",
      });
      return { status: result.status, report: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
    };
    return { dir, origin, repo, worktree, run };
  }

  test("cleans up a squash-merged PR, and a rerun has nothing left to do", () => {
    const { origin, repo, worktree, run } = scenario("clean");
    writeFileSync(join(repo, ".git", "info", "exclude"), "build/\n");
    mkdirSync(join(worktree, "build"));
    writeFileSync(join(worktree, "build", "App.o"), "o");
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(first.report.held, []);
    assert.ok(!existsSync(worktree), "worktree and its ignored build/ output removed");
    assert.equal(git(repo, "branch", "--list", "feat"), "", "local branch deleted");
    assert.equal(git(repo, "ls-remote", "--heads", "origin", "feat"), "", "remote branch deleted");
    assert.equal(git(repo, "rev-parse", "main"), git(origin, "rev-parse", "main"), "trunk fast-forwarded");
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(second.report.done.map((step) => step.action), ["update-trunk"]);
  });

  test("holds a worktree with an untracked file and still deletes the remote branch", () => {
    const { repo, worktree, run } = scenario("untracked");
    writeFileSync(join(worktree, "todo.md"), "- [ ] x\n");
    const result = run();
    assert.equal(result.status, 1);
    assert.deepEqual(result.report.held.map((item) => item.reason), [
      "worktree has uncommitted work: todo.md",
      "a held worktree still holds the local branch",
    ]);
    assert.ok(existsSync(join(worktree, "todo.md")), "untracked file kept");
    assert.equal(git(repo, "ls-remote", "--heads", "origin", "feat"), "", "remote branch deleted");
  });

  test("passes an empty ignored folder and holds a user file inside one", () => {
    const { repo, worktree, run } = scenario("swiftpm");
    writeFileSync(join(repo, ".git", "info", "exclude"), ".swiftpm/\n");
    mkdirSync(join(worktree, ".swiftpm", "xcode"), { recursive: true });
    mkdirSync(join(worktree, ".swiftpm", "configuration"));
    writeFileSync(join(worktree, ".swiftpm", "configuration", "registries.json"), "{}");
    const held = run();
    assert.equal(held.status, 1);
    assert.equal(held.report.held[0].reason, "worktree has uncommitted work: .swiftpm/configuration/registries.json");
    rmSync(join(worktree, ".swiftpm", "configuration"), { recursive: true });
    const clean = run();
    assert.equal(clean.status, 0, clean.stderr);
    assert.ok(!existsSync(worktree), "worktree removed");
  });

  test("cleans up in a bare clone with worktrees", () => {
    const { dir, origin, run } = scenario("bare");
    const bare = join(dir, "bare.git");
    git(dir, "clone", "--quiet", "--bare", origin, bare);
    const trunk = join(dir, "bare-worktrees", "main");
    const feat = join(dir, "bare-worktrees", "feat");
    git(bare, "worktree", "add", "--quiet", trunk, "main");
    git(bare, "worktree", "add", "--quiet", feat, "feat");
    git(trunk, "reset", "--quiet", "--hard", "HEAD~1");
    const result = run(bare);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(feat), "worktree removed");
    assert.equal(git(bare, "branch", "--list", "feat"), "", "local branch deleted");
    assert.equal(git(trunk, "rev-parse", "HEAD"), git(origin, "rev-parse", "main"), "trunk fast-forwarded");
  });

  test("holds an ignored folder with a non-ASCII name", () => {
    const { repo, worktree, run } = scenario("unicode");
    writeFileSync(join(repo, ".git", "info", "exclude"), "notes-*/\n");
    mkdirSync(join(worktree, "notes-café"));
    writeFileSync(join(worktree, "notes-café", "plan.md"), "x");
    const result = run();
    assert.equal(result.status, 1);
    assert.equal(result.report.held[0].reason, "worktree has uncommitted work: notes-café/plan.md");
    assert.ok(existsSync(join(worktree, "notes-café", "plan.md")), "file kept");
  });

  test("holds a commit that only the worktree's HEAD reflog reaches", () => {
    const { repo, worktree, run } = scenario("reflog");
    git(worktree, "switch", "--quiet", "--detach");
    writeFileSync(join(worktree, "c.txt"), "c\n");
    git(worktree, "add", "c.txt");
    git(worktree, "commit", "--quiet", "-m", "detached");
    git(worktree, "switch", "--quiet", "feat");
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.report.held[0].reason, /^1 commit\(s\) that only a reflog reaches/);
    assert.ok(existsSync(worktree), "worktree kept");
    assert.notEqual(git(repo, "branch", "--list", "feat"), "", "local branch kept");
  });

  test("treats a tip that an amend replaced before the push as rewritten history, also on a rerun", () => {
    const { worktree, run } = scenario("amended", { amend: true });
    writeFileSync(join(worktree, "todo.md"), "x");
    const first = run();
    assert.deepEqual(first.report.held.map((item) => item.reason), [
      "worktree has uncommitted work: todo.md",
      "a held worktree still holds the local branch",
    ]);
    rmSync(join(worktree, "todo.md"));
    const second = run();
    assert.equal(second.status, 0, JSON.stringify(second.report));
    assert.ok(!existsSync(worktree), "worktree removed");
    assert.equal(second.report.rewritten.length, 1, "the tip before the amend is listed for recovery");
  });

  test("holds an ignored file and an unpushed commit inside a submodule", () => {
    const { dir, worktree, run } = scenario("submodule");
    const lib = join(dir, "lib");
    git(dir, "init", "--quiet", "--initial-branch=main", lib);
    writeFileSync(join(lib, "l.txt"), "l\n");
    git(lib, "add", "l.txt");
    git(lib, "commit", "--quiet", "-m", "lib");
    const sub = join(dir, "sub-origin.git");
    git(dir, "clone", "--quiet", "--bare", lib, sub);
    git(worktree, "-c", "protocol.file.allow=always", "submodule", "add", "--quiet", sub, "sub");
    git(worktree, "commit", "--quiet", "-m", "add sub");
    writeFileSync(join(worktree, "sub", ".env"), "x");
    writeFileSync(join(worktree, "sub", ".gitignore"), ".env\n");
    git(join(worktree, "sub"), "add", ".gitignore");
    git(join(worktree, "sub"), "commit", "--quiet", "-m", "local only");
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.report.held[0].reason, /sub\/\.env/);
    assert.match(result.report.held[0].reason, /sub \(1 unpushed commit\(s\)\)/);
    assert.ok(existsSync(join(worktree, "sub", ".env")), "submodule file kept");
  });

  test("keeps a local branch with a commit that never reached the PR", () => {
    const { repo, worktree, run } = scenario("unpushed");
    writeFileSync(join(worktree, "c.txt"), "c\n");
    git(worktree, "add", "c.txt");
    git(worktree, "commit", "--quiet", "-m", "late");
    git(worktree, "switch", "--quiet", "--detach");
    const result = run();
    assert.equal(result.status, 1);
    assert.deepEqual(result.report.held, [{ target: "feat", reason: "local branch has commits that are not in the merged PR" }]);
    assert.notEqual(git(repo, "branch", "--list", "feat"), "", "local branch kept");
  });
});
