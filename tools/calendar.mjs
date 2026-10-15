#!/usr/bin/env node
/**
 * The fiscal calendar, expanded from calendar/ into dated items.
 *
 * Run: node tools/calendar.mjs [--from 2026-01-01] [--to 2027-12-31]
 *
 * Prints JSON: every non-working day, every deadline falling between the two dates (moved off a
 * non-working day by the rule its act gives), and every change in the law, each with the sources
 * it rests on. konta-www builds konta.md/calendar from this output, and tools/validate.mjs checks
 * the data with the same functions, so the site, the validator and later the product compute a
 * date one way only.
 *
 * Dates are plain "YYYY-MM-DD" strings throughout, never Date objects in local time: a deadline
 * is a day in Chișinău, and no time zone may move it.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

export const root = resolve(import.meta.dirname, "..");
export const calendarDir = join(root, "calendar");

// --- Days ----------------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0");

export function iso(year, month, day) {
  // Through UTC so a day past the end of a month rolls over the way the calendar does.
  const d = new Date(Date.UTC(year, month - 1, day));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function parts(date) {
  const [y, m, d] = date.split("-").map(Number);
  return { year: y, month: m, day: d };
}

export function addDays(date, days) {
  const { year, month, day } = parts(date);
  return iso(year, month, day + days);
}

/** 1 Monday ... 7 Sunday, as ISO 8601 numbers them. */
export function weekday(date) {
  const { year, month, day } = parts(date);
  return ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
}

export function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Day `day` of a month, or its last day when the month is shorter (31 in a 30-day month). */
export function dayOfMonth(year, month, day) {
  const y = year + Math.floor((month - 1) / 12);
  const m = ((month - 1) % 12 + 12) % 12 + 1;
  return iso(y, m, Math.min(day, lastDayOfMonth(y, m)));
}

/**
 * Orthodox Easter Sunday in the Gregorian calendar: the Julian computus (Meeus), then the
 * thirteen days between the two calendars, valid from 1900 to 2099.
 */
export function orthodoxEaster(year) {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return iso(year, month, day + 13);
}

// --- Loading -------------------------------------------------------------------------------

export async function loadCalendar(dir = calendarDir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const loaded = { holidays: [], deadlines: [], changes: [], files: {} };
  for (const name of files) {
    const { $schema, ...data } = JSON.parse(await readFile(join(dir, name), "utf8"));
    loaded.files[name] = data;
    loaded[data.kind]?.push({ file: `calendar/${name}`, ...data });
  }
  return loaded;
}

// --- Working days --------------------------------------------------------------------------

/**
 * The year's days off and the days worked in their place.
 *
 * `holidays` is a holidays file: the Labour Code's list (fixed dates and those counted from
 * Orthodox Easter, each with the dates it was in force) plus each year's transfers by Government
 * decision. Returns { off: Map(date -> [{ id, name, kind, sourceIndex }]), worked: Map(date -> transfer) }.
 */
export function daysOff(holidays, year) {
  const off = new Map();
  const worked = new Map();
  const add = (date, entry) => {
    if (!off.has(date)) off.set(date, []);
    off.get(date).push(entry);
  };
  const inForce = (h, date) =>
    (!h.effectiveFrom || h.effectiveFrom <= date) && (!h.effectiveTo || date <= h.effectiveTo);

  for (const h of holidays.holidays) {
    const dates = [];
    if (h.date) dates.push(`${year}-${h.date.slice(2)}`);
    if (h.easterOffset !== undefined) dates.push(addDays(orthodoxEaster(year), h.easterOffset));
    for (const date of dates) {
      if (inForce(h, date)) add(date, { id: h.id, kind: "holiday", name: h.name, sourceIndex: h.sourceIndex });
    }
  }

  const transfers = holidays.years?.[year]?.transfers ?? [];
  for (const t of transfers) {
    add(t.restDay, { id: `transfer-${t.restDay}`, kind: "transfer", name: t.name, sourceIndex: t.sourceIndex, workDay: t.workDay });
    worked.set(t.workDay, t);
  }
  return { off, worked };
}

export class WorkingCalendar {
  constructor(holidays) {
    this.holidays = holidays;
    this.years = new Map();
  }

  year(year) {
    if (!this.years.has(year)) this.years.set(year, daysOff(this.holidays, year));
    return this.years.get(year);
  }

  /** Whether the year's transfers have been read: false means a decision may still move days. */
  known(year) {
    return Boolean(this.holidays.years?.[year]);
  }

  isWorkingDay(date) {
    const { year } = parts(date);
    const { off, worked } = this.year(year);
    if (worked.has(date)) return true;
    if (off.has(date)) return false;
    return !this.holidays.weekend.days.includes(weekday(date));
  }

  /** The reasons `date` is not a working day: weekend, holidays, transfers. */
  why(date) {
    const { off } = this.year(parts(date).year);
    const reasons = [...(off.get(date) ?? [])];
    if (!this.isWorkingDay(date) && reasons.length === 0) reasons.push({ id: "weekend", kind: "weekend" });
    return reasons;
  }

