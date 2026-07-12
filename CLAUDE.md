# CLAUDE.md — Projective Root Guardrails

You are working in **Projective**, a Deno 2.x workspace monorepo for a stage-based, escrow-backed
collaborative freelancing platform. This file is the **top-level contract**. Every rule below is a
**pull-request validation parameter**: a change that violates one is not mergeable. Sub-directory
`CLAUDE.md` files add local rules; none may relax what is here.

---

## 0. Source-of-Truth Hierarchy (read first)

1. **[`documentation/business/PRODUCT_SPEC.md`](documentation/business/PRODUCT_SPEC.md)** (formerly
   `brain.md`) — absolute authority for **business logic**: features, workflows, escrow, hiring,
   stage/ticket/session lifecycles, sitemap, visual identity.
2. **[`documentation/architecture/SYSTEM_ARCHITECTURE.md`](documentation/architecture/SYSTEM_ARCHITECTURE.md)**
   (formerly `brain2.md`) — absolute authority for **technical/architectural rules**.
3. **[`documentation/design-system/DESIGN_SYSTEM.md`](documentation/design-system/DESIGN_SYSTEM.md)** —
   authority for the `@projective/ui` component layer, tokens, theming engine, and nav shell.
4. **[`documentation/PRODUCT_MANAGEMENT.md`](documentation/PRODUCT_MANAGEMENT.md)** — the work
   hierarchy and the unified status state-machine used to track delivery.

If anything conflicts: `PRODUCT_SPEC.md` wins on business rules; `SYSTEM_ARCHITECTURE.md` wins on
technical rules. The former `brain.md`/`brain2.md` paths now hold **redirect stubs** — do not write
to them.

> **All markdown documentation lives under `documentation/`.** Do not create docs elsewhere. The
> exceptions are the operational `CLAUDE.md` guardrail files, which live at the roots they govern
> (here, and `packages/ui/CLAUDE.md`) and only *point to* the specs in `documentation/`.

---

## 1. Database & Schema Mutability — The Additive Rule

Add columns, indexes, tables, constraints freely. **Never** delete tables, drop columns, or alter
existing foreign-key relationships (especially around **Escrows, Wallets, Stages**) without explicit
human permission — in the real Supabase migrations, not just the docs. **Zod SSOT:** a migration
must land with its matching `@projective/types` Zod schema/interface **and** the matching
`documentation/database/[domain]/*` update **in the same change**. The DB, the types package, and the
docs must never drift.

## 2. Architecture & the Islands Boundary

- **Islands are dumb.** No Supabase/DB access in `islands/` — `fetch` internal API routes only.
- **Thin routes, fat services.** Routes do HTTP parsing + Zod validation + auth guarding; all logic
  and financial math lives in Services.
- **Path aliases only.** `@projective/ui` (+ sub-paths via its `exports`), `@ui/*`, `@features/*`,
  `@server/services/*`. No relative traversal (`../../../`) across workspace boundaries. Add a
  workspace member to root `deno.json` **only once its directory exists**.

## 3. UI, Styling & the Component Layer

- **Pure CSS + strict BEM. Token-only.** No Tailwind, no CSS-in-JS, no inline styles, no UI-library
  dependencies. Components read `var(--*)`; never hardcode a hex, radius, duration, or shadow.
- **Material You exception (scoped).** `@material/material-color-utilities` may be imported **only**
  inside `packages/ui/system/`. Never in a component. (See `SYSTEM_ARCHITECTURE.md` §3.)
- **Signal-first.** `@preact/signals` for local state; avoid `useState`/`useEffect` except for
  external non-reactive DOM libs.
