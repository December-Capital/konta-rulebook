# konta-rulebook — format and rules for contributors

The technical notes that used to be the README.

Moldovan fiscal law as data: rates, thresholds, deadlines, chart of accounts, classifications and
form definitions, each stamped with the dates it applies to and a citation to the act it comes from.

**This repository is public on purpose.** [Konta](https://github.com/December-Capital/konta) is
built to replace 1C, and the fair question anyone should ask of a new accounting product is "how do
I know your tax maths is right?" The answer is: read it. Every rate here cites the act it comes
from, and if we get one wrong you can open an issue or a pull request.

> ⚠️ **Every rule set in this repository is currently `draft` and every value is marked
> `unverified`.** Values are corroborated by Ministry of Finance, SFS and CNAS publications, but
> nobody has yet read the cited articles in the Fiscal Code itself. Nothing here may be used to
> produce a real filing until a licensed accountant has read each cited act and approved the set.

## Why it is a separate repository

Three reasons, all practical:

1. **It ships on a different clock.** Code ships when code is ready; this ships when the law
   changes. Moldova rewrites fiscal policy every year, and amendments land mid-year with
   retroactive effect.
2. **Different authors.** The compliance owner is a licensed accountant, not a developer. This
   repository is small, plain JSON, and reviewable without a build.
3. **It can be public while the product is not.** The product contains the posting engine and
   migration tooling. The rulebook contains facts about published law, which nobody benefits from
   us hiding.

## Layout

```
schemas/ruleset.schema.json    the contract
data/2026/md-2026.json         the year's base set
data/2026/md-2026.2.json       a sparse amendment: only the keys that changed mid-year
data/2027/md-2027.json
charts/md-pgcc-2020.json       Planul general de conturi contabile, in force from 1 January 2020
schemas/chart.schema.json      the contract for a chart of accounts
classifiers/sfs-efactura-2026.json  e-Factura's units of measure and VAT rate codes, from SFS's workbook
schemas/classifier.schema.json the contract for a classifier
forms/md-factura-fiscala-2026.json  the factură fiscală's layout (OMF 118/2017 as amended), what a print shows
schemas/form.schema.json       the contract for a document form
calendar/md-holidays.json      the weekend, the Labour Code's public holidays, each year's transfers of rest days
calendar/md-deadlines.json     filing and payment deadlines, who they apply to, the rule for a non-working day
calendar/md-changes.json       changes in the law: from when, the value before and after, the act
schemas/calendar.schema.json   the contract for the three calendar files
tools/calendar.mjs             expands the calendar into dated items (npm run calendar -- --from --to)
tools/validate.mjs             the gate: schema plus the cross-file rules JSON Schema can't express
tools/watch-sources.mjs        reports changes in the official sources that nobody has read yet
sources/watch.json             the acts it watches, and what has already been read
fixtures/                      anonymised golden-test datasets (Phase 1)
```

## Use it

```bash
npm install
npm run validate
```

## How a rule set works

A set is an immutable slice of law with a date range, a publication date, citations and a flat map
of namespaced values:

```json
{
  "id": "md-2026",
  "effectiveFrom": "2026-01-01",
  "effectiveTo": "2026-12-31",
  "publishedOn": "2026-09-26",
  "status": "draft",
  "sources": [{ "act": "Codul fiscal nr. 1163/1997", "verified": false }],
  "values": {
    "tax.dividend.rate": {
      "number": "0.06",
      "unit": "ratio",
      "sourceIndex": 0,
      "confidence": "unverified"
    }
  }
}
```

Three design choices worth understanding before you add anything:

**`publishedOn` is not `effectiveFrom`.** Moldova amends the Fiscal Code in March with effect from
January. Reproducing what a filing looked like *when it was filed* needs both dates, so sets may
overlap and the later-published set wins for a date they both cover. That is the mechanism for
retroactive amendment, and it is why a correction is auditable rather than a silent restatement.

**Rates are decimal strings, not JSON numbers.** `"0.07"`, never `0.07`. These values feed money
arithmetic directly, and the validator rejects non-integer JSON numbers for exactly that reason.
Ratios are fractions: `0.12`, never `12`.

**Nothing enters without a citation.** `sourceIndex` points into the set's own `sources`, and the
validator checks it resolves. A value nobody can trace to a published act does not belong here.

## The chart of accounts

`charts/` holds the *Planul general de conturi contabile* (OMF 119/2013) as published, one file per
version in force, with the same dates, citations and draft/approved status as a rule set. It is a
tree: 9 classes, their groups, synthetic accounts (gradul I, three digits) and subaccounts (gradul
II, four digits). Class 9 has no groups in the act, so its accounts sit directly under the class.

It is **transcribed, never reconstructed.** `md-pgcc-2020` was parsed from the Ministry of
Finance's consolidated PDF (its SHA-256 is in the first source) and checked against itself: every
code under its parent and in order, and every account's name compared with the heading chapter III
gives it. Four headings in chapter III were not restated in 2019 and differ; the nomenclature wins
and the account carries a `note`. One typo in the PDF is corrected, with a `note` saying so.

Each account carries what the ledger needs from the act:

- `nature`: `activ` (debit side) or `pasiv` (credit side), with `qualifier` `rectificativ` for a
  contra account, `calculație` or `colectare – repartizare` for class 8.
- `natureFrom`: whether the account's own sentence in chapter III says so (`account`), its class's
  opening does (`class`, for classes 6 and 7), or only chapter I's general rule (`general-rule`).
- `history`: the act's own amendment notes for the account.

And each class carries chapter I's rules: its general side (`nature`: activ for 1, 2, 7 and 8,
pasiv for 3 to 6, which is also the side of an account an entity adds there), whether its synthetic
accounts are mandatory (classes 1-7), what an entity may add to its own working chart (subaccounts
in 1-7; accounts and subaccounts in 8-9), and whether it is double-entry (all but class 9).

