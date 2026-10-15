/**
 * Validates every document form in forms/ against schemas/form.schema.json, then what a JSON
 * Schema cannot say: every citation's source exists, field and column ids are unique, columns are
 * in the act's order, a total and the reverse-charge mention name columns the form has, the
 * required language is one it may be printed in, and an approved form carries nothing unverified.
 * Called from tools/validate.mjs.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const order = (code) => code.split(".").map(Number);
const before = (a, b) => {
  const [x, y] = [order(a), order(b)];
  return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
};

export async function validateForms({ root, ajv, fail, warn }) {
  const dir = join(root, "forms");
  const schema = JSON.parse(await readFile(join(root, "schemas", "form.schema.json"), "utf8"));
  delete schema.$schema;
  const validate = ajv.compile(schema);

  let names = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }

  const summary = [];

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

    const { $schema, ...form } = parsed;

    if (!validate(form)) {
      for (const error of validate.errors ?? []) fail(shown, `${error.instancePath || "/"} ${error.message}`);
      continue;
    }

    const { sources, status } = form;
    const citations = [
      form.series.source,
      form.series.selfPrinting,
      form.languages.source,
      form.zeroRate?.source,
      form.reverseCharge?.source,
      ...form.fields.map((f) => f.source),
      ...form.columns.map((c) => c.source),
      ...form.totals.map((t) => t.source),
      ...form.signatures.map((s) => s.source),
    ].filter(Boolean);

    for (const cite of citations) {
      if (!sources[cite.sourceIndex]) fail(shown, `cites source ${cite.sourceIndex}, which the form does not list.`);
    }

    for (const [what, list] of [["field", form.fields], ["column", form.columns]]) {
      const ids = list.map((x) => x.id);
      const twice = ids.find((id, i) => ids.indexOf(id) !== i);
      if (twice) fail(shown, `${what} ${twice} appears twice.`);
    }

    const codes = form.columns.map((c) => c.code);
    if (!codes.every((code, i) => i === 0 || before(codes[i - 1], code))) fail(shown, "columns are not in the act's order.");
    for (const total of form.totals) {
      for (const code of total.columns) if (!codes.includes(code)) fail(shown, `total ${total.code} names column ${code}, which the form does not have.`);
    }
    if (form.reverseCharge && !codes.includes(form.reverseCharge.column)) {
      fail(shown, `the reverse-charge mention goes in column ${form.reverseCharge.column}, which the form does not have.`);
    }
    if (!form.languages.allowed.includes(form.languages.required)) fail(shown, "the required language is not one it may be printed in.");

    if (form.effectiveTo && form.effectiveTo < form.effectiveFrom) fail(shown, "effectiveTo precedes effectiveFrom.");
    if (status === "approved" && !sources.every((s) => s.verified === true)) fail(shown, "approved form has sources not marked verified.");
    if (status === "draft") warn(shown, "status is draft — this form has not been checked against the act by a licensed accountant.");

    summary.push(`ok    form ${form.id}: ${form.fields.length} fields, ${form.columns.length} columns, ${citations.length} citations validated.`);
  }

  return summary;
}
