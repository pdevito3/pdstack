import { readFile } from "node:fs/promises";
import { WatchDeadline } from "./deadline.mjs";
import { runJson } from "./github.mjs";
import { object, parseContext } from "./landing.mjs";
import { CommandExit, formatHelp, parseOptions } from "./options.mjs";
import {
  GhShippingService,
  cancelPending,
  inspectLanding,
  parseLandingRecord,
} from "./shipping.mjs";

const DESCRIPTION =
  "Inspect a landing record or cancel its pending merge mechanisms. Never merges or rewrites branches.";
const COMMANDS = [
  {
    name: "inspect",
    options: [
      { key: "repo", flags: "--repo <owner/repo>", required: true },
      { key: "pr", flags: "--pr <number>", required: true },
    ],
  },
  {
    name: "cancel-pending",
    options: [
      {
        key: "record",
        flags: "--record <file>",
        description: "JSON output from inspect or a successful cancellation",
        required: true,
      },
    ],
  },
];
const programHelp = () =>
  formatHelp({
    usage: "ship-pr [options] [command]",
    description: DESCRIPTION,
    options: [],
    commands: COMMANDS,
  });
const commandHelp = (command) =>
  formatHelp({
    usage: `ship-pr ${command.name} [options]`,
    options: command.options,
  });

// Routes argv to a subcommand the way commander did: help goes to stdout with
// exit 0, a usage error or missing command goes to stderr with exit 1.
function route(argv) {
  const [first, ...rest] = argv;
  const find = (name) => COMMANDS.find((command) => command.name === name);
  if (first === undefined) {
    process.stderr.write(programHelp());
    throw new CommandExit(1, "no command");
  }
  if (first === "help") {
    if (rest.length === 0) {
      process.stdout.write(programHelp());
      throw new CommandExit(0, "help displayed");
    }
    const command = find(rest[0]);
    if (command === undefined) {
      process.stderr.write(programHelp());
      throw new CommandExit(1, "unknown command");
    }
    process.stdout.write(commandHelp(command));
    throw new CommandExit(0, "help displayed");
  }
  const command = find(first);
  if (command === undefined) {
    if (first === "-h" || first === "--help") {
      process.stdout.write(programHelp());
      throw new CommandExit(0, "help displayed");
    }
    const message = first.startsWith("-")
      ? `unknown option '${first}'`
      : `unknown command '${first}'`;
    process.stderr.write(`error: ${message}\n`);
    throw new CommandExit(1, message);
  }
  let options;
  try {
    options = parseOptions(rest, command.options, command.name);
  } catch (error) {
    if (error instanceof CommandExit)
      process.stderr.write(`error: ${error.message}\n`);
    throw error;
  }
  if (options === null) {
    process.stdout.write(commandHelp(command));
    throw new CommandExit(0, "help displayed");
  }
  return { name: command.name, options };
}

export async function main(argv) {
  let result;
  const deadline = new WatchDeadline(60, () => performance.now() / 1000);
  const service = new GhShippingService((args) => runJson(args, deadline));
  const actions = {
    inspect: async (options) => {
      const parts = options.repo.split("/");
      if (parts.length !== 2) throw new Error("--repo must be owner/repo");
      const context = parseContext({
        owner: parts[0],
        repo: parts[1],
        number: Number(options.pr),
      });
      result = await inspectLanding(service, context);
    },
    "cancel-pending": async (options) => {
      const input = object(
        JSON.parse(await readFile(options.record, "utf8")),
        "saved inspection"
      );
      if (input.kind !== "inspected" && input.kind !== "cancelled")
        throw new Error(
          "record must contain a successful inspection or cancellation"
        );
      result = await cancelPending(service, parseLandingRecord(input.record));
    },
  };
  try {
    const { name, options } = route(argv);
    await actions[name](options);
    if (!result) return 64;
  } catch (error) {
    if (error instanceof CommandExit) return error.exitCode === 0 ? 0 : 64;
    result = {
      kind: "unavailable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.kind === "inspected" || result.kind === "cancelled" ? 0 : 1;
}
