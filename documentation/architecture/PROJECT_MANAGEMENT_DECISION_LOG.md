# Project Management & Execution — Decision Log (2026-10-29)

> **Evaluation, not binding.** Companion to
> [`PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md`](PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md), whose
> abbreviations and finding ids (F1–F5, X1–X19) this file reuses. It covers three gap families the
> audit was asked to trace — ticket state synchronisation (§1), circular stage dependencies (§2) and
> Workload Intensity dispute resolution (§3) — and then the product and architecture decisions that
> need a founder's ruling (§4). §5 is **Decision #338** as recorded in
> `reference/decisions/decisions-122-126.md`. Nothing here is ruled; under root `CLAUDE.md` §8 a
> contradiction between source docs is flagged, logged and decided by a human.

---

## 1. Ticket state synchronisation gaps

A ticket's truth is spread over five records that must agree: `tickets.status` and its assignee, the
stage it sits in, its submissions, its escrows and its workload report. PM §3.4 asks that a parent's
status be **derived**, never stored authoritatively. The gaps below are the places where two of those
records can disagree.

| # | Gap | Where | What a user sees | Recommendation |
| :-- | :-- | :-- | :-- | :-- |
| S1 | **The claim TTL never fires.** The sweep is not registered (X7) | J5060; F1140:652-686 | A parked claim holds the client's money and the freelancer's $W_i$ indefinitely. PM §3.6's "Funded → Refunded on TTL" edge does not exist in production | D1 |
| S2 | **The sweep can reset started work.** No row lock and no `status = 'claimed'` re-check on its UPDATE | F1140:663-676 | **(I)** a ticket started between the sweep's SELECT and UPDATE has its escrow refunded and is thrown back to `backlog` while the freelancer works | `SELECT … FOR UPDATE SKIP LOCKED` and `AND status = 'claimed'` on the UPDATE; a `ticket_history` `claim_expired` row; notify both sides |
| S3 | **Stage status is stored, not derived, and goes stale.** Nothing writes `submitted`, `approved` or `revisions`; a stage reaches `paid` while unfunded or backlog tickets stay open on it (`approve_stage` settles only tickets holding escrow); review authority may write any status directly (X19) | F1150:912,1225,1633; P2011:282-284 | stage badges that disagree with the board under them | derive a stage's display status from its tickets (PM §3.4's rule), keep the stored column for the money doors only, and take direct writes of it away from the table policy |
| S4 | **Submissions are orphaned.** Nothing closes a `pending_review` submission when its ticket leaves review through `move_ticket` or `complete_ticket`; the placeholder trigger skips when a pending one exists | F1120:261-326 | a stale "awaiting review" in the explorer and in `get_project_card_summary.pending_submissions` | close the open submission (`superseded`, or the existing `revisions_requested`) in the same trigger that files the placeholder |
| S5 | **`delete_stage` leaves work without a stage**, and rolls its releases back when escrow history exists (X16) | F1130:395-445 | a ticket `in_progress` with no stage; a delete that silently does nothing | refuse first, release second; move orphaned tickets to `backlog` with their escrow settled |
| S6 | **The Task invariant holds at insert only** (F2) | TR1850:61-69 | a Task that converted from a pipeline still lists several tickets | re-run `fn_enforce_structure_variation` on `UPDATE OF structure_variation`, and refuse the switch while it would break |
| S7 | **Partial commits from TS** (`commitTicketRow`, `applyProjectUpdate`) | LW:2025-2117, 2480-2509 | "Saved" over a half-applied form | one transactional RPC per save, as LW:1715-1718 already proposes |
| S8 | **Last writer wins** on moves; the board's rollback can undo a second in-flight move | PBS:3015; `ProjectBoard.island.tsx:648-672` | a card that jumps back after a refused drag elsewhere | send `updated_at` with each move and refuse a stale one (409); queue moves per card in the island |
| S9 | **Stub ≠ live** for claim, move and ticket commit (§4.1 of the audit) | PBS:2963-3110 | `dev:mock` demos rules the product does not hold | route the stub through the same pure predicates the SQL mirrors (`isSelfClaimable`, `ticketWorkLocked`) |
| S10 | **A suspension can outlive its report.** With no expiry sweep a ticket stays `reported_hidden` past `hidden_until`; the client can lift it by a move that skips `fn_resume_reported_ticket` (#293 (e)) | F1110:258-266 | a ticket nobody can work | D5 |
| S11 | **The chain reads unvalidated jsonb.** `required_stages` may name another project's stage; a ticket price overrides every stage price in its chain (X13) | F1130:644-768; F1200:384 | **(I)** a hold priced or placed against the wrong stage | validate `required_stages` on write (ids in the project, unique orders); decide whether a ticket price is per stage or per ticket (D2's sibling, logged as flag (k)) |
| S12 | **Direct-table claim** (X12) | F1110:281 | an assignee who never passed the capacity, age or payout gates | the guard sends assignee changes on unclaimed tickets through `fn_assign_ticket_core` |
| S13 | **`payment_status = 'refunded'` is documented, never written** | PM:490; F1200 refund path | — | correct PM, or write it; the funding state reads it either way |

