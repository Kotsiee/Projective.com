# Scheduling Build Prompts — Claude Code Work Orders for Calls, Sessions, Integrations & `/calendar`

> **Status: WORK ORDERS, not binding.** This is the scheduling track (track C of
> [`FOUNDER_QUESTIONNAIRE.md`](FOUNDER_QUESTIONNAIRE.md) Part B §B.3), written as a sequenced series
> of self-contained Claude Code prompts. They close the open findings of
> [`SCHEDULING_COMPLETENESS_AUDIT.md`](SCHEDULING_COMPLETENESS_AUDIT.md) (`S-nn`) under the owner's
> rulings C1–C7 on **Decision #343**.
> [`SCHEDULING_DECISIONS_AND_GAPS.md`](SCHEDULING_DECISIONS_AND_GAPS.md) (SDG, rulings D0–D9)
> drafted that row as "#335". Every prompt cites its evidence by finding ID and its ruling as
> `(Decision #343, ruling Cn)`. Paste each prompt into its **own fresh session**, after the standard
> header (§1).
>
> **Before you start:** main must carry Wave 1.1 (`94d22e84`, the rulings) and the Wave 1.3 jobs
> session's `00005060` set (`e18489d4` on `claude/wave1-jobs-sql-c504e8`). Run the prompts in the §0
> order. A prompt marked **🧑 DECISION** stops and puts the named question to a human before it
> changes that behaviour. It presents the options with a recommendation. §0.3 lists every stop.
>
> **Verified done in Wave 0** (against git: `942c8dde` and `e30b4111`, merged at `be031aa2` and
> `8c825070`):
>
> - SCH-WP1's SQL half: D0's doors `projects.schedule_sitting` and `retitle_sitting`, the group
>   sitting's roster-less calendar mirror, `trg_sitting_round_guard` (S-05).
> - SCH-WP2's integrity half: S-06 and S-07.
> - SCH-WP11's anon half: S-16's column grant and S-32's `restrictBooking`.
> - SCH-WP12 except S-38 and S-40: S-34, S-35, S-36, S-37 and S-41.
> - Before Wave 0: S-01, S-26 and S-30.
>
> **Not done, and placed below:**
>
> - SCH-WP1's app half. Nothing calls the two sitting doors, and a seat-holder cannot see a group
>   sitting (SCH-WP7).
> - S-16's signed-in half (SCH-WP3).
> - S-38 and S-40 (SCH-WP10).
>
> `scheduling.fn_expire_discovery_calls`, `scheduling.fn_settle_votes`, the `paid_unavailable`
> refusal and a reminder producer do not exist yet. The jobs set seeded a dormant job row for each
> of the first two, and each row registers itself on the first reset after its function exists.
>
> **Migrations are edited in place** (root `CLAUDE.md` §1). Every prompt names the category file it
> edits, never a new "fix" file.

---

## 0. Run order & dependencies

| Phase                        | Prompts                       | Why this order                                                                                                                                                                                                                                                                                              |
| :--------------------------- | :---------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Containment (P0)**     | SCH-WP2                       | Paid calls are bookable with no payment (S-02), so they are turned off. Unanswered requests squat free/busy (S-11), so they expire.                                                                                                                                                                         |
| **2 — The call lifecycle**   | SCH-WP3                       | C3's door matrix makes a discovery call usable end to end (S-10, S-27), with its notices and reminders (S-18). SCH-WP6 and SCH-WP9 build on its doors.                                                                                                                                                      |
| **3 — Runtime and evidence** | SCH-WP4a → SCH-WP4b → SCH-WP5 | C4. First the token vault and the Fresh + pg_cron runtime (4a). Then rooms on the host's account and calendar sync (4b). Then presence matched by each person's own link (5). This is the evidence SCH-WP8 and SCH-WP9 judge (S-03, S-04, S-19). WP4 is two prompts because each half is a session of work. |
| **4 — Money rules**          | SCH-WP8 → SCH-WP7 → SCH-WP6   | C5's settlement rules come first, on evidence that now exists (8). Then C2's windows, which route money through the cancel and sweep paths 8 corrected and lift SCH-WP1's group-sitting freeze (7). Then C1's paid consultations, which inherit both through the session rail (6; SDG §4 step 5).           |
| **5 — Coordination**         | SCH-WP9                       | C6. D5 and D8 stand alone. D7 needs SCH-WP3's no-show door and SCH-WP5's call presence.                                                                                                                                                                                                                     |
| **6 — Calendar UI**          | SCH-WP10                      | C7, P7 and the rest of SCH-WP12 (S-38, S-40). It is app-only, and it runs last because SCH-WP3 and SCH-WP9 also edit `EventModal`.                                                                                                                                                                          |
| **Last**                     | SCH-Z1                        | The docs sweep and the audit's status column.                                                                                                                                                                                                                                                               |

**Every SQL step is serial** (SCH-WP2 → SCH-WP9). They share `00001155` (sessions, a §B.0 hot file
whose only writer is this track), `00001510` and `00001520` (scheduling) and the one local database.
SCH-WP10 is app-only, so it may run beside another track's SQL step.

These cannot run in parallel because they edit the same files:

- any two SQL prompts (`00001155`, `00001510`, the shared database)
- SCH-WP3 / SCH-WP9 / SCH-WP10 (`EventModal.tsx`, `tabs/EventRescheduleTab.tsx`, `coordination.ts`)
- SCH-WP3 / SCH-WP6 (`BookingBackendService.ts`, `calls.ts`, `ConsultationModal.tsx`)
- SCH-WP4b / SCH-WP5 (`RoomBackendService.ts`, `sessions/presence/*`, `00005050`)
- SCH-WP7 / SCH-WP9 (`coordination.ts` and its contract test, `fn_vote_deadline`,
  `fn_cap_reschedule_proposals`)
- any two of SCH-WP3, SCH-WP4b, SCH-WP6, SCH-WP7 and SCH-WP8 (each adds a Dev Context Switcher axis
  in `features/devtools` + `dev-seam.ts`)

### 0.1 Cross-track conflicts

The §B.0 hot files have one writer at a time:

| Hot file                                                                    | This track writes it in                                                                                                                | Other writers: never at the same time                                                                     |
| :-------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `00001155` (sessions)                                                       | every SCH work package                                                                                                                 | none                                                                                                      |
| `00005060` (jobs)                                                           | SCH-WP3, WP4a, WP4b (new rows only). SCH-WP2 and WP7 never edit it: their rows are seeded dormant and wait for their functions by name | finance, comms, PM, security; and only once the Wave 1.3 jobs set (`e18489d4`) has merged                 |
| `00002510` (grants)                                                         | every SQL prompt                                                                                                                       | many: edit it last in your session, after re-reading it                                                   |
| `00001300` (comms)                                                          | none: SCH-WP3 only calls `comms.fn_notify`, `fn_enqueue` and `fn_cancel_queued`                                                        | M track                                                                                                   |
| `stripe-webhook.ts` + `00001230`                                            | none: SCH-WP6 rides the existing card → order path                                                                                     | F·DB2, F·DB6, S·S4. If SCH-WP6 finds `00001230` enumerating line kinds, that edit waits for them          |
| `features/devtools` + `dev-seam.ts`                                         | SCH-WP3, WP4b, WP6, WP7, WP8                                                                                                           | F·SV4, F·UI3, S·S4, S·S6, I·F6                                                                            |
| `00001020` · `00001060` · `00001240` · `live-wallet.ts` / `wallet-scope.ts` | none                                                                                                                                   | SCH-WP4a adds the revoke-on-disconnect door that I's erasure chain will call; it does not edit `00001060` |

Shared files that are not on the §B.0 list:

- `00000004` enums: SCH-WP6 (`purchasable_item_kind`) and SCH-WP9 (a comment). Every track edits
  this file, so rebase before you start.
- `00000015` projects tables: SCH-WP5 and SCH-WP6. Also the P track (WP4, WP5).
- `00001210` (`place_wallet_order`): SCH-WP6. Also F·DB3 and F's M8 prompt (the refunded and
  cancelled order writers).
- `CheckoutBackendService.ts` / `live-basket.ts`: SCH-WP6. Also F·SV4 and F·SV5.
- `00005010` notification catalog: SCH-WP2, WP3, WP4a, WP8. Also M's notify engine (N8–N12).
- `00005001` platform params: SCH-WP7, WP8, WP9. Every track.
- `00002520` table grants: SCH-WP3, WP5. Also the I track.
- `security.penalties` writers: SCH-WP9 (D7). Also T's moderation loop (T4; R1–R5).
- Docs: the `SYSTEM_ARCHITECTURE.md` env contract (every track);
  `EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md` (T edits §6; SCH-WP4 edits §7, §9.4, §10,
  §12); `ROUTING.md` (P·WP8 also edits URL rules); `DESIGN_SYSTEM.md` (pull before every edit).

### 0.2 Cross-track waits

