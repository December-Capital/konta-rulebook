# Golden-test fixtures

Anonymised datasets used to prove that generated filings match returns a real accountant actually
submitted. Phase 1 onwards.

Each fixture is one company, one period:

```
fixtures/<anon-id>/
  entity.json         regime, size category, VAT status, effective dates
  documents.json      sales, purchases, bank, cash, payroll inputs
  expected/TVA12.json the return as actually filed
  expected/IPC21.json
  provenance.md       who supplied it, what was stripped, consent reference
```

## Rules

1. **Anonymise before committing.** No real IDNO, company name, employee name, IBAN or address.
   Substitute consistently so relationships survive. This repository is public.
2. **Written consent from the supplying firm**, referenced in `provenance.md`.
3. **The expected output is what was filed**, not what we think should have been filed. When we
   disagree with a filed return, that goes in `provenance.md` — it does not change `expected/`.
4. Amounts stay exactly as filed, to the lei. Rounding differences are the whole point of the test.
