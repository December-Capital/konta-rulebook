#!/usr/bin/env node
/**
 * Watches the official sources behind the rulebook for changes nobody has read yet.
 *
 * Run: npm run watch -- [--from-id N] [--mail] [--mail-env PATH] [--mail-to ADDRESS] [--dry-run]
 *
 * Three places are checked for every act in sources/watch.json:
 *
 *  - Monitorul Oficial, issue by issue. An amending order has no force until it is published
 *    there, so this is the signal that matters. Each issue's table of contents is public HTML at
 *    monitorul.gov.md/ro/monitor/{id}, ids rising; the watcher reads every issue it has not
 *    seen and reports any act matching the patterns that is not in `known`.
 *  - The Ministry of Finance's consolidated PDF, by its validators and its SHA-256. The ministry
 *    updates it late (the copy current in 2026 stops at 2019), so it is a second signal only.
 *  - The ministry's legislation listings, for new links about the act.
 *
 * legis.md holds the authoritative consolidated text but answers automated requests with a
 * Cloudflare challenge. It is tried and reported, never relied on.
 *
 * Nothing here changes data/. A finding means a person has to read the act, change the data,
 * and add the act to `known` in the same commit.
 *
 * Exit status: 0 nothing new, 1 something new, 2 a source could not be read.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const root = resolve(import.meta.dirname, "..");
const configPath = join(root, "sources", "watch.json");

const { values: args } = parseArgs({
  options: {
    "from-id": { type: "string" },
    mail: { type: "boolean", default: false },
    "mail-env": { type: "string" },
    "mail-to": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    state: { type: "string" },
  },
});

const statePath = resolve(
  args.state ??
    process.env.KONTA_WATCH_STATE ??
    join(homedir(), ".local", "state", "konta-rulebook", "watch-state.json"),
);
const archiveDir = join(dirname(statePath), "archive");

const userAgent = "konta-rulebook source watch (+https://github.com/December-Capital/konta-rulebook)";
/** Issues read on a first run with no state and no --from-id: about a month of the gazette. */
const firstRunIssues = 30;
/** A source failing this many runs in a row is mailed about, once. */
const failuresBeforeMail = 3;

const config = JSON.parse(await readFile(configPath, "utf8"));
const state = await readState();
const findings = [];
const notes = [];
const failures = [];

for (const act of config.acts) {
  act.patterns = act.match.map((p) => new RegExp(p, "i"));
  act.excludes = (act.exclude ?? []).map((p) => new RegExp(p, "i"));
  act.since = Number(act.since ?? 0);
  act.relatedPatterns = (act.related ?? []).map((p) => new RegExp(p, "i"));
  // An order amending an amending order changes the act too, and its title need not name the act:
  // OMF 171/2019 amended "ordinele nr.48/2019 și 100/2019" and so the chart, without saying so.
  for (const amendment of act.known.amendments) {
    act.patterns.push(new RegExp(`\\b${amendment.order.replace("/", "\\/")}\\b`, "i"));
  }
  act.knownKeys = {
    amendments: act.known.amendments.map((a) => fold(a.key)),
    related: act.known.related.map(fold),
  };
}

await attempt("gazette", watchGazette);
for (const act of config.acts) {
  await attempt(`mf-pdf:${act.id}`, () => watchPdf(act));
  await attempt(`legis:${act.id}`, () => watchLegis(act));
}
await attempt("mf-listings", watchListings);

const summary = render();
console.log(summary);

if (!args["dry-run"]) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");
}

const persistentFailures = failures.filter((f) => state.failures[f.source] === failuresBeforeMail);
if (args.mail && (findings.length > 0 || persistentFailures.length > 0)) {
  await mail(summary);
}

process.exit(findings.length > 0 ? 1 : failures.length > 0 ? 2 : 0);

// ---------------------------------------------------------------------------------------------

async function readState() {
  try {
    const loaded = JSON.parse(await readFile(statePath, "utf8"));
    return { gazetteLastId: null, reported: {}, failures: {}, sources: {}, ...loaded };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { gazetteLastId: null, reported: {}, failures: {}, sources: {} };
  }
}

async function attempt(source, run) {
  try {
    await run();
    state.failures[source] = 0;
  } catch (error) {
    state.failures[source] = (state.failures[source] ?? 0) + 1;
    failures.push({ source, message: error.message, runs: state.failures[source] });
  }
}

