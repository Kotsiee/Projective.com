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
  future migration flagged for human sign-off (root `CLAUDE.md` §8).
- **Fund-state projection.** The three-state balance is a **projection**, never stored on the
  wallet: `locked` (in escrow) · `pending` (7-day window, `finance.pending_releases`) · `available`
  (`wallets.balance_cents`) · `on_hold` (Dispute Lockbox, `escrows.status='disputed'`). See
  `finance.fund_state`.
- **Hidden-ledger posture.** Most `finance.*` tables are **definer-only** (RLS enabled, no policy,
  no `authenticated` grant) — reachable only through `SECURITY DEFINER` RPCs
  (`org.get_business_finance`, the `projects.*` stage wrappers). `finance.escrows` is the exception
  (explicit `GRANT SELECT` + policy). New user-facing tables below each ship their own RLS policy.

---

## 1. Core engine (existing — migrations `0009`, `0305`, `0310`)

### `finance.wallets`

The tiered vault. One row per `(owner_type, owner_id, currency)`.

| Column          | Type   | Notes                                                                    |
| :-------------- | :----- | :----------------------------------------------------------------------- |
| `id`            | uuid   | PK.                                                                      |
| `owner_type`    | text   | `user` / `freelancer` / `business` / `team` / `organisation` / `system`. |
| `owner_id`      | uuid   | The owning entity.                                                       |
| `currency`      | text   | ISO-4217 origin currency.                                                |
| `balance_cents` | bigint | **Materialised** Available balance (`CHECK >= 0`).                       |
| UNIQUE          | —      | `(owner_type, owner_id, currency)`.                                      |

> **Hidden system wallets** (Escrow Pool, Fee Collection, Dispute Lockbox — `finance-model.md` §6)
> are the canonical model but are **not yet materialised** as `owner_type='system'` rows: the engine
> tracks held capital via `finance.escrows` and the platform fee via `escrows.platform_fee_cents`
> rather than crediting system wallet rows. Materialising them is a future additive step.

### `finance.transactions`

Append-only per-wallet ledger line with a running balance and (additively) an FX snapshot.

| Column                | Type        | Notes                                                                           |
| :-------------------- | :---------- | :------------------------------------------------------------------------------ |
| `wallet_id`           | uuid        | FK → `finance.wallets` (CASCADE).                                               |
| `direction`           | text        | `credit` / `debit`.                                                             |
| `amount_cents`        | bigint      | `CHECK > 0`.                                                                    |
| `currency`            | text        | Origin currency.                                                                |
| `reason`              | text        | Canonical code (see below).                                                     |
| `ref_table`,`ref_id`  | text,uuid   | Nullable source pointer (usually `escrows`).                                    |
| `balance_after_cents` | bigint      | Running balance after this line.                                                |
| `fx_rate`             | numeric     | **Additive** (`20260723090000`). Rate applied to reach `fx_base`, if converted. |
| `fx_base`             | char(3)     | **Additive.** The base currency (usually GBP).                                  |
| `fx_as_of`            | timestamptz | **Additive.** The `finance.fx_rates.as_of` the rate was snapshotted from.       |

**Canonical `reason` codes:** `escrow_hold`, `escrow_release`, `escrow_refund`, `fair_exit_release`,
`fair_exit_refund`, `team_split`, `demo_opening_credit`, and the refund/chargeback lines `refund`,
`chargeback` (negative-direction entries). Refunds and chargebacks are ledger movements, not a
separate table of amounts (see `finance.chargebacks` for the dispute case they reference).

### `finance.escrows`

Capital locked against a stage/ticket. Text `status`, values used by the engine: `held` (on hold) →
`released` / `refunded`; `disputed` (Dispute Lockbox); table default `funded` (rarely persisted).