And the chart carries its year-end closing (`closing`), as chapters I and III state it: which
classes are income (6) and expenses (7), settled at the end of the reporting period into the result
account (351, which then has no balance), whose balance goes to the net result (333); and which
classes are management accounts (8), closed first by the entity's own calculation. Each of the four
movements (income, expenses, profit, loss) quotes chapter III's sentence word for word, with its
page in the ministry's PDF. The validator refuses a class on the wrong side, an account the chart
does not have, and a movement that does not go the way its kind does. The product reads only this:
no account number is written in its code. A non-commercial organisation's 336 is not encoded.

A later amendment is a new file with a later `effectiveFrom`, never an edit to an approved one.

## Classifiers

`classifiers/` holds lists of codes a state system prescribes, transcribed from the file the
authority publishes: `sfs-efactura-2026.json` has the two lists of SFS's e-Factura workbook
(`Classificators.xlsx`, received with the integration package on 2026-10-06, its SHA-256 in the
source): 74 units of measure, each the code an invoice line carries in `UnitOfMeasure` (`buc`,
`kg`, `m2`), and the VAT rate codes a line carries in `TVA` (`0`, `8`, `12`, `20`, `10` and `-`),
each with the ratio it stands for. Entries keep SFS's own ids and spelling (`Nuton` among them)
and the workbook's order; the workbook gives no names, and none are invented.

SFS does not date the workbook, so `effectiveFrom` is the day it reached us. Which rate applies to
a supply on a date is a rule set's value (`tax.vat.*`); the classifier says only how e-Factura
writes it. `npm run validate` refuses an id or a code twice, ids out of the source's order, a
list citing a source the file lacks, and a VAT code whose ratio is not its percentage.

When SFS sends a new workbook: a new file with a later `effectiveFrom`, never an edit of an
approved one.

## Document forms

`forms/` holds the layout of a primary document as its act prescribes it, so the product prints in
the act's own numbering and words and never in labels of its own (rule 1). `md-factura-fiscala-2026`
is the factură fiscală of OMF 118/2017, with every amendment found in Monitorul Oficial applied by
us and the seven that touch it listed with each PDF's SHA-256: the title and every row and column a
sales invoice of goods or services fills, in Romanian and in Russian as the bilingual form (Anexa
nr. 1, read from the page image) prints them; who assigns the series and number (the State Tax
Service, Instrucțiunea pct. 7); the languages it may be printed in (Romanian always, Ordinul pct. 5
as OMF 66/2022 rewrote it); the zero rate's "0" and the reverse-charge mention; and the
Instrucțiunea's sentence behind each, with its page. The transport rows and columns 10.10-10.12 are
not encoded. `tools/validate-forms.mjs` refuses a citation of a source the form does not list, an id
twice, columns out of the act's order, a total or the reverse-charge mention naming a column the form
lacks, and a required language it may not be printed in.

To read by hand: the Instrucțiune approved by HG 294/1998 (pct. 10 of OMF 118's Instrucțiune refers
to it for the mandatory indicators) and Codul fiscal art. 117; and the consolidated text on legis.md,
to confirm no amendment was missed by reading Monitorul Oficial's tables of contents.

## Adding or changing a rule

1. Never edit an approved set in place — the numbers it produced are in filings that have been
   submitted. Add a new set, or an amendment with a later `publishedOn`.
2. Cite the act, with the Monitorul Oficial reference and a link.
3. Read the act. Then set `confidence: "verified"` and the source's `verified: true`.
4. Keep `status: "draft"` until the compliance owner approves it. The validator refuses to let an
   approved set contain unverified values.
5. `npm run validate` must pass. Golden tests in the product must still pass.

## Knowing when the law changes

