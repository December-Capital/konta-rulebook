#!/usr/bin/env node
/**
 * Validates every rule set in data/ against schemas/ruleset.schema.json and every chart of
 * accounts in charts/ against schemas/chart.schema.json, then applies the cross-file rules a
 * JSON Schema cannot express.
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
const chartsDir = join(root, "charts");
const schemaPath = join(root, "schemas", "ruleset.schema.json");
const chartSchemaPath = join(root, "schemas", "chart.schema.json");

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
const chartSchema = JSON.parse(await readFile(chartSchemaPath, "utf8"));
delete chartSchema.$schema;
const validateChart = ajv.compile(chartSchema);

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

// --- Charts of accounts --------------------------------------------------------------------

const charts = [];

for (const file of await collect(chartsDir)) {
  const shown = relative(root, file);
  let parsed;

  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(shown, `not valid JSON: ${error.message}`);
    continue;
  }

  const { $schema, ...chart } = parsed;

  if (!validateChart(chart)) {
    for (const error of validateChart.errors ?? []) {
      fail(shown, `${error.instancePath || "/"} ${error.message}`);
    }
    continue;
  }

  charts.push({ file: shown, chart });
}

for (const { file, chart } of charts) {
  const { status, effectiveFrom, effectiveTo, sources } = chart;

  if (effectiveTo && effectiveTo < effectiveFrom) {
    fail(file, `effectiveTo ${effectiveTo} precedes effectiveFrom ${effectiveFrom}.`);
  }

  // The act's own numbering: a group's code starts with its class's, an account's with its
  // group's (or its class's, where the class has no groups), a subaccount's with its account's.
  // In order and never twice, so a code typed wrong shows up here rather than in a ledger.
  const codes = [];
  const under = (code, parent, what) => {
    if (!code.startsWith(parent)) fail(file, `${what} ${code} is not under ${parent}.`);
    codes.push(code);
  };

  for (const cls of chart.classes) {
    codes.push(cls.code);

    if (Boolean(cls.groups?.length) === Boolean(cls.accounts?.length)) {
      fail(file, `class ${cls.code} must hold either groups or accounts directly, not both or neither.`);
    }

    const accounts = [];
    const take = (account, parent) => {
      under(account.code, parent, "account");
      for (const sub of account.subaccounts ?? []) under(sub.code, account.code, "subaccount");
      accounts.push(account);
    };
    for (const group of cls.groups ?? []) {
      under(group.code, cls.code, "group");
      for (const account of group.accounts) take(account, group.code);
    }
    for (const account of cls.accounts ?? []) take(account, cls.code);

    for (const account of accounts) {
      // A double-entry account the ledger cannot place on a side is not usable; a single-entry
      // one has no side to place.
      if (cls.doubleEntry && !account.nature) {
        fail(file, `account ${account.code} is double-entry but has no nature (activ or pasiv).`);
      }
      if (!cls.doubleEntry && account.nature) {
        fail(file, `account ${account.code} is in single-entry class ${cls.code} but has a nature.`);
      }

      if (status === "approved" && account.confidence === "unverified") {
        fail(file, `account ${account.code} is unverified, but the chart is approved.`);
      }
    }
  }

  // Decimal codes walked as a tree come out in plain string order: 1, 11, 111, 1121, 113.
  const ordered = codes.every((code, index) => index === 0 || codes[index - 1] < code);
  if (!ordered) fail(file, "codes are not in the act's order.");
  const twice = codes.find((code, index) => codes.indexOf(code) !== index);
  if (twice) fail(file, `code ${twice} appears twice.`);

  if (status === "approved" && !sources.every((s) => s.verified === true)) {
    fail(file, "approved chart has sources not marked verified.");
  }

  if (status === "draft") {
    warn(file, "status is draft — this chart has not been checked against the act by a licensed accountant.");
  }
}

for (let i = 0; i < charts.length; i += 1) {
  for (let j = i + 1; j < charts.length; j += 1) {
    const left = charts[i];
    const right = charts[j];

    if (left.chart.publishedOn === right.chart.publishedOn && overlaps(left.chart, right.chart)) {
      fail(
        right.file,
        `covers dates also covered by ${left.file} and shares publishedOn ` +
          `${right.chart.publishedOn}; which version applies would be ambiguous.`,
      );
    }
  }
}

const chartIds = charts.map((c) => c.chart.id);
const duplicateChart = chartIds.find((id, index) => chartIds.indexOf(id) !== index);
if (duplicateChart) {
  problems.push(`duplicate chart id: ${duplicateChart}`);
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
for (const { chart } of charts) {
  const accounts = chart.classes.flatMap((c) => [...(c.groups ?? []).flatMap((g) => g.accounts), ...(c.accounts ?? [])]);
  const subaccounts = accounts.reduce((total, a) => total + (a.subaccounts?.length ?? 0), 0);
  console.log(`ok    chart ${chart.id}: ${accounts.length} accounts, ${subaccounts} subaccounts validated.`);
}
