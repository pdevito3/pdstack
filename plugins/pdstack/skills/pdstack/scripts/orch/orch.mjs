#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Command as CommanderCommand,
  CommanderError,
  InvalidArgumentError,
  Option,
} from "./commander.mjs";
import {
  NotFoundError,
  UsageError,
  openStore,
  parseVerdict,
} from "./store.mjs";

const DISPLAY_LIMIT = 4;

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function positiveInteger(value) {
  const parsed = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(parsed)) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return parsed;
}

function prList(value) {
  const parts = value.split(",");
  if (parts.some((part) => part.length === 0)) {
    throw new InvalidArgumentError("requires a comma-separated PR list");
  }
  return parts.map(positiveInteger);
}

function countLine(value) {
  const entries = Object.entries(value);
  return entries.length === 0
    ? "none"
    : entries.map(([name, count]) => `${name}=${count}`).join(", ");
}

function unitLine(unit) {
  return [
    unit.id,
    unit.track,
    unit.state,
    unit.branch,
    unit.pr,
    unit.sha,
    unit.brief,
  ].join("\t");
}

function pointerLine(pointer) {
  return [
    pointer.ts,
    pointer.agent,
    pointer.unit,
    pointer.status,
    pointer.report,
  ].join("\t");
}

function gateLine(gate) {
  return [
    gate.id,
    gate.question,
    gate.options,
    gate.defaultAnswer,
  ].join("\t");
}

function compactRows(
  rows,
  format,
  empty,
  limit = DISPLAY_LIMIT
) {
  if (rows.length === 0) {
    return empty;
  }
  const visible = limit === null ? rows : rows.slice(0, limit);
  const lines = visible.map(format);
  if (limit !== null && rows.length > limit) {
    lines.push(`... ${rows.length - limit} more; use --json`);
  }
  return lines.join("\n");
}

function frontierLine(value) {
  const prs =
    value.prs.length === 0
      ? "none"
      : value.prs
          .map(
            (row) =>
              `${row.branches}#${row.pr}@${row.sha}:${row.state}`
          )
          .join(",");
  return `generation=${value.generation} prs=${prs} lowest-unmerged=${value.lowestUnmerged ?? "none"}`;
}

function statusLines(report) {
  const visible = report.summary.openGateIds.slice(0, DISPLAY_LIMIT);
  const more =
    report.summary.openGateIds.length > DISPLAY_LIMIT
      ? `,+${report.summary.openGateIds.length - DISPLAY_LIMIT} more`
      : "";
  return [
    `counts: units=${report.units.length}; states=${countLine(report.summary.unitStates)}; ledger=${countLine(report.summary.ledgerVerdicts)}`,
    `changed: ${report.changed}`,
    `gates open: ${report.summary.openGateIds.length}${
      visible.length > 0 ? `; ids=${visible.join(",")}${more}` : ""
    }`,
  ].join("\n");
}

function emit(
  io,
  json,
  value,
  compact,
  jsonValue = (result) => result
) {
  const rendered = json
    ? JSON.stringify(jsonValue(value), null, 2)
    : compact(value);
  io.stdout(rendered.endsWith("\n") ? rendered : `${rendered}\n`);
}

function storeDirectory(program) {
  const value = program.opts().store;
  if (value === undefined || value.trim().length === 0) {
    throw new UsageError("set --store <dir> or ORCH_STORE");
  }
  return value;
}

function frontierRepo(options) {
  const value = options.repo;
  if (value === undefined || value.trim().length === 0) {
    throw new UsageError("set --repo <dir> or ORCH_REPO");
  }
  return value;
}

async function runStore(
  program,
  io,
  operation,
  compact,
  jsonValue
) {
  const options = program.opts();
  const store = openStore(storeDirectory(program), {
    force: options.force,
    onLockStolen: (holder) =>
      io.stderr(`stealing store lock held by pid ${holder}\n`),
    onStaleLock: (holder) =>
      io.stderr(`replacing stale store lock (pid ${holder} is dead)\n`),
  });
  try {
    const result = await operation(store);
    emit(io, options.json, result, compact, jsonValue);
  } finally {
    await store.close();
  }
}

function leaf(parent, name, description) {
  return parent
    .command(name)
    .description(description)
    .allowExcessArguments(false);
}

