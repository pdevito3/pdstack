// The slice of commander that watch-pr and ship-pr used, on node:util parseArgs:
// typed options with parsers and defaults, required options, conflicts,
// subcommands, help text, and commander's usage error messages.
import { parseArgs } from "node:util";

/** A parser throws this to reject an option value, as commander's did. */
export class InvalidArgumentError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidArgumentError";
  }
}

/**
 * Ends a parse: help was shown (exit code 0) or a usage error was written to
 * stderr (exit code 1). Callers map a non-zero code to EX_USAGE.
 */
export class CommandExit extends Error {
  constructor(exitCode, message) {
    super(message);
    this.name = "CommandExit";
    this.exitCode = exitCode;
  }
}

/**
 * @typedef {object} OptionSpec
 * @property {string} key result key, for example "maxQueryErrors"
 * @property {string} flags for example "--max-query-errors <count>"
 * @property {string} [description]
 * @property {(value: string) => unknown} [parse]
 * @property {unknown} [default]
 * @property {boolean} [required]
 * @property {string} [conflicts] key of an option this one cannot be used with
 */

/**
 * @typedef {object} CommandSpec
 * @property {string} name
 * @property {string} [description]
 * @property {readonly OptionSpec[]} options
 */

const HELP_FLAGS = "-h, --help";
const HELP_DESCRIPTION = "display help for command";
const HELP_WIDTH = 80;

const longName = (spec) => spec.flags.split(/[ ,]/)[0].replace(/^--/, "");
const takesValue = (spec) => /<[^>]+>/.test(spec.flags);

function wrap(text, width) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (line && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

function rows(entries, width) {
  const descriptionWidth = HELP_WIDTH - width - 4;
  return entries.flatMap(([term, description]) => {
    if (!description) return [`  ${term}`];
    const [first, ...rest] = wrap(description, descriptionWidth);
    return [
      `  ${term.padEnd(width)}  ${first}`,
      ...rest.map((line) => `  ${" ".repeat(width)}  ${line}`),
    ];
  });
}

const optionDescription = (spec) =>
  [
    spec.description ?? "",
    spec.default === undefined
      ? ""
      : `(default: ${JSON.stringify(spec.default)})`,
  ]
    .filter(Boolean)
    .join(" ");

/**
 * @param {{ readonly usage: string, readonly description?: string, readonly options: readonly OptionSpec[], readonly commands?: readonly CommandSpec[] }} help
 */
export function formatHelp(help) {
  const options = [
    ...help.options.map((spec) => [spec.flags, optionDescription(spec)]),
    [HELP_FLAGS, HELP_DESCRIPTION],
  ];
  const commands = help.commands
    ? [
        ...help.commands.map((command) => [
          command.options.length ? `${command.name} [options]` : command.name,
          command.description ?? "",
        ]),
        ["help [command]", HELP_DESCRIPTION],
      ]
    : [];
  // One term column across both sections, as commander aligned them.
  const width = Math.max(
    ...[...options, ...commands].map(([term]) => term.length)
  );
  const sections = [`Usage: ${help.usage}`];
  if (help.description)
    sections.push(wrap(help.description, HELP_WIDTH).join("\n"));
  sections.push(["Options:", ...rows(options, width)].join("\n"));
  if (commands.length)
    sections.push(["Commands:", ...rows(commands, width)].join("\n"));
  return `${sections.join("\n\n")}\n`;
}

/**
 * Parses options the way commander did. Invalid values fail first, in order;
 * then help, conflicts, unknown options, excess arguments, and missing
 * required options. Returns the values, or null when `-h`/`--help` was given.
 *
 * @param {readonly string[]} argv
 * @param {readonly OptionSpec[]} specs
 * @param {string} [command] subcommand name, for the excess-argument message
 * @returns {Record<string, unknown> | null}
 */
export function parseOptions(argv, specs, command) {
  const byName = new Map(specs.map((spec) => [longName(spec), spec]));
  const { tokens } = parseArgs({
    args: [...argv],
    options: {
      ...Object.fromEntries(
        specs.map((spec) => [
          longName(spec),
          { type: takesValue(spec) ? "string" : "boolean" },
        ])
      ),
      help: { type: "boolean", short: "h" },
    },
    strict: false,
    allowPositionals: true,
    tokens: true,
  });
  const values = Object.fromEntries(
    specs
      .filter((spec) => spec.default !== undefined)
      .map((spec) => [spec.key, spec.default])
  );
  const seen = new Set();
  let help = false;
  let unknown = null;
  let excess = 0;
  for (const token of tokens) {
    if (token.kind === "positional") {
      excess += 1;
      continue;
    }
    if (token.kind !== "option") continue;
    const spec = byName.get(token.name);
    if (token.name === "help" && token.value === undefined) {
      help = true;
    } else if (
      spec === undefined ||
      (!takesValue(spec) && token.value !== undefined)
    ) {
      unknown ??=
        token.value === undefined
          ? token.rawName
          : `${token.rawName}=${token.value}`;
    } else if (!takesValue(spec)) {
      values[spec.key] = true;
      seen.add(spec.key);
    } else if (token.value === undefined) {
      throw new CommandExit(1, `option '${spec.flags}' argument missing`);
    } else {
      try {
        values[spec.key] = spec.parse ? spec.parse(token.value) : token.value;
      } catch (error) {
        if (!(error instanceof InvalidArgumentError)) throw error;
        throw new CommandExit(
          1,
          `option '${spec.flags}' argument '${token.value}' is invalid. ${error.message}`
        );
      }
      seen.add(spec.key);
    }
  }
  if (help) return null;
  for (const spec of specs) {
    const other = specs.find((candidate) => candidate.key === spec.conflicts);
    if (other && seen.has(spec.key) && seen.has(other.key))
      throw new CommandExit(
        1,
        `option '${spec.flags}' cannot be used with option '${other.flags}'`
      );
  }
  if (unknown !== null) throw new CommandExit(1, `unknown option '${unknown}'`);
  if (excess > 0)
    throw new CommandExit(
      1,
      `too many arguments${command ? ` for '${command}'` : ""}. Expected 0 arguments but got ${excess}.`
    );
  for (const spec of specs)
    if (spec.required && values[spec.key] === undefined)
      throw new CommandExit(1, `required option '${spec.flags}' not specified`);
  return values;
}
