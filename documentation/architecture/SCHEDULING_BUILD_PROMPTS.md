# Scheduling Build Prompts — Claude Code Work Orders for Calls, Sessions, Integrations & `/calendar`

> **Status: WORK ORDERS, not binding.** The scheduling track (track C of
> [`FOUNDER_QUESTIONNAIRE.md`](FOUNDER_QUESTIONNAIRE.md) Part B §B.3). These prompts close the open
> findings of [`SCHEDULING_COMPLETENESS_AUDIT.md`](SCHEDULING_COMPLETENESS_AUDIT.md) (`S-nn`, §10;
> rulings D0–D9 in §12, formerly SDG, so SDG §n.m is audit §12.n.m) under the owner's rulings C1–C7
> on **Decision #343**.
>
> **Verified against code 2026-11-23 at `f2e25929`.** 1 open, 2 partly done, 11 done (§0 ledger).
> Runnable now: SCH-WP7 (it stops at step 6).
>
> **This file holds open work only.** A session that runs a prompt prunes it here when it finishes
> (§1's closing duty; [`build-prompts.md`](../reference/build-prompts.md) §2).

Every prompt cites its evidence by finding ID and its ruling as `(Decision #343, ruling Cn)`. Paste
each prompt into its **own fresh session**, after the standard header (§1), and run them in the §0
order. A prompt marked **🧑 DECISION** stops and puts the named question to a human before it
changes that behaviour, with the options and a recommendation; §0.3 lists the open stop.
**Migrations are edited in place** (root `CLAUDE.md` §1): every prompt names the category file it
edits, never a new "fix" file.

- None of the room, sync or presence build has run on a live Microsoft or Zoom account or a real
  Meet room (#386, #392).
- Not placed in any prompt: an `.ics` import door, and the console calendars' address (a team's or
  business's `?view=` belongs to the console). Decision #413's FLAGS (a)–(d) carry both. S-40 is
  superseded by Decision #411.
- Decision #383's amendments (2026-11-04) applied to SCH-WP3, WP4a, WP4b, WP5 and WP8, all done;
  read them at `f2e25929` §0.4.

---

## 0. Run order & dependencies

### 0.0 Done

| ID       | What landed                                                                                                          | Commit                                        | Text at    |
| :------- | :------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------- | :--------- |
| SCH-WP1  | SQL half: the two sitting doors, the roster-less group mirror, `trg_sitting_round_guard`; app half is SCH-WP7 step 5 | `942c8dde`                                    | — (Wave 0) |
| SCH-WP2  | Paid discovery calls refused; `fn_expire_discovery_calls` expires unanswered requests                                | `6882e0be`                                    | `f2e25929` |
| SCH-WP3  | The five discovery-call doors, `get_own_call_settings`, call notices and reminders (#383 Option A)                   | `ac19de8f`                                    | `f2e25929` |
| SCH-WP4a | `token-vault.ts` on `ENCRYPTION_KEY`; the OAuth, refresh and webhook runtime as Fresh routes + pg_cron               | `ac19de8f`                                    | `f2e25929` |
| SCH-WP4b | One `scheduling.rooms` row per room on the host's account; direct calendar sync; `/meet/[roomSlug]`                  | `ac19de8f`, `4c15a1b4` (#392)                 | `f2e25929` |
| SCH-WP5  | `scheduling.presence_events`, `fn_room_presence` and one `scheduling.record_presence` door                           | `ac19de8f`, `4c15a1b4` (#392)                 | `f2e25929` |
| SCH-WP8  | A sitting with no presence evidence is held for review; the attendance audit's thresholds (#383 R6)                  | `ac19de8f`, `4c15a1b4` (#392)                 | `f2e25929` |
| SCH-WP9  | One majority denominator, a bounded ballot, courtesy no-shows in Standing (#419)                                     | `44382c08`                                    | `f2e25929` |
| SCH-WP10 | Authoring hidden, `?view=&date=&zoom=&kind=`, windowed reads, Add to a calendar, Month (#413); step 6 by #411        | `44382c08` (built as the unmerged `8851d4dc`) | `f2e25929` |
| SCH-WP11 | S-16's `call_settings` column grant and S-32's `restrictBooking`; the signed-in half in SCH-WP3                      | `942c8dde`, `ac19de8f`                        | — (Wave 0) |
| SCH-WP12 | S-34–S-37 and S-41; S-38 in SCH-WP10; S-40 superseded by #411                                                        | `942c8dde`, `e30b4111`                        | — (Wave 0) |

`44382c08` is a bulk commit with a meaningless message ("hjgj"). SCH-WP1, WP11 and WP12 were Wave 0
packages with no prompt text in this file.

### Run order

| Phase               | Prompts           | Why this order                                                                                                                                                                                                                 |
| :------------------ | :---------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4 — Money rules** | SCH-WP7 → SCH-WP6 | C2's windows route money through the cancel and sweep paths SCH-WP8 corrected, and lift SCH-WP1's group-sitting freeze (7). Then C1's paid consultations, which inherit both through the session rail (6; audit §12.4 step 5). |
| **Last**            | SCH-Z1            | The docs sweep and the audit's status column.                                                                                                                                                                                  |

**Every SQL step is serial** (SCH-WP7 → SCH-WP6). They share `00001155` (sessions, a §B.0 hot file),
`00001510` (scheduling) and the one local database. They also both add a Dev Context Switcher axis
in `features/devtools` + `dev-seam.ts`, so never run them at the same time.

### 0.1 Cross-track conflicts

The §B.0 hot files have one writer at a time:

| Hot file                                                                                              | This track writes it in                            | Other writers: never at the same time                                                      |
| :---------------------------------------------------------------------------------------------------- | :------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| `00001155` (sessions)                                                                                 | SCH-WP7, SCH-WP6                                   | none planned; MARKETPLACE SC3 wrote `open_cohort` here (Decision #498), so check `git log` |
| `00002510` (grants)                                                                                   | SCH-WP7, SCH-WP6                                   | many: edit it last in your session, after re-reading it                                    |
| `stripe-webhook.ts` + `00001230`                                                                      | none: SCH-WP6 rides the existing card → order path | S·S4. If SCH-WP6 finds `00001230` enumerating line kinds, that edit waits for them         |
| `features/devtools` + `dev-seam.ts`                                                                   | SCH-WP7, SCH-WP6                                   | F·UI3, S·S4, S·S6, I·F6                                                                    |
| `00005060` · `00001300` · `00001020` · `00001060` · `00001240` · `live-wallet.ts` / `wallet-scope.ts` | none                                               | —                                                                                          |

Shared files that are not on the §B.0 list:

- `00000004` enums: SCH-WP6 (`purchasable_item_kind`). Every track edits this file, so rebase before
  you start.
- `00000015` projects tables: SCH-WP6. Also the P track (WP4, WP5).
- `00001210` (`place_wallet_order`): SCH-WP6. Also F·DB3 and F's M8 prompt (the refunded and
  cancelled order writers).
- `CheckoutBackendService.ts` / `live-basket.ts`: SCH-WP6. Also F·SV5.
- `00005001` platform params: SCH-WP7. Every track.
- Docs: the `SYSTEM_ARCHITECTURE.md` env contract (every track); `ROUTING.md` (SCH-WP7's sitting
  routes; P·WP8 also edits URL rules); `DESIGN_SYSTEM.md` (pull before every edit).

### 0.2 Cross-track waits

| Step                     | Waits on                                                                                                                                                       | Why                                                                                   |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| SCH-WP6                  | SCH-WP7. Better after F's M8 prompt (refunded order lines) and F's payout gate (M4). F·DB7 and F·SV4 are done.                                                 | A paid call is a checkout line, and a declined call's refund is an order-line refund. |
| Other tracks on this one | I·IW-M13 waits on every SCH SQL step (SCH-WP7, SCH-WP6). P·WP8 builds on the calendar URL rules SCH-WP10 wrote into `ROUTING.md` (Decision #413), not its own. | Part B §B.3                                                                           |

### 0.3 Open decisions (🧑)

4. **SCH-WP7 step 6: a started group cohort's dissenters** (Decision #344 (f), unruled). This is a
   contradiction. PRODUCT_SPEC's Reschedule row (`:134`, written in Wave 1.1) says a move is decided
   before the window "so every attendee can still cancel against either time". But a group seat is
   "one transaction for the whole cohort, timed from its first sitting" (`:149`;
   `cancel_cohort_membership`, `00001155`). Once a cohort has started, no dissenter can cancel
   without forfeiting. Recommendation: a dissent exit that refunds the share of the sittings not yet
   held.

The stop keeps its old number, which other docs cite. Every other stop this file raised is ruled: 1
(SCH-WP3's re-proposal), 2 and 3 (SCH-WP4b's calendar strategy and platform room) and 5 (SCH-WP8's
held-for-review) on Decision #383; 6 (SCH-WP9's D7 weight) on Decision #419; 7 (SCH-WP10's unmerged
write path, merged 2026-11-03) on Decision #413.

---

## 1. Standard header — paste above EVERY prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types the
Zod SSOT @projective/types; packages/backend fat services @server/services/*; supabase/migrations
Postgres with RLS everywhere; Stripe for fiat; calendar and conferencing providers through the
integrations schema).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (at least
     documentation/CLAUDE.md, packages/ui/CLAUDE.md, documentation/database/CLAUDE.md when SQL
     changes), then documentation/reference/guardrails.md and
     documentation/reference/pr-checklist.md.
  2. Read documentation/architecture/SCHEDULING_COMPLETENESS_AUDIT.md (§10, the S-nn findings
     cited below; §12, rulings D0-D9 and the shapes they propose) and the
     OWNER RULINGS on Decision #343 (documentation/reference/decisions/decisions-122-126.md;
     grep -n '^| 343 |').
  3. Grep documentation/reference/decisions/README.md for the surface you touch and read the
     decision files it names. At minimum read #56, #71-#75, #171, #203, #208, #211, #212, #217 and
     #343; for money also #126 and #337; for integrations #59, #313, #314 and #335.
  4. Read documentation/database/scheduling/{Tables,Functions,Policies}.md (and
     documentation/database/projects/* for sessions) for the objects you change; PRODUCT_SPEC.md
     §Stage Formats 2 (Session-Based A-D) and §Discovery & Courtesy Calls; finance-model.md §4;
     PRODUCT_MANAGEMENT.md §3.5.

Hard rules (merge gates; reject your own diff if any of these fails):
  Money and time
  - A session's money moves only through the seat primitives (finance.fn_release_seat_escrow,
    fn_refund_seat_escrow, fn_split_seat_escrow) and the wallet primitives behind them. Never UPDATE
    finance.escrows or finance.wallets directly. Integer minor units only. Every sweep is
    idempotent: each money move is guarded on the escrow still being `held`.
  - Never drop columns/FKs of escrows, wallets or stages without asking me.
  - Every window is a security.platform_params row (00005001), read in SQL through
    projects.fn_session_param and passed INTO the pure TS rules
    (packages/types/scheduling/coordination.ts). A value is never a literal in two places; a TS rule
    and its SQL twin are pinned together by coordination.contract.test.ts.
  - Nobody writes a sitting's time or status directly (D0): only the definer doors in 00001155.
    scheduling.fn_enforce_call_transition stays the legality authority for discovery calls, and each
    door names who may make the move. A courtesy call creates no project, stage or ticket and never
    touches W_i.
  - The privacy matrix holds (audit §8): room URLs, passcodes and per-person join links are never
    client-readable except through the party doors (scheduling.get_event_rooms,
    projects.session_join_link). An under-18 viewer books nothing (Decision #208, restrictBooking).
  SSOT & architecture
  - Migrations are consolidated and EDITED IN PLACE (supabase/migrations/vvvvtooo_type_purpose.sql).
    Never append ALTER TABLE ADD COLUMN / ALTER TYPE ADD VALUE patches or a new "fix" file. Each
    statement goes in its category file: 0 enums/tables · 1 functions/triggers · 2 policies/grants
    · 3 views · 4 indexes · 5 seed (00005060 scheduled jobs). A trailing FK file only for a true
    circular dependency.
  - A new table enables RLS (00002001) and states its grants (00002520). The projects schema grants
    ALL on every table to authenticated by default (00002500:116), which is how S-01 happened.
  - A schema or RPC-contract change lands with its Zod schema (packages/types/scheduling/*,
    projects/*, integrations/*), the backend mapper and documentation/database/* in the SAME change.
    A lifecycle change updates PRODUCT_MANAGEMENT.md; a business rule updates PRODUCT_SPEC.md or
    finance-model.md. A prompt that builds a rule marked "Not built yet (Decision #343, ruling X)"
    removes that marker in the same change.
  - Thin routes: HTTP parse + Zod + auth guard ONLY. Logic lives in BookingBackendService,
    ScheduleBackendService, SessionBackendService, IntegrationsBackendService,
    CalendarSyncBackendService and RoomBackendService, and returns ServiceResult<T> (#10). A cron
    route checks its bearer in constant time and answers 404 otherwise
    (apps/web/routes/api/scheduling/cron/horizon.ts is the pattern). Its job is a row in 00005060
    (Decision #203), written only while you own that file.
  - Islands never import Supabase or @server/*; they call /api/* through their feature's core
    service. Signal-first state; useEffect only for external DOM/browser APIs. No useState.
  - Path aliases only; folders components/ islands/ styles/ hooks/ wrappers/ types/ core/; no src/.
  - JSDoc on exports; // #region [Name] … // #endregion; no meta-comments.
  UI (DESIGN_SYSTEM.md; root CLAUDE.md §3)
  - Token-only pure CSS + strict BEM: no hex, no literal radius/duration/shadow/weight, no inline
    style= except packages/ui styleVars(). Anti-card. Anti-tag (§B.11): call and session metadata
    is inline --text-secondary MetaLine text; containers only for controls, lifecycle statuses
    (Tag), required disclosures (InlineNotice) and counts. Headings below --fw-bold; figures that
    change are tabular-nums.
  - Button matrix (§B.8, #157): one filled button per decision region. Press = transform: scale(),
    removed under BOTH reduced-motion channels. Text contrast ≥ 4.5:1 in light, dark and
    data-contrast="high".
  - Gate 10: on an entity-view route the conversion lane IS the transaction; no purchase control in
    the desktop main stage. Gate 11: a control that renders must do something.
  - A new or changed @projective/ui component updates the DESIGN_SYSTEM.md §C.1 roster in the same
    change.
  Product
  - Every new simulatable axis gets its Dev Context Switcher control in the same change:
    DevOverrides + DEV_DEFAULTS, DevOption list, DevContextPanel control, reflect() set AND delete
    (apps/web/features/devtools/, seam apps/web/utils/dev-seam.ts).
  - No bespoke statuses; nothing hard-deleted (archive, active = false, or a terminal status).
  - A NEW contradiction between source docs: do not pick a side. Stop and ask me. If I say to record
    it, re-read documentation/reference/decisions/README.md seconds before writing the row, because
    parallel tracks race for numbers.

Verification:
  - Reproduce the defect first (a SQL probe under supabase/probes/ inside a ROLLBACK transaction, or
    a Deno unit test), then fix. The seed holds ten schedules and four discovery calls
    (documentation/database/Seed.md); a probe builds the rest of its fixture in its own transaction.
  - SQL prompts: see each prompt's VERIFY (SQL) block.
  - Then run `deno task check`, `deno task lint` and `deno task test:unit` (four
    theme-engine.test.ts failures are pre-existing, Decision #96(a)), and `deno fmt` on the files
    you touched only, never a directory. The working tree is CRLF: never sed an existing file.
  - UI prompts: run `deno task dev`, sign in as the seeded personas
    (documentation/database/Seed.md), and capture screenshots at 1440, 900 and 390 px in light,
    dark, data-contrast="high" and data-motion="reduced". Restart the dev server after any
    packages/* edit.
Commit on the branch you were given with a clear message; do not open a PR unless I ask.

When you finish, do the closing duty (documentation/reference/build-prompts.md §2) in the same
commit as the work:
  - In documentation/architecture/SCHEDULING_BUILD_PROMPTS.md: a done prompt leaves the file.
    Delete its section and add its row to §0's Done ledger (ID · what landed · commit · text at
    <commit>^). A partly done prompt keeps only its open steps, with their numbers unchanged, under
    one rewritten Status line. A ruled 🧑 stop becomes the ruled step, with its decision number.
  - Treat any step you built for another prompt the same way, in the file that holds it.
  - Run git grep -n "<ID>" documentation/ and update every place that still calls it open: the
    PRODUCTION_READINESS / USER_FLOWS Track cells, the audit's Status column, other prompts' waits,
    and this file's row in documentation/reference/build-prompts.md §3.
  - If the file has no prompts left, delete it, log it in build-prompts.md §4 and repoint its links.
```

---

## 5. Phase 4 — Money rules

### SCH-WP7 — Windows: the money window, the grace and the provider's move

> **Status 2026-11-23:** step 7 landed in OPS2 (`dd1ee9a2`, Decision #513:
> `scheduling.fn_settle_votes` reads `fn_vote_deadline`, so step 2's window flows into it; extend
> `settle_votes.sql` with one money-bearing round); steps 1–6 and 8–11 below are open, and step 6
> waits on its 🧑 (#344 (f), unruled). Nothing defines `fn_event_is_money_bearing`,
> `session_late_booking_grace_minutes` or `sessionCancelWindow`, and `cancelSeat` has no caller.
> MK-40 is 🟡 until step 5 lands.

```text
PROMPT SCH-WP7: Money-bearing events lock at the money window, a late booking gets a grace, and a
provider's move inside the window is a provider cancellation

ROLE: Postgres + TypeScript engineer (the coordination engine). Audit S-12, S-22; audit §12.2;
Decisions #71 (a), #72 (b), #211 (c).

CONTEXT:
  - Rulings (Decision #343, ruling C2):
    (b) Option C. A money-bearing event (a paid sitting, or a paid call once SCH-WP6 lands) locks
        out rescheduling at the money window: lockout = vote lead = session_cancel_notice_hours (24,
        00005001:20). Every other event keeps 12 h. A booking made inside the window gets a
        60-minute grace (session_late_booking_grace_minutes). A sitting the provider moves inside
        the window counts as a provider cancellation for anyone who did not support the move.
    (c) The 24 h step is named the review window, followed by 7 days of pending.
    (a) The 100 % late forfeit stands, as built.
  - A provider cancellation refunds a seat in full (Decision #171 (D); cancel_cohort_membership,
    00001155:1084-1089).
  - RESCHEDULE_LOCKOUT_HOURS = 12 and VOTE_RESOLUTION_LEAD_HOURS = 12 are TS literals
    (coordination.ts:56, :68). Their SQL twins are fn_vote_deadline (00001510:470-494) and
    SCH-WP3's call lockout. The lockout is TS-only, and the service role is trusted to apply it
    (S-12). Vote settlement (S-13) runs without a reader since OPS2: scheduling.fn_settle_votes
    under the scheduling-settle-votes job. Do NOT edit 00005060.
  - SCH-WP1 froze group sittings. schedule_sitting mirrors a group sitting with NO roster, and
    trg_sitting_round_guard (00001155) refuses every round on it, because a vote carried inside
    the notice would make dissenters forfeit. Nothing in the app calls schedule_sitting or
    retitle_sitting, and a seat-holder cannot see the sitting on /calendar. This prompt lifts the
    freeze: the mirror gets a voting roster, and the backstop below protects dissenters.
  - MARKETPLACE SC3 (Decision #498): projects.open_cohort writes a group cohort WITH every one of
    the listing's sittings, each through projects.fn_write_group_sitting (the one sitting writer,
    which schedule_sitting now calls too), and projects.cancel_cohort cancels a cohort before its
    first sitting. schedule_sitting refuses a sitting that starts before the cohort's
    enrolment_closes_at (PS409).
  - No UI calls SessionService.cancelSeat (S-22).

🧑 DECISION — STOP before lifting the group-sitting freeze (step 6). This is a new contradiction:
PRODUCT_SPEC's Reschedule row (:134) says a move is decided before the window "so every attendee can
still cancel against either time". But a group seat is "one transaction for the whole cohort, timed
from its first sitting" (:149, the code at 00001155:1084-1089). Once a cohort has held its first
sitting, a dissenter can no longer cancel without forfeiting, so a move decided outside the window
binds them with no exit. Put this to me:
  Option A (recommended): a dissent exit. A seat-holder who did not vote for a carried
  host-proposed move may leave until its new start, refunded the share of the sittings not yet held
  (finance.fn_split_seat_escrow). The provider keeps what was delivered.
  Option B: narrow PRODUCT_SPEC's promise to seats that can still be cancelled; a started cohort's
  dissenters carry the vote's outcome.
  Option C: every carried host-proposed move on a started cohort counts as a provider cancellation,
  which is a full seat refund under #171 (D).
  Every step except step 6 can go ahead while you wait for the answer.

FILES:
  - packages/types/scheduling/coordination.ts (isMoneyBearing(event), lockoutHoursFor(event,
    noticeHours), voteLeadHoursFor(…); the constants become the non-money defaults), with
    coordination.test.ts and coordination.contract.test.ts
  - supabase/migrations/00001510_functions_scheduling.sql (scheduling.fn_event_is_money_bearing;
    fn_vote_deadline reads it and the parameter; SCH-WP3's call lockout uses it)
  - supabase/migrations/00001155_functions_projects_sessions.sql (cancel_cohort_membership: the
    grace and the backstop; fn_sync_sitting_mirrors keeps a roster of active seat-holders on a
    group mirror; trg_sitting_round_guard admits a vote on a group mirror, after the 🧑)
  - supabase/migrations/00005001_seed_platform_params.sql (session_late_booking_grace_minutes = 60)
  - packages/backend/services/scheduling/{coordination-plan.ts, live-coordination-writes.ts,
    live-calendar.ts} (the planner reads the window)
  - packages/backend/services/sessions/SessionBackendService.ts and the session routes
    (scheduleSitting and retitleSitting over the two doors); the session workspace UI (the
    provider's Add a sitting and Rename; the seat's Cancel, S-22)
  - the copy that names the review window: the session sidebar and the wallet's pending row
  - apps/web/features/devtools/*, apps/web/utils/dev-seam.ts (the sessionCancelWindow axis)
  - supabase/probes/session_windows.sql (new); group_sitting_doors.sql (its freeze assertions
    change); settle_votes.sql (one money-bearing round)
  - documentation/database/scheduling/Functions.md §9 (S-12's trust note), database/projects/*;
    business/PRODUCT_SPEC.md (:120-141); business/finance-model.md §4 (:185-192);
    PRODUCT_MANAGEMENT.md §3.5 (:229, :232, the caps paragraph from :328, the window rule from :358)

STEPS:
  1. Reproduce: a vote on a 1-1 paid sitting can carry at T−13 h; a seat booked at T−6 h and
     cancelled two minutes later forfeits 100 %.
  2. One money predicate, in SQL and TS, pinned together: the event mirrors a sitting
     (source_session_event_id IS NOT NULL) or is a paid call. lockoutHoursFor and voteLeadHoursFor
     return session_cancel_notice_hours for a money-bearing event and 12 otherwise. The planner and
     fn_vote_deadline use them, and the contract test pins the SQL twin to the TS rule with the
     parameter passed in.
  3. The grace: a sitting (1-1) or a seat (group, judged against its first sitting) booked inside
     the notice may be cancelled for a full refund within session_late_booking_grace_minutes of its
     hold, while it has not started.
  4. The backstop: when a host-proposed round resolves with its decision inside the window, every
     attendee who did not vote for the winner may cancel as if the provider had cancelled, until the
     new start. On a 1-1 that refunds the sitting's own escrow. On a group seat it is a full refund
     (#171 (D)), reachable only once step 6 lifts the freeze.
  5. The group sitting reaches the product (SCH-WP1's app half). SessionBackendService and the
     session routes expose schedule_sitting and retitle_sitting, and the provider's workspace gains
     Add a sitting (beyond the ones open_cohort wrote) and Rename. fn_sync_sitting_mirrors keeps the
     mirror's event_attendees equal to the active seat-holders (participant) plus the host, so
     seat-holders see the sitting on /calendar.
  6. After the 🧑: trg_sitting_round_guard admits a voting round on a group mirror, and a started
     cohort's dissenter gets the exit the ruling chose.
  8. S-22: the seat's Cancel in the session workspace, beside SC3's whole-cohort cancel, states the
     outcome before the press: "full refund", "full refund: inside your hour's grace" or "the
     provider keeps the payment". The service computes it; the island never does.
  9. The review window (ruling C2 (c)): wherever a session payout is shown, the product names the
     24 h step "Review window" and the next 7 days "Pending".
  10. Dev Context Switcher: sessionCancelWindow (auto · refundable · grace · forfeit ·
      provider-moved).
  11. S-12: Functions.md §9 records that the lockout and the majority are TS rules the service role
      is trusted to apply.

SAME CHANGE:
  - Migrations edited in place (root §1).
  - Zod (coordination.ts, the session read) with documentation/database/*.
  - PRODUCT_SPEC :136-141: remove the markers on the Reschedule and Booked-inside rows and on the
    review-window name.
  - finance-model §4 :185-192.
  - PRODUCT_MANAGEMENT §3.5 (lifecycle changes): a group sitting now takes rounds (:229); the review
    window's name (:232); the four named caps become two per class of event; the window rule's
    marker (:358).
  - ROUTING.md: rows for the sitting routes.
  - The sessionCancelWindow Dev Context Switcher axis.

VERIFY (SQL):
  - Run `deno task test:probes` while iterating (add a probe's name to run just that one).
  - One local database: at most 2 SQL sessions at once, on disjoint migration files. Announce every
    `deno task db:reset` to the other sessions before you run it.
  - Finish with your own clean `deno task test:probes:fresh`, with no other reset during it.

ACCEPTANCE:
  - session_windows.sql (ROLLBACK): a money-bearing vote's deadline is at least 24 h before both
    times, and a sync keeps 12 h; a seat booked at T−6 h refunds in full at +30 min and forfeits at
    +61 min; the backstop refunds a dissenter and not a supporter; after the 🧑, a group vote
    carries and moves the sitting, with its seat-holders on the roster.
  - coordination.test.ts and coordination.contract.test.ts pass with the new pins. The planner
    refuses slot_inside_lockout at 23 h for a sitting and allows it for a sync.
  - settle_votes.sql: a money-bearing round settles at its 24 h deadline.
  - Screenshots of the seat's Cancel in each window state, at 1440 and 390.
```

### SCH-WP6 — Paid consultations on the host's hidden Consultations engagement

> **Status 2026-11-23:** Open; waits on SCH-WP7. `place_wallet_order` takes `p_expected_minor`.
> Unverified: whether `place_wallet_order` (not only `fn_book_session_slot`, `00001155`) now carries
> #411's `p_later_starts`.

```text
PROMPT SCH-WP6: A paid consultation is paid at request and held on the host's hidden Consultations
engagement

ROLE: Payments + Postgres engineer. Audit S-02; audit §12.1.3-§12.1.4 (Option C and its exact
shapes); Decision #211. Better after F's M8 prompt (refunded order lines) and F's payout gate (M4).
Depends on SCH-WP7.

CONTEXT:
  - Ruling (Decision #343, ruling C1 = #337 D-2, X2): Option C. Each host has one hidden
    "Consultations" engagement on #211's session rail. The money is held at request and refunded on
    decline or expiry; otherwise the call settles exactly as a 1-1 sitting does (release, cancel
    windows, presence, disputes). paid_enabled requires a payout-ready host (#337, ruling M4, which
    also requires it at booking). PRODUCT_SPEC §Discovery & Courtesy Calls already carries the
    ratified wording.
  - SCH-WP2 turned paid calls off (PAID_CALLS_LIVE = false; request_discovery_call refuses
    paid_unavailable). That door keeps refusing 'paid': from now on a paid call arrives only through
    checkout.
  - The seed (08_scheduling.sql) holds a confirmed paid call with no sitting, which the new CHECK
    refuses.
  - The fee is the session rail's (fn_escrow_fee_bp, 00001155). Whether an Agency's contract rate
    applies to it is the open #252 question: do not decide it. A paid call is priced in the host's
    fee currency, and this prompt adds no conversion (the FX margin is still open, #337 M5).
  - Postgres cannot defer a CHECK. Under ck_call_paid_has_sitting, create the sitting first and then
    insert the call with its session_event_id; adjust audit §12.1.4's fn_book_consultation shape to
    that.
  - A call's price is per availability rule now (Decision #408): scheduling.fn_resolved_slot_fee
    (schedule, starts_at) answers it, and nothing calls it yet (#408 (c)).
  - A paid consultation's room is guarded under Decision #392 (a paid room never admits an attendee
    without the host).

FILES:
  - supabase/migrations/00000015_tables_projects.sql (the session_kind CHECK gains 'consultation')
  - supabase/migrations/00000022_tables_scheduling.sql (discovery_calls.session_event_id and
    ck_call_paid_has_sitting, audit §12.1.4)
  - supabase/migrations/00000004_enums_domains.sql (purchasable_item_kind gains 'discovery_call', in
    place, at the same position as the Zod enum)
  - supabase/migrations/00001155_functions_projects_sessions.sql (§4c:
    fn_consultation_engagement_for and fn_book_consultation; the call follows its sitting to
    completed, no_show or cancelled)
  - supabase/migrations/00001210_functions_finance_kyc_wallet.sql (place_wallet_order: the
    discovery_call line, priced NOW through scheduling.fn_resolved_slot_fee, against
    p_expected_minor, with the payout-ready check)
  - supabase/migrations/00001510_functions_scheduling.sql (SCH-WP3's decline and SCH-WP2's expiry
    refund a paid call's hold through finance.fn_refund_seat_escrow; save_owner_availability refuses
    paid_enabled for a host who is not payout-ready)
  - supabase/migrations/00002510_permissions_function_grants.sql
  - supabase/seeds/gen/schedules.ts, then `deno task db:seed:generate`: the seeded paid call books
    through the engagement, or becomes a courtesy call
  - packages/types/scheduling/calls.ts (sessionEventId; delete PAID_CALLS_LIVE);
    packages/types/finance/* (the item kind, member for member)
  - packages/backend/services/booking/BookingBackendService.ts (the paid path stages a basket line,
    as /api/services/book-session does); packages/backend/services/finance/{CheckoutBackendService,
    live-basket}.ts (the line kind); every project-list reader (grep session_kind and the projects
    list services) excludes 'consultation'
  - apps/web/features/profile/components/hire/ConsultationModal.tsx and
    apps/web/features/view/islands/SessionBookingModal.island.tsx (the paid path goes to checkout);
    AvailabilityEditor.island.tsx (the paid switch's lock becomes the payout-ready lock)
  - supabase/probes/paid_consultation.sql (new)
  - documentation/database/{projects,scheduling,finance}/*; business/PRODUCT_SPEC.md (:1962-1970);
    business/finance-model.md §4 (:193-197); PRODUCT_MANAGEMENT.md §3.5 (the Discovery call row's
    paid states); database/scheduling/Tables.md §3 (:300-307)

STEPS:
  1. Reproduce on the seed: the paid call is confirmed with no money behind it.
  2. The schema per audit §12.1.4, edited in place. fn_consultation_engagement_for(p_schedule) finds or
     makes the host's ONE unlisted session engagement (session_kind 'consultation'), serialised on
     an advisory lock per schedule, exactly as fn_session_engagement_for is per listing.
  3. place_wallet_order's discovery_call line re-prices through scheduling.fn_resolved_slot_fee
     (the rule the call starts in) and refuses a host who is
     not payout-ready (F's M4 door if it has landed, else finance.fn_assert_payout_ready). It runs
     the request gate (fn_call_request_refusal under the schedule lock). Then fn_book_consultation
     seats the payer on a one-seat cohort with one sitting and ONE escrow, and the call row is
     written pointing at it. auto_confirm still applies: the call is born confirmed with the money
     held, or waits for the host as proposed with the money held. discovery_calls.escrow_id is set
     from the sitting's escrow; nothing is dropped.
  4. Decline (SCH-WP3) and expiry (SCH-WP2) refund the hold (fn_refund_seat_escrow) and cancel the
     sitting. The order line becomes refunded through F's M8 writer if it exists; otherwise leave
     the line and say so in your report.
  5. From here a confirmed paid call is a 1-1 sitting: the sweep, SCH-WP7's windows, SCH-WP8's
     evidence rules and the no-show claim apply unchanged, and the call row follows its sitting.
  6. The engagement stays hidden: it is excluded from every project list, dashboard count, search
     index and workload read; it takes no public-project slot; neither party ever sees it as a
     project.
  7. Delete PAID_CALLS_LIVE. The paid card shows again where paid_enabled is on and the host is
     payout-ready, and so does #408's rule Call price field, which no browser has tested yet
     (#408 (i)). The modals' paid path goes to checkout, and the booking surfaces keep gate 10 (on
     an entity view, the purchase stays in the lane).

SAME CHANGE:
  - Migrations edited in place (root §1).
  - Zod (calls.ts; the finance item kind) with documentation/database/*.
  - Remove the markers at PRODUCT_SPEC :1962-1970, finance-model §4 :193-197 and Tables.md §3.
  - PRODUCT_MANAGEMENT §3.5 (a lifecycle change): a paid call is held at request and refunded on
    decline or expiry.
  - ROUTING.md for any changed route; DESIGN_SYSTEM §C.1 if a ui component changes.
  - Dev Context Switcher: the existing payoutReadiness axis covers the editor's lock; extend
    SCH-WP3's discoveryCall axis with "paid · held" and "paid · refunded".

VERIFY (SQL):
  - Run `deno task db:seed:generate` before your first reset.
  - Run `deno task test:probes` while iterating (add a probe's name to run just that one).
  - One local database: at most 2 SQL sessions at once, on disjoint migration files. Announce every
    `deno task db:reset` to the other sessions before you run it.
  - Finish with your own clean `deno task test:probes:fresh`, with no other reset during it.

ACCEPTANCE:
  - paid_consultation.sql (ROLLBACK): a paid request through place_wallet_order holds exactly one
    escrow on the host's consultations engagement; two concurrent first requests mint one
    engagement; decline and expiry refund in full and cancel the sitting; a confirmed call releases
    through the sweep 24 h after its tracked sitting; a host who is not payout-ready cannot enable
    paid calls; the engagement appears in neither party's project list (read as each, under RLS); a
    direct request_discovery_call('paid') is still refused.
  - finance_invariants.sql and session_settlement.sql pass.
  - By hand: a seeded client books a paid consultation from a profile and pays from the wallet, the
    host confirms, and the call appears on both calendars. Screenshots at 1440 and 390.
```

---

## 8. Last — Docs

### SCH-Z1 — Scheduling docs sweep and audit status

> **Status 2026-11-23:** step 3 landed in `8a3fd595` (the consolidated audit carries its title, and
> S-32's sentence sits in its row); steps 1, 2 and 4–6 below are open. Step 6 is SCH-WP8's residue.

```text
PROMPT SCH-Z1: Scheduling documentation sweep

ROLE: Documentation steward. Runs after every prompt above has merged.

FILES:
  - documentation/database/{scheduling,projects,integrations}/*
  - business/PRODUCT_SPEC.md (§Stage Formats 2 Session-Based A-D, §Discovery & Courtesy Calls,
    §Dispute Resolution 3); business/finance-model.md §4 and §16.3; PRODUCT_MANAGEMENT.md §3.5
  - architecture/SYSTEM_ARCHITECTURE.md (§Integration Blueprints 2-3, §Scheduled jobs, §Edge
    Functions & Webhooks, the Environment Variable Contract); architecture/ROUTING.md;
    design-system/DESIGN_SYSTEM.md (§C.1)
  - api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md (§3.4, §7, §9.4, §10, §12)
  - architecture/SCHEDULING_COMPLETENESS_AUDIT.md (the §10 Status column: Fixed by <prompt> /
    Open; the banner's status line)
  - supabase/migrations/00001260_functions_finance_disputes.sql (a header comment only, step 6)
  - the decision rows #343 and #59: each ruling marked built by its prompt; #59's flag resolved by
    #343 ruling C4 (c)

STEPS:
  1. Rollup, not restatement (documentation/CLAUDE.md rule 2): each satellite links to the SSOT
     line a prompt wrote, rather than repeating it.
  2. Every "Not built yet (Decision #343, ruling …)" marker is gone where its prompt merged, and is
     still accurate where it did not.
  4. finance-model.md §4 (:192) says a freelancer cancel refunds "all remaining sessions". Align it
     with PRODUCT_SPEC (:130, :352) and Decision #171 (D): a full refund at any time, which on a
     1-1 block means every sitting not yet started.
  5. Every 🧑 in this file's §0.3 ends Resolved (with its ruling) or Open with an owner. A new
     contradiction a prompt found is logged per root §8; re-read the decision index seconds before
     writing the row.
  6. 00001260's header diagram (:10) still says "both in the room ≥ 80 % — dismissed". Since
     SCH-WP8 the attendance audit dismisses strictly above the threshold: correct the comment, in
     place.

ACCEPTANCE:
  - grep -rn "Not built yet" documentation | grep "#343" lists only work that has not merged.
  - Every function, trigger, job and route named in SCH-WP2 to SCH-WP10 (their text at `f2e25929`)
    and in SCH-WP6 and SCH-WP7 appears in documentation/database/* or ROUTING.md.
  - The audit's Status column has no blank cells.
```
