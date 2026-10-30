# PM Build Prompts — Claude Code Work Orders for Projects & Execution (Track P)

> **Status: WORK ORDERS, not binding.** This is a sequenced series of self-contained Claude Code
> prompts for track **P** of [`FOUNDER_QUESTIONNAIRE.md`](FOUNDER_QUESTIONNAIRE.md) Part B §B.3.
> Together they close the open gaps in
> [`PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md`](PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md) (findings
> `F*`, `X*`) and [`PROJECT_MANAGEMENT_DECISION_LOG.md`](PROJECT_MANAGEMENT_DECISION_LOG.md) (`S*`,
> `C*`, `W*`, `D*`) under the owner's rulings of 2026-10-30. Every prompt cites its evidence by
> finding ID and its ruling as `(Decision #338, ruling X)`, the OWNER RULINGS on row #338 of
> `reference/decisions/decisions-122-126.md`, or `#337` for the ghosting auto-approve. Paste each
> prompt into its **own fresh session**, after the standard header (§1).
>
> **Before you start:** main must hold Wave 1.1 (`94d22e84`). Run the prompts in the §0 order and
> honour its cross-track waits. A prompt marked **🧑 DECISION** stops at the named question and puts
> it to a human, with the options and a recommendation. It still builds every step the question does
> not touch.
>
> **Migrations are edited in place** (root `CLAUDE.md` §1), so every prompt names the existing
> category file to edit. The only new migration file allowed is a trailing
> `00000###_tables_fk_*.sql` for a true circular foreign key.

---

## 0. Run order & dependencies

### 0.1 What Wave 0 left (verified against git, 2026-10-30)

Checked at `94d22e84`, and on the jobs branch `claude/wave1-jobs-sql-c504e8` (`e18489d4`, not yet
merged):

| Item                          | State                                         | Evidence                                                                                                                                             |
| :---------------------------- | :-------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| PM-WP2 (X4, X8, W7)           | Done, without D12                             | `3fcf2d54`: `trg_stage_assignment_lock_guard`, `fn_holds_live_seat`; `check_ticket_capacity` counts `reported_hidden`                                |
| PM-WP3 constraints            | Done, without the D7 guard                    | `ck_tickets_workload_intensity`, `stage_submissions_stage_number_key`, `fn_stage_delete_cascade` detaches dependants; no `fn_guard_stage_dependency` |
| PM-WP7 (S4, S7, S8, S9)       | Done, without S3                              | `projects.apply_write_batch`; `move_ticket(…, p_expected_updated_at)`                                                                                |
| PM-WP10, WP11, WP13           | Done                                          | `4c9482a2` row schemas; `e30b4111` design gates; `f9c4fc31` `deno task test:probes`                                                                  |
| Claim-TTL job                 | Registered **paused** on the jobs branch      | `projects-release-expired-claims`, `3,18,33,48 * * * *`, `enabled = false`                                                                           |
| Claim sweep                   | Unhardened                                    | `00001140:689-720`: no lock, no `claimed` re-check, no history row, no notice, no batch limit                                                        |
| Fair Exit                     | Client-chosen `{25, 50, 75}`, stage-wide only | `cancel_stage_fair_exit` (`00001150:1138`); `project_stages` stores no start time                                                                    |
| Removal and deletion          | Pay the freelancer 100 %; hard-delete         | `release_ticket_to_backlog`, `delete_ticket` (`00001120:56-110`); `fn_ticket_delete_protocol` (`00001110:409`)                                       |
| `payment_status = 'refunded'` | Never written                                 | `fn_refund_ticket_escrow` (`00001200:1028`) and the lost chargeback (`00001240:131`) write `unpaid`                                                  |
| Workload reports              | The engine only                               | no grant on `file_workload_report`; no Zod, service, route or control; both penalties seeded `0`                                                     |
| Stage dependencies            | Drawn only                                    | nothing reads `start_dependency_stage_id`; `startsWithId = null` means "the stage above" (`setup.ts:263`)                                            |
| Ghosting timer                | None                                          | `submission.auto_approved` is catalogued (`00005010:50`); nothing records when a submission was sent                                                 |
| Drafts                        | Visible to reviewers                          | _View submissions_ (`00002011:815`) and `resolveIsolation` (`live-submissions.ts:765`)                                                               |
| `/board`, stage `tasks`       | No guard                                      | neither route has `define.handlers`                                                                                                                  |
| Reliability Index             | Seeded only                                   | only `supabase/seeds/11_standing.sql` calls `org.fn_recompute_standing`; its weights are literals (`00001030:69-77`)                                 |

### 0.2 Order

