// Reads and checks a pdstack model sheet. Shared by check-sheet.mjs, which
// setup-pdstack runs after it writes a sheet, and by run-external.mjs, which
// reads the sheet's family lines. Node port of the upstream sheet.awk and
// read-sheet.sh.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MODELS_JSON = join(import.meta.dirname, "..", "..", "..", "models.json");

const MODEL_ID = /^[a-z0-9][a-z0-9.-]*$/;
const FAMILY_NAME = /^[a-z0-9][a-z0-9-]*$/;
const FAMILY_MODEL = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

// The roles every sheet names, in sheet order, the panel roles, and the
// reasoning effort levels, from models.json.
export function sheetRoles(models = JSON.parse(readFileSync(MODELS_JSON, "utf8"))) {
  return {
    roles: models.roles.map((r) => r.role),
    panel: new Set(models.roles.filter((r) => r.models === "panel").map((r) => r.role)),
    efforts: new Set(models.efforts),
  };
}

// Decodes the sheet once, before any consumer interprets its lines.
// PowerShell 5.1 writes UTF-16LE; other writers may add a UTF-8 BOM or CRLF
// line endings. Returns the lines.
export function decodeSheet(bytes) {
  const utf16 = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
  let text = utf16 ? bytes.subarray(2).toString("utf16le") : bytes.toString("utf8");
  text = text.replace(/\n+$/, "");
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  lines[0] = lines[0].replace(/^﻿/, "");
  return lines;
}

// The decoded lines of a sheet file, or null when it is not a readable file.
export function readSheet(file) {
  try {
    if (!statSync(file).isFile()) return null;
    return decodeSheet(readFileSync(file));
  } catch {
    return null;
  }
}

// Drops a role value's reasoning effort suffix, as in `gpt-5.5 @xhigh`.
export function sheetModel(entry, efforts) {
  const match = /[ \t]+@([a-z]+)$/.exec(entry);
  return match && efforts.has(match[1]) ? entry.slice(0, match.index) : entry;
}

function isAlias(id) {
  return id === "inherit-parent" || id === "auto";
}

function vendor(id) {
  return id.replace(/-.*/, "");
}

// The key of `key: value` at the start of a line, or "" for any other line.
export function sheetKey(line) {
  return /^[^ \t]/.test(line) && line.includes(":") ? line.slice(0, line.indexOf(":")).trim() : "";
}

export function sheetValue(line) {
  return line.slice(line.indexOf(":") + 1).trim();
}

// The family name of a `family <name>: <command>` key, or null.
function familyOf(key) {
  const match = /^family[ \t]+(.*)$/.exec(key);
  return match ? match[1].trim() : null;
}

// Splits `<family>:<model>` into its parts, or null for any other entry.
export function familyEntry(entry) {
  const at = entry.indexOf(":");
  if (at < 0) return null;
  const family = entry.slice(0, at);
  const model = entry.slice(at + 1);
  return FAMILY_NAME.test(family) && FAMILY_MODEL.test(model) ? { family, model } : null;
}

// Parses the sheet lines. Returns:
// - values: the last line's value for each known role and `default effort`
// - families: the command template of each well-formed family line
// - problems: what is wrong with the sheet, or [] when it is well formed: a
//   missing role, an entry that is not inherit-parent, auto, a model ID, or
//   `<family>:<model>` with an optional effort, a family entry with no family
//   line, a family line with a bad name or no `{model}`, a default effort that
//   is not session or a level, or a panel with models from fewer than two
//   vendors without a `panel vendors: any` line
// - models: the model set, modelList its display list of explicit IDs, and
//   aliases whether any role inherits its model
// A problem quotes no unchecked sheet text.
export function parseSheet(lines, spec = sheetRoles()) {
  const { roles, panel, efforts } = spec;
  const want = new Set(roles);
  const values = new Map();
  const templates = new Map();
  let badFamilyName = false;
  let any = false;
  for (const line of lines) {
    const key = sheetKey(line);
    const family = familyOf(key);
    if (want.has(key) || key === "default effort") values.set(key, sheetValue(line));
    else if (key === "panel vendors" && sheetValue(line) === "any") any = true;
    else if (family !== null) {
      if (FAMILY_NAME.test(family)) templates.set(family, sheetValue(line));
      else badFamilyName = true;
    }
  }

  const problems = [];
  for (const role of roles) if (!values.has(role)) problems.push(`missing role \`${role}\``);
  const effort = values.get("default effort");
  if (effort !== undefined && effort !== "session" && !efforts.has(effort)) {
    problems.push("default effort is not session or a level");
  }
  if (badFamilyName) problems.push("a family line has a name that is not a family name");
  const families = new Map();
  for (const [name, template] of [...templates].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (template === "") problems.push(`family \`${name}\` has no command`);
    else if (!template.includes("{model}")) problems.push(`family \`${name}\` has no {model} in its command`);
    else families.set(name, template);
  }

  const models = new Set();
  const modelList = [];
  let aliases = false;
  for (const role of roles) {
    if (!values.has(role)) continue;
    const entries = values.get(role) === "" ? [] : values.get(role).split(",");
    if (entries.length === 0) problems.push(`no model in \`${role}\``);
    const vendors = [];
    let real = false;
    for (const raw of entries) {
      const entry = sheetModel(raw.trim(), efforts);
      if (entry === "") {
        problems.push(`an empty entry in \`${role}\``);
        continue;
      }
      if (isAlias(entry)) {
        aliases = true;
        models.add(entry);
        continue;
      }
      const external = familyEntry(entry);
      if (!external && !MODEL_ID.test(entry)) {
        problems.push(`\`${role}\` has an entry that is not a model ID`);
        continue;
      }
      if (external && !templates.has(external.family)) {
        problems.push(`\`${role}\` names family \`${external.family}\` with no family line`);
        continue;
      }
      if (!models.has(entry)) modelList.push(`\`${entry}\``);
      models.add(entry);
      real = true;
      const v = external ? external.family : vendor(entry);
      if (!vendors.includes(v)) vendors.push(v);
    }
    if (panel.has(role) && real && vendors.length < 2 && !any) {
      problems.push(`\`${role}\` has models from one vendor (${vendors.join(", ")})`);
    }
  }
  return { values, families, problems, models, modelList: modelList.join(", "), aliases };
}
