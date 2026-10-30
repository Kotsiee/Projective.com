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

- **Who pays it** (Decision #337, ruling M1): the **seller**, on every product sale, at their
  Standing rung's rate. Decision #187's payer-rate rule (§16.4) is scoped to escrow fees, so a
  product sale is charged this commission, never the 5% service fee. **Not built yet**: today a
  wallet product sale charges the buying account's 5% service fee, deducted from each seller's
  credit, and `finance.fn_effective_commission_bp` has no caller.

### 1.3 Subscription Tiers (Phase 3+)

Two payment planes, because a user and the entities they own are separately scaled:

- **Personal plan** — attached to the _user_. Raises their proposal allowance, how many teams and
  businesses they may own, their promoted placement and analytics.
- **Entity plan** — attached to each _Team / Business / Enterprise_. Raises that entity's seats,
  concurrent public projects, pooled-wallet features and departments.

**Ownership ≠ power.** A personal Pro plan lets you spin up 3 businesses; each of those businesses
still only gets 3 concurrent public projects until _it_ is upgraded.

| Plan             | Audience                | Price              | What it raises                                                                                                                                                       |
| :--------------- | :---------------------- | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Free**         | Everyone (buyer+seller) | £0                 | The universal baseline. A freelancer is a superset of a client, so there is **no separate client plan**.                                                             |
| **Pro**          | Individuals             | **£12.99/mo** · £99/yr | Proposals 50 → 150/wk, buffer 3 → 5 per 10h, live public projects 3 → 15, listings ×2, teams owned 3 → 6, businesses owned 1 → 3, storage 25 → 150 GiB, promoted placement, full analytics. |
| **Pro Team**     | Micro-agencies          | **£29/mo** · £280/yr | 10 seats included (Team Free: 3), then **£3.50 per seat a month**; team public projects 2 → 15; a dedicated 150/wk proposal pool (Team Free: a 50/wk shared pool); advanced vault splits; promoted placement; storage 25 → 500 GiB. |
| **Business Pro** | SMB buyers              | **£39/mo** · £380/yr | 10 managers included (Business Free: 2), then **£4.00 per manager a month**; public projects 3 → 25; full pooled wallet + spending caps; monthly intervaled invoicing; 5 departments; storage 25 → 500 GiB. |
| **Agency** (`team_agency`) | Agencies (a team plan) | **£89/mo** base · annual by contract | 15 seats included, then **£6.00 per seat a month**; unlimited public projects; a 300/wk proposal pool with an 18-per-10h buffer, finite and never seat-scaled; custom treasury export; 730-day audit-log retention; API access (**Planned**); a dedicated account manager. |
| **Enterprise** (`enterprise`) | Enterprise/procurement  | **£89/mo** base · annual by contract | 15 seats included, then **£6.00 per seat a month**; unlimited nested businesses, departments and public projects; full departmental isolation; SSO, SAML first (**Planned** — hidden until built, Decision #336, ruling S7); API access (**Planned**); 730-day audit-log retention; consolidated invoicing; a dedicated account manager. |

**Prices and billing** (Decision #252, rulings S1, S2, S5, S6; the five paid rows above are the
owner's price list of 2026-10-30). Every figure is GBP. A plan's prices are stored one row per plan
× interval (`finance.plan_prices`), and an unpriced plan shows "Price coming soon" with no purchase
control. An annual plan bills each seat over its included number at 12 × the monthly seat price,
prorated from the day it is added, with no annual discount. Agency and Enterprise are two plans with
one price, so `org.employee_scale` no longer keys an enterprise's price. The service fee is the same
on every plan: no plan buys a lower fee, and an Agency or Enterprise contract may agree a rate only
through `finance.negotiated_rates` (§16.4). A plan is bought through Stripe Billing Checkout by
card, as recurring platform revenue — never a wallet debit. A personal plan is bought by its user;
an entity plan by the entity's owner or a co-owner, or on a business by a member holding
`manage_billing`. A downgrade takes effect at the end of the paid period. A plan is kept while its
subscription is `trialing` or `active`, and while `past_due` for `subscription_grace_days` (**7**);
`paused` falls back to the free plan. **Not built yet**: `finance.plan_prices`, the Agency plan row,
plan checkout and the grace rule — the seed still carries one monthly `price_cents` per plan
(Business Pro and Enterprise `NULL`), and nothing reads `subscription_grace_days`.

An Enterprise is **free to draft** — creating and configuring one costs nothing; going active and
adding seats requires the subscription, the same draft-first pattern used everywhere else.

### 1.4 Financial Services & Visibility

- **The "Income Smoother":** nominal micro-fee (~0.5%) for an AI-managed wallet that smooths payout
  consistency across high/low earning cycles. **Planned** (Decision #337, ruling M6): it needs a
  `PRODUCT_SPEC.md` entry before its engine is built, and its control stays locked until then (§13).
- **Instant Payouts:** optional fee to bypass standard Stripe clearing periods. **Planned**
  (Decision #337, ruling P3): the fee stays unset until it is priced.
- **Search Boosts:** paid promotion for profiles/templates on the Explore page or hiring
  suggestions.

### 1.5 Entity Limits (The Scale Ladder)

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

**The ruling (Decision #338, ruling P1): B now, A once deadlines are reliable.** The server derives
the tier above from elapsed time, and it is a **floor**: the cancelling client may only raise it,
and the payee may contest it through the Evidence Vault. Once stage deadlines are reliable (A), the
server derives the tier and the client only confirms it. A stage with **no deadline** has no
duration, so its floor comes from the submissions: one on file → 50%, an accepted one → 100%, none →
0%. **Not built yet** — today the client picks any tier (below).

> **Implementation (current):** the split is exposed as a **client-selected settlement tier** rather
> than auto-derived from elapsed duration.
> `projects.cancel_stage_fair_exit(project_id, stage_id,
> tier)` (migration `0305`, tier ∈
> `{25, 50, 75}`) pays the freelancer that percentage of each held escrow's principal — net of the
> 5% fee, team-split-aware — and refunds the remainder to the client business wallet, marking the
> stage `cancelled`. The automatic duration-thresholding above (`<25%` → full refund, `25–75%` →
> 50/50, `>75%` → full payout) is **not yet wired**; the tier is currently supplied explicitly by
> the cancelling client.
>
> **In the product (Decision #198):** the reviewer ends a stage from the Submissions explorer
> (**End Stage (Fair Exit)**) after reading a server-computed preview of all three tiers
> (`projects.preview_stage_fair_exit`, the same quote the settlement reports). The fee is charged
> only on the earned share; the unearned remainder comes back fee-free as `fair_exit_refund`; a
> prepaid ticket nobody claimed comes back whole. The tickets left on the stage close as `cancelled`
> — a multi-stage ticket included, so its later stages never run — and both sides are notified: on
> the client's side, the owner and the acting reviewer, not every billing member (both as built,
> ratified by Decision #338, ruling P1).

**One ticket, not the whole stage** (Decision #338, ruling P2 (a)) — **Not built yet**. Removing a
freelancer from a ticket, or deleting it, before work starts (`in_progress`) refunds the client in
full, as the claim TTL does. From `in_progress`, the split above applies to that ticket alone,
through a ticket-level Fair Exit door. Today either act pays the freelancer 100%.

## 4. Session & Maintenance-Specific Exit Rules

### Session-Based (Educate/Advise)

- **Client cancels inside the notice** (`session_cancel_notice_hours`, **24 h**): the sitting's
  money is **forfeit to the freelancer in full** (100%) — as built (`cancel_cohort_membership`,
  Decision #171) and ruled (Decision #343, ruling C2 (a)). The freelancer may refund a forfeit
  voluntarily (Decision #337, ruling M8) — **Not built yet**.
- **Freelancer cancels:** client is issued a 100% refund for all remaining sessions.
- **Completed sessions:** paid in full to the freelancer once logged with presence, after a **24 h
  review window** (`session_payout_hours`, in which a no-show can be claimed) and then the standard
  7-day **pending** window (§7) — two steps, named apart (Decision #343, ruling C2 (c); the "review
  window" name in the product is **Not built yet**). A sitting with **no presence data** is held for
  review, never released on negative consent (ruling C5 (a)) — **Not built yet**.
- **Reschedule lockout** (Decision #343, ruling C2 (b)) — **Not built yet**. A money-bearing event
  (a paid sitting or a paid call) locks at the money window: lockout = vote lead =
  `session_cancel_notice_hours`. Every other event keeps the 12 h lockout. A booking made inside the
  window gets a 60-minute grace. A sitting the provider moves inside the window counts as a provider
  cancellation for every attendee who did not support the move.
- **Paid discovery calls** (Decision #343, ruling C1) — **Not built yet**. Paid calls are off until
  they have a money path: a paid request is refused (`paid_unavailable`) and the paid card hidden.
  Then each host gets one hidden _Consultations_ engagement on the session rail (Decision #211): the
  fee is held at request and refunded in full on decline or expiry, and enabling paid calls needs a
  payout-ready host (§10).

### Maintenance-Based (Run/Test)

**Planned** (Decision #337, ruling P3): maintenance cycles, their 48-hour negative confirmation and
the cycle-cover check (§8) are not in the current build.

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

- **Co-op (Equal):** `(100% − Vault%) / N members`. **Free** on every team plan.
- **Finder's Fee:** a fixed percentage to the member who originated the project; remainder split.
  **Pro Team.**
- **Benevolent Dictator:** 100% to Team Vault, manually distributed by the admin. **Pro Team.**

**Writing a template** (`finance.save_split_rule`, Decision #228 (F); the plan split ruled under
Decision #226 (d)) needs `manage_finances` on a team that is not archived. Every cut is whole basis
points. The vault cut is 0–10000; a finder's fee names an **active member** as finder with a cut of
at least 1 bp, and the finder's and the vault's cuts together may not exceed 100% (10000 bp). Benevolent
Dictator stores a vault cut of 10000. Saving a template **retires** the active one
(`active = false`, kept as history), never deletes it, so a team always has exactly one active
template. Which templates a plan unlocks is data: one `split_template_<type>` entitlement flag per
template. Team Free carries `split_template_co_op` only; Pro Team carries all three; a grant can
unlock a single template. A team without the flag is refused **402**. The gate applies to the
**write**. **A team below Pro Team** (Decision #337, ruling M10 (a)) falls back to Co-op at its next
release, and a finder who has left the team is paid nothing: the finder's cut returns to the split.
**Not built yet** — today a team that drops to Team Free keeps applying its stored template, its
finder included, until it saves a new one.

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

> **Not built — and the ledger model is ruled** (Decision #337, ruling M2). None of the three system
> wallets exists, and money is not derived double-entry: it is a per-wallet single-entry ledger
> (§7). The ruling is **A now, B before scale**. A: a per-currency **conservation-identity view**,
> checked nightly beside `finance.fn_reconcile_wallets` with an ops reader — **Not built yet**. B: a
> **shadow double-entry** journal written by every money definer — **Planned**, built when any of
> three triggers fires: live money beyond a pilot, an enterprise audit-trail ask, or an auditor or
> regulator. Derived balances by a big-bang rewrite are not on the table.

## 7. Wallet States & the Financial State Machine

**Four** fund states, plus a state-machine trace of a stage's full lifecycle. The canonical enum is
`finance.fund_state` (`documentation/database/finance/Tables.md`):

1. **Escrowed / Locked** (`locked`): held by the platform until a trigger/approval is met
   (`finance.escrows.status ∈ {held, funded}`).
2. **Pending — 7-day safety window** (`pending`): released from escrow but held for final review.
   Window length = `security.platform_params.pending_release_days` (**7 days**). Modelled by
   `finance.pending_releases` (`available_at = released_at + 7d`). A session sitting reaches it
   after its 24 h review window (§4).
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
> additive (`20260723094000`). **The pending window is enforced (Decision #191):** an escrow release —
> and each team share, finder fee and vault cut of one — a fair-exit or seat payout, and a **product
> sale** write a `finance.pending_releases` row instead of crediting the wallet; an hourly sweep
> (`finance.fn_mature_pending_releases`) credits Available, with its ledger line, once
> `pending_release_days` have passed. `balance_cents` is therefore Available only, and pending money
> can be **neither withdrawn nor spent** on the platform until it clears. **Top-ups are not held**:
> a card payment is the payer's own money and is spent from the wallet the moment it settles
> (PRODUCT_SPEC §5); refunds, transfers and returned payouts are immediate too.
>
> **Disputes inside the window** (Decision #337, ruling M3; it closes #126's flag once built) —
> **Not built yet**. A payment dispute freezes the payee's still-pending rows for the disputed money
> (`on_hold`). A lost dispute recovers from those rows first, then from the payer, and only the rest
> is a platform loss; a won dispute restores each row's original `available_at`. It reaches only
> money still inside the 7 days — money that has cleared is never clawed back. The published line:
> _"Money that has cleared is yours; money still clearing can be held while a payment dispute is
> open."_ Today a lost card chargeback recovers from the **payer's** wallet only — its pending money
> first, then Available — and `on_hold` has no writer.

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
  auto-approve timer triggers the standard payout flow automatically, with notices to the client at
  7 and 13 days. **Not built yet** (Decision #337, ruling P3): no timer runs today, so a held ticket
  escrow never times out.
- **Insufficient Funds (Maintenance stages)** — **Planned** (Decision #337, ruling P3): 3 days
  before the current cycle ends, the system checks that the client's wallet can cover the next cycle
  — a check, never a pre-authorisation or reservation (Decision #210). If it can't, the stage is
  auto-paused and the freelancer is notified to stop work.
- **Failed Withdrawal** (Decision #337, ruling M9; ⚖️ pending counsel): if a freelancer's bank
  rejects a payout (Connect `payout.failed`), the money stays in their connected account's Stripe
  balance, where it is legally theirs, and Stripe pays it out again once the bank details are fixed.
  The owner is told, with a dashboard prompt to update their payout details. It never returns to the
  platform wallet, which would leave Projective holding client money. Money returns to the wallet
  only when the transfer itself is refused, never made (`fail_payout`), or reversed by the platform
  (`transfer.reversed`). This is how it is built (Decision #202 (a)).

## 9. Stripe Integration & Tax Handling

- **Architecture:** Stripe Connect — Express accounts on Accounts v2 (Decision #125). Projective
  owns the **ledger** (who is owed what, stored in Supabase `wallets`/`transactions` tables); Stripe
  owns the **fiat rails** (KYC, AML, banking).
- **Fiduciary safety:** funds sit in a Stripe Platform Account, legally segregated from Projective's
  own operational accounts — it is never "Projective's money." ⚖️ **Open, pending Stripe and
  counsel** (Decision #337, ruling M2): how long escrow may sit in the platform balance under
  Separate Charges & Transfers, and what safeguarding posture follows. The code cannot prove the
  segregation this line states.
- **Contract structure:** the contract is between Client and Freelancer/Team; Projective's ledger
  reflects a "right to payment," not a resale of services.
- **Tax reporting:** Stripe issues 1099/local tax forms per jurisdiction, reducing Projective's own
  administrative/tax liability.

---

## 10. KYC / KYB Gating

The abstract rule lives in `PRODUCT_SPEC.md` §Identity, Taxes & Compliance #1 (KYC & KYB); this is
the **concrete gate**. Schema: `finance.verification_cases` + the `org.freelancer_profiles.kyc_*` /
`org.business_profiles.kyb_*` caches (migration `20260723091000`).

| Actor                                      | Gate                                                                                              | Enforced before                                                 |
| :----------------------------------------- | :------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------- |
| **Freelancer (earner)**                    | Government-ID verification (Stripe Identity) **AND** a payout-ready wallet (Connect account set). | Applying, being seated or assigned, claiming, creating or joining a team (`fn_assert_payout_ready`, Decision #196). A team payee: every shareholder. Withdrawing earnings from a `user`/`team` wallet. **Not built yet** (Decision #337, ruling M4): publishing a listing, taking a session or cohort-seat booking, and enabling paid calls — a team's every shareholder; a team invite shows the invitee's readiness on the roster, and the refusal stays at accept. |
| **Client (individual buyer)**              | **None.** Tap-and-pay via Stripe (optional save-card for reuse). No ID, no wallet required.       | —                                                               |
| **Business** (verified by a holder of its billing right — the owner, or an admin they named) | KYB (corporate registration + UBO). `fn_business_kyb_verified`.                                   | Spending the pooled Business Wallet — every door through `finance.fn_assert_business_spend` (§14) — paying an invoice (`finance.pay_invoice`, Decision #247 (h)) and withdrawing (`finance.begin_payout`). Never adding money: top-ups, deposits and transfers in need no KYB (an archived Business takes none, Decision #248 (k)). |
| **Enterprise**                             | KYB, as for a Business (`org.enterprises.verification_level = 'verified'`).                       | Paying from its wallet at checkout (`finance.place_wallet_order`). **Not built yet** (FDD X11, K4): the spend gate, transfers out (`finance.transfer_funds`) and withdrawals (`finance.begin_payout`) check only a business's KYB, never an enterprise's. |

- **Why the freelancer gate is at _onboarding_, not payout-time:** it guarantees no funds ever land
  in a **permanent-escrow / unpayable** state — a freelancer cannot accept work they can't be paid
  for.
- **Tier ladder** (mirrors `PRODUCT_SPEC.md`): `1` Basic (email/phone) · `2` Verified (gov ID + liveness) ·
  `3` Business (KYB/UBO). Stored as `finance.verification_cases.tier`.
- **No PII in domain tables:** only opaque provider references (Stripe Identity session / Connect
  account id) are stored; documents/PII live at Stripe / Supabase Vault (`PRODUCT_SPEC.md`
  §Identity, Taxes & Compliance #5 (Data Privacy & The "Vault")).
- ⚠️ **Distinct from email verification** (`org.user_emails.verified_at`).
- **Enforced in the database:** the earner gate on every apply, seat, assign, claim and team door
  (`fn_assert_payout_ready`, Decision #196), and KYB on every business spend door through
  `finance.fn_assert_business_spend` (§14, Decision #240, closing #54 (e)), on `finance.pay_invoice`
  (Decision #247 (h)) and on `finance.begin_payout`.

---

## 11. Multi-Currency & FX

The abstract intent ("price and be paid in your own currency; see prices in yours") is in
`PRODUCT_SPEC.md` §Escrow, Wallets & Finance #6. The **mechanics**:

- **Store-in-origin.** Every amount is `(amount_minor, currency)`, stored and **settled** in the
  currency it was entered in. No priced entity is currency-less (all already carry `currency`).
- **Settlement is per currency** (Decision #337, ruling M5 (a)) — **Not built yet**: the platform
  holds a Stripe balance in each of the 12 display currencies, so a payout transfers in the wallet's
  own currency from a same-currency balance and is never converted at payout.
- **An entity's currency comes from its owner's country** (ruling M5 (b)) — **Not built yet**: one
  country → currency map (`packages/types/finance/countries.ts`) sets a team's, business's or
  enterprise's wallet currency, never the display preference, and a project defaults to its owner's
  currency, never USD. Location and browser signals (IP country, locale) only **suggest** the
  country at sign-up, for the person to confirm, and choose a guest's display currency; they never
  set an entity's currency.
- **Base currency = GBP** (`security.platform_params.base_currency`) for system accounts, fees, and
  cross-currency bridging.
- **Snapshot-at-commit.** At escrow lock / release / checkout the FX rate(s) used are captured onto
  the row (`fx_rate`, `fx_base`, `fx_as_of` on `finance.transactions`/`escrows`), sourced from
  `finance.fx_rates`. Settlement is therefore deterministic and reproducible — it never drifts with
  the market. **Not built yet**: no function writes these columns today, because no money is
  converted (FINANCE_AUDIT C7); `finance.escrows`' are kept as **reserved** for the conversion below
  (Decision #337, ruling Q0.2 (d)).
- **Display conversion is read-time only.** Balances/prices are shown in the viewer's
  `org.user_preferences.preferred_display_currency` using the latest `finance.fx_rates` row; this
  **never** mutates stored amounts or affects settlement. Rates come from a **daily FX feed**, and
  every converted figure carries a **staleness mark** naming its rate's date (ruling M5 (f)) — **Not
  built yet**: every converted figure today uses a seed rate dated 2026-08-01.
- **Conversion between one's own wallets** (rulings M5 (c), (d)) — **Not built yet**: a holder may
  convert a balance from one currency to another at the mid-market rate plus a **disclosed margin**,
  paid by the payer (in a conversion, the holder converting). The margin is a
  `security.platform_params` dial whose value is not set yet. Until it is built, balances are per
  currency and withdraw-only.

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

- **Recurring deposits** (`finance.deposit_rules`): standing top-ups (weekly/monthly, or `below_floor` — a
  business **floor top-up** that runs each time its default-currency wallet crosses below
  `low_balance_floor_cents`, Decision #172) from a funding
  method; consecutive failures increment `failure_count` (drives dunning / auto-pause).
- **Withdrawals** (`finance.begin_payout`, Decision #202): the wallet is debited, then a Stripe
  Transfer leaves for the owner's verified Connect account, which pays their bank on Stripe's schedule.
  - **Minimum** (`security.platform_params.min_withdrawal_minor`, per currency in its minor units,
    roughly £10 each, pending product sign-off): GBP · USD · EUR · CHF 10.00; CAD · SGD 15.00; AUD
    20.00; JPY ¥2,000; INR ₹1,000; ZAR R200; NGN ₦20,000; AED 45.00; any other currency 1000 minor units.
  - **Destination:** a named payout method must be the owner's own and active; it is recorded on the
    payout. The Transfer always goes to the Connect account.
  - **Reversal** (`transfer.reversed`): the reversed part returns to the wallet (`payout_reversal`);
    a full reversal makes the payout `reversed`.
  - **Bank outcome** (Connect `payout.paid` / `payout.failed`): recorded beside the payout, owner
    told; nothing moves in the ledger (§8, Failed Withdrawal).
  - **Stuck payouts:** one still `pending` after `payout_stale_minutes` (**15**) is reconciled by a
    sweep every 10 minutes: completed from its Stripe transfer, re-sent under the same idempotency key
    within 23 hours, or returned to the wallet after that.
- **Payout schedules** (`finance.payout_schedules`): `manual` · `scheduled_weekly` ·
  `scheduled_monthly` · `threshold` (pay out when Available ≥ `threshold_cents`). **Not built yet**
  (Decision #337, ruling M6): no engine runs a schedule, so the control is locked behind a
  `LockedDialog` reason until one does — first in the build order (schedules → pots → Income
  Smoother). **Instant Payout** (`instant = true`) charges
  `security.platform_params.instant_payout_fee_bp` to bypass the standard Stripe clearing window
  (§1.4) — **Planned** (ruling P3): the fee stays unset until priced.
- **Income Smoother** (`finance.income_smoothing`): buffers earning peaks and tops up troughs into a
  salary-like monthly figure. **Fee ~0.5%** (`income_smoother_fee_bp = 50`). **Eligibility gate:**
  `income_smoother_min_months = 3` months of earnings history **and** ≥
  `income_smoother_min_volume_cents` lifetime volume (the volume floor defaults to `0` pending
  pricing sign-off — set a concrete figure when the economics land). **Planned** (ruling M6): it
  needs a `PRODUCT_SPEC.md` entry and a disbursement design before its engine is built, and
  enrolment is locked meanwhile.
- **Pots** (`finance.wallet_pots`) are **earmarks inside the wallet**, never a separate balance
  (Decision #337, ruling M6): named (`tax` / `savings` / `goal` / `general`), each labels part of
  the wallet's own money. A pot with `auto_allocate_bp > 0` earmarks that % of each inbound payout
  as it matures — the **tax-pot auto-set-aside** (suggested default `tax_pot_default_bp`, opt-in,
  `0` by default) — and a wallet's pots together earmark at most 100% (Σ bp ≤ 10000). **Not built
  yet**: neither auto-allocation nor any pot movement runs, so the control is locked until they do
  (second in the build order). Clients read pots and never write them.
- **Deadline bonus** (Decision #337, ruling M7): a client may offer a bonus for delivery by a
  stage's deadline, on one-off and pipeline projects alike, of **+10%** of the stage price
  (`DEADLINE_BONUS_RATE = 0.1`, the starting dial). It is held with the escrow at funding; release
  pays it when the deadline was met, and it is refunded to the payer fee-free when it was missed.
  **Not built yet**: until the bonus is held, a non-zero bonus is refused (a CHECK). Today release
  pays `amount + deadline_bonus_cents − fee`, nothing funds the bonus, and only a pipeline's form
  offers it.

---

## 14. Vault Permissions, Caps & Approvals

Governs shared wallets (Business / Team / Enterprise).

- **Capability grants** (`finance.vault_permissions`, not a single role): `view` · `add_funds` ·
  `spend` · `distribute` · `withdraw` · `manage_members` · `manage_billing` · `approve_spend`.
  Enforced in-DB by `finance.fn_has_vault_capability`. **Reconciled 2026-09-28 (Decision #61):** the
  grants are a PROJECTION of the workspace capabilities (`org.workspace_capability` — contribute →
  `add_funds`, spend → `spend`, manage finances → `distribute`, withdraw → `withdraw`, approve spend →
  `approve_spend`, the owner → `manage_members` + `manage_billing`, and on a business a named
  admin's owner-granted `manage_billing` → `manage_billing`, Decision #238), rewritten on every membership
  change; the per-kind `org.business_permission` / `org.team_permission` enums are retired. Deciding an
  over-limit spend needs `approve_spend`, not `manage_members` (which also carries `withdraw`).
- **Spending caps** (`finance.spending_limits`, existing): per-member `cap_cents` per `weekly` /
  `monthly` / `total` period and an optional per-transaction ceiling; `spent_cents` tracked,
  `fn_check_spending_limit` enforced in the transaction that moves the money. A cap row, and a spend
  request, is read by the member it binds and by holders of `distribute` or `approve_spend` (the owner
  included) — `finance.fn_reads_wallet_envelopes`, Decision #238. **Changing a member's period**
  (Decision #246) carries over what the current window counted — `spent_cents` is never reset by a
  period change, unless that window had already lapsed, when there is nothing to carry — and the new
  window ends at the next weekly or monthly boundary (`total` never resets). Setting it on a row with
  a ceiling is Business Pro's, like the ceiling itself (§16.1).
- **One spend gate for business money** (`finance.fn_assert_business_spend`, BUSINESSES_AUDIT BF19 /
  BF21 / BF22): every door that moves a business's pooled money — the basket, paying on account, a
  transfer out, funding a stage, ticket or paid revision, the card escrow lock, and the escrow holds —
  requires an **active** business (`org.fn_assert_business_active`, `55000 business_not_active`,
  Decision #236) that is **KYB-verified**, counts the spend against the envelope of the **member who
  acts** (never the project owner's, unless no person acts: a claim, the Chain Reaction or the
  auto-fund drain spends as the project owner) **once** per spend (a basket's ticket line counts
  against the buyer at the basket, not again at its hold), and applies the approval threshold. The
  threshold is the wallet's own `approval_threshold_cents`, else the platform's
  `vault_approval_threshold_cents` (seeded **0** = none) — one resolver, `fn_business_threshold`,
  for every reader. The platform default becomes a **per-currency map**, like `min_withdrawal_minor`
  (§13) (Decision #337, ruling M5 (e)) — **Not built yet**: one figure in minor units serves every
  currency today. Team and personal spending are not governed by this gate.
- **Approval thresholds** (`finance.spend_approvals`): a spend at/above the threshold above (or
  over a member's cap) is refused (`PA403 needs_approval` / `over_limit`) until a request for that
  same thing is approved by a member holding `approve_spend` who is not the requester — the owner's
  own spend included (#239 (e)). The member files it at checkout, and the auto-fund drain files one
  for a ticket. A request is bound to the one thing it approves — a basket at checkout, a ticket,
  stage or paid revision to fund, a transfer's destination (an invoice ref is accepted but never
  needed: paying an invoice settles debt and reads no envelope or threshold) — at the amount it was
  filed for, and is **spent exactly once**: the charge for that same thing, at or under that
  amount, by the member who asked (any spender for a ticket's automatic hold), redeems it in the
  same transaction as the money movement. A charge above the approved amount needs a new approval. A request lives
  **7 days** from filing, deciding and spending included; there is one open request per thing.
  The member who asked may **withdraw** it while it waits (`finance.withdraw_spend_approval`,
  Decision #246): it becomes `withdrawn` — never decided, never spent, nothing moves — and the thing
  it named is free for a new request.
  **Business wallets only** — a team has nobody holding `approve_spend` to decide one. The request's
  states — pending → approved → consumed · rejected · expired · withdrawn — are
  `PRODUCT_MANAGEMENT.md` §3.5 (Spend approval).
- **Audit** (`finance.ledger_audit`): immutable who/when/amount for every
  add/spend/distribute/withdraw.
- **Team smart-splits** (`finance.split_rules` template → `finance.contribution_agreements`
  per-member, §5): **Co-op** `(100% − Vault%) / N` · **Finder's Fee** (fixed % to originator,
  remainder split) · **Benevolent Dictator** (100% to Team Vault); Finder's Fee and Benevolent
  Dictator are Pro Team templates (§5). **Deterministic remainder
  rounding:** after integer division, any leftover minor unit(s) go to the **Team Vault**, so a
  split always sums back to the released total (the ledger nets to zero).
- **Agency treasury** (Decision #337, ruling M10 (c)): an agency runs **per-engagement contribution
  agreements** on its one split rule. There are no squads or nested treasuries (master vault →
  department → squad) and no `nested_split_rules` key.
- **Two remainder rules — money and stake — kept apart on purpose:**
  - **Money dust → the Team Vault.** A release divides minor units: every cut is floored, and the
    leftover (under one minor unit per staked member) is credited to the vault with its cut
    (`finance.fn_team_split_plan`). The same inputs always give the same ledger, and member credits +
    finder's fee + vault = the release less the platform fee, exactly.
  - **Stake remainder → the largest absorber.** When a member leaves, their basis points are
    redistributed across the remaining (unheld) stakes by the team's split rule (confirmed by
    Decision #337, ruling M10 (b)) and the rounding remainder goes to the member absorbing the most
    (`org.fn_rebalance_departed_stake`). It cannot go to the vault: stakes must total 10000 bp and
    the vault holds no stake — its share is the rule's `vault_bp`, taken off the top before stakes
    divide the rest.

---

## 15. Invoicing, Statements, Refunds, Reconciliation & Idempotency

- **Intervaled invoicing** (`finance.invoices`, existing) — see `PRODUCT_SPEC.md` §Escrow, Wallets &
  Finance #4 (Business Invoicing & Intervaled Billing): per-payout lines consolidated into a
  `consolidated_monthly` invoice, issued on the business's `org.business_profiles.billing_day`
  (1–28, set through `finance.set_invoicing_terms`; the 1st when NULL) — Decision #168. One invoice
  per currency, Projective as issuer, escrows selected by `released_at`; total = escrow + bonus +
  tax (the fee is shown, already inside); **due 14 days after issue** (`invoice_due_days`);
  idempotent per business, period and currency. Run daily by `finance.fn_run_billing_cycle` (pg_cron
  02:20 UTC), which also marks overdue invoices — Decision #172.
- **Paying on account** (Decision #172): `finance.place_on_account_order` credits the business
  wallet (`on_account_credit`) and pays the order from it; the period's credit is the invoice's
  amount due, settled by `finance.pay_invoice` (`invoice_payment`). **Limit: 25,000.00 owed per
  currency** (`on_account_limit_cents` = 2 500 000 minor units, product owner 2026-10-10); an
  overdue invoice withdraws the route. The limit becomes a **per-currency map** (Decision #337,
  ruling M5 (e)) — **Not built yet**: today one 2 500 000 applies in every currency's minor units,
  which is about £236 in INR and £13k in JPY.
- **Auto-funding & low balance** (Decision #172): `auto_fund_mode` (`off` · `add_to_basket` ·
  `from_wallet`) per business, `projects.auto_fund_override` per project; `low_balance_floor_cents`
  warns once per crossing (`wallet.low_balance`).
- **Statements** (`finance.statements`): a monthly consolidated statement over the calendar month,
  issued on the **1st** for every wallet by `finance.fn_generate_statement`, PDF-ready
  (`opening`/`closing`/`total_in`/`total_out`/`total_fees`).
- **Refunds & chargebacks:** recorded as **negative** `finance.transactions` lines
  (`reason ∈ refund | chargeback | escrow_refund | fair_exit_refund`); the chargeback **case**
  (Stripe dispute) is tracked in `finance.chargebacks`.
  - **A digital product** (Decision #337, ruling M8) is not refunded after its first download,
    except for non-delivery or a defective file, through a dispute; recovery comes from the seller's
    pending row first (§7). **Not built yet.**
  - **An escrow refund** makes its order line `refunded`, and the order is `refunded` only when
    every line is (ruling M8) — **Not built yet** (`PRODUCT_MANAGEMENT.md` §3.5, Checkout order).
- **Promo codes** (ruling M8): the code is recorded on the order (built), and by default an account
  redeems a code once, configurable per code. **Not built yet**: the per-account cap — today only
  `max_redemptions` limits a code.
- **Reconciliation:** internal self-consistency via `finance.v_wallet_reconciliation` (materialised
  balance vs ledger sum → `drift_cents` must be 0), checked nightly with the running balance by
  `finance.fn_reconcile_wallets`, which reports drift to ops and never corrects it; the ledger
  itself is append-only (Decision #186); external Stripe-balance-vs-escrow-pool reconciliation is an
  ops job (`SYSTEM_ARCHITECTURE.md` §Integration Blueprints). Beside it runs a per-currency
  conservation-identity view (§6; Decision #337, ruling M2) — **Not built yet**.
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
Abstract rules live in `PRODUCT_SPEC.md` §Standing, Mastery & Progression; the numbers live here.

**The governing design constraint** (product owner, 2026-07-24):

> _"A user should never feel suffocated by the tier they are on. It should feel like the features
> they have are plentiful, and upgrading to a higher tier just makes sense."_

Every magnitude below is held against that constraint — the free tier is generous by intent, and
each ceiling exists for anti-spam or shared-resource fairness, not as a toll.

### 16.1 The entitlement matrix (starting dials)

**Individuals** — the freelancer plan _contains_ the client plan, because a freelancer is a
superset of a client. There is no separate buyer plan to reconcile.

| Lever                              | Free                 | Pro (£12.99/mo · £99/yr) |
| :--------------------------------- | :------------------- | :-------------------- |
| Private draft projects             | **Unlimited**        | Unlimited             |
| Active public projects             | 3 concurrent         | 15 concurrent         |
| Published listings (seller)        | rung base: 10 → 50 | **2×** the rung base |
| Weekly proposals                   | 50 + rung bonus      | 150 + rung bonus      |
| Proposal buffer                    | 3 per 10h            | 5 per 10h             |
| Teams owned                        | 3                    | 6                     |
| Businesses owned                   | 1                    | 3                     |
| Teams / businesses **joined**      | **Uncapped**         | Uncapped              |
| Stored assets (`storage_megabytes`) | **25 GiB** (25 600) | **150 GiB** (153 600) |
| Promoted placement, full analytics | —                  | ✅                   |

**Entities** — attached to the team/business itself, not to its owner.

| Lever                      | Team Free | Pro Team (£29/mo · £280/yr) |   | Lever                      | Business Free | Business Pro (£39/mo · £380/yr) |
| :------------------------- | :-------- | :-------------- | - | :------------------------- | :------------ | :----------- |
| Members / seats            | 3         | 10 included, then £3.50/seat/mo |   | Concurrent public projects | 3             | 25           |
| Concurrent public projects | 2         | 15              |   | Managers (admins + `manage_projects` holders) | 2 | 10 included, then £4.00/manager/mo |
| Proposal pool              | 50/wk shared | 150/wk dedicated |   | Pooled wallet              | basic (KYB to operate) | full + caps  |
| Stored assets              | 25 GiB    | **500 GiB**     |   | Stored assets              | 25 GiB        | **500 GiB**  |
| Advanced vault splits      | —       | ✅             |   | Intervaled invoicing       | —           | ✅          |
| Promoted placement         | —       | ✅             |   | Departments                | 0             | 5            |

**Advanced vault splits** are the Finder's Fee and Benevolent Dictator templates (Decision #226 (d)).
They are enforced from day one, with no switch: `finance.save_split_rule` refuses a team whose plan
lacks the template's `split_template_<type>` flag (§5).

**Business Pro gates are enforced** (Decision #230 (e)): monthly intervaled invoicing
(`intervaled_invoicing`) and the full pooled wallet (`pooled_wallet_full`: per-member caps, an
approval threshold) refuse a Business without Business Pro. Unlike the fail-open family in §16.2,
the switch over them — `security.platform_params.business_plan_gates_enforced` — is seeded **on**,
and each environment sets its own; off, nothing is refused. The manager cap (`business_managers`)
counts admins plus every member whose role or own grant may manage projects, and the pending
invitations that offer such a role (Decision #230 (b)); a downgrade removes nobody, it refuses the
next manager. Business Free allows 2; Business Pro includes 10 and bills each further manager at
£4.00 a month (Decision #252, ruling S2). Clearing a cap or a threshold, and returning to
per-transaction invoicing, are never refused. Each refusal is `PK402` naming the entitlement, which
the console answers with an upgrade notice (`database/finance/Functions.md` § Business plan gates).
The ownership cap (`businesses_owned`: 1 Free / 3 Pro, Decision #230 (f)) is a personal-plan limit,
always enforced when a Business is created — no switch governs it (`org.create_workspace`,
`55000 plan:`).

A team must hold **≥ 2 members** before it may send proposals.

**Not built yet** (Decision #252, ruling S2): the seeded entitlements still carry the earlier dials
— Team Free 4 seats drawing on its members' proposal allowances, Pro Team 15 seats, Business Pro 15
managers — and nothing bills a seat or manager above the included number.

**Agency and Enterprise** — two plans with one price (Decision #252, ruling S2): **£89/mo** base
with 15 seats included, then **£6.00 per seat a month**; annual by custom contract.

| Lever                      | Agency (`team_agency`, a team plan)                  | Enterprise (`enterprise`)                          |
| :------------------------- | :--------------------------------------------------- | :------------------------------------------------- |
| Seats                      | 15 included, then £6.00/seat/mo                      | 15 included, then £6.00/seat/mo                    |
| Concurrent public projects | Unlimited                                            | Unlimited                                          |
| Proposal pool              | 300/wk + 18 per 10h — finite, never seat-scaled (S3) | — (a buyer)                                        |
| Departments                | — (a team has none)                                  | Unlimited, with nested businesses                  |
| SSO                        | —                                                    | SAML first — **Planned**, hidden (#336, ruling S7) |
| Audit-log retention        | 730 days                                             | 730 days                                           |
| Custom treasury export     | ✅ (`custom_treasury_export`, else 402 — ruling S4)  | —                                                  |
| API access                 | **Planned**                                          | **Planned**                                        |
| Account manager            | Dedicated                                            | Dedicated                                          |
| Service fee                | 5%; a rate only by contract (§16.4)                  | 5%; a rate only by contract (§16.4)                |

Enterprise keeps consolidated cross-department invoicing. **Not built yet**: the Agency plan row and
its entitlements, and Enterprise's base and seat prices (the seed carries a custom-priced
`enterprise` row with unlimited seats).

**Uncapped joining is deliberate.** Owning entities is metered; _joining_ them is not. Joining is
the viral motion of the platform, and capping it would suppress exactly the behaviour that grows
supply.

### 16.2 Proposal allowances (distribution, not a paywall)

- **Weekly allowance** — 50 (Free) / 150 (Pro), plus the earned rung bonus (up to +40). Both
  figures are chosen to be comfortably above real usage: 50 is enough for a freelancer to thrive
  without ever subscribing, and most will not spend it.
- **The buffer** — a rolling drip of 3 (Free) / 5 (Pro) proposals returned every 10 hours, capped
  at `proposal_buffer_hold_multiple` × the drip. A spend needs **both** weekly headroom and a
  buffer token, so a week's allowance can never be dumped into one hour of spam.
- **Team pools** (Decision #252, rulings S2, S3): Team Free draws on a **50/wk shared** team pool,
  Pro Team on a **150/wk** dedicated pool, and Agency on **300/wk** with a buffer of **18 per 10h**
  (`proposal_buffer_per_10h`) — finite, and never scaled by seats. **Not built yet**: Team Free's
  shared pool and the Agency pool; today a free team spends its members' own allowances.
- **Withdrawing a proposal refunds the unit.** Selectivity should never be punished twice.
- **Never sold à la carte.** A paid tier _raises_ the ceiling; it never removes it. The moment deep
  pockets can buy raw proposal volume, the anti-spam promise — the entire point of the mechanism
  — is broken, and the platform has rebuilt Upwork Connects.

**Enforcement is fail-open until tuned.** `security.platform_params.proposal_allowance_enforced` and
`footprint_caps_enforced` both default to `false`: the caps are **metered** from day one but refuse
nothing until a human flips them. Every magnitude on this page is a dial to be re-fitted against
`analytics.events` (`allowance.*`, `entitlement.denied`) — see
`documentation/database/analytics/`.

### 16.3 The Standing ladder (earned, never purchasable)

Standing is the discretised rung of the Reliability Index ($R_i$) — see `PRODUCT_SPEC.md`
§Reputation & Discovery. Two paths up the same mountain: **earn it** (rung) or **accelerate it**
(Pro), and they stack.

| Rung               | Min score | Min stages | Free listings | Proposal bonus | Discovery weight | Marketplace commission |
| :----------------- | --------: | ---------: | ------------: | -------------: | ---------------: | ---------------------: |
| **L1 New**         |         0 |          0 |            10 |            — |           1.00× |                     8% |
| **L2 Established** |        55 |          5 |            15 |            +10 |           1.05× |                     8% |
| **L3 Trusted**     |        70 |         20 |            20 |            +20 |           1.10× |                   7.5% |
| **L4 Expert**      |        82 |         50 |            30 |            +30 |           1.15× |                     7% |
| **L5 Elite**       |        92 |        120 |            50 |            +40 |           1.20× |                   6.5% |

Pro **doubles the listing column at every rung** — it multiplies what was earned rather than
replacing it, so a high-rung free user feels rewarded and Pro reads as an accelerant, not a gate.

**Score inputs** (all client-valued; weights are tunable dials, exposed in
`org.entity_standing.components`): stage completion 25 · on-time delivery 25 · dual-track review
scores 20 · dispute-free rate 15 · $W_i$ reliability 10 · tenure 5, minus active
`security.penalties` severity. **Never raw earnings and never raw proposal counts** — ranking by
spend or by volume is the pay-to-win trap this ladder exists to avoid.

**Delivery efficiency** (Decision #338, ruling P4) — **Not built yet**. The Reliability Index gains
the freelancer's measured efficiency: estimated against actual time, deadlines met against those the
client asked for, and the slowdown when they hold several projects at once. Below a minimum history
it sits at a baseline. Its weights are dials, not set yet. $W_i$ itself stays a ticket's load, takes
no CREATE-category weight, and is never this score.

The `min_stages` column is a volume floor: a flawless single engagement must not vault a subject to
the top of the ladder.

### 16.4 The 5% service fee and where it may flex

The project service fee does **not** taper with Standing and is **not** bundled into any plan. The
one sanctioned exception (owner decision, 2026-07-24; Decision #252, ruling S2) is a **volume
contract** — an Enterprise, Agency or Business commitment — recorded as an explicit, admin-approved,
time-boxed `finance.negotiated_rates` row with its `minimum_volume_cents` commitment and
`contract_ref`. It is agreed by contract, never bought with a plan: `/pricing` says "volume terms on
request", never that a plan lowers the fee.

> ⚠️ **Flagged for a human** (root `CLAUDE.md` §8): the fee is the **payer's** rate (below), so an
> Agency — a team, and so a payee — holding a contract has no escrow fee its rate applies to. Which
> rate applies when the payee, not the payer, holds a contract is not ruled.
`finance.fn_effective_platform_fee_bp` resolves it; absent a contract it falls through to
`security.platform_params.platform_fee_bp`.

Keeping the flex in a contract table rather than a plan entitlement means the fee can never drift
downward as a silent side effect of someone upgrading a subscription.

**Whose rate, and how it rounds (Decision #187).** The rate is always the **payer's** for an escrow
fee: an escrow release charges the escrow's payer's effective rate. A product sale pays the seller's
commission instead (§1.2; Decision #337, ruling M1 scopes #187 to escrow fees) — **Not built yet**:
today a wallet product sale charges the buying account's rate, deducted from each seller's credit.
The fee is computed in integer minor units and **truncated**: `fee = ⌊amount × bp / 10000⌋` (5% of
1,050 is 52, never 53). Every preview (checkout, team-split projection) uses the same rate and the
same rule, so a previewed fee is the charged fee.

### 16.5 What the platform deliberately does not do

- **No pay-to-win rank.** Pro accelerates capacity, never reputation. If clients suspect a rung can
  be bought, the signal collapses and the ladder is worthless to everyone.
- **No public earnings leaderboards.** They trigger race-to-the-bottom pricing and reward spam.
- **No vanity points** detached from something a client independently values.
- **No login or attendance streaks.** Streaks celebrate delivered quality (on-time delivery, fast
  response, dispute-free runs), never presence. Guilt mechanics are hostile to freelancer wellbeing
  and attract the wrong behaviour.
- **No metering of execution capacity.** Ever. See §1.1.

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
| `team_agency`       |     not set | —       | No figure ruled yet (Decision #252, ruling S2); `SUBSCRIPTIONS_BUILD_PROMPTS.md` S2 recommends 2 000 GiB. |
| `enterprise_free` |      25 600 | 25 GiB  | Draft tier: enough to configure and evaluate.                             |
| `enterprise`      |  **`NULL`** | ∞       | `is_unlimited = true`. The enterprise tier is never asked to budget bytes. |

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

### 16.7 Discovery ranking dials

The concrete numbers behind `PRODUCT_SPEC.md` §Reputation & Discovery 2 (Decision #178). The
COEFFICIENTS live in `search.search_weights` and are tuned live by an admin (`search.fn_set_weight`),
with no deploy; the thresholds are code constants in `packages/backend/services/explore/ranking.ts`
and `personalise.ts`.

| Dial                     | Value                                                                       |
| :----------------------- | :-------------------------------------------------------------------------- |
| Coefficients (seeded)    | `review_sentiment` 1.75 · `review_count` 1.00 · `workload` 1.50 · `discovery_boost` 1.25 · `penalty` 2.50 · `interest_history` 1.25 |
| Cold-start prior         | 5 pseudo-reviews at the track's corpus mean (delivery reviews and client reviews kept apart) |
| Review volume            | Logarithmic, saturating at 50 reviews                                       |
| Availability             | The free share of the Global Intensity Cap; zero at the cap                 |
| Discovery Boost          | Joined ≤ 90 days **or** still on L1 · nothing claimed against the cap · no active penalty · no rating below 4.0 |
| Standing multiplier      | The rung's discovery weight, §16.3 (1.00× – 1.20×); never applied to a penalty |
| Trust penalty            | Active `discovery_rank` severity, at full strength from 10                  |
| Trending                 | 7-day window · views count 1, saves 2 · at least 3 distinct people per item |
| New on Projective        | Published in the last 30 days                                               |
| Personal rails           | 3 items to show, 12 at most · "Because you viewed" anchors on the last 3 views |
| Topic affinity           | +1 per opening, decaying with a 14-day half-life                            |
| Semantic blend           | Weight 0.5 · floor 0.30 · relative 0.8 · at most 12 extra results (Decision #339, ruling N4) |
| Load and reliability     | **Not built yet** (Decision #338, ruling P4): a freelancer's current load ($W_i$, through Availability) and the Reliability Index's efficiency terms (§16.3) each carry a large weight; the coefficients are not set yet |

**What never moves the score:** verification (discovery weight comes from Standing alone, §16.5) and
any plan or payment. Paid visibility is the labelled sponsored placement (§1.4), never rank.

---

## 17. Record Retention & Erasure Windows

Ruled with the erasure model (Decision #336, rulings I1 (a), (b)); ⚖️ **pending counsel**, who
confirm the periods and Projective's AML posture. Projective operates as not AML-obliged, but every
AML record must exist and be deployable, so each record class is kept for the longest period any
obligation could require. Every period is a `security.platform_params` dial with a per-jurisdiction
override, never a constant. **Not built yet.**

| Record class                                                                                 | Retain for                                                          | Basis                                                                          |
| :------------------------------------------------------------------------------------------- | :------------------------------------------------------------------ | :----------------------------------------------------------------------------- |
| Ledger, escrow, payouts, invoices, orders, fees                                              | 7 years after the end of the financial year                         | UK statutory 6 years, plus a buffer; stricter where required (DE/FR: 10 years) |
| Legal-hold identity set (legal name, DoB, country, Stripe/KYC references)                    | 5 years after the relationship ends, or the ledger period if longer | MLR 2017 reg. 40 (AML-ready)                                                   |
| Seller tax-reporting data (platform reporting)                                               | 6 years (UK), 10 years (EU sellers, DAC7)                           | Digital-platform reporting rules                                               |
| Dispute record and its evidence (Evidence Vault, the messages attached to it, presence data) | 6 years after the dispute closes                                    | UK limitation period for contract claims                                       |
| Consent and terms-acceptance records                                                         | Life of the account, plus 6 years                                   | Proof of lawful basis                                                          |
| Security and auth logs                                                                       | 12 months                                                           | Incident investigation                                                         |
| Messages, files and profiles not under a hold                                                | Erased with the account                                             | No obligation                                                                  |
| Search query logs and embeddings                                                             | 90 days, and erased with the account                                | Minimisation                                                                   |

**Erasure windows** (ruling I1 (b)): giving up a freelancer profile ("switch to client") waits **90
days**, and an explicit erasure request completes within **30 days**. Both become
`security.platform_params` dials (`PRODUCT_MANAGEMENT.md` §3.5, Scheduled removal). The legal-hold
vault that keeps the identity set above is `PRODUCT_SPEC.md` §Identity, Taxes & Compliance's.