| Phase                                       | Prompts                | Why this order                                                                                                                                                                                                                                                                                                                                           |
| :------------------------------------------ | :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Guards**                              | WP1 ∥ D7a              | WP1 needs only the jobs branch merged. D7a is the DL §2 cycle guard, which both answers to D7 needed. Their migration files are disjoint, so they may share the 2-session SQL cap.                                                                                                                                                                       |
| **2 — Money exits (the finance window)**    | WP4a → WP4b → P6 → GH1 | All four wait for F·DB3 and F·DB6 and run while no finance prompt holds `00001200` / `00001240`. Serial: each shares a migration file with the next (§0.4). WP4b calls WP4a's ticket-level door.                                                                                                                                                         |
| **3 — Workload & reliability**              | WP5a → WP5b            | WP5a closes a report on the settlements WP4 built (W4). WP5b measures delivery from GH1's `submitted_at` and WP4a's stage clock.                                                                                                                                                                                                                         |
| **4 — Stage state & the dependency engine** | S3 → D7b               | S3 follows D7a (both edit `00001100` and `00001850`). D7b follows D7a (the guard), P6 (each stage's own price) and GH1 (`00001150`).                                                                                                                                                                                                                     |
| **5 — Board & addresses**                   | WP8 → WP9; WP6         | WP8 is app-only: it may start at once, beside any SQL step that leaves the board files alone (its B.3 wait, WP3's UNIQUE on submission `number`, is met). WP9 takes the second SQL slot when nobody holds `00001150`, `00001850` or `00002011`: right after phase 1, while phase 2 waits for finance. WP6 waits for O·WP5 and follows WP5a (`00001110`). |
| **Last**                                    | Z1                     | The docs sweep and the audits' status columns.                                                                                                                                                                                                                                                                                                           |

### 0.3 Cross-track waits

| Prompt                                      | Waits for                                                        | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| :------------------------------------------ | :--------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP1                                         | the jobs branch (`claude/wave1-jobs-sql-c504e8`) merged          | it switches on the row that branch registered paused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| WP4a, WP4b, P6, GH1                         | F·DB3 and F·DB6 merged                                           | DB3 makes the release and Fair Exit doors refuse an open dispute (`PD409 dispute_open`), which WP4a's contest and GH1's sweep rely on; DB6 freezes a payee's pending rows on a dispute. While these four run they hold `00001200` (WP4b and P6 edit it; GH1 releases through `fn_release_ticket_escrow` in it) and `00001240` (WP4b edits it; GH1's releases enter the pending window there). F's later serial money prompts on those files (N3 commission, N4 bonus, N6/N8, the payout gate, the conservation view, the FX feed) go before them or after them, never beside them. |
| GH1                                         | the comms worker (`comms-process-queue`, on the jobs branch)     | its 7- and 13-day reminders are queued promises (`comms.fn_enqueue`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| WP6                                         | O·WP5 (RED SC-3: one home for shared pure rules)                 | the move rule lives in that home. WP6 builds the board's `canMove` flag (SC-4), which O·WP6 adopts instead of rebuilding.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M·search (the load and reliability weights) | WP5b                                                             | finance-model §16.7's "Load and reliability" row needs the efficiency terms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| T·P2 hardening triggers                     | WP4b                                                             | they touch ticket text (B.3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| I·IW-M13                                    | every SQL prompt here                                            | it touches the project readers (B.3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F·N4 (the deadline bonus, ruling M7)        | WP6                                                              | the bonus keys on a ticket's due date, which after WP6 changes only by agreement. WP4a refunds a held bonus fee-free once N4 has merged.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| WP4b step 8 (calendar events archive)       | C·WP10, if SCHEDULING_BUILD_PROMPTS gives it `scheduling.events` | one writer for `scheduling.events` and `00002015`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| WP4a step 6 (the contest door)              | C·WP8 (the attendance audit)                                     | both edit `00001260`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### 0.4 These cannot run in parallel (same files)

The §B.0 hot files:

- `00001240` (finance money): WP4b, beside FBP DB1–DB8 and F's later money prompts. `00001200`
  likewise: WP4b and P6, beside FBP DB3, DB8 and F·N4.
- `00005060` (jobs): WP1, WP4a (under 🧑 option A), WP5a, D7b and GH1. Each owns it only while it
  runs, and never beside an F, M, C or T prompt that adds a job.
- `00002510` (grants): WP1, WP4a, WP4b, WP5a, WP6, D7b and GH1.
- `features/devtools` + `apps/web/utils/dev-seam.ts`: WP4a, WP4b, WP5a, WP5b, WP6, D7b and GH1,
  beside FBP SV4 and UI3, SBP S4 and S6, and IDG F6.
- `00001155` (sessions), `00001020` (workspaces), `00001060` (erasure), `00001300` (comms),
  `stripe-webhook.ts` + `00001230`, and `live-wallet.ts` / `wallet-scope.ts`: no prompt here touches
  them. A session that finds it must stops and says so.

Shared beyond §B.0: `00001260` (WP4a; C·WP8); `00005001` platform params (WP4a, WP5a, WP5b, GH1; FBP
DB8); `00005010` notification catalogue (WP1, WP4a, WP5a, WP6, D7b, GH1; M's notify engine);
`00001250` (P6; the finance track); `packages/backend/services/finance/funding-state.ts` (WP4b; the
finance track).

Inside this track:

- `00000015`: D7a, WP4a, WP4b, GH1, WP5b, D7b, WP6.
- `00001150`: WP4a, WP4b, P6, GH1, D7b, WP9.
- `00001130`: D7a, WP4a, WP4b, P6, S3, D7b.
- `00001120`: WP4b, P6, GH1, D7b, WP6.
- `00001110`: D7a, WP4b, WP5a, WP6.
- `00001140`: WP1, WP5a, D7b.
- `00002011`: WP4b, WP5a, WP9.
- `00001100`: D7a, S3, D7b. `00001850`: D7a, WP4a, WP5a, WP5b, S3, WP9.
- The board files (`packages/types/projects/board.ts`, `live-board.ts`, `ProjectBoard.island.tsx`,
  `board-state.ts`): WP4b, P6, WP5a, S3, D7b, WP6 and WP8, beside O·WP5 and O·WP6.
- `ProjectBackendService.ts`: WP4a, WP4b, WP5a and WP6. `live-writes.ts`: D7a, WP4b, P6, WP5a, D7b
  and WP9. `live-submissions.ts`: GH1 and WP9.

### 0.5 Open decisions (🧑)

The prompts stop at these. Three are **new contradictions** found while writing this file. Each is
listed here and in the session report; none is logged as a decision row yet.

| #  | Question                                                                                                                                                                                                                                                                                                                   | Stops          | Recommendation                                                                               |
| :- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------- | :------------------------------------------------------------------------------------------- |
| 1  | Is `project_stages.create_category` stored as a label? (#338 P4, still open)                                                                                                                                                                                                                                               | WP5b step 6    | Yes: a label that weighs nothing                                                             |
| 2  | **New contradiction.** `flows/Projects.md` §4 and `StageSetupSchema` (`setup.ts:263-264`) make `startsWithId = null` mean "the stage above". DL §2's C6 CHECK refuses a `dependent_on_stage` row with no id, and an implicit predecessor can close a loop the explicit-id guard cannot see.                                | D7a step 3     | Resolve "the stage above" to an id at write                                                  |
| 3  | How a Fair Exit contest holds money: the dispute engine acts only on held escrow (PRODUCT_MANAGEMENT §3.8), and a Fair Exit settles at once                                                                                                                                                                                | WP4a step 6    | Hold each escrow for a 48-hour contest window                                                |
| 4  | **New contradiction.** PRODUCT_SPEC.md:1472-1475 (ruling P6) says a ticket's own price never overrides the stages it passes through. PRODUCT_SPEC.md:2272-2283 and the ticket composer hold a ticket "at its own price (else its stage's)".                                                                                | P6 step 2      | A ticket price applies only to a single-stage ticket                                         |
| 5  | The workload-report penalty sizes: both are seeded 0, and no source sizes them                                                                                                                                                                                                                                             | WP5a step 3c   | 2 / 1 / 3 on the 0–10 scale                                                                  |
| 6  | Where a freelancer's estimate is captured; the efficiency weights, minimum history and baseline (finance-model §16.3: "weights are dials, not set yet")                                                                                                                                                                    | WP5b steps 4–5 | An optional estimate at claim; new weights at 0 until set; 5 deliveries; the platform median |
| 7  | A negative delay, and a predecessor that never completes                                                                                                                                                                                                                                                                   | D7b steps 4–5  | Open before the predecessor's deadline; a manual open door                                   |
| 8  | **New contradiction.** PRODUCT_SPEC.md:2351-2363 (ruling P5 (b)) lets the owner or "an admin with explicit permission" move a claimed ticket on the client side. PRODUCT_MANAGEMENT §3.6 rules (8) and (10) and `fn_assert_ticket_move` let any review authority do it, which is any active member of the paying business. | WP6 step 5     | Narrow it to the owner and `manage_projects` holders                                         |

The other items still open after Wave 1.1 touch no prompt here: Agency and Enterprise storage (#252
S2), the FX conversion margin (#337 M5), the fee an Agency's contract rate applies to (#252), and
every ⚖️ item.

### 0.6 Roadmap — no build prompt

- **Round robin and parallel stream** (DL D6, audit X6; ruling P3: **Planned**). `open_pull` and
  manual assignment ship. When the Agency tier needs team fairness: grant
  `set_stage_assignment_mode`, `auto_assign_round_robin` and `assign_parallel_stream` (each already
  checks `can_review_project`), build the Staffing tab's routing control and its Dev axis, and lift
  PRODUCT_SPEC's Planned markers.
- **The Global Workload Kanban** (DL D15; ruling P3: **Planned**): a read-only board over
  `check_ticket_capacity`'s sums and `get_workload_capacity`, on `@projective/ui/kanban`.
- **Kanban column windowing** (DL D8; ruling P3: keep the DOM). Measure first; Z1 records the
  largest seeded column. Window inside `@projective/ui/kanban` once a column passes the threshold,
  so every board inherits it.
- **The project-manager freelancer** (ruling P5 (b)): a **Planned** persona, not yet specified. When
  specified, it joins the client side of the move rule through an explicit permission, with its Dev
  axis.
- **Found here, outside track P's rulings** (candidate follow-ups for the coordinator): W8, a
  moderator's verdict and the client's "keep" answer on a workload report (PRODUCT_SPEC §Dispute
  Mechanism 4); the Reliability Index's other inputs (completion, reviews, dispute-free rate, $W_i$
  reliability, tenure), which only the seeds write; and the `fixed_date` and `on_hire_confirmed`
  start triggers, which drive nothing.

---

## 1. Standard header — paste above EVERY prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types the
Zod SSOT @projective/types; packages/backend fat services @server/services/*; supabase/migrations
Postgres with RLS everywhere; Stripe Separate Charges & Transfers).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (at least
     documentation/CLAUDE.md, packages/ui/CLAUDE.md, and documentation/database/CLAUDE.md when SQL
     changes), then documentation/reference/guardrails.md and pr-checklist.md.
  2. Read documentation/architecture/PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md and
     PROJECT_MANAGEMENT_DECISION_LOG.md (the finding IDs cited below), the OWNER RULINGS on
     Decision #338 (grep -n '^| 338 |' documentation/reference/decisions/decisions-122-126.md),
     and FOUNDER_QUESTIONNAIRE.md Part C, the ruling table.
  3. Grep documentation/reference/decisions/README.md for the surface you touch and read the
     decision files it names. At minimum read #10, #61, #88, #94, #144, #163, #165, #188, #191,
     #197, #198, #210, #212, #213, #290, #291, #293, #294 and #341 (n).
  4. Read PRODUCT_SPEC.md (Resource Allocation & Ticketing; Stage Management; Escrow),
     PRODUCT_MANAGEMENT.md §3.4-§3.8 and §5.4, documentation/flows/Projects.md, finance-model.md §3
     and §8, and documentation/database/projects/{Tables,Functions,Policies}.md for the objects you
     change.

Hard rules (merge gates; reject your own diff if any of these fails):
  Money
  - Integer minor units; the fee falls on the earned share only. Every escrow moves through its
    finance door (fn_hold_ticket_escrow, fn_release_ticket_escrow, fn_refund_ticket_escrow,
    fn_fair_exit_release). Never UPDATE finance.escrows or finance.wallets directly.
  - No hold, no work (#165). Released and Refunded are reached exactly once per escrow (#188): lock
    the escrow, and flip it only while it is still held.
  - Never drop columns/FKs of escrows, wallets or project_stages without asking me.
  SSOT & architecture
  - Migrations are consolidated and EDITED IN PLACE (supabase/migrations/vvvvtooo_type_purpose.sql).
    Never append ALTER TABLE ADD COLUMN / ALTER TYPE ADD VALUE patches or a new "fix" file. Each
    statement goes in its category file: 0 enums/tables · 1 functions/triggers · 2 policies/grants
    · 3 views · 4 indexes · 5 seed (incl. 00005060 scheduled jobs, 00005010 notification types,
    00005001 platform params).
  - A schema change lands with its Zod row schema (packages/types/projects/rows.ts; the contract
    test projects-tables.contract.test.ts stays green) and documentation/database/* in the SAME
    change. A lifecycle change updates documentation/PRODUCT_MANAGEMENT.md; a business rule updates
    PRODUCT_SPEC.md or finance-model.md. When you build a rule marked **Not built yet** (Decision
    #NNN, ruling X), remove that marker in the same change.
  - Thin routes (apps/web/routes/api/projects/*): HTTP parse + Zod + auth guard ONLY. Logic lives
    in packages/backend/services/projects/* and returns ServiceResult<T> (#10). The stub path uses
    the same pure predicates as the live one (stub-parity.test.ts).
  - Authority lives in the SQL door (can_review_project, is_ticket_manager,
    fn_assert_business_actor, fn_assert_ticket_move); the service mirrors it only to decide what to
    offer. Pure rules are mirrored in TS with a SQL parity test; state-dependent rules reach the
    client as server DTO flags; never a permissive client on a money path (Decision #338, ruling
    P5 (e); #341 (n)).
  - Route slugs are prj-/stg-/tkt-; uuids do not route (#88). A Response returned from a
    define.page component is dead code: return redirects from define.handlers (#61).
  - Islands never import Supabase or @server/*; they fetch /api/*. Signal-first; no useState;
    useEffect only for external DOM/browser APIs. Path aliases only; folders components/ islands/
    styles/ hooks/ wrappers/ types/ core/; no src/. JSDoc on exports; // #region [Name] …
    // #endregion; no meta-comments.
  UI (DESIGN_SYSTEM.md; root CLAUDE.md §3)
  - Token-only pure CSS + strict BEM: no literal colour, radius, duration, shadow or weight; no
    inline style= except packages/ui styleVars().
  - Anti-tag: metadata (dates, a floor's basis, who proposed what) is MetaLine --text-secondary
    middot text; a Tag only for a lifecycle status. Headings never reach --fw-bold. Every amount,
    date, percentage and countdown is tabular-nums.
  - Button matrix (#157): one filled button per decision region; money movement tier 1; workflow
    commits tier 3; utilities tier 4; text tier 5. Press = transform: scale(), removed under BOTH
    reduced-motion channels.
  - One dialog at a time, replaced in place; a bottom sheet on mobile. A control that renders must
    do something (§3.11): a control whose engine is not running opens LockedDialog with its reason.
  - A new or changed packages/ui component updates the DESIGN_SYSTEM.md §C.1 roster in the same
    change.
  Product
  - Every new simulatable axis (persona, role, capability gate, lifecycle state, data-dev-* flag)
    gets its Dev Context Switcher control in the same change: DevOverrides + DEV_DEFAULTS, DevOption
    list, DevContextPanel control, reflect() set AND delete (apps/web/features/devtools/, seam
    apps/web/utils/dev-seam.ts).
  - No bespoke statuses. Nothing is hard-deleted except a ticket or stage never claimed, funded or
    submitted against (Decision #338, ruling P2 (b)); everything else archives.
  - A NEW contradiction between source docs: do not pick a side. Add a decision row (the newest
    documentation/reference/decisions/decisions-*.md + a README index line) and ask me.

Verification: reproduce the defect first (a SQL probe under supabase/probes/ wrapped in
BEGIN … ROLLBACK, or a Deno unit test), then fix it.
  - SQL: there is ONE local Supabase DB. At most 2 SQL sessions run at once, on disjoint migration
    files; announce every `deno task db:reset` to the concurrent sessions before you run it.
    Iterate with `deno task test:probes`, and finish with your own clean
    `deno task test:probes:fresh` (a reset, then every probe, committing ones included). A probe
    that COMMITS follows supabase/probes/seat_fill_concurrency.sql: it refuses the shared database
    unless probe.allow_commit is on, and it runs in the --disposable pass.
  - Then `deno task check`, `deno task lint`, `deno task test:unit`, and `deno fmt` on the files you
    touched only (never a directory). Four theme-engine.test.ts failures are pre-existing (Decision
    #96(a)). Docs are CRLF in the working tree: edit them with the Edit tool or a
    newline-preserving script, never sed.
  - UI: run `deno task dev` (or dev:mock), sign in as the seeded personas
    (documentation/database/Seed.md), and capture screenshots at 1440, 900 and 390 px in light,
    dark, data-contrast="high" and data-motion="reduced".
Commit on the branch you were given with a clear message; do not open a PR unless I ask.
```

---

## 2. Phase 1 — Guards

### PM-WP1 — The claim TTL refunds parked claims, and only parked claims

```text
PROMPT PM-WP1: The claim-TTL sweep is safe to run, then it runs

ROLE: Postgres engineer (projects doors over the finance refund).

CONTEXT: Audit X7; DL S1, S2, D1; #338 flag (a) (Decision #338, ruling Q0.3); re-raises #203 (a)
and #290 (a). projects.fn_release_expired_claims (00001140:689-720) selects every claim older than
claim_ttl_minutes with no row lock, refunds it, and resets it with no `status = 'claimed'`
re-check. A ticket started between its SELECT and its UPDATE is therefore refunded and thrown back
to the backlog while the freelancer works (S2). It writes no ticket_history row, tells nobody, and
has no batch limit. The jobs session registered it in 00005060 as
`projects-release-expired-claims` ('3,18,33,48 * * * *') with enabled = false. WAIT for that
branch (claude/wave1-jobs-sql-c504e8) to be merged into main.

FILES:
  - supabase/migrations/00001140_functions_projects_automation_workload.sql
    (fn_release_expired_claims)
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (the "[projects] Claim-TTL auto-release"
    region: switch the row on and rewrite its comment)
  - supabase/migrations/00005010_seed_notification_catalog.sql (ticket.claim_expired, shaped like
    the ticket.awaiting_funding row)
  - supabase/migrations/00002510_permissions_function_grants.sql (:1357-1358, for the new
    signature; service_role only)
  - supabase/probes/claim_ttl_sweep.sql (new, ROLLBACK); supabase/probes/claim_ttl_sweep_race.sql
    (new, committing, dblink)
  - documentation/database/projects/Functions.md; SYSTEM_ARCHITECTURE.md §Scheduled jobs (the
    "implemented but not registered" line, for the claim sweep only); PRODUCT_SPEC.md:2156-2163;
    PRODUCT_MANAGEMENT.md §3.6 (the Funded row)

STEPS:
  1. Reproduce S2 (audit §7, X7) in claim_ttl_sweep_race.sql: claim a funded ticket, backdate
     claimed_at past the TTL, start the work in session 1 without committing, then run the sweep in
     session 2. Today the started ticket is refunded and reset. Assert that it is untouched after
     the fix.
  2. Signature fn_release_expired_claims(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT
     200). Select candidates with `WHERE status = 'claimed' AND claimed_at < p_now - ttl ORDER BY
     claimed_at LIMIT p_limit FOR UPDATE SKIP LOCKED`. A row another transaction holds is skipped,
     and Postgres re-checks the WHERE on every row it locks: that lock is the `claimed` re-check.
     Under the lock, refund FIRST (finance.fn_refund_ticket_escrow), then reset with `UPDATE …
     WHERE id = r.id AND status = 'claimed'` as a backstop. The order matters: clearing
     current_assignee_id fires fn_ticket_escrow_sync's removal branch (00001110:398-401), which
     releases any escrow still held to the freelancer.
  3. Write one ticket_history row per released ticket: action_type 'claim_expired',
     previous_status 'claimed', new_status 'backlog', the stage on both sides, actor_id = the
     lapsed claimant (the row records whose claim lapsed), and changes {claimed_at, ttl_minutes,
     refunded_cents}.
  4. Tell both sides through comms.fn_notify with one catalogue type, ticket.claim_expired: the
     lapsed claimant ("your claim expired; the ticket is back in the backlog") and the project owner
     ("the escrow held for it is back in your wallet").
  5. In 00005060 the row runs (drop `enabled` from that INSERT, or set it true), and the region
     comment says why it is now safe: SKIP LOCKED, the re-check, the history row and the notices.

SAME CHANGE: Functions.md (the signature, the behaviour, the job). PRODUCT_SPEC.md:2156-2163 loses
its **Not built yet** sentence and says the sweep runs every 15 minutes. PRODUCT_MANAGEMENT.md §3.6
(the Funded row) names the history row and the notices. SYSTEM_ARCHITECTURE.md §Scheduled jobs
lists the job as running. No schema change; no new Dev axis.

DB LANE: one local DB. At most 2 SQL sessions run at once, on disjoint migration files; announce
each `deno task db:reset`. Run probes with `deno task test:probes` while you iterate, and finish
with your own clean `deno task test:probes:fresh`.

ACCEPTANCE:
  - claim_ttl_sweep.sql: a backdated claim is refunded once (the escrow refunded, the payer
    credited), reset to the backlog, with one history row and two notices; an in_progress,
    in_review or reported_hidden ticket past the TTL is untouched; p_limit is honoured; a second
    run returns 0 and moves nothing.
  - claim_ttl_sweep_race.sql (the disposable pass): the started ticket keeps its held escrow.
  - scheduled_jobs.sql passes; the row is enabled and has a cron.job entry where pg_cron runs.
  - finance_invariants.sql passes.
```

### PM-D7a — Stage dependencies never loop, and a ticket's route stays in its project

```text
PROMPT PM-D7a: Stage dependencies never loop or leave the project; a ticket's route is valid

ROLE: Postgres engineer.

CONTEXT: DL §2 C1, C2, C5, C6 and S11 (its first half); audit X13 (the unvalidated route); #338
flag (g) (Decision #338, ruling P3: the cycle guard lands before the dependency engine, PM-D7b).
Only a self-loop is refused today, in TS (live-writes.ts:1687) and in the form's Zod wouldCycle
(setup.ts:378-405). A → B → A can be stored through the create_project payload, through a direct
UPDATE under the "Users can manage stages of own projects" FOR ALL policy (00002011:282), or across
two saves. create_project's second pass (F1100:430-436) never checks that the target is in the
project. A ticket's required_stages jsonb is checked for neither project membership nor duplicate
orders, and the Chain Reaction follows it (C5). C4 merged in Wave 0 (fn_stage_delete_cascade
detaches dependants): verify it, do not redo it.

🧑 DECISION — the null predecessor (STOP before step 3; a new contradiction, PM_BUILD_PROMPTS §0.5).
documentation/flows/Projects.md §4 ("Starts with": null = the stage above) and StageSetupSchema
(packages/types/projects/setup.ts:263-264) store a sequential stage with no predecessor id. DL §2's
C6 CHECK refuses exactly that row. An implicit "stage above" can also close a loop the explicit-id
guard cannot see: A waits for B by id, while B is sequential with null and sits below A. Put to me:
  Option A (recommended): resolve at write. The setup save (stageTermsPatch, live-writes.ts:1225)
  and create_project store the id of the stage above for every sequential stage left at null. The
  first stage cannot be sequential (on_project_start). The C6 CHECK then holds, and a later reorder
  never rewrites a dependency, which is what setup.ts:266-268 says the explicit id is for.
  Option B: keep null = the stage above at rest, with no C6 CHECK. The guard (and PM-D7b) resolve
  the implicit predecessor as the previous live stage by sort_order.

FILES:
  - supabase/migrations/00001130_functions_projects_stages.sql (fn_guard_stage_dependency)
  - supabase/migrations/00001110_functions_projects_ticket_guards.sql (fn_guard_ticket_route)
  - supabase/migrations/00001850_triggers_projects_tickets.sql (both CREATE TRIGGERs)
  - supabase/migrations/00000015_tables_projects.sql (ck_project_stages_dependency_trigger, after
    the ruling, under Option A)
  - supabase/migrations/00001100_functions_projects_read_access.sql (create_project's second pass,
    only if the probe shows it escapes the trigger)
  - packages/backend/services/projects/live-writes.ts (map each 23514 to a 422 {code:
    'dependency_cycle' | 'dependency_foreign' | 'route_foreign'}; Option A's resolution);
    packages/types/projects/setup.ts (the error keys); the tests beside each
  - supabase/probes/stage_dependency_guard.sql (new); supabase/seeds (any row the CHECK refuses)
  - documentation/database/projects/{Tables,Functions}.md (Tables.md:996-998 admits cycles);
    documentation/flows/Projects.md §4 (the "Starts with" row, per the ruling)

STEPS:
  1. Reproduce C1 and C2: store A → B → A through create_project's payload and through two direct
     UPDATEs, and point a stage at another project's stage with a direct UPDATE. Today all succeed.
  2. fn_guard_stage_dependency is DL §2's function in substance (the same-project check, then the
     recursive UNION walk, which terminates even over a stored cycle), with one addition: it takes
     pg_advisory_xact_lock(hashtext('stage_deps:' || NEW.project_id::text)) first, so two
     transactions adding opposite edges cannot both pass. It fires BEFORE INSERT OR UPDATE OF
     start_dependency_stage_id, project_id, and raises 23514 with DL §2's two messages. Under
     Option B the walk also resolves a NULL id on a dependent_on_stage row to the previous live
     stage.
  3. (After the ruling, Option A.) Add ck_project_stages_dependency_trigger to the CREATE TABLE,
     the write-time resolution in the service and in create_project, and fix the seeds.
  4. fn_guard_ticket_route (C5, S11) fires BEFORE INSERT OR UPDATE OF required_stages,
     current_stage_id, project_id ON projects.tickets. Every stage_id in required_stages, and
     current_stage_id, must be a live stage (archived_at IS NULL) of NEW.project_id, and the
     `order` values must be unique: 23514 'That stage is not part of this project.' It runs on
     every path, definers included.
  5. The service maps each 23514 to its 422 code. The setup form already prevents a cycle, so the
     codes surface only from the API.

SAME CHANGE: Tables.md documents the guards (and the CHECK, under Option A); Functions.md gains
both functions; flows/Projects.md §4 states the rule the ruling picks. PRODUCT_SPEC.md:2518-2522
keeps its **Not built yet** (that marker is the engine's, PM-D7b), but its "Dependencies never
loop" sentence becomes true: say so in the commit. No Zod column change; no Dev axis.

DB LANE: one local DB. At most 2 SQL sessions run at once, on disjoint migration files; announce
each `deno task db:reset`. Run probes with `deno task test:probes` while you iterate, and finish
with your own clean `deno task test:probes:fresh`.

ACCEPTANCE:
  - stage_dependency_guard.sql: A → B → A is refused through create_project, through a direct
    UPDATE and across two saves; a cross-project target, a self-loop, a ticket naming another
    project's stage in required_stages, and duplicate orders are all refused; the seeds load.
  - A committing two-session probe (the disposable pass): of two opposite edges added at once,
    exactly one commits.
  - The live-writes tests map each code; deno task check passes.
```

---

## 3. Phase 2 — Money exits

### PM-WP4a — Fair Exit pays at least what the work has earned

```text
PROMPT PM-WP4a: Fair Exit pays at least what the work has earned, per stage or per ticket

ROLE: Postgres + backend engineer.

CONTEXT: Audit X14; DL D2, D16-c; FDD D-9 (b); #198 (b), (e), (f); #338 flag (b) (Decision #338,
ruling P1: B now, A once deadlines are reliable). Today the client picks 25, 50 or 75 %
(cancel_stage_fair_exit, 00001150:1138, bp = tier × 100). finance-model.md §3 derives 0, 50 or
100 % from elapsed duration, and project_stages stores no start time. Ruling P1: the server
derives a tier that is a FLOOR the client may only raise; the payee may contest it through the
Evidence Vault; with no stage deadline, a submission on file earns 50 % and an accepted one 100 %;
the owner and the acting reviewer are told (as built); a multi-stage ticket on the ended stage is
cancelled (as built). Ruling P2 (a) needs a ticket-level door, which this prompt builds and PM-WP4b
uses. WAIT for F·DB3 (fn_fair_exit_release refuses PD409 'dispute_open') and F·DB6. It runs in the
finance window (PM_BUILD_PROMPTS §0).

🧑 DECISION — how a contest holds money (STOP before step 6). The dispute engine acts only on held
escrow (PRODUCT_MANAGEMENT §3.8: one row contests ONE held escrow; PRODUCT_SPEC §Dispute Resolution
2: an auditor releases, refunds or splits). A Fair Exit settles at once, which leaves nothing to
contest. Put to me:
  Option A (recommended): ending a stage or a ticket stops the work at once (its tickets close
  cancelled, as built), but each escrow stays held for a contest window, fair_exit_contest_hours
  (48, the dispute cooling-off). Inside it the payee may contest, which opens a finance.disputes
  row per escrow for the operator desk (/admin/disputes). An uncontested escrow settles at the
  chosen tier when the window closes. The client's refund arrives 48 hours later.
  Option B: settle at once. A contest re-opens the case, and the difference an auditor awards is
  recovered from the client's wallet, which can fail like an unrecovered chargeback.
  Option C: a contest is a Standing signal only; no money moves after the exit.
Until it is ruled, ship every step except 6, with the payee's Contest control opening LockedDialog
(reason 'contest_not_running').

FILES:
  - supabase/migrations/00000015_tables_projects.sql (project_stages.started_at timestamptz, set
    once and never cleared)
  - supabase/migrations/00001130_functions_projects_stages.sql (fn_stamp_stage_started) +
    00001850_triggers_projects_tickets.sql (its AFTER UPDATE OF status trigger on tickets)
  - supabase/migrations/00001150_functions_projects_stage_funding_submissions.sql
    (fn_fair_exit_floor new; fn_fair_exit_quote :1026; preview_stage_fair_exit :1070;
    cancel_stage_fair_exit :1138; preview_ticket_fair_exit, cancel_ticket_fair_exit and the
    internal fn_ticket_fair_exit_settle new)
  - supabase/migrations/00002510_permissions_function_grants.sql (both ticket doors →
    authenticated)
  - supabase/migrations/00005010_seed_notification_catalog.sql (ticket.fair_exit, shaped like the
    stage door's 'stage_cancelled' row)
  - step 6 only, per the ruling: 00005001_seed_platform_params.sql,
    00005060_seed_scheduled_jobs.sql, 00001260_functions_finance_disputes.sql,
    00000017_tables_finance.sql
  - packages/types/projects/settlement.ts (FairExitTier 0 | 25 | 50 | 75 | 100; the previews'
    floors), rows.ts (startedAt)
  - packages/backend/services/projects/{ProjectBackendService.ts, live-settlement.ts} + tests
  - apps/web/routes/api/projects/[id]/tickets/[ticketId]/{fair-exit,cancel}.ts (new, mirroring
    [id]/stages/[stageId]/{fair-exit,cancel}.ts)
  - apps/web/features/projects/components/FairExitDialog.tsx, core/fair-exit-model.ts (+ test),
    components/ticket/TicketView.tsx (TicketMenu: "End this ticket")
  - every landing module that restates the tiers (RED L-19; grep FairExitTier under
    apps/web/features/landing): pin it with a parity test (ADC Q15 B)
  - apps/web/features/devtools/*, apps/web/utils/dev-seam.ts (fairExitFloor axis)
  - supabase/probes/fair_exit_floor.sql (new); fair_exit_settlement.sql (update its expectations
    where a floor now binds)

STEPS:
  1. Reproduce X14: end a stage 40 % of the way through its duration at tier 25. Today the payee
     gets 25 %; after the fix they get 50 % (the floor).
  2. The stage clock: started_at is stamped once, when the first ticket on the stage enters
     in_progress. Its deadline is file_due_date; else started_at + file_duration_days when
     file_duration_mode = 'relative_duration'; else none. A ticket's own due_date, when set, is
     that ticket's deadline.
  3. projects.fn_fair_exit_floor(p_ticket_id uuid, p_stage_id uuid) RETURNS (floor_tier integer,
     basis text), STABLE, is the ONE place the floor is derived. The quote, both previews and both
     doors call it; TS never recomputes it.
       a. Start and deadline known: elapsed share = (now − start) ÷ (deadline − start), clamped to
          [0, 1] (a deadline at or before the start counts as fully elapsed). Under 25 % → 0;
          25-75 % → 50; over 75 % → 100 (finance-model.md §3). A sent submission of this ticket on
          this stage (pending_review) raises the floor to 100 ("or final submission", §3).
       b. Otherwise the ticket's sent submissions on the stage decide: an accepted one → 100; one on
          file (pending_review or revisions_requested) → 50; none → 0. A draft never counts
          (ruling P5 (d)).
       c. A prepaid escrow nobody claimed is refunded whole (#197), as built.
     basis is one of elapsed_under_25, elapsed_mid, elapsed_over_75, final_submission,
     accepted_submission, submission_on_file, nothing_delivered, unclaimed_prepaid.
  4. Tiers are {0, 25, 50, 75, 100}; anything else is refused 22023. cancel_stage_fair_exit settles
     each ticket at GREATEST(p_tier, its floor) through finance.fn_fair_exit_release(ticket, bp):
     the client's tier raises the payout and never lowers it. fn_fair_exit_quote applies the same
     rule. preview_stage_fair_exit returns every tier's quote with the floors applied, the stage's
     lowest floor, and floors[] = {ticket_id, floor_tier, basis}. The dialog offers only tiers at
     or above the lowest floor, and names the tickets a higher floor holds up as MetaLine text
     (tabular-nums). The door's notices (00001150:1255-1272) report each payee's settled tier, not
     the tier the client picked.
  5. The ticket-level door (ruling P2 (a)). fn_ticket_fair_exit_settle(p_ticket, p_tier, p_then
     text) is the internal body. It locks the ticket; refuses (55000) a ticket that holds no escrow
     or is already completed or cancelled; settles every held escrow of the ticket at
     GREATEST(p_tier, floor); cancels a paid revision still awaiting payment; writes a
     ticket_history 'fair_exit' row; then closes the ticket as p_then says: 'cancel' → cancelled,
     terminal, assignee kept; 'repool' → backlog and unassigned (for a removal); 'archive' → as
     PM-WP4b defines. The public pair preview_ticket_fair_exit(p_ticket_id) and
     cancel_ticket_fair_exit(p_ticket_id, p_tier) uses 'cancel' and asks for review authority plus
     fn_assert_business_actor(project, 'hire'), as the stage door does. It tells the payee, the
     owner and the acting reviewer (ruling P1) with ticket.fair_exit. A multi-stage ticket ended
     here is cancelled, so its later stages never run (ruling P1).
  6. (After the ruling.) Under Option A: one projects.fair_exit_windows row per held escrow (tier,
     floor_tier, basis, ends_at, status open | contested | settled), and the doors open windows
     instead of settling. projects.contest_fair_exit(p_window_id, p_statement), by the payee or an
     active member of the payee team inside the window, opens a finance.disputes row through the
     existing dispute-door pattern in 00001260 (a 'fair_exit' kind added in place in 00000017, with
     its Zod and docs, if the table has no kind). projects.fn_settle_fair_exit_windows() settles
     every uncontested window past ends_at (registered in 00005060, every 15 minutes); a contested
     escrow settles only through resolve_dispute. First verify that no ticket trigger
     (fn_ticket_escrow_sync) moves money when a ticket with a held escrow closes as cancelled; if
     one does, stop and report. A removal re-pools its ticket while the old escrow is still held in
     its window, so claim_ticket refuses a ticket with an open window (55000), and PM-WP4b's
     removal-branch guard treats an escrow an open window owns as settled.
  7. If F·N4 (the deadline-bonus hold, ruling M7) has merged, a Fair Exit refunds any held bonus
     fee-free. Otherwise skip this step.
  8. Dev Context Switcher: fairExitFloor (auto · 0 · 50 · 100, each with a basis) forces the floor
     the previews return under the dev seam; after the ruling, fairExitWindow (auto · none · open ·
     contested · settled). DevOverrides + DEV_DEFAULTS, DevOption list, DevContextPanel control,
     reflect() set AND delete.

SAME CHANGE: started_at → rows.ts + database/projects/Tables.md; every new function →
Functions.md; the settlement.ts Zod. PRODUCT_MANAGEMENT.md §3.5's Stage settlement row (:253) loses
its **Not built yet**; §3.6 follows; §3.8 gains the second dispute door after the ruling.
finance-model.md §3 loses its marker (:131-138) and its "Implementation (current)" block.
PRODUCT_SPEC.md:2605-2624 loses its marker (:2623-2624). DESIGN_SYSTEM.md §C.1 only if a
packages/ui component changes.

DB LANE: one local DB. At most 2 SQL sessions run at once, on disjoint migration files; announce
each `deno task db:reset`. Run probes with `deno task test:probes` while you iterate, and finish
with your own clean `deno task test:probes:fresh`.

ACCEPTANCE:
  - fair_exit_floor.sql (ROLLBACK): 40 % elapsed at tier 25 pays 50; under 25 % at tier 0 refunds
    everything fee-free; over 75 % pays 100; with no deadline, a pending submission → 50, an
    accepted one → 100, none → 0; a draft never raises the floor; an unclaimed prepaid escrow is
    refunded whole; tier 30 → 22023; the ticket door ends one ticket and leaves its stage open; a
    second call on the same ticket → 55000 and moves nothing.
  - fair_exit_settlement.sql and finance_invariants.sql pass.
  - fair-exit-model.test.ts offers only tiers at or above the floor; the landing parity test is
    green.
```

### PM-WP4b — Removal and deletion follow the work; nothing with history is destroyed

```text
PROMPT PM-WP4b: Removal and deletion follow the work; nothing with history is destroyed

ROLE: Postgres + backend engineer.

CONTEXT: Audit X15, X16; DL D3, D4, S5, S13; PMA S13; #338 flags (c) and (d); #163 (Decision #338,
rulings P2 (a), (b), (c)); root CLAUDE.md §5; PRODUCT_MANAGEMENT §5.4. Today removing a freelancer
(remove_project_member → release_ticket_to_backlog, 00001120:90) or deleting a ticket
(delete_ticket :56; fn_ticket_delete_protocol, 00001110:409) pays the freelancer 100 % even when
the work never started, while the claim TTL refunds the same parked claim to the client in full.
The payment is fn_ticket_escrow_sync's removal branch (00001110:398-401): clearing
current_assignee_id releases every held escrow to the freelancer, on every path, an owner's direct
write under "Manage tickets" included. delete_ticket hard-deletes, and ticket_history and
ticket_workload_reports cascade away with the row; a ticket with a submission cannot be deleted at
all (23503). delete_stage releases escrow and
then raises when escrow history exists, so the releases roll back, and it can leave a ticket
in_progress with no stage (X16, S5). The project DELETE policy (00002011:175) and the stages FOR
ALL policy (:282) hard-delete. A refund writes payment_status 'unpaid'; the documented 'refunded'
is never written (S13). Depends on PM-WP4a (the ticket-level door). It edits 00001200 and 00001240,
so it runs in the finance window (PM_BUILD_PROMPTS §0).

FILES:
  - supabase/migrations/00000015_tables_projects.sql (tickets.archived_at, and a CHECK in the
    ck_projects_archived_at idiom: an archived ticket is completed or cancelled)
  - supabase/migrations/00001130_functions_projects_stages.sql (fn_ticket_has_history new, beside
    fn_stage_has_history :603; delete_stage :511; remove_project_member :2520)
  - supabase/migrations/00001120_functions_projects_ticket_lifecycle.sql (delete_ticket :56;
    release_ticket_to_backlog :90)
  - supabase/migrations/00001110_functions_projects_ticket_guards.sql
    (fn_enforce_ticket_checkout_desc :42; the payment_status rules of fn_ticket_immutability_guard
    :213-219; fn_ticket_escrow_sync :363, its removal branch :398-401; fn_ticket_delete_protocol
    :409; fn_ticket_settlement_guard :432)
  - supabase/migrations/00001200_functions_finance_core.sql (fn_refund_ticket_escrow :1001)
  - supabase/migrations/00001240_functions_finance_money_movement.sql (the lost-chargeback branch
    :131)
  - supabase/migrations/00001150_functions_projects_stage_funding_submissions.sql (the funding
    doors' payment_status filters :728, :845, :969, :1364)
  - supabase/migrations/00002011_policies_projects.sql (:175 dropped; :282 and :355 lose DELETE)
  - supabase/migrations/00002510_permissions_function_grants.sql (the removal preview →
    authenticated)
  - supabase/migrations/00004003_indexes_projects.sql (partial indexes WHERE archived_at IS NULL
    where the board reads need them)
  - step 8 only: 00000022_tables_scheduling.sql (events.archived_at) and
    00002015_policies_scheduling_integrations.sql (:215 loses DELETE)
  - packages/backend/services/finance/funding-state.ts (:122-126) + funding-state.test.ts
  - packages/types/projects/rows.ts (archivedAt), board.ts (the deletable flag), settlement.ts
    (the removal preview)
  - packages/backend/services/projects/{ProjectBackendService.ts, live-writes.ts, live-invites.ts,
    live-board.ts, and every reader that lists tickets} + tests
  - apps/web/features/projects/components/RemoveMemberDialog.tsx and the ticket's delete control;
    apps/web/features/devtools/*, apps/web/utils/dev-seam.ts (ticketHistory axis)
  - supabase/probes/ticket_archive_and_removal.sql (new); every probe that hard-deletes a ticket or
    expects 'unpaid' after a refund (PM-WP1's claim_ttl_sweep.sql among them)

STEPS:
  1. Reproduce D3: remove a freelancer who holds a claimed, unstarted ticket; today they are paid
     100 %. Reproduce D4: delete a funded ticket and its ticket_history is gone; delete one with a
     submission and get 23503.
  2. projects.fn_ticket_has_history(p_ticket), STABLE SECURITY DEFINER, means "claimed, funded or
     submitted against": claimed_at IS NOT NULL; a finance.escrows row for the ticket in any
     status; a stage_submissions row; a ticket_workload_reports row; a ticket_history row whose
     new_status is claimed, in_progress, in_review or completed (a client's column move does not
     count); a basket line, order line or inbound payment naming the ticket. A stage keeps
     fn_stage_has_history (#163's predicate). It is stricter, so a stage errs towards archiving.
  3. The money follows the work (ruling P2 (a)), settled at the floor. Before in_progress (backlog,
     todo, claimed), any held escrow is refunded in full (fn_refund_ticket_escrow, TTL parity).
     From in_progress (in_progress, in_review, reported_hidden), the ticket settles through
     PM-WP4a's fn_ticket_fair_exit_settle at its floor. A client who wants to pay more ends the
     ticket through its own Fair Exit first, and the dialogs say so.
       - fn_ticket_escrow_sync's removal branch stops paying. When an assignee is cleared while an
         escrow is still held, it raises 55000 ('Settle this ticket first: remove its freelancer or
         end it under Fair Exit'). Every door settles before it clears the assignee (PM-WP1's
         sweep refunds first), so the branch only ever meets settled tickets, and an owner's
         direct write can no longer pay out 100 %.
       - remove_project_member: each held ticket in scope is refunded and reset to the backlog, or
         split with p_then 'repool', so it goes back to New for another freelancer (PRODUCT_SPEC
         §Freelancer Removal 2). RemoveMemberDialog shows each ticket's outcome from a new read,
         preview_remove_project_member, before the client confirms.
       - delete_ticket: a ticket with no history is hard-deleted, and no money moves. A ticket with
         history settles as above and closes with p_then 'archive': status cancelled, archived_at
         now(), a ticket_history 'archived' row. It returns {outcome: 'deleted' | 'archived',
         refunded_cents, paid_cents}.
  4. delete_stage refuses first (the X16 raise moves ahead of any money). A stage with no history
     is hard-deleted. Otherwise every ticket on it settles as in step 3 and closes cancelled (never
     in_progress with no stage, S5), the stage gets archived_at, and its id leaves other tickets'
     required_stages (PRODUCT_SPEC §Stage Deletion, "Dangling Requirements").
  5. payment_status 'refunded' (S13, ruling P2 (c)): fn_refund_ticket_escrow and the
     lost-chargeback branch write 'refunded' when no held escrow remains. A re-pooled ticket stays
     fundable: every funding door, fn_enforce_ticket_checkout_desc and the claim hold accept a
     ticket that holds no escrow, whatever its payment_status history (unpaid, needs_funding,
     refunded, or partially_released with nothing held on its current stage). deriveFundingState
     reads a refunded ticket that is open again (backlog or todo) as Draft, and a cancelled or
     archived one as Refunded.
  6. Policies: drop "Users can delete own projects" ('archived' is the project's soft delete). The
     stages and "Manage tickets" FOR ALL policies lose DELETE (split each into SELECT, INSERT and
     UPDATE), so delete_ticket and delete_stage are the only doors. fn_ticket_delete_protocol
     becomes the backstop: a DELETE of a ticket with history raises 42501 ('archive it instead')
     for every role, outside session_replication_role = replica (the seeds).
  7. Every reader filters archived tickets out: the board, the overview, the timeline, the
     submissions tree and search. An archived ticket is terminal, so check_ticket_capacity already
     skips it; prove that with a probe line. The ticket DTO carries deletable (a server flag: NOT
     fn_ticket_has_history), and the control reads Delete or Archive from it.
  8. Calendar events archive too (ruling P2 (b)). FIRST grep the merged SCHEDULING_BUILD_PROMPTS.md
     for an archive of scheduling.events. If a scheduling prompt owns it, skip this step and name
     that prompt in your commit. Otherwise scheduling.events gains archived_at, the "Manage
     scheduling events" FOR ALL policy (00002015:215) loses DELETE, an owner's delete sets
     archived_at through the scheduling service, and the calendar readers filter it out.
  9. Dev Context Switcher: ticketHistory (auto · untouched · has_history) forces the deletable flag.
     DevOverrides + DEV_DEFAULTS, DevOption list, DevContextPanel control, reflect() set AND delete.

SAME CHANGE: archived_at → rows.ts + Tables.md; Functions.md and Policies.md (projects, and
scheduling for step 8). PRODUCT_SPEC.md §Deletion Protocol (:2409-2423), §Freelancer Removal
(:2425-2434) and §Stage Deletion (:2557-2566) lose their **Not built yet**. PRODUCT_MANAGEMENT.md
§3.6 loses :448's "(not built yet)", rule (12)'s marker and the Refunded row's (:512); its Funded
row's TTL reset now writes 'refunded'; §5.4 loses its marker (:747-753). finance-model.md §3 "One
ticket, not the whole stage" (:169-172) loses its marker.

DB LANE: one local DB. At most 2 SQL sessions run at once, on disjoint migration files; announce
each `deno task db:reset`. Run probes with `deno task test:probes` while you iterate, and finish
with your own clean `deno task test:probes:fresh`.

ACCEPTANCE:
  - ticket_archive_and_removal.sql (ROLLBACK): removing a freelancer from a claimed, unstarted
    ticket refunds 100 % and resets it to the backlog with payment_status 'refunded', and
    fund_ticket can fund it again; removal from an in_progress ticket splits at its floor and
    re-pools it; deleting an untouched ticket hard-deletes it; deleting a funded one archives it
    with its ticket_history and workload-report rows intact; deleting one with a submission
    archives it (no 23503); delete_stage on a stage holding escrow archives it and settles every
    ticket on it; an owner's direct UPDATE clearing the assignee of a ticket that still holds
    escrow → 55000; an owner's DELETE on projects.projects affects nothing; a stage DELETE through
    PostgREST is refused.
  - finance_invariants.sql, fair_exit_floor.sql and claim_ttl_sweep.sql (now expecting
    'refunded') pass; funding-state.test.ts covers a re-pooled ticket and a cancelled one.
```

### PM-P6 — Every stage holds escrow at its own price

```text
PROMPT PM-P6: Every stage holds escrow at its own price

ROLE: Postgres engineer.

CONTEXT: DL S11 (its second half); audit X13 (every hold is priced
COALESCE(ticket.unit_price_cents, stage.unit_price_cents), now at 00001200:394); #338 flag (k)
(Decision #338, ruling P6: "per stage — each stage holds escrow at its own price"). Today a
ticket-level price overrides every stage price in its Chain Reaction. It edits 00001200, so it runs
in the finance window (PM_BUILD_PROMPTS §0), after PM-WP4b.

🧑 DECISION — what a ticket-level price still means (STOP before step 2; a new contradiction,
PM_BUILD_PROMPTS §0.5). PRODUCT_SPEC.md:1472-1475 (ruling P6) says a price set on the ticket "never
overrides the stages it passes through". PRODUCT_SPEC.md:2272-2283 (Purchase Methods, as built)
and the ticket composer hold a ticket "at its own price (else its stage's)". Read strictly, P6
leaves a ticket price nothing to price. Put to me:
  Option A (recommended): a ticket price applies only to a ticket that requires ONE stage; it is
  that stage's price for that ticket. A multi-stage ticket is priced by its stages. The composer
  offers no ticket price once a second stage is required, and the write path refuses one (422)
  rather than ignoring it.
  Option B: retire ticket-level prices; every hold is at the stage price.
  Option C: a ticket price applies to its first stage only; later stages use their own.

FILES (after the ruling; Option A shown):
  - supabase/migrations/00001130_functions_projects_stages.sql (projects.fn_ticket_stage_price new)
  - supabase/migrations/00001200_functions_finance_core.sql (fn_hold_ticket_escrow :370, its price
    at :394)
  - supabase/migrations/00001120_functions_projects_ticket_lifecycle.sql (get_ticket_finance's
    installments :145, which mirror the hold)
  - supabase/migrations/00001150_functions_projects_stage_funding_submissions.sql
    (fn_stage_funding_need :721-723, fund_ticket :956, get_stage_finance :1340)
  - supabase/migrations/00001250_functions_finance_auto_fund_billing.sql (:127, :174, :235, which
    repeat the expression; the finance track's file, so check git log for a peer first)
  - grep the migrations for COALESCE(t.unit_price_cents and COALESCE(tk.unit_price_cents to catch
    any copy this list misses
  - packages/types/projects/board.ts (the pure mirror, ticketStagePrice) + a parity test against a
    SQL probe (ruling P5 (e))
  - packages/backend/services/projects/live-writes.ts (the composer's write refusal, and the ticket
    rate it picks: grep unit_price_cents) and the ticket composer component
  - supabase/probes/stage_own_price.sql (new); chain_reaction.sql (its expectations)
  - supabase/seeds (any multi-stage ticket that carries its own price)

STEPS:
  1. Reproduce: a two-stage ticket priced 50 000 on stages priced 30 000 and 80 000. Approve stage
     one; today stage two is held at 50 000. After the fix it is held at 80 000.
  2. fn_ticket_stage_price(p_ticket, p_stage) is the one pricing rule: the stage's
     unit_price_cents, or the ticket's own price when the ticket requires exactly that one stage
     (Option A). Every hold, every funding quote, the finance reads and the auto-fund sums call
     it. The TS mirror serves display only and is pinned by the parity test.
  3. The composer shows the ticket price only on a single-stage ticket, and the write path refuses
     a ticket price on a multi-stage ticket (422 {code: 'ticket_price_multi_stage'}). The
     claimed-terms freeze is unchanged.
  4. The seeds load.

SAME CHANGE: Functions.md. PRODUCT_SPEC.md:1472-1475 loses its **Not built yet**, and :2272-2283
says what the ruling says. PRODUCT_MANAGEMENT.md §3.6 loses its marker (:474-475).
flows/Projects.md §4.5 follows if it states the rule. No schema change; no Dev axis.

DB LANE: one local DB. At most 2 SQL sessions run at once, on disjoint migration files; announce
each `deno task db:reset`. Run probes with `deno task test:probes` while you iterate, and finish
with your own clean `deno task test:probes:fresh`.

ACCEPTANCE: stage_own_price.sql holds stage two at 80 000 and a single-stage ticket at its own
price; chain_reaction.sql and finance_invariants.sql pass; the parity test is green.
```

### PM-GH1 — A silent client cannot hold money forever

```text
PROMPT PM-GH1: A silent client cannot hold money forever: the 14-day auto-approve

ROLE: Postgres + backend engineer.

CONTEXT: FDD D-9 (a) (Decision #337, ruling P3: "Build (P1)", which the No Forever-Escrow
Guarantee needs); PRODUCT_SPEC.md:1651-1654; finance-model.md §8 (:330-333); PRODUCT_MANAGEMENT.md
§3.6 (:444, :479-482). A submission the client neither approves nor disputes is approved 14 days
after it was sent, through the normal release, with reminders to the client at 7 and 13 days.
Today nothing times out, and nothing records when a submission was sent (a draft's created_at is
not its send time). The catalogue already has submission.auto_approved (00005010:50);
comms.fn_enqueue and comms.fn_cancel_queued (00001310:598, :654) queue and cancel dated promises;
the jobs branch registers their worker (comms-process-queue). Part C lists the ghosting timer under
track F. This file carries it because its clock and its doors are the projects'. If the refreshed
FINANCE_BUILD_PROMPTS.md carries one too, the coordinator keeps one of them. WAIT for F·DB3 (the
release refuses PD409 'dispute_open') and the jobs merge. It releases money through 00001200 and
00001240, so it runs in the finance window and never beside an F prompt that edits them.

FILES:
  - supabase/migrations/00000015_tables_projects.sql (stage_submissions.submitted_at timestamptz)
  - supabase/migrations/00001150_functions_projects_stage_funding_submissions.sql (fn_enter_review
    :189 stamps the time and enqueues the reminders; review_submission :332's accept body becomes
    fn_accept_submission(p_submission, p_auto boolean), shared with the sweep;
    fn_auto_approve_stale_submissions new)
  - supabase/migrations/00001120_functions_projects_ticket_lifecycle.sql
    (fn_ticket_review_submission :261: a submission that leaves review cancels its reminders)
  - supabase/migrations/00005001_seed_platform_params.sql (submission_auto_approve_days 14;
    submission_reminder_days [7, 13])
  - supabase/migrations/00005010_seed_notification_catalog.sql (submission.auto_approve_reminder)
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (projects-auto-approve-submissions)
  - supabase/migrations/00002510_permissions_function_grants.sql (the sweep: service_role only)
  - packages/types/projects/submissions.ts (autoApproveAt), rows.ts (submittedAt)
  - packages/backend/services/projects/live-submissions.ts + test
  - apps/web/features/projects/islands/SubmissionExplorer.island.tsx, components/SubmissionCard.tsx
  - apps/web/features/devtools/*, apps/web/utils/dev-seam.ts (autoApprove axis)
  - supabase/probes/ghosting_auto_approve.sql (new)

STEPS:
  1. submitted_at is stamped when a row enters pending_review (submit_deliverable,
     send_submission_draft, fn_enter_review). A resubmission after revisions_requested is a new row
     with its own stamp. The seeds stamp created_at.
  2. At send, enqueue two reminders (comms.fn_enqueue; dedupe keys 'submission:<id>:auto_approve:7'
     and ':13'; scheduled for submitted_at + 7 days and + 13 days) to the project owner and, on a
     business project, each active member holding `hire`, since only they can approve. A verdict, a
     move out of review, a Fair Exit or an archive cancels them (comms.fn_cancel_queued on the
     submission).
  3. projects.fn_auto_approve_stale_submissions(p_now timestamptz DEFAULT now(), p_limit integer
     DEFAULT 100) takes pending_review submissions with submitted_at ≤ p_now − 14 days whose ticket
     is in_review with a held escrow and no open dispute (finance.fn_escrow_has_open_dispute),
     locked FOR UPDATE SKIP LOCKED. Each is accepted through fn_accept_submission(…, p_auto =>
     true), the path a reviewer's Accept takes, so the release, the 7-day pending window and the
     Chain Reaction run unchanged. The authority checks stay in review_submission; the shared body
     assumes them, and the platform (no auth.uid()) passes fn_assert_business_actor as it does
     today. reviewed_by stays NULL; a ticket_history 'auto_approved' row is
     written; both sides get submission.auto_approved. A refusal (PD409, PF402) skips the row and
     writes an ops.log_entries row; the sweep never raises.
  4. Register projects-auto-approve-submissions in 00005060: hourly, on a minute no other job uses.
  5. The reviewer's explorer and the submission card show "Approves automatically on <date>" as
     MetaLine text (tabular-nums) from the DTO's autoApproveAt, which the server computes; the
     island never does.
  6. Dev Context Switcher: autoApprove (auto · due_in_7_days · due_tomorrow · auto_approved) forces
     autoApproveAt and the approved state under the dev seam. DevOverrides + DEV_DEFAULTS, DevOption
     list, DevContextPanel control, reflect() set AND delete.

SAME CHANGE: submitted_at → rows.ts + Tables.md; Functions.md. PRODUCT_SPEC.md:1651-1654,
finance-model.md:330-333 and PRODUCT_MANAGEMENT.md :444 and :479-482 lose their **Not built yet**.
SYSTEM_ARCHITECTURE.md §Scheduled jobs lists the job.

DB LANE: one local DB. At most 2 SQL sessions run at once, on disjoint migration files; announce
each `deno task db:reset`. Run probes with `deno task test:probes` while you iterate, and finish
with your own clean `deno task test:probes:fresh`.

ACCEPTANCE:
  - ghosting_auto_approve.sql (ROLLBACK): a submission sent 14 days ago is accepted, its escrow
    released into the pending window, its ticket completed (or chained to its next stage), and
    both sides are told; one sent 13 days ago is untouched; one with an open dispute is skipped and
    logged; the reminders are queued at send for +7 and +13 days and cancelled by a revision
    request; a second run releases nothing.
  - finance_invariants.sql passes; the live-submissions tests cover autoApproveAt.
```

---

## 4. Phase 3 — Workload & reliability

### PM-WP5a — Workload reporting reaches the product

```text
PROMPT PM-WP5a: Workload reporting reaches the product and treats both sides fairly

ROLE: Full-stack engineer (SQL, Zod, service, route, island).

CONTEXT: DL §3 W1-W8 and W10, and its "minimum to ship"; audit X18; DL D5; #338 flag (e); #290
(a), (d), (e); #293 (e) (Decision #338, ruling P3: the owner chose "Build now"; ruling P4: W_i is
the difficulty multiplier alone, which closes W9, since the disputed number is now the spec's).
W7 merged in Wave 0 (check_ticket_capacity counts reported_hidden): verify it, do not redo it.
Ruling Q0.3's reading: this prompt, not the jobs session, registers the expiry sweep, because
before these fixes it would penalise clients for tickets they had settled. It follows PM-WP4b,
whose settlements must close a report (W4).

🧑 DECISION — the penalty sizes (STOP before seeding them). Both are seeded 0
(00005001:32-35), so no penalty bites (W3), and no source sizes them. They land on
security.penalties' 0-10 scale (full strength at 10; finance-model.md §16.7). Recommendation:
client non-response 2 (trust_score); the reporter on non-response 1 (discovery_rank: "both parties
incur a penalty", PRODUCT_SPEC §Dispute Mechanism 3); an unsubstantiated report 3
(discovery_rank). Until it is ruled, keep 0 and say so in the commit.

FILES:
  - supabase/migrations/00001140_functions_projects_automation_workload.sql (file_workload_report
    :729; answer_workload_report new; fn_resolve_expired_workload_reports :135;
    fn_close_settled_report new)
  - supabase/migrations/00001110_functions_projects_ticket_guards.sql (fn_assert_ticket_move :97)
  - supabase/migrations/00001850_triggers_projects_tickets.sql (the settlement-close trigger)
  - supabase/migrations/00002011_policies_projects.sql ("View tickets" :327, for reported_hidden)
  - supabase/migrations/00002510_permissions_function_grants.sql (file_workload_report and
    answer_workload_report → authenticated)
  - supabase/migrations/00004003_indexes_projects.sql (uq_workload_reports_open)
  - supabase/migrations/00005001_seed_platform_params.sql (the dials, per the ruling)
  - supabase/migrations/00005010_seed_notification_catalog.sql (workload_report.filed,
    workload_report.answered, workload_report.lapsed)
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (projects-resolve-workload-reports)
  - packages/types/projects/workload.ts (new: WorkloadReportSchema 1:1 with
    ticket_workload_reports, FileWorkloadReport, AnswerWorkloadReport) + its mod.ts export
  - the P4 cleanup: packages/types/projects/board.ts (:102-137, :852);
    packages/backend/services/projects/{live-board.ts (:86-182, :745, :1265), board-fixtures.ts
    (:232-241, :1183), live-writes.ts (:149, :2211)}; apps/web/features/projects/core/
    {ticket-model.ts (:207), ticket-view.ts (:628)}; the tests beside each
  - packages/backend/services/projects/ProjectBackendService.ts + tests
  - apps/web/routes/api/projects/ticket/workload-report.ts (new)
  - apps/web/features/projects/components/ticket/TicketView.tsx (Report workload; Raise W_i)
  - apps/web/features/devtools/*, apps/web/utils/dev-seam.ts (workloadReport axis)
  - supabase/probes/workload_report_lifecycle.sql (new); workload_report_suspension.sql (extend)

STEPS:
  1. The P4 cleanup: W_i is the difficulty multiplier. Remove categoryWeight from BoardStageRef;
     change workloadIntensity(categoryWeight, intensity) to workloadIntensity(intensity); delete
     NEUTRAL_CATEGORY_WEIGHT and the fixtures' CATEGORY_WEIGHTS; fix every caller and comment.
  2. Reproduce W1 (file_workload_report through PostgREST → 42501, ungranted), W4 (approve the
     stage while a report is open: the report stays open, and the sweep later penalises the client)
     and W6 (review authority moves a reported_hidden ticket to todo: allowed, and the report stays
     open).
  3. SQL:
       a. Grant file_workload_report to authenticated. It still admits only the assignee.
       b. answer_workload_report(p_report_id, p_new_intensity numeric): any of the client's
          reviewers (review authority, W5) raises the W_i above its current value. It resolves the
          report 'adjusted' and resumes the work (the existing fn_adjust_workload_report path).
          "View tickets" lets review authority see a reported_hidden ticket (W5).
       c. W3: the sweep penalises the client AND the reporter on non-response, at the dials the
          ruling sets (a new reporter dial beside the two that exist).
       d. W4: a report whose ticket is settled closes as 'acknowledged', defined here as "closed
          because the ticket was settled; nobody is penalised" (W10: nothing writes the value
          today). One AFTER UPDATE OF status trigger closes the open report when its ticket leaves
          reported_hidden while that report is still open. That covers every settlement path at
          once: approve (completed, or in_progress on the next stage under the Chain Reaction),
          Fair Exit (cancelled), removal (backlog) and deletion (cancelled). The report's own
          resolutions (adjusted, lapsed, dismissed) close it before they resume the ticket, so the
          trigger never closes one twice.
       e. W6: fn_assert_ticket_move refuses every move out of reported_hidden: 42501 'Answer the
          workload report (raise its W_i) or settle the ticket.' The payee is already refused.
       f. W10: CREATE UNIQUE INDEX uq_workload_reports_open ON projects.ticket_workload_reports
          (ticket_id) WHERE status = 'open'.
       g. Only after a-f: register projects-resolve-workload-reports in 00005060 (every 15 minutes,
          on minutes no other job uses), enabled.
  4. Zod, service and route: fileWorkloadReport and answerWorkloadReport on ProjectBackendService
     (ServiceResult; the stub uses the same predicates); POST /api/projects/ticket/workload-report
     {action: 'file' | 'answer', …}, thin.
  5. The ticket modal: the assignee's "Report workload" (tier 5 in TicketMenu, opening a Dialog with
     a reason and a suggested W_i; "Report" is tier 3); for review authority on a suspended ticket,
     the countdown to hidden_until (MetaLine, tabular-nums) and "Raise W_i" (tier 3). The card's
     Hidden state stays a lifecycle Tag.
  6. Dev Context Switcher: workloadReport (auto · none · open_as_reporter · open_as_client ·
     adjusted · lapsed) forces the suspended ticket's state under the dev seam. DevOverrides +
     DEV_DEFAULTS, DevOption list, DevContextPanel control, reflect() set AND delete.
  Out of scope (PM_BUILD_PROMPTS §0.6): W8, a moderator's verdict and the client's "keep" answer
  (PRODUCT_SPEC §Dispute Mechanism 4); fn_flag_bad_faith_report stays service-role only.

SAME CHANGE: workload.ts mirrors the table 1:1, under the contract test; Functions.md, Policies.md
and Tables.md (the index). PRODUCT_MANAGEMENT.md §3.5 gains a Workload report lifecycle row (open →
adjusted | expired_penalized | dismissed_bad_faith | acknowledged), and §3.6 rule (7) loses its
**Not built yet** (:529-530). PRODUCT_SPEC.md:2436-2441 loses its marker, and §Dispute Mechanism 4
(Unsubstantiated Report) gains one for the moderator half. SYSTEM_ARCHITECTURE.md §Scheduled jobs.
DESIGN_SYSTEM.md §C.1 only if a packages/ui component changes.

DB LANE: one local DB. At most 2 SQL sessions run at once, on disjoint migration files; announce
each `deno task db:reset`. Run probes with `deno task test:probes` while you iterate, and finish
with your own clean `deno task test:probes:fresh`.

ACCEPTANCE:
  - workload_report_lifecycle.sql (ROLLBACK): the assignee files through the granted door; a
    second open report on the ticket is refused (the unique index); a business reviewer who is not
    the owner sees the ticket and raises its W_i, which resumes the work; a lapse penalises both
    sides at the dial values; approving the stage closes the report 'acknowledged', and the sweep
    then skips it; a reviewer's move out of Hidden is refused; capacity still counts the suspended
    ticket (X4, W7).
  - workload_report_suspension.sql passes; the service, route and stub-parity tests are green.
```

### PM-WP5b — The Reliability Index measures delivery efficiency

```text
PROMPT PM-WP5b: The Reliability Index measures how efficiently someone delivers

ROLE: Postgres + backend engineer (org standing).

CONTEXT: Decision #338, ruling P4: two numbers. W_i stays the per-ticket load. The owner's
data-based measure (estimated against actual time, the client's requested deadline against
delivery, the slow-down across concurrent projects) extends the Reliability Index, at a baseline
until enough data exists, and both weigh heavily in search. DL D9 and W9 were rejected in its
favour. PRODUCT_SPEC.md:2766-2773; finance-model.md §16.3 (:758-762). Verified 2026-10-30: nothing
in the product writes org.entity_standing's inputs or calls org.fn_recompute_standing (only
supabase/seeds/11_standing.sql does), and its weights are literals (00001030:69-77) although §16.3
calls them dials. So the efficiency terms need their data AND a recompute. "Deadline adherence" is
the on-time input that already exists (on_time_rate, 25 points): make it real rather than adding a
twin (rollup, not restatement). It follows PM-WP5a and PM-GH1 (it reads submitted_at).
Cross-track: M·search's "Load and reliability" weights (finance-model §16.7 :881) wait for it.

🧑 DECISION — three inputs only the owner can set. STOP before steps 4, 5 and 6; build 1-3 and 7
now.
  (a) Where a freelancer states how long the work will take; no column holds it. Recommended: an
      optional delivery estimate at claim (a date), tickets.estimated_delivery_at, shown to the
      client and, after the claim, changed only through PM-WP6's agreement door. Alternatives: on
      the stage application; or no estimate (the term is dropped).
  (b) The weights, the minimum history and the baseline. Recommended: every weight a
      security.platform_params dial, defaulting to today's literals (25/25/20/15/10/5); the two new
      terms at weight 0 until the owner sets them, so no score moves; a minimum of 5 delivered
      tickets; below it a term reads the platform median (0.5 when there is none).
  (c) Still open on #338 P4: is project_stages.create_category stored as a label for the CREATE
      mastery track (org.create_mastery, org.fn_record_mastery; finance-model §2)? Recommended:
      yes, a nullable label (the org.create_category enum exists) set in the stage form, weighting
      nothing, with fn_record_mastery called at stage settlement. If no: delete the mastery-track
      promise from PRODUCT_SPEC §Standing and leave org.create_mastery dormant (never drop it; the
      Additive Rule).

FILES:
  - supabase/migrations/00000011_tables_org.sql (entity_standing: load_resilience,
    estimate_accuracy, delivery_samples, in place)
  - supabase/migrations/00001030_functions_org_standing.sql (fn_recompute_standing :44;
    fn_refresh_delivery_inputs new)
  - supabase/migrations/00001850_triggers_projects_tickets.sql (the recompute trigger)
  - supabase/migrations/00005001_seed_platform_params.sql (the dials, after (b))
  - supabase/migrations/00000015_tables_projects.sql (estimated_delivery_at after (a);
    create_category after (c))
  - packages/types (the entity_standing row schema; projects rows.ts per the rulings)
  - packages/backend/services/finance/wallet-standing.ts (:19-25, the weights it restates) and the
    profile readers of the components (00001040:466)
  - the profile's Standing breakdown component
  - apps/web/features/devtools/*, apps/web/utils/dev-seam.ts (reliabilityHistory axis)
  - supabase/probes/reliability_inputs.sql (new)

STEPS:
  1. Deadline adherence → on_time_rate. A delivered ticket (its first sent submission,
     stage_submissions.submitted_at from PM-GH1) on or before its deadline (the agreed ticket
     due_date, else the stage deadline from PM-WP4a's clock) is on time. A ticket with no deadline
     counts neither way.
  2. Load resilience, per freelancer: the median delivery time (claimed_at → first sent
     submission) per unit of W_i while they held tickets on two or more projects, against the same
     while they held one; resilience = min(1, single ÷ concurrent). It comes from tickets and
     stage_submissions; nothing new is captured.
  3. Recompute on settlement: when a ticket completes, or is settled by Fair Exit or removal, an
     AFTER trigger calls org.fn_refresh_delivery_inputs(subject) and then org.fn_recompute_standing
     for the payee (and for the team, when the seat is a team's). Event-driven; no job.
  4. (After (a).) Estimate accuracy = 1 − min(1, |actual − estimated| ÷ estimated duration), and
     the claim dialog's optional estimate field.
  5. (After (b).) The weights become dials that fn_recompute_standing reads; the baseline applies
     below the minimum history.
  6. (After (c).) The label and the fn_record_mastery call, or the doc deletion.
  7. The profile's Standing breakdown names each term, with "Not enough history yet" as Meta text
     at the baseline. Dev Context Switcher: reliabilityHistory (auto · baseline · measured).
     DevOverrides + DEV_DEFAULTS, DevOption list, DevContextPanel control, reflect() set AND delete.

SAME CHANGE: the entity_standing columns → the org row schema and
documentation/database/org/{Tables,Functions}.md. finance-model.md §16.3 (:758-762) loses its
**Not built yet**, names deadline adherence as the on-time input, and lists the dials.
PRODUCT_SPEC.md:2766-2773 loses its marker; :2794-2795 stays for M·search.

DB LANE: one local DB. At most 2 SQL sessions run at once, on disjoint migration files; announce
each `deno task db:reset`. Run probes with `deno task test:probes` while you iterate, and finish
with your own clean `deno task test:probes:fresh`.

ACCEPTANCE: reliability_inputs.sql (ROLLBACK): six deliveries, four of them on time → on_time_rate
0.6667 and a standing_events row; three deliveries → the baseline; resilience from a fixture of
single and concurrent deliveries; with the new weights at 0, every seeded score is unchanged.
```

---

## 5. Phase 4 — Stage state & the dependency engine

### PM-S3 — A stage's status says what its tickets say

```text
PROMPT PM-S3: A stage's status says what its tickets say

ROLE: Full-stack engineer.

CONTEXT: DL S3; audit X19; PRODUCT_MANAGEMENT.md §3.4 (rollup derivation) and §3.5's Stage
settlement row (:253: "approved, submitted and revisions are written by no function today"). S3
needs no ruling of its own (#338's rulings unblock it, Part C). Nothing writes submitted, approved
or revisions; a stage reaches paid while unfunded or backlog tickets stay open on it; and review
authority may write any stage status directly under the FOR ALL policy (00002011:282). It follows
PM-D7a (both edit 00001100 and 00001850).

FILES:
  - packages/types/projects/stage-status.ts (new: the StageDisplayStatus enum and
    deriveStageDisplayStatus) + stage-status.test.ts, and its mod.ts export
  - supabase/migrations/00001100_functions_projects_read_access.sql
    (projects.fn_stage_display_status)
  - supabase/migrations/00001130_functions_projects_stages.sql (fn_guard_stage_status) +
    00001850_triggers_projects_tickets.sql (its trigger)
  - packages/backend/services/projects/{live-board.ts, live-overview.ts, live-detail.ts,
    live-queries.ts} and the timeline read + tests
  - apps/web/features/projects/components/StageStatusIcon.tsx and every component that renders a
    stage's status
  - supabase/probes/stage_display_status.sql (new; it also prints the matrix the parity test reads)

STEPS:
  1. One pure rule, deriveStageDisplayStatus, mirrored in SQL as fn_stage_display_status and
     pinned by a parity test that runs one truth table through both (ruling P5 (e); ADC Q14 A).
     Inputs: the stored settlement status, whose terminal values win (paid → Complete,
     cancelled → Cancelled); and the stage's children, which are the tickets on it now plus those
     that passed through it (a released escrow for this stage). The order is PRODUCT_MANAGEMENT
     §3.4's: Disputed (an open dispute on one of the stage's escrows) > Complete (every child
     terminal, at least one completed) > In progress (any in_progress or in_review) > Claimed >
     Ready (todo) > Backlog > Draft (no children). A blocked flag is set when a non-terminal child
     is reported_hidden or needs funding.
  2. Every surface that shows a stage status reads the derived value from its server DTO: the
     board's BoardStageRef, the overview, the lane, the timeline and the stage details. Grep
     stage_status, StageStatus and stageStatus across packages/backend/services/projects and
     apps/web/features/projects.
  3. Direct writes of project_stages.status stop. fn_guard_stage_status (BEFORE UPDATE OF status)
     refuses a change made by anon or authenticated (fn_ticket_immutability_guard's current_user
     idiom). fund_stage, approve_stage and cancel_stage_fair_exit are definers and still write it;
     the FOR ALL policy keeps the other columns.
  4. The stored column becomes the money doors' alone: open, assigned, in_progress, paid,
     cancelled. submitted, approved and revisions stay in the enum, documented as reserved, and are
     never dropped.

SAME CHANGE: PRODUCT_MANAGEMENT.md §3.4 names the stage display status, and §3.5's Stage
settlement row says the stored status belongs to the money doors; Functions.md and Policies.md. No
Dev axis: the display status derives from states the existing axes already drive.

DB LANE: one local DB. At most 2 SQL sessions run at once, on disjoint migration files; announce
each `deno task db:reset`. Run probes with `deno task test:probes` while you iterate, and finish
with your own clean `deno task test:probes:fresh`.

ACCEPTANCE: the parity test is green. stage_display_status.sql: an owner's direct UPDATE of status
is refused; one backlog and one in_progress ticket → In progress; a paid stage → Complete; a stage
with an open dispute → Disputed; approve_stage still settles.
```

### PM-D7b — A waiting stage opens when its predecessor completes

```text
PROMPT PM-D7b: A stage that waits for another opens when it completes, and funds under the Chain
Reaction

ROLE: Postgres + backend engineer.

CONTEXT: DL D7 and C3; #338 flag (g) (Decision #338, ruling P3: the owner chose the engine, read as
"a stage opens, and with chain_reaction funds, when its predecessor completes", built after the
cycle guard and priced per ruling P6); PRODUCT_SPEC.md:2518-2522; PRODUCT_MANAGEMENT.md §3.6
(:475-477). Today the form collects a dependency and a delay per stage, and nothing reads them
(C3). A stage completes when approve_stage marks it paid and stamps completed_at (00001150:1633).
It follows PM-D7a (the guard), PM-P6 (each stage's own price) and PM-GH1 (00001150).

🧑 DECISION — two runtime gaps no source covers. STOP before steps 4 and 5; build 1-3, 6 and 7
now.
  (a) A negative delay. setup.ts:277-281 calls it "the overlap a real schedule has", but a
      completion cannot be anticipated. Recommended: a delay of 0 or more opens that many days
      after the predecessor completes; a negative delay opens that many days before the
      predecessor's deadline when it has one and has started (PM-WP4a's clock), else at its
      completion. Alternative: a negative delay opens at completion, and the Timeline alone shows
      the planned overlap.
  (b) A predecessor that never completes (ended under Fair Exit, or archived). Recommended: the
      dependant keeps waiting, and review authority may open it by hand (projects.open_stage),
      which is also how a client opens a stage early; its seats are told. Alternative: a cancelled
      predecessor opens its dependants at once.

FILES:
  - supabase/migrations/00000015_tables_projects.sql (project_stages.opened_at, set once)
  - supabase/migrations/00001130_functions_projects_stages.sql (fn_stage_is_open,
    fn_open_due_stages, open_stage)
  - supabase/migrations/00001150_functions_projects_stage_funding_submissions.sql (approve_stage
    :1518 schedules its dependants)
  - supabase/migrations/00001120_functions_projects_ticket_lifecycle.sql (claim_ticket :476)
  - supabase/migrations/00001140_functions_projects_automation_workload.sql (fn_assign_ticket_core)
  - supabase/migrations/00001100_functions_projects_read_access.sql (set_project_status stamps
    opened_at at publish)
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (projects-open-due-stages)
  - supabase/migrations/00005010_seed_notification_catalog.sql (stage.opened)
  - supabase/migrations/00002510_permissions_function_grants.sql (open_stage → authenticated)
  - packages/types/projects/{rows.ts, board.ts, timeline.ts} (opensAt, waitingFor)
  - packages/backend/services/projects/{live-board.ts, live-detail.ts, live-writes.ts} and the
    timeline read + tests; the setup form's "Starts with" copy
  - apps/web/features/devtools/*, apps/web/utils/dev-seam.ts (stageStart axis)
  - supabase/probes/stage_dependency_engine.sql (new)

STEPS:
  1. Waiting: a stage whose start_trigger_type is dependent_on_stage waits until opened_at is set.
     Staffing (seats, invitations, applications) and prepayment work as today. A claim, an
     assignment and any entry into work on it are refused (claim_ticket and fn_assign_ticket_core:
     55000 'This stage starts when <predecessor> completes.'). Every other stage is open from
     publish (set_project_status stamps opened_at); fixed_date and on_hire_confirmed keep today's
     behaviour (PM_BUILD_PROMPTS §0.6).
  2. Opening: when approve_stage completes a stage, each live dependant gets its opening time
     (completed_at + its delay, per (a)). projects.fn_open_due_stages(p_now, p_limit), registered
     every 15 minutes, opens each due stage once: it stamps opened_at and tells the stage's seats
     and the client (stage.opened). When the dependant's chain_reaction is on, it holds escrow for
     each ticket waiting there at that stage's own price (fn_ticket_stage_price, PM-P6) through the
     hold path fund_stage uses, prepaid when unclaimed (#197), and marks a refused hold Needs
     funding (fn_mark_needs_funding, trigger 'dependency_open'). With chain_reaction off they wait
     as Draft.
  3. A multi-stage ticket the Chain Reaction (force_complete_stage) carries onto a waiting stage
     arrives and waits there; its work starts when the stage opens.
  4. (After (a).) The negative delay.
  5. (After (b).) projects.open_stage(p_project_id, p_stage_id): review authority plus `hire`; it
     opens the stage now and funds it as in step 2.
  6. The stage header and the Timeline say "Starts when <stage> completes" or "Opens <date>" as
     MetaLine text from the DTO's waitingFor and opensAt, never derived in the island. The setup
     form's dependency copy promises what the engine now does.
  7. Dev Context Switcher: stageStart (auto · open · waiting · opening_scheduled). DevOverrides +
     DEV_DEFAULTS, DevOption list, DevContextPanel control, reflect() set AND delete.

SAME CHANGE: opened_at → rows.ts + Tables.md; Functions.md. PRODUCT_SPEC.md:2518-2522 and
PRODUCT_MANAGEMENT.md :475-477 lose their **Not built yet**; PRODUCT_MANAGEMENT.md §3.5 gains a
Stage opening row (waiting → open). flows/Projects.md §4's Starts and Delay rows follow.
SYSTEM_ARCHITECTURE.md §Scheduled jobs lists the job.

DB LANE: one local DB. At most 2 SQL sessions run at once, on disjoint migration files; announce
each `deno task db:reset`. Run probes with `deno task test:probes` while you iterate, and finish
with your own clean `deno task test:probes:fresh`.

ACCEPTANCE:
  - stage_dependency_engine.sql (ROLLBACK): B waits for A with a 2-day delay; a claim on B is
    refused while A runs; approving A schedules B; after backdating, the sweep opens B once; with
    chain_reaction on, B's waiting tickets are held at B's own price or marked Needs funding; with
    it off they stay Draft; a second sweep holds nothing twice.
  - stage_dependency_guard.sql and finance_invariants.sql pass.
```

---

## 6. Phase 5 — Board & addresses

### PM-WP6 — Board authority and the due-date agreement

```text
PROMPT PM-WP6: Only people who may move a ticket can drag it; a claimed ticket's due date changes
by agreement

ROLE: Full-stack engineer.

CONTEXT: DL D12, D16-b; audit X11; RED L-03, SC-3, SC-4; ADC Q14; #293 (b), (c), (d); #294 (b);
#291 (c) (Decision #338, rulings P5 (a), (b), (c), (e); #341 (n)). Today any participant can move
an unclaimed ticket: fn_assert_ticket_move returns at once for a ticket with no assignee
(00001110:97), and move_ticket asks only has_project_access (00001120:399). That includes moving a
paid ticket into an unpaid stage, which hides it from everyone. canDrag is true for every
client-side viewer and for every provider on a stage board (ProjectBoard.island.tsx:303-308), so
the board offers drops the database refuses (L-03). due_date is not among the claimed terms
fn_ticket_immutability_guard freezes, so either party may change it alone. WAIT for O·WP5 (RED
SC-3: one home for shared pure rules, with its parity-test harness). This prompt builds the board's
canMove flag (SC-4); O·WP6 adopts it and must not run beside this prompt. It follows PM-WP5a
(00001110).

🧑 DECISION — who on the client side may move a claimed ticket (STOP before step 5; a new
contradiction, PM_BUILD_PROMPTS §0.5). PRODUCT_SPEC.md:2351-2363 (ruling P5 (b)) says "the
project's owner or an admin with explicit permission". PRODUCT_MANAGEMENT.md §3.6 rules (8) and
(10), and fn_assert_ticket_move, say review authority: the owner or ANY active member of the
paying business (can_review_project). Put to me:
  Option A (recommended): narrow the database to the spec. On a claimed ticket the client side is
  the owner, or a member of the paying business holding manage_projects (the delivery capability
  in org.workspace_capability), and rule (8) says so. Unclaimed moves stay with review authority
  plus granted ticket managers (ruling P5 (a)).
  Option B: keep review authority, and amend PRODUCT_SPEC's sentence to "the client (review
  authority)".
Build steps 1-4 and 6-8 on today's set; step 5 follows the ruling.

FILES:
  - supabase/migrations/00001110_functions_projects_ticket_guards.sql (fn_assert_ticket_move :97;
    fn_ticket_immutability_guard :197, its claimed terms and its unclaimed early return :294)
  - supabase/migrations/00001120_functions_projects_ticket_lifecycle.sql (propose_ticket_due_date
    and answer_ticket_due_date new)
  - supabase/migrations/00000015_tables_projects.sql (tickets.due_date_proposed,
    due_date_proposed_by, due_date_proposed_at)
  - supabase/migrations/00002510_permissions_function_grants.sql;
    00005010_seed_notification_catalog.sql (ticket.due_date_proposed, ticket.due_date_answered)
  - the shared pure-rule home O·WP5 created (else packages/types/projects/board.ts):
    ticketMoveAllowed and its parity test
  - packages/types/projects/{board.ts (BoardCard.canMove, moveTargets), rows.ts}
  - packages/backend/services/projects/{live-board.ts (viewerIsClientOf, :1392, stops gating
    moves), ProjectBackendService.ts (the stub move, :3079)} + tests
  - apps/web/routes/api/projects/ticket/due-date.ts (new)
  - apps/web/features/projects/islands/ProjectBoard.island.tsx (:303-308, :761-764);
    components/ticket/TicketView.tsx and its Details tab
  - apps/web/features/devtools/*, apps/web/utils/dev-seam.ts (dueDateProposal axis)
  - supabase/probes/ticket_move_authority.sql (extend); ticket_due_date_agreement.sql (new);
    ticket_move_matrix.sql (new: the matrix the parity test reads)

STEPS:
  1. Reproduce D12 (a seated freelancer moves an unclaimed, funded ticket to another stage through
     move_ticket: it succeeds today) and L-03 (a viewer drags a card the database then refuses).
  2. SQL: an unclaimed ticket moves only for review authority or projects.is_ticket_manager (ruling
     P5 (a)), and no move carries an unclaimed ticket into claimed, in_progress or in_review (those
     take a claim). The table path asks the same: fn_ticket_immutability_guard calls the assertion
     for an anon or authenticated statement on an unclaimed ticket too.
  3. The pure rule ticketMoveAllowed({viewer: {isReviewer, isTicketManager, isAssignee, isAdmin},
     ticket: {assigned, status}, move: {toStatus, stageChange}}) is status × role only, with no
     balances. The parity test runs the full truth table against fn_assert_ticket_move through
     ticket_move_matrix.sql (ADC Q14 A).
  4. The flag: BoardCard.canMove and moveTargets (the columns the card may enter), computed in
     live-board.ts from the pure rule and the viewer's server-known authority. canDrag reads them,
     and the stub move uses the same rule (stub parity).
  5. (After the ruling.) Option A narrows the client side of a claimed ticket's move in the SQL,
     the pure rule and the flag together.
  6. The due date (ruling P5 (c)). due_date joins the claimed terms fn_ticket_immutability_guard
     freezes, for both sides. propose_ticket_due_date(p_ticket, p_due_date, p_note) is for the
     assignee or review authority on a claimed, in_progress or in_review ticket, with one live
     proposal per ticket. answer_ticket_due_date(p_ticket, p_accept) is for the OTHER side only;
     accepting applies the date. Either outcome writes a ticket_history row (due_date_agreed or
     due_date_declined) and a notice; a proposal lapses when the ticket leaves those states.
     fn_enforce_ticket_due_date's deadline-bonus rule still applies, and an unclaimed ticket's date
     stays the client's to edit. Tell F·N4 in the commit: the deadline bonus (ruling M7) keys on
     the agreed date.
  7. Service, route and island: proposeDueDate and answerDueDate (ServiceResult); POST
     /api/projects/ticket/due-date {action: 'propose' | 'answer'}; the ticket's Details tab shows
     the agreed date and a pending proposal as MetaLine text ("Proposed 12 Nov by <name>"), with
     Accept (tier 3) and Decline (tier 5) for the other side.
  8. Dev Context Switcher: dueDateProposal (auto · none · proposed_by_viewer ·
     proposed_to_viewer). DevOverrides + DEV_DEFAULTS, DevOption list, DevContextPanel control,
     reflect() set AND delete.

SAME CHANGE: the proposal columns → rows.ts + Tables.md; Functions.md. PRODUCT_SPEC.md:2340-2350
(P5 (a)), :2351-2363 (P5 (b), as ruled) and :2394-2396 (P5 (c)) lose their **Not built yet**.
PRODUCT_MANAGEMENT.md §3.6 rules (10) and (11) (:541-546) lose theirs, and §3.5 gains a Due-date
change row (proposed → agreed | declined | lapsed). DESIGN_SYSTEM.md §C.1 only if a packages/ui
component changes.

DB LANE: one local DB. At most 2 SQL sessions run at once, on disjoint migration files; announce
each `deno task db:reset`. Run probes with `deno task test:probes` while you iterate, and finish
with your own clean `deno task test:probes:fresh`.

ACCEPTANCE: the parity test is green over the whole matrix. ticket_move_authority.sql: a seated
freelancer's move of an unclaimed ticket → 42501; a ticket manager's → allowed. A direct UPDATE of
a claimed ticket's due_date from either side is refused; propose then accept applies the date; the
proposer cannot answer their own proposal. A board unit test: canMove false → the card is not
draggable.
```

### PM-WP8 — Addressable state

```text
PROMPT PM-WP8: A view a type does not have answers 303; the board's view is in the URL; Copy link
copies the ticket

ROLE: Route + frontend engineer. No SQL.

CONTEXT: DL D11, D13; audit §1.2, §2.1, §2.2 (Copy link), §2.4 (board state), backlog items 6, 7
and 15; #88, #95, #134, #61 (Decision #338, ruling P7: a 303 to the parent page for a view a type
does not answer; board ?view=&group=&q=&sort=&dir=). /board (board.tsx) and the stage tasks route
([channelId]/tasks.tsx) have no handler, so a typed address on a Task or a One-off renders a board
the header hides. [channelId]/calendar is reachable only by a typed URL (no CHANNEL_TAB_MATRIX
entry), and channel-view.ts:162-163 claims a route refuses what none does. The ticket Copy link
builds /projects/{slug}/board?ticket={uuid} (TicketView.tsx:843-859), which nothing reads. Board
view state lives in signals (board-state.ts). WP3's UNIQUE on submission number (the B.3 wait) is
merged. Not in this prompt: calendar ?view=&date=&zoom=&kind= (the scheduling track) and /files
sort, search and facets (P7, not assigned to track P).

FILES:
  - apps/web/features/projects/core/{task-view-guard.ts, channel-view.ts, board-ssr.ts,
    board-state.ts, ticket-link.ts} + tests
  - apps/web/routes/(dashboard)/projects/[projectSlug]/{board.tsx, [channelId]/tasks.tsx,
    [channelId]/calendar.tsx, submissions/[...path].tsx, [channelId]/submissions/[...path].tsx}
  - apps/web/routes/api/projects/timeline.ts
  - apps/web/features/projects/islands/{ProjectBoard.island.tsx,
    SubmissionExplorer.island.tsx (:992)}; components/ticket/TicketView.tsx
  - packages/types/projects/board.ts (BoardQuerySchema)
  - documentation/architecture/ROUTING.md

STEPS:
  1. One helper beside taskAbsentViewRedirect: typeAbsentViewRedirect(ctx, projectSlug, view,
     scope), reading CHANNEL_TAB_MATRIX and the project lane's set, so the header and the route
     consult one table. It returns a 303 to the page the view belongs to (the engagement for a
     project view, the room for a channel view), from define.handlers (#61). Apply it to /board on
     a Task and a One-off; to [channelId]/tasks in a Task's room and on a One-off stage; to
     [channelId]/calendar wherever the matrix lacks it; and to both submissions routes on a
     Session. GET /api/projects/timeline answers 404 {code: 'view_absent'} for a Task. Correct
     channel-view.ts:162-163 once it is true.
  2. Board view state (D13): ?view=kanban|list (BoardViewMode), ?group=<a BoardView value>, ?q=,
     ?sort=<key> and ?dir=asc|desc on /board and the stage tasks route. One BoardQuerySchema whose
     parse returns {value, corrected} (the WalletPageQuerySchema precedent). board-ssr.ts parses
     it server-side and answers 303 to the canonical query when corrected. The island seeds its
     signals from the server value and writes each change with history.replaceState, never a
     reload. The address replaces the persisted view preference (board-state.ts:25-30): delete
     it, so the server renders exactly what the URL names. The priority and assignee filters stay
     in signals (D13 names five keys).
  3. Copy link and Open in a new tab use withTicketParam(href, slug) (ticket-link.ts:48-59) on the
     current page with the tkt- slug (?tkv=tkt-…, which TicketDeepLinkHost reads), /board only
     where the type has one and the engagement otherwise. Delete the ?ticket=<uuid> builder.
  4. SubmissionExplorer.island.tsx:992 drops review=1 and keeps every other parameter (tkv
     included).

SAME CHANGE: ROUTING.md gains the board query rule, the type-absent 303 and the ticket link's
shape; flows/Projects.md follows if it lists the views. No schema change. No Dev axis: the
projectType axis already drives the type.

ACCEPTANCE: unit tests for every absent view's 303 target, for BoardQuerySchema's corrected cases,
and for Copy link → …?tkv=tkt-…; a route test: GET /projects/<a Task's slug>/board → 303 to the
engagement; screenshots of the board in list view, restored from its URL, at 1440 and 390.
```

### PM-WP9 — Submissions: private drafts, readable addresses

```text
PROMPT PM-WP9: A draft is its submitter's; a submission's address is stage, handle and number

ROLE: Full-stack engineer.

CONTEXT: DL D10, D14; audit §2.2 (uuid segments), §3.1 (two parsers, no Zod, silent truncation,
no type guard), §3.2's integrity notes, backlog items 8 and 15; #88 (Decision #338, rulings P5 (d)
and P7). Reviewers read unsent drafts twice over: the "View submissions" policy
(00002011:815-840) shows every row to anyone with project access, and resolveIsolation
(live-submissions.ts:765-768) narrows only non-reviewers. "Insert own submissions" (:316-325)
constrains neither status nor the ticket ↔ stage ↔ submitter triple, so an assignee can insert a
row that is already accepted (§3.2). A draft is numbered only when sent (send_submission_draft
:306-309), and its file links are a second insert (live-writes.ts:2800-2820). The tree's segments
are uuids. It follows PM-WP8 (B.3), with SQL on 00002011, 00001150 and 00001850 (PM_BUILD_PROMPTS
§0).

FILES:
  - supabase/migrations/00002011_policies_projects.sql (View submissions; Insert own submissions)
  - supabase/migrations/00001150_functions_projects_stage_funding_submissions.sql
    (fn_assign_submission_number and fn_shares_submitter_team new; submit_deliverable :221;
    send_submission_draft :272) + 00001850_triggers_projects_tickets.sql (the BEFORE INSERT)
  - packages/backend/services/projects/{live-submissions.ts (resolveIsolation :765, resolveChain
    :608, fetchSubmissionPage :1301), live-writes.ts (the draft insert, :2800-2820)} + tests
  - apps/web/features/projects/core/{explorer-header-slot.tsx, submissions-ssr.ts, ticket-view.ts
    (:389-410)}, both submissions routes, islands/SubmissionExplorer.island.tsx
  - packages/types/projects/submissions.ts (SubmissionListParamsSchema :207-212)
  - supabase/probes/submission_draft_privacy.sql (new); submission_door.sql (extend)
  - documentation/architecture/ROUTING.md

STEPS:
  1. Reproduce: as a reviewer, read another person's unsent draft through PostgREST and through
     the explorer; as an assignee, INSERT a stage_submissions row with status 'accepted'. All of
     these succeed today.
  2. RLS: a draft row is visible only to its submitter and to active members of the team whose seat
     on the stage the submitter works under (fn_shares_submitter_team). An inserted row's status
     is 'draft' or 'pending_review'; its ticket's current stage is project_stage_id; and the
     submitter is the ticket's assignee or on its seat's team (backlog item 8).
  3. resolveIsolation and the read query give reviewers no draft, so the service and RLS agree.
  4. Every submission is numbered at INSERT, drafts included: a BEFORE INSERT trigger takes
     pg_advisory_xact_lock(hashtext('submission_number:' || project_stage_id::text)) and assigns
     MAX + 1, and send_submission_draft keeps the number. A gap left by an abandoned draft is
     allowed; Tables.md says so. The draft and its file links go through projects.apply_write_batch
     (PM-WP7) in one transaction, so a draft never exists without its files (§3.2).
  5. Addresses (D14): the tree's segments are the stage's stg- slug, the submitter's handle
     (org.users_public.handle) and the submission's number. A uuid segment is a 404 (#88), and so
     is an unknown trailing segment, which today shortens the path (update the test that expects
     the shortening).
  6. One parser serves both routes (pathSegmentsAfter), validated at the route with
     SubmissionListParamsSchema. A Session's tree answers PM-WP8's 303.

SAME CHANGE: Policies.md, Functions.md, Tables.md (numbering at insert). PRODUCT_SPEC.md:57-60 and
PRODUCT_MANAGEMENT.md:603-605 lose their **Not built yet**. ROUTING.md gains the submissions
address. No Dev axis: submissionState and the role axes already drive these views.

DB LANE: one local DB. At most 2 SQL sessions run at once, on disjoint migration files; announce
each `deno task db:reset`. Run probes with `deno task test:probes` while you iterate, and finish
with your own clean `deno task test:probes:fresh`.

ACCEPTANCE: submission_draft_privacy.sql: a reviewer reads no draft through PostgREST, and the
explorer returns none; the submitter's teammate reads it; an INSERT with status 'accepted' is
refused; a mismatched triple is refused; two concurrent inserts on one stage get distinct numbers
(a committing probe, in the disposable pass). Unit tests: the resolver addresses stg-/handle/number;
a uuid segment → 404; an unknown trailing segment → 404.
```

---

## 7. Last — Docs

### PM-Z1 — Projects docs sweep and audit status

```text
PROMPT PM-Z1: Projects documentation sweep and audit status

ROLE: Documentation steward. Runs after every prompt above has merged.

FILES: documentation/database/projects/*; business/PRODUCT_SPEC.md (Resource Allocation &
Ticketing; Stage Management; Project Creation 2; Escrow); business/finance-model.md (§3, §8,
§16.3); PRODUCT_MANAGEMENT.md (§3.4-§3.8, §5.4); flows/Projects.md (§4, §7);
architecture/ROUTING.md; architecture/SYSTEM_ARCHITECTURE.md (§Scheduled jobs);
architecture/PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md and PROJECT_MANAGEMENT_DECISION_LOG.md (add a
Status column: Fixed by <prompt> · Planned · Open, with an owner); the #338 decision row (each flag
Resolved with its prompt, or Open with an owner).

STEPS: rollup, not restatement (documentation/CLAUDE.md rule 2). Measure the largest seeded Kanban
column and record it beside DL D8's windowing threshold.

ACCEPTANCE: grep -rn "Not built yet" documentation/ | grep "338" lists only rulings still open,
each with its owner; every Planned marker PM_BUILD_PROMPTS §0.6 left stays; every function and
trigger the prompts name appears in database/projects/Functions.md; neither audit's status column
has a blank cell.
```
