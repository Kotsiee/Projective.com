# Scheduling, Calendar & Sessions — Consolidated Audit (2026-10-29 → 2026-11-11)

> **Evaluation, not binding.** Consolidated 2026-11-11 from `SCHEDULING_COMPLETENESS_AUDIT.md` (SCA,
> 2026-10-29, first titled "Scheduling, Calendar & Sessions — Completeness Audit") and
> `SCHEDULING_DECISIONS_AND_GAPS.md` (SDG, 2026-10-29, ruled 2026-10-30). SDG was deleted; §16 maps
> its old sections and IDs, and SDG §n.m is §12.n.m here. Pre-merge text:
> `git show 08296359:documentation/architecture/<file>`. Status is doc-derived (the audits' banners,
> the `SCHEDULING_BUILD_PROMPTS.md` run order, FOUNDER_QUESTIONNAIRE Part C, `git log --grep` on the
> prompt and finding IDs, and the later scheduling decisions #383, #385–#387, #392 and #408 where
> they record a fix as built), not re-verified in code. Rulings: Decision #343
> (`reference/decisions/decisions-122-126.md`), which SDG drafted as "#335".
>
> **Section numbers.** §2–§11 keep their 2026-10-29 numbers, because `SCHEDULING_BUILD_PROMPTS.md`
> cites this audit's §6, §8 and §10 by number. §2–§9 are the 2026-10-29 code reading, and §10
> carries each finding's current status. The decisions (from SDG), the contradictions, the
> remediation map and the cross-domain pointers follow as §12–§15.
>
> Scope of the 2026-10-29 read-only audit:
>
> - the `scheduling` schema and the session tables it mirrors (`projects.session_events`, `cohorts`,
>   `session_attendance`);
> - the booking gate, the reschedule coordination engine and the session money path;
> - the conferencing and calendar integration seams;
> - the surfaces `/calendar`, the project calendars, `/[handle]/availability`,
>   `/[handle]/edit/availability` and `/view/[entity]/schedule`.
>
> Each was checked against `PRODUCT_SPEC.md`, `SYSTEM_ARCHITECTURE.md`, `database/scheduling/*`,
> `PRODUCT_MANAGEMENT.md` §3.5, `ROUTING.md`, `DESIGN_SYSTEM.md` and the decision log (#37, #56,
> #71–#75, #171, #203, #208, #211, #212, #217). **No code was changed** by either audit. Findings
> are numbered `S-nn` (§10) and decisions `D0`–`D9` (§12).
>
> Abbreviations: **T15** / **T17** / **T22** = `supabase/migrations/00000015_tables_projects.sql` /
> `…17_tables_finance.sql` / `…22_tables_scheduling.sql` · **F1155** =
> `…/00001155_functions_projects_sessions.sql` · **F1260** =
> `…/00001260_functions_finance_disputes.sql` · **F1510** = `…/00001510_functions_scheduling.sql` ·
> **F1520** = `…/00001520_functions_scheduling_free_busy.sql` · **TR1860** =
> `…/00001860_triggers_scheduling.sql` · **G2500** / **G2520** =
> `…/00002500_permissions_schema_grants.sql` / `…/00002520_permissions_table_grants.sql` · **P2011**
> = `…/00002011_policies_projects.sql` · **svc/** = `packages/backend/services/` · **coord.ts** =
> `packages/types/scheduling/coordination.ts` · **SA** = `SYSTEM_ARCHITECTURE.md` · **PM** =
> `PRODUCT_MANAGEMENT.md` · **SCHBP** = `SCHEDULING_BUILD_PROMPTS.md` · **FQ** =
> `FOUNDER_QUESTIONNAIRE.md` · **FM** = `business/finance-model.md` · **FA / FCA / FDD** =
> `FINANCE_AUDIT.md` (one file since 2026-11-11; FDD writes F1155 as **S1155**) · **CAS** =
> `COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md`.

## 0. Premise corrections

| Brief assumed                                                                                                                                                                                          | Actual (source)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A single `SessionService` owns sessions and booking                                                                                                                                                    | The work is split across four services, all of which return `ServiceResult<T>`:<br>• **`SessionBackendService`** (`svc/sessions/SessionBackendService.ts:101`): seats, cancellation, no-show claims, the presence webhook.<br>• **`ScheduleBackendService`** (`svc/scheduling/`): calendars, presets, the coordination writes via `coordination-plan.ts` and `live-coordination-writes.ts`.<br>• **`BookingBackendService`** (`svc/booking/`): slot grids and the discovery-call request.<br>• **`IntegrationsBackendService`**: connections.<br>`apps/web/features/projects/core/SessionService.ts` is the island-side `fetch` wrapper. |
| `fn_can_request_call` and `fn_call_request_refusal` are the booking enforcement                                                                                                                        | Both exist (F1510) and back the BEFORE INSERT trigger. **But no app code calls either one directly.** The pre-flight comes from the slot grid (`svc/scheduling/slot-grid.ts`), which re-implements the same geometry and is pinned by `slot-grid.agreement.test.ts`. A refusal surfaces through `request_discovery_call`'s exception, mapped in `BookingBackendService.ts:932-960`.                                                                                                                                                                                                                                                      |
| Group reschedules need a ">50% quorum"                                                                                                                                                                 | The rule is **more than half of everyone entitled to vote**: the roster minus the host. It is not a quorum of the answers cast, so abstaining counts against the move (coord.ts:657-669). There are three denominators in the code (S-14).                                                                                                                                                                                                                                                                                                                                                                                               |
| Edge Functions handle calendar sync and room minting                                                                                                                                                   | **No such Edge Function exists.** The only one is `supabase/functions/scan-file`, a mock scan. The codebase runs integration work as Fresh routes plus fat services, with scheduled work as pg_cron `http` jobs (Decision #203). The presence webhook is a Fresh route. See §7 and D6.                                                                                                                                                                                                                                                                                                                                                   |
| The 1-on-1 paid-call escrow gap is "relax escrows vs auto-provision a micro-project", because (`Tables.md` §3) `finance.escrows` requires **both** `project_stage_id` and `payer_business_id` NOT NULL | Only `project_stage_id` is still NOT NULL (T17, `CREATE TABLE finance.escrows`, line 3 of the block). `payer_business_id` was relaxed by Decision #126: `ck_escrows_one_payer` admits a lone `payer_user_id`. SA §4 already says this; `Tables.md` does not. `Tables.md` §3 was corrected in Wave 1.1 (S-23).                                                                                                                                                                                                                                                                                                                            |
| Option (b), "auto-provision a session micro-project", is hypothetical                                                                                                                                  | **It is built.** Decision #211's `projects.fn_book_session_slot` (F1155:564) finds or makes the listing's one unlisted session engagement. It seats the buyer on a one-seat cohort and holds **one escrow per sitting** (`finance.escrows.session_event_id`, `ck_escrows_sitting_on_seat`). It then settles that escrow through the existing sweep: negative consent, provider-no-show refund, per-sitting cancellation and the dispute desk. See §12.1.                                                                                                                                                                                 |
| The 12h lockout and 24h cancellation conflict is a new question                                                                                                                                        | It has been logged since Decisions #71(a) and #72(b), restated in #211(c) and PM §3.5. D2 proposes the ruling and narrows the actual risk. Ruled as C2 (§12.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

---

## 1. Executive summary and scorecard

**Verdict (2026-10-29).** The read side, the coordination engine, presence ingest, the owner
Availability editor, the privacy matrix and the pre-engagement invariants were sound. What books,
what releases money on evidence and what mints a room was missing or broken: **Book this slot**
booked nothing (S-26), paid calls were bookable unpaid (S-02), the owner could rewrite the sitting
row the payout sweep trusts (S-01), and no room was ever minted, so the Digital Handshake never
matched (S-03).

**What changed since (to 2026-11-11).** The owner ruled D1–D9 on 2026-10-30 (Decision #343). The P0s
are closed or contained: S-01 and S-26 were fixed with the audit, and SCH-WP2 (`6882e0be`) refuses
paid calls until Option C lands. SCHBP's run order marks only SCH-WP2 ✅, while Decisions #385–#392
record rooms, presence and inbound sync as built (parts of SCH-WP3, WP4a, WP4b, WP5 and WP8), never
run on a live Microsoft or Zoom account. Still open: D1 Option C (SCH-WP6), the D2 windows
(SCH-WP7), D5, D7 and D8 (SCH-WP9), the calendar UI set (SCH-WP10) and the docs sweep (SCH-Z1). §10
gives each finding's status, and §14 maps it to its prompt.

The scorecard below is as audited on 2026-10-29; §10 has each finding's current status.

Legend: ✅ complete · 🟡 partial · ❌ missing or broken · 🔒 security or money integrity

| Area                                                                       | Verdict | One line                                                                                                                                                                |
| :------------------------------------------------------------------------- | :------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Personal Calendar** (`/calendar`)                                        | 🟡      | Live agenda, RSVP and reschedules work. Create, move, delete and `.ics` import are session-local. Discovery calls cannot be answered (S-25, S-10, S-28).                |
| **Project Calendar**                                                       | 🟡      | Same shape as `/calendar`: live reads and coordination, session-local authoring (S-25).                                                                                 |
| **Public Availability Booking**: the schedule pages                        | ❌🔒    | **Book this slot** on `/[handle]/availability` and `/view/[entity]/schedule` shows "You're booked" and books nothing (S-26).                                            |
| **Public Availability Booking**: courtesy calls via the Consultation modal | 🟡      | Request works end to end with a correct gate. After that, nothing: no host confirm or decline, no expiry, no room (S-10, S-11, S-03).                                   |
| **Public Availability Booking**: paid calls                                | ❌🔒    | Bookable with no payment, uncapped, never expiring (S-02).                                                                                                              |
| **Session booking** (1-1 / block)                                          | 🟡🔒    | Payment, per-sitting escrow and the handshake work (#211). The gate is blind to discovery calls and group sittings (S-05, S-06). The owner can rewrite sittings (S-01). |
| **Group-session coordination**                                             | 🟡      | The engine is correct and well guarded (§3). It never governs a real group sitting, because those sittings are not mirrored (S-05).                                     |
| **Negative-consent payout**                                                | 🟡🔒    | Scheduled every 15 min, per sitting, dispute-aware. It ignores attendance (S-08) and trusts the owner-writable sitting row (S-01).                                      |
| **Digital Handshake**                                                      | ❌      | Webhook ingest is production-grade. It never matches a sitting, because no room is ever minted (S-03).                                                                  |
| **Calendar sync**                                                          | ❌      | Consent framework only. No adapter, and every provider ships disabled (S-19).                                                                                           |
| **Owner Availability editor**                                              | ✅      | `/[handle]/edit/availability` saves bands, timezone, publish and call settings in one transaction (§2.4).                                                               |
| **Privacy matrix**                                                         | ✅      | One leak remains, already logged: `call_settings` caps are anon-readable (S-16). §8.                                                                                    |
| **Pre-engagement invariants**                                              | ✅      | Discovery calls create no project, stage or ticket, and do not touch $W_i$. §9.                                                                                         |

---

## 2. Frontend surfaces and the `@projective/ui/calendar` engine

**Cross-cutting facts.**

- There is **no scheduling env gate**: there is no `SCHEDULING_BACKEND_LIVE` in `.env.example`.
  Private reads (personal, project) are live under the reader's RLS once there is a session
  (`svc/read-actor.ts:85-88`). Public reads use the anonymous client
  (`ScheduleBackendService.ts:65-70`). Comments in four files still cite a "scheduling backend gate"
  that does not exist (`EventPopoverActions.tsx:186`, `calendar-state.ts:502-503`,
  `ScheduleView.island.tsx:176-177`).
- **Islands are clean.** No Supabase or `@server` import exists in any calendar island. They call
  `/api/scheduling/*` only, through `features/calendar/core/ScheduleService.ts:21-58`.
- **Only RSVP and reschedule reach the server** (`EventModal.tsx:326-352` →
  `/api/scheduling/{rsvp,reschedule}` → `ScheduleBackendService.ts:302-352`). **Every create, move,
  delete and `.ics` import is session-local**: `useCalendarComposer.ts:59-60` ("Writes are
  session-local, as every calendar mutation is until the scheduling write path lands") and
  `calendar-state.ts:500-509`. They are lost on reload and never reach free/busy (S-25).

### 2.1 Personal Calendar — `/calendar` (`routes/(dashboard)/calendar/index.tsx`)

| Capability                                                                                  | Status           | Evidence                                                                                                                                                                                                                                                                         |
| :------------------------------------------------------------------------------------------ | :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agenda read: own events, rostered events on others' schedules, discovery calls as `booking` | ✅ live          | `ScheduleBackendService.personalCalendar` (`:216-227`) → `live-calendar.ts` (`:1204-1220`)                                                                                                                                                                                       |
| RSVP; propose, vote, approve, confirm or withdraw a reschedule                              | ✅               | `EventModal.tsx:597-604`, `:685-707`                                                                                                                                                                                                                                             |
| Create, drag-move, delete                                                                   | ❌ session-local | `CalendarWorkspace.island.tsx:171-175`, `:367`. **Delete** says "Delete this event from your calendar?" (`EventModal.tsx:744-768`) but filters an in-memory array. Gate 11 and root `CLAUDE.md` §5 (S-25).                                                                       |
| Keyboard "create at the top of the visible range" (Week); a touch tap on empty grid         | ❌ no-op         | `TimeGrid.tsx:1721-1726` → `onSelectRange`, passed `() => {}` by all three hosts (`CalendarWorkspace.island.tsx:335`, `ProjectCalendar.island.tsx:152`, `ScheduleView.island.tsx:145`). The touch path (`TimeGrid.tsx:1274-1278`) is inferred (S-28).                            |
| Answer a discovery call (confirm, decline, cancel, no-show)                                 | ❌               | RSVP is deliberately hidden for calls (`EventModal.tsx:370-375`), and nothing replaces it anywhere in `apps/web` (S-27, the UI half of S-10).                                                                                                                                    |
| Connect a calendar                                                                          | 🟡               | OAuth starts (`ConnectCalendarDialog.tsx:78-86` → `/api/integrations/*`, behind `INTEGRATIONS_BACKEND_LIVE`). Nothing syncs (S-19).                                                                                                                                              |
| `.ics` export / import                                                                      | ✅ / ❌          | Export is built in the browser (`CalendarExportModal.tsx:131`). Import toasts "Added N events…" (`CalendarImportPopover.tsx:94-105`) and saves nothing (S-25).                                                                                                                   |
| Per-event "Add to calendar" (Google, Outlook, `.ics`, mail)                                 | ❌ dead          | `EventPopoverActions.tsx` has no caller; no host passes `renderEventActions` (`Calendar.tsx:700`, `:814` only forward it) (S-39).                                                                                                                                                |
| Range covered by data vs. by the axis                                                       | 🟡               | Data is read for now−60d → now+180d (`live-calendar.ts:1166-1167`), with no range parameter (`ScheduleService.ts:23-47`). The axis runs ±1,000 weeks (`TimeGrid.tsx:111`) / ±1,500 days (`DayTimeline.tsx:73`). Weeks past the window render empty, so they read as free (S-29). |
| View state in the URL                                                                       | ❌               | View, date, zoom, search and filters are client signals (`calendar-state.ts:49-318`). View and zoom persist to `localStorage` only. Only `?event=` is addressable (`ROUTING.md:113`) (S-31).                                                                                     |

**Verdict: 🟡** The read side and coordination are real. Authoring is a demo.

### 2.2 Project Calendar — `routes/(dashboard)/projects/[projectSlug]/{calendar,[channelId]/calendar}.tsx`

- The project read is live under RLS (`ScheduleBackendService.ts:150-164`). Tasks redirect away
  (`calendar.tsx:21-23`, PRODUCT_SPEC §Task).
- RSVP, reschedule and Connect are wired (`ProjectCalendar.island.tsx:137-143`).
- Create and drag-move are session-local (`:152-155`).
- The route doc comments say `[projectId]`, while the parameter is `projectSlug` (`calendar.tsx:9`,
  `:29`).

**Verdict: 🟡** It has the same shape as `/calendar`.

### 2.3 Public Availability Booking

There are **two booking surfaces, and only one of them books.**

| Surface                                                                                                                                                                                                | What "book" does                                                                                                                                                                            | Status                         |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------- |
| Profile Hire rig → **Consultation modal** (`features/profile/components/hire/ConsultationModal.tsx`) and the contact intent (`features/contact/components/IntentFieldsets.tsx:341`)                    | `/api/services/contact-action` → `BookingBackendService.contact` → `request_discovery_call` (`BookingBackendService.ts:911-926`, `:1057`)                                                   | ✅ courtesy · ❌🔒 paid (S-02) |
| **`/[handle]/availability`** (`routes/[handle]/availability.tsx`) and **`/view/[entity]/schedule`**, **`/[handle]/view/[item]/schedule`** → `EventModal` **Book this slot** (`EventModal.tsx:709-719`) | Appends a local entry titled **"You're booked"** with `status: "confirmed"` (`ScheduleView.island.tsx:172-188`; "Session-local until the gate lands"). **It never calls the request door.** | ❌🔒 **S-26**                  |

On `/[handle]/availability`, `viewerCanBook` is true whenever a call offer exists
(`ScheduleBackendService.ts:258`). On the entity schedule it is **unconditional**, signed-out
visitors included (`:616`). A buyer is told they are booked while the provider is never asked: the
top-of-funnel conversion tool fails at the moment of conversion. Further gaps on these pages:

- A visitor gets a Session, Booking or Meeting **composer on someone else's schedule**
  (`ScheduleView.island.tsx:22-26`, `:134`, `:146-148`), local-only (S-33).
- The two entity-schedule routes have **no under-18 gate** (Decision #208; `schedule.tsx:18-29` in
  both). `/[handle]/availability` has one (`availability.tsx:27-29`) (S-32).
- **Conversion lane (gate 10).** The schedule page mounts no lane (`[handle]/_layout.tsx:185-189`;
  `viewLaneFor` matches exact `/view/{id}` only, `features/view/core/view-lane-slot.tsx:35-46`), so
  the purchase action sits in a main-stage modal. This is already logged at `DESIGN_SYSTEM.md:1485`
  (flags (f)/(q)) (S-40).
- The public read window is now−14d → now+90d (`ScheduleBackendService.ts:563-566`). The slot grid's
  own window is anchored per rail page (`Functions.md` §7), so booking is unaffected. The calendar
  view past +90d reads as free (S-29).

### 2.4 Owner Availability editor — `/[handle]/edit/availability`

✅ **Wired end to end.** The route is owner-, sign-in- and under-18-guarded (`:20-45`).
`AvailabilityEditor.island.tsx` → `ProfileService` → `GET/PUT /api/profile/[handle]/availability`
(`routes/api/profile/[handle]/availability.ts:16-35`) → `scheduling.save_owner_availability` (one
transaction, invoker under the existing policies, Functions §8). Live and session-gated
(`ProfileBackendService.ts:334`, `:354`). The templates control is disabled while there are unsaved
changes, and its tooltip says why (`:212-223`). The preset studio (#217) saves through
`/api/scheduling/presets`.

### 2.5 The `@projective/ui/calendar` engine

| Brief claim                                                      | Actual                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :--------------------------------------------------------------- | :------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Week view is an immediate-mode canvas with a two-tone focus ring | ✅                               | `.cal-tg__viewport` holds one `aria-hidden` `<canvas>` (`TimeGrid.tsx:1661-1670`). An accessible sibling layer sits beside it: a focusable `role="region"` with keyboard handling (`:1683-1695`), a `role="status" aria-live="polite"` range line (`:1700`), and one button per card (`:1728-1755`). Paint order is in `scene-paint.ts:358-383`. The two-tone ring (`strokeFocusRing`, `:384-425`) puts the halo inside and the ink outside, as `--focus-ring-shadow` composes them, and is pinned by `scene-paint.test.ts:523`.                    |
| Day timeline                                                     | ✅ hybrid                        | The canvas paints the lattice (`DayTimeline.tsx:876`), and events are HTML `EventBlock` cards (`:405`, `:994`) with native scroll via `useCalendarViewport` (`:521`).                                                                                                                                                                                                                                                                                                                                                                               |
| Month grid                                                       | ✅ continuous, **not paginated** | `month-window.ts:1-9` ("one column of weeks with no first or last row"), `MonthGrid.tsx` `OVERSCAN = 2` (`:51`). **📄 This contradicts `DESIGN_SYSTEM.md:2902-2906`** ("Month … deliberately does NOT scroll … PAGINATES"), while the §C.1 roster (`:2455`) agrees with the code (S-38, Decision #343 (e)).                                                                                                                                                                                                                                         |
| Infinite time virtualization                                     | 🟡 a large finite axis           | Week ±1,000 weeks (`TimeGrid.tsx:111-121`, `:501-504`); Day ±1,500 days; `dayWindow` in `core/layout.ts:595-617`; hour-row overscan in `useCalendarViewport.ts:267`, `:334-335`. The axis is effectively unbounded. The **data** is not (S-29).                                                                                                                                                                                                                                                                                                     |
| Accessibility overlays                                           | 🟡                               | The in-app **Reduce motion** setting does not reach the engine's JS motion: `prefersJumpToFinal` (`packages/ui/core/motion.ts:131-134`) and `scrollBehaviorFor` (`useCalendarViewport.ts:50-53`) read only the OS query, while CSS is covered by `:root[data-motion="reduced"] *` (`packages/ui/styles/index.css:1355-1360`). The canvas palette re-reads on theme and `prefers-color-scheme` only (`useGridCanvas.ts:503-530`). There is **no `forced-colors` or `prefers-contrast` reaction** anywhere in `packages/ui/calendar` (gate 2) (S-37). |
| §C.1 roster vs `mod.ts` exports                                  | 🟡                               | Complete except `TimelineView` (`mod.ts:63`), which is described only at `DESIGN_SYSTEM.md:3678-3681` (gate 5) (S-38).                                                                                                                                                                                                                                                                                                                                                                                                                              |

### 2.6 Feature-layer design-system and architecture defects (P2)

- **Raw values** (§3 token-only): `features/calendar/styles/event-modal.css:332`
  (`border-radius: 2px`), `:371` (`padding-inline: 5px`), `:1141` (a `3.5px` ring);
  `calendar-chrome.css:206` (`3px`, `45%`).
- **Inline style**: `EventModal.tsx:379` (`style={`z-index:…`}`). The custom-property styles at
  `EventAttachmentsTab.tsx:163` and `EventRescheduleTab.tsx:425` follow the house pattern.
- **Heading weight** (gate 8): `.evm__title` uses `--fw-bold` (`event-modal.css:83`, `:99`).
- **Passes**: no hex colours, no `backdrop-filter`, and `.evm-prop`'s full border is justified
  (`event-modal.css:696-697`).
- **Routes are not thin re-exports** (root §4): all six calendar routes define their handler and
  page inline (e.g. `routes/(dashboard)/calendar/index.tsx:19-29`), and the two schedule routes are
  near-copies (S-34).
- **Join link rendered as a raw `href`** (`components/tabs/EventDetailsTab.tsx:249-257`), with no
  scheme check in Zod (`packages/types/scheduling/meeting.ts:100`, length only) or in the table
  (T22). `authenticated` holds table-level INSERT/UPDATE on `scheduling.events` (G2520:458-463), and
  `trg_guard_rostered_event` does not watch `meeting_url`. So a schedule manager can store a
  `javascript:` URL that attendees click. Exploitability through `target="_blank"` varies by
  browser, but the class is stored XSS (S-30).

### 2.7 ROUTING.md

- All five page routes are documented (`ROUTING.md:109-165`).
- There is **no scheduling or booking API section**, although other domains have one. Undocumented:
  `/api/scheduling/{calendar,availability,schedule,rsvp,reschedule,presets,presets/archive,cron/horizon}`,
  `/api/sessions/{memberships/[id]/cancel,sittings/[eventId]/no-show,webhooks/[provider]}`,
  `/api/services/{slots,contact-action,call-offer,book-session}`, `/api/checkout/calendar` and
  `/api/catalogue/availability`. Only `/api/scheduling/personal` appears, inline at `:113` (S-35).
- Calendar view and date state are not addressable (S-31). Root `CLAUDE.md` §3.B asks for an
  addressable URL where state is held in a client signal.

---

## 3. The coordination engine (group and 1-on-1 reschedules)

**The rules live once, in TS, and are well tested.**

- `canReschedule` (coord.ts:454) sets the 12h lockout.
- `voteQuorum` / `majorityProposal` (coord.ts:668, :679) take a slot strictly above half of the
  entitled voters.
- `settleVote` (coord.ts:738) settles a round.
- `counterpartyAcceptRefusal` (coord.ts:553-558) decides who accepts on a 1-on-1.
- `coordination-plan.ts` applies them before every write (`:170`, `:185-190`, `:214`).

The database owns what a rule cannot: the round is still open, the winner belongs to the round, and
the round, the event and the log land together. These are `close_reschedule_round` (F1510),
`trg_guard_reschedule_*_write`, `trg_cap_reschedule_proposals` and `trg_stamp_vote_deadline`, all of
which take the same round lock.

| Spec rule                                                    | Status               | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                       |
| :----------------------------------------------------------- | :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A group change needs > 50% (PRODUCT_SPEC §Session-Based A.4) | ✅ in TS · 🟡 in SQL | Quorum is `floor(n/2)+1` over the roster minus the host (coord.ts:651-669). Pinned: 2 of 4 fails, 2 of 3 carries (`coordination.test.ts:474-477`). `close_reschedule_round` does **not** re-check the majority; it trusts its caller. It is `service_role`-only, so this is acceptable (S-12).                                                                                                                                 |
| Abstaining = no change                                       | ✅                   | coord.ts:664-665. A round with no majority `lapsed`s and the original time stands.                                                                                                                                                                                                                                                                                                                                             |
| 12h lockout                                                  | ✅ in TS · 🟡 in DB  | `trg_guard_rostered_event` stops a **client** moving a rostered `scheduling.events` row at all (F1510:1029-1039). No SQL tests the 12 hours itself, so the service role is trusted (S-12). The guard does **not** cover `projects.session_events` (S-01).                                                                                                                                                                      |
| A vote is decided while the event is still movable           | ✅                   | `fn_vote_deadline` = `LEAST(earliest slot − 12h, event start − 12h)` (F1510:480-483).                                                                                                                                                                                                                                                                                                                                          |
| Deadlines are honoured with nobody watching                  | 🟡                   | Settlement is lazy: it runs on the read path (`live-calendar.ts:85-93`, `:847-868`) and before a write. `fn_lapse_session_handshakes` lapses only `counterparty` rounds (F1155:1687-1688, :1713-1714). A `voting` round past its deadline moves the event only when somebody next reads it, and its notification never fires (S-13).                                                                                           |
| A move reaches the money clock                               | 🟡                   | `trg_sitting_follows_calendar` (TR1860:76-81) moves a sitting with its calendar mirror, but only while the sitting is `scheduled` (F1155:1758). **Only `fn_book_session_slot` writes `source_session_event_id`** (F1155:684-691). That means only 1-1 sittings are mirrored, and two-person rosters always negotiate in `counterparty` mode (coord.ts:241-242). **The majority vote never moves a real group sitting** (S-05). |
| Ballot hygiene                                               | 🟡                   | 12-slot cap is held by the DB. One attendee can fill it, and a slot has no maximum length (S-15, already logged).                                                                                                                                                                                                                                                                                                              |

---

## 4. Booking enforcement

### 4.1 The discovery-call gate

`scheduling.fn_call_request_refusal` (F1510 §4) returns NULL or one of eleven reason codes. It is
mirrored in `CALL_REFUSAL_COPY` (`packages/types/scheduling/calls.ts`) and enforced by
`trg_enforce_call_request`. It checks:

- the master and flavour switches;
- the exact duration, against the platform maximum;
- minimum notice and the booking horizon;
- call-window coverage (`fn_band_covers`: weekly bands, midnight-edge fix of 2026-09-28);
- `fn_slot_is_free`: blackouts on the raw span, events and calls with buffer geometry;
- the provider-week courtesy cap and the requester cooldown.

`request_discovery_call` (F1520:121) derives the host, fee, platform and status. A requester names
only the slot, the agenda, their timezone, a platform and the listing.

| Check                                       | Status | Evidence                                                                                                                                                                                                                                                                                                                                  |
| :------------------------------------------ | :----- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same predicate for pre-flight and hard gate | 🟡     | The DB functions are one implementation. The app's pre-flight is the TS slot grid (`slot-grid.ts`), kept in step by `slot-grid.agreement.test.ts`, not by calling `fn_can_request_call`. That is acceptable, but `Functions.md` §4's "same function backs the UI check" is aspirational.                                                  |
| Concurrency                                 | ❌     | Neither `request_discovery_call` nor `fn_enforce_call_request` takes a lock (no `FOR UPDATE` or advisory lock in F1520, F1510:892-916). Two requests for one slot under READ COMMITTED both pass, which double-books the host (S-07). `fn_book_session_slot` does lock the schedule row (F1155:634), so the fix is to take the same lock. |
| Paid calls are paid                         | ❌🔒   | See D1. Nothing writes `payment_ref` or `escrow_id`. With `auto_confirm` a paid call is born `confirmed` (F1520:198-201, :219-220) (S-02).                                                                                                                                                                                                |
| Anti-abuse on paid calls                    | ❌     | Caps and cooldowns are courtesy-only, and there is no expiry sweep, so unpaid `proposed` rows squat free/busy (S-02, S-11).                                                                                                                                                                                                               |
| Transitions after the request               | ❌     | There is no client door for confirm, decline, reschedule, cancel, complete or no-show (the UPDATE grant was removed 2026-09-28; G2520:496 is SELECT only) (S-10).                                                                                                                                                                         |

### 4.2 Cross-engine conflicts (sessions × calls × group sittings)

The two booking engines do not see each other symmetrically:

| A new…                                              | sees 1-1 sittings       | sees group sittings | sees discovery calls | sees blackouts     | sees external calendars |
| :-------------------------------------------------- | :---------------------- | :------------------ | :------------------- | :----------------- | :---------------------- |
| discovery call (`fn_slot_is_free`)                  | ✅ via the mirror event | ❌                  | ✅ (+ buffers)       | ✅                 | ❌                      |
| 1-1 session (`fn_book_session_slot`, F1155:640-643) | ✅                      | ❌                  | **❌**               | ✅                 | ❌                      |
| public grid (`get_free_busy`, F1520)                | ✅                      | ❌                  | ✅                   | ✅ (separate read) | ❌                      |

- **S-05.** Group sittings are created by the owner directly in `projects.session_events` and never
  mirrored onto the provider's schedule. They block nothing.
- **S-06.** A paid session can be booked on top of a confirmed discovery call through a stale grid
  or a race. The grid would not offer it, but the database gate does not refuse it.
- **S-19.** External calendars block nothing, because there is no sync.

---

## 5. The sessions money path

| Spec rule (PRODUCT_SPEC §Session-Based B–D, §Session-Specific Disputes) | Status         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| :---------------------------------------------------------------------- | :------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Escrow locked at checkout, one per sitting for 1-1 (#211)               | ✅             | `fn_book_session_slot` (F1155:564-751); `ck_escrows_sitting_on_seat` (T17).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| > 24h refund · < 24h forfeit · freelancer cancel = full refund          | ✅             | `cancel_cohort_membership` (F1155:777-924): per sitting on a 1-1 (:842-845), against the first sitting for a seat (:821-831).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| … reachable from the product                                            | ❌             | `SessionService.cancelSeat` (`apps/web/features/projects/core/SessionService.ts:27-39`) has **no caller**. Decision #211 flag (a) still stands (S-22).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| … a cancelled block keeps protection on sittings already paid           | ❌             | The cancel leaves started sittings' escrows `held` (:844) but sets the membership `cancelled` (:888-890). The no-show claim needs an `active` membership (:1174), and presence ignores cancelled seats (:976, :1061). The sweep then releases those escrows (S-09).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Session complete → 24h → auto-release (negative consent)                | ✅ scheduled   | `finance.auto_release_session_escrow` (F1155:1534-1641). Job `auto-release-session-escrow` every 15 min (`00005060:24-26`), enabled by default. It checks `fn_escrow_has_open_dispute` (:1595, :1621).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| "Successful" requires both parties within 15 min                        | 🟡             | `fn_session_presence` implements the rule (F1155:1028-1084), but the sweep marks a sitting `completed` purely on `end_time` (:1548-1549). `untracked` and `attendee_no_show` sittings release. Presence only feeds the provider-no-show refund (:1563-1564) (S-08).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Freelancer no-show → immediate refund                                   | ❌ in practice | The branch exists (:1552-1582) but needs `provider_meeting_id IS NOT NULL`, which nothing writes (S-03). There is also a mislabel: when the host never joins and the attendee joins after minute 15, the outcome is `untracked` (the `ELSE` at :1080), not `provider_no_show` (S-08).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Dispute: never joined → refund · both > 80% → dismiss · else manual     | 🟡             | `F1260:143-201`. It uses `>=` 80% (:196) where the spec says "> 80%", and a missing `left` event counts as present to the end (:170) (S-21). With no tracked rooms, every audit returns `ambiguous` (S-03).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| The sitting row is trustworthy evidence                                 | ❌🔒           | **S-01 (P0).** `projects.session_events` keeps the blanket `GRANT ALL … TO authenticated` (G2500:120-121). Only SELECT is narrowed (G2520:818). The policy "Manage session events" is `FOR ALL` for the project owner (P2011:495-504), and there is no guard trigger (only the slug trigger, `00001890:36-39`). So the provider can `UPDATE` a future sitting to `status = 'completed'` with `end_time = now() − 25h`, and the next sweep releases the buyer's escrow (F1155:1592-1595). The same write can null `provider_meeting_id` to suppress the no-show refund, or move a sitting with no lockout or client consent. No probe covers it (`supabase/probes/session_settlement.sql:12-26`). Not executed against a live DB; read from the grants, policy and sweep. |

---

## 6. Database triggers

| Trigger (TR1860)                                                                                          | Purpose                                                                                                                                              | Verdict                                                                                                                                                                                                                                                                                                                   |
| :-------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `trg_enforce_call_request` · BEFORE INSERT `discovery_calls`                                              | Raise the gate's refusal code                                                                                                                        | ✅ correct. ⚠️ Takes no lock (S-07). Skips when `auth.uid()` is NULL, by design: service-role callers own the rules.                                                                                                                                                                                                      |
| `trg_enforce_call_transition` · BEFORE UPDATE                                                             | Legal-transition matrix; derives `confirmed_at`, `responded_at`, `completed_at`, `cancelled_at`, `is_late_cancel`; a reschedule clears `confirmed_*` | ✅ as a legality layer. It is not an authorisation layer (it never asks who), which is why the client UPDATE path was removed. ⚠️ `confirmed → proposed` has no time check (F1510:944-950), so D3's doors must carry the lockout. Returns early when the status is unchanged. Harmless today, since no client can UPDATE. |
| `trg_log_call_event` · AFTER INSERT/UPDATE                                                                | Append `call_audit`, including `link_generated` on a `meeting_url` change (F1510:1104-1108)                                                          | ✅. `link_generated` can never fire, because nothing writes `meeting_url` (S-03).                                                                                                                                                                                                                                         |
| `trg_guard_rostered_event` · BEFORE UPDATE/DELETE `events`                                                | A client cannot move or delete a rostered event                                                                                                      | ✅. `SECURITY INVOKER` is deliberate (so `current_user` is the caller). It has **no twin on `projects.session_events`** (S-01).                                                                                                                                                                                           |
| `trg_check_schedule_timezone`                                                                             | IANA zone check                                                                                                                                      | ✅                                                                                                                                                                                                                                                                                                                        |
| `trg_cap_reschedule_proposals` · `trg_guard_reschedule_{proposal,vote}_write` · `trg_stamp_vote_deadline` | Round integrity under one lock                                                                                                                       | ✅. Quota fairness is open (S-15).                                                                                                                                                                                                                                                                                        |
| `trg_sitting_follows_calendar` · AFTER UPDATE OF time on `events`                                         | A carried round moves the sitting                                                                                                                    | ✅ for mirrored 1-1 sittings only (S-05).                                                                                                                                                                                                                                                                                 |
| `trg_session_handshake_closed`                                                                            | A rested handshake confirms the provisional sitting                                                                                                  | ✅                                                                                                                                                                                                                                                                                                                        |
| `trg_schedule_age_gate` · `trg_call_settings_age_gate` · `trg_preset_guard`                               | Minors schedule nothing with others (#208)                                                                                                           | ✅                                                                                                                                                                                                                                                                                                                        |
| Preset triggers (`trg_blueprint_preset_binding`, `trg_*_invalidate`)                                      | RRULE compile invalidation (#217)                                                                                                                    | ✅                                                                                                                                                                                                                                                                                                                        |
| **Missing**: a guard on `projects.session_events`                                                         | —                                                                                                                                                    | ❌ S-01 (D0)                                                                                                                                                                                                                                                                                                              |

---

## 7. Integrations, the Digital Handshake and Edge Functions readiness

### 7.1 Presence ingest (built, and good)

The chain is:

1. `POST /api/sessions/webhooks/[provider]` (`apps/web/routes/api/sessions/webhooks/[provider].ts`)
   reads the raw body with a 256 KiB cap.
2. `SessionBackendService.handlePresenceWebhook` (`:287-328`) dispatches to an adapter.
3. `presence/zoom.ts` verifies HMAC-SHA256 over `v0:{ts}:{raw}` with a 5-minute replay window
   (`:59-67`). It answers `endpoint.url_validation` only **after** the signature verifies, which
   closes the signing-oracle hole.
4. `projects.record_presence` (F1155:937) runs as service role only (`00002510:1937-1938`). It never
   errors, so the provider never redelivers forever, and it is idempotent on `provider_event_id`
   with a ±60-minute window.
5. `fn_session_presence` applies the 15-minute rule.

A second provider is one adapter file (`presence/mod.ts`).

### 7.2 What stops it working

| Gap                                                                                                                                                                                                                                     | Effect                                                                                                                                 | ID   |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- | :--- |
| No code writes `session_events.meeting_provider` or `provider_meeting_id` (only the probes do: `session_settlement.sql:317`, `dispute_resolution.sql:66`). `fn_book_session_slot` inserts sittings without room fields (F1155:667-668). | Every delivery is `unmatched` (:960-964), every sitting is `untracked`, the no-show refund never fires, and every claim is `ambiguous` | S-03 |
| Identity is matched by the participant email from the payload (:967-969)                                                                                                                                                                | A different Zoom email is unmatched. A guest typing someone's email asserts presence falsely.                                          | S-04 |
| `scheduling.call_attendance` has **no writer** anywhere                                                                                                                                                                                 | Discovery calls have no Digital Handshake, despite PRODUCT_SPEC §Discovery & Courtesy Calls ("Attendance is evidence")                 | S-03 |
| Deliveries are not recorded in `integrations.webhook_deliveries` (SA §3.2's dedupe store)                                                                                                                                               | Dedupe is per attendance row's last event only. Acceptable, because the math is monotone, but it diverges from SA.                     | S-20 |
| Only Zoom. The provider seed says Zoom `supports_webhooks = false` (`00005050:131-133`).                                                                                                                                                | No Meet or Teams presence. The seed contradicts the shipped route.                                                                     | S-24 |

### 7.3 Readiness by capability

| Capability                                     | Spec home                                           | Built                                                                                                                                                                    | Missing                                                                                                                                                                     | Ready?       |
| :--------------------------------------------- | :-------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------- |
| OAuth consent (calendar, conferencing)         | SA §3.2–3.3                                         | `/api/integrations/{start,callback,revoke,connections}`, `IntegrationsBackendService`, envelope-encrypted `token-vault.ts`                                               | Every calendar and conferencing provider ships `is_enabled = false` (`00005050:105-140`). KMS vs `ENCRYPTION_KEY` is unresolved (#59, flagged in `token-vault.ts`).         | 🟡 framework |
| Proactive token refresh                        | SA §3.3                                             | —                                                                                                                                                                        | Service plus `http` job                                                                                                                                                     | ❌           |
| Inbound calendar sync (busy blocks)            | SA §3.2 (Nylas broker)                              | `events.source_connection_id`, `external_event_id` and the re-sync upsert key (T22); `mask_external_events`                                                              | An adapter (`svc/integrations/adapters/` holds storage adapters only), webhook ingestion, channel renewal (`webhook_subscriptions`). Nothing writes `source_connection_id`. | ❌ (S-19)    |
| Room minting                                   | SA §2 Conferencing, PRODUCT_SPEC §Session-Based D.3 | Columns on `events`, `discovery_calls` and `session_events`; `integrations.fn_conferencing_provider`; the `call_platforms` allow-list; the `link_generated` audit action | The minting service, plus a manual-link fallback writer (PRODUCT_SPEC: "falls back to a manually supplied link")                                                            | ❌ (S-03)    |
| Presence ingest                                | PRODUCT_SPEC §Session-Based B                       | §7.1                                                                                                                                                                     | Meeting ids, registrant identity, Meet/Teams, calls                                                                                                                         | 🟡           |
| Reminders (sessions 60/15/5 min; calls 60 min) | `00005010` catalog                                  | Notification types                                                                                                                                                       | Producer, plus the queue worker (#203 flag (a))                                                                                                                             | ❌ (S-18)    |
| Discovery-call expiry                          | `discovery_call_proposal_ttl_hours`                 | The parameter and the state                                                                                                                                              | The sweep                                                                                                                                                                   | ❌ (S-11)    |
| Vote-deadline settlement                       | PM §3.5                                             | Lazy, on read                                                                                                                                                            | A job                                                                                                                                                                       | ❌ (S-13)    |

**Runtime choice.** SA §3.3 says these are Edge Functions. Everything built so far is Fresh routes
plus fat services, with pg_cron `http` jobs for anything scheduled. D6 recommends ratifying the
latter (S-20).

---

## 8. The privacy matrix ("shape is public, content is private")

| Datum                                           | Visitor (anon)                                             | Signed-in non-party                                                  | Party                                                   | Evidence                                                |
| :---------------------------------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------- | :------------------------------------------------------ | :------------------------------------------------------ |
| Working hours and call windows                  | Bands, when published and the profile is visible           | same                                                                 | full                                                    | `fn_schedule_is_public` (Functions §1)                  |
| Busy time                                       | **Spans only** (no title, id or kind), clamped to 120 days | same                                                                 | full                                                    | `get_free_busy` (F1520); `events` has no visitor policy |
| Blackouts                                       | Spans; label `Unavailable` unless `label_is_public`        | same                                                                 | full                                                    | `get_public_blackouts` (F1520)                          |
| External synced events                          | n/a (no sync)                                              | n/a                                                                  | status only when `mask_external_events` (default true)  | T22                                                     |
| Meeting URL and passcode                        | ❌                                                         | ❌, column-level revoke, including project members not on the roster | `get_event_rooms` (parties only)                        | G2520; F1510:279-285                                    |
| Session join URLs                               | ❌                                                         | ❌                                                                   | `projects.session_join_link` (funded seat, join window) | G2520:813-832                                           |
| Roster notes, ballots, history                  | ❌                                                         | ❌ (since 2026-09-28)                                                | `fn_can_see_event_coordination`                         | Functions §9                                            |
| Discovery calls, attendance, audit              | ❌                                                         | ❌                                                                   | host, requester or admin                                | `00002015:298-326`                                      |
| `call_settings` caps, cooldowns, `auto_confirm` | ⚠️ **readable row-wide via PostgREST**                     | ⚠️                                                                   | full                                                    | Policies.md "Still open" (S-16)                         |

The matrix holds except S-16. One caveat: the shape is **incomplete**, not leaky. Group sittings and
external calendars are absent from free/busy (S-05, S-19), so the public page under-reports
busyness, and that causes double-bookings rather than disclosure.

---

## 9. Pre-engagement invariants

| Invariant (PRODUCT_SPEC §Discovery & Courtesy Calls)             | Status | Evidence                                                                                                                                                                               |
| :--------------------------------------------------------------- | :----- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creates no Project, Stage or Ticket                              | ✅     | `request_discovery_call` inserts only `scheduling.discovery_calls` and notifies through `comms.fn_notify` (F1520:203-227); `BookingBackendService.contact` says the same (`:905-910`). |
| Never enters the delivery state machine                          | ✅     | Its own enum and trigger matrix (`fn_enforce_call_transition`); PM §3.5.                                                                                                               |
| Not in Workload Intensity                                        | ✅     | $W_i$ is a ticket column (`projects.tickets.workload_intensity`, T15:452), and a call holds no ticket.                                                                                 |
| A discovery call is a `booking`, not a tenth `CalendarEventKind` | ✅     | `live-calendar.ts:1204-1220`, :1494-1501 project calls as `booking`.                                                                                                                   |
| Bookable with no connected tools (manual-link fallback)          | 🟡     | Bookable ✅. The fallback link has no writer, so the call row carries no room at all (S-03).                                                                                           |

---

## 10. Finding register

> **Status 2026-11-11 (doc-derived; the Status column says how).** Fixed: S-01, S-26, S-30
> (2026-10-29); S-06, S-07, S-32, S-34, S-35, S-37, S-41 (Wave 0, 2026-10-30); S-23 (Wave 1.1); S-11
> (SCH-WP2). Partly fixed: S-02, S-03, S-04, S-05, S-08, S-16, S-18, S-19, S-25, S-36. Unverified:
> S-10. Every other finding is ruled or open and waits on the prompt named. The 2026-10-30 banner
> listed S-05 and S-16 as fixed; SCHBP and Decision #343 record only S-05's SQL half and S-16's anon
> half, and this column follows them.

Severity: **P0** money, security or data integrity · **P1** functional gap against the spec · **P2**
hygiene, drift or polish.

| ID                      | Sev    | Finding                                                                                                                                                                                                                                                                                                                          | Fix / ruling                                                                                                                                                                                                                                                                                                                                         | Status                                                                                                                                                                                                                                              |
| :---------------------- | :----- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-01                    | **P0** | The owner can rewrite `projects.session_events` (status, times, room ids): early self-payout, a suppressed no-show refund, an unconsented move (§5)                                                                                                                                                                              | **Fixed 2026-10-29.** The client INSERT/UPDATE/DELETE on `session_events`, `cohorts` and `cohort_memberships` is revoked (G2520), and the three owner `FOR ALL` policies are gone (P2011). No app path wrote them; every writer is a definer. Probe: `supabase/probes/session_write_guards.sql`. Group-sitting creation (S-05) is still to be built. | Fixed (pre-Wave 0, 2026-10-29, `660c9658`). D0's owner doors: SCH-WP1, `942c8dde`                                                                                                                                                                   |
| S-02 (= FCA N2; FDD X2) | **P0** | Paid discovery calls are bookable and auto-confirmable unpaid, uncapped, never expiring (§4.1)                                                                                                                                                                                                                                   | D1: refuse `paid` now (interim); Option C                                                                                                                                                                                                                                                                                                            | Partly fixed (the interim: `paid_unavailable`, `PAID_CALLS_LIVE = false`; SCH-WP2, `6882e0be`). Ruled → C1. Option C Open → SCH-WP6                                                                                                                 |
| S-03                    | P1     | Nothing mints rooms or writes meeting ids, so the Digital Handshake never matches and the no-show refund never fires. `call_attendance` and the manual-link fallback have no writer. (§7.2)                                                                                                                                      | D6 (room service), then D4                                                                                                                                                                                                                                                                                                                           | Partly fixed (rooms on the host's account, the sitting mirror's room and a `Join session` link, waiting sittings queued on connect: #385, #386; SCH-WP4b and SCH-WP5, not marked in the run order). Not run on a live provider account (#386, #392) |
| S-04                    | P1     | Presence identity is matched on a payload email, which is spoofable and misses mismatched accounts                                                                                                                                                                                                                               | D4                                                                                                                                                                                                                                                                                                                                                   | Ruled → C4 (b). Partly fixed (per-registrant Zoom links made at first join: #385 (d), #392; SCH-WP5, not marked in the run order)                                                                                                                   |
| S-05                    | P1     | Group sittings are never mirrored to `scheduling.events`: invisible to free/busy and both gates, and unmovable by the majority engine                                                                                                                                                                                            | Mirror at sitting creation (the D0 door), as `fn_book_session_slot` does                                                                                                                                                                                                                                                                             | Partly fixed (the SQL half: `schedule_sitting`, `retitle_sitting`, the roster-less mirror, `trg_sitting_round_guard`; SCH-WP1, `942c8dde`). The app half Open → SCH-WP7                                                                             |
| S-06                    | P1     | `fn_book_session_slot` does not test discovery calls (F1155:640-643)                                                                                                                                                                                                                                                             | Call `fn_slot_is_free` instead of `fn_has_conflicting_event` + `fn_is_blacked_out`                                                                                                                                                                                                                                                                   | Fixed (SCH-WP2's integrity half, `942c8dde`)                                                                                                                                                                                                        |
| S-07                    | P1     | `request_discovery_call` takes no lock, so concurrent requests double-book                                                                                                                                                                                                                                                       | `PERFORM … FROM scheduling.schedules WHERE id = p_schedule FOR UPDATE` before the insert                                                                                                                                                                                                                                                             | Fixed (SCH-WP2's integrity half, `942c8dde`)                                                                                                                                                                                                        |
| S-08                    | P1     | Payout ignores attendance (`untracked` / `attendee_no_show` release), and a late-joining attendee with an absent host is labelled `untracked`                                                                                                                                                                                    | Branch the `ELSE` to `provider_no_show` when `tracked`; product ruling on whether `untracked` holds                                                                                                                                                                                                                                                  | Ruled → C5 (a): a sitting with no presence data is held for review; #383 R6: the attendee is asked, then the desk. Partly fixed (an untracked sitting holds and its attendee is asked: #385 (b), #392; SCH-WP8, not marked in the run order)        |
| S-09                    | P1     | Cancelling a block strips no-show protection from sittings already paid                                                                                                                                                                                                                                                          | Claim and presence predicates key on the escrow being held, not on `cm.status = 'active'`                                                                                                                                                                                                                                                            | Open → SCH-WP8                                                                                                                                                                                                                                      |
| S-10                    | P1     | No discovery-call transition doors (confirm, decline, reschedule, cancel, no-show)                                                                                                                                                                                                                                               | D3                                                                                                                                                                                                                                                                                                                                                   | Ruled → C3. Unverified → SCH-WP3 (#385: a call "moves only through its own doors"; the run order does not mark SCH-WP3)                                                                                                                             |
| S-11                    | P1     | No discovery-call expiry sweep, so stale `proposed` rows occupy free/busy                                                                                                                                                                                                                                                        | D3 `fn_expire_discovery_calls`, sql job                                                                                                                                                                                                                                                                                                              | Fixed (SCH-WP2, `6882e0be`: `fn_expire_discovery_calls`, its job registered)                                                                                                                                                                        |
| S-12                    | P2     | The 12h lockout and the majority are TS-only; the service role is trusted (`close_reschedule_round`)                                                                                                                                                                                                                             | Acceptable; record it in Functions.md §9                                                                                                                                                                                                                                                                                                             | Open → SCH-WP7 (the Functions.md §9 note)                                                                                                                                                                                                           |
| S-13                    | P2     | Vote settlement is lazy (read path), so deadline notifications never fire; GET reads persist through the service role (`live-calendar.ts:858`)                                                                                                                                                                                   | A `scheduling-settle-votes` sql job                                                                                                                                                                                                                                                                                                                  | Open → SCH-WP7 (`scheduling.fn_settle_votes`; its job row is seeded dormant, `e18489d4`)                                                                                                                                                            |
| S-14 (= #343 (a))       | P2     | Three majority denominators: TS, the enum comment, and the `get_session_workspace` count                                                                                                                                                                                                                                         | D5                                                                                                                                                                                                                                                                                                                                                   | Ruled → C6 (D5). Open → SCH-WP9                                                                                                                                                                                                                     |
| S-15                    | P2     | One attendee can fill the 12-slot ballot; no maximum slot length                                                                                                                                                                                                                                                                 | D8                                                                                                                                                                                                                                                                                                                                                   | Ruled → C6 (D8). Open → SCH-WP9                                                                                                                                                                                                                     |
| S-16                    | P2     | `call_settings` caps and cooldowns are anon-readable                                                                                                                                                                                                                                                                             | Column-level grant, as on `events`                                                                                                                                                                                                                                                                                                                   | Partly fixed (the anon half: a column-level SELECT; SCH-WP11, `942c8dde`). The signed-in half Open → SCH-WP3                                                                                                                                        |
| S-17                    | P2     | Courtesy reliability signal is unwired (flag since #56)                                                                                                                                                                                                                                                                          | D7                                                                                                                                                                                                                                                                                                                                                   | Ruled → C6 (D7). Open → SCH-WP9 (its weight: 🧑, SCHBP §0.3 stop 6)                                                                                                                                                                                 |
| S-18                    | P1     | No reminder producer, and no queue worker (#203 (a))                                                                                                                                                                                                                                                                             | D9                                                                                                                                                                                                                                                                                                                                                   | Partly fixed (the comms queue worker is registered: Q0.3, `e18489d4`). The reminder producer Open → SCH-WP3                                                                                                                                         |
| S-19                    | P1     | No calendar sync, so external busy time is invisible to every gate                                                                                                                                                                                                                                                               | D6                                                                                                                                                                                                                                                                                                                                                   | Ruled → C4 (a); #383 R1, R3. Partly fixed (inbound busy sync and the outbound Projective calendar as built, proved on a real Google account, a real Microsoft consent not: #386, #387; SCH-WP4b, not marked in the run order)                       |
| S-20 (= #343 (b))       | P2     | SA §3.3 (Edge Functions; `webhook_deliveries` dedupe) vs the code (Fresh + pg_cron)                                                                                                                                                                                                                                              | D6; Decision #343 (b)                                                                                                                                                                                                                                                                                                                                | Ruled → C4 (a), which resolves (b). The runtime is built (#385; SCH-WP4a, not marked in the run order). #383 (b): §7.2's "the math is monotone" fails for a `left` redelivered after a rejoin                                                       |
| S-21                    | P2     | Dispute dismissal uses `>=` 80% vs the spec's "> 80%"; a missing `left` counts as present                                                                                                                                                                                                                                        | Edit F1260:196 and :170, or ratify `>=` in the spec                                                                                                                                                                                                                                                                                                  | Ruled → C5 (b), (c): code to "> 80%"; a missing `left` is not presence. Open → SCH-WP8                                                                                                                                                              |
| S-22                    | P1     | No UI calls `SessionService.cancelSeat`, so the cancel and refund rules are API-only                                                                                                                                                                                                                                             | Surface the cancel in the session workspace                                                                                                                                                                                                                                                                                                          | Open → SCH-WP7                                                                                                                                                                                                                                      |
| S-23 (= #343 (c))       | P2     | `database/scheduling/Tables.md` §3 escrow flag is stale (#126, #211)                                                                                                                                                                                                                                                             | Decision #343 (c)                                                                                                                                                                                                                                                                                                                                    | Fixed (the Q0.4 doc sweep, Wave 1.1, `94d22e84`)                                                                                                                                                                                                    |
| S-24 (= #343 (d))       | P2     | Zoom seeded `supports_webhooks = false` while the presence webhook ships                                                                                                                                                                                                                                                         | Decision #343 (d)                                                                                                                                                                                                                                                                                                                                    | Ruled → C4 (d): the seed becomes `supports_webhooks = true`. Open → SCH-WP5                                                                                                                                                                         |
| S-25                    | P1     | Every calendar create, move, delete and `.ics` import is session-local (`useCalendarComposer.ts:59-60`, `calendar-state.ts:500-509`, `CalendarImportPopover.tsx:97`). Each one toasts success, and the change is lost on reload and never reaches free/busy. **Delete** says it removes the event.                               | An event write door (`ScheduleBackendService.saveEvent` / `archiveEvent`, archive-not-delete per root §5) over `scheduling.events`. Until then, label the controls "preview only" or hide them (gate 11)                                                                                                                                             | Partly fixed (the event write door, Decision #328 (a), merged 2026-11-03, `60c8641c`). Ruled → C7 (a): what no door backs is hidden. Open → SCH-WP10                                                                                                |
| S-26                    | **P0** | **Book this slot** on `/[handle]/availability` and both entity-schedule routes appends a local "You're booked" `confirmed` entry and never calls `request_discovery_call` (`ScheduleView.island.tsx:172-188`). `viewerCanBook` is unconditional on the entity schedule (`ScheduleBackendService.ts:616`).                        | **Fixed 2026-10-29.** Book this slot opens the Consultation modal on the picked day (`request_discovery_call`, so the answer is the host's or auto-confirm's), and only for an open slot where a call offer exists. The listing schedule books nothing (`viewerCanBook: false`; a listing is bought from its lane, gate 10).                         | Fixed (pre-Wave 0, 2026-10-29, `660c9658`)                                                                                                                                                                                                          |
| S-27                    | P1     | Discovery calls show on `/calendar`, but RSVP is hidden for them (`EventModal.tsx:370-375`) and no confirm, decline, cancel or no-show control replaces it (the UI half of S-10)                                                                                                                                                 | A call-action bar on the call's modal, bound to the D3 doors                                                                                                                                                                                                                                                                                         | Open → SCH-WP3 (#385 made the call's modal read-only)                                                                                                                                                                                               |
| S-28                    | P1     | Week-view keyboard create (and, inferred, touch tap) is a no-op in every host (`onSelectRange={() => {}}`)                                                                                                                                                                                                                       | Open the composer on `onSelectRange`, or remove the control (gate 11)                                                                                                                                                                                                                                                                                | Open → SCH-WP10                                                                                                                                                                                                                                     |
| S-29                    | P1     | The calendar reads a fixed window (personal −60/+180d, public −14/+90d) under an axis of ±1,000 weeks, so later weeks render empty and read as free                                                                                                                                                                              | Range-parameterised reads keyed to the viewport, with a "not loaded" state past the window                                                                                                                                                                                                                                                           | Open → SCH-WP10                                                                                                                                                                                                                                     |
| S-30                    | P1     | Join link rendered as a raw `href`. `meeting_url` is client-writable with no scheme check, so a schedule manager can store a `javascript:` URL (stored-XSS class).                                                                                                                                                               | **Fixed 2026-10-29.** `ck_event_meeting_url_https`, `ck_call_meeting_url_https` (T22) and `ck_session_events_join_urls_https` (T15). `EventDetailsTab` and `OrderLineRow` link only what `normalizeLink` accepts.                                                                                                                                    | Fixed (pre-Wave 0, 2026-10-29, `660c9658`)                                                                                                                                                                                                          |
| S-31                    | P1     | Calendar view, date, zoom and filters live in signals and `localStorage`; only `?event=` is addressable                                                                                                                                                                                                                          | `?view=&date=&zoom=&kind=` in `ROUTING.md`, read by the SSR controller                                                                                                                                                                                                                                                                               | Ruled → P7 (Decision #338). Open → SCH-WP10                                                                                                                                                                                                         |
| S-32                    | P1     | No under-18 gate on `/view/[entity]/schedule` or `/[handle]/view/[item]/schedule` (#208)                                                                                                                                                                                                                                         | The same guard as `availability.tsx:27-29`. **Fixed 2026-10-30.** Both routes, `/[handle]/availability` and the island's `/api/scheduling/{availability,schedule}` refetch apply `restrictBooking` (`features/calendar/core/booking-gate.ts`) with `isRestrictedRequest`: nothing books and no call offer rides along.                               | Fixed (SCH-WP11, `942c8dde`)                                                                                                                                                                                                                        |
| S-33                    | P2     | Visitors get a create composer on someone else's schedule (local-only drafts)                                                                                                                                                                                                                                                    | Composer only where the viewer manages the schedule                                                                                                                                                                                                                                                                                                  | Open → SCH-WP10                                                                                                                                                                                                                                     |
| S-34                    | P2     | The six calendar routes are inline handlers, not thin re-exports of `features/` controllers; the two schedule routes are near-copies                                                                                                                                                                                             | Move the controllers under `features/calendar/routes/`                                                                                                                                                                                                                                                                                               | Fixed (SCH-WP12, `e30b4111`)                                                                                                                                                                                                                        |
| S-35                    | P2     | `ROUTING.md` has no scheduling, sessions or booking API section                                                                                                                                                                                                                                                                  | Add one                                                                                                                                                                                                                                                                                                                                              | Fixed (SCH-WP12, `e30b4111`)                                                                                                                                                                                                                        |
| S-36                    | P2     | Feature CSS raw values (`event-modal.css:332`, `:371`, `:1141`; `calendar-chrome.css:206`), inline `z-index` (`EventModal.tsx:379`), `.evm__title` at `--fw-bold` (gate 8)                                                                                                                                                       | Tokenise; drop to `--fw-semibold`                                                                                                                                                                                                                                                                                                                    | Partly fixed (SCH-WP12, `e30b4111`). The `.evm-rich` h1–h3 `--fw-bold` residue (`event-modal.css:633`) Open → SCH-WP10                                                                                                                              |
| S-37                    | P2     | Engine JS motion ignores the in-app Reduce motion setting; the canvas does not react to `forced-colors` or `prefers-contrast`                                                                                                                                                                                                    | `prefersJumpToFinal` / `scrollBehaviorFor` also read `data-motion`; repaint on contrast and forced-colors media changes, with a forced-colors palette                                                                                                                                                                                                | Fixed (SCH-WP12, `e30b4111`)                                                                                                                                                                                                                        |
| S-38 (= #343 (e))       | P2     | 📄 `DESIGN_SYSTEM.md:2902-2906` says Month paginates; the code and the §C.1 roster say it scrolls continuously. The roster also omits `TimelineView`.                                                                                                                                                                            | Decision #343 (e); amend §B prose; add `TimelineView` to §C.1                                                                                                                                                                                                                                                                                        | Ruled → C7 (b). Open → SCH-WP10                                                                                                                                                                                                                     |
| S-39                    | P2     | `EventPopoverActions` (Add to calendar) is dead code; four comments cite a nonexistent scheduling env gate                                                                                                                                                                                                                       | Mount it or delete it; correct the comments                                                                                                                                                                                                                                                                                                          | Open → SCH-WP10                                                                                                                                                                                                                                     |
| S-40                    | P2     | The entity schedule mounts no conversion lane, so Book lives in a main-stage modal (gate 10; already logged at `DESIGN_SYSTEM.md:1485`, flags (f)/(q))                                                                                                                                                                           | Ruled under the existing flag                                                                                                                                                                                                                                                                                                                        | Open → SCH-WP10 (DESIGN_SYSTEM flag (q) of #157; (f) was resolved by #183, per SCHBP)                                                                                                                                                               |
| S-41                    | P1     | Signed out, `/[handle]/availability` paints an empty page: `.cal-surface--full` (`block-size: 100%`) sits in `.pf-scope--calendar` (`min-block-size: 100%`, `profile.css`) inside the guest shell's `display: block` `.site__main` (`site-shell.css`), so it resolves to 0px high (measured 2026-10-29 on `dev:mock`, 1280×800). | Give the guest shell's main the same flex column the dashboard shell has, or size the full-page surface from the viewport                                                                                                                                                                                                                            | Fixed (SCH-WP12, `e30b4111`)                                                                                                                                                                                                                        |

## 11. Not checked / limits

- The body of `finance.sweep_disputes` beyond its header, and `fn_confirm_seat`.
- S-01 was **not executed** against a live database. It follows from the grants, policy, trigger set
  and sweep as read.
- §2 is a code reading. Only `/@juno/availability` and `/view/[entity]/schedule` were opened in a
  browser (`dev:mock`, 2026-10-29, after the S-26 fix); S-41 was found there. S-28's touch path and
  S-30's exploitability through `target="_blank"` are inferred.
- Whether a connected calendar would sync onto the grid: no adapter exists to test. `dev:mock`
  behaviour was not examined.
- RRULE evaluator correctness (`evaluate.ts`) beyond its tests' existence (#217 verified it).
- SDG's analyses (§12) are a code reading of 2026-10-29. Its Option B Workload Intensity cell is
  inferred (§12.1.3).
- The statuses that cite Decisions #383–#392 come from those rows, not from SCHBP's run order, and
  none of that build has run on a live provider account (#386, #392).
- The facts absorbed from FDD (§12.1.5, §12.2.5, §12.2.6) keep FDD's own line references (S1155 is
  F1155 at FDD's snapshot), which differ by a few lines from this audit's F1155 references.

---

## 12. Decisions and rulings (from SDG)

### 12.0 The decision table

> **Status 2026-11-11.** The owner ruled D1–D9 on 2026-10-30 as FQ Part C rows C1–C7 and Q0.3,
> recorded as **Decision #343** in `reference/decisions/decisions-122-126.md` (index line in
> `reference/decisions/README.md`). SDG drafted that row as "#335", a number the providers spec took
> the same day (FQ Q0.1 (a)). The rulings are not restated here: each row names its ruling.

| ID | Question                                                                | Findings            | Ruling (FQ Part C)                                                                                                                                                             | Decision #                                      | Status                                                                                                                                                                             |
| :- | :---------------------------------------------------------------------- | :------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D0 | Who may write a session sitting's time and status                       | S-01, S-05          | A fix, not a ruling: nobody directly; client writes are revoked, and the owner gets doors                                                                                      | #343 (built before the rulings)                 | Fixed (the revocation, 2026-10-29, `660c9658`; the doors `schedule_sitting` and `retitle_sitting` with S-05's mirror, SCH-WP1's SQL half, `942c8dde`). The app half Open → SCH-WP7 |
| D1 | The money path for a paid 1-on-1 discovery call                         | S-02 (= FCA N2)     | C1 ⭐ paid calls off now, then Option C (= FDD D-2, X2)                                                                                                                        | #343; #337 D-2                                  | Partly fixed (the interim, SCH-WP2, `6882e0be`). Option C Open → SCH-WP6                                                                                                           |
| D2 | The 24h cancellation window versus the 12h reschedule lockout           | S-05 (latent), S-12 | C2 ⭐ (a) 100% forfeit; (b) Option C, a 60-minute grace, a provider move counts as a cancellation; (c) a 24h review window, then 7 days pending (= FDD D-1, D-4; X1, X5)       | #343; #337 D-1, D-4; #71 (a), #72 (b), #211 (c) | Open → SCH-WP7. Until then a group sitting keeps its time (`trg_sitting_round_guard`, `942c8dde`). #344 (f) is open                                                                |
| D3 | Who may move a discovery call, and when                                 | S-10, S-11, S-27    | C3 ⭐ the door matrix (§12.3.1); SCH-WP3's 🧑 → Option A, the counterparty of the last proposal confirms (#383)                                                                | #343; #383                                      | The expiry row Fixed (SCH-WP2, `6882e0be`). The doors Unverified → SCH-WP3 (#385 says a call "moves only through its own doors"; the run order does not mark SCH-WP3)              |
| D4 | How presence identifies a person                                        | S-03, S-04          | C4 (b) ⭐ per-registrant join links, email only as a flagged fallback                                                                                                          | #343; #383 (b), R5; #392                        | Partly fixed (per-registrant Zoom links, #385 (d), #392; SCH-WP5, not marked in the run order)                                                                                     |
| D5 | The majority denominator                                                | S-14                | C6 ⭐ the TS rule; the enum comment corrected; the workspace read excludes the host                                                                                            | #343 (a)                                        | Open → SCH-WP9                                                                                                                                                                     |
| D6 | Edge Functions, or Fresh routes plus pg_cron, for sync and room minting | S-19, S-20, S-24    | C4 ⭐ (a) Fresh + pg_cron `http`; ✎ (c) the `ENCRYPTION_KEY` env (#59); ⭐ (d) the Zoom seed set to true; ✎ provider meetings created automatically, with links for both sides | #343 (b), (d); #59; #383 R1, R3                 | Partly fixed (the runtime, rooms and inbound sync as built, #385, #386, #387; SCH-WP4a and SCH-WP4b, not marked in the run order). No real Microsoft or Zoom consent proved (#386) |
| D7 | Whether courtesy-call reliability feeds Standing                        | S-17                | C6 ⭐ low weight, presence-verified no-shows only, one mark per counterparty per 30 days                                                                                       | #343                                            | Open → SCH-WP9. The weight is SCHBP §0.3 stop 6 (🧑, open)                                                                                                                         |
| D8 | Ballot quota and the maximum replacement-slot length                    | S-15                | C6 ⭐ 3 unapproved attendee slots; a replacement keeps the original duration; a 24h span backstop                                                                              | #343                                            | Open → SCH-WP9                                                                                                                                                                     |
| D9 | The comms queue worker (#203 flag (a))                                  | S-18                | Q0.3 ⭐ register the whole job set                                                                                                                                             | #343; #203                                      | Fixed for the worker (`comms-process-queue`, `e18489d4`). The `scheduling-reminders` job Open → SCH-WP3                                                                            |

D0 is a fix, not a trade-off. It is listed first because it decides how D1 and D2 are built: both
lean on the sitting row being trustworthy.

### 12.1 D1 — the paid 1-on-1 call escrow gap

> **Ruled:** C1 = D1 = FDD D-2 (X2; FCA N2) → ⭐ the paid flavour off now, then Option C (§12.1.3),
> with money held at request and refunded on decline or expiry, and `paid_enabled` requiring
> payout-ready (#337 M4). Decision #343.
>
> **Status:** §12.0 (the interim shipped; Option C → SCH-WP6, which waits on finance's F·DB7 and
> F·SV4, SCHBP §0.2). Since the ruling, #392 guards the paid rooms a paid consultation will inherit,
> and #408 gives an availability rule its own call price, hidden while `PAID_CALLS_LIVE` is false.

#### 12.1.1 Premise correction: the flag as written was stale

`database/scheduling/Tables.md` §3 framed this as "relax `finance.escrows` or auto-provision a
session micro-project". Its two stale facts are now rows of §0, and the flag itself was corrected in
Wave 1.1 (S-23).

The real question is therefore no longer which architecture to build. It is whether a paid call
should ride the rail that already exists, and what that means for the "a discovery call creates no
Project" sentence in `PRODUCT_SPEC.md`.

#### 12.1.2 Live exposure today

> **Status:** contained on 2026-10-30 by SCH-WP2 (`6882e0be`), with S-11's expiry sweep. The text
> below is the 2026-10-29 reading.

This is not a roadmap item. A paid consultation is bookable now:

- The Consultation modal offers "Paid consultation · £X"
  (`apps/web/features/profile/components/hire/ConsultationModal.tsx:418-427`).
- `BookingBackendService.contact` → `bookDiscoveryCall` → `scheduling.request_discovery_call`
  (`packages/backend/services/booking/BookingBackendService.ts:911-926`, `:1057`).
- The fee is copied onto the row (F1520 `request_discovery_call`), but **no code anywhere writes
  `payment_ref` or `escrow_id`**.
- With `auto_confirm` on, the call is born `confirmed` and unpaid.

Two abuse paths follow from that:

1. **Calendar squatting.** The weekly cap and the cooldown apply to courtesy calls only
   (`database/scheduling/Functions.md` §4). Nothing expires a `proposed` call, because the sweep
   does not exist (S-11). Every proposed call occupies free/busy (`get_free_busy` unions calls in
   `proposed`). So one signed-in account can block every paid slot of a provider for up to
   `max_advance_days` (60), at no cost.
2. **Stiffed providers.** A provider who enables paid calls is told a fee will be charged, and none
   is.

**Interim containment** is one line in each of two places: refuse `p_call_type = 'paid'` in
`request_discovery_call` (F1520) with a new refusal code `paid_unavailable`, and hide the paid card
in `ConsultationModal`. Courtesy calls are unaffected.

#### 12.1.3 Options

|                        | **A. Relax `finance.escrows`**                                                                                                                                                                                                                                                                        | **B. Micro-project per call**                                                                           | **C. One Consultations engagement per host (recommended)**                                                                                                                                                                                                                         | **D. Retire the paid flavour**                                                                          |
| :--------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| What                   | `project_stage_id` becomes nullable. Add `discovery_call_id` as a new escrow subject, and extend `ck_escrows_one_subject`.                                                                                                                                                                            | Each paid call provisions its own session-format project, stage, cohort and sitting.                    | A paid call becomes a sitting on the host's **one** unlisted session engagement (`session_kind = 'consultation'`), created on first use exactly as `fn_session_engagement_for` makes one per listing. The `discovery_calls` row stays the funnel record and points at its sitting. | No paid discovery call. A provider who wants to sell consultation time publishes a 1-1 Session listing. |
| Protected-table change | **Yes.** It alters a NOT NULL on `escrows` (root `CLAUDE.md` §1, Additive Rule), so it needs explicit human approval.                                                                                                                                                                                 | No                                                                                                      | No. It adds one CHECK value on `projects.projects.session_kind` (`00000015:61-62`) and one FK column on `discovery_calls`.                                                                                                                                                         | No                                                                                                      |
| Money logic            | **A second settlement engine.** About 25 finance and session function references resolve through `project_stage_id`: F1200 (6), F1210 (7), F1260 (2), F1265 (2), F1155 (8). Each must learn a stage-less escrow. Release, cancel windows, no-show and disputes would all be re-implemented for calls. | Reuses #211                                                                                             | **Reuses #211 unchanged**: release, cancel, no-show, claim, fee (`fn_escrow_fee_bp`, F1155:389)                                                                                                                                                                                    | None                                                                                                    |
| Spec impact            | Keeps "creates no Project" true                                                                                                                                                                                                                                                                       | Breaks it badly: one project per 30-minute call                                                         | The paid half needs one amended sentence (§1.4). Courtesy is untouched.                                                                                                                                                                                                            | Removes the Paid row from §Discovery & Courtesy Calls                                                   |
| Workload Intensity     | Untouched                                                                                                                                                                                                                                                                                             | Untouched (inferred): $W_i$ is a ticket column (`00000015:452`) and session engagements hold no tickets | Untouched, for the same reason                                                                                                                                                                                                                                                     | Untouched                                                                                               |
| UX                     | Clean                                                                                                                                                                                                                                                                                                 | Project-list spam, an Overview and notifications per call                                               | Invisible to both parties: an unlisted engagement filtered out of the project lists by its `session_kind`                                                                                                                                                                          | One more step for a provider: create a listing                                                          |
| Commercial             | Fee capture needs new code                                                                                                                                                                                                                                                                            | Fee captured. Providers see clutter.                                                                    | Fee captured through the existing session rail, with no new money surface. It strengthens the "consult → engage" funnel against Upwork Consultations.                                                                                                                              | Weakest: the profile-level paid call disappears                                                         |
| Size                   | Large, and risky                                                                                                                                                                                                                                                                                      | Medium                                                                                                  | **Small to medium**                                                                                                                                                                                                                                                                | Trivial                                                                                                 |

**Ruled:** C1 = Option C, with D as the zero-code interim (Decision #343). Option A was not taken,
so `finance.escrows.project_stage_id` stays NOT NULL.

#### 12.1.4 Recommendation: Option C, with D as the zero-code interim

**Ruled:** as recommended (C1, Decision #343). **Status:** Open → SCH-WP6, which fits
`fn_book_consultation`'s shape to the checkout path (SCHBP SCH-WP6). Of the same-change obligations,
`Tables.md` §3 is done (S-23).

**Why C.** It is the only option that adds no money logic. Settlement, cancellation, presence and
disputes were proven for 1-1 sittings by `supabase/probes/session_settlement.sql` (17 checks,
Decision #211). Option A forks all of that onto a protected table to save one CHECK value. B fails
the anti-gig test in root `CLAUDE.md` §3.A: administratively, a paid call would look exactly like a
paid engagement, which is precisely the distinction `PRODUCT_SPEC.md` §Discovery & Courtesy Calls
exists to keep.

**The money moment.** Hold at request, not at confirmation. `PRODUCT_SPEC.md` §Session-Based C
already says "Booking → At Checkout → Escrow Locked". A host deciding on a request that is already
funded is the trust signal that makes paid calls worth offering. A `declined` or `expired` call
refunds through `finance.fn_refund_seat_escrow`, the same door a provider no-show uses. Holding
first also kills the squatting path in §1.2, because a held slot now costs the squatter money.

**Exact shape** (all edits in place, root `CLAUDE.md` §1):

```sql
-- 00000015_tables_projects.sql — projects.projects.session_kind CHECK gains one value
CHECK (session_kind IN ('none', 'normal', 'group', 'consultation'))

-- 00000022_tables_scheduling.sql — scheduling.discovery_calls gains the sitting it settles on
session_event_id uuid REFERENCES projects.session_events (id) ON DELETE RESTRICT,
CONSTRAINT ck_call_paid_has_sitting CHECK (
    call_type = 'courtesy' OR status IN ('declined', 'expired') OR session_event_id IS NOT NULL
)

-- 00001155 §4c — the host's one consultations engagement (advisory-locked per schedule, like
-- fn_session_engagement_for is per listing)
CREATE OR REPLACE FUNCTION projects.fn_consultation_engagement_for(p_schedule_id uuid)
RETURNS TABLE (o_project_id uuid, o_stage_id uuid) ...;

-- 00001520 — request_discovery_call keeps its signature; for call_type = 'paid' it is reached only
-- through checkout (place_wallet_order gains a `discovery_call` line kind) which calls:
CREATE OR REPLACE FUNCTION projects.fn_book_consultation(
    p_call_id uuid, p_payer_type text, p_payer_id uuid, p_order_line_id uuid
) RETURNS jsonb;  -- { session_event_id, escrow_id }: one-seat cohort, one sitting, one escrow
```

`discovery_calls.escrow_id` stays, so the existing column is honoured. It is set from the sitting's
escrow, and nothing is dropped.

**`PRODUCT_SPEC.md` wording to ratify** (§Discovery & Courtesy Calls, Paid row): _"A paid
consultation's money is held on the provider's hidden Consultations engagement — one per provider,
never shown as a project — so it settles exactly as a 1-1 Session sitting does. It creates no
project either party manages, and it does not count toward Workload Intensity."_

**Same-change obligations:**

- `database/scheduling/Tables.md` §3: retire the stale flag.
- `database/projects/Functions.md`: the two new functions.
- `@projective/types/scheduling/calls.ts`: `session_event_id` and `paid_unavailable`.
- `PM` §3.5: the paid call's states gain "held at request, refunded on decline or expiry".

#### 12.1.5 Finance's riders and the X2 facts (absorbed from FDD D-2, X2 and FCA N2)

**X2 (FDD), the contradiction behind S-02.** `PRODUCT_SPEC.md` §Discovery & Courtesy Calls says a
paid call's escrow is the "Session money path", its KYC "follows the standard Session rules", and
the call "creates **no** Project, Stage, or Ticket". Against that stood the escrow's NOT NULL keys
(§0). In code there was no money path: `request_discovery_call` copies the fee and may confirm the
call unpaid (F1520:196-265). FCA N2 adds that the price is held on the settings and on the row
(`ck_call_fee_matches_type`, `00000022:427-468`) and that the host has no payout-ready check.
**Ruled:** C1 (D-2).

**Finance's riders on Option C.** FDD D-2: "Finance concurs, and asks that the ruling also settle":

1. **The host's payout-ready gate.** Enabling paid calls in Settings (`call_settings.paid_enabled`)
   must require `fn_freelancer_payout_ready`, the same rule D-7 applies to a listing. Without it,
   Option C escrows money for a host who cannot be paid: the exact forever-escrow the guarantee
   forbids. **Ruled:** into C1 (`paid_enabled` requires payout-ready, #337 M4).
2. **Fee and window.** The call's release charges the payer's platform fee and clears the 7-day
   window, like any session sitting (D-4). No new money rule.
3. **The protected table stays untouched.** Option C keeps
   `finance.escrows.project_stage_id NOT
   NULL`. Relaxing it (scheduling Option A) would fork
   about 25 stage-keyed function references in F1200 / F1210 / F1260 / S1155 and needs explicit
   approval under the Additive Rule. **Finance recommends against it.** **Ruled:** C1 chose Option
   C.

**Commercial (FDD D-2).** A paid consultation is a top-of-funnel conversion product, and the
cheapest proof of a provider's value. Delivering it free trains providers to take payment
off-platform, which is the leakage Decision #147 polices.

### 12.2 D2 — TTE window alignment

> **Ruled:** C2 = D2 = FDD D-1, D-4 (X1, X5; #71 (a), #72 (b), #211 (c)) → ⭐ (a) a late
> cancellation forfeits 100%, as built and in #171 (§12.2.5); ⭐ (b) Option C of §12.2.3, with the
> 60-minute grace and the provider-move rule of §12.2.4; ⭐ (c) a 24h **review window**, then 7 days
> of pending (§12.2.6). Decision #343, which closes FDD X1 and X5. **Status:** §12.0; the open stop
> is #344 (f), a started cohort's dissenters (🧑, SCHBP §0.3 stop 4).

#### 12.2.1 Every time window in force

| Window                        | Value                 | Where                                                                                   | Governs                                                                                                      |
| :---------------------------- | :-------------------- | :-------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| Session cancellation notice   | 24h                   | `session_cancel_notice_hours` (`00005001:20`)                                           | Refund versus forfeit per sitting (`cancel_cohort_membership`, F1155:777)                                    |
| Reschedule lockout            | **12h**               | `RESCHEDULE_LOCKOUT_HOURS` (coord.ts:56), TS only (S-12)                                | No move inside this window, for any event                                                                    |
| Vote resolution lead          | 12h                   | `VOTE_RESOLUTION_LEAD_HOURS` (coord.ts:68); SQL twin `fn_vote_deadline` (F1510:480-483) | A vote closes this long before the earliest ballot slot, or at the lockout, whichever comes first            |
| Set-session handshake         | 72h, capped at T−24h  | `set_session_schedule_hours` (`00005001:22`), F1155:703-704                             | A pencilled-in sitting's agreement deadline                                                                  |
| Payout (negative consent)     | 24h after the end     | `session_payout_hours` (`00005001:12`)                                                  | Sweep release (F1155:1584-1604)                                                                              |
| Presence                      | first 15 min          | `session_presence_minutes` (`00005001:18`)                                              | The success and no-show outcome (F1155:1028-1084)                                                            |
| Join link opens               | T−10 min              | `session_join_lead_minutes` (`00005001:16`)                                             | `projects.session_join_link`                                                                                 |
| Discovery-call late cancel    | 24h                   | `discovery_call_cancellation_window_hours`                                              | **A flag only**: `is_late_cancel`                                                                            |
| Discovery-call minimum notice | 12h (default 720 min) | `call_settings.min_notice_minutes`                                                      | The earliest bookable slot                                                                                   |
| Discovery-call proposal TTL   | 72h                   | `discovery_call_proposal_ttl_hours` (`00005001:150`)                                    | **Nothing.** The sweep does not exist (S-11). Built since: `fn_expire_discovery_calls` (SCH-WP2, `6882e0be`) |
| Pending clearing (FDD X5)     | 7 days                | `pending_releases`; `pending_release_days` (#191)                                       | The clearing after the 24h sweep, before money is Available (§12.2.6)                                        |

The set-session handshake is the one window already aligned to the money window: it is capped at
T−24h. The reschedule rules are not.

#### 12.2.2 What the 12h/24h gap actually exposes

The standing flag (PM §3.5, Decisions #71(a), #72(b), #211(c)) says an attendee may _move_ a session
between T−24h and T−12h that they could no longer _cancel_ without forfeiting. Read against the
code, that risk is narrower than stated, and a different one is larger.

- **An attendee cannot move anything alone.** A slot reaches the ballot only if the host proposed it
  or approved it (coord.ts:466). On a 1-on-1, the party who did not offer a time is the one who must
  accept it (coord.ts:553-558). So every move inside T−24h…T−12h has the provider's consent. A
  provider who agrees to move at T−20h has waived their time protection. That is a legitimate
  choice, not a loophole.
- **The real exposure is the dissenting attendee on a group session.** The host can put a move to a
  vote that closes as late as T−12h. If a majority carries it, an attendee who voted against it or
  abstained now holds a seat at a time they did not choose. Their cancellation is judged against the
  new start, which may already be inside 24h, so they **forfeit their money for a change the
  provider initiated**. The spec's own rule ("Freelancer Cancel → Auto-Refund") points the other
  way. _Latent today_: group sittings are never mirrored onto the calendar, so no vote can move one
  yet (S-05). It becomes live the moment that gap is fixed.
- **Bookings born inside the window.** `fn_book_session_slot` accepts any future start
  (F1155:614-617), and a discovery call's default minimum notice is 12h. A session booked at T−6h is
  inside the forfeit window from its first second. Cancelled two minutes later, it forfeits 100%.
  Under D1 a paid call inherits this. No grace rule exists (`grep grace` in F1155 finds nothing).

#### 12.2.3 Options

|                         | **A. Raise the lockout to 24h everywhere**                                                                            | **B. Keep 12h; price late moves**                                                                                     | **C. Money-bearing events use the money window (recommended)**                                                                                                                                          |
| :---------------------- | :-------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule                    | `RESCHEDULE_LOCKOUT_HOURS = 24` for every event                                                                       | A move whose decision lands inside T−24h counts as a provider cancellation for anyone who did not vote for the winner | For an event with money behind it (`source_session_event_id IS NOT NULL`, or a paid call under D1), lockout = vote lead = `session_cancel_notice_hours`. Other events (syncs, milestones) keep 12h/12h. |
| Effect on dissenters    | Partly fixed: the decision lands by T−24h of the old start, but the new slot may still be only 12h after the decision | Fixed, but a new refund branch is needed                                                                              | **Fixed**: the decision lands ≥ 24h before both the old start and the earliest new slot, so every attendee can still cancel against either time with a full refund                                      |
| Effect on project syncs | Needlessly rigid                                                                                                      | None                                                                                                                  | None                                                                                                                                                                                                    |
| Code                    | Change one constant and its SQL twin                                                                                  | A new branch in `cancel_cohort_membership`, plus vote provenance at cancel time                                       | `lockoutHoursFor(event)` and `voteLeadHoursFor(event)` in coord.ts read the parameter. `fn_vote_deadline` takes the event's money flag. `coordination.contract.test.ts` re-pins.                        |

**Ruled:** C2 (b) = Option C (Decision #343).

#### 12.2.4 Recommendation: Option C, plus two small rules

1. **The money window governs money-bearing events.** The windows become one parameter
   (`session_cancel_notice_hours`) instead of a TS literal, so a future change to the cancel window
   moves the lockout with it.
2. **Born-inside grace.** A booking made inside the cancellation window may be cancelled for a full
   refund within **1 hour** of booking, while the sitting has not started. That is a new parameter,
   `session_late_booking_grace_minutes = 60`.
3. **Provider-initiated change = provider cancellation.** On a 1-on-1 or a group session, if a
   _host-proposed_ move carries inside the money window, every attendee who did not vote for the
   winner keeps a refund-eligible cancellation until the new start. Under (1) this branch should be
   unreachable. It is the backstop if the parameters are ever set apart.

**Discovery calls under D3.** A courtesy call has no money, so the 12h lockout is fine. A paid call
under D1 inherits (1) to (3) through the session rail.

**Same-change obligations:**

- `PRODUCT_SPEC.md` §Session-Based C: a row for "Reschedule".
- `finance-model.md` §4: the grace minutes. Also retire its stale 50% late-cancel line, already
  overruled by the hierarchy (decisions index, second-order conflicts).
- PM §3.5: four named caps become two per class of event.
- `coordination.contract.test.ts`.

**Ruled:** all three rules as written, with a 60-minute grace (C2 (b), Decision #343). **Status:**
Open → SCH-WP7. Of the same-change obligations, FM §4's 50% line is corrected (#343), and the
`PRODUCT_SPEC.md` §Session-Based C "Reschedule" row was written in Wave 1.1 (SCHBP §0.3 stop 4 cites
it at `:134`). The rest land with SCH-WP7 and SCH-Z1.

#### 12.2.5 Late cancellation economics (absorbed from FDD D-1, X1)

**X1 (FDD).** `finance-model.md` §4 gave the freelancer a **50%** penalty fee on a cancellation
under 24h. `PRODUCT_SPEC.md` §Sessions C (table, `:107`) and §Cancellation (`:319`) say **full
forfeit** to the freelancer. The code forfeits **100%** inside `session_cancel_notice_hours` (24),
net of the 5% fee, through the pending window, judged per sitting (`cancel_cohort_membership`,
S1155:777-854; "There is no 50% split", :766-767; Decision #171). FM §4's own note conceded that
PRODUCT_SPEC wins, and `database/scheduling/{Tables,Functions}.md` still said "deliberately not
resolved". FDD D-1's options follow.

| Option                             | Pros                                                                                                                                               | Cons                                                                                                                                                 |
| :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Ratify 100% (as built)**      | No code change. Matches the "Time Protection" promise that makes paid sessions worth offering. The refund/penalty columns already record outcomes. | Harsh on a buyer with a genuine emergency                                                                                                            |
| B. 50% penalty                     | Softer for buyers                                                                                                                                  | A money-path change in a proven settlement engine (`session_settlement.sql`, 17 checks). Weakens the provider promise. Contradicts the spec's table. |
| C. Tiered (100% < 12h, 50% 12–24h) | Fair at the edges                                                                                                                                  | A third rule to explain. It interacts with the 12h reschedule lockout that scheduling D2 proposes to move to 24h.                                    |

**Recommendation: A**, with two guards: (i) scheduling D2's "born inside the window" grace, so a
session rescheduled into the window is not forfeited the moment it is moved; and (ii) a provider may
voluntarily refund a forfeit (a refund door, provider-initiated, which is a D-12 item). **Lands
with:** strike FM §4's 50% line and its note; retire the flags in `database/scheduling/Tables.md` §3
and `Functions.md` §6; one sentence in `PRODUCT_SPEC.md` §Sessions C citing #171.

**Ruled:** C2 (a) = A, 100% (Decision #343, which closes X1; FM §4 is corrected). Guard (i) is C2
(b)'s grace. Guard (ii) is FDD D-12's last row, ruled with M8 (#337). **Residual (SCHBP §0.3, for
SCH-Z1):** FM §4 (`:182`) still says a freelancer cancel refunds "all remaining sessions", while
PRODUCT_SPEC (`:130`, `:352`) and Decision #171 (D) say a full refund at any time.

#### 12.2.6 Session release timing (absorbed from FDD D-4, X5)

**X5 (FDD).** `PRODUCT_SPEC.md` §Sessions C's table says "Session Complete → **Pending Window:
24-hour countdown**", then "Payout Release T+24h → Payment sent to Freelancer wallet", while
`PRODUCT_SPEC.md` §5 and #191 say a session payout "show[s] as **Pending** for 7 days". The code
does both: a 24h negative-consent sweep (`session_payout_hours`, S1155:1586-1598), **then** 7 days
of `pending_releases`. Eight days from sitting to Available.

| Option                                                                                              | Pros                                                                                                                 | Cons                                                                                                                     |
| :-------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| **A. Keep both; rename** the 24h step "**Review window**" and keep "Pending" for the 7-day clearing | One meaning per word. The 24h protects the attendee, and the 7 days protects the platform against early chargebacks. | Eight days to Available is slow next to a consultant paid by direct card                                                 |
| B. Sessions skip the 7-day clearing                                                                 | Next-day money for consultants                                                                                       | Chargeback exposure moves to the platform (W4 recovers from the payer only). Breaks #191's single rule for earned money. |
| C. One 7-day window from the sitting's end, with the no-show claim open for the first 24h           | Fastest single rule                                                                                                  | Re-engineers the session sweep; two clocks fused into one row                                                            |

**Recommendation: A.** The fix is vocabulary: `PRODUCT_SPEC.md` §Sessions C's table says "Pending
Window: 24-hour countdown", and §5 says "Pending for 7 days". Instant payouts (D-9) are the
sanctioned way to buy speed later. **Lands with:** the two table rows reworded; the wallet's
Upcoming copy reading `pending_release_days` (N21).

**Ruled:** C2 (c) = A: keep both steps and call the 24h step the **review window** (Decision #343,
which closes X5). Decision #383 R6 uses that name for the attendee's ask. **Status:** the wording
edits are Unverified → SCH-Z1; the Upcoming copy (N21) is FCA's.

### 12.3 The smaller rulings

#### 12.3.1 D3 — discovery-call transition doors

> **Ruled:** C3 ⭐, the matrix as written (Decision #343). SCH-WP3's 🧑 (who accepts a re-proposed
> time) → Option A: the counterparty of the last proposal confirms (#383).
>
> **Status:** §12.0. The expiry job `scheduling-expire-discovery-calls` runs every 15 minutes, and
> #385 (g) logs that `fn_expire_discovery_calls` can complete a short courtesy call soon after it
> ends, which narrows the window to report a no-show on it.

There is no client door past `request_discovery_call` (S-10), so a host cannot confirm, decline or
reschedule from the product. Each move gets its own definer RPC naming who may make it.
`fn_enforce_call_transition` stays the legality authority.

| Door (`scheduling.*`)                   | Who                            | From → to                             | Time rule                                                                                                                       |
| :-------------------------------------- | :----------------------------- | :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------ |
| `confirm_discovery_call(call)`          | host                           | `proposed → confirmed`                | Before the proposed start                                                                                                       |
| `decline_discovery_call(call, reason?)` | host                           | `proposed → declined`                 | Any time. Under D1, refunds the hold.                                                                                           |
| `propose_call_time(call, start, end)`   | host or requester              | `confirmed → proposed` (a reschedule) | Outside the lockout (12h courtesy; D2 for paid). The slot is re-judged by `fn_call_request_refusal`, excluding the call itself. |
| `cancel_discovery_call(call, reason?)`  | host or requester              | `confirmed → cancelled`               | Any time. `is_late_cancel` is derived; money per D2.                                                                            |
| `mark_call_no_show(call, party)`        | host or requester              | `confirmed → no_show`                 | After start + 15 min. Presence evidence when the call is tracked (D4).                                                          |
| `fn_expire_discovery_calls()`           | system (sql job, every 15 min) | `proposed → expired`                  | Past `proposal_ttl_hours`, or past the proposed start                                                                           |
| `complete`                              | system (the same job)          | `confirmed → completed`               | Past `confirmed_end`. Courtesy calls only; under D1 a paid call completes through its sitting.                                  |

#### 12.3.2 D4 — presence identity

> **Ruled:** C4 (b) ⭐ (Decision #343), amended by #383 (b) and R5 and, for paid sittings, #392.
> **Status:** §12.0. #385 (d): an attendee's personal Zoom link is made at their first join; #392: a
> licensed Zoom host's room approves its registrants at first join.

`projects.record_presence` matches a participant by the **email the provider reports**
(F1155:967-969). This has two failure modes:

1. The Zoom account email differs from the Projective email, so the participant is `unmatched`.
2. A guest types someone else's email, so presence is _asserted_ falsely (S-04).

**Recommendation:** when the platform mints a room (D6), create it with per-registrant join URLs
(Zoom `registrants`, Teams `onlineMeeting` attendee tokens). Store the provider's registrant id
against `(session_event_id, user_id)` and match on it, with email as a fallback flagged
`source = 'webhook_email'`. A dispute audit (F1260:143-201) should weigh an email-only match as
ambiguous.

#### 12.3.3 D5 — the majority denominator

> **Ruled:** C6 ⭐ D5 (Decision #343, which logs the three definitions as its flag (a)). **Status:**
> Open → SCH-WP9.

There are three definitions:

- TS counts every seat except the host's, `optional` included (coord.ts:651-655).
- The enum comment says `optional` is _not_ in the denominator
  (`00000004_enums_domains.sql:507-508`).
- The session workspace read counts `role <> 'optional'`, which _includes the host_
  (F1155:1502-1503).

**Recommendation:** keep the TS rule. It is the one settlement actually runs, and its reasoning
holds: "a time they cannot make is a time that excludes them". Correct the enum comment, and make
the workspace read call the same predicate (`role <> 'host'`). This is a new contradiction, so it
goes into Decision #343.

#### 12.3.4 D6 — the runtime for calendar sync and room minting

> **Ruled:** C4 ⭐ (a) (Decision #343, resolving its flag (b)); ✎ (c) the token-vault key is the
> `ENCRYPTION_KEY` env, not KMS (#59); and the owner's directive that a provider location creates
> the meeting automatically, with links for both sides. #383 R1 adds direct providers with no Nylas,
> and R3 two one-way sync flows. **Status:** §12.0. Proved on a real Google account; not on a real
> Microsoft or Zoom consent, nor on a real Meet room (#386).

SA §3.3 places the consent handshake, the token-refresh scheduler, webhook ingestion and sync
adapters in **Edge Functions**. The codebase built none of them that way:

- The consent handshake is a Fresh route plus a fat service (`/api/integrations/{start,callback}`,
  `IntegrationsBackendService`, `token-vault.ts`).
- Presence ingestion is a Fresh route (`/api/sessions/webhooks/[provider]`).
- Scheduled work is pg_cron plus pg_net calling bearer-guarded Fresh routes (Decision #203).
- The only Edge Function is a mock virus scan (`supabase/functions/scan-file`).

**Recommendation:** ratify the pattern the code uses:

- `CalendarSyncBackendService` and `RoomBackendService` under `packages/backend/services/`.
- Inbound push at `POST /api/integrations/webhooks/[provider]`, deduplicated on
  `integrations.webhook_deliveries`.
- Renewal and refresh as `http` jobs in `ops.scheduled_jobs` (`integrations-token-refresh`,
  `integrations-channel-renewal`, `integrations-calendar-sync`).
- Amend SA §3.3 and §Edge Functions & Webhooks.

One runtime, one guard model, one job registry. This is a new contradiction (SA vs code) and goes
into Decision #343.

#### 12.3.5 D7 — courtesy-call reliability

> **Ruled:** C6 ⭐ D7 (Decision #343). **Status:** Open → SCH-WP9. "Low weight" has no number yet
> (🧑, SCHBP §0.3 stop 6).

The flag is open in `PRODUCT_SPEC.md` §Discovery & Courtesy Calls. **Recommendation:** feed the
Reliability Index only from **presence-verified** courtesy no-shows. One mark per counterparty per
30 days caps retaliation. Never feed it from a self-reported mark. A free call stays free of money
consequences, but not of honesty consequences. Otherwise the cooldown is the only deterrent, and it
punishes the wrong party.

#### 12.3.6 D8 — ballot quota and replacement length

> **Ruled:** C6 ⭐ D8 (Decision #343). **Status:** Open → SCH-WP9.

The flags are in `database/scheduling/Functions.md` §9. **Recommendation:**

- A per-attendee cap of **3 unapproved slots**, with the host's slots outside it. This needs an
  `RESCHEDULE_ATTENDEE_PROPOSALS_MAX` constant, its trigger twin and a planner refusal
  `proposer_quota`.
- **A replacement slot must keep the original event's duration.** A move is a move, not an
  extension. For a session the length is fixed by the listing (`session_minutes`) anyway.
- Add `ck_proposal_span` length ≤ 24h as a database backstop.

#### 12.3.7 D9 — the comms queue worker (pointer)

> **Ruled:** Q0.3 ⭐ (Decision #343): the worker and its sibling jobs are registered in `00005060`
> (`e18489d4`). **Status:** Fixed for the worker. The `scheduling-reminders` job is Open → SCH-WP3.
> The engine is CAS's:
> [`COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md`](COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md) §2.

The scheduling dependency: `session.reminder_60m/15m/5m` and `discovery_call_reminder_lead_minutes`
need a producer as well as the worker (S-18). The reminder is the cheapest no-show prevention there
is, so a `scheduling-reminders` sql job enqueues reminders for sittings and confirmed calls.

### 12.4 The build order this implied (SDG §4)

> **History.** SCHBP §0 is the live run order. It cites step 5 and runs D2 before D1 (SCH-WP7 →
> SCH-WP6); §13 notes the wording. Steps → prompts: 1 = the 2026-10-29 fixes and SCH-WP1; 2 =
> SCH-WP2; 3 = SCH-WP3; 4 = SCH-WP4a → SCH-WP4b → SCH-WP5; 5 = SCH-WP8 → SCH-WP7 → SCH-WP6; 6 =
> SCH-WP9 and Q0.3. Each prompt's status is in §14.

1. **D0, S-26, S-30**: revoke client writes on `projects.session_events` and add owner doors
   (`schedule_sitting`, `retitle_sitting`). These mirror the sitting onto the calendar (S-05). Route
   "Book this slot" to the real request door. Add the https-only meeting-URL CHECK. These are P0/P1
   and need no ruling beyond D0 itself.
2. **D1 interim**: refuse and hide the paid flavour. Add the expiry sweep (S-11), add calls to the
   session booking gate (S-06), and serialise call requests on the schedule row lock (S-07). P0/P1.
3. **D3 doors**: they make discovery calls usable end to end.
4. **D6 → D4**: build the room minting service and the registrant-keyed presence it enables. This
   unblocks the Digital Handshake (S-03) and gives D1's paid calls their evidence.
5. **D1 Option C**, then **D2**, which D1 depends on for paid-call windows.
6. **D5, D7, D8, D9**: these can run in parallel with steps 4 and 5.

---

## 13. Contradictions register

The full text of each flag is in its decision row (`reference/decisions/decisions-122-126.md`):
Decision #343, Decision #337 (FDD's register, now in FCA), Decision #344 and Decision #383.

| ID            | Contradiction                                                                      | Finding    | Ruling                           | Status                                          |
| :------------ | :--------------------------------------------------------------------------------- | :--------- | :------------------------------- | :---------------------------------------------- |
| #343 (a)      | Three majority denominators (§12.3.3)                                              | S-14       | C6 (D5)                          | Open → SCH-WP9                                  |
| #343 (b)      | SA §3.3's Edge Functions against Fresh + pg_cron (§12.3.4)                         | S-20       | C4 (a)                           | Ruled → C4 (a); the runtime is built (#385)     |
| #343 (c)      | A stale `Tables.md` §3 escrow flag (§0)                                            | S-23       | Q0.4                             | Fixed (`94d22e84`)                              |
| #343 (d)      | The Zoom seed's `supports_webhooks = false` against the shipped webhook            | S-24       | C4 (d)                           | Open → SCH-WP5                                  |
| #343 (e)      | DESIGN_SYSTEM's paginated Month against the code and the §C.1 roster               | S-38       | C7 (b)                           | Open → SCH-WP10                                 |
| FDD X1        | FM §4's 50% late-cancel fee against PRODUCT_SPEC's full forfeit (§12.2.5)          | —          | C2 (a)                           | Ruled → C2 (a): closed by #343; FM §4 corrected |
| FDD X2        | A standalone paid call's escrow (§12.1.5)                                          | S-02       | C1                               | Ruled → C1; status as D1                        |
| FDD X5        | "Pending" as 24h against 7 days (§12.2.6)                                          | —          | C2 (c)                           | Ruled → C2 (c): closed by #343                  |
| #344 (f)      | A started cohort's dissenters against the Reschedule row (§12.2)                   | D2         | —                                | Open (🧑, SCH-WP7)                              |
| #383 (b)      | Presence as a span, not time in the room; S-20's "monotone" note                   | S-20, S-21 | Its recommendation stands (#383) | Partly fixed (`fn_room_presence`, #385 (e))     |
| SDG §4 step 5 | "D1 Option C, then D2, which D1 depends on": the order and the dependency disagree | —          | SCHBP §0 runs D2 first           | Superseded by SCHBP §0                          |

---

## 14. Remediation map

Fix text stays in the §10 rows; SCHBP holds the work orders.

| ID(s)                                             | Priority                       | Prompt                    | Status                                                                       |
| :------------------------------------------------ | :----------------------------- | :------------------------ | :--------------------------------------------------------------------------- |
| S-01, S-26, S-30                                  | P0, P0, P1                     | — (fixed with the audit)  | Fixed (`660c9658`)                                                           |
| S-05 (with D0's doors)                            | P1                             | SCH-WP1                   | SQL half Fixed (`942c8dde`); the app half → SCH-WP7                          |
| S-06, S-07                                        | P1, P1                         | SCH-WP2 (integrity half)  | Fixed (`942c8dde`)                                                           |
| S-02 (interim), S-11                              | P0, P1                         | SCH-WP2                   | Fixed (`6882e0be`)                                                           |
| S-16 (anon), S-32                                 | P2, P1                         | SCH-WP11                  | Fixed (`942c8dde`)                                                           |
| S-34, S-35, S-36, S-37, S-41                      | P2, P2, P2, P2, P1             | SCH-WP12                  | Fixed (`e30b4111`), except S-36's `.evm-rich` residue (→ SCH-WP10)           |
| S-23                                              | P2                             | Q0.4 doc sweep (Wave 1.1) | Fixed (`94d22e84`)                                                           |
| S-18 (the worker)                                 | P1                             | Q0.3 jobs set             | Fixed (`e18489d4`)                                                           |
| S-10, S-27, S-18 (the producer), S-16 (signed-in) | P1, P1, P1, P2                 | SCH-WP3                   | Open (S-10 Unverified)                                                       |
| S-19 (the runtime half), S-20                     | P1, P2                         | SCH-WP4a                  | Partly fixed (the runtime as built, #385, #386; not marked in the run order) |
| S-03 (the rooms half), S-19                       | P1, P1                         | SCH-WP4b                  | Partly fixed (#385, #386, #387)                                              |
| S-03 (the presence half), S-04, S-24              | P1, P1, P2                     | SCH-WP5                   | S-03 and S-04 Partly fixed (#385, #392); S-24 Open                           |
| S-08, S-09, S-21                                  | P1, P1, P2                     | SCH-WP8                   | S-08 Partly fixed (#385, #392); S-09 and S-21 Open                           |
| S-12, S-13, S-22; D2; S-05 (the app half)         | P2, P2, P1                     | SCH-WP7                   | Open                                                                         |
| S-02 (Option C)                                   | P0                             | SCH-WP6                   | Open                                                                         |
| S-14, S-15, S-17                                  | P2, P2, P2                     | SCH-WP9                   | Open                                                                         |
| S-25, S-28, S-29, S-31, S-33, S-38, S-39, S-40    | P1, P1, P1, P1, P2, P2, P2, P2 | SCH-WP10                  | Open (S-25 Partly fixed by `60c8641c`)                                       |
| The docs and this Status column                   | —                              | SCH-Z1                    | Open                                                                         |

---

## 15. Cross-domain pointers

| Topic                                                           | Our IDs                                           | Owner file §                                                                                                                 |
| :-------------------------------------------------------------- | :------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------- |
| Notification engine and the comms queue worker                  | D9, S-18 (the worker half)                        | [`COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md`](COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md) §2; §12.3.7 keeps the scheduling dependency |
| The notification dispatcher's runtime against C4 (a) (#344 (a)) | D6                                                | CAS §2                                                                                                                       |
| The payout-ready gate's scope (FQ M4)                           | D1 rider 1 (§12.1.5)                              | [`FINANCE_AUDIT.md`](FINANCE_AUDIT.md) (K-rows, N12, N14, D-7)                                                               |
| Disputes inside the 7-day window (FQ M3)                        | S-21 (the dispute audit's thresholds stay here)   | FCA (D-6)                                                                                                                    |
| Minors 13–17 (FQ I4)                                            | S-32 (the #208 booking gate)                      | [`IDENTITY_AND_WORKSPACES_AUDIT.md`](IDENTITY_AND_WORKSPACES_AUDIT.md) (§4.2, §6.4; IDG F8)                                  |
| Erasure model (FQ I1)                                           | SCH-WP4a's revoke-on-disconnect door (SCHBP §0.1) | IWA (IDG F1–F3, K1)                                                                                                          |
| Penalties and Standing (FQ T4)                                  | D7 (writes `security.penalties`)                  | [`SECURITY_MODERATION_AND_AI_GAPS.md`](SECURITY_MODERATION_AND_AI_GAPS.md)                                                   |
| Modal and overlay inventory                                     | `EventModal`, `ConsultationModal` (S-26, S-27)    | [`PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md`](PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md) §9                      |

---

## 16. Section map of the merged decisions file (SDG)

`SCHEDULING_DECISIONS_AND_GAPS.md` (2026-10-29) was merged here on 2026-11-11 and deleted. SDG §n.m
is §12.n.m. Pre-merge text:
`git show 08296359:documentation/architecture/SCHEDULING_DECISIONS_AND_GAPS.md`.

| Old section / IDs                                                    | Now                                                                                                      |
| :------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| Header, abbreviations (**SA**, **PM** and the migration short names) | [`SCHEDULING_COMPLETENESS_AUDIT.md`](SCHEDULING_COMPLETENESS_AUDIT.md) header                            |
| §0 The rulings needed, in order of urgency (table)                   | §12.0, the decision table (same IDs, D0–D9, with Ruling, Decision # and Status columns)                  |
| §0 status line (2026-10-30)                                          | §10 Status column and banner; §12.0 Status column                                                        |
| §0 "Two more fixes" (S-26, S-30)                                     | §10 S-26, S-30 (both Fixed)                                                                              |
| D0                                                                   | §12.0 (and §10 S-01, S-05)                                                                               |
| §1 D1 — the paid 1-on-1 call escrow gap                              | §12.1                                                                                                    |
| §1.1 Premise correction                                              | §0 (its two rows) and §12.1.1 (the framing)                                                              |
| §1.2 Live exposure today                                             | §12.1.2                                                                                                  |
| §1.3 Options                                                         | §12.1.3                                                                                                  |
| §1.4 Recommendation                                                  | §12.1.4                                                                                                  |
| §2 D2 — TTE window alignment                                         | §12.2                                                                                                    |
| §2.1 Every time window in force                                      | §12.2.1                                                                                                  |
| §2.2 What the 12h/24h gap exposes                                    | §12.2.2                                                                                                  |
| §2.3 Options                                                         | §12.2.3                                                                                                  |
| §2.4 Recommendation                                                  | §12.2.4                                                                                                  |
| §3 The smaller rulings                                               | §12.3                                                                                                    |
| §3.1 D3 — discovery-call doors                                       | §12.3.1                                                                                                  |
| §3.2 D4 — presence identity                                          | §12.3.2                                                                                                  |
| §3.3 D5 — the majority denominator                                   | §12.3.3                                                                                                  |
| §3.4 D6 — the runtime for sync and room minting                      | §12.3.4                                                                                                  |
| §3.5 D7 — courtesy-call reliability                                  | §12.3.5                                                                                                  |
| §3.6 D8 — ballot quota and replacement length                        | §12.3.6                                                                                                  |
| §3.7 D9 — the comms queue worker                                     | §12.3.7 (pointer to [`COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md`](COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md) §2) |
| §4 Build order this implies                                          | §12.4 (the live run order is [`SCHEDULING_BUILD_PROMPTS.md`](SCHEDULING_BUILD_PROMPTS.md) §0)            |
| §5 Decision #343 (drafted as "#335")                                 | a pointer in §12.0; its flags #343 (a)–(e) → §13                                                         |
| Finding IDs cited here (S-01 … S-32)                                 | §10 (same IDs)                                                                                           |
