# Project Management & Execution — Completeness Audit (2026-10-29)

> Read-only evaluation of the project-management and execution domain: the three project types
> (Task · One-off · Pipeline), stages, tickets, the claim protocol, Workload Intensity ($W_i$), the
> Chain Reaction, Fair Exit and the Submissions explorer. It covers `projects.*` (migrations and
> `database/projects/`), `@projective/types/projects`, `packages/backend/services/projects/`,
> `apps/web/features/projects/` and the `(dashboard)/projects` routes, measured against
> `PRODUCT_SPEC.md`, `PRODUCT_MANAGEMENT.md`, `SYSTEM_ARCHITECTURE.md`, `ROUTING.md`,
> `DESIGN_SYSTEM.md`, `flows/Projects.md` and the decision log through #334. **No code was changed.**
> The rulings this audit needs, and the new contradictions it found, are in
> [`PROJECT_MANAGEMENT_DECISION_LOG.md`](PROJECT_MANAGEMENT_DECISION_LOG.md), recorded as
> **Decision #338** (#335–#337 are held by the parallel providers, identity and finance audits).
>
> Abbreviations: **T15** = `supabase/migrations/00000015_tables_projects.sql` · **F1100** =
> `…/00001100_functions_projects_read_access.sql` · **F1110** = `…/00001110_…_ticket_guards.sql` ·
> **F1120** = `…/00001120_…_ticket_lifecycle.sql` · **F1130** = `…/00001130_…_stages.sql` ·
> **F1140** = `…/00001140_…_automation_workload.sql` · **F1150** =
> `…/00001150_…_stage_funding_submissions.sql` · **F1200** = `…/00001200_functions_finance_core.sql`
> · **TR1850** = `…/00001850_triggers_projects_tickets.sql` · **P2011** =
> `…/00002011_policies_projects.sql` · **G2510** = `…/00002510_permissions_function_grants.sql` ·
> **J5060** = `…/00005060_seed_scheduled_jobs.sql` · **PBS** =
> `packages/backend/services/projects/ProjectBackendService.ts` · **LW** = `…/projects/live-writes.ts`
> · **svc/** = `packages/backend/services/projects/` · **types/** = `packages/types/projects/` ·
> **F/** = `apps/web/features/projects/` · **R/** = `apps/web/routes/(dashboard)/projects/` · **PS** =
> `PRODUCT_SPEC.md` · **PM** = `PRODUCT_MANAGEMENT.md` · **DL** = the decision log above.
>
> Evidence: every finding was read from source. A finding marked **(I)** is inferred from reading
> and was not executed against a database; §7 lists the probe that settles each one.

> **Fixed since the audit (2026-10-29, the ruling-free P0s).** X3: `claim_ticket` asks for a live
> seat on the ticket's stage, and `fn_assign_ticket_core` hands out only open work (New or Ready).
> X12: a direct statement may no longer name or swap a ticket's assignee. X9: `trg_stage_price_lock`
> and `trg_project_price_lock` freeze a staffed price in the database. §3.2: Submit sends a reopened
> server draft by its id; Upload Files became **Add Files**, the shared picker with its device Upload
> source; Delete Submission is withdrawn until DL D4 rules on deleting. Probe:
> `supabase/probes/claim_seat_and_price_lock.sql`. The findings below are the audit as written.

## 0. Premise corrections

The commissioning brief carried assumptions that the code or the docs contradict. They are corrected
here so the plan does not re-open settled ground.

| Brief assumed | Actual (source) |
| :-- | :-- |
| Fair Exit is a "25/50/75 basis points" split | The tiers are **percent**. `cancel_stage_fair_exit` takes tier ∈ {25, 50, 75} and converts `bp = tier × 100` (F1150:1162-1170). `finance.fn_fair_exit_split` pays share = amount × bp / 10 000, charges the fee on the share only and refunds the rest fee-free (F1200:914-930). The spec is not a 25/50/75 payout at all: `finance-model.md` §3 maps elapsed duration (<25 % · 25–75 % · >75 %) to payouts of **0 · 50 · 100 %**. See DL §4 D2. |
| Kanban and Gantt are both immediate-mode Canvas2D | Only the **Gantt** is. `@projective/ui/gantt` paints one `<canvas aria-hidden>` (`packages/ui/gantt/islands/Gantt.tsx:982`) beside a lane-windowed HTML task list and a visually hidden accessible sibling (`:1003-1040`), and pans through a signal store with no VDOM render. `@projective/ui/kanban` is DOM on `@projective/ui/dnd`, not virtualised (`packages/ui/kanban/islands/KanbanBoard.tsx:1-27`), which `DESIGN_SYSTEM.md:2808-2843` documents. That is a scale question, not a defect (DL D8). |
| `/projects/[slug]` is a role dispatcher: owner Details vs member Dashboard | Retired by Decision #144. Owner and participant get **one** Overview, varied by `data-viewer` (`F/components/overview/ProjectOverviewScreen.tsx:116,153-162`). An owner's draft 303s to `/details`; a prospect goes to the listing (`R/[projectSlug]/index.tsx:67-70`, rule in `types/access.ts:73-77`). |
| `ProjectBackendService` may not exist under that name | It is one static facade (PBS:1033) with a single `liveWrite` seam: the RPC under the user's JWT when `PROJECTS_BACKEND_LIVE` is on, else the stub store. A live error answers 502 and never falls back to fixtures (PBS:817-831). |
| `database/projects/Functions.md` lists RPCs that are missing | **None is missing.** Every documented RPC exists in SQL. The drift runs the other way: nine session functions exist with no entry (§5.4). |
| Post-onboarding immutability freezes ticket prices and the project format | The format freeze is in the database (`trg_project_shape_lock`, F1130:155-176). The **per-stage price** freeze, the "money" half of PS:2387-2389, is TypeScript only (LW:1878-1895; `types/setup.ts:1189-1303`). The stages FOR ALL policy lets review authority PATCH `unit_price_cents` directly (P2011:282-284). |
| $W_i$ = CREATE weight × difficulty multiplier | **No CREATE weight is stored** on a stage or ticket. `org.create_category` exists (`00000003_enums_core.sql:87`) but only org and catalogue tables use it. The backend uses a weight of 1 (`NEUTRAL_CATEGORY_WEIGHT`, `svc/live-board.ts:175`; LW:2257-2267, Decision #64(b)). Only the difficulty multiplier is real (`types/board.ts:107-114`). |
| `/submissions` is one page | It is a catch-all tree with two copies: `/projects/[slug]/submissions/[...path]` and the stage-room twin `[channelId]/submissions/[...path]` (§3). |

---

## 1. Status matrix — project formats across the four layers

Legend: ✅ compliant · ⚠️ partial / drift · ❌ missing / violates · — not applicable.

### 1.1 Shape and storage

| # | Capability | DB schema | Zod (`@projective/types`) | Fat service | Route / island |
| :-- | :-- | :-- | :-- | :-- | :-- |
| F1 | Three types stored as `format` + `structure_variation`: Task = `one_off`+`single_task`, One-off = `one_off`+`one_off`, Pipeline = `pipeline`+`standard` | ✅ enums (`00000003:95,103`). ⚠️ No CHECK pairs the two columns, so `pipeline`+`one_off` is storable (T15:174-212) | ✅ `ProjectTypeChoice`; `projectTypeOf` is total over stored pairs (`types/setup.ts:76-84,868,923-930`) | ✅ `createFormatToColumns`; one `create_project` transaction for draft, root stage and rooms (`flows/Projects.md` §2.4) | ✅ Quick-Init modal; `/projects/create` 308s (`R/create.tsx:25-29`) |
| F2 | Task = exactly one stage and one ticket | ⚠️ `fn_enforce_structure_variation` (F1130:113-151) caps ≤ 1 / ≤ 1 **on INSERT only** (TR1850:61-69). An UPDATE to `single_task` re-checks nothing. Legacy `one_off`+`single_stage` reads as a Task but allows unlimited tickets | ⚠️ `types/setup.ts:941` says "exactly one"; SQL enforces "at most one", at insert | ⚠️ a type switch trims stages (LW:2096-2100 + `sanitize_single_room_topology`) and leaves extra tickets | — |
| F3 | One-off = one master ticket carried across milestone stages | ⚠️ ≤ 1 ticket per project, insert-only (same trigger) | ✅ | ✅ | ⚠️ no seeded one-off has more than one stage, so the multi-milestone path is exercised by no fixture (`flows/Projects.md:210`) |
| F4 | Pipeline = unconstrained tickets × stages | ✅ | ✅ | ✅ | ✅ |
| F5 | Session is never offered at creation | ✅ the enum keeps `session` for cohorts | ✅ `ProjectCreateFormat` = `one_off · pipeline` (`types/create.ts:197`) | ✅ | ✅ |

### 1.2 Views per type (PS §The Three Work Flows; Decisions #121, #134, #164)

| View | Task | One-off | Pipeline | How it is enforced |
| :-- | :-- | :-- | :-- | :-- |
| Overview (owner and participant) | ✅ | ✅ | ✅ | server dispatch (`R/[projectSlug]/index.tsx:67-70`) |
| Board `/board` | ❌ PS:373-374 says a Task has no Board, but `R/[projectSlug]/board.tsx` has no handler and renders a Kanban | ⚠️ no lane link, but the page renders | ✅ | lane link only (`F/components/detail-glyphs.tsx:313-321`) |
| Timeline `/timeline` | ✅ 303 to the project (`F/core/task-view-guard.ts:23-35`) | ✅ | ⚠️ the lane drops Timeline (Decision #134) but stage rooms carry a Timeline tab (`F/core/channel-view.ts:89-92`) | server 303 for a Task; nav-only otherwise |
| Calendar `/calendar` | ✅ 303 | ⚠️ the `[channelId]/calendar` route exists but no `CHANNEL_TAB_MATRIX` entry includes it (`channel-view.ts:35,80-93`), so it is reachable only by a typed URL | same | server 303 for a Task |
| Stage room `tasks` board | ❌ renders in a Task's room; `R/[projectSlug]/[channelId]/tasks.tsx:13-20` has no guard | ❌ the one-off matrix omits `tasks` (`channel-view.ts:85-88`) but the route renders | ✅ | header only (`visibleChannelTabKeys`, `F/core/channel-header-slot.tsx:137`). The comment at `channel-view.ts:162-163` claims "the route behind it refuses independently"; no route does |
| Submissions | ✅ | ✅ | ✅ | the Session lane hides it (`detail-glyphs.tsx:342`); the route has no type guard |
| `GET /api/projects/timeline` | ⚠️ answers for a Task (`api/timeline.ts` → PBS:1389) | ✅ | ✅ | none |

### 1.3 Execution rules

| # | Rule (source) | DB | Zod | Service | Island | Verdict |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| X1 | A claim needs held escrow: "no hold, no work" (#165) | ✅ `fn_ticket_escrow_sync` binds or holds on claim and raises PF402 on any entry into work without a hold, on every path including direct writes (F1110:350-376) | ✅ `FundingStatusSchema` | ✅ PF402 → 402 "needs funding" (`svc/live-claim.ts:46-96`) | ✅ claim and Start work are not optimistic (`F/islands/ProjectBoard.island.tsx:566-611`) | ✅ |
| X2 | Self-claim only in `open_pull` (PS:2059-2066) | ✅ (F1120:459-469) | ✅ | ✅ | ✅ | ✅ |
| X3 | The claimant is hired on the ticket's stage, and the ticket is Ready (PS:1983) | ❌ `claim_ticket` asks only `has_project_access` (F1120:456). `fn_assign_ticket_core` checks claimed, description, adult, payout and capacity, but not seat or status (F1140:434-490) | ✅ `isSelfClaimable` (`types/board.ts:1191`) | ❌ | ✅ client-side only | ❌ **(I)** any participant can claim any funded ticket on any stage by its uuid |
| X4 | Capacity: global soft cap + stage hard cap through `check_ticket_capacity` before any claim or assignment (PS §3 Concurrency Limits) | ⚠️ implemented (F1140:238-316), but: the sums are unlocked, so two concurrent claims by one user on different tickets can both pass **(I)**; `reported_hidden` tickets drop out of the sum although the assignee still holds them (F1140:272,284,344; #290); the stage cap reports scope `project`; `workload_intensity` has no CHECK (T15:452), so 0 or a negative $W_i$ is storable and lowers the sum | ⚠️ the multiplier is an enum; the column is free numeric | ⚠️ $W$ = 1 × difficulty (LW:2257-2267) | — | ⚠️ |
| X5 | CREATE weights: Create 1.5 · Advise 1.2 · Educate 1.0 · Run 0.8 · Test 0.7 · Empower 0.5 (PS:2002-2011) | ❌ no category column on `project_stages` (T15:216-391) | ❌ | ❌ | ❌ | ❌ (DL D9) |
| X6 | Assignment modes, chosen in the stage's Staffing tab: round robin, manual, parallel stream (PS:2046-2069) | ⚠️ the RPCs exist, but only `assign_ticket_manual` is granted to `authenticated` (G2510:93). `set_stage_assignment_mode`, `auto_assign_round_robin` and `assign_parallel_stream` are service-role only and each requires `can_review_project(auth.uid())`, which a service-role call cannot satisfy | — | ❌ no caller | ❌ no control | ❌ three of the four modes are unreachable (DL D6) |
| X7 | Claim TTL: the `fn_release_expired_claims` sweep refunds a parked claim in full (PS:1989-1994) | ⚠️ the function exists (F1140:652-686), service-role only (G2510:1319-1320), and is **not registered** in `ops.scheduled_jobs` (J5060). `SYSTEM_ARCHITECTURE.md:2423-2427` lists it as "implemented but not registered, awaiting a human" (#203 (a), #290 (a)). The sweep itself takes no `FOR UPDATE SKIP LOCKED`, its UPDATE does not re-check `status = 'claimed'`, and it writes no `ticket_history` row, sends no notification and has no batch limit | — | ❌ no caller | — | ❌ **the rule never fires** (DL D1) |
| X8 | Project type frozen at the first onboarding (PS:2376-2379) | ✅ `trg_project_shape_lock` (F1130:155-176). ⚠️ The lock reads `stage_assignments.status`, which has no CHECK (T15:548-565), and the owner may UPDATE or DELETE seats through the "Owner manage assignments" FOR ALL policy (P2011:47-56), so flipping a seat to `declined` lifts the lock **(I)** | ✅ | ✅ `onboardingLockRefusal` (LW:1862,2025; PBS:2856) | ✅ the publish confirmation names the lock | ⚠️ |
| X9 | Stage ticket price frozen per stage; a flat engagement's price frozen at the first onboarding (PS:2380-2385) | ❌ nothing guards `project_stages.unit_price_cents` or `projects.budget_amount_cents` | ✅ `projectPriceLocked` (`types/setup.ts:1189-1291`) | ⚠️ read-then-write window (LW:1878-1895) | ✅ | ⚠️ service-only |
| X10 | A claimed ticket's terms bind both parties (#291) | ✅ `fn_ticket_immutability_guard` freezes title, description, text, price, `required_stages` and $W_i$ (F1110:304-322) | ✅ | ⚠️ the stub `commitTicket` does not mirror it (PBS:2963-3010) | ✅ | ✅ live · ⚠️ stub |
| X11 | Who moves a claimed ticket (#293) | ✅ `fn_assert_ticket_move` on `move_ticket` and on the direct-statement guard (F1110:281-300) | ✅ | ⚠️ the stub move checks funding only (PBS:3050) | ⚠️ `canDrag` is true for every visible card on the stage Tasks board (#293 (b), still open) | ⚠️ |
| X12 | Writes to an unclaimed ticket's assignee go through the assignment door | ❌ the guard returns early when `OLD.current_assignee_id IS NULL` (F1110:281). Review authority can PATCH an unclaimed ticket's assignee and status straight to `claimed`, skipping capacity, the adult gate (#190), payout readiness and `open_pull`, with no `ticket_history` row. The escrow gate (X1) still holds **(I)** | — | — | — | ❌ |
| X13 | Chain Reaction (#210) | ✅ `force_complete_stage` releases, advances, then holds the next stage or marks Needs funding / Draft (F1130:644-768). ⚠️ The next stage id is read from unvalidated `required_stages` jsonb, so it may name another project's stage; no capacity check runs at the next stage; the hold is priced `COALESCE(ticket.unit_price_cents, stage.unit_price_cents)` (F1200:384), so a ticket price overrides every stage in its chain | ✅ | ✅ fees in SQL; TS only maps (`svc/live-settlement.ts:172`) | ✅ | ✅ · ⚠️ edges |
| X14 | Fair Exit (`finance-model.md` §3, #198) | ⚠️ the client picks a 25/50/75 % tier of principal, the fee falls on the earned share only, and an unclaimed prepaid ticket is refunded whole (F1150:1124-1225; F1200:914-953). The time bands are not wired (`finance-model.md:124-131`, #198 (f)) | ✅ | ✅ | ✅ reviewer-only, against a server-computed preview (`F/components/FairExitDialog.tsx:73,95`) | ⚠️ spec ≠ build (DL D2) |
| X15 | Ticket deletion (PS §Deletion Protocol) | ⚠️ `delete_ticket` releases a claimed ticket's escrow in full, then **hard-deletes** the row (F1120:56-84). `ticket_history` and `ticket_workload_reports` CASCADE away (T15:480,1043); escrows keep a NULL `ticket_id` (`00000017:85`). A ticket with any submission cannot be deleted at all: `stage_submissions.ticket_id` has no ON DELETE (T15:589), so the call fails `23503` | — | — | — | ⚠️ contradicts PM §5.4 (DL D4) |
| X16 | Stage deletion (PS §Stage Management 3) | ⚠️ `delete_stage` (F1130:365-445): step 5 raises when any escrow history exists, with no handler, so the earlier releases roll back (the comment "funds are still released" is wrong). Step 2 nulls `current_stage_id` but leaves status and assignee, so a ticket can sit `in_progress` with no stage | — | ✅ called by the stage reconcile | — | ⚠️ |
| X17 | Stage reordering (PS:2226-2228, 2354-2358) | ⚠️ `fn_stage_reorder_lock` (F1130:10-29) freezes started, claimed and assigned stages ✅. `reorder_stages` (F1130:603-622) accepts a partial permutation and skips foreign ids, and `sort_order` has no unique index, so duplicate positions are storable | — | ✅ | ✅ | ⚠️ |
| X18 | Workload Intensity report (PS §Dispute Mechanism, #290) | ⚠️ the engine is complete in SQL (F1140:7-190) | ❌ no schema | ❌ no service, no route | ❌ no control | ❌ unreachable (DL §3) |
| X19 | A stage's status reflects its work | ❌ nothing writes `submitted`, `approved` or `revisions`; only `assigned`, `in_progress`, `cancelled` and `paid` are written, and review authority can write any status directly (P2011:282-284) | ❌ no `stage_status` enum in Zod | — | — | ❌ (DL S3) |

---

## 2. Frontend vs MVP and the design system

### 2.1 Route inventory (`R/`)

| Route | Renders | Guard | Verdict |
| :-- | :-- | :-- | :-- |
| `index.tsx` | portfolio (`resolvePortfolio` → `ProjectPortfolio` + `ProposalList`) | session | ✅ |
| `create.tsx` | 308 → `/projects` (ROUTING.md:99) | — | ✅ |
| `[projectSlug]/_middleware.ts` | prospects to the listing, memoised `projectAccess`, title; skips `/preview` (`:24-49`) | server | ✅ |
| `[projectSlug]/index.tsx` | Overview dispatcher (`:60-111`) | `landingFor(access, status)` | ✅ |
| `preview.tsx` | `EntityViewPage mode="preview"` | signed in (`:53`), `canConfigure` and not personal (`:58`), `previewAllowed` (`:62`); else 303 to root or `/details` | ✅ |
| `details.tsx` | `ProjectSetupScreen` (`:36-52`) | handler | ✅ |
| `edit.tsx`, `settings.tsx`, `attachments.tsx` | 308 → `/details`, `/files` (ROUTING.md:101-106) | — | ✅ |
| `board.tsx` | `ProjectBoard` | **none** (`define.page` only) | ❌ Task / One-off (§1.2) |
| `timeline.tsx`, `calendar.tsx` (both levels) | Gantt / calendar | `taskAbsentViewRedirect` | ✅ |
| `discussion.tsx` | the project or Task room (`discussionOf`, two 303 misses, `:51-89`) | handler | ✅ |
| `[channelId]/_middleware.ts` | `legacyDiscussionRedirect` → `unknownRoomRedirect` (`:19-22`) | server | ✅ |
| `[channelId]/tasks.tsx` | stage board | **none** | ❌ matrix not enforced (§1.2) |
| `[channelId]/details.tsx` | stage details (`:72-119`) | existence → `canConfigureStage` → read | ✅ |
| `[channelId]/calendar.tsx` | stage calendar | Task guard only | ⚠️ orphan (§1.2) |
| `submissions/[...path].tsx` (both levels) | Submissions explorer | none at the route (§3) | ⚠️ |

**Controller placement (root `CLAUDE.md` §4).** No project route re-exports a feature controller and
`F/` has no `routes/` folder: every route defines its handler and page inline, delegating to
`F/core/*-ssr.ts`. The routes are thin, so the cost is convention, not behaviour. ⚠️

### 2.2 Addressing (Decisions #88 and #95)

- **Ticket "Copy link" and "Open in a new tab" emit the wrong address.** `TicketMenu` builds
  `/projects/{slug}/board?ticket={uuid}` (`F/components/ticket/TicketView.tsx:843-845`). Nothing reads
  `?ticket=`, the value is the row uuid rather than the `tkt-` slug (`types/board.ts:597-607`), and
  `/board` is not a destination on a Task or a One-off. The shared link opens a board with no ticket.
  ❌ #88, #95, gate §3.11. The builder already exists: `withTicketParam` (`F/core/ticket-link.ts:48-59`).
- **`?tkv=` works.** `TicketDeepLinkHost` shape-checks with `isTicketSlug` (`ticket-link.ts:36-38`),
  offers the slug to a registered board or timeline first, else fetches
  `/api/projects/ticket?slug=`, which shape-checks and RLS-gates through `ProjectBackendService.ticket`
  (`F/islands/TicketDeepLinkHost.island.tsx:211-238`; `apps/web/routes/api/projects/ticket.ts:23-41`).
  The access decision is the server's; the modal opens after hydration (ROUTING.md:330-345). ✅
- **Submissions tree segments are uuids**: stage id, submitter user id and submission id
  (`svc/live-submissions.ts:1379,1169,1131`; `F/core/ticket-view.ts:389-410`). A stage node routes by
  uuid rather than `stg-…`. ❌ #88 (DL D14)
- **Project slug shape is never pre-checked.** The live resolver queries by slug only
  (`svc/live-support.ts:89-99`), so a uuid cannot match, but `isProjectSlug`
  (`svc/project-identity.ts:38`) has no caller outside its test, so the "test the shape, 404 before a
  round trip" rule (ROUTING.md:262-272) is not applied. ⚠️
- **API identity is mixed.** The settlement resolver accepts a project uuid **or** slug
  (`svc/live-settlement.ts:154,164`), against `project-identity.ts`'s "a uuid does not route". Claim,
  move and submit take raw ticket and stage uuids in their bodies, which #88 tolerates (it governs page
  URLs, ROUTING.md:253). Claim and move use `projectId` only for the read-back, so a mismatched one
  commits the write and then answers 502 (PBS:3031-3037) **(I)**. ⚠️
- **Files `?in=`** falls back to a raw id (`F/core/file-tree-route.ts:62-65,87`); team and DM rooms
  keep their uuid by the documented exception (#162(h)). ⚠️
- Cosmetic: `/projects/${slug}` is hand-built without encoding in
  `F/islands/ProjectSidebar.island.tsx:282,401` and `F/components/ProjectCard.tsx:79`.

### 2.3 Kanban and Gantt against `@projective/ui`

| Engine | Contract | Implementation | Consumers | Verdict |
| :-- | :-- | :-- | :-- | :-- |
| `@projective/ui/gantt` | immediate-mode Canvas2D, accessible DOM sibling, no VDOM work during pan (`DESIGN_SYSTEM.md:2456,3674-3690`) | one `<canvas aria-hidden>` (`Gantt.tsx:982`); HTML header and lane-windowed task list (`components/GanttTaskList.tsx:1-13`); visually hidden focusable list, live region and controls (`Gantt.tsx:1003-1040`); `scrollX` / `scrollY` / `pxPerDay` signals in `core/gantt-store.ts`, painted in a layout effect | `F/islands/ProjectTimeline.island.tsx:13`, `F/components/ticket/tabs/TicketTimelineTab.tsx:2` | ✅ |
| `@projective/ui/kanban` | DOM + `@projective/ui/dnd` (`DESIGN_SYSTEM.md:2808-2843`) | Preact with pointer and keyboard sensors; ARIA `group` / `list` / `listitem` / `button` and an `aria-live` announcer (`KanbanBoard.tsx:349-377`; `KanbanColumn.tsx:112,124`); drag state in signals (`KanbanBoard.tsx:74-77`); **no virtualisation** | `F/islands/ProjectBoard.island.tsx:18` | ✅ to its contract · ⚠️ at scale (DL D8) |

No duplicate engine exists. `TicketListView.tsx` is the board's list mode, and
`F/components/ticket/StagePipeline.tsx:3` is a stage-route sortable on `@projective/ui/dnd`, not a
board. The **Global Workload Kanban** (PS:279-288) is not built (DL D15). The PS "Board tab inside
every stage" (PS:289-297) is narrowed to pipeline stages by `CHANNEL_TAB_MATRIX` (Decision #134), a
spec divergence that #134 records but PS does not.

### 2.4 Islands, hooks and client state

- **Islands are dumb.** No Supabase or `@server` import in `F/islands`, `F/components` or `F/hooks`.
  Client services fetch `/api/*` through `apiFetch` (`F/core/api.ts:2`). The `F/core` files that import
  `@server` (`*-ssr.ts`, the slot resolvers, `task-view-guard.ts`, `respond.ts`) are reached by no
  island. ✅
- **Hooks.** `useState`: 0. `useEffect`: 57 across 22 islands and 45 in components and hooks, mostly
  mount wiring (popstate, the dev seam, the ticket-surface registry). These are not:
  `F/islands/SubmissionExplorer.island.tsx:547-549,946-951,954-956,976-978` react to signal `.value`
  through dependency arrays and should be `useSignalEffect` or `computed`. ⚠️
- **Board moves are optimistic with a full rollback** (`ProjectBoard.island.tsx:648-672`), re-checked
  client-side before the write (`:683-720`). ✅ There is no in-flight guard: a failed move restores
  the whole `before` array and can undo a second move still in flight **(I)**. ⚠️
- **Board view state is not addressable.** View mode, grouping, search, priority and assignee filters
  and sort are signals (`F/core/board-state.ts:20,22`; `ProjectBoard.island.tsx:188-192`). ROUTING.md
  has no board rule; Members `?view=`, Files `?in=` and the wallet's `?q=&dir=` set the precedent. ⚠️
  (DL D13)
- `SubmissionExplorer.island.tsx:972` calls `replaceState(…, location.pathname)` to drop `review=1`
  and drops every other parameter with it, `tkv` included. ⚠️

### 2.5 Design-gate defect log (task and stage views)

| Gate | Instances | Verdict |
| :-- | :-- | :-- |
| §3.8 headings never ≥ `--fw-bold` | `h2.tkv__title` (`TicketView.tsx:385` → `ticket-view.css:117`); `h3.tkc-pipe__title` (`StagePipeline.tsx:279` → `ticket-pipeline.css:250`); `h3.tkc-insp__title` (`StageInspector.tsx:96` → `ticket-pipeline.css:776`); `TaskChecklistView.tsx:31` h4 (→ `submission-actions.css:325`, `700`); `.tkv-rich h3` (`ticket-view.css:806`). Numeric weights instead of tokens: eight in `board.css` (e.g. `:404`), `submission-actions.css:258,358` | ❌ |
| §3.2 accessibility | `TicketCard` sets `tabIndex={0}` on spans inside the card's `role="button"` root (`TicketCard.tsx:59,75,94,115,154`; `StageStatusIcon.tsx:42`): up to six extra tab stops per card, against its own doc (`:14-18`) and `DESIGN_SYSTEM.md:2826-2830`. `BoardColumnHeader.tsx:49` likewise | ❌ |
| §3.7 anti-tagification | the list view's priority pill `.brd-list__prio` (`TicketListView.tsx:61`; `board.css:440-493`) is neither a lifecycle status, a count, a disclosure nor a control. Status pills, the Frozen chip and `MemberBadges` are lifecycle states ✅; `TicketCard` meta is inline middot text ✅ | ❌ |
| §3 token-only | literal radii: `submission-explorer.css:70` (`50px`), `ticket-view.css:395`, `gantt.css:523,530`, `project-showcase.css:111`. Ring shadows: `ticket-view.css:867,1210`. Hard-coded alpha on chips: `board.css:472-493`, `ticket-pipeline.css:360` | ⚠️ |
| §3 no inline styles | 28 in `F/` TSX. Direct properties at `ProjectCard.tsx:224`, `ChannelDetailBody.tsx:85`, `GroupSessionPanel.tsx:117`; `z-index` at `TicketView.tsx:345`, `SubmissionReviewModal.tsx:257`, `PreSubmitModal.tsx:129`, `ProjectCreateModal.tsx:438`. The rest set custom properties (`styleVars`), for which `guardrails.md:83` states no exception | ⚠️ |
| §3.9 `backdrop-filter` | `project-showcase.css:585` applies a literal `blur(8px)` directly, not on a `::before` underlay. `members.css:58` and `message-interactions.css:39` not checked against the pinned-bar exception | ⚠️ |
| §3.6 anti-card, solid regions | board columns are a tint plus one hairline and `.tkt` is transparent (`board.css:202-215`); the Overview is unboxed (`project-dashboard.css:225-252`); kanban columns are solid `--surface-1` (`packages/ui/kanban/styles/kanban.css:30-40`) | ✅ |
| §3.11 a control does something | Delete Submission, Upload Files and Submit without a draft (§3.2) | ❌ |

Out of the task-view scope but seen: literal durations in `project-setup.css:1145` and the chat
sheets (`chat-feed.css:85`, `chat-composer.css:422`, `channel-header.css:115`).

---

## 3. Submissions tree route — verification

### 3.1 Route, resolution and access

| Check | Finding | Verdict |
| :-- | :-- | :-- |
| One parser | The project route uses `pathSegmentsAfter(ctx.url, 3)`, which decodes each segment (`F/core/explorer-header-slot.tsx:21-29`; `R/[projectSlug]/submissions/[...path].tsx:23`). The room route uses `ctx.params.path.split("/")` (`R/[projectSlug]/[channelId]/submissions/[...path].tsx:20`) | ⚠️ two parsers |
| Zod at the trust boundary (root `CLAUDE.md` §2) | the raw path reaches `ProjectBackendService.submissions` through `F/core/submissions-ssr.ts:21-33` without `SubmissionListParamsSchema` (12 segments × 120 chars, `types/submissions.ts:207-212`) | ⚠️ |
| Server resolution | `fetchSubmissionPage` (`svc/live-submissions.ts:1301`) builds the tree from RLS-filtered reads; `resolveChain` (`:608`) walks the segments; an unknown trailing segment shortens the path rather than 404ing (`live-submissions.test.ts:410-413`) | ✅ · ⚠️ silent truncation |
| Access | prospects are stopped by `[projectSlug]/_middleware.ts:24-49`; a project the viewer cannot see resolves to null and 404s; a non-reviewer is narrowed by `.eq("submitted_by")` inside the query (`resolveIsolation`, `:763`); reviewers see other people's unsent drafts, which the code marks as an open product decision | ✅ · DL D10 |
| Type guard | none: a Session's tree resolves although its lane hides Submissions | ⚠️ |
| Addressing | uuid segments (§2.2) | ❌ |

### 3.2 Review actions

| Action | Control | Endpoint | Server door | Verdict |
| :-- | :-- | :-- | :-- | :-- |
| Accept | `SubmissionExplorer.island.tsx:622-648` | `POST /api/projects/:id/stages/:stageId/submissions/:sid/review` | `review_submission` accept → `fn_settle_ticket_stage` → Chain Reaction | ✅ not optimistic; one confirmation (PS:60-61) |
| Request revision | same | same | `review_submission` request_revision; free rounds counted under the stage lock; PR402 past the allotment (PM §3.7) | ✅ |
| Paid revision | `:665` | `…/paid-revision`, then `…/paid-revision/fund` | `request_paid_revision`; `fund_paid_revision` or card (#199) | ✅ |
| Approve stage | `:736` | `…/stages/:stageId/approve` | `approve_stage` (F1150:1518-1715): review authority + `hire`, stage row lock, unclaimed prepaid refunded (#213) | ✅ |
| End stage (Fair Exit) | `FairExitDialog.tsx:73,95` | `…/fair-exit` (preview), `…/cancel` | `preview_stage_fair_exit` / `cancel_stage_fair_exit` | ✅ door · ⚠️ tier semantics (DL D2) |
| Reject | — | — | the verdict set is `accept · request_revision` (`types/settlement.ts:38,50`) | — matches PS:59-60, which has no reject |
| **Delete submission** | `SubmissionActionBar.tsx:160-169` | **none** | — | ❌ for a server-side draft it navigates to the parent and calls nothing (`SubmissionExplorer.island.tsx:828-836`), though its comment says "removal persists with the backend" |
| **Upload files** | `UploadFilesModal.tsx:46-55` | **none** | — | ❌ a `role="button"` drop zone with no input behind it (self-described stub) |
| **Submit (no local draft)** | `SubmissionExplorer.island.tsx:865-867` | **none** | — | ❌ flips the status to `pending_review` locally with no API call: the surface shows a delivery as sent that was never sent |

Two integrity notes behind the explorer:

- A **draft** is a direct insert followed by a separate file-link insert (LW:2851-2873), so a failure
  between them leaves a draft with no files. ⚠️
- The "Insert own submissions" policy (P2011:316-325) constrains neither `status` nor the
  ticket ↔ stage ↔ submitter pairing, so a submitter can insert a row already `accepted`, or one
  naming another ticket **(I)**. It moves no money (release keys on the ticket reaching `completed`),
  but the explorer offers Approve Stage once a unit reads `accepted` (`flows/Projects.md` §7.3) and the
  row is evidence. ❌

---

## 4. Backend services and execution rules

### 4.1 Ownership

| Operation | Service method | Database door |
| :-- | :-- | :-- |
| create | `create` (PBS:3435) | `create_project` (LW `insertProject`) |
| setup read / update | `setup` (PBS:2674), `updateProject` (PBS:2803) | LW `applyProjectUpdate` |
| instantiate a listing | `instantiateService` (PBS:3519) | `marketplace.instantiate_service_blueprint` (`svc/live-instantiate.ts:196`) |
| commit a ticket | `commitTicket` (PBS:2928) | LW:2421 |
| move | `moveTicket` (PBS:3015) | `move_ticket` (LW:2519) |
| claim | `claimTicket` (PBS:3067) | `claim_ticket` (`svc/live-claim.ts:82`) |
| submit | `createSubmission` (PBS:3177) | `submit_deliverable` / `send_submission_draft` (LW:2799) |
| review | `reviewSubmission` (PBS:3245) | `review_submission` |
| paid revision | `requestPaidRevision` (PBS:3286) | `request_paid_revision`; funding through `RevisionPurchaseBackendService` |
| approve stage | `approveStage` (PBS:3314) | `approve_stage` |
| Fair Exit | PBS:3361 / PBS:3387 | `preview_stage_fair_exit` / `cancel_stage_fair_exit` |
| remove member | `removeMember` (PBS:1598) | `remove_project_member` (`svc/live-invites.ts:454`) |
| create stage | `createStage` (PBS:2037) | `create_stage` |
| timeline | `timeline` (PBS:1389) | derived from the board read |

- **Thin routes.** Every handler read (claim, move, board ticket, `[id]`, create, submissions/create,
  stage cancel and fair-exit, paid-revision fund) checks the session, validates with Zod and delegates.
  No route does business logic or money math. ✅
- **`ServiceResult<T>` (Decision #10)** everywhere except `hireCooldowns`, which returns
  `Promise<Record<string, string>>` (PBS:1756). ⚠️ minor
- **Money math is in SQL.** `svc/live-settlement.ts` maps and clamps (`cents()`, `:172`). The ticket
  rate is chosen in TS (LW:2376-2405) and $W_i$ is computed in TS (X4/X5). ⚠️
- **Multi-statement writes from TS, no transaction.** `commitTicketRow` writes the row, then calls
  `move_ticket` separately, so a refused move leaves the row written (LW:2480-2509).
  `applyProjectUpdate` runs up to seven writes in order — project, status, visibility, attachments,
  stage reconcile (`delete_stage` / `reorder_stages`), roles, `sanitize_single_room_topology`
  (LW:2025-2117) — and a failure part-way commits part of the save. LW:1715-1718 already names the fix:
  "one RPC doing the whole reconciliation in a single transaction." ⚠️
- **No optimistic concurrency.** No `updated_at` or version check on any write; a move sends only the
  target status, so a stale drag is last-writer-wins inside the database's authority rules. ⚠️
- **Stub parity.** The stub claim skips capacity, project access and Ready status (PBS:3093-3110);
  the stub move skips the client drag lock (PBS:3050); the stub `commitTicket` skips the claimed-terms
  lock (PBS:2963-3010). `deno task dev:mock` therefore demonstrates rules the product does not hold. ⚠️
- `svc/live-board.ts:181` cites `projects.fn_check_workload_capacity`, which does not exist (the
  function is `check_ticket_capacity`).

---

## 5. Database and functions

### 5.1 Constraint gaps on the five audited tables

| Table | Gap | Source |
| :-- | :-- | :-- |
| `projects.projects` | no CHECK pairs `format` with `structure_variation` | T15:174-212 |
| `projects.project_stages` | no CREATE category column; `sort_order` not unique per project; `start_trigger_type = 'dependent_on_stage'` does not require `start_dependency_stage_id`; the dependency may name another project's stage (DL §2) | T15:216-391; `00004003` |
| `projects.tickets` | `workload_intensity` and `unit_price_cents` have no CHECK (the stage price has one, `flows/Projects.md` §4.5); `current_stage_id` and `required_stages` are not tied to the ticket's project; `workload_report_id` has no FK; no `archived_at` | T15:393-475 |
| `projects.stage_assignments` | `status text NOT NULL` with no CHECK, though the shape lock (X8) reads it | T15:548-565 |
| `projects.stage_submissions` | `status` is nullable; no UNIQUE on (`project_stage_id`, `number`) | T15:568-593; `00004003:17-18` |

### 5.2 $W_i$ enforcement

See X4–X6. The cap check is sound in shape and wrong in three details: it counts no category weight,
it releases a reporter's capacity while they still hold the ticket, and it is unlocked across a user's
other tickets. Only `check_ticket_capacity` is called by `fn_assign_ticket_core`; no trigger calls it,
so a direct write (X12) bypasses it.

### 5.3 Direct-write paths under RLS

`authenticated` holds `GRANT ALL` on every `projects` table (`00002500:121`), so RLS is the only gate.

| Policy | What it allows beyond the RPC doors | Source |
| :-- | :-- | :-- |
| "Manage tickets" FOR ALL | X12: assigning or re-statusing an unclaimed ticket, past every assignment check | P2011:355-376; F1110:281 |
| "Users can manage stages of own projects" FOR ALL | writing any stage `status`, price (X9), dependency, `chain_reaction`; hard DELETE | P2011:282-284 |
| "Owner manage assignments" FOR ALL | inserting a seat for any freelancer without consent; flipping or deleting one, which lifts the shape lock (X8) | P2011:47-56 |
| "Insert own submissions" | an `accepted` or NULL status; another ticket's id (§3.2) | P2011:316-325 |
| "Users can insert their own activity" | forging another project's feed (`project_activity.project_id` has no FK) — already open in `database/projects/Policies.md:469-471` | P2011:41-44 |
| "Users can delete own projects" | a hard DELETE of the project row (DL D4) | P2011:175 |

Category placement: the `files.*` policies are defined in the projects policy file (P2011), against
root `CLAUDE.md` §1 ("each statement in its category file").

### 5.4 Docs ↔ SQL drift

- **Undocumented SQL functions** (by bare name, absent from `database/projects/Functions.md`):
  `complete_lesson`, `fn_cohort_seats_taken`, `fn_confirm_seat`, `fn_session_param`,
  `get_cohort_offer`, `record_host_attendance`, `session_join_link`. `fn_is_session_host` and
  `fn_session_presence` appear only in `database/finance/Functions.md`; `record_presence` only in
  `Policies.md`.
- **Documented but missing:** none.
- **Tables.md:** it says no RPC writes `stage_submissions.revision_of`, but `fn_enter_review` does
  (F1150:205-211); it says `fn_stage_delete_cascade` nulls dependent stages (Tables.md:237-239), but
  the trigger does not (F1130:86-111), so a direct DELETE of a depended-on stage fails on the FK (the
  `delete_stage` RPC nulls them itself); its tickets introduction says lifecycle columns are "written
  only by SECURITY DEFINER RPCs", which §5.3 contradicts.
- **PM:490** stores a refund as `payment_status = 'refunded'`; a refund writes `unpaid` (F1200, the
  `fn_refund_ticket_escrow` reset). The value is never written.

### 5.5 Zod SSOT drift (`SYSTEM_ARCHITECTURE.md`: 1:1, zero drift)

- No row schemas for `project_stages`, `tickets`, `stage_submissions` or `stage_assignments`: Zod
  holds view models only, and `ProjectMemberRowSchema` is the one row schema in the domain. ❌
- `ProjectStatus` lacks `archived` (`types/summary.ts:31` vs `00000003:26`). ❌
- No `stage_status` enum. ❌
- `TicketIntensity` is an enum; the column is numeric. Zod requires `workload ≥ 0` and
  `unitPriceCents ≥ 0` where SQL has no CHECK. ⚠️
- `SubmissionStatus` speaks `revision_requested` for the stored `revisions_requested` through one
  mapper; PM §3.7 documents the choice. ✅
- 1:1: `TicketStatus`, `ProjectFormat`, `ProjectStructure`, `StageAssignmentMode`. ✅

---

## 6. Test coverage

| Area | Automated (TS, `deno task test`) | SQL behaviour |
| :-- | :-- | :-- |
| Claim | `svc/claim.test.ts`: refusal wording, stub happy path, needs-funding, not-open-pull, anonymous. No capacity case; the live path is not executed | probes only |
| Settlement / Fair Exit | `svc/live-settlement.test.ts`: mappers, notice text, a contract test that the TS keys appear in the migration text, grants; `F/core/fair-exit-model.test.ts`: UI tier logic | `supabase/probes/fair_exit_settlement.sql`, `chain_reaction.sql`, `escrow_release_concurrency.sql` |
| Funding / visibility | `board-funding.test.ts` (svc and types): provider visibility, paid/unpaid flips, the drag-lock helper (which the stub move never calls) | — |
| Writes and locks | `svc/live-writes.test.ts`: stage, role and attachment reconcile; onboarding lock refusals (`:316-346`) | `ticket_terms_payee_lock.sql`, `ticket_move_authority.sql` |
| Identity | `svc/project-identity.test.ts` | — |
| Submissions | `svc/live-submissions.test.ts`: tree shape, isolation in the query, reviewer membership failing closed | — |
| Workload report | — | `workload_report_suspension.sql` |

**Gap.** Every money and state rule in SQL is verified only by the manual psql probes in
`supabase/probes/`, which `deno task test` does not run (`deno.json:80,91`). A regression in
`fn_ticket_escrow_sync`, `force_complete_stage` or `fn_fair_exit_split` reaches `main` unseen.

---

## 7. Probes for the (I) findings

Run each inside `BEGIN … ROLLBACK` against a reset local database (the memory note in
`projective-dev-server-gotchas` has the `docker exec … psql` recipe and the `SET LOCAL ROLE
authenticated` + `request.jwt.claims` order).

| Finding | Probe |
| :-- | :-- |
| X3 seat-less claim | as a freelancer seated on stage A only, `claim_ticket` a funded `todo` ticket on stage B; expect success today, refusal after the fix |
| X4 concurrent capacity | two sessions, one user, two tickets whose sum exceeds the global cap; claim both inside overlapping transactions |
| X7 sweep race | claim, backdate `claimed_at`, start the ticket in session 1 without committing, run `fn_release_expired_claims` in session 2 |
| X8 shape-lock lift | as the owner of a staffed project, `UPDATE stage_assignments SET status='declined'`, then change `format` |
| X12 direct claim | as the owner, PATCH an unclaimed funded ticket to `current_assignee_id = <minor or unpayable user>, status = 'claimed'` |
| §3.2 forged acceptance | as an assignee, INSERT a `stage_submissions` row with `status = 'accepted'` |
| §2.2 projectId mismatch | `POST /api/projects/ticket/move` with a valid ticket and another project's slug |
| §2.4 move rollback race | two quick drags, the first refused by the server |

---

## 8. Prioritised backlog

**P0 — money and integrity**

1. Turn on the claim-TTL sweep after hardening it (row lock, status re-check, `ticket_history`,
   notifications) — needs DL D1.
2. ✅ Seat and Ready checks in `claim_ticket` (X3), in SQL, beside the `open_pull` check.
3. ✅ Close the unclaimed-ticket direct write (X12): an assignee change on the table path goes
   through `fn_assign_ticket_core` or is refused.
4. ✅ Stage-price freeze in the database (X9). Still open: a guard on `stage_assignments` status and
   deletes (X8), and a seat check on `assign_ticket_manual`, which still pins anyone.
5. ✅ The three no-op Submissions controls (§3.2): Submit and Add Files work; Delete waits on DL D4.

**P1 — rule conformance**

6. Server guards for `/board` on a Task and One-off, and for the stage-room matrix on `tasks` (303, as
   the timeline guard does).
7. Ticket Copy link through `withTicketParam` and the `tkt-` slug.
8. Tighten "Insert own submissions" to `draft · pending_review` and a consistent ticket ↔ stage ↔
   submitter triple.
9. `delete_stage`: refuse before releasing, and move a ticket whose stage is deleted out of work.
10. CHECKs: `workload_intensity > 0`, `tickets.unit_price_cents ≥ 0`, `stage_assignments.status`,
    `stage_submissions.status NOT NULL`, UNIQUE (`project_stage_id`, `number`), format × structure.
11. Count suspended tickets in $W_i$; lock the user's held tickets in `check_ticket_capacity`.
12. Zod row schemas for the four tables; `archived` in `ProjectStatus`; a `stage_status` enum.
13. Assignment routing: grant and build, or mark Planned (DL D6). Workload reporting (DL §3).

**P2 — quality**

14. The design-gate log (§2.5): heading weights, card tab stops, the priority pill, literals.
15. Board view state in the URL (DL D13); one submissions parser with Zod; `SubmissionExplorer`
    effects as signal effects; keep `tkv` on the review-flag strip.
16. Derive stage status (DL S3); one transactional RPC for `applyProjectUpdate`.
17. Run `supabase/probes/*.sql` in CI against a reset database.
18. Document the nine session functions; correct Tables.md and PM:490.
