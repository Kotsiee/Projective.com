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
  — credit a wallet **if one exists** (silent no-op otherwise); increments `balance_cents` and
  appends a `transactions` line with the new `balance_after_cents`.
- **`finance.fn_wallet_debit(...)`** — the debit counterpart (the `balance_cents >= 0` CHECK
  enforces sufficient funds).
- **`finance.fn_check_spending_limit(wallet_id, member, amount)`** → boolean — enforces a member's
  `finance.spending_limits` envelope and counts the spend against it, **atomically** (rewritten
  2026-09-28, signed off by the product owner): the row is locked `FOR UPDATE`, the period is rolled
  when lapsed (`weekly` / `monthly` to the next week/month boundary; `total` never resets), the
  `per_transaction_cents` ceiling and the remaining cap are checked, and the spend is added — so two
  concurrent spends cannot both fit under one cap. A `NULL` cap is "no ceiling"; no row at all is
  "no envelope" (true). The previous body read then wrote without a lock, ignored
  `per_transaction_cents` and `period_interval`, and so counted a lifetime total as the month.
- **`finance.fn_person_wallet_type(user)`** → text (2026-09-28) — the wallet type a person actually
  holds: an existing `freelancer` wallet wins over a `user` one; with none, a freelancer profile means
  `freelancer`, else `user`.
- **`finance.fn_ensure_wallet(owner_type, owner_id, currency)`** → uuid (2026-09-28) — the owner's
  wallet in that currency, created if missing. Exists because `fn_wallet_credit` is a silent no-op on
  a missing wallet, so a credit must never be aimed at one.
- **`finance.fn_team_split_plan(team_id, payout)`** → jsonb (2026-09-28) — the team payout plan
  (finance-model §5), **one implementation** read by the release and by the console's preview, so
  what a team is shown it will receive is what it receives. Integer arithmetic, floored at every cut:
  `benevolent_dictator` → everything to the vault; `finders_fee` → the finder's fixed cut first, then
  co-op on the remainder; `co_op` → the vault's `vault_bp`, then each ACTIVE member's `percent_bp` of
  the rest, and whatever does not divide (or is unallocated) is dust to the vault. No active rule =
  co-op with no vault cut. Returns `{payout_minor, rule_type, vault_bp, finder_user_id, finder_minor,
  vault_minor, members:[{member_user_id, percent_bp, amount_minor}], dust_minor, vault_total_minor}`.
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

- **`finance.fn_hold_ticket_escrow(ticket_id)`** → escrow id — holds escrow at claim (spending-cap
  checked; debits the payer business wallet; prefers an accepted team assignment as payee). The
  envelope checked is the **SPENDER's — the project owner** (`projects.projects.owner_user_id`) who
  commits the business's money (fixed 2026-09-28): it used to check `auth.uid()`, which here is the
  freelancer whose claim triggered the hold and who never has an envelope on the payer's wallet, so
  every hold was waved through. Over the envelope now raises `55000` (`spend: …`).
- **`finance.fn_release_ticket_escrow(ticket_id)`** — releases held escrow to the payee, applying
  the canonical **5%** fee (`security.platform_params.platform_fee_bp = 500`, set in `0305`) and
  routing team payees through `fn_split_team_payout`.
- **`finance.fn_refund_ticket_escrow(ticket_id)`** (`0310`) — refunds held escrow to the payer (used
  by claim-TTL "parking" auto-release); no fee is applied to a refund.
- **`finance.fn_fair_exit_release(ticket_id, bp)`** (`0305`) — the 25/50/75 fair-exit split: pays
  the payee `bp` basis-points of the principal (net of fee), refunds the remainder to the client.
- **`finance.fn_generate_consolidated_invoice(business_id, start, end)`** — consolidates a period's
  released escrows/fees/bonuses into one itemised `consolidated_monthly` invoice.
- ~~`finance.fn_seed_business_wallet()`~~ — **removed 2026-09-28** with its trigger
  `trg_seed_business_wallet`. It credited every new business wallet 2,500,000 minor units of
  `demo_opening_credit` in whatever currency it was opened in — spendable funds nobody had paid in. No
  wallet is minted money; a balance is only ever the sum of real movements.