| Step                     | Waits on                                                                                                                                                                                                                          | Why                                                                                                                               |
| :----------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| SCH-WP2                  | the Wave 1.3 jobs set (`e18489d4`)                                                                                                                                                                                                | Its dormant row `scheduling-expire-discovery-calls` registers once `scheduling.fn_expire_discovery_calls` exists.                 |
| SCH-WP3                  | M's notify engine (N8–N12), for email and push only                                                                                                                                                                               | The comms queue worker (`comms-process-queue`, every minute) is live, so in-app notices and queued reminders are delivered today. |
| SCH-WP7                  | the Wave 1.3 jobs set (`e18489d4`)                                                                                                                                                                                                | Its dormant row `scheduling-settle-votes` registers once `scheduling.fn_settle_votes` exists.                                     |
| SCH-WP6                  | F·DB7 (Wave 0; done except the per-user promo cap and the refunded and cancelled writers) and F·SV4 (`place_wallet_order`'s callers, `p_expected_minor`, checkout blockers). Better after F's M8 prompt and F's payout gate (M4). | A paid call is a checkout line, and a declined call's refund is an order-line refund.                                             |
| SCH-WP9 (D7 only)        | none, but never beside T's step that reworks penalty aggregation                                                                                                                                                                  | They write the same table, `security.penalties`.                                                                                  |
| Other tracks on this one | T·P2 hardening ⏳ SCH-WP10 (triggers on event text). I·IW-M13 ⏳ every SCH SQL step. P·WP8 and SCH-WP10 both write calendar URL rules into `ROUTING.md` (P7), so they do not run together.                                        | Part B §B.3                                                                                                                       |

### 0.3 Open decisions (🧑) and new contradictions

Each stop below is open, and this file decides none of them. The prompt named first asks it.

1. **SCH-WP3: who accepts a re-proposed call time.** C3 says the host confirms. For a new time the
   host proposes, the literal reading lets the host confirm their own move. Recommendation: the
   counterparty of the last proposal confirms, which is the 1-on-1 rule the calendar already applies
   (`coordination.ts:549`).
2. **SCH-WP4b: calendar strategy, direct or Nylas.** Decision #335 flag (a) was logged but never put
   to the owner. The seed and SA §3.2 say Nylas; the providers spec recommends direct.
   Recommendation: direct for the MVP.
3. **SCH-WP4b: "the platform's own room".** `PRODUCT_SPEC.md:93` offers a host with no connected
   account "Connect or the platform's own room". No such room, provider or sub-processor exists or
   is specified anywhere. SA §3.2 and the providers spec say only "falls back to a platform room /
   manual link". Recommendation: no platform room for the MVP. Offer Connect, or the manual https
   link that PRODUCT_SPEC §Discovery already promises.
4. **SCH-WP7: a started group cohort's dissenters. This is a new contradiction.** PRODUCT_SPEC's
   Reschedule row (`:134`, written in Wave 1.1) says a move is decided before the window "so every
   attendee can still cancel against either time". But a group seat is "one transaction for the
   whole cohort, timed from its first sitting" (`:149`; `cancel_cohort_membership`,
   `00001155:1084-1089`). Once a cohort has started, no dissenter can cancel without forfeiting.
   Recommendation: a dissent exit that refunds the share of the sittings not yet held.
5. **SCH-WP8: what "held for review" means.** C5 (a) rules that a sitting with no presence data is
   held. It does not say who releases a held sitting, or whether a host attestation counts as
   presence data. Recommendation: the attendee confirms, a "no" becomes a no-show claim, and silence
   goes to the operator desk. A host attestation alone is not evidence.
6. **SCH-WP9: D7's weight.** "Low weight" has no number. Recommendation: each mark is a
   `security.penalties` row of severity 2 that lapses after 90 days, both dials in
   `finance-model.md` §16.3.
