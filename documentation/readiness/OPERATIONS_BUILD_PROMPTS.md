# Operations Build Prompts — closing PRODUCTION_READINESS §G

> **Status: WORK ORDERS, not binding.** Claude Code prompts that take
> [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) §G (Scheduled jobs & operations, 11% at
> 2026-11-18) to 100%. Written 2026-11-18 against `main` @ `b7280787`. Every open row was re-checked
> in code that day, and all seven are still open.
>
> **Rollup, not restatement.** Four rows already have a work order. PRD-G2 is
> [PM-WP1](../architecture/PM_BUILD_PROMPTS.md), which runs as written plus the deltas in §2.1. The
> other three are single steps at the end of long prompts that are blocked on other work:
>
> - PRD-G3 is PM-WP5a step 3g, which waits for the finance window;
> - PRD-G4 is SCH-WP7 step 7, which waits on a 🧑;
> - PRD-G5 is ERA2 step 3, which waits for ERA1.
>
> Each of those steps is carved out here (**OPS2–OPS4**), and each carve-out marks its step done in
> the source prompt. PRD-G6, G7 and G8 have no work order: **OPS1, OPS5, OPS6**. **OPS7** is the
> hosted bring-up that closes the hosted halves.
>
> **Shared with the peer readiness files.** [MONEY_BUILD_PROMPTS.md](MONEY_BUILD_PROMPTS.md) **MR4**
> owns the money half of PRD-G7 and sets the alert pipeline's shape; OPS5 builds the rest on that
> same pipeline, and whichever runs first builds it. That file also carries a PM-WP1 delta and
> queues PM-WP1 after FBP DB16; §2.1 folds both in. MR6 (the Stripe preflight), COMMS **CD2** (the
> hosted delivery proof) and SECURITY **SAC6** (hosted auth parity) are steps in OPS6's runbook,
> linked and not restated.

---

## 0. Map, run order and stops

### 0.1 Row → work order

| Row    | Gate | Crit     | Work order                                  | The row flips to ✅ when                                                                           |
| :----- | :--- | :------- | :------------------------------------------ | :------------------------------------------------------------------------------------------------- |
| PRD-G1 | UAT  | High     | — (already ✅, Decision #203)               | —                                                                                                  |
| PRD-G2 | UAT  | Critical | PM-WP1 (PM §2) + §2.1 deltas                | The sweep locks, re-checks, writes history and tells both sides; its row is enabled                |
| PRD-G3 | UAT  | High     | **OPS3** (PM-WP5a step 3g, carved out)      | `projects-resolve-workload-reports` runs over a locked sweep that never penalises a settled ticket |
| PRD-G4 | UAT  | High     | **OPS2** (SCH-WP7 step 7, carved out)       | `scheduling.fn_settle_votes` exists and the dormant row registers on reset                         |
| PRD-G5 | PROD | Normal   | **OPS4** (ERA2 step 3, carved out)          | `search.fn_prune_query_logs` exists and `search-query-log-retention` registers                     |
| PRD-G6 | UAT  | Critical | **OPS1** → 🟡 · **OPS7** → ✅               | `cron:vault --check` is green against the hosted project                                           |
| PRD-G7 | PROD | High     | MR4 (money) + **OPS5** → 🟡 · **OPS7** → ✅ | A hosted test alert reaches every chosen channel, and the heartbeat drill trips the monitor        |
| PRD-G8 | PROD | Critical | **OPS6** → 🟡 · **OPS7** → ✅               | The runbook has been executed once on staging, rollback and restore drills included                |

Rows outside §G that move too:

- PRD-F9 (ledger drift surfaced and alerted) stays MR4's and FBP DB16's. OPS5 does not claim it, but
  if OPS5 builds the pipeline first, MR4 shrinks to its rules.
- PRD-M3's remaining half (the data export's hosted dispatch) flips with OPS7.
- PRD-F23's evidence loses its "claim TTL paused" clause with PM-WP1.
- The first §Doc-drift bullet (SA §Scheduled jobs) is fixed by OPS1.

### 0.2 Run order

Three constraints set the order:

- **Every SQL prompt here edits `00002510`.** That file has one writer at a time across **all**
  tracks. §C's SAC1 ([SECURITY_ACCESS_BUILD_PROMPTS.md](SECURITY_ACCESS_BUILD_PROMPTS.md), its first
  wave) rewrites the grant model, and §F's FBP DB16 also holds the file. So the OPS SQL chain is
  serial, and none of it runs while SAC1 or DB16 does.
- **`00005060` has one writer at a time.** PM-WP1, OPS3 and OPS5 edit it, and so do DB16 and MR4.
  OPS2 and OPS4 do not: their rows are already seeded dormant and register themselves once the
  function exists.
- **Measure before you move money.** §F runs FBP DB16 (the conservation identity) before PM-WP1, so
  the claim sweep's refunds are checked by `conservation_identity.sql` as they land. Keep that
  order. Until DB16 merges, run the app lane, and give the SQL lane to OPS2 (which moves no money)
  whenever nobody else holds `00002510`.

OPS1 and OPS6 touch no migration, so they run in the app lane from the start.

| Wave   | SQL lane (serial)                 | App / script lane (parallel)   | Why                                                                                                                                                                            |
| :----- | :-------------------------------- | :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | PM-WP1 + §2.1 deltas (after DB16) | **OPS1** · **OPS6** (🧑 first) | The Critical UAT row. The two tooling prompts need no migration, and OPS6's questions take owner time.                                                                         |
| 2      | **OPS2** → **OPS3**               | —                              | The High UAT rows. OPS2 may go ahead of PM-WP1 while DB16 is unmerged. OPS3 comes after PM-WP1, because both edit `00001140`.                                                  |
| 3      | **OPS5** → **OPS4**               | —                              | The PROD rows. OPS5 comes after OPS1, because its new bearer joins the registry that OPS1's tool reads. It runs before or after MR4: the first one builds the shared pipeline. |
| Hosted | —                                 | **OPS7** (you + a session)     | Needs OPS1, OPS5 and OPS6 on main, OPS6's answers, and a hosted staging project.                                                                                               |

**§G score projection** (weights: Critical 3 · High 2 · Normal 1; total 18):

| After  | Score | Rows that flip        |
| :----- | ----: | :-------------------- |
| Today  |   11% | —                     |
| Wave 1 |   44% | G2 ✅; G6 and G8 → 🟡 |
| Wave 2 |   67% | G3, G4                |
| Wave 3 |   78% | G5 ✅; G7 → 🟡        |
| OPS7   |  100% | G6, G7, G8            |

The projection excludes PRD-G9, which OPS6 may add (stop 5 below).

### 0.3 Human stops on this path

1. **PM-WP1 (new, delta D3):** what a lapsed claim does to a **prepaid** escrow. Decision #428 came
   after PM-WP1 was written, and PRODUCT_SPEC's Claim Expiry rule predates it. The recommendation is
   to re-arm the escrow rather than refund it. MONEY's MR0 owner sitting does not list this
   question, so add it to that sitting. It sits next to MR0's #1 (where "claimed" lives for a bought
   service), and the two answers should agree.
2. **OPS5:** where alerts go. This is the same question as MONEY MR0 #4 / MR4 step 1, so ask it
   once. Both files recommend a chat webhook plus email. OPS5 adds the in-app operator notice and an
   external heartbeat monitor.
3. **OPS6:**
   - (a) the app host;
   - (b) the environments and the region;
   - (c) how a schema change reaches a hosted database that holds data. This is a gap between root
     `CLAUDE.md` §1 and the UAT tier: log it as a decision, don't resolve it silently;
   - (d) the domains;
   - (e) the backup posture (PITR is ⚖️ with ERA4).
4. **OPS7:** you hold every hosted credential. No agent types or reads a secret value, changes a
   hosted setting, or moves live money. The scripts read files you point them at and print names and
   booleans.
