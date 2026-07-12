# Local Context: documentation/business/

`PRODUCT_SPEC.md` in this folder (formerly `PRODUCT_SPEC.md`) is the absolute source of truth for the
platform's **business logic**; its technical counterpart is
[`../architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) (formerly
`brain2.md`). Every other file here (`finance-model.md`, `features.md`, `vision.md`,
`investor-summary.md`, `market-analysis.md`) is subordinate. The old `PRODUCT_SPEC.md`/`brain2.md` paths are
now redirect stubs — do not edit them.

## Before Adding or Editing a File Here

- Check whether the content belongs in `PRODUCT_SPEC.md` (durable product/business logic) instead of a
  satellite file. If it's a rule the whole platform should follow, it belongs in `PRODUCT_SPEC.md`, not in
  a new doc that only some future agent might read.
- If you're adding a concrete number (a fee %, a split ratio, a time window) that `PRODUCT_SPEC.md`
  intentionally leaves abstract, add it to `finance-model.md` and cross-reference the relevant
  `PRODUCT_SPEC.md` section — don't invent a new standalone file for it.
- **Known unresolved conflict:** `finance-model.md` states a 5% platform service fee;
  `investor-summary.md` states 10%. Neither is confirmed against `PRODUCT_SPEC.md` (which states no
  concrete figure). Do not silently pick one when writing new content that depends on this number —
  surface the conflict instead.

- **Any business rule change must land here in the same change.** If you add, remove, or modify a
  business rule — ticket/stage lifecycle behavior, escrow triggers, payout logic, permissions,
  anything a client or freelancer would notice — update `PRODUCT_SPEC.md` (or the relevant satellite doc,
  e.g. `finance-model.md` for concrete numbers) before considering the work done. A business rule
  that exists only in code, a chat message, or a commit description is not documented. This applies
  whether the rule change was requested directly or discovered as a side effect of other work.

See [../CLAUDE.md](../CLAUDE.md) for the full documentation-wide guardrails.
