# Finance Model: Fees, Payouts & Wallet Architecture

> **✅ Resolved (2026-07-12):** the platform service fee is **5%**, plus payment-processor (Stripe)
> fees passed through — this is now canonical. `investor-summary.md` has been corrected from its
> former 10% figure to match. The escrow engine already operationalizes 5% —
> `security.platform_params` `platform_fee_bp = 500` (migration `0305`), applied on escrow release
> by `finance.fn_release_ticket_escrow`. Decision logged in the root `CLAUDE.md` "Resolved
> Decisions" table. **Stripe processing costs are separate from the 5% and are passed through** (see
> §1.1 and §9), not absorbed into the service fee.

---

## 1. Revenue Streams (Phase 2+)

### 1.1 Project Service Fee

- **Standard Service Fee:** 5% plus Stripe processing costs, applied to each project stage upon
  escrow release.
- Split between platform operations, escrow management, and dispute mediation infrastructure.
- **No paywall on freelancer _execution_ volume** — how much work a freelancer may hold concurrently
  is governed by the Workload Intensity ($W_i$) caps described in `PRODUCT_SPEC.md`, never by
  subscription tier. **Distribution** (outbound proposals) and **marketplace footprint** (live
  public projects, published listings, entities owned, seats, promoted placement) _are_ tiered — see
  §16.

  > **⚠️ Reworded 2026-07-24** (product owner). This clause previously read "no paywall on
  > freelancer **project** volume", which read as a blanket ban on tiering anything. The distinction
  > that actually matters is **execution vs distribution vs footprint**: charging for execution
  > capacity would be Upwork's hourly-tracking sin and is permanently off the table; metering
  > outbound proposals is an **anti-spam** mechanism that benefits everyone (a marketplace where the
  > same top performers apply to every posting is worse for the average freelancer _and_ for the
  > client reading the shortlist). Logged in root `CLAUDE.md` §8.

### 1.2 Marketplace Commissions

- Digital asset sales (templates, codebases, design assets): **8–20%** commission.
- Base rate (8%) is comparable to Etsy; the 20% tier applies to listings using internal "Search
  Boosts" or promoted placement.
- **The base rate tapers with earned Standing, never with the plan** (§16.3):

  | Standing rung          | L1 New | L2 Established | L3 Trusted | L4 Expert | L5 Elite |
  | :--------------------- | :----- | :------------- | :--------- | :-------- | :------- |
  | Marketplace commission | 8%     | 8%             | 7.5%       | 7%        | 6.5%     |

  Letting the best sellers pay the least is the single strongest retention mechanic available, and
  it costs nothing on sellers who would have churned anyway. It is **not purchasable** — see §16.3.

### 1.3 Subscription Tiers (Phase 3+)

Two payment planes, because a user and the entities they own are separately scaled:

- **Personal plan** — attached to the _user_. Raises their proposal allowance, how many teams and
  businesses they may own, their promoted placement and analytics.
- **Entity plan** — attached to each _Team / Business / Organisation_. Raises that entity's seats,
  concurrent public projects, pooled-wallet features and departments.

**Ownership ≠ power.** A personal Pro plan lets you spin up 5 businesses; each of those businesses
still only gets 3 concurrent public projects until _it_ is upgraded.

| Plan             | Audience                | Price              | What it raises                                                                                                                                                       |
| :--------------- | :---------------------- | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Free**         | Everyone (buyer+seller) | £0                 | The universal baseline. A freelancer is a superset of a client, so there is **no separate client plan**.                                                             |
| **Pro**          | Individuals             | **£12.99/mo**      | Proposals 50 → 150/wk, live public projects 3 → 15, listings ×2, teams owned 3 → 6, businesses owned 1 → 3, promoted placement, full analytics.                      |
| **Pro Team**     | Micro-agencies          | £29/mo per team    | Seats 4 → 15, team public projects 2 → 15, a dedicated pooled proposal quota, advanced vault splits.                                                                 |
| **Business Pro** | SMB buyers              | **TBD** ⚠️         | Public projects 3 → 25, managers 2 → 15, full pooled wallet + spending caps, intervaled invoicing, light departments.                                                |
| **Organisation** | Enterprise/procurement  | Custom, seat-based | Unlimited nested businesses + full departmental isolation, SSO/SAML, API access, audit logs, consolidated invoicing, dedicated support, **negotiated platform fee**. |