---

## 2. Circular stage dependencies

**What exists.** A stage has one `start_dependency_stage_id` (self-FK, NO ACTION) with
`start_dependency_lag_days`, a `start_trigger_type` (including `dependent_on_stage`) and a `parallel`
flag (T15:268,296-300,385). Separately, each ticket carries its own route through stages as
`required_stages` jsonb `[{stage_id, order}]`.

| # | Finding | Source |
| :-- | :-- | :-- |
| C1 | **No cycle prevention in the database.** Only a self-loop is refused, in TS (`validateUpdate`, LW:1731-1737), and the setup form's Zod `wouldCycle` (`types/setup.ts:386`) covers the form alone. A → B → A is storable through the `create_project` payload, a direct UPDATE under the stages FOR ALL policy, or two separate saves. `database/projects/Tables.md:996-998` admits it | LW; P2011:282-284 |
| C2 | **Cross-project dependencies.** `create_stage` checks that the dependency is a stage of the same project, and says why — the FK names the table, not the project, and the reference discloses that the foreign stage exists (F1130:271-282). `create_project`'s second pass does not check the target (F1100:430-436), and neither does a direct UPDATE | F1130; F1100 |
| C3 | **Dependencies drive nothing.** No function reads `dependent_on_stage` or the dependency: no stage ever starts because its predecessor finished. The Timeline draws them as links only (`types/timeline.ts:260-277`). A cycle today renders as crossed arrows and breaks no scheduler — but the setup form collects a dependency and a delay per stage (PS:2325) that do nothing, the gate §3.11 failure at configuration scale | grep of all migrations; `flows/Projects.md` |
| C4 | **`fn_stage_delete_cascade` does not null dependants**, though Tables.md:237-239 says it does, so a direct DELETE of a depended-on stage fails on the FK. The `delete_stage` RPC and `sanitize_single_room_topology` null them themselves | F1130:86-111, 424-427, 556-557 |
| C5 | **The ticket's own route is unvalidated.** `required_stages` is not checked for project membership or duplicate orders, and the Chain Reaction follows it (S11) | T15:436; F1130:644-768 |
| C6 | `start_trigger_type = 'dependent_on_stage'` does not require a dependency id; no CHECK pairs them | T15:296-300 |

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

---

## 3. Workload Intensity reporting — dispute resolution

