import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const UNIT_HEADER = "id\ttrack\tstate\tbranch\tpr\tsha\tbrief";
const LEDGER_HEADER = "pr\tsha\tverdict\tevidence\tverifier\tts";
const LOCK_FILE = ".orch.lock";
const TAKEOVER_DIR = ".orch.lock.takeover";
const FORGE_TIMEOUT_MS = 60_000;

export class UserError extends Error {}
export class UsageError extends UserError {}
export class NotFoundError extends UserError {
  constructor(message, output) {
    super(message);
    this.output = output;
  }
}

function errorCode(error) {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUnknownArray(value) {
  return Array.isArray(value);
}

function verdictOrNull(value) {
  switch (value) {
    case "live-ui-verified":
    case "unit-test-verified":
    case "type-check-only":
    case "verifier-blocked":
    case "verifier-failed":
      return value;
    default:
      return null;
  }
}

function frontierPrStateOrNull(value) {
  switch (value) {
    case "OPEN":
    case "MERGED":
    case "CLOSED":
      return value;
    default:
      return null;
  }
}

export function parseVerdict(value) {
  const verdict = verdictOrNull(value);
  if (verdict === null) {
    throw new UserError(
      "verdict must be live-ui-verified, unit-test-verified, type-check-only, verifier-blocked, or verifier-failed"
    );
  }
  return verdict;
}

// A spreadsheet reads a leading = + - or @ as a formula and a leading ' as a
// text marker. Such a cell is written with one more ' and unquoteCell strips it.
function cleanCell(value) {
  const cleaned = value.replace(/[\t\n\r]/g, " ");
  return /^['=+\-@]/.test(cleaned) ? `'${cleaned}` : cleaned;
}

// A row written before cells were unquoted on read can start with a ' that is
// data, so only a ' that cleanCell would have added is stripped.
function unquoteCell(value) {
  return /^'['=+\-@]/.test(value) ? value.slice(1) : value;
}

function requiredCell(value, label) {
  const cleaned = value.replace(/[\t\n\r]/g, " ");
  if (cleaned.trim().length === 0) {
    throw new UserError(`${label} must not be empty`);
  }
  return cleaned;
}

function requiredLine(value, label) {
  const cleaned = value.replace(/[\n\r]/g, " ").trim();
  if (cleaned.length === 0) {
    throw new UserError(`${label} must not be empty`);
  }
  return cleaned;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new UserError(`${label} must be a positive integer`);
  }
  return value;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function atomicWrite(path, contents) {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function writeIfMissing(path, contents) {
  if (!(await exists(path))) {
    await atomicWrite(path, contents);
  }
}

async function requiredFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new UserError(
        `store is not initialized at ${dirname(path)}; run orch init`
      );
    }
    throw error;
  }
}

function holderIsDead(holder) {
  const pid = Number.parseInt(holder, 10);
  if (!Number.isSafeInteger(pid) || pid <= 0 || String(pid) !== holder) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return errorCode(error) === "ESRCH";
  }
}

async function acquireLock(
  store,
  options
) {
  const path = join(store, LOCK_FILE);
  const takeover = join(store, TAKEOVER_DIR);
  const pid = String(process.pid);

  // A writer killed between an exclusive open and its write leaves an empty
  // lock, which names no pid to judge dead. The pid goes into a private file
  // that is hard-linked into place, so the lock appears with its pid in it.
  // A filesystem without hard links gets the exclusive open.
  const create = async () => {
    const pidFile = `${path}.${pid}.${randomUUID()}`;
    await writeFile(pidFile, `${pid}\n`, { flag: "wx" });
    try {
      await link(pidFile, path);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        throw error;
      }
      await writeFile(path, `${pid}\n`, { flag: "wx" });
    } finally {
      await unlink(pidFile).catch(() => {});
    }
  };

  // Resolves to null once this writer holds the lock, or to the pid in the
  // lock that stopped it. A holder can release between the failed create and
  // the read, and a lock that vanished can be created again.
  const lockOrHolder = async () => {
    for (let retries = 2; ; retries -= 1) {
      try {
        await create();
        return null;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") {
          throw error;
        }
      }
      try {
        return (await readFile(path, "utf8")).trim() || "unknown";
      } catch (error) {
        if (errorCode(error) !== "ENOENT" || retries === 0) {
          return "unknown";
        }
      }
    }
  };

  // POSIX cannot unlink a file only if its content still matches, so each
  // read-and-unlink runs behind a claim: a directory that holds one file
  // named for the claimant's pid. rename cannot replace a directory that
  // holds a file, so a claim excludes every other writer, and a dead
  // claimant's file is removed by name, which cannot remove a live claimant's.
  // Resolves to false, without running the body, when a live writer holds
  // the claim.
  const claimed = async (body) => {
    const staged = `${takeover}.${pid}.${randomUUID()}`;
    const discard = () =>
      rm(staged, { recursive: true, force: true }).catch(() => {});
    await mkdir(staged);
    try {
      await writeFile(join(staged, pid), "");
      for (const claimant of await readdir(takeover).catch(() => [])) {
        if (holderIsDead(claimant)) {
          await rm(join(takeover, claimant), { force: true });
        }
      }
      // Windows cannot rename a directory onto any existing directory, so a
      // claim that a sweep emptied is removed first. rmdir removes only an
      // empty directory, and a live claim always holds its claimant's file.
      if (process.platform === "win32") {
        await rmdir(takeover).catch(() => {});
      }
      await rename(staged, takeover);
    } catch (error) {
      await discard();
      const code = errorCode(error);
      // Windows refuses the rename onto a live claim with EPERM.
      const windowsClaimed =
        process.platform === "win32" &&
        code === "EPERM" &&
        (await exists(takeover));
      if (code !== "ENOTEMPTY" && code !== "EEXIST" && !windowsClaimed) {
        throw error;
      }
      return false;
    }
    try {
      await body();
    } finally {
      await rename(takeover, staged).catch(() => {});
      await discard();
    }
    return true;
  };

  const takeOver = async (holder) => {
    const replaced = await claimed(async () => {
      try {
        const current = (await readFile(path, "utf8")).trim() || "unknown";
        if (current !== holder) {
          throw new UserError(`store lock held by pid ${current}`);
        }
        await unlink(path);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          throw error;
        }
      }
      const blocker = await lockOrHolder();
      if (blocker !== null) {
        throw new UserError(`store lock held by pid ${blocker}`);
      }
    });
    if (!replaced) {
      throw new UserError(
        `store lock held by pid ${holder} is being replaced by another writer; retry`
      );
    }
  };

  const holder = await lockOrHolder();
  if (holder !== null) {
    if (holderIsDead(holder)) {
      options.onStaleLock?.(holder);
      await takeOver(holder);
    } else if (options.force) {
      options.onLockStolen?.(holder);
      await takeOver(holder);
    } else {
      throw new UserError(`store lock held by pid ${holder}`);
    }
  }

  // A claimant that refuses the release is replacing the lock. It finishes or
  // dies, and the next claim sweeps a dead one, so the release tries again.
  return async () => {
    const removeOwn = async () => {
      try {
        if ((await readFile(path, "utf8")).trim() === pid) {
          await unlink(path);
        }
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          throw error;
        }
      }
    };
    for (;;) {
      if (await claimed(removeOwn)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
}

async function readTsv(
  path,
  header,
  width
) {
  const lines = (await requiredFile(path)).replace(/\r/g, "").split("\n");
  if (lines.shift() !== header) {
    throw new UserError(`${basename(path)} has an invalid header`);
  }
  return lines
    .filter((value) => value.length > 0)
    .map((value) => {
      const cells = value.split("\t");
      if (cells.length !== width) {
        throw new UserError(`${basename(path)} has a malformed row`);
      }
      return cells.map(unquoteCell);
    });
}

async function writeTsv(
  path,
  header,
  rows
) {
  const body = rows.map((row) => row.map(cleanCell).join("\t")).join("\n");
  await atomicWrite(path, `${header}\n${body}${body.length > 0 ? "\n" : ""}`);
}

async function readUnits(store) {
  return (await readTsv(join(store, "units.tsv"), UNIT_HEADER, 7)).map(
    (row) => ({
      id: row[0] ?? "",
      track: row[1] ?? "",
      state: row[2] ?? "",
      branch: row[3] ?? "",
      pr: row[4] ?? "",
      sha: row[5] ?? "",
      brief: row[6] ?? "",
    })
  );
}

function unitCells(unit) {
  return [
    unit.id,
    unit.track,
    unit.state,
    unit.branch,
    unit.pr,
    unit.sha,
    unit.brief,
  ];
}

async function saveUnits(store, rows) {
  await writeTsv(
    join(store, "units.tsv"),
    UNIT_HEADER,
    rows.map(unitCells)
  );
}

async function readLedger(store) {
  return (await readTsv(join(store, "ledger.tsv"), LEDGER_HEADER, 6)).map(
    (row) => {
      const rawVerdict = row[2] ?? "";
      const verdict = verdictOrNull(rawVerdict);
      if (verdict === null) {
        throw new UserError(`ledger.tsv has invalid verdict ${rawVerdict}`);
      }
      return {
        pr: row[0] ?? "",
        sha: row[1] ?? "",
        verdict,
        evidence: row[3] ?? "",
        verifier: row[4] ?? "",
        ts: row[5] ?? "",
      };
    }
  );
}

function ledgerCells(row) {
  return [
    row.pr,
    row.sha,
    row.verdict,
    row.evidence,
    row.verifier,
    row.ts,
  ];
}

async function saveLedger(
  store,
  rows
) {
  await writeTsv(
    join(store, "ledger.tsv"),
    LEDGER_HEADER,
    rows.map(ledgerCells)
  );
}

function pointerCells(pointer) {
  return [
    pointer.ts,
    pointer.agent,
    pointer.unit,
    pointer.status,
    pointer.report,
  ];
}

async function readPointers(
  directory
) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new UserError(
        `store is not initialized at ${dirname(directory)}; run orch init`
      );
    }
    throw error;
  }
  const result = [];
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsv"))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of files) {
    const raw = (await readFile(join(directory, entry.name), "utf8")).replace(
      /\r?\n$/,
      ""
    );
    const row = raw.split("\t").map(unquoteCell);
    if (/[\r\n]/.test(raw) || row.length !== 5) {
      throw new UserError(`inbox pointer ${entry.name} is malformed`);
    }
    result.push({
      ts: row[0] ?? "",
      agent: row[1] ?? "",
      unit: row[2] ?? "",
      status: row[3] ?? "",
      report: row[4] ?? "",
    });
  }
  return result;
}

function renderGates(rows) {
  if (rows.length === 0) {
    return "";
  }
  const blocks = rows.map((gate) => {
    const answer =
      gate.kind === "resolved" ? `\n- Answer: ${gate.answer}` : "";
    return `## ${gate.id}

- Status: ${gate.kind}
- Question: ${gate.question}
- Options: ${gate.options}
- Default: ${gate.defaultAnswer}${answer}`;
  });
  return `# Gates\n\n${blocks.join("\n\n")}\n`;
}

async function readGates(store) {
  const raw = (await requiredFile(join(store, "gates.md")))
    .replace(/\r/g, "")
    .trim();
  if (raw.length === 0) {
    return [];
  }
  const prefix = "# Gates\n\n## ";
  if (!raw.startsWith(prefix)) {
    throw new UserError("gates.md has an invalid heading");
  }
  const result = [];
  for (const block of raw.slice(prefix.length).split("\n\n## ")) {
    const lines = block.split("\n").filter((value) => value.length > 0);
    const id = lines.shift() ?? "";
    const fields = new Map();
    for (const value of lines) {
      const match = /^- ([^:]+): (.*)$/.exec(value);
      if (match === null) {
        throw new UserError(`gates.md has a malformed gate ${id}`);
      }
      fields.set(match[1] ?? "", match[2] ?? "");
    }
    const status = fields.get("Status");
    const question = fields.get("Question");
    const options = fields.get("Options");
    const defaultAnswer = fields.get("Default");
    if (
      id.length === 0 ||
      question === undefined ||
      options === undefined ||
      defaultAnswer === undefined
    ) {
      throw new UserError(`gates.md has a malformed gate ${id}`);
    }
    if (status === "open") {
      result.push({ kind: "open", id, question, options, defaultAnswer });
    } else if (status === "resolved" && fields.has("Answer")) {
      result.push({
        kind: "resolved",
        id,
        question,
        options,
        defaultAnswer,
        answer: fields.get("Answer") ?? "",
      });
    } else {
      throw new UserError(`gates.md has invalid status ${status ?? ""}`);
    }
  }
  if (new Set(result.map((gate) => gate.id)).size !== result.length) {
    throw new UserError("gates.md has duplicate gate ids");
  }
  return result;
}

function parseFrontier(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new UserError("frontier.json is not valid JSON");
  }
  if (!isRecord(value)) {
    throw new UserError("frontier.json must contain an object");
  }
  if (Object.keys(value).length === 0) {
    return { generation: 0, prs: [], lowestUnmerged: null };
  }
  if (
    typeof value.generation !== "number" ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 0 ||
    !isUnknownArray(value.prs) ||
    !(
      value.lowestUnmerged === null ||
      (typeof value.lowestUnmerged === "number" &&
        Number.isSafeInteger(value.lowestUnmerged))
    )
  ) {
    throw new UserError("frontier.json has an invalid shape");
  }
  const prs = [];
  for (const row of value.prs) {
    const state = isRecord(row)
      ? frontierPrStateOrNull(row.state)
      : null;
    if (
      !isRecord(row) ||
      typeof row.pr !== "number" ||
      !Number.isSafeInteger(row.pr) ||
      row.pr < 1 ||
      typeof row.branches !== "string" ||
      row.branches.length === 0 ||
      typeof row.sha !== "string" ||
      state === null
    ) {
      throw new UserError("frontier.json has an invalid PR row");
    }
    prs.push({
      pr: row.pr,
      branches: row.branches,
      sha: row.sha,
      state,
    });
  }
  return {
    generation: value.generation,
    prs,
    lowestUnmerged: value.lowestUnmerged,
  };
}

async function readFrontier(store) {
  return parseFrontier(await requiredFile(join(store, "frontier.json")));
}

async function readStanding(
  store
) {
  const raw = (await requiredFile(join(store, "preferences.md"))).replace(
    /\r/g,
    ""
  );
  if (raw.trim().length === 0) {
    return [];
  }
  const result = [];
  for (const value of raw.split("\n").filter((item) => item.length > 0)) {
    const match = /^([1-9]\d*)\. (.+)$/.exec(value);
    const number = Number(match?.[1] ?? 0);
    if (match === null || number !== result.length + 1) {
      throw new UserError("preferences.md has malformed numbering");
    }
    result.push({ number, line: match[2] ?? "" });
  }
  return result;
}

function countValues(values) {
  const result = {};
  for (const value of values) {
    result[value] = (result[value] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

function summarize(
  unitRows,
  ledgerRows,
  currentFrontier,
  gateRows
) {
  return {
    unitStates: countValues(unitRows.map((unit) => unit.state)),
    ledgerVerdicts: countValues(ledgerRows.map((row) => row.verdict)),
    frontierGeneration: currentFrontier.generation,
    openGateIds: gateRows
      .filter((gate) => gate.kind === "open")
      .map((gate) => gate.id)
      .sort(),
  };
}

function countRecord(value) {
  if (!isRecord(value)) {
    return null;
  }
  const result = {};
  for (const [name, count] of Object.entries(value)) {
    if (
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      return null;
    }
    result[name] = count;
  }
  return result;
}

function previousSummary(raw) {
  const match = /<!-- orch-summary (.+) -->/.exec(raw);
  if (match === null) {
    return null;
  }
  let value;
  try {
    value = JSON.parse(match[1] ?? "");
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value.frontierGeneration !== "number" ||
    !isUnknownArray(value.openGateIds)
  ) {
    return null;
  }
  const unitStates = countRecord(value.unitStates);
  const ledgerVerdicts = countRecord(value.ledgerVerdicts);
  const openGateIds = value.openGateIds.filter(
    (item) => typeof item === "string"
  );
  if (
    unitStates === null ||
    ledgerVerdicts === null ||
    openGateIds.length !== value.openGateIds.length
  ) {
    return null;
  }
  return {
    unitStates,
    ledgerVerdicts,
    frontierGeneration: value.frontierGeneration,
    openGateIds,
  };
}

function changed(before, after) {
  if (before === null) {
    return "first render";
  }
  const result = [];
  const groups

 = [
    {
      label: "units",
      oldCounts: before.unitStates,
      newCounts: after.unitStates,
    },
    {
      label: "ledger",
      oldCounts: before.ledgerVerdicts,
      newCounts: after.ledgerVerdicts,
    },
  ];
  for (const { label, oldCounts, newCounts } of groups) {
    const names = [
      ...new Set([...Object.keys(oldCounts), ...Object.keys(newCounts)]),
    ].sort();
    for (const name of names) {
      const oldCount = oldCounts[name] ?? 0;
      const newCount = newCounts[name] ?? 0;
      if (oldCount !== newCount) {
        result.push(`${label} ${name} ${oldCount}->${newCount}`);
      }
    }
  }
  if (before.frontierGeneration !== after.frontierGeneration) {
    result.push(
      `frontier generation ${before.frontierGeneration}->${after.frontierGeneration}`
    );
  }
  if (before.openGateIds.join("\0") !== after.openGateIds.join("\0")) {
    result.push(
      `open gates ${before.openGateIds.length}->${after.openGateIds.length}`
    );
  }
  return result.length === 0 ? "no derived changes" : result.join("; ");
}

function markdown(value) {
  return value.replace(/[\t\n\r]/g, " ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function table(
  headers,
  rows
) {
  if (rows.length === 0) {
    return "(none)";
  }
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdown).join(" | ")} |`),
  ].join("\n");
}

function statusMarkdown(
  unitRows,
  ledgerRows,
  currentFrontier,
  gateRows,
  currentSummary
) {
  return `# Orchestrate status

Generated: ${new Date().toISOString()}

## Units

States: ${countLine(currentSummary.unitStates)}

${table(
  ["ID", "Track", "State", "Branch", "PR", "SHA", "Brief"],
  unitRows.map(unitCells)
)}

## Verification ledger

Verdicts: ${countLine(currentSummary.ledgerVerdicts)}

${table(
  ["PR", "SHA", "Verdict", "Evidence", "Verifier", "Timestamp"],
  ledgerRows.map(ledgerCells)
)}

## Frontier

Generation: ${currentFrontier.generation}
Lowest unmerged: ${currentFrontier.lowestUnmerged ?? "none"}

${table(
  ["Branch", "PR", "SHA", "State"],
  currentFrontier.prs.map((row) => [
    row.branches,
    String(row.pr),
    row.sha,
    row.state,
  ])
)}

## Gates

${table(
  ["ID", "Status", "Question", "Options", "Default", "Answer"],
  gateRows.map((gate) => [
    gate.id,
    gate.kind,
    gate.question,
    gate.options,
    gate.defaultAnswer,
    gate.kind === "resolved" ? gate.answer : "",
  ])
)}

<!-- orch-summary ${JSON.stringify(currentSummary)} -->
`;
}

function countLine(value) {
  const entries = Object.entries(value);
  return entries.length === 0
    ? "none"
    : entries.map(([name, count]) => `${name}=${count}`).join(", ");
}

// Each forge names its pull request fields. gh matches --head and --base by
// branch name alone, so the chain keeps only PRs whose head repository, paired
// with headRepositoryOwner.login or null for a deleted fork, is the one the
// checkout pushes to. gh lists 30 pull requests unless told otherwise.
const FORGE_PULL_REQUEST_QUERIES = {
  gh: {
    stateField: "state",
    headField: "headRefName",
    baseField: "baseRefName",
    headRepositoryField: "headRepository",
    listArgs: ["--limit", "1000"],
    states: new Map([
      ["OPEN", "OPEN"],
      ["MERGED", "MERGED"],
      ["CLOSED", "CLOSED"],
    ]),
  },
  origin: {
    stateField: "status",
    headField: "headRef",
    baseField: "baseRef",
    listArgs: [],
    states: new Map([
      ["open", "OPEN"],
      ["draft", "OPEN"],
      ["merged", "MERGED"],
      ["closed", "CLOSED"],
    ]),
  },
};

export function parseForge(value) {
  if (value === "gh" || value === "origin") {
    return value;
  }
  throw new UserError("forge must be gh or origin");
}

// Resolves to null when the forge reports no head repository or the repository
// is gone, and to undefined when the field is malformed.
function headRepository(
  row,
  field
) {
  if (field === undefined) {
    return null;
  }
  const value = row[field];
  if (value === null) {
    return null;
  }
  const owner = row.headRepositoryOwner;
  return isRecord(value) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    isRecord(owner) &&
    typeof owner.login === "string" &&
    owner.login.length > 0
    ? `${owner.login}/${value.name}`.toLowerCase()
    : undefined;
}

function runTool({
  command,
  args,
  repo,
  executable,
}) {
  try {
    return execFileSync(executable?.path ?? command, args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: executable?.timeout,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    throw new UserError(
      `${command} ${args.join(" ")} failed: ${errorMessage(error)}`
    );
  }
}

function listPullRequests({
  filter,
  branch,
  forge,
  executable,
  repo,
  localRepository,
}) {
  const query = FORGE_PULL_REQUEST_QUERIES[forge];
  const command = `${forge} pr list ${filter} ${branch}`;
  // Every state is fetched because a merged or closed PR still anchors the
  // chain, and a draft counts as OPEN.
  const raw = runTool({
    command: forge,
    args: [
      "pr",
      "list",
      filter,
      branch,
      "--state",
      "all",
      ...query.listArgs,
      "--json",
      [
        "number",
        query.stateField,
        query.headField,
        query.baseField,
        ...(query.headRepositoryField
          ? [query.headRepositoryField, "headRepositoryOwner"]
          : []),
      ].join(","),
    ],
    repo,
    executable,
  });
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new UserError(`${command} output is not valid JSON`);
  }
  if (!isUnknownArray(value)) {
    throw new UserError(`${command} output is not a JSON array`);
  }
  const rows = value.map((row) => {
    const status = isRecord(row) ? row[query.stateField] : undefined;
    const state =
      typeof status === "string" ? (query.states.get(status) ?? null) : null;
    const head = isRecord(row) ? row[query.headField] : undefined;
    const base = isRecord(row) ? row[query.baseField] : undefined;
    // owner/name in lower case; null when the forge does not say or the head
    // repository is gone.
    const repository = isRecord(row)
      ? headRepository(row, query.headRepositoryField)
      : undefined;
    if (
      !isRecord(row) ||
      typeof row.number !== "number" ||
      !Number.isSafeInteger(row.number) ||
      row.number < 1 ||
      state === null ||
      typeof head !== "string" ||
      head.length === 0 ||
      typeof base !== "string" ||
      base.length === 0 ||
      repository === undefined
    ) {
      throw new UserError(`${command} output has an invalid PR row`);
    }
    return { pr: row.number, state, branch: head, base, repository };
  });
  const isLocal = (row) =>
    localRepository === null || row.repository === localRepository;
  return {
    // PRs whose head is in the repository the checkout pushes to.
    local: rows.filter(isLocal),
    foreign: rows.filter((row) => !isLocal(row)),
  };
}

function branchPullRequest({
  branch,
  forge,
  executable,
  repo,
  localRepository,
}) {
  const { local, foreign } = listPullRequests({
    filter: "--head",
    branch,
    forge,
    executable,
    repo,
    localRepository,
  });
  const row = local[0];
  if (row === undefined) {
    const ignored =
      foreign.length === 0 || localRepository === null
        ? ""
        : ` from ${localRepository} (ignored ${foreign
            .map(
              (item) =>
                `#${item.pr} from ${item.repository ?? "a deleted repository"}`
            )
            .join(", ")})`;
    throw new UserError(
      `branch ${branch} has no pull request${ignored}; open one with ${forge} pr create, or resolve the frontier from a branch whose chain is fully submitted`
    );
  }
  if (local.length > 1) {
    throw new UserError(
      `branch ${branch} has multiple pull requests (${local.map((item) => `#${item.pr}`).join(", ")}); close the stale ones first`
    );
  }
  return row;
}

function openChildren({
  branch,
  forge,
  executable,
  repo,
  localRepository,
}) {
  return listPullRequests({
    filter: "--base",
    branch,
    forge,
    executable,
    repo,
    localRepository,
  }).local.filter((row) => row.state === "OPEN");
}

function runGit({
  args,
  repo,
}) {
  return runTool({ command: "git", args, repo }).trim();
}

function branchSha({
  branch,
  repo,
}) {
  const sha = runGit({
    args: ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`],
    repo,
  });
  if (!/^[0-9a-f]{40,64}$/i.test(sha)) {
    throw new UserError(`git rev-parse ${branch} returned an invalid SHA`);
  }
  return sha;
}

