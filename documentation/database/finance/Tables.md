# finance Schema: Tables

The `finance` schema is Projective's ledger of record — wallets, the double-sided escrow engine, the
transaction ledger, invoicing, disputes, and (added in the 2026-07-23 Wallet & Finance foundation)
multi-currency/FX, KYC/KYB verification, payment methods, money-movement automation, vault
governance, statements, and idempotency.

> **Zod SSOT:** `packages/types/finance/*` mirrors every row shape here. **Additive Rule:** the
> Escrow/Wallet tables are protected — columns/tables/indexes may be _added_, never dropped or
> FK-altered (root `CLAUDE.md` §1). This file documents the **real migrated schema only**
> (`database/CLAUDE.md`).

## The money model (read first)

- **Store-in-origin currency.** Every amount is an `(amount_minor BIGINT, currency)` pair, stored in
  the currency it was entered in and settled in that exact currency. **GBP** is the internal
  accounting/bridging base (`security.platform_params.base_currency`). Display conversion is
  read-time only (see `finance-model.md` §Multi-Currency & FX) and never mutates stored amounts.
- **Materialised balance (⚠️ not derived double-entry).** `finance.wallets.balance_cents` is the
  live Available balance, kept in step by `finance.fn_wallet_credit`/`fn_wallet_debit`, which also
  append a `finance.transactions` line carrying `balance_after_cents`. This is a **per-wallet
  single-entry running ledger**, not the derived-balance double-entry model `finance-model.md` §7
  aspires to. The gap is documented, not silently "fixed"; converting to derived double-entry is a
  future migration flagged for human sign-off (root `CLAUDE.md` §8). Because the cache can drift,
  the ledger is **append-only** and `finance.fn_reconcile_wallets` checks nightly that every
  `balance_cents` still equals its ledger (Decision #186, [Functions.md § Ledger integrity](Functions.md#ledger-integrity-decision-186)).
- **Fund-state projection.** The three-state balance is a **projection**, never stored on the
  wallet: `locked` (in escrow) · `pending` (7-day window, `finance.pending_releases`) · `available`
  (`wallets.balance_cents`) · `on_hold` (Dispute Lockbox, `escrows.status='disputed'`). See
  `finance.fund_state`. **Earned money never enters `balance_cents` until it clears** (Decision #191):
  escrow releases, team shares, fair-exit and seat payouts and product sales write a
  `pending_releases` row, and `finance.fn_mature_pending_releases` credits the wallet (with its ledger
  line) when the window passes. So `balance_cents` is the Available balance, the only money any spend
  path or `begin_payout` can debit, and it still equals the ledger sum.
- **Hidden-ledger posture.** Most `finance.*` tables are **definer-only** (RLS enabled, no policy,
  no `authenticated` grant) — reachable only through `SECURITY DEFINER` RPCs
  (the `projects.*` stage wrappers, the workspace console's `finance.save_team_split` /
  `preview_team_split` / `save_spend_policy`; the former `org.get_business_finance` was retired
  2026-09-28). `finance.escrows` is the exception
  (explicit `GRANT SELECT` + policy). New user-facing tables below each ship their own RLS policy.

---

## 1. Core engine (existing — migrations `0009`, `0305`, `0310`)

### `finance.wallets`

The tiered vault. One row per `(owner_type, owner_id, currency)`.

| Column          | Type   | Notes                                                                    |
| :-------------- | :----- | :----------------------------------------------------------------------- |
| `id`            | uuid   | PK.                                                                      |
| `owner_type`    | text   | `user` / `freelancer` / `business` / `team` / `enterprise` / `system`. |
| `owner_id`      | uuid   | The owning entity.                                                       |
| `currency`      | text   | ISO-4217 origin currency.                                                |
| `balance_cents` | bigint | **Materialised** Available balance (`CHECK >= 0`).                       |
| `approval_threshold_cents` | bigint | This vault's own spend-approval threshold; `NULL` = no local override (the platform `vault_approval_threshold_cents` applies). |
| UNIQUE          | —      | `(owner_type, owner_id, currency)`.                                      |

> **Hidden system wallets** (Escrow Pool, Fee Collection, Dispute Lockbox — `finance-model.md` §6)
> are the canonical model but are **not yet materialised** as `owner_type='system'` rows: the engine
> tracks held capital via `finance.escrows` and the platform fee via `escrows.platform_fee_cents`
> rather than crediting system wallet rows. Materialising them is a future additive step.

### `finance.transactions`

Append-only per-wallet ledger line with a running balance and (additively) an FX snapshot.

**Append-only is enforced, not conventional** (Decision #186): `trg_transactions_append_only`
(`BEFORE UPDATE OR DELETE`, per row) and `trg_transactions_no_truncate` (`BEFORE TRUNCATE`) raise
`PL403` for every role — the table owner and the service role included. A mistake is corrected by a
compensating row through `fn_wallet_credit` / `fn_wallet_debit`, never by an edit.

| Column                | Type        | Notes                                                                           |
| :-------------------- | :---------- | :------------------------------------------------------------------------------ |
| `wallet_id`           | uuid        | FK → `finance.wallets` (**RESTRICT**: a wallet with ledger history is never deleted). |
| `direction`           | text        | `credit` / `debit`.                                                             |
| `amount_cents`        | bigint      | `CHECK > 0`.                                                                    |
| `currency`            | text        | Origin currency.                                                                |
| `reason`              | text        | Canonical code (see below).                                                     |
| `ref_table`,`ref_id`  | text,uuid   | Nullable source pointer (usually `escrows`).                                    |
| `balance_after_cents` | bigint      | Running balance after this line.                                                |
| `fund_state`          | `finance.fund_state` | Which pot of capital the amount belongs to — STORED (the ledger filters and sorts on it); default `available`. |
| `fx_rate`             | numeric     | **Additive** (`20260723090000`). Rate applied to reach `fx_base`, if converted. |
| `fx_base`             | char(3)     | **Additive.** The base currency (usually GBP).                                  |
| `fx_as_of`            | timestamptz | **Additive.** The `finance.fx_rates.as_of` the rate was snapshotted from.       |

**Canonical `reason` codes:** `topup` (money in — a card payment settled by the Stripe webhook writes
`topup` with `ref_table = 'inbound_payments'`, Decision #125), `escrow_hold`, `escrow_release`, `escrow_refund`, `fair_exit_release`,
`fair_exit_refund`, `team_split`, and the refund/chargeback lines `refund`, `chargeback`
(negative-direction entries). Refunds and chargebacks are ledger movements, not a separate table of
amounts (see `finance.chargebacks` for the dispute case they reference). A team release
(`finance.fn_split_team_payout`, 2026-09-28) also writes `team_finder_fee` (a finder's cut) and
`<reason>_vault_retention` (the vault's cut plus dust, e.g. `escrow_release_vault_retention` /
`fair_exit_release_vault_retention`).

> **`demo_opening_credit` is retired** (2026-09-28). A business wallet used to be credited
> 2,500,000 minor units, in whatever currency it was opened in, by the `trg_seed_business_wallet`
> trigger — spendable funds nobody had paid in. The trigger and `finance.fn_seed_business_wallet` are
> gone: a wallet's balance is only ever the sum of real movements. (The development seed now opens
> each entity wallet with a dated owner `topup` instead — [`../Seed.md`](../Seed.md).)

### `finance.escrows`

Capital locked against a stage/ticket. Text `status`, values used by the engine: `held` (on hold) →
`released` / `refunded`; `disputed` (Dispute Lockbox); table default `funded` (rarely persisted).

| Column                         | Type                 | Notes                                             |
| :----------------------------- | :------------------- | :------------------------------------------------ |
| `project_stage_id`             | uuid                 | FK → `projects.project_stages` (RESTRICT).        |
| `ticket_id`                    | uuid                 | FK → `projects.tickets` (SET NULL).               |
| `revision_id`                  | uuid                 | FK → `projects.stage_revision_requests` (RESTRICT). The paid revision round this escrow pays for (Decision #167), written by `finance.fn_hold_revision_escrow`; `NULL` = the ticket's **base** escrow. Decision #189. |
| `cohort_membership_id`         | uuid                 | FK → `projects.cohort_memberships` (RESTRICT). The seat this escrow pays for — a session escrow, held at booking. A ticket escrow and a seat escrow are different subjects (`ck_escrows_one_subject`). |
| `session_event_id`             | uuid                 | FK → `projects.session_events` (RESTRICT). The ONE sitting a 1-1 seat escrow pays for (Decision #211): a 1-1 booking holds one escrow per sitting, released `session_payout_hours` after ITS sitting and cancelled against ITS start; a cohort seat keeps it `NULL` and settles after the cohort's last sitting. Only beside `cohort_membership_id` (`ck_escrows_sitting_on_seat`); one escrow per sitting ever (`uq_escrows_session_event`). |
| `payer_business_id`            | uuid                 | FK → `org.business_profiles` (RESTRICT). Nullable since Decision #126. |
| `payer_user_id`                | uuid                 | FK → `org.users_public` (RESTRICT) — an INDIVIDUAL client (a project with no `client_business_id`). **Exactly one** payer column is set (`ck_escrows_one_payer`). Decision #126. |
| `payee_type`,`payee_id`        | assignment_type,uuid | `freelancer` or `team` payee. **NULL** on a PREPAID escrow until a claim binds it (Decision #197): `ck_escrows_payee_pair` (both or neither) and `ck_escrows_unbound` (an unbound escrow is a base ticket escrow that is `held`, or `refunded` — never released). |
| `amount_cents`                 | bigint               | Principal (`CHECK > 0`).                          |
| `platform_fee_cents`           | bigint               | Fee applied at release (0 while held).            |
| `deadline_bonus_cents`         | bigint               | Optional bonus.                                   |
| `currency`                     | text                 | Origin currency.                                  |
| `status`                       | text                 | `held`/`released`/`refunded`/`disputed`/`funded`. |
| `fx_rate`,`fx_base`,`fx_as_of` | —                    | **Additive** FX snapshot (`20260723090000`).      |

**One held base escrow per ticket (Decision #189).** `uq_escrows_ticket_base_held` is a partial
UNIQUE index on `(ticket_id) WHERE status = 'held' AND ticket_id IS NOT NULL AND revision_id IS NULL`:
the hold path checks, then inserts, so two concurrent holds both passed the check and debited the payer
twice. A paid revision round's escrow (`revision_id` set) sits beside the base escrow, and a seat's
escrow (`cohort_membership_id`) has no ticket, so neither collides. `uq_escrows_revision` (UNIQUE
`(revision_id) WHERE revision_id IS NOT NULL`) holds a round once, whatever became of its escrow.
`idx_escrows_ticket` stays for the all-status reads. Probe: `supabase/probes/escrow_uniqueness.sql`.

### Other existing engine tables

| Table                             | Purpose                                                                                                                                                                                                                      |
| :-------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.payout_accounts`         | Provider payout destination (Stripe **Connect** account, Accounts v2 Express recipient); `(provider, account_id)` UNIQUE; **one active Stripe account per owner** (`uq_payout_accounts_owner_active`, partial on `status <> 'disabled'`). `owner_type` CHECKs the five-value finance owner axis. `status` ∈ `pending_verification` · `verified` · `restricted` · `disabled` — the v2 `stripe_balance.stripe_transfers` capability mapped by `payoutAccountStatusFor()`, written only by `finance.sync_payout_account` from what Stripe reports; `updated_at` is the last reconciliation. Owner-scoped. Zod `PayoutAccountSchema`. See the flagged overlap with the new `finance.payment_methods`.                                                     |
| `finance.invoices`                | Per-stage or `consolidated_monthly` invoice; `status` draft/issued/paid/overdue/void; `pdf_file_id` → `files.items`.                                                                                                         |
| `finance.invoice_line_items`      | Invoice lines; `ref_type` ∈ escrow/bonus/platform_fee/refund/tax.                                                                                                                                                            |
| `finance.disputes`                | One contested held escrow (Decision #212). `escrow_id` → `finance.escrows` **RESTRICT** (was CASCADE — a dispute is never deleted); `session_event_id` → `projects.session_events` (the sitting a no-show claim is about; NULL otherwise); `opened_by_profile` (the claimant); `status dispute_status` ∈ `open` · `awaiting_response` · `under_review` · `resolved_release` · `resolved_refund` · `resolved_split` (PRODUCT_MANAGEMENT §3.8); `audit` jsonb (the attendance audit's frozen snapshot); `respond_by` (the auto-escalation deadline, `dispute_response_hours`); `responded_at`, `escalated_at`; `review_by` (the review SLA — stamped `now + dispute_review_hours` (72) by every door into `under_review`; a target, never a ruling: past it the sweep only alerts ops and the operators) and `review_alerted_at` (the last overdue alert, at most once a day per case); `resolved_by` → `auth.users` (NULL when the platform's audit or the money's own path settled it); `payee_share_bp` (1–9999, a split ruling only); `settlement` jsonb (`payee_minor` · `fee_minor` · `refund_minor` · `currency`, or `deferred` / `by_fact`); `updated_at`, `resolved_at`. CHECKs: `ck_disputes_resolved_at` (resolved ⇔ `resolved_at`), `ck_disputes_split_share` (split ⇔ `payee_share_bp`), `ck_disputes_awaiting_deadline`, `ck_disputes_review_deadline` (`under_review` ⇒ `review_by`). One LIVE dispute per escrow (`uq_disputes_escrow_live`); `idx_disputes_review_by` (partial, `under_review`) serves the sweep and the operator queue. Never deleted, terminal once resolved (`trg_disputes_immutable`, `trg_disputes_no_truncate`). Written only by the definers in `00001260` and `projects.claim_session_no_show`. Zod `DisputeCaseSchema` / `DisputeSummarySchema` / `DisputeQueueSchema` (`packages/types/finance/disputes.ts`). |
| `finance.dispute_messages`        | A dispute's statements (the Evidence Vault, append-only — `trg_dispute_messages_immutable`): `sender_user_id`, `party` ∈ `claimant` · `respondent` · `operator`, `body`. Written only by `finance.respond_to_dispute`. `dispute_id` → RESTRICT. |
| `finance.dispute_evidence`        | The Evidence Vault's files (Decision #212): `dispute_id`, `message_id` (the statement it was filed with), `file_id` → `files.items` RESTRICT (the sender's own uploaded file), `submitted_by`; `(message_id, file_id)` UNIQUE. Append-only (`trg_dispute_evidence_immutable`); a filed file cannot be soft-deleted while its dispute is live (`trg_files_items_guard_evidence`), and `files.fn_can_read` opens it to the dispute's parties and operators. |
| `finance.spending_limits`         | **Per-member spending ENVELOPE** on a pooled wallet: `wallet_id`,`member_user_id`,`cap_cents`,`per_transaction_cents`,`period_interval` (weekly/monthly/total),`spent_cents`,`resets_at`. `cap_cents` is **nullable since 2026-09-28** (`CHECK (cap_cents IS NULL OR cap_cents >= 0)`): `NULL` = no rolling ceiling, a policy somebody set — distinct from no row (no envelope) and from `0`. `per_transaction_cents` (nullable) caps one purchase independently of the rolling cap. Enforced atomically by `finance.fn_check_spending_limit`. This IS the "spending caps" model — formalised, not duplicated. |
| `finance.contribution_agreements` | Team member's `percent_bp` split share (`0–10000`) + `held` (an immovable stake the rebalancer never touches); `(team_id, member_user_id)` UNIQUE. **The ONE home of a member's payout share** (`org.team_members.default_split_share` was removed). A team's stakes total exactly **10000 or 0**, enforced at commit by the deferred constraint trigger `trg_contribution_agreements_total` (`finance.fn_assert_team_split_total`, `23514`). Written by `org.create_workspace` (owner 10000), invitation acceptance (0), `org.fn_rebalance_departed_stake` and `finance.save_team_split`. |
| `finance.payout_splits`           | The per-member amounts recorded at each team escrow release.                                                                                                                                                                 |
| `finance.ratings`                 | Post-project ratings (legacy home; the live review surface is the `reviews` schema).                                                                                                                                         |
| `finance.subscriptions`           | Profile subscription plan/status.                                                                                                                                                                                            |

---

## 2. Multi-currency & FX (additive — `20260723090000`)

### `finance.fx_rates`

Append-only historical FX observations. `rate` is the multiplier
`amount_quote = amount_base * rate`. A snapshotted `(fx_base, fx_as_of)` on a transaction/escrow
reproduces the exact rate used at commit.

| Column     | Type           | Notes                                                        |
| :--------- | :------------- | :----------------------------------------------------------- |
| `base`     | char(3)        | ISO-4217 base (e.g. GBP).                                    |
| `quote`    | char(3)        | ISO-4217 quote.                                              |
| `rate`     | numeric(20,10) | `CHECK > 0`.                                                 |
| `as_of`    | timestamptz    | Observation instant.                                         |
| `provider` | text           | Rate source (`stripe`/`ecb`/…; `XXXX-XXXX` in placeholders). |
| UNIQUE     | —              | `(base, quote, as_of)`.                                      |

**Seeded floor (`00005050_seed_reference_data.sql`).** A baseline observation for every supported
display currency ships as reference data (`provider = 'seed'`, a FIXED `as_of`, never `now()`, so a
reset is reproducible) — a from-scratch database can resolve any display currency immediately
instead of silently rendering unconverted origin amounts. **Both directions of every pair are seeded
explicitly**, never derived: a reader that divides by the forward rate and a reader that multiplies
by the inverse disagree in the last minor unit, and a figure that changes with which direction the
caller asked in is worse than one that is merely stale. `FxService`
(`@server/services/finance/FxService.ts`) is the only reader — it caches per base for 15 minutes and
reports `provider`/`asOf` so a seeded or stale rate is always distinguishable from a live one.

> The FX **snapshot columns** on `finance.transactions` and `finance.escrows` are listed with those
> tables above. `fx_base` carries `DEFAULT 'GBP'` so a stamped `fx_rate` is never orphaned from the
> currency it was quoted against; both snapshots are **immutable once written** — a statement or
> invoice reprints the rate that was actually applied, never today's. **Store-in-origin is already
> satisfied everywhere** — every priced entity already carries a `currency` (`finance.*`,
> `projects.projects`, `projects.tickets`/`project_stages` via the project,
> `marketplace.service_blueprints`), so **no** currency column is added to a priced entity here. ⚠️
> **FX economics (who bears the spread / how the conversion fee is charged) is OPEN** — flagged in
> root `CLAUDE.md` §8, not decided in schema.

---

## 3. KYC / KYB verification (additive — `20260723091000`)

### `finance.verification_cases`

The auditable identity/business verification trail. **No PII** — only opaque provider references.

| Column         | Type                 | Notes                                                     |
| :------------- | :------------------- | :-------------------------------------------------------- |
| `subject_type` | text                 | `freelancer`/`business`/`enterprise`/`user`.            |
| `subject_id`   | uuid                 | The verified entity.                                      |
| `kind`         | text                 | `kyc` (individual) or `kyb` (business).                   |
| `status`       | `finance.kyc_status` | `unverified`/`pending`/`verified`/`rejected`/`expired`.   |
| `tier`         | smallint             | 1 Basic / 2 Verified / 3 Business (`CHECK 1..3`).         |
| `provider`     | text                 | `stripe_identity` / `stripe_connect` / …                  |
| `provider_ref` | text                 | External verification-session / account id (`XXXX-XXXX`). |

**Denormalised caches (additive columns):** `org.freelancer_profiles` gains
`kyc_status`,`kyc_tier`,`kyc_verified_at`,`payout_ready`,`identity_provider_ref` (KYC); and
`org.business_profiles` gains `kyb_status`,`kyb_verified_at`,`kyb_provider_ref` (KYB) — documented
in [`../org/Tables.md`](../org/Tables.md). ⚠️ **Distinct from email verification**
(`org.user_emails.verified_at`, migration 0312). Enterprises keep their own
`org.enterprise_verification_level` (0314). The gating rule (freelancer onboarding gate; clients
exempt; business KYB to operate the pooled wallet) is in `finance-model.md` §KYC/KYB Gating.

---

## 4. Payment methods & money-movement (additive — `20260723092000`)

Card data is **Stripe-owned** and never stored — only an opaque `external_ref` + safe display
fragments (`brand`, `last4`).

| Table                      | Purpose & key columns                                                                                                                                                                                                                                                           |
| :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `finance.payment_methods`  | Unified funding + payout registry. `owner_type`/`owner_id`, `method_role` (`funding`/`payout`/`both`), `external_ref`, `is_default_funding`/`is_default_payout`. ⚠️ overlaps the existing `finance.payout_accounts` (Connect payout account) — reconcile (root `CLAUDE.md` §8). |
| `finance.deposit_rules`    | Recurring deposit / standing instruction: `wallet_id`, `source_method_id`, `amount_cents`+`currency`, `interval` (weekly/monthly), `next_run_at`, `failure_count`.                                                                                                              |
| `finance.payout_schedules` | Payout cadence: `owner_type`/`owner_id`, `mode` (manual/scheduled_weekly/scheduled_monthly/threshold), `threshold_cents`, `destination_method_id`, `instant` (Instant Payout fee opt-in). `(owner, currency)` UNIQUE.                                                           |
| `finance.income_smoothing` | AI "Income Smoother" enrolment: `user_id`, `enrolled`, `target_monthly_cents`, `fee_bp` (~0.5%), `eligibility_met`. `(user, currency)` UNIQUE. Eligibility numbers in `finance-model.md` §Money-Movement Rules.                                                                 |
| `finance.wallet_pots`      | Sub-wallets / pots: `wallet_id`, `purpose` (tax/savings/goal/general), `name`, `balance_cents`, `auto_allocate_bp` (skim % of inbound payouts — the tax-pot auto-set-aside).                                                                                                    |

---

## 5. Vault governance (additive — `20260723093000`)

| Table                       | Purpose & key columns                                                                                                                                                                                                                                                                                                                           |
| :-------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.vault_permissions` | Capability **grants** (not a single role) on a shared wallet: `wallet_id`, `member_user_id`, `capabilities finance.vault_capability[]` (view/add_funds/spend/distribute/withdraw/manage_members/manage_billing/**approve_spend**). `(wallet, member)` UNIQUE. **A PROJECTION since 2026-09-28**, not a hand-maintained authority: written only by `org.fn_sync_vault_permissions` — called explicitly on every membership, role and override change and on every team/business wallet insert, and **backstopped by triggers** on `org.team_members` / `org.business_members` (role, status, overrides) and `org.team_roles` / `org.business_roles` (capabilities, base preset), so a write path that forgets the call cannot leave a stale grant (Decision #226 (e)) (the mapping is in [`../org/Functions.md` §7](../org/Functions.md#-the-workspace-console-00001020)). A non-member's row is kept, projected to `'{}'`. This resolves the former overlap flag with the retired `org.business_permission` / `org.team_permission` enums. |
| `finance.split_rules`       | Team smart-split **ruleset template**: `team_id`, `rule_type` (co_op/finders_fee/benevolent_dictator), `vault_bp` (Team Vault cut, taken first), `finder_user_id`+`finder_bp`. Resolves into the per-member `finance.contribution_agreements`. Deterministic remainder rounding: leftover minor unit → Team Vault. **One ACTIVE rule per team** — `uq_split_rules_team_active` (unique, `WHERE active`; was a plain index), because `finance.fn_team_split_plan` reads "the" rule. No active rule = co-op with no vault cut. Written only by `finance.save_split_rule` ([Functions.md](Functions.md)), which retires the active row (`active = false`, kept) and inserts the new one; benevolent_dictator stores `vault_bp = 10000`. No client write grant. |
| `finance.spend_approvals`   | Over-cap / over-threshold second-approver queue: `wallet_id`, `requested_by`, `amount_cents`+`currency` (what it was filed for), `reason`, `ref_table`/`ref_id` **NOT NULL** (CHECK `ref_table` ∈ `baskets` · `tickets` · `project_stages` · `revisions` · `invoices` · `transfers` — `transfers` names the destination wallet), `status` (pending/approved/rejected/expired/withdrawn — `withdrawn` is the requester taking it back, Decision #246), `approver_user_id`, `decided_at` (when it left `pending` by somebody's act: a decision, or the requester's withdrawal; a lapse stamps nothing), `expires_at`, `consumed_at` + `consumed_ref_table`/`consumed_ref_id` (stamped once, by `finance.fn_redeem_spend_approval`, in the spending transaction; CHECK: all three set together and only on an `approved` row). Filed by `finance.request_spend_approval` (currency = the wallet's, `expires_at = now() + 7 days`), decided by `finance.decide_spend_approval` (needs `approve_spend`), withdrawn by its requester through `finance.withdraw_spend_approval` (CHECK `spend_approvals_withdrawn_check`: a `withdrawn` row names no approver and carries `decided_at`), spent by the spend gate. Indexes: `uq_spend_approvals_pending_ref` (one `pending` row per `(wallet_id, ref_table, ref_id)`), `idx_spend_approvals_redeemable` (approved and unconsumed). No client INSERT — see [Policies.md](Policies.md). |
| `finance.ledger_audit`      | Immutable who/when/amount trail for vault money moves: `wallet_id`, `actor_user_id`, `action finance.vault_action` (add_funds/spend/distribute/withdraw/transfer), `amount_cents`+`currency`, `metadata`. ⚠️ overlaps `security.audit_logs` (general) — kept separate for the amount-typed wallet-scoped read; reconcile (root `CLAUDE.md` §8). |

---

## 6. Statements, fund states, settlement (additive — `20260723094000`)

| Table / object                    | Purpose & key columns                                                                                                                                                                                                                                                                                                      |
| :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.pending_releases`        | One earned credit inside the safety window (Decision #191). Source: exactly one of `escrow_id` (a release, team share, fair-exit or seat payout) or `order_id` (a product sale), `ck_pending_releases_one_source`; all FKs `ON DELETE RESTRICT`. `wallet_id`, `reason` (the ledger reason the maturing credit is written with), `amount_cents`+`currency`, `recovered_cents` (taken back by a lost chargeback, `0 ≤ … ≤ amount_cents`), `released_at`, `available_at` (= `released_at` + `pending_release_days`), `state finance.fund_state` (`pending` in the window; `available` once closed, with `matured_at`, and `transaction_id` naming the credit unless a chargeback emptied it). Still pending = `amount_cents − recovered_cents` over `state = 'pending'`. |
| `finance.statements`              | Monthly consolidated statement (30-day window, issued on the 1st): `owner_type`/`owner_id`, `period_start`/`period_end`, `opening`/`closing`/`total_in`/`total_out`/`total_fees` cents, `status` (draft/issued/final), `pdf_file_id`. Complements per-payout `finance.invoices`. `(owner, period_start, currency)` UNIQUE. |
| `finance.chargebacks`             | The Stripe dispute case a negative ledger line references: `wallet_id`/`transaction_id`/`escrow_id`, `provider_ref`, `amount_cents`+`currency`, `status` (opened/under_review/won/lost/refunded). **One row per processor dispute** (`uq_chargebacks_provider_ref`, partial). Written by `finance.record_dispute_opened` from the `charge.dispute.created` webhook, which also freezes the escrows the disputed payment funded (`held` → `disputed`). |
| `finance.idempotency_keys`        | Retries never double-move money: `key` (PK), `scope`, `request_hash`, `status`, `response`, `expires_at`. **Definer-only** (RLS on, no policy). Scopes in use: `transfer:<uid>` / `distribute:<uid>` (wallet movements), `card_payment:<uid>` (a card payment attempt, Decision #125) and `stripe.webhook` (key `stripe:<evt_id>`, one row per processed Stripe event, its `response` holding the outcome — `applied` · `replayed` · `unmatched` · `ignored` — for reconciliation, kept 30 days). A card settlement that cannot be credited yet deletes its claim instead (`finance.fn_release_stripe_event`, Decision #200), so Stripe's retry is processed rather than replayed. |
| `finance.payouts`                 | One attempt to move money OUT of a wallet: `wallet_id`, `destination_method_id`, `schedule_id`, `amount_cents`+`currency`, `status finance.payout_status` (pending/paid/failed/cancelled), `instant`, `provider`/`provider_ref` (the Stripe Transfer id), `transaction_id` (the ledger debit — `NULL` while in flight and forever on a failure), `failure_reason`, `initiated_at`/`settled_at`; after the transfer (Decision #202) `destination_account` (the `acct_…` it is sent to, fixed at begin), `reversed_cents` (what `transfer.reversed` returned), `bank_status` (`paid`/`failed`, the connected account's own bank payout) with `bank_payout_ref`/`bank_failure_code`/`bank_status_at`, and the stale sweep's lease `swept_at`/`sweep_attempts`. CHECKs: a reason only on a failure; `paid`/`reversed` ⇔ `settled_at`; `0 ≤ reversed_cents ≤ amount_cents`; `reversed` ⇔ `reversed_cents = amount_cents`; a bank status only on a sent payout, a failure code only on a failed one. **One payout per processor transfer** (`uq_payouts_provider_ref`, partial) — `finance.record_transfer_created` binds a `transfer.created` event to the payout its metadata names only when destination, amount and currency agree. Indexes `idx_payouts_pending_initiated` (the sweep) and `idx_payouts_bank_payout_ref`. Zod `PayoutSchema`. |
| `finance.v_wallet_reconciliation` | **View.** Internal self-consistency: `balance_cents` vs the running ledger sum → `drift_cents` (must be 0). External Stripe-balance reconciliation is an ops job (`SYSTEM_ARCHITECTURE.md` §Integration Blueprints). Exposed to `service_role` only.                                                                       |
| `finance.v_ops_unledgered_payments` | **View** (Decision #200). Every settled card payment (`succeeded` / `settled_unapplied`) without the ledger credit it is: `problem` = `no_ledger_row` (no `transaction_id`) or `ledger_row_mismatch` (the linked row is not this payment's `credit` of `amount_received_cents` into its `wallet_id`). Plus every payment Stripe settled in an amount / currency that does not match it — `problem` = `settlement_mismatch` — or for a business that was archived by the time it settled — `problem` = `business_archived` (nothing credited: an archived business takes no money in, Decision #248 (k)) — read from the completed `stripe.webhook` claim whose outcome carries that `reconciliation` marker, listed while the payment is still unsettled — `requires_payment`, `processing` or `failed` (not final: a success after a declined attempt is held with the row still reading `failed`) — until a human settles or closes it. Columns: `payment_id`, `status`, `purpose`, `wallet_id`, `created_by`, `provider_ref`, `amount_cents`, `amount_received_cents`, `currency`, `transaction_id`, `unapplied_reason`, `succeeded_at`, `problem`, `stripe_event_id`, `reported_amount_cents`, `reported_currency` (the last three set for the reconciliation rows only — what Stripe reported). The first two problems are empty while the `inbound_payments` CHECKs and `settle_card_payment` hold. Exposed to `service_role` only. |

---

## 7. Subscriptions, plans & entitlements (additive — `20260724112000` / `20260724113000`)

The **PAID ladder**. Zod SSOT: `packages/types/finance/plans.ts` + `entitlements.ts`.

> **The three axes** (`finance-model.md` §1.1). **Execution capacity** — how much work a freelancer
> may hold concurrently — is **never monetised**; it stays governed by the Workload Intensity
> ($W_i$) caps. Only **distribution** (outbound proposals) and **marketplace footprint** (live
> public projects, published listings, entities owned, seats, promoted placement) are tiered.
>
> **And a plan can never buy reputation.** Nothing in these tables writes to `org.entity_standing`.
> The two ladders stack — earn it, or accelerate it — but a rung is never for sale.

| Table                                | Purpose & key columns                                                                                                                                                                                                                                                                                                |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.plans`                      | The catalogue: `code` (UNIQUE), `audience`, `tier`, `price_cents`+`currency`, `billing_interval`, `is_custom_priced`, `per_seat_cents`, `is_default` (one per audience — partial UNIQUE index), `provider_price_ref`. Seeded with the 8 plans below.                                                                 |
| `finance.plan_entitlements`          | What a plan grants: `entitlement_key`, `kind` (limit/flag), `limit_value`, `is_unlimited`, `flag_value`, `scaling` (none/standing_base/standing_bonus), `multiplier_bp`. `(plan, key)` UNIQUE.                                                                                                                       |
| `finance.subscriptions` _(extended)_ | The 0009 skeleton gained `subject_type`/`subject_id`, `plan_id` FK, `state`, `billing_interval`, `current_period_start`/`_end`, `cancel_at_period_end`, `trial_ends_at`, `seats`, `price_cents`+`currency`, `provider`/`provider_ref`, `created_at`/`updated_at`. Partial UNIQUE: one live subscription per subject. |
| `finance.subscription_events`        | Billing audit trail: `event_type` (started/upgraded/downgraded/renewed/payment_failed/paused/resumed/cancelled/expired), `from_plan_id`/`to_plan_id`, `amount_cents`, `provider_ref`.                                                                                                                                |
| `finance.entitlement_grants`         | Manual overrides (comps, trials, negotiation): `entitlement_key`, `limit_value`/`is_unlimited`/`flag_value`, `reason`, `granted_by`, `starts_at`/`expires_at`. A grant may only **raise** an effective limit, never lower it — a misconfigured comp can never suffocate a paying subject.                            |
| `finance.standing_commission_tiers`  | The **earned** marketplace-commission taper keyed to `org.standing_levels.level`: 8% · 8% · 7.5% · 7% · 6.5%. `platform_fee_bp` is `NULL` at every rung — the 5% service fee does **not** taper with Standing.                                                                                                       |
| `finance.negotiated_rates`           | The one sanctioned flex of the 5%: `subject_type` (business/enterprise), `platform_fee_bp`, optional `marketplace_commission_bp`, `minimum_volume_cents`, `contract_ref`, `approved_by`, `starts_at`/`ends_at`, `status`. Explicit, admin-approved, time-boxed — never an implicit consequence of holding a plan.  |
| `finance.allowance_periods`          | Metered distribution, one live row per `(subject, key, period_start)`: `granted_units`, `consumed_units`, `base_units`, `standing_bonus_units`, `buffer_units`, `buffer_cap`, `buffer_refreshed_at`.                                                                                                                 |
| `finance.allowance_ledger`           | Append-only consumption record behind "42/50 used this week": `period_id`, `units` (negative = refund), `reason`, `ref_table`/`ref_id`.                                                                                                                                                                              |

### The seeded plans

| Code                | Audience     | Price              | Notes                                                                                                                                               |
| :------------------ | :----------- | :----------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| `individual_free`   | individual   | £0                 | The universal baseline. A freelancer is a superset of a client, so this carries the full buyer baseline too — there is **no separate client plan**. |
| `individual_pro`    | individual   | £12.99/mo          | Accelerates footprint + distribution.                                                                                                               |
| `team_free`         | team         | £0                 | A team needs ≥ 2 members to send proposals.                                                                                                         |
| `team_pro`          | team         | £29/mo per team    | Pre-existing rate (`finance-model.md` §1.3).                                                                                                        |
| `business_free`     | business     | £0                 | Pooled wallet in basic mode; KYB still gates operation.                                                                                             |
| `business_pro`      | business     | **`NULL` (TBD)**   | ⚠️ Entitlements seeded, **price not set** — flagged, root `CLAUDE.md` §8.                                                                           |
| `enterprise_free` | enterprise | £0                 | Free-to-draft; going active + adding seats needs the paid tier.                                                                                     |
| `enterprise`      | enterprise | Custom, seat-based | Keyed to `org.employee_scale`. The only place the platform fee may flex.                                                                            |

### The entitlement matrix (starting dials)

| Lever                                | Individual Free     | Individual Pro (£12.99) |
| :----------------------------------- | :------------------ | :---------------------- |
| `private_drafts`                     | **Unlimited**       | Unlimited               |
| `active_public_projects`             | 3 concurrent        | 15 concurrent           |
| `published_listings`                 | rung base (10 → 50) | **2×** the rung base    |
| `weekly_proposals`                   | 50 + rung bonus     | 150 + rung bonus        |
| `proposal_buffer_per_10h`            | 3                   | 5                       |
| `teams_owned`                        | 3                   | 6                       |
| `businesses_owned`                   | 1                   | 3                       |
| `teams_joined` / `businesses_joined` | **Uncapped**        | Uncapped                |
| `storage_megabytes`                  | 25600 (25 GiB)      | 153600 (150 GiB)        |

| Lever                     | Team Free | Pro Team (£29)  | Lever                      | Business Free | Business Pro |
| :------------------------ | :-------- | :-------------- | :------------------------- | :------------ | :----------- |
| `team_seats`              | 4         | 15              | `business_public_projects` | 3             | 25           |
| `team_public_projects`    | 2         | 15              | `business_managers`        | 2             | 15           |
| `weekly_proposals` (pool) | 50        | 150 (dedicated) | `departments`              | 0             | 5            |
| `split_template_co_op`    | ✅        | ✅              | `pooled_wallet_full`       | basic         | ✅           |
| `split_template_finders_fee` · `split_template_benevolent_dictator` | — | ✅ |                    |               |              |
| `promoted_placement`      | —         | ✅              | `intervaled_invoicing`     | —             | ✅           |
| `storage_megabytes`       | 25600     | 512000          | `storage_megabytes`        | 25600         | 512000       |

The three Business Pro levers `business_managers`, `pooled_wallet_full` and `intervaled_invoicing`
are **enforced** (`PK402`) behind `security.platform_params.business_plan_gates_enforced`, seeded
`true` (Decision #230 (e)): managers past the plan's (admins and holders of `manage_projects`,
pending invitations included), a spending ceiling or an approval threshold, and monthly invoicing.
Where each is refused: [Functions.md § Business plan gates](Functions.md#-business-plan-gates-00001220-7-decision-230-b-e).

The Enterprise tier is unlimited on seats/businesses/departments/projects and adds `sso_enabled`,
`api_access`, `audit_log_retention_days` (730), `dedicated_support` and `negotiated_platform_fee`.
`enterprise_free` carries 25600 MiB of draft-tier storage; the paid `enterprise` plan is the
schema's only `storage_megabytes` row with `is_unlimited = true`.

### `storage_megabytes` — the asset-management footprint lever

The `/files` asset hub meters stored bytes as an entitlement like any other footprint cap. The full
ladder, the enforcement gate and the reasoning are in
[`../files/Tables.md`](../files/Tables.md#storage-quota) and
[`../files/Functions.md`](../files/Functions.md); what belongs **here** is why it is denominated the
way it is, because that constraint originates in this schema:

> ### ⚠️ The unit is MEBIBYTES, and it has to be
>
> `finance.plan_entitlements.limit_value` is **`integer`**, and every resolver over it —
> `fn_effective_limit`, `fn_footprint_usage`, `fn_footprint_remaining` — returns `integer` too. **25
> GB expressed in bytes is 26,843,545,600, which overflows `int4`** (max 2,147,483,647). A
> bytes-denominated ladder would therefore fail at the _smallest_ tier on the list, not at some
> distant enterprise ceiling — the free plan would be unrepresentable.
>
> MiB keeps the whole ladder (25 GiB … 500 GiB → 25 600 … 512 000) comfortably inside `int4`, with
> room for roughly a **2 PiB** ceiling before the question returns.
>
> Widening the column to `bigint` was rejected: `limit_value` is shared by every entitlement key,
> and a proposal count, a seat count and a department count have no business being 64-bit because
> one sibling key measures bytes. The unit conversion is cheaper and it happens **exactly once**, in
> `files.fn_check_storage_quota` — nothing else in the system multiplies or divides by 1 048 576.
>
> The usage side is the mirror of this: `files.storage_usage.bytes_used` is **`bigint`**, the honest
> unit for a byte total, and `fn_footprint_usage` floors it into MiB at the boundary. Integer
> division floors, so a subject is never reported as having consumed a MiB they have not.

> **Ownership ≠ power.** Raising `teams_owned`/`businesses_owned` on a _personal_ plan lets a user
> spin up more entities; each entity still pays for its own muscle through its own plan. That split
> is why there are two payment planes rather than one.

---

## 8. Basket, wishlist & saved cards (additive)

**Pre-transaction state.** These three tables sit _before_ the ledger, not inside it. A basket line
is an **intent** to buy: nothing here debits, credits, reserves or holds anything, and no row in
this section can change a balance. Checkout is the moment a basket becomes escrow, and that path
stays entirely in the `SECURITY DEFINER` money functions.

> **Prices here are a snapshot, not an authority.** `basket_items.unit_price_minor` /
> `discount_amount_minor` exist so a line renders consistently and so a renamed or re-priced listing
> cannot silently rewrite what the buyer thought they were adding. Checkout **re-resolves the
> authoritative price server-side** — a stale or tampered basket line can never set what is charged.

### `finance.baskets`

A named collection of purchasable intents for one owner. **A wishlist is not a separate table or a
separate kind** — it is simply a non-default basket with its own name (`3D Asset Wishlist`), which
is why there is no `kind` column. One owner may hold many baskets; at most one is the default.

| Column       | Type        | Notes                                                                                        |
| :----------- | :---------- | :------------------------------------------------------------------------------------------- |
| `id`         | uuid        | PK, `gen_random_uuid()`.                                                                     |
| `owner_type` | text        | `CHECK IN ('user','freelancer','business','team','enterprise')` — the wide finance axis.   |
| `owner_id`   | uuid        | The owning principal.                                                                        |
| `name`       | text        | NOT NULL, `DEFAULT 'Main Basket'`.                                                           |
| `is_default` | boolean     | NOT NULL `DEFAULT false`. At most one per owner (`uq_basket_default_per_owner`, partial).    |
| `created_at` | timestamptz | NOT NULL `DEFAULT now()`.                                                                    |
| `updated_at` | timestamptz | NOT NULL `DEFAULT now()`. App/service maintained — **no touch trigger** (schema convention). |

> **⚠️ `owner_type` is the wide axis, deliberately.** It matches `finance.payment_methods` /
> `payout_schedules` / `statements` rather than a narrower `('user','business')` pair, because a
> narrower pair **cannot express a team basket** — and the app's context switcher (root `CLAUDE.md`
> Decisions #16/#61) switches between personal / team / business / enterprise, with the basket
> required to re-scope alongside it.
>
> Its Zod counterpart is **`PurchaseOwnerType`**, not `WalletOwnerType`. The wallet axis carries a
> sixth member, `system` (the hidden Escrow Pool / Fee Collection / Dispute Lockbox wallets), which
> this CHECK refuses — so a schema reusing the wallet axis here would validate a payload the
> database then rejects. `PurchaseOwnerType` is declared as a compile-time subset of
> `WalletOwnerType`, so the two can never diverge silently. The same pairing applies to
> `finance.saved_cards.owner_type`.

### `finance.basket_items`

One line in a basket. Polymorphic by `(item_type, item_id)` across the catalogue and the project
graph.

| Column                     | Type                            | Notes                                                                                       |
| :------------------------- | :------------------------------ | :------------------------------------------------------------------------------------------ |
| `id`                       | uuid                            | PK.                                                                                         |
| `basket_id`                | uuid                            | NOT NULL, FK → `finance.baskets` (**CASCADE**).                                             |
| `item_type`                | `finance.purchasable_item_kind` | NOT NULL. A real enum, not a text CHECK — shared with the Zod SSOT member-for-member.       |
| `item_id`                  | uuid                            | NOT NULL. **Polymorphic; deliberately not FK'd** — its target is chosen by `item_type`.     |
| `stage_id`                 | uuid                            | NULL. FK → `projects.project_stages` (**CASCADE**) — see the note below.                    |
| `ticket_id`                | uuid                            | NULL. FK → `projects.tickets` (**CASCADE**). The ONE board ticket the line buys (Decision #166); only on `project_ticket` / `one_off_project` / `one_off_task` with `quantity = 1` (CHECK `basket_item_ticket_is_project_work`). |
| `revision_id`              | uuid                            | NULL. FK → `projects.stage_revision_requests.id` `ON DELETE CASCADE` (Decision #167). Set exactly on a `paid_revision` line, equal to `item_id` (`basket_item_revision_line`). |
| `title`                    | text                            | NOT NULL. Display snapshot.                                                                 |
| `subtitle`                 | text                            | NULL.                                                                                       |
| `unit_price_minor`         | bigint                          | NOT NULL, `CHECK >= 0`. No default — a writer must state a price (0 for a wishlist line).   |
| `currency`                 | char(3)                         | NOT NULL, ISO-4217.                                                                         |
| `quantity`                 | integer                         | NOT NULL `DEFAULT 1`, `CHECK BETWEEN 1 AND 999` — see the bounds note below.                |
| `discount_code`            | text                            | NULL.                                                                                       |
| `discount_amount_minor`    | bigint                          | NOT NULL `DEFAULT 0`, `CHECK >= 0`.                                                         |
| `is_selected_for_checkout` | boolean                         | NOT NULL `DEFAULT true`.                                                                    |
| `saved_for_later`          | boolean                         | NOT NULL `DEFAULT false`. The soft "keep but do not buy" path.                              |
| `destination_email`        | text                            | NULL, structural `CHECK ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'`. Gifting.      |
| `metadata`                 | jsonb                           | NOT NULL `DEFAULT '{}'`. Carries `answers` — the buyer's responses to the listing's `intake_fields`, keyed by field id (Decision #108). |
| `created_at`/`updated_at`  | timestamptz                     | NOT NULL `DEFAULT now()`.                                                                   |
| CHECK                      | —                               | `basket_item_discount_within_line`: `discount_amount_minor <= unit_price_minor * quantity`. |

The discount CHECK is what makes a basket total structurally unable to go negative: a discount can
never exceed the line it discounts.

**Ticket lines (Decision #166).** A line with `ticket_id` buys that one ticket: the basket prices it
from the ticket (its own `unit_price_cents`, else its stage's) and checkout settles it by holding that
ticket's escrow (`projects.fund_ticket` via `finance.place_wallet_order`). The dedupe key is the
partial UNIQUE index `uq_basket_items_live_ticket (basket_id, ticket_id) WHERE ticket_id IS NOT NULL
AND removed_at IS NULL AND purchased_at IS NULL` — one live line per ticket per basket, parked or not;
adding it again re-selects that line. The PRODUCT_SPEC §5 purchasing gate (no description, not
purchasable) is enforced where money moves (`fund_ticket`, `begin_card_payment`) and said on the line
before Pay. The order line it becomes carries the same ticket: `finance.order_lines.ticket_id` (NULL,
FK → `projects.tickets`, `SET NULL` so the receipt outlives the ticket), with `fulfilment =
'engagement'`, its `stage_id`, and `line_total_minor` = the escrow held.

> **Bounds that exist so the Zod SSOT and the column agree.** `quantity` is bounded at **both** ends
> (`BETWEEN 1 AND 999`) to match `BasketItemSchema.quantity`, so a value that validates is always
> storable and a value that is stored always parses back out; it also keeps
> `unit_price_minor * quantity` inside `bigint`, which an unbounded `int4` quantity against a
> `bigint` price does not. `destination_email` carries the **same structural regex** the SSOT
> enforces, for the same reason in the other direction — a malformed stored address would throw on
> `.parse()` and take the whole basket read down with it.
>
> **The free-text display snapshots are the deliberate exception.** `title`, `subtitle` and
> `discount_code` are unbounded `text` (this schema has no length CHECKs on any table), while the
> SSOT bounds them at 200 / 200 / 40. That asymmetry is a **truncation contract the resolving
> service must honour on the way in** — documented on `BasketItemSchema` — rather than a hard
> refusal at INSERT, because refusing to add a long-titled listing to a basket is a worse outcome
> than storing a shortened snapshot of its name.

> **Why `stage_id` and `revision_id` are FK'd.** A stage reference is only meaningful for the
> ticket kinds, and every other kind leaves it NULL — but an FK only constrains **non-NULL** values,
> so keying it to the one unambiguous target (`projects.project_stages`) is both safe and correct.
> `ON DELETE CASCADE`, not `SET NULL`: if the stage is gone the line is not purchasable, and a
> stage-less ticket line would be a silently wrong basket entry rather than an honest absence.
> `revision_id` targets `projects.stage_revision_requests` (a client-requested revision round), as
> Decision #167 settled, with the same CASCADE reasoning.

**Paid revision lines (Decision #167).** A `paid_revision` line names the round it pays for
(`item_id = revision_id`, quantity 1, `stage_id` = the round's stage). The basket prices it from the
round's snapshotted `price_cents` and refuses it unless the round is `awaiting_payment` and the
paying account is the project's client; checkout settles it like a ticket line — the round's escrow is
held on its ticket by `projects.fund_paid_revision` via `finance.place_wallet_order` — and the order
line is `item_type = 'paid_revision'`, `fulfilment = 'engagement'`, `line_total_minor` = the escrow
held.

### `finance.saved_cards`

The buyer-facing **display projection** of a saved payment instrument.

| Column                     | Type                 | Notes                                                                                    |
| :------------------------- | :------------------- | :--------------------------------------------------------------------------------------- |
| `id`                       | uuid                 | PK.                                                                                      |
| `owner_type`               | text                 | Same wide CHECK as `finance.baskets`.                                                    |
| `owner_id`                 | uuid                 | The owning principal.                                                                    |
| `payment_method_id`        | uuid                 | NULL. FK → `finance.payment_methods` (`SET NULL`) — ties display back to the instrument. |
| `stripe_payment_method_id` | text                 | NOT NULL. Opaque Stripe reference (`XXXX-XXXX` in docs).                                 |
| `brand`                    | `finance.card_brand` | NOT NULL `DEFAULT 'unknown'`.                                                            |
| `last4`                    | char(4)              | NULL. Safe display fragment.                                                             |
| `exp_month`                | integer              | NULL, `CHECK 1..12`.                                                                     |
| `exp_year`                 | integer              | NULL, `CHECK 2000..2100`.                                                                |
| `cardholder_name`          | text                 | NULL.                                                                                    |
| `bin_number`               | text                 | NULL, `CHECK ~ '^[0-9]{6,8}$'`. See the IIN note below.                                  |
| `is_business_card`         | boolean              | NOT NULL `DEFAULT false`.                                                                |
| `created_by_user_id`       | uuid                 | NULL. FK → `auth.users` (`SET NULL`).                                                    |
| `is_default`               | boolean              | NOT NULL `DEFAULT false`. At most one per owner (`uq_saved_card_default_per_owner`).     |
| `created_at`               | timestamptz          | NOT NULL `DEFAULT now()`.                                                                |
| UNIQUE                     | —                    | `(owner_type, owner_id, stripe_payment_method_id)`.                                      |

> ### 🔒 What is stored, and what is never stored
>
> `brand` / `last4` / `exp_month` / `exp_year` / `cardholder_name` / `bin_number` are values
> **Stripe returns to us**. They are safe to store because **none of them can charge anything**.
>
> The **full card number (PAN) and the CVV are never received by this platform and are never
> stored.** There is no column for either, and adding one is prohibited. The only field here that
> can move money is `stripe_payment_method_id`, and that is an opaque reference Stripe resolves
> against our account — a pointer, not a credential.
>
> This is the same standing rule `packages/types/finance/methods.ts` carries for
> `finance.payment_methods`; `saved_cards` narrows it to the card case, it does not relax it.

> **⚠️ `bin_number` is usually NULL.** Stripe only returns an issuer identification number under an
> explicitly granted entitlement, so **every consumer must degrade to `brand` alone**. Treat a
> present BIN as a bonus, never as a branch condition.

> **⚠️ Three overlapping instrument tables.** `finance.payment_methods` (funding + payout registry),
> `finance.payout_accounts` (Connect payout account) and now `finance.saved_cards` (buyer-facing
> display) all describe an instrument. The first overlap was already flagged in root `CLAUDE.md`
> Decision #54 (f); `saved_cards` makes it three. The nullable `payment_method_id` FK exists
> specifically so the display projection is **tied back** to the money-movement instrument instead
> of diverging from it — but consolidating the three is a human decision, not a silent merge.

---

## 9. Enums (this schema)

`finance.kyc_status`, `finance.method_role`, `finance.deposit_interval`, `finance.payout_mode`,
`finance.pot_purpose`, `finance.vault_capability`, `finance.split_rule_type`,
`finance.approval_status`, `finance.vault_action`, `finance.fund_state`, `finance.statement_status`,
`finance.chargeback_status`, `finance.plan_audience`, `finance.plan_tier`,
`finance.billing_interval`, `finance.subscription_state`, `finance.entitlement_kind`,
`finance.entitlement_scaling`, `finance.entitlement_key`, `finance.purchasable_item_kind`,
`finance.card_brand`, `finance.payout_status`, `finance.inbound_payment_status`,
`finance.order_status`, `finance.fulfilment_kind`. See [`../Schemas.md`](../Schemas.md) for the
global enum registry.

### `finance.payout_status` and `finance.inbound_payment_status`

`payout_status`: `pending` · `paid` · `failed` · `cancelled` · `reversed` — money leaving (`finance.payouts`).
`reversed` (Decision #202): sent, then wholly reversed by the platform and returned to the wallet; a
partial reversal stays `paid` with `reversed_cents`.

`inbound_payment_status`: `requires_payment` · `processing` · `succeeded` · `settled_unapplied` ·
`failed` · `canceled` — money entering (`finance.inbound_payments`, §10). `settled_unapplied` (Decision
#200) is a settled payment whose escrow lock or checkout order was refused after the credit: the money
is in the wallet's ledger, the purpose was not applied. The spelling follows Stripe's PaymentIntent
(`canceled`, one `l`) because these are the processor's own states, recorded as received; the
payout enum's `cancelled` is Projective's word for its own act. Mirrored member-for-member by the
Zod `InboundPaymentStatus` (`payments.contract.test.ts` reads the migration and fails on drift).

### `finance.purchasable_item_kind`

`digital_product` · `project_ticket` · `one_off_project` · `one_off_task` · `service_ticket` ·
`one_off_service` · `single_service_task` · `service_session` · `set_session` ·
`course_group_session` · `paid_revision`

A **closed** vocabulary, in this exact order, mirrored member-for-member by the Zod SSOT. It encodes
three axes at once: **what** is bought (product · ticket · whole project/service · session), **who**
delivers it (a project the buyer owns vs a seller's catalogue service), and **how** it is delivered
(pipeline ticket · one-off · single task · session · set of sessions · cohort). `paid_revision`
(Decision #167, appended last) is one extra revision round on a ticket.

### `finance.card_brand`

`visa` · `mastercard` · `amex` · `discover` · `unionpay` · `apple_pay` · `google_pay` · `vault` ·
`unknown`

A **display** vocabulary — nothing routes money by reading it.

> **⚠️ Two axes are knowingly collapsed.** Stripe returns the network in `card.brand` and the wallet
> wrapper separately in `card.wallet.type`; `apple_pay`/`google_pay` are **wrappers around an
> underlying network card**, not networks. They are folded into one enum because that is how a buyer
> recognises a saved instrument, at the cost of losing the underlying network when a wallet is used.
>
> **⚠️ Stripe brands this enum does not carry** — `diners`, `jcb`, `eftpos_au` — currently land in
> `unknown`, losing a real display fragment. Adding them is a one-line enum change; whether to is a
> product decision (root `CLAUDE.md` §8).
>
> `vault` is the internal Projective Vault Card (platform-issued spend against a wallet balance,
> never a Stripe network card). `unknown` is the mandatory fallback so an unrecognised brand
> degrades to a neutral fragment instead of failing the write.

---

## 10. Inbound payments — the Stripe fiat rails (Decision #125)

Projective is the **ledger of record**; Stripe is the card rail. A card payment is charged on the
**platform** account (Separate Charges & Transfers — see root `CLAUDE.md` Decision #125 for why this
is not a destination charge) and the money it brings in becomes a normal ledger credit to a wallet.
From there the escrow engine works exactly as it does for wallet-funded money. Zod SSOT:
`packages/types/finance/payments.ts`. Functions: [Functions.md §Stripe fiat rails](Functions.md).

### `finance.inbound_payments`

One row per **attempt** to move money into a wallet from an external instrument — the twin of
`finance.payouts`. It exists because nothing else can hold the fact: `finance.transactions` records
only completed movements, so a started-but-unpaid payment has nowhere to live and a declined one
would leave no trace; `finance.orders` records basket purchases, not top-ups or escrow funding.

| Column                  | Type                             | Notes                                                                                                                                                                                                                    |
| :---------------------- | :------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | uuid                             | PK.                                                                                                                                                                                                                      |
| `purpose`               | text                             | `wallet_topup` or `escrow_lock` (CHECK).                                                                                                                                                                                 |
| `wallet_id`             | uuid                             | NOT NULL. FK → `finance.wallets` (**RESTRICT** — a wallet that has taken money must not take the record of it with it). The payer's own wallet for a top-up; the paying business's for an escrow lock.               |
| `project_stage_id`      | uuid                             | NULL. FK → `projects.project_stages` (`SET NULL`). Only an `escrow_lock` may name one (one-directional CHECK, because a stage retired later keeps its payment history).                                                 |
| `ticket_id`             | uuid                             | NULL. FK → `projects.tickets` (`SET NULL`). The ONE ticket an `escrow_lock` funds (Decision #166): the amount is that ticket's price and settlement holds only its escrow (`projects.fund_ticket`). NULL funds the whole stage. Only an `escrow_lock` may name one (CHECK `inbound_payments_ticket_only_for_locks`). |
| `revision_id`           | uuid                             | NULL. FK → `projects.stage_revision_requests` (`RESTRICT` — a nulled round would settle as a whole-stage lock). The ONE paid revision round an `escrow_lock` pays for (Decision #199): the amount is the round's `price_cents` and settlement runs `projects.fund_paid_revision`. Only on an `escrow_lock` that names no `ticket_id` (CHECK `inbound_payments_revision_only_for_locks`); indexed `idx_inbound_payments_revision`. A stage's own lock reads exclude these rows (`latestLockPayments`). |
| `amount_cents`          | bigint                           | NOT NULL, `> 0`. What the payer was asked to pay.                                                                                                                                                                        |
| `currency`              | char(3)                          | NOT NULL, `^[A-Z]{3}$`. Always the receiving wallet's currency.                                                                                                                                                          |
| `amount_received_cents` | bigint                           | NULL until settlement. What Stripe reports it received — **the ledger is credited with this**, because it is the money that exists.                                                                                      |
| `status`                | `finance.inbound_payment_status` | NOT NULL `DEFAULT 'requires_payment'`. Moved ONLY by the webhook's processor doors. `succeeded` and `settled_unapplied` are the two settled states (the money is credited); `settled_unapplied` ⇔ `unapplied_reason` (CHECK `inbound_payments_unapplied_has_reason`). |
| `lock_status`           | text                             | `not_applicable` · `pending` · `locked` · `failed`. `not_applicable` ⇔ `wallet_topup` (CHECK).                                                                                                                           |
| `lock_error`            | text                             | Why a lock failed; allowed only while `lock_status = 'failed'`. A failed lock loses nothing — the money stays in the paying wallet.                                                                                    |
| `locked_escrow_ids`     | uuid[]                           | NOT NULL `DEFAULT '{}'`. The escrows this payment's lock created, so a chargeback freezes exactly the capital it funded.                                                                                                 |
| `provider`              | text                             | NOT NULL `DEFAULT 'stripe'`.                                                                                                                                                                                             |
| `provider_ref`          | text                             | The Stripe PaymentIntent id (`XXXX-XXXX` in docs). Written once by `finance.attach_card_payment`. `(provider, provider_ref)` UNIQUE.                                                                                     |
| `idempotency_key`       | text                             | NOT NULL UNIQUE. The payer's attempt key — a retry after an unseen timeout resolves to the SAME row, never a second charge. Also registered in `finance.idempotency_keys` (scope `card_payment:<uid>`).                  |
| `transaction_id`        | uuid                             | NULL. FK → `finance.transactions` (`SET NULL`, never fired: the ledger refuses DELETE). The `topup` ledger credit. Set **exactly** when the payment is settled (`succeeded` / `settled_unapplied`) — a settled payment without a ledger row is refused (CHECK `inbound_payments_credit_only_when_succeeded`, Decision #200). |
| `failure_reason`        | text                             | The processor's decline or cancellation code; allowed only while `failed`/`canceled` (CHECK).                                                                                                                           |
| `livemode`              | boolean                          | NULL until settlement. Whether the settling event came from Stripe's live mode.                                                                                                                                         |
| `created_by`            | uuid                             | NOT NULL. FK → `auth.users` (RESTRICT). The escrow lock is re-authorised **as this user** at settlement, so a member who lost the right to spend in between cannot have a lock completed on their behalf.              |
| `checkout`              | jsonb                            | NULL. The checkout a card / express top-up pays for — `{basket_id, item_ids, currency, units, promo_code, order_key}` (ids and minor units only), written once by `finance.attach_checkout_order`. Allowed only on a `wallet_topup` (CHECK `inbound_payments_checkout_only_for_topups`). When set, settlement places the order as `created_by` (Decision #153). |
| `order_id`              | uuid                             | NULL. FK → `finance.orders` (`SET NULL`). The order that checkout placed — by the settling webhook or the browser, under one key.                                                                                         |
| `order_error`           | text                             | NULL. Why settlement could not place the order (a price that moved, a line withdrawn); the money stays in the wallet. `order_id`/`order_error` exist only with a `checkout` (CHECK `inbound_payments_order_only_with_checkout`). |
| `unapplied_reason`      | text                             | NULL. Why a `settled_unapplied` payment's purpose was not applied — "The escrow could not be held: …" or "The order could not be placed: …" (Decision #200); the detail stays in `lock_error` / `order_error`. Present exactly on `settled_unapplied` (CHECK). |
| `created_at`            | timestamptz                      | NOT NULL `DEFAULT now()`.                                                                                                                                                                                                |
| `updated_at`            | timestamptz                      | NOT NULL `DEFAULT now()`. For an unbound scheduled-deposit run it is also the retry lease: `claim_due_deposit_rules` re-offers the run only once it has been untouched for 15 minutes, and stamps it when it does. |
| `succeeded_at`          | timestamptz                      | Set exactly when the payment is settled — `succeeded` or `settled_unapplied` (bidirectional CHECK — the two are one fact stated twice).                                                                                 |

**Indexes:** `idx_inbound_payments_wallet` (`wallet_id, created_at DESC`) and the partial
`idx_inbound_payments_stage` on `project_stage_id`; the partial `idx_inbound_payments_unbound_deposits`
(`created_at` WHERE `deposit_rule_id IS NOT NULL AND provider_ref IS NULL AND status = 'requires_payment'`)
behind the deposit sweep's retry of unbound runs.

**Access:** RLS on. `authenticated` may SELECT a row whose wallet it may view
(`finance.fn_can_view_wallet`); **no client role may write** — every write goes through a
`SECURITY DEFINER` function ([Policies.md](Policies.md)).

> **No PII.** A payment row holds amounts, states, ids and the processor's own codes. The card, the
> payer's name and the billing address stay with Stripe; `provider_ref` is the pointer to them.

> **Individual clients lock escrow by card too.** `finance.escrows.payer_business_id` is nullable
> (Decision #126) and `ck_escrows_one_payer` requires exactly one of `payer_business_id` /
> `payer_user_id` (Decision #165 (D)), so `finance.begin_card_payment` takes an `escrow_lock` on a
> project with no `client_business_id` from its owner — only the owner may fund it — and the hold
> debits the owner's personal wallet in the project's currency.

### The Connect payout account (`finance.payout_accounts`, amended in place)

Documented in §1 "Other existing engine tables". Phase 1 made it usable: the status vocabulary is
now the one Stripe's `stripe_transfers` capability can actually report, `updated_at` records the last
reconciliation, and one active account per owner is enforced by a partial unique index. The owner is
resolved by `finance.fn_payout_owner` — a person's own payout owner (`fn_person_wallet_type`) or a
team they may bill for (`manage_billing`).

### Verification writes (`finance.verification_cases` + `org.freelancer_profiles`)

A Stripe Identity session opens a `verification_cases` row (`kind = 'kyc'`, `tier = 2`,
`provider = 'stripe_identity'`, `status = 'pending'`) and binds its session id once. Only the signed
`identity.verification_session.*` webhook moves it: `verified` → the case AND
`org.freelancer_profiles.kyc_status`/`kyc_tier`/`kyc_verified_at` (a verified subject never
regresses); `requires_input` → `rejected` with Stripe's error code; `canceled` → `expired`. The
freelancer's `payout_ready` is recomputed from the payout account, never set by a client.

## 🆕 Decision #197 — prepaid ticket escrow

- **`finance.escrows.payee_type` / `payee_id`** — nullable (edited in place in
  `00000017_tables_finance.sql`; no column or FK dropped). A client may fund a ticket, or a whole stage,
  before anybody claims it: the escrow is held at once with no payee, and the claim or assignment binds
  one (`finance.fn_bind_ticket_escrow`, from `projects.fn_ticket_escrow_sync`) without a second debit.
  `ck_escrows_payee_pair CHECK (num_nulls(payee_type, payee_id) IN (0, 2))`;
  `ck_escrows_unbound CHECK (payee_id IS NOT NULL OR (revision_id IS NULL AND cohort_membership_id IS
  NULL AND (status = 'refunded' OR (status = 'held' AND ticket_id IS NOT NULL))))` — an unbound escrow
  is only ever a held base ticket escrow or a refunded one, so it can never be released to nobody.
  `uq_escrows_ticket_base_held` (#189) still allows one held base escrow per ticket, bound or not.
  Every payee reader filters by equality (`payee_id = …`), so an unbound row matches no payee and the
  payee's RLS policy shows it only to the payer.

## 🆕 Decision #126 — money movement after the fiat rails

- **`finance.escrows`** — `payer_business_id` is nullable and `payer_user_id` joined it, with
  `ck_escrows_one_payer CHECK (num_nonnulls(payer_business_id, payer_user_id) = 1)`. The business FK is
  unchanged; only its `NOT NULL` moved into the CHECK, on the product owner's instruction (closes
  #56(a)/#125(b)): an individual client pays with zero friction (PRODUCT_SPEC §Escrow #5). The payer's
  WALLET is `finance.fn_escrow_payer_wallet_type` — `business`, or the person type they hold.
- **`finance.inbound_payments.deposit_rule_id`** (FK → `finance.deposit_rules`, SET NULL) — the standing
  rule that charged a payment off-session; `inbound_payments_rule_only_for_topups` keeps it to top-ups.
- **`finance.deposit_rules.created_by`** (FK → `auth.users`, SET NULL) — who authorised the standing
  charge. Stamped only by `finance.create_deposit_rule`; the derived-column guard makes a client row
  start it empty (and so never run).
- **`finance.chargebacks.unrecovered_cents`** (≥ 0) — on a LOST dispute, the part of the clawback the
  payer's wallet could not cover (the platform's loss). `chargebacks_resolved_matches_status` ties
  `resolved_at` to the three closed states.
- **`finance.processor_customers`** (new) — one Stripe Customer per finance owner per provider
  (`uq_processor_customers_owner`, `uq_processor_customers_ref`), the anchor a saved card attaches to.
  Definer-only (RLS on, no policy, no client grant); no PII, the `cus_…` id only.
- **`finance.payouts`** — `transaction_id` is now set when the payout BEGINS (the wallet is debited at
  once, so money in flight cannot be spent twice); a failed payout keeps it and is balanced by a
  `payout_reversal` credit. `paid` means the Stripe Transfer exists (the money left Projective for the
  owner's Connect account, which pays the bank on Stripe's schedule).
