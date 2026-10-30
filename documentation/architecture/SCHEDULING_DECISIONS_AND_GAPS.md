# Scheduling, Calendar & Sessions — Decisions and Gaps (2026-10-29)

> **Evaluation, not binding.** This is the decision half of the scheduling audit. The evidence lives
> in [`SCHEDULING_COMPLETENESS_AUDIT.md`](SCHEDULING_COMPLETENESS_AUDIT.md). Finding IDs (`S-nn`)
> point there and are not restated here (`documentation/CLAUDE.md` rule 2). No code, migration or
> source-of-truth document was changed. Every ruling below waits for a human. The contradictions it
> found are proposed as **Decision #335** (§5). The number was the next free one in
> `reference/decisions/README.md` on 2026-10-29; re-check it before logging.
>
> Abbreviations: **T22** = `supabase/migrations/00000022_tables_scheduling.sql` · **T17** =
> `…/00000017_tables_finance.sql` · **F1155** = `…/00001155_functions_projects_sessions.sql` ·
> **F1510** = `…/00001510_functions_scheduling.sql` · **F1520** =
> `…/00001520_functions_scheduling_free_busy.sql` · **G2520** =
> `…/00002520_permissions_table_grants.sql` · **coord.ts** =
> `packages/types/scheduling/coordination.ts` · **SA** = `SYSTEM_ARCHITECTURE.md` · **PM** =
> `PRODUCT_MANAGEMENT.md`.

## 0. The rulings needed, in order of urgency

> **Status 2026-10-30:** D0, S-26 and S-30 were fixed on 2026-10-29. D0 also covers `cohorts` and
> `cohort_memberships`. On 2026-10-30 D0's two owner doors landed (`schedule_sitting`,
> `retitle_sitting`), with S-05's calendar mirror. Until D2 is ruled, no vote can move a group
> sitting. S-06, S-07, S-16 (for `anon`) and S-32 are also fixed. D1–D9 still wait for a ruling.

