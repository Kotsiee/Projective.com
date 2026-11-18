# Live Data Build Prompts — closing PRODUCTION_READINESS §B

> **Status: WORK ORDERS, not binding.** Claude Code prompts that take
> [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) §B (Live data paths & feature flags, 36% at
> 2026-11-18) to 100%. Written 2026-11-18 against `main` @ `b7280787`. All five open rows were
> re-checked in code that day and are still open.
>
> **One principle runs through the section:** _a person never sees fixture data without being told,
> and production never sees it at all._ PRD-B1 breaks it while a live gate is on, and PRD-B5 breaks
> it while a gate is off. PRD-B3 and PRD-B4 are about whether the flags tell the truth about which
> road a request takes. The prompts below (LD1–LD4) close those four. PRD-B6 already has a work
> order (PM-WP4b).

---

## 0. Map, run order and stops

### 0.1 Row → work order

| Row    | Gate | Crit     | Work order                                    | The row flips to ✅ when                                                                                                 |
| :----- | :--- | :------- | :-------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| PRD-B1 | MVP  | Critical | **LD1**                                       | With `PROJECTS_BACKEND_LIVE` on, a failed read is a 503 and a tokenless one a 401; no fixture is ever `ok`               |
| PRD-B3 | UAT  | High     | **LD2**                                       | Every money write refuses (503) with `FINANCE_BACKEND_LIVE` off; code, `.env.example` and SA say the same thing          |
| PRD-B4 | UAT  | Normal   | **LD3**                                       | `USE_MOCKS` makes no database call; the registry matches the services (pinned by a test); no dead flag; no stale counts  |
| PRD-B5 | PROD | Normal   | **LD4** (after LD3)                           | In production, every gated-off surface refuses instead of serving fixtures, and boot reports each domain's road          |
| PRD-B6 | UAT  | Normal   | PM-WP4b ([PM_BUILD_PROMPTS.md][pm]) — blocked | PM-WP4b lands: a worked ticket archives (`tickets.archived_at`), and the refusal at `ProjectBackendService.ts:3229` goes |

[pm]: ../architecture/PM_BUILD_PROMPTS.md

**MVP:** LD1 is the first step on the tracker's MVP critical path. It fixes the only open MVP row in
§B. **UAT** also needs LD2, LD3 and PM-WP4b.

### 0.2 Run order

