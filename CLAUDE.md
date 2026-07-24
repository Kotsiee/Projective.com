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

| 55 | **Wallet & Finance frontend surface — `/wallet` (2026-07-24).** The 14th thin-frontend/fat-backend
read AND the finance domain's first WRITE surface: the context-scoped Wallet — a calm Overview hub +
deep pages (`/wallet/{transactions,activity,payouts,funding,methods,invoices,access}`) +
BodyPortal action modals — over the finance Zod SSOT (`@projective/types/finance`, Decision #54).
Thin `WalletService` → `apiFetch` → `/api/wallet/*` (thin routes = HTTP+Zod+guard, NO server
capability gate) → fat **`WalletBackendService`** (`@server/services/finance/`) → `ServiceResult<T>`,
gated by the NEW **`FINANCE_BACKEND_LIVE`** (default off, `isFinanceBackendLive()`). **ALL money math
is server-side** (`wallet-fixtures.ts`): the three-state balance projection, the
5%-fee→vault-cut→template→remainder-to-vault team split (finance-model §5), FX conversion + `Intl`
formatting, the KYC gate — the client only renders the returned `MoneyView`s (never computes a
balance/split/fee/conversion). Added to the SSOT (never inlined): **`packages/types/finance/wallet.ts`**
(`MoneyView` + the read projections `WalletOverview`/`WalletSwitcher`/`TransactionPage`/`ActivityView`/
`PayoutsView`/`FundingView`/`MethodsView`/`InvoicesView`/`AccessView` + the action inputs + the pure
`formatMoney`/`capabilitiesForRole`/`walletVariant` helpers + the `WalletQuery`/`WalletSim` read shapes).
**The wallet is the finance face of the active context** (Decisions #16/#17): a personal wallet, a
team/business/organisation vault (same route, `?w=scope:id` switcher override), or a read-only **"All
accounts"** aggregate rollup; three overview faces (personal freelancer/client · team split · business
burn-down). Fixtures DERIVE a coherent finance world from the SAME cast as the rest of the app
(`nav-fixtures` `northwind`/`atlas-collective`/`monarch-labs`/`verdant-studio`, fixed clock, unsigned
`>>>` hash, TDZ-safe) + a mutable session STORE so top-up/withdraw/transfer/distribute/fund-escrow/
recurring/method/payout/spend-request/smoother-enrol are exercisable — **no DB migration** (a
read+write projection over fixtures; the RLS-scoped `finance.*` tables + money functions are the
deferred live path, slotting in behind the same gate with zero shape churn). **Reuse (relentless):**
the lane (`WalletLane` + collapsed `WalletRail`, `.ui-splitter[data-mode]`) from the shared
`@projective/ui/navigation` LaneChrome; the Transactions ledger from the Files
`FileTable`/`useVirtualScroll`/`ZoomSlider` (footer View Control Rig via `walletFooterFor`,
`LocalKeys.WALLET_ZOOM`/`WALLET_COLUMNS`); the modals from `Dialog`+`BodyPortal`+`InputNumber`; the
Income Smoother/verification-lock states; charts hand-rolled + `d3-scale`/`d3-shape` inline SVG
**app-side** (Decision #1 tier-1; kept OUT of `packages/ui` per its no-deps portability contract → **no
new `@projective/ui` primitive → no `DESIGN_SYSTEM.md` §C.1 change**). **RtL:** CSS logical properties
ONLY — verified the whole surface mirrors to the opposite edge under `dir="rtl"` with zero horizontal
leak. **Dev Context Switcher parity (§5 merge gate):** SIX new axes — vault role (Owner/Admin/PM/member)
· KYC state (verified/unverified/payout-not-set-up) · Income-Smoother state · fund-state mix · display
currency · layout direction (ltr/rtl/auto) — added across `dev-seam.ts` (READ contract) +
`dev-context.ts` (`DevOverrides`+`DEV_DEFAULTS`+`DevOption`+`reflect()` set/delete, incl. `root.dir`) +
`DevContextPanel` (a "Wallet / Finance" control group); each drives a LIVE server refetch (the island
passes them as query params — the server never sees the client seam). Lane + footer resolved by
`walletLaneFor`/`walletFooterFor` in `(dashboard)/_layout.tsx`. Verified end-to-end (personal/team/
business faces from context, three-state balances, all deep pages, d3 charts, the KYC lock, all six
axes incl. £→€ conversion + RtL mirror, the write path top-up, guest bounce). **Flagged (surface, do
not silently resolve):** (a) the account switcher is a WALLET-local control (personal · vaults ·
aggregate), NOT unified with the header context switcher — reconcile whether switching a wallet should
re-stamp the active context; (b) **FX spread / conversion-fee economics remain OPEN** (finance-model
§11) — the surface displays origin amount + converted amount + rate only, never a fabricated fee; (c)
the **Instant Payout fee magnitude is TBD** platform-wide — disclosed as "a small fee applies", never a
%; (d) the RtL document `dir` is currently driven by the dev axis over a shell-root LtR default — the
REAL `org.user_preferences.layout_direction`-driven `dir` at the shell root is a small additive TODO
(the pref isn't in the chrome JWT); (e) member / counterparty links follow the canonical `/@handle`
(Decision #3), not `/profiles/[id]`. | `SYSTEM_ARCHITECTURE.md` §Backend Services ·
`packages/types/finance/wallet.ts` · `packages/backend/services/finance/` ·
`packages/backend/core/{env,supabase}.ts` · `apps/web/features/wallet/` ·
`apps/web/routes/(dashboard)/wallet/*` · `apps/web/routes/api/wallet/*` ·
`apps/web/routes/(dashboard)/_layout.tsx` · `apps/web/utils/{dev-seam,storage-keys}.ts` ·
`apps/web/features/devtools/` · Decisions #1 / #10 / #16 / #32 / #37 / #48 / #53 / #54 |

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
- [ ] Any new/changed simulatable axis mirrored in the Dev Context Switcher (`features/devtools/`) —
      `DevOverrides` field, `DevOption` list, panel control, and `reflect()` `data-dev-*` write
      (§5).
- [ ] `XXXX-XXXX` placeholders; RLS-aware queries.
- [ ] JSDoc + regions present; no meta-comments.
- [ ] Consistent with the §8 Resolved Decisions; any **new** cross-doc conflict is flagged + logged,
      not silently resolved.
- [ ] No page/business logic added before the foundational doc + package layer is in place.
