# finance Schema: Functions

The `finance` engine is **ticket-centric** and exposed only through `SECURITY DEFINER` wrappers —
the schema stays off the PostgREST allow-list, so clients never call `finance.*` directly. The
client-facing, **stage-level** actions live in the `projects`/`org` schemas and invoke this engine
internally (see [`../projects/Functions.md`](../projects/Functions.md) once populated, and
[`../org/Functions.md`](../org/Functions.md) for `org.get_business_finance`).

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
- **`finance.fn_freelancer_payout_ready(user_id)`** → boolean (`20260723091000`) — true only when
  the freelancer is KYC-`verified` AND `payout_ready`. **The onboarding gate.**
- **`finance.fn_business_kyb_verified(business_id)`** → boolean — true when the business is
  KYB-`verified` (required to operate the pooled Business Wallet).

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

## Deferred (documented target, not yet implemented)

The additive foundation defines the **data + gates** for these flows; the `SECURITY DEFINER` write
RPCs that operate them are the live-path TODO (behind the eventual `FINANCE_BACKEND_LIVE`-style
gate): recurring-deposit runner, payout-schedule runner + Instant Payout, Income-Smoother
allocation, tax-pot auto-set-aside, vault-permission grant/revoke, spend-approval decision, the
pending-release (7-day-window) sweep, monthly statement generation, and the FX-rate ingestion job.

---

## Entitlement resolution & allowance metering (migrations `20260724112000` / `20260724113000`)

The entitlement resolver is the bridge between the two ladders: it reads the **paid** layer
(`finance.plans` â†’ `plan_entitlements`) and scales it by the **earned** layer
(`org.standing_levels`), then lets an admin `entitlement_grant` raise â€” never lower â€” the result.

### Plan resolution

- **`finance.fn_audience_for(subject_type) â†’ finance.plan_audience`** â€” `IMMUTABLE`.
  `user`/`freelancer` â†’ `individual`; `team` â†’ `team`; `business` â†’ `business`; `organisation` â†’
  `organisation`.
- **`finance.fn_active_plan(subject_type, subject_id) â†’ uuid`** â€” the subject's live plan
  (`state IN ('trialing','active','past_due')` and not past `current_period_end`), falling back to
  its audience's default free plan. **Every subject always resolves to a plan** â€” there is no
  unentitled state.
- **`finance.fn_subject_standing_level(subject_type, subject_id) â†’ smallint`** â€” defers to
  `org.fn_standing_level` for earning subjects; buyer subjects (`business`/`organisation`) resolve to
  rung `1`, because they carry the Client Trust Score rather than Standing.

### `finance.fn_effective_limit(subject_type, subject_id, key) â†’ integer`

The core resolver. `NULL` = **unlimited**; `0` = the subject's plan does not grant the lever at all
(deny-by-default for any key a plan does not name).

1. Look up the plan's `plan_entitlements` row.
2. Apply `scaling`:
   - `none` â†’ `limit_value`.
   - `standing_base` â†’ `standing_levels.listing_base Ã— multiplier_bp / 10000` (Free = 1.0Ã—, Pro =
     2.0Ã— â€” Pro **doubles what was earned** rather than replacing it).
   - `standing_bonus` â†’ `limit_value + standing_levels.proposal_bonus` (reliability buys volume the
     same way money does).
3. Take `GREATEST(base, active grant)`; any unlimited flag anywhere wins.

- **`finance.fn_has_entitlement(subject_type, subject_id, key) â†’ boolean`** â€” the flag-kind twin
  (grant first, then plan, then `false`).

Both are mirrored by pure TypeScript twins in `packages/types/finance/entitlements.ts`
(`scaleEntitlement`, `canConsumeAllowance`) so the client can preview a value without a round trip.

### Effective rates

- **`finance.fn_effective_commission_bp(subject_type, subject_id) â†’ integer`** â€” negotiated rate â†’
  `standing_commission_tiers` for the rung â†’ `800` (8%). This is the **earned** marketplace taper.
- **`finance.fn_effective_platform_fee_bp(subject_type, subject_id) â†’ integer`** â€” negotiated rate â†’
  `security.platform_params.platform_fee_bp` â†’ `0`. The 5% project service fee does **not** taper
  with Standing and is not bundled with any plan; the only sanctioned flex is an admin-approved
  `finance.negotiated_rates` row for an Organisation/Business volume commitment.

### Allowance metering

