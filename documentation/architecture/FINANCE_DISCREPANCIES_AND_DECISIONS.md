# Finance & Ledger — Discrepancies and Founder Decisions (2026-10-29)

> The contradictions between the source documents and the code, and the rulings they need. Companion
> to [`FINANCE_COMPLETENESS_AUDIT.md`](FINANCE_COMPLETENESS_AUDIT.md), whose finding IDs (L · W ·
> S · K · A · C · CO · R · D and N1–N34) are cited here. Recorded as **Decision #337** (open, awaiting
> the owner).
>
> **Numbering.** The 2026-10-17 [`FINANCE_AUDIT.md`](FINANCE_AUDIT.md) §4.6 proposed its flags as
> "Decision #251". They were never recorded, and #251 is now Teams W1. Every open flag from that list
> is carried here, merged or superseded, so nothing depends on the lost number. This row is logged
> as #337: #335 and #336 were logged the same day by the providers and identity audits. The
> concurrent scheduling audit ([`SCHEDULING_DECISIONS_AND_GAPS.md`](SCHEDULING_DECISIONS_AND_GAPS.md)
> §5) drafts its rulings as "#335" too, and needs a new number when it is logged. Where the two
> audits meet (paid calls, session timing), this document **defers** to that one and adds only the
> finance side.
>
> **Rule.** Nothing below is resolved by this document. Each item states what the sources say, what
> the code does, the options, and a recommendation. A ruling lands with its doc edits in the same
> change (`documentation/CLAUDE.md` rule 3).

---

## 0. The rulings needed, in order of urgency

| # | Decision | Recommendation | Why now |
| :-- | :-- | :-- | :-- |
| **D-2** | Paid consultations: money path and interim | Turn the paid flavour **off** now; then scheduling D1 Option C. Add the host payout-ready gate. | **P0 (N2).** A paid product is being delivered free. |
| **D-3** | Marketplace commission vs the 5% platform fee on product sales | **Charge the seller's Standing-tapered commission** on product sales; scope #187's payer rule to escrow fees | **P0 revenue (N3).** Every asset sale under-charges by 3 points. |
| **D-5** | Ledger model: single-entry now, double-entry when? | A **conservation-identity check now**, a **shadow journal before scale**, never a big-bang rewrite | CO20 and N4 are imbalances a trial balance would have caught |
| **D-6** | Freeze and claw back pending money on a dispute | Freeze the payee's pending rows on dispute; recover from them first, **inside the 7 days only** | Open since #126. The window exists for this and is not used for it. |
| **D-7** | Scope of the payout-ready earning gate | Gate at **listing publish** and session/seat booking; never at the buyer's checkout | The spec promises it (K3); sessions, products and paid calls bypass it |
| **D-1** | Late session cancellation: 50% or 100% | **Ratify 100%** (as built and as specified) and delete the 50% text | It blocks D-2's cancellation rules and the scheduling D2 grace rule |
| **D-9** | Spec promises with no build (ghosting auto-approve, maintenance, auto Fair Exit, instant payouts) | **Build** the 14-day auto-approve; mark the rest Planned and strike the contradicting text | N16: a ghosting client creates the forever-escrow the guarantee forbids |
| D-4 | Session release timing (24h review + 7d clearing) | Keep both; rename the 24h step | Spec wording calls both "Pending" |
| D-8 | Currency bundle (settlement, default, spread, stranded balances, thresholds) | Per-currency settlement; default from country; disclosed spread; per-currency limits | Carried from FINANCE_AUDIT (m)(n)(o); C15 is P0 |
| D-10 | Automation that saves and never runs (smoother, payout schedules, pots) | **Lock** each control until its engine runs; build schedules first | Gate §3.11 failure today |
| D-11 | Deadline bonus funding | Refuse bonuses until the bonus is held with the escrow | N4 would pay unfunded money |
| D-12 | Order refunds, digital-product policy, promo caps, order lifecycle | One refund policy; record the code; caps per user | CO25 / CO7 / CO13; no spec policy exists |
| D-13 | Wallet lane Top up and hero pills: which tier | Lane Top up → tier 1; hero pills stay glass | N15 / D5; DESIGN_SYSTEM F.3 is stale |

---

