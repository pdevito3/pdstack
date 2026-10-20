// The subset of commander 14.0.0 that orch.mjs uses, so the Node port keeps
// the Bun original's command line, help text, messages, and exit codes with no
// npm dependency. Parsing, errors, and help follow commander's own code; the
// features orch does not use are left out. Every command needs an action.
//
// Derived from commander.js (https://github.com/tj/commander.js), which is
// under the MIT License:
//
// Copyright (c) 2011 TJ Holowaychuk <tj@vision-media.ca>
//
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// 'Software'), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
// IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
// CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

export class CommanderError extends Error {
  constructor(exitCode, code, message) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.exitCode = exitCode;
  }
}

export class InvalidArgumentError extends CommanderError {
  constructor(message) {
    super(1, "commander.invalidArgument", message);
    this.name = this.constructor.name;
  }
}

function camelcase(value) {
  return value
    .split("-")
    .reduce((result, word) => result + word[0].toUpperCase() + word.slice(1));
}

export class Option {
  constructor(flags, description) {
    this.flags = flags;
    this.description = description || "";
    // A value must be supplied when the option is specified.
    this.required = flags.includes("<");
    this.mandatory = false;
    const parts = flags.split(/[ |,]+/);
    if (/^-[^-]$/.test(parts[0] ?? "")) {
      this.short = parts.shift();
    }
    if (/^--[^-]/.test(parts[0] ?? "")) {
      this.long = parts.shift();
    }
    this.defaultValue = undefined;
    this.envVar = undefined;
    this.parseArg = undefined;
    this.argChoices = undefined;
  }

  default(value) {
    this.defaultValue = value;
    return this;
  }

  env(name) {
    this.envVar = name;
    return this;
  }

  choices(values) {
    this.argChoices = values.slice();
    this.parseArg = (arg) => {
      if (!this.argChoices.includes(arg)) {
        throw new InvalidArgumentError(
          `Allowed choices are ${this.argChoices.join(", ")}.`
        );
      }
      return arg;
    };
    return this;
  }

  name() {
    return this.long
      ? this.long.replace(/^--/, "")
      : this.short.replace(/^-/, "");
  }

  attributeName() {
    return camelcase(this.name());
  }

  is(arg) {
    return this.short === arg || this.long === arg;
  }
}

class Argument {
  constructor(name, description) {
    this.description = description || "";
    this.parseArg = undefined;
    this.required = name[0] === "<";
    this._name = name.slice(1, -1);
  }

  name() {
    return this._name;
  }
}

function humanReadableArgName(arg) {
  return arg.required ? `<${arg.name()}>` : `[${arg.name()}]`;
}

const maxDistance = 3;

