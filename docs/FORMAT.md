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

And each class carries chapter I's rules: whether its synthetic accounts are mandatory (classes
1-7), what an entity may add to its own working chart (subaccounts in 1-7; accounts and subaccounts
in 8-9), and whether it is double-entry (all but class 9).

A later amendment is a new file with a later `effectiveFrom`, never an edit to an approved one.

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

## Open questions

Recorded rather than guessed at. Resolving them is Phase 0 work.

### Resolved on 2026-09-26

| Question | Answer |
| --- | --- |
| Does an employee CNAS contribution apply in 2026? | **No.** Since 1 Jan 2021 contributions are paid entirely by the employer, 24% in the private sector. The 6% in circulation applies only to specific categories on daily remuneration. |
| Is the VAT registration threshold still MDL 1.2m? | **No — it moved twice in 2026.** MDL 1.5m from 1 Jan, MDL 1.7m from 1 Mar. Modelled as `md-2026` plus the sparse amendment `md-2026.2`. |
| Is art. 118¹ invoice registration still in force? | **No, abrogated.** Do not implement the MDL 100,000 invoice register. |
| Does a paper invoice from a list-obligated supplier still cost the buyer its VAT deduction? | **No.** Art. 102(18) is abrogated from 1 Jan 2026, which *removes* that restriction. |

### Still open

| Question | Why it matters |
| --- | --- |
| Is a universal B2B e-Factura mandate coming, and when? | No Moldovan legal act found for the widely reported 1 October 2026 date. The obligation today reaches only B2G, supplies to agents without fiscal relations with the budget system, and a risk-based list of roughly 69 entities. |
| Is the VAT refund ceiling really 70% for e-Factura and MEV users? | Reported by secondary sources, absent from the Ministry of Finance summary of the 2026 changes. It is the strongest positive incentive to adopt e-Factura. |
| Final 2027 figures | The set is based on a project approved at first reading, not final adoption. |

## Licence

Data in `data/` is [CC BY 4.0](../LICENSE) — use it, including commercially, with attribution.
Schemas and tooling are MIT. We would rather the whole Moldovan market computed tax correctly than
keep a list of published rates to ourselves.
