# Architecture Documentation

Technical architecture and system directives for Projective.

## Files

| File                                                                     | Purpose                                                                                                                                                                                                                                                                                                                        |
| :----------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md)                       | **Canonical technical source of truth** (renamed from `brain2.md`). System Directives, Islands boundary, SOLID, the `@projective/ui` taxonomy, package overviews (Fields/Data/UI/Charts/WASM), Database conventions, Security, Caching, State Hydration, Integration Blueprints, Testing, Env contract.                        |
| [`QUERY_OPERATOR_RECOMMENDATIONS.md`](QUERY_OPERATOR_RECOMMENDATIONS.md) | **Evaluation, not binding.** Whether the fifteen `/api/{projects,messaging}` read endpoints should adopt the proposed HTTP `QUERY` method. Per-endpoint audit, measured URL/body sizes, caching consequences, verified Fresh/Deno blockers, and a phased transition roadmap. Current recommendation: **do not implement yet**. |
| [`MVP_FLOW_AUDIT.md`](MVP_FLOW_AUDIT.md)                                 | **Evaluation, not binding.** End-to-end trace (Oct 2026) of auth/onboarding, the project lifecycle, and the fiat/wallet rails: a per-step status matrix, the P0 integrity defects, spec↔code contradictions to flag under §8, and the phased post-MVP roadmap. |
| [`MVP_FIX_PROMPTS.md`](MVP_FIX_PROMPTS.md)                               | **Work orders, not binding.** One self-contained Claude Code prompt per open `MVP_FLOW_AUDIT.md` item (security → money integrity → gates → lifecycle → rails → auth → archetypes → post-MVP → docs), with run order and the prompts that must stop for a human decision. |
| [`TEAMS_AUDIT.md`](TEAMS_AUDIT.md) | **Evaluation, not binding.** Teams roster and console audit (Oct 2026): functional matrix vs spec, design-system defect log, file-by-file `@projective/ui` refactor plan, and resolutions for routing, the handle namespace, ownership transfer and vault splits (Decision #226). |
| [`TEAMS_BUILD_PROMPTS.md`](TEAMS_BUILD_PROMPTS.md) | **Work orders, not binding.** One self-contained Claude Code prompt per step of the Teams rebuild (rulings → backend gates → money/read model → `packages/ui` primitives → CSS sweep → chrome → roster → console modules → storefront → docs/verification), with run order and the prompts that must stop for a human decision. |
| [`BUSINESSES_AUDIT.md`](BUSINESSES_AUDIT.md) | **Evaluation, not binding.** Businesses roster, console and buyer profile audit (Oct 2026): authority and spend-integrity gaps, business-specific design defects (shared ones live in `TEAMS_AUDIT.md`), and proposals for persona, authority, approval redemption, lifecycle and routing (Decision #229). |
| [`FINANCE_AUDIT.md`](FINANCE_AUDIT.md) | **Evaluation, not binding.** Finance engine, Stripe rails and `/wallet` audit (Oct 2026): ledger, pending window, escrow, Connect, KYC/KYB, webhook coverage, sub-ledgers (pots, smoother, recurring, schedules), vault-permission doors, multi-currency & FX, the checkout pipeline (on-account amount, promo race, charge assert), route/intent honesty, the modal model, Wallet-exception design defects, and proposed Decision #251. |
| [`FINANCE_BUILD_PROMPTS.md`](FINANCE_BUILD_PROMPTS.md) | **Work orders, not binding.** One self-contained Claude Code prompt per step of the finance hardening (rulings → DB/ledger/webhook → services/Zod → wallet islands & design gates → Playwright lifecycle + visual matrix → docs). |
| [`BUSINESSES_BUILD_PROMPTS.md`](BUSINESSES_BUILD_PROMPTS.md) | **Work orders, not binding.** One self-contained Claude Code prompt per step of the Businesses hardening (rulings → authority & spend gate → lifecycle/vault/entitlements → routing/read model → business screens → buyer profile & checkout → docs/verification); builds on the Teams UI foundation. |
| [`SUBSCRIPTIONS_AUDIT.md`](SUBSCRIPTIONS_AUDIT.md) | **Evaluation, not binding.** Subscriptions, agency scale and public pricing audit (Oct 2026): plan ledger and held-state drift, the fail-open switch inventory, agency fairness ($W_i$, claim TTL, the proposal pool, payout readiness), and the `/pricing` route, currency and design contract. Flags → Decision #252. |
| [`SUBSCRIPTIONS_BUILD_PROMPTS.md`](SUBSCRIPTIONS_BUILD_PROMPTS.md) | **Work orders, not binding.** One self-contained Claude Code prompt per step (rulings → catalogue state and guest read → annual prices and the agency tier → plan read API → Stripe Billing checkout → `/pricing` UI → entry points → Playwright), plus two roadmap prompts (nested treasury, importers) that stop for a ruling. |

## Relationship to the other pillars

- **Business logic** it serves lives in
  [`../business/PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md).
- **Component-layer** rules it delegates live in
  [`../design-system/DESIGN_SYSTEM.md`](../design-system/DESIGN_SYSTEM.md).
- **Per-domain schema** detail lives in [`../database/`](../database/README.md).
- **API / integration / route** detail lives in [`../api/`](../api/README.md).

## For future agents

`SYSTEM_ARCHITECTURE.md` is binding. Additive changes only; surface conflicts (root
[`CLAUDE.md`](../../CLAUDE.md) §8) rather than resolving them silently. The "Restructure Change Log"
at the bottom of `SYSTEM_ARCHITECTURE.md` records exactly what changed when it was renamed from
`brain2.md`.
