# konta-rulebook

Moldovan fiscal law as data: rates, thresholds, deadlines, chart of accounts, classifications and
form definitions, each stamped with the dates it applies to and a citation to the act it comes from.

**This repository is public on purpose.** [Konta](https://github.com/December-Capital/konta) is
built to replace 1C, and the fair question anyone should ask of a new accounting product is "how do
I know your tax maths is right?" The answer is: read it. Every rate here cites the act it comes
from, and if we get one wrong you can open an issue or a pull request.

> ⚠️ **Every rule set in this repository is currently `draft` and every value is marked
> `unverified`.** They were assembled from secondary sources during research on 2026-09-26 and have
> not been checked against the Fiscal Code or the Official Monitor. Nothing here may be used to
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
data/2026/md-2026.json         one set per period, plus amendments as md-2026.2 and so on
data/2027/md-2027.json
tools/validate.mjs             the gate: schema plus the cross-file rules JSON Schema can't express
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

## Adding or changing a rule

1. Never edit an approved set in place — the numbers it produced are in filings that have been
   submitted. Add a new set, or an amendment with a later `publishedOn`.
2. Cite the act, with the Monitorul Oficial reference and a link.
3. Read the act. Then set `confidence: "verified"` and the source's `verified: true`.
4. Keep `status: "draft"` until the compliance owner approves it. The validator refuses to let an
   approved set contain unverified values.
5. `npm run validate` must pass. Golden tests in the product must still pass.

## Known open questions

These are recorded rather than guessed at. Resolving them is Phase 0 work.

| Question | Why it matters |
| --- | --- |
| Does an employee CNAS contribution apply in 2026? | Secondary sources disagree; it changes every payroll calculation. |
| Is the VAT registration threshold MDL 1.2m or has the proposed 1.5m passed? | Decides who must register. |
| Is Fiscal Code art. 118¹ invoice registration still in force? | A real obligation with MDL 3,600 fines per invoice, or dead law we must not implement. |
| Final 2027 figures | The set is based on a project approved at first reading, not final adoption. |

## Licence

Data in `data/` is [CC BY 4.0](LICENSE) — use it, including commercially, with attribution.
Schemas and tooling are MIT. We would rather the whole Moldovan market computed tax correctly than
keep a list of published rates to ourselves.