7. **SCH-WP10: the unmerged calendar write path.** `refs/heads/claude/dreamy-hamilton-026625`
   (`a80ce2f5`, Decision #328 (a), an event write door) and `refs/heads/claude/modest-mendel-ae6318`
   (`d3768133`, the agenda sanitiser; `83cb1720`) were verified on 2026-10-25 and never merged. On
   main, #328 (a) is still open. Whether they merge decides what C7 (a) hides. Recommendation: merge
   them first.

Also found, already decided, for SCH-Z1 to align:

- `finance-model.md` §4 (`:182`) says a freelancer cancel refunds "all remaining sessions".
  PRODUCT_SPEC (`:130`, `:352`) and Decision #171 (D) say a full refund at any time, and so does the
  code.
- `SCHEDULING_COMPLETENESS_AUDIT.md`'s title line was overwritten in Wave 0 (`942c8dde`) by S-32's
  fix sentence.

From the list of items still open after Wave 1.1, this track touches only two:

- **The FX margin** (#337 M5). A paid call is priced in the host's currency, and SCH-WP6 adds no
  conversion.
- **Which fee an Agency's contract rate applies to** (#252). SCH-WP6 keeps the session rail's
  `fn_escrow_fee_bp` and decides nothing about it.

No ⚖️ item is in this track.

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
  2. Read documentation/architecture/SCHEDULING_COMPLETENESS_AUDIT.md (the S-nn findings cited
     below), SCHEDULING_DECISIONS_AND_GAPS.md (rulings D0-D9 and the shapes it proposes) and the
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
    ScheduleBackendService, SessionBackendService, IntegrationsBackendService (and the new
    CalendarSyncBackendService and RoomBackendService) and returns ServiceResult<T> (#10). A cron
    route checks its bearer in constant time and answers 404 otherwise
    (apps/web/routes/api/scheduling/cron/horizon.ts is the pattern). Its job is a row in 00005060
    (Decision #203), written only while you own that file. Two scheduling rows already wait there,
    dormant, for a function by name: scheduling-expire-discovery-calls for
    scheduling.fn_expire_discovery_calls, and scheduling-settle-votes for
    scheduling.fn_settle_votes. Name those functions exactly (any arguments must have defaults)
    and never edit their rows.
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
```

---

## 2. Phase 1 — Containment

### SCH-WP2 — Paid calls off, unanswered requests expire (P0)

```text
PROMPT SCH-WP2: Paid discovery calls are refused, and an unanswered request expires

ROLE: Postgres + backend engineer. Audit S-02 (P0), S-11; SDG §1.2 (the interim) and §3.1 (the
expiry row).

CONTEXT:
  - Ruling: paid calls are turned off now, and Option C follows in SCH-WP6 (Decision #343, ruling
    C1). Today a paid consultation can be booked with no payment, no cap and no expiry (S-02). The
    Consultation modal offers it (ConsultationModal.tsx:418-427). BookingBackendService.contact →
    bookDiscoveryCall (:911-1068) → scheduling.request_discovery_call (00001520:121-257) copies the
    fee onto the row, and nothing ever writes payment_ref or escrow_id. With auto_confirm the call
    is born confirmed.
  - Nothing expires a `proposed` call (S-11), and get_free_busy unions proposed calls, so one
    account can squat a provider's slots for max_advance_days. The parameter exists
    (discovery_call_proposal_ttl_hours, 00005001:150); the sweep does not.
  - Done in Wave 0 (942c8dde): S-06 and S-07. Do not redo them.
  - Registration: the Wave 1.3 jobs set (e18489d4) seeded the row scheduling-expire-discovery-calls
    (1,16,31,46 * * * *) dormant in 00005060. It waits for a function named exactly
    scheduling.fn_expire_discovery_calls (its guard is to_regproc by name, so any argument must have
    a default) and registers itself on the first reset after the function exists. Do NOT edit
    00005060.

FILES:
  - supabase/migrations/00001520_functions_scheduling_free_busy.sql (request_discovery_call refuses
    p_call_type = 'paid')
  - supabase/migrations/00001510_functions_scheduling.sql (new scheduling.fn_expire_discovery_calls,
    beside the call lifecycle functions)
  - supabase/migrations/00002510_permissions_function_grants.sql (the sweep is service_role only)
  - supabase/migrations/00005010_seed_notification_catalog.sql (a `call.expired` row: category
    schedule, in_app + email, shaped like availability.booking_request)
  - packages/types/scheduling/calls.ts (CallRefusalReason and CALL_REFUSAL_COPY gain
    paid_unavailable; a PAID_CALLS_LIVE = false constant; the stale flags at :23-34)
  - packages/backend/services/scheduling/live-call-offer.ts (:63, `priced`)
  - packages/backend/services/booking/BookingBackendService.ts (CALL_REFUSAL :935, the check :1006)
  - apps/web/features/profile/islands/AvailabilityEditor.island.tsx (:390-410, the paid switch)
  - supabase/probes/discovery_call_expiry.sql (new)
  - documentation/database/scheduling/{Functions,Tables}.md; business/PRODUCT_SPEC.md §Discovery &
    Courtesy Calls (:1962-1970); business/finance-model.md §4 (:193-197);
    PRODUCT_MANAGEMENT.md §3.5 (the Discovery call row)

STEPS:
  1. Reproduce: as a signed-in requester, call scheduling.request_discovery_call with call_type
     'paid' on a schedule whose call_settings has paid_enabled and auto_confirm. Today it returns a
     confirmed, unpaid call. Write the probe so it asserts the refusal after the fix.
  2. request_discovery_call raises 'Discovery call refused: paid_unavailable' (check_violation, the
     refusal shape refusalCode() already parses) for p_call_type = 'paid', before the schedule lock
     and the insert. Courtesy calls are unchanged. The door keeps its signature: SCH-WP6 brings paid
     calls in through checkout, never through this door.
  3. scheduling.fn_expire_discovery_calls() RETURNS integer, SECURITY DEFINER, search_path ''. In
     batches, FOR UPDATE SKIP LOCKED, it moves a `proposed` call to `expired` once proposed_at +
     discovery_call_proposal_ttl_hours has passed, or once proposed_start has. It touches nothing
     else: the transition trigger lets a writer with no auth.uid() through unchecked, so the WHERE
     clause is the only guard. It notifies the requester and the host (`call.expired`) and returns
     the count. It is idempotent.
  4. Registration needs no 00005060 edit. Name the function exactly as the dormant row expects
     (scheduling.fn_expire_discovery_calls, every argument with a default): any other name leaves
     the job silently unregistered. After your reset, SELECT name, schedule, enabled FROM
     ops.scheduled_jobs WHERE name = 'scheduling-expire-discovery-calls' shows it enabled.
  5. Hide the paid flavour through one seam, PAID_CALLS_LIVE = false in calls.ts. While it is
     false, live-call-offer.ts reports paidEnabled false, so ConsultationModal and
     SessionBookingModal (:261, :320) render no paid card. Grep every other reader of paidEnabled.
     The service refuses a paid request with paid_unavailable before SQL. The owner's editor keeps
     the stored settings but shows the paid switch disabled, with one sentence: paid consultations
     open once their payment path exists. Gate 11 forbids a switch that saves a setting nothing
     reads. Never rewrite stored call_settings rows.
  6. calls.ts :23-34 is stale. The escrow flag predates #126 (payer_business_id is nullable) and
     #211 (the session rail is built), and the cancellation flag was settled by the 100 % forfeit
     (ruling C2 (a)). Replace each with one line citing Decision #343, rulings C1 and C2 (a): this
     is the code-comment half of ruling Q0.4.

SAME CHANGE:
  - Migrations edited in place (root §1).
  - Zod (calls.ts) with documentation/database/scheduling/Functions.md (the refusal, the sweep) and
    Tables.md (the writer of the `expired` transition).
  - PRODUCT_SPEC :1962-1970 keeps "Not built yet" for the paid path only (drop "including the
    interim switch-off"); finance-model §4 :193-197 likewise.
  - PRODUCT_MANAGEMENT §3.5: `expired` now has a writer (a lifecycle change).
  - No Dev Context Switcher axis: this is a hard switch, not a state.

VERIFY (SQL):
  - Run `deno task test:probes` while iterating (add a probe's name to run just that one).
  - One local database: at most 2 SQL sessions at once, on disjoint migration files. Announce every
    `deno task db:reset` to the other sessions before you run it.
  - Finish with your own clean `deno task test:probes:fresh`, with no other reset during it.

ACCEPTANCE:
  - discovery_call_expiry.sql (ROLLBACK): a paid request → paid_unavailable; a courtesy request
    still lands; a proposed call past its TTL, and one past its start, → expired; a confirmed call
    is untouched; a second run changes nothing; get_free_busy no longer returns the expired span.
  - After your reset the dormant row scheduling-expire-discovery-calls is registered and enabled,
    and `deno task cron:run scheduling-expire-discovery-calls` runs it.
  - group_sitting_doors.sql, scheduling_slot_integrity.sql and session_settlement.sql still pass.
  - Signed in as a seeded provider with paid calls on, neither the profile's Consultation modal nor
    the listing's booking modal shows a paid card (screenshots at 1440 and 390).
```

---

## 3. Phase 2 — The call lifecycle

### SCH-WP3 — The discovery-call doors, notices and reminders

```text
PROMPT SCH-WP3: A discovery call can be confirmed, declined, moved, cancelled and marked a no-show

ROLE: Postgres + full-stack engineer. Audit S-10, S-27, S-18, S-16 (its signed-in half); SDG §3.1
and §3.7.

CONTEXT:
  - Ruling: the door matrix (Decision #343, ruling C3). The host confirms or declines; a decline
    refunds a paid call (SCH-WP6 wires that refund). Either side proposes a new time outside the
    lockout. Either side cancels, with lateness derived. A no-show is claimed from start + 15 min,
    with presence evidence where the call is tracked. A 15-minute job expires unanswered requests
    (SCH-WP2) and completes courtesy calls past their end.
  - Today no client door exists past request_discovery_call (S-10: the UPDATE grant was removed and
    00002520 is SELECT only), so a host cannot even decline. /calendar hides RSVP for a call
    (EventModal.tsx:373-374) and puts nothing in its place (S-27).
  - fn_enforce_call_transition (00001510:920-1011) is a legality layer, not an authorisation layer.
    It stamps confirmed_at, responded_at, cancelled_at and is_late_cancel, and on a reschedule it
    clears confirmed_*, so free/busy releases the old slot. It has no time check on confirmed →
    proposed (audit §6), so the doors carry the lockout.
  - Reminders have no producer (S-18). session.reminder_60m/15m/5m are in the catalog
    (00005010:73-75) and discovery_call_reminder_lead_minutes is in 00005001:145.
    comms.fn_enqueue and fn_cancel_queued (00001310 §7) queue reminders, and the live
    comms-process-queue job (every minute, Wave 1.3) delivers them, so in-app notices and reminders
    work now. Email and push wait for M's notify engine.
  - S-16's anon half is done (942c8dde: a column grant on call_settings). Signed-in users still read
    every column, the caps, cooldown and auto_confirm included, because the owner's editor reads
    CALL_COLUMNS through the table.

🧑 DECISION — before you write propose_call_time's acceptance rule, put this to me:
  The matrix says the host confirms. For a time the HOST re-proposes, the literal reading lets the
  host confirm their own move.
  Option A (recommended): the counterparty of the last proposal confirms. The host confirms a
  request or the requester's new time; the requester confirms the host's new time. This is the
  1-on-1 rule the calendar already uses (coordination.ts:549, counterpartyAcceptRefusal). It needs
  discovery_calls.proposed_by scheduling.call_party (in place in 00000022).
  Option B: the host confirms every proposal, and a requester who dislikes the host's new time
  cancels.
  The other doors do not depend on this: build them first.

FILES:
  - supabase/migrations/00001510_functions_scheduling.sql (confirm_discovery_call,
    decline_discovery_call, propose_call_time, cancel_discovery_call, mark_call_no_show; the
    completion branch of fn_expire_discovery_calls; scheduling.fn_enqueue_due_reminders;
    scheduling.get_own_call_settings)
  - supabase/migrations/00000022_tables_scheduling.sql (proposed_by, if Option A)
  - supabase/migrations/00001155_functions_projects_sessions.sql (cancel_cohort_membership cancels a
    cancelled sitting's queued reminders)
  - supabase/migrations/00002510_permissions_function_grants.sql (the five doors and
    get_own_call_settings to authenticated; the reminder sweep to service_role)
  - supabase/migrations/00002520_permissions_table_grants.sql (authenticated gets anon's
    call_settings column grant instead of the table grant)
  - supabase/migrations/00005010_seed_notification_catalog.sql (call.confirmed, call.declined,
    call.time_proposed, call.cancelled, call.no_show, call.reminder)
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (one new row, scheduling-reminders, every 5
    minutes. No dormant row exists for it, so this prompt adds it, owning 00005060 only while it
    runs; never touch the two dormant scheduling rows)
  - packages/types/scheduling/calls.ts (CallActionInputSchema, a union discriminated on `action`)
  - packages/backend/services/booking/BookingBackendService.ts (callAction; the refusal copy)
  - packages/backend/services/scheduling/live-calendar.ts (a call's booking event carries callId,
    status, the viewer's party and what that party may do now), live-owner-availability.ts (the
    editor reads through get_own_call_settings)
  - apps/web/routes/api/scheduling/calls.ts (new; POST, shaped like the reschedule route)
  - apps/web/features/calendar/components/EventModal.tsx and a new CallActionBar component (S-27);
    apps/web/features/calendar/core/ScheduleService.ts
  - apps/web/features/devtools/*, apps/web/utils/dev-seam.ts (the discoveryCall axis)
  - supabase/probes/discovery_call_doors.sql (new)
  - documentation/database/scheduling/{Functions,Policies,Tables}.md; architecture/ROUTING.md (the
    API table); business/PRODUCT_SPEC.md §Discovery (:1972-1977); PRODUCT_MANAGEMENT.md §3.5

STEPS:
  1. Reproduce: as the host of a seeded proposed call, there is no way to decline it (no door, no
     UPDATE grant). Write the probe so it asserts each door after the fix.
  2. Five SECURITY DEFINER doors, search_path ''. Each locks the call row FOR UPDATE, names who may
     act, and refuses in the 'Discovery call refused: <code>' shape the service maps:
     - confirm_discovery_call(p_call): the confirming party (the 🧑 above), from proposed, before
       proposed_start. It copies proposed_* into confirmed_*; the trigger stamps the rest.
     - decline_discovery_call(p_call, p_reason text DEFAULT NULL): the host, from proposed, at any
       time.
     - propose_call_time(p_call, p_starts_at, p_ends_at): host or requester, from proposed or
       confirmed. Both the current slot and the new one must be outside the lockout: 12 h for a
       courtesy call, the literal fn_vote_deadline uses, pinned to RESCHEDULE_LOCKOUT_HOURS by
       coordination.contract.test.ts (SCH-WP7 turns both into parameters). The new slot keeps the
       call's duration and is re-judged by fn_call_request_refusal with the call itself excluded
       (add that argument with a NULL default).
     - cancel_discovery_call(p_call, p_reason DEFAULT NULL): either party, from confirmed; the
       requester may also withdraw a proposed call. is_late_cancel stays derived.
     - mark_call_no_show(p_call, p_party scheduling.call_party): either party, from confirmed, from
       confirmed_start + session_presence_minutes; a party never marks themselves. When the call has
       call_attendance rows (it is tracked: SCH-WP5 writes them), refuse a mark the evidence
       contradicts, i.e. the named party joined inside the window.
     Every door notifies the other party (the new catalog rows). call_audit keeps logging through
     its existing trigger.
  3. fn_expire_discovery_calls also completes courtesy calls past confirmed_end (confirmed →
     completed). A paid call never completes here: SCH-WP6 completes it through its sitting.
  4. scheduling.fn_enqueue_due_reminders() queues, through comms.fn_enqueue, the reminders of every
     scheduled sitting and confirmed call that starts in the next 2 hours. Dedupe keys are
     'sitting:<id>:<lead>' and 'call:<id>:<lead>', so a moved time re-queues in place. Every cancel,
     decline, expiry and sitting cancellation calls comms.fn_cancel_queued for its entity. Register
     the sql job.
  5. S-16's signed-in half: scheduling.get_own_call_settings(p_schedule), a definer behind
     fn_can_manage_schedule, returns the owner's full row; live-owner-availability reads through it.
     Then give authenticated the same column grant as anon.
  6. POST /api/scheduling/calls: session (401), age gate, Zod CallActionInputSchema, then
     BookingBackendService.callAction. Map every refusal to a sentence (the CALL_REFUSAL pattern).
  7. UI (S-27): in place of RSVP, the call's modal shows a CallActionBar with only the actions the
     read says the viewer may take now (gate 11): Confirm (the one fill, tier 3), Propose a new
     time, Decline or Cancel (tier 5 text, each with a one-line consequence) and Report a no-show
     (from start + 15 min). It uses the existing date-time pickers, and it states the lockout before
     the press, not after.
  8. Dev Context Switcher: discoveryCall (auto · proposed, host's view · proposed, requester's
     view · confirmed · no-show claimable · expired), applied in the read under the dev seam.

SAME CHANGE:
  - Migrations edited in place (root §1).
  - Zod (calls.ts) with documentation/database/scheduling/* (each door, the reminder sweep, the
    policy change).
  - PRODUCT_MANAGEMENT §3.5, the Discovery call row: the doors are built; the paid half stays
    marked.
  - PRODUCT_SPEC :1972-1977: remove the "Not built yet" marker.
  - ROUTING.md: the new API row.
  - The discoveryCall Dev Context Switcher axis.
  - DESIGN_SYSTEM §C.1 only if CallActionBar lands in packages/ui (keep it in features/calendar
    unless a second surface needs it).

VERIFY (SQL):
  - Run `deno task test:probes` while iterating (add a probe's name to run just that one).
  - One local database: at most 2 SQL sessions at once, on disjoint migration files. Announce every
    `deno task db:reset` to the other sessions before you run it.
  - Finish with your own clean `deno task test:probes:fresh`, with no other reset during it.

ACCEPTANCE:
  - discovery_call_doors.sql (ROLLBACK): each door's allowed path, and its refusal for the wrong
    party, state and time; a move inside 12 h is refused; a moved call frees its old span in
    get_free_busy; a no-show before start + 15 min is refused; the completion branch completes
    courtesy calls only; replaying a door is a refusal, never a second notice; a signed-in non-owner
    reading call_settings.courtesy_max_per_week gets 42501.
  - The reminder sweep queues the 60/15/5-minute reminders for a seeded sitting once, re-times them
    after a move and cancels them on a cancellation.
  - /calendar as a seeded host: Confirm a proposed call, reload, and it is confirmed. As the
    requester: Cancel, and the call leaves the host's calendar. Screenshots at 1440 / 900 / 390 in
    light, dark, high contrast and reduced motion.
```

---

## 4. Phase 3 — Runtime and evidence

### SCH-WP4a — The token vault and the integration runtime

```text
PROMPT SCH-WP4a: The token vault keys on ENCRYPTION_KEY, and the handshake, refresh and webhooks run
as Fresh routes plus pg_cron http jobs

ROLE: Backend security engineer (OAuth, Web Crypto, Postgres). Audit S-19 (its runtime half), S-20;
Decision #343 contradiction (b); Decision #335 flag (b); providers spec §7.1, §7.6, §9.4.

CONTEXT:
  - Rulings (Decision #343, ruling C4):
    (a) The runtime is Fresh routes plus pg_cron http jobs (CalendarSyncBackendService and
        RoomBackendService, one deduplicated webhook route), and SA §3.3 is amended. That resolves
        #343 (b).
    (c) The token-vault key is the ENCRYPTION_KEY env, not KMS. This overrides #335 (b)'s proposal
        to make ENCRYPTION_KEY a development-only KEK that production refuses. #335 (b)'s envelope
        columns still stand: a wrapped DEK, and one nonce per ciphertext. It resolves Decision #59's
        flag.
  - token-vault.ts refuses every seal and unseal today ("KMS envelope encryption is not yet
    provisioned", :97-140). So no OAuth connection can be stored: not calendar, not conferencing,
    and not the storage connectors (#313, #314) either. connection_secrets (00000020:168) has ONE
    nonce for two ciphertexts and no wrapped-DEK column.
  - startConnection and completeConnection refuse. The handshake is specified in providers spec
    §7.1, and packages/backend/core/env.ts does not read the integration client ids yet.
  - Presence ingest is already a Fresh route (/api/sessions/webhooks/[provider], Decision #171), but
    it records nothing in integrations.webhook_deliveries (S-20).
  - Ask the 🧑 in SCH-WP4b now (direct or Nylas), so that SCH-WP4b is not blocked waiting for it.

FILES:
  - supabase/migrations/00000020_tables_integrations.sql (connection_secrets: wrapped_dek,
    refresh_token_nonce, api_secret_cipher, api_secret_nonce, ck_secret_nonces, in place)
  - supabase/migrations/00001500_functions_integrations.sql (definers to claim connections due for
    refresh and channels due for renewal, SKIP LOCKED; a revoke-on-disconnect door)
  - supabase/migrations/00002510_permissions_function_grants.sql
  - supabase/migrations/00005010_seed_notification_catalog.sql (integration.reconnect_required)
  - supabase/migrations/00005050_seed_reference_data.sql (#335 flag (i), factual: Outlook gains
    offline_access and User.Read, or Graph issues no refresh token; Zoom's scopes follow the scope
    model of the app you register)
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (integrations-refresh-tokens,
    integrations-renew-channels, integrations-consent-sweep: providers spec §7.6)
  - packages/backend/services/integrations/token-vault.ts (+ token-vault.test.ts),
    IntegrationsBackendService.ts (startConnection, completeConnection, refresh, revoke)
  - packages/backend/core/env.ts (ENCRYPTION_KEY, INTEGRATIONS_CRON_SECRET, the integration client
    ids)
  - apps/web/routes/api/integrations/webhooks/[provider].ts (new: the one deduplicated route);
    apps/web/routes/api/integrations/cron/{refresh,channels}.ts (new);
    apps/web/routes/api/sessions/webhooks/[provider].ts (becomes a re-export of the new handler)
  - packages/types/integrations/* (SealedSecret, the secrets row)
  - .env.example (ENCRYPTION_KEY's comment; KMS_KEY_ALIAS removed; INTEGRATIONS_CRON_SECRET added)
  - documentation/architecture/SYSTEM_ARCHITECTURE.md (the §3.2 token-vault bullet, §3.3, §Edge
    Functions & Webhooks, §Asset Management → The token vault, the Environment Variable Contract);
    documentation/api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md (§7.1, §7.6, §7.7,
    §9.4, §10, §12); documentation/database/integrations/{Tables,Functions}.md;
    architecture/ROUTING.md; PRODUCT_MANAGEMENT.md §3.5 (the Integration connection row)

STEPS:
  1. Reproduce: in token-vault.test.ts, seal() then unseal() must round-trip. Today it rejects.
  2. The envelope under ENCRYPTION_KEY (32 bytes, hex). Each secret row gets a fresh 256-bit DEK,
     wrapped by the KEK with AES-256-GCM under its own nonce, stored with the wrapped DEK. Each
     token or API secret is sealed under the DEK with its own 96-bit nonce and AAD =
     "<connection_id>|<kind>|<key_id>", where key_id = "env:" + the first 8 hex of sha256(key).
     unseal() refuses, loudly, a row whose key_id is not the current key's; it never returns
     garbage. A tag failure is a tamper signal. Zero the DEK after use and never log it. The server
     refuses to boot with a missing, placeholder (XXXX-XXXX) or short key whenever
     INTEGRATIONS_BACKEND_LIVE is on, in production too.
     shortcut: no rewrap. key_id finds the rows when a key rotation is built; say so in the code.
  3. The columns per #335 (b), edited into the CREATE TABLE.
  4. The handshake per providers spec §7.1: consent_states is single use; PKCE; the token exchange
     happens before any DB write; one transaction writes user_connections, connection_secrets and
     connection_audit; if that transaction fails, revoke the grant at the provider (best effort).
  5. Refresh and renewal as http jobs on INTEGRATIONS_CRON_SECRET (constant-time bearer, 404
     otherwise). Refresh before expiry, and persist a rotated refresh token in the same transaction
     that read the old one (Graph and Zoom rotate). invalid_grant sets the connection `expired` and
     sends integration.reconnect_required. The consent sweep is a sql job.
  6. One webhook route. POST /api/integrations/webhooks/[provider] verifies the provider's
     signature before anything else, then dispatches: presence goes to
     SessionBackendService.handlePresenceWebhook, calendar pushes to CalendarSyncBackendService (an
     acknowledged no-op until SCH-WP4b). The delivery is claimed in integrations.webhook_deliveries
     (provider_slug, external_delivery_id) inside the same SQL call as its effect: the effect's
     definer takes the delivery id, as finance.fn_claim_stripe_event does for Stripe. A replay is a
     2xx no-op. The old presence path re-exports the same handler until the Zoom app's Event
     Subscription is re-pointed (an ops step; ROUTING.md says so).
  7. Docs: SA §3.3 and §Edge Functions & Webhooks describe the runtime the code runs (#343 (b)).
     Every claim that the token vault is KMS-backed (SA §3.2, the token-vault section, the env
     contract) becomes the ENCRYPTION_KEY envelope (#343 C4 (c)). Rewrite providers spec §9.4 to it
     (no KMS_PROVIDER). §7.7's "Gate on, no KMS" row becomes "no ENCRYPTION_KEY". Mark §7.6's
     Proposed jobs built. Replace token-vault.ts's ⚠️ #59 header with a two-line note citing #343 C4
     (c).

SAME CHANGE:
  - Migrations edited in place (root §1).
  - Zod (packages/types/integrations) with documentation/database/integrations/*.
  - SYSTEM_ARCHITECTURE, the binding technical doc, in the same change as the runtime.
  - .env.example and the env contract together (root §6).
  - PRODUCT_MANAGEMENT §3.5: the Integration connection row names the refresh job as the writer of
    `expired`.
  - ROUTING.md: a row for every new route.
  - No Dev Context Switcher axis here: SCH-WP4b adds the connection axis with the UI that reads it.

VERIFY (SQL):
  - Run `deno task test:probes` while iterating (add a probe's name to run just that one).
  - One local database: at most 2 SQL sessions at once, on disjoint migration files. Announce every
    `deno task db:reset` to the other sessions before you run it.
  - Finish with your own clean `deno task test:probes:fresh`, with no other reset during it.

ACCEPTANCE:
  - token-vault.test.ts: a round trip; a wrong key_id refuses; one flipped ciphertext byte fails
    the tag; two seals of one plaintext differ (a fresh DEK and nonces). A probe shows
    ck_secret_nonces refusing a cipher without its nonce.
  - With INTEGRATIONS_BACKEND_LIVE=true, a local Google or Zoom test client connects end to end
    (providers spec §7.7, local consent), and the secrets row holds no plaintext.
  - The webhook route: a bad signature → 401 and no delivery row; the same delivery twice → one
    row and one effect; the Zoom presence fixture still records presence through both paths.
  - The cron routes: a wrong bearer → 404.
  - The storage adapters' tests (adapters.test.ts, sigv4.test.ts) still pass.
```

### SCH-WP4b — Rooms on the host's account, and inbound calendar sync

```text
PROMPT SCH-WP4b: Choosing a provider location creates the meeting, and a connected calendar blocks
time

ROLE: Integrations engineer. Audit S-03 (its rooms half), S-19; providers spec §7.2-§7.5. Depends on
SCH-WP4a.

CONTEXT:
  - The owner's directive with ruling C4 (Decision #343): choosing a provider location such as Zoom
    creates the meeting on that provider automatically when the session or call is created. The join
    link appears for both the freelancer and the client, and nobody makes a link by hand. The
    meeting is made on the host's connected account, per registrant where the provider supports it
    (SCH-WP5). With no account connected, the picker offers Connect, or the platform room (the 🧑
    below).
  - Nothing mints a room today (S-03). fn_book_session_slot inserts sittings without room fields; no
    code writes session_events.provider_meeting_id or discovery_calls.meeting_url; and the
    link_generated audit action can never fire. So every presence delivery is unmatched and every
    sitting untracked.
  - Calendar sync has only its consent framework (S-19). There is no adapter, and nothing writes
    events.source_connection_id, so external busy time blocks nothing.
  - Rooms must be minted in the app, because minting needs OAuth tokens. 1-1 sittings are created
    inside SQL (place_wallet_order → fn_book_session_slot, also on the card webhook path), so
    minting is asynchronous: a claim-and-mint job, plus an immediate attempt after a door returns.

🧑 DECISION 1 — calendar strategy. STOP before writing a calendar adapter. Decision #335 flag (a)
was logged and never put to the owner: the provider seed (00005050, broker = 'nylas' for google /
outlook / apple) and SA §3.2 say a Nylas broker, while the providers spec (§7.2) recommends direct.
  Option A (recommended): direct Google Calendar / Meet, Microsoft Graph and Zoom for the MVP
  (read-only free/busy and room creation), and revisit Nylas at bidirectional sync. Edit the seed's
  broker values in place and SA §3.2's strategy bullet.
  Option B: Nylas for calendars, as seeded. It costs per connected account, and a third party then
  holds every calendar token.

🧑 DECISION 2 — "the platform's own room" (PRODUCT_SPEC.md:93) is defined nowhere: no provider, no
sub-processor, no cost. STOP before building a fallback room.
  Option A (recommended for the MVP): no platform room. With no connected account, the picker offers
  Connect, or a manual https link (the fallback PRODUCT_SPEC §Discovery already promises). A
  manual-link sitting is untracked, so ruling C5 (a) holds it for review (SCH-WP8).
  Option B: a platform-owned Zoom account (server-to-server OAuth). A licensed host runs one meeting
  at a time, so concurrency costs licences.
  Option C: a video API (Daily, LiveKit or similar) as a new sub-processor, with per-participant
  tokens (the strongest presence evidence) at a per-minute cost.
  Rewrite PRODUCT_SPEC:93 to the answer in this change.

FILES:
  - packages/backend/services/integrations/RoomBackendService.ts (new, + test);
    CalendarSyncBackendService.ts (new, + test); adapters for the providers 🧑 1 chose
  - supabase/migrations/00001155_functions_projects_sessions.sql (fn_book_session_slot and
    schedule_sitting copy the listing's meeting_provider, or the seller's connected default
    (integrations.fn_conferencing_provider), onto each sitting; projects.attach_sitting_room, a
    service-role door)
  - supabase/migrations/00001510_functions_scheduling.sql (scheduling.attach_call_room; the claim of
    sittings and calls still to mint, SKIP LOCKED)
  - supabase/migrations/00001500_functions_integrations.sql (the sync upsert into scheduling.events,
    keyed on the re-sync key 00000022 already has)
  - supabase/migrations/00005050_seed_reference_data.sql (broker values, per 🧑 1)
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (integrations-mint-rooms; a sync job if a
    provider needs polling); 00002510 (grants)
  - apps/web/routes/api/integrations/cron/{rooms,sync}.ts (new)
  - the location pickers: features/profile (the call platforms) and the session listing editor. Not
    the calendar's event composer: its entries stay session-local until an event write door exists
    (SCH-WP10's 🧑), so rooms here are for sittings and calls only
  - apps/web/features/devtools/*, apps/web/utils/dev-seam.ts (the conferencingConnection axis)
  - documentation/database/{projects,scheduling,integrations}/*; SYSTEM_ARCHITECTURE.md §Integration
    Blueprints 2 and §3.2; business/PRODUCT_SPEC.md (:90-94, and §Discovery's manual-link
    sentence); the providers spec §7.2-§7.5

STEPS:
  1. Reproduce: a seeded 1-1 booking's sittings have meeting_provider and provider_meeting_id NULL.
     Write the probe so it asserts the copy and the attach door after the fix.
  2. A sitting carries the provider its listing chose (00000014's meeting_provider) or the seller's
     connected default; a call carries its provider_slug. 'custom' means a manual link.
  3. RoomBackendService.mintDue(limit) claims sittings and confirmed calls that have a provider and
     no room. It creates the meeting on the HOST's connected account: Zoom POST /users/me/meetings;
     Meet through events.insert with conferenceData (requestId = the sitting or call id, so a retry
     is idempotent); Teams through Graph. It writes the URL, the passcode and the provider meeting
     id through attach_sitting_room / attach_call_room (service role; link_generated fires). A
     failure retries on the next run up to a capped count, then writes an ops row and tells the host
     ("connect again" or "add a link"). Both parties read the link only through get_event_rooms,
     session_join_link and the call's room read: nothing new becomes client-readable.
  4. A cancelled or moved sitting or call updates or deletes its provider meeting (best effort,
     logged).
  5. CalendarSyncBackendService (per 🧑 1): Google events.watch with a syncToken, Graph
     subscriptions with delta, written into scheduling.events as busy blocks (source_connection_id,
     external_event_id, mask_external_events honoured). Inbound only (SA §3.2: "MVP is read-only").
     Pushes arrive on SCH-WP4a's webhook route, and renewal is SCH-WP4a's job.
  6. Pickers offer a provider only when the host holds an active connection that granted
     conferencing. Otherwise they offer Connect (the existing ConnectCalendarDialog) or the fallback
     🧑 2 chose.
  7. Dev Context Switcher: conferencingConnection (auto · none · connected · expired), read by the
     pickers and by the reconnect notice.

SAME CHANGE:
  - Migrations edited in place (root §1).
  - Zod with documentation/database/*.
  - PRODUCT_SPEC :90-94 keeps "Not built yet" only for the per-registrant clause (SCH-WP5 removes
    it), and :93 says what 🧑 2 decided.
  - SA §Integration Blueprints 2: Room Generation names RoomBackendService; §3.2's strategy bullet
    follows 🧑 1.
  - ROUTING.md: the new cron rows.
  - The conferencingConnection Dev Context Switcher axis.
  - DESIGN_SYSTEM §C.1 if a packages/ui component changes.

VERIFY (SQL):
  - Run `deno task test:probes` while iterating (add a probe's name to run just that one).
  - One local database: at most 2 SQL sessions at once, on disjoint migration files. Announce every
    `deno task db:reset` to the other sessions before you run it.
  - Finish with your own clean `deno task test:probes:fresh`, with no other reset during it.

ACCEPTANCE:
  - A probe (ROLLBACK): a booking's sittings carry the listing's provider; attach_sitting_room is
    service-role only, and a second attach is a no-op; a client still cannot read a meeting URL.
  - RoomBackendService.test.ts, on recorded provider responses: one meeting per sitting across
    retries (the request id); a 401 that a token refresh cannot cure marks the connection expired
    and tells the host.
  - With a local Zoom or Google test client: book a seeded session, and within one job run both the
    provider and the client see a join link on /calendar (screenshots of both views at 1440 and
    390).
  - A busy event on a connected Google test calendar blocks the slot in get_free_busy and in both
    booking gates.
```

### SCH-WP5 — Presence matched by each person's own link

```text
PROMPT SCH-WP5: Presence is matched by each person's own join link, and calls get a Digital
Handshake

ROLE: Postgres + integrations engineer. Audit S-03 (its presence half), S-04, S-24; SDG §3.2 (D4).
Depends on SCH-WP4b.

CONTEXT:
  - Rulings (Decision #343, ruling C4): (b) per-registrant join links minted by the platform, with
    email matching only as a flagged fallback; (d) the Zoom seed becomes supports_webhooks = true
    (00005050:131-133), which resolves #343 (d).
  - record_presence (00001155:1197-1277) matches a participant by the email the provider reports
    (:1228). A different Zoom email is unmatched, and a guest who types someone else's email asserts
    their presence falsely (S-04). scheduling.call_attendance has no writer (S-03), so a discovery
    call has no Digital Handshake.
  - session_attendance.source is 'webhook' or 'host' (00000015:938). The dispute audit counts only
    'webhook' rows towards a dismissal (00001260:139-141, :174, :182).
  - Zoom registration needs a registration-enabled meeting, which Zoom allows only on a licensed
    host (verify in Zoom's docs). Meet and Teams have no per-registrant links. "Per registrant where
    the provider supports it" therefore means Zoom on a licensed host, and the email fallback
    elsewhere. Meet and Teams presence stays out of scope (S-24 follow-up).

FILES:
  - supabase/migrations/00000022_tables_scheduling.sql (scheduling.room_registrants: a sitting OR a
    call, user_id, provider_slug, registrant_id, join_url; UNIQUE (provider_slug, registrant_id)
    and one row per person per room; RLS on, no client grant)
  - supabase/migrations/00000015_tables_projects.sql (ck_session_attendance_source gains
    'webhook_email', in place)
  - supabase/migrations/00001155_functions_projects_sessions.sql (record_presence matches the
    registrant first; session_join_link returns the caller's own registrant link when one exists)
  - supabase/migrations/00001510_functions_scheduling.sql (scheduling.record_call_presence, the
    call twin; the call's room read returns the caller's own link)
  - supabase/migrations/00005050_seed_reference_data.sql (Zoom supports_webhooks = true)
  - supabase/migrations/00002001_policies_enable_rls.sql, 00002510 and 00002520 (the new table:
    service-role writes, nobody reads it)
  - packages/backend/services/integrations/RoomBackendService.ts (registers each seat-holder, or the
    requester, when the meeting allows it); packages/backend/services/sessions/presence/{zoom,
    adapter}.ts (carry the payload's registrant id)
  - supabase/probes/presence_registrants.sql (new)
  - documentation/database/{projects,scheduling}/*; business/PRODUCT_SPEC.md (:90-94, :110-114); the
    providers spec §3.4 (a registrant's name and email go to the HOST's provider account) and §7.5

STEPS:
  1. Reproduce: a Zoom participant_joined that carries the attendee's email but is sent by somebody
     else records the attendee as present. Write the probe so it asserts the fallback flag after the
     fix.
  2. When a room is minted (and whenever a seat is taken or a call confirmed later),
     RoomBackendService registers each attendee and stores their registrant id and personal join
     URL. The host joins through the host link. Where registration is unavailable, nobody is
     registered and the room's own link is used.
  3. record_presence(…, p_registrant_id text DEFAULT NULL) matches on (provider, registrant id)
     first, as source 'webhook'; otherwise on the email, as source 'webhook_email'. It never matches
     by email a person who holds a registrant link on that room: that join is 'unmatched', because
     the real person would use their own link. Idempotency and the ±60-minute window are unchanged.
     fn_session_presence treats both sources as tracked and reports which evidence it saw. The
     dispute audit keeps counting only 'webhook' rows, so an email-only match is ambiguous there
     (PRODUCT_SPEC:3007).
  4. record_call_presence writes scheduling.call_attendance the same way, matched on the call's
     room. SCH-WP3's no-show door then has evidence to check.
  5. The Zoom seed row: supports_webhooks = true.

SAME CHANGE:
  - Migrations edited in place (root §1).
  - Zod (the attendance source; the registrant row, if a reader types it) with
    documentation/database/*.
  - PRODUCT_SPEC :90-94: remove the last marker. :110-114 keeps "Not built yet" only for the C5 (c)
    clause, which SCH-WP8 builds.
  - The providers spec §3.4 sub-processor register.
  - No Dev Context Switcher axis: evidence is server-side and SCH-WP8 adds the state that shows it.

VERIFY (SQL):
  - Run `deno task test:probes` while iterating (add a probe's name to run just that one).
  - One local database: at most 2 SQL sessions at once, on disjoint migration files. Announce every
    `deno task db:reset` to the other sessions before you run it.
  - Finish with your own clean `deno task test:probes:fresh`, with no other reset during it.

ACCEPTANCE:
  - presence_registrants.sql (ROLLBACK): a registrant-matched join → 'webhook'; an email-only join
    for a person with no registrant link → 'webhook_email'; an email-only join for a person who has
    one → 'unmatched'; a replay → 'replayed'; call presence lands in call_attendance; a dispute with
    only email evidence audits 'ambiguous'.
  - session_settlement.sql and dispute_resolution.sql still pass.
  - With a local Zoom test app on a licensed account, two people join a test sitting from their own
    links and both rows record 'webhook'.
```

---

## 5. Phase 4 — Money rules

### SCH-WP8 — No evidence, no automatic release

```text
PROMPT SCH-WP8: A sitting with no evidence is held, and the attendance audit applies the spec's
thresholds

ROLE: Ledger + Postgres engineer. Audit S-08, S-09, S-21; Decisions #211, #212. Depends on SCH-WP5.

CONTEXT:
  - Rulings (Decision #343, ruling C5): (a) a sitting with no presence data is held for review, not
    released on negative consent; (b) a dispute is dismissed only when both people were in the room
    for MORE than 80 % of it, as PRODUCT_SPEC says; (c) a missing "left" event no longer counts as
    presence.
  - The sweep releases every session escrow session_payout_hours after its sitting, whatever the
    presence (finance.auto_release_session_escrow, 00001155:1794-1905; branches (c1) :1846-1858 and
    (c2) :1867-1880). So untracked and attendee_no_show sittings pay out (S-08).
  - fn_session_presence (00001155:1288-1345): in a tracked room, a host who never joined plus an
    attendee who joined after minute 15 fall to the final ELSE (:1341) as 'untracked', not
    'provider_no_show' (S-08).
  - fn_dispute_attendance_audit (00001260:143-206) dismisses at `>=` (:196), and COALESCE(left_at,
    end_time) (:170, :178) counts an open span to the end of the sitting (S-21).
  - S-09: cancelling a block leaves its started sittings' escrows held but sets the membership
    cancelled. The claim (:1434), presence (:1236, :1321, :1325) and join-link (:1504, :1518)
    predicates key on the membership, so those sittings lose their no-show protection and then
    release.

🧑 DECISION — STOP before changing the release routing. Ruling C5 (a) says "held for review". It
does not say who releases a held sitting, or whether a host attestation (record_host_attendance,
source 'host') is presence data. Put this to me:
  Option A (recommended): when the review window ends, the attendee is asked "Did this session
  happen?". A yes releases at once. A no is a no-show claim, the existing dispute (Decision #212).
  Silence for session_review_hold_days (a new param, 7) opens an operator case on the dispute desk.
  A host attestation alone is not evidence; the audit already treats it as the payee's own word.
  Option B: every untracked sitting goes straight to the operator desk at T + 24 h.
  Option C: a host attestation counts as data, and only a sitting with no rows at all is held (with
  A's mechanism).
  A and B both need the dispute desk to accept a case with no human claimant
  (finance.disputes.opened_by_profile is NOT NULL, 00000017:201). Ask that too: a system-opened case
  with a nullable opener (in place, with Zod and docs), or the attendee as the nominal claimant.

FILES (after the ruling):
  - supabase/migrations/00001155_functions_projects_sessions.sql (auto_release_session_escrow;
    fn_session_presence's ELSE; the S-09 predicates; the confirm door, under Option A)
  - supabase/migrations/00001260_functions_finance_disputes.sql (fn_dispute_attendance_audit, its
    comments at :10-11 and :136-141; a system-opened case, if chosen)
  - supabase/migrations/00000017_tables_finance.sql (only if the ruling needs a nullable opener)
  - supabase/migrations/00005001_seed_platform_params.sql (session_review_hold_days, under Option
    A); 00005010 (the confirm prompt's notification row); 00002510 (grants)
  - packages/types/projects/sessions.ts (the presence outcome and the held state the workspace
    reads); packages/backend/services/sessions/{SessionBackendService.ts, workspace-model.ts}; the
    session sidebar that shows a held sitting (and the confirm prompt, under Option A)
  - apps/web/features/devtools/*, apps/web/utils/dev-seam.ts (DevSessionState gains held_for_review)
  - supabase/probes/session_settlement_edges.sql (new)
  - documentation/database/{projects,finance}/Functions.md; business/PRODUCT_SPEC.md (:110-118,
    :3004-3008); business/finance-model.md §4 (:185-188); PRODUCT_MANAGEMENT.md §3.5 (the Session
    escrow row) and the dispute thresholds paragraph (:638-641)

STEPS:
  1. Reproduce each case: an untracked ended sitting releases at +24 h; a tracked room with an
     absent host and a late attendee reads 'untracked'; exactly 80 % presence dismisses a claim; an
     attendee with no 'left' row counts to the end; a cancelled block's started sitting cannot be
     claimed.
  2. fn_session_presence: in a tracked room where the host was not present inside the window, the
     outcome is 'provider_no_show' (the ELSE branch), so the existing refund branch catches it.
  3. The audit dismisses only when both are STRICTLY above dispute_dismiss_presence_pct. A row with
     no left_at adds no time towards a dismissal; the 15-minute rule is unaffected. Fix the two
     comments to match.
  4. S-09: every predicate that asks whether a person may claim, be present or join for a sitting
     asks whether THAT sitting's escrow (or the seat's) is still held for them, not whether the
     membership is active. A cancelled membership with nothing held still loses access.
  5. The hold, per the ruling: the sweep's release branches skip a sitting whose presence outcome is
     'untracked' (and any outcome the ruling adds), and the ruled mechanism resolves it. No bespoke
     status: a held sitting is an escrow still `held`, plus the presence outcome the read derives.
  6. Dev Context Switcher: DevSessionState gains held_for_review, and the sidebar says why the
     payout is waiting. The "review window" wording arrives with SCH-WP7.

SAME CHANGE:
  - Migrations edited in place (root §1).
  - Zod (packages/types/projects/sessions.ts) with documentation/database/*.
  - PRODUCT_SPEC: remove the markers at :117-118 and :3006, and :110-114's remaining one.
  - finance-model §4 :187-188.
  - PRODUCT_MANAGEMENT §3.5 (a lifecycle change: the Session escrow row) and :638-641.
  - The held_for_review Dev Context Switcher value.

VERIFY (SQL):
  - Run `deno task test:probes` while iterating (add a probe's name to run just that one).
  - One local database: at most 2 SQL sessions at once, on disjoint migration files. Announce every
    `deno task db:reset` to the other sessions before you run it.
  - Finish with your own clean `deno task test:probes:fresh`, with no other reset during it.

ACCEPTANCE:
  - session_settlement_edges.sql (ROLLBACK) asserts every case of step 1 the other way round. Also:
    a tracked successful sitting still releases at +24 h; a provider no-show still refunds at once;
    replaying the sweep moves nothing twice.
  - session_settlement.sql (its 17 checks) and dispute_resolution.sql still pass. Edit them only
    where a check encoded the old `>=` or the release of an untracked sitting, and name each such
    edit in the commit message.
```

### SCH-WP7 — Windows: the money window, the grace and the provider's move

```text
PROMPT SCH-WP7: Money-bearing events lock at the money window, a late booking gets a grace, and a
provider's move inside the window is a provider cancellation

ROLE: Postgres + TypeScript engineer (the coordination engine). Audit S-12, S-13, S-22; SDG §2;
Decisions #71 (a), #72 (b), #211 (c). Depends on SCH-WP8.

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
    (S-12). Vote settlement runs only on a read (S-13), so a deadline nobody reads moves nothing and
    tells nobody. The Wave 1.3 jobs set seeded scheduling-settle-votes (11,26,41,56 * * * *)
    dormant: it waits for a function named scheduling.fn_settle_votes, the sql job S-13
    recommends. Do NOT edit 00005060.
  - SCH-WP1 froze group sittings. schedule_sitting mirrors a group sitting with NO roster, and
    trg_sitting_round_guard (00001155:988) refuses every round on it, because a vote carried inside
    the notice would make dissenters forfeit. Nothing in the app calls schedule_sitting or
    retitle_sitting, and a seat-holder cannot see the sitting on /calendar. This prompt lifts the
    freeze: the mirror gets a voting roster, and the backstop below protects dissenters.
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
    fn_vote_deadline reads it and the parameter; SCH-WP3's call lockout uses it;
    scheduling.fn_settle_votes)
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
    change)
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
     Add a sitting and Rename. fn_sync_sitting_mirrors keeps the mirror's event_attendees equal to
     the active seat-holders (participant) plus the host, so seat-holders see the sitting on
     /calendar.
  6. After the 🧑: trg_sitting_round_guard admits a voting round on a group mirror, and a started
     cohort's dissenter gets the exit the ruling chose.
  7. Vote settlement (S-13): scheduling.fn_settle_votes(p_limit integer DEFAULT 200), a SECURITY
     DEFINER sql function, settles every `voting` round past its deadline (FOR UPDATE SKIP LOCKED).
     A slot backed by more than half of the entitled voters (every roster seat except the host's,
     optional included: the TS rule D5 ratifies) wins, and the round closes `resolved` through
     close_reschedule_round, which moves the event; otherwise it closes `lapsed`. It sends the
     round's notices. The majority rule now lives in SQL as well as in settleVote, so
     coordination.contract.test.ts runs both over the same fixtures, as it already does for
     fn_vote_deadline. The read path keeps settling too; both close under the round lock, so
     whichever runs second finds the round closed. Name it exactly: the dormant
     scheduling-settle-votes row registers on your next reset.
  8. S-22: the seat's Cancel in the session workspace states the outcome before the press: "full
     refund", "full refund: inside your hour's grace" or "the provider keeps the payment". The
     service computes it; the island never does.
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
    marker (:358); the "there is no cron in this layer" sentence now names the
    scheduling-settle-votes job.
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
  - With nobody reading it, a round past its deadline settles on the next run (`deno task cron:run
    scheduling-settle-votes`), and the SQL and TS settlements agree on every contract fixture.
  - Screenshots of the seat's Cancel in each window state, at 1440 and 390.
```

### SCH-WP6 — Paid consultations on the host's hidden Consultations engagement

```text
PROMPT SCH-WP6: A paid consultation is paid at request and held on the host's hidden Consultations
engagement

ROLE: Payments + Postgres engineer. Audit S-02; SDG §1.3-§1.4 (Option C and its exact shapes);
Decision #211. Waits on F·DB7 (Wave 0) and F·SV4 (place_wallet_order's callers, p_expected_minor,
checkout blockers); better after F's M8 prompt (refunded order lines) and F's payout gate (M4).
Depends on SCH-WP3, SCH-WP7 and SCH-WP8.

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
    insert the call with its session_event_id; adjust SDG §1.4's fn_book_consultation shape to that.

FILES:
  - supabase/migrations/00000015_tables_projects.sql (the session_kind CHECK gains 'consultation')
  - supabase/migrations/00000022_tables_scheduling.sql (discovery_calls.session_event_id and
    ck_call_paid_has_sitting, SDG §1.4)
  - supabase/migrations/00000004_enums_domains.sql (purchasable_item_kind gains 'discovery_call', in
    place, at the same position as the Zod enum)
  - supabase/migrations/00001155_functions_projects_sessions.sql (§4c:
    fn_consultation_engagement_for and fn_book_consultation; the call follows its sitting to
    completed, no_show or cancelled)
  - supabase/migrations/00001210_functions_finance_kyc_wallet.sql (place_wallet_order: the
    discovery_call line, priced from the host's call_settings NOW, against p_expected_minor, with
    the payout-ready check)
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
  2. The schema per SDG §1.4, edited in place. fn_consultation_engagement_for(p_schedule) finds or
     makes the host's ONE unlisted session engagement (session_kind 'consultation'), serialised on
     an advisory lock per schedule, exactly as fn_session_engagement_for is per listing.
  3. place_wallet_order's discovery_call line re-prices from call_settings and refuses a host who is
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
     payout-ready. The modals' paid path goes to checkout, and the booking surfaces keep gate 10 (on
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

## 6. Phase 5 — Coordination

### SCH-WP9 — One denominator, a bounded ballot, courtesy no-shows in Standing

```text
PROMPT SCH-WP9: One majority denominator, a bounded ballot, and courtesy no-shows in Standing

ROLE: TypeScript + Postgres engineer. Audit S-14, S-15, S-17; SDG §3.3, §3.5, §3.6. D7 depends on
SCH-WP3 and SCH-WP5.

CONTEXT:
  - Rulings (Decision #343, ruling C6):
    D5: the majority denominator follows the TS rule (every seat but the host's, optional seats
        included: coordination.ts:647-669). The enum comment is corrected and the workspace read
        excludes the host, which resolves #343 (a).
    D7: courtesy-call reliability feeds Standing at low weight, only from presence-verified
        no-shows, at most one mark per counterparty per 30 days.
    D8: at most 3 unapproved attendee slots per round (the host's are outside the cap); a
        replacement keeps the original duration; a 24 h span backstop.
  - The three denominators: TS (coordination.ts:651); the attendee_role enum comment
    (00000004_enums_domains.sql:507-508); get_session_workspace (00001155:1763, role <> 'optional',
    which counts the host).
  - The ballot holds 12 slots (fn_cap_reschedule_proposals, 00001510:426) and one attendee can fill
    all of them; ck_proposal_span (00000022:259) has no maximum (S-15).
  - Standing (org.fn_recompute_standing, 00001030:44) subtracts active security.penalties severity.
    security.penalties (00000012:87) already allows penalty_type 'trust_score' and source_type
    'no_show', with an expires_at.

🧑 DECISION — STOP before writing D7's penalty. "Low weight" has no number. Put this to me:
  Recommended: each presence-verified courtesy no-show writes one security.penalties row
  (trust_score / no_show / source_id = the call) of severity call_no_show_penalty_points = 2,
  lapsing after call_no_show_penalty_days = 90. Both are platform params, recorded as dials in
  finance-model.md §16.3.
  D5 and D8 do not wait for this.

FILES:
  - supabase/migrations/00000004_enums_domains.sql (the attendee_role comment)
  - supabase/migrations/00001155_functions_projects_sessions.sql (get_session_workspace :1763)
  - packages/types/scheduling/coordination.ts (RESCHEDULE_ATTENDEE_PROPOSALS_MAX = 3; the planner
    refusals proposer_quota and duration_changed), with coordination.test.ts and
    coordination.contract.test.ts
  - supabase/migrations/00001510_functions_scheduling.sql (fn_cap_reschedule_proposals counts an
    attendee's unapproved slots and refuses a slot whose length is not the event's; D7's writer in
    mark_call_no_show)
  - supabase/migrations/00000022_tables_scheduling.sql (ck_proposal_span: ends_at > starts_at AND
    ends_at − starts_at ≤ 24 h)
  - supabase/migrations/00005001_seed_platform_params.sql (D7's two dials); 00002510
  - packages/backend/services/scheduling/coordination-plan.ts; the reschedule tab's refusal copy
    (apps/web/features/calendar/components/tabs/EventRescheduleTab.tsx)
  - supabase/probes/coordination_rules.sql (new)
  - documentation/database/scheduling/{Functions,Tables}.md (§9; Tables.md :316);
    business/PRODUCT_SPEC.md (:98-100, :2000-2003); PRODUCT_MANAGEMENT.md §3.5 (the caps paragraph);
    business/finance-model.md §16.3 (D7's dials)

STEPS:
  1. Reproduce: a workspace with a host, two participants and one optional seat reports a
     denominator of 3 (the host counted, the optional seat not); one attendee files 12 slots; a
     3-day slot can be stored.
  2. D5: get_session_workspace counts role <> 'host', and the enum comment says optional attendees
     count. A contract test pins the SQL count to voteQuorum's input.
  3. D8: the planner refuses a fourth unapproved slot from the same attendee (proposer_quota) and a
     slot whose length differs from the event's (duration_changed). fn_cap_reschedule_proposals
     enforces both under the round lock it already takes, and ck_proposal_span gains the 24 h
     ceiling. The constants and their trigger twins are pinned.
  4. D7, after the 🧑: when a courtesy call's no-show is presence-verified (SCH-WP5's
     call_attendance shows the marked party absent and the marker present), mark_call_no_show
     writes the penalty and Standing is recomputed. At most one mark per (marker, marked) pair per
     30 days; never from a self-reported mark; never for a paid call, where money already answers
     it.

SAME CHANGE:
  - Migrations edited in place (root §1).
  - Zod (the refusal vocabulary) with documentation/database/*.
  - PRODUCT_SPEC: remove the markers at :98-100 and :2003.
  - PRODUCT_MANAGEMENT §3.5: the caps paragraph now names five caps.
  - finance-model §16.3: D7's dials; Tables.md :316.
  - No new Dev Context Switcher axis: these are refusals, not states.

VERIFY (SQL):
  - Run `deno task test:probes` while iterating (add a probe's name to run just that one).
  - One local database: at most 2 SQL sessions at once, on disjoint migration files. Announce every
    `deno task db:reset` to the other sessions before you run it.
  - Finish with your own clean `deno task test:probes:fresh`, with no other reset during it.

ACCEPTANCE:
  - coordination_rules.sql (ROLLBACK): the workspace denominator equals the TS one; a fourth
    unapproved attendee slot is refused while a host slot still lands; a longer replacement is
    refused; a 25 h slot → 23514; a verified courtesy no-show writes one penalty, a second one by
    the same pair within 30 days writes none, a self-reported one writes none, and Standing's
    components show the penalty.
  - coordination.test.ts and coordination.contract.test.ts pass.
```

---

## 7. Phase 6 — Calendar UI

### SCH-WP10 — Authoring hidden, Month as built, view state in the URL

```text
PROMPT SCH-WP10: The calendar shows only what it can save, documents Month as built, and keeps its
view in the URL

ROLE: Frontend engineer (Preact islands, @projective/ui/calendar, Fresh SSR). Audit S-25, S-28,
S-29, S-31, S-33, S-38, S-39, S-40; DESIGN_SYSTEM gates 8, 10, 11.

CONTEXT:
  - Rulings: (a) until an event write door exists, the calendar's authoring controls are hidden,
    not labelled "preview only"; (b) Month scrolls continuously, as built, and DESIGN_SYSTEM is
    corrected to match, which resolves #343 (e) (Decision #343, ruling C7). The calendar's state is
    addressable as ?view=&date=&zoom=&kind= (Decision #338, ruling P7; S-31).
  - Every create, drag-move, delete and .ics import is session-local and still toasts success
    (useCalendarComposer.ts:59, calendar-state.ts:500-509, CalendarImportPopover.tsx) (S-25). The
    Week keyboard create is a no-op (onSelectRange={() => {}} in CalendarWorkspace :335,
    ProjectCalendar :152 and ScheduleView :153) (S-28). A visitor gets a composer on someone else's
    schedule (S-33).
  - DESIGN_SYSTEM.md:2929-2933 says Month paginates, while month-window.ts and the §C.1 roster
    (:2482) scroll continuously; TimelineView is missing from §C.1 (S-38).
  - The calendar reads now−60 d → now+180 d (personal) and −14 → +90 d (public) under an axis of
    ±1,000 weeks, so later weeks read as free (S-29). A ?date= past the window makes that worse.
  - EventPopoverActions has no caller, and four comments cite a scheduling env gate that does not
    exist (S-39).
  - The schedule leaf (features/calendar/routes/entity-schedule.tsx) mounts no conversion lane
    (S-40; DESIGN_SYSTEM.md:1497-1498 and #157 (q), whose (f) was resolved by #183). Since S-26 the
    listing schedule books nothing (viewerCanBook false), so the leaf has no purchase path at all.
  - The SCH-WP12 sweep missed one gate-8 residue: .evm-rich h1-h3 at --fw-bold
    (event-modal.css:633). Otherwise SCH-WP12 is done (thin controllers, the ROUTING API section,
    tokens, motion, contrast).

🧑 DECISION — STOP before hiding anything. An event write door exists, unmerged:
refs/heads/claude/dreamy-hamilton-026625 (a80ce2f5, Decision #328 (a): POST / PATCH / DELETE
/api/scheduling/events, live-entries.ts, scheduling.events.archived_at, a host's own /calendar
entries) and refs/heads/claude/modest-mendel-ae6318 (d3768133, the agenda persisted through a
shared sanitiser; 83cb1720, tickets). Both were verified on 2026-10-25, before Wave 0 moved the
calendar routes. Put this to me:
  Option A (recommended): merge both first (I merge them; you resolve the conflicts with SCH-WP12's
  route moves). C7 (a) then hides only what the door does not cover: the project calendars'
  composer, .ics import, a visitor's composer, and moving or deleting a rostered event outside its
  negotiation.
  Option B: do not merge, and hide every authoring control on every calendar.

FILES:
  - apps/web/features/calendar/{islands,components,hooks,core}/* (CalendarWorkspace,
    ProjectCalendar, ScheduleView, EventModal, CalendarImportPopover, useCalendarComposer,
    calendar-state.ts, ScheduleService.ts, EventPopoverActions.tsx); styles/event-modal.css
  - apps/web/features/calendar/routes/{calendar,project-calendar,availability,entity-schedule}.tsx
    (parse ?view=&date=&zoom=&kind= with Zod; 303 an invalid value to the canonical URL)
  - packages/backend/services/scheduling/{live-calendar.ts, live-schedule-page.ts,
    ScheduleBackendService.ts} (the read window follows the requested range)
  - packages/ui/calendar/* only if the engine needs a "not loaded" state (then the §C.1 roster)
  - apps/web/features/view/* (the leaf's lane, per DESIGN_SYSTEM §D.7)
  - documentation/design-system/DESIGN_SYSTEM.md (:2929-2933; §C.1 TimelineView; :1497-1498);
    documentation/architecture/ROUTING.md (the four calendar rows)

STEPS:
  1. Reproduce: create an event on /calendar and reload; it is gone (or, after Option A, it persists
     only for a host's own entry). Open ?date=2027-09-01; the weeks read as free.
  2. C7 (a): an authoring control that the merged door (or no door) does not back is not rendered.
     It is never disabled with a tooltip and never "preview only" (gate 11): the composer,
     drag-move, delete, .ics import, the keyboard and touch create (S-28) and a visitor's composer
     (S-33). RSVP, reschedule and SCH-WP3's call actions stay.
  3. P7 / S-31: the SSR controllers read the four params. The island seeds its signals from them and
     writes them back with history.replaceState. localStorage stays a per-viewer default, used only
     when the URL has none. ROUTING.md documents each value set: view = day · week · month ·
     timeline (CalendarViewMode); date = an ISO day; zoom = year · quarter · month · week · day
     (ZoomStop); kind = the CalendarEventKind filter.
  4. S-29: the reads take the range around ?date= and refetch as the viewport moves past it.
     Outside the loaded range the grid says "Not loaded" instead of showing free time.
  5. S-39: mount EventPopoverActions on events the viewer attends (recommended: until sync reaches
     them, it is an attendee's only route into an external calendar), or delete it. Correct the
     four comments either way.
  6. S-40: the schedule leaf mounts the listing's conversion lane (the .evp-frame END column,
     DESIGN_SYSTEM §D.7), so its purchase lives where the listing's does. Update
     DESIGN_SYSTEM:1497-1498 to say so.
  7. C7 (b) / S-38: DESIGN_SYSTEM's Month paragraph describes the continuous column of weeks
     (month-window.ts, MonthGrid's OVERSCAN), and §C.1 gains TimelineView.
  8. The .evm-rich headings drop to --fw-semibold (gate 8). Check event-modal.css :127 and :333
     against the spacing and border tokens.

SAME CHANGE:
  - DESIGN_SYSTEM.md (the §B Month prose and the §C.1 roster) and ROUTING.md in the same change as
    the code.
  - PRODUCT_SPEC only if a calendar promise changes.
  - No new Dev Context Switcher axis: URL state is addressable, not simulated.

VERIFY (app):
  - `deno task check`, `deno task lint` and `deno task test:unit`, with a unit test for the URL
    parse (every param; an invalid value → the canonical URL).
  - `deno task dev`, signed in as the seeded personas.

ACCEPTANCE:
  - No calendar renders a control that writes nothing: a unit test over the toolbar and modal
    models lists every rendered action and its handler.
  - /calendar?view=month&date=2027-09-01 renders September 2027 on first paint (SSR) and survives a
    reload; changing the view updates the URL without adding a history entry.
  - The schedule leaf shows the listing's lane at 1440 and its body block at 390 (gate 10).
  - Screenshots at 1440, 900 and 390 px in light, dark, data-contrast="high" and
    data-motion="reduced".
```

---

## 8. Last — Docs

### SCH-Z1 — Scheduling docs sweep and audit status

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
  - architecture/SCHEDULING_COMPLETENESS_AUDIT.md (a Status column on §10: Fixed by <prompt> /
    Open); SCHEDULING_DECISIONS_AND_GAPS.md (the §0 status line)
  - the decision rows #343 and #59: each ruling marked built by its prompt; #59's flag resolved by
    #343 ruling C4 (c)

STEPS:
  1. Rollup, not restatement (documentation/CLAUDE.md rule 2): each satellite links to the SSOT
     line a prompt wrote, rather than repeating it.
  2. Every "Not built yet (Decision #343, ruling …)" marker is gone where its prompt merged, and is
     still accurate where it did not.
  3. SCHEDULING_COMPLETENESS_AUDIT.md's line 1 is S-32's fix sentence ("**Fixed 2026-10-30.** Both
     routes, …"), which overwrote the title in 942c8dde. Restore the title "# Scheduling, Calendar
     & Sessions — Completeness Audit (2026-10-29)" (as in 660c9658), and put the sentence in S-32's
     Fix / ruling cell.
  4. finance-model.md §4 (:182) says a freelancer cancel refunds "all remaining sessions". Align it
     with PRODUCT_SPEC (:130, :352) and Decision #171 (D): a full refund at any time, which on a
     1-1 block means every sitting not yet started.
  5. Every 🧑 in this file's §0.3 ends Resolved (with its ruling) or Open with an owner. A new
     contradiction a prompt found is logged per root §8; re-read the decision index seconds before
     writing the row.

ACCEPTANCE:
  - grep -rn "Not built yet" documentation | grep "#343" lists only work that has not merged.
  - Every function, trigger, job and route named in SCH-WP2 to SCH-WP10 appears in
    documentation/database/* or ROUTING.md.
  - The audit's Status column has no blank cells.
```