`npm run watch` checks the official sources behind each act listed in `sources/watch.json` and
reports anything a person has not read yet:

- **Monitorul Oficial**, issue by issue (`monitorul.gov.md/ro/monitor/{id}`). An amending order
  has no force until it is published there, so this is the signal that matters. Every issue the
  watcher has not seen is read; an act matching the patterns and missing from `known` is new.
- **The Ministry of Finance's consolidated PDF**, by its SHA-256. The ministry updates it late
  (the copy online in 2026 stops at its 2019 amendments), so it is a second signal, never a source
  of truth on its own.
- **The ministry's legislation listings**, for new links about the act.
- **legis.md** holds the authoritative consolidated text but answers automated requests with a
  Cloudflare challenge. It is tried and the refusal reported; read it by hand.

Its state (the last gazette issue read, what was already reported) lives outside the repository,
in `~/.local/state/konta-rulebook/` or `KONTA_WATCH_STATE`. With `--mail --mail-env <konta .env>`
it mails the report through the konta.md mailboxes when there is something new, or when a source
has failed three runs in a row. On the VPS behind app.konta.md it runs from cron every morning,
mailing `mail@konta.md`, logging to `/var/log/konta-rulebook-watch.log`. It never changes `data/`: after reading a new act, change the data
and add the act to `known` in the same commit.

The fiscal calendar is watched in the gazette only, as one entry (`fiscal-calendar`) with its own
patterns: transfers of rest days and the Labour Code, the Fiscal Code and fiscal policy, returns
and forms, invoices and e-Factura, wages, the social and health insurance budgets, financial
statements and statistics, and every act of SFS whatever its title (`matchUnder`, on the issue's
heading). Opinions on bills, securities issues, Constitutional Court inadmissibility decisions and
medical-service orders are excluded. Over the ten months to October 2026 it would have reported
about two acts a month.

## The fiscal calendar

`calendar/` holds the dates an accountant works to, as data, never as text on a page: the days
that are not working days, the deadlines, and the changes in the law (layout above).
`tools/validate-calendar.mjs` is the calendar's half of `npm run validate`.

konta.md/calendar, its `.ics` feeds and the RSS of changes are generated from `tools/calendar.mjs`'s
output when the site is packaged, and the product's deadline calendar and payroll proration will read
the same files. One engine computes a date; nothing copies one.

**No deadline without a citation.** Every deadline's `sourceIndex` must resolve to a source with the
act, the article, and a Monitorul Oficial reference or a link; a source says where its words were
read (`readIn`: the act as published, the authority's own publication, or only a secondary text) and
carries the short citation printed next to the date (`cite`, in Romanian, Russian and English). The
validator fails a deadline that cites nothing, cites no article, or rests on a secondary text without
being marked `"confidence": "secondary"`. A secondary deadline is kept for the record and listed on
the site as "not shown yet", never dated.

**The moved deadline is the act's rule, not ours.** `shift` says what happens to a deadline falling
on a non-working day and cites the article that says so. Non-working days are the weekend, the
Labour Code's holidays (fixed dates, and Easter and Memorial Day counted from Orthodox Easter, which
`tools/calendar.mjs` computes), and each year's transfers by Government decision. A year missing
from `years` has not had its transfers read: the site shows its holidays with a warning.

**The authority's own dates are tests.** A deadline's `checks` are dates SFS (or another authority)
published for a given period; the validator recomputes each one and fails on any difference, so a
wrong holiday, transfer or shift rule shows up before it reaches a calendar.

**A change in the law agrees with the rule sets.** A change tied to a rule value (`key`) must say
what the rule sets say on its `effectiveFrom`, and what they said the day before. A change built on
a bill is `"state": "bill"` until the act is published.

**Adding a deadline:** read the article in the act, or in the authority's own text when the act is
out of reach, add the source with its quote, the deadline with its profiles and schedule, and a
check for every date the authority has published. `npm run validate`. The daily watcher
(`npm run watch`) reports gazette acts that may change the calendar under `fiscal-calendar`; after
reading one, change the data and add the act to `known` in `sources/watch.json` in the same commit.

**Where the 2026 data was read.** On 2026-10-15, in Monitorul Oficial wherever an amending law
quotes the article (`readIn: "act"`), otherwise in the authority's own words (`"authority"`): SFS's
monthly notices and its Q&A base, relayed word for word on monitorul.fisc.md because sfs.md refuses
automated requests; CNAS's notices on cnas.gov.md; BNS's forms pages. No Government decision
transferred rest days in 2024, 2025 or 2026 (the gazette searched month by month), and since Law
69/2020 such a decision binds only public institutions.

### To read by hand on legis.md before the calendar is approved

legis.md answers automated requests with a challenge, so these were not read in their consolidated
wording. Each is cited in the data with what was read instead.

