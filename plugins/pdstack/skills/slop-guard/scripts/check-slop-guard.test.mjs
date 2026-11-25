import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { canariesOf, diagnosticCode, findGaps, FIXTURES_DIR } from "./check-slop-guard.mjs";
import { readGuard, SKILL_DIR } from "./guard.mjs";

const guard = readGuard();
const canaries = { bad: readdirSync(join(FIXTURES_DIR, "bad")), clean: readdirSync(join(FIXTURES_DIR, "clean")) };
const canaryOf = (id) => canariesOf(canaries.bad, id)[0];
const fileCount = canaries.bad.length + canaries.clean.length;

function holdingRun(changes = {}) {
  const findings = guard.rules.map((rule) => ({ code: diagnosticCode(rule.id), severity: "error", file: `bad/${canaryOf(rule.id)}`, message: "" }));
  return { kind: "ran", filesLinted: fileCount, findings: [...findings, ...(changes.add ?? [])].filter((finding) => !changes.drop?.includes(finding.code)) };
}

describe("guard.json and the canaries", () => {
  test("each required rule has exactly one bad canary, and each bad canary belongs to a rule", () => {
    for (const rule of guard.rules) {
      const matches = canariesOf(canaries.bad, rule.id);
      assert.equal(matches.length, 1, `${rule.id} has ${matches.length} canaries`);
    }
    const owned = new Set(guard.rules.flatMap((rule) => canariesOf(canaries.bad, rule.id)));
    for (const file of canaries.bad) assert.ok(owned.has(file), `bad/${file} names no required rule`);
  });

  test("each rule has a tier and a why", () => {
    for (const rule of guard.rules) {
      assert.ok(["builtin", "anti-slop"].includes(rule.tier), `${rule.id} tier ${rule.tier}`);
      assert.ok(rule.why.length > 0, `${rule.id} has no why`);
    }
  });

  test("the template's rules block is exactly the required rules, in order, with their options", () => {
    const template = readFileSync(join(SKILL_DIR, "templates", "oxlint.config.ts"), "utf8");
    const block = /^ {2}rules: \{\n([\s\S]*?)\n {2}\},$/m.exec(template)[1];
    const entries = block.split("\n").filter((line) => line.trim()).map((line) => {
      const [, id, value] = /^\s*"([^"]+)": (.+),$/.exec(line);
      return { id, entry: JSON.parse(value) };
    });
    const expected = guard.rules.map((rule) => ({ id: rule.id, entry: rule.options ? ["error", rule.options] : "error" }));
    assert.deepEqual(entries, expected);
  });
});

describe("findGaps", () => {
  test("passes when each canary gets its rule's error and the clean files get nothing", () => {
    assert.deepEqual(findGaps(guard, canaries, holdingRun()), []);
  });

  test("names a rule that reports a warning and gives its config entry", () => {
    const run = holdingRun({ drop: ["anti-slop(no-runtime-typeof)"] });
    run.findings.push({ code: "anti-slop(no-runtime-typeof)", severity: "warning", file: `bad/${canaryOf("anti-slop/no-runtime-typeof")}`, message: "" });
    assert.deepEqual(findGaps(guard, canaries, run), [
      'anti-slop/no-runtime-typeof: reports a warning, not an error. Set it to ["error",{"allowInTypeGuards":true}].',
    ]);
  });

  test("names a rule that is off", () => {
    assert.deepEqual(findGaps(guard, canaries, holdingRun({ drop: ["oxc(no-accumulating-spread)"] })), [
      'oxc/no-accumulating-spread: did not report its canary bad/oxc__no-accumulating-spread.ts. Set it to "error".',
    ]);
  });

  test("counts an error on another file as no report", () => {
    const run = holdingRun({ drop: ["quality(no-reflect-get)"] });
    run.findings.push({ code: "quality(no-reflect-get)", severity: "error", file: "clean/flat-map.ts", message: "" });
    const gaps = findGaps(guard, canaries, run);
    assert.equal(gaps.length, 2);
    assert.match(gaps[0], /^quality\/no-reflect-get: did not report/);
    assert.match(gaps[1], /^quality\(no-reflect-get\) reported clean\/flat-map\.ts/);
  });

  test("gives the options of a required rule that flags a clean form", () => {
    const run = holdingRun({ add: [{ code: "unicorn(catch-error-name)", severity: "error", file: "clean/catch-callback-cause.ts", message: "" }] });
    assert.deepEqual(findGaps(guard, canaries, run), [
      'unicorn(catch-error-name) reported clean/catch-callback-cause.ts, a form the guard allows. Set unicorn/catch-error-name to ["error",{"ignore":["^cause$"]}].',
    ]);
  });

  test("tells the repo to narrow a rule outside the guard that flags a clean form", () => {
    const run = holdingRun({ add: [{ code: "eslint(no-restricted-syntax)", severity: "warning", file: "clean/in-operator.ts", message: "" }] });
    assert.deepEqual(findGaps(guard, canaries, run), [
      "eslint(no-restricted-syntax) reported clean/in-operator.ts, a form the guard allows. Turn off or narrow the rule that reports it.",
    ]);
  });

  test("reports a JS plugin that crashed on a canary", () => {
    const message = "Error running JS plugin.\nFile path: /repo/x.ts\nRangeError: Line/column pair translates to an out of range offset\n    at report";
    const run = holdingRun({ add: [{ severity: "error", file: "bad/x.ts", message }] });
    assert.deepEqual(findGaps(guard, canaries, run), [
      "a JS plugin crashed on bad/x.ts: RangeError: Line/column pair translates to an out of range offset Its rules did not run on that file.",
    ]);
  });

  test("reports canaries that the lint skipped", () => {
    const run = { ...holdingRun(), filesLinted: 0 };
    assert.deepEqual(findGaps(guard, canaries, run), [
      `oxlint linted 0 of ${fileCount} canary files, so the check cannot judge the rules.`,
    ]);
  });

  test("names a repo with no oxlint", () => {
    assert.match(findGaps(guard, canaries, { kind: "missing" })[0], /^oxlint is not installed in the repo\./);
  });

  test("names tsrs when the type-aware backend is missing", () => {
    const output = "Failed to find type-aware linter executable. You may need to add the `tsrs` or `oxlint-tsgolint` package to your project?\n";
    assert.deepEqual(findGaps(guard, canaries, { kind: "failed", output }), [
      `tsrs did not load: ${output.trim()} Install tsrs@${guard.devDependencies.tsrs} as a devDependency.`,
    ]);
  });

  test("names the plugin when the config enables rules of a plugin that is not loaded", () => {
    const output = "Failed to parse oxlint configuration file.\n\n  x Plugin 'anti-slop' not found\n";
    assert.match(findGaps(guard, canaries, { kind: "failed", output })[0], /^the config enables anti-slop rules, but no plugin named "anti-slop" loads\./);
  });

  test("names the anti-slop plugin when its files do not load", () => {
    const output = "Failed to parse oxlint configuration file.\n\n  x Failed to load JS plugin: ./tools/oxlint/anti-slop/index.ts\n  |   Cannot find module './tools/oxlint/anti-slop/index.ts'\n";
    assert.deepEqual(findGaps(guard, canaries, { kind: "failed", output }), [
      "the anti-slop plugin did not load from ./tools/oxlint/anti-slop/index.ts: Cannot find module './tools/oxlint/anti-slop/index.ts'. Run install-anti-slop.mjs, and install @oxlint/plugins at the version of oxlint.",
    ]);
  });

  test("names another JS plugin that does not load", () => {
    const output = "  x Failed to load JS plugin: @eslint-community/eslint-plugin-eslint-comments\n  |   Cannot find package\n";
    assert.match(findGaps(guard, canaries, { kind: "failed", output })[0], /^the JS plugin @eslint-community\/eslint-plugin-eslint-comments did not load: Cannot find package\./);
  });
});

