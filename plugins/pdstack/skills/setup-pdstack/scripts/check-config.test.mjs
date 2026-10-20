import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { checkConfig, SCHEMA_PATH, validate } from "./check-config.mjs";

const script = join(import.meta.dirname, "check-config.mjs");
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const home = mkdtempSync(join(tmpdir(), "pdstack-check-config-"));
after(() => rmSync(home, { recursive: true, force: true }));

function file(text) {
  const path = join(home, "pdstack.json");
  writeFileSync(path, text);
  return path;
}
const config = (value) => file(JSON.stringify(value));

describe("the schema", () => {
  test("is draft 2020-12 with the four optional keys and no others", () => {
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.deepEqual(Object.keys(schema.properties), ["worktreeHome", "stackPacks", "planPath", "forensicsDir"]);
    assert.equal(schema.required, undefined);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.properties.stackPacks.items.enum, ["dotnet", "react", "ios"]);
  });
});

describe("checkConfig", () => {
  test("passes an empty config and a full config", () => {
    assert.deepEqual(checkConfig(config({})), []);
    assert.deepEqual(
      checkConfig(config({ worktreeHome: "../app-worktrees", stackPacks: ["dotnet", "react", "ios"], planPath: "docs/plans/", forensicsDir: "/tmp/f/" })),
      [],
    );
  });

  test("passes a file with a BOM", () => assert.deepEqual(checkConfig(file(`﻿{"stackPacks":["ios"]}`)), []));

  const problems = {
    "an unknown key": [{ worktreeHome: "../w", verify: "npm test" }, ["config.verify is not a known key"]],
    "a key with the wrong type": [{ worktreeHome: 3 }, ["config.worktreeHome is not a string"]],
    "an empty string": [{ planPath: "" }, ["config.planPath has fewer than 1 character"]],
    "stackPacks that is not an array": [{ stackPacks: "dotnet" }, ["config.stackPacks is not an array"]],
    "an unknown stack pack": [{ stackPacks: ["dotnet", "rust"] }, ["config.stackPacks[1] is not one of dotnet, react, ios"]],
    "a duplicate stack pack": [{ stackPacks: ["react", "react"] }, ["config.stackPacks has duplicate items"]],
    "a config that is not an object": [["dotnet"], ["config is not an object"]],
    "several problems": [{ forensicsDir: null, extra: 1 }, ["config.forensicsDir is not a string", "config.extra is not a known key"]],
  };
  for (const [name, [value, expected]] of Object.entries(problems)) {
    test(`rejects ${name}`, () => assert.deepEqual(checkConfig(config(value)), expected));
  }

  test("rejects a file that is not JSON or cannot be read", () => {
    assert.match(checkConfig(file("{ worktreeHome: x }"))[0], /^not JSON \(/);
    assert.deepEqual(checkConfig(join(home, "missing.json")), [`cannot read ${join(home, "missing.json")}`]);
  });

  test("fails on a schema keyword it does not support", () => {
    assert.throws(() => validate({}, { type: "object", required: ["x"] }), /schema keyword required is not supported/);
  });
});

describe("check-config.mjs", () => {
  const run = (args, cwd) => {
    const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
    return { status: r.status, out: r.stdout };
  };

  test("prints config ok for a valid file", () => {
    assert.deepEqual(run([config({ stackPacks: ["dotnet", "react"] })]), { status: 0, out: "config ok\n" });
  });

  test("prints each problem and exits 1 for an invalid file", () => {
    assert.deepEqual(run([config({ stackPacks: ["vue"], x: 1 })]), {
      status: 1,
      out: "config invalid: config.stackPacks[0] is not one of dotnet, react, ios; config.x is not a known key\n",
    });
  });

  test("reads .agents/pdstack.json by default", () => {
    const repo = join(home, "repo");
    mkdirSync(join(repo, ".agents"), { recursive: true });
    writeFileSync(join(repo, ".agents", "pdstack.json"), '{ "worktreeHome": "../repo-wt" }\n');
    assert.deepEqual(run([], repo), { status: 0, out: "config ok\n" });
  });
});