function currentBranch(repo) {
  // --short prints heads/<branch> for a branch that shares a tag's name.
  return runGit({ args: ["symbolic-ref", "HEAD"], repo }).replace(
    /^refs\/heads\//,
    ""
  );
}

// The repository the branch pushes to, as owner/name in lower case, from the
// remote git itself would push it to.
function pushRepository({
  branch,
  repo,
}) {
  const configured = (key) => {
    try {
      return runGit({ args: ["config", "--get", key], repo }) || null;
    } catch {
      return null;
    }
  };
  const remote =
    configured(`branch.${branch}.pushRemote`) ??
    configured("remote.pushDefault") ??
    configured(`branch.${branch}.remote`) ??
    "origin";
  let url;
  try {
    url = runGit({ args: ["remote", "get-url", "--push", remote], repo });
  } catch {
    throw new UserError(
      `branch ${branch} has no push remote (remote ${remote} has no URL), so the chain cannot tell which pull requests are the checkout's own`
    );
  }
  const match = /([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  const owner = match?.[1];
  const name = match?.[2];
  if (owner === undefined || name === undefined) {
    throw new UserError(`remote ${remote} URL ${url} does not name a repository`);
  }
  return `${owner}/${name}`.toLowerCase();
}

function trunkBranch(repo) {
  try {
    return runGit({
      args: ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      repo,
    }).replace(/^origin\//, "");
  } catch {
    // Init-plus-fetch checkouts and local fixtures lack origin/HEAD.
    return "main";
  }
}

function resolveFrontier({
  repo,
  forge,
  executable,
}) {
  const trunk = trunkBranch(repo);
  const current = currentBranch(repo);
  if (current === trunk) {
    return [];
  }
  const localRepository =
    FORGE_PULL_REQUEST_QUERIES[forge].headRepositoryField === undefined
      ? null
      : pushRepository({ branch: current, repo });
  const seen = new Set([current]);
  let bottom = branchPullRequest({
    branch: current,
    forge,
    executable,
    repo,
    localRepository,
  });
  const chain = [bottom];
  while (bottom.base !== trunk) {
    if (seen.has(bottom.base)) {
      throw new UserError(
        `pull request base chain loops at branch ${bottom.base}`
      );
    }
    seen.add(bottom.base);
    bottom = branchPullRequest({
      branch: bottom.base,
      forge,
      executable,
      repo,
      localRepository,
    });
    chain.unshift(bottom);
  }
  let tip = current;
  for (;;) {
    const children = openChildren({
      branch: tip,
      forge,
      executable,
      repo,
      localRepository,
    });
    const child = children[0];
    if (child === undefined) {
      break;
    }
    if (children.length > 1) {
      throw new UserError(
        `stack is not linear: branches ${children.map((row) => row.branch).join(", ")} all target ${tip}`
      );
    }
    if (seen.has(child.branch)) {
      throw new UserError(
        `pull request base chain loops at branch ${child.branch}`
      );
    }
    seen.add(child.branch);
    chain.push(child);
    tip = child.branch;
  }
  if (new Set(chain.map((row) => row.pr)).size !== chain.length) {
    throw new UserError(
      "pull request base chain contains duplicate pull requests"
    );
  }
  return chain.map((row) => ({
    pr: row.pr,
    branches: row.branch,
    sha: branchSha({ branch: row.branch, repo }),
    state: row.state,
  }));
}

function validateFrontierPin({
  actual,
  expected,
}) {
  if (
    actual.length === expected.length &&
    actual.every((pr, index) => pr === expected[index])
  ) {
    return;
  }
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((pr) => !actualSet.has(pr));
  const extra = actual.filter((pr) => !expectedSet.has(pr));
  const drift = [];
  if (missing.length > 0) {
    drift.push(`missing from resolved chain: ${missing.join(",")}`);
  }
  if (extra.length > 0) {
    drift.push(`extra in resolved chain: ${extra.join(",")}`);
  }
  if (missing.length === 0 && extra.length === 0) {
    drift.push(
      `order differs: expected ${expected.join(",")}; resolved ${actual.join(",")}`
    );
  }
  throw new UserError(`frontier pin mismatch: ${drift.join("; ")}`);
}

export function openStore(
  directory,
  options = {}
) {
  const store = resolve(directory);
  let closed = false;
  let releaseLock = null;
  let lockRequest = null;

  const ensureOpen = () => {
    if (closed) {
      throw new UserError("store is closed");
    }
  };

  const ensureLock = async () => {
    ensureOpen();
    if (releaseLock !== null) {
      return;
    }
    if (lockRequest === null) {
      lockRequest = acquireLock(store, options).then((release) => {
        releaseLock = release;
      });
    }
    try {
      await lockRequest;
    } catch (error) {
      lockRequest = null;
      throw error;
    }
  };

  const beginWrite = async () => {
    ensureOpen();
    if (!(await exists(store))) {
      throw new UserError(
        `store is not initialized at ${store}; run orch init`
      );
    }
    await ensureLock();
  };

  return {
    units: {
      add: async (params) => {
        await beginWrite();
        const row = {
          id: requiredCell(params.id, "unit id"),
          track: requiredCell(params.track, "track"),
          state: "pending",
          branch: "",
          pr: "",
          sha: "",
          brief:
            params.brief === undefined
              ? ""
              : requiredCell(params.brief, "brief"),
        };
        const rows = [...(await readUnits(store))];
        if (rows.some((unit) => unit.id === row.id)) {
          throw new UserError(`unit ${row.id} already exists`);
        }
        rows.push(row);
        await saveUnits(store, rows);
        return row;
      },
      set: async (params) => {
        await beginWrite();
        const id = requiredCell(params.id, "unit id");
        const state = requiredCell(params.state, "state");
        const rows = [...(await readUnits(store))];
        const index = rows.findIndex((unit) => unit.id === id);
        const old = rows[index];
        if (index < 0 || old === undefined) {
          throw new NotFoundError(`unit ${id} not found`);
        }
        const row = {
          ...old,
          state,
          branch:
            params.branch === undefined
              ? old.branch
              : requiredCell(params.branch, "branch"),
          pr:
            params.pr === undefined
              ? old.pr
              : String(positiveInteger(params.pr, "PR")),
          sha:
            params.sha === undefined
              ? old.sha
              : requiredCell(params.sha, "SHA"),
        };
        rows[index] = row;
        await saveUnits(store, rows);
        return row;
      },
      get: async (id) => {
        ensureOpen();
        const cleanId = requiredCell(id, "unit id");
        const row = (await readUnits(store)).find(
          (unit) => unit.id === cleanId
        );
        if (row === undefined) {
          throw new NotFoundError(`unit ${cleanId} not found`);
        }
        return row;
      },
      list: async (params = {}) => {
        ensureOpen();
        const state =
          params.state === undefined
            ? undefined
            : requiredCell(params.state, "state");
        const track =
          params.track === undefined
            ? undefined
            : requiredCell(params.track, "track");
        return (await readUnits(store)).filter(
          (unit) =>
            (state === undefined || unit.state === state) &&
            (track === undefined || unit.track === track)
        );
      },
      counts: async () => {
        ensureOpen();
        return countValues(
          (await readUnits(store)).map((unit) => unit.state)
        );
      },
    },
    ledger: {
      record: async (params) => {
        await beginWrite();
        const verdict = parseVerdict(params.verdict);
        const row = {
          pr: String(positiveInteger(params.pr, "PR")),
          sha: requiredCell(params.sha, "SHA"),
          verdict,
          evidence: requiredCell(params.evidence, "evidence"),
          verifier:
            params.verifier === undefined
              ? ""
              : requiredCell(params.verifier, "verifier"),
          ts: new Date().toISOString(),
        };
        const rows = [...(await readLedger(store))];
        const index = rows.findIndex(
          (old) => old.pr === row.pr && old.sha === row.sha
        );
        if (index < 0) {
          rows.push(row);
        } else {
          rows[index] = row;
        }
        await saveLedger(store, rows);
        return row;
      },
      check: async (params) => {
        ensureOpen();
        const pr = String(positiveInteger(params.pr, "PR"));
        const sha = requiredCell(params.sha, "SHA");
        const row = (await readLedger(store)).find(
          (value) => value.pr === pr && value.sha === sha
        );
        if (row === undefined) {
          throw new NotFoundError("NOT-VERIFIED", {
            compact: "NOT-VERIFIED",
            json: { pr, sha, verdict: "NOT-VERIFIED" },
          });
        }
        return row;
      },
      summary: async () => {
        ensureOpen();
        return countValues(
          (await readLedger(store)).map((row) => row.verdict)
        );
      },
    },
    inbox: {
      push: async (params) => {
        await beginWrite();
        const pointer = {
          ts: new Date().toISOString(),
          agent: requiredCell(params.agent, "agent"),
          unit: requiredCell(params.unit, "unit"),
          status: requiredCell(params.status, "status"),
          report:
            params.report === undefined
              ? ""
              : requiredCell(params.report, "report"),
        };
        const inbox = join(store, "inbox");
        if (!(await exists(inbox))) {
          throw new UserError(
            `store is not initialized at ${store}; run orch init`
          );
        }
        const timestamp = pointer.ts.replace(/[:.]/g, "-");
        const filename = `${timestamp}-${process.pid}-${randomUUID()}.tsv`;
        const contents = `${pointerCells(pointer).map(cleanCell).join("\t")}\n`;
        await atomicWrite(join(inbox, filename), contents);
        return { pointer, filename };
      },
      drain: async () => {
        await beginWrite();
        const inbox = join(store, "inbox");
        const rows = await readPointers(inbox);
        const drained = join(
          store,
          `.inbox-drain-${process.pid}-${randomUUID()}`
        );
        await rename(inbox, drained);
        try {
          await mkdir(inbox);
        } catch (error) {
          await rename(drained, inbox);
          throw error;
        }
        await rm(drained, { recursive: true, force: true });
        return rows;
      },
      peek: async () => {
        ensureOpen();
        return readPointers(join(store, "inbox"));
      },
      count: async () => {
        ensureOpen();
        return (await readPointers(join(store, "inbox"))).length;
      },
    },
    gates: {
      park: async (params) => {
        await beginWrite();
        const gate = {
          kind: "open",
          id: requiredLine(params.id, "gate id"),
          question: requiredLine(params.question, "question"),
          options: requiredLine(params.options, "options"),
          defaultAnswer: requiredLine(
            params.defaultAnswer,
            "default"
          ),
        };
        const rows = [...(await readGates(store))];
        const index = rows.findIndex((old) => old.id === gate.id);
        if (index < 0) {
          rows.push(gate);
        } else {
          rows[index] = gate;
        }
        await atomicWrite(join(store, "gates.md"), renderGates(rows));
        return gate;
      },
      list: async () => {
        ensureOpen();
        return (await readGates(store)).filter(
          (gate) => gate.kind === "open"
        );
      },
      resolve: async (params) => {
        await beginWrite();
        const id = requiredLine(params.id, "gate id");
        const rows = [...(await readGates(store))];
        const index = rows.findIndex((gate) => gate.id === id);
        const old = rows[index];
        if (index < 0 || old === undefined) {
          throw new NotFoundError(`gate ${id} not found`);
        }
        const gate = {
          kind: "resolved",
          id: old.id,
          question: old.question,
          options: old.options,
          defaultAnswer: old.defaultAnswer,
          answer: requiredLine(params.answer, "answer"),
        };
        rows[index] = gate;
        await atomicWrite(join(store, "gates.md"), renderGates(rows));
        return gate;
      },
    },
    frontier: {
      set: async (params) => {
        await beginWrite();
        const repo = resolve(requiredLine(params.repo, "repo directory"));
        const forge = parseForge(params.forge ?? "gh");
        const pin =
          params.prs === undefined
            ? undefined
            : params.prs.map((pr) => positiveInteger(pr, "PR"));
        if (pin !== undefined && new Set(pin).size !== pin.length) {
          throw new UserError("--prs must not contain duplicates");
        }
        const old = await readFrontier(store);
        const prs = resolveFrontier({
          repo,
          forge,
          // Tests point the store at a fake forge executable.
          executable: {
            path: options.forgePaths?.[forge] ?? forge,
            timeout: options.forgeTimeoutMs ?? FORGE_TIMEOUT_MS,
          },
        });
        if (pin !== undefined) {
          validateFrontierPin({
            actual: prs.map((row) => row.pr),
            expected: pin,
          });
        }
        const value = {
          generation: old.generation + 1,
          prs,
          lowestUnmerged: prs.find((row) => row.state === "OPEN")?.pr ?? null,
        };
        await atomicWrite(
          join(store, "frontier.json"),
          `${JSON.stringify(value, null, 2)}\n`
        );
        return value;
      },
      show: async () => {
        ensureOpen();
        return readFrontier(store);
      },
    },
    standing: {
      show: async () => {
        ensureOpen();
        return readStanding(store);
      },
      add: async (params) => {
        await beginWrite();
        const rows = [...(await readStanding(store))];
        const item = {
          number: rows.length + 1,
          line: requiredLine(params.line, "standing order"),
        };
        rows.push(item);
        await atomicWrite(
          join(store, "preferences.md"),
          `${rows.map((row) => `${row.number}. ${row.line}`).join("\n")}\n`
        );
        return item;
      },
    },
    status: {
      render: async () => {
        await beginWrite();
        const unitRows = await readUnits(store);
        const ledgerRows = await readLedger(store);
        const currentFrontier = await readFrontier(store);
        const gateRows = await readGates(store);
        const currentSummary = summarize(
          unitRows,
          ledgerRows,
          currentFrontier,
          gateRows
        );
        const path = join(store, "status.md");
        const before = (await exists(path))
          ? previousSummary(await readFile(path, "utf8"))
          : null;
        const change = changed(before, currentSummary);
        await atomicWrite(
          path,
          statusMarkdown(
            unitRows,
            ledgerRows,
            currentFrontier,
            gateRows,
            currentSummary
          )
        );
        return {
          units: unitRows,
          ledger: ledgerRows,
          frontier: currentFrontier,
          gates: gateRows,
          summary: currentSummary,
          changed: change,
        };
      },
    },
    init: async () => {
      ensureOpen();
      await mkdir(store, { recursive: true });
      await ensureLock();
      await writeIfMissing(join(store, "units.tsv"), `${UNIT_HEADER}\n`);
      await writeIfMissing(join(store, "ledger.tsv"), `${LEDGER_HEADER}\n`);
      await mkdir(join(store, "inbox"), { recursive: true });
      await writeIfMissing(join(store, "gates.md"), "");
      await writeIfMissing(join(store, "preferences.md"), "");
      await writeIfMissing(join(store, "frontier.json"), "{}\n");
      return { store };
    },
    close: async () => {
      if (closed) {
        return;
      }
      if (lockRequest !== null) {
        try {
          await lockRequest;
        } catch {
          // A failed acquisition has no lock to release.
        }
      }
      const release = releaseLock;
      releaseLock = null;
      closed = true;
      if (release !== null) {
        await release();
      }
    },
  };
}
