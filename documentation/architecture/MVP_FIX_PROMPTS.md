# MVP Fix Prompts — Claude Code Work Orders

> **Status: WORK ORDERS, not binding.** A Claude Code prompt for every item in
> [`MVP_FLOW_AUDIT.md`](MVP_FLOW_AUDIT.md) that is **Stubbed / Broken**, **Missing**, **Backend only**,
> or **Wired with caveats**. Paste each one into its own fresh Claude Code session. Each prompt names
> the files and context it needs, so it doesn't depend on this session.
>
> **Before you start:** merge the branch that adds `MVP_FLOW_AUDIT.md`, since every prompt cites it.
> Run the prompts in the order in §0. Prompts marked **🧑 DECISION** must stop and ask you before they
> change behaviour; they present options first.

---

## 0. Run order & dependencies

| Wave | Prompts | Why this order |
| :-- | :-- | :-- |
| **1 — Security** (do first, in any order) | S1, S2, S3 | These are holes that can be exploited today. |
| **2 — Money integrity** | M1 → M2 → M3, then M4, M5, M6 | Every later prompt moves money through these primitives. |
| **3 — Gates** | G1, G2 🧑, G3 | These rely on S1's revoke pattern. |
| **4 — Lifecycle truth** | L1 🧑, L2, L3 🧑, L4, L5, L6, L7 | Board and settlement correctness, built on wave 2. |
| **5 — Rails & ops** | R1, R2, R3, R4, R5 | Payout lifecycle, scheduler, cleanup. |
| **6 — Auth polish** | A1, A2, A3, A4, A5 | Each is independent. |
| **7 — Archetypes** | P1, P2 🧑, X1, X2, X3 | Pipelines, sessions and disputes, built on L-wave. |
| **8 — Post-MVP gaps** | C1–C3, F1–F4, T1–T3, H1–H4 | The roadmap items that are currently Absent or Partial. |
| **Last** | D1 | Docs hygiene, swept after the code has moved. |

---

## Standard header — paste above EVERY prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Preact islands,
packages/backend fat services, packages/types Zod SSOT, supabase/migrations Postgres + RLS).
Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch, then
     documentation/reference/guardrails.md and documentation/reference/pr-checklist.md.
  2. Read documentation/architecture/MVP_FLOW_AUDIT.md (the section cited below).
  3. Grep documentation/reference/decisions/README.md for the surface and read the decision files
     it names.
