import { WatcherQueryError } from "./github.mjs";
import { parsePrNumber } from "./types.mjs";

/**
 * @typedef {object} LandingRevision
 * @property {import("./types.mjs").PrContext} context
 * @property {string} headRefOid
 * @property {string} baseRefName
 * @property {string} baseRefOid
 */

function invalid(detail) {
  throw new WatcherQueryError({ kind: "missing-key", retryable: true, detail });
}

export function object(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    invalid(`${label} must be an object`);
  return value;
}

export function text(value, label) {
  if (typeof value !== "string" || value.length === 0)
    invalid(`${label} must be a non-empty string`);
  return value;
}

export const nullableText = (value, label) =>
  value === null ? null : text(value, label);

export function baseRefTargetOid(value) {
  if (value === null) return null;
  const baseRef = object(value, "baseRef");
  if (baseRef.target === null) return null;
  const target = object(baseRef.target, "baseRef.target");
  return nullableText(target.oid, "baseRef.target.oid");
}

export function oneOf(value, values, label) {
  for (const candidate of values) if (candidate === value) return candidate;
  return invalid(`missing or invalid ${label}`);
}

export function flag(value, label) {
  if (typeof value !== "boolean") invalid(`missing ${label}`);
  return value;
}

export function parseContext(value) {
  const fields = object(value, "PR context");
  const owner = text(fields.owner, "owner");
  const repo = text(fields.repo, "repo");
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo))
    invalid("owner and repo must be individual repository names");
  return { owner, repo, number: parsePrNumber(fields.number) };
}

export function parseLandingRevision(value) {
  const fields = object(value, "landing revision");
  return {
    context: parseContext(fields.context),
    headRefOid: text(fields.headRefOid, "headRefOid"),
    baseRefName: text(fields.baseRefName, "baseRefName"),
    baseRefOid: text(fields.baseRefOid, "baseRefOid"),
  };
}

export function landingRevision(source) {
  const { context, headRefOid, baseRefName, baseRefOid } = source;
  return { context, headRefOid, baseRefName, baseRefOid };
}

export function sameLandingRevision(a, b) {
  return (
    a.context.owner.toLowerCase() === b.context.owner.toLowerCase() &&
    a.context.repo.toLowerCase() === b.context.repo.toLowerCase() &&
    a.context.number === b.context.number &&
    a.headRefOid === b.headRefOid &&
    a.baseRefName === b.baseRefName &&
    a.baseRefOid === b.baseRefOid
  );
}
