> Full rows of Resolved Decisions #31–#43 (former root CLAUDE.md §8), verbatim.

| #  | Decision (2026-07-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Applied in                                                                                                                                                                                                                                                                                    |
| :- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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
