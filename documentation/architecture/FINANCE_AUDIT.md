# Finance Engine, Stripe Rails, Currency, Checkout & `/wallet` Audit (2026-10-17)

> Read-only evaluation of the finance subsystem (`finance.*` schema, `packages/backend/services/finance/`,
> `packages/types/finance/`), the Stripe integration layer, multi-currency and FX handling (§1.12),
> the checkout pipeline from basket to fulfilment (§1.13), and the four `/wallet` pages against
> `PRODUCT_SPEC.md`, `finance-model.md`, `SYSTEM_ARCHITECTURE.md`, `ROUTING.md`, `DESIGN_SYSTEM.md` and
> the decision log. No code was changed by this audit. The new contradictions it found are proposed
> as **Decision #251** (§4.6). Prompt F0 in [`FINANCE_BUILD_PROMPTS.md`](FINANCE_BUILD_PROMPTS.md)
> records that decision before any other prompt runs. The number was the next free one on every local
> branch on 2026-10-17. #245–#249 are absent from `main` and may be held by peers, so F0 re-checks
> the number.
>
> Abbreviations: **T17** = `supabase/migrations/00000017_tables_finance.sql` · **F1200** =
> `…/00001200_functions_finance_core.sql` · **F1210** = `…/00001210_functions_finance_kyc_wallet.sql` ·
> **F1230** = `…/00001230_functions_finance_stripe.sql` · **F1240** =
> `…/00001240_functions_finance_money_movement.sql` · **F1250** = `…/00001250_functions_finance_auto_fund_billing.sql` ·
> **F1260** = `…/00001260_functions_finance_disputes.sql` · **P2013** = `…/00002013_policies_finance.sql` ·
> **svc/** = `packages/backend/services/finance/` · **wlt/** = `apps/web/features/wallet/` ·
> **SA** = `SYSTEM_ARCHITECTURE.md`.

## 0. Premise corrections

The commissioning brief carried several assumptions that the code or the guardrails contradict.
They are corrected here so that the plan does not re-open settled ground.

| Brief assumed | Actual (source) |
| :-- | :-- |
| Migrations should be "additive-only" new numbered files | **Forbidden.** Root `CLAUDE.md` §1 says migrations are consolidated and **edited in place**, with each statement in its category file. Every fix below names the existing file to edit. Additive `ALTER` patches are a merge-gate failure. |
| `?flow=` drives the wallet modals | `?flow=` is the cash-flow/ledger **time window** (`7d·1m·3m·6m·1y·5y·all`; `wallet-model.ts:237-245`). The action intent is **`?do=<action>`** with `?back=` (`wallet-intent.ts:45-77`, Decision #243, `ROUTING.md:228-239`). |
| `finance.fn_hold_ticket_escrow` / `projects.fund_stage` are "un-wired gating predicates" | Both exist and are wired. `fn_hold_ticket_escrow` (F1200:370) raises PF402 and is backed by `uq_escrows_ticket_base_held`. `projects.fund_stage` is the stage-funding door (`00001150…:707-740`). The only gate that is defined but not called everywhere it claims to be is `fn_escrow_has_open_dispute` (L9). |
| Wallet charts are "D3-driven" | The tiered chart engine of Decision #1 applies. `FlowAreaChart` delegates to the `@projective/ui` `AreaChart` (which uses `d3-scale`/`d3-shape` inside `packages/ui/display/charts/`). `CashFlow` is hand-rolled SVG. Feature code imports no D3. |
| Inline charts/tables enlarge into modals and then hand off to `/inspect/[fileId]` | No enlarge pattern exists in the wallet. `/inspect/[fileId]` (`routes/(standalone)/inspect/`) serves `files.items` only. Wallet PDFs are direct `attachment` downloads. Whether to add an enlarge pattern is a design question, not a defect (§4.4). |
| Level-3 KYB gates "pooled wallets" | KYB gates **business** wallets only (F1210:205-212, F1240:335). Team vaults are gated by every shareholder's KYC (`fn_assert_payout_ready`, F1210:63). **Enterprise** wallets have no KYB gate at all (K4). |
| `platform_fee_bp = 500` is a constant | It is a parameter: `security.platform_params.platform_fee_bp` (`00005001:30`), resolved by `fn_effective_platform_fee_bp` (`00001220:234`). The TS `PLATFORM_FEE_BP` is a display fallback only. |

---

## 1. Functional Audit Matrix

Legend: ✅ compliant · ⚠️ partial / drift · ❌ missing · 📄 doc conflict

### 1.1 Ledger invariants

| # | Capability | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| L1 | Single-entry running balance, never negative | #186, SA §1 | `fn_wallet_credit`/`fn_wallet_debit` use `UPDATE … RETURNING` (row lock), then INSERT the ledger row with `balance_after_cents` (F1200:10-56). `CHECK (balance_cents >= 0)` (T17:19). A missing wallet raises PW404. | ✅ |
| L2 | Primitives callable only by definers / service role | #186 | Revoked from PUBLIC, anon and authenticated, including default privileges (`00002510:907-944`) | ✅ |
| L3 | Ledger append-only | #186 | `fn_transactions_append_only` raises PL403 (F1200:1039; trigger `00001830:95`) | ✅ |
| L4 | No write bypasses the primitives | — | The only direct `UPDATE finance.wallets SET balance_cents` is in `simulate_wallet_transaction` (F1210:693, :726). It writes a matching ledger row plus `ledger_audit`, and is dev-only by grant (`00002510:918`). | ⚠️ deliberate; keep it documented |
| L5 | Nightly reconciliation | SA §1 | `v_wallet_reconciliation` (`00003004:4-15`) and `fn_reconcile_wallets` (F1200:1057) run at 03:40 (`00005060:47`) and write `ops.log_entries`. **Nothing reads those rows:** no alert and no admin view (#186 flag b). | ⚠️ |
| L6 | Stripe balance vs internal escrow pool reconciliation | SA:2801 | Not found (grepped `balance.retrieve`/`balance.list`) | ❌ / 📄 |
| L7 | Pots inside reconciliation | — | `v_wallet_reconciliation` ignores `wallet_pots`. Today pot balances can never be non-zero (P3), so nothing is lost yet. | ⚠️ latent |
| L8 | `idempotency_keys` retention | SA:2610 | `expires_at` is informational only. No sweep deletes expired rows. | ⚠️ T |
| L9 | Open-dispute predicate on every release | #212 | `fn_escrow_has_open_dispute` (F1260:41) says "every release path asks", but only the session paths call it (`00001155:1451,1595,1621`). `fn_release_ticket_escrow` and `fn_fair_exit_release` skip it. This is harmless while disputes are seat-only. | ⚠️ |

### 1.2 Seven-day safety window (#191)

| # | Check | Implementation | Status |
| :-- | :-- | :-- | :-- |
| W1 | One writer for pending credit | `fn_wallet_credit_pending` (F1240:1502) serves ticket release, team split, fair exit, seat release, dispute split and product sale | ✅ |
| W2 | Idempotent maturation | `fn_mature_pending_releases` (F1240:1585) uses `FOR UPDATE SKIP LOCKED` and a state flip; pg_cron runs it hourly at :05 (`00005060:50`) | ✅ |
| W3 | Freeze pending money on dispute (`fund_state = on_hold`) | The enum value exists (`00000004:39`) but nothing writes it. `record_dispute_opened` freezes only `held` escrows (F1230:1546-1551). | ❌ (the docs admit it; `finance-model.md:241`) |
| W4 | Clawback from the payee's pending row | A lost chargeback recovers only from the **payer's** wallet (F1240:139-150). The payee's pending credit from that escrow matures untouched. | ⚠️ #126 / #191(B3) still open |

### 1.3 Escrow

| # | Check | Implementation | Status |
| :-- | :-- | :-- | :-- |
| E1 | One held base escrow per ticket | `uq_escrows_ticket_base_held` (`00004005:14`), plus `uq_escrows_revision` and `uq_escrows_session_event` | ✅ |
| E2 | Release/refund lock order | Ticket first, then each escrow; status flips only `WHERE status='held'` (F1200:716-779, 1001-1033) | ✅ |
| E3 | Dispute thaw `disputed → held` | It can collide with a newer held escrow on `uq_escrows_ticket_base_held` (F1240:97-101). The webhook would then 5xx forever. | ⚠️ edge |
| E4 | Stage funding | `projects.fund_stage` is the definition of record for holds and card charges (`00001150:707-740`) | ✅ |

### 1.4 Stripe Connect & fee

| # | Check | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| S1 | Separate Charges & Transfers | #125, SA:2769 | The PaymentIntent has no `transfer_data`, `on_behalf_of` or `application_fee`, and carries `transfer_group: projective_payment_<id>` (`svc/stripe-rails.ts:88-103`) | ✅ |
| S2 | Transfer at payout, idempotent | SA:2772 | `createTransfer` on withdrawal (`stripe-rails.ts:387-400`), with group `projective_payout_<id>` and an idempotency key. `source_transaction` is never set, so transfers draw on the platform's available balance. | ✅ / ⚠️ |
| S3 | Accounts v2 Express | #125 | `stripe.v2.core.accounts.create` and `accountLinks` (`stripe-rails.ts:226,284`). The `stripe_transfers` capability is read at :203. | ✅ |
| S4 | 5% fee, single source | #2, #187 | `platform_fee_bp=500` (`00005001:30`) → `fn_effective_platform_fee_bp`, which **falls back silently to 0** when the param is missing → `fn_escrow_fee_bp` (F1200:691). Floor everywhere. | ✅ / ⚠️ silent 0 |
| S5 | Fee Collection wallet | `finance-model.md:203,260` | Not built. The fee lives only in `escrows.platform_fee_cents`. | 📄 #54(i), #187(b) |

### 1.5 KYC / KYB

| # | Check | Implementation | Status |
| :-- | :-- | :-- | :-- |
| K1 | `fn_freelancer_payout_ready` | `kyc_status='verified' AND payout_ready` (F1210:17-29). The team variant checks every shareholder (:63). | ✅ |
| K2 | Called on the #196 doors | org `00001020:1129,1771,2320`; stages `00001130:928,984,1090,1500,2182`; membership `00001135:650`; assignment `00001140:376,414`; `begin_payout` F1240:323-333 | ✅ |
| K3 | "Cannot take paid work before payout-ready" | `PRODUCT_SPEC.md:1386` vs #196's door list | **Not gated:** session hosting and booking (`00001155`), product sales credited in `place_wallet_order` (F1210:1818), service blueprint instantiation. Earnings pile up in a wallet that cannot withdraw. | 📄 → #251 (e) |
| K4 | KYB for enterprise wallets | `PRODUCT_SPEC.md:1396` | `fn_assert_business_spend` returns early for anything that is not `business` (F1210:205); `begin_payout` checks only `business` (F1240:335) | ❌ |

### 1.6 Webhooks & idempotency

| # | Check | Implementation | Status |
| :-- | :-- | :-- | :-- |
| H1 | Signature verification | `constructEventAsync`, 300 s tolerance, platform or Connect secret (`core/stripe.ts:238-271`). v2 uses `parseEventNotificationAsync` (`PaymentBackendService.ts:1136`). Raw body. | ✅ |
| H2 | Claim in the same transaction as the effect | Every SQL processor door calls `fn_claim_stripe_event('stripe:<evt>')` in its body (F1230:39-62). `fn_release_stripe_event` handles un-ledgered settlement (#200). `account.updated`, thin events and `setup_intent.succeeded` are idempotent by value. | ✅ |
| H3 | Event coverage | 15 snapshot and 2 thin events are handled (`packages/types/finance/payments.ts:686-722`). **Missing:** `charge.refunded` (a refund made in the Dashboard is never ledgered), `charge.dispute.updated` (`under_review` is never set), `charge.dispute.funds_withdrawn` / `funds_reinstated`, `payout.canceled`, `transfer.updated`, `identity.verification_session.processing`, `v2.core.account[requirements].updated`. | ⚠️ |
| H4 | Out-of-order delivery | `charge.dispute.closed` before `.created` completes as `unmatched` (F1240:72-75). The late `.created` then freezes escrows that nothing will thaw. | ❌ |
| H5 | Livemode / key guard | A mode mismatch returns "ignored" (`PaymentBackendService.ts:1097`); a live key outside production is refused at boot (`assertStripeKeyAllowed`) | ✅ |
| H6 | Env placeholders | `.env.example:214-218` uses `XXXX-XXXX`; no key-shaped strings are tracked | ✅ |

### 1.7 Sub-ledgers & automation

| # | Capability | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| A1 | `wallet_pots` table (tax/savings/goal, `auto_allocate_bp` 0–10000) | `finance-model.md` §13 | T17:459-468; Zod `packages/types/finance/methods.ts:111-131` | ✅ |
| A2 | **Auto-allocation on inbound payout** | §13 "auto-skims % of each inbound payout" | **Nothing does it.** No function references `wallet_pots` (only the table, triggers, policies, grants and indexes do). The seeded `tax_pot_default_bp` (`00005001:60`) is never read. | ❌ |
| A3 | Pot movements (allocate, release to main) and the per-wallet bp cap ≤ 10000 | §13 | No RPC exists. `balance_cents` is guarded (`trg_wallet_pots_derived`), so it is always 0. There is no total-bp cap. | ❌ |
| A4 | Pot write authority | `Policies.md:102` | RLS is `FOR ALL` on `fn_can_move_wallet_funds` (P2013:83), so a spend-only vault member can create pots and set skim rates. There is no pot UI, and the read takes the first `tax` pot unordered across currencies (`svc/live-wallet.ts:503-527`). | ⚠️ |
| A5 | Income smoother enrolment | §13 | `finance.set_income_smoother` (F1240:1325-1395) with server-side eligibility; read-only RLS | ✅ |
| A6 | **Income smoother disbursement and fee** | §1.4/§13 | Not built (`database/finance/Functions.md:1458`). Nothing has a PRODUCT_SPEC entry (`MVP_FLOW_AUDIT.md:312`). Users can enrol in a product that does nothing. | ❌ 📄 |
| A7 | Smoother read with two currencies | — | `.eq(user_id).maybeSingle()` on a row unique per `(user_id, currency)` (`live-wallet.ts:498-501, :1602-1605`). A second currency makes the Overview read throw. | ❌ bug |
| A8 | Monthly consolidated invoicing | §15, #168/#172 | `fn_run_billing_cycle` (F1250:696), cron at 02:20; `fn_generate_consolidated_invoice` (F1200:781) is idempotent on `uq_invoices_business_period_currency`; gated on `manage_billing` + `intervaled_invoicing` | ✅ |
| A9 | Invoice tax | §15 | `v_tax := 0` is hard-coded (F1200:~788) | ⚠️ known |
| A10 | Downgrade from Business Pro | #230(e) | The cycle selects `intervaled_monthly` without re-checking the entitlement | ⚠️ |
| A11 | Recurring deposits create and run | #126/#203/#215 | `create_deposit_rule` (F1240:977) needs `add_funds`; `fn_deposit_charge_target` re-checks the author's `add_funds` and card ownership at run time. The cron route uses a constant-time bearer and answers 404 otherwise. | ✅ |
| A12 | **Recurring rule RLS vs door** | `Policies.md:99` | RLS is `FOR ALL` on `spend` (P2013:59-61) while the door needs `add_funds`. Only `failure_count/last_error/created_by` are guarded (`00001830:46`). **A spend-only member can raise `amount_cents` on a rule another member authorised against their own card, and the run charges that card.** `wallet_id` is mutable too. | ❌ **security** |
| A13 | Pause / edit / cancel a recurring rule | gate §3.11 | No action exists (`packages/types/finance/wallet.ts:1338-1348`). The UI shows "Paused" (`wlt/core/wallet-home.ts:297`) with no control. | ❌ |
| A14 | **Payout schedules execute** (`scheduled_weekly/monthly/threshold`) | §13 | Nothing reads `payout_schedules` except the wallet read and `wallet-actions.ts:431`. The setting saves and never runs, so the control does nothing (§3.11). | ❌ |
| A15 | Spend approvals bind and redeem once | §14, #239 | `request_spend_approval` (F1210:2788) / `decide_spend_approval` (:2139, `approve_spend`, no self-approval) / `fn_redeem_spend_approval` (:2219) | ✅ |
| A16 | Approval expiry (7 days) | §14 | Rows expire only when someone tries to decide them. No sweep, so stale `pending` rows block "one open per ref". | ⚠️ |
| A17 | Team split plan, dust to vault | §5, #228(F) | `fn_team_split_plan` (F1200:106) and `fn_split_team_payout` (:176) through the pending window | ✅ |
| A18 | Split-rule writer | #234 | `finance.save_split_rule` (F1210:2365), one active rule (`uq_split_rules_team_active`) | ✅ |
| A19 | Split enforcement at payout time | #234 "always enforced" | The plan re-checks neither the entitlement (a downgraded team keeps its Pro template) nor the finder's membership (a departed finder is still paid) | ⚠️ needs ruling → #251 (f) |

### 1.8 Vault permissions & actions

| # | Check | Implementation | Status |
| :-- | :-- | :-- | :-- |
| V1 | Projection from workspace capabilities | `org.fn_vault_capabilities_for` / `fn_sync_vault_permissions` (`00001020:668-738`); `fn_has_vault_capability` also requires a current seat (F1210:369) | ✅ |
| V2 | Backstop triggers | Members and roles are covered (`00001895:123-150`). **No trigger on `owner_user_id` changes** of `org.teams` / `org.business_profiles`; transfer syncs explicitly (`00001020:2360`). | ⚠️ minor |
| V3 | SQL door per action | top-up `add_funds` (F1230:231) · withdraw `withdraw` (F1240:315) · transfer out `withdraw` (F1210:1946) · distribute `distribute` (:2067) · fund escrow `spend` (`00001100:1082`) · recurring `add_funds` · payout schedule `withdraw` (RLS) · methods `manage_billing` | ✅ |
| V4 | Transfer **into** a shared wallet | `transfer_funds` requires only that the destination is `fn_owner_visible` (F1210:~1951), yet it logs an `add_funds` audit row. A member without `contribute_funds` can pay into a vault. | ⚠️ |
| V5 | Service / route guard | `wallet-actions.ts` and `api/wallet/action.ts` defer to the SQL doors, as documented | ✅ by design |
| V6 | UI offering matches the doors | `actionsFor` (`live-wallet.ts:352-376`) matches. **Mismatch:** `canDecide = manage_billing \|\| distribute` (`WalletHome.island.tsx:441`), but the door needs `approve_spend`. A pure approver never sees Review; a `distribute` holder sees a Review the server refuses; a requester sees Review on their own request. | ❌ |

### 1.9 Routes, intents & states

| # | Check | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| R1 | Four pages, one island | `ROUTING.md:222-225`, #122/#124 | `/wallet`, `/transactions`, `/analytics`, `/invoices` each call `resolveWalletHome(…, view)` and render `WalletHome` | ✅ |
| R2 | Legacy `[section]` | `ROUTING.md:247-249` | A 308 map (activity → analytics; payouts/funding/access → `#upcoming`; methods → `#methods`). It keeps `w` and `display` and drops `flow`; anything else is a 404. | ✅ (drops `flow`: T) |
| R3 | Query validation | §2 "Zod at the edge" | Hand-written allowlists (`walletQueryFrom`, `parseWallet`, `toFlowPeriod`, `ledgerFiltersFrom`, `walletIntentOf`). Unknown values fall back, but the address bar is never corrected. | ⚠️ |
| R4 | URL round-trip | `ROUTING.md:229-241` | `flow`/filters use replaceState with popstate; `do` is stripped on load; Stripe return params are stripped | ✅ |
| R5 | **`?w=` the viewer cannot access** | — | It falls back silently to the **personal** wallet with a 200 (`svc/wallet-scope.ts:220-224`), and the foreign `w` stays in the URL. `?do=top_up&w=business:X` opens a **personal** top-up and still offers "Back to checkout". | ❌ |
| R6 | Failure state | — | 503 plus a `Failure` "Try again" block on each page; per-section retries | ✅ |
| R7 | Thin routes | §2 | `api/wallet/*` use Zod + `WalletBackendService` → `ServiceResult`. The `finance/{statements,invoices}/[id]/*` routes check ids with `UUID_RE`, not Zod (T). | ✅ |
| R8 | No Supabase or money maths in islands | §2 | Clean; only preview arithmetic, with the server authoritative | ✅ |
| R9 | Locked actions | §3.11 | The server decides what is offered; an environment block shows a lock with a fix link (`WalletDialogs.tsx:180-206`) | ✅ |
| R10 | Statement / bill PDFs on `/wallet/invoices` | `PRODUCT_SPEC.md:3101` | `InvoicesPanel` renders **no PDF link** (`InvoicesPanel.tsx:96-115`); `StatementRow.hasPdf` is hard-coded `false` (`live-wallet.ts:1748`). The route `/api/finance/statements/[id]/pdf` exists and only Billing links to it. | ❌ |
| R11 | Receipt download on refusal | — | The `<a href=receiptHref>` attachment (`LedgerRow.tsx:138-146`) opens raw JSON on a 4xx | ⚠️ |
| R12 | `/wallet/create` | `PRODUCT_SPEC.md:3102` vs `ROUTING.md:249` | The spec lists it; routing and code 404 it | 📄 → #251 (b) |
| R13 | Dev Context Switcher | §5 | Only `walletAurora` is wallet-specific. `payoutReadiness` does **not** reach the wallet's verification lock. There is no axis for KYC state, scope kind or processor down. | ⚠️ |

### 1.10 Modal architecture (§B.10.9)

| # | Check | Implementation | Status |
| :-- | :-- | :-- | :-- |
| M1 | One dialog at a time, replace in place | One `walletDialog` signal (`wallet-state.ts:139-151`). Kinds: Locked · Move (top_up/withdraw/transfer/distribute/fund_escrow) · Config (recurring/payout/smoother/floor) · AddCard · Line · Approval. Every one goes through `Frame` → `Dialog` with a Signal `visible`. Popovers close before a dialog opens. | ✅ zero stacked scrims |
| M2 | Focus return | `useFocusTrap` restores the opener. A dialog opened from `?do=` or a Stripe return has no opener, so focus falls to `body`. | ⚠️ T |
| M3 | Mobile sheet | `useIsMobile()` → `position:"bottom"` | ✅ |
| M4 | "The address stays honest" | The open dialog is not mirrored in the URL; Back leaves the page (this matches the Back rule) | ⚠️ optional |
| M5 | Enlarge chart/table → modal → `/inspect` | Not present (§0); cash flow links to `/wallet/analytics` | 📄 design call → §4.4 |

### 1.11 Schema ↔ Zod ↔ docs drift

| # | Drift | Status |
| :-- | :-- | :-- |
| Z1 | `EscrowSchema` (`packages/types/finance/ledger.ts:100-126`): `payerBusinessId` is non-nullable but the column is nullable. `payerUserId`, `releasedAt` and `autoFunded` are missing. `status` is `z.string()` instead of the enum. | ❌ |
| Z2 | `ChargebackSchema` (`billing.ts:116`) lacks `unrecoveredCents` (`Tables.md:691`) | ❌ |
| Z3 | `Tables.md` §escrows lacks `released_at` and `auto_funded`. There is no entry for `finance.buyer_details` or `finance.promo_codes`. | 📄 |
| Z4 | `Tables.md:224` says `deposit_rules.interval` is weekly/monthly, but the enum also has `below_floor`. `Tables.md:247` says a statement is a "30-day window", while the code and `finance-model.md` §15 use a calendar month. | 📄 |
| Z5 | `WalletPotSchema.name` max(120) and `SpendApprovalSchema.reason` max(2000) have no DB CHECK | ⚠️ T |
| Z6 | A stale comment at F1210:1813 calls `fn_wallet_credit` a "silent no-op", which contradicts #186 PW404 | 📄 T |

### 1.12 Multi-currency & FX

Model (sound): one wallet per `(owner, currency)` (`uq_wallet_owner_currency`, T17:33). Wallets are created lazily by `fn_ensure_wallet` (F1200:79-95). Money is settled in its origin currency, and conversion is display-only (#69/#153).

| # | Check | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| C1 | Wallet created in the right currency | `PRODUCT_SPEC` "priced in the creator's local currency" | Team and business wallets are created in the creator's **display** currency, falling back to `'USD'` (`00001020:1146-1171`). The spec calls display preference presentational only. | ⚠️ 📄 → #251 (n) |
| C2 | Money in X never lands in a Y wallet | finance-model §11 | Credit/debit look up the exact currency (F1200:18-20). Top-up refuses a mismatch (F1230:236). A foreign settlement goes to reconciliation (F1230:700-731). Transfers refuse across currencies (F1210:650,679,1957). Payouts check currency (F1240:546). | ✅ |
| C3 | Escrow / split / invoice / fee currency | §11 | Escrow is in the project currency; payer and payee wallets are ensured in it (F1200:756,974-1020). The split runs in the escrow currency. Invoices are per `(business, period, currency)`. Fee is integer bp, floored. | ✅ |
| C4 | Paying from a wallet in another currency | — | `place_wallet_order` refuses "Your wallet holds no %" (F1210:~1290). There is no own-wallet conversion door, so a GBP balance cannot buy a USD listing and balances are **stranded** by currency. | ⚠️ product gap → #251 (o) |
| C5 | Live FX rates | §11 "latest fx_rates" | Only the seed writes `finance.fx_rates` (`00005050:237-264`, `as_of` 2026-08-01, `provider='seed'`). No feed, cron or edge function. | ❌ |
| C6 | Staleness disclosed | `fx.ts:51` | `stale` is true once rates are older than 24h (`FxService.ts:118`). **Nothing reads it** (apps/web, MoneyView). Every converted figure is a two-month-old rate shown as current. | ❌ |
| C7 | FX snapshot at commit (`fx_rate/fx_base/fx_as_of`) | finance-model §11; SA:2790; `Tables.md:84-86` | The columns exist (T17:77-79,125-127) but **no function writes them**. Orders have no FX columns, so the rate checkout showed is never persisted. | ❌ 📄 |
| C8 | Commit compares the right figure | — | The commit compares `expectedTotalMinor` with the **display** total (`CheckoutBackendService.ts:768`). With moving rates, an unchanged listing-currency charge is refused as "price changed". This is latent only because the rates never move (C5). | ⚠️ |
| C9 | Rate label precision | — | `settlementOf` shows only the first converted line's rate at 4 dp (`commerce-money.ts:181-184`). NGN→GBP 0.000505 shows as 0.0005, about 1% off. | ⚠️ |
| C10 | **Minor-unit exponents, one SSOT** | — | Three lists disagree. `packages/types/finance/wallet.ts:1362-1374` has 6 codes, so KRW, VND and CLP default to 2 decimals. `packages/ui/display/core/currency-store.ts:99-122` has 24. SQL `fn_minor_units_text` (F1240:197-210) has 16 and divides KWD/BHD by 100. | ❌ |
| C11 | Stripe currency rules | — | Amounts pass through unchanged (`stripe-rails.ts:90-91,383-384`). Not enforced: 3-decimal amounts must end in 0, and ISK/UGX are sent as 2-decimal. Projects narrow to the 12 display currencies, but catalogue listings accept any `^[A-Z]{3}$` (`catalogue.ts:147`; `00000023:84`). | ⚠️ latent |
| C12 | Locale | DESIGN_SYSTEM | Server-built money strings are always `en-GB` (`commerce-money.ts:96,115,123,127`; `formatMoney` default `wallet.ts:1407`) | ⚠️ |
| C13 | **Totals across currencies** | — | `sumOf` / `aggregateRef` / `availableOf` convert at the stale seed rate and sum without marking the result an estimate. **Currencies that cannot be converted are silently dropped** (`wallet-scope.ts:265-300`; `live-wallet.ts:137-139`, used at :483,805,809,1732). A wallet in a non-display currency vanishes from the hero total. | ❌ |
| C14 | Currency columns constrained | §1 | Constrained: orders, order lines, inbound payments, catalogue, marketplace, preferences. **Unconstrained:** `wallets`, `transactions`, `escrows`, `invoices`, `payouts` (T17), `projects.currency` (`00000015:84`), `business_profiles.default_currency`. Zod `currency` is `min(3).max(8)` (`common.ts:27`). | ⚠️ |
| C15 | **Per-currency thresholds** | §15 | `on_account_limit_cents` is a flat 2,500,000 minor units in every currency (`00005001:74`; read F1250:536,561). That is about £236 in INR and about £13k in JPY. `vault_approval_threshold_cents` is flat too (`00005001:66`). `min_withdrawal_minor` is correctly per currency. | ❌ |
| C16 | Base currency | §11 | `platform_params.base_currency` is read only at onboarding (`00001010:421`). Code hard-codes `PLATFORM_BASE_CURRENCY="GBP"` (`fx.ts:35`) and `fx_base DEFAULT 'GBP'`. | ⚠️ |
| C17 | **Platform settlement currency vs wallet currency** | finance-model §9/§11 | USD charges may settle into a GBP platform Stripe balance while the ledger credits a full USD wallet. A later USD Transfer (`stripe-rails.ts:381-385`) can then fail for lack of USD balance, or the platform silently eats FX. The Connect account's default currency is never considered. | ❌ 📄 → #251 (m) |
| C18 | Chargeback currency | — | Recorded in the dispute's currency without comparing it to the payment's (F1230:~1528). See also H3 (no `charge.refunded`). | ⚠️ |
| C19 | Mixed-currency basket | #153 | Refused: "pay each currency separately" (`CheckoutBackendService.ts:785-787`) | ✅ |
| C20 | FX read window | — | `.limit(500)` newest-first with no distinct-per-quote (`FxService.ts:166-171`). With a live feed, quotes refreshed less often fall out. The seeded inverse rows are never read (`fx.ts:259-262` derives `1/rate`). | ⚠️ |

### 1.13 Checkout (basket → session → payment → order → fulfilment)

Out of scope here and covered elsewhere: the business spend gate (BUSINESSES_AUDIT BF20/BF24; #229/#230/#239/#243), the seller payout-ready gate (K3), wallet `?w=` (R5).

| # | Check | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| CO1 | Server-derived total | `00000017:950` | `CheckoutBackendService.ts:758-777` re-computes currency, contribution, total and promo | ✅ |
| CO2 | DB re-prices every line | #153/#166/#167/#171/#211 | `place_wallet_order` (F1210:1353-1612): each unit must equal the catalogue/ticket/revision/seat/session price | ✅ |
| CO3 | Buyer cannot write a discount | — | `trg_basket_items_derived` (`00001830:76-81`) | ✅ |
| CO4 | Charged amount = total shown | §Escrow | The DB computes its own `v_net` (F1210:1653). Nothing asserts it equals the TS `charge`. A card tops up `charge.minor` (CBS:868) but the debit is `v_net`, so any gap is taken silently from the existing balance, or the order fails. | ⚠️ |
| CO5 | Promo re-checked at pay | — | `resolve_promo_code` (F1210:1061), re-validated at :1629-1640 | ✅ |
| CO6 | **Promo `max_redemptions` race** | T17:833 "enforced under a row lock" | The promo `SELECT` (F1210:1629) takes **no `FOR UPDATE`**, then runs an unguarded `redemption_count + 1` (:1845). Concurrent orders exceed the cap. | ❌ 📄 |
| CO7 | Which code was redeemed; per-user limits | — | `orders` has `promo_discount_minor` but no code column. No per-user cap (grepped `per_user`, `promo_redemptions`). | ❌ → #251 (p) |
| CO8 | **Promo on escrow lines** | — | The DB refuses a promo when any ticket/revision/seat/session line is present (F1210:1620). TS `resolvePromo` (`live-basket.ts:1200`) and `blockersFor` (CBS:198-340) never check this, so the buyer sees the discount. **On card/express the card is charged first** (CBS:866), the webhook order then fails, and the payment becomes `settled_unapplied`. | ❌ |
| CO9 | Idempotency, same key | T17:1058 | Prior-order check (CBS:689); DB replay on key (F1210:1290); Stripe key per payment (`stripe-rails.ts:111,141`) | ✅ |
| CO10 | Concurrent same-key race | — | The key check runs **before** the basket `FOR UPDATE` (F1210:1290 vs :1300). The loser gets PC409 and the client calls `resetAttempt()` (`CheckoutPaymentScreen:451`). | ⚠️ |
| CO11 | **Card in two tabs** | — | The attempt key is per tab (`basket-state.ts:279-292`). On card each tab opens its own PaymentIntent, both charge, and the second becomes `settled_unapplied`. | ⚠️ |
| CO12 | Double-click | — | `submitting` guards (BuyNowModal:210; payment screen :497,:569) | ✅ |
| CO13 | Order lifecycle | PRODUCT_MANAGEMENT; enum `00000004:476-481` | Only `confirmed` is written (F1210:1698). `processing`, `awaiting_payment`, `invoiced`, `refunded` and `cancelled` have no writer. On-account orders are stored `confirmed`, labelled "Projective wallet". The `invoiced` copy (`OrderSummaryHeader:175`) is unreachable. | ⚠️ 📄 |
| CO14 | Charge OK, order failed | #200 | The webhook places the order in a subtransaction and marks `settled_unapplied` (F1230:827-856); `v_ops_unledgered_payments` exists (service role, no reader, see L5) | ✅ |
| CO15 | Abandoned sessions / basket nudge | `PRODUCT_SPEC:1128` | No sweep for stale `requires_payment` payments; no abandoned-basket job | ⚠️ 📄 |
| CO16 | 3DS / SCA / Payment Element | #126/#153 | Saved card `confirm:true, allow_redirects:'never'` + `handleNextAction`; Element for new cards; express return validated and stripped; failure says "Nothing was charged" | ✅ |
| CO17 | Wallet + card split | — | Not supported (the card tops up the full charge). The session's `shortfall` (CBS:527) is never offered. | 📄 |
| CO18 | Own-listing purchase | — | Own product/session is refused (F1210:1524,1575) **only when `owner_team_id IS NULL`**, so a member can buy their own team's product. Cohort seats have no own-listing check. | ⚠️ |
| CO19 | Basket authority | — | `fn_can_manage_basket` (F1210:1304), `ownerMatches` (CBS:704), card re-checked against the owner's list (CBS:850) | ✅ |
| CO20 | **On-account amount is caller-supplied** | finance-model §15 | `place_on_account_order` (F1250:474, GRANTed to authenticated, `00002510:867`) credits **`p_amount` from the caller** (F1250:552) and then `place_wallet_order` debits `v_net`. Calling the RPC directly with an inflated `p_amount` leaves the surplus as **spendable business-wallet balance** up to the on-account limit, and that money is invoiced later as if it had been spent. | ❌ **security** |
| CO21 | `buyer_details` PII | — | RLS: entity members see, spenders write (P2013:240-249); no DELETE grant. Every member of a business sees its billing PII. | ✅ / ⚠️ by design |
| CO22 | Promo enumeration | — | `promo_codes` has no policy or grant (definer reads only), but `resolve_promo_code` has no rate limit | ⚠️ |
| CO23 | Product sale credit | #191 | Through `fn_wallet_credit_pending`. The fee uses the **payer's** `fn_effective_platform_fee_bp` (F1210:1690). Whether payer or seller tier sets the rate is unconfirmed against #187. | ⚠️ 📄 → #251 (q) |
| CO24 | Escrow-line fulfilment | #166/#167/#171/#211 | `fund_ticket`, `fund_paid_revision`, `fn_book_session_slot` and `fn_confirm_seat` run in the order transaction (F1210:1717-1790) | ✅ |
| CO25 | **Refund / cancel from an order** | — | Not found. Escrow refunds never update the order or its lines (they keep saying "Escrow held"). There is no digital-product refund policy in the spec. | ❌ → #251 (r) |
| CO26 | Thin routes, Zod | §2 | `api/checkout/{create,order,session}.ts` (Zod `CreateCheckoutSchema`, `checkout.ts:927`) | ✅ |
| CO27 | Open redirect | — | No `?back=` in checkout; `checkoutStepHref` builds fixed paths | ✅ |
| CO28 | Payment step guard | `PRODUCT_SPEC:3106` | `checkout/payment.tsx` 302s to details when incomplete | ✅ |
| CO29 | Dev Context Switcher | §5 | Only `basketScenario` and `checkoutGate`. Missing: card outcome (declined · 3DS · timeout · unapplied), `price_changed`, promo states, processor down. | ⚠️ |
| CO30 | Tests | §9 | No tests for `CheckoutBackendService.create`, `checkoutTotals`/`applyDiscounts`, promo, or replay. No promo or concurrent-order probe. | ⚠️ |

---

## 2. Visual & Design-System Defect Log

Severity: **G** = merge-gate violation (root `CLAUDE.md` §3) · **M** = matrix / spec drift · **T** = tidy.
Paths are under `wlt/`.

### 2.1 The scoped Wallet exception (#122 / #123 / #124 / #152)

| ID | Sev | Defect | Fix |
| :-- | :-- | :-- | :-- |
| D1 | G | **High contrast is never handled.** There is no `data-contrast` / `prefers-contrast` / `forced-colors` selector anywhere in the feature. The hero's soft ink is 84% translucent white (`wallet-tokens.css:34`). Glass edges and fills (:35-40) and the static gradient are the same under HC. | Add a `:root[data-contrast="high"]` block: opaque `--wlt-hero-ink-soft`, stronger `--wlt-glass-edge`, and `data-aurora` forced static. |
| D2 | G | **The static gradient is not contrast-clamped.** The #152 luminance clamp covers only the canvas. The CSS resting state (no JS, reduced motion, refused device; `wallet-hero.css:51-61`) puts white ink on `--wlt-aurora-cyan` #06b6d4 at 85%, which is about **2.4:1** in the top-start corner where the scope pill sits. | Darken the cyan stop or lay a deep scrim band under the content row. Pin the ratio in a test, as `theme-engine` pins its pairs. |
| D3 | M | Aurora violet leaves the hero: `--wlt-fund-reserved: var(--wlt-aurora-violet)` (`wallet-tokens.css:63`) paints the allocation meter on `--surface`, with no dark, HC or CVD variant. The spec says the aurora "licenses no other surface". | Use a ramp role (the `--help` violet tone), or log the extension. |
| D4 | M | The glass pills and corner tools have no `@supports not (backdrop-filter)` fallback (`wallet-hero.css:318`, `wallet-tools.css:188`). The sheet, popovers and ruler do. | Add an opaque `--wlt-hero-deep` fallback. |
| D5 | M | The hero's money-movement pills (Top up / Withdraw / Send, `WalletHero.tsx:227`) are bespoke glass `<button>`s with no tier-1 reading. The glass is licensed; the matrix's "act that starts a financial flow" is not addressed. | Owner ruling → #251 (g). |
| ✅ | — | Tokens `--wlt-aurora-{cyan,cobalt,violet,indigo-deep,base}` are declared once (`wallet-tokens.css:21-25`) and read by the canvas at runtime (`aurora-engine.ts:485-489`). `HeroAurora` is `aria-hidden` and inert, at `z-index:-1` over a complete static ground. It never mounts under either reduced-motion channel. It honours Save-Data, `deviceMemory` and cores; pauses when hidden or off-screen; has a p95 watchdog and a silent-rAF stall interval; and re-solves the ceiling when theme, contrast or CVD changes. Every `backdrop-filter` is on a `::before` underlay of a sanctioned element. | Compliant |

### 2.2 Solid tones, anti-card, separation (§3.1, §3.6)

| ID | Sev | Defect | Fix |
| :-- | :-- | :-- | :-- |
| D6 | G | The selected row is a translucent wash: `.wlt-scope-menu__item[aria-current]` (`wallet-accounts.css:224`) and `.wlt-currency__item[aria-checked]` (`wallet-tools.css:309`) use `color-mix(--primary …, transparent)`. The #123 popover licence covers the veil, not the row state. | `--surface-2` + `--on-surface`, or the solid `--primary-tint`. |
| D7 | G | Static content is boxed: `.wlt-account--pot` (the tax pot, which its own comment calls static, `wallet-accounts.css:35-55`) keeps the `--surface-1` tile. | Unboxed figure in the rail, or make it a link once pots are actionable (P3). |
| D8 | M | Re-invented status tints instead of the §B.4.2 opaque tokens: `--wlt-attention-fill/-ink` (tokens:68-69, mixed against `--surface`), success 16%/14% (`wallet-dialogs.css:126`, `wallet-ledger.css:127`), `--wlt-credit-ink` (:65), the current-account tile's `--primary` 7% (`wallet-accounts.css:73`). None of their contrast is pinned. | `--warning-tint`, `--success-tint`, `--primary-tint` + ink tokens. |
| D9 | M | Opacity used as a state dim: meter hover 0.45 (`wallet-meter.css:96`), loading 0.6/0.5 (`wallet-analytics.css:44`, `wallet-flow.css:13`) | Dim marks only, keep text at full ink, tokenise. |
| D10 | T | Every list row carries its own `border-block-end` (release rows, dialog facts, statements, members) | Spacing first; one hairline per group. |

### 2.3 Motion & press (§3.4, §3.12)

| ID | Sev | Defect | Fix |
| :-- | :-- | :-- | :-- |
| D11 | G | Reduced motion is asymmetric. `.wlt-lrow` `transition:none` is only under the media query (`wallet-ledger.css:349` vs :354). `.wlt-ruler__thumb` is the same (`wallet-tools.css:322` vs :332). `wallet-dialogs.css` and `wallet-flow.css` have no reduced-motion block, although `wallet-flow.css:9` transitions opacity. | Mirror every `prefers-reduced-motion` rule under `:root[data-motion="reduced"]`, rule for rule. |
| ✅ | — | Press is `transform: scale(var(--btn-press-scale*))` throughout, with no literal durations | Compliant |

### 2.4 Anti-tagification & typography (§3.7, §3.8)

| ID | Sev | Defect | Fix |
| :-- | :-- | :-- | :-- |
| D12 | M | The ledger status pill is hand-rolled (`.wlt-status`, `wallet-ledger.css:246-266`; `LedgerRow.tsx:133`). A container is allowed because it is a lifecycle status, but the component is a bespoke copy. | `Tag severity`. |
| D13 | M | Release-schedule pips are colour-only (teal vs amber, `aria-hidden`, `wallet-analytics.css:259-283`) | Add the hatch/ring shape channel the meter already uses. |
| D14 | T | `tabular-nums` is missing on `.wlt-chart__when` (`wallet-flow.css:150`), the ledger row date `Meta` (`LedgerRow.tsx:117`), `.wlt-hero__fx` (hero:225) and `.wlt-hero__meta` | Add `.wlt-num` / `font-variant-numeric`. Verify the `AreaChart` tick labels in `packages/ui`. |
| D15 | T | `wlt-section__count` carries a window label, not a count (`CashFlow.tsx:169`). There is a hard-coded `en-GB` (`AnalyticsView.tsx:197`). | Meta span; viewer locale. |
| ✅ | — | Display at `--fw-medium`, section headers ≤ semibold, no numeric weights; analytics meta is inline middot text; statement status is inline text | Compliant |

### 2.5 Buttons (§B.8, Decision #157)

| ID | Sev | Region · control | Current | Required |
| :-- | :-- | :-- | :-- | :-- |
| D16 | M | Ledger filters · Download CSV (`LedgerFilters.tsx:129`) | outlined, primary severity | Tier 4 `severity="neutral" variant="outlined"` |
| D17 | M | Upcoming · Show N more (`UpcomingList.tsx:96`) | `text` | Tier 4 (utility) |
| D18 | M | Add card · Save card (`WalletDialogs.tsx:1046`); Approval · Approve (:1250); Recurring · Save (:810) | Tier 3 | Tier 1 `severity="accent" rounded` on financial commits, or record why tier 3 (→ #251 (g)) |
| D19 | M | Done · Back to checkout (`WalletDialogs.tsx:432`) | `<a>` hand-dressed in `ui-button` classes | `Button` href mode (add it to the package if it is absent) |
| D20 | M | Allocation term focus ring (`wallet-meter.css:134`) | Shows `--focus-ring-shadow` | The owner's rings-off directive applies; confirm the exception or remove the ring |
| ✅ | — | Dialog footers have one filled control each; money commits are tier-1 accent rounded | — | Compliant |

### 2.6 Tidy

| ID | Defect | Fix |
| :-- | :-- | :-- |
| D21 | `border-radius: 50%` about 22× across 9 sheets | `var(--radius-full)` |
| D22 | Literal `1px solid` (hero:143/302, tools:62/173, lane:247); `translateY(-1px)` (hero:363); rem boxes 1.75–3rem; `"2px"` style vars (`CashFlow.tsx:92,99`); hover washes 5%/6% | Tokens |
| D23 | Duplicate declarations (`wallet-hero.css:186/190`, `wallet-accounts.css:~236-242`, `wallet-tools.css:55-56`) | Merge |
| D24 | `useEffect` that mirrors a signal (`WalletHome.island.tsx:337`); a mount-only clear (`WalletDialogs.tsx:988`) | `effect()` / `computed` |
| D25 | Meta-comments in the gradient ("Punchy, saturated…", `wallet-hero.css:52-60`) | Factual notes |
| D26 | `.wlt-textlink` uses `--primary` as text ink at `--text-sm` (`wallet-sheet.css:233`) | Verify ≥ 4.5:1 in light mode or use the link-ink token |

### 2.7 Checkout surfaces (`apps/web/features/checkout/`)

| ID | Sev | Defect | Fix |
| :-- | :-- | :-- | :-- |
| D27 | M | PromoField "Apply" is `filled` `secondary` (`PromoField.tsx:97`), which is not a matrix tier | Tier 4 neutral outlined |
| D28 | M | AddPaymentMethod "Save card" is tier-1 amber (`:228-240`), though saving a card is not a terminal financial commit. This conflicts with D18's proposal for the wallet's Save card. | One ruling for both → #251 (g) |
| D29 | G | Translucent fills on a row and a region: `.bsk-row[data-flagged]` (`basket-body.css:811`), media placeholder (:378) | Solid ramp tones / opaque tints |
| D30 | M | Converted figures show no estimate or staleness mark (C6), and drop currencies from totals silently (C13) | "≈" + rate date as MetaLine; "Excludes JPY" note |
| ✅ | — | Pay is the only accent control and is hidden while the business gate commits; prices are `tabular-nums` (`.cko-money`); no Supabase in islands | Compliant |

Also compliant: no raw hex/rgba outside the token sheet, no native `<select>`/`<input>`, inline style only
through `styleVars`, layout driven by `@container` (one viewport query hands lane duty to the sheet,
the repo convention), and accessible `CashFlow` (focusable group, arrow keys, live readout, hidden
data table).

---

## 3. Component & Service Refactoring Plan

Order: P0 = security / money correctness / gate violation, P1 = functional gap / matrix drift, P2 = tidy.

### 3.1 Database (edit in place)

| File | Change | Findings | Pri |
| :-- | :-- | :-- | :-- |
| `00002013_policies_finance.sql` | `deposit_rules`: SELECT only (writes through doors). `wallet_pots`: SELECT only. | A12, A4 | P0 |
| `00001830_triggers_finance.sql` | `trg_deposit_rules_immutable` on `wallet_id, currency, source_method_id, interval` | A12 | P0 |
| `00001240_functions_finance_money_movement.sql` | `update_deposit_rule` (pause/resume/amount, re-stamps `created_by`, `add_funds`) · `fn_apply_pot_allocations` called from `fn_mature_pending_releases` + the zero-day branch of `fn_wallet_credit_pending` (income reasons only) · `move_pot_funds` · `save_wallet_pot` (Σbp ≤ 10000 under an advisory lock) · `fn_claim_due_payout_schedules` · `record_charge_refunded` · KYB for enterprise in `begin_payout` | A3, A2, A13, A14, H3, K4 | P0/P1 |
| `00001230_functions_finance_stripe.sql` | `record_dispute_opened` freezes matching `pending_releases` (`on_hold`, after the #251 (c) ruling) · `record_dispute_closed` records a resolved chargeback when `.created` has not arrived yet · `record_dispute_updated` | W3, H4, H3 | P0 |
| `00001210_functions_finance_kyc_wallet.sql` | `transfer_funds` needs `add_funds` on a shared destination · `fn_assert_business_spend` covers `enterprise` · `fn_expire_spend_approvals` · stale comment :1813 | V4, K4, A16, Z6 | P0/P1 |
| `00001200_functions_finance_core.sql` | `fn_team_split_plan` re-checks finder membership + entitlement (after ruling) · `fn_release_ticket_escrow` / `fn_fair_exit_release` ask `fn_escrow_has_open_dispute` · `fn_effective_platform_fee_bp` raises instead of returning 0 | A19, L9, S4 | P1 |
| `00001240` (dispute thaw) | Handle the `uq_escrows_ticket_base_held` conflict on thaw | E3 | P1 |
| `00001895_triggers_derived_columns.sql` | `AFTER UPDATE OF owner_user_id` on `org.teams` / `org.business_profiles` → `fn_sync_vault_permissions` | V2 | P2 |
| `00003004_views_…analytics.sql` | Add pots to `v_wallet_reconciliation` | L7 | P1 |
| `00005060_seed_scheduled_jobs.sql` | Jobs: payout schedules, approval expiry, idempotency-key sweep, (smoother once ruled) | A14, A16, L8 | P1 |
| `00002510` / `00002520` grants | Grants for every new door; revoke pot/deposit-rule INSERT/UPDATE | — | P0 |
| `00001250_functions_finance_auto_fund_billing.sql` | `place_on_account_order` derives the amount in SQL (drop `p_amount`, or assert `charged = p_amount` and raise); writes `status='invoiced'`, label "On account"; limits read per currency | CO20, CO13, C15 | **P0** |
| `00001210` (`place_wallet_order`) | Promo row `FOR UPDATE` + guarded `UPDATE … WHERE redemption_count < max_redemptions RETURNING`; `p_expected_minor` assert vs `v_net`; idempotency re-check after the basket lock; own-listing check covers team-owned products and cohort seats | CO6, CO4, CO10, CO18 | P0 |
| `00001230` (`begin_card_payment` / `attach_checkout_order`) | Refuse a second open checkout payment for overlapping basket items | CO11 | P1 |
| `00000017_tables_finance.sql` | `orders.promo_code` (+ `promo_redemptions` after the #251 (p) ruling); `CHECK (currency ~ '^[A-Z]{3}$')` on wallets, transactions, escrows, invoices, payouts; drop or stamp the dead `fx_*` columns | CO7, C14, C7 | P1 |
| `00000015_tables_projects.sql:84`, `00000011_tables_org.sql` | Currency CHECKs; default-currency ruling (#251 (n)) | C14, C1 | P1 |
| `00001240` (`fn_minor_units_text`) | Exponent-aware formatting (3-decimal currencies, ISK) from one list | C10 | P1 |
| `00005001_seed_platform_params.sql` | `on_account_limit_cents` and `vault_approval_threshold_cents` become per-currency maps | C15 | P0 |
| `00005060` jobs | Stale `requires_payment` sweep (cancel the PaymentIntent); abandoned-basket nudge; FX rate feed (if #251 (m) picks it) | CO15, C5 | P1 |

### 3.2 Services & types

| File | Change | Findings | Pri |
| :-- | :-- | :-- | :-- |
| `packages/types/finance/ledger.ts`, `billing.ts` | Fix `EscrowSchema`, `ChargebackSchema` | Z1, Z2 | P0 |
| `packages/types/finance/wallet.ts` | Actions `pause_recurring` · `resume_recurring` · `edit_recurring` · `cancel_recurring` · `save_pot` · `move_pot` · `WalletPageQuerySchema` (`w, flow, display, tz, do, back, q, dir, kind`) | A13, A3, R3 | P1 |
| `packages/types/finance/payments.ts` | `HANDLED_STRIPE_EVENTS` += `charge.refunded`, `charge.dispute.updated`, `payout.canceled` | H3 | P0 |
| `svc/stripe-webhook.ts`, `PaymentBackendService.ts` | `planStripeEvent` branches for the new events | H3 | P0 |
| `svc/wallet-scope.ts` | Report `requested ≠ resolved` so the route can 303 to the honest `w` and drop `do` | R5 | P0 |
| `svc/live-wallet.ts` | Smoother read per currency; pot list ordered and per currency; `StatementRow.pdfHref`; `SpendApprovalView.decidable` | A7, A4, R10, V6 | P0/P1 |
| `svc/wallet-actions.ts` | Recurring / pot actions → the new doors | A13, A3 | P1 |
| `svc/WalletBackendService.ts` | Recon read for ops (`listReconciliationAlerts`), admin-only | L5 | P2 |
| `packages/types/finance/wallet.ts` (exponents) | ONE `CURRENCY_EXPONENTS` SSOT (a superset of the UI's 24); `packages/ui/display/core/currency-store.ts` imports it, pinned by a contract test that also asserts it matches the SQL list; Zod `currency` = `^[A-Z]{3}$` | C10, C14 | P1 |
| `svc/CheckoutBackendService.ts` | `promo_not_applicable` blocker before any card charge; commit compares the **listing-currency** charge, not the display total; pass `p_expected_minor` | CO8, C8, CO4 | P0 |
| `svc/commerce-money.ts`, `FxService.ts` | Viewer locale; every origin's rate at significant precision; `stale`/`provider` carried to every converted figure; read distinct-per-quote | C12, C9, C6, C20 | P1 |
| `svc/wallet-scope.ts`, `live-wallet.ts` aggregates | Return `{ total, estimated: true, asOf, excluded: [ccy] }`; never drop a currency silently | C13 | P0 |
| `svc/stripe-rails.ts` | Stripe currency rules (3-decimal rounding to 0, ISK/UGX); settlement-currency strategy per #251 (m) | C11, C17 | P1 |

### 3.3 UI (`wlt/`)

| File | Change | Findings | Pri |
| :-- | :-- | :-- | :-- |
| `islands/WalletHome.island.tsx` | `canDecide` from the server's `decidable`; `replaceState` the resolved `w`; PDF via `saveBlob`; drop the `useEffect` mirror | V6, R5, R11, D24 | P0 |
| `components/InvoicesPanel.tsx` | PDF link per statement and bill (tier 5 row action) | R10 | P0 |
| `components/UpcomingList.tsx`, `core/wallet-home.ts` | Recurring row actions (pause / resume / edit / cancel); show-more tier 4 | A13, D17 | P1 |
| `components/AccountRail.tsx` | Pot tile → unboxed figure or link; pots list once P3 lands | D7, A3 | P1 |
| `components/WalletDialogs.tsx` | Pot dialogs; tier review (D18); `Button href` (D19); focus target when no opener (M2) | A3, D18, D19, M2 | P1 |
| `components/LedgerRow.tsx`, `LedgerFilters.tsx` | `Tag` status; tabular date; neutral tier-4 CSV | D12, D14, D16 | P1 |
| `styles/wallet-tokens.css`, `wallet-hero.css` | HC block; static gradient clamp; `@supports` fallbacks; `--wlt-fund-reserved` off aurora violet | D1-D4 | P0 |
| `styles/*.css` | Opaque tints; reduced-motion mirror; `--radius-full`; hairline tokens; duplicates | D6, D8-D11, D21-D23 | P0/P2 |
| `features/devtools/*`, `utils/dev-seam.ts` | Axes `walletVerification` (unverified · pending · verified-not-ready · ready), `walletProcessor` (up · down), `walletScopeKind` | R13 | P1 |

### 3.4 Proposed `packages/ui` additions

| Addition | Why |
| :-- | :-- |
| `Button` `href` mode (renders `<a>` with the button skin) | D19; the wallet hand-dresses classes today |
| Contrast-pair test helper exported for feature grounds | D2; lets a feature pin "ink over gradient stop" like `theme-engine` |

---

## 4. Strategic Architecture Decisions (ready for implementation)

### 4.1 The money-path invariant set (keep, and test it)

The ledger is sound: append-only, loud primitives, idempotency claimed in the effect's own
transaction, SKIP LOCKED maturation, held-only flips. The work here is coverage, not redesign. Add one
property probe (`supabase/probes/finance_invariants.sql`) that, for every wallet, asserts
`balance_cents = Σ signed ledger = latest balance_after_cents`,
`Σ pots.balance_cents ≤ balance_cents`, and that every `pending_releases` row in `pending`/`on_hold`
has no matching credit yet. Run it in every finance prompt's acceptance.

### 4.2 Disputes during the safety window — **needs ruling (#251 (c))**

The 7-day window exists to absorb chargebacks (#191), but a dispute today neither freezes the payee's
pending row (W3) nor recovers from it (W4). *Proposal:* `record_dispute_opened` flips matching rows to
`on_hold` (maturation skips them); a lost dispute recovers **from the payee's on-hold rows first**,
then from the payer as today; a won dispute returns them to `pending` with the original `releases_at`.
This changes who pays a chargeback, so it waits for the owner.

### 4.3 Wallet scope honesty (`?w=`)

A `w` the viewer cannot open must never silently become another wallet. Rule: the route compares
requested with resolved and **303s** to the resolved address (viewer-dependent, so not cacheable),
drops `do` and `back`, and carries `?notice=wallet-unavailable`. This mirrors the console's `forbidden → /teams?notice=` pattern (TEAMS_AUDIT §4.1).

### 4.4 Enlarge → modal → `/inspect` — **design call (#251 (h))**

Nothing in the wallet enlarges today, and `/inspect/[fileId]` is a `files.items` viewer. *Proposal:*
do **not** route finance PDFs through `/inspect`, because they are generated documents and not files.
Keep fetch-then-save (`saveBlob`). If an enlarge pattern is wanted, it is one `Dialog` (replace in
place, §B.10.9) that hosts the same `AreaChart` / `DataTable` at full width, opened from a tier-5
"Expand" row action, with no third-level hand-off.

### 4.5 Automation that saves but never runs (gate §3.11)

Payout schedules (A14) and the income smoother (A6) both accept configuration that nothing executes.
Rule: until an engine runs, the control renders as a `LockedDialog` reason ("Scheduled payouts are
coming"), never as a savable setting. Build order: payout schedules (contract complete) → pots
(§3.1) → smoother (needs a PRODUCT_SPEC entry first).

### 4.6 Proposed Decision #251 — finance audit flags (for F0 to record)

| Flag | Question | Proposal |
| :-- | :-- | :-- |
| (a) | `Policies.md:99/102` treats `spend`-gated `FOR ALL` on `deposit_rules`/`wallet_pots` as adequate, while `finance-model.md` §14 maps contribute → `add_funds` and the door checks `add_funds` | Doors only; RLS SELECT-only (A12) — **security, P0** |
| (b) | `PRODUCT_SPEC.md:3102` lists `/wallet/create`; `ROUTING.md:249` 404s it | Delete from spec (wallets are provisioned with their owner) |
| (c) | Dispute freeze / clawback on pending money (§4.2) | Owner ruling |
| (d) | `SA:2378` says Stripe keys live in Supabase Vault for Edge Functions; the env contract (`SA:3290-3300`) says `.env.local` | Correct SA:2378 to the env contract |
| (e) | `PRODUCT_SPEC.md:1386` ("cannot take on paid work") vs the #196 door list (no session host / product seller gate) | Owner ruling: widen the gate, or narrow the spec sentence |
| (f) | Split enforcement at payout (downgraded template; departed finder) | Owner ruling: fall back to co_op and drop the departed finder's cut |
| (g) | Tier of the hero pills and of Save card / Approve / Recurring Save | Hero pills stay glass (the #122 licence); Save card and Approve become tier 1; Recurring Save stays tier 3 (configuration) |
| (h) | Enlarge / `/inspect` pattern (§4.4) | No `/inspect` for finance documents |
| (i) | `finance-model.md:280` "Custom/Express" vs #125 Express-only; `finance-model.md:260` Fee Collection Account vs #187(b) not materialised; SA:2801 Stripe-balance reconciliation unbuilt and SA:2864 stale event list | Factual corrections to #125 / #187 / code |
| (j) | Income smoother has no PRODUCT_SPEC entry, yet enrolment is live | Owner ruling: spec it, or lock enrolment (§4.5) |
| (k) | `DESIGN_SYSTEM.md:1797` cites the deleted `wallet-overlays.css:28` | Re-point to the current sheet |
| (l) | `--wlt-fund-reserved` reuses aurora violet outside the hero (D3) | Use a ramp role |
| (m) | **Platform settlement currency** (C17): the ledger holds full USD/EUR wallets while Stripe may settle everything into a GBP balance | Owner ruling. Recommended: per-currency settlement (enable those Stripe balance currencies, so a payout transfers in the wallet's currency from a same-currency balance); otherwise convert at payout and disclose the spread to the payee |
| (n) | Default currency: USD (`projects.currency`, `COALESCE(…,'USD')` in F1230/F1210, business `default_currency`, catalogue) vs GBP (platform base, display preference, sponsor default); team/business wallets taken from the **display** preference (C1) | Owner ruling. Recommended: an entity's currency comes from its owner's **country** (one country→currency map in `packages/types/finance/countries.ts`), never from display |
| (o) | Stranded balances: there is no own-wallet conversion (C4) | Owner ruling: build `convert_between_own_wallets` at a disclosed spread, or state in the spec that balances are per-currency and withdraw-only |
| (p) | Promo per-user limits and redemption record (CO7) | Record the code on the order (factual); per-user caps need a product ruling |
| (q) | Product-sale fee rate is the **payer's** tier (CO23) | Confirm against #187 / finance-model |
| (r) | Refunds / cancellations from an order, including digital products (CO25) and order state after an escrow refund | Owner ruling (spec has no policy) |
| (s) | Seed comment and #69 say inverse FX pairs are seeded so nothing is derived at read; code derives `1/rate`. SA:2579 cites the deleted `fx-fixtures.ts`. #69(f) says fx_rates reads with the service role; the code reads as anon (correctly). | Factual corrections |
| (t) | `promo_codes` comment (T17:833) claims a row lock; the `order_status` comment (`00000004:476`) justifies `awaiting_payment`/`invoiced`, which nothing writes; `PRODUCT_SPEC:1128` promises abandoned-basket reminders | Fix the code (CO6, CO13, CO15), then the comments agree |

---

## 5. Prioritised backlog

| Pri | Item | Area |
| :-- | :-- | :-- |
| P0 | A12 deposit-rule RLS hole + immutability trigger + `update_deposit_rule` | DB |
| P0 | V6 approval Review gate; R5 scope honesty | app |
| P0 | H3 `charge.refunded` / `dispute.updated` / `payout.canceled`; H4 out-of-order dispute | DB + service |
| P0 | K4 enterprise KYB; V4 inbound transfer capability | DB |
| P0 | A7 smoother two-currency crash; R10 statement PDFs | service + UI |
| P0 | Z1/Z2 Zod drift | types |
| P0 | D1, D2, D6, D7, D11 UI gates | UI |
| P0 | **CO20** on-account amount from the caller; **CO6** promo cap race; **CO8** promo on escrow lines charges the card first; CO4 expected-amount assert | DB + service |
| P0 | **C13** silent currency drop in totals; **C15** flat thresholds across currencies | service + DB |
| P1 | C10 one exponent SSOT; C14 currency CHECKs; C5/C6 FX feed or staleness disclosure; C7 snapshot columns; C8/C9 commit + rate label; C11 Stripe currency rules | types / DB / service |
| P1 | CO10/CO11 races; CO13 order status writers; CO15 stale-payment sweep; CO18 own-listing; CO29/CO30 dev axes + tests; D27-D30 | DB / app / UI |
| P1 | After rulings: #251 (m) settlement currency, (n) default currency, (o) conversion, (p) promo caps, (r) refunds | DB + product |
| P1 | A2/A3 pots engine + UI; A13 recurring controls; A14 payout schedule runner; A16 approval expiry | DB + UI |
| P1 | W3/W4 dispute freeze (after #251 (c)); A19 split enforcement (after (f)); L9 dispute predicate | DB |
| P1 | R3 Zod page query; R13 Dev axes; D3-D5, D8-D9, D12-D20 | app / UI |
| P2 | L5 recon alert reader; L6 Stripe balance recon; L8 key sweep; V2 owner triggers; S4 fee fallback; D21-D26 | DB / UI |
| P2 | Doc corrections after #251 (`Tables.md`, `Policies.md`, `finance-model.md`, SA, PRODUCT_SPEC) | docs |
