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

## 8. Resolved Decisions & New-Conflict Rule

The four founding conflicts were **resolved on 2026-07-12** (below). For any **new** contradiction
you find between source docs: do not pick a side quietly — flag it in the PR, add a row here, and
ask a human. This table is the durable decision log.

| #  | Decision (2026-07-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Applied in                                                                                                                                                                                                                                                                                    |
| :- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | **Chart engine — tiered.** D3.js (scales/geometry + low-density SVG) → Canvas2D (mid-density) → PIXI/WebGL (high-density stage, fed by Rust/WASM). Renderer auto-selected on a performance metric.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `PRODUCT_SPEC.md` §Libraries · `SYSTEM_ARCHITECTURE.md` §Charts · `DESIGN_SYSTEM.md` §B.5/§C.5                                                                                                                                                                                                |
| 2  | **Platform fee — 5%** flat, **plus Stripe processing fees passed through** (separate from the 5%). `finance-model.md` is canonical; `investor-summary.md` corrected from 10%.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `finance-model.md` §1.1/top-note · `investor-summary.md` §4                                                                                                                                                                                                                                   |
| 3  | **Profile route param — `[handle]`** (matches the `@handle` entity identifier). `PRODUCT_SPEC.md` sitemap updated `/[profile]` → `/[handle]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `PRODUCT_SPEC.md` §Sitemap · §4 above · `api/README.md`                                                                                                                                                                                                                                       |
| 4  | **Brand mark ratios — 1:1 (icon) + 7:2 (wordmark)**, per `PRODUCT_SPEC.md` §Visual Identity (SSOT). The brief's 3:1 is superseded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `DESIGN_SYSTEM.md` §C.4                                                                                                                                                                                                                                                                       |
| 5  | **Signup route — `/join`** (renamed from `/register`, 2026-07-13, per product owner). `/register` is retired — no redirect kept; all app links repoint to `/join`. Sitemap + ROUTING updated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `PRODUCT_SPEC.md` §Sitemap · `ROUTING.md` · `apps/web/routes/(public)/(auth)/join.tsx`                                                                                                                                                                                                        |
| 6  | **Age guardrails (new rule, 2026-07-13).** DoB age-gate: **<13 blocked**, **13–17 restricted** (no buy/sell until 18), **≥18 full**. `restricted` re-derived server-side; capability-scoped only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `PRODUCT_SPEC.md` §Account Creation, Age Guardrails & Onboarding · `apps/web/features/auth/`                                                                                                                                                                                                  |
| 7  | **Onboarding shapes (new rule, 2026-07-13).** Individual = lean (intent + credentials + basics + DoB). Organization = comprehensive wizard (identity, contact/address, scale, IAM, admin login), still Draft/Unverified; KYB stays deferred to L3. Google OAuth pre-fills `/join`. `redirectTo` return-path (guard param renamed `redirect`→`redirectTo`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `PRODUCT_SPEC.md` §Account Creation… · `apps/web/features/auth/` · `(dashboard)/_middleware.ts`                                                                                                                                                                                               |
| 8  | **Auth UX overhaul (2026-07-13).** `/join` is a fixed **non-scrolling** two-column wizard with a live "passport" summary; steps **1 → 1.6** (skills shown only for Freelancer; password skipped for OAuth/SSO). Softer, filled `@projective/ui` field variants for the lower-contrast palette; one scoped glassmorphic summary card. Adds **Enterprise SSO** (SAML/OIDC domain discovery, `/api/auth/sso`, provider wiring deferred). **Note:** step containers must stay `transform`-free — a transformed ancestor re-bases the field overlays' `position:fixed` panels.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `PRODUCT_SPEC.md` §Account Creation… · `apps/web/features/auth/` · `auth.css`                                                                                                                                                                                                                 |
| 9  | **`/join` premium redesign (2026-07-13).** Supersedes parts of #8 for the join sidebar: **deep-primary illustrative aside** with one large adaptive SVG scene (glass "passport" card **removed** from `/join`; it remains only on login/verify/forgot via `SceneAside`), **expressive imaginative step titles** (no literal "Step 1.2"), **neutral** first step (no default account type), **auto-advance** on choice-only steps, and felt ~0.5s slide-and-fade. **Business rule:** **Organizations are client/buyer-only** — they cannot register to provide services, so the org flow skips the Client/Freelancer step and the skills step; an org **website / corporate domain** field is added to the org scale step. **Individuals get any-step Google OAuth** (mid-flow pre-fill, no bypass). Purpose/Skills become **interactive pill clusters + a custom-tag combobox, capped at 5**. **Transform refinement of #8:** `.auth-step` may carry a **self-clearing** enter transform (no `forwards` fill) — it reverts to `transform:none` before any overlay opens, so `position:fixed` panels still resolve to the viewport; a _persistent_ transform remains forbidden.                                                                                                                                                                                                                                      | `PRODUCT_SPEC.md` §Onboarding step sequence · `apps/web/features/auth/` (`JoinArt.tsx`, `TagSelect.tsx`, `SummaryPanel.tsx`, `StepForm.tsx`) · `auth.css`                                                                                                                                     |
| 10 | **Thin-Frontend / Fat-Backend service pattern (2026-07-14).** Formalises §2. Thin client services (`AuthService`) gather input + call `/api/*`; **thin routes** do HTTP+Zod+guard only; **fat services** live in the new **`@projective/backend`** workspace member (alias `@server/services/*`), own all logic/DB/session, are the sole Supabase touchpoint, and return a transport-agnostic `ServiceResult<T>`. Fat services are **stub-first**, gated live by **`AUTH_BACKEND_LIVE`** (default off). All 8 `/api/auth/*` routes delegate to `AuthBackendService`; behaviour preserved. Also: **`Organisation` ≠ `business_profiles`** — an org is a **client/buyer-only** entity, a genuinely new table (Phase 2 migration pending), NOT a rename of `business_profiles`. **[Corrected by Decision #61, 2026-07-30: this row originally called `business_profiles` "the seller-side" entity when distinguishing it from Organisations. That wording is wrong — a Business is BUYER-side (a Client with multiple members), per `documentation/database/org/Tables.md` + `PRODUCT_SPEC.md` and the product owner's 2026-07-29 ruling. The distinction Decision #10 was reaching for is scale/structure, not side of market.]** Client-side **storage-keys dictionary** at `apps/web/utils/storage-keys.ts`; `/verify` gains an auto-login **verification-status poll** (reads mig 0312's `verified_at` when live). | `SYSTEM_ARCHITECTURE.md` §Backend Services · `packages/backend/` · `apps/web/features/auth/` · `apps/web/routes/api/auth/*`                                                                                                                                                                   |
| 11 | **Env-name drift — RESOLVED (2026-07-14, product owner).** The **canonical** documented Environment Variable Contract names win: `DENO_ENV` / `APP_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `GOOGLE_CLIENT_SECRET`. The `.env` / `.env.development` / `.env.production` aliases (`APP_ENV` / `URL` / `SB_SERVICE_ROLE_KEY` / `GOOGLE_SECRET`) were renamed to match, `config.toml`'s Google `secret` now reads `env(GOOGLE_CLIENT_SECRET)`, and `packages/backend/core/env.ts` + `auth-cookies.ts` read the canonical names directly (dual-read fallback removed). Separately, the three `.env*` files were **untracked from git** (`git rm --cached`; they were already `.gitignore`d) — the previously committed real Google + Supabase secrets remain in git history and must be **rotated** by a human.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `SYSTEM_ARCHITECTURE.md` §Environment Variable Contract · `packages/backend/core/env.ts` · `apps/web/utils/auth-cookies.ts` · `supabase/config.toml` · `.env.example`                                                                                                                         |
| 13 | **Global footer redesign + newsletter thin/fat (2026-07-14).** The public footer (`PublicFooter`, mounted on every `(public)` surface via `_layout`, excluded from the zero-scroll auth screens by composition) was rebuilt as a premium five-column masthead (brand + social tray · three ELI5, jargon-free link stacks — "safe & easy payments", never "escrow" · a newsletter capture) over a thin utility bar (copyright · legal · a soft-breathing "systems operational" status dot). Link stacks are native `<details>` — accessible mobile accordions, CSS-force-open on desktop (zero JS). The newsletter is the **third** implementation of Decision #10's contract and its smallest write: `NewsletterService` (client, Zod-validates first) → `POST /api/newsletter/subscribe` (thin) → `NewsletterBackendService` (fat, `@server/services/newsletter/`) → `ServiceResult<T>`, stub-first behind **`NEWSLETTER_BACKEND_LIVE`** (default off, `isNewsletterBackendLive()`). Subscribe shape is the Zod SSOT **`@projective/types/newsletter`** (`NewsletterSubscribeSchema`). No DB migration yet (the `newsletter.subscriptions` table is Phase 2).                                                                                                                                                                                                                                                      | `SYSTEM_ARCHITECTURE.md` §Backend Services · `packages/types/newsletter/` · `packages/backend/services/newsletter/` · `apps/web/features/marketing/` (`PublicFooter.tsx`, `NewsletterForm.island.tsx`, `NewsletterService.ts`) · `apps/web/routes/api/newsletter/subscribe.ts` · `footer.css` |
| 12 | **Explore thin-frontend/fat-backend decoupling (2026-07-14).** Second, **read-only** implementation of Decision #10's contract: `ExploreService` (client) → `/api/explore/{search,item,related}` (thin) → `ExploreBackendService` (fat, `@server/services/explore/`) → `ServiceResult<T>`, stub-first behind **`EXPLORE_BACKEND_LIVE`** (default off, `isExploreBackendLive()`). The discovery fixtures + query/ranking/grouping logic were relocated OUT of the app into the backend package (the boundary forbids `@features` imports); the Explore domain shapes moved to the Zod SSOT **`@projective/types/explore`** (`ExploreItem`, `ExploreParams`, `ResultGroup`, `SearchPayload`, `HomeFeed`). `/explore` + `/view/[id]` SSR call the fat service directly; the `SearchDashboard` island refines client-side via the API. Client storage keys registered in `apps/web/utils/storage-keys.ts` (the `src/…` path in the brief is superseded — CLAUDE.md §4 bans `src/`).                                                                                                                                                                                                                                                                                                                                                                                                                                     | `SYSTEM_ARCHITECTURE.md` §Backend Services · `packages/backend/services/explore/` · `packages/types/explore/` · `apps/web/features/explore/` · `apps/web/routes/api/explore/*`                                                                                                                |

| 14 | **Navigation-shell overhaul — four-profile matrix (2026-07-15).** The shell resolves to four
form-factor × auth profiles (Desktop/Mobile × Guest/User). **Auth is now resolved site-wide**: the
global `routes/_middleware.ts` sets `ctx.state.isAuthenticated` from a **skeleton** session-cookie
presence check (`hasSessionCookie`, keyed off the real `sb-access-token`), so public Home/Explore
render the unified user **L-shell** when signed in — chrome only, no JWT verify, RLS + the
`(dashboard)` guard remain the real gates. The authed shell is one shared `UserShell`
(`apps/web/features/shell/`) used by both `(dashboard)` and the authed `(public)` branch. Desktop
User = glass header layers (`--glass-blur`) + **opaque** sidebar (no blur) + single-edge
`--hairline` region seams; enlarged fluid radii (`--radius-2xl/-3xl`, `--radius-container-lg/-xl`).
The global sidebar is a cached collapse/expand island (`LocalKeys.SIDEBAR_COLLAPSED`, pre-painted
via `:root[data-sidebar]` — no FOUC), collapsed items are `--shell-nav-block` squares with a real
`Tooltip` (never native `title`), Projects/Dashboard carry nested sub-link disclosures, and updates
show as **pulsing dots, never counts**. Data-backed bits (Notifications/Basket/Create, recent
workspaces, sub-links) are **fixtures** behind the thin-frontend pattern
(`apps/web/features/shell/core/`). `MiddleNavSplitter`'s raw `"shell.lane.w"` literal migrated to
`LocalKeys.MIDDLE_LANE_WIDTH` (app-passed; package stays portable). Mobile User/Guest shells, the
mobile search overlay, and fixture-backed utility panels are **Phases 2–4** (pending). **Flagged
inconsistency (surface, do not silently resolve):** `storage-keys.ts`
`CookieKeys.AUTH_SESSION_TOKEN` documents `pj_auth_session`, but the session cookie actually
written/checked is `sb-access-token` (`auth-cookies.ts`). Both middlewares now key off the real
cookie; the `pj_auth_session` name should be reconciled with a human. | `SYSTEM_ARCHITECTURE.md`
§Backend Services · `DESIGN_SYSTEM.md` §A.3/Part D · `apps/web/features/shell/` ·
`apps/web/routes/_middleware.ts` · `apps/web/routes/(public)/_layout.tsx` ·
`packages/ui/navigation/` · `apps/web/utils/storage-keys.ts` |

| 15 | **Shell scroll model → native window scroll + micro-interaction pass (2026-07-15).** Refines
Decision #14. The authed shell's prior **internal-scroll** frame ("PageCanvas owns the main scroll
region") is **retired**: the shell now flows in the **native window scroll** (no `100dvh` cap, no
local `overflow` wrapper). The header (`position: sticky; top:0; z:var(--z-nav)`) and the global
sidebar (`position: sticky; top:var(--shell-topbar-h); block-size:calc(100dvh - topbar)`, own
internal overflow) stay viewport-locked. A **global custom scrollbar** (transparent track, muted
rounded pill thumb, hover contrast; `scrollbar-*` + `::-webkit-scrollbar-*`) lands in
`packages/ui/styles/index.css`. Region seams became **organic flowing `--hairline` contours** on the
nested `ShellFrame` (single hairline on the two exposed edges, curving with the frame radius) —
replacing the straight single-edge seams (still §B.4-compliant: one continuous hairline, not a box).
Sidebar micro-interactions: the collapse toggle is a **labelless custom morphing SVG** (rounded
square + dotted divider that slides left/right) pinned **bottom-left**; **Explore** icon →
minimalist compass, **Projects** icon → architectural arch; **Settings removed** from the rail
(account lives in the header menu); disclosure carets **hide when collapsed**, rotate **vertically**
(down closed / up open), and have **no wrapper hover bg** (only the glyph transitions); nested
**project sublinks show the owner's circular `Avatar`** (Unsplash faces, §C.4) instead of an icon.
No hydration mismatch remained (the `ShellSidebar` island already defers client-only state to
`useEffect`; verified clean). | `DESIGN_SYSTEM.md` Part D ·
`packages/ui/navigation/styles/{app-shell,top-bar,page-canvas,shell-frame,sidebar}.css` ·
`packages/ui/styles/index.css` ·
`apps/web/features/shell/core/{nav-icons.tsx,nav-fixtures.ts,nav-model.ts}` ·
`apps/web/features/shell/islands/ShellSidebar.island.tsx` |

| 16 | **User Context Hydration (2026-07-15).** Extends the site-wide skeleton-auth of Decision #14.
The global `routes/_middleware.ts` now also resolves a chrome-only **`ctx.state.userContext`** —
`contextType` (`personal`|`team`|`business`|`organisation`), `contextId`, `role`
(`guest`|`member`|`admin`), `isClient`, `isFreelancer`, `handle`, `userId` — by **decoding the
`sb-access-token` JWT payload _unverified_** (`djwt` `decode`, no signature check) and mapping its
claims (`app_metadata.active_context` + onboarding `user_metadata.objective`). Like
`isAuthenticated` this is **presence/skeleton only**: it decides which shell + skeletons SSR paints,
grants **no access**, and RLS + the `(dashboard)` guard remain the real gates; a forged token only
changes what the tamperer's own browser draws. The shape is the new Zod SSOT
**`@projective/types/auth`** (`UserContextSchema`, pure total `resolveUserContext(claims)`,
`GUEST_CONTEXT`, `PERSONAL_MEMBER_CONTEXT`, `asAuthenticatedContext()`); the HTTP-layer decode lives
in `apps/web/utils/user-context.ts`; every failure path (no/opaque/malformed cookie) degrades to
`GUEST_CONTEXT`. Both layouts bootstrap `asAuthenticatedContext(ctx.state.userContext)` into
`UserShell`, and **`globalNav(path, context)`** tailors the rail (seller-only Services/Businesses
gated on `isFreelancer`; Teams hidden in an organisation context; Earnings/Reviews sublinks
seller-only) so the correct skeleton ships in the first byte. Consistent with the buyer-only
Organisation rule (Decisions #9/#10). Org `owner` role collapses to chrome `admin`. No DB migration
(a derived runtime shape, not a table) → no `documentation/database/*` change. The real, signed-JWT
verification via `@server/services` remains the TODO wherever an _access_ decision is made. |
`SYSTEM_ARCHITECTURE.md` §Security · `packages/types/auth/` · `apps/web/utils/user-context.ts` ·
`apps/web/routes/_middleware.ts` · `apps/web/utils/state.ts` ·
`apps/web/features/shell/{components/UserShell.tsx,core/nav-model.ts}` · both group `_layout.tsx` |

| 17 | **Access-token hook — the backend origin of the active context (2026-07-15).** Completes the
producer side of Decision #16. A GoTrue **custom access token hook**
(`public.custom_access_token_hook`, migration `20260715120000_access_token_context_hook.sql`,
enabled in `supabase/config.toml` `[auth.hook.custom_access_token]`) stamps the acting context —
resolved from `security.session_context` + membership/handle lookups — into every issued JWT,
feeding **two** consumers from one place: (1) **raw top-level claims**
`active_profile_type`/`active_profile_id`/ `active_team_id`/`active_organisation_id` that the
pre-existing `security.current_context()` (mig 0099) reads for **RLS** (these were always NULL
before — no hook existed); (2) **`app_metadata.active_context`**
`{type,id,role,handle,isClient,isFreelancer}` the web app decodes (unverified) for chrome. Additive
schema: adds `security.session_context.active_organisation_id` (FK → `org.organisations`, so an
**organisation** can be the active context — buyer-only per Decisions #9/#10) + a
`security.switch_organisation_context` RPC; `switch_session_context` and `current_context()`
extended for the new slot; the four active slots are mutually exclusive. Hook is `SECURITY DEFINER`,
`search_path=''`, **never raises** (returns the event unchanged on any error so a chrome claim can't
break login), `EXECUTE` granted only to `supabase_auth_admin`. Capability flags are now
**authoritative** (from `org.users_public.is_freelancer`/`is_operator`), so `resolveUserContext`
prefers the stamped `isClient`/`isFreelancer` over the (staleable) onboarding `objective`. **Flagged
inconsistency (surface, do not silently resolve):** the `20260709` overhaul gates the **Businesses**
nav on `org.users_public.is_operator` (Client/Operator Mode), but `nav-model.ts` (Decision #16)
gates Services/Businesses on `isFreelancer` — reconcile the Businesses-tab gate with a human. |
`documentation/database/security/{Functions,Tables}.md` ·
`supabase/migrations/20260715120000_access_token_context_hook.sql` · `supabase/config.toml` ·
`packages/types/auth/user-context.ts` (`ActiveContextClaim`, `resolveUserContext`) |

| 18 | **Header re-architecture + action menus (2026-07-15).** Refines Decision #14/#15's Desktop
User shell. The unified header adopts a strict **left→right** flow: a **Left block** fuses the brand
mark to an **integrated search** (`NavSearchBar` island — the same modular scope-selector +
self-typing placeholder pattern the guest header uses, sharing the `landing-data` scope vocabulary;
the old zero-JS `HeaderSearch` server component is retired) that grows to fill the row; a **Right
block** (`UserActions` island — retiring `UserUtilityBar`) runs **Create · Notifications · Basket ·
Profile** with all controls vertically centered and **soft circular** (`999px`) hover highlights.
**Create** is a context-aware Popover menu (Project/Team/Business/Service/Product/Article) gated on
the hydrated `UserContext` with the SAME rule set as the sidebar (`actions-model.ts` mirrors
`nav-model.ts`): seller surfaces (Business/Service/Product) only when `isFreelancer`; Team hidden in
an `organisation` context. **Notifications** + **Basket** open right-side **blurring** `Drawer`s
(fixtures via `nav-fixtures`, thin-frontend). **Profile** (circular avatar) opens a padded account
Popover holding View profile, the **dark/light `ToggleSwitch` moved here entirely** (no longer loose
in the header), Log out, and an **icon-only Settings** button. Sidebar polish: the collapse toggle's
centre is pinned to the shared 32px icon axis at both rail widths (a prior `margin-inline:auto` on
the inline-flex button silently failed to centre it); collapsed-rail Tooltips float above the body
panel via a lifted sticky stacking context (`.ui-app-shell__sidebar { z-index: --z-sticky }`) and
are vertically centered (native `useFloating` "right"); expanded labels step to **medium** weight
with **bolder** glyph strokes. Same buyer-only Organisation rule as Decisions #9/#10/#16. **Inherits
the flagged, unresolved** Businesses-tab gate inconsistency from Decision #17 (Create's Business
option follows `isFreelancer`, matching `nav-model.ts`, pending the human reconciliation). |
`DESIGN_SYSTEM.md` Part D.1 ·
`apps/web/features/shell/islands/{NavSearchBar,UserActions}.island.tsx` ·
`apps/web/features/shell/core/actions-model.ts` · `apps/web/features/shell/core/nav-fixtures.ts` ·
`packages/ui/navigation/styles/{app-shell,sidebar,nav,top-bar}.css` |

| 19 | **Boundary-aware overlay positioning (2026-07-16).** The anchored-overlay engine
(`packages/ui/hooks/useFloating.ts`) gained a two-part **boundary model** on top of its existing
viewport flip/clamp: **`avoid`** — higher-level layout zones (the site-nav **sidebar**, the header)
the panel must **never intersect**, so it shifts clear (a left sidebar pushes the panel right); and
**`allowOverflow`** — viewport edges the panel **may** spill past into lower-level regions (a header
search dropping into the body), relaxing the clamp there. `avoid` accepts **live CSS selectors**
(re-measured every reposition, so a collapsing/expanding/dragged rail stays honoured), refs, or
rects; both params are optional and default to the prior behaviour (**every existing `Popover`/
`Tooltip`/fields overlay is byte-identical** — the header `NavSearchBar` menu is hand-rolled and
untouched). New ergonomic, **ref-owning** facade **`useEdgeDetection`** (alias `usePopoverPosition`)
returns `{ triggerRef, ref, style, placement, x, y, ready, recompute }` for hand-rolled dropdowns,
paired with a new `.ui-anchored` primitive class (fixed + `--float-*`) in `styles/index.css`.
`Popover` forwards `avoid`/`allowOverflow`; **applied fix:** the `/projects` Smart Filter (and
sibling Create) `bottom-end` popovers — a 19rem panel near the far edge of the ~280px middle-nav
lane that previously clamped only to the viewport and overlapped the sidebar — now pass
`avoid={[".ui-app-shell__sidebar"]}` and clear the rail. No DB/lifecycle change. |
`DESIGN_SYSTEM.md` §C.1 (hooks + collision model) ·
`packages/ui/hooks/{useFloating,useEdgeDetection,mod}.ts` ·
`packages/ui/feedback/islands/Popover.tsx` · `packages/ui/styles/index.css` ·
`apps/web/features/projects/islands/ProjectsLane.island.tsx` |

| 20 | **Desktop-User scroll model → locked viewport / internal body scroll (2026-07-16). REVERSES
Decision #15.** Decision #15's native-window-scroll model (whole shell in the document scroll;
header

- sidebar `position: sticky`) let the browser window scroll the nav chrome. The authenticated
  **desktop** shell now **pins the viewport**: `.ui-app-shell--user` is
  `block-size: 100dvh; overflow:
hidden`, so the document itself never scrolls. The top bar and
  **both** nav columns (global sidebar + middle-nav lane) are plain, non-scrolling flex/grid tracks
  — completely stationary; the global sidebar drops `sticky` for `position: relative` (kept only for
  the collapsed-rail Tooltip stacking context, `z-index: --z-sticky`) and the middle-nav lane drops
  the `sticky` patch for a stationary full-height cell. **Only** the Green body
  (`.ui-page-canvas__scroll`, `overflow-y: auto`) scrolls and owns the main scrollbar; each nav
  column keeps its own internal overflow (`.ui-shell-sidebar__items`, `.ui-splitter__body`) for
  over-long content. Because the root is height-capped, no absolutely/fixed-positioned sidebar
  descendant can expand the document (the §3 "scroll leak" guard is satisfied by the lock). The
  **guest** (marketing, no `AppShell`) shell and **all mobile** shells release the lock
  (`min-block-size: 100dvh`, no `overflow` cap) → native window scroll beneath the sticky glass
  header (Part D.3). **Flagged (surface, do not silently resolve):** the mobile `BottomNav` renders
  as a **sibling of `AppShell`** in `UserShell`, outside the lock; it is safe only because it is
  `display:none` on desktop / `position:fixed` on mobile — a future non-fixed sibling would leak.
  Product owner chose the shell-level lock (not a document-root lock) on 2026-07-16. |
  `DESIGN_SYSTEM.md` Part D (scroll model) ·
  `packages/ui/navigation/styles/{app-shell,middle-nav}.css` ·
  `apps/web/features/shell/components/UserShell.tsx` |

| 21 | **Project Details sidebar — the lane's engagement mode (2026-07-16).** The middle-nav lane is
now **path-discriminated within `/projects`**: the `/projects` root (+ `/projects/create`) keeps the
feed (`ProjectsLane`), but a specific `/projects/{slug}` (or deeper) swaps the lane to the new
contextual **`ProjectSidebar`** island (`apps/web/features/projects/islands/`) — `laneFor()` in
`(dashboard)/_layout.tsx` resolves the slug and SSR-paints it. It is the 5th
thin-frontend/fat-backend read: **`ProjectBackendService.detail(slug)`** → thin
`/api/projects/detail` → thin `ProjectSidebarService.detail` → soft `ProjectsResult`, gated by the
SAME `PROJECTS_BACKEND_LIVE`. The deep projection is a new **Zod SSOT
`@projective/types/projects/detail`** (`ProjectDetailSchema` +
`ProjectChannel`/`StageChannel`/`TeamChannel`/`DmChannel`/`ProjectMember`); the fixtures **derive**
it from the existing summary rows (`packages/backend/services/projects/detail-fixtures.ts`,
deterministic slug-hash, no RNG) so detail always agrees with the card that linked to it — no DB
migration (a derived read projection). Sidebar surfaces: Back+Star+kebab header (kebab reuses the
feed card's Open/Share/ Report/Leave/Delete); a **Project-vs-Service** contextual card (project →
owner PFP + type badge; service → banner image + client identity); core view links with a
**dynamically-labelled Board** (`boardView()`: pipeline→**Pipeline**, one-off project→**Timeline**,
service/session→**Calendar**) and a viewer-scoped Submissions note (client "All" / freelancer
"Your"); and a **four-group channel accordion** (General · Stages · Teams · Private Messages).
**Client-only** Create-Stage `＋` gated on a server-derived `viewerIsClient` (stub modal,
persistence deferred). **Unified DM contract:** project DM/team channels reuse the SAME `chatId` as
the global DM (`dm-{handle}`), and every channel link carries
`?project={id}&scope={this-project|full}` via `core/chat-context.ts` (`chatHref`), with an
in-context accent tag + a "This project ⁄ Full history" scope toggle — so chat history is one record
and project-scoped filtering is prepared. **Deviation flagged (surface, do not silently resolve):**
the task brief specified `/profile/[handle]` for the owner/handle link, but the codebase canonical
is Decision #3's wildcard `/[handle]` (`@handle`) — the sidebar follows the canonical `/@handle`
(via `projects/core/routing.ts`), NOT `/profile/…`; reconcile the brief with a human if `/profile/`
is truly wanted. | `PRODUCT_SPEC.md` §Stage Management / §Unified Messaging ·
`packages/types/projects/detail.ts` ·
`packages/backend/services/projects/{detail-fixtures,ProjectBackendService}.ts` ·
`apps/web/routes/api/projects/detail.ts` ·
`apps/web/features/projects/{islands/ProjectSidebar.island,
components/*,core/{detail-ssr,chat-context,routing}}.tsx`
· `apps/web/routes/(dashboard)/_layout.tsx` |

| 22 | **Icon-first sidebar philosophy + global link-shape rules (2026-07-16).** Codifies two owner
directives. **(A) Icon-first density** — navigation columns and dense list surfaces (global rail,
middle-nav lane, Project Details channel tree, project cards) are **high-density, icon-led**: prefer
icons + compact text + hover tooltips over verbose prose; **in-row statuses/warnings/system states
are iconographic (small contextual icon or the existing pulsing dot), never inline text** — the
explaining words live **only** in the on-hover tooltip; panel actions / view-switchers group into
**horizontal icon-only rows in a sticky footer** to preserve content height; **every** icon-only
control carries a portal-based `@projective/ui` `Tooltip` + `aria-label` (never native `title`).
Landed as the new merge-gated **`DESIGN_SYSTEM.md` §B.6** (consistent with the §D.1 pulsing-dot rule
and §D.2 collapsed icon-only rows). **(B) Global link shapes** — profiles resolve to **`/[handle]`**
(`/@handle`, never `/profile/[handle]`; this merely **re-affirms Decision #3** — codebase already
complies via `profileHref`), and project channels resolve to
**`/projects/[project-id]/[channel-id]`**. **Conflict RESOLVED (owner directive, 2026-07-16):** the
project-channel rule superseded the shipped Unified-Messaging routing of Decision #21 — the link
builder is now **repointed**. `chat-context.ts` exports `channelHref(projectId, channelId)` →
`/projects/{slug}/{channelId}` and `ChannelTree.tsx` routes every channel/DM there; the
standalone-inbox `/messages/[chatId]?project=&scope=` addressing + the "This project ⁄ Full history"
scope switch are **removed**. Unified history is **preserved** — each channel still carries its
shared `chatId` (the thread identity the destination page loads), so a project DM and the same
person's global DM remain one continuous record; only the entry-point URL moved into the project
namespace. | `DESIGN_SYSTEM.md` §B.6 · `ROUTING.md` §Global routing rules ·
`apps/web/features/projects/core/chat-context.ts` ·
`apps/web/features/projects/components/ChannelTree.tsx` · Decisions #3 / #21 |

| 23 | **Project Details sidebar — icon-first refactor (2026-07-16).** Executes Decision #22's
directives on the Project Details sidebar. **Channel routing repointed** to
`/projects/[slug]/[channelId]` (see #22 resolution): `chat-context.ts` → `channelHref`, channel
route ids in `detail-fixtures.ts` shortened to clean segments (`general`, `stage-2`,
`team-design-1`, `dm-{handle}`). **Vertical text nav list DELETED** (`ProjectNavLinks.tsx` removed)
→ a compact **horizontal icon-only view-nav in a NEW sticky footer** (`ProjectViewNav.tsx`): Details
· Board (dynamic Pipeline/Timeline/Calendar) · Members · Attachments · Submissions · Finances ·
Settings, each a portal-`Tooltip`-labelled icon anchor; the lane **Expand/Collapse** toggle sits
inline in the same footer (dispatches `MIDDLE_LANE_TOGGLE_EVENT`). **Stage channels gained icon-only
status signals** (`StageStatusIcon.tsx` + new Zod `StageActivity` enum
`new_ticket|revision_requested|stage_invite` on `StageChannelSchema`) — tiny tonal glyph + hover
Tooltip, NO inline text (§B.6). **DM group** now shows **only project members the viewer has
previously messaged** (`hasProjectContext` filter); the This-project/Full-history scope switch +
in-project accent tag are **removed**. Header (Back+Star+kebab)

- contextual identity card (owner/client PFP · title · `/@handle` · type badge · 2-line desc · Show
  details) unchanged and verified rendering at the top. | `DESIGN_SYSTEM.md` §B.6 ·
  `packages/types/projects/detail.ts` (`StageActivity`) ·
  `packages/backend/services/projects/detail-fixtures.ts` ·
  `apps/web/features/projects/{islands/ProjectSidebar.island,components/{ProjectViewNav,StageStatusIcon,
ChannelTree},core/chat-context,styles/project-sidebar.css}`
  · Decisions #21 / #22 |

| 24 | **Project Details sidebar — card-less header + channel quick-filters + footer realign
(2026-07-16).** Refines Decision #23's Project Details sidebar; no data/lifecycle change
(presentation

- client view-state only). **(A) Card-LESS identity header** (`ProjectContextCard`): the boxed tonal
  `.proj-ctx` container is **removed** — the header rests directly on the lane surface and is set
  off from the channel tree by one `--hairline` divider (`.proj-detail__divider`, §B.4). Layout is
  the leading party's **large** avatar (48px; owner for a project, client for a service) LEFT, the
  title + a **single clickable owner/client name** stacked right (name → canonical **`/@handle`**
  per Decision #3), and a **lone icon-only project-type glyph** (Pipeline·Timeline·Calendar via
  `boardView`) pinned top-right whose portal `Tooltip` names the type. **Removed as redundant:** the
  written type **badge**, the `@handle` **text** line, and the **second small avatar** (§B.6
  icon-first). The description is one **interactive reveal block** — up to **3 lines**, a "Show
  details" affordance, a hover colour-shift (`--text-secondary`→`--on-surface`, i.e. darkens in
  light / lightens in dark), and a click routing to `/projects/{slug}`. **(B) Channel
  quick-filters** (`ChannelQuickFilters`, NEW): an icon-only toggle row (Starred · Unread · New
  tickets · Revisions, portal `Tooltip`s) between the description and the divider narrows the
  channel tree — OR-combined, force-opens matched groups, empty-state on no match; `starred` is
  **stubbed** (no channel-level star yet, pending the live backend). **(C) Footer realign**
  (`ProjectViewNav`): the sticky footer now pins the lane **collapse/expand toggle LEFT** and the
  view-link icons flush **RIGHT**; the toggle **reuses the global rail's `SidebarToggleIcon` glyph +
  morphing-divider slide**, scoped in `project-sidebar.css` to track THIS lane's `data-collapsed`
  (same technique as the feed's `.proj-lane__collapse`), **retiring** the old `PanelToggleIcon`
  rotate. | `DESIGN_SYSTEM.md` §B.6 ·
  `apps/web/features/projects/{islands/ProjectSidebar.island,components/{ProjectContextCard,
ChannelQuickFilters,ChannelTree,ProjectViewNav,detail-glyphs},styles/project-sidebar.css}`
  · Decisions #3 / #21 / #23 |

| 25 | **Project Details sidebar — dedicated collapsed icon rail + smooth lane width (2026-07-16).**
Refines Decision #24; presentation + a portable splitter enhancement (no data/lifecycle change).
**(A) Two presentations, CSS-switched by density.** The sidebar now renders BOTH an expanded stack
(`.proj-detail__full`) and a purpose-built collapsed **icon rail** (`ProjectRail`), with
`.ui-splitter[data-mode="collapsed"]` revealing exactly one — so **both** a handle drag and the
toggle flip it, with **no client width-observer** and **deterministic** toggles (the footer toggle
only collapses, the rail toggle only expands; each is visible solely in its own state, so the prior
`collapsed` signal + seeding `useEffect` were removed). The rail is a single vertical flex column:
**top** — Back · owner/client avatar (circular, links to canonical `/@handle`) · Details · Board
(dynamic Pipeline/Timeline/Calendar) · Members · Attachments · Submissions · Finances; **bottom**
(`margin-block-start:auto`) — Settings · an Expand toggle (reusing the global rail's
`SidebarToggleIcon` glyph + morphing-divider slide). Every rail button mirrors the global collapsed
`.ui-nav-item` exactly (48px `--shell-nav-block` square, `padding:0`, `--radius-base`, same
hover/active tints, 24px icon) and carries a portal `Tooltip` + `aria-label` (§B.6, never native
`title`). The core view links are shared via a new `projectViewLinks(detail)` helper (in
`detail-glyphs.tsx`, also consumed by `ProjectViewNav`) and `cloneElement`-copied in the rail so a
glyph VNode is never mounted twice at once (Preact VNode-reuse guard). **(B) Wider collapsed lane.**
Scoped via `.ui-splitter[data-mode="collapsed"]:has(.proj-detail)`, the collapsed **Project
Details** lane widens to `calc(var(--shell-sidebar-w) + 6px)` (70px; body resolves to the 64px
global-rail width for 8px gutters) — the feed lane keeps its own narrow 56px rail (the `:has` scopes
it). **(C) Smooth, drag-safe lane width (portable `@projective/ui` splitter change, Part D.2).**
`useSplitter` now returns a **`dragging`** signal (set across pointer down→up); `MiddleNavSplitter`
stamps `data-dragging`, and `splitter.css` gives `.ui-splitter` an `inline-size` transition
(`--dur-medium`/`--spring-standard`) that is **suppressed mid-drag** (`[data-dragging="true"]`) so
toggling collapse/expand animates while a handle drag still tracks the pointer 1:1; reduced-motion
drops the transition. Benefits the feed lane too (additive, backward-compatible return shape). |
`DESIGN_SYSTEM.md` Part D.1/D.2 · §B.6 ·
`apps/web/features/projects/{islands/ProjectSidebar.island,components/{ProjectRail,ProjectViewNav,detail-glyphs},styles/project-sidebar.css}`
· `packages/ui/navigation/{hooks/useSplitter,islands/MiddleNavSplitter,styles/splitter.css}` ·
Decisions #3 / #23 / #24 |

| 26 | **Channel/chat view chrome — middle-nav-integrated header + composer footer (2026-07-16).**
Refactors the open-engagement `/projects/[project-id]/[channel-id]` view (presentation only; no
data/lifecycle change). The channel view no longer renders an independent header **inside** the
scroll flow — the shared `[channelId]/_layout.tsx` now **frames the middle-nav content region**: a
`ChannelHeader` pinned `position: sticky; top: 0` at the top and (Chat-tab only) the `ChatComposer`
pinned `position: sticky; bottom: 0` as a **footer that is a sibling of the scrollable body, not a
child of it** — so the message stream scrolls fully unhindered. Both stick **within the single
`.ui-page-canvas__scroll` owner** (Decision #20's locked-viewport model); the view adds **no nested
scrollbar**, and "global/window scroll" resolves to that one PageCanvas region. The composer moved
**out of `chat.tsx`** into the layout, gated `activeTabOf(...) === "chat"` (nothing to compose on
Files/Members/…). Header **tabs restyled to underlined text** (§B.4): no pill/box background, a 2px
`--primary` `::after` underline (`scaleX`, jump-to-final under reduced-motion) pinned
`inset-block-end: -1px` so it lands **on the divider hairline**; tabs stay real anchors into
`.../{chat,files,members,submissions,calendar,tasks}` (URL-driven active state), labels collapse to
their leading glyph on mobile. **Stage channels** in the tree now render as ordinary **`#` hash
channels** (matching General/Team rows) instead of the coloured lifecycle dot — state still reads
via the trailing `StageStatusIcon` + unread dot (§B.6); the dead `.proj-chan__stagedot` CSS was
removed. DM/team rows keep their circular avatar. New `DESIGN_SYSTEM.md` **§D.4**. |
`DESIGN_SYSTEM.md` §D.4 · §B.4/§B.6 · Part D (scroll model) ·
`apps/web/routes/(dashboard)/projects/[projectId]/[channelId]/{_layout,chat}.tsx` ·
`apps/web/features/projects/{islands/ChannelHeader.island,islands/ChatComposer.island,components/ChannelTree,styles/channel-header.css,styles/project-sidebar.css}`
· Decisions #20 / #21 / #23 |

| 27 | **Shell scroll model → native window scroll (2026-07-16). REVERSES Decision #20.** Per
product owner, the authenticated shell returns to a **native window scroll** on every profile (the
intent of Decision #15), undoing #20's locked-viewport frame. `.ui-app-shell--user` drops
`block-size: 100dvh;
overflow: hidden` for the shared `min-block-size: 100dvh` (no `overflow` cap),
so the **document itself** scrolls and the browser window owns the single main scrollbar. The chrome
is pinned by `sticky`, not by locking the root: the top bar (`top: 0`, unchanged), and now the
**global sidebar** (`.ui-app-shell__sidebar`) + the **middle-nav lane** (`.ui-middle-nav__lane`) are
`position: sticky;
inset-block-start: var(--shell-topbar-h); block-size: calc(100dvh - topbar); align-self: start`,
each keeping its own internal overflow (`.ui-shell-sidebar__items`, `.ui-splitter__body`) so a tall
rail scrolls inside itself instead of scrolling away with — or lengthening — the page.
`.ui-middle-nav__content` and `.ui-page-canvas__scroll` become `overflow: visible` (no container
scroll; the `.ui-app-shell--user .ui-page-canvas__scroll { overflow-y: auto }` override is removed).
The nested ShellFrames' `overflow: clip` is NOT a scroll container, so every sticky descendant
resolves against the window — one scrollbar, no nested trap. **Decision #26 adapted:** the
`ChannelHeader` now sticks at `inset-block-start: var(--shell-topbar-h)` (was `0`, which would hide
it behind the sticky top bar), the `ChatComposer` keeps `sticky; bottom: 0` (now pinned to the
viewport bottom by the window scroll, not an inner region), and `.chan-view` fills `min-block-size:
calc(100dvh

- topbar)`so the composer pins to the screen bottom even for a short chat. Verified: on`/projects/{slug}/{channel}/chat`the document overflows the viewport (window scrolls) while top bar,
channel header, sidebar, lane, and composer all hold their viewport pins; no horizontal leak; the
only internal scrollers are the intentional nav-column lists. No DB/lifecycle/business-rule change
(pure shell CSS). |`DESIGN_SYSTEM.md`Part D (scroll model) / §D.4 ·`packages/ui/navigation/styles/{app-shell,middle-nav,page-canvas}.css`·`apps/web/features/projects/styles/{channel-header,chat-composer}.css`
  · Decisions #15 / #20 / #26 |

| 28 | **Configurable middle-nav content-pane header slot (2026-07-17).** Refines Decision #26/#27.
The channel `ChannelHeader` is no longer rendered by the page inside the scrolling body — it is
hoisted to a **single route-driven header slot** on the middle-nav content pane. `PageCanvas` gains
an optional **`header`** slot (`.ui-page-canvas__header`, `--has-header` modifier) rendered as a
sticky, non-scrolling strip INSIDE the rounded frame, above `.ui-page-canvas__scroll`; when unset
the slot is **not rendered at all**, so the frame collapses it and the body fills the top with no
reserved space (no empty bar). `UserShell` threads a `middleNavHeader` prop into that slot.
**Registration is SSR-idiomatic, not a client React context:** a client context cannot paint the
slot on the first SSR byte (it would flash empty every navigation) and does not persist across
Fresh's per-navigation renders, so pages "register" a header the same way the lane is resolved
(`laneFor`) — a pure resolver keyed on the URL, `channelHeaderFor(url, context)`
(`apps/web/features/projects/core/
channel-header-slot.tsx`), evaluated by
`(dashboard)/_layout.tsx`. It returns the `ChannelHeader` only on
`/projects/[projectId]/[channelId]` and `null` elsewhere. The header slot owns the sticky
positioning (`inset-block-start: var(--shell-topbar-h)`, `--z-sticky`); `.chan-header` is now a
plain in-flow strip (its own `position: sticky` removed). New token
**`--shell-midnav-header-h: 3rem`** sizes the header and is subtracted in `.chan-view`'s
`min-block-size` (now `calc(100dvh - topbar -
midnav-header-h)`) so the Chat composer still pins to
the screen bottom on short chats. The channel `[channelId]/_layout.tsx` no longer resolves project
detail — it keeps only the body + the Chat-only composer, resolving the Chat tab straight from the
URL (`activeTabOf`). Verified: header mounts in the slot (pinned, tabs/underline/meta intact) on
channel routes incl. non-chat tabs (composer absent off Chat); the feed, `/projects/create`, a
channel-less `/projects/{slug}`, and public routes show no header and no empty bar; no console
errors. Pure layout/CSS — no DB/lifecycle/business-rule change. | `DESIGN_SYSTEM.md` §D.4 / §C.1 ·
`packages/ui/navigation/components/PageCanvas.tsx` · `packages/ui/navigation/styles/page-canvas.css`
· `packages/ui/styles/index.css` · `apps/web/features/shell/components/UserShell.tsx` ·
`apps/web/features/projects/core/channel-header-slot.tsx` ·
`apps/web/routes/(dashboard)/_layout.tsx` ·
`apps/web/routes/(dashboard)/projects/[projectId]/[channelId]/_layout.tsx` ·
`apps/web/features/projects/styles/channel-header.css` · Decisions #26 / #27 |

| 29 | **Middle-nav header band — lifted from the content pane to the frame, connected to the lane
(2026-07-17). REFINES Decision #28.** Decision #28 implemented the configurable header as a slot
INSIDE the Green content pane (`PageCanvas`'s `.ui-page-canvas__header`), so it floated within the
canvas, visually detached from the lane. Per the product owner's sketch, the header must instead
**span the middle-nav frame and connect to the sidebar** as ONE strip sharing the same surface + top
curve. The header slot is therefore **hoisted one level up to the `MiddleNav` frame**: `MiddleNav`
is now a two-row grid — the **lane spans both rows** (col 1) while the content column splits into an
optional **`header` band** (`.ui-middle-nav__header`, col 2 row 1, `position: sticky` at
`--shell-topbar-h`, `--z-sticky`) above the content canvas (col 2 row 2); with no header the canvas
spans both rows and fills the top (no empty bar). The band sits **flush against the lane on the
shared Blue `--surface-1` tone**, and the lane's own Back/kebab header (`.proj-detail__header`) is
pinned to the same `--shell-midnav-header-h` height (`flex: none` so the lane's flex column can't
shrink it) — so the two halves line up as **one connected header strip with a continuous
`--hairline` seam** across the whole frame (verified: both 48px, same top **and** bottom, band flush
at the lane's right edge; the Green canvas + the lane channels both start below the seam).
`PageCanvas` **loses its `header` slot entirely** (prop + `.ui-page-canvas__header` CSS removed);
`UserShell` routes `middleNavHeader` into `MiddleNav`'s `header` prop instead (it now **requires a
lane** — the band belongs to the frame). `ChannelHeader` (still the island of Decision #28,
unchanged markup) reads `--surface-1` to match the band. The URL resolver `channelHeaderFor` and
`channel-view.ts`/`activeTabOf` are unchanged. Pure layout/CSS — no DB/lifecycle/business-rule
change. | `DESIGN_SYSTEM.md` §D.4 · `packages/ui/navigation/components/{MiddleNav,PageCanvas}.tsx` ·
`packages/ui/navigation/styles/{middle-nav,page-canvas}.css` ·
`apps/web/features/shell/components/UserShell.tsx` ·
`apps/web/features/projects/styles/{channel-header,project-sidebar}.css` · `ROUTING.md` · Decision
#28 |

| 30 | **Middle-nav frame → pinned, internal content scroll so the corners follow (2026-07-17).
REFINES Decision #27 for the middle-nav region.** After Decision #29 lifted the header to the
`MiddleNav` frame, the frame's rounded corners (and the connected header band + lane) **scrolled
away** on a long chat: `.ui-middle-nav` was `position: static`, so under Decision #27's native
window scroll it flowed up with the document while only the sticky chrome stayed — the top curve
carried up out of view (verified: `frameTop` 48 → -352 at `scrollY` 400). Fix (desktop,
`@media (min-width: 768px)`): **pin the frame** (`sticky` at `--shell-topbar-h`,
`block-size: calc(100dvh - topbar)`) and **scroll its content INTERNALLY**
(`.ui-middle-nav__content { overflow: hidden }` → `.ui-page-canvas__scroll { overflow-y:
auto }`),
so the frame — corners, header band, lane — stays fixed to the viewport while only the bodies move
(the lane already scrolled internally via `.ui-splitter__body`). The composer (`sticky; bottom: 0`)
now pins inside that internal scroller. The header band's row is a **definite** track
(`.ui-middle-nav--has-header { grid-template-rows: var(--shell-midnav-header-h) 1fr }`) — an `auto`
row collapsed to 0 under the now-definite frame height (the `.chan-header`
`block-size: 100%`↔auto-track circularity); `.chan-header` is a fixed
`block-size: var(--shell-midnav-header-h)`. **The top bar + global sidebar stay `sticky`
(unchanged); mobile keeps native window scroll** (no frame chrome, Part D.3); bare-canvas (no-lane)
pages are untouched (the rules are scoped to `.ui-middle-nav`). Net: for a page WITH a middle-nav
the document no longer window-scrolls (content scrolls inside the pinned frame) — a scoped return
toward the internal-scroll model (#20) for that region only, chosen so the rounded corners stay
attached to the viewport per the product owner. Verified: frame/band/canvas/lane-header all hold
their top on internal scroll (`curvesFollow: true`), band 48px, canvas starts at the seam (97),
composer pins to the viewport bottom, feed + `/projects` root unaffected, no console errors. Pure
layout/CSS — no DB/lifecycle/business-rule change. | `DESIGN_SYSTEM.md` Part D / §D.4 ·
`packages/ui/navigation/styles/middle-nav.css` ·
`apps/web/features/projects/styles/channel-header.css` · Decisions #27 / #29 |

| 31 | **Channel chat feed + scroll model → native window scroll & composer footer band
(2026-07-17). REVERSES Decision #30 for the middle-nav region.** Two changes ship together. **(A)
Scroll model.** Decision #30 pinned the middle-nav frame and scrolled its content INTERNALLY so the
rounded corners wouldn't scroll away; per product owner the region returns to the **native WINDOW
scroll** (the intent of #15/#27). `middle-nav.css` drops the desktop frame-pin + internal-scroll;
the frame flows in the document and the browser window owns the single main scrollbar (never `body`,
never `.ui-middle-nav__content`). `.ui-page-canvas__scroll` is **renamed `.ui-page-canvas__body`**
(it no longer scrolls) and made a flex column so the chat feed can `flex: 1` to fill the content row
and bottom-anchor a short conversation. The `HeroParticles` parallax (which keyed off the old class)
now observes window scroll. **(B) Composer relocation.** The `ChatComposer` moves OUT of
`[channelId]/_layout.tsx` (it was `sticky; bottom: 0` inside the scroll body) into a NEW
configurable middle-nav **`footer` band** (`.ui-middle-nav__footer`, `sticky; inset-block-end: 0` at
`--z-sticky`), the sibling of the header band — resolved per route by `channelFooterFor` (mirrors
`channelHeaderFor`) and threaded `UserShell.middleNavFooter` → `MiddleNav.footer`, Chat-tab only.
`MiddleNav` is now a three-row grid (header · content · footer; lane spans all three). **(C) The
chat feed** — the 6th thin-frontend/fat-backend read: `MessagesService` (client) →
`/api/projects/messages` (thin) → `ProjectBackendService.messages` (fat, fixtures) →
`ServiceResult<MessagePage>`, stub-first behind the SAME `PROJECTS_BACKEND_LIVE`; Zod SSOT
**`@projective/types/projects/messages`** (`ChatMessage`, `MessageSender/Attachment/Audio`,
`SystemActivity`, `MessageReaction`, `MessagePage(+Params)`, `ChannelPermissions`). Fixtures
**derive** a deterministic conversation from the same `ProjectDetail` (no RNG, fixed reference
clock) so the feed agrees with the channel that opened it. **No DB migration** — messages is a read
projection over the eventual `messages.*` tables (Phase 2, like `detail`), so no
`documentation/database/*` change. `ChatFeed.island` **bottom-anchors + virtualizes against the
window** (`useVirtualScroll` `useWindow`), opening at the newest message and loading older on
scroll-up (top IntersectionObserver sentinel → prepend → re-anchor by the document-growth delta).
`useVirtualScroll` gained **additive, backward-compatible**
`startAtEnd`/`scrollToEnd`/`onReachStart`, id-keyed measurements (`getItemKey`, prepend-safe), a
`scrollToIndex(offset)`, and immediate re-sync on programmatic scroll. Message UI (all in
`apps/web/features/projects/`, reusing `@projective/ui` Avatar/Popover/Tooltip + the composer's
`useWaveform`/`resamplePeaks`): consecutive grouping (same author within 10–30 min → reduced
separation, one avatar/name, corner masking — others sharpen the group-toward LEFT corners, own the
RIGHT), own-right/other-left, `max-width: 60%` bubbles, no-layout-shift hover time, a
Reply·React·Copy toolbar + a `…` menu (Pin·Favourite·Report) with **Pin gated by server-derived
`canPin`** (anyone in a DM; owner-granted in a project/team channel), a custom **"wonky star"**
favourite mark on the bubble border, media (aspect-ratio row ≤3 media, else a rounded-square grid
**max 4** with a `+N` overlay), an audio player matching the recorder visualizer, **interactive**
system-activity notices that route to their target, and a **sticky pinned banner** (≤3,
one-at-a-time, `‹`/`›` loop, Expand, jump-to-message). **Deviation flagged (surface, do not silently
resolve):** the task brief specified the sender profile link as `/profiles/[user id]`, but the
codebase canonical is Decision #3/#22's wildcard `/[handle]` (`/@handle`, via `profileHref`) — the
feed follows the canonical, NOT `/profiles/[id]`; reconcile with a human if the plural
`/profiles/[id]` route is truly wanted. Submission notices link within the canonical channel
namespace `/projects/[projectId]/[channelId]/submissions/[id]`. | `DESIGN_SYSTEM.md` Part D / §D.4 /
§C.1 ·
`packages/ui/navigation/{components/{MiddleNav,PageCanvas}.tsx,styles/{middle-nav,page-canvas,app-shell}.css}`
· `packages/ui/hooks/useVirtualScroll.ts` · `packages/types/projects/messages.ts` ·
`packages/backend/services/projects/{messages-fixtures,ProjectBackendService}.ts` ·
`apps/web/routes/api/projects/messages.ts` ·
`apps/web/features/projects/{islands/ChatFeed.island,
components/*,core/{message-model,MessagesService,messages-ssr,channel-footer-slot}}.tsx`
· `apps/web/features/shell/components/UserShell.tsx` · `apps/web/routes/(dashboard)/_layout.tsx` ·
Decisions #26 / #27 / #30 |

| 32 | **File Explorer — `/files` (channel + project scope) (2026-07-20).** The 7th
thin-frontend/fat-backend read: a virtualized, zoom-driven File Explorer for a project's channel
attachments. Channel scope `/projects/[projectId]/[channelId]/files` (attachments in one channel;
the shell mounts the channel header with the active Files tab) and project scope
`/projects/[projectId]/files` (all channels, with a **Channels-top-level** tree navigator — the
`FileChannelTree`; legacy `/attachments` 308-redirects here, and per-channel `/attachments` → that
channel's `/files`). New **Zod SSOT `@projective/types/projects/files`**
(`FileItem`/`FileListPage`/`FileListParams`/`FileKind`/`FileSortKey`…); fat
`ProjectBackendService.files` → thin `/api/projects/files` → client `FilesService` → SSR
`resolveFilePage`, gated by the SAME `PROJECTS_BACKEND_LIVE`. Fixtures **derive** a deterministic
file corpus from `ProjectDetail`'s channels (fixed clock, unsigned hash indices — a signed `>>` went
negative → a "….undefined" ext) — **no DB migration** (a read projection over the eventual `files.*`
tables, like `detail`/`messages`). **Zoom-driven view (NO grid/list toggle button):** one continuous
`zoom` (0–1) shared cross-island via `core/view-state.ts`; below the centre marker = the dense
list/table (adaptive inline thumbnail → category icon), above it = the rounded-**square** card grid
(cards scale with zoom); `Ctrl`+wheel over the workspace drives it (default-prevented). Both
viewports window-virtualize with infinite scroll. New `@projective/ui` primitives (§C.1 roster +
Part-C prose updated in the same change): **`display/VirtualGrid`** (1D-by-row windowed grid),
**`fields/SortControl`** (property dropdown + asc/desc toggle in one borderless block),
**`fields/ZoomSlider`** (the footer View Control Rig's − · segmented track + centre marker · +), the
borderless **`.ui-field--bare`** variant, and **`layout/SplitterPanel.maxSize`**. The **universal
preview modal** (footer-less; a `.ui-splitter` media/metadata split with hard min/max %; a
`Carousel` swipe + a bottom companion tray for multi-file posts; per-type inline previews incl.
syntax-highlighted code; inline rename on the viewer's OWN files; Download/Star/kebab) mounts
through **`BodyPortal`** to beat the glass-blur `position:fixed` re-base trap. **CRITICAL
splitter-protection (tested):** the layout `Splitter` (the modal) and the nav lane
`MiddleNavSplitter` share `.ui-splitter`; the nav's globally- loaded `splitter.css`
(`inline-size: var(--shell-lane-w)`) would otherwise force the modal splitter to the lane width (the
"wide-or-collapsed binary"), so the layout splitter's ROOT box rules are scoped to its
`--horizontal`/`--vertical` modifiers (specificity beats the bare nav rule; the lane never carries
them) — `useSplitter`/`MiddleNavSplitter`/nav `splitter.css` are **untouched**. The View Control Rig
is resolved into the middle-nav footer band by `filesFooterFor` (composed after `channelFooterFor`).
The footer persists `zoom`; table column widths persist too (`LocalKeys.FILES_ZOOM` /
`FILES_COLUMNS`). **Also fixed (pre-existing, unrelated):**
`packages/ui/navigation/styles/index.css` `@import`ed a non-existent `./file-tree.css` (orphaned by
earlier uncommitted files work) — every dashboard route 500'd; the dead import was removed.
**Deviation flagged (surface, do not silently resolve):** the brief's `/attachments` "under
`/channels`" was implemented as a redirect to `/files` (Channels are the tree's top level), not a
distinct `/channels` route. | `PRODUCT_SPEC.md` §Unified Messaging / attachments ·
`packages/types/projects/files.ts` · `packages/backend/services/projects/files-fixtures.ts` ·
`apps/web/routes/api/projects/files.ts` ·
`apps/web/features/projects/{islands/{FileExplorer,ViewControlRig}.island,components/{FileCard,FileTable,
FileChannelTree,AttachmentPreviewModal,FilePreview,file-glyphs}.tsx,core/{view-state,file-model,FilesService,
files-ssr,files-footer-slot}}`
·
`packages/ui/{display/islands/VirtualGrid,fields/islands/{SortControl,ZoomSlider},
layout/islands/Splitter}.tsx`
·
`apps/web/routes/(dashboard)/projects/[projectId]/{files,attachments,[channelId]/{files,attachments}}.tsx`
· Decisions #10 / #31 |

| 33 | **Submissions explorer — `/submissions` (channel + project scope) (2026-07-20).** The 8th
thin-frontend/fat-backend read, and a near-twin of the File Explorer (Decision #32): the Submissions
canvas is the Files canvas PLUS a full-height sticky navigation **tree** (left, separated by a
single `--hairline` vertical divider, §B.4) and an interactive **breadcrumbs** bar atop the
workspace. New Zod SSOT **`@projective/types/projects/submissions`** (`SubmissionTreeNode`
[recursive `z.lazy`], `SubmissionUnit`, `SubmissionCrumb`, `SubmissionNote`/`SubmissionReview`,
`SubmissionListParams`/`Page`; file rows REUSE `FileItemSchema`, sort/filter reuse `FileSortKey`);
fat `ProjectBackendService.submissions` → thin `/api/projects/submissions` → client
`SubmissionsService` → SSR `resolveSubmissionPage`, gated by the SAME `PROJECTS_BACKEND_LIVE`.
Fixtures **derive** the deliverable hierarchy from `ProjectDetail` (stages + provider-side members →
tree; deterministic, unsigned-hash indices, fixed clock) — **no DB migration** (a read projection
over the eventual `submissions.*`/`files.*` tables, like `files`/`messages`). **Tree hierarchy**
(Part 3): project scope prepends **Stages** as tree roots, then Submitter (with profile **avatar**)
→ Unit (custom-name / ticket / timestamp) → nested directories; the **single-freelancer override**
collapses the submitter level (applied per stage in project scope). **Routing changed to a
WILDCARD** `[...path]` in both scopes (`…/submissions/[...path].tsx`; the old single-segment
`[channelId]/submissions.tsx` placeholder removed) so any tree node is a deep-linkable URL the
tree + breadcrumbs address; the project-scope static `submissions` segment precedes `[channelId]`
(never shadows a channel), and `activeTabOf` keeps the header's Submissions tab active on deep
paths. Tree + breadcrumb clicks re-scope via the thin service and sync the URL via
`history.pushState` (back/forward via `popstate`). **Zoom-driven grid⇄list (no toggle), Ctrl+wheel,
window-virtualized** — all REUSED from the File Explorer
(`FileCard`/`FileTable`/`FilePreview`/`AttachmentPreviewModal`/`view-state` zoom, shared
`FILES_ZOOM` key). Footer band = the **View Control Rig** (left) + a far-**right Review Submission**
trigger (Part 4; shown when an active unit is in view AND `viewerIsClient`), bridged to the explorer
via cross-island signals (`core/submissions-review.ts`, like the chat footer↔body pattern) and
resolved by `submissionsFooterFor` (composed after `channelFooterFor`/`filesFooterFor`). The
**review workspace modal** is a `layout/Splitter` (small context sidebar: freelancer card ·
Stage/Ticket/Notes tabs w/ badge · full-height tree — large workspace: media preview +
metadata/feedback, expand-fullscreen + open-in-new-tab), footered with **Request Revision** (blocked
until a text annotation OR global guideline is provided) / **Accept Submission**; mounted via
`BodyPortal` (glass-blur trap). New reusable `@projective/ui` **`navigation/TreeNav`** (chevron
disclosure, avatar/status slots) + a backward-compatible **`Breadcrumb` `command`** extension for
client-driven trails (§C.1 roster updated same change). **Splitter collision** discipline (Decision
#32) is INHERITED unchanged — `splitter.css` + the nav splitter are untouched; the modal reuses the
modifier-scoped layout `Splitter`. **Deviation flagged (surface, do not silently resolve):** the
task brief's per-file sender/profile shapes are the canonical `/@handle` (`profileHref`, Decision
#3), not a `/profiles/[id]` path. | `PRODUCT_SPEC.md` §Stage Management / Submissions ·
`packages/types/projects/submissions.ts` ·
`packages/backend/services/projects/submissions-fixtures.ts` ·
`apps/web/routes/api/projects/submissions.ts` ·
`apps/web/features/projects/{islands/{SubmissionExplorer,SubmissionViewControlRig}.island,components/{SubmissionTree,
SubmissionBreadcrumbs,SubmissionReviewModal,submission-glyphs}.tsx,core/{submission-model,SubmissionsService,
submissions-ssr,submissions-review,submissions-footer-slot}}`
· `packages/ui/navigation/{islands/TreeNav,
components/Breadcrumb}.tsx` ·
`apps/web/routes/(dashboard)/projects/[projectId]/{submissions/[...path],[channelId]/submissions/[...path]}.tsx`
· `DESIGN_SYSTEM.md` §C.1 · `ROUTING.md` · Decisions #10 / #31 / #32 |

| 34 | **Shared AudioVisualizer + Table sort config + attachment-modal & submission-card polish
(2026-07-20).** Four related enhancements over Decisions #31–#33 (presentation + one reusable
component; **no DB/lifecycle/business-rule change**). **(A) `@projective/ui/display`
AudioVisualizer.** The `.msg-audio` canvas waveform player (previously duplicated between the
projects `MessageAudioPlayer` and the composer `useWaveform`) is promoted to a reusable,
token-driven component
(`packages/ui/display/{islands/AudioVisualizer,core/audio,styles/audio-visualizer.css}`): play/pause
· a seekable rounded-bar `<canvas>` waveform (`role="slider"`) · an elapsed/duration clock · an
optional speed cycle, with a **dual transport** (a real `src` owns a hidden `<audio>`; an
absent/`"#"` source simulates progress over `durationMs` so stub fixtures still demo) and a
**two-tone `--wave-played`/`--wave-rest`** waveform that inherits from an ancestor (an "own" chat
bubble re-tints it) — the component sets **no** local `--wave-*` so the bubble's inherited values
win, and falls back to `--primary`/`--text-secondary` tokens in JS. `MessageAudioPlayer` is now a
thin adapter; the `FilePreview` audio branch renders it too, so the **attachment modal and the
review workspace** get a real player for free. The composer's live-scrolling `useWaveform` (a
distinct capture mode) stays. **(B) Table sort config.** The shared `Table` gains a per-table
**`multiSort`** flag (default `true`; `false` ignores Shift-click → single-column, still 3-state) so
the capability stays "available for future use". Files/Submissions keep the **bespoke `FileTable`**
(its zoom-view/window-virtualization/ `FILES_COLUMNS` resize are unchanged) but gain **3-state
single-column sort**: the header cycles asc→desc→**none**, where "none" **clears the active sort
key** (`sortKey=""` → `sort` omitted → the backend's default order) rather than widening
`FileSortDir` — chosen so the toolbar `SortControl`'s 2-state `direction` binding stays type-sound;
multi-sort is inherently off. **(C) Attachment modal.** The media stage is bounded
(`overflow:hidden` + `max-*:100%`) so a large preview never overlaps the left thumbnail tray; a
**"Go to Message"** aside link routes to the source message (`channelMessageHref` →
`/projects/{id}/{channel}/chat#m-{messageId}`, canonical channel namespace per Decision #22, anchor
best-effort into the virtualized feed); and a Submissions-context **client Notes area** (`notesMode`
prop, left panel) lets the reviewer jot review notes (session-local stub + `onSaveNote` for future
persistence). **(D) Submissions card drill-down** (executes Decision #33's Part 3 intent while
**keeping** its Stage-first hierarchy — children-as-cards, NOT a reorder): the Submissions workspace
renders the **current node's direct children as navigable cards/rows** (new `FreelancerCard` for
`submitter`, `SubmissionCard` for `unit`/`stage`/`dir`, `SubmissionNodeList` for list mode) and only
falls back to the file grid at a `unit`/`dir` leaf (or when a search/filter is active). So channel
scope leads with **Freelancer Cards** directly, and project scope drills **Stage → Freelancer Cards
→ Submission Cards → files**; clicking a card reuses the existing `navigate()`/pushState plumbing
(new pure `nodeAt`/`childNodesAt`/`nodeShowsChildCards` in `submission-model.ts`, no backend/Zod
change). Part 4's Client Review Workspace was already shipped by Decision #33 and is unchanged bar
the free audio upgrade. | `DESIGN_SYSTEM.md` §C.1 (display roster + Part-C) ·
`packages/ui/display/{islands/AudioVisualizer,core/audio,styles/audio-visualizer,islands/Table}` ·
`apps/web/features/projects/{components/{MessageAudioPlayer,FilePreview,AttachmentPreviewModal,FileTable,
FreelancerCard,SubmissionCard,SubmissionNodeList},core/{chat-context,submission-model},islands/{FileExplorer,
SubmissionExplorer}.island,styles/{attachment-modal,file-table,submission-card,chat-feed}.css}`
· Decisions #22 / #31 / #32 / #33 |

| 35 | **Kanban Board system + reusable DnD/Kanban primitives (2026-07-20).** Two NEW
`@projective/ui` sub-paths land the reusable layer the board needs. **`@projective/ui/dnd`** is a
dependency-free **Pointer-Events** drag-and-drop kit — NO native HTML5 `draggable`, NO external
library (root CLAUDE.md §3 · PRODUCT_SPEC §Libraries · SYSTEM_ARCHITECTURE §KanbanBoard): a
`DndContext` island (pointer sensor w/ movement threshold + capture-phase click-suppression;
keyboard sensor Space/Arrows/ Enter/Escape) over a signal-first store,
`Draggable`/`Droppable`/`SortableContext`(=`SortableContainer`)/ `DragOverlay` (ghost via
`BodyPortal`), the `useDraggable`/`useDroppable`/`useSortable`/`useDndMonitor` hooks, pure collision
detectors, an `aria-live` announcer + reduced-motion collapse. **`@projective/ui/
kanban`** is a
generic **controlled** `KanbanBoard` (+`KanbanColumn`/`KanbanCard`) — it emits
`KanbanItemMove`/`KanbanColumnMove` and NEVER mutates the model, so a consumer commits immediately
or intercepts behind a modal. The feature (10th thin/fat read) is
`BoardService`→`/api/projects/board` (thin)→`ProjectBackendService.board` (fat, fixtures derived
from `ProjectDetail`, gated by the SAME `PROJECTS_BACKEND_LIVE`), Zod SSOT
**`@projective/types/projects/board`** (`TicketStatus`, `BoardCard`, `BoardColumn`, `BoardView`,
`BoardPage`, `CreateTicket`, the shared `cardColumnId`/`buildBoardColumns`). **Two boards, one
contract:** the project pipeline `/projects/[id]/board` (columns = New + each Stage + Completed;
stage columns reorder → confirm modal; New/Completed frozen; a Stages⁄Status view toggle) and the
stage Tasks board `/projects/[id]/[channel]/tasks` (columns = ticket-status lanes, fixed; create in
New only). Moves are OPTIMISTIC (persistence deferred); three pre-move warnings gate the
irreversible side-effects — stage reorder (workflow sequence), claimed-ticket move (full
charge/escrow payout), and revision (moving into a completed stage → active revision ticket). The
2-panel ticket modal enforces the **purchasing gate** (Title creates a draft; a Description is
required before purchase/claim) with a checkbox + drag-reorder stage selector (reuses `dnd`) and
per-stage overrides; the footer rig (`boardFooterFor`) hosts Kanban⁄List · Stages⁄Status · Create
Ticket · Create Stage · Add to Basket/Checkout, bridged to the body via `board-state.ts` signals.
`CreateStageModal` extended additively (Title + rich Description, `BodyPortal`-wrapped; `onCreate`
broadened to `{name,description}` — the one ProjectSidebar caller updated). Toolbar mirrors `/files`
(search · Priority · Assignee · Sort). No DB migration (a read projection over the live
`projects.tickets`/`project_stages` + `move_ticket`/`reorder_stages` RPCs). **Flagged (surface, do
not silently resolve):** the task brief's stage-board column names **New / Ready / In Progress /
Review / Completed** are a THIRD vocabulary that matches neither canonical source cleanly —
reconciled here as the canonical `ticket_status` enum as the DATA model (New=`backlog`,
Ready=`todo`, In Progress=`in_progress`[+`claimed` folded], Review= `in_review`,
Completed=`completed`; `cancelled`/`reported_hidden` are card OVERLAYS, not columns) with brief
DISPLAY labels; `New` is canonically the backlog column (PRODUCT_SPEC §Ticket Ordering), `Ready`↔
`todo` is the ambiguous relabel — confirm with a human. Also flagged: PRODUCT_MANAGEMENT §6 lists
the BUILD-TRACKER's Kanban columns (Backlog·Ready·Claimed·In Progress·Review·Complete), which are
NOT the product `ticket_status` board columns — a §6 clarifying note was added in the same change. |
root CLAUDE.md §5 · `PRODUCT_MANAGEMENT.md` §6 · `DESIGN_SYSTEM.md` §C.1 ·
`packages/ui/{dnd,kanban}/` · `packages/types/projects/board.ts` ·
`packages/backend/services/projects/board-fixtures.ts` · `apps/web/routes/api/projects/board.ts` ·
`apps/web/features/projects/{islands/{ProjectBoard,
BoardViewControlRig}.island,components/{TicketCard,BoardColumnHeader,TicketModal,BoardWarnings,
TicketListView,CreateStageModal,board-glyphs},core/{board-model,BoardService,board-ssr,board-state,
board-footer-slot}}`
· `apps/web/routes/(dashboard)/projects/[projectId]/{board,[channelId]/tasks}.tsx` · Decisions #10 /
#21 / #32 / #33 |

| 36 | **Public Profile Page — `/[handle]` (2026-07-21).** The 11th thin-frontend/fat-backend READ:
the comprehensive profile shell for every entity (individual/client · freelancer · team · business)
resolved by `@handle`. Zod SSOT **`@projective/types/profile`** (`ProfileView` —
banner/avatar/story/ skills/languages/notable-clients + DUAL-track reputation + verification tiers +
per-tab metrics; the entity-driven `ProfileTab` matrix + `ProfileTabPayload`; the shared
**reserved-handle denylist**). Fat `ProfileBackendService.{overview,tab}` → thin
`/api/profile/[handle]` → client `ProfileService` → SSR `resolveProfile`/`resolveProfileTab`, gated
by the SAME-shaped **`PROFILE_BACKEND_LIVE`** (default off, `isProfileBackendLive()`). Fixtures
**derive** every profile + tab deterministically (handle hash, no RNG) from the existing discovery
corpus (`@projective/backend/services/explore`), re-owned to the profile — so a profile always
agrees with the explore card that linked to it; **no DB migration** (a read projection over the
eventual `org.users_public` + profile tables, like `detail`/`messages`/ `files`) → no
`documentation/database/*` change. **Shell upgrade:** `routes/[handle]/_layout.tsx` moved from a
bare guest `AppShell` to the **middle-nav frame** — authed → the unified `UserShell`; guest →
`AppShell(persona=guest)` + `MiddleNav` — both hosting the contextual **`ProfileActionLane`**
(mirrors `ui-app-shell__sidebar`: Back-from-explore · Share · Follow · Hire/Message · Availability +
collapse toggle; two presentations switched by `.ui-splitter[data-mode="collapsed"]` + the shared
`MIDDLE_LANE_TOGGLE_EVENT`, exactly like `ProjectSidebar`) and a **scroll-migrated sticky header**
in the `ui-middle-nav__header` band (the body `ProfileHeader`'s window-scroll probe flips a shared
`headerCondensed` signal; the band reveals via **`max-block-size`** — `block-size` is overridden by
the frame's grid/flex layout context, so min/max-block-size are the only honoured height
constraints; jump-to-final under reduced-motion). **Layout:** Overview (`/[handle]`, index) is the
split view — inline-editable story + skills + languages + notable clients (left) · sticky meta rail
(live local time/tz, online status, location, dual reviews, response time, verification badges)
(right); every other tab renders **full-width** (the meta rail is Overview-only). **Tabs** are a
SINGLE dynamic `[handle]/[tab].tsx` route (a static `availability.tsx` shell + `view/[item].tsx` win
over it), each validated against the profile's kind matrix (a client can't open a freelancer-only
tab); item grids **reuse the explore cards/collections** (Services grid · Products/Portfolio masonry
· Projects list w/ Open+Past sub-views · Articles list) + the toggleable `DataView` for
Teams/Businesses; the legacy placeholder `reviews.tsx`/`portfolio.tsx` were **removed**. **Owner
experience** (gated on the hydrated `UserContext` handle/userId matching the profile): the lane
shows Edit-profile + always-visible Settings; Edit-profile toggles a shared `editMode` that swaps
the lane to the management tabs + Profile/Availability/Settings quick-links; **inline editing needs
no edit mode** — the story is a single-click auto-resizing `Textarea` and each creatable tab header
carries an owner "+ New …" trigger opening a stub `Dialog`. No new `@projective/ui` primitive
(reuses `DataView`/`Textarea`/`Dialog`/ `Avatar`/`RatingStars`/`Tooltip`) → no `DESIGN_SYSTEM.md`
§C.1 change; no lifecycle change → no `PRODUCT_MANAGEMENT.md` change. **Deviation flagged (surface,
do not silently resolve):** the profile's own entity kind comes from the fixtures; the
**reserved-handle denylist** is a defensive safeguard on top of Fresh's static-route precedence
(ROUTING.md §Reserved-handle precedence) — a future "claim a handle" flow must validate against
`isReservedHandle` server-side. | `ROUTING.md` §Reserved-handle precedence / §Global routing rules ·
`PRODUCT_SPEC.md` §Sitemap (`/[handle]`) · `packages/types/profile/` ·
`packages/backend/services/profile/` · `packages/backend/core/{env,supabase}.ts` ·
`apps/web/features/profile/` ·
`apps/web/routes/[handle]/{_middleware,_layout,index,[tab],availability}.tsx` ·
`apps/web/routes/api/profile/[handle].ts` · Decisions #3 / #10 / #16 / #32 |

| 37 | **Calendar & Schedule system + reusable `@projective/ui/calendar` engine (2026-07-21).** A
NEW, high-performance, interactive Calendar & Schedule engine (Google-Calendar / Monday.com
inspired), and its wiring to four routes. **The reuse point is the UI engine** (as the task
mandates): a NEW 13th `@projective/ui` sub-path **`@projective/ui/calendar`** — generic,
**controlled**, **zod-free**, token-only, portable. The `Calendar` island is a two-panel shell: a
left panel (`MiniMonth` mini-map, hover-tints a whole week ~15% + click-jumps · `AvailabilityPanel`
working hours/timezone-clock/blackouts)

- a main viewport (`CalendarHeader` view-switch/nav/search/privacy-safe integration chips over a
  `TimeGrid` [Day/Week] or `MonthGrid`). `useCalendarViewport` owns the engine — **virtualized**
  hour cells, initial scroll centred on the time-scale (now if today is in view, else noon; ±3h
  overscroll pad for seamless cross-midnight scroll), **Ctrl+wheel** zoom that scales px-per-hour in
  place AND transitions Day↔Week↔Month across thresholds, middle-mouse / Ctrl-drag 2D **pan**
  (`preventDefault` → no native autoscroll/page-zoom), a return-to-present pill; `packDayEvents`
  resolves overlaps into fractional side-by-side columns; the `calendarTime` matrix utils are
  **timezone-explicit** (`Intl`, SSR==island). Privacy masking (§Part 1.4): external-integration +
  general-availability blocks render ONLY Available/Busy/Tentative; public group sessions show an
  attendee counter. **The DATA is a NEW leaf Zod domain `@projective/types/scheduling`**
  (`CalendarEvent`/`AvailabilityRule`/`BlackoutDate` + `CalendarPage`/`SchedulePage` envelopes +
  params) — imports nothing from projects/profile/explore, so no cycle. **No new env gate:** each
  read rides its OWN domain's existing switch via the new fat `ScheduleBackendService`
  (`@server/services/scheduling/`): the project/channel calendar behind `PROJECTS_BACKEND_LIVE`
  (derived from `ProjectDetail` — stage syncs/review milestones/deadlines + session-format
  sessions), `@handle` availability behind `PROFILE_BACKEND_LIVE` (weekly working
  hours/blackouts/masked slots — only freelancers bookable, buyer-only orgs get hours-only per
  Decisions #9/#10), an entity schedule behind `EXPLORE_BACKEND_LIVE` (recurring session slots +
  attendee counts). Fixtures DERIVE deterministically (shared fixed clock `NOW=2026-07-17T16:20Z`,
  unsigned `>>>` hash, timezone-aware `Intl` slot placement) so a calendar agrees with the
  sidebar/card that opened it — NO DB migration (a read projection over the eventual `scheduling.*`
  tables, like `detail`/`messages`). A new cross-cutting feature **`apps/web/features/calendar/`**
  (thin `ScheduleService` → `/api/scheduling/*` routes → SSR resolvers) hosts the surface islands
  (`ProjectCalendar`, `ScheduleView`) + the **stub-first** booking/creation `EventDialog` (a created
  event / booked slot is session-local; real session checkout is deferred). **Routes wired:** filled
  the channel `calendar.tsx` (was a `ChannelTabBody` stub) + created project `calendar.tsx`; filled
  `[handle]/availability.tsx` (was a placeholder); **refactored** `(public)/view/[entity].tsx` →
  `[entity]/index.tsx` + added `[entity]/schedule.tsx` (`/view/[entity]/schedule`);
  `middleNavFooterFor` unchanged (the calendar owns its controls in its own header, no footer band).
  **New domain flagged (surface, do not silently resolve):** `@projective/types/scheduling` +
  `ScheduleBackendService` are the first read that spans three existing domains' data; the
  RLS-scoped `scheduling.*` tables + external-calendar (Google/Outlook/Apple/Samsung/Notion) sync
  are the live-path TODO — reconcile the table design with a human when it lands. Verified
  end-to-end (all four routes;
  events/masking/attendee-counts/working-hours/centered-scroll/view-switch/search/booking/click-create/mini-map-jump).
  **Refined (2026-07-21):** (a) the **Day** view is now a genuinely INFINITE, virtualized continuous
  multi-day timeline (`packages/ui/calendar/components/DayTimeline.tsx`) — scrolling flows
  seamlessly past midnight into adjacent days endlessly (a ~4-year elapsed-time axis, only
  viewport-days rendered → fixed DOM cost, DST-correct via zoned day arithmetic; inline date
  markers; the centred day tracks back to the header + mini-map). The Week view stays the bounded
  time-of-day grid. `useCalendarViewport` gained a `sync` (exposed `scrollTop`/`viewportH`) so a
  PROGRAMMATIC scroll re-syncs the virtualization signal immediately (a hidden/background tab defers
  the `scroll` event, which had left the timeline virtualizing the wrong day-window). (b)
  `/[handle]/availability` is now a FULL-PAGE calendar with its OWN layout — the
  `[handle]/_layout.tsx` special-cases the `availability` segment (like the `view` item-viewer) to
  bypass the profile chrome entirely (no ProfileHeader/tabs/meta-rail/action-lane) and fill the
  content region under the top bar (`ScheduleView fullPage` → `.cal-surface--full`). | root
  CLAUDE.md §2/§3/§10 · `DESIGN_SYSTEM.md` §C.1 / Part C · `PRODUCT_SPEC.md` §Sessions ·
  `packages/ui/calendar/` · `packages/types/scheduling/` · `packages/backend/services/scheduling/` ·
  `apps/web/features/calendar/` · `apps/web/routes/api/scheduling/*` ·
  `apps/web/routes/(dashboard)/projects/[projectId]/{calendar,[channelId]/calendar}.tsx` ·
  `apps/web/routes/[handle]/availability.tsx` ·
  `apps/web/routes/(public)/view/[entity]/{index,schedule}.tsx` · Decisions #3 / #9 / #10 / #32 /
  #36 |

| 38 | **Unified floating-glass GuestShell (2026-07-21).** Guests previously saw **two** divergent
chromes — the marketing megamenu `SiteHeader` inside `.site` (on the `(public)` routes) and
`AppShell persona="guest"` (a full-bleed glass `ui-shell-topbar`, no sidebar) + a framed `MiddleNav`
lane (on `/[handle]`). Both are unified into ONE floating shell, `GuestShell`
(`apps/web/features/shell/`), the guest counterpart of `UserShell`, used verbatim by the `(public)`
layout and the guest branch of the `/[handle]` layout: the **unchanged** `SiteHeader` (full-width →
glass pill on scroll, megamenus intact — product-owner directive) over a **full-bleed body**, plus a
route-driven **floating glass side nav** (`GuestAside` wrapping the route lane — `position: fixed`,
glass, **no drag splitter handle**; collapse is the lane's own footer toggle via the shared
`MIDDLE_LANE_TOGGLE_EVENT`, cached under `LocalKeys.GUEST_NAV_COLLAPSED`, pre-painted to
`:root[data-guest-nav]` like the authed `:root[data-sidebar]`) and a route-driven **floating glass
sub-header** (the profile `ProfileStickyHeader`). **Authenticated navigation (`UserShell`) is
untouched.** Side nav is route-driven (today only `/[handle]`); `/` and `/explore` stay
header-+-body only, structurally identical to before (the shell reuses the marketing
`.site`/`.site__main` base). Both floating panels put their `backdrop-filter` on a `::before`
underlay so the lane's `position: fixed` kebab Popover is not re-based (the fixed-overlay trap,
Decisions #8/#9). The profile chrome's sticky offsets (written for the authed frame's
`--shell-topbar-h + --shell-midnav-header-h`) are re-based to `--site-header-h` under
`.guest-shell`. `/projects` + `/files` stay behind the `(dashboard)` guard (guests are bounced to
`/login`) — that guard is unchanged. No DB/lifecycle change. | `DESIGN_SYSTEM.md` Part D (matrix
#1/#3 + new §D.5) ·
`apps/web/features/shell/{components/GuestShell,islands/GuestAside.island,styles/guest-shell.css}` ·
`apps/web/routes/(public)/_layout.tsx` · `apps/web/routes/[handle]/_layout.tsx` ·
`apps/web/routes/_app.tsx` · `apps/web/utils/storage-keys.ts` ·
`apps/web/features/profile/styles/profile.css` · Decisions #8 / #9 / #14 / #15 / #27 / #31 |

| 39 | **Explore & Search visual overhaul — lean cards + bounded fill-grid layout engine
(2026-07-21).** Reworks `/explore` State A (Home) + State B (Search Results) presentation after a
design audit found starved carousels (2–3 curated items stranded a half-empty row), an over-tall
9-band Service card, and a cramped 5-up isolated results feed. **(A) Card architecture.**
`ServiceCard` drops from **9 bands to 4** — a wide **16:10** media carrying ONE glass
engagement-type chip (`.ex-media__type`, replacing the in-body type eyebrow AND the redundant
category tag); the title; a single owner+rating **byline** (`.ex-card__byline`); the
price/turnaround foot. The description snippet + skill-tag row move to the detail view.
`ProductCard` folds owner+rating into the same byline; `ProfileBannerCard` drops its skill-pill
band. All media cards gained **image-zoom-on-hover** (scale within the `overflow:clip` frame) atop
the existing lift, and every `.ex-card` now **explicitly fills its cell** (`inline-size:
100%`) —
lean cards no longer rely on wide text to stretch a flex cell (the regression that squeezed a byline
to 537px tall). **(B) Layout engine.** The four Home **profile carousels** (`EntityCarousel`,
DELETED — fixtures supply only 2–3 items each, so a carousel could never fill) become a bounded fill
grid **`ProfileGrid`** (library `Grid` auto-fit + new `maxCols` cap) that stretches N≤cols curated
cards to fill the row evenly (wide banner cards go 1-per-row ≤900px); `ServicesGrid` widened to
`minChildWidth 18rem`/`maxCols 4`. The State B isolated feed's hard **5 columns → responsive 2/3/4**
(`feedCols`: 3 with the sidebar, 4 when hidden or ≥1600px), capped so cards stay comfortably wide;
grouped rails, products masonry, and the projects list are unchanged (they already fill/peek). Home
section vertical rhythm tightened ~20%. **(C) packages/ui.** `Grid` gained a column-capped auto-fit
(`maxCols`, pure-CSS RAM formula in `grid.css`; DESIGN_SYSTEM §C.1 roster updated same change).
**CSS gotcha (surface, do not silently resolve):** shared `@projective/ui` component CSS reaches a
page ONLY through a CLIENT/island bundle (the umbrella is a resolved dependency, so its transitive
`import
"./x.css"` side-effects are collected from the island graph, NOT the SSR render — app-local
`explore.css` is fine; `tag.css`/`grid.css` ride the nav-shell islands). The deleted carousel island
was Home's sole carrier for `avatar.css`+`rating-stars.css`; a zero-UI **`CardStyleAnchor`** island
now anchors them once per Explore page (State B already gets them via
`SearchDashboard`→`EntityCard`). A route-level CSS-manifest fix in the Fresh/Vite plugin is the real
TODO. No DB/lifecycle/business-rule change (pure presentation). | `DESIGN_SYSTEM.md` §C.1 ·
`packages/ui/layout/{components/Grid.tsx,
styles/grid.css}` ·
`apps/web/features/explore/{components/{cards/{ServiceCard,ProductCard,
ProfileBannerCard},collections/{ProfileGrid,ServicesGrid},ExploreHome,ExploreScreen},islands/
{SearchDashboard,CardStyleAnchor},styles/explore.css}`
· Decisions #12 |

| 40 | **Search filters relocated to the nav sidebar + guest full-width footer (2026-07-22). AMENDS
#38.** Two coupled changes. **(A) Filters → navigation sidebar.** The `/explore` Search Results
(State B) facet `FilterPanel` moved OUT of the results body into the navigation rail: the **guest
floating `ui-guest-aside`** for signed-out visitors, the **authed middle-nav lane**
(`ui-splitter__body`) for signed-in ones. `(public)/_layout.tsx` resolves the lane per-URL via
`exploreFilterLaneFor(url)` (mirrors `laneFor`/`channelHeaderFor` — State B on `/explore` only) and
threads it into GuestShell/ UserShell's existing `lane` prop. The relocated `ExploreFilterLane`
island is a separate hydration root from `SearchDashboard` (which still owns query state +
fetching), so they sync through a cross-island signal **bridge** (`core/filter-bridge.ts`:
`bridgeParams` published by the dashboard + `bridgeCommit` its fetch entry-point) — the lane
SSR-paints from its own `initialParams` (no flash) then tracks live params, and a facet change there
commits through the SAME path (real-time, shareable URL). The dashboard's in-body desktop sidebar +
show/hide toggle were removed; the **mobile bottom-sheet filters stay** (no aside on mobile).
`feedCols` dropped its `roomy`/`filtersHidden` input (steady 3/4 desktop, 2 tablet/mobile). Shared
`withFilter`/`activeFilterCount` hoisted to `explore-state.ts`. **(B) Guest full-width footer +
in-flow aside.** On lane routes GuestShell switches to a **flex column**: the aside + body sit in a
growing `.guest-shell__region` above a **full-width `PublicFooter`** (a sibling of the region, so it
spans the whole window instead of inheriting the aside gutter, pinned to the bottom by
`flex: 1 0 auto` + `.site` `min-block-size: 100dvh`). `.ui-guest-aside` changed from
`position: fixed` → **`position: sticky`** (in-flow flex item), so it pins below the header while
scrolling and **terminates cleanly above the footer** (bounded by the region) instead of overlapping
it — verified aside-bottom == footer-top at max scroll on both guest search + profile. Lane-**less**
routes (`/`, Explore Home) keep the original block flow + in-body footer, byte-identical. The filter
lane forces the aside expanded (`:root .guest-shell:has(.ex-filters-lane)`, no collapse toggle);
mobile hides the desktop panels (unchanged). No DB/lifecycle/business-rule change (pure FE
relocation + layout). | `DESIGN_SYSTEM.md` Part D / §D.5 · `apps/web/routes/(public)/_layout.tsx` ·
`apps/web/features/explore/{islands/
{SearchDashboard,ExploreFilterLane}.island,core/{filter-bridge,explore-lane-slot,explore-state},
styles/explore-results.css}`
· `apps/web/features/shell/{components/GuestShell,styles/guest-shell.css}` · Decisions #14 / #31 /
#38 |

| 40 | **Profile — Organisation entity kind + tab-bar overflow + color-coded languages
(2026-07-22).** Four refinements to the `/[handle]` profile (no DB migration — the profile stays a
read projection over fixtures, like Decision #36). **(A) New `organisation` profile kind.** Extends
the SSOT `ProfileKind` enum (`@projective/types/profile`) with a fifth, **buyer-only,
department-structured** entity (consistent with the buyer-only Organisation rule of Decisions
#9/#10/#16 — the `organisation` context, now surfaced AS a profile). Its tab matrix is Projects ·
**Departments** · **Members** · Articles · Businesses · Reviews (no seller
Services/Products/Portfolio). A new `departments` tab (`ProfileTab` enum) + `DepartmentEntry`
schema + `MemberEntry.departments[]` (multi-department assignment) + `ProfileMetrics.departments`
land in the SSOT; fixtures **derive** organisations deterministically from the handle (a NAMED set —
`@northwind`/`@meridian`/`@atlasgroup` — plus an open `org-*` convention), building departments and
members **together** so a department's `memberCount` and its members always agree. **(B)
Department-grouped Members view** — organisation Members render grouped by department; a member in
multiple departments appears under EACH with multi-department chips on the card (root CLAUDE.md —
Part 2.2). **(C) Tab-bar overflow (Part 3).** `ProfileTabs` became an **island**: **Reviews is
always pinned last** on the right with its own glyph (a latent bug — the `reviews`/ `members` tabs
had NO glyph, `tabGlyph` returned the raw tab name with no matching path — is fixed by real
`reviews`/`departments` glyphs); a non-passive `wheel` listener translates vertical wheel delta into
`scrollLeft` (hidden scrollbar, `overflow-x:auto`) so tabs never clip; and when a kind has **>6**
tabs the secondary ones collapse into a portal **`More ▾`** `Popover` while the key tabs (Services ·
Projects · Portfolio) + Reviews stay visible (`arrangeTabs` in `profile-model.ts`). **(D)
Entity-type badge (Part 1)** — an explicit icon+label chip per kind (Freelancer · Client · Team ·
Business · Organisation, `ENTITY_META`/`EntityBadge`) beside the `@handle`. **(E) Color-coded
language proficiency (Part 4)** — the split `Language ⁄ Proficiency` pill tints by level, token-only
(`data-level`): Native → `--success` (green), Fluent → `--secondary` (cyan), Professional → neutral
slate, Conversational/ Basic → `--warning` (amber); the language generator now ramps levels by
position so the ladder is legible. No `@projective/ui` primitive added (reuses
`Popover`/`Tooltip`/`Avatar`) → no `DESIGN_SYSTEM.md` §C.1 change. **Deviation flagged (surface, do
not silently resolve):** the task named the entity types as
Freelancer/Team/Business/**Organisation** (omitting the existing individual `client` kind) —
resolved by KEEPING `client` (individual buyer, badge "Client") AND adding `organisation`, so both
get a badge; reconcile with a human if `client` was meant to be folded into `organisation`. |
`PRODUCT_SPEC.md` §Sitemap (`/[handle]`) · `packages/types/profile/{profile,tabs,
reserved}.ts` ·
`packages/backend/services/profile/profile-fixtures.ts` ·
`apps/web/features/profile/{core/profile-model,components/{profile-glyphs,ProfileBadges,ProfileTabContent,
ProfileAbout},islands/{ProfileHeader,ProfileTabs}.island,styles/profile.css}`
· Decisions #9 / #10 / #16 / #36 |

| 41 | **Explore/Search layout, pricing & density pass (2026-07-22).** Fixes the `/explore` +
`/explore?category=…` layout bugs and refines card economics after the Decision #39 visual overhaul.
**(A) Isolated feed rewrite.** The State-B single-category feed (`UnifiedFeed` in
`SearchDashboard.island`) dropped the fixed-row-height `VirtualScroller` uniform grid — whose
per-entity `ROW_HEIGHT` estimates were stale after the lean-card redesign, so cards TALLER than the
estimate overlapped (services, products) and cards SHORTER stranded whitespace (teams/users/
businesses) — for a NATIVE, entity-appropriate layout: a responsive fill grid (library `Grid`
auto-fit

- `maxCols` 4, per-entity `minChildWidth`) for card entities, a CSS multi-column **masonry** for
  products (variable-height cards interlock, no absolute-position overlap), and a hairline-divided
  list for projects (tightened `.ex-projrow` block padding `space-5`→`space-4`). Every card computes
  its own height, so rows never overlap or gap. Infinite paging moved from the virtual `onReachEnd`
  to an **IntersectionObserver** tail sentinel (`rootMargin 800px`) → the same `loadMore`; the
  `feedCols`/ `ROW_HEIGHT` breakpoint tables + `isTablet`/`isWide` signals were removed. (Verified:
  uniform widths/ heights, 0 overlaps across services/talent/products/projects; the paging data path
  returns page 2 — the IO callback only mis-fires in the hidden preview tab, not a real browser.)
  **(B) Home section merge.** The separate "Freelancers" + "Teams" Home sections became one
  **"Freelancers & Teams ready to help"** section (`ProfileGrid kind="freelancers"` over
  `[...freelancers, ...teams]`, `limit` 8 — the `FreelancerCard` already renders both). **(C)
  Engagement-model pricing.** New optional `ticketPrice`/`sessionPrice` on the Zod SSOT
  `ServiceItemSchema` (a read projection over fixtures — NO DB migration, like Decision #12);
  `servicePricing()` shows **Pipeline** as a per-ticket RANGE (`0.5×`–`2.0×` the standard ticket
  price, e.g. `$120 – $480 / ticket`), **Session** as `$X / session`, and **One-Off** as the fixed
  `price`. Consumed by `ServiceCard` + `DetailPanel`; `query.ts priceValue` sorts pipelines by their
  low-intensity floor. **(D) Promoted badges.** A subtle glass `PromotedBadge` (`.ex-promoted`
  dot+label) in a new top-left overlay flag stack (`.ex-flags`, which now also hosts the service
  type / product price chip — de-absolutised so they stack) on Service/Product/Profile/ Freelancer
  cards gated on the existing `sponsored` flag (a service, product, and freelancer fixture marked
  sponsored for demonstration; projects keep their inline "Promoted" text). **(E) Single-star
  ratings.** `@projective/ui` `RatingStars` gained a `compact` prop (one primary star + score, for
  dense bylines; §C.1 roster updated same change); the explore card bylines + the feature
  `RatingTracks` star now render one glyph instead of five. Pure presentation + additive Zod/UI — no
  lifecycle/business-rule change. | `DESIGN_SYSTEM.md` §C.1 · `packages/types/explore/items.ts` ·
  `packages/backend/services/explore/{fixtures,query}.ts` ·
  `packages/ui/display/{components/RatingStars,styles/rating-stars.css}` · `packages/ui/layout/Grid`
  ·
  `apps/web/features/explore/{islands/SearchDashboard.island,
components/{cards/{ServiceCard,ProductCard,FreelancerCard,ProfileBannerCard},ExploreHome,PromotedBadge,
RatingStars,DetailPanel},core/pricing,styles/{explore,explore-results}.css}`
  · Decisions #12 / #39 |

| 41 | **Entity View pages — `/view/[id]` Amazon-style item viewer (2026-07-22).** The 12th
thin-frontend/fat-backend READ, and a full rebuild of the public standalone item page (the Explore
click-matrix + Search-drawer "Open full page" destination). The prior centred
`EntityView`/`DetailPanel` reading frame is replaced by a NEW cross-cutting feature
`apps/web/features/view/` with three regions: **(Part 1) Amazon-style hero** — a `MediaGallery`
island (vertical thumbnail strip that HOVER-swaps the large showcase image, a trailing "+N" overflow
button, and a click-to-zoom **lightbox** modelled on `fx-modal__panel`: `BodyPortal`-mounted
[glass-blur trap], high-res click-to-zoom, carousel nav, tray, and `Esc`/`←`/`→` shortcuts) beside
an entity-overview column (`ViewDetails`: eyebrow · title · badge tags · creator profile-header card
→ `/[handle]` · a rating summary that jumps to the reviews section · description + key specs).
**(Part 2) Sidebar action lane** — `ViewActionLane` island REUSES the profile lane's `pf-lane`
skeleton VERBATIM (the same `pf-lane__header` + collapse toggle + the
`.ui-splitter[data-mode]`/`:root[data-guest-nav]` density reveals) so it drops into `ui-guest-aside`
(guests) and `ui-middle-nav__lane` (users) identically; on it: the resolved pricing block, the
stacked Buy · Add-to-basket · Message CTAs (basket state synced + `localStorage`-persisted
cross-island via `core/basket-state.ts`, `LocalKeys.BASKET`), and the operational trust chips.
Resolved by a new URL-keyed slot resolver `viewLaneFor(url, authed)` (mirrors
`exploreFilterLaneFor`/`laneFor`) composed into BOTH the `(public)` and `[handle]` layouts.
**(Part 3) Lower body** — `RelatedRail`×2 (More-by-creator + Similar, reusing the explore
`EntityCard`s in a scroll-snap rail) + a `ReviewsPanel` island (aggregate average · dual-track
meters · a clickable 5★→1★ distribution filter · recent/highest/lowest sort · reciprocal +
verified-engagement badges). New Zod SSOT **`@projective/types/explore/view.ts`** (`EntityView`,
`EntityMedia`, `EntityPricing`, `TrustFact`, `ReviewSummary`, `EntityReview`, `ReviewDistribution`);
fat `ExploreBackendService.viewPage(id)` DERIVES the gallery (item media/cover/ highlights + a
deterministic pool), pricing (matching `pricing.servicePricing` EXACTLY — per-ticket `0.5×–2.0×`
Pipeline range · per-session · fixed — so the page agrees with the card that linked to it), trust,
cross-sell rails (same-owner / same-type+category), and reviews **deterministically** (unsigned
`>>>` hash + fixed clock, no RNG) from the existing discovery corpus — **no DB migration** (a read
projection over the eventual discovery + reviews tables, like `detail`/`messages`/`files`); rides
the SAME `EXPLORE_BACKEND_LIVE` gate. Both `/view/[id]` and `/[handle]/view/[id]` repointed to the
new `EntityViewScreen` (ctx-scoped back links + card deep-links); the now-dead explore
`EntityView.tsx` removed (`DetailPanel` stays — still the Search-drawer body). No new
`@projective/ui` primitive (reuses Avatar/RatingStars/Tag/Backdrop/BodyPortal/Popover/Tooltip) → no
§C.1 change; no lifecycle change → no `PRODUCT_MANAGEMENT.md` change. **Deviation flagged (surface,
do not silently resolve):** the "Message" CTA deep-links `/messages/dm-{handle}` (canonical DM
namespace) and is auth-gated (guests → `/login?
redirectTo`); **Buy now + checkout are STUBS**
(add-to-basket + a status note) until the `/api/basket` + checkout routes land. | `PRODUCT_SPEC.md`
§Sitemap (`/view`) · `packages/types/explore/view.ts` ·
`packages/backend/services/explore/{view-fixtures,ExploreBackendService}.ts` ·
`apps/web/features/view/` · `apps/web/routes/(public)/view/[entity]/index.tsx` ·
`apps/web/routes/[handle]/view/[item].tsx` · `apps/web/routes/{(public),[handle]}/_layout.tsx` ·
`apps/web/utils/storage-keys.ts` · Decisions #10 / #12 / #36 / #39 |

| 42 | **Profile tab partials + width-aware `pf-tabs` overflow + menu/carousel polish
(2026-07-22).** Four presentation refinements to the `/[handle]` profile (no
DB/lifecycle/business-rule change — the profile stays a read projection over fixtures, like Decision
#36). **(A) Tab partial views.** The monolithic `ProfileTabContent` render-dump was split into
focused per-tab partial components under a new `apps/web/features/profile/components/tabs/` folder
(`ServicesTab` · `ProductsTab` [also Portfolio] · `ProjectsTab` · `ArticlesTab` · `EntitiesTab`
[Teams/Businesses] · `EducationTab` · `ExperienceTab` · `MembersTab` [flat + org department-grouped]
· `DepartmentsTab` · `ReviewsTab` + shared `Empty`/`formatDate` + a `mod.ts` barrel);
`ProfileTabContent` is now a thin dispatcher (panel header + routing table). The **Availability**
page stays a standalone full-page calendar (Decision #37, untouched). **(B) Genuinely width-aware
`pf-tabs` overflow — REFINES Decision #40.** `ProfileTabs` dropped #40's static
`TAB_OVERFLOW_THRESHOLD` (6) + `PRIORITY_TABS` heuristic for real measurement: a `ResizeObserver` on
the strip + a one-time cache of each tab's natural width fit **as many tabs as the live container
width allows**, collapsing the rest into the `More ▾` popover — recomputed on every resize (verified
via a width simulation: 439px→2 visible, 700px→4, 1000px→7, 1467px→all-9-no-More). The **`More ▾`
trigger now sits on the absolute far right** of the bar (`margin-inline-start:auto`; verified flush
at the bar's right edge, rightmost). **Reviews stays pinned** (Decision #40 intent) as the last
always-visible content tab, immediately left of More (a `.pf-tabs__item--trailing ~ --more` rule
zeroes More's auto-margin so the two sit together at the right). All tabs render inline at SSR/no-JS
(graceful fallback; the collapse is client-measured). `arrangeTabs` was simplified to return
`{ content, trailing }`. **(C) Menu simplification.** The tab-overflow menu and the action-lane
kebab now render their items **directly inside `ui-popover__content`** — the intermediary
`.pf-tabs__menu` / `.pf-lane__menu` wrapper `<div>`s (which re-declared the popover's own
surface/hairline/radius/shadow) are gone; a shared compact `.pf-menu` class passed to the `Popover`
only tightens the content padding (`space-4`→`space-1`, flex column, 2px gap; verified). **(D)
"Worked with" carousel.** The notable-clients row (`ProfileAbout`, Part 2.3) moved from a wrapping
flex list into the reusable `@projective/ui/display` `Carousel` via a new `WorkedWithCarousel`
island (responsive `numVisible` 4→3→2→1, drag-swipe, looping, Prev/Next + dots). No new
`@projective/ui` primitive (reuses `Carousel`/ `Popover`) → no `DESIGN_SYSTEM.md` §C.1 change.
**Flagged reconciliation (surface, do not silently resolve):** Decision #40 pinned Reviews as the
literal far-right item; the owner's new "More on the absolute far right" directive supersedes that —
Reviews is now the last _content_ tab (just left of the More control), which is the reconciliation
applied here. | `apps/web/features/profile/components/tabs/*` ·
`apps/web/features/profile/components/{ProfileTabContent,ProfileAbout}.tsx` ·
`apps/web/features/profile/islands/{ProfileTabs,ProfileActionLane,WorkedWithCarousel}.island.tsx` ·
`apps/web/features/profile/core/profile-model.ts` · `apps/web/features/profile/styles/profile.css` ·
`packages/ui/display/islands/Carousel.tsx` · Decisions #36 / #40 |

| 43 | **Custom Projects & Articles view templates — `/view/[id]` (2026-07-22).** The generic
Amazon-style {@link EntityViewScreen} now **dispatches by `item.type`**: **projects** and
**articles** render bespoke templates, everything else keeps the generic hero/rails/reviews.
Additive Zod SSOT (`@projective/types/explore/view`): optional `project` (`ProjectViewSchema` —
uploader `banner`, stage flow `ProjectStage[]`, `ProjectFinance`, metric chips) + `article`
(`ArticleViewSchema` — rich `ArticleBlock[]`, derived `ArticleTocEntry[]`, `ArticleAsset[]`,
`ArticleComment[]`) on `EntityViewSchema`, derived **deterministically** in `view-fixtures.ts`
(`projectViewFor`/`articleViewFor`; no RNG) — a read projection, **no DB migration**. Stages derive
from a project's `phases`/`roles`/`budget`; the article body/TOC/assets/comments from its
`topic`/`readMinutes`/`media`. **Projects view** MIRRORS the profile chrome: it reuses the profile
`pf-header` banner/avatar VERBATIM (banner resolved via the profile fixtures `findProfile` for
parity) with the identity block swapped to the project title/meta/CTAs, and reuses the
`.pf-stickyhead` scroll-migration EXACTLY — a new `viewHeaderFor(url)` slot (mirrors `viewLaneFor`)
mounts `ProjectStickyHeader` into the `ui-middle-nav__header` band (authed) / guest sub-header,
driven by the `ProjectViewHeader` window-scroll probe → shared `viewHeaderCondensed` signal. The
centrepiece is the interactive **Stage Flow** (`StageFlow.island`, "expandable stacked cards" +
status rail: per-stage description · seats/roles · stage ticket price · required-skill tags), a
single-open accordion bridged to the side-nav **`ProjectViewLane`** (finance/metric summary + stage
quick-jumps) via `selectedStageId` (a `view-state.ts` bridge, like the board/submissions footer↔body
bridges). Per the brief the project view renders **NO** More-by/Similar/Reviews. **Articles view**
(`ArticleViewScreen`): an editorial header (cover · title · author byline · published date · read
time), a rich block body (`ArticleContent.island`: nested `h2`/`h3`, prose, lists, pull-quotes,
inline images, a **privacy-facade YouTube embed** [poster → `youtube-nocookie` iframe only on click;
placeholder id Big Buck Bunny], and inline `@projective/ui` `AudioVisualizer` players), a sticky
interactive **Table of Contents** side nav (`ArticleTocLane.island` on the reused `pf-lane` skeleton
— server-parsed from the heading blocks so it SSRs, + client smooth-scroll & scrollspy →
`activeTocId`), a rounded-square media-asset **`Carousel`** (`ArticleMediaGallery.island`), then
More-from-uploader + Suggested articles (reusing the concurrently-refactored `RelatedSection`) + a
comments thread (`ArticleComments.island`, optimistic like/post stubs; guests bounce to sign-in).
The lane is **dispatched by type** in `viewLaneFor` (project → `ProjectViewLane`, article →
`ArticleTocLane`, else → `ViewActionLane`). **No new `@projective/ui` primitive** (reuses
`Avatar`/`Carousel`/`AudioVisualizer`/ `Tooltip`/`RatingStars` + the
`pf-header`/`pf-stickyhead`/`pf-lane` skeletons) → no `DESIGN_SYSTEM.md` §C.1 change; no lifecycle
change → no `PRODUCT_MANAGEMENT.md` change. **Note:** `?type=` in the URL is presentational SEO only
— dispatch keys off the resolved `item.type`. Built alongside a concurrent refactor of the generic
recommendation rails (`RelatedRail`→`RelatedSection` + `RelatedCarousel`); the two are complementary
(projects/articles bypass those rails; the article bottom reuses `RelatedSection`). |
`PRODUCT_SPEC.md` §Sitemap (`/view`) · `packages/types/explore/view.ts` ·
`packages/backend/services/explore/view-fixtures.ts` ·
`apps/web/features/view/{components/{EntityViewScreen,
ProjectViewScreen,ArticleViewScreen,ProjectActions,view-glyphs},islands/{ProjectViewHeader,ProjectStickyHeader,
StageFlow,ProjectViewLane,ArticleContent,ArticleTocLane,ArticleMediaGallery,ArticleComments}.island,
core/{view-state,view-lane-slot,view-header-slot},styles/{project-view,article-view}.css}`
· `apps/web/routes/{(public),[handle]}/_layout.tsx` · Decisions #3 / #10 / #36 / #37 / #41 |

| 44 | **Projects view — de-escrowed, classification-led, flexible stage openings (2026-07-22).
REFINES Decisions #41/#43.** Reworks the custom Projects template (`/view/[id]?type=projects`) per
the product owner. **(A) Classification is now first-class.** New Zod `ProjectClassification` enum
(`pipeline` | `one-off`) on `ProjectItemSchema` (additive column-like field; the 5 project fixtures
now declare it — Verdant is the demo One-Off, the rest Pipeline), surfaced as a prominent header
pill + a "Project type" detail. A **Pipeline** derives multi-stage from `phases`; a **One-Off**
collapses to a single "Full delivery" stage. **(B) Escrow chrome removed page-wide.** The "Escrow"
title pill, "Escrow project" type badge/metric, the "Escrow-backed protection" trust line,
escrow-worded stage copy, and the `ProjectFinance.budget`/`funded`/`escrowNote` fields are all gone;
the page renders zero "escrow" occurrences (verified). **Escrow Budget → Ticket Price** everywhere
(header details + side lane). `ProjectMetric` icon enum re-scoped to
`stages|seats|type|ticket|roles` (dropped `budget|escrow|
timeline`); the **Estimated Timeline**
metric + per-stage `estimate` field removed. **(C) Layout removals.** The `.vw-project__aside`
(finance hero + posted-by card), the "What's involved" deliverables section, and the Save + Message
CTAs are deleted — **Apply to project is the single primary CTA** (`ProjectActions` is now
Apply-only; the lane keeps Share/Save utilities per owner scope decision). The generic project
details grid drops Client/Current-Stage/Engagement; the remaining cells are classification-tailored
(Pipeline adds Current stage + Stages; both show Ticket price + Open seats). **(D) Flexible stage
openings (new Zod shapes on `explore/view`).** `TicketPrice{min,max,label}` (fixed when `min===max`,
else a range), `StageRole{name,openSeats,price}`, `StageSeatKind`. `ProjectStage` gains `seatKind` +
`seatSummary` + `openSeats` + a `StageRole[]` `roles` (was `string[]`) + a `TicketPrice` `price`
(replacing scalar `ticketPrice`/`ticketLabel`). A stage is either **Open Seats** (a general pool
summary + one shared ticket price) or **Open Roles** (named roles, each with its own open-seat
count + fixed/range ticket price); the pipeline alternates the two so both render. **No DB
migration** (still a read projection over fixtures, like #41/#43) → no `documentation/database/*`
change; no lifecycle change → no `PRODUCT_MANAGEMENT.md` change. Verified in-app on a Pipeline
(`pj-helia-wallet-redesign`) + a One-Off (`pj-verdant-brand-refresh`): classification pill, ticket
pricing, both seat/role variants, no aside/timeline/escrow, single Apply CTA; typecheck + fmt clean.
| `packages/types/explore/{items,view}.ts` ·
`packages/backend/services/explore/{fixtures,view-fixtures}.ts` ·
`apps/web/features/view/{components/{ProjectViewScreen,ProjectActions}.tsx,islands/{ProjectViewHeader,
StageFlow,ProjectViewLane,ProjectStickyHeader}.island.tsx,core/{view-model,view-state}.ts,
styles/project-view.css}`
· Decisions #10 / #41 / #43 |

| 45 | **Services view — five delivery models + Projects-aligned stage showcase + availability
toggle (2026-07-22).** The Entity-View Services template (`/view/[id]?type=services`) was rebuilt to
cover all FIVE service delivery models. The `ServiceType` enum EXPANDED 3→5: `Pipeline` · `One-Off`
· **`Direct Deliverable`** (formerly "Single Task") · `Session` · **`Group Session`**.
`EntityViewScreen` now dispatches `view.service` → a new `ServiceViewScreen` (which KEEPS the
commercial More-by/Similar/ Reviews rails, unlike the projects/articles templates). New Zod
**`ServiceViewSchema`** on `EntityViewSchema`
(`model`/`modelLabel`/`showcaseStages`/`stages: ProjectStage[]`/`roles: ServiceRole[]`
/`bookable`/`group`/`seatsPerSession`/`bookingSummary`), derived deterministically by
`serviceViewFor` in `view-fixtures.ts` from the discovery corpus — **no DB migration** (a read
projection, like #41/#43/#44) → no `documentation/database/*` change; no lifecycle change → no
`PRODUCT_MANAGEMENT.md` change. **Pipeline / One-Off** render the SAME interactive `StageFlow`
accordion AND the same stage-jump **side navigation** as `?type=projects` (a Pipeline as per-ticket
ranges, a One-Off as fixed milestone amounts): `ProjectStageSchema` gained additive optional
`deliverables`/`turnaround`/`dependency`; a service stage sets `seatsTotal: 0`, so `StageFlow` HIDES
the seat meter/facts behind a `hasSeats` gate and the lane `ViewActionLane` grows the Projects-style
`.vw-jumps` quick-jump list + numbered collapsed-rail squares (the shared `selectedStageId` bridge;
the lane now imports `project-view.css`). **Direct Deliverable** shows a "Project team roles" block
(`ServiceRole[]` — named roles + per-role skills, dedicated `.vw-teamrole*` chips in `view.css` so
it is independent of the stage-less `project-view.css`) in `ViewDetails`, and NO stages. **Session /
Group Session** are `bookable`: the lane's new **`pf-availtoggle`** segmented pill writes a shared
`availabilityMode` signal (`view-state.ts`) that the body **`ServiceShowcase.island`** reads to swap
the media gallery ⇄ the `@projective/ui/calendar` viewport (schedule resolved server-side in
`ServiceViewScreen` via `resolveSchedulePage`), so a client picks a slot in place; Group Session
prices `sessionPrice` as `$X / seat`. The generic hero's **"What's included" spec block is REMOVED
for services** (redundant beside the stage showcase). Pricing parity updated across `servicePricing`
/ `query.priceValue` / `DetailPanel` / `pricingFor` for all five models. Verified in-app on all five
(`sv-brand-identity-sprint` · `sv-landing-page-in-a-week` · `sv-packaging-art-direction` ·
`sv-portfolio-review-session` · `sv-design-systems-workshop`); typecheck + fmt clean. **Note:** the
new `ServiceShowcase.island.tsx` needs a dev-server RESTART for Vite island discovery (HMR won't add
it). | `PRODUCT_SPEC.md` §Sitemap (`/view`) · `packages/types/explore/{items,view}.ts` ·
`packages/backend/services/explore/{fixtures,view-fixtures,query}.ts` ·
`apps/web/features/view/{components/{EntityViewScreen,ServiceViewScreen,ViewDetails}.tsx,islands/
{ServiceShowcase,ViewActionLane,StageFlow}.island.tsx,core/{view-state,view-lane-slot,view-model}.ts,
styles/{view,project-view}.css}`
· `apps/web/features/explore/{core/pricing,components/DetailPanel}.tsx` · Decisions #37 / #41 / #43
/ #44 |

| 46 | **Session-refresh lifecycle — silent renewal, refresh-before-redirect, redirect memory
(2026-07-22).** Closed the missing half of the auth session lifecycle that logged active users out
(notably Google-OAuth, whose access token is ~1h): `sb-refresh-token` (30d) was set on sign-in/OAuth
but **read by nothing**, so once the short-lived `sb-access-token` cookie dropped, the `(dashboard)`
guard bounced to `/login` with a valid refresh token sitting unused. Adds the renewal primitive to
the existing thin/fat pattern: fat **`AuthBackendService.refreshSession(refreshToken)`** (live
GoTrue `refreshSession({ refresh_token })` → rotated tokens; stub re-mints so the path is
exercisable without a wired GoTrue — grants no access, RLS + guard remain the gates, and is only
reachable when a refresh cookie is actually presented, which the stub sign-in never sets) → thin
**`POST /api/auth/refresh`** (mints fresh `sb-*` cookies via `toAuthResponse`, `401`+clear on
failure; deliberately NOT behind the guard — it must be reachable precisely when the access token
has expired). New server glue **`apps/web/utils/session.ts` `ensureSession(req)`**: fast path
(access cookie present) → **refresh-before-redirect** (access gone + refresh present → renew in
place) → **fail-closed** (spent refresh token → clear both cookies). The
**`(dashboard)/_middleware.ts` guard** now calls it, re-mints the renewed cookies onto the
proceeding response, re-derives `ctx.state.userContext` from the fresh token (via new
`resolveTokenContext`) so a just-renewed request never paints guest chrome, stashes the token on
**`ctx.state.accessToken`** (State extended), and preserves the **FULL** target
(`pathname + search`, previously pathname-only) in `redirectTo`. Client half: new
**`apps/web/utils/api-client.ts` `apiFetch()`** — on a `401` it POSTs once to `/api/auth/refresh`
(single shared in-flight refresh; no stampede), retries the original request, else redirects to
`/login?redirectTo=<path+query>`; adopted in `features/projects/core/api.ts` (the reported
`/projects/*` surface), and any feature `api.ts` adopts it by swapping `fetch`→`apiFetch`. Also:
`exchangeOAuthCode` now defaults **`isNewUser=false`** on a `users_public` lookup error — `/join` is
only for a CONFIRMED brand-new identity, so a transient failure never re-onboards a returning user.
**Scope (surface, do not silently resolve):** refresh is wired into the dashboard guard + client
interceptor, NOT the global `_middleware.ts` (kept network-free) — so a PUBLIC page (Home/Explore)
with an expired-but-refreshable session shows guest chrome until a dashboard route or an `apiFetch`
call renews (cosmetic, not a logout). **The real, signed-JWT verification via `@server/services`
remains the TODO** wherever an _access_ decision is made (unchanged from Decisions #14/#16) — this
pass fixes session _persistence_, not verification. No DB migration (session cookies + GoTrue
tokens, no schema). | `SYSTEM_ARCHITECTURE.md` §Security (Session lifecycle) ·
`packages/backend/services/auth/AuthBackendService.ts` ·
`apps/web/utils/{session,api-client,auth-cookies,user-context,state}.ts` ·
`apps/web/routes/api/auth/refresh.ts` · `apps/web/routes/(dashboard)/_middleware.ts` ·
`apps/web/features/projects/core/api.ts` · Decisions #10 / #14 / #16 |

| 47 | **Header search parity + smart logout + account popover real-data binding (2026-07-22).**
Four coupled changes across the authenticated shell's header. **(A) Search parity.** The authed
header search `shell-search` is **mirrored 1:1** to the guest `site-header__search` (root CLAUDE.md
Decision #38 pins `SiteHeader` as unchanged, so the authed bar mirrors rather than the guest header
being refactored): `NavSearchBar.island.tsx` markup + the `.shell-search*` block in `user-shell.css`
were rewritten to the guest bar's structure (fused entity/scope selector → static
`placeholder="Search Projective…"` field → filled-magnifier submit), dropping the bespoke typewriter
placeholder / ghost / blinking caret and the stroked `NavIcon`. Same shape/tokens/dimensions/icon —
the two bars are visually identical; the scope vocabulary stays shared via `landing-data`. Neither
bar carries a `⌘K` shortcut chip, so "100% identical" means neither gains one. **(B) Smart logout.**
Logout was **never implemented** — the control was a bare `<a href="/logout">` that 404'd through
the reserved-handle catch-all without clearing cookies. Now `AuthService.logout()` → thin
`POST /api/auth/logout` → fat `AuthBackendService.signOut(accessToken)` (live: best-effort GoTrue
global revocation; stub: no-op) → the route **unconditionally clears** both `sb-*` cookies (cookie
clearing is the authoritative sign-out; revocation is defence-in-depth). The island then does a
**route-aware redirect**: a protected `(dashboard)` route leaves for the public landing (`/`); a
public route reloads in place as a guest. The public/protected discriminator is the **route GROUP
that renders the shell** (`protectedRoute` threaded `(dashboard)/_layout` → `UserShell` →
`UserActions`; public/`[handle]` layouts default false) — reliable where the URL path alone is not
(route groups are stripped from the path). **(C) Account popover real-data binding.** The
`ui-popover__content` account menu was cosmetic (initials "You" + `@handle`). It now binds **live
account data** — real name, avatar, email, role badge
(Client/Freelancer/Team/Business/Organisation), online status, and active workspace — via the 12th
thin/fat read: `AccountService.current()` (client, chrome-safe: a failed load → context fallback,
never a redirect) → thin `GET /api/user/me` → fat `UserBackendService.me({ context, accessToken })`,
which **composes** the chrome `UserContext` (role + workspace via `resolveAccountRole`) with the
live Supabase `auth.users` identity (name/email/avatar via `auth.getUser`), **degrading** to the
context projection when the live read is unavailable (only a genuine guest 401s). New Zod SSOT
**`@projective/types/user`** (`CurrentUser`, `resolveAccountRole` — a derived read projection, **no
DB table**). **(D) Migration (additive).** Own-profile RLS SELECT already works (`0203`'s "Any
authenticated user can view public profiles"), so no policy change. The one gap — provisioning never
seeded `org.user_preferences` — is closed additively by a new `AFTER INSERT ON org.users_public`
trigger (`org.seed_user_preferences`, migration `20260722120000_seed_user_preferences.sql`) that
seeds a default preferences row on **both** the email and OAuth signup paths (idempotent
`ON CONFLICT DO NOTHING`) + a one-time backfill — no existing table/column/FK/function/trigger
altered. **Not applied to any live database in this change** (additive

- safe, but pushing migrations is a human step). **Dual-service pattern** honoured throughout: thin
  frontend `AuthService`/`AccountService`, thin routes `/api/auth/*` + `/api/user/*`, fat
  `AuthBackendService`/`UserBackendService`. | `SYSTEM_ARCHITECTURE.md` §Backend Services (Sign-out
  & the account projection) · `documentation/database/org/Functions.md` · `packages/types/user/` ·
  `packages/backend/services/{auth/AuthBackendService,user/UserBackendService}.ts` ·
  `apps/web/routes/api/{auth/logout,user/me}.ts` ·
  `apps/web/features/{auth/core/AuthService,shell/core/AccountService,shell/islands/{UserActions,NavSearchBar}.island,shell/styles/user-shell.css,shell/components/UserShell}`
  · `apps/web/routes/(dashboard)/_layout.tsx` ·
  `supabase/migrations/20260722120000_seed_user_preferences.sql` · Decisions #10 / #16 / #38 / #46 |

| 48 | **Session-based service sidebars + functional channel-header actions (2026-07-22).**
Completes the session-service surface across the Project Details sidebar and the channel header,
discriminating a standard stage-based project from a **1-1 session** and a **group session**. **(§1)
Channel-header actions** — the middle-nav header-band `ChannelHeader` island wires all three
`chan-action` controls: a **Star** toggle (optimistic `isStarred` + per-channel persistence to
`LocalKeys.PROJECT_CHANNEL_PREFS`), a **kebab** `Popover` menu (Mute notifications · Pin channel ·
Channel info · Copy link), and the middle control opening a right-docked **Stage Details `Drawer`**
(kind · status · deadline · a progress meter · an assigned-member avatar stack, built SSR by
`channelHeaderFor`→`buildDetailInfo`). **(§2) Tab matrix** — `channel-view.ts`
`visibleChannelTabKeys` gates by the effective **service archetype**: **Calendar** shows ONLY for a
session; **Tasks + Submissions** hide for ANY session and otherwise appear only on a **stage**
channel to a reviewer or an assigned freelancer. **(§3) Session sidebars** — the pure
`session-model.ts` resolves the archetype (`SessionKind` = `none`|`normal`|`group`) from the SSR
`format` baseline layered with the dev seam (`resolveSessionKind`/`liveSessionKind`, exactly like
the header) and derives the projections. `ProjectSidebar.island` (now taking a `sessionKind`
baseline prop, tracking the seam live) branches the expanded body: a **1-1 session**
(`NormalSessionPanel`) reclaims the empty stage-tree real estate with a **bespoke interactive
mini-calendar** (`SessionMiniCalendar` — month nav · week-hover · booked-session-day + today
highlights; **bespoke** because the pkg `MiniMonth`'s `.cal-mini` CSS ships only through the
calendar _island's_ stylesheet, so reusing it would drag the whole calendar sheet in or cross a
workspace CSS boundary — root §2/§3), an **upcoming-session** card (time · duration · a
`Confirmed`/`Pending Proposal`/`Rescheduled` booking-proposal badge · a Propose-Time CTA), a
**session counter** (`Session N of M` / `Pay-per-session`), Shared-files/resources quick links, and
the minimal General channels (no stage tree, no nested PMs); a **group session**
(`GroupSessionPanel`) shows a **General · Sub-groups · Private-messages** tree (sub-groups carry
proficiency **level tags** + overlapping-schedule indicators + a joined/not-joined state), an
active-tracks summary, a cohort **reschedule-vote** alert with a tally meter, and a **1-1
Continuation** CTA gated on the preset-ended flag. The footer/rail view-links
(`projectViewLinks(detail, sessionKind)`, `ProjectViewNav`, `ProjectRail`) go session-aware too —
Board→**Calendar**, **Submissions dropped**, Add-stage hidden. **(§4) Dev Context Switcher** carries
the `serviceType` (Standard / 1-1 / Group) · `sessionBookingStatus` · `subGroupAssignment`
(`multiSubGroup`) axes (`dev-context.ts` + `DevContextPanel` + the shipping-safe `dev-seam.ts` READ
side), so every session surface (tabs · sidebar body · view-links) live-updates with **NO reload**
(verified: normal→group swap in place, zero errors). Everything is presentation + THIN over the SSR
`ProjectDetail`; booking / continuation / star persistence are optimistic/stubbed pending
`PROJECTS_BACKEND_LIVE` → **no DB migration** (a derived read projection, like the sibling
`detail`/`files` reads) → no `documentation/database/*` change, and **no new `@projective/ui`
primitive** (the mini-calendar is an app-feature component) → no `DESIGN_SYSTEM.md` §C.1 change.
**Bug fixed:** `session-model.ts` derived array indices with a **signed** `>>` over an unsigned
(`>>> 0`) hash → a negative index → an `undefined` slot (a visible "undefined min" duration);
switched to the unsigned `>>>` (the documented hash-index gotcha). | `PRODUCT_SPEC.md` §Sessions ·
`apps/web/features/projects/{core/{session-model,channel-view,
channel-header-slot},islands/{ProjectSidebar,ChannelHeader}.island,components/{NormalSessionPanel,
GroupSessionPanel,SessionMiniCalendar,session-glyphs,ChannelTree,ProjectViewNav,ProjectRail,detail-glyphs},
styles/project-sidebar.css}`
· `apps/web/features/devtools/{core/dev-context,components/DevContextPanel}` ·
`apps/web/utils/dev-seam.ts` · `apps/web/routes/(dashboard)/_layout.tsx` · Decisions #21 / #23 / #26
/ #37 |

| 49 | **Global Messaging module — floating chat popover, `/messages` inbox, profile quick-message
(2026-07-23).** The 13th thin-frontend/fat-backend READ and the standalone global inbox. New Zod
SSOT **`@projective/types/messaging`**
(`ConversationSummary`/`ConversationDetail`/`ConversationListPage(+Params/
Filter)` ·
`MessagingContact`/`ContactList` · `MessagingSettings`/`AutoResponseRule`/`NotificationPreferences`
· `MessagingRole`/`ConversationRelation`); message BODIES REUSE the projects
`MessagePage`/`ChatMessage` projection — a project channel and the inbox are unified by `chatId`
(PRODUCT_SPEC §Unified Messaging), so the fixtures derive the `dm-{handle}` conversation ids to
MATCH the project DM ids. Fat **`MessagingBackendService`**
(`conversations`/`conversation`/`messages`/`contacts`/`settings`) → thin `/api/messaging/*` → client
`MessagingService` → SSR resolvers, gated by the NEW **`MESSAGING_BACKEND_LIVE`** (default off,
`isMessagingBackendLive()`); fixtures DERIVE the corpus deterministically from the same multi-tenant
cast as `/projects` (fixed clock, unsigned hash, **NOTE the TDZ**: `ALL = SEEDS.map(toSummary)` runs
at module init, so the reference-clock `NOW` + `fmtActivity` must be declared ABOVE the corpus). No
DB migration (a read projection over the eventual `messages.*` tables). **(§1) Floating "Pop Out
Chat" popover** — a Pop-Out button on every project channel header (`ChannelHeader`) + the
conversation header opens the active thread in a `@projective/ui/overlay` `DraggablePopover`
(`ChatPopoutHost`, mounted once in the dashboard layout) carrying a lean CONTAINER-scrolled
`PopoutChat` (the shared `ChatFeed` virtualizes against the WINDOW, wrong in a floating panel, so
the popout reuses `MessageBubble`/`ChatComposer` directly) + a whole-panel file **drop zone** that
forwards into the composer via a new additive `ChatComposer.onReady` `ComposerHandle`; **navigation
memory** — the popout state persists in `sessionStorage` (`SessionKeys.CHAT_POPOUT`) so it SURVIVES
full-page navigations and shows a **"Return to Channel"** button when the viewer has navigated away.
**(§2) `/messages`** — the middle-nav lane hosts `MessagesSidebar` (dual-presentation like
`ProjectSidebar`: expanded stack + collapsed `MessagesRail`, CSS-switched by
`.ui-splitter[data-mode]`): conversation search + a **role-specific advanced filter** panel
(freelancer: Service · Product · Client · Co-Freelancers · Teams · Team Members; client/business:
Businesses · Business Members · Hired Freelancers · Direct Messages) + Starred/Archived/Unread
partition + per-row Favourite/Archive/soft-Delete (optimistic, `LocalKeys.CONVERSATION_PREFS`);
**visibility rule** — a conversation appears only when `messageCount > 0`. New Conversation /
Add-members `ContactPicker` modal (1 pick → DM, several → group; Members-tab add converts a DM →
group) + a Message **Settings** modal (auto-responses ready for a future AI plug-in · notification
prefs · quiet hours). The conversation view `/messages/[conversationId]` **strictly mirrors** the
project channel layout with ONLY **Chat · Files · Members** tabs (reuses the `.chan-*` header
chrome + `ChatFeed` with a messaging pager + the footer `ChatComposer`). **(§3)** A profile
**"Message"** button opens a `DraggablePopover` quick-composer (`ProfileMessagePopover`, mounted in
`ProfileActionLane`; all 3 Message triggers flip a shared `quickMessageOpen` signal) — on the first
send it creates + links into `/messages/dm-{handle}`. **(§4)** A NEW **`messagingRole`** Dev-Context
axis (freelancer/client/business) live-swaps the filter set + the auto-response offer with no
reload. No new `@projective/ui` primitive (reuses DraggablePopover · Dialog · Popover · Tooltip ·
Avatar · ToggleSwitch + the `ChatFeed`/`ChatComposer`/`MessageBubble` islands) → no
`DESIGN_SYSTEM.md` §C.1 change; no lifecycle change → no `PRODUCT_MANAGEMENT.md` change.
**Deviations flagged (surface, do not silently resolve):** (a) message sender / participant profile
links follow the codebase canonical `/@handle` (`profileHref`, Decision #3), NOT the task brief's
`/messages/[conversation-id]`-adjacent `/profiles/[id]`; (b) a guest who sends from a profile is
routed through the `(dashboard)` guard (sign-in) — messaging is authed-only. | `PRODUCT_SPEC.md`
§Unified Messaging · `SYSTEM_ARCHITECTURE.md` §Backend Services · `packages/types/messaging/` ·
`packages/backend/services/messaging/` · `apps/web/features/messaging/` ·
`apps/web/routes/(dashboard)/messages/` · `apps/web/routes/api/messaging/` ·
`apps/web/features/{projects/islands/
{ChannelHeader,ChatFeed,ChatComposer}.island,profile/{islands/{ProfileActionLane,ProfileMessagePopover}.island,
components/ProfileActions}}`
· `apps/web/utils/{dev-seam,storage-keys,lane-events}.ts` ·
`apps/web/features/devtools/{core/dev-context,components/DevContextPanel}` · Decisions #3 / #10 /
#16 / #31 / #48 |

| 50 | **`/messages` ⇄ `/projects` parity: shared lane chrome, body-portalled overlays, partial-nav
tab switching (2026-07-23).** Three coupled changes make the inbox a structural twin of the projects
surface rather than a lookalike. **(A) Shared lane chrome.** A NEW `@projective/ui/navigation`
control set —
`LaneHead`/`LaneFooter(+Actions)`/`LaneList`/`LaneBar`/`LaneTabs`/`LaneSearch`/`LaneIconButton`/
`LaneToggleRow`/`LaneSection(+LaneSections)`/`LaneCollapseButton`/`LaneEmpty`
(`components/LaneChrome.tsx`

- `styles/lane.css`, `.ui-lane-*`) — is the SINGLE source of truth for every middle-nav lane. The
  `/messages` inbox (`MessagesSidebar`), the `/projects` feed (`ProjectsLane` · `LaneTabs` ·
  `UtilityShortcuts`), and the Project Details sidebar (`ChannelTree`'s `AccordionGroup` ·
  `ChannelQuickFilters` · `GroupSessionPanel`) all compose these, so the three read as ONE control
  set; the duplicated `.proj-*`/`.msg-*` chrome CSS was retired. Messaging glyphs
  (`messaging-glyphs.tsx`) were re-drawn byte-identical to the projects glyph set (same paths,
  `stroke-width: 1.8`, `1em` sizing) for iconographic parity. **(B) Shared Files/Members views +
  body-portalled overlays.** `FilesView`/ `MembersView`
  (`features/projects/components/workspace-views.tsx`) are the ONE component tree BOTH route
  hierarchies import — the engagement routes and `/messages/[id]/{files,members}` mount the same
  `FileExplorer`/`MemberRoster` islands; a NEW `conversation` scope on `FileScope`/`MemberScope`
  (additive Zod) routes the islands' thin services to `/api/messaging/{files,members}` (thin) → new
  `MessagingBackendService.{files,members}` (fat) → deterministic `workspace-fixtures.ts` DERIVED
  from the conversation's messages/participants (no DB migration, a read projection like
  `detail`/`messages`). The legacy `ConversationFilesView`/`ConversationMembers` were deleted. Every
  `@projective/ui` overlay
  (`Popover`/`Tooltip`/`Dialog`/`Drawer`/`ConfirmPopup`/`DraggablePopover`/`HoverCard`) now renders
  its panel through the real `BodyPortal`, and `useOverlayStack` allocates a LAYERED z-index from a
  strict class scale (`--z-popover` 1100 < `--z-modal` 1300 < `--z-draggable` 1500) — fixing the bug
  where a menu/modal opened from the sticky, glass middle-nav lane was clipped or trapped (the lane
  is a stacking context + `overflow: clip` + a `backdrop-filter` re-base). The lane itself carries
  `z-index:
var(--z-raised)`. **(C) Instant tab/channel switching via Fresh Partials + skeletons.**
  The channel (`[channelId]/_layout`) and conversation (`[conversationId]/_layout`) bodies are
  wrapped in a shared `<Partial name="midnav-body">`, and the header band in
  `<Partial name="midnav-header">`; the tab strips (`ChannelHeader`/`ConversationHeader`) + the lane
  channel/conversation lists opt in with `f-client-nav`. So switching Chat·Files·Members (or
  channels/conversations) swaps only the body + header band — the shell, global sidebar, and
  middle-nav lane (scroll position, open groups, search/filter state, hydrated islands) all persist.
  A persistent `PartialTransition` island paints a shape-matched `ContentSkeleton` (chat bubbles /
  file grid / member table / board) over the content region while the swap is in flight. **Flagged +
  resolved in-pass:** a Fresh 2 limitation where the THIRD sibling band (the footer) stops swapping
  after its first partial update (header + body are unaffected) — so the footer is NOT a Partial; it
  is the persistent `MidnavTabFooter` host island that lives outside every Partial and re-renders
  the correct footer (Chat composer · Files/Submissions/Board View-Control-Rig · nothing) from the
  URL on each `PARTIAL_NAV_EVENT`. The dead `channel-footer-slot`/ `conversation-footer-slot`
  resolvers were removed. **Deviation flagged (surface, do not silently resolve):** the task brief
  specified React Suspense + parallel-slot `layout.tsx`, but the stack is Fresh 2 / Preact (no React
  Suspense) — realised with the framework-native Partials + a skeleton island, the idiomatic
  equivalent. | `DESIGN_SYSTEM.md` §C.1 (navigation roster + overlay-portalling/z-scale) ·
  `packages/ui/navigation/{components/LaneChrome,styles/lane}` ·
  `packages/ui/{overlay/components/Portal,
feedback/islands/{Popover,Dialog,Drawer},hooks/useOverlayStack,styles/index.css}`
  · `packages/types/projects/{files,members}.ts` ·
  `packages/backend/services/messaging/workspace-fixtures.ts` ·
  `apps/web/features/{projects/components/workspace-views,shell/{islands/{PartialTransition,
MidnavTabFooter}.island,components/ContentSkeleton,core/partials}}`
  ·
  `apps/web/routes/(dashboard)/
{_layout,messages/[conversationId]/_layout,projects/[projectId]/[channelId]/_layout}`
  · `apps/web/routes/api/messaging/{files,members}` · Decisions #26 / #31 / #32 / #33 / #49 |

| 51 | **Partial-nav island desync + chat scroll-to-bottom + footer parity (2026-07-23).** Fixes
three bugs in the Decision #50 Partial-navigation model, all in the channel-to-channel /
conversation-to- conversation case. **(A) Stale island across a Partial swap — the core desync.**
Fresh reconciles a swapped Partial's islands by tree position, so navigating channel A → channel B
**RE-USED** the `ChatFeed` island: its `useSignal(initial)` messages + the `useVirtualScroll`
measured-size cache kept A's data (proven: general→stage3→general kept stage3's sizer height, not
general's) and its mount-only scroll effect never re-fired — the header only updated because it
renders straight from props while `ChatFeed` snapshots props into signals. Fix: **`key={channelId}`
/ `key={conversationId}` on the chat island in the routes** (`[channelId]/chat.tsx`,
`messages/[conversationId]/index.tsx`). Fresh ENCODES the island's JSX key in its revival marker
(`${island.name}:${propsIdx}:${key}`), so a changed key forces a clean remount → fresh signals,
fresh measured cache, mount effects re-run. **(B) Scroll-to-bottom on every open.** The feed must
land on the newest message on first paint AND every switch, but Fresh forcibly `scrollTo({top:0})`
after a partial swap. `ChatFeed`'s open-at-bottom effect is rekeyed on `[channelId]` and re-pins
across rAF + settle timers + on `PARTIAL_NAV_EVENT` (fires after the swap lands), on the SAME window
scroller it virtualizes against (`vs.scrollToEnd`, `useWindow`) — winning the race against Fresh's
reset. **(C) Footer + active-highlight parity.** The `/messages/[id]/files` tab now renders the File
Explorer's View Control Rig in the footer band (via `MidnavTabFooter`, symmetric with a project
channel — Files had NO footer, so the shared explorer had no zoom control); and the **projects
channel tree** now highlights the active channel row (`.proj-chan[data-active]`, tinted like the
inbox's active conversation) with `ProjectSidebar` tracking the URL via
`PARTIAL_NAV_EVENT`/`popstate` (the lane is outside the Partials, so it never re-rendered on a
channel switch) + a pure `activeChannelIdOf(pathname)` in `chat-context.ts`. **Deviation flagged
(surface, do not silently resolve):** the task brief's suggested `chatContainerRef.scrollTo(...)`
assumes a LOCAL scroll container, but the feed scrolls the **window** (Decision #31 `useWindow`) —
so the fix re-pins the window via the existing `useVirtualScroll.scrollToEnd`, not a container ref.
No DB/lifecycle change (pure island reactivity + CSS). | `DESIGN_SYSTEM.md` §D.4 / Part D ·
`apps/web/features/projects/
{islands/{ChatFeed,ProjectSidebar}.island,components/ChannelTree,core/chat-context,styles/project-sidebar.css}`
· `apps/web/features/shell/islands/MidnavTabFooter.island` ·
`apps/web/routes/(dashboard)/
{projects/[projectId]/[channelId]/chat,messages/[conversationId]/index}`
· Decisions #31 / #50 |

| 52 | **Fresh Partial navigation REVERSED — back to standard full-page navigation (2026-07-23).
REVERSES the partial-nav mechanism of Decisions #50/#51.** After the Partial-based instant
tab/channel switching proved unreliable in the product owner's real environment across two fix
attempts (Fresh's third-sibling footer band never swapping, island re-use holding stale `ChatFeed`
state, and the chat-feed opening at the top instead of the bottom — none of which reproduced cleanly
in the embedded preview harness), the entire Fresh Partial layer was removed at the owner's
direction. Channel and conversation navigation is once again ordinary **full-page navigation**, the
reliable Fresh default: every click re-renders the header band, the body, and the footer band fresh
server-side, so there is NO island re-use, NO stale messages, NO scroll race, and NO footer desync —
the whole class of bugs is gone by construction. **Removed:** the
`<Partial name="midnav-body/header">` wrappers (both channel + conversation `_layout.tsx` back to a
plain `.chan-view`), all `f-client-nav` opt-ins (channel/ conversation tab strips + the
channel/conversation lists), the `PartialTransition` + `ContentSkeleton` skeleton islands, the
`MidnavTabFooter` persistent footer host, `shell/core/partials.ts`, the
`PARTIAL_NAV_EVENT`/`PartialNavDetail` event, the route-level
`key={channelId}`/`key={conversationId}`, the `ChatFeed` partial-nav scroll hardening (back to the
simple mount-anchored `scrollToEnd`), and the `fresh/runtime` import-map entries. The footer band is
resolved the original slot way again (`channelFooterFor` + `conversationFooterFor` restored from
HEAD, recomposed in `middleNavFooterFor`). **KEPT (these are Decision #50, NOT partials):** the
shared `@projective/ui/navigation` lane chrome, the shared `FilesView`/`MembersView` (one component
tree, `conversation` scope), the body-portalled overlays

- layered z-scale, and the active-channel/-conversation highlight (now driven by the fresh SSR
  `path` prop each full nav, no client tracking). **Consequence flagged (surface, do not silently
  resolve):** the `/messages/[id]/files` tab no longer shows the File Explorer's zoom
  View-Control-Rig footer (that rig was added ONLY via the partials-era `MidnavTabFooter`); the
  explorer still renders + works, defaulting to grid density — restore a messages-scope files footer
  slot if the zoom control is wanted there. No DB/lifecycle change. |
  `apps/web/routes/(dashboard)/{_layout,projects/[projectId]/[channelId]/{_layout,
chat},messages/[conversationId]/{_layout,index}}`
  ·
  `apps/web/features/{projects/{islands/{ChatFeed,
ProjectSidebar,ChannelHeader}.island,components/ChannelTree,core/channel-footer-slot},messaging/{islands/
{MessagesSidebar,ConversationHeader}.island,core/conversation-footer-slot}}`
  · `apps/web/utils/lane-events` · `deno.json` · `apps/web/deno.json` · Decisions #31 / #50 / #51 |

| 53 | **Catalogue — the seller product & service management surface (`/catalogue`) + the platform's
FIRST write surface (2026-07-23).** A single unified seller console (Products + Services as `?type=`
segments, NOT two routes) under `(dashboard)` (authed, seller-only): a zoom-driven listing console
(`/catalogue`) + a deep two-panel manage page (`/catalogue/[id]`). It is the **first write-oriented
thin/fat surface** — all prior reads are joined by create/update/publish mutations through the same
split: `CatalogueService` (client) → `/api/catalogue/{list,item,create,update,status}` (thin,
authed-only — NO server-side capability guard; RLS remains the real gate) →
`CatalogueBackendService` (fat) → `ServiceResult<T>`, stub-first behind the new
**`CATALOGUE_BACKEND_LIVE`** (default off, `isCatalogueBackendLive()`). New Zod SSOT
**`@projective/types/catalogue`** (`CatalogueKind`, `ListingStatus`
[draft·published·paused·archived, Archived-not-deleted per §5 — a visibility state of one listing,
NOT a new lifecycle state-machine, so NO `PRODUCT_MANAGEMENT.md` change],
`ListingSummary`/`ListingDetail`, `ListingMetrics`/`CatalogueStats`,
`CatalogueListParams`/`CataloguePage`, the `Create`/`Update`/`SetListingStatus` payloads, and the
pure `resolveListingPricing`/`publishReadiness`/`money` helpers). **Pricing is NOT forked** — the
delivery model reuses `ServiceType` (all 5 models), the display projection reuses `EntityPricing`,
the per-unit prices reuse the discovery `ticketPrice`/`sessionPrice`. Fixtures DERIVE the seller
catalogue deterministically from the discovery corpus (`explore` `SERVICES`+`PRODUCTS`,
unsigned-`>>>` hash, fixed clock, TDZ-safe) **re-owned to a fixed acting seller** so a listing
agrees with the `ServiceCard`/`ProductCard`/`/view/[id]` it links to, and — being the first write
surface — seeds them into an **in-module session store** so create→edit→publish is fully exercisable
with the gate off (optimistic, per-process, **no persistence**). **NO DB migration** (a read+write
projection over fixtures, like `detail`/`messages`/`files`) → no `documentation/database/*` change;
the RLS-scoped `catalogue.*` tables + mutation policies are the deferred live-path TODO. **Reuse
(relentless):** the lane (`CatalogueLane` + collapsed `CatalogueRail`, dual-presentation via
`.ui-splitter[data-mode]`) is built from the shared `@projective/ui/navigation` LaneChrome; the
console reuses the Files zoom grid⇄list (`VirtualGrid`/`ZoomSlider` in the middle-nav footer band
via `catalogueFooterFor`, `Ctrl`+wheel, window-virtualized, `LocalKeys.CATALOGUE_ZOOM`); the create
modal reuses `Dialog` (`BodyPortal`-escaped) + `SelectButton`/`Select`; the manage page reuses
`@projective/ui/editor` `RichTextEditor` + `Chips` + `SortControl` + the REAL
`ServiceCard`/`ProductCard` for the live preview; the KPI strip follows the `dataviz` stat-tile
contract (label · auto-compact value · signed delta · accent sparkline; text in text-tokens). Lane
slot resolved by `catalogueLaneFor` in `(dashboard)/_layout.tsx` (mirrors `laneFor`). The seller nav
item **"Products & Services" was repointed** from the `/services` placeholder to `/catalogue` (label
→ "Catalogue"). **NO new Dev Context Switcher axis** (§5 gate): the seller gate reuses the existing
`persona` axis (→ `isFreelancer`), and no catalogue island branches on a `data-dev-*` flag, so
nothing to mirror. **Deviations / conflicts flagged (surface, do not silently resolve):** (a)
**`/catalogue` is the canonical spelling** (owner-locked) — the `/services` placeholder route is
superseded (kept, not hard-deleted; nav repointed). (b) **Seller gate is chrome + deferred RLS, NOT
a server-side redirect.** A hard `isFreelancer` server bounce is INCOMPATIBLE with the client-side
Dev Context Switcher (the server never sees the persona override), so the pages/API do **not**
capability-gate — the `(dashboard)` middleware bounces guests, the dev-seam-reactive sidebar
(`useEffectiveContext` → `globalNav`, gated `isFreelancer || contextType === "team"`) surfaces the
Catalogue rail to sellers, and the deferred `catalogue.*` RLS is the real gate (consistent with
Decisions #14/#16/#48 — no route gates on `isFreelancer`). The sidebar chrome gate INHERITS the
unresolved Businesses-tab/`is_operator` inconsistency (Decisions #17/#18); reconcile with a human.
(c) **Products stay fixed-deliverable** (no product-specific delivery-model concept) — products
diverge from services only in the editor's pricing/model fields; confirm with a human if products
need their own model. (d) Fixtures re-own the WHOLE corpus to one acting seller (`@ahmed`), so a
listing's preview shows that seller while the untouched public `/view/[id]` still shows the corpus's
original owner — a fixtures-only divergence the live path unifies (content already agrees). (e)
Session **availability** uses a lightweight BESPOKE editor, NOT the pkg `MiniMonth` (the calendar
CSS is island-only — same CSS-boundary reason as Decision #48); the full `@projective/ui/calendar`
booking view remains the public `/view/[entity]/schedule` surface (#37). (f) The live-preview cards
need the app-local `explore.css` imported into the editor island (the island-bundled-CSS gotcha,
Decision #39). (g) Profile / owner links follow the canonical `/@handle` (`ExploreOwner.handle`,
Decision #3), not a `/profiles/[id]`. | `SYSTEM_ARCHITECTURE.md` §Backend Services (Catalogue) ·
`packages/types/catalogue/` · `packages/backend/services/catalogue/` ·
`packages/backend/core/{env,supabase}.ts` · `apps/web/features/catalogue/` ·
`apps/web/routes/(dashboard)/catalogue/{index,[id]}.tsx` · `apps/web/routes/api/catalogue/*` ·
`apps/web/routes/(dashboard)/_layout.tsx` · `apps/web/features/shell/core/nav-model.ts` ·
`apps/web/utils/storage-keys.ts` · Decisions #3 / #10 / #21 / #32 / #36 / #39 / #41 / #45 / #48 /
#49 / #50 |

| 54 | **Wallet & Finance system — documentation + database FOUNDATION (2026-07-23).** A **docs +
DB-only** pass (NO UI / islands / routes / features / backend services). Adds **5 additive,
timestamped migrations** (`20260723090000`–`094000`) — (1) multi-currency + FX + i18n prefs, (2)
KYC/KYB verification + payout-readiness, (3) payment methods + money-movement (deposits / payouts /
Income Smoother / pots), (4) vault governance (permissions / split-rules / spend-approvals / audit),
(5) statements + the 7-day pending-release window + fund states + chargebacks + idempotency +
reconciliation view — each **RLS-on with policies**, **additive-only** (no FK/table/column drop; the
protected Escrow/Wallet/Stage tables touched ONLY by adding nullable FX columns), **authored, NOT
applied to any live DB** (a human step, Decision #47 precedent). Lands with the **Zod SSOT**
(`@projective/types/finance/*` — a NEW sub-path — + `org/preferences.ts`), the **de-stubbed**
`documentation/database/finance/{Tables,Policies,Functions}.md` reflecting the REAL pre-existing
engine (migrations 0009/0305/0309/0310) **plus** the new tables, and `org`/`security`/`Schemas.md`/
`README.md` updates. Business/arch: `finance-model.md` §§7,10–15 (concrete numbers),
`PRODUCT_SPEC.md` §Escrow/Wallets/Finance #5–#6 + §Identity refinement (abstract rules),
`SYSTEM_ARCHITECTURE.md` §Internationalization + §Stripe, `DESIGN_SYSTEM.md` §A.6 (RtL/LtR
contract), `PRODUCT_MANAGEMENT.md` §3.5 (finance domain lifecycles ≠ build states). **Reused, NOT
forked:** spending caps = `finance.spending_limits`; team split shares =
`finance.contribution_agreements` (the new `finance.split_rules` adds only the ruleset template);
org KYB = existing `org.organisation_verification_level`. **Flagged conflicts (surface, do NOT
resolve):** (a) **FX economics OPEN** — who bears the spread / how the conversion fee is charged is
undecided (finance-model §11). (b) **Materialised single-entry balance** (`wallets.balance_cents` +
`transactions.balance_after_cents`) vs the derived-double-entry model finance-model §7 aspires to —
documented as reality, conversion is a future migration. (c) The **7-day "Pending" window did not
exist** (release credits Available directly; `org.get_business_finance` mislabels DISPUTED escrow as
"pending") — `finance.pending_releases` makes it first-class but wiring the credit-to-pending-then-
sweep is a follow-up. (d) **KYC ≠ email verification** (`org.user_emails.verified_at`, mig 0312) —
never conflated. (e) **Freelancer-KYC gate NOT wired** into `claim_ticket`/`fn_hold_ticket_escrow`/
`fund_stage`/hire — predicates (`fn_freelancer_payout_ready`/`fn_business_kyb_verified`) provided;
the behavioural change to money-movement functions needs human sign-off. (f)
`finance.payment_methods` **overlaps** `finance.payout_accounts` (Connect account). (g)
**Vault-capability enum overlaps** `org.business_permission` (manage_billing/manage_escrow) +
`org.team_permission` (manage_finances). (h) `org.user_preferences.locale` reused as the language
source — **no** `preferred_locale`/`language` column added (only `preferred_display_currency` +
`layout_direction`). (i) **Hidden system wallets** (Escrow Pool / Fee Collection / Dispute Lockbox)
documented but **not yet materialised** as `owner_type='system'` rows. (j) **PRODUCT_SPEC Level-2
KYC refined** to a freelancer-onboarding gate + explicit client exemption (narrows the former
"Freelancer/Client" label). (k) The pre-existing session-cancellation conflict (finance-model §4 50%
vs PRODUCT_SPEC full forfeit) is untouched and remains logged below. | root CLAUDE.md §1/§5/§6 ·
`supabase/migrations/20260723090000..094000_*` · `packages/types/finance/*` +
`packages/types/org/preferences.ts` · `documentation/database/finance/*` ·
`documentation/database/{org,security,Schemas,README}.md` · `finance-model.md` · `PRODUCT_SPEC.md`
§Escrow/Wallets/Finance + §Identity · `SYSTEM_ARCHITECTURE.md` · `DESIGN_SYSTEM.md` §A.6 ·
`PRODUCT_MANAGEMENT.md` §3.5 · Decisions #6 / #7 / #10 / #47 |

| 55 | **Wallet & Finance frontend surface — `/wallet` (2026-07-24).** The 14th
thin-frontend/fat-backend read AND the finance domain's first WRITE surface: the context-scoped
Wallet — a calm Overview hub + deep pages
(`/wallet/{transactions,activity,payouts,funding,methods,invoices,access}`) + BodyPortal action
modals — over the finance Zod SSOT (`@projective/types/finance`, Decision #54). Thin `WalletService`
→ `apiFetch` → `/api/wallet/*` (thin routes = HTTP+Zod+guard, NO server capability gate) → fat
**`WalletBackendService`** (`@server/services/finance/`) → `ServiceResult<T>`, gated by the NEW
**`FINANCE_BACKEND_LIVE`** (default off, `isFinanceBackendLive()`). **ALL money math is
server-side** (`wallet-fixtures.ts`): the three-state balance projection, the
5%-fee→vault-cut→template→remainder-to-vault team split (finance-model §5), FX conversion + `Intl`
formatting, the KYC gate — the client only renders the returned `MoneyView`s (never computes a
balance/split/fee/conversion). Added to the SSOT (never inlined):
**`packages/types/finance/wallet.ts`** (`MoneyView` + the read projections
`WalletOverview`/`WalletSwitcher`/`TransactionPage`/`ActivityView`/
`PayoutsView`/`FundingView`/`MethodsView`/`InvoicesView`/`AccessView` + the action inputs + the pure
`formatMoney`/`capabilitiesForRole`/`walletVariant` helpers + the `WalletQuery`/`WalletSim` read
shapes). **The wallet is the finance face of the active context** (Decisions #16/#17): a personal
wallet, a team/business/organisation vault (same route, `?w=scope:id` switcher override), or a
read-only **"All accounts"** aggregate rollup; three overview faces (personal freelancer/client ·
team split · business burn-down). Fixtures DERIVE a coherent finance world from the SAME cast as the
rest of the app (`nav-fixtures` `northwind`/`atlas-collective`/`monarch-labs`/`verdant-studio`,
fixed clock, unsigned `>>>` hash, TDZ-safe) + a mutable session STORE so
top-up/withdraw/transfer/distribute/fund-escrow/
recurring/method/payout/spend-request/smoother-enrol are exercisable — **no DB migration** (a
read+write projection over fixtures; the RLS-scoped `finance.*` tables + money functions are the
deferred live path, slotting in behind the same gate with zero shape churn). **Reuse (relentless):**
the lane (`WalletLane` + collapsed `WalletRail`, `.ui-splitter[data-mode]`) from the shared
`@projective/ui/navigation` LaneChrome; the Transactions ledger from the Files
`FileTable`/`useVirtualScroll`/`ZoomSlider` (footer View Control Rig via `walletFooterFor`,
`LocalKeys.WALLET_ZOOM`/`WALLET_COLUMNS`); the modals from `Dialog`+`BodyPortal`+`InputNumber`; the
Income Smoother/verification-lock states; charts hand-rolled + `d3-scale`/`d3-shape` inline SVG
**app-side** (Decision #1 tier-1; kept OUT of `packages/ui` per its no-deps portability contract →
**no new `@projective/ui` primitive → no `DESIGN_SYSTEM.md` §C.1 change**). **RtL:** CSS logical
properties ONLY — verified the whole surface mirrors to the opposite edge under `dir="rtl"` with
zero horizontal leak. **Dev Context Switcher parity (§5 merge gate):** SIX new axes — vault role
(Owner/Admin/PM/member) · KYC state (verified/unverified/payout-not-set-up) · Income-Smoother state
· fund-state mix · display currency · layout direction (ltr/rtl/auto) — added across `dev-seam.ts`
(READ contract) + `dev-context.ts` (`DevOverrides`+`DEV_DEFAULTS`+`DevOption`+`reflect()`
set/delete, incl. `root.dir`) + `DevContextPanel` (a "Wallet / Finance" control group); each drives
a LIVE server refetch (the island passes them as query params — the server never sees the client
seam). Lane + footer resolved by `walletLaneFor`/`walletFooterFor` in `(dashboard)/_layout.tsx`.
Verified end-to-end (personal/team/ business faces from context, three-state balances, all deep
pages, d3 charts, the KYC lock, all six axes incl. £→€ conversion + RtL mirror, the write path
top-up, guest bounce). **Flagged (surface, do not silently resolve):** (a) the account switcher is a
WALLET-local control (personal · vaults · aggregate), NOT unified with the header context switcher —
reconcile whether switching a wallet should re-stamp the active context; (b) **FX spread /
conversion-fee economics remain OPEN** (finance-model §11) — the surface displays origin amount +
converted amount + rate only, never a fabricated fee; (c) the **Instant Payout fee magnitude is
TBD** platform-wide — disclosed as "a small fee applies", never a %; (d) the RtL document `dir` is
currently driven by the dev axis over a shell-root LtR default — the REAL
`org.user_preferences.layout_direction`-driven `dir` at the shell root is a small additive TODO (the
pref isn't in the chrome JWT); (e) member / counterparty links follow the canonical `/@handle`
(Decision #3), not `/profiles/[id]`. | `SYSTEM_ARCHITECTURE.md` §Backend Services ·
`packages/types/finance/wallet.ts` · `packages/backend/services/finance/` ·
`packages/backend/core/{env,supabase}.ts` · `apps/web/features/wallet/` ·
`apps/web/routes/(dashboard)/wallet/*` · `apps/web/routes/api/wallet/*` ·
`apps/web/routes/(dashboard)/_layout.tsx` · `apps/web/utils/{dev-seam,storage-keys}.ts` ·
`apps/web/features/devtools/` · Decisions #1 / #10 / #16 / #32 / #37 / #48 / #53 / #54 |

| 56 | **Availability & Discovery Calls — documentation + database FOUNDATION (2026-07-24).** A
**docs + DB-only** pass (NO UI / islands / routes / features / backend services), mirroring the
Decision #54 shape. Adds **5 additive, timestamped migrations** (`20260724100000`–`104000`) — (1)
the **twelfth schema `scheduling`** + owner schedules + weekly availability bands + blackouts, (2)
the **first tables in the long-declared-but-empty `integrations` schema** (provider catalogue +
per-user OAuth connections + consent audit), (3) `scheduling.events` (the persisted backing for the
`CalendarEvent` projection) + free/busy predicates, (4) discovery-call settings / the booking record
/ the "Digital Handshake" attendance log / the transition audit, (5) the in-DB **booking gate**
(timezone-aware band coverage, buffer-widened conflict detection, the refusal-code function, the
legal-transition + audit triggers, and five new `security.platform_params` knobs) — each **RLS-on
with policies**, **additive-only** (no FK/table/column drop; **no protected Escrow/Wallet/Stage
table touched at all**), **authored, NOT applied to any live DB** (a human step, Decisions #47/#54
precedent). Lands with the **Zod SSOT** (new `@projective/types/integrations`; new
`scheduling/rows.ts` + `scheduling/calls.ts`; additive optional fields on the existing
`scheduling.ts` projections) and the **de-stubbed**
`documentation/database/{scheduling,integrations}/{Tables,Policies,Functions}.md` + `Schemas.md` /
`README.md`. Business/arch: `PRODUCT_SPEC.md` §Discovery & Courtesy Calls (a THIRD discovery path
under §The Hiring Process), `SYSTEM_ARCHITECTURE.md` §Conferencing 2.1/2.2 + the Environment
Variable Contract (connection-OAuth keys), `PRODUCT_MANAGEMENT.md` §3.5 (two new domain lifecycles).
**Key decisions:** (a) **A discovery call is a conversion tool, not a deliverable** — no
Project/Stage/Ticket, never in the §3.1 delivery state-machine, no Workload Intensity; a
**reschedule is not a state** (return to `proposed` + a counter). (b) **Courtesy (free) vs paid** —
the free "Calendar Handshake" has no payment, no escrow, no KYC gate and must stay bookable by
someone who has connected nothing. (c) **Authentication ≠ authorization** — the GoTrue sign-in OAuth
retains no API token; `integrations.user_connections` is a separate consent, **definer-only** (RLS
on, no policy, no `authenticated` grant) with ciphertext-only tokens, read through the
`v_my_connections` view so column safety is **structural, not a policy**. (d) **Calendar sync and
conferencing are two axes** (`providers.capabilities` is an array; `INTEGRATION_SOURCES` vs the new
`CONFERENCING_PROVIDERS`), never one chip set. (e) **Working hours vs call windows** are two layers
(`scheduling.availability_kind`) — "I am working" ≠ "interrupt me". (f) **A discovery call is a
`booking`, NOT a tenth `CalendarEventKind`** — a new kind would break the shipped engine's
exhaustive `Record<CalendarEventKind, …>` maps (§3). (g) **The booking rules live in triggers, not
policies** — one refusal function backs both the pre-flight UI check and the hard `BEFORE INSERT`
gate, so they cannot drift and PostgREST cannot bypass them; both triggers skip when `auth.uid()` is
NULL (service-role owns its own layer). (h) **Shape is public, content is not** — a published
schedule exposes bands/blackout spans/free-busy kinds to `anon`; blackout **labels** need
`label_is_public` because a policy cannot mask a column. **Reused, NOT forked:** money is the
existing `(amount_minor, currency)` pair; visibility mirrors `finance.fn_owner_visible`; project
events reuse `projects.has_project_access`; the knobs go in the existing `security.platform_params`;
`projects.session_events`/`cohorts`/`session_attendance` remain the SSOT for paid Session delivery
(mirrored, never replaced) and `org.freelancer_profiles.availability_status` stays the coarse
ranking cache. **Flagged conflicts (surface, do NOT resolve):** (a) **Paid calls have no escrow
path** — `finance.escrows` requires BOTH `project_stage_id` and `payer_business_id` NOT NULL, so a
standalone 1-1 paid call is inexpressible; `escrow_id` is nullable and set only for an
already-funded stage. Relaxing those columns (a **protected** table, §1) or auto-provisioning a
session-format micro-project both need human sign-off. (b) **Cancellation economics** — the
pre-existing `finance-model.md` §4 (50%) vs `PRODUCT_SPEC.md` §Sessions (full forfeit) conflict is
untouched; the schema records `refund_amount_minor`/`penalty_amount_minor` as OUTCOMES so either
rule is expressible without a migration. Courtesy-call rules are NEW and deliberate: **no financial
consequence**, reliability signal only. (c) Whether that reliability signal feeds
`security.penalties` / discovery rank is undecided. (d) The shared-entity schedule **write** gate is
"any active member" / `org.is_team_lead`; tightening it to a specific
`org.team_permission`/`business_permission` needs a human. (e) **`documentation/database/Schemas.md`
has always listed 11 schemas but `0001_init_schemas.sql` creates 12** — it also creates
**`reviews`**, undocumented and folder-less; `scheduling` makes the documented set 12 of the
real 13. Reconciling `reviews` needs a human. (f) An availability band **cannot cross local
midnight** (`end_minute > start_minute`) — a deliberate simplification, so 23:00–01:00 is two bands.
| root CLAUDE.md §1/§3/§5/§6 · `supabase/migrations/20260724100000..104000_*` ·
`packages/types/integrations/*` + `packages/types/scheduling/{rows,calls,scheduling}.ts` ·
`documentation/database/{scheduling,integrations}/*` · `documentation/database/{Schemas,README}.md`
· `PRODUCT_SPEC.md` §The Hiring Process · `SYSTEM_ARCHITECTURE.md` §Conferencing + §Environment
Variable Contract · `PRODUCT_MANAGEMENT.md` §3.5 · Decisions #37 / #47 / #54 |

| 57 | **Notification Engine — documentation + database FOUNDATION (2026-07-24).** A **docs + DB +
Zod-only** pass (NO UI / islands / routes / features / backend services), mirroring the Decision #54
/ #56 shape. Adds **5 additive, timestamped migrations** (`20260724090000`–`094000`) — (1) the
**`comms.notification_types` catalog** (routing policy as data: category · urgency · default channel
fan-out · mute-ability · quiet-hours override · dedupe window · audit flag; **81 event keys
seeded**) plus the additive event-envelope columns on `comms.notifications` (`category`, `urgency`,
`actor_user_id`, `context_type`/`context_id`, `action_url`, `payload`, `group_key`/`group_count`,
`channels`, `seen_at`, `archived_at`, `expires_at`) and 9 partial indexes; (2) **preference
granularity** — recurring, timezone-aware quiet hours + digest cadence + global snooze +
`escalate_after` on `comms.notification_prefs`, the new sparse `notification_category_prefs` and
`notification_type_mutes`, and a real `device_tokens` shape (platform · Web Push endpoint/keys ·
soft-revoke · failure count) with a seed-on-signup trigger; (3) **delivery & scheduling** —
`notification_deliveries` (one row per notification × channel × device), `notification_queue`
(durable, cancellable, dedupe-keyed promises), `notification_digests`, `delivery_events` (the
webhook idempotency ledger) and `channel_suppressions`; (4) the **router + writer** — `fn_notify`
(compatible superset of the 0305 six-arg signature), `fn_resolve_channels`, `fn_is_quiet_hours`,
`fn_is_suppressed`, the inbox RPCs, and three `security_invoker` read views; (5) **RLS, grants,
realtime, `pg_cron` jobs** and a feature-flagged outbound dispatch trigger. **THE HEADLINE FIX:**
`comms.notifications`/`notification_prefs`/`device_tokens` have had RLS **enabled since 0201 with
ZERO policies** — default-deny — so `authenticated` could never read a notification and Realtime
(publishing the table since 0206) could never emit one; the in-app channel has never worked. Lands
with the **Zod SSOT** `@projective/types/comms` (`common`/`catalog`/`notifications`/`preferences` +
the `./comms` export) and the de-stubbed
`documentation/database/comms/{Tables,Policies,Functions}.md` (Policies + Functions were
`_Not yet documented._`), plus `Schemas.md`, `database/README.md`, `PRODUCT_MANAGEMENT.md` §3.5 (two
new domain lifecycles: notification delivery + scheduled notification) and `SYSTEM_ARCHITECTURE.md`
§The Notification Engine. **Verified against a real Postgres 16** (throwaway container,
Supabase-shaped scaffold): all 5 migrations apply clean; legacy alias resolution, collapse,
quiet-hours push-drop, critical-pierces-quiet-hours, mandatory-survives-snooze, per-type mute, audit
write, queue dedupe + processing, per-device push fan-out, feed exclusion of muted rows, expiry
sweep, escalation idempotency and suppression semantics all behave; RLS verified as an
`authenticated` role (own-rows-only, forging blocked, reassignment blocked). **Authored, NOT applied
to any live database** (a human step, Decisions #47/#54/#56 precedent). **Design invariants:** the
catalog is **policy, not a gate** (deliberately NO FK from `notifications.type`, and `fn_notify`
auto-registers an unknown key); **the engine never raises** (it is called from inside escrow/stage
RPCs); a notification **row is always written** while `channels` records what the router decided
(empty = recorded, delivered nowhere); there is **no client INSERT policy**, so _"Payout sent"_
cannot be spoofed; nothing is hard-deleted (dismiss = `archived_at`). **Flagged conflicts (surface,
do not silently resolve):** (a) **key-convention split** — `comms/Tables.md` has always documented
dotted keys (`message.new`) but the live escrow callers (0305/0311) emit underscored ones
(`stage_funded`, `stage_approved`, `stage_cancelled`, `project_handover`); resolved
non-destructively (dotted canonical + the four legacy keys in `aliases[]` + `fn_resolve_type_key`)
so those call sites are untouched — **rewriting the money-movement RPCs needs human sign-off**. (b)
**`quiet_hours tstzrange` superseded** — it is an ABSOLUTE range and cannot express a recurring
nightly window; kept under the Additive Rule and still honoured, with the new
`quiet_hours_*`+`timezone` columns authoritative. (c) **`digest boolean` superseded** by
`digest_frequency` (backfilled `true`→`daily`). (d) **`org.user_preferences`
`notification_email`/`notification_push` are a second, coarser copy** of the same toggles (seeded by
Decision #47's trigger) — `comms.notification_prefs` is the engine's SSOT and the two are **not
reconciled** (a data decision). (e) `fn_notify` is replaced via **DROP + CREATE**, not
`CREATE OR REPLACE` — adding defaulted params changes the signature and keeping both would make a
six-arg call ambiguous; every existing call site still resolves to the new function unchanged. (f)
**Push/email/SMS have no transport yet** — the `dispatch-push`/`send-email` Edge Functions, the
VAPID keypair, FCM/APNs credentials and an SMTP/email-provider block in `config.toml` are the
deferred live path; the outbound trigger ships **feature-flagged off** with an `XXXX-XXXX`
placeholder URL. (g) `pg_cron`/`pg_net` are **optional** — registration is guarded and only raises a
`NOTICE`, so the jobs may need scheduling by hand. | root CLAUDE.md §1/§5/§6 ·
`supabase/migrations/20260724090000..094000_*` · `packages/types/comms/*` ·
`documentation/database/comms/{Tables,Policies,Functions}.md` ·
`documentation/database/{Schemas,README}.md` · `SYSTEM_ARCHITECTURE.md` §The Notification Engine ·
`PRODUCT_MANAGEMENT.md` §3.5 · Decisions #47 / #54 / #56 |

| 58 | **Subscriptions, Entitlements & the earned Standing ladder — documentation + database
FOUNDATION (2026-07-24).** A **docs + DB + Zod-only** pass (NO UI / islands / routes / features /
backend services). Adds **4 additive, timestamped migrations** (`20260724110000`–`113000`) — (1) the
**`analytics` event substrate** (that schema's first tables: `event_catalogue` · append-only
`events` · `daily_rollups` · `fn_emit` · `v_unregistered_events`), (2) the **earned Standing
ladder** in `org` (`standing_levels` · `entity_standing` · `standing_events` · `create_mastery` ·
`achievements` + `entity_achievements` · `quality_streaks` +
`fn_recompute_standing`/`fn_award_achievement`/ `fn_touch_streak`/`fn_record_mastery`), (3) the
**paid ladder** in `finance` (`plans` · `plan_entitlements` · `subscriptions` **extended
additively** · `subscription_events` · `entitlement_grants` · `standing_commission_tiers` ·
`negotiated_rates`), (4) **resolution, metering & enforcement** (`allowance_periods` ·
`allowance_ledger` · `fn_effective_limit`/`fn_has_entitlement`
/`fn_effective_commission_bp`/`fn_effective_platform_fee_bp`/`fn_current_allowance`/
`fn_consume_allowance`/`fn_footprint_usage` + three param-gated triggers) — each **RLS-on with
policies**, **additive-only** (no table/column/FK/function/trigger dropped; the pre-existing
`finance.subscriptions` skeleton is EXTENDED and its legacy `plan`/`status`/`profile_id` columns
mirrored by a BEFORE trigger rather than relaxed), **authored, NOT applied to any live DB** (a human
step, Decisions #47/#54 precedent). Lands with the **Zod SSOT** (`@projective/types/analytics` — a
NEW sub-path — + `org/standing.ts` + `finance/{plans,entitlements}.ts`) and the de-stubbed
`documentation/database/analytics/{Tables,Policies,Functions}.md` plus `org`/`finance`/`Schemas.md`/
`README.md` updates. Business: `finance-model.md` §1.1–1.5 rewritten + new §16 (concrete numbers),
`PRODUCT_SPEC.md` §Escrow…#7 "Subscriptions, Allowances & Entitlements" + §Reputation…#5 "Standing,
Mastery & Progression" (abstract rules), `PRODUCT_MANAGEMENT.md` §3.5 (+3 domain lifecycles).
**Architecture — the three axes:** execution capacity is **never** monetised ($W_i$ caps stay the
sole authority); only **distribution** (proposals) and **marketplace footprint** are tiered; and a
plan **accelerates capacity but can never buy reputation** (nothing in `finance` writes to
`org.entity_standing`; every Standing mutator is `REVOKE`d from `public`). **Reused, NOT forked:**
Standing is the discretised rung of the EXISTING Reliability Index ($R_i$, `PRODUCT_SPEC.md`
§Reputation & Discovery), not a competing score; `security.penalties` remains the penalty SSOT;
`finance.subscriptions` was extended rather than replaced; the "Architect" designation is seeded
into `org.achievements` rather than reinvented. **Owner decisions applied (2026-07-24):** Individual
Pro = **£12.99/mo**; free published listings **10 scaling with rank** (Pro = 2×); active public
projects **3 free / 15 Pro**; **no cap on joining** teams/businesses; the 5% **may** flex for
Organisation volume deals; governing constraint = _"never feel suffocated; upgrading should just
make sense."_ **Flagged conflicts / open items (surface, do NOT silently resolve):** (a)
**`finance-model.md` §1.1 reworded** — "no paywall on freelancer **project** volume" → "no paywall
on **execution** volume"; this is a real semantic change to a previously absolute guardrail, made on
the owner's explicit instruction, and is logged here rather than applied silently. (b)
**`business_pro` price is unset** — entitlements seeded, `finance.plans.price_cents` deliberately
`NULL`. (c) **Enforcement ships fail-open** — `proposal_allowance_enforced` +
`footprint_caps_enforced` default `false`, so the caps **meter** but never refuse; flipping them
changes live user-visible behaviour and needs a human. (d) **`published_listings` usage count
returns 0** until the `catalogue.*` tables land (Decision #53 keeps `/catalogue` on fixtures) — the
cap already resolves, only its live count is pending. (e) **Standing is never recomputed by a
trigger** — it is a sweep (`standing_recompute_interval_hours`), because recomputing reputation
inside a stage-approval transaction would couple money movement to reputation math; the sweep job
itself is not yet written. (f) `standing_demotion_grace_days` is seeded but **not yet consumed** by
`fn_recompute_standing` (anti-flapping guard reserved). (g) `finance.plan_entitlements`
`organisation_businesses` counts 0 because businesses are **not yet FK-linked** to an organisation
(Phase 2). (h) The Standing metric inputs (`completion_rate`, `on_time_rate`, dual-track ratings,
`dispute_rate`, `workload_reliability`) have **no writer yet** — the backfill from
`projects.*`/`finance.ratings` is a follow-up. (i) **Timestamp collision avoided:** these migrations
were renumbered from `2026072409xxxx` to `2026072411xxxx` because the concurrent Notification Engine
(#57) had already claimed the `090000`–`094000` slots. (j) **Denial telemetry goes dark once
enforcement is ON** — the `RAISE` that blocks also rolls back the `entitlement.denied` row written
moments earlier (Postgres has no autonomous transactions); after either param is flipped, the app
layer must catch the `check_violation` and emit the denial itself, or the conversion funnel stops
being measurable exactly when it starts mattering. **Validated by execution, not inspection:** all
four migrations were applied to a throwaway Postgres 16 container against a stub of their
dependencies, and the resolver / metering / enforcement paths exercised (free→Pro resolution, rung
scaling 10→20→40 listings, 50→70→170 proposals, the L5 volume floor holding a 95.9-score subject at
L4, legacy-column mirroring, buffer exhaustion, draft-vs-live footprint, and both triggers refusing
once switched on). | root CLAUDE.md §1/§5/§6 · `supabase/migrations/20260724110000..113000_*` ·
`packages/types/{analytics,org/standing,
finance/{plans,entitlements}}` ·
`documentation/database/{analytics,org,finance}/*` · `documentation/database/{Schemas,README}.md` ·
`finance-model.md` §1/§16 · `PRODUCT_SPEC.md` §Escrow/Wallets/Finance #7 + §Reputation & Discovery
#5 · `PRODUCT_MANAGEMENT.md` §3.5 · Decisions #2 / #47 / #53 / #54 / #57 |

| 59 | **Integration & Plugin Platform — `integrations` schema redesigned from scratch (2026-07-25).
Docs + DB + Zod-only** pass (NO UI / islands / routes / features / backend services). The
calendar-only connection store (Decision #56) is generalised into the platform's **connector +
plugin substrate**, architected on the rule that "integration" is **four systems with irreconcilable
trust models — Auth (GoTrue), Infra (Stripe/Maps, server keys), Connectors, Plugins** — and the unit
of architecture is the `(provider, capability)` pair, NOT the vendor. **(A) Connector substrate**
(generic provider/consent/sync framework so a 50th connector is a seed row + adapter code, never a
schema change): `integrations.providers` enriched (category vs. multi-valued capability axes,
`auth_scheme`, `broker` recording the integration STRATEGY — calendar→Nylas unified API,
storage/dev→direct, CRM tail→Merge, always wrapped behind our own adapter), `user_connections` now a
`(user, provider, external_account_id)` **state machine**
(`pending→active→degraded→expired/revoked/
disconnected`, multi-account per vendor), the token vault
**split into `connection_secrets`** (its own table, **no policy/no view/service-role only**, KMS
**envelope encryption** via `key_id`, never a symmetric env secret), `connection_sync_state` (delta
cursors), `webhook_subscriptions` (first-class `expires_at` a cron renews) + `webhook_deliveries`
(idempotency ledger, dedupe on `(provider_slug, external_delivery_id)`), `connection_audit`. **(B)
Plugin ecosystem** ("Projective OS", post-MVP, schema+seams laid now so the later build is not a
rewrite): `extension_points` (the slot registry — first-party counterpart of the app's
`channelHeaderFor`/`laneFor`/`middleNavFooterFor` resolvers), `plugin_scopes` (capability-permission
vocabulary AS DATA), `plugins` + `plugin_versions` (GitHub-hosted, SRI-pinned `bundle_url` on a
SEPARATE origin, manifest jsonb), `plugin_installations` (scoped consent, `granted_scopes` the
mediator enforces), `plugin_grants` (hashed client secrets, headless/automation) + `plugin_audit`.
**Trust model is adversarial (Figma/Shopify, NOT Obsidian):** third-party code never runs in the
host origin (sandboxed cross-origin iframe / declarative Block-Kit tier the host renders with
`@projective/ui`; **Shadow DOM is a styling boundary, not a security one**); every data touch is
capability-scoped through a server Plugin-API mediator (`fn_plugin_has_scope`) — a plugin is a
first-party OAuth client with extra UI rights. **The three retrofit-killing seams already hold
today:** thin-routes/fat-services (a plugin `/api/*` call == an island `/api/*` call — anything a
plugin could call already goes through HTTP, never a service import), the slot-resolver pattern, and
the token-only design-system contract. Enums greatly expanded (`provider_kind` 2→12,
`provider_category`, `auth_scheme`, `sync_direction`, `webhook_status`, `connection_action` + 8
plugin enums). Preserves `providers.slug` + `user_connections.id` PKs (scheduling FKs untouched).
Full functions/triggers/RLS/grants/views/indexes/seed wired; a `v_plugin_catalog` LATERAL view
replaces a circular `latest_version_id` FK. Zod SSOT split into
`providers.ts`/`connections.ts`/`plugins.ts` (+ `common.ts`), NO token/secret shape anywhere.
Consolidated edit-in-place (root CLAUDE.md §1) — **NOT applied to any live DB** (a human step,
Decisions #47/#54 precedent). **Deferred (code, not migrations):** the consent handshake, the
**proactive token-refresh scheduler** (refresh before expiry, not lazily on 401), webhook ingestion

- channel renewal, canonical-model sync adapters, per-user + global rate limiting, and the entire
  plugin SDK/CLI/review-pipeline/marketplace (post-PMF). **AI workflows/automation agents ride the
  same capability-scoped Plugin API — an agent is a `headless` plugin.** **Flagged (surface, do not
  silently resolve):** (a) connections stay **per-user** (the freelancer-workspace scope), NOT
  per-vault — a team/business shared connection would need an owner axis; deferred. (b) `outlook` +
  `microsoft_teams` remain **separate vendor rows** (both Microsoft) to preserve the scheduling FKs
  rather than consolidate to one `microsoft` slug + capability array; reconcile if a unified
  Microsoft provider is wanted. (c) `notion` keeps its `calendar` capability (Decision #37's
  `INTEGRATION_SOURCES` lists it) AND gains `docs`; confirm Notion-as-calendar is still intended. |
  `SYSTEM_ARCHITECTURE.md` §Integration Blueprints #3 (§3.1–3.4) ·
  `documentation/database/integrations/{Tables,Policies,Functions}.md` ·
  `documentation/database/{Schemas,README}.md` · `packages/types/integrations/*` ·
  `supabase/migrations/{00000004,00000020,00001500,00001870,00002001,00002015,00002510,00002520,00003004,00003005,00004008,00005050}*`
  · Decisions #37 / #47 / #54 / #56 |

| 60 | **Wallet & Finance surface — complete redesign to a band architecture (2026-07-28).
SUPERSEDES the presentation of Decision #55.** The `/wallet` frontend is rebuilt from a boxed card
grid into a **vertical stack of FULL-BLEED bands**. The single biggest change:
`max-inline-size: 1100px;
margin-inline: auto` is **deleted** from both `.wallet-overview` and
`.wallet-page` — on this surface a money figure, a chart and a table always get the whole content
region, and `max-inline-size` now survives in exactly two places (`.wlt-prose` running text,
`.wlt-formfield` form fields) with a rule forbidding any figure/chart/table from being their
descendant. The whole `.wallet-*` BEM tree is replaced by `.wlt-*`; `wallet.css` becomes an
`@import` barrel over 13 sheets. **Region contract (strict):** the LANE owns the account switcher +
section nav + an ambient verification chip; a **NEW middle-nav HEADER band** (`walletHeaderFor`,
composed into `middleNavHeaderFor` — the wallet had none before) owns identity + the 30/60/90
range + search/filter entry + the display-currency toggle; the FOOTER band (`walletFooterFor`,
widened from `/wallet/transactions` only to **every** `/wallet*` route) owns every money action +
density/sort + Export; the BODY owns viewing and selecting data ONLY — no tabs, no filter dropdowns,
no primary CTAs. **The signature element** is the four-state capital meter: one shared rail split by
`flex-grow` into Available/Locked/Pending/On-hold with **no minimum width ever** (a sliver gets an
achromatic overhanging pip instead of a dishonest floor), the track `aria-hidden` and decorative
while the legend carries every fact in five redundant static channels (shape mark · label · figure ·
printed % · tone). Locked is `color-mix(--primary 34%,
--surface-2)` — the same hue as spendable
cash at a lower temperature, so escrowed capital reads as stored, never blocked; **`--danger` is
banned above the fold** and appears only on a ledger reason chip, the Standing penalty bar, and a
band-scoped error. **Two gates behave differently on purpose:** capability → **absence** (a member
never sees Access or Distribute), verification → **rendered but locked** with the one permitted lock
glyph and a nudge carrying `verification.prompt` (removing it hides the path to getting paid;
locking it teaches it) — `quickActionsFor` was changed to stop folding `canWithdraw` into the OFFER
so the client can draw the lock. **Additive SSOT** (no DB migration — still a read+write projection
over fixtures): `WalletOverviewSchema.capital` (server-summed, so the client never totals money),
`lockedStageCount`, `heldCaseCount`, `IncomingItemSchema.clearingFraction` (server clock — an
unsynced client would draw a dishonest 7-day ring), and **`WalletStandingSchema`**

- `StandingRung`/`StandingComponent`/`StandingGate`, carrying the earned ladder verbatim from
  `finance-model.md` §16.3 and the commission taper priced as MONEY against the wallet's own
  trailing volume. The **Standing gauge** renders the rung as what it PAYS: an arc for the
  continuous index, a **hatched ceiling veil** for everything past the stage-gated rung, and a
  separate LINEAR stage meter — because a rung has TWO conditions and an arc can only encode one, so
  the score may sweep past a notch while the rung honestly does not advance. It carries no button,
  plan badge or upgrade affordance: Standing is earned and can never be bought (§16.5). A **7th Dev
  axis** (`walletStanding`, incl. the `stage_floor` edge case) mirrors it per §5. **Three defects
  found and fixed in verification, all the same class — a fact depending on an animation or a scope
  that may not resolve:** (a) the hero count-up painted a starting `0` before its first `rAF`, so a
  backgrounded tab showed £0.00 for a funded wallet — it no longer lowers a figure it cannot raise,
  and a watchdog snaps to the server string; (b) the meter's segments animated `flex-grow` with a
  `backwards` fill, so a frozen animation clock left every share at zero width — motion now only
  ever decorates `transform`/`opacity`, never the property that encodes data; (c) the local token
  layer was scoped to `.wlt`, but the lane, header band, footer rig and every `BodyPortal` overlay
  render OUTSIDE it, so all `--wlt-*` silently fell back — tokens are now on `:root` (all names are
  `--wlt-`-prefixed). Also: `opacity` replaces `color-mix(… currentColor …)` for the pence
  de-emphasis (engines drop a `currentColor` mix that is itself defining `color`), and the fade
  token is unitless (a `%` through `var()` is rejected by older `<alpha-value>` grammar). **No new
  `@projective/ui` primitive** (reuses Drawer · Dialog · Popover · Tooltip · Avatar · Select ·
  SelectButton · InputNumber · InputText · Checkbox · ZoomSlider · Grid · Message · Alert ·
  LaneChrome) → **no `DESIGN_SYSTEM.md` §C.1 change**; no lifecycle change → no
  `PRODUCT_MANAGEMENT.md` change. Verified in-browser: all four variants (personal/team/business +
  read-only aggregate), all 7 deep pages, the Transfer flow end-to-end (footer → drawer → modal
  reading `Transfer £250.00` → success → the movement appears in the ledger), light + dark,
  `dir="rtl"` (lane 64→1241, deck 1165→51, segments reverse, **zero horizontal overflow both
  directions**), mobile 390px, the verification lock, the member capability gate, and the
  converted-currency 2×2 reflow. **Flagged (surface, do not silently resolve):** (a) the fixtures
  now generate Standing for a `team` subject too, but per the brief the gauge renders only in the
  PERSONAL intelligence band — decide whether a team vault should surface its own rung; (b)
  `/wallet/access` capability toggles and the `/wallet/methods` detail drawer remain optimistic
  stubs pending `FINANCE_BACKEND_LIVE`; (c) the FX spread and the Instant-Payout fee magnitude stay
  undecided platform economics and the surface deliberately renders neither — three facts inline
  (origin · converted · rate) and the literal phrase "a small fee applies". |
  `packages/types/finance/wallet.ts` · `packages/backend/services/finance/wallet-fixtures.ts` ·
  `apps/web/features/wallet/**` · `apps/web/routes/(dashboard)/wallet/*` ·
  `apps/web/routes/(dashboard)/_layout.tsx` · `apps/web/utils/dev-seam.ts` ·
  `apps/web/features/devtools/` · Decisions #1 / #10 / #54 / #55 / #58 |

| 61 | **Teams & Businesses — the multi-member entity console (`/teams`, `/businesses`)
(2026-07-30).** The 16th thin-frontend/fat-backend read and a write surface, built on one mental
model: **a Team is a Freelancer with multiple members (seller side); a Business is a Client with
multiple members (buyer side).** An entity is not a new persona but an existing one made multi-seat,
so the surface is ONE architecture parameterised by `WorkspaceKind` and the diff between the kinds
is a **capability table** (`capabilitiesForKind` · `presetCapabilities` · `kindCopy`), never a
duplicated folder: both kinds share the same routes-shape, lane, bands, roster, console, module
dispatcher and screens, and `consoleOutcome(kind, …)` differs by one argument. New Zod SSOT
**`@projective/types/workspace`** (`common` vocabulary + capability table · `members` incl. the
three-layer permission engine · `policy` money governance · `workspace` read/write projections +
`WorkspaceSim`), fat **`WorkspaceBackendService`** (`@server/services/workspace/`) behind the NEW
**`WORKSPACE_BACKEND_LIVE`** (default off), thin `/api/workspace/*` (13 routes) +
`/api/context/switch`. **No DB migration** — the live path reads the EXISTING `org.teams` /
`org.business_profiles` / `org.*_members` / `org.*_roles`, which is why the projections live under
their own `workspace` sub-path rather than the DB-row-mirroring `org` one. **(A) The module registry
(`core/module-registry.tsx`) is the extensibility core:** one array drives the lane's grouped nav,
the collapsed rail, the `[module]` route validator and the permission gate. Adding a module is one
entry + one component. `permission` is a **function of kind** and may return **`null`** = every
active member may view — load-bearing, not lazy: Overview is permissionless, so a capability-less
member always has a landing module and the **"never 404 a user out of their own workspace"**
invariant is satisfiable. Three route outcomes are deliberately distinct: an unregistered segment is
a miss, a REAL module the viewer may not open **redirects** to `firstModuleFor(...)`, otherwise it
renders. **(B) Three-layer permissions:** preset roles (read-only bundles;
`Duplicate to custom role` is the escape hatch) → entity-scoped custom roles → per-member overrides,
with the effective set `role ∪ granted − revoked` computed by ONE pure SSOT function
(`effectivePermissions` / `permissionFacets`) so the matrix, the member drawer, the roster row and
the server guard cannot disagree. Overrides render their PROVENANCE (`+ granted` / `− revoked`)
rather than only the outcome. `mayGrant` blocks privilege escalation; the last owner routes to a
real **ownership transfer** instead of a refusal. **(C) Money diverges by kind, honestly:** a team's
money comes IN then SPLITS (multi-handle split bar whose dividers ARE the total — `rebalanceSplit`
holds the 100% invariant in integer basis points, held stakes are immovable and never redistributed,
full keyboard parity via `role="slider"` with money-bearing `aria-valuetext`); a business's comes in
FROM members then out as PURCHASES (attributable contribution ledger, per-member envelopes reusing
`finance.spending_limits` semantics, and `evaluateSpend` returning **`needs_approval` as a
first-class outcome** so a blocked purchase always offers the request path). All money is
server-computed `MoneyView`; the client never totals, splits or converts. **(D) Two switchers stay
distinct** (closes Decision #55's flag (a)): the global `useContextSwitch` re-stamps the JWT
(`security.switch_session_context` → `/api/auth/refresh` → hard nav) and carries the "Acting as"
language; `/wallet`'s `?w=` is a page-local VIEW scope that never claims to change who you are.
**(E) `/businesses` (plural) is canonical** — the singular `/business` routes were deleted and
`nav-model` / `nav-fixtures` / `actions-model` / `UserActions` repointed (creation now
`/teams/create` · `/businesses/create`, not `/new`). **(F) Dev parity (§5 merge gate):** six axes —
entity kind · entity role (incl. `non_member`) · membership state · verification · acting context ·
roster shape — wired end-to-end through `dev-seam` + `dev-context` (`DevOverrides` · `DEV_DEFAULTS`
· `DevOption` lists · `reflect()` set AND delete) + a "Workspaces" panel group, and because the
switcher is a CLIENT seam the server cannot see, they travel as validated `sim*` QUERY PARAMS
(`WorkspaceSim`, the `/wallet` precedent) which **survive the gate's own redirect** (`preserveSim`)
and are ignored on the live path. **Bugs found and fixed in verification:** (1) a `Response`
returned from a Fresh `define.page` component is dead code, so the redirect never fired and every
gated module rendered a BLANK body — the resolution moved into `define.handlers` + `page()`; (2)
both policy screens measured "unsaved changes" against the immutable SSR prop, leaving the footer
permanently dirty after a successful save — the baseline is now a signal adopted from the server's
own response. **Flagged (surface, do not silently resolve):** (a) the **Businesses nav gate**
remains `businessAccountEnabled` while migration `20260709` gates on `org.users_public.is_operator`
— settling the buyer-side question rules out `isFreelancer` but the remaining two still need one
human decision (inherits Decisions #17/#18); (b) **Organisations** now overlap Businesses
considerably (both buyers with members and a pooled wallet) — own console, scale tier of
`/businesses`, or profile-only is undecided; (c) entity-owned **catalogue scope** still depends on
Decision #53's flag (d) fixtures-own-the-whole-corpus issue; (d) whose payment method funds a
business purchase when the pool is short (fail / prompt to contribute / charge personal) has refund
and attribution consequences and is undecided; (e) member and counterparty links follow the
canonical `/@handle` (Decision #3), not `/profiles/[id]`; (f) `isWorkspaceBackendLive()` lives
beside its service rather than in `core/supabase.ts` with its eight siblings — reconcile if the
gates become one registry. | root CLAUDE.md §2/§3/§5 · `packages/types/workspace/*` ·
`packages/backend/services/workspace/*` ·
`packages/backend/services/context/ContextBackendService.ts` · `packages/backend/core/env.ts` ·
`apps/web/features/workspaces/**` · `apps/web/routes/(dashboard)/{teams,businesses}/**` ·
`apps/web/routes/api/{workspace/*,context/switch}` · `apps/web/routes/(dashboard)/_layout.tsx` ·
`apps/web/features/shell/core/{nav-model,nav-fixtures,actions-model}.ts` ·
`apps/web/features/shell/islands/UserActions.island.tsx` · `apps/web/utils/dev-seam.ts` ·
`apps/web/features/devtools/*` · Decisions #3 / #10 / #16 / #17 / #18 / #53 / #55 |

| 62 | **Iconography unified — the `@projective/ui/icons` contract (2026-07-31).** An icon audit
found the product had **no** icon system: 134 hand-authored `<svg>` roots across 75 files, ~376
named glyphs in 23 independent per-feature modules, **10** declared `stroke-width` values, **7**
viewBoxes, **3** sizing models, **47** rendered sizes (9 of them landing on fractional pixels), and
a **second complete icon family made of Unicode characters** (`▾ ▸ ▲ ▼ ‹ › × ✓ ☰ ⠿ ★ 👤 🗗`, ~85
sites) living inside `packages/ui` itself. Measured end to end the same set rendered its lightest
glyph at **0.93px** and its heaviest at **1.80px** — a 1.93× spread. **NEW 14th sub-path
`@projective/ui/icons`**: a canonical `ICON_PATHS` registry (95 glyphs, values are **thunks** not
VNode constants — closing the Preact VNode-reuse hazard at the source rather than at call sites),
the `Icon` primitive, and **`IconShell`**, the base every feature-owned glyph module now renders
through. **The mechanism is CSS, deliberately:** `icon.css` sets `stroke-width` from `--icon-stroke`
against `.ui-icon` and pairs it with `vector-effect: non-scaling-stroke`, and because a CSS
declaration outranks an SVG presentation attribute, ONE stylesheet normalises all ~376 glyphs
without editing a single path — and a per-glyph override becomes impossible by construction.
`non-scaling-stroke` also **decouples stroke weight from grid**, which is what demotes the 11
off-grid (20/16/14/12-unit) glyphs from blocking to cosmetic. New tokens `--icon-2xs…--icon-xl`
(12·14·16·20·24·32, every step an integer pixel) + `--icon-stroke: 1.5`. **Weight is 1.5, not the
1.8 authoring precedent** — 1.8 was a _declared_ number whose rendered result was that whole spread,
so it never named a weight; 1.5px is the shipped median, the value `packages/ui/feedback` already
rendered at native scale, and it lands on a whole device pixel at 1× and a clean 3 at 2×. **Semantic
collisions resolved:** `/projects` had TWO glyphs split by form factor (desktop rail = briefcase,
mobile bottom nav = an architectural arch labelled "Workspace") — the briefcase is now canonical;
`PinIcon` meant a map pin in auth AND a push-pin in projects → `pin-location`/`pin-fixed`; `XIcon`
meant the X brand mark AND a close cross → `close` (brand marks stay quarantined in
`footer-icons.tsx`); `Archive` meant a compressed-file KIND and an archive ACTION → `archive-box`
for the action. Also fixed: `packages/ui/feedback/core/icons.tsx` was the only glyph module shipping
**without `aria-hidden`**, so every Alert announced its decorative mark before its own text; and a
pre-existing `TS2322` in `fields/components/field-marks.tsx` (an `as const` base object widening
`aria-hidden` to `string`) that the migration resolved. **Flagged (surface, do not silently
resolve):** (a) **`@tabler/icons-preact` is declared in the root import map and imported nowhere** —
a dead dependency and a fourth icon family waiting to happen; remove it or justify it. (b) The
wallet's four 12×12 **fund-state marks are data shape channels, not icons** (Decision #60's CVD
requirement) and deliberately stay off `.ui-icon`. (c) Integer-but-off-ramp sizes (18px, 22px) and
the fractional `font-size` driving `.ui-lane-iconbtn` remain; a control's hit-target is governed by
touch-target rules, not the icon ramp. (d) `nav-icons`/`profile-glyphs`/`view-glyphs` still export
**VNode constants** from their `PATHS` maps — the same reuse hazard the registry now avoids; migrate
them to thunks when next touched. | `DESIGN_SYSTEM.md` **§B.7** (new, merge-gated) + §C.1 roster ·
`packages/ui/icons/` · `packages/ui/styles/index.css` · `packages/ui/deno.json` ·
`packages/ui/feedback/core/icons.tsx` · `packages/ui/fields/components/field-marks.tsx` · 23 feature
`*-glyphs.tsx` modules · Decisions #22 / #25 / #60 |

| 62 | **Fields — one state language, one geometry (`--fld-*`) (2026-07-31).** An audit of all 27
controls in `@projective/ui/fields` (measured in-browser, not read) found a good spine reaching only
the text-input family: the 10 controls composing `.ui-field` were already pixel-identical, while 15
re-declared their own geometry and state vocabulary in parallel. Resolved by promoting a single
**`--fld-*` token layer to `:root`** in `styles/index.css` — geometry ramp, label/hint register,
panel + option-row contract, and a state model where every state declares the same four channels
(**border · surface · ink · ring**) plus a **mark**. On `:root` rather than `.ui-field`
deliberately: a field's label, hint, footer rig and — since the panels now leave the subtree — its
PORTALLED dropdown all render outside the control, so a scoped token would silently fall back for
four of five surfaces (the `--wlt-*` lesson, Decision #60). **Fixed, each verified by measurement:**
the **Knob was unreachable by keyboard** (JSX serialises `tabIndex` onto an `<svg>` as a camelCase
attribute; SVG attribute names are case-sensitive, so `svg.tabIndex === -1` — now lowercase
`tabindex`); **SortControl's menu had no focus ring** (`:hover` and `:focus-visible` shared one rule
with `outline: none`); `aria-valuetext` added to Slider/ZoomSlider via a `formatValue` hook and made
unconditional on Knob (it was gated on the VISUAL `showValue`, and now omits itself when it would
merely repeat `aria-valuenow`); a **24px hit-target floor** (`.ui-hit`, WCAG 2.2 AA 2.5.8) for the
6px slider track, 18px handle, 12px zoom handle, 20px checkbox/radio and 15px stepper; **MultiSelect
was 20px taller than every sibling** when EMPTY (`flex-wrap: wrap` on the root let the clear button
and chevron drop to a second line — wrapping belongs to the chip area alone); **Button +
ToggleButton radius never ramped** (fixed `--radius-base` at all three sizes); **four sibling
dropdowns had four option-row heights** (43.6/38.5/37.0/30.5px, three paddings, two type sizes) plus
divergent panel surface/elevation/max-height and NO `min-inline-size`, so a 71px trigger produced a
71px menu with every label ellipsised away; **five disabled opacities** (0.40–0.55, measuring
2.30–5.04:1) collapsed to one that measures **5.04:1** everywhere, applied to ink and border rather
than the box and no longer paired with `pointer-events: none` (which cancels the `not-allowed`
cursor it sits beside); the **status icon channel** (§A.5) went from documented-but-absent to a real
`.ui-field__mark` slot; `loading` became a field state at all (`AutoComplete` fetches suggestions
and had no way to say so). **App forms:** `auth.css` had replaced the canonical two-tone focus ring
with a single `0 0 0 2px var(--primary)` and, worse, its invalid rule wrote the SAME `box-shadow`
property later in the cascade, so **a focused invalid auth field showed no focus indicator at all**
— invalid now paints the border and the two compose; the dead `.auth .ui-field__label` selector (a
class that never existed) and the `0.85rem` label override are gone. `CatalogueCreateModal` bound
each visible label to its control by id (an `aria-label` on each one had been overriding the visible
text, WCAG 2.5.3; two of three were not associated at all) and stopped painting `required` +
`aria-invalid` the instant the modal opened. **`OwnershipTransfer`'s irreversible "Transfer
ownership" was styled identically to a safe primary** — now `severity="danger"`, a vocabulary the
codebase already had and had simply not reached for. Five label typographies collapsed to
`--fld-label-fs`. **Deliberate positions (not drift):** `--fld-fs-md`/`-lg` stay a half-step above
their neighbours on the type scale because a value the user TYPED is read under different conditions
than a table cell they scan; a 16px floor applies on coarse-pointer viewports because iOS Safari
zooms a sub-16px field on focus and does not zoom back. **Gotchas worth keeping:** this engine drops
`min()`/nested-`calc()` in `min-inline-size` (use a plain `var()`), and drops a `color-mix` whose
percentage comes from `calc(var(…) * 100%)` — hence the paired `--fld-disabled-mix` (literal `%`,
for mixes) and `--fld-disabled-alpha` (unitless, for `opacity`). **Concurrency note:** the
BodyPortal/z-scale migration for the eight field overlays landed in a CONCURRENT session working the
same tree during this pass; this row records the audit that specified it alongside the rest of the
work. | `DESIGN_SYSTEM.md` §C.1 + the field-contract and labelling-model notes ·
`packages/ui/styles/index.css` (`--fld-*`, `.ui-hit`) · `packages/ui/fields/**` ·
`apps/web/features/auth/styles/auth.css` · `apps/web/features/catalogue/**` ·
`apps/web/features/workspaces/**` · Decisions #19 / #50 / #60 |

| 63 | **Wallet — reachability, and the other half of the region contract (2026-07-31). REFINES
Decision #60.** A composed-page layout review of `/wallet` found the BODY half of #60's region
contract honoured better than anywhere else in the codebase (17 controls on the Overview, every one
a data selection or a navigation — no tabs, no filter dropdown, no CTA) and the CHROME half
unfinished in ways that made the surface unusable below a 1080px window. **(A) The footer band was
setting the surface's minimum width.** `.ui-middle-nav` is `grid-template-columns: auto 1fr`, and a
`1fr` track's automatic minimum is `auto`, so the content column could not shrink below its own
min-content — which one `nowrap` rig of six text-labelled buttons raised to **739px** (measured:
252px with the footer hidden, 95px with header and footer hidden). The lane, being the `auto` track,
absorbed every pixel: **280px → 2px at an 820px viewport with all six nav links clipped**, and at
768px the content column overflowed the frame's `clip` by 50px and cut the lifetime-earned figure.
Two fixes, either of which alone leaves the other's failure reachable: `minmax(0, 1fr)` on the
content track, and `container-type: inline-size` on the rig, whose inline-size containment stops it
contributing its width at all. **(B) The rig now adapts by WIDTH, not by page identity, and no
action is ever lost to it.** `TABLE_VIEWS` gated everything and was wrong three ways: a row-density
slider on Payouts and Invoices, which render `<dl>`/`<ul>` fact lists and where `walletZoom` is read
by nothing (only `LedgerTable` reads it); a `nth-child(n + 3) { display: none }` mobile rule that
deleted **Transfer, Fund escrow and New recurring** on exactly the four pages with no menu to
recover them; and the width floor above. Three container-query tiers (label → glyph-only, which is
§B.6.3's icon-only sticky footer, with the name relocated to the Tooltip every action now carries →
one menu), and **the menu holds every action at every tier**. **(C) Five actions existed in code and
nowhere in the interface.** `add_method` / `set_payout` / `enrol_smoother` had labels, capability
requirements, glyphs and `WalletService` methods, and `quickActionsFor` never emitted them;
`MoneyMoveDrawer` returned `null` for those plus `new_recurring` and `request_spend`, and was the
only consumer of `activeAction`. So Methods could not add a method, Payouts could not change the
schedule its own docstring called changeable, an eligible Income Smoother could not be enrolled in,
and three empty states pointed at "the action bar" for controls it was never given. New
`ConfigureDrawer` (reversible settings commit directly — the confirmation modal is for the
irreversible); `quickActionsFor` emits the three; a `VIEW_ACTION` map gives each page its own
leading primary. **Add method collects no card data by construction** — no PAN, expiry or CVV field,
because Stripe holds it and an input implying otherwise is a custody claim the surface spends its
whole design refusing to make. **(D) The action layer was mounted in `WalletOverviewScreen`** — one
route, while the rig that opens it renders on eight — so every footer action on the seven deep pages
opened nothing. It moved to the rig. **(E) Section navigation below 767px.** The lane is
`display: none` there and was the only route between the eight sections, so Activity / Funding /
Methods / Invoices / Access were unreachable on every phone; the header band now carries a
capability-filtered switcher at exactly the width the lane leaves — **the duty transfers, it does
not duplicate**. The `@media (max-width: 900px)` rule that dropped the reporting window now drops
the account NAME instead: the avatar still answers "whose money is this", which is the last fact
allowed to leave a band whose controls move money. **(F) Two header controls were inert** — Search
wrote to a local signal nothing read, and Filter opened a panel whose entire content was a sentence
telling you to use the balance meter, on four pages where that meter is not rendered. Both now work.
**(G) The §B.4 ladder was missing a rung**: `wallet-bands.css` documented a tonal step and every
band computed `rgba(0, 0, 0, 0)`, leaving a near-uniform 64/48/64px gap to carry all separation. Now
an alternating `nth-of-type(even)` tint (position, not tone name — Payouts runs intel→flow→ledger
and a name-keyed rule would abut two tinted bands), a translucent `color-mix` overlay so it steps
against whatever ground it actually sits on, and the ledger hairline removed so every boundary
spends exactly one device (§B.9.3). **(H) Type ramp re-cut.** Six display steps, none more than
~1.4× its neighbour below 50px, with two inversions: the Standing score at 50.9px was 71% of the
balance and became the page's second hero on scroll (now 40px), and the pence at `0.55em` of a 72px
figure rendered **39.6px — larger than the commission rate**. That ratio is the SMALL end's
legibility floor and is not a ratio at display scale; a hero-only `0.36em` puts them at 25.9px. The
ramp is now 72 → 40 → 36 → 30 → 26 → 22. **(I) Policy.** Approve/Decline were a repeated
`filled --primary` row action carrying the amount in the label (both now `text` with severity doing
the work, amount out of the verb per the file's own RULE O-2); the parallel `.wlt-btn` family — a
second button system with no severity axis, which is how an irreversible approval came to look like
a safe primary — is deleted and its 11 sites migrated to `Button`; `●`/`–` capability marks became
drawn glyphs; `add_method` and `set_payout` stopped borrowing Recurring's and Withdraw's glyphs;
mobile Export stopped being nameless (`font-size: 0` with no `aria-label`); `aria-expanded` now
renders in both states (Preact drops `={false}`, so five menu buttons shipped without it). **(J) Two
correctness bugs found in passing:** the ledger's `loadMore` and sort refetch each built their own
params and both omitted the fund-state filter, so page 2 of a filtered ledger came back unfiltered
and appended onto filtered rows; and ten refetches were `if (res.ok && res.data)` with no else, so a
failed currency or account switch left the previous wallet's figures on screen indefinitely —
`applyRead` + the previously-unreferenced `BandError`/`WalletSkeleton` now close both. **Verified by
measurement** at 1440 / 1024 / 820 / 768 / 390, LTR + RTL, light + dark: lane 280px at every width
it exists, **zero clipped elements and zero document overflow in both directions** (the stage-gate
figure "56 / 50" was clipped 13px in BOTH — a nowrap label took 128px of an 86px box and collapsed
the `1fr` meter to zero; its panel now uses a container query, because the intel band splits into
~430px plates and a viewport media query could never see the width that was actually wrong). **NOT
verified: click-through of the drawers** — Fresh's deferred island revival does not run in the
hidden preview pane (no Preact listeners attach on any island, including long-shipped ones), so the
action layer is verified by SSR output and type-checking only. **Flagged (surface, do not silently
resolve):** (a) the `@media (pointer: coarse)` bump of the rig row to 40px cannot be exercised in
the preview, which reports a fine pointer at every width; (b) the detector's one remaining finding
is `--spring-standard` matched on the word "spring" — it resolves to
`cubic-bezier(0.22, 1, 0.36, 1)`, which is ease-out-quint with no overshoot, exactly what §B.5
specifies. | `DESIGN_SYSTEM.md` §B.4 / §B.6 / §B.8 / §B.9 ·
`packages/ui/navigation/styles/middle-nav.css` · `apps/web/features/wallet/**` ·
`packages/backend/services/finance/wallet-fixtures.ts` · Decisions #55 / #60 / #62 |

| 63 | **Messaging — the `/messages` root inverted the region contract; the inbox moves to the body
(2026-07-31).** A composed-page layout audit of the messaging surface found the index route built
the opposite way round from `/wallet`, the reference implementation of the contract: the **lane was
the surface** (search · filters · partitions · the entire conversation list · both primary actions)
and the **body was a placeholder** — 1096×852, ~80% of the content region, holding a glyph, an `h1`
and a sentence. Measured consequences: the conversation row got 234px, of which the message preview
got **114px — 8.3% of the content region — clipping at 47% of its natural width** (`scrollWidth`
240); the root had **no header band and no footer band at all** (`conversationHeaderFor`/`FooterFor`
return `null` off a specific conversation), which is why every global control had collected in the
lane head; and below the shell's `max-width: 767px` rule — which REMOVES `.ui-middle-nav__lane`
(`middle-nav.css:168`) — the list, search, filters, all five toggles, every row kebab, Settings and
New message all measured `0×0`, leaving copy that read _"Select a conversation from the list"_
beside no list. (`/projects` fails identically; `/wallet` proves it is solvable in the same shell —
it keeps a 3435px body and both bands at 390px.) **Resolved by restoring the contract on the root**,
while the DETAIL route keeps the conversation list in the lane, which is genuine sibling navigation:
new **`InboxView`** (body — the list, and the only fetch owner), **`InboxHeader`** (header band —
identity · live count · search · id-based refinements), **`InboxFooter`** (footer band — New message
· Settings · density), **`InboxScopeLane`** (lane — partitions and relation facets as NAMED rows
with LIVE COUNTS, replacing five unlabelled icon toggles), resolved by `inbox-slots.tsx`
(`inboxHeaderFor`/`inboxFooterFor`/`messagesLaneFor`, mirroring the wallet slots). The preview track
went **114px → 577px at 1440** and shows 100% of its natural width at every size. Four regions are
four hydration roots, so they share **`inbox-state.ts`** (the board-footer↔body precedent) — but the
row layout uses **container queries**, not viewport media queries, because at exactly 768px the lane
is still shown and the content region is 424px, narrower than it is at 768px with the lane hidden;
guessing from the viewport produced a 36px preview track at that boundary. **Also fixed:** the
duplicated `Starred` control (same glyph, same label, 160px apart, different behaviour AND different
latency — one refetched, one was a client overlay); **six silently discarded errors**, three of
which rendered a failed fetch as an EMPTY result (`ContactPicker` → _"No matching contacts"_,
`PopoutChat` → _"No messages yet"_, and a failed create/save closing its modal as though it had
succeeded); `busy` reaching the DOM as `aria-busy` and nothing else (`lane.css` had zero matching
rules, so a refine was invisible to sighted viewers); the missing not-found guard on
`[conversationId]/files.tsx` that its two sibling tabs both had; `hasMore`/`nextCursor` never being
read, so a truncated inbox was silently truncated; the message column and the composer resolving
**two different measures** (feed uncapped, composer `56rem` — the field sat 130px inside the column
and 125px short of where own bubbles land) now unified on one **`--chat-measure`** token; the filter
chip whose selected state differed by a **1.003:1 luminance ratio** while DROPPING its label
contrast from 7.14:1 to 4.36:1; the footer band pinning to `inset-block-end: 0` on mobile, which is
exactly where the fixed `.ui-bottom-nav` sits (measured: identical 390×56 rects); the `.msg-btn`
family that reimplemented `Button` and shipped the surface's only raw hex; **33 font sizes, 11
weights and 22 icon px** migrated to `--text-*`/`--fw-*`/ `--icon-*` (three sizes — `0.9rem`,
`0.95rem`, `1.25rem` — were off-ramp entirely); two focus vocabularies collapsed to the canonical
`--focus-ring-shadow` with eleven controls that had NO focus rule gaining one; sub-24px hit targets
raised; the auto-response three-level box-in-box flattened; the empty state's `min-block-size: 60vh`
(sized against the VIEWPORT, not its region); and four class hooks applied in TSX with no rule
anywhere in the repo. **Two bugs of one class found in the new code during verification and worth
remembering: `inboxAll.value.length === 0` was used both as "not seeded yet" and as a seed guard, so
a search matching nothing re-seeded the SSR list and rendered the full inbox back; and the header
inferred "not loaded" from the same emptiness and printed the SSR count above an empty list. Empty
is a real value — only an explicit `inboxSeeded` flag may gate a seed.** Verified in-browser at 1440
/ 1024 / 900 / 768 / 390, LTR and RTL (zero horizontal overflow in both directions at every width),
with the scope/search/filter/density/empty/clear paths exercised end-to-end; detector clean;
typecheck + fmt clean. **NOT verified in this environment (stated, not claimed): `:focus-visible`
rendering** — the preview pane never takes real keyboard focus, so the rules are confirmed present
and using the composite token by source audit only. No DB/lifecycle change (still a read projection
over fixtures) → no `documentation/database/*` or `PRODUCT_MANAGEMENT.md` change; no new
`@projective/ui` primitive → no `DESIGN_SYSTEM.md` §C.1 change (the two package edits are
behavioural fixes to existing components: a visible `aria-busy` state on `LaneList`, and the mobile
footer-band offset). **Flagged (surface, do not silently resolve):** (a) `/projects` has the SAME
mobile failure — its root body still reads _"Pick a project from the list on the left"_ with the
lane removed — and was deliberately left out of this pass; (b) the mobile row drops the
hover-revealed kebab entirely (there is no hover on touch), so Favourite/Archive/Delete are
reachable only from inside a conversation on a phone — a long-press or swipe affordance is the real
answer and is deferred. | `DESIGN_SYSTEM.md` Part D / §B.4 / §B.6 · `apps/web/features/messaging/**`
· `apps/web/routes/(dashboard)/messages/**` · `apps/web/routes/(dashboard)/_layout.tsx` ·
`packages/ui/navigation/styles/{lane,middle-nav}.css` ·
`apps/web/features/projects/styles/{chat-feed,chat-composer}.css` · `apps/web/utils/storage-keys.ts`
· `.impeccable/critique/2026-07-31T12-00-00Z__messaging-layout.md` · Decisions #49 / #50 / #52 / #60
|

| 64 | **Ticket system rebuilt — the composer, the detail modal, and a derived price (2026-08-01).**
The `.tkm` ticket modal is deleted and replaced by two purpose-built surfaces on
`/projects/[id]/board` and `/projects/[id]/[channel]/tasks`. **The headline rule: a ticket's price
is never typed.** The manual budget field is gone; cost is the SUM of the selected stages, each at
the difficulty multiplier the client chose for it — `stageCostCents` / `ticketTotalCents` in the Zod
SSOT, called by the composer footer, the board card and the fixtures alike, so no second arithmetic
path exists to round differently. **Workload Intensity becomes a first-class control**
(`TicketIntensity` = the Architect's Override, PRODUCT_SPEC §The Weighting Engine: Low 0.5x /
Standard 1.0x / High 2.0x) and is the single lever that moves BOTH the money and the freelancer
capacity `W_i` — the two were always one axis in the spec and are now one axis in the interface.
**All tags removed** (ticket- and stage-level: schema field, card row, `BoardListParams.tag`, the
API param, the fixture vocabulary). **The composer** (`TicketComposer`, `.tkc-*`) is three regions,
each answering exactly one question: LEFT the ticket (title, brief, intensity, priority, due date,
attachments, reorderable task list); CENTRE the stage pipeline as a real flow diagram — a gutter
rail of numbered execution steps, cards carrying a chevron (not a "details" link), the derived stage
cost, a one-line truncated stage brief and a cascading `AvatarStack`, drag-reorderable with a drawn
landing seam; RIGHT a stage inspector that renders ONLY while a stage is selected, split into "This
ticket" (stage brief, intensity override, stage task list) and "Stage overview" (read-only roster,
existing stage tickets, rate, routing mode, capacity cap). **Simultaneous stage execution** is
modelled as `TicketStageRef.parallel` + the pure `executionBands()`: a stage joined to the one above
it starts with it, collapsing two numbered steps into one band drawn on the rail. **The detail
modal** (`TicketDetail`, `.tkd-*`) is a document, not the composer greyed out: status + meta badges,
the brief, the stage run, and three archives — History (`ticket_history`-shaped audit log),
Attachments and Submissions, the latter two mounting the SAME `/files` `FileCard` and `/submissions`
`SubmissionTree`/`SubmissionNodeList` components rather than second renderers. Owner/admin editing
is IN PLACE via the new `InlineEdit` primitive; a viewer without the right sees plain text with no
affordance, because a disabled control advertises a capability and then refuses it. **Three NEW
`@projective/ui` primitives** (§C.1 roster updated in the same change): `dnd/DropIndicator` (the
landing seam — the ghost says _what_, a highlighted neighbour cannot say _where_),
`display/AvatarStack` (data-driven roster + `+N`, one composed a11y label instead of a stream of
initials; `--avatar-ring` added so the gap is drawn in the colour actually behind the stack), and
`fields/InlineEdit`. **No DB migration** — the board stays a read projection over fixtures like its
siblings, and every new field maps to a column that already exists (`tickets.workload_intensity`,
`due_date`, `unit_price_cents`, `ticket_history`, `project_stages.description_text` /
`unit_price_cents` / `assignment_mode` / `max_concurrent_intensity`), so the live path slots in
behind the same `PROJECTS_BACKEND_LIVE` with no shape churn. **Dev Context Switcher (§5 gate) —
wired, no new axis.** The board originally read the raw SSR `viewerIsClient`, so it was blind to the
switcher: flipping the persona changed nothing. A new pure `core/board-access.ts` now resolves a
`BoardAccess` set (`isClient` · `isFreelancer` · `canEditTicket` · `hasTickets`) by layering the
seam over the SSR baseline, and the board body, the composer, the detail modal AND the middle-nav
footer rig all read it, so a persona flip moves all four together with no reload. It does NOT
re-derive the client/provider split — it delegates to the submissions `resolveViewer`, because two
answers to "which side of the market is this person on" is one too many and the board sits one tab
from the Submissions explorer. **No new axis was added**: the existing Account type · Entity
ownership · Team role · Service type controls already express every branch, and a fifth
near-duplicate axis would only create ambiguity about which one wins. `canEditTicket` is
deliberately NARROWER than `isClient` — a project manager can commission work without being able to
silently reword what a freelancer already agreed to deliver, so inside a team it takes ownership or
an admin seat while an individual client owns their project outright. **Two holes found by
measurement:** (a) with the composer open, flipping to a freelancer left the submit button live AND
it created the ticket — read-only inputs gated the controls but not the action, so the capability
now gates the submit and the board closes a composer whose seat has lost the right (the detail modal
stays open and degrades in place, because READING a ticket was never the gated part); (b) a session
engagement has no tickets at all, which absence alone reads as a missing control — `hasTickets`
gives the rig one sentence ("Sessions are booked, not ticketed.") while a viewer who merely lacks
the seat still gets pure absence. **Four defects found by measurement, not inspection:** (a) Escape
inside an inline edit closed the whole dialog — `useDismiss` binds Escape on `document` in the
CAPTURE phase specifically so inner handlers cannot swallow it, so `stopPropagation` loses by
construction; `InlineEdit` now registers on `window` capture, which precedes `document` in the
capture path, and `stopImmediatePropagation`s there. (b) The parallel-execution control was inert
because it was gated on `stage.locked` — that lock governs the PROJECT's stage sequence, not how one
ticket routes through stages; ungated. (c) The four-segment Priority control clipped its last option
to 139px when paired beside Due date in a 21rem panel; both now take a full row. (d) The step
numeral sat on `--primary` at **3.57:1** in dark mode — the theme's own `--on-primary`/`--primary`
pair — so the node was redrawn as a primary RING with the numeral on the surface pair at 14.4:1.
Verified in-browser on both routes: derived totals agree card-to-modal ($525 + $400 + $300 = $1,225;
a Low ticket at $262.50 + $150 = $412.50 with W 1.35), stage-level intensity override moves the
footer live, execution bands collapse the step rail, keyboard drag reorders, create round-trips to
the board, submissions drill tree → unit → files, light + dark all >= 5.38:1, `dir="rtl"` mirrors
with zero horizontal overflow in both directions, 390px reflows the stage card via a CONTAINER query
(the pipeline's width is not the viewport's — with the inspector open on a 1280px desktop the centre
region is ~540px), detector clean, no console errors. **Flagged (surface, do not silently
resolve):** (a) `--on-primary` on `--primary` measures **3.57:1** in dark mode — a theme-engine
pairing used by every filled primary control in the product, not a local choice; this pass routed
around it rather than patching one surface, and it needs a human decision at the token layer. (b) A
stage's `categoryWeight` is fixture-derived; the live path must read the real CREATE-category
weight, or `W_i` will be plausible and wrong. (c) Attachment upload is staged by NAME only — real
upload lands with `PROJECTS_BACKEND_LIVE`. (d) Editing a ticket in place is optimistic and
per-session, like every sibling board mutation. (e) A stale `packages/*` edit is NOT picked up by
HMR — the dev server must be restarted, which cost two false negatives during verification. |
`PRODUCT_SPEC.md` §The Weighting Engine / §Creation & Purchasing Gate · `DESIGN_SYSTEM.md` §C.1 ·
`packages/types/projects/board.ts` ·
`packages/ui/{dnd/components/DropIndicator,display/components/AvatarStack,fields/islands/InlineEdit}`
· `packages/backend/services/projects/board-fixtures.ts` ·
`apps/web/features/projects/{components/ticket/*,core/ticket-model.ts,styles/ticket-{composer,detail}.css,
islands/ProjectBoard.island.tsx,components/TicketCard.tsx}`
· `apps/web/routes/api/projects/board.ts` · Decisions #21 / #32 / #33 / #35 / #62 |

| 65 | **View Ticket modal rebuilt + the modal STACK primitive (2026-08-01). EXTENDS Decision #64.**
The `.tkd` read modal is replaced by `.tkv` — a Splitter-based document with six tabs and a
collapsible pipeline panel — and, underneath it, a new `@projective/ui/overlay` primitive that
changes how this product opens a modal from inside a modal. **(A) The stack.**
`createModalStack()` + `useFrameState`/`useFrameScroll` (DESIGN_SYSTEM **§B.10.9**, new) is a chain
where only the TOP frame renders: opening a submission review from a ticket REPLACES the ticket
rather than covering it, so a two-deep chain composites ONE blurred backdrop instead of two and runs
one focus trap instead of two, and the ticket's live state — tab, browsed submission path, open
stages, scroll offsets — is held in a deliberately **non-reactive** `Map` cache so popping back
restores the surface the viewer left. Two implementation facts are load-bearing: the cache is not a
signal (a scroll write must not re-render the host), and frames key off a monotonic `uid` (the same
ticket twice is two visits). **(B) The chain owns its URL with `replaceState`.** The obvious design
— `pushState` on open, `history.back()` on dismiss, so browser Back closes the overlay — was built,
and then MEASURED reloading the document: `history.back()` from a pushState entry replaced the page,
destroying the chain and every cached frame. A Back that loses the ticket is worse than a Back that
leaves the board, so the chain replaces rather than pushes; the address bar still tracks the review
(`/projects/[id]/submissions/[stage]/
[submitter]/[unit]?review=1`), and the `?review=1` marker is
what makes a copied link REOPEN the review in the standalone explorer instead of merely landing on
the submission. **(C) Submissions are stage-rooted.** A ticket's tree is rebuilt as **stage →
submitter → unit**, so a node's segment path IS the review URL's tail — the ticket modal and the
Submissions explorer address the same node the same way, with no translation layer to drift. The tab
mounts the SAME tree/cards/file cards and the SAME zoom store (`Ctrl`+wheel, one centre marker, no
toggle button) as `/submissions`; it deliberately does NOT reuse the window virtualization, because
a modal's scroller is the modal body and a window-virtualized list inside a dialog measures the
wrong box — one ticket's deliverables are a bounded handful and render in full. **(D) Additive SSOT,
no DB migration** (still a read projection): `TicketStageRef.unitPriceCents` (the base rate CAPTURED
at agreement, so a stage re-rated tomorrow cannot silently restate an existing ticket),
`BoardCard.owner` (the CLIENT-side accountable seat, distinct from `assignee`, the provider who
claimed it) + `contributors` + `unreadCount` + `payments` (the escrow/fee/release ledger),
`TicketHistoryEntry.unread`/`targetPath`, and
`BoardPage.workspaceKind`/`workspaceLabel`/`clientMembers`. The pure `ticketCostLines()` re-derives
cost from the captured base × the captured multiplier, because the Finances tab's job is to SHOW the
arithmetic and so it must BE the arithmetic. **(E) Intensity is never a number.** Low/Standard/High
is what a client chose; the multiplier appears in exactly one place — as a Finances column beside
the base rate and the product (`$400 × 2 = $800`) — because a badge reading "High ×2" asserts a
conclusion the reader cannot check. The three `W n` chips the composer had beside its intensity
badges are removed; capacity survives as a labelled Finances row and in tooltips. **(F) Two gates,
told apart deliberately** (the `/wallet` §60 rule): a provider-side viewer sees the ticket owner as
read-only TEXT, not a disabled Select — the fact is useful to them, the control would be offered and
then refused; and attachment upload is client-only by product rule, not oversight (a freelancer's
files are OUTPUTS and go through Submissions so they are versioned, reviewed and tied to the escrow
release), so the drop zone is absent and a sentence says where their uploads belong. **Two defects
found by measurement, both in shared code:** (1) `.ui-splitter__pane` shipped
`flex: 0 0
var(--split-size)` while the bases sum to exactly 100% and the gutters are additional
fixed pixels — so every layout Splitter overflowed by `gutters × gutterSize` and clipped its
trailing pane (4px lost, LTR and RTL alike, on the submission review modal too); shrinking is now
allowed. (2) Six labelled tabs needed ~590px in a 343px strip at 375px, making it a hidden
horizontal scroller — labels collapse to glyphs below 640px with `aria-label` always present, so
"label in name" (WCAG 2.5.3) holds in both presentations. **No new Dev Context axis** (§5 gate): the
board now resolves every gate through Decision #64's `board-access.ts`, so the existing persona/role
axes already move the whole surface — verified live, client ↔ freelancer flips the owner control,
the drop zone, both CTAs and the review action with no reload. Verified in-browser: derived totals
agree card ↔ modal at all three multipliers (Low `$200 + $262.50 = $462.50`; Standard
`$400 + $525 + $300 = $1,225`; High `$400×2 +
$525×2 = $1,850`), fee 5% and release check out on the
ledger, the ticket → review → back round trip restores the Submissions tab AT its browsed path with
one backdrop and zero history entries leaked, history-event follow lands on the exact unit, contrast
4.81–5.77:1 light / 7.46–14.37:1 dark, RTL mirrors the rail to the opposite edge with zero overflow
in both directions, 375px reflows full-bleed. **Flagged (surface, do not silently resolve):** (a)
browser Back no longer closes the review — see (B); (b) `onCreateSubmission` ROUTES to the
Submissions explorer rather than opening a third create modal, because that flow owns the pre-submit
checks and a second implementation would be the same flow with different rules; (c) attachment
upload is still staged by NAME only, and review accept/revision are optimistic stubs, pending
`PROJECTS_BACKEND_LIVE`; (d) the `--on-primary` on `--primary` 3.57:1 dark pairing flagged by
Decision #64 is still routed around (numbered step nodes are a primary RING with the numeral on the
surface pair), not fixed at the token layer. | `DESIGN_SYSTEM.md` §B.7.1 / §B.10.9 / §C.1 ·
`packages/ui/overlay/{core/modal-stack.ts,
hooks/useModalStack.ts,mod.ts}` ·
`packages/ui/layout/styles/splitter.css` · `packages/ui/icons/core/paths.tsx` ·
`packages/types/projects/board.ts` · `packages/backend/services/projects/board-fixtures.ts` ·
`apps/web/features/projects/{core/ticket-view.ts,components/ticket/{TicketView,TicketStagePanel}.tsx,
components/ticket/tabs/*,styles/ticket-view.css,islands/{ProjectBoard,SubmissionExplorer}.island.tsx}`
· Decisions #32 / #33 / #35 / #62 / #64 |

| 66 | **Browser audio capture — micro-permissions, pause/resume, and a real outgoing payload
(2026-08-02).** The composer's voice memo already had a working `MediaRecorder` engine; this pass
closes the gaps that made it unshippable and applies to BOTH messaging surfaces at once —
`/projects/[projectId]/[channelId]` and `/messages/[conversationId]` mount the SAME `ChatComposer`
island through `channelFooterFor`/`conversationFooterFor`, so parity is structural, not duplicated.
**(A) Pause/resume is a real capture state, not a UI flag.** `RecorderPhase` gains `paused`
(`inactive → requesting → recording ⇄ paused → recorded`) driving `MediaRecorder.pause()/resume()`,
and the elapsed clock changes from `now - startedAt` to **banked segments** (`bankedRef` + an open
segment), because the old subtraction counted paused wall-time — a memo paused for a minute would
have reported, and auto-stopped at, a duration it did not contain. Sampling halts with the clock so
a pause records no silence bars, and the waveform HOLDS its window instead of clearing. Verified by
measurement: 1.3s paused, timer frozen at `00:02` across the whole pause, resumed take reporting 3s
of a ~4.25s wall-clock session. **(B) `denied` vs `blocked` is the distinction that earns its
keep.** A dismissed prompt is recoverable by pressing the mic again; a **persisted** block makes the
next press silently inert, so only that case spends words on recovery — and they are
browser-specific (`micHelpFor`, six families, pure and UA-string-driven so it stays testable). The
state is resolved through the Permissions API with the load-bearing rule that **absence of an answer
is never denial** (Firefox rejects a `"microphone"` descriptor outright), so `unknown` always falls
through to a real attempt. A positively-denied state short-circuits before `getUserMedia`. Errors
became a structured `RecorderError {kind,title,detail,help}` rendered **inline** through the
existing `Message` primitive rather than a corner `Toast`: the control that failed is right there,
and instructions are read while looking at the button that refused. **(C) Guards the spec asked
for.** `MAX_AUDIO_BYTES` (10 MB) checked at finalize — the memo stays playable but Send is refused;
the device-loss path (`track` `ended` + a `readyState` poll on the clock interval already running,
since some UAs drop a removed device without firing the event) **keeps what was captured** rather
than discarding the take; and every exit path — stop, discard, error, unmount, `pagehide` — runs
`track.stop()`, so the OS recording indicator clears immediately (verified: one stop per take).
**(D) Send now assembles a real payload.** `ComposerPayload` carries an actual `File` named for the
container the UA **actually produced** (`audioExtOf` — a `.webm` name on Safari's MP4 breaks players
that sniff by extension) plus the `MessageAudio`-shaped projection, with `peaks` resampled ONCE at
the boundary to the SSOT's `.max(512)` — a five-minute take captures ~3300 samples and would have
failed Zod validation the moment the backend went live. `onSend` widened from `() => void` to take
it (both existing callers ignore the argument, so they are unchanged). Transport stays stubbed
behind `PROJECTS_BACKEND_LIVE`; the payload does not. **(E) Background tabs record seamlessly** — a
memo that silently drops audio while the viewer checks a reference is data loss — with a
`visibilitychange` handler resuming a UA-suspended `AudioContext` on return, which only ever
affected the visualiser, never the encoder. **(F) Dev Context Switcher (§5 gate):** a new
`micPermission` axis (`auto`·`prompt`·`granted`·`denied`·`unsupported`) wired end-to-end through
`dev-seam` (`DevMicPermission` + `DevSeamState` + `MIC_PERMISSIONS`) and `dev-context`
(`DevOverrides` + `DEV_DEFAULTS` + `DEV_MIC_PERMISSIONS` + `reflect()` set AND delete) + a panel
control, reaching the blocked / unsupported / slow-grant branches without changing real browser
settings and reloading. Simulating `granted` deliberately **overrides** the persisted-block
short-circuit — otherwise the axis is inert in exactly the browser a developer needs it in — but
still asks the real device; nothing here fabricates audio. **Three defects found by measurement, not
inspection:** (1) an oversize memo fell through to an **enabled Mic button that does nothing** (the
press guard rejects a `recorded` phase), so a finished memo now always shows Send, disabled with the
reason printed directly beneath, and the disabled Send steps down to a tonal control rather than a
0.4-alpha wash of `--primary`; (2) `setPointerCapture` throws `NotFoundError` when the pointer is
already gone, and the throw preceded `rec.start()` — costing the viewer the recording they just
asked for; (3) simulating `granted` hit the block short-circuit described above. **A11y:** the
ticking clock is deliberately NOT a live region (a counter announcing five times a second buries
everything else) — it stays readable on demand while a `role="status"` line announces only the phase
transitions. No new `@projective/ui` primitive (reuses `Message`/`Popover`/`Tooltip`) → no
`DESIGN_SYSTEM.md` §C.1 change; no persisted-shape change (the composer draft is transient client
state; `MessageAudioSchema` already existed and is now actually satisfied) → **no DB migration**, no
`documentation/database/*` and no `PRODUCT_MANAGEMENT.md` change. **Flagged (surface, do not
silently resolve):** (a) upload/transport is still stubbed — the payload is real and complete, only
its dispatch waits on the backend; (b) the attachment-cap overflow remains silent (`addFiles` drops
the excess with no feedback) — out of scope here but now conspicuous beside a composer that explains
every capture failure; (c) recording in a background tab relies on the UA exempting audio-capturing
pages from timer throttling — where it does not, the envelope goes sparse (cosmetic only, since it
is resampled) while the encoder is unaffected. | `PRODUCT_SPEC.md` §Unified Messaging ·
`apps/web/features/projects/{hooks/{useAudioRecorder,useWaveform}.ts,core/composer-model.ts,
types/composer-types.ts,components/composer-glyphs.tsx,islands/ChatComposer.island.tsx,
styles/chat-composer.css}`
· `apps/web/utils/dev-seam.ts` · `apps/web/features/devtools/` ·
`packages/types/projects/messages.ts` (satisfied, unchanged) · Decisions #31 / #34 / #49 / #50 / #62
/ #63 |

| 66 | **Ticket modal unified — one surface for create, view and edit (2026-08-02). SUPERSEDES the
two-modal split of Decisions #64/#65.** `TicketComposer` is DELETED (with `TicketBasics` and the
now-orphaned `TicketStagePanel`), and `TicketView` became the single context-aware surface:
`mode="create"` composes, `mode="view"` reads, and editing happens IN PLACE in both. The split cost
more than it saved — the composer and the detail modal each owned a description field, a task list,
an attachment flow and a stage pipeline, four pairs that had to be kept in agreement by hand, and it
made "edit this ticket" a mode switch that threw away the reader's position. **One working SHAPE**:
a ticket being composed is a `BoardCard` nobody has saved yet, so `TicketDraft`/`DraftStage` and
their reducers are gone; `ticket-model.ts` now operates on the card itself
(`newTicketCard`/`stageOps`/`taskOps`/`ticketTotals`/`ticketGate`), and **`reconcileCard()` is the
ONE place a derived field is computed** — price, capacity, checklist counts and due label — called
by the modal and the board alike so no second arithmetic path can round differently. **Edits are
STAGED**: the working copy lives in the modal-stack frame cache (so a review round trip preserves
half-made edits), the footer grows Save/Discard the moment `ticketFingerprint()` diverges from the
baseline, and nothing reaches the board until Save. **(A) Meta bar** — Intensity · Priority · Due
follow the `InlineEdit` contract (static value + quiet caret → the real `@projective/ui` control in
place, opened on the SAME click via a synthetic trigger click, which also dodges the `useDismiss`
race a programmatic open would lose); Owner keeps its dropdown and gains faces; **"Claimed by" is
pinned to the far end** (`data-end`) because it is the one value on the row the client does not set.
**(B) Footer** — the standalone Close is gone (the header × remains); **Ticket cost and Spent lead
as two prominent currency figures**, then the count badges behind one hairline, then the actions.
New pure `ticketSpentCents(payments)` in the Zod SSOT counts only **settled** `release` + `fee`,
never a held escrow — a client must never be told they paid for work nobody has accepted (verified:
a completed ticket reads Spent $925 against a ledger of $878.75 release + $46.25 fee). **(C) Task
lists** are client-owned and **never tickable here** — completion is a delivery claim and is made at
the SUBMISSION level, so the row shows the outcome plus the faces of everyone who satisfied it (new
additive `TicketTask.completedBy`). **(D) Side panel appears on exactly two tabs**: Details carries
a recent-activity feed, Stages opens only when a stage is selected — and the stage inspector renders
in the MODAL's own panel rather than a nested one, so there is one place a stage is configured.
**(E)** All ticket + stage descriptions use the shared `RichTextEditor` (keyed per ticket/stage —
Quill owns its DOM after mount, so a shared editor would write the previous subject's brief back on
the next keystroke). **(F)** Attachments mirrors `/files`, mounting the same `FileCard`/`FileTable`
and the same zoom store, with the rig + Add-attachment in the Submissions tab's bar position;
`FileTable` gained an additive `virtualize` flag because it windows against the WINDOW and a
dialog's scroller is its own body. **(G)** Create mode omits Submissions and History — empty
archives on a ticket that does not exist yet invite the reader to wonder what they missed. **One
`@projective/ui` change** (§C.1 updated in the same change): `Select` gained
`optionTemplate`/`valueTemplate` for rows that carry an identity rather than a word,
presentation-only (the row keeps its selected-check, `role="option"` and `aria-selected`;
`Option.label` stays what typeahead matches). **Bug found by measurement and fixed:** the
ticket-level intensity — the surface's headline price lever — moved a word and no money, because
`reconcileCard` prices from each STAGE's intensity (measured: Standard → High left the total at
$1,225). New `applyTicketIntensity()` cascades it to stages that were
tracking the default and leaves a deliberately-overridden stage alone, which is what "default"
means; `blankStageRef` now seeds from the ticket's difficulty too. Also fixed in the fixtures: an
UNCLAIMED ticket could carry completed steps, which the completer rule makes impossible — there is
nobody to attribute them to. **No DB migration** (still a read+write projection over fixtures, like
#64/#65) → no `documentation/database/*` change; no lifecycle change → no `PRODUCT_MANAGEMENT.md`
change. **No new Dev Context axis** (§5 gate): every gate routes through Decision #64's
`board-access.ts`, verified live — a persona flip moves the meta-bar affordances, the editor, the
task grips, the drop zone and both CTAs with no reload. Verified in-browser: create → named → Create
→ transitions in place to view mode with all six tabs and the card on the board; edit → Save
round-trips to the card ($1,225 → $2,450 at High); stage select opens the inspector in the modal's
panel with its RTE and reorderable steps; attachments grid ⇄ list at the `/files` columns
(non-virtualized, 3 rows in a 114px sizer); contrast 5.85–17.14:1 light / 7.46–14.37:1 dark;
`dir="rtl"` mirrors the meta row and the footer to the opposite edge with **zero horizontal overflow
in both directions**; 375px hides the panel, collapses the tab labels to glyphs and fits the strip
with no hidden scroller; no console errors. **Flagged (surface, do not silently resolve):** (a)
`ticket-composer.css` was renamed `ticket-pipeline.css` and keeps the `.tkc-` prefix — it now names
ticket COMPOSITION (pipeline · inspector · task list), not a composer modal; (b) attachment upload
is still staged by NAME only and every ticket write stays optimistic and per-session, pending
`PROJECTS_BACKEND_LIVE`; (c) the `--on-primary` on `--primary` 3.57:1 dark pairing flagged by #64 is
still routed around, not fixed at the token layer. | `PRODUCT_SPEC.md` §The Weighting Engine /
§Creation & Purchasing Gate · `DESIGN_SYSTEM.md` §C.1 · `packages/types/projects/board.ts`
(`TicketTask.completedBy`, `ticketSpentCents`) ·
`packages/ui/fields/{islands/Select.tsx,
styles/select.css}` ·
`packages/backend/services/projects/board-fixtures.ts` ·
`apps/web/features/projects/{components/ticket/**,components/FileTable.tsx,
core/{ticket-model,ticket-view}.ts,islands/ProjectBoard.island.tsx,
styles/{ticket-view,ticket-pipeline}.css}`
· Decisions #32 / #33 / #35 / #62 / #64 / #65 |

| 67 | **Asset management — the `/files` hub, the universal Asset Picker, privacy scopes, quotas and
the connector substrate (2026-08-05).** The 17th thin/fat vertical and the platform's first
**cross-cutting** one: every file, image, recording and web link on the platform becomes one
**asset** owned by one principal and reachable through one hub, so the same asset can be a
submission deliverable, a profile banner and a channel attachment without being copied. **(A) THE
WIDENING (the load-bearing change).** `projects/files.ts` `FileItemSchema` mandated message
provenance — `channelId`/`channelName`/`channelKind`/`messageId`/`messageText`/`sender` — which is
correct for a channel attachment and wrong for a hub upload, a drive mount and a link, none of which
has a channel or a message. Rather than fork a second file shape (doubling every card, table,
preview and modal), the files domain now owns `AssetItemSchema` — the SUPERSET with provenance
**flat and nullable** — and `FileItemSchema` is re-expressed as `AssetItemSchema.extend({…})`
re-mandating those fields. `FileItem` stays assignable to `AssetItem`, so all twelve existing
consumers compiled unchanged while `FileCard`/`FileTable`/`FilePreview`/`AttachmentPreviewModal`
needed their prop types widened exactly once. Flat-and-nullable over nested-optional deliberately:
nesting forces an edit at every `file.sender` read, where flat is a pure widening the type-checker
walks for you. `FileKind` moved down to a new leaf `files/kinds.ts` — `files/categories.ts` had been
reaching UP into `projects/files.ts` for the vocabulary the files domain owns while
`projects/files.ts` reached back for `FileCategory`, a mutual edge surviving only because one side
was `import type`; the graph is now a one-way DAG (kinds ← categories ← assets ← projects), which
matters because a cycle in a module whose corpus builds at import time is the TDZ crash class of
Decision #49, not a style problem. `FileKind` gained `link`, which correctly broke four exhaustive
`Record<FileKind,…>` maps. **(B) The `/files` hub** follows the §63 region contract exactly: LANE =
the three-section tree (My library · read-only **Mounted** engagements · **Connected drives**) with
a collapsed rail and the quota meter; HEADER BAND = identity + search + kind/source filter + sort,
at exactly `--shell-midnav-header-h`; FOOTER = Upload · New folder · Attach link · Connect drive ·
zoom · Export, `container-type:
inline-size` with three container tiers where **the menu holds every
action at every tier** (the `/wallet` defect where a `nth-child(n+3){display:none}` deleted three
actions on four pages that had no menu to recover them); BODY = viewing and selecting only. Below
767px the lane is `display:none` and the section-switching duty **transfers** to a header-band
"Browse" control — `/projects` still has no mobile answer and that failure was deliberately not
inherited. File cards are `FileCard` VERBATIM and folder cards are the `/submissions`
`SubmissionCard` VERBATIM (shaped through `shapeFolderAsNode`), which works only because
`.fx-card__meta` and `.subm-card__meta` are both exactly 62px and one `rowHeight = w + 62 + 16` fits
both in one grid. **(C) The Asset Picker** is one hand-rolled `BodyPortal` modal (NOT `Dialog`,
whose `overflow:hidden` + `--overlay-w-lg` + body padding fight a two-pane workspace) over a single
`<Splitter layout="horizontal">` — the modifier is mandatory, because
`navigation/styles/splitter.css` ships a BARE `.ui-splitter` rule (0,1,0) forcing
`inline-size: var(--shell-lane-w)` globally, and without it the picker collapses to 280px. Verified
open at 1088×768 with panes 238/846 going to 238/583/259 the moment a file is selected (the Inspect
panel is absent, not disabled, until then), `Attach Selected (N)` carrying a live count, and the
`accept` filter naming itself in the empty state ("No images here", not "No files"). Window
virtualization is correct in the hub body and WRONG in every overlay, so the picker uses a plain
auto-fill grid and `FileTable virtualize={false}`. **(D) Privacy scopes** — `private` (default) ·
`link` (auto-elevated inside a channel/DM/submission, because a recipient who can read the message
must be able to open what it carries) · `public` (auto-elevated on a
service/product/profile/banner); elevation is one-directional and automatic, de-escalation always
explicit, so attaching can never silently narrow access something else depends on. A channel
attachment is therefore `link`-visible BY CONSTRUCTION, which the fixtures now encode.
`/share/[slug]` is anonymous-reachable with `X-Robots-Tag: noindex, nofollow` +
`Referrer-Policy: no-referrer`, and every dead state — unknown, expired, revoked, exhausted —
renders an IDENTICAL 404: measured, revoked-vs-unknown differ by **exactly one byte, the last
character of the slug the caller supplied**, everything else being a per-request CSP nonce. **(E)
Quotas are an ENTITLEMENT, not a parallel system** — a new `storage_megabytes` key resolved by the
existing `fn_effective_limit`/`fn_footprint_usage`, which needed one `ELSIF`. Denominated in
**MEBIBYTES** because `plan_entitlements.limit_value` and all three resolver return types are
`integer`: 25 GB in bytes is 26,843,545,600 and overflows int4, and 1 TB is off by ~512×. Ladder:
free tiers 25600 · individual_pro 153600 · team/business_pro 512000 · organisation unlimited
(`NULL`, never a huge number that would eventually be rendered as a promise). Enforcement ships
**fail-open** behind `storage_quota_enforced`, matching both existing footprint gates. **(F) Dedup**
is a client fingerprint BEFORE the bytes move: full SHA-256 under 256 MiB, sampled (head ‖ tail ‖
size) above it — `crypto.subtle` has no streaming API, so a 2 GB file genuinely cannot be digested
whole — with `sampled: boolean` carried in the schema so the server knows the STRENGTH of the claim
and never collapses two objects on a hint. Outside a secure context it degrades to name+size and
never fails the upload. **Four pre-existing security holes closed:** `files.items` SELECT was
`USING (true)` (every signed-in user could read every row's filename, MIME, size, bucket and storage
path, including verification documents), its UPDATE policy had `USING` with no `WITH CHECK` (a user
could reassign `owner_user_id` or repoint `storage_path` at another tenant's object in the same
statement), and `files.folders` had **RLS off entirely** while inheriting a blanket `authenticated`
CRUD grant. **A fifth was introduced and caught in review:** the share-link policy's
`WITH CHECK (created_by = auth.uid())` proved identity but never OWNERSHIP, so any signed-in user
could mint a permanent share over any asset id they had ever seen — a member removed from a team
keeps those ids. **Six Dev Context axes** (§5 gate) — `storageProvider` · `connectionState` ·
`storageQuota` · `assetVisibility` · `linkScan` · `dedupState` — wired through all three files
including both `reflect()` branches, travelling to the server as validated `sim*` query params.
**Defects found by measurement, not inspection:** (1) `pg_catalog.substring(v_raw FROM 1 FOR 24)` —
the SQL-standard `FROM/FOR` form is a bare-keyword grammar production and is a syntax error when
schema-qualified; plpgsql defers parsing, so it would have created cleanly and failed the first time
anyone minted a share slug; (2) a literal **NUL byte** in `fingerprint.ts` made an 11 KB file binary
to git and invisible to grep, and it was the delimiter of a dedup lookup key — any transcoding
round-trip would have turned "have you got one of these?" into a permanent silent miss; (3)
`UserConnectionSchema.config` was required with no such column and no view projection, so every
parse of a real row would have failed; (4) the `workspace` bucket was seeded with full RLS but
absent from `StorageBucket`, leaving entity assets with no addressable bucket and no builder for the
`{entity_id}` anchor its own policies key on; (5) `dedupState` was plumbed through six layers and
**dropped at the route** — a panel control that changed nothing; (6) reads did not normalise the
fixture owner while writes did, so SSR painted an empty hub with a 0-byte quota and a client refetch
painted the full library over it — two answers for one screen. **Flagged (surface, do not silently
resolve):** (a) the migrations are authored-not-applied AND **were not executed** — Docker's Linux
engine was down, so unlike Decisions #57/#58 there is no throwaway-Postgres proof, only a structural
audit (enum parity diffed member-by-member, category placement, dependency order, RLS coverage,
`SECURITY DEFINER`/ `search_path`); (b) connections stay **per-user** —
`integrations.user_connections` has no owner axis, so a team's shared Drive is inexpressible
(inherits Decision #59); (c) entity-owned assets cannot yet be shared by a non-owner member — the
policy fails CLOSED pending (b); (d) `AssetListParams` has no `recursive` flag, so the picker's
"Recent" is the library ROOT newest-first, not a cross-folder recency feed; (e) `accept` filters by
category CLIENT-side, so `total`/`hasMore` describe the server's kind-narrowed set rather than the
drawn one; (f) provider adapters, the OAuth consent handshake, the KMS token vault, favicon
re-hosting and link scanning are all **stub-first behind the gate** — the payloads and interfaces
are real, only the outbound calls wait on credentials; (g) `ENCRYPTION_KEY` in the env contract
still contradicts the `connection_secrets.key_id` envelope design (inherits #59), and
`token-vault.ts` deliberately REFUSES to seal while gated rather than return a reversible encoding
that would survive the gate flip as plaintext; (h) `/api/wallet/*` reads the session on every route
while `/api/files`, `/api/catalogue` and `/api/projects` do not — the read convention is not uniform
and wants one human decision, not a third pattern. | `PRODUCT_SPEC.md` §Assets & Attachments +
§Sitemap · `packages/types/files/*` · `packages/types/projects/files.ts` ·
`packages/types/integrations/*` · `packages/backend/services/{files,integrations}/*` ·
`packages/backend/core/{env,supabase}.ts` · `apps/web/features/files/**` ·
`apps/web/routes/(dashboard)/files/**` · `apps/web/routes/(public)/share/[slug].tsx` ·
`apps/web/routes/api/{files,integrations}/*` ·
`supabase/migrations/{00000004,00000010,00000020,00000030,00001160,00001220,00001880,00002001,00002011,00002017,00003004,00004011,00005001,00005030,00005040,00005050}*`
· `documentation/database/{files,integrations,finance}/*` · `.env.example` · Decisions #32 / #33 /
#53 / #58 / #59 / #60 / #63 |

| 68 | **Universal Basket, Checkout, the card visualizer and the money-flow debugger (2026-08-06).**
The 18th thin/fat vertical and the platform's second write surface: one basket per acting context, a
`/checkout` that pays for all **ten** `PurchasableItemKind`s, a portable card visualizer, and a
dev-only money-flow debugger. **(A) Schema, folded in place** (root §1 — the brief asked for new
timestamped migrations; the governing rule forbids them): `finance.baskets` · `finance.basket_items`
· `finance.saved_cards` into `00000017`, two enums (`purchasable_item_kind` 10 values,
`card_brand` 9) into `00000004`, the `simulate_wallet_transaction` RPC + two predicates into
`00001210`, RLS/policies/grants/indexes into their category files. **`owner_type` was widened** from
the brief's `'user' | 'business'` to the existing 5-value finance CHECK — task §4.2 requires a Team
basket, which the narrow pair cannot express. **Validated by execution, not inspection:** every
statement applied to a live Postgres inside `BEGIN … ROLLBACK` plus a 32-case suite (enum order, the
`split_payout` round trip, **all 13 simulator refusal paths**, every CHECK, RLS coverage, `EXECUTE`
= `authenticated` only). **Authored, NOT applied to any live DB.** **(B) The simulator is dangerous
and is gated like it.** It mutates real balances, so it fail-closes on a new
`finance_simulation_enabled` param seeded **false**, refuses a NULL `auth.uid()`, and — **wider than
the brief** — checks the DESTINATION wallet too, since `top_up`/`escrow_release`/`refund` would
otherwise let any signed-in caller mint balance into a stranger's wallet. **(C) The card's custody
conflict, resolved honestly.** Decision #60's `wlt-card` refuses expiry/name/CVV/flip on the thesis
that "an affordance implying we hold data we do not is worse than an empty space" — but Stripe DOES
return brand/last4/exp/name, and the brief's own `saved_cards` stores exactly those. So the NEW
`@projective/ui/display` `PaymentCard` renders the real expiry, cardholder name and last4 with the
PAN as `aria-hidden` mask groups (4-6-5 on Amex) and the CVV as `•••` **ornament — never an input,
never a value, never a reveal**; absent fields render as ABSENCE, never `--/--`. `SavedCardSchema`
carries no `pan`/`cvv` key, not even optional. The wallet's card is untouched. `PaymentCardOption`
is a **sibling, not an `interactive` prop**, because a flip `<button>` nested in a `role="radio"`
button is invalid HTML that breaks both controls — a sibling wrapping a `decorative` face makes the
combination unreachable rather than merely discouraged. **(D) Portability held at both boundaries.**
`packages/ui` still imports only preact/signals/material: the card takes a structural
`PaymentCardData` (proven assignable from `SavedCard` by typecheck, so the app passes real Zod types
with no adapter), and `MoneyFlowPopover` is **fully controlled — zero fetch, zero arithmetic** —
over `DraggablePopover`. Its balance meter sets geometry directly and confines motion to
`transform`/`opacity`, so a backgrounded tab with a frozen animation clock still shows correct
widths. **(E) One arithmetic path.** `basketSubtotal` → `applyDiscounts` → `platformFeeFor` →
`checkoutTotals` live in the SSOT and are the ONLY implementation; the fat services wrap their
integer minor units into `MoneyView`s and the client renders `display` strings — **zero**
`toFixed`/`Intl.NumberFormat`/`reduce`-over-prices in any island. `explore/pricing.ts` was extracted
so a basket line's unit price cannot disagree with the card that added it (Decision #45 parity).
`create()` is idempotent on `idempotencyKey` and **re-verifies `expectedTotalMinor`** — a
client-supplied total accepted blindly is a price-tampering hole. **(F) Region contract** (#60/#63)
honoured: lane = scope, header band = identity/search, footer rig = every action with
`container-type` tiers **whose menu holds every action at every tier**, body = views and selects
only. **Nine defects found by measurement, not inspection**, four of them the same class — _a
control that exists but cannot be reached_: the collapsed lane never narrowed (280px held, 216px of
body lost) and dropped its own scope duty; header search was `display:none`d at the narrowest tier,
so **every phone** lost find-in-basket (the `/wallet` `nth-child(n+3)` failure in a header's
clothes); the same field was inert on `/checkout` at every width; BuyNow's `<li>` broke the
radiogroup ownership chain; its card picker set `tabIndex={-1}` on **every** option when none was
chosen, making the group un-enterable; `role="alert"` + `aria-live="polite"` demoted a REFUSED
payment to the politeness of a successful one; and post-payment focus fell to `<body>` because the
confirm dialog restored focus to a trigger that no longer existed, on an exit animation. Also fixed
in the SSOT: `CheckoutBlockerCode` had no **`price_changed`** member, so the tamper refusal returned
`blockers: []` and any surface explaining refusals by rendering blockers showed nothing on the
refusal a buyer is most likely to hit. **(G) Dev parity (§5 gate):** four axes — `basketOwner` ·
`paymentProviders` · `walletCoverage` · `savedCards` — through `dev-seam` +
`DevOverrides`/`DEV_DEFAULTS`/`DevOption`/`reflect()` **set AND delete** + a panel group, travelling
to the server as validated `sim*` query params and genuinely consumed (no plumbed-and-dropped
param). Verified in-browser at 1440 and 390, LTR + RTL, **zero horizontal overflow in both
directions at both widths**; full gate chain 3 blockers → 0 → Pay → `succeeded £1,366.15`; the
drawer's CSS ships from a non-checkout page, closing the island-carrier trap. **Flagged — needs a
human, do NOT silently resolve:** (a) **🚨 `authenticated` has no `USAGE` on the `finance` schema**
— `00002500` revokes it and never re-grants; `finance` is the only schema in the revoke list without
a matching grant, verified live (`42501`), so every finance policy old and new is latent. Granting
it would expose the whole ledger to direct PostgREST reads wherever a permissive policy exists;
deliberately NOT granted. (b) **`platform_fee_bp` is seeded `0`** while the SSOT says `500` and
Decision #2 resolved 5% — the live DB charges nothing; a fee change across every reset is a money
decision. (c) **Who bears the fee** — modelled as `PlatformFeeMode`, defaulted to the documented
`seller_deducted`, so the buyer's total excludes it; checkout must render one of the two. (d) The
simulator needs sign-off before its param is ever flipped. (e) **Three overlapping instrument
tables** now (`payment_methods` + `payout_accounts` + `saved_cards`), mitigated by a nullable FK,
not resolved (extends #54(f)). (f) `revision_id` has no FK — the target table is unsettled. (g)
`CheckoutResult.orderId` is always `null`; no orders table exists. (h) **Item deep-links follow the
canonical `/[handle]` + `/view/[id]` + `/projects/[projectId]/[channelId]`**, NOT the brief's
`/[handle]/products/[id]` or `/projects/[id]/[stageId]`, which would 404. (i) "CDN card art" and
"zero-JS pointer-reactive sheen" are not implementable (no external origin under the CSP; pointer
tracking needs JS) — art is derived into token expressions and the sheen is CSS-only with pointer
parallax an opt-in prop. (j) `bin_number` is usually NULL (Stripe entitlement-gated); every consumer
degrades to `brand`. (k) Free-text is Zod-bounded but DB-unbounded — a **truncation contract** the
resolving service must honour or the basket read 500s. (l) Mixed sim query vocabulary (four plain
knobs vs four `sim*`-prefixed) wants one rename pass. (m) Bulk basket actions are N sequential
writes. | root CLAUDE.md §1/§2/§3/§5 · `packages/types/finance/{basket,checkout,card-art}.ts` ·
`packages/backend/services/finance/{Basket,Checkout,Cards}BackendService.ts` +
`{basket,cards}-fixtures.ts` + `basket-query.ts` · `packages/backend/services/explore/pricing.ts` ·
`packages/ui/display/components/PaymentCard.tsx` ·
`packages/ui/overlay/islands/MoneyFlowPopover.island.tsx` · `apps/web/features/checkout/**` ·
`apps/web/routes/(dashboard)/{basket,checkout}/**` · `apps/web/routes/api/{basket,cards,checkout}/*`
· `apps/web/routes/(dashboard)/_layout.tsx` ·
`apps/web/features/shell/islands/UserActions.island.tsx` ·
`apps/web/utils/{dev-seam,storage-keys}.ts` · `apps/web/features/devtools/*` ·
`packages/types/profile/reserved.ts` ·
`supabase/migrations/{00000004,00000017,00001210,00002001,00002013,00002510,00002520,00004005,00005001}*`
· `documentation/database/finance/*` · `DESIGN_SYSTEM.md` §C.1 · Decisions #2 / #10 / #45 / #53 /
#54 / #55 / #60 / #62 / #63 / #67 |

| 69 | **Global multi-currency — the FX engine, `MoneyView`, and the header switcher (2026-08-10).**
Money presentation becomes global: one FX engine, one component, and a currency switch that
re-renders every visible figure with no page load. **The rule the whole pass protects:** a
conversion is a **read-time projection over an immutable origin**. Every stored amount keeps its
origin `(amount_minor, currency)`; settlement always reproduces the `(fx_rate, fx_base, fx_as_of)`
snapshot committed on its own row; nothing on any read path rewrites a ledger amount. **(A) Schema,
folded in place** (root §1 — no new timestamped migrations): `preferred_display_currency` gains
`DEFAULT 'GBP'`

- a `^[A-Z]{3}$` CHECK; `finance.transactions`/`escrows`.`fx_base` gains `DEFAULT 'GBP'` so a
  stamped rate is never orphaned from its base; `custom_access_token_hook` stamps
  `displayCurrency` + `locale` into `app_metadata.active_context` — on the SAME claim, because a
  figure that paints in one currency and corrects itself after hydration is worse than a stale
  symbol. `finance.fx_rates` gains a **seeded floor** for all 12 offerable currencies with **both
  directions of every pair written explicitly** (a reader that divides by the forward rate and one
  that multiplies by the inverse disagree in the last minor unit) at a FIXED `as_of` so a reset is
  reproducible. Authored, **not applied to any live DB**. **(B) Zod SSOT** — new leaf
  `@projective/types/finance/fx.ts` (`FxRateTable`/`FxQuote`/ `ConvertedAmount`, the curated
  `DISPLAY_CURRENCIES`, pure `resolveRate`/`convertMinorUnits`); `UserPreferencesUpdate` +
  `DisplayPreferences` on `org/preferences`; `displayCurrency`/`locale` on `UserContext` +
  `ActiveContextClaim`; `preferences` on `CurrentUser`; `toMoneyView()` bridging the engine to the
  existing money shape. `org/preferences` **re-exports** the currency defaults from the FX SSOT
  rather than restating them. **(C) `FxService`** is the only thing on the platform that converts: a
  per-base table cached 15 min in **Deno KV** → a per-isolate memory cache → the seeded fixtures,
  with `convertAmount()` returning the value **and** its `asOf` snapshot instant. It never throws
  and never returns "no answer": an unresolvable pair returns the **origin unchanged** with
  `converted: false`, because assuming a rate of 1 or relabelling an amount with a symbol it was not
  priced in turns a missing number into a WRONG one — the only FX failure a reader cannot detect.
  **(D) `MoneyView`** in `@projective/ui/display`, plus a portable signal store, on a narrow
  `./display/money` sub-path (the barrel re-exports Table/Tree/Galleria/GMap, and the
  globally-mounted bridge would have dragged all of them into every route's bundle to render a
  price). ONE component, three ways of learning the currency — props → request context → the host's
  ambient resolver → the signal store — so it is correct as a zero-JS server component AND reactive
  inside a hydrated island, with no second renderer to drift. **(E) Live switching** without a
  reload: the store re-renders hydrated figures, and a DOM sweep re-projects every server-rendered
  `[data-money]` node from its own IMMUTABLE origin attributes (never from the previous conversion,
  which would compound a rounding error on each switch). Islands flag themselves `data-money-live`
  from an effect — which only runs on hydration, so "is this reactive" is answered by the one signal
  that knows. **Adopted on the Explore service + product cards** (additive `priceMinor`/`currency`
  on the explore SSOT, parsed ONCE server-side at fixture construction — parsing a localised
  currency string in the browser is how "$1,800" becomes 1.8). **Four findings, all by
  measurement:** (1) **a Preact context provider at the document root is NOT visible to a server
  component deeper in the page** — an island boundary sits between them and island subtrees render
  in a pass that drops the outer context (an app-side probe beside a price returned `null`; the same
  probe under the provider returned the real value). A module signal would reach everywhere but is
  shared across concurrent requests, i.e. a data race over money that passes every manual test.
  Resolved with `AsyncLocalStorage`, which is request-scoped and survives every await and render
  pass. (2) The DOM sweep seeded `display: ""`, and `projectMoney`'s "target is already this
  currency" branch returns `display` **verbatim** by design — so switching TO the origin currency
  **blanked every figure**. (3) The currency PATCH went through `apiFetch`, whose unrecoverable-401
  path **navigates to `/login`** — throwing someone off the page they were reading because a
  formatting preference could not be saved; now a plain `fetch`, where a 401 leaves the local choice
  in place and the surface says it saved on this device only. (4) Vite caches the package `exports`
  map at startup, so a new sub-path needs a dev-server restart — as does any `packages/*` edit,
  since HMR does not pick them up (two false negatives during this pass). **Verified in-browser:**
  SSR paints the viewer's currency in the first byte from the cookie/JWT (GBP · EUR · JPY all
  correct, JPY exponent-aware with no phantom decimals); the header picker changed **all 19**
  figures on `/explore` at once with the URL unchanged; GBP→EUR→JPY→USD→AED→GBP round-trips to the
  exact starting figure; the choice survives a reload; a guest PATCH 401s cleanly with no redirect;
  `deno task test` (check · lint · 33 unit tests) green. **Flagged (surface, do not silently
  resolve):** (a) `preferred_display_currency` now has a DEFAULT while `NULL` still means "follow
  the origin" — distinguishable, but subtle enough to deserve a human's confirmation. (b) **Adoption
  is one surface, not a migration**: ~180 other money sites (wallet, checkout, workspaces, tickets)
  still render through their surface-local components and do not respond to a currency switch; each
  now has a `MoneyView`-shaped target. (c) The brief's `£78.50 (~€90.00 EUR)` puts the `~` on the
  ORIGIN, which is the exact figure, while the converted primary is the estimate — implemented
  literally as specified, with the honest full statement in the accessible label and `title`. (d)
  **`deno fmt --check` is deliberately NOT in `deno task test`**: `core.autocrlf=true` makes it fail
  on any Windows checkout regardless of what is committed, and ~280 files predate the formatter. (e)
  FX spread / conversion-fee economics remain OPEN (finance-model §11) — the surface renders origin,
  converted and rate, and never a fee. (f) `finance.fx_rates` is read with the service-role client
  because SSR converts for signed-out visitors too; the rows are public reference data
  (`USING (true)`), but the read bypasses RLS and wants revisiting if that table ever carries
  anything else. | `SYSTEM_ARCHITECTURE.md` §Internationalization · `DESIGN_SYSTEM.md` §C.1 ·
  `packages/types/finance/fx.ts` ·
  `packages/types/{org/preferences,auth/user-context,user/current-user}.ts` ·
  `packages/backend/services/finance/{FxService,fx-fixtures}.ts` ·
  `packages/backend/services/user/UserBackendService.ts` ·
  `packages/ui/display/{money.ts,core/currency-store.ts,components/MoneyView.tsx,styles/money-view.css}`
  · `apps/web/utils/{currency-context,state,storage-keys}.ts` ·
  `apps/web/routes/{_app,_middleware}.tsx` · `apps/web/routes/api/{user/preferences,finance/fx}.ts`
  ·
  `apps/web/features/shell/{core/{CurrencyService,currency-state},islands/{CurrencyBridge,UserActions}}`
  · `apps/web/features/explore/{core/pricing,components/cards/{Service,Product}Card}` ·
  `supabase/migrations/{00000011,00000017,00001700,00005050}*` ·
  `documentation/database/{org,finance,security}/*` · Decisions #2 / #10 / #16 / #17 / #54 / #55 /
  #60 / #68 |

| 70 | **Checkout redesigned into a four-step flow + the FOCUS chrome (2026-08-10).** `/checkout`
becomes a four-route linear flow — **Basket → Details → Payment → Confirmation** — and `/basket`
retires to a 302 redirect, so one surface has one URL. New
**`packages/types/finance/{buyer,order}.ts`**: buyer delivery + billing (personal AND business), the
completeness predicate `missingBuyerFields()` / `buyerDetailsComplete()` / `canSkipDetails(session)`
that the auto-skip, the form, the Pay refusal and the invoice all ask ONCE; and the order /
fulfilment / invoice projection with `calendarLinksFor()` + an RFC-5545 `buildIcsCalendar()`.
**`CheckoutResult.orderId` is no longer permanently `null`** — the hole logged as Decision #68(g) —
because a charge now records an order the confirmation reads back. `checkoutTotals()` gained
`processingContributionMinor`, added LAST and never part of the platform-fee base: charging a
percentage of a voluntary gift would make the buyer's generosity revenue. Plus `SpendLimitBlock` and
the `missing_details` / `spend_limit` blocker codes. **Reuse over invention:** monthly invoicing is
the EXISTING `org.business_profiles.invoicing_mode` + `billing_day` (1–28 CHECK), the department
allocation is `org.organisations.departments`, a user "list" is a named `finance.baskets` row (that
table's own comment says a wishlist is not a separate kind), and the invoice's FX record COMPOSES
`ledger.ts`'s `FxSnapshotSchema` rather than restating `fx_rate`/`fx_base`/`fx_as_of`. **No DB
migration** — a read+write projection over fixtures like every sibling, behind the existing
`FINANCE_BACKEND_LIVE`. **(A) FOCUS CHROME (new `DESIGN_SYSTEM.md` Part D.6).** A fifth shell mode
for a linear, committing flow: `AppShell` gains `chrome?: "full" | "focus"`, resolved per-URL by
`checkoutChromeFor()` so it paints in the FIRST byte rather than flashing chrome and removing it
under the buyer's cursor. It removes chrome by **not constructing it**, never by hiding it — hidden
chrome still holds a grid track and still feeds the `--shell-frame-inset-inline` seam accumulator.
Verified by measurement: with no lane the frame's `auto minmax(0,1fr)` grid resolves column 1 to
`0px` and the header band renders flush at x=0 (1265px wide, zero overflow); and `--frame-radius`
must be set on **`.ui-app-shell__content`**, not on a descendant, because the pseudo-element that
reads it belongs to that element (setting it on `.ui-middle-nav` left the curve at 15.68px). The
basket and the confirmation deliberately keep FULL chrome — the basket is a page a buyer
legitimately leaves, and the confirmation's whole job is to send them onward. **(B) Two defects
caught before shipping, both invisible in source.** `middle-nav.css` lifts the footer band by
`--shell-bottomnav-h` unconditionally at ≤767px, so withholding `BottomNav` left a **56px dead gap
under the Pay button on every phone** (now measured at `0`); and `user-shell.css` reached a page
ONLY through the `ShellSidebar` / `UserActions` island bundles, both of which focus mode suppresses
— so Details and Payment would have rendered an **unstyled header**. Moved to `client.ts`. **(C) A
pre-existing money bug fixed at the root.** `wallet-fixtures.ts` held a private THREE-entry FX table
(`GBP`/`USD`/`EUR`) with a `?? 1` fallback while `fx-fixtures.ts` / `FxService` carry all twelve
offerable currencies — so nine of twelve converted at a rate of exactly 1, and the converter also
ignored currency exponents, compounding it by a further 100× for JPY. Measured: a $95.00 product
rendered `JP¥7,480` where the seeded table says `JP¥14,362`, and `AED 74.80` against a true AED
348.58. It now reads `FX_FIXTURE_RATES` through the SSOT's own
`resolveRate`/`convertMinorUnits`/`currencyExponent`, so the server's figure and the client's
re-projection derive from ONE table; **five regression tests** iterate the full offerable set rather
than a sample, because a GBP→USD test would have passed throughout the entire period both bugs were
live. This also corrects `/wallet`. **(D) `Amount` was a correctness bug, not a style choice.** It
printed `value.display` and emitted no `data-money-*`, so the currency sweep (Decision #69) could
not see it: **every figure on the checkout kept the old currency after a switch**, on the number the
buyer was about to pay. It now delegates to `MoneyView` — 0 money nodes before, 29 after, and
switching to JPY converts all 21 visible figures with each disclosing its immutable origin. **Six
new Dev axes** (`buyerDetails` · `billingContext` · `invoicingMode` · `spendLimit` · `fulfilmentMix`
· `conferencing`), each with BOTH `reflect()` branches, travelling as validated `sim*` query params
because the seam is a CLIENT surface the server cannot see. **Verified in-browser** at
1440/1024/768/375, LTR + RTL, light + dark: all four routes hold zero horizontal overflow in both
directions at every width; the payment cards measure **exactly 302×192 (ratio 1.5729)** on BOTH the
option wrapper and the card (both selectors are required — `.ui-paycard-option--*` restates
`--pc-max`); the "Selected" badge renders once as an `aria-hidden` sibling of the radio, never
nested inside it; the details form's 12 controls are all labelled with **zero** premature
`aria-invalid`; the contribution threads £1,366.15 → £1,385.48 exactly; the `.ics` is valid RFC 5545
with CRLF and a deterministic `DTSTAMP`. One defect of my own, found by measurement: the stepper's
`upcoming` ink measured **3.33:1** — it had been treated as a disabled control, but these labels are
the only thing telling a reader what the rest of the flow consists of, so they carry the full 4.5:1
floor (now 10.36:1; the recession is carried by weight and the un-filled mark instead). **CONFLICTS
FLAGGED, NOT SILENTLY RESOLVED — each needs a human:** (a) **the brief's hexes do not exist in this
theme.** Colours are Material-You generated at request time, so `--primary` is `#00929e` dark /
`#007680` light (NOT `#288690`, which is the SEED), `#F5A623` appears nowhere in the repo, and
**`--text-main` and `--text-disabled` are never declared at all**. The tokens the brief NAMES were
used and the hexes ignored, per §3. (b) **The amber CTA re-purposes a status token as the action
colour.** §A.1 assigns `--primary` to "primary action" and `--warning` to "in progress /
time-sensitive", and §B.8.3 forbids inventing a severity by re-tinting. Built as the brief specifies
(`variant="filled"
severity="warning"`), and **measured: `--warning` is amber `#ffb872` in dark but
`#8c5000`, a dark ochre, in light** — so the brief's visual intent is unreachable in light mode
through any token. Literal amber platform-wide is a `theme-engine.ts` tone change that repaints
every warning surface, plus an §A.1 role-table amendment. (c) **The pill shape on every checkout CTA
is an owner-approved, surface-scoped deviation from §B.8.4**, which otherwise reserves
`--radius-full` for chip-like and floating controls. Approved 2026-08-10 because the design draws
the flow's actions as pills throughout and one rounded rectangle among them reads as a mistake;
documented as an explicit exception in §B.8.4 rather than left to be rediscovered, and deliberately
NOT extended to any other surface. (d) **Two `filled` CTAs vs §B.8.2** — the desktop lane footer
owns the commitment and the duty transfers to the footer rig ≤767px, so exactly one is ever on
screen; logged rather than resolved. (e) **The brief's "replace the disabled Use button" describes a
state that never existed** — selection has always been a `role="radiogroup"`; the badge was added,
nothing was removed. (f) **302:192 contradicts the package's documented ISO-7810 CR80 rationale**
(`1.586`, "the real ratio, not a rounded 1.6"); applied as a call-site token override only, never a
package edit. (g) The currency flag is a **data mark, not an icon** (`aria-hidden`, off `.ui-icon`,
the ISO code carries the name) — the §B.7.7 exemption Decision #63 established for the wallet's
fund-state marks. (h) Deep links use the canonical `/projects/[projectId]/[channelId]`, NOT the
brief's `/projects/[id]/[stageId]`, which has no route and would 404. (i) **No blanket "escrow hold"
copy was added**: `PRODUCT_SPEC.md` locks escrow at checkout for SESSIONS only — a pipeline ticket
escrows at the freelancer's Claim, and a digital product has no documented escrow at all. (i)
`finance.orders` / `finance.buyer_details` are the deferred live-path tables; field names were
chosen so they can adopt them verbatim. (j) Inherited and untouched: Decision #68's `authenticated`
has no `USAGE` on the `finance` schema, `platform_fee_bp` seeded `0`, and the three overlapping
instrument tables. | `DESIGN_SYSTEM.md` **Part D.6** · `ROUTING.md` · `PRODUCT_SPEC.md` §Sitemap ·
`SYSTEM_ARCHITECTURE.md` §Backend Services ·
`packages/types/finance/{buyer,order,checkout,basket,fx}.ts` ·
`packages/backend/services/finance/{buyer,order,basket,wallet}-fixtures.ts` +
`{Checkout,Basket,Order}BackendService.ts` + `wallet-fixtures_test.ts` ·
`packages/ui/navigation/{components/AppShell.tsx,styles/{app-shell,middle-nav,page-canvas}.css}` ·
`apps/web/features/shell/components/UserShell.tsx` · `apps/web/client.ts` ·
`apps/web/features/checkout/**` · `apps/web/routes/(dashboard)/{checkout/*,basket}` ·
`apps/web/routes/api/{checkout/*,basket/lists}` · `apps/web/utils/dev-seam.ts` ·
`apps/web/features/devtools/*` · Decisions #2 / #45 / #60 / #62 / #63 / #68 / #69 |

| 71 | **Scheduling coordination — majority resolution, per-viewer withholding, and a reschedule
lifecycle that can end (2026-08-17).** Repairs the scheduling data layer behind the calendar
surfaces. **(A) MAJORITY, resolving a contradiction with the business SSOT.** `PRODUCT_SPEC.md` §The
Proactive Calendar: _"In multi-attendee sessions (Group Sessions), a change in time requires a
majority consensus to be finalized."_ What had shipped was first-past-the-post — `leadingProposal`
returned the top of a sorted tally with no threshold, so a slot holding 1 of 8 votes "led" — and the
contradiction was neither flagged nor logged. `PRODUCT_SPEC.md` wins on business rules (§0), so
majority is now implemented: `voteQuorum(n) = floor(n / 2) + 1` and `majorityProposal()`, with the
denominator being everyone ENTITLED to vote (the roster minus the host, who authored the options),
**not** everyone who answered. **Abstaining is therefore a vote against moving**, deliberately: a
turnout-based denominator would let two people move a session of twelve by being the only two paying
attention, and the honest default for an unanswered question is that nothing changes. **When nobody
reaches a majority the vote LAPSES and the original time stands** — a seventh `RescheduleStatus`,
not `resolved` with a null winner, because a reader of `resolved` must be able to assume something
was decided and an overloaded null is how a surface comes to render "moved to —".
`leadingProposal`'s earlier-slot tie-break now only ever orders the DISPLAY: two slots cannot both
hold more than half of one electorate. **(B) The vote could never be resolved at all.** `confirm`
was hard-gated to counterparty mode, nothing acted on `resolvesAt`, and
`leadingProposal`/`voteTally` were never called by the service — so `resolved` was unreachable on
the vote path and the only exit was to withdraw. Resolution is now a pure, total, idempotent
`settleVote(now, reschedule, voters)` applied on **every read and before every action** (there is no
cron in this layer, and a deadline nothing observes is not a deadline; the live path runs the same
function from a sweep). It closes on either trigger: the deadline arriving, or every eligible voter
having answered — a vote is immutable once cast, so making a cohort wait out a deadline whose
outcome is already fixed is theatre. A host may additionally `confirm` early, but **only a vote that
has already carried**: they close a decided vote, they never decide one. **(C) `withdraw` was an
unrecoverable dead end** — it set a status the closed-round guard then blocked `open` from leaving
while still admitting `propose`, so a host who withdrew once accumulated slots forever with no way
to put any of them to anybody. Resolved by making all three endings terminal **for that round** and
`propose` the succession: a proposal on a closed round opens round `n + 1` with a fresh ballot (new
`EventReschedule.round`, which also keeps proposal ids unique across rounds). **(D) `propose` never
validated the SLOT** against the 12-hour lockout, so `open` could stamp a vote whose deadline was
already in the past and the ballot could elect a time that was itself already unmovable; the lockout
now applies to the slot being offered as well as the event being moved, and `open` additionally
refuses a ballot that is no longer answerable. **(E) 🚨 PRIVACY — public, unauthenticated reads were
serving the attendee roster, the meeting `joinUrl`, the passcode, the dial-in details, attendees'
personal notes and the HOST'S EARNINGS.** `meeting.ts` stated the contract ("`joinUrl` is present
ONLY to the event's own parties — the server withholds it from everyone else rather than relying on
the URL being unguessable, because a meeting link IS the access control for most providers") and
nothing implemented it: the only gate was `if (event.masked)`, a PRESENTATION flag, and the weekly
public group session is deliberately unmasked. Closed by a new SSOT layer
`@projective/types/scheduling` `privacy.ts` — a `SchedulingViewer` (deliberately **not** a Zod
schema, because a viewer a caller could parse is a viewer a caller could invent), `isEventParty`,
and an **allow-list** `redactEventForViewer` — applied at the fat-service boundary on the way out,
unconditionally, on the read AND write paths. Allow-list rather than deny-list so a field added
tomorrow is withheld until somebody publishes it: forgetting then costs a missing label, which is
visible, instead of a leak, which is not. Every service method takes a viewer defaulting to
`ANONYMOUS_VIEWER`, so forgetting to pass one withholds MORE. Public reads keep exactly what §Part
1.4 allows — position, privacy-safe status, and the seat COUNT, whose whole point is that it names
nobody. Seating is now viewer-aware too (a guest is seated nowhere), and `/api/scheduling/calendar`
— whose only surfaces live under `(dashboard)` — gained the signed-in guard its two genuinely public
siblings must not have. **(F) Fixture defects with user-visible consequences:** the host was seated
TWICE on 34 of 84 rosters (the domain casts include the owner and the fallback pool overlaps them),
so `rescheduleModeFor(2)` routed a "meeting" of one person with himself down the counterparty branch
— rosters are now deduplicated by identity with the host excluded; `@sofia` read "Sofia Almeida"
here and "Sofia Marin" everywhere else, so `profileHref` sent two different people to one profile —
the pool is now the domain's identity table and `normaliseParty` canonicalises through it; 154 of
498 audit lines were dated AFTER the fixed clock and all were marked unread (timestamps derived from
the event's START, not the clock) — every line is now anchored to `min(NOW, event.start)` and
`unread` requires a non-negative delta; an RSVP of `pending` stamped `respondedAt` and logged
"Marked Maybe" — clearing an answer is a real move, so it now clears the timestamp per the schema's
own invariant and logs nothing false; the attendee counter was being MINTED on stage syncs that
never had one, turning on `EventBlock`'s people-badge across every project calendar — it is now only
ever restated, never introduced. Also: the ballot's per-seat entropy was keyed on a trailing seat
index, and since `hash` multiplies by 31 (≡ 1 mod 3) every roster in the corpus produced the
identical abstention pattern and the identical tally; it is keyed on the voter's identity instead.
**Flagged, needs a human — do NOT silently resolve:** (a) **the 12-hour reschedule lockout is
unreconciled with the 24-hour cancellation window** (§Cancellation & Escrow Protection refunds an
attendee outside 24h and forfeits their escrow inside it). Between T-24h and T-12h an attendee may
still MOVE a session they can no longer cancel without forfeiting, so rescheduling is a documented
route around the forfeit rule. Which boundary governs, and whether moving inside the escrow window
should carry the same financial consequence as cancelling, is a money decision. (b) With the backend
gates off an AUTHENTICATED reader is still seated by fixture DESIGNATION rather than by identity, so
"authenticated non-party" is a state the stub corpus cannot produce — the live path replaces the
seating, not the projection, and the rule itself is unit-tested directly. (c) `findProfile`
synthesises a short display name for a handle it does not know ("Ivy" for `@ivy`) while the
projects, explore and messaging corpora all say "Ivy Chen" — the scheduling corpus now speaks with
one voice, but `/@ivy` itself still renders the short name, which is a PROFILE-corpus divergence to
reconcile there. (d) `lapsed` is unreachable through the service under a FIXED fixture clock once
slots are lockout-valid, so it is produced by the derived corpus and proven by unit test rather than
by an end-to-end write. **No DB migration** — coordination remains a read+write projection over
fixtures with no `scheduling.*` attendee, proposal, vote or history table yet (`mod.ts` says what
persisting it would need), so no `documentation/database/*` change; no new `@projective/ui`
primitive → no `DESIGN_SYSTEM.md` §C.1 change; no new simulatable axis a surface branches on →
nothing to mirror in the Dev Context Switcher (§5). `PRODUCT_MANAGEMENT.md` §3.5 gains the two
lifecycle rows, the three named caps and the majority rule **in this change**, and its "a reschedule
is not a state" sentence is reconciled: true of a discovery CALL (one slot, one acceptor, a
counter), untrue of a multi-attendee EVENT, and the two now sit side by side with the reasoning.
Verified: `deno task check` clean, `deno test packages/` 144 passed (96 before), `deno lint` clean
on all 30 touched files. | `PRODUCT_SPEC.md` §The Proactive Calendar / §Cancellation & Escrow
Protection · `PRODUCT_MANAGEMENT.md` §3.5 ·
`packages/types/scheduling/{privacy,coordination,
mod,rows,calls}.ts` +
`{privacy,coordination}_test.ts` ·
`packages/backend/services/scheduling/{ScheduleBackendService,coordination-fixtures,calendar-fixtures,
availability-fixtures,schedule-fixtures}.ts` +
`coordination-fixtures_test.ts` · `apps/web/features/calendar/core/{viewer,calendar-ssr}.ts` ·
`apps/web/routes/api/scheduling/*` ·
`apps/web/routes/(dashboard)/projects/[projectId]/{calendar,[channelId]/calendar}.tsx` ·
`apps/web/routes/[handle]/{availability,view/[item]/schedule}.tsx` ·
`apps/web/routes/(public)/view/[entity]/schedule.tsx` · Decisions #37 / #48 / #56 |

| 72 | **Calendar system — overlay ownership, the `cal__view` engine, the Event Modal and the
`/calendar` hub (2026-08-17).** The surface work Decision #71's data layer serves, plus the
primitive fix underneath all of it. **(A) OVERLAY CONTAINMENT IS OWNERSHIP, NOT ANCESTRY.** Every
anchored panel is `BodyPortal`'d into `document.body`, so a dropdown opened inside a modal is that
modal's DOM SIBLING and `panelRef.contains(target)` reports a click on the overlay's own menu as an
OUTSIDE click. The live instance was `TicketView.tsx` (`closeOnOutside: true`, no `enabled`), where
the modal closed on selection AND the edit was lost, because its working copy is a modal-stack frame
slot that `forget()`s on close. New `packages/ui/hooks/overlay-registry.ts` derives parentage from
the DOM at query time — **B is a child of A iff A's panel contains B's TRIGGER**, the trigger being
the only part of a portalled overlay that stays where the author wrote it. Preact context cannot do
this job: `BodyPortal` renders through a separate `render()` root, so a provider above the trigger
is invisible inside the panel (the Decision #69 finding, again). **The two dismissal channels are
now gated differently and this is load-bearing:** ESCAPE is exclusive (the handler calls
`stopImmediatePropagation`, so `enabled`/`isTop` picks the one owner, and it must gate the LISTENER
— a callback that no-ops still consumes the press), while OUTSIDE POINTER is NOT gated by `isTop` —
doing so made an overlay undismissable for as long as anything sat above it. **The two divergent
`useDismiss` copies are now one** (`fields/hooks/` had no `enabled` and used `stopPropagation`), as
are the two `useFloating` copies; ten components that never claimed a stacking slot now do, which
surfaced that `--z-overlay` is **1100 — exactly `LAYER_BASE.popover`** — so all five nav panels
painted UNDER any open modal. `useFloating` gained `collisionPadding`, an
`availableHeight`/`availableWidth` output (a clamp cannot keep a panel on screen when the panel is
TALLER than the space left: `Math.max` pins its top and the overflow simply runs off, which is why a
100-year year picker clipped instead of scrolling) and a panel `ResizeObserver`. **(B) `cal__view`**
— a Figma-style overlay scrollbar whose handle is a DEPTH gauge rather than a proportional thumb and
whose length freezes on drag until pointerup AND pointer-exit; Day/Week continuous virtualization
anchored on the current time; Month switched from clipping to discrete pagination; a 60s indicator
that moves only itself. **Motion may only ever decorate `transform`/`opacity`** — a background tab
freezes rAF, transitions and animations, so geometry that ENCODES data is set directly (the Decision
#60 defect class). **(C) The Event Modal** mirrors `tkv` structurally with its own BEM prefix, and
every business rule is CALLED from the SSOT rather than re-implemented — a client gate that was
looser than the server's (it applied the 12-hour lockout to the event but not to the slot being
OFFERED) is the failure that pattern exists to prevent. **ONE clock**: the modal advances from the
fixtures' pinned reference at wall rate, because moving the GATES to the wall clock would declare
the whole seeded corpus finished rather than fix the header/body contradiction. **(D) `/calendar`**
follows the region contract (`/wallet` §60/§63): lane owns navigation, header band identity + range,
footer rig every action behind container-query tiers with the menu holding every action at every
tier, body views and selects only. The legacy five static provider tags are replaced by a real
Connect-Calendar surface; provider marks stack; `.ics` import is a pure, unit-tested SSOT parser
(RFC 5545 line-unfolding before parsing, CRLF, escaped TEXT). `sess-cal` is removed from the
projects sidebar — `calendarHref` was used TWICE there, so the Propose-time CTA had to survive it.
**THREE SECURITY DEFECTS found by adversarial review and fixed** (each now pinned by a test): a
signed-in STRANGER was seated as an attendee on the two guest-reachable surfaces that show OTHER
people's calendars, receiving the host's join URL, passcode, the named roster with private notes,
and per-occurrence and per-series EARNINGS — seating is now by IDENTITY, because being signed in is
not a relationship to somebody else's meeting; the `sim` developer overlay, whose `seat: "host"` is
the sole input to host authority and which arrives on a caller-controlled query string and request
body, was ungated and therefore a privilege-forgery primitive **in production** — it is now honoured
only where the SERVER says `DENO_ENV=development`, stripped at one choke point; and
`/api/scheduling/personal` had no guard, serving the titles and locations of other people's
engagements (the per-viewer projection withholds only the COORDINATION fields). A masked block also
no longer discloses `sources` — masking says "this time is taken" without saying what takes it, and
provenance answers exactly the question the mask refuses. **Process note worth keeping:** the first
repair closed the ANONYMOUS leak and its own test asserted exactly that, so the suite stayed green
while the surface still leaked to anyone with an account — a test written against the case you just
fixed cannot see the case you did not. **Flagged, NOT resolved (needs a human):** (a)
`dangerouslySetInnerHTML` on `event.description` is unreachable today (server-derived only, withheld
from non-parties, never persisted) but becomes stored XSS the moment an update write path lands, and
this repo has no sanitiser; (b) the 12-hour reschedule lockout sits INSIDE `PRODUCT_SPEC.md`'s
24-hour cancellation window, so between T-24h and T-12h rescheduling is a documented route around
the escrow-forfeit rule (also logged on #71); (c) `CommandPalette` is `role="dialog" aria-modal`
with `lockScroll` but claims the `popover` band (1100), and moving it to `modal` would change paint
order against Dialog/Drawer. | `DESIGN_SYSTEM.md` §C.1 · `ROUTING.md` · `PRODUCT_SPEC.md` §Sitemap ·
`PRODUCT_MANAGEMENT.md` §3.5 ·
`packages/ui/hooks/{overlay-registry,useDismiss,useFloating,useEdgeDetection}.ts` ·
`packages/ui/fields/{islands/{DatePicker,Select}.tsx,hooks/{useDismiss,useFloating}.ts}` ·
`packages/ui/calendar/**` · `packages/ui/layout/core/split-sizes.ts` ·
`packages/types/scheduling/{privacy,ics,sim,meeting,coordination}.ts` ·
`packages/backend/services/scheduling/**` · `apps/web/features/calendar/**` ·
`apps/web/routes/(dashboard)/calendar/**` · `apps/web/routes/api/scheduling/*` ·
`apps/web/features/projects/{components/NormalSessionPanel,islands/ProjectSidebar.island}.tsx` ·
Decisions #19 / #37 / #48 / #60 / #63 / #64 / #65 / #68 / #69 / #71 |

| 73 | **Calendar — playful palette, card stacking, avatars, adaptive bubbles, and the scrollbar's
edge-hold/momentum physics (2026-08-20).** A visual + interaction pass over the Canvas-based Week
grid and its DOM twins (Day/Month), executed directly against the engine (no app-side data wiring
required — every new capability is additive/optional on `CalendarEvent`). **(A) Palette.** A card's
identity now rides exactly three channels — fill, glyph, spoken label — down from four: the leading
BAR texture is retired, and `core/kinds.ts` gains `effectiveAccent(kind, status, masked)` (layers a
cross-cutting tentative/pending → `--warning` STATUS overlay, and a three-way status→hue map for
masked blocks, over the existing per-kind default) + `onAccentFor(token)` (derives `--on-<token>` by
the same naming convention `theme-engine.ts` already generates verified-AA/AAA pairs under, for
`--primary/secondary/tertiary/danger/warning/success/info` — no colour math of this engine's own).
`holiday` moved `--warning`→`--tertiary`; `busy` moved the neutral `--on-surface-variant`→`--danger`
("Busy/Conflicting" reads as an alarm colour on purpose). Card fills are now the accent at FULL
strength (was a 16% wash) with `--cal-accent-on` ink — verified in-browser: light ink on a dark fill
and dark ink on a light fill from the SAME palette, i.e. genuinely computed, never a fixed white.
Corner radius stepped `--radius-sm`→`--radius-lg` (6px→12px). The hourly grid lattice is decluttered
to day-boundary rules only (`paintGrid` skips non-boundary `scene.rules`); the DOM gutter's hour
LABELS are untouched. **(B) Stacking.** `core/layout.ts` `packDayEvents` rewritten: an overlap
cluster no longer fans into fractional side-by-side columns (`DaySlot.col/cols/span` and
`SceneEvent.offset/width` are gone) — every member renders at FULL column width, and only the
EARLIEST-starting (`stackDepth === 0`) is actually painted, behind up to two decorative shadow
silhouettes and a `+N` badge (`scene-paint.ts` `paintBadge`/the stack-shadow loop in `paintCard`;
`DayTimeline.tsx`'s `.cal-daycol__eventshadow`/`.cal-daycol__stackbadge` mirror it in DOM). A11y
parity is unconditional: every member still gets its own `SceneEvent`/`DaySlot` (`hitTest` and the
paint pass merely skip `stackDepth > 0`), so the Week canvas's existing accessible list and a NEW
visually-hidden `.cal-tg__a11y` block in `DayTimeline` keep every event independently reachable and
`eventAccessibleName` states the overlap in words. **(C) Avatars.** New `CalendarAttendee`
(`core/types.ts`) + `CalendarEvent.attendeeFaces` (photo-or-initials, host-first, the viewer's own
face expected pre-filtered by the CONSUMER); a new `core/avatar-cache.ts` resolves a photo
synchronously from a module-level cache and kicks off the load as a side effect, wiring
`watchAvatarLoads` into `useGridCanvas`'s existing invalidate-and-redraw path (the same mechanism
theme/DPR changes already use) so a photo finishing its load repaints with no frame otherwise
required. The face stack and the (still count-only, per `SceneEvent.sources`'s existing doc)
provider stack share ONE "overlapping circles, max 3, then `+N`" convention (`AVATAR_MAX`), placed
on the meta line's trailing edge for an ordinary card and promoted to a dedicated footer row only
when genuinely spacious — a fixed-row design was tried first and found NOT to fit a realistic
one-hour default card (48px @ 48px/hr leaves ~10px spare against a 20px avatar), caught by the
existing test suite rather than by inspection. **(D) Adaptive Bubble + proximity clustering (§Part
3).** Below `BUBBLE_MAX_H` (20px) a card collapses to a small trailing-edge pill (accent + glyph
only); a single forward pass in `paintEvents` merges consecutive bubble-eligible cards in the same
column within `BUBBLE_CLUSTER_GAP` into one larger pill carrying a count, rather than a wall of dots
— every merged event stays in the accessible list regardless. **(E) Scrollbar physics ("Figma-style
depth gauge", §Part 4).** `core/scene-build.ts` gains two pure, unit-tested formulas shared by BOTH
scrollbar implementations (the native `useOverlayScrollbar`, used by `DayTimeline`, and the inline
canvas drag gesture in `TimeGrid.tsx`'s `"bar"` gesture) so the two answer "how fast / how much" the
same way: `edgeHoldVelocity(overshootPx)` (quadratic ramp, saturating — a drag held past the track's
edge keeps scrolling, faster the further past it is, without an accidental few-px overshoot already
reading as a committed fast-scroll) and `pressuredLength(frozen, overshootPx)` (the pinned handle
shrinks toward a floor under sustained pressure, snapping back the instant pressure returns to zero
— no smoothing, per the header note on why nothing here may depend on an animation clock). A
CSS-only "ball" grip (`.cal-bar--dragging`, a `::before` circle) grows the handle on grab; the
canvas twin gets the same dot via `paintScrollbar`. **(F) Release momentum.** `useCanvasViewport`
(virtual/Week) and `useCalendarViewport` (native/Day) both gain a velocity-sampled fling on
pan-release (middle-mouse/Ctrl-drag/touch), decelerating via a shared `MOMENTUM_DECAY` per-frame
factor with `dt` CAPPED per tick (a hidden-tab `requestAnimationFrame` gap must not integrate a
stale velocity across the whole elapsed time in one jump — found and fixed during this pass, the
same class of bug `--dur-*`-driven CSS motion in this engine already guards against). A genuine
one-finger TOUCH drag on the native Day scroller already had free OS momentum
(`touch-action: pan-y`); only the synthetic middle/Ctrl-drag pan needed it added. **(G) Month
glide.** `MonthGrid`'s prior "deliberately un-animated" position (frozen-clock risk) is narrowed,
not reversed: the month's IDENTITY was never gated on a frame (`days` recomputes from `focusMs`
synchronously regardless), so a purely decorative directional slide-and-fade
(`.cal-month__page--glide`, keyed by month to force a fresh element) is layered on top, gated
exactly like `scrollBehaviorFor()` gates a programmatic smooth scroll — skipped outright under
`prefers-reduced-motion` OR `document.hidden` at the moment of the page change. **Verified:**
`deno
check`/`deno lint` clean across the package and its `apps/web` consumers; 97 unit tests (34
new, covering the two scrollbar-physics formulas directly since their LIVE rAF motion cannot be
observed by a static assertion); live in-browser on the guest-reachable `/view/[entity]/schedule`
surface (Week/Day/Month all render, theme switch re-resolves the palette live, zero horizontal
overflow under a forced `dir="rtl"`, no console errors across view switches, drag, and
theme/direction toggles). **Flagged (surface, do not silently resolve):** (a) real avatar PHOTOS
have no current producer — `attendeeFaces` is a new, currently-unpopulated optional field; the
initials fallback is what every existing fixture will show until a consumer wires real data through.
(b) overlap stacking is UNCONDITIONAL (any 2+ overlapping events stack, no side-by-side threshold) —
a deliberate literal reading of "do not render overlapping cards as squished slivers," not a
threshold tuned against real usage data. (c) `/[handle]/availability`'s full-page bypass has a
PRE-EXISTING zero-height bug (`.guest-shell__region` is `align-items: flex-start`, so `<main>` never
stretches to the region's height) — confirmed unrelated to this pass by cross-checking a sibling
guest calendar surface (`/view/[entity]/schedule`, same `GuestShell`) which renders correctly; not
fixed here (out of scope for a canvas/paint-engine pass). (d) the edge-hold/momentum rAF loops could
not be watched live in this session's preview pane (not composited/displayed, so
`requestAnimationFrame` never fires there — a harness limitation this repo's own memory already
documents) — correctness rests on the direct drag-to-position mapping working live (verified) plus
the pure formulas' unit tests, not on watching the animation itself play. (e)
`CALENDAR_KIND_BAR`/`CalendarKindBar` are removed from the package's public barrel — a breaking
change to `@projective/ui/calendar`'s exported surface, though no `apps/web` consumer referenced
either. |
`packages/ui/calendar/core/{kinds,types,layout,
grid-paint,scene-build,scene-paint,avatar-cache}.ts`
·
`packages/ui/calendar/hooks/{useCalendarViewport,useCanvasViewport,useOverlayScrollbar,
useGridCanvas}.ts`
·
`packages/ui/calendar/components/{EventBlock,DayTimeline,MonthGrid,GridProbe,OverlayScrollbar}.tsx`
· `packages/ui/calendar/styles/calendar.css` · `packages/ui/calendar/mod.ts` ·
`packages/ui/calendar/core/{scene-build_test,scene-paint_test}.ts` · `.claude/launch.json` ·
Decisions #1 / #37 / #48 / #62 / #63 / #64 / #71 / #72 |

| 74 | **Discovery card family rebuilt — ambient hover, split badge corners, one profile card, and
the Project row→card conversion (2026-08-21).** The four item cards shared by `/explore` and every
Profile tab were rebuilt against a supplied visual spec, and the marketing landing twins came with
them so the product keeps ONE card system. **(A) Ambient hover, with real pixels.** `.ex-card` is
now transparent at rest — no fill, no border, no shadow — because its media already draws a hard
edge and the old tonal fill measured 1.13:1 against the page for its trouble (§B.4: one device). On
hover the card warms toward the dominant colour OF ITS OWN THUMBNAIL plus a matching glow. Two
layers resolve that: the deterministic `--ex-accent` token painted at SSR, and the real extracted
`r g b` written by a new `AmbientPalette` island and switched in by `[data-ambient="on"]`. Both
funnel into `--ex-wash`/`--ex-glow` so the hover rule never branches; `--ex-ambient` cannot take a
`var()` fallback (a fallback colour and a channel triplet are not the same grammar), which is why
the switch is an attribute selector. **ONE island for the whole page**, not one per card: the cards
stay server components and the island finds them by attribute (the `CardStyleAnchor` shape).
Extraction only ever UPGRADES a card that is already finished — no-JS, a CORS refusal, a decode
failure and a 404 all keep the token wash. It reads a separate off-DOM `Image()` in CORS mode, never
the rendered `<img>`, so a host without `Access-Control-Allow-Origin` loses the swatch rather than
the thumbnail. **The weighting is absolute chroma biased to mid-tones, NOT relative saturation** —
`(max-min)/max` scores `rgb(0,10,20)` a perfect 1.0, so shadow detail with a faint cast wins every
vote; measured against this corpus it returned near-black for 7 of the first 8 thumbnails. The
winner is then clamped into a usable lightness/saturation band with its HUE untouched, because a
dark tint at 12% over a dark surface is invisible and the hover would silently do nothing on exactly
the moodiest cards. **(B) Two corners, two meanings.** A signal the entity EARNED and a placement it
BOUGHT never share a stack: derived trust chips (`Top rated` / `Fast replies` / `Available now`) are
pills top-LEFT on the solid `--ex-chip-on-media` label surface; the sponsorship disclosure is a
circular blurred-glass "AD" token top-RIGHT. The hover actions cluster steps aside for it via
`:has()` — the disclosure is owed to the reader at rest and must not be displaced by a transient
control. **(C) One profile card.** `FreelancerCard` + `ProfileBannerCard` are DELETED and replaced
by `ProfileCard`, used by all four profile entities: masked cover, a large avatar centred on the
seam overlapping it 50%, centred name/`@handle`, then a left-aligned 2-line headline, a
`location • languages` line, and a foot splitting the rating from stacked metrics. The pair rendered
the same seller two ways depending on which section surfaced them, which is the opposite of a card's
job. **(D) Service/Product anatomy** reordered to creator row → title → classification chip (+
right-aligned secondary) → rating-left / price-right; the creator row prints the seller's NAME, not
their handle, and the type chip and the product price both moved OFF the media, where they had to
survive arbitrary photography. **(E) `ProjectRow` → `ProjectCard`**, a bordered card in a fixed
TWO-COLUMN `.ex-projgrid` everywhere (never auto-fit, never one column) — reverses Decision #41's
"never a boxed card" rule. Projects are deliberately EXEMPT from the ambient system and carry no
badges: with no media there is no colour to extract, and trust/sponsorship belong to things being
sold, not to a brief being staffed. **Additive Zod SSOT** (`ProfileItemSchema.location`,
`.responseMinutes`) — a read projection over fixtures like Decision #12, so **no DB migration**. No
new `@projective/ui` primitive → **no `DESIGN_SYSTEM.md` §C.1 change**; no lifecycle change → no
`PRODUCT_MANAGEMENT.md` change; no new simulatable axis a surface branches on → nothing to mirror in
the Dev Context Switcher (§5). **Five defects found by measurement, not inspection:** (1) the AD
token's white text over a BLOWN-OUT WHITE photo measured **2.68:1** at its first glass opacity — the
worst case is the image, not the theme, and a `text-shadow` changes the impression of contrast
without changing the contrast (now 6.19:1 at 0.62); (2) `--success` as chip ink measured 8.44:1 in
dark and **3.17:1 in light**, so the label now mixes the accent toward `--on-surface`, which is
self-correcting because that token is near-white in dark and near-black in light — the DOT keeps the
pure accent, being fully redundant with the word beside it; (3) at 375px the absolute two-column
rule leaves a project card ~167px and the `nowrap` timestamp won the whole header row, crushing the
publisher's name to a measured **0px** — present in the DOM, invisible on screen — fixed with a
CONTAINER query, since a viewport media query would be reading a box more than twice the size of the
one actually too narrow; (4) `.ex-pricebadge` was `nowrap` and a Pipeline range in a converted
currency renders `From £94.49 – £377.95 (~US$480.00 USD) / ticket` — one unbreakable 312px run that
escaped a 161px card entirely; the badge now wraps at its spaces while each FIGURE stays atomic, and
the foot's existing `flex-wrap` had been doing nothing because the overflow was one atomic child
rather than the row; (5) the first swatch pass shipped the relative- saturation bug in (A).
**Verified in-browser** on `/explore` Home, `/explore?category=projects`, `/@handle/services` and
`/@handle/projects`: 36 cards across five modifiers, zero legacy classes remaining, 2-per-row across
all 9 project rows, avatar overlap 50%, media 16:10 at 12px radius, product frame capped at 288px,
badge corners correct in LTR **and** mirrored under `dir="rtl"` with zero horizontal overflow either
direction, light + dark both clean (worst measured text 8.06:1, worst chip 5.97:1, AD 6.19:1), 375px
reflow with nothing clipped inside any card, `deno task test` 284 passed (9 new, pinning the
derivation rules — each is a CLAIM the product makes, and the failure mode is a confident wrong
statement rather than a broken layout). **Flagged (surface, do not silently resolve):** (a) the
brief's "Recently Viewed" secondary chip needs per-viewer browsing history the discovery corpus does
not carry, so that slot holds the real turnaround instead — no fabricated signal; (b)
**two-column-on-mobile is the brief's explicit instruction and it costs real legibility** — a 167px
card at 375px is tight even after the container-query reflow, and one column would read better on a
phone; the rule was followed literally and the card was made to survive it, but the trade-off is the
product owner's to confirm; (c) two Unsplash fixture URLs 404 and so keep the token fallback — a
pre-existing dead-URL problem, correctly degrading; (d) `storage-keys.ts`
`THEME_PREFERENCE: "pj.local.theme"` is read by NOTHING — `packages/ui/system/core/context.ts`
writes plain `"theme"` — an unrelated inconsistency found while testing themes; (e) the
`--on-primary` on `--primary` 3.57:1 dark pairing flagged by Decisions #64/#65 is still routed
around, not fixed at the token layer: **no chip in this family tints with `--primary`**, which is a
deliberate constraint and not an aesthetic preference. | `DESIGN_SYSTEM.md` §B.4/§B.6 ·
`packages/types/explore/items.ts` · `packages/backend/services/explore/fixtures.ts` ·
`apps/web/features/explore/{components/cards/{ProfileCard,ServiceCard,ProductCard,ProjectCard,EntityCard},
components/{StatusChip,PromotedBadge,OwnerBadge},components/collections/{ProfileGrid,ProjectsList},
core/{card-signals,card-signals_test},islands/{AmbientPalette,SearchDashboard},styles/explore.css}`
· `apps/web/features/profile/components/ProfileTabContent.tsx` ·
`apps/web/features/marketing/components/{ProfileCard,ServiceCard,ProductCard,ProjectCard}.tsx` ·
`deno.json` · Decisions #3 / #12 / #39 / #41 / #45 / #62 / #64 / #69 |

| 75 | **Calendar physics — cursor-anchored zoom, the lever scrollbar, the placement engine, the pin, and the HTML popover layer (2026-08-21).** The Canvas engine's interaction layer, rebuilt against a supplied brief. **(A) THE PLACEMENT ENGINE.** `core/layout.ts` grew from a 78-line stack sweep into a containment forest: `solo`/`nested`/`split`/`folded`, resolving overlap VERTICALLY first because a column is a time axis and width is the one cue that must not be spent on a fact unrelated to width. A properly-contained event is drawn INSIDE its parent at nearly full width (`--cal-nest-inset`); a plain straddle STACKS under a `+N` chip; side-by-side lanes are the EXPLICIT fallback for a nest the pixels cannot hold (`NEST_HEADER_PX` — the child must clear its parent's only label) or for a cluster the reader has unfolded. **A zero-duration event is a DEADLINE and now survives as an INSTANT** — the old filter dropped it outright — drawn as a pin (rule + kind chip + timestamp pill), never a box, and never given a synthetic duration; the SSOT contradiction that made this unexercisable is resolved in the same change (`packages/types/scheduling` said `end > start` while the engine had always documented `end === start`; the deadline fixtures now emit true instants, milestones keep their span, and `ck_event_span` was relaxed to `>=` so a persisted deadline is not refused by the DB). **(B) THE LEVER.** `core/chrome.ts` — the module `grid-paint.ts` already NAMED and nobody had written — makes both scrollbars RATE controls: pressing the handle morphs the pill into a circular ball and dragging scrolls at a velocity proportional to displacement from the GRAB ORIGIN, which is what lets the gesture outlast a finite track on an effectively infinite axis. Edge-hold is subsumed (`edgeHoldVelocity` now delegates, so one ramp answers "how fast"), `pressuredLength` is retired with the edge-pin it served, and the handle's LENGTH becomes the share of one PERIOD visible at the live zoom — the denominator changes, not the idea, because `viewport / content` over nineteen years is a hair nobody can grab. **(C) CURSOR-ANCHORED ZOOM.** `zoomAnchor(viewportY)` pins the timestamp under the pointer; `zoomTo` interpolates through it with `SPRING_STANDARD`, re-solving the offset in CLOSED FORM each frame so the fixed point holds for the whole journey rather than only its endpoints. Verified by measurement: anchored at the top edge the range narrowed from 8:00–16:00 to 8:00–15:00 with the top unmoved, and anchored at the bottom the bottom held instead. A threshold crossing now calls `onViewChange` — it wrote `view.value` directly before, so on `/calendar`, which renders `hideHeader` and owns the segmented control in two OTHER hydration roots, the grid showed Day while the control and the period label still said Week. **(D) THE HTML POPOVER LAYER** (`EventPopoverLayer`) — single event, a two-step stack list → detail flow, and a drag-to-create composer that TRACKS the live selection — `BodyPortal`'d past the canvas, the lane's `overflow: clip` and the glass re-base, positioned by `useFloating`. A canvas rect is not a DOM element, so the anchor is a zero-size PORTALLED proxy while ownership is tethered by a second INLINE one: `overlay-registry` derives parentage from where a TRIGGER sits, and with one portalled proxy a parent dialog reads a click inside this popover as an outside click and closes. **(E) Month** gains continuous threshold-based scrolling (a three-page track translated by `transform` only, committing SYNCHRONOUSLY at the threshold so the month's identity never depends on a frame) and a "Now" pill, defined for a paginated view as paging to the month containing today. **(F) The card** anchors top-left with generous padding, OMITS a metadata item whole rather than ellipsising it (the title still degrades gracefully — a card with no title is an unlabelled box), keeps a strict 1px gap taken inside `eventRect` so paint and hit-test cannot disagree, expands DOWNWARD on hover with a lift and an ambient shadow from the four `lift*` palette entries that were resolved but read by nothing, and steps its stack silhouettes straight down with no horizontal offset. **THIRTEEN DEFECTS, TWELVE FOUND BY MEASUREMENT RATHER THAN INSPECTION AND THE THIRTEENTH BY THE PRODUCT OWNER, EACH OF WHICH WOULD HAVE SHIPPED:** (1) a TDZ `ReferenceError` — a signal effect reaching the `canvas` const during a partial re-render — took the whole island down; (2) **`createSpring` never resolved when rAF EXISTS and never fires** (`document.hidden` false, `visibilityState` "visible", zero callbacks in 16.7s — a fully occluded window, some remote displays, and this repo's preview pane), so every spring in the product could strand: closed with a timer watchdog, since `setTimeout` fires where rAF does not; (3) **`.cal` lost its layout box when `calendar.css` was split into sheets** — only its tokens moved — so `.cal__main` sized to content at 2,630,960px and the Day view had no bounded scroller and therefore no scrollbar; (4) `zonedParts`/`zonedTimeToMs` threw `RangeError` inside a RENDER BODY, removing the component and every child under it — now total, because a clamped date at the edge of time is visible and findable while a throw shows nothing at all; (5) the day window clamped only ONE side of each index; (6) the zoom anchor was re-derived mid-gesture against a `scrollTop` not yet re-pinned for the new scale, and the error compounded — a six-notch trackpad burst walked the viewport twenty-five weeks off target; (7) that same burst then collapsed to a SINGLE notch, because each notch read a `pxPerHour` the spring had not moved yet; (8) `durationLabel` printed **"0 min"** for a deadline at four call sites; (9) keyboard activation bypassed the popover entirely, so the accessible layer had become a second, quieter product; (10) **every anchored panel in the product mirrors to the wrong side under `dir="rtl"`** — `--float-left` is a physical `getBoundingClientRect` number and ten sheets fed it to `inset-inline-start`; (11) `--cal-pop-*` was scoped to `.cal`, which a body-portalled panel is not a descendant of — the `--wlt-*` trap of Decision #60, closed by lifting the whole token block to `:root`; (12) `.cal-pop__event--masked` was a class hook with no rule; (13) **INTRODUCED BY THIS PASS AND CAUGHT BY THE PRODUCT OWNER, NOT BY ME** — lifting the calendar token block to `:root` (the correct fix for (11)) carried the engine’s LAYOUT declarations up with it, and `:root` IS `<html>`: the document became `display: flex; overflow: hidden`, which made `<body>` a shrink-to-fit flex ITEM. The entire shell, top bar included, then stopped at its content width — and because a canvas has an intrinsic width of 300px, the calendar pages collapsed hardest. Measured at 1600px viewport: `body` 1440. The lesson is the same one (11) taught from the other side: `:root` is a shared, global selector, so a block moved there must be audited declaration by declaration, not moved wholesale. The `:root` block now holds custom properties and nothing else, with the trap written into its own doc comment, and `.cal` carries the box. **NOT VERIFIED IN THIS ENVIRONMENT, and stated rather than claimed:** anything needing a composited frame — the lever's live rate-scrolling, the morph, the hover expansion's motion, the month spring-back, and drag-to-create tracking. The preview pane reports `visible` and composites nothing, so screenshots time out and real pointer input is unavailable; the pure physics is pinned by unit test instead (`chrome_test.ts`, `layout_test.ts`, `day-window_test.ts` — 385 green). **FLAGGED, NOT SILENTLY RESOLVED:** (a) the exit spring `{300, 18}` is ζ 0.520 and **BOUNCES**, which §B.5 and root §3 gate #4 forbid — it ships at the product owner's explicit request as `SPRING_EXPRESSIVE_EXIT`, declared once, scoped to one decorative exit, with `requireOverDamped: false` as the single greppable opt-out; (b) a rate control **cannot be dragged to an absolute depth** — inherent to the brief and paid for by the mini-map, the period trail and the present pill, but it is a real loss; (c) **pinch-to-zoom is implemented but ships OFF** (`enablePinchZoom`, default `false`): turning it on requires `touch-action: none` on the grid and reverses a logged WCAG 1.4.4 decision that two-finger gestures belong to the browser, which needs a human; (d) `/[handle]/availability`'s zero-height guest-shell bug (Decision #73(c)) is FIXED, in two halves that failed for different reasons. On DESKTOP `.guest-shell__region` carried `align-items: flex-start`, which the aside never needed — it already opts out with its own `align-self: flex-start` AND carries an explicit `block-size` — so the only item that rule ever governed was the BODY, which it stopped from stretching; a surface whose `block-size: 100%` chain then had nothing to resolve against rendered at ZERO height. On MOBILE the desktop rules sit inside `@media (min-width: 768px)`, so the body fell back to auto height — and even once it filled, `100%` still computed to `0`, because a MAIN-axis flex item's size is treated as indefinite for percentage resolution where a cross-axis stretch is not. The mobile body is therefore a flex COLUMN, which hands the surface the remainder through the `flex: 1 1 0` its base rule already carries — the dashboard's own mechanism, and no percentage at all. `.cal-surface--full` also gained the `block-size: 100%` it had never had: it was a class hook with no rule, relying on a `flex` that is inert inside a block parent. Verified at 1600 / 768 / 375, LTR + RTL: `.cal` measures 800 / 600 / 724px where it measured 0, the canvas paints, 19 accessible cards are present, zero horizontal overflow either direction — and the other three guest lane routes (`/@handle`, `/explore?category=`, `/view/[id]`) are unchanged at both widths, with the aside still sticky, still bounded by the region, and the footer still flush against it; (e) `Element.l` shows Preact's handlers bound to the DOM lever handle, yet a synthetic `pointerdown` does not reach them in this pane — unresolved, and indistinguishable here from the same compositing limitation. | `DESIGN_SYSTEM.md` §B.5 / §C.1 · `packages/ui/core/motion.ts` (+ `SPRING_EXPRESSIVE_EXIT`, the frame watchdog) · `packages/ui/calendar/core/{layout,chrome,scene-build,scene-paint,time}.ts` · `packages/ui/calendar/components/{TimeGrid,DayTimeline,MonthGrid,EventPopoverLayer,OverlayScrollbar,EventBlock}.tsx` · `packages/ui/calendar/hooks/{useCanvasViewport,useCalendarViewport,useOverlayScrollbar}.ts` · `packages/ui/calendar/islands/Calendar.tsx` · `packages/ui/calendar/styles/{shell,popover,motion,event,month,chrome,grid}.css` · `packages/ui/styles/index.css` + 9 anchored-panel sheets (the RTL fix) · `packages/types/scheduling/scheduling.ts` · `packages/backend/services/scheduling/calendar-fixtures.ts` · `apps/web/features/calendar/**` · `supabase/migrations/00000022_tables_scheduling.sql` · Decisions #37 / #60 / #62 / #71 / #72 / #73 |

| 76 | **Explore Home rebuilt — an above-the-fold block, one rail idiom, and the card family's tags, price and crest (2026-08-23).** `/explore` State A is rebuilt in two blocks. **THE FOLD** — a compact hero (headline + the shared search + quick-filter pills), a category chip bar, and a 20/80 Recommended panel — is sized to the first screen by construction: a definite `block-size` with a `minmax(0, 1fr)` last row, so the recommendations absorb exactly what the hero and the chips leave and the cards shrink into it. Measured at 720px: hero 213 + chips 42 + panel 368, fold bottom **exactly 720**, cards uniform within each panel with **zero content overflow** on all four toggles — against 591px of hero and an 8,955px document before. **THE BODY** is five rail sections (Services · Freelancers · Projects · Digital Products · Articles & Guides, the last with an inline search) plus a **"Continue where you left off"** rail offset toward the trailing edge, each built from ONE `HomeRail` island: a bold-italic category over a regular muted qualifier, a scroll-**progress separator** through the middle, and paging arrows on the right — never over the cards. Document height 8,955 → 5,652. **The cards stay SERVER components**, passed into the islands as children, so the first byte carries the content and the islands carry only the gesture. **Card family:** status chips lose their dot and become solid rounded-rectangle pills; skill and project tags become solid rounded-rectangle pills on a new `--ex-tag-bg`; the service price becomes a two-line stack (`From £120.00` over a muted `/ ticket`) with **no range and no conversion tail** (`serviceStartingPrice` reads `servicePriceParts`, so the card cannot disagree with `/view/[id]`, and `MoneyView`'s `hideOrigin` suppresses only the VISIBLE disclosure — the origin and the rate stay in the accessible name); the project card loses its background AND its border (spacing is §B.4's first-choice device and a rail already spends it; hover is an inset ring); and the profile card's hover highlights strip is deleted. **THE CREST IS ONE GLYPH NOW.** Three independent geometries rendered one concept (the registry, `profile-glyphs`, `VerifiedBadge`) — a §B.7.7 merge-gate breach — collapsed onto the registry's `"verified"` thunk, now a **rounded eight-pointed trust star with a centred check** (verified by sampling the rendered path: **8 peaks, 8 valleys**, effective R 9.11 / r 7.19, bbox 2.88→21.11 clearing §B.7.2's inset, check vertices 1.47–4.33 from centre). Stroke-only, because `icon.css` implements `data-filled` as a whole-`<svg>` fill and cannot address one child, so a solid star with a knocked-out check is inexpressible without changing the package's icon contract for one mark. Eleven call sites repointed, three fractional icon boxes (0.9 / 0.95 / 1.2rem) moved onto the `--icon-*` ramp, and `CheckoutBlockers`' `verification_required` repointed to `shield` — a crest asserting an entity HAS been verified, painted in `--warning`, beside a sentence saying it has not, is §B.7.7's "one name for two concepts". **THE FOOTER now reaches authenticated public routes**: a `bodyFooter` slot on `UserShell` rendered inside `PageCanvas` and resolved per-URL by `publicFooterFor` — the only mount point that survives the three `position: fixed; z-index: 0` surface fills (`.ui-page-canvas__body` is already `position: relative`), inherits the ≤767px bottom-nav reservation, and leaves the viewport-fixed corner seam alone. It gains Setup & onboarding, Recently viewed (an island — the history is per-device `localStorage` and cannot SSR), and Blog. `landing.css`'s two UNSCOPED `.lp-footer*` overrides were DELETED: they collapsed the footer at 768/560px where `footer.css` collapses at 900/640px, so `/` reflowed differently from every other public surface and ran the accordion's per-row hairlines down two half-width columns. **Backend, additive:** a `model` (delivery-model) facet so the **Sessions chip has a truthful href** — measured, `?q=session&category=services` returned **0** items — and `model` is deliberately INERT on non-services (a projects query with `model=Session` returns all 5, not 0); a ranked `recommended` bundle on `HomeFeed` built from the SAME comparator as `?sort=recommended`, so the panel and a search cannot disagree; and a batch `/api/explore/items?ids=` preserving the caller's recency order. **Seven defects found by measurement, not inspection:** (1) a FUNCTION prop on an island (`searchHref`) failed the whole render with "Serializing functions is not supported" — island props must be serializable, so the caller now names a category and the island builds the URL; (2) the fold's card media resolved to **0px** on every card, because `aspect-ratio` supplies only a PREFERRED size and loses to a sibling growing into the same space — the media takes the slack and the body is fixed; (3) the compact card body then overflowed its box by up to 48px and the fold's `overflow: clip` cut the PRICE off every card; (4) `.ex-rec__panel { display: none }` lost the cascade to `.ex-rail__track { display: flex }` at equal specificity declared later, so all four panels rendered at once; (5) the fold's implicit `auto` grid column took its children's min-content and the hero's fixed-44rem search bar pushed it to **936px inside a 375px viewport**, hidden by `.site`'s `overflow-x: clip` with no scrollbar to say so; (6) the theme's `--on-<role>` pairs are NOT all AA — measured **success 3.17:1, warning 3.16, danger 3.17, info 3.17 in LIGHT** — so every chip fill is now mixed 72% toward `--on-surface`, which is correct in both themes by construction because `--on-<role>` and `--on-surface` always sit on opposite sides of the role colour (top-rated 8.27 / 8.35, fast-replies 5.01 / 5.77); (7) the hero quick pills inherited `--on-primary` on `--primary` and measured 4.43:1 light / **3.21:1 dark**, so they moved onto the solid `--chip-on-media` label surface (17.14 / 14.93) — exactly the case that token was promoted for. **No DB migration** (a read projection over fixtures, like Decisions #12/#41); **no new `@projective/ui` primitive** → no `DESIGN_SYSTEM.md` §C.1 change (the `useCarousel` `progress` signal is an app-feature hook, additive, and its two other consumers destructure by name); **no lifecycle change** → no `PRODUCT_MANAGEMENT.md`; **no new simulatable axis a surface branches on** → nothing to mirror in the Dev Context Switcher (§5). **FLAGGED — surface, do not silently resolve:** (a) **the fold DEVIATES from `DESIGN_SYSTEM.md` Part D**, which says a surface meant to fit the screen "fills its grid row; it does not re-derive one" and carries no `min-block-size` floor. The fill technique cannot express "the FIRST screenful" — its precedents are the entire page, and a `1fr` basis here resolves to what is left after a long body, which is nothing. On this route the chrome is not a guess (`/explore` mounts no middle-nav bands, and the SHELL sets the token, not the page), and the floor's stated hazard — a fit-to-screen page growing a scrollbar — does not apply to a page that scrolls by design. Recorded in the stylesheet, not resolved. (b) **Businesses and Individuals lost their dedicated Home sections**; they survive in the Recommended panel's People toggle and in the chip bar, which is why that bar carries nine chips rather than the four the design names. (c) The chip bar **does not overflow above ~1000px of content width**, so its arrows and fades correctly withdraw and are exercised only on tablet and phone. (d) **"Continue where you left off" is per-DEVICE recency**, never personalisation: there is no server-side view history anywhere in the product, so it renders NOTHING until it has hydrated and found something, and a phone and a laptop disagree. (e) The service card no longer shows the Pipeline RANGE; `/view/[id]` and the search drawer still do, and the card's floor is the same `servicePriceParts` low end, so they agree — but a reader comparing the two sees one figure in one place and two in the other. (f) `--on-primary` on `--primary` measures **3.57:1 in dark** and the hero HEADLINE still uses it; at 26–40px that clears the 3:1 large-text floor, and it is this band's pre-existing pairing (Decisions #64/#65), routed around again rather than fixed at the token layer. (g) `ProfileGrid` was deleted as dead (Home was its only consumer), along with `.ex-head*` and `.ex-eyebrow--rule`. (h) There is no `/blog` route; the footer's Blog link points at `/help`. (i) `verification_required` and `spend_limit` now share the `shield` glyph in checkout — one of the two probably wants its own mark. | `DESIGN_SYSTEM.md` Part D / §B.4 / §B.7 / §B.8.4 · `packages/ui/icons/core/paths.tsx` · `packages/types/explore/discovery.ts` · `packages/backend/services/explore/{query,ExploreBackendService}.ts` · `apps/web/features/explore/**` · `apps/web/features/marketing/{components/PublicFooter,core/{footer-slot,useCarousel},islands/RecentlyViewed.island,styles/{footer,landing}.css}` · `apps/web/features/shell/components/UserShell.tsx` · `apps/web/routes/{(public),[handle]}/_layout.tsx` · `apps/web/routes/api/explore/items.ts` · `apps/web/features/profile/**` · `apps/web/features/view/**` · `apps/web/features/checkout/components/CheckoutBlockers.tsx` · `apps/web/utils/storage-keys.ts` · Decisions #3 / #12 / #39 / #41 / #45 / #62 / #64 / #69 / #74 |

| 77 | **Explore polish — full-bleed layout, a calmer card, and the icon set's first two-tone channel (2026-08-24). REFINES #76.** Ten adjustments over the rebuilt `/explore`, plus one real package contract change underneath them. **(A) THE PAGE IS FULL WIDTH.** `.ex-fold__inner` and `.ex-home__section` dropped `max-inline-size: var(--container-xl)`. The shell already insets the content region — the guest gutter, or the L-shell's rail and frame — so capping it a second time stranded up to 300px at 1600px while the shell was still reserving its own inset outside that; measured after, both span the canvas exactly (0→1585 guest, 64→1425 authed). **(B) The hero is a BANNER, not a stripe:** `--radius-2xl` corners and a `var(--space-4) var(--ex-pad-x) 0` margin. A margin on a grid item is accounted for by its track, so the fold's height arithmetic is untouched and the bottom still lands on the viewport to the pixel (720/900 at both tested heights, both shells). **(C) The hero quick pills return to GLASS**, and the first attempt at it was wrong in an instructive way: a frosted `--on-primary` veil LIGHTENS the ground toward the near-white ink and measured **2.81:1 in dark**, worse than the 3.21 it replaced. The ink on this band is fixed, so the only direction that helps is away from it, and the only token that moves that way in both themes is `--scrim` (a fixed `#000`). A 24% scrim veil under the same blur, saturation and soft `--on-primary` border measures **7.63:1 light / 5.65:1 dark** — still glass, smoked rather than frosted. **(D) The chip bar centres on the OUTER row**, never on the scroller: `justify-content: center` on a scroll container splits the overflow across both ends and makes the first item unreachable in several engines, so the row centres and the scroller shrinks to content (`flex: 0 1 auto`), degrading to a start-anchored full-width scroller when the chips do not fit. Chips lost their border — §B.4 tier 5 licenses a contour as ONE device, and a solid tonal fill was already carrying them. **(E) `.ex-rec`'s row gap 24px → 8px**, a two-value gap so the toggle/rail column keeps its own. **(F) PROJECTS ARE A 2×2 GRID**, not a rail — the one card in the family with no media and so a predictable height, and a brief is compared rather than browsed past. It is a plain SERVER component (`HomeGrid`), because a grid has no scroll to drive and mounting the rail island to hide its own controls would ship a hydration root to run an empty `useCarousel`; the heading is extracted to a shared `RailHeading` so the two section kinds cannot drift on the one thing a reader reads as repeated. The rail's negative trailing bleed is explicitly NOT applied to it — that margin exists to let the next card peek, and on a fixed grid it would push the second column under the page gutter. Measured: 2 columns, 4 cells, 0 clipped at 1600 / 1440 / 1024, collapsing to one column below the phone cusp. **(G) The progress fill is an explicit three-stop horizontal `--primary` gradient** on a 3px track, with an RTL rule reversing the stops — a gradient has no logical-direction keyword, and "faint where you came from, full where you reached" has to stay true in both reading directions. **(H) CARD HOVER IS A COLOUR CHANGE AND NOTHING ELSE.** The Y-axis lift, the coloured glow, the media zoom and the profile cover zoom are all gone, along with `--ex-glow` and the transform/box-shadow transitions; the wash steps 12% → 14% to carry the signal alone. The lift in particular moved the target at the moment the reader committed to clicking it. The project card, which has no thumbnail to extract a colour from, takes a neutral `--on-surface` 6% step instead of its hover ring — same device, same weight, a different source for the colour. **(I) The card action cluster is Share · Star · kebab** as one row of three identical glass affordances; the helper "Add to project" moved into the menu so the row is three wide on every card rather than four on some, and the old `--primary`-filled quick-action is gone (a filled circle beside a glass one said the two were different KINDS of control when they are the same kind at different frequencies). Star is auth-gated to a sign-in link in the same slot, carries `aria-pressed`, and its accessible name changes with its state. **(J) The AD token moved to BOTTOM-right**, which frees the corner the actions now need and let the `:has(.ex-ad)` sidestep rule be deleted. **(K) THE CREST IS SOLID WITH A WHITE CHECK, and that needed a real addition to the icon contract** — `data-filled` floods the whole `<svg>`, so filling this glyph turned its checkmark into a blob. New **§B.7.8**: a glyph may nominate exactly ONE `data-knockout` part, which stays stroked in `--icon-knockout` (default `--surface`) when filled and is inert when not. §B.7.6 survives by the DIRECTION of the dependency — the glyph declares only which part is the knockout and the CALL SITE supplies the ground, which is why the architect tier chip gets its inversion right (`--icon-knockout: var(--primary)` on a `--primary` chip) instead of cutting a white check out of a white star. All six crest call sites are now `filled`. **Two defects found by measurement, not inspection:** (1) the frosted-glass veil in (C) made contrast WORSE, in the direction opposite to the one intended; (2) moving the AD token to the bottom edge dropped it into the profile banner's mask fade, where it rendered at a measured **83% opacity** and fell further as the banner shortened — a paid-placement disclosure that fades is not a disclosure. The fade fraction is now one `--ex-pcard-fade` variable read by the mask AND the token, so they cannot drift, and the badge sits on the last fully-opaque row (52% down a 126px banner, clear of the 58% fade start). Verified at 1600 / 1440 / 1024 / 390, LTR + RTL, light + dark, in both shells: zero horizontal overflow and zero unclipped leaks in either direction, worst measured text contrast 5.13:1 (the hero headline, which is large text and pre-existing). `deno task check` and `deno lint` clean over 45 changed files; `deno test packages/` 391 passed / 1 failed, that failure pre-existing on a clean tree (an `--allow-env` issue in a scheduling test). **An adversarial review of this pass confirmed 12 defects; 11 were mine and are fixed here.** The AD token on the PROFILE card was pushed back into the actions' corner by its own 42% fade offset (measured 32x3.3px overlap at 1440, 32x11px at 375, with `.ex-actions` at z-index 3 hit-testing above it) — the sideways shift is restored, scoped to that card. `.ex-rec__head` got **8px TALLER**, not shorter: the grid had a definite height and two `auto` rows, so `align-content: normal` handed half of every pixel saved straight back; an explicit `grid-template-rows: auto minmax(0, 1fr)` collapses the head to its natural 32px and the fold's cards went **285px -> 471px**. The three-button row covered **90% of the project card's timestamp** (100px of 111px, and permanently on touch, where `@media (hover: none)` pins the row visible) — the header now reserves the cluster's width, and because a 116px gutter starves a 230px fold card the timestamp is DROPPED by container query below 340px of card width rather than crushed to a measured 0px. `ContinueRail` was hand-rolling the rail chrome and the copy was broken in a way the original is not — `useCarousel`'s effect is mount-only and the component returns `null` until its fetch resolves, so the track never existed on the one run the effect had: no progress, Prev disabled forever, drag dead, and `data-scrollable` never written. It now delegates to `HomeRail`, which MOUNTS only once there are items, and it threads `authed` (every star in that rail was the signed-out link, telling a signed-in reader to sign in and sending them to `/login`). The saved star's accent measured **1.45:1** over a blown-out thumbnail, so the pressed state drops its glass for the solid `--chip-on-media` ground and now measures **5.15:1 regardless of the photograph**. All 203 icon-only controls gained the §B.8.5 portal `Tooltip` they were missing (every visible one is 32x32, none uses a native `title`); the kebab menu now moves focus into its portalled panel and returns it on close, which was **348 tab stops** apart; `.lp-card` on the landing page lost its lift and shadow so `/` no longer shows two hover vocabularies in adjacent bands; the dead `.ex-rail--grid` hook is gone; and §B.7.8 was refiled after §B.7.7. **FLAGGED — surface, do not silently resolve:** (a) the media and cover **hover zooms were removed** as part of "hover should only trigger a background colour change"; they were a deliberate Decision #74 feature, and restoring them is one rule each. (b) `.lp-card` on the marketing landing page still lifts and shadows on hover — it is a separate family from `.ex-card` (the ONE deliberate fork, per the card-twin audit) and was out of this brief's scope, so `/` and `/explore` now behave differently on a project card. (c) The AD token sits bottom-right of the MEDIA FRAME rather than of the card box, which is what keeps it on the image where its glass reads; on a card whose media is the top ~60% that is not literally the card's bottom-right. (d) `--on-primary` on `--primary` is **3.57:1 in dark** and now paints the crest's knocked-out check — a checkmark is a graphical object, where 3:1 is the AA floor, and it is the pairing every filled primary control already uses; the underlying theme-engine defect (Decisions #64/#65) is still unfixed at the token layer. (e) The chip bar still does not overflow above ~1000px of content width, so its arrows and fades remain exercised only on tablet and phone (inherits #76(c)). (f) **NOT MINE, NOT FIXED, and blocking on its own terms:** `packages/ui/navigation/styles/nav.css` carries an uncommitted change from another session that made `.ui-nav-item--active` a SOLID `--primary` fill while leaving `color: var(--on-surface)` from the tint era — measured **2.90:1 dark / 3.19:1 light** on 16px/600 text, against a 4.5:1 floor, on the global rail's active item on every authenticated route. Swapping to `--on-primary` only reaches 3.57:1, so the solid fill cannot host this label under the current token layer at all; the tint it replaced could. The same hunk also silently deleted the collapsed-rail `::after` "you are here" marker. Left untouched because it is another session's in-flight work and outside this brief. (g) `apps/web/features/catalogue/styles/catalogue.css` still uses `--card-hover-lift`; the `/catalogue` console was out of scope, so it is now the last surface in the product whose cards lift on hover. | `DESIGN_SYSTEM.md` **§B.7.6 / §B.7.8** (new) + the §B.7 merge gate + §C.1 icons row · `packages/ui/icons/{styles/icon.css,core/paths.tsx}` · `apps/web/features/explore/styles/{explore,explore-home}.css` · `apps/web/features/explore/islands/CardActions.island.tsx` · `apps/web/features/explore/components/{ExploreHome,HomeGrid,RailHeading,VerifiedBadge}.tsx` · `apps/web/features/explore/islands/HomeRail.island.tsx` · `apps/web/features/profile/{styles/profile.css,components/ProfileBadges.tsx,islands/*}` · `apps/web/features/view/{styles/project-view.css,islands/ProjectViewHeader.island.tsx}` · Decisions #64 / #65 / #74 / #76 |

| 78 | **Clean Minimalist Luxury Architecture — the anti-card / anti-tag / conversion-lane laws institutionalized (2026-08-24).** A documentation-and-specification pass that turns five recurring UI failures into merge gates, followed by the `/view` implementation that is their reference. The failures, all found shipping across the `/view` archetypes: **card-in-card nesting** (a scope list inside a card inside a stage inside an elevated panel — three surfaces, two shadows and up to twelve borders on one screen, none of which the reader can rank); **over-tagification** (nine pill containers on one card, none clickable — a chip is a control, so containment is a promise of interactivity that is then refused); **muddy semi-transparencies** in dark theme (an alpha region background is unmeasurable because its rendered value depends on the stack beneath it, compounds when nested until three regions sit within ~1.1:1, and then invites a border to rescue the boundary it lost — two devices spent where one opaque step was free); **heavy typographic weights** (with only five weight masters, expressing every level through weight collapses two or three levels onto `600`/`700` and they compete); and **layout collisions** between the global rail, the middle-nav lane and a right-side sticky purchase card — a four-track layout inside a content region that has already spent ~344px on chrome, which starves the 16:10 media, doubles the sticky seams, and below ~1280px makes the primary CTA's presence a function of window width. **Encoded as:** `DESIGN_SYSTEM.md` **§A.4 four registers** (display · section header · body · meta, each moving size/case/tracking together; a title is `--fw-medium` and never `--fw-bold`+; two adjacent levels at `600`+ is a hierarchy failure; `tabular-nums` on any changing figure); **§B.4.1** asymmetric spacing as a RATIO (`--space-7` above a heading, `--space-3` below — a symmetric gap attaches the heading to both neighbours equally, which is the ambiguity a border was resolving); **§B.4.2** the surface ladder is SOLID (`--bg` → `--surface-1` → `--surface-2`; `color-mix` stays correct for ink, marks and states, and is wrong as a region's own background); **§B.4.3** functional transparency only (`backdrop-filter` on viewport-pinned top bars, floating sheets/scrims, and marks on arbitrary photography — nowhere else, always on a `::before` underlay); **§B.9.7–B.9.8** zero cards for static content and the unboxed checklist; **NEW §B.11 Anti-Tagification** with the four things that still earn a container (a control · a lifecycle status · a required disclosure · a count that must not wrap) and the test that separates the near-misses — **a status is a state that can change, a category is what a thing permanently is**; **NEW Part D.7** the Conversion Lane; **NEW Part D.8** the five archetype render contracts. `PRODUCT_SPEC.md` gains §The Entity View (the five archetypes as business objects, and the five things every archetype must disclose before purchase) plus §Composition rules; `SYSTEM_ARCHITECTURE.md` §3 gains the four composition directives and a §Entity View section on server-side archetype resolution; root §3 gains gates 6–10 and §9 five checklist rows; `packages/ui/CLAUDE.md` gains four hard rules. **The conversion-lane rule in one line: the transaction has exactly one home.** The lane carries identity · price · one `filled` primary · one `outlined` secondary · a summary ledger, with secondary actions (Share · Save to list · Request custom scope · Report) in a kebab; the main stage carries evaluation material and **no price and no purchase control on desktop**; below `--bp-md` the lane is not rendered and the duty **transfers** to one body-side block rather than duplicating — the `.pf-header__actions` and `/wallet`-header-switcher pattern (Decision #63). An offer stated twice on one screen is an offer that can disagree with itself. **FLAGGED, NOT SILENTLY RESOLVED — needs a human:** (a) **the brief's surface hexes name a different token than its rule does, and MEASUREMENT settles that they name no live token at all.** It pairs canvas `--bg` (`#1A1A1A` dark / `#FAFAFA` light) against elevated `--surface-1` (`#212121` / `#FFFFFF`). Those four hexes are real and documented — but they are §A.1's `--bg`/**`--surface`** pair, not `--surface-1`. And the §A.1 table is the SEED contract, not the runtime: read live in-browser on `/view/sv-brand-identity-sprint` in dark mode, the Material-You engine (`theme-engine.ts`) resolves **`--bg: #050808`**, **`--surface: #0b0f0f`** and **`--surface-1: #151819`** — so all four brief hexes are absent from the running theme, and `--surface-1` is nowhere near `#212121`. The token NAMES were encoded (the ladder and its intent are right) and the hexes were not, per §3's token-only rule and the Decision #70(a) precedent that a generated theme's literals are not authorable. Two things still need a human: whether the elevated step should be `--surface` or `--surface-1` (a visible difference in dark mode), and whether §A.1's seed table should say out loud that it is a seed rather than a set of shipped values — it has now misled two briefs. (b) **`--on-primary` on `--primary` still measures 3.57:1 in dark** — the pairing every filled primary control in the product uses, flagged by Decisions #64/#65/#74/#76/#77 and routed around again here (§D.8.1 specifies a primary RING with the numeral on the surface pair for stage step nodes). It is a theme-engine defect at the token layer and has now been routed around six times. (c) **§B.11.3's four-container carve-out and §B.6's icon-first density both govern a dense list row**, and §B.6.2 requires an in-row status to be a glyph or a dot while §B.11.3 permits a status FILL — the two are compatible in a lane (glyph) and in a card (fill), but the boundary is stated nowhere; related to the open Part F.4. (d) §B.4.3 bans glass outside three cases, and `.ui-guest-aside` (§D.5) is a floating glass **lane**, which is none of them — it is grandfathered as identity chrome rather than re-litigated here, but the rule as written condemns it. **THE IMPLEMENTATION (same change).** `/view/[entity]` + `/[handle]/view/[item]` are rebuilt as the reference implementation of the above: a pure `resolveArchetype` (`entity-archetype.ts`) maps a listing's delivery model onto one of five commerce bodies — `pipeline` · `one_off` · `session` · `cohort` · `product` — and BOTH the canvas (`EntityViewPage`) and the conversion rail (`MiddleNavActionLane`) are hydrated from that one answer, so they cannot disagree about what is being sold; `headlinePriceFor` delegates to the SAME `serviceStartingPrice` the Explore card that linked here reads, so they cannot disagree about what it costs. `Direct Deliverable` folds into `one_off` deliberately (it differs in how work is STAFFED, not how it is bought — two templates describing one purchase would drift). New: `StageProgressLedger` (the continuous timeline — ONE absolutely-positioned rule for the whole run with the nodes painted over it, so an expansion cannot break the sequence; native `<details>` so it stays a SERVER component and works with JS off, and is NOT an `Accordion`, which brings the bordered panel §D.8.1 exists to prevent), `entity-view-parts.tsx` (Section · MetaLine · ScopeChecklist · SpecLedger · PermissionLedger · SeatMeter · TrustSignals · StatusMark — the rule only holds if the compliant component is sitting where the violation used to be, or the next author reaches for `Card` and `Tag` because those are what is available), `EntityCanvas`, `EntityBuyBar`, `entity-view.css` (`.evp-*`, ~1,100 lines, zero translucent region backgrounds, zero `backdrop-filter`). Additive Zod SSOT `ProductViewSchema` (format · file manifest · spec ledger · compatibility matrix · full licence permissions · live preview) derived deterministically in `view-fixtures.ts` — **no DB migration** (a read projection, the `ServiceViewSchema` precedent). Superseded and DELETED so two implementations of one surface cannot drift: `EntityViewScreen` · `ServiceViewScreen` · `ViewDetails` · `ViewActionLane` · `ViewBuyBar`. **Verified in-browser** at 1440 and 375, LTR + RTL, light + dark, across all 7 listings (4 service models + Direct Deliverable + 2 product formats): **0 cards and 0 visible chips in every body**, exactly **1 `filled` + 1 `outlined`** in every lane, **0 price controls in the desktop canvas**, lane 280px mirroring 64→1081 under `dir="rtl"` with **zero horizontal overflow in both directions at both widths**, worst text contrast **7.46:1**, zero headings at `--fw-bold`, the kebab body-portalled with all four secondary actions, and the mobile duty transfer exact (lane `0×0` / buy bar `343×317` carrying price + both CTAs + the escrow notice). **Six defects found by measurement, not inspection:** (1) a Pipeline's secondary control IS the basket button but was labelled "Message provider" — a mislabelled control; (2) the meta line rendered "branding · Pipeline · 10-day delivery · **branding** · design" because category and skill vocabularies overlap, so it now dedupes case-insensitively; (3) **every stage rendered COLLAPSED on every service** — `open={status === "active"}` never fires because a service being SOLD has no active stage, so the entire "what you get" was hidden behind four 33px one-liners (now: open the active stage if there is one, else open all); (4) four consecutive identical "UPCOMING" labels, suppressed — a status word identical on every row distinguishes nothing; (5) "Attribution required: **Included**" put a green check against a CONSTRAINT, inverting the allowed/denied axis (rephrased as the right "Use without attribution"); (6) three reused rail headings at `--fw-bold`, which the new §A.4 gate forbids on its own reference surface. Also fixed: list keys were the item STRING, so a duplicate collided in Preact — keyed by index, because a component must not depend on its caller having deduped. **No new `@projective/ui` primitive** (reuses Button · Popover · Tooltip · Avatar · RatingStars · MoneyView · AudioVisualizer · Icon) → **no §C.1 roster change**; no lifecycle change → no `PRODUCT_MANAGEMENT.md`; no new simulatable axis a surface branches on → nothing to mirror in the Dev Context Switcher (§5). **NOT verified:** the live checkout round-trip from these CTAs (the panel is `BuyNowModal`, unchanged and already covered by Decision #68), and `:focus-visible` rendering (the preview pane never takes real keyboard focus — the rules are confirmed present and using the canonical composite token by source audit only). | `DESIGN_SYSTEM.md` §A.4 / §B.4.1–B.4.3 / §B.9.7–B.9.8 / **§B.11** / **§D.7** / **§D.8** / Part E · `PRODUCT_SPEC.md` §The Entity View / §Sitemap / §Composition rules · `SYSTEM_ARCHITECTURE.md` §3 / §The Entity View · root `CLAUDE.md` §3 / §9 · `packages/ui/CLAUDE.md` · `apps/web/features/view/**` · Decisions #3 / #41 / #43 / #44 / #45 / #60 / #63 / #64 / #70 / #74 / #76 / #77 |

| 79 | **Entity View refactor — inverted conversion rig, content-first canvas, migrated sticky header, full-width session stage (2026-08-25). REFINES Decision #78.** Six changes to `/view/[entity]` + `/[handle]/view/[item]`, and the resolution of a defect flagged seven times. **(A) THE INVERTED ACTION RIG (new §D.7.7).** The primary CTA is now monochrome — the page's ink colour as its fill — expressed as `--btn-accent: var(--on-surface); --btn-on: var(--surface)`, the inverted-surface idiom `Tooltip` already uses. The pair swaps sides with the theme by construction, so ONE declaration delivers the brief's literal spec in both directions: measured live, LIGHT paints `#191c1d` with pure `#ffffff` at **17.14:1** and DARK paints `#e0e3e3` with `#0b0f0f` at **14.93:1**, and it IMPROVES under `data-contrast="high"` (~20:1 both). **The brief's teal secondary with white text does not pass and could not be shipped as written**: white on `--primary` measures 5.38:1 light but **3.75:1 dark**, the token pair `--on-primary` measures **3.57:1**, and both COLLAPSE under high-contrast dark to **2.52:1** and **1.75:1** — the overlay meant to rescue them makes them unreadable. The fix keeps the brand fill and takes the ink from `--surface`, which resolves to `#ffffff` in light and `#0b0f0f` in dark: it IS the brief's white text where white works and flips where it does not (5.38 / 5.15). **ROOT CAUSE FINALLY LOCATED**, by executing `buildScheme` rather than reading it: `theme-engine.ts:125-126` sets dark `--primary: a1.tone(fg(55))` and `--on-primary: a1.tone(on(98))` — **both above mid-tone 50**, violating the file's OWN stated invariant that a colour and its `on-` pair must straddle it, while every other dark `on-` pair correctly uses `on(20)`; the comment directly above it describes code that is not there. That is the defect carried since Decision #64 and routed around six times. It is a one-line change that repaints every filled primary control in the product, so it is **flagged, not applied**. Also found: `.ui-button` hardcodes `font-weight: 600` as a literal (so `--fw-medium` is unreachable through the component), there is NO `.ui-button--filled` rule (the base class IS filled), and no neutral severity exists — so an inverted CTA must set the two custom properties the base rule reads, never declare `background` (a local class ties at (0,1,0) and would win only on bundle order). **(B) CONTENT-FIRST CANVAS (§D.7.8)** — structured information leads, media trails, **reversed in the DOM**; `order`/`direction` are banned because they move the box and leave the reading and tab order behind. **(C) MIGRATED STICKY HEADER (§D.7.6)** — title capped at 24ch with native truncation, seller line, archetype label, one contact control and **no purchase control** (`.guest-shell__subheader` is `display:none` ≤767px while `.ui-middle-nav__header` is not, so a CTA there would exist for a signed-in phone and not a guest one, beside the buy bar that already owns the offer). Reveal is `min/max-block-size`, never `block-size`; the root must carry `.pf-stickyhead` because the guest glass slab is keyed on that literal selector. **(D) FULL-WIDTH SESSION STAGE (§D.8.3)** — functional, not aesthetic: the calendar engine drops `.cal__side` (mini-month AND availability panel) below ~768px of its own element width, which a hero column crosses on an ordinary laptop. Verified rendering at 825x576 with the side panel intact. **(E) LANE WIDTH 280→328px.** A CSS override was impossible: `MiddleNavSplitter` writes `--shell-lane-w` as an INLINE custom property on the element `splitter.css` reads it from, present in the SSR HTML, so an ancestor override is inert while still corrupting `--shell-frame-inset-inline`; overriding `inline-size` instead would make the drag handle LIE. Threaded as `UserShell.laneOptions` → `useSplitter.initial` with its OWN `VIEW_LANE_WIDTH` key, because the shared key would let a drag on `/projects` discard the default. The guest aside has no splitter and is sized by a scoped `:has()`. **(F) SELLER INQUIRY** — a first-contact composer that creates a conversation and **nothing else: no project, no stage, no escrow**. It deliberately does NOT reuse `ChatComposer`, which would drag the asset picker (~2,000 LOC) and the MediaRecorder engine onto a public SEO page. **ADVERSARIAL REVIEW FOUND 17 CONFIRMED DEFECTS IN MY OWN WORK; every one is fixed.** The two that mattered: **(1) the inquiry composer never sent the message** — `MessagingService.create` had no body field, the text was stashed under an unregistered key nothing read, and the docblock asserted the opposite, which is precisely what lets a defect survive a source-reading review; `message` is now part of the CREATE payload (not a follow-up call, so no window exists where the thread is created and the question is not) and the stash is cleared only on success. **(2) Eight stage-jump controls were inert** — a REGRESSION: they wrote `selectedStageId`, whose only reader is the `StageFlow` island, which the commerce templates do not mount (they render the server-component `StageProgressLedger` on native `<details>`). `jumpToStage` now drives the DOM as well as the signal. Also fixed: **`.ui-sr-only` is defined nowhere** in the repo (canonical is `.ui-visually-hidden`), so two status live regions and a form label were rendering as **visible text**; a `<button>` nested inside an `<a>` in both transactional regions; `role="tab"` thumbnails exposing selection via `aria-current` with no tabpanel; a kebab advertising `haspopup="menu"` at a `role="dialog"` panel; the origin-currency line rendering unconditionally so a viewer already in the listing's currency saw the same figure twice labelled "Orig."; `.evp-section`'s margin stacking with the flex `gap` for 6rem instead of 3rem; CTA modifiers tying with `.ui-button--primary` at (0,1,0); `.evp-menu`/`.evp-inquiry` being inert hooks because the padded box is a CHILD of the panel root; and the not-found branch shipping with no stylesheet at all. **TWO DEFECTS I SHIPPED IN #78 AND FIXED HERE:** the body asserted "times are shown in your local timezone" while the engine renders the PROVIDER's zone — false as shipped, now replaced by a disclosure naming the zone actually drawn and the reader's when they differ; and the gallery/calendar toggle was **one-way** (the in-stage tablist was `display:none` above 767px and the lane's replacement only ever turned availability ON), so a desktop reader who opened the calendar could not get back without reloading. **A HARNESS FINDING WORTH KEEPING:** in this repo's preview pane **neither IntersectionObserver callbacks nor `scroll` events fire** (measured 0 and 0) while `scrollY` moves normally, and `scrollIntoView({behavior:"smooth"})` moves nothing where `"auto"` moves 1325px — all compositor-driven. The scroll probe was therefore built on IO and **replaced with the shipped scroll-listener precedent**, and the stage jump uses `behavior:"auto"`: arriving is the FUNCTION and smoothness is decoration, and §B.5 already says motion may never carry the outcome. **Verified in-browser** across all 7 listings (4 service models + Direct Deliverable + 2 product formats), authed AND guest shells, light + dark, LTR + RTL, 1280/375: hero reversed everywhere, lane 328px with no hydration snap-back, guest aside 328px, CTAs 36px/`--radius-full`/`--fw-medium`, scheduler 825px with `.cal__side` intact and the switcher working both ways, stage jump opening AND arriving, mobile duty transfer exact (aside 0x0 / buy bar 343x298), **zero cards, zero visible chips, zero price in the desktop canvas, zero horizontal overflow in either direction**. **FLAGGED — needs a human, do NOT silently resolve:** (a) the `theme-engine.ts` dark `--on-primary` invariant violation above — the one-line fix repaints every filled primary control; (b) `--fld-h-*` has no 36px step (32/40/48), so the compact CTA declares a local height, which §A.7 otherwise forbids — if the pattern spreads the ramp should gain the step rather than each surface re-declaring it; (c) §B.8.2's one-`filled` cap now has a scoped two-fill exception for this rig (ranked by HUE, not emphasis) — recorded at §B.8.2 so it is not generalised; (d) `MESSAGING_BACKEND_LIVE` is still off, so the inquiry's transport is stubbed — the payload is real and complete, only its delivery waits. | `DESIGN_SYSTEM.md` **§D.7.6 / §D.7.7 / §D.7.8** (new) + §B.8.2 + §D.7.2 + §D.8.3 · root `CLAUDE.md` §3 gates 10-11 · `PRODUCT_SPEC.md` §The Entity View · `apps/web/features/view/**` · `apps/web/features/shell/components/UserShell.tsx` · `apps/web/features/messaging/core/MessagingService.ts` · `apps/web/routes/api/messaging/conversations.ts` · `apps/web/routes/{(public),[handle]}/_layout.tsx` · `apps/web/utils/storage-keys.ts` · Decisions #45 / #60 / #63 / #64 / #66 / #69 / #78 |

| 80 | **Service booking — the seven CTA formats, the Contact menu, and the slot picker (2026-08-26).** The functional layer behind every conversion control on `/view/[entity]`. Decision #79 built the RIG; this builds what the rig DOES. **(A) SEVEN booking formats, not five.** The `ServiceType` delivery models describe how work is STAFFED and PRICED, not how it is BOUGHT, and two of them cover two purchases each. `Direct Deliverable` and `One-Off` are both fixed-scope fixed-fee, but one is bought by scoping and funding stages and the other by writing a brief; `Session` covers both a single booking and a block of N sold together. The purchase SSOT has ALWAYS distinguished both pairs (`one_off_service`/`single_service_task`, `service_session`/`set_session` in `finance.purchasable_item_kind`) — only the view layer folded them. So `@projective/types/services` UNFOLDS them into a booking vocabulary and `ServiceType` keeps its five members, which four spec files and several exhaustive `Record` maps depend on; the set-session case is carried by an additive `sessionCount` on the composed service view rather than a sixth delivery model. **(B) ONE server-resolved offer, SSR'd.** Every fact the CTA branches on — seats left, whether this seller takes calls, whether this buyer already has a draft — is a fact the SERVER owns, so `BookingBackendService.offer` resolves it once and BOTH transactional regions render it. The label comes from the SSOT's own `resolveCta`, so the lane and the ≤767px buy bar cannot offer different transactions (§D.7.4 applied to the DATA, not just the layout). It is resolved by the same URL-keyed slot resolver that paints the lane, because the CTA is the reason the page exists and resolving it in an effect would ship a first byte whose primary control is absent or wrong and then change it under the reader's cursor. **(C) THE PIPELINE CTA IS NEVER DESTRUCTIVE.** "Add to Projects" instantiates the blueprint as `status = 'draft'`, `visibility = 'unlisted'`, assignments parked at `pending_funding`, and the primary then becomes **"Open project →"** — never "Remove project". A conversion CTA that turns destructive puts a delete under a cursor that was hovering the primary one render ago, and the reader's next click is aimed at where the button WAS. Removal is a secondary control behind an explicit confirmation. Idempotent on a key, so a double-press or an unseen-timeout retry returns the SAME draft rather than leaving two identical pipelines in a workspace. **(D) Absence vs refusal, told apart deliberately.** A seller who takes no discovery calls has NO discovery-call row — the capability does not exist, and a greyed-out row implies it might. A FULL cohort is rendered-and-refused with its reason beside it — that capability exists and is exhausted, which is information the buyer came for. **(E) SCHEMA, folded in place** (§1, no new timestamped files): `project_status += 'archived'` (soft deletion, distinct from `cancelled` — one records a decision about live work, the other that nothing ever happened), `projects.projects.source_blueprint_id` / `.last_activity_at` / `.archived_at`, a `ck_projects_archived_at` CHECK pairing the status with its timestamp, `projects.fn_archive_stale_service_drafts` + a guarded `pg_cron` registration, two partial indexes, and a `service_draft_idle_days` param. `last_activity_at` is deliberately NOT `updated_at`: any write touches the latter, so a draft that was merely renamed would escape a sweep measuring it. **FIVE DEFECTS FOUND BY MEASUREMENT, NOT INSPECTION — three of them mine:** (1) **the basket's dedupe key ignored the booked instant**, so booking Mon 20 July 14:00 merged into an existing line, kept ITS time (23 July) and raised the quantity — the buyer paid for two sittings at a time neither of them chose. `itemKindMeta().needsSchedule` now discriminates: two sittings are two lines, a repeat of one sitting is idempotent. (2) **Re-configuring a One-Off reported "All 3 stages staged" over a line still holding one stage and the previous brief** — the same merge, in my own flow, reporting a success that did not happen. Re-scoping now REPLACES (softly — `removeItem` stamps, never drops). (3) **On a product, "Add to basket" opened instant checkout and added nothing** — one shared callback had to ask the offer which control had fired it, read `primary.kind === "buy_now"`, and got it wrong for the secondary. Two controls now have two callbacks; there is no question left for either to get wrong. (4) **The date rail stepped days by a fixed 24 hours**, so on a fall-back date (25 hours) it emitted the same day twice, collided its key in the slot map and lost the last day of the window — while a spring-forward day survives it, which is exactly why it ships unnoticed. A calendar-aware `addDaysInZone` replaces it in the grid builder AND the pager. (5) A test of mine asserted the wrong midnight; the code was right. **VERIFIED IN-BROWSER** (measured, not inspected) on all seven formats: the right primary and secondary per format, the picker's 14-day rail with roving tabindex and per-day availability counts, refused slots struck through and stating WHY in their accessible name, a booking round trip landing a line with its `scheduledAt` and routing to `/checkout`, all four dev axes moving the server's answer, pipeline instantiate → "Open project" → archive → back, every refusal path (401/409/422) with a field-keyed reason, the mobile duty transfer exact (lane 0x0, buy bar 343px), light 6.46:1 / dark 8.39:1 worst text contrast, hit targets 42/38/31px growing to 46px on coarse pointer, RTL mirroring with **zero horizontal overflow in either direction**, and the rail spanning a real DST boundary as 14 distinct contiguous days. `deno task test` — check, lint and **429 unit tests** including 28 new ones — green. **FLAGGED — surface, do NOT silently resolve:** (a) **the SQL was applied to a throwaway Postgres 16 and every new object verified, but the sweep's BEHAVIOUR was not exercised**: Docker's Linux engine dropped mid-run. The TypeScript twin's predicate is unit-pinned, so the rule is tested — the SQL implementation of it is not. (b) A `service_session` line still accepts `quantity > 1` at one instant, which for a 1-on-1 sitting is dubious; that is pre-existing basket semantics and was left rather than silently changing the quantity rules of a money surface. (c) `EntityArchetype` (which BODY renders) and `ServiceBookingFormat` (which FLOW opens) deliberately disagree for a Direct Deliverable — `one_off` body, `single_task` purchase — because they answer different questions; the risk is a future reader assuming one is the other. (d) `stage_assignments.status` is a free-text column with no domain, so `pending_funding` is expressible but not enforced. (e) The consolidated migrations schedule NO `pg_cron` jobs at all — the notification engine's (#57) appear to have lost their `cron.schedule` calls in consolidation; mine adds one, which makes it currently the only scheduled job. (f) Transport for the discovery call, the quote and the DM is stub-first behind the existing gates; the payloads are real and complete. | root `CLAUDE.md` §1/§3/§5/§7 · `PRODUCT_MANAGEMENT.md` §3.5 · `documentation/database/projects/{Tables,Functions}.md` · `packages/types/services/**` · `packages/types/scheduling/booking.ts` · `packages/backend/services/booking/**` · `packages/backend/services/scheduling/slot-fixtures.ts` · `packages/backend/services/projects/draft-store.ts` · `packages/backend/services/finance/basket-fixtures.ts` · `apps/web/features/view/**` · `apps/web/routes/api/services/*` · `apps/web/utils/dev-seam.ts` · `apps/web/features/devtools/*` · `supabase/migrations/{00000003,00000015,00001130,00004003,00005001}*` · Decisions #45 / #53 / #56 / #68 / #78 / #79 |

| 81 | **Site-wide unified scrollbar — one always-visible 10px bar, a surface-inherited track, and a thumb that is actually visible (2026-08-27). REVERSES the self-hiding scrollbar of Decision #15.** The product shipped TWO scrollbars: the root document kept the raw native bar, while every inner container got a custom self-hiding one (`:not(html):not(body)` in `packages/ui/styles/index.css`) that was transparent at rest and revealed on container hover or by a `[data-ui-scrolling]` stamp from a global `ScrollIdle` island. Two behaviours and two colour vocabularies on one screen. Both are replaced by ONE bar declared against `*` plus the bare `::-webkit-scrollbar-*` pseudo-elements, so it reaches `html`/`body` as well as every descendant, at 10px on **both** axes (`width` AND `height` — a horizontal bar's thickness is its `height`, and setting only `width` leaves it at the UA default). Physical rather than logical there is deliberate and **not** an §A.6 exception: `::-webkit-scrollbar` is a non-standard construct with no writing mode of its own, `width` sizes a VERTICAL bar and `height` a HORIZONTAL one — two different widgets, not two axes of one box — and the logical forms are unevenly implemented on it. **`ScrollIdle` is deleted** (a hydration root on every page whose only job was a reveal that no longer exists), with its `_app.tsx` mount and the `data-ui-scrolling` seam. **(A) THE THUMB WAS INVISIBLE, AND ONLY MEASUREMENT SAYS SO.** `--scrollbar-thumb` was registered on the neutral ramp at tone 12 (dark) / 88 (light) — against `--surface-3` that is tone 12 on tone 12, **the identical colour, 1.00:1**, and 1.23:1 at its best against `--bg`; light measured 1.11:1 / 1.36:1. Nothing about reading the stylesheet says so. A thumb is a graphical UI control, so WCAG 2.2 SC 1.4.11 asks 3:1 against what it abuts — and what it abuts is the TRACK, which is not one colour, so the tone has to clear 3:1 against the WHOLE ramp, `--bg` through `--surface-3`. Re-derived on the neutral-VARIANT ramp (so the thumb belongs to the same chrome family as `--outline`) through `fg()` (so the high-contrast overlay widens it instead of leaving a third of the chrome opted out of it): tone 46/58 dark, 54/42 light. Measured 3.17:1 at worst, 3.89:1 on `--bg`, hover ≥4.83:1, high contrast ≥4.83:1 / ≥7.14:1, symmetric across both modes. Pinned by `theme-engine_test.ts` — 10 tests over mode × contrast, verified to FAIL on the old tones — because the failure mode of an unchecked ratio here is a control nobody can see rather than a broken layout. **(B) THE TRACK IS A LAYOUT FACT, NOT A PALETTE ENTRY**, which is why `--scrollbar-track` was REMOVED from the theme engine (where it had been registered as a fixed hex) and declared once in CSS at `:root` as `var(--bg)`, then re-scoped on each container that establishes a surface. Custom properties inherit, so only the surface ROOT carries a rule and every scroller inside it follows — a lane's item list, a dialog body, a menu's option list all resolve correctly with no rule of their own. That is the whole mechanism, and it is why a body-portalled panel needs it MOST: `.ui-popover` mounts into `document.body`, outside the shell entirely, and would otherwise take the page ground. Verified live on a real portalled account menu — panel background `rgb(255,255,255)`, resolved track `#ffffff`, inner `.ui-popover__content` inheriting it. Translucent panels take **`transparent`, never a tone**: a glass ground is a `color-mix` over whatever is behind it, so an opaque track would draw the seam the veil exists to avoid. The whole authenticated frame needs only three selectors (`.ui-app-shell` → `--surface-2`; `.ui-app-shell__content` → `--surface-1`, the middle-nav ground its `::before` paints; `.ui-page-canvas` → `var(--frame-surface, var(--surface))`). **(C) VERIFICATION WAS A CHECKER, NOT AN INSPECTION.** A runtime pass walks every scroll container, finds the nearest PAINTED ground — including `::before`/`::after` underlays, which is not optional here because the middle-nav's entire ground is a pseudo-element — and compares it against the resolved track. Run across `/explore`, `/projects`, `/wallet`, `/@ahmed` (authed and guest), `/view/[entity]`, `/messages`, `/files`, `/calendar` and `/`, light and dark, LTR and RTL: 76 scoped selectors resolve to their intended token, every bar measures 10px on both axes, zero horizontal document overflow in either direction, no console errors. **Three defects found that way, none visible in source:** (1) the `/view` conversion rail — Decision #79 moved that lane OUT of the shell into the page as its end column, so it hangs off neither the shell frame nor the guest aside and was inheriting `--bg` under a panel painted `--surface-1`; no single-file audit could see it, because the rail's `overflow` is declared in `profile.css` (it reuses the `.pf-lane` skeleton) while its background is declared in `entity-view.css`. (2) `.bsk-lane__rail` declared `scrollbar-width: none` with **no WebKit twin**, so Firefox hid the bar and Chromium did not — invisible while the bar was self-hiding, a real 10px bar down a 64px icon rail once it is always drawn; it is the only such case in the repo, and the sweep that found it is worth re-running whenever a hide rule is added. (3) The bare `::-webkit-scrollbar` rules sitting in `apps/web/styles/global.css` were dead: at (0,0,1) they lost to the package's `:not(html):not(body)` selector at (0,0,3), so they only ever reached `html`/`body`, and the `--scrollbar-track` they referenced was a theme hex that could not blend with anything. **(D) Deliberate opt-outs are preserved and normalised.** Twenty-one components hide the bar outright — a component rendering its own overlay gauge (`.ui-scroll-area__viewport`, `.ui-scrollpanel__viewport`, `.cal-tg__scroll`) or a horizontal rail / tab strip where a 10px bar would be worse than none. All still win on class specificity in both engines, and the three that used `inline-size: 0` / `width: 0` were normalised onto the `display: none` idiom the other eighteen already used (a zero-sized widget is still laid out and can still reserve a corner). Five redundant `scrollbar-width: thin` declarations were dropped — the global `*` rule sets it everywhere. **FLAGGED (surface, do not silently resolve):** (a) an unenumerated surface falls back to `--bg`, which is right for anything sitting on the page and wrong for a panel nobody scoped — the runtime blend checker is the tool that finds those, and it should be re-run when a new opaque surface starts hosting a scroller; (b) a translucent panel's `transparent` track means the thumb is measured against the veil's underlying ramp rather than the composite, which holds for every veil in the product today because they all mix the same neutrals, and would not hold for a veil over arbitrary photography; (c) `.cal-tg__scroll`'s opt-out and `OverlayScrollbar` are untouched — the calendar's depth gauge is a different control with a different job. | `DESIGN_SYSTEM.md` Part D (scroll model) · `packages/ui/styles/index.css` · `packages/ui/system/core/theme-engine.ts` + `theme-engine_test.ts` · `apps/web/styles/global.css` · `apps/web/features/shell/styles/guest-shell.css` · `apps/web/routes/_app.tsx` · `apps/web/features/shell/islands/ScrollIdle.island.tsx` (deleted) · `apps/web/features/checkout/styles/basket-lane.css` · `packages/ui/{calendar/styles/grid,utils/styles/scroll-area,layout/styles/scrollpanel,display/styles/galleria}.css` · Decisions #15 / #27 / #31 / #60 / #79 |

| 82 | **Projects & Messaging read API — live DB branch, HEAD/OPTIONS, ETag revalidation and a tenant-scoped ARC cache (2026-08-30).** The first live Postgres READ path on this platform. Before this pass seventeen of the twenty fat services contained zero Supabase calls, and these two were the clearest cases: every gated method tested `isXBackendLive()`, returned fixtures when it was off, and returned **the identical fixtures** when it was on — so flipping either flag changed nothing — while five of the seven messaging methods had no gate at all. **(A) HTTP.** All fifteen `GET` endpoints (the brief said fourteen; `/api/messaging/settings` is the fifteenth) now serve `GET | HEAD | OPTIONS` from ONE resolver via `apps/web/utils/read-endpoint.ts`. A factory rather than three handlers, because RFC 9110 §9.3.2 requires HEAD's headers to match GET's and two hand-written handlers satisfy that only until somebody edits one — here the only difference between the two responses is the body argument, so they cannot drift. The body is serialised ONCE, hashed to a strong `ETag` over the exact octets, and `Content-Length` is the `TextEncoder` byte length (a title carrying an emoji is more bytes than characters, and a short `Content-Length` on a HEAD promises a body that does not exist). `If-None-Match` uses the WEAK comparison RFC 9110 §8.8.3.2 mandates and checks every member of the list. A FAILED read gets `no-store` and **no validator** — a 404 pinned by an ETag outlives the resource starting to exist. **CORS is deliberately not permissive**: these reads are cookie-authenticated and tenant-scoped, so a wildcard (invalid alongside credentials anyway) would be a cross-tenant disclosure; only a same-origin `Origin` is echoed, and `Vary: Cookie` ships on every response. **(B) The service cache is ARC, not LRU** (`packages/backend/core/cache.ts`), because these endpoints carry two access shapes at once: a chat feed or a submissions tree is SCANNED — a long tail of cursor pages each touched once — while a project's detail, channels and roster are re-read on every navigation. Under LRU the scan evicts the working set, so paging through four hundred files flushes the detail row every one of those pages was rendered beside. Ghost lists hold KEYS only, so remembering a bad eviction costs a string rather than a page of JSON. **`cacheKey` cannot be called without a tenant** — the parameter is required and non-optional, enforced by the type rather than by convention — because two callers asking the identical question under RLS are asking two different questions, and a key that omitted identity would serve the first caller's answer to the second, which RLS cannot catch because the query is never issued. **(C) Async ONLY where a live path exists.** `list`/`item` and messaging `conversations`/`conversation`/`messages` are async; the other eleven reads stay SYNCHRONOUS. A `Promise` that never awaits buys nothing today and would have forced ~20 slot resolvers plus the dashboard layout async for no behaviour change; they keep an OPTIONAL `actor` so their call sites are already correct the day a live path lands. `_layout.tsx` did become async — Fresh 2 supports it (`AsyncAnyComponent` + `renderAsyncAnyComponent`, detected via `fn.constructor.name === "AsyncFunction"`) — and resolves its three slots through one `Promise.all` rather than in series. **(D) TWO PRE-EXISTING SECURITY HOLES FOUND; ONE FIXED, ONE FLAGGED.** FIXED: `comms.dm_threads` / `dm_participants` / `dm_messages` / `channel_files` / `project_channel_participants` had RLS ENABLED with **ZERO policies** — default deny, which as `authenticated` returns `200 []`, never an error and never a hint — so the entire `/messages` inbox was unreadable the moment its gate went on and would have looked exactly like an empty account. SELECT-only policies edited in place into `00002012`, plus `comms.is_dm_participant(uuid)` in `00001300`. That predicate is **not** optional: the natural inline `EXISTS` makes the policy on `dm_participants` subquery its own table, which Postgres rejects at runtime with `42P17 infinite recursion detected in policy` — the first draft of this fix had precisely that bug, and `SECURITY DEFINER` is what breaks the cycle, the same shape `comms.has_channel_access` already uses. Write policies were deliberately omitted: the read API does not need them, and a missing write policy fails closed and visibly where a wrong one does not. **NOT FIXED, needs a human:** `comms.message_reactions`, `message_pins`, `message_favorites`, `auto_responses` and `newsletter_subscriptions` were never added to `00002001`, so RLS is OFF on them entirely while `00002500:68` grants `ALL ON ALL TABLES IN SCHEMA comms TO authenticated` — any signed-in user can read and write every other user's reactions, pins and favourites, and read **the whole newsletter subscriber list**. Closing it means enabling default-deny on tables that currently work and writing INSERT/UPDATE/DELETE policies that answer a product question this pass has no standing to settle (a pin's UNIQUE is `(message_table, message_id)`, so it is channel-wide and un-pinning acts against everyone else; a favourite's is `(user_id, …)`, so it is private). **(E) Twelve contract contradictions** block the remaining eleven reads, none of them effort: Zod `revision_requested` against the DB's `revisions_requested`, so every revision row fails parse; `stage_status` sharing exactly ONE member (`cancelled`) with the `ProjectStatus` it is projected onto, while `stageLocked()` tests for a `draft` the DB can never produce; `InviteStatus` missing two storable values; `FileItem` re-mandating a `message_id` that `comms.channel_files` has no column for, so a channel-level file can satisfy `AssetItem` and never `FileItem`; `categoryWeight` — which drives `W_i` — having no column at all; no presence column anywhere; and, hardest, **the unified-inbox contract has no live representation**, since `dm_threads.id` is a v4 uuid and `project_channels` has no `chatId` column, so the `dm-{handle}` identity that makes a project DM and the global inbox one continuous record cannot be reproduced. All twelve are recorded in `documentation/architecture/READ_API_FINDINGS.md` and restated in the service docblocks, replacing the previous two-branch gates that read as implemented and were not. **(F) The HTTP QUERY evaluation** (`QUERY_OPERATOR_RECOMMENDATIONS.md`) recommends **not** implementing it, and the measurements are the reason rather than caution: the JSON body is 3% LARGER than the query string for `projects/list`, only `messaging/conversations` crosses the ~2000-character interop line, Fresh's `Method` union cannot route the verb, and adopting it today would DELETE the automatic 304 path rather than add caching. **Verified by execution on a production build served by `deno serve`:** all 15 endpoints return HEAD with **0 bytes downloaded** and byte-identical headers including `Content-Length`; `If-None-Match` yields 304 with 0 bytes in both the strong and `W/` forms, turning a **283 KB** `/board` repeat into ~200 bytes; OPTIONS advertises `Allow: GET, HEAD, OPTIONS`; a cross-origin preflight receives no `Access-Control-Allow-Origin`; and with the gates on, a session cookie present and `SUPABASE_URL` pointed at an unroutable host the services logged `projects.projects read failed` and `comms.dm_participants read failed` — **proving the queries are issued rather than falling through**, which the previous code could never demonstrate. A guest with the gates on issued no query at all. 522 unit tests pass, 53 of them new: the ARC policy's scan resistance is pinned against an LRU baseline that FAILS the same workload (so the test cannot pass for the wrong reason), plus bidirectional `p` adaptation, tenant isolation, and the HTTP semantics. **NOT verified, stated rather than claimed:** the SQL was never executed — Docker's Linux engine is down and no `psql` exists in this environment, so the policies and the predicate are authored and structurally reviewed only (the Decision #67(a) footing), and the recursion hazard they avoid was found by inspection rather than by watching Postgres raise it; the live read has been proven to ISSUE its queries but has never seen a real database, so no column mapping is confirmed by a returned row; `OPTIONS` is intercepted by Vite's own CORS middleware in DEV, so anyone testing it against `deno task dev` measures Vite and not this code; an unsupported verb returns Fresh's 404 before any handler runs, so `methodNotAllowed()` is currently unreachable and the RFC-correct 405 + `Allow` needs middleware; and the skeletons were not rendered in a browser. **ADVERSARIAL REVIEW FOUND NINE DEFECTS IN THIS PASS'S OWN WORK; all nine are fixed.** Its automated verify stage never ran (the session hit its usage limit and all seventeen verifier agents died), so the run reported `confirmed: 0 / refuted: 17` — a number meaning nothing was checked, not that nothing was wrong; every candidate was triaged by hand against the schema. TWO were enum-value errors that would have been silently wrong forever: `.eq("profile_type", "user")` against an enum whose members are `('freelancer','business')` — a `22P02` on every request, swallowed by a lookup that degrades quietly, so every viewer would have read as `member` permanently; and stage progress counted against `"completed"`, which `stage_status` does not contain, making `completedStages` a permanent `0` beside a correct total so a finished project renders a PLAUSIBLE "0/5". ONE was a privacy leak I introduced: the `dm_participants` policy's roster arm returned co-participants' whole rows, and RLS is ROW-level, so it disclosed whether someone had muted, archived, deleted or last read the conversation — narrowed to own-row-only with a new `comms.dm_thread_roster()` returning identity and nothing else. THREE were live-read correctness: the feed trusted RLS alone, but the policies are OR-ed and one is `"Public can view active published projects"`, so the 500-row cap would fill with the public marketplace and push the viewer's own work out (RLS answers "may I see this", the feed answers "am I working on this" — now scoped to involvement before the read); the inbox scanned messages under ONE global cap ordered ACROSS threads, so busy conversations consumed the window and quieter ones reported zero and were deleted by the visibility rule (now one bounded tail per thread, and an UNMEASURED thread is exempt, because failing to read is not the same as being empty); and the message cursor encoded the instant as epoch MILLIS against a microsecond `timestamptz`, so `created_at.eq` matched nothing, the `id` tie-break could never fire, and every message sharing the boundary millisecond was skipped (the cursor is now the row id and the server reads the real timestamp back). TWO were in the new infrastructure: ARC's TTL expiry demoted the aged-out key into a GHOST list, which is capacity evidence the cache had not produced — with five entries in 512 slots every refresh evicted a warm neighbour while every invariant held and every test passed; and `stableStringify` serialised `Date`/`Map`/`Set` to `{}` because their data lives in internal slots, so two date ranges would share one key. AND ONE made the rest unreviewable: six literal **NUL (U+0000) bytes** in `cache.ts` — the Decision #67 defect class, again — so git reported `Bin 0 -> 19238 bytes` and the whole ARC implementation, including the eviction bug above, was invisible to a diff; replaced with `\u0000` escapes, identical at runtime, 489 reviewable lines. Two further defects were caught before the review by the same reading: the short-circuit guard branch broke GET/HEAD parity (its test asserted status and an empty body without ever diffing the headers, so it passed vacuously) and `OPTIONS` under-reported the method set on the two routes that also serve `POST`. Each fix ships with a test that fails against the old behaviour. **Also flagged, not fixed:** `projects.projects` has NO policy granting a PARTICIPANT SELECT on a project they were hired into — only owner-or-public — so a freelancer's private engagement is inside the feed's involvement set and outside RLS. **Also:** `MOCK_REGISTRY.liveImplemented` flipped to `true` for both domains with the partiality spelled out inline, because `describeDataSources()` prints that flag and would otherwise deny a live path that now exists. | root `CLAUDE.md` §1/§2/§6/§7/§8 · `documentation/architecture/{READ_API_FINDINGS,QUERY_OPERATOR_RECOMMENDATIONS}.md` · `packages/backend/core/{cache,cache_test}.ts` · `packages/backend/services/read-actor.ts` · `packages/backend/services/{projects,messaging}/live-queries.ts` · `packages/backend/services/projects/{ProjectBackendService,query}.ts` · `packages/backend/services/messaging/MessagingBackendService.ts` · `packages/backend/mocks/registry.ts` · `apps/web/utils/{read-endpoint,read-endpoint_test,api-session}.ts` · `apps/web/routes/api/{projects,messaging}/*` · `apps/web/features/{projects,messaging}/core/{*-ssr,respond}.ts` · `apps/web/routes/(dashboard)/_layout.tsx` · `apps/web/features/projects/components/ProjectSkeletons.tsx` · `apps/web/features/messaging/components/InboxSkeletons.tsx` · `supabase/migrations/{00001300_functions_comms_channels,00002012_policies_comms}.sql` · Decisions #10 / #21 / #22 / #49 / #53 / #57 / #64 / #67 |
| 83 | **The read API goes live — ten remaining endpoints wired, and the `comms` RLS hole closed (2026-08-30). COMPLETES Decision #82.** #82 shipped the HTTP layer and a live path for five of fifteen reads; the other ten answered from fixtures behind twelve named contract contradictions, and five `comms` tables sat with RLS switched off entirely. Both are now closed. **(A) THE SECURITY HOLE.** `comms.message_reactions`, `message_pins`, `message_favorites`, `auto_responses` and `newsletter_subscriptions` were defined in `00000016` and never named in `00002001`, while `00002500` grants `ALL ON ALL TABLES IN SCHEMA comms TO authenticated` with `ALTER DEFAULT PRIVILEGES` extending it to any table added later. RLS off plus a blanket grant is not weak protection, it is none: any signed-in user could read and rewrite every other user's reactions, pins, favourites and auto-reply rules, and read the whole newsletter subscriber list **together with each row's `token`, which IS the unsubscribe capability**. RLS is now on for all five, with policies built on one new predicate, `comms.can_read_message(message_table, message_id)` — which exists because four tables are polymorphic on that pair with **no foreign key**, so each needs the same question answered and four copies would be four chances for the project half and the DM half to drift. The shapes differ deliberately: a reaction is public WITHIN the conversation but written per user; a **pin is channel-wide** (its UNIQUE carries no `user_id`), so DELETE is NOT restricted to the pinner — in a two-person DM the counterparty must be able to clear one, and a stale pin outliving whoever set it is the state that avoids; a favourite is private and deliberately carries **no** message-access arm on SELECT/DELETE, so one that outlives access to its message is still removable; `auto_responses` is split into FOUR policies rather than `FOR ALL`, because `FOR ALL` applies one expression to both `USING` and `WITH CHECK` and without the check arm a caller can UPDATE their own row and reassign `user_id` in the same statement, handing it away — the `files.items` defect of Decision #67. `newsletter_subscriptions` gets **no policy on purpose**: every row is an email paired with an unsubscribe token, so any SELECT policy wide enough to be useful is a subscriber-list dump, and the public form posts to a route that upserts with the service-role key. That is NOT the same as #82's default-deny bug, and the distinction is written into the migration so nobody "fixes" it. **Found while fixing it: `GRANT ALL` includes `TRUNCATE`, and TRUNCATE is not row-level, so RLS does not bound it** — a caller who cannot SELECT one row of `comms.dm_messages` could still discard the table. Revoked for `comms` and from its default privileges; the same pattern on `org`, `public`, `files`, `projects`, `marketplace` and `reviews` is FLAGGED, not changed, because a platform-wide privilege change deserves its own review. Practical exposure today is low — PostgREST speaks only SELECT/INSERT/UPDATE/DELETE — so it is defence in depth rather than a live breach. Verified that **nothing writes to any of the five tables**, in TypeScript or in SQL, so enabling RLS carries zero regression risk. **(B) THE MISSING ARM THAT BLOCKED EVERYTHING.** `projects.projects` had exactly two SELECT paths — `"Users can view own projects"` and `"Public can view active published projects"` — and none for a PARTICIPANT. A freelancer hired onto a private project could not read the project row at all: their own engagement was invisible to them while every stranger's public listing was not, and every dependent read (detail, board, members, files, submissions) inherited it, because each resolves the project first. Closed with one policy on the predicate the schema already uses for this question, `projects.has_project_access(id)` — owner, freelancer participant, business participant, stage assignee, or a member of an assigned team. **(C) TEN LIVE READS.** Each is its own module (`live-{detail,board,members,files,submissions,messages}.ts`, `messaging/live-{workspace,contacts,settings}.ts`) over one shared foundation, `live-support.ts`, which is where every enum contradiction is reconciled ONCE and pinned by `live-support_test.ts` against the literal member lists in the migrations. That centralisation is the load-bearing decision: ten per-endpoint mappings would have been ten chances to spell `revisions_requested` the way Zod does rather than the way the database does, and that mistake does not fail loudly — it throws on the first revision row, in a state no fixture produces. The reconciliations: submission status (DB **plural** `revisions_requested` vs Zod singular, plus a NULLABLE column whose NULL passes a NULL-tolerant CHECK and fails a required Zod field); stage status (`stage_status` and the `ProjectStatus` it is projected onto share **exactly one member**, `cancelled` — and only `open` may map to `draft`, because `stageLocked()` tests for `draft` and anything else mapping there silently UNLOCKS a stage); invite status (four DB values, two Zod members — `accepted`/`revoked` return `null` and are filtered out rather than coerced into `expired`, which would be a lie about a resolved invitation); participant role (free text whose only written value is `'assignee'`, not a `MemberRole` member at all). **Fields with no column come back NEUTRAL, never invented:** `categoryWeight` is 1 because it drives `W_i` and a guess makes the number plausible and wrong (Decision #64(b)); presence is always `offline` because no presence column exists anywhere; a project channel's `unread` is always `false` because `comms.project_channel_participants` is keyed by PROFILE with no `user_id` and no `last_read_at` while the DM side has all four columns; ticket `payments` is empty because `authenticated` holds no USAGE on `finance` (Decision #68(a)); auto-response service/product names are null because `marketplace` is not exposed to PostgREST. **Two structural losses worth naming:** `FileItem` re-mandates `messageId`/`messageText`/`sender` as non-null while `comms.channel_files` has **no `message_id`**, so both file endpoints source from `message_attachments` joined to the message tables instead — a file attached at channel level with no message is out of scope for that projection entirely; and a stage whose `stage_all` room has not been opened yet is OMITTED from the channel tree, because `comms.get_stage_channels` provisions rooms LAZILY on first open and a read path cannot provision one, so rendering it would be a focusable link reaching nothing (§3 gate 11). **(D) THE RIPPLE, contained deliberately.** Making all six projects reads async re-opened the blast radius #82(C) avoided: seven SSR resolvers, four slot resolvers, the dashboard layout and thirteen pages. All were converted rather than routed around, and `_layout.tsx` resolves its three slots through one `Promise.all` rather than in series. The `actor` sits at parameter TWO on the resolvers that carry optional params, because a required parameter cannot follow an optional one. A shared `liveRead()` wrapper now carries the gate test, the actor check, the cache key and the try/catch for all ten methods, with a distinction that matters: `undefined` means the live path did not run or could not answer, so the fixtures take over; `null` means the database was asked and said no, which is a real 404 the caller must NOT paper over with a fabricated fixture. **VERIFIED BY EXECUTION, on a production build served by `deno serve`: all 15 of 15 endpoints reach Postgres** — with the gates on, a cookie present and `SUPABASE_URL` unroutable, each logged its OWN distinct table read (`projects.projects`, `comms.dm_participants`, `comms.project_channels`, `comms.notification_prefs`, …) and degraded to fixtures; a guest with the gates on issued no query at all; and **all 15 remain HTTP-conforming** (HEAD 0 bytes with byte-identical headers, 304 on revalidation, correct `Allow`). 553 unit tests pass, 22 of them new and pinning the enum reconciliations — including one asserting that `stage_status` and `ProjectStatus` overlap in exactly `["cancelled"]`, so any future enum edit fails loudly rather than silently. A structural SQL validator (paren balance, statement termination, every referenced function defined, every referenced column existing, RLS-vs-policy coverage per table) reports clean and shows **every `comms` table RLS-on**, with the only two default-deny entries intentional. **NOT VERIFIED, stated rather than claimed:** no SQL was executed — Docker's Linux engine is down and no `psql` exists here, so every migration in this pass is authored and structurally reviewed only (the Decision #67(a) footing); and the live reads are proven to ISSUE their queries and to degrade when a query fails, but have never seen a real database, so no column mapping is confirmed by a returned row. Every column name and enum literal was checked against the migrations — twice, after #82's review found two that were wrong — but a live `select` is the only thing that proves a mapping. **FLAGGED, needs a human:** (a) the `GRANT ALL`/`TRUNCATE` pattern on the other six schemas; (b) `org.user_emails` SELECT is own-rows-only, so a project roster genuinely cannot show other members' emails and `ProjectMemberRow.email` is null for everyone but the viewer; (c) `business_private` channels are placed in the TEAMS group of the channel tree — the tree has four groups and a client-side private stage room fits none of the others, so the group is read as "a private sub-project room grouped by the party that owns it"; (d) `ProjectDetail.owner` documents the provider side while `projects.projects.owner_user_id` is the seat that CREATED the engagement, which for a service instantiated by a buyer are opposite sides — the divergence belongs to `toSummary` and was deliberately not fixed in two places; (e) the DM SELECT policies call a `SECURITY DEFINER` predicate once per candidate row against tables with **no indexes at all**, so a long thread evaluates it per row and each evaluation scans `dm_participants`. | root `CLAUDE.md` §1/§6/§7/§8 · `documentation/architecture/READ_API_FINDINGS.md` · `packages/backend/services/projects/live-{support,support_test,detail,board,members,files,submissions,messages}.ts` · `packages/backend/services/messaging/live-{queries,workspace,contacts,settings}.ts` · `packages/backend/services/{projects/ProjectBackendService,messaging/MessagingBackendService}.ts` · `packages/backend/mocks/registry.ts` · `apps/web/features/{projects,messaging}/core/*-ssr.ts` · `apps/web/features/{projects,messaging}/core/*-slot*.tsx` · `apps/web/routes/(dashboard)/**` · `supabase/migrations/{00001300_functions_comms_channels,00002001_policies_enable_rls,00002011_policies_projects,00002012_policies_comms,00002500_permissions_schema_grants}.sql` · Decisions #57 / #64 / #67 / #68 / #82 |
| 84 | **Projects domain completion — the dropdown regression, the write layer, the role-split engagement page, and media metadata (2026-08-31).** Four phases over one domain, and the first pass here where the projects WRITE path was verified against a real Postgres rather than authored and reasoned about. **(A) THE DROPDOWN.** `Select` and `MultiSelect` rendered their chevron as a SIBLING of `<button class="…__trigger">` — a nested `<button>` is invalid HTML and the clear control has to be its own button, so the trigger only ever covered the label track. The glyph therefore had no handler at all while the root's `cursor: pointer` promised the whole field was clickable: the §3 gate-11 defect, present since the component's first commit. Fixed by delegating on the trigger CONTAINER (`onSurfaceClick`, guarded with `closest()` so a control that already handled the click is not toggled again by the bubble) rather than `pointer-events: none`, which cannot work here — the chevron sits BESIDE the trigger, not over it, so a click passing through lands on the root and still reaches nothing. A SECOND, independent defect in the same two files: the rotation rule was scoped to `.ui-select--open` / `.ui-multiselect--open`, but the root writes its modifiers under the SHARED block (`fieldModifiers("ui-field", …)` emits `ui-field--open`), so **the chevron had never rotated at all**. `autocomplete.css`, `cascadeselect.css` and `treeselect.css` were already correct; a third dead copy sat in `auth.css`, where it also killed the open-state fill on every auth select. Both class names are plausible, both files parse, and the type-checker sees neither — so the new `fields/core/field_test.ts` cross-checks the two SIDES of the contract (what `fieldModifiers` emits against what each sheet selects on) rather than exercising either alone, and asserts the dead form's ABSENCE, because a sheet carrying both would still ship one selector for the next reader to trust. Verified in-browser by measurement: clicking the chevron's `<path>` opens the panel, the settled transform is exactly `matrix(-1,0,0,-1,0,0)` open and `none` closed, and Enter/Space/ArrowDown each open exactly once (each `preventDefault`s its keydown, so no synthesised click reaches the delegated handler — there is no double-toggle path). **(B) THE WRITE LAYER.** Six endpoints — `PUT`/`PATCH`/`DELETE /api/projects/[id]`, `POST /api/projects/{board/ticket, ticket/move, messages/send, submissions/create}` — plus two reads (`setup`, `overview`), over eight new fat methods, a per-process `write-store` overlay so the stub branch genuinely persists, and cache invalidation on every write (without it the GET after a write serves the stale ARC entry and the change looks lost while the database is perfectly correct). Every acceptance criterion was then **exercised against the local Supabase with a real signed session**: a `PATCH` updated `projects.projects` AND its `search.projects_index` row; a created ticket landed in `projects.tickets`; a move wrote `backlog → todo` with a `ticket_history` row and applied `sort_order` in the backlog lane and only there; a send landed in `comms.project_messages` attributed to the caller; a submission landed in `projects.stage_submissions` as `pending_review`; and `DELETE` soft-archived with a `project_status_history` trail and returned the ORIGINAL instant on a second press. **(C) SEVEN SECURITY DEFECTS, all in the blast radius, all fixed and all verified live.** `projects.ticket_history`, `user_preferences`, `project_required_skills` and `project_invitations` had **RLS OFF** while `00002500` granted `ALL ON ALL TABLES IN SCHEMA projects TO authenticated` — so the ticket audit log was forgeable and erasable by anyone with an account, and `project_invitations.token`, which that table's own comment calls the capability, was world-readable: direct project-access escalation, the same class Decision #83 closed for `comms`. `projects.reorder_stages` was `SECURITY DEFINER` with **no caller check** and the default `PUBLIC EXECUTE`, so any signed-in caller who knew a project id and its stage ids could rewrite somebody else's execution sequence. `"Users can update own projects"` had `USING` and no `WITH CHECK`, so an owner could `SET owner_user_id = <someone else>` and donate the project — its stages, tickets, escrow history and channels — out of their own tenancy in one statement. `comms.project_messages` INSERT did not pin `sender_user_id = auth.uid()`, so a channel member could post AS another member, in the one surface where scope and change orders are agreed. `"Insert own submissions"` proved only attribution, never stage access, so any authenticated caller could file a deliverable into any stage id they had ever seen — and a submission is not inert, it enters the client's review queue. `TRUNCATE` was revoked for the schema (it is not row-level, so RLS does not bound it). Each was reproduced as `authenticated` against the seeded corpus and re-verified refusing afterwards. **(D) `search.sync_project_to_index` WAS BLOCKING EVERY CLIENT WRITE TO `projects.projects`.** Six `sync_*_to_index` triggers are `INVOKER` while `authenticated` holds only `SELECT` on `search` and every index table has RLS on with a SELECT-only policy — so an ordinary `UPDATE` raised `permission denied for table projects_index`, inside a statement the caller never wrote, on a table their own policy permits. Widening the grant does NOT fix it (the RLS layer then refuses); `SECURITY DEFINER` does, and is what every other function in that file already is. Only the PROJECT sync is corrected, because only it gates a live path; the other five are latent and named in `documentation/database/search/Functions.md` for the domain passes that own them. **(E) `set_project_status` COULD NOT ARCHIVE.** `archived` joined `project_status` with a bidirectional CHECK (`(status = 'archived') = (archived_at IS NOT NULL)`) but the lifecycle RPC predates it and raised `Unsupported target status`. Taught the transition, writing BOTH halves in one statement — a two-statement archive fails on the first before the second can run — and added `archived` to the terminal set, so a soft-deleted engagement cannot be re-opened behind its own status history. **(F) THE ENGAGEMENT PAGE IS A ROLE DISPATCHER.** `/projects/[projectId]` renders the owner's Details setup surface or the member dashboard, on a server-derived `viewerIsClient`; the two resolve DIFFERENT reads and only the branch that runs pays for one. `ProjectSetup` is a new projection because `ProjectDetail` deliberately carries none of the configuration (its showcase model hardcodes price, roles and seats empty), so a ladder built on it could only ever have counted a title. The ladder, its percentage and the Preview gate are derived by ONE set of pure helpers the fat service, the SSR resolver and three hydration roots all call — a percentage recomputed at a second site is one that will eventually disagree with the button beside it — and `reconcileSetup` RE-derives all three from the data fields, so a client posting `completeness: 100` is overruled rather than believed. The bar's geometry is written directly and never transitioned: a backgrounded tab freezes the animation clock and a width arriving through a transition renders 0% on a project with real progress. Preview is rendered-and-LOCKED until every required step is done, and the route enforces the same rule with a 303 — a control disabled in the interface and open at its URL is a gate that only holds for people who did not type the address. `/edit` becomes a 308 so old links still land. **(G) MEDIA METADATA.** A hand-written BlurHash encoder, absolute-chroma dominant-colour extraction (never relative saturation, which scores `rgb(0,10,20)` a perfect 1.0 and made shadow detail win every vote — the Decision #74 bug), and image/video/audio/document readers that can never throw and never block an upload. Verified in a real browser on a real canvas-generated PNG and a real MediaRecorder-encoded WebM: a 34-character hash (`4 + 2·5·3`), the three actual quadrant colours as dominants, a JPEG poster captured at 500 ms with its own hash, and the whole envelope round-tripping through `upload-complete` onto the asset row. `AssetItem` gained an optional nullable `metadata` field so the half that cannot be flattened — the hash, the colours, a poster two orders of magnitude longer than `thumbnailUrl` accepts — actually reaches a consumer; `applyMediaFacts` writes it CONDITIONALLY, because absent ("nobody looked") and `null` ("a client tried and could not read it") are different facts and `??` would fold them together. **(H) `deno task check` COVERED NO ROUTE FILE.** Routes are filesystem-discovered and in no module's import graph, so ~200 route files — every one able to call a fat method that does not exist — passed the merge gate unchecked. The task now globs them; it immediately caught eight real errors. **(I) AN ADVERSARIAL REVIEW OF THIS PASS FOUND TEN MORE DEFECTS; ALL TEN ARE FIXED, EACH VERIFIED AGAINST THE RUNNING POSTGRES.** The worst was a money hole I introduced: `unit_price_cents` was written as `ticketTotalCents(input.stages)`, and `costCents` is a CLIENT field, so `finance.fn_hold_ticket_escrow` — whose first term is `COALESCE(t.unit_price_cents, ps.unit_price_cents)` — let the buyer choose their own escrow amount (measured: a stage priced £1,000 escrowed at 1p). The same line was wrong a second, independent way: it stored a ticket TOTAL in a column both the board read and `get_ticket_finance` treat as a PER-STAGE rate, so a three-stage ticket priced itself at three times its own total (measured 1,800,000 against a true 600,000). A single-stage ticket round-trips exactly, which is why it survives casual testing. Both are closed by `resolveTicketStages`, which reads the rates from `project_stages` and returns one only when every stage of the ticket carries the SAME one — the only thing a single column can honestly say about a multi-stage ticket. **The cost, stated: the rate is no longer CAPTURED at agreement**, so re-pricing a stage restates existing tickets (Decision #65 wanted the opposite). A column per ticket cannot hold a rate per stage, and letting the client supply it is not a way to buy that back. That same function also validates the stage SET, closing a second hole: `current_stage_id` and `required_stages` were written verbatim, so a ticket could be pointed at another project's stage — the board read then drops the unresolvable stage and shows a card with no stage, while the escrow function prices against the foreign one (now `422 stage_not_in_project`). **The purchasing gate (PRODUCT_SPEC §Creation & Purchasing Gate) was enforced NOWHERE on the live path**: the stub refused it after `if (live) return live;`, and `fn_enforce_ticket_checkout_desc` only fires when `description IS NULL OR = '{}'`, while the write always sent `{"html": ""}` — so the trigger worked and never saw an empty description. Mirrored in the write layer, and the empty case is now written as a real NULL so the database's own guard is armed rather than bypassed. **A refused save half-committed**: the column patch wrote, then a later section refused, and `commit()` adopts a baseline only on success — so the owner kept editing a draft the database had already moved past. Reachable from the shipped form, since "Add role" creates a role with no budget and the form always sends the whole section. The knowable-without-asking refusals are hoisted into `validateUpdate` and run before the first write; the complete answer is one RPC doing the whole reconciliation in a single transaction, which this is not. **`sessionKind` and stage `milestone` were edited in the form and silently dropped** — neither had a column. Both are now folded in (`projects.session_kind` with a CHECK, `project_stages.milestone`), and the format write normalises the kind so a switch away from `session` cannot leave a cohort setting behind. **`archivedAt` reached no projection**, so a stub archive returned success, navigated the owner away, and left the project listed and editable; it is now a first-class field on `ProjectSetup` — its own, because `ProjectStatus` has no `archived` member and the database's `project_status` does. **`item()`, `list()` and `overview()` took no write-store overlay** while five sibling reads did, so a rename made on the setup surface was live there and stale on the card beside it. **The overview hero counted tickets it did not list** (raw rows, unfiltered and read past the display limit, against a projection that drops closed ones) — it now counts the list actually drawn. **Refusals named the wrong noun**: every write reported `null` as "No project found for <id>", where the id was a channel, a ticket or a stage and the project was usually right there and readable. **`create_stage` gave the stage and its channel different names.** And **three governed SQL comments asserted a hole that never existed** — Postgres substitutes an UPDATE policy's `USING` for a missing `WITH CHECK`, so the arms added in (C) are explicit rather than corrective; the guards are real, the history was not, and a reader who believed it would treat the remaining `USING`-only policies as holes and re-fix nothing. Also fixed from the same review: a sent chat message never appeared in the feed (the composer and the feed are separate hydration roots, now bridged by `MESSAGE_SENT_EVENT` carrying the SERVER's row, deduped on its id), the message payload's `clientId` was required, unread and documented in three places as echoed back — deleted rather than restated, since the composer draws nothing optimistically and has nothing to reconcile; `SubmissionExplorer` passed a CHANNEL id where a STAGE id was wanted, so every create in channel scope was refused (a `stageId` anchor now travels on the page — a channel id and a stage id are different identifiers and only the server holds the mapping); "Submit for review" posted a second create and filed the delivery twice (a `submissionId` now travels and the write transitions the existing draft, under a new policy bounded to the caller's own row while it is still a draft and to `pending_review` as the only reachable post-image — exercised in all four directions); and `ProjectPageStyleAnchor` was mounted on the member dashboard's MISS branch only, so "Project not found" shipped styled while 176 `pjd-*` elements shipped with no rules at all. **FLAGGED — needs a human, do NOT silently resolve:** (a) the brief names FOUR formats (`pipeline`, `one_off`, `session`, `group_session`) but `project_format` is a three-member enum and `ProjectCreateFormat` a DIFFERENT three-member one; `group_session` exists nowhere in the projects domain (it is a `ServiceType` value) and is resolved here as `format: "session"` + `sessionKind: "group"`, and a Direct Deliverable as `format: "one_off"` + `structure: "single_task"`, without widening either enum — but the three-way vocabulary split itself is unresolved. (b) The other five `sync_*_to_index` triggers remain `INVOKER` write blockers. (c) `00001100` contains a bare `CREATE FUNCTION projects.get_project_details`, so that migration file is not idempotent and cannot be re-applied over an existing database. (d) Eleven older `FOR ALL` policies in `projects` carry `USING` with no `WITH CHECK` — the same shape just fixed on `projects.projects`; each needs its own read, since the post-image predicate is not always the pre-image one. (e) `anon` has no `USAGE` on schema `projects` while nine `FOR SELECT TO public` policies are written for exactly that visitor. (f) `projects.project_attachments` has RLS on and zero policies, with no written justification. (g) **A ticket's `owner_user_id` is display-only and unvalidated beyond membership** — `resolveTicketOwner` now resolves the handle and checks the person is on the project, which stops a stranger being named, but any real participant can still be pinned as the accountable seat by anyone who can write the ticket. (h) **The stage rate is no longer captured at agreement** — see (I); expressing Decision #65's intent needs a per-stage price on the ticket, i.e. a table, not a column. (i) Inherited and untouched: `authenticated` has no `USAGE` on `finance` (#68/#83), and the `--on-primary` on `--primary` 3.57:1 dark pairing (#64/#65) — routed around again, never used on any new surface. | root `CLAUDE.md` §1/§2/§3/§5/§6/§7 · `ROUTING.md` · `documentation/database/{projects,comms,search}/*` · `packages/ui/fields/{islands/{Select,MultiSelect}.tsx,styles/{select,multiselect}.css,core/field_test.ts}` · `packages/types/{projects/{setup,overview}.ts,files/metadata.ts}` · `packages/backend/services/projects/{live-writes,write-store,setup-fixtures,overview-fixtures,live-overview}.ts` · `packages/backend/services/files/media-facts.ts` · `apps/web/features/files/core/media/**` · `apps/web/features/projects/{components/{setup,dashboard}/**,islands/ProjectSetup*.island.tsx,core/{setup,overview}-ssr.ts,core/{setup-state,upload}.ts,core/project-{header,footer}-slot.tsx}` · `apps/web/routes/api/projects/**` · `apps/web/routes/(dashboard)/projects/[projectId]/{index,preview,edit}.tsx` · `supabase/migrations/{00000015,00001100,00001120,00001130,00001400,00002001,00002011,00002012,00002500,00004003,00004006}*` · `deno.json` · Decisions #21 / #32 / #33 / #35 / #53 / #57 / #62 / #64 / #67 / #68 / #74 / #80 / #82 / #83 |
| 85 | **Project creation split into Quick-Init and workspace setup — and visibility becomes two columns (2026-09-03).** The standalone `/projects/create` page is retired and creation becomes a two-stage flow. **STAGE 1** is a Quick-Init modal on `/projects` (`QuickInitModal.tsx`, mounted through `ProjectsLane.island`) collecting only the four facts a coherent draft cannot exist without — Title, Project Type, Currency, and one baseline price — then `POST /api/projects/create` -> `ProjectBackendService.create` -> `insertProject`, which mints `projects.projects` with `status='draft'`, auto-provisions ONE root stage, and returns `{id, slug}`. **STAGE 2** is the owner setup surface at `/projects/[projectId]`: one continuously-scrolling column, NOT a stepper, beside a sticky scroll-spy side nav. A stepper implies an order the work does not have — a client who knows the budget and not the brief has no reason to be stopped at step 2 — and it hides the scale of what is being asked, which is the one thing somebody deciding whether to finish now needs to see. **`ProjectCreateFormat` is narrowed to `one_off` / `pipeline`**: a session is a service a freelancer SELLS, so offering it here would mint an engagement with no seller and no schedule. **(A) UUID IDENTITY, AND THE TRAP UNDER IT.** `/projects/[projectId]` now carries the record id: a uuid cannot collide, cannot be squatted, and survives the first rename, which a title-derived slug does not. Every resolver accepts either form, and every one must test the shape first, because `ck_projects_slug_shape` is `CHECK (slug ~ '^[a-z0-9-]{1,96}$')` and **a lowercase uuid SATISFIES it** — so `.eq("slug", <uuid>)` is a legal query that matches nothing, forever, with no error to say why, while `.eq("id", "<slug>")` raises `22P02` and throws a page. One `UUID_RE`/`matchesProjectKey` in `project-identity.ts` now backs all of them. **A regression with a CLEAN DIFF:** `live-files.ts` and `live-submissions.ts` resolved slug-first with a uuid fallback, which was right when the route carried a slug and now spends a failed round trip on every read of those surfaces. The code did not change when the route did — the only diff on those files was de-duplicating a local `UUID_RE` — which is exactly why no diff-based review could see it. Both now branch on the shape. **(B) VISIBILITY IS TWO COLUMNS, and the first attempt at it was wrong in an instructive way.** The brief asks for a dropdown "defaulted to `public`, silently stored as `unlisted` draft until all Tier 1 and Tier 2 inputs pass validation" — a description of TWO facts, where the schema held one. `projects.projects.visibility` was written straight from `rules.visibility` (`live-writes.ts`) and read straight back, so an initial fix that merely PROJECTED `public` for a fresh draft — on the reasoning that the field meant "on publish" — put the form's displayed value one save away from overwriting the owner's real choice. Resolved by giving the second fact a column: **`publish_visibility`** (INTENT, `NOT NULL DEFAULT 'public'`, folded into `CREATE TABLE` per §1) beside `visibility` (STATE, server-derived, now absent from every patch `projectColumnPatch` builds), promoted by the pure **`liveVisibilityFor(status, intent)`** in the SSOT — a draft is `unlisted` unconditionally, consulting neither the intent nor `previewReady`, and anything else takes the intent verbatim including on the way BACK to draft, which re-hides. **The promotion runs AFTER `set_project_status` succeeds and this ordering is the whole safety property**: folding it into the earlier column patch publishes the row and THEN discovers the transition was refused. It also runs on every save, so an already-live project's visibility change takes effect immediately rather than requiring a status change to un-publish. `ProjectSetup.liveVisibility` carries the row state to the form, which reads it rather than re-deriving "draft implies unlisted" locally — a second derivation could disagree with the server's on a legacy row, and that disagreement tells an owner their project is hidden while it is live. **`CREATED_PUBLISH_VISIBILITY` is deliberately NOT `DEFAULT_PROJECT_RULES.visibility` (`invite_only`)**: the latter is the fallback where nobody chose anything, the former expresses the evident intent of somebody who just created a project in order to hire against it. **Severity, stated honestly:** every public-read predicate in `00002011` is `status = 'active' AND visibility = 'public'`, so RLS excluded a draft regardless — this was a CONSENT defect (a stored value contradicting what the form showed, taking effect at publish), never the "draft on Explore" leak it first looked like. **(C) TWO GATE-11 DEFECTS, found by tracing every control to a column.** `stageTermsPatch` handled tasks, dependency, duration, file kinds, NDA and the seat pair but not **`skills`** or **`milestone`** — both with live controls, both with existing columns, both read back. The worst shape of this defect: the STUB branch persists them through `reconcileSetup`, so they work in dev and vanish in production, which is the same shape as the per-stage roles and attachments the preceding pass wired. A third fell out of the regression test written for the first two: `clamp` does not trim, so a whitespace-only skill survived `.filter(s => s.length > 0)` on BOTH sides — fixed at the SSOT (`z.string().trim().min(1)`, so the route refuses it) rather than by changing `clamp`, which ~50 sites use where interior whitespace is meaningful. **(D) ONE MAJOR/MINOR CONVERTER.** The feature had grown TWO, already diverged on clamping (the modal's did not clamp negatives against a `CHECK (>= 0)` column); consolidated into `toMinorUnits`/`toMajorUnits` beside `currencyExponent` in the finance SSOT, where the next surface will find them. Both are exponent-aware, so a JP¥5,000 figure converts at factor 1 rather than becoming 500,000 minor units — a hundredfold error no type-checker can see, because both sides are `number` and both are plausible. **(E) An RLS hole closed in passing:** `projects.project_attachments` has had RLS enabled since `00002001` and **never carried a single policy**. Default deny on a SELECT is silent — as `authenticated` it returns `200 []` — so the reference brief a client hangs off their project has been unreadable by everybody INCLUDING the owner, rendering as an empty list rather than a failure, which is the one shape nobody investigates. Only the link row is governed; the bytes remain `files.fn_can_read`'s question. **Merge gates:** §5 needs nothing — the owner/member dispatch on this route is server-side and PRE-EXISTING (Decision #84 built it; this change only renamed its parameter), so no new simulatable axis was added. Note the inherited inconsistency though: #84 made the BOARD seam-aware via `board-access.ts` while leaving the engagement page that dispatches to it seam-blind, so flipping the persona there still changes nothing. No lifecycle state or transition was added, so `PRODUCT_MANAGEMENT.md` is correctly untouched — visibility is an attribute, not a status. **Verified:** `deno task check` clean but for the 7 pre-existing cold-cache errors, `deno lint` clean over 1,469 files, `deno task test:unit` **2,096 passed / 0 failed** (39 new, pinning the promotion rule in both directions, a forged `liveVisibility` being overruled the way `completeness` already is, every stage term reaching a column, and the exponent/null/NaN cases of the money converter). **NOT verified, stated rather than claimed:** no SQL was executed — no Docker, no psql — so `publish_visibility` and the attachments policies are authored and structurally reviewed only (the #67(a) footing); and six adversarial review agents died on API 529s across four launches at zero token cost, so the review was run in the main loop instead, which is where the identity-ordering and gate-11 findings came from. **Also found:** Decision #63's recorded claim that "Preact drops `aria-expanded={false}`" **does not reproduce at Preact 10.29** — tested, not reasoned about: it renders `aria-expanded="false"`. That note should be corrected or version-scoped before somebody writes an unnecessary falsy-to-`undefined` workaround around a correct pattern. **FLAGGED — needs a human, do NOT silently resolve:** (a) `projects.stage_staffing_roles.budget_amount_cents` is `bigint NOT NULL` while the SSOT's `budgetCents` is nullable meaning UNPRICED, and `setupSteps()` reads that null for the pricing rung — the ladder measures a distinction the column cannot store; the write refuses a null rather than coercing to 0, and relaxing a money column needs sign-off. (b) `ProjectRoleSetupSchema` has NO backing table while `setupSteps()` makes roles the REQUIRED staffing step for a Direct Deliverable — a Preview gate depending on data with no home. (c) The cohorts SELECT policy (`00002011`) is `owner_user_id = auth.uid() OR p.visibility = 'public'` with **no `status` conjunct**, unlike every sibling predicate — pre-existing, in the sessions domain, and unreachable from this flow since Quick-Init excludes sessions, but a draft with a public visibility would expose its cohorts. (d) `/projects/create` is kept as a **308 shim** to `/projects?create=1` rather than deleted as the brief says, so existing links and bookmarks still land; a 308 preserves the method, and nothing POSTs there. (e) `applyProjectUpdate` remains several independent PostgREST commits with no transaction envelope, with every refusal knowable without asking the database hoisted into `validateUpdate`. (f) `projects.create_project` is still unusable and now has no caller. (g) `scopeType` is hardcoded `"personal"` while `scopeId` carries the active context id — pre-existing incoherence, inherited. | root `CLAUDE.md` §1/§2/§3/§5/§6/§7 · `ROUTING.md` · `PRODUCT_SPEC.md` §Sitemap · `documentation/database/projects/Tables.md` · `packages/types/projects/{create,setup,overview}.ts` · `packages/types/finance/wallet.ts` · `packages/backend/services/projects/{ProjectBackendService,live-writes,live-files,live-submissions,live-queries,live-detail,project-identity,write-store,query,detail-fixtures,setup-fixtures}.ts` · `apps/web/features/projects/{components/QuickInitModal,components/setup/*,islands/{ProjectSetupForm,SetupSectionNav,ProjectsLane}.island,core/{setup-sections,setup-validation,setup-ssr,setup-state}}` · `apps/web/routes/api/projects/create.ts` · `apps/web/routes/(dashboard)/projects/{create,[projectId]/index}.tsx` · `supabase/migrations/{00000015_tables_projects,00002011_policies_projects}.sql` · Decisions #3 / #21 / #53 / #67 / #82 / #83 / #84 |

| 85 | **Project creation wired to Postgres — `POST /api/projects/create` (2026-09-01).** The endpoint Zod-validated its payload and then persisted NOTHING: `ProjectBackendService.create` slugified the title in memory and returned 201 on both gate branches, while the modal navigated to that guessed slug and the page answered "Project not found". **(A) THE WRITE IS ONE RPC, NOT FOUR TABLE WRITES.** `projects.create_project` is rewritten in place to insert the project, its stages, their staffing roles, the participant row and a readable unique slug in ONE transaction. Three reasons, measured rather than assumed: a create touches four tables and PostgREST gives one statement per round trip with no transaction around them, so a refusal on the third leaves an engagement the client has already navigated to holding half of what they typed; `projects.update_entity_project_counts` is an AFTER INSERT trigger that is `SECURITY INVOKER` and writes `org.users_public`, which belongs in the definer's context; and the slug needs a retry loop on the CONSTRAINT, because two callers naming a project the same thing in the same instant both see the address free and only the unique index resolves it. It now `RETURNS jsonb {id, slug}` (DROP + CREATE — Postgres will not replace a return type; the old `uuid` signature had no application caller), because every `/projects` route addresses an engagement by SLUG and returning only the id would force a second read to find out where to navigate. **(B) WHAT DEFINER OBLIGES.** Bypassing RLS means every ownership claim is checked in the function or nowhere: `owner_user_id` is always `auth.uid()`, `status` is hardcoded `draft` and `visibility` hardcoded `unlisted` — both were previously payload-readable, and since the function is `EXECUTE`-granted to `authenticated` a caller could publish a project in the act of naming it. Each of the three workspace columns is verified against ACTIVE membership and they are mutually exclusive; personal scope is the absence of all three. **All four refusals and both forgeries were exercised live as `authenticated`.** **(C) THE OWNING WORKSPACE IS DERIVED FROM THE ACTOR, NOT THE PAYLOAD.** The modal hardcodes `scopeType: "personal"` while passing the viewer's real active-context id as `scopeId`, so the two fields CONTRADICT each other on every request from a non-personal context — trusting the type files every project personally, trusting the id writes a scope the payload denies, and neither errors. `ReadActor` already carries the verified `contextType`/`contextId`, which is the same source the READ path's `scopeOf` resolves from, so a create files a project exactly where the feed groups it. **(D) THREE VOCABULARIES, ONE MAPPING.** `ProjectCreateFormat` offers `direct_deliverable`, which `project_format` has no member for — sending it raises `22P02` inside the INSERT, uncatchable by the slug handler. `createFormatToColumns` in the Zod SSOT is now the single implementation of the `one_off` + `single_task` reconciliation `setup.ts` had only documented. It lives in `setup.ts` rather than beside the enum in `create.ts` because `create.ts` is the leaf and `setup.ts` already depends on it; the other direction makes the pair mutually dependent, which is a TDZ crash in a module whose corpus builds at import time. **(E) THE STUB PERSISTS TOO.** `PROJECTS_BACKEND_LIVE` ships OFF, so the default mode reproduced the exact bug one layer up. The write store gains a `created` bucket and the fat service consults it from `setup`, `detail`, `item` and the feed. `detail` matters most: the role dispatcher branches on `detail.viewerIsClient`, a null detail defaults it to FALSE, and the creator was therefore sent to the MEMBER dashboard — whose miss body reads "Project not found" over a project that had just been created successfully. Nothing is fabricated in the synthesised projections: no members, no teams, no banner, zero counts, and an owner named "You" rather than invented. **(F) TWO COLUMNS THE PAYLOAD HAD NO DESTINATION FOR.** `stage_staffing_roles.budget_amount_cents` became nullable (the modal collects a role's name and skills but no budget, and the write was forced to invent a `0` — which the sibling `projects.budget_amount_cents` comment already calls a lie), and `skills text[]` was added (it mirrors `project_stages.skills` rather than joining `org.skills`; without it `CreateProjectRoleSchema.skills` was silently discarded). The setup form's save still refuses a budget-less role, so the AMBER gate is enforced where the owner can act on it. **(G) EITHER ADDRESS RESOLVES.** Five resolvers accepted a slug only while two accepted both, so the same identifier resolved on `/files` and 404'd on the sidebar beside it; six modules each carried a private copy of the same uuid regex. One `resolveProjectRef` in `live-support.ts` now serves `detail` and the summary gate — slug first (what every link carries, so the common case is one query), uuid second and only when the segment could be one. **DEFECTS FOUND BY MEASUREMENT, NOT INSPECTION:** the role `skills` round-tripped as empty because the READ projection still carried a comment saying the column did not exist — it had, until this change, been true; `visibility` was caller-settable; `setup()` resolved a stub-created project while `detail()` did not, which a test written for the write alone would never have caught; **the slug retry caught the WRONG constraint** — `projects.projects` has two unique indexes, so a caller supplying an `id` that was already taken tripped the PRIMARY KEY, was retried five times with fresh slugs against the same doomed id, and was finally told "Could not find a free address for this project", which is a fabricated explanation of a real conflict (`GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME` now re-raises anything that is not `projects_slug_key`); and eight numeric/timestamp casts in the stage insert had no `NULLIF`, so an empty string raised `22P02` on a function that is `EXECUTE`-granted to `authenticated` and therefore directly reachable. Two more surfaced in the STUB projections after the write was working: `createdDetail` listed a stage channel for every stage, and on that path nothing provisions a room — so the sidebar rendered a clickable channel whose every read (messages, board, files, members) answered 404, a control reaching nothing (§3 gate 11); it now advertises no channels at all, which differs visibly from the live tree rather than mimicking its appearance without its substance. And `uniqueStubSlug` checked only the created store, not the fixture corpus — while `createdSetup` is consulted BEFORE the fixtures, so a draft titled "Monarch Design System" did not collide with that fixture, it SHADOWED it, replacing a fully populated engagement with a blank draft at its own address. **AN ADVERSARIAL REVIEW WORKFLOW WAS RUN AND PRODUCED NOTHING** — all four finder agents errored (three stalled, one API failure), so its `0 confirmed / 0 refuted` result means nothing was checked rather than nothing was wrong, and it is reported that way. Its probe files were recovered from the working tree before deletion and DID contain two real findings (the channel and shadow defects above), which is the reason to check `git status` after a 0/N workflow rather than trust the count. **VERIFIED:** all 87 migrations apply clean; every RPC branch exercised as `authenticated` against a real Postgres (minimal, collision-suffixed, unsluggable title, full pipeline with budget and priced stages, direct-deliverable with roles, and all four refusals); 401/422/201 over HTTP; the created project resolving by BOTH slug and uuid with no "Project not found"; and the whole modal → submit → navigate → render round trip driven in a browser, landing on the owner setup surface with a real derived progress bar. 12 new tests; 736 pass. **FLAGGED — needs a human, do NOT silently resolve:** (a) **a team- or organisation-scoped project cannot be read back by a co-member.** `has_project_access` has no branch keyed off `owner_team_id`/`owner_organisation_id`, and only business scope writes a participant row — so an active team member may CREATE a project under their team and then 404 on it. The creator is unaffected (the owner branch covers them). Widening that predicate is an access decision. (b) **`source_blueprint_id` is not settable through this RPC**, so a blueprint instantiation routed through it would never flip the listing CTA to "Open project" nor be reachable by the stale-draft sweep; `instantiate` keeps its own path. (c) `org.organisations` and `org.organisation_members` are EMPTY in the seed corpus, so the organisation branch is proven only by its refusal, never by a successful create. (d) `projects.project_attachments` has RLS on with zero policies and an FK to `files.items`, so `global_attachments` is accepted by the RPC and unreadable afterwards; the app does not send it. (e) Inherited and untouched: `authenticated` has no `USAGE` on `finance` (#68/#83), and the `--on-primary` on `--primary` 3.57:1 dark pairing (#64/#65). (f) `packages/ui/fields/components/CalendarMonthTrack.tsx` fails `deno task check` with two `Timeout`-vs-`number` errors; it is unmodified from HEAD and the failure reproduces with this change reverted, so it is not from this pass. | root `CLAUDE.md` §1/§2/§6/§7 · `documentation/database/projects/{Tables,Functions}.md` · `API_BACKLOG.md` #27 · `packages/types/projects/{create,setup}.ts` · `packages/backend/services/projects/{live-writes,write-store,live-support,live-detail,live-queries,ProjectBackendService,create_test}.ts` · `apps/web/routes/api/projects/create.ts` · `apps/web/features/projects/{core/ProjectSidebarService,components/ProjectCreateModal,islands/ProjectsLane.island}` · `supabase/migrations/{00000015,00001100}*` · Decisions #21 / #53 / #80 / #82 / #83 / #84 |
| 86 | **Project Creation rebuilt as a six-step wizard — the offer narrows, the enum does not (2026-09-02).** `/projects/create` stops being a 307 shim back to the in-lane modal and becomes the six-step wizard the flow doc has specified since it was written: **Details · Legal & Screening · Stages · Timeline · Budget & Staffing · Review & Publish**. An 8-dimension audit between the creation brief and the shipped code found 98 conflicts; twelve reconciliation decisions settle them, and the ones worth remembering are below. **(A) THE TYPE IS A TWO-OPTION OFFER, NOT A NARROWED ENUM.** The wizard offers `pipeline | one_off`; `ProjectCreateFormat` keeps all three members and `direct_deliverable` is DEMOTED from a Type to the `hasStages: false` variant of a one-off — which is exactly what the brief's own single-task fallback describes. Removing the member would have orphaned `structure_variation = 'single_task'`, killed the ladder's entire roles branch (`staffedByRoles`), and broken `create_test.ts` and `live-writes.ts`. `createFormatToColumns` gains a defaulted second parameter (`format, hasStages = true`), so every existing one-arg call site compiles unchanged while the four shapes now map explicitly: pipeline+stages → `standard`, pipeline−stages → `single_stage`, one-off+stages → `one_off`, one-off−stages → `single_task`. **`hasStages` is DERIVED and is never a column** — `hasStages === (structure_variation !== 'single_task')` — because a real boolean is a second answer able to disagree with the stage list itself, and `set_project_status` already gates on the stage COUNT. The two directions are deliberately NOT inverses and a test pins the asymmetry: turning stages off on a PIPELINE yields `single_stage`, which still has a stage, so the read direction correctly answers `true` for a toggle the author switched off. A test asserting a round trip would have forced the wrong code. **`session` stays in `project_format`** (root §1 forbids dropping a member, and `cohorts` / `session_events` / `session_attendance` / `session_kind` all depend on it) — the brief's "no session projects" is satisfied at the OFFER, never at the enum. **(B) THE TIER TAXONOMY IS FORM LOGIC AND NEVER FIVE COLOURS.** T1 Blocker · T2 Required-to-post · T3 Recommended · T4 Nice-to-have · T5 Conditional drive exactly three things — step progression, the publish gate (`blocksPosting` = T1 ∪ T2) and hint copy. The theme has token backing for TWO gate ramps (`--fld-required-*`, `--fld-gate-*`); inventing three more breaches §B.8.3/§A.5 and fails the colour-blindness gate, so a tier is never rendered as a colour key. Two controls resolve by SHAPE rather than preference (`TierRule` is a `{pipeline, one_off}` pair for exactly these two): a one-off's single fee IS the engagement, so `stageUnitPrice` is T1 there and T2 on a pipeline; a one-off's schedule is the deliverable's due date, so `stageDuration` is T3 there and T5 on a pipeline. `direct_deliverable` resolves down the `one_off` arm because it IS one. **(C) SCHEMA FOLDED IN PLACE — zero `ALTER TABLE ADD COLUMN`, zero `ALTER TYPE ADD VALUE` in the diff** (root §1, verified by grepping the diff itself): a new `projects.nda_mode` enum into `00000003`; `nda_mode`/`nda_document_id` + four CHECKs onto `projects.projects`; `seat_limit` (NULL = Unlimited, `DEFAULT 3`, `CHECK > 0`), `parallel`, `nda_override`, `allowed_file_categories files.file_category[]`, `allowed_file_extensions` onto `project_stages`. **`requiresFiles` flipped to TRUE in BOTH places** — the column default AND `create_project`'s COALESCE — because the RPC always supplies an explicit value, so editing the column alone changes nothing on the create path; that is the single most common inert-edit trap in this schema, and it was proven by calling the RPC with the key omitted and reading the row back rather than trusting the DDL. The implicit-stage fallback MOVED OUT of the roles branch into its own unconditional step, so every stage-less shape gets a `Delivery` stage carrying the project's own description (both halves), IP mode and — for `fixed_price` only — its budget as `unit_price_cents`; the concrete consequence is that `set_project_status(…,'active')` now SUCCEEDS on a stageless payload, which it could not before. New `projects.fn_payload_text_array` replaces the bare `ARRAY(SELECT jsonb_array_elements_text(x))` idiom at six sites — that idiom is correct only for an ABSENT key and raises `22023` on a key holding JSON `null`, a live latent crash on `session_preferred_days` and a new one on every array field this pass added — and every enum/boolean/integer cast gained `NULLIF`, wider than the contract asked, because they carry the same `22P02` exposure as the numeric ones on a function `EXECUTE`-granted to `authenticated`. `create_stage` took a sixth `p_payload jsonb` (DROP + CREATE — Postgres will not replace across a changed signature) so the two write paths cannot drift, plus a guard refusing a `start_dependency_stage_id` from another project, because the FK names the table and not the project. **(D) TWO SECURITY HOLES, both RLS-on-zero-policies, both measured rather than asserted.** `org.skills` was default-deny, so the canonical skills vocabulary returned `200 []` with no error and every skills picker in the product silently rendered "no skills found" while `project_required_skills` pointed at a list its own readers could not resolve. `projects.project_attachments` was the same shape with the opposite consequence: `create_project` (DEFINER) faithfully stored every attachment and NOBODY — owner, participant, uploader — could read one back, so the wizard's attachment step was a control that succeeded and reached nothing (§3 gate 11). The before state was measured by dropping both policies inside a transaction (0 skills, 0 attachments) and the after by restoring them (2 and 1). Both stay SELECT-only: a client INSERT on `skills` lets one typo become an option everyone picks from, and an INSERT on attachments is a route to hang an arbitrary `files.items` id off someone else's project. **(E) VISIBILITY IS DECIDED SERVER-SIDE.** The wizard's control defaults to `public` per the brief; the STORED value is `effectiveVisibility(requested, steps)`, which honours the request only once every required ladder step is done. A freshly created project has satisfied nothing, so create still stores `unlisted` and Decision #85(B)'s deliberate hardcode is preserved rather than reversed. The function lives BESIDE the ladder and is called by both the wizard's disclosure and the fat service that writes the row, so the sentence an author reads and the value the database receives are one decision rather than two implementations that agree today. `unlisted` is returned rather than the choice being REFUSED, because a refusal would block a draft and the whole point of the ladder is that a project is saveable long before it is offerable. **(F) FIELDS PAINT ON TOUCH, NOT AT REST.** `resolveFieldVerdict` (pure) + `useFieldValidation` (signals) in `@projective/ui/fields`: an untouched field resolves to `default` however wrong its value, submit force-reveals, and focus clears the CONTROL's status but NOT the message — withdrawing the explanation at the moment the reader acts on it is worse than the outline it removes, which is why `status` and `hintStatus` are two channels. The CSS half gates border/surface/accent on `:not(--focused):not(:focus-within)` while leaving the §A.5 mark channel UNGATED, and it gates CUSTOM PROPERTIES rather than adding a competing `box-shadow`, because gating composes by construction where a later declaration can only overwrite. `auth.css` was found to have replaced the canonical two-tone focus ring and then written the SAME `box-shadow` property again in its invalid rule, so **a focused invalid auth field showed no focus indicator at all**. **(G) NO NEW DEV CONTEXT AXIS (§5 gate), and that is a judgement, not an omission.** Every branch the wizard makes is either a FORM FIELD the author sets directly — format, `hasStages`, currency, NDA mode, seats, the ladder's own completeness — which is reachable by using the form and is not ambient context a seam could simulate; or it is the client/provider seat, which Decision #84's `board-access.ts` already resolves from the existing `accountType` · `isOwner` · `role` axes through the submissions `resolveViewer`. A fifth near-duplicate axis would create ambiguity about which one wins when the author has just clicked the control the axis claims to override. Nothing in this change reads a `data-dev-*` attribute that did not already exist, so there is nothing to mirror. **FLAGGED — needs a human, do NOT silently resolve:** (a) **the +10% deadline-bonus rate exists in no source-of-truth document.** It comes from the creation brief alone and lives as exactly one greppable named constant, `DEADLINE_BONUS_RATE` in `packages/types/projects/create.ts`, whose doc comment records that it is brief-sourced and unconfirmed; it is never written to the database and never enters a money path (that path is the existing `finance.escrows.deadline_bonus_*` columns). (b) **`PRODUCT_SPEC.md` assigns the Deadline Bonus to ONE-OFF projects while the brief makes it pipeline-only** — the brief was implemented, and `ck_projects_deadline_bonus_format` now enforces pipeline-only as an implication, so reversing it is a constraint change and not a UI change. (c) **`direct_deliverable` is demoted from a Type the author picks to the `hasStages: false` variant of a one-off**, which is a product decision about what the marketplace offers, not a refactor. (d) **Visibility defaults to `public` in the control and falls back to `unlisted` on the server**, so the wizard shows an author a choice the row will not honour until the ladder is satisfied; the disclosure says so, but a control whose stated value differs from the stored one deserves a human's confirmation. (e) **A stage's fixed price REUSES `unit_price_cents`** rather than taking its own column — a one-off stage is a one-ticket stage, and a second column would give "what does this stage cost" two answers while `finance.fn_hold_ticket_escrow` reads only one of them (the money-hole class of #84) — but the reuse is flagged as a reuse; the folded `CHECK (>= 0)` closes a real hole, since a negative stage price was storable and flowed straight into an escrow hold, where it inverts the direction the money moves. (f) **`project_stages.nda_override` changes NO behaviour on its own** — the no-download, watermark and owner-only rules reach three separate readers that consult no stage flag today, so the column records intent and enforcement is deferred, said out loud rather than discovered later. (g) **Clear-on-focus diverges from `DESIGN_SYSTEM.md` §A.7.3**, which says an error "composes with focus"; the divergence is implemented, scoped to the validation states, and recorded as a new §A.7.5 in the same change, with the matrix's Ring column changed from "composes with" to "**cleared** by" focus for all five validation states. **Also flagged, from this pass's reconciliation of `documentation/flows/Projects.md`:** the flow doc has asserted a required `stage_type` archetype enum (`file_based | session_based | maintenance_based | management_based`), a `management_contract_mode` and a stage-level `maintenance_cycle_interval` since it was written, and **none of the three exists in any migration** — every archetype's configuration columns coexist unconditionally on one `project_stages` row, so a stage's archetype is currently implicit in which columns the owner filled. The doc now says so at §6.0 instead of asserting columns that are not there; whether to build the discriminator is a product decision. The same reconciliation retired the doc's `Industry Category (Required)` row (the column is nullable and nothing collects it), its project `Banner` row (which names no column at all), and renumbered its duplicated `## 3`. **VERIFIED, and by whom:** the migrations were applied to Postgres 17.6 in a throwaway database (all 87 clean) and every branch exercised as a real signed-in caller — the implicit stage and its channel, a two-stage pipeline round-tripping every new field, `seat_limit` absent/`null`/`"5"`, `""` prices and durations reaching NULL rather than `22P02`, `null` arrays reaching `{}` rather than `22023`, all eight new constraints refusing on the right constraint name, an anonymous caller refused, `create_stage` in both call forms, and both RLS policies as `anon` and as a stranger. The Zod ladder keeps all 22 original `setup_test.ts` assertions (two updated deliberately, none deleted) and the field-validation policy ships with 24 new assertions, 17 of which cross-check the STYLESHEET against what `fieldModifiers` emits and were confirmed to FAIL against the ungated form before being accepted. **NOT VERIFIED, stated rather than claimed:** no browser run of the wizard itself, and no end-to-end create through the new fields — this row records the governance and the contract, and the surface it governs was built in the same pass by other hands. | root `CLAUDE.md` §1/§2/§3/§5/§6/§7 · `documentation/flows/Projects.md` (rewritten) · `documentation/architecture/ROUTING.md` · `documentation/PRODUCT_MANAGEMENT.md` §3.5 · `DESIGN_SYSTEM.md` §A.7.5 · `packages/types/projects/{create,setup,mod}.ts` + `{create,setup}_test.ts` · `packages/ui/fields/{core/field,hooks/useFieldValidation,styles/field}` · `supabase/migrations/{00000003,00000015,00001100,00001130,00002010,00002011}*` · `documentation/database/{projects/{Tables,Functions,Policies},org/Policies}.md` · `apps/web/routes/(dashboard)/projects/create.tsx` · Decisions #21 / #53 / #62 / #64 / #80 / #84 / #85 |
| 87 | **An authenticated account with no profile — the un-onboarded trap, closed at the token, the gate and the write (2026-09-03).** Creating a project through the `/projects` modal answered `500` with `write_blocked` pinned to the **title**, over a database error reading `insert or update on table "projects" violates foreign key constraint "projects_owner_user_id_fkey"`. Nothing was wrong with the title, the modal or the write. `projects.projects.owner_user_id` references **`org.users_public(user_id)`**, not `auth.users`, and the signed-in identity had no profile row: a **Google sign-up is authenticated the moment the callback returns and stays profile-less** until `/join` calls `public.complete_onboarding`, because GoTrue hands `public.handle_new_user` neither a `username` nor a `dob` and both columns are `NOT NULL`. The callback routes such an account to `/join` **once** — and nothing ever routed it back, so abandoning that form (a back-navigation, a bookmark, a closed tab) left an account that reaches every authenticated surface and can complete **no** write on any of them: `projects.projects`, `projects.tickets` and the `catalogue` tables all key onto the same table. **(A) THE FACT NOW RIDES THE TOKEN.** `public.custom_access_token_hook` stamps `active_context.onboarded`, read from `FOUND` **immediately** after the `org.users_public` lookup (every later `SELECT` resets it; `v_username IS NOT NULL` would be a different question, since the column is `NOT NULL` and the two answers diverge only in the case that matters). This is what keeps the consumer network-free: the `(dashboard)` guard is a claim reader by design, and resolving profile existence any other way is a query on every authenticated request. **(B) ONLY A CONFIRMED `false` GATES ANYTHING.** The hook's `EXCEPTION` handler returns the event unchanged, so a failure OMITS the claim rather than asserting an account is un-onboarded, and `resolveUserContext` resolves an absent claim to `true`. Written as `active.onboarded !== false` rather than a truthiness test on purpose — `!active.onboarded` collapses "nobody said" into "no profile" and walks every holder of a pre-claim token back through onboarding they already finished, which is a far worse failure than letting an un-onboarded one reach a page that refuses them. It is the same default `exchangeOAuthCode` already takes. **(C) THE GATE IS SELF-HEALING, AND THAT IS WHAT MAKES IT TERMINATE.** Completing `/join` writes the profile and changes **nothing** about the token already in the browser, so a guard that acted on the claim as it stands would bounce the user straight back to the form they just completed, where `complete_onboarding` answers `User has already completed onboarding` — a loop with no exit. New `renewSession()` forces a refresh **before** a `false` is acted on; the access-token hook re-runs on the refresh grant (**verified by execution**, not assumed), so one renewal is the whole cure. It is the same refresh-before-redirect move the guard's session gate already makes, it is skipped when this request already refreshed, and because a refresh **rotates** the token it consumed, the renewed cookies are minted onto **both** the bounce and the proceeding response — dropping them would leave the browser holding a refresh token GoTrue will refuse. **(D) IT BOUNCES ONLY WHAT `/join` CAN FINISH.** A pre-fill is REQUIRED, and that is a constraint rather than a convenience: `/join` renders the email field **read-only** for an already-authenticated account and seeds it from the pre-fill, so sending someone there without one hands them a form they cannot submit — a dead end, which is worse than the page they were refused. `oauthPrefillFromClaims` rebuilds it from the token, reading `provider` from **`app_metadata`** (GoTrue writes it; a user cannot) because that marker decides whether `/join` asks for a password, and every value goes through the same clamps and the same avatar host-allowlist the URL path applies — a token this app decodes **without verifying its signature** is exactly as untrusted as a query string. **An ORGANISATION owner lands in the same profile-less state by a different door** — `provisionAccount` admin-creates them with only `objective: "organization"` and `create_organisation` never calls `provision_user_profile` — and is deliberately NOT bounced: `org.organisations.owner_user_id` references `auth.users`, so the schema does not require an org owner to have a personal profile at all, and deciding whether they should be given one is a product question, not a routing one. **(E) THE WRITE REFUSES IN WORDS.** `/api/*` sits OUTSIDE the `(dashboard)` group, so the gate never sees it; `refusalFrom` now maps the constraint to a `403` naming what to do, with **no field errors** — nothing they typed is wrong, and pinning it to whichever column the writer happened to name puts "write blocked" under a perfectly good title. Matched on the CONSTRAINT NAME, never on "violates foreign key": the generic form also catches `tickets_owner_user_id_fkey`, whose owner IS caller-supplied and whose cause is a bad id rather than a missing profile, and two causes reported as one sentence send the reader to fix the wrong thing. `403` not `401`, so `apiFetch` does not spend a refresh on a credential that is fine. **(F) ONE BUILDER FOR ONE URL.** `joinCompletionTarget` now serves all three callers — the OAuth callback, the non-live simulation and this bounce — which had already begun to drift. The `oauth` marker is not decoration: `/join` reads it to complete a federated account in place instead of signing a new one up, and `resolveAuthScreenBounce` reads it to let an authenticated visitor through a screen it otherwise bounces them off, so a copy that lost it would produce exactly the ping-pong this change exists to prevent. A test asserts the composition rather than each half alone. **NO NEW DEV CONTEXT AXIS (§5), and that is a judgement.** The gate is server-side middleware on every dashboard route, and the Dev seam is a CLIENT surface the server cannot see — so simulating it would mean plumbing a `sim` parameter into the guard, which is a privilege-adjacent forgery primitive of exactly the class Decision #72 found and gated. Nothing here reads a `data-dev-*` attribute. No lifecycle state or transition was added, so `PRODUCT_MANAGEMENT.md` is untouched; no schema table or column changed, so `documentation/database/*` gains only the hook's new claim. **VERIFIED BY EXECUTION** against the live local stack, not by inspection: the hook stamps `onboarded: false` for a profile-less identity and `true` for a seeded one; a REAL GoTrue-issued token carries it; `/projects` answers `302 → /join?oauth=google&…&redirectTo=/projects` for that account and the destination itself renders `200` (no loop); `POST /api/projects/create` answers `403` with the sentence instead of `500 write_blocked`; an onboarded user is NOT bounced and still creates a project (`201`); and — the loop case — after provisioning the profile WITHOUT touching the token, the same stale-claim cookie jar reaches `/projects` at `200` and creates successfully, proving the renewal path. Probe accounts and probe projects were removed afterwards. 20 new unit tests (836 total), `deno lint` clean over 1,473 files. **FLAGGED — surface, do not silently resolve:** (a) **a session minted before this change carries no claim, so it resolves as onboarded and is not bounced** — deliberately, per (B). Such a user gets the (E) refusal until their access token expires and the guard's refresh re-stamps the claim, or until they sign in again. (b) **The org-owner state in (D) is left alone and needs a product decision** — should completing an organisation signup also provision a personal profile? (c) `SELECT … INTO` assigns NULL to **every** target when no row is found, so the hook's `COALESCE(up.is_freelancer, false)` does not apply and a profile-less token carries `isClient: null` / `isFreelancer: null`; `resolveUserContext`'s `typeof === "boolean"` guard rejects both and falls back correctly, so this is a latent wart rather than a live defect. (d) Inherited and untouched: the two pre-existing `CalendarMonthTrack.tsx` `TS2322` errors that make `deno task check` fail on a clean tree (#85(f)). | root `CLAUDE.md` §2/§5/§6/§7 · `documentation/database/security/Functions.md` · `supabase/migrations/00001700_functions_access_token_hook.sql` · `packages/types/auth/user-context.ts` + `user-context.test.ts` · `packages/backend/services/projects/live-writes.ts` · `apps/web/utils/{session,user-context}.ts` · `apps/web/features/auth/core/{auth-routing,oauth}.ts` + their tests · `apps/web/routes/(dashboard)/_middleware.ts` · `apps/web/routes/api/auth/callback.ts` · Decisions #7 / #9 / #16 / #17 / #46 / #72 / #84 / #85 |

_Second-order conflicts noted but out of this pass (surface if you touch them): the `SPRING_EXPRESSIVE_EXIT` bounce is a live exception to §B.5's zeta >= 1 rule, sanctioned by the product owner and scoped to one decorative exit (Decision #75(a)). Pinch-to-zoom ships implemented-but-off because enabling it reverses a logged WCAG 1.4.4 position (#75(c)). The `/explore` fold re-derives its height from `100dvh` minus a
shell-set chrome token and carries a `min-block-size` floor, both of which Part D's fit-to-screen rule forbids — the fill
technique it prescribes cannot express a FIRST screenful followed by a scrolling body (#76(a)). Four of the theme engine's
seven `--on-<role>` pairs measure ~3.17:1 in LIGHT mode, so small text on a solid `--success` / `--warning` / `--danger` /
`--info` fill needs the mix `.ex-status` now applies, or a different role (#76). `finance-model.md`
§4 session late-cancel says a 50% penalty while `PRODUCT_SPEC.md`'s Session table says full forfeit
— `PRODUCT_SPEC.md` wins per the hierarchy. `storage-keys.ts` `THEME_PREFERENCE` names a key nothing reads, while
`packages/ui/system/core/context.ts` persists the theme under plain `"theme"` — Decision #74(d)._

## 9. PR Validation Checklist

- [ ] No source-of-truth doc contradicted (or the doc was updated in the same PR).
- [ ] Schema change edited **in place** into the consolidated `vvvvtooo_type_purpose.sql` files (no
      new ALTER-on-top migration; columns folded into `CREATE TABLE`); each statement in its correct
      category; Zod + `documentation/database/*` updated together.
- [ ] Islands dumb; routes thin; services fat; aliases only.
- [ ] Pure CSS + BEM, token-only; Material lib only in `packages/ui/system/`.
- [ ] Separation-hierarchy, a11y overlays, reduced-motion, ARIA, responsive all satisfied.
- [ ] **No card-in-card**; no box around static content; no translucent region backgrounds; one
      separation device per boundary (§3.6 · DESIGN_SYSTEM §B.4.2/§B.9.7).
- [ ] **No tagification** — non-actionable metadata is inline middot-separated text, not chips; no
      two adjacent non-interactive fills (§3.7 · §B.11).
- [ ] **Typographic registers** honoured — no `--fw-bold`+ headings, no weight-only level splits,
      `tabular-nums` on changing figures (§3.8 · §A.4).
- [ ] **`backdrop-filter`** only in the three sanctioned cases, on a `::before` underlay (§3.9 ·
      §B.4.3).
- [ ] **Entity-view routes**: no third sticky column; the transaction lives only in the lane on
      desktop and only in the body below `--bp-md`; lane resolved by a URL slot resolver (§3.10 ·
      §D.7/§D.8).
- [ ] Lifecycle change reflected in `PRODUCT_MANAGEMENT.md`.
- [ ] Any new/changed simulatable axis mirrored in the Dev Context Switcher (`features/devtools/`) —
      `DevOverrides` field, `DevOption` list, panel control, and `reflect()` `data-dev-*` write
      (§5).
- [ ] `XXXX-XXXX` placeholders; RLS-aware queries.
- [ ] JSDoc + regions present; no meta-comments.
- [ ] Consistent with the §8 Resolved Decisions; any **new** cross-doc conflict is flagged + logged,
      not silently resolved.
- [ ] No page/business logic added before the foundational doc + package layer is in place.
