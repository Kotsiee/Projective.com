# Project Management & Execution — Consolidated Audit (2026-10-29 → 2026-11-11)

> **Evaluation, not binding.** Consolidated 2026-11-11 from
> `PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md` (2026-10-29) and `PROJECT_MANAGEMENT_DECISION_LOG.md`
> (DL, 2026-10-29); the decision log was deleted, and §16 maps its old sections and IDs (DL §n is
> §n+8). Pre-merge text: `git show 08296359:documentation/architecture/<file>`. Status is
> doc-derived (the audit's Fixed banner, `PM_BUILD_PROMPTS.md` §0.1 and its run order,
> FOUNDER_QUESTIONNAIRE Part C, `git log`), not re-verified in code. Rulings: Decision #338
> (`reference/decisions/decisions-122-126.md`); the ghosting auto-approve is ruled on #337 (FDD D-9
> (a)); the build-prompt contradictions are #344.
>
> Read-only evaluation of the project-management and execution domain: the three project types (Task
> · One-off · Pipeline), stages, tickets, the claim protocol, Workload Intensity ($W_i$), the Chain
> Reaction, Fair Exit and the Submissions explorer. It covers `projects.*` (migrations and
> `database/projects/`), `@projective/types/projects`, `packages/backend/services/projects/`,
> `apps/web/features/projects/` and the `(dashboard)/projects` routes, measured against
> `PRODUCT_SPEC.md`, `PRODUCT_MANAGEMENT.md`, `SYSTEM_ARCHITECTURE.md`, `ROUTING.md`,
> `DESIGN_SYSTEM.md`, `flows/Projects.md` and the decision log through #334. **No code was
> changed.** The rulings it needed, and the new contradictions it found, are in §12 (from DL),
> recorded as **Decision #338** (#335–#337 are held by the parallel providers, identity and finance
> audits).
>
> **Section numbers.** §0–§7 keep the audit's numbers, which `PM_BUILD_PROMPTS.md`, migrations and
> Zod comments cite ("audit §5.1", "audit §2.2"). §8 is the remediation map that replaces the
> backlog; its item numbers are kept ("backlog items 6, 7 and 15"). §9–§12 are DL §1–§4 (DL §n =
> §n+8 here); DL §5 is the pointer in §12.5.
>
> Abbreviations: **T15** = `supabase/migrations/00000015_tables_projects.sql` · **F1100** =
> `…/00001100_functions_projects_read_access.sql` · **F1110** = `…/00001110_…_ticket_guards.sql` ·
> **F1120** = `…/00001120_…_ticket_lifecycle.sql` · **F1130** = `…/00001130_…_stages.sql` ·
> **F1140** = `…/00001140_…_automation_workload.sql` · **F1150** =
> `…/00001150_…_stage_funding_submissions.sql` · **F1200** = `…/00001200_functions_finance_core.sql`
> · **TR1850** = `…/00001850_triggers_projects_tickets.sql` · **P2011** =
> `…/00002011_policies_projects.sql` · **G2510** = `…/00002510_permissions_function_grants.sql` ·
> **J5060** = `…/00005060_seed_scheduled_jobs.sql` · **PBS** =
> `packages/backend/services/projects/ProjectBackendService.ts` · **LW** =
> `…/projects/live-writes.ts` · **svc/** = `packages/backend/services/projects/` · **types/** =
> `packages/types/projects/` · **F/** = `apps/web/features/projects/` · **R/** =
> `apps/web/routes/(dashboard)/projects/` · **PS** = `PRODUCT_SPEC.md` · **PM** =
> `PRODUCT_MANAGEMENT.md` · **DL** = the merged decision log (its IDs S1–S13, C1–C6, W1–W10 and
> D1–D16 keep their names here) · **FM** = `finance-model.md` · **PMBP** = `PM_BUILD_PROMPTS.md` ·
> **FBP** = `FINANCE_BUILD_PROMPTS.md` · **FQ** = `FOUNDER_QUESTIONNAIRE.md` (Part C ruling IDs
> Q0.3, P1–P7, M7) · **FA / FCA / FDD** = `FINANCE_AUDIT.md` (one file since 2026-11-11) · **SBP-A**
> = `SUBSCRIPTIONS_AUDIT.md` · **SCA** = `SCHEDULING_COMPLETENESS_AUDIT.md` · **RED** =
> `PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md` · **ADC** = RED §2 (merged into RED).
>
> Status vocabulary: `Fixed (<prompt>, <commit>)` · `Partly fixed (…)` · `Ruled → <FQ id>: …` ·
> `Open → <prompt>` · `Open (no prompt)` · `Superseded by <ID>` · `Unverified` · **No defect** (a
> row the audit found compliant). 🧑 = a question the build prompt stops at (PMBP §0.5).
>
> Evidence: every finding was read from source. A finding marked **(I)** is inferred from reading
> and was not executed against a database; §7 lists the probe that settles each one.

> **Fixed since the audit (2026-10-29, the ruling-free P0s; commit `660c9658`).** X3: `claim_ticket`
> asks for a live seat on the ticket's stage, and `fn_assign_ticket_core` hands out only open work
> (New or Ready). X12: a direct statement may no longer name or swap a ticket's assignee. X9:
> `trg_stage_price_lock` and `trg_project_price_lock` freeze a staffed price in the database. §3.2:
> Submit sends a reopened server draft by its id; Upload Files became **Add Files**, the shared
> picker with its device Upload source; Delete Submission is withdrawn until DL D4 rules on
> deleting. Probe: `supabase/probes/claim_seat_and_price_lock.sql`. The findings below are the audit
> as written; their Status cells carry what landed since.

> **Fixed in Wave 0 (2026-10-30; PMBP §0.1).** PM-WP2 (X4, X8, W7), PM-WP3 (§5.1, X17, C4, S6) and
> PM-WP7 (S4, S7, S8, S9) in `3fcf2d54`; PM-WP10 row schemas in `4c9482a2`; PM-WP11 design gates in
> `e30b4111`; PM-WP13 probe runner in `f9c4fc31`.

## Executive summary

**Verdict (2026-10-29).** The audit traced the three project types across database, Zod, services
and islands, and the decision log traced three gap families: ticket state synchronisation (§9),
circular stage dependencies (§10) and Workload Intensity dispute resolution (§11). The money doors
are sound in SQL ("no hold, no work", the Chain Reaction, the Fair Exit split, approve stage), and
islands are dumb. What failed was enforcement and reach: rules held in TypeScript or the header but
not the database (the claim seat, the price freeze, the shape lock, the Task and One-off views);
clocks the spec promises that never run (the claim TTL, the workload-report expiry, the 14-day
ghosting auto-approve); exits that pay the wrong party (a client-chosen Fair Exit tier, 100 % to the
freelancer on removal or deletion) and hard deletes against "nothing is hard-deleted"; workload
reporting and three of four assignment modes unreachable; uuid addresses and board state held in
signals; and every SQL money rule verified only by manual probes. It put sixteen decisions (§12) and
fourteen flags (#338 (a)–(n)) to a human.

**What changed since (to 2026-11-11).** The same day, the ruling-free P0 pass closed X3, X12, X9 and
the Submit and Add Files half of §3.2. Wave 0 closed the seat lock and capacity (X4, X8, W7), the
constraints (§5.1, X17, C4, S6), one-transaction writes and stale moves (S4, S7–S9), the Zod row
schemas (§5.5), the design-gate log (§2.5, mostly) and gave the probes a runner (§6, no CI). Wave
1.1 recorded every ruling on #338 (FQ Part C Q0.3, P1–P7, M7). The owner departed from the
recommendation on D5 and D7 (build now, not Planned or presentation-only) and rejected D9 (P4: $W_i$
stays difficulty alone, a data-based measure extends the Reliability Index). Wave 1.2 wrote PMBP and
registered the claim-TTL job **paused** (`e18489d4`, merged `817dbbd1`). **No P-track Wave 2 prompt
has merged**: PM-WP1, D7a, WP4a, WP4b, P6, GH1, WP5a, WP5b, S3, D7b, WP6, WP8, WP9 and Z1 are open,
and the money exits (WP4a, WP4b, P6, GH1) wait for F·DB3 and F·DB6, which `FINANCE_BUILD_PROMPTS.md`
§0 does not mark done. Eight 🧑 questions stop the prompts (PMBP §0.5); its three new contradictions
are logged on #344 ((d), (e)) or partly resolved there (#8; §13).

## 0. Premise corrections

The commissioning brief carried assumptions that the code or the docs contradict. They are corrected
here so the plan does not re-open settled ground.

| Brief assumed                                                              | Actual (source)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status                                              |
| :------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------- |
| Fair Exit is a "25/50/75 basis points" split                               | The tiers are **percent**. `cancel_stage_fair_exit` takes tier ∈ {25, 50, 75} and converts `bp = tier × 100` (F1150:1162-1170). `finance.fn_fair_exit_split` pays share = amount × bp / 10 000, charges the fee on the share only and refunds the rest fee-free (F1200:914-930). The spec is not a 25/50/75 payout at all: `finance-model.md` §3 maps elapsed duration (<25 % · 25–75 % · >75 %) to payouts of **0 · 50 · 100 %**. See §12 D2.                                                                       | Ruled → P1 (D2); Open → PM-WP4a                     |
| Kanban and Gantt are both immediate-mode Canvas2D                          | Only the **Gantt** is. `@projective/ui/gantt` paints one `<canvas aria-hidden>` (`packages/ui/gantt/islands/Gantt.tsx:982`) beside a lane-windowed HTML task list and a visually hidden accessible sibling (`:1003-1040`), and pans through a signal store with no VDOM render. `@projective/ui/kanban` is DOM on `@projective/ui/dnd`, not virtualised (`packages/ui/kanban/islands/KanbanBoard.tsx:1-27`), which `DESIGN_SYSTEM.md:2808-2843` documents. That is a scale question, not a defect (DL D8, #338 (n)). | Ruled → P3: keep the DOM (D8)                       |
| `/projects/[slug]` is a role dispatcher: owner Details vs member Dashboard | Retired by Decision #144. Owner and participant get **one** Overview, varied by `data-viewer` (`F/components/overview/ProjectOverviewScreen.tsx:116,153-162`). An owner's draft 303s to `/details`; a prospect goes to the listing (`R/[projectSlug]/index.tsx:67-70`, rule in `types/access.ts:73-77`).                                                                                                                                                                                                             | Correction (no action)                              |
| `ProjectBackendService` may not exist under that name                      | It is one static facade (PBS:1033) with a single `liveWrite` seam: the RPC under the user's JWT when `PROJECTS_BACKEND_LIVE` is on, else the stub store. A live error answers 502 and never falls back to fixtures (PBS:817-831).                                                                                                                                                                                                                                                                                    | Correction (no action)                              |
| `database/projects/Functions.md` lists RPCs that are missing               | **None is missing.** Every documented RPC exists in SQL. The drift runs the other way: nine session functions exist with no entry (§5.4).                                                                                                                                                                                                                                                                                                                                                                            | §5.4: Open → PM-Z1                                  |
| Post-onboarding immutability freezes ticket prices and the project format  | The format freeze is in the database (`trg_project_shape_lock`, F1130:155-176). The **per-stage price** freeze, the "money" half of PS:2387-2389, is TypeScript only (LW:1878-1895; `types/setup.ts:1189-1303`). The stages FOR ALL policy lets review authority PATCH `unit_price_cents` directly (P2011:282-284).                                                                                                                                                                                                  | Fixed (X9; P0 pass, `660c9658`)                     |
| $W_i$ = CREATE weight × difficulty multiplier                              | **No CREATE weight is stored** on a stage or ticket. `org.create_category` exists (`00000003_enums_core.sql:87`) but only org and catalogue tables use it. The backend uses a weight of 1 (`NEUTRAL_CATEGORY_WEIGHT`, `svc/live-board.ts:175`; LW:2257-2267, Decision #64(b)). Only the difficulty multiplier is real (`types/board.ts:107-114`).                                                                                                                                                                    | Ruled → P4: $W_i$ is difficulty alone (D9 rejected) |
| `/submissions` is one page                                                 | It is a catch-all tree with two copies: `/projects/[slug]/submissions/[...path]` and the stage-room twin `[channelId]/submissions/[...path]` (§3).                                                                                                                                                                                                                                                                                                                                                                   | Correction (no action)                              |

---

## 1. Status matrix — project formats across the four layers

Legend: ✅ compliant · ⚠️ partial / drift · ❌ missing / violates · — not applicable.

### 1.1 Shape and storage

| #  | Capability                                                                                                                                              | DB schema                                                                                                                                                                                                                        | Zod (`@projective/types`)                                                                               | Fat service                                                                                                             | Route / island                                                                                                                 | Status                                                                                                                                                                     |
| :- | :------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 | Three types stored as `format` + `structure_variation`: Task = `one_off`+`single_task`, One-off = `one_off`+`one_off`, Pipeline = `pipeline`+`standard` | ✅ enums (`00000003:95,103`). ⚠️ No CHECK pairs the two columns, so `pipeline`+`one_off` is storable (T15:174-212)                                                                                                               | ✅ `ProjectTypeChoice`; `projectTypeOf` is total over stored pairs (`types/setup.ts:76-84,868,923-930`) | ✅ `createFormatToColumns`; one `create_project` transaction for draft, root stage and rooms (`flows/Projects.md` §2.4) | ✅ Quick-Init modal; `/projects/create` 308s (`R/create.tsx:25-29`)                                                            | Fixed (PM-WP3, `3fcf2d54`: the format × structure CHECK)                                                                                                                   |
| F2 | Task = exactly one stage and one ticket                                                                                                                 | ⚠️ `fn_enforce_structure_variation` (F1130:113-151) caps ≤ 1 / ≤ 1 **on INSERT only** (TR1850:61-69). An UPDATE to `single_task` re-checks nothing. Legacy `one_off`+`single_stage` reads as a Task but allows unlimited tickets | ⚠️ `types/setup.ts:941` says "exactly one"; SQL enforces "at most one", at insert                       | ⚠️ a type switch trims stages (LW:2096-2100 + `sanitize_single_room_topology`) and leaves extra tickets                 | —                                                                                                                              | Partly fixed (PM-WP3, `3fcf2d54`: a deferred constraint trigger re-checks the caps on a shape switch, = S6); the legacy `single_stage` and "exactly one" halves Unverified |
| F3 | One-off = one master ticket carried across milestone stages                                                                                             | ⚠️ ≤ 1 ticket per project, insert-only (same trigger)                                                                                                                                                                            | ✅                                                                                                      | ✅                                                                                                                      | ⚠️ no seeded one-off has more than one stage, so the multi-milestone path is exercised by no fixture (`flows/Projects.md:210`) | Partly fixed (the shape-switch re-check, PM-WP3, `3fcf2d54`); the fixture: Open (no prompt)                                                                                |
| F4 | Pipeline = unconstrained tickets × stages                                                                                                               | ✅                                                                                                                                                                                                                               | ✅                                                                                                      | ✅                                                                                                                      | ✅                                                                                                                             | No defect                                                                                                                                                                  |
| F5 | Session is never offered at creation                                                                                                                    | ✅ the enum keeps `session` for cohorts                                                                                                                                                                                          | ✅ `ProjectCreateFormat` = `one_off · pipeline` (`types/create.ts:197`)                                 | ✅                                                                                                                      | ✅                                                                                                                             | No defect                                                                                                                                                                  |

### 1.2 Views per type (PS §The Three Work Flows; Decisions #121, #134, #164)

| View                             | Task                                                                                                        | One-off                                                                                                                                                       | Pipeline                                                                                                         | How it is enforced                                                                                                                                                                      | Status                                                    |
| :------------------------------- | :---------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------- |
| Overview (owner and participant) | ✅                                                                                                          | ✅                                                                                                                                                            | ✅                                                                                                               | server dispatch (`R/[projectSlug]/index.tsx:67-70`)                                                                                                                                     | No defect                                                 |
| Board `/board`                   | ❌ PS:373-374 says a Task has no Board, but `R/[projectSlug]/board.tsx` has no handler and renders a Kanban | ⚠️ no lane link, but the page renders                                                                                                                         | ✅                                                                                                               | lane link only (`F/components/detail-glyphs.tsx:313-321`)                                                                                                                               | Ruled → P7 (D11); Open → PM-WP8                           |
| Timeline `/timeline`             | ✅ 303 to the project (`F/core/task-view-guard.ts:23-35`)                                                   | ✅                                                                                                                                                            | ⚠️ the lane drops Timeline (Decision #134) but stage rooms carry a Timeline tab (`F/core/channel-view.ts:89-92`) | server 303 for a Task; nav-only otherwise                                                                                                                                               | Task: No defect · the Pipeline room tab: Open (no prompt) |
| Calendar `/calendar`             | ✅ 303                                                                                                      | ⚠️ the `[channelId]/calendar` route exists but no `CHANNEL_TAB_MATRIX` entry includes it (`channel-view.ts:35,80-93`), so it is reachable only by a typed URL | same                                                                                                             | server 303 for a Task                                                                                                                                                                   | Open → PM-WP8 (step 1)                                    |
| Stage room `tasks` board         | ❌ renders in a Task's room; `R/[projectSlug]/[channelId]/tasks.tsx:13-20` has no guard                     | ❌ the one-off matrix omits `tasks` (`channel-view.ts:85-88`) but the route renders                                                                           | ✅                                                                                                               | header only (`visibleChannelTabKeys`, `F/core/channel-header-slot.tsx:137`). The comment at `channel-view.ts:162-163` claims "the route behind it refuses independently"; no route does | Ruled → P7 (D11); Open → PM-WP8                           |
| Submissions                      | ✅                                                                                                          | ✅                                                                                                                                                            | ✅                                                                                                               | the Session lane hides it (`detail-glyphs.tsx:342`); the route has no type guard                                                                                                        | Open → PM-WP8 (the Session 303)                           |
| `GET /api/projects/timeline`     | ⚠️ answers for a Task (`api/timeline.ts` → PBS:1389)                                                        | ✅                                                                                                                                                            | ✅                                                                                                               | none                                                                                                                                                                                    | Open → PM-WP8 (404 `view_absent`)                         |

### 1.3 Execution rules

| #   | Rule (source)                                                                                                                        | DB                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Zod                                                      | Service                                                       | Island                                                                                        | Verdict                                                                         | Status                                                                                                                                                                  |
| :-- | :----------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------- | :------------------------------------------------------------ | :-------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | A claim needs held escrow: "no hold, no work" (#165)                                                                                 | ✅ `fn_ticket_escrow_sync` binds or holds on claim and raises PF402 on any entry into work without a hold, on every path including direct writes (F1110:350-376)                                                                                                                                                                                                                                                                                                                                                               | ✅ `FundingStatusSchema`                                 | ✅ PF402 → 402 "needs funding" (`svc/live-claim.ts:46-96`)    | ✅ claim and Start work are not optimistic (`F/islands/ProjectBoard.island.tsx:566-611`)      | ✅                                                                              | No defect                                                                                                                                                               |
| X2  | Self-claim only in `open_pull` (PS:2059-2066)                                                                                        | ✅ (F1120:459-469)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅                                                       | ✅                                                            | ✅                                                                                            | ✅                                                                              | No defect                                                                                                                                                               |
| X3  | The claimant is hired on the ticket's stage, and the ticket is Ready (PS:1983)                                                       | ❌ `claim_ticket` asks only `has_project_access` (F1120:456). `fn_assign_ticket_core` checks claimed, description, adult, payout and capacity, but not seat or status (F1140:434-490)                                                                                                                                                                                                                                                                                                                                          | ✅ `isSelfClaimable` (`types/board.ts:1191`)             | ❌                                                            | ✅ client-side only                                                                           | ❌ **(I)** any participant can claim any funded ticket on any stage by its uuid | Fixed (P0 pass, `660c9658`; #338 (i)). `assign_ticket_manual` still pinned anyone after it (backlog 4): Fixed (PM-WP2, `3fcf2d54`, `fn_holds_live_seat`)                |
| X4  | Capacity: global soft cap + stage hard cap through `check_ticket_capacity` before any claim or assignment (PS §3 Concurrency Limits) | ⚠️ implemented (F1140:238-316), but: the sums are unlocked, so two concurrent claims by one user on different tickets can both pass **(I)**; `reported_hidden` tickets drop out of the sum although the assignee still holds them (F1140:272,284,344; #290); the stage cap reports scope `project`; `workload_intensity` has no CHECK (T15:452), so 0 or a negative $W_i$ is storable and lowers the sum                                                                                                                       | ⚠️ the multiplier is an enum; the column is free numeric | ⚠️ $W$ = 1 × difficulty (LW:2257-2267)                        | —                                                                                             | ⚠️                                                                              | Fixed (PM-WP2 + PM-WP3, `3fcf2d54`: serialised per user, `reported_hidden` counted, scope `stage`, `ck_tickets_workload_intensity`); the 1 × difficulty half Ruled → P4 |
| X5  | CREATE weights: Create 1.5 · Advise 1.2 · Educate 1.0 · Run 0.8 · Test 0.7 · Empower 0.5 (PS:2002-2011)                              | ❌ no category column on `project_stages` (T15:216-391)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ❌                                                       | ❌                                                            | ❌                                                                                            | ❌ (DL D9)                                                                      | Ruled → P4: no CREATE weights; Open → PM-WP5a step 1 (cleanup), PM-WP5b; 🧑 the label (PMBP §0.5 #1)                                                                    |
| X6  | Assignment modes, chosen in the stage's Staffing tab: round robin, manual, parallel stream (PS:2046-2069)                            | ⚠️ the RPCs exist, but only `assign_ticket_manual` is granted to `authenticated` (G2510:93). `set_stage_assignment_mode`, `auto_assign_round_robin` and `assign_parallel_stream` are service-role only and each requires `can_review_project(auth.uid())`, which a service-role call cannot satisfy                                                                                                                                                                                                                            | —                                                        | ❌ no caller                                                  | ❌ no control                                                                                 | ❌ three of the four modes are unreachable (DL D6)                              | Ruled → P3: Planned (D6); roadmap, no prompt (PMBP §0.6)                                                                                                                |
| X7  | Claim TTL: the `fn_release_expired_claims` sweep refunds a parked claim in full (PS:1989-1994)                                       | ⚠️ the function exists (F1140:652-686), service-role only (G2510:1319-1320), and is **not registered** in `ops.scheduled_jobs` (J5060). `SYSTEM_ARCHITECTURE.md:2423-2427` lists it as "implemented but not registered, awaiting a human" (#203 (a), #290 (a)). The sweep itself takes no `FOR UPDATE SKIP LOCKED`, its UPDATE does not re-check `status = 'claimed'`, and it writes no `ticket_history` row, sends no notification and has no batch limit. The TTL dial is `claim_ttl_minutes` 1440 (`00005001:10`; SBP-A §0) | —                                                        | ❌ no caller                                                  | —                                                                                             | ❌ **the rule never fires** (DL D1)                                             | Partly fixed (row registered paused; `e18489d4`, merged `817dbbd1`); Open → PM-WP1                                                                                      |
| X8  | Project type frozen at the first onboarding (PS:2376-2379)                                                                           | ✅ `trg_project_shape_lock` (F1130:155-176). ⚠️ The lock reads `stage_assignments.status`, which has no CHECK (T15:548-565), and the owner may UPDATE or DELETE seats through the "Owner manage assignments" FOR ALL policy (P2011:47-56), so flipping a seat to `declined` lifts the lock **(I)**                                                                                                                                                                                                                             | ✅                                                       | ✅ `onboardingLockRefusal` (LW:1862,2025; PBS:2856)           | ✅ the publish confirmation names the lock                                                    | ⚠️                                                                              | Fixed (PM-WP2, `3fcf2d54`: `ck_stage_assignments_status`, `trg_stage_assignment_lock_guard`)                                                                            |
| X9  | Stage ticket price frozen per stage; a flat engagement's price frozen at the first onboarding (PS:2380-2385)                         | ❌ nothing guards `project_stages.unit_price_cents` or `projects.budget_amount_cents`                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅ `projectPriceLocked` (`types/setup.ts:1189-1291`)     | ⚠️ read-then-write window (LW:1878-1895)                      | ✅                                                                                            | ⚠️ service-only                                                                 | Fixed (P0 pass, `660c9658`; the price half of #338 (j))                                                                                                                 |
| X10 | A claimed ticket's terms bind both parties (#291)                                                                                    | ✅ `fn_ticket_immutability_guard` freezes title, description, text, price, `required_stages` and $W_i$ (F1110:304-322)                                                                                                                                                                                                                                                                                                                                                                                                         | ✅                                                       | ⚠️ the stub `commitTicket` does not mirror it (PBS:2963-3010) | ✅                                                                                            | ✅ live · ⚠️ stub                                                               | Fixed (stub parity, PM-WP7, `3fcf2d54`; = S9)                                                                                                                           |
| X11 | Who moves a claimed ticket (#293)                                                                                                    | ✅ `fn_assert_ticket_move` on `move_ticket` and on the direct-statement guard (F1110:281-300)                                                                                                                                                                                                                                                                                                                                                                                                                                  | ✅                                                       | ⚠️ the stub move checks funding only (PBS:3050)               | ⚠️ `canDrag` is true for every visible card on the stage Tasks board (#293 (b), still open)   | ⚠️                                                                              | Partly fixed (stub move on the shared predicates, PM-WP7, `3fcf2d54`); `canDrag`: Ruled → P5 (b); Open → PM-WP6                                                         |
| X12 | Writes to an unclaimed ticket's assignee go through the assignment door                                                              | ❌ the guard returns early when `OLD.current_assignee_id IS NULL` (F1110:281). Review authority can PATCH an unclaimed ticket's assignee and status straight to `claimed`, skipping capacity, the adult gate (#190), payout readiness and `open_pull`, with no `ticket_history` row. The escrow gate (X1) still holds **(I)**                                                                                                                                                                                                  | —                                                        | —                                                             | —                                                                                             | ❌                                                                              | Fixed (P0 pass, `660c9658`; #338 (i))                                                                                                                                   |
| X13 | Chain Reaction (#210)                                                                                                                | ✅ `force_complete_stage` releases, advances, then holds the next stage or marks Needs funding / Draft (F1130:644-768). ⚠️ The next stage id is read from unvalidated `required_stages` jsonb, so it may name another project's stage; no capacity check runs at the next stage; the hold is priced `COALESCE(ticket.unit_price_cents, stage.unit_price_cents)` (F1200:384), so a ticket price overrides every stage in its chain                                                                                              | ✅                                                       | ✅ fees in SQL; TS only maps (`svc/live-settlement.ts:172`)   | ✅                                                                                            | ✅ · ⚠️ edges                                                                   | The route: Open → PM-D7a · the price: Ruled → P6 (per stage), Open → PM-P6 (🧑 #344 (e)) · next-stage capacity: Open (no prompt)                                        |
| X14 | Fair Exit (`finance-model.md` §3, #198)                                                                                              | ⚠️ the client picks a 25/50/75 % tier of principal, the fee falls on the earned share only, and an unclaimed prepaid ticket is refunded whole (F1150:1124-1225; F1200:914-953). The time bands are not wired (`finance-model.md:124-131`, #198 (f))                                                                                                                                                                                                                                                                            | ✅                                                       | ✅                                                            | ✅ reviewer-only, against a server-computed preview (`F/components/FairExitDialog.tsx:73,95`) | ⚠️ spec ≠ build (DL D2)                                                         | Ruled → P1 (D2); Open → PM-WP4a                                                                                                                                         |
| X15 | Ticket deletion (PS §Deletion Protocol)                                                                                              | ⚠️ `delete_ticket` releases a claimed ticket's escrow in full, then **hard-deletes** the row (F1120:56-84). `ticket_history` and `ticket_workload_reports` CASCADE away (T15:480,1043); escrows keep a NULL `ticket_id` (`00000017:85`). A ticket with any submission cannot be deleted at all: `stage_submissions.ticket_id` has no ON DELETE (T15:589), so the call fails `23503`                                                                                                                                            | —                                                        | —                                                             | —                                                                                             | ⚠️ contradicts PM §5.4 (DL D4)                                                  | Ruled → P2 (a), (b) (D3, D4); Open → PM-WP4b                                                                                                                            |
| X16 | Stage deletion (PS §Stage Management 3)                                                                                              | ⚠️ `delete_stage` (F1130:365-445): step 5 raises when any escrow history exists, with no handler, so the earlier releases roll back (the comment "funds are still released" is wrong). Step 2 nulls `current_stage_id` but leaves status and assignee, so a ticket can sit `in_progress` with no stage                                                                                                                                                                                                                         | —                                                        | ✅ called by the stage reconcile                              | —                                                                                             | ⚠️                                                                              | Open → PM-WP4b (step 4; = S5)                                                                                                                                           |
| X17 | Stage reordering (PS:2226-2228, 2354-2358)                                                                                           | ⚠️ `fn_stage_reorder_lock` (F1130:10-29) freezes started, claimed and assigned stages ✅. `reorder_stages` (F1130:603-622) accepts a partial permutation and skips foreign ids, and `sort_order` has no unique index, so duplicate positions are storable                                                                                                                                                                                                                                                                      | —                                                        | ✅                                                            | ✅                                                                                            | ⚠️                                                                              | Fixed (PM-WP3, `3fcf2d54`: a full permutation of live stages; deferrable UNIQUE (`project_id`, `sort_order`))                                                           |
| X18 | Workload Intensity report (PS §Dispute Mechanism, #290)                                                                              | ⚠️ the engine is complete in SQL (F1140:7-190)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ❌ no schema                                             | ❌ no service, no route                                       | ❌ no control                                                                                 | ❌ unreachable (§11)                                                            | Ruled → P3: Build now (D5); Open → PM-WP5a                                                                                                                              |
| X19 | A stage's status reflects its work                                                                                                   | ❌ nothing writes `submitted`, `approved` or `revisions`; only `assigned`, `in_progress`, `cancelled` and `paid` are written, and review authority can write any status directly (P2011:282-284)                                                                                                                                                                                                                                                                                                                               | ❌ no `stage_status` enum in Zod                         | —                                                             | —                                                                                             | ❌ (DL S3)                                                                      | Partly fixed (Zod `StageStatus`, PM-WP10, `4c9482a2`); Open → PM-S3                                                                                                     |

---

## 2. Frontend vs MVP and the design system

### 2.1 Route inventory (`R/`)

| Route                                         | Renders                                                                                | Guard                                                                                                                | Verdict                       | Status                |
| :-------------------------------------------- | :------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- | :---------------------------- | :-------------------- |
| `index.tsx`                                   | portfolio (`resolvePortfolio` → `ProjectPortfolio` + `ProposalList`)                   | session                                                                                                              | ✅                            | No defect             |
| `create.tsx`                                  | 308 → `/projects` (ROUTING.md:99)                                                      | —                                                                                                                    | ✅                            | No defect             |
| `[projectSlug]/_middleware.ts`                | prospects to the listing, memoised `projectAccess`, title; skips `/preview` (`:24-49`) | server                                                                                                               | ✅                            | No defect             |
| `[projectSlug]/index.tsx`                     | Overview dispatcher (`:60-111`)                                                        | `landingFor(access, status)`                                                                                         | ✅                            | No defect             |
| `preview.tsx`                                 | `EntityViewPage mode="preview"`                                                        | signed in (`:53`), `canConfigure` and not personal (`:58`), `previewAllowed` (`:62`); else 303 to root or `/details` | ✅                            | No defect             |
| `details.tsx`                                 | `ProjectSetupScreen` (`:36-52`)                                                        | handler                                                                                                              | ✅                            | No defect             |
| `edit.tsx`, `settings.tsx`, `attachments.tsx` | 308 → `/details`, `/files` (ROUTING.md:101-106)                                        | —                                                                                                                    | ✅                            | No defect             |
| `board.tsx`                                   | `ProjectBoard`                                                                         | **none** (`define.page` only)                                                                                        | ❌ Task / One-off (§1.2)      | Open → PM-WP8         |
| `timeline.tsx`, `calendar.tsx` (both levels)  | Gantt / calendar                                                                       | `taskAbsentViewRedirect`                                                                                             | ✅                            | No defect             |
| `discussion.tsx`                              | the project or Task room (`discussionOf`, two 303 misses, `:51-89`)                    | handler                                                                                                              | ✅                            | No defect             |
| `[channelId]/_middleware.ts`                  | `legacyDiscussionRedirect` → `unknownRoomRedirect` (`:19-22`)                          | server                                                                                                               | ✅                            | No defect             |
| `[channelId]/tasks.tsx`                       | stage board                                                                            | **none**                                                                                                             | ❌ matrix not enforced (§1.2) | Open → PM-WP8         |
| `[channelId]/details.tsx`                     | stage details (`:72-119`)                                                              | existence → `canConfigureStage` → read                                                                               | ✅                            | No defect             |
| `[channelId]/calendar.tsx`                    | stage calendar                                                                         | Task guard only                                                                                                      | ⚠️ orphan (§1.2)              | Open → PM-WP8         |
| `submissions/[...path].tsx` (both levels)     | Submissions explorer                                                                   | none at the route (§3)                                                                                               | ⚠️                            | Open → PM-WP8, PM-WP9 |

**Controller placement (root `CLAUDE.md` §4).** No project route re-exports a feature controller and
`F/` has no `routes/` folder: every route defines its handler and page inline, delegating to
`F/core/*-ssr.ts`. The routes are thin, so the cost is convention, not behaviour. ⚠️ **Status:**
Open (no prompt).

### 2.2 Addressing (Decisions #88 and #95)

- **Ticket "Copy link" and "Open in a new tab" emit the wrong address.** `TicketMenu` builds
  `/projects/{slug}/board?ticket={uuid}` (`F/components/ticket/TicketView.tsx:843-845`). Nothing
  reads `?ticket=`, the value is the row uuid rather than the `tkt-` slug
  (`types/board.ts:597-607`), and `/board` is not a destination on a Task or a One-off. The shared
  link opens a board with no ticket. ❌ #88, #95, gate §3.11. The builder already exists:
  `withTicketParam` (`F/core/ticket-link.ts:48-59`). **Status:** Ruled → P7; Open → PM-WP8 (step 3;
  the open remainder of #338 (m)).
- **`?tkv=` works.** `TicketDeepLinkHost` shape-checks with `isTicketSlug` (`ticket-link.ts:36-38`),
  offers the slug to a registered board or timeline first, else fetches
  `/api/projects/ticket?slug=`, which shape-checks and RLS-gates through
  `ProjectBackendService.ticket` (`F/islands/TicketDeepLinkHost.island.tsx:211-238`;
  `apps/web/routes/api/projects/ticket.ts:23-41`). The access decision is the server's; the modal
  opens after hydration (ROUTING.md:330-345). ✅ **Status:** No defect.
- **Submissions tree segments are uuids**: stage id, submitter user id and submission id
  (`svc/live-submissions.ts:1379,1169,1131`; `F/core/ticket-view.ts:389-410`). A stage node routes
  by uuid rather than `stg-…`. ❌ #88 (DL D14) **Status:** Ruled → P7 (D14); Open → PM-WP9 (step 5).
- **Project slug shape is never pre-checked.** The live resolver queries by slug only
  (`svc/live-support.ts:89-99`), so a uuid cannot match, but `isProjectSlug`
  (`svc/project-identity.ts:38`) has no caller outside its test, so the "test the shape, 404 before
  a round trip" rule (ROUTING.md:262-272) is not applied. ⚠️ **Status:** Open (no prompt).
- **API identity is mixed.** The settlement resolver accepts a project uuid **or** slug
  (`svc/live-settlement.ts:154,164`), against `project-identity.ts`'s "a uuid does not route".
  Claim, move and submit take raw ticket and stage uuids in their bodies, which #88 tolerates (it
  governs page URLs, ROUTING.md:253). Claim and move use `projectId` only for the read-back, so a
  mismatched one commits the write and then answers 502 (PBS:3031-3037) **(I)**. ⚠️ **Status:** Open
  (no prompt).
- **Files `?in=`** falls back to a raw id (`F/core/file-tree-route.ts:62-65,87`); team and DM rooms
  keep their uuid by the documented exception (#162(h)). ⚠️ **Status:** Open (no prompt; FQ P7's
  `/files` URL state is not assigned to track P, PMBP PM-WP8).
- Cosmetic: `/projects/${slug}` is hand-built without encoding in
  `F/islands/ProjectSidebar.island.tsx:282,401` and `F/components/ProjectCard.tsx:79`. **Status:**
  Open (no prompt).

### 2.3 Kanban and Gantt against `@projective/ui`

| Engine                  | Contract                                                                                                     | Implementation                                                                                                                                                                                                                                                                                                 | Consumers                                                                                     | Verdict                                  | Status                                                                     |
| :---------------------- | :----------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- | :--------------------------------------- | :------------------------------------------------------------------------- |
| `@projective/ui/gantt`  | immediate-mode Canvas2D, accessible DOM sibling, no VDOM work during pan (`DESIGN_SYSTEM.md:2456,3674-3690`) | one `<canvas aria-hidden>` (`Gantt.tsx:982`); HTML header and lane-windowed task list (`components/GanttTaskList.tsx:1-13`); visually hidden focusable list, live region and controls (`Gantt.tsx:1003-1040`); `scrollX` / `scrollY` / `pxPerDay` signals in `core/gantt-store.ts`, painted in a layout effect | `F/islands/ProjectTimeline.island.tsx:13`, `F/components/ticket/tabs/TicketTimelineTab.tsx:2` | ✅                                       | No defect                                                                  |
| `@projective/ui/kanban` | DOM + `@projective/ui/dnd` (`DESIGN_SYSTEM.md:2808-2843`)                                                    | Preact with pointer and keyboard sensors; ARIA `group` / `list` / `listitem` / `button` and an `aria-live` announcer (`KanbanBoard.tsx:349-377`; `KanbanColumn.tsx:112,124`); drag state in signals (`KanbanBoard.tsx:74-77`); **no virtualisation**                                                           | `F/islands/ProjectBoard.island.tsx:18`                                                        | ✅ to its contract · ⚠️ at scale (DL D8) | Ruled → P3: keep the DOM, window after measuring (D8); roadmap (PMBP §0.6) |

No duplicate engine exists. `TicketListView.tsx` is the board's list mode, and
`F/components/ticket/StagePipeline.tsx:3` is a stage-route sortable on `@projective/ui/dnd`, not a
board. The **Global Workload Kanban** (PS:279-288) is not built (DL D15; **Status:** Ruled → P3:
Planned). The PS "Board tab inside every stage" (PS:289-297) is narrowed to pipeline stages by
`CHANNEL_TAB_MATRIX` (Decision #134), a spec divergence that #134 records but PS does not
(**Status:** Open (no prompt); §13).

### 2.4 Islands, hooks and client state

- **Islands are dumb.** No Supabase or `@server` import in `F/islands`, `F/components` or `F/hooks`.
  Client services fetch `/api/*` through `apiFetch` (`F/core/api.ts:2`). The `F/core` files that
  import `@server` (`*-ssr.ts`, the slot resolvers, `task-view-guard.ts`, `respond.ts`) are reached
  by no island. ✅ **Status:** No defect.
- **Hooks.** `useState`: 0. `useEffect`: 57 across 22 islands and 45 in components and hooks, mostly
  mount wiring (popstate, the dev seam, the ticket-surface registry). These are not:
  `F/islands/SubmissionExplorer.island.tsx:547-549,946-951,954-956,976-978` react to signal `.value`
  through dependency arrays and should be `useSignalEffect` or `computed`. ⚠️ **Status:** Fixed
  (PM-WP11, `e30b4111`: "SubmissionExplorer effects on signals").
- **Board moves are optimistic with a full rollback** (`ProjectBoard.island.tsx:648-672`),
  re-checked client-side before the write (`:683-720`). ✅ There is no in-flight guard: a failed
  move restores the whole `before` array and can undo a second move still in flight **(I)**. ⚠️
  **Status:** Fixed (PM-WP7, `3fcf2d54`: moves queue per card and only the refused card is restored;
  = S8).
- **Board view state is not addressable.** View mode, grouping, search, priority and assignee
  filters and sort are signals (`F/core/board-state.ts:20,22`; `ProjectBoard.island.tsx:188-192`).
  ROUTING.md has no board rule; Members `?view=`, Files `?in=` and the wallet's `?q=&dir=` set the
  precedent. ⚠️ (DL D13) **Status:** Ruled → P7 (D13); Open → PM-WP8 (step 2).
- `SubmissionExplorer.island.tsx:972` calls `replaceState(…, location.pathname)` to drop `review=1`
  and drops every other parameter with it, `tkv` included. ⚠️ **Status:** Open → PM-WP8 (step 4).

### 2.5 Design-gate defect log (task and stage views)

| Gate                              | Instances                                                                                                                                                                                                                                                                                                                                                                                                                                      | Verdict | Status                                                                                                                                                                      |
| :-------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.8 headings never ≥ `--fw-bold` | `h2.tkv__title` (`TicketView.tsx:385` → `ticket-view.css:117`); `h3.tkc-pipe__title` (`StagePipeline.tsx:279` → `ticket-pipeline.css:250`); `h3.tkc-insp__title` (`StageInspector.tsx:96` → `ticket-pipeline.css:776`); `TaskChecklistView.tsx:31` h4 (→ `submission-actions.css:325`, `700`); `.tkv-rich h3` (`ticket-view.css:806`). Numeric weights instead of tokens: eight in `board.css` (e.g. `:404`), `submission-actions.css:258,358` | ❌      | Fixed (PM-WP11, `e30b4111`)                                                                                                                                                 |
| §3.2 accessibility                | `TicketCard` sets `tabIndex={0}` on spans inside the card's `role="button"` root (`TicketCard.tsx:59,75,94,115,154`; `StageStatusIcon.tsx:42`): up to six extra tab stops per card, against its own doc (`:14-18`) and `DESIGN_SYSTEM.md:2826-2830`. `BoardColumnHeader.tsx:49` likewise                                                                                                                                                       | ❌      | Fixed (PM-WP11, `e30b4111`: one tab stop per card, `KanbanCard` `aria-describedby`)                                                                                         |
| §3.7 anti-tagification            | the list view's priority pill `.brd-list__prio` (`TicketListView.tsx:61`; `board.css:440-493`) is neither a lifecycle status, a count, a disclosure nor a control. Status pills, the Frozen chip and `MemberBadges` are lifecycle states ✅; `TicketCard` meta is inline middot text ✅                                                                                                                                                        | ❌      | Fixed (PM-WP11, `e30b4111`: the pill became meta text)                                                                                                                      |
| §3 token-only                     | literal radii: `submission-explorer.css:70` (`50px`), `ticket-view.css:395`, `gantt.css:523,530`, `project-showcase.css:111`. Ring shadows: `ticket-view.css:867,1210`. Hard-coded alpha on chips: `board.css:472-493`, `ticket-pipeline.css:360`                                                                                                                                                                                              | ⚠️      | Fixed (PM-WP11, `e30b4111`: tokenised radii, rings, alphas)                                                                                                                 |
| §3 no inline styles               | 28 in `F/` TSX. Direct properties at `ProjectCard.tsx:224`, `ChannelDetailBody.tsx:85`, `GroupSessionPanel.tsx:117`; `z-index` at `TicketView.tsx:345`, `SubmissionReviewModal.tsx:257`, `PreSubmitModal.tsx:129`, `ProjectCreateModal.tsx:438`. The rest set custom properties (`styleVars`), for which `guardrails.md:83` states no exception                                                                                                | ⚠️      | Partly fixed (direct inline styles removed, PM-WP11, `e30b4111`); the `styleVars` half: Open (no prompt) — PMBP §1's standard header allows `packages/ui styleVars()` (§13) |
| §3.9 `backdrop-filter`            | `project-showcase.css:585` applies a literal `blur(8px)` directly, not on a `::before` underlay. `members.css:58` and `message-interactions.css:39` not checked against the pinned-bar exception                                                                                                                                                                                                                                               | ⚠️      | Partly fixed (PM-WP11, `e30b4111`: "no backdrop-filter on the save bar"); the two unchecked sheets Unverified                                                               |
| §3.6 anti-card, solid regions     | board columns are a tint plus one hairline and `.tkt` is transparent (`board.css:202-215`); the Overview is unboxed (`project-dashboard.css:225-252`); kanban columns are solid `--surface-1` (`packages/ui/kanban/styles/kanban.css:30-40`)                                                                                                                                                                                                   | ✅      | No defect                                                                                                                                                                   |
| §3.11 a control does something    | Delete Submission, Upload Files and Submit without a draft (§3.2)                                                                                                                                                                                                                                                                                                                                                                              | ❌      | Partly fixed (Submit, Add Files; P0 pass, `660c9658`); Delete Submission withdrawn: Open (no prompt)                                                                        |

Out of the task-view scope but seen: literal durations in `project-setup.css:1145` and the chat
sheets (`chat-feed.css:85`, `chat-composer.css:422`, `channel-header.css:115`). **Status:** Open (no
prompt).

---

## 3. Submissions tree route — verification

### 3.1 Route, resolution and access

| Check                                           | Finding                                                                                                                                                                                                                                                                                                                   | Verdict                   | Status                                   |
| :---------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------ | :--------------------------------------- |
| One parser                                      | The project route uses `pathSegmentsAfter(ctx.url, 3)`, which decodes each segment (`F/core/explorer-header-slot.tsx:21-29`; `R/[projectSlug]/submissions/[...path].tsx:23`). The room route uses `ctx.params.path.split("/")` (`R/[projectSlug]/[channelId]/submissions/[...path].tsx:20`)                               | ⚠️ two parsers            | Open → PM-WP9 (step 6)                   |
| Zod at the trust boundary (root `CLAUDE.md` §2) | the raw path reaches `ProjectBackendService.submissions` through `F/core/submissions-ssr.ts:21-33` without `SubmissionListParamsSchema` (12 segments × 120 chars, `types/submissions.ts:207-212`)                                                                                                                         | ⚠️                        | Open → PM-WP9 (step 6)                   |
| Server resolution                               | `fetchSubmissionPage` (`svc/live-submissions.ts:1301`) builds the tree from RLS-filtered reads; `resolveChain` (`:608`) walks the segments; an unknown trailing segment shortens the path rather than 404ing (`live-submissions.test.ts:410-413`)                                                                         | ✅ · ⚠️ silent truncation | Open → PM-WP9 (step 5)                   |
| Access                                          | prospects are stopped by `[projectSlug]/_middleware.ts:24-49`; a project the viewer cannot see resolves to null and 404s; a non-reviewer is narrowed by `.eq("submitted_by")` inside the query (`resolveIsolation`, `:763`); reviewers see other people's unsent drafts, which the code marks as an open product decision | ✅ · DL D10               | Ruled → P5 (d) (D10); Open → PM-WP9      |
| Type guard                                      | none: a Session's tree resolves although its lane hides Submissions                                                                                                                                                                                                                                                       | ⚠️                        | Open → PM-WP8 (the 303), PM-WP9 (step 6) |
| Addressing                                      | uuid segments (§2.2)                                                                                                                                                                                                                                                                                                      | ❌                        | Ruled → P7 (D14); Open → PM-WP9          |

### 3.2 Review actions

| Action                      | Control                                 | Endpoint                                                         | Server door                                                                                                        | Verdict                                                                                                                                                                        | Status                                                                                               |
| :-------------------------- | :-------------------------------------- | :--------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| Accept                      | `SubmissionExplorer.island.tsx:622-648` | `POST /api/projects/:id/stages/:stageId/submissions/:sid/review` | `review_submission` accept → `fn_settle_ticket_stage` → Chain Reaction                                             | ✅ not optimistic; one confirmation (PS:60-61)                                                                                                                                 | No defect                                                                                            |
| Request revision            | same                                    | same                                                             | `review_submission` request_revision; free rounds counted under the stage lock; PR402 past the allotment (PM §3.7) | ✅                                                                                                                                                                             | No defect                                                                                            |
| Paid revision               | `:665`                                  | `…/paid-revision`, then `…/paid-revision/fund`                   | `request_paid_revision`; `fund_paid_revision` or card (#199)                                                       | ✅                                                                                                                                                                             | No defect                                                                                            |
| Approve stage               | `:736`                                  | `…/stages/:stageId/approve`                                      | `approve_stage` (F1150:1518-1715): review authority + `hire`, stage row lock, unclaimed prepaid refunded (#213)    | ✅                                                                                                                                                                             | No defect (its stale-status side effect is S3)                                                       |
| End stage (Fair Exit)       | `FairExitDialog.tsx:73,95`              | `…/fair-exit` (preview), `…/cancel`                              | `preview_stage_fair_exit` / `cancel_stage_fair_exit`                                                               | ✅ door · ⚠️ tier semantics (DL D2)                                                                                                                                            | Ruled → P1 (D2); Open → PM-WP4a                                                                      |
| Reject                      | —                                       | —                                                                | the verdict set is `accept · request_revision` (`types/settlement.ts:38,50`)                                       | — matches PS:59-60, which has no reject                                                                                                                                        | No defect                                                                                            |
| **Delete submission**       | `SubmissionActionBar.tsx:160-169`       | **none**                                                         | —                                                                                                                  | ❌ for a server-side draft it navigates to the parent and calls nothing (`SubmissionExplorer.island.tsx:828-836`), though its comment says "removal persists with the backend" | Withdrawn (P0 pass, `660c9658`) until D4; D4 Ruled → P2 (b); no prompt restores it: Open (no prompt) |
| **Upload files**            | `UploadFilesModal.tsx:46-55`            | **none**                                                         | —                                                                                                                  | ❌ a `role="button"` drop zone with no input behind it (self-described stub)                                                                                                   | Fixed (P0 pass, `660c9658`: **Add Files**, the shared `AssetPicker` with its device Upload source)   |
| **Submit (no local draft)** | `SubmissionExplorer.island.tsx:865-867` | **none**                                                         | —                                                                                                                  | ❌ flips the status to `pending_review` locally with no API call: the surface shows a delivery as sent that was never sent                                                     | Fixed (P0 pass, `660c9658`: sends the reopened server draft by its id)                               |

Two integrity notes behind the explorer:

- A **draft** is a direct insert followed by a separate file-link insert (LW:2851-2873), so a
  failure between them leaves a draft with no files. ⚠️ **Status:** Open → PM-WP9 (step 4, through
  `projects.apply_write_batch`).
- The "Insert own submissions" policy (P2011:316-325) constrains neither `status` nor the ticket ↔
  stage ↔ submitter pairing, so a submitter can insert a row already `accepted`, or one naming
  another ticket **(I)**. It moves no money (release keys on the ticket reaching `completed`), but
  the explorer offers Approve Stage once a unit reads `accepted` (`flows/Projects.md` §7.3) and the
  row is evidence. ❌ Fix: tighten the policy to `draft · pending_review` and a consistent ticket ↔
  stage ↔ submitter triple (backlog 8). **Status:** Open → PM-WP9 (step 2).

---

## 4. Backend services and execution rules

### 4.1 Ownership

| Operation             | Service method                                 | Database door                                                               |
| :-------------------- | :--------------------------------------------- | :-------------------------------------------------------------------------- |
| create                | `create` (PBS:3435)                            | `create_project` (LW `insertProject`)                                       |
| setup read / update   | `setup` (PBS:2674), `updateProject` (PBS:2803) | LW `applyProjectUpdate`                                                     |
| instantiate a listing | `instantiateService` (PBS:3519)                | `marketplace.instantiate_service_blueprint` (`svc/live-instantiate.ts:196`) |
| commit a ticket       | `commitTicket` (PBS:2928)                      | LW:2421                                                                     |
| move                  | `moveTicket` (PBS:3015)                        | `move_ticket` (LW:2519)                                                     |
| claim                 | `claimTicket` (PBS:3067)                       | `claim_ticket` (`svc/live-claim.ts:82`)                                     |
| submit                | `createSubmission` (PBS:3177)                  | `submit_deliverable` / `send_submission_draft` (LW:2799)                    |
| review                | `reviewSubmission` (PBS:3245)                  | `review_submission`                                                         |
| paid revision         | `requestPaidRevision` (PBS:3286)               | `request_paid_revision`; funding through `RevisionPurchaseBackendService`   |
| approve stage         | `approveStage` (PBS:3314)                      | `approve_stage`                                                             |
| Fair Exit             | PBS:3361 / PBS:3387                            | `preview_stage_fair_exit` / `cancel_stage_fair_exit`                        |
| remove member         | `removeMember` (PBS:1598)                      | `remove_project_member` (`svc/live-invites.ts:454`)                         |
| create stage          | `createStage` (PBS:2037)                       | `create_stage`                                                              |
| timeline              | `timeline` (PBS:1389)                          | derived from the board read                                                 |

- **Thin routes.** Every handler read (claim, move, board ticket, `[id]`, create,
  submissions/create, stage cancel and fair-exit, paid-revision fund) checks the session, validates
  with Zod and delegates. No route does business logic or money math. ✅ **Status:** No defect.
- **`ServiceResult<T>` (Decision #10)** everywhere except `hireCooldowns`, which returns
  `Promise<Record<string, string>>` (PBS:1756). ⚠️ minor **Status:** Fixed (PM-WP7, `3fcf2d54`).
- **Money math is in SQL.** `svc/live-settlement.ts` maps and clamps (`cents()`, `:172`). The ticket
  rate is chosen in TS (LW:2376-2405) and $W_i$ is computed in TS (X4/X5). ⚠️ **Status:** $W_i$:
  Ruled → P4 (difficulty alone; the cleanup is PM-WP5a step 1) · the rate: Ruled → P6; Open → PM-P6.
- **Multi-statement writes from TS, no transaction.** `commitTicketRow` writes the row, then calls
  `move_ticket` separately, so a refused move leaves the row written (LW:2480-2509).
  `applyProjectUpdate` runs up to seven writes in order — project, status, visibility, attachments,
  stage reconcile (`delete_stage` / `reorder_stages`), roles, `sanitize_single_room_topology`
  (LW:2025-2117) — and a failure part-way commits part of the save. LW:1715-1718 already names the
  fix: "one RPC doing the whole reconciliation in a single transaction." ⚠️ **Status:** Fixed
  (PM-WP7, `3fcf2d54`: `projects.apply_write_batch`; = S7).
- **No optimistic concurrency.** No `updated_at` or version check on any write; a move sends only
  the target status, so a stale drag is last-writer-wins inside the database's authority rules. ⚠️
  **Status:** Partly fixed (moves carry `p_expected_updated_at` → `PS409`; PM-WP7, `3fcf2d54`; =
  S8); other writes: Open (no prompt).
- **Stub parity.** The stub claim skips capacity, project access and Ready status (PBS:3093-3110);
  the stub move skips the client drag lock (PBS:3050); the stub `commitTicket` skips the
  claimed-terms lock (PBS:2963-3010). `deno task dev:mock` therefore demonstrates rules the product
  does not hold. ⚠️ **Status:** Fixed (PM-WP7, `3fcf2d54`; = S9).
- `svc/live-board.ts:181` cites `projects.fn_check_workload_capacity`, which does not exist (the
  function is `check_ticket_capacity`). **Status:** Fixed (PM-WP10, `4c9482a2`).

---

## 5. Database and functions

### 5.1 Constraint gaps on the five audited tables

| Table                        | Gap                                                                                                                                                                                                                                            | Source                        | Status                                                                                                                                                                                             |
| :--------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects.projects`          | no CHECK pairs `format` with `structure_variation`                                                                                                                                                                                             | T15:174-212                   | Fixed (PM-WP3, `3fcf2d54`)                                                                                                                                                                         |
| `projects.project_stages`    | no CREATE category column; `sort_order` not unique per project; `start_trigger_type = 'dependent_on_stage'` does not require `start_dependency_stage_id` (= C6); the dependency may name another project's stage (= C2, §10)                   | T15:216-391; `00004003`       | category: Ruled → P4 (🧑 the label, PMBP §0.5 #1) · `sort_order`: Fixed (PM-WP3, `3fcf2d54`) · C6, C2: Open → PM-D7a                                                                               |
| `projects.tickets`           | `workload_intensity` and `unit_price_cents` have no CHECK (the stage price has one, `flows/Projects.md` §4.5); `current_stage_id` and `required_stages` are not tied to the ticket's project; `workload_report_id` has no FK; no `archived_at` | T15:393-475                   | CHECKs and the FK: Fixed (PM-WP3, `3fcf2d54`; FK in trailing `00000034`) · `required_stages`: Open → PM-D7a · `current_stage_id`: Open (no prompt) · `archived_at`: Ruled → P2 (b); Open → PM-WP4b |
| `projects.stage_assignments` | `status text NOT NULL` with no CHECK, though the shape lock (X8) reads it                                                                                                                                                                      | T15:548-565                   | Fixed (PM-WP2, `3fcf2d54`: `ck_stage_assignments_status`)                                                                                                                                          |
| `projects.stage_submissions` | `status` is nullable; no UNIQUE on (`project_stage_id`, `number`)                                                                                                                                                                              | T15:568-593; `00004003:17-18` | Fixed (PM-WP3, `3fcf2d54`: NOT NULL; `stage_submissions_stage_number_key`)                                                                                                                         |

Fix (backlog 10): CHECKs `workload_intensity > 0`, `tickets.unit_price_cents ≥ 0`,
`stage_assignments.status`, `stage_submissions.status NOT NULL`, UNIQUE (`project_stage_id`,
`number`), format × structure.

### 5.2 $W_i$ enforcement

See X4–X6. The cap check is sound in shape and wrong in three details: it counts no category weight,
it releases a reporter's capacity while they still hold the ticket, and it is unlocked across a
user's other tickets. Only `check_ticket_capacity` is called by `fn_assign_ticket_core`; no trigger
calls it, so a direct write (X12) bypasses it. **Status:** the lock and the reporter: Fixed (PM-WP2,
`3fcf2d54`) · the category weight: Ruled → P4 (none) · the direct-write bypass closed with X12
(`660c9658`).

### 5.3 Direct-write paths under RLS

`authenticated` holds `GRANT ALL` on every `projects` table (`00002500:121`), so RLS is the only
gate.

| Policy                                            | What it allows beyond the RPC doors                                                                                                | Source                   | Status                                                                                                                           |
| :------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------- | :----------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| "Manage tickets" FOR ALL                          | X12: assigning or re-statusing an unclaimed ticket, past every assignment check                                                    | P2011:355-376; F1110:281 | X12 Fixed (`660c9658`); the policy's DELETE and the 100 % removal payout on a direct assignee clear: Open → PM-WP4b (steps 3, 6) |
| "Users can manage stages of own projects" FOR ALL | writing any stage `status`, price (X9), dependency, `chain_reaction`; hard DELETE                                                  | P2011:282-284            | price Fixed (X9, `660c9658`) · status: Open → PM-S3 · dependency: Open → PM-D7a · DELETE: Ruled → P2 (b); Open → PM-WP4b         |
| "Owner manage assignments" FOR ALL                | inserting a seat for any freelancer without consent; flipping or deleting one, which lifts the shape lock (X8)                     | P2011:47-56              | flip and delete: Fixed (PM-WP2, `3fcf2d54`) · the seat without consent: Open (no prompt)                                         |
| "Insert own submissions"                          | an `accepted` or NULL status; another ticket's id (§3.2)                                                                           | P2011:316-325            | Open → PM-WP9                                                                                                                    |
| "Users can insert their own activity"             | forging another project's feed (`project_activity.project_id` has no FK) — already open in `database/projects/Policies.md:469-471` | P2011:41-44              | Open (no prompt)                                                                                                                 |
| "Users can delete own projects"                   | a hard DELETE of the project row (DL D4)                                                                                           | P2011:175                | Ruled → P2 (b); Open → PM-WP4b                                                                                                   |

Category placement: the `files.*` policies are defined in the projects policy file (P2011), against
root `CLAUDE.md` §1 ("each statement in its category file"). **Status:** Open (no prompt).

### 5.4 Docs ↔ SQL drift

- **Undocumented SQL functions** (by bare name, absent from `database/projects/Functions.md`):
  `complete_lesson`, `fn_cohort_seats_taken`, `fn_confirm_seat`, `fn_session_param`,
  `get_cohort_offer`, `record_host_attendance`, `session_join_link`. `fn_is_session_host` and
  `fn_session_presence` appear only in `database/finance/Functions.md`; `record_presence` only in
  `Policies.md`. **Status:** Open → PM-Z1.
- **Documented but missing:** none. **Status:** No defect.
- **Tables.md:** it says no RPC writes `stage_submissions.revision_of`, but `fn_enter_review` does
  (F1150:205-211); it says `fn_stage_delete_cascade` nulls dependent stages (Tables.md:237-239), but
  the trigger does not (= C4, §10); its tickets introduction says lifecycle columns are "written
  only by SECURITY DEFINER RPCs", which §5.3 contradicts. **Status:** `revision_of` and the "only
  RPCs" sentence: Open → PM-Z1 · the cascade: the statement became true with PM-WP3 (`3fcf2d54`,
  C4).
- **PM:490** stores a refund as `payment_status = 'refunded'`; a refund writes `unpaid` (F1200, the
  `fn_refund_ticket_escrow` reset). The value is never written (= S13). **Status:** Ruled → P2 (c):
  write it; Open → PM-WP4b (step 5).

### 5.5 Zod SSOT drift (`SYSTEM_ARCHITECTURE.md`: 1:1, zero drift)

- No row schemas for `project_stages`, `tickets`, `stage_submissions` or `stage_assignments`: Zod
  holds view models only, and `ProjectMemberRowSchema` is the one row schema in the domain. ❌
  **Status:** Fixed (PM-WP10, `4c9482a2`, with `projects-tables.contract.test.ts`).
- `ProjectStatus` lacks `archived` (`types/summary.ts:31` vs `00000003:26`). ❌ **Status:** Fixed
  (PM-WP10, `4c9482a2`).
- No `stage_status` enum. ❌ **Status:** Fixed (PM-WP10, `4c9482a2`: `StageStatus`).
- `TicketIntensity` is an enum; the column is numeric. Zod requires `workload ≥ 0` and
  `unitPriceCents ≥ 0` where SQL has no CHECK. ⚠️ **Status:** Fixed (PM-WP10 numeric intensity,
  `4c9482a2`; the CHECKs, PM-WP3, `3fcf2d54`).
- `SubmissionStatus` speaks `revision_requested` for the stored `revisions_requested` through one
  mapper; PM §3.7 documents the choice. ✅ **Status:** No defect.
- 1:1: `TicketStatus`, `ProjectFormat`, `ProjectStructure`, `StageAssignmentMode`. ✅ **Status:** No
  defect.

---

## 6. Test coverage

| Area                   | Automated (TS, `deno task test`)                                                                                                                                            | SQL behaviour                                                                                      |
| :--------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| Claim                  | `svc/claim.test.ts`: refusal wording, stub happy path, needs-funding, not-open-pull, anonymous. No capacity case; the live path is not executed                             | probes only                                                                                        |
| Settlement / Fair Exit | `svc/live-settlement.test.ts`: mappers, notice text, a contract test that the TS keys appear in the migration text, grants; `F/core/fair-exit-model.test.ts`: UI tier logic | `supabase/probes/fair_exit_settlement.sql`, `chain_reaction.sql`, `escrow_release_concurrency.sql` |
| Funding / visibility   | `board-funding.test.ts` (svc and types): provider visibility, paid/unpaid flips, the drag-lock helper (which the stub move never calls)                                     | —                                                                                                  |
| Writes and locks       | `svc/live-writes.test.ts`: stage, role and attachment reconcile; onboarding lock refusals (`:316-346`)                                                                      | `ticket_terms_payee_lock.sql`, `ticket_move_authority.sql`                                         |
| Identity               | `svc/project-identity.test.ts`                                                                                                                                              | —                                                                                                  |
| Submissions            | `svc/live-submissions.test.ts`: tree shape, isolation in the query, reviewer membership failing closed                                                                      | —                                                                                                  |
| Workload report        | —                                                                                                                                                                           | `workload_report_suspension.sql`                                                                   |

**Gap.** Every money and state rule in SQL is verified only by the manual psql probes in
`supabase/probes/`, which `deno task test` does not run (`deno.json:80,91`). A regression in
`fn_ticket_escrow_sync`, `force_complete_stage` or `fn_fair_exit_split` reaches `main` unseen. Fix
(backlog 17): run `supabase/probes/*.sql` in CI against a reset database. **Status:** Partly fixed
(PM-WP13, `f9c4fc31`: `deno task test:probes` / `test:probes:fresh`; no CI exists, so the gate is
documented in `SYSTEM_ARCHITECTURE.md` §Testing Protocols and the PR checklist); the claim capacity
case: Unverified.

---

## 7. Probes for the (I) findings

Run each inside `BEGIN … ROLLBACK` against a reset local database (the memory note in
`projective-dev-server-gotchas` has the `docker exec … psql` recipe and the
`SET LOCAL ROLE
authenticated` + `request.jwt.claims` order).

| Finding                 | Probe                                                                                                                                 | Status                                              |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------- |
| X3 seat-less claim      | as a freelancer seated on stage A only, `claim_ticket` a funded `todo` ticket on stage B; expect success today, refusal after the fix | Fixed (`claim_seat_and_price_lock.sql`, `660c9658`) |
| X4 concurrent capacity  | two sessions, one user, two tickets whose sum exceeds the global cap; claim both inside overlapping transactions                      | Fixed (PM-WP2, `3fcf2d54`)                          |
| X7 sweep race           | claim, backdate `claimed_at`, start the ticket in session 1 without committing, run `fn_release_expired_claims` in session 2          | Open → PM-WP1 (step 1, `claim_ttl_sweep_race.sql`)  |
| X8 shape-lock lift      | as the owner of a staffed project, `UPDATE stage_assignments SET status='declined'`, then change `format`                             | Fixed (PM-WP2, `3fcf2d54`)                          |
| X12 direct claim        | as the owner, PATCH an unclaimed funded ticket to `current_assignee_id = <minor or unpayable user>, status = 'claimed'`               | Fixed (`660c9658`)                                  |
| §3.2 forged acceptance  | as an assignee, INSERT a `stage_submissions` row with `status = 'accepted'`                                                           | Open → PM-WP9 (step 1)                              |
| §2.2 projectId mismatch | `POST /api/projects/ticket/move` with a valid ticket and another project's slug                                                       | Unverified (no prompt)                              |
| §2.4 move rollback race | two quick drags, the first refused by the server                                                                                      | Fixed (PM-WP7, `3fcf2d54`; S8)                      |

---

## 8. Remediation map

The audit's prioritised backlog (items 1–18, numbers kept; PMBP cites them) and the decision log's
items that no backlog line carried. Fix text lives in the finding rows.

| #  | ID(s)                                                                                      | Priority        | Prompt                                           | Status                                                                                   |
| :- | :----------------------------------------------------------------------------------------- | :-------------- | :----------------------------------------------- | :--------------------------------------------------------------------------------------- |
| 1  | X7, S1, S2, D1                                                                             | P0              | PM-WP1                                           | Partly fixed (row paused, `e18489d4`); Open → PM-WP1                                     |
| 2  | X3                                                                                         | P0              | ruling-free P0 pass                              | Fixed (`660c9658`)                                                                       |
| 3  | X12, S12                                                                                   | P0              | ruling-free P0 pass                              | Fixed (`660c9658`)                                                                       |
| 4  | X9; X8; `assign_ticket_manual` seat check                                                  | P0              | P0 pass; PM-WP2                                  | Fixed (`660c9658`; `3fcf2d54`)                                                           |
| 5  | §3.2 (Submit, Add Files, Delete Submission)                                                | P0              | P0 pass                                          | Partly fixed (Submit, Add Files; `660c9658`); Delete Submission: Open (no prompt)        |
| 6  | §1.2, §2.1, D11                                                                            | P1              | PM-WP8                                           | Open → PM-WP8                                                                            |
| 7  | §2.2 Copy link, #338 (m)                                                                   | P1              | PM-WP8                                           | Open → PM-WP8                                                                            |
| 8  | §3.2 integrity, §5.3 "Insert own submissions"                                              | P1              | PM-WP9                                           | Open → PM-WP9                                                                            |
| 9  | X16, S5                                                                                    | P1              | PM-WP4b                                          | Open → PM-WP4b                                                                           |
| 10 | §5.1, X4, F1                                                                               | P1              | PM-WP3 (+ PM-WP2 for `stage_assignments.status`) | Fixed (`3fcf2d54`)                                                                       |
| 11 | X4, W7                                                                                     | P1              | PM-WP2                                           | Fixed (`3fcf2d54`)                                                                       |
| 12 | §5.5, X19 (the enum)                                                                       | P1              | PM-WP10                                          | Fixed (`4c9482a2`)                                                                       |
| 13 | X6, D6; X18, §11, D5                                                                       | P1              | — (roadmap); PM-WP5a                             | Routing: Ruled → P3: Planned · reporting: Open → PM-WP5a                                 |
| 14 | §2.5                                                                                       | P2              | PM-WP11                                          | Partly fixed (`e30b4111`; `styleVars`, two sheets and the out-of-scope durations remain) |
| 15 | §2.4 (board URL, D13; the `tkv` strip; effects), §3.1 (one parser, Zod)                    | P2              | PM-WP8; PM-WP9; PM-WP11                          | Effects Fixed (`e30b4111`); the rest Open → PM-WP8, PM-WP9                               |
| 16 | S3, X19; S7                                                                                | P2              | PM-S3; PM-WP7                                    | S7 Fixed (`3fcf2d54`); S3 Open → PM-S3                                                   |
| 17 | §6                                                                                         | P2              | PM-WP13                                          | Partly fixed (`f9c4fc31`; no CI exists)                                                  |
| 18 | §5.4                                                                                       | P2              | PM-Z1; PM-WP4b (PM:490 = S13)                    | Open → PM-Z1, PM-WP4b                                                                    |
| —  | C1, C2, C5, C6, S11 (route half), X13                                                      | not ranked (DL) | PM-D7a                                           | Open → PM-D7a (🧑 #344 (d))                                                              |
| —  | C3, D7                                                                                     | not ranked (DL) | PM-D7b                                           | Open → PM-D7b (🧑 PMBP §0.5 #7)                                                          |
| —  | X14, D2, D3 (the ticket-level door), D16-c                                                 | not ranked (DL) | PM-WP4a                                          | Open → PM-WP4a (🧑 PMBP §0.5 #3)                                                         |
| —  | X15, D3, D4, S13                                                                           | not ranked (DL) | PM-WP4b                                          | Open → PM-WP4b                                                                           |
| —  | S11 (price half), #338 (k)                                                                 | not ranked (DL) | PM-P6                                            | Open → PM-P6 (🧑 #344 (e))                                                               |
| —  | ghosting (FCA N16 = FDD X16, D-9 (a); §12.3)                                               | P1 (FCA N16)    | PM-GH1                                           | Open → PM-GH1                                                                            |
| —  | W1–W6, W10, S10                                                                            | not ranked (DL) | PM-WP5a                                          | Open → PM-WP5a (🧑 PMBP §0.5 #5)                                                         |
| —  | X5, D9, W9 (ruling P4)                                                                     | not ranked (DL) | PM-WP5a step 1; PM-WP5b                          | Open → PM-WP5b (🧑 PMBP §0.5 #1, #6)                                                     |
| —  | X11, D12, D16-b                                                                            | not ranked (DL) | PM-WP6                                           | Open → PM-WP6 (🧑 PMBP §0.5 #8)                                                          |
| —  | D10, D14                                                                                   | not ranked (DL) | PM-WP9                                           | Open → PM-WP9                                                                            |
| —  | D8, D15, D6                                                                                | not ranked (DL) | — (PMBP §0.6 roadmap)                            | Ruled → P3 (keep DOM; Planned; Planned)                                                  |
| —  | W8                                                                                         | not ranked (DL) | — (PMBP §0.6 follow-up)                          | Open (no prompt)                                                                         |
| —  | the projects docs sweep; both audits' status columns; #338's flags marked Resolved or Open | —               | PM-Z1                                            | Open → PM-Z1                                                                             |

---

## 9. Ticket state synchronisation gaps (was DL §1)

A ticket's truth is spread over five records that must agree: `tickets.status` and its assignee, the
stage it sits in, its submissions, its escrows and its workload report. PM §3.4 asks that a parent's
status be **derived**, never stored authoritatively. The gaps below are the places where two of
those records can disagree. Where a gap restates a §1–§5 finding, the row names it and keeps only
what that finding lacks (what a user sees, the recommendation).

| #   | Gap                                                                                                                                                                                                                  | Where                                       | What a user sees                                                                                                                                        | Recommendation                                                                                                                                                              | Status                                                                                |
| :-- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| S1  | **The claim TTL never fires** (= X7)                                                                                                                                                                                 | X7                                          | A parked claim holds the client's money and the freelancer's $W_i$ indefinitely. PM §3.6's "Funded → Refunded on TTL" edge does not exist in production | D1                                                                                                                                                                          | Partly fixed (row paused, `e18489d4`); Open → PM-WP1                                  |
| S2  | **The sweep can reset started work.** No row lock and no `status = 'claimed'` re-check on its UPDATE                                                                                                                 | F1140:663-676                               | **(I)** a ticket started between the sweep's SELECT and UPDATE has its escrow refunded and is thrown back to `backlog` while the freelancer works       | `SELECT … FOR UPDATE SKIP LOCKED` and `AND status = 'claimed'` on the UPDATE; a `ticket_history` `claim_expired` row; notify both sides                                     | Open → PM-WP1 (steps 1-4)                                                             |
| S3  | **Stage status is stored, not derived, and goes stale** (= X19). Beyond X19: a stage reaches `paid` while unfunded or backlog tickets stay open on it (`approve_stage` settles only tickets holding escrow)          | F1150:912,1225,1633; P2011:282-284          | stage badges that disagree with the board under them                                                                                                    | derive a stage's display status from its tickets (PM §3.4's rule), keep the stored column for the money doors only, and take direct writes of it away from the table policy | Open → PM-S3                                                                          |
| S4  | **Submissions are orphaned.** Nothing closes a `pending_review` submission when its ticket leaves review through `move_ticket` or `complete_ticket`; the placeholder trigger skips when a pending one exists         | F1120:261-326                               | a stale "awaiting review" in the explorer and in `get_project_card_summary.pending_submissions`                                                         | close the open submission (`superseded`, or the existing `revisions_requested`) in the same trigger that files the placeholder                                              | Fixed (PM-WP7, `3fcf2d54`)                                                            |
| S5  | **`delete_stage` leaves work without a stage**, and rolls its releases back when escrow history exists (= X16)                                                                                                       | F1130:395-445                               | a ticket `in_progress` with no stage; a delete that silently does nothing                                                                               | refuse first, release second; move orphaned tickets to `backlog` with their escrow settled                                                                                  | Open → PM-WP4b (step 4)                                                               |
| S6  | **The Task invariant holds at insert only** (= F2)                                                                                                                                                                   | TR1850:61-69                                | a Task that converted from a pipeline still lists several tickets                                                                                       | re-run `fn_enforce_structure_variation` on `UPDATE OF structure_variation`, and refuse the switch while it would break                                                      | Fixed (PM-WP3, `3fcf2d54`)                                                            |
| S7  | **Partial commits from TS** (= §4.1 multi-statement writes)                                                                                                                                                          | LW:2025-2117, 2480-2509                     | "Saved" over a half-applied form                                                                                                                        | one transactional RPC per save, as LW:1715-1718 already proposes                                                                                                            | Fixed (PM-WP7, `3fcf2d54`)                                                            |
| S8  | **Last writer wins** on moves; the board's rollback can undo a second in-flight move (= §4.1, §2.4)                                                                                                                  | PBS:3015; `ProjectBoard.island.tsx:648-672` | a card that jumps back after a refused drag elsewhere                                                                                                   | send `updated_at` with each move and refuse a stale one (409); queue moves per card in the island                                                                           | Fixed (PM-WP7, `3fcf2d54`)                                                            |
| S9  | **Stub ≠ live** for claim, move and ticket commit (= §4.1 stub parity)                                                                                                                                               | PBS:2963-3110                               | `dev:mock` demos rules the product does not hold                                                                                                        | route the stub through the same pure predicates the SQL mirrors (`isSelfClaimable`, `ticketWorkLocked`)                                                                     | Fixed (PM-WP7, `3fcf2d54`)                                                            |
| S10 | **A suspension can outlive its report.** With no expiry sweep a ticket stays `reported_hidden` past `hidden_until`; the client can lift it by a move that skips `fn_resume_reported_ticket` (#293 (e); = W6 in part) | F1110:258-266                               | a ticket nobody can work                                                                                                                                | D5                                                                                                                                                                          | Open → PM-WP5a (steps 3e, 3g)                                                         |
| S11 | **The chain reads unvalidated jsonb.** `required_stages` may name another project's stage; a ticket price overrides every stage price in its chain (= X13)                                                           | F1130:644-768; F1200:384                    | **(I)** a hold priced or placed against the wrong stage                                                                                                 | validate `required_stages` on write (ids in the project, unique orders); decide whether a ticket price is per stage or per ticket (D2's sibling, logged as flag (k))        | Validation: Open → PM-D7a · price: Ruled → P6 (per stage); Open → PM-P6 (🧑 #344 (e)) |
| S12 | **Direct-table claim** (= X12)                                                                                                                                                                                       | F1110:281                                   | an assignee who never passed the capacity, age or payout gates                                                                                          | the guard sends assignee changes on unclaimed tickets through `fn_assign_ticket_core`                                                                                       | Fixed (P0 pass, `660c9658`)                                                           |
| S13 | **`payment_status = 'refunded'` is documented, never written** (= §5.4 PM:490)                                                                                                                                       | PM:490; F1200 refund path                   | —                                                                                                                                                       | correct PM, or write it; the funding state reads it either way                                                                                                              | Ruled → P2 (c): write it; Open → PM-WP4b (step 5)                                     |

---

## 10. Circular stage dependencies (was DL §2)

**What exists.** A stage has one `start_dependency_stage_id` (self-FK, NO ACTION) with
`start_dependency_lag_days`, a `start_trigger_type` (including `dependent_on_stage`) and a
`parallel` flag (T15:268,296-300,385). Separately, each ticket carries its own route through stages
as `required_stages` jsonb `[{stage_id, order}]`.

| #  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                         | Source                                      | Status                                                      |
| :- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------ | :---------------------------------------------------------- |
| C1 | **No cycle prevention in the database.** Only a self-loop is refused, in TS (`validateUpdate`, LW:1731-1737), and the setup form's Zod `wouldCycle` (`types/setup.ts:386`) covers the form alone. A → B → A is storable through the `create_project` payload, a direct UPDATE under the stages FOR ALL policy, or two separate saves. `database/projects/Tables.md:996-998` admits it                                           | LW; P2011:282-284                           | Open → PM-D7a                                               |
| C2 | **Cross-project dependencies.** `create_stage` checks that the dependency is a stage of the same project, and says why — the FK names the table, not the project, and the reference discloses that the foreign stage exists (F1130:271-282). `create_project`'s second pass does not check the target (F1100:430-436), and neither does a direct UPDATE                                                                         | F1130; F1100                                | Open → PM-D7a                                               |
| C3 | **Dependencies drive nothing.** No function reads `dependent_on_stage` or the dependency: no stage ever starts because its predecessor finished. The Timeline draws them as links only (`types/timeline.ts:260-277`). A cycle today renders as crossed arrows and breaks no scheduler — but the setup form collects a dependency and a delay per stage (PS:2325) that do nothing, the gate §3.11 failure at configuration scale | grep of all migrations; `flows/Projects.md` | Ruled → P3: build the engine (D7 (A)); Open → PM-D7b        |
| C4 | **`fn_stage_delete_cascade` does not null dependants**, though Tables.md:237-239 says it does, so a direct DELETE of a depended-on stage fails on the FK. The `delete_stage` RPC and `sanitize_single_room_topology` null them themselves                                                                                                                                                                                       | F1130:86-111, 424-427, 556-557              | Fixed (PM-WP3, `3fcf2d54`: the cascade detaches dependants) |
| C5 | **The ticket's own route is unvalidated.** `required_stages` is not checked for project membership or duplicate orders, and the Chain Reaction follows it (S11)                                                                                                                                                                                                                                                                 | T15:436; F1130:644-768                      | Open → PM-D7a                                               |
| C6 | `start_trigger_type = 'dependent_on_stage'` does not require a dependency id; no CHECK pairs them                                                                                                                                                                                                                                                                                                                               | T15:296-300                                 | Open → PM-D7a (🧑 the null predecessor, #344 (d))           |

**Recommendation (ready to implement once D7 is ruled).** One guard trigger in `00001130` with its
`CREATE TRIGGER` in `00001850`, plus a CHECK folded into T15 — edit in place, no `ALTER` patch:

```sql
-- 00000015: folded into project_stages
CONSTRAINT ck_project_stages_dependency_trigger CHECK (
    start_trigger_type <> 'dependent_on_stage'::start_trigger_type
    OR start_dependency_stage_id IS NOT NULL
)

-- 00001130
CREATE OR REPLACE FUNCTION projects.fn_guard_stage_dependency()
RETURNS trigger AS $$
BEGIN
    IF NEW.start_dependency_stage_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM projects.project_stages ps
        WHERE ps.id = NEW.start_dependency_stage_id AND ps.project_id = NEW.project_id
    ) THEN
        RAISE EXCEPTION 'That stage is not part of this project.' USING ERRCODE = 'check_violation';
    END IF;
    -- UNION (not UNION ALL) terminates even over a cycle already stored.
    IF EXISTS (
        WITH RECURSIVE upstream(id) AS (
            SELECT NEW.start_dependency_stage_id
            UNION
            SELECT ps.start_dependency_stage_id
            FROM projects.project_stages ps JOIN upstream u ON ps.id = u.id
            WHERE ps.start_dependency_stage_id IS NOT NULL
        )
        SELECT 1 FROM upstream WHERE id = NEW.id
    ) THEN
        RAISE EXCEPTION 'A stage cannot wait for itself, directly or through another stage.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, projects;

-- 00001850
CREATE OR REPLACE TRIGGER trg_guard_stage_dependency
    BEFORE INSERT OR UPDATE OF start_dependency_stage_id, project_id ON projects.project_stages
    FOR EACH ROW EXECUTE FUNCTION projects.fn_guard_stage_dependency();
```

The same pass validates `required_stages` (C5) and makes `fn_stage_delete_cascade` null dependants
(C4). The change is a schema change: `database/projects/Tables.md`, `Functions.md` and the Zod
`wouldCycle` error key land with it (root `CLAUDE.md` §1).

**Ruled:** P3 (Decision #338, flag (g)) — the cycle guard lands before the dependency engine, which
the owner chose to build (D7 (A)). **Status:** Open → PM-D7a ("DL §2's function in substance"); C4's
half already merged in PM-WP3. 🧑 The null predecessor (#344 (d), PMBP §0.5 #2): `flows/Projects.md`
§4 and `StageSetupSchema` (`setup.ts:263-264`) read `startsWithId = null` as "the stage above",
which the C6 CHECK refuses and the explicit-id guard cannot see; PMBP recommends resolving "the
stage above" to an id at write.

---

## 11. Workload Intensity reporting — dispute resolution (was DL §3)

**What is built (Decision #290).** The engine is complete in SQL (F1140:7-190):
`ticket_workload_reports` with statuses
`open · acknowledged · adjusted · expired_penalized ·
dismissed_bad_faith`; a filing trigger that
accepts only a `claimed` or `in_progress` ticket and suspends it as `reported_hidden` for 48 hours
with its payee and escrow kept; `trg_adjust_workload_report` when the client raises $W_i$; the
expiry sweep `fn_resolve_expired_workload_reports`; and the audit `fn_flag_bad_faith_report`. The
immutability guard keeps the reporter from changing the ticket while the report is open.

**What stops it working.**

| #   | Gap                                                                                                                                                                                                                                                                                                                                                 | Source                                  | Spec it breaks                                                          | Status                                                                                                  |
| :-- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------- | :---------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| W1  | **Unreachable.** No Zod schema, service, route or control. `file_workload_report` and `fn_flag_bad_faith_report` have no `authenticated` grant (G2510; the schema-wide revoke at `:44` makes an ungranted function unreachable). The only way to file is a direct INSERT under the "File workload report" policy (P2011:398), which no client makes | grep of `packages/`, `apps/web`         | PS:2249-2265 entire                                                     | Ruled → P3: Build now (D5); Open → PM-WP5a                                                              |
| W2  | **The 48-hour window never closes.** The expiry sweep is not registered (#290 (a); `SYSTEM_ARCHITECTURE.md:2423-2427`)                                                                                                                                                                                                                              | J5060                                   | PS:2260-2262                                                            | Ruled → Q0.3 (registered by PM-WP5a, not the jobs session); Open → PM-WP5a (step 3g)                    |
| W3  | **Only the client is penalised** on non-response, and both penalty severities default to `0` (`freelancer_bad_faith_penalty`, `client_no_adjust_penalty`, `00005001:32-35`), so neither penalty has any effect                                                                                                                                      | F1140:165-176                           | "both parties incur a penalty"; "ranking reduction on the Explore page" | Open → PM-WP5a (step 3c; 🧑 the sizes, PMBP §0.5 #5)                                                    |
| W4  | **A settlement leaves the report open.** Approving, Fair-Exiting or removing the freelancer during the window leaves it `open`, and the sweep later penalises the client for not adjusting a ticket they settled (#290 (d))                                                                                                                         | F1140                                   | PS:2267-2269                                                            | Open → PM-WP5a (step 3d)                                                                                |
| W5  | **Only the owner can answer.** A business's other reviewers can neither see the suspended ticket nor raise its $W_i$ (#290 (e))                                                                                                                                                                                                                     | P2011 _View tickets_ / _Manage tickets_ | PS §Clients & Businesses (any reviewer is the client)                   | Open → PM-WP5a (step 3b)                                                                                |
| W6  | **The client can lift a suspension by a move**, skipping `fn_resume_reported_ticket` and leaving the report open (#293 (e); = S10 in part)                                                                                                                                                                                                          | F1110                                   | PM §3.6 rule 7                                                          | Open → PM-WP5a (step 3e)                                                                                |
| W7  | **Reporting frees capacity.** `check_ticket_capacity` skips `reported_hidden`, so the reporter, who still holds the ticket, can claim more work during the window. That pays for filing                                                                                                                                                             | F1140:272,284,344                       | PS:2040 ($W_i$ is a sum over tickets **held**)                          | Fixed (PM-WP2, `3fcf2d54`)                                                                              |
| W8  | **No moderator.** PS:2263 lets "a moderator or the client" dismiss a report; `fn_flag_bad_faith_report` is service-role only and the operator desk (`/admin/disputes`) handles `finance.disputes` alone                                                                                                                                             | `features/admin`                        | PS:2263-2265                                                            | Open (no prompt; PMBP §0.6 follow-up, out of PM-WP5a's scope)                                           |
| W9  | **The disputed number is not the spec's number.** $W_i$ is built from difficulty alone (X5), so a freelancer disputes a figure the CREATE category never shaped                                                                                                                                                                                     | LW:2257-2267                            | PS:1998-2021                                                            | Ruled → P4: $W_i$ is the difficulty multiplier alone, so the disputed number is now the spec's (closed) |
| W10 | `acknowledged` is never written; no unique index allows only one open report per ticket                                                                                                                                                                                                                                                             | F1140; `00004003`                       | PS:2255 ("one at a time")                                               | Open → PM-WP5a (steps 3d, 3f)                                                                           |

**Minimum to ship it (if D5 rules "now").** A `WorkloadReport` Zod schema; `fileWorkloadReport` and
`answerWorkloadReport` on `ProjectBackendService` returning `ServiceResult`;
`POST
/api/projects/ticket/workload-report`; the assignee's "Report workload" in the ticket modal
and the reviewer's "Raise $W_i$" beside it; a grant on `file_workload_report`; the sweep registered;
W3, W4, W5 and W7 fixed in `00001140`; a partial unique index `WHERE status = 'open'`; the Dev
Context Switcher axis for a suspended ticket (root `CLAUDE.md` §5).

**Ruled:** P3 (Decision #338, flag (e)) — the owner chose **Build now** (not the ⭐ Planned).
**Status:** Open → PM-WP5a, which carries this minimum (W7 already merged; W8 out of scope).

---

## 12. Decisions and rulings (was DL §4)

### 12.1 Ruling table

Every D item was put to the owner on 2026-10-30 (FQ Part C); the OWNER RULINGS text is on row #338.
⭐ = the recommendation taken · ✎ = the owner's own answer.

| ID          | Question                                         | Ruling (FQ Part C)                                                                                        | Decision #        | Status                                                        |
| :---------- | :----------------------------------------------- | :-------------------------------------------------------------------------------------------------------- | :---------------- | :------------------------------------------------------------ |
| D1 = (a)    | Turn on the claim-TTL and workload-report sweeps | Q0.3 ⭐ A: register the claim-TTL sweep, hardened; the workload-report sweep follows with PM-WP5a's fixes | #338              | Partly fixed (row paused, `e18489d4`); Open → PM-WP1, PM-WP5a |
| D2 = (b)    | What Fair Exit pays                              | P1 ⭐ B now, A once deadlines are reliable; ⭐ the no-deadline fallback                                   | #338              | Open → PM-WP4a (🧑 PMBP §0.5 #3)                              |
| D3 = (c)    | Removal and deletion pay the freelancer 100 %    | P2 (a) ⭐ B + C                                                                                           | #338              | Open → PM-WP4a (the door), PM-WP4b                            |
| D4 = (d)    | Hard deletes against "nothing is hard-deleted"   | P2 (b) ⭐ hard-delete only untouched rows, archive the rest                                               | #338              | Open → PM-WP4b                                                |
| D5 = (e)    | Workload reporting: ship or Planned              | P3 ✎ Build now                                                                                            | #338              | Open → PM-WP5a                                                |
| D6 = (f)    | Assignment routing in the MVP                    | P3 ⭐ Planned; `open_pull` plus manual ship                                                               | #338              | Ruled → P3: Planned (roadmap, no prompt)                      |
| D7 = (g)    | Do stage dependencies drive anything?            | P3 ✎ Build the engine (D7 (A)), after the guard                                                           | #338              | Open → PM-D7a, PM-D7b                                         |
| D8 = (n)    | Kanban at scale                                  | P3 ⭐ keep the DOM; window once measured                                                                  | #338              | Ruled → P3: roadmap; PM-Z1 measures                           |
| D9 = (h)    | Store the CREATE category                        | P4 ✎ rejected: two numbers ($W_i$ difficulty-only; a data-based measure extends $R_i$)                    | #338              | Ruled → P4; Open → PM-WP5a step 1, PM-WP5b (🧑 the label)     |
| D10         | Who sees an unsent draft                         | P5 (d) ⭐                                                                                                 | #338              | Open → PM-WP9                                                 |
| D11 = (l)   | Which views each type answers                    | P7 ⭐                                                                                                     | #338              | Open → PM-WP8                                                 |
| D12         | Who moves an unclaimed ticket                    | P5 (a) ⭐; P5 (b) ⭐ with the owner's rider                                                               | #338              | Open → PM-WP6 (🧑 PMBP §0.5 #8)                               |
| D13         | Board view state in the URL                      | P7 ⭐                                                                                                     | #338              | Open → PM-WP8                                                 |
| D14         | Addresses inside the Submissions tree            | P7 ⭐                                                                                                     | #338              | Open → PM-WP9                                                 |
| D15         | The Global Workload Kanban                       | P3 ⭐ Planned                                                                                             | #338              | Ruled → P3: Planned (roadmap)                                 |
| D16-a       | The deadline bonus                               | M7 ⭐ C then A; ✎ one-offs and pipelines; +10 % the starting dial                                         | #337 (#338 D16-a) | Pointer → FCA N4, FDD D-11; Open → FBP DB12, DB13             |
| D16-b       | `due_date` after a claim                         | P5 (c) ✎ a change needs the other side's agreement                                                        | #338              | Open → PM-WP6 (step 6)                                        |
| D16-c       | Who hears of a Fair Exit                         | P1 ✎ owner and acting reviewer, as built                                                                  | #338              | Ruled → P1: as built (closes #198 (e))                        |
| (k) / S11   | Chain Reaction price                             | P6 ✎ per stage                                                                                            | #338              | Open → PM-P6 (🧑 #344 (e))                                    |
| P5 (e)      | Client mirrors vs server flags                   | P5 (e) ⭐ = #341 (n), ADC Q14                                                                             | #338, #341        | Doctrine → RED (ADC Q14); applied in PM-WP6, PM-S3            |
| FDD D-9 (a) | 14-day ghosting auto-approve (§12.3)             | P3 ⭐ Build                                                                                               | #337              | Open → PM-GH1                                                 |

### 12.2 Option analyses

Each decision states the conflict, the options and a recommendation, tested against the pitch: a
structured, stage-based micro-agency marketplace that wins trust where Upwork and Fiverr lose it.

#### D1 — Turn on the claim-TTL and workload-report sweeps

- **Conflict.** PS:1989-1994 and PS:2258-2262 promise both clocks; neither is scheduled
  (`SYSTEM_ARCHITECTURE.md:2423-2427`, "awaiting a human", Decision #203 (a), #290 (a)).
- **Options.** (A) Register both now, after S2's hardening. (B) Keep them off until notifications
  for both outcomes exist.
- **Recommendation: A**, every 15 minutes, with S2's lock and re-check, a `ticket_history` row and
  notifications (`ticket.claim_expired` to both sides). Ticket parking is the low-trust behaviour
  the pitch exists to remove, and locked client money with no work behind it is the most expensive
  signal a marketplace can send.

**Ruled:** Q0.3 = A ⭐ (Decision #338, flag (a)). The jobs session registers the claim-TTL sweep
(every 15 min, SKIP LOCKED, a status re-check, a history row, notices to both sides); the
workload-report sweep is not in the set, because on its own it would penalise clients for tickets
they had settled (architect reading, not objected). **Status:** Partly fixed (the row
`projects-release-expired-claims`, `3,18,33,48 * * * *`, registered `enabled = false`; `e18489d4`,
merged `817dbbd1`); Open → PM-WP1 (hardens and enables it) · PM-WP5a (the report sweep).

#### D2 — What Fair Exit pays

- **Conflict.** `finance-model.md` §3 derives the split from elapsed stage duration: < 25 % → 0 to
  the freelancer, 25–75 % → 50 %, > 75 % or a final submission → 100 %. The build lets the **paying
  client** choose 25, 50 or 75 % (X14, #198 (f)). The payer will choose 25 every time, and there is
  no project-side dispute to contest it: PM §3.8's only dispute door is a session no-show claim.
- **Holes in the spec itself.** (a) Duration is measured against `stage.deadline`, but PS:327-328
  makes an end date optional, so a stage with no deadline has no duration. (b) A multi-stage ticket
  on the ended stage is cancelled outright and its later stages never run (#198 (b)).
- **Options.** (A) Build the spec: the server derives the tier, the client confirms. (B) Keep the
  chooser, but make the derived tier a floor the client may only raise, and let the payee contest
  through the Evidence Vault. (C) Amend the spec to the built model.
- **Recommendation: B now, A when deadlines are reliable**, and rule (a): with no deadline, fall
  back to the submission evidence (a submission on file → 50 %, an accepted one → 100 %). (C) hands
  the payer the gavel and invites the Upwork comparison the pitch is built against.
- **Finance-side variant (FDD D-9 (b), absorbed).** Keep the client-selected tier (#198), but have
  the server **recommend** the tier from elapsed duration in the preview; the freelancer may dispute
  a lower pick. Reason: "the current flow is fair only if the client chooses honestly". FDD X7 (=
  X14) and FCA §2.2 cite the client-selected build (the doors at `00001150:1070`, `:1138`; the split
  engine `finance.fn_fair_exit_split` / `fn_fair_exit_release` at F1200:935-980); FCA §2.3 notes
  that FM itself records the time thresholds as "not yet wired". The money-path evidence (the
  release paths' open-dispute check, FA L9) stays in FCA.

**Ruled:** P1 = B now, A once deadlines are reliable ⭐; the no-deadline fallback ⭐; the owner and
the acting reviewer are notified, as built ✎ (closes #198 (e), = D16-c); a multi-stage ticket on the
ended stage is cancelled, accepted ✎ (closes #198 (b)). Decision #338, flag (b); FDD's variant and
(C) were not taken. **Status:** Open → PM-WP4a (waits F·DB3, F·DB6; 🧑 how a contest holds money,
PMBP §0.5 #3).

#### D3 — Removal and deletion pay the freelancer 100 %

- **Conflict.** A ticket whose freelancer is removed, or which the client deletes, releases its
  whole escrow to the freelancer, even while it is still only `claimed` and no work has started
  (F1110:384-387; F1120:77-79; PS:2232-2245). The same parked claim left for 24 hours is refunded to
  the client in full (PS:1989-1994). Acting on a stalled freelancer is therefore dearer than
  waiting, and a pipeline has no ticket-level exit at all — Fair Exit is stage-wide.
- **Options.** (A) Keep the spec. (B) Before `in_progress`, removal and deletion refund the client,
  mirroring the TTL; from `in_progress`, apply the D2 split at ticket level. (C) Add a ticket-level
  Fair Exit door.
- **Recommendation: B with C.** It removes an incentive to wait out bad work, and it keeps the
  freelancer whole for work genuinely under way. It changes PS §Deletion Protocol and §Freelancer
  Removal Mid-Ticket in the same change.

**Ruled:** P2 (a) = B + C ⭐ (Decision #338, flag (c)): before `in_progress`, removal or deletion
refunds the client (TTL parity); after it, the P1 split applies at ticket level through a
ticket-level Fair Exit door. **Status:** Open → PM-WP4a (the door) → PM-WP4b (removal and deletion).

#### D4 — Hard deletes against "nothing is hard-deleted" (new contradiction)

- **Conflict.** PS §Deletion Protocol and §Stage Deletion allow deletion. PM §5.4 and root
  `CLAUDE.md` §5 forbid hard deletes, with one carve-out (#163, rooms with no history). The build
  hard-deletes tickets (`delete_ticket`), stages (`delete_stage` without escrow history, and the
  stages FOR ALL policy) and projects ("Users can delete own projects", P2011:175). `ticket_history`
  and `ticket_workload_reports` cascade away with a ticket, so the evidence the Reliability Index
  and the Evidence Vault rely on is destroyed. A ticket with a submission cannot be deleted at all
  (X15).
- **Recommendation.** Extend #163's carve-out exactly: a hard delete only for a ticket or stage that
  was never claimed, funded or submitted against; everything else archives. Tickets gain
  `archived_at` under the `ck_projects_archived_at` idiom (edited into T15, with the Zod row and
  Tables.md in the same change); the project DELETE policy goes, since `archived` is already the
  soft delete. PS's wording becomes "delete (archive once anything happened)".

**Ruled:** P2 (b) ⭐ (Decision #338, flag (d)): hard-delete only a ticket or stage never claimed,
funded or submitted against, archive everything else (`tickets.archived_at`, no project DELETE
policy, no stage hard-DELETE, calendar events archived too), which resolves the contradiction.
**Status:** Open → PM-WP4b (step 8, the calendar half, defers to SCHEDULING C·WP10 if it owns
`scheduling.events`).

#### D5 — Workload reporting: ship it, or mark it Planned

- **Conflict.** PS describes a live dispute mechanism; nothing reaches it (§11).
- **Options.** (A) Ship the §11 minimum. (B) Mark PS §Dispute Mechanism "Planned", keep the SQL, and
  close W7 now (it already distorts capacity).
- **Recommendation: B for MVP, A before the agency tier.** The claims rule the landing applies
  (#281) is the right standard for the spec too: a promise the product cannot keep reads worse than
  an honest "Planned". W7 is fixed either way.

**Ruled:** P3 ✎ — the owner chose **Build now** (A), not ⭐ B (Decision #338, flag (e)). W7 merged
in PM-WP2 (`3fcf2d54`). **Status:** Open → PM-WP5a.

#### D6 — Assignment routing in the MVP

- **Conflict.** PS:2046-2069 sells four modes from a Staffing control; three are unreachable (X6).
- **Recommendation.** Mark round robin and parallel stream **Planned** in PS and ship `open_pull`
  plus manual, **unless** the agency-scale work (#252) needs round robin for team fairness, in which
  case grant the three RPCs to `authenticated` (they already check `can_review_project`) and build
  the control.

**Ruled:** P3 ⭐ Planned (Decision #338, flag (f)). **Status:** Ruled → P3: Planned; PMBP §0.6
roadmap (grant, Staffing control and Dev axis when the Agency tier needs team fairness).

#### D7 — Do stage dependencies drive anything?

- **Conflict.** The form collects a dependency and a delay per stage; nothing acts on them (C3).
- **Options.** (A) An engine: a stage whose predecessor completes opens (and, with `chain_reaction`,
  funds) on its own. (B) Presentation only: the Timeline's arrows, with the form saying "shown on
  the Timeline" rather than implying automation.
- **Recommendation: B now, with §10's guard either way.** (A) needs the cycle guard first, and its
  money consequence (an automatic hold on a dependency) belongs with the Chain Reaction, not beside
  it.

**Ruled:** P3 ✎ — the owner chose **Build**, read as (A): a stage opens, and with `chain_reaction`
funds, when its predecessor completes, built after the cycle guard and priced per P6 (Decision #338,
flag (g)). **Status:** Open → PM-D7a (the guard) → PM-D7b (the engine; 🧑 a negative delay and a
predecessor that never completes, PMBP §0.5 #7).

#### D8 — Kanban at scale

- **Correction.** The brief assumed the board was Canvas2D; it is DOM, by contract (§0).
- **Recommendation.** Keep it DOM: drag-and-drop, focus order and screen-reader semantics are what a
  Canvas board would have to rebuild. Window each column (render the visible cards plus a margin)
  once a column passes a measured threshold, inside `@projective/ui/kanban` so every board inherits
  it. Measure first: no pipeline in the seed has a column large enough to justify it today.

**Ruled:** P3 ⭐ — no canvas rewrite; keep the DOM and window once measured (Decision #338, flag
(n)). **Status:** Ruled → P3: roadmap (PMBP §0.6); PM-Z1 records the largest seeded column.

#### D9 — Store the CREATE category

- **Conflict.** PS defines $W_i$ = CREATE weight × difficulty; no stage stores a category (X5), so
  the formula, the CREATE mastery track (PS §Standing) and the reporting dispute (W9) all lack their
  input.
- **Recommendation.** Add `project_stages.create_category org.create_category` (edited into T15; the
  enum exists), the six weights as `security.platform_params` (one dial each, `finance-model.md`
  style), and compute `tickets.workload_intensity` in SQL at commit, with a CHECK, instead of in TS
  (LW:2257-2267). Existing tickets keep their stored figure.

**Ruled:** P4 ✎ — the owner rejected ⭐ and chose two numbers (Decision #338, flag (h)): $W_i$ stays
the per-ticket load that capacity sums and the workload report disputes, from difficulty alone with
no CREATE weights; a data-based measure (estimate against actual time, requested deadline against
delivery, the slow-down across concurrent projects) extends the Reliability Index at a baseline
until enough data exists, and both weigh heavily in search. **Status:** Open → PM-WP5a step 1 (the
`categoryWeight` cleanup), PM-WP5b (the measure; 🧑 PMBP §0.5 #6); whether `create_category` is
still stored as a label: 🧑 (PMBP §0.5 #1).

#### D10 — Who sees an unsent draft

- **Conflict.** Reviewers can read a submitter's unsent drafts (`resolveIsolation`); the code marks
  it as an open decision.
- **Recommendation.** A draft is the submitter's (and their team's) until sent. Reviewers watching
  half-finished work undermines the "review against the checklist" contract (PS:57-58).

**Ruled:** P5 (d) ⭐ (Decision #338). **Status:** Open → PM-WP9 (steps 2-3: the "View submissions"
policy, `00002011:815-840`, also shows every row to anyone with project access).

#### D11 — Which views each type answers

- **Conflict.** PS:373-374 gives a Task no Board; the route renders one. The One-off matrix (#134)
  omits the stage `tasks` board; the route renders one.
- **Recommendation.** Answer as the Timeline guard does: a 303 to the page the view would have been
  part of. One helper beside `taskAbsentViewRedirect`, driven by `CHANNEL_TAB_MATRIX`, so the header
  and the route can never disagree again.

**Ruled:** P7 ⭐ (Decision #338, flag (l)): a 303 to the parent page for a view a type does not
answer. **Status:** Open → PM-WP8 (step 1, `typeAbsentViewRedirect`).

#### D12 — Who moves an unclaimed ticket (#293 (c), (d); #294 (b))

- **Open since 2026-10-17.** Any participant can move an unclaimed ticket, including a paid one into
  an unpaid stage (hiding it from everyone) or a prepaid one into `in_review` with no assignee. The
  board's client seat (`viewerIsClientOf`, which includes a project `admin`) is wider than review
  authority, and the board does not yet use the ticket-manager grant.
- **Recommendation.** Unclaimed moves belong to review authority and granted ticket managers, the
  same set that may write the ticket (#294).

**Ruled:** P5 (a) ⭐; P5 (b) ⭐ with the owner's rider — a claimed ticket drags only for those
allowed to move it: project owners or admins with explicit permission, and later a project-manager
freelancer inside a business (a future persona, **Planned**) (Decision #338). **Status:** Open →
PM-WP6 (PM-WP2 shipped "without D12"); P5 (b)'s client-side set: 🧑 PMBP §0.5 #8 (§13).

#### D13 — Board view state in the URL

- **Recommendation.** `?view=list`, `?group=status`, `?q=`, `?sort=` and `?dir=` on `/board` and the
  stage `tasks` route, read server-side, with ROUTING.md updated in the same change. Members
  `?view=` and the lane's `?dir=` (#323) are the precedent.

**Ruled:** P7 ⭐ — board `?view=&group=&q=&sort=&dir=` (Decision #338). **Status:** Open → PM-WP8
(step 2; the priority and assignee filters stay in signals).

#### D14 — Addresses inside the Submissions tree

- **Conflict.** Tree segments are uuids (§2.2); #88 says uuids do not route.
- **Recommendation.** `stg-` slug · the submitter's handle · the submission's per-stage `number`.
  `number` needs its missing UNIQUE (`project_stage_id`, `number`) first (§5.1). No new slug prefix
  is minted.

**Ruled:** P7 ⭐ — submission-tree addresses as `stg-` · handle · number (Decision #338). The UNIQUE
landed in PM-WP3 (`3fcf2d54`). **Status:** Open → PM-WP9 (step 5).

#### D15 — The Global Workload Kanban

- **Conflict.** PS:279-288 describes a cross-project board (Proposals sent · Ready · In progress ·
  Complete); nothing builds it.
- **Recommendation.** Mark it Planned in PS. When built, it is a read over `check_ticket_capacity`'s
  sums and `get_workload_capacity`, on `@projective/ui/kanban`, read-only.

**Ruled:** P3 ⭐ Planned (follow-up) (Decision #338). **Status:** Ruled → P3: Planned; PMBP §0.6
roadmap.

#### D16 — Still open from earlier logs (restated, not re-ruled)

The decision log listed three items without letters; FQ and PMBP cite them as D16-a, -b and -c.

- **D16-a.** The deadline bonus: +10 % appears in no source-of-truth doc, and PS gives it to
  one-offs while the build makes it pipeline-only (`flows/Projects.md` §4.4). **Pointer:** owned by
  FCA (N4; FDD D-11); this delta is kept here because FCA lacks it. **Ruled:** M7 ⭐ C then A; ✎
  one-offs and pipelines; +10 % the starting dial (#337). **Status:** Open → FBP DB12, DB13; when
  "met" is judged is #344 (j).
- **D16-b.** `due_date` is not locked after a claim, for either party (#291 (c)). **Ruled:** P5 (c)
  ✎ — the form answered "No" with "due date should stay the same if there is a claim"; the follow-up
  ruled that after a claim a change needs the other side's agreement (closes #291 (c)). **Status:**
  Open → PM-WP6 (step 6).
- **D16-c.** A Fair Exit notification reaches the owner and the acting reviewer, not every billing
  member (#198 (e)). **Ruled:** P1 ✎ owner and acting reviewer, as built (closes #198 (e)).
  **Status:** Ruled → P1: as built.

### 12.3 Ghosting: a held escrow never times out (FDD D-9 (a) = FDD X16 = FCA N16)

Owned here: the clock and the doors are the projects' (PMBP PM-GH1, "Part C lists the ghosting timer
under track F. This file carries it because its clock and its doors are the projects'"). FCA and FDD
keep the escrow-risk sentence and point here.

| Fact                                                                                                                                                                                                    | Source                       |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------- |
| `finance-model.md` §8 (`:330-333`) promises a **14-day auto-approve** if the client neither approves nor disputes, with notices at 7 and 13 days                                                        | FDD X16, D-9; PS:1651-1654   |
| `PRODUCT_SPEC.md` §5's No Forever-Escrow guarantee assumes every escrow can always be released; a client who never reviews creates the "permanent, un-releasable escrow" the guarantee promises against | FDD X16; FCA N16 (P1 · spec) |
| No auto-approve job in `00005060` or any function: a held ticket escrow never times out                                                                                                                 | FCA N16, FCA §2.3            |
| `finance.fn_freelancer_payout_ready` (and its gate `fn_assert_payout_ready`) guarantees the payee is _payable_; it does not guarantee release                                                           | FCA §0                       |
| Nothing records when a submission was sent (a draft's `created_at` is not its send time); `submission.auto_approved` is already catalogued (`00005010:50`)                                              | PMBP §0.1, PM-GH1            |

**Recommendation (FDD D-9 (a)).** **Build (P1).** A submission neither approved nor disputed within
14 days auto-approves through the normal release path, with notices at 7 and 13 days. Without it the
No Forever-Escrow guarantee is false in the client-ghosting case (N16). It matches Upwork's
fixed-price auto-release, which freelancers already expect.

**Ruled:** P3 ⭐ Build (Decision #337, FDD D-9 (a)). **Status:** Open → PM-GH1 (waits F·DB3, which
makes the release refuse an open dispute, and the comms worker from the jobs merge; runs in the
finance window). Whether a ghosted deadline bonus is "met" follows FBP DB13 (→ FCA, M7).

### 12.4 Cross-domain topics this file owns

| Topic (FQ)                            | Here                                     | Absorbed from other audits (IDs are aliases; unique facts kept above)                                                                                           | Status                |
| :------------------------------------ | :--------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------- |
| Fair Exit (P1)                        | X14, D2, D16-c, §0 row 1, §3.2 End stage | FDD X7 (= X14); FDD D-9 (b) (the variant in D2); FCA §2.2 and §2.3 Fair Exit rows keep the money-path evidence                                                  | Open → PM-WP4a        |
| Removal, deletion and archive (P2)    | X15, X16, S5, S13, D3, D4                | SCA S-25 (calendar events archive, P2 (b))                                                                                                                      | Open → PM-WP4b        |
| Ghosting auto-approve (P3)            | §12.3                                    | FCA N16; FDD X16, D-9 (a)                                                                                                                                       | Open → PM-GH1         |
| Claim-TTL sweep (Q0.3)                | X7, S1, S2, D1                           | SBP-A §0 ("An expired claim returns its ticket to `Ready`") and §2.2 (2): `claim_ttl_minutes` 1440 (absorbed into X7); the agency-fairness angle stays in SBP-A | Open → PM-WP1         |
| Board authority (P5)                  | X11, D10, D12, D16-b                     | ADC Q14 (the doctrine, now in RED); RED L-03, SC-4                                                                                                              | Open → PM-WP6, PM-WP9 |
| Addressable board state and URLs (P7) | §1.2, §2.2, §2.4, §3.1, D11, D13, D14    | SCA S-31 (calendar URL state, the scheduling track); `/files` URL state (not track P)                                                                           | Open → PM-WP8, PM-WP9 |

### 12.5 Decision #338 (was DL §5)

**Decision #338** is the row `| 338 |` in `reference/decisions/decisions-122-126.md` (index line in
`reference/decisions/README.md`); it holds flags (a)–(n), the same-day closures and the OWNER
RULINGS.

Flag aliases (statuses are on the rows named): (a) = D1, S1, S2 · (b) = D2 · (c) = D3 · (d) = D4 ·
(e) = D5, §11 · (f) = D6, X6 · (g) = D7, §10 · (h) = D9, X5 · (i) = X3, X12 · (j) = X8, X9 · (k) =
S11, ruling P6 · (l) = D11 · (m) = §3.2 controls, §2.2 Copy link · (n) = D8, §0.

---

## 13. Contradictions register

| #            | Contradiction                                  | Sides                                                                                                                                               | Status                                                                                                                                    |
| :----------- | :--------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| D4           | Hard deletes against "nothing is hard-deleted" | PS §Deletion Protocol, §Stage Deletion vs PM §5.4, root `CLAUDE.md` §5 (and the build)                                                              | Ruled → P2 (b) (#338 (d)); Open → PM-WP4b                                                                                                 |
| #344 (d)     | The implicit predecessor                       | `flows/Projects.md` §4 and `StageSetupSchema` (`setup.ts:263-264`: null = "the stage above") vs §10's C6 CHECK                                      | Open (🧑 #344 (d)) → PM-D7a step 3                                                                                                        |
| #344 (e)     | A ticket's own price                           | PS:1472-1475 (P6: a ticket price never overrides its stages) vs PS:2272-2283 and the ticket composer ("at its own price, else its stage's")         | Open (🧑 #344 (e); architect reading on the row) → PM-P6 step 2                                                                           |
| PMBP §0.5 #8 | Who moves a claimed ticket on the client side  | PS:2351-2363 (P5 (b): the owner or an admin with explicit permission) vs PM §3.6 rules (8), (10) and `fn_assert_ticket_move` (any review authority) | Doc half resolved at the #344 merge (PM §3.6 rule (10) aligned with PS); the SQL still admits review authority: Open → PM-WP6 step 5 (🧑) |
| §2.3         | The Board tab inside every stage               | PS:289-297 vs `CHANNEL_TAB_MATRIX` (#134), which narrows it to pipeline stages                                                                      | Open (no prompt)                                                                                                                          |
| §2.5         | `styleVars` custom properties                  | `guardrails.md:83` (no inline styles, no exception stated) vs PMBP §1 standard header ("no inline style= except packages/ui styleVars()")           | Open (no prompt)                                                                                                                          |

**Raised by the 2026-11-11 consolidation, Decision #410 (`reference/decisions/decisions-122-126.md`,
2026-11-11; open):** flag (d), inline styles: `guardrails.md:83` states no exception (§2.5), while
`PM_BUILD_PROMPTS.md`'s standard header allows `packages/ui` `styleVars()`.

---

## 14. Cross-domain pointers

| Topic                                                                                   | Our IDs                                          | Owner file §                                                                              |
| :-------------------------------------------------------------------------------------- | :----------------------------------------------- | :---------------------------------------------------------------------------------------- |
| Deadline bonus (FQ M7)                                                                  | D16-a                                            | `FINANCE_AUDIT.md` N4 (and FDD D-11, merged there)                                        |
| Fair Exit and release money path (open-dispute refusal, pending window, dispute freeze) | X14, D2, §12.3                                   | `FINANCE_AUDIT.md` §2.2 Fair Exit row, FA L9; FBP DB3, DB6                                |
| A Fair Exit contest through the dispute engine (🧑 PMBP §0.5 #3)                        | D2                                               | `FINANCE_AUDIT.md` (FDD D-6, ruling M3)                                                   |
| Client mirrors vs server capability flags (FQ P5 (e))                                   | X11, D12, S3                                     | `PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md` (ADC Q14, RED L-03, SC-4)               |
| The move matrix's reuse by O·WP5b and O·WP6                                             | X11, D12                                         | `OPTIMIZATION_BUILD_PROMPTS.md`; RED L-03                                                 |
| Payout-ready gate on claim and assignment (FQ M4)                                       | X3, X12 (`fn_assign_ticket_core`'s payout check) | `FINANCE_AUDIT.md` K-rows, D-7                                                            |
| Agency fairness: per-person capacity and claim parking                                  | X4, X7                                           | `SUBSCRIPTIONS_AUDIT.md` §2.1 M1, §2.2                                                    |
| Calendar events archive (P2 (b)); calendar URL state (P7)                               | D4, D13                                          | `SCHEDULING_COMPLETENESS_AUDIT.md` S-25, S-31                                             |
| Reliability and load weights in search (P4)                                             | X5, D9, W9                                       | `COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md` (search ranking, S11); M·search waits for PM-WP5b |

---

## 15. Not checked / limits

- Status is doc-derived (the Fixed banner, PMBP §0.1, FQ Part C, `git log` to `08296359`) and was
  not re-verified in code. A P-track prompt merged after `08296359` would make an "Open → PM-…" cell
  stale.
- A finding marked **(I)** was inferred from reading, not executed (§7).
- `members.css:58` and `message-interactions.css:39` were not checked against the pinned-bar
  `backdrop-filter` exception (§2.5).
- Line numbers are the 2026-10-29 tree's. Later docs cite the same functions at newer lines (PMBP:
  `fn_release_expired_claims` `00001140:689-720`, the Fair Exit doors `00001150:1070`, `:1138`;
  FCA's F1200:928-980 is the split engine, `finance.fn_fair_exit_split` / `fn_fair_exit_release`,
  now F1200:935-980, not the preview door).
- F2's legacy `single_stage` reading and the "exactly one" Zod wording, the §6 claim capacity case
  and the §2.2 `projectId` mismatch are not settled by any document (Unverified).

---

## 16. Section map of the merged decision log (DL)

`PROJECT_MANAGEMENT_DECISION_LOG.md` (2026-10-29) was merged here on 2026-11-11 and deleted. Every
ID keeps its name; DL §n is §n+8. Pre-merge text:
`git show 08296359:documentation/architecture/PROJECT_MANAGEMENT_DECISION_LOG.md`.

| Old section / IDs                                                                                                                                             | Now                                                                                                                                   |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------ |
| Header (companion note, the three gap families, "nothing here is ruled")                                                                                      | [`PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md`](PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md) header and Executive summary                   |
| §1 Ticket state synchronisation gaps · S1–S13                                                                                                                 | §9 (same IDs, with a Status column; S4, S6, S7, S8 are cited by migrations and services)                                              |
| §2 Circular stage dependencies · C1–C6 · the guard sketch (`ck_project_stages_dependency_trigger`, `fn_guard_stage_dependency`, `trg_guard_stage_dependency`) | §10 (same IDs; the SQL sketch verbatim; cited as "DL §2" by `PM_BUILD_PROMPTS.md` §0.2, §0.5 #2 and PM-D7a)                           |
| §3 Workload Intensity reporting · W1–W10 · "Minimum to ship it"                                                                                               | §11 (same IDs; cited as "DL §3" by PM-WP5a; W7 by `board.ts` and `00001140`)                                                          |
| §4 Decisions for founder review · D1–D15                                                                                                                      | §12.2 (same IDs, each with its **Ruled:** line); ruling table §12.1                                                                   |
| §4 D1's "Status 2026-10-30" banner                                                                                                                            | §12.2 D1, folded into its **Ruled:** line                                                                                             |
| §4 D16 (three unlettered bullets)                                                                                                                             | §12.2 D16-a (deadline bonus, a pointer to FCA N4), D16-b (`due_date`), D16-c (Fair Exit notices): the letters FQ and PMBP already use |
| §5 Decision #338 — as recorded · flags (a)–(n)                                                                                                                | §12.5: a pointer to row `\| 338 \|` in `reference/decisions/decisions-122-126.md`, plus the flag → ID aliases                         |
| "audit §n", "audit X…" inside this file                                                                                                                       | the same §n and IDs in the survivor (its §0–§7 keep their numbers)                                                                    |