| Column                         | Type                 | Notes                                             |
| :----------------------------- | :------------------- | :------------------------------------------------ |
| `project_stage_id`             | uuid                 | FK → `projects.project_stages` (RESTRICT).        |
| `ticket_id`                    | uuid                 | FK → `projects.tickets` (SET NULL).               |
| `payer_business_id`            | uuid                 | FK → `org.business_profiles` (RESTRICT).          |
| `payee_type`,`payee_id`        | assignment_type,uuid | `freelancer` or `team` payee.                     |
| `amount_cents`                 | bigint               | Principal (`CHECK > 0`).                          |
| `platform_fee_cents`           | bigint               | Fee applied at release (0 while held).            |
| `deadline_bonus_cents`         | bigint               | Optional bonus.                                   |
| `currency`                     | text                 | Origin currency.                                  |
| `status`                       | text                 | `held`/`released`/`refunded`/`disputed`/`funded`. |
| `fx_rate`,`fx_base`,`fx_as_of` | —                    | **Additive** FX snapshot (`20260723090000`).      |

### Other existing engine tables

| Table                             | Purpose                                                                                                                                                                                                                      |
| :-------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.payout_accounts`         | Provider payout destination (Stripe **Connect** account); `(provider, account_id)` UNIQUE. Owner-scoped. See the flagged overlap with the new `finance.payment_methods`.                                                     |
| `finance.invoices`                | Per-stage or `consolidated_monthly` invoice; `status` draft/issued/paid/overdue/void; `pdf_file_id` → `files.items`.                                                                                                         |
| `finance.invoice_line_items`      | Invoice lines; `ref_type` ∈ escrow/bonus/platform_fee/refund/tax.                                                                                                                                                            |
| `finance.disputes`                | A contested escrow (`escrow_id` FK); `dispute_status` open/under_review/resolved/refunded.                                                                                                                                   |
| `finance.dispute_messages`        | Threaded dispute conversation.                                                                                                                                                                                               |
| `finance.spending_limits`         | **Per-member spending CAP** on a pooled wallet: `wallet_id`,`member_user_id`,`cap_cents`,`period_interval` (weekly/monthly/total),`spent_cents`,`resets_at`. This IS the "spending caps" model — formalised, not duplicated. |
| `finance.contribution_agreements` | Team member's `percent_bp` split share; `(team_id, member_user_id)` UNIQUE.                                                                                                                                                  |
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

> The FX **snapshot columns** on `finance.transactions` and `finance.escrows` are listed with those
> tables above. **Store-in-origin is already satisfied everywhere** — every priced entity already
> carries a `currency` (`finance.*`, `projects.projects`, `projects.tickets`/`project_stages` via
> the project, `marketplace.service_blueprints`), so **no** currency column is added to a priced
> entity here. ⚠️ **FX economics (who bears the spread / how the conversion fee is charged) is
> OPEN** — flagged in root `CLAUDE.md` §8, not decided in schema.

---

## 3. KYC / KYB verification (additive — `20260723091000`)

### `finance.verification_cases`

The auditable identity/business verification trail. **No PII** — only opaque provider references.

| Column         | Type                 | Notes                                                     |
| :------------- | :------------------- | :-------------------------------------------------------- |
| `subject_type` | text                 | `freelancer`/`business`/`organisation`/`user`.            |
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
(`org.user_emails.verified_at`, migration 0312). Organisations keep their own
`org.organisation_verification_level` (0314). The gating rule (freelancer onboarding gate; clients
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
| `finance.vault_permissions` | Capability **grants** (not a single role) on a shared wallet: `wallet_id`, `member_user_id`, `capabilities finance.vault_capability[]` (view/add_funds/spend/distribute/withdraw/manage_members/manage_billing). `(wallet, member)` UNIQUE. ⚠️ overlaps `org.business_permission`/`org.team_permission` — reconcile (root `CLAUDE.md` §8).      |
| `finance.split_rules`       | Team smart-split **ruleset template**: `team_id`, `rule_type` (co_op/finders_fee/benevolent_dictator), `vault_bp` (Team Vault cut, taken first), `finder_user_id`+`finder_bp`. Resolves into the per-member `finance.contribution_agreements`. Deterministic remainder rounding: leftover minor unit → Team Vault.                              |
| `finance.spend_approvals`   | Over-cap / over-threshold second-approver queue: `wallet_id`, `requested_by`, `amount_cents`+`currency`, `status` (pending/approved/rejected/expired), `approver_user_id`.                                                                                                                                                                      |
| `finance.ledger_audit`      | Immutable who/when/amount trail for vault money moves: `wallet_id`, `actor_user_id`, `action finance.vault_action` (add_funds/spend/distribute/withdraw/transfer), `amount_cents`+`currency`, `metadata`. ⚠️ overlaps `security.audit_logs` (general) — kept separate for the amount-typed wallet-scoped read; reconcile (root `CLAUDE.md` §8). |

---

## 6. Statements, fund states, settlement (additive — `20260723094000`)

| Table / object                    | Purpose & key columns                                                                                                                                                                                                                                                                                                      |
| :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.pending_releases`        | One escrow release inside the 7-day safety window: `escrow_id`, `wallet_id`, `amount_cents`+`currency`, `released_at`, `available_at`, `state finance.fund_state`. Makes the "Pending" state first-class.                                                                                                                  |
| `finance.statements`              | Monthly consolidated statement (30-day window, issued on the 1st): `owner_type`/`owner_id`, `period_start`/`period_end`, `opening`/`closing`/`total_in`/`total_out`/`total_fees` cents, `status` (draft/issued/final), `pdf_file_id`. Complements per-payout `finance.invoices`. `(owner, period_start, currency)` UNIQUE. |
| `finance.chargebacks`             | The Stripe dispute case a negative ledger line references: `wallet_id`/`transaction_id`/`escrow_id`, `provider_ref`, `amount_cents`+`currency`, `status` (opened/under_review/won/lost/refunded).                                                                                                                          |
| `finance.idempotency_keys`        | Retries never double-move money: `key` (PK), `scope`, `request_hash`, `status`, `response`, `expires_at`. **Definer-only** (RLS on, no policy).                                                                                                                                                                            |
| `finance.v_wallet_reconciliation` | **View.** Internal self-consistency: `balance_cents` vs the running ledger sum → `drift_cents` (must be 0). External Stripe-balance reconciliation is an ops job (`SYSTEM_ARCHITECTURE.md` §Integration Blueprints). Exposed to `service_role` only.                                                                       |

