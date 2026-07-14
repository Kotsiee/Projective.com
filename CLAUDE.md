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

| #  | Decision (2026-07-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Applied in                                                                                                                                                |
| :- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | **Chart engine — tiered.** D3.js (scales/geometry + low-density SVG) → Canvas2D (mid-density) → PIXI/WebGL (high-density stage, fed by Rust/WASM). Renderer auto-selected on a performance metric.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `PRODUCT_SPEC.md` §Libraries · `SYSTEM_ARCHITECTURE.md` §Charts · `DESIGN_SYSTEM.md` §B.5/§C.5                                                            |
| 2  | **Platform fee — 5%** flat, **plus Stripe processing fees passed through** (separate from the 5%). `finance-model.md` is canonical; `investor-summary.md` corrected from 10%.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `finance-model.md` §1.1/top-note · `investor-summary.md` §4                                                                                               |
| 3  | **Profile route param — `[handle]`** (matches the `@handle` entity identifier). `PRODUCT_SPEC.md` sitemap updated `/[profile]` → `/[handle]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `PRODUCT_SPEC.md` §Sitemap · §4 above · `api/README.md`                                                                                                   |
| 4  | **Brand mark ratios — 1:1 (icon) + 7:2 (wordmark)**, per `PRODUCT_SPEC.md` §Visual Identity (SSOT). The brief's 3:1 is superseded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `DESIGN_SYSTEM.md` §C.4                                                                                                                                   |
| 5  | **Signup route — `/join`** (renamed from `/register`, 2026-07-13, per product owner). `/register` is retired — no redirect kept; all app links repoint to `/join`. Sitemap + ROUTING updated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `PRODUCT_SPEC.md` §Sitemap · `ROUTING.md` · `apps/web/routes/(public)/(auth)/join.tsx`                                                                    |
| 6  | **Age guardrails (new rule, 2026-07-13).** DoB age-gate: **<13 blocked**, **13–17 restricted** (no buy/sell until 18), **≥18 full**. `restricted` re-derived server-side; capability-scoped only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `PRODUCT_SPEC.md` §Account Creation, Age Guardrails & Onboarding · `apps/web/features/auth/`                                                              |
| 7  | **Onboarding shapes (new rule, 2026-07-13).** Individual = lean (intent + credentials + basics + DoB). Organization = comprehensive wizard (identity, contact/address, scale, IAM, admin login), still Draft/Unverified; KYB stays deferred to L3. Google OAuth pre-fills `/join`. `redirectTo` return-path (guard param renamed `redirect`→`redirectTo`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `PRODUCT_SPEC.md` §Account Creation… · `apps/web/features/auth/` · `(dashboard)/_middleware.ts`                                                           |
| 8  | **Auth UX overhaul (2026-07-13).** `/join` is a fixed **non-scrolling** two-column wizard with a live "passport" summary; steps **1 → 1.6** (skills shown only for Freelancer; password skipped for OAuth/SSO). Softer, filled `@projective/ui` field variants for the lower-contrast palette; one scoped glassmorphic summary card. Adds **Enterprise SSO** (SAML/OIDC domain discovery, `/api/auth/sso`, provider wiring deferred). **Note:** step containers must stay `transform`-free — a transformed ancestor re-bases the field overlays' `position:fixed` panels.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `PRODUCT_SPEC.md` §Account Creation… · `apps/web/features/auth/` · `auth.css`                                                                             |
| 9  | **`/join` premium redesign (2026-07-13).** Supersedes parts of #8 for the join sidebar: **deep-primary illustrative aside** with one large adaptive SVG scene (glass "passport" card **removed** from `/join`; it remains only on login/verify/forgot via `SceneAside`), **expressive imaginative step titles** (no literal "Step 1.2"), **neutral** first step (no default account type), **auto-advance** on choice-only steps, and felt ~0.5s slide-and-fade. **Business rule:** **Organizations are client/buyer-only** — they cannot register to provide services, so the org flow skips the Client/Freelancer step and the skills step; an org **website / corporate domain** field is added to the org scale step. **Individuals get any-step Google OAuth** (mid-flow pre-fill, no bypass). Purpose/Skills become **interactive pill clusters + a custom-tag combobox, capped at 5**. **Transform refinement of #8:** `.auth-step` may carry a **self-clearing** enter transform (no `forwards` fill) — it reverts to `transform:none` before any overlay opens, so `position:fixed` panels still resolve to the viewport; a _persistent_ transform remains forbidden. | `PRODUCT_SPEC.md` §Onboarding step sequence · `apps/web/features/auth/` (`JoinArt.tsx`, `TagSelect.tsx`, `SummaryPanel.tsx`, `StepForm.tsx`) · `auth.css` |
| 10 | **Thin-Frontend / Fat-Backend service pattern (2026-07-14).** Formalises §2. Thin client services (`AuthService`) gather input + call `/api/*`; **thin routes** do HTTP+Zod+guard only; **fat services** live in the new **`@projective/backend`** workspace member (alias `@server/services/*`), own all logic/DB/session, are the sole Supabase touchpoint, and return a transport-agnostic `ServiceResult<T>`. Fat services are **stub-first**, gated live by **`AUTH_BACKEND_LIVE`** (default off). All 8 `/api/auth/*` routes delegate to `AuthBackendService`; behaviour preserved. Also: **`Organisation` ≠ `business_profiles`** — an org is a **client/buyer-only** entity, a genuinely new table (Phase 2 migration pending), NOT a rename of the seller-side `business_profiles`. Client-side **storage-keys dictionary** at `apps/web/utils/storage-keys.ts`; `/verify` gains an auto-login **verification-status poll** (reads mig 0312's `verified_at` when live).                                                                                                                                                                                               | `SYSTEM_ARCHITECTURE.md` §Backend Services · `packages/backend/` · `apps/web/features/auth/` · `apps/web/routes/api/auth/*`                               |
| 11 | **Env-name drift — RESOLVED (2026-07-14, product owner).** The **canonical** documented Environment Variable Contract names win: `DENO_ENV` / `APP_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `GOOGLE_CLIENT_SECRET`. The `.env` / `.env.development` / `.env.production` aliases (`APP_ENV` / `URL` / `SB_SERVICE_ROLE_KEY` / `GOOGLE_SECRET`) were renamed to match, `config.toml`'s Google `secret` now reads `env(GOOGLE_CLIENT_SECRET)`, and `packages/backend/core/env.ts` + `auth-cookies.ts` read the canonical names directly (dual-read fallback removed). Separately, the three `.env*` files were **untracked from git** (`git rm --cached`; they were already `.gitignore`d) — the previously committed real Google + Supabase secrets remain in git history and must be **rotated** by a human.                                                                                                                                                                                                                                                                                                                 | `SYSTEM_ARCHITECTURE.md` §Environment Variable Contract · `packages/backend/core/env.ts` · `apps/web/utils/auth-cookies.ts` · `supabase/config.toml` · `.env.example`                            |
| 13 | **Global footer redesign + newsletter thin/fat (2026-07-14).** The public footer (`PublicFooter`, mounted on every `(public)` surface via `_layout`, excluded from the zero-scroll auth screens by composition) was rebuilt as a premium five-column masthead (brand + social tray · three ELI5, jargon-free link stacks — "safe & easy payments", never "escrow" · a newsletter capture) over a thin utility bar (copyright · legal · a soft-breathing "systems operational" status dot). Link stacks are native `<details>` — accessible mobile accordions, CSS-force-open on desktop (zero JS). The newsletter is the **third** implementation of Decision #10's contract and its smallest write: `NewsletterService` (client, Zod-validates first) → `POST /api/newsletter/subscribe` (thin) → `NewsletterBackendService` (fat, `@server/services/newsletter/`) → `ServiceResult<T>`, stub-first behind **`NEWSLETTER_BACKEND_LIVE`** (default off, `isNewsletterBackendLive()`). Subscribe shape is the Zod SSOT **`@projective/types/newsletter`** (`NewsletterSubscribeSchema`). No DB migration yet (the `newsletter.subscriptions` table is Phase 2). | `SYSTEM_ARCHITECTURE.md` §Backend Services · `packages/types/newsletter/` · `packages/backend/services/newsletter/` · `apps/web/features/marketing/` (`PublicFooter.tsx`, `NewsletterForm.island.tsx`, `NewsletterService.ts`) · `apps/web/routes/api/newsletter/subscribe.ts` · `footer.css` |
| 12 | **Explore thin-frontend/fat-backend decoupling (2026-07-14).** Second, **read-only** implementation of Decision #10's contract: `ExploreService` (client) → `/api/explore/{search,item,related}` (thin) → `ExploreBackendService` (fat, `@server/services/explore/`) → `ServiceResult<T>`, stub-first behind **`EXPLORE_BACKEND_LIVE`** (default off, `isExploreBackendLive()`). The discovery fixtures + query/ranking/grouping logic were relocated OUT of the app into the backend package (the boundary forbids `@features` imports); the Explore domain shapes moved to the Zod SSOT **`@projective/types/explore`** (`ExploreItem`, `ExploreParams`, `ResultGroup`, `SearchPayload`, `HomeFeed`). `/explore` + `/view/[id]` SSR call the fat service directly; the `SearchDashboard` island refines client-side via the API. Client storage keys registered in `apps/web/utils/storage-keys.ts` (the `src/…` path in the brief is superseded — CLAUDE.md §4 bans `src/`). | `SYSTEM_ARCHITECTURE.md` §Backend Services · `packages/backend/services/explore/` · `packages/types/explore/` · `apps/web/features/explore/` · `apps/web/routes/api/explore/*` |

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
