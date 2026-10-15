/**
 * Validates every classifier in classifiers/ against schemas/classifier.schema.json, then the
 * rules a JSON Schema cannot express: each list's source resolves, ids and codes are unique and
 * in the source's order of ids, a VAT rate code's ratio matches its code, and an approved file
 * carries nothing unverified. Called from tools/validate.mjs.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export async function validateClassifiers({ root, ajv, fail, warn }) {
  const dir = join(root, "classifiers");
  const schema = JSON.parse(await readFile(join(root, "schemas", "classifier.schema.json"), "utf8"));
  delete schema.$schema;
  // Its sources' items are the rule sets' schema, which validate.mjs has already compiled into ajv.
  const validate = ajv.compile(schema);

  let names = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }

  const summary = [];
  const ids = [];

  for (const name of names) {
    const file = join(dir, name);
    const shown = relative(root, file);
    let parsed;

    try {
      parsed = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      fail(shown, `not valid JSON: ${error.message}`);
      continue;
    }

    const { $schema, ...classifier } = parsed;

    if (!validate(classifier)) {
      for (const error of validate.errors ?? []) {
        fail(shown, `${error.instancePath || "/"} ${error.message}`);
      }
      continue;
    }

    ids.push(classifier.id);
    const { sources, status, effectiveFrom, effectiveTo } = classifier;

    if (effectiveTo !== null && effectiveTo !== undefined && effectiveTo < effectiveFrom) {
      fail(shown, `effectiveTo ${effectiveTo} is before effectiveFrom ${effectiveFrom}.`);
    }

    if (status === "approved" && !classifier.approvedBy) {
      fail(shown, "approved without approvedBy.");
    }

    if (status === "approved" && !sources.every((s) => s.verified === true)) {
      fail(shown, "approved classifier has sources not marked verified.");
    }

    if (status === "draft") {
      warn(shown, "status is draft — these lists have not been checked by a licensed accountant.");
    }

    const counts = [];

    for (const [key, list] of Object.entries(classifier.lists)) {
      if (list.sourceIndex >= sources.length) {
        fail(shown, `${key} cites source ${list.sourceIndex}, but the file has ${sources.length}.`);
      }

      const seenIds = new Set();
      const seenCodes = new Set();
      let previous = -1;

      for (const entry of list.entries) {
        if (seenIds.has(entry.id)) fail(shown, `${key}: id ${entry.id} twice.`);
        if (seenCodes.has(entry.code)) fail(shown, `${key}: code "${entry.code}" twice.`);
        if (entry.id <= previous) fail(shown, `${key}: id ${entry.id} after ${previous}; keep the source's order.`);
        if (entry.code !== entry.code.trim()) fail(shown, `${key}: code "${entry.code}" has spaces around it.`);
        seenIds.add(entry.id);
        seenCodes.add(entry.code);
        previous = entry.id;

        if ("rate" in entry && entry.rate !== null) {
          // e-Factura writes a rate as its whole percentage: "20" stands for 0.20.
          const percent = Number(entry.code);
          const expected = Number.isInteger(percent) ? (percent / 100).toFixed(2).replace(/^0\.00$/, "0") : null;
          if (expected === null || Number(entry.rate) !== Number(expected)) {
            fail(shown, `${key}: code "${entry.code}" has rate ${entry.rate}.`);
          }
        }
      }

      counts.push(`${list.entries.length} ${key}`);
    }

    summary.push(`ok    classifier ${classifier.id}: ${counts.join(", ")} validated.`);
  }

  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) fail("classifiers/", `duplicate classifier id: ${duplicate}`);

  return summary;
}
