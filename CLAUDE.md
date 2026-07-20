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

| #  | Decision (2026-07-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Applied in                                                                                                                                                                                                                                                                                    |
| :- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | **Chart engine — tiered.** D3.js (scales/geometry + low-density SVG) → Canvas2D (mid-density) → PIXI/WebGL (high-density stage, fed by Rust/WASM). Renderer auto-selected on a performance metric.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `PRODUCT_SPEC.md` §Libraries · `SYSTEM_ARCHITECTURE.md` §Charts · `DESIGN_SYSTEM.md` §B.5/§C.5                                                                                                                                                                                                |
| 2  | **Platform fee — 5%** flat, **plus Stripe processing fees passed through** (separate from the 5%). `finance-model.md` is canonical; `investor-summary.md` corrected from 10%.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `finance-model.md` §1.1/top-note · `investor-summary.md` §4                                                                                                                                                                                                                                   |
| 3  | **Profile route param — `[handle]`** (matches the `@handle` entity identifier). `PRODUCT_SPEC.md` sitemap updated `/[profile]` → `/[handle]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `PRODUCT_SPEC.md` §Sitemap · §4 above · `api/README.md`                                                                                                                                                                                                                                       |
| 4  | **Brand mark ratios — 1:1 (icon) + 7:2 (wordmark)**, per `PRODUCT_SPEC.md` §Visual Identity (SSOT). The brief's 3:1 is superseded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `DESIGN_SYSTEM.md` §C.4                                                                                                                                                                                                                                                                       |
| 5  | **Signup route — `/join`** (renamed from `/register`, 2026-07-13, per product owner). `/register` is retired — no redirect kept; all app links repoint to `/join`. Sitemap + ROUTING updated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `PRODUCT_SPEC.md` §Sitemap · `ROUTING.md` · `apps/web/routes/(public)/(auth)/join.tsx`                                                                                                                                                                                                        |
| 6  | **Age guardrails (new rule, 2026-07-13).** DoB age-gate: **<13 blocked**, **13–17 restricted** (no buy/sell until 18), **≥18 full**. `restricted` re-derived server-side; capability-scoped only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `PRODUCT_SPEC.md` §Account Creation, Age Guardrails & Onboarding · `apps/web/features/auth/`                                                                                                                                                                                                  |
| 7  | **Onboarding shapes (new rule, 2026-07-13).** Individual = lean (intent + credentials + basics + DoB). Organization = comprehensive wizard (identity, contact/address, scale, IAM, admin login), still Draft/Unverified; KYB stays deferred to L3. Google OAuth pre-fills `/join`. `redirectTo` return-path (guard param renamed `redirect`→`redirectTo`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `PRODUCT_SPEC.md` §Account Creation… · `apps/web/features/auth/` · `(dashboard)/_middleware.ts`                                                                                                                                                                                               |
| 8  | **Auth UX overhaul (2026-07-13).** `/join` is a fixed **non-scrolling** two-column wizard with a live "passport" summary; steps **1 → 1.6** (skills shown only for Freelancer; password skipped for OAuth/SSO). Softer, filled `@projective/ui` field variants for the lower-contrast palette; one scoped glassmorphic summary card. Adds **Enterprise SSO** (SAML/OIDC domain discovery, `/api/auth/sso`, provider wiring deferred). **Note:** step containers must stay `transform`-free — a transformed ancestor re-bases the field overlays' `position:fixed` panels.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `PRODUCT_SPEC.md` §Account Creation… · `apps/web/features/auth/` · `auth.css`                                                                                                                                                                                                                 |
| 9  | **`/join` premium redesign (2026-07-13).** Supersedes parts of #8 for the join sidebar: **deep-primary illustrative aside** with one large adaptive SVG scene (glass "passport" card **removed** from `/join`; it remains only on login/verify/forgot via `SceneAside`), **expressive imaginative step titles** (no literal "Step 1.2"), **neutral** first step (no default account type), **auto-advance** on choice-only steps, and felt ~0.5s slide-and-fade. **Business rule:** **Organizations are client/buyer-only** — they cannot register to provide services, so the org flow skips the Client/Freelancer step and the skills step; an org **website / corporate domain** field is added to the org scale step. **Individuals get any-step Google OAuth** (mid-flow pre-fill, no bypass). Purpose/Skills become **interactive pill clusters + a custom-tag combobox, capped at 5**. **Transform refinement of #8:** `.auth-step` may carry a **self-clearing** enter transform (no `forwards` fill) — it reverts to `transform:none` before any overlay opens, so `position:fixed` panels still resolve to the viewport; a _persistent_ transform remains forbidden. | `PRODUCT_SPEC.md` §Onboarding step sequence · `apps/web/features/auth/` (`JoinArt.tsx`, `TagSelect.tsx`, `SummaryPanel.tsx`, `StepForm.tsx`) · `auth.css`                                                                                                                                     |
| 10 | **Thin-Frontend / Fat-Backend service pattern (2026-07-14).** Formalises §2. Thin client services (`AuthService`) gather input + call `/api/*`; **thin routes** do HTTP+Zod+guard only; **fat services** live in the new **`@projective/backend`** workspace member (alias `@server/services/*`), own all logic/DB/session, are the sole Supabase touchpoint, and return a transport-agnostic `ServiceResult<T>`. Fat services are **stub-first**, gated live by **`AUTH_BACKEND_LIVE`** (default off). All 8 `/api/auth/*` routes delegate to `AuthBackendService`; behaviour preserved. Also: **`Organisation` ≠ `business_profiles`** — an org is a **client/buyer-only** entity, a genuinely new table (Phase 2 migration pending), NOT a rename of the seller-side `business_profiles`. Client-side **storage-keys dictionary** at `apps/web/utils/storage-keys.ts`; `/verify` gains an auto-login **verification-status poll** (reads mig 0312's `verified_at` when live).                                                                                                                                                                                               | `SYSTEM_ARCHITECTURE.md` §Backend Services · `packages/backend/` · `apps/web/features/auth/` · `apps/web/routes/api/auth/*`                                                                                                                                                                   |
| 11 | **Env-name drift — RESOLVED (2026-07-14, product owner).** The **canonical** documented Environment Variable Contract names win: `DENO_ENV` / `APP_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `GOOGLE_CLIENT_SECRET`. The `.env` / `.env.development` / `.env.production` aliases (`APP_ENV` / `URL` / `SB_SERVICE_ROLE_KEY` / `GOOGLE_SECRET`) were renamed to match, `config.toml`'s Google `secret` now reads `env(GOOGLE_CLIENT_SECRET)`, and `packages/backend/core/env.ts` + `auth-cookies.ts` read the canonical names directly (dual-read fallback removed). Separately, the three `.env*` files were **untracked from git** (`git rm --cached`; they were already `.gitignore`d) — the previously committed real Google + Supabase secrets remain in git history and must be **rotated** by a human.                                                                                                                                                                                                                                                                                                                                                                        | `SYSTEM_ARCHITECTURE.md` §Environment Variable Contract · `packages/backend/core/env.ts` · `apps/web/utils/auth-cookies.ts` · `supabase/config.toml` · `.env.example`                                                                                                                         |
| 13 | **Global footer redesign + newsletter thin/fat (2026-07-14).** The public footer (`PublicFooter`, mounted on every `(public)` surface via `_layout`, excluded from the zero-scroll auth screens by composition) was rebuilt as a premium five-column masthead (brand + social tray · three ELI5, jargon-free link stacks — "safe & easy payments", never "escrow" · a newsletter capture) over a thin utility bar (copyright · legal · a soft-breathing "systems operational" status dot). Link stacks are native `<details>` — accessible mobile accordions, CSS-force-open on desktop (zero JS). The newsletter is the **third** implementation of Decision #10's contract and its smallest write: `NewsletterService` (client, Zod-validates first) → `POST /api/newsletter/subscribe` (thin) → `NewsletterBackendService` (fat, `@server/services/newsletter/`) → `ServiceResult<T>`, stub-first behind **`NEWSLETTER_BACKEND_LIVE`** (default off, `isNewsletterBackendLive()`). Subscribe shape is the Zod SSOT **`@projective/types/newsletter`** (`NewsletterSubscribeSchema`). No DB migration yet (the `newsletter.subscriptions` table is Phase 2).                 | `SYSTEM_ARCHITECTURE.md` §Backend Services · `packages/types/newsletter/` · `packages/backend/services/newsletter/` · `apps/web/features/marketing/` (`PublicFooter.tsx`, `NewsletterForm.island.tsx`, `NewsletterService.ts`) · `apps/web/routes/api/newsletter/subscribe.ts` · `footer.css` |
| 12 | **Explore thin-frontend/fat-backend decoupling (2026-07-14).** Second, **read-only** implementation of Decision #10's contract: `ExploreService` (client) → `/api/explore/{search,item,related}` (thin) → `ExploreBackendService` (fat, `@server/services/explore/`) → `ServiceResult<T>`, stub-first behind **`EXPLORE_BACKEND_LIVE`** (default off, `isExploreBackendLive()`). The discovery fixtures + query/ranking/grouping logic were relocated OUT of the app into the backend package (the boundary forbids `@features` imports); the Explore domain shapes moved to the Zod SSOT **`@projective/types/explore`** (`ExploreItem`, `ExploreParams`, `ResultGroup`, `SearchPayload`, `HomeFeed`). `/explore` + `/view/[id]` SSR call the fat service directly; the `SearchDashboard` island refines client-side via the API. Client storage keys registered in `apps/web/utils/storage-keys.ts` (the `src/…` path in the brief is superseded — CLAUDE.md §4 bans `src/`).                                                                                                                                                                                                | `SYSTEM_ARCHITECTURE.md` §Backend Services · `packages/backend/services/explore/` · `packages/types/explore/` · `apps/web/features/explore/` · `apps/web/routes/api/explore/*`                                                                                                                |

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
claims (`app_metadata.active_context` + onboarding `user_metadata.objective`). Like `isAuthenticated`
this is **presence/skeleton only**: it decides which shell + skeletons SSR paints, grants **no
access**, and RLS + the `(dashboard)` guard remain the real gates; a forged token only changes what
the tamperer's own browser draws. The shape is the new Zod SSOT **`@projective/types/auth`**
(`UserContextSchema`, pure total `resolveUserContext(claims)`, `GUEST_CONTEXT`,
`PERSONAL_MEMBER_CONTEXT`, `asAuthenticatedContext()`); the HTTP-layer decode lives in
`apps/web/utils/user-context.ts`; every failure path (no/opaque/malformed cookie) degrades to
`GUEST_CONTEXT`. Both layouts bootstrap `asAuthenticatedContext(ctx.state.userContext)` into
`UserShell`, and **`globalNav(path, context)`** tailors the rail (seller-only Services/Businesses
gated on `isFreelancer`; Teams hidden in an organisation context; Earnings/Reviews sublinks
seller-only) so the correct skeleton ships in the first byte. Consistent with the buyer-only
Organisation rule (Decisions #9/#10). Org `owner` role collapses to chrome `admin`. No DB migration
(a derived runtime shape, not a table) → no `documentation/database/*` change. The real, signed-JWT
verification via `@server/services` remains the TODO wherever an *access* decision is made. |
`SYSTEM_ARCHITECTURE.md` §Security · `packages/types/auth/` · `apps/web/utils/user-context.ts` ·
`apps/web/routes/_middleware.ts` · `apps/web/utils/state.ts` ·
`apps/web/features/shell/{components/UserShell.tsx,core/nav-model.ts}` · both group `_layout.tsx` |

| 17 | **Access-token hook — the backend origin of the active context (2026-07-15).** Completes the
producer side of Decision #16. A GoTrue **custom access token hook**
(`public.custom_access_token_hook`, migration `20260715120000_access_token_context_hook.sql`, enabled
in `supabase/config.toml` `[auth.hook.custom_access_token]`) stamps the acting context — resolved
from `security.session_context` + membership/handle lookups — into every issued JWT, feeding **two**
consumers from one place: (1) **raw top-level claims** `active_profile_type`/`active_profile_id`/
`active_team_id`/`active_organisation_id` that the pre-existing `security.current_context()` (mig
0099) reads for **RLS** (these were always NULL before — no hook existed); (2)
**`app_metadata.active_context`** `{type,id,role,handle,isClient,isFreelancer}` the web app decodes
(unverified) for chrome. Additive schema: adds `security.session_context.active_organisation_id`
(FK → `org.organisations`, so an **organisation** can be the active context — buyer-only per
Decisions #9/#10) + a `security.switch_organisation_context` RPC; `switch_session_context` and
`current_context()` extended for the new slot; the four active slots are mutually exclusive. Hook is
`SECURITY DEFINER`, `search_path=''`, **never raises** (returns the event unchanged on any error so a
chrome claim can't break login), `EXECUTE` granted only to `supabase_auth_admin`. Capability flags
are now **authoritative** (from `org.users_public.is_freelancer`/`is_operator`), so
`resolveUserContext` prefers the stamped `isClient`/`isFreelancer` over the (staleable) onboarding
`objective`. **Flagged inconsistency (surface, do not silently resolve):** the `20260709` overhaul
gates the **Businesses** nav on `org.users_public.is_operator` (Client/Operator Mode), but
`nav-model.ts` (Decision #16) gates Services/Businesses on `isFreelancer` — reconcile the
Businesses-tab gate with a human. | `documentation/database/security/{Functions,Tables}.md` ·
`supabase/migrations/20260715120000_access_token_context_hook.sql` · `supabase/config.toml` ·
`packages/types/auth/user-context.ts` (`ActiveContextClaim`, `resolveUserContext`) |

| 18 | **Header re-architecture + action menus (2026-07-15).** Refines Decision #14/#15's Desktop User
shell. The unified header adopts a strict **left→right** flow: a **Left block** fuses the brand mark
to an **integrated search** (`NavSearchBar` island — the same modular scope-selector + self-typing
placeholder pattern the guest header uses, sharing the `landing-data` scope vocabulary; the old
zero-JS `HeaderSearch` server component is retired) that grows to fill the row; a **Right block**
(`UserActions` island — retiring `UserUtilityBar`) runs **Create · Notifications · Basket · Profile**
with all controls vertically centered and **soft circular** (`999px`) hover highlights. **Create** is
a context-aware Popover menu (Project/Team/Business/Service/Product/Article) gated on the hydrated
`UserContext` with the SAME rule set as the sidebar (`actions-model.ts` mirrors `nav-model.ts`):
seller surfaces (Business/Service/Product) only when `isFreelancer`; Team hidden in an `organisation`
context. **Notifications** + **Basket** open right-side **blurring** `Drawer`s (fixtures via
`nav-fixtures`, thin-frontend). **Profile** (circular avatar) opens a padded account Popover holding
View profile, the **dark/light `ToggleSwitch` moved here entirely** (no longer loose in the header),
Log out, and an **icon-only Settings** button. Sidebar polish: the collapse toggle's centre is pinned
to the shared 32px icon axis at both rail widths (a prior `margin-inline:auto` on the inline-flex
button silently failed to centre it); collapsed-rail Tooltips float above the body panel via a lifted
sticky stacking context (`.ui-app-shell__sidebar { z-index: --z-sticky }`) and are vertically
centered (native `useFloating` "right"); expanded labels step to **medium** weight with **bolder**
glyph strokes. Same buyer-only Organisation rule as Decisions #9/#10/#16. **Inherits the flagged,
unresolved** Businesses-tab gate inconsistency from Decision #17 (Create's Business option follows
`isFreelancer`, matching `nav-model.ts`, pending the human reconciliation). | `DESIGN_SYSTEM.md`
Part D.1 · `apps/web/features/shell/islands/{NavSearchBar,UserActions}.island.tsx` ·
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
`Popover` forwards `avoid`/`allowOverflow`; **applied fix:** the `/projects` Smart Filter (and sibling
Create) `bottom-end` popovers — a 19rem panel near the far edge of the ~280px middle-nav lane that
previously clamped only to the viewport and overlapped the sidebar — now pass
`avoid={[".ui-app-shell__sidebar"]}` and clear the rail. No DB/lifecycle change. | `DESIGN_SYSTEM.md`
§C.1 (hooks + collision model) · `packages/ui/hooks/{useFloating,useEdgeDetection,mod}.ts` ·
`packages/ui/feedback/islands/Popover.tsx` · `packages/ui/styles/index.css` ·
`apps/web/features/projects/islands/ProjectsLane.island.tsx` |

| 20 | **Desktop-User scroll model → locked viewport / internal body scroll (2026-07-16). REVERSES
Decision #15.** Decision #15's native-window-scroll model (whole shell in the document scroll; header
+ sidebar `position: sticky`) let the browser window scroll the nav chrome. The authenticated
**desktop** shell now **pins the viewport**: `.ui-app-shell--user` is `block-size: 100dvh; overflow:
hidden`, so the document itself never scrolls. The top bar and **both** nav columns (global sidebar +
middle-nav lane) are plain, non-scrolling flex/grid tracks — completely stationary; the global
sidebar drops `sticky` for `position: relative` (kept only for the collapsed-rail Tooltip stacking
context, `z-index: --z-sticky`) and the middle-nav lane drops the `sticky` patch for a stationary
full-height cell. **Only** the Green body (`.ui-page-canvas__scroll`, `overflow-y: auto`) scrolls and
owns the main scrollbar; each nav column keeps its own internal overflow
(`.ui-shell-sidebar__items`, `.ui-splitter__body`) for over-long content. Because the root is
height-capped, no absolutely/fixed-positioned sidebar descendant can expand the document (the §3
"scroll leak" guard is satisfied by the lock). The **guest** (marketing, no `AppShell`) shell and
**all mobile** shells release the lock (`min-block-size: 100dvh`, no `overflow` cap) → native window
scroll beneath the sticky glass header (Part D.3). **Flagged (surface, do not silently resolve):** the
mobile `BottomNav` renders as a **sibling of `AppShell`** in `UserShell`, outside the lock; it is safe
only because it is `display:none` on desktop / `position:fixed` on mobile — a future non-fixed
sibling would leak. Product owner chose the shell-level lock (not a document-root lock) on 2026-07-16.
| `DESIGN_SYSTEM.md` Part D (scroll model) · `packages/ui/navigation/styles/{app-shell,middle-nav}.css` ·
`apps/web/features/shell/components/UserShell.tsx` |

| 21 | **Project Details sidebar — the lane's engagement mode (2026-07-16).** The middle-nav lane is
now **path-discriminated within `/projects`**: the `/projects` root (+ `/projects/create`) keeps the
feed (`ProjectsLane`), but a specific `/projects/{slug}` (or deeper) swaps the lane to the new
contextual **`ProjectSidebar`** island (`apps/web/features/projects/islands/`) — `laneFor()` in
`(dashboard)/_layout.tsx` resolves the slug and SSR-paints it. It is the 5th thin-frontend/fat-backend
read: **`ProjectBackendService.detail(slug)`** → thin `/api/projects/detail` → thin
`ProjectSidebarService.detail` → soft `ProjectsResult`, gated by the SAME `PROJECTS_BACKEND_LIVE`. The
deep projection is a new **Zod SSOT `@projective/types/projects/detail`** (`ProjectDetailSchema` +
`ProjectChannel`/`StageChannel`/`TeamChannel`/`DmChannel`/`ProjectMember`); the fixtures **derive** it
from the existing summary rows (`packages/backend/services/projects/detail-fixtures.ts`, deterministic
slug-hash, no RNG) so detail always agrees with the card that linked to it — no DB migration (a derived
read projection). Sidebar surfaces: Back+Star+kebab header (kebab reuses the feed card's Open/Share/
Report/Leave/Delete); a **Project-vs-Service** contextual card (project → owner PFP + type badge;
service → banner image + client identity); core view links with a **dynamically-labelled Board**
(`boardView()`: pipeline→**Pipeline**, one-off project→**Timeline**, service/session→**Calendar**) and a
viewer-scoped Submissions note (client "All" / freelancer "Your"); and a **four-group channel accordion**
(General · Stages · Teams · Private Messages). **Client-only** Create-Stage `＋` gated on a server-derived
`viewerIsClient` (stub modal, persistence deferred). **Unified DM contract:** project DM/team channels
reuse the SAME `chatId` as the global DM (`dm-{handle}`), and every channel link carries
`?project={id}&scope={this-project|full}` via `core/chat-context.ts` (`chatHref`), with an in-context
accent tag + a "This project ⁄ Full history" scope toggle — so chat history is one record and
project-scoped filtering is prepared. **Deviation flagged (surface, do not silently resolve):** the task
brief specified `/profile/[handle]` for the owner/handle link, but the codebase canonical is Decision
#3's wildcard `/[handle]` (`@handle`) — the sidebar follows the canonical `/@handle` (via
`projects/core/routing.ts`), NOT `/profile/…`; reconcile the brief with a human if `/profile/` is truly
wanted. | `PRODUCT_SPEC.md` §Stage Management / §Unified Messaging · `packages/types/projects/detail.ts`
· `packages/backend/services/projects/{detail-fixtures,ProjectBackendService}.ts` ·
`apps/web/routes/api/projects/detail.ts` · `apps/web/features/projects/{islands/ProjectSidebar.island,
components/*,core/{detail-ssr,chat-context,routing}}.tsx` · `apps/web/routes/(dashboard)/_layout.tsx` |

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
complies via `profileHref`), and project channels resolve to **`/projects/[project-id]/[channel-id]`**.
**Conflict RESOLVED (owner directive, 2026-07-16):** the project-channel rule superseded the shipped
Unified-Messaging routing of Decision #21 — the link builder is now **repointed**. `chat-context.ts`
exports `channelHref(projectId, channelId)` → `/projects/{slug}/{channelId}` and `ChannelTree.tsx`
routes every channel/DM there; the standalone-inbox `/messages/[chatId]?project=&scope=` addressing +
the "This project ⁄ Full history" scope switch are **removed**. Unified history is **preserved** —
each channel still carries its shared `chatId` (the thread identity the destination page loads), so a
project DM and the same person's global DM remain one continuous record; only the entry-point URL
moved into the project namespace. | `DESIGN_SYSTEM.md` §B.6 · `ROUTING.md` §Global routing rules ·
`apps/web/features/projects/core/chat-context.ts` · `apps/web/features/projects/components/ChannelTree.tsx`
· Decisions #3 / #21 |

| 23 | **Project Details sidebar — icon-first refactor (2026-07-16).** Executes Decision #22's
directives on the Project Details sidebar. **Channel routing repointed** to
`/projects/[slug]/[channelId]` (see #22 resolution): `chat-context.ts` → `channelHref`, channel route
ids in `detail-fixtures.ts` shortened to clean segments (`general`, `stage-2`, `team-design-1`,
`dm-{handle}`). **Vertical text nav list DELETED** (`ProjectNavLinks.tsx` removed) → a compact
**horizontal icon-only view-nav in a NEW sticky footer** (`ProjectViewNav.tsx`): Details · Board
(dynamic Pipeline/Timeline/Calendar) · Members · Attachments · Submissions · Finances · Settings, each
a portal-`Tooltip`-labelled icon anchor; the lane **Expand/Collapse** toggle sits inline in the same
footer (dispatches `MIDDLE_LANE_TOGGLE_EVENT`). **Stage channels gained icon-only status signals**
(`StageStatusIcon.tsx` + new Zod `StageActivity` enum `new_ticket|revision_requested|stage_invite` on
`StageChannelSchema`) — tiny tonal glyph + hover Tooltip, NO inline text (§B.6). **DM group** now shows
**only project members the viewer has previously messaged** (`hasProjectContext` filter); the
This-project/Full-history scope switch + in-project accent tag are **removed**. Header (Back+Star+kebab)
+ contextual identity card (owner/client PFP · title · `/@handle` · type badge · 2-line desc · Show
details) unchanged and verified rendering at the top. | `DESIGN_SYSTEM.md` §B.6 ·
`packages/types/projects/detail.ts` (`StageActivity`) ·
`packages/backend/services/projects/detail-fixtures.ts` ·
`apps/web/features/projects/{islands/ProjectSidebar.island,components/{ProjectViewNav,StageStatusIcon,
ChannelTree},core/chat-context,styles/project-sidebar.css}` · Decisions #21 / #22 |

| 24 | **Project Details sidebar — card-less header + channel quick-filters + footer realign
(2026-07-16).** Refines Decision #23's Project Details sidebar; no data/lifecycle change (presentation
+ client view-state only). **(A) Card-LESS identity header** (`ProjectContextCard`): the boxed tonal
`.proj-ctx` container is **removed** — the header rests directly on the lane surface and is set off
from the channel tree by one `--hairline` divider (`.proj-detail__divider`, §B.4). Layout is the
leading party's **large** avatar (48px; owner for a project, client for a service) LEFT, the title + a
**single clickable owner/client name** stacked right (name → canonical **`/@handle`** per Decision
#3), and a **lone icon-only project-type glyph** (Pipeline·Timeline·Calendar via `boardView`) pinned
top-right whose portal `Tooltip` names the type. **Removed as redundant:** the written type **badge**,
the `@handle` **text** line, and the **second small avatar** (§B.6 icon-first). The description is one
**interactive reveal block** — up to **3 lines**, a "Show details" affordance, a hover colour-shift
(`--text-secondary`→`--on-surface`, i.e. darkens in light / lightens in dark), and a click routing to
`/projects/{slug}`. **(B) Channel quick-filters** (`ChannelQuickFilters`, NEW): an icon-only toggle
row (Starred · Unread · New tickets · Revisions, portal `Tooltip`s) between the description and the
divider narrows the channel tree — OR-combined, force-opens matched groups, empty-state on no match;
`starred` is **stubbed** (no channel-level star yet, pending the live backend). **(C) Footer realign**
(`ProjectViewNav`): the sticky footer now pins the lane **collapse/expand toggle LEFT** and the
view-link icons flush **RIGHT**; the toggle **reuses the global rail's `SidebarToggleIcon` glyph +
morphing-divider slide**, scoped in `project-sidebar.css` to track THIS lane's `data-collapsed` (same
technique as the feed's `.proj-lane__collapse`), **retiring** the old `PanelToggleIcon` rotate. |
`DESIGN_SYSTEM.md` §B.6 · `apps/web/features/projects/{islands/ProjectSidebar.island,components/{ProjectContextCard,
ChannelQuickFilters,ChannelTree,ProjectViewNav,detail-glyphs},styles/project-sidebar.css}` ·
Decisions #3 / #21 / #23 |

| 25 | **Project Details sidebar — dedicated collapsed icon rail + smooth lane width (2026-07-16).**
Refines Decision #24; presentation + a portable splitter enhancement (no data/lifecycle change). **(A)
Two presentations, CSS-switched by density.** The sidebar now renders BOTH an expanded stack
(`.proj-detail__full`) and a purpose-built collapsed **icon rail** (`ProjectRail`), with
`.ui-splitter[data-mode="collapsed"]` revealing exactly one — so **both** a handle drag and the toggle
flip it, with **no client width-observer** and **deterministic** toggles (the footer toggle only
collapses, the rail toggle only expands; each is visible solely in its own state, so the prior
`collapsed` signal + seeding `useEffect` were removed). The rail is a single vertical flex column:
**top** — Back · owner/client avatar (circular, links to canonical `/@handle`) · Details · Board
(dynamic Pipeline/Timeline/Calendar) · Members · Attachments · Submissions · Finances; **bottom**
(`margin-block-start:auto`) — Settings · an Expand toggle (reusing the global rail's `SidebarToggleIcon`
glyph + morphing-divider slide). Every rail button mirrors the global collapsed `.ui-nav-item` exactly
(48px `--shell-nav-block` square, `padding:0`, `--radius-base`, same hover/active tints, 24px icon) and
carries a portal `Tooltip` + `aria-label` (§B.6, never native `title`). The core view links are shared
via a new `projectViewLinks(detail)` helper (in `detail-glyphs.tsx`, also consumed by `ProjectViewNav`)
and `cloneElement`-copied in the rail so a glyph VNode is never mounted twice at once (Preact
VNode-reuse guard). **(B) Wider collapsed lane.** Scoped via
`.ui-splitter[data-mode="collapsed"]:has(.proj-detail)`, the collapsed **Project Details** lane widens
to `calc(var(--shell-sidebar-w) + 6px)` (70px; body resolves to the 64px global-rail width for 8px
gutters) — the feed lane keeps its own narrow 56px rail (the `:has` scopes it). **(C) Smooth,
drag-safe lane width (portable `@projective/ui` splitter change, Part D.2).** `useSplitter` now returns
a **`dragging`** signal (set across pointer down→up); `MiddleNavSplitter` stamps `data-dragging`, and
`splitter.css` gives `.ui-splitter` an `inline-size` transition (`--dur-medium`/`--spring-standard`)
that is **suppressed mid-drag** (`[data-dragging="true"]`) so toggling collapse/expand animates while a
handle drag still tracks the pointer 1:1; reduced-motion drops the transition. Benefits the feed lane
too (additive, backward-compatible return shape). | `DESIGN_SYSTEM.md` Part D.1/D.2 · §B.6 ·
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
channels** (matching General/Team rows) instead of the coloured lifecycle dot — state still reads via
the trailing `StageStatusIcon` + unread dot (§B.6); the dead `.proj-chan__stagedot` CSS was removed.
DM/team rows keep their circular avatar. New `DESIGN_SYSTEM.md` **§D.4**. | `DESIGN_SYSTEM.md` §D.4 ·
§B.4/§B.6 · Part D (scroll model) · `apps/web/routes/(dashboard)/projects/[projectId]/[channelId]/{_layout,chat}.tsx`
· `apps/web/features/projects/{islands/ChannelHeader.island,islands/ChatComposer.island,components/ChannelTree,styles/channel-header.css,styles/project-sidebar.css}`
· Decisions #20 / #21 / #23 |

| 27 | **Shell scroll model → native window scroll (2026-07-16). REVERSES Decision #20.** Per product
owner, the authenticated shell returns to a **native window scroll** on every profile (the intent of
Decision #15), undoing #20's locked-viewport frame. `.ui-app-shell--user` drops `block-size: 100dvh;
overflow: hidden` for the shared `min-block-size: 100dvh` (no `overflow` cap), so the **document
itself** scrolls and the browser window owns the single main scrollbar. The chrome is pinned by
`sticky`, not by locking the root: the top bar (`top: 0`, unchanged), and now the **global sidebar**
(`.ui-app-shell__sidebar`) + the **middle-nav lane** (`.ui-middle-nav__lane`) are `position: sticky;
inset-block-start: var(--shell-topbar-h); block-size: calc(100dvh - topbar); align-self: start`, each
keeping its own internal overflow (`.ui-shell-sidebar__items`, `.ui-splitter__body`) so a tall rail
scrolls inside itself instead of scrolling away with — or lengthening — the page.
`.ui-middle-nav__content` and `.ui-page-canvas__scroll` become `overflow: visible` (no container
scroll; the `.ui-app-shell--user .ui-page-canvas__scroll { overflow-y: auto }` override is removed).
The nested ShellFrames' `overflow: clip` is NOT a scroll container, so every sticky descendant
resolves against the window — one scrollbar, no nested trap. **Decision #26 adapted:** the
`ChannelHeader` now sticks at `inset-block-start: var(--shell-topbar-h)` (was `0`, which would hide it
behind the sticky top bar), the `ChatComposer` keeps `sticky; bottom: 0` (now pinned to the viewport
bottom by the window scroll, not an inner region), and `.chan-view` fills `min-block-size: calc(100dvh
- topbar)` so the composer pins to the screen bottom even for a short chat. Verified: on
`/projects/{slug}/{channel}/chat` the document overflows the viewport (window scrolls) while top bar,
channel header, sidebar, lane, and composer all hold their viewport pins; no horizontal leak; the
only internal scrollers are the intentional nav-column lists. No DB/lifecycle/business-rule change
(pure shell CSS). | `DESIGN_SYSTEM.md` Part D (scroll model) / §D.4 ·
`packages/ui/navigation/styles/{app-shell,middle-nav,page-canvas}.css` ·
`apps/web/features/projects/styles/{channel-header,chat-composer}.css` · Decisions #15 / #20 / #26 |

| 28 | **Configurable middle-nav content-pane header slot (2026-07-17).** Refines Decision #26/#27.
The channel `ChannelHeader` is no longer rendered by the page inside the scrolling body — it is
hoisted to a **single route-driven header slot** on the middle-nav content pane. `PageCanvas` gains an
optional **`header`** slot (`.ui-page-canvas__header`, `--has-header` modifier) rendered as a sticky,
non-scrolling strip INSIDE the rounded frame, above `.ui-page-canvas__scroll`; when unset the slot is
**not rendered at all**, so the frame collapses it and the body fills the top with no reserved space
(no empty bar). `UserShell` threads a `middleNavHeader` prop into that slot. **Registration is
SSR-idiomatic, not a client React context:** a client context cannot paint the slot on the first SSR
byte (it would flash empty every navigation) and does not persist across Fresh's per-navigation
renders, so pages "register" a header the same way the lane is resolved (`laneFor`) — a pure resolver
keyed on the URL, `channelHeaderFor(url, context)` (`apps/web/features/projects/core/
channel-header-slot.tsx`), evaluated by `(dashboard)/_layout.tsx`. It returns the `ChannelHeader`
only on `/projects/[projectId]/[channelId]` and `null` elsewhere. The header slot owns the sticky
positioning (`inset-block-start: var(--shell-topbar-h)`, `--z-sticky`); `.chan-header` is now a plain
in-flow strip (its own `position: sticky` removed). New token **`--shell-midnav-header-h: 3rem`**
sizes the header and is subtracted in `.chan-view`'s `min-block-size` (now `calc(100dvh - topbar -
midnav-header-h)`) so the Chat composer still pins to the screen bottom on short chats. The channel
`[channelId]/_layout.tsx` no longer resolves project detail — it keeps only the body + the Chat-only
composer, resolving the Chat tab straight from the URL (`activeTabOf`). Verified: header mounts in the
slot (pinned, tabs/underline/meta intact) on channel routes incl. non-chat tabs (composer absent off
Chat); the feed, `/projects/create`, a channel-less `/projects/{slug}`, and public routes show no
header and no empty bar; no console errors. Pure layout/CSS — no DB/lifecycle/business-rule change. |
`DESIGN_SYSTEM.md` §D.4 / §C.1 · `packages/ui/navigation/components/PageCanvas.tsx` ·
`packages/ui/navigation/styles/page-canvas.css` · `packages/ui/styles/index.css` ·
`apps/web/features/shell/components/UserShell.tsx` ·
`apps/web/features/projects/core/channel-header-slot.tsx` · `apps/web/routes/(dashboard)/_layout.tsx`
· `apps/web/routes/(dashboard)/projects/[projectId]/[channelId]/_layout.tsx` ·
`apps/web/features/projects/styles/channel-header.css` · Decisions #26 / #27 |

| 29 | **Middle-nav header band — lifted from the content pane to the frame, connected to the lane
(2026-07-17). REFINES Decision #28.** Decision #28 implemented the configurable header as a slot INSIDE
the Green content pane (`PageCanvas`'s `.ui-page-canvas__header`), so it floated within the canvas,
visually detached from the lane. Per the product owner's sketch, the header must instead **span the
middle-nav frame and connect to the sidebar** as ONE strip sharing the same surface + top curve. The
header slot is therefore **hoisted one level up to the `MiddleNav` frame**: `MiddleNav` is now a
two-row grid — the **lane spans both rows** (col 1) while the content column splits into an optional
**`header` band** (`.ui-middle-nav__header`, col 2 row 1, `position: sticky` at `--shell-topbar-h`,
`--z-sticky`) above the content canvas (col 2 row 2); with no header the canvas spans both rows and
fills the top (no empty bar). The band sits **flush against the lane on the shared Blue `--surface-1`
tone**, and the lane's own Back/kebab header (`.proj-detail__header`) is pinned to the same
`--shell-midnav-header-h` height (`flex: none` so the lane's flex column can't shrink it) — so the two
halves line up as **one connected header strip with a continuous `--hairline` seam** across the whole
frame (verified: both 48px, same top **and** bottom, band flush at the lane's right edge; the Green
canvas + the lane channels both start below the seam). `PageCanvas` **loses its `header` slot
entirely** (prop + `.ui-page-canvas__header` CSS removed); `UserShell` routes `middleNavHeader` into
`MiddleNav`'s `header` prop instead (it now **requires a lane** — the band belongs to the frame).
`ChannelHeader` (still the island of Decision #28, unchanged markup) reads `--surface-1` to match the
band. The URL resolver `channelHeaderFor` and `channel-view.ts`/`activeTabOf` are unchanged. Pure
layout/CSS — no DB/lifecycle/business-rule change. | `DESIGN_SYSTEM.md` §D.4 ·
`packages/ui/navigation/components/{MiddleNav,PageCanvas}.tsx` ·
`packages/ui/navigation/styles/{middle-nav,page-canvas}.css` ·
`apps/web/features/shell/components/UserShell.tsx` ·
`apps/web/features/projects/styles/{channel-header,project-sidebar}.css` · `ROUTING.md` · Decision #28 |

| 30 | **Middle-nav frame → pinned, internal content scroll so the corners follow (2026-07-17). REFINES
Decision #27 for the middle-nav region.** After Decision #29 lifted the header to the `MiddleNav` frame,
the frame's rounded corners (and the connected header band + lane) **scrolled away** on a long chat:
`.ui-middle-nav` was `position: static`, so under Decision #27's native window scroll it flowed up with
the document while only the sticky chrome stayed — the top curve carried up out of view (verified:
`frameTop` 48 → -352 at `scrollY` 400). Fix (desktop, `@media (min-width: 768px)`): **pin the frame**
(`sticky` at `--shell-topbar-h`, `block-size: calc(100dvh - topbar)`) and **scroll its content
INTERNALLY** (`.ui-middle-nav__content { overflow: hidden }` → `.ui-page-canvas__scroll { overflow-y:
auto }`), so the frame — corners, header band, lane — stays fixed to the viewport while only the bodies
move (the lane already scrolled internally via `.ui-splitter__body`). The composer (`sticky; bottom: 0`)
now pins inside that internal scroller. The header band's row is a **definite** track
(`.ui-middle-nav--has-header { grid-template-rows: var(--shell-midnav-header-h) 1fr }`) — an `auto` row
collapsed to 0 under the now-definite frame height (the `.chan-header` `block-size: 100%`↔auto-track
circularity); `.chan-header` is a fixed `block-size: var(--shell-midnav-header-h)`. **The top bar +
global sidebar stay `sticky` (unchanged); mobile keeps native window scroll** (no frame chrome, Part
D.3); bare-canvas (no-lane) pages are untouched (the rules are scoped to `.ui-middle-nav`). Net: for a
page WITH a middle-nav the document no longer window-scrolls (content scrolls inside the pinned frame) —
a scoped return toward the internal-scroll model (#20) for that region only, chosen so the rounded
corners stay attached to the viewport per the product owner. Verified: frame/band/canvas/lane-header all
hold their top on internal scroll (`curvesFollow: true`), band 48px, canvas starts at the seam (97),
composer pins to the viewport bottom, feed + `/projects` root unaffected, no console errors. Pure
layout/CSS — no DB/lifecycle/business-rule change. | `DESIGN_SYSTEM.md` Part D / §D.4 ·
`packages/ui/navigation/styles/middle-nav.css` · `apps/web/features/projects/styles/channel-header.css`
· Decisions #27 / #29 |

| 31 | **Channel chat feed + scroll model → native window scroll & composer footer band (2026-07-17).
REVERSES Decision #30 for the middle-nav region.** Two changes ship together. **(A) Scroll model.**
Decision #30 pinned the middle-nav frame and scrolled its content INTERNALLY so the rounded corners
wouldn't scroll away; per product owner the region returns to the **native WINDOW scroll** (the intent
of #15/#27). `middle-nav.css` drops the desktop frame-pin + internal-scroll; the frame flows in the
document and the browser window owns the single main scrollbar (never `body`, never
`.ui-middle-nav__content`). `.ui-page-canvas__scroll` is **renamed `.ui-page-canvas__body`** (it no
longer scrolls) and made a flex column so the chat feed can `flex: 1` to fill the content row and
bottom-anchor a short conversation. The `HeroParticles` parallax (which keyed off the old class) now
observes window scroll. **(B) Composer relocation.** The `ChatComposer` moves OUT of
`[channelId]/_layout.tsx` (it was `sticky; bottom: 0` inside the scroll body) into a NEW configurable
middle-nav **`footer` band** (`.ui-middle-nav__footer`, `sticky; inset-block-end: 0` at `--z-sticky`),
the sibling of the header band — resolved per route by `channelFooterFor` (mirrors `channelHeaderFor`)
and threaded `UserShell.middleNavFooter` → `MiddleNav.footer`, Chat-tab only. `MiddleNav` is now a
three-row grid (header · content · footer; lane spans all three). **(C) The chat feed** — the 6th
thin-frontend/fat-backend read: `MessagesService` (client) → `/api/projects/messages` (thin) →
`ProjectBackendService.messages` (fat, fixtures) → `ServiceResult<MessagePage>`, stub-first behind the
SAME `PROJECTS_BACKEND_LIVE`; Zod SSOT **`@projective/types/projects/messages`** (`ChatMessage`,
`MessageSender/Attachment/Audio`, `SystemActivity`, `MessageReaction`, `MessagePage(+Params)`,
`ChannelPermissions`). Fixtures **derive** a deterministic conversation from the same `ProjectDetail`
(no RNG, fixed reference clock) so the feed agrees with the channel that opened it. **No DB migration**
— messages is a read projection over the eventual `messages.*` tables (Phase 2, like `detail`), so no
`documentation/database/*` change. `ChatFeed.island` **bottom-anchors + virtualizes against the
window** (`useVirtualScroll` `useWindow`), opening at the newest message and loading older on scroll-up
(top IntersectionObserver sentinel → prepend → re-anchor by the document-growth delta). `useVirtualScroll`
gained **additive, backward-compatible** `startAtEnd`/`scrollToEnd`/`onReachStart`, id-keyed
measurements (`getItemKey`, prepend-safe), a `scrollToIndex(offset)`, and immediate re-sync on
programmatic scroll. Message UI (all in `apps/web/features/projects/`, reusing `@projective/ui`
Avatar/Popover/Tooltip + the composer's `useWaveform`/`resamplePeaks`): consecutive grouping (same
author within 10–30 min → reduced separation, one avatar/name, corner masking — others sharpen the
group-toward LEFT corners, own the RIGHT), own-right/other-left, `max-width: 60%` bubbles, no-layout-shift
hover time, a Reply·React·Copy toolbar + a `…` menu (Pin·Favourite·Report) with **Pin gated by
server-derived `canPin`** (anyone in a DM; owner-granted in a project/team channel), a custom **"wonky
star"** favourite mark on the bubble border, media (aspect-ratio row ≤3 media, else a rounded-square
grid **max 4** with a `+N` overlay), an audio player matching the recorder visualizer, **interactive**
system-activity notices that route to their target, and a **sticky pinned banner** (≤3, one-at-a-time,
`‹`/`›` loop, Expand, jump-to-message). **Deviation flagged (surface, do not silently resolve):** the
task brief specified the sender profile link as `/profiles/[user id]`, but the codebase canonical is
Decision #3/#22's wildcard `/[handle]` (`/@handle`, via `profileHref`) — the feed follows the
canonical, NOT `/profiles/[id]`; reconcile with a human if the plural `/profiles/[id]` route is truly
wanted. Submission notices link within the canonical channel namespace
`/projects/[projectId]/[channelId]/submissions/[id]`. | `DESIGN_SYSTEM.md` Part D / §D.4 / §C.1 ·
`packages/ui/navigation/{components/{MiddleNav,PageCanvas}.tsx,styles/{middle-nav,page-canvas,app-shell}.css}`
· `packages/ui/hooks/useVirtualScroll.ts` · `packages/types/projects/messages.ts` ·
`packages/backend/services/projects/{messages-fixtures,ProjectBackendService}.ts` ·
`apps/web/routes/api/projects/messages.ts` · `apps/web/features/projects/{islands/ChatFeed.island,
components/*,core/{message-model,MessagesService,messages-ssr,channel-footer-slot}}.tsx` ·
`apps/web/features/shell/components/UserShell.tsx` · `apps/web/routes/(dashboard)/_layout.tsx` ·
Decisions #26 / #27 / #30 |

| 32 | **File Explorer — `/files` (channel + project scope) (2026-07-20).** The 7th thin-frontend/fat-backend
read: a virtualized, zoom-driven File Explorer for a project's channel attachments. Channel scope
`/projects/[projectId]/[channelId]/files` (attachments in one channel; the shell mounts the channel
header with the active Files tab) and project scope `/projects/[projectId]/files` (all channels, with a
**Channels-top-level** tree navigator — the `FileChannelTree`; legacy `/attachments` 308-redirects here,
and per-channel `/attachments` → that channel's `/files`). New **Zod SSOT `@projective/types/projects/files`**
(`FileItem`/`FileListPage`/`FileListParams`/`FileKind`/`FileSortKey`…); fat `ProjectBackendService.files`
→ thin `/api/projects/files` → client `FilesService` → SSR `resolveFilePage`, gated by the SAME
`PROJECTS_BACKEND_LIVE`. Fixtures **derive** a deterministic file corpus from `ProjectDetail`'s channels
(fixed clock, unsigned hash indices — a signed `>>` went negative → a "….undefined" ext) — **no DB
migration** (a read projection over the eventual `files.*` tables, like `detail`/`messages`).
**Zoom-driven view (NO grid/list toggle button):** one continuous `zoom` (0–1) shared cross-island via
`core/view-state.ts`; below the centre marker = the dense list/table (adaptive inline thumbnail →
category icon), above it = the rounded-**square** card grid (cards scale with zoom); `Ctrl`+wheel over
the workspace drives it (default-prevented). Both viewports window-virtualize with infinite scroll. New
`@projective/ui` primitives (§C.1 roster + Part-C prose updated in the same change): **`display/VirtualGrid`**
(1D-by-row windowed grid), **`fields/SortControl`** (property dropdown + asc/desc toggle in one borderless
block), **`fields/ZoomSlider`** (the footer View Control Rig's − · segmented track + centre marker · +),
the borderless **`.ui-field--bare`** variant, and **`layout/SplitterPanel.maxSize`**. The **universal
preview modal** (footer-less; a `.ui-splitter` media/metadata split with hard min/max %; a `Carousel`
swipe + a bottom companion tray for multi-file posts; per-type inline previews incl. syntax-highlighted
code; inline rename on the viewer's OWN files; Download/Star/kebab) mounts through **`BodyPortal`** to
beat the glass-blur `position:fixed` re-base trap. **CRITICAL splitter-protection (tested):** the layout
`Splitter` (the modal) and the nav lane `MiddleNavSplitter` share `.ui-splitter`; the nav's globally-
loaded `splitter.css` (`inline-size: var(--shell-lane-w)`) would otherwise force the modal splitter to the
lane width (the "wide-or-collapsed binary"), so the layout splitter's ROOT box rules are scoped to its
`--horizontal`/`--vertical` modifiers (specificity beats the bare nav rule; the lane never carries them) —
`useSplitter`/`MiddleNavSplitter`/nav `splitter.css` are **untouched**. The View Control Rig is resolved
into the middle-nav footer band by `filesFooterFor` (composed after `channelFooterFor`). The footer
persists `zoom`; table column widths persist too (`LocalKeys.FILES_ZOOM` / `FILES_COLUMNS`). **Also fixed
(pre-existing, unrelated):** `packages/ui/navigation/styles/index.css` `@import`ed a non-existent
`./file-tree.css` (orphaned by earlier uncommitted files work) — every dashboard route 500'd; the dead
import was removed. **Deviation flagged (surface, do not silently resolve):** the brief's `/attachments`
"under `/channels`" was implemented as a redirect to `/files` (Channels are the tree's top level), not a
distinct `/channels` route. | `PRODUCT_SPEC.md` §Unified Messaging / attachments · `packages/types/projects/files.ts`
· `packages/backend/services/projects/files-fixtures.ts` · `apps/web/routes/api/projects/files.ts` ·
`apps/web/features/projects/{islands/{FileExplorer,ViewControlRig}.island,components/{FileCard,FileTable,
FileChannelTree,AttachmentPreviewModal,FilePreview,file-glyphs}.tsx,core/{view-state,file-model,FilesService,
files-ssr,files-footer-slot}}` · `packages/ui/{display/islands/VirtualGrid,fields/islands/{SortControl,ZoomSlider},
layout/islands/Splitter}.tsx` · `apps/web/routes/(dashboard)/projects/[projectId]/{files,attachments,[channelId]/{files,attachments}}.tsx`
· Decisions #10 / #31 |

| 33 | **Submissions explorer — `/submissions` (channel + project scope) (2026-07-20).** The 8th
thin-frontend/fat-backend read, and a near-twin of the File Explorer (Decision #32): the Submissions
canvas is the Files canvas PLUS a full-height sticky navigation **tree** (left, separated by a single
`--hairline` vertical divider, §B.4) and an interactive **breadcrumbs** bar atop the workspace. New Zod
SSOT **`@projective/types/projects/submissions`** (`SubmissionTreeNode` [recursive `z.lazy`],
`SubmissionUnit`, `SubmissionCrumb`, `SubmissionNote`/`SubmissionReview`, `SubmissionListParams`/`Page`;
file rows REUSE `FileItemSchema`, sort/filter reuse `FileSortKey`); fat `ProjectBackendService.submissions`
→ thin `/api/projects/submissions` → client `SubmissionsService` → SSR `resolveSubmissionPage`, gated by
the SAME `PROJECTS_BACKEND_LIVE`. Fixtures **derive** the deliverable hierarchy from `ProjectDetail`
(stages + provider-side members → tree; deterministic, unsigned-hash indices, fixed clock) — **no DB
migration** (a read projection over the eventual `submissions.*`/`files.*` tables, like `files`/`messages`).
**Tree hierarchy** (Part 3): project scope prepends **Stages** as tree roots, then Submitter (with
profile **avatar**) → Unit (custom-name / ticket / timestamp) → nested directories; the
**single-freelancer override** collapses the submitter level (applied per stage in project scope).
**Routing changed to a WILDCARD** `[...path]` in both scopes (`…/submissions/[...path].tsx`; the old
single-segment `[channelId]/submissions.tsx` placeholder removed) so any tree node is a deep-linkable URL
the tree + breadcrumbs address; the project-scope static `submissions` segment precedes `[channelId]`
(never shadows a channel), and `activeTabOf` keeps the header's Submissions tab active on deep paths.
Tree + breadcrumb clicks re-scope via the thin service and sync the URL via `history.pushState`
(back/forward via `popstate`). **Zoom-driven grid⇄list (no toggle), Ctrl+wheel, window-virtualized** —
all REUSED from the File Explorer (`FileCard`/`FileTable`/`FilePreview`/`AttachmentPreviewModal`/`view-state`
zoom, shared `FILES_ZOOM` key). Footer band = the **View Control Rig** (left) + a far-**right Review
Submission** trigger (Part 4; shown when an active unit is in view AND `viewerIsClient`), bridged to the
explorer via cross-island signals (`core/submissions-review.ts`, like the chat footer↔body pattern) and
resolved by `submissionsFooterFor` (composed after `channelFooterFor`/`filesFooterFor`). The **review
workspace modal** is a `layout/Splitter` (small context sidebar: freelancer card · Stage/Ticket/Notes tabs
w/ badge · full-height tree — large workspace: media preview + metadata/feedback, expand-fullscreen +
open-in-new-tab), footered with **Request Revision** (blocked until a text annotation OR global guideline
is provided) / **Accept Submission**; mounted via `BodyPortal` (glass-blur trap). New reusable
`@projective/ui` **`navigation/TreeNav`** (chevron disclosure, avatar/status slots) + a backward-compatible
**`Breadcrumb` `command`** extension for client-driven trails (§C.1 roster updated same change). **Splitter
collision** discipline (Decision #32) is INHERITED unchanged — `splitter.css` + the nav splitter are
untouched; the modal reuses the modifier-scoped layout `Splitter`. **Deviation flagged (surface, do not
silently resolve):** the task brief's per-file sender/profile shapes are the canonical `/@handle`
(`profileHref`, Decision #3), not a `/profiles/[id]` path. | `PRODUCT_SPEC.md` §Stage Management /
Submissions · `packages/types/projects/submissions.ts` ·
`packages/backend/services/projects/submissions-fixtures.ts` · `apps/web/routes/api/projects/submissions.ts`
· `apps/web/features/projects/{islands/{SubmissionExplorer,SubmissionViewControlRig}.island,components/{SubmissionTree,
SubmissionBreadcrumbs,SubmissionReviewModal,submission-glyphs}.tsx,core/{submission-model,SubmissionsService,
submissions-ssr,submissions-review,submissions-footer-slot}}` · `packages/ui/navigation/{islands/TreeNav,
components/Breadcrumb}.tsx` · `apps/web/routes/(dashboard)/projects/[projectId]/{submissions/[...path],[channelId]/submissions/[...path]}.tsx`
· `DESIGN_SYSTEM.md` §C.1 · `ROUTING.md` · Decisions #10 / #31 / #32 |

| 34 | **Shared AudioVisualizer + Table sort config + attachment-modal & submission-card polish
(2026-07-20).** Four related enhancements over Decisions #31–#33 (presentation + one reusable
component; **no DB/lifecycle/business-rule change**). **(A) `@projective/ui/display` AudioVisualizer.**
The `.msg-audio` canvas waveform player (previously duplicated between the projects
`MessageAudioPlayer` and the composer `useWaveform`) is promoted to a reusable, token-driven component
(`packages/ui/display/{islands/AudioVisualizer,core/audio,styles/audio-visualizer.css}`): play/pause ·
a seekable rounded-bar `<canvas>` waveform (`role="slider"`) · an elapsed/duration clock · an optional
speed cycle, with a **dual transport** (a real `src` owns a hidden `<audio>`; an absent/`"#"` source
simulates progress over `durationMs` so stub fixtures still demo) and a **two-tone
`--wave-played`/`--wave-rest`** waveform that inherits from an ancestor (an "own" chat bubble re-tints
it) — the component sets **no** local `--wave-*` so the bubble's inherited values win, and falls back
to `--primary`/`--text-secondary` tokens in JS. `MessageAudioPlayer` is now a thin adapter; the
`FilePreview` audio branch renders it too, so the **attachment modal and the review workspace** get a
real player for free. The composer's live-scrolling `useWaveform` (a distinct capture mode) stays.
**(B) Table sort config.** The shared `Table` gains a per-table **`multiSort`** flag (default `true`;
`false` ignores Shift-click → single-column, still 3-state) so the capability stays "available for
future use". Files/Submissions keep the **bespoke `FileTable`** (its zoom-view/window-virtualization/
`FILES_COLUMNS` resize are unchanged) but gain **3-state single-column sort**: the header cycles
asc→desc→**none**, where "none" **clears the active sort key** (`sortKey=""` → `sort` omitted → the
backend's default order) rather than widening `FileSortDir` — chosen so the toolbar `SortControl`'s
2-state `direction` binding stays type-sound; multi-sort is inherently off. **(C) Attachment modal.**
The media stage is bounded (`overflow:hidden` + `max-*:100%`) so a large preview never overlaps the
left thumbnail tray; a **"Go to Message"** aside link routes to the source message
(`channelMessageHref` → `/projects/{id}/{channel}/chat#m-{messageId}`, canonical channel namespace per
Decision #22, anchor best-effort into the virtualized feed); and a Submissions-context **client Notes
area** (`notesMode` prop, left panel) lets the reviewer jot review notes (session-local stub +
`onSaveNote` for future persistence). **(D) Submissions card drill-down** (executes Decision #33's Part
3 intent while **keeping** its Stage-first hierarchy — children-as-cards, NOT a reorder): the
Submissions workspace renders the **current node's direct children as navigable cards/rows** (new
`FreelancerCard` for `submitter`, `SubmissionCard` for `unit`/`stage`/`dir`, `SubmissionNodeList` for
list mode) and only falls back to the file grid at a `unit`/`dir` leaf (or when a search/filter is
active). So channel scope leads with **Freelancer Cards** directly, and project scope drills
**Stage → Freelancer Cards → Submission Cards → files**; clicking a card reuses the existing
`navigate()`/pushState plumbing (new pure `nodeAt`/`childNodesAt`/`nodeShowsChildCards` in
`submission-model.ts`, no backend/Zod change). Part 4's Client Review Workspace was already shipped by
Decision #33 and is unchanged bar the free audio upgrade. | `DESIGN_SYSTEM.md` §C.1 (display roster +
Part-C) · `packages/ui/display/{islands/AudioVisualizer,core/audio,styles/audio-visualizer,islands/Table}`
· `apps/web/features/projects/{components/{MessageAudioPlayer,FilePreview,AttachmentPreviewModal,FileTable,
FreelancerCard,SubmissionCard,SubmissionNodeList},core/{chat-context,submission-model},islands/{FileExplorer,
SubmissionExplorer}.island,styles/{attachment-modal,file-table,submission-card,chat-feed}.css}` · Decisions
#22 / #31 / #32 / #33 |

| 35 | **Kanban Board system + reusable DnD/Kanban primitives (2026-07-20).** Two NEW `@projective/ui`
sub-paths land the reusable layer the board needs. **`@projective/ui/dnd`** is a dependency-free
**Pointer-Events** drag-and-drop kit — NO native HTML5 `draggable`, NO external library (root
CLAUDE.md §3 · PRODUCT_SPEC §Libraries · SYSTEM_ARCHITECTURE §KanbanBoard): a `DndContext` island
(pointer sensor w/ movement threshold + capture-phase click-suppression; keyboard sensor Space/Arrows/
Enter/Escape) over a signal-first store, `Draggable`/`Droppable`/`SortableContext`(=`SortableContainer`)/
`DragOverlay` (ghost via `BodyPortal`), the `useDraggable`/`useDroppable`/`useSortable`/`useDndMonitor`
hooks, pure collision detectors, an `aria-live` announcer + reduced-motion collapse. **`@projective/ui/
kanban`** is a generic **controlled** `KanbanBoard` (+`KanbanColumn`/`KanbanCard`) — it emits
`KanbanItemMove`/`KanbanColumnMove` and NEVER mutates the model, so a consumer commits immediately or
intercepts behind a modal. The feature (10th thin/fat read) is `BoardService`→`/api/projects/board`
(thin)→`ProjectBackendService.board` (fat, fixtures derived from `ProjectDetail`, gated by the SAME
`PROJECTS_BACKEND_LIVE`), Zod SSOT **`@projective/types/projects/board`** (`TicketStatus`, `BoardCard`,
`BoardColumn`, `BoardView`, `BoardPage`, `CreateTicket`, the shared `cardColumnId`/`buildBoardColumns`).
**Two boards, one contract:** the project pipeline `/projects/[id]/board` (columns = New + each Stage +
Completed; stage columns reorder → confirm modal; New/Completed frozen; a Stages⁄Status view toggle)
and the stage Tasks board `/projects/[id]/[channel]/tasks` (columns = ticket-status lanes, fixed;
create in New only). Moves are OPTIMISTIC (persistence deferred); three pre-move warnings gate the
irreversible side-effects — stage reorder (workflow sequence), claimed-ticket move (full charge/escrow
payout), and revision (moving into a completed stage → active revision ticket). The 2-panel ticket
modal enforces the **purchasing gate** (Title creates a draft; a Description is required before
purchase/claim) with a checkbox + drag-reorder stage selector (reuses `dnd`) and per-stage overrides;
the footer rig (`boardFooterFor`) hosts Kanban⁄List · Stages⁄Status · Create Ticket · Create Stage · Add
to Basket/Checkout, bridged to the body via `board-state.ts` signals. `CreateStageModal` extended
additively (Title + rich Description, `BodyPortal`-wrapped; `onCreate` broadened to `{name,description}`
— the one ProjectSidebar caller updated). Toolbar mirrors `/files` (search · Priority · Assignee ·
Sort). No DB migration (a read projection over the live `projects.tickets`/`project_stages` +
`move_ticket`/`reorder_stages` RPCs). **Flagged (surface, do not silently resolve):** the task brief's
stage-board column names **New / Ready / In Progress / Review / Completed** are a THIRD vocabulary that
matches neither canonical source cleanly — reconciled here as the canonical `ticket_status` enum as the
DATA model (New=`backlog`, Ready=`todo`, In Progress=`in_progress`[+`claimed` folded], Review=
`in_review`, Completed=`completed`; `cancelled`/`reported_hidden` are card OVERLAYS, not columns) with
brief DISPLAY labels; `New` is canonically the backlog column (PRODUCT_SPEC §Ticket Ordering), `Ready`↔
`todo` is the ambiguous relabel — confirm with a human. Also flagged: PRODUCT_MANAGEMENT §6 lists the
BUILD-TRACKER's Kanban columns (Backlog·Ready·Claimed·In Progress·Review·Complete), which are NOT the
product `ticket_status` board columns — a §6 clarifying note was added in the same change. | root
CLAUDE.md §5 · `PRODUCT_MANAGEMENT.md` §6 · `DESIGN_SYSTEM.md` §C.1 · `packages/ui/{dnd,kanban}/` ·
`packages/types/projects/board.ts` · `packages/backend/services/projects/board-fixtures.ts` ·
`apps/web/routes/api/projects/board.ts` · `apps/web/features/projects/{islands/{ProjectBoard,
BoardViewControlRig}.island,components/{TicketCard,BoardColumnHeader,TicketModal,BoardWarnings,
TicketListView,CreateStageModal,board-glyphs},core/{board-model,BoardService,board-ssr,board-state,
board-footer-slot}}` · `apps/web/routes/(dashboard)/projects/[projectId]/{board,[channelId]/tasks}.tsx` ·
Decisions #10 / #21 / #32 / #33 |

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
