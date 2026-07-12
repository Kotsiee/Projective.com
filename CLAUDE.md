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
3. **[`documentation/design-system/DESIGN_SYSTEM.md`](documentation/design-system/DESIGN_SYSTEM.md)**
   — authority for the `@projective/ui` component layer, tokens, theming engine, and nav shell.
4. **[`documentation/PRODUCT_MANAGEMENT.md`](documentation/PRODUCT_MANAGEMENT.md)** — the work
   hierarchy and the unified status state-machine used to track delivery.

If anything conflicts: `PRODUCT_SPEC.md` wins on business rules; `SYSTEM_ARCHITECTURE.md` wins on
technical rules. The former `brain.md`/`brain2.md` paths now hold **redirect stubs** — do not write
to them.

> **All markdown documentation lives under `documentation/`.** Do not create docs elsewhere. The
> exceptions are the operational `CLAUDE.md` guardrail files, which live at the roots they govern
> (here, and `packages/ui/CLAUDE.md`) and only _point to_ the specs in `documentation/`.

---

## 1. Database & Schema Mutability — The Additive Rule

Add columns, indexes, tables, constraints freely. **Never** delete tables, drop columns, or alter
existing foreign-key relationships (especially around **Escrows, Wallets, Stages**) without explicit
human permission — in the real Supabase migrations, not just the docs. **Zod SSOT:** a migration
must land with its matching `@projective/types` Zod schema/interface **and** the matching
`documentation/database/[domain]/*` update **in the same change**. The DB, the types package, and
the docs must never drift.

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
  2. **Accessibility** — honor reduced-motion (jump-to-final) and the open-dyslexic /
     color-blindness / high-contrast token overlays; ship comprehensive ARIA.
  3. **Responsive** at Desktop/Tablet/Mobile with fluid rules, no app-side overrides.
  4. **Motion** — spring constants are critically/over-damped (no bounce); theme color changes
     transition **simultaneously** across the whole tree.
  5. A new/changed component updates the `DESIGN_SYSTEM.md` §C.1 roster **in the same change**.

## 4. Routing & Folder Conventions (Fresh 2.x)

- **Route groups:** public pages under `routes/(public)/`, authed app under `routes/(dashboard)/`.
- **Profiles:** individual users, teams, and corporations resolve under the wildcard handle
  namespace `routes/[handle]/` — **canonical** (resolved 2026-07-12; `PRODUCT_SPEC.md`'s sitemap was
  updated from `/[profile]` to `/[handle]` to match the pervasive `@handle` entity identifier).
- **Feature folders:** page controllers live in `apps/web/features/[group]/[sub]/` (routes stay thin
  and re-export); islands are discovered via the Vite `islandSpecifiers` config.
- **Unified internal structure:** every feature, package, and sub-package organizes files into the
  same seven folders — `components/`, `islands/`, `styles/`, `hooks/`, `wrappers/`, `types/`,
  `core/` — populated as needed (no empty-dir mandate). **No `src/` wrapper.** Package-wide shared
  helpers/types live at the package-level `core/`/`types/`; sub-packages mirror the shape and import
  those. Features may add `routes/` + `services/`. Reference: `packages/ui/`. Full detail in
  `PRODUCT_SPEC.md` §Directory & Project Structure.

## 5. Product-Management discipline

Any change to a lifecycle/state/transition/cap/evidence rule updates
`documentation/PRODUCT_MANAGEMENT.md` **in the same change**. Board columns map 1:1 to its status
state-machine; no bespoke statuses. Nothing is hard-deleted (use `Archived`).

## 6. Security & Environment

- **RLS is always on.** Assume it; write Service queries in the user's JWT context. Only the
  service-role key (in Edge Functions) bypasses RLS.
- **Zero-trust placeholders.** In `.env.example`/docs/placeholders use `XXXX-XXXX`. Never insert
  real keys. Env keys per `SYSTEM_ARCHITECTURE.md` "Environment Variable Contract".

## 7. Code Quality & Output

- **JSDoc** on all exported interfaces/classes/services/complex functions.
- **`// #region [Name]` / `// #endregion`** to group logical sections.
- **No meta-comments** (`// fixed bug`, `// added per request`) — reasoning goes in the PR, not the
  source.

## 8. Resolved Decisions & New-Conflict Rule

The four founding conflicts were **resolved on 2026-07-12** (below). For any **new** contradiction
you find between source docs: do not pick a side quietly — flag it in the PR, add a row here, and
ask a human. This table is the durable decision log.

| #  | Decision (2026-07-12)                                                                                                                                                                              | Applied in                                                                                     |
| :- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| 1  | **Chart engine — tiered.** D3.js (scales/geometry + low-density SVG) → Canvas2D (mid-density) → PIXI/WebGL (high-density stage, fed by Rust/WASM). Renderer auto-selected on a performance metric. | `PRODUCT_SPEC.md` §Libraries · `SYSTEM_ARCHITECTURE.md` §Charts · `DESIGN_SYSTEM.md` §B.5/§C.5 |
| 2  | **Platform fee — 5%** flat, **plus Stripe processing fees passed through** (separate from the 5%). `finance-model.md` is canonical; `investor-summary.md` corrected from 10%.                      | `finance-model.md` §1.1/top-note · `investor-summary.md` §4                                    |
| 3  | **Profile route param — `[handle]`** (matches the `@handle` entity identifier). `PRODUCT_SPEC.md` sitemap updated `/[profile]` → `/[handle]`.                                                      | `PRODUCT_SPEC.md` §Sitemap · §4 above · `api/README.md`                                        |
| 4  | **Brand mark ratios — 1:1 (icon) + 7:2 (wordmark)**, per `PRODUCT_SPEC.md` §Visual Identity (SSOT). The brief's 3:1 is superseded.                                                                 | `DESIGN_SYSTEM.md` §C.4                                                                        |

_Second-order conflicts noted but out of this pass (surface if you touch them): `finance-model.md`
§4 session late-cancel says a 50% penalty while `PRODUCT_SPEC.md`'s Session table says full forfeit
— `PRODUCT_SPEC.md` wins per the hierarchy._

## 9. PR Validation Checklist

- [ ] No source-of-truth doc contradicted (or the doc was updated in the same PR).
- [ ] Additive-only DB change; Zod + `documentation/database/*` updated together.
- [ ] Islands dumb; routes thin; services fat; aliases only.
- [ ] Pure CSS + BEM, token-only; Material lib only in `packages/ui/system/`.
- [ ] Separation-hierarchy, a11y overlays, reduced-motion, ARIA, responsive all satisfied.
- [ ] Lifecycle change reflected in `PRODUCT_MANAGEMENT.md`.
- [ ] `XXXX-XXXX` placeholders; RLS-aware queries.
- [ ] JSDoc + regions present; no meta-comments.
- [ ] Consistent with the §8 Resolved Decisions; any **new** cross-doc conflict is flagged + logged,
      not silently resolved.
- [ ] No page/business logic added before the foundational doc + package layer is in place.
