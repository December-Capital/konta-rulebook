/**
 * The calendar's half of the gate, called by tools/validate.mjs with the rule sets it has
 * already validated.
 *
 * Beyond the schema: every item cites a source that exists, every deadline's source names the
 * article and where it was published, nothing read only in a secondary source is dated, the
 * dates an authority published for a deadline are the dates the engine computes, a transfer of
 * rest days moves a working day and a weekend day, and a change in the law says what the rule
 * sets say on the day it takes effect.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { WorkingCalendar, expandDeadlines, loadCalendar, parts, weekday, orthodoxEaster, addDays } from "./calendar.mjs";

/** Long dashes are not used anywhere the site prints; these words are printed there. */
const LONG_DASH = /[–—]/;

export async function validateCalendar({ root, ajv, sets, fail, warn }) {
  const schema = JSON.parse(await readFile(join(root, "schemas", "calendar.schema.json"), "utf8"));
  delete schema.$schema;
  const validate = ajv.compile(schema);

  const loaded = await loadCalendar(join(root, "calendar"));
  const summary = [];
  const files = [];

  for (const [name, data] of Object.entries(loaded.files)) {
    const file = `calendar/${name}`;
    if (!validate(data)) {
      for (const error of validate.errors ?? []) fail(file, `${error.instancePath || "/"} ${error.message}`);
      continue;
    }
    files.push({ file, data });
  }

  const holidayFiles = files.filter((f) => f.data.kind === "holidays");
  if (holidayFiles.length !== 1) {
    fail("calendar/", `expected exactly one holidays file, found ${holidayFiles.length}.`);
    return summary;
  }

  for (const { file, data } of files) {
    const { sources } = data;

    const cite = (where, index) => {
      if (index === undefined) return null;
      if (index >= sources.length) {
        fail(file, `${where} cites source ${index}, but the file has ${sources.length}.`);
        return null;
      }
      return sources[index];
    };

    // Every printed word in three languages, and none with a long dash.
    walkWords(data, (path, words) => {
      for (const [lang, text] of Object.entries(words)) {
        if (LONG_DASH.test(text)) fail(file, `${path}.${lang} has a long dash; use a comma, a colon or a middle dot.`);
      }
    });

    if (data.status === "approved" && !sources.every((s) => s.verified === true)) {
      fail(file, "approved file has sources not marked verified.");
    }
    if (data.status === "draft") warn(file, "status is draft · not yet read against the acts by a licensed accountant.");

    if (data.kind === "holidays") {
      cite("weekend", data.weekend.sourceIndex);
      const ids = new Set();
      for (const h of data.holidays) {
        if (ids.has(h.id)) fail(file, `holiday ${h.id} appears twice.`);
        ids.add(h.id);
        const source = cite(`holiday ${h.id}`, h.sourceIndex);
        if (source && !source.article) fail(file, `holiday ${h.id} cites ${source.act} without an article.`);
      }

      for (const l of data.localDays ?? []) {
        cite(`local day ${l.date}`, l.sourceIndex);
        const basis = cite(`local day ${l.date} basis`, l.basisIndex);
        if (basis && basis.readIn !== "act") fail(file, `local day ${l.date}: its basis must be read in the act.`);
      }

      const calendar = new WorkingCalendar(data);
      for (const [year, entry] of Object.entries(data.years)) {
        cite(`year ${year}`, entry.sourceIndex);
        for (const t of entry.transfers) {
          cite(`transfer ${t.restDay}`, t.sourceIndex);
          if (String(parts(t.restDay).year) !== year && String(parts(t.workDay).year) !== year) {
            fail(file, `transfer ${t.restDay} -> ${t.workDay} is listed under ${year}.`);
          }
          // A transfer turns a working day into a rest day and pays it back on a day that was
          // not one. Anything else is a typo in a date.
          const plain = new WorkingCalendar({ ...data, years: {} });
          if (!plain.isWorkingDay(t.restDay)) fail(file, `transfer: ${t.restDay} was not a working day to begin with.`);
          if (plain.isWorkingDay(t.workDay)) fail(file, `transfer: ${t.workDay} was already a working day.`);
        }
        // Easter as the engine computes it, said out loud so a wrong year is caught by eye too.
        summary.push(`ok    ${year}: Orthodox Easter ${orthodoxEaster(Number(year))}, ${countOff(calendar, Number(year))} days off on weekdays, ${entry.transfers.length} transfer(s).`);
      }
    }

    if (data.kind === "deadlines") {
      const shiftSource = cite("shift", data.shift.sourceIndex);
      if (shiftSource && (!shiftSource.article || shiftSource.readIn === "secondary")) {
        fail(file, "the rule moving a deadline off a non-working day must cite an article read in the act or the authority's own text.");
      }

      const profiles = new Set();
      for (const p of data.profiles) {
        if (profiles.has(p.id)) fail(file, `profile ${p.id} appears twice.`);
        profiles.add(p.id);
      }

      const ids = new Set();
      const calendar = new WorkingCalendar(holidayFiles[0].data);
      let published = 0;
      let checks = 0;

      for (const d of data.deadlines) {
        if (ids.has(d.id)) fail(file, `deadline ${d.id} appears twice.`);
        ids.add(d.id);

        for (const p of d.appliesTo) {
          if (!profiles.has(p)) fail(file, `deadline ${d.id} applies to ${p}, which is not a profile.`);
        }

        // The point of the whole file: no deadline without the act, the article and where the
        // act was published.
        const source = cite(`deadline ${d.id}`, d.sourceIndex);
        if (source) {
          if (!source.article) fail(file, `deadline ${d.id} cites ${source.act} without an article.`);
          if (!source.url && !source.publication) fail(file, `deadline ${d.id} cites ${source.act} without a publication or a link.`);
          if (source.readIn === "secondary" && d.confidence !== "secondary") {
            fail(file, `deadline ${d.id} rests on a source read only in a secondary text; mark it "secondary" so it is never dated on the site.`);
          }
          if (!source.readIn) fail(file, `deadline ${d.id}: its source does not say where it was read (readIn).`);
        }
        cite(`deadline ${d.id} form`, d.formSourceIndex);
        for (const index of d.alsoSourceIndexes ?? []) cite(`deadline ${d.id} also`, index);
        if (d.schedule.every === "event" && d.checks?.length) fail(file, `deadline ${d.id} is counted from an event and cannot have dated checks.`);
        if (data.status === "approved" && d.confidence !== "verified") {
          fail(file, `deadline ${d.id} is ${d.confidence}, but the file is approved.`);
        }
        if (d.confidence !== "secondary" && d.schedule.every !== "event") published += 1;

        if (d.effectiveFrom && d.effectiveTo && d.effectiveTo < d.effectiveFrom) {
          fail(file, `deadline ${d.id}: effectiveTo precedes effectiveFrom.`);
        }

        // The authority's own dates, recomputed. A difference means the rule, the holidays or
        // the shift is wrong, and the whole calendar with it.
        for (const check of d.checks ?? []) {
          cite(`deadline ${d.id} check ${check.period}`, check.sourceIndex);
          const from = addDays(check.date, -40);
          const to = addDays(check.date, 40);
          const found = expandDeadlines(calendar, { ...data, deadlines: [d] }, from, to).filter(
            (o) => periodLabel(o) === check.period && (check.installment === undefined || o.installment === check.installment),
          );
          if (found.length !== 1 || found[0].date !== check.date) {
            fail(file, `deadline ${d.id} for ${check.period}: the authority published ${check.date}, the rulebook computes ${found.map((o) => o.date).join(", ") || "nothing"}.`);
          }
          checks += 1;
        }
      }
      summary.push(`ok    ${data.id}: ${data.deadlines.length} deadline rule(s), ${published} dated, ${checks} date(s) checked against the authority's own calendar.`);
    }

    if (data.kind === "changes") {
      const ids = new Set();
      for (const c of data.changes) {
        if (ids.has(c.id)) fail(file, `change ${c.id} appears twice.`);
        ids.add(c.id);
        const source = cite(`change ${c.id}`, c.sourceIndex);
        if (source && !source.url && !source.publication) fail(file, `change ${c.id} cites ${source.act} without a publication or a link.`);
        if (source?.readIn === "secondary") fail(file, `change ${c.id} rests on a secondary source only.`);
        if (c.state === "law" && source && !source.publication) {
          fail(file, `change ${c.id} is a law but its source names no Monitorul Oficial publication.`);
        }

        if ((c.before !== undefined || c.after !== undefined) && !c.unit) fail(file, `change ${c.id} has values but no unit.`);

        // A change tied to a rule-set value must say what the rule sets say.
        if (c.key) {
          const now = resolve(sets, c.key, c.effectiveFrom);
          if (!now) {
            fail(file, `change ${c.id}: no rule set carries ${c.key} on ${c.effectiveFrom}.`);
          } else if (c.after !== undefined && !sameNumber(now.value.number, c.after)) {
            fail(file, `change ${c.id}: says ${c.key} becomes ${c.after} on ${c.effectiveFrom}, but ${now.set} has ${now.value.number}.`);
          }
          const before = resolve(sets, c.key, addDays(c.effectiveFrom, -1));
          if (before && c.before !== undefined && !sameNumber(before.value.number, c.before)) {
            fail(file, `change ${c.id}: says ${c.key} was ${c.before} before ${c.effectiveFrom}, but ${before.set} has ${before.value.number}.`);
          }
          if (now && c.state === "law" && now.status === "bill") {
            fail(file, `change ${c.id}: a law, but its value comes from a rule set built on a bill.`);
          }
        }
      }
      const keyed = data.changes.filter((c) => c.key).length;
      summary.push(`ok    ${data.id}: ${data.changes.length} change(s) in the law, each tied to its act, ${keyed} checked against the rule sets.`);
    }
  }

  return summary;
}

