#!/usr/bin/env node
/**
 * Validates every rule set in data/ against schemas/ruleset.schema.json, then applies the
 * cross-file rules a JSON Schema cannot express.
 *
 * Run: npm run validate
 *
 * This is the gate. A rule set that does not pass here must never reach a filing.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import process from "node:process";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(import.meta.dirname, "..");
const dataDir = join(root, "data");
const schemaPath = join(root, "schemas", "ruleset.schema.json");

const problems = [];
const warnings = [];

function fail(file, message) {
  problems.push(`${file}: ${message}`);
}

function warn(file, message) {
  warnings.push(`${file}: ${message}`);
}

/** Every .json file under data/, recursively. */
async function collect(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collect(full)));
    } else if (entry.name.endsWith(".json")) {
      found.push(full);
    }
  }
  return found.sort();
}

const schema = JSON.parse(await readFile(schemaPath, "utf8"));
delete schema.$schema;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const files = await collect(dataDir);
if (files.length === 0) {
  console.error("No rule sets found under data/.");
  process.exit(1);
}

const sets = [];

for (const file of files) {
  const shown = relative(root, file);
  let parsed;

  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(shown, `not valid JSON: ${error.message}`);
    continue;
  }

  // The $schema key is an editor convenience; the schema itself forbids extra properties.
  const { $schema, ...ruleSet } = parsed;

  if (!validate(ruleSet)) {
    for (const error of validate.errors ?? []) {
      fail(shown, `${error.instancePath || "/"} ${error.message}`);
    }
    continue;
  }

  sets.push({ file: shown, ruleSet });
}

for (const { file, ruleSet } of sets) {
  const { id, status, effectiveFrom, effectiveTo, sources, values } = ruleSet;

  if (effectiveTo && effectiveTo < effectiveFrom) {
    fail(file, `effectiveTo ${effectiveTo} precedes effectiveFrom ${effectiveFrom}.`);
  }

  if (!id.startsWith("md-")) {
    fail(file, `id ${id} does not name a jurisdiction we support.`);
  }

  for (const [key, value] of Object.entries(values)) {
    // Every value must cite a source that actually exists in this set.
    if (value.sourceIndex >= sources.length) {
      fail(file, `${key} cites source ${value.sourceIndex}, but the set has ${sources.length}.`);
    }

    // Money and rates as JSON numbers can lose precision. Prefer decimal strings.
    if (typeof value.number === "number" && !Number.isInteger(value.number)) {
      fail(
        file,
        `${key} has a non-integer JSON number (${value.number}). Use a decimal string instead, ` +
          `so no rate ever passes through binary floating point.`,
      );
    }

    if (typeof value.number === "string" && !/^-?\d+(\.\d+)?$/.test(value.number)) {
      fail(file, `${key} number "${value.number}" is not a plain decimal.`);
    }

    if (value.unit === "ratio" && value.number !== undefined) {
      const asNumber = Number(value.number);
      if (asNumber < 0 || asNumber > 1) {
        fail(file, `${key} is a ratio but the value is ${value.number}. Use 0.12, not 12.`);
      }
    }

    // An approved set may only contain values a human has actually checked.
    if (status === "approved" && value.confidence !== "verified") {
      fail(file, `${key} is unverified, but the set is approved. Verify it or keep the set draft.`);
    }
  }

  if (status === "approved" && !sources.every((s) => s.verified === true)) {
    fail(file, "approved set has sources not marked verified.");
  }

  if (status === "draft") {
    warn(file, "status is draft — this set cannot be used to produce a filing.");
  }
}

// Two sets may cover the same date — that is how a retroactive amendment works, and the
// later-published one wins. But if two sets cover the same date AND were published on the same
// day, "which one wins" is undefined, and a filing could differ between two runs.
const OPEN_ENDED = "9999-12-31";
const overlaps = (a, b) =>
  a.effectiveFrom <= (b.effectiveTo ?? OPEN_ENDED) && b.effectiveFrom <= (a.effectiveTo ?? OPEN_ENDED);

for (let i = 0; i < sets.length; i += 1) {
  for (let j = i + 1; j < sets.length; j += 1) {
    const left = sets[i];
    const right = sets[j];

    if (
      left.ruleSet.publishedOn === right.ruleSet.publishedOn &&
      overlaps(left.ruleSet, right.ruleSet)
    ) {
      fail(
        right.file,
        `covers dates also covered by ${left.file} and shares publishedOn ` +
          `${right.ruleSet.publishedOn}; resolution order would be ambiguous.`,
      );
    }
  }
}

const ids = sets.map((s) => s.ruleSet.id);
const duplicateId = ids.find((id, index) => ids.indexOf(id) !== index);
if (duplicateId) {
  problems.push(`duplicate rule set id: ${duplicateId}`);
}

for (const warning of warnings) {
  console.warn(`warn  ${warning}`);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  process.exit(1);
}

const keyCount = sets.reduce((total, s) => total + Object.keys(s.ruleSet.values).length, 0);
console.log(`ok    ${sets.length} rule set(s), ${keyCount} rule value(s) validated.`);