// Optimal string alignment distance: no substring is edited more than once.
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > maxDistance) {
    return Math.max(a.length, b.length);
  }
  const d = [];
  for (let i = 0; i <= a.length; i++) {
    d[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    d[0][j] = j;
  }
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

function suggestSimilar(word, candidates) {
  if (candidates.length === 0) {
    return "";
  }
  let names = Array.from(new Set(candidates));
  const searchingOptions = word.startsWith("--");
  if (searchingOptions) {
    word = word.slice(2);
    names = names.map((candidate) => candidate.slice(2));
  }
  let similar = [];
  let bestDistance = maxDistance;
  const minSimilarity = 0.4;
  for (const candidate of names) {
    if (candidate.length <= 1) {
      continue;
    }
    const distance = editDistance(word, candidate);
    const length = Math.max(word.length, candidate.length);
    const similarity = (length - distance) / length;
    if (similarity > minSimilarity) {
      if (distance < bestDistance) {
        bestDistance = distance;
        similar = [candidate];
      } else if (distance === bestDistance) {
        similar.push(candidate);
      }
    }
  }
  similar.sort((a, b) => a.localeCompare(b));
  if (searchingOptions) {
    similar = similar.map((candidate) => `--${candidate}`);
  }
  if (similar.length > 1) {
    return `\n(Did you mean one of ${similar.join(", ")}?)`;
  }
  if (similar.length === 1) {
    return `\n(Did you mean ${similar[0]}?)`;
  }
  return "";
}

const MIN_WIDTH_TO_WRAP = 40;

// Wraps at whitespace, preserving existing line breaks.
function boxWrap(value, width) {
  if (width < MIN_WIDTH_TO_WRAP) {
    return value;
  }
  const wrapped = [];
  for (const line of value.split(/\r\n|\n/)) {
    const chunks = line.match(/[\s]*[^\s]+/g);
    if (chunks === null) {
      wrapped.push("");
      continue;
    }
    let sumChunks = [chunks.shift()];
    let sumWidth = sumChunks[0].length;
    for (const chunk of chunks) {
      if (sumWidth + chunk.length <= width) {
        sumChunks.push(chunk);
        sumWidth += chunk.length;
        continue;
      }
      wrapped.push(sumChunks.join(""));
      const nextChunk = chunk.trimStart();
      sumChunks = [nextChunk];
      sumWidth = nextChunk.length;
    }
    wrapped.push(sumChunks.join(""));
  }
  return wrapped.join("\n");
}

function formatItem(term, termWidth, description, helpWidth) {
  const itemIndent = "  ";
  if (!description) {
    return itemIndent + term;
  }
  const spacerWidth = 2;
  const remainingWidth = helpWidth - termWidth - spacerWidth - itemIndent.length;
  let formatted = description;
  if (remainingWidth >= MIN_WIDTH_TO_WRAP && !/\n[^\S\r\n]/.test(description)) {
    formatted = boxWrap(description, remainingWidth).replace(
      /\n/g,
      `\n${" ".repeat(termWidth + spacerWidth)}`
    );
  }
  return (
    itemIndent +
    term.padEnd(termWidth) +
    " ".repeat(spacerWidth) +
    formatted.replace(/\n/g, `\n${itemIndent}`)
  );
}

function optionDescription(option) {
  const extraInfo = [];
  if (option.argChoices) {
    extraInfo.push(
      `choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
    );
  }
  if (option.defaultValue !== undefined) {
    // Shown for an option that takes a value, and for a boolean default.
    if (option.required || typeof option.defaultValue === "boolean") {
      extraInfo.push(`default: ${JSON.stringify(option.defaultValue)}`);
    }
  }
  if (option.envVar !== undefined) {
    extraInfo.push(`env: ${option.envVar}`);
  }
  if (extraInfo.length > 0) {
    const extraDescription = `(${extraInfo.join(", ")})`;
    return option.description
      ? `${option.description} ${extraDescription}`
      : extraDescription;
  }
  return option.description;
}

export class Command {
  constructor(name) {
    this._name = name || "";
    this._description = "";
    this._usage = undefined;
    this.parent = null;
    this.commands = [];
    this.options = [];
    this.registeredArguments = [];
    this.args = [];
    this.processedArgs = [];
    this._actionHandler = null;
    this._optionValues = {};
    this._optionValueSources = {};
    this._helpOption = new Option("-h, --help", "display help for command");
    this._exitCallback = undefined;
    this._allowExcessArguments = false;
    this._showHelpAfterError = false;
    this._outputConfiguration = {
      writeOut: (value) => process.stdout.write(value),
      writeErr: (value) => process.stderr.write(value),
      getOutHelpWidth: () =>
        process.stdout.isTTY ? process.stdout.columns : undefined,
      getErrHelpWidth: () =>
        process.stderr.isTTY ? process.stderr.columns : undefined,
    };
  }

  name() {
    return this._name;
  }

  description(value) {
    this._description = value;
    return this;
  }

  usage(value) {
    this._usage = value;
    return this;
  }

  configureOutput(configuration) {
    this._outputConfiguration = {
      ...this._outputConfiguration,
      ...configuration,
    };
    return this;
  }

  exitOverride() {
    this._exitCallback = (error) => {
      throw error;
    };
    return this;
  }

  showHelpAfterError() {
    this._showHelpAfterError = true;
    return this;
  }

  allowExcessArguments(allow = true) {
    this._allowExcessArguments = allow;
    return this;
  }

  command(nameAndArgs) {
    const [, name, args] = /([^ ]+) *(.*)/.exec(nameAndArgs) ?? [];
    const command = new Command(name);
    command._outputConfiguration = this._outputConfiguration;
    command._exitCallback = this._exitCallback;
    command._allowExcessArguments = this._allowExcessArguments;
    command._showHelpAfterError = this._showHelpAfterError;
    if (args) {
      for (const detail of args.split(/ +/)) {
        command.argument(detail);
      }
    }
    command.parent = this;
    this.commands.push(command);
    return command;
  }

  argument(name, description, parseArg) {
    const argument = new Argument(name, description);
    argument.parseArg = parseArg;
    this.registeredArguments.push(argument);
    return this;
  }

  addOption(option) {
    if (option.defaultValue !== undefined) {
      this._setOptionValue(option.attributeName(), option.defaultValue, "default");
    }
    this.options.push(option);
    return this;
  }

  option(flags, description, parseArgOrDefault) {
    const option = new Option(flags, description);
    if (typeof parseArgOrDefault === "function") {
      option.parseArg = parseArgOrDefault;
    } else {
      option.default(parseArgOrDefault);
    }
    return this.addOption(option);
  }

  requiredOption(flags, description) {
    const option = new Option(flags, description);
    option.mandatory = true;
    return this.addOption(option);
  }

  action(fn) {
    this._actionHandler = (args) => {
      const expected = this.registeredArguments.length;
      const actionArgs = args.slice(0, expected);
      actionArgs[expected] = this.opts();
      actionArgs.push(this);
      return fn.apply(this, actionArgs);
    };
    return this;
  }

  opts() {
    return this._optionValues;
  }

  async parseAsync(argv) {
    await this._parseCommand([], [...argv]);
    return this;
  }

  helpInformation(contextOptions = {}) {
    const helpWidth =
      (contextOptions.error
        ? this._outputConfiguration.getErrHelpWidth()
        : this._outputConfiguration.getOutHelpWidth()) ?? 80;
    return this._formatHelp(helpWidth);
  }

  outputHelp(contextOptions = {}) {
    const text = this.helpInformation(contextOptions);
    if (contextOptions.error) {
      this._outputConfiguration.writeErr(text);
    } else {
      this._outputConfiguration.writeOut(text);
    }
  }

  error(message, errorOptions = {}) {
    this._outputConfiguration.writeErr(`${message}\n`);
    if (this._showHelpAfterError) {
      this._outputConfiguration.writeErr("\n");
      this.outputHelp({ error: true });
    }
    this._exit(
      errorOptions.exitCode || 1,
      errorOptions.code || "commander.error",
      message
    );
  }

  _exit(exitCode, code, message) {
    if (this._exitCallback) {
      this._exitCallback(new CommanderError(exitCode, code, message));
    }
    process.exit(exitCode);
  }

  _setOptionValue(key, value, source) {
    this._optionValues[key] = value;
    this._optionValueSources[key] = source;
  }

  _getCommandAndAncestors() {
    const result = [];
    for (let command = this; command; command = command.parent) {
      result.push(command);
    }
    return result;
  }

  _findCommand(name) {
    return name ? this.commands.find((command) => command._name === name) : undefined;
  }

  _findOption(arg) {
    return this.options.find((option) => option.is(arg));
  }

  _callParseArg(target, value, previous, invalidArgumentMessage) {
    try {
      return target.parseArg(value, previous);
    } catch (error) {
      if (error.code === "commander.invalidArgument") {
        this.error(`${invalidArgumentMessage} ${error.message}`, {
          exitCode: error.exitCode,
          code: error.code,
        });
      }
      throw error;
    }
  }

  _handleOptionValue(option, value, invalidValueMessage, source) {
    const key = option.attributeName();
    let parsed = value;
    if (parsed !== null && option.parseArg) {
      parsed = this._callParseArg(
        option,
        parsed,
        this._optionValues[key],
        invalidValueMessage
      );
    }
    if (parsed == null) {
      parsed = option.required ? "" : true;
    }
    this._setOptionValue(key, parsed, source);
  }

  // Splits argv into operands and unknown arguments, storing this command's
  // options wherever they appear. The first unknown option and every argument
  // after it are left for a subcommand to parse.
  parseOptions(argv) {
    const operands = [];
    const unknown = [];
    let dest = operands;
    const args = argv.slice();
    const maybeOption = (arg) => arg.length > 1 && arg[0] === "-";
    const negativeNumberArg = (arg) =>
      /^-\d*\.?\d+(e[+-]?\d+)?$/.test(arg) &&
      !this._getCommandAndAncestors().some((command) =>
        command.options.some((option) => /^-\d$/.test(option.short ?? ""))
      );

    while (args.length) {
      const arg = args.shift();

      if (arg === "--") {
        if (dest === unknown) {
          dest.push(arg);
        }
        dest.push(...args);
        break;
      }

      if (maybeOption(arg)) {
        const option = this._findOption(arg);
        if (option) {
          if (option.required) {
            const value = args.shift();
            if (value === undefined) {
              this.error(`error: option '${option.flags}' argument missing`, {
                code: "commander.optionMissingArgument",
              });
            }
            this._handleOptionValue(
              option,
              value,
              `error: option '${option.flags}' argument '${value}' is invalid.`,
              "cli"
            );
          } else {
            this._handleOptionValue(option, undefined, "", "cli");
          }
          continue;
        }
      }

      // A known short option with its value in the same argument, like -ovalue.
      if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
        const option = this._findOption(`-${arg[1]}`);
        if (option) {
          if (option.required) {
            const value = arg.slice(2);
            this._handleOptionValue(
              option,
              value,
              `error: option '${option.flags}' argument '${value}' is invalid.`,
              "cli"
            );
          } else {
            this._handleOptionValue(option, undefined, "", "cli");
            args.unshift(`-${arg.slice(2)}`);
          }
          continue;
        }
      }

      // A known long option with its value, like --foo=bar.
      if (/^--[^=]+=/.test(arg)) {
        const index = arg.indexOf("=");
        const option = this._findOption(arg.slice(0, index));
        if (option && option.required) {
          const value = arg.slice(index + 1);
          this._handleOptionValue(
            option,
            value,
            `error: option '${option.flags}' argument '${value}' is invalid.`,
            "cli"
          );
          continue;
        }
      }

      // A negative number in a leaf command is not an unknown option.
      if (
        dest === operands &&
        maybeOption(arg) &&
        !(this.commands.length === 0 && negativeNumberArg(arg))
      ) {
        dest = unknown;
      }
      dest.push(arg);
    }
    return { operands, unknown };
  }

  _parseOptionsEnv() {
    for (const option of this.options) {
      // Only options that take a value read the environment here.
      if (option.required && option.envVar && option.envVar in process.env) {
        const key = option.attributeName();
        if (
          this._optionValues[key] === undefined ||
          ["default", "env"].includes(this._optionValueSources[key])
        ) {
          const value = process.env[option.envVar];
          this._handleOptionValue(
            option,
            value,
            `error: option '${option.flags}' value '${value}' from env '${option.envVar}' is invalid.`,
            "env"
          );
        }
      }
    }
  }

  _parseCommand(operands, unknown) {
    const parsed = this.parseOptions(unknown);
    this._parseOptionsEnv();
    operands = operands.concat(parsed.operands);
    unknown = parsed.unknown;
    this.args = operands.concat(unknown);

    const subcommand = this._findCommand(operands[0]);
    if (subcommand) {
      return subcommand._parseCommand(operands.slice(1), unknown);
    }

    if (unknown.some((arg) => this._helpOption.is(arg))) {
      this.outputHelp();
      this._exit(0, "commander.helpDisplayed", "(outputHelp)");
    }
    for (const command of this._getCommandAndAncestors()) {
      for (const option of command.options) {
        if (
          option.mandatory &&
          command._optionValues[option.attributeName()] === undefined
        ) {
          command.error(`error: required option '${option.flags}' not specified`, {
            code: "commander.missingMandatoryOptionValue",
          });
        }
      }
    }

    if (parsed.unknown.length > 0) {
      this._unknownOption(parsed.unknown[0]);
    }
    this._processArguments();
    return this._actionHandler(this.processedArgs);
  }

  _unknownOption(flag) {
    let suggestion = "";
    if (flag.startsWith("--")) {
      const candidates = [];
      for (const command of this._getCommandAndAncestors()) {
        for (const option of command._visibleOptions()) {
          if (option.long) {
            candidates.push(option.long);
          }
        }
      }
      suggestion = suggestSimilar(flag, candidates);
    }
    this.error(`error: unknown option '${flag}'${suggestion}`, {
      code: "commander.unknownOption",
    });
  }

  _processArguments() {
    this.registeredArguments.forEach((argument, index) => {
      if (argument.required && this.args[index] == null) {
        this.error(`error: missing required argument '${argument.name()}'`, {
          code: "commander.missingArgument",
        });
      }
    });
    if (
      this.args.length > this.registeredArguments.length &&
      !this._allowExcessArguments
    ) {
      const expected = this.registeredArguments.length;
      const s = expected === 1 ? "" : "s";
      const forSubcommand = this.parent ? ` for '${this.name()}'` : "";
      this.error(
        `error: too many arguments${forSubcommand}. Expected ${expected} argument${s} but got ${this.args.length}.`,
        { code: "commander.excessArguments" }
      );
    }
    this.processedArgs = this.registeredArguments.map((argument, index) => {
      if (index >= this.args.length) {
        return undefined;
      }
      const value = this.args[index];
      return argument.parseArg
        ? this._callParseArg(
            argument,
            value,
            undefined,
            `error: command-argument value '${value}' is invalid for argument '${argument.name()}'.`
          )
        : value;
    });
  }

  _visibleOptions() {
    return [...this.options, this._helpOption];
  }

  _visibleArguments() {
    return this.registeredArguments.some((argument) => argument.description)
      ? this.registeredArguments
      : [];
  }

  _commandUsage() {
    let ancestors = "";
    for (let command = this.parent; command; command = command.parent) {
      ancestors = `${command.name()} ${ancestors}`;
    }
    const usage =
      this._usage ??
      [
        "[options]",
        ...(this.commands.length ? ["[command]"] : []),
        ...this.registeredArguments.map(humanReadableArgName),
      ].join(" ");
    return `${ancestors}${this._name} ${usage}`;
  }

  _subcommandTerm() {
    const args = this.registeredArguments.map(humanReadableArgName).join(" ");
    return (
      this._name +
      (this.options.length ? " [options]" : "") +
      (args ? ` ${args}` : "")
    );
  }

  _formatHelp(helpWidth) {
    const argumentRows = this._visibleArguments().map((argument) => [
      argument.name(),
      argument.description,
    ]);
    const optionRows = this._visibleOptions().map((option) => [
      option.flags,
      optionDescription(option),
    ]);
    const commandRows = this.commands.map((command) => [
      command._subcommandTerm(),
      command._description,
    ]);
    const termWidth = Math.max(
      0,
      ...[...argumentRows, ...optionRows, ...commandRows].map(
        ([term]) => term.length
      )
    );
    const list = (heading, rows) =>
      rows.length === 0
        ? []
        : [
            heading,
            ...rows.map(([term, description]) =>
              formatItem(term, termWidth, description, helpWidth)
            ),
            "",
          ];

    let output = [`Usage: ${this._commandUsage()}`, ""];
    if (this._description.length > 0) {
      output.push(boxWrap(this._description, helpWidth), "");
    }
    output = output.concat(
      list("Arguments:", argumentRows),
      list("Options:", optionRows),
      list("Commands:", commandRows)
    );
    return output.join("\n");
  }
}