## Additive foundation (2026-07-23)

### Authorization / gating predicates

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
- **`finance.fn_owner_capability(owner_type, owner_id, cap)`** → boolean (`00001210`, 2026-09-23) —
  the **owner**-keyed form of the vault gate, for tables that belong to a principal rather than a
  wallet (`payment_methods`, `saved_cards`, `payout_schedules`). Admin, or self for a personal owner
  (`user`/`freelancer`), or — for a shared owner — `fn_owner_visible` **and** `cap` on one of that
  owner's wallets. It exists because bare membership (`fn_owner_visible`) had been the write rule
  on those tables, letting any member of an entity re-route its payouts or manage its cards.
  ⚠️ **Fails closed** like `fn_can_manage_basket`: a shared owner with no wallet has nobody who
  holds the capability.
- **`finance.fn_freelancer_payout_ready(user_id)`** → boolean (`20260723091000`) — true only when
  the freelancer is KYC-`verified` AND `payout_ready`. **The onboarding gate.**
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

## Stage-level wrappers (in `projects`, invoke this engine — migration `0305`)

`projects.fund_stage`, `projects.approve_stage`, `projects.cancel_stage_fair_exit`,
`projects.get_stage_finance` — all `SECURITY DEFINER`, guarded by `projects.has_project_access`.
These are the client-facing Finance-tab actions; they call the `finance.*` engine above. (The 0309
business-dashboard read `org.get_business_finance` was retired 2026-09-28; an entity's balances are
read under RLS by the wallet surface, and its console reads through `org.get_workspace_detail`.)