> ⚠️ **Business Pro price is not set.** The entitlements are seeded in `finance.plan_entitlements`;
> `finance.plans.price_cents` is deliberately `NULL` until the product owner sets it. Flagged in
> root `CLAUDE.md` §8.

Organisation seat pricing keys off the existing `org.employee_scale` tiers (1-50 / 51-200 / 201-500
/ 500+). An Organisation is **free to draft** — creating and configuring one costs nothing; going
active and adding seats requires the subscription, the same draft-first pattern used everywhere
else.

### 1.4 Financial Services & Visibility

- **The "Income Smoother":** nominal micro-fee (~0.5%) for an AI-managed wallet that smooths payout
  consistency across high/low earning cycles.
- **Instant Payouts:** optional fee to bypass standard Stripe clearing periods.
- **Search Boosts:** paid promotion for profiles/templates on the Explore page or hiring
  suggestions.

### 1.5 Organizational Limits (The Scale Ladder)

- Team/Business profile count per user.
- Seat limits within a Team/Business entity (Phase 3).
- Active project volume per Business without an upgrade.

Concrete magnitudes for all three now live in §16.1 and in `finance.plan_entitlements`.

---

## 2. Payout Triggers by Stage Type (CREATE Framework)

| Stage Type        | CREATE Category | Payout Trigger (Proof of Work)                                                     |
| :---------------- | :-------------- | :--------------------------------------------------------------------------------- |
| **File-Based**    | Create, Run     | Final submission made and client clicks "Approve"                                  |
| **Session-Based** | Educate, Advise | Scheduled session duration completed and logged                                    |
| **Maintenance**   | Run, Test       | Completion of the `MaintenanceCycleInterval` (Weekly/Monthly) with no open dispute |

> **Stage-level entry points (implementation):** the client drives this loop from the stage Finance
> tab against **pre-loaded wallet balances** (Stripe fiat top-up deferred). `projects.fund_stage`
> holds escrow for an **assigned** stage's tickets (spending-limit checked, isolated to the stage)
> and moves it `assigned → in_progress`, emitting a "stage funded" notification via
> `comms.fn_notify`. `projects.approve_stage` is the "Approve" trigger above — it releases the
> stage's held escrow with the 5% fee and team smart-splits, marking the stage `paid`. Both are
> `SECURITY DEFINER` wrappers over the `finance.*` engine (migrations `0009`, `0305`).

## 3. The "Fair Exit" Logic — 25/50/75 Splits

Time-based split for early termination of **File-Based** stages, comparing `stage.started_at` /
current time against `stage.deadline`:

- **< 25% of stage duration:** Full refund to client. Freelancer forfeits payment (work not
  substantially started).
- **25%–75% of stage duration:** 50/50 split of escrowed funds. Client keeps any uploaded drafts;
  freelancer is compensated for time invested.
- **> 75% of stage duration (or final submission):** Full payout to freelancer.

**Worked example:** a £1,000 stage cancelled at 40% duration triggers an automatic £500/£500 split.

> **Implementation (current):** the split is exposed as a **client-selected settlement tier** rather
> than auto-derived from elapsed duration.
> `projects.cancel_stage_fair_exit(project_id, stage_id,
> tier)` (migration `0305`, tier ∈
> `{25, 50, 75}`) pays the freelancer that percentage of each held escrow's principal — net of the
> 5% fee, team-split-aware — and refunds the remainder to the client business wallet, marking the
> stage `cancelled`. The automatic duration-thresholding above (`<25%` → full refund, `25–75%` →
> 50/50, `>75%` → full payout) is **not yet wired**; the tier is currently supplied explicitly by
> the cancelling client.

## 4. Session & Maintenance-Specific Exit Rules

### Session-Based (Educate/Advise)

- **Client cancels < 24h before session:** freelancer receives a 50% cancellation penalty fee.
- **Freelancer cancels:** client is issued a 100% refund for all remaining sessions.
- **Completed sessions:** always paid in full to the freelancer once logged.

> Note: `brain.md`'s own Session cancellation table describes a _full forfeit to freelancer_ for
> late (<24h) client cancellations, not a 50% penalty fee. This is a second conflict between this
> document and the brain files — `brain.md` takes precedence per the source-of-truth hierarchy; the
> 50% figure here is preserved only as historical/legacy detail pending reconciliation.

