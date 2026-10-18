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
Notification Engine, the 2026-08-04 Asset Management foundation, the 2026-08-26 Service Booking
pass, the 2026-09-28 Teams & Businesses console (root `CLAUDE.md` §8 Decision #61), the
2026-09-29 Stripe fiat rails (Decision #125) and the 2026-09-30 money movement on those rails
(Decision #126) add several
**product domain lifecycles** — these are **separate** finite state machines that live at the
schema/business layer, and they are recorded here **only so nobody mints a bespoke build-board
column for them.** Their canonical definitions are the enum + doc listed:

| Domain lifecycle           | States                                                     | Canonical home                                       |
| :------------------------- | :--------------------------------------------------------- | :--------------------------------------------------- |
| **KYC / KYB verification** | `unverified → pending → verified` (`rejected` / `expired`) | `finance.kyc_status` · `finance-model.md` §10        |
| **Verification stamp** (Decision #155) | A DERIVED projection, never a stored transition: a person's `none → id_verified → vault_verified` follows their KYC status and payout readiness (a lapse moves it back down), re-derived by trigger on every KYC/payout write and on every Standing recompute; a business's or enterprise's `corporate_verified` is read live from its KYB | `org.entity_standing.verification_stamp` · `org.fn_verification_stamp` · `packages/types/org/standing.ts` |
| **Trust signals** (Decision #155) | DERIVED, not a lifecycle: earned and lost with the delivery record at each Standing recompute; at most one per dimension | `org.entity_standing.active_adornments` · `org.fn_refresh_active_adornments` |
| **Fund state** (Decision #191) | `locked → pending → available`; `on_hold` (dispute, not wired yet). Earned credits (releases, team shares, fair-exit and seat payouts, product sales) enter `pending` (a `finance.pending_releases` row) and move to `available` only by the hourly sweep once `pending_release_days` (7) pass; a lost chargeback can close a pending row early with no credit (`recovered_cents = amount_cents`). Top-ups, refunds, transfers and returned payouts go straight to `available`. Only `available` can be spent or withdrawn | `finance.fund_state` · `finance.pending_releases` · `finance-model.md` §7 |
| **Payment & work-start** (per ticket — Decisions #165–#167) | `Draft → Needs funding → Payment processing → Funded → In progress → In review → Released`; `Failed` (retryable) · `Refunded` (terminal per escrow). No hold, no work | §3.6 · `PRODUCT_SPEC.md` §Escrow, Wallets & Finance #2 · §Purchase Methods |
| **Invoice**                | `draft → issued → paid`; `overdue` / `void`                | `finance.invoices.status` · `finance-model.md` §15   |
| **Statement**              | `draft → issued → final`                                   | `finance.statement_status` · `finance-model.md` §15  |
| **Dispute** (Decision #212) | `open → awaiting_response → under_review → resolved_release` / `resolved_refund` / `resolved_split`; never deleted, terminal once resolved — the full machine is §3.8 | `dispute_status` · `finance.disputes` · `database/finance/Functions.md` § Platform disputes |
| **Spend approval**         | `pending → approved` / `rejected` / `expired`. Filed by `finance.request_spend_approval` only when the spend genuinely needs one (over the per-transaction ceiling, over the remaining cap, or at/above the wallet's threshold), with the wallet's currency and **`expires_at = now() + 7 days`** set by the server; decided by a member holding **`approve_spend`** who is not the requester. Business wallets only; bound to one ref (a basket, ticket, stage, paid revision, invoice or transfer destination) with one open request per ref. An `approved` request is **spent once** — `consumed_at` stamped by `finance.fn_redeem_spend_approval` in the charging transaction (no new status; a spent, rejected or expired request is never re-decided). `expired` is applied lazily, at the next decision attempt or request after `expires_at`, and an approved-but-unspent request past `expires_at` can no longer be spent; the TypeScript projection reads DB `rejected` as `declined` | `finance.approval_status` · `database/finance/Functions.md` § Workspace money governance · `finance-model.md` §14 |
| **Workspace membership** (team / business seat) | `active → left`. A departure is a status with `left_at`, never a `DELETE`; a former member is **reactivated** by accepting a new invitation, never inserted twice. Exactly **one** active owner per entity, who can never leave or be removed — ownership moves only by **transfer** (`org.transfer_workspace_ownership`) to another active member — for a team, one who is a freelancer account and payout-ready (Decisions #196, #228 (A)), since the team's withdrawer and verification follow the owner — after which the former owner holds the Admin preset or, in the same act, leaves. A business's **managers** — admins and holders of `manage_projects`, pending invitations to such a role included — are capped by its plan's `business_managers` (2 free / 15 Pro): inviting, accepting, a role change or grant that would pass it is refused `PK402` while `business_plan_gates_enforced` is on (Decision #230 (b), (e)); a downgrade removes nobody. An invitation is **not** a member state (the former `invited` member status is gone) | `org.team_members` / `org.business_members` `status` (`CHECK IN ('active','left')`) · `packages/types/workspace` `MembershipState` · `database/org/Tables.md` § Workspace membership |
| **Workspace invitation**   | `pending → accepted` / `declined` (the invitee) / `revoked` (the inviting side). Each has its own timestamp (`responded_at` / `revoked_at`), pinned by `ck_org_invitation_lifecycle`. **14-day expiry, DERIVED from `expires_at`, never a stored status** — a lapsed `pending` row stays in the queue and **resend renews** it (a fresh token and `expires_at = now() + 14 days`); an answered row cannot be resent or revoked. At most one pending invitation per entity per person or per address. Named people only — join requests and share links were cut (2026-09-28). Accepting a TEAM invitation needs the invitee payout-ready, as does creating a team (Decision #196) | `org.org_invitations.status` · `packages/types/workspace` `WorkspaceInvite` · `database/org/Functions.md` §12 |
| **Workspace entity** (team / business) | `draft → active → archived`; restore leaves `archived` for `active` or `draft`. Created `draft` (Draft-First); publishing needs `manage_settings`, archive/restore needs `archive_entity`, and a published entity never returns to `draft`. **Archive is refused while an escrow is held** owed to the team or funded by the business — for a team, also a held escrow on a stage it is assigned to (not declined / cancelled / released) that is not bound yet or is bound to one of its members (TEAMS_AUDIT S3) — **or while the team holds a live stage assignment** on an active / on-hold project. **A business is refused archive on every blocker `org.fn_business_archive_blockers` lists** — `escrow_held` · `live_projects` (active / on-hold) · `pending_approvals` · `unpaid_invoices` (issued / overdue) · `on_account_owed` · `wallet_balance` (> 0 in any currency) · `pending_payouts` — refused `55000` with the first one's code, and the console detail lists them all (`archiveBlockers`) to an `archive_entity` holder before the confirm (BB5). **Only an `active` business transacts** — a draft or archived business is refused `55000 business_not_active` on creating a project, buying, every spend through `finance.fn_assert_business_spend`, hiring, paying an invoice and changing its invoicing terms (`org.fn_assert_business_active`, BB5). Restore's target (to `active` or `draft`) is still OPEN (#226 (c)). **Only an `active` team applies** — a draft or archived team, or one under two active members, is refused on every apply door (`projects.fn_assert_team_can_apply`, `team_not_active` / `team_too_small`; Decision #228 (E)). Nothing is hard-deleted | `org.teams.status` / `org.business_profiles.status` · `org.set_workspace_status` · `packages/types/workspace` `WorkspaceStatus` |
| **Scheduled removal** (a freelancer profile given up, or the whole account — Decision #156) | `scheduled → cancelled` (the person cancels inside the window, or becomes a freelancer again) **or** `scheduled → completed` (the erasure sweep, once `scheduled_for` passes and nothing blocks it — a request whose blockers came back stays `scheduled`, its deferral recorded). Scheduling requires the typed confirmation and refuses while money is held in escrow, work is live, a wallet holds money (and, for the account, while the person owns live projects or workspaces). `freelancer_profile` waits **90 days**, `account` **30**. Terminal states are kept — the row is the record that the erasure ran; the erasure itself anonymises personal data and archives listings rather than deleting rows, except GoTrue's identities and sessions ⚠️ flagged against §5.4 (Decision #156(a)) | `org.deletion_requests` · `org.schedule_freelancer_removal` · `org.schedule_account_deletion` · `org.cancel_deletion_request` · `org.fn_purge_due_deletions` · `packages/types/org/account-lifecycle.ts` · `database/org/Functions.md` § Account lifecycle |
| **Handle change window** (a person's `@handle` — Decision #156) | Derived, never stored: `open` (2 changes left) → `correcting` (1 left, for 3 days after a change) → `locked` (0 left, for 90 days after the window's second change) → `open`. A window whose 3 days pass with one change closes back to `open`. A released handle is **held** for its previous owner for 90 days | `org.handle_changes` · `org.fn_handle_change_policy` · `org.change_username` · `HANDLE_POLICY` |
| **Account age bracket** (a person's date of birth — Decision #190) | Derived, never stored: `restricted` (13–17 — explore and build a profile, no buying or selling) → `full` on the 18th birthday, with nothing to run. Under 13 is never provisioned | `users_public.dob` · `org.fn_check_dob` (`PM422`) · `org.fn_is_minor` · `org.fn_assert_adult` (`PM403`) · `MIN_AGE` / `ADULT_AGE` |
| **Personal project** (any account's choice; always a minor's — Decisions #192, #208) | A permanent ATTRIBUTE, not a lifecycle: `is_personal` is chosen at creation (and forced when the owner is under 18) and never cleared. Never published, it stays `draft` and is labelled "Personal". It moves through the ordinary §3 states (its tickets need no escrow to enter work), but has no Needs funding / Payment processing (§3.6) and no paid revision rounds (§3.7) — there is no money to hold | `projects.projects.is_personal` · `projects.trg_projects_personal_guard` · `fn_ticket_escrow_sync` |
| **Email address** (a person's secondary address — Decision #151) | `unverified → verified`, only by redeeming a single-use, 24-hour, hash-stored token mailed to the address (`org.confirm_user_email` for the signed-in owner), **never by a client write**; a verified address may become **primary** (`org.set_primary_email` — exactly one per person, the old one cleared in the same act). The sign-in address is verified by GoTrue (`public.handle_email_confirmed`). Tokens are `issued → consumed`, or expired by TTL or by a reissue — derived from `expires_at`, never a stored status. Removal (`org.remove_user_email`) is a hard `DELETE` of a secondary address — never the primary or the sign-in one ⚠️ flagged against §5.4 (Decision #151(b)). Max 5 addresses | `org.user_emails.verified_at` / `is_primary` · `org.email_verification_tokens` · `packages/types/org/user-emails.ts` · `database/org/Functions.md` § Email addresses |
| **Chargeback**             | `opened → under_review → won` / `lost` / `refunded`. Opened by the signed `charge.dispute.created` webhook, which also moves the escrows the disputed card payment funded from `held` to `disputed`. Closed by `charge.dispute.closed` (`finance.record_dispute_closed`, Decision #126): **won** returns those escrows to `held`; **lost** refunds each still-frozen escrow to the payer's wallet, then debits the disputed amount from it (`chargeback`) as far as the balance covers — the uncovered rest is `unrecovered_cents`, the platform's loss. `under_review` and `refunded` still have no writer | `finance.chargeback_status` · `finance-model.md` §15 · `database/finance/Functions.md` § Money movement |
| **Inbound card payment**   | `requires_payment → processing → succeeded` **or** `→ settled_unapplied` (Decision #200 — the money arrived and is credited, but the escrow lock or checkout order it was for was refused after the credit; `unapplied_reason` says why and the payer is told the funds are in their wallet; terminal, like `succeeded`, and both always carry their ledger row); `failed` (**not** final — the payer may retry and a later success still settles it) · `canceled` (terminal). Only the signed Stripe webhook moves it past `requires_payment`; a payment Stripe refused to create is closed `canceled` by the payer's own request. A success whose amount / currency does not match the payment moves it nowhere: it stays `processing`, the webhook is acknowledged into reconciliation (one ops row, `finance.v_ops_unledgered_payments` → `settlement_mismatch`) and a human settles or closes it — there is no bespoke status for it. An **escrow-lock** payment carries a second, subordinate state — `lock_status`: `pending → locked` / `failed` (`not_applicable` for a top-up) — because the money can arrive while the lock is refused (the stage moved on, the payer lost the right to spend): a failed lock keeps the money in the paying wallet and records why. A **checkout top-up** (Decision #153) carries a subordinate ORDER outcome instead: on `succeeded` the order is placed as the payer (`order_id`), or refused with the money kept in the wallet (`order_error`) — never a second order, because the browser and the webhook place it under one key. Neither is a build-board column | `finance.inbound_payment_status` + `finance.inbound_payments.lock_status` · `packages/types/finance/payments.ts` · `database/finance/Tables.md` §10 |
| **Connect payout account** | `pending_verification → verified`; `restricted` (Stripe needs more) ⇄ `verified`; `disabled` (terminal). Written only from what Stripe reports about the `stripe_transfers` capability (`payoutAccountStatusFor`), never by a client — at the return URL, on `account.updated`, or on a v2 thin event re-read from Stripe. A business's verified account is ALSO its Level-3 KYB (`org.business_profiles.kyb_status`) | `finance.payout_accounts.status` · `packages/types/finance/payments.ts` |
| **Payout (withdrawal)**    | `pending → paid`; `failed` (Stripe refused — the money is credited back, `payout_reversal`); `cancelled` has no writer. The wallet is DEBITED when the payout begins, so money in flight cannot be spent twice. `paid` means the Stripe Transfer to the owner's Connect account exists; Stripe pays the bank on its own schedule. A transient failure leaves it `pending` for `transfer.created` to settle, or for the stale sweep (Decision #202), which after `payout_stale_minutes` moves it to `paid` (transfer found or re-sent under its key) or `failed` (refused, or none made after 23 h). `paid → reversed` when the platform reverses the whole transfer (`transfer.reversed`, money credited back); a partial reversal stays `paid`. Beside the status, `bank_status` (`paid` / `failed`) records the connected account's own bank payout; a bank failure is final for that bank payout, and a later one that re-pays it moves it to `paid` | `finance.payout_status` · `finance.begin_payout` / `complete_payout` / `fail_payout` / `record_transfer_reversed` / `record_bank_payout` / `fn_claim_stale_payouts` · Decisions #126, #202 |
| **Recurring deposit rule** | `active` ⇄ paused (`active = false`). Each due period is charged ONCE, off-session, as an inbound payment keyed `deposit:<rule>:<period>`; missed periods are skipped, never charged in a burst. Three consecutive failed runs, or a card / author / authority that is gone, pause the rule. A RUN whose charge never reached a PaymentIntent (processor unreachable, answer lost) stays `requires_payment` and unbound and is re-sent as the same payment under the same Stripe idempotency key by later sweeps, so the period is neither skipped nor charged twice; after 23 h unbound it is closed `failed` (an ops row asks a human to check Stripe), and a run whose rule was stopped first is closed `canceled`. Neither counts as a failed run; only a declined card / required authentication does | `finance.deposit_rules` · `finance.claim_due_deposit_rules` · Decision #126 |
| **Discovery call**         | `proposed → confirmed → completed`; `declined` / `expired` / `cancelled` / `no_show` | `scheduling.call_status` · `PRODUCT_SPEC.md` §Discovery & Courtesy Calls |
| **Event reschedule (per round)** | `none → collecting → awaiting_counterparty` \| `voting`; then `resolved` (a time carried) / `lapsed` (asked, no majority) / `withdrawn` (pulled). All three endings are terminal **for that round**; proposing again opens round `n + 1` | `RescheduleStatus` · `packages/types/scheduling/coordination.ts` · `PRODUCT_SPEC.md` §The Proactive Calendar |
| **Event RSVP (per attendee)** | `pending ⇄ accepted` / `tentative` / `rejected`, freely revisable until the event starts | `RsvpResponse` · `packages/types/scheduling/coordination.ts` |
| **Session seat** (a cohort membership — a group seat, or a 1-1 booking as a one-seat cohort, Decision #211) | `active → completed` (paid out) / `cancelled` (refunded or forfeited — `cancelled_at` set); never deleted. A group seat holds ONE escrow and settles after the cohort's last sitting; a 1-1 seat holds one escrow PER SITTING and ends only when nothing is left held — `completed` if any sitting paid the provider, else `cancelled` (`projects.fn_settle_membership_state`) | `projects.cohort_memberships.status` · `00001155` · `PRODUCT_SPEC.md` §Session-Based C |
| **Session escrow** (per sitting on a 1-1 — Decision #211) | `held → released` (`session_payout_hours` after ITS sitting ended, no open dispute — negative consent) / `refunded` (provider no-show of any age; the provider cancelling a sitting not yet started; the client cancelling more than `session_cancel_notice_hours` before it). The client cancelling inside the notice **forfeits** it (`released`). A sitting that has started is never cancelled — it settles on its window or its dispute | `finance.escrows` (`session_event_id`) · `finance.auto_release_session_escrow` · `projects.cancel_cohort_membership` |
| **Set-session scheduling handshake** (sittings 2…n of a block — Decision #211) | One **Event reschedule** round per provisional sitting (the row above), opened by the system at payment as round 0 `counterparty` / `collecting` with `resolves_at` = payment + `set_session_schedule_hours` (72), never later than `session_cancel_notice_hours` before the provisional start. Ends `resolved` (a time agreed — the sitting moves with it) / `lapsed` (deadline passed — `projects.fn_lapse_session_handshakes`; the pencilled-in weekly time stands) / `withdrawn` (the booking was cancelled). Either ending confirms the sitting's calendar entry; one reminder fires 24h before the earliest deadline | `scheduling.event_reschedules` · `projects.fn_book_session_slot` · job `session-scheduling-handshakes` |
| **Integration connection** | `active → expired` (refreshable) / `revoked` (terminal); `error` | `integrations.connection_status` · `SYSTEM_ARCHITECTURE.md` §Conferencing 2.1 |
| **Subscription**           | `trialing → active`; `active ⇄ past_due` / `paused`; `cancelled` / `expired` (terminal) | `finance.subscription_state` · `finance-model.md` §16 |
| **Standing rung**          | `L1 New → L2 Established → L3 Trusted → L4 Expert → L5 Elite` (bidirectional — a rung can be lost) | `org.standing_levels` · `finance-model.md` §16.3 |
| **Allowance period**       | Rolls weekly; `granted → consumed`, buffer drips back on a timer   | `finance.allowance_periods` · `finance-model.md` §16.2 |
| **Notification delivery**  | `pending → queued → sent → delivered`; `failed` / `suppressed` (policy said no) / `skipped` (nothing to send to) | `comms.delivery_status` · `database/comms/Functions.md` |
| **Scheduled notification** | `scheduled → processing → sent`; `cancelled` (the reason went away) / `failed` (3 attempts) | `comms.queue_status` · `database/comms/Tables.md` |
| **Service draft (instantiated pipeline)** | `draft → active` (first stage funded) \| `archived` (removed by the buyer, or swept after `service_draft_idle_days` idle with nothing funded). `archived` is terminal and is SOFT — never a delete, and deliberately distinct from `cancelled`, which records a decision about live work where this records that nothing ever happened | `project_status` · `projects.fn_archive_stale_service_drafts` · `database/projects/Tables.md` |
| **Catalogue listing** (Decisions #217, #221) | `draft` · `published` · `paused` · `archived` — the seller moves between them through one door; archive is a status and the removal for anything with history. **Hard delete** (`catalogue.delete_listing`) only for a listing with **no buyer history** (no inquiry, quote, discovery call, instantiated project, waitlist place, basket or order line, review or paid placement) — the owner's #163 carve-out from §5.4 applied to listings; refused `PE409` otherwise. `paused` means the seller intends to return. **Publishing** passes the gate: a title, a price, an image in showcase slot 1 and, for a Pipeline, at least one stage (`PG422`, `DETAIL` lists what is missing); a seller under 18 is refused `PM403` (Decision #190). The batch door applies the same move per listing and reports each outcome. The delivery model changes only while `draft`; a live listing is archived and recreated instead. **Caps:** 6 showcase slots (slot 1 an image), 10 tags, 12 stages. A duplicate always starts as a `draft` | `catalogue.listing_status` · `catalogue.set_listing_status` / `set_listings_status` / `save_listing` / `duplicate_listing` · `packages/types/catalogue/catalogue.ts` (`publishReadiness`) · `database/catalogue/Functions.md` |
| **Catalogue client lane** (Decision #217) | `inquiries` · `active` · `action_required` · `closed` — **derived, never stored and never moved by hand**. Each engagement's lane is read from its source's own recorded status (`laneOf`: any action reason → `action_required`; a closed source status → `closed`; an inquiry or quote with no order → `inquiries`; otherwise `active`), and a buyer sits in the most urgent lane among their engagements. The board is read-only (no drag) and the RPC returns source statuses verbatim, so no bespoke status exists to drift from the order, booking, quote or inquiry it describes | `catalogue.get_client_pipeline` · `packages/types/catalogue/clients.ts` (`laneOf` / `clientLaneOf`) · `database/catalogue/Functions.md` |
| **Availability preset** (Decision #217) | `live → archived` (`archived_at`, terminal and SOFT: never a delete). Archiving unbinds every listing that booked against it (they fall back to the schedule's default), and a default preset hands the default to the most recently edited live library preset, so it cannot be archived while it is the only one. Archived presets stop compiling occurrences; history keeps the row | `scheduling.availability_presets.archived_at` · `scheduling.archive_availability_preset` · `database/scheduling/Functions.md` |
| **Custom quote request**   | `sent → answered` / `withdrawn`. Top-of-funnel: it creates no project, stage, ticket or escrow, and never enters the §3.1 delivery machine | `packages/types/services/contact.ts` · `PRODUCT_SPEC.md` §The Hiring Process |
| **Asset**                  | `pending_upload → scanning → uploaded → archived → deleted`; `error` / `quarantined` (terminal-until-resolved off `scanning`) | `files.file_status` + `files.items.is_archived` / `deleted_at` · `database/files/Tables.md` |
| **Stage / project room retirement** (a type switch — Decision #163) | `live → archived` (`archived_at`, terminal) or a hard delete. When a save leaves the project a **Task**, every stage but the root (lowest `sort_order`) retires with its rooms; when it leaves it a **Session**, its stages stay (they are its sessions) and every stage-bound room retires. The project-wide room never retires. A row with **no history** at all is hard-deleted; anything with history (tickets, submissions, seats, invitations, money, messages, files, events) is archived — the owner's carve-out from §5.4 for this path only. Product reads skip an archived row; history keeps it | `projects.sanitize_single_room_topology` · `projects.project_stages.archived_at` / `comms.project_channels.archived_at` · `database/projects/Functions.md` § Stages |
| **Share link**             | `active → expired` (time) / `revoked` (**terminal**); also `exhausted` (download limit) | `files.share_links` (`expires_at` / `revoked_at` / `download_limit`) · `database/files/Functions.md` |
| **Stage settlement** (Decision #188) | `open` · `assigned` · `in_progress` · `submitted` · `revisions` are **unsettled**; `approve_stage` moves one to `paid` and `cancel_stage_fair_exit` to `cancelled`, both **terminal**. `approved` may still be approved (paid out) but not cancelled. `approve_stage` first completes every ticket still holding escrow on the stage through the guarded status path, so each lands `completed` with `payment_status` `released`, and a stage whose tickets were all paid on acceptance still settles (Decision #194). A prepaid escrow nobody has claimed (payee unbound, Decision #197) is never settled as work: `approve_stage` refuses (`55000`, "Nobody has been hired on this stage") a stage with no bound escrow, held or released, and on a stage that did hire it refunds each still-unclaimed ticket to its payer and leaves the ticket's status where it stands (`payment_status` back to `unpaid`), reporting `released_count` and `refunded_count` separately (Decision #213). `cancel_stage_fair_exit` settles every held escrow through the split first, then closes each ticket still standing on the stage (not `completed` / `cancelled` / `reported_hidden`) as `cancelled` — terminal, its assignee kept for the record, a `ticket_history` row with reason `fair_exit` — and cancels any paid revision round still `awaiting_payment`; the reviewer confirms against a server-computed preview of every tier (`projects.preview_stage_fair_exit`, Decision #198). Each door locks the stage row first and refuses (`55000`) a stage outside its set, so a second or racing settlement moves no money. `approved`, `submitted` and `revisions` are written by no function today | `stage_status` · `projects.approve_stage` / `projects.cancel_stage_fair_exit` · `database/projects/Functions.md` § escrow settlement doors |
| **Stage assignment**       | `pending_funding` (parked, nobody committed) → `assigned` → `accepted` → `completed`; `released` / `cancelled` / `declined` end it. `pending_funding → assigned` happens on publish (`set_project_status` draft → active) for every seat accepted while the project was a draft; a blueprint-instantiated draft's seats stay parked until funded (Decision #139). A seat is only ever created by an accepted invitation or application — one stage per acceptance, never every stage. **Free text, not an enum** — `projects.stage_assignments.status` carries no CHECK and no default, so every consumer reads it through a named guard rather than matching a literal, and an unrecognised value must fall to the SAFE side of whatever it gates | `projects.stage_assignments.status` · `packages/types/projects/setup.ts` (`countsAsOnboarded`) · `PRODUCT_SPEC.md` §Stage Management #4 |
| **Ticket funding scope**   | `unpaid` · `per_stage` (a set of paid stage ids) · `full` — an ATTRIBUTE the client's purchase sets, not a state machine: it never transitions on a move. What moves is the ticket, and "paid here" is RE-DERIVED from the stage it sits in (`ticketPaidHere`), so a per-stage ticket dragged into an unpaid stage reads Unpaid and leaves every freelancer's board with no write, and reads Paid again on the way back. Freelancers see a ticket only when it is paid where it sits AND they are onboarded to that stage (`providerCanSeeCard`, applied on the READ). The client's drag is locked while a claimed ticket is `claimed` / `in_progress` (`ticketWorkLocked`) — a gate over the §3.1 ticket states, not a new state | `TicketPaymentScope` · `packages/types/projects/board.ts` · `PRODUCT_SPEC.md` §Ticket Movement · root CLAUDE.md §8 Decision #94 |
| **Project invitation**     | `pending → accepted` (the seat is taken; a `freelancer` invitation only once the invitee is payout-ready, else it stays `pending` — Decision #196) / `declined` (the invitee's answer) / `expired` (time) / `revoked` (the inviter's act). `declined` starts a **48-day re-invitation cooldown** for that `(project, invitee)` pair, counted from `declined_at` — the fat service refuses a new invitation to that person on that project until it lifts, and the profile's Add-to-project rows render it locked with the date. `revoked` starts none. Outbound invitations are further capped per acting identity at 10 per sliding 10 minutes (`HIRE_RATE_LIMIT`) | `projects.project_invitations.status` / `declined_at` · `packages/types/projects/hire.ts` (`activeInviteCooldown`, `hireInvitationRefusal`) · `PRODUCT_SPEC.md` §The Hiring Process |
| **Project application**    | `pending → accepted` (the managing side confirmed the seat — `projects.assign_from_application`; an open seat moves `open → filled` only from `open`, so of two candidates accepted for one seat exactly one is seated and the other is refused `seat_filled`; a `closed` seat cannot be filled) / `rejected` (the managing side declined it — `projects.reject_application`, from the Members tab's Requests section — or another applicant filled that seat) / `withdrawn` (the applicant took it back — `projects.withdraw_application`, by the filer or a member who may bind the applying team; refunds one weekly proposal unit, never the buffer token, Decision #154). All three are **terminal**; only `pending` moves. Each application is metered against the applicant's proposal allowance on insert (the person's, or the team's when a team applies — `bind_seat`, two members). The managing side is staffing authority: the owner, the client business, or an appointed admin or manager (`can_manage_project_members`, Decision #145). Created by `projects.apply_to_project` against one stage, role or open seat, or by `projects.redeem_invite_link` against the link's stage (`invite_link_id` set — provenance, never a different state); a freelancer holds at most ONE pending application per target, and cannot apply to their own project or, through the listing, to one that is not `active` and listed. Applying, asking through a link and being accepted each need the payee payout-ready — KYC verified and a verified payout account; a team, every member with a share — re-checked at acceptance and refused `PK403 payout_not_ready` (Decision #196). The cover note opens the pair's DM in the owner's Requests folder (row below) |
| **Stage invite link**      | `active → revoked` (**terminal**). At most one `active` link per stage; a reset revokes it and mints a replacement in one transaction, so the old URL stops working first. Redeeming files a `pending` project application (row above) and never seats anyone; the link is refused on a closed project or a finished stage. Nothing is deleted | `projects.stage_invite_links.status` · `packages/types/projects/invite-links.ts` (`InviteLinkState`) · `PRODUCT_SPEC.md` §The Hiring Process · Decision #145 | `projects.project_applications.status` (`projects.application_status`) · `packages/types/projects/apply.ts` · `PRODUCT_SPEC.md` §The Hiring Process |
| **Inbox folder** (per participant) | `primary` ⇄ `requests` ⇄ `archived`, held on EACH participant's row, so the two people in a DM file it independently. A hiring request opens the thread in the recipient's `requests` (in `primary` when the two follow each other) and the sender's `primary` (`comms.send_request_message`); the recipient's own reply moves THEIR row `requests → primary` (`comms.fn_promote_thread_on_reply`), while the requester's follow-ups move nothing; the viewer moves their row freely (`comms.set_dm_inbox_folder`). `is_archived` is GENERATED from it, so the two cannot disagree | `comms.dm_participants.inbox_folder` · `packages/types/messaging/folders.ts` (`folderAfterSend`, `requestRouting`) · `PRODUCT_SPEC.md` §E. Direct & Group Conversations |
| **Link verdict**           | `pending → safe` / `suspicious` / `blocked` / `unscannable`. A completed scan is never `pending`; `unscannable` ("we could not check it") is deliberately not `suspicious` ("we found something"). A verdict is remembered per URL — an hour when safe, a day when flagged, ten minutes when unscannable — then checked again; only `safe` releases a page's title, description and icon | `LinkScanStatus` (`packages/types/files/assets.ts`) · `packages/backend/services/files/link-scan.ts` · `PRODUCT_SPEC.md` §E. Direct & Group Conversations |

> **A placeholder assignment is an ATTRIBUTE of a pending project invitation, not a state** — so
> it has no row either. A seller added to an UNPUBLISHED project from their profile is attached to
> the chosen stage(s) — at whatever those stages are priced at today, or at no stated price
> (`MemberInvite.placeholder`, `HireOffer.placeholder`);
> the invitation stays `pending` and expires like any other, and the terms are settled when the
> client prices and publishes. It is derived from the brief by `resolveHireOffer`
> (`packages/types/projects/hire.ts`) — never chosen by the caller — and a PUBLISHED project with
> an unpriced stage is refused rather than staged (root CLAUDE.md §8 Decision #108).
>
> **A dismissed record is likewise an ATTRIBUTE, not a state** (2026-09-21). `dismissed_at` records
> that the client took a `declined`/`expired` record off their Invitations list, or that
> `remove_project_member` retired an `accepted` one whose member was removed. The status underneath
> is untouched — a dismissed decline still starts its cooldown, because the cooldown read consults
> `declined_at` and never the dismissal (`ck_project_invitations_dismissed` keeps it off a `pending`
> row: an open offer is cancelled, never dismissed). The client's three acts on a record are decided
> by its status alone (`inviteActionFor`): cancel a pending offer (`→ revoked`), dismiss an answered
> or lapsed one, remove the freelancer an accepted one brought in. An invitee's answer has ONE
> implementation, `projects.fn_apply_invitation_decision`, reached by the invitee's own RPC and — in
> development only — by the Dev Tools Invites window, so a forced answer writes the same rows a real
> one does. Both grains of invitation emit `stage.invite` to the invitee; the answer emits
> `invitation.accepted` / `invitation.declined` to the inviter; an application emits
> `application.received` to the owner and, once its seat is confirmed, `application.accepted` to the
> applicant; a decline, including the automatic one a filled seat gives its other applicants
> (`reason: 'seat_filled'`), emits `application.declined` to the applicant, and a withdrawal emits
> `application.withdrawn` to the owner — all through `comms.fn_notify`, so the recipient's channel, quiet-hours, mute and
> digest preferences are the router's to honour. A refused re-invitation inside the cooldown names
> the instant it lifts (`details.reopensAt`, from the RPC's `reopens_at=` DETAIL).
>
> **Post-onboarding immutability is a CONSTRAINT over the stage-assignment row above, not a
> lifecycle of its own** — which is why it has no row. Once a seat has genuinely been taken, the
> engagement's **project type** freezes project-wide and each stage's **ticket price** freezes with
> that stage; a flat engagement freezes its single price on the first onboarding anywhere. Nothing
> else about a staffed stage locks. The rule is stated in `PRODUCT_SPEC.md` §Stage Management #4 and
> implemented once in `packages/types/projects/setup.ts`, which the form, the publish dialog and the
> write guard all read — a second copy is how a disabled control and a server refusal come to
> disagree about the same field. The shape half is also backstopped in the database
> (`projects.fn_project_shape_lock`, the same deny-list), so a write that bypasses the service is
> refused too (Decision #139). Note the deliberate asymmetry with the row above: `released`,
> `cancelled` and `completed` all END an assignment and all KEEP the lock, because the agreement
> existed and escrow may already have moved against it.
>
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
> **Four named caps govern it, and they are policy, not implementation details** (pinned by unit
> test in `coordination_test.ts`): `RESCHEDULE_LOCKOUT_HOURS = 12` — inside it nothing moves, because
> the other party has arranged their day around the slot; `VOTE_RESOLUTION_LEAD_HOURS = 12` — a vote
> closes that far before the EARLIEST slot on the ballot, so a ballot can never elect a time that has
> itself become unmovable, **or at the event's own lockout if that comes first**, so a vote on slots
> after the meeting is always decided while the meeting can still be moved (a ballot-only deadline
> let a round sit `voting` past the meeting and then move a session that had already happened);
> `MIN_VOTE_PROPOSALS = 2` — one option is an announcement, not a vote;
> `RESCHEDULE_PROPOSALS_MAX = 12` — a round holds at most twelve slots, approved or not, and a
> thirteenth is refused (`ballot_full`) until the round closes. The last is also held by the database
> (`scheduling.fn_cap_reschedule_proposals`, pinned to the constant by `coordination.contract.test.ts`),
> because a cap the table did not hold let a slot be stored that no reader would show.
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
> **On a 1-on-1 the party who did NOT offer a time is the one who accepts it**
> (`counterpartyAcceptRefusal`): the attendee accepts a host's slot once the host has put it to them
> (`awaiting_counterparty`), and the host accepts an attendee's slot directly, in either open state —
> the host's acceptance IS the approval that slot would otherwise wait for. Any slot is refused
> (`slot_inside_lockout`) once it has drifted inside its own notice period while waiting, and a stale
> attendee slot is never approved onto a live vote, where it would drag the deadline into the past.
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

> **The Project Creation wizard (2026-09-02) introduces no new lifecycle, and that is a finding
> rather than an omission.** Its five-tier field taxonomy — T1 Blocker · T2 Required-to-post · T3
> Recommended · T4 Nice-to-have · T5 Conditional, in `packages/types/projects/create.ts` — is **form
> logic**. It drives step progression, the publish gate and hint copy, and nothing else: it is not a
> status, no board column maps to it, and it is never rendered as five colours (the theme backs two
> gate ramps, not five). `hasStages` is derived (`structure_variation !== 'single_task'`) and never
> stored, so it cannot drift from the stage list a status gate actually counts. `nda_mode` is a
> contractual **term** with no transitions — an engagement does not move through
> `none → platform_standard → custom`; it is set, and it can be changed.
>
> **The one state rule it does add is a projection, not a machine.** An engagement's STORED
> visibility is `effectiveVisibility(requested, steps)`: the author's `public` request is honoured
> only once every `required` readiness step is done, and until then the row stays `unlisted` —
> reachable by its owner and by anyone holding the link, absent from Explore. It is recomputed on
> every write rather than transitioned, it is decided server-side (never on the client, which would
> be a client deciding its own reach), and a freshly created project has satisfied nothing, so it is
> never public whatever its control said. §3.1 is untouched and the two axes are orthogonal: a
> `draft` that is `unlisted` and an `active` that is `unlisted` are both legal, and visibility is not
> a delivery state. Canonical home: `packages/types/projects/setup.ts` (`effectiveVisibility`,
> beside the ladder it reads) · `documentation/flows/Projects.md` §5.

**Rules:** (1) these never appear as delivery-board columns (§6 maps only §3.1 states); (2) nothing
is hard-deleted — a retired verification/invoice/dispute goes to a terminal state, never a `DELETE`
(§5.4); (3) a change to any of these transitions updates its canonical home **and** this row in the
same change (§5.1). The build state-machine's own **Disputed** state and **Review/Escrow-Locked**
substates (§3.3) _mirror_ the product's escrow semantics but remain build-tracker states, not these.

### 3.6 Payment & work-start lifecycle (per ticket)

A product domain lifecycle in the §3.5 sense — **not** a board column, and its `Draft` is not the
§3.1 `Draft` nor `project_status = 'draft'`. It answers one question per ticket: _is the money held,
and may work start?_ The rule it encodes is root CLAUDE.md §8 Decision #165: **no hold, no work.**
Single-ticket funding is Decision #166, paid revisions #167. Canonical business text:
`PRODUCT_SPEC.md` §Escrow, Wallets & Finance #2 and §Purchase Methods.

```text
Draft ──(lock trigger, hold made)──────────────────────────────► Funded (escrow held)
Draft ──(lock trigger, hold refused)───────────────────────────► Needs funding
Draft ──(client prepays the ticket or its stage, no payee yet)─► Funded   (Decision #197)
Needs funding ──(wallet hold — payee now, or bound at claim)───► Funded
Needs funding ──(card Buy Now / stage card payment started)────► Payment processing
Needs funding ──(auto-fund: wallet credit covers it)───────────► Funded   (Decision #172)
Payment processing ──(webhook succeeded + lock locked)─────────► Funded
Payment processing ──(payment failed / lock refused)───────────► Failed
Payment processing ──(payer abandons)──────────────────────────► Needs funding
Failed ──(retry card)──────────────────────────────────────────► Payment processing
Failed ──(hold from the wallet the failed lock credited)───────► Funded
Funded ──(payee starts work)───────────────────────────────────► In progress
In progress ──(payee submits)──────────────────────────────────► In review
In review ──(changes requested)────────────────────────────────► In progress
In review ──(client approves)──────────────────────────────────► Released   (terminal per escrow)

Funded · In progress · In review ──(claim TTL expiry · cancellation · dispute refund ·
                                    fair exit's refund share)───► Refunded   (terminal per escrow)
Refunded ──(client re-pools the ticket)────────────────────────► Draft

Released ──(Chain Reaction: next required stage, hold made)────► Funded → In progress   (next stage's escrow)
Released ──(Chain Reaction: next required stage, hold refused)─► Needs funding           (next stage's escrow)
Released ──(next required stage, Fund on arrival off)──────────► Draft                   (next stage's escrow)
```

**Lock triggers** (when `Draft` is left): **One-Off / Task** — when the project or its first stage
begins (its seat is hired by then, so the escrow has a payee); **Pipeline** — at **claim**
(`PRODUCT_SPEC.md` §Escrow Lifecycle for Tickets is authoritative over the older "In Progress"
wording); **Sessions** — when the booking is confirmed. **Any ticket, earlier (Decision #197):** the
client may prepay a ticket or a whole stage (open, assigned or in progress) — the escrow is held with
no payee and the claim or assignment binds one (`finance.fn_bind_ticket_escrow`) without a second
charge. A prepaid escrow nobody claimed is refunded, never released. **Each later required stage of a
multi-stage ticket — the Chain Reaction (Decision #210):** when the client approves the ticket's
current stage (an accepted submission or `approve_stage`, both through
`projects.fn_settle_ticket_stage` → `projects.force_complete_stage`), that stage's escrow is
**Released**, the ticket moves to its next required stage, and the lock trigger fires there at once
when that stage's `project_stages.chain_reaction` is on (the default): a hold from the paying wallet's
live balance (no reservation) → **Funded**, the ticket stays `in_progress` with its payee; a refused
hold → **Needs funding** (`todo`, `fn_mark_needs_funding` with `trigger: chain_reaction`, auto-funding
as usual). With `chain_reaction` off the lock trigger does not fire: the ticket waits `todo` /
`unpaid` (**Draft**) for the client to fund it (`fund_ticket` / `fund_stage`). The approved stage is
paid in every case. Either wait tells the payee (`ticket.awaiting_funding`); each outcome is one
`ticket_history` row (`chain_held` · `chain_needs_funding` · `chain_off`, read as funding entries).

**Column lock (Decision #210)** — a DERIVED rule, never a stored column or a board column of its own:
the board refuses a drop that would carry a **claimed** ticket into a work column (`claimed` /
`in_progress` / `in_review`) from outside work while its escrow is not held (`workColumnLocked` in
`@projective/types/projects`, read from `BoardCard.funding.canStart`). It mirrors the work-start gate
on `trg_ticket_escrow_sync` (rule 1 below), which still refuses on the server. An unclaimed ticket is
never locked out — its drop is the claim, which is the lock trigger. While such a card is dragged the
refusing columns read locked with the reason (`KanbanBoard`'s `itemDropRefusal`); the Dev Context
Switcher's **Funding state** axis drives it.

**Auto-funding** (Decision #172, `PRODUCT_SPEC.md` §Escrow, Wallets & Finance #4): on a business
project in `from_wallet` mode a ticket entering Needs funding joins the auto-fund queue, and the
**system** moves it on the next wallet credit that covers it — held as the project owner (a spend
approval for the ticket first when it is over their spending limit or at or above the threshold,
spent once by the hold) — prepaid when nobody holds the
ticket yet (Decision #197).
In `add_to_basket` mode it is added to the business basket instead. Each act is a `ticket_history`
entry (`auto_fund_*`).

| State | Meaning | Who can act | What unlocks the next state | Stored as (today / planned) |
| :-- | :-- | :-- | :-- | :-- |
| **Draft** | No escrow is owed yet: the lock trigger has not fired and the client has not prepaid. | **Client side** (owner, admin, manager): price, publish, fund ahead — one ticket, or the whole stage (Decision #197). **Freelancer**: claim a ticket on their board (only paid, onboarded tickets are visible). | The client prepays, or the lock trigger fires. If the hold is made → **Funded**; if it cannot be made (no price, no payer wallet in the project currency, payer cannot cover it, and for a business payer: the project owner's spending limit, the approval threshold without an approval, or an unverified business — `finance.fn_assert_business_spend`) → **Needs funding**. | `payment_status = 'unpaid'` |
| **Needs funding** | The lock trigger fired and the hold was refused. The claim did **not** succeed; the ticket is off every freelancer's board. | **Client side only** — whoever may spend from the paying wallet (a business member funding it spends against their OWN envelope, through the business spend gate — KYB, envelope, threshold; the owner's own wallet for an individual client). Freelancers cannot act. | **Wallet hold** (top-up, then hold — prepaid when nobody holds the ticket, Decision #197) → **Funded**, on freelancers' boards again. **Card Buy Now** or a stage card payment started → **Payment processing**. | `payment_status = 'needs_funding'` — written by `projects.fn_mark_needs_funding` when a claim's or a chain's hold is refused; cleared by the next successful hold |
| **Payment processing** | A card payment (`inbound_payments`, purpose `escrow_lock`, scoped to this ticket by `ticket_id` under #166) is in flight. | **Nobody in the app**: only the signed Stripe webhook moves it. The payer may abandon. | Webhook `succeeded` **and** `lock_status = 'locked'` → **Funded**. Payment `failed`, or settled with `lock_status = 'failed'` → **Failed**. Abandoned → **Needs funding**. | `inbound_payment_status` `requires_payment` / `processing`; `lock_status = 'pending'` |
| **Failed** | The card payment failed, or it settled but the lock was refused (the money stays in the paying wallet, `lock_error` says why). **Not terminal.** | **Client side**: retry the card, or hold from the wallet the failed lock already credited. | Retry → **Payment processing**. Wallet hold → **Funded**. | `inbound_payment_status = 'failed'` or `lock_status = 'failed'` |
| **Funded (escrow held)** | Escrow is held for this ticket — with its payee, or PREPAID with none until a claim binds one (Decision #197). A prepaid ticket is on freelancers' boards; claiming it charges nothing more. | **Freelancer / team (payee)**: start work. **Client side**: may no longer drag the ticket (`ticketWorkLocked`). **System**: the claim TTL. | Payee starts → **In progress**. An unstarted claim past `claim_ttl_minutes` → **Refunded** (`fn_release_expired_claims` → `fn_refund_ticket_escrow`, ticket reset to `backlog` / `unpaid`). | `finance.escrows.status = 'held'`; `payment_status = 'escrow_funded'`; `ticket_status` `claimed` |
| **In progress** | Work under way against held money. | **Payee**: deliver, submit. **Either party**: raise a dispute (funds go `on_hold`, §3.5 Fund state). | Submit → **In review**. Cancellation / fair exit → **Refunded** (the refund share) and **Released** (the payee's share); a fair exit also closes the ticket as `cancelled` (Decision #198). | `ticket_status = 'in_progress'` |
| **In review** | Delivered; awaiting the client's verdict. A **paid revision** (#167) bought here adds its own held escrow to the ticket, at the stage's frozen extra-round price, only after the free rounds are used (§3.7). | **Client side** (review authority): accept, request changes, buy a paid revision. **Payee**: wait / respond. | Submission accepted → **Released**: the ticket moves to `completed` through the guarded status path and its held escrow is released (Decision #194); approving the stage does the same for every ticket still held. Changes requested → **In progress** (escrow stays held). Dispute upheld for the client → **Refunded**. | `ticket_status = 'in_review'` |
| **Released** | Escrow paid to the payee less the platform fee; the payee's money then follows the §3.5 Fund state (`locked → pending → available`). Terminal for this escrow. A Pipeline approval locks the escrow for the ticket's NEXT required stage (the Chain Reaction, Decision #210), which starts **that** escrow's lifecycle — Funded, Needs funding, or Draft when the next stage's Fund on arrival is off. | Nobody (terminal). | — | `escrows.status = 'released'`; `payment_status` `released` (a completed ticket — every acceptance and stage approval completes the ticket first, #194) / `partially_released` (an earlier installment of a multi-stage ticket, or a payee removed mid-work) |
| **Refunded** | The held amount (or the fair exit's refund share) is back in the payer wallet; no fee is charged on a refund. Terminal for this escrow. | Nobody (terminal). The client may re-pool the ticket. | A re-pooled ticket starts again at **Draft**. | `escrows.status = 'refunded'`; `payment_status = 'refunded'` |

**Rules.** (1) A claim never succeeds on an unheld ticket: `fn_hold_ticket_escrow` refuses with
`PF402` (`needs_funding` + reason + amount), and no path enters `claimed` / `in_progress` /
`in_review` from outside work without a held escrow (the gate on `trg_ticket_escrow_sync`, #165). (2) The money that funds a hold always comes from a wallet; a card payment tops the
wallet up first (Decision #125). (3) `Failed` is never terminal; `Released` and `Refunded` are
terminal **per escrow**, not per ticket. (4) A dispute is a hold on the funds (Fund state `on_hold`),
not a state of this machine. (5) Nothing here is hard-deleted (§5.4). (6) **Released** and **Refunded**
are reached **exactly once** per escrow (Decision #188): every release, refund and fair-exit split
locks the escrow and flips it only while it is still `held`, so two concurrent settlements never pay
or refund twice.

**How it is built (#165).** One pure derivation, `deriveFundingState(ticket, escrow, inboundPayment)`
(`packages/backend/services/finance/funding-state.ts`, schema `FundingStatusSchema` in
`@projective/types/finance`), returns `{state, amountMinor, currency, amountLabel, canStart, nextAction,
reason}` and is stamped server-side on the board card (`BoardCard.funding`), each stage
(`BoardStageRef.funding`, a roll-up), the overview's assignments and roll-up, and the project detail —
so every surface reads one answer. `canStart` is true only in **Funded**. A pending card payment is
polled at `GET /api/finance/payments/[id]/status`. Notifications: a refused hold tells the client
(`escrow.needs_funding`, with the reason and amount); a hold tells the payee "Funded — you can start"
and the client (`escrow.funded`). Since Decision #197 a hold needs no payee: funding an
unclaimed ticket or a whole stage holds the escrow prepaid (`finance.escrows.payee_id` NULL) and the
claim binds it, so the former **Needs funding → Draft** edge is gone. A stage card payment covers every
unfunded ticket in its stage, so the board reads it as **Payment processing** for each of them. The Dev Context Switcher's **Funding
state** axis (`fundingState`) substitutes the rendered state.

### 3.7 Revision round lifecycle (per round)

A product domain lifecycle in the §3.5 sense (Decision #167), stored as
`projects.stage_revision_requests.status` under a CHECK. One row per round a client sends back; the
submission's own `stage_submissions.status` keeps its four states and the mapper below names them.

```text
(free round requested, allotment left)  ───────────────────────► Open
(round past the allotment — "Buy a revision") ─────────────────► Awaiting payment
Awaiting payment ──(Buy Now settles: escrow held on the ticket)─► Open
Awaiting payment ──(the submission is accepted or a free round opens)► Cancelled (terminal)
Open ──(the freelancer resubmits on the ticket)────────────────► Resolved (terminal)
```

| State | Meaning | Who can act | What unlocks the next state |
| :-- | :-- | :-- | :-- |
| **Awaiting payment** | A paid round is raised at the stage's frozen extra-round price; nothing has been sent back. The submission stays `pending_review`. | **Client side** (review authority): pay — from the wallet or by card straight from the review, or through the basket's `paid_revision` line (Decision #199) — or decide the submission instead. | Payment holds the round's escrow → **Open**. A verdict on the submission → **Cancelled**. |
| **Open** | The work is back with the freelancer (`revisions_requested`, ticket `in_progress`). A paid one is funded: "Paid revision, funded, you can start." | **Payee**: revise and resubmit. | `submit_deliverable` (or `send_submission_draft`) on the ticket → **Resolved** (`resolved_at` set; the new submission's `revision_of` names the one sent back). |
| **Resolved** | Revised work was resubmitted. Terminal. | Nobody. | — |
| **Cancelled** | A paid round abandoned before payment. Terminal; no money moved. | Nobody. | — |

**The cap.** A stage's free rounds are `project_stages.file_revisions_allowed` (`NULL` = unlimited;
copied from the blueprint and frozen on a blueprint engagement); `revisions_used` counts the free
rounds taken, inside `review_submission` under the stage's row lock. A round is free while the
allotment is unlimited, not used up, or the extra-round price is `0`; past it `review_submission`
refuses with `PR402 paid_revision_required` and the price. A bought round never consumes the
allotment. **Spelling:** the submission status is stored `revisions_requested` and spoken
`revision_requested` in Zod; the one mapper (`toSubmissionStatus`, `live-support.ts`) translates,
and the database spelling is kept (renaming it would touch the CHECK, the standing and nav-activity
functions and the seeds for no behaviour change).

### 3.8 Dispute lifecycle (per dispute)

A product domain lifecycle in the §3.5 sense (Decision #212), stored as `finance.disputes.status`
(the `dispute_status` enum). One row contests ONE held escrow; today the only door that opens one is
a session attendee's **no-show claim** (`projects.claim_session_no_show`). It is not the §3.1
`Disputed` build state and not a card chargeback (§3.5 Chargeback). Canonical business text:
`PRODUCT_SPEC.md` §Dispute Resolution (Evidence Vault, the 48-hour cooling-off, the auditor, the
session attendance audit) and §Session-Based B/D.

```text
(attendee reports a no-show, sitting started, seat escrow held) ───────────► Open
Open ──(sitting ends: logs show the provider never joined in time)──────────► Resolved — refund
Open ──(sitting ends: both in a tracked room ≥ 80 % of it — claim dismissed)► Resolved — release
Open ──(sitting ends: logs ambiguous or the room untracked)─────────────────► Awaiting response
Awaiting response ──(the provider responds with their account/evidence)────► Under review
Awaiting response ──(either party escalates)────────────────────────────────► Under review
Awaiting response ──(respond_by passes — 48 h, the auto-escalation)─────────► Under review
Open | Awaiting response | Under review ──(a platform operator rules)───────► Resolved — release | refund | split
Open | Awaiting response | Under review ──(the escrow settled on another path)► Resolved — as it settled
```

| State | Meaning | Who can act | What unlocks the next state |
| :-- | :-- | :-- | :-- |
| **Open** | The claim is raised and the seat's payment is held; the room's logs are not complete until the sitting ends. | **Either party**: add statements and evidence. **Operator**: rule. | The sitting ends → the attendance audit (`finance.fn_advance_dispute`, at once on a claim after the end, else the 15-minute sweep). |
| **Awaiting response** | The logs did not settle it. The provider is asked to respond by `respond_by` (`dispute_response_hours`, 48). | **Respondent** (the provider — owner or active team member): respond. **Either party**: escalate. **Operator**: rule. | The respondent's statement, an escalation, or the deadline (the sweep) → **Under review**. |
| **Under review** | A Projective auditor (an `ops.admin_users` operator) reviews the Evidence Vault from the operator desk (`/admin/disputes`). The payment stays held. Entering it stamps the review SLA `review_by` (`dispute_review_hours`, 72) — a target, never a transition: past it the case is **not** ruled; the sweep alerts ops and every operator (`dispute.review_overdue`, at most once a day) until somebody rules. | **Either party**: add evidence. **Operator**: rule. | `finance.resolve_dispute` → a Resolved state. Nothing else — not the SLA. |
| **Resolved — release** | The claim was dismissed (by the audit or the auditor): the provider is paid. A whole-cohort seat with sittings still ahead is NOT paid early — it follows its normal release after the last sitting. Terminal. | Nobody. | — |
| **Resolved — refund** | The claim was upheld: the payment went back to the attendee. Terminal. | Nobody. | — |
| **Resolved — split** | An auditor divided the payment: the provider's share (less the platform fee) and the rest refunded. Terminal. | Nobody. | — |

**Rules.** A dispute is **never deleted** and a resolved one is **final** — enforced by trigger for
every role (§5.4); statements and evidence are append-only, and an evidence file cannot be deleted
while its case is live. At most one live dispute per escrow. While a dispute is live the escrow is
not released by any path (`finance.fn_escrow_has_open_dispute`). The seat follows its money: a refund
ends it `cancelled`, a release or split `completed`, once nothing else is held on it. A provider
cannot open a no-show claim: an attendee who does not come is paid out to the provider anyway
(PRODUCT_SPEC §Session-Based C, Time Protection), so the provider's side of the lifecycle is the
response.

### 3.9 Feedback idea lifecycle (per idea)

A public feedback-board idea (`/feedback` and the `?feedback=open` drawer, Decision #272) moves on
the **§3.1 state-machine itself** — owner ruling (d), 2026-10-17 — not on a domain lifecycle of its
own, so no new status exists: the board stores the unified state and only its **label** differs.
Stored as `community.feedback_ideas.status` (a CHECK over the five values), with every move appended
to `community.feedback_status_events`. Canonical rules: `documentation/database/community/`.

| Stored state (§3.1) | Board label | Who sees it | Votes |
| :-- | :-- | :-- | :-- |
| **Backlog** | Under review | Its author and platform operators only | Open (the author's own vote is cast with it) |
| **Ready / Refined** | Planned | Everyone, guests included | Open |
| **In Progress** | In progress | Everyone | Open |
| **Complete** | Shipped | Everyone | Closed |
| **Archived** | — (never listed) | Platform operators only | Closed |

```text
(a signed-in person suggests an idea) ───────────────────────────────────────► Backlog
Backlog ──(an operator accepts it onto the roadmap — it becomes public)──────► Ready
Backlog ──(declined, a duplicate, or withdrawn)──────────────────────────────► Archived
Ready ──(work starts)────────────────────────────────────────────────────────► In Progress
Ready ──(sent back for review)───────────────────────────────────────────────► Backlog
In Progress ──(it ships)─────────────────────────────────────────────────────► Complete
In Progress ──(paused before shipping)───────────────────────────────────────► Ready
Ready | In Progress | Complete ──(retired)────────────────────────────────────► Archived
```

**Rules.** Draft, Claimed, Review and Disputed are not used — an idea has no owner to claim it and no
deliverable to review. Only an operator (`ops.admin_users`) moves an idea, through
`community.set_feedback_idea_status`, and only along the moves above (`fn_feedback_move_legal`);
**Archived is terminal and non-reopenable**, and a shipped idea that regresses is a new idea. Nothing
is hard-deleted (§5.4): an idea refuses `DELETE`, and its history is append-only. Every move
notifies the author and everyone who voted (`feedback.status_changed`), never the operator who made
it. Content screening (Decision #148) is not built, so Backlog is the publication gate: a new idea is
public only once an operator moves it to Ready.

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
One owner-approved carve-out: a stage or project room retired by a type switch to a Task or Session
is hard-deleted only when it carries no history at all, and is otherwise archived (`archived_at`) —
Decision #163 (§3.5 row "Stage / project room retirement").

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
