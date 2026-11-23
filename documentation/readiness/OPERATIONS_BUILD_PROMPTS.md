# Operations Build Prompts — closing PRODUCTION_READINESS §B, §G and §H

> **Status: WORK ORDERS, not binding.** Claude Code prompts that close
> [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) §B (live data paths and feature flags), §G
> (scheduled jobs and operations) and §H (secrets and configuration): the hosted deployment (OPS6,
> OPS7), the env contract and the vault key's rotation (CFG1, CFG2), and production's fixture rule
> (LD4). Decision #512 rules the deployment and holds its open stops; #444 governs the tracker.
>
> **Verified against code 2026-11-23 at `f2e25929`.** 3 open, 2 partly done, 8 done (§0 ledger).
> Runnable now: CFG1, CFG2, LD4.
>
> **This file holds open work only.** A session that runs a prompt prunes it here when it finishes
> (§1's closing duty; [`build-prompts.md`](../reference/build-prompts.md) §2).

**Rollup, not restatement.** PRD-B6 is PM-WP4b and PRD-G11 is PM-WP5a, both in
[PM_BUILD_PROMPTS.md](../architecture/PM_BUILD_PROMPTS.md). MR6's `stripe:preflight`
([FINANCE_BUILD_PROMPTS.md](../architecture/FINANCE_BUILD_PROMPTS.md)), COMMS CD2's hosted delivery
proof ([COMMS_BUILD_PROMPTS.md](../architecture/COMMS_BUILD_PROMPTS.md)) and SAC6's `auth:parity`
([IDENTITY_BUILD_PROMPTS.md](../architecture/IDENTITY_BUILD_PROMPTS.md)) are steps in OPS6's
runbook, linked and not restated.

**IDs.** The CFG and LD prompts keep the names they had in their own files, which merged here on
2026-11-23 (§Map of merged files).

---

## 0. Map, run order and stops

### 0.0 Done

| ID                       | What landed                                                                                                   | Commit                 | Text at                                   |
| :----------------------- | :------------------------------------------------------------------------------------------------------------ | :--------------------- | :---------------------------------------- |
| OPS1                     | `cron:vault` writes every registry bearer to any Vault; `--check` proves digest parity; `--operator-file`     | `10454e87`, `cdf40c0c` | `f2e25929`                                |
| OPS2                     | `scheduling.fn_settle_votes`; `scheduling-settle-votes` registers; only the electorate's ballots count (#513) | `dd1ee9a2`             | `f2e25929`                                |
| OPS3                     | The workload-report expiry sweep locks, spares settled tickets and runs every 15 minutes (#519)               | `fd0c91aa`             | `f2e25929`                                |
| OPS4                     | `search.fn_prune_query_logs` on `retention_search_query_log_days`; its daily job registers (#515)             | `4a73588e`             | `f2e25929`                                |
| OPS5                     | Stale-job and webhook detectors, the `/api/ops/health` heartbeat, in-app alerts on MR4's pipeline (#518)      | `c93f6a18`             | `f2e25929`                                |
| PM-WP1 deltas (old §2.1) | Folded into PM-WP1: the claim TTL runs, and a prepaid escrow re-arms (D3 ruled A, #516)                       | `07d853f6`             | `f2e25929`                                |
| LD1                      | A three-valued `liveRead`: a projects read under a live gate answers 401 or 503, never fixtures (#495)        | `322c4dc9`             | `f2e25929` (`LIVE_DATA_BUILD_PROMPTS.md`) |
| LD2                      | `money-gate.ts`: every money write refuses 503 with `FINANCE_BACKEND_LIVE` off (#497)                         | `ac7d4348`, `1d9b6dc7` | `f2e25929` (`LIVE_DATA_BUILD_PROMPTS.md`) |
| LD3                      | `MocksForcedError` under `USE_MOCKS`; the registry pinned by a test; `PROFILE_BACKEND_LIVE` retired (#505)    | `322c4dc9`, `b496f1df` | `f2e25929` (`LIVE_DATA_BUILD_PROMPTS.md`) |

### 0.1 Row → work order

PRD-B1–B4, G1–G5, H1 and H3 are ✅. The open rows:

| Row     | Gate | Crit     | Work order                                                                        | The row flips to ✅ when                                                                                                          |
| :------ | :--- | :------- | :-------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| PRD-B5  | PROD | Normal   | **LD4**                                                                           | In production, every gated-off surface refuses instead of serving fixtures, and boot reports each domain's road                   |
| PRD-B6  | UAT  | Normal   | PM-WP4b (PM) — blocked on PM-WP4a and PROJECTS ST2 (DB3 `44382c08` and DB6 #532 landed) | A worked ticket archives (`tickets.archived_at`), and the refusal at `ProjectBackendService.ts:3229` goes; USER_FLOWS PJ-34 moves |
| PRD-B7  | PROD | Normal   | — (🧑 #497 (a))                                                                   | The owner rules whether the money switch also stops the money a project's lifecycle moves, and that ruling is built               |
| PRD-B8  | UAT  | Normal   | — (found by LD1, #495; no work order)                                             | A project page whose read fails says so, instead of 303ing as "Project does not exist"                                            |
| PRD-G6  | UAT  | Critical | OPS1 → 🟡 · **OPS7** → ✅                                                         | `cron:vault --check` is green against the hosted project                                                                          |
| PRD-G7  | PROD | High     | MR4 + OPS5 → 🟡 · **OPS7** → ✅                                                   | A hosted test alert reaches every chosen channel, and the heartbeat drill trips the monitor                                       |
| PRD-G8  | PROD | Critical | **OPS6** → 🟡 · **OPS7** → ✅                                                     | The runbook has been executed once on staging, rollback and restore drills included                                               |
| PRD-G10 | PROD | Normal   | — (found by OPS5, #518 (a); no work order)                                        | A channel says when an alert's condition has cleared                                                                              |
| PRD-G11 | UAT  | Normal   | PM-WP5a (PM)                                                                      | A report's way out resumes an unfunded ticket too                                                                                 |
| PRD-H2  | PROD | High     | **CFG2**                                                                          | The rotation drill ends with every row re-sealed under the new key, the old one removed, and every row opening                    |
| PRD-H4  | PROD | Normal   | **CFG1**                                                                          | `env-contract.contract.test.ts` is green, and no code under `apps/` or `packages/` reads the env outside `env.ts`                 |
| PRD-H5  | PROD | Normal   | **CFG1** (names them planned)                                                     | Every planned provider key is in the manifest, the contract and `.env.example`, each naming the work order that makes it live     |

Rows outside these sections that move: PRD-M3's remaining half (the data export's hosted dispatch)
flips with OPS7. PRD-F9 stays MR4's; #507 (E)(3) holds it 🟡 until a hosted send.

### 0.2 Run order

| Lane   | Prompt             | Holds                                                                                  | When                                                                                                                       |
| :----- | :----------------- | :------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| App    | **CFG1**           | `env.ts`, `env-manifest.ts`, `.env.example`, SA's contract, the direct-read files      | Any time. Other prompts add keys to these files, so rebase right before you commit: the new test names any key they added. |
| App    | **LD4**            | `packages/backend/core` (the fixture rule), each service's fixture road, the boot path | Any time, but not beside CFG1: both edit `.env.example`, SA's contract and the `DENO_ENV` read.                            |
| SQL    | **CFG2**           | `00001500`, `00002510`, `00005060`                                                     | When the shared SQL lane hands it `00002510` and `00005060` (one writer each, across all tracks).                          |
| Config | **OPS6** steps 4–6 | The host's files, `DEPLOYMENT_RUNBOOK.md`, SA §Deployment & environments               | After #512's stops (a)–(f) are ruled. No migration.                                                                        |
| Hosted | **OPS7**           | — (you and a session)                                                                  | After OPS6, with a hosted staging project.                                                                                 |

### 0.3 Human stops on this path

1. **OPS6: Decision #512's six stops**, asked 2026-11-19 and not yet ruled:
   - (a) the app host (Deno Deploy is out: it shuts down, #512 (j));
   - (b) the environments and their region;
   - (c) how a schema change reaches a hosted database that holds data, a new conflict with root
     `CLAUDE.md` §1;
   - (d) the domains;
   - (e) the backups (PITR is ⚖️ with ERA4);
   - (f) the artefact's permissions, a new conflict with SA §Runtime & API Security.

   #512 (k) also asks the owner to review `requiredIn` with each release.
2. **OPS7:** you hold every hosted credential. No agent types or reads a secret value, changes a
   hosted setting, or moves live money. The scripts read files you point them at and print names and
   booleans.
3. **Flag (a stop for OPS6 to raise, not a blocker):** testers need somewhere to reach the app.
   PRD-G6 is gated UAT but needs a hosted project, while PRD-G8 is gated PROD. Either UAT runs over
   `deno task share` (your machine, fragile), or a hosted staging project is a UAT prerequisite. The
   recommendation is hosted staging. OPS6 then adds **PRD-G9** "A hosted staging environment testers
   can reach" (Critical, UAT) at the end of §G. That lowers the UAT score until OPS7 lands, which is
   the honest number.
4. **PRD-B7** (🧑 #497 (a)) has no prompt here until the owner rules it.

CFG1, CFG2 and LD4 have no stop. Their architect defaults are written in the prompts, for you to
confirm or override:

- **CFG1:** planned keys sit in `.env.example` as commented lines in a "Planned" block, so a copied
  file sets nothing that nothing reads; tooling variables are listed in the contract, marked as
  tooling.
- **CFG2:** the ring is two keys, `ENCRYPTION_KEY` and `ENCRYPTION_KEY_PREVIOUS`; the re-seal sweep
  runs hourly as a no-op until a rotation starts; routine rotation is at least yearly. The vault
  keys on an env variable, not a KMS (Decision #343, ruling C4 (c)), and CFG2 keeps that ruling.

---

## 1. Standard header — paste above every prompt in this file

Replace `<ROWS>` with the "Readiness rows" line under the prompt.

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types
the Zod SSOT @projective/types; packages/backend fat services @server/services/*, with
packages/backend/core/env.ts the one typed reader of the server environment; supabase/migrations
Postgres with RLS everywhere; pg_cron + pg_net + Supabase Vault for scheduled jobs; Supabase CLI
config in supabase/config.toml; Stripe Connect).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (always
     documentation/CLAUDE.md; documentation/database/CLAUDE.md when SQL changes;
     packages/ui/CLAUDE.md for UI), then documentation/reference/guardrails.md and
     documentation/reference/pr-checklist.md.
  2. Read the documentation/readiness/PRODUCTION_READINESS.md rows your prompt names (§B, §G or §H)
     and documentation/readiness/OPERATIONS_BUILD_PROMPTS.md §0 (run order, file locks, stops).
     Then, by prompt:
       OPS: SYSTEM_ARCHITECTURE.md §Scheduled jobs, 00001650_functions_ops_scheduler.sql,
         00005060_seed_scheduled_jobs.sql and supabase/probes/scheduled_jobs.sql;
       CFG: SYSTEM_ARCHITECTURE.md §Environment Variable Contract and §The token vault, and
         packages/backend/core/env-manifest.ts;
       LD: SYSTEM_ARCHITECTURE.md's mock and data-source paragraphs, and
         packages/backend/mocks/registry.ts.
  3. Grep documentation/reference/decisions/README.md for the surface you touch and read the
     decision files it names. At minimum: #444 (the readiness tracker); for OPS, #125 (the cron
     bearer guard), #202 and #203 (the job registry), #512 (the deployment), #514 (cron:vault) and
     #518 (alerts); for CFG, #125, #335 and #343 (ruling C4: the token vault and its key) and #447
     (the Turnstile test keys); for LD, #495, #497 and #505. If a decision already rules the
     behaviour you are about to change, stop and ask me.
  4. The CONTEXT below was written at main @ b7280787 (2026-11-18) and spot-checked at f2e25929
     (2026-11-23). Re-check every file:line against the current tree before relying on it; another
     track may have landed since.

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
  - Locally the money sweeps stay on `deno task cron:run`: never put FINANCE_CRON_SECRET or
    ACCOUNT_CRON_SECRET into the shared local Vault.
  Secrets
  - No secret value in a migration, seed, probe, fixture, test, log, commit or tool output, ever.
    Scripts read secrets from a file or the environment, never from argv, and print names and
    booleans only. .env.example holds XXXX-XXXX for every secret (Turnstile's published test keys
    are the one exception, Decision #447), and false for every *_BACKEND_LIVE gate.
  - Never change the shared .env.local. Every session in this checkout reads it, and its
    ENCRYPTION_KEY seals their rows. Prove anything key-related on a throwaway database with a
    throwaway env.
  - A key, DEK or plaintext token is zeroed after use, and never logged, returned to a route, or
    attached to an error.
  SSOT & architecture
  - Migrations are consolidated and EDITED IN PLACE (vvvvtooo_type_purpose.sql); never an ALTER
    patch or a "fix" file. Each statement in its category file (0 tables · 1 functions: 00001500
    integrations, 00001650 ops · 2 policies/grants: 00002510 function grants · 3 views · 4
    indexes · 5 seed: 00005001 params in your own #region (Decision #274), 00005010 notification
    types, 00005060 jobs). The Additive Rule: no dropped table, column or FK without my OK.
    00002510 and 00005060 have one writer at a time across ALL tracks.
  - A NEW SECURITY DEFINER function pins search_path = '' and schema-qualifies every name. When you
    edit an existing function that writes projects.tickets, keep its file's established
    search_path: that table's triggers use unqualified names and inherit the caller's path. Every
    sweep is REVOKEd from PUBLIC, anon and authenticated, and granted to service_role.
  - Thin routes; logic lives in packages/backend/services/* and returns ServiceResult<T>
    (Decision #10). Islands never import Supabase or @server/*. Web code imports the env reader as
    @projective/backend/core/env.ts (apps/web/features/marketing/core/site-origin.ts does).
  - These land in the same change as the thing they describe:
      a schema or RPC-contract change → its Zod schema, the backend mapper and
        documentation/database/*;
      a route → ROUTING.md;
      an env key → SYSTEM_ARCHITECTURE.md §Environment Variable Contract, .env.example
        (XXXX-XXXX), packages/backend/core/env.ts and its packages/backend/core/env-manifest.ts
        entry;
      a job → its row in SYSTEM_ARCHITECTURE.md §Scheduled jobs;
      a lifecycle change → PRODUCT_MANAGEMENT.md;
      a business rule → PRODUCT_SPEC.md (numbers in finance-model.md).
    A rule marked **Not built yet** that you build loses its marker.
  - Signal-first state; no useState; useEffect only for browser APIs. Token-only pure CSS + BEM.
    Path aliases only; JSDoc on exports; // #region blocks; no meta-comments.
  - A NEW contradiction between source docs: do not pick a side. Add a decision row (the newest
    decisions-*.md + a README index line; re-check the next free number right before writing,
    because peers number on their branches) and ask me.

Verification: reproduce the defect first (a failing probe or test), then fix it.
  SQL: rollback-safe probes under supabase/probes/ (BEGIN … ROLLBACK); `deno task test:probes`. At
  most two SQL sessions on the one local DB, on disjoint migration files. `deno task db:reset` is
  standing-approved, but announce it to concurrent sessions first. Finish with your own clean
  `deno task test:probes:fresh`. A job you register must show in ops.scheduled_jobs and cron.job
  after the reset, and `deno task cron:run <job>` must run it.
  UI-visible changes: `deno task dev`, sign in as the seeded personas
  (documentation/database/Seed.md), capture 1440 and 390 px.
  Always: `deno task check`, `deno task lint`, `deno task test:unit`, and `deno fmt` on the files
  you touched only (never a directory). Compare any red unit test with main before calling it yours
  (theme-engine failures are pre-existing, Decisions #96 (a) and #157 (m)). Docs and .env.example
  are CRLF in the working tree: edit them with an editor tool, never sed.
This checkout may be shared with other sessions: never switch branch, never stash, stage only your
own hunks. Commit on the branch you were given. Do not push or open a PR unless I ask.

READINESS (Decision #444): in the same change, update documentation/readiness/
PRODUCTION_READINESS.md: the row(s) <ROWS> — status, and evidence naming your commit and
decision; recompute that section's line (§B, §G or §H) and the three tier rows of the Scoreboard
(score = Σ weight × credit / Σ weight; ✅ 1 · 🟡 0.5 · ❌ 0; Critical 3 · High 2 · Normal 1; ⏸ rows
excluded; a row counts toward its Gate tier and every later tier); add one line to §Score history.
Update USER_FLOWS.md if a flow's status changes. A gap you find and do not fix gets a new row at
the end of its section, never silence. Several sessions edit this file each day: re-read it right
before you edit, and change only your rows and the totals.

When you finish, do the closing duty (documentation/reference/build-prompts.md §2) in the same
commit as the work:
  - In documentation/readiness/OPERATIONS_BUILD_PROMPTS.md: a done prompt leaves the file. Delete
    its section and add its row to §0's Done ledger (ID · what landed · commit · text at
    <commit>^). A partly done prompt keeps only its open steps, with their numbers unchanged,
    under one rewritten Status line. A ruled 🧑 stop becomes the ruled step, with its decision
    number.
  - Treat any step you built for another prompt the same way, in the file that holds it.
  - Run git grep -n "<ID>" documentation/ and update every place that still calls it open: the
    PRODUCTION_READINESS / USER_FLOWS Track cells, the audit's Status column, other prompts' waits,
    and this file's row in documentation/reference/build-prompts.md §3.
  - If the file has no prompts left, delete it, log it in build-prompts.md §4 and repoint its links.
```

---

## 2. Open prompts

### OPS6 — A deployment the repo describes: host config, environments, a preflight and a runbook

Gives PRD-G8 its config, check and runbook (→ 🟡). The row flips to ✅ in OPS7.

> **Status 2026-11-23:** steps 1–3 landed in `f3ba4c3b` (Decision #512): the questions are with the
> owner, and `packages/backend/core/env-manifest.ts`, `deno task deploy:check` (with
> `deploy/release-gates.json`) and `deno task release:guard` are built and tested. Steps 4–6 below
> are open and wait on #512's stops (a)–(f). Read #512's flags (g)–(k) before step 4.

```text
PROMPT OPS6: A host config, a production preflight, a release guard and a runbook from first
bring-up to rollback

ROLE: Platform engineer and lead architect. Config, scripts and docs only: no migration and no
change to app behaviour. You never create a project, set a secret, push config or deploy. You write
what makes those steps repeatable, and I run them (OPS7).

🧑 DECISIONS. All six are with the owner (Decision #512, asked 2026-11-19). If #512 records no
ruling for one, STOP and ask me; write nothing host-specific until they are answered.
  (a) The app host. The production artefact is `deno task build` → apps/web/_fresh/server.js,
      served by `deno serve -A --unstable-kv --port 3000` (deno.json "serve").
      Option A (recommended): a container running exactly that, on one managed container platform
        in the database's region. Name two or three that fit, after checking their current docs.
        Why: the image is the same artefact `deno task start` runs; the media pipeline's Worker
        (packages/backend/services/media) and the data export's in-memory ZIP (up to 50 MiB,
        Decision #450 (d)) get a memory size you choose; the cron routes run as long as they need;
        and the host can change without touching the app. A container on a pinned Deno 2.x keeps
        working, but its security patches end around October 2027 (#512 (j)).
      Option B: Deno Deploy. Ruled out by fact: it shuts down six months after 2026-10-09
        (#512 (j)).
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
        empty). `deno task release:guard` refuses any DROP of a table, column or FK, and any change
        to the escrows, wallets or project_stages columns, without a named human approval (the
        Additive Rule).
      Option B: freeze at the first hosted bring-up and move to forward-only migration files. That
        amends root CLAUDE.md §1 and guardrails.md.
      Option C: rebuild the hosted database at each release. Only before any tester has data.
      This is a new contradiction between root CLAUDE.md §1 and PRODUCTION_READINESS's UAT tier
      ("live data"), logged in #512 (c). Do not resolve it yourself.
  (d) Domains:
      the app's origin (= APP_URL = GoTrue's Site URL) and www handling;
      the Resend sending domain: SPF, DKIM, DMARC (PRD-E6);
      the Turnstile hostnames (PRD-C15);
      the Stripe v1, v2 and Connect webhook endpoints (PRD-F17);
      every OAuth redirect URI the integrations register (Google, Microsoft, Zoom);
      the provider notification endpoints: Graph subscriptions and Google watch channels need a
        public HTTPS notification URL (PROJECTS_BUILD_PROMPTS.md LP1).
  (e) Backups:
      PITR on production, and its window. ERA4's erasure statement is ⚖️: encrypted backups, kept
        at most 30 days (IDENTITY_BUILD_PROMPTS.md, ERA4);
      a nightly copy of the private Storage buckets, because PITR does not cover Storage
        (EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md :1789);
      a restore drill before launch.
  (f) The artefact's permissions. A new conflict, logged in #512 (f): SA §Runtime & API Security
      says "never --allow-all in production", while deno.json "serve" is `deno serve -A`.
      Option A (recommended): the container runs an explicit set (--allow-net, --allow-env,
        --allow-read scoped to the app and Deno's cache, plus whatever --allow-sys the image smoke
        shows the npm dependencies need); SA names that set, and "serve" adopts it.
      Option B: keep -A, and amend SA to say why.

CONTEXT:
  - No host config exists. `deno task share` (Cloudflare quick tunnels from one machine,
    scripts/share.ts) is the only way anyone outside reaches the app. The host-agnostic half is
    built (f3ba4c3b, #512): the env manifest, `deploy:check` (13 rules, offline, names only; the
    per-target gate expectations in deploy/release-gates.json) and `release:guard`.
  - The hosted halves already waiting on a project. The runbook links each; it restates none:
      PRD-C13–C16: SAC6's `auth:parity` and its runbook (architecture/IDENTITY_BUILD_PROMPTS.md);
      PRD-E4–E11 and E6: COMMS CD2's hosted delivery proof (`smoke:delivery`;
        architecture/COMMS_BUILD_PROMPTS.md) and EPI §8.5;
      PRD-F17: FINANCE MR6's `stripe:preflight` and its go-live runbook in SA §Stripe. deploy:check
        checks only key presence and mode. Account and endpoint checks are MR6's; do not
        duplicate them;
      PRD-G6: OPS1 (`cron:vault --env-file <host env> --operator-file <operator env>`, then
        `--check`; #514 (j));
      PRD-G7: the alert channels and heartbeat (OPS5, MR4);
      PRD-M3: the data export's dispatch.
  - Production must never run supabase/seeds/*.sql (the 18 personas) or upload
    supabase/seed-assets/**. The 00005xxx seed migrations are reference data and the job registry,
    and they do run (verified in #512: no 00005 file holds a persona). The runbook forbids the three
    CLI commands that would put development data on a hosted project: `supabase db reset` against a
    linked project, `db push --include-seed`, and `seed buckets` (#512 (h)).
  - PRD-A8: the landing gate needs response compression (#303 (a)). If the chosen host or its edge
    compresses, record it there.
  - deno.json "serve" pins --port 3000; a host that injects $PORT needs the command to read it.

STEPS:
  4. After the 🧑, the host's files:
     - for example a Dockerfile and a .dockerignore that excludes every .env*, .claude/,
       supabase/seed-assets/ and test output, plus the host's own config file;
     - they build with `deno task build` and serve the production artefact on the host's port,
       with the permissions (f) rules;
     - a liveness route if the host needs one: a minimal unauthenticated /api/healthz that touches
       nothing. Not OPS5's GET /api/ops/health: that is the scheduler heartbeat (503 when the
       scheduler is stale), so a platform that restarts on a failed probe would restart a healthy
       app (#512 (g)).
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
         Vault, via OPS1 (`--env-file` + `--operator-file`, then `--check`);
         the app env, from the checked file;
         DNS, the Resend domain, the Turnstile hostnames;
         Stripe keys and webhook endpoints, then MR6's `stripe:preflight` on the host;
         OAuth redirect URIs and the provider notification endpoints;
         deploy;
         the smoke list, including CD2's `smoke:delivery --check`;
         the uptime monitor on the heartbeat.
     - Release: deploy:check → backup → schema delta → deploy → smoke → watch alerts for 30
       minutes.
     - Rollback. The app: redeploy the previous immutable image, tagged by sha. The database:
       forward-fix by default; restore only for corruption, saying what a restore undoes (ERA4's
       tombstone replay). A restored project fires its pg_cron and pg_net jobs at once, and
       Storage is not copied: drill on staging only, and replace the scratch project's Vault
       entries first (#512 (i)).
     - Secret rotation. Cron bearers: the app env first, then Vault, then OPS1's --check.
       ENCRYPTION_KEY: never rotate it until CFG2 (PRD-H2) lands; then link CFG2's runbook in
       SA §The token vault. Stripe and Resend keys.
     - A "Last executed" line per environment, which OPS7 fills.
  6. SYSTEM_ARCHITECTURE.md gets a short §Deployment & environments with the binding rules only:
     two projects; the artefact; the schema-delivery rule from (c); no seed personas outside local;
     the preflight. It links the runbook.

SAME CHANGE:
  - #512's row: each stop's ruling, and what step 4-6 built.
  - .env.example and the env manifest, if the host adds keys.
  - deno.json tasks, each with its $comment ("serve", if (f) changes its permissions).
  - documentation/CLAUDE.md's document map.

ACCEPTANCE:
  - The image builds, and serves / and the liveness route against the local stack.
  - The runbook is complete enough that OPS7 can follow it without reading this prompt.
  - check, lint, test:unit green.
```

Readiness rows: **PRD-G8 → 🟡** ("config, preflight and runbook in the repo; executed on staging:
OPS7"). If (b) puts UAT on a hosted staging project, also add **PRD-G9** "A hosted staging
environment testers can reach" (Critical, UAT, Track OPS6 → OPS7) at the end of §G, and recompute.

### OPS7 — Staging brought up by the runbook, with the scheduler, alerts, rollback and a restore proved

Closes PRD-G6, G7 and G8 (and G9 if OPS6 added it). It runs with you at the keyboard.

> **Status 2026-11-23:** open. It waits on OPS6 steps 4–6, #512's rulings and a hosted staging
> project. OPS1–OPS5 and PM-WP1 are on main.

```text
PROMPT OPS7: Bring up staging by the runbook; prove the scheduler, the alerts, a rollback and a
restore; record the evidence

ROLE: Release engineer working beside me. I hold every credential. You never type, paste, print or
read a secret value. You never change a hosted setting yourself, and you never move live money. You
tell me the next command, and I run it, or I approve your running a script that reads a file I
named. You read the output, which is names and booleans. Stripe stays in test mode on staging.

PREREQUISITES: OPS6 complete on main, with Decision #512's stops (a)–(f) ruled, and a hosted
staging project.

STEPS:
  1. Walk DEPLOYMENT_RUNBOOK.md's first bring-up for staging, step by step, ticking each step. Stop
     at any step the runbook gets wrong, fix the runbook in this change, then continue.
  2. `deno task deploy:check --env-file <my env file> --target staging`: green.
  3. The schema, per the (c) ruling. Then the re-diff: empty. Then the probes that are safe on a
     hosted database: none that commits, none that needs seed personas. List which ones you ran.
  4. `deno task cron:vault --env-file <host env> --operator-file <operator env>`, then the same
     with `--check` (#514 (j)). Every enabled http job is ready, each value equals the app env's (by
     digest), and CRON_APP_URL is the public origin.
  5. Prove the scheduler. Run the non-money jobs first: wait for one natural run of each http job,
     or `deno task cron:run <job>` against staging. Confirm a 2xx per job in
     ops.http_job_dispatches and no new scheduler failure row. Run the money jobs only on Stripe
     test mode, and only after I say go.
  6. Prove the alerts:
     - raise ops.fn_raise_alert('test', …): one message arrives in each configured channel, and the
       operators' in-app notice appears;
     - no channel sends a "resolved" message yet (PRD-G10, #518 (a)). If PRD-G10 has landed,
       resolve the alert: one resolved message;
     - point the uptime monitor at the heartbeat: 200;
     - I pause ops-watch-jobs (UPDATE ops.scheduled_jobs SET enabled = false …): the heartbeat turns
       503, and the monitor alerts within its interval. I re-enable it.
  7. Roll back once: redeploy the previous image tag and back, timing both.
  8. Restore drill: restore staging's latest backup, never production's, into a scratch project
     (or the platform's restore-to-new). Its cron jobs fire at once, so replace its Vault entries
     first (#512 (i)). Run the re-diff and the read-only probes there, and time it. Delete the
     scratch project when I confirm.
  9. Record the evidence in the runbook's "Last executed" line and in the readiness rows: dates,
     the environment, the commands, the outcomes. No secret, token, connection string or personal
     data in any of it.
```

Readiness rows:

- **PRD-G6 → ✅**: the `--check` output.
- **PRD-G7 → ✅**: the test alert and the heartbeat drill.
- **PRD-G8 → ✅**: the bring-up and the rollback and restore drills. Production repeats the same
  runbook at launch.
- **PRD-M3 → ✅** if `account-data-exports` dispatched a 2xx.
- **PRD-G9 → ✅** if OPS6 added it.
- If you applied their hosted halves in the same sitting, also C13–C16, E6 and F17, each with its
  own evidence.

### CFG1 — One env manifest, and a contract test that keeps every copy of it equal

Closes PRD-H4 and PRD-H5.

> **Status 2026-11-23:** step 2 landed in `f3ba4c3b` (OPS6, Decision #512): `env-manifest.ts` exists
> in this shape, plus a `confine` field (`development` · `operator`), and step 6 with it
> (`deploy:check` reads `requiredIn` and keeps no list). Steps 1 and 3–5 below are open. The
> manifest still marks `OPS_HEALTH_TOKEN` planned, though OPS5 made it live (#518 (d)).

```text
PROMPT CFG1: A contract test that keeps SYSTEM_ARCHITECTURE's contract, .env.example, env.ts and
config.toml equal to the env manifest

ROLE: Platform engineer. App lane: no migration. packages/backend/core/env.ts and .env.example are
edited by many prompts, so rebase them right before you commit.

CONTEXT (diffed by script on 2026-11-18 at b7280787, spot-checked at f2e25929):
  - packages/backend/core/env-manifest.ts (f3ba4c3b) is the one list: pure data, one entry per name
    (reader, kind, live or planned with its work order, requiredIn, confine), with requiredIn(),
    liveAppGates() and isSchedulerBearer(). deploy:check (scripts/deploy-check.ts) reads it. Keep
    those exports; adopt confine or say why not.
  - SA's contract now names RESEND_API_KEY, MAIL_FROM, USE_MOCKS (LD3's paragraph) and PORT.
  - env.ts reads VITE_USE_MOCKS as an alias of USE_MOCKS. Nothing sets it (deno.json, vite.config.ts,
    scripts and .env* never do), and env.ts's header says "no fallback aliases remain". The
    manifest's MOCK_SWITCHES, deploy:check's use-mocks rule and data-source.test.ts name it too.
    SUPABASE_PUBLIC_URL falling back to SUPABASE_URL is another alias the header does not mention.
  - .env.example carries seven keys env.ts never reads: OPENAI_API_KEY, S3_HOST, S3_REGION,
    S3_ACCESS_KEY, S3_SECRET_KEY, SUPABASE_AUTH_EXTERNAL_APPLE_SECRET and
    SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN. All are env() references in supabase/config.toml (:114,
    :489-495, :416, :384), which the Supabase CLI resolves; the app does not. So are
    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (:499-500), SUPABASE_AUTH_CAPTCHA_SECRET (:245) and
    SUPABASE_AUTH_SMTP_PASS / SUPABASE_AUTH_SMTP_ADMIN_EMAIL (:277-278). SA names this group only
    as a category ("Google sign-in, Twilio, Apple, S3, GoTrue SMTP, the Turnstile secret"); the
    manifest lists them as supabase-cli entries. SAML_PRIVATE_KEY (:343) and SECRET_VALUE (:53)
    sit in commented examples: check that before listing them.
  - Direct reads that bypass env.ts:
      apps/web/routes/api/_middleware.ts:10: Deno.env.get("APP_URL") into
        refuseCrossSiteWrite(req, appUrl?);
      apps/web/routes/_middleware.ts:45: the same for page writes (SAC4);
      apps/web/utils/csp.ts:150: SUPABASE_PUBLIC_URL ?? SUPABASE_URL;
      apps/web/utils/app-env.ts:13: DENO_ENV, "matching serverEnv().appEnv" (unset means
        production);
      packages/backend/services/ops/ScheduledJobsBackendService.ts:23 (new since the diff):
        readProcessEnv(key) reads a job's bearer by its registry secret_name for cron:run. Route
        it through env.ts, or exempt it by name with the reason.
    CAREFUL: serverEnv().appUrl DEFAULTS to http://localhost:<PORT> when APP_URL is unset, while
    the CSRF guard is handed undefined today. Read refuseCrossSiteWrite and ownOrigins
    (apps/web/utils/csrf.ts:106) before you switch. If undefined means "trust only the request's
    own origin", the default would widen that to localhost on a misconfigured deploy. Keep today's
    behaviour exactly, for example with an accessor that has no default.
  - Tooling variables (PROBES_DB_CONTAINER, SMOKE_DB_CONTAINER, STRIPE_MOCK_URL, the E2E_* names,
    SAC6's SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN, OPS1's CRON_VAULT_DB_URL and
    CRON_VAULT_DB_CA) are tooling entries in the manifest, and listed nowhere else.
  - PRD-H5: the planned providers' keys. The manifest marks planned only COMMS NT5's
    TWILIO_AUTH_TOKEN, T&S SN1's SAFETY_NODE_URL, SAFETY_NODE_TOKEN, MALWARE_SCAN_LIVE,
    MODERATION_BACKEND_LIVE, MODERATION_CRON_SECRET and FILES_CRON_SECRET, SSO1's AUTH_SSO_ENABLED,
    and the stale OPS_HEALTH_TOKEN. NT2, NT3, NT4, OPS5, MR4, SAC6 and OPS1 have made theirs live.
    Re-harvest before you trust that list: grep every documentation/architecture/*_BUILD_PROMPTS.md
    and documentation/readiness/*_BUILD_PROMPTS.md for new env keys in FILES and SAME CHANGE
    lines, and record which work order each comes from. Each of those prompts flips its own keys
    to live in the manifest, in its own change.

FILES:
  - packages/backend/core/env-manifest.ts: corrections only (the stale planned entry, any name the
    test finds missing). It stays pure data, with no Deno.env read and never a value.
  - packages/backend/core/env.ts. Reads stay as they are, except:
      USE_MOCKS without the VITE_ alias;
      the accessors the four direct reads need, without defaults where today's code has none;
      the header states which aliases remain, and why.
  - The direct-read files: read through env.ts instead (serverEnv(), or the DENO_ENV reader env.ts
    already has).
  - packages/backend/core/env-contract.contract.test.ts (new). Pure file reads, no network; follow
    gotrue-config.contract.test.ts and captcha.contract.test.ts. It fails when any of these hold:
      a name env.ts reads (any firstEnv argument) has no manifest entry, or an 'app' entry that is
        live is not read by env.ts;
      a non-comment env(NAME) in supabase/config.toml has no 'supabase-cli' entry, or vice versa;
      any Deno.env.get(...) or import.meta.env.NAME exists under apps/ or packages/ outside
        env.ts. Tests and scripts are exempt as tooling, and Vite's import.meta.env.DEV is allowed
        by name;
      a manifest name is missing from SA §Environment Variable Contract or from .env.example
        (planned names appear there as commented lines in a "Planned" block);
      .env.example holds a name the manifest does not;
      a secret in .env.example holds anything but XXXX-XXXX (except Turnstile's published test
        keys, #447), or a gate holds anything but false.
    Each failure message names the key and the three places to add it.
  - .env.example: the supabase-cli keys grouped and labelled; a Planned block (commented lines,
    each naming its work order).
  - SYSTEM_ARCHITECTURE.md §Environment Variable Contract: every manifest name, grouped by reader
    (app · Supabase CLI · tooling) and by status (live · planned → its work order).
  - documentation/reference/pr-checklist.md, one line: "A new env key goes in the manifest, SA's
    contract and .env.example in the same change; env-contract.contract.test.ts enforces it. A
    planned key flips to live when its feature lands."

STEPS:
  1. Write the test first, against today's tree. It must fail on exactly the gaps CONTEXT lists,
     plus any a peer has added since; list those in your report.
  3. Route the direct reads through env.ts without changing behaviour. One unit test per site pins
     it: APP_URL unset gives the same guard result as today; SUPABASE_PUBLIC_URL unset falls back
     to SUPABASE_URL's origin; DENO_ENV unset means production.
  4. Remove VITE_USE_MOCKS once you have confirmed nothing sets it, from env.ts, the manifest's
     MOCK_SWITCHES, deploy:check and their tests.
  5. Fix the manifest, the docs and .env.example until the test is green.

ACCEPTANCE:
  - env-contract.contract.test.ts fails on today's tree (step 1, shown in your report) and passes
    after.
  - Adding firstEnv("FOO") with no manifest entry makes it fail, with a message that names FOO and
    the three places to add it.
  - The direct-read sites behave as before (their tests).
  - deploy:check's tests stay green.
  - check, lint, test:unit green.
```

Readiness rows: **PRD-H4 → ✅**. **PRD-H5 → ✅**: every planned provider key is named in the
contract with its work order; making each one live belongs to that prompt.

### CFG2 — The token vault rotates its key without stranding a row or losing a refresh

Closes PRD-H2.

> **Status 2026-11-23:** open. Nothing in the tree builds the ring or the sweep yet.

```text
PROMPT CFG2: A two-key ring, a lease-safe re-seal sweep and a rotation runbook for the token vault

ROLE: Security + backend engineer. SQL lane (00001500, 00002510, 00005060), plus token-vault.ts,
the integrations service and one thin cron route. Holds 00002510 and 00005060 while it runs.

CONTEXT:
  - token-vault.ts seals under ENCRYPTION_KEY only.
      key_id = 'env:' + the first 8 hex of sha256(the key).
      unseal() refuses any row whose key_id is not the current key's (:195).
      Its header (:25) says: "no rewrap, a changed ENCRYPTION_KEY strands every row until each is
        reconnected; build rewrap before the first key rotation". SA §The token vault says the
        same.
    That is PRD-H2.
  - The key_id is inside each token's AAD: <connection_id>|<kind>|<key_id> (:65). So the data key
    cannot simply be re-wrapped under a new key: the stored ciphertexts would then fail their tag
    under the new key_id. A rotation is a full RE-SEAL: unseal under the old key, then seal() under
    the new one, with a fresh DEK and fresh nonces. Do not change the AAD format; every existing row
    depends on it.
  - Refreshed rows migrate by themselves: every refresh already re-seals under the active key
    (fn_commit_refresh → fn_write_secret, 00001500:306, :117). API-key and S3 connections
    (api_secret) and rarely refreshed rows never do, so the sweep finishes the job.
  - THE RACE.
      A refresh claims its connection under refresh_claimed_at, a 5-minute lease
        (fn_claim_connections_for_refresh, 00001500:256-285).
      It spends the refresh token at the provider.
      It commits only if refresh_token_cipher still equals what it read (fn_commit_refresh).
    A re-seal in between changes that cipher, so the commit fails and discards the new tokens. If
    the provider rotated the refresh token, the connection then dies on invalid_grant. So the sweep
    takes the SAME lease (skipping any row already leased), and its write is a compare-and-swap.
  - Only the token vault reads ENCRYPTION_KEY (serverEnv().encryptionKey). The column
    connection_secrets.rotated_at exists: check what writes it before you reuse it.
  - No seed writes connection_secrets; only the integrations_runtime.sql probe does.
  - The ruling stands: the key is an env variable, not a KMS (Decision #343, ruling C4 (c)).

Architect defaults (confirm or override; none blocks):
  - The ring is two names. ENCRYPTION_KEY is the active key, and seal() uses only it.
    ENCRYPTION_KEY_PREVIOUS is optional, and unseal() accepts it by key_id. At most two keys are
    live; a third rotation waits until the sweep has finished.
  - Boot refuses three things: a malformed PREVIOUS; a PREVIOUS equal to the active key; and two
    keys whose key_ids collide.
  - The sweep is an http job, because the app holds the keys: integrations-rewrap-secrets, hourly
    on a free minute, '/api/integrations/cron/rewrap?limit=100', INTEGRATIONS_CRON_SECRET. With
    every row on the active key it is a cheap no-op.

FILES:
  - packages/backend/services/integrations/token-vault.ts:
      loadKeyRing();
      seal() unchanged (the active key);
      unseal() picks the ring key whose id matches the row, and otherwise refuses as today;
      reseal(connectionId, secret): unseal every kind present, then seal under the active key,
        zeroing every DEK;
      the header's "shortcut" paragraph replaced by the rotation rule.
  - packages/backend/core/env.ts: encryptionKeyPrevious, and its packages/backend/core/env-manifest.ts
    entry (optional everywhere).
  - 00001500, three functions, all service_role only:
      integrations.fn_claim_secrets_for_rewrap(p_active_key_id text, p_limit integer DEFAULT 100):
        rows whose key_id differs from the active id and whose connection holds no live refresh
        lease. It sets that same refresh_claimed_at lease, so a refresh skips them, with SKIP
        LOCKED, and returns the envelopes;
      integrations.fn_commit_rewrap(p_connection_id, p_read_key_id, p_read_wrapped_dek,
        p_secret jsonb): writes through fn_write_secret only if the row still holds both
        p_read_key_id and p_read_wrapped_dek, else returns false. It passes the row's own expiry
        values unchanged, clears the lease, and adds a connection_audit line ('rewrapped');
      integrations.fn_vault_key_census(): the row count per key_id, for the runbook's check.
  - 00002510: the three functions.
  - 00005060: the job row.
  - packages/backend/services/integrations/ (IntegrationsBackendService.ts, or a new
    VaultRotationBackendService.ts): rewrapDue(limit) runs claim → reseal → commit. A row that will
    not open is logged (ops.log_entries, scope 'integrations.vault', the connection id only) and its
    lease released. Never retry it in a tight loop.
  - apps/web/routes/api/integrations/cron/rewrap.ts: thin, with the packages/backend/core/bearer.ts
    guard (404 otherwise).
  - Tests:
      token-vault.test.ts: the ring, reseal, the refusals;
      the service, with a fake database;
      supabase/probes/vault_rewrap.sql (ROLLBACK): the claim skips a leased row and leases what it
        returns; the commit's compare-and-swap refuses a row that changed; a refresh claim skips a
        row the rewrap leased; the census counts.
  - Docs:
      SA §The token vault: rotation, the ring, the race, the job;
      SA §Scheduled jobs: the row;
      SA §Environment Variable Contract and .env.example: ENCRYPTION_KEY_PREVIOUS (XXXX-XXXX);
      documentation/database/integrations/Functions.md;
      the runbook (step 6).

STEPS:
  1. Reproduce the strand: seal under key A, switch to key B, and unseal() throws.
  2. Build the ring and reseal(), unit-tested:
     - a row sealed under A opens with B active and A as PREVIOUS;
     - reseal() yields key_id B, with a fresh DEK and fresh nonces;
     - the AAD format is unchanged (pin it with a test).
  3. Write the SQL doors and the probe, race included: the refresh's claim and the rewrap's claim
     exclude each other through the one lease, and a commit after a concurrent refresh returns
     false and writes nothing.
  4. Build the service, the route and the job.
  5. Run a rotation drill on a THROWAWAY database with a throwaway env, never the shared .env.local.
     A database made inside supabase_db_Projective is wiped by any peer's `deno task db:reset`,
     because the reset recreates that container. Prefer a separate container; otherwise check that
     yours still exists right before the drill.
     - seed connections under A, at least one with an api_secret and one with a refresh token;
     - rotate to B, with A as PREVIOUS;
     - run the sweep until the census shows only B;
     - drop A, and prove every row still opens;
     - time it.
  6. Write the runbook in SA §The token vault. Link it from
     documentation/architecture/DEPLOYMENT_RUNBOOK.md if OPS6 has written that file.
     Routine rotation:
       generate key B;
       set ENCRYPTION_KEY=B and ENCRYPTION_KEY_PREVIOUS=A in the app env, and deploy;
       let the job run, or run `deno task cron:run integrations-rewrap-secrets`, until the census
         shows only B;
       remove PREVIOUS, and deploy.
     On suspected compromise:
       do the routine rotation;
       then treat every provider token as exposed. Backups and PITR still hold ciphertext the old
         key opens, so a re-seal is not enough;
       force a refresh of every refresh-token connection (the provider issues new tokens);
       ask the owners of api-secret connections (S3) to rotate their keys at the provider;
       record it as an incident.
     Cadence: on a staff change or a compromise, and at least yearly. That is an architect
     default; the owner may set another.

ACCEPTANCE:
  - The unit tests and vault_rewrap.sql pass.
  - The drill ends with every row on B, A removed, and no plaintext or key in any output.
  - scheduled_jobs.sql and integrations_runtime.sql pass.
  - check, lint, test:unit green.
```

Readiness rows: **PRD-H2 → ✅** (the drill is the evidence) and USER_FLOWS **PJ-75 → ✅**.
`INTEGRATIONS_BACKEND_LIVE` defaults off (`env.ts:486`), but a row is judged with every live gate
on, so that gate is not PJ-75's gap. The first hosted rotation follows the runbook and needs no new
code.

### LD4 — Production never serves fixtures

Closes PRD-B5.

> **Status 2026-11-23:** open. Its wait on LD3 is met (LD3 landed with #505).

```text
PROMPT LD4: In production, a gated-off surface refuses instead of serving fixtures

ROLE: Backend platform engineer. App lane. Not beside CFG1: both edit .env.example, SA's contract
and the DENO_ENV read that CFG1 moves into env.ts.

CONTEXT (verified at b7280787, spot-checked at f2e25929):
  - Contact and Newsletter already refuse in production while their gate is off: 503 rather than
    acknowledging something nobody stores (ContactBackendService.ts:151 isProduction; :346, :407).
  - Community does not: with COMMUNITY_BACKEND_LIVE off, community-source.ts serves demo
    helpfulness votes and feedback ideas from `<surface>-fixtures.ts` and stores nothing, even in
    production. A visitor's vote "works" and vanishes.
  - "Production" is DENO_ENV=production, and an unset DENO_ENV counts as production
    (apps/web/utils/app-env.ts isProductionEnv; SA ~:2294). The backend has its own copies of this
    check (Contact's isProduction(deps)).
  - MOCK_REGISTRY (packages/backend/mocks/registry.ts, LD3, #505) lists every service directory
    that reaches the database, with its gate, gated, ungated and fixtureRoad.
    describeDataSources() (core/data-source.ts) already computes what each domain serves (fixtures
    or unavailable); nothing calls it at boot.

STEPS:
  1. Red: a unit test that, with DENO_ENV=production and COMMUNITY_BACKEND_LIVE=false, a community
     read and a community write each answer 503; today they answer fixtures and a fake success.
  2. One shared rule in packages/backend/core (e.g. `fixtureRoadAllowed()`: false in production).
     Every service's fixture road asks it first, and in production answers its domain's 503
     "isn't available" message. Move Contact's and Newsletter's own checks onto it, keeping their
     behaviour and their tests.
  3. Sweep: for every MOCK_REGISTRY domain with a fixture road (LD3's list), route its fixture
     branch through the rule. Exception: editorial's authored sources are real content, not demo
     data. Decide per domain, and write the decision into the registry entry.
  4. Boot: in production, print describeDataSources() once at startup, and print a loud warning for
     any domain whose gate is off. Do not refuse to boot: a gate that is off now fails closed
     per request, which is enough. Say so in SA.
  5. A test over the registry: in production, no domain's fixture road is reachable (call each
     domain's representative read with its gate off and expect a refusal).

ACCEPTANCE: the step-1 and step-5 tests are green; in development nothing changes (fixtures still
serve with gates off; `deno task dev:mock` as before); a production-mode boot (DENO_ENV=production,
COMMUNITY_BACKEND_LIVE=false) prints the table and the warning, and /feedback shows its unavailable
state rather than demo ideas; check, lint and test:unit green.
SAME CHANGE: SYSTEM_ARCHITECTURE.md (the production rule for fixtures; the boot report);
.env.example's COMMUNITY_BACKEND_LIVE comment ("off, it answers fixtures" becomes "off,
development answers fixtures; production refuses").
```

Readiness rows: **PRD-B5**.

---

## Map of merged files

`SECRETS_CONFIG_BUILD_PROMPTS.md` and `LIVE_DATA_BUILD_PROMPTS.md` merged here on 2026-11-23. Read
either with `git show f2e25929:documentation/readiness/<file>`.

| Old file §                                                     | Went                                                                                               |
| :------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| OPERATIONS §0.1–§0.3                                           | §0.1–§0.3, without the done rows and the ruled stops                                               |
| OPERATIONS §1.1 + §1.2                                         | §1 (the readiness addendum is inside the header now)                                               |
| OPERATIONS §2 (the carve-out notes for PM-WP5a, SCH-WP7, ERA2) | Dropped: each source prompt carries its own status line                                            |
| OPERATIONS §2.1 (PM-WP1 deltas D0–D8)                          | Done, §0.0                                                                                         |
| OPERATIONS §3 OPS1–OPS5                                        | Done, §0.0                                                                                         |
| OPERATIONS §3 OPS6, OPS7                                       | §2                                                                                                 |
| SECRETS_CONFIG §0.1 (§H row map, PRD-H4's stale evidence)      | §0.1; the stale-evidence list is folded into CFG1's CONTEXT                                        |
| SECRETS_CONFIG §0.2 run order                                  | §0.2                                                                                               |
| SECRETS_CONFIG §0.3 stops (architect defaults)                 | §0.3                                                                                               |
| SECRETS_CONFIG §1.1 + §1.2                                     | §1 (its Secrets rules, its file categories and the §H readiness line)                              |
| SECRETS_CONFIG §2 (the keys other prompts make live)           | CFG1's CONTEXT; NT2–NT4, OPS5, MR4, SAC6 and OPS1 have made theirs live                            |
| SECRETS_CONFIG §3 CFG1, CFG2                                   | §2                                                                                                 |
| LIVE_DATA §0.1 (§B row map)                                    | §0.1                                                                                               |
| LIVE_DATA §0.2 run order                                       | §0.2 (LD4 only)                                                                                    |
| LIVE_DATA §0.3 stops                                           | Done: #505 ruled LD3's one default                                                                 |
| LIVE_DATA §1 (pasted SECURITY_ACCESS's header)                 | §1                                                                                                 |
| LIVE_DATA §2 (the PM-WP4b delta, PRD-B6)                       | §0.1's PRD-B6 row; PM-WP4b itself is in [PM_BUILD_PROMPTS.md](../architecture/PM_BUILD_PROMPTS.md) |
| LIVE_DATA §3 LD1–LD3                                           | Done, §0.0                                                                                         |
| LIVE_DATA §3 LD4                                               | §2                                                                                                 |