function requireSubcommand(program) {
  storeDirectory(program);
  throw new UsageError("a valid command is required");
}

function createProgram(io) {
  const program = new CommanderCommand("orch")
    .description("Plain-file orchestrate bookkeeping")
    .usage("[--store <dir>] [--json] [--force] <command>")
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .exitOverride()
    .showHelpAfterError()
    .allowExcessArguments(false)
    .addOption(
      new Option("--store <dir>", "store directory (or ORCH_STORE)").env(
        "ORCH_STORE"
      )
    )
    .option("--json", "print complete rows as JSON", false)
    .option("--force", "steal an existing store lock", false);

  leaf(program, "init", "initialize the store").action(() =>
    runStore(
      program,
      io,
      (store) => store.init(),
      (result) => `initialized ${result.store}`
    )
  );

  const unit = program
    .command("unit")
    .description("manage work units")
    .action(() => requireSubcommand(program));
  leaf(unit, "add <id>", "add a unit")
    .requiredOption("--track <track>", "unit track")
    .option("--brief <path>", "brief path")
    .action((id, options) =>
      runStore(
        program,
        io,
        (store) =>
          store.units.add({
            id,
            track: options.track,
            brief: options.brief,
          }),
        unitLine
      )
    );
  leaf(unit, "set <id>", "update a unit")
    .requiredOption("--state <state>", "unit state")
    .option("--branch <branch>", "branch name")
    .option("--pr <number>", "pull request number", positiveInteger)
    .option("--sha <sha>", "commit SHA")
    .action((id, options) =>
      runStore(
        program,
        io,
        (store) =>
          store.units.set({
            id,
            state: options.state,
            branch: options.branch,
            pr: options.pr,
            sha: options.sha,
          }),
        unitLine
      )
    );
  leaf(unit, "get <id>", "get a unit").action((id) =>
    runStore(program, io, (store) => store.units.get(id), unitLine)
  );
  leaf(unit, "list", "list units")
    .option("--state <state>", "filter by state")
    .option("--track <track>", "filter by track")
    .action((options) =>
      runStore(
        program,
        io,
        (store) => store.units.list(options),
        (rows) => compactRows(rows, unitLine, "(no units)")
      )
    );
  leaf(unit, "counts", "count units by state").action(() =>
    runStore(program, io, (store) => store.units.counts(), countLine)
  );

  const ledger = program
    .command("ledger")
    .description("manage verification records")
    .action(() => requireSubcommand(program));
  leaf(ledger, "record", "record a verification verdict")
    .argument("<pr>", "pull request number", positiveInteger)
    .argument("<sha>", "commit SHA")
    .argument("<verdict>", "verification verdict", parseVerdict)
    .requiredOption("--evidence <path>", "evidence path")
    .option("--verifier <name>", "verifier name")
    .action(
      (
        pr,
        sha,
        verdict,
        options
      ) =>
        runStore(
          program,
          io,
          (store) =>
            store.ledger.record({
              pr,
              sha,
              verdict,
              evidence: options.evidence,
              verifier: options.verifier,
            }),
          (row) => `${row.pr}\t${row.sha}\t${row.verdict}`
        )
    );
  leaf(ledger, "check", "check a verification verdict")
    .argument("<pr>", "pull request number", positiveInteger)
    .argument("<sha>", "commit SHA")
    .action((pr, sha) =>
      runStore(
        program,
        io,
        (store) => store.ledger.check({ pr, sha }),
        (row) => row.verdict
      )
    );
  leaf(ledger, "summary", "count verification verdicts").action(() =>
    runStore(program, io, (store) => store.ledger.summary(), countLine)
  );

  const inbox = program
    .command("inbox")
    .description("manage agent pointers")
    .action(() => requireSubcommand(program));
  leaf(inbox, "push <agent> <unit> <status>", "push an inbox pointer")
    .option("--report <path>", "report path")
    .action(
      (
        agent,
        unitId,
        status,
        options
      ) =>
        runStore(
          program,
          io,
          (store) =>
            store.inbox.push({
              agent,
              unit: unitId,
              status,
              report: options.report,
            }),
          (result) =>
            `${result.pointer.unit}\t${result.pointer.status}\t${result.filename}`,
          (result) => result.pointer
        )
    );
  leaf(inbox, "drain", "drain inbox pointers")
    .option("--peek", "read without draining", false)
    .action((options) =>
      runStore(
        program,
        io,
        (store) =>
          options.peek ? store.inbox.peek() : store.inbox.drain(),
        (rows) => compactRows(rows, pointerLine, "(empty)", null)
      )
    );
  leaf(inbox, "count", "count inbox pointers").action(() =>
    runStore(
      program,
      io,
      (store) => store.inbox.count(),
      String,
      (count) => ({ count })
    )
  );

  const gate = program
    .command("gate")
    .description("manage decision gates")
    .action(() => requireSubcommand(program));
  leaf(gate, "park <id>", "park a decision gate")
    .requiredOption("--question <question>", "gate question")
    .requiredOption("--options <options>", "gate options")
    .requiredOption("--default <answer>", "default answer")
    .action((id, options) =>
      runStore(
        program,
        io,
        (store) =>
          store.gates.park({
            id,
            question: options.question,
            options: options.options,
            defaultAnswer: options.default,
          }),
        (result) => `${result.id}\topen`
      )
    );
  leaf(gate, "list", "list open decision gates").action(() =>
    runStore(
      program,
      io,
      (store) => store.gates.list(),
      (rows) => compactRows(rows, gateLine, "(no open gates)")
    )
  );
  leaf(gate, "resolve <id>", "resolve a decision gate")
    .requiredOption("--answer <answer>", "chosen answer")
    .action((id, options) =>
      runStore(
        program,
        io,
        (store) => store.gates.resolve({ id, answer: options.answer }),
        (result) => `${result.id}\tresolved\t${result.answer}`
      )
    );

  const frontier = program
    .command("frontier")
    .description("manage the stack frontier")
    .action(() => requireSubcommand(program));
  leaf(
    frontier,
    "set",
    "resolve the pull request base chain and set the frontier"
  )
    .addOption(
      new Option(
        "--repo <dir>",
        "repository directory (or ORCH_REPO)"
      ).env("ORCH_REPO")
    )
    .addOption(
      new Option("--forge <forge>", "pull request forge")
        .choices(["gh", "origin"])
        .default("gh")
    )
    .option(
      "--prs <n,...>",
      "optional expected pull request order pin",
      prList
    )
    .action((options) =>
      runStore(
        program,
        io,
        (store) =>
          store.frontier.set({
            repo: frontierRepo(options),
            forge: options.forge,
            prs: options.prs,
          }),
        frontierLine
      )
    );
  leaf(frontier, "show", "show the frontier").action(() =>
    runStore(program, io, (store) => store.frontier.show(), frontierLine)
  );

  leaf(program, "status", "render status.md and print a summary").action(() =>
    runStore(program, io, (store) => store.status.render(), statusLines)
  );

  const standing = program
    .command("standing")
    .description("manage standing orders")
    .action(() => requireSubcommand(program));
  leaf(standing, "show", "show standing orders").action(() =>
    runStore(
      program,
      io,
      (store) => store.standing.show(),
      (rows) =>
        compactRows(
          rows,
          (item) => `${item.number}. ${item.line}`,
          "(no standing orders)"
        )
    )
  );
  leaf(standing, "add <line>", "add a standing order").action((line) =>
    runStore(
      program,
      io,
      (store) => store.standing.add({ line }),
      (item) => `${item.number}. ${item.line}`
    )
  );

  program.action(() => requireSubcommand(program));
  return program;
}

function handleError(error, program, io) {
  if (error instanceof CommanderError) {
    return error.exitCode === 0 ? 0 : 1;
  }
  const json = program.opts().json;
  if (error instanceof NotFoundError) {
    const output = error.output;
    if (output === undefined) {
      io.stderr(`error: ${error.message}\n`);
    } else {
      emit(io, json, output.json, () => output.compact);
    }
    return 2;
  }
  io.stderr(`error: ${message(error)}\n`);
  if (error instanceof UsageError) {
    io.stderr(program.helpInformation());
  }
  return 1;
}

export async function main(
  argv,
  io = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  }
) {
  const program = createProgram(io);
  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    return handleError(error, program, io);
  }
}

// import.meta.main arrived in Node 24.2, so earlier releases compare paths.
if (
  import.meta.main ??
  resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main(process.argv.slice(2));
}
