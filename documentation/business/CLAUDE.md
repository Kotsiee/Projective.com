# Local Context: documentation/business/

`PRODUCT_SPEC.md` in this folder (formerly `brain.md`) is the absolute source of truth for
the platform's **business logic**; its technical counterpart is
[`../architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) (formerly
`brain2.md`). Every other file here (`finance-model.md`, `features.md`, `vision.md`,
`investor-summary.md`, `market-analysis.md`) is subordinate. The old `brain.md`/`brain2.md`
paths are now redirect stubs — do not edit them.

## Before Adding or Editing a File Here

- Check whether the content belongs in `PRODUCT_SPEC.md` (durable product/business logic) instead of
  a satellite file. If it's a rule the whole platform should follow, it belongs in
  `PRODUCT_SPEC.md`, not in a new doc that only some future agent might read.
- If you're adding a concrete number (a fee %, a split ratio, a time window) that `PRODUCT_SPEC.md`
  intentionally leaves abstract, add it to `finance-model.md` and cross-reference the relevant
  `PRODUCT_SPEC.md` section — don't invent a new standalone file for it.
- **Platform fee (resolved 2026-07-12):** **5%** flat, plus Stripe processing fees passed through.
  `finance-model.md` is canonical; `investor-summary.md` was corrected from its former 10%. Use 5%
  in any new content; see root `CLAUDE.md` §8 "Resolved Decisions".

- **Any business rule change must land here in the same change.** If you add, remove, or modify a
  business rule — ticket/stage lifecycle behavior, escrow triggers, payout logic, permissions,
  anything a client or freelancer would notice — update `PRODUCT_SPEC.md` (or the relevant satellite
  doc, e.g. `finance-model.md` for concrete numbers) before considering the work done. A business
  rule that exists only in code, a chat message, or a commit description is not documented. This
  applies whether the rule change was requested directly or discovered as a side effect of other
  work.

See [../CLAUDE.md](../CLAUDE.md) for the full documentation-wide guardrails.
