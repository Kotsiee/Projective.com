# finance Schema: Functions

The `finance` engine is **ticket-centric**. Money moves only through `SECURITY DEFINER` functions:
the client-facing, **stage-level** actions live in the `projects`/`org` schemas and invoke this
engine internally (see [`../projects/Functions.md`](../projects/Functions.md) once populated, and
[`../org/Functions.md`](../org/Functions.md) for `org.get_business_finance`).

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
  `finance.spending_limits` cap and increments `spent_cents` when allowed.
- **`finance.fn_split_team_payout(escrow_id, team_id, payout, currency)`** — distributes a team
  payout across `finance.contribution_agreements` (writing `payout_splits` + crediting each member),
  falling back to the Team Wallet when no agreement exists.

## Escrow lifecycle (migrations `0009`, `0305`, `0310`)

- **`finance.fn_hold_ticket_escrow(ticket_id)`** → escrow id — holds escrow at claim (spending-cap
  checked; debits the payer business wallet; prefers an accepted team assignment as payee).
- **`finance.fn_release_ticket_escrow(ticket_id)`** — releases held escrow to the payee, applying
  the canonical **5%** fee (`security.platform_params.platform_fee_bp = 500`, set in `0305`) and
  routing team payees through `fn_split_team_payout`.
- **`finance.fn_refund_ticket_escrow(ticket_id)`** (`0310`) — refunds held escrow to the payer (used
  by claim-TTL "parking" auto-release); no fee is applied to a refund.
- **`finance.fn_fair_exit_release(ticket_id, bp)`** (`0305`) — the 25/50/75 fair-exit split: pays
  the payee `bp` basis-points of the principal (net of fee), refunds the remainder to the client.
- **`finance.fn_generate_consolidated_invoice(business_id, start, end)`** — consolidates a period's
  released escrows/fees/bonuses into one itemised `consolidated_monthly` invoice.
- **`finance.fn_seed_business_wallet()`** (`0309`, trigger) — seeds a one-time `demo_opening_credit`
  on a new business wallet so the internal-wallet demo path has funds to move.

## Additive foundation (2026-07-23)

### Authorization / gating predicates

- **`finance.fn_owner_visible(owner_type, owner_id)`** → boolean (`20260723092000`) — can the caller
  see this owner's finances? (self / active-member / admin). Basis for the wallet-scoped RLS
  policies.
- **`finance.fn_can_view_wallet(wallet_id)`** → boolean — the wallet-id form.
- **`finance.fn_has_vault_capability(wallet_id, user_id, cap)`** → boolean (`20260723093000`) — the
  in-DB vault-capability gate (`manage_members` implies all). Intended for future money-movement
  RPCs.
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
These are the client-facing Finance-tab actions; they call the `finance.*` engine above. The
business finance dashboard reads through **`org.get_business_finance`** (`0309`).

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
allocation, tax-pot auto-set-aside, vault-permission grant/revoke, the pending-release
(7-day-window) sweep, monthly statement generation, and the FX-rate ingestion job. (The spend-approval
decision landed as `finance.decide_spend_approval` — see [§ Wallet movements](#-wallet-movements-00001210-12).)

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
  `teams_owned`, `businesses_owned`, `team_seats`, `organisation_seats`.

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
  use.
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
recording money that did not move. Each function below is a definer because the ledger primitives it
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
`manage_members` on the account and may not be the requester — approving one's own over-cap spend
would make the cap decorative (`42501`). A request already decided is `PC409`; one past its
`expires_at` is marked `expired` instead of decided. A decision notifies the requester through
`comms.fn_notify` (`spend.approved` / `spend.rejected`). Returns `{ id, status }`.

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
> (finance-model §5) applies when income ARRIVES, and the release functions do not yet apply it
> either (`fn_split_team_payout` credits members by `percent_bp` with no vault cut). The wallet's
> split preview states the documented model; which one is authoritative needs a decision.
