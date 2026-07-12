# Projective Documentation

Projective is a collaborative freelancing marketplace where businesses hire individuals, teams, or
entire "micro-agencies" to deliver structured, stage-based projects with escrow-backed payments.

## Source-of-Truth Hierarchy — Read This First

1. **[business/PRODUCT_SPEC.md](business/PRODUCT_SPEC.md)** (formerly `brain.md`) is the absolute,
   overriding authority for **business logic** — features, workflows, escrow, hiring, stage/ticket/
   session lifecycles, sitemap, and visual identity.
2. **[architecture/SYSTEM_ARCHITECTURE.md](architecture/SYSTEM_ARCHITECTURE.md)** (formerly
   `brain2.md`) is the absolute authority for **technical/architectural rules**.
3. **[design-system/DESIGN_SYSTEM.md](design-system/DESIGN_SYSTEM.md)** is the authority for the
   `@projective/ui` component layer, design tokens, the Material You theming engine, and the
   navigation shell.
4. **[PRODUCT_MANAGEMENT.md](PRODUCT_MANAGEMENT.md)** defines the work hierarchy (Epic → Feature →
   Story → Task) and the unified status state-machine used to track delivery.

If a lower doc conflicts with #1 on a business rule, #1 wins; with #2 on a technical rule, #2 wins.
Everything else either fills a gap the top docs leave abstract, or covers material they don't
(investor narrative, market data, per-route API tables). Nothing should _restate_ them — link
instead. See [CLAUDE.md](CLAUDE.md) for the full documentation guardrails.

> **Note on the rename (July 2026):** `brain.md` → `business/PRODUCT_SPEC.md` and `brain2.md` →
> `architecture/SYSTEM_ARCHITECTURE.md`. Redirect stubs remain at the old paths so existing links
> keep resolving; do not add content to the stubs.

## Directory Structure

### [business/](business/README.md)

Business logic authority (`PRODUCT_SPEC.md`), plus supplementary docs: the financial model
(`finance-model.md`), phased feature rollout (`features.md`), positioning/philosophy (`vision.md`),
and investor/market material (`investor-summary.md`, `market-analysis.md`).

### [architecture/](architecture/README.md)

Technical source of truth (`SYSTEM_ARCHITECTURE.md`) — system directives, Islands boundary, package
taxonomy, database conventions, security, caching, integrations, testing, env contract.

### [design-system/](design-system/DESIGN_SYSTEM.md)

Master design specification for `@projective/ui`: the token contract, the Material You theming
engine, the seven component taxonomies, the separation hierarchy, fluid motion primitives,
accessibility themes, and the desktop/mobile navigation shell.

### [database/](database/README.md)

Per-domain schema documentation (Tables/Policies/Functions) for 11 domains, plus the top-level
[Schemas.md](database/Schemas.md) ERD/enum reference. Many domain files are still scaffolded stubs —
see the database README's coverage table.

### [api/](api/README.md)

Per-route API tables, endpoint contracts, integration blueprints, and the environment contract —
expanding the flat sitemap from `PRODUCT_SPEC.md`. Scaffolded; populated as handlers land.

### [flows/](flows/Projects.md)

Implementation-level workflow detail (state diagrams, stage archetypes) complementing
`PRODUCT_SPEC.md`'s business-level "Projects & Services" description.

### [PRODUCT_MANAGEMENT.md](PRODUCT_MANAGEMENT.md)

The delivery-tracking system of record: work hierarchy, the unified status state-machine (Draft →
Backlog → Ready → Claimed → In Progress → Review/Escrow-Locked → Complete, plus Disputed), and the
governance rules that keep it living. Uses the platform's own lifecycle vocabulary.

## Technical Overview

- **Frontend:** Deno Fresh 2.x with Preact Islands (partial hydration) — see
  `SYSTEM_ARCHITECTURE.md` §2 for the Islands boundary rules.
- **Database & Auth:** Supabase (PostgreSQL) with mandatory Row-Level Security.
- **Compute:** Rust WASM modules for image/file processing and search performance.
- **UI:** `@projective/ui` umbrella package — Pure CSS + BEM, token-driven, copy-paste portable. See
  `design-system/DESIGN_SYSTEM.md`.

Full stack rationale lives in `PRODUCT_SPEC.md`'s "Tech Stack" section; system directives for agents
touching this stack live in `SYSTEM_ARCHITECTURE.md`'s "System Directives" section. Repo-wide
guardrails: root [CLAUDE.md](../CLAUDE.md).
