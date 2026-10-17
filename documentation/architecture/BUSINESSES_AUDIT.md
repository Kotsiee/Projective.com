# Businesses Surfaces Audit — `/businesses` and `/businesses/:businessHandle` (2026-10-16)

> Read-only evaluation of the Businesses roster, the business console and a business's public
> `/:handle` against `PRODUCT_SPEC.md`, `finance-model.md`, `PRODUCT_MANAGEMENT.md`,
> `SYSTEM_ARCHITECTURE.md`, `ROUTING.md` and `DESIGN_SYSTEM.md`. No code was changed. New conflicts
> are logged as **Decision #229** (flags for a human; root `CLAUDE.md` §8). The Teams owner
> rulings are **#228** ([`TEAMS_BUILD_PROMPTS.md`](TEAMS_BUILD_PROMPTS.md) T0).
>
> Teams and Businesses share ONE implementation (`WorkspaceKind`, Decision #61). Every shared UI
> defect in [`TEAMS_AUDIT.md`](TEAMS_AUDIT.md) §2 (D1–D41) applies here too and is **not repeated**;
> this document logs only what is business-specific, plus where the business case makes a shared
> defect worse. Finding IDs here are prefixed `BF` (functional), `BD` (design), `BX` (decisions).
>
> Abbreviations: **F1020** = `supabase/migrations/00001020_functions_org_entities.sql` ·
> **F1200** = `…/00001200_*` · **F1210** = `…/00001210_functions_finance_kyc_wallet.sql` ·
> **F1250** = `…/00001250_*` · **wsp/** = `apps/web/features/workspaces/`.

## 0. Headline

The business console looks complete but its **governance is mostly decorative**. The capabilities that
define a buyer entity — `purchase` and `hire` — are checked nowhere; the spend-approval queue can
approve a request that nothing ever redeems; KYB and the approval threshold guard the basket but not
the escrow-funding doors; and the KYB link every screen points to lands on a "Not built yet"
placeholder. The persona gate is inverted: the app offers *Create Business* only to freelancers,
while a business is by definition a buyer.

## 0.1 Premise corrections and model facts

| Assumption a reader might hold | Actual (source) |
| :-- | :-- |
| A business is seller-side | **Buyer-side**: "a Business is a Client with multiple members" (#61, `decisions-057-063.md:264-266`). `packages/types/org/enterprises.ts:6` still says "seller-side" — stale. |
| Roles mirror teams | `owner · admin · member` — **no `lead`** (`ck_business_member_role`, `00000011_tables_org.sql:373-417`). PRODUCT_SPEC:678-682 names Owner/Admin · Project Manager · Observer (BX-b). |
| Business has a seat cap | `fn_assert_seat` returns early for business (F1020:1199-1213). A `business_managers` entitlement (2 → 15) is seeded but unread (BX-b). |
| Business and Enterprise are one thing | Two tables, two verification models, no FK link yet; #61 flag (b) undecided. Out of scope here except where it leaks. |
| Console URL `/business/[business id]` | `/businesses/:businessHandle` (`ROUTING.md:102`); `PRODUCT_SPEC.md:2950-2957` is stale. |

---

## 1. Functional Audit Matrix

Legend: ✅ compliant · ⚠️ partial / drift · ❌ missing · 📄 doc conflict · 🧑 needs ruling

### 1.1 Identity, persona, lifecycle

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| BF1 | Draft-first create (name + `@handle`) | `create_workspace('business', …)` → `status='draft'` (F1020:950-1038) | ✅ |
| BF2 | Who may create | DB: any adult (`fn_assert_adult`, F1020:979), `businesses_owned` entitlement (:994-1001), **no persona check**. App: Create Business only when `isFreelancer` (`actions-model.ts:46-47`, doc :30 calls it "seller surface"). PRODUCT_SPEC:657-660 says *Operator Mode*. #16/#18 say `isFreelancer`. #61(a) open. | ❌ 📄 🧑 BX-a |
| BF3 | Nav entry | `showBusinesses = caps.businessAccountEnabled \|\| isBusinessCtx` where `caps` is a **hard-coded fixture** `{ businessAccountEnabled: true }` (`nav-fixtures.ts:121-126`) — everyone sees Businesses | ❌ |
| BF4 | Acting-as-business context flags | Access-token hook stamps `isClient = is_operator OR NOT is_freelancer` for a business context (`00001700:157-166`): a freelancer acting as a business is `isClient=false` though the business is a buyer | ❌ |
| BF5 | Minors | DB trigger + create/accept asserts; `/businesses` in `restricted-surfaces.ts:10` | ✅ |
| BF6 | Publish / archive / restore | `set_workspace_status`; archive needs `archive_entity` (owner only) | ✅ (restore target 📄 #226 c) |
| BF7 | Archive blockers | Only held escrow with `payer_business_id` (F1020:1087-1094). **Not checked:** active/on-hold projects with `client_business_id`, pending `spend_approvals`, unpaid/overdue `finance.invoices`, on-account debt, positive wallet balance, pending payouts, auto-fund queue, deposit rules | ❌ |
| BF8 | Draft / archived business used as buyer | `projects.create_project` checks only membership (`00001100:141-150`), never `business_profiles.status`; money RPCs never check it | ❌ |
| BF9 | Visibility (unlisted) | **No `visibility` column** on `org.business_profiles`; the directory view hard-codes `true as listed` for every active business (`00003001…:180,206-211`) | ❌ 🧑 BX-h |
| BF10 | `treasury_wallet_id` link | Teams only; business wallet found by `(owner_type, owner_id, currency)` (F1020:1027 vs :1015-1017) | ⚠️ acceptable, document |

### 1.2 Roles and capabilities

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| BF11 | Presets owner · admin · member, no lead | CHECKs + `fn_member_role_sync`; custom roles base admin/member | ✅ |
| BF12 | Spec roles Project Manager / Observer | Not modelled; `business_managers` entitlement counts "PMs / Observers" | 📄 🧑 BX-b |
| BF13 | `purchase` gates buying | **Never checked** in SQL or TS (whole-tree grep) | ❌ |
| BF14 | `hire` gates hiring | **Never checked in SQL**; only gates the Talent module view. Hiring/assigning/reviewing uses `projects.can_review_project` = owner OR **any active business member** (`00001100:927-940`; `assign_ticket_manual` / `assign_parallel_stream` `00001140:467-489`; `assign_from_application` `00001130:1404-1405`) — a `member`-preset seat can hire and approve work that releases escrow | ❌ |
| BF15 | `manage_projects` gates project creation for a business | Not checked by `create_project` | ❌ |
| BF16 | Member preset = contribute + analytics | Yes (`common.ts:202`, F1020:518-520) | ✅ |

### 1.3 Money: wallet, spend governance, KYB

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| BF17 | Spend policy writer | `finance.save_spend_policy` (F1210:2106-2221): `manage_finances`, rank/self/owner/grant-what-you-hold checks, vault re-sync | ✅ |
| BF18 | Request approval | `request_spend_approval` (F1210:2228-2294): needs vault `spend`, genuine need, 7-day expiry, notifies approvers | ✅ |
| BF19 | Threshold fallback consistent | `request_spend_approval` and `place_wallet_order` use `COALESCE(threshold, 0)` — **ignore** the platform `vault_approval_threshold_cents` fallback that `fn_auto_fund_drain` honours (F1250:226-227) | ❌ |
| BF20 | **Approved request is redeemable** | `decide_spend_approval` only drains auto-fund on approval (F1210:1958-1960). `place_wallet_order` refuses ≥ threshold **unconditionally** (F1210:1454) and never reads `spend_approvals`; the app files requests with `p_ref_table: null, p_ref_id: null` (`wallet-actions.ts:420-436`); checkout links "needs approval" to `/businesses/{slug}/spend` (`live-buyer.ts:526-532`) where nothing can be redeemed | ✅ DB + API (BB4: ref-bound, single-use, `finance.fn_redeem_spend_approval`; checkout refusal carries `approvalRef`) · 🧩 checkout request dialog is BP2 |
| BF21 | Envelope + threshold + KYB on **every** spend door | Basket (`place_wallet_order`) ✅ all three. `transfer_funds` ✅ envelope + KYB, no threshold. **`fund_stage`, `fund_ticket`, `fund_paid_revision`, card `escrow_lock`, claim-lock holds** — envelope of the **project owner** (not the actor, F1200:432, :616), **no threshold, no KYB** (`finance/Functions.md:245-246` admits it) | ❌ |
| BF22 | No double counting | A basket ticket line counts against the caller's envelope in `place_wallet_order` and again against the project owner's in `fn_hold_ticket_escrow` (`fn_check_spending_limit` increments `spent_cents`, F1200:262) | ❌ |
| BF23 | Who can fund a business project | `has_project_access` admits a business only via a `project_participants` row whose business **owner** is the caller (`00001100:661-745`): a member holding `spend` cannot fund; yet every member passes `can_review_project` (BF14) — the authorities are inverted | ❌ |
| BF24 | Pool short | `place_wallet_order` raises PF402; #61 flag (d) undecided (fail / prompt to contribute / charge personal); PRODUCT_SPEC:1262-1264 forbids a personal card for a business purchase | 🧑 BX-c |
| BF25 | Contribution ledger complete | Reads `ledger_audit WHERE action='add_funds'`, written only by `transfer_funds` — **card top-ups never appear** (`live-money.ts:356-358`) | ✅ card top-ups write `add_funds` at settlement (BB6, Decision #238) |
| BF26 | Withdrawals | `begin_payout`: vault `withdraw` (owner preset only), KYB, verified payout account | ✅ |
| BF27 | KYB start | `record_payout_account('business')` needs `manage_billing` (owner only); `sync_payout_account` sets `kyb_status` | ✅ backend |
| BF28 | KYB UI | Verification module is a `ModulePlaceholder` with **no action**, yet every "Finish KYB" / "Verify {name}" link targets it (`ModuleScreen.tsx:160-168`; `VerificationLock.tsx`; `BillingScreen:296`; `WorkspaceLane:768`) — a **dead-end loop** (§3.11) | ❌ |
| BF29 | `manage_billing` vs module gate | Every billing write needs `manage_billing` (owner only), but the Billing module is gated on `manage_finances` (admins see it, cannot act); Verification gated on `manage_settings` though KYB start needs `manage_billing` | ✅ Billing and Verification gated on `manage_billing`, owner-grantable to a named admin (BB6, #238) |
| BF30 | Spend module gate | Gated on `spend_funds`; editing needs `manage_finances`, deciding needs `approve_spend` — an approver-only role cannot reach the queue; a `member` without `spend_funds` cannot open the screen but RLS lets it read every member's limits and requests (`00002013:90-105`) | ✅ Spend opens on spend · manage finances · approve spend; envelopes read by their owner or `fn_reads_wallet_envelopes` (BB6) |

### 1.4 Billing, plans, entitlements

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| BF31 | Monthly consolidated invoice | `fn_generate_consolidated_invoice`, daily `fn_run_billing_cycle`, `pay_invoice` from the wallet; tax stubbed 0 (#172 a) | ✅ (flags #172 a–h open) |
| BF32 | Pay invoice | Wallet debit only (#172 e); no confirm step in UI | ⚠️ |
| BF33 | Intervaled invoicing Pro-gated | `intervaled_invoicing` entitlement seeded, **never read**; `set_invoicing_terms` checks KYB + `manage_billing` only | 📄 🧑 BX-e |
| BF34 | Spending caps Pro-gated (`pooled_wallet_full`) | Seeded, never read | 📄 🧑 BX-e |
| BF35 | `business_managers` cap | Seeded 2/15, never enforced | ❌ 🧑 BX-b |
| BF36 | `businesses_owned` | Enforced (1 free / 3 pro); finance-model:57 says Pro spins up 5 | 📄 BX-f |
| BF37 | Business plan purchase | **No subscription writer** — `business_pro` price TBD, no upgrade path | ❌ (out of MVP scope) |

### 1.5 Console read, RLS, routing

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| BF38 | RLS on `org.business_profiles` | RLS enabled, **zero policies** → clients denied; all reads through definers / `profiles_index` | ✅ by design — document it |
| BF39 | RLS on members / roles | SELECT-only for active members (+ admin on roster; roles policy lacks the `is_admin()` arm) | ✅ roles policy gained the `is_admin()` arm (BB6) |
| BF40 | uuid → handle | 303 (should be 308, as Teams #228 B) | ❌ |
| BF41 | `/businesses/x/overview` | Renders — a duplicate URL of `/businesses/x` (not canonicalised) | ❌ |
| BF42 | Missing / forbidden | Silent 303 → `/businesses`; from `[module]` it is **two hops** (`/businesses/<ref>` → `/businesses`) | ❌ |
| BF43 | Talent module | Registry entry (gate `hire`, "the bench — freelancers and teams this business works with") falls to `ModulePlaceholder` "Not built yet"; no doc defines Talent | ✅ the bench — `org.get_business_bench` + the Talent screen (BU5, Decision #241) |
| BF44 | Team wallets accept spend requests | `request_spend_approval` accepts team wallets, but teams never hold `approve_spend` — only the owner can decide | ✅ business wallets only (BB4) |

### 1.6 Public `/:handle` (buyer profile)

| # | Rule | Status |
| :-- | :-- | :-- |
| BF45 | Buyer cannot be hired: Message primary, Follow secondary (PRODUCT_SPEC:517-521) | verify in BP1 |
| BF46 | "Corporate verified" crest on KYB (PRODUCT_SPEC:2330-2334); Client Trust Score, **no Standing** (:2326-2328) | verify in BP1 |
| BF47 | Editors = `edit_profile` (owner + admin) vs PRODUCT_SPEC:591 "a business's owner" | 📄 (twin of #226 b) |
| BF48 | Unlisted businesses | Impossible today (BF9) | ❌ |

---

## 2. Visual & Design-System Defect Log (business-specific)

Shared defects D1–D41 (`TEAMS_AUDIT.md` §2) apply verbatim and are fixed by Teams W1/L1/L2/R1–R3.
Severity: **G** gate · **M** matrix/parity · **T** tidy · **B** functional bug in UI.

### 2.1 Spend policy screen (`SpendPolicyScreen.island.tsx`, `SpendLimitRow.tsx`, `ApprovalQueue.tsx`)

| ID | Sev | Defect | Fix |
| :-- | :-- | :-- | :-- |
| BD1 | B | Header promises "Who may put money in" but there is **no approver or contributor editor**; `approverIds`/`contributorIds` are posted back unchanged (:133-134); `.wsp-spend__approvers` is dead CSS | Build both editors (member multi-select with rank rules) — the RPC already accepts them |
| BD2 | B | Draft ceilings render against server figures: `PolicyAmount value={limit.limit ?? limit.spent}` (`SpendLimitRow:319`) shows **spent as the ceiling** for a previously unlimited member, and ":306 of  used" blanks | Server preview of the draft envelope, or the payout split's `stale` marker; never show spent as a ceiling |
| BD3 | B | Meters not refreshed after an approval (`decide()` only updates `policy`, :187); comment claims decisions don't touch envelopes | Re-read limits from the decision response |
| BD4 | B | Approval history hidden unless something is pending (:223); `ApprovalQueue` empty state unreachable | Always render the section; empty state + "Decided" sub-view |
| BD5 | B | Unverified approver sees requester copy "Waiting for a decision" (`canApprove && verified`, :234) | Separate `canApprove` from `verified`; show the KYB notice to the approver |
| BD6 | G | "Unlimited" chip renders beside "Spending is off" (:312, :318); "Per purchase" chip **hides the amount** (:325) | MetaLine: `Spending off` · or `€500 / month · €100 per purchase` (tabular) |
| BD7 | G | Tooltips on non-focusable spans (:318-326; SpendPolicyScreen :318-323) | Put the text in Meta, or make the trigger a focusable control |
| BD8 | M | N filled Approve buttons once D30 is fixed literally | One tier-3 Approve on the first pending row, others tier 4; Decline tier 5 |
| BD9 | T | `<div class="wsp-spend__limits">` contains `<li>` (:282) | `<ul>` |
| BD10 | T | Threshold `min={0}` while 0 is invalid (:261, :70); double label (`<label>` + `aria-label`) | `min={1}` (or minor-unit min), FormControl only |
| BD11 | B | "Give a member approve-spend" warning has no link (:272-277) | Tier-4 link to Roles / the approver editor (BD1) |
| BD12 | B | `accessHref="/wallet/access"` lands in the **personal** wallet (308 drops the business `?w=`) | `walletHrefFor("business", id, "access")` |
| BD13 | T | `.wsp-approvals__who` 600, `gap: 2px`, `block-size: 6px` meter, `opacity: .68` dimming, literal `500` | W1 token sweep covers; ensure money.css business sections included |

### 2.2 Billing (`BillingScreen.island.tsx`)

| ID | Sev | Defect | Fix |
| :-- | :-- | :-- | :-- |
| BD14 | G | Tier-1 Pay renders **per invoice** → N amber fills in one region; no confirmation before moving money | One "Pay €X" for the oldest due invoice (or "Pay all due"), others tier 5 "Pay" opening the same confirm; a review step (ConfirmDialog is blocked for accent per #157 o — use the wallet `MoveDialog` review pattern) |
| BD15 | B | Pay gated on `canEdit` only (ignores KYB and `manage_billing`) | Gate on server capabilities from the detail |
| BD16 | M | Below-floor warning is a bare `<p>` | `InlineNotice severity="warning"` with a tier-1 "Top up" that starts the wallet MoveDialog (the act that starts a financial flow = tier 1) |
| BD17 | T | Hand-rolled labels (:279,305,322,338); hard-coded "Issued on the 1st" (:245) though `billing_day` is 1–28; empty `<span />` spacer (:259); band meta not tabular | FormControl; derive copy from `billing_day`; layout via grid; tabular |

### 2.3 Console branches, roster, create

| ID | Sev | Defect | Fix |
| :-- | :-- | :-- | :-- |
| BD18 | B | Overview money band requires `manage_finances \|\| spend_funds \|\| withdraw_funds` (:75-76) while Finance opens on `contribute_funds` → a member can open Finance but sees no money on Overview | One `canSeeMoney(kind, caps)` helper in `workspace-model.ts` shared by registry and Overview |
| BD19 | B | `FinanceSummary` `canOpen` never passed (:260) → link always shows; Available figure duplicated (:69-80 vs first tile) | Pass `canOpen`; drop the duplicate |
| BD20 | B | MemberCard "Ceiling set" without amount or link (:778); MemberDrawer "edited on the spend policy" with no link (:359-366) | Show the envelope MetaLine + tier-5 link to Spend |
| BD21 | T | Create modal kind radio is **unreachable** (`showKindChoice` always false; single mount `WorkspaceRoster:419`) and paints `--secondary` with a translucent mix (`roster.css:824-826`) | Delete the radio and its CSS |
| BD22 | G | Business kind tint: `--wsp-business-edge` translucent (`tokens.css:83-88`); high-contrast widens `tint`/`edge` but **not `tint-hi`/`ink`** (:305-306); comments call it "the ACCENT tint" (amber is accent) | Opaque edge; HC values for all four; fix comments |
| BD23 | G | `--wsp-business` = `--secondary`, which is also the **focus-ring colour** (`theme-engine.ts:203-213`): a ring on a business-tinted mark is invisible against it | Business marks use `--tertiary` (the CVD anchor already used at :334-338) or the ring gets the inverse-surface halo on business surfaces — 🧑 BX-j |
| BD24 | M | Roster table money column header is the stats label "Spent (30d)" from the first card; only the largest currency is shown; `delta` always null | Explicit column def; multi-currency MetaLine; drop the delta slot until it has data |
| BD25 | T | `PolicyAmount` literal 600 at every size (`tokens.css:401-416`) | `--fw-medium` (figures are not headings; weight is the money register's) |
| BD26 | B | Talent and Verification render "Not built yet"; Verification shows "is verified" **and** "Not built yet" when verified; `ModulePlaceholder.tsx:15` still lists Billing as next; `VerificationLock` hard-codes "two working days" | Build Verification (BU4); Talent per BX-i; correct stale copy |

---

## 3. Component Refactoring Plan (business-specific)

The shared migration plan is `TEAMS_AUDIT.md` §3.1 and its prompts (U1–U4, W1, L1–L2, R1–R3 in
`TEAMS_BUILD_PROMPTS.md`). Business additions:

| File | Migrate / add | Pri |
| :-- | :-- | :-- |
| `islands/SpendPolicyScreen.island.tsx` | `FormControl` + `MoneyInput` (threshold) · approver/contributor editor with `Listbox` or a `DataTable` with selection (BD1) · `InlineNotice` · tier-3/4/5 matrix · `useSignalEffect` | P0 |
| `components/SpendLimitRow.tsx` | `ProgressBar` (meter) · `MetaLine` (BD6) · `MoneyInput` for ceilings inside `FormControl` · `ToggleSwitch` for can-spend · `<ul>` (BD9) | P0 |
| `components/ApprovalQueue.tsx` | `Button` tiers (BD8) · rows on hairlines (no tinted boxes) · Pending · Decided via `TabMenu` | P0 |
| `islands/BillingScreen.island.tsx` | One tier-1 Pay + review dialog (BD14) · `InlineNotice` (BD16) · `FormControl` | P0 |
| `components/ContributionLedger.tsx` | `DataTable` (date · member · method · amount tabular); include card top-ups (BF25) | P1 |
| `components/ModuleScreen.tsx` | `verification` → new `BusinessVerificationScreen` island; `talent` per BX-i | P0 |
| `components/VerificationLock.tsx` | Link to the real Verification module; drop hard-coded SLA copy | P1 |
| `components/FinanceSummary.tsx`, `islands/WorkspaceOverview.island.tsx` | shared `canSeeMoney` (BD18-19) | P1 |
| `components/MemberCard.tsx`, `islands/MemberDrawer.island.tsx` | envelope MetaLine + link (BD20) | P1 |
| `islands/CreateWorkspaceModal.island.tsx` | delete kind radio (BD21) | P2 |
| `styles/workspace-tokens.css` | business tint opaque + HC (BD22); hue per BX-j (BD23) | P0 |
| `apps/web/features/shell/core/{actions-model,nav-model,nav-fixtures}.ts` | persona predicate per BX-a; replace the capabilities fixture with the session's real `has_business` / membership facts (BF3) | P0 |

**`packages/ui` additions** beyond the Teams set: none required. Reuse `MoneyInput`, `Listbox`,
`ProgressBar`, `DataTable`, `MetaLine` (Teams U1). A **review step for tier-1 commits outside the
wallet** (BD14) should reuse the wallet `MoveDialog` review pattern; if it cannot be reused from
`apps/web/features/wallet/`, promote its review body to `@projective/ui/feedback` as
`CommitReview` — decide in BU3.

---

## 4. Strategic Architecture Decisions

### 4.1 Persona and context

- **Recommendation for BX-a:** any **adult** account may create and join a business. A freelancer is
  a superset of a client (PRODUCT_SPEC:1341-1342) and may own a business while selling elsewhere
  (:684-691). Drop the `isFreelancer` gate in `actions-model.ts`; retire the stale "Operator Mode"
  sentence (PRODUCT_SPEC:657-660) and the #16/#18 seller-surface wording for Business. No DB change
  beyond what exists (adult + entitlement).
- **Context truth:** acting as a business must stamp `isClient = true` in the access-token hook
  regardless of the person's freelancer status (BF4) — a business context is buyer-side by
  definition. Seller surfaces in a business context are already hidden by #61.
- **Nav truth:** replace the `ACCOUNT_CAPABILITIES` fixture with real session facts (owns or belongs
  to a business; has the `businesses_owned` entitlement) — the fixture shows Businesses to everyone.

### 4.2 Authority model: one capability per act

| Act | Required (proposed) | Today |
| :-- | :-- | :-- |
| Create a project billed to the business | `manage_projects` | any member |
| Buy (basket / services / products) as the business | `purchase` + vault `spend` + envelope + threshold + KYB | vault `spend` + envelope + threshold + KYB |
| Hire / assign / accept an application | `hire` | any member (`can_review_project`) |
| Review / accept a submission (releases escrow) | `hire` **or** being the project's owner | any member |
| Fund escrow (stage / ticket / revision / card lock) | vault `spend` + the **actor's** envelope + threshold-or-approval + KYB | project owner's envelope; no threshold; no KYB |
| Decide a spend approval | vault `approve_spend`, not the requester | ✅ |
| Billing writes, KYB start | `manage_billing` (owner) — and the modules gated on it | modules gated on `manage_finances` / `manage_settings` (BX-d) |

Implementation: a single `projects.fn_business_actor_can(p_project, p_capability)` helper (owner of
the project OR `fn_member_can('business', client_business_id, cap)`), used by `can_review_project`'s
write callers, the assign/accept doors and `create_project`. Funding doors stop leaning on
`has_project_access` (a broad read predicate granted to `anon` too — do not widen it) and call a
dedicated `projects.fn_can_fund_project(p_project)` = project owner OR a business member holding
vault `spend` on the paying wallet. One spend gate `finance.fn_assert_business_spend(wallet, actor,
amount, ref)` applies envelope (actor's, counted **once** at the earliest door) + threshold (with the
platform fallback) + approval redemption + KYB, and every door calls it.

### 4.3 Approval redemption (BF20)

- A request binds to what it approves: `ref_table`/`ref_id` become required (`basket` → the basket
  id, `tickets` / `project_stages` / `invoices` → the row), plus `amount_cents` and `currency`.
- `fn_assert_business_spend` passes the threshold when an `approved`, unexpired, **unconsumed**
  approval exists for the same `(wallet, ref, amount ≥ charge)`; it sets `consumed_at` (a new column
  on `finance.spend_approvals`, edited in place) in the same transaction. One approval, one spend.
- Checkout's "needs approval" opens a request dialog bound to the basket, not a link to `/spend`.

### 4.4 Lifecycle guards

- **Only an `active` business transacts:** create project, buy, fund, hire, pay invoice all refuse a
  `draft` or `archived` business (`55000 business_not_active`).
- **Archive blockers:** held escrow (exists) + live projects (`active`/`on_hold`) + pending approvals
  + unpaid/overdue invoices + on-account balance owed + wallet balance > 0 (must withdraw or transfer
  first) + pending payouts. Each surfaces as a typed code so Settings can list them before the
  confirm (Teams C6 pattern).
- **Visibility (BX-h):** add `visibility` to `org.business_profiles` (edit `00000011` in place;
  values as teams) and read it in the directory view instead of `true as listed`.

### 4.5 Routing

Same contract as Teams #228 (B): uuid/case → **308**; module the viewer may not open → 303;
`/:handle/overview` → 308 to the root; missing/forbidden → ONE 303 to `/businesses?notice=unavailable`.

---

## 5. Prioritised backlog

| Pri | Item | Area |
| :-- | :-- | :-- |
| P0 | BF13-BF15, BF23 authority model (`purchase`, `hire`, `manage_projects`, funders) | DB |
| P0 | BF21-BF22 one spend gate on every door (actor envelope once, threshold + fallback, KYB) | DB |
| P0 | BF20 approval redemption | DB + API + UI |
| P0 | BF8 active-only transacting; BF7 archive blockers | DB |
| P0 | BF2-BF4 persona (per BX-a), context flag, real nav facts | DB hook + app |
| P0 | BF28 Verification module (KYB start, status) — removes the dead-end loop | UI + API |
| P0 | BD1-BD6, BD14-BD16 spend & billing bugs | UI |
| P1 | BF29-BF30 module gates aligned with write capabilities | app |
| P1 | BF19 threshold fallback; BF25 ledger completeness; BF44 team-wallet requests | DB |
| P1 | BF40-BF42 routing | app |
| P1 | BD18-BD24 console branches, tint, roster table | UI |
| P2 | BF9 visibility; BF33-BF35 entitlement reads (per BX-e/b); BF39 roles admin arm | DB |
| P2 | BF43 Talent (per BX-i); BD21, BD25-BD26 tidy | UI |
| Out | BF37 business plan purchase (price TBD); #61 (b) Enterprises overlap | — |