| #      | Decision                                                              | Recommendation                                                                                                                                          | Why now                                                                                                                                                       |
| :----- | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D0** | Who may write a session sitting's time and status                     | **Nobody directly.** Revoke client writes on `projects.session_events`, as was already done for attendance, and add the doors the owner actually needs. | **P0 (S-01).** A provider can mark a future sitting `completed` with a past `end_time`. The 15-minute sweep then releases the buyer's escrow to the provider. |
| **D1** | The money path for a paid 1-on-1 discovery call                       | **Option C**: ride Decision #211's session rail through one hidden _Consultations_ engagement per host. **Turn the paid flavour off until then.**       | **P0 (S-02).** Paid consultations can be booked today with no payment. Unpaid requests also have no cap and no expiry.                                        |
| **D2** | The 24h cancellation window versus the 12h reschedule lockout         | Money-bearing events lock at the money window: **24h for both the lockout and the vote lead**. Add a "born inside the window" grace.                    | It has been open since Decisions #71, #72 and #211(c). D1 extends it to paid calls.                                                                           |
| D3     | Who may move a discovery call, and when                               | The transition-door matrix in §3.1                                                                                                                      | Today the host cannot even decline (S-10).                                                                                                                    |
| D4     | How presence identifies a person                                      | Per-registrant join links minted by the platform, not email matching                                                                                    | Without it the Digital Handshake never matches (S-03).                                                                                                        |
| D5     | The majority denominator                                              | Count optional attendees, as the TS does, and fix the other two places                                                                                  | There are three definitions in the code (S-14).                                                                                                               |
| D6     | Edge Functions or Fresh routes plus pg_cron for sync and room minting | **Fresh routes plus pg_cron `http` jobs** (the Decision #203 pattern). Amend SA §3.3.                                                                   | SA §3.3 describes a runtime the codebase never adopted (S-20).                                                                                                |
| D7     | Whether courtesy-call reliability feeds Standing                      | Yes, at low weight, and only on presence-verified no-shows                                                                                              | Open since Decision #56 (S-17).                                                                                                                               |
| D8     | Ballot quota and the maximum replacement-slot length                  | At most 3 unapproved slots per attendee. A replacement slot keeps the original event's duration.                                                        | Open since 2026-09-28 (S-15).                                                                                                                                 |
| D9     | The comms queue worker (Decision #203 flag (a))                       | Register it. Reminders cannot ship without it.                                                                                                          | Every pre-session reminder has no producer and no worker (S-18).                                                                                              |

D0 is a fix, not a trade-off. It is listed first because it decides how D1 and D2 are built: both
lean on the sitting row being trustworthy.

**Two more fixes need no ruling and belong beside D0:**

- **S-26 (P0, trust).** "Book this slot" on `/[handle]/availability` and the entity schedule pages
  tells the buyer "You're booked" and books nothing. Route it to the Consultation modal's path.
- **S-30 (P1, security).** A `javascript:` meeting URL can be stored and rendered as a join link.
  Add an https-only CHECK and a render guard.

---

## 1. D1 — the paid 1-on-1 call escrow gap

### 1.1 Premise correction: the flag as written is stale

`database/scheduling/Tables.md` §3 frames this as "relax `finance.escrows` or auto-provision a
session micro-project". Two of its facts have since changed:

| Flag says                                                                               | Actual                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :-------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.escrows` requires **both** `project_stage_id` and `payer_business_id` NOT NULL | Only `project_stage_id` is still NOT NULL (T17, `CREATE TABLE finance.escrows`, line 3 of the block). `payer_business_id` was relaxed by Decision #126: `ck_escrows_one_payer` admits a lone `payer_user_id`. SA §4 already says this; `Tables.md` does not.                                                                                                                                                                                  |
| Option (b), "auto-provision a session micro-project", is hypothetical                   | **It is built.** Decision #211's `projects.fn_book_session_slot` (F1155:564) finds or makes the listing's one unlisted session engagement. It seats the buyer on a one-seat cohort and holds **one escrow per sitting** (`finance.escrows.session_event_id`, `ck_escrows_sitting_on_seat`). It then settles that escrow through the existing sweep: negative consent, provider-no-show refund, per-sitting cancellation and the dispute desk. |

The real question is therefore no longer which architecture to build. It is whether a paid call
should ride the rail that already exists, and what that means for the "a discovery call creates no
Project" sentence in `PRODUCT_SPEC.md`.

### 1.2 Live exposure today

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

### 1.3 Options

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

### 1.4 Recommendation: Option C, with D as the zero-code interim

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

---

## 2. D2 — TTE window alignment

### 2.1 Every time window in force

| Window                        | Value                 | Where                                                                                   | Governs                                                                                           |
| :---------------------------- | :-------------------- | :-------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ |
| Session cancellation notice   | 24h                   | `session_cancel_notice_hours` (`00005001:20`)                                           | Refund versus forfeit per sitting (`cancel_cohort_membership`, F1155:777)                         |
| Reschedule lockout            | **12h**               | `RESCHEDULE_LOCKOUT_HOURS` (coord.ts:56), TS only (S-12)                                | No move inside this window, for any event                                                         |
| Vote resolution lead          | 12h                   | `VOTE_RESOLUTION_LEAD_HOURS` (coord.ts:68); SQL twin `fn_vote_deadline` (F1510:480-483) | A vote closes this long before the earliest ballot slot, or at the lockout, whichever comes first |
| Set-session handshake         | 72h, capped at T−24h  | `set_session_schedule_hours` (`00005001:22`), F1155:703-704                             | A pencilled-in sitting's agreement deadline                                                       |
| Payout (negative consent)     | 24h after the end     | `session_payout_hours` (`00005001:12`)                                                  | Sweep release (F1155:1584-1604)                                                                   |
| Presence                      | first 15 min          | `session_presence_minutes` (`00005001:18`)                                              | The success and no-show outcome (F1155:1028-1084)                                                 |
| Join link opens               | T−10 min              | `session_join_lead_minutes` (`00005001:16`)                                             | `projects.session_join_link`                                                                      |
| Discovery-call late cancel    | 24h                   | `discovery_call_cancellation_window_hours`                                              | **A flag only**: `is_late_cancel`                                                                 |
| Discovery-call minimum notice | 12h (default 720 min) | `call_settings.min_notice_minutes`                                                      | The earliest bookable slot                                                                        |
| Discovery-call proposal TTL   | 72h                   | `discovery_call_proposal_ttl_hours` (`00005001:150`)                                    | **Nothing.** The sweep does not exist (S-11).                                                     |

The set-session handshake is the one window already aligned to the money window: it is capped at
T−24h. The reschedule rules are not.

### 2.2 What the 12h/24h gap actually exposes

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

### 2.3 Options

|                         | **A. Raise the lockout to 24h everywhere**                                                                            | **B. Keep 12h; price late moves**                                                                                     | **C. Money-bearing events use the money window (recommended)**                                                                                                                                          |
| :---------------------- | :-------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule                    | `RESCHEDULE_LOCKOUT_HOURS = 24` for every event                                                                       | A move whose decision lands inside T−24h counts as a provider cancellation for anyone who did not vote for the winner | For an event with money behind it (`source_session_event_id IS NOT NULL`, or a paid call under D1), lockout = vote lead = `session_cancel_notice_hours`. Other events (syncs, milestones) keep 12h/12h. |
| Effect on dissenters    | Partly fixed: the decision lands by T−24h of the old start, but the new slot may still be only 12h after the decision | Fixed, but a new refund branch is needed                                                                              | **Fixed**: the decision lands ≥ 24h before both the old start and the earliest new slot, so every attendee can still cancel against either time with a full refund                                      |
| Effect on project syncs | Needlessly rigid                                                                                                      | None                                                                                                                  | None                                                                                                                                                                                                    |
| Code                    | Change one constant and its SQL twin                                                                                  | A new branch in `cancel_cohort_membership`, plus vote provenance at cancel time                                       | `lockoutHoursFor(event)` and `voteLeadHoursFor(event)` in coord.ts read the parameter. `fn_vote_deadline` takes the event's money flag. `coordination.contract.test.ts` re-pins.                        |

### 2.4 Recommendation: Option C, plus two small rules

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

---

## 3. The smaller rulings

### 3.1 D3 — discovery-call transition doors

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

### 3.2 D4 — presence identity

`projects.record_presence` matches a participant by the **email the provider reports**
(F1155:967-969). This has two failure modes:

1. The Zoom account email differs from the Projective email, so the participant is `unmatched`.
2. A guest types someone else's email, so presence is _asserted_ falsely (S-04).

**Recommendation:** when the platform mints a room (D6), create it with per-registrant join URLs
(Zoom `registrants`, Teams `onlineMeeting` attendee tokens). Store the provider's registrant id
against `(session_event_id, user_id)` and match on it, with email as a fallback flagged
`source = 'webhook_email'`. A dispute audit (F1260:143-201) should weigh an email-only match as
ambiguous.

### 3.3 D5 — the majority denominator

There are three definitions:

- TS counts every seat except the host's, `optional` included (coord.ts:651-655).
- The enum comment says `optional` is _not_ in the denominator
  (`00000004_enums_domains.sql:507-508`).
- The session workspace read counts `role <> 'optional'`, which _includes the host_
  (F1155:1502-1503).

**Recommendation:** keep the TS rule. It is the one settlement actually runs, and its reasoning
holds: "a time they cannot make is a time that excludes them". Correct the enum comment, and make
the workspace read call the same predicate (`role <> 'host'`). This is a new contradiction, so it
goes into Decision #335.

### 3.4 D6 — the runtime for calendar sync and room minting

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
into Decision #335.

### 3.5 D7 — courtesy-call reliability

The flag is open in `PRODUCT_SPEC.md` §Discovery & Courtesy Calls. **Recommendation:** feed the
Reliability Index only from **presence-verified** courtesy no-shows. One mark per counterparty per
30 days caps retaliation. Never feed it from a self-reported mark. A free call stays free of money
consequences, but not of honesty consequences. Otherwise the cooldown is the only deterrent, and it
punishes the wrong party.

### 3.6 D8 — ballot quota and replacement length

The flags are in `database/scheduling/Functions.md` §9. **Recommendation:**

- A per-attendee cap of **3 unapproved slots**, with the host's slots outside it. This needs an
  `RESCHEDULE_ATTENDEE_PROPOSALS_MAX` constant, its trigger twin and a planner refusal
  `proposer_quota`.
- **A replacement slot must keep the original event's duration.** A move is a move, not an
  extension. For a session the length is fixed by the listing (`session_minutes`) anyway.
- Add `ck_proposal_span` length ≤ 24h as a database backstop.

### 3.7 D9 — the comms queue worker

Decision #203 flag (a) leaves `comms.fn_process_queue` unregistered. As a result,
`session.reminder_60m/15m/5m` and `discovery_call_reminder_lead_minutes` have neither a producer nor
a worker (S-18). The reminder is the cheapest no-show prevention there is. **Recommendation:**
register the worker, then add a `scheduling-reminders` sql job that enqueues reminders for sittings
and confirmed calls.

---

## 4. Build order this implies

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

## 5. Proposed Decision #335 (draft, not logged)

> **#335** Scheduling audit rulings (2026-10-29, proposed). **Contradictions surfaced, not
> resolved:**
>
> - (a) The majority denominator has three definitions (`coordination.ts:651` counts optional seats;
>   the `attendee_role` enum comment excludes them; `get_session_workspace` counts non-optional
>   seats including the host).
> - (b) SA §3.3 places integration runtime in Edge Functions, while the codebase runs it as Fresh
>   routes plus pg_cron `http` jobs (#203).
> - (c) `database/scheduling/Tables.md` §3 still says `payer_business_id` is NOT NULL (relaxed by
>   #126) and treats a session micro-project as hypothetical (built by #211).
> - (d) The Zoom provider seed says `supports_webhooks = false` (`00005050:131-133`) while a Zoom
>   presence webhook ships (#171).
> - (e) `DESIGN_SYSTEM.md:2902-2906` says the Month view paginates, while its §C.1 roster and
>   `packages/ui/calendar/core/month-window.ts` scroll continuously.
>
> **Proposed rulings, awaiting the owner:** D0 to D9 of `SCHEDULING_DECISIONS_AND_GAPS.md`.