**What is built (Decision #290).** The engine is complete in SQL (F1140:7-190):
`ticket_workload_reports` with statuses `open · acknowledged · adjusted · expired_penalized ·
dismissed_bad_faith`; a filing trigger that accepts only a `claimed` or `in_progress` ticket and
suspends it as `reported_hidden` for 48 hours with its payee and escrow kept; `trg_adjust_workload_report`
when the client raises $W_i$; the expiry sweep `fn_resolve_expired_workload_reports`; and the audit
`fn_flag_bad_faith_report`. The immutability guard keeps the reporter from changing the ticket while
the report is open.

**What stops it working.**

| # | Gap | Source | Spec it breaks |
| :-- | :-- | :-- | :-- |
| W1 | **Unreachable.** No Zod schema, service, route or control. `file_workload_report` and `fn_flag_bad_faith_report` have no `authenticated` grant (G2510; the schema-wide revoke at `:44` makes an ungranted function unreachable). The only way to file is a direct INSERT under the "File workload report" policy (P2011:398), which no client makes | grep of `packages/`, `apps/web` | PS:2249-2265 entire |
| W2 | **The 48-hour window never closes.** The expiry sweep is not registered (#290 (a); `SYSTEM_ARCHITECTURE.md:2423-2427`) | J5060 | PS:2260-2262 |
| W3 | **Only the client is penalised** on non-response, and both penalty severities default to `0` (`freelancer_bad_faith_penalty`, `client_no_adjust_penalty`, `00005001:32-35`), so neither penalty has any effect | F1140:165-176 | "both parties incur a penalty"; "ranking reduction on the Explore page" |
| W4 | **A settlement leaves the report open.** Approving, Fair-Exiting or removing the freelancer during the window leaves it `open`, and the sweep later penalises the client for not adjusting a ticket they settled (#290 (d)) | F1140 | PS:2267-2269 |
| W5 | **Only the owner can answer.** A business's other reviewers can neither see the suspended ticket nor raise its $W_i$ (#290 (e)) | P2011 _View tickets_ / _Manage tickets_ | PS §Clients & Businesses (any reviewer is the client) |
| W6 | **The client can lift a suspension by a move**, skipping `fn_resume_reported_ticket` and leaving the report open (#293 (e)) | F1110 | PM §3.6 rule 7 |
| W7 | **Reporting frees capacity.** `check_ticket_capacity` skips `reported_hidden`, so the reporter, who still holds the ticket, can claim more work during the window. That pays for filing | F1140:272,284,344 | PS:2040 ($W_i$ is a sum over tickets **held**) |
| W8 | **No moderator.** PS:2263 lets "a moderator or the client" dismiss a report; `fn_flag_bad_faith_report` is service-role only and the operator desk (`/admin/disputes`) handles `finance.disputes` alone | `features/admin` | PS:2263-2265 |
| W9 | **The disputed number is not the spec's number.** $W_i$ is built from difficulty alone (X5), so a freelancer disputes a figure the CREATE category never shaped | LW:2257-2267 | PS:1998-2021 |
| W10 | `acknowledged` is never written; no unique index allows only one open report per ticket | F1140; `00004003` | PS:2255 ("one at a time") |

**Minimum to ship it (if D5 rules "now").** A `WorkloadReport` Zod schema; `fileWorkloadReport` and
`answerWorkloadReport` on `ProjectBackendService` returning `ServiceResult`; `POST
/api/projects/ticket/workload-report`; the assignee's "Report workload" in the ticket modal and the
reviewer's "Raise $W_i$" beside it; a grant on `file_workload_report`; the sweep registered; W3, W4, W5
and W7 fixed in `00001140`; a partial unique index `WHERE status = 'open'`; the Dev Context Switcher
axis for a suspended ticket (root `CLAUDE.md` §5).

---

## 4. Decisions for founder review

Each decision states the conflict, the options and a recommendation, tested against the pitch: a
structured, stage-based micro-agency marketplace that wins trust where Upwork and Fiverr lose it.

### D1 — Turn on the claim-TTL and workload-report sweeps

> **Status 2026-10-30:** ruled (Decision #338, ruling Q0.3). The claim-TTL sweep is registered
> paused in `00005060` until PM-WP1 hardens it; the workload-report sweep waits for PM-WP5.

- **Conflict.** PS:1989-1994 and PS:2258-2262 promise both clocks; neither is scheduled
  (`SYSTEM_ARCHITECTURE.md:2423-2427`, "awaiting a human", Decision #203 (a), #290 (a)).
- **Options.** (A) Register both now, after S2's hardening. (B) Keep them off until notifications for
  both outcomes exist.
- **Recommendation: A**, every 15 minutes, with S2's lock and re-check, a `ticket_history` row and
  notifications (`ticket.claim_expired` to both sides). Ticket parking is the low-trust behaviour the
  pitch exists to remove, and locked client money with no work behind it is the most expensive
  signal a marketplace can send.

### D2 — What Fair Exit pays

- **Conflict.** `finance-model.md` §3 derives the split from elapsed stage duration: < 25 % → 0 to
  the freelancer, 25–75 % → 50 %, > 75 % or a final submission → 100 %. The build lets the **paying
  client** choose 25, 50 or 75 % (X14, #198 (f)). The payer will choose 25 every time, and there is no
  project-side dispute to contest it: PM §3.8's only dispute door is a session no-show claim.
- **Holes in the spec itself.** (a) Duration is measured against `stage.deadline`, but PS:327-328 makes
  an end date optional, so a stage with no deadline has no duration. (b) A multi-stage ticket on the
  ended stage is cancelled outright and its later stages never run (#198 (b)).
- **Options.** (A) Build the spec: the server derives the tier, the client confirms. (B) Keep the
  chooser, but make the derived tier a floor the client may only raise, and let the payee contest
  through the Evidence Vault. (C) Amend the spec to the built model.
- **Recommendation: B now, A when deadlines are reliable**, and rule (a): with no deadline, fall back
  to the submission evidence (a submission on file → 50 %, an accepted one → 100 %). (C) hands the
  payer the gavel and invites the Upwork comparison the pitch is built against.

### D3 — Removal and deletion pay the freelancer 100 %

- **Conflict.** A ticket whose freelancer is removed, or which the client deletes, releases its whole
  escrow to the freelancer, even while it is still only `claimed` and no work has started (F1110:384-387;
  F1120:77-79; PS:2232-2245). The same parked claim left for 24 hours is refunded to the client in full
  (PS:1989-1994). Acting on a stalled freelancer is therefore dearer than waiting, and a pipeline has
  no ticket-level exit at all — Fair Exit is stage-wide.
- **Options.** (A) Keep the spec. (B) Before `in_progress`, removal and deletion refund the client,
  mirroring the TTL; from `in_progress`, apply the D2 split at ticket level. (C) Add a ticket-level
  Fair Exit door.
- **Recommendation: B with C.** It removes an incentive to wait out bad work, and it keeps the
  freelancer whole for work genuinely under way. It changes PS §Deletion Protocol and §Freelancer
  Removal Mid-Ticket in the same change.

### D4 — Hard deletes against "nothing is hard-deleted" (new contradiction)

- **Conflict.** PS §Deletion Protocol and §Stage Deletion allow deletion. PM §5.4 and root `CLAUDE.md`
  §5 forbid hard deletes, with one carve-out (#163, rooms with no history). The build hard-deletes
  tickets (`delete_ticket`), stages (`delete_stage` without escrow history, and the stages FOR ALL
  policy) and projects ("Users can delete own projects", P2011:175). `ticket_history` and
  `ticket_workload_reports` cascade away with a ticket, so the evidence the Reliability Index and the
  Evidence Vault rely on is destroyed. A ticket with a submission cannot be deleted at all (X15).
- **Recommendation.** Extend #163's carve-out exactly: a hard delete only for a ticket or stage that
  was never claimed, funded or submitted against; everything else archives. Tickets gain `archived_at`
  under the `ck_projects_archived_at` idiom (edited into T15, with the Zod row and Tables.md in the same
  change); the project DELETE policy goes, since `archived` is already the soft delete. PS's wording
  becomes "delete (archive once anything happened)".

### D5 — Workload reporting: ship it, or mark it Planned

- **Conflict.** PS describes a live dispute mechanism; nothing reaches it (§3).
- **Options.** (A) Ship the §3 minimum. (B) Mark PS §Dispute Mechanism "Planned", keep the SQL, and
  close W7 now (it already distorts capacity).
- **Recommendation: B for MVP, A before the agency tier.** The claims rule the landing applies (#281)
  is the right standard for the spec too: a promise the product cannot keep reads worse than an
  honest "Planned". W7 is fixed either way.

### D6 — Assignment routing in the MVP

- **Conflict.** PS:2046-2069 sells four modes from a Staffing control; three are unreachable (X6).
- **Recommendation.** Mark round robin and parallel stream **Planned** in PS and ship `open_pull` plus
  manual, **unless** the agency-scale work (#252) needs round robin for team fairness, in which case
  grant the three RPCs to `authenticated` (they already check `can_review_project`) and build the
  control.

### D7 — Do stage dependencies drive anything?

- **Conflict.** The form collects a dependency and a delay per stage; nothing acts on them (C3).
- **Options.** (A) An engine: a stage whose predecessor completes opens (and, with `chain_reaction`,
  funds) on its own. (B) Presentation only: the Timeline's arrows, with the form saying "shown on the
  Timeline" rather than implying automation.
- **Recommendation: B now, with §2's guard either way.** (A) needs the cycle guard first, and its money
  consequence (an automatic hold on a dependency) belongs with the Chain Reaction, not beside it.

### D8 — Kanban at scale

- **Correction.** The brief assumed the board was Canvas2D; it is DOM, by contract.
- **Recommendation.** Keep it DOM: drag-and-drop, focus order and screen-reader semantics are what a
  Canvas board would have to rebuild. Window each column (render the visible cards plus a margin) once
  a column passes a measured threshold, inside `@projective/ui/kanban` so every board inherits it.
  Measure first: no pipeline in the seed has a column large enough to justify it today.

### D9 — Store the CREATE category

- **Conflict.** PS defines $W_i$ = CREATE weight × difficulty; no stage stores a category (X5), so the
  formula, the CREATE mastery track (PS §Standing) and the reporting dispute (W9) all lack their input.
- **Recommendation.** Add `project_stages.create_category org.create_category` (edited into T15; the
  enum exists), the six weights as `security.platform_params` (one dial each, `finance-model.md` style),
  and compute `tickets.workload_intensity` in SQL at commit, with a CHECK, instead of in TS
  (LW:2257-2267). Existing tickets keep their stored figure.

### D10 — Who sees an unsent draft

- **Conflict.** Reviewers can read a submitter's unsent drafts (`resolveIsolation`); the code marks it
  as an open decision.
- **Recommendation.** A draft is the submitter's (and their team's) until sent. Reviewers watching
  half-finished work undermines the "review against the checklist" contract (PS:57-58).

### D11 — Which views each type answers

- **Conflict.** PS:373-374 gives a Task no Board; the route renders one. The One-off matrix (#134)
  omits the stage `tasks` board; the route renders one.
- **Recommendation.** Answer as the Timeline guard does: a 303 to the page the view would have been
  part of. One helper beside `taskAbsentViewRedirect`, driven by `CHANNEL_TAB_MATRIX`, so the header
  and the route can never disagree again.

### D12 — Who moves an unclaimed ticket (#293 (c), (d); #294 (b))

- **Open since 2026-10-17.** Any participant can move an unclaimed ticket, including a paid one into
  an unpaid stage (hiding it from everyone) or a prepaid one into `in_review` with no assignee. The
  board's client seat (`viewerIsClientOf`, which includes a project `admin`) is wider than review
  authority, and the board does not yet use the ticket-manager grant.
- **Recommendation.** Unclaimed moves belong to review authority and granted ticket managers, the
  same set that may write the ticket (#294).

### D13 — Board view state in the URL

- **Recommendation.** `?view=list`, `?group=status`, `?q=`, `?sort=` and `?dir=` on `/board` and the
  stage `tasks` route, read server-side, with ROUTING.md updated in the same change. Members `?view=`
  and the lane's `?dir=` (#323) are the precedent.

### D14 — Addresses inside the Submissions tree

- **Conflict.** Tree segments are uuids (audit §2.2); #88 says uuids do not route.
- **Recommendation.** `stg-` slug · the submitter's handle · the submission's per-stage `number`.
  `number` needs its missing UNIQUE (`project_stage_id`, `number`) first (audit §5.1). No new slug
  prefix is minted.

### D15 — The Global Workload Kanban

- **Conflict.** PS:279-288 describes a cross-project board (Proposals sent · Ready · In progress ·
  Complete); nothing builds it.
- **Recommendation.** Mark it Planned in PS. When built, it is a read over `check_ticket_capacity`'s
  sums and `get_workload_capacity`, on `@projective/ui/kanban`, read-only.

### D16 — Still open from earlier logs (restated, not re-ruled)

- The deadline bonus: +10 % appears in no source-of-truth doc, and PS gives it to one-offs while the
  build makes it pipeline-only (`flows/Projects.md` §4.4).
- `due_date` is not locked after a claim, for either party (#291 (c)).
- A Fair Exit notification reaches the owner and the acting reviewer, not every billing member (#198
  (e)).

---

## 5. Decision #338 — as recorded

Recorded as a row in `reference/decisions/decisions-122-126.md` with its index line in
`reference/decisions/README.md`. Every flag is open until a founder rules on it, except the parts
that needed no ruling, closed on 2026-10-29: (i) in full; the price half of (j); and Submit and
Upload from (m). Delete Submission is withdrawn until (d) is ruled, and the ticket Copy link stays
open.

> **#338** Project management & execution audit — flags for a human (2026-10-29). Audit in
> `architecture/PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md`; rulings sought in
> `architecture/PROJECT_MANAGEMENT_DECISION_LOG.md`. No code changed. FLAGS:
> (a) the claim-TTL and workload-report sweeps are still unregistered, and the claim sweep can reset
> started work (D1, S2; re-raises #203 (a), #290 (a));
> (b) Fair Exit pays a client-chosen 25/50/75 % where `finance-model.md` §3 derives 0/50/100 % from
> elapsed duration, and a stage with no deadline has no duration (D2);
> (c) removal or deletion of a claimed, unstarted ticket pays the freelancer 100 % while the TTL
> refunds the client 100 % (D3);
> (d) **new contradiction**: PS allows deleting tickets, stages and projects; PM §5.4 and root
> `CLAUDE.md` §5 forbid hard deletes, and `ticket_history` cascades away with a ticket (D4);
> (e) workload reporting is unreachable, penalises only the client at severity 0, and frees the
> reporter's capacity (D5, §3);
> (f) three of four assignment modes are ungranted (D6);
> (g) stage dependencies admit cycles and cross-project targets and drive nothing (D7, §2);
> (h) no CREATE category is stored, so $W_i$ = difficulty alone (D9);
> (i) `claim_ticket` checks project access, not the stage seat or Ready status; an owner's direct
> PATCH claims an unclaimed ticket past every assignment gate (audit X3, X12);
> (j) the per-stage price freeze is TS-only, and the shape lock can be lifted by flipping a seat
> (audit X8, X9);
> (k) a ticket-level price overrides every stage price in its chain (S11);
> (l) the Task and One-off views are guarded in the header, not the route (D11);
> (m) Submit without a draft, Delete Submission and Upload Files render and do nothing (audit §3.2);
> (n) the brief's "Kanban is Canvas2D" premise is false by contract (D8).
