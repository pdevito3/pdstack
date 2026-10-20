import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { listFiles } from "./provenance.mjs";

export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) return null;
  const fields = {};
  let key = null;
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*):\s?(.*)$/.exec(line);
    if (pair) {
      key = pair[1];
      fields[key] = pair[2].trim();
    } else if (key && /^\s+\S/.test(line)) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    } else if (line.trim() !== "") {
      return null;
    }
  }
  return fields;
}

function skillDirs(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name));
}

function agentNames(agentsDir) {
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => parseFrontmatter(readFileSync(join(agentsDir, name), "utf8"))?.name ?? basename(name, ".md"));
}

export function lintSkills(repoRoot) {
  const errors = [];
  const pluginRoot = join(repoRoot, "plugins/pdstack");
  const dirs = [...skillDirs(join(pluginRoot, "skills")), ...skillDirs(join(repoRoot, ".agents/skills"))];
  const names = new Set();

  for (const dir of dirs) {
    const file = join(dir, "SKILL.md");
    const shown = file.slice(repoRoot.length + 1).split("\\").join("/");
    if (!existsSync(file)) {
      errors.push(`${shown}: missing`);
      continue;
    }
    const fields = parseFrontmatter(readFileSync(file, "utf8"));
    if (!fields) {
      errors.push(`${shown}: invalid frontmatter`);
      continue;
    }
    if (!fields.name) errors.push(`${shown}: name is required`);
    if (!fields.description) errors.push(`${shown}: description is required`);
    if (fields.name && fields.name !== basename(dir)) errors.push(`${shown}: name ${fields.name} does not match folder ${basename(dir)}`);
    if (fields["disable-model-invocation"] === "true" && fields["user-invocable"] === "false") errors.push(`${shown}: a skill that only the user can call must not be hidden`);
    names.add(basename(dir));
  }

  const known = new Set([...names, ...agentNames(join(pluginRoot, "agents"))]);
  for (const rel of listFiles(pluginRoot).filter((path) => path.endsWith(".md"))) {
    const text = readFileSync(join(pluginRoot, rel), "utf8");
    for (const [, name] of text.matchAll(/(?<![\w/.-])pdstack:([a-z0-9][a-z0-9-]*)/g)) {
      if (!known.has(name)) errors.push(`plugins/pdstack/${rel}: pdstack:${name} names no skill or agent`);
    }
    for (const [ref] of text.matchAll(/(?<![\w/.-])pstack:[a-z0-9][a-z0-9-]*/g)) {
      errors.push(`plugins/pdstack/${rel}: ${ref} uses the old namespace`);
    }
  }
  return errors;
}

export function checkVersions(repoRoot) {
  const plugin = JSON.parse(readFileSync(join(repoRoot, "plugins/pdstack/.claude-plugin/plugin.json"), "utf8"));
  const marketplace = JSON.parse(readFileSync(join(repoRoot, ".claude-plugin/marketplace.json"), "utf8"));
  const entry = marketplace.plugins.find((p) => p.name === "pdstack");
  if (!entry) return ["marketplace.json: no pdstack plugin entry"];
  if (entry.version !== plugin.version) return [`version mismatch: plugin.json ${plugin.version}, marketplace.json ${entry.version}`];
  return [];
}