1. Codul fiscal art. 129 pct. 8) (a deadline on a rest day moves to the next working day), and
   whether "zi de odihnă" is defined; Codul civil art. 389 says the same and was read.
2. Codul fiscal art. 115 alin. (1)-(2) (TVA12), art. 92 alin. (1)-(3) (IPC21, IALS21), art. 84
   alin. (1), (4), (6) (instalments; whether the SME exemption of alin. (6) was extended to 2026),
   art. 54^4 alin. (2)-(3) (IVAO), art. 87 alin. (1) (payment by the return's date).
3. Codul fiscal art. 281^1 and 282 as consolidated after Law 214/2024 (real estate tax).
4. Codul muncii art. 111 as consolidated (the list rebuilt from eight amending laws; lit. j)
   "consiliul local"), art. 102 (shorter day before a holiday), art. 107 (weekly rest days).
5. Legea 287/2017 art. 33 alin. (3): which law brought the 150 days for entities not of public
   interest (BNS's page says so; the 2018 text says 120 days for all).
6. Legea 1593/2002 art. 20 alin. (1), art. 22, art. 23 and annex 2 (CNAM premiums), and art. 26
   alin. (1) (the employer's monthly return); Legea 489/1999 annex 1 as in force on 1 January and
   1 July 2026.
7. Ordinul MF nr. 126/2017 annex 6 pct. 5 as consolidated (who files CAS18-AN in 2026).
8. Any 2026 Government decision on rest days, again in late November and December 2026 for 2027.

## Open questions

Recorded rather than guessed at. Resolving them is Phase 0 work.

### Resolved on 2026-09-26

| Question | Answer |
| --- | --- |
| Does an employee CNAS contribution apply in 2026? | **No.** Since 1 Jan 2021 contributions are paid entirely by the employer, 24% in the private sector. The 6% in circulation applies only to specific categories on daily remuneration. |
| Is the VAT registration threshold still MDL 1.2m? | **No — it moved twice in 2026.** MDL 1.5m from 1 Jan, MDL 1.7m from 1 Mar. Modelled as `md-2026` plus the sparse amendment `md-2026.2`. |
| Is art. 118¹ invoice registration still in force? | **No, abrogated.** Do not implement the MDL 100,000 invoice register. |
| Does a paper invoice from a list-obligated supplier still cost the buyer its VAT deduction? | **No.** Art. 102(18) is abrogated from 1 Jan 2026, which *removes* that restriction. |

### Resolved on 2026-10-15

| Question | Answer |
| --- | --- |
| Is the 12% VAT rate for HoReCa services in force in 2026? | **No, 8%.** Law 212/2023 art. II pct. 22 replaced 12% by 8% for accommodation and HoReCa food (art. 96 lit. b), dashes eight and nine) from 10 August 2023, read in Monitorul Oficial nr. 297-301/2023. The Government's 2027 bill (NU-599) rewrites art. 96 with a 12% band again, for HoReCa, accommodation and some farm produce and fruit: in `md-2027` as `tax.vat.higher_reduced_rate`, provisional until the law is published. |

### Still open

| Question | Why it matters |
| --- | --- |
| Is a universal B2B e-Factura mandate coming, and when? | No Moldovan legal act found for the widely reported 1 October 2026 date. The obligation today reaches only B2G, supplies to agents without fiscal relations with the budget system, and a risk-based list of roughly 69 entities. |
| Is the VAT refund ceiling really 70% for e-Factura and MEV users? | Reported by secondary sources, absent from the Ministry of Finance summary of the 2026 changes. It is the strongest positive incentive to adopt e-Factura. |
| Final 2027 figures | `md-2027` follows bill nr. 326 of 8 September 2026 as passed in first reading (10 September). On 18 October 2026 it awaited the plenary vote in second reading; the Government's opinion on the amendments (Monitorul Oficial nr. 512-515, 16 October 2026) backs 46,680 for the major personal exemption and 11,040 for children, not yet encoded. Re-read the set against the law when it is published. |
| How does SIA e-Factura round VAT per line? | `tax.vat.line_rounding` says half away from zero; konta-efactura rounds half to even. They must agree with the platform; confirm on the first test round trip. |
| The 2027 values that come from acts not yet adopted | `md-2027` carries every key the product reads, so documents and payroll dated 2027 are no longer refused. It changes only what the bill changes (the VAT rates of art. 96, the personal exemption at 40,020); the rest is carried over from `md-2026` with a note saying why. Two are carried over only provisionally: the CNAM premium (9%, the 2027 fund law is not in Parliament yet) and the minimum wage (6,300, until the Government sets the 2027 one, usually in December). |

## Licence

Data in `data/` is [CC BY 4.0](../LICENSE) — use it, including commercially, with attribution.
Schemas and tooling are MIT. We would rather the whole Moldovan market computed tax correctly than
keep a list of published rates to ourselves.
