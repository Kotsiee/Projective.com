# Finance Build Prompts — Claude Code Work Orders for the Finance Engine, Stripe Rails & `/wallet`

> **Status: WORK ORDERS, not binding.** This is a sequenced series of self-contained Claude Code
> prompts. Together they close the gaps in [`FINANCE_AUDIT.md`](FINANCE_AUDIT.md). Every prompt cites
> its evidence by finding ID (`L*`, `W*`, `E*`, `S*`, `K*`, `H*`, `A*`, `V*`, `R*`, `M*`, `Z*`, `D*`)
> and by the proposed Decision #251 (`FINANCE_AUDIT.md` §4.6). Paste each prompt into its **own fresh
> session**, after the standard header (§1).
>
> **Before you start:** merge the branch that adds `FINANCE_AUDIT.md` and this file, because every
> prompt cites them. Run the prompts in the §0 order. A prompt marked **🧑 DECISION** must stop and put
> the named question to a human before it changes behaviour. It presents the options with a
> recommendation.
>
> **Migrations are edited in place** (root `CLAUDE.md` §1). The commissioning brief asked for
> "additive-only" numbered files. That is a merge-gate failure in this repo, so every prompt names the
> existing category file to edit.

---

## 0. Run order & dependencies

| Phase | Prompts | Why this order |
| :-- | :-- | :-- |
| **0 — Rulings** | F0 | Records Decision #251 so later prompts can cite it instead of re-arguing it. |
| **1 — Database, ledger gaps & webhook hardening** | DB1, DB7 → DB2, DB3, DB4 → DB5 → DB6; DB8 → DB9 | DB1 (recurring-rule RLS) and DB7 (checkout integrity: the on-account amount, the promo race) close the P0 security holes first. DB2–DB4 touch different files. DB5 (pots) needs DB1's policy shape. DB6 (dispute window) and DB9 (settlement currency) are **🧑 DECISION**. |
| **2 — Fat services & thin routes** | SV1 → SV2, SV3, SV4, SV5 | SV1 fixes the Zod SSOT that the other SV prompts consume. SV4 needs DB7; SV5 needs DB8. |
| **3 — Islands & design-system alignment** | UI1 → UI2, UI3, UI4; UI5 | UI1 is the wallet token/CSS foundation; the other wallet prompts edit clean sheets. UI5 (checkout) is independent of UI1. |
| **4 — Playwright E2E & visual regression** | E1 → E2 | E1 is the functional lifecycle; E2 is the snapshot matrix. |
| **Last** | Z1 | Docs sweep and the audit status column. |

These cannot run in parallel because they edit the same files:
- DB2 / DB6 (`00001230`, `00001240` dispute bodies)
- DB4 / DB5 / DB8 (`00001240`, `00005060`)
- DB3 / DB7 (`00001210`)
- SV4 / SV5 (`CheckoutBackendService.ts`, `commerce-money.ts`)
- SV2 / SV3 (`live-wallet.ts`)
- UI1 with any UI prompt (stylesheets)
- UI2 / UI3 (`WalletDialogs.tsx`, `WalletHome.island.tsx`)

