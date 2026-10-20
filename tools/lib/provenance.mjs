import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const SOURCES = ["cursor/plugins", "michael-denyer/pstack-claude", "mattpocock/skills"];
export const STATUSES = ["verbatim", "renamed", "modified"];
export const PLUGIN_ROOT = "plugins/pdstack";
const PSTACK_CLAUDE_ROOT = "plugins/pstack";

export function loadProvenance(repoRoot) {
  return JSON.parse(readFileSync(join(repoRoot, "provenance.json"), "utf8"));
}

export function applyRenames(text, renames) {
  let out = text;
  for (const [from, to] of renames) out = out.split(from).join(to);
  return out;
}

export function hideSkill(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error("hide: no frontmatter");
  if (/^user-invocable:/m.test(match[1])) return text;
  return `---\n${match[1]}\nuser-invocable: false\n---\n${text.slice(match[0].length)}`;
}

// The local text a pin expects, from the upstream text.
export function expectedText(upstream, pin, renames) {
  if (pin.status === "verbatim") return upstream;
  let text = applyRenames(upstream.toString("utf8"), renames);
  if (pin.hide) text = hideSkill(text);
  return Buffer.from(text, "utf8");
}

// The pstack-claude path that a local plugin path is copied from, before renames.
export function upstreamPathFor(localPath, renames) {
  if (!localPath.startsWith(`${PLUGIN_ROOT}/`)) return null;
  let rel = localPath.slice(PLUGIN_ROOT.length + 1);
  for (const [from, to] of [...renames].reverse()) rel = rel.split(to).join(from);
  return `${PSTACK_CLAUDE_ROOT}/${rel}`;
}

export function validatePins(provenance) {
  const errors = [];
  const { pins = {}, renames, feeds } = provenance;
  if (!Array.isArray(renames)) errors.push("renames: must be an array of [from, to] pairs");
  if (typeof feeds !== "object" || feeds === null) errors.push("feeds: must be an object");
  for (const [local, pin] of Object.entries(pins)) {
    if (!SOURCES.includes(pin.source)) errors.push(`${local}: unknown source ${pin.source}`);
    if (!STATUSES.includes(pin.status)) errors.push(`${local}: unknown status ${pin.status}`);
    if (!/^[0-9a-f]{40}$/.test(pin.sha ?? "")) errors.push(`${local}: sha must be a full sha`);
    if (!pin.path) errors.push(`${local}: path is required`);
    if (pin.status === "modified" && !pin.why) errors.push(`${local}: a modified pin needs a why`);
    if (pin.status !== "modified" && pin.why) errors.push(`${local}: only a modified pin has a why`);
    if (pin.hide && pin.status !== "renamed") errors.push(`${local}: hide needs status renamed`);
  }
  return errors;
}

export function listFiles(dir, root = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, root));
    else out.push(relative(root, full).split(sep).join("/"));
  }
  return out.sort();
}

export class Upstreams {
  constructor(dir) {
    this.dir = dir;
  }

  repoDir(source) {
    const dir = join(this.dir, source.replace("/", "__"));
    if (!existsSync(dir)) {
      mkdirSync(this.dir, { recursive: true });
      execFileSync("git", ["clone", "--quiet", "--no-checkout", `https://github.com/${source}.git`, dir], { stdio: "inherit" });
    }
    return dir;
  }

  ensureSha(source, sha) {
    const dir = this.repoDir(source);
    try {
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: dir, stdio: "ignore" });
    } catch {
      execFileSync("git", ["fetch", "--quiet", "origin", sha], { cwd: dir, stdio: "inherit" });
    }
    return dir;
  }

  show(source, sha, path) {
    const dir = this.ensureSha(source, sha);
    try {
      return execFileSync("git", ["show", `${sha}:${path}`], { cwd: dir, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null;
    }
  }
}

export function checkProvenance(repoRoot, upstreams) {
  const provenance = loadProvenance(repoRoot);
  const errors = validatePins(provenance);
  if (errors.length) return errors;
  const { pins, renames, feeds } = provenance;

  for (const [local, pin] of Object.entries(pins)) {
    const localFile = join(repoRoot, local);
    if (!existsSync(localFile)) {
      errors.push(`${local}: pinned file is missing`);
      continue;
    }
    if (pin.status === "modified") continue;
    const upstream = upstreams.show(pin.source, pin.sha, pin.path);
    if (upstream === null) {
      errors.push(`${local}: ${pin.source}@${pin.sha.slice(0, 8)} has no ${pin.path}`);
      continue;
    }
    if (!readFileSync(localFile).equals(expectedText(upstream, pin, renames))) {
      errors.push(`${local}: differs from ${pin.source}@${pin.sha.slice(0, 8)}:${pin.path} (status ${pin.status})`);
    }
  }

  // A file in the plugin with no pin must not be a copy of a pstack-claude file.
  // The adapter manifests are pdstack's own.
  const pstackClaude = feeds["michael-denyer/pstack-claude"];
  if (pstackClaude) {
    for (const rel of listFiles(join(repoRoot, PLUGIN_ROOT))) {
      const local = `${PLUGIN_ROOT}/${rel}`;
      if (pins[local] || rel.startsWith(".claude-plugin/")) continue;
      const path = upstreamPathFor(local, renames);
      if (upstreams.show("michael-denyer/pstack-claude", pstackClaude, path) !== null) {
        errors.push(`${local}: copied from michael-denyer/pstack-claude:${path} but has no pin`);
      }
    }
  }
  return errors;
}
