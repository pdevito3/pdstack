import { readFileSync } from "node:fs";
import { join } from "node:path";

/** @typedef {"builtin" | "anti-slop"} Tier */

/**
 * @typedef {object} RequiredRule
 * @property {string} id
 * @property {Tier} tier
 * @property {Record<string, unknown>} [options]
 * @property {string} why
 */

/**
 * @typedef {object} Guard
 * @property {{ repo: string, sha: string }} antiSlop
 * @property {Record<string, string>} devDependencies
 * @property {RequiredRule[]} rules
 */

export const SKILL_DIR = join(import.meta.dirname, "..");

/** @returns {Guard} */
export function readGuard() {
  return JSON.parse(readFileSync(join(SKILL_DIR, "guard.json"), "utf8"));
}
