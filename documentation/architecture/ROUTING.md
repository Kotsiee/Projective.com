# Routing & Folder Conventions (`apps/web`)

> Companion to [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) §2 and the sitemap in
> [`../business/PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) §Sitemap. Fresh 2.x (Vite) file-based
> routing. This documents the skeleton that lives under `apps/web/routes/`.

## Route groups (URL-transparent)

Parenthesized folders group routes **without** adding a URL segment:

| Group                     | Purpose                                                                                      | Auth        |
| :------------------------ | :------------------------------------------------------------------------------------------- | :---------- |
| `routes/(public)/`        | Marketing + auth (landing, about, explore, help, view, login/join/…)                         | none        |
| `routes/(public)/(auth)/` | Auth sub-group (own chrome later)                                                            | none        |
| `routes/(dashboard)/`     | Authenticated app (home, projects, businesses, teams, messages, wallet, settings, services, …) | **guarded** |
| `routes/[handle]/`        | Public profile namespace — users, teams, corporations by `@handle`. Every top-level segment the other groups serve is a reserved handle (the namespace guard, §Reserved-handle precedence) | none        |
| `routes/(standalone)/`    | Shell-free pages — today only the file inspector (`/inspect/:fileId`). **No `_layout.tsx`**: only `_app.tsx` wraps them (tokens, a11y, DevMount), so no `UserShell`/`GuestShell` renders (Decision #161(C)) | none (session renewed) |

## Special files

- `routes/_app.tsx` — root `<html>` shell + pre-paint theme + corner-curve app frame. It writes the
  `<head>` from request state: `state.title`, `state.description`, and — for a public page whose
  handler called `applyPageMeta(ctx.state, pageMeta({…, origin: ctx.url.origin}))`
  (`features/marketing/core/seo.ts`) — `state.meta`'s canonical link, robots, Open Graph block and
  Twitter card. Structured data is not head state: a page renders `<JsonLd graph={…} />`
  (`features/marketing/components/JsonLd.tsx`).
- `routes/_middleware.ts` — global security headers (no auth).
- `routes/_error.tsx` — the root error route for every uncaught `HttpError` or exception. A 404
  renders "This page doesn’t exist", a 5xx renders "Something went wrong" and is recorded through
  `LogBackendService.recordServerError` (the console with its stack, plus an `ops.log_entries` row
  when `LOGGING_BACKEND_LIVE` is on). It renders inside `_app` only, with no group shell. Under
  `/api/*` it answers the JSON failure envelope `{ ok: false, message }` instead of a page.
- Telemetry beacons, all `POST`, guest-reachable, written to with `navigator.sendBeacon`:
  `/api/logs` (the logger's production `warn`/`error` batches), `/api/logs/vitals` (one page view's
  CLS · LCP · INP from the shell's `WebVitalsBridge`) and `/api/explore/events` (the
  `ImpressionTracker`'s `discovery.*` batches). See SYSTEM_ARCHITECTURE §Discovery telemetry.
- `/api/explore/views` — `POST { id }`, SIGNED-IN only (a guest gets 401): the results drawer's
  in-place open, recorded as a view by a background beacon (`ExploreService.recordView`). A page a
  reader navigates to — `/view/[entity]`, `/[handle]/view/[item]`, `/[handle]` — records itself
  server-side instead. `/explore` renews a lapsed session in its handler (the `[handle]` model) because
  its Home feed is personalised. See SYSTEM_ARCHITECTURE §Discovery (Explore) services, Decision #178.
- `routes/_middleware.ts` — stamps `isAuthenticated` / `userContext` on every request from the
  `sb-access-token` cookie only once it **verifies** (`session.ts` `resolveRequestViewer` →
  `AuthBackendService.verifyAccessToken`: signature against the project JWKS or the HS256
  `SUPABASE_JWT_SECRET`, expiry, `sub` + `aud: authenticated`; local, cached keys, Decision #205). A
  tampered or expired cookie is a guest here; it never renews.
- `routes/(dashboard)/_middleware.ts` — **auth guard**: a verified access token passes; an invalid
  or expired one with a refresh cookie renews in place; with none it is cleared and sent to
  `/login?redirectTo=`; unobtainable signing keys or an unreachable GoTrue answer `503` with the
  cookies kept.
- `routes/(public)/(auth)/_middleware.ts` — the **inverse guard**: a visitor with a VALID session on
  `/login` or `/join` is returned to their captured `redirectTo` (or `/home`) instead of being asked
  to authenticate again or walked back through onboarding. A tampered or expired cookie is not
  bounced, so no loop forms with the guard above (`safeRedirect` also refuses auth paths).
  `/join?oauth=…` is exempt — the OAuth callback signs a NEW identity in and then sends them there
  to create their profile.
- `routes/(standalone)/_middleware.ts` — renews the session without redirecting (the
  `[handle]/_middleware.ts` model: `ensureSession`, then `accessToken`, `isAuthenticated` and a
  refreshed `userContext`, and the set/clear cookies appended to the response), so an expired access
  token does not read a signed-in viewer as anonymous. Never a guard: a guest and a share-link holder
  pass, and the page's own read decides what they see.
- `_layout.tsx` per group — shell chrome; `(dashboard)` mounts the dual-nav + Splitter. `(standalone)`
  deliberately has none — the only route group that renders no shell at all (Decision #161(C)).
- `(public)/_layout.tsx` resolves the public shell by auth state — `GuestShell` for a guest,
  `UserShell` for a signed-in visitor — with two path exemptions, checked in order:
  - `AUTH_PATHS` (`/join`, `/login`, `/forgot-password`, `/verify`) render bare; the auth screens
    own their full-window chrome.
  - `LANDING_PATHS` (`/`, `/features`) render in **`LandingShell`**
    (`features/landing/components/LandingShell.tsx`) for guests **and** signed-in visitors alike —
    never a redirect; `/home` is untouched (Decision #284 (8)). The shell is the landing's
    off-system canvas (`.lp-root`, Decision #280): a skip link to `#main-content`
    (`PAGE_CANVAS_MAIN_ID`, Decision #285 (C)), its own header bar (the "Main" links, the theme
    control, then "Sign in" + "Get started" for a guest or "Open app" → `/home` for a signed-in
    visitor; below 768px a menu sheet), the `<main id="main-content">`, and the unchanged
    `PublicFooter` (Decision #13) rendered after `.lp-root`, outside it (#285 (B)). Also mounted for
    these paths, outside `.lp-root`, for a signed-in visitor only: `LazyChatHost`
    (`features/landing/islands/`), which renders nothing and loads the global `ChatPopoutHost` only
    once the tab has a floating chat open (its `sessionStorage` state, or `openPopout` on the page),
    so a chat opened elsewhere stays open on the landing without the host's weight on every landing
    view (Decision #286 (A)). No ticket host is mounted: the landing routes strip a `?tkv=` on the
    server with a `303` before they render (below). **Not mounted** there, against the
    shell a path would otherwise get: `SiteHeader` and its search, `ShareHost` and the guest aside
    (GuestShell); the sidebar, middle nav, `NavSearchBar`, bottom nav, `ShareHost`,
    `SettingsModalHost` (so `?settings=` opens nothing on `/`) and `MilestoneCelebration`
    (UserShell). The bar's links are the ones whose destination exists
    (`features/landing/core/header.ts`): "How it works" (`/#how-it-works`), "Explore" (from
    1024px), "Pricing" (`/#pricing`) and, since L5, "Features" (`/features`); the anchors are
    written from `/`, so they work from `/features` too, and the link to the page being viewed
    carries `aria-current="page"` (on `/features`, "Features"; on `/`, none).

## Dynamic segments (examples in the skeleton)

| Pattern                 | File                                                         | URL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| :---------------------- | :----------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| projects feed           | `projects/index.tsx`                                           | `/projects` — the **portfolio index**: every project in the acting workspace, `?status=` filtering it, and the landing every bounced engagement URL is sent to (a `?notice=` flash, `ProjectNoticeHost`). **`/projects?create=1`** opens the project **Quick-Init modal**, the only project-create surface: the lane island (`ProjectsLane`) reads the marker on load, strips it with `replaceState` (an instruction, not feed state, so a reload or Back never reopens it) and opens the modal. Its entry points: the header **Create menu**'s Create Project and the mobile **BottomNav**'s Create (one constant, `PROJECT_CREATE_HREF` in `features/shell/core/actions-model.ts`, re-exported as `BOTTOM_NAV_CREATE_HREF`; Decisions #295, #296 (B)), the **site footer**'s "Post a new project" / "Post your first project" (`POST_PROJECT_HREF`), the portfolio's empty-state action and the member CTAs on `/about` and the articles. A guest is sent to sign in and returned here. There is no `/projects/new` (it would fall into `[projectSlug]`) and no `/create`. |
| workspace: Overview     | `projects/[projectSlug]/index.tsx`                             | `/projects/:projectSlug` — the engagement's **Overview** (Decision #144): the command center for its owner and every participant — Needs you · Brief · Inclusions & terms · Project files · the stage run · updates, with an aside of the participant's own work, Messages and People (Decision #163), composed by `ProjectBackendService.workspace`. The root DISPATCHES on access × lifecycle (`landingFor`, `@projective/types/projects`): the owner of a published project and every participant → the Overview; the owner's **draft** → `303` `/details`; a **prospect** → `303` the public listing `/view/:projectSlug?type=projects` (a prospect on a draft → `303` `/projects?notice=project-not-found`). Access (`viewerAccess`: owner · participant · prospect) is derived server-side from `projects.has_project_access`. Every exit is a `303`, never a cacheable `308`, because each depends on who is asking and on the project's state. |
| workspace guard         | `projects/[projectSlug]/_middleware.ts`                        | Every `/projects/:projectSlug/**` path except `/preview` (which guards itself): a **prospect** is sent to the public listing (`GET`/`HEAD` only; a draft answers "does not exist"), and everyone else passes with their access memoised on `ctx.state.projectAccess` — read by the page and by both band resolvers, so the three cannot disagree — and a default tab title ("Board · <project> · Projective"). In development only, the Dev Context Switcher's `pj.dev.landing` cookie may simulate the access and the status (Decision #144(G)). |
| workspace: Details      | `projects/[projectSlug]/details.tsx`                           | `/projects/:projectSlug/details` — the engagement's **configuration**: the setup surface, its progress ladder in the middle-nav header band (once published, the outstanding fixes in words, "3 stages need a price"), its actions in the footer band. Review authority only — the owner or an active member of the paying client business (`projects.can_review_project`, mirrored as `ResolvedProjectAccess.canConfigure`, Decision #163); anyone else gets a `303` to the Overview. Paired with Preview as the header band's `Details ⇄ Preview` modes (see the rule below). |
| project create → list   | `projects/create.tsx`                                        | `/projects/create` **308→** `/projects` (retired). Project creation is a **Quick-Init modal on `/projects`**, not a page. The file stays as a redirect shim rather than being deleted: without it the segment falls through to `[projectSlug]` and renders "project not found", which is a dead end reachable from every old link and bookmark, not a redirect.                                                                                                                                                                                                                                                                |
| workspace: Preview      | `projects/[projectSlug]/preview.tsx`                           | `/projects/:projectSlug/preview` — the brief exactly as a freelancer evaluates it on `/view/:id?type=projects` — the same `EntityViewPage` in `mode="preview"`, composed from the owner's own rows (drafts included) by `ExploreBackendService.projectPreviewPage`, minus the recommendation rails and reviews, with a one-line preview notice and the applicant's actions described rather than offered (Decision #142). Guarded server-side: signed in, then review authority (the owner or an active client-business member, `canConfigure` — Decision #163); a **draft** must also have finished its required setup steps (`previewReady`), while a **published** project always previews — its listing is already public (`previewAllowed`, Decision #144). Anyone without review authority gets a `303` to `/projects/:projectSlug`, whose own dispatch places them (before Decision #163 a non-owner was sent to the public listing); a reviewer who may not preview yet gets a `303` to `/details`. The tab that leads here renders locked until then, and a control disabled in the interface but open at its URL is a gate that only holds for people who did not type the address. |
| project edit → details  | `projects/[projectSlug]/edit.tsx`                              | `/projects/:projectSlug/edit` **308→** `/projects/:projectSlug/details` (retired). "Edit" meant the editor, which lives at `/details` since Decision #144; the file stays so a bookmark or an old notification link still lands on it.                                                                                                                                                                                                                                                                                                                                                                                     |
| project settings → details | `projects/[projectSlug]/settings.tsx`                       | `/projects/:projectSlug/settings` **308→** `/projects/:projectSlug/details` — the word people guess for the configuration. Without this static route the segment fell through to `[channelId]` and rendered an empty room with a working composer.                                                                                                                                                                                                                                                                                                                                                                              |
| nested `[id]`           | `projects/[projectSlug]/[channelId]/index.tsx`                 | `/projects/:projectSlug/:channelId`. A ref that names no room this viewer can enter (the rule `resolveChannelMeta` titles the header band with) is a `303` to the engagement's Overview with `?notice=room-not-found` (`[channelId]/_middleware.ts` → `core/room-guard.ts`), never an empty room.                                                                                                                                                                                                                                                                                                                            |
| files (project)         | `projects/[projectSlug]/files.tsx`                             | `/projects/:projectSlug/files` (File Explorer: All files · the client's Project files · channels; a Task drops the Channels header)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| files (channel)         | `projects/[projectSlug]/[channelId]/files.tsx`                 | `/projects/:projectSlug/:channelId/files` (File Explorer, one channel)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| attachments → files     | `projects/[projectSlug]/attachments.tsx` (+ nested)            | `/…/attachments` **308→** `/…/files` (legacy)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| submissions (project)   | `projects/[projectSlug]/submissions/[...path].tsx`             | `/projects/:projectSlug/submissions/*` (Submissions ledger; Stages as tree roots; wildcard tree path)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| submissions (channel)   | `projects/[projectSlug]/[channelId]/submissions/[...path].tsx` | `/projects/:projectSlug/:channelId/submissions/*` (channel submissions; wildcard tree path)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| calendar (project)      | `projects/[projectSlug]/calendar.tsx`                          | `/projects/:projectSlug/calendar` (Calendar & Schedule — whole engagement; **303 → the project on a Task**)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| calendar (channel)      | `projects/[projectSlug]/[channelId]/calendar.tsx`              | `/projects/:projectSlug/:channelId/calendar` (channel/stage schedule; a stage channel scopes to that stage; **303 → the room on a Task**)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| timeline (project)      | `projects/[projectSlug]/timeline.tsx`                          | `/projects/:projectSlug/timeline` (Timeline / Gantt — one lane per stage, the stage's scheduled window + every dated ticket, dependency links; a ONE-OFF engagement's "board" view link lands here. A projection over the board read, so a bar and a card cannot disagree about a date; root `CLAUDE.md` §8 Decision #91; **303 → the project on a Task**) |
| timeline (channel)      | `projects/[projectSlug]/[channelId]/timeline.tsx`              | `/projects/:projectSlug/:channelId/timeline` (one stage's Gantt — the stage's window, then one lane per ticket; the channel header's **Timeline** tab, gated exactly like Tasks; **303 → the room on a Task**) |
| calendar hub (personal) | `(dashboard)/calendar/index.tsx`                             | `/calendar` (the acting account's own agenda — the UNION of the two rows above across every engagement, over its own working hours, call windows and booked leave. The body is the grid alone; the lane and both bands are resolved per-URL by `features/calendar/core/calendar-slots.tsx`. Read by `GET /api/scheduling/personal`, which is signed-in only and takes NO scope parameter: "whose calendar" is answered by the session, never by the caller). `?event=<event id>` opens that occurrence's modal on its week when it is on the agenda (the hand-off other surfaces link to, e.g. the catalogue client drawer, Decision #218(a)); closing the modal drops the parameter with `replaceState`                                                                                                                                                                  |
| files hub (root)        | `(dashboard)/files/index.tsx`                                | `/files` (personal/entity asset library — re-exports the wildcard below, so the root and a deep folder resolve through ONE code path)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| files hub (deep)        | `(dashboard)/files/[...path].tsx`                            | `/files/*` (any folder, at any depth — a real, deep-linkable, shareable URL the tree, the breadcrumbs and the address bar all address identically; each segment is percent-encoded INDEPENDENTLY, so a folder literally named `a/b` never reads back as the pair `["a","b"]`)                                                                                                                                                                                                                                                                                                                                                |
| catalogue console       | `(dashboard)/catalogue/index.tsx`                            | `/catalogue` (the seller console, plan §3.1 of `flows/CATALOGUE_REBUILD.md`; re-exports `features/catalogue/routes/console.tsx`). Every screen state is in the URL through the pure contract in `@projective/types/catalogue/url.ts` — `?view=listings\|analytics\|clients`, `?type=`, the multi-select facets `?status=` · `?model=<delivery slug>` · `?category=<CREATE category>` (comma lists; `status` defaults to draft · published · paused and is then omitted, Decision #221), `?search=`, `?sort=` / `?dir=`, `?period=`, `?scope=`, `?client=@handle` (the client drawer, `view=clients` only: choosing a row pushes it, Close drops it with `replaceState` and returns focus to the row), and `?create=1\|product\|service[:<model>]`, which opens the Quick-Init modal. The islands write it with `pushState` / `replaceState` and follow `popstate`. A `?scope=` naming one listing (`svc-…` / `prd-…`) is a `303` to that listing's workspace tab (Decision #217(l)) |
| catalogue workspace     | `(dashboard)/catalogue/[id].tsx`                             | `/catalogue/:slug` (one listing's workspace, plan §3.2; re-exports `features/catalogue/routes/workspace.tsx`, whose handler lives in `workspace-handler.ts`). `:slug` is the listing's `svc-…` / `prd-…` address, the same one `/view/:slug` uses; anything else is the `303` in the row below, a listing that is not the caller's a `303` to `/catalogue`, and a read that failed a `503` that says so. The tab, Edit section, preview device, window and chosen buyer are in the URL — `?tab=edit\|preview\|analytics\|clients`, `?section=<edit section>` (the scroll-spy replaces it; on load the section is scrolled to and its heading focused), `?device=`, `?period=`, `?client=@handle` — through `parseWorkspaceUrl` / `workspaceHref`. A tab switch is a `pushState`, so Back returns to the previous tab |
| catalogue buyer simulation | `(dashboard)/catalogue/[id]/simulate.tsx`                 | `/catalogue/:slug/simulate` (the owner's buyer simulation, Decision #217 (j); re-exports `features/catalogue/routes/simulate.tsx`, handler in `simulate-handler.ts`). The real `EntityViewPage` in `simulation` mode, read as the OWNER (`CatalogueBackendService.previewView`, a draft included), in `bare` chrome, framed by the workspace's `?tab=preview`. A non-slug id, or a listing that is not the caller's, is a `404` (worded as a missing listing); an unreachable marketplace a `503`. Every answer carries the `framed` CSP (`frame-ancestors 'self'`) and `x-frame-options: SAMEORIGIN`. Its Book modal reads `GET /api/catalogue/simulate/slots`, the owner's slot grid, a read. No commit reaches the network |
| no create page          | none                                                         | `/catalogue/new` has NO route file (a contract test walks `routes/` for one): creation is the console's Quick-Init modal. The `[id]` handler checks `isListingSlug` before any read, so `/catalogue/new` (or any non-slug) is a `303` to `/catalogue?create=1` |
| stage invite link       | `(dashboard)/invite/[token].tsx`                             | `/invite/:token` (where a stage invite link lands — the project, the stage, who shared it, and "Ask to join" when the link is open to this person, which files a pending request and seats nobody. Inside `(dashboard)`, so a guest signs in first and returns here via `redirectTo`; the token is shape-checked before any read; `noindex` + `no-referrer` + `no-store` because the path is a capability; Decision #145) |
| share link              | `(public)/share/[slug].tsx`                                  | `/share/:slug` (the public resolution of a read-only share link — the one files surface a stranger can reach)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| outbound-link exit      | `(public)/exit.tsx`                                          | `/exit?url=…` (the interstitial an external link from a message passes through unless its scan came back safe — names the host, the verdict and why; asks for an explicit "I understand" before an unchecked or suspicious link and never offers a blocked one; never redirects by itself; `noindex` + `no-referrer` + `no-store`; Decision #128)                                                                                                                                                                                                                                                                            |
| pricing (**Planned**)   | `(public)/pricing.tsx` → `features/pricing/routes/PricingScreen.tsx` | `/pricing` — every public plan by audience over the two payment planes (Decision #252). Guest → `GuestShell`, signed-in → `UserShell`, the same body. **Lane-less**: no `pricingLaneFor` (a lane would be a second home for a plan purchase). `pricingHeaderFor(url, authed)` — pure, synchronous, `null` off `/pricing`, chained beside `viewHeaderFor` in `(public)/_layout.tsx` — mounts the plane switcher band (audience tabs + billing cycle), which carries no figure and no purchase control. Query: see "`/pricing` query" below. Canonical link `/pricing` with no query. The handle is reserved (`packages/types/profile/reserved.ts`). |
| legal hub               | `(public)/legal/index.tsx`                                   | `/legal` — the public legal hub (Decision #270): every legal document's version in effect today, in two groups, as a plain list. Controller `features/legal/hub/routes/LegalHubScreen.tsx` (re-exported). `noindex` while every document is a draft. |
| legal document          | `(public)/legal/[slug]/index.tsx`                            | `/legal/:slug` — one legal document (`terms` · `privacy` · `cookies` · `acceptable-use` · `escrow-terms` · `ip-transfer-deed`); any other slug, and the reserved `workspace`, is a real `404`. `?v=<version>` pins a version (kept even when it is the current one, so a shared link keeps pinning); `?compare=<older>` diffs the shown version against an older one clause by clause; an unknown version is a `404` (an unknown document or version renders a not-found notice in the reading frame, `noindex`, one h1, with the current version and the hub as the ways back — Decision #296 (G)), an EMPTY parameter (the no-JavaScript form) a `303` to the clean address, `compare` equal to the shown version is dropped and a newer one swapped. The canonical is always the bare `/legal/:slug`; the page is `noindex` while its version is a draft and whenever it is pinned or compared. Resolver `features/legal/core/view.ts`; controller `features/legal/document/routes/LegalDocumentScreen.tsx` (re-exported) |
| legal document PDF      | `(public)/legal/[slug]/pdf.ts`                               | `/legal/:slug/pdf` (`?v=` optional) — that version as a PDF attachment, rendered by `LegalBackendService.documentPdf`; a content ETag (`304` on `If-None-Match`), `public, max-age=3600, must-revalidate`, `X-Robots-Tag: noindex` while a draft. Unknown slug or version → `404` |
| IP workspace            | `(dashboard)/legal/workspace/{index,audit-packs,transfers}.tsx` | `/legal/workspace` · `/legal/workspace/audit-packs` · `/legal/workspace/transfers` — the signed-in IP chain-of-title workspace, moved from the bare `/legal` by owner ruling (a) (Decision #270). In `(dashboard)`, so a guest is sent to `/login?redirectTo=…`; a static segment, so it outranks `(public)/legal/[slug]`. Not built: each renders the `PagePlaceholder` |
| contact                 | `(public)/contact.tsx`                                       | `/contact?intent=sales\|support\|dispute\|security` (default `support`; an unknown value reads as the default) — the contact intake, re-exporting `features/contact/routes/ContactPage.tsx` (Decision #276). The intent is URL state: the switcher is a row of links without JavaScript and keeps the address bar in step with `history.replaceState` once hydrated. The no-JS form road comes back here as `?sent=1` (the receipt in a ten-minute HttpOnly `pj_contact_receipt` cookie, `Path=/contact`, cleared once shown) or `?error=invalid\|rate_limited\|sign_in\|unavailable&fields=…`. Public, never cached (`private, no-store`; a signed-in reader's engagements are personal); a lapsed session is renewed in place. Its API: `POST /api/contact` (JSON from the island — only a body declared `application/json`, 415 otherwise — or a form post answered with a 303; cross-site form posts refused), `POST /api/contact/attachments/init`, `/complete` and `/discard` (Remove; signed-in only), and `POST /api/contact/cron/attachments` (the hourly sweep's bearer-only door, 404 to anything else) |
| changelog feed          | `(public)/changelog/index.tsx`                               | `/changelog` (re-exports `features/changelog/routes/feed.tsx`; Decision #278) — releases newest first, ten to a page. The query is canonical: `?category=` repeatable, in the category order, a release listed when it has ANY selected category; `?page=` from 2 (page 1 is the bare path). An unknown, repeated or upper-case category, `page=1` or a malformed page answers **308** to the canonical spelling, other parameters kept; a page past the last is a **404** notice. `?image=<v-anchor>:<n>` opens a release picture in the lightbox (pushed on open, so Back closes it; replaced while stepping; stripped on close). Page 1 and every filtered view are canonical at `/changelog`; an unfiltered page n ≥ 2 is canonical at itself (`/changelog?page=n`, titled "Changelog · page n"); anchors are `#v0-12-0` |
| changelog release       | `(public)/changelog/[version].tsx`                            | `/changelog/:version` (re-exports `features/changelog/routes/release.tsx`) — one release's canonical page; `v0.12.0` / any upper case **308→** `/changelog/0.12.0`; a version that is not semver, unknown, withdrawn or dated in the future is one **404** notice (`noindex`) |
| changelog RSS           | `(public)/changelog/rss.xml.ts`                              | `/changelog/rss.xml` (re-exports `features/changelog/routes/rss.ts`) — RSS 2.0, `application/rss+xml`, `public, max-age=900`; a failed read is a plain-text **503**, never an empty channel. The static route wins over `[version]` |
| about                   | `(public)/about.tsx`                                         | `/about` — the mission page (Decision #277; re-exports `features/marketing/about/routes/AboutPage.tsx`): live platform figures read server-side from `PublicMetricsService` (a figure below its threshold has no tile), the delivery walkthrough. Public, indexable, no query |
| features                | `(public)/features.tsx`                                      | `/features` — everything Projective does, the editorial chapter index (work order L5; `flows/LANDING.md` §2.5, §2.6, §4.12). In `LANDING_PATHS`, so it renders in `LandingShell` for guests and signed-in visitors alike. Thin: a `?tkv=` is answered first with a `303` to the same address without it (`tkvRedirect`), then it reads the fee (`PublicMetricsService`) and the final search's terms (`ExploreBackendService.landingHero()`) and renders `features/landing/routes/FeaturesPage.tsx`; a failed read withholds its part, never the page. `?section=find-and-hire\|run-the-work\|money\|trust\|coming-soon` (case and surrounding space forgiven; any other value opens nothing) marks that chapter, which the page lands on once and focuses; every chapter is also its own anchor (`#money`), and so is every feature row (`#work-board`). Canonical `/features` with no query; public, indexable, in the sitemap. A row's "Try it" is a link to `/?demo=<id>#demo` (the dialog opens in place once hydrated) |
| feedback board          | `(public)/feedback.tsx`                                      | `/feedback` — the feedback board's own page (Decision #272; re-exports `features/feedback/routes/FeedbackPage.tsx`); its query and the `?feedback=open` drawer every other page carries are in "Feedback board" below. The footer's Feedback entry links here and, on a plain click, opens the drawer over the current page instead |
| sitemap                 | `(public)/sitemap.xml.ts`                                    | `/sitemap.xml` (re-exports `features/marketing/routes/sitemap.ts`; Decision #279) — a sitemaps.org `<urlset>` on the site's public origin (`siteOrigin`): `/`, `/features`, `/explore`, `/about`, `/contact`, `/feedback`, the help hub, every category with a visible article and every visible article (canonical `/help/<category>/<article>`), `/changelog` and every visible release, `/articles` and every visible article, and a legal document only once its version in effect is reviewed (`features/legal/core/sitemap.ts` — none today; the hub on the same rule). `lastmod` where a source dates it. `application/xml`, `public, max-age=3600`; an unreadable source is a plain-text **503** with `Retry-After`, never a partial sitemap. Pure builder `features/marketing/core/sitemap.ts` |
| robots                  | `(public)/robots.txt.ts`                                     | `/robots.txt` (re-exports `features/marketing/routes/robots.ts`; Decision #279) — one `User-agent: *` group: `Disallow` the API (`/api/`), every `(dashboard)` top-level segment and `/legal/workspace` (each as `/x$`, `/x/`, `/x?`, so a profile at `/homer` stays crawlable while `/home` does not), the owner-only `/*/edit`, and `?feedback=open` anywhere; then `Sitemap:` on the public origin. `text/plain`, `public, max-age=3600`. Pure builder `features/marketing/core/robots.ts`, whose test walks `routes/(dashboard)` so a new app segment cannot escape it. Replaces the old allow-all `static/robots.txt`, which the static-files middleware would have served first. Share links, `/exit`, the inspector and legal drafts stay crawlable on purpose — their `noindex` is only readable if a crawler may fetch them |
| file inspector          | `(standalone)/inspect/[fileId].tsx`                          | `/inspect/:fileId` (`?share=<slug>` optional) — the shell-free, full-window inspector for ONE stored file: a top bar, the canvas that suits the file (image, SVG, video, audio, PDF, code, text, Markdown, table, 3D model, Word document, font, or the unsupported fallback — `resolveViewer`, `@projective/types/files`) and a details panel. Controller `features/inspector/routes/InspectScreen.tsx` (re-exported); the handler reads `FilesBackendService.inspect` under the viewer's own read rule (`fn_can_read`, or the live share slug) and every refusal is the SAME calm `404` page, whether the file is missing, private or the link is dead. Addressed by the `files.items.id` **uuid** — an explicit exception to Decision #88 (files carry no slug; flagged in Decision #161(B)). Headers: the inspector CSP profile (`cspHeaderFor("inspector")`, Decision #161(D)), `noindex, nofollow`, `no-referrer`, `private, no-store`. Its bytes come only from `/api/media/proxy/:fileId`; `fileInspectHref(id, { share })` builds the address. |
| notifications           | `(dashboard)/notifications/index.tsx`                        | `/notifications` (`?category=` an inbox tab — `money · work · messages · schedule · discovery · account · system`, absent = All; `?view=` `unread · archived`, absent = All) — the full inbox: the header drawer's tabs and rows plus the views, keyset Load more and bulk mark-read / archive. Re-exports `features/notifications/routes/NotificationsScreen.tsx` (DESIGN_SYSTEM §D.9, Decision #173) |
| saved                   | `(dashboard)/saved/index.tsx`                                | `/saved` (`?tab=` `listings · people · projects · messages · files`, absent = All; `?collection=` `unfiled` or a collection id, absent = every collection) — everything the viewer saved, starred, favourited or followed, newest save first with "People you follow" last; un-save in place, file a bookmark into a collection, Load more. Re-exports `features/saved/routes/SavedScreen.tsx` (Decision #180). Reached from the account menu's **Saved**.|
| settings (root)         | `(dashboard)/settings/index.tsx`                             | `/settings` — the Settings hub (Decisions #151, #156): an in-page **search** over every setting, **Needs your attention** (identity check, payout account, business KYB, expired connectors, unconfirmed emails, profile steps, expired cards, a failed plan payment, a lone sign-in method, a scheduled erasure — derived from facts by `attentionItems`), the **profile completeness** tracker with one call to action, and every section as an **interactive card** (a single column on a phone, where the shell has no lane). A `?connect=` landing (the integrations callback's fallback) **303→** `/settings/integrations?connect=…`. Controller `features/settings/routes/SettingsHomeScreen.tsx` (re-exported). |
| settings (section)      | `(dashboard)/settings/[section].tsx`                         | `/settings/:section` — one console page for each `SettingsSectionKey` (`account · profile · workspaces · language · appearance · notifications · messaging · scheduling · billing`; `verification` and `integrations` keep their own static routes below and render in the same lane). An unknown section **303→** `/settings/account`. `#anchor` deep-links an entry (`/settings/appearance#contrast`). Server-rendered from `resolveSettingsSection` — the SAME read `/api/settings/:section` serves the modal. Lane: `settingsLaneFor`. |
| integrations            | `(dashboard)/settings/integrations/index.tsx`                | `/settings/integrations` (the connector console — the caller's stored authorizations, and the catalogue)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| verification            | `(dashboard)/settings/verification.tsx`                      | `/settings/verification` (**Verification & payouts** — the freelancer's Level-2 identity check through Stripe Identity, the Stripe Connect payout account a withdrawal is transferred to, and each client business's Level-3 KYB through Connect onboarding. Every wallet lock about identity or payouts links here. Stripe's hosted pages come back through `/api/finance/connect/{return,refresh}?…&back=settings` and the Identity return, which land here with a one-line notice; the page itself reads `GET /api/finance/verify/status`. Root CLAUDE.md §8 Decision #126) |
| teams roster            | `(dashboard)/teams/index.tsx`                                | `/teams` — the caller's teams (owned first), their pending invitations to teams, and the create entitlement. Read by `org.get_workspace_roster('team')`. `?view=` is the partition (`owned · member · invitations · archived`, absent = All — the canvas's TabMenu and the lane's segmented control are one state, Teams R1; the pre-R1 `?tab=` is still read, never written) and `?q=` the canvas search; both are kept in step with `replaceState`. `?notice=unavailable` (set by a console that would not resolve for the viewer) adds one dismissible `InlineNotice` above the cards — "That team isn't available to you" — and nothing about whether the team exists; the address drops the flash once it is shown. `/businesses` answers the same parameters. |
| team create             | `(dashboard)/teams/create.tsx`                               | `/teams/create` — the create flow (name + a `@handle` checked live against the ONE handle namespace); the entity is born `draft`. The roster renders with the Draft-First dialog already open, its kind fixed by the route (no kind choice on `/teams` or `/businesses/create`). |
| team console            | `(dashboard)/teams/[teamHandle]/index.tsx`                   | `/teams/:teamHandle` — the console's **Overview**. Addressed by the team's `@handle` (`org.teams.slug`), never its uuid: a uuid or a non-canonical-case handle answers **308** to it, query kept, and so does `/teams/:teamHandle/overview` (the root under a second name). A missing team, or one the viewer is not a member of, answers ONE **303** to `/teams?notice=unavailable`. |
| team console module     | `(dashboard)/teams/[teamHandle]/[module].tsx`                | `/teams/:teamHandle/:module` — one module of the console (the `ModuleKey` vocabulary of `features/workspaces/core/module-registry.tsx`). Resolved by `consoleOutcome` (`features/workspaces/core/workspace-route.tsx`) in `define.handlers`, through the pure `routeConsole` / `consoleResponse` (`features/workspaces/core/console-route.ts`) every console handler of both kinds answers with (Decision #228 (B)): a uuid or a non-canonical-case handle in `:teamHandle` answers **308** (`canonical`) to the canonical handle with the query kept — the mapping is permanent, the slug being immutable; a real module the viewer may not open **303s** (`redirect`) to the one they can, dropping `?view=` (viewer-dependent, so never cacheable); both at once answer ONE **308** straight to the module the viewer may open; `/overview` spelled out answers **308** to the console root, query kept (combined with a uuid, still ONE 308); an unregistered segment 303s to the CANONICAL console root (`missing`); a missing team or a non-member 303s once to `/teams?notice=unavailable` (`unavailable`). Every case is ONE hop: the entity is read before any redirect is chosen, so no answer bounces through `/teams/<ref>`. The lane groups the modules into hubs (Decision #306, superseding #228 (C) and #232; `NAV_HUBS` / `hubsForViewer` in the registry): **Core operations** — Overview · Projects & work · Calendar & schedule · Files & docs · Catalogue (team) / Talent (business); **Channels**; **Governance** — Roster & members (`members` · `invitations` · `roles`) · Vault & finances (`finance` · `payouts`; a business's Wallet & spending is `finance` · `spend` · `billing`) · Analytics & standing (`analytics` · `standing`); and the footer's **Settings** (`settings` · `profile` · `verification`). A hub is navigation only: every module keeps its own route and gate, and the header band draws a multi-module hub as one strip of link tabs (`hub-tabs.ts` — Roster & members is People `/members` · Invitations `/members?view=pending` · Org chart `/members?view=chart` · Roles `/roles`; `/invitations` marks the Invitations tab). The retired `messages` segment is no longer a module: it 303s to the canonical root like any unregistered segment. `/teams/:teamHandle/files` is the team's shared drive (the `files` module). A module's sub-views are `?view=`, read from one data table (`features/workspaces/core/sub-views.ts`, Teams L2): Members takes `?view=pending` (Invitations — offered only with `invite_members`) and `?view=chart` (Org chart), absent = People, on both kinds; a team's Projects takes `?view=proposals` (the applications filed for the team, awaiting an answer), absent = Active (its live engagements, with each assignee's Wᵢ, under the team's proposal allowance — Teams C5), while a business's Projects still hands off to `/projects`; a value the viewer is not offered reads as the default. The header band's tabs, the lane's context control and the footer rig's Org chart toggle switch it in place and keep the address in step with `replaceState`. `/teams/:teamHandle/settings` (`manage_settings`) is the team's Settings screen — name and visibility saved by the footer rig, Publish as the header band's commit while draft, Archive (its blockers named first) and Restore in the body (Teams C6); a business's `settings` still hands off. `/teams/:teamHandle/roles` (`manage_roles`; `/businesses/:businessHandle/roles` is the same screen over the business capability list) is the Roles screen — the `PermissionMatrix` of the presets (locked) then the custom roles, a custom role's cells saved by the footer rig's Save, New role as the header band's commit opening the role editor, each custom column's menu carrying Rename · Duplicate · Archive role (Teams C3). Membership is the DATABASE's answer — `org.get_workspace_detail` returns `forbidden` for a non-member and discloses nothing else. |
| console channels        | `(dashboard)/teams/[teamHandle]/channels/{index,[channel]}.tsx` · `businesses/[businessHandle]/channels/{index,[channel]}.tsx` | `/teams/:teamHandle/channels` · `/teams/:teamHandle/channels/:channel` and the business twins — the entity's chat channels (Decision #306), resolved by `channelOutcome` (`features/workspaces/core/channel-route.ts`) after the console's own `consoleOutcome` on the `channels` module, so a uuid or non-canonical handle **308s** (the channel kept) and a non-member **303s** to `?notice=unavailable` as on every module. `/channels` **303s** to the default channel (`general`), or renders an empty state when the entity has none. `/channels/:channel` names the channel by its slug (lowercase, digits, inner hyphens, 2–40 — `CHANNEL_NAME_PATTERN`); it renders the `/messages` chat stack (`ConversationChat`) over the channel's conversation (`WorkspaceBackendService.channelThread`), with the header band titled `# slug` over its topic and the `ChatComposer` in the footer band. An unknown or archived channel **303s** to `/channels`. A channel's slug is its address, the documented exception to opaque prefixed slugs (Decision #88), flagged on #306. |
| business roster / create / console | `(dashboard)/businesses/{index,create}.tsx` · `businesses/[businessHandle]/{index,[module]}.tsx` | `/businesses` · `/businesses/create` · `/businesses/:businessHandle` · `/businesses/:businessHandle/:module` — the buyer-side twin of the four team routes above, addressed by `org.business_profiles.slug`, answering through the same `routeConsole` (BUSINESSES_AUDIT BF40–BF42, §4.5): a uuid or non-canonical-case handle **308s** to the handle, query kept; `/businesses/:businessHandle/overview` **308s** to `/businesses/:businessHandle`; a module the viewer may not open **303s**, dropping `?view=` (both at once: ONE 308); an unregistered segment 303s to the canonical root; a missing business or a non-member — from the root AND from `[module]` — answers ONE **303** to `/businesses?notice=unavailable`, never via `/businesses/<ref>`. The lane's hubs are the team's (Decision #306), with Talent (#230 (i)) in Core operations and the Governance money hub named Wallet & spending (`finance` · `spend` · `billing`) — each capability-filtered by the same registry predicates. The Spend module's member rows are fragment targets: `/businesses/:businessHandle/spend#limit-<handle>` (`spendLimitHref`) lands on that member's limits row, scrolled into view and focused — the Members drawer's tier-5 "Edit in Spend" / "Open in Spend" (BU7, Decision #249); a fragment naming no row is ignored. |
| `[...path]`             | `(public)/help/[...path].tsx`                                | `/help` · `/help/:category` · `/help/:category/:article` — the help centre (P2; re-exports `features/help/routes/help.tsx`). One catch-all, resolved by the pure `resolveHelpPath` (`features/help/core/help-path.ts`): no segment → the hub; one segment naming a category → its page; `category/article` → the article; one segment naming an ARTICLE, an article under another category (it moved — slugs are permanent, Decision #274 (k)), or a canonical path in another case → **308** to the canonical lower-case path, query kept; anything else → 404, rendered in the help centre's own frame (inside the public shell, `noindex`, one h1, the search and the way back — Decision #296 (G)). `?q=` on any help page opens the search overlay; on the hub it is also searched server-side (the no-JavaScript road of `<form method="get" action="/help">`) and the page is `noindex`. An unreadable help centre answers a 503 page, never a 404 |
| top-level dynamic       | `[handle]/index.tsx`                                         | `/:handle` (the profile **Work** section — the index IS the default tab; `/:handle/work` 308s here). For a **team** or a **business** this is the entity's public storefront, the console being `/teams/:teamHandle` · `/businesses/:businessHandle`: while the entity is `draft`, `archived` or `invite_only` every `/:handle…` read answers **404** "Profile not found" to anyone outside it — worded exactly as an unknown handle — and a member reads the page under a notice naming the state (with a tier-4 link to the console's Settings for a `manage_settings` holder on a team — where that holder publishes a draft, an `archive_entity` holder restores it and an `edit_profile` holder changes its visibility, Teams C6; a business's link waits, Decision #244 (d)). Decided in SQL by `org.fn_profile_visible` (BP1, Decision #244; Teams P1). A team's Work roster is public facts only (preset role · since · two skills — no stake, no W_i), its Reviews its collective ones, its Standing its own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| profile tabs            | `[handle]/[tab].tsx`                                         | `/:handle/:tab` (the three non-index sections — `experience` · `reviews` · `posts`; Experience is gated to individuals. Every RETIRED segment answers **308** into its consolidated section: `services` · `products` · `projects` · `portfolio` · `teams` · `businesses` · `members` · `departments` · `about` → `/:handle`; `education` → `/:handle/experience`; `articles` → `/:handle/posts` — root CLAUDE.md §8 Decision #96)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| profile static          | `[handle]/availability.tsx`                                  | `/:handle/availability` (FULL-PAGE Availability calendar — its OWN layout, NOT the profile chrome; `_layout` special-cases the `availability` segment to a one-line identity strip + the calendar. **No profile chrome links here since Decision #96** (the availability toggle, clock and presence pip were stripped); the route stays resolvable for anyone holding its address. A static sibling wins over `[tab]`)                                                                                                                                                                                                                                                                                                                                                                                               |
| profile owner editor    | `[handle]/edit/index.tsx`                                    | `/:handle/edit` (**owner-only** — Edit Profile & Settings: collapsible inline sections mirroring the preview, the six-slot showcase grid + avatar through the File Picker’s media mode, privacy switches. The guard is in `define.handlers`: a guest → 303 `/login?redirectTo=…`, a non-owner → 303 to the profile; ownership is the DATABASE's answer (`viewer.isOwner` from `org.get_profile_view`), never the unverified chrome token) |
| profile owner availability | `[handle]/edit/availability.tsx`                          | `/:handle/edit/availability` (**owner-only**, same guard — working hours, time zone, publishing, and discovery-call terms for a seller; one save → `scheduling.save_owner_availability`) |
| profile item view       | `[handle]/view/[item]/index.tsx`                             | `/:handle/view/:id` (profile-scoped Explore item viewer; was the flat `view/[item].tsx`, now a dir to host the schedule leaf)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| profile entity schedule | `[handle]/view/[item]/schedule.tsx`                          | `/:handle/view/:id/schedule` (profile-scoped session schedule; `_layout` special-cases the `view` → `schedule` segment to a full-page calendar, bypassing the profile chrome, mirroring `availability`)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| articles index          | `(public)/articles/index.tsx`                                | `/articles` (Projective's own articles, Decision #271; re-exports `features/articles/routes/index.tsx`, handler `index-handler.ts`). `?topic=` is repeatable and any-of, `?page=` 1-based; any other spelling of the same state — an unknown or repeated topic, `page=1`, a malformed page — **308s** to the canonical one, other parameters kept; a page past the last is a 404, and nothing matching is page 1 with an empty state. Page 1 of every view, filtered or not, names `/articles` as its canonical; a later page is its own canonical (`/articles?page=2`, `/articles?topic=…&page=2`), since it lists articles no other page shows |
| article reader          | `(public)/articles/[slug].tsx`                               | `/articles/:slug` — one `editorial.articles` row on P0's document reader (re-exports `features/articles/routes/reader.tsx`, handler `reader-handler.ts`). The slug is readable and permanent (Decision #274 (k)); a wrong-case slug **308s** to its lower-case spelling; a renamed article's former slug (`editorial.articles.former_slugs` of a visible row) **308s** to the new one, query kept; and a draft, a future-dated, a retracted or an unknown article is the same 404, rendered in the reading frame (inside the public shell, `noindex`, one h1, the way back to the index — Decision #296 (G)). Member posts (`catalogue.articles`) stay at `/view/:id`; neither address redirects to the other (Decision #271) |
| entity view (public)    | `(public)/view/[entity]/index.tsx`                           | `/view/:id` (public Explore item viewer; was the flat `view/[entity].tsx`, now a dir to host the schedule leaf)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| entity schedule         | `(public)/view/[entity]/schedule.tsx`                        | `/view/:id/schedule` (session-based service schedule — recurring slots + attendee counts; reached from the Entity View "Book a session" CTA for Session-format services)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Global routing rules (canonical link shapes)

Two link shapes are **fixed platform-wide**; every route, island, and link builder must emit them.

- **User / entity profiles → `/[handle]`.** All profile links use the shortpath handle namespace
  (`/@handle`), **never** `/profile/[handle]`. This is root `CLAUDE.md` §8 **Decision #3** (the
  `@handle` entity identifier _is_ the route). Builder: `profileHref()`
  (`apps/web/features/projects/core/routing.ts`, mirrored in `explore/core/routing.ts`) — normalises
  a bare or `@`-prefixed handle to `/@handle`.
- **A profile has four sections, and one address each.** `/[handle]` is **Work** (the index),
  then `/[handle]/experience` · `/[handle]/reviews` · `/[handle]/posts`. Builder: `tabHref()`
  (`apps/web/features/profile/core/profile-model.ts`); `reviewsHref()` adds the `#profile-sections`
  anchor so a rating figure lands ON the reviews. The eleven retired segments are not 404s — the
  `[tab]` route 308s each into its consolidated section via the SSOT `LEGACY_TAB_TARGET`
  (`@projective/types/profile`), and `/[handle]/work` 308s to the bare index so one section never has
  two addresses. Do not mint a link to a retired segment; the redirect exists for the links already in
  the world (messages, bookmarks), not for new ones. Two addressable states live INSIDE the sections:
  a seller's Services row sits above the tabs at `#profile-services` (`SERVICES_ANCHOR` — the hero's
  Hire control is a real anchor to it, so it works with JavaScript off), and the Reviews stance filter
  mirrors into `/[handle]/reviews?as=freelancer|client` (`parseReviewStance`; SSR honours it, the
  island keeps it in step with `replaceState`, and anything else reads as "all").
- **`/pricing` query — Planned (Decision #252).** `?plane=individual|team|business` picks the
  audience tab (default: the acting context's audience — team → `team`, business or enterprise →
  `business`, otherwise `individual`); `?cycle=monthly|annual` the billing cycle (`annual` only
  where the audience has annual prices); `?target=<public plan code>` emphasises one plan and
  implies its plane (`/pricing?target=team_pro&cycle=annual` opens the Team tab on Pro Team). One
  Zod `PricingQuerySchema` parses all three; an unknown value is dropped from the address with
  `replaceState`, never answered with an error. `target` points; it never selects or charges. Every
  upgrade prompt builds its link with one helper, `pricingHref(target, cycle?)` — today's allowance
  meter link to `/settings/billing` moves to it (SUBSCRIPTIONS_BUILD_PROMPTS S5).
- **`/[handle]?add=1` opens a seller's Add-to-project picker on arrival.** A signed-in visitor of a
  freelancer or team profile lands with the hero's Add-to-project popover open — the business bench's
  Add to project (the Talent module's re-hire, Decision #241) links here so there is one picker. The
  marker is an instruction, not page state: `ProfileHero` strips it on read (`replaceState`), and it
  opens nothing for a guest, a restricted account or the owner's preview.
- **The Explore tree has one Back, and it is not `history.back()`.** `/explore` (with its query),
  `/view/[id]` and every page under a `/@handle` form one discovery tree, and the contextual Back
  control on a profile or a listing (`features/explore/islands/ExploreBackNav.island.tsx`) walks a
  **session-scoped stack** of the visitor's own visits to it (`features/explore/core/explore-history.ts`,
  key `SessionKeys.EXPLORE_HISTORY`): the previous page of the tree, **`pathname + search`**, so a
  filtered search comes back with its filters; `/explore` when nothing eligible is beneath, or when
  the page before was outside the tree (an excursion records a BREAK marker, never a cleared stack —
  the browser's own Back may land on the page before the excursion, whose chain is still intact). A
  global tracker island (`_app.tsx`) records every page once; a page that re-writes its own URL in
  place (`/explore` refining a filter, the Reviews stance switch) is re-recorded at `pagehide`.
  Arrivals are told apart by the browser's navigation TYPE: a `back_forward` arrival (or the
  control's own pop, marked in `SessionKeys.EXPLORE_HISTORY_POP`) walks the stack back to the entry;
  a forward link pushes, even to a page visited earlier. The control is a real anchor to the SSR
  fallback (`backHrefFor` — Explore, or the profile a listing sits under) until hydration, so
  middle-click and open-in-new-tab always work; its visible word is always "Back" and the
  destination is its accessible name. When the browser's own previous history entry IS the target
  (the Navigation API says so exactly; the referrer is deliberately NOT used as a proxy, because the
  ticket deep link pushes entries on top of the page it opens on) it leaves through
  `history.back()` and the page returns from the back-forward cache as it was left; otherwise a real
  navigation. Do not mint a second back-link builder: `backHrefFor` is the fallback, the stack is
  the answer.
- **Another entity's profile is Explore's territory in the navigation.** The rail and the phone's
  bottom bar light **Explore** on `/explore`, on `/view/[id]`, and on a `/[handle]` the acting
  context does not own (`features/shell/core/explore-surface.ts` — one predicate for both bars,
  decided on the chrome context's `handle`); the viewer's own profile lights nothing.
- **The engagement has three addresses of its own, and each is a URL** (Decision #144).
  `/projects/:projectSlug` is the **Overview** (the command center for the owner and every
  participant), `/projects/:projectSlug/details` is **Details** (the configuration) and
  `/projects/:projectSlug/preview` is **Preview** (the live public/buyer view). Details and Preview
  are review authority's two modes (the owner or an active client-business member; owner only before
  Decision #163): the `Details ⇄ Preview` control in their middle-nav header band is a
  pair of real `<a href>` anchors carrying `aria-current="page"`, and the active mode is resolved
  **server-side** from the path by `modeOf()` in
  `apps/web/features/projects/core/project-header-slot.tsx` — never from island state, and never from
  a signal. The Overview is not a third mode: its header band links Details and Preview as plain
  links, and its lane entry is the top tier's **Overview** (absent on the owner's draft, whose root
  forwards to Details). **No lane carries a Details view link — a Task included** (Decision #163
  reverses the Task half of #121's view-link rule): the way into the configuration on every type is
  the lane footer's icon-only **Edit project** control (and the collapsed rail's), drawn for review
  authority only and filled while `/details` is open.

  This is a rule rather than an implementation note, because the alternative is the thing that keeps
  being reached for. A mode held in a signal has no address: it cannot be linked, cannot be opened in
  a second tab, does not survive a reload, and — decisively here — **cannot be guarded**. Preview is
  owner-only and additionally gated on the setup ladder being complete, and both refusals are 303s
  issued in `define.handlers` before the page renders. A tab that only flipped client state would
  leave that gate holding for people who click and not for people who type the URL, which is the
  §3 gate-11 failure the whole surface is built to avoid.

  It also means the band paints correctly in the first byte: the resolver is a pure function of the
  URL plus the acting context, so the right mode is server-rendered with no client-context flash.

- **A project is addressed by its prefixed slug, and by nothing else.** `:projectSlug` in every
  `/projects/**` route is `projects.projects.slug` — a minted, opaque `prj-` address
  (`/projects/prj-yfn996wztc`). The row's **uuid does not route**, and neither does any older
  title-derived form; both 404. The format lives in `@projective/types/slugs` and the projects
  domain's guard over it is `isProjectSlug()`
  (`packages/backend/services/projects/project-identity.ts`).

  This replaces an earlier uuid-first rule (root `CLAUDE.md` §8 **Decision #88**). A title-derived
  slug was not an address — it moved the first time an owner edited the title, and every link built
  on it died at that edit — but a raw uuid says nothing about what it addresses, so a segment pasted
  into the wrong route resolved against the wrong table with no shape to refuse it. A minted slug is
  derived from nothing, so it is immutable across every future edit, and its prefix makes a
  mis-addressed link refusable before it costs a query.

  ⚠️ Resolvers must **test the shape first**. `projects.projects.slug` was once CHECKed as
  `^[a-z0-9-]{1,96}$`, which a lowercase uuid satisfies — so `.eq("slug", "<uuid>")` was a valid
  query matching nothing, forever, with no error to log. The CHECK is now `^prj-[…]{10}$` so the two
  namespaces cannot overlap; a malformed segment is a 404 before a round trip, never a thrown
  `22P02`.

- **A team or business console is addressed by its `@handle`.** `:teamHandle` / `:businessHandle`
  is `org.teams.slug` / `org.business_profiles.slug` — the entity's handle in the ONE namespace it
  shares with people and enterprises (`org.fn_handle_refusal`), so `/teams/north-loop` and
  `/@north-loop` name the same entity — the console and the public storefront: members only and
  capability-gated there; anyone (while it is active and public or unlisted) here, with the
  storefront's "Manage team" / "Manage business" link the one door between them, rendered for an
  `edit_profile` holder (Teams P1, BP1). Builder: `workspaceHref(kind, handle, module?)`
  (`@projective/types/workspace`; the `overview` module is the bare console URL). The row's uuid does
  not route; `org.get_workspace_detail` accepts a uuid only so a WRITE (which knows the id) can re-read
  the console it changed. The plural `/businesses` is canonical (Decision #61). The wallet deep link
  `/wallet?w=team:{id}` is a page-local VIEW filter, not a context switch — the acting context changes
  only through `POST /api/context/switch`.

- **The wallet is four pages over one set of query parameters.** `/wallet` is the overview (the
  command centre, Decision #122); `/wallet/transactions`, `/wallet/analytics` and `/wallet/invoices`
  are pages of their own (Decision #124), every one rendered by the same `WalletHome` island so the
  dialogs the lane opens are hosted wherever the reader is. Their state lives in the query string:
  `?w=scope:id` selects which wallet is shown (a view filter, never a context switch — builders
  `walletHref()` and `walletPageHref()` in `apps/web/features/wallet/core/wallet-model.ts`, which keep
  `w` and `display` on every page link), `?flow=7d|1m|3m|6m|1y|5y|all` the window on the three
  pages read over one (overview · analytics draw cash flow over it, the ledger lists it; set from the
  pinned range ruler; the pre-ruler names `week|month|quarter|year` still resolve; each page omits its
  OWN default — `1m` for the cash-flow pages, `all` for the ledger, `defaultPeriodFor`),
  `?display=` the currency the figures are drawn in. Two intents open the wallet mid-flow
  (`apps/web/features/wallet/core/wallet-intent.ts`, Decision #243): `?do=<action>` opens that
  action's dialog once — only an action the wallet draws for the viewer, offered or locked with its
  reason — and is stripped from the address at once (`replaceState`), so a reload does not reopen it;
  `?back=<path>` is where the movement's done step offers to return, allowlisted by `safeBack` to a
  same-origin `/checkout` path, exactly a business console's Billing module
  `/businesses/<handle>/billing` (Decision #247) or exactly a business console's Overview
  `/businesses/<handle>` (Decision #248) — each optionally with a query or fragment, never a deeper
  path; no scheme, no `//`, no backslash or control character — because it is an open-redirect
  surface; the done step names where it returns (`backLabelFor`: "Back to checkout" · "Back to
  billing" · "Back to overview"). The checkout's tier-1 Add money is
  `/wallet?w=business:<id>&do=top_up&back=<this checkout step>`; Billing's Top up (and an invoice
  review's _Top up the wallet_) is `/wallet?w=business:<id>&do=top_up&back=/businesses/<handle>/billing`;
  the Overview's setup step Add money is `/wallet?w=business:<id>&do=top_up&back=/businesses/<handle>`
  (`addMoneyHrefFor`). `/wallet/transactions` also carries its filter bar
  (Decision #152): `?q=` the search, `?dir=in|out` the direction, `?kind=a,b` the line families
  (`LEDGER_KIND_CHOICES`), each dropped at its default (`withLedgerFilters`), so a filtered ledger links
  and reloads as it was. The island adds `?tz=<IANA zone>` to its own `/api/wallet/*` reads (never to a
  page address) so "Today" and a cash-flow day are the reader's calendar; `GET /api/wallet/transactions`
  pages by an opaque keyset `cursor` (`k:…`), and `GET /api/wallet/export` takes the same filters and
  answers a refusal as JSON, never as a file. `GET /api/finance/cards/setup` hands the Add payment
  method dialog the publishable key before any SetupIntent exists (deferred Elements). The
  remaining retired deep pages answer `(dashboard)/wallet/[section].tsx` with a **308**, keeping `w`
  and `display`: `activity` → `/wallet/analytics`, `payouts` · `funding` · `access` →
  `/wallet#upcoming`, `methods` → `/wallet#methods`. Any other `/wallet/<segment>` is a 404.
  `(dashboard)/_layout.tsx` resolves ONE slot for every wallet page — the middle-nav LANE
  (`walletLaneFor`: page links · the verification gate · the money-action grid, reading the overview
  itself so it paints in the first byte) — and no header band and no footer rig: the display-currency
  and settings tools sit in the hero's corner and the range ruler pins inside the page. Below 767px
  the shell removes the lane, and its page links and gate move to the top of the sheet.

- **A ticket is addressed by `?tkv=<ticket-slug>`, on whatever page the viewer is on.** A ticket
  has no route of its own: its modal (`tkv`, the View Ticket surface) is opened by a QUERY parameter
  carrying `projects.tickets.slug` — a minted `tkt-` address on the same contract as `prj-`/`stg-`
  (Decision #88) — and the ONE owner of that parameter is the global `TicketDeepLinkHost` island
  (`apps/web/features/projects/islands/`), mounted once per shell. Opening a ticket writes the
  parameter (a `pushState` from a URL without one, so Back closes it and Forward reopens it;
  `replaceState` thereafter); closing strips it and preserves every other parameter; `popstate`
  re-syncs the modal to the address bar. The pure rules — the parameter's shape, the exclusion
  policy, the surface registry — live in `apps/web/features/projects/core/ticket-link.ts`.

  On a page that already holds the ticket (the board, the timeline) the link is handed to that
  page's own modal chain, so an edit lands beside the board; anywhere else the host fetches
  `/api/projects/ticket?slug=` and renders the modal itself. The parameter is **stripped and nothing
  opens** on the landing/marketing pages (`/`, `/about`, `/help/**`, `/share/**`), the auth screens
  (`/login`, `/join`, `/forgot-password`, `/verify`), exactly `/checkout/details` and
  `/checkout/payment`, for a guest, for a malformed value, and for a ticket the read refuses — which
  answers "not found" and "not yours" with the same words, because the link is pasted from anywhere.

  The two landing pages, `/` and `/features`, mount no `TicketDeepLinkHost` (Decision #286 (A)), so
  they strip the parameter on the SERVER: each landing route's `GET` calls `tkvRedirect(ctx.url)`
  (`apps/web/features/landing/core/strip-tkv.ts`) before it renders, and answers a URL carrying
  `tkv` (empty, repeated or percent-encoded too) with a bodiless `303 See Other` to the same path and
  query without it: every other parameter kept byte for byte and in order, the `Location` path and
  query only (the browser carries the fragment over) and pinned to one leading slash. Every other
  route keeps the in-browser strip.

- **Conversations are addressed by their _entry surface_.** A thread keeps its stable `chatId` (so
  it stays **one continuous record** — `PRODUCT_SPEC.md` §Unified Messaging, Decision #21); only the
  **base path** changes with where it is opened (resolved 2026-07-16, Decisions #22 / #23):

  | Opened from…               | Channel kind                          | URL                                     |
  | :------------------------- | :------------------------------------ | :-------------------------------------- |
  | **the global `/messages`** | private / team message                | `/messages/[chat-id]`                   |
  | **within a project**       | the engagement's **discussion**       | `/projects/[project-slug]/discussion`   |
  | **within a project**       | a **stage**                           | `/projects/[project-slug]/[stage-slug]` |
  | **within a project**       | team / DM                             | `/projects/[project-slug]/[channel-id]` |

  Every row of a Project Details channel tree (Stages, and — only when the viewer has something in
  them — Teams and Private Messages) routes into the **project namespace** via
  `channelHref(projectSlug, ref)`
  (`apps/web/features/projects/core/chat-context.ts`); the destination page loads the thread by its
  shared `chatId`, so a project DM and the same person's global DM (`/messages/[chat-id]`) remain
  one continuous record.

  **A message is addressed by `?m=<messageId>` on its conversation's chat address**
  (Decision #162(G)): `/messages/[conversationId]?m=<id>` for a DM, `/projects/[project-slug]/[stage-slug]/chat?m=<id>`
  for a stage room (a Task's discussion room by its stage slug), `/projects/[project-slug]/discussion/chat?m=<id>`
  for the project-wide room. A private team or business room, or an extra project-wide room, has no
  slug and keeps its room uuid in that segment — flagged against Decision #88 (#162 flag (h)). A query
  parameter rather than a hash, because the server can read it. `ChatFeed` reads `m` (and the legacy
  `#m-<id>` anchor) once on mount, skips the open-at-bottom scroll, strips the parameter with
  `replaceState` (`fClientNav: false`), then jumps to the message and flashes it; a message beyond
  the feed's page-back budget ends at its "too far back" status (#162 flag (g)). The links are built
  server-side by `dmMessageHref` / `projectMessageHref` (`services/messaging/live-attachment-source.ts`)
  and client-side by `features/projects/core/chat-context.ts`: `conversationMessageHref` for a
  conversation, `channelMessageHref` for a project room (slug paths only — it answers `null` when
  either segment is a uuid, so the client never mints a uuid link the server-built source may still
  carry), `messageAnchorOf` / `withoutMessageAnchor` to read and strip the anchor
  (`MESSAGE_ANCHOR_PARAM = "m"`).

  **The engagement's discussion has a fixed address on every archetype** (Decision #133):
  `/projects/[project-slug]/discussion` — the lane's first top-tier link, built by `discussionHref`.
  The word `discussion` (`DISCUSSION_REF`, `@projective/types/projects`) is the polymorphic
  segment's fifth self-describing form; WHICH room it opens is the server's question, answered by one
  rule (`discussionOf` over the projection, `resolveChannelRef`'s discussion arm live, `expandChannelRef`
  in the fixtures): a **Task** binds its root stage's shared `stage_all` room; every other archetype
  binds its project-wide room (`comms.project_channels.visibility = 'project_all'`, no `stage_id`).
  Every read and write beneath it — the feed, the composer, the room's tabs (`/discussion/files`,
  `/discussion/tasks`, …, served by the `[channelId]` routes) — carries the word, not the room's key.
  `discussion.tsx` serves the bare address and answers `303` to the engagement when it has no
  discussion room. The room's OLD addresses (a Task's `stg-…` slug or room id, a staged engagement's
  project-wide room id) answer `303` to `/discussion` with their tab path and query from
  `[channelId]/_middleware.ts` (`legacyDiscussionRedirect`, `addressesDiscussion`) — `303`, because a
  Task converted into a pipeline makes its stage an ordinary stage again.

  **The second segment is polymorphic, and a stage is the exception that earns it.** A stage is
  addressed by its own immutable `stg-…` slug (`projects.project_stages.slug`, Decision #88), never by
  the id of the room it opens: that room is a `comms.project_channels` uuid, provisioned LAZILY on
  first open, so a link built from it could not be minted before somebody had already been there and
  said nothing about what it addressed once it was. Every other kind still carries its own channel id.
  The two are told apart by SHAPE alone — `isSlug(ref, "stage")` — which costs no query and cannot be
  fooled, because a stage slug is not a legal uuid and a uuid is not a legal slug. Resolution runs
  through the one SSOT helper `findStageChannel` (`@projective/types/projects`), and it matches the
  slug and **nothing else**: a stage's own row id and its room id are internal keys that never appear
  in a path, and accepting them would let an address resolve in the fixtures — where those strings
  coincide — and 404 in production, where they do not.

  The channel view itself is a **nested-route tab set** under `[projectSlug]/[channelId]/`: the pinned
  `ChannelHeader` (`apps/web/features/projects/islands/ChannelHeader.island.tsx`, resolved per route
  by `channelHeaderFor` and mounted by the `(dashboard)` layout into the **middle-nav frame's header
  band** — `MiddleNav`'s `header` slot, flush against the lane) hosts contextual view tabs that each
  map to a segment — `chat` (also the index), `files`, `submissions`, `tasks`, `timeline`, `members`
  and `details`. WHICH of them a room shows is one matrix, `CHANNEL_TAB_MATRIX` in
  `core/channel-view.ts`, keyed by project type and room (Decision #134): a **Task's** and a
  **session's** Discussion show Chat alone; a **one-off's** and a **pipeline's** Discussion show Chat ·
  Files · Members · Details (Details opens the engagement's own configuration — `discussion/details`
  answers `303` to `/projects/[project-slug]/details` for review authority and to the Overview for
  anyone else, Decisions #144 / #163); a **one-off** stage shows Chat · Files · Submissions ·
  Members · Details; a **pipeline** stage adds Tasks · Timeline after Submissions. Team rooms and DMs
  show Chat · Files · Members. On a stage, Submissions/Tasks/Timeline need a reviewer or an assigned
  freelancer and Details needs review authority (`ProjectDetail.viewerCanConfigure`, or a platform
  admin). **A Task has neither
  `timeline` nor `calendar`** (`isTaskProject` — one stage, one ticket, nothing to draw on a time
  axis): both tabs are absent, and all four routes answer `303` from `define.handlers` through the
  one guard `taskAbsentViewRedirect` (`features/projects/core/task-view-guard.ts`) — to the project
  for a project-level view, to the room for a channel-level one — so a tab and the route behind it
  cannot disagree. A Task's single conversation is its stage's room, reached at
  `/projects/[project-slug]/discussion` from the lane's top-tier **Discussion** link rather than
  from a channel tree (Decisions #121 / #133).
  Active-tab state is driven
  purely by the URL segment (`activeTabOf` in `core/channel-view.ts`), so deep-links and refreshes
  land on the right view. The former `/messages/[chatId]?project=…&scope=…` in-project addressing
  **and its "This project ⁄ Full history" scope switch are retired** (Decision #22) — the
  entry-point URL alone carries the project context now.

- **Submissions are a wildcard tree route** (root `CLAUDE.md` §8 **Decision #33**). Unlike the other
  single-segment tabs, `submissions` is a catch-all `[...path]` route in BOTH scopes — channel
  (`projects/[projectSlug]/[channelId]/submissions/[...path].tsx`) and project
  (`projects/[projectSlug]/submissions/[...path].tsx`, a static segment that precedes `[channelId]`,
  so it never shadows a real channel). The trailing `path` is the deliverable-tree node (stage →
  submitter → unit → directory) the interactive breadcrumbs + navigation tree address, so any node
  is a deep-linkable URL and the bare `…/submissions` matches with zero trailing segments (the
  `help/[...path].tsx` precedent). `activeTabOf` reads only the first segment after the channel
  base, so the header's Submissions tab stays active on deep paths. The footer View Control Rig +
  far-right **Review Submission** trigger is resolved by `submissionsFooterFor` (composed after
  `channelFooterFor` / `filesFooterFor` in the `(dashboard)` layout's single footer slot).

- **The Members tab's sections are a query parameter** (Decision #136). `…/members` is the roster;
  `?view=requests` and `?view=invitations` select the open applications and the sent invitations, on
  the project (`/projects/[projectSlug]/members`) and stage (`…/[channelId]/members`) routes alike.
  The section is resolved **server-side** against what the viewer may see
  (`resolveMemberSection(view, memberSectionsFor(page))` in `features/projects/core/member-sections.ts`,
  called by `MembersView`), so a management section opened by someone who cannot manage lands on
  Members; a tab switch rewrites the address in place (`replaceState`, every other parameter kept)
  rather than navigating. `/messages/[conversationId]/members` offers the roster alone. The footer's
  zoom rig + far-right **Invite** trigger is resolved by `membersFooterFor` (after
  `submissionsFooterFor`) and, on the conversation route, by `conversationFooterFor`. On a stage's
  route (`…/[channelId]/members`) the roster lists only the stage's assignees and its oversight
  roles — an unassigned participant stays on the project's roster alone (Decision #145).

- **The asset hub `/files` is a wildcard tree route too**, and for the same reason: a folder must be
  a URL. `files/index.tsx` **re-exports** `files/[...path].tsx` rather than duplicating it, so
  `/files` and `/files/Brand/Logos` cannot drift in how they resolve. `AssetListPage.readOnly` is a
  fact about the LOCATION (a mounted project channel or a connected drive is browsable in place but
  managed where it lives), distinct from the per-asset `AssetItem.canManage` — the hub withholds the
  write affordances on a read-only location rather than offering them and refusing each attempt. Its
  lane, header band and footer rig are resolved by `filesLaneFor` / `filesHeaderFor` /
  `filesFooterFor`.

- **A share link is a capability URL, and `/share/[slug]` is the ONLY route that resolves one.** It
  lives in `(public)`, not `(dashboard)`: the recipient has no account, and a resolver behind a
  sign-in wall resolves nothing. Nothing in the handler reads the session, so a signed-in visitor
  and an anonymous one are treated identically — holding the opaque, server-minted slug is the
  entire test.

  **Every failure is one answer.** `resolveShare` collapses `not_found` · `expired` · `revoked` ·
  `exhausted` · a service failure into a single outcome at the SSR boundary, and the route renders
  the same body with the same words at the same **404** for all of them. A distinguishable failure
  confirms that a slug was real, which is the one bit an enumeration attack is probing for. The
  response carries `X-Robots-Tag: noindex, nofollow` (a share URL gets pasted somewhere public
  eventually) and `Referrer-Policy: no-referrer` (the slug is IN the path, so any `Referer` this
  page emits hands the credential to a third party) — and because of that second header the global
  `routes/_middleware.ts` **defaults** `referrer-policy` rather than setting it, so a route may
  harden it and nothing can silently lower it.

  The optional `?u=` is a **verification hint, not a credential**: an opaque, server-minted
  per-recipient reference used to attribute a download to the copy of the link that was actually
  opened. The slug alone resolves; a missing, stale or fabricated `u` changes nothing about whether
  the file is served. It is never a handle, a user id or an email — a share URL is forwarded and
  pasted into public places, and personal data must not travel in a query string.

- **The checkout is four routes, not four modes of one route.** Each step is its own file under
  `(dashboard)/checkout/`, which is what makes the browser's own Back button work through the flow
  and makes every step a link a buyer can be sent. It is also why the stepper is a row of real
  anchors rather than a controlled widget: the URL is already the state, and a second copy of it in
  a signal is a second thing that can be wrong. Builders: `checkoutStepHref()` / `basketHref()` /
  `checkoutHref()` in `apps/web/features/checkout/core/basket-model.ts` — never a hand-written path.

  | Step | File                                    | URL                      | Chrome (Part D.6)                                      |
  | :--- | :-------------------------------------- | :----------------------- | :----------------------------------------------------- |
  | 1    | `(dashboard)/checkout/index.tsx`        | `/checkout`              | `full` — basket + the list explorer in the lane        |
  | 2    | `(dashboard)/checkout/details.tsx`      | `/checkout/details`      | **`focus`**                                            |
  | 3    | `(dashboard)/checkout/payment.tsx`      | `/checkout/payment`      | **`focus`**                                            |
  | 4    | `(dashboard)/checkout/confirmation.tsx` | `/checkout/confirmation` | `full` — restored, its job is to send the buyer onward |

  **`/basket` is retired to a `302`, and the file is kept.** `(dashboard)/basket/index.tsx`
  redirects to `/checkout` **preserving the query string** — `?basket=` and `?owner=` are
  load-bearing, and dropping them lands an entity buyer on their personal basket. It is not deleted
  (root `CLAUDE.md` §5 — nothing is hard-deleted) because the URL is reachable from the
  globally-mounted basket drawer and from persisted client state, so a 404 there is a dead end
  reachable from the header. It is a **302, not a 308**: a permanent redirect is cached by the
  browser indefinitely with no server-side way to invalidate it, and the flow's first step is still
  _called_ "Basket", so the route may legitimately return. `isCheckoutPath()` keeps matching
  `/basket`, so the slot resolvers still claim it during the redirect hop.

  **Query params, all optional.** `?basket=` selects a named basket (a list is a named
  `finance.baskets` row, not a separate table); `?owner=` selects the acting principal's scope
  (`personal` · `team:{id}` · `business:{id}` · `enterprise:{id}`); `?order=` names the order the
  confirmation resolves (absent → the account's most recent); `?project_id=` / `?service_id=` narrow
  the flow to one engagement; `?edit=1` on Details forces the form open. Dev Context Switcher axes
  travel as separate validated `sim*` params (`simOwnerScope` · `simProviders` · `simWalletCover` ·
  `simCards` · `simDetails` · `simBilling` · `simInvoicing` · `simSpendLimit` · `simFulfilment` ·
  `simConferencing`) and are ignored on the live path.

  **Who sets `?owner=` / `?basket=`, and where the choice lives (Decision #70(k)).** The basket
  switcher — in the header basket drawer, and in the checkout header band below `--bp-md` where the
  list lane is not rendered — lists every owner the buyer can buy for (`GET /api/basket/owners`). On
  the checkout routes a switch **navigates** to `basketHref(basket, owner)`, so the selection is the
  URL. Everywhere else it is a **per-viewer preference** (`LocalKeys.BASKET_OWNER` + `BASKET_LAST`),
  dropped when the shell's acting context changes or when the remembered owner is no longer one the
  buyer can buy for. `?owner=personal` is kept in links and API calls rather than omitted: an absent
  owner means the acting context's default, which is a team or business whenever the shell acts as
  one. The drawer's **Proceed to Checkout** opens step 1 (`/checkout?basket=&owner=`) and its **View
  all baskets** opens `/checkout?owner=`; only Buy Now's `checkoutHref()` goes straight to
  `/checkout/payment`, because a single purchase has no basket to review.

  **Two redirects govern the Details step, and one predicate governs both.** Details **auto-skips**
  to `/checkout/payment` when `canSkipDetails(session)` holds and `?edit=1` is absent; Payment
  **bounces back** to `/checkout/details` when `buyerDetailsComplete(session.buyer)` does not — a
  buyer who deep links past the form must be sent back, not shown a Pay button the server will
  refuse. Because both directions delegate to the same predicate
  (`@projective/types/finance/checkout`), they cannot disagree and produce a redirect loop.
  `?edit=1` is mandatory rather than polish: without it a buyer whose details are complete can never
  reach the form again, since every route into it redirects away.

  ⚠ **Both redirects are returned from `define.handlers`, never from `define.page`.** A `Response`
  returned from a page component is **dead code** — it is a render function, not a handler; the page
  renders anyway and nothing errors. Root `CLAUDE.md` §8 Decision #61 records a whole surface lost
  to exactly this.

## Reserved-handle precedence

Static routes win over `[handle]`. `/about`, `/explore`, `/login`, `/help/*`, `/view/*`, `/share/*`
resolve to their `(public)` routes and `/inspect/*` to its `(standalone)` route; anything else falls
through to `/:handle`.

**`files` and `share` are both in the denylist**, and each is there for a different reason, which is
why the denylist is not merely a duplicate of the route table:

- **`files`** has no `(public)` route at all — `/files` lives under `(dashboard)`, so a signed-out
  visitor asking for `/files` never meets a static route and would otherwise fall through to
  `/:handle` and be answered with a fabricated profile for a word that is a section of the product.
  The denylist is what makes that a 404 instead.
- **`share`** does have a static route, so precedence already covers `/share/abc`. It is denied
  anyway because precedence protects the PATH, not the NAME: without the entry, `@share` remains
  claimable as a handle, and a handle that shadows the one route on the platform that hands out read
  access to private files is a phishing primitive rather than a routing curiosity.
- **`exit`** (Decision #128) is denied for the same reason as `share`: `/exit` is the page that
  vouches for leaving the platform, and an `@exit` profile would borrow that voice.
- **`workspace` under `/legal`** (Decision #270) is a reserved LEGAL segment rather than a handle:
  `/legal/workspace/*` is the signed-in IP workspace, so `LEGAL_RESERVED_SLUGS`
  (`@projective/types/content/legal.ts`) keeps it out of the document slugs — `isLegalSlug` refuses it
  and the document resolver answers it with a `404` — even though the static route already outranks
  `[slug]`. `legal` itself was already a reserved handle.
- **`inspect`** (Decision #161(G)) is denied for both reasons at once: `/inspect/:fileId` opens
  private files, so an `@inspect` profile would borrow its voice the way `@share` would; and a bare
  `/inspect` (no id) meets no static route and falls through to `/:handle`, which the denylist turns
  into a 404. It is listed in `RESERVED_HANDLES`, `org.fn_is_reserved_handle` and the auth form's
  username list (`features/auth/core/options.ts`, which still lacks `file`, `files` and `share` —
  pre-existing drift).
- **`changelog`**, **`feedback`** and **`features`** (the public-routes build, 2026-10-17) are
  denied ahead of their routes. `/changelog` and `/feedback` are public editorial surfaces that
  speak for the platform — an `@changelog` or `@feedback` profile would borrow that voice the way
  `@share` would borrow the share route's — and `/features` is the landing track's feature
  catalogue. `/changelog` (P5) and `/feedback` (P7) now have their routes; `/features` has none until
  the landing track lands it, so a bare request meets no static route and falls through to
  `/:handle`, which the denylist turns into a 404 rather than a fabricated profile. All three are in
  `RESERVED_HANDLES`, `org.fn_is_reserved_handle` (pinned by `supabase/probes/reserved_handles.sql`
  as well as the contract test) and the auth form's username list.
- **`robots.txt`** and **`sitemap.xml`** were reserved before they were served; since P8 (Decision
  #279) they are routes of their own (`(public)/robots.txt.ts`, `(public)/sitemap.xml.ts`), and the
  namespace guard below counts them as the top-level segments they are.

All are enforced through the one SSOT guard (`isReservedHandle`) and its SQL twin
`org.fn_is_reserved_handle` (pinned by `workspace.contract.test.ts`), so a future "claim your handle"
flow validating against it inherits every entry without knowing why any is listed.

**The namespace guard (Teams P1).** Every top-level URL segment `apps/web/routes/` serves — route
groups `(…)` descended (they add no segment), `[params]`, `_`-prefixed files and `index` skipped, as
are files that are no route module (`*.test.*`, `*.spec.*`, `*.d.ts`); a dotted route module claims
its whole stem (`feed.xml.ts` → `feed.xml`, as `robots.txt` and `sitemap.xml` are reserved) — must
be a reserved handle. `workspace.contract.test.ts` enumerates the routes tree and fails, naming the
segment, when one is missing from `RESERVED_HANDLES`; the same test pins `RESERVED_HANDLES` to
`org.fn_is_reserved_handle`, so **a new top-level route is reserved in both in the same change**
(`reference/pr-checklist.md`). Its first run found `invite` (`/invite/:token`, Decision #145) and
`saved` (`/saved`, Decision #180) unreserved — both are now in the two lists — so nobody can claim
`@saved` and shadow the page by name.

### The owner's three views of their own profile

A profile's owner sees an owner header above the page with three tabs, each a real address rather
than island state (the Preview ⇄ Details precedent of the project workspace): **Preview**
(`/:handle` — what a visitor sees, with the conversion controls inert and saying so; the photo alone
carries an owner edit overlay that opens the File Picker in avatar mode, Decision #158),
**Edit Profile & Settings** (`/:handle/edit`) and **Availability** (`/:handle/edit/availability`).
`OwnerNav` renders them as anchors with `aria-current`. Both `edit` routes guard in
`define.handlers` (a redirect returned from a page component is dead code in Fresh 2) and decide
ownership from the live read's `viewer.isOwner`.

### Profile and media API

| Route                                      | Methods                  | Purpose                                                                                                   |
| :----------------------------------------- | :----------------------- | :-------------------------------------------------------------------------------------------------------- |
| `/api/profile/[handle]`                    | `GET · HEAD · OPTIONS`   | The profile overview / a section payload (`?tab=`), through the shared read-endpoint factory (ETag, 304). |
| `/api/profile/[handle]/save`               | `POST`                   | Owner edits → `org.save_profile`; answers the fresh edit model. Refusals are field-keyed 422s.            |
| `/api/profile/[handle]/media`              | `POST`                   | Cut an avatar or showcase rendition from a library asset (crop in source pixels) and attach it.          |
| `/api/profile/[handle]/showcase`           | `PUT`                    | Reorder / empty showcase slots → `org.save_showcase`.                                                     |
| `/api/profile/[handle]/availability`       | `GET` (`no-store`) · `PUT` | The owner's schedule, weekly hours and call terms → `scheduling.save_owner_availability`.               |
| `/api/profile/[handle]/follow`             | `POST {follow}`          | Follow / unfollow as the caller (idempotent; following yourself is refused).                              |
| `/api/profile/[handle]/connections`        | `GET ?direction=&cursor=` | One page of the profile's `followers` or (a person's) `following` (Decision #180): `ProfileConnectionsParamsSchema` → `ProfileBackendService.connections` → `org.profile_follows` edges + `org.get_profile_cards` (a profile the caller may not see is left out) → `{ data: { items, nextCursor } }`, keyset on the follow instant. Public, like the edge. |
| `/api/media/library`                       | `GET` (`no-store`)       | The caller's own library images and videos, newest first, keyset-paged.                                   |
| `/api/media/upload-init`                   | `POST`                   | Declare an upload: a `pending_upload` row in `quarantine` + a signed upload URL.                         |
| `/api/media/upload-complete`               | `POST`                   | Run the pipeline: claim → sniff → decode → WebP tiers → admit (see `database/files/Storage.md`).         |
| `/api/media/oauth-avatar-sync`             | `GET` · `POST`           | `GET`: the caller's sign-in provider + allowlisted picture URL. `POST`: fetch it server-side and run it through the same pipeline into the caller's library (URL read from the verified identity, never the request). |
| `/api/media/proxy/[fileId]`                | `GET` · `HEAD`           | An asset's bytes STREAMED through the app after the same read gate as `/api/files/object/[id]` (`objectFor`): `?tier=sm\|md\|lg` (a WebP rendition, else the original), `?download=1` (attachment), `?share=<slug>`. A top-level `GET` navigation (`Sec-Fetch-Dest: document`; without Fetch Metadata, an HTML-first `Accept`) is a `303` to `/inspect/[fileId]` (keeping `?share=`) unless `?raw=1` / `?download=1`; byte responses add `vary: sec-fetch-dest` (`features/inspector/core/proxy-navigation.ts`). Forwards `Range` / `If-Range` / `If-None-Match` / `If-Modified-Since` (206 · 304 · 416); headers from an allowlist, never copied from storage; never counts a download. Refusals are a bodiless `404` (also a malformed id), `429` with `retry-after`, or `503` — all `no-store`. `mediaProxyHref(id, opts)` builds it (Decision #161(A)); see `database/files/Storage.md`. Since Decision #162(A) it is the `url` / `thumbnailUrl` of every stored asset row (grid thumbnails `?tier=sm`, chat tiles `?tier=md`). |
| `/api/files/inspect`                       | `GET` (`?id=<uuid>&share=<slug>`) | One stored asset's `InspectAsset` for the preview modal (Decision #162) — the same DTO `/inspect/[fileId]` renders, through `FilesBackendService.inspect` (`FilesService.inspect` on the client). `400` with no `id`; every refusal `404`; `503` when the read fails. |

`/api/profile/*` and `/api/media/*` are thin: HTTP parsing, Zod (`@projective/types/profile`,
`@projective/types/files`), then `ProfileBackendService` / `MediaBackendService`.

The account popover's own reads sit under `/api/user/*`: `GET /api/user/me` (identity) and
`GET /api/user/setup` (the PERSON's setup progress — score, completed steps and the next suggested
action, computed by `org.fn_compute_profile_setup_progress` — with the verification stamp, published
hours and Standing, composed from `org.get_party_cards` and `org.get_profile_view`; `setup: null`
when the read cannot be made, 401 only for a guest; Decisions #149 / #155), both through
`UserBackendService`. `GET /api/user/allowance` (`?team=<uuid>` for a team's pool, `?as=self` for the
person's own in a team context) is the proposal allowance — weekly units, the anti-burst buffer, the
next drip and whether an application would be accepted (`ProposalAllowanceStatus`) — through
`WalletBackendService.getProposalAllowanceStatus` → `finance.get_proposal_allowance`; `403` for a
team the caller is not in, `no-store` because the read pays out the drip (Decision #154).

`POST /api/user/freelancer` is the "Become a Partner" unlock behind `/become-partner` (Decision
#150): `EnableFreelancerInputSchema` (`@projective/types/user` — one to ten `org.skills` slugs) →
`UserBackendService.enableFreelancer(readActor(ctx), input)` → `org.enable_freelancer_profile`
in the caller's JWT. `201` on a fresh unlock, `200` when it was already unlocked, `401` / `403`
(onboarding incomplete) / `422` (refused skills) / `503` otherwise; the body carries the person's
`handle`. A successful unlock re-issues the session on the same response (re-stamped `sb-*`
cookies, or `claimsStale: true` with the old cookies kept; Decision #193), and the client
hard-navigates to `/[handle]/edit`.
`/become-partner` itself reads the setup facts and the skills taxonomy server-side
(`UserBackendService.setup` / `starterSkills`) and hands them to `BecomePartnerWizard` as props.

### Settings engine (Decision #151)

**The contextual modal's URL contract — `?settings=<section>` on any signed-in page.** Owned by ONE
host, `features/settings/islands/SettingsModalHost.island.tsx`, mounted in `UserShell`; pure helpers
in `features/settings/core/settings-url.ts` (`readSettingsParam`, `withSettingsParam` — every other
parameter and the hash survive, in order). Any surface opens it with
`openSettings(section, anchor?)` (`core/settings-bridge.ts`, the cancelable `pj:settings-open` event;
when no host claims it the bridge navigates to `/settings/:section` instead).

- **Arriving** with `?settings=x` opens section x; a malformed value is stripped. On `/settings/*` the
  parameter is a request for that section's PAGE, so the host navigates there.
- **Opening from a gear PUSHES** one history entry, so browser Back dismisses the modal; **moving
  between sections REPLACES** it; **closing** removes the parameter and nothing else (stepping back
  over the host's own entry, or replacing one it did not push). Every entry carries
  `fClientNav: false` and the page's own entry is re-stamped first — the `?tkv=` recipe (Decision #95),
  without which Back reloads the document.
- **Expand to full page** is `location.replace(/settings/:section#anchor)`; unsaved form drafts travel
  in `SessionKeys.SETTINGS_DRAFTS` and the page adopts them.

| Route                                    | Method | Service → database |
| :--------------------------------------- | :----- | :----------------- |
| `/api/settings/[section]`                | `GET`  | `resolveSettingsSection` (`features/settings/core/settings-ssr.ts`) — the section's payload (`SettingsSectionEnvelope`, `@projective/types/settings`), composed from the services that own each section's data. `404` unknown section · `401` guest · `no-store`. `error` names a PART that could not be read; the request itself still succeeds. |
| `/api/user/preferences`                  | `GET` · `PATCH` | `PATCH` takes `UserPreferencesUpdateSchema` (strict: display currency · locale · direction · theme · `contrast` · `font` · `cvd` · `motion`) → `SettingsBackendService.updatePreferences`, which splits it: the display half through `UserBackendService.updatePreferences`, the appearance half into the four `org.user_preferences` columns. Answers `{ preferences, appearance, appearancePersisted }` and, whenever the appearance or direction changed, **`Set-Cookie: pj.a11y=…`** (`utils/a11y-context.ts`) so the next response is server-rendered in the new overlays. A patch that touches a claim (`touchesTokenClaims`: locale · display currency · date format) re-issues the session on the same response (`claimsStale: true` when it could not; Decision #193). `GET` adds `{ appearance, appearanceLive }`. |
| `/api/user/emails`                       | `GET` · `POST` `{ email }` | `EmailsBackendService.list` → `org.get_my_emails` · `.add` → `org.add_user_email`, then the token through the SERVICE client `security.issue_email_verification` and `services/mail/verification-mailer.ts`. `POST` → `201 { emails, delivery }` (`sent` · `logged` · `unavailable`); 422 `errors.email`; 429 `details.retryAt` (5 sends per 15 min). The raw token never reaches a browser. |
| `/api/user/emails/[id]`                  | `DELETE` | `EmailsBackendService.remove` → `org.remove_user_email` (never the primary or the sign-in address) |
| `/api/user/emails/[id]/primary`          | `POST` | `EmailsBackendService.setPrimary` → `org.set_primary_email` (verified addresses only) |
| `/api/user/emails/[id]/resend`           | `POST` | `EmailsBackendService.resend` — a fresh token (earlier ones expire); 409 when already verified |
| `/api/user/emails/verify`                | `GET` `?token=` | The mailed link: `org.confirm_user_email` for the signed-in account (it renews the session itself), then **303→** `/settings/account?email=<EmailVerifyOutcome>`; signed out **303→** `/login?redirectTo=…`. `no-store`, `no-referrer`. Refusals carry `details.refusal` (an `EmailRefusal` code); a non-uuid `:id` is 404. |
| `/api/user/notifications`                | `GET` · `PUT` | `NotificationCenterBackendService` over `comms.notification_prefs` / `notification_category_prefs` / `notification_types` in the caller's JWT. `PUT` = `NotificationCenterUpdateSchema` (partial; `resetChannels` sets a channel back to `null` on every category row so a master toggle is not outranked). 401 guest · 422 invalid / quiet hours incomplete · 503 not live. |
| `/api/settings/attention`               | `GET`  | `attentionFactsFor` — the attention FACTS (`SettingsAttentionFacts`) for the contextual modal's section marks (Decision #156). `401` guest · `no-store`. |
| `/api/user/handle`                      | `GET` · `POST` `{ handle }` | `AccountLifecycleBackendService.handlePolicy` → `org.get_handle_policy` · `.changeHandle` → `org.change_username` (two changes in three days, then a 90-day lock; a released handle is held 90 days). Answers `{ policy, previous }`; refusals carry `details.refusal` and a namespace refusal `errors.handle`. A change re-issues the session on the same response (the token carries the handle; `claimsStale: true` when it could not; Decision #193). |
| `/api/user/lifecycle`                   | `GET` · `POST` `{ scope, confirmation }` · `DELETE ?scope=` | `AccountLifecycleBackendService` → `org.get_account_lifecycle` · `org.schedule_freelancer_removal` / `org.schedule_account_deletion` (typed `CONFIRM`; 409 `details.blockers` while anything blocks) · `org.cancel_deletion_request`. Answers `{ lifecycle }`; a `freelancer_profile` schedule or cancel re-issues the session (`isFreelancer` rides the token; `claimsStale: true` when it could not; Decision #193). |
| `/api/user/identities`                  | `GET`  | `IdentitiesBackendService.list` — `{ identities, available, canDisconnect }` (GoTrue identities; providers on in this environment from GoTrue `/settings`). |
| `/api/user/identities/[id]`             | `DELETE` | `IdentitiesBackendService.unlink` — 409 for the email identity and for the last way to sign in; answers the remaining list. |
| `/api/user/identities/link/[provider]`  | `GET`  | Starts a PKCE `linkIdentity` for the signed-in person, sets ONLY the code-verifier cookie, **303→** the provider; the shared `/api/auth/callback` completes it and returns to `/settings/account?connect=<provider>#connected-accounts` (a failure → `?connect=failed`, never the sign-in page). |
| `/api/user/cron/erasures`               | `POST` (`?limit=`) | The scheduler's door to `AccountLifecycleBackendService.sweepDue` → `security.purge_due_account_deletions`. Bearer `ACCOUNT_CRON_SECRET` (≥ 32 chars, constant-time); anything else **404**. |
| `/api/messaging/settings`                | `GET` (`?role=`) · `POST` `MessagingSettings` | `MessagingBackendService.settings` · `.saveSettings` → `live-settings-write.ts`, the exact inverse of the reader: `comms.notification_prefs`, the `messages` category's `in_app`, the `message.new` / `message.mention` in-app mutes, and a replace-set of `comms.auto_responses` over the rules shown. Answers the fresh read. 422 field errors · 401 guest. |

### Notification inbox API

Thin routes over `NotificationInboxBackendService` (`@server/services/comms/`), each Zod-parsing with
the `@projective/types/comms` schemas, resolving the actor from the session (401 for a guest or an
expired live session), and answering the flat `serviceResponse` envelope. Live behind
`AUTH_BACKEND_LIVE` (as `/api/user/notifications`); otherwise per-user fixtures
(`services/comms/notification-fixtures.ts`). Writes go only through the `SECURITY INVOKER` inbox RPCs.

| Route                             | Methods | Behaviour |
| :-------------------------------- | :------ | :-------- |
| `/api/notifications`              | `GET` `?category=&contextType=&contextId=&unreadOnly=true&archived=true&before=&limit=` | `NotificationListParamsSchema` → `.list`: `comms.notification_feed` (`archived=true`: the archived rows of `comms.notifications` instead; every item carries `actor` from `org.get_party_cards`, Decision #173), newest first, keyset on `created_at` (`before` = the previous page's `nextCursor`), plus the badge summary → `{ items, summary, nextCursor }`. 422 bad param or cursor. |
| `/api/notifications/summary`      | `GET`   | `.summary` → `comms.get_notification_summary()` → `{ unread, unseen, total, byCategory }` (`byCategory` = unread per category, absent = 0). |
| `/api/notifications/read`         | `POST` `{ ids }` | `NotificationIdsSchema` (1–500 uuids) → `comms.mark_notifications_read` → `{ updated }`. |
| `/api/notifications/read-all`     | `POST` `{ category? }` | `MarkAllReadSchema` → `comms.mark_all_notifications_read`; empty body = every category → `{ updated }`. |
| `/api/notifications/seen`         | `POST`  | `comms.mark_notifications_seen` — clears the badge, reads nothing → `{ updated }`. |
| `/api/notifications/archive`      | `POST` `{ ids }` | `NotificationIdsSchema` → `comms.archive_notifications` (dismiss; never a hard delete) → `{ updated }`. |

### Help centre API (P2)

Thin routes over the editorial and community help services; both are guest-reachable and answer the
flat `serviceResponse` envelope. The page itself is the `[...path]` row above.

| Route                | Methods | Behaviour |
| :------------------- | :------ | :-------- |
| `/api/help/search`   | `GET` `?q=` | `HelpCentreSearchQuerySchema` (trimmed, ≤ 120 characters, empty allowed) → `HelpBackendService.search` → `{ query, results: [{ slug, title, category, categoryTitle, href, snippet, highlights: { title, snippet } }] }` (≤ 20, best first; highlights are `[start, end)` runs). The in-memory index is built from the `editorial.help_*` rows (or the content source with `EDITORIAL_BACKEND_LIVE` off) and cached 5 minutes. `cache-control: public, max-age=60`. 503 when the help tables cannot be read. |
| `/api/help/feedback` | `POST` `{ slug, helpful, comment? }` · or the form `slug, helpful=yes\|no, comment, back` | `HelpFeedbackInputSchema` (a comment only with `helpful: false`, ≤ 280) → `HelpFeedbackBackendService.submit` → `community.submit_help_feedback` as the caller (their JWT when signed in, anon otherwise). JSON: `{ slug, helpful }` · 422 · 404 (an article nobody can read) · 429 (per process: 10 per signed-in voter per 10 minutes, 20 per guest address a minute; or the writer's `PH429`; `Retry-After` set) · 503. A form post answers **303** to `back` — only ever a `/help` path — with `?helpful=thanks\|error#was-this-helpful`. |

### Feedback board (Decision #272)

`/feedback` (`routes/(public)/feedback.tsx` → `features/feedback/routes/FeedbackPage.tsx`) is the
board's own page — public, indexable, and the canonical address of every idea's section of it. The
same board opens over ANY public, profile or dashboard page as a drawer, owned by ONE host,
`features/feedback/islands/FeedbackHost.island.tsx`, mounted in the `(public)`, `[handle]` and
`(dashboard)` layouts (the drawer's code is imported the first time it is asked for).
`features/feedback/core/feedback-url.ts` is the contract:

- **`?feedback=open`** on any page but `/feedback` opens the drawer; the URL is the source of truth
  (arriving with it opens it). Opening from the account menu's **Feedback & roadmap**, the footer's
  Feedback entry (Decision #279) or the `g` `f` shortcut PUSHES an entry, so Back closes the
  drawer; moving inside it and closing it (`replaceState`) never add one. On `/feedback` the
  parameter is dropped — the page is the board.
- **`idea=<fbk-slug>`** opens one idea (in either mode); **`compose=1`** opens the suggestion form.
- **`status=under_review|planned|in_progress|shipped`** and **`sort=top|new`** filter the board. On
  `/feedback` they are written back as the reader changes tabs; in the drawer they are read on
  arrival and never written, because a host page owns those names (`/projects?status=`, Explore, the
  wallet). The drawer's own parameters are removed on close and every other parameter is kept
  byte for byte.
- Every entry is stamped `fClientNav: false` and the page's own entry is re-stamped before a push
  (the `?tkv=` recipe, Decision #95). An idea under review answers `/feedback?idea=…` with a "not on the
  board" notice and a way back to anyone but its author and operators.
- On `/feedback` only a move OFF the board pushes (board → idea); an idea opened from another idea
  or from the suggestion dialog replaces the entry it is on, so Back — and **All ideas**, which steps
  back over the one pushed entry — always returns to the board.
- Every view's canonical is `/feedback` (`noindex` on an idea under review, a refused idea and a
  board that could not be read); the JSON-LD `ItemList` names each public idea by its row's anchor,
  `/feedback#<fbk-slug>` (Decision #272 (H)).

| Path | Method / body | Delegates to |
| :-- | :-- | :-- |
| `/api/feedback/ideas` | `GET` `?status=&sort=&q=&limit=` | `FeedbackBackendService.board` — the board as the reader may see it (RLS: the public states; the reader's own ideas under review; everything for an operator) with every tab's count (`community.feedback_status_counts`); `q` is the composer's title search. `private, no-store`. |
| `/api/feedback/ideas` | `POST` `{ title, category, impact, body? }` | `.submit` → `community.submit_feedback_idea` — 201 with the idea (Under review); 401 guest; 422 field errors (a contact detail in any field is refused here, Decision #147); 429 + `Retry-After` past five a day. |
| `/api/feedback/ideas/[id]` | `GET` | `.idea` — the idea (by `fbk-` slug), its status history and up to three related ideas. 404 for a non-slug, and for an idea the reader may not see. |
| `/api/feedback/ideas/[id]/vote` | `POST` · `DELETE` | `.vote` → `community.vote_feedback_idea` / `unvote_feedback_idea` — idempotent `{ voted, voteCount }`; 401 guest; 404 unseen; 409 voting closed (Shipped); 429 past 120 an hour. |
| `/api/feedback/ideas/[id]/status` | `POST` `{ status?, note?, response? }` | `.moderate` → `community.moderate_feedback_idea` (the status move, then the response, in one transaction) — operators only (403 otherwise; there is no operator UI yet, #272 flag (a)); 409 for an illegal move. A move notifies the author and every voter. |

Live behind `COMMUNITY_BACKEND_LIVE`; with it off every route answers from the per-process fixture
store (the seed's sixteen ideas), which mirrors each door's rules.

### Saved API (Decision #180)

Thin routes over `SavedBackendService` (`@server/services/saved/`), Zod-parsing with the
`@projective/types/org` saved schemas and answering the flat `serviceResponse` envelope. Live only, like
the profile and files services: 401 for a guest, 503 under `dev:mock` or without Supabase (the client
rolls its optimistic change back; the Dev Context Switcher's `saved` axis substitutes client-side). A
`ref` is the key the surface routes by: a slug (service · product · article · project), a handle
(profile), or an id (project_channel · conversation · message · file).

| Route                            | Methods | Behaviour |
| :------------------------------- | :------ | :-------- |
| `/api/saved`                     | `GET` `?tab=&collection=&cursor=&limit=` | `SavedListParamsSchema` → `.list`: the tab's kinds from every store, sorted (saves newest first, rows with no saved instant after, follows last), one page resolved for display → `{ items, nextCursor, collections }`. 422 bad param. |
| `/api/saved`                     | `POST` `{ type, ref, collectionId? }` | Save (idempotent) → `.toggle`, dispatched to the kind's store: `org.user_bookmarks` · `projects.user_preferences.is_starred` · `comms.set_dm_starred` · `comms.message_favorites` · `files.items.starred`. `collectionId` files a bookmark kind (`null` = unfiled; 422 on any other kind; 404 for a collection not the caller's) → `{ saved, collectionId }`. 404 for a ref the caller cannot see. |
| `/api/saved`                     | `DELETE` `?type=&ref=` | Un-save (idempotent) → `{ saved: false, collectionId: null }`. |
| `/api/saved/state`               | `GET` `?keys=type:ref,…` | Which of up to 100 keys the caller has saved → `{ saved }` (the keys as asked). Kinds: service · product · article · profile · project — the cards and lanes whose own read carries no flag. 422 for another kind. |
| `/api/saved/collections`         | `GET` · `POST` `{ name }` | The caller's collections → `{ collections }`; create one → `{ id, name }` (201; 409 when the name is taken). |
| `/api/saved/collections/[id]`    | `DELETE` | Delete one; its bookmarks stay saved, unfiled → `{ id }`. |
| `/api/messages/[id]/pin`         | `POST` · `DELETE` | Pin / unpin a message for everyone in its room (a conversation's or a project room's) → `MessagingBackendService.setPinned` → `comms.message_pins` → `{ pinned }`. 404 for a message the caller cannot read. |

### Public metrics API (Decision #277)

| Route | Method | Behaviour |
| :-- | :-- | :-- |
| `/api/public/metrics` | `GET` · `HEAD` · `OPTIONS` | The public site's live figures — `PublicMetricsService.get()` in the flat `{ ok, …PublicMetrics }` envelope (`@projective/types/marketing`): `asOf`, `minN`, `platformFeeBp`, `totalValueProtected` (`{ amountMinor, currency, converted }` — `converted` is `true` when several currencies were summed at reference rates, and the landing then hides it; Decision #301 (A)), `stagesDelivered`, `medianFundingToApprovalHours`; a `null` figure is below the threshold and its tile is hidden. No parameters, no session. `defineReadRoute` with the `public-metadata` cache policy and a strong `ETag`; a failure (503 / 502) is `no-store`. `/about` reads the same service server-side and never fetches this from the browser. |

### Workspace (Teams & Businesses) API

Live-only since 2026-09-28 (root `CLAUDE.md` §8 Decision #61): no fixture branch and no backend gate.
Every route is thin — HTTP parsing, Zod (`@projective/types/workspace`), the acting principal from
`readActor(ctx)` — then one `WorkspaceBackendService` method, which calls one definer RPC
([`database/org/Functions.md` § The workspace console](../database/org/Functions.md#-the-workspace-console-00001020)).
A guest is a 401. Every write answers the RE-READ console (or `null` when the caller removed
themselves or left in a transfer), so an island adopts the server's state. RPC refusals map
`22023 '<field>: <reason>'` → 422 with `fieldErrors[field]`, `42501` → 403, `P0002` → 404,
`23505` / `55000` → 409, `23514` → 422.

| Route                                | Method                | RPC                                                                                     |
| :----------------------------------- | :-------------------- | :-------------------------------------------------------------------------------------- |
| `/api/workspace/roster`              | `GET · HEAD · OPTIONS` (`?kind=`) | `org.get_workspace_roster(kind)`                                                        |
| `/api/workspace/detail`              | `GET · HEAD · OPTIONS` (`?kind=&ref=`) | `org.get_workspace_detail(kind, handle_or_id)`                                          |
| `/api/workspace/bench`               | `GET · HEAD · OPTIONS` (`?ref=`) | `org.get_business_bench(handle_or_id)` — the Talent module's bench (its retry; the page reads it server-side); `hire` holders only (403), Decision #241 |
| `/api/workspace/handle`              | `GET`                 | `org.check_handle(handle)` — the create form's probe; a **taken** handle is answered with up to three alternatives the namespace says are free (`suggestions`, probed by the service from `handleAlternatives`), a malformed or reserved one with none |
| `/api/workspace/create`              | `POST`                | `org.create_workspace(kind, name, handle)` → 201. The plan's ownership cap is a **402** with `details` `{ reason: "entitlement", entitlement: "teams_owned" \| "businesses_owned" }`; a handle claimed between the probe and the insert (`23505`) a **409** keyed to `handle`, on which the form re-runs its check |
| `/api/workspace/update`              | `POST`                | `org.update_workspace` (name, tagline) · `org.set_workspace_status` (publish / archive / restore) |
| `/api/workspace/invite`              | `POST`                | `org.invite_workspace_member` (by handle **or** email)                                  |
| `/api/workspace/invite-action`       | `POST`                | `org.revoke_workspace_invitation` · `org.resend_workspace_invitation` (the inviting side) |
| `/api/workspace/invite-respond`      | `POST`                | `org.respond_to_workspace_invitation` (the invitee). A refused accept is typed by `details.reason`: `persona` (403, Decision #228 (A)) · `payout_not_ready` (403, with `href` to `/settings/verification`, Decision #196) · `seat_cap` (409, the team's `team_seats` cap — `org.fn_assert_seat`'s `55000 plan:`, which on this door is never anything else). The roster's invitation strip words each one beside its row |
| `/api/workspace/member`              | `POST`                | `org.update_workspace_member` (role, overrides, title, reports-to, spend envelope, remove / leave) |
| `/api/workspace/transfer-ownership`  | `POST`                | `org.transfer_workspace_ownership`                                                      |
| `/api/workspace/role`                | `POST`                | `org.upsert_workspace_role`                                                             |
| `/api/workspace/role-archive`        | `POST`                | `org.archive_workspace_role` — replaces the retired `role-delete` (nothing is hard-deleted) |
| `/api/workspace/payout`              | `POST`                | `{ rule?, stakes? }`, at least one: `finance.save_split_rule` (the template, written first; 402 when the team's plan lacks its `split_template_<type>` flag) then `finance.save_team_split` (the stakes) |
| `/api/workspace/payout/preview`      | `GET · HEAD · OPTIONS` (`?workspaceId=&amountMinor=&currency=`) | `finance.preview_team_split(team, gross)` — what a release of `amountMinor` (1 … 10^12 minor units of `currency`) pays under the team's SAVED split, line by line (fee · finder · vault cut · members · dust, total = the amount); `manage_finances` holders only (Decision #233 (b)), anyone else `403`; writes nothing (Teams C4) |
| `/api/workspace/spend`               | `POST`                | `finance.save_spend_policy` — a patch; each `limits` entry carries only the keys that moved (`canSpend` · `limitMinor` · `perTransactionMinor` · `period`, Decision #246) |
| `/api/workspace/spend/preview`       | `POST`                | `finance.preview_spend_envelope` — the envelopes a draft patch (the `/spend` body) would produce; writes nothing |
| `/api/workspace/spend-decide`        | `POST`                | `finance.decide_spend_approval`                                                         |
| `/api/workspace/spend-withdraw`      | `POST`                | `finance.withdraw_spend_approval` — the requester takes back their own pending spend request (Decision #246) |
| `/api/context/switch`                | `POST`                | `security.switch_session_context` · `switch_team_context` · `switch_enterprise_context` · `clear_session_context` |
| `/api/context/enterprises`         | `GET`                 | RLS reads of `org.enterprise_members` (own active rows) + `org.enterprises` — the enterprises the caller owns or actively belongs to, archived excluded (the account switcher's third list; Decision #149) |

An over-limit spend REQUEST is not a workspace route: it is filed from the wallet surface through
`finance.request_spend_approval`. A context switch re-stamps the JWT: the route re-issues the session on its own response (or answers
`claimsStale: true`, Decision #193) and the caller hard-navigates, because the access-token hook is what
turns the stored context into claims.

The reserved-word denylist is **implemented** as the SSOT const + guard
**`RESERVED_HANDLES`/`isReservedHandle`** in
[`@projective/types/profile`](../../packages/types/profile/reserved.ts) (root `CLAUDE.md` §8
Decision #36). It is the second line of defence beyond Fresh's static-route precedence: it stops a
**bare** word with no static route (`/availability`, `/files`) from being fabricated into a profile,
and it is the rule a future "claim your handle" flow must validate against. The fat
`ProfileBackendService` refuses a reserved word before it asks the database (404), and
`routes/[handle]/_middleware.ts` resolves the live profile onto `ctx.state.profile` with its outcome
on `ctx.state.profileStatus` — `200`, `404` for a reserved, unknown or hidden handle (the three are
deliberately indistinguishable), or `503` when the database could not be asked — so the shared
layout paints a calm not-found or an honest "try again", never a fabricated profile. (Profiles are
live-only since 2026-09-23; there is no stub profile to fabricate.) In development only, the same
middleware lays the Dev Context Switcher's business page state (`pj.dev.business-page`, Decision
#244) over a business's read, and its team page state (`pj.dev.team-page`, Teams P1) over a team's:
a member's hidden reason (draft · archived · invite-only), or `missing` — the outsider's `404`.

### Messaging, hiring-handshake & link API (Decision #128)

Thin routes: Zod from `@projective/types/{messaging,projects,links}`, the actor from `readActor(ctx)`,
then one fat-service method. A guest is a 401 on every write.

| Route                                        | Method | Service → database                                                                  |
| :------------------------------------------- | :----- | :---------------------------------------------------------------------------------- |
| `/api/messaging/conversations`               | `GET` (`?folder=primary\|requests\|archived`, `view`, `role`, …) | `MessagingBackendService.conversations` — the folder is the VIEWER's (`dm_participants.inbox_folder`) |
| `/api/messaging/conversations/[id]/folder`   | `POST` `{ folder }` | `MessagingBackendService.setFolder` → `comms.set_dm_inbox_folder` (404 for a conversation with no thread yet) |
| `/api/messaging/conversations/[id]/context`  | `GET`  | `MessagingBackendService.context` → `projects.get_engagement_context` (the context panel) |
| `/api/messaging/attachment-source`           | `GET` · `HEAD` (`?assetId=<uuid>&conversationId=`) | `MessagingBackendService.attachmentSource` → `live-attachment-source.ts` — the messages a `files.items` asset was posted in that the caller can read (RLS `view_attachments_if_member`), newest first, each with its `?m=` link; `conversationId` (a thread or room uuid, or `dm-{handle}`) narrows it. `400` with no `assetId`; a guest or a failure gets `[]`; ETag via the read-endpoint factory (Decision #162) |
| `/api/projects/hire`                         | `POST` | `ProjectBackendService.hire` → `projects.invite_to_project`, then the intro via `comms.send_request_message`; a cooldown refusal is 422 with `details.reopensAt`, the rate limit 429 with `details.retryAt` |
| `/api/projects/apply`                        | `POST` `{ projectId, stageId, roleId, message, teamId }` → 201 | `ProjectBackendService.apply` — the proposal allowance's pre-flight gate first (a refusal is 422 with `errors.allowance` + `details.blockReason`, and `entitlement.denied` recorded through `finance.record_proposal_denial`; Decision #154), then `projects.apply_to_project`, then the cover note via `comms.send_request_message` |
| `/api/projects/applications/withdraw`        | `POST` `{ applicationId }` | `ProjectBackendService.withdrawApplication` → `projects.withdraw_application`; the status flip refunds one weekly proposal unit (Decision #154) |
| `/api/projects/applications/mine`            | `GET` (`?project=<slug>`, `?team=<team id>`) | `ProjectBackendService.sentApplications` → `projects.list_my_applications` — the viewer's sent proposals (and their teams'), newest first; `team` narrows to the applications filed for that team (the team console's Proposals view, Teams C5) and never widens the viewer's list; `no-store` |
| `/api/projects/invites/respond`              | `POST` `{ invitationIds, accept }` | `ProjectBackendService.respondToInvitations` → `projects.respond_to_project_invitation`, once per invitation of the request |
| `/api/projects/applications/accept`          | `POST` `{ applicationId }` | `ProjectBackendService.acceptApplication` → `projects.assign_from_application`; answers `fundHref` |
| `/api/projects/[id]/stages/[stageId]/invite-link` | `GET` · `POST` `{ action: ensure\|reset\|revoke }` | `InviteLinkService.stageLink` (reads the active link, never mints) · `InviteLinkService.act` → `projects.get_stage_invite_link` / `projects.revoke_stage_invite_link` (Decision #145) |
| `/api/projects/invite-links/redeem`          | `POST` `{ token, message }` → 201 | `InviteLinkService.redeem` → `projects.redeem_invite_link`; a refused state keeps its status (409 duplicate, 422 turned off / closed / no profile) |
| `/api/links/preview`                         | `POST` `{ urls }` (1–20) | `LinkPreviewBackendService.previews` — signed-in only, 30 per minute, `private, no-store` |

A conversation addressed as `dm-{handle}` with no thread yet resolves to a VIRTUAL conversation on
the live path (an empty page, never a minted thread), so an invitation notification's
`/messages/dm-{inviter}` link always lands somewhere answerable.

### Operator dispute desk (Decision #212)

`/admin/disputes` (`routes/(dashboard)/admin/disputes.tsx` → `features/admin/routes/DisputeDeskScreen.tsx`)
is the platform operator's dispute queue. It lives under the reserved `admin` segment (`RESERVED_HANDLES`,
`org.fn_is_reserved_handle`), so no handle can shadow it and a bare `/admin` is a 404. **The queue read
is the gate:** `finance.list_disputes_for_review` refuses anyone but `security.is_admin()`
(`ops.admin_users`) and the controller turns that refusal — or no session, or no live database — into a
**404**, so a non-operator never learns the desk exists and never receives a ruling control. A case
is **never a URL**: it opens in a dialog over the queue and is read and ruled through the API by id
(Decision #88 — a uuid does not route, and disputes carry no opaque slug). PRODUCT_SPEC's party-facing
`/disputes` pages remain unbuilt; a party reads their case in the session sidebar. In development the
Dev Context Switcher's `operatorDesk` axis (`pj.dev.operator`) renders sample cases instead; it grants
nothing.

| Path | Method / body | Delegates to |
| :-- | :-- | :-- |
| `/api/finance/plans` (**Planned**, #252) | `GET · HEAD` | `PricingBackendService.catalogue` → `finance.get_public_plan_catalogue()` (a definer granted to `anon`, since both plan policies are `authenticated`-only today); adds the caller's `current` plan when signed in. Public cache for a guest, private otherwise |
| `/api/finance/subscriptions/checkout` (**Planned**, #252 (f)) | `POST` `{ planCode, cycle, subject }` | `SubscriptionBackendService.startCheckout` → a Stripe Billing Checkout URL; 402 `PK402` · 403 cannot bill this subject · 409 already on it |
| `/api/finance/disputes` | `GET` `?status=open\|awaiting_response\|under_review` (optional) | `DisputeBackendService.queue` → `finance.list_disputes_for_review` (operator only, else 403) |
| `/api/finance/disputes/[disputeId]` | `GET` | `DisputeBackendService.get` → `finance.get_dispute` (a party or an operator; 404 otherwise) |
| `/api/finance/disputes/[disputeId]/resolve` | `POST` `{ outcome, payeeShareBp, notes }` | `DisputeBackendService.resolve` → `finance.resolve_dispute` (operator only, else 403) |

## Thin controllers / fat services

Routes only parse + validate + guard, then delegate. The handler → service → `page(data)` pattern is
shown in `projects/[projectSlug]/index.tsx`. Islands never fetch — data is hydrated via props
(SYSTEM_ARCHITECTURE §State Hydration).

## Feature folders & islands

Route controllers may grow into `apps/web/features/[group]/[sub]/` (per PRODUCT_SPEC §Directory
Structure); `routes/` then re-exports them. Islands live in a `features/**/islands/` folder and are
auto-discovered by `vite.config.ts` (`discoverFeatureIslands` → `islandSpecifiers`). Example:
`features/dashboard/home/islands/WorkloadGauge.island.tsx`. Path aliases: `@web/*`, `@features/*`,
`@ui/*`, `@projective/ui`, `@server/services/*` — never `../../../` across boundaries.

## Aliases in use

`@web/` → `apps/web/` (routes import `@web/utils/state.ts`, `@web/components/…`). Declared in the
root `deno.json` import map alongside `@features/`, `@ui/`, `@server/services/`.