function countOff(calendar, year) {
  let n = 0;
  for (const [date] of calendar.year(year).off) if (weekday(date) <= 5) n += 1;
  return n;
}

function periodLabel(o) {
  const p = o.period;
  if (p.kind === "month") return `${p.year}-${String(p.month).padStart(2, "0")}`;
  if (p.kind === "quarter") return `${p.year}-Q${p.quarter}`;
  if (p.kind === "half") return `${p.year}-H${p.half}`;
  return String(p.year);
}

function sameNumber(a, b) {
  return a !== undefined && b !== undefined && Number(a) === Number(b) && String(Number(a)) === String(Number(b));
}

function walkWords(value, visit, path = "") {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkWords(v, visit, `${path}[${v?.id ?? i}]`));
  } else if (value && typeof value === "object") {
    if (typeof value.ro === "string" && typeof value.ru === "string" && typeof value.en === "string") {
      visit(path, value);
      return;
    }
    for (const [k, v] of Object.entries(value)) walkWords(v, visit, path ? `${path}.${k}` : k);
  }
}

/**
 * The value of `key` on `date`: among the rule sets covering the date and carrying the key, the
 * one published last wins, as docs/FORMAT.md says.
 */
export function resolve(sets, key, date) {
  const covering = sets
    .map((s) => s.ruleSet)
    .filter((r) => r.effectiveFrom <= date && (!r.effectiveTo || date <= r.effectiveTo) && r.values[key])
    .sort((a, b) => (a.publishedOn < b.publishedOn ? 1 : a.publishedOn > b.publishedOn ? -1 : 0));
  if (covering.length === 0) return null;
  const set = covering[0];
  const value = set.values[key];
  // A value whose own source is a bill ("Proiectul legii ...") is not law yet.
  const bill = /^proiect/i.test(set.sources[value.sourceIndex]?.act ?? "");
  return { set: set.id, value, status: bill ? "bill" : "law" };
}