| Wave | Prompts           | Lane                                 | Why                                                                                                                                                         |
| :--- | :---------------- | :----------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **LD1** ∥ **LD2** | app (projects) ∥ app (finance)       | Disjoint files. LD1 is the MVP blocker. LD2 must not run beside a finance prompt that edits `wallet-actions.ts` (F·UI2/UI3, Identity MFA2's withdraw hook). |
| 2    | **LD3**           | app (`packages/backend/core`, mocks) | It touches `.env.example` and the SA env contract, which LD2 also edits. It makes the registry accurate, and LD4 reads the registry.                        |
| 3    | **LD4**           | app (core, community, boot)          | It builds the production rule on LD3's registry.                                                                                                            |
| —    | PM-WP4b           | SQL + app (PM track)                 | ⏳ F·DB3, F·DB6 (finance) and PM-WP4a. Run it in the PM track's order, not here.                                                                            |

**§B score projection** (weights: Critical 3 · High 2 · Normal 1; total 11):

| After   | Score | Rows that flip |
| :------ | ----: | :------------- |
| Today   |   36% | —              |
| LD1     |   64% | B1             |
| LD2     |   82% | B3             |
| LD3     |   86% | B4             |
| LD4     |   91% | B5             |
| PM-WP4b |  100% | B6             |

### 0.3 Human stops on this path

None are expected. Each prompt restores a contract the source docs already state. A prompt stops
only if it finds a decision row that rules the other way. Those cases are named inside LD2 and LD3.
LD3 has one architect default to confirm or override before it runs: **retire the dead
`PROFILE_BACKEND_LIVE` flag** (recommended) rather than wire it.

---

## 1. Headers

Paste [SECURITY_ACCESS_BUILD_PROMPTS.md](SECURITY_ACCESS_BUILD_PROMPTS.md) §1.1 above every LD
prompt, and §1.2 after it, with the rows named under each prompt below.

---

## 2. Existing work order — PM-WP4b (PRD-B6)

PM-WP4b is in [PM_BUILD_PROMPTS.md][pm] ("Removal and deletion follow the work; nothing with history
is destroyed"). Paste that file's own header, then the prompt, then §1.2 with **PRD-B6**.

Delta at `b7280787`:

- The TypeScript precursor is in (`8a3fd595`, #409 (F)): Delete is offered only on a pristine
  ticket. The archive itself is not built: `projects.tickets` has no `archived_at` yet (`00000015`).
- It is still blocked on F·DB3 and F·DB6 (no `dispute_open` refusal in the release doors) and on
  PM-WP4a. `MONEY_BUILD_PROMPTS.md` tracks the finance half.
- Closing it also moves USER_FLOWS PJ-34 ("Delete or archive a ticket").

---

## 3. New prompts

### LD1 — A live gate never serves fixtures

Closes PRD-B1.

```text
PROMPT LD1: With PROJECTS_BACKEND_LIVE on, a read answers from the database or fails — never with
fixtures

ROLE: Backend engineer (projects). App lane. Not beside another prompt that edits
ProjectBackendService.ts (check PM_BUILD_PROMPTS.md §0 for what is in flight).

CONTEXT (verified at b7280787; re-check every line):
  - liveRead (packages/backend/services/projects/ProjectBackendService.ts:525-544) returns
    `undefined` — "use the fixtures" — in three cases it does not tell apart: the flag is off; the
    flag is on but the caller has no token (`!actor || !canReadLive(actor)`); and the flag is on
    but the query threw (`catch → liveFailed → undefined`). About 11 read methods fall through to
    fixtures on `undefined` (the `if (live !== undefined)` sites at :1163-1814).
  - ProjectBackendService.list (:1076-1092) does the same inline: with the flag on, a tokenless
    caller gets the fixture feed, and so does any failed live read in the catch, as `ok`.
  - Result: on a live deployment, a database hiccup or an expired session shows a person someone
    else's invented projects as if they were theirs. PRD-B1 is Critical and gates the MVP; USER_FLOWS
    marks PJ-01–PJ-42 on it.
  - The pattern to copy is MessagingBackendService: with its flag on, a tokenless caller gets
    sessionRequired() and a failed query a 502/503, never a fixture (:210-211, :292-302).

STEPS:
  1. Red: a table-driven unit test over every public read method of ProjectBackendService (list,
     detail, board, members, files, timeline, … — enumerate them, don't guess), with the flag on and
     (a) an actor with no token and (b) a client that throws. Assert !ok with 401 for (a) and 503
     for (b), and that no fixture builder is called. It fails today.
  2. Make liveRead three-valued: `{ road: "off" }` only when the flag is off (the fixture branch
     may run); a 401 refusal when the flag is on and the actor cannot read live; a 503 refusal when
     the live query threw (keep liveFailed's log line). `null` keeps meaning a real 404. Update
     every caller; the fixture branch is reachable only from "off".
  3. list: the same three roads. Keep withResolvableScope for the fixture road only.
  4. Writes: check every write method for the same fall-through (a live failure answering a stub
     success, putTicketCard on the live path, …) and close it the same way.
  5. Sweep the other services for the pattern "flag on, but answer fixtures": grep
     packages/backend/services for catch blocks and early returns that build from fixtures, seeds or
     `*-fixtures.ts` while their domain gate is on (explore, catalogue, editorial, files, scheduling,
     saved, workspace, community). Fix each one the same way, or list it in your report as a new
     PRODUCTION_READINESS §B row if it is too large for this change.
  6. Check how the projects islands take a 401 and a 503 (apiFetch; #374 covers background
     requests): the lane and the board must show their error or empty state, not a blank screen
     or a login bounce on a background refetch. Capture 1440 and 390 px of the lane with the
     database stopped.

ACCEPTANCE: the step-1 test is green; with `deno task dev` and the flag on, stopping the database
(or pointing SUPABASE_URL at a dead port) gives the lane its error state, never fixture projects;
a signed-out request to /api/projects/list → 401; a normal session still sees its own live
projects; check, lint and test:unit green.
SAME CHANGE: SYSTEM_ARCHITECTURE.md where it describes the projects read path or the fixture
fallback; USER_FLOWS.md (the PRD-B1 line, and each PJ row whose status it moved).
```

§1.2 rows: **PRD-B1**, and USER_FLOWS' "Fixtures served under a live gate" line.

### LD2 — `FINANCE_BACKEND_LIVE` is the money kill switch it claims to be

Closes PRD-B3.

```text
PROMPT LD2: Every money write honours FINANCE_BACKEND_LIVE; one chokepoint, one contract

ROLE: Backend engineer (finance). App lane. Not beside a finance prompt that edits
services/finance/wallet-actions.ts or the wallet dialogs (F·UI2/UI3; Identity MFA2's withdraw
hook) — check FINANCE_BUILD_PROMPTS.md §0 and MONEY_BUILD_PROMPTS.md first.

CONTEXT (verified at b7280787):
  - .env.example (the FINANCE_BACKEND_LIVE block, ~:420-424) says the flag gates "the /wallet write
    path (top-up · withdraw · transfer · distribute · fund-escrow · recurring · payout) AND the
    Stripe fiat rails". SYSTEM_ARCHITECTURE.md's call order for every user-initiated money call
    (~:3531) starts with the same gate (off → 503).
  - The Stripe rails honour it (PaymentBackendService, DisputeBackendService, DevVerification).
    The internal moves do not: wallet-actions.ts transfer, distribute and fundEscrow (:361-465), and
    the pots, payout schedule and spend decisions, call their finance RPCs whatever the flag says.
  - Commit 96944081 ("Remove mocks") removed the wallet's fixture world, so wallet READS are now
    always live (the WalletBackendService docblock: "never a sample wallet"). SA ~:1405-1412 still
    describes a "Stub-first … in-module session store" behind the flag. That paragraph is stale.
  - Local .env has FINANCE_BACKEND_LIVE=true, so local development keeps working.
  - Grep the decisions README for wallet, "FINANCE_BACKEND_LIVE" and "internal move". If a row rules
    that internal moves are always live, stop and ask me.

STEPS:
  1. Red: a unit test over every money-moving export of wallet-actions.ts and every other finance
     service method that changes a balance, a hold, a pot, a rule or a payout schedule (enumerate
     them by grepping for finance RPC writes), with the flag off: each refuses 503 before any RPC.
     It fails today for the internal moves.
  2. One chokepoint, e.g. `moneyWritesLive()` / `refuseUnlessMoneyLive()` in services/finance, used
     by every write in step 1 (and by the existing Stripe-rail checks, so there is one wording). It
     runs AFTER the signed-in check and BEFORE any RPC, in the order SA's call-order line gives.
  3. Reads stay live with the flag off (a person can still see their real wallet). Say so in one
     sentence in the contract.
  4. A gate test that fails if a new finance write method calls an RPC without the chokepoint
     (static: every `.rpc("…")` on a finance write door inside services/finance is reached through
     it, or is on an allowlist with a reason, such as the webhook's service-role doors, which are
     signature-verified rather than flag-gated).
  5. Docs: rewrite SA's stale stub-first paragraph to the truth (reads always live; every
     user-initiated money write behind the flag; Stripe also needs its keys), and make .env.example's
     comment list exactly what the flag gates.

ACCEPTANCE: with FINANCE_BACKEND_LIVE=false, transfer, distribute, fund-escrow, pots, payout
schedule and spend decisions each answer 503 from their routes, and the database shows no new
ledger row (check finance.ledger_entries before and after); with it true, each still works as a
seeded persona; the wallet still renders live with the flag off; unit and gate tests green.
SAME CHANGE: SYSTEM_ARCHITECTURE.md (the finance flag paragraph + the env contract row),
.env.example.
```

§1.2 rows: **PRD-B3**.

### LD3 — The flags tell the truth

Closes PRD-B4.

```text
PROMPT LD3: USE_MOCKS reaches no database, the registry matches the services, and no flag is dead

ROLE: Backend platform engineer. App lane: packages/backend/core, packages/backend/mocks,
.env.example. ⏳ LD2 (both edit .env.example and the SA env contract).

ARCHITECT DEFAULT (confirm or override before you start): retire PROFILE_BACKEND_LIVE rather than
wire it. The profile service already reads live with no gate, and a fixture road nobody runs is
cost with no use.

CONTEXT (verified at b7280787):
  - env.ts (~:64-83) says USE_MOCKS "forces every domain to its fixture path". It does not. Services
    with database calls and no gate ignore it: scheduling (17 files with .from/.rpc, none gated,
    though the registry says PROJECTS_BACKEND_LIVE), profile, context, media, ops, quotes, and
    parts of workspace and user. SA ~:1433 already shows the honest pattern for one domain: under
    dev:mock, `saved` answers 503 and the client rolls back.
  - PROFILE_BACKEND_LIVE has no consumer: isProfileBackendLive (core/supabase.ts:86) is called
    nowhere, and the profile service reads the DB without it. Local .env sets it true, and that
    changes nothing.
  - mocks/registry.ts:21 and core/data-source.ts:28 both say "seventeen of the twenty fat services
    contain zero Supabase calls". The registry's own entries now mark only `profile` and `shell` as
    liveImplemented: false, so the prose is stale. The registry also omits most service directories
    (booking, comms, context, legal, media, ops, quotes, saved, search, sessions, user, workspace).
  - EXPLORE, CATALOGUE and FILES gate sub-features only (PRODUCTION_READINESS PRD-B4). Find exactly
    which parts of each domain each flag gates.

STEPS:
  1. Red: (a) a unit test that, with USE_MOCKS=true, the Supabase client factories (getUserClient,
     getServiceClient, getAnonClient in core/supabase.ts) cannot hand out a client; it fails today.
     (b) A contract test that lists packages/backend/services/*/ and fails for any directory with a
     database call that has no MOCK_REGISTRY entry, or whose entry's liveImplemented or gate
     disagrees with the code (a static scan for .from( / .rpc( and the is*BackendLive predicate it
     calls).
  2. USE_MOCKS means no database. The factories throw a typed MocksForced error under USE_MOCKS.
     Services with a fixture road never reach it. A service without one maps it to its own 503
     "isn't available in this environment" answer, as `saved` does. Grep the services' catch blocks
     so none turns this error into a fixture `ok` or a 500.
  3. The registry describes reality: one entry per service directory that touches the database,
     each with its gate (or `null` for always-live, with a one-line reason), liveImplemented, and
     which sub-features the gate covers (the EXPLORE / CATALOGUE / FILES scoping, written down).
     Delete the stale prose counts; describeDataSources computes them.
  4. Retire PROFILE_BACKEND_LIVE (per the default above): env.ts, core/supabase.ts, data-source.ts,
     the registry, .env.example, the SA env contract, and the Dev Context Switcher if it shows the
     flag (DevOverrides / DEV_DEFAULTS / DevOption / DevContextPanel / reflect() set and delete).
     If you were told to wire it instead, gate every profile DB read behind it, give it a fixture
     road, and test both.
  5. Correct env.ts's USE_MOCKS JSDoc and the SA paragraph on mocks, and make sure `deno task
     dev:mock`'s description says what it does now.
  6. Run `deno task dev:mock` and walk the app as a guest and as a stub persona. Every surface shows
     fixtures or its own unavailable state. No 500, no "permission denied", and no request to the
     Supabase port (check the server log, or stop the database first).

ACCEPTANCE: both step-1 tests green; dev:mock runs with the database stopped and every page
renders (capture the pages that now show their unavailable state); `deno task dev` unchanged with
the live flags on; check, lint and test:unit green.
SAME CHANGE: SYSTEM_ARCHITECTURE.md (env contract; the mock / data-source paragraph), .env.example,
the registry and data-source docblocks; the Dev Context Switcher, if step 4 touched a flag it
shows.
```

§1.2 rows: **PRD-B4**.

### LD4 — Production never serves fixtures

Closes PRD-B5.

```text
PROMPT LD4: In production, a gated-off surface refuses instead of serving fixtures

ROLE: Backend platform engineer. App lane. ⏳ LD3 (it uses LD3's registry).

CONTEXT (verified at b7280787):
  - Contact and Newsletter already refuse in production while their gate is off: 503 rather than
    acknowledging something nobody stores (ContactBackendService.ts:151 isProduction; :346, :407).
  - Community does not: with COMMUNITY_BACKEND_LIVE off, community-source.ts serves demo
    helpfulness votes and feedback ideas from `<surface>-fixtures.ts` and stores nothing, even in
    production. A visitor's vote "works" and vanishes.
  - "Production" is DENO_ENV=production, and an unset DENO_ENV counts as production
    (apps/web/utils/app-env.ts isProductionEnv; SA ~:2294). The backend has its own copies of this
    check (Contact's isProduction(deps)).
  - After LD3, MOCK_REGISTRY lists every domain, its gate and whether it has a fixture road.

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

§1.2 rows: **PRD-B5**.