async function get(url, init = {}) {
  let lastError;
  for (let tries = 0; tries < 3; tries++) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: { "user-agent": userAgent, "accept-language": "ro", ...init.headers },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status < 500) return response;
      lastError = new Error(`${url}: HTTP ${response.status}`);
    } catch (error) {
      lastError = new Error(`${url}: ${error.message}`);
    }
    await sleep(2000 * (tries + 1));
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/** Lower case, without diacritics, so "Ordinul Ministerului Finanţelor" matches however it is typed. */
function fold(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function decode(html) {
  return html
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;|&[lrb]dquo;|&[lr]aquo;/g, '"')
    .replace(/&[lrs]squo;|&sbquo;/g, "'")
    .replace(/&[nm]dash;/g, "-")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&([a-z])(acute|grave|circ|uml|tilde|cedil|caron|breve)\b;/gi, (m, letter, mark) => {
      const combining = { acute: "́", grave: "̀", circ: "̂", uml: "̈", tilde: "̃", cedil: "̧", caron: "̌", breve: "̆" };
      return (letter + combining[mark.toLowerCase()]).normalize("NFC");
    })
    .replace(/&#(\d+);/g, (m, code) => String.fromCodePoint(Number(code)));
}

function textOf(html) {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function classify(act, text) {
  const folded = fold(text);
  if (act.excludes.some((p) => p.test(folded))) return null;
  if (act.patterns.some((p) => p.test(folded))) return "amendments";
  if (act.relatedPatterns.some((p) => p.test(folded))) return "related";
  return null;
}

/** The year in "(nr. 111, 13 septembrie 2021)", or null. */
function actYear(text) {
  return Number(text.match(/\(nr\.[^()]*?(\d{4})\)/i)?.[1]) || null;
}

/** "(nr. 111, 13 septembrie 2021)" at the end of a gazette line: the act's own number and date. */
function actKey(text) {
  const match = text.match(/\((nr\.[^()]*\d{4})\)\s*$/i);
  return fold(match ? match[1] : text).replace(/\s+/g, " ");
}

function record(kind, act, key, finding) {
  const id = `${act.id}:${kind}:${key}`;
  if (state.reported[id]) return;
  state.reported[id] = new Date().toISOString();
  findings.push({ act: act.id, kind, ...finding });
}

// --- Monitorul Oficial -----------------------------------------------------------------------

async function watchGazette() {
  const home = await (await get(config.gazette.home)).text();
  const ids = [...home.matchAll(/\/ro\/monitor\/(\d+)/g)].map((m) => Number(m[1]));
  if (ids.length === 0) throw new Error("monitorul.gov.md: no issue links on the home page");
  const latest = Math.max(...ids);

  let next = args["from-id"]
    ? Number(args["from-id"])
    : state.gazetteLastId !== null
      ? state.gazetteLastId + 1
      : latest - firstRunIssues + 1;
  const first = next;
  let read = 0;

  for (; next <= latest; next++) {
    const url = config.gazette.issue.replace("{id}", String(next));
    const response = await get(url);
    if (response.status === 404) {
      state.gazetteLastId = next;
      continue;
    }
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    readIssue(next, url, await response.text());
    state.gazetteLastId = next;
    read++;
    await sleep(250);
  }

  notes.push(`Monitorul Oficial: ${read} issue(s) read, ids ${first} to ${latest}.`);
}

function readIssue(id, url, html) {
  const title = textOf(html.match(/<title>([^<]*)/)?.[1] ?? "");
  const start = html.indexOf("release-intro-text");
  if (start < 0) return;
  const end = html.indexOf("release-see-more-btns", start);
  const contents = html.slice(start, end < 0 ? undefined : end);

  let heading = "";
  for (const block of contents.split(/<\/(?:div|p|h\d)>|<br\s*\/?>/i)) {
    const line = textOf(block);
    if (!line) continue;
    if (!/^\d+\.\s/.test(line)) {
      heading = line;
      continue;
    }
    for (const act of config.acts) {
      const kind = classify(act, line);
      if (!kind) continue;
      const key = actKey(line);
      if (act.knownKeys[kind].includes(key)) continue;
      // The gazette's archive holds digitised issues back to the 1990s; nothing older than the
      // act can amend it.
      if ((actYear(line) ?? Infinity) < act.since) continue;
      record(`gazette-${kind}`, act, key, {
        where: `${title} · ${heading}`,
        text: line,
        url,
      });
    }
  }
}

// --- Ministry of Finance ---------------------------------------------------------------------

async function watchPdf(act) {
  const url = act.official.mfPdf;
  const previous = (state.sources[url] ??= {});
  const headers = {};
  if (previous.etag) headers["if-none-match"] = previous.etag;
  if (previous.lastModified) headers["if-modified-since"] = previous.lastModified;

  const response = await get(url, { headers });
  if (response.status === 304) {
    notes.push(`${act.id}: the ministry's PDF unchanged since ${previous.lastModified ?? "the last run"}.`);
    return;
  }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);

  const body = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(body).digest("hex");
  Object.assign(previous, {
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    sha256,
  });

  if (!args["dry-run"]) {
    await mkdir(archiveDir, { recursive: true });
    await writeFile(join(archiveDir, `${act.id}-${sha256.slice(0, 12)}.pdf`), body);
  }

  if (sha256 === act.known.mfPdf) {
    notes.push(`${act.id}: the ministry's PDF is the known version (${previous.lastModified}).`);
    return;
  }
  record("mf-pdf", act, sha256, {
    where: "Ministerul Finanțelor, consolidated PDF",
    text: `A version nobody has read: SHA-256 ${sha256}, Last-Modified ${previous.lastModified}. A copy is in ${archiveDir}.`,
    url,
  });
}

