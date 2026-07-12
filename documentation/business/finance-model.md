# Finance Model: Fees, Payouts & Wallet Architecture

> **Source-of-truth note:** `brain.md`'s "Escrow, Wallets & Finance" and "Hiring Process" sections
> are the authoritative description of _when_ escrow locks/releases and how negotiation works. This
> document is the detailed **implementation-level financial model** that fills in the concrete
> numbers, state machine, and edge cases that `brain.md` deliberately leaves abstract. It
> consolidates the former `monetization.md`, `payout.md`, and `wallets.md`.
>
> **⚠️ Unresolved conflict:** This document and `investor-summary.md` disagree on the platform
> service fee — this file (and the wallet ledger example below) consistently say **5%**, while
> `investor-summary.md` states **10%**. Neither figure appears in `brain.md`. Resolve which is
> current before using either number externally.
>
> **Implemented value:** the escrow engine now operationalizes **5%** — `security.platform_params`
> `platform_fee_bp = 500` (set in migration `0305`), applied on escrow release by
> `finance.fn_release_ticket_escrow`. The `investor-summary.md` 10% figure remains **unreconciled**
> for external/investor use; this note preserves the conflict rather than erasing it.

---

## 1. Revenue Streams (Phase 2+)

### 1.1 Project Service Fee

- **Standard Service Fee:** 5% plus Stripe processing costs, applied to each project stage upon
  escrow release.
- Split between platform operations, escrow management, and dispute mediation infrastructure.
- No paywall on freelancer project volume — capacity is governed by the Workload Intensity ($W_i$)
  caps described in `brain.md`, not by subscription tier.

### 1.2 Marketplace Commissions

- Digital asset sales (templates, codebases, design assets): **8–20%** commission.
- Base rate (8%) is comparable to Etsy; the 20% tier applies to listings using internal "Search
  Boosts" or promoted placement.

### 1.3 Subscription Tiers (Phase 3+)

| Tier           | Target           | Key Paywall Triggers                                                   | Pricing (Est.) |
| :------------- | :--------------- | :--------------------------------------------------------------------- | :------------- |
| **Starter**    | Solo Freelancers | Unlimited portfolios, unlimited active stages (capacity-based)         | Free           |
| **Pro Team**   | Micro-Agencies   | High limit on team members and active team projects                    | £29/mo         |
| **Enterprise** | Large Corps      | Unlimited Businesses, multi-department scoping, API access, audit logs | Custom         |

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

Three fund states, plus a state-machine trace of a stage's full lifecycle:

1. **Escrowed (Locked):** held by the platform until a trigger/approval is met.
2. **Pending (7-day safety window):** released from escrow but held for final review.
3. **Available:** withdrawable to the user's bank via Stripe Connect.

```text
[Stage Funded] -> [Escrowed State] -> [Trigger/Approval] -> [7-Day Pending Window] -> [Available Balance]
```

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
