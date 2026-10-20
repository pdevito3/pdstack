import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { defaultOut, defaultSheet, findCommand, splitCommand } from "./run-external.mjs";

const script = join(import.meta.dirname, "run-external.mjs");
const models = JSON.parse(readFileSync(join(import.meta.dirname, "..", "models.json"), "utf8"));
const dir = mkdtempSync(join(tmpdir(), "pdstack-run-external-"));
after(() => rmSync(dir, { recursive: true, force: true }));

// A fake CLI: echoes its argv and stdin, writes a line to stderr, and exits
// with FAKE_EXIT.
const fake = join(dir, "fake-cli.mjs");
writeFileSync(
  fake,
  [
    'let input = "";',
    'process.stdin.on("data", (d) => (input += d));',
    'process.stdin.on("end", () => {',
    '  process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input }));',
    '  process.stderr.write("fake stderr\\n");',
    '  process.exit(Number(process.env.FAKE_EXIT ?? 0));',
    "});",
  ].join("\n"),
);

const roleLines = models.roles.map((r) => `${r.role}: opus`);
function sheet(familyLines) {
  const path = join(dir, "pdstack-models.md");
  writeFileSync(path, ["# pdstack model configuration", "", ...roleLines, "", ...familyLines, ""].join("\n"));
  return path;
}
const fakeFamily = `family fake: '${process.execPath}' '${fake}' exec --model {model} --tag "a b"`;
const prompt = join(dir, "review.md");
writeFileSync(prompt, "Review this.\n");

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { env: { ...process.env, ...env }, encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

describe("run-external.mjs", () => {
  test("runs the family template with the prompt on stdin and writes stdout to the out file", () => {
    const out = join(dir, "out.txt");
    const r = run(["--family", "fake", "--model", "m-1.5", "--prompt-file", prompt, "--out", out, "--sheet", sheet([fakeFamily])]);
    assert.deepEqual(r, { status: 0, out: `${out}\n`, err: "fake stderr\n" });
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), { args: ["exec", "--model", "m-1.5", "--tag", "a b"], input: "Review this.\n" });
  });

  test("writes next to the prompt file by default", () => {
    const r = run(["--family", "fake", "--model", "vendor/m-2", "--prompt-file", prompt, "--sheet", sheet([fakeFamily])]);
    const out = join(dir, "review.fake.vendor_m-2.out.md");
    assert.equal(r.status, 0);
    assert.equal(r.out, `${out}\n`);
    assert.ok(existsSync(out));
  });

  test("exits with the CLI's exit code and still prints the out path", () => {
    const out = join(dir, "failed.txt");
    const r = run(["--family", "fake", "--model", "m", "--prompt-file", prompt, "--out", out, "--sheet", sheet([fakeFamily])], { FAKE_EXIT: "3" });
    assert.equal(r.status, 3);
    assert.equal(r.out, `${out}\n`);
  });

  test("reads the sheet from CLAUDE_CONFIG_DIR by default", () => {
    sheet([fakeFamily]);
    const r = run(["--family", "fake", "--model", "m", "--prompt-file", prompt, "--out", join(dir, "config-dir.txt")], { CLAUDE_CONFIG_DIR: dir });
    assert.equal(r.status, 0);
  });

  test("names the families for an unknown family", () => {
    const path = sheet([fakeFamily]);
    const r = run(["--family", "codex", "--model", "gpt-6-sol", "--prompt-file", prompt, "--sheet", path]);
    assert.equal(r.status, 2);
    assert.equal(r.err, `run-external: unknown family \`codex\` in ${path}. Families: fake. Run setup-pdstack to add a family.\n`);
  });

  test("reports a family line without {model}", () => {
    const path = sheet(["family fake: fake-cli"]);
    const r = run(["--family", "fake", "--model", "m", "--prompt-file", prompt, "--sheet", path]);
    assert.equal(r.status, 2);
    assert.equal(r.err, `run-external: family \`fake\` has no {model} in its command in ${path}\n`);
  });

  test("reports a missing CLI", () => {
    const r = run(["--family", "gone", "--model", "m", "--prompt-file", prompt, "--sheet", sheet(["family gone: pdstack-no-such-cli-7f3 --model {model}"])]);
    assert.equal(r.status, 127);
    assert.equal(r.err, "run-external: the CLI `pdstack-no-such-cli-7f3` of family `gone` is not on PATH. Install it, or fix the family line with setup-pdstack.\n");
  });

  test("reports a missing sheet, a missing prompt file, and missing arguments", () => {
    const missing = join(dir, "missing.md");
    assert.match(run(["--family", "fake", "--model", "m", "--prompt-file", prompt, "--sheet", missing]).err, /cannot read the model sheet/);
    assert.match(run(["--family", "fake", "--model", "m", "--prompt-file", missing, "--sheet", sheet([fakeFamily])]).err, /cannot read the prompt file/);
    const r = run(["--family", "fake"]);
    assert.equal(r.status, 2);
    assert.match(r.err, /^run-external: usage: /);
    assert.equal(run(["--family", "fake", "--model", "bad model", "--prompt-file", prompt]).status, 2);
  });
});

describe("splitCommand", () => {
  test("splits on whitespace and honors quotes", () => {
    assert.deepEqual(splitCommand("codex exec  --model {model}"), ["codex", "exec", "--model", "{model}"]);
    assert.deepEqual(splitCommand(`a 'b c' "d \\"e\\" \\\\" f""g ''`), ["a", "b c", 'd "e" \\', "fg", ""]);
    assert.deepEqual(splitCommand("a\\ b"), ["a b"]);
  });

  test("keeps Windows paths intact", () => {
    assert.deepEqual(splitCommand("C:\\tools\\codex.exe exec"), ["C:\\tools\\codex.exe", "exec"]);
    assert.deepEqual(splitCommand('"C:\\Program Files\\nodejs\\node.exe" x'), ["C:\\Program Files\\nodejs\\node.exe", "x"]);
  });

  test("rejects an unclosed quote", () => assert.throws(() => splitCommand("a 'b"), /unclosed ' quote/));
});

describe("helpers", () => {
  test("findCommand finds node on PATH and by path", () => {
    assert.ok(findCommand(process.execPath));
    assert.equal(findCommand("pdstack-no-such-cli-7f3"), null);
  });

  test("defaultSheet and defaultOut", () => {
    assert.equal(defaultSheet({ CLAUDE_CONFIG_DIR: dir }), join(dir, "pdstack-models.md"));
    assert.equal(defaultOut(join(dir, "p.txt"), "codex", "gpt-6-sol"), join(dir, "p.codex.gpt-6-sol.out.md"));
  });
});
