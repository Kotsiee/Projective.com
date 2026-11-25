# Routing & Folder Conventions (`apps/web`)

> Companion to [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) §2 and the sitemap in
> [`../business/PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) §Sitemap. Fresh 2.x (Vite) file-based
> routing. This documents the skeleton that lives under `apps/web/routes/`.

## Route groups (URL-transparent)

Parenthesized folders group routes **without** adding a URL segment:

| Group                     | Purpose                                                                                      | Auth        |
| :------------------------ | :------------------------------------------------------------------------------------------- | :---------- |
| `routes/(public)/`        | Marketing + auth (landing, about, explore, help, view, login/join/…)                         | none        |
| `routes/(public)/(auth)/` | Auth screens `/join` · `/login` · `/verify` · `/verify/confirm` · `/forgot-password`, rendered bare in their own full-window chrome (`AUTH_PATHS` in `(public)/_layout.tsx`) | **inverse guard** (a valid session is sent on, §Special files) |
| `routes/(dashboard)/`     | Authenticated app (home, projects, businesses, teams, messages, wallet, settings, services, …) | **guarded** |
| `routes/[handle]/`        | Public profile namespace — users, teams, corporations by `@handle`. Every top-level segment the other groups serve is a reserved handle (the namespace guard, §Reserved-handle precedence) | none        |
| `routes/(standalone)/`    | Shell-free pages — the file inspector (`/inspect/:fileId`) and a guest's invitation (`/rsvp/:token`). **No `_layout.tsx`**: only `_app.tsx` wraps them (tokens, a11y, DevMount), so no `UserShell`/`GuestShell` renders (Decision #161(C)) | none (session renewed) |

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
  `ImpressionTracker`'s `discovery.*` batches, and a service or product page's one `discovery.view`
  from `ListingViewBeacon`; a crawler or headless client is answered `202` with nothing stored). See
  SYSTEM_ARCHITECTURE §Discovery telemetry.
- `/api/explore/views` — `POST { id }`, SIGNED-IN only (a guest gets 401): the results drawer's
  in-place open, recorded as a view by a background beacon (`ExploreService.recordView`). A page a
  reader navigates to — `/view/[entity]`, `/[handle]/view/[item]`, `/[handle]` — records itself
  server-side instead. `/explore` renews a lapsed session in its handler (the `[handle]` model) because
  its Home feed is personalised. See SYSTEM_ARCHITECTURE §Discovery (Explore) services, Decision #178.
- **The discovery query contract (COMMS SR2, CAS S37).** `/explore` and `GET /api/explore/search`
  read their query through one door (`features/explore/core/explore-state.ts`
  `inspectExploreQuery`) into `ExploreParamsSchema`: `q` at most 512 characters; `sort` one of
  `best_match` · `recommended` · `rating` · `price_asc` · `newest`; `category` a discovery category
  (`?type=` is its legacy alias); facets only under `EXPLORE_FACET_KEYS` (the ids the sidebar's
  facet lists declare), at most 20 values of at most 64 characters each, as repeated keys or comma
  lists; on the API only, `offset` 0–10,000 and `limit` 1–60. The page also carries `item` (the
  results drawer), `settings`, `feedback` and `utm_*` for their own owners. Anything else, and any
  value out of bounds, is corrected: `/explore` answers **308** to the canonical address (those
  carried keys kept), and the API answers **422** naming each key. The front page `/` still hands a
  search to `/explore` with its query (303, `front-page.ts`), and renders its Home in place for
  anything else, so a campaign link to it keeps its address. No other key reaches the search or `search.query_logs.filters_applied`.
  A search embeds its query within the caller's budget (30 query embeddings a minute, keyed by the
  signed-in user or the client address); past it the search ranks heuristically (development
  header `x-discovery-ranking-reason: client_budget`) and is never a 429.
- `routes/_middleware.ts` — stamps `isAuthenticated` / `userContext` on every request from the
  `sb-access-token` cookie only once it **verifies** (`session.ts` `resolveRequestViewer` →
  `AuthBackendService.verifyAccessToken`: signature against the project JWKS or the HS256
  `SUPABASE_JWT_SECRET`, expiry, `sub` + `aud: authenticated`; local, cached keys, Decision #205). A
  tampered or expired cookie is a guest here; it never renews.
- `routes/(dashboard)/_middleware.ts` — **auth guard**, three gates read from the token: (1) a
  verified access token passes; an invalid or expired one with a refresh cookie renews in place;
  with none it is cleared and sent (`302`) to `/login?redirectTo=`; unobtainable signing keys or an
  unreachable GoTrue answer `503` with the cookies kept. (2) **Onboarding bounce:** a federated
  sign-up with no `org.users_public` row yet is sent back (`302`) to `/join` to finish, and an
  enterprise owner with none (an account from before step 1.6 asked for the owner; its
  `user_metadata.objective` is `enterprise`) to `/join?complete=owner`
  (`resolveOnboardingBounce`, `features/auth/core/auth-routing.ts`). (2b) **Terms bounce:** an
  onboarded account whose token says `termsDue` (a material new version of the Terms or the Acceptable
  Use Policy is in effect and not yet accepted, Decision #446) is sent (`302`) to
  `/join?complete=terms&redirectTo=…` (`resolveTermsBounce`), after one renewal re-reads a stale
  claim. (3) **Who may see the page:** a
  restricted (13–17) account is sent `303` to `/home` from every `isRestrictedPath` surface, and
  `/teams*` is freelancer-only: a client, or an operator-mode account not acting as a team, is sent
  `303` to `/home?notice=teams-freelancer` (Decision #228 (A);
  `features/shell/core/restricted-surfaces.ts`). An unconfirmed email has no gate of its own:
  `enable_confirmations = true` means GoTrue issues no session before confirmation (#336, IDG §4).
- `routes/(public)/(auth)/_middleware.ts` — the **inverse guard**: a visitor with a VALID session on
  `/login` or `/join` is returned to their captured `redirectTo` (or `/home`) instead of being asked
  to authenticate again or walked back through onboarding. A tampered or expired cookie is not
  bounced, so no loop forms with the guard above (`safeRedirect` also refuses auth paths).
  `/join?oauth=…` is exempt — the OAuth callback signs a NEW identity in and then sends them there
  to create their profile — and so are `/join?complete=owner`, where the dashboard guard sends a
  signed-in, profile-less enterprise owner, and `/join?complete=terms`, where it sends a person whose
  acceptance is due (Decision #446).
- `routes/(standalone)/_middleware.ts` — renews the session without redirecting (the
  `[handle]/_middleware.ts` model: `ensureSession`, then `accessToken`, `isAuthenticated` and a
  refreshed `userContext`, and the set/clear cookies appended to the response), so an expired access
  token does not read a signed-in viewer as anonymous. Never a guard: a guest and a share-link holder
  pass, and the page's own read decides what they see.
- `_layout.tsx` per group — shell chrome; `(dashboard)` mounts the dual-nav + Splitter. `(standalone)`
  deliberately has none — the only route group that renders no shell at all (Decision #161(C)).
- `(public)/_layout.tsx` resolves the public shell by auth state — `GuestShell` for a guest,
  `UserShell` for a signed-in visitor — with two path exemptions, checked in order:
  - `AUTH_PATHS` (`/join`, `/login`, `/forgot-password`, `/verify`, `/verify/confirm`) render bare;
    the auth screens own their full-window chrome.
  - `LANDING_PATHS` (`/features` alone — `/` is the Explore Home in the guest shell and sends a
    signed-in visitor to `/explore`, Decision #349) render in **`LandingShell`**
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
    (`features/landing/core/header.ts`): "How it works" (`/features#demo`), "Explore" (from
    1024px), "Pricing" (`/features#pricing`) and, since L5, "Features" (`/features`); the anchors
    are written with their page (Decision #349 moved the sections off `/`), so they work from any
    page, and the link to the page being viewed carries `aria-current="page"` (on `/features`,
    "Features"; on `/`, none).

## Dynamic segments (examples in the skeleton)

| Pattern                 | File                                                         | URL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| :---------------------- | :----------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| projects feed           | `projects/index.tsx`                                           | `/projects` — the **portfolio index**: every project in the acting workspace, `?status=` filtering it, and the landing every bounced engagement URL is sent to (a `?notice=` flash, `ProjectNoticeHost`). **`/projects?create=1`** opens the project **Quick-Init modal**, the only project-create surface: the lane island (`ProjectsLane`) reads the marker on load, strips it with `replaceState` (an instruction, not feed state, so a reload or Back never reopens it) and opens the modal. Its entry points: the header **Create menu**'s Create Project and the mobile **BottomNav**'s Create (one constant, `PROJECT_CREATE_HREF` in `features/shell/core/actions-model.ts`, re-exported as `BOTTOM_NAV_CREATE_HREF`; Decisions #295, #296 (B)), the **site footer**'s "Post a new project" / "Post your first project" (`POST_PROJECT_HREF`), the portfolio's empty-state action and the member CTAs on `/about` and the articles. A guest is sent to sign in and returned here. There is no `/projects/new` (it would fall into `[projectSlug]`) and no `/create`. The lane's feed query (`serializeProjectParams`) carries `?sort=` with `?dir=asc|desc`, the direction written only when it differs from the sort's natural one (Decision #323). A freelancer's own **workload gauge** sits beside the title (`WorkloadGauge`, Decision #550): the handler reads `ProjectWorkloadService.mine` for a viewer with `isFreelancer`, so the server draws the figures; there is no query parameter, because the load is only ever the caller's. |
| workspace: Overview     | `projects/[projectSlug]/index.tsx`                             | `/projects/:projectSlug` — the engagement's **Overview** (Decision #144): the command center for its owner and every participant — Needs you · Brief · Inclusions & terms · Project files · the stage run · updates, with an aside of the participant's own work, Messages and People (Decision #163), composed by `ProjectBackendService.workspace`. The root DISPATCHES on access × lifecycle (`landingFor`, `@projective/types/projects`): the owner of a published project and every participant → the Overview; the owner's **draft** → `303` `/details` when they configure it; a **service** (`kind = service`) → the Overview for both its client and its seller, draft included, so its client never reaches a configuration they may not edit (Decision #427); a **prospect** → `303` the public listing `/view/:projectSlug?type=projects` (a prospect on a draft → `303` `/projects?notice=project-not-found`). Access (`viewerAccess`: owner · participant · prospect) is derived server-side from `projects.has_project_access`. Every exit is a `303`, never a cacheable `308`, because each depends on who is asking and on the project's state. **`?sell=<stage slug>`** opens the stage's request-to-sell dialog (MARKETPLACE SC7): the maker's form or request, or the client's decision, read by `catalogue.project_sale_requests`; the Overview's "Requests to sell" rows and the `sale_request.*` notices link it, and closing the dialog drops it. **`?review=<projectSlug>`** opens the review dialog (Decision #487): what the viewer may review here — each provider of a completed engagement or a seat released after work began, the provider of each of their completed session seats — read by `reviews.get_reviewables`; the Overview's Reviews block, the `review.reminder` notice and a review list's **Edit review** all link it; closing the dialog drops the parameter (`replaceState`). A value that is not the page's own slug opens nothing. |
| workspace guard         | `projects/[projectSlug]/_middleware.ts`                        | Every `/projects/:projectSlug/**` path except `/preview` (which guards itself): a **prospect** is sent to the public listing (`GET`/`HEAD` only; a draft answers "does not exist"), and everyone else passes with their access memoised on `ctx.state.projectAccess` — read by the page and by both band resolvers, so the three cannot disagree — and a default tab title ("Board · <project> · Projective"). In development only, the Dev Context Switcher's `pj.dev.landing` cookie may simulate the access and the status (Decision #144(G)). |
| workspace: Details      | `projects/[projectSlug]/details.tsx`                           | `/projects/:projectSlug/details` — the engagement's **configuration**: the setup surface, its progress ladder in the middle-nav header band (once published, the outstanding fixes in words, "3 stages need a price"), its actions in the footer band. Review authority only — the owner or an active member of the paying client business (`projects.can_review_project`, mirrored as `ResolvedProjectAccess.canConfigure`, Decision #163); anyone else gets a `303` to the Overview. Paired with Preview as the header band's `Details ⇄ Preview` modes (see the rule below). |
| project create → list   | `projects/create.tsx`                                        | `/projects/create` **308→** `/projects` (retired). Project creation is a **Quick-Init modal on `/projects`**, not a page. The file stays as a redirect shim rather than being deleted: without it the segment falls through to `[projectSlug]` and renders "project not found", which is a dead end reachable from every old link and bookmark, not a redirect.                                                                                                                                                                                                                                                                |
| workspace: Preview      | `projects/[projectSlug]/preview.tsx`                           | `/projects/:projectSlug/preview` — the brief exactly as a freelancer evaluates it on `/view/:id?type=projects` — the same `EntityViewPage` in `mode="preview"`, composed from the owner's own rows (drafts included) by `ExploreBackendService.projectPreviewPage`, minus the recommendation rails and reviews, with a one-line preview notice and the applicant's actions described rather than offered (Decision #142). Guarded server-side: signed in, then review authority (the owner or an active client-business member, `canConfigure` — Decision #163); a **draft** must also have finished its required setup steps (`previewReady`), while a **published** project always previews — its listing is already public (`previewAllowed`, Decision #144). Anyone without review authority gets a `303` to `/projects/:projectSlug`, whose own dispatch places them (before Decision #163 a non-owner was sent to the public listing); a reviewer who may not preview yet gets a `303` to `/details`. The tab that leads here renders locked until then, and a control disabled in the interface but open at its URL is a gate that only holds for people who did not type the address. |
| project edit → details  | `projects/[projectSlug]/edit.tsx`                              | `/projects/:projectSlug/edit` **308→** `/projects/:projectSlug/details` (retired). "Edit" meant the editor, which lives at `/details` since Decision #144; the file stays so a bookmark or an old notification link still lands on it.                                                                                                                                                                                                                                                                                                                                                                                     |
| project settings → details | `projects/[projectSlug]/settings.tsx`                       | `/projects/:projectSlug/settings` **308→** `/projects/:projectSlug/details` — the word people guess for the configuration. Without this static route the segment fell through to `[channelId]` and rendered an empty room with a working composer.                                                                                                                                                                                                                                                                                                                                                                              |
| nested `[id]`           | `projects/[projectSlug]/[channelId]/index.tsx`                 | `/projects/:projectSlug/:channelId`. A ref that names no room this viewer can enter (the rule `resolveChannelMeta` titles the header band with) is a `303` to the engagement's Overview with `?notice=room-not-found` (`[channelId]/_middleware.ts` → `core/room-guard.ts`), never an empty room.                                                                                                                                                                                                                                                                                                                            |
| files (project)         | `projects/[projectSlug]/files.tsx`                             | `/projects/:projectSlug/files` (File Explorer: All files · the client's Project files · channels; a Task drops the Channels header). `?in=` addresses the tree node (Decision #317): absent = All files, `project` = Project files, else a room's route ref (`discussion`, a stage's `stg-…` slug, another room's id — never a stage room's uuid); resolved server-side with the page and the whole channel index, pushed on a tree press and walked by Back. The middle-nav header band (`explorerHeaderFor`) carries the node's title and the explorer's toolbar |
| files (channel)         | `projects/[projectSlug]/[channelId]/files.tsx`                 | `/projects/:projectSlug/:channelId/files` (File Explorer, one channel). The left panel draws the project's file tree with this channel selected; every node is a link to its own address (All files and Project files to `/projects/:projectSlug/files[?in=project]`, a room to `/projects/:projectSlug/:ref/files`) — Decision #317 |
| attachments → files     | `projects/[projectSlug]/attachments.tsx` (+ nested)            | `/…/attachments` **308→** `/…/files` (legacy)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| submissions (project)   | `projects/[projectSlug]/submissions/[...path].tsx`             | `/projects/:projectSlug/submissions/*` (Submissions ledger; Stages as tree roots; wildcard tree path). The middle-nav header band (`explorerHeaderFor`) carries the node's title and the explorer's toolbar, from the same request-memoized page read (`resolveSubmissionPageOnce`, Decision #317) |
| submissions (channel)   | `projects/[projectSlug]/[channelId]/submissions/[...path].tsx` | `/projects/:projectSlug/:channelId/submissions/*` (channel submissions; wildcard tree path)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| calendar (project)      | `projects/[projectSlug]/calendar.tsx`                          | `/projects/:projectSlug/calendar` (Calendar & Schedule — whole engagement; **303 → the project on a Task**; read-only — no composer, drag-move or edit, since no door keeps an engagement's entries (Decision #343, ruling C7 (a)); addressed as `?view=&date=&zoom=` with `/calendar`'s value sets and no `kind` or `availability`, an invalid value **303ing** to the canonical address (Decision #413); read over a window around `date` (−180 / +365 days) through `GET /api/scheduling/calendar?around=`, "Not loaded" past it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| calendar (channel)      | `projects/[projectSlug]/[channelId]/calendar.tsx`              | `/projects/:projectSlug/:channelId/calendar` (channel/stage schedule; a stage channel scopes to that stage; **303 → the room on a Task**; read-only, addressed and windowed as the row above)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| timeline (project)      | `projects/[projectSlug]/timeline.tsx`                          | `/projects/:projectSlug/timeline` (Timeline / Gantt — one lane per stage, the stage's scheduled window + every dated ticket, dependency links; a ONE-OFF engagement's "board" view link lands here. A projection over the board read, so a bar and a card cannot disagree about a date; root `CLAUDE.md` §8 Decision #91; **303 → the project on a Task**) |
| timeline (channel)      | `projects/[projectSlug]/[channelId]/timeline.tsx`              | `/projects/:projectSlug/:channelId/timeline` (one stage's Gantt — the stage's window, then one lane per ticket; the channel header's **Timeline** tab, gated exactly like Tasks; **303 → the room on a Task**) |
| meeting room            | `(dashboard)/meet/[roomSlug].tsx`                            | `/meet/rom-…` — into a meeting room as the signed-in person: `303` to that person's link while the room is open, else a page saying why not. The address external calendars and notices carry, so a provider's link never leaves the server early (Decision #383). `no-store`, no referrer |
| calendar hub (personal) | `(dashboard)/calendar/index.tsx`                             | `/calendar` (the acting account's own agenda — the UNION of the two rows above across every engagement, over its own working hours and booked leave. `?event=<id>` names the entry in the inspector and `?routine=<rtn- slug>` a routine (Decision #389); it holds one or the other, so writing either drops both. `?filter=invitations` narrows the grid and the lane to the invitations waiting on the reader, and stands beside either (Decision #390). The body is the grid alone; the lane and both bands are resolved per-URL by `features/calendar/core/calendar-slots.tsx`. Read by `GET /api/scheduling/personal?around=` and its host's own entries written by `POST` · `PATCH` · `DELETE ?eventId=` `/api/scheduling/events` (Decision #328 (a)) — the only entries any calendar authors: an `.ics` import is read into this visit's view, read-only and unsaved, never authored (Decision #440, amending #343 C7 (a)) — see [Scheduling, sessions & booking API](#scheduling-sessions--booking-api)). `?event=<event id>` opens that occurrence in the inspector on its week when it is on the agenda (the hand-off other surfaces link to, e.g. the catalogue client drawer, Decision #218(a), and where a reminder links), docked from 1280px and in the panel's drawer below it, painted in the first byte. A pick writes the same parameter with `replaceState`, so a reload lands on the entry in the inspector, and deleting the entry drops it (Decision #388). `?view=availability` (Decision #376) is the hub's second page — the acting owner's availability templates on a FULL PAGE: the header band's centred link tabs Events (`/calendar`) ⇄ Availability (`/calendar?view=availability`) switch them, and `calendar-slots.tsx` resolves the lane (Templates · Time off, with Scheduling settings and New template in its footer — the zone and publishing are Settings', Decision #378), the panel (the template's Settings · Services · Rules · Issues, or the open rule's editor — Decision #377), the footer band (the zoom ruler · Discard · Save — availability is one layer, so there is no Hours ⇄ Calls switch, Decision #408) and the header band's actions (Undo · Redo · Go to now) from the same URL, so either page ships in the first byte. `?preset=<avp- slug>` names the open template (a malformed or unknown slug reads as the default); the page keeps it in step with `replaceState` as templates are opened, created or saved. **The address contract** (Decision #413, which amends #376 and #338 ruling P7; `readCalendarAddress`, `features/calendar/core/calendar-address.ts`, tested): `?view=&date=&zoom=&kind=`, read by the controller so the first byte paints the asked-for period, and kept in step by the body with `replaceState` (no history entry) once the reader moves; the stored view and zoom are only the reader's default, used where the address names nothing. `view` = `day · week · month · timeline` (the grid, `CalendarViewMode`) or `availability` (the hub's second page, below); absent is Events at the stored view, and so is `?view=events` (accepted, equivalent — the canonical Events address stays the bare `/calendar`, which is what `calendarModeHref("agenda")` writes). `date` = an ISO day (`YYYY-MM-DD`, a real date from 1970) the agenda opens on, in the reader's zone, and the day the read is centred on. `zoom` = the Timeline's stop, `year · quarter · month · week · day` (`ZoomStop`), beside `view=timeline` only (on Day, Week and Month the view is the stop). `kind` = `event · reminder` (`EntryClass`, Decision #388's Event · Reminder filter; absent = both). A value the agenda does not answer — an unknown or impossible value, a parameter given twice, `zoom` off the Timeline, any of `date` / `zoom` / `kind` on the availability page — **303s** to the canonical address with it dropped and every other parameter kept in place. The agenda is read over a window around `date` (`calendarWindow`, −60 / +180 days), the page reports it (`SchedulePage.window`), the body reads the next window as the reader nears its edge, and the grid says "Not loaded" over a period outside it rather than drawing it as free (S-29). An under-18 account's availability address **303s** to `/calendar` (Decision #208). Read by `GET /api/scheduling/presets` (server-side through `ScheduleBackendService.presets`) and written by `PUT /api/scheduling/presets`, `POST /api/scheduling/presets/archive`, `POST · DELETE /api/scheduling/blackouts` and `POST /api/catalogue/availability`                                                                                                                                                                   |
| files hub (root)        | `(dashboard)/files/index.tsx`                                | `/files` (personal/entity asset library — re-exports the wildcard below, so the root and a deep folder resolve through ONE code path)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| files hub (deep)        | `(dashboard)/files/[...path].tsx`                            | `/files/*` (any folder, at any depth — a real, deep-linkable, shareable URL the tree, the breadcrumbs and the address bar all address identically; each segment is percent-encoded INDEPENDENTLY, so a folder literally named `a/b` never reads back as the pair `["a","b"]`). Headers: the inspector CSP profile (`cspHeaderFor("inspector")`, Decision #396), so the hub's preview modal can run WASM and blob workers                                                                                                                                                                                                                                                                                                                                                |
| catalogue console       | `(dashboard)/catalogue/index.tsx`                            | `/catalogue` (the seller console, plan §3.1 of `flows/CATALOGUE_REBUILD.md`; re-exports `features/catalogue/routes/console.tsx`). Every screen state is in the URL through the pure contract in `@projective/types/catalogue/url.ts` — `?view=listings\|analytics\|clients\|promotions`, `?type=`, the multi-select facets `?status=` · `?model=<delivery slug>` · `?category=<CREATE category>` · `?highlight=attention|promoted|best-selling` (comma lists; `status` defaults to draft · published · paused and is then omitted, Decision #221; the highlights were session state until Decision #312), `?search=`, `?sort=` / `?dir=`, `?period=`, `?scope=`, `?client=@handle` (the client drawer, `view=clients` only: choosing a row pushes it, Close drops it with `replaceState` and returns focus to the row), `?promo=new\|archive:<CODE>` (the Promotions view's one open dialog, `view=promotions` only: New code issues one, Archive confirms archiving a live code; Cancel or a close drops it with `replaceState`; a code that is not live opens nothing; MARKETPLACE CK2, Decision #536), and `?create=1\|product\|service[:<model>]`, which opens the Quick-Init modal. The islands write it with `pushState` / `replaceState` and follow `popstate`. A `?scope=` naming one listing (`svc-…` / `prd-…`) is a `303` to that listing's workspace tab (Decision #217(l)). The lane's search, Filter popover and Status ⟷ Highlights quick bar write these same parameters; its own continuity (the filter, the team-section choice and the open sections) is mirrored to the `pj_catalogue_lane` cookie (`path=/catalogue`), which `/catalogue/:slug` paints its lane from (Decision #323) |
| catalogue workspace     | `(dashboard)/catalogue/[id].tsx`                             | `/catalogue/:slug` (one listing's workspace, plan §3.2; re-exports `features/catalogue/routes/workspace.tsx`, whose handler lives in `workspace-handler.ts`). `:slug` is the listing's `svc-…` / `prd-…` address, the same one `/view/:slug` uses; anything else is the `303` in the row below, a listing that is not the caller's a `303` to `/catalogue`, and a read that failed a `503` that says so. The tab, Edit section, preview device, window and chosen buyer are in the URL — `?tab=edit\|preview\|analytics\|clients`, `?section=<edit section>` (the scroll-spy replaces it; on load the section is scrolled to and its heading focused), `?device=`, `?period=`, `?client=@handle`, `?cohort=open\|cancel:<ssn-…>` (a group-session listing's cohort dialog over the Availability section, Decision #498: `open` opens the next cohort, `cancel:` confirms cancelling the cohort whose FIRST sitting has that opaque slug — a cohort has no address of its own and a uuid never routes; opening pushes an entry, closing replaces it, any other tab drops it, and an address naming a cohort that can no longer be cancelled opens nothing) — through `parseWorkspaceUrl` / `workspaceHref`. A tab switch is a `pushState`, so Back returns to the previous tab |
| catalogue buyer simulation | `(dashboard)/catalogue/[id]/simulate.tsx`                 | `/catalogue/:slug/simulate` (the owner's buyer simulation, Decision #217 (j); re-exports `features/catalogue/routes/simulate.tsx`, handler in `simulate-handler.ts`). The real `EntityViewPage` in `simulation` mode, read as the OWNER (`CatalogueBackendService.previewView`, a draft included), in `bare` chrome, framed by the workspace's `?tab=preview`. A non-slug id, or a listing that is not the caller's, is a `404` (worded as a missing listing); an unreachable marketplace a `503`. Every answer carries the `framed` CSP (`frame-ancestors 'self'`) and `x-frame-options: SAMEORIGIN`. Its Book modal reads `GET /api/catalogue/simulate/slots`, the owner's slot grid, a read. No commit reaches the network |
| catalogue session plan  | `(dashboard)/catalogue/[id]/plan.tsx`                        | `/catalogue/:slug/plan` (a Session's or Group Session's session plan, Decision #525; re-exports `features/catalogue/routes/plan.tsx`, handler `sub-page-handler.ts`). The workspace's guards in its order: a non-slug is a `303` to `/catalogue?create=1`, a listing that is not the caller's a `303` to `/catalogue`, a failed read a `503`. Then any other delivery model is a `303` to `/catalogue/:slug?section=offer` (`subPageRedirect`). Part of the Edit tab: the header band, footer rig, lane and live-card panel are the workspace's, the tabpanel is `cat-ws-panel` on the same draft and saves, and every workspace URL move from here (a tab, the readiness ring, the locked Publish) is a navigation to `/catalogue/:slug` |
| catalogue buyer questions | `(dashboard)/catalogue/[id]/questions.tsx`                 | `/catalogue/:slug/questions` (a service's buyer-questions builder on the `IntakeField` engine, Decision #525; re-exports `features/catalogue/routes/questions.tsx`). The same guards and frame as the plan row; a product is a `303` to `/catalogue/:slug`. The Edit tab's `?section=questions` summarises the questions and links here. `/services` stays the reserved-handle `404` (Decision #443 (C), re-affirmed by #525) |
| no create page          | none                                                         | `/catalogue/new` has NO route file (a contract test walks `routes/` for one): creation is the console's Quick-Init modal. The `[id]` handler checks `isListingSlug` before any read, so `/catalogue/new` (or any non-slug) is a `303` to `/catalogue?create=1` |
| invite link (stage · workspace · seats · email invitation) | `(dashboard)/invite/[token].tsx` | `/invite/:token` (where an invite link lands — the token's SHAPE picks whose: an email invitation's 64 lowercase hex (PROJECTS NO1, Decision #566, `EmailInvitationLanding`) shows who invited the reader to what and as which role, with **Accept** and **Decline** only when the reader holds the invited address verified (`not_yours` names the address masked and links to `/settings/account#emails`); a guest arriving from the mailed link signs in or signs up through `/login` → `/join` with this path as `redirectTo` and lands back on it; a stage link's bare 24 base64url characters (Decision #145) show the project, the stage, who shared it; a team's or business's `w-` + 24 (Decision #318, `OrgInviteLanding`) show the entity, the role it offers and who shared it; a buyer's seat link `s-` + 24 (Decision #522, `SeatInviteLanding`) shows the group session, who shared it and how many seats are left, with **Claim your seat** (first come first served, nothing charged) while it is open to this person. The first two offer "Ask to join" only when the link is open to this person, which files a pending request and seats nobody. Inside `(dashboard)`, so a guest signs in first and returns here via `redirectTo`; the token is shape-checked before any read; `noindex` + `no-referrer` + `no-store` because the path is a capability) |
| share link              | `(public)/share/[slug].tsx`                                  | `/share/:slug` (the public resolution of a read-only share link — the one files surface a stranger can reach)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| outbound-link exit      | `(public)/exit.tsx`                                          | `/exit?url=…` (the interstitial an external link from a message passes through unless its scan came back safe — names the host, the verdict and why; asks for an explicit "I understand" before an unchecked or suspicious link and never offers a blocked one; never redirects by itself; `noindex` + `no-referrer` + `no-store`; Decision #128)                                                                                                                                                                                                                                                                            |
| newsletter: confirm     | `(public)/newsletter/confirm.tsx`                           | `/newsletter/confirm?token=` (`&notice=throttled` after a throttled press) — where the newsletter's confirmation mail lands (PRD-E11, Decision #480). It shows the topics and one Confirm button, a plain form posting the token to `POST /api/newsletter/confirm`; a GET writes nothing. It shows the address's standing, never the address: confirm · expired (7 days after the mail; "subscribe again" to the footer form, `#newsletter`) · subscribed (a link to unsubscribe) · unsubscribed. An unknown token renders the calm not-found state with a real **404**. `noindex` + `no-referrer` + `no-store`. Handler in `features/marketing/newsletter/routes/link-handlers.ts` |
| newsletter: unsubscribe | `(public)/newsletter/unsubscribe.tsx`                       | `/newsletter/unsubscribe?token=` — where a newsletter mail's unsubscribe link and a GET of its `List-Unsubscribe` URL land (PRD-E11). One Unsubscribe button posting to `POST /api/newsletter/unsubscribe` (or "Cancel the request" when a re-subscribe is pending on an address already unsubscribed); a GET writes nothing. Unknown token **404**. Same headers and handler module as the confirm page |
| auth: join              | `(public)/(auth)/join.tsx`                                   | `/join` — account creation, the canonical sign-up route (individual quick form ⇄ enterprise wizard, the age gate); reads the return path, account type, initial intent and any Google OAuth pre-fill off the URL; `/join?oauth=…` finishes a federated sign-up and is exempt from the inverse guard. `/join?complete=owner&redirectTo=…` is the completion state: a signed-in enterprise owner with no profile gives the name and date of birth step 1.6 asks for, as a one-step wizard (Decision #336, ruling I2). It is exempt from the inverse guard too, and anyone else who opens it (a guest, an account with a profile) is sent `302` to the captured `redirectTo`. `/join?complete=terms&redirectTo=…` is the re-accept state (Decision #446): a signed-in, onboarded person whose token says `termsDue` (or the Dev Context Switcher's `pj.dev.terms=due`) sees the changed documents and the consent box, posts `{ type: "terms", acceptTerms: true }` and returns to the captured path; it is exempt from the inverse guard, and anyone not due is sent `302` to `redirectTo`. Every path's final step carries the unticked consent box, linking `/legal/terms`, `/legal/acceptable-use` and `/legal/privacy` in a new tab. It supersedes `/register`, which has **no route file**: `/register` and `/reset` exist only in `AUTH_PATHS` (`features/auth/core/redirect.ts`) as never-a-destination prefixes, so both answer `404` (IDG §4.5) |
| auth: login             | `(public)/(auth)/login.tsx`                                  | `/login?redirectTo=` (`?notice=` e.g. after a reset) — Google OAuth, the Enterprise SSO entry and the email-or-`@handle` password sign-in; the return path is refused for any auth path |
| auth: verify            | `(public)/(auth)/verify.tsx`                                 | `/verify?email=&sent=&redirectTo=` — email confirmation by a 6-digit code, the resend throttle and the confirmation poll (`GET /api/auth/verification-status`, Decision #185) |
| auth: confirm link      | `(public)/(auth)/verify/confirm.tsx`                         | `/verify/confirm?token_hash=&type=email` (`&notice=throttled` after a throttled press) — where the confirmation email's button lands (Decision #445). It renders one Confirm button and spends nothing: the press posts a plain form to `POST /api/auth/confirm`, so a mail scanner opening the link leaves the token for the person. A malformed link **303→** `/login?notice=confirm_failed`. It reads no account (#185). `noindex` + `no-referrer` + `no-store`, because the token is in the URL. Handler in `features/auth/routes/confirm-handler.ts` |
| auth: forgot password   | `(public)/(auth)/forgot-password.tsx`                        | `/forgot-password?step=` — two-step recovery: a code by email, then the code and a new password (plus the address, when the page didn't send the code itself); the recovery email links to `?step=reset` and never carries the address, and a stray `?email=` is 303'd away (Decision #448); returns to `/login` with the captured return path |
| front page              | `(public)/index.tsx`                                         | `/` — the front page (Decision #349): a **guest** is served the Explore Home through the same controller as `/explore` (`exploreResponse`, `features/explore/routes/ExplorePage.tsx`), in the guest shell, under the front page's head copy (`landingPageMeta`, canonical `/`) and its JSON-LD (Organization + WebSite `SearchAction` into `/explore?q=`). Every other request is a `303` decided in `define.handlers`, never the page: `?demo=` → `/features?demo=…#demo` (the demo stage moved there); a signed-in session (`ensureSession`, renewed in place, its cookies minted on the redirect) or any search (`?q=`, `?category=`, a facet) → `/explore` with the same query. `?tkv=` needs no server strip: a guest's shell strips it, and a signed-in visitor carries it to `/explore`, whose shell opens the ticket |
| explore                 | `(public)/explore.tsx`                                       | `/explore` — the discovery surface (`ExploreScreen`), for every audience and the signed-in hub `/` sends to; a thin re-export of `features/explore/routes/ExplorePage.tsx`, the controller `/` shares (Decision #349): the Home feed with no query (personalised, so a lapsed session is renewed in place; canonical `/`, the address a guest reads it at), results otherwise. `?q=`, `?category=` (the legacy `?type=` is read, never written), `?sort=` (`best_match` · `recommended` · `rating` · `price_asc` · `newest`; absent = Best match with a query and Recommended without; the default is never written, and `best_match` without a query reads as `recommended`, Decision #459), and every other key a filter facet, repeatable or comma-listed; serialised in a stable key order by `serializeExploreParams` (`features/explore/core/explore-state.ts`, #339 (e)). A promoted slot (Decision #454) is no URL state: it is chosen server-side beside the organic results and never changes their order |
| pricing (**Planned**)   | `(public)/pricing.tsx` → `features/pricing/routes/PricingScreen.tsx` | `/pricing` — every public plan by audience over the two payment planes (Decision #252). Guest → `GuestShell`, signed-in → `UserShell`, the same body. **Lane-less**: no `pricingLaneFor` (a lane would be a second home for a plan purchase). `pricingHeaderFor(url, authed)` — pure, synchronous, `null` off `/pricing`, chained beside `viewHeaderFor` in `(public)/_layout.tsx` — mounts the plane switcher band (audience tabs + billing cycle), which carries no figure and no purchase control. Query: see "`/pricing` query" below. Canonical link `/pricing` with no query. The handle is reserved (`packages/types/profile/reserved.ts`). |
| legal hub               | `(public)/legal/index.tsx`                                   | `/legal` — the public legal hub (Decision #270): every legal document's version in effect today, in two groups, as a plain list. Controller `features/legal/hub/routes/LegalHubScreen.tsx` (re-exported). `noindex` while every document is a draft. |
| legal document          | `(public)/legal/[slug]/index.tsx`                            | `/legal/:slug` — one legal document (`terms` · `privacy` · `cookies` · `acceptable-use` · `copyright` · `escrow-terms` · `ip-transfer-deed` · `marketplace-licence`, #540); any other slug, and the reserved `workspace`, is a real `404`. `?v=<version>` pins a version (kept even when it is the current one, so a shared link keeps pinning); `?compare=<older>` diffs the shown version against an older one clause by clause; an unknown version is a `404` (an unknown document or version renders a not-found notice in the reading frame, `noindex`, one h1, with the current version and the hub as the ways back — Decision #296 (G)), an EMPTY parameter (the no-JavaScript form) a `303` to the clean address, `compare` equal to the shown version is dropped and a newer one swapped. The canonical is always the bare `/legal/:slug`; the page is `noindex` while its version is a draft and whenever it is pinned or compared. Resolver `features/legal/core/view.ts`; controller `features/legal/document/routes/LegalDocumentScreen.tsx` (re-exported) |
| legal document PDF      | `(public)/legal/[slug]/pdf.ts`                               | `/legal/:slug/pdf` (`?v=` optional) — that version as a PDF attachment, rendered by `LegalBackendService.documentPdf`; a content ETag (`304` on `If-None-Match`), `public, max-age=3600, must-revalidate`, `X-Robots-Tag: noindex` while a draft. Unknown slug or version → `404` |
| IP workspace            | `(dashboard)/legal/workspace/{index,audit-packs,transfers}.tsx` | `/legal/workspace` · `/legal/workspace/audit-packs` · `/legal/workspace/transfers` — the signed-in IP chain-of-title workspace, moved from the bare `/legal` by owner ruling (a) (Decision #270). In `(dashboard)`, so a guest is sent to `/login?redirectTo=…`; a static segment, so it outranks `(public)/legal/[slug]`. Reserved; 404 until LG4 (LG0, owner ruling 2026-11-23): each handler throws the 404, so no placeholder is reachable; LG4 opens the index and `transfers`, LG5 `audit-packs` |
| contact                 | `(public)/contact.tsx`                                       | `/contact?intent=sales\|support\|dispute\|security` (default `support`; an unknown value reads as the default) — the contact intake, re-exporting `features/contact/routes/ContactPage.tsx` (Decision #276). The intent is URL state: the switcher is a row of links without JavaScript and keeps the address bar in step with `history.replaceState` once hydrated. The no-JS form road comes back here as `?sent=1` (the receipt in a ten-minute HttpOnly `pj_contact_receipt` cookie, `Path=/contact`, cleared once shown) or `?error=invalid\|rate_limited\|sign_in\|unavailable&fields=…`. Public, never cached (`private, no-store`; a signed-in reader's engagements are personal); a lapsed session is renewed in place. Its API: `POST /api/contact` (JSON from the island — only a body declared `application/json`, 415 otherwise — or a form post answered with a 303; cross-site form posts refused), `POST /api/contact/attachments/init`, `/complete` and `/discard` (Remove; signed-in only), and `POST /api/contact/cron/attachments` (the hourly sweep's bearer-only door, 404 to anything else) |
| changelog feed          | `(public)/changelog/index.tsx`                               | `/changelog` (re-exports `features/changelog/routes/feed.tsx`; Decision #278) — releases newest first, ten to a page. The query is canonical: `?category=` repeatable, in the category order, a release listed when it has ANY selected category; `?page=` from 2 (page 1 is the bare path). An unknown, repeated or upper-case category, `page=1` or a malformed page answers **308** to the canonical spelling, other parameters kept; a page past the last is a **404** notice. `?image=<v-anchor>:<n>` opens a release picture in the lightbox (pushed on open, so Back closes it; replaced while stepping; stripped on close). Page 1 and every filtered view are canonical at `/changelog`; an unfiltered page n ≥ 2 is canonical at itself (`/changelog?page=n`, titled "Changelog · page n"); anchors are `#v0-12-0` |
| changelog release       | `(public)/changelog/[version].tsx`                            | `/changelog/:version` (re-exports `features/changelog/routes/release.tsx`) — one release's canonical page; `v0.12.0` / any upper case **308→** `/changelog/0.12.0`; a version that is not semver, unknown, withdrawn or dated in the future is one **404** notice (`noindex`) |
| changelog RSS           | `(public)/changelog/rss.xml.ts`                              | `/changelog/rss.xml` (re-exports `features/changelog/routes/rss.ts`) — RSS 2.0, `application/rss+xml`, `public, max-age=900`; a failed read is a plain-text **503**, never an empty channel. The static route wins over `[version]` |
| about                   | `(public)/about.tsx`                                         | `/about` — the mission page (Decision #277; re-exports `features/marketing/about/routes/AboutPage.tsx`): live platform figures read server-side from `PublicMetricsService` (a figure below its threshold has no tile), the delivery walkthrough. Public, indexable, no query |
| features                | `(public)/features.tsx`                                      | `/features` — everything Projective does, the editorial chapter index (work order L5; `flows/LANDING.md` §2.5, §2.6, §4.12). In `LANDING_PATHS` (its only path since `/` became the Explore Home, Decision #349), so it renders in `LandingShell` for guests and signed-in visitors alike. After the chapter index it carries the deep dives that left `/`: the demo stage (`#demo`, `?demo=board\|payments\|booking\|splits` opens a tab, default `board`), Payment protection (`#protection`), Pricing (`#pricing`) and the questions (`#faq`, its FAQPage in the page's JSON-LD). Thin: a `?tkv=` is answered first with a `303` to the same address without it (`tkvRedirect`), then it reads the fee (`PublicMetricsService`) and renders `features/landing/routes/FeaturesPage.tsx`; a failed read withholds its part, never the page. `?section=find-and-hire\|run-the-work\|money\|trust\|coming-soon` (case and surrounding space forgiven; any other value opens nothing) marks that chapter, which the page lands on once and focuses; every chapter is also its own anchor (`#money`), and so is every feature row (`#work-board`). Canonical `/features` with no query; public, indexable, in the sitemap. A row's "Try it" is a link to `/features?demo=<id>#demo` (the dialog opens in place once hydrated) |
| feedback board          | `(public)/feedback.tsx`                                      | `/feedback` — the feedback board's own page (Decision #272; re-exports `features/feedback/routes/FeedbackPage.tsx`); its query and the `?feedback=open` drawer every other page carries are in "Feedback board" below. The footer's Feedback entry links here and, on a plain click, opens the drawer over the current page instead |
| sitemap                 | `(public)/sitemap.xml.ts`                                    | `/sitemap.xml` (re-exports `features/marketing/routes/sitemap.ts`; Decisions #279, #452) — a sitemaps.org `<sitemapindex>` on the site's public origin (`siteOrigin`) naming one `<urlset>` file per section and chunk, each served by the same route at `/sitemap.xml?section=pages\|listings\|profiles` with `&page=N` from 2 (no new top-level segment, and every file shares the index's root directory as the sitemaps.org location rule requires). Any other query spelling (`page=1`, a leading zero, a repeated or unknown value, a `page` with no `section`) and a page past the last is a plain-text **404**. A file holds at most 50,000 URLs and 50 MiB, split in path order; the index dates each file by its newest `lastmod`. **pages:** `/`, `/features`, `/explore`, `/about`, `/contact`, `/feedback`, the help hub, every category with a visible article and every visible article (canonical `/help/<category>/<article>`), `/changelog` and every visible release, `/articles` and every visible article, and a legal document only once its version in effect is reviewed (`features/legal/core/sitemap.ts` — none today; the hub on the same rule). **listings:** every published service, product and member post at its canonical `/view/:slug`, `lastmod` its row's `updated_at`. **profiles:** every public person, team and business at `/@handle`, no `lastmod`. Listings and profiles come from `ExploreSitemapService` over the anonymous discovery catalogue (no session, no service role): never a draft, paused or archived row, never a project brief, never anything an unlisted or private owner holds, and so never a 13–17 account (Decision #208). `application/xml`, `public, max-age=3600`; an unreadable source is a plain-text **503** with `Retry-After`, never a partial sitemap. Pure builder `features/marketing/core/sitemap.ts` |
| robots                  | `(public)/robots.txt.ts`                                     | `/robots.txt` (re-exports `features/marketing/routes/robots.ts`; Decision #279) — one `User-agent: *` group: `Disallow` the API (`/api/`), every `(dashboard)` top-level segment and `/legal/workspace` (each as `/x$`, `/x/`, `/x?`, so a profile at `/homer` stays crawlable while `/home` does not), the retired `/*/edit` redirects, and `?feedback=open` anywhere; then `Sitemap:` naming the sitemap index (`/sitemap.xml`) on the public origin. `text/plain`, `public, max-age=3600`. Pure builder `features/marketing/core/robots.ts`, whose test walks `routes/(dashboard)` so a new app segment cannot escape it. Replaces the old allow-all `static/robots.txt`, which the static-files middleware would have served first. Share links, `/exit`, the inspector and legal drafts stay crawlable on purpose — their `noindex` is only readable if a crawler may fetch them |
| Apple Pay association   | `(public)/.well-known/apple-developer-merchantid-domain-association.ts` | `/.well-known/apple-developer-merchantid-domain-association` (re-exports `features/payments/routes/apple-pay-association.ts`; CK6) — Apple Pay's domain association file, the `STRIPE_APPLE_PAY_DOMAIN_ASSOCIATION` value verbatim as `text/plain` (`public, max-age=3600`, `nosniff`), no session, no redirect. Stripe's current payment-method-domain registration needs no file, so while the key is unset or the placeholder the path is a plain-text **404** (`no-store`). The runbook is the providers spec §4.3 F |
| file inspector          | `(standalone)/inspect/[fileId].tsx`                          | `/inspect/:fileId` (`?share=<slug>` optional) — the shell-free, full-window inspector for ONE stored file: a top bar, the canvas that suits the file (image, SVG, video, audio, PDF, code, text, Markdown, table, workbook, slide deck, panorama, archive, 3D model, Word document, font, or the unsupported fallback — `resolveViewer`, `@projective/types/files`) and a details panel. Controller `features/inspector/routes/InspectScreen.tsx` (re-exported); the handler reads `FilesBackendService.inspect` under the viewer's own read rule (`fn_can_read`, or the live share slug) and every refusal is the SAME calm `404` page, whether the file is missing, private or the link is dead. Addressed by the `files.items.id` **uuid** — an explicit exception to Decision #88 (files carry no slug; flagged in Decision #161(B)). Headers: the inspector CSP profile (`cspHeaderFor("inspector")`, Decision #161(D)), `noindex, nofollow`, `no-referrer`, `private, no-store`. Its bytes come only from `/api/media/proxy/:fileId`; `fileInspectHref(id, { share })` builds the address. |
| guest invitation        | `(standalone)/rsvp/[token].tsx`                              | `/rsvp/:token` — where a guest's email lands (Decision #391), for somebody with no account. No shell, and no sign-in. A `GET` changes and sends nothing, because mail scanners follow every link: each act is a `POST` from a plain form back to this page (`action` = `answer` · `code` · `join` · `claim` · `stop`), so it needs no JavaScript. A good code ends on a page with the link rather than a `303`, because the CSP's `form-action 'self'` also binds a form's redirect. The token is shape-checked before any read and every dead state is one `404`, which still offers `stop`, so invite-and-withdraw cannot leave somebody with no way out. `scrubPath` keeps the token out of the logs. `noindex` + `no-referrer` + `no-store`, because the path is a capability. Each `POST` must come from this site's own page: the root middleware's page write guard refuses a cross-site one with a `403` before the handler runs (Decision #475); the page's own form, sent `Origin: null` under `no-referrer`, passes on `Sec-Fetch-Site: same-origin`. |
| notifications           | `(dashboard)/notifications/index.tsx`                        | `/notifications` (`?category=` an inbox category — `money · work · messages · schedule · discovery · account · system`, absent, unknown or `marketing` = All categories; `?view=` `unread · archived`, absent = All; `?q=` a title-or-body search, trimmed, ≤ 100 chars, absent = none) — the full inbox: the rows, keyset Load more and bulk mark-read / archive. All three parameters are written in place (`replaceState`, defaults omitted) as the filter changes, so the address is always a deep link to what is on screen. Lane: `notificationsLaneFor(url)` (`features/notifications/core/notifications-lane.tsx`, pure, `null` off the path) → `NotificationsLane` — LaneSearch, the status views (All notifications · Unread · Archived) and the categories as `NavItem` links to their own addresses, answered in place by the page through the shared `inboxFilter` signal; below 767px, where the shell drops the lane, the page's own filter bar (Status · Category · search) carries the same filter. Re-exports `features/notifications/routes/NotificationsScreen.tsx` (DESIGN_SYSTEM §D.9, Decisions #173 · #429) |
| messages (root)         | `(dashboard)/messages/index.tsx`                             | `/messages` — the global inbox with no conversation open: the conversation list is the middle-nav lane (`messagesLaneFor` → `MessagesSidebar`, the same lane beside an open conversation), the body an empty state on desktop and the inbox list itself below 767px (#339 (e)). Every row links to its conversation's `/messages/cht-…` address (Decision #339 ruling N1) |
| messages (conversation) | `(dashboard)/messages/[conversationId]/{index,files,members}.tsx` + `_layout.tsx` + `_middleware.ts` | `/messages/:conversationId` (Chat, the latest message page read server-side; the GET writes nothing, and the chat island marks the conversation read with `POST /api/messaging/conversations/[id]/read` once it has painted in a visible tab, PRD-C11) · `/messages/:conversationId/files` (the shared `FilesView` in `conversation` scope) · `/messages/:conversationId/members` (the shared `MembersView`, Members only). The header band and the composer are the middle-nav frame's (`conversationHeaderFor` / `conversationFooterFor`). `:conversationId` is the conversation's opaque `cht-…` ref (`comms.dm_threads.ref`, Decision #339 ruling N1) — the only routed form. The `_middleware.ts` answers first, through `MessagingBackendService.route`: `/messages/dm-<handle>[/tab]` answers **303** to the pair's `/messages/cht-…[/tab]` (query kept) when the thread exists, and otherwise renders the virtual conversation, whose first send creates the thread and moves the page to the `cht-` address with `replaceState` (`addressAfterSend`); a uuid (uuids do not route, Decision #88), a thread the viewer is not in or an unknown handle renders the calm not-found body with a real **404** (CAS M25 / D9). The middleware, the page and the header, footer and panel slots share ONE conversation read per request (`resolveConversationRoute`, the request memo `once(url, key, run)`, RED D-06). The fixture backend keeps its own ids (`dm-{handle}`, `grp-…`, `ch-…`) and never redirects |
| become a partner        | `(dashboard)/become-partner.tsx`                             | `/become-partner` — the freelancer conversion page (controller `features/profile/routes/BecomePartnerScreen.tsx`); its unlock is `POST /api/user/freelancer` (see "Profile and media API") |
| saved                   | `(dashboard)/saved/index.tsx`                                | `/saved` (`?tab=` `listings · people · projects · messages · files`, absent = All; `?collection=` `unfiled` or a collection id, absent = every collection) — everything the viewer saved, starred, favourited or followed, newest save first with "People you follow" last; un-save in place, file a bookmark into a list, Load more. Laid out as `/notifications` (Decision #520): a middle-nav lane (`savedLaneFor`) whose **Categories** (`?tab=`) only filter and whose **Lists** (`?collection=`) are the viewer's own, both answered in place and kept in the URL; with no list open the page leads with the lists as boards; an open list can be renamed, deleted or bought (its products put into a basket). Re-exports `features/saved/routes/SavedScreen.tsx` (Decision #180). Reached from the account menu's **Saved**.|
| settings (root)         | `(dashboard)/settings/index.tsx`                             | `/settings` — the Settings hub (Decisions #151, #156): an in-page **search** over every setting, **Needs your attention** (identity check, payout account, business KYB, expired connectors, unconfirmed emails, profile steps, expired cards, a failed plan payment, a lone sign-in method, a scheduled erasure — derived from facts by `attentionItems`), the **profile completeness** tracker with one call to action, and every section as an **interactive card** (a single column on a phone, where the shell has no lane). A `?connect=` landing (the integrations callback's fallback) **303→** `/settings/integrations?connect=…`. Controller `features/settings/routes/SettingsHomeScreen.tsx` (re-exported). |
| settings (section)      | `(dashboard)/settings/[section].tsx`                         | `/settings/:section` — one console page for each `SettingsSectionKey` (`account · profile · workspaces · language · appearance · shortcuts · notifications · messaging · scheduling · billing · integrations`; `verification` keeps its own static route below and renders in the same lane). `/settings/integrations` is the same Integrations section the modal draws (Decision #440): `#storage` · `#calendars` · `#conferencing` · `#other-services`, and a consent started there returns to it with `?connect=`. `/settings/account` also takes `?email=<EmailVerifyOutcome>` (the verify link) and `?export=unavailable#data-export` (a download that found nothing ready, Decision #450); each is read once and stripped. An unknown section **303→** `/settings/account`. `#anchor` deep-links an entry (`/settings/appearance#contrast`). Server-rendered from `resolveSettingsSection` — the SAME read `/api/settings/:section` serves the modal. Lane: `settingsLaneFor`. |
| verification            | `(dashboard)/settings/verification.tsx`                      | `/settings/verification` (**Verification & payouts** — the freelancer's Level-2 identity check through Stripe Identity, the Stripe Connect payout account a withdrawal is transferred to, a seller's **Tax documents** (`#tax-documents`: where Stripe's tax forms live, the Express sign-in, and a private tax residence certificate shown to one project's client through `/api/finance/tax-documents*`, LEGAL LG6, Decision #527), and each client business's Level-3 KYB through Connect onboarding. Every wallet lock about identity or payouts links here. Stripe's hosted pages come back through `/api/finance/connect/{return,refresh}?…&back=settings` and the Identity return, which land here with a one-line notice; the page itself reads `GET /api/finance/verify/status`. Root CLAUDE.md §8 Decision #126) |
| teams roster            | `(dashboard)/teams/index.tsx`                                | `/teams` — the caller's teams (owned first), their pending invitations to teams, and the create entitlement. Read by `org.get_workspace_roster('team')`. `?view=` is the partition (`owned · member · invitations · archived`, absent = All — the canvas toolbar's filter, the lane's segmented control and its Invitations toggle are one state, Teams R1, Decision #307; the pre-R1 `?tab=` is still read, never written), `?q=` the canvas search, and `?sort=` (`name · members · projects`, absent = `recent`) with `?dir=` (`asc`, absent = `desc`) the toolbar's sort; all are kept in step with `replaceState`. `?notice=unavailable` (set by a console that would not resolve for the viewer) adds one dismissible `InlineNotice` above the cards — "That team isn't available to you" — and nothing about whether the team exists; the address drops the flash once it is shown. `/businesses` answers the same parameters. |
| team create             | `(dashboard)/teams/create.tsx`                               | `/teams/create` — the create flow (name + a `@handle` checked live against the ONE handle namespace); the entity is born `draft`. The roster renders with the Draft-First dialog already open, its kind fixed by the route (no kind choice on `/teams` or `/businesses/create`). |
| team console            | `(dashboard)/teams/[teamHandle]/index.tsx`                   | `/teams/:teamHandle` — the console's **Overview**. Addressed by the team's `@handle` (`org.teams.slug`), never its uuid: a uuid or a non-canonical-case handle answers **308** to it, query kept, and so does `/teams/:teamHandle/overview` (the root under a second name). A missing team, or one the viewer is not a member of, answers ONE **303** to `/teams?notice=unavailable`. |
| team console module     | `(dashboard)/teams/[teamHandle]/[module].tsx`                | `/teams/:teamHandle/:module` — one module of the console (the `ModuleKey` vocabulary of `features/workspaces/core/module-registry.tsx`). Resolved by `consoleOutcome` (`features/workspaces/core/workspace-route.tsx`) in `define.handlers`, through the pure `routeConsole` / `consoleResponse` (`features/workspaces/core/console-route.ts`) every console handler of both kinds answers with (Decision #228 (B)): a uuid or a non-canonical-case handle in `:teamHandle` answers **308** (`canonical`) to the canonical handle with the query kept — the mapping is permanent, the slug being immutable; a real module the viewer may not open **303s** (`redirect`) to the one they can, dropping `?view=` (viewer-dependent, so never cacheable); both at once answer ONE **308** straight to the module the viewer may open; `/overview` spelled out answers **308** to the console root, query kept (combined with a uuid, still ONE 308); an unregistered segment 303s to the CANONICAL console root (`missing`); a missing team or a non-member 303s once to `/teams?notice=unavailable` (`unavailable`). Every case is ONE hop: the entity is read before any redirect is chosen, so no answer bounces through `/teams/<ref>`. The lane groups the modules into hubs (Decision #306, superseding #228 (C) and #232; `NAV_HUBS` / `hubsForViewer` in the registry): **Core operations** — Overview · Projects · Calendar · Files · Catalogue (team) / Talent (business) · Members (`members` · `invitations` · `roles`) · Wallet (`finance` · `payouts`; a business's is `finance` · `spend` · `billing`) · Analytics (`analytics` · `standing`) — one-word labels per Decision #308; Decision #332 folded the former Governance section into Core operations (it never had a URL segment: `/teams/:teamHandle/governance` is an unregistered segment and 303s to the console root); **Channels**; and the footer's **Settings** (`settings` · `profile` · `verification`). A hub is navigation only: every module keeps its own route and gate, and the header band draws a multi-module hub as link tabs, one per module (`hub-tabs.ts`, Decision #319 — Members is Members `/members` · Roles `/roles`; `/invitations` marks the Members tab; the Members tab carries `?view=chart` when the reader last left the org chart). The Members body addresses its sections and readings in `?view=` (Decision #319): the bare URL is the people (table ⇄ cards on the footer zoom), `?view=requests` the join requests and `?view=pending` the sent invitations (both for an `invite_members` holder only, else resolved to the bare URL), `?view=chart` the org chart; a section tab or the footer's Org chart toggle rewrites it in place (`replaceState`). `?member=<handle>` (Decision #322) names the member the inspector stands open on, beside any reading: the layout registers the `MemberInspector` panel on the `members` module (`workspaceMembersPanelFor`) and paints it docked in the first byte from 1280px when the parameter is present (`workspacePanelDockFor`, a `selection` dock), a right drawer below; a pick in the table, cards or chart sets it and every close drops it (`replaceState`, `core/member-inspector-state.ts`); a handle naming nobody active is dropped on load. The lane search's person hit links here with it. Leaving the Members section for a queue drops it. The retired `messages` segment is no longer a module: it 303s to the canonical root like any unregistered segment. `/teams/:teamHandle/files` (and `/businesses/:businessHandle/files`) is the entity's shared drive (the `files` module): `?path=` is the folder (each segment percent-encoded independently, `folderQueryHref`), absent = the drive root; the `[module]` handler reads that location server-side as the viewer (`resolveEntityDrive`, the `workspace` scope, whose server answers only an active seat — anyone else gets the same 404 as an unknown id), and the header band and footer rig are the `/files` hub's (`FilesHeaderBand` `routing="query"` · `FilesFooterRig`, Decision #315), so folder drilling, the trail and Back / Forward keep the handle and every other query parameter; a folder that no longer exists renders the body's error with a Retry rather than an empty drive. `/teams/:teamHandle/calendar` (and `/businesses/:businessHandle/calendar`) is the union of the entity's projects' calendars, read server-side by the `[module]` handler as the viewer (`ScheduleBackendService.entityCalendar`, Decision #308), laid out as `/calendar` is (Decision #403): the body is the grid alone, and the console's header, footer and panel slots mount `/calendar`'s header band (no Events ⇄ Availability tabs), footer rig (zoom ruler · display options · Export) and panel (Month · Events — the agenda list the console's rail leaves no lane for — and the inspector), all over the same request-memoised read. `?event=<id>` names the entry in the inspector (written with `replaceState` on a pick, painted in the first byte) and `?filter=invitations` narrows the grid and the Events list, as on `/calendar`; each event's writes are addressed to its own project. `/teams/:teamHandle/catalogue` (`publish_listings`, team only) is no longer a module of this route: it is its own static route family, the team catalogue rows below (Decision #312). A module's sub-views are `?view=`, read from one data table (`features/workspaces/core/sub-views.ts`, Teams L2): Members takes `?view=pending` (Invitations — offered only with `invite_members`) and `?view=chart` (Org chart), absent = People, on both kinds; a team's Projects takes `?view=proposals` (the applications filed for the team, awaiting an answer), absent = Active (its live engagements, with each assignee's Wᵢ, under the team's proposal allowance — Teams C5), while a business's Projects still hands off to `/projects`; a value the viewer is not offered reads as the default. The header band's view picker, the lane's context control and the footer rig's Org chart toggle switch it in place and keep the address in step with `replaceState`. `/teams/:teamHandle/settings` (`manage_settings`) is the team's Settings screen — name and visibility saved by the footer rig, Publish as the header band's commit while draft, Archive (its blockers named first) and Restore in the body (Teams C6); a business's `settings` still hands off. `/teams/:teamHandle/roles` (`manage_roles`; `/businesses/:businessHandle/roles` is the same screen over the business capability list) is the Roles screen — the `PermissionMatrix` of the presets (locked) then the custom roles, a custom role's cells saved by the footer rig's Save, New role as the header band's commit opening the role editor, each custom column's menu carrying Rename · Duplicate · Archive role (Teams C3). Membership is the DATABASE's answer — `org.get_workspace_detail` returns `forbidden` for a non-member and discloses nothing else. |
| team catalogue console  | `(dashboard)/teams/[teamHandle]/catalogue/index.tsx`         | `/teams/:teamHandle/catalogue` (Decision #312, superseding #308 (D)'s read-only module) — a team's catalogue console: the `/catalogue` controller re-exported (`features/catalogue/routes/console.tsx`), read and written AS the team whatever context the viewer acts in. The handler asks `routeSellerScope` (`features/catalogue/core/seller-scope.ts`) first, which answers as the team console does, one hop each: a missing team or a non-member **303s** to `/teams?notice=unavailable`; a member without `publish_listings` goes to the console root (**303**, or **308** with a non-canonical handle); a uuid or non-canonical-case handle **308s** to the canonical one, the path below the catalogue root and the query kept. The URL contract is `/catalogue`'s, the team carried by the path (`parseConsoleUrl` reads it into `ConsoleUrlState.team`, every builder keeps it), so every query parameter above applies unchanged. The header band is `CatalogueHeader` titled with the team's name, the footer band `CatalogueFooterRig`, the panel the client drawer; the lane is the team console's rail (its Catalogue section open with the team's listings and its title marked — Decision #316), not the catalogue lane, so its four facets are the toolbar's Filter dialog, which writes the same `?status=` · `?highlight=` · `?model=` · `?category=` on Apply. A static segment, so `[module]` never sees `catalogue` |
| team catalogue listing  | `(dashboard)/teams/[teamHandle]/catalogue/[id].tsx`          | `/teams/:teamHandle/catalogue/:slug` (the file's `[id]` segment carries the listing's `svc-…` / `prd-…` slug, as on `/catalogue/:slug`; IDG §4.5) — one of a team's listings in the item workspace (`features/catalogue/routes/workspace.tsx`), read and written as the team, with `/catalogue/:slug`'s query contract (`?tab=&section=&device=&period=&client=`). The same team answers as the console row above; a non-slug id 303s to `/teams/:teamHandle/catalogue?create=1` and a listing that is not the team's to `/teams/:teamHandle/catalogue`. Header `ListingHeader`, footer `ListingActionRig`, panel the inspector or client drawer, lane the team rail with this listing's row marked in its Catalogue section (Decision #316) |
| team catalogue simulation | `(dashboard)/teams/[teamHandle]/catalogue/[id]/simulate.tsx` | `/teams/:teamHandle/catalogue/:slug/simulate` — the buyer simulation of a team's listing (`features/catalogue/routes/simulate.tsx`), read as the team in `bare` chrome and framed by the listing's Preview tab, with the `framed` CSP. A non-canonical handle 308s; every other refusal of the team console is the framed 404, so the frame never paints another page |
| team catalogue sub-pages | `(dashboard)/teams/[teamHandle]/catalogue/[id]/{plan,questions}.tsx` | `/teams/:teamHandle/catalogue/:slug/plan` and `/questions` (Decision #525): a team listing's session plan and buyer questions, read and written as the team (Decision #312). The same controllers as the `/catalogue/:slug` rows; every `303` stays in the team's catalogue |
| team catalogue API scope | `api/catalogue/*`                                           | Every `/api/catalogue/*` read and write accepts `?team=<handle>` (Decision #312): `apiSellerActor` (`features/catalogue/core/seller-scope.ts`) reads the team's detail AS the caller and acts as the team only for an active member holding `publish_listings` — **401** signed out or an expired session (the client refreshes and retries), **404** a malformed handle, a missing team or a non-member (one answer, nothing disclosed), **403** a member without the capability, **503** when the team cannot be read. A page under `/teams/:teamHandle/catalogue` adds it to every catalogue call it makes (`features/catalogue/core/api-scope.ts`, read from the tab's address at call time: the editor's beacon and the simulation's slot read included). RLS stays the authority: the token is the caller's |
| console channels        | `(dashboard)/teams/[teamHandle]/channels/{index,[channel],[channel]/files}.tsx` · `businesses/[businessHandle]/channels/{index,[channel],[channel]/files}.tsx` | `/teams/:teamHandle/channels` · `/teams/:teamHandle/channels/:channel` · `/teams/:teamHandle/channels/:channel/files` and the business twins — the entity's chat channels (Decision #306), resolved by `channelOutcome` (`features/workspaces/core/channel-route.ts`) after the console's own `consoleOutcome` on the `channels` module, so a uuid or non-canonical handle **308s** (the channel kept) and a non-member **303s** to `?notice=unavailable` as on every module. `/channels` **303s** to the default channel (`general`), or renders an empty state when the entity has none. `/channels/:channel` names the channel by its slug (lowercase, digits, inner hyphens, 2–40 — `CHANNEL_NAME_PATTERN`); it renders the `/messages` chat stack (`ConversationChat`) over the channel's conversation (`WorkspaceBackendService.channelThread`), with the channel's own header band (`WorkspaceChannelHeader`, Decision #308: its mark and display name over its topic; Chat · Files as link tabs; Favourite · Details · Pop out chat · a kebab of Mute · Edit channel · Copy link · Archive channel) and the `ChatComposer` in the footer band; the frame's right panel docks the channel's details (`workspaceChannelPanelFor`) on Chat from 1280px. `/channels/:channel/files` (Decision #308) renders the files shared in the channel through the shared `FilesView` in `conversation` scope, the footer band carrying the File Explorer's `ViewControlRig`. An unknown or archived channel **303s** to `/channels` from either view. Renaming a channel changes its display name only (`dm_threads.title`); the slug, and so every link, stays. A channel's slug is its address, the documented exception to opaque prefixed slugs (Decision #88), flagged on #306. |
| business roster / create / console | `(dashboard)/businesses/{index,create}.tsx` · `businesses/[businessHandle]/{index,[module]}.tsx` | `/businesses` · `/businesses/create` · `/businesses/:businessHandle` · `/businesses/:businessHandle/:module` — the buyer-side twin of the four team routes above, addressed by `org.business_profiles.slug`, answering through the same `routeConsole` (BUSINESSES_AUDIT BF40–BF42, §4.5): a uuid or non-canonical-case handle **308s** to the handle, query kept; `/businesses/:businessHandle/overview` **308s** to `/businesses/:businessHandle`; a module the viewer may not open **303s**, dropping `?view=` (both at once: ONE 308); an unregistered segment 303s to the canonical root; a missing business or a non-member — from the root AND from `[module]` — answers ONE **303** to `/businesses?notice=unavailable`, never via `/businesses/<ref>`. The lane's hubs are the team's (Decision #306), with Talent (#230 (i)) and the money hub Wallet (`finance` · `spend` · `billing`) in Core operations (Decision #332: no Governance section) — each capability-filtered by the same registry predicates. The Spend module's member rows are fragment targets: `/businesses/:businessHandle/spend#limit-<handle>` (`spendLimitHref`) lands on that member's limits row, scrolled into view and focused — the Members drawer's tier-5 "Edit in Spend" / "Open in Spend" (BU7, Decision #249); a fragment naming no row is ignored. |
| `[...path]`             | `(public)/help/[...path].tsx`                                | `/help` · `/help/:category` · `/help/:category/:article` — the help centre (P2; re-exports `features/help/routes/help.tsx`). One catch-all, resolved by the pure `resolveHelpPath` (`features/help/core/help-path.ts`): no segment → the hub; one segment naming a category → its page; `category/article` → the article; one segment naming an ARTICLE, an article under another category (it moved — slugs are permanent, Decision #274 (k)), or a canonical path in another case → **308** to the canonical lower-case path, query kept; anything else → 404, rendered in the help centre's own frame (inside the public shell, `noindex`, one h1, the search and the way back — Decision #296 (G)). `?q=` on any help page opens the search overlay; on the hub it is also searched server-side (the no-JavaScript road of `<form method="get" action="/help">`) and the page is `noindex`. An unreadable help centre answers a 503 page, never a 404 |
| top-level dynamic       | `[handle]/index.tsx`                                         | `/:handle` (the profile **Work** section — the index IS the default tab; `/:handle/work` 308s here). For a **team** or a **business** this is the entity's public storefront, the console being `/teams/:teamHandle` · `/businesses/:businessHandle`: while the entity is `draft`, `archived` or `invite_only` every `/:handle…` read answers **404** "Profile not found" to anyone outside it — worded exactly as an unknown handle — and a member reads the page under a notice naming the state (with a tier-4 link to the console's Settings for a `manage_settings` holder on a team — where that holder publishes a draft, an `archive_entity` holder restores it and an `edit_profile` holder changes its visibility, Teams C6; a business's link waits, Decision #244 (d)). Decided in SQL by `org.fn_profile_visible` (BP1, Decision #244; Teams P1). A team's Work roster is public facts only (preset role · since · two skills — no stake, no W_i), its Reviews its collective ones, its Standing its own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| profile tabs            | `[handle]/[tab].tsx`                                         | `/:handle/:tab` (the three non-index sections — `experience` · `reviews` · `posts`; Experience is gated to individuals. Every RETIRED segment answers **308** into its consolidated section: `services` · `products` · `projects` · `portfolio` · `teams` · `businesses` · `members` · `departments` · `about` → `/:handle`; `education` → `/:handle/experience`; `articles` → `/:handle/posts` — root CLAUDE.md §8 Decision #96)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| profile static          | `[handle]/availability.tsx`                                  | `/:handle/availability` (FULL-PAGE Availability calendar — its OWN layout, NOT the profile chrome; `_layout` special-cases the `availability` segment to a one-line identity strip + the calendar. **No profile chrome links here since Decision #96** (the availability toggle, clock and presence pip were stripped); the route stays resolvable for anyone holding its address. A static sibling wins over `[tab]`. A visitor gets no composer — the schedule is someone else's, and a slot is booked from an open availability block's Book this slot (Decision #343, ruling C7 (a); S-33). Addressed as `?view=&date=&zoom=` with `/calendar`'s value sets and no `kind` or `availability`, an invalid value **303ing** to the canonical address (Decision #413); read over a window around `date` (−14 / +90 days, inside `get_free_busy`'s 120) through `GET /api/scheduling/availability?around=`, "Not loaded" past it)                                                                                                                                                                                                                                                                                                                                                                                               |
| profile editor (retired) | `[handle]/edit/index.tsx`                                  | `/:handle/edit` (**retired**, Decision #439: **308** to `/:handle`, query kept — the profile is edited in place there, and a fragment such as `#skills` carries across the redirect and opens that block for its owner; see [The owner edits their profile in place](#the-owner-edits-their-profile-in-place)). The file stays so a bookmark or an old notification link still lands |
| profile availability (retired) | `[handle]/edit/availability.tsx`                    | `/:handle/edit/availability` (**retired**, Decision #439: **308** to `/:handle#availability`, which opens the profile's Availability block for its owner — whether the hours show and the time zone they are kept in; the call terms are Settings → Scheduling, and the weekly hours stay on `/calendar?view=availability`, Decisions #376, #408) |
| profile item view       | `[handle]/view/[item]/index.tsx`                             | `/:handle/view/:id` (profile-scoped Explore item viewer; was the flat `view/[item].tsx`, now a dir beside the retired schedule leaf). Takes the same `?intent=` as `/view/:id` (Decision #422) and renders the same editorial column + purchase card (Decision #424). Its canonical link is the public `/view/:id` (Decision #452), so the sitemap never lists this address |
| profile entity schedule | `[handle]/view/[item]/schedule.tsx`                          | `/:handle/view/:id/schedule` (**retired** — Decision #411: **308** to `/:handle/view/:id`, query kept; a session listing books from the slot picker its lane's primary opens, and the page carries no calendar)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| articles index          | `(public)/articles/index.tsx`                                | `/articles` (Projective's own articles, Decision #271; re-exports `features/articles/routes/index.tsx`, handler `index-handler.ts`). `?topic=` is repeatable and any-of, `?page=` 1-based; any other spelling of the same state — an unknown or repeated topic, `page=1`, a malformed page — **308s** to the canonical one, other parameters kept; a page past the last is a 404, and nothing matching is page 1 with an empty state. Page 1 of every view, filtered or not, names `/articles` as its canonical; a later page is its own canonical (`/articles?page=2`, `/articles?topic=…&page=2`), since it lists articles no other page shows |
| article reader          | `(public)/articles/[slug].tsx`                               | `/articles/:slug` — one `editorial.articles` row on P0's document reader (re-exports `features/articles/routes/reader.tsx`, handler `reader-handler.ts`). The slug is readable and permanent (Decision #274 (k)); a wrong-case slug **308s** to its lower-case spelling; a renamed article's former slug (`editorial.articles.former_slugs` of a visible row) **308s** to the new one, query kept; and a draft, a future-dated, a retracted or an unknown article is the same 404, rendered in the reading frame (inside the public shell, `noindex`, one h1, the way back to the index — Decision #296 (G)). Member posts (`catalogue.articles`) stay at `/view/:id`; neither address redirects to the other (Decision #271) |
| entity view (public)    | `(public)/view/[entity]/index.tsx`                           | `/view/:id` (public Explore item viewer; was the flat `view/[entity].tsx`, now a dir beside the retired schedule leaf). `?intent=book\|contact\|apply` opens the page's own slot picker or seat panel, Contact menu or apply dialog once (Decision #422; the Explore card menu links here): a guest is `303`'d to `/login?redirectTo=` the same URL, the page opens it only where it renders that control enabled, and the parameter is stripped by `replaceState` on arrival either way. Only panel-opening controls have an intent — Buy now, Add to projects and Join the waitlist write on press; Reserve seat opens its seat panel since Decision #424, so `book` honours it. Contract: `features/view/core/view-intent.ts`. Layout (Decision #424): one editorial column beside the page's own purchase card (`.evp-frame` END column at ≥ 1024px of content; `viewLaneFor` answers `null`, so no shell lane is built) — the card, its dialogs and the conversion state hold no URL state of their own; the dialogs are panels of this address, not routes. **Canonical** (Decision #452): `/view/:id` with no query, the one address of the listing whichever page opened it — `/:handle/view/:id` names it too (`features/view/core/view-canonical.ts`), and it is the address the sitemap lists |
| entity schedule         | `(public)/view/[entity]/schedule.tsx`                        | `/view/:id/schedule` (**retired** — Decision #411: **308** to `/view/:id`, query kept; the session-based service schedule and its "Full schedule" link are gone)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

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
  forwards to Details — but always present, first, on a service, Decision #427). **No lane carries a Details view link — a Task included** (Decision #163
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
  dialogs the hero opens are hosted wherever the reader is. Their state lives in the query string:
  `?w=scope:id` selects which wallet is shown (a view filter, never a context switch — builders
  `walletHref()` and `walletPageHref()` in `apps/web/features/wallet/core/wallet-model.ts`, which keep
  `w` and `display` on every page link). `w` is `personal` · `aggregate` · `team:<id>` ·
  `business:<id>` · `enterprise:<id>`, and every builder writes it, `w=personal` included: an
  address without `w` shows the acting context's wallet, which in a team or business context is not
  the personal one (`buildWalletQuery`, also for the island's `/api/wallet/*` reads). The hero's
  scope carousel (Decision #438) switches `w` four ways — its `‹` / `›` chevrons (real links), a
  horizontal drag on the balance, ←/→ while focus is in it, and the scope pill's dropdown — and every
  one is a NAVIGATION to `scopeHref` (`apps/web/features/wallet/core/scope-deck.ts`): the same page
  with `w` set to the neighbouring wallet in `scopeDeck` order (personal · the vaults · the rollup
  where offered, wrapping at both ends), `display` kept, `flow` kept unless it is that page's default,
  and `currency` dropped (it narrowed the wallet being left). The page and the lane are both read
  again for the new wallet; the acting context is never touched.
  `?flow=7d|1m|3m|6m|1y|5y|all` is the window on the three pages read over one (overview · analytics
  draw cash flow over it, the ledger lists it; set from the pinned range ruler; the pre-ruler names
  `week|month|quarter|year` still resolve; each page omits its OWN default — `1m` for the cash-flow
  pages, `all` for the ledger, `defaultPeriodFor`), and `?display=` the currency the figures are drawn
  in. `?currency=GBP` (Decision #435) narrows the overview, the ledger and the analytics to one of the
  account's currency wallets, its figures stated exactly in that currency unless `?display=` names
  another; the page links keep it (`walletPageHref`'s `currency`), the hero's currency tabs switch it,
  and movements, payouts, funding, methods, invoices and access always read the whole account. A
  lower-case code redirects to its upper-case form, and a currency the account holds no wallet in is
  dropped by a 303 (`walletPageRedirect`'s `scope.currency`), as is any `currency` once `?w=` falls
  back to another wallet. Two intents open the wallet mid-flow
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
  (`addMoneyHrefFor`). Every wallet page parses its query with `parseWalletPageQuery`
  (`@projective/types/finance`; `walletPageRedirect` decides the redirect): an address it must
  correct (an unknown value, a legacy window name, an uppercase id, an unsafe `back`) answers
  **303** to its canonical form, keeping the params it does not name, so the island never repairs
  its own address. A `?w=` the viewer cannot open, or an active context's wallet they no longer can,
  answers **303** to the same page at the wallet the read resolved (their personal wallet), with
  `do` and `back` dropped and `?notice=wallet-unavailable` added (FINANCE_AUDIT R5): a wallet is
  never swapped silently under an address that names another. `/api/wallet/*` answers such a read
  for the resolved wallet and says so (`switcher.requested` ≠ `switcher.resolved`), and
  `POST /api/wallet/action` refuses a money action on such a wallet with a 403, so it never runs on
  another one. `/wallet/transactions` also carries its filter bar (Decision #152): `?q=` the search,
  `?dir=in|out` the direction, `?kind=a,b` the line families (`LEDGER_KIND_CHOICES`), each dropped
  at its default (`withLedgerFilters`), so a filtered ledger links and reloads as it was.
  The island adds `?tz=<IANA zone>` to its own `/api/wallet/*` reads (never to a
  page address) so "Today" and a cash-flow day are the reader's calendar; `GET /api/wallet/transactions`
  pages by an opaque keyset `cursor` (`k:…`), and `GET /api/wallet/export` takes the same filters and
  answers a refusal as JSON, never as a file. `GET /api/finance/cards/setup` hands the Add payment
  method dialog the publishable key before any SetupIntent exists (deferred Elements). The
  remaining retired deep pages answer `(dashboard)/wallet/[section].tsx` with a **308**, keeping `w`
  and `display`: `activity` → `/wallet/analytics`, `payouts` · `funding` · `access` →
  `/wallet#upcoming`, `methods` → `/wallet#methods`. Any other `/wallet/<segment>` is a 404.
  `(dashboard)/_layout.tsx` resolves the middle-nav LANE for every wallet page (`walletLaneFor`:
  the four page links — Overview · Transactions · Analytics · Invoices, listed for EVERY wallet, a
  wallet that is not billed reading `/wallet/invoices` as the sentence saying so — then the Pots &
  reserves and Scheduled rails and the verification gate, reading the overview, funding and payouts
  itself in parallel so it paints in the first byte; since Decision #438 it carries no money action
  and its footer only the collapse toggle) and no header band — no `.ui-middle-nav__header` is
  mounted on `/wallet*`, so the hero's aurora runs on behind the top bar: the display-currency and
  settings tools sit in the hero's corner, every money action (Top up · Transfer · Withdraw · More)
  is in the hero on every page, and the overview's range ruler pins inside the page on the hero's
  glass, taking the sheet's polarity once the sheet slides under it.
  `/wallet/transactions` and `/wallet/analytics` also register the FOOTER band (`walletFooterFor`,
  keyed on `?flow=`): the period ruler and the CSV download (Decision #331). Below 767px the shell
  removes the lane, and its page links and gate move to the top of the sheet; the footer band stays.

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
  `/api/projects/ticket?slug=` and renders the modal itself. The frames that replace the ticket for a
  moment — a file preview, the asset picker and Buy Now (`buy`) — write no address of their own, so
  `?tkv=` stays while they show and the ticket is what Back and a reload restore (`addressingFrame`,
  `core/ticket-view.ts`). The `fund` frame of Decision #428's stage selector is retired (Decision
  #430): Buy Now itself lists the ticket's stages. Its quote is
  `GET /api/finance/escrow/quote?project=<prj->&ticket=<tkt->` (exactly one of `stage` / `ticket`);
  the payer takes one prepaid stage back from the funding line with `POST /api/finance/escrow/reservation`
  (body `{ project: <prj->, ticket: <tkt->, stageId }`, Decision #556), which writes no URL state;
  the chosen stages travel as `stageIds` (with `replaceStages`) in the body of `POST /api/basket/item`,
  and the session it prices is read narrowed `?ticket_id=<tkt->` — the stage choice itself is never URL
  state, since nothing about a pending purchase is addressable. The parameter is **stripped and nothing
  opens** on the landing/marketing pages (`/`, `/about`, `/help/**`, `/share/**`), the auth screens
  (`/login`, `/join`, `/forgot-password`, `/verify`), exactly `/checkout/details` and
  `/checkout/payment`, for a guest, for a malformed value, and for a ticket the read refuses — which
  answers "not found" and "not yours" with the same words, because the link is pasted from anywhere.

  The landing page, `/features`, mounts no `TicketDeepLinkHost` (Decision #286 (A)), so it strips
  the parameter on the SERVER (`/` stopped when it became the Explore Home in the guest shell,
  Decision #349): the landing route's `GET` calls `tkvRedirect(ctx.url)`
  (`apps/web/features/landing/core/strip-tkv.ts`) before it renders, and answers a URL carrying
  `tkv` (empty, repeated or percent-encoded too) with a bodiless `303 See Other` to the same path and
  query without it: every other parameter kept byte for byte and in order, the `Location` path and
  query only (the browser carries the fragment over) and pinned to one leading slash. Every other
  route keeps the in-browser strip.

- **Conversations are addressed by their _entry surface_.** A thread keeps its stable `chatId` — its
  opaque `cht-…` ref (`comms.dm_threads.ref`, Decision #339 ruling N1) — so it stays **one
  continuous record** (`PRODUCT_SPEC.md` §Unified Messaging, Decision #21); only the **base path**
  changes with where it is opened (resolved 2026-07-16, Decisions #22 / #23):

  | Opened from…               | Channel kind                          | URL                                     |
  | :------------------------- | :------------------------------------ | :-------------------------------------- |
  | **the global `/messages`** | private / group / inquiry message     | `/messages/cht-…`                       |
  | **within a project**       | the engagement's **discussion**       | `/projects/[project-slug]/discussion`   |
  | **within a project**       | a **stage**                           | `/projects/[project-slug]/[stage-slug]` |
  | **within a project**       | a team room                           | `/projects/[project-slug]/[channel-id]` |
  | **within a project**       | a DM (the Private Messages group)     | `/projects/[project-slug]/cht-…`        |

  Every row of a Project Details channel tree (Stages, and — only when the viewer has something in
  them — Teams and Private Messages) routes into the **project namespace** via
  `channelHref(projectSlug, ref)`
  (`apps/web/features/projects/core/chat-context.ts`). The Private Messages group lists the viewer's
  threads, pairs and groups, that hold a message stamped with the project (`dm_messages.project_id`)
  or that a participant brought into it, and that nobody took out since (`comms.project_dm_threads`,
  `fetchProjectDms`; PROJECTS CH3, Decision #560), each by its `cht-` ref, and the destination page
  renders the SAME thread `/messages/cht-…` does — a project DM and the same person's global DM are
  one record. Its **Files** and **Members** tabs (`/projects/[project-slug]/cht-…/files`, `…/members`)
  render the thread's own readers, the ones `/messages/cht-…/files` and `…/members` render (the
  `conversation` scope), not the project's file tree or roster. A `cht-` segment the project does not
  list (a thread the viewer is not in, one never stamped with or brought into this project, or one
  taken out of it) answers a real **404**, never the `room-not-found` flash. A message sent from
  `/projects/[project-slug]/cht-…` is stamped with the project (`projectChatRef`). The Members
  "Message" action opens `/projects/[project-slug]/cht-…`, bringing the pair's DM into the project
  first when it is not there (`POST /api/projects/messages/dm`), and the room header's "Take out of
  this project" lands on `/messages/cht-…`. Fixture DMs keep their `dm-{handle}` ids.

  **A message is addressed by `?m=<messageId>` on its conversation's chat address**
  (Decision #162(G)): `/messages/cht-…?m=<id>` for a DM, `/projects/[project-slug]/[stage-slug]/chat?m=<id>`
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
  `/projects/[project-slug]/discussion`, built by `discussionHref`. On a **Task** and a **session** it
  is the lane's top-tier **Discussion** link. On a **staged** engagement — a pipeline or a milestone
  one-off (`isStagedArchetype`) — the lane's expanded top tier draws no Discussion link: the address
  is the **General** row, first in the collapsible **Discussion** group that also holds every stage's
  `#` channel (`/projects/[project-slug]/[stage-slug]`), with the same activity mark; the collapsed
  rail keeps its Discussion icon (Decision #409). The address and the room do not change.
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

  **An engagement's home view is its archetype's** (`engagementHomeHref`, `@projective/types/projects`,
  Decision #409): a pipeline opens on `/projects/[project-slug]/board`, a one-off on `/timeline` (on
  `/details` while its draft setup is incomplete), a session on `/calendar`, and a Task on its root.
  The archetype is read from `format` · `structure_variation` (`engagementArchetype`), never from
  whether the row came from a service blueprint. Add to Projects instantiates pipelines only
  (`marketplace.instantiate_service_blueprint` refuses any other delivery model), so the draft's
  `boardHref` — the listing's Open project — is always the Board; a session or one-off listing goes
  through `/checkout` instead.

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
  lane, header band, footer rig and inspector panel are resolved by `filesLaneFor` / `filesHeaderFor` /
  `filesFooterFor` / `filesPanelFor`.
- **Two mounted families share that wildcard (Decision #394).** `/files/drives/{connectionId}` opens a
  connected drive and each further segment is one provider folder id (`driveAddressOf`:
  `packages/types/files/folders.ts`; a connection is a uuid, so a library folder called `drives` keeps
  its own address). `/files/mnt-{projectSlug}` opens an engagement's files, and each further segment is
  a node of its submissions tree. Both read through the domain that owns them and answer read-only. The
  crumb bar's Back and Forward walk this visit's history and never leave `/files`.
- **What an account bought is `/files?source=purchases` (Decision #488).** A page state of the `/files`
  route, not a folder and not an `AssetSource` member (`AssetSource` names where a library file's
  bytes live, `files.file_source`; a purchase is not a storage provider). The handler reads the
  acting account's entitlements server-side (`DeliveryBackendService.purchases`, newest first) and
  renders `PurchasesView` in the library body's box, under the same lane, whose **Purchases** row
  (and the header band's Browse menu below 768px) is the entry. `&entitlement=ent-…` stands the page
  on one purchase (the confirmation's "Open in Purchases" for a bundle); an unrecognised value is
  dropped. The library-only chrome stands down there: the band keeps only Browse, and no footer rig
  or inspector mounts. Each file's Download is `/api/downloads/[entitlement]/[fileId]`.
- **What other people shared with the viewer is `/files?source=shared` (Decision #570).** Shared with
  me, a page state of the `/files` route like the purchases view (`isSharedView`; the href is
  `sharedWithMeHref()`, `@projective/types/files`). The handler reads
  `FilesBackendService.sharedWithMe` (`files.list_shared_with_me`) server-side and renders
  `SharedWithMe` in the library body's box; its lane row sits beside Purchases (and in the header
  band's Browse menu below 768px). The same chrome stands down as on purchases. Each row opens the
  file at `/inspect/{fileId}`, which answers for whoever may read it.
- **A filtered file view is a URL (Decision #363).** The facet filters ride in the query under the
  list API's own names, each a comma list: `?categories=` (`FileCategory`), `?sources=`
  (`AssetSource`), `?visibility=` (`AssetVisibility`) — e.g. `/files/Brand?categories=Image,Video`,
  or beside `?path=` on `/teams/:h/files` and `/businesses/:h/files`. The server reads them for the
  first page (`facetsOfSearch`, `features/files/core/asset-model.ts`), so a shared link paints
  filtered; the body seeds the controls from them on mount and on Back/Forward, and writes them back
  with `replaceState` on every change (a filter is not a place, so it adds no history entry). An
  unrecognised value is dropped, never an error. Folder navigation keeps them; search text (`query`),
  sort and selection are not in the URL.

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
  The trail rides the middle-nav header band on steps 1 and 4 (`basketHeaderFor`); on the two focus
  steps it is server-rendered into the shell top bar's centre from the URL alone (`checkoutTrailFor`,
  `features/checkout/core/checkout-trail-slot.tsx`, Decision #431), and those steps register no band.

  | Step | File                                    | URL                      | Chrome (Part D.6)                                      |
  | :--- | :-------------------------------------- | :----------------------- | :----------------------------------------------------- |
  | 1    | `(dashboard)/checkout/index.tsx`        | `/checkout`              | `full` — basket + the list explorer in the lane        |
  | 2    | `(dashboard)/checkout/details.tsx`      | `/checkout/details`      | **`focus`** — the step trail in the top bar, no bands  |
  | 3    | `(dashboard)/checkout/payment.tsx`      | `/checkout/payment`      | **`focus`** — the step trail in the top bar, no bands  |
  | 4    | `(dashboard)/checkout/confirmation.tsx` | `/checkout/confirmation` | `full` — restored, its job is to send the buyer onward |
  | —    | `(dashboard)/checkout/orders.tsx`       | `/checkout/orders`       | `full` — the confirmation step's chrome; not a step    |

  **`/checkout/orders` is every past order (MARKETPLACE CK3, Decision #517).** The acting account's
  order history, newest first, 20 to a page, following the basket's owner switch: `?owner=` scopes it
  exactly as it scopes the basket (a person's own orders, or a team's or business's to a member who may
  see its finances), and is kept in every link as below. It pages by **keyset, never by offset**:
  `?after=` lists the page placed before a boundary, `?before=` the page placed after one. The
  boundary is an opaque token the server mints and alone reads (`order-history.ts`: the order's
  `placed_at`, verbatim, and its id); a token it did not mint reads as the newest page, so a mangled
  link lands somewhere true. Both are one-shot and never carried. Each row opens its receipt,
  `/checkout/confirmation?order=&owner=`, and each line links to its home: a download to the purchases
  view on its purchase (`purchasesHref(ent-…)`), a session, block or seat to its session workspace
  (`/projects/prj-…`), an engagement to its project or stage. It is **not a fifth step**:
  `checkoutStepOf` answers `confirmation` for it, so it runs in that step's full chrome, lane and band,
  and the trail gains no entry. It lives under `/checkout` because a new top-level segment needs a
  reserved handle (`org.fn_is_reserved_handle` + `RESERVED_HANDLES`); the confirmation's _Your recent
  orders_ section links to it (_All orders_). `?order=` carries the order's **raw uuid**, which no
  prefixed slug yet replaces (no `fn_slug_guard('ord')`): a Decision #88 gap, PRODUCTION_READINESS
  PRD-J6.

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
  the flow to one engagement, and `?ticket_id=` (a `tkt-…` slug, Decision #430) to one ticket's stage
  lines — Buy now's scope on a ticket and its "Review on the full checkout" link; `?edit=1` on Details
  forces the form open; `?display=` names the
  display currency the basket, checkout and cards reads price in (`contextFrom` in `basket-model.ts`
  passes it to `/api/basket|checkout|cards`; `POST /api/basket/promo` counts every attempt that names a code per account and per client address, and past 10 / 20 in 10 minutes answers 429 with `Retry-After`, so codes cannot be enumerated (FINANCE_AUDIT CO22, CK2); FDD N27). Dev Context Switcher axes travel as separate
  validated `sim*` params (`simOwnerScope` · `simProviders` · `simWalletCover` · `simCards` ·
  `simDetails` · `simBilling` · `simInvoicing` · `simSpendLimit` · `simFulfilment` ·
  `simConferencing`) and are ignored on the live path. Two axes act on the live path and so are never
  `sim*` params: `checkoutPayment` and `fxCheckout` (Decision #436) travel as the `pj.dev.checkout-payment`
  and `pj.dev.fx-checkout` cookies, honoured in development only, so the session read, the charge and
  `create` all see the same answer. Details' redirect keeps the whole query
  string. Every other link between the steps rebuilds `?basket=`, `?owner=` and the narrowing
  (`?project_id=` · `?service_id=` · `?ticket_id=`) and carries `?display=`, `?pay_in=` and the `sim*`
  axes (`carriedParams` + `withCarry` in `basket-model.ts`, Decision #433). That covers Payment's backward
  `302`, the step trail, _Change Details_ and the save on Details, and closes FDD X23 / N26. One-shot
  params (`?edit=`, `?order=`, `?pay=`, `?attempt=`, `redirect_status`) are never carried.

  **`?pay_in=` is the currency the buyer pays in (Decision #435).** Absent, Payment charges the buyer's
  billing currency through a locked conversion quote whenever the order is priced in another and the
  quote door prices it. `?pay_in=<order currency>` pays the listing's own currency instead. The rail's
  _Pay in {currency} instead_ link (`PayInChoice`, hrefs from `payInHrefs()`) is the only control,
  and it navigates, so the server re-prices. Only the order's currency is ever written. Payment
  answers `302` to the canonical address (`payInRedirect()`) for a lower-case code, the billing
  currency, a currency the order cannot be paid in, or a choice with no conversion on offer. The
  island's re-reads send it as `pay_in`, so a re-read quotes the same way. A shown quote is re-read
  4 minutes before it runs out, and a payment on a quote that has run out is refused `quote_expired`,
  re-read and confirmed again.

  **A backward link to Details appends `?edit=1` (Decision #433).** The trail's completed Details
  step and _Change Details_ on Payment are built by `detailsEditHref()`, so a buyer whose details
  are complete reaches the form instead of being auto-skipped straight back to Payment. Payment's own
  `302` to Details does not append it, because that bounce means the details are incomplete and the
  form will show anyway. Saving on `/checkout/details?edit=1` returns to `/checkout/payment` with the
  carry and without `edit=1`.

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
  into a 404. It is listed in `RESERVED_HANDLES` and `org.fn_is_reserved_handle`.
- **`rsvp`** (Decision #391): `/rsvp/:token` is a guest's capability address, so an `@rsvp` profile
  would borrow its voice, and a bare `/rsvp` would fall through to `/:handle`. It is listed in
  `RESERVED_HANDLES` and `org.fn_is_reserved_handle`.
- **`changelog`**, **`feedback`** and **`features`** (the public-routes build, 2026-10-17) are
  denied ahead of their routes. `/changelog` and `/feedback` are public editorial surfaces that
  speak for the platform — an `@changelog` or `@feedback` profile would borrow that voice the way
  `@share` would borrow the share route's — and `/features` is the landing track's feature
  catalogue. `/changelog` (P5) and `/feedback` (P7) now have their routes; `/features` has none until
  the landing track lands it, so a bare request meets no static route and falls through to
  `/:handle`, which the denylist turns into a 404 rather than a fabricated profile. All three are in
  `RESERVED_HANDLES` and `org.fn_is_reserved_handle` (pinned by
  `supabase/probes/reserved_handles.sql` as well as the contract test).
- **`newsletter`** (PRD-E11, Decision #480): `/newsletter/confirm` and `/newsletter/unsubscribe` take
  a mailed link's token, so an `@newsletter` profile would borrow the list's voice the way `@rsvp`
  would borrow the invitation's. CD1 reserved it with its routes, among the route words of
  `RESERVED_HANDLES` and `org.fn_is_reserved_handle` (pinned by `reserved_handles.sql` too).
- **`robots.txt`** and **`sitemap.xml`** were reserved before they were served; since P8 (Decision
  #279) they are routes of their own (`(public)/robots.txt.ts`, `(public)/sitemap.xml.ts`), and the
  namespace guard below counts them as the top-level segments they are.

- **Planned segments** (`PLANNED_SEGMENTS` in `@projective/types/profile`, Decision #444 flag (c),
  ruled 2026-11-18) are reserved before any route file exists, because the namespace guard below
  sees only `apps/web/routes/`. `reserved.ts` gives each word's source. There are four sources:
  - **Sitemap rows with no file:** `analytics`, `connections`, `disputes` and `reset`, from the
    PRODUCT_SPEC §Sitemap rows with no route file.
  - **Paths served outside the routes tree:** `vendor` (`/vendor/<lib>/<version>/…`,
    `vendorAssets()`, #161) and `email` (`static/email/`).
  - **The sign-up form's old list:** `root`, `support`, `projective`, `www` and `mail` (#257 flag
    (d)). That form now reads `RESERVED_HANDLES` and keeps no list of its own.
  - **Speculative words:** 57 of them. They are platform voices (`security`, `trust`, `staff`, …),
    plausible surfaces (`docs`, `developers`, `integrations`, `marketplace`, …), infrastructure and
    sign-in paths (`auth`, `sso`, `webhooks`, …) and placeholder words (`null`, `guest`, …).

  When a planned word's route ships, the contract test asks for it to move out of
  `PLANNED_SEGMENTS`, because the route now reserves it.

All are enforced through the one SSOT guard (`isReservedHandle`) and its SQL twin
`org.fn_is_reserved_handle` (pinned by `workspace.contract.test.ts`), so a future "claim your
handle" flow validating against it inherits every entry without knowing why any is listed. Every
door that mints a handle reads it:

- the team, business and enterprise create doors and the username change, through
  `org.fn_handle_refusal`;
- both doors that mint a person (the GoTrue sign-up trigger and `complete_onboarding`), through
  `public.provision_user_profile`;
- `/api/auth/join` and the sign-up form, through `IndividualJoinSchema` and `usernameError`, which
  both say `USERNAME_RESERVED`.

Both doors that mint a person also ask the whole namespace through `org.fn_handle_taken`, under the
create doors' per-handle lock. A handle any person (in any case), team, business or enterprise
holds, or one released in the last 90 days, is taken (PRD-C25). The refusal stays the generic
`JOIN_REFUSED` / `ONBOARDING_REFUSED`, so sign-up is no oracle for who holds a handle. Only the
shape still differs: a person's username keeps `USERNAME_RE` (which allows `.`, `_` and capitals),
while the rest of the namespace keeps its stricter pattern. The owner left that for a later
decision (2026-11-18).

**The namespace guard (Teams P1).** Every top-level URL segment `apps/web/routes/` serves — route
groups `(…)` descended (they add no segment), `[params]`, `_`-prefixed files and `index` skipped, as
are files that are no route module (`*.test.*`, `*.spec.*`, `*.d.ts`) and `.`-prefixed entries
(`.well-known`, which no handle can spell: every handle starts with a letter or digit); a dotted route module claims
its whole stem (`feed.xml.ts` → `feed.xml`, as `robots.txt` and `sitemap.xml` are reserved) — must
be a reserved handle. `workspace.contract.test.ts` enumerates the routes tree and fails, naming the
segment, when one is missing from `RESERVED_HANDLES`; the same test pins `RESERVED_HANDLES` to
`org.fn_is_reserved_handle`, so **a new top-level route is reserved in both in the same change**
(`reference/pr-checklist.md`). Its first run found `invite` (`/invite/:token`, Decision #145) and
`saved` (`/saved`, Decision #180) unreserved — both are now in the two lists — so nobody can claim
`@saved` and shadow the page by name.

### The owner edits their profile in place

`/:handle` is both the page visitors read and the page its owner edits (Decision #439, superseding
the Preview · Edit · Availability owner nav of #408). There is no edit mode and no owner route: the
owner's page is the visitor's layout with each block's pencil swapping it for its form in place, and
ownership is the live read's `viewer.isOwner`, with the owner's edit model read once by
`[handle]/_middleware.ts` (`ctx.state.profileEdit`) for the in-place editors. A visitor's page holds
none of the owner markup.

**Block anchors.** A block's editor is addressable by fragment, so a link elsewhere can open it:
`/:handle#basics` (the name) · `#about` (headline and story) · `#location` · `#availability` ·
`#skills` · `#languages` · `#showcase` · `#work` (opens Add work) on `/:handle`, and
`/:handle/experience#experience`; `#privacy` opens Settings → Profile as the contextual modal. A
fragment no block on the page owns is ignored, and a taken fragment is an instruction, not page
state: it is stripped with `replaceState` (the `?add=1` precedent), so a reload does not reopen the
editor. Builder: `ownerBlockHref` (`features/profile/core/owner-edit.ts`); the kind decides the
blocks (`editAnchorsFor`, matching `ProfileEditModel.sections`).

**Retired.** `/:handle/edit` **308s** to `/:handle`, query kept; the browser carries an old fragment
across, so `/:handle/edit#skills` still opens the skills editor. `/:handle/edit/availability`
**308s** to `/:handle#availability`. Settings → Profile (visibility, display switches), Settings →
Account (the handle) and Settings → Scheduling (call terms) hold the account-level settings the old
pages carried.

### Auth API (`/api/auth/*`)

Thin routes over the fat `AuthBackendService`, all gated by `AUTH_BACKEND_LIVE` (stub otherwise).
Every `POST` is throttled per client, and per identifier where it names one, with a uniform `429` +
`Retry-After` (`features/auth/core/throttle.ts`, IW-H3; a throttled confirm press `303`s back to its
page instead), and `routes/api/auth/_middleware.ts` forwards the
caller's address to GoTrue as `X-Forwarded-For`. The route list is the code's (IDG §4.5); the flows
are in `SYSTEM_ARCHITECTURE.md` §Authentication & Identity.

| Route                           | Method | Purpose                                                                                      |
| :------------------------------ | :----- | :------------------------------------------------------------------------------------------- |
| `/api/auth/login`               | `POST` | Email-or-`@handle` password sign-in; one generic refusal for every failure but a bot check   |
| `/api/auth/join`                | `POST` | Sign-up, or a signed-in owner's completion; an under-13 DoB locks this browser's `/join`     |
| `/api/auth/verify`              | `POST` | The 6-digit email code                                                                       |
| `/api/auth/resend`              | `POST` | Re-send the code; always reports success, except a failed bot check (#447)                   |
| `/api/auth/captcha`             | `GET`  | The public Turnstile site key for the sign-in dialog (`no-store`, Decision #447)             |
| `/api/auth/verification-status` | `GET`  | `/verify`'s confirmation poll, keyed on the `pj_pending_verification` cookie (Decision #185) |
| `/api/auth/confirm`             | `POST` | `/verify/confirm`'s Confirm press (a form body): spends the token, session cookies (#445)    |
| `/api/auth/confirm`             | `GET`  | Spends nothing: `303` to `/verify/confirm` with the same query (links mailed before #445)    |
| `/api/auth/forgot-password`     | `POST` | Begin recovery; anti-enumeration (always the same answer)                                    |
| `/api/auth/reset`               | `POST` | The recovery code plus the new password                                                      |
| `/api/auth/oauth/google`        | `GET`  | Google OAuth entry (PKCE; sets the verifier cookie)                                          |
| `/api/auth/sso`                 | `POST` | Enterprise SSO discovery by corporate domain                                                 |
| `/api/auth/callback`            | `GET`  | The OAuth / SSO PKCE callback; a Settings connect that fails returns `?connect=failed`       |
| `/api/auth/refresh`             | `POST` | Silent session renewal for the client 401 interceptor                                        |
| `/api/auth/logout`              | `POST` | End the session                                                                              |

### Profile and media API

| Route                                      | Methods                  | Purpose                                                                                                   |
| :----------------------------------------- | :----------------------- | :-------------------------------------------------------------------------------------------------------- |
| `/api/profile/[handle]`                    | `GET · HEAD · OPTIONS`   | The profile overview / a section payload (`?tab=`), through the shared read-endpoint factory (ETag, 304). |
| `/api/profile/[handle]/save`               | `POST`                   | Owner edits → `org.save_profile`; answers the fresh edit model. Refusals are field-keyed 422s.            |
| `/api/profile/[handle]/media`              | `POST`                   | Cut an avatar or showcase rendition from a library asset (crop in source pixels) and attach it.          |
| `/api/profile/[handle]/showcase`           | `PUT`                    | Reorder / empty showcase slots → `org.save_showcase`.                                                     |
| `/api/profile/[handle]/portfolio`          | `POST`                   | Create or edit one portfolio piece (`SavePortfolioPieceSchema`; a new piece needs a cover cut from a library asset) → `org.save_portfolio_piece`; answers the owner's portfolio as stored. Freelancers only (Decision #439). |
| `/api/profile/[handle]/portfolio/archive`  | `POST {id}`              | Archive one portfolio piece → `org.archive_portfolio_piece`; answers the owner's portfolio as stored.   |
| `/api/profile/[handle]/availability`       | `GET` (`no-store`) · `PUT` | The owner's schedule, weekly hours and call terms → `scheduling.save_owner_availability`.               |
| `/api/profile/[handle]/follow`             | `POST {follow}`          | Follow / unfollow as the caller (idempotent; following yourself is refused).                              |
| `/api/profile/[handle]/connections`        | `GET ?direction=&cursor=` | One page of the profile's `followers` or (a person's) `following` (Decision #180): `ProfileConnectionsParamsSchema` → `ProfileBackendService.connections` → `org.profile_follows` edges + `org.get_profile_cards` (a profile the caller may not see is left out) → `{ data: { items, nextCursor } }`, keyset on the follow instant. Public, like the edge. |
| `/api/media/library`                       | `GET` (`no-store`)       | The caller's own library images and videos, newest first, keyset-paged.                                   |
| `/api/media/upload-init`                   | `POST`                   | Declare an upload: a `pending_upload` row in `quarantine` + a signed upload URL.                         |
| `/api/media/upload-complete`               | `POST`                   | Run the pipeline: claim → sniff → decode → WebP tiers → admit (see `database/files/Storage.md`).         |
| `/api/media/oauth-avatar-sync`             | `GET` · `POST`           | `GET`: the caller's sign-in provider + allowlisted picture URL. `POST`: fetch it server-side and run it through the same pipeline into the caller's library (URL read from the verified identity, never the request). |
| `/api/media/proxy/[fileId]`                | `GET` · `HEAD`           | An asset's bytes STREAMED through the app after the read gate `objectFor` (`live-objects.ts`): `?tier=sm\|md\|lg` (a WebP rendition, else the original), `?download=1` (attachment), `?share=<slug>`. A top-level `GET` navigation (`Sec-Fetch-Dest: document`; without Fetch Metadata, an HTML-first `Accept`) is a `303` to `/inspect/[fileId]` (keeping `?share=`) unless `?raw=1` / `?download=1`; byte responses add `vary: sec-fetch-dest` (`features/inspector/core/proxy-navigation.ts`). Forwards `Range` / `If-Range` / `If-None-Match` / `If-Modified-Since` (206 · 304 · 416); headers from an allowlist, never copied from storage; never counts a download. Refusals are a bodiless `404` (also a malformed id), `429` with `retry-after`, or `503` — all `no-store`. `mediaProxyHref(id, opts)` builds it (Decision #161(A)); see `database/files/Storage.md`. Since Decision #162(A) it is the `url` / `thumbnailUrl` of every stored asset row (grid thumbnails `?tier=sm`, chat tiles `?tier=md`). |
| `/api/files/object/[id]`                   | `GET`                    | **Retired** (ASSET phase 1, Decision #SC9P1): a permanent `308` to `/api/media/proxy/[id]` with the same query (`?tier=`, `?download=1`, `?share=`), so a link already issued keeps working behind the proxy's gate. Reads and signs nothing; `public, max-age=86400`. |
| `/api/downloads/[entitlement]/[fileId]`    | `GET` · `HEAD`           | One file of a bought product, streamed to its holder through the app (Decision #488; `ASSET_DELIVERY_ARCHITECTURE.md` §6, §11). `:entitlement` is the purchase's `ent-…` slug, `:fileId` a file of the version it bought. Thin over `DeliveryBackendService.stream`: the entitlement and its version are read under the caller's own JWT, the acting context must BE the holder (a business member acting personally is refused), the purchase must be `active`, the file must be in the version; then the bytes come from the policy-less `originals` bucket as the service role — never a signed URL. Forwards `Range` / `If-Range` / `If-None-Match` / `If-Modified-Since` (200 · 206 · 304 · 416) with the `delivery` headers: `private, no-store`, `attachment` named from the version, `same-origin`, `default-src 'none'; sandbox`, `nosniff`, `noindex`. Refusals: a bodiless `404` for every one (malformed address, another account's purchase, a refunded or revoked one, a file outside the version); `Sec-Fetch-Site: cross-site` on anything but a navigation is a `404`; a signed-out navigation `303`s to `/login?redirectTo=`; `429` with `retry-after` past 120 fresh downloads a minute; `503` with `retry-after` while the version's copy lands or storage is unreachable. A response that streams a whole file to its last byte is recorded (`catalogue.fn_record_delivery`: `entitlements.first_delivered_at` once, a `files.download_events` row `via = 'purchase'`). `downloadHref(slug, fileId)` (`@projective/types/catalogue`) builds it. |
| `/api/files/tree`                          | `GET` (`?scope=workspace&subjectId=<entity uuid>` or `?path=<segments>` optional) | A files navigation tree, through `FilesBackendService.tree` (`FilesService.tree` on the client). With `path`, the nodes beneath a connected drive's folder or a mounted engagement, read when that row is opened (`FilesBackendService.treeChildren`, Decision #394). With no scope, the `/files` hub's (the acting library · mounted engagements · connected drives). With `scope=workspace`, one team's or business's drive — its root and every live folder, each counting its subtree's files (`library-tree.ts`), every node `readOnly` when the entity is archived — read only through the caller's active seat (`entitySeatOf`): a stranger, a departed member and an unknown id all get the same `404` as the drive's listing. `400` for any other scope or a missing `subjectId`; `503` when the read fails (Decision #317). |
| `/api/files/folder-color`                  | `POST` (`{ folderId, color }`) | Set a folder's `#rrggbb` colour, or clear it with `null`, through `FilesBackendService.setFolderColor` (`FilesService.setFolderColor` on the client). Only the folder's owner may, and never on a mounted folder: anything else is the same `404` (Decision #395). |
| `/api/files/folder-rename`                 | `POST` (`{ folderId, name }`) | Rename a folder through `FilesBackendService.renameFolder` (`FilesService.renameFolder` on the client): a sibling of the same name is refused, because a folder is addressed by its name, and every folder beneath it has its `path` rewritten. A mounted folder is refused. |
| `/api/files/copy`                          | `POST` (`{ assetIds, folderIds, targetFolderId }`) | Copy assets and folders into a folder of their own library (`null` is its root) through `FilesBackendService.copy` (`FilesService.copy` on the client). A folder brings its subtree; bytes are copied in storage (`items_storage_object_unique`), the quota trigger meters them, and a copy starts private with no share link. Bounded at 200 files a paste. |
| `/api/files/inspect`                       | `GET` (`?id=<uuid>&share=<slug>`) | One stored asset's `InspectAsset` for the preview modal (Decision #162) — the same DTO `/inspect/[fileId]` renders, through `FilesBackendService.inspect` (`FilesService.inspect` on the client). `400` with no `id`; every refusal `404`; `503` when the read fails. |
| `/api/files/access`                        | `GET` (`?id=<uuid>`) · `POST` (`SetItemAccess`) | The inspector's Access tab (Decision #402), through `FilesBackendService.access` / `setAccess` (`FilesService.access` / `setAccess` on the client). `GET` answers `ItemAccess` — the tier, the library, the caller's standing, the grants for the owner and editors, the message shares and live share link for the owner. `POST` saves the tier, the member switch and the whole grant list in one transaction (`files.set_item_access`) and answers the fresh `ItemAccess`. `401` signed out · `400` no `id` · `403` not the caller's to change · `404` every refusal to read · `422` a payload or grant the rules refuse (`errors.grants`) · `503` the read failed. |
| `/api/files/access-targets`                | `GET` (`?q=<text>` optional) | The teams, businesses and projects the caller may grant a file to — the ones they belong to — for the Access tab's picker, through `FilesBackendService.accessTargets` (`FilesService.accessTargets`; `files.list_access_targets`). `q` is trimmed to 80 characters. People come from `/api/messaging/suggestions`. `401` signed out · `503` the read failed. |
| `/api/files/drive-thumbnail`               | `GET` (`?connectionId=<uuid>&id=<provider object id>&v=<change token>`) | A connected drive object's card picture (Decision #401), the `thumbnailUrl` a connector row carries when the provider reports one (`driveThumbnailHref`). `DriveThumbnailParamsSchema` → `IntegrationsBackendService.thumbnail`, under the caller's OWN storage-granted connection: the adapter reads the provider's short-lived link and fetches the bytes server-side from the provider's own picture hosts only (Google: `lhN.googleusercontent.com`, `docs.google.com`, `drive.google.com`), 8 s, 2 MiB stream-capped, kept only when sniffed PNG / JPEG / GIF / WebP. Answers those bytes with this route's own headers (`private, max-age=3600`, `nosniff`, `sandbox`); `v` is a cache key and is never read. Every refusal is bodiless (`404` someone else's connection or no picture, `409` reconnect, `429` past 600 a minute, `502` the provider, `503` gate off) and the card keeps its tile. |

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
hard-navigates to the person's profile on its About block (`/@handle#about`, Decision #439).
`/become-partner` itself reads the setup facts and the skills taxonomy server-side
(`UserBackendService.setup` / `starterSkills`) and hands them to `BecomePartnerWizard` as props.

### Proposed: asset delivery and protection (Decision #393)

**None of these exist yet.** They are here so the design's addresses are reviewed against this file
before a handler lands, and each row moves to its own section in the same change as its handler.
Phase 0 (Decision #488) moved `/files?source=purchases` and `/api/downloads/[entitlement]/[fileId]`
to their sections above, and minted `ent-`.
Contracts: `ASSET_DELIVERY_ARCHITECTURE.md` §11 and `ANTI_PIRACY_ENGINE.md` §11.

| Address                                                 | Kind       | Purpose                                                                                                                                            |
| :------------------------------------------------------ | :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/catalogue/:slug?tab=edit&section=protection`          | Page state | The seller's protection controls; `file`, `view` and `tile` keep a comparison linkable.                                                            |
| `/catalogue/protection`                                 | Page       | Leak alerts and takedown cases (`?status=`, `?match=lkm-…`). A static route, so it must be added ahead of the non-slug `303` on `/catalogue/:slug`. |
| `/teams/:teamHandle/catalogue/protection`               | Page       | The team counterpart.                                                                                                                              |
| `/api/media/public/[variantId]`                         | API        | CDN origin for the public plane.                                                                                                                   |
| `/api/assets/link`                                      | API        | Resolves a raw storage link to a viewer or purchase page. Under `/api/` so it cannot collide with `[handle]`.                                      |
| `/api/downloads/[entitlement]/[fileId]/status`             | API        | A rendering delivery's progress (phase 5). The file route itself is live (Decision #488, above).                                             |
| `/api/reader/[entitlement]/[fileId]/*`                  | API        | The encrypted in-app reader.                                                                                                                       |
| `/api/entitlements/[entitlement]/tokens`, `/[id]`       | API        | Registry and licence tokens.                                                                                                                       |
| `/api/registry/[...path]`, `/api/licences/verify`       | API        | The private package registry and licence gateway.                                                                                                  |
| `/api/catalogue/files/*`, `/api/catalogue/protection/*` | API        | Sale-original uploads and seller controls. `?team=` as elsewhere.                                                                                  |
| `/api/protection/*`                                     | API        | Matches, channels, takedowns, and `cron/[job]` on the bearer pattern.                                                                              |

New slug prefixes (Decision #88): `lkm-` and `tkd-` (`ent-` is live, #488). Two live routes change:
`/api/media/proxy/[fileId]` refuses the new buckets, and `/api/files/object/[id]` is retired (a `308` to
the proxy since phase 1, Decision #SC9P1).

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
- **Every integration connection starts in Integrations** (Decision #440): a trigger anywhere calls
  `openSettings("integrations", "calendars" | "storage" | "conferencing")`. A consent started in the
  modal returns to the page underneath as `…&settings=integrations&connect=connected|failed`
  (`consentReturnPath`, `core/integrations-model.ts`), so the modal reopens there; the section reports
  the outcome and strips `connect`, and closing it leaves the page as it was.

| Route                                    | Method | Service → database |
| :--------------------------------------- | :----- | :----------------- |
| `/api/settings/[section]`                | `GET`  | `resolveSettingsSection` (`features/settings/core/settings-ssr.ts`) — the section's payload (`SettingsSectionEnvelope`, `@projective/types/settings`), composed from the services that own each section's data. `404` unknown section · `401` guest · `no-store`. `error` names a PART that could not be read; the request itself still succeeds. |
| `/api/user/preferences`                  | `GET` · `PATCH` | `PATCH` takes `UserPreferencesUpdateSchema` (strict: display currency · locale · direction · theme · `contrast` · `font` · `cvd` · `motion` · `uiSettings`) → `SettingsBackendService.updatePreferences`, which splits it: the display half through `UserBackendService.updatePreferences`, the appearance half into the four `org.user_preferences` columns, the `uiSettings` half merged key by key into `ui_settings` (Decision #371; a protected or unknown shortcut id is a `422`). Answers `{ preferences, appearance, appearancePersisted, uiSettings, uiSettingsPersisted }` and, whenever the appearance, the keyboard settings or direction changed, **`Set-Cookie: pj.a11y=…`** (`utils/a11y-context.ts`) so the next response is server-rendered in the new overlays. A patch that touches a claim (`touchesTokenClaims`: locale · display currency · date format) re-issues the session on the same response (`claimsStale: true` when it could not; Decision #193). `GET` adds `{ appearance, appearanceLive }`. |
| `/api/user/emails`                       | `GET` · `POST` `{ email }` | `EmailsBackendService.list` → `org.get_my_emails` · `.add` → `org.add_user_email`, then the token through the SERVICE client `security.issue_email_verification` and `services/mail/verification-mailer.ts`. `POST` → `201 { emails, delivery }` (`sent` · `logged` · `unavailable`); 422 `errors.email`; 429 `details.retryAt` (5 sends per 15 min). The raw token never reaches a browser. |
| `/api/user/emails/[id]`                  | `DELETE` | `EmailsBackendService.remove` → `org.remove_user_email` (never the primary or the sign-in address) |
| `/api/user/emails/[id]/primary`          | `POST` | `EmailsBackendService.setPrimary` → `org.set_primary_email` (verified addresses only) |
| `/api/user/emails/[id]/resend`           | `POST` | `EmailsBackendService.resend` — a fresh token (earlier ones expire); 409 when already verified |
| `/api/user/emails/[id]/sign-in`          | `POST` `{ password, captchaToken?, makePrimary? }` | `EmailsBackendService.makeSignIn` (Decision #451): `org.prepare_sign_in_change` → GoTrue password grant on the current address (`reauth` throttle) → admin `updateUserById` → `org.record_sign_in_change` → other sessions signed out → notice mailed to the old address; re-issues the session. 422 `password_incorrect` · 409 `sign_in_unverified` / `sign_in_already` / `account_closing` / `password_required` / `sign_in_unavailable` · 429 `sign_in_limit` (`retryAt`) |
| `/api/user/emails/verify`                | `GET` `?token=` · `POST` `{ token }` | The mailed link. The `GET` spends nothing (PRD-C11): it shape-checks the token and **303→** `/settings/account?email-token=<token>#emails` (`?email=invalid` when malformed); the dashboard guard signs a visitor in and keeps the query. The Email addresses block takes the token off the address and asks for a press: Confirm sends `POST { token }` (JSON, origin-guarded) → `org.confirm_user_email` for the signed-in account → `{ ok, outcome }` (`EmailVerifyOutcome`), `422` without a token. `no-store`, `no-referrer`. Refusals carry `details.refusal` (an `EmailRefusal` code); a non-uuid `:id` is 404. |
| `/api/user/notifications`                | `GET` · `PUT` | `NotificationCenterBackendService` over `comms.notification_prefs` / `notification_category_prefs` / `notification_types` in the caller's JWT. `PUT` = `NotificationCenterUpdateSchema` (partial; `resetChannels` sets a channel back to `null` on every category row so a master toggle is not outranked). 401 guest · 422 invalid / quiet hours incomplete · 503 not live. |
| `/api/settings/attention`               | `GET`  | `attentionFactsFor` — the attention FACTS (`SettingsAttentionFacts`) for the contextual modal's section marks (Decision #156). `401` guest · `no-store`. |
| `/api/user/handle`                      | `GET` · `POST` `{ handle }` | `AccountLifecycleBackendService.handlePolicy` → `org.get_handle_policy` · `.changeHandle` → `org.change_username` (two changes in three days, then a 90-day lock; a released handle is held 90 days). Answers `{ policy, previous }`; refusals carry `details.refusal` and a namespace refusal `errors.handle`. A change re-issues the session on the same response (the token carries the handle; `claimsStale: true` when it could not; Decision #193). |
| `/api/user/lifecycle`                   | `GET` · `POST` `{ scope, confirmation }` · `DELETE ?scope=` | `AccountLifecycleBackendService` → `org.get_account_lifecycle` · `org.schedule_freelancer_removal` / `org.schedule_account_deletion` (typed `CONFIRM`; 409 `details.blockers` while anything blocks) · `org.cancel_deletion_request`. Answers `{ lifecycle }`; a `freelancer_profile` schedule or cancel re-issues the session (`isFreelancer` rides the token; `claimsStale: true` when it could not; Decision #193). |
| `/api/user/identities`                  | `GET`  | `IdentitiesBackendService.list` — `{ identities, available, canDisconnect }` (GoTrue identities; providers on in this environment from GoTrue `/settings`). |
| `/api/user/identities/[id]`             | `DELETE` | `IdentitiesBackendService.unlink` — 409 for the email identity and for the last way to sign in; answers the remaining list. |
| `/api/user/identities/link/[provider]`  | `GET`  | Starts a PKCE `linkIdentity` for the signed-in person, sets ONLY the code-verifier cookie, **303→** the provider; the shared `/api/auth/callback` completes it and returns to `/settings/account?connect=<provider>#connected-accounts` (a failure → `?connect=failed`, never the sign-in page). |
| `/api/user/cron/erasures`               | `POST` (`?limit=`) | The scheduler's door to `AccountLifecycleBackendService.sweepDue` → `security.purge_due_account_deletions`. Bearer `ACCOUNT_CRON_SECRET` (≥ 32 chars, constant-time); anything else **404**. |
| `/api/user/data-export`                 | `GET` · `POST` | A person's copy of their own data (Decision #450). `DataExportBackendService.state` → `org.get_data_export` · `.request` → `org.request_data_export`. Answers `{ dataExport }` (`DataExportState`: latest request, `nextRequestAt`, `signInFresh`, `accountClosing`). Refusals carry `details.refusal`: 403 `reauth_required` (no sign-in in the last 10 minutes) · 409 `already_pending` / `account_closing` · 429 `rate_limited` with `details.retryAt`. 401 guest · 503 not live. |
| `/api/user/data-export/download`        | `GET`  | `DataExportBackendService.download` — the caller's ready archive, **streamed** through the app as an attachment (`projective-data-<date>.zip`, the `delivery` header class; no signed URL, ASSET phase 1, Decision #SC9P1); signed out **303→** `/login?redirectTo=/settings/account`; nothing ready or storage unreachable **303→** `/settings/account?export=unavailable#data-export`. `no-store`, `no-referrer`. |
| `/api/user/cron/data-exports`           | `POST` (`?limit=`, ≤ 25) | The scheduler's door to `DataExportBackendService.sweep` (job `account-data-exports`): builds claimed requests into ZIPs in the private `data_exports` bucket, then removes archives past their 7 days. Bearer `ACCOUNT_CRON_SECRET`; anything else **404**. |
| `/api/messaging/settings`                | `GET` (`?role=`) · `POST` `MessagingSettings` | `MessagingBackendService.settings` · `.saveSettings` → `live-settings-write.ts`, the exact inverse of the reader: `comms.notification_prefs`, the `messages` category's `in_app`, the `message.new` / `message.mention` in-app mutes, and a replace-set of `comms.auto_responses` over the rules shown. Answers the fresh read. 422 field errors · 401 guest. |

### Notification inbox API

Thin routes over `NotificationInboxBackendService` (`@server/services/comms/`), each Zod-parsing with
the `@projective/types/comms` schemas, resolving the actor from the session (401 for a guest or an
expired live session), and answering the flat `serviceResponse` envelope. Live behind
`AUTH_BACKEND_LIVE` (as `/api/user/notifications`); otherwise per-user fixtures
(`services/comms/notification-fixtures.ts`). Writes go only through the `SECURITY INVOKER` inbox RPCs.

| Route                             | Methods | Behaviour |
| :-------------------------------- | :------ | :-------- |
| `/api/notifications`              | `GET` `?category=&contextType=&contextId=&unreadOnly=true&archived=true&q=&before=&limit=` | `NotificationListParamsSchema` → `.list`: `comms.notification_feed` (`archived=true`: the archived rows of `comms.notifications` instead; every item carries `actor` from `org.get_party_cards`, Decision #173; `q` — 1–100 chars, empty dropped by the route — matches `title` or `body` case-insensitively, its PostgREST delimiters and wildcards made inert by `inboxSearchTerm`, Decision #429), newest first, keyset on `created_at` (`before` = the previous page's `nextCursor`), plus the badge summary → `{ items, summary, nextCursor }`. 422 bad param or cursor. |
| `/api/notifications/summary`      | `GET`   | `.summary` → `comms.get_notification_summary()` → `{ unread, unseen, total, byCategory }` (`byCategory` = unread per category, absent = 0). |
| `/api/notifications/read`         | `POST` `{ ids }` | `NotificationIdsSchema` (1–500 uuids) → `comms.mark_notifications_read` → `{ updated }`. |
| `/api/notifications/read-all`     | `POST` `{ category? }` | `MarkAllReadSchema` → `comms.mark_all_notifications_read`; empty body = every category → `{ updated }`. |
| `/api/notifications/seen`         | `POST`  | `comms.mark_notifications_seen` — clears the badge, reads nothing → `{ updated }`. |
| `/api/notifications/archive`      | `POST` `{ ids }` | `NotificationIdsSchema` → `comms.archive_notifications` (dismiss; never a hard delete) → `{ updated }`. |
| `/api/notifications/push/config`  | `GET`   | Web Push (COMMS NT4): `PushDeviceBackendService.config` → `{ publicKey }`, the VAPID public key a browser subscribes with. **404** while push is not configured (no well-formed `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`), and Settings → Notifications → This device then renders nothing. `no-store`. |
| `/api/notifications/devices`      | `POST` `PushSubscription.toJSON()` (+ `label?`) · `DELETE` `{ endpoint }` | This browser's push subscription, under the caller's session. `POST`: `WebPushSubscriptionSchema` → `.register` → `comms.register_device` (token = endpoint, `web_push`, `web`) → **201** `{ deviceId }`; the same subscription again refreshes its row. **422** a malformed body, or an endpoint that is not a known push service (an `https` FCM, Mozilla, Windows or Apple push host, no credentials or port: the server will POST to it). **404** while push is not configured. `DELETE`: `RevokeWebPushSchema` → `.revoke` → `comms.revoke_device` on the caller's own live device with that endpoint → `{ revoked }` (idempotent); signing out sends it too, then unsubscribes the browser. Registering releases another account's live row for the same endpoint (a shared browser belongs to whoever turned alerts on last). |
| `/api/notifications/devices/status` | `POST` `{ endpoint }` | Is this browser's subscription the caller's own live device → `{ live, stopped }` (`.status`, a read of the caller's newest row for it). Settings → This device shows "on" only when it is, never for a browser another account turned on; `stopped` when Projective revoked it (`gone`, `gateway_failures`, `stale`), so it offers Turn on again (PROJECTS NO3). A POST because an endpoint is a capability URL that must not sit in a query string or an access log. `no-store`; 401 guest; 422 no endpoint. |
| `/api/comms/dispatch`             | `POST` `{ notification_id }` | The notification dispatcher's entry point (Decision #344 (a)): the `comms.notifications` trigger posts here through pg_net. `DispatchRequestSchema` (the id alone) → `NotificationDispatchService.dispatch` → `{ claimed, sent, failed, skipped, suppressed }`. Bearer `COMMS_DISPATCH_SECRET` (≥ 32 chars, constant-time), checked before the body is read; anything else **404**; 422 any other body. A named server-to-server door in the `/api` origin guard (`utils/csrf.ts`), since the database sends no `Origin`. |
| `/api/comms/cron/dispatch`        | `POST` (`?limit=`, 1–500, default 200) | The dispatcher's retry sweep (job `comms-dispatch-sweep`, every minute): one pass over every due delivery. Bearer `COMMS_DISPATCH_SECRET`; anything else **404**. |
| `/api/comms/cron/digests`         | `POST` (`?limit=`, 1–500, default 50) | The digest send (job `comms-digest-send`, every 10 minutes from :03; PROJECTS NO2): `DigestMailService.send` mails each digest `comms.fn_claim_digests` leases and records it through `comms.fn_record_digest_result`. Bearer `COMMS_DISPATCH_SECRET`; anything else **404**. |
| `/api/ops/cron/alerts`            | `POST` (`?limit=`, 1–500, default 50) | The alert sweep (job `ops-deliver-alerts`, every 5 minutes; MR4, Decision #461; OPS5): `OpsAlertService.deliver` claims, sends by webhook, email digest and an in-app notice to every operator, records. Bearer `OPS_CRON_SECRET`; anything else **404**. |
| `/api/ops/health`                 | `GET` | The heartbeat an outside uptime monitor polls every 5 minutes (OPS5): **200** `{ok: true}` only while the database answers, `ops-watch-jobs` succeeded within `heartbeat_watch_minutes` and no alert has waited 15 minutes; **503** `{ok: false}` otherwise; never more in the body (`OpsHealthService.heartbeat`, `features/admin/core/health-ssr.ts`). `cache-control: no-store`. Bearer `OPS_HEALTH_TOKEN`; anything else **404**. |
| `/api/search/cron/embeddings`     | `POST` (`?limit=`, 1–200, default 50) | The embedding backfill (job `search-embeddings-backfill`, hourly at :38; COMMS SR2, CAS S14): `runScheduledBackfill` embeds up to `limit` public discovery items whose stored vector is missing or stale. A no-op `200` while embeddings are off; `502` when a run stops on a refusal a later run cannot fix. Bearer `SEARCH_CRON_SECRET`; anything else **404**. |
| `/api/comms/webhooks/resend`      | `POST` (raw body, ≤ 256 KiB) | The email provider's delivery webhook (COMMS NT3): `DeliveryEventService.handleResend` checks the Svix signature (`RESEND_WEBHOOK_SECRET`, 300 s tolerance, constant time) before parsing, then `comms.fn_record_delivery_event` claims `(resend, svix-id)` with the effect in one transaction: delivered, a hard bounce (the address suppressed for every category and its owner told), a complaint (Marketing only). The newsletter's share follows the claim, replays included (CD1 step 5): Resend's `contact.*` events and a complaint go to `community.record_newsletter_provider_event`, which can take an address or a topic off the newsletter but never add one. **200** for handled, replayed and ignored events; **400** forged, stale or unreadable (and every delivery while the secret is unset); **413** oversized; **503** asks for a redelivery. No session; a server-to-server door. |
| `/api/comms/unsubscribe`          | `GET` · `POST` (`?token=`) | An account's one-click marketing unsubscribe (COMMS NT3, RFC 8058), beside the newsletter's `/api/newsletter/unsubscribe`. `GET` writes nothing and **303→** `/settings/notifications`. `POST` (`List-Unsubscribe=One-Click`, or any form post) verifies the signed token (the person, never an address) and suppresses their primary verified address for Marketing only (`comms.fn_unsubscribe_marketing`), answering plain text: 200, or **404** for a link this server did not sign. Cross-site and without `Origin` from the mail provider's servers, so the `/api` origin guard stands aside for this path (a form body or none). `no-store`, `no-referrer`. |

### Help centre API (P2)

Thin routes over the editorial and community help services; both are guest-reachable and answer the
flat `serviceResponse` envelope. The page itself is the `[...path]` row above.

| Route                | Methods | Behaviour |
| :------------------- | :------ | :-------- |
| `/api/help/search`   | `GET` `?q=` | `HelpCentreSearchQuerySchema` (trimmed, ≤ 120 characters, empty allowed) → `HelpBackendService.search` → `{ query, results: [{ slug, title, category, categoryTitle, href, snippet, highlights: { title, snippet } }] }` (≤ 20, best first; highlights are `[start, end)` runs). The in-memory index is built from the `editorial.help_*` rows (or the content source with `EDITORIAL_BACKEND_LIVE` off) and cached 5 minutes. `cache-control: public, max-age=60`. 503 when the help tables cannot be read. |
| `/api/help/feedback` | `POST` `{ slug, helpful, comment? }` · or the form `slug, helpful=yes\|no, comment, back` | `HelpFeedbackInputSchema` (a comment only with `helpful: false`, ≤ 280) → `HelpFeedbackBackendService.submit` → `community.submit_help_feedback` as the caller (their JWT when signed in, anon otherwise). JSON: `{ slug, helpful }` · 422 · 404 (an article nobody can read) · 429 (per process: 10 per signed-in voter per 10 minutes, 20 per guest address a minute; or the writer's `PH429`; `Retry-After` set) · 503. A form post answers **303** to `back` — only ever a `/help` path — with `?helpful=thanks\|error#was-this-helpful`. |

### Newsletter API (PRD-E11, Decision #480)

Thin routes over `NewsletterBackendService`. The two `GET`s write nothing (a mail scanner opens
every link): they `303` to the matching page with the same query. Every answer on the link's path is
`noindex`, `no-store` and `no-referrer`.

| Route                         | Methods | Behaviour |
| :---------------------------- | :------ | :-------- |
| `/api/newsletter/subscribe`   | `POST` `{ email, source?, topic?, captchaToken? }` | `NewsletterSubscribeSchema` → the Turnstile check (action `newsletter`; 400 `CAPTCHA_REFUSAL`, 503 when the check cannot run) → `community.subscribe_newsletter` → the confirmation mail when due, after the write commits. One answer for every accepted address, `{ email, topic }` and one message, whatever it held or was mailed (no enumeration) · 422 · 429 (5 per address in 10 minutes, `Retry-After`) · 503. |
| `/api/newsletter/confirm`     | `GET` | Writes nothing: `303` to `/newsletter/confirm` with the same query. |
| `/api/newsletter/confirm`     | `POST` form `token` · or JSON `{ token }` | The confirm page's press: origin-guarded (a form body allowed), throttled per client (10 in 10 minutes) → `community.confirm_newsletter`. A form post **303**s back to the page (`&notice=throttled` when throttled). JSON: 200 (confirmed or already) · 410 expired · 409 unsubscribed · 404 · 429 · 503. |
| `/api/newsletter/unsubscribe` | `GET` | Writes nothing: `303` to `/newsletter/unsubscribe` with the same query. |
| `/api/newsletter/unsubscribe` | `POST` `?token=` + `List-Unsubscribe=One-Click` | RFC 8058 one-click, from a mail provider's servers: **no Origin check** (`utils/csrf.ts` `ONE_CLICK_ROUTES`; a form body or none only, else 415), the token is the credential → `community.unsubscribe_newsletter(…, 'one_click')` → 200 `text/plain` · 404. |
| `/api/newsletter/unsubscribe` | `POST` form `token` | The unsubscribe page's button → `unsubscribe_newsletter(…, 'link')` → **303** back to the page. Idempotent; nothing is deleted. |
| `/api/newsletter/cron/sync`   | `POST` (`?limit=`, 1–200, default 50) | The scheduler's door to `NewsletterProviderSync.run` (job `newsletter-provider-sync`, every 5 minutes; CD1 step 5, Decision #480 Q1 A): pushes each send-eligible address and its topics to the Resend segment and deletes the contact of each address that left (`community.newsletter_sync_batch` → `record_newsletter_sync`). Bearer `COMMS_DISPATCH_SECRET` (≥ 32 chars, constant-time), the dispatcher's own; anything else **404**. Answers counts only, never an address; does nothing while `newsletter.provider_sync` is off. The provider's own contact events come back on `POST /api/comms/webhooks/resend`, not here. |

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
(profile), or an id (project_channel · conversation · message · file). This is the one save door: the
Explore results drawer's Save writes here too, and `/api/explore/bookmark` (`ExploreBookmarkService`,
a second door onto `org.user_bookmarks`) is **removed** (DS3, Decision #422).

| Route                            | Methods | Behaviour |
| :------------------------------- | :------ | :-------- |
| `/api/nav/preview`               | `GET` `?kind=messages\|projects\|catalogue\|teams\|businesses` | The rail's right-click preview (Decision #370) → `NavPreviewBackendService.preview`: the viewer's top 3 for that destination, saved/starred pinned first (newest pin first), then the destination's own ranking → `{ kind, items }` (`NavPreviewSchema`). Read only when a rail menu opens; 401 for a guest, 422 for an unknown `kind`. |
| `/api/saved`                     | `GET` `?tab=&collection=&cursor=&limit=` | `SavedListParamsSchema` → `.list`: the tab's kinds from every store, sorted (saves newest first, rows with no saved instant after, follows last), one page resolved for display → `{ items, nextCursor, collections }`, each collection with its `count` and up to four `covers` (the list boards, Decision #520). 422 bad param. |
| `/api/saved`                     | `POST` `{ type, ref, collectionId? }` | Save (idempotent) → `.toggle`, dispatched to the kind's store: `org.user_bookmarks` · `projects.user_preferences.is_starred` · `comms.set_dm_starred` · `comms.message_favorites` · `files.items.starred`. `collectionId` files a bookmark kind (`null` = unfiled; 422 on any other kind; 404 for a collection not the caller's) → `{ saved, collectionId }`. 404 for a ref the caller cannot see. |
| `/api/saved`                     | `DELETE` `?type=&ref=` | Un-save (idempotent) → `{ saved: false, collectionId: null }`. |
| `/api/saved/state`               | `GET` `?keys=type:ref,…` | Which of up to 100 keys the caller has saved → `{ saved }` (the keys as asked). Kinds: service · product · article · profile · project — the cards and lanes whose own read carries no flag. 422 for another kind. |
| `/api/saved/collections`         | `GET` · `POST` `{ name }` | The caller's collections → `{ collections }`; create one → `{ id, name }` (201; 409 when the name is taken). |
| `/api/saved/collections/[id]`    | `PATCH` `{ name }` · `DELETE` | Rename one → `{ id, name }` (409 when the name is taken, 404 when not the caller's; Decision #520); delete one, its bookmarks stay saved, unfiled → `{ id }`. |
| `/api/saved/collections/[id]/basket` | `POST` `{ basketId? \| newBasketName?, owner? }` | `SavedListToBasketSchema` → `.listToBasket` (Decision #520): the list's digital products go into one basket — an existing one (`null` = the owner's default) or a new named one (`BasketBackendService.createList`) — one `addItem` each, so the basket's own refusals apply; every service is answered in `skipped` with its page and the step it needs (a brief, a time, a seat or a project) → `{ basketId, added, skipped }`. 404 for a list not the caller's. |
| `/api/messages/[id]/pin`         | `POST` · `DELETE` | Pin / unpin a message for everyone in its room (a conversation's or a project room's) → `MessagingBackendService.setPinned` → `comms.message_pins` → `{ pinned }`. 404 for a message the caller cannot read. |
| `/api/messages/[id]`             | `PATCH` · `DELETE` | The author edits a message (`{ text, delta }`, within the room's edit window) or deletes it for everyone (PROJECTS CH1, Decision #562). The body names the chat as its send does: `{ conversationId }` or `{ projectId, channelId }` (`messageChatRef`) → `MessagingBackendService.editMessage` / `deleteMessage` → `comms.edit_message` / `comms.delete_message` → `{ change }`. 404 for a message the caller cannot read · 403 not its author · 409 past the window, deleted, a quote card or a frozen room · 422 an empty or malformed edit. |

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
| `/api/workspace/invite`              | `POST`                | `org.invite_workspace_member` (by handle **or** email). With `recipients` (Decision #318): up to ten `{ type: handle\|email, value, roleId }` + one `note` → `WorkspaceBackendService.inviteMany`, one call per recipient in order; `201` `{ detail, sent, refused: [{ address, message, code }] }` (`code` `duplicate` · `plan` · `forbidden` · `not_found` · `invalid`), the first refusal's status only when nothing was sent |
| `/api/workspace/invite-link`         | `POST` `{ kind, workspaceId, action: ensure\|reset\|role\|revoke, roleId? }` | `org.get_workspace_invite_link` (`ensure` mints at `roleId` or the Member preset; `role` re-points; `reset` rotates) · `org.revoke_workspace_invite_link` → `{ link }` (`null` after revoke). The read rides `WorkspaceDetail.inviteLink`. Decision #318 |
| `/api/workspace/invite-links/redeem` | `POST` `{ token, message }` → `201` | `org.redeem_workspace_invite_link` — the holder asks; a pending join request, never a seat. A refused state keeps its status with `details.reason` the state: `409` `member` · `invited` · `requested`, `422` `revoked` · `archived` · `persona`; `404` unknown token; `403 payout_not_ready` (a team). Decision #318 |
| `/api/workspace/join-request`        | `POST`                | `{ kind, workspaceId, requestId, accept, roleId? }` → `org.respond_to_join_request` (an `invite_members` holder; approving seats them, one seat added — a full team is `409`) → the re-read detail · `{ requestId, action: "withdraw" }` → `org.withdraw_join_request` (the requester). Anyone else `404`. Decision #318 |
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
| `/api/workspace/channels`            | `POST`                | `comms.create_entity_channel` (Decision #306) — any active member; answers the re-read detail |
| `/api/workspace/channels/archive`    | `POST`                | `comms.archive_entity_channel` — the creator or a `manage_settings` holder; never the default |
| `/api/workspace/channels/update`     | `POST`                | `comms.update_entity_channel` (Decision #308) — display name, topic and emoji; the slug never changes; the creator or a `manage_settings` holder |
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
| `/api/messaging/conversations/[id]/mute`     | `POST` `{ muted }`  | `MessagingBackendService.setMuted` → `comms.set_dm_muted` (the caller's own `is_muted`; Decision #308) — live only: 503 on fixtures, 404 for a conversation with no thread |
| `/api/messaging/conversations/[id]/read`     | `POST` (no body) | `MessagingBackendService.markRead` → `comms.mark_dm_read` (the caller's own `last_read_at`; CAS M10, PRD-C11). The chat island sends it once the thread has painted in a visible tab, never the page's GET. Idempotent `204` (no body, `no-store`); `404` for a conversation the caller is not in or a malformed id; `401` signed out; a cross-site post is refused `403` by the `/api` origin guard. The fixture backend answers `204` and keeps its own unread flags |
| `/api/messaging/conversations/[id]/context`  | `GET`  | `MessagingBackendService.context` → `projects.get_engagement_context` (the context panel) |
| `/api/messaging/attachment-source`           | `GET` · `HEAD` (`?assetId=<uuid>&conversationId=`) | `MessagingBackendService.attachmentSource` → `live-attachment-source.ts` — the messages a `files.items` asset was posted in that the caller can read (RLS `view_attachments_if_member`), newest first, each with its `?m=` link (a DM's by its thread's `cht-` ref); `conversationId` (a `cht-` ref or `dm-{handle}`, or a project room's uuid) narrows it. `400` with no `assetId`; a guest or a failure gets `[]`; ETag via the read-endpoint factory (Decision #162) |
| `/api/messaging/conversation`                | `GET` · `HEAD` (`?id=`) | `MessagingBackendService.conversation` — one conversation's metadata (the header and the Members tab); 404 for one the viewer cannot see |
| `/api/messaging/conversations/[id]/photo`    | `POST` `{ photo: { sourceAssetId, crop? } \| null }` | `MessagingBackendService.setGroupPhoto` — set or clear a GROUP conversation's photo (a square rendition cut from the caller's own asset) |
| `/api/messaging/conversations/members`       | `POST` | `MessagingBackendService.addMembers` (`AddConversationMembersSchema`) — a DM becomes a group the moment a third person is added |
| `/api/messaging/messages`                    | `GET` · `HEAD` (`?conversationId=&before=&limit=`) | `MessagingBackendService.messages` — a bottom-anchored page of a conversation's messages; `before` is the scroll-up cursor |
| `/api/messaging/messages/send`               | `POST` | The ONE send door, `MessagingBackendService.sendMessage(actor, ChatRef, input)` (Decision #339 ruling N1; CAS M3): `SendConversationMessageSchema` names the conversation (`cht-…`, or a `dm-{handle}` whose first message creates the pair's thread) as a thread `ChatRef` → `comms.dm_messages`. Answers `{ message, ref }` — the conversation's `cht-` ref. 404 for an address the caller cannot reach (a uuid, a thread they are not in); 30 messages a minute per sender, a 429 with `details.retryAt` beyond (CAS M23). The `ChatComposer`'s conversation-scope endpoint |
| `/api/projects/messages/read`                | `POST` | `{ projectId, channelId }` (`MarkChatReadInputSchema`, the send's own pair) → `projectChatRef` → `MessagingBackendService.markChatRead`: a room moves the caller's own mark (`comms.mark_room_read`, PRD-E13), a `cht-` channel the thread's watermark (`comms.mark_dm_read`), which clears the inbox's dot too. 204; 404 for a room or thread the caller cannot read. Sent by the project chat island once the page has painted in a visible tab (PROJECTS CH3; PRD-C11). |
| `/api/projects/messages/dm`                  | `POST` · `DELETE` | Decision #560. `POST { projectId, handle }` → `MessagingBackendService.bringDmIntoProject` → `comms.bring_dm_into_project`: opens the pair's DM (found or opened) inside the project, bringing it in when it is not there and telling the other person once; answers `{ ref, moved }`. `DELETE { projectId, conversationId }` → `takeDmOutOfProject` → `comms.take_dm_out_of_project`: out of the group for both people, stamps kept; answers `{ moved }`. 409 when the other is not on the project, 404 for a project or person the caller cannot see, 503 `not_live` on the fixture backend. |
| `/api/projects/messages/send`                | `POST` | The same door: `SendProjectMessageSchema` `{ projectId, channelId, … }` → `projectChatRef` — a room `ChatRef` → `comms.project_messages`, or, for a `cht-` channel, the thread seen through the project, stamped with it (`dm_messages.project_id`). The same 404s, rate limit and 429. The `ChatComposer`'s project-scope endpoint |
| `/api/messaging/files`                       | `GET` · `HEAD` | `MessagingBackendService.files` — the conversation-scoped File Explorer read (`FileListParamsSchema`) |
| `/api/messaging/members`                     | `GET` · `HEAD` | `MessagingBackendService.members` — the conversation roster, the same `MemberRosterPage` contract as `/api/projects/members` |
| `/api/messaging/contacts`                    | `GET` · `HEAD` (`?role=&q=`) | `MessagingBackendService.contacts` — the New Conversation / Add Members picker's contacts |
| `/api/messaging/suggestions`                 | `GET` · `HEAD` (`?q=&exclude=…&limit=`) | `MessagingBackendService.suggestions` (`ContactSuggestionParamsSchema`) — the ranked people picker behind New message · New group · Add members · Share with |
| `/api/messaging/settings`                    | `GET` · `HEAD` (`?role=`) · `POST` | `MessagingBackendService.settings` / `.saveSettings` (`MessagingSettingsSchema`, 422 with field errors) — auto-responses and notification preferences for the acting view |
| `/api/projects/hire`                         | `POST` | `ProjectBackendService.hire` → `projects.invite_to_project`, then the intro via `comms.send_request_message`; a cooldown refusal is 422 with `details.reopensAt`, the rate limit 429 with `details.retryAt` |
| `/api/projects/apply`                        | `POST` `{ projectId, stageId, roleId, message, teamId }` → 201 | `ProjectBackendService.apply` — the proposal allowance's pre-flight gate first (a refusal is 422 with `errors.allowance` + `details.blockReason`, and `entitlement.denied` recorded through `finance.record_proposal_denial`; Decision #154), then `projects.apply_to_project`, then the cover note via `comms.send_request_message` |
| `/api/projects/applications/withdraw`        | `POST` `{ applicationId }` | `ProjectBackendService.withdrawApplication` → `projects.withdraw_application`; the status flip refunds one weekly proposal unit (Decision #154) |
| `/api/projects/applications/mine`            | `GET` (`?project=<slug>`, `?team=<team id>`) | `ProjectBackendService.sentApplications` → `projects.list_my_applications` — the viewer's sent proposals (and their teams'), newest first; `team` narrows to the applications filed for that team (the team console's Proposals view, Teams C5) and never widens the viewer's list; `no-store` |
| `/api/projects/workload`                     | `GET` | `ProjectWorkloadService.mine` → `projects.get_my_workload_capacity()` — the caller's own Σ $W_i$, cap, held-ticket count and per-stage split (`WorkloadCapacity`), for the `/projects` gauge and the line beside Claim (Decision #550). Takes no parameters: there is no way to name another user. `401` signed out; `no-store` |
| `/api/projects/invites/email`                | `POST` `{ token, accept }` (`AnswerEmailInvitationSchema`) | `EmailInvitationService.answer` → `projects.answer_email_invitation` (PROJECTS NO1, Decision #566): the addressee of an email invitation answers by its link; 401 signed out, 422 a malformed token, 403 anyone without the invited address verified, 404 an unknown token, the payout and trust-consent refusals as `/respond` |
| `/api/projects/invites/respond`              | `POST` `{ invitationIds, accept }` | `ProjectBackendService.respondToInvitations` → `projects.respond_to_project_invitation`, once per invitation of the request |
| `/api/projects/applications/accept`          | `POST` `{ applicationId }` | `ProjectBackendService.acceptApplication` → `projects.assign_from_application`; answers `fundHref` |
| `/api/projects/[id]/stages`                  | `POST` `{ name, description?, createCategory?, unitPriceCents? }` (`CreateStageInputSchema`) → 201 `{ stage }` | `ProjectBackendService.createStage` → `projects.create_stage` (the rate as `p_unit_price_cents`, the CREATE category in `p_payload`) — the Create stage popover on the board and timeline rigs, a board column's menu and the lane's Discussion ＋ (Decision #416); answers the stage as the board projects it, `403` off review authority |
| `/api/projects/[id]/stages/[stageId]`        | `DELETE` (`DeleteStageSchema`: `[stageId]` is the `stg-…` slug only, a uuid is `422`) → `{ stageId }` | `ProjectBackendService.deleteStage` → `projects.delete_stage`: the setup form's Remove on a saved stage. A stage nobody claimed, funded or submitted against is deleted; any other is refused `409` `stage_has_history` before anything moves, and Remove explains why (PROJECTS ST2, Decision #553; PM-WP4b turns the refusal into an archive). The setup DTO's per-stage `removable` is `projects.stage_removability` |
| `/api/projects/[id]/stages/[stageId]/invite-link` | `GET` · `POST` `{ action: ensure\|reset\|revoke }` | `InviteLinkService.stageLink` (reads the active link, never mints) · `InviteLinkService.act` → `projects.get_stage_invite_link` / `projects.revoke_stage_invite_link` (Decision #145) |
| `/api/projects/[id]/complete` | `GET` · `POST` `{ reason? }` | `ProjectBackendService.previewProjectComplete` → `projects.preview_project_complete` (what completing closes, or why it cannot: `ended` · `draft` · `sessions` · `dispute` · `sittings` · `settling` · `held`) · `.completeProject` → `projects.complete_project` — the client completes an engagement holding nothing: its open, unfunded tickets close as `cancelled`, its open stages close, it reads `completed` and its reviews open (EX1, Decision #546). `403` off review authority, `409` `settle_first` while escrow is held or reserved, `409` `dispute_open` under a live dispute. The lane and the Overview offer it only when the detail read's `viewerCanComplete` (`projects.can_complete_project`) is true |
| `/api/projects/[id]/reopen` | `POST` `{ reason? }` | `ProjectBackendService.reopenProject` → `projects.reopen_project` — the client reopens a completed engagement to extend it, `completed → active`, recorded in the status history (EX1, Decision #546). `403` off review authority, `409` for anything but a completed engagement |
| `/api/projects/invite-links/redeem`          | `POST` `{ token, message }` → 201 | `InviteLinkService.redeem` → `projects.redeem_invite_link`; a refused state keeps its status (409 duplicate, 422 turned off / closed / no profile) |
| `/api/projects/ticket/delete`                | `POST` `{ projectId, ticketId }` | `ProjectBackendService.deleteTicket` → `projects.delete_ticket` — the board's right-click Delete ticket (Decision #409). Refused `409 not_deletable` unless the ticket is pristine (`ticketDeletable`: never claimed, funded or submitted against — PRODUCT_SPEC §Deletion Protocol) and `403` off the client seat; the door re-checks `can_review_project` |
| `/api/projects/stages/assignment-mode`       | `POST` `{ projectId, stageId, mode: open_pull\|manual }` (`SetStageAssignmentModeSchema`) | `ProjectBackendService.setStageAssignmentMode` → `projects.set_stage_assignment_mode` — the stage inspector's Routing control (Decision #547). Review authority and `hire`; `round_robin` / `parallel_stream` are refused by the schema and, `0A000`, by the door; leaving Manual clears the stage's pins. `stageId` is the stage row's id, as the board DTO carries it (an action payload, not a route) |
| `/api/projects/ticket/assign`                | `POST` `{ projectId, ticketId, assigneeId }` (`AssignTicketSchema`) → `{ card }` | `ProjectBackendService.assignTicket` → `projects.assign_ticket_manual` — Assign to… on a Manual stage's Ready ticket (Decision #547). Pins a live-seat holder (`BoardStageRef.pinnable`); `409` off a Manual stage, to a non-seat-holder or over a cap; holds nothing. The pinned freelancer accepts through `/api/projects/ticket/claim` |
| `/api/projects/ticket/decline-pin`           | `POST` `{ projectId, ticketId }` (`DeclineTicketPinSchema`) → `{ card }` | `ProjectBackendService.declineTicketPin` → `projects.decline_ticket_pin` — the pinned freelancer's Decline assignment (Decision #547); `403` for anyone else; nothing moves but the pin; the client is told (`ticket.pin_declined`) |
| `/api/links/preview`                         | `POST` `{ urls }` (1–20) | `LinkPreviewBackendService.previews` — signed-in only, 30 per minute, `private, no-store` |

Every `/api/messaging/*` call names a conversation the way its route does: by its `cht-` ref, or by
a `dm-{handle}`; a uuid is a 404 on the live path (Decision #88). A conversation addressed as
`dm-{handle}` answers **303** to the pair's `/messages/cht-…` when their thread exists, and with no
thread yet resolves to a VIRTUAL conversation on the live path (an empty page, never a minted thread;
the first send creates it), so an invitation notification's `/messages/dm-{inviter}` link always
lands somewhere answerable.

### Operator dispute desk (Decision #212)

`/admin/disputes` (`routes/(dashboard)/admin/disputes.tsx` → `features/admin/routes/DisputeDeskScreen.tsx`)
is the platform operator's dispute queue. It lives under the reserved `admin` segment (`RESERVED_HANDLES`,
`org.fn_is_reserved_handle`), so no handle can shadow it and a bare `/admin` is a 404. **The queue read
is the gate:** `finance.list_disputes_for_review` refuses anyone but `security.is_admin()`
(`ops.admin_users`) and the controller turns that refusal — or no session, or no live database — into a
**404**, so a non-operator never learns the desk exists and never receives a ruling control. A case
is **never a URL**: it opens in a dialog over the queue and is read and ruled through the API by id
(Decision #88 — a uuid does not route, and disputes carry no opaque slug). PRODUCT_SPEC's party-facing
`/disputes` pages remain unbuilt; a party reads their case in the session sidebar, or a ticket's case in
its ticket view (`?tkv=`), where the case dialog is the ticket chain's `dispute` frame: it replaces the
ticket and keeps `?tkv=`, so the case itself has no address of its own (PROJECTS EX2). In development the
Dev Context Switcher's `operatorDesk` axis (`pj.dev.operator`) renders sample cases instead; it grants
nothing.

### Operator ledger page (FBP DB16)

`/admin/ledger` (`routes/(dashboard)/admin/ledger.tsx` → `features/admin/routes/LedgerHealthScreen.tsx`)
is the platform operator's read-only view of whether the books add up (Decision #337, ruling M2 (A)),
under the same reserved `admin` segment; a bare `/admin` stays a 404. It is a list of sections, each
one `LedgerHealthService` read: **Conservation** and **Wallet drift** (`finance.get_ledger_health()`)
**Escrow age** (`finance.read_escrow_age()`, MR7, Decision #473) and **Alerts**
(`ops.read_alert_deliveries()`, MR4, Decision #461). **Every read is the gate:** each
door refuses anyone but `security.is_admin()` (`ops.admin_users`), and the controller turns that
refusal, no session or no live database into a **404**, exactly as the dispute desk does. It renders
only once a read has answered (which proves the caller an operator); a section whose read failed
otherwise then says so in place, and with no answer at all the page is a 502. It has no query state and no
control; it reaches no `/api/*` route and moves no money. MR3, MR5 and MR8b add their sections here.

| Path | Method / body | Delegates to |
| :-- | :-- | :-- |
| `/api/finance/plans` (**Planned**, #252) | `GET · HEAD` | `PricingBackendService.catalogue` → `finance.get_public_plan_catalogue()` (a definer granted to `anon`, since both plan policies are `authenticated`-only today); adds the caller's `current` plan when signed in. Public cache for a guest, private otherwise |
| `/api/finance/subscriptions/checkout` (**Planned**, #252 (f)) | `POST` `{ planCode, cycle, subject }` | `SubscriptionBackendService.startCheckout` → a Stripe Billing Checkout URL; 402 `PK402` · 403 cannot bill this subject · 409 already on it |
| `/api/finance/disputes` | `GET` `?status=open\|awaiting_response\|under_review` (optional) | `DisputeBackendService.queue` → `finance.list_disputes_for_review` (operator only, else 403) |
| `/api/finance/disputes/[disputeId]` | `GET` | `DisputeBackendService.get` → `finance.get_dispute` (a party or an operator; 404 otherwise) |
| `/api/finance/disputes/[disputeId]/resolve` | `POST` `{ outcome, payeeShareBp, notes }` | `DisputeBackendService.resolve` → `finance.resolve_dispute` (operator only, else 403) |
| `/api/finance/disputes` | `POST` `{ ticketId, stageId, reason, statement, fileIds? }` | `DisputeBackendService.open` → `finance.open_ticket_dispute` (PROJECTS EX2): either side raises a dispute on a ticket's stage money, held or still clearing. 404 for anyone else; 409 when nothing there can be disputed now or a case stands. Behind the money switch. |
| `/api/finance/disputes/ticket/[ticketId]` | `GET` | `DisputeBackendService.ticketState` → `finance.ticket_dispute_state`: the live case on the ticket and whether the caller may raise one now, for the ticket view's dispute line. 404 for anyone who is neither side. |
| `/api/finance/disputes/[disputeId]/offers` | `POST` `{ payeeShareBp, note? }` | `DisputeBackendService.offer` → `finance.propose_dispute_offer`: a party's offer of the freelancer's share (0–10,000 bp) on a live ticket case. Behind the money switch. |
| `/api/finance/disputes/[disputeId]/offers/[offerId]/accept` | `POST` | `DisputeBackendService.accept` → `finance.accept_dispute_offer`: the other side accepts the standing offer and the case settles on it. Behind the money switch. |
| `/api/finance/disputes/[disputeId]/summary.pdf` | `GET` | `DisputeBackendService.summaryPdf` → `finance.get_dispute` + `finance.get_dispute_vault` (PROJECTS EX3): the case summary PDF (case, timeline, statements, offers, ruling, the Evidence Vault's hash) as a download, for a party or an operator; 404 (JSON) for anyone else. |
| `/api/finance/disputes/[disputeId]/vault` | `GET` | `DisputeBackendService.vault` → `finance.get_dispute_vault` (PROJECTS EX3): a ticket case's Evidence Vault as JSON — the manifest and its SHA-256 for a party, the raw snapshot with its `objectPrefix` for an operator (the desk's "Open the raw snapshot"); 404 otherwise. An operator's read finishes a file copy the raise left pending. |
| `/api/finance/tax-report` | `GET` `?year=YYYY` | The operator's seller tax-reporting export, `text/csv` (LEGAL LG6, Decision #527): `TaxReportingService.sellerTaxReport` → `finance.read_seller_tax_report`. **404** to anyone but an operator (no session, a member, the seller themself, whatever `year` they send: the door refuses before it reads the year); a year outside 2000–9998 is 400 for an operator. No page links it yet |
| `/api/finance/tax-documents` | `GET` · `POST` `{ fileId }` | The seller's tax documents (LEGAL LG6): `GET` → `finance.list_tax_documents` (their certificates and the clients they may show one to); `POST` → `finance.mark_tax_document` (mark a file they uploaded as their residence certificate, private; 404 not theirs, 400 still uploading) |
| `/api/finance/tax-documents/[fileId]/share` | `POST` `{ projectId \| null }` | `finance.share_tax_document`: show the certificate to that project's client and nobody else, replacing any earlier share; `null` makes it private again (404 not their document, 400 a project they cannot show it to) |

### Scheduling, sessions & booking API

Thin routes over three fat services: `ScheduleBackendService` (`@server/services/scheduling/`, the
calendar reads and the coordination writes), `SessionBackendService` (`@server/services/sessions/`, a
session engagement's seats, sittings and presence) and `BookingBackendService`
(`@server/services/booking/`, the slot grid and the Contact Me actions). Each route Zod-parses, resolves
WHO IS ASKING from the session (`readActor` / `viewerFromState`, never from the query string) and maps
the `ServiceResult` through its feature's envelope (`toSchedulingResponse`, `toBookingResponse`,
`toProjectsResponse`, `toCatalogueResponse`). The page controllers for `/calendar`, the two project
calendars, `/[handle]/availability` and both session-schedule leaves live in
`features/calendar/routes/` and resolve the same reads server-side, with no HTTP hop.

The `/api/scheduling/*` prefix deliberately mixes PUBLIC reads (a freelancer's availability, a
listing's schedule — the service projects per viewer, so a stranger gets counts and busy blocks,
never the roster, the room or the money) with signed-in reads and writes, so the sign-in guard is per
route rather than per folder. `ctx.state.isAuthenticated` is a presence check (Decision #14); RLS on
the caller's JWT is the real gate. The age gate (`refuseIfRestricted`, Decision #208) refuses every
booking and preset write for a 13–17-year-old.

| Route | Methods | Behaviour |
| :-- | :-- | :-- |
| `/api/scheduling/availability` | `GET` `?handle=&around=` | **Public.** Zod (`AvailabilityParamsSchema`, `422`). `.availability` — a `@handle`'s booking calendar (working hours, timezone, blackouts, privacy-masked bookable/busy blocks, public group sessions) over the window around `around` (a `YYYY-MM-DD`, else now; −14 / +90 days, `calendarWindow`), reported as `page.window`; reserved handles are refused. |
| `/api/scheduling/schedule` | `GET` `?entityId=` | **Public.** `.entitySchedule` — a session-format listing's recurring sessions (seat counts only to a stranger) and bookable 1:1 windows. |
| `/api/scheduling/calendar` | `GET` `?projectId=&channelId=&around=` | Signed in (401), Zod (`CalendarParamsSchema`, `422`). `.projectCalendar` — the engagement's (or, with `channelId`, one channel's) syncs, review milestones, deadlines and sessions; its meetings over the window around `around` (−180 / +365 days), reported as `page.window`. `canCreate` is `false`: no door keeps an engagement's entries (Decision #343, ruling C7 (a)). |
| `/api/scheduling/personal` | `GET` `?around=` | Signed in (401), Zod (`PersonalCalendarParamsSchema`, `422`). `.personalCalendar` — the `/calendar` hub's agenda over the window around `around` (a `YYYY-MM-DD`, else now; −60 / +180 days), reported as `page.window`. Takes NO scope parameter: "whose calendar" is answered by the session, never by the caller. |
| `/api/scheduling/events` | `POST` `CreateEntriesInputSchema` · `PATCH` `UpdateEntryInputSchema` · `DELETE` `?eventId=` | Signed in (401). A body's `room` sets the entry's room through `scheduling.set_entry_room` (Decision #383 (f)). `.createEntries` / `.updateEntry` / `.removeEntry` — the caller's OWN `/calendar` entries (Decision #328 (a)), written as the caller under the `Manage scheduling events` RLS policy, never the service role. A create may start in the past — the composer warns, it does not refuse (Decision #403); one that ends before it starts is a `422` (a daily series is one insert); edit and delete are the host's alone, past or not (`403` for an entry the caller can read but does not host, `404` for one they cannot read). Delete is soft: `status = 'cancelled'` plus `archived_at`. The agenda is stored only through `sanitizeRichText`. |
| `/api/scheduling/routines` | `POST` `CreateRoutineInputSchema` · `PATCH` `UpdateRoutineInputSchema` · `PUT` `OrganiseEntryInputSchema` | Signed in (401). `.createRoutine` · `.updateRoutine` (`isActive: false` archives; there is no `DELETE`) · `.organiseEntry` — an entry and its whole series into or out of a routine, or whether they hold their time, through `scheduling.organise_event`; the one write a connected calendar's entry takes (Decision #389). The personal page carries the list, so there is no `GET`. `409` for a commitment asked to go passive. |
| `/api/scheduling/reminders` | `PUT` `SetEntryRemindersInputSchema` | Signed in (401). `.setEntryReminders` — the caller's OWN alerts for an entry they hold, in any seat, written as the caller under `Own event reminders` (Decision #388); `reminders: null` returns them to their default. `403` for an entry they are not on, `404` for one that is gone, `409` for one whose alerts come from elsewhere. Returns the refreshed event. |
| `/api/scheduling/invites` | `POST` `InviteInputSchema` · `DELETE` `?eventId=&attendeeId=` | Signed in (401), Zod (`422`). `.invite` / `.withdrawInvitation` — a host's guest list for their own entry, accounts by `userIds` and guests by `emails`, through `scheduling.invite_to_event` and `scheduling.withdraw_invitation`, each answering with the entry re-read. `403` for an entry they do not host, `409` in the door's own words for one that can take no guest. |
| `/api/scheduling/clashes` | `GET` `?start=&end=&excludeEventId=` | Signed in (401), Zod (`422`). `.clashes` — what already holds the reader's own time across a span (`scheduling.fn_detect_event_clashes`), the event modal's debounced check. Takes no person: whose calendar is answered by the session. |
| `/api/scheduling/rsvp` | `POST` `RsvpInputSchema` | Signed in (401). `.respond` — the viewer's own answer to an event; returns the refreshed event. Who may answer and whether the event has passed are the service's. |
| `/api/scheduling/calls` | `POST` `CallActionInputSchema` | Signed in (401), age gate. `BookingBackendService.callAction` — one move on a discovery call (confirm, decline, propose a time, cancel, report a no-show); answers with the call as the calendar draws it, or `null` once it has left the calendar. Each door names who may make its move, and a refusal comes back as `errors.reason` (Decision #343, ruling C3). |
| `/api/scheduling/reschedule` | `POST` `RescheduleInputSchema` | Signed in (401). `.reschedule` — one move in an event's reschedule negotiation (propose, approve, open the vote, vote, confirm, withdraw). A refusal comes back as `errors.reason` (`RescheduleRefusalReason`). |
| `/api/scheduling/presets` | `GET` · `PUT` | Age gate, then session (401 on `PUT`). `.presets` — the acting owner's live availability presets, who follows each (a service with its `svc-` listing slug) and the `schedule` they share (zone, publishing, time off not yet ended) · `.savePreset` — write one, compile it for the booking gate and, for the default, mirror it into the weekly bands (a hard rule issue is a 422). |
| `/api/scheduling/presets/archive` | `POST` `{ id }` | Age gate, session (401), Zod. `.archivePreset` — archive, never delete; bound listings fall back to the default preset and come back as `data.rebound`. |
| `/api/scheduling/blackouts` | `POST` `BlackoutInputSchema` · `DELETE` `?id=` | Age gate, session (401), Zod (a uuid `id`, else 400). `.addBlackout` — whole days off, local midnight of `startsOn` to the midnight after `endsOn` in the schedule's zone, the label private unless `labelIsPublic` (→ `label_is_public`, default `false`; Decision #379) · `.removeBlackout` — another owner's row or a missing one is a 404. Both recompile the schedule's presets and answer its `ScheduleSettings`. (Decision #376) |
| `/api/scheduling/cron/horizon` | `POST` (`?limit=`) | The scheduler's door to `.extendHorizons` (job `scheduling-availability-horizon`, Decision #203): recompiles every live preset compiled short of today + 90 days over today → today + 120 days. Bearer `SCHEDULING_CRON_SECRET` (≥ 32 chars, constant-time); anything else **404**. |
| `/api/scheduling/cron/guest-mail` | `POST` (`?limit=`, at most 25) | The scheduler's door to `GuestBackendService.sendDue` (job `scheduling-guest-mail`, Decision #391): sends what is waiting for guests with no account. Bearer `SCHEDULING_CRON_SECRET`, otherwise `404`. |
| `/api/catalogue/availability` | `POST` | Age gate, seller actor, Zod. `ScheduleBackendService.bindListing` — bind a Session or Group Session listing to its schedule's default preset, a library preset, or its own fork of one. |
| `/api/catalogue/promotion` | `GET` `?id=` · `POST` `PromoteListingInputSchema` · `DELETE` `?id=` | Seller actor (`?team=` as elsewhere); `POST` signed in (401) then age gate (403), Zod (422); a missing `id` is 400. `CatalogueBackendService.promotion` / `.promote` / `.stopPromotion` → `marketplace.get_listing_promotion` / `promote_listing` / `stop_listing_promotion` (Decision #454): the listing's Promote control, the seller's one plan-allocated 7-day flight on `explore_home` or `explore_results` (402 without `promoted_placement`, 409 with a flight already live), and a stop. No URL state: the control lives in the workspace's panel. |
| `/api/sessions/[slug]` | `GET · HEAD · OPTIONS` | `SessionBackendService.workspace` — a session engagement's workspace for the viewer: cohorts with occupancy, sittings, the viewer's seat and funding, curriculum progress, and the join link (a URL only while the seat is funded and the join window is open). `workspace: null` for a non-session engagement or a viewer without access. |
| `/api/sessions/lessons/[lessonId]` | `POST` `{ done }` | `.completeLesson` — tick or un-tick a curriculum lesson; `projects.complete_lesson` holds the writer to a seat on a cohort that follows it. 404 on a malformed id, 422 on a bad body. |
| `/api/sessions/forfeits/[escrowId]/refund` | `POST` | `OrderBackendService.refundForfeit` → `finance.refund_session_forfeit` — the host gives a forfeited seat or sitting back in full (FBP DB21; ruling M8). Listed on the session sidebar from `finance.session_forfeits`. Behind the money switch. |
| `/api/sessions/memberships/[membershipId]/cancel` | `POST` | `.cancelMembership` → `projects.cancel_cohort_membership` — give up a seat: a full refund until the notice window before the cohort's first sitting, a full forfeit inside it (the provider's own cancel always refunds). The answer names which happened. |
| `/api/sessions/sittings/[eventId]/room` | `POST` `{ link }` | `.setRoomLink` — a link the host adds to a sitting with no room (Decision #383, rulings R2 and R7). Nothing reports attendance from it, so the sitting's payout holds for review, which the form says first. |
| `/api/sessions/sittings/[eventId]/review` | `POST` `{ happened }` | `.answerReview` — an attendee's answer on a sitting with no attendance record (Decision #383, ruling R6): a yes is evidence the sweep releases on, a no is a no-show claim. |
| `/api/sessions/sittings/[eventId]/no-show` | `POST` `{ reason? }` | `.claimNoShow` — an attendee's claim that the provider did not show: a `finance.disputes` row on the sitting's held escrow stops the auto-release, and an ended sitting's attendance is audited at once (Decision #212); `status` says refunded, dismissed or sent to the provider. |
| `/api/sessions/webhooks/[provider]` | `POST` (raw body) | The old presence path (Decision #171). It re-exports `/api/integrations/webhooks/[provider]`, so a delivery behaves identically on either, until the Zoom app's Event Subscription is re-pointed there: an ops step, after which this file goes. |
| `/api/integrations/webhooks/[provider]` | `POST` (raw body) | `IntegrationsBackendService.handleWebhook` — the one provider webhook (Decision #343, ruling C4 (a)): `zoom` (presence through `.handlePresenceWebhook`, `endpoint.url_validation`, `app_deauthorized`), and `google` and `outlook` (a calendar push marks its calendar due and the job does the reading; Graph's `validationToken` is echoed unsigned as `text/plain`, and a batch is judged per subscription). No session or cookie: the provider's HMAC over the raw bytes is the credential, or for a provider that signs nothing its channel's stored token. Each presence or removal effect claims `integrations.webhook_deliveries` in its own SQL call, so a replay is a 2xx no-op, and a replayed push only marks the same calendar due again. 2xx acknowledges, 400 a forged or stale delivery, 404 an unknown provider, 503 asks for redelivery. |
| `/api/integrations/callback` | `GET` `?state=&code=` | `.completeConnection` — where a provider sends the browser back. A 302 to the path stored at `start` (else `/settings`) with `?connect=connected\|failed`, a coarse marker and never a reason. The target is never read from this request. |
| `/api/integrations/cron/rooms` | `POST` `?limit=` · `?task=reconcile` | Bearer `INTEGRATIONS_CRON_SECRET`, else 404. `RoomBackendService.mintDue` + `.syncDue`, or `.reconcileDue`: the jobs `integrations-mint-rooms` and `integrations-presence-reconcile`. |
| `/api/integrations/cron/refresh` | `POST` (`?limit=`) | The scheduler's door to `.refreshDue` (job `integrations-refresh-tokens`, providers spec §7.6): refreshes every connection due and persists a rotated refresh token. Bearer `INTEGRATIONS_CRON_SECRET` (≥ 32 chars, constant-time); anything else **404**. |
| `/api/integrations/cron/channels` | `POST` (`?limit=`) | The scheduler's door to `.renewChannels` (job `integrations-renew-channels`, providers spec §7.6): renews every push channel within 24 h of lapsing. Bearer `INTEGRATIONS_CRON_SECRET` (≥ 32 chars, constant-time); anything else **404**. |
| `/api/integrations/cron/sync` | `POST` `?limit=` · `?task=outbound` | Bearer `INTEGRATIONS_CRON_SECRET`, else **404**. `CalendarSyncBackendService.syncDue` (job `integrations-calendar-sync`: busy time in), or with `?task=outbound` `.pushDue` (job `integrations-outbound-sync`: Projective events out, Decision #383, ruling R3). |
| `/api/integrations/sync-direction` | `POST` `SetSyncDirectionSchema` | `.setSyncDirection` — turns a connection's separate Projective calendar on (`bidirectional`) or off (`inbound`). Someone else's connection answers 404; turning it on with a grant that cannot write answers 409. |
| `/api/integrations/import` | `POST` `{ connectionId, externalFileId, folderId, ownerType?, ownerId? }` | `.importAsset` — mounts a connected drive object into a library as a REFERENCE (Decision #313, PROJECTS FL2): the caller's own storage connection, a library they hold (neither owner field = the acting library, the one `/files` shows a drive beside) and a native folder of it; the object's facts read from the provider; the row written by the service role, one per object per connection (again = the same row, filed where asked; one in another library 409). The hub's drive files carry it as "Add to Library". |
| `/api/integrations/s3/open` | `POST` | `.startS3Connection` — the S3 credential form's first door (Decision #314, PROJECTS FL2): `integrations.fn_open_s3_connection` opens the caller's row `pending` under their JWT, or answers the one already open, with its ExternalId (`projective-{id}`) and `S3_PLATFORM_ACCOUNT_ID` for the role's trust policy. 409 while the catalogue switches S3 off; 503 while `INTEGRATIONS_BACKEND_LIVE` is off. |
| `/api/integrations/s3/save` | `POST` `SaveS3ConnectionSchema` | `.saveS3Connection` — finishes the caller's own pending S3 row: lists the bucket once with what was typed (refused in words, 422, storing nothing), seals an S3-compatible key pair, and stores the row as the service role (`fn_store_s3_connection`). 409 for a row already set up or a bucket and prefix already connected. |
| `/api/services/slots` | `GET` `?subjectId=&purpose=&timezone=&from=&days=&callType=` | **Public.** `SlotQuerySchema` → `BookingBackendService.slots` — the bookable slot grid behind the date rail and slot picker. Slot length, block size and seat cap are resolved server-side, never taken from the query; the grid says only free or spoken for. |
| `/api/services/call-offer` | `GET` `?handle=` | **Public, side-effect free.** `.callOffer` — a provider's published call offer (`PublicCallOffer`: flavours, durations, fee, agenda rule, conferencing platforms), never caps, cooldowns or buffers. |
| `/api/services/contact-action` | `POST` `ContactActionInputSchema` | Age gate. `.contact` — the three Contact Me actions on one discriminated union (`kind`): book a discovery call, ask a question, request a custom quote (through `marketplace.request_quote`, one open request per listing). The service refuses a guest. None creates a project, stage, ticket or escrow. |
| `/api/services/quotes` | `GET` `?with=@handle` · `POST` `IssueQuoteInputSchema` | `GET`: `QuoteBackendService.listWith` — every quote request between the caller and that person, in either role, each with its current offer (and its terms hash), its history, the buyer's answers and the acts the caller may take (`QuoteListSchema`, Decisions #458, #522). Read by the conversation context panel (`/messages/dm-…`) and the catalogue client drawer (`/catalogue?view=clients&client=@…`), which are also where the quote notices link. `POST` (age gate): `QuoteBackendService.issue` → `marketplace.issue_quote` — a seller's own quote `{action: "issue", buyer, listing (svc- slug), scope, deliverables, priceMinor, turnaroundDays, expiresInDays}` for a buyer who has written to them (422 `no_conversation` otherwise; 403 `not_your_listing`; 422 `group_session`), answered `201` with the request it stands on (Decision #522). |
| `/api/services/quotes/cards` | `GET` `?events=<uuid>,…` (1–100) | `QuoteBackendService.cards` → `marketplace.get_quote_cards` — the quote cards a conversation renders: each move, the terms and hash as they stood, where that offer stands now and the acts the viewer may take (`QuoteCardListSchema`, Decision #522). Ids the caller is not a party to are left out. Batched by `quote-cards-state.ts`. |
| `/api/services/quotes/listings` | `GET` | `QuoteBackendService.quotableListings` — the caller's own published services other than group sessions: what the quote composer may price (`QuotableListingListSchema`, Decision #522). |
| `/api/services/quotes/[id]` | `POST` `QuoteActInputSchema` | Age gate. `QuoteBackendService.act` — one act on one request through its door (send / revise / withdraw an offer, decline the request; accept / decline the offer, withdraw the request), answered with the request as it now stands. An accept charges nothing: it returns the basket holding the offer's one line, and the surface goes to `/checkout?basket=` (`basketHref`). 404 on a malformed id. |
| `/api/services/book-session` | `POST` | Age gate. `.bookSession` — reserve the chosen slot(s) and stage the booking for checkout. The service refuses a guest and re-resolves every slot through the reader that drew the grid. A cohort holds seats instead (`reserveSeat`), whatever slot id it is sent — the seat panel sends the cohort's first sitting — and its `note` and `answers` ride the seat line as a 1-on-1's do (Decision #453). The listing page's dialog and the profile's Hire modal both post here. |
| `/api/services/reserve-seat` | `POST` `ReserveSeatInputSchema` | Age gate. `.reserveSeat` — hold seats on a group-session listing's current cohort (`projects.reserve_seat`, Decision #171) and put the seat line in the caller's basket. The listing's intake is held to `intakeRefusal` before any seat is held (422 `answers.<id>`), and `note` and `answers` ride the line (`metadata.note`, `metadata.answers`) onto the order line (Decision #453). An optional `cohortId` picks a later chain of a rolling listing (SC11); one the listing's offer does not list is refused 409. A guest is refused (401). |
| `/api/services/seats` | `POST` `SeatLinkActionSchema` | Age gate. A buyer's seat link (Decision #522): `{action: "share", membershipId}` → `projects.share_cohort_seats` (`{code, seatsLeft}`), `{action: "revoke", membershipId}` → `projects.revoke_cohort_seat_link`, `{action: "claim", code}` → `projects.claim_cohort_seat` (`201`, `{projectSlug}`). Refusals are the door's `Seat refused: <code>` as a sentence (404 `not_found`, 409 `started` · `revoked` · `ended` · `seated` · `full`, 422 `own` · `nothing_to_share`). The lane reads the buyer's seats on `ServiceBookingOffer.seat`. |
| `/api/services/waitlist` | `POST` `JoinWaitlistInputSchema` | Age gate. `.joinWaitlist` → `projects.join_waitlist` — queue the caller on a group-session listing's waitlist (Decisions #424, #455); no client writes a place directly. Idempotent: a repeat answers `already: true` with the place's status; an expired place joins again at the back (`already: false`). A guest is refused (401); a listing that is not a group session 422s, and so does the seller's own. The queue is invited first in, first out by the `cohort-waitlist-invites` job: an in-app notice links to the listing, whose offer then carries the viewer's place (`ServiceBookingOffer.waitlist`) and a **Reserve your held seat** primary. |
| `/api/catalogue/cohorts` | `GET` `?listing=` · `POST` `OpenCohortInputSchema` · `PUT` `SaveGroupScheduleInputSchema` | Seller actor (`?team=` as elsewhere). `GET` (the shared read query, `listing` required): `CatalogueCohortsBackendService.cohorts` → `projects.get_listing_cohorts` — a group-session listing's cohorts for the Availability section's `CohortsBlock` (Decision #498): the opening form's facts (session count and length, cohort size) and each cohort's terms, paid and held seats, sittings, `phase`, `underFilled`, `canCancel`; 404 for a listing the caller does not manage, 422 for one that is not a group session; `sim` is the `clientPipeline` dev axis, fixture path only. `POST`: signed in (401), age gate (403), Zod (422) → `.open` → `projects.open_cohort` — the listing's next cohort with its sittings on the seller's calendar; 422 for terms the database refuses, 409 while another cohort is taking bookings or a sitting clashes; answers the cohorts as they now stand (201). `PUT` (SC11): signed in (401), age gate (403), Zod (422) → `.saveSchedule` → `projects.save_group_schedule` — Fixed cohorts or Rolling weekly, with one weekday and start minute per sitting; a rolling save opens the chains in the horizon at once; 422 for a week the database refuses; answers the cohorts as they now stand. `GET` also takes `schedule` (`fixed_cohorts` · `rolling_templates`), the `groupSchedule` dev axis, fixture path only. |
| `/api/catalogue/promotions` | `GET` · `POST` `SavePromoCodeSchema` | Seller actor (`?team=` as elsewhere). `GET`: `CataloguePromotionsBackendService.list` → `finance.list_own_promo_codes` — the acting seller's promo codes, live then archived, and the product listings a code may cover (slugs), for the console's Promotions view (`?view=promotions`; Decision #485). `POST`: signed in (401), age gate (403), Zod (422), the promo throttle (429 with `Retry-After`, because a "taken" answer says a code exists), then `.create` → `finance.save_promo_code`: 201, 403 not this seller's issuer, 422 a refused term or a listing that is not the seller's, 409 `promo_code_taken` (MARKETPLACE CK2, #536). |
| `/api/catalogue/promotions/archive` | `POST` `ArchivePromoCodeSchema` | Seller actor (`?team=` as elsewhere). `CataloguePromotionsBackendService.archive` → `finance.archive_promo_code`: the code stops applying and stays listed; idempotent; 404 for a code that is not the seller's (CK2, #536). |
| `/api/catalogue/cohorts/[cohortId]/cancel` | `POST` `{ listing }` | Seller actor, signed in (401), age gate (403), Zod (422) → `CatalogueCohortsBackendService.cancel` → `projects.cancel_cohort` — the seller cancels a cohort before its first sitting: every seat refunded in full, the waitlist kept in order, seat-holders and the queue told (Decision #498). 403 for a caller who does not manage the listing, 422 for a 1-1 booking's cohort, 409 once it has started or ended. Answers `{ cancellation, cohorts }`. |
| `/api/catalogue/sale-requests` | `POST` `RequestSaleInputSchema` | Signed in → `SaleRequestBackendService.request` → `catalogue.request_sale`: the maker asks to sell an asset made on a released stage (MARKETPLACE SC7). |
| `/api/catalogue/sale-requests/[requestId]/decide` | `POST` `DecideSaleRequestInputSchema` | Signed in → `SaleRequestBackendService.decide` → `catalogue.decide_sale_request`: the client grants some or all files, or declines; ⚖️ a grant answers 409 until grants are switched on. |
| `/api/catalogue/sale-requests/[requestId]/withdraw` | `POST` | Signed in → `SaleRequestBackendService.withdraw` → `catalogue.withdraw_sale_request`. |
| `/api/catalogue/waitlist` | `GET` `?listing=` | Seller actor (`?team=` as elsewhere), the shared read query (`listing` required). `CatalogueClientsBackendService.waitlist` → `projects.get_listing_waitlist` — a group-session listing's queue for the workspace's Clients tab (Decision #455): counts per state and the places in order, dressed from the profile directory. 404 for a listing the caller does not manage, 422 for one that is not a group session. `sim` is the `clientPipeline` dev axis, fixture path only. |
| `/api/checkout/orders/[entitlement]/cancel` | `POST` | `OrderBackendService.cancelLine` → `finance.cancel_order_line` — cancel a digital product while its sale clears (FBP DB21). The purchase is named by its entitlement's opaque slug (`ent-…`, Decision #88); the history offers it only where the door would accept it (`finance.cancellable_order_lines`). Behind the money switch. |
| `/api/checkout/orders/[entitlement]/problem` | `POST` `{reason, statement, fileIds?}` | `DisputeBackendService.reportOrderProblem` → `finance.open_order_line_dispute` — report a downloaded digital product as not delivered or faulty while its sale clears (FBP DB21). The history offers it only where the door would accept it (`finance.order_line_disputes`). Behind the money switch. |
| `/api/checkout/calendar` | `GET` `?order=&line=` | `OrderBackendService.ics` — the `.ics` FILE for one booked line of one order (not the JSON envelope; reached from a plain anchor). Scoped to the acting account; 400 on a missing id, plain-text 404 otherwise. `nosniff`, filename in `content-disposition`. |

### Reviews API (Decision #487)

Thin routes over `ReviewsBackendService` (`@server/services/reviews/`) and the doors in `00001670`;
every body is a `@projective/types/reviews` schema, every refusal the database's own sentence with the
status its SQLSTATE maps to (PT404 → 404, PT403 / PM403 / 42501 → 403, PT409 → 409, PT410 → 410,
PT422 / 22023 → 422, PT501 → 501, PT428 → 428).

| Route | Methods & body | What it does |
| :-- | :-- | :-- |
| `/api/reviews` | `POST` `SubmitReviewInputSchema` | Signed in (401), age gate (403), Zod (422) → `.submit` → `reviews.submit_review` — the caller's review of a target on an anchor they completed; 201 with its id. |
| `/api/reviews/[id]` | `PATCH` `EditReviewInputSchema` | Signed in, age gate, Zod → `.edit` → `reviews.edit_review` — the author's edit while the window is open and before the reply. A path that is not a uuid is 404. |
| `/api/reviews/[id]/withdraw` | `POST` | Signed in → `.withdraw` → `reviews.withdraw_review` — the author withdraws it (kept, hidden). |
| `/api/reviews/[id]/reply` | `POST` · `PATCH` `ReviewReplyInputSchema` | Signed in, Zod → `.reply` / `.editReply` → `reviews.reply_to_review` / `reviews.edit_reply` — the reviewed side's one reply, editable for 7 days. |
| `/api/reviews/client-trust` | `GET ?project=prj-…` · `POST` `ClientTrustQuerySchema` | Signed in (401), Zod (422) → `.clientTrustWarning` / `.acknowledgeClientTrust` → `reviews.get_client_trust_warning` / `reviews.acknowledge_client_trust` — whether the project's client is warned (Client Trust Score below 3.00 from 3 reviews) and the caller's Informed Consent, logged once per project (Decision #486 (C)). The proposal, invite-link and hire doors answer 428 (`errors.<field> = "client_trust_consent"`) until it is logged. |

The reads are server-side, never an API: the Overview reads `reviews.get_reviewables`, and `/view/:slug`,
`/:handle/view/:id` and `/:handle/reviews` join `reviews.get_review_actions` onto their review lists per
request (the page itself is the shared anonymous read), so Reply, Edit reply and Edit review render only
for whoever may use them. An operator's `reviews.hide_review` has no route yet (T&S R2's report flow).

## A GET writes nothing (PRD-C11)

A page or a `GET` endpoint is fetched by more than the person reading it: a prefetch, a link
unfurler or mail scanner, a retry, and a cross-site top-level navigation, which carries the
`SameSite=Lax` session cookie. So a `GET` never changes what the person will see. A write the person
causes is their `POST`, behind the origin guard (`utils/csrf.ts`). Page routes, `features/*/routes`
screens and the loaders they reach on every render are pinned by `apps/web/utils/get-side-effects.test.ts`.

**Moved behind a POST.**

| Was                                                    | Now                                                                                                                                                  |
| :----------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| A project room's read mark (none existed; PRD-E13)     | The project chat island's `POST /api/projects/messages/read`, once the room or project DM has painted in a visible tab (PROJECTS CH3) |
| `/messages/:id` rendering → `comms.mark_dm_read`       | The chat island's `POST /api/messaging/conversations/[id]/read`, once the thread has painted in a visible tab (SAC3)                                   |
| `GET /api/user/emails/verify` → `org.confirm_user_email` | The `GET` forwards the token to `/settings/account?email-token=…`; the person's Confirm sends `POST /api/user/emails/verify` (SAC3)                   |
| `GET /api/auth/confirm` → GoTrue `verifyOtp`           | `POST /api/auth/confirm` from `/verify/confirm` (#445)                                                                                               |

**Accepted GET telemetry.** These record that a request happened. Nothing the person acts on reads them back as state:

- **Search query log.** `/explore?q=…` and the first page of `GET /api/explore/search` →
  `search.fn_log_query` → `search.query_logs`.
- **Views.** `/[handle]`, `/[handle]/view/[item]` and `/view/[entity]` → `recordViewInBackground`
  (signed in only, fire-and-forget) → `search.record_view` (`org.recent_views` count,
  `search.user_affinity`). The affinity also orders the viewer's own "Because you viewed" rail.
- **Server errors.** A `5xx` rendered by `routes/_error.tsx` → `LogBackendService.recordServerError`
  → `ops.log_entries`.

**Accepted GET doors.** These are not telemetry, but nothing in the request decides what they write:

- **OAuth callbacks** (`/api/auth/callback`, `/api/integrations/callback`). The provider returns by
  `GET` and they spend a single-use code or state bound to the browser that started the flow.
- **Stripe Connect return** (`GET /api/finance/connect/return`, and `GET /api/finance/connect/status`
  with `?sync=1`). Stripe returns by `GET`. `finance.sync_payout_account` copies Stripe's own account
  state (`payout_ready`, KYB), never a value from the request.
- **Connected-drive reads** (`/files/drive/…`, `GET /api/files/{list,tree,drive-thumbnail}`,
  `GET /api/integrations/browse`). `integrations.fn_claim_connection_token` stamps `last_used_at`
  and refreshes an expiring provider token. This is operational bookkeeping.
- **Lazy materialisation.** These insert the row the read would compute anyway, idempotently. The
  week's proposal-allowance row (`finance.fn_current_allowance`) is written through
  `org.get_workspace_detail` on every `/teams/*` and `/catalogue*` render, and through
  `GET /api/user/allowance`. The default notification-preferences row is written by
  `/settings/notifications`, `GET /api/user/notifications` and `GET /api/settings/notifications`.
- **Meeting join** (`/meet/[roomSlug]`, by ruling). An open room `303`s to the person's own provider
  link and records their join (`scheduling.room_join`: a `join_click` presence event and a provider
  registrant), so a calendar or email entry joins in one press (#383). A cross-site navigation can
  stamp a party's own attendance; the owner kept the GET join anyway (#478 (a), PRD-C30 ⏸).

**Open exceptions, tracked.**

- **FX quotes locked on `GET`.** The checkout pages and `GET /api/checkout/session` reuse a live
  quote. `GET /api/finance/escrow/quote` and the paid-revision quote lock a fresh `escrow_lock` row
  on every request (PRD-C31).
- **`/api/integrations/callback`** spends the consent `state` before it compares the caller, so a
  cross-site `GET` carrying someone else's state burns it (PRD-C32).

## Thin controllers / fat services

Routes only parse + validate + guard, then delegate. The handler → service → `page(data)` pattern is
shown in `projects/[projectSlug]/index.tsx`. Islands never fetch — data is hydrated via props
(SYSTEM_ARCHITECTURE §State Hydration).

## Feature folders & islands

Route controllers may grow into `apps/web/features/[group]/[sub]/` (per PRODUCT_SPEC §Directory
Structure); `routes/` then re-exports them. Islands live in a `features/**/islands/` folder and are
auto-discovered by `vite.config.ts` (`discoverFeatureIslands` → `islandSpecifiers`). Example:
`features/projects/islands/WorkloadGauge.island.tsx`. Path aliases: `@web/*`, `@features/*`,
`@ui/*`, `@projective/ui`, `@server/services/*` — never `../../../` across boundaries.

## Aliases in use

`@web/` → `apps/web/` (routes import `@web/utils/state.ts`, `@web/components/…`). Declared in the
root `deno.json` import map alongside `@features/`, `@ui/`, `@server/services/`.
