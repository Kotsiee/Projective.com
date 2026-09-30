# CLAUDE.md — Projective Root Guardrails

**Projective** is a stage-based, escrow-backed collaborative freelancing platform (projects → stages
→ tickets, wallets/escrow, messaging, profiles, explore/marketplace, calendar). Deno 2.x workspace
monorepo: `apps/web` (Fresh 2.x + Vite + Preact + `@preact/signals`), `packages/ui` (pure-CSS BEM
design system, `@projective/ui`), `packages/types` (Zod SSOT, `@projective/types`), `packages/backend`
(fat services, `@server/services/*`), Supabase Postgres (RLS everywhere) under `supabase/`, Stripe
for fiat rails. Every rule below is a merge gate; the full text lives in
`documentation/reference/guardrails.md`. Sub-directory `CLAUDE.md` files add rules, never relax them.

## Key Commands

| Task | Command |
| :-- | :-- |
| Dev (live DB per `*_BACKEND_LIVE`) / fixtures | `deno task dev` / `deno task dev:mock` |
| Build / production serve | `deno task build` / `deno task start` (build + `deno task serve`) |
| Type-check (incl. all route files) | `deno task check` |
| Lint / format check | `deno task lint` / `deno task fmt:check` (never `deno fmt` the whole tree) |
| Unit tests / full gate | `deno task test:unit` / `deno task test` (check + lint + unit) |
| Rebuild local DB + seeds + assets | `deno task db:reset` |
| Regenerate committed seed SQL | `deno task db:seed:generate` |