async function watchListings() {
  for (const url of config.mfListings) {
    const response = await get(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const html = await response.text();
    for (const match of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const text = textOf(match[2]);
      const href = new URL(decode(match[1]), url).href;
      for (const act of config.acts) {
        if (classify(act, text) !== "amendments") continue;
        if (act.known.mfLinks.includes(href)) continue;
        record("mf-link", act, href, { where: `Ministerul Finanțelor, ${url}`, text, url: href });
      }
    }
  }
}

// --- legis.md ---------------------------------------------------------------------------------

async function watchLegis(act) {
  const url = act.official.legis;
  const response = await get(url);
  const html = await response.text();
  if (response.status === 403 || /just a moment|doar un moment|challenge-platform/i.test(html)) {
    notes.push(`${act.id}: legis.md refused the request (Cloudflare challenge); check it by hand.`);
    return;
  }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);

  const amendments = [
    ...new Set(
      [...textOf(html).matchAll(/(?:modificat|completat|exclus|abrogat|introdus)\w* prin [^\]]*?nr\.?\s*(\d+)\s+din\s+([0-9.]+)/gi)].map(
        (m) => `nr. ${m[1]} din ${m[2]}`,
      ),
    ),
  ].sort();
  const digest = createHash("sha256").update(amendments.join("\n")).digest("hex");
  const previous = (state.sources[url] ??= {});
  if (previous.amendments && previous.digest !== digest) {
    const added = amendments.filter((a) => !previous.amendments.includes(a));
    record("legis", act, digest, {
      where: "legis.md, consolidated text",
      text: `Amendment notes changed. New: ${added.join("; ") || "(none added, some removed)"}.`,
      url,
    });
  }
  Object.assign(previous, { amendments, digest });
  notes.push(`${act.id}: legis.md read, ${amendments.length} amending orders cited.`);
}

// --- Output ----------------------------------------------------------------------------------

function render() {
  const lines = [`Checked ${new Date().toISOString()}.`];
  lines.push(
    findings.length > 0
      ? `${findings.length} change(s) in the official sources that nobody has read yet.`
      : "Nothing new in the official sources.",
  );
  for (const finding of findings) {
    const label = { "gazette-amendments": "amends the act", "gazette-related": "related" }[finding.kind] ?? finding.kind;
    lines.push("", `[${finding.act} · ${label}] ${finding.where}`, `  ${finding.text}`, `  ${finding.url}`);
  }
  if (failures.length > 0) {
    lines.push("", "Could not read:");
    for (const failure of failures) {
      lines.push(`  ${failure.source} (${failure.runs} run(s) in a row): ${failure.message}`);
    }
  }
  if (notes.length > 0) lines.push("", ...notes);
  if (findings.length > 0) {
    lines.push(
      "",
      "Read each act, change data/ if it changes the rulebook, and add it to `known` in",
      "sources/watch.json in the same commit.",
    );
  }
  return lines.join("\n");
}

async function mail(text) {
  const envPath = args["mail-env"] ?? process.env.KONTA_WATCH_MAIL_ENV;
  if (!envPath) throw new Error("--mail needs --mail-env (the konta .env holding the SMTP settings)");
  const env = Object.fromEntries(
    (await readFile(envPath, "utf8"))
      .split("\n")
      .map((line) => line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^(['"])(.*)\1$/, "$2")]),
  );
  const from = env.Konta__Email__General__Address;
  const security = (env.Konta__Email__Smtp__Security ?? "").toLowerCase();
  const { createTransport } = await import("nodemailer");
  const transport = createTransport({
    host: env.Konta__Email__Smtp__Host,
    port: Number(env.Konta__Email__Smtp__Port),
    // The API's MailKit names: SslOnConnect is implicit TLS; StartTls upgrades a plain connection.
    secure: security === "sslonconnect",
    auth: { user: from, pass: env.Konta__Email__General__Password },
  });
  await transport.sendMail({
    from: `Konta rulebook <${from}>`,
    to: args["mail-to"] ?? process.env.KONTA_WATCH_MAIL_TO ?? from,
    subject: findings.length > 0 ? `Rulebook: ${findings.length} change(s) in the official sources` : "Rulebook: a source cannot be read",
    text,
  });
}