**`projects.fund_stage` spends the client's money, so it checks the payer, not just project
access** (2026-09-23, `00001150`). Project access alone admitted every participant — a hired
freelancer could fund the client's escrow from the client's wallet. It now resolves the payer
from `projects.projects.client_business_id` (NULL → `PS501`: an individual client has no escrow
path, #56(a)) and requires `finance.fn_owner_capability('business', payer, 'spend')`, else `42501`
("Only a member who can spend from the client's wallet can fund this stage."). The KYB gate on
funding (Decision #54(e)) is **not** added here — that behavioural change still needs sign-off.

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
  `user`/`freelancer` â†’ `individual`; `team` â†’ `team`; `business` â†’ `business`; `organisation`
  â†’ `organisation`.
- **`finance.fn_active_plan(subject_type, subject_id) â†’ uuid`** â€” the subject's live plan
  (`state IN ('trialing','active','past_due')` and not past `current_period_end`), falling back to
  its audience's default free plan. **Every subject always resolves to a plan** â€” there is no
  unentitled state.
- **`finance.fn_subject_standing_level(subject_type, subject_id) â†’ smallint`** â€” defers to
  `org.fn_standing_level` for earning subjects; buyer subjects (`business`/`organisation`) resolve
  to rung `1`, because they carry the Client Trust Score rather than Standing.

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
  admin-approved `finance.negotiated_rates` row for an Organisation/Business volume commitment.

### Allowance metering

- **`finance.fn_current_allowance(subject_type, subject_id, key) â†’ finance.allowance_periods`**
  â€” opens or rolls the weekly period (`date_trunc('week', now())`), snapshotting `granted_units`
  with its `base_units` / `standing_bonus_units` provenance so a mid-week upgrade or promotion is an
  explicit new grant rather than a silent drift. Also applies the lazy buffer drip. Emits
  `allowance.period_rolled` / `allowance.buffer_replenished`. **`service_role` only** — it takes any subject, so a client grant would disclose other people's
  allowances; a self-scoped wrapper is how a viewer should see their own.
- **`finance.fn_consume_allowance(subject, units, key, reason, ref_table, ref_id) â†’ boolean`** â€”
  spends units. Requires **both** weekly headroom and a buffer token, so a week's allowance can
  never be dumped into one hour of spam. Emits `allowance.consumed` on success and
  `allowance.exhausted` on refusal â€” the refusal is recorded either way, because the denial rate
  is the upgrade signal. **`service_role` only.**
- **`finance.fn_refund_allowance(...) â†’ boolean`** â€” returns units (a withdrawn proposal should
  not cost the week's allowance). **`service_role` only.**

### Footprint

- **`finance.fn_footprint_usage(subject_type, subject_id, key) â†’ integer`** â€” live counts for
  `active_public_projects` / `business_public_projects` / `team_public_projects` (from
  `projects.projects` where `status IN ('active','on_hold')` **and** `visibility = 'public'`),
  `teams_owned`, `businesses_owned` (an **archived** entity no longer occupies a slot — the create
  refusal tells an owner at their limit to "archive one or upgrade", which is only true if it frees one),
  `team_seats`, `organisation_seats`.

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

## 🧺 Basket authorization predicates (`00001210`)

Both **compose** the §Authorization helpers above rather than restating membership logic — there is
exactly one answer in this schema to "may this caller reach that owner's money", and these narrow
it, never re-derive it.

- **`finance.fn_can_manage_basket(owner_type, owner_id)`** → boolean — may the caller **write** this
  owner's basket? Personal (`user`/`freelancer`) → self only. Shared (`business`/`team`/
  `organisation`) → `fn_owner_visible` **and** the `spend` vault capability on one of that owner's
  wallets, i.e. the same grant that would let the member actually pay for the line. Admin passes. ⚠️
  **Fails closed**: an entity with no wallet, or with no `vault_permissions` rows, has nobody who
  may write its basket. That is the correct posture for a spend surface — a silent fallback to "any
  member" would make the capability decorative — but vault provisioning must precede shared-basket
  use. (For a team or business it now always does: `org.create_workspace` opens the wallet and the
  wallet insert trigger projects the grants. The projection covers teams and businesses only — an
  organisation's vault grants are not written by it.)
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
(themselves first, then each team, business and organisation they own or are an **active** member
of). Both return the one shape the internal builder `finance.fn_purchase_owner_json` produces, so the
application maps it once:

`owner_type · owner_id · name · handle · avatar_bucket · avatar_path · is_member · can_spend ·
kyb_status · currency · invoicing_mode · billing_day · billing · person · departments`

| Owner kind     | Who gets an answer                    | What a non-member sees                                   |
| :------------- | :------------------------------------ | :------------------------------------------------------- |
| `user`         | the person themselves (or admin)      | `NULL` — a person answers only about themselves          |
| `team`         | anyone                                | the public face (name, handle, avatar); no billing facts |
| `business`     | anyone                                | the public face; KYB, currency, invoicing and `billing` are `NULL` |
| `organisation` | members only                          | `NULL` — not even that the id exists                     |

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
`fn_owner_capability`; the monthly mode additionally requires the business to be KYB-verified, the
same gate the checkout's `invoice` provider applies. Returns `{ invoicing_mode, billing_day }`.

### `finance.place_wallet_order(p_basket_id, p_item_ids, p_currency, p_units, p_promo_code, p_idempotency_key)` → jsonb

Pays for the submitted basket lines from the caller's Projective wallet, in **one transaction**:

1. **Idempotency first.** An order already carrying `p_idempotency_key` is returned with
   `replayed: true` and nothing is charged. A key belonging to an order the caller cannot see is
   refused (`42501`).
2. **The basket** is locked `FOR UPDATE`; the caller needs `fn_can_manage_basket`; a business or
   organisation payer must be KYB-verified (`PK403`).
3. **The lines are exactly the submitted ones** — live, selected, not parked, not purchased — or the
   call refuses (`PC409`). A basket changed in another tab cannot widen or narrow the charge.
4. **Every line is re-priced from the catalogue.** Digital products only (`PS501` otherwise — a
   service or session needs escrow, which requires a project stage and a business payer, root
   CLAUDE.md §8 #56(a)); the listing must still be published; its currency must be `p_currency`; it
   needs a delivery address (`PD422`); a buyer cannot buy their own listing (`PU422`); and
   `p_units ->> line_id` — the unit price the buyer was **shown**, in the listing's own currency — must
   equal the catalogue price now (`PC409`). The stored basket snapshot is never charged.
5. **The promo the buyer saw applied.** `p_promo_code` `NULL` → no promo, whatever code sits on the
   basket (a code the page refused applies nothing here either). Non-null → it must still be the
   basket's code, still valid, and applicable (a flat code only in its own currency) — or `PC409`.
6. **The wallet** in `p_currency` is locked (a personal owner's `user` and `freelancer` wallets are
   interchangeable) and must cover the net (`PF402`). A shared payer additionally clears its approval
   threshold and the member's spending limit (`PA403`).
7. **Money moves through the ledger primitives**: `fn_wallet_debit(… 'order_payment', 'orders', id)`
   on the buyer; per line, a pro-rata share of the promo (the remainder on the last line, so shares
   sum exactly), the 5% fee on what was actually paid for that line, and
   `fn_wallet_credit(… 'product_sale', 'orders', id)` of the rest to the seller — the owning team's
   wallet for a team listing, else the person's `freelancer`/`user` wallet. A seller with no wallet in
   the currency gets one first, because `fn_wallet_credit` is a silent no-op on a missing wallet.
8. **The record**: `finance.orders` (status `confirmed`, provider `wallet`, reference
   `PJ-YYYY-XXXXXX`, `platform_fee_minor` the summed per-line fees), one `finance.order_lines` row per
   line (fulfilment `download`, the first manifest entry's name, size and format, the licence), each
   basket line stamped `purchased_at`, the basket's promo cleared, the code's `redemption_count`
   incremented when it saved anything.

Returns `{ order_id, reference, status, charged_minor, currency, replayed }` — the charge in the
currency the wallet actually moved, never re-converted.

| SQLSTATE | Meaning                                        | Checkout blocker        |
| :------- | :--------------------------------------------- | :---------------------- |
| `42501`  | not signed in / may not spend / key not yours  | `not_authorised`        |
| `PK403`  | the paying business is not KYB-verified        | `verification_required` |
| `PB404`  | the basket no longer exists                    | `price_changed`         |
| `PC409`  | the basket, a price or the promo changed       | `price_changed`         |
| `PD422`  | a line needs a delivery address                | `missing_email`         |
| `PU422`  | the buyer's own listing                        | `unavailable_item`      |
| `PS501`  | a line the wallet cannot settle here           | `no_provider`           |
| `PF402`  | no wallet in the currency, or not enough in it | `insufficient_funds`    |
| `PA403`  | approval threshold or spending limit           | `spend_limit`           |
| `22023`  | a malformed attempt key                        | —                       |

> **Flagged, not decided.** The fee is the documented 5% (Decision #2) as a constant, while
> `security.platform_params.platform_fee_bp` — which governs escrow releases — is seeded `0`
> (#68(b)). The fee is retained rather than credited anywhere, because the platform's Fee Collection
> wallet is not materialised (#54(i)). And a sale credits the seller's **Available** balance:
> `finance.pending_releases` is keyed to an escrow, which a product sale does not have, so the 7-day
> pending window (#54(c)) cannot hold it yet.

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
business source must be KYB-verified (`PK403`); a vault source must clear the member's spending limit
(`PA403`) and hold the amount (`PF402`). The ledger lines are `transfer_out` / `transfer_in`, each
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
primitive is a silent no-op on a missing wallet). Every line carries `reason = 'team_distribution'`
and the distribution's id; the audit row records the requested amount and each share. Returns
`{ distribution_id, distributed_minor, requested_minor, currency, shares[], replayed }`.

### `finance.decide_spend_approval(p_approval, p_decision)` → jsonb

Approves or rejects a pending over-cap `finance.spend_approvals` request. The decider needs
**`approve_spend`** on the account (the workspace capability of the same name, projected onto the
vault; `manage_members` still implies it — changed 2026-09-28 from `manage_members`, which is the
owner-level grant that also carries `withdraw`, so making someone an approver that way would have
let them empty the pool) and may not be the requester — approving one's own over-cap spend would make
the cap decorative (`42501`). A request already decided is `PC409`; one past its `expires_at` is
marked `expired` instead of decided (expiry is applied lazily, at the next decision attempt — no
sweep marks it). A decision notifies the requester through `comms.fn_notify` (`spend.approved` /
`spend.rejected` — both now registered in the catalog, `00005010`). Returns `{ id, status }`.

| SQLSTATE | Meaning                                                  |
| :------- | :------------------------------------------------------- |
| `42501`  | not signed in, or not allowed on that wallet / request   |
| `22023`  | bad amount, wallet pair, decision or attempt key         |
| `PB404`  | the wallet or request no longer exists                   |
| `PX409`  | the two wallets hold different currencies               |
| `PK403`  | the paying business is not KYB-verified                  |
| `PA403`  | over the member's spending limit                         |
| `PF402`  | the wallet doesn't hold enough                           |
| `PD422`  | the team has no agreed split                             |
| `PC409`  | the spend request was already decided                    |

> **Flagged, not decided.** A distribution follows the stakes as agreed, with no platform fee and no
> vault retention taken at distribution time — the documented 5% fee → vault cut → stakes model
> (finance-model §5) applies when income ARRIVES. Since 2026-09-28 the release DOES apply it:
> `fn_split_team_payout` runs `fn_team_split_plan` (vault cut, finder's fee, stakes, dust to the
> vault), and `preview_team_split` shows the same plan. What remains open is only whether a later
> manual `distribute_vault` should re-apply a vault cut to money that already paid one on arrival.

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

### `finance.preview_team_split(p_team_id)` → jsonb

What the team's NEXT release will pay, by `fn_team_split_plan`. Any active member may read it. The
honest gross is the team's **oldest escrow still held** (principal + deadline bonus); the fee is
`security.platform_params.platform_fee_bp` of the principal. A team with nothing held has no
projection — `gross_minor`, `currency` and `fee_minor` are `NULL` (never an invented figure) and the
plan is the zero plan. Returns `{escrow_id?, gross_minor, currency, fee_minor, plan}`.

### `finance.save_spend_policy(p_business_id, p_patch)` → `{business_id, currency}`

A business's spend policy as a PATCH (a key present is a change, so absent ≠ null). Needs
`manage_finances`. Keys:

| Key                        | Effect                                                                                                                                                               |
| :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `currency`                 | Which of the business's wallets the threshold and limits apply to (default: its `default_currency`). The wallet is created if missing (`fn_ensure_wallet`).         |
| `approval_threshold_minor` | `finance.wallets.approval_threshold_cents`. `NULL` disables it; `0` is refused ("every spend needs a second approver" is a per-transaction ceiling of 0 instead). |
| `approver_ids`             | The member ids who hold `approve_spend` — everyone else does not.                                                                                                     |
| `contributor_ids`          | The member ids who hold `contribute_funds` — everyone else does not.                                                                                                  |
| `limits`                   | `[{member_id, can_spend, limit_minor, per_transaction_minor}]` — `can_spend` moves the `spend_funds` override; the two limits upsert `finance.spending_limits`.    |

Every per-member change obeys the member drawer's rules: never the caller's own row, never the
owner's (both are fixed points, not members of the lists), only someone the caller **outranks**, and
never a capability the caller does not hold. Capability moves go through
`org.fn_set_member_capability`, so "can spend" has one representation. Re-projects the whole vault;
audits `business.spend_policy_changed`.

### `finance.request_spend_approval(p_wallet, p_amount, p_reason, p_ref_table = NULL, p_ref_id = NULL)` → `{id, status}`

Asks for approval of a spend the caller's envelope does not cover. The wallet must be a business or
team wallet; the caller needs the `spend` vault capability; `p_amount > 0`; a reason of 1–400
characters; `p_ref_table` ∈ `projects` · `project_stages` · `tickets` · `basket_items` · `orders`. The
request must **genuinely need approval** — the SQL twin of `@projective/types/workspace`
`evaluateSpend`: over the per-transaction ceiling, over the remaining cap (a lapsed period counts as
nothing spent), or at/above the wallet's threshold — else `22023` ("within your limits and needs no
approval"). The currency is the wallet's and `expires_at = now() + 7 days` — both the server's, never
the caller's. Every other member holding `approve_spend` (or `manage_members`) on the wallet is
notified with `spend_approval.requested`.

It is the ONLY way a request is filed: the client INSERT policy (`"Request a spend approval"`,
`00002013`) and the `INSERT` table grant to `authenticated` (`00002520`) were removed with it, so a
direct PostgREST insert is refused and cannot skip the needs-approval check or choose its own
`currency` and `expires_at`.

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
never guessed at.

### Event bookkeeping (internal)

| Function                                          | Returns | What it does                                                                                                           |
| :------------------------------------------------ | :------ | :--------------------------------------------------------------------------------------------------------------------- |
| `finance.fn_claim_stripe_event(event_id, type)`   | boolean | Inserts `stripe:<event_id>` (scope `stripe.webhook`, expiring in 30 days); `false` when the event was already claimed. |
| `finance.fn_complete_stripe_event(event_id, out)` | jsonb   | Stores the outcome on the claimed key and returns it.                                                                  |
| `finance.fn_stripe_event_replay(event_id)`        | jsonb   | The stored outcome with `outcome = 'replayed'`. `LANGUAGE sql`.                                                        |

### Card payments — user doors

#### `finance.begin_card_payment(p_purpose, p_wallet_id, p_project_id, p_stage_id, p_expected_amount, p_currency, p_idempotency_key)` → jsonb

Opens (or replays) one `finance.inbound_payments` row and registers the attempt key
(`card_payment:<uid>`, 7 days, hashed with the request — the same key with a different request is
`22023`, a key still in flight for another request is `PX409`). A repeat of the same request returns
the existing row with `replayed: true`.

- **`wallet_topup`** — the caller's own wallet or a vault they may `add_funds` to; the currency must be
  the wallet's; the amount is the caller's.
- **`escrow_lock`** — the amount is **never the caller's**: it is the SUM of
  `COALESCE(ticket.unit_price_cents, stage.unit_price_cents)` over the stage's assigned, unfunded
  tickets — the rule `projects.fund_stage` escrows by. `p_expected_amount` is only a check: if the
  stage was re-priced since the payer looked, `PC409` says what it costs now. The caller needs project
  access and the `spend` capability on the client business's wallet (created on demand); the stage
  must be `assigned`; `p_wallet_id` must be NULL (the money is paid into the client's wallet).

#### `finance.attach_card_payment(p_payment_id, p_provider_ref)` → jsonb

Binds the PaymentIntent id (`^pi_…`) to the caller's own payment, write-once — a second, different id
is `PX409`, the same id again is a no-op.

#### `finance.abandon_card_payment(p_payment_id, p_reason)` → jsonb

Closes an attempt Stripe refused to create (`canceled`, and a lock `failed`). Only an unbound
`requires_payment` row is touched; anything else is returned unchanged, so it can never cancel a
payment that is already in Stripe's hands.

### Card payments — processor doors

#### `finance.settle_card_payment(p_event_id, p_provider_ref, p_amount_received, p_currency, p_livemode)` → jsonb

`payment_intent.succeeded`. Credits `p_amount_received` — what arrived, not what was asked for — to
the row's wallet (`reason = 'topup'`, `ref_table = 'inbound_payments'`), marks the row `succeeded`
and links the ledger line. A settlement in another currency, or of nothing, is `unmatched`, not a
credit. For an `escrow_lock` it then runs `projects.fund_stage` **as the payer who authorised it**
(`request.jwt.claim.sub` set to `created_by` for the call, restored after), inside a subtransaction:
the lock re-checks that person's access and spend right NOW, and a refusal rolls back only the lock —
the money stays in the wallet and `lock_error` says why. A short arrival fails the lock the same way.
The escrows it created are recorded in `locked_escrow_ids`. Notifies `escrow.funded` or
`wallet.topup_succeeded` (with the lock failure spelled out when there was one).

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
destination account's owner all agree; anything else is `unmatched`. Moves no money — the payout's own
flow owns the ledger debit. Since Decision #126 withdrawals create transfers
(`finance.begin_payout` → Stripe Transfer → `finance.complete_payout`); this event is also the
recovery path — a still-`pending` payout it binds is marked `paid`, because the transfer is the fact.

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
  individual client. A missing payer wallet is a skip, never a hold (the old body minted held money
  on a missing wallet); an individual who cannot cover the hold is skipped.
- `fn_release_ticket_escrow` / `fn_fair_exit_release` — credit an individual payee to the person
  wallet they hold (created if missing); the old hard-coded `freelancer` credit vanished for a person
  holding only a `user` wallet.
- `projects.fund_stage` (`00001150`) and `finance.begin_card_payment` (`00001230`) accept an
  individual client: only the project's OWNER may fund it; the stage is checked against their wallet
  all-or-nothing (`PF402` — "pay by card instead").

### Disputes — `finance.record_dispute_closed(p_event_id, p_dispute_ref, p_status, p_livemode)` (processor)

`charge.dispute.closed`. `won` / `warning_closed` → the case is `won` and every escrow the payment funded
returns from `disputed` to `held`. `lost` → each still-frozen escrow is refunded to the payer's wallet
(`escrow_refund`, its ticket back to `unpaid`), then the disputed amount is debited from that wallet
(`chargeback`); what the wallet can no longer cover is `unrecovered_cents` (never a negative balance).
Idempotent on the event and on the case. An escrow already RELEASED to the freelancer is not clawed
back from them (flagged — a product decision).

### Withdrawals

- `finance.begin_payout(p_wallet_id, p_amount, p_currency, p_instant, p_idempotency_key)` (user) — a
  person wallet is self-only, a vault needs `withdraw`; a freelancer wallet needs
  `fn_freelancer_payout_ready`, a business vault `fn_business_kyb_verified` (`PK403`); a verified
  payout account (`PA403`); enough balance (`PF402`). Inserts a `pending` payout and DEBITS the wallet
  (`payout`) at once. Idempotent on the attempt key (scope `payout:<uid>`). No Instant fee is charged
  (its magnitude is undecided, #55(c)).
- `finance.complete_payout(p_payout_id, p_transfer_ref)` (processor) — the Transfer exists: `paid`.
- `finance.fail_payout(p_payout_id, p_reason)` (processor) — Stripe definitively refused: `failed`, and
  a `payout_reversal` credit returns the money. Only a `pending` payout can fail.
- `finance.fn_payout_destination(wallet)` (internal) — the owner's verified Connect account.

### Saved cards

- `finance.card_owner_for(p_scope, p_entity_id)` (user) — `personal`, or a team/business the caller
  holds `manage_billing` on; returns the Customer id (if any), the caller's email (for Stripe, never
  stored) and a display name.
- `finance.record_processor_customer(p_scope, p_entity_id, p_customer_ref)` (user) — one Customer per
  owner; a racing second request gets the first.
- `finance.record_saved_card(owner_type, owner_id, pm_ref, brand, last4, exp_month, exp_year, created_by,
  make_default)` (processor) — writes the funding `payment_methods` row and its `saved_cards` display
  projection, linked; idempotent on (owner, payment method); the first card becomes the default.

### Recurring deposits

- `finance.create_deposit_rule(p_wallet_id, p_amount, p_currency, p_interval, p_source_method_id)` (user)
  — `add_funds` on the wallet; an ACTIVE Stripe funding card of the wallet's owner or the caller; the
  wallet's currency; first charge one interval from now; stamps `created_by`.
- `finance.claim_due_deposit_rules(p_limit)` (processor, the scheduler) — `FOR UPDATE SKIP LOCKED`;
  re-authorises the author AS THEM; records the run as an inbound payment (key =
  `deposit:<rule>:<period>`, so a period is charged once); advances past `now()` — missed periods are
  SKIPPED, never charged in a burst; a rule whose card, author or authority is gone is paused.
- `finance.bind_scheduled_payment(p_payment_id, p_provider_ref, p_error)` (processor) — binds the
  off-session PaymentIntent, or fails the run; three consecutive failures pause the rule.

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
