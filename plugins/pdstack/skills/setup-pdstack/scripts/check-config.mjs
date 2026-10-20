#!/usr/bin/env node
// Checks a pdstack project config, .agents/pdstack.json, against the plugin's
// JSON Schema, schemas/pdstack.schema.json. Supports the keywords that schema
// uses and fails on any other, so the schema and this check cannot drift.
// Prints `config ok`, or `config invalid: <problems>` and exits 1.
// Usage: node check-config.mjs [config]   (default: .agents/pdstack.json)
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SCHEMA_PATH = join(import.meta.dirname, "..", "..", "..", "schemas", "pdstack.schema.json");

const ANNOTATIONS = new Set(["$schema", "$id", "$comment", "title", "description", "default", "examples"]);
const KEYWORDS = new Set(["type", "properties", "additionalProperties", "items", "enum", "uniqueItems", "minLength"]);

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function hasType(value, type) {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
}

const show = (value) => JSON.stringify(value);

// Returns the problems of value against schema, each prefixed with its path.
export function validate(value, schema, path = "config") {
  for (const key of Object.keys(schema)) {
    if (!ANNOTATIONS.has(key) && !KEYWORDS.has(key)) throw new Error(`schema keyword ${key} is not supported`);
  }
  if (schema.type !== undefined && !hasType(value, schema.type)) return [`${path} is not ${/^[aeiou]/.test(schema.type) ? "an" : "a"} ${schema.type}`];
  const problems = [];
  if (schema.enum !== undefined && !schema.enum.some((option) => show(option) === show(value))) {
    problems.push(`${path} is not one of ${schema.enum.join(", ")}`);
  }
  if (typeof value === "string" && schema.minLength !== undefined && [...value].length < schema.minLength) {
    problems.push(`${path} has fewer than ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}`);
  }
  if (Array.isArray(value)) {
    if (schema.items !== undefined) value.forEach((item, i) => problems.push(...validate(item, schema.items, `${path}[${i}]`)));
    if (schema.uniqueItems && new Set(value.map(show)).size !== value.length) problems.push(`${path} has duplicate items`);
  }
  if (typeOf(value) === "object") {
    const properties = schema.properties ?? {};
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) problems.push(...validate(item, properties[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${path}.${key} is not a known key`);
      else if (typeof schema.additionalProperties === "object") problems.push(...validate(item, schema.additionalProperties, `${path}.${key}`));
    }
  }
  return problems;
}

// Returns the problems of the config file, or [] when it is valid.
export function checkConfig(file, schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"))) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [`cannot read ${file}`];
  }
  let value;
  try {
    value = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    return [`not JSON (${error.message})`];
  }
  return validate(value, schema);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const problems = checkConfig(process.argv[2] ?? join(".agents", "pdstack.json"));
  if (problems.length) {
    console.log(`config invalid: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log("config ok");
}