### Maintenance-Based (Run/Test)

- **Cycle-based payouts:** released at the end of each `MaintenanceCycleInterval`.
- **"Negative Confirmation" model:** if the client does not dispute within 48 hours of a status
  report, funds auto-release.
- **Freelancer resignation mid-cycle:** forfeits the current cycle's payment.

## 5. Team Payouts: Per-Stage Smart Splits

A team appears to the client as a single freelancer; internally, funds are auto-routed by a pre-set
split ratio defined before work starts.

- **Automated routing:** on stage approval, the client's single payment is split across the Team
  Vault and individual Member Wallets per the pre-defined ratio.
- **Cancellation:** the amount released under the 25/50/75 rule is distributed using the same
  internal split ratio.

**Default ruleset templates:**

- **Co-op (Equal):** `(100% − Vault%) / N members`.
- **Finder's Fee:** a fixed percentage to the member who originated the project; remainder split.
- **Benevolent Dictator:** 100% to Team Vault, manually distributed by the admin.

---

## 6. The Multi-Wallet Architecture

Projective uses a tiered ledger, not a single monolithic wallet:

- **Personal Wallets:** individual freelancer/client accounts. Owner-only visibility.
- **Team Vaults:** shared treasury for a Team profile; receives the "vault" portion of a stage split
  (e.g. a 10% internal overhead cut) for shared software/branding/marketing costs, managed by Team
  Owner/Admins.
- **Business Wallets:** corporate budgeting container — e.g. a company deposits £50,000 and
  allocates it across 20 projects without repeated card charges.
- **Hidden system wallets** (invisible to users): the **Escrow Pool** (transient stage-lock holding
  area), the **Fee Collection Account** (routes the service fee + marketplace commissions), and the
  **Dispute Lockbox** (holds contested funds).

## 7. Wallet States & the Financial State Machine

**Four** fund states, plus a state-machine trace of a stage's full lifecycle. The canonical enum is
`finance.fund_state` (`documentation/database/finance/Tables.md`):

1. **Escrowed / Locked** (`locked`): held by the platform until a trigger/approval is met
   (`finance.escrows.status ∈ {held, funded}`).
2. **Pending — 7-day safety window** (`pending`): released from escrow but held for final review.
   Window length = `security.platform_params.pending_release_days` (**7 days**). Modelled by
   `finance.pending_releases` (`available_at = released_at + 7d`).
3. **Available** (`available`): withdrawable to the user's bank via Stripe Connect — the
   materialised `finance.wallets.balance_cents`.
4. **On hold — Dispute Lockbox** (`on_hold`): contested funds frozen while a dispute is open
   (`finance.escrows.status = 'disputed'`; `finance-model.md` §6 Dispute Lockbox).

```text
[Stage Funded] -> [Escrowed/Locked] -> [Trigger/Approval] -> [7-Day Pending Window] -> [Available Balance]
                        │                                              │
                        └──────────────► [On hold / Dispute Lockbox] ◄─┘   (dispute raised)
```

> **Balances are a projection, not a stored total.** The three/four-state figure is derived from the
> ledger + `finance.escrows` + `finance.pending_releases`. ⚠️ **Implementation reality:** the
> wallet's **Available** balance is currently _materialised_ (`finance.wallets.balance_cents`,
> maintained alongside `finance.transactions.balance_after_cents`) — a per-wallet single-entry
> running ledger, not derived double-entry, and the 7-day `pending` window + `on_hold` state are
> additive (`20260723094000`). Escrow release presently credits **Available** directly; wiring the
> ledger to credit `pending` → sweep to `available` after 7 days is a follow-up (root `CLAUDE.md`
> §8).

**Worked example — £1,000 stage approval with a 10% team vault cut:**

```json
{
	"ledger_entry": {
		"amount": 100000,
		"currency": "gbp",
		"metadata": {
			"type": "stage_escrow_release",
			"stage_id": "uuid",
			"split_ratio": { "vault": 0.10, "member_a": 0.90 }
		}
	}
}
```

Breakdown: System Fee (5%) → £50 to the Fee Collection Account; Team Vault (10%) → £95; Freelancer
(85%) → £855 to their Personal Wallet.

