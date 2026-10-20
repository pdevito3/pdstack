import { setTimeout as delay } from "node:timers/promises";
import { DeadlineExceeded, WatchDeadline } from "./deadline.mjs";
import {
  CommandExit,
  InvalidArgumentError,
  formatHelp,
  parseOptions,
} from "./options.mjs";
import {
  GhGitHubReader,
  WatcherQueryError,
  discoverStack,
  resolveContext,
} from "./github.mjs";
import {
  NO_CHECKS_CONFIRM_SECONDS,
  runQueued,
  deadlineVerdict,
  runSimple,
  statusQueryVerdict,
  verdictFactory,
} from "./policy.mjs";
import { renderJson, renderPretty } from "./render.mjs";
import { nonEmpty, parsePrNumber } from "./types.mjs";

function positiveNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new InvalidArgumentError("must be greater than zero");
  return parsed;
}
// A timer delay above 2^31 - 1 ms is replaced with 1 ms, so a longer sleep
// would return at once and the loop would poll without pause.
const MAX_SLEEP_SECONDS = (2 ** 31 - 1) / 1_000;
function sleepSeconds(value) {
  const parsed = positiveNumber(value);
  if (parsed > MAX_SLEEP_SECONDS)
    throw new InvalidArgumentError(`must be at most ${MAX_SLEEP_SECONDS}`);
  return parsed;
}
function nonNegativeNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new InvalidArgumentError("must be zero or greater");
  return parsed;
}
function positiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new InvalidArgumentError("must be a positive integer");
  return parsed;
}
function prNumber(value) {
  try {
    return parsePrNumber(Number(value.replace(/^#/, "")));
  } catch {
    throw new InvalidArgumentError("must be a positive integer");
  }
}
function stackPrList(value) {
  const numbers = value.split(",").map((part) => prNumber(part.trim()));
  if (new Set(numbers).size !== numbers.length)
    throw new InvalidArgumentError("contains a duplicate PR");
  const parsed = nonEmpty(numbers);
  if (parsed === null) throw new InvalidArgumentError("cannot be empty");
  return parsed;
}

const DESCRIPTION =
  "Watch one pull request, a connected stack, or an immutable queued stack.\nJSON (NDJSON while polling) is the default; --pretty renders human text.";
const OPTIONS = [
  {
    key: "owner",
    flags: "--owner <owner>",
    description: "GitHub repository owner",
  },
  {
    key: "repo",
    flags: "--repo <repo>",
    description: "GitHub repository name",
  },
  {
    key: "pr",
    flags: "--pr <number>",
    description: "pull request number",
    parse: prNumber,
  },
  {
    key: "stack",
    flags: "--stack",
    description: "watch the connected open stack",
    default: false,
    conflicts: "queuedStack",
  },
  {
    key: "queuedStack",
    flags: "--queued-stack",
    description: "watch the captured stack until all PRs merge",
    default: false,
  },
  {
    key: "stackPrs",
    flags: "--stack-prs <n,...>",
    description: "frozen bottom-to-top queue (queued mode only)",
    parse: stackPrList,
  },
  {
    key: "interval",
    flags: "--interval <seconds>",
    description: `poll interval; a PR with no checks takes ${NO_CHECKS_CONFIRM_SECONDS} seconds to confirm whatever this is`,
    parse: sleepSeconds,
    default: 60,
  },
  {
    key: "sweepInterval",
    flags: "--sweep-interval <seconds>",
    description: "whole-stack sweep interval",
    parse: positiveNumber,
    default: 300,
  },
  {
    key: "timeout",
    flags: "--timeout <seconds>",
    description: "deadline; 0 disables it",
    parse: nonNegativeNumber,
    default: 0,
  },
  {
    key: "maxQueryErrors",
    flags: "--max-query-errors <count>",
    description: "consecutive query-error budget",
    parse: positiveInteger,
    default: 5,
  },
  {
    key: "statusOnly",
    flags: "--status-only",
    description:
      "print one status table and exit; exit 0 means the table was read, not that the PR is ready",
    default: false,
  },
  {
    key: "allowDraft",
    flags: "--allow-draft",
    description: "do not treat a draft as a merge gate",
    default: false,
  },
  {
    key: "pretty",
    flags: "--pretty",
    description: "render human text instead of JSON",
    default: false,
  },
];
export function parseArgs(argv, io) {
  let raw;
  try {
    raw = parseOptions(argv, OPTIONS);
    if (raw !== null && raw.stackPrs !== undefined && !raw.queuedStack)
      throw new CommandExit(1, "--stack-prs requires --queued-stack");
  } catch (error) {
    if (error instanceof CommandExit) io.stderr(`error: ${error.message}\n`);
    throw error;
  }
  if (raw === null) {
    io.stdout(
      formatHelp({
        usage: "watch-pr [options]",
        description: DESCRIPTION,
        options: OPTIONS,
      })
    );
    throw new CommandExit(0, "help displayed");
  }
  return {
    owner: raw.owner ?? null,
    repo: raw.repo ?? null,
    pr: raw.pr ?? null,
    mode: raw.queuedStack ? "queued-stack" : raw.stack ? "stack" : "single",
    stackPrs: raw.stackPrs ?? [],
    statusOnly: raw.statusOnly,
    pretty: raw.pretty,
    polling: {
      interval: raw.interval,
      sweepInterval: raw.sweepInterval,
      timeout: raw.timeout,
      maxQueryErrors: raw.maxQueryErrors,
      allowDraft: raw.allowDraft,
    },
  };
}

function realRuntime(timeout) {
  const deadline = new WatchDeadline(timeout, () => performance.now() / 1_000);
  return {
    deadline,
    reader: new GhGitHubReader(deadline),
    clock: {
      now: () => performance.now() / 1_000,
      observedAt: () => new Date().toISOString(),
      sleep: async (seconds) => {
        await delay(seconds * 1_000);
      },
    },
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
}
export async function main(argv, supplied) {
  let options;
  try {
    options = parseArgs(
      argv,
      supplied ?? {
        stdout: (value) => process.stdout.write(value),
        stderr: (value) => process.stderr.write(value),
      }
    );
  } catch (error) {
    if (!(error instanceof CommandExit)) throw error;
    return error.exitCode === 0 ? 0 : 64;
  }
  const runtime = supplied ?? realRuntime(options.polling.timeout);
  const render = options.pretty ? renderPretty : renderJson;
  const emit = (verdict) => runtime.stdout(render(verdict));
  let contexts;
  try {
    const seed = await resolveContext({
      reader: runtime.reader,
      owner: options.owner,
      repo: options.repo,
      pr: options.pr ?? options.stackPrs[0] ?? null,
    });
    contexts =
      nonEmpty(options.stackPrs.map((number) => ({ ...seed, number }))) ??
      (options.mode === "single"
        ? [seed]
        : await discoverStack(runtime.reader, seed));
  } catch (error) {
    if (
      !(error instanceof WatcherQueryError) &&
      !(error instanceof DeadlineExceeded)
    )
      throw error;
    const verdict =
      error instanceof DeadlineExceeded
        ? deadlineVerdict(verdictFactory(runtime.clock, options.mode))
        : statusQueryVerdict(
            verdictFactory(runtime.clock, options.mode),
            1,
            error.failure
          );
    runtime.stdout(render(verdict));
    return verdict.exitCode;
  }
  const dependencies = {
    reader: runtime.reader,
    clock: runtime.clock,
    emit,
    deadline: runtime.deadline,
  };
  const verdict =
    options.mode === "queued-stack" && !options.statusOnly
      ? await runQueued({ dependencies, contexts, options: options.polling })
      : await runSimple({
          dependencies,
          contexts,
          mode: options.mode,
          statusOnly: options.statusOnly,
          options: options.polling,
        });
  runtime.stdout(render(verdict));
  return verdict.exitCode;
}