## 1. Contradictions register

**Source** columns cite the document. **Code** cites what runs today. "Hierarchy" means PRODUCT_SPEC
wins on business rules (root `CLAUDE.md` §0).

| ID | Topic | Source A | Source B | Code | Ruling |
| :-- | :-- | :-- | :-- | :-- | :-- |
| **X1** | Late session cancellation (< 24h) | `finance-model.md` §4: the freelancer gets a **50%** penalty fee | `PRODUCT_SPEC.md` §Sessions C (table, `:107`) and §Cancellation (`:319`): **full forfeit** to the freelancer | **100% forfeit**, net of the 5% fee, through the pending window, judged per sitting (`cancel_cohort_membership`, S1155:777-854; "There is no 50% split", :766-767; Decision #171). FM §4's own note concedes PRODUCT_SPEC wins. `database/scheduling/{Tables,Functions}.md` still say "deliberately not resolved". | D-1 |
| **X2** | A standalone paid 1-on-1 call's escrow | `PRODUCT_SPEC.md` §Discovery & Courtesy Calls: Escrow = "Session money path"; KYC "follows the standard Session rules"; the call "creates **no** Project, Stage, or Ticket" | `finance.escrows.project_stage_id` is `NOT NULL` (T17). `database/scheduling/Tables.md` §3 adds `payer_business_id NOT NULL` — stale since #126. | No money path. `request_discovery_call` copies the fee and may confirm the call unpaid (F1520:196-265). | D-2 (scheduling D1) |
| **X3** | Commission on digital-product sales | `finance-model.md` §1.2 and §16.3: **8% base**, tapering by the **seller's** Standing to 6.5%, 20% with boosts. `PRODUCT_SPEC.md:2617`: "a lower marketplace commission at the top rungs". | `finance-model.md` §16.4 and Decision #187: "a wallet product sale charges the **buying** account's [platform fee rate]" | Product sales pay the payer's 5% (F1210:1699, :1809). `fn_effective_commission_bp` (F1220:211) and the seeded tiers (`00005030:174-180`) are never called. | D-3 |
| **X4** | Does the project fee move with Standing? | Root `CLAUDE.md` persona §2 row 3: "the stage-completion fee (5% base … **adjusted by Standing**)" | `finance-model.md` §16.4: the fee "does **not** taper with Standing"; only a negotiated contract flexes it | Flat; F1220:229-231 says so. `standing_commission_tiers.platform_fee_bp` is unread. | D-3 (a guardrail file: human edit) |
| **X5** | What "Pending" means for a session | `PRODUCT_SPEC.md` §Sessions C table: "Session Complete → **Pending Window: 24-hour countdown**", then "Payout Release T+24h → Payment sent to Freelancer wallet" | `PRODUCT_SPEC.md` §5 and #191: a session payout "show[s] as **Pending** for 7 days" | Both: a 24h negative-consent sweep (`session_payout_hours`, S1155:1586-1598), **then** 7 days of `pending_releases`. Eight days from sitting to Available. | D-4 |
| **X6** | System wallets | `finance-model.md` §6: hidden **Escrow Pool**, **Fee Collection Account**, **Dispute Lockbox**; the §7 worked example puts £50 "to the Fee Collection Account" | `database/finance/Tables.md` admits single-entry; #54 (i) and #187 (b) note the fee account is not materialised | None exist. Escrow is a row; the fee is a column; the lockbox is `escrows.status='disputed'`. | D-5 |
| **X7** | Fair Exit trigger | `finance-model.md` §3: automatic thresholds by elapsed duration (< 25% refund · 25–75% split · > 75% pay) | `finance-model.md` §3 implementation note and #198: the **client** picks the tier from a preview | Client-selected (F1200:928-980) | D-9 |
| **X8** | Ledger model | `finance-model.md` §7: "Balances are a projection, not a stored total" | Same section and `Tables.md:19-24`: materialised single-entry, conversion "flagged for human sign-off" (#54 (b), never ruled) | Single-entry; no journal | D-5 |
| **X9** | Disputed money mid-window | `finance-model.md` §7: an `on_hold` state, the Dispute Lockbox, freezes contested funds | `PRODUCT_SPEC.md` §5: whether released money is clawed back "is **not yet decided**" (#126 flag) | `on_hold` never written (W3). A lost chargeback recovers from the **payer** only (W4). | D-6 |
| **X10** | When the payout-ready gate bites | `PRODUCT_SPEC.md` §5: a freelancer "cannot apply for or **accept paid work** … until both are in place" | #196's door list: apply · seat · assign · claim · team | Ungated: session booking (`fn_book_session_slot`), seats (`fn_confirm_seat`, `reserve_seat`), product sales (F1210:1827), listing publish, paid calls (K3) | D-7 |
| **X11** | KYB for enterprise wallets | `PRODUCT_SPEC.md` §Enterprise onboarding (`:3131`): full KYB "remains deferred to verification Level 3 before a Business Wallet opens" | `PRODUCT_SPEC.md` §Identity Level 3 and `finance-model.md` §10 name Business wallets only | Partial: `place_wallet_order` refuses an unverified enterprise; the spend gate, `transfer_funds` and `begin_payout` check `business` only (K4) | Factual fix (§3) |
| **X12** | Billing period | `PRODUCT_SPEC.md` §4: "tracks all Escrow activity within a **30-day window**"; `Tables.md` (statements): "30-day window" | Same §4, `finance-model.md` §15 and #168: a calendar month on the business's billing day; statements on the 1st | Calendar month (F1200:781-876) | Factual fix |
| **X13** | Stripe account type | `finance-model.md` §9: "Stripe Connect (**Custom/Express**)" | SA §Integration Blueprints 1 and #125: **Express**, Accounts v2, never v1 `type:"express"` | Express, Accounts v2 (`stripe-rails.ts:183-199`) | Factual fix |
| **X14** | SA's Stripe claims | SA:3120 "payouts … grouped by `transfer_group`"; SA:3148 "Reconciliation compares the Stripe balance against the internal escrow pool"; SA:3138-3147 lists the handled events | — | The payout Transfer uses its own group (N18); no Stripe-balance reconciliation (L6); 15 snapshot + 2 thin events, with gaps (H3) | Factual fix |
| **X15** | Maintenance stages | `finance-model.md` §8: "pre-authorize the next cycle's funds 3 days before" | #210 and `PRODUCT_SPEC.md` §2: "there is **no** pre-authorised budget or wallet reservation" | Nothing: `projects.maintenance_contracts` has no function | D-9 |
| **X16** | Ghosting | `finance-model.md` §8: a **14-day auto-approve** if the client neither approves nor disputes | `PRODUCT_SPEC.md` §5's No Forever-Escrow guarantee assumes every escrow can always be released | No timeout on a held ticket escrow (N16) | D-9 |
| **X17** | Settings that never act | `finance-model.md` §13: payout schedules (weekly · monthly · threshold · instant), Income Smoother (~0.5%), pots auto-skim | Root `CLAUDE.md` §3 gate 11: "A control that renders must do something". The smoother has no `PRODUCT_SPEC.md` entry. | Schedules save, never run (A14). The smoother enrols and never disburses (A6). Pots are never allocated (A2). | D-10 |
| **X18** | Wallet money-verb tier | DESIGN_SYSTEM:1418 tier-1 test: "the act that **starts**" a financial flow is tier 1 | #331 put Top up in the lane as `LaneCreateButton` (tier 2). DESIGN_SYSTEM F.3 (:5856-5859) still describes unfilled hero pills. | Lane Top up tier 2 (`WalletLane.island.tsx:274-280`); hero pills bespoke glass (D5) | D-13 |
| **X19** | `/wallet/create` | `PRODUCT_SPEC.md:3427` lists it | `ROUTING.md` and `[section].tsx:24` answer 404 | 404 | Factual: delete from the spec (wallets are provisioned with their owner) |
| **X20** | Failed bank payout | `finance-model.md` §8: "funds bounce back to their Personal Wallet" | #202 (a), as built: money stays in the Stripe payout account | As #202 (a) | Already logged, still awaiting a human (#202 (a)) |
| **X21** | Currencies | `PRODUCT_SPEC.md` §6: "priced in the **creator's local** currency"; display is presentational only | Team and business wallets take the creator's **display** currency, else `USD`; GBP is base; USD defaults on projects | C1, C16, C17 | D-8 |
| **X22** | `transactions.fund_state` | T17:56-65 comment and `Tables.md`: each line carries its fund state | — | Never written; every row reads `available` (N13) | Factual: write it, or retract the claim |
| **X23** | Checkout query state | `ROUTING.md:525-532` | — | `?display=` honoured (N27); the payment step's 302 drops it and the dev axes (N26) | Factual |
| **X24** | Decision-log hygiene | `FINANCE_AUDIT.md` §4.6 "Decision #251 (proposed)" | `decisions/README.md`: #251 = Teams W1 | — | Superseded by #337 (this document) |

---

## 2. Decisions required

Each decision gives the options, a Pros / Cons breakdown (feasibility · database · UX · commercial),
the recommendation, and what lands with the ruling. The commercial test throughout is root
`CLAUDE.md` §3.A: no proposal may degrade client trust, invite spam, or turn the micro-agency model
into low-margin gig labour.

### D-1 — Late session cancellation economics (X1)

The code, `PRODUCT_SPEC.md` and Decision #171 already agree on **100% forfeit to the provider**
inside `session_cancel_notice_hours` (24). Only `finance-model.md` §4 and two schema docs hold out.

| Option | Pros | Cons |
| :-- | :-- | :-- |
| **A. Ratify 100% (as built)** | No code change. Matches the "Time Protection" promise that makes paid sessions worth offering. The refund/penalty columns already record outcomes. | Harsh on a buyer with a genuine emergency |
| B. 50% penalty | Softer for buyers | A money-path change in a proven settlement engine (`session_settlement.sql`, 17 checks). Weakens the provider promise. Contradicts the spec's table. |
| C. Tiered (100% < 12h, 50% 12–24h) | Fair at the edges | A third rule to explain. It interacts with the 12h reschedule lockout that scheduling D2 proposes to move to 24h. |

**Recommendation: A**, with two guards: (i) scheduling D2's "born inside the window" grace, so a
session rescheduled into the window is not forfeited the moment it is moved; and (ii) a provider may
voluntarily refund a forfeit (a refund door, provider-initiated, which is a D-12 item). **Lands
with:** strike FM §4's 50% line and its note; retire the flags in `database/scheduling/Tables.md` §3
and `Functions.md` §6; one sentence in `PRODUCT_SPEC.md` §Sessions C citing #171.

### D-2 — Paid consultations (X2, N2)

The scheduling audit owns this ruling: [`SCHEDULING_DECISIONS_AND_GAPS.md`](SCHEDULING_DECISIONS_AND_GAPS.md)
D1 recommends **Option C**. A paid call rides Decision #211's proven 1-1 session rail through one
hidden *Consultations* engagement per host. Money is held at request and refunded on decline or
expiry. In the meantime the paid flavour is off. **Finance concurs**, and asks that the ruling also
settle:

1. **The host's payout-ready gate.** Enabling paid calls in Settings (`call_settings.paid_enabled`)
   must require `fn_freelancer_payout_ready`, the same rule D-7 applies to a listing. Without it,
   Option C escrows money for a host who cannot be paid: the exact forever-escrow the guarantee
   forbids.
2. **Fee and window.** The call's release charges the payer's platform fee and clears the 7-day
   window, like any session sitting (D-4). No new money rule.
3. **The protected table stays untouched.** Option C keeps `finance.escrows.project_stage_id NOT
   NULL`. Relaxing it (scheduling Option A) would fork about 25 stage-keyed function references in
   F1200 / F1210 / F1260 / S1155 and needs explicit approval under the Additive Rule. **Finance
   recommends against it.**

**Commercial.** A paid consultation is a top-of-funnel conversion product, and the cheapest proof
of a provider's value. Delivering it free trains providers to take payment off-platform, which is
the leakage Decision #147 polices. Interim containment is one refusal in `request_discovery_call`
and one hidden card in `ConsultationModal`.

### D-3 — Marketplace commission vs the platform fee on product sales (X3, X4, N3)

| Option | Pros | Cons |
| :-- | :-- | :-- |
| **A. The seller's Standing-tapered commission on product sales** (`fn_effective_commission_bp(seller)`, 8% → 6.5%). The boost tier waits for boosts. #187's "payer's rate" is scoped to escrow fees. | Revenue as specified: 60% more take on asset GMV at the base rung. Activates the strongest retention mechanic in FM §1.2 (the best sellers pay least, never purchasable). The resolver and seed already exist. | A change to `place_wallet_order`'s fee block and to the seller-credit preview. Sellers on the platform today see their net fall from 95% to 92%. Needs a disclosure line on listings and in the seller dashboard. |
| B. Keep 5% at the payer's rate; delete the commission ladder from FM and PRODUCT_SPEC | No change. Cheapest marketplace in its class. | Abandons a specified revenue line and the Standing taper. Fee flex follows the **buyer's** contract, so an Enterprise buyer's negotiated rate lowers what an unrelated seller pays the platform. |
| C. Commission, floored at the payer's negotiated rate | Protects enterprise deals | Two resolvers per sale; hard to explain to a seller |

**Recommendation: A.** The payer-rate rule in #187 is right for escrow, where the client's contract
governs the engagement. It is wrong for a marketplace sale, where the **seller** is the platform's
customer and Standing is the seller's. Test against Fiverr: a 20% seller commission is the
benchmark Projective undercuts; 8% → 6.5% stays far below it while still pricing the marketplace as
a product. **Lands with:**

- Amend #187 to scope "payer's rate" to escrow fees.
- `finance-model.md` §16.4: one sentence.
- `place_wallet_order` reads the seller's commission for `product_sale` lines and records it as
  `orders.platform_fee_bp` per line, or as a line column (a schema decision for the build).
- A probe pinning 8% at L1 and 6.5% at L5.
- **A human edit to root `CLAUDE.md`'s persona row** ("adjusted by Standing" applies to the
  commission, not the stage fee; X4). An agent must not edit a guardrail file on its own initiative.

### D-4 — Session release timing (X5)

Today: sitting ends → 24h negative consent (no-show claim window) → 7-day clearing → Available.

| Option | Pros | Cons |
| :-- | :-- | :-- |
| **A. Keep both; rename** the 24h step "**Review window**" and keep "Pending" for the 7-day clearing | One meaning per word. The 24h protects the attendee, and the 7 days protects the platform against early chargebacks. | Eight days to Available is slow next to a consultant paid by direct card |
| B. Sessions skip the 7-day clearing | Next-day money for consultants | Chargeback exposure moves to the platform (W4 recovers from the payer only). Breaks #191's single rule for earned money. |
| C. One 7-day window from the sitting's end, with the no-show claim open for the first 24h | Fastest single rule | Re-engineers the session sweep; two clocks fused into one row |

**Recommendation: A.** The fix is vocabulary: `PRODUCT_SPEC.md` §Sessions C's table says "Pending
Window: 24-hour countdown", and §5 says "Pending for 7 days". Instant payouts (D-9) are the
sanctioned way to buy speed later. **Lands with:** the two table rows reworded; the wallet's
Upcoming copy reading `pending_release_days` (N21).

### D-5 — The ledger model (X6, X8)

The question is not "single- or double-entry". It is **what level of assurance the platform needs
before it holds real client money at scale**, and how to get there without touching the protected
tables.

| Option | What | Pros | Cons |
| :-- | :-- | :-- | :-- |
| **A. Conservation identity (now)** | A per-currency view (FINANCE_COMPLETENESS_AUDIT §4.4) over existing tables, checked nightly beside `fn_reconcile_wallets`, with an ops reader for both | No writer changes. Additive (a view and a job). It would have caught CO20 and N4. It makes the TVL figure in the investor summary defensible. | It detects and does not prevent. It cannot attribute an imbalance to one transaction. |
| **B. Shadow double-entry (before scale)** | New `finance.ledger_accounts` (per owner wallet + system accounts per currency: `escrow_pool`, `pending_clearing`, `fee_revenue`, `dispute_lockbox`, `stripe_clearing`, `receivable_on_account`, `chargeback_loss`), `finance.journal_entries` and `finance.postings` (Σ = 0 per entry, a deferred constraint trigger). Written by the existing primitives and escrow functions **in the same transaction**. `transactions` stays as the user-facing projection. | Prevents imbalance by construction. Materialises the Fee Collection and Escrow Pool accounts of FM §6 (S5). Turns on-account credit into a receivable (CO20's root cause). Gives Stripe reconciliation (L6) its counterpart account. Fully additive: no table or column is dropped. | Every money-moving definer function (dozens, across F1200–F1260 and S1155) gains postings. A dual-write period with a nightly diff. Real effort before any user-visible gain. |
| C. Derived balances now (drop the cache) | Balances computed from postings | Canonical | Big-bang rewrite of protected tables and every read. Additive Rule approval. Highest risk at the worst time. |

**Recommendation: A now, B before scale, never C as a big bang.** Ship A with the P0 fixes, since it
is the cheapest assurance there is. Commit to B before any of: live money beyond a pilot, an
enterprise contract that asks for an audit trail, or a regulator or auditor asking how client funds
are segregated. Under B, the cache flips to "derived and checked" one wallet kind at a time.

**Also confirm with Stripe and counsel** how long escrow may sit in the platform balance under
Separate Charges & Transfers, and the safeguarding posture this implies. FM §9's "legally segregated"
claim is a legal statement the code cannot prove.

**Lands with:** a design note in SA §Integration Blueprints 1; `database/finance/Tables.md` §
Materialised balance updated to point at the chosen stage; FM §6's system wallets marked "planned
(D-5 B)".

### D-6 — Disputes inside the safety window (X9, W3, W4)

| Option | Pros | Cons |
| :-- | :-- | :-- |
| **A. Freeze and recover from the payee's pending money, inside the window only.** `record_dispute_opened` flips matching `pending_releases` to `on_hold` (maturation skips them). A lost dispute recovers from those rows first, then the payer, then platform loss. A won dispute restores `pending` with the original `available_at`. | Uses the 7-day window for the job #191 created it for. Never touches Available money, so "released is yours" holds. | A freelancer can lose pending money to a client's bank. Needs clear copy. |
| B. Status quo: recover from the payer only; the platform eats the rest | Maximally freelancer-friendly | Freelancers pay 7 days of liquidity for protection the platform never draws on. Makes chargeback fraud against the platform cheap. |
| C. A platform-funded reserve from the fee | Nobody but the platform pays | Puts loss on the 5% before the unit economics are proven |

**Recommendation: A.** It is the only option where the 7-day cost freelancers bear buys something.
The trust line to publish: "Money that has cleared is yours. Money still clearing can be held while
a payment dispute is open." **Lands with:** `PRODUCT_SPEC.md` §5 closing #126's flag; FM §7's
`on_hold` row marked wired; N22 (the read shows On hold); H4 (out-of-order close) in the same
change.

### D-7 — The payout-ready gate's scope (X10, K3)

| Option | Pros | Cons |
| :-- | :-- | :-- |
| **A. Gate at publish and booking.** A session listing, a product listing and the paid-call switch cannot go live, and a seat or sitting cannot be confirmed, until the seller (a team: every shareholder) is payout-ready. | The buyer never meets a refusal. The spec sentence becomes true. No earnings accrue to an unpayable wallet. | Sellers must verify before listing. That is friction at the top of the seller funnel, which drafts soften because drafting stays free. |
| B. Narrow the spec: earn freely, gate only withdrawal | Lowest seller friction | Money accrues in wallets that cannot withdraw: a forever-*balance*, if not a forever-escrow. Contradicts PRODUCT_SPEC §5's onboarding rationale. |
| C. Gate at the sale | Simple | The **buyer** is refused at checkout for the seller's paperwork: the worst place to fail a conversion |

**Recommendation: A.** It matches the platform's own "unlimited private drafting; going live is the
gate" pattern. **Lands with:** #196's door list extended; N12 (a seller-side refusal reads as the
seller's, not the buyer's); a Dev Context Switcher axis for wallet verification (R13); a
`payout_ready_gate.sql` probe case per new door.

### D-8 — Currency bundle (X21; carried from FINANCE_AUDIT (m)(n)(o))

| Sub-decision | Recommendation | Main alternative | Why |
| :-- | :-- | :-- | :-- |
| (a) Platform settlement currency (C17) | **Per-currency Stripe balances** for the 12 display currencies; a payout Transfers in the wallet's currency from a same-currency balance | Convert at payout and disclose the spread | A USD Transfer from a GBP-settled balance either fails or silently eats FX |
| (b) An entity's currency (C1) | From the owner's **country** (one map in `packages/types/finance/countries.ts`), never the display preference | Owner chooses at creation | The spec says display is presentational only |
| (c) Stranded balances (C4) | Launch **without** conversion; state in the spec that balances are per currency and withdraw-only; build `convert_between_own_wallets` later at a disclosed spread | Build it now | Smallest correct scope; avoids FX-dealer exposure before (d) is ruled |
| (d) Who bears the FX spread (FM §11, open since #54 (a)) | Mid-market plus a **disclosed** margin, payer-side | Pass-through | Must be ruled before (c) is built |
| (e) Thresholds (C15) | `on_account_limit_cents` and `vault_approval_threshold_cents` become per-currency maps, like `min_withdrawal_minor` | — | 25,000.00 in minor units means about £236 in INR and £13k in JPY. **P0 regardless of the rest.** |
| (f) Rates (C5, C6) | A daily FX feed **and** a staleness mark on every converted figure | Staleness disclosure only | Every converted figure today uses a seed rate dated 2026-08-01 |

### D-9 — Spec promises with no build (X7, X15, X16)

| Item | Recommendation | Reason |
| :-- | :-- | :-- |
| **14-day ghosting auto-approve** (FM §8) | **Build (P1).** A submission neither approved nor disputed within 14 days auto-approves through the normal release path, with notices at 7 and 13 days. | Without it the No Forever-Escrow guarantee is false in the client-ghosting case (N16). It matches Upwork's fixed-price auto-release, which freelancers already expect. |
| Automatic Fair Exit thresholds (FM §3) | Keep the client-selected tier (#198), but have the server **recommend** the tier from elapsed duration in the preview; the freelancer may dispute a lower pick | The current flow is fair only if the client chooses honestly |
| Maintenance cycles, 48h negative confirmation, 3-day pre-authorisation (FM §4, §8) | Mark **Planned**. Strike "pre-authorize", which contradicts #210's no-reservation rule. | Nothing is built, and the text contradicts a later ruling |
| Instant payouts (FM §1.4, §13) | Mark **Planned** with `instant_payout_fee_bp` unset until priced | A fee of 0 reads as free |

### D-10 — Automation that saves and never runs (X17)

**Recommendation: lock each control behind a `LockedDialog` reason until its engine runs** (gate
§3.11), and build in this order:

1. **Payout schedules.** The contract is complete; this needs a runner job plus N17's currency fix.
2. **Pots.** Auto-allocation at maturation, movement doors, a Σbp ≤ 10000 cap, SELECT-only RLS (A4).
3. **Income smoother.** It needs a `PRODUCT_SPEC.md` entry and a disbursement design first. Enrolment
   is locked meanwhile.

The alternative, leaving savable settings that do nothing, fails the merge gate and erodes trust in
every other money control.

### D-11 — Deadline bonus funding (N4)

Release pays `amount + deadline_bonus_cents − fee` and nothing funds the bonus.

| Option | Pros | Cons |
| :-- | :-- | :-- |
| **A. Hold the bonus with the escrow** at funding. Release pays it if the deadline was met; otherwise it refunds fee-free. | Money exists before it is promised (no hold, no work, applied to bonuses) | The client funds more up front |
| B. A separate hold when the deadline is met | Client cash stays free longer | The hold can fail at the moment of release; a promised bonus becomes a refusal |
| C. No bonuses until A | Zero risk | Pauses a specified feature (`allow_deadline_bonuses`) |

**Recommendation: C immediately** (a CHECK or a guard refusing a non-zero bonus), **then A**.

### D-12 — Commerce rules (CO7, CO13, CO25)

There is no refund policy in the spec, so these need product rulings:

| Question | Recommendation |
| :-- | :-- |
| Refund of a **digital product** | No refund after the first download, except non-delivery or a materially defective file through a dispute. A refund inside the 7-day window recovers from the seller's pending row (consistent with D-6). |
| An escrow line's order after an escrow refund | The order line moves to `refunded`. The order is `refunded` when every line is, else stays `confirmed` with the line states shown. |
| Order lifecycle writers | Write `invoiced` for on-account orders (and fix the "Projective wallet" label); `refunded` / `cancelled` as above. Retire `processing` / `awaiting_payment` from the enum comment if nothing will write them (root `CLAUDE.md` §5 forbids bespoke statuses, so retire rather than invent; the change lands in `PRODUCT_MANAGEMENT.md`). |
| Promo codes | Record the code on the order (factual, no ruling). A per-user cap is a product choice: recommend **one redemption per account per code** by default, configurable per code. |
| Provider-initiated refund of a session forfeit | Allow it (supports D-1's harsh default) |

### D-13 — Money-verb button tiers in the wallet (X18, N15, D5)

| Option | Pros | Cons |
| :-- | :-- | :-- |
| **A. Lane Top up → tier 1** (`severity="accent"` in the lane footer); hero pills stay glass under the #122 licence; DESIGN_SYSTEM F.3 rewritten as shipped by #331 | Follows the tier-1 test as written; amber keeps meaning "money" | One accent pill in the lane beside a tier-4 Withdraw; `LaneCreateButton` gains an accent mode |
| B. Keep tier 2 and narrow the tier-1 test (#157 (j)) | No change | Weakens the one-hue-means-money rule the checkout depends on |

**Recommendation: A**, and rule #157 (j) the same way: amber marks the act that starts or commits a
money flow, everywhere.

---

## 3. Factual corrections (no ruling needed)

These follow existing rules or decisions. Batch them into one docs sweep after the P0 fixes:

| Doc | Correction | Item |
| :-- | :-- | :-- |
| `finance-model.md` §9 | "Custom/Express" → Express on Accounts v2 (#125) | X13 |
| `PRODUCT_SPEC.md` §4, `database/finance/Tables.md` (statements) | "30-day window" → calendar month on the billing day / the 1st | X12 |
| `PRODUCT_SPEC.md` sitemap | Remove `/wallet/create` | X19 |
| SA §Integration Blueprints 1 | Payout transfers are grouped per payout, not by the charge's group; Stripe-balance reconciliation is unbuilt (L6); the handled-event list as it is (H3) | X14 |
| `database/scheduling/Tables.md` §3 | `payer_business_id` was relaxed by #126; session engagements are built (#211). Also proposed by the scheduling audit's draft (its §5 (c)). | X2 |
| `finance-model.md` §10 / code | Enterprise KYB on the spend gate, transfers and payouts (K4) | X11 |
| T17 comment / `Tables.md` | `fund_state` matches what is written (N13) | X22 |
| `ROUTING.md` checkout | Add `?display=`; the payment 302 keeps the search string (N26, N27) | X23 |
| F1200:368, F1210:1822, PBS:366-368, `ConfirmPayDialog.tsx:18-21` | Stale comments (N30) | — |
| `DESIGN_SYSTEM.md:1797` | Re-point the deleted `wallet-overlays.css:28` citation (carried from FINANCE_AUDIT (k)) | — |

---

## 4. Decision #337 (logged, open)

The row in `reference/decisions/decisions-122-126.md` carries the full text. In short:

> **#337** Finance & ledger completeness audit (2026-10-29) — FINANCE_COMPLETENESS_AUDIT.md +
> FINANCE_DISCREPANCIES_AND_DECISIONS.md. **Contradictions surfaced, not resolved:** X1–X24 (§1),
> including (X1) the late-session-cancel 50% vs 100% (code and PRODUCT_SPEC: 100%), (X2) paid
> consultations with no money path, (X3) the marketplace commission vs #187's payer rate on product
> sales, (X4) root `CLAUDE.md`'s "fee adjusted by Standing", (X5) "Pending" meaning both 24h and 7
> days for sessions, (X6/X8) the system wallets and derived double-entry that do not exist, (X16) no
> ghosting timeout under the No Forever-Escrow guarantee. **Proposed rulings, awaiting the owner:**
> D-1–D-13 (§2). **Supersedes** the never-recorded "Decision #251" of FINANCE_AUDIT §4.6 (the number
> went to Teams W1); its open flags (b)–(t) are carried as X/D items here. **P0 defects needing no
> ruling:** CO20, A12, N1, CO6, CO8, C13/N7, C15, V6, R5.