5. **Flag (a stop for OPS6 to raise, not a blocker):** testers need somewhere to reach the app.
   PRD-G6 is gated UAT but needs a hosted project, while PRD-G8 is gated PROD. Either UAT runs over
   `deno task share` (your machine, fragile), or a hosted staging project is a UAT prerequisite. The
   recommendation is hosted staging. OPS6 then adds **PRD-G9** "A hosted staging environment testers
   can reach" (Critical, UAT) at the end of §G. That lowers the UAT score until OPS7 lands, which is
   the honest number.

Not stops here, and left alone:

- PM-WP5a's penalty sizes (its 🧑 #5). OPS3 keeps the seeded `0`.
- SCH-WP7's group-sitting exit (its step 6). OPS2 settles 1-1 rounds only, because the freeze
  stands.
- ERA2's ⚖️ retention values. OPS4 builds the dial at the owner's table value.

---

## 1. Headers

### 1.1 Standard header — paste above every OPS prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types
the Zod SSOT @projective/types; packages/backend fat services @server/services/*;
supabase/migrations Postgres with RLS everywhere; pg_cron + pg_net + Supabase Vault for scheduled
jobs; Stripe Connect).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (always
     documentation/CLAUDE.md; documentation/database/CLAUDE.md when SQL changes), then
     documentation/reference/guardrails.md and documentation/reference/pr-checklist.md.
  2. Read documentation/readiness/PRODUCTION_READINESS.md §G and
     documentation/readiness/OPERATIONS_BUILD_PROMPTS.md §0 (run order, file locks, stops). Read
     SYSTEM_ARCHITECTURE.md §Scheduled jobs, supabase/migrations/00001650_functions_ops_scheduler.sql,
     00005060_seed_scheduled_jobs.sql and supabase/probes/scheduled_jobs.sql.
  3. Grep documentation/reference/decisions/README.md for the surface you touch and read the
     decision files it names. At minimum: #125 (the cron bearer guard), #202 and #203 (the job
     registry), #337 and #338 (ruling Q0.3: which jobs run), #444 (the readiness tracker). If a
     decision already rules the behaviour you are about to change, stop and ask me.
  4. The CONTEXT below was verified at main @ b7280787 on 2026-11-18. Re-check every file:line
     against the current tree before relying on it; another track may have landed since.

Hard rules (merge gates; reject your own diff if any fails):
  Scheduler
  - A job exists only as a row of ops.scheduled_jobs seeded in 00005060; never call
    cron.schedule directly. A row whose function may not exist yet is guarded by to_regproc /
    to_regprocedure, like its neighbours. 00005060 has one writer at a time.
  - Every sweep is safe to run twice and to overlap itself: candidates locked FOR UPDATE SKIP
    LOCKED and re-checked under the lock, a p_limit, and p_now injectable for probes. Every
    argument has a default, because the job calls the function bare.
  - Nothing is silent: a skip or a failure raises a WARNING and writes an ops.log_entries row
    (the ops.fn_log_scheduler_event shape).
  - An http job's route is thin and guarded by packages/backend/core/bearer.ts (≥ 32 chars,
    constant time, 404 otherwise); its secret_name equals the app's env key.
  - No secret value in a migration, seed, probe, test fixture, log, commit or tool output, ever.
    Scripts read secrets from a file or the environment, never from argv, and print names and
    booleans only.
  - Locally the money sweeps stay on `deno task cron:run`: never put FINANCE_CRON_SECRET or
    ACCOUNT_CRON_SECRET into the shared local Vault.
  SSOT & architecture
  - Migrations are consolidated and EDITED IN PLACE (vvvvtooo_type_purpose.sql); never an ALTER
    patch or a "fix" file. Each statement in its category file (0 tables · 1 functions · 2
    policies/grants: 00002510 function grants · 3 views · 4 indexes · 5 seed: 00005001 params in
    your own #region (Decision #274), 00005010 notification types, 00005060 jobs). The Additive
    Rule: no dropped table, column or FK without my OK. 00002510 has one writer at a time across
    ALL tracks.
  - A NEW SECURITY DEFINER function pins search_path = '' and schema-qualifies every name. When you
    edit an existing function that writes projects.tickets, keep its file's established
    search_path: that table's triggers use unqualified names and inherit the caller's path. Every
    sweep is REVOKEd from PUBLIC, anon and authenticated, and granted to service_role.
  - Thin routes; logic lives in packages/backend/services/* and returns ServiceResult<T>
    (Decision #10). Islands never import Supabase or @server/*.
  - These land in the same change as the thing they describe:
      a schema or RPC-contract change → its Zod schema, the backend mapper and
        documentation/database/*;
      a route → ROUTING.md;
      an env key → SYSTEM_ARCHITECTURE.md §Environment Variable Contract, .env.example
        (XXXX-XXXX) and packages/backend/core/env.ts;
      a job → its row in SYSTEM_ARCHITECTURE.md §Scheduled jobs;
      a lifecycle change → PRODUCT_MANAGEMENT.md;
      a business rule → PRODUCT_SPEC.md (numbers in finance-model.md).
    A rule marked **Not built yet** that you build loses its marker.
  - Path aliases only; JSDoc on exports; // #region blocks; no meta-comments.
  - A NEW contradiction between source docs: do not pick a side. Add a decision row (the newest
    decisions-*.md + a README index line; re-check the next free number right before writing,
    because peers number on their branches) and ask me.

Verification: reproduce the defect first (a failing probe or test), then fix it.
  SQL: rollback-safe probes under supabase/probes/ (BEGIN … ROLLBACK); `deno task test:probes`. At
  most two SQL sessions on the one local DB, on disjoint migration files. `deno task db:reset` is
  standing-approved, but announce it to concurrent sessions first. Finish with your own clean
  `deno task test:probes:fresh`. A job you register must show in ops.scheduled_jobs and cron.job
  after the reset, and `deno task cron:run <job>` must run it.
  Always: `deno task check`, `deno task lint`, `deno task test:unit`, and `deno fmt` on the files
  you touched only (never a directory). Compare any red unit test with main before calling it yours
  (theme-engine failures are pre-existing, Decisions #96 (a) and #157 (m)). Docs are CRLF in the
  working tree: edit them with an editor tool, never sed.
This checkout may be shared with other sessions: never switch branch, never stash, stage only your
own hunks. Commit on the branch you were given. Do not push or open a PR unless I ask.
```

### 1.2 Readiness addendum — paste after every prompt (OPS and the source prompts alike)

```text
READINESS (Decision #444): in the same change, update documentation/readiness/
PRODUCTION_READINESS.md: the row(s) <ROWS> — status, and evidence naming your commit and
decision; recompute the §G line and the three tier rows of the Scoreboard (score = Σ weight ×
credit / Σ weight; ✅ 1 · 🟡 0.5 · ❌ 0; Critical 3 · High 2 · Normal 1; ⏸ rows excluded; a row
counts toward its Gate tier and every later tier); add one line to §Score history. Update
USER_FLOWS.md if a flow's status changes. A gap you find and do not fix gets a new row at the end
of §G, never silence. Several sessions edit this file each day: re-read it right before you edit,
and change only your rows and the totals.
```

---

## 2. Existing work orders — what changed since they were written

For PM-WP1, paste PM's own header (PM §1), then PM-WP1 as written, then the §2.1 deltas, then §1.2.
The other three are carved out. Run the OPS prompt instead, and give the source prompt the note
below when it eventually runs.

| Prompt  | Source        | `<ROWS>` for §1.2   | Delta (re-verified 2026-11-18 at `b7280787`)                                                                                                                                                                                                                                                  |
| :------ | :------------ | :------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PM-WP1  | PM §2         | PRD-G2              | §2.1 below (D1–D8), including a new 🧑 (D3).                                                                                                                                                                                                                                                  |
| PM-WP5a | PM §4         | none from §G (OPS3) | Step 3g and the sweep-time half of 3d moved to OPS3. Once OPS3 has landed, the sweep already locks, takes `p_now` / `p_limit`, closes a settled ticket's report `acknowledged`, and its job runs. Keep that; add 3c (both sides penalised) and 3d's settle-time trigger on the new signature. |
| SCH-WP7 | Scheduling §5 | none from §G (OPS2) | Step 7 moved to OPS2. Once OPS2 has landed, `fn_settle_votes` exists and reads `fn_vote_deadline`, so step 2's money window flows into it. Extend `settle_votes.sql` with one money-bearing round.                                                                                            |
| ERA2    | Identity §4   | none from §G (OPS4) | Step 3 and `retention_search_query_log_days` moved to OPS4. Once OPS4 has landed, fold its `[search_retention]` region into `[erasure_retention]`, and switch `fn_prune_query_logs` to `security.fn_retention_period`.                                                                        |

### 2.1 PM-WP1 deltas — paste after PM-WP1

```text
PM-WP1 DELTAS (re-verified 2026-11-18 at b7280787). Where these and PM-WP1 disagree, these win.

D0. MONEY_BUILD_PROMPTS.md §4 carries its own PM-WP1 delta, and both of its lines stand:
    - run after FBP DB16 (they share 00005060 and 00002510, and DB16's conservation probe
      checks your refunds);
    - leave the prepaid sweep's predicate payee-based, because MR1 adjusts it.

D1. Moved lines.
    - fn_release_expired_claims is at 00001140:690-721.
    - Its grants are at 00002510:1491-1492, not :1357-1358.
    - The jobs branch has merged: the paused row is 00005060:166-176.
    - PRODUCT_SPEC's Claim Expiry rule is now :2509-2517.

D2. Prepaid escrow (Decision #428) is new since PM-WP1 was written.
    - A ticket can be funded before anyone is hired: a held escrow with payee_id NULL and
      expires_at set. finance.fn_sweep_expired_prepaid_escrows (00001200:1675) refunds it if
      nobody claims it.
    - A claim binds the escrow and clears expires_at (ck_escrows_expiry_unbound). The prepaid
      sweep leaves any ticket somebody holds "to the claim TTL", so this sweep is now the only exit
      for a prepaid escrow whose claim lapses.
    - Use the prepaid sweep as your template: FOR UPDATE OF t SKIP LOCKED;
      LIMIT GREATEST(COALESCE(p_limit, 200), 1); a re-read under the lock; a ticket_history row;
      the escrow.refunded notice.

D3. 🧑 DECISION (new). STOP before the refund branch for a PREPAID escrow; everything else goes
    ahead. PRODUCT_SPEC:2509-2517 refunds "any escrow held at claim" to the client in full. That
    rule predates #428, where the client paid before anyone was hired.
    Option A (recommended): re-arm.
      - A lapsed claim on a prepaid escrow unbinds it: payee_id NULL, and expires_at = p_now +
        prepaid_service_ttl_hours or prepaid_project_ttl_hours, by the project's ownership.
      - Its reservations stay reserved.
      - The ticket goes back to the pool as Ready (todo, still funded). The next freelancer can
        claim it, and the prepaid sweep still refunds it if nobody does.
      - An escrow that was not prepaid is refunded, as the spec says.
    Option B: refund every escrow in full, prepaid or not, as written. The client funds again.
    Why A: a refund punishes the client for the freelancer's parking and costs a second checkout.
    The prepaid TTL still bounds the hold, so "No Forever-Escrow" holds under either option.
    Whichever is ruled, the ruling needs a decision row, and PRODUCT_SPEC's Claim Expiry sentence
    changes in the same change.
    Once an escrow is bound, nothing on it says it was prepaid. Find what does (for example the
    escrow's created_at against the ticket's claimed_at, or the funding's own record), and pin it
    in the probe. If nothing does reliably, stop and tell me.

D4. Reservations (Decision #430). Later stages bought up front are `reserved` escrows.
    - A refunded base takes them with it: call
      finance.fn_refund_ticket_reservations(ticket, NULL, 'claim_ttl_expired') (00001200:1124),
      as the prepaid sweep does, and record prepaid_stages_refunded in the history row's changes.
    - Under D3 option A they stay reserved.

D5. Unbinding is a removal too. Step 2's order rule stands: refund (or, under D3 option A,
    unbind) BEFORE clearing current_assignee_id. fn_ticket_escrow_sync (00001110:384) releases a
    still-held, still-bound escrow to the departing assignee. In the race probe, confirm that it
    ignores an unbound held escrow.

D6. Notices. For a refund, the client side already has escrow.refunded (00005010:10, mandatory;
    the prepaid sweep's notice), so use it. Only ticket.claim_expired is new: it goes to the
    lapsed claimant, and under D3 option A also to the client ("back in the pool, still funded").

D7. Bought services (Decision #456 flag (b), PRD-F24). Today a bought service's escrow is bound to
    the seller's seat at funding (fn_ticket_payee). MONEY's MR1 (🧑 #1, recommended A) moves it to
    payee NULL until a claim.
    - If MR1 has landed, a bought service's escrow is an ordinary prepaid escrow, and D2/D3 cover
      it.
    - If MR1 has not landed, find out whether such a ticket can sit `claimed` with a claimed_at.
      If the sweep reaches one, a lapse refunds the buyer and never releases to the seller. Add one
      such ticket to claim_ttl_sweep.sql.
    - Do not solve PRD-F24 here. It is MR1's.

D8. READINESS <ROWS> = PRD-G2 → ✅. Also: PRD-F23's evidence drops "with the claim TTL paused
    (PRD-G2)", and any USER_FLOWS row that cites the paused sweep is updated.
```

---

## 3. New prompts

### OPS1 — Every HTTP job's bearer reaches a hosted Vault, and a check proves it matches the app

Gives PRD-G6 its tooling (→ 🟡). The row flips to ✅ in OPS7, when the check is green against the
hosted project.

```text
PROMPT OPS1: Provision every scheduler secret into any Vault from the registry, and prove each one
equals the app's env

ROLE: Platform engineer. Scripts, deno.json and docs only: no migration, no app code. You never
run this against a hosted project and never handle a real secret. You build the tool, prove it on a
throwaway database, and I run it.

CONTEXT:
  - pg_cron's http jobs read CRON_APP_URL and their bearer (the row's secret_name) from Supabase
    Vault (ops.fn_dispatch_http_job, 00001650:192). If either is missing, the job logs
    secret_missing or app_url_missing at most once a day, and its pg_cron run still reads
    "succeeded".
  - scripts/cron-vault.ts writes only CRON_APP_URL and INTEGRATIONS_CRON_SECRET, into the local
    container (docker exec), from .env.local (:16, :36). Locally that is on purpose: the money
    sweeps stay on cron:run, so a dev server never moves money on a timer.
  - Nothing provisions a hosted Vault. .env.example's Vault block asks a human to run
    vault.create_secret by hand for five names.
  - The registry uses five bearers today: FINANCE_ (four jobs), ACCOUNT_ (two), SCHEDULING_ (two),
    CONTACT_ (one) and INTEGRATIONS_CRON_SECRET (six). More are coming: OPS5 / MR4 add the alert
    job's bearer, and COMMS NT2 adds COMMS_DISPATCH_SECRET (COMMS_DELIVERY_BUILD_PROMPTS.md CD2).
    A hand-kept list is how four of the five got skipped, so read the list from the registry. Then
    a later job needs no edit to this script, so MR4's "add this job's secret to cron-vault.ts"
    step becomes a no-op. Say so in MONEY_BUILD_PROMPTS.md's MR4 only if its owner asks you to; do
    not edit that file yourself.
  - .env.* files are gitignored (except .env.example), and the server loads only .env.local then
    .env. So a staging env file such as .env.staging is safe to keep beside the repo for this tool.

STEPS:
  1. Reproduce: after a fresh `deno task db:reset`, list the enabled http jobs whose secret_name has
     no vault.secrets row (join by name). Today that is every finance, account, scheduling and
     contact job.
  2. A pure module under scripts/, unit-tested, holding:
     - the secret list, derived from registry rows;
     - the value guards: ≥ 32 chars, not XXXX-XXXX, no whitespace, distinct across names;
     - the CRON_APP_URL guard per target. Local: http://host.docker.internal:<PORT>. Hosted:
       https, a host that is not loopback, private or host.docker.internal, and equal to the env
       file's APP_URL origin.
  3. The modes of `deno task cron:vault`:
     - default (unchanged): the local container, CRON_APP_URL + INTEGRATIONS_CRON_SECRET. Keep it
       as the db:reset hook, and keep "never fails a reset".
     - --all (local, opt-in): every registry bearer, with a printed warning that the money sweeps
       now run on their timers against the dev server.
     - --env-file <path>: any database reachable by connection string. The connection string is
       CRON_VAULT_DB_URL inside that file, never argv. It writes every registry bearer plus
       CRON_APP_URL, with values from the same file, upserting as today
       (vault.create_secret / vault.update_secret).
     - --check (with either target): read-only. For each enabled http job, report:
         the secret is present;
         its length is ≥ 32, measured in SQL;
         it EQUALS the env file's value, comparing sha256 digests computed on each side (pgcrypto
           over vault.decrypted_secrets; std crypto in Deno), so no value crosses in clear;
         CRON_APP_URL is present and passes the target's guard (its origin may be printed: it is
           the public APP_URL);
         a cron.job entry exists for it;
         its last outcome in ops.http_job_dispatches.
       Exit 1 if any enabled http job is not ready.
     For a Postgres client, use psql on PATH or an existing import. If a library is truly needed,
     add it with a deno.json $comment (licence, why), as the repo's other dependencies have.
     Never print a secret value, never accept one on argv, and never write one to a log or a temp
     file.
  4. Prove --env-file and --check on a THROWAWAY database (a scratch container or a copy, built from
     the migrations), never the shared local DB. Putting the finance bearers into the shared Vault
     would start the money sweeps against every peer's dev server. Use a test env file with
     generated 48-char values and CRON_APP_URL=https://staging.example.com, then delete it.
     A database made inside supabase_db_Projective is not safe: any peer's `deno task db:reset`
     recreates that container and drops every extra database in it. Prefer a separate container.
     Otherwise re-check that your copy still exists right before the final run, and rebuild it
     if it has gone.
  5. Docs:
     - SA §Scheduled jobs, the "Environments" bullet: the hosted procedure (--env-file, then
       --check); the rotation order (the app's env first, then the Vault value: the routes 404 in
       between, and every job is safe to re-run); and that --check's output is PRD-G6's evidence.
     - Fix the section's drift. The "five more rows" paragraph: discovery-call expiry, spend-approval
       expiry and the idempotency-key sweep have registered, while vote settlement and query-log
       retention still wait (OPS2, OPS4). Add the table rows finance-expire-spend-approvals and
       finance-sweep-idempotency-keys (00005060:211-224; their functions are at 00001210:3505 and
       00001240:2680).
     - .env.example's Vault comment block names the tool.
     - deno.json's $comment:cron:vault.

ACCEPTANCE:
  - Unit tests for the pure module: the list from rows, every guard, the digest compare.
  - On the throwaway DB: --env-file and then --check exit 0. Delete one secret and --check exits 1,
    naming the job and the secret's name. Change one value in the env file and --check exits 1 with
    "differs", printing no value.
  - The default mode on the shared DB behaves exactly as before (db:reset's output is unchanged).
  - No value appears in any output or fixture (grep for them).
  - check, lint, test:unit green.
```

§1.2 rows: **PRD-G6 → 🟡** ("tool and check built; run against hosted: OPS7"). Strike the §Doc-drift
bullet on SA §Scheduled jobs.

### OPS2 — A reschedule vote past its deadline settles with nobody reading it

> **Status 2026-11-19: OPS2 landed (Decision #513; PRD-G4 ✅, USER_FLOWS PJ-73 ✅).** The read path
> also counted a ballot from outside the electorate (a withdrawn seat's, a guest's, the host's); both
> sides now count only the electorate's (`votesOfVoters`). The sweep sends no notice of its own: the
> read path's only notice is the one `close_reschedule_round` sends, so the job sends it through that
> door, once. SCH-WP7 carries the status note.

SCH-WP7 step 7, carved out. Closes PRD-G4.

```text
PROMPT OPS2: Reschedule votes settle on a timer, not only when someone opens the event

ROLE: Postgres + TypeScript engineer (the coordination engine). SQL lane; holds 00002510 while it
runs. Do NOT edit 00005060.

CONTEXT:
  - Audit S-13: vote settlement runs only on a read, so a deadline nobody reads moves nothing and
    tells nobody.
  - The Wave 1.3 jobs set seeded scheduling-settle-votes ('11,26,41,56 * * * *') dormant. It
    registers on the first reset after a function named exactly scheduling.fn_settle_votes exists
    (00005060:178-193, to_regproc).
  - This is SCH-WP7 step 7, carved out because SCH-WP7 waits on a 🧑 (#344 (f), its step 6).
    Settling on today's deadlines is safe on its own: the job settles exactly what a read would
    settle, under the same lock. SCH-WP7 later moves fn_vote_deadline to the money window, and this
    function reads fn_vote_deadline, so it inherits that with no change here.
  - The pieces:
      fn_vote_deadline (00001510, re-find it);
      scheduling.close_reschedule_round (00001510:385): it moves the event on 'resolved' and
        answers NULL for a round that is already closed;
      the round lock (00001510 ~:608);
      the TS rule: settleVote and eligibleVoterCount (packages/types/scheduling/coordination.ts:832,
        :751). Guests are not voters (#391, scheduling.fn_event_has_voters), and neither is the
        host. A slot carries with strictly more than half of the entitled voters, optional
        attendees included (D5).
  - The read path settles in the service (find the call in
    packages/backend/services/scheduling/coordination-plan.ts or live-coordination-writes.ts), and
    it sends the round's notices. The job must send the same notices, once.
  - The group-sitting freeze stands (trg_sitting_round_guard), so no group round can exist.

FILES: 00001510 (scheduling.fn_settle_votes(p_now timestamptz DEFAULT now(), p_limit integer
DEFAULT 200)); 00002510; packages/types/scheduling/coordination.contract.test.ts;
supabase/probes/settle_votes.sql (new, ROLLBACK); the docs below.

STEPS:
  1. Reproduce in the probe: a `voting` round past its deadline, with a majority, stays `voting`
     until somebody reads it.
  2. The function: SECURITY DEFINER, search_path = ''.
     - Select `voting` rounds whose deadline ≤ p_now, ordered by deadline, LIMIT p_limit,
       FOR UPDATE SKIP LOCKED, in the read path's lock order. Re-check the status under the lock.
     - Tally with the SQL twin of settleVote. A winner → close_reschedule_round(… 'resolved' …);
       otherwise 'lapsed'.
     - Send the notices the read path sends, through comms.fn_notify.
     - Return the number settled.
  3. A round the read path closed first is skipped (close_reschedule_round answers NULL), so a
     second run returns 0.
  4. 00002510: REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role.
  5. coordination.contract.test.ts runs the SQL tally and settleVote over the same fixtures, as it
     already does for fn_vote_deadline.

SAME CHANGE:
  - documentation/database/scheduling/Functions.md.
  - SA §Scheduled jobs: add the scheduling-settle-votes row (the table lacks it).
  - PRODUCT_MANAGEMENT.md §3.5: the "there is no cron in this layer" sentence names the job.
  - SCHEDULING_BUILD_PROMPTS.md: SCH-WP7 gets a status line "step 7 landed in OPS2 (<sha>); steps
    1-6 and 8-11 remain", and the header bullet at :38 is updated.

ACCEPTANCE:
  - settle_votes.sql: a majority resolves and the event moves; no majority lapses; a guest's vote
    does not count; p_limit is honoured; a second run returns 0; each notice is sent once.
  - After a fresh reset the row is in ops.scheduled_jobs and cron.job, and scheduled_jobs.sql
    passes. `deno task cron:run scheduling-settle-votes` runs.
  - coordination.test.ts and coordination.contract.test.ts green.
```

§1.2 rows: **PRD-G4 → ✅.**

### OPS3 — The workload-report expiry sweep is safe to run, then it runs

PM-WP5a step 3g plus the sweep-time half of 3d, carved out. Closes PRD-G3.

```text
PROMPT OPS3: The workload-report expiry sweep locks, never penalises a settled ticket, and is
scheduled

ROLE: Postgres engineer (projects automation). SQL lane. Runs after PM-WP1 (both edit 00001140);
holds 00002510 and 00005060 while it runs.

CONTEXT:
  - projects.fn_resolve_expired_workload_reports() (00001140:135-182):
      it takes no lock and no limit, and reads now() (there is no p_now);
      it penalises the client and resumes the ticket for every open report past hidden_until,
        even when the ticket was settled while the report was open (DL §3 W4).
  - No job row exists (no projects-resolve-workload-reports in 00005060).
  - No line in 00002510 names the function, so it carries the schema default. Check what that is
    today. If PUBLIC, anon or authenticated can EXECUTE it, anyone can fire the penalty sweep: that
    is a finding, and this prompt closes it.
  - #338's Q0.3 reading gives the registration to PM-WP5a, "because before these fixes it would
    penalise clients for tickets they had settled". PM-WP5a waits for PM-WP4b and the finance
    window, and F·DB6 is not built. So this carve-out takes the two pieces that reason names: the
    sweep-time half of W4, and step 3g.
  - PM-WP5a keeps everything else: the grant on file_workload_report, answer_workload_report, the
    settle-time close trigger, both-sides penalties (W3), the unique open index (W10), the UI and
    the Dev axis.
  - Not reachable from the product until PM-WP5a grants file_workload_report, and no seed files a
    report, so the job idles until then.
  - The penalty dial stays as seeded: client_no_adjust_penalty = 0 (PM 🧑 #5). Do not size it.
  - fn_resume_reported_ticket (00001140:98) already moves only a reported_hidden ticket.

FILES: 00001140; 00002510; 00005060 (a new region, [projects] Workload-report expiry);
supabase/probes/workload_report_suspension.sql (extend it; it calls the sweep bare at :295, so the
zero-argument call must keep working); the docs below.

STEPS:
  1. Reproduce W4: file a report (service role), settle the ticket (complete or cancel it),
     backdate hidden_until, and run the sweep. Today the report becomes expired_penalized and a
     penalty row is written against a settled ticket.
  2. The signature becomes fn_resolve_expired_workload_reports(p_now timestamptz DEFAULT now(),
     p_limit integer DEFAULT 200).
     - Candidates: open reports with hidden_until ≤ p_now, ORDER BY hidden_until, LIMIT p_limit.
     - Lock the ticket first and the report second, SKIP LOCKED. That is the order
       fn_adjust_workload_report takes them in, through the ticket trigger.
     - Re-check status = 'open' under the lock.
  3. Under the lock, two branches:
     - The ticket is no longer reported_hidden, or its workload_report_id names another report:
       close the report 'acknowledged' (resolved_at = p_now), with no penalty and no resume. That is
       PM-WP5a's W10 meaning: "closed because the ticket was settled; nobody is penalised".
     - Otherwise, today's path, unchanged: expired_penalized, resume, and the client penalty at the
       dial.
  4. 00002510: REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role, for the
     new signature.
  5. 00005060: register projects-resolve-workload-reports, enabled, every 15 minutes on minutes no
     other job uses. Check with `deno task cron:run --list`: 6,21,36,51 looks free, apart from the
     04:36 daily. The region comment says why it is now safe, and that PM-WP5a will add the
     settle-time trigger.

SAME CHANGE:
  - documentation/database/projects/Functions.md: the signature, the behaviour, the job.
  - SA §Scheduled jobs: a new row.
  - PM_BUILD_PROMPTS.md: PM-WP5a gets a status line "step 3g and the sweep-time half of 3d landed in
    OPS3 (<sha>)", and its §0.1 "Workload reports" row is updated.
  - PRODUCT_MANAGEMENT.md §3.5 / §3.6, only where they describe the sweep (re-read them).

ACCEPTANCE:
  - The extended probe: a lapsed report on a live suspended ticket is penalised once and the work
    resumes; one on a settled ticket closes 'acknowledged' with no penalty row; p_limit is
    honoured; a second run returns 0; anon and authenticated cannot EXECUTE the function.
  - scheduled_jobs.sql and finance_invariants.sql pass; the row has a cron.job entry.
```

§1.2 rows: **PRD-G3 → ✅** (evidence: "scheduled; idle until PM-WP5a makes reports fileable").

### OPS4 — Search query logs past their retention are pruned daily

ERA2 step 3 and its one dial, carved out. Closes PRD-G5.

> **Status 2026-11-19: OPS4 landed** (`4a73588e`, #515). The prune also takes
> `p_now timestamptz DEFAULT NULL`, because the §1.1 header requires an injectable clock for every
> sweep. ERA2's source prompt carries the fold-in note.

```text
PROMPT OPS4: search.fn_prune_query_logs exists, reads its dial, and the dormant job registers

ROLE: Postgres engineer. SQL lane; holds 00002510 while it runs. Do NOT edit 00005060. Never run
beside ERA1-ERA4 (00001060) or SAC2 (search.fn_log_query and the query_logs inserts).

CONTEXT:
  - finance-model.md §17 keeps search.query_logs for 90 days.
  - The job search-query-log-retention ('36 4 * * *', 'SELECT search.fn_prune_query_logs();') is
    seeded dormant. It registers once a function named exactly search.fn_prune_query_logs exists
    (00005060:227-235). Nothing defines it.
  - ERA2 (Identity §4) owns it. Its step 1 seeds retention_search_query_log_days, and its step 3
    writes the prune, in 00001060 rather than 00001400 (Identity §0.3: M·search edits 00001400).
    ERA2 waits for ERA1, so this carve-out takes step 3 and that one dial, in ERA2's shapes, so ERA2
    later finds them built.
  - ⚖️ The 90 days is the owner's retention table, pending counsel (ruling I1). Build the dial; the
    value is the table's.
  - Today the search schema grants EXECUTE to anon schema-wide (00002510:227; PRD-C6, C7). SAC1 may
    have changed that by the time you run. Either way, revoke explicitly.
  - query_logs.created_at is nullable, with DEFAULT now() (00000018 ~:104). Read every writer: if
    any can leave it NULL, stop and tell me. Do not invent an age for an undated row.

FILES:
  - 00005001: your own #region [search_retention], INSERT … ON CONFLICT DO NOTHING (Decision #274).
    The key is retention_search_query_log_days, with ERA2's shape {"default": 90, "by_country": {}}.
  - 00001060: search.fn_prune_query_logs(p_batch integer DEFAULT 5000).
  - 00002510.
  - supabase/probes/query_log_retention.sql (new, ROLLBACK).
  - The docs below.

STEPS:
  1. Reproduce: a query_logs row 91 days old survives every job.
  2. The function: SECURITY DEFINER, search_path = ''.
     - Read the dial's "default". (ERA2 later swaps in security.fn_retention_period.)
     - A missing, non-integer or < 1 value raises a WARNING, writes an ops.log_entries row (scope
       'search.retention'), and falls back to 90. Never 0, never "delete everything".
     - Delete rows with created_at older than the period, in batches of p_batch, until a batch comes
       back short. Cap one run at 20 batches so it cannot hold the table.
     - Return the count deleted.
  3. 00002510: REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role.

SAME CHANGE:
  - documentation/database/search/Functions.md, and documentation/database/security/Tables.md for
    the param key.
  - finance-model.md §17: the query-log line names its dial; the ⚖️ mark stays.
  - SA §Scheduled jobs: add the row.
  - IDENTITY_BUILD_PROMPTS.md: ERA2 gets a status line "step 3 and retention_search_query_log_days
    landed in OPS4 (<sha>); fold the dial into your [erasure_retention] region and drop OPS4's".
    Also update the lines that say the function does not exist (:44, :158).

ACCEPTANCE:
  - query_log_retention.sql: of two rows at 89 and 91 days, only the 91-day row goes; a dial
    changed inside the rollback moves the boundary; an invalid dial falls back to 90 and logs; anon
    and authenticated cannot EXECUTE the function.
  - After a fresh reset the job is registered with a cron.job entry, and scheduled_jobs.sql passes.
```

§1.2 rows: **PRD-G5 → ✅.**

### OPS5 — Job failures, webhook errors and a silent scheduler reach a person

Gives PRD-G7 its non-money half (→ 🟡, together with MR4's money half). The row flips to ✅ in OPS7.

**One pipeline, MR4's shape.** [MONEY_BUILD_PROMPTS.md](MONEY_BUILD_PROMPTS.md) MR4 specifies a
log-to-alert router:

- `ops.alert_rules` (scope pattern, minimum level, channel, dedupe window);
- `ops.alert_deliveries` (append-only);
- `ops.fn_claim_alerts(p_limit)`;
- the http job `ops-deliver-alerts`;
- `apps/web/routes/api/ops/cron/alerts.ts`;
- `OpsAlertService`, with a transport port and a fake;
- `ops_alerts.sql`.

Whichever of MR4 and OPS5 runs first builds that router. The second adds only its own rules and
detectors. Every alert source here therefore becomes an `ops.log_entries` row that a seeded rule
routes. No second alert table.

```text
PROMPT OPS5: The scheduler's failures, a stale job, a failing webhook and a dead scheduler each
reach a person, on the one alert pipeline

ROLE: Postgres + backend engineer. SQL lane (00000013 only if you build the pipeline; 00001650,
00002510, 00005001, 00005050 or the rules' seed file, 00005060), plus a service, two thin routes
and the webhook services. Runs after OPS1.

FIRST: read MONEY_BUILD_PROMPTS.md MR4 in full, and check git for whether it has landed.
  - If it has landed: reuse its tables, claim function, job, route and service. You add rules,
    detectors, the heartbeat and (if ruled) the in-app channel.
  - If it has not landed: build the pipeline exactly as MR4's FILES and STEPS 2-3 and 5 describe
    (same table, function, job, route and service names), seeded with OPS5's rules only. Leave
    MR4's finance.* rules, its reconcile dead-man (step 4) and its /admin/ledger view (step 6) to
    MR4. Tell me, so I can note in MR4 that the pipeline exists.
  - The job's bearer: MR4 names none. Use OPS_CRON_SECRET unless MR4 has already chosen one.

🧑 DECISION — the channel. It is the same question as MR0 #4 and MR4 step 1. Skip it if either has
recorded a ruling; otherwise STOP before delivery and put it to me:
  Option A (recommended, as MR4):
    - an incoming webhook (OPS_ALERT_WEBHOOK_URL, Slack-compatible JSON);
    - plus email to OPS_ALERT_EMAIL through the existing Resend transport
      (packages/backend/services/mail/transport.ts). That transport works today, unlike
      notification email (PRD-E5).
    Two independent channels, so one outage is not silence. This prompt adds an `in_app` channel:
    a notice to every ops.admin_users operator, as dispute.review_overdue already does
    (00001260:880-910).
  Option B: a hosted error tracker. A new vendor and a new data-processing agreement.
  Option C: email only.
  Under every option, the heartbeat (step 5) stands. The one failure the database cannot report is
  its own (Postgres or pg_cron down), and only an outside monitor sees that.

CONTEXT:
  - The scheduler already writes the rows the router needs. ops.fn_log_scheduler_event
    (00001650:12) writes ops.log_entries with scope 'ops.scheduler', client_id
    'scheduler:<job>:<reason>', and a level each caller passes.
      Configuration skips (secret_missing, app_url_missing, vault_unavailable,
        pg_net_unavailable) collapse to one row a day.
      ops-watch-jobs (every 10 min; ops.fn_watch_jobs, 00001650:388) records the http_failed,
        dispatch_failed, no_response and run_failed outcomes.
    Nothing routes any of them to a person.
  - Nothing detects a job that has stopped running. A skipped http run still reads "succeeded" in
    cron.job_run_details. So judge staleness from ops.http_job_dispatches (a 2xx) for http jobs,
    and from cron.job_run_details for sql jobs.
  - Webhooks: POST /api/finance/webhooks/stripe (and stripe-v2, integrations/webhooks/[provider],
    sessions/webhooks/[provider]) answer 400 on a bad signature and 5xx to ask for redelivery. A
    failure leaves only a console.warn (stripe-webhook.ts:400). Stripe retries for days and then
    disables the endpoint, so a persistent failure loses money events with nothing on our side.

FILES (beyond MR4's, if you build the pipeline):
  - 00001650:
      ops.fn_watch_jobs gains a staleness pass. An enabled job with no success for
        job_stale_factor × its cadence writes one 'scheduler:<job>:stale' row through
        ops.fn_log_scheduler_event, at level error, once a day while it lasts;
      ops.fn_watch_webhooks(p_now), called from fn_watch_jobs. It reads the raw webhook.<provider>
        rows. When 5xx failures reach webhook_failure_threshold within 15 minutes, it writes one
        summary row with scope 'ops.webhooks', client_id 'webhook:<provider>:failing', at level
        error. The same threshold of signature refusals writes 'webhook:<provider>:signature' at
        level warn (a rotated secret, or a probe);
      ops.fn_heartbeat() for step 5.
  - 00002510: every new function service_role only.
  - 00005001: your own #region [ops_alerts]:
      job_stale_factor: 3;
      webhook_failure_threshold: 5;
      heartbeat_watch_minutes: 30.
  - The rules' seed. Use the category-5 file MR4 chose; if you build the pipeline, a #region in
    00005050_seed_reference_data.sql. The rules:
      ops.scheduler at warn → every channel, dedupe 24 h. A configuration skip is logged once a day
        anyway; every run of that job is skipping.
      ops.scheduler at error → every channel, dedupe 1 h.
      ops.webhooks at error → every channel, dedupe 1 h.
      ops.webhooks at warn → the webhook channel only, dedupe 24 h.
    No rule matches the raw webhook.<provider> scopes, so a single failure never alerts by itself:
    only the detector's summary row does. (The level CHECK on ops.log_entries allows only warn,
    error and metric, so a scope is the separator, not a lower level.)
  - packages/backend/services/ops/: recordWebhookFailure({ provider, status, reason, eventId?,
    eventType? }), facts only. That is stripe-webhook.ts's own rule: read only ids, types and error
    codes off an event. It writes level warn, scope webhook.<provider>, at most one row per provider
    and outcome class per minute, with the count in data, so a flood of forged posts cannot fill
    the table. Also heartbeat().
  - The four webhook SERVICES, not their routes: call recordWebhookFailure on every non-2xx
    outcome.
  - apps/web/routes/api/ops/health.ts: GET, bearer OPS_HEALTH_TOKEN via
    packages/backend/core/bearer.ts (404 otherwise), no-store, a body of {ok} only.
  - packages/backend/core/env.ts + env.test.ts: OPS_HEALTH_TOKEN (and, if you build the pipeline,
    OPS_CRON_SECRET, OPS_ALERT_WEBHOOK_URL, OPS_ALERT_EMAIL), each optional outside production.
  - supabase/probes/ops_alerts.sql: extend MR4's, or create it in MR4's shape.

STEPS:
  1. Reproduce, inside a rollback: an http_failed scheduler row, a job with no run for a day, and
     six Stripe 5xx rows. No delivery is claimed for any of them.
  2. The detectors (staleness, webhooks). Each is idempotent: a condition that persists writes
     again only after its dedupe window, so the router's grouping sees one alert per job or
     provider. Take a cadence from the cron expression conservatively: the largest gap between two
     fire times in a day. A schedule you cannot parse is warned about once, never silently skipped.
  3. Webhook failures are recorded as FILES describes, unit-tested per provider with a forged
     signature and a handler that throws.
  4. The rules, seeded. Adding a scope later is a seeded row, not code (MR4 step 2).
  5. The heartbeat. GET /api/ops/health answers 200 {ok:true} only when all three hold:
       the database answers;
       ops-watch-jobs settled within heartbeat_watch_minutes (fn_heartbeat reads its last
         successful run);
       no alert has waited undelivered for 15 minutes.
     Otherwise it answers 503 {ok:false}. The external monitor (OPS6's runbook) polls it every 5
     minutes with the bearer, and alerts on its own channel.
  6. After the ruling, the in_app channel (if A): one comms.fn_notify per ops.admin_users operator
     per delivered alert, with a new ops.alert type in 00005010 (system, high, in_app). Messages on
     every channel name:
       the job or provider;
       the reason;
       the first and last seen times and the count;
       a link to an operator surface where one exists.
     Never a secret, a token, a payload, or personal data beyond an id.
  7. A test path for OPS7. Write a 'test' scope rule (webhook channel only) and an
     ops.log_entries row at that scope; then `deno task cron:run ops-deliver-alerts` delivers
     exactly one message per configured channel.

SAME CHANGE:
  - documentation/database/ops/{Tables,Functions,Policies}.md.
  - SA §Scheduled jobs: the "Nothing is silent" bullet ends by saying which rows alert and where
    they go; the ops-deliver-alerts row, if you built it.
  - A short SA §Alerting & health: the sources, the rules, the channels, the heartbeat. MR4 adds
    its money sources to the same section.
  - SA §Environment Variable Contract and .env.example (XXXX-XXXX); the Vault comment block, if you
    built the job. OPS1's tool picks the bearer up from the registry with no edit.
  - ROUTING.md: /api/ops/health (and /api/ops/cron/alerts, if you built it).

ACCEPTANCE:
  - ops_alerts.sql (ROLLBACK):
      a scheduler failure, a stale job and a webhook burst each produce one claimable alert;
      a repeat inside the window produces none;
      a repeat after the window produces one;
      a cleared condition writes nothing new;
      anon and authenticated read nothing and execute nothing.
  - Unit tests:
      the detectors' cadence parser;
      recordWebhookFailure per provider, including the per-minute signature counter;
      the heartbeat's three conditions;
      the route guards (404 without the bearer);
      with MR4's fake transport, a down channel does not stop the others.
  - End to end, locally:
      OPS_ALERT_WEBHOOK_URL points at a throwaway receiver (a Deno listener on a free port), and
        email goes to Mailpit if the transport targets it locally (else a fake);
      the test path delivers once; a second run sends nothing.
    Never point the local stack at a real chat or paging endpoint.
  - scheduled_jobs.sql and finance_invariants.sql pass; check, lint, test:unit green.
```

§1.2 rows:

- **PRD-G7 → 🟡**: the jobs, webhooks and heartbeat half is built and proven locally. If MR4 has not
  landed, the evidence names the money half as MR4's. A hosted channel receiving a test alert is
  OPS7.
- PRD-F9 stays with MR4.
- A failure class that PRD-G7 names and you did not cover gets a new row, never silence.

### OPS6 — A deployment the repo describes: host config, environments, a preflight and a runbook

Gives PRD-G8 its config, check and runbook (→ 🟡). The row flips to ✅ in OPS7.

```text
PROMPT OPS6: A host config, a production preflight, a release guard and a runbook from first
bring-up to rollback

ROLE: Platform engineer and lead architect. Config, scripts and docs only: no migration and no
change to app behaviour. You never create a project, set a secret, push config or deploy. You write
what makes those steps repeatable, and I run them (OPS7).

🧑 DECISIONS. STOP after step 1 and put all five to me together. Steps 2-3 can go ahead while you
wait; write nothing host-specific until they are answered.
  (a) The app host. The production artefact is `deno task build` → apps/web/_fresh/server.js,
      served by `deno serve -A --unstable-kv --port 3000` (deno.json "serve").
      Option A (recommended): a container running exactly that, on one managed container platform
        in the database's region. Name two or three that fit, after checking their current docs.
        Why: the image is the same artefact `deno task start` runs; the media pipeline's Worker
        (packages/backend/services/media) and the data export's in-memory ZIP (up to 50 MiB,
        Decision #450 (d)) get a memory size you choose; the cron routes run as long as they need;
        and the host can change without touching the app.
      Option B: Deno Deploy, but only once you have verified in its current documentation: Web
        Worker support, its memory ceiling, the request-duration limit the long http jobs need (data
        exports, calendar sync), and how its KV compares with `--unstable-kv`'s per-instance
        fallback (packages/backend/core/kv.ts).
      Option C: a VM we manage (systemd + a reverse proxy). Cheapest at small scale, but every patch
        is ours.
  (b) Environments and region. Two hosted Supabase projects, never one shared:
      staging: UAT, Stripe test mode, its own Vault, keys and webhooks;
      production: live.
      Put the app in the database's region. Ask me where the first customers are; do not assume.
  (c) How a schema change reaches a hosted database that holds data. This is a gap between root
      CLAUDE.md §1 and the readiness tiers. The tree's migrations are consolidated and edited in
      place, and rebuilt by `db reset`. A hosted database holding testers' data cannot be reset,
      and `supabase db push` applies only version files it has not recorded, so an edited file never
      reaches it.
      Option A (recommended): keep §1 for the tree. Each release ships a generated, reviewed delta
        from the hosted schema to the release's schema (a schema diff against a fresh `db reset` of
        the release), kept as supabase/releases/<date>-<sha>.sql, outside supabase/migrations/, so
        §1 is untouched. It is applied in one transaction after a backup, then re-diffed (expect
        empty). The release guard (step 3) refuses any DROP of a table, column or FK, and any change
        to the escrows, wallets or project_stages columns, without a named human approval (the
        Additive Rule).
      Option B: freeze at the first hosted bring-up and move to forward-only migration files. That
        amends root CLAUDE.md §1 and guardrails.md.
      Option C: rebuild the hosted database at each release. Only before any tester has data.
      Whichever is chosen needs a decision row: this is a new contradiction between root CLAUDE.md
      §1 and PRODUCTION_READINESS's UAT tier ("live data"). Log it; do not resolve it yourself.
  (d) Domains:
      the app's origin (= APP_URL = GoTrue's Site URL) and www handling;
      the Resend sending domain: SPF, DKIM, DMARC (PRD-E6);
      the Turnstile hostnames (PRD-C15);
      the Stripe v1, v2 and Connect webhook endpoints (PRD-F17);
      every OAuth redirect URI the integrations register (Google, Microsoft, Zoom).
  (e) Backups:
      PITR on production, and its window. ERA4's erasure statement is ⚖️: encrypted backups, kept
        at most 30 days (IDENTITY_BUILD_PROMPTS.md :935);
      a nightly copy of the private Storage buckets, because PITR does not cover Storage
        (EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md :1789);
      a restore drill before launch.

CONTEXT:
  - No deployment config exists. `deno task share` (Cloudflare quick tunnels from one machine,
    scripts/share.ts) is the only way anyone outside reaches the app.
  - The hosted halves already waiting on a project. The runbook links each; it restates none:
      PRD-C13–C16: SAC6's auth:parity and its runbook (readiness/SECURITY_ACCESS_BUILD_PROMPTS.md
        §3);
      PRD-E4–E11 and E6: COMMS CD2's hosted delivery proof (`smoke:delivery`;
        readiness/COMMS_DELIVERY_BUILD_PROMPTS.md) and EPI §8.5;
      PRD-F17: MONEY MR6's `stripe:preflight` and its go-live runbook in SA §Stripe. deploy:check
        (step 2) checks only key presence and mode. Account and endpoint checks are MR6's; do not
        duplicate them;
      PRD-G6: OPS1;
      PRD-G7: the alert channels and heartbeat (OPS5, MR4);
      PRD-M3: the data export's dispatch.
  - Production must never run supabase/seeds/*.sql (the 18 personas) or upload
    supabase/seed-assets/**. The 00005xxx seed migrations are reference data and the job registry,
    and they do run. Verify both: read config.toml [db.seed], and grep every 00005 file for persona
    data.
  - PRD-A8: the landing gate needs response compression (#303 (a)). If the chosen host or its edge
    compresses, record it there.
  - deno.json "serve" pins --port 3000; a host that injects $PORT needs the command to read it.

STEPS:
  1. Read the env contract (SA §Environment Variable Contract, .env.example,
     packages/backend/core/env.ts), supabase/config.toml, deno.json, scripts/share.ts, EPI §8–§10
     and SAC6. Then ask the five questions.
  2. scripts/deploy-check.ts and `deno task deploy:check --env-file <path> --target
     staging|production`: read-only, offline, printing names only. It fails on:
       a required key missing, or still XXXX-XXXX;
       DENO_ENV not production;
       APP_URL not https;
       SUPABASE_URL local;
       a Stripe key of the wrong mode for the target (live only for production, test only for
         staging), or a missing webhook secret;
       ENCRYPTION_KEY not 64 hex characters;
       any *_CRON_SECRET under 32 characters, or two of them equal;
       Cloudflare's published Turnstile test keys (#447);
       USE_MOCKS true;
       any *_BACKEND_LIVE gate not as the release declares (a small committed per-target
         expectations file);
       OPS5's alert keys absent for production.
     The required list is requiredIn from packages/backend/core/env-manifest.ts
     (SECRETS_CONFIG_BUILD_PROMPTS.md CFG1). If CFG1 has not landed, build that manifest file in
     CFG1's shape and leave its contract test to CFG1. Never a second hand-kept list. Unit-test
     every rule on fixture env files.
  3. The release guard, whichever option (c) picks. At minimum, a script that scans a SQL delta for
     DROP TABLE, DROP COLUMN and DROP CONSTRAINT … FOREIGN KEY, and for any ALTER on
     finance.escrows, finance.wallets or projects.project_stages, and exits 1 unless the file
     carries an approval line naming its decision. Unit-tested.
  4. After the 🧑, the host's files:
     - for example a Dockerfile and a .dockerignore that excludes every .env*, .claude/,
       supabase/seed-assets/ and test output, plus the host's own config file;
     - they build with `deno task build` and serve the production artefact on the host's port;
     - a health route if the host needs one: reuse OPS5's GET /api/ops/health if it has landed,
       else a minimal unauthenticated /api/healthz that touches nothing.
     Build the image locally and run it once against the local stack with staging-shaped env. A
     production DENO_ENV refuses test keys, by design.
  5. documentation/architecture/DEPLOYMENT_RUNBOOK.md (new; add it to documentation/CLAUDE.md's
     document map), with these sections:
     - Environments: a table.
     - First bring-up, per environment, in order:
         project + region;
         schema, per (c);
         reference seeds only;
         storage buckets;
         `supabase config push`, and SAC6's auth runbook;
         Vault, via OPS1;
         the app env, from the checked file;
         DNS, the Resend domain, the Turnstile hostnames;
         Stripe keys and webhook endpoints, then MR6's `stripe:preflight` on the host;
         OAuth redirect URIs;
         deploy;
         the smoke list, including CD2's `smoke:delivery --check`;
         the uptime monitor on the heartbeat.
     - Release: deploy:check → backup → schema delta → deploy → smoke → watch alerts for 30
       minutes.
     - Rollback. The app: redeploy the previous immutable image, tagged by sha. The database:
       forward-fix by default; restore only for corruption, saying what a restore undoes (ERA4's
       tombstone replay).
     - Secret rotation. Cron bearers: the app env first, then Vault, then OPS1's --check.
       ENCRYPTION_KEY: never rotate it until PRD-H2's rewrap exists. Stripe and Resend keys.
     - A "Last executed" line per environment, which OPS7 fills.
  6. SYSTEM_ARCHITECTURE.md gets a short §Deployment & environments with the binding rules only:
     two projects; the artefact; the schema-delivery rule from (c); no seed personas outside local;
     the preflight. It links the runbook.

SAME CHANGE:
  - The decision row for (c) (the newest decisions-*.md + a README index line; re-check the number
    first, because peers number on their branches).
  - .env.example, if the check adds keys.
  - deno.json tasks, each with its $comment.
  - documentation/CLAUDE.md's document map.

ACCEPTANCE:
  - deploy:check exits 0 on a complete fixture, and exits 1 naming each broken rule on bad ones. It
    never prints a value.
  - The release guard refuses a DROP fixture and accepts an approved one.
  - After the 🧑: the image builds, and serves / and the health route against the local stack.
  - The runbook is complete enough that OPS7 can follow it without reading this prompt.
  - check, lint, test:unit green.
```

§1.2 rows: **PRD-G8 → 🟡** ("config, preflight and runbook in the repo; executed on staging: OPS7").
If (b) puts UAT on a hosted staging project, also add **PRD-G9** "A hosted staging environment
testers can reach" (Critical, UAT, Track OPS6 → OPS7) at the end of §G, and recompute.

### OPS7 — Staging brought up by the runbook, with the scheduler, alerts, rollback and a restore proved

Closes PRD-G6, G7 and G8 (and G9 if OPS6 added it). It runs with you at the keyboard.

```text
PROMPT OPS7: Bring up staging by the runbook; prove the scheduler, the alerts, a rollback and a
restore; record the evidence

ROLE: Release engineer working beside me. I hold every credential. You never type, paste, print or
read a secret value. You never change a hosted setting yourself, and you never move live money. You
tell me the next command, and I run it, or I approve your running a script that reads a file I
named. You read the output, which is names and booleans. Stripe stays in test mode on staging.

PREREQUISITES: OPS1, OPS5 and OPS6 on main, and OPS6's five 🧑 answered. Ideally PM-WP1 and
OPS2-OPS4 too; otherwise their jobs are absent or dormant on staging, and you say so in the
evidence.

STEPS:
  1. Walk DEPLOYMENT_RUNBOOK.md's first bring-up for staging, step by step, ticking each step. Stop
     at any step the runbook gets wrong, fix the runbook in this change, then continue.
  2. `deno task deploy:check --target staging` on my env file: green.
  3. The schema, per the (c) ruling. Then the re-diff: empty. Then the probes that are safe on a
     hosted database: none that commits, none that needs seed personas. List which ones you ran.
  4. `cron:vault --env-file …`, then `--check`. Every enabled http job is ready, each value equals
     the app env's (by digest), and CRON_APP_URL is the public origin.
  5. Prove the scheduler. Run the non-money jobs first: wait for one natural run of each http job,
     or `deno task cron:run <job>` against staging. Confirm a 2xx per job in
     ops.http_job_dispatches and no new scheduler failure row. Run the money jobs only on Stripe
     test mode, and only after I say go.
  6. Prove the alerts:
     - raise ops.fn_raise_alert('test', …): one message arrives in each configured channel, and the
       operators' in-app notice appears;
     - resolve it: one resolved message;
     - point the uptime monitor at the heartbeat: 200;
     - I pause ops-watch-jobs (UPDATE ops.scheduled_jobs SET enabled = false …): the heartbeat turns
       503, and the monitor alerts within its interval. I re-enable it.
  7. Roll back once: redeploy the previous image tag and back, timing both.
  8. Restore drill: restore staging's latest backup into a scratch project (or the platform's
     restore-to-new), run the re-diff and the read-only probes there, and time it. Delete the
     scratch project when I confirm.
  9. Record the evidence in the runbook's "Last executed" line and in the readiness rows: dates,
     the environment, the commands, the outcomes. No secret, token, connection string or personal
     data in any of it.
```

§1.2 rows:

- **PRD-G6 → ✅**: the `--check` output.
- **PRD-G7 → ✅**: the test alert and the heartbeat drill.
- **PRD-G8 → ✅**: the bring-up and the rollback and restore drills. Production repeats the same
  runbook at launch.
- **PRD-M3 → ✅** if `account-data-exports` dispatched a 2xx.
- **PRD-G9 → ✅** if OPS6 added it.
- If you applied their hosted halves in the same sitting, also C13–C16, E6 and F17, each with its
  own evidence.