**Peer warning:** other sessions are editing `wlt/islands/WalletHome.island.tsx`,
`wlt/components/WalletDialogs.tsx` and `wlt/styles/wallet-dialogs.css` (the business checkout work
of Decision #243). Check `git status` before starting any UI prompt.

---

## 1. Standard header — paste above EVERY prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types the
Zod SSOT @projective/types; packages/backend fat services @server/services/*; supabase/migrations
Postgres with RLS everywhere; Stripe Separate Charges & Transfers on Accounts v2 Express).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (at least
     documentation/CLAUDE.md, packages/ui/CLAUDE.md, documentation/database/CLAUDE.md when SQL
     changes), then documentation/reference/guardrails.md and documentation/reference/pr-checklist.md.
  2. Read documentation/architecture/FINANCE_AUDIT.md (the finding IDs cited below) and Decision
     #251 once F0 has landed.
  3. Grep documentation/reference/decisions/README.md for the surface you touch and read the decision
     files it names. At minimum read #10, #122-#126, #152, #157, #186-#191, #196, #200, #203, #212,
     #215, #234, #239 and #243.
  4. Read documentation/business/finance-model.md (where it exists) and
     documentation/database/finance/{Tables,Functions,Policies}.md for the objects you change.

Hard rules (merge gates; reject your own diff if any of these fails):
  Money
  - Integer minor units only; floor every cut; dust goes to a named sink (the main balance or the team
    vault), never lost. Every balance move goes through finance.fn_wallet_credit / fn_wallet_debit /
    fn_wallet_credit_pending; never UPDATE finance.wallets.balance_cents directly.
  - Every webhook effect claims finance.idempotency_keys ('stripe:<evt_id>') INSIDE the same SQL
    transaction as the effect (fn_claim_stripe_event). Replays must be no-ops.
  - Never drop columns/FKs of escrows, wallets or stages without asking me.
  SSOT & architecture
  - Migrations are consolidated and EDITED IN PLACE (supabase/migrations/vvvvtooo_type_purpose.sql).
    Never append ALTER TABLE ADD COLUMN / ALTER TYPE ADD VALUE patches or create a new "fix" file.
    Each statement goes in its category file: 0 enums/tables · 1 functions/triggers · 2 policies/grants
    · 3 views · 4 indexes · 5 seed (incl. 00005060 scheduled jobs).
  - A schema or RPC-contract change lands with its Zod schema (packages/types/finance/*), the backend
    mapper, and documentation/database/finance/* in the SAME change. Lifecycle changes also update
    documentation/PRODUCT_MANAGEMENT.md; business rules also update PRODUCT_SPEC.md / finance-model.md.
  - Thin routes (apps/web/routes/api/{wallet,finance}/*): HTTP parse + Zod + auth guard ONLY. Logic
    and money maths live in packages/backend/services/finance/* and return ServiceResult<T> (#10).
  - Capability enforcement lives in the SQL door (fn_has_vault_capability); the service mirrors it only
    to decide what to OFFER. RLS on finance tables is SELECT-only unless a policy already exists and the
    audit does not flag it.
  - Islands never import Supabase or @server/*; they call apps/web/features/wallet/core/WalletService.ts.
  - Signal-first state; useEffect only for external DOM/browser/Stripe APIs. No useState.
  - Path aliases only; folders components/ islands/ styles/ hooks/ wrappers/ types/ core/; no src/.
  - JSDoc on exports; // #region [Name] … // #endregion; no meta-comments.
  UI (DESIGN_SYSTEM.md; root CLAUDE.md §3)
  - Token-only pure CSS + strict BEM. No hex/rgb outside wallet-tokens.css's licensed aurora block, no
    literal radius/duration/shadow/weight/breakpoint, no inline style= except packages/ui styleVars().
  - The scoped Wallet exception (#122/#123/#124/#152) licenses the hero aurora, the glass pills, the
    corner tools, the ruler, the sheet rim and the three popovers — nothing else. Every backdrop-filter
    sits on a ::before underlay and has an @supports not (backdrop-filter) opaque fallback.
  - Beyond the hero: solid tonal steps (--bg → --surface-1 → --surface-2); no color-mix(…, transparent),
    no opacity used to dim text; no card in a card; static content unboxed.
  - Anti-tag (§B.11): financial metadata (method, category, counterparty, period) is inline
    --text-secondary MetaLine text joined by " · ". Containers only for controls, lifecycle statuses
    (Tag), required disclosures (InlineNotice) and count badges.
  - Type (§A.4): display/title at --fw-medium, section header ≤ --fw-semibold. EVERY amount, balance,
    date, rate, percentage and chart tick is tabular-nums.
  - Button matrix (§B.8, #157): one filled per decision region; tier 1 <Button severity="accent"
    rounded> for money movement only; tier 3 workflow commits; tier 4 neutral outlined utilities; tier 5
    text. Press = transform: scale(var(--btn-press-scale)), removed (transform: none) under BOTH
    @media (prefers-reduced-motion: reduce) AND :root[data-motion="reduced"]. Mirror every reduced-motion
    rule under both channels, rule for rule.
  - Contrast: text ≥ 4.5:1, non-text ≥ 3:1 in light, dark, and data-contrast="high"; --accent/--on-accent
    are fixed-polarity (§A.1.2). Focus rings are OFF app-wide by owner directive; do not add one.
  - Modals (§B.10.9): one wallet dialog at a time via the walletDialog signal; replace in place; never
    a second scrim; @projective/ui Dialog with a Signal `visible`; bottom sheet on mobile.
  - A control that renders must do something (§3.11). A new/changed ui component updates the
    DESIGN_SYSTEM.md §C.1 roster in the same change.
  Product
  - Every new simulatable axis gets its Dev Context Switcher control in the same change: DevOverrides +
    DEV_DEFAULTS, DevOption list, DevContextPanel control, reflect() set AND delete
    (apps/web/features/devtools/, seam apps/web/utils/dev-seam.ts).
  - No bespoke statuses; nothing hard-deleted (archive / active=false).
  - A NEW contradiction between source docs: do not pick a side. Add a decision row (newest
    documentation/reference/decisions/decisions-*.md + README index line) and ask me.

Verification: reproduce the defect first (a SQL probe under supabase/probes/ wrapped in a ROLLBACK
transaction, or a Deno unit test), then fix. After that run `deno task db:reset` (if SQL changed; tell
concurrent sessions first), `deno task check`, `deno task lint`, `deno task test:unit`, and `deno fmt`
on the files you touched only (never the whole tree). Four theme-engine.test.ts failures are
pre-existing (Decision #96(a)). Run supabase/probes/finance_invariants.sql (created in DB1) in every
SQL prompt's acceptance. For UI prompts also run `deno task dev`, sign in as the seeded personas
(documentation/database/Seed.md), and capture screenshots at 1440, 900 and 390 px in light, dark,
data-contrast="high" and data-motion="reduced".
Commit on the branch you were given with a clear message; do not open a PR unless I ask.
```

---

## 2. Phase 0 — Rulings

### F0 — Record Decision #251 and the factual doc corrections

```text
PROMPT F0: Decision #251 — finance audit flags, and the factual corrections

ROLE: Documentation steward. Docs only; no code.

FIRST: confirm #251 is still free. Check documentation/reference/decisions/README.md on main and on
every local branch (git for-each-ref refs/heads, git show <b>:…/README.md). If it is taken, use the
next free number and replace "#251" in FINANCE_AUDIT.md and this file.

FILES:
  - documentation/reference/decisions/<newest decisions-*.md> (append the row) + README.md (index line)
  - documentation/architecture/SYSTEM_ARCHITECTURE.md (:2378 key storage; :2801 reconciliation claim;
    :2864-2866 event list)
  - documentation/business/finance-model.md (:260 Fee Collection Account; :280 Custom/Express)
  - documentation/business/PRODUCT_SPEC.md (:3102 /wallet/create)
  - documentation/database/finance/Tables.md (:224 interval enum; :247 statement period; escrows
    columns; buyer_details; promo_codes)
  - documentation/design-system/DESIGN_SYSTEM.md (:1797 stale wallet-overlays.css cite)

SPEC: record FINANCE_AUDIT.md §4.6 flags (a)-(l) as one decision row, in the format of rows 240-250.
  Mark as FACTUAL CORRECTIONS and apply now: (b) delete /wallet/create from the spec route list; (d)
  Stripe keys follow the env contract (.env.local); (i) Express-only per #125; the Fee Collection
  wallet is not materialised (#187(b)); SA:2801 rewritten to name what IS reconciled (wallet vs
  ledger, fn_reconcile_wallets) and the Stripe-balance check marked "not built"; SA:2864 event list
  replaced by a link to HANDLED_STRIPE_EVENTS; (k) re-point the DESIGN_SYSTEM cite; Tables.md drift
  (FINANCE_AUDIT Z3, Z4).
  Leave OPEN for the owner, and list them as such: (a) is proposed and DB1 implements it unless the
  owner objects, because it is a security fix; (c) dispute freeze/clawback; (e) the earning gate
  breadth; (f) split enforcement at payout; (g) button tiers; (h) no /inspect for finance docs;
  (j) the income smoother; (l) the reserved-funds colour; (m) platform settlement currency; (n) the
  default currency source; (o) own-wallet conversion; (p) per-user promo caps; (q) the product-sale fee
  rate owner; (r) order refunds and cancellations.
  Also apply as FACTUAL CORRECTIONS: (s) the FX docs (inverse pairs are derived at read; SA:2579's
  fx-fixtures.ts is gone; fx_rates is read as anon). Leave (t) to DB7 / SV4, because those are code fixes
  that make the comments true.

ACCEPTANCE:
  - grep -rn "wallet/create" documentation/business/PRODUCT_SPEC.md → no hits.
  - grep -n "Custom/Express" documentation/ -r → no hits.
  - The row is indexed in README.md; no code files changed.
```

---

## 3. Phase 1 — Database RPCs, ledger gaps & webhook hardening

### DB1 — Close the recurring-rule and pot RLS hole (P0 security)

```text
PROMPT DB1: deposit_rules and wallet_pots are written through doors only

ROLE: Postgres security engineer. Audit A12, A4, A13 (door only); Decision #251 (a).

FILES:
  - supabase/migrations/00002013_policies_finance.sql ("Manage own deposit rules" :59-61,
    "Manage own wallet pots" :83-85)
  - supabase/migrations/00002520_permissions_table_grants.sql (revoke INSERT/UPDATE on both tables
    from authenticated)
  - supabase/migrations/00001830_triggers_finance.sql (trg_deposit_rules_immutable)
  - supabase/migrations/00001240_functions_finance_money_movement.sql (update_deposit_rule)
  - supabase/migrations/00002510_permissions_function_grants.sql (or the file that grants finance RPCs)
  - supabase/probes/deposit_rule_authority.sql (new), supabase/probes/finance_invariants.sql (new)
  - documentation/database/finance/{Policies,Functions}.md

SPEC:
  1. Reproduce: as a team member who holds `spend` but not `add_funds`, UPDATE another member's
     deposit_rules row's amount_cents. Today this succeeds. Write the probe so it asserts failure after
     the fix.
  2. Replace both FOR ALL policies with nothing (the SELECT policies stay). Revoke INSERT/UPDATE/DELETE
     from authenticated.
  3. trg_deposit_rules_immutable (BEFORE UPDATE): wallet_id, currency, source_method_id and interval
     never change. A change is a new rule.
  4. finance.update_deposit_rule(p_rule uuid, p_active boolean DEFAULT NULL, p_amount_cents bigint
     DEFAULT NULL, p_archive boolean DEFAULT false) RETURNS finance.deposit_rules. It is SECURITY
     DEFINER with search_path pinned and needs fn_has_vault_capability(wallet,'add_funds'). If
     p_amount_cents changes OR the caller is not created_by, it re-stamps created_by := auth.uid() and
     re-checks that the source method belongs to the caller. (The rule charges the AUTHOR'S card, so a
     changed amount needs the card owner's consent.) Archive sets active=false and
     archived_at (add the column to 00000017 in place if absent, Zod + docs in the same change). Never
     DELETE. Write a ledger_audit row.
  5. finance_invariants.sql: for every wallet, balance_cents = Σ signed ledger = latest
     balance_after_cents; Σ pots.balance_cents ≤ balance_cents; no pending_releases row in
     pending/on_hold has a matching credit. Exit non-zero on any violation.

ACCEPTANCE:
  - deposit_rule_authority.sql: spend-only member → 42501 on UPDATE; add_funds non-author changing
    the amount → succeeds AND created_by is now the caller; author pause → succeeds; immutable column
    change → refused.
  - finance_invariants.sql passes on the seeded DB.
  - Policies.md rows 99/102 rewritten (SELECT-only + door).
```

### DB2 — Webhook coverage: refunds, dispute updates, cancelled payouts, out-of-order disputes

```text
PROMPT DB2: Ledger every Stripe money event, in any delivery order

ROLE: Payments engineer (Postgres + Stripe). Audit H3, H4, E3.

FILES:
  - supabase/migrations/00001230_functions_finance_stripe.sql (record_dispute_opened :~1540,
    record_dispute_closed; new record_dispute_updated)
  - supabase/migrations/00001240_functions_finance_money_movement.sql (new record_charge_refunded;
    payout cancel handling beside the payout settlement door; the thaw at :97-101)
  - packages/types/finance/payments.ts (HANDLED_STRIPE_EVENTS :686-722)
  - packages/backend/services/finance/stripe-webhook.ts (planStripeEvent) + stripe-webhook.test.ts
  - packages/backend/services/finance/PaymentBackendService.ts (dispatch)
  - supabase/probes/stripe_event_order.sql (new)
  - documentation/database/finance/Functions.md; SYSTEM_ARCHITECTURE.md webhook section (link to the
    constant, not a restated list)

SPEC:
  1. charge.refunded → finance.record_charge_refunded(p_event_id, p_payment_intent, p_amount_refunded,
     p_refund_id). It claims 'stripe:<evt>' first. It handles partial refunds: the delta is
     amount_refunded minus what has already been ledgered for that PI. It debits the wallet the top-up
     credited, via fn_wallet_debit. If that would go negative, it records the shortfall on the payment
     row (mirror the chargeback unrecovered_cents pattern) and logs ops.log_entries. It never fails the
     webhook.
  2. charge.dispute.updated → record_dispute_updated sets chargebacks.status = 'under_review' (or
     the enum value that exists; if none exists, add it in place in 00000004 + Zod + docs) and
     changes no money.
  3. Out of order: when record_dispute_closed finds no chargeback, INSERT a resolved chargeback keyed on
     the Stripe dispute id. record_dispute_opened then sees it resolved and does not freeze.
  4. payout.canceled → the same path as payout.failed (credit back the withdrawn amount once,
     idempotent).
  5. Thaw collision (E3): when thawing disputed → held, if uq_escrows_ticket_base_held would conflict,
     leave the escrow `disputed`, set a resolution note, and write an ops.log_entries row for manual
     review. Never raise out of the webhook.
  6. Add the three events to HANDLED_STRIPE_EVENTS and planStripeEvent. Unit tests cover each plan.

ACCEPTANCE:
  - stripe_event_order.sql (ROLLBACK): closed-before-created leaves no escrow disputed; replaying any
    event twice changes nothing; a partial refund twice (5 then 8 cumulative) debits 5 then 3.
  - stripe-webhook.test.ts covers the new events; the fixture replay test stays green.
```

### DB3 — Capability and KYB gaps on the money doors

```text
PROMPT DB3: Enterprise KYB, inbound vault transfers, approval expiry, fee fallback

ROLE: Postgres engineer. Audit K4, V4, A16, S4, L9, V2.

FILES:
  - supabase/migrations/00001210_functions_finance_kyc_wallet.sql (fn_assert_business_spend :181-212;
    transfer_funds :~1940-1960; new fn_expire_spend_approvals; stale comment :1813)
  - supabase/migrations/00001240_functions_finance_money_movement.sql (begin_payout :335)
  - supabase/migrations/00001220_functions_finance_billing_entitlements.sql (fn_effective_platform_fee_bp :234)
  - supabase/migrations/00001200_functions_finance_core.sql (fn_release_ticket_escrow,
    fn_fair_exit_release → ask fn_escrow_has_open_dispute)
  - supabase/migrations/00001895_triggers_derived_columns.sql (owner_user_id backstop)
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (approval expiry job; idempotency-key sweep)
  - supabase/probes/finance_doors.sql (new)
  - documentation/database/finance/Functions.md; database/org/Functions.md (trigger)

SPEC:
  1. KYB: fn_assert_business_spend and begin_payout treat owner_type IN ('business','enterprise')
     alike. Use the enterprise's KYB row if one exists. If enterprise KYB has no table, STOP and ask me
     (🧑 DECISION). Do not invent a table.
  2. transfer_funds: if the destination wallet's owner_type is team/business/enterprise, require
     fn_has_vault_capability(dest,'add_funds') → PK403 'missing_permission: add_funds'.
  3. fn_expire_spend_approvals(): pending rows older than the spec's 7 days → 'expired' (the existing
     enum value). Add a pg_cron sql job (hourly) in 00005060.
  4. fn_effective_platform_fee_bp: a missing platform_fee_bp param RAISEs (PX500) instead of returning
     0. A silent 0 waives the platform fee.
  5. fn_release_ticket_escrow and fn_fair_exit_release refuse (PD409 'dispute_open') when
     fn_escrow_has_open_dispute is true. This makes F1260:41's comment true.
  6. AFTER UPDATE OF owner_user_id ON org.teams / org.business_profiles → fn_sync_vault_permissions.
  7. Idempotency sweep: a daily job deletes finance.idempotency_keys WHERE expires_at < now() - interval
     '30 days' AND scope <> 'stripe.webhook' (keep webhook keys for replay safety; document the choice).

ACCEPTANCE:
  - finance_doors.sql asserts each refusal and each allowed path. finance_invariants.sql still passes.
  - grep "silent no-op" supabase/migrations/00001210* → none.
```

### DB4 — Payout schedules run (or lock)

```text
PROMPT DB4: Scheduled payouts execute through begin_payout

ROLE: Payments engineer. Audit A14; FINANCE_AUDIT §4.5.

FILES:
  - supabase/migrations/00001240_functions_finance_money_movement.sql (fn_claim_due_payout_schedules)
  - supabase/migrations/00000017_tables_finance.sql (payout_schedules: next_run_at / last_run_at in
    place if absent)
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (http job on FINANCE_CRON_SECRET)
  - apps/web/routes/api/finance/cron/payouts.ts (new; constant-time bearer, 404 otherwise, mirroring
    cron/deposits.ts)
  - packages/backend/services/finance/payout-sweep.ts (+ test), PaymentBackendService.ts
  - packages/types/finance/* (schedule Zod), documentation/database/finance/*, PRODUCT_MANAGEMENT.md if a
    schedule lifecycle appears

SPEC:
  1. fn_claim_due_payout_schedules(p_limit int) → setof (schedule, wallet, amount). Claims with
     FOR UPDATE SKIP LOCKED: weekly/monthly when next_run_at ≤ now(); threshold when available ≥
     threshold. It advances next_run_at in the same tx. The amount is the available balance minus the
     wallet floor, and is skipped when ≤ 0 or below the minimum payout.
  2. The cron route calls the service, which calls the SAME begin_payout path as a manual withdraw
     (payout-ready, KYB, `withdraw` capability of the schedule's author, Stripe transfer idempotency
     key 'payout_schedule:<schedule>:<run_at>').
  3. A refusal (not payout-ready, card or account issues) records last_error and does not advance the
     failure into a loop. Three consecutive failures → active=false plus a notification (reuse the
     comms queue).
  4. Until this ships, the UI must not render a savable schedule (UI3 handles the lock copy).

ACCEPTANCE:
  - A unit test for the claim maths (weekly / monthly / threshold / floor / below minimum).
  - A probe: two concurrent claims never return the same schedule.
  - A cron route test: wrong bearer → 404.
```

### DB5 — Pots engine: tax auto-split, savings and goals

```text
PROMPT DB5: wallet_pots get a writer, a mover and the auto-allocation on matured income

ROLE: Ledger engineer. Audit A2, A3, A4, L7. Depends on DB1.

FILES:
  - supabase/migrations/00001240_functions_finance_money_movement.sql (fn_apply_pot_allocations;
    move_pot_funds; save_wallet_pot; the calls in fn_mature_pending_releases and in the zero-day
    branch of fn_wallet_credit_pending)
  - supabase/migrations/00000004_*enums*.sql (transaction reasons pot_allocation / pot_release in
    place, if reasons are an enum; otherwise the CHECK list in 00000017)
  - supabase/migrations/00003004_views_finance_integrations_analytics.sql (v_wallet_reconciliation
    includes pots)
  - supabase/migrations/00005001_*.sql (tax_pot_default_bp is read by save_wallet_pot's default)
  - packages/types/finance/methods.ts (WalletPotSchema), wallet.ts (save_pot / move_pot actions)
  - supabase/probes/wallet_pots.sql (new)
  - documentation/database/finance/*, documentation/business/finance-model.md §13

SPEC:
  1. Model: a pot is an EARMARK inside the wallet, not a second wallet. The wallet's balance_cents
     stays the total. Pot balances are a sub-ledger where Σ pots ≤ balance_cents, and "available to
     spend" = balance_cents − Σ pots. Write this model into finance-model.md §13. If the existing docs
     say pots are separate balances, STOP (🧑 DECISION) and present both models with this
     recommendation.
  2. fn_apply_pot_allocations(p_wallet, p_amount, p_reason, p_ref_table, p_ref_id): only for income
     reasons (escrow_release, team_split, team_finder_fee, fair_exit_release, product_sale). Each
     active pot with auto_allocate_bp > 0 receives floor(p_amount * bp / 10000), in pot created_at
     order. Dust stays unallocated. It writes a finance.pot_movements row per pot (new table in 00000017
     in place, append-only trigger like transactions). Zero-amount pots are skipped.
  3. Call it from fn_mature_pending_releases (on maturation, not on pending credit) and from
     fn_wallet_credit_pending's zero-day branch. Never call it from top-ups or transfers.
  4. save_wallet_pot(p_wallet, p_id NULL, p_kind, p_name, p_auto_allocate_bp, p_goal_cents): needs
     `distribute` (shared) or owner (personal). Σ auto_allocate_bp over the wallet's active pots ≤ 10000,
     checked under pg_advisory_xact_lock(hashtext('pots:'||wallet)). Archive with active=false, and only
     at balance 0.
  5. move_pot_funds(p_pot, p_amount, p_direction 'in'|'out'): 'in' needs available ≥ amount; 'out' needs
     pot balance ≥ amount. Same capability as save. It writes pot_movements.
  6. Spending paths (fn_wallet_debit callers that spend) must refuse to spend into earmarked money:
     add the check in ONE place, a finance.fn_available_cents(wallet) helper, used by fn_hold_ticket_escrow,
     begin_payout and transfer_funds. Do not change fn_wallet_debit's signature.

ACCEPTANCE:
  - wallet_pots.sql (ROLLBACK): 30% tax pot + 10% savings on a £1,000.01 matured release → 300.00 +
    100.00, 600.01 stays available; Σbp 10001 refused; spend into earmark refused; replaying maturation
    does not double-allocate.
  - finance_invariants.sql passes, including Σ pots ≤ balance.
```

### DB6 — 🧑 DECISION · Disputes inside the seven-day window

```text
PROMPT DB6: Freeze and claw back pending earnings on a dispute

ROLE: Ledger engineer. Audit W3, W4; Decision #251 (c); #126; #191(B3). Depends on DB2.

🧑 DECISION — STOP before changing money routing. Put this to me:
  Option A (recommended): a dispute flips the payee's matching pending_releases to on_hold
  (maturation skips them); a lost dispute recovers from those on_hold rows first, then from the payer
  as today; a won dispute returns them to pending with the original releases_at.
  Option B: freeze only (on_hold), keep today's payer-side recovery.
  Option C: no change; document that the window does not protect against chargebacks.

FILES (after the ruling):
  - supabase/migrations/00001230_functions_finance_stripe.sql (record_dispute_opened / closed)
  - supabase/migrations/00001240_functions_finance_money_movement.sql (fn_mature_pending_releases skips
    on_hold; recovery order :139-150)
  - supabase/probes/dispute_window.sql (new); packages/types/finance/{billing,disputes}.ts if shapes
    change; documentation/database/finance/*, finance-model.md:241, PRODUCT_MANAGEMENT.md (fund_state
    lifecycle), the decision row (ruling recorded)

ACCEPTANCE: the probe walks hold → release (pending) → dispute opened (on_hold, not matured at +8 days)
→ lost (recovered from on_hold first) and → won (back to pending, matures at the original time).
```

### DB7 — Checkout integrity: on-account amount, promo cap, charge assert, races (P0 security)

```text
PROMPT DB7: The database charges exactly what checkout showed, once, and never mints balance

ROLE: Postgres payments engineer. Audit CO20, CO6, CO4, CO10, CO11, CO13, CO18, CO7 (record only);
#251 (t). Out of scope: the business approval gate (BUSINESSES_AUDIT BF20/BF24).

FILES:
  - supabase/migrations/00001250_functions_finance_auto_fund_billing.sql (place_on_account_order :474-556)
  - supabase/migrations/00001210_functions_finance_kyc_wallet.sql (place_wallet_order :~1280-1850:
    idempotency :1290, basket lock :1300, own-listing :1524/:1575, promo :1620-1640 and :1845, v_net :1653,
    status :1698)
  - supabase/migrations/00001230_functions_finance_stripe.sql (begin_card_payment / attach_checkout_order)
  - supabase/migrations/00000017_tables_finance.sql (orders.promo_code; T17:833 comment)
  - supabase/migrations/00002510_permissions_function_grants.sql (:867 signature change)
  - packages/types/finance/order.ts; packages/backend/services/finance/CheckoutBackendService.ts call
    sites ONLY to pass the new parameter (logic belongs to SV4)
  - supabase/probes/{on_account_amount,promo_redemption_concurrency,checkout_charge_assert}.sql (new)
  - documentation/database/finance/{Functions,Tables}.md; PRODUCT_MANAGEMENT.md (order status writers)

SPEC:
  1. Reproduce CO20 first: as a business spender, call finance.place_on_account_order directly with
     p_amount = 10× the basket net. Today the surplus stays in the business wallet. The probe asserts
     that it does not after the fix.
  2. place_on_account_order: drop p_amount from the signature (and the grant). Compute the order net
     in SQL by calling the same pricing the order uses: factor place_wallet_order's pricing block into
     finance.fn_basket_net(p_basket, p_item_ids, p_units, p_promo) and use it in both. Credit exactly
     that, then place the order. As a backstop, assert that the order's charged amount equals the credit,
     otherwise RAISE (the whole call rolls back). Write the order as status='invoiced' with
     payment_method_label 'On account'.
  3. Promo cap: redeem atomically with UPDATE finance.promo_codes SET redemption_count = redemption_count
     + 1 WHERE id = … AND (max_redemptions IS NULL OR redemption_count < max_redemptions) RETURNING. When
     no row comes back, RAISE PC409 'promo_exhausted'. Read the promo FOR UPDATE. Record orders.promo_code.
  4. Charge assert: place_wallet_order gains p_expected_minor bigint. RAISE PC409 'price_changed' when it
     differs from v_net. On the card path, the webhook places the order with the PaymentIntent amount as
     p_expected_minor, so a mismatch becomes settled_unapplied (the #200 path) and never silently drains
     the existing balance.
  5. Same-key race: repeat the idempotency_key lookup after the basket FOR UPDATE, and replay when it
     is found.
  6. Two tabs: begin_card_payment refuses (PC409 'payment_in_progress') when an inbound payment in
     requires_payment / processing already covers any of the same basket items. The refusal returns the
     existing payment's client secret, so the second tab can resume rather than charge twice.
  7. Own listing: refuse when the buyer is an active member of the listing's owner_team_id, and add the
     same check for cohort seats.
  8. Order status writers: 'invoiced' (on account, step 2) is now written. Remove awaiting_payment from
     the enum comment's justification if no path will ever write it. Do NOT drop the enum value
     (edit-in-place rule; ask me if you think it should go).

ACCEPTANCE:
  - on_account_amount.sql: no surplus; an inflated direct call is impossible (signature gone).
  - promo_redemption_concurrency.sql: two sessions (dblink or two probes with advisory sync) on a
    max_redemptions = 1 code → exactly one order succeeds.
  - checkout_charge_assert.sql: an expected amount 1p off → PC409; the correct amount → order.
  - finance_invariants.sql passes.
```

### DB8 — Currency integrity: exponents, CHECKs, per-currency thresholds, FX snapshot

```text
PROMPT DB8: Every currency column is a real ISO code; every threshold is in the right currency

ROLE: Postgres engineer. Audit C10 (SQL side), C14, C15, C7, C16; #251 (s).

FILES:
  - supabase/migrations/00000017_tables_finance.sql (CHECK on wallets, transactions, escrows, invoices,
    payouts; the fx_* columns :77-79, :125-127)
  - supabase/migrations/00000015_tables_projects.sql (:84), 00000011_tables_org.sql
    (business_profiles.default_currency)
  - supabase/migrations/00001240_functions_finance_money_movement.sql (fn_minor_units_text :197-210)
  - supabase/migrations/00001200_functions_finance_core.sql (new finance.fn_currency_exponent(text))
  - supabase/migrations/00005001_seed_platform_params.sql (:66, :74) and the readers in 00001250 (:536,
    :561) and wherever vault_approval_threshold_cents is read
  - supabase/probes/currency_integrity.sql (new)
  - documentation/database/finance/Tables.md, finance-model.md §11/§15

SPEC:
  1. CHECK (currency ~ '^[A-Z]{3}$') on every unconstrained currency column (C14), edited into the
     CREATE TABLE in place. The seeds must still load. Fix any seed that violates the check.
  2. finance.fn_currency_exponent(p_ccy) IMMUTABLE returns 0/2/3 from ONE list. The list must be the
     same as packages/types/finance CURRENCY_EXPONENTS (SV5 adds a contract test that diffs the two).
     fn_minor_units_text uses it (3-decimal currencies correct, ISK 0).
  3. on_account_limit_cents and vault_approval_threshold_cents become JSON maps by currency, shaped
     like min_withdrawal_minor. Readers take the map[currency] value. A currency missing from the map
     REFUSES (PF402 'limit_not_configured'); it never falls back to a flat number.
  4. FX snapshot columns (C7): no function writes them and no money is converted. Unless #251 (o) ruled
     for conversion, delete them from the CREATE TABLE in place, and delete the "captured at commit"
     claims from finance-model §11, SA:2790 and Tables.md:84-86. This edits finance.escrows: ASK ME
     FIRST (root CLAUDE.md §1 forbids dropping escrow columns without permission). If I refuse, leave
     them and document them as reserved.
  5. Base currency: code reads platform_params.base_currency. If a DB read is impossible on a code path,
     the TS constant is pinned to it by a contract test.

ACCEPTANCE: currency_integrity.sql inserts 'usd', 'US', 'EURO' → 23514; KWD 1234 formats as 1.234;
JPY 1234 formats as 1,234; an on-account order in INR uses the INR limit.
```

### DB9 — 🧑 DECISION · Settlement currency, default currency, stranded balances

```text
PROMPT DB9: Which Stripe balance pays a USD payout, and where an entity's currency comes from

ROLE: Payments architect. Audit C17, C1, C4; Decision #251 (m), (n), (o).

🧑 DECISION — STOP. Before changing anything, check the platform Stripe account's settlement
currencies in test mode (read-only: stripe balance retrieve via the CLI or API with the test key). Then
put these to me with the evidence:
  (m) Option A (recommended): per-currency settlement. Enable a bank account/balance per supported
      currency so that charges in X settle in X and Transfers in X draw from X. Restrict DISPLAY/listing
      currencies to those that have one. Option B: a single GBP settlement with FX at payout; the payee
      sees the converted amount and the spread before confirming. Option C: status quo plus a
      reconciliation alert when a Transfer fails for insufficient currency balance.
  (n) Recommended: an entity's currency comes from its owner's country (one map in
      packages/types/finance/countries.ts). Never from the display preference. Projects default to the
      owner's currency, not 'USD'.
  (o) Recommended for now: no conversion. The spec states that balances are per currency and can be
      withdrawn per currency. The wallet shows every non-zero currency, never hides one.

FILES (after the ruling): supabase/migrations/00001020_functions_org_entities.sql (:1146-1171),
00000015 (:84 default), F1230/F1210 COALESCE(…,'USD') sites, packages/types/finance/countries.ts,
packages/backend/services/finance/stripe-rails.ts (:180-200, :381-385), finance-model.md §9/§11,
PRODUCT_SPEC.md (currency paragraph), the decision row.

ACCEPTANCE: per ruling. At minimum, a probe shows that a new team created by a user whose country maps
to EUR gets an EUR wallet, whatever their display currency.
```

---

## 4. Phase 2 — Fat services & thin route controllers

### SV1 — Zod SSOT drift and the page query schema

```text
PROMPT SV1: Bring packages/types/finance back to zero drift with the tables

ROLE: Types engineer. Audit Z1, Z2, Z5, R3.

FILES:
  - packages/types/finance/ledger.ts (EscrowSchema :100-126), billing.ts (ChargebackSchema :116),
    methods.ts (WalletPotSchema), spend-gate.ts, wallet.ts (WalletPageQuerySchema)
  - packages/types/finance/*.contract.test.ts (new: finance-tables.contract.test.ts)
  - supabase/migrations/00000017_tables_finance.sql (CHECKs for pot name ≤ 120 and approval reason
    ≤ 2000, in place)
  - packages/backend/services/finance/* mappers that read these rows

SPEC:
  1. EscrowSchema: payerBusinessId nullable; add payerUserId, releasedAt, autoFunded; status =
     z.enum(<finance.escrow_status values>). ChargebackSchema: add unrecoveredCents.
  2. A contract test parses a column list per table (a static snapshot generated from the migration
     text by a small parser in the test; do not connect to a DB) and fails when a column has no Zod
     key or a Zod key has no column (an explicit allowlist covers derived fields).
  3. WalletPageQuerySchema: w (scope:id), flow (7d|1m|3m|6m|1y|5y|all), display, tz, do
     (INTENT_ACTIONS), back (safeBack rules), q, dir, kind. Parsing returns {value, corrected:boolean}
     so the route can replaceState or redirect to the canonical query.

ACCEPTANCE: the contract test is green and lists zero allowlisted drift beyond derived fields; deno task check.
```

### SV2 — `WalletBackendService` honesty: scope, approvals, smoother, statements

```text
PROMPT SV2: The wallet read says what is true: resolved scope, decidable approvals, per-currency reads

ROLE: Backend engineer. Audit R5, V6, A7, A4, R10, R11.

FILES:
  - packages/backend/services/finance/wallet-scope.ts (:112-120, :220-224)
  - packages/backend/services/finance/live-wallet.ts (:352-376 actionsFor; :498-527 smoother/pots;
    :1602-1605; :1748 hasPdf)
  - packages/backend/services/finance/WalletBackendService.ts
  - packages/types/finance/wallet.ts (SpendApprovalView.decidable, StatementRow.pdfHref, BillRow.pdfHref,
    WalletContext.requested/resolved)
  - apps/web/routes/(dashboard)/wallet/{index,transactions,analytics,invoices}.tsx (use
    WalletPageQuerySchema; 303 on scope mismatch)
  - apps/web/routes/api/finance/{statements,invoices}/[id]/*.ts (z.uuid() instead of UUID_RE)
  - unit tests beside each service file

SPEC:
  1. resolveWalletContext returns {requested, resolved}. When they differ, every wallet page answers
     303 to the same path with w=<resolved> and with do and back removed, plus
     notice=wallet-unavailable (FINANCE_AUDIT §4.3).
  2. SpendApprovalView.decidable = the viewer holds approve_spend on the wallet AND is not the
     requester. This is computed server-side from the same capability set the door uses.
  3. Income smoother: read per wallet currency (filter currency = wallet.currency). Pots: ordered by
     created_at, filtered by currency, all of them (not the first tax pot).
  4. Statements and bills: project pdfHref from the existing /api/finance/{statements,invoices}/[id]/pdf
     routes when the PDF is producible; delete the hasPdf stub.
  5. Every refusal from the PDF routes is JSON {code, message} with the right status. The island
     (UI2) fetches and saves it.

ACCEPTANCE: unit tests for the scope mismatch (303 + stripped do), decidable (approver / distribute-only
/ requester), a two-currency smoother, and pdfHref presence.
```

### SV3 — Actions: recurring controls, pots, payout-schedule lock

```text
PROMPT SV3: Wallet actions for recurring rules and pots; schedule modes locked until DB4 ships

ROLE: Backend engineer. Audit A13, A3, A14. Depends on DB1 and DB5 (and DB4 for the unlock).

FILES:
  - packages/types/finance/wallet.ts (WalletAction union :1338-1348; request schemas)
  - packages/backend/services/finance/wallet-actions.ts, live-wallet.ts (actionsFor), wallet-home model
  - apps/web/routes/api/wallet/action.ts (Zod only; no new route)
  - apps/web/features/wallet/core/wallet-home.ts (:286-303 Upcoming rows get an action)
  - tests beside each

SPEC:
  1. New actions: pause_recurring · resume_recurring · edit_recurring (amount) · archive_recurring →
     finance.update_deposit_rule. save_pot · move_pot → DB5 doors. Each is offered by actionsFor only
     when the viewer holds the door's capability. An environment block shows locked with a reason
     (the existing LockedDialog path), never absent-but-needed.
  2. set_payout with a scheduled mode: until DB4 has merged, actionsFor offers it as LOCKED with reason
     code 'schedule_not_running' (copy in UI3). After DB4, unlock it.
  3. enrol_smoother: LOCKED with 'smoother_not_running' until #251 (j) is ruled and an engine exists
     (FINANCE_AUDIT §4.5). Existing enrolments stay readable.

ACCEPTANCE: wallet-actions tests per action; actionsFor tests for capability holder / non-holder / locked.
```

### SV4 — Checkout service: blockers before charges, the right comparison, tests and axes

```text
PROMPT SV4: CheckoutBackendService refuses before Stripe is touched

ROLE: Backend engineer. Audit CO8, C8, CO4, CO15, CO29, CO30. Depends on DB7.

FILES:
  - packages/backend/services/finance/CheckoutBackendService.ts (blockersFor :198-340; create :680-880,
    the comparison :758-777, card path :836-871)
  - packages/backend/services/finance/live-basket.ts (resolvePromo :1200)
  - packages/backend/services/finance/CheckoutBackendService.test.ts (new), checkout-refusal.ts (+ test)
  - apps/web/features/checkout/core/basket-state.ts (:279-292; do not resetAttempt() on PC409
    payment_in_progress / replay)
  - supabase/migrations/00005060_seed_scheduled_jobs.sql + apps/web/routes/api/finance/cron/checkout.ts
    (stale-payment sweep)
  - apps/web/features/devtools/*, apps/web/utils/dev-seam.ts (checkoutPayment axis)

SPEC:
  1. A promo with any ticket/revision/seat/session line → the blocker 'promo_not_applicable', raised in
     resolvePromo AND blockersFor, before createCheckoutCardPayment. The buyer never sees a discount the
     database will refuse.
  2. The commit compares the LISTING-currency charge (charge.minor) with the client's expected amount.
     The display/converted total is never part of the price check (C8). Pass p_expected_minor to every
     order door.
  3. Map the new PC409 codes (promo_exhausted, price_changed, payment_in_progress) in checkout-refusal.ts
     with buyer copy. On payment_in_progress, resume the returned client secret.
  4. Sweep: an hourly job cancels inbound payments stuck in requires_payment for more than 24h (cancel the
     PaymentIntent with an idempotency key, then mark the row cancelled). Use a constant-time bearer and
     404 otherwise, mirroring cron/deposits.ts. The abandoned-basket reminder (PRODUCT_SPEC:1128) is a
     separate comms job: build it only if the comms queue has a template slot; otherwise log it under
     #251 and leave it.
  5. Dev Context Switcher: checkoutPayment (ok · declined · authenticate · timeout · unapplied ·
     price_changed · promo_exhausted), applied in the service under the dev seam. Include DevOverrides +
     DEV_DEFAULTS, DevOption list, DevContextPanel control, and reflect() set AND delete.

ACCEPTANCE: CheckoutBackendService.test.ts covers price_changed, promo mismatch, promo on escrow lines
(no Stripe call made, asserted with a spy), prior-key replay, card-id ownership and the display-vs-listing
comparison with a moved rate.
```

### SV5 — Currency honesty: one exponent SSOT, estimates marked, nothing dropped

```text
PROMPT SV5: Every converted figure says it is an estimate; no currency silently disappears

ROLE: Backend + types engineer. Audit C10, C13, C6, C9, C12, C20, C11. Depends on DB8.

FILES:
  - packages/types/finance/wallet.ts (:1362-1407 exponents, formatMoney), common.ts (:27 currency),
    fx.ts (:35, :259-306)
  - packages/ui/display/core/currency-store.ts (:99-122) + DESIGN_SYSTEM.md §C.1 note if its API changes
  - packages/types/finance/currency.contract.test.ts (new: TS list == UI list == the SQL list parsed from
    00001200's fn_currency_exponent)
  - packages/backend/services/finance/{FxService.ts (:118, :162-171), commerce-money.ts (:96-184),
    wallet-scope.ts (:265-300), live-wallet.ts (:137-139, :483, :805, :809, :1732), stripe-rails.ts}
  - packages/types/finance/wallet.ts view types (an Aggregate {minor, currency, estimated, asOf, excluded[]})

SPEC:
  1. One CURRENCY_EXPONENTS (a superset of the UI's 24 codes). The UI store imports it (packages/ui may
     depend on @projective/types; check packages/ui/CLAUDE.md, and if it may not, mirror it and let the
     contract test pin the mirror).
  2. Aggregates (hero total, available, analytics sums) return {estimated: true when any currency was
     converted, asOf: the oldest rate used, excluded: currencies with no rate}. Never drop a currency
     silently. Never sum mixed currencies without estimated=true.
  3. FxService: carry stale and provider to every converted figure. Read the newest rate per quote
     (DISTINCT ON), not .limit(500).
  4. commerce-money: format in the viewer's locale (from the request's resolved locale), show every
     origin's rate, at 4 significant figures, not 4 dp.
  5. stripe-rails: amounts in 3-decimal currencies are rounded to a multiple of 10 before sending, and
     ISK/UGX follow Stripe's 2-decimal API rule. Encode both in one toStripeAmount(minor, ccy) with tests.
     Refuse listing currencies Stripe cannot charge (catalogue.ts:147 narrows to a SUPPORTED list).

ACCEPTANCE: the contract test is green; unit tests for aggregates with an unconvertible currency (it
appears in excluded and the hero total says so), for the NGN rate label, and for toStripeAmount (KWD,
JPY, ISK, GBP).
```

---

## 5. Phase 3 — Islands & design-system alignment

### UI1 — Wallet stylesheet gates: high contrast, static-ground contrast, solid tints, motion parity

```text
PROMPT UI1: wallet/styles pass every §3 gate, aurora exception included

ROLE: Design-system engineer (CSS). Audit D1, D2, D3, D4, D6, D8, D9, D11, D21-D23, D25.

FILES: apps/web/features/wallet/styles/*.css; apps/web/features/wallet/core/aurora-*.ts only if the HC
static switch belongs there; a new apps/web/features/wallet/core/wallet-contrast.test.ts;
documentation/design-system/DESIGN_SYSTEM.md (Wallet exception paragraph: HC + static-ground rule).

SPEC:
  1. High contrast (D1): a :root[data-contrast="high"] block in wallet-tokens.css with opaque
     --wlt-hero-ink-soft, a stronger --wlt-glass-edge and opaque glass fills, and the aurora forced to
     the static ground (data-aurora="static").
  2. Static ground (D2): adjust the CSS gradient stops, or add a deep content-band scrim on a
     ::before, so that hero ink ≥ 4.5:1 at every stop under the pill and top row, in light and dark. The
     test computes the contrast of --wlt-hero-ink over each declared stop (parse the token values; use
     the same luminance maths as packages/ui theme tests) and fails under 4.5.
  3. D3: --wlt-fund-reserved moves to a ramp role (the violet/--help family) with dark and HC values,
     unless #251 (l) ruled otherwise.
  4. D4: @supports not (backdrop-filter) fallbacks for .wlt-pill and the corner tools.
  5. D6/D8: every tint is an opaque color-mix against the region tone, or the §B.4.2 *-tint tokens. No
     `transparent` operand anywhere outside the licensed glass veils.
  6. D9: no opacity on text-bearing elements; dim marks only.
  7. D11: every prefers-reduced-motion rule has a :root[data-motion="reduced"] twin, including
     wallet-dialogs.css and wallet-flow.css.
  8. Tidy D21-D23, D25.

ACCEPTANCE:
  - grep -n "transparent)" apps/web/features/wallet/styles/ → only inside the licensed glass blocks
    (list them in the commit message).
  - grep -c "prefers-reduced-motion" equals grep -c 'data-motion="reduced"' per sheet.
  - The contrast test is green; screenshots of the hero in light/dark/HC/reduced at 390 and 1440.
```

### UI2 — WalletHome & dialogs: honest gates, PDFs, tiers, focus

```text
PROMPT UI2: The island acts on what the server decided

ROLE: Frontend engineer (Preact signals). Audit V6, R5, R10, R11, D16-D19, D24, M2. Depends on SV2.

FILES:
  - apps/web/features/wallet/islands/WalletHome.island.tsx (:337 useEffect; :349-360 intent; :441 canDecide)
  - apps/web/features/wallet/components/{WalletDialogs,InvoicesPanel,LedgerRow,LedgerFilters,UpcomingList}.tsx
  - packages/ui/fields/Button (href mode) + DESIGN_SYSTEM.md §C.1 if added
  - tests: apps/web/features/wallet/core/wallet-home.test.ts, wallet-intent.test.ts

SPEC:
  1. Review renders iff approval.decidable (no client capability maths).
  2. On load, if the server reports corrected or mismatched query values, replaceState to the canonical
     query (do not reload).
  3. InvoicesPanel: a tier-5 "PDF" row action per statement or bill with pdfHref. Receipts and PDFs
     download through fetch → saveBlob (as CSV export does), and a refusal shows the InlineNotice
     copy, never raw JSON.
  4. Tiers: CSV and Show N more → tier 4 neutral outlined. Save card and Approve → tier 1 accent
     rounded unless #251 (g) ruled otherwise. Back to checkout → Button href (add the mode to
     packages/ui if absent, with its §C.1 row).
  5. Dialogs opened from ?do= or a Stripe return focus the dialog's heading (Dialog initialFocus) and
     return focus to the hero pill for that action on close.
  6. Replace the useEffect signal mirror with a computed / effect().

ACCEPTANCE: unit tests for the decidable render and the canonical-query replace; screenshots of
/wallet/invoices with PDF actions; a forced 403 PDF shows the notice.
```

### UI3 — Recurring rules, pots and locked automation in the wallet

```text
PROMPT UI3: Upcoming rows act; pots become real; schedules and smoother say why they are locked

ROLE: Frontend engineer. Audit A13, A3, D7, A14, A6. Depends on SV3.

FILES: apps/web/features/wallet/components/{UpcomingList,AccountRail,WalletDialogs}.tsx,
core/{wallet-home,wallet-state}.ts, styles/{wallet-accounts,wallet-dialogs}.css, devtools (axis below).

SPEC:
  1. Each recurring row in Upcoming gets an ActionMenu (tier 5): Pause/Resume · Change amount ·
     Remove. Every item exists only when it is offered. Change amount opens ConfigDialog in place
     (replace, never stack). Copy states that the rule charges the editor's own card after the
     change (DB1 re-stamp).
  2. Pots: the tax-pot tile becomes a link that opens a Pots dialog (list, allocation %, balance,
     goal progress via ProgressBar; Save pot tier 3; Move funds tier 1 accent rounded, because it
     moves money). The rail shows "Available · Earmarked" as MetaLine text with tabular-nums. The
     static pot box is gone (D7).
  3. Locked automation: scheduled payout modes and smoother enrolment open LockedDialog with the
     reason copy from SV3. There is no savable control.
  4. Dev Context Switcher: add walletVerification (unverified · pending · verified-not-ready · ready)
     and walletProcessor (up · down), applied to the viewer in resolveWalletContext under the dev
     seam. Include DevOverrides + DEV_DEFAULTS, DevOption list, DevContextPanel control, and reflect()
     set AND delete.

ACCEPTANCE: each axis value renders the matching lock or no lock; screenshots of the Pots dialog at
390 (bottom sheet) and 1440; only one filled button per dialog footer.
```

### UI4 — Ledger, analytics & charts: tabular, accessible, shape-coded

```text
PROMPT UI4: Every figure tabular, every series distinguishable without colour

ROLE: Frontend + data-viz engineer. Audit D12-D15, D20, D26; FINANCE_AUDIT §4.4 (#251 (h)).

FILES: apps/web/features/wallet/components/{LedgerRow,AnalyticsView,CashFlow,FlowAreaChart}.tsx,
styles/{wallet-ledger,wallet-analytics,wallet-flow,wallet-meter,wallet-sheet}.css; packages/ui
display/charts only if the AreaChart ticks lack tabular-nums (then fix there + §C.1 note).

SPEC:
  1. The ledger status uses Tag severity (lifecycle, allowed); method/category/counterparty are MetaLine.
  2. tabular-nums on .wlt-chart__when, ledger dates, the FX rate, hero meta and every SVG tick (<text>
     gets font-variant-numeric via a class).
  3. Release-schedule pips get the meter's hatch/ring shape channel; legends name the encoding.
  4. Viewer locale replaces en-GB; wlt-section__count holding a label becomes a meta span.
  5. Allocation term ring: remove it (rings-off directive) unless the owner keeps the exception.
  6. .wlt-textlink ink: verify ≥ 4.5:1 in light mode at --text-sm; otherwise use the link token.
  7. ONLY if #251 (h) ruled in favour: a tier-5 "Expand" on the cash-flow chart and the ledger opens one
     Dialog (replace in place) hosting the same AreaChart / DataTable full-width, with no /inspect
     hand-off. Otherwise build nothing.

ACCEPTANCE: a Playwright evaluate shows every element whose text matches /\d/ inside .wlt-* has
tabular-nums; axe-core shows zero serious issues on /wallet/analytics.
```

### UI5 — Checkout & wallet surfaces show estimates; checkout button tiers and solid fills

```text
PROMPT UI5: Converted money reads as an estimate; checkout passes the button and tone gates

ROLE: Frontend engineer. Audit D27-D30, C13/C6 (render side); #251 (g). Depends on SV5. Check
git status first: peers edit apps/web/features/checkout/** (Decision #243 work).

FILES:
  - apps/web/features/checkout/components/PromoField.tsx (:97), AddPaymentMethod (:228-240),
    styles/basket-body.css (:378, :811), the order summary / settlement line components
  - apps/web/features/wallet/components/{WalletHero,AccountRail,AnalyticsView}.tsx (aggregate display)
  - packages/ui display/MoneyView (or the MoneyView in use) for the estimate mark + §C.1 row

SPEC:
  1. A figure with estimated=true renders "≈" before it and a MetaLine "at rates from <date>"
     (tabular-nums); `excluded` renders "Excludes JPY · KRW" as Meta text, never a chip.
  2. PromoField Apply → tier 4 neutral outlined. Save card in checkout and in the wallet follow ONE
     #251 (g) ruling: the same tier in both places.
  3. .bsk-row[data-flagged] and the media placeholder → solid ramp tones / opaque tints.
  4. Mobile: confirm on a 390 px screenshot that the price and Pay are moved, never duplicated
     (§3.10), and record the result in the commit message.

ACCEPTANCE: screenshots of the checkout summary with a converted line and of the wallet hero with an
excluded currency, at 390 and 1440, light/dark/high contrast.
```

---

## 6. Phase 4 — Playwright E2E & visual regression

### E1 — Money lifecycle E2E: hold → pending (7 days) → available → payout

```text
PROMPT E1: apps/web/tests/e2e/wallet.spec.ts — the full transaction lifecycle

ROLE: QA engineer. Uses the existing harness (deno.json "test:e2e"; apps/web/tests/e2e/catalogue.spec.ts
is the pattern: npm:playwright-core, Chromium from E2E_CHROMIUM or the Playwright cache, waitUntil
"commit", hydration retries). Do NOT run `playwright install`.

FILES:
  - apps/web/tests/e2e/wallet.spec.ts (new), apps/web/tests/e2e/_finance-fixtures.ts (new; service-role
    helpers that run ONLY when SUPABASE_URL is localhost/127.0.0.1, and refuse otherwise)
  - deno.json (test:e2e:wallet task with its $comment, mirroring test:e2e)
  - .claude/launch.json only if a dedicated port config is needed (name it web-wallet-e2e)

SPEC (seeded personas per documentation/database/Seed.md; client = payer, payout-ready freelancer =
payee):
  1. Hold: the client funds a stage from their wallet (UI path: Fund → MoveDialog fund_escrow, tier-1
     commit). Assert that the client's available balance dropped by exactly the amount and that an escrow
     is held (read via /api/wallet/overview, not the DB).
  2. Release: approve the ticket/stage as the client. Assert that the freelancer's wallet shows the
     credit as Pending with a release date 7 days out (the UI's Upcoming row and the ledger row status
     Tag), and that the net is amount − floor(amount × 500 / 10000).
  3. Mature: the fixture backdates THAT pending_releases row's releases_at to now() − 1 minute and
     calls finance.fn_mature_pending_releases() (service role, local only). Reload; assert Available
     rose and Pending fell by the same amount; if DB5 merged, assert pot allocations.
  4. Payout: withdraw as the freelancer through the hero Withdraw pill (MoveDialog withdraw).
     Stripe: use test mode only (sk_test_ keys from .env.local; the harness refuses a live key). Assert
     the payout row is pending and the ledger shows the debit; then deliver a signed test
     payout.paid event to /api/finance/webhooks/stripe (sign with the local whsec via
     stripe.webhooks.generateTestHeaderString) and assert the status settles. Replay the same event
     and assert nothing changes (idempotency).
  5. Negative paths: an unready freelancer sees the verification lock (walletVerification axis); a
     ?w= foreign scope 303s with notice; a spend-only team member never sees Review.
  6. Checkout: buy a product with a capped promo from two browser contexts at once and assert that
     exactly one order exists (DB7); try a promo on a basket with a ticket line and assert the refusal
     appears before any PaymentIntent exists (SV4; check via the payments read, not Stripe); open card
     pay in two tabs and assert the second resumes the first payment (one charge).
  7. Currency: as a user holding GBP + JPY wallets with display currency USD, assert that the hero total
     carries the "≈" estimate mark and that JPY is never silently missing (SV5/UI5).
  8. Clean-up: everything runs inside data the fixture creates (a fresh stage on a seeded project). Say
     in the header that the suite writes to the shared local DB and must not run during a peer's
     db:reset.

ACCEPTANCE: `deno task test:e2e:wallet` passes twice in a row on a fresh db:reset.
```

### E2 — Visual regression matrix: aurora hero, sheets, modal stack

```text
PROMPT E2: Wallet snapshot matrix across devices, themes, contrast and motion

ROLE: QA engineer. Depends on UI1-UI4 and E1's harness.

FILES: apps/web/tests/e2e/wallet-visual.spec.ts (new); baselines under
apps/web/tests/e2e/__snapshots__/wallet/ (committed PNGs; keep each < 300 KB); deno.json task
test:e2e:wallet-visual.

SPEC:
  1. Matrix: viewports 1440×900 (desktop), 900×1200 (tablet), 390×844 (mobile; sheet) × theme light/dark
     × contrast normal/high (documentElement data-contrast="high") × motion normal/reduced
     (data-motion="reduced" + emulateMedia reducedMotion). Pages: /wallet, /wallet/transactions,
     /wallet/analytics, /wallet/invoices.
  2. Determinism: freeze the aurora (set data-aurora="static" via the walletAurora dev axis), freeze
     Date via page.clock, mask live figures that come from now() with a locator mask, and wait for
     document.fonts.ready.
  3. Modal states: open each dialog kind (Locked, Move top_up, Config recurring, AddCard stubbed
     without Stripe Elements, Line, Approval) and snapshot it. Then replace one dialog with another
     and assert exactly ONE element matches the Dialog scrim selector (zero stacked scrims, §B.10.9)
     and that focus is inside the new dialog.
  4. Gate assertions per page (not snapshots): ≤ 1 filled button per [data-region] (tier-1 + tier-2
     pair allowed); no computed backdrop-filter outside the licensed selectors list; no region
     background with alpha < 1 outside the hero; every element containing a digit has tabular-nums;
     hero ink contrast ≥ 4.5:1 sampled from computed colours over the static ground; :active transform
     is a scale and is `none` under reduced motion; axe-core zero serious/critical; inputs ≥ 16px at 390.
  5. Threshold: maxDiffPixelRatio 0.002; the update flag documented in the spec header.

ACCEPTANCE: the matrix runs green; the suite fails if you temporarily revert UI1's HC block (verify,
then restore).
```

---

## 7. Last — Docs

### Z1 — Finance docs sweep and audit status

```text
PROMPT Z1: Finance documentation sweep

ROLE: Documentation steward. Runs after every prompt above has merged.

FILES: documentation/database/finance/*, business/finance-model.md, business/PRODUCT_SPEC.md (Wallet,
Funding, Payouts), PRODUCT_MANAGEMENT.md (fund_state, deposit rule, payout schedule, pot lifecycles),
architecture/SYSTEM_ARCHITECTURE.md (Stripe + reconciliation), architecture/ROUTING.md (wallet scope
303), design-system/DESIGN_SYSTEM.md (§C.1 roster; Wallet exception HC rule),
architecture/FINANCE_AUDIT.md (add a Status column: Fixed by <prompt> / Open), the #251 decision row
(mark each flag resolved with its ruling or prompt).

SPEC: rollup, not restatement (documentation/CLAUDE.md rule 2). Every #251 flag ends Resolved or Open
with an owner.

ACCEPTANCE: every function and trigger named in DB1-DB9 appears in documentation/database/finance/*;
the FINANCE_AUDIT status column has no blank cells.
```