## 8. Financial Edge Cases

- **Stale Project (Ghosting):** if the client never approves or disputes a submission, a 14-day
  auto-approve timer triggers the standard payout flow automatically.
- **Insufficient Funds (Maintenance stages):** the system attempts to pre-authorize the next cycle's
  funds 3 days before the current cycle ends. If the client's wallet can't cover it, the stage is
  auto-paused and the freelancer is notified to stop work.
- **Failed Withdrawal:** if a freelancer's bank account is closed/flagged by Stripe, funds bounce
  back to their Personal Wallet (Available state) with a dashboard prompt to update payment details.

## 9. Stripe Integration & Tax Handling

- **Architecture:** Stripe Connect (Custom/Express). Projective owns the **ledger** (who is owed
  what, stored in Supabase `wallets`/`transactions` tables); Stripe owns the **fiat rails** (KYC,
  AML, banking).
- **Fiduciary safety:** funds sit in a Stripe Platform Account, legally segregated from Projective's
  own operational accounts — it is never "Projective's money."
- **Contract structure:** the contract is between Client and Freelancer/Team; Projective's ledger
  reflects a "right to payment," not a resale of services.
- **Tax reporting:** Stripe issues 1099/local tax forms per jurisdiction, reducing Projective's own
  administrative/tax liability.

---

## 10. KYC / KYB Gating

The abstract rule lives in `brain.md` §Identity Verification (KYC & KYB); this is the **concrete
gate**. Schema: `finance.verification_cases` + the `org.freelancer_profiles.kyc_*` /
`org.business_profiles.kyb_*` caches (migration `20260723091000`).

| Actor                                      | Gate                                                                                              | Enforced before                                                 |
| :----------------------------------------- | :------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------- |
| **Freelancer (earner)**                    | Government-ID verification (Stripe Identity) **AND** a payout-ready wallet (Connect account set). | Landing a gig or joining a team (`fn_freelancer_payout_ready`). |
| **Client (individual buyer)**              | **None.** Tap-and-pay via Stripe (optional save-card for reuse). No ID, no wallet required.       | —                                                               |
| **Business owner (incl. client-who-owns)** | KYB (corporate registration + UBO). `fn_business_kyb_verified`.                                   | Operating the pooled Business Wallet (fund/spend).              |

- **Why the freelancer gate is at _onboarding_, not payout-time:** it guarantees no funds ever land
  in a **permanent-escrow / unpayable** state — a freelancer cannot accept work they can't be paid
  for.
- **Tier ladder** (mirrors `brain.md`): `1` Basic (email/phone) · `2` Verified (gov ID + liveness) ·
  `3` Business (KYB/UBO). Stored as `finance.verification_cases.tier`.
- **No PII in domain tables:** only opaque provider references (Stripe Identity session / Connect
  account id) are stored; documents/PII live at Stripe / Supabase Vault (`brain.md` §Data Privacy).
- ⚠️ **Distinct from email verification** (`org.user_emails.verified_at`). ⚠️ **Enforcement wiring**
  into the hire/join/`fund_stage` functions is flagged for human sign-off (root `CLAUDE.md` §8) —
  the predicates exist; the behavioural change to money-movement functions is not applied in this
  pass.

---

## 11. Multi-Currency & FX

The abstract intent ("price and be paid in your own currency; see prices in yours") is in `brain.md`
§Escrow, Wallets & Finance. The **mechanics**:

- **Store-in-origin.** Every amount is `(amount_minor, currency)`, stored and **settled** in the
  currency it was entered in. No priced entity is currency-less (all already carry `currency`).
- **Base currency = GBP** (`security.platform_params.base_currency`) for system accounts, fees, and
  cross-currency bridging.
- **Snapshot-at-commit.** At escrow lock / release / checkout the FX rate(s) used are captured onto
  the row (`fx_rate`, `fx_base`, `fx_as_of` on `finance.transactions`/`escrows`), sourced from
  `finance.fx_rates`. Settlement is therefore deterministic and reproducible — it never drifts with
  the market.
- **Display conversion is read-time only.** Balances/prices are shown in the viewer's
  `org.user_preferences.preferred_display_currency` using the latest `finance.fx_rates` row; this
  **never** mutates stored amounts or affects settlement.