describe("canary dirs", () => {
  const CHECK = join(import.meta.dirname, "check-slop-guard.mjs");
  const canaryDirsIn = (dir) => readdirSync(dir).filter((name) => name.startsWith("slop-guard-canary-"));

  test("SIGINT during the lint removes the canary dir before exit", { skip: process.platform === "win32" && "no POSIX signals" }, async (t) => {
    const repo = mkdtempSync(join(tmpdir(), "slop-guard-signal-"));
    const temp = mkdtempSync(join(tmpdir(), "slop-guard-signal-tmp-"));
    t.after(() => {
      rmSync(repo, { recursive: true, force: true });
      rmSync(temp, { recursive: true, force: true });
    });
    const pkg = join(repo, "node_modules", "oxlint");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "oxlint", bin: "lint.mjs" }));
    writeFileSync(join(pkg, "lint.mjs"), "setTimeout(() => {}, 60_000);\n");
    const check = spawn(process.execPath, [CHECK, repo], { env: { ...process.env, TMPDIR: temp } });
    while (!canaryDirsIn(temp).some((dir) => existsSync(join(temp, dir, "bad")))) await new Promise((wake) => setTimeout(wake, 20));
    assert.deepEqual(readdirSync(repo), ["node_modules"]);
    check.kill("SIGINT");
    const [code] = await once(check, "exit");
    assert.equal(code, 130);
    assert.deepEqual(canaryDirsIn(temp), []);
  });
});

const e2e = process.env.SLOP_GUARD_E2E === "1" && spawnSync("npm", ["ping"], { shell: process.platform === "win32", timeout: 20_000 }).status === 0;

describe("check-slop-guard.mjs on a repo that follows SKILL.md", { skip: !e2e && "set SLOP_GUARD_E2E=1 with npm online to run" }, () => {
  test("prints slop guard ok, then names a rule set to warn", () => {
    const repo = mkdtempSync(join(tmpdir(), "slop-guard-e2e-"));
    const temp = mkdtempSync(join(tmpdir(), "slop-guard-e2e-tmp-"));
    try {
      writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "e2e", private: true, type: "module" }));
      const deps = Object.entries(guard.devDependencies).map(([name, version]) => `${name}@${version}`);
      const npm = spawnSync("npm", ["install", "--save-dev", "--save-exact", "--no-audit", "--no-fund", ...deps], { cwd: repo, shell: process.platform === "win32", encoding: "utf8" });
      assert.equal(npm.status, 0, npm.stderr);
      const install = spawnSync(process.execPath, [join(import.meta.dirname, "install-anti-slop.mjs"), repo], { encoding: "utf8" });
      assert.equal(install.status, 0, install.stdout + install.stderr);
      cpSync(join(SKILL_DIR, "templates", "oxlint.config.ts"), join(repo, "oxlint.config.ts"));
      const check = () => spawnSync(process.execPath, [join(import.meta.dirname, "check-slop-guard.mjs"), repo], { encoding: "utf8", env: { ...process.env, TMPDIR: temp } });
      assert.equal(check().stdout, "slop guard ok\n");
      const config = join(repo, "oxlint.config.ts");
      writeFileSync(config, readFileSync(config, "utf8").replace('"anti-slop/no-shape-in-symbol-names": "error"', '"anti-slop/no-shape-in-symbol-names": "warn"'));
      const failed = check();
      assert.equal(failed.status, 1);
      assert.equal(failed.stdout, 'anti-slop/no-shape-in-symbol-names: reports a warning, not an error. Set it to "error".\n');
      assert.deepEqual(readdirSync(temp), []);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
