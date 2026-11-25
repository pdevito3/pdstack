#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { constants } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readGuard, SKILL_DIR } from "./guard.mjs";

/** @typedef {import("./guard.mjs").Guard} Guard */
/** @typedef {import("./guard.mjs").RequiredRule} RequiredRule */

/** @typedef {{ code?: string, severity: string, file: string, message: string }} Finding */

/**
 * @typedef {{ kind: "ran", findings: Finding[], filesLinted: number }
 *   | { kind: "failed", output: string }
 *   | { kind: "missing" }} LintRun
 */

/** @typedef {{ bad: string[], clean: string[] }} Canaries */

export const FIXTURES_DIR = join(SKILL_DIR, "scripts", "fixtures");
const CANARY_PREFIX = "slop-guard-canary-";
const OXLINT_CONFIGS = ["oxlint.config.ts", "oxlint.config.mts", "oxlint.config.js", "oxlint.config.mjs", ".oxlintrc.json", ".oxlintrc.jsonc"];
const VITE_CONFIGS = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"];

function splitId(id) {
  const slash = id.lastIndexOf("/");
  return slash === -1 ? ["eslint", id] : [id.slice(0, slash), id.slice(slash + 1)];
}

export function diagnosticCode(id) {
  const [plugin, rule] = splitId(id);
  return `${plugin}(${rule})`;
}

/** @param {string[]} badFiles @param {string} id */
export function canariesOf(badFiles, id) {
  const stem = `${splitId(id).join("__")}.`;
  return badFiles.filter((file) => file.startsWith(stem));
}

/** @param {RequiredRule} rule */
function configEntry(rule) {
  return JSON.stringify(rule.options ? ["error", rule.options] : "error");
}

/** @param {string} output @param {Guard} guard */
function describeLoadFailure(output, guard) {
  const lines = output.split(/\r?\n/).map((line) => line.replace(/^\s*[x|]?\s*/, "").trim()).filter(Boolean);
  const tsrs = lines.find((line) => /type-aware linter executable/i.test(line));
  if (tsrs) return `tsrs did not load: ${tsrs} Install tsrs@${guard.devDependencies.tsrs} as a devDependency.`;
  const unknownPlugin = output.match(/Plugin '([^']+)' not found/);
  if (unknownPlugin) {
    const name = unknownPlugin[1];
    return `the config enables ${name} rules, but no plugin named "${name}" loads. Keep extends: [cloudflare] and the jsPlugins entries of templates/oxlint.config.ts.`;
  }
  const index = lines.findIndex((line) => line.startsWith("Failed to load JS plugin:"));
  if (index !== -1) {
    const specifier = lines[index].slice("Failed to load JS plugin:".length).trim();
    const reason = lines[index + 1] ?? "no reason given";
    if (specifier.includes("anti-slop")) {
      return `the anti-slop plugin did not load from ${specifier}: ${reason}. Run install-anti-slop.mjs, and install @oxlint/plugins at the version of oxlint.`;
    }
    return `the JS plugin ${specifier} did not load: ${reason}. Install it at the version in guard.json.`;
  }
  return `oxlint did not run: ${lines.slice(0, 3).join(" ") || "no output"}`;
}

/**
 * @param {Guard} guard
 * @param {Canaries} canaries
 * @param {LintRun} run
 * @returns {string[]}
 */
export function findGaps(guard, canaries, run) {
  if (run.kind === "missing") {
    return ["oxlint is not installed in the repo. Install the devDependencies that guard.json names, or Vite+."];
  }
  if (run.kind === "failed") return [describeLoadFailure(run.output, guard)];
  const expected = canaries.bad.length + canaries.clean.length;
  if (run.filesLinted < expected) {
    return [`oxlint linted ${run.filesLinted} of ${expected} canary files. Keep ${CANARY_PREFIX}* out of ignorePatterns and .gitignore.`];
  }

  const gaps = [];
  for (const crash of run.findings.filter((finding) => !finding.code)) {
    const error = crash.message.split("\n").find((line) => /Error\b/.test(line) && !line.startsWith("Error running")) ?? crash.message;
    gaps.push(`a JS plugin crashed on ${crash.file}: ${error.trim()} Its rules did not run on that file.`);
  }
  for (const rule of guard.rules) {
    const [canary] = canariesOf(canaries.bad, rule.id);
    const code = diagnosticCode(rule.id);
    const severities = run.findings.filter((finding) => finding.file === `bad/${canary}` && finding.code === code).map((finding) => finding.severity);
    if (severities.includes("error")) continue;
    if (severities.length) gaps.push(`${rule.id}: reports a warning, not an error. Set it to ${configEntry(rule)}.`);
    else gaps.push(`${rule.id}: did not report its canary bad/${canary}. Set it to ${configEntry(rule)}.`);
  }

  const rulesByCode = new Map(guard.rules.map((rule) => [diagnosticCode(rule.id), rule]));
  for (const file of canaries.clean) {
    const codes = new Set(run.findings.filter((finding) => finding.code && finding.file === `clean/${file}`).map((finding) => finding.code));
    for (const code of codes) {
      const rule = rulesByCode.get(code);
      let fix = "Turn off or narrow the rule that reports it.";
      if (rule?.options) fix = `Set ${rule.id} to ${configEntry(rule)}.`;
      else if (rule) fix = `Its code differs from the version that guard.json pins. Reinstall it at that version.`;
      gaps.push(`${code} reported clean/${file}, a form the guard allows. ${fix}`);
    }
  }
  return gaps;
}