- ⚠️ **OPEN (flagged, root `CLAUDE.md` §8):** who bears the FX **spread** and how the conversion fee
  is charged — payer-side spread, platform margin, or mid-market pass-through — is a
  business-economics decision left open, cross-referenced to §1 (fees) and §9 (Stripe). Do not
  invent the economics.

---

## 12. Payment Methods (spend vs earn)

Schema: `finance.payment_methods` (`method_role ∈ funding | payout | both`). Card data is **never**
stored — only an opaque Stripe reference + safe display fragments (`brand`, `last4`).

- **Funding** methods back a Stripe **PaymentMethod** (the client tap-and-pay / business top-up).
- **Payout** methods back a Stripe **Connect external account** (the freelancer/team withdrawal
  destination) — complements the pre-existing `finance.payout_accounts`.
- One default per role (`is_default_funding` / `is_default_payout`).

---

## 13. Money-Movement Rules

- **Recurring deposits** (`finance.deposit_rules`): standing top-ups (weekly/monthly) from a funding
  method; consecutive failures increment `failure_count` (drives dunning / auto-pause).
- **Payout schedules** (`finance.payout_schedules`): `manual` · `scheduled_weekly` ·
  `scheduled_monthly` · `threshold` (pay out when Available ≥ `threshold_cents`). **Instant Payout**
  (`instant = true`) charges `security.platform_params.instant_payout_fee_bp` to bypass the standard
  Stripe clearing window (§1.4).
- **Income Smoother** (`finance.income_smoothing`): buffers earning peaks and tops up troughs into a
  salary-like monthly figure. **Fee ~0.5%** (`income_smoother_fee_bp = 50`). **Eligibility gate:**
  `income_smoother_min_months = 3` months of earnings history **and** ≥
  `income_smoother_min_volume_cents` lifetime volume (the volume floor defaults to `0` pending
  pricing sign-off — set a concrete figure when the economics land).
- **Sub-wallets / pots** (`finance.wallet_pots`): named pots (`tax` / `savings` / `goal` /
  `general`). A pot with `auto_allocate_bp > 0` auto-skims that % of each inbound payout — the
  **tax-pot auto-set-aside** (suggested default `tax_pot_default_bp`, opt-in, `0` by default).

---

## 14. Vault Permissions, Caps & Approvals

Governs shared wallets (Business / Team / Organisation).

- **Capability grants** (`finance.vault_permissions`, not a single role): `view` · `add_funds` ·
  `spend` · `distribute` · `withdraw` · `manage_members` · `manage_billing`. Enforced in-DB by
  `finance.fn_has_vault_capability`. ⚠️ Overlaps `org.business_permission` / `org.team_permission` —
  reconcile (root `CLAUDE.md` §8), do not fork.
- **Spending caps** (`finance.spending_limits`, existing): per-member `cap_cents` per `weekly` /
  `monthly` / `total` period; `spent_cents` tracked, `fn_check_spending_limit` enforced at hold
  time.
- **Approval thresholds** (`finance.spend_approvals`): a spend at/above
  `vault_approval_threshold_cents` (or over a member's cap) queues for a **second approver** before
  it executes.
- **Audit** (`finance.ledger_audit`): immutable who/when/amount for every
  add/spend/distribute/withdraw.
- **Team smart-splits** (`finance.split_rules` template → `finance.contribution_agreements`
  per-member, §5): **Co-op** `(100% − Vault%) / N` · **Finder's Fee** (fixed % to originator,
  remainder split) · **Benevolent Dictator** (100% to Team Vault). **Deterministic remainder
  rounding:** after integer division, any leftover minor unit(s) go to the **Team Vault**, so a
  split always sums back to the released total (the ledger nets to zero).

---

## 15. Invoicing, Statements, Refunds, Reconciliation & Idempotency

- **Intervaled invoicing** (`finance.invoices`, existing) — see `brain.md` §Business Invoicing:
  per-payout lines consolidated into a `consolidated_monthly` invoice.
- **Statements** (`finance.statements`): a monthly consolidated statement over the 30-day window,
  issued on the **1st**, PDF-ready (`opening`/`closing`/`total_in`/`total_out`/`total_fees`).
