# Product Management — Projective

> **Status:** Living single source of truth for how Projective work is decomposed, tracked, and
> closed out. **Authority:** subordinate to [`business/PRODUCT_SPEC.md`](business/PRODUCT_SPEC.md)
> (business rules) and [`architecture/SYSTEM_ARCHITECTURE.md`](architecture/SYSTEM_ARCHITECTURE.md)
> (technical rules). If a lifecycle rule here ever contradicts those, they win and this file must be
> corrected in the same change. **Scope:** this governs _our delivery of the platform_ (the build
> backlog) using the exact same status vocabulary the _product itself_ uses for tickets, stages, and
> sessions — one language, two altitudes.

[toc]

---

## 0. Why one vocabulary

Projective is unusual: the thing we build (a stage-based work platform) and the way we build it
share a shape. A client's Project decomposes into Stages, which decompose into Tickets or Sessions;
our engineering Epics decompose into Features, Stories, and Tasks. Rather than invent a second,
parallel set of statuses for the build tracker, this document deliberately **reuses the product's
own lifecycle states** (`Ready`, `Claimed`, `In Progress`, `Review/Escrow-Locked`, `Complete`,
`Disputed`, …). This keeps the team fluent in the domain and makes the tracker itself a dogfooding
exercise.

Two delivery modes are tracked with the **same** state machine:

- **Asynchronous delivery** — Deliverable-Based work (Pipelines & One-Offs): tickets with
  checklists, artifacts, and client approval. Maps to engineering Stories/Tasks that produce a
  merged artifact.
- **Synchronous sessions** — Session-Based work (Services): time-bound, attendance-verified events.
  Maps to engineering work that is a live event (design review, pairing session, spec walkthrough)
  where "done" means "it happened and was verified," not "a file was merged."

---

## 1. The Work Hierarchy (Cascading Relationships)

Work cascades through **four fixed tiers**. Each tier has exactly one parent tier and rolls its
status up to it. The tiers map cleanly onto the platform's own domain objects so a contributor never
has to translate between "the tracker" and "the product."

```text
EPIC            (a platform capability area — e.g. "Escrow & Wallets")
└─ FEATURE      (a shippable slice — e.g. "Just-In-Time ticket escrow lock")
   └─ STORY     (one user-visible behavior — e.g. "Freelancer claims a Ready ticket")
      └─ TASK   (one atomic unit of execution — e.g. "Add claim_ttl sweep RPC")
```

### 1.1 Tier definitions

| Tier        | Product-domain analogue                                                                  | Definition                                                                                                                                 | Owns                                                                                                                                        | Sizing signal |
| :---------- | :--------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ | :------------ |
| **Epic**    | A `PRODUCT_SPEC.md` capability section (Escrow, Hiring, Reputation, Marketplace, Comms…) | A durable area of platform capability. Rarely "done"; it accumulates Features over releases.                                               | The acceptance theme, the owning domain(s), the release phase (MVP / Phase 2 / Phase 3 per [`business/features.md`](business/features.md)). | Quarters      |
| **Feature** | A `Project` / `Service` archetype                                                        | A vertically-sliced, independently shippable increment that delivers observable value and can be demoed end-to-end.                        | A definition-of-done, the DB/type/route/UI surfaces it touches, its RLS impact.                                                             | Weeks         |
| **Story**   | A `Stage`                                                                                | One user-visible behavior with a clear actor and outcome ("As a Client, I release escrow on approval"). The unit of estimation and review. | Acceptance criteria (Gherkin-style), the `CREATE`-framework category, a Workload-Intensity estimate.                                        | Days          |
| **Task**    | A `Ticket` (async) **or** a `Session` (sync)                                             | The smallest independently-claimable unit of execution. Has a single assignee, a single artifact or event, and a single approval.          | The actual diff / migration / event, its checklist, its evidence.                                                                           | Hours         |

### 1.2 Cascade rules (non-negotiable)

1. **No orphans.** Every Task has a Story; every Story a Feature; every Feature an Epic. A Task with
   no parent is a tracking bug — resolve it before work starts.
