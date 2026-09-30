> Full rows of Resolved Decisions #44–#56 (former root CLAUDE.md §8), verbatim.

| #  | Decision (2026-07-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Applied in                                                                                                                                                                                                                                                                                    |
| :- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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