- **Refunds & chargebacks:** recorded as **negative** `finance.transactions` lines
  (`reason ∈ refund | chargeback | escrow_refund | fair_exit_refund`); the chargeback **case**
  (Stripe dispute) is tracked in `finance.chargebacks`.
- **Reconciliation:** internal self-consistency via `finance.v_wallet_reconciliation` (materialised
  balance vs ledger sum → `drift_cents` must be 0); external Stripe-balance-vs-escrow-pool
  reconciliation is an ops job (`SYSTEM_ARCHITECTURE.md` §Integration Blueprints).
- **Idempotency** (`finance.idempotency_keys`): every money-mutating request presents a key; a retry
  replays the stored response rather than re-executing — retries **never double-move money**.
- **Tax docs:** Stripe-issued 1099 / local forms surface to the user (§9); no PII is stored.
- **Notifications:** finance events route through `comms.fn_notify` — low balance, escrow funded,
  payout cleared, deposit failed, invoice due, cap exceeded, approval requested.

---

## 16. Subscriptions, Entitlements & the Standing Ladder

Schema: `finance.plans` / `plan_entitlements` / `subscriptions` / `entitlement_grants` /
`standing_commission_tiers` / `negotiated_rates` / `allowance_periods` / `allowance_ledger`
(migrations `20260724112000`, `20260724113000`) and `org.standing_levels` / `entity_standing` /
`create_mastery` / `achievements` / `quality_streaks` (migration `20260724111000`). Zod SSOT:
`@projective/types/finance` (`plans.ts`, `entitlements.ts`) and `@projective/types/org/standing.ts`.
Abstract rules live in `PRODUCT_SPEC.md` Â§Standing, Mastery & Progression; the numbers live here.

**The governing design constraint** (product owner, 2026-07-24):

> _"A user should never feel suffocated by the tier they are on. It should feel like the features
> they have are plentiful, and upgrading to a higher tier just makes sense."_

Every magnitude below is held against that constraint â€” the free tier is generous by intent, and
each ceiling exists for anti-spam or shared-resource fairness, not as a toll.

### 16.1 The entitlement matrix (starting dials)

**Individuals** â€” the freelancer plan _contains_ the client plan, because a freelancer is a
superset of a client. There is no separate buyer plan to reconcile.

| Lever                              | Free                 | Pro (Â£12.99/mo)      |
| :--------------------------------- | :------------------- | :-------------------- |
| Private draft projects             | **Unlimited**        | Unlimited             |
| Active public projects             | 3 concurrent         | 15 concurrent         |
| Published listings (seller)        | rung base: 10 â†’ 50 | **2Ã—** the rung base |
| Weekly proposals                   | 50 + rung bonus      | 150 + rung bonus      |
| Proposal buffer                    | 3 per 10h            | 5 per 10h             |
| Teams owned                        | 3                    | 6                     |
| Businesses owned                   | 1                    | 3                     |
| Teams / businesses **joined**      | **Uncapped**         | Uncapped              |
| Stored assets (`storage_megabytes`) | **25 GiB** (25 600) | **150 GiB** (153 600) |
| Promoted placement, full analytics | â€”                  | âœ…                   |

**Entities** â€” attached to the team/business itself, not to its owner.

| Lever                      | Team Free | Pro Team (Â£29) |   | Lever                      | Business Free | Business Pro |
| :------------------------- | :-------- | :-------------- | - | :------------------------- | :------------ | :----------- |
| Members / seats            | 4         | 15              |   | Concurrent public projects | 3             | 25           |
| Concurrent public projects | 2         | 15              |   | PMs / Observers            | 2             | 15           |
| Proposal pool              | members'  | dedicated       |   | Pooled wallet              | basic         | full + caps  |
| Stored assets              | 25 GiB    | **500 GiB**     |   | Stored assets              | 25 GiB        | **500 GiB**  |
| Advanced vault splits      | â€”       | âœ…             |   | Intervaled invoicing       | â€”           | âœ…          |
| Promoted placement         | â€”       | âœ…             |   | Departments                | 0             | 5            |

A team must hold **â‰¥ 2 members** before it may send proposals.

**Organisation** â€” unlimited seats, nested businesses, departments and projects; adds SSO/SAML,
API access, 730-day audit retention, dedicated support, consolidated cross-department invoicing, and
the only sanctioned platform-fee negotiation.

