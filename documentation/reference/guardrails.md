> Full text of the root guardrails (§0 source-of-truth hierarchy through §7 code quality) — the merge-blocking rules summarised in /CLAUDE.md.

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

## 1. Database & Schema — Consolidated, Edit-In-Place Migrations

`supabase/migrations/` is a **consolidated, from-scratch, reset-driven schema**, NOT a chronological
additive log. The local database is rebuilt with `supabase db reset` (there is no production data to
preserve yet), so schema changes are made by **editing the existing consolidated files in place** —
never by appending new timestamped migrations that patch earlier ones.

- **Fold, don't patch.** A new column goes **directly into the object's `CREATE TABLE`**; a new enum
  value into its `CREATE TYPE ... AS ENUM`; a changed default/constraint is edited on the column
  itself. **Do NOT** add `ALTER TABLE ... ADD COLUMN`, `ALTER TYPE ... ADD VALUE`, `DROP CONSTRAINT`
  - re-`ADD`, or any "migration on top of a migration." The only permitted `ALTER TABLE` is an
    `ADD CONSTRAINT ... FOREIGN KEY` placed in a trailing `00000###_tables_fk_*.sql` file **when and
    only when** a genuine circular dependency makes an inline FK impossible.
- **Naming convention (strict):** every file is `vvvvtooo_type_purpose.sql` — an 8-digit numeric
  prefix `vvvv`(=`0000`) + `t`(1-digit category) + `ooo`(3-digit order within category) + a verbose
  `type` matching `t` + a snake_case `purpose`. Categories run in order and MUST stay layered:

  | `t` | Category             | `type` names                                  | Holds                                                                                |
  | :-- | :------------------- | :-------------------------------------------- | :----------------------------------------------------------------------------------- |
  | 0   | Core setup           | `schemas` · `extensions` · `enums` · `tables` | `CREATE SCHEMA/EXTENSION/TYPE`, `CREATE TABLE` (all columns/constraints inline)      |
  | 1   | Functions & triggers | `functions` · `rpcs` · `triggers`             | `CREATE FUNCTION`/`RPC`s first, then all `CREATE TRIGGER`                            |
  | 2   | Security             | `policies` · `permissions`                    | `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, `GRANT`/`REVOKE`, realtime publication |
  | 3   | Views                | `views`                                       | `CREATE [MATERIALIZED] VIEW`                                                         |
  | 4   | Indexes              | `indexes`                                     | standalone `CREATE INDEX`                                                            |
  | 5   | Seed                 | `seed`                                        | top-level reference-data `INSERT`s (never backfills or in-function inserts)          |

- **Place each statement in its category, not next to related code.** A new table's columns go in
  the cat-0 table file; its policies in cat-2; its indexes in cat-4; its seed rows in cat-5 — each
  edited into the existing domain file for that category. Keep cat-0 table files dependency-ordered
  (no forward-referencing FK across files). Triggers always live in a cat-1 `triggers` file (after
  every `functions` file), because a trigger needs its function to exist first.
- **Escrows, Wallets, Stages** remain protected: do not remove their columns or alter their existing
  FK relationships without explicit human permission — the reset convenience is for
  **additive/edit** schema evolution, not for silently dropping financial structure.
- **Zod SSOT:** a schema change must land with its matching `@projective/types` Zod schema/interface
  **and** the matching `documentation/database/[domain]/*` update **in the same change**. The DB,
  the types package, and the docs must never drift.

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
  6. **Anti-card** (§B.4.2, §B.9.7–B.9.8) — static content (prose, stage breakdowns, scope lists,
     spec ledgers) is never boxed; cards never nest, and never sit inside an elevated panel; a list
     of cards gets no container card; a region background is never a translucent colour (a tonal
     step is a **solid** ramp tone: `--bg` → `--surface-1` → `--surface-2`).
  7. **Anti-tagification** (§B.11) — containment asserts interactivity. Non-actionable metadata
     (category, skills, delivery model, turnaround, formats, licence, timestamps) is inline
     `--text-secondary` text separated by middots — never a pill/chip/tag/badge. Containers are
     reserved for **controls · lifecycle statuses · required disclosures · counts**. Two adjacent
     non-interactive fills on one row is a finding.
  8. **Hierarchy over weight** (§A.4) — four registers (display · section header · body · meta),
     each moving size, case and tracking together. A heading is never `--fw-bold` (700) or heavier;
     two adjacent levels may not differ by weight alone; a changing figure is `tabular-nums`.
  9. **Functional transparency only** (§B.4.3) — `--glass-blur`/`backdrop-filter` is permitted only
     on viewport-pinned top bars, floating mobile sheets/scrims, and marks on arbitrary photography,
     and always on a `::before` underlay.
  10. **The conversion-lane contract** (§D.7/§D.8) — on a public entity-view route the middle-nav
      lane **is** the transaction: identity · price · an INVERTED monochrome primary · a brand
      secondary · exactly one ghost tertiary (seller contact, the single sanctioned exception to
      "secondary actions in the kebab") · summary ledger. **No third sticky column, and no price or
      purchase control in the main stage on desktop**; none in the sticky header band either. The
      canvas is content-first — structured information leads, media trails, reversed in the DOM and
      never with `order`/`direction`. Below `--bp-md` the duty transfers to one body-side block —
      moved, never duplicated. The lane is resolved by a pure URL slot resolver, never an island.
  11. **A control that renders must do something** (§D.7.7/§D.8.3). A styled, focusable, hoverable
      affordance whose handler reaches nothing is a defect of the same class as a broken link, and it
      is invisible to a type-checker and to a source-reading review. Two shipped this way and were
      caught by adversarial review, not by inspection: stage quick-jumps writing a signal no mounted
      component observed, and a one-way view switcher whose only "off" control had been deleted. When
      a control drives a SERVER-rendered target, the handler must act on the DOM — a signal reaches
      islands only.
  12. **Press feedback & the contrast invariant** (§B.12). A pressable control acknowledges a press
      with `transform: scale()` and nothing else — an interaction may move `transform`,
      `box-shadow`, `background` and `color`, and may never move `padding`, `margin`, `inset`,
      `border-width`, `block-size` or `line-height`. Press feedback is removed by **both**
      reduced-motion channels (`@media (prefers-reduced-motion: reduce)` **and**
      `[data-motion="reduced"]`), and by `transform: none` rather than a zero duration — the token
      layer already zeroes `--dur-*`, which kills the animation and leaves the compression. Every
      filled `--<role>` / `--on-<role>` pair must measure **≥ 4.5:1** in all four mode/contrast
      states, a **mode-adaptive** pair must reach **≥ 7:1** in dark, and no pair may narrow under
      `data-contrast="high"`. **`--primary`/`--on-primary` are mode-invariant** — the same colour in
      every state (§A.1.1) — so they are held to AA rather than AAA, and any re-mapping of them
      inside a mode branch is a defect. A hover or active state must never lower a filled control's
      label contrast nor drop its fill under 3:1 against a surface it can sit on, which is why the
      tonal blend runs toward `--on-surface` rather than the ink, and why the brand — which has
      headroom in neither direction — takes a zero step and spends the border channel instead. The
      colour half is machine-checked in `packages/ui/system/core/theme-engine.test.ts`, because it is
      the one gate here whose failure is invisible to a source-reading review.

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

**Dev Context Switcher parity (merge gate).** The developer-only Dev Context Switcher
(`apps/web/features/devtools/` — `components/DevContextPanel.tsx` + `core/dev-context.ts`, driving
the `data-dev-*` attributes + `pj:devcontext` `CustomEvent` seam that shipping surfaces read via
`apps/web/utils/dev-seam.ts`) must stay a **complete, exercisable mirror** of every simulatable
chrome axis. Whenever a change adds or alters an axis a surface branches on from the dev seam — a
persona / account type, an entity role, a capability gate, a service/session archetype, a project or
submission lifecycle state, a membership/access condition, a messaging/inbox view, or any new
`data-dev-*`-observed flag — you MUST, **in the same change**, add its matching control to the
switcher: the `DevOverrides` field + its `DEV_DEFAULTS` entry, the `DevOption` list, the
`DevContextPanel` control (a `<Field>` + `<Segment>` / toggle), and the `reflect()` `data-dev-*`
write (set **and** delete branches). A new gate that cannot be toggled from the switcher is **not
mergeable**. This keeps every persona/role/state reachable at runtime without re-authenticating, per
the four-profile shell matrix (§8 Decisions #14/#16) and the session-service surfaces (§8 Decision
#48).

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
