# finance Schema: Functions

The `finance` engine is **ticket-centric**. Money moves only through `SECURITY DEFINER` functions:
the client-facing, **stage-level** actions live in the `projects`/`org` schemas and invoke this
engine internally (see [`../projects/Functions.md`](../projects/Functions.md) once populated, and
[`../org/Functions.md`](../org/Functions.md) for the workspace console, whose money governance lives
here in [§ Workspace money governance](#-workspace-money-governance-00001210-13)).

Since 2026-09-23 the schema **is** on the PostgREST allow-list, so the signed-in user reads their
wallets, ledger, orders and baskets directly, under RLS ([Policies.md](Policies.md)). That made
`EXECUTE` a real boundary: **no finance function is callable over the API by default**. `PUBLIC`
and `anon` hold `EXECUTE` on none of them, the ledger and escrow primitives below are service-role
only, and `authenticated` holds exactly the predicates the policies call plus the param-gated
simulator — the full list is in
[Policies.md § Function privileges](Policies.md#-function-privileges-2026-09-23).

All functions are `SECURITY DEFINER` with a pinned `search_path` unless noted.

## Ledger primitives (migration `0009`)

- **`finance.fn_wallet_credit(owner_id, owner_type, currency, amount, reason, ref_table, ref_id)`**
  — credit an **existing** wallet: increments `balance_cents` and appends a `transactions` line with
  the new `balance_after_cents`. A missing wallet (owner · type · currency, matched exactly) raises
  **`PW404`** (Decision #186) — it used to return silently, so a credit could vanish. A caller that
  may be the first to pay an owner runs `fn_ensure_wallet` first. A non-positive amount is still a
  no-op.
- **`finance.fn_wallet_debit(...)`** — the debit counterpart (the `balance_cents >= 0` CHECK
  enforces sufficient funds; a missing wallet raises `PW404`).
- **`finance.fn_check_spending_limit(wallet_id, member, amount)`** → boolean — enforces a member's
  `finance.spending_limits` envelope and counts the spend against it, **atomically** (rewritten
  2026-09-28, signed off by the product owner): the row is locked `FOR UPDATE`, the period is rolled
  when lapsed (`weekly` / `monthly` to the next week/month boundary; `total` never resets), the
  `per_transaction_cents` ceiling and the remaining cap are checked, and the spend is added — so two
  concurrent spends cannot both fit under one cap. A `NULL` cap is "no ceiling"; no row at all is
  "no envelope" (true). The previous body read then wrote without a lock, ignored
  `per_transaction_cents` and `period_interval`, and so counted a lifetime total as the month.
  Business money reaches it only through the spend gate below; a team or enterprise vault still
  calls it directly (the basket, a transfer out).
- **`finance.fn_business_threshold(wallet)`** → bigint (`00001210`, BUSINESSES_AUDIT BF19) — the
  approval threshold that governs one vault: `wallets.approval_threshold_cents`, else the platform's
  `vault_approval_threshold_cents`, else `0` (none). Every threshold read uses it — the business
  basket, the spend gate, `request_spend_approval`, `fn_redeem_spend_approval`'s `DETAIL` and the
  auto-fund drain. Revoked from `PUBLIC`, `anon`, `authenticated`.
- **`finance.fn_assert_business_spend(wallet, actor, amount, ref_table, ref_id, count_envelope =
  true)`** → void (`00001210`, BUSINESSES_AUDIT BF21 / BF22 / §4.2) — **the one business spend
  gate**, called in the transaction that moves the money by `place_wallet_order` (and so
  `place_on_account_order`), `transfer_funds` (business source), `projects.fund_stage`,
  `projects.fund_ticket`, `projects.fund_paid_revision`, the card escrow lock
  (`begin_card_payment`, as a check) and the two escrow holds. A wallet that is not a business's
  returns at once — team and personal spending keep their own rules. Otherwise:
  (a) the business is `active` — `org.fn_assert_business_active`, else `55000`
  `business_not_active: …` (BB5; asserted on every call, counted or not);
  (b) KYB — `fn_business_kyb_verified`, else `PK403` `kyb_required: …`;
  (c) the **actor's** envelope — `fn_check_spending_limit(wallet, actor, amount)`, never the project
  owner's; over the cap or the per-transaction ceiling, an approved request for this ref may still
  carry it (finance-model §14) — it is redeemed and the spend counted past the cap — else `PA403`
  `over_limit: …` with the redeemer's `DETAIL` plus `reason: 'over_limit'`;
  (d) the threshold — at or above `fn_business_threshold`, `fn_redeem_spend_approval` (else `PA403`
  `needs_approval: …`). One approval clears (c) and (d) for one spend and is consumed once.
  **Counted once:** the earliest door the actor touches makes the full check and leaves a
  transaction-local cover (`finance.spend_cover`, bound to `pg_current_xact_id()`) for the holds
  beneath it — a basket or a stage opens a budget on the wallet, closed by its door with
  `fn_close_spend_cover`; `fund_ticket` / `fund_paid_revision` leave one ref for the hold they call.
  A call the cover still pays for (for no more than was counted) re-asserts KYB and passes without
  counting again — so a basket ticket line counts once, against the buyer. A refused
  subtransaction rolls its cover back. `count_envelope = false` is a **check**: KYB and the
  threshold (`fn_redeem_spend_approval(…, p_consume => false)`), nothing counted, consumed or
  covered — the card escrow lock before anyone is charged; settlement runs the real gate. Refs:
  `baskets` · `project_stages` · `tickets` · `revisions` · `transfers`. Definer, `search_path = ''`;
  revoked from `PUBLIC`, `anon`, `authenticated`. TS: `@projective/types/finance` `SpendGateReason`
  / `SPEND_GATE_REFUSAL` / `SpendGateDetailsSchema`, mapped by `packages/backend/core/spend-gate.ts`.
  Probe: `supabase/probes/business_spend_gate.sql`.
- **`finance.fn_close_spend_cover(wallet)`** → void (`00001210`) — drops what a basket or stage door
  left of its cover on one wallet once its holds are made (the unspent budget, any untaken ref), so a
  later door in the same transaction is never waved through on that door's count. Revoked as above.
- **`finance.fn_person_wallet_type(user)`** → text (2026-09-28) — the wallet type a person actually
  holds: an existing `freelancer` wallet wins over a `user` one; with none, a freelancer profile means
  `freelancer`, else `user`.
- **`finance.fn_ensure_wallet(owner_type, owner_id, currency)`** → uuid (2026-09-28) — the owner's
  wallet in that currency, created if missing. Run before the first credit to an owner who may never
  have held one, because `fn_wallet_credit` refuses a missing wallet (`PW404`).
- **`finance.fn_team_split_plan(team_id, payout)`** → jsonb (2026-09-28) — the team payout plan
  (finance-model §5), **one implementation** read by the release and by the console's preview, so
  what a team is shown it will receive is what it receives. Integer arithmetic, floored at every cut:
  `benevolent_dictator` → everything to the vault; `finders_fee` → the finder's fixed cut first, then
  co-op on the remainder; `co_op` → the vault's `vault_bp`, then each ACTIVE member's `percent_bp` of
  the rest, and whatever does not divide (or is unallocated) is dust to the vault. No active rule =
  co-op with no vault cut. Returns `{payout_minor, rule_type, vault_bp, finder_user_id, finder_minor,
  vault_minor, members:[{member_user_id, percent_bp, amount_minor}], dust_minor, vault_total_minor}`.
  **Invariants** (property-tested by `supabase/probes/team_split_properties.sql` over 600 generated
  cases — 2–15 members, stakes totalling 10000 bp, payouts 1–10⁹ minor units, every template; TEAMS_AUDIT
  B9): with `payout` the released gross less its platform fee, Σ member `amount_minor` + `finder_minor`
  + `vault_total_minor` = `payout` **exactly**; `pool = payout − finder_minor − vault_minor` and each
  member cut = ⌊pool × `percent_bp` / 10000⌋, listed by `percent_bp` desc then member id; `dust_minor`
  = pool − Σ member cuts ∈ [0, members with a stake) and is added to `vault_total_minor`
  (= `vault_minor` + `dust_minor`); `benevolent_dictator` cuts no member and the vault takes all of
  `payout`; the same inputs — however the stakes were written — give the same plan, and the preview
  and the release credits agree with it to the minor unit. This **money** remainder (dust → the Team
  Vault) is distinct from the **stake** remainder of a departure rebalance, which goes to the largest
  absorber (`org.fn_rebalance_departed_stake`, `database/org/Functions.md`): stakes must total 10000 bp
  and the vault holds no stake (`finance-model.md` §14).
- **`finance.fn_split_team_payout(escrow_id, team_id, payout, currency, reason = 'escrow_release')`**
  — pays a team's released escrow out by `fn_team_split_plan`. Every member share and the finder's cut
  is a real credit to the person's real wallet (`fn_person_wallet_type` + `fn_ensure_wallet`), a
  `payout_splits` row is written only beside its credit, and the team vault is credited its cut plus
  the dust (`<reason>_vault_retention`) — conserved to the minor unit. **Rewritten 2026-09-28** (signed
  off by the product owner; new 5-arg signature): the previous body credited `user` wallets that
  freelancers do not hold, so every share vanished silently, and it ignored the vault cut entirely.
  `fn_fair_exit_release` now passes `'fair_exit_release'` as the reason.
- **`finance.fn_assert_team_split_total()`** — trigger function for the deferred constraint trigger
  `trg_contribution_agreements_total` (`AFTER INSERT OR UPDATE ON finance.contribution_agreements`,
  `DEFERRABLE INITIALLY DEFERRED`, `00001830`): a team's stakes must total exactly 10000 bp, or 0 (no
  split agreed yet) — `23514` otherwise. Deferred so a rebalance may move basis points between rows
  one statement at a time.
- **`finance.fn_sync_vault_on_wallet()`** — trigger function for `trg_wallets_sync_vault_permissions`
  (`AFTER INSERT ON finance.wallets`, `00001830`): a new team or business wallet is governed from
  birth — `org.fn_sync_vault_permissions` projects the entity's members onto it.

## Escrow lifecycle (migrations `0009`, `0305`, `0310`)

- **`finance.fn_hold_ticket_escrow(ticket_id)`** → escrow id — holds escrow when a lock trigger
  fires (debits the payer wallet; prefers an accepted team assignment as payee). **A hold that cannot
  be made is refused, never skipped (Decision #165):** `PF402`, a "Needs funding — …" message, and
  `DETAIL` = `{state: 'needs_funding', reason, amount_minor, currency}` with `reason` one of `no_price`
  · `no_wallet` (no payer wallet in the project's currency) · `insufficient_funds` (checked for both
  wallet types — a business no longer relies on the `balance_cents` CHECK) · `spending_limit` ·
  `needs_approval` · `kyb_required` (the business spend gate refused it; its `DETAIL` keys —
  `wallet_id`, `ref_table`, `ref_id`, `threshold_minor` — are merged in). A missing
  stage is not a funding problem → `check_violation`; a missing payee is a **prepaid** hold (Decision
  #197): the escrow is written with `payee_type`/`payee_id` NULL, only the client is told ("It is
  paid to whoever claims it."), and the claim binds it. The payee is `finance.fn_ticket_payee`. Already held (a held escrow with no
  `revision_id`) → `NULL`, the one early return. **Concurrent holds (Decision #189):** the check
  cannot see a sibling transaction's uncommitted hold, so the INSERT is the arbiter —
  `uq_escrows_ticket_base_held` makes the later one wait, and once the first commits it gets
  `unique_violation`, which the function reads as "already held": `NULL`, nothing debited, no notice.
  A `unique_violation` on any other constraint is re-raised. A business payer's hold goes through
  `fn_assert_business_spend` (ref `tickets`): when a door (`fund_stage`, `fund_ticket`, the basket)
  gated this spend for its funder in this transaction, its cover passes the hold without counting
  again; otherwise the hold is **automatic** (a claim, the Chain Reaction, the auto-fund drain) and
  the spender is the **project owner** (`projects.projects.owner_user_id`) — never `auth.uid()`, which
  here is the freelancer whose claim triggered it. The gate's `PA403` / `PK403` become this `PF402`, so
  every caller that turns a refused hold into Needs funding still does. On success it sets
  `payment_status = 'escrow_funded'` and notifies the payee ("Funded — you can start") and, unless the
  client made the hold themselves (`auth.uid()`), the project owner, both `escrow.funded` with a
  `?tkv=` ticket link. `search_path = public, finance, projects, org, comms, auth`.
- **`finance.fn_ticket_payee(stage_id, assignee_id)`** → `(payee_type, payee_id)` (Decision #197) —
  the one payee rule the hold and the bind share: an accepted team seat on the stage, else the
  assignee; both NULL when neither exists. Internal (`EXECUTE` revoked from `PUBLIC`, `anon`,
  `authenticated`).
- **`finance.fn_bind_ticket_escrow(ticket_id)`** → escrow id or `NULL` (Decision #197) — names the
  payee of a PREPAID held escrow when a claim or assignment gives its ticket one. Called by
  `projects.fn_ticket_escrow_sync` before it would hold; `NULL` (nothing unbound, or still no payee)
  lets the ordinary hold run. Debits nothing; tells the new payee "Funded — you can start"
  (`escrow.funded`). Internal, revoked as above.
- **`finance.fn_hold_revision_escrow(revision_id)`** → escrow id (Decision #167) — one MORE held
  escrow on a paid revision round's ticket, at the round's `price_cents`, beside the one already held
  for the work. The row names its round (`revision_id`), so it is never taken for the base escrow and
  a round is held once (`uq_escrows_revision`, Decision #189). Same payee rule (an accepted team seat, else the ticket's assignee; none →
  `check_violation`) and the same refusal shape as `fn_hold_ticket_escrow` under #165: `PF402` with
  `DETAIL` `{state: 'needs_funding', reason: no_price | no_wallet | insufficient_funds |
  spending_limit | needs_approval | kyb_required, amount_minor, currency}` — through the spend gate
  with ref `revisions`, covered by `fund_paid_revision`'s own gate. Internal (`EXECUTE` revoked from `authenticated`); only
  `projects.fund_paid_revision` calls it, under a lock on the round. Released with the ticket's other
  held rows by `fn_release_ticket_escrow`.
- **`finance.fn_release_ticket_escrow(ticket_id)`** — releases held escrow to the payee, applying
  the canonical **5%** fee (`security.platform_params.platform_fee_bp = 500`, set in `0305`) and
  routing team payees through `fn_split_team_payout`. **Exactly once under concurrency** (Decision
  #188): it locks the ticket row, then each held escrow `FOR UPDATE` in id order, and flips it with
  `UPDATE … WHERE id = r.id AND status = 'held' RETURNING id`; no row back means another caller
  settled it first, and nothing is credited. Before #188 the loop read without a lock and the flip
  did not re-check `status`, so two concurrent settlements of one ticket under READ COMMITTED (two
  `approve_stage` calls, or `complete_ticket` racing `approve_stage`) both paid the payee.
  **Unbound (Decision #197):** a held escrow with no payee — prepaid, never claimed — is refunded to
  its payer (`fn_refund_ticket_escrow`, under the ticket lock) instead, so a completed, removed or
  cancelled ticket nobody claimed never pays out to nobody.
- **`finance.fn_refund_ticket_escrow(ticket_id)`** (`0310`) — refunds held escrow to the payer (used
  by claim-TTL "parking" auto-release); no fee is applied to a refund. Locked and guarded as
  `fn_release_ticket_escrow` (#188): a refund racing a release, or a second refund, returns nothing.
- **`finance.fn_fair_exit_release(ticket_id, bp)`** (`0305`) — the 25/50/75 fair-exit split: pays
  the payee `bp` basis-points of the principal (net of fee), refunds the remainder to the client.
  Locked and guarded as `fn_release_ticket_escrow` (#188). An unbound (prepaid, unclaimed) escrow
  earned nothing and is refunded in full (Decision #197). Its arithmetic is
  **`finance.fn_fair_exit_split(amount_cents bigint, bp integer, fee_bp integer)`** (`00001200`,
  `IMMUTABLE`, internal) → `(share_cents, fee_cents, payout_cents, refund_cents)`: share = amount ×
  bp / 10000, fee = share × fee_bp / 10000, payout = share − fee, refund = amount − share, each
  truncated (#187). `projects.fn_fair_exit_quote` uses the same helper, so the Fair Exit preview
  and the settlement cannot disagree (Decision #198).

  **Verification:** `supabase/probes/escrow_release_concurrency.sql` races two real sessions
  (dblink) on one ticket for each of these, and on the stage doors that call them, and asserts the
  second session adds no ledger row. It commits, so it runs against a disposable copy of the
  database (recipe in its header), never the shared dev DB.
- **`finance.fn_generate_consolidated_invoice(business_id, start, end)`** — consolidates a period's
  released escrows/fees/bonuses into one itemised `consolidated_monthly` invoice.
- ~~`finance.fn_seed_business_wallet()`~~ — **removed 2026-09-28** with its trigger
  `trg_seed_business_wallet`. It credited every new business wallet 2,500,000 minor units of
  `demo_opening_credit` in whatever currency it was opened in — spendable funds nobody had paid in. No
  wallet is minted money; a balance is only ever the sum of real movements.

## Additive foundation (2026-07-23)

### Authorization / gating predicates

- **`finance.fn_assert_payout_ready(payee_type, payee_id)`** → void (`00001210` §5, Decision #196) —
  THE earning gate. A `freelancer` payee must pass `fn_freelancer_payout_ready`; a `team` payee needs
  every shareholder to. Refuses `PK403` with a `payout_not_ready: …` message; HINT `self` (the
  caller — the app links Settings → Verification) · `other` (a freelancer an owner tried to seat) ·
  `team`; DETAIL is the unready shareholders' `@handles` for a member who may commit the team
  (`org.is_team_lead`), else empty. Called by `projects.apply_to_seat` · `apply_to_project` ·
  `redeem_invite_link` · `assign_from_application` · `fn_apply_invitation_decision` (freelancer
  role) · `fn_assign_ticket_core` · `org.create_workspace` (team) · `org.respond_to_workspace_invitation`
  (team) · `org.transfer_workspace_ownership` (team successor, HINT `other`). No client grant.
- **`finance.fn_team_shareholders(team)`** → setof uuid (`00001210` §5) — the people
  `fn_team_split_plan` would pay: active members with `percent_bp > 0` (none under
  `benevolent_dictator`) plus the `finders_fee` finder. No client grant.
- **`finance.fn_wallet_holds_earnings(wallet)`** → boolean (`00001210` §5) — any
  `finance.pending_releases` row for the wallet, i.e. it has received earned money (Decision #191).
  `begin_payout` requires a payout-ready withdrawer for a `user` or `team` wallet that holds
  earnings. No client grant.
- **`finance.fn_owner_visible(owner_type, owner_id)`** → boolean (`20260723092000`) — can the caller
  see this owner's finances? (self / active-member / admin). Basis for the wallet-scoped RLS
  policies.
- **`finance.fn_can_view_wallet(wallet_id)`** → boolean — the wallet-id form.
- **`finance.fn_has_vault_capability(wallet_id, user_id, cap)`** → boolean (`20260723093000`) — the
  in-DB vault-capability gate (`manage_members` implies all). Since 2026-09-28 the grant rows are a
  projection of the workspace capabilities, and the answer is additionally conditioned on **current
  membership** of the owning team or business (`org.fn_member_seat`) — so a row that outlived its
  member for any reason (a direct write, a sync not yet run) authorises nothing. **Internal**: no
  client role may call it (it answers for an arbitrary user id — a capability oracle — and no policy
  calls it; its callers are definer predicates and money RPCs).
- **`finance.fn_reads_wallet_envelopes(wallet_id)`** → boolean (`00001210`, BB6) — may the CALLER
  read every member's spend envelope and every spend request on the wallet, not only their own? Yes
  for `distribute` (workspace `manage_finances`) or `approve_spend` — and the owner, whose
  `manage_members` implies both (and a platform admin, through `fn_has_vault_capability`). Granted to
  `authenticated`: the `spending_limits` / `spend_approvals` SELECT policies ask it beside the
  reader's own rows, and definer reads that mirror those screens call it too.
- **`finance.fn_owner_capability(owner_type, owner_id, cap)`** → boolean (`00001210`, 2026-09-23) —
  the **owner**-keyed form of the vault gate, for tables that belong to a principal rather than a
  wallet (`payment_methods`, `saved_cards`, `payout_schedules`). Admin, or self for a personal owner
  (`user`/`freelancer`), or — for a shared owner — `fn_owner_visible` **and** `cap` on one of that
  owner's wallets. It exists because bare membership (`fn_owner_visible`) had been the write rule
  on those tables, letting any member of an entity re-route its payouts or manage its cards.
  ⚠️ **Fails closed** like `fn_can_manage_basket`: a shared owner with no wallet has nobody who
  holds the capability.
- **`finance.fn_freelancer_payout_ready(user_id)`** → boolean (`20260723091000`) — true only when
  the freelancer is KYC-`verified` AND `payout_ready`. **The onboarding gate**, enforced through
  `fn_assert_payout_ready` (below, Decision #196).
- **`finance.fn_business_kyb_verified(business_id)`** → boolean — true when the business is
  KYB-`verified` (required to operate the pooled Business Wallet).

> **Two kinds of predicate, two grants.** The visibility and capability predicates answer a
> question about the CALLER and are what the RLS policies are made of, so `authenticated` must hold
> them. The KYC/KYB pair take ANY subject id and answer about somebody else, so they are
> **`service_role` only** — a client grant would let any signed-in account ask whether any other
> person has cleared KYC.

> ⚠️ **Enforcement wiring flagged (root `CLAUDE.md` §8):** these gating predicates are provided but
> are **not** yet wired into the existing money-movement functions (`projects.claim_ticket`,
> `finance.fn_hold_ticket_escrow`, `projects.fund_stage`, and the hire/join RPCs). Wiring them
> changes escrow/stage behaviour on the protected relationships, so it is a follow-up requiring
> human sign-off, not applied in this documentation/schema pass.

### Views

- **`finance.v_wallet_reconciliation`** (`20260723094000`) — internal ledger self-consistency
  (`balance_cents` vs the running ledger sum → `drift_cents`, expected 0). `service_role`-only.
  Read nightly by `fn_reconcile_wallets` (below).

### Ledger integrity (Decision #186)

`finance.wallets.balance_cents` is a cache written beside the ledger by the two primitives above, so
the ledger must be the one record nobody can rewrite, and the cache must be checked against it.

- **`finance.fn_transactions_append_only()`** → trigger (not definer) — raises `PL403`
  (`ledger: finance.transactions is append-only — <op> refused`) unconditionally. Bound to
  `finance.transactions` `BEFORE UPDATE OR DELETE` per row (`trg_transactions_append_only`) and
  `BEFORE TRUNCATE` per statement (`trg_transactions_no_truncate`, since TRUNCATE skips row triggers)
  in `00001830`. No function updates or deletes ledger rows; corrections are compensating rows.
- **`finance.fn_reconcile_wallets()`** → integer — for every wallet, compares `balance_cents` with
  the ledger sum (`v_wallet_reconciliation.drift_cents`) **and** with its newest row's
  `balance_after_cents` (ordered `created_at DESC, id DESC`, as `list_ledger` pages), in one
  statement so a movement committing mid-run is seen whole or not at all. Each drifted wallet becomes
  one `ops.log_entries` row (`level = 'error'`, `source = 'server'`,
  `scope = 'finance.reconcile_wallets'`, `client_id = 'reconcile:<run id>'`, `data` = `run_id`,
  `wallet_id`, `owner_type`, `owner_id`, `currency`, `balance_cents`, `ledger_sum_cents`,
  `latest_balance_after_cents`); the run raises a `WARNING` and returns the number of drifted
  wallets. Read-only on `finance`: drift is reported for a human, never auto-corrected. Service role
  only (`00002510`). Scheduled nightly at 03:40 UTC as `finance-reconcile-wallets`, a row of the job
  registry (`ops.scheduled_jobs`, Decision #203); `deno task cron:run finance-reconcile-wallets` runs it
  by hand.

## Stage-level wrappers (in `projects`, invoke this engine — migration `0305`)

`projects.fund_stage`, `projects.approve_stage`, `projects.cancel_stage_fair_exit`,
`projects.get_stage_finance` — all `SECURITY DEFINER`. `get_stage_finance` is guarded by
`projects.has_project_access`; `fund_stage` asks the funder predicate `projects.fn_can_fund_project`
(BB2); `approve_stage` and `cancel_stage_fair_exit` require `projects.can_review_project` (and, on a
business project, the `hire` capability — BB2) and are `EXECUTE`-granted to
`authenticated` only, because the assignee passes `has_project_access` and must not settle their own
escrow ([projects/Functions.md](../projects/Functions.md#escrow-settlement-doors)).
These are the client-facing Finance-tab actions; they call the `finance.*` engine above. (The 0309
business-dashboard read `org.get_business_finance` was retired 2026-09-28; an entity's balances are
read under RLS by the wallet surface, and its console reads through `org.get_workspace_detail`.)

**`projects.fund_stage` spends the client's money, so it checks the payer, not just project
access** (2026-09-23, `00001150`). Project access alone admitted every participant — a hired
freelancer could fund the client's escrow from the client's wallet. Since BB2 the payer test
is `projects.fn_can_fund_project` — the same predicate for `fund_stage`, `fund_ticket`,
`fund_paid_revision`, `projects.get_stage_funding_quote` and the card escrow lock: with no
`client_business_id` the project's owner pays as an individual client from their personal wallet, and
only the owner may (Decisions #126 / #165 (D)); for a business, the caller must hold vault `spend` on
the business wallet in the project's currency (or `spend_funds` before that wallet exists) — owning
the project is not enough, and project access is no longer asked, so a spend-only business member who
was refused before now funds (BUSINESSES_AUDIT BF23). Else `PK403` `not_funder: only a member who can
spend from the client's wallet can fund …` ([projects/Functions.md](../projects/Functions.md#business-authority-one-capability-per-act-bb2)). Since BB3
(BUSINESSES_AUDIT BF21) every funding door — `fund_stage` (the stage's total, ref
`project_stages`), `fund_ticket` (`tickets`), `fund_paid_revision` (`revisions`) and the card escrow
lock (a check at `begin_card_payment`, the real gate at settlement) — passes
`finance.fn_assert_business_spend` for the **funder**: the KYB gate on funding (Decision #54(e)), the
funder's own envelope and the approval threshold.

## Deferred (documented target, not yet implemented)

The additive foundation defines the **data + gates** for these flows; the `SECURITY DEFINER` write
RPCs that operate them are the live-path TODO (behind the eventual `FINANCE_BACKEND_LIVE`-style
gate): recurring-deposit runner, payout-schedule runner + Instant Payout, Income-Smoother
allocation, tax-pot auto-set-aside, the pending-release (7-day-window) sweep, monthly statement
generation, and the FX-rate ingestion job. (The spend-approval decision landed as
`finance.decide_spend_approval` — see [§ Wallet movements](#-wallet-movements-00001210-12); vault-
permission grant/revoke is no longer a separate RPC — the grants are a projection of the workspace
capabilities, [§ Workspace money governance](#-workspace-money-governance-00001210-13).)

---

## Entitlement resolution & allowance metering (migrations `20260724112000` / `20260724113000`)

The entitlement resolver is the bridge between the two ladders: it reads the **paid** layer
(`finance.plans` â†’ `plan_entitlements`) and scales it by the **earned** layer
(`org.standing_levels`), then lets an admin `entitlement_grant` raise â€” never lower â€” the
result.

### Plan resolution

- **`finance.fn_audience_for(subject_type) â†’ finance.plan_audience`** â€” `IMMUTABLE`.
  `user`/`freelancer` â†’ `individual`; `team` â†’ `team`; `business` â†’ `business`; `enterprise`
  â†’ `enterprise`.
- **`finance.fn_active_plan(subject_type, subject_id) â†’ uuid`** â€” the subject's live plan
  (`state IN ('trialing','active','past_due')` and not past `current_period_end`), falling back to
  its audience's default free plan. **Every subject always resolves to a plan** â€” there is no
  unentitled state.
- **`finance.fn_subject_standing_level(subject_type, subject_id) → smallint`** — defers to
  `org.fn_standing_level` for earning subjects; buyer subjects (`business`/`enterprise`) resolve
  to rung `1`, because they carry the Client Trust Score rather than Standing. A person metered as
  **`user`** reads their **`freelancer`** rung — `org.entity_standing` keys a seller by user id under
  that type and no recompute writes a `user` row, so reading `user` literally pinned every individual
  at rung 1 and dropped the earned weekly-proposal bonus (Decision #154(C)).

### `finance.fn_effective_limit(subject_type, subject_id, key) â†’ integer`

The core resolver. `NULL` = **unlimited**; `0` = the subject's plan does not grant the lever at all
(deny-by-default for any key a plan does not name).

1. Look up the plan's `plan_entitlements` row.
2. Apply `scaling`:
   - `none` â†’ `limit_value`.
   - `standing_base` â†’ `standing_levels.listing_base Ã— multiplier_bp / 10000` (Free = 1.0Ã—, Pro
     = 2.0Ã— â€” Pro **doubles what was earned** rather than replacing it).
   - `standing_bonus` â†’ `limit_value + standing_levels.proposal_bonus` (reliability buys volume
     the same way money does).
3. Take `GREATEST(base, active grant)`; any unlimited flag anywhere wins.

- **`finance.fn_has_entitlement(subject_type, subject_id, key) â†’ boolean`** â€” the flag-kind twin
  (grant first, then plan, then `false`).

Both are mirrored by pure TypeScript twins in `packages/types/finance/entitlements.ts`
(`scaleEntitlement`, `canConsumeAllowance`) so the client can preview a value without a round trip.

### Effective rates

- **`finance.fn_effective_commission_bp(subject_type, subject_id) â†’ integer`** â€” negotiated rate
  â†’ `standing_commission_tiers` for the rung â†’ `800` (8%). This is the **earned** marketplace
  taper.
- **`finance.fn_effective_platform_fee_bp(subject_type, subject_id) â†’ integer`** â€” negotiated
  rate â†’ `security.platform_params.platform_fee_bp` â†’ `0`. The 5% project service fee does
  **not** taper with Standing and is not bundled with any plan; the only sanctioned flex is an
  admin-approved `finance.negotiated_rates` row for an Enterprise/Business volume commitment.

### Allowance metering

- **`finance.fn_current_allowance(subject_type, subject_id, key) â†’ finance.allowance_periods`**
  â€” opens or rolls the weekly period (`date_trunc('week', now())`), snapshotting `granted_units`
  with its `base_units` / `standing_bonus_units` provenance so a mid-week upgrade or promotion is an
  explicit new grant rather than a silent drift. Also applies the lazy buffer drip: while the buffer
  is below its cap and at least one `proposal_buffer_window_hours` window has passed since
  `buffer_refreshed_at`, it adds `drip × windows` (capped) and **advances the clock by the windows it
  paid out** — never to `now()`, so a late read keeps its partial window and the "next token"
  instant (`buffer_refreshed_at + window`) stays true. Emits
  `allowance.period_rolled` / `allowance.buffer_replenished`. **`service_role` only** — it takes any subject, so a client grant would disclose other people's
  allowances; `finance.get_proposal_allowance` is the self-scoped door.
- **`finance.fn_consume_allowance(subject, units, key, reason, ref_table, ref_id) → boolean`** —
  spends units. Requires **both** weekly headroom and a buffer token, so a week's allowance can
  never be dumped into one hour of spam. A spend that takes a **full** buffer below its cap restarts
  the drip clock at `now()` — a full bucket is not dripping, so idle time never banks a refill.
  Emits `allowance.consumed` on success and
  `allowance.exhausted` on refusal — the refusal is recorded either way, because the denial rate
  is the upgrade signal. **`service_role` only.**
- **`finance.fn_refund_allowance(...) → boolean`** — returns WEEKLY units (a withdrawn proposal
  should not cost the week's allowance). The buffer token is not returned — an apply → withdraw loop
  must not refill the anti-burst drip. **`service_role` only.**
- **`finance.get_proposal_allowance(p_team_id uuid DEFAULT NULL) → jsonb`** — the caller's proposal
  allowance (Decision #154). `SECURITY DEFINER`, granted to `authenticated`; the subject is DERIVED —
  `auth.uid()` as `user`, or `p_team_id` as `team` only when the caller is an active member
  (`42501` otherwise). Calls `fn_current_allowance` (so reading opens the week and pays out the drip)
  and returns `subject_type`, `subject_id`, `period_start`, `period_end`, `granted_units`,
  `consumed_units`, `base_units`, `standing_bonus_units`, `buffer_units`, `buffer_cap`,
  `buffer_refreshed_at`, `buffer_window_hours`, `buffer_drip`, `plan_code` / `plan_label` /
  `plan_tier` / `plan_audience`, `upgrade_plan_label` / `upgrade_weekly_units` (the same audience's
  public Pro plan, free tiers only), `standing_level`, `enforced` (`proposal_allowance_enforced`),
  `team_status`, `team_member_count` and `can_bind_seat` (team only), and `server_now`. Resolved by
  `resolveProposalAllowance` (`@projective/types/finance`). A report only — the apply doors enforce
  through `projects.fn_assert_team_can_apply`.
- **`finance.record_proposal_denial(p_reason text, p_team_id uuid DEFAULT NULL, p_project text DEFAULT NULL) → void`**
  — writes `entitlement.denied` (`gate: preflight`) for a refusal the app's pre-flight gate made
  before `apply_to_project` inserted, which the metering trigger therefore never saw. Caller-scoped
  like the read; `p_reason` ∈ `weekly_exhausted · buffer_exhausted · team_too_small ·
  team_not_active · missing_permission`; `p_project` is a slug or uuid. Granted to `authenticated` (the `analytics`
  schema is not exposed to PostgREST).

### Footprint

- **`finance.fn_footprint_usage(subject_type, subject_id, key) â†’ integer`** â€” live counts for
  `active_public_projects` / `business_public_projects` / `team_public_projects` (from
  `projects.projects` where `status IN ('active','on_hold')` **and** `visibility = 'public'`),
  `teams_owned`, `businesses_owned` (an **archived** entity no longer occupies a slot — the create
  refusal tells an owner at their limit to "archive one or upgrade", which is only true if it frees one),
  `team_seats`, `enterprise_seats`.

  **Drafts are never counted** â€” unlimited private drafting is the baseline promise.
  `published_listings` returns `0` until the `catalogue.*` listing tables land (Decision #53 keeps
  `/catalogue` on fixtures); its **cap already resolves**, only its usage count is pending.

  **The `storage_megabytes` branch** (added with the asset-management pass) reads
  **`files.storage_usage.bytes_used`** — the materialised per-owner rollup — and returns floored
  mebibytes:

  ```sql
  SELECT COALESCE((u.bytes_used / 1048576)::integer, 0)
  FROM files.storage_usage u
  WHERE u.owner_type = (CASE p_subject_type WHEN 'freelancer' THEN 'user'
                        ELSE p_subject_type END)::files.owner_kind
    AND u.owner_id = p_subject_id;
  ```

  Three things in those five lines are load-bearing:

  - **It reads the rollup, never a live `sum()` over `files.items`.** This function is called on the
    **upload path**, and summing `size_bytes` across a growing library on every upload is exactly
    the cost that only shows up once a tenant is successful. `files.fn_recompute_usage` keeps the
    rollup true off a trigger; see [`../files/Functions.md`](../files/Functions.md).
  - **Bytes in, mebibytes out.** The rollup is `bigint` (the honest unit for a byte total); this
    function returns `integer` MiB, because that is the unit the whole entitlement ladder is
    denominated in — 25 GB in bytes overflows `int4`. Integer division **floors**, so a subject is
    never reported as having consumed a MiB they have not. The conversion back the other way happens
    once, in `files.fn_check_storage_quota`.
  - **`'freelancer'` folds to `'user'`.** A freelancer's bytes are their user's bytes, and
    `files.owner_kind` deliberately omits the `freelancer` pseudo-owner that `scheduling.owner_type`
    carries — a second quota key for the same human would double-count them against their own
    allowance.

  `fn_effective_limit`, `fn_has_entitlement` and `fn_footprint_remaining` needed **no** edits: they
  are already generic over `finance.entitlement_key`, which is why adding a whole new metered
  resource cost one `ELSIF`.

  **Enforcement of this key lives outside this schema.** The gate is `files.fn_check_storage_quota`
  (a `BEFORE INSERT OR UPDATE OF size_bytes` trigger on `files.items`), and it is the **third**
  member of the fail-open family below — param `security.platform_params.storage_quota_enforced`,
  seeded `false`. It inherits the same known limit: once flipped, the `RAISE` aborts the transaction
  and rolls back any denial telemetry written moments earlier, so the denial must be recorded by the
  app layer catching the `check_violation`.
- **`finance.fn_footprint_remaining(...) â†’ integer`** â€” headroom, or `NULL` when unlimited.

---

## âš–ï¸ Enforcement triggers (migration `20260724113000`)

Triggers on existing project tables. They **meter unconditionally** and **block only when their
platform param is switched on** â€” `proposal_allowance_enforced` and `footprint_caps_enforced`,
both seeded `false`.

> **Why fail-open.** Turning a cap into a hard block changes user-visible behaviour on a live
> marketplace. Metering first means the magnitudes (50/wk, 3-per-10h, 3 live projects) get tuned
> against `analytics.events` before anyone is ever refused. Flipping either param is a deliberate
> human decision, never a side effect of running a migration.

| Trigger                              | On                                                                   | Behaviour                                                                                                                                                         |
| :----------------------------------- | :------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trg_meter_application_allowance`    | `AFTER INSERT ON projects.project_applications`                      | Spends one `weekly_proposals` unit from the applicant (the **team** when a team applies, else the user). Emits `entitlement.denied` when exhausted.               |
| `trg_refund_withdrawn_application`   | `AFTER UPDATE OF status ON projects.project_applications`            | Returns the unit on a transition to `withdrawn` â€” selectivity should never be punished twice.                                                                   |
| `trg_check_public_project_footprint` | `BEFORE INSERT OR UPDATE OF status, visibility ON projects.projects` | Counts a slot only when a project **becomes** `active` + `public` (a project already live is not re-counted). Business-owned projects meter against the business. |

None of these touch execution capacity: `projects.check_ticket_capacity` and the $W_i$ caps remain
the sole authority over how much work a freelancer may hold.

> **⚠️ Known limit of the fail-open design.** While a param is `false` the `entitlement.denied`
> event commits normally. Once it is `true`, the `RAISE` aborts the transaction — which also rolls
> back the analytics row written moments earlier. Postgres has no autonomous transactions, so
> **after the switch is flipped, a denial must be recorded by the app layer**: catch the
> `check_violation` and call `analytics.fn_emit` from the service. Without that, the denial funnel
> goes dark at exactly the moment enforcement starts mattering.

## ðŸŽ› Platform parameters added

| Key                                 | Default | Meaning                                                                                                                         |
| :---------------------------------- | :------ | :------------------------------------------------------------------------------------------------------------------------------ |
| `proposal_allowance_enforced`       | `false` | Meter-only until flipped.                                                                                                       |
| `footprint_caps_enforced`           | `false` | Meter-only until flipped.                                                                                                       |
| `storage_quota_enforced`            | `false` | Meter-only until flipped. Gates `files.fn_check_storage_quota` (seeded in `00005001`); flipping it starts **refusing uploads**. |
| `proposal_buffer_window_hours`      | `10`    | The "3 per 10 hours" drip window.                                                                                               |
| `proposal_buffer_hold_multiple`     | `4`     | Buffer hold cap as a multiple of the drip â€” how many may be banked.                                                           |
| `subscription_grace_days`           | `7`     | Days a `past_due` subscription keeps its paid entitlements.                                                                     |
| `standing_recompute_interval_hours` | `24`    | Standing sweep cadence (migration `20260724111000`).                                                                            |
| `standing_demotion_grace_days`      | `30`    | Reserved anti-flapping guard on demotions.                                                                                      |
| `finance_simulation_enabled`        | `false` | **Fails closed.** Gates `finance.simulate_wallet_transaction` — see below.                                                      |
| `business_plan_gates_enforced`      | `true`  | **Seeded ON** (Decision #230 (e)). Gates the Business Pro refusals of `fn_assert_business_entitlement` — see below.             |

## 💼 Business plan gates (`00001220` §7, Decision #230 (b), (e))

Business Pro's paid acts are refused **without the entitlement** — `PK402`, MESSAGE
`entitlement: <key>: <reason>`, the key again in HINT — behind **one** switch,
`security.platform_params.business_plan_gates_enforced`. It is **seeded `true`** and set per
environment: deliberately the **reverse** of the fail-open family above, by the owner's ruling
("enforce now for development testing and future proofing"). A missing row reads as on; set it
`false` and nothing is refused.

| Entitlement            | Kind  | Free / Pro | Refused at                                                                                                                                                                                                                                                                                         |
| :--------------------- | :---- | :--------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `business_managers`    | limit | 2 / 15     | `org.invite_workspace_member` to a manager's role (+1), `org.respond_to_workspace_invitation` accepting one (the invitation is already counted), `org.update_workspace_member` making a member a manager, `org.upsert_workspace_role` when an edit **adds** managers. Never a change that leaves a manager a manager. |
| `intervaled_invoicing` | flag  | — / ✅     | `finance.set_invoicing_terms` to `intervaled_monthly` (before the KYB check). Back to `per_transaction` never.                                                                                                                                                                                     |
| `pooled_wallet_full`   | flag  | basic / ✅ | A non-null `approval_threshold_minor` or per-member `limit_minor` / `per_transaction_minor` through `finance.save_spend_policy`, and a non-null `spend_limit_minor` / `per_transaction_minor` through `org.update_workspace_member`. Clearing either, and `can_spend`, never — basic mode is the shared wallet without caps. |

A **manager** is an active member other than the owner who sits as an admin, or whose
**effective** capabilities hold `manage_projects` — a per-member grant counts, or the override would
be a way round the cap (`org.fn_business_member_is_manager`; a role's answer is
`org.fn_business_role_is_manager`). Pending, unexpired invitations that offer such a role count too
(the team-seat rule), so `finance.fn_footprint_usage('business', id, 'business_managers')` is
members + invitations. A plan downgrade evicts nobody; it only refuses the next manager.

- **`finance.fn_business_plan_gates_enforced() → boolean`** — the switch, or a development override.
- **`finance.fn_business_gate_limit(business, key) → integer`** / **`fn_business_gate_flag(business,
  key) → boolean`** — `fn_effective_limit` / `fn_has_entitlement` for the business, or the bare
  Business Free plan under the `free` override.
- **`finance.fn_assert_business_entitlement(business, key, extra = 0)`** — the refusal; a no-op while
  the switch is off.
- **`finance.fn_dev_plan_gates() → text`** — the Dev Context Switcher's `businessPlanGates` override,
  read from PostgREST's `request.headers` (`x-pj-dev-plan-gates`): `enforced` turns the gates on
  where the switch is off, `free` also resolves the business as on Business Free. It can only make
  a gate **stricter**, so it is honoured from any caller — a client that sends it refuses only
  itself. The app forwards it from the `pj.dev.plan-gates` cookie in development only.

The app maps `PK402` to HTTP 402 with `details { reason: "entitlement", entitlement }`
(`packages/backend/core/plan-gate.ts`) for the surface's upgrade notice. Probe:
`supabase/probes/business_entitlements.sql`.

## 🧺 Basket authorization predicates (`00001210`)

Both **compose** the §Authorization helpers above rather than restating membership logic — there is
exactly one answer in this schema to "may this caller reach that owner's money", and these narrow
it, never re-derive it.

- **`finance.fn_can_manage_basket(owner_type, owner_id)`** → boolean — may the caller **write** this
  owner's basket? Personal (`user`/`freelancer`) → self only. Shared (`business`/`team`/
  `enterprise`) → `fn_owner_visible` **and** the `spend` vault capability on one of that owner's
  wallets, i.e. the same grant that would let the member actually pay for the line. Admin passes. ⚠️
  **Fails closed**: an entity with no wallet, or with no `vault_permissions` rows, has nobody who
  may write its basket. That is the correct posture for a spend surface — a silent fallback to "any
  member" would make the capability decorative — but vault provisioning must precede shared-basket
  use. (For a team or business it now always does: `org.create_workspace` opens the wallet and the
  wallet insert trigger projects the grants. The projection covers teams and businesses only — an
  enterprise's vault grants are not written by it.)
- **`finance.fn_can_move_wallet_funds(wallet_id)`** → boolean — strictly narrower than
  `fn_can_view_wallet`. Personal wallet → owner only; shared wallet → the `spend` capability (which
  admits admin via `fn_has_vault_capability`).

## 🧪 `finance.simulate_wallet_transaction` — the developer money simulator (`00001210`)

```sql
finance.simulate_wallet_transaction(
    p_from_wallet_id uuid,
    p_to_wallet_id   uuid,
    p_amount_minor   bigint,
    p_currency       text,
    p_type           text
) RETURNS jsonb
-- SECURITY DEFINER, SET search_path = ''
```

> ### ⚠️⚠️ This function moves REAL money
>
> It is a debugging aid whose entire purpose is to exercise the ledger, so it writes **genuine**
> `finance.wallets` balance changes and **genuine** `finance.transactions` lines. There is no shadow
> ledger and no dry-run mode. **It is security-sensitive and needs human sign-off before the
> parameter is ever flipped on. It must stay `false` wherever real money is held.**

**Four gates, all of which must hold** (detail in [Policies.md](Policies.md)):

1. `security.platform_params.finance_simulation_enabled` is true — **seeded `false`**. This is the
   same discipline as `storage_quota_enforced` / `proposal_allowance_enforced`, _inverted_: those
   fail **open** while off, this one fails **closed** while off (absent, malformed and explicit
   `false` all mean refuse).
2. `auth.uid()` is present, or `42501`.
3. `finance.fn_can_move_wallet_funds` holds on **every** wallet touched — source **and**
   destination.
4. `EXECUTE` is `authenticated` only (never `anon`; deliberately not `service_role`).

**Direction matrix** — which side of a movement a type touches is not a caller decision:

| `p_type`         | Source (debit) | Destination (credit) | `ledger_audit.action` |
| :--------------- | :------------- | :------------------- | :-------------------- |
| `escrow_lock`    | **required**   | optional             | `spend`               |
| `escrow_release` | optional       | **required**         | `add_funds`           |
| `platform_fee`   | **required**   | optional             | `spend`               |
| `split_payout`   | **required**   | **required**         | `distribute`          |
| `top_up`         | optional       | **required**         | `add_funds`           |
| `refund`         | optional       | **required**         | `add_funds`           |

Any other `p_type` raises. At least one wallet must be supplied; the two must differ; both rows are
locked `FOR UPDATE` in id order so concurrent calls cannot deadlock.

**It never converts currency.** Both wallets must already be in `p_currency` or the call is refused
— a simulator that silently applied an FX rate would make the numbers it exists to explain
unexplainable.

**Simulated lines are identifiable.** `transactions.reason` is always `simulated_<type>` and
`ref_table` is always `'simulation'`, plus one `finance.ledger_audit` row per wallet touched. An
environment where the switch was flipped on can therefore be **audited**, not merely suspected.

Insufficient funds are checked explicitly (`23514` with the two figures in the message) rather than
left to the `balance_cents >= 0` CHECK, so the caller gets a legible refusal.

**Return shape** (`jsonb`; `from`/`to` are `null` when that side was not touched):

```jsonc
{
	"simulated": true,
	"type": "split_payout",
	"amount_minor": 25000,
	"currency": "GBP",
	"executed_at": "2026-08-05T12:00:00Z",
	"from": {
		"wallet_id": "…",
		"owner_type": "business",
		"owner_id": "…",
		"currency": "GBP",
		"balance_before_cents": 100000,
		"balance_after_cents": 75000,
		"transaction_id": "…"
	},
	"to": { "…": "same shape" }
}
```

## 🛒 Commerce doors (`00001210`)

The checkout reads and writes facts that live on tables with four different read postures —
`org.business_profiles` has no client SELECT policy at all, and `finance.promo_codes` is definer-only
because it is the platform's whole marketing book. Rather than read them with the service-role key,
the web server goes through five `SECURITY DEFINER` doors, each of which re-authorises the caller
itself and answers for nothing it was not asked about. `EXECUTE` is `authenticated` only
([Policies.md § Function privileges](Policies.md#-function-privileges-2026-09-23)).

### `finance.get_purchase_owner(p_owner_type, p_owner_id)` → jsonb · `finance.list_purchase_owners()` → jsonb

The checkout identity of one purchase owner, and every identity the caller may buy or bill as
(themselves first, then each team, business and enterprise they own or are an **active** member
of). Both return the one shape the internal builder `finance.fn_purchase_owner_json` produces, so the
application maps it once:

`owner_type · owner_id · name · handle · avatar_bucket · avatar_path · is_member · can_spend ·
kyb_status · currency · invoicing_mode · billing_day · billing · person · departments`

`get_purchase_owner` (plpgsql, because the resolver lives in a later file) adds **`platform_fee_bp`**:
the rate a payment from this owner is charged, `fn_effective_platform_fee_bp(owner_type, owner_id)`
(a negotiated rate, else the param) — the rate `place_wallet_order` applies, so the checkout preview
and the charge cannot disagree (Decision #187). It is `NULL` unless the caller passes
`fn_owner_visible` for that owner: a negotiated rate is a commercial term, not part of the public face.

| Owner kind     | Who gets an answer                    | What a non-member sees                                   |
| :------------- | :------------------------------------ | :------------------------------------------------------- |
| `user`         | the person themselves (or admin)      | `NULL` — a person answers only about themselves          |
| `team`         | anyone                                | the public face (name, handle, avatar); no billing facts |
| `business`     | anyone                                | the public face; KYB, currency, invoicing and `billing` are `NULL` |
| `enterprise` | members only                          | `NULL` — not even that the id exists                     |

`can_spend` is `fn_can_manage_basket`, so "may pay from this account" has one answer in the schema.
`person` (first/last name, primary email, city, country) is filled for the caller's own identity only
and is what the Details form pre-fills delivery from. An anonymous caller gets `NULL` / `[]`.
`fn_purchase_owner_json` itself is callable by neither client role: it answers for whatever owner it
is handed, so only the two doors above — which pass it the caller's own context — may reach it.

### `finance.resolve_promo_code(p_code)` → jsonb

What **one** code is worth, for the signed-in buyer who typed it:
`{ found, code, label, kind, value_bp, value_minor, currency, valid, reason }`. `reason` is the
buyer-facing refusal sentence (unknown · no longer active · not active yet · expired on _date_ · fully
redeemed), decided here once so the basket and the checkout cannot word the same refusal two ways.
It never lists codes and never redeems one — `redemption_count` moves only in `place_wallet_order`.

The saving itself is computed by the application against the lines (a percent of what is left after
creator discounts; a flat saving only where every eligible line is priced in the code's currency),
because it depends on the basket, not the code.

### `finance.set_invoicing_terms(p_owner_type, p_owner_id, p_mode, p_billing_day)` → jsonb

The one door that changes `org.business_profiles.invoicing_mode` / `billing_day` (the table has no
client write policy). Business owners only; `p_mode` ∈ `per_transaction` · `intervaled_monthly`;
`p_billing_day` 1–28 or `NULL` to keep the current day. Requires `manage_billing` via
`fn_owner_capability` and an `active` business (`55000 business_not_active`, BB5); the monthly mode
additionally requires the business to be KYB-verified, the same gate the checkout's `invoice`
provider applies. Returns `{ invoicing_mode, billing_day }`.

### `finance.place_wallet_order(p_basket_id, p_item_ids, p_currency, p_units, p_promo_code, p_idempotency_key)` → jsonb

**Age gate:** a caller under 18 is refused `PM403` right after the sign-in check (`org.fn_assert_adult`, Decision #190) —
which covers `finance.place_on_account_order`, which pays through this function.

Pays for the submitted basket lines from the caller's Projective wallet, in **one transaction**:

1. **Idempotency first.** An order already carrying `p_idempotency_key` is returned with
   `replayed: true` and nothing is charged. A key belonging to an order the caller cannot see is
   refused (`42501`).
2. **The basket** is locked `FOR UPDATE`; the caller needs `fn_can_manage_basket`; for a business
   basket the caller must also hold the workspace `purchase` capability (`org.fn_member_can`; `PK403`
   `missing_permission: purchase`, BB2 — `finance.place_on_account_order` asks the same right after its
   own `fn_can_manage_basket`), since vault `spend` says whose money may move, not who may buy; a
   business payer must be `active` (`55000 business_not_active`, BB5); a business or
   enterprise payer must be KYB-verified (`PK403`) — refused before re-pricing; the spend gate in
   step 6 re-asserts both.
3. **The lines are exactly the submitted ones** — live, selected, not parked, not purchased — or the
   call refuses (`PC409`). A basket changed in another tab cannot widen or narrow the charge.
4. **Every line is re-priced from the catalogue.** Digital products, and **one-ticket project lines**
   (Decision #166, below); every other kind is `PS501` (a whole project, a service or a session
   escrows against something a basket line does not carry). For a product the listing must still be published; its currency must be `p_currency`; it
   needs a delivery address (`PD422`); a buyer cannot buy their own listing (`PU422`); and
   `p_units ->> line_id` — the unit price the buyer was **shown**, in the listing's own currency — must
   equal the catalogue price now (`PC409`). The stored basket snapshot is never charged.
5. **The promo the buyer saw applied.** `p_promo_code` `NULL` → no promo, whatever code sits on the
   basket (a code the page refused applies nothing here either). Non-null → it must still be the
   basket's code, still valid, and applicable (a flat code only in its own currency) — or `PC409`.
6. **The wallet** in `p_currency` is locked (a personal owner's `user` and `freelancer` wallets are
   interchangeable) and must cover the net (`PF402`). A **business** payer then passes
   `fn_assert_business_spend(wallet, caller, net, 'baskets', basket)` once for the whole charge — KYB,
   the buyer's envelope, the threshold with the platform fallback, an approval bound to the basket
   (`PK403` / `PA403` with the `kyb_required` / `over_limit` / `needs_approval` prefix) — and its
   cover lets the ticket and revision lines hold without counting anyone again; the cover is closed
   before the order is finalised. A team or enterprise payer clears its own wallet threshold and the
   member's spending limit inline (`PA403`), unchanged.
7. **Money moves through the ledger primitives**: `fn_wallet_debit(… 'order_payment', 'orders', id)`
   on the buyer; per line, a pro-rata share of the promo (the remainder on the last line, so shares
   sum exactly), the platform fee on what was actually paid for that line — the **payer's** effective
   rate, `fn_effective_platform_fee_bp(basket owner_type, owner_id)` (a negotiated rate, else
   `platform_fee_bp` = 500), the resolver an escrow release charges through `fn_escrow_fee_bp`, and
   **truncated** (`(paid × bp) / 10000`, Decision #187) — and
   `fn_wallet_credit(… 'product_sale', 'orders', id)` of the rest to the seller — the owning team's
   wallet for a team listing, else the person's `freelancer`/`user` wallet. A seller with no wallet in
   the currency gets one first, because `fn_wallet_credit` refuses a missing wallet (`PW404`).
8. **The record**: `finance.orders` (status `confirmed`, provider `wallet`, reference
   `PJ-YYYY-XXXXXX`, `platform_fee_minor` the summed per-line fees, `platform_fee_bp` the rate
   charged), one `finance.order_lines` row per
   line (fulfilment `download`, the first manifest entry's name, size and format, the licence), each
   basket line stamped `purchased_at`, the basket's promo cleared, the code's `redemption_count`
   incremented when it saved anything.

Returns `{ order_id, reference, status, charged_minor, currency, replayed }` — the charge in the
currency the wallet actually moved, never re-converted.

**Ticket lines (Decision #166).** A `project_ticket` / `one_off_project` / `one_off_task` line that
carries `ticket_id` is not a sale. It is priced from the ticket NOW (`COALESCE(ticket.unit_price_cents,
stage.unit_price_cents)`, compared with `p_units` like any line), its ticket must still belong to the
line's project and stage (`PC409` "moved"), and the basket's owner must be the project's client — its
business, or its owner as an individual (`PU422`). It settles by **`projects.fund_ticket`** in step 7:
that one ticket's escrow is held from the same wallet (`escrow_hold`), so the `order_payment` debit is
only the products' share (`v_net − v_escrow_total`) and no seller is credited and no fee is taken (the
fee is charged at release). Its `order_lines` row is `fulfilment = 'engagement'` with `stage_id` and
`ticket_id`. `fund_ticket`'s gates (description, unpaid, payee, wallet) refuse the whole order. A promo
on an order with a ticket line is `PC409` — an escrow is the freelancer's whole price. A card checkout
reaches here through the #153 webhook exactly as a product order does.

**Paid revision lines (Decision #167).** A `paid_revision` line (its `item_id` is the
`projects.stage_revision_requests` round) settles the same way: priced from the round's snapshotted
`price_cents` (compared with `p_units`), refused unless the round is still `awaiting_payment` (`PC409`)
and the basket's owner is the project's client (`PU422`), added to `v_escrow_total` so the wallet pays
it once, and settled in step 7 by **`projects.fund_paid_revision`** — the round's escrow is held on its
ticket and the round opens. Its order line is `item_type = 'paid_revision'`, `fulfilment =
'engagement'`. The same promo refusal applies.

| SQLSTATE | Meaning                                        | Checkout blocker        |
| :------- | :--------------------------------------------- | :---------------------- |
| `42501`  | not signed in / may not spend / key not yours  | `not_authorised`        |
| `PK403`  | the paying business is not KYB-verified        | `verification_required` |
| `PB404`  | the basket no longer exists                    | `price_changed`         |
| `PC409`  | the basket, a price or the promo changed       | `price_changed`         |
| `PD422`  | a line needs a delivery address                | `missing_email`         |
| `PU422`  | the buyer's own listing; a ticket not purchasable (no description, no payee) or not this account's | `unavailable_item` |
| `PS501`  | a line the wallet cannot settle here           | `no_provider`           |
| `PF402`  | no wallet in the currency, or not enough in it | `insufficient_funds`    |
| `PA403`  | approval threshold or spending limit           | `spend_limit`           |
| `PM403`  | the buyer is under 18 (Decision #190)          | `not_authorised`        |
| `22023`  | a malformed attempt key                        | —                       |

> **Flagged, not decided.** The fee is retained rather than credited anywhere, because the platform's Fee Collection
> wallet is not materialised (#54(i)). A sale credits the seller through the 7-day pending window
> (`fn_wallet_credit_pending`, keyed to the order — Decision #191), so it reaches their Available
> balance only when it clears.

## 💸 Wallet movements (`00001210` §12)

The `/wallet` surface's money moves that need **no external processor**. Top-ups, withdrawals,
recurring deposits, adding a payment method and the Income Smoother all need a payment or payout
processor and are deliberately not here — the application refuses them with that reason rather than
recording money that did not move. The card top-up and card escrow lock now exist at the database
and API layer ([💳 Stripe fiat rails](#-stripe-fiat-rails-00001230-decision-125)); the wallet UI does
not call them yet, so it still refuses. Each function below is a definer because the ledger primitives it
calls (`fn_wallet_debit` / `fn_wallet_credit`) check nothing about the caller, so each authorises the
caller itself. `EXECUTE` is granted to `authenticated` only.

Transfers and distributions are **idempotent on a caller-minted attempt key** (8–120 characters,
stored in `finance.idempotency_keys` for 7 days), scoped to the caller and hashed with the request:
a repeat of the same request returns the first result with `replayed: true`; the same key sent with a
different request is refused (`22023`).

### `finance.transfer_funds(p_from_wallet, p_to_wallet, p_amount, p_note, p_idempotency_key)` → jsonb

Moves money between two of the caller's **own** wallets — their personal wallet and the vaults they
belong to — so a transfer can never be a payment to somebody else. Both rows are locked in id order
(two crossing transfers cannot deadlock). Money leaves a personal wallet only for its owner and a vault
only for a member holding `withdraw`; it lands only in the caller's own personal wallet or a vault they
are a member of (`fn_owner_visible`). Same currency only (`PX409` — a transfer is not a conversion). A
business source passes `fn_assert_business_spend(…, 'transfers', to_wallet)` — KYB (`PK403`), the
mover's envelope and the approval threshold (`PA403`); a team or enterprise vault source clears the
member's spending limit (`PA403`); the source must hold the amount (`PF402`). The ledger lines are `transfer_out` / `transfer_in`, each
pointing at the OTHER wallet (`ref_table = 'wallets'`), and a vault on either side gets a
`finance.ledger_audit` row carrying the note. Returns `{ amount_minor, currency, from_wallet,
to_wallet, replayed }`.

### `finance.distribute_vault(p_wallet, p_amount, p_idempotency_key)` → jsonb

Pays part of a **team** vault out to its active members by their agreed stakes
(`finance.contribution_agreements.percent_bp`) — a held stake is paid like any other (`held` only
protects it from the split rebalancer). Each share is floored to the minor unit; whatever does not
divide, and any stake the agreement leaves unallocated, stays in the vault, which is debited by exactly
what was paid. Needs `distribute`; the vault must hold the amount (`PF402`); a team with no agreed
split is refused (`PD422`). A member with no wallet in the vault's currency gets one first (the credit
primitive refuses a missing wallet, `PW404`). Every line carries `reason = 'team_distribution'`
and the distribution's id; the audit row records the requested amount and each share. Returns
`{ distribution_id, distributed_minor, requested_minor, currency, shares[], replayed }`.

### `finance.decide_spend_approval(p_approval, p_decision)` → jsonb

Approves or rejects a pending over-cap `finance.spend_approvals` request. The decider needs
**`approve_spend`** on the account (the workspace capability of the same name, projected onto the
vault; `manage_members` still implies it — changed 2026-09-28 from `manage_members`, which is the
owner-level grant that also carries `withdraw`, so making someone an approver that way would have
let them empty the pool) and may not be the requester — approving one's own over-cap spend would make
the cap decorative (`42501`). A request already decided is `PC409` — "already been spent" for a
consumed one, "has expired" for an expired one, "was withdrawn" for one its requester took back
(`finance.withdraw_spend_approval`, Decision #246), so none can be re-decided; one past its
`expires_at` is marked `expired` instead of decided (expiry is applied lazily, at the next decision
attempt — no sweep marks it). Approving moves no money: the charge for the request's ref spends it
through `finance.fn_redeem_spend_approval`. The one exception acted on at once is an approved
`tickets` request, which retries the business's auto-fund queue (`finance.fn_auto_fund_drain`), whose
hold redeems it. A decision notifies the requester through `comms.fn_notify` (`spend.approved` /
`spend.rejected` — both now registered in the catalog, `00005010`). Returns `{ id, status }`.

| SQLSTATE | Meaning                                                  |
| :------- | :------------------------------------------------------- |
| `42501`  | not signed in, or not allowed on that wallet / request   |
| `22023`  | bad amount, wallet pair, decision or attempt key         |
| `PB404`  | the wallet or request no longer exists                   |
| `PX409`  | the two wallets hold different currencies               |
| `PK403`  | the paying business is not KYB-verified                  |
| `PA403`  | over the member's spending limit, or (business) at/above the approval threshold with no approval |
| `PF402`  | the wallet doesn't hold enough                           |
| `PD422`  | the team has no agreed split                             |
| `PC409`  | the spend request was already decided, spent, expired or withdrawn |

> **Flagged, not decided.** A distribution follows the stakes as agreed, with no platform fee and no
> vault retention taken at distribution time — the documented 5% fee → vault cut → stakes model
> (finance-model §5) applies when income ARRIVES. Since 2026-09-28 the release DOES apply it:
> `fn_split_team_payout` runs `fn_team_split_plan` (vault cut, finder's fee, stakes, dust to the
> vault), and `preview_team_split` shows the same plan. What remains open is only whether a later
> manual `distribute_vault` should re-apply a vault cut to money that already paid one on arrival.

### `finance.fn_redeem_spend_approval(p_wallet, p_actor, p_amount, p_ref_table, p_ref_id, p_consume = true)` → boolean

The only way an approval lets money move (BUSINESSES_AUDIT BF20 / §4.3). Called by the spend gate
`finance.fn_assert_business_spend` on its over-cap and threshold paths, inside the transaction that
moves the money, and by `finance.fn_auto_fund_drain` as a check (`p_consume = false`). It picks the
smallest `approved`, unexpired, unconsumed request for this wallet and this exact
`(ref_table, ref_id)` whose `amount_cents` covers `p_amount` (same currency as the wallet), filed by
`p_actor` — or by anyone for a `tickets` ref, which automatic holds fund as the project owner — locks
it `FOR UPDATE` and stamps `consumed_at` + `consumed_ref_table`/`consumed_ref_id`; returns `true`.
`p_consume = false` only checks (a card payment's pre-check; the settle re-runs the gate and spends).
Otherwise raises `PA403` `needs_approval: …` with `DETAIL` = jsonb `{wallet_id, ref_table, ref_id,
amount_minor, threshold_minor}`, so the app can offer "Request approval" bound to exactly that ref.
Definer, `search_path = ''`; revoked from `PUBLIC`, `anon` and `authenticated` (`00002510`). Probe:
`supabase/probes/spend_approval_redemption.sql`.

### `finance.fn_auto_fund_drain(p_wallet_id)` → integer (`00001250`)

Retries a business wallet's From-wallet queue oldest first while the wallet covers the next ticket,
holding each as its project owner. A ticket at/above `finance.fn_business_threshold` is checked
against the redeemer (`p_consume = false`); a hold refused `PF402` whose `DETAIL.reason` is
`spending_limit` or `needs_approval` also asks. Asking files one `tickets` request as the project
owner (a stale `pending` one past its expiry is closed first) and notifies every other
`approve_spend` holder; the ticket stays queued. The threshold binds the owner too — the former
"owner holds `approve_spend`" shortcut and the reuse of any approved row for the ticket are gone: the
hold's spend gate redeems the approval exactly once. Never raises.

---

## 🏢 Workspace money governance (`00001210` §13)

The write side of the `/teams` and `/businesses` Money modules (root `CLAUDE.md` §8 Decision #122).
Authority is the WORKSPACE capability `manage_finances` (`org.fn_member_can`) — the same answer the
console renders from — and the vault projection the money functions enforce is re-synced after every
change. All four are `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` to `authenticated` only
(`00002510`), and raise `22023 '<field>: <reason>'` for a bad input (the workspace refusal convention,
[`../org/Functions.md`](../org/Functions.md#-the-workspace-console-00001020)).

### `finance.save_team_split(p_team_id, p_stakes)` → `{team_id, total_bp}`

Replaces a team's split WHOLE. `p_stakes` is `[{member_id, share_bp, held}]` over ACTIVE members
(member ids, not user ids), each share a whole number of bp in 0–10000, no member twice, and the set
must total exactly 10000 (`stakes: the split must total 100% (it is over/under by N%)`). The whole set
is validated before anything is written; then every agreement row of the team goes to 0 and the listed
members are written to their share — an active member left out is 0, a departed member zeroed,
nothing deleted. Needs `manage_finances`. Audits `team.split_changed`.

### `finance.save_split_rule(p_team_id, p_rule_type, p_vault_bp, p_finder_user_id DEFAULT NULL, p_finder_bp DEFAULT NULL)` → uuid

The team's split **template** (Decision #228 (F)), the `finance.split_rules` row that
`fn_team_split_plan` applies before the stakes. It is the table's only writer. `SECURITY DEFINER`,
`search_path = ''`, granted to `authenticated`. It refuses, in this order:

- `42501 auth:` when signed out. `P0002 workspace: not found` for an unknown team.
- `42501 rule:` without `manage_finances`. `55000 workspace:` when the team is archived.
- `22023 rule_type:` when no template is named.
- `PK402 entitlement:` when the team's plan lacks the template's flag. The flag is
  `fn_has_entitlement('team', team, 'split_template_' || rule_type)`; HINT names the missing key, and
  it maps to 402 in the app. Team Free unlocks co_op only, Pro Team all three (Decision #226 (d)).
- `22023 vault_bp:` outside 0–10000. benevolent_dictator ignores `p_vault_bp` and stores 10000,
  the figure the plan reports for it.
- finders_fee only: `22023 finder_user_id:` unless the finder is an **active** member;
  `22023 finder_bp:` for a cut below 1 bp, or when `finder_bp + vault_bp` exceeds 10000.
- co_op and benevolent_dictator only: `22023 finder_user_id:` / `finder_bp:` when a finder field is
  set.

Under `pg_advisory_xact_lock(hashtext('split:' || team))` it retires the active row
(`active = false`, kept — never deleted) and inserts the new row active, so
`uq_split_rules_team_active` holds one. It audits `team.split_rule_changed` (metadata: `rule_id`,
`previous_rule_id`, the cuts) and returns the new rule's id. `POST /api/workspace/payout` calls it
before `save_team_split` when the request carries a `rule`. Probe: `supabase/probes/save_split_rule.sql`.

### `finance.preview_team_split(p_team_id)` → jsonb

What the team's NEXT release will pay, by `fn_team_split_plan`. Any active member may read it. The
honest gross is the team's **oldest escrow still held** (principal + deadline bonus); the fee is that
escrow's payer's rate, `fn_escrow_fee_bp(payer_business_id, payer_user_id)` (so a negotiated rate
shows), on the principal, truncated — exactly what `fn_release_ticket_escrow` will charge (Decision
#187). A team with nothing held has no projection — `gross_minor`, `currency`, `fee_minor` and
`fee_bp` are `NULL` (never an invented figure) and the plan is the zero plan. Returns
`{escrow_id?, gross_minor, currency, fee_minor, fee_bp, plan}`.

### `finance.save_spend_policy(p_business_id, p_patch)` → `{business_id, currency}`

A business's spend policy as a PATCH (a key present is a change, so absent ≠ null). Needs
`manage_finances`. Keys:

| Key                        | Effect                                                                                                                                                               |
| :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `currency`                 | Which of the business's wallets the threshold and limits apply to (default: its `default_currency`). The wallet is created if missing (`fn_ensure_wallet`).         |
| `approval_threshold_minor` | `finance.wallets.approval_threshold_cents`. `NULL` disables it; `0` is refused ("every spend needs a second approver" is a per-transaction ceiling of 0 instead). |
| `approver_ids`             | The member ids who hold `approve_spend` — everyone else does not.                                                                                                     |
| `contributor_ids`          | The member ids who hold `contribute_funds` — everyone else does not.                                                                                                  |
| `limits`                   | `[{member_id, can_spend?, limit_minor?, per_transaction_minor?, period?}]` — each entry is itself a patch (a key present is a change, so an editor sends only what moved; restating a stored ceiling is a ceiling being SET). `can_spend` moves the `spend_funds` override; the limits and `period` upsert `finance.spending_limits`. |

Every per-member change obeys the member drawer's rules: never the caller's own row, never the
owner's (both are fixed points, not members of the lists), only someone the caller **outranks**, and
never a capability the caller does not hold. Capability moves go through
`org.fn_set_member_capability`, so "can spend" has one representation. Re-projects the whole vault;
audits `business.spend_policy_changed`.

**`period`** (BU2, Decision #246) is `weekly` · `monthly` · `total` (`22023 limits: a period is weekly,
monthly or total`). Changing it **carries over** what the current window counted — never a reset of
what has been spent — unless that window has already lapsed (then nothing carries), and restarts the
window at the new period's next boundary (`date_trunc('week'|'month', now())` + one period; `NULL` for
`total`), the boundary `fn_check_spending_limit` itself uses. A new row takes the period given (default
`monthly`).

**Business Pro** (`pooled_wallet_full`, `PK402`) is asserted only for what SETS a ceiling: a non-null
`approval_threshold_minor`, `limit_minor` or `per_transaction_minor`, or a period change on a row that
keeps a non-null cap. `can_spend`, a cleared ceiling and a period on a member with no cap never are.

### `finance.preview_spend_envelope(p_business_id, p_patch)` → `{currency, limits}`

Read-only (`STABLE`): the envelopes a `save_spend_policy` patch WOULD produce, so the Spend editor
never renders a draft ceiling against the stored figures it is about to replace (BUSINESSES_AUDIT
BD2). Same authority (`manage_finances`, else `42501 policy:`) and the same limit validation (`22023
limits:` — an inactive member, a negative limit, a period other than weekly · monthly · total); the
rank rules stay the save's to refuse. The
wallet is looked up, never created — a currency with no wallet yet has spent nothing. `limits` is
`fn_business_envelopes` with the patch applied. Backs `POST /api/workspace/spend/preview`.

### `finance.fn_business_envelopes(p_business, p_wallet, p_patch DEFAULT NULL)` → `jsonb` (internal)

Every active member's envelope on one business wallet, highest rank first: `member_id`, `user_id`,
`can_spend` (effective `spend_funds`), `limit_minor`, `per_transaction_minor`, `period`, `spent_minor`
— what `fn_check_spending_limit` would count now (0 once a weekly / monthly period rolled) —
`remaining_minor` (cap − spent, never below 0; `NULL` without a cap) and `used_fraction` (0–1, 4 dp; 0
without a cap). Narrowed to the caller's own unless `fn_reads_wallet_envelopes(p_wallet)` (with no
wallet yet: `manage_finances` or `approve_spend`). A patch's `limits` entries replace the keys they
carry — `period` included, priced against the current window's spend, which a period change carries
over (Decision #246). The ONE envelope reader behind `org.get_workspace_detail` and `preview_spend_envelope`, so the
console and the draft cannot disagree. Not executable by clients.

### `finance.get_billing_settings(p_business_id)` → `jsonb | NULL`

The Billing module's settings for whoever may see the business's finances (`fn_owner_visible`; `NULL`
for anyone else): `currency`, `invoicing_mode`, `billing_day`, `kyb_verified`, `auto_fund_mode`,
`low_balance_floor_cents`, `can_manage` (vault `manage_billing`), `can_pay` — `manage_billing`, KYB
verified and an `active` business, the same conditions as `org.get_workspace_detail`'s
`viewer_can.pay_invoice` (BUSINESSES_AUDIT BD15) — and `plan_allows_monthly`: whether monthly
invoicing is open to the business under the Business Pro gate, by `fn_assert_business_entitlement`'s
own rule (`NOT fn_business_plan_gates_enforced() OR fn_business_gate_flag(business,
'intervaled_invoicing')`, Decision #230 (e)); the `x-pj-dev-plan-gates` header can only make it
stricter. The Billing module reads it to say "That's part of Business Pro" before a Save that
`set_invoicing_terms` would refuse with `PK402` (BU3, Decision #247). `finance.pay_invoice` checks
the same three, in this order — `manage_billing` (`42501`), an `active` business (`55000
business_not_active`) and KYB (`PK403 kyb_required:`, DETAIL `{invoice_id, business_id}`) — then that
something is due (`PC409`) and that the wallet in the invoice's currency covers it (`PF402`). Settling
an invoice is not a spend: no envelope or approval threshold is read (Decision #240 leaves invoices
out of the gate). Decision #247 (h); probe `supabase/probes/business_billing_screen.sql`.

### `finance.request_spend_approval(p_wallet, p_amount, p_reason, p_ref_table, p_ref_id)` → `{id, status}`

Asks for approval of a spend the caller's envelope does not cover. The wallet must be a **business**
wallet (`P0002` otherwise — a team never holds `approve_spend` for anyone to decide with, BF44); the
caller needs the `spend` vault capability; `p_amount > 0`; a reason of 1–400 characters. The ref is
**required** (`22023 refTable:`): `p_ref_table` ∈ `baskets` · `tickets` · `project_stages` ·
`revisions` · `invoices` · `transfers`, and `p_ref_id` must name a row this business pays for — its
own basket; a ticket, stage or revision round on a project it is the client of; an invoice issued to
it; or, for `transfers`, another wallet (`22023 refId:`). One open request per `(wallet, ref)`: a
`pending` one past its expiry is marked `expired` first, and a live one refuses a second (`PC409
refId:`, backed by `uq_spend_approvals_pending_ref`). The request must **genuinely need approval** —
the SQL twin of `@projective/types/workspace` `evaluateSpend`: over the per-transaction ceiling, over
the remaining cap (a lapsed period counts as nothing spent), or at/above
`finance.fn_business_threshold` — else `22023` ("within your limits and needs no approval"). The
`expires_at` bounds the whole request, deciding and spending included. The currency is the wallet's and `expires_at = now() + 7 days` — both the server's, never
the caller's. Every other member holding `approve_spend` (or `manage_members`) on the wallet is
notified with `spend_approval.requested`.

It is the ONLY way a request is filed: the client INSERT policy (`"Request a spend approval"`,
`00002013`) and the `INSERT` table grant to `authenticated` (`00002520`) were removed with it, so a
direct PostgREST insert is refused and cannot skip the needs-approval check or choose its own
`currency` and `expires_at`.

### `finance.withdraw_spend_approval(p_approval)` → `{id, status}`

The requester takes back their own **pending** request (BU2, Decision #246 — closes #243 flag (k)).
`VOLATILE SECURITY DEFINER`, `search_path = ''`; the row is locked `FOR UPDATE`. It becomes
`withdrawn`: terminal, `decided_at` stamped as the moment it left `pending`, `approver_user_id` left
`NULL` (CHECK `spend_approvals_withdrawn_check`) — so it is never decided (`decide_spend_approval`
refuses `PC409`) or redeemed (`fn_redeem_spend_approval` takes only `approved`), and its ref holds no
open request any more: the checkout offers Request approval again (`live-buyer.latestRequest` — a
withdrawn NEWEST request leaves no history to show, so an older declined or expired request is not read
back as the answer; an approval that still covers the charge is still spent first).
A request already past its expiry is marked `expired` instead, as a decision would, and answers
`{status: 'expired'}`. Audited as `business.spend_request_withdrawn` (`{wallet_id, ref_table, ref_id,
amount_minor}`). Moves no money; the approvers' earlier `spend_approval.requested` notifications are
not retracted (Decision #246 flag). Granted to `authenticated` only. Backs `POST
/api/workspace/spend-withdraw`.

| SQLSTATE | Meaning                                                              |
| :------- | :------------------------------------------------------------------- |
| `42501`  | not signed in (`auth:`), or not the member who filed it (`request:`) |
| `PB404`  | no such request (`request: not found`)                               |
| `PC409`  | already withdrawn, or already decided / expired                      |

### `finance.fn_spend_ref(p_ref_table, p_ref_id)` → `jsonb` (internal)

What a spend request is for, read for `org.get_workspace_detail`'s request rows (BU2, Decision #246):
`baskets` → `title` (the basket's name), `item` (its first live line), `items`; `tickets` → `title`,
`project_title`, `project_slug`, `ticket_slug`; `project_stages` → `title` (the stage), `project_title`,
`project_slug`, `stage_slug`; `revisions` → `title` (the round's ticket), `stage_title`, `project_title`,
`project_slug`, `stage_slug`, `ticket_slug`; `invoices` → `invoice_type`, `period_start`, `due_at`,
`stage_title`; `transfers` → the destination wallet's `owner_type`. Every answer carries `opens`:
whether the CALLER may open that thing — a project by `projects.can_review_project` or
`projects.has_project_access` (the projects SELECT policies), a basket by `fn_owner_visible`, an
invoice by `manage_billing` — so the Spend module links only what lands. `{}` when the row is gone.
`STABLE SECURITY DEFINER`, revoked from every client role: it reads any business's rows, so only the
detail read calls it, for requests its caller may already read.

---

## 📒 The wallet ledger read (`00001210` §14, Decision #152)

The `/wallet/transactions` ledger and the `/wallet/analytics` cash flow read through these three
functions instead of pulling the most recent 1,000 lines into the web server and paging or summing
them there. All three are **`SECURITY INVOKER`**, `STABLE`, `SET search_path = ''`: they answer under
the caller's own RLS (`finance.transactions` → `fn_can_view_wallet`), so a wallet id the caller cannot
see contributes nothing rather than an error, and every joined read answers under the joined table's
own policy. Granted to `authenticated`, revoked from `PUBLIC` and `anon` (`00002510`). Zod SSOT:
`TransactionListParamsSchema` (`kinds`, `range`, `encodeLedgerCursor`/`decodeLedgerCursor`),
`LEDGER_KIND_REASONS`, `ActivityViewSchema` (`grain`, `timezone`) in `packages/types/finance/wallet.ts`.

### `finance.list_ledger(p_wallet_ids, p_limit = 41, p_after_at, p_after_id, p_direction, p_reasons, p_from, p_to, p_search, p_search_reasons, p_search_wallets)` → `SETOF finance.transactions`

One **keyset** page, newest first: every matching line strictly older than `(p_after_at, p_after_id)` —
the last line of the previous page — in `(created_at DESC, id DESC)` order, served by
`idx_transactions_wallet_created (wallet_id, created_at DESC, id DESC)` (`00004005`). A line written
while the reader scrolls cannot move a page boundary, so nothing repeats or goes missing (an offset
would). The application asks for one row more than it shows to learn whether another page exists, and
carries the position as an opaque cursor `k:<base64url("<created_at ISO>|<id>")>`; anything else
(including a pre-#152 `o:<offset>`) is read as the first page. `p_limit` is clamped to 1–201.

| Filter (all optional, ANDed) | Effect |
| :--------------------------- | :----- |
| `p_direction`                | `credit` · `debit`. |
| `p_reasons`                  | The `reason` codes of the selected line families (`LEDGER_KIND_REASONS` — the application maps families → codes). |
| `p_from` / `p_to`            | Half-open `[from, to)`. The application resolves the ruler's window on the viewer's calendar (`rangeStart`). |
| `p_search`                   | Case-insensitive literal substring (`%`, `_` and `\` escaped) over: the project title or stage name an escrow line paid for; either party of that escrow (a person's name or handle **other than the caller**, a team the caller may see, a business's public face via `finance.get_purchase_owner`); an order's reference; an order line's title (buyer-readable only). |
| `p_search_reasons`           | Reason codes whose LABELS match the words — copy the database cannot see ("release" → the release codes). |
| `p_search_wallets`           | The caller's own wallets whose owner name matches (a transfer to "Atlas Labs"). |

### `finance.ledger_flow(p_wallet_ids, p_from, p_to, p_tz = 'UTC', p_grain = 'day')` → `TABLE (bucket date, currency text, direction text, reason text, total_cents bigint, line_count integer)`

The ledger summed per **calendar bucket in the viewer's time zone** —
`date_trunc(p_grain, created_at AT TIME ZONE p_tz)::date` — grouped by origin currency (the
application converts each currency's bucket sum ONCE, the `sumOf` rounding rule), direction and reason
(folded into line families and the coarse categories by the application). `p_grain` is `day` · `week`
(ISO, Monday) · `month`; anything else is `day`. `p_tz` must be an IANA zone (the application validates
it with `Intl` and falls back to the profile zone, then UTC); an unknown zone is an error, never a
silent UTC. Summed over the whole window, so a 5-year or all-time window is no longer read through the
most recent 1,000 lines (closes Decision #123 flag (g)).

### `finance.ledger_first_at(p_wallet_ids)` → `timestamptz`

The oldest movement the caller may read across the wallets — where an "all time" window starts.
`NULL` when there is none.

---

## 💳 Stripe fiat rails (`00001230`, Decision #125)

Money entering the platform from a card, the Connect payout account a person or team is paid out
through, and Stripe Identity. The card is charged on the **platform** account (Separate Charges &
Transfers); the settled amount becomes an ordinary `topup` credit, and an escrow lock then holds the
stage's escrow FROM that wallet through `projects.fund_stage` — so there is one escrow engine, not a
card-specific second one. Every function is `SECURITY DEFINER` with `search_path = ''`.

**Two doors, told apart by who may call them.** A **user door** is `EXECUTE` to `authenticated` only
and authorises the caller through `auth.uid()`; it can open, bind or abandon an attempt but can never
say that money arrived. A **processor door** is `EXECUTE` to `service_role` only and is reached
solely from the signed webhook (`/api/finance/webhooks/stripe`, after `constructEventAsync` has
verified the signature) — so a client can neither credit a wallet nor verify its own identity. The
three internal helpers are executable by no role at all (`00002510`).

**Every processor door is idempotent on the Stripe event id.** It first claims `stripe:<evt_id>` in
`finance.idempotency_keys` (`fn_claim_stripe_event`) in the same transaction as its effect, so a
redelivered event returns the first outcome (`fn_stripe_event_replay`) and moves nothing. Each returns
`{ outcome, detail?, … }` with `outcome` ∈ `applied` · `replayed` · `unmatched` · `ignored`; an
`unmatched` event (no row bound to it, or amounts that disagree) is recorded for reconciliation and
never guessed at — except a card SETTLEMENT, which is acknowledged only with its ledger row
(Decision #200): an unmatched `payment_intent.succeeded` releases its claim
(`fn_release_stripe_event`) so Stripe's retry is processed, and the webhook answers 5xx. The one
settlement acknowledged WITHOUT a ledger row is a deterministic mismatch (amount / currency that can
never match the payment): it is completed with `reconciliation = 'settlement_mismatch'`, the webhook
answers 2xx, and a human reconciles it from `finance.v_ops_unledgered_payments` (see
`settle_card_payment` below).

### Event bookkeeping (internal)

| Function                                          | Returns | What it does                                                                                                           |
| :------------------------------------------------ | :------ | :--------------------------------------------------------------------------------------------------------------------- |
| `finance.fn_claim_stripe_event(event_id, type)`   | boolean | Inserts `stripe:<event_id>` (scope `stripe.webhook`, expiring in 30 days); `false` when the event was already claimed. |
| `finance.fn_complete_stripe_event(event_id, out)` | jsonb   | Stores the outcome on the claimed key and returns it.                                                                  |
| `finance.fn_stripe_event_replay(event_id)`        | jsonb   | The stored outcome with `outcome = 'replayed'`. `LANGUAGE sql`.                                                        |
| `finance.fn_release_stripe_event(event_id)`       | void    | Deletes the `stripe:<event_id>` claim (scope `stripe.webhook`) so the next delivery is processed, not replayed (Decision #200). |

### Card payments — user doors

#### `finance.begin_card_payment(p_purpose, p_wallet_id, p_project_id, p_stage_id, p_expected_amount, p_currency, p_idempotency_key, p_ticket_id DEFAULT NULL, p_revision_id DEFAULT NULL)` → jsonb

**Age gate:** a caller under 18 is refused `PM403` for either purpose (`org.fn_assert_adult`, Decision #190).

Opens (or replays) one `finance.inbound_payments` row and registers the attempt key
(`card_payment:<uid>`, 7 days, hashed with the request — the same key with a different request is
`22023`, a key still in flight for another request is `PX409`). A repeat of the same request returns
the existing row with `replayed: true`.

- **`wallet_topup`** — the caller's own wallet or a vault they may `add_funds` to; the currency must be
  the wallet's; the amount is the caller's.
- **`escrow_lock`** — the caller must pass `projects.fn_can_fund_project`, the funder predicate
  `fund_stage` asks (`PK403 not_funder`, BB2; it replaced a `has_project_access` + payer check); the
  amount is **never the caller's**: it is `projects.fn_stage_funding_need`'s
  `amount_cents` — every ticket in the stage that is `unpaid`/`needs_funding`, not finished and with
  no held escrow, **claimed or not**, at `COALESCE(ticket.unit_price_cents, stage.unit_price_cents)` —
  the one definition `projects.fund_stage` holds by (Decision #197). A stage with any unpriced ticket
  is refused **here**, `PC409`, before anything is charged (before #197 the intent skipped it and
  `fund_stage` then refused the settled money, which stayed in the wallet). `p_expected_amount` is
  only a check: if the stage was re-priced since the payer looked, `PC409` says what it costs now. The
  caller needs project access and the `spend` capability on the client business's wallet, or is the
  owner of a project with no client business (created on demand); the stage must be `open`,
  `assigned` or `in_progress`; `p_wallet_id` must be NULL (the money is paid into the payer's wallet).
- **`escrow_lock` with `p_ticket_id`** (Decision #166) — funds ONE ticket instead: the amount is that
  ticket's `COALESCE(unit_price_cents, stage.unit_price_cents)`, and `projects.fund_ticket`'s gates are
  checked now (the ticket sits in `p_stage_id`, has a description, is `unpaid`/`needs_funding` with no
  held escrow, and the stage is not finished; each `PC409` — an unclaimed ticket is held prepaid, #197), so
  nobody is charged for a hold that cannot be made. The stage may be in any unfinished status. The row
  records `ticket_id`; the stage path above is unchanged. `p_ticket_id` is part of the request hash
  (NULLs are skipped, so an older stage or top-up attempt key hashes as before).
- **`escrow_lock` with `p_revision_id`** (Decision #199) — pays for ONE paid revision round instead:
  the amount is the round's `price_cents`, and `projects.fund_paid_revision`'s gates are checked now —
  the round sits in `p_stage_id` of `p_project_id` (`P0002`), is `awaiting_payment`, its submission is
  still `pending_review`, its price is still the stage's `extra_revision_price_cents`, and the ticket
  has a payee (assignee or accepted team seat), each `PC409`. `p_ticket_id` must be NULL (`22023`).
  The payer rule and currency check are the stage path's. The row records `revision_id`;
  `p_revision_id` joins the request hash the same way.

#### `finance.attach_card_payment(p_payment_id, p_provider_ref)` → jsonb

Binds the PaymentIntent id (`^pi_…`) to the caller's own payment, write-once — a second, different id
is `PX409`, the same id again is a no-op.

#### `finance.abandon_card_payment(p_payment_id, p_reason)` → jsonb

Closes an attempt Stripe refused to create (`canceled`, and a lock `failed`). Only an unbound
`requires_payment` row is touched; anything else is returned unchanged, so it can never cancel a
payment that is already in Stripe's hands.

#### `finance.attach_checkout_order(p_payment_id, p_checkout)` → jsonb

Names the checkout a started card / express top-up pays for (Decision #153), so settlement can place
the order even if the payer's browser never returns. The caller must be the payer (anything else is
answered as missing, `P0002`), the payment a still-unpaid `wallet_topup`, the checkout's currency the
payment's, and the caller able to spend from the basket NOW (`finance.fn_can_manage_basket`, the guard
`place_wallet_order` applies). `p_checkout` needs `basket_id`, `item_ids` (non-empty), `currency`,
`units` and an `order_key` of 8–120 characters; it is stored normalised. **Write-once:** the same
checkout again is a no-op, a different one is `PX409` — one payment paying for two orders is the case
this exists to prevent. Prices nothing: the units and promo are re-checked against the catalogue when
`place_wallet_order` runs. Executable by `authenticated` only.

### Card payments — processor doors

#### `finance.settle_card_payment(p_event_id, p_provider_ref, p_amount_received, p_currency, p_livemode)` → jsonb

`payment_intent.succeeded`. Credits `p_amount_received` — what arrived, not what was asked for — to
the row's wallet (`reason = 'topup'`, `ref_table = 'inbound_payments'`), marks the row `succeeded`
and links the ledger line. A `wallet_topup` of a shared (team · business · enterprise) wallet also
writes its contribution in the same transaction, exactly as `transfer_funds` does: a
`finance.ledger_audit` row, action `add_funds`, actor the payer (`created_by`), amount what arrived,
`ref_table = 'inbound_payments'`, metadata `{kind: 'card_topup'}` — so the contribution ledger never
misses card money (BUSINESSES_AUDIT BF25; probe `business_vault_alignment.sql` §1). A settlement in another currency, or of nothing, is `unmatched`, not a
credit. For an `escrow_lock` it then runs `projects.fund_stage` **as the payer who authorised it**
(`request.jwt.claim.sub` set to `created_by` for the call, restored after), inside a subtransaction:
the lock re-checks that person's access and spend right NOW, and a refusal rolls back only the lock —
the money stays in the wallet and `lock_error` says why. A short arrival fails the lock the same way.
The escrows it created are recorded in `locked_escrow_ids`. A lock that names a `ticket_id` runs
`projects.fund_ticket` instead (same claim swap and subtransaction): only that ticket's escrow is held,
`locked_escrow_ids` is that one escrow, and the stage's status does not move. A lock that names a
`revision_id` (Decision #199, checked first) runs `projects.fund_paid_revision` the same way: the round's
escrow is held, the round opens and the work is sent back. For a `wallet_topup` carrying a
`checkout` (Decision #153) it then runs `finance.place_wallet_order` **as the payer**, the same claim
swap and subtransaction, under the checkout's `order_key` — the key the browser places the same order
under, so whichever arrives second replays and exactly one order exists; a refusal rolls back only the
order, recorded in `order_error`, and the money stays in the wallet. Notifies `escrow.funded` or
`wallet.topup_succeeded` (with the lock failure, the placed order, or the order refusal spelled out).
Returns `order_id` / `order_error` beside the lock outcome.

**Always a ledger row, or loud (Decision #200).** The wallet is re-read `FOR UPDATE` and confirmed
through `finance.fn_ensure_wallet` (owner, payment currency) before the credit; a missing wallet, or a
credit that left no ledger row, raises (`PW404` / `PL404`) and rolls the whole call back with its claim.
A lock or order refused after the credit keeps the credit and sets `status = 'settled_unapplied'` with
`unapplied_reason`; the payer's notification is titled "Payment received — the funds are in your
wallet". A success with no payment bound to the intent YET (an off-session deposit's success can beat
`bind_scheduled_payment`) is `unmatched` and releases its claim instead of completing it, so the
webhook answers 5xx and Stripe's retry settles it once the bind lands. A success whose amount /
currency does NOT match the payment (another currency, or nothing received) is deterministic — every
redelivery carries the same figures — so it is acknowledged into **reconciliation** instead: the claim
is COMPLETED with `outcome = 'unmatched'`, `reconciliation = 'settlement_mismatch'`, `payment_id`,
`transaction_id = NULL`, `amount_received_cents`, `currency_received`; ONE `error` row is written to
`ops.log_entries` (`scope = 'finance.settle_card_payment'`, `client_id = 'stripe:<evt_id>'`, the
figures in `data`; guarded so nothing writes it twice) plus a WARNING; nothing is credited and the
payment stays `processing`; `finance.v_ops_unledgered_payments` lists it as `settlement_mismatch`
until a human settles or closes the payment. A redelivery of that event replays the reconciliation
outcome (still `reconciliation = 'settlement_mismatch'`) and writes nothing. A replayed event otherwise
answers with the payment's `transaction_id`; a completed claim whose payment has no ledger row and
which is NOT a reconciliation is released and processed again (the payment's own status is what stops
a second credit). Every other acknowledged outcome carries `transaction_id`, plus `status` and
`unapplied_reason`. Proven by `supabase/probes/card_settlement_ledger.sql` and
`supabase/probes/settlement_reconcile_deposit_retry.sql`; failures past this point are listed by
`finance.v_ops_unledgered_payments`.

#### `finance.record_card_payment_failure(p_event_id, p_provider_ref, p_status, p_reason, p_livemode)` → jsonb

`payment_intent.payment_failed` (`failed`) and `payment_intent.canceled` (`canceled`). Records the
state and Stripe's decline code; moves no money. A `failed` intent is **not final** — the payer may
retry it and a later success still settles — so only `canceled` ends an escrow lock. An event arriving
after the payment settled changes nothing. Notifies `wallet.topup_failed` on a failure.

### Identity (Stripe Identity)

| Function                                                                                                  | Door      | What it does                                                                                                                                                                                                                                                                                     |
| :-------------------------------------------------------------------------------------------------------- | :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.begin_identity_verification()` → jsonb                                                          | user      | Opens a `verification_cases` row (`kyc`, tier 2, `stripe_identity`, `pending`). Freelancers only (`PK403`); an already-verified person is `PX409`; at most `identity_sessions_per_day` (param, default 5) per 24 h (`PR429`). Leaves the profile's `kyc_status` alone.                          |
| `finance.attach_identity_session(p_case_id, p_session_ref)` → jsonb                                      | user      | Binds the session id (`^vs_…`) to the caller's own case, write-once (`PX409` on a different id), and mirrors it into `org.freelancer_profiles.identity_provider_ref` unless already verified.                                                                                                   |
| `finance.abandon_identity_verification(p_case_id, p_note)` → jsonb                                       | user      | Expires an unbound, still-pending case Stripe refused to open.                                                                                                                                                                                                                                   |
| `finance.apply_identity_event(p_event_id, p_event_type, p_session_ref, p_error_code, p_livemode)` → jsonb | processor | `verified` → case verified, profile `kyc_status = 'verified'`, `kyc_tier = GREATEST(tier, 2)`, `kyc_verified_at`; notifies `account.kyc_verified`. `requires_input` → case `rejected` carrying Stripe's error CODE (never the extracted data); notifies `account.kyc_rejected`. `canceled` → case `expired`. A verified case never regresses on a late or reordered event. |

### Connect payout accounts

| Function                                                                        | Door      | What it does                                                                                                                                                                                                                    |
| :------------------------------------------------------------------------------ | :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `finance.fn_payout_owner(p_scope, p_team_id)` → `TABLE(owner_type, owner_id)`   | internal  | `personal` → the caller's own payout owner (`fn_person_wallet_type`); `team` → the team, only for a member holding `manage_billing`.                                                                                            |
| `finance.payout_account_for(p_scope, p_team_id)` → jsonb                        | user      | `{ owner_type, owner_id, display_name, contact_email, account, payout_ready }` — the owner, the name Stripe's form greets them with (a person's name or the team's), the CALLER's own sign-in address (Stripe requires a contact email on a v2 recipient account; it is passed to Stripe and never stored in `finance.*`), and their active account if any.                                         |
| `finance.record_payout_account(p_scope, p_team_id, p_account_id)` → jsonb       | user      | Stores a newly created Connect account id (`^acct_…`) for that owner. An account already recorded for someone else is `PX409`; an existing active account wins, so two tabs cannot give one owner two accounts.               |
| `finance.sync_payout_account(p_account_id, p_status)` → jsonb                   | processor | Writes the status Stripe reports (`payoutAccountStatusFor()` of the `stripe_transfers` capability) and recomputes the freelancer's `payout_ready` as "has a verified account" — the flag `fn_freelancer_payout_ready` reads. |

### Transfers and disputes

#### `finance.record_transfer_created(p_event_id, p_transfer_ref, p_destination, p_amount, p_currency, p_payout_id, p_livemode)` → jsonb

`transfer.created`. Binds the Transfer id to the `finance.payouts` row its metadata names
(`projective_payout_id`) only when that payout exists, is unbound, and its amount, currency and the
destination account's owner all agree (by the same person-type rule `finance.fn_payout_destination`
chose it with: `user` and `freelancer` are one person); anything else is `unmatched`. Moves no money — the payout's own
flow owns the ledger debit. Since Decision #126 withdrawals create transfers
(`finance.begin_payout` → Stripe Transfer → `finance.complete_payout`); this event is also the
recovery path — a still-`pending` payout it binds is marked `paid`, because the transfer is the fact.
A transfer naming a payout already `failed` (its money returned) is `unmatched` and written to
`ops.log_entries` as an error, because the money then left twice (Decision #202).

#### `finance.record_dispute_opened(p_event_id, p_dispute_ref, p_provider_ref, p_amount, p_currency, p_reason, p_livemode)` → jsonb

`charge.dispute.created`. Records one `finance.chargebacks` row (deduplicated on the dispute id),
linked to the disputed payment's wallet, ledger line and — when the payment funded exactly one —
escrow, and **freezes every still-`held` escrow the payment funded** (`locked_escrow_ids` →
`disputed`), so capital a chargeback may claw back cannot be released meanwhile. Notifies
`chargeback.opened`. An unmatched dispute is still recorded, with no link. It writes no ledger line:
the outcome is `finance.record_dispute_closed`'s (Decision #126).

| SQLSTATE | Meaning (Stripe doors)                                                          |
| :------- | :------------------------------------------------------------------------------ |
| `42501`  | not signed in (`sign in …` → HTTP 401), or not allowed (→ 403)                  |
| `22023`  | a bad field, raised as `field: reason` so the route can pin it                  |
| `P0002`  | the wallet, stage, payment or verification does not exist (or is not yours)     |
| `PX409`  | an id already bound elsewhere, an attempt key in flight, or already verified    |
| `PC409`  | the stage is not ready to fund, or its price changed                            |
| `PS501`  | the project has no paying business, so a stage cannot be funded by card         |
| `PK403`  | identity checks are for freelancers                                             |
| `PR429`  | the daily identity-check limit                                                  |

## 💸 Money movement after the fiat rails (`00001240`, Decision #126)

Same two-door split as `00001230`: USER doors (`authenticated`) authorise the caller through
`auth.uid()` and can never report that money arrived or left; PROCESSOR doors (`service_role` only,
pinned by `payments.contract.test.ts`) apply what Stripe reported or the scheduler decided.

### Escrow payer + fee (`00001200`)

- `finance.fn_escrow_payer_wallet_type(payer_business_id, payer_user_id)` — `business`, or the person
  type the individual payer holds. The ONE answer the hold, every refund and the fair-exit split use.
- `finance.fn_escrow_fee_bp(payer_business_id, payer_user_id)` — the rate a release charges: the
  payer's active `finance.negotiated_rates` row via `finance.fn_effective_platform_fee_bp`, else
  `security.platform_params.platform_fee_bp` (**500 = 5 %**, Decision #2 — was seeded 0).
- `finance.fn_hold_ticket_escrow` — the payer is the client business, or the project's owner as an
  individual client. A missing payer wallet or one that cannot cover the hold is a `PF402` refusal
  (Decision #165), checked before the escrow row is written (the old body minted held money on a
  missing wallet).
- `fn_release_ticket_escrow` / `fn_fair_exit_release` — credit an individual payee to the person
  wallet they hold (created if missing); the old hard-coded `freelancer` credit vanished for a person
  holding only a `user` wallet.
- `projects.fund_stage` (`00001150`) and `finance.begin_card_payment` (`00001230`) accept an
  individual client: only the project's OWNER may fund it; the stage is checked against their wallet
  all-or-nothing (`PF402` — "pay by card instead").

### Disputes — `finance.record_dispute_closed(p_event_id, p_dispute_ref, p_status, p_livemode)` (processor)

`charge.dispute.closed`. `won` / `warning_closed` → the case is `won` and every escrow the payment funded
returns from `disputed` to `held`. `lost` → each still-frozen escrow is refunded to the payer's wallet
(`escrow_refund`, its ticket back to `unpaid`), then the disputed amount is recovered from that wallet —
first from its money still in the pending window (`fn_recover_from_pending`, Decision #191), then
debited from its Available balance (`chargeback`); what the wallet can no longer cover is
`unrecovered_cents` (never a negative balance). The outcome reports `recovered_cents` (both parts) and
`recovered_pending_cents`. Idempotent on the event and on the case. An escrow already RELEASED to the
freelancer is not clawed back from them, not even from their pending window (Decision #126 flag, kept
open by #191: only the payer's own wallet is recovered from).

### Withdrawals

- `finance.begin_payout(p_wallet_id, p_amount, p_currency, p_instant, p_idempotency_key, p_destination_method_id DEFAULT NULL)` (user) — an
  amount below the currency's minimum is `22023` (`fn_min_withdrawal_minor`, Decision #202); a named
  destination must be one of the wallet owner's ACTIVE `payout`/`both` methods (someone else's reads as
  missing, `42501`; an inactive one `PA403`) and is recorded on the payout, hashed into the attempt key
  and stamped on the transfer; the verified Connect account is recorded as `destination_account`; a
  caller under 18 is `PM403` (`org.fn_assert_adult`, Decision #190); a person wallet is self-only, a vault needs `withdraw`; a freelancer wallet needs
  `fn_freelancer_payout_ready`, a business vault `fn_business_kyb_verified` (`PK403`); a verified
  payout account (`PA403`); enough Available balance (`PF402` — money still in the pending window is
  not in `balance_cents`, so it can never be withdrawn early). Inserts a `pending` payout and DEBITS the wallet
  (`payout`) at once. Idempotent on the attempt key (scope `payout:<uid>`). No Instant fee is charged
  (its magnitude is undecided, #55(c)).
- `finance.complete_payout(p_payout_id, p_transfer_ref)` (processor) — the Transfer exists: `paid`.
- `finance.fail_payout(p_payout_id, p_reason)` (processor) — Stripe definitively refused, or the stale
  sweep found no transfer: `failed`, a `payout_reversal` credit returns the money, and a person owner is
  told (`payout.failed`). Only a `pending` payout can fail.
- `finance.record_transfer_reversed(p_event_id, p_transfer_ref, p_destination, p_amount, p_amount_reversed, p_currency, p_payout_id, p_livemode)`
  (processor, Decision #202) — `transfer.reversed`. Finds the payout by its bound transfer, else the
  metadata id; the transfer must agree with it as in `record_transfer_created`. Credits only what is
  newly reversed (`LEAST(amount_reversed, amount) − reversed_cents`, reason `payout_reversal`), so a
  replay, a duplicate or an out-of-order lower total credits nothing; a full reversal is `reversed`.
  A reversal of a payout already `failed` moves nothing and writes an `ops.log_entries` error. Person
  owners are told (`payout.reversed`). Idempotent on the event id and by value.
- `finance.record_bank_payout(p_event_id, p_event_type, p_account, p_bank_payout_ref, p_status, p_failure_code, p_transfer_refs, p_prior_payout_refs, p_livemode)`
  (processor, Decision #202) — a connected account's `payout.paid` / `payout.failed`. Records
  `bank_status` on the account owner's sent payouts among `p_transfer_refs` (the transfers the bank
  payout carried) and those already bound to a bank payout in `p_prior_payout_refs` (earlier failed
  ones it re-pays). A failure is final for its own bank payout; a later one that re-pays it marks it
  paid. Moves nothing in the ledger. Person owners are told (`payout.failed` / `payout.paid`). An
  unknown account is `unmatched`.
- `finance.fn_claim_stale_payouts(p_limit DEFAULT 25)` → jsonb (service role, Decision #202) — leases
  up to `p_limit` (≤ 200) `pending` payouts older than `payout_stale_minutes` and not claimed within it,
  oldest first, under `SKIP LOCKED` (`swept_at`, `sweep_attempts + 1`); returns each with its
  `destination_account`. `PaymentBackendService.sweepStalePayouts` then completes, re-sends or fails it.
- `finance.fn_min_withdrawal_minor(p_currency)` (internal) — `min_withdrawal_minor[currency]`, else its
  `default`, else 0. `finance.fn_minor_units_text(p_amount, p_currency)` (internal) — the minimum in
  major units for the refusal sentence.
- `finance.fn_payout_destination(wallet)` (internal) — the owner's verified Connect account.

### The pending window (`00001240` §7, Decision #191)

Earned money clears `security.platform_params.pending_release_days` (7) before it is Available
(`finance-model.md` §7). Top-ups, refunds, transfers and returned payouts are the payer's own money and
stay immediate; pending money can be neither spent nor withdrawn.

- `finance.fn_wallet_credit_pending(owner_id, owner_type, currency, amount, reason, ref_table, ref_id)`
  (internal) — the pending twin of `fn_wallet_credit`, same arguments: writes a
  `finance.pending_releases` row keyed to its source (`ref_table` must be `escrows` or `orders`,
  else `22023`) with `available_at = now() + pending_release_days`, and no ledger line. A missing
  wallet is `PW404`; a 0-day window credits at once. Called by `fn_release_ticket_escrow`
  (`escrow_release`), `fn_fair_exit_release` (`fair_exit_release`), `fn_split_team_payout`
  (`team_split` · `team_finder_fee` · `<reason>_vault_retention`), `fn_release_seat_escrow`
  (its `p_reason`) and `place_wallet_order` (`product_sale`).
- `finance.fn_mature_pending_releases(p_limit = 1000)` → integer (service role / pg_cron
  `finance-mature-pending-releases`, hourly at :05) — credits every row past `available_at` through
  `fn_wallet_credit` with its original `reason` and source reference, so a matured release reads in
  the ledger exactly as an immediate credit did; sets `state = 'available'`, `matured_at`,
  `transaction_id`. Claims rows `FOR UPDATE SKIP LOCKED`; a replay credits nothing twice. Returns the
  rows matured.
- `finance.fn_recover_from_pending(wallet_id, amount)` → bigint (internal) — takes up to `amount` from
  the wallet's pending rows, soonest-to-clear first, into `recovered_cents`; an emptied row closes with
  no credit. Used by the lost-dispute recovery above.

Proven by `supabase/probes/pending_window.sql`.

### Saved cards

- `finance.card_owner_for(p_scope, p_entity_id)` (user) — `personal`, or a team/business the caller
  holds `manage_billing` on; returns the Customer id (if any), the caller's email (for Stripe, never
  stored) and a display name.
- `finance.record_processor_customer(p_scope, p_entity_id, p_customer_ref)` (user) — one Customer per
  owner; a racing second request gets the first.
- `finance.record_saved_card(owner_type, owner_id, pm_ref, brand, last4, exp_month, exp_year, created_by,
  make_default)` (processor) — writes the funding `payment_methods` row and its `saved_cards` display
  projection, linked; idempotent on (owner, payment method); the first card becomes the default. A card
  saved to a team / business / enterprise is recorded `is_business_card = true` (Decision #153): it
  can only arrive through `card_owner_for` (manage_billing on the entity), so it is the entity's own
  instrument — without this, the business-card rule refused every card a business added at checkout.

### Recurring deposits

- `finance.create_deposit_rule(p_wallet_id, p_amount, p_currency, p_interval, p_source_method_id)` (user)
  — `add_funds` on the wallet; an ACTIVE Stripe funding card of the wallet's owner or the caller; the
  wallet's currency; first charge one interval from now; stamps `created_by`.
- `finance.claim_due_deposit_rules(p_limit)` (processor, the scheduler) — `FOR UPDATE SKIP LOCKED`;
  re-authorises the author AS THEM; records the run as an inbound payment (key =
  `deposit:<rule>:<period>`, so a period is charged once); advances past `now()` — missed periods are
  SKIPPED, never charged in a burst; a rule whose card, author or authority is gone is paused. Each
  entry is `{ payment, rule_id, customer_ref, payment_method_ref, retry }`.
  **Unbound runs are retried, not lost.** It first re-offers (`retry = true`) every scheduled payment
  an earlier sweep claimed but never bound — `deposit_rule_id` set, `status = 'requires_payment'`,
  `provider_ref IS NULL` (the processor was unreachable, its answer was lost, or the sweep died
  between claim and charge) — as the SAME payment, so the fat service re-sends it under the same
  Stripe idempotency key `scheduled_deposit:<payment id>`: Stripe answers with the intent it already
  made or makes it now, and the period is charged exactly once instead of disappearing behind the
  advanced `next_run_at`. `updated_at` is the lease: a run is re-offered only after 15 minutes
  untouched, and re-offering stamps it (`FOR UPDATE SKIP LOCKED` on the payment row). A run older than
  23 hours (Stripe keeps a key for 24) is NOT re-sent — that could charge twice — but set `failed`
  ("could not be reached … within a day") with an `ops.log_entries` `error` row
  (`scope = 'finance.claim_due_deposit_rules'`, `client_id = 'deposit:<payment id>'`, `reason =
  'unbound_expired'`) asking a human to check Stripe for an intent with that `projective_payment_id`;
  no strike is counted. A run whose rule was stopped, or whose card / author / Customer no longer
  passes, is set `canceled` with the reason and a `warn` row (`reason = 'unbound_canceled'`). Index:
  `idx_inbound_payments_unbound_deposits` (partial).
- `finance.fn_deposit_charge_target(p_rule)` (internal, executable by no role) — the rule's
  re-authorisation shared by both paths above: author checked AS THEM (`add_funds`, card ownership),
  card `active`, Stripe Customer present. Returns `(customer_ref, payment_method_ref, refusal)`, exactly
  one of `refusal` or the two refs set.
- `finance.bind_scheduled_payment(p_payment_id, p_provider_ref, p_error)` (processor) — binds the
  off-session PaymentIntent, or fails the run; three consecutive failures pause the rule. Only a
  DETERMINISTIC refusal reaches the error branch (a declined card, `authentication_required`); a
  transient Stripe / network / idempotency-in-flight error leaves the run unbound for the retry above
  (`packages/backend/services/finance/scheduled-deposits.ts`).

### Income Smoother — `finance.set_income_smoother(p_currency, p_target_monthly_cents, p_enrol)` (user)

Enrolment needs `income_smoother_min_months` distinct months of earnings in the currency and
`income_smoother_min_volume_cents` of them (`PK403` otherwise); the fee is the current
`income_smoother_fee_bp`, captured on the row. Leaving is always allowed. The smoothing DISBURSEMENT
(buffering releases, paying the monthly figure, charging the fee) is not built — so nothing deducts
the fee yet.

### Verification + checkout

- `finance.my_verification_status()` (user) — the caller's KYC (status, tier, payout readiness, latest
  case) and the KYB of every business they belong to (`business_profiles` has no client read policy).
- `finance.ensure_purchase_wallet(p_owner_type, p_owner_id, p_currency)` (user) — the wallet a CARD
  checkout tops up before paying from it (the person's own, or an entity's with `spend`); created when
  missing.
- `finance.fn_payout_owner` gained scope `business` (`manage_billing`), and `finance.sync_payout_account`
  mirrors a business's verified Connect account onto `org.business_profiles.kyb_status` /
  `kyb_verified_at` / `kyb_provider_ref` — Connect onboarding IS the Level-3 KYB check.

| SQLSTATE | Meaning (added by `00001240`)                                   |
| :------- | :-------------------------------------------------------------- |
| `PA403`  | no verified payout account for this wallet                      |
| `PF402`  | the wallet does not hold enough                                 |
| `PK403`  | an earning gate (KYC / KYB) or the Income Smoother's eligibility |

## ⚖️ Platform disputes (`00001260`, Decision #212)

A `finance.disputes` row contests ONE held escrow. Before #212 nothing ever moved one: a no-show
claim (`projects.claim_session_no_show`) opened a row, the session sweep refused to release the seat,
and no function, route or person could close it. The lifecycle is PRODUCT_MANAGEMENT §3.8; the
business rules are PRODUCT_SPEC §Dispute Resolution (the Evidence Vault, the cooling-off window, the
auditor, the session attendance audit). Distinct from a card **chargeback** (`finance.chargebacks`,
above). Grants: `00002510` `#region Disputes`. Params: `dispute_response_hours` (48),
`dispute_review_hours` (72, the review SLA), `dispute_dismiss_presence_pct` (80).

**The review SLA is a target, never a ruling** (Decision #212(c): the platform does not rule on money
without a human). Every door into `under_review` stamps `review_by = then + dispute_review_hours`; a
case past it stays held — the sweep writes an `ops.log_entries` `warn` row and tells every operator
(`dispute.review_overdue`), at most once a day per case, and moves nothing.

| Function | Door | What it does |
| :-- | :-- | :-- |
| `finance.fn_escrow_has_open_dispute(p_escrow_id)` → boolean | internal | THE live-dispute predicate (`open` · `awaiting_response` · `under_review`). Every release path asks it before paying out (`auto_release_session_escrow`'s three paths, the claim, the workspace's `claim_open`). |
| `finance.fn_dispute_context(p_dispute_id)` → TABLE | internal | The escrow's project, slug, owner (the respondent of record), the claimant and the sitting's title. |
| `finance.fn_dispute_party(p_dispute_id, p_user_id)` → text | internal | `claimant` (the opener), `respondent` (`projects.fn_is_session_host` — the owner or an active member of the owning team) or NULL. An operator is not a party. |
| `finance.fn_dispute_review_by(p_from)` → timestamptz | internal | The review SLA a case gets as it enters `under_review`: `p_from + dispute_review_hours` (72). Called by `respond_to_dispute`, `escalate_dispute` and the sweep, so `ck_disputes_review_deadline` holds. Executable by no client role. |
| `finance.fn_dispute_attendance_audit(p_dispute_id)` → jsonb | internal | The deterministic ruling on the sitting's logs: `pending` (not ended) · `refund` (`fn_session_presence` says `provider_no_show`) · `dismiss` (a tracked room shows the host AND the claimant each in the room ≥ `dispute_dismiss_presence_pct` of the sitting — webhook rows only, so a host's attestation cannot dismiss a claim against them) · `ambiguous`. Time in the room is the row's first-join → last-leave span clipped to the sitting. |
| `finance.fn_split_seat_escrow(p_escrow_id, p_bp)` → jsonb | internal | Divides one held seat escrow: the payee earns `p_bp` of the principal less the fee on that share (pending credit, `escrow_release`), the payer gets the rest fee-free (`escrow_refund`) — `fn_fair_exit_split`'s arithmetic. Only while `held`. |
| `finance.fn_settle_dispute(p_dispute_id, p_outcome, p_bp, p_actor, p_notes)` → jsonb | internal | The ONE writer of a `resolved_*` status, under the dispute's then the escrow's row lock. `release` → `fn_release_seat_escrow`, except a whole-cohort seat escrow with sittings still ahead, which stays held for the session sweep (`settlement.deferred`). `refund` → `fn_refund_seat_escrow`. `split` → `fn_split_seat_escrow`. The seat follows through `projects.fn_settle_membership_state`. An escrow already `refunded` / `released` by another path is recorded as it settled (`settlement.by_fact`); a `disputed` (chargeback-frozen) one is refused `PS409`; a non-seat escrow is refused `PS409`. Notifies both parties `dispute.resolved`. `p_actor` NULL = the platform's audit. |
| `finance.fn_advance_dispute(p_dispute_id)` → `dispute_status` | internal | Moves an `open` case: runs the audit and rules (`refund` / `dismiss`, as the platform) or hands it to the respondent — `awaiting_response`, `respond_by = now() + dispute_response_hours`, `dispute.response_requested` to the owner. A running sitting leaves it `open`. |
| `finance.respond_to_dispute(p_dispute_id, p_statement, p_file_ids)` → jsonb | user | A party files a statement (1–4,000 chars) with up to ten of their OWN `uploaded`, undeleted `files.items` as evidence (`dispute_messages` + `dispute_evidence`). The respondent's statement on an `awaiting_response` case → `under_review` (`responded_at`, `escalated_at`, `review_by`, `dispute.escalated` to both). Not a party → `P0002`; resolved → `PS409`. |
| `finance.escalate_dispute(p_dispute_id)` → jsonb | user | Either party sends an `awaiting_response` case to an auditor early (stamping `review_by`). Idempotent on `under_review`; `open` → `PS409` (the audit has not run). |
| `finance.get_dispute(p_dispute_id)` → jsonb | user | The case as a party or an operator may see it (NULL otherwise): status, role, deadlines (`respond_by`, `review_by`), audit, settlement, the money at stake, the sitting, every statement with its files' metadata, and `can_respond` / `can_escalate` / `can_resolve`. |
| `finance.list_disputes_for_review(p_status)` → jsonb | operator | The operator queue (`/admin/disputes`, `GET /api/finance/disputes`). `security.is_admin()` only, else `42501` (the page answers 404). `{items, counts}`: every live case — or those in one live status (anything else `22023`) — oldest-due first (`under_review` by `review_by`, `awaiting_response` by `respond_by`, `open` by `created_at`), ≤ 200, each with status, kind, reason, `opened_at` / `respond_by` / `escalated_at` / `review_by`, `overdue`, the money held, the project and sitting, the claimant and respondent (name · handle) and the statement / evidence counts; `counts` (`open` · `awaiting_response` · `under_review` · `overdue`) over the whole live set. |
| `finance.resolve_dispute(p_dispute_id, p_outcome, p_payee_share_bp, p_notes)` → jsonb | operator | `security.is_admin()` only (`ops.admin_users`), else `42501`. `release` · `refund` · `split` (share 1–9,999 bp); reasons (3–2,000 chars) required — they are shown to both parties. Final. |
| `finance.sweep_disputes(p_now)` → jsonb | scheduler | `finance-dispute-sweep` (`7,22,37,52 * * * *`): (a) closes live disputes whose escrow already settled; (b) audits `open` claims once their sitting ends; (c) auto-escalates `awaiting_response` past `respond_by` → `under_review` (`review_by = p_now + dispute_review_hours`, `dispute.escalated`); (d) the review SLA: an `under_review` case past `review_by` is NOT ruled — one `ops.log_entries` `warn` row (`client_id = dispute:review_overdue:<id>`, scope `finance.sweep_disputes`) and `dispute.review_overdue` to every `ops.admin_users` operator, at most once a day per case (`review_alerted_at`), plus a `WARNING`. Returns `{closed, audited, escalated, overdue}`. Service role may run it by hand. |
| `finance.fn_dispute_records_immutable()` | trigger | `BEFORE UPDATE OR DELETE` on the three dispute tables (+ `BEFORE TRUNCATE` on `disputes`): nothing is deleted, statements and evidence never change, a resolved dispute is final — for every role. |
| `finance.fn_guard_evidence_file()` | trigger | `BEFORE UPDATE OF deleted_at ON files.items`: a file filed in a LIVE dispute cannot be soft-deleted (`PS409`); after the ruling it is the owner's again. |

Probe: `supabase/probes/dispute_resolution.sql` (59 checks — every audit ruling, the respond →
review → operator split / refund / release paths, auto-escalation, settled-by-fact, per-sitting
escrow, evidence access and immutability, the workspace fields, grants) and
`supabase/probes/dispute_review_queue.sql` (30 checks — every door into review stamps `review_by`, the
CHECK, the operator queue's gate / order / filter / counts, the overdue alert that never rules and
repeats at most daily, grants).

## 📊 Public metrics (`00001265`, Decision #277)

### `finance.public_metrics()` → jsonb (service role)

The public site's live platform figures (`/about`, the landing page; read by `PublicMetricsService`,
cached an hour). `SECURITY DEFINER`, `STABLE`, `search_path = ''`; EXECUTE revoked from `PUBLIC`,
`anon` and `authenticated` and granted to `service_role` only (`00002510` `[about_metrics]`).
**Aggregates only** — no row of any table is returned — and the publication threshold is applied
HERE, each figure by its OWN count: a figure resting on fewer than
`security.platform_params.public_metrics_min_n` rows comes back `NULL` together with its count. The
per-currency parts of the protected total are gated by the total's count only — they reach the
service role alone, and the public payload carries only one converted total, floored to two
significant figures (`coarsenPublishedTotal`).

| Key | Meaning |
| :-- | :-- |
| `as_of` | `now()` of the read. |
| `min_n` · `min_n_configured` | The threshold: the param when it is a number ≥ 1 (floored, capped at int4), else the literal 10 with `min_n_configured = false`. |
| `platform_fee_bp` | The `platform_fee_bp` param (the public rate, never a negotiated one); `NULL` when missing or not an integer 0–10,000. |
| `base_currency` | The `base_currency` param, upper case; `NULL` when not a three-letter code. |
| `protected_count` · `protected_by_currency` | Escrows whose status is `funded` · `held` · `disputed` · `released`, and `[{currency, amount_minor}]` of their `amount_cents` per upper-cased currency. `refunded` is left out (refunded money can be escrowed again). Never summed across currencies. |
| `stages_delivered` | `projects.project_stages` with status `approved` or `paid`, all time (archived included), in a non-personal project, with at least one escrow `released` to a payee — money evidence, because the project owner may write a stage's own `status` / `completed_at`. |
| `approval_count` · `median_funding_to_approval_hours` | Over the same delivered stages: hours from the stage's first released escrow's `created_at` to its last release (`max(released_at)`, stamped by the release doors; the stage's `completed_at` only when no released escrow carries one); the count of such stages and their `percentile_cont(0.5)`. |

Zod: `PublicMetricsAggregateSchema` (`@projective/types/marketing`). The service converts a
multi-currency total into `base_currency` through `FxService` and withholds it if any currency has no
rate. Probe: `supabase/probes/public_metrics.sql` (grants and definition, every threshold fallback,
an independent recomputation of each figure, a refund lowering the protected figure by exactly its
amount, a self-declared paid stage not counted, nothing below the threshold, malformed params).

## Under-18 accounts (Decision #208)

`finance.record_payout_account` asserts an adult (`org.fn_assert_adult`, `PM403`): a Stripe connected
account needs an account holder of 18 or over. Every other money door already refuses a minor
(Decision #190).
