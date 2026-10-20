#!/usr/bin/env node
// Runs one role on another model family through its CLI. Reads the family's
// command template from the model sheet, puts the model in place of
// `{model}`, runs the command with no shell and the prompt on stdin, and
// writes the CLI's stdout to the out file. Prints the out path and exits with
// the CLI's exit code.
// Usage: node run-external.mjs --family <f> --model <m> --prompt-file <file>
//          [--out <file>] [--sheet <path>]
// The default sheet is <config>/pdstack-models.md, where <config> is
// $CLAUDE_CONFIG_DIR or ~/.claude. The default out file is next to the prompt
// file: <prompt name>.<family>.<model>.out.md.
import { spawn } from "node:child_process";
import { accessSync, closeSync, constants, openSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { familyEntry, parseSheet, readSheet } from "../skills/setup-pdstack/scripts/sheet.mjs";

const USAGE = "usage: node run-external.mjs --family <family> --model <model> --prompt-file <file> [--out <file>] [--sheet <path>]";
const WINDOWS = process.platform === "win32";

// Splits a command template into argv with no shell. Whitespace separates
// arguments. Single quotes keep their text as is. Double quotes keep their
// text, with \" and \\ as escapes. Outside quotes, a backslash escapes only a
// quote, a backslash, or whitespace, so Windows paths stay intact.
export function splitCommand(template) {
  const args = [];
  let current = "";
  let started = false;
  let quote = null;
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    const next = template[i + 1] ?? "";
    if (quote === "'") {
      if (c === "'") quote = null;
      else current += c;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "\\" && (next === '"' || next === "\\")) current += template[++i];
      else current += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (c === " " || c === "\t") {
      if (started) args.push(current);
      current = "";
      started = false;
    } else if (c === "\\" && /^["'\\ \t]$/.test(next)) {
      current += template[++i];
      started = true;
    } else {
      current += c;
      started = true;
    }
  }
  if (quote) throw new Error(`the command has an unclosed ${quote} quote`);
  if (started) args.push(current);
  return args;
}

function isRunnable(file) {
  try {
    if (!statSync(file).isFile()) return false;
    if (!WINDOWS) accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// The file that runs for command, found as a shell finds it, or null.
export function findCommand(command, env = process.env) {
  const exts = WINDOWS ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [];
  const candidates = (base) => (WINDOWS ? [...(extname(base) ? [base] : []), ...exts.map((ext) => base + ext)] : [base]);
  const hasDir = command.includes("/") || (WINDOWS && command.includes("\\"));
  const bases = hasDir || isAbsolute(command) ? [resolve(command)] : (env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, command));
  for (const base of bases) for (const file of candidates(base)) if (isRunnable(file)) return file;
  return null;
}

// cmd.exe quoting for a .cmd or .bat file, which Windows cannot start without
// cmd.exe. Each argument is quoted, and cmd.exe metacharacters are escaped.
const CMD_META = /[()%!^"<>&|;, ]/g;
function cmdArgument(arg) {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return quoted.replace(CMD_META, "^$&");
}

function spawnArgs(file, args) {
  if (!WINDOWS || !/\.(cmd|bat)$/i.test(file)) return [file, args, {}];
  const line = [file.replace(CMD_META, "^$&"), ...args.map(cmdArgument)].join(" ");
  return [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], { windowsVerbatimArguments: true }];
}

export function defaultSheet(env = process.env) {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "pdstack-models.md");
}

export function defaultOut(promptFile, family, model) {
  const name = basename(promptFile, extname(promptFile));
  return join(dirname(promptFile), `${name}.${family}.${model.replace(/[/\\]/g, "_")}.out.md`);
}

class Failure extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Resolves the argv to run for family and model from the sheet.
export function commandFor(sheet, family, model) {
  if (!familyEntry(`${family}:${model}`)) throw new Failure(`\`${family}:${model}\` is not a family and a model`, 2);
  const lines = readSheet(sheet);
  if (lines === null) throw new Failure(`cannot read the model sheet ${sheet}. Run setup-pdstack to write it.`, 2);
  const { families, problems } = parseSheet(lines);
  if (!families.has(family)) {
    const problem = problems.find((p) => p.startsWith(`family \`${family}\``));
    if (problem) throw new Failure(`${problem} in ${sheet}`, 2);
    const known = families.size ? `Families: ${[...families.keys()].join(", ")}.` : "The sheet has no family lines.";
    throw new Failure(`unknown family \`${family}\` in ${sheet}. ${known} Run setup-pdstack to add a family.`, 2);
  }
  let argv;
  try {
    argv = splitCommand(families.get(family)).map((arg) => arg.split("{model}").join(model));
  } catch (error) {
    throw new Failure(`family \`${family}\`: ${error.message}`, 2);
  }
  if (argv.length === 0) throw new Failure(`family \`${family}\` has no command`, 2);
  return argv;
}

export async function main(argv = process.argv.slice(2)) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        family: { type: "string" },
        model: { type: "string" },
        "prompt-file": { type: "string" },
        out: { type: "string" },
        sheet: { type: "string" },
      },
    }));
  } catch (error) {
    throw new Failure(`${error.message}\n${USAGE}`, 2);
  }
  const { family, model } = values;
  const promptFile = values["prompt-file"];
  if (!family || !model || !promptFile) throw new Failure(USAGE, 2);

  const [command, ...args] = commandFor(values.sheet ?? defaultSheet(), family, model);
  const file = findCommand(command);
  if (!file) throw new Failure(`the CLI \`${command}\` of family \`${family}\` is not on PATH. Install it, or fix the family line with setup-pdstack.`, 127);

  let input;
  try {
    input = openSync(promptFile, "r");
  } catch {
    throw new Failure(`cannot read the prompt file ${promptFile}`, 2);
  }
  const out = values.out ?? defaultOut(promptFile, family, model);
  let output;
  try {
    output = openSync(out, "w");
  } catch {
    closeSync(input);
    throw new Failure(`cannot write the out file ${out}`, 2);
  }

  const [spawnFile, spawnArgv, options] = spawnArgs(file, args);
  const code = await new Promise((done) => {
    const child = spawn(spawnFile, spawnArgv, { ...options, stdio: [input, output, "inherit"] });
    child.on("error", (error) => {
      console.error(`run-external: cannot run \`${command}\` of family \`${family}\`: ${error.message}`);
      done(127);
    });
    child.on("close", (status) => done(status ?? 1));
  });
  closeSync(input);
  closeSync(output);
  console.log(out);
  return code;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`run-external: ${error.message}`);
      process.exit(error instanceof Failure ? error.code : 1);
    },
  );
}