**Uncapped joining is deliberate.** Owning entities is metered; _joining_ them is not. Joining is
the viral motion of the platform, and capping it would suppress exactly the behaviour that grows
supply.

### 16.2 Proposal allowances (distribution, not a paywall)

- **Weekly allowance** â€” 50 (Free) / 150 (Pro), plus the earned rung bonus (up to +40). Both
  figures are chosen to be comfortably above real usage: 50 is enough for a freelancer to thrive
  without ever subscribing, and most will not spend it.
- **The buffer** â€” a rolling drip of 3 (Free) / 5 (Pro) proposals returned every 10 hours, capped
  at `proposal_buffer_hold_multiple` Ã— the drip. A spend needs **both** weekly headroom and a
  buffer token, so a week's allowance can never be dumped into one hour of spam.
- **Withdrawing a proposal refunds the unit.** Selectivity should never be punished twice.
- **Never sold Ã  la carte.** A paid tier _raises_ the ceiling; it never removes it. The moment deep
  pockets can buy raw proposal volume, the anti-spam promise â€” the entire point of the mechanism
  â€” is broken, and the platform has rebuilt Upwork Connects.

**Enforcement is fail-open until tuned.** `security.platform_params.proposal_allowance_enforced` and
`footprint_caps_enforced` both default to `false`: the caps are **metered** from day one but refuse
nothing until a human flips them. Every magnitude on this page is a dial to be re-fitted against
`analytics.events` (`allowance.*`, `entitlement.denied`) â€” see
`documentation/database/analytics/`.

### 16.3 The Standing ladder (earned, never purchasable)

Standing is the discretised rung of the Reliability Index ($R_i$) â€” see `PRODUCT_SPEC.md`
Â§Reputation & Discovery. Two paths up the same mountain: **earn it** (rung) or **accelerate it**
(Pro), and they stack.

| Rung               | Min score | Min stages | Free listings | Proposal bonus | Discovery weight | Marketplace commission |
| :----------------- | --------: | ---------: | ------------: | -------------: | ---------------: | ---------------------: |
| **L1 New**         |         0 |          0 |            10 |            â€” |           1.00Ã— |                     8% |
| **L2 Established** |        55 |          5 |            15 |            +10 |           1.05Ã— |                     8% |
| **L3 Trusted**     |        70 |         20 |            20 |            +20 |           1.10Ã— |                   7.5% |
| **L4 Expert**      |        82 |         50 |            30 |            +30 |           1.15Ã— |                     7% |
| **L5 Elite**       |        92 |        120 |            50 |            +40 |           1.20Ã— |                   6.5% |

Pro **doubles the listing column at every rung** â€” it multiplies what was earned rather than
replacing it, so a high-rung free user feels rewarded and Pro reads as an accelerant, not a gate.

**Score inputs** (all client-valued; weights are tunable dials, exposed in
`org.entity_standing.components`): stage completion 25 Â· on-time delivery 25 Â· dual-track review
scores 20 Â· dispute-free rate 15 Â· $W_i$ reliability 10 Â· tenure 5, minus active
`security.penalties` severity. **Never raw earnings and never raw proposal counts** â€” ranking by
spend or by volume is the pay-to-win trap this ladder exists to avoid.

The `min_stages` column is a volume floor: a flawless single engagement must not vault a subject to
the top of the ladder.

### 16.4 The 5% service fee and where it may flex

The project service fee does **not** taper with Standing and is **not** bundled into any plan. The
one sanctioned exception (owner decision, 2026-07-24) is an **Organisation or Business volume
commitment**, recorded as an explicit, admin-approved, time-boxed `finance.negotiated_rates` row
with its `minimum_volume_cents` commitment and `contract_ref`.
`finance.fn_effective_platform_fee_bp` resolves it; absent a contract it falls through to
`security.platform_params.platform_fee_bp`.

Keeping the flex in a contract table rather than a plan entitlement means the fee can never drift
downward as a silent side effect of someone upgrading a subscription.

### 16.5 What the platform deliberately does not do

- **No pay-to-win rank.** Pro accelerates capacity, never reputation. If clients suspect a rung can
  be bought, the signal collapses and the ladder is worthless to everyone.