  nextWorkingDay(date) {
    let d = date;
    for (let i = 0; i < 31 && !this.isWorkingDay(d); i += 1) d = addDays(d, 1);
    return d;
  }
}

// --- Deadlines -----------------------------------------------------------------------------

const QUARTER_END = [3, 6, 9, 12];

/**
 * Every nominal due date of a rule between `from` and `to`, with the period it is for.
 * The rule's own `schedule` says how: see schemas/calendar.schema.json.
 */
export function nominalDates(rule, from, to) {
  const s = rule.schedule;
  const out = [];
  const firstYear = parts(from).year - 2;
  const lastYear = parts(to).year + 1;

  for (let year = firstYear; year <= lastYear; year += 1) {
    if (s.every === "month") {
      for (let month = 1; month <= 12; month += 1) {
        const due = dayOfMonth(year, month + (s.monthsAfter ?? 1), s.day);
        out.push({ due, period: { kind: "month", year, month } });
      }
    } else if (s.every === "quarter") {
      QUARTER_END.forEach((end, index) => {
        const due = dayOfMonth(year, end + (s.monthsAfter ?? 1), s.day);
        out.push({ due, period: { kind: "quarter", year, quarter: index + 1 } });
      });
    } else if (s.every === "half") {
      [6, 12].forEach((end, index) => {
        const due = dayOfMonth(year, end + (s.monthsAfter ?? 1), s.day);
        out.push({ due, period: { kind: "half", year, half: index + 1 } });
      });
    } else if (s.every === "year" && s.daysAfter) {
      // "în termen de 120 de zile de la ultima zi a perioadei de gestiune": counted, so a leap
      // year moves it a day.
      out.push({ due: addDays(`${year}-12-31`, s.daysAfter), period: { kind: "year", year } });
    } else if (s.every === "year") {
      for (const at of s.dates) {
        const [month, day] = at.slice(2).split("-").map(Number);
        const due = dayOfMonth(year + (s.yearsAfter ?? 0), month, day);
        out.push({ due, period: { kind: "year", year }, installment: s.dates.length > 1 ? s.dates.indexOf(at) + 1 : undefined, of: s.dates.length > 1 ? s.dates.length : undefined });
      }
    }
  }
  return out.filter((o) => o.due >= addDays(from, -10) && o.due <= to);
}

/**
 * The deadlines between `from` and `to`, each moved to the next working day when the act says
 * so. An occurrence whose year's transfers are not yet known says so (`calendarKnown: false`).
 */
export function expandDeadlines(calendar, deadlinesFile, from, to) {
  const items = [];
  for (const rule of deadlinesFile.deadlines) {
    if (rule.schedule.every === "event") continue; // counted from an event, never a date
    for (const o of nominalDates(rule, from, to)) {
      if (rule.effectiveFrom && o.due < rule.effectiveFrom) continue;
      if (rule.effectiveTo && o.due > rule.effectiveTo) continue;
      const shift = rule.shift ?? deadlinesFile.shift?.rule;
      const date = shift === "next_working_day" ? calendar.nextWorkingDay(o.due) : o.due;
      if (date < from || date > to) continue;
      items.push({
        id: rule.id,
        date,
        nominal: o.due,
        moved: date !== o.due ? calendar.why(o.due) : undefined,
        // Where no act moves it, say so rather than move it ourselves.
        unmovedOnDayOff: shift !== "next_working_day" && !calendar.isWorkingDay(o.due) ? calendar.why(o.due) : undefined,
        period: o.period,
        installment: o.installment,
        of: o.of,
        calendarKnown: calendar.known(parts(o.due).year),
      });
    }
  }
  return items.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));
}

// --- Everything ----------------------------------------------------------------------------

export async function expand({ from, to, dir } = {}) {
  const loaded = await loadCalendar(dir);
  const holidays = loaded.holidays[0];
  const calendar = new WorkingCalendar(holidays);

  const days = [];
  for (let year = parts(from).year; year <= parts(to).year; year += 1) {
    const { off, worked } = calendar.year(year);
    for (const [date, entries] of off) {
      if (date >= from && date <= to) days.push({ date, off: entries });
    }
    for (const [date, t] of worked) {
      if (date >= from && date <= to) days.push({ date, worked: { restDay: t.restDay, sourceIndex: t.sourceIndex } });
    }
  }
  // Days off in some localities only: on the calendar, never in the working-day arithmetic.
  for (const l of holidays.localDays ?? []) {
    if (l.date >= from && l.date <= to) days.push({ date: l.date, local: [l] });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const deadlines = loaded.deadlines.flatMap((file) =>
    expandDeadlines(calendar, file, from, to).map((item) => ({ file: file.file, ...item })),
  );

  const years = {};
  for (let year = parts(from).year; year <= parts(to).year; year += 1) {
    years[year] = { transfersKnown: calendar.known(year), ...(holidays.years?.[year] ?? {}) };
  }

  return { from, to, years, days, deadlines, files: loaded.files };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      from: { type: "string", default: `${new Date().getUTCFullYear()}-01-01` },
      to: { type: "string", default: `${new Date().getUTCFullYear() + 1}-12-31` },
    },
  });
  const out = await expand({ from: values.from, to: values.to });
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}
