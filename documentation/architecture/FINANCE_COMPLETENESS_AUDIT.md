# Finance & Ledger — Completeness Audit (2026-10-29)

> Read-only evaluation of the FINANCE & LEDGER domain — the `finance.*` schema and its definer
> functions, `packages/backend/services/finance/`, `packages/types/finance/`, the `/wallet` and
> `/checkout` routes and their islands — against `PRODUCT_SPEC.md`, `finance-model.md`,
> `SYSTEM_ARCHITECTURE.md`, `ROUTING.md`, `DESIGN_SYSTEM.md` and `database/finance/*`. No code was
> changed. The contradictions and the rulings they need are in the companion
> [`FINANCE_DISCREPANCIES_AND_DECISIONS.md`](FINANCE_DISCREPANCIES_AND_DECISIONS.md), recorded as
> **Decision #337** (open).
>
> **Relation to [`FINANCE_AUDIT.md`](FINANCE_AUDIT.md) (2026-10-17).** That audit's fix plan
> ([`FINANCE_BUILD_PROMPTS.md`](FINANCE_BUILD_PROMPTS.md)) has not run, and its proposed "Decision
> #251" was never recorded — #251 went to Teams W1. This audit re-verifies every finding against
> today's code and keeps the original IDs (L·W·E·S·K·H·A·V·R·M·Z·C·CO·D). Findings first raised here
> are numbered **N1–N34**. §5 gives the status delta.
>
> **Method.** Code reading with file:line evidence. No tests, probes, type-check or live database
> were run, so a finding is "verified in code", not "reproduced". Line numbers are as of
> 2026-10-29; many moved since the 10-17 audit.
>
> Abbreviations: **T17** = `supabase/migrations/00000017_tables_finance.sql` · **F1200** /
> **F1210** / **F1220** / **F1230** / **F1240** / **F1250** / **F1260** = `…/000012x0_functions_finance_*.sql` ·
> **S1155** = `…/00001155_functions_projects_sessions.sql` · **F1520** =
> `…/00001520_functions_scheduling_free_busy.sql` · **P2013** = `…/00002013_policies_finance.sql` ·
> **G2510** / **G2520** = the function / table grant files · **svc/** =
> `packages/backend/services/finance/` · **CBS** = `svc/CheckoutBackendService.ts` · **PBS** =
> `svc/PaymentBackendService.ts` · **wlt/** = `apps/web/features/wallet/` · **cko/** =
> `apps/web/features/checkout/` · **SA** = `SYSTEM_ARCHITECTURE.md` · **FM** = `finance-model.md`.

---

## 0. Premise corrections

The brief carried assumptions that the code or the guardrails contradict. They are corrected first
so the findings are read against the right baseline.

| Brief assumed | Actual (source) |
| :-- | :-- |
| The Additive Rule means fixes are new numbered `ALTER` migrations | **Forbidden.** Migrations are edited in place (root `CLAUDE.md` §1). The Additive Rule governs the schema's *shape* — no dropped tables, columns or FKs on `wallets` / `escrows` / `project_stages` without approval — not the file layout. Every fix below names the file to edit. |
| Tier 1 is "Accent Amber `#D98216`" | `#D98216` is the **seed** of the accent role (`theme-engine.ts:86`, DESIGN_SYSTEM §A.1.2). A financial commit uses `severity="accent"`, which reads `var(--accent)` / `var(--on-accent)` (`packages/ui/fields/styles/button.css:237-239`). A literal hex in feature CSS would be a merge-gate failure; none exists. |
| Focus chrome must hold on all four checkout steps | **Details and Payment only** (DESIGN_SYSTEM §D.6). The basket is a place a buyer may leave, and the confirmation's job is to send them on, so both keep the full shell *by rule*. `checkout-chrome.ts:32-35` implements exactly that. |
| `finance.fn_freelancer_payout_ready` is the No-Forever-Escrow gate | It is the **predicate** (F1210:17-29). The gate is `finance.fn_assert_payout_ready` (`PK403`, F1210:63-102) on the #196 doors. It guarantees the payee is *payable*. It does not guarantee release: a held ticket escrow under a client who never reviews has no timeout (N16). |
| The fee is a flat 5% constant | A **parameter** (`platform_fee_bp = 500`, `00005001:30`) resolved per **payer** by `fn_effective_platform_fee_bp` (a `negotiated_rates` row wins), truncated, and **deducted from the payee** (`seller_deducted`) — never added to the client (Decision #187). Product sales charge it too, although the spec prices them with an 8% Standing-tapered commission (N3). |
| The 7-day Pending window governs every credit | Earned credits only (escrow, team split, fair exit, session, dispute split, product sale). Top-ups, refunds, transfers in, distributions, payout reversals and on-account credit are Available at once (§4.2). Sessions add a separate 24-hour review *before* the 7 days (Discrepancy X5). |
| A derived double-entry model is "planned" | It is an aspiration in FM §7 and #54 (b), with **no design**. There is no journal, posting or system-account table. The escrow pool, fee collection account and dispute lockbox of FM §6 do not exist (§4). |
| `deposit_rules` / `payout_schedules` are live automation | Recurring deposits run. **Payout schedules save and never execute** (A14), so the control does nothing (gate §3.11). |
| Standalone 1-on-1 paid calls are blocked by `project_stage_id` | Half true. `payer_business_id` was relaxed by #126. Only `project_stage_id` is still `NOT NULL` (T17 `finance.escrows`). The paid-call money path is unbuilt, but the call itself is **bookable and can auto-confirm unpaid** (N2). |

---

## 1. Executive summary

**Verdict: the core ledger is sound and the money doors are mostly honest, but the domain is not
production-ready.** The append-only ledger with loud primitives, the trigger-enforced "no hold, no
work" gate, the webhook-only settlement with in-transaction idempotency, and the pending window are
production-grade. Around them are two security holes that PostgREST can reach today, one path where a
card can be charged and never credited, a paid product (consultations) delivered free, a revenue line
(marketplace commission) never charged, and a ring of automation that saves settings and never
runs.

**Since 2026-10-17:** none of the prior audit's P0 items is fixed. Six findings changed in part
(A16, CO18, K2, K3, K4, W4). Five design items are fixed or superseded (D6, D11, D16, D18, D28).
Thirty-four new findings are logged here.

> **Fixed since this audit (2026-10-29):** **CO20**: `place_on_account_order` refuses `PC409` unless
> the order's `charged_minor` equals `p_amount` (F1250), probe `supabase/probes/on_account_amount.sql`.
> **A12**: `finance.deposit_rules` is SELECT-only for clients; the `spend`-keyed `FOR ALL` policy is
> gone (P2013, G2520), probe `supabase/probes/deposit_rule_authority.sql`. Both probes failed before
> the change and pass after it. The local DB has not been reset since, so run `deno task db:reset`
> before relying on it. Still open from those backlog rows: N5 (the on-account limit race), A4 (pot
> write RLS) and A13 (pause / edit / cancel a rule).
>
> **Fixed 2026-10-30 (Wave 0):** **A4** `finance.wallet_pots` is SELECT-only for clients (P2013, G2520;
> probe `wallet_pot_authority.sql`). **A13 (door only)** `finance.update_deposit_rule` pauses,
> resumes, re-prices and archives a rule (F1240; `archived_at` on T17), and `trg_deposit_rules_immutable`
> fixes a rule's wallet, currency, card and interval (probe `deposit_rule_authority.sql` §6–12); no UI
> or service calls it yet. **N1** `settle_card_payment` binds an unbound payment by
> `metadata.projective_payment_id`, and `finance.claim_unsettled_card_payments` +
> `PaymentBackendService.sweepUnsettledCardPayments` (`POST /api/finance/cron/card-payments`) recover a
> charge whose every delivery was lost (probe `card_payment_metadata_bind.sql`); the scheduled job is
> not registered yet. **N5** `place_on_account_order` takes an advisory lock per (business, currency)
> before the owed read (probe `on_account_amount.sql` §5–6). Ledger invariants:
> `supabase/probes/finance_invariants.sql`.

| # | P0 risk | Class | Where |
| :-- | :-- | :-- | :-- |
| 1 | **CO20** — `place_on_account_order` credits a caller-supplied `p_amount`. An inflated call leaves the surplus as Available, withdrawable business balance. | Security · money minted | F1250:486-550 · G2510:936 · CBS:811-814 |
| 2 | **A12** — a `spend`-only vault member can rewrite another member's recurring deposit (amount, card, wallet, `next_run_at`), and the next run charges the author's card. | Security | P2013:59-61 · G2520:181 · F1240:1266-1272 |
| 3 | **N1** — a saved-card PaymentIntent is created with `confirm:true` *before* the ledger binds it. If the bind fails and the browser never retries, every webhook delivery is `unmatched` and the charge is never credited. | Money loss | PBS:340-371 · `stripe-rails.ts:139` · F1230:708-716 |
| 4 | **N2** — paid consultations are priced, bookable and auto-confirmable with no payment, no escrow and no payout-ready check on the host. | Commercial · trust | F1520:121-265 · `ConsultationModal.tsx:418-427` |
| 5 | **N3** — the marketplace commission (8% → 6.5% by Standing) is seeded with a resolver that has **no caller**. Product sales are charged the buyer's 5%. | Revenue | F1220:211 · F1210:1699 · `00005030:174-180` |
| 6 | **CO6 / CO8** — the promo cap race, and a promo on escrow lines that charges the card before the order fails (`settled_unapplied`) | Money correctness | F1210:1629-1644, :1853 · `live-basket.ts:1200` |
| 7 | **C13 / N7** — totals silently drop currencies they cannot convert, and "wallet covers" sums every currency while the database debits one | Money display | `wallet-scope.ts:265-300` · `commerce-owner.ts:324-343` |
| 8 | **V6 / R5** — approval Review shown to the wrong members; a foreign `?w=` silently becomes the personal wallet | Authority · honesty | `WalletHome.island.tsx:474-475` · `wallet-scope.ts:220-224` |

---

## 2. Feature completeness

### 2.1 Shipped / production-ready

| Feature | Evidence | Caveat |
| :-- | :-- | :-- |
| Append-only single-entry ledger; credit/debit primitives raise `PW404`; `balance_cents ≥ 0` | L1–L3: F1200:10-56, :1039-1050; trigger `00001830:95-104`; revoked from client roles (G2510:976-1047) | `fund_state` is never written (N13) |
| Separate Charges & Transfers on Accounts v2 Express | S1, S3: `stripe-rails.ts:88-103, 183-199, 226` | Transfers draw on the platform balance, with no `source_transaction` (S2) and no settlement-currency handling (C17) |
| Webhook-only settlement, signature-verified, claimed in the effect's own transaction, with a ledger row required for 2xx | H1, H2, H5: `core/stripe.ts:238-271`; F1230:679; `stripe-webhook.ts:282-301` | Event coverage gaps (H3/H4) |
| "No hold, no work" | `projects.fn_ticket_escrow_sync`, AFTER UPDATE (`00001110:349-379`, bound at `00001850:41-44`) refuses `PF402` on every entry into work without a held escrow, for every actor | `INSERT` is not covered (N6) |
| One held base escrow per ticket; held-only status flips; lock order | E1, E2: `00004005:14-25`; F1200:728-750, :1007-1018 | Dispute thaw can collide (E3) |
| Stage / ticket / revision funding — wallet and card, prepaid unbound escrow | `projects.fund_stage` (`00001150:707-740`), `fund_paid_revision`, `begin_card_payment` | Wallet path has no amount assert (N8) |
| 7-day pending window with hourly `SKIP LOCKED` maturation | W1, W2: F1240:1514, :1597; `pending_release_days=7` (`00005001:91`); cron `00005060:50` | Forecast hard-codes 7 (N21) |
| Withdrawals: debit, Transfer, reversal, stuck-payout sweep | #202; `begin_payout` F1240:315-368; `payout-sweep.ts`; cron route with constant-time bearer | Failed **bank** payouts stay in Stripe (#202 (a), open) |
| Payout-ready earning gate on gig and seat doors | K1, K2: F1210:17-102; `00001020`, `00001130`, `00001135`, `00001140` | Sessions, products and paid calls are ungated (K3, N2) |
| Session settlement: 1-1 per-sitting escrow, cohort seats, 24h negative consent, no-show disputes | #211, #212: S1155:338-349, :564-682, :1586-1598; F1260:210-271 | No open-dispute check on the forfeit path (L9) |
| Fair Exit (25/50/75) with a server preview | #198: `preview_stage_fair_exit`, F1200:928-980 | Tier chosen by the client, not derived from elapsed time (X7 in the companion doc) |
| Team split engine; plan-gated templates; dust to the vault | A17, A18: F1200:106-215; `save_split_rule` F1210:2365 | Departed finder still paid; downgrade not re-checked (A19) |
| Business spend gate and spend approvals bound to one thing and spent once | A15, #239, #240: F1210:2139-2219, :2788 | No global expiry sweep (A16, partial) |
| Consolidated monthly invoicing, idempotent per business · period · currency | A8: F1200:781-876; F1250:696; cron 02:20 | Tax hard-coded 0 (A9) |
| Recurring deposits (create and run) | A11: `create_deposit_rule` F1240:977-1022; `claim_due_deposit_rules` | **Write hole (A12)**; no pause/edit/cancel (A13) |
| Store-in-origin multi-currency; one wallet per owner · currency; mixed baskets refused | C2, C3, C19 | FX snapshot never written (C7); exponents disagree (C10) |
| Checkout integrity: server totals, DB re-pricing, derived discounts, promo re-check, key replay, 3DS, `settled_unapplied` | CO1–CO3, CO5, CO9, CO12, CO14, CO16, CO19, CO24 | See CO4, CO6, CO8, CO10, CO11, CO20, N1 |
| Wallet: four pages and one island, server-decided actions, honest `?flow=`/`?do=`/`?back=`, one dialog at a time | R1, R2, R4, R6, R8, R9, M1, M3 (`wlt/islands/WalletHome.island.tsx:378-449`; `wallet-state.ts:77-89`) | R3, R5, R10, R11, M2, M4 |
| Checkout chrome: focus on Details and Payment, constructed not hidden; stepper with `aria-current` | `checkout-chrome.ts:32-35`; `UserShell.tsx:189-258`; `CheckoutStepper.tsx:80-128` | Stepper's Details link loops (N11) |
| Tier-1 accent on financial commits | `CheckoutPaymentScreen.island.tsx:894-906`, `ConfirmPayDialog.tsx:73-79`, `AddPaymentMethodModal.island.tsx:227-241`, `FundStageDialog.tsx:142-153`, `WalletDialogs.tsx:444, 479-487` | Buy Now Pay (N9) and lane Top up (N15) |
| No Supabase or `@server/*` in any finance island | Frontend sweep §7 | — |
| Nightly wallet self-reconciliation (writer) | L5: F1200:1057-1110; cron 03:40 | Nothing reads the drift rows |

### 2.2 Partially built / stubbed

| Feature | What exists | What is missing | IDs |
| :-- | :-- | :-- | :-- |
| Reconciliation | Per-wallet cache-vs-ledger drift writer | Any reader or alert. Stripe-balance-vs-escrow reconciliation (SA:3148 claims it). Pots in the view. | L5, L6, L7 |
| Disputes and chargebacks | Session dispute lifecycle; chargeback recovery from the **payer** (pending first, then Available) | `on_hold` never written; payee pending never frozen or clawed; `charge.refunded` / `dispute.updated` / `funds_*` / `payout.canceled` unhandled; `.closed` before `.created` strands the case; no open-dispute check on ticket, fair-exit or forfeit releases | W3, W4, H3, H4, L9, E3 |
| Platform fee | Computed, floored, recorded on `escrows.platform_fee_cents` / `orders.platform_fee_minor` | A balance anywhere (no Fee Collection account); the resolver silently returns 0 if the param is missing | S4, S5 |
| Marketplace commission | `standing_commission_tiers` seeded 8 → 6.5%; `fn_effective_commission_bp` | **Any caller.** Product sales use the payer's 5%. The boost tier (20%) has no data. | N3 |
| Payout-ready gate (No Forever-Escrow) | Gig, seat, team and withdrawal doors | Session listings and booking, cohort seats, product listing and sale, paid calls. The checkout maps the refusal to a generic `verification_required`. | K3, N2, N12, N14 |
| KYB for enterprise wallets | `place_wallet_order` refuses an unverified enterprise (F1210:1334-1340) | Spend gate, `transfer_funds` and `begin_payout` still check `business` only | K4 |
| Paid consultations | Price on settings and row; `ck_call_fee_matches_type`; Consultation modal offers it | Payment, escrow, refund-on-decline, host payout-ready gate. Calls can be born `confirmed` unpaid. | N2 |
| Pots (tax / savings / goal) | Table, Zod, RLS, one read tile | Auto-allocation, movement doors, a Σbp cap, UI. Write RLS is `FOR ALL` on `spend`. | A2, A3, A4, D7 |
| Income smoother | Enrolment door with server eligibility | Disbursement, fee, a PRODUCT_SPEC entry. The read crashes with two currencies. | A6, A7, N20 |
| Payout schedules | Table; the wallet saves a schedule | **Anything that runs it.** The save lands on an arbitrary currency row. Instant payout has no path. | A14, N17 |
| Recurring-rule management | Create and run | Pause, resume, edit, cancel; "Paused" shown with no control | A13 |
| FX | Seed rates; read-time conversion; `stale` computed | Live feed; snapshot at commit; staleness shown; one exponent list; locale | C5–C7, C9, C10, C12 |
| Statements and bills on `/wallet/invoices` | Rows and the PDF route exist; Billing links to it | A PDF link on the wallet (`hasPdf: false`) | R10 |
| Order lifecycle | `confirmed` | `processing` · `awaiting_payment` · `invoiced` · `refunded` · `cancelled` writers; on-account labelled "Projective wallet" | CO13 |
| Spend approval expiry | Stale rows for the same ref expire on the next request (F1210:2969-2979) | A global sweep | A16 |
| Invoicing tax | Line structure | Tax computation (`v_tax := 0`) | A9 |
| Deadline bonus | Release pays `amount + deadline_bonus_cents − fee` | **Anything that funds the bonus** | N4 |
| Wallet + card split payment | `shortfall` computed (CBS:528) | Offered to the buyer | CO17 |

### 2.3 Missing / unimplemented

| Feature | Spec | Evidence of absence |
| :-- | :-- | :-- |
| Derived double-entry journal and system accounts (Escrow Pool, Fee Collection, Dispute Lockbox) | FM §6, §7; #54 (b) | No journal / posting / account table; grep of migrations (§4) |
| Platform-wide conservation check (wallets + escrow + pending + fees vs. money in − money out) | Implied by FM §15 | None (§4.4) |
| Refund or cancel from an order, including digital products | — (no policy) | CO25: the only `orders` UPDATE is the fee total (F1210:1851) |
| Ghosting auto-approve (14 days) | FM §8 | No job, no function. A held ticket escrow never times out (N16). |
| Maintenance-cycle payouts, 48h negative confirmation, pre-authorisation 3 days ahead | FM §4, §8 | `projects.maintenance_contracts` table only; no function references it |
| Automatic Fair Exit thresholds from elapsed duration | FM §3 | FM itself records "not yet wired" |
| Instant payouts | FM §1.4, §13 | `instant_payout_fee_bp = 0`; schedules never run |
| Live FX rate feed | FM §11 | Only `00005050` writes `fx_rates` |
| Abandoned-basket nudge; stale `requires_payment` sweep | PRODUCT_SPEC §Notifications (`:1261`) | CO15 |
| Promo code recorded on the order; per-user caps | — | CO7 |
| Own-wallet currency conversion | — | C4 (balances are stranded per currency) |
| `idempotency_keys` retention sweep | SA §Financial idempotency | L8 |
| `/wallet/create` | PRODUCT_SPEC sitemap (:3427) | 404 by `ROUTING.md` and `[section].tsx:24` (R12) |

---

## 3. Alignment matrix — island ↔ route ↔ service ↔ database

✅ aligned · ⚠️ drift · ❌ broken or missing. The wallet pages render server-side through
`wlt/core/wallet-ssr.ts` → `WalletBackendService`. Islands refresh and act through `/api/wallet/*`
(`wlt/core/api.ts`). Every action goes through `POST /api/wallet/action` (Zod) →
`svc/wallet-actions.ts` → a definer door, and the database is the authority.

| Capability | Island / component | Route | Service | Database door | Status | Findings |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| Wallet overview (hero, rail, upcoming) | `WalletHome.island` · `WalletHero` · `AccountRail` · `UpcomingList` | `/wallet` · `GET api/wallet/overview`, `switcher`, `funding` | `WalletBackendService` → `live-wallet.ts`, `wallet-scope.ts`, `pending-window.ts` | RLS reads: `wallets`, `pending_releases`, `escrows`, `income_smoothing` | ⚠️ | A7, C13, R5, N21, N22 |
| Ledger list and CSV | `LedgerList` · `LedgerRow` · `LedgerFilters` · `WalletTools` | `/wallet/transactions` · `GET api/wallet/transactions`, `export` (Zod) | `wallet-ledger.ts` | RLS read `transactions` | ⚠️ | R11, D12, D14 |
| Analytics | `AnalyticsView` · `CashFlow` · `FlowAreaChart` | `/wallet/analytics` · `GET api/wallet/activity` | `live-wallet.ts`, `wallet-standing.ts` | RLS reads | ⚠️ | N19 (commission figure computed in TS), D13, M4/M5 |
| Statements and bills | `InvoicesPanel` | `/wallet/invoices` · `GET api/wallet/invoices` · `api/finance/statements/[id]/pdf` | `live-wallet.ts` (`hasPdf:false`) | `statements`, `invoices` | ❌ | R10 |
| Top up (card) | `WalletDialogs` MoveDialog · `WalletLane` Top up | `api/wallet/action` | `topUp` → PBS `createTopUpIntent` | `begin_card_payment` → `attach_card_payment` → webhook `settle_card_payment` | ⚠️ | N1 (saved card), N15 (lane tier) |
| Withdraw | MoveDialog · lane Withdraw (tier 4) | `api/wallet/action` | `wallet-actions.ts` | `begin_payout` + Stripe Transfer | ⚠️ | K4, N14, C17, S2 |
| Transfer · distribute | MoveDialog | `api/wallet/action` | `wallet-actions.ts` | `transfer_funds` (`withdraw`) · `distribute` | ⚠️ | V4 |
| Fund escrow from wallet | MoveDialog `fund_escrow` | `api/wallet/action` | `wallet-actions.ts:383-407` | `projects.fund_stage` (no expected amount) | ⚠️ | N8 |
| Fund a stage by card | `FundStageDialog` (payments) | `POST api/finance/escrow/intent` · `GET …/quote` | PBS `createEscrowLockIntent` · `stage-funding.ts` | `begin_card_payment` (DB asserts amount) → `fund_stage` at settlement | ✅ | N10 (money string) |
| Recurring deposit | Config dialog | `api/wallet/action` · `POST api/finance/cron/deposits` | `wallet-actions.ts` · `scheduled-deposits.ts` | `create_deposit_rule` · `claim_due_deposit_rules` · **direct table UPDATE allowed by RLS** | ❌ | A12, A13 |
| Payout schedule | Config dialog | `api/wallet/action` | `setPayout` (`wallet-actions.ts:441-455`) | Table write; **no runner** | ❌ | A14, N17 |
| Income smoother | Config dialog | `api/wallet/action` | `wallet-actions.ts` | `set_income_smoother` (enrolment only) | ❌ | A6, A7 |
| Approve or reject a spend | Approval dialog | `api/wallet/action` | `wallet-actions.ts` | `decide_spend_approval` (`approve_spend`) | ❌ | V6 (UI gates on `manage_billing ‖ distribute`) |
| Saved cards | `AddPaymentMethodModal.island` · `MethodsList` | `api/finance/cards/setup`, `confirm` | `CardsBackendService` | SetupIntent; `payment_methods` | ✅ | — |
| Payout account and identity | Settings `PayoutGateLink` · `VerificationGate` | `api/finance/connect/*` · `identity/session` · `verify/*` | PBS | `record_payout_account` · `sync_payout_account` · `apply_identity_event` | ✅ | R13 (no dev axis on the wallet) |
| Checkout: basket | `CheckoutBasketScreen.island` · `BasketDrawer.island` | `/checkout` · `GET api/checkout/session` | `CBS.session` · `live-basket.ts` | basket RPCs · `resolve_promo_code` | ⚠️ | N7, CO8 (no TS blocker) |
| Checkout: details | `CheckoutDetailsScreen.island` | `/checkout/details` · `api/checkout/details` | `CBS` | `buyer_details` | ⚠️ | N11, N26 |
| Checkout: pay from wallet | `CheckoutPaymentScreen.island` · `ConfirmPayDialog` | `/checkout/payment` · `POST api/checkout/create` | `CBS.create` | `place_wallet_order` | ⚠️ | CO4, CO6, CO10, N29 |
| Checkout: pay by card or express | same · `ExpressCheckoutElement` | same | PBS `createCheckoutCardPayment` | `begin_card_payment` → `attach_checkout_order` → **charge** → `attach_card_payment` → webhook → `place_wallet_order` | ❌ | N1, CO8, CO11 |
| Checkout: invoice (on account) | `PaymentChoice` | same | `CBS` → `place_on_account_order(p_amount)` | F1250:474-560 | ❌ | **CO20**, N5, N23, C15 |
| Checkout: ask for approval | `RequestApprovalDialog` · `BusinessSpendGate` | `POST api/checkout/approval` | `fileSpendRequest` | `request_spend_approval` | ✅ | — |
| Checkout: confirmation | `CheckoutConfirmationScreen.island` | `/checkout/confirmation` · `api/checkout/order`, `calendar` | `OrderBackendService` · `live-orders.ts` | `orders` read | ⚠️ | CO13, CO25, R7 (ids unvalidated in the route) |
| Buy Now (single item) | `BuyNowModal.island` | `POST api/checkout/create` | `CBS.create` | `place_wallet_order` | ⚠️ | N9 (Pay not tier 1), N10 (no MoneyView) |
| Session booking (1-1 / cohort) | Buy Now / checkout | as above | `CBS` | `place_wallet_order` → `fn_book_session_slot` / `fn_confirm_seat` | ⚠️ | K3 (no host payout-ready gate) |
| Paid consultation | `ConsultationModal` (profile) | booking API | `BookingBackendService.contact` | `scheduling.request_discovery_call` — **no money door** | ❌ | N2 |
| Product sale (seller side) | — | checkout | `CBS` | `place_wallet_order` → `fn_wallet_credit_pending` at payer's 5% | ❌ | N3, K3 |
| Disputes | Admin desk · dispute dialogs | `api/finance/disputes/*` (`UUID_RE`) | `DisputeBackendService` (unguarded) | F1260 | ⚠️ | R7, N25 |
| Stripe webhooks | — | `api/finance/webhooks/stripe`, `stripe-v2` | `handleStripeWebhook` · `stripe-webhook.ts` | processor doors | ⚠️ | H3, H4 |
| Payout sweep | — | `POST api/finance/cron/payouts` | `payout-sweep.ts` | `fn_*payout*` | ✅ | caller of the cron route unverified |

**MoneyView exclusivity.** `MoneyView` is the rule, but four surfaces print money strings
themselves: `BuyNowModal.island.tsx:380-618` (nine raw `.display` figures), `FundStageDialog`
(via `stage-funding.ts:48-50` `formatMoney`), `WalletDialogs.tsx:280` (the review figure, the
headline, the done step) and the line detail's "Original" (`:1193-1194`). Button labels are strings
by nature (`ConfirmPayDialog.tsx:79`, `PaymentChoice.tsx:210`), and they print the display
*estimate*, not the exact charge (N29). Even MoneyView's same-currency branch renders the server's
en-GB string (C12). See N10.

**Client-side money maths.** None is authoritative. Every case is a preview or validation that the
server re-checks: amount parsing (`WalletDialogs.tsx:279`, through the 6-code exponent list — C10),
a balance check (`:309`), the smoother fee preview (`:926`), "wallet covers" (`stage-funding.ts:43`),
meter widths (`AllocationMeter.tsx:223-233`), the chart peak, the spend-limit comparison
(`business-gate.ts:97`). No island rounds a figure that is then sent as authoritative. **Server-side
TS** does compute three figures it then presents as fact: the Standing "commission paid" (N19), the
smoother projection (N20), and "wallet covers" summed across currencies (N7).

---

## 4. Ledger integrity — the migrated single-entry model vs the planned double-entry model

### 4.1 How money moves today

```text
Card ─► Stripe platform balance (Separate Charges & Transfers; no transfer_data)
          │
          ▼ webhook payment_intent.succeeded → settle_card_payment
     payer wallet  +topup (Available at once)
          │ escrow_hold  (fn_wallet_debit; payer balance falls)
          ▼
     finance.escrows row  status='held'          ← the money exists ONLY as this row
          │ release (approval · negative consent · fair exit · dispute split)
          ▼
     finance.pending_releases  amount + bonus − fee   (no ledger line yet)
          │ fn_mature_pending_releases after pending_release_days (7)
          ▼
     payee wallet  +escrow_release (Available)
          │ begin_payout  (debit) → Stripe Transfer → connected account → bank
          ▼
     fee: recorded on escrows.platform_fee_cents · credited NOWHERE
```

- **Balances.** `wallets.balance_cents` is a cache of Available, written only by
  `fn_wallet_credit` / `fn_wallet_debit` beside a `transactions` row carrying `balance_after_cents`
  (F1200:10-56). Locked, Pending and On hold are projections from `escrows` and `pending_releases`
  (`svc/live-wallet.ts:256-265`).
- **`transactions.reason`** is free text with no enum or CHECK (T17:43-80), and
  **`transactions.fund_state` is never written**: every row, `escrow_hold` included, reads
  `available` (N13, against the T17:56-65 comment).

### 4.2 Credit paths

| Through the 7-day pending window | Available at once |
| :-- | :-- |
| `escrow_release` (ticket, seat, session sitting, dispute split) · `fair_exit_release` · `team_split` · `team_finder_fee` · `*_vault_retention` · `product_sale` | `topup` (F1230:810) · `escrow_refund` · `fair_exit_refund` · `transfer_in` (F1210:1992) · `team_distribution` (F1210:2113) · `payout_reversal` (F1240:478, :587) · `on_account_credit` (F1250:550) |

A `pending_release_days` of 0 credits immediately and writes no pending row (F1240:1544-1547). The
withdrawal earnings gate keys on the *existence* of pending rows (F1210:110-118, F1240:329-334), so
a 0-day credit, a `team_distribution` or a `transfer_in` into a personal wallet skips the #196
check (N14). A verified Stripe destination is still required, which limits the exposure.

### 4.3 Planned vs migrated

| Concept (FM §6 / §7) | Planned | Migrated | Gap |
| :-- | :-- | :-- | :-- |
| Balance | Derived from postings ("a projection, not a stored total") | Materialised cache + `balance_after_cents` | The cache can drift. Nightly reconciliation detects drift, and nobody reads it (L5). |
| Escrow Pool | Hidden system wallet | A `finance.escrows` row. The payer is debited, and nothing is credited. | Held value is not a balance. Conservation cannot be checked by summing accounts. |
| Fee Collection Account | Hidden wallet receiving the 5% and commissions | A column on `escrows` / `orders` | Revenue is unreconciled to Stripe. "Fee" in FM §7's worked example (£50) lands nowhere (S5). |
| Dispute Lockbox | Hidden wallet; `on_hold` state | `escrows.status='disputed'`; `on_hold` never written | Pending money is not frozen (W3) |
| Receivables | — | `on_account_credit` mints Available balance before any cash arrives | A receivable posted as cash. This is exactly why CO20 is exploitable: no counter-entry exposes the surplus. |
| Bonus | Funded by the client | Paid at release; funded by nothing | Latent money creation (N4) |
| Processor fees and chargeback losses | Passed through / platform loss | `chargebacks.unrecovered_cents` only | No loss account; Stripe fees unmodelled |
| FX snapshot | `fx_rate`/`fx_base`/`fx_as_of` at commit | Columns exist; no writer | C7 |
| External reconciliation | Stripe balance vs escrow pool (SA:3148) | Not built | L6 |

### 4.4 What the single-entry model hides

Each defect below would show up as an imbalance in a double-entry trial balance, and none is caught
today:

- **CO20**: credit without cash.
- **N4**: release of an unfunded bonus.
- **S5**: fee retained but unbooked.
- **N13**: `fund_state` wrong on every row.
- **W4**: a chargeback loss absorbed off-ledger.

A per-currency **conservation identity** is computable from existing tables without changing any
writer:

```text
Σ settled inbound payments + Σ on-account credit − Σ completed payouts (net of reversals)
  − Σ chargeback recoveries
  ≟ Σ wallets.balance_cents + Σ escrows(held|disputed).amount_cents
    + Σ pending_releases(pending).(amount − recovered) + Σ platform fees retained
    − Σ deadline bonuses released + Σ unrecovered chargebacks
```

The recommended staging (identity view now, a shadow journal before scale, no big-bang rewrite) is
Decision **D-5** in the companion doc.

---

## 5. Status delta vs `FINANCE_AUDIT.md` (2026-10-17)

| Change | IDs |
| :-- | :-- |
| **Fixed / superseded** | D6 (solid selection, `wallet-accounts.css:218-220`) · D11 (reduced motion mirrored in all 8 wallet sheets) · D16 (CSV moved to an icon ghost by #331) · D18 / D28 (ruled at DESIGN_SYSTEM:1418-1420, 1470-1473; code matches) |
| **Changed, still open** | A16 (per-ref expiry on request; no sweep) · CO18 (seats and 1-1 sessions now team-aware via `fn_is_session_host`; digital products still `owner_team_id IS NULL` only, F1210:1584) · K2 (ownership-transfer door added, `00001020:3050`) · K3 (**refuted for blueprints**, which bind no seller; confirmed for sessions, seats and products) · K4 (enterprise refused at `place_wallet_order` only) · W4 (payer's pending money recovered first; payee never) · CO30 (fee totals tested; `create` / promo / replay untested) · M5, D26, D30, CO26 (partial) |
| **Still open — DB** | L4 (deliberate) · L5 · L6 · L7 · L8 · L9 (now three release paths skip it: F1200:716, :935, S1155:854) · W3 · E3 · S4 · S5 · H3 · H4 · A2 · A3 · A4 · A6 · **A12** · A13 · A14 · A19 · V2 · V4 · C5 · C7 · C10 · C14 · C15 · CO4 · CO6 · CO7 · CO10 · CO13 · **CO20** · CO25 |
| **Still open — services** | S2 · R3 · R5 · R7 (wider: 8 routes on `UUID_RE`; checkout `order`/`line` unvalidated in the route) · A7 · C6 · C8 · C9 · C12 · C13 · C17 · CO8 · CO11 · CO17 · CO29 · R10 · V6 |
| **Still open — UI** | R11 · R12 · R13 · M2 · M4 · D1–D5 · D7–D10 · D12–D15 · D17 · D19–D22 · D24 · D25 · D27 · D29 |
| **Unverified** | D23 (duplicate declarations) · Z1–Z6 (Zod/doc drift — not re-checked this pass) |

---

## 6. New findings

Severity: **P0** security, money correctness or a dead money promise · **P1** functional gap or
gate drift · **P2** tidy or latent.

| ID | Sev | Finding | Evidence | Fix (file to edit) |
| :-- | :-- | :-- | :-- | :-- |
| N1 | P0 | A saved-card PaymentIntent is charged (`confirm:true`) before `attach_card_payment` binds it. `settle_card_payment` matches on `provider_ref` only. A failed bind with no browser retry leaves a charge Stripe keeps redelivering as `unmatched` until it gives up. The comment at PBS:366-368 ("cannot be charged without its client secret") is wrong for this path. | PBS:340-371 · `stripe-rails.ts:130-143` · F1230:708-716 | `settle_card_payment`: when no row matches `provider_ref`, bind by `metadata.projective_payment_id` to an unbound row of the same amount and currency, then settle. Add a sweep for `requires_payment` rows with a succeeded intent. |
| N2 | P0 | Paid consultations are bookable, and born `confirmed` when `auto_confirm` is on, with no payment, no escrow and no payout-ready check on the host. `payment_ref` and `escrow_id` have no writer. | F1520:121-265 · `00000022:427-468` · `ConsultationModal.tsx:418-427` | Interim: refuse `p_call_type='paid'` (`paid_unavailable`) and hide the paid card. Then the money path of `SCHEDULING_DECISIONS_AND_GAPS.md` D1 (Option C). → D-2 |
| N3 | P0 | Marketplace commission is never charged. `fn_effective_commission_bp` (seller Standing taper, 8% → 6.5%) has no caller. Product sales use the **payer's** `fn_effective_platform_fee_bp` (5%). | F1220:211-231 · F1210:1699, :1809 · `00005030:174-180` | After ruling D-3: `place_wallet_order` reads the seller's commission for `product_sale` lines |
| N4 | P1 (latent) | A deadline bonus is paid at release (`amount + deadline_bonus_cents − fee`) but nothing debits it from the payer. Only the seed writes the column (as 0). | F1200:744 · `grep deadline_bonus_cents` | Until D-11: CHECK `deadline_bonus_cents = 0`, or hold the bonus with the escrow |
| N5 | P1 | The on-account limit can be exceeded under concurrency: the owed check locks only the current basket. | F1250:509, :540-545 | Advisory lock per `(business, currency)` around the owed check |
| N6 | P1 | `fn_ticket_escrow_sync` fires AFTER **UPDATE** only. A project owner may INSERT a ticket already assigned and in work, skipping both the escrow gate and `fn_assign_ticket_core`'s payout-ready check. | `00001850:41-44` · `00001110:272-278` · `00002011:355-375` | BEFORE INSERT guard: a new ticket is born unassigned in a pre-work status, or goes through the same checks |
| N7 | P1 | "Wallet covers" and the wallet-provider offer sum every wallet the owner has, converted to the display currency. `place_wallet_order` debits only the charge-currency wallet (`PF402` "Your wallet holds no %"). | `commerce-owner.ts:324-343` · CBS:371, :425, :528 · F1210:1676 | Read the charge-currency wallet only |
| N8 | P1 | Funding a stage from the wallet compares the quote in TS, then calls `fund_stage` with no expected amount. A re-price in between is held at the new figure. The card path asserts it in the database. | `wallet-actions.ts:383-407` · `00001150:788` · PBS:432 | `fund_stage(p_expected_minor)`; raise on mismatch |
| N9 | P1 | Buy Now's **Pay** is `<Button fluid rounded>` with the default primary severity (tier 3), not tier-1 accent, and is absent from `checkout-commit-tier.test.ts`. | `BuyNowModal.island.tsx:623-631` · `checkout-commit-tier.test.ts:30-41` | `severity="accent"`; add to `COMMITS` |
| N10 | P1 | Money rendered without MoneyView: Buy Now (nine figures), FundStageDialog, the WalletDialogs review/headline/done figure, and the line detail's "Original". No re-projection and no origin disclosure. | `BuyNowModal.island.tsx:380-618` · `stage-funding.ts:48-50` · `WalletDialogs.tsx:280, 676-711, 1193-1194` | `MoneyView` / `Amount` with origin |
| N11 | P1 | The stepper's completed **Details** anchor omits `?edit=1`, so from Payment it 302s straight back. The control does nothing (gate §3.11), and `details.tsx:30-31` claims it carries the flag. | `CheckoutStepper.tsx:97-105` · `basket-model.ts:101-118` · `details.tsx:52-62` | Pass `edit` for the details step |
| N12 | P1 | No finance service maps `payout_not_ready`. Checkout maps every `PK403` to `verification_required`, so the seller-side readiness refusal reads as the buyer's own. | `checkout-refusal.ts:33` · `core/payout-gate.ts:32-60` | Reuse `payoutNotReadyRefusal` |
| N13 | P2 | `transactions.fund_state` is never written; every row reads `available` | F1200:29-30, :53-54 vs T17:56-65 | Write it from the primitives, or drop the claim from the comment and `Tables.md` |
| N14 | P2 | The withdrawal earnings gate keys on pending-row existence, so 0-day credits, distributions and transfers in skip #196 | F1210:110-118 · F1240:329-334 | Key on the wallet's owner kind and earnings history |
| N15 | P1 · doc | The wallet lane's **Top up** is `LaneCreateButton` (tier 2), yet it starts a financial flow (tier-1 test, DESIGN_SYSTEM:1418). F.3 (:5856-5859) still describes the pre-#331 hero pills. | `WalletLane.island.tsx:274-280` | Ruling → companion X18 |
| N16 | P1 · spec | A held ticket escrow has no timeout. The FM §8 14-day ghosting auto-approve is unbuilt, so a client who never reviews creates the "permanent, un-releasable escrow" the guarantee promises against. | No auto-approve job in `00005060` or any function | → D-9 |
| N17 | P2 | `setPayout` writes against `account.rows[0]`, an unordered pick, so for a multi-currency account the schedule lands on an arbitrary currency | `wallet-actions.ts:441-455` | Take `currency` from the action |
| N18 | P2 · doc | The charge's `transfer_group` never links to the payout Transfer (`projective_payout_<id>`), although SA:3120 says payouts are grouped by it | `stripe-rails.ts:85-86, 371-373, 387` | Correct SA, or carry the group (a payout aggregates many charges, so correct SA) |
| N19 | P2 | Standing "commission paid / at next level" is computed in TS from net credit volume with `Math.round` (not truncation, #187), and drops unconvertible currencies | `wallet-standing.ts:128-153` | Read recorded fees from the ledger |
| N20 | P2 | Smoother projection uses float maths and a hard-coded `fee_bp ?? 50` | `live-wallet.ts:436, 447` | Integer maths; read the param |
| N21 | P2 | The Upcoming forecast hard-codes `SAFETY_WINDOW_DAYS = 7` | `live-wallet.ts:1184, 1372` | Read `pending_release_days` |
| N22 | P2 (latent) | The pending read filters `state='pending'`. Once W3 writes `on_hold`, that money leaves all four buckets. | `live-wallet.ts:262` | Read `pending` and `on_hold`; show On hold |
| N23 | P2 | On-account headroom is shown in the display currency; the database limits in the listing currency | CBS:426, :452 · F1250:542 | Read in the charge currency |
| N24 | P2 | No CHECK on `escrows.status` (text, `DEFAULT 'funded'`, a value no code writes), `wallets.owner_type` or `transactions.reason`, although uniques key on the literal `'held'` | T17:16, :43-80, :118 | CHECKs, or enums, edited in place |
| N25 | P2 | `DisputeBackendService` methods lack the `guarded`/`read`/`write` try/catch its siblings use (whether any path throws is unverified) | `DisputeBackendService.ts:56-159` | Wrap |
| N26 | P2 | The Payment step's backward 302 rebuilds the URL without `display` and the `sim*` dev axes that `details.tsx:33-36` says must survive | `payment.tsx:42-51` · `basket-model.ts:101-118` | Carry the search string, as Details does |
| N27 | P2 · doc | Checkout honours `?display=` (`basket-model.ts:302`), which `ROUTING.md:525-532` does not list | — | Add to ROUTING |
| N28 | P1 | Checkout design gates: translucent zebra rows (`checkout-confirmation.css:236, 612`); text opacity 0.82 / 0.72 (`checkout-body.css:509`; `basket-body.css:765-767`); non-actionable kind labels as bordered pills (`basket-body.css:968-975`, gate 7); a boxed static `.cko-contract` banner (`checkout-payment.css:119-128`, gate 6); literal `scale(0.99)` press (`checkout-payment.css:330`, gate 12); a reduced-motion rule present only under the media query (`basket-body.css:2151-2153`) | as cited | Solid ramp tones · full ink · inline meta · token press · mirrored `[data-motion]` rule |
| N29 | P2 | The Pay label and the confirm dialog name `totals.total.display`, which the rail itself calls an estimate when converted. The exact charge appears only in the rail. MoneyView's spoken rate is hard-coded `en-GB`. | `ConfirmPayDialog.tsx:79` · `OrderSummaryRail.tsx:329` · `MoneyView.tsx:103` | Name the charged amount; viewer locale |
| N30 | T | Stale comments: "silent no-op on a missing wallet" (F1200:368, F1210:1822; they raise `PW404`); ConfirmPayDialog "warning" (:18-21); PBS:366-368 | — | Factual edits |
| N31 | doc | Root `CLAUDE.md` (persona §2 row 3) says the fee is "5% base … adjusted by Standing". FM §16.4 and F1220:229-231 say the fee never tapers; only the commission does. | — | Companion X4 (a guardrail file: human edit) |
| N32 | P2 | A locked lane Top up is announced simply as "Top up" (#331 flag (d)) | `WalletLane.island.tsx:274-280` | Accessible name carries the lock reason |
| N33 | T | Personal "spent this month" converts each row, then sums, contradicting the module's own sum-then-convert rule | `live-wallet.ts:478-481` vs :857-861 | Sum, then convert |
| N34 | P2 | `checkout/calendar.ts:33-40` and `order.ts:31` pass `order`/`line` unvalidated (a regex in `live-orders.ts:502`); the two payment routes are inconsistent (`UUID_RE` vs Zod `uuid`) | as cited | Zod at the edge (R7) |

---

## 7. Prioritised backlog

Order inside a priority: security, then money correctness, then honesty of a control, then design.
Database edits are made in place, in the file named.

| Pri | Item | Files |
| :-- | :-- | :-- |
| ~~P0~~ ✅ | ~~**CO20**: assert `p_amount` = the order's charge~~ (fixed 2026-10-29). ~~Lock per business · currency (N5)~~ (fixed 2026-10-30) | F1250 |
| ~~P0~~ ✅ | ~~**A12**: `deposit_rules` SELECT-only for clients~~ (fixed 2026-10-29). ~~`wallet_pots` SELECT-only (A4); `update_deposit_rule` door (A13)~~ (fixed 2026-10-30; the A13 UI is still open) | P2013 · F1240 · G2520 |
| ~~P0~~ ✅ | ~~**N1**: bind-by-metadata in `settle_card_payment`; recovery sweep~~ (fixed 2026-10-30; register the `cron/card-payments` job in `00005060`) | F1230 · PBS · `stripe-webhook.ts` |
| **P0** | **N2**: refuse paid calls until the money path lands | F1520 · `ConsultationModal.tsx` |
| **P0** | **CO6** promo `FOR UPDATE` + guarded increment; **CO8** `promo_not_applicable` blocker before any charge; **CO4** `p_expected_minor` | F1210 · CBS · `live-basket.ts` |
| **P0** | **C13** / **N7**: never drop a currency; "wallet covers" in the charge currency | `wallet-scope.ts` · `live-wallet.ts` · `commerce-owner.ts` |
| **P0** | **V6** `decidable` from the server; **R5** 303 to the resolved `w` | `live-wallet.ts` · `WalletHome.island.tsx` · `wallet-scope.ts` |
| P0 (after D-3) | **N3** commission on product sales | F1210 · F1220 · `packages/types/finance/fee.ts` |
| P1 | H3/H4 webhook coverage (`charge.refunded`, `dispute.updated`, `funds_*`, `payout.canceled`; out-of-order close) | `payments.ts` · `stripe-webhook.ts` · F1230/F1240 |
| P1 | K3 / N12 / N14 payout-ready at listing publish and session booking (after D-7); K4 enterprise KYB | S1155 · F1210 · F1240 · catalogue publish doors |
| P1 | N6 ticket INSERT guard · N8 `fund_stage` amount assert · N4 bonus CHECK | `00001110` · `00001150` · T17 |
| P1 | A14 payout-schedule runner (or lock the control) · A6/A7 smoother (lock enrolment until spec'd) · A2/A3 pots engine | F1240 · `00005060` · `wallet-actions.ts` · `live-wallet.ts` |
| P1 | W3/W4 dispute freeze and clawback (after D-6) · L9 open-dispute predicate on every release · E3 thaw conflict | F1230 · F1240 · F1200 · S1155 |
| P1 | R10 statement PDFs · N9 Buy Now tier · N10 MoneyView sweep · N11 stepper `?edit=1` · N15 (after ruling) | `InvoicesPanel.tsx` · `BuyNowModal.island.tsx` · `CheckoutStepper.tsx` · `WalletDialogs.tsx` |
| P1 | C5/C6 FX feed or staleness disclosure · C7 snapshot · C10 one exponent SSOT · C15 per-currency thresholds | `00005060` · `FxService.ts` · `wallet.ts` · `currency-store.ts` · `00005001` |
| P1 | D1/D2 wallet hero high contrast and static-gradient clamp · N28 checkout gates · D7 · D8 · D29 | `wlt/styles/*` · `cko/styles/*` |
| P1 (after D-5) | Conservation identity view + nightly check; ops reader for L5 | `00003004` · `00005060` · `WalletBackendService` |
| P2 | S4 raise instead of 0 · L8 key sweep · V2 owner triggers · N13 · N17–N27 · N29–N34 · R3 Zod page query · R13 / CO29 dev axes (`walletVerification`, `walletProcessor`, card outcome) | as cited |
| P2 | Docs sweep after the rulings (companion §3) | `finance-model.md` · `PRODUCT_SPEC.md` · SA · `database/finance/*` · `database/scheduling/*` · DESIGN_SYSTEM F.3 |
