// The bun:test `expect` matchers that the upstream tests use, on node:assert,
// so the ported tests keep upstream's assertions line for line.
import assert from "node:assert/strict";

class StringContaining {
  constructor(sample) {
    this.sample = sample;
  }
  matches(value) {
    return typeof value === "string" && value.includes(this.sample);
  }
}

const MISSING = Symbol("missing");
const isObject = (value) => typeof value === "object" && value !== null;

// Reduces `actual` to the shape of `expected`, so deepStrictEqual compares
// only what toMatchObject asks about and still prints a useful diff.
function project(actual, expected) {
  if (expected instanceof StringContaining)
    return expected.matches(actual) ? expected : actual;
  if (Array.isArray(expected))
    return Array.isArray(actual) && actual.length === expected.length
      ? actual.map((item, index) => project(item, expected[index]))
      : actual;
  if (isObject(expected) && isObject(actual) && !Array.isArray(actual))
    return Object.fromEntries(
      Object.keys(expected).map((key) =>
        key in actual
          ? [key, project(actual[key], expected[key])]
          : [key, MISSING]
      )
    );
  return actual;
}

// toEqual ignores undefined properties and object types.
function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, plain(item)])
  );
}

function thrown(run) {
  try {
    run();
  } catch (error) {
    return { error };
  }
  return null;
}

function checkThrown(result, expected) {
  assert.ok(result !== null, "expected the function to throw");
  const { error } = result;
  if (expected === undefined) return;
  if (typeof expected === "function")
    assert.ok(
      error instanceof expected,
      `expected ${error} to be a ${expected.name}`
    );
  else if (expected instanceof RegExp) assert.match(error.message, expected);
  else
    assert.ok(
      error.message.includes(expected),
      `expected "${error.message}" to contain "${expected}"`
    );
}

function matchers(actual) {
  return {
    toBe: (expected) => assert.strictEqual(actual, expected),
    toEqual: (expected) =>
      assert.deepStrictEqual(plain(actual), plain(expected)),
    toMatchObject: (expected) =>
      assert.deepStrictEqual(project(actual, expected), expected),
    toContain: (expected) =>
      assert.ok(
        actual.includes(expected),
        `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`
      ),
    toHaveLength: (expected) => assert.strictEqual(actual.length, expected),
    toBeNull: () => assert.strictEqual(actual, null),
    toBeInstanceOf: (expected) =>
      assert.ok(
        actual instanceof expected,
        `expected ${actual} to be a ${expected.name}`
      ),
    toBeLessThan: (expected) =>
      assert.ok(
        actual < expected,
        `expected ${actual} to be less than ${expected}`
      ),
    toThrow: (expected) => checkThrown(thrown(actual), expected),
    not: {
      toContain: (expected) =>
        assert.ok(
          !actual.includes(expected),
          `expected ${JSON.stringify(actual)} not to contain ${JSON.stringify(expected)}`
        ),
    },
  };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected the promise to reject");
}

export function expect(actual) {
  return {
    ...matchers(actual),
    rejects: new Proxy(
      {},
      {
        get: (_, name) => async (expected) => {
          const error = await rejection(actual);
          if (name === "toThrow") return checkThrown({ error }, expected);
          return matchers(error)[name](expected);
        },
      }
    ),
  };
}
expect.stringContaining = (sample) => new StringContaining(sample);