Secrets go in `.env.local` (server loads only `.env.local` then `.env`). Four
`theme-engine.test.ts` failures are pre-existing (Decision #96(a)).

## Core Conventions

### §0 Source-of-truth hierarchy
1. `documentation/business/PRODUCT_SPEC.md` — business logic (wins on business rules).
2. `documentation/architecture/SYSTEM_ARCHITECTURE.md` — technical rules (wins on technical rules).
3. `documentation/design-system/DESIGN_SYSTEM.md` — `@projective/ui`, tokens, theming, nav shell.
4. `documentation/PRODUCT_MANAGEMENT.md` — work hierarchy + status state-machine.

All markdown docs live under `documentation/` (only `CLAUDE.md` guardrail files live at the roots
they govern). `brain.md`/`brain2.md` are redirect stubs — never write to them.

### §1 Database — consolidated, edit-in-place migrations
- `supabase/migrations/` is rebuilt with `supabase db reset`: **edit existing files in place**; never
  append `ALTER TABLE ADD COLUMN` / `ALTER TYPE ADD VALUE` patches. Only exception: `ADD CONSTRAINT …
  FOREIGN KEY` in a trailing `00000###_tables_fk_*.sql` for a true circular dependency.
- Naming `vvvvtooo_type_purpose.sql`; categories in order: 0 schemas/extensions/enums/tables ·
  1 functions/rpcs/triggers · 2 policies/permissions · 3 views · 4 indexes · 5 seed. Put each
  statement in its category file, not next to related code.
- Never drop columns/FKs of **escrows, wallets, stages** without explicit human permission.
- A schema change lands with its `@projective/types` Zod schema **and** `documentation/database/*` in
  the same change.

### §2 Architecture
- **Islands are dumb**: no Supabase/DB access in islands — `fetch` internal `/api/*` routes only.
- **Thin routes, fat services**: routes = HTTP parse + Zod + auth guard; logic/money math in
  `@server/services/*`, returning `ServiceResult<T>` (Decision #10).
- Path aliases only (`@projective/ui`, `@ui/*`, `@features/*`, `@server/services/*`); no `../../../`
  across workspace boundaries. Add a workspace member only once its directory exists.

### §3 UI, styling & components (merge gates — full detail in guardrails + DESIGN_SYSTEM Part E)
- Pure CSS + strict BEM, **token-only** (`var(--*)`; no hardcoded hex/radius/duration/shadow). No
  Tailwind, CSS-in-JS, inline styles, or UI-lib deps. `@material/material-color-utilities` only in
  `packages/ui/system/`.
- Signal-first state; avoid `useState`/`useEffect` except for external DOM libs.
1. Separation hierarchy: spacing → tonal tint → type weight → one hairline; full borders only on
   interactive elements.
2. Accessibility: reduced motion, dyslexic/colour-blind/high-contrast overlays, full ARIA.
3. Responsive Desktop/Tablet/Mobile, fluid, no app-side overrides.
4. Motion: critically/over-damped springs; theme colour changes transition simultaneously.
5. New/changed component updates the `DESIGN_SYSTEM.md` §C.1 roster in the same change.
6. Anti-card: static content never boxed; no nested cards, no card inside an elevated panel; region
   backgrounds are **solid** ramp tones (`--bg` → `--surface-1` → `--surface-2`), never translucent.
7. Anti-tagification: non-actionable metadata = inline `--text-secondary` middot text; containers
   only for controls · lifecycle statuses · required disclosures · counts.
8. Hierarchy: four registers (display · section header · body · meta); headings never ≥ `--fw-bold`;
   levels never differ by weight alone; changing figures `tabular-nums`.
9. `backdrop-filter` only on viewport-pinned top bars, floating mobile sheets/scrims, marks on
   photography — always on a `::before` underlay.
10. Conversion lane (entity-view routes): the lane **is** the transaction; no third sticky column; no
    price/purchase control in the desktop main stage or sticky header; below `--bp-md` the duty moves
    to one body block (moved, never duplicated); lane resolved by a pure URL slot resolver.
11. A control that renders must do something; a control driving server-rendered DOM must act on the DOM.
12. Press feedback = `transform: scale()` only; never move padding/margin/inset/border-width/size;
    removed under both reduced-motion channels via `transform: none`. Filled `--role`/`--on-role`
    pairs ≥ 4.5:1 in all four mode/contrast states (mode-adaptive ≥ 7:1 dark); `--primary`/
    `--on-primary` are mode-invariant; hover/active never lowers label contrast.

### §4 Routing & folders (Fresh 2.x)
- `routes/(public)/`, `routes/(dashboard)/`; profiles at `routes/[handle]/`; signup `/join`.
- Page controllers in `apps/web/features/[group]/[sub]/`; routes re-export.
- Every feature/package uses only `components/ islands/ styles/ hooks/ wrappers/ types/ core/` (+
  `routes/`, `services/` for features). **No `src/`.**
- Route slugs are prefixed and opaque (`prj-…`, `stg-…`, `tkt-…`); uuids do not route (Decision #88).

### §5 Product management & Dev Context Switcher
- Any lifecycle/state/transition/cap/evidence change updates `PRODUCT_MANAGEMENT.md` in the same
  change. No bespoke statuses; nothing hard-deleted (use `Archived`).
- Every new simulatable axis (persona, role, capability gate, lifecycle state, `data-dev-*` flag)
  gets its Dev Context Switcher control in the same change: `DevOverrides` + `DEV_DEFAULTS`,
  `DevOption` list, `DevContextPanel` control, `reflect()` set **and** delete
  (`apps/web/features/devtools/`, seam `apps/web/utils/dev-seam.ts`).

### §6 Security & environment
- RLS always on; service queries run in the user's JWT context; only service-role (edge/server
  definer doors) bypasses RLS. Placeholders are `XXXX-XXXX`; never commit real keys.
- Env keys per `SYSTEM_ARCHITECTURE.md` "Environment Variable Contract".

### §7 Code quality
- JSDoc on exported interfaces/classes/services/complex functions; `// #region [Name]` /
  `// #endregion` groupings; no meta-comments (`// fixed bug`).

### §8 Resolved decisions & new-conflict rule
- 126 logged decisions: index in `documentation/reference/decisions/README.md`. Before touching a
  surface, grep the index for it and read the matching decision file.
- A **new** contradiction between source docs: do not silently pick a side — flag it, add a row to
  the decision log (newest `decisions-*.md` file + index line), and ask a human.

### §9 PR checklist
- Every change must pass `documentation/reference/pr-checklist.md`.

## Reference Index (read on demand)

- Full guardrail text (§0–§7 with rationale, category table, all 12 UI gates) →
  `documentation/reference/guardrails.md`
- PR validation checklist → `documentation/reference/pr-checklist.md`
- Why a surface/schema is the way it is; prior conflicts and flags →
  `documentation/reference/decisions/README.md`, then the `decisions-NNN-MMM.md` file it names
- Business rules, sitemap, lifecycles → `documentation/business/PRODUCT_SPEC.md`
- Architecture, backend services, env contract, Stripe, security → `documentation/architecture/SYSTEM_ARCHITECTURE.md`
- Routes and URL rules → `documentation/architecture/ROUTING.md`
- Tokens, components, shell, conversion lane → `documentation/design-system/DESIGN_SYSTEM.md` (+ `packages/ui/CLAUDE.md`)
- Status state-machine and domain lifecycles → `documentation/PRODUCT_MANAGEMENT.md`
- Tables, functions, policies per schema → `documentation/database/<schema>/`
- Seed personas and seed pipeline → `documentation/database/Seed.md`
- Feature flows (projects, service creation, …) → `documentation/flows/`
