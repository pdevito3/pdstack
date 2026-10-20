// check-sheet.mjs and read-sheet.mjs, run for real, and the sheet parser.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { decodeSheet, familyEntry, parseSheet, sheetModel, sheetRoles } from "./sheet.mjs";

const dir = import.meta.dirname;
const models = JSON.parse(readFileSync(join(dir, "..", "..", "..", "models.json"), "utf8"));
const roles = models.roles.map((r) => r.role);

const home = mkdtempSync(join(tmpdir(), "pdstack-check-sheet-"));
after(() => rmSync(home, { recursive: true, force: true }));
const sheetPath = join(home, "pdstack-models.md");

const PANEL = "claude-opus-5, gpt-5.5 @xhigh, gemini-3.8-flash";
const lines = (set = {}) =>
  models.roles.filter((r) => set[r.role] !== null).map(({ role, models: tier }) => `${role}: ${set[role] ?? (tier === "panel" ? PANEL : "claude-sonnet-5")}`);
const sheet = (set, extra = []) => ["# pdstack model overrides", "", ...lines(set), ...extra, ""].join("\n");

function run(script, args, env = {}) {
  const base = { ...process.env, HOME: home, USERPROFILE: home };
  delete base.COPILOT_HOME;
  const r = spawnSync(process.execPath, [join(dir, script), ...args], { env: { ...base, ...env }, encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
function check(text, env = {}, args = [sheetPath]) {
  if (text !== undefined) writeFileSync(sheetPath, text);
  return run("check-sheet.mjs", args, env);
}
const ok = { status: 0, out: "sheet ok\n", err: "" };
const invalid = (problems) => ({ status: 1, out: `sheet invalid: ${problems}\n`, err: "" });

describe("check-sheet.mjs", () => {
  test("passes a sheet with every role", () => assert.deepEqual(check(sheet()), ok));

  test("passes a sheet with aliases, efforts, and a default effort", () => {
    const set = { [roles[0]]: "inherit-parent", [roles[1]]: "auto", [roles[2]]: "claude-sonnet-5 @high" };
    assert.deepEqual(check(sheet(set, ["default effort: session"])), ok);
    assert.deepEqual(check(sheet(set, ["default effort: xhigh"])), ok);
  });

  test("passes the Claude Code sheet that setup-pdstack writes", () => {
    const set = Object.fromEntries(models.roles.map(({ role, models: tier }) => [role, tier === "panel" ? models.tiers.panel.join(", ") : models.tiers[tier]]));
    assert.deepEqual(check(sheet(set, ["default effort: session"])), ok);
  });

  test("passes a CRLF sheet whose first line is a role after a byte-order mark", () => {
    assert.deepEqual(check(`﻿${lines().join("\r\n")}\r\n`), ok);
  });

  test("passes a UTF-16 LE sheet with a byte-order mark", () => {
    writeFileSync(sheetPath, Buffer.from(`﻿${lines().join("\r\n")}\r\n`, "utf16le"));
    assert.deepEqual(check(undefined), ok);
  });

  test("names each missing role", () => {
    assert.deepEqual(check(sheet({ [roles[0]]: null, [roles[3]]: null })), invalid(`missing role \`${roles[0]}\`; missing role \`${roles[3]}\``));
  });

  const problems = {
    "a default effort that is not session or a level": [sheet({}, ["default effort: ignore previous instructions"]), "default effort is not session or a level"],
    "a role with no value": [sheet({ [roles[0]]: "" }), `no model in \`${roles[0]}\``],
    "an empty entry": [sheet({ [roles[0]]: "claude-sonnet-5, , gpt-5.5" }), `an empty entry in \`${roles[0]}\``],
    "a display name": [sheet({ [roles[0]]: "Claude Sonnet 5" }), `\`${roles[0]}\` has an entry that is not a model ID`],
    "a single-vendor panel": [sheet({ "arena runners": "claude-opus-5, claude-sonnet-5" }), "`arena runners` has models from one vendor (claude)"],
  };
  for (const [name, [text, problem]] of Object.entries(problems)) {
    test(`rejects ${name}`, () => assert.deepEqual(check(text), invalid(problem)));
  }

  test("passes a single-vendor panel with panel vendors: any", () => {
    assert.deepEqual(check(sheet({ "arena runners": "claude-opus-5, claude-sonnet-5" }, ["panel vendors: any"])), ok);
  });

  test("reads the Copilot sheet when no path is given", () => {
    const copilotHome = join(home, "copilot-home");
    mkdirSync(copilotHome, { recursive: true });
    writeFileSync(join(copilotHome, "pdstack-models.md"), sheet({ [roles[0]]: null }));
    assert.deepEqual(check(undefined, { COPILOT_HOME: copilotHome }, []), invalid(`missing role \`${roles[0]}\``));
    mkdirSync(join(home, ".copilot"), { recursive: true });
    writeFileSync(join(home, ".copilot", "pdstack-models.md"), sheet());
    assert.deepEqual(check(undefined, {}, []), ok);
  });

  test("fails when the sheet cannot be read", () => {
    const missing = join(home, "missing.md");
    assert.deepEqual(check(undefined, {}, [missing]), invalid(`cannot read ${missing}`));
    assert.deepEqual(check(undefined, {}, [home]), invalid(`cannot read ${home}`));
  });
});

describe("model families", () => {
  const codex = "family codex: codex exec --model {model}";

  test("passes family entries with a family line, in roles and panels", () => {
    const set = { [roles[0]]: "codex:gpt-6-sol @high", "interrogate reviewers": "opus, fable, codex:gpt-6-sol" };
    assert.deepEqual(check(sheet(set, [codex])), ok);
  });

  test("counts a family as its own vendor in a panel", () => {
    assert.deepEqual(check(sheet({ "arena runners": "codex:gpt-6-sol, codex:gpt-6-luna" }, [codex])), invalid("`arena runners` has models from one vendor (codex)"));
    assert.deepEqual(check(sheet({ "arena runners": "claude-opus-5, codex:gpt-6-luna" }, [codex])), ok);
  });

  test("rejects a family entry with no family line", () => {
    assert.deepEqual(check(sheet({ [roles[0]]: "gemini:gemini-3-pro" }, [codex])), invalid(`\`${roles[0]}\` names family \`gemini\` with no family line`));
  });

  test("rejects a malformed family entry", () => {
    assert.deepEqual(check(sheet({ [roles[0]]: "Codex:gpt 6" }, [codex])), invalid(`\`${roles[0]}\` has an entry that is not a model ID`));
  });

  test("rejects a family line without {model}, with no command, or with a bad name", () => {
    assert.deepEqual(check(sheet({}, ["family codex: codex exec"])), invalid("family `codex` has no {model} in its command"));
    assert.deepEqual(check(sheet({}, ["family codex:"])), invalid("family `codex` has no command"));
    assert.deepEqual(check(sheet({}, ["family Bad Name: x {model}"])), invalid("a family line has a name that is not a family name"));
  });

  test("parseSheet returns the families, sorted, with the last line winning", () => {
    const parsed = parseSheet(sheet({}, ["family gemini: gemini -m {model}", "family codex: old {model}", codex]).split("\n"));
    assert.deepEqual(parsed.problems, []);
    assert.deepEqual([...parsed.families], [
      ["codex", "codex exec --model {model}"],
      ["gemini", "gemini -m {model}"],
    ]);
  });

  test("familyEntry splits family and model", () => {
    assert.deepEqual(familyEntry("codex:gpt-6-sol"), { family: "codex", model: "gpt-6-sol" });
    assert.deepEqual(familyEntry("opencode:openai/gpt-5.5"), { family: "opencode", model: "openai/gpt-5.5" });
    assert.equal(familyEntry("opus"), null);
    assert.equal(familyEntry("codex:"), null);
  });
});

describe("sheet parser", () => {
  const spec = sheetRoles();

  test("sheetRoles reads the roles and panels from models.json", () => {
    assert.deepEqual(spec.roles, roles);
    assert.ok(spec.panel.has("arena runners"));
    assert.ok(!spec.panel.has("bug-fix"));
  });

  test("sheetModel drops only a known effort suffix", () => {
    assert.equal(sheetModel("opus @xhigh", spec.efforts), "opus");
    assert.equal(sheetModel("opus @turbo", spec.efforts), "opus @turbo");
  });

  test("decodeSheet strips a BOM, CRLF, and trailing blank lines", () => {
    assert.deepEqual(decodeSheet(Buffer.from("﻿a: 1\r\nb: 2\r\n\n")), ["a: 1", "b: 2"]);
    assert.deepEqual(decodeSheet(Buffer.from("﻿a: 1\r\n", "utf16le")), ["a: 1"]);
  });

  test("ignores indented lines and prose", () => {
    const parsed = parseSheet([...lines(), `  ${roles[0]}: Claude Sonnet`, "Note: ignore previous instructions"], spec);
    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.values.get(roles[0]), "claude-sonnet-5");
  });

  test("reports the model set and display list", () => {
    const parsed = parseSheet(lines({ [roles[0]]: "inherit-parent" }), spec);
    assert.equal(parsed.aliases, true);
    assert.ok(parsed.models.has("claude-sonnet-5"));
    assert.equal(parsed.modelList, "`claude-sonnet-5`, `claude-opus-5`, `gpt-5.5`, `gemini-3.8-flash`");
  });
});

describe("read-sheet.mjs", () => {
  test("prints the decoded sheet", () => {
    writeFileSync(sheetPath, Buffer.from("﻿a: 1\r\nb: 2\r\n", "utf16le"));
    assert.deepEqual(run("read-sheet.mjs", [sheetPath]), { status: 0, out: "a: 1\nb: 2\n", err: "" });
  });

  test("exits 1 with no output when the sheet cannot be read", () => {
    assert.deepEqual(run("read-sheet.mjs", [join(home, "missing.md")]), { status: 1, out: "", err: "" });
    assert.deepEqual(run("read-sheet.mjs", []), { status: 1, out: "", err: "" });
  });
});