2. **A Task belongs to exactly one Story.** If a Task serves two Stories, it is mis-scoped: split
   it, or promote the shared part to its own Story consumed by both (mirrors the product's
   Multi-Stage ticket rule — a ticket may _require_ several stages but is _owned_ by one).
3. **Status rolls up, never down.** A parent's status is **derived** from its children (see §3.4),
   never set directly. You move a Task; the Story/Feature/Epic recompute.
4. **Estimates roll up additively** using Workload Intensity ($W_i$, §4), the same metric the
   platform uses for freelancer capacity — so our sprint load is measured in the platform's own
   unit.
5. **Definition-of-Done is inherited and tightened.** A Task cannot be `Complete` under looser
   criteria than its Story's DoD; a Story cannot be `Complete` under looser criteria than its
   Feature's DoD.

---

## 2. Delivery Modes

Every Task is one of two modes. The mode determines which **evidence** closes it and which subset of
the state machine (§3) it traverses.

### 2.1 Asynchronous — Deliverable-Based Tasks

Mirrors the product's Deliverable-Based stage format.

- **Evidence of done:** a merged artifact (PR, migration, doc) **or** proof-of-action (screenshot,
  green CI run) attached to the Task.
- **Approval:** a reviewer moves the Task from `Review` → `Complete`, or requests revision (→ back
  to `In Progress`). This is the internal analogue of a Client approving a stage submission.
- **Escrow analogue:** the "lock" is the reviewer's committed time — a Task in `Review` holds a
  reviewer slot the way an escrowed ticket holds capital (see §3.3, the Escrow-Locked substate).

### 2.2 Synchronous — Session-Based Tasks

Mirrors the product's Session-Based service format. Used for design reviews, architecture
advisories, pairing, spec walkthroughs, user-testing sessions.

- **Evidence of done:** verified attendance + a recorded outcome (decisions log, action items),
  analogous to the product's **Digital Handshake** (both required parties present within the first
  15 minutes → `Successful`).
- **Approval:** **Negative consent** — if no objection is logged within an agreed window after the
  session, it auto-completes, exactly like the product's 24-hour session payout rule.
- **No-show handling:** if the owning party never joins, the Session Task returns to `Backlog` (the
  build analogue of a client refund) and is re-scheduled.

| Aspect         | Async (Deliverable)        | Sync (Session)                       |
| :------------- | :------------------------- | :----------------------------------- |
| Unit           | Ticket-Task                | Session-Task                         |
| "Done" means   | Artifact merged & approved | Event occurred & verified            |
| Closing signal | Reviewer approval          | Attendance + negative-consent window |
| Board home     | Kanban / Timeline          | Calendar                             |
| Reopen trigger | Revision requested         | No-show / objection logged           |

---

## 3. The Unified Status State-Machine

Every Task moves through the **same** finite state machine regardless of mode; Session-Tasks simply
interpret `Review/Escrow-Locked` as "verification window" rather than "reviewer hold." Stories,
Features, and Epics do **not** have their own states — they carry a **derived rollup** (§3.4).

### 3.1 States