/** @param {string} repoRoot @returns {{ command: string, args: string[] } | null} */
function lintCommand(repoRoot) {
  const bin = (pkg, name) => {
    const manifest = join(repoRoot, "node_modules", pkg, "package.json");
    if (!existsSync(manifest)) return null;
    const { bin: entry } = JSON.parse(readFileSync(manifest, "utf8"));
    return join(repoRoot, "node_modules", pkg, typeof entry === "string" ? entry : entry[name]);
  };
  const has = (names) => names.some((name) => existsSync(join(repoRoot, name)));
  const oxlint = bin("oxlint", "oxlint");
  if (oxlint && has(OXLINT_CONFIGS)) return { command: oxlint, args: [] };
  const vp = bin("vite-plus", "vp");
  if (vp && has(VITE_CONFIGS)) return { command: vp, args: ["lint"] };
  return oxlint ? { command: oxlint, args: [] } : null;
}

/** @param {string[]} dirNames */
export function staleCanaryDirs(dirNames) {
  return dirNames.filter((name) => name.startsWith(CANARY_PREFIX));
}

/** @param {string} repoRoot */
function removeStaleCanaries(repoRoot) {
  const dirNames = readdirSync(repoRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const name of staleCanaryDirs(dirNames)) rmSync(join(repoRoot, name), { recursive: true, force: true });
}

/** @param {string} repoRoot @returns {Promise<LintRun>} */
async function lintCanaries(repoRoot) {
  const lint = lintCommand(repoRoot);
  if (!lint) return { kind: "missing" };
  const dir = mkdtempSync(join(repoRoot, CANARY_PREFIX));
  let child;
  const stop = (signal) => {
    child?.kill(signal);
    rmSync(dir, { recursive: true, force: true });
    process.exit(128 + constants.signals[signal]);
  };
  process.once("SIGINT", stop).once("SIGTERM", stop);
  let stdout = "";
  let stderr = "";
  try {
    cpSync(FIXTURES_DIR, dir, { recursive: true });
    child = spawn(process.execPath, [lint.command, ...lint.args, "--format", "json", relative(repoRoot, dir)], { cwd: repoRoot });
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    await new Promise((done, fail) => child.on("error", fail).on("close", done));
  } finally {
    process.off("SIGINT", stop).off("SIGTERM", stop);
    rmSync(dir, { recursive: true, force: true });
  }
  let report;
  try {
    report = JSON.parse(stdout.slice(stdout.indexOf("{")));
  } catch {
    return { kind: "failed", output: `${stdout}\n${stderr}` };
  }
  const marker = `${basename(dir)}/`;
  const findings = report.diagnostics.map(({ code, severity, filename, message }) => {
    const path = filename.split("\\").join("/");
    return { code, severity, message, file: path.slice(path.indexOf(marker) + marker.length) };
  });
  return { kind: "ran", findings, filesLinted: report.number_of_files };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!process.argv[2]) {
    console.error("usage: node check-slop-guard.mjs <repo-root>");
    process.exit(2);
  }
  const repoRoot = resolve(process.argv[2]);
  removeStaleCanaries(repoRoot);
  const canaries = { bad: readdirSync(join(FIXTURES_DIR, "bad")), clean: readdirSync(join(FIXTURES_DIR, "clean")) };
  const gaps = findGaps(readGuard(), canaries, await lintCanaries(repoRoot));
  console.log(gaps.length ? gaps.join("\n") : "slop guard ok");
  process.exitCode = gaps.length ? 1 : 0;
}
