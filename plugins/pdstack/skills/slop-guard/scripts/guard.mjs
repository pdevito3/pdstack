import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Where a rule's code comes from. `builtin` ships in an npm package that the
 * template names: oxlint, the Cloudflare preset, or eslint-comments.
 * `anti-slop` is vendored into the repo by install-anti-slop.mjs.
 * @typedef {"builtin" | "anti-slop"} Tier
 */

/**
 * @typedef {object} RequiredRule
 * @property {string} id The rule id as the oxlint config names it, such as `anti-slop/no-runtime-typeof`.
 * @property {Tier} tier
 * @property {Record<string, unknown>} [options] The object after `"error"` in the rule's config entry.
 * @property {string} why
 */

/**
 * @typedef {object} Guard
 * @property {{ repo: string, sha: string }} antiSlop The anti-slop repository and the commit to vendor.
 * @property {Record<string, string>} devDependencies Exact versions for a repo with no oxlint.
 * @property {RequiredRule[]} rules
 */

export const SKILL_DIR = join(import.meta.dirname, "..");

/** @returns {Guard} */
export function readGuard() {
  return JSON.parse(readFileSync(join(SKILL_DIR, "guard.json"), "utf8"));
}