| #  | State                           | Meaning                                                                                                                                                               | Async reading                                                     | Sync reading                                                 |
| :- | :------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------- | :----------------------------------------------------------- |
| 1  | **Draft**                       | Captured but not yet shaped. Title only is enough to exist (mirrors "a ticket needs only a Title to be created").                                                     | Idea / placeholder; not sellable-equivalent — no description yet. | Session idea; no time/location proposed.                     |
| 2  | **Backlog**                     | Shaped enough to be prioritized, but not yet refined to actionable. Has a description (mirrors the product's "purchasing gate": no description → not claimable).      | Awaiting refinement.                                              | Awaiting scheduling proposal.                                |
| 3  | **Ready / Refined**             | Meets Definition-of-Ready: description, acceptance criteria, $W_i$ estimate, dependencies clear. Visible in the claim pool.                                           | In the sprint backlog, claimable.                                 | Time/location proposed; awaiting the handshake.              |
| 4  | **Claimed**                     | Soft-locked to one owner. Capacity checked against caps (§4). Has a **TTL** — an unstarted claim auto-releases to `Ready` (mirrors `claim_ttl_minutes`, default 24h). | Assignee committed, not yet started.                              | Attendees approved the slot (handshake complete); scheduled. |
| 5  | **In Progress**                 | Active execution. The commitment step; the analogue of escrow _locking_ at claim.                                                                                     | Coding / writing.                                                 | Session is live (or imminent within its window).             |
| 6  | **Review / Escrow-Locked**      | Work submitted; awaiting verification. Holds a reviewer/verification slot.                                                                                            | In code review / QA.                                              | Post-session verification / negative-consent window running. |
| 7  | **Complete**                    | Verified and accepted. Rolls up. Enters the (short) post-merge watch analogous to the 24h payout window.                                                              | Merged & approved.                                                | Attendance verified & window elapsed with no objection.      |
| 8  | **Disputed**                    | A blocking disagreement (scope, correctness, or — in product terms — a $W_i$/no-show claim). Work suspended; evidence frozen.                                         | Reviewer ↔ author deadlock, or a Workload-Intensity report.       | No-show claim or contested outcome.                          |
| —  | **Blocked** _(orthogonal flag)_ | Not a state — a **flag** any active Task can carry (waiting on a dependency, an external answer, an env). Preserves the underlying state so it resumes cleanly.       |                                                                   |                                                              |
| —  | **Archived** _(terminal)_       | Won't-do / superseded / duplicate. Terminal, non-reopenable; kept for audit (never hard-deleted — see §5.4).                                                          |                                                                   |                                                              |

### 3.2 Legal transitions

```text
Draft ──────────► Backlog ──────────► Ready/Refined ──────────► Claimed
  │                  ▲                     ▲   │                    │
  │                  │                     │   │ (TTL expiry /       │ (start work)
  │                  │                     │   │  un-claim)          ▼
  │                  │                     └───┴──────────────  In Progress
  │                  │                                               │
  ▼                  │                                               ▼
Archived ◄───────────┴───────────────────────────────  Review / Escrow-Locked
  ▲                                                          │    │
  │                                          (approve) ──────┘    │ (revision requested)
  │                                               ▼               ▼
  └──────────────────────  Complete           In Progress ◄───────┘

Disputed  ◄────► (may be raised from In Progress, Review/Escrow-Locked, or Complete)
                 Resolves to exactly one of: In Progress (rework), Complete (upheld), or
                 Backlog (reset & re-pool — the build analogue of a full refund).

Blocked   =  orthogonal flag on any of {Ready, Claimed, In Progress, Review}. Clearing it
             returns the Task to the exact state it held.
```

### 3.3 The `Review / Escrow-Locked` substates

This state is where the product's escrow semantics map most directly, so it is modeled with explicit
substates for auditability:

- **`awaiting-review`** — submitted, no reviewer assigned. (Capital locked, no auditor yet.)
- **`in-review`** — reviewer actively evaluating. (Auditor engaged.)
- **`changes-requested`** — bounced; transitions out to `In Progress`. (Revision requested.)
- **`approved`** — transitions out to `Complete`. (Escrow releases.)
- **`window`** _(sync only)_ — negative-consent countdown; auto-`Complete` on elapse.

### 3.4 Rollup derivation (parent status)

A parent's derived status is the **least-advanced meaningful state** of its children, with dispute
and block taking precedence:

1. If **any** child is `Disputed` → parent shows **Disputed**.
2. Else if **all** children `Archived`/`Complete` (and ≥1 `Complete`) → **Complete**.
3. Else if **any** child `In Progress`/`Review` → **In Progress**.
4. Else if **any** child `Claimed` → **Claimed**.
5. Else if **any** child `Ready` → **Ready/Refined**.
6. Else if **any** child `Backlog` → **Backlog**.
7. Else → **Draft**.
8. The **Blocked** flag rolls up if any non-terminal child is blocked (parent shows a blocked
   badge).

> Rollup is computed, not stored authoritatively at the parent — the same "source of truth lives at
> the leaf" discipline the platform uses for ticket→stage→project state.

### 3.5 Domain lifecycles are NOT build-tracker states (finance, verification, scheduling, comms & assets)

The §3.1 state-machine governs **build Tasks** on the delivery tracker. The 2026-07-23 Wallet &
Finance foundation, the 2026-07-24 Availability & Discovery Calls foundation, the 2026-07-24
Notification Engine and the 2026-08-04 Asset Management foundation add several **product domain
lifecycles** — these are **separate** finite state machines that live at the
schema/business layer, and they are recorded here **only so nobody mints a bespoke build-board
column for them.** Their canonical definitions are the enum + doc listed:

| Domain lifecycle           | States                                                     | Canonical home                                       |
| :------------------------- | :--------------------------------------------------------- | :--------------------------------------------------- |
| **KYC / KYB verification** | `unverified → pending → verified` (`rejected` / `expired`) | `finance.kyc_status` · `finance-model.md` §10        |
| **Fund state**             | `locked → pending → available`; `on_hold` (dispute)        | `finance.fund_state` · `finance-model.md` §7         |
| **Invoice**                | `draft → issued → paid`; `overdue` / `void`                | `finance.invoices.status` · `finance-model.md` §15   |
| **Statement**              | `draft → issued → final`                                   | `finance.statement_status` · `finance-model.md` §15  |
| **Dispute**                | `open → under_review → resolved` / `refunded`              | `dispute_status` · `brain.md` §Disputes              |
| **Spend approval**         | `pending → approved` / `rejected` / `expired`              | `finance.approval_status` · `finance-model.md` §14   |
| **Chargeback**             | `opened → under_review → won` / `lost` / `refunded`        | `finance.chargeback_status` · `finance-model.md` §15 |
| **Discovery call**         | `proposed → confirmed → completed`; `declined` / `expired` / `cancelled` / `no_show` | `scheduling.call_status` · `PRODUCT_SPEC.md` §Discovery & Courtesy Calls |
| **Event reschedule (per round)** | `none → collecting → awaiting_counterparty` \| `voting`; then `resolved` (a time carried) / `lapsed` (asked, no majority) / `withdrawn` (pulled). All three endings are terminal **for that round**; proposing again opens round `n + 1` | `RescheduleStatus` · `packages/types/scheduling/coordination.ts` · `PRODUCT_SPEC.md` §The Proactive Calendar |
| **Event RSVP (per attendee)** | `pending ⇄ accepted` / `tentative` / `rejected`, freely revisable until the event starts | `RsvpResponse` · `packages/types/scheduling/coordination.ts` |
| **Integration connection** | `active → expired` (refreshable) / `revoked` (terminal); `error` | `integrations.connection_status` · `SYSTEM_ARCHITECTURE.md` §Conferencing 2.1 |
| **Subscription**           | `trialing → active`; `active ⇄ past_due` / `paused`; `cancelled` / `expired` (terminal) | `finance.subscription_state` · `finance-model.md` §16 |
| **Standing rung**          | `L1 New → L2 Established → L3 Trusted → L4 Expert → L5 Elite` (bidirectional — a rung can be lost) | `org.standing_levels` · `finance-model.md` §16.3 |
| **Allowance period**       | Rolls weekly; `granted → consumed`, buffer drips back on a timer   | `finance.allowance_periods` · `finance-model.md` §16.2 |
| **Notification delivery**  | `pending → queued → sent → delivered`; `failed` / `suppressed` (policy said no) / `skipped` (nothing to send to) | `comms.delivery_status` · `database/comms/Functions.md` |
| **Scheduled notification** | `scheduled → processing → sent`; `cancelled` (the reason went away) / `failed` (3 attempts) | `comms.queue_status` · `database/comms/Tables.md` |
| **Asset**                  | `pending_upload → scanning → uploaded → archived → deleted`; `error` / `quarantined` (terminal-until-resolved off `scanning`) | `files.file_status` + `files.items.is_archived` / `deleted_at` · `database/files/Tables.md` |
| **Share link**             | `active → expired` (time) / `revoked` (**terminal**); also `exhausted` (download limit) | `files.share_links` (`expires_at` / `revoked_at` / `download_limit`) · `database/files/Functions.md` |

> **The discovery call is the sharpest illustration of why this section exists.** A booked call is
> not a unit of delivery: it creates no Project, Stage or Ticket, never appears on a board, and does
> **not** count toward Workload Intensity (§4). For a CALL a **reschedule is not a state** — it
> returns the row to `proposed` and increments a counter, so a call that moved three times is still
> one call, not three. Enforced by `scheduling.fn_enforce_call_transition`; mirrored for the client in
> `packages/types/scheduling/calls.ts` (`CALL_TRANSITIONS`), where **the trigger is the authority**.
>
> **For an EVENT it is, and the two rows above are not a contradiction of that sentence but its
> complement.** A call has exactly one proposed slot and one person to accept it, so "proposed" says
> everything there is to say. Moving a booked group session does not: the host assembles several
> alternatives before anyone is asked (`collecting`), the cohort is then asked (`voting`) with a
> deadline they can read, and the question has to be able to END — carried, lapsed for want of a
> majority, or pulled. There is no single field on the event that could carry that, and a surface
> cannot draw a countdown, a ballot or a refusal without it. The reschedule state therefore lives
> **beside** the event, on `EventReschedule`, and moving a session still does not create a second
> session — the same "one row, many attempts" discipline the call's counter expresses, kept per round
> in `EventReschedule.round`.
>
> **Three named caps govern it, and they are policy, not implementation details** (pinned by unit
> test in `coordination_test.ts`): `RESCHEDULE_LOCKOUT_HOURS = 12` — inside it nothing moves, because
> the other party has arranged their day around the slot; `VOTE_RESOLUTION_LEAD_HOURS = 12` — a vote
> closes that far before the EARLIEST slot on the ballot, so a ballot can never elect a time that has
> itself become unmovable; `MIN_VOTE_PROPOSALS = 2` — one option is an announcement, not a vote.
>
> **A change of time needs a MAJORITY, not a plurality** (`PRODUCT_SPEC.md` §The Proactive Calendar).
> The threshold is strictly more than half of everyone ENTITLED to vote — the roster minus the host,
> who authored the options — never more than half of those who happened to answer. Abstaining is
> therefore a vote against moving, deliberately: the default outcome of an unanswered question is
> that nothing changes. A vote that closes without one **lapses** and the original time stands;
> `lapsed` is a separate state from `resolved` precisely so that "decided" can never be read off a
> null winner. The transition is applied by one pure function (`settleVote`) on every read and before
> every action, because there is no cron in this layer and a deadline nothing observes is not a
> deadline.
>
> ⚠️ **Unreconciled with the escrow window, flagged for a human** (root CLAUDE.md §8): the 12-hour
> reschedule lockout does not line up with §Cancellation & Escrow Protection's 24-hour cancellation
> window, so between T-24h and T-12h an attendee may still MOVE a session they could no longer cancel
> without forfeiting escrow. That is a money decision and is deliberately not settled here.

> **The two asset lifecycles, and why neither is a build state.** An **asset** is a file somebody
> uploaded; a **share link** is a capability URL somebody minted. Neither is a unit of work: neither
> creates a Project, Stage or Ticket, neither appears on a board, and neither counts toward Workload
> Intensity (§4). An uploaded file is an *input to* or an *output of* delivery — never delivery
> itself. The nearest confusable thing is a **submission**, which _is_ tracked, and the distinction is
> exactly the point: a stage submission moves a Ticket through §3.1 and releases escrow; the bytes it
> carries move through the asset lifecycle underneath it, independently.
>
> **The asset lifecycle spans three columns, not one enum, and that is deliberate.**
> `pending_upload → scanning → uploaded` are members of the closed `files.file_status` enum (plus the
> two off-ramps `error` and `quarantined`, which are where a failed AV/MIME check parks a file rather
> than deleting it). **`archived`** is `files.items.is_archived`, and **`deleted`** is
> `deleted_at IS NOT NULL` — a *soft* delete. Folding archived/deleted into the status enum was
> rejected because they are orthogonal to it: an archived file is still `uploaded` (its bytes are
> intact and it can be restored), and a soft-deleted row must keep its last real status so the quota
> rollup, the download audit and any share link that pointed at it stay explicable. **Nothing here is
> ever hard-deleted** (§5.4) — `deleted` is a terminal *state*, not a `DELETE`.
>
> **A share link's states are computed, not stored.** There is no `share_status` column: `expired` is
> `expires_at <= now()`, `revoked` is `revoked_at IS NOT NULL`, `exhausted` is
> `download_count >= download_limit`. One predicate — `files.fn_resolve_share(slug)` — evaluates all
> three, so no route can resurrect a revoked link by forgetting a check. **Revocation is terminal**: a
> revoked slug is never re-armed, because a URL that came back to life would be un-un-forwardable.
> And although the service distinguishes the four failure modes to log and meter them, the **route
> maps all four to the same 404** — telling an anonymous caller *"this link expired"* rather than
> *"no such link"* confirms a link existed, which is the fact a scanner is probing for.

**Rules:** (1) these never appear as delivery-board columns (§6 maps only §3.1 states); (2) nothing
is hard-deleted — a retired verification/invoice/dispute goes to a terminal state, never a `DELETE`
(§5.4); (3) a change to any of these transitions updates its canonical home **and** this row in the
same change (§5.1). The build state-machine's own **Disputed** state and **Review/Escrow-Locked**
substates (§3.3) _mirror_ the product's escrow semantics but remain build-tracker states, not these.

---

## 4. Estimation & Capacity (Workload Intensity)

We estimate build work in the platform's own **Workload Intensity ($W_i$)** unit so the tracker and
the product speak the same language.

$$W_i = \text{CREATE-category weight} \times \text{Difficulty multiplier}$$

- **Category weights** (from `PRODUCT_SPEC.md` §Resource Allocation): Create 1.5 · Advise 1.2 ·
  Educate 1.0 · Run 0.8 · Test 0.7 · Empower 0.5. A build Story is tagged with the category that
  best describes it (a new component = _Create_; a refactor/infra = _Run_; a spike/audit = _Test_;
  docs/enablement = _Empower_).
- **Difficulty multiplier:** Low 0.5× · Standard 1.0× · High 2.0×.
- **Caps:** a contributor's summed active $W_i$ is bounded per-initiative and globally, exactly as
  `projects.check_ticket_capacity` bounds a freelancer. Exceeding a cap blocks new claims until
  current work submits — no silent overload.
- **Rollup:** Story $W_i$ = Σ Task $W_i$; Feature = Σ Story; Epic = Σ Feature. Sprint capacity is a
  team-level $W_i$ budget.

---

## 5. Governance — Keeping This a Living Source of Truth

These rules make the difference between a document that decays and one that stays trustworthy. They
are enforced as **pull-request validation parameters** (see root [`CLAUDE.md`](../CLAUDE.md)).

### 5.1 The Same-Change Rule

Any change to lifecycle behavior — a new status, a new transition, a changed cap, a new evidence
requirement — **must** land in this file in the **same** change as the code/migration that
implements it. A lifecycle rule that exists only in code, a chat, or a commit message is
**undocumented and therefore not done.** This mirrors the business-rule discipline already enforced
in [`business/CLAUDE.md`](business/CLAUDE.md).

### 5.2 One vocabulary, enforced

New status names are **not** invented ad hoc. If a genuinely new state is needed, it is added here
first (with its transitions and its async/sync readings) and only then referenced in code, board
tooling, or the `projects` enums. Board columns must map 1:1 to §3.1 states — no bespoke columns.

### 5.3 Rollup, not restatement

This document defines _mechanics_. It must **not** restate feature definitions (those live in
`PRODUCT_SPEC.md`) or schema detail (that lives in [`database/`](database/README.md)). When a rule
here depends on a concrete number the product spec leaves abstract, cross-reference — don't fork the
number. (Cf. the flagged fee-percentage conflict tracked in `business/CLAUDE.md`.)

### 5.4 Nothing is hard-deleted

`Archived` is terminal but retained. Completed and disputed items are **evidence** — they feed the
Reliability-Index analogue we use to review our own delivery (velocity, accuracy, rework rate).
Never purge history; this parallels the product's immutable audit-log and Evidence-Vault principles.

### 5.5 Refinement cadence

- **Definition-of-Ready gate:** nothing enters `Ready/Refined` without a description, acceptance
  criteria, a $W_i$ estimate, and resolved dependencies. (Product parallel: the purchasing gate — no
  description, not claimable.)
- **Weekly refinement** promotes `Backlog` → `Ready` and re-estimates drift.
- **Stale-claim sweep:** any `Claimed` Task past its TTL with no `In Progress` transition
  auto-returns to `Ready` — no parking. (Product parallel: `fn_release_expired_claims`.)
- **Dispute SLA:** a `Disputed` item has a fixed cooling-off window for mutual resolution before it
  escalates to the owning Epic lead, mirroring the product's 48-hour Phase-1 dispute window.

### 5.6 Living-document audit

At each release cut, the Epic owners verify that every §3.1 state, §3.2 transition, and §4 weight in
this file still matches the shipped `projects` enums and RPCs. Drift found here is a release
blocker, not a backlog item.

---

## 6. Board Views (how the states render)

| View                 | Used for                                                        | State columns shown                                                  |
| :------------------- | :-------------------------------------------------------------- | :------------------------------------------------------------------- |
| **Kanban**           | Pipelines / async Task flow                                     | Backlog · Ready · Claimed · In Progress · Review · Complete          |
| **Timeline (Gantt)** | One-Off Features with a delivery date & Deadline-Bonus analogue | Stories laid on a time axis; state as bar fill                       |
| **Calendar**         | Session-Tasks                                                   | Scheduled slots; state via slot color (Claimed→Complete)             |
| **Global Workload**  | Per-contributor capacity                                        | Aggregated active $W_i$ vs. cap (Ready/In-Progress/Complete buckets) |

Column definitions are **frozen to §3.1** — see §5.2.

> **Product board vs this tracker (Decision #35, 2026-07-20).** The columns above are the states of
> **this dogfooding tracker**. The _product's_ Kanban — the client-facing board at
> `/projects/[id]/board` and the stage Tasks board — renders the canonical Postgres
> **`ticket_status`** enum, which is a distinct (shorter) vocabulary and MUST NOT be conflated with
> the tracker's states. The product board's five column ↔ `ticket_status` mapping is fixed (per
> `0121_kanban_sync.sql`), and the product relabels two of them for display: **New = `backlog`** ·
> **Ready = `todo`** · **In Progress = `in_progress`** (with `claimed` folded in — there is no
> separate Claimed _column_ on the product board) · **Review = `in_review`** · **Completed =
> `completed`**. `cancelled` and `reported_hidden` are card **overlays**, never columns. Both
> vocabularies still obey §5.2 (columns map 1:1 to a frozen state machine — no bespoke columns);
> they are simply two machines at two altitudes.

---

## 7. Appendix — Worked example

> **Epic:** Escrow & Wallets → **Feature:** JIT ticket escrow → **Story:** "Freelancer claims a
> Ready ticket and escrow locks" ($W_i$ = Create 1.5 × High 2.0 = 3.0) → **Tasks:** `claim_ticket`
> RPC + advisory lock (async, In Progress → Review), `fn_release_expired_claims` sweep (async),
> "Escrow-lock design review with Finance" (sync Session-Task; closes on attendance +
> negative-consent window).
>
> When both async Tasks reach `Complete` and the Session-Task's window elapses, the Story rolls up
> to `Complete`; the Feature rolls up once all its Stories do. If code review deadlocks, the
> affected Task goes `Disputed`, freezing the Story's rollup until resolved.

---

_Related: [`PRODUCT_SPEC.md`](business/PRODUCT_SPEC.md) ·
[`SYSTEM_ARCHITECTURE.md`](architecture/SYSTEM_ARCHITECTURE.md) ·
[`design-system/DESIGN_SYSTEM.md`](design-system/DESIGN_SYSTEM.md) · root
[`CLAUDE.md`](../CLAUDE.md)_