- **Design-system merge gates** (full detail in `DESIGN_SYSTEM.md` Part E):
  1. **Separation hierarchy** — do NOT box non-interactive content in four-sided borders; use
     spacing → tonal surface tints → type weight → single hairline. Full borders = interactive
     elements only.
  2. **Accessibility** — honor reduced-motion (jump-to-final) and the open-dyslexic / color-blindness
     / high-contrast token overlays; ship comprehensive ARIA.
  3. **Responsive** at Desktop/Tablet/Mobile with fluid rules, no app-side overrides.
  4. **Motion** — spring constants are critically/over-damped (no bounce); theme color changes
     transition **simultaneously** across the whole tree.
  5. A new/changed component updates the `DESIGN_SYSTEM.md` §C.1 roster **in the same change**.

## 4. Routing & Folder Conventions (Fresh 2.x)

- **Route groups:** public pages under `routes/(public)/`, authed app under `routes/(dashboard)/`.
- **Profiles:** individual users, teams, and corporations resolve under the wildcard handle
  namespace `routes/[handle]/`. **⚠ Conflict to resolve (§8):** `PRODUCT_SPEC.md`'s sitemap uses
  `/[profile]`. Do not silently pick — see Open Conflicts.
- **Feature folders:** page controllers live in `apps/web/features/[group]/[sub]/` (routes stay
  thin and re-export); islands are discovered via the Vite `islandSpecifiers` config.

## 5. Product-Management discipline

Any change to a lifecycle/state/transition/cap/evidence rule updates
`documentation/PRODUCT_MANAGEMENT.md` **in the same change**. Board columns map 1:1 to its status
state-machine; no bespoke statuses. Nothing is hard-deleted (use `Archived`).

## 6. Security & Environment

- **RLS is always on.** Assume it; write Service queries in the user's JWT context. Only the
  service-role key (in Edge Functions) bypasses RLS.
- **Zero-trust placeholders.** In `.env.example`/docs/placeholders use `XXXX-XXXX`. Never insert real
  keys. Env keys per `SYSTEM_ARCHITECTURE.md` "Environment Variable Contract".

## 7. Code Quality & Output

- **JSDoc** on all exported interfaces/classes/services/complex functions.
- **`// #region [Name]` / `// #endregion`** to group logical sections.
- **No meta-comments** (`// fixed bug`, `// added per request`) — reasoning goes in the PR, not the
  source.

## 8. Open Conflicts — surface, do NOT silently resolve

These are known, unresolved contradictions in the source docs. When your work depends on one, **flag
it in the PR and ask a human**; never pick one side quietly.

| # | Conflict | Sources |
| :- | :------- | :------ |
| 1 | **Chart engine:** D3.js (Canvas-over-SVG) vs PIXI.js | `PRODUCT_SPEC.md` §Libraries vs `SYSTEM_ARCHITECTURE.md` §Charts |
| 2 | **Platform fee %:** 5% vs 10% | `documentation/business/finance-model.md` vs `investor-summary.md` (neither confirmed in `PRODUCT_SPEC.md`) |
| 3 | **Profile route param:** `[handle]` vs `[profile]` | this file §4 / brief vs `PRODUCT_SPEC.md` sitemap |
| 4 | **Logo/branding aspect ratios:** 7:2 wordmark (spec) vs 3:1 branding-mark rule (design system) | `PRODUCT_SPEC.md` §Visual Identity vs `DESIGN_SYSTEM.md` §C.4 |

## 9. PR Validation Checklist

- [ ] No source-of-truth doc contradicted (or the doc was updated in the same PR).
- [ ] Additive-only DB change; Zod + `documentation/database/*` updated together.
- [ ] Islands dumb; routes thin; services fat; aliases only.
- [ ] Pure CSS + BEM, token-only; Material lib only in `packages/ui/system/`.
- [ ] Separation-hierarchy, a11y overlays, reduced-motion, ARIA, responsive all satisfied.
- [ ] Lifecycle change reflected in `PRODUCT_MANAGEMENT.md`.
- [ ] `XXXX-XXXX` placeholders; RLS-aware queries.
- [ ] JSDoc + regions present; no meta-comments.
- [ ] Any dependence on an §8 conflict is flagged, not silently resolved.
- [ ] No page/business logic added before the foundational doc + package layer is in place.