- **`finance.fn_current_allowance(subject_type, subject_id, key) â†’ finance.allowance_periods`** â€”
  opens or rolls the weekly period (`date_trunc('week', now())`), snapshotting `granted_units` with
  its `base_units` / `standing_bonus_units` provenance so a mid-week upgrade or promotion is an
  explicit new grant rather than a silent drift. Also applies the lazy buffer drip. Emits
  `allowance.period_rolled` / `allowance.buffer_replenished`. Granted to `authenticated` (read own).
- **`finance.fn_consume_allowance(subject, units, key, reason, ref_table, ref_id) â†’ boolean`** â€”
  spends units. Requires **both** weekly headroom and a buffer token, so a week's allowance can never
  be dumped into one hour of spam. Emits `allowance.consumed` on success and `allowance.exhausted` on
  refusal â€” the refusal is recorded either way, because the denial rate is the upgrade signal.
  **`service_role` only.**
- **`finance.fn_refund_allowance(...) â†’ boolean`** â€” returns units (a withdrawn proposal should not
  cost the week's allowance). **`service_role` only.**

### Footprint

- **`finance.fn_footprint_usage(subject_type, subject_id, key) â†’ integer`** â€” live counts for
  `active_public_projects` / `business_public_projects` / `team_public_projects` (from
  `projects.projects` where `status IN ('active','on_hold')` **and** `visibility = 'public'`),
  `teams_owned`, `businesses_owned`, `team_seats`, `organisation_seats`.

  **Drafts are never counted** â€” unlimited private drafting is the baseline promise.
  `published_listings` returns `0` until the `catalogue.*` listing tables land (Decision #53 keeps
  `/catalogue` on fixtures); its **cap already resolves**, only its usage count is pending.
- **`finance.fn_footprint_remaining(...) â†’ integer`** â€” headroom, or `NULL` when unlimited.

---

## âš–ï¸ Enforcement triggers (migration `20260724113000`)

Triggers on existing project tables. They **meter unconditionally** and **block only when their
platform param is switched on** â€” `proposal_allowance_enforced` and `footprint_caps_enforced`, both
seeded `false`.

> **Why fail-open.** Turning a cap into a hard block changes user-visible behaviour on a live
> marketplace. Metering first means the magnitudes (50/wk, 3-per-10h, 3 live projects) get tuned
> against `analytics.events` before anyone is ever refused. Flipping either param is a deliberate
> human decision, never a side effect of running a migration.

| Trigger                              | On                                                                   | Behaviour                                                                                                                                                        |
| :----------------------------------- | :------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trg_meter_application_allowance`    | `AFTER INSERT ON projects.project_applications`                      | Spends one `weekly_proposals` unit from the applicant (the **team** when a team applies, else the user). Emits `entitlement.denied` when exhausted.               |
| `trg_refund_withdrawn_application`   | `AFTER UPDATE OF status ON projects.project_applications`            | Returns the unit on a transition to `withdrawn` â€” selectivity should never be punished twice.                                                                    |
| `trg_check_public_project_footprint` | `BEFORE INSERT OR UPDATE OF status, visibility ON projects.projects` | Counts a slot only when a project **becomes** `active` + `public` (a project already live is not re-counted). Business-owned projects meter against the business. |

None of these touch execution capacity: `projects.check_ticket_capacity` and the $W_i$ caps remain
the sole authority over how much work a freelancer may hold.

> **⚠️ Known limit of the fail-open design.** While a param is `false` the `entitlement.denied` event
> commits normally. Once it is `true`, the `RAISE` aborts the transaction — which also rolls back the
> analytics row written moments earlier. Postgres has no autonomous transactions, so **after the
> switch is flipped, a denial must be recorded by the app layer**: catch the `check_violation` and
> call `analytics.fn_emit` from the service. Without that, the denial funnel goes dark at exactly the
> moment enforcement starts mattering.

## ðŸŽ› Platform parameters added

| Key                                 | Default | Meaning                                                             |
| :---------------------------------- | :------ | :------------------------------------------------------------------- |
| `proposal_allowance_enforced`       | `false` | Meter-only until flipped.                                           |
| `footprint_caps_enforced`           | `false` | Meter-only until flipped.                                           |
| `proposal_buffer_window_hours`      | `10`    | The "3 per 10 hours" drip window.                                   |
| `proposal_buffer_hold_multiple`     | `4`     | Buffer hold cap as a multiple of the drip â€” how many may be banked. |
| `subscription_grace_days`           | `7`     | Days a `past_due` subscription keeps its paid entitlements.         |
| `standing_recompute_interval_hours` | `24`    | Standing sweep cadence (migration `20260724111000`).                |
| `standing_demotion_grace_days`      | `30`    | Reserved anti-flapping guard on demotions.                          |