---

## 7. Subscriptions, plans & entitlements (additive — `20260724112000` / `20260724113000`)

The **PAID ladder**. Zod SSOT: `packages/types/finance/plans.ts` + `entitlements.ts`.

> **The three axes** (`finance-model.md` §1.1). **Execution capacity** — how much work a freelancer
> may hold concurrently — is **never monetised**; it stays governed by the Workload Intensity ($W_i$)
> caps. Only **distribution** (outbound proposals) and **marketplace footprint** (live public
> projects, published listings, entities owned, seats, promoted placement) are tiered.
>
> **And a plan can never buy reputation.** Nothing in these tables writes to `org.entity_standing`.
> The two ladders stack — earn it, or accelerate it — but a rung is never for sale.

| Table                                | Purpose & key columns                                                                                                                                                                                                                                                                                                                        |
| :----------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance.plans`                      | The catalogue: `code` (UNIQUE), `audience`, `tier`, `price_cents`+`currency`, `billing_interval`, `is_custom_priced`, `per_seat_cents`, `is_default` (one per audience — partial UNIQUE index), `provider_price_ref`. Seeded with the 8 plans below.                                                                                          |
| `finance.plan_entitlements`          | What a plan grants: `entitlement_key`, `kind` (limit/flag), `limit_value`, `is_unlimited`, `flag_value`, `scaling` (none/standing_base/standing_bonus), `multiplier_bp`. `(plan, key)` UNIQUE.                                                                                                                                               |
| `finance.subscriptions` _(extended)_ | The 0009 skeleton gained `subject_type`/`subject_id`, `plan_id` FK, `state`, `billing_interval`, `current_period_start`/`_end`, `cancel_at_period_end`, `trial_ends_at`, `seats`, `price_cents`+`currency`, `provider`/`provider_ref`, `created_at`/`updated_at`. Partial UNIQUE: one live subscription per subject.                          |
| `finance.subscription_events`        | Billing audit trail: `event_type` (started/upgraded/downgraded/renewed/payment_failed/paused/resumed/cancelled/expired), `from_plan_id`/`to_plan_id`, `amount_cents`, `provider_ref`.                                                                                                                                                        |
| `finance.entitlement_grants`         | Manual overrides (comps, trials, negotiation): `entitlement_key`, `limit_value`/`is_unlimited`/`flag_value`, `reason`, `granted_by`, `starts_at`/`expires_at`. A grant may only **raise** an effective limit, never lower it — a misconfigured comp can never suffocate a paying subject.                                                     |
| `finance.standing_commission_tiers`  | The **earned** marketplace-commission taper keyed to `org.standing_levels.level`: 8% · 8% · 7.5% · 7% · 6.5%. `platform_fee_bp` is `NULL` at every rung — the 5% service fee does **not** taper with Standing.                                                                                                                               |
| `finance.negotiated_rates`           | The one sanctioned flex of the 5%: `subject_type` (business/organisation), `platform_fee_bp`, optional `marketplace_commission_bp`, `minimum_volume_cents`, `contract_ref`, `approved_by`, `starts_at`/`ends_at`, `status`. Explicit, admin-approved, time-boxed — never an implicit consequence of holding a plan.                           |
| `finance.allowance_periods`          | Metered distribution, one live row per `(subject, key, period_start)`: `granted_units`, `consumed_units`, `base_units`, `standing_bonus_units`, `buffer_units`, `buffer_cap`, `buffer_refreshed_at`.                                                                                                                                         |
| `finance.allowance_ledger`           | Append-only consumption record behind "42/50 used this week": `period_id`, `units` (negative = refund), `reason`, `ref_table`/`ref_id`.                                                                                                                                                                                                      |

### The seeded plans

| Code                | Audience     | Price              | Notes                                                                                                                                              |
| :------------------ | :----------- | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| `individual_free`   | individual   | £0                 | The universal baseline. A freelancer is a superset of a client, so this carries the full buyer baseline too — there is **no separate client plan**. |
| `individual_pro`    | individual   | £12.99/mo          | Accelerates footprint + distribution.                                                                                                              |
| `team_free`         | team         | £0                 | A team needs ≥ 2 members to send proposals.                                                                                                        |
| `team_pro`          | team         | £29/mo per team    | Pre-existing rate (`finance-model.md` §1.3).                                                                                                       |
| `business_free`     | business     | £0                 | Pooled wallet in basic mode; KYB still gates operation.                                                                                            |
| `business_pro`      | business     | **`NULL` (TBD)**   | ⚠️ Entitlements seeded, **price not set** — flagged, root `CLAUDE.md` §8.                                                                          |
| `organisation_free` | organisation | £0                 | Free-to-draft; going active + adding seats needs the paid tier.                                                                                    |
| `organisation`      | organisation | Custom, seat-based | Keyed to `org.employee_scale`. The only place the platform fee may flex.                                                                            |

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

| Lever                     | Team Free | Pro Team (£29)  | Lever                      | Business Free | Business Pro |
| :------------------------ | :-------- | :-------------- | :------------------------- | :------------ | :----------- |
| `team_seats`              | 4         | 15              | `business_public_projects` | 3             | 25           |
| `team_public_projects`    | 2         | 15              | `business_managers`        | 2             | 15           |
| `weekly_proposals` (pool) | 50        | 150 (dedicated) | `departments`              | 0             | 5            |
| `advanced_vault_splits`   | —         | ✅              | `pooled_wallet_full`       | basic         | ✅           |
| `promoted_placement`      | —         | ✅              | `intervaled_invoicing`     | —             | ✅           |

The Organisation tier is unlimited on seats/businesses/departments/projects and adds `sso_enabled`,
`api_access`, `audit_log_retention_days` (730), `dedicated_support` and `negotiated_platform_fee`.

> **Ownership ≠ power.** Raising `teams_owned`/`businesses_owned` on a _personal_ plan lets a user
> spin up more entities; each entity still pays for its own muscle through its own plan. That split
> is why there are two payment planes rather than one.

---

## 8. Enums (this schema)

`finance.kyc_status`, `finance.method_role`, `finance.deposit_interval`, `finance.payout_mode`,
`finance.pot_purpose`, `finance.vault_capability`, `finance.split_rule_type`,
`finance.approval_status`, `finance.vault_action`, `finance.fund_state`, `finance.statement_status`,
`finance.chargeback_status`, `finance.plan_audience`, `finance.plan_tier`,
`finance.billing_interval`, `finance.subscription_state`, `finance.entitlement_kind`,
`finance.entitlement_scaling`, `finance.entitlement_key`. See [`../Schemas.md`](../Schemas.md) for
the global enum registry.