Hard rules (merge gates):
  - Migrations are consolidated and EDITED IN PLACE (supabase/migrations/vvvvtooo_type_purpose.sql).
    Never append ALTER TABLE ADD COLUMN or ALTER TYPE ADD VALUE patches. Put each statement in its
    category file (0 tables, 1 functions/triggers, 2 policies/grants, 3 views, 4 indexes, 5 seed).
  - A schema change lands together with its @projective/types Zod schema and
    documentation/database/<schema>/* in the same change. A lifecycle change also updates
    documentation/PRODUCT_MANAGEMENT.md. A business-rule change also updates PRODUCT_SPEC.md.
  - Never drop columns or FKs on escrows, wallets or stages without asking me.
  - Islands never touch Supabase; they fetch /api/* only. Routes stay thin; logic lives in
    @server/services/* and returns ServiceResult<T>.
  - Any new simulatable axis gets its Dev Context Switcher control (apps/web/features/devtools,
    apps/web/utils/dev-seam.ts).
  - If you find a NEW contradiction between source docs, do not pick a side: add a decision-log
    row (newest documentation/reference/decisions/decisions-*.md + index line) and ask me.
Verification: reproduce the defect first (SQL probe under supabase/probes/ or a Deno unit test),
then fix, then run `deno task db:reset` (if SQL changed), `deno task check`, `deno task lint`,
`deno task test:unit`, and `deno fmt` on the files you touched only. Four theme-engine.test.ts
failures are pre-existing. Commit on a new branch with a clear message; do not open a PR unless I ask.
```

---

## Wave 1 — Security

### S1 · Function privilege sweep: `public` + `projects` schemas (audit §0 P0 #1–#2, §2.1)

```text
TASK: Close the EXECUTE holes in the PostgREST-exposed schemas.

Context:
- supabase/config.toml:13 exposes public, org, security, projects, finance and more.
- Postgres grants EXECUTE to PUBLIC by default.
- supabase/migrations/00002510_permissions_function_grants.sql revokes the blanket for `org` (top of
  file) and `finance` (~line 784), but NOT for `public` or `projects`.
- Two confirmed exploits:
  (a) public.provision_user_profile(p_user_id, p_email, p_email_confirmed_at, p_meta) in
      00001010_functions_org_onboarding.sql:26 is SECURITY DEFINER, has no SET search_path, and is
      callable by anon. Anyone can provision a users_public row for any uid with any dob.
  (b) projects.claim_ticket(p_ticket_id, p_assignee_id) in
      00001120_functions_projects_ticket_lifecycle.sql:418 is SECURITY DEFINER and never checks
      auth.uid(), project access, or that the caller is the assignee. Any authenticated user can
      attach anyone to an open_pull ticket and trigger an escrow hold on the client's wallet.

Do:
1. In 00002510, mirror the org/finance pattern for `projects` and `public`:
   REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA … FROM PUBLIC, anon; plus ALTER DEFAULT PRIVILEGES …
   REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC. Grant service_role. Then re-GRANT to authenticated (and
   anon only where a public read needs it), BY NAME, for every function the app actually calls.
   Find them by grepping `.rpc("` / `.schema("projects").rpc(` in packages/backend and apps/web,
   plus every function used inside an RLS policy (00002011 and others). Do not break RLS predicates.
2. Do not leave Supabase-internal or extension functions in `public` unusable. Check what lives
   there (vector ops etc.) and keep their grants intact.
3. provision_user_profile: add SET search_path = public, org, pg_temp; REVOKE from PUBLIC, anon and
   authenticated. Only handle_new_user / complete_onboarding (definer) call it.
4. claim_ticket: require auth.uid() IS NOT NULL, projects.has_project_access(project of the ticket),
   and p_assignee_id = auth.uid() (a self-claim). Owner/manager assignment already has
   assign_ticket_manual. Raise with a stable SQLSTATE the app maps (follow the existing PFxxx /
   check_violation conventions).
5. Audit every SECURITY DEFINER function in the projects and public schemas for a missing
   `SET search_path` and add it. List them in the commit message.
6. Add supabase/probes/function_grants.sql. It asserts, via has_function_privilege, that anon cannot
   execute provision_user_profile or claim_ticket, and that authenticated cannot claim on behalf of
   another user.
7. Update documentation/database/projects/Functions.md, documentation/database/org/Functions.md and
   the SYSTEM_ARCHITECTURE.md security section (function-grant policy).
```

### S2 · Tracked `.env*` files with non-placeholder service-role keys (audit §0)

```text
TASK: Stop tracking environment files that hold secrets.

Context: `.env`, `.env.development` and `.env.production` are tracked in git. Their
SUPABASE_SERVICE_ROLE_KEY values are not the XXXX-XXXX placeholders root CLAUDE.md §6 requires.
.env.example is the template. DO NOT print, decode, echo or log any key value at any point.

Do:
1. Compare variable NAMES only (e.g. `cut -d= -f1`) across .env, .env.development, .env.production
   and .env.example. Make .env.example contain every name, with XXXX-XXXX placeholders.
2. `git rm --cached` the three real files and add them (and .env.local) to .gitignore. Leave the
   working-tree copies on disk.
3. Check SYSTEM_ARCHITECTURE.md "Environment Variable Contract" and the server env loader
   (packages/backend/core/env.ts, which loads .env.local then .env). Make sure nothing in CI, a
   script or `deno task` relies on the tracked files. Update docs to say .env.example is the only
   committed env file.
4. In your final message, tell me plainly: "If .env.production held a real hosted-project key, rotate
   it in the Supabase dashboard. It remains in git history." Do NOT rewrite git history.
```

### S3 · Account-existence oracle on `/api/auth/verification-status` (audit 1.3)

```text
TASK: Remove the email-enumeration oracle.

Context:
- apps/web/routes/api/auth/verification-status.ts → AuthBackendService (~:612-630) is
  unauthenticated, does a service-role read, and answers {verified: true|false} for any email.
- resend and forgot-password deliberately avoid enumeration.
- VerifyForm.island.tsx (~:112) polls it.
- The route JSDoc wrongly says the poll "auto-logs the user in".

Do:
1. Bind the poll to the verifying browser. At join, issue a short-lived, HttpOnly, signed
   "pending verification" cookie (or reuse the join response's opaque token) carrying the pending
   user id. verification-status only answers for that id. With no cookie it returns a uniform
   response.
2. Rate-limit it with packages/backend/core/rate-limit.ts.
3. If the poll sees the account confirmed and this tab has no session, show a clear "Email
   confirmed — sign in" state instead of navigating into a /login bounce. Fix the JSDoc.
4. Unit tests for: an unknown email, a mismatched cookie, the rate limit, and the success path.
```

---

## Wave 2 — Money integrity

### M1 · Escrow release & fair-exit double-pay race (audit §0 P0 #3, §2.4)

```text
TASK: Make escrow release idempotent under concurrency.

Context: finance.fn_release_ticket_escrow (supabase/migrations/00001200_functions_finance_core.sql
~:589-625) loops `SELECT * FROM finance.escrows WHERE ticket_id = … AND status = 'held'` with no row
lock, then `UPDATE finance.escrows SET status='released' … WHERE id = r.id` without re-checking
status. Two concurrent projects.approve_stage calls (00001150:913) under READ COMMITTED can both
credit the payee via fn_wallet_credit or fn_split_team_payout. finance.fn_fair_exit_release (~:770)
and projects.cancel_stage_fair_exit (00001150:717) have the same shape.

Do:
1. In both release functions, lock the rows (`FOR UPDATE` in the loop query) and make the state
   flip guarded: UPDATE … SET status='released' … WHERE id = r.id AND status='held' RETURNING id.
   Skip crediting when no row comes back.
2. In approve_stage and cancel_stage_fair_exit, lock the stage row (FOR UPDATE) first, and refuse
   unless the stage is in a state that can be approved/cancelled per
   documentation/PRODUCT_MANAGEMENT.md (find the stage status enum). Today any stage with held
   escrow can be approved.
3. Write supabase/probes/escrow_release_concurrency.sql. Use two dblink connections or a scripted
   pair of transactions to show a double credit before the fix and a single credit after.
   Alternatively, extend scripts/stripe-smoke.ts's rolled-back ledger half.
4. Update documentation/database/finance/Functions.md and projects/Functions.md.
```

### M2 · Escrow hold uniqueness & `fund_stage` locking (audit §0 P0 #4, §2.4)

```text
TASK: Make it impossible to hold escrow twice for one ticket.

Context: there is no partial unique index on finance.escrows(ticket_id) WHERE status='held'
(00004005_indexes_finance.sql:9 is non-unique). finance.fn_hold_ticket_escrow
(00001200:322, checks ~:377 then inserts ~:423) is check-then-insert. projects.fund_stage
(00001150:509) does not lock the ticket rows; projects.fund_ticket (~:654) does. Revision escrow
(fn_hold_revision_escrow) may legitimately coexist with a ticket's base escrow. Check the escrow
"kind"/revision columns in 00000017_tables_finance.sql and scope the index accordingly.

Do:
1. Add a partial UNIQUE index in 00004005 covering exactly one held BASE escrow per ticket. It must
   not collide with revision rounds or session seats; use the discriminating column(s).
2. In fn_hold_ticket_escrow, catch unique_violation and treat it as "already held" (return the
   existing id). In fund_stage, SELECT the candidate tickets FOR UPDATE, ordered by id to avoid
   deadlocks.
3. Run `deno task db:reset` to prove seeds don't violate the index. Add a probe that races two
   fund_stage calls.
4. Update documentation/database/finance/{Tables,Functions}.md.
```

### M3 · Ledger immutability, loud failures, reconciliation (audit 3.3, §2.5)

```text
TASK: Make finance.transactions a true append-only ledger and detect balance drift.

Context:
- finance.wallets.balance_cents is mutated beside finance.transactions by fn_wallet_credit /
  fn_wallet_debit (00001200:7-45).
- Append-only is enforced only by grants. service_role has GRANT ALL (00002520:610), and
  transactions.wallet_id is ON DELETE CASCADE (00000017:42).
- fn_wallet_credit/debit silently RETURN when the wallet row is missing. finance.settle_card_payment
  (00001230:529) then still marks the payment succeeded with a NULL transaction_id, so the money
  vanishes.
- There is no reconciliation job.

Do:
1. Add a BEFORE UPDATE OR DELETE trigger on finance.transactions that raises unconditionally (put
   it in 00001830_triggers_finance.sql). Check first that no existing function UPDATEs transactions
   (grep), and refactor any that does into a compensating insert.
2. Change transactions.wallet_id to ON DELETE RESTRICT, editing 00000017 in place. Wallets are
   never hard-deleted.
3. fn_wallet_credit / fn_wallet_debit: RAISE (stable SQLSTATE) instead of RETURN when the wallet
   is missing. Fix callers that relied on the silent path; ensure fn_ensure_wallet runs first where
   needed.
4. Add finance.fn_reconcile_wallets() (SECURITY DEFINER, service_role only). It compares
   balance_cents with the latest balance_after_cents and with SUM(signed amount) per wallet, writes
   mismatches to an ops table (reuse an existing ops log/alert table if there is one; else add one
   in 00000013 with docs), and returns the count. Schedule it nightly using the scheduler from R2
   (if R2 hasn't landed, add the guarded cron.schedule block like 00001250:753).
5. Probes for: UPDATE blocked, DELETE blocked, credit-to-missing-wallet raises, and reconciliation
   flags an injected drift (inside a rolled-back transaction).
6. Docs: documentation/database/finance/*, SYSTEM_ARCHITECTURE.md ledger section.
```

### M4 · Pending-release window (7-day) & withdrawable balance (audit §0 P0 #5)

```text
TASK: Enforce the pending window so fresh money can't be withdrawn immediately.

Context:
- finance.pending_releases (00000017:453) exists but is never inserted into.
- security.platform_params.pending_release_days = 7 is unused.
- Escrow releases (fn_release_ticket_escrow, 00001200:612), product sales (place_wallet_order,
  00001210, reason 'product_sale') and card top-ups (settle_card_payment) all credit AVAILABLE
  balance.
- finance.begin_payout (00001240:201) lets you withdraw all of it.
- Disputes recover at most LEAST(balance, amount) (00001240:137).
Read documentation/business/finance-model.md and PRODUCT_SPEC.md on pending/available first. If
they disagree about which credits are held (e.g. top-ups), STOP and ask me (§8).

Do:
1. Model pending money explicitly: a pending balance column, or derive it from pending_releases.
   Keep balance_cents semantics documented. Prefer the smallest change consistent with how
   live-wallet.ts and the wallet UI already present "pending".
2. Escrow-release, product-sale and (if confirmed) top-up credits create a pending_releases row
   keyed to their source (extend the table so it isn't escrow-only; edit 00000017 in place) with
   available_at = now() + pending_release_days.
3. Add finance.fn_mature_pending_releases(), a SKIP LOCKED batch that moves matured rows to
   available with ledger rows. Schedule it (R2, or a guarded cron block).
4. begin_payout and every wallet spend path (place_wallet_order, fund_stage, fund_ticket) must use
   available only. Decide with me whether spending pending funds inside the platform is allowed.
5. Disputes and chargebacks can claw back from pending first.
6. Update the wallet overview DTO (packages/backend/services/finance/live-wallet.ts) and the Zod
   types so the UI shows pending vs available honestly. Add tests and a probe.
```

### M5 · Platform fee single source of truth (audit 3.10)

```text
TASK: Make every fee calculation read the same effective rate and round the same way.

Context:
- Truth: security.platform_params.platform_fee_bp = 500 (00005001_seed_platform_params.sql:22),
  read via finance.fn_effective_platform_fee_bp (00001220:234), which honours negotiated rates.
- Duplicates:
  * finance.place_wallet_order hardcodes `c_fee_bp constant integer := 500` (00001210:925), and its
    header comment (~:902) wrongly says the param "is seeded 0".
  * finance preview_team_split reads the param directly and skips negotiated rates (00001210:1876).
  * PLATFORM_FEE_BP = 500 in packages/types/finance/checkout.ts:56, used by
    packages/backend/services/finance/live-wallet.ts:642 (round-half-up, while SQL truncates) and
    wallet-standing.ts:138.
  * packages/backend/services/projects/board-fixtures.ts:659 uses 0.05.

Do:
1. place_wallet_order: fee per seller = fn_effective_platform_fee_bp for the PAYER (match how
   escrow does it via fn_escrow_fee_bp). Fix the stale comment.
2. preview_team_split: use fn_effective_platform_fee_bp.
3. Use one rounding rule everywhere. SQL truncation is canonical; check finance-model.md, and if it
   says otherwise, STOP and ask.
4. TS: previews take the effective bp from the server DTO. Keep PLATFORM_FEE_BP only as a display
   fallback, with a unit test asserting it equals the seeded value; or remove it if nothing needs it.
5. Fixtures derive from the same constant. Tests for negotiated-rate and odd-cent rounding.
```

### M6 · Seat/application races, capacity at accept, invite double-booking (audit 2.9–2.11)

```text
TASK: Prevent double-filling a seat and double-booking a freelancer.

Context, in supabase/migrations/00001130_functions_projects_stages.sql:
- assign_from_application (~:1238) reads the application without FOR UPDATE (~:1263). The advisory
  lock is per candidate (~:1310), and the seat is set 'filled' without WHERE status='open'
  (~:1345). Two different candidates accepted for one seat can both win.
- Invitation acceptance (fn_apply_invitation_decision ~:1910, accept branch ~:2004-2017) has no
  advisory lock and no fn_assignee_slot_conflict check, unlike application acceptance (~:1323).
- projects.check_ticket_capacity (00001140:183) runs only at claim/assign, never at acceptance.
  Read PRODUCT_SPEC.md on Wᵢ capacity to decide whether acceptance should check it. If the spec
  only talks about concurrent tickets, apply the check at acceptance only if it already
  conceptually covers stage seats; otherwise ask me.
- Auto-rejected applicants (~:1339-1343) and withdrawals (withdraw_application ~:1113) send no
  notification.

Do:
1. Lock the seat row and application row FOR UPDATE. Make the seat transition conditional on
   status='open' with a row-count check, raising a stable "seat already filled" error.
2. Apply the same advisory lock and fn_assignee_slot_conflict in the invitation accept path.
3. Capacity at accept per the spec decision above.
4. Notify auto-rejected applicants (application.declined, reason 'seat_filled') and the owner on
   withdrawal. Add catalog rows in 00005010_seed_notification_catalog.sql if needed.
5. Probes for the two-candidate race and the overlapping-invite case. Update docs
   (projects/Functions.md, PRODUCT_MANAGEMENT.md if a transition changes).
```

---

## Wave 3 — Gates

### G1 · Age guardrails: under-13 in the DB, under-18 `restricted` enforcement (audit 1.10, 1.11, §2.6 d)

```text
TASK: Enforce PRODUCT_SPEC.md:2489-2501 age rules server-side.

Context:
- DOB is collected (apps/web/features/auth/components/StepForm.tsx:203) and checked only in
  AuthBackendService.provisionAccount (packages/backend/services/auth/AuthBackendService.ts:263),
  using packages/types/auth/age.ts (MIN_AGE=13, ADULT_AGE=18).
- It is stored as org.users_public.dob (00000011:38). There is no DB check.
- Bypasses: direct GoTrue signup (supabase/config.toml enable_signup=true) → handle_new_user, and
  public.complete_onboarding (granted to authenticated, 00002510:130).
- The under-18 `restricted` flag is computed client-side (wizardValidation.ts:136), stripped by
  Zod, and never persisted or enforced.
- The join Zod schema lives in apps/web/features/auth/core/schema.ts, not @projective/types.

Do:
1. In provision_user_profile / complete_onboarding (00001010), compute age from dob and RAISE for
   under 13 (stable SQLSTATE mapped to the existing join error). Also add a CHECK or trigger on
   users_public.dob for plausibility (not in the future, not before 1900).
2. Persist `is_restricted` as a GENERATED/derived value from dob (it changes on the 18th birthday,
   so prefer computing it in a function, e.g. org.fn_is_minor(uid), over a stored flag). Expose it
   in public.custom_access_token_hook (00001700) inside app_metadata.active_context.
3. Block minors from: enable_freelancer_profile (become-partner), apply_to_project,
   claim_ticket/assignment, catalogue listing publish, place_wallet_order / begin_card_payment /
   fund_* (buying), and begin_payout. Use one helper and one SQLSTATE. Mirror it in the API layer
   for clean 403 copy.
4. Move the join schema into @projective/types/auth (Zod SSOT) and keep the app importing it.
5. Add the "restricted (minor)" axis to the Dev Context Switcher: DevOverrides + DEV_DEFAULTS,
   DevOption, DevContextPanel control, reflect() set AND delete
   (apps/web/features/devtools, apps/web/utils/dev-seam.ts).
6. Probes: direct complete_onboarding with a 12-year-old dob fails; a 16-year-old cannot
   become-partner or check out. Update PRODUCT_SPEC (only if wording needs to match),
   documentation/database/org/*, and SYSTEM_ARCHITECTURE auth section.
```

### G2 · 🧑 DECISION — Payout-ready gate at earning time (audit 3.7, §0 P0 #7, §2.6 c)

```text
TASK: Wire finance.fn_freelancer_payout_ready into the "land a gig" paths, after I decide the exact
rule.

Context:
- PRODUCT_SPEC.md:1233-1237 says a freelancer cannot land a gig until KYC and a payout account are
  both in place.
- finance.fn_freelancer_payout_ready (00001210_functions_finance_kyc_wallet.sql:16) has exactly one
  caller, finance.begin_payout (00001240:270). The comment at 00001210:9-13 says wiring it into
  earning is pending human sign-off.
- At withdrawal, wallets with owner_type 'user' or 'team' skip KYC/KYB and need only a verified
  payout account (00001240:270-277).

STEP 1 — STOP AND ASK ME, presenting these options with trade-offs:
  (A) Gate at claim, assignment and application acceptance (strict; matches the spec).
  (B) Gate at application/invite acceptance only; claim is implied.
  (C) Allow work, but hold released escrow in pending until ready (soft gate).
  Also ask: should team payees require every member to be ready, or only the team's payout account?
  And should the user/team withdrawal path require KYC?
STEP 2 — after my answer: implement in SQL (one helper, stable SQLSTATE, e.g. 'PK403
payout_not_ready'). Map it in the API to a CTA linking to /settings/verification. Add a Dev Context
Switcher toggle for "payout-ready" if one doesn't exist. Add the decision-log row (newest
decisions-*.md + README index). Update PRODUCT_SPEC/PRODUCT_MANAGEMENT. Add probes.
```

### G3 · Become-partner & context switch: server-side re-mint (audit 1.8, 1.16, 1.17)

```text
TASK: Make persona and context changes re-issue the session server-side, and stop transient
refresh failures from signing users out.

Context:
- apps/web/routes/api/auth/refresh.ts:18-25 clears both cookies on ANY failure.
- apps/web/features/profile/core/partner-service.ts:89 and
  apps/web/features/workspaces/core/useContextSwitch.ts:109,160 call it immediately after a
  successful mutation, so a transient GoTrue error logs the user out.
- POST /api/context/switch (ContextBackendService.switchContext) and POST /api/user/freelancer
  (UserBackendService.enableFreelancer) do not refresh claims themselves. Any caller other than
  those two clients leaves the custom_access_token_hook claims stale.
- renewSession in apps/web/utils/session.ts:110-124 already shows the "keep session on failure"
  pattern.

Do:
1. In both mutation routes, refresh the session server-side after success and return the
   Set-Cookie headers via the existing auth-cookies helpers. If refresh fails, keep the old cookies
   and return a `claimsStale: true` flag.
2. /api/auth/refresh: clear cookies only on a definitive invalid_grant / refresh-token-revoked
   response; on network or 5xx errors keep them and return 503.
3. Simplify partner-service.ts and useContextSwitch.ts to rely on the server re-mint (keep the hard
   navigation).
4. Unit tests for the three failure modes.
```

---

## Wave 4 — Lifecycle truth

### L1 · 🧑 DECISION — Stage funding model (audit 2.3, 2.4, §2.2)

```text
TASK: Make "fund the whole stage" actually reachable, by card and by wallet, for individuals and
businesses.

Context:
- projects.fund_stage (00001150:509, ticket select ~:583-588) funds only tickets that are assigned
  AND unfunded. That state is nearly unreachable:
  * The AFTER trigger fn_ticket_escrow_sync (00001110:121-154) holds escrow the moment an assignee
    is set, or aborts.
  * A failed claim rolls the assignee back to NULL (00001140:383-392).
  * Neither invite nor application acceptance sets ticket assignees, and create_stage creates no
    tickets.
- A solo freelancer's unfunded ticket is `needs_funding` with no assignee, and fund_ticket refuses
  "Nobody can be paid … yet" (~:680). The prepayment store noted at ~:624 does not exist.
- packages/backend/services/finance/wallet-actions.ts:327 refuses non-business wallets, though
  fund_stage supports individual owners (~:539).
- POST /api/finance/escrow/intent (card stage funding → begin_card_payment → webhook →
  settle_card_payment → fund_stage, 00001230:622) has no UI caller.
- begin_card_payment skips unpriced tickets (00001230:307), but fund_stage raises no_price on them.
  The card money lands in the wallet and is never locked.

STEP 1 — first confirm the defect live: db:reset, then try the business-wallet "Lock stage" flow in
`deno task dev`. Then STOP AND ASK ME to choose:
  (A) Prepaid unassigned escrow: hold per PRICED ticket with payee NULL; bind the payee at
      claim/assign (needs nullable payee + a bind step in fn_ticket_escrow_sync).
  (B) Stage-level escrow pool: one escrow per stage, drawn down per ticket at claim.
  (C) Assign-at-accept: application/invite acceptance assigns the stage's tickets and holds in the
      same transaction.
  Present the schema impact of each on finance.escrows (escrows: do not drop columns/FKs without
  permission) and the PRODUCT_SPEC.md:54 "lock at In Progress" wording (audit §2.6 a).
STEP 2 — after my answer: implement it. Allow individual wallets in wallet-actions.ts. Make
begin_card_payment and fund_stage agree on the priced set (refuse the intent up front if any ticket
is unpriced). Build the card stage-funding UI using the existing Payment Element pattern
(apps/web/features/wallet/components/WalletDialogs.tsx StripeElementPanel, useStripeElement.ts),
calling /api/finance/escrow/intent. Log the decision row, update PRODUCT_SPEC, PRODUCT_MANAGEMENT
and database docs, the DESIGN_SYSTEM roster if a component is added, and the conversion-lane gate
(UI gate 10) on project routes. Add probes and tests.
```

### L2 · Project creation: price/currency, atomicity, invitee, slug (audit 2.1)

```text
TASK: Make the Quick-Init modal create a fully specified draft atomically.

Context:
- apps/web/features/projects/…/ProjectCreateModal.tsx always sends baselineAmountCents: null
  (~:331) and deliberately has no price or currency field (~:51-55). The
  ProjectBackendService.create docblock (packages/backend/services/projects/ProjectBackendService.ts
  ~:3238) claims a currency selector exists.
- insertProject (live-writes.ts:1930) inserts the project via the RLS client, then calls
  projects.create_stage. If the stage fails it only warns (~:2007-2013), leaving a stageless project.
- The modal navigates by res.data.slug (~:354), though the service says to use id because slugs
  change on the first rename.
- When opened from a profile, the modal shows the invitee but never sends or invites them.

Do:
1. Add optional currency (default: the user's preferred_display_currency, if it is a wallet
   currency) and an optional baseline price to the modal, using @projective/ui fields only, tokens
   only, BEM. Check DESIGN_SYSTEM.md Part E. Extend the Zod create schema in
   packages/types/projects/create.ts.
2. Make creation atomic: either call one SQL function (projects.create_project, if it fits; read why
   live-writes.ts:1898-1906 avoided it) that creates the project, root stage and room in one
   transaction, or compensate by archiving (never hard-deleting) the project on failure. Prefer the
   single RPC.
3. Navigate by the opaque prefixed route slug the router resolves (Decision #88: prj-…); confirm
   against ROUTING.md which value is stable.
4. Pass the invitee through and call the same invite_to_project path the hire flow uses, after
   creation.
5. Fix the docblock. Add tests.
```

### L3 · 🧑 DECISION — Approval truth: complete tickets, accept vs approve (audit 2.16, §2.6 b)

```text
TASK: Make approval leave the board and payment state consistent.

Context:
- projects.approve_stage (00001150:913) releases held escrows via fn_release_ticket_escrow
  (00001200:589). It never sets tickets to completed, so payment_status becomes
  'partially_released' (~:617-621) and the cards stay in Review after the stage is 'paid'.
- v_paid sums every released escrow on the stage, including earlier releases.
- The stage_approved notification goes only to ticket assignees, not team-split recipients or the
  client.
- projects.review_submission(accept) (~:258-301) marks only the submission accepted and releases
  nothing. PRODUCT_SPEC.md:57 and PRODUCT_MANAGEMENT.md:442 say "Approve → Released".

STEP 1 — STOP AND ASK ME: should "accept submission" (A) release that ticket's escrow immediately,
or (B) remain a non-financial acknowledgement, with the UI relabelled so only "Approve stage & pay"
moves money?
STEP 2 — implement:
- approve_stage moves each released ticket to 'completed' (through the guarded path, so the ticket
  guards and ledger triggers fire) before computing payment_status, so it becomes 'released'.
- Compute v_paid from THIS call's releases only.
- Notify the client and every split recipient (fn_split_team_payout knows them).
- Implement option A or B, including UI copy in SubmissionExplorer.island.tsx and
  ProjectBoard.island.tsx.
- Log the decision; update PRODUCT_MANAGEMENT.md and PRODUCT_SPEC.md wording. Probe: approve, then
  every ticket is completed/released and the wallet is credited once.
(Depends on M1 having landed.)
```

### L4 · Submissions: draft-send path & assignee check (audit 2.13)

```text
TASK: Route every submission through the one correct door.

Context:
- projects.submit_deliverable (00001150:84) inserts the submission, attaches files, resolves open
  revision rounds, sets revision_of, and moves the ticket to in_review.
- Sending an existing DRAFT (packages/backend/services/projects/live-writes.ts ~:2830-2857) is a
  bare UPDATE status='pending_review'. The ticket does not move, revision rounds stay open,
  revision_of is unset, and submission_files insert errors are ignored (~:2854, ~:2890).
- submit_deliverable checks only has_project_access (~:113), not that the caller is the ticket's
  assignee (or a member of the assignee team), nor that the ticket belongs to p_stage_id.
- Unknown file ids are silently skipped (~:146-154).

Do:
1. Add projects.send_submission_draft(p_submission_id) (or extend submit_deliverable to promote a
   draft) that performs the same transitions atomically. Call it from live-writes.ts.
2. Enforce caller = assignee (or a team member of the assignee team) and ticket ∈ stage. Raise on
   unknown or foreign file ids instead of skipping.
3. Surface file-attach errors to the ServiceResult.
4. Tests and probe. Update projects/Functions.md.
```

### L5 · Freelancer self-claim UI (audit 2.12)

```text
TASK: Give freelancers a real "Claim" action on open_pull tickets.

Context:
- Dragging a ticket to 'claimed' via projects.move_ticket (00001120:326) sets no assignee, so the
  escrow-sync trigger always raises PF402.
- The real claim is projects.claim_ticket → fn_assign_ticket_core (capacity + escrow hold). No app
  code calls it.
- S1 makes claim_ticket a caller-checked self-claim. Confirm S1 has landed first.
- Board: apps/web/features/projects/…/ProjectBoard.island.tsx (startWork ~:525, commitMove ~:585),
  BoardService.ts, api/projects/ticket/move.ts.

Do:
1. Add POST /api/projects/ticket/claim (thin route + Zod) → ProjectBackendService.claimTicket →
   claim_ticket RPC in the user's JWT.
2. In the board, show a "Claim" control on open_pull tickets the viewer can claim. Turn a drag into
   the Claimed column into the claim call instead of move_ticket, and map capacity, needs-funding
   and payout-not-ready errors to clear copy. Follow UI gate 11 (a control that renders must do
   something) and gate 12 (press feedback).
3. Update the DESIGN_SYSTEM §C.1 roster if a component changes. Add tests.
```

### L6 · Fair Exit cancellation UI (audit 2.20)

```text
TASK: Wire the existing Fair Exit backend into the UI.

Context:
- POST /api/projects/[id]/stages/[stageId]/cancel.ts → cancelStageFairExit →
  projects.cancel_stage_fair_exit (00001150:717) → finance.fn_fair_exit_release (00001200:770).
  25/50/75 tiers; fee only on the earned share; remainder refunded as 'fair_exit_refund'; reviewer
  only.
- apps/web/features/projects/core/SettlementService.ts:75 exists but has no island caller.
- Ticket statuses are left unchanged after the exit.

Do:
1. Add a reviewer-only "End stage (Fair Exit)" action in the stage settlement surface
   (SubmissionExplorer or the stage header; check DESIGN_SYSTEM conversion-lane rules for where
   money actions may live). Include a confirm dialog showing tier → payout/refund preview,
   computed server-side (add a preview endpoint/RPC if needed; no money math in the island).
2. After an exit, move remaining tickets to a terminal state per PRODUCT_MANAGEMENT.md (add it
   there if missing; no bespoke statuses).
3. Notify both sides. Tests. Depends on M1.
```

### L7 · Paid revision: direct-to-escrow option (audit 2.15)

```text
TASK: Let a client fund an extra revision round directly, not only via the basket.

Context:
- Past the allotment, review_submission raises PR402 paid_revision_required. The client then goes
  request_paid_revision → Buy Now basket line 'paid_revision' → place_wallet_order →
  fund_paid_revision → fn_hold_revision_escrow (00001150:367,434).
- There is no direct endpoint.
- The test packages/backend/services/finance/revision-purchase.test.ts imports from live-basket.ts;
  there is no revision-purchase.ts.
Read PRODUCT_SPEC.md:1748-1767 first. If the spec says basket-only, STOP and tell me rather than
build this.

Do:
1. Add POST …/submissions/[submissionId]/paid-revision/fund that funds from the payer's wallet
   (available balance, after M4) or starts a card intent via begin_card_payment, ending in
   fund_paid_revision.
2. SubmissionExplorer: offer "Pay from wallet" / "Pay by card" alongside "Add to basket".
3. Rename the test to match its subject, or extract revision purchase into revision-purchase.ts.
   Add tests.
```

---

## Wave 5 — Rails & ops

### R1 · Payout lifecycle: webhooks, stuck payouts, destination, minimum (audit 3.8)

```text
TASK: Complete the withdrawal lifecycle after the Stripe Transfer.

Context:
- Withdraw: PaymentBackendService.withdraw (packages/backend/services/finance/PaymentBackendService.ts
  ~:727) → finance.begin_payout (00001240:201; wallet FOR UPDATE, debit first) → stripe-rails.ts
  createTransfer (~:384, idempotency payout_transfer:<id>) → complete_payout (~:314) or fail_payout
  (~:363, credits payout_reversal).
- Only transfer.created is handled (packages/types/finance/payments.ts:551-565).
- transfer.reversed, and connected-account payout.failed / payout.paid, are not handled. The
  payout.failed notification type is seeded (00005010:13) but never sent.
- A transient error returns 202 (~:761) and leaves the payout pending and debited. Nothing sweeps it.
- destinationId is accepted by the schema and sent by WalletDialogs.tsx:320, but dropped in
  wallet-actions.ts:189-195.
- There is no minimum withdrawal.
Use the stripe:stripe-best-practices skill for Connect event semantics (payout.* events arrive as
Connect events on the connected account).

Do:
1. Handle transfer.reversed (→ fail/reverse with a payout_reversal credit, idempotent) and
   payout.failed / payout.paid from connected accounts (status column + notification). Extend the
   Zod event union and planStripeEvent/applyStripePlan (stripe-webhook.ts) with tests.
2. Add finance.fn_claim_stale_payouts() plus a service sweep that, for pending payouts older than N
   minutes, retrieves the Transfer by idempotency key or metadata and either completes or fails
   them. Schedule it via R2.
3. Honour destinationId: pass it to begin_payout and validate that it belongs to the caller and is
   verified.
4. Add a min_withdrawal_minor param (seed in 00005001, per currency if needed) enforced in
   begin_payout, with docs in finance-model.md.
5. Extend scripts/stripe-smoke.ts.
```

### R2 · One scheduler for pg_cron jobs and HTTP cron routes (audit 3.9, §2.5)

```text
TASK: Make scheduled work actually run in every environment.

Context:
- pg_cron jobs exist, each wrapped in a guard that silently does nothing when pg_cron is absent
  (local `supabase start`):
  * archive-stale-service-drafts (00001130:1677)
  * auto-release-session-escrow every 15 minutes (00001155:1150)
  * finance-billing-cycle daily (00001250:753)
- HTTP cron routes exist and nothing calls them:
  * POST /api/finance/cron/deposits (bearer FINANCE_CRON_SECRET → PaymentBackendService
    processDueDeposits)
  * POST /api/user/cron/erasures (ACCOUNT_CRON_SECRET; Decision #156(h) says "no scheduler calls
    the erasure sweep yet")
- There is no .github/workflows directory.

Do:
1. Propose to me, in one message, the scheduler choice: hosted pg_cron + pg_net calling the HTTP
   routes with the bearer from Vault, vs. an external runner. Recommend pg_cron + pg_net unless
   the hosting doc says otherwise. Wait for my answer.
2. Implement it:
   - Register the HTTP sweeps.
   - Make every guarded block RAISE NOTICE/WARNING (and write an ops row) when it skips.
   - Add `deno task cron:run <job>` for local manual runs.
   - Document the job table (name, cadence, owner, idempotency) in SYSTEM_ARCHITECTURE.md and the
     env contract (secrets go in Vault, placeholders XXXX-XXXX).
3. Register the new sweeps from M3, M4 and R1 here if they have landed.
```

### R3 · Orphan top-up route & stale demo-credit leftovers (audit 3.1, 3.4)

```text
TASK: Remove dead or contradictory finance surface.

Context:
- POST /api/finance/topup/intent (apps/web/routes/api/finance/topup/intent.ts) has no UI caller.
  The wallet uses /api/wallet/action. Its docstring ("wallet surface still refuses") and
  packages/backend/mocks/registry.ts:194 ("UIs do not call them yet") are stale.
- fn_seed_business_wallet (opening credits) was removed, but
  supabase/seeds/gen/emit-finance.ts:12-16 still describes it and says the fee param is "seeded 0".
- packages/backend/services/finance/wallet-ledger.ts:103 still maps 'demo_opening_credit'.

Do:
1. Decide by grep whether anything external (docs/api, SYSTEM_ARCHITECTURE Stripe section) names
   /api/finance/topup/intent as the contract. If so, make the wallet call it and retire the
   duplicate branch; if not, delete the route and update docs. Choose one door.
2. Fix the stale comments. Keep the ledger label only if historical rows can still carry that
   reason (check the enum/CHECK); otherwise remove it. Run db:seed:generate if seeds change.
```

### R4 · Card settlement must never orphan money (audit 3.3)

```text
TASK: Ensure a succeeded card payment always lands in a ledger row, or is flagged loudly.

Context: finance.settle_card_payment (00001230:529) marks the payment succeeded even when
fn_wallet_credit silently returned (missing wallet), leaving transaction_id NULL. M3 makes credit
raise. This prompt handles the webhook side so a raise doesn't drop the Stripe event.

Do (after M3):
1. In settle_card_payment, call fn_ensure_wallet first, then credit. If any later step (order
   placement, fund_stage) fails, the wallet credit must still commit and the payment must be marked
   'settled_unapplied', with a reason column and a notification to the payer ("funds are in your
   wallet"). Do not roll back the credit. Check how the function currently nests the order
   placement.
2. The webhook returns 2xx only when the ledger row exists. Otherwise it returns 5xx so Stripe
   retries (dedupe via fn_claim_stripe_event must not swallow the retry; release the claim on
   failure).
3. Add an ops view of payments with succeeded status and NULL transaction_id. Tests.
```

### R5 · Unscheduled scheduled-deposit rules UI check (audit 3.9)

```text
TASK: After R2 lands, verify scheduled deposits end to end, and fill any UI gap.

Context: claim_due_deposit_rules (SKIP LOCKED) → off-session PaymentIntent (idempotency
scheduled_deposit:<id>) → bind_scheduled_payment. Find where a user creates deposit rules
(grep deposit_rules in apps/web/features/wallet).

Do: run the sweep locally against stripe-mock (scripts/stripe-smoke.ts pattern). Confirm the rule
→ PaymentIntent → webhook → wallet credit chain. Fix any breakage. If no UI creates rules, report
that to me instead of building it.
```

---

## Wave 6 — Auth polish

### A1 · Verify the access-token JWT in middleware (audit 1.7)

```text
TASK: Stop trusting the sb-access-token cookie by presence alone.

Context:
- apps/web/routes/(dashboard)/_middleware.ts (~:33),
  apps/web/routes/(public)/(auth)/_middleware.ts and apps/web/utils/auth-cookies.ts (~:79-83)
  treat any present access cookie as authenticated. JWT verification is an acknowledged TODO
  (SYSTEM_ARCHITECTURE.md ~:1780, ROUTING.md:38).
- A revoked or tampered token is bounced off /login to /home, then fails RLS reads for up to an
  hour.

Do:
1. Verify signature and exp locally. Use the project JWKS (asymmetric keys) if the Supabase config
   uses them; otherwise HS256 with SUPABASE_JWT_SECRET per the env contract (add it with an
   XXXX-XXXX placeholder if missing). Cache the JWKS.
2. On an invalid or expired token with a refresh cookie present, go down the existing refresh path.
   On an invalid token with no refresh cookie, clear cookies and redirect. Keep the no-loop
   guarantees (safeRedirect refuses auth paths). The auth-screen guard should only bounce on a
   VALID token.
3. Delete the unused CookieKeys.AUTH_SESSION_TOKEN = 'pj_auth_session' (storage-keys.ts) if nothing
   uses it.
4. Tests for: tampered, expired-with-refresh, expired-without-refresh, valid. Update
   SYSTEM_ARCHITECTURE and ROUTING.
```

### A2 · Cookie `Secure` flag & honouring "remember me" (audit 1.2, 1.6)

```text
TASK: Harden cookie attributes.

Context:
- apps/web/utils/auth-cookies.ts:29-53 adds `Secure` only when DENO_ENV === 'production', so an
  HTTPS staging deploy ships cookies without it.
- The refresh cookie is always 30 days. LoginSchema.remember (AuthBackendService.ts ~:173) is
  accepted and then ignored.

Do:
1. Set Secure whenever the request URL is https (or the X-Forwarded-Proto header is https behind
   the proxy), plus always in production. Keep localhost http working.
2. remember=false → refresh cookie becomes a session cookie (no Max-Age). remember=true → 30 days.
   Carry the choice through refresh (store it in a small HttpOnly flag cookie).
3. Tests.
```

### A3 · Notification toggles that do nothing (audit 1.14)

```text
TASK: Collapse the duplicate email/push toggles to one source.

Context:
- org.user_preferences.notification_email / notification_push (00000011 ~:150-186) are written by
  UserBackendService.ts:117-118, and no SQL reads them.
- Delivery uses comms.notification_prefs.email / push (00000016:23-57).

Do:
1. Point the settings UI and UserBackendService at comms.notification_prefs (via the existing
   settings section API).
2. Remove the org columns IN PLACE in 00000011 (not an escrow/wallet/stage table, so that's allowed,
   but grep every reader and the Zod types first), with a seed and docs update. If you find a reader
   you can't remove safely, keep the columns and make a trigger mirror them instead; tell me which
   you chose.
3. Tests.
```

### A4 · Preference seeding: capture signup locale/currency; org owners (audit 1.12, 1.15)

```text
TASK: Seed meaningful preferences and cover organisation owners.

Context:
- org.seed_user_preferences() (00001010:342) inserts user_id only, so every user gets en-GB / GBP /
  system / auto.
- Organisation owners (public.create_organisation path) never get an org.users_public row, so
  neither seed trigger (00001810:15-21) runs for them. See the note in
  apps/web/utils/auth-routing.ts:136-143.

Do:
1. Pass browser locale, timezone and a currency hint from join (client: Intl APIs) through the join
   Zod schema into raw_user_meta_data. Make seed_user_preferences / seed_notification_prefs read it,
   validated against supported locales and currencies (find the reference tables in 00005050), and
   fall back to the defaults.
2. Seed preferences and notification prefs for organisation owners too, on whatever row they do
   get. Read Decision index entries on organisations first.
3. Tests and a probe. Update database docs, including the stale filename at
   documentation/database/org/Functions.md:112.
```

### A5 · OAuth/verify UX edge: tab without a session after email confirm (audit 1.3)

```text
TASK: Covered by S3. Run this only if S3 didn't change VerifyForm. Make the post-confirm state in
VerifyForm.island.tsx explicit ("Confirmed — continue to sign in" with the email pre-filled)
instead of navigating into a /login bounce. Follow UI gate 11. One small PR.
```

---

## Wave 7 — Archetypes

### P1 · Live service/pipeline instantiation (audit 2.17, roadmap 2.3)

```text
TASK: Replace the fixture-backed service instantiation with a real transaction.

Context:
- POST /api/services/instantiate-pipeline → ProjectBackendService.instantiateService
  (packages/backend/services/projects/ProjectBackendService.ts ~:3313) uses the fixture findItem and
  the in-memory draft store. It has the comment "LIVE: … RPC (not yet implemented)" (~:3356).
- BookingBackendService.ts (~:31, ~:500) also resolves listings via the fixture findItem.
- Blueprints live in marketplace.service_blueprints (00000014:22; stage_template ~:109,
  session_template_rules ~:86, intake fields).
- UI callers: BookingCtaRig.tsx:98, ServiceDetailModal.tsx:302.
- Read documentation/flows/ServiceCreation.md and flows/Projects.md.

Do:
1. Add marketplace.instantiate_service_blueprint(p_blueprint_id, p_intake jsonb, p_currency) as
   SECURITY DEFINER with caller checks. In ONE transaction it creates the project, stages (from
   stage_template), tickets with prices, and rooms. It returns the route slug and is idempotent on a
   client key.
2. Read listings live (catalogue/marketplace tables) in both services. Keep fixtures only behind the
   existing *_BACKEND_LIVE=false seam.
3. Tests and a probe. Update the database docs and flows docs (Status section).
```

### P2 · 🧑 DECISION — Pipeline column locks & Chain Reaction (audit 2.17, §2.6 e)

```text
TASK: Implement pipeline escrow semantics.

Context: PRODUCT_MANAGEMENT.md:443 describes "Chain Reaction": approving ticket N JIT-locks ticket
N+1's escrow. Column locks were not found (only fn_stage_reorder_lock and ordering guards). JIT
per-ticket holds exist (finance.fn_hold_ticket_escrow, 00001200:322).

STEP 1 — read PRODUCT_SPEC.md and PRODUCT_MANAGEMENT.md on pipelines. Then STOP AND ASK ME:
  - What is a "column lock": no drag into a column without held escrow, or a frozen column while
    its escrow is in review?
  - Does Chain Reaction pull from a pre-authorised budget (wallet reservation) or require a live
    balance, and what happens when the balance is short (needs_funding + notify)?
STEP 2 — implement: the schema (board column lock flag or derived rule), the trigger on approval →
hold next, the failure path, notifications, the PRODUCT_MANAGEMENT transitions and the Dev Context
Switcher axis if the lock is simulatable. Probes. Depends on P1, M1, M2.
```

### X1 · Disputes MVP: no-show UI + resolution path (audit 2.19, §2.6 f, roadmap 0.8)

```text
TASK: Make a dispute resolvable so it never freezes escrow forever.

Context:
- POST /api/sessions/sittings/[eventId]/no-show.ts → SessionBackendService.claimNoShow →
  projects.claim_session_no_show (00001155:724) inserts an open finance.disputes row and blocks
  release.
- apps/web/features/projects/core/SessionService.ts:30 claimNoShow has no UI consumer.
- There is no UPDATE finance.disputes anywhere. The DisputeService named in PRODUCT_SPEC was not
  found.
- The automatic provider-no-show refund only considers sittings that ended within the 24h window.

Do:
1. Read PRODUCT_SPEC.md on disputes and no-shows. Add the dispute lifecycle (open →
   awaiting_response → under_review → resolved_release | resolved_refund | resolved_split; never
   deleted) to PRODUCT_MANAGEMENT.md. Use existing status conventions; no bespoke statuses outside
   the state machine.
2. Add finance functions to: respond with evidence (counterparty), and resolve (platform operator
   role only; find the ops/admin role check in security). Resolution calls the existing
   release/refund primitives (after M1). Add an auto-escalation deadline.
3. Add DisputeService in packages/backend/services/finance, plus routes.
4. UI: a "Report no-show" action on the sitting (both sides as the spec allows), a dispute status
   panel with an evidence upload via the files pipeline, and notifications.
5. Probes for every resolution branch. Database docs. Dev Context Switcher axis for dispute state
   if it is simulatable.
```

### X2 · Sessions: 1:1 negative-consent release, freelancer-cancel refund, set-session n-1 (audit 2.18–2.19)

```text
TASK: Finish session settlement beyond cohort seats.

Context:
- finance.auto_release_session_escrow (00001155:1061, session_payout_hours=24) covers cohort seat
  escrow only. 1:1 sessions and ticket-based sessions have no negative-consent release.
- The freelancer-cancel → auto-refund path from PRODUCT_SPEC (~:104, ~:112, ~:1111) was not found.
- A set-session block books one slot; the "remaining n-1 are scheduled after payment" flow was not
  found (BookingBackendService.bookSession ~:494).

Do:
1. Generalise the auto-release to any session escrow whose sitting ended more than
   session_payout_hours ago with no open dispute (X1).
2. Freelancer cancel → full refund to the payer via the existing refund primitive, plus
   notification. Client late-cancel per the spec's rules (if the spec is silent on fees, ask me).
3. Set-session block: after payment, create n-1 scheduling handshakes using the existing
   reschedule rounds (scheduling.event_reschedules), with a deadline and reminder notifications.
4. Schedule the sweeps via R2. Probes. PRODUCT_MANAGEMENT updates.
```

### X3 · Stage-level "Discussion"/notification gaps across lifecycle (audit §2.3)

```text
TASK: Fill the remaining participant notifications.

Missing today: approval → client and team-split recipients (unless L3 already did it); application
auto-reject and withdrawal (unless M6 did it); payout.failed (unless R1 did it); and
smoother.deposit (wait for F1). Grep comms.fn_notify callers and 00005010_seed_notification_catalog.sql.
Add only what is still missing, with catalog rows, copy, and tests. Skip anything a previous prompt
delivered, and tell me what you skipped.
```

---

## Wave 8 — Post-MVP gaps (Absent / Partial)

### C1 · Digital product delivery (roadmap 2.1 — buyers currently receive nothing)

```text
TASK: Deliver purchased digital files.

Context:
- catalogue.products.file_manifest (00000023 ~:90) is only read for display
  (explore/live-view.ts:708); neither save_listing nor the listing editor writes it.
- Checkout sells digital_product lines (00001210 ~:1165, credit 'product_sale' ~:1395).
- There is no purchase → access grant, buyer library or signed download link.
- Reusable pieces: the files upload pipeline (api/files/upload-init.ts, upload-complete.ts),
  files/download-guard.ts, packages/backend/core/storage-signed.ts.

Do:
1. Seller: upload deliverable files in ListingEditor into a private bucket and write file_manifest.
   Files must pass the H3 scan once that exists.
2. Add catalogue.order_entitlements (order line → product → buyer; expiry, download count; never
   deleted, revoked_at instead), created inside place_wallet_order for digital_product lines, with
   RLS.
3. Add a guarded download route issuing short-lived signed URLs; count downloads.
4. Buyer library surface (decide placement with DESIGN_SYSTEM nav shell rules; ask if unclear).
5. A refund revokes the entitlement. Zod, database docs, PRODUCT_SPEC, roster updates. Tests.
```

### C2 · Seller editors for productized service templates (roadmap 2.3)

```text
TASK: Build the seller-side editors that flows/ServiceCreation.md lists as missing.

Context: marketplace.service_blueprints has intake fields, stage_template and
session_template_rules (00000014). apps/web/features/catalogue has no intake or stage_template
editor.

Do: add intake-field, stage-template and session-rule editors to the listing editor, using
@projective/ui components only (strict BEM, tokens, signals). Persist through save_listing or a
dedicated RPC with Zod validation. Update ServiceCreation.md Status, the DESIGN_SYSTEM §C.1 roster
and tests. Pairs with P1.
```

### C3 · Organisation → business hierarchy (roadmap Phase 1.2)

```text
TASK: Design, then implement, a group hierarchy.

Context: org.organisations (00000011 ~:821) has only departments text[]. Multi-business ownership
is spec-only (PRODUCT_SPEC.md ~:661). The console module registry is in
apps/web/features/workspaces/core/module-registry.tsx:146. JWT active_context is built in
00001700.

STEP 1 — write a short design (schema, RLS, context-switch level, spend-policy inheritance) and ASK
ME to approve it.
STEP 2 — implement it with the Dev Context Switcher axis, Zod, docs and probes.
```

### F1 · Income Smoother engine (roadmap 3.1)

```text
TASK: Make the Income Smoother actually smooth.

Context:
- Enrolment works: finance.set_income_smoother (00001240:841), the table at 00000017 ~:373,
  params at 00005001:46-50 (income_smoother_fee_bp=50), and wallet UI (live-wallet.ts:426).
- There is no buffering or payout engine, and the smoother.deposit notification type is never sent.
- It is documented only in finance-model.md (~:79, ~:330), not in PRODUCT_SPEC.md.

STEP 1 — draft the PRODUCT_SPEC.md section from finance-model.md and ASK ME to confirm: cadence,
target amount rule, shortfall behaviour, fee timing.
STEP 2 — implement: income credits route into a smoother pot; a scheduled (R2) monthly release to
available with the fee as its own transaction reason; notifications; probes. Depends on M3 and M4.
```

### F2 · Wallet pots CRUD + tax auto-set-aside (roadmap 3.2–3.3)

```text
TASK: Make pots usable and apply auto_allocate_bp.

Context:
- finance.wallet_pots exists (00000017 ~:386; triggers 00001830:31-38; RLS) and is read at
  live-wallet.ts:505.
- auto_allocate_bp is never read; tax_pot_default_bp is seeded (00005001:52).

Do:
1. Add create/rename/archive (never delete) and move-between-pots RPCs. Each move is a ledger
   transfer pair.
2. Add a hook inside the income credit path (escrow_release, product_sale, team split credits —
   not top-ups or refunds) that skims auto_allocate_bp into the pot.
3. Wallet UI for pots (DESIGN_SYSTEM anti-card rules). Docs and probes. Depends on M3.
```

### F3 · Plan subscriptions via Stripe Billing (roadmap 3.4)

```text
TASK: Let users buy plans.

Context:
- Six plans are seeded in 00005030; the business price is NULL ("PRICE TBD").
- PlanBackendService is read-only ("no plan checkout yet", :17).
- Entitlements are enforced via fn_effective_limit / fn_has_entitlement (00001220:122,183).
- Decisions #58, #156(j).

STEP 1 — ASK ME for the business plan price and the billing interval(s).
STEP 2 — implement: Stripe Billing subscription checkout; customer.subscription.* and invoice.*
webhooks into the subscriptions / subscription_events tables (deduped like
fn_claim_stripe_event); entitlement refresh; dunning → downgrade (never delete data); plan
management UI in settings. Use the stripe:stripe-best-practices skill. Tests and smoke.
```

### F4 · Real tax on consolidated invoices (roadmap 3.5)

```text
TASK: Stop hard-coding invoice tax to 0.

Context: finance.fn_generate_consolidated_invoice (00001200:640) sets tax to 0 (~:647, "no tax is
computed yet"). PDFs are rendered via api/finance/invoices/[id]/pdf.ts →
WalletBackendService.documentPdf.

STEP 1 — ASK ME: Stripe Tax calculation API, or a tax-rates table by issuer/buyer jurisdiction?
Which jurisdictions are needed first?
STEP 2 — implement it, with tax lines on the invoice and PDF, sequential invoice numbers per issuer
(verify they exist), and docs and tests.
```

### T1 · External calendar sync (roadmap 4.1)

```text
TASK: Enable calendar connections and busy-import.

Context:
- integrations.* is in 00000020; providers are seeded (google via nylas, 00005050:116-119); routes
  are in api/integrations/*.
- IntegrationsBackendService.ts:26-29 refuses connections on purpose.
- packages/backend/services/scheduling/derive.ts:193 fakes calendar provenance.
- SYSTEM_ARCHITECTURE ~:2655, ~:2749.

Do: implement the Nylas OAuth connect flow, with tokens in the existing token-vault.ts, and a busy
import feeding scheduling.get_free_busy (00001520:56). Remove the faked provenance. Env vars go in
the contract as XXXX-XXXX. Revoke flow. Tests with the adapter mocked. Ask me before registering
any real OAuth app.
```

### T2 · Editorial / article authoring (roadmap 4.5)

```text
TASK: Add a write path for catalogue.articles.

Context: catalogue.articles (00000023 ~:125) is read-only today: it is search-synced (00001400:176)
and rendered on /view and in Explore. There is no RPC or editor.

Do: add the article lifecycle (draft → in_review → published → archived) to PRODUCT_MANAGEMENT.md,
authoring RPCs with RLS, an editor using @projective/ui rich-text if it exists (check the
DESIGN_SYSTEM roster; ask before adding a dependency), and moderation hooks (H4). Docs and tests.
```

### H1 · PII masking on edits and other text surfaces (roadmap 4.2)

```text
TASK: Close the masking gaps.

Context: comms.mask_pii (00001300:246) runs as a BEFORE INSERT trigger on project_messages (only in
the protected phase) and dm_messages (00001840:6,11). Message EDITS (UPDATE) are not masked.
Proposal/application text and file names are not masked. PRODUCT_SPEC ~:739, ~:984; Decision
#147.

Do: extend the triggers to UPDATE OF body. Apply masking to application/proposal free text and
other protected-phase text fields the spec covers (list them and confirm with me before touching
file names). Add false-positive telemetry via ops. Probes.
```

### H2 · Remove or realise the mock `scan-file` edge function (roadmap 4.3, part 1)

```text
TASK: supabase/functions/scan-file is a mock (mockScanWithVirusTotal ~:211) and nothing invokes it.
Either delete it (and its docs references) or make it the real scanner entry point used by H3.
Decide together with H3, and tell me which you chose.
```

### H3 · Real malware scanning & quarantine (roadmap 4.3)

```text
TASK: Replace the sniff-only "scanning" state with a real scan.

Context:
- file_status has 'scanning' and 'quarantined' (00000004:349-353), and there is a quarantine bucket
  guard (00001160:518).
- packages/backend/services/files/live-uploads.ts:43 says "There is no malware scanner in this
  deployment: 'scanning' is the sniff".
- Link scanning is real (files/link-scan.ts).

STEP 1 — ASK ME: ClamAV sidecar or VirusTotal (privacy and cost trade-off)?
STEP 2 — implement it:
- Run the scan asynchronously after upload-complete.
- Block downloads and previews while scanning or quarantined.
- Move infected objects to quarantine and notify the owner.
- Rescan when signatures update (optional).
- Add env contract entries, docs and tests with the scanner mocked.
```

### H4 · Content moderation: reports, flags, queue (roadmap 4.4)

```text
TASK: Build moderation from zero.

Context:
- PRODUCT_SPEC ~:779-790 says "Planned — no screening exists yet" and "no report surface exists
  yet". Decisions #147, #148.
- The only artefact is the moderation.action notification type (00005010:108).

STEP 1 — draft the schema (ops.reports, ops.moderation_flags, actions log), the roles, and the
lifecycle for PRODUCT_MANAGEMENT.md, and ASK ME to approve it, including whether publish-time
automated screening is in scope now.
STEP 2 — implement: report actions on profiles, listings and messages; a moderator queue
(operator-only route); actions (hide, warn, suspend → Archived, never deleted); notifications;
docs; tests.
```

---

## Last — Docs hygiene

### D1 · Stale references sweep (audit §2.7)

```text
TASK: Bring the docs back in line with the code after the waves above.

Do:
1. documentation/database/*/Functions.md: replace pre-consolidation migration filenames (e.g.
   org/Functions.md:112 "20260722120000_seed_user_preferences.sql") with current 0000xxxx files.
2. API_BACKLOG.md: Explore and the booking offer are live. Update every status line against the
   code.
3. ProjectBackendService.create docblock vs the modal (unless L2 fixed it).
4. In MVP_FLOW_AUDIT.md, append a "Resolution log" table mapping each audit row to the PR or commit
   that fixed it. Do not edit the original findings.
Docs only, no code. Run deno fmt on touched markdown only.
```
