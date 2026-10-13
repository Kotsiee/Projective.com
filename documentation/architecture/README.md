# Architecture Documentation

Technical architecture and system directives for Projective.

## Files

| File                                                                     | Purpose                                                                                                                                                                                                                                                                                                                        |
| :----------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md)                       | **Canonical technical source of truth** (renamed from `brain2.md`). System Directives, Islands boundary, SOLID, the `@projective/ui` taxonomy, package overviews (Fields/Data/UI/Charts/WASM), Database conventions, Security, Caching, State Hydration, Integration Blueprints, Testing, Env contract.                        |
| [`QUERY_OPERATOR_RECOMMENDATIONS.md`](QUERY_OPERATOR_RECOMMENDATIONS.md) | **Evaluation, not binding.** Whether the fifteen `/api/{projects,messaging}` read endpoints should adopt the proposed HTTP `QUERY` method. Per-endpoint audit, measured URL/body sizes, caching consequences, verified Fresh/Deno blockers, and a phased transition roadmap. Current recommendation: **do not implement yet**. |
| [`MVP_FLOW_AUDIT.md`](MVP_FLOW_AUDIT.md)                                 | **Evaluation, not binding.** End-to-end trace (Oct 2026) of auth/onboarding, the project lifecycle, and the fiat/wallet rails: a per-step status matrix, the P0 integrity defects, spec↔code contradictions to flag under §8, and the phased post-MVP roadmap. |

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