- **No public earnings leaderboards.** They trigger race-to-the-bottom pricing and reward spam.
- **No vanity points** detached from something a client independently values.
- **No login or attendance streaks.** Streaks celebrate delivered quality (on-time delivery, fast
  response, dispute-free runs), never presence. Guilt mechanics are hostile to freelancer wellbeing
  and attract the wrong behaviour.
- **No metering of execution capacity.** Ever. See Â§1.1.

### 16.6 Storage (the asset-management footprint lever)

Schema: `finance.plan_entitlements` key **`storage_megabytes`** (seeded in
`00005030_seed_billing_plans_entitlements.sql`), metered by `files.storage_usage`, gated by
`files.fn_check_storage_quota`. Docs: `documentation/database/files/`.

Stored bytes are the **third footprint lever**, alongside published listings and active public
projects. It is a footprint, not a capability: it caps how much of a **shared, genuinely metered
resource** one tenant occupies, which is the only category of thing this platform prices. It is
**never** execution capacity (§1.1) and it can **never** buy reputation (§16.5).

#### The ladder

| Plan                | Limit (MiB) | Human   | Rationale                                                                 |
| :------------------ | ----------: | :------ | :------------------------------------------------------------------------- |
| `individual_free`   |      25 600 | 25 GiB  | Generous by intent — a freelancer's whole working library for years.       |
| `individual_pro`    |     153 600 | 150 GiB | **6×** Free. Raises the ceiling; never removes it.                        |
| `team_free`         |      25 600 | 25 GiB  | The team vault gets its **own** 25 GiB — see the metering rule below.      |
| `team_pro`          |     512 000 | 500 GiB | Shared production assets: video, source files, delivery archives.         |
| `business_free`     |      25 600 | 25 GiB  | The business pool gets its own 25 GiB, metered against the business.      |
| `business_pro`      |     512 000 | 500 GiB | Matches Pro Team — a buyer accumulates briefs and deliverables comparably. |
| `organisation_free` |      25 600 | 25 GiB  | Draft tier: enough to configure and evaluate.                             |
| `organisation`      |  **`NULL`** | ∞       | `is_unlimited = true`. The enterprise tier is never asked to budget bytes. |

#### Five rules that make those numbers mean something

1. **Storage is metered per PRINCIPAL, not per person.** A user's personal library, each of their
   teams, and each of their businesses hold **separate** allowances against their **own** plans. So a
   freelancer on Free who belongs to three Pro teams has 25 GiB of their own and 500 GiB in each team
   vault — and none of it borrows from the others. This is the same "ownership ≠ power" split that
   governs seats: joining is uncapped, and each entity pays for its own muscle.
2. **Only bytes WE store count.** A mounted Google Drive / Dropbox / S3 / Frame.io file consumes the
   **provider's** quota, and an attached **link** consumes none at all. A 2 TB connected Drive can
   therefore sit inside a 25 GiB plan without touching it — the alternative would charge a user twice
   for storage they already pay someone else for, which is indefensible and would kill the connectors.
3. **Nothing is hard-deleted, but a deleted asset stops counting.** The rollup sums only
   `deleted_at IS NULL`, so freeing space is immediate for the user while the row survives for audit
   and restore (§Nothing is hard-deleted, `PRODUCT_MANAGEMENT.md` §5.4).
4. **Enforcement is fail-open until tuned** — `security.platform_params.storage_quota_enforced`
   defaults to **`false`**, exactly like `proposal_allowance_enforced` and `footprint_caps_enforced`.
   Every figure above is a **dial to be re-fitted against real usage** before anyone is ever refused,
   and flipping the param starts **rejecting uploads on a live tenant**: a deliberate human decision,
   never a migration side effect.
5. **The unit is MEBIBYTES, never bytes** — `plan_entitlements.limit_value` is `integer`, and 25 GB in
   bytes (26 843 545 600) overflows `int4`. See `documentation/database/finance/Tables.md`.

**Overage is refusal, not a bill.** When enforcement is on, exceeding the cap **rejects the upload**
with a message naming the ceiling; it never silently charges the wallet. Surprise storage invoices are
how hosting products lose trust, and this platform's wallet moves **client money into escrow** — the
one place a surprise platform-initiated debit would be least forgivable.

Storage is deliberately **not sold à la carte**, for the same reason proposals are not (§16.2): the
moment bytes can be topped up per-gigabyte, the plan ladder stops describing the product and starts
describing a meter.
