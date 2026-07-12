# CLAUDE.md — Documentation Guardrails

Rules for anyone editing anything under `documentation/`. This is the folder-wide contract that the
domain `CLAUDE.md` files ([`business/`](business/CLAUDE.md), [`database/`](database/CLAUDE.md),
`packages/ui/`) defer to. It sits under the root [`CLAUDE.md`](../CLAUDE.md).

## The document map

| Concern                                         | Canonical home                                                                                   |
| :---------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| Business/product logic (SSOT)                   | [`business/PRODUCT_SPEC.md`](business/PRODUCT_SPEC.md) _(was `brain.md`)_                        |
| Technical/architecture (SSOT)                   | [`architecture/SYSTEM_ARCHITECTURE.md`](architecture/SYSTEM_ARCHITECTURE.md) _(was `brain2.md`)_ |
| Design system / component layer                 | [`design-system/DESIGN_SYSTEM.md`](design-system/DESIGN_SYSTEM.md)                               |
| Product management (hierarchy + status machine) | [`PRODUCT_MANAGEMENT.md`](PRODUCT_MANAGEMENT.md)                                                 |
| Per-domain schema                               | [`database/`](database/README.md)                                                                |
| API / integrations / route tables               | [`api/`](api/README.md)                                                                          |
| Per-route UI expansion, flows                   | [`flows/`](flows/Projects.md)                                                                    |

`brain.md` and `brain2.md` are now **redirect stubs**. Never add content to them — edit the
canonical file they point to.

## Core rules

1. **All markdown lives here.** Documentation belongs under `documentation/`, not scattered across
   the repo. (Operational `CLAUDE.md` guardrail files are the only exception — they sit at the roots
   they govern and merely point back here.)
2. **Rollup, not restatement.** A satellite doc must not restate what a source-of-truth doc says —
   link to it. Duplicated content is a redundancy bug; consolidate or delete.
3. **Same-change rule.** A business-rule change lands in `PRODUCT_SPEC.md` (or the relevant
   satellite, e.g. `finance-model.md` for concrete numbers) in the **same change** as the code. A
   schema change lands in `database/*` + the Zod type together. A lifecycle change lands in
   `PRODUCT_MANAGEMENT.md`. A design-token/component change lands in `DESIGN_SYSTEM.md`.
4. **Stubs are intentional.** `_Not yet documented._` files and redirect stubs are scaffolding — do
   not delete them because they look empty.
5. **Surface conflicts.** Do not silently resolve a contradiction between docs. Log it in the root
   `CLAUDE.md` §8 "Resolved Decisions & New-Conflict Rule" and flag it. (The four founding conflicts
   — fee %, chart engine, profile route param, logo ratios — were resolved 2026-07-12; that table is
   the durable decision log for any new ones.)
6. **Living source of record.** These docs are the immutable-by-discipline system of record. Treat
   moves/renames as reversible-only-via-stub (this workspace has no git safety net) — preserve
   content verbatim on any reorganization and leave a redirect.

See the root [`CLAUDE.md`](../CLAUDE.md) for the full architectural and PR-validation guardrails.
