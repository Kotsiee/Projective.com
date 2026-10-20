# Businesses Surfaces Audit — `/businesses` and `/businesses/:businessHandle` (2026-10-16)

> Read-only evaluation of the Businesses roster, the business console and a business's public
> `/:handle` against `PRODUCT_SPEC.md`, `finance-model.md`, `PRODUCT_MANAGEMENT.md`,
> `SYSTEM_ARCHITECTURE.md`, `ROUTING.md` and `DESIGN_SYSTEM.md`. No code was changed. New conflicts
> are logged as **Decision #229** (flags for a human; root `CLAUDE.md` §8). Every #229 flag was
> RULED by **#230** (2026-10-16) and built by BZ0 and the BB / BU / BP series (#236–#249); each
> row's Status says what remains. The Teams owner rulings are **#228**
> ([`TEAMS_BUILD_PROMPTS.md`](TEAMS_BUILD_PROMPTS.md) T0).
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

**Status (BZ1, 2026-10-19):** each defect named above is fixed — `purchase` and `hire` gate their
doors (BB2), an approval is redeemed once against what it approves (BB4 + BP2), one spend gate with
KYB and the threshold guards the funding doors (BB3), Verification is a real screen (BU4) and any
adult may create a business (BB1). What remains is marked ⚠️ or ❌ in the Status columns below.

## 0.1 Premise corrections and model facts

| Assumption a reader might hold | Actual (source) |
| :-- | :-- |
| A business is seller-side | **Buyer-side**: "a Business is a Client with multiple members" (#61, `decisions-057-063.md:264-266`). `packages/types/org/enterprises.ts:6` said "seller-side" — stale; corrected by BZ0 (#230). |
| Roles mirror teams | `owner · admin · member` — **no `lead`** (`ck_business_member_role`, `00000011_tables_org.sql:373-417`). PRODUCT_SPEC:678-682 names Owner/Admin · Project Manager · Observer (BX-b — RULED #230 (b): templates, built by BU7, #249). |
| Business has a seat cap | `fn_assert_seat` returns early for business (F1020:1199-1213). A `business_managers` entitlement (2 → 15) was seeded but unread (BX-b) — enforced since BB7 (#230 (b)), shown by BU7 (#249). |
| Business and Enterprise are one thing | Two tables, two verification models, no FK link yet; #61 flag (b) undecided. Out of scope here except where it leaks. |
| Console URL `/business/[business id]` | `/businesses/:businessHandle` (`ROUTING.md:102`); `PRODUCT_SPEC.md:2950-2957` was stale — corrected by BZ0 (#230); the stale route is quoted verbatim here (#230 FLAGGED (a)). |

---

## 1. Functional Audit Matrix

Legend (audit, 2026-10-16): ✅ compliant · ⚠️ partial / drift · ❌ missing · 📄 doc conflict · 🧑 needs
ruling. Status (BZ1, 2026-10-19): ✅ Fixed by <prompt> (#N) · ✅ Compliant — no change (or by design,
or extended by <prompt>) · ⚠️ partly — <what remains> (#N flag) · ❌ Open — <owner or follow-up>.
Every 🧑 BX question (Decision #229's flags) was RULED by #230 on 2026-10-16: (a) built by BB1 ·
(b) BB7 + BU7 · (c) BP2 · (d) BB6 (#238) · (e) BB7 · (f) BZ0 · (h) BB5 · (i) BU5 · (j) BU1. There is
no BX-g. Line references in the Implementation and Defect cells date from the audit (2026-10-16).

### 1.1 Identity, persona, lifecycle

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| BF1 | Draft-first create (name + `@handle`) | `create_workspace('business', …)` → `status='draft'` (F1020:950-1038) | ✅ Compliant — no change |
| BF2 | Who may create | DB: any adult (`fn_assert_adult`, F1020:979), `businesses_owned` entitlement (:994-1001), **no persona check**. App: Create Business only when `isFreelancer` (`actions-model.ts:46-47`, doc :30 calls it "seller surface"). PRODUCT_SPEC:657-660 says *Operator Mode*. #16/#18 say `isFreelancer`. #61(a) open. | ✅ Fixed by BB1 (#230 (a)) — any adult account, operators included: `canCreateBusiness` (`account-facts.ts`) gates Create Business and the nav entry; PRODUCT_SPEC's Operator Mode gate is retired; #16 / #17 / #18 are marked resolved |
| BF3 | Nav entry | `showBusinesses = caps.businessAccountEnabled \|\| isBusinessCtx` where `caps` is a **hard-coded fixture** `{ businessAccountEnabled: true }` (`nav-fixtures.ts:121-126`) — everyone sees Businesses | ✅ Fixed by BB1 (#230 (a)) — the nav reads the token's `belongsToBusiness` / `businessHeadroom` facts; the fixture is the `dev:mock` fallback only |
| BF4 | Acting-as-business context flags | Access-token hook stamps `isClient = is_operator OR NOT is_freelancer` for a business context (`00001700:157-166`): a freelancer acting as a business is `isClient=false` though the business is a buyer | ✅ Fixed by BB1 (#230 (a)) — a business context stamps `isClient = true`, `isFreelancer = false` whoever acts in it (probe `business_context_flags.sql`) |
| BF5 | Minors | DB trigger + create/accept asserts; `/businesses` in `restricted-surfaces.ts:10` | ✅ Compliant — no change (BB1's `canCreateBusiness` also refuses a restricted account) |
| BF6 | Publish / archive / restore | `set_workspace_status`; archive needs `archive_entity` (owner only) | ✅ Compliant; the restore target was Fixed by Teams C6 (#261, ruled #236 (d) 2026-10-17) — `org.fn_workspace_restore_target` returns a business to `active` if it was ever published, else `draft` |
| BF7 | Archive blockers | Only held escrow with `payer_business_id` (F1020:1087-1094). **Not checked:** active/on-hold projects with `client_business_id`, pending `spend_approvals`, unpaid/overdue `finance.invoices`, on-account debt, positive wallet balance, pending payouts, auto-fund queue, deposit rules | ⚠️ partly — every blocker is refused and read (`get_workspace_detail.archive_blockers`): Fixed by BB5 (#236 (B)); recurring deposits pause once archived (#248 (k)); no business screen lists the blockers before the press — the header band withholds Archive while one stands, and a business's Settings is still a placeholder (#244 flag (d), #261 flag (c)) |
| BF8 | Draft / archived business used as buyer | `projects.create_project` checks only membership (`00001100:141-150`), never `business_profiles.status`; money RPCs never check it | ✅ Fixed by BB5 (#236 (A)) + #248 (k) — only an `active` business creates projects, buys, funds, hires or pays an invoice (`55000 business_not_active`); an archived business takes no money in, a draft still does (#236 (f), narrowed by #248 (k) RULED 2026-10-18) |
| BF9 | Visibility (unlisted) | **No `visibility` column** on `org.business_profiles`; the directory view hard-codes `true as listed` for every active business (`00003001…:180,206-211`) | ⚠️ partly — `org.business_profiles.visibility` and the `org.profiles_index` read: Fixed by BB5 (#236 (C), ruled #230 (h)); open: `search.sync_business_to_index` still indexes draft and invite-only businesses (#236 flag (b), #244 flag (g)), and no business screen sets visibility (Settings placeholder, #244 flag (d)) |
| BF10 | `treasury_wallet_id` link | Teams only; business wallet found by `(owner_type, owner_id, currency)` (F1020:1178 vs :1166-1168) | ✅ Compliant by design — one wallet per currency (`uq_wallet_owner_currency`), the first inserted by `create_workspace`, the rest by `fn_ensure_wallet`; documented in `database/org/Tables.md` §`org.business_profiles` (BZ1, #299) |

### 1.2 Roles and capabilities

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| BF11 | Presets owner · admin · member, no lead | CHECKs + `fn_member_role_sync`; custom roles base admin/member | ✅ Compliant — no change (BU7, #249: no `lead` anywhere in a business console) |
| BF12 | Spec roles Project Manager / Observer | Not modelled; `business_managers` entitlement counts "PMs / Observers" | ✅ Fixed by BU7 (#249; ruled #230 (b)): Project Manager (base Member: `manage_projects` · `purchase` · `hire` · `contribute_funds` · `spend_funds` · `view_analytics` — PRODUCT_SPEC's remit; no people or admin rights, #249 (a) RULED 2026-10-19: kept as built) and Observer (base Member, `view_analytics`) are role-editor TEMPLATES in `core/role-templates.ts` (data, not presets), written through `upsert_workspace_role` by an owner and an admin in `probes/business_members_roles.sql`; contracted project managers are post-MVP (#230 (b), PRODUCT_SPEC §Businesses) |
| BF13 | `purchase` gates buying | **Never checked** in SQL or TS (whole-tree grep) | ✅ Fixed by BB2 (#237) — `purchase` gates `place_wallet_order` / `place_on_account_order` for a business basket, after vault `spend`; open beside it: filing a basket approval request does not check `purchase` (#243 flag (n)) |
| BF14 | `hire` gates hiring | **Never checked in SQL**; only gates the Talent module view. Hiring/assigning/reviewing uses `projects.can_review_project` = owner OR **any active business member** (`00001100:927-940`; `assign_ticket_manual` / `assign_parallel_stream` `00001140:467-489`; `assign_from_application` `00001130:1404-1405`) — a `member`-preset seat can hire and approve work that releases escrow | ✅ Fixed by BB2 (#237) — `hire` on every hiring, assigning and escrow-releasing door (`fn_assert_business_actor`; probe `business_authority.sql`); open beside it: `projects.get_nav_activity` still derives reviewer and manager from `can_review_project`, so a member without `hire` may be offered a control that refuses (#237 flag (d)) |
| BF15 | `manage_projects` gates project creation for a business | Not checked by `create_project` | ✅ Fixed by BB2 (#237) — `manage_projects` on `create_project` with a `client_business_id` and on re-pointing it (`fn_guard_project_ownership`) |
| BF16 | Member preset = contribute + analytics | Yes (`common.ts:202`, F1020:518-520) | ✅ Compliant — no change |

### 1.3 Money: wallet, spend governance, KYB

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| BF17 | Spend policy writer | `finance.save_spend_policy` (F1210:2106-2221): `manage_finances`, rank/self/owner/grant-what-you-hold checks, vault re-sync | ✅ Compliant — extended by BU2 (#246): limits per key + period; a ceiling needs Business Pro |
| BF18 | Request approval | `request_spend_approval` (F1210:2228-2294): needs vault `spend`, genuine need, 7-day expiry, notifies approvers | ✅ Compliant — tightened by BB4 (#239 (B)): ref required, business wallets only, one open request per ref |
| BF19 | Threshold fallback consistent | `request_spend_approval` and `place_wallet_order` use `COALESCE(threshold, 0)` — **ignore** the platform `vault_approval_threshold_cents` fallback that `fn_auto_fund_drain` honours (F1250:226-227) | ✅ Fixed by BB3 (#240 (A)) — `finance.fn_business_threshold` is the one resolver; the TS pre-flights read the platform figure too (BB9 `live-money.ts`, BP2 `live-buyer.ts` — #243 (i), closing #239 (f) / #240 (b)); team and enterprise baskets keep their wallet's own threshold (#240 (a) RULED 2026-10-17) |
| BF20 | **Approved request is redeemable** | `decide_spend_approval` only drains auto-fund on approval (F1210:1958-1960). `place_wallet_order` refuses ≥ threshold **unconditionally** (F1210:1454) and never reads `spend_approvals`; the app files requests with `p_ref_table: null, p_ref_id: null` (`wallet-actions.ts:420-436`); checkout links "needs approval" to `/businesses/{slug}/spend` (`live-buyer.ts:526-532`) where nothing can be redeemed | ✅ Fixed by BB4 (#239) + BP2 (#243) — ref-bound, single-use `finance.fn_redeem_spend_approval`; the checkout refusal carries `approvalRef`; the checkout files the request in place, bound to the basket, shows pending / approved, and has no `/spend` link |
| BF21 | Envelope + threshold + KYB on **every** spend door | Basket (`place_wallet_order`) ✅ all three. `transfer_funds` ✅ envelope + KYB, no threshold. **`fund_stage`, `fund_ticket`, `fund_paid_revision`, card `escrow_lock`, claim-lock holds** — envelope of the **project owner** (not the actor, F1200:432, :616), **no threshold, no KYB** (`finance/Functions.md:245-246` admits it) | ✅ Fixed by BB3 (#240) — `finance.fn_assert_business_spend` (KYB · the acting member's envelope · the threshold) on the basket, transfers out, `fund_stage` / `fund_ticket` / `fund_paid_revision` and both holds; the card escrow lock is a check without the envelope, so an over-cap card lock is charged and settles `settled_unapplied` (#240 flag (c), open) |
| BF22 | No double counting | A basket ticket line counts against the caller's envelope in `place_wallet_order` and again against the project owner's in `fn_hold_ticket_escrow` (`fn_check_spending_limit` increments `spent_cents`, F1200:262) | ✅ Fixed by BB3 (#240 (D)) — counted once through `finance.spend_cover`; a hold that loses the `uq_escrows_ticket_base_held` race keeps its count (#240 flag (e), pre-existing) |
| BF23 | Who can fund a business project | `has_project_access` admits a business only via a `project_participants` row whose business **owner** is the caller (`00001100:661-745`): a member holding `spend` cannot fund; yet every member passes `can_review_project` (BF14) — the authorities are inverted | ✅ Fixed by BB2 (#237; flag (a) RULED 2026-10-17) — `projects.fn_can_fund_project` (vault `spend` on the business wallet, its creator included) on every funding door in place of `has_project_access` |
| BF24 | Pool short | `place_wallet_order` raises PF402; #61 flag (d) undecided (fail / prompt to contribute / charge personal); PRODUCT_SPEC:1262-1264 forbids a personal card for a business purchase | ⚠️ partly — refused at checkout with a tier-1 **Add money** (the business wallet's top-up, back to checkout) for `contribute_funds` holders, never a personal card and no on-account fallback: Fixed by BP2 (#243; ruled #230 (c)); the same prompt at the other funding doors (`FundStageDialog`, the board's Checkout N) is not built (#243 flag (m)) |
| BF25 | Contribution ledger complete | Reads `ledger_audit WHERE action='add_funds'`, written only by `transfer_funds` — **card top-ups never appear** (`live-money.ts:356-358`) | ✅ Fixed by BB6 (#238 (D)) — `settle_card_payment` writes a shared wallet's card top-up as `ledger_audit` `add_funds` |
| BF26 | Withdrawals | `begin_payout`: vault `withdraw` (owner preset only), KYB, verified payout account | ✅ Compliant — no change (the owner may grant `withdraw_funds` to a co-owner, #238 (a)) |
| BF27 | KYB start | `record_payout_account('business')` needs `manage_billing` (owner only); `sync_payout_account` sets `kyb_status` | ✅ Compliant (backend) — the billing right is owner-grantable since BB6 (#238), and the UI is BU4's (#242); open: `finance.fn_payout_owner` still refuses "only a business owner can verify the business", though a billing-granted admin may (#242 flag (f)) |
| BF28 | KYB UI | Verification module is a `ModulePlaceholder` with **no action**, yet every "Finish KYB" / "Verify {name}" link targets it (`ModuleScreen.tsx:160-168`; `VerificationLock.tsx`; `BillingScreen:296`; `WorkspaceLane:768`) — a **dead-end loop** (§3.11) | ✅ Fixed by BU4 (#242) — `BusinessVerificationScreen`: status, what is due, one tier-3 Verify / Continue verification, what verification unlocks; every KYB link asks the module's own gate |
| BF29 | `manage_billing` vs module gate | Every billing write needs `manage_billing` (owner only), but the Billing module is gated on `manage_finances` (admins see it, cannot act); Verification gated on `manage_settings` though KYB start needs `manage_billing` | ✅ Fixed by BB6 (#238; ruled #230 (d), (d.1)) — Billing and a business's Verification open on `manage_billing`, which the owner grants a named admin |
| BF30 | Spend module gate | Gated on `spend_funds`; editing needs `manage_finances`, deciding needs `approve_spend` — an approver-only role cannot reach the queue; a `member` without `spend_funds` cannot open the screen but RLS lets it read every member's limits and requests (`00002013:90-105`) | ✅ Fixed by BB6 (#238 (C), (E)) — Spend opens on `spend_funds` · `manage_finances` · `approve_spend`; envelopes and requests are read by their owner or `fn_reads_wallet_envelopes` |

### 1.4 Billing, plans, entitlements

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| BF31 | Monthly consolidated invoice | `fn_generate_consolidated_invoice`, daily `fn_run_billing_cycle`, `pay_invoice` from the wallet; tax stubbed 0 (#172 a) | ✅ Compliant — no change; #172 (a)–(c) and (e)–(h) stay open (finance); #172 (d)'s reuse of an approved auto-fund request is closed by BB4's single-use redemption (#239 (C), (E)) |
| BF32 | Pay invoice | Wallet debit only (#172 e); no confirm step in UI | ✅ Fixed by BU3 (#247) — every Pay passes through a review — `CommitReview` (the amount, the wallet it leaves, the balance now and after; a wallet short of the invoice hands off to its top-up) — and only `viewerCan.payInvoice` sees Pay; `pay_invoice` itself refuses a business that is not KYB-verified (`PK403 kyb_required`, #247 (h) RULED 2026-10-18: kept), as the reads do |
| BF33 | Intervaled invoicing Pro-gated | `intervaled_invoicing` entitlement seeded, **never read**; `set_invoicing_terms` checks KYB + `manage_billing` only | ✅ Fixed by BB7 (#230 (e)) + BU3 (#247) — `set_invoicing_terms` refuses monthly without Business Pro (`PK402`, behind `business_plan_gates_enforced`, seeded on); Billing reads `get_billing_settings.plan_allows_monthly` (the dev override honoured) and says "part of Business Pro" before the Save; the See plans link waits for a plans surface (#247 flag (d)) |
| BF34 | Spending caps Pro-gated (`pooled_wallet_full`) | Seeded, never read | ✅ Fixed by BB7 (#230 (e)) + BU2 (#246) — a threshold or a per-member ceiling is refused without Business Pro (`PK402`, `save_spend_policy` / `update_workspace_member`; clearing is never refused); Spend reads `limits_plan_gated` and locks the field before the press; See plans withheld (#246 flag (1)) |
| BF35 | `business_managers` cap | Seeded 2/15, never enforced | ✅ Fixed by BB7 (#230 (b)) + BU7 (#249) — `business_managers` (admins + `manage_projects` holders + pending invitations to such a role) refused `PK402`; Members heads with "1 of 2 managers", and the invite dialog, drawer and Roles matrix say the cap before the press; upgrade link withheld (#249 flag (h)) |
| BF36 | `businesses_owned` | Enforced (1 free / 3 pro); finance-model:57 says Pro spins up 5 | ✅ Fixed by BZ0 (#230 (f)) — finance-model §1.3 says 3; the seed and BB7's probe (`business_entitlements.sql`, 1 / 3) agree |
| BF37 | Business plan purchase | **No subscription writer** — `business_pro` price TBD, no upgrade path | ❌ Open — out of MVP scope: no `business_pro` price or subscription writer (product owner); the See plans links withheld by #246 (1) / #247 (d) / #249 (h) wait on it |

### 1.5 Console read, RLS, routing

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| BF38 | RLS on `org.business_profiles` | RLS enabled, **zero policies** → clients denied; all reads through definers / `profiles_index` | ✅ Compliant by design — documented in `database/org/Policies.md` §`org.business_profiles` |
| BF39 | RLS on members / roles | SELECT-only for active members (+ admin on roster; roles policy lacks the `is_admin()` arm) | ✅ Fixed by BB6 (#238 (F)) — the `business_roles` SELECT gains `OR security.is_admin()` |
| BF40 | uuid → handle | 303 (should be 308, as Teams #228 B) | ✅ Fixed by Teams B6 (#228 (B)) in the shared console route — a uuid or differently cased handle answers 308 |
| BF41 | `/businesses/x/overview` | Renders — a duplicate URL of `/businesses/x` (not canonicalised) | ✅ Fixed by BB8 (#228 (B)'s contract; `ROUTING.md`) — `/businesses/x/overview` answers 308 to the console root, query kept |
| BF42 | Missing / forbidden | Silent 303 → `/businesses`; from `[module]` it is **two hops** (`/businesses/<ref>` → `/businesses`) | ✅ Fixed by BB8 (#228 (B)'s contract) — a non-member gets one 303 to `/businesses?notice=unavailable`, an unregistered module one 303 to the canonical root (`workspace-route.test.ts`) |
| BF43 | Talent module | Registry entry (gate `hire`, "the bench — freelancers and teams this business works with") falls to `ModulePlaceholder` "Not built yet"; no doc defines Talent | ✅ Fixed by BU5 (#241; ruled #230 (i)) — the bench, `org.get_business_bench` and the Talent screen |
| BF44 | Team wallets accept spend requests | `request_spend_approval` accepts team wallets, but teams never hold `approve_spend` — only the owner can decide | ✅ Fixed by BB4 (#239 (B)) — requests on business wallets only |

### 1.6 Public `/:handle` (buyer profile)

| # | Rule | Status |
| :-- | :-- | :-- |
| BF45 | Buyer cannot be hired: Message primary, Follow secondary (PRODUCT_SPEC:517-521) | ✅ Fixed by BP1 (#244) — business rig: tier-3 Message to the owner, icon-only Follow, Manage business for editors, no listings resolved |
| BF46 | "Corporate verified" crest on KYB (PRODUCT_SPEC:2330-2334); Client Trust Score, **no Standing** (:2326-2328) | ⚠️ partly — the crest only on `kyb_status = 'verified'` and no Standing: Fixed by BP1 (#244, probe-pinned); the Client Trust Score has no definition, so the freelancer-given client rating stands in (#244 flag (c) — a finance-model §16 work order) |
| BF47 | Editors = `edit_profile` (owner + admin) vs PRODUCT_SPEC:591 "a business's owner" | ✅ Fixed by BP1 (#244) — the business clause aligned to owner or admin; the team clause is #250 (b)'s, corrected by Teams P1 |
| BF48 | Unlisted businesses | ✅ Fixed by BB5 (#236 (C)) + BP1 (#244) — draft · archived · invite-only are missing to outsiders; an unlisted business opens by link, as a team's (#244 (a) RULED 2026-10-17; BP1's "unlisted is 404" line superseded) |

---

## 2. Visual & Design-System Defect Log (business-specific)

Shared defects D1–D41 (`TEAMS_AUDIT.md` §2) apply verbatim; their status is that section's Status
column — fixed by W1, U1–U4, L1–L2, R1–R3 and C1–C6, with D1's ui lane controls (#255), D15's unit
convention (#251 (a)) and D41's kept `.wsp-footerrig__action` (#258 (g)) still open there.
Severity: **G** gate · **M** matrix/parity · **T** tidy · **B** functional bug in UI.

### 2.1 Spend policy screen (`SpendPolicyScreen.island.tsx`, `SpendLimitRow.tsx`, `ApprovalQueue.tsx`)

| ID | Sev | Defect | Fix | Status |
| :-- | :-- | :-- | :-- | :-- |
| BD1 | B | Header promises "Who may put money in" but there is **no approver or contributor editor**; `approverIds`/`contributorIds` are posted back unchanged (:133-134); `.wsp-spend__approvers` is dead CSS | Two `Listbox` pickers — Who can approve · Who can add money — over the server's `editableMemberIds` (never the owner, never oneself, only somebody outranked), the fixed holders named under each; `.wsp-spend__approvers` is their grid. Also found and fixed: every save posted EVERY limits row (the owner's and the editor's own included), which `save_spend_policy` refuses, so a save carrying limits could never succeed — now only the rows the server offers, each with only the keys that moved | ✅ Fixed by BU2 (#246) |
| BD2 | B | Draft ceilings render against server figures: `PolicyAmount value={limit.limit ?? limit.spent}` (`SpendLimitRow:319`) shows **spent as the ceiling** for a previously unlimited member, and ":306 of  used" blanks | A drafted row draws the server's preview of THAT draft (matched by its signature) marked "Not saved yet", or "Pricing the change…" until it arrives — never a stored figure with a field patched in; reproduced first in `spend-model.test.ts` | ✅ Fixed by BU2 (#246) |
| BD3 | B | Meters not refreshed after an approval (`decide()` only updates `policy`, :187); comment claims decisions don't touch envelopes | A decision or a withdrawal adopts the re-read spend block; rows the reader had not touched follow it, their own edits stay (`rebaseDraft`) | ✅ Fixed by BU2 (#246) |
| BD4 | B | Approval history hidden unless something is pending (:223); `ApprovalQueue` empty state unreachable | Requests always render — `TabMenu` Pending · Decided, each with its empty state | ✅ Fixed by BU2 (#246) |
| BD5 | B | Unverified approver sees requester copy "Waiting for a decision" (`canApprove && verified`, :234) | An approver whom `viewerCan.decide` refuses (KYB) reads the refusal map's `kyb_required` notice, linked to Verification (BU4) when it admits them, and gets no Approve | ✅ Fixed by BU2 (#246) (the notice links Verification, BU4 #242) |
| BD6 | G | "Unlimited" chip renders beside "Spending is off" (:312, :318); "Per purchase" chip **hides the amount** (:325) | One MetaLine — `Spending off` · `US$500.00 / month · US$100.00 per purchase` · `No ceiling` (tabular); the chips are gone | ✅ Fixed by BU2 (#246) |
| BD7 | G | Tooltips on non-focusable spans (:318-326; SpendPolicyScreen :318-323) | A Tooltip only on the focusable Edit button; the ledger's note is a MetaLine; the pool ledger (`ContributionLedger`) names its direction glyph by its `aria-label` alone and shows "Approved by …" as MetaLine text under the line's reason (its two span Tooltips removed in the review pass) | ✅ Fixed by BU2 (#246) |
| BD8 | M | N filled Approve buttons once D30 is fixed literally | The first decidable row's Approve tier 3, every other tier 4, Decline and Withdraw tier 5 | ✅ Fixed by BU2 (#246) |
| BD9 | T | `<div class="wsp-spend__limits">` contains `<li>` (:282) | `<ul class="wsp-spend__limits">` | ✅ Fixed by BU2 (#246) |
| BD10 | T | Threshold `min={0}` while 0 is invalid (:261, :70); double label (`<label>` + `aria-label`) | `MoneyInput min={1}` inside `FormControl` — one label | ✅ Fixed by BU2 (#246) |
| BD11 | B | "Give a member approve-spend" warning has no link (:272-277) | The server's `approver_gap` (nobody besides the owner approves, #239 (e)) → an InlineNotice with a tier-4 "Choose approvers" that focuses the picker, for the policy's editors | ✅ Fixed by BU2 (#246) |
| BD12 | B | `accessHref="/wallet/access"` lands in the **personal** wallet (308 drops the business `?w=`) | `walletHrefFor("business", id, "access")` → `/wallet?w=business:<id>#upcoming` | ✅ Fixed by BU2 (#246) |
| BD13 | T | `.wsp-approvals__who` 600, `gap: 2px`, `block-size: 6px` meter, `opacity: .68` dimming, literal `500` | The spend and approvals rules rewritten token-only — the hand-made meter, chips and tinted rows deleted; the styles gate is green | ✅ Fixed by BU2 (#246) |

### 2.2 Billing (`BillingScreen.island.tsx`)

| ID | Sev | Defect | Fix | Status |
| :-- | :-- | :-- | :-- | :-- |
| BD14 | G | Tier-1 Pay renders **per invoice** → N amber fills in one region; no confirmation before moving money | One "Pay €X" for the oldest due invoice (or "Pay all due"), others tier 5 "Pay" opening the same confirm; a review step (ConfirmDialog is blocked for accent per #157 o — use the wallet `MoveDialog` review pattern) — BU3 (#247): one tier-1 Pay for the oldest payable invoice, row Pay tier 5, both into `CommitReview` (promoted to `@projective/ui/feedback`; `MoveDialog` renders its body) | ✅ Fixed by BU3 (#247) |
| BD15 | B | Pay gated on `canEdit` only (ignores KYB and `manage_billing`) | Gate on server capabilities from the detail — BU3 (#247): Pay renders only for `viewerCan.payInvoice`; a draft, archived or KYB-pending business reads the refusal map's notice instead | ✅ Fixed by BU3 (#247) |
| BD16 | M | Below-floor warning is a bare `<p>` | `InlineNotice severity="warning"` with a tier-1 "Top up" that starts the wallet MoveDialog (the act that starts a financial flow = tier 1) — BU3 (#247): an `InlineNotice` with the warning glyph (it has no severity) and ONE Top up into the business wallet's top-up and back; tier 4 while a Pay renders, so the page keeps one amber control | ✅ Fixed by BU3 (#247) |
| BD17 | T | Hand-rolled labels (:279,305,322,338); hard-coded "Issued on the 1st" (:245) though `billing_day` is 1–28; empty `<span />` spacer (:259); band meta not tabular | FormControl; derive copy from `billing_day`; layout via grid; tabular — BU3 (#247): FormControl terms (SelectButton · Select 1st–28th · SelectButton · MoneyInput), "Issued on the {billing day}" on the Invoices band from data, DataTables in place of the spacer-padded lists, MetaLine band meta with tabular figures; the Statements band's "Issued on the 1st" is KEPT — statements stay on the 1st (#168) | ✅ Fixed by BU3 (#247) |

### 2.3 Console branches, roster, create

| ID | Sev | Defect | Fix | Status |
| :-- | :-- | :-- | :-- | :-- |
| BD18 | B | Overview money band requires `manage_finances \|\| spend_funds \|\| withdraw_funds` (:75-76) while Finance opens on `contribute_funds` → a member can open Finance but sees no money on Overview | One `canSeeMoney(kind, caps)` helper in `workspace-model.ts` shared by registry and Overview — BU6 (#248): the band is `businessMoney` (`overview-model.ts`) on `canOpenFinance` — the predicate the registry opens Finance on and the read answers `money_tiles` on, so no helper was added to `workspace-model.ts`; a plain member (contribute only) sees it, a withdraw-only role does not (pinned over every preset and single-right role in `module-registry-gates.test.ts`) | ✅ Fixed by BU6 (#248) |
| BD19 | B | `FinanceSummary` `canOpen` never passed (:260) → link always shows; Available figure duplicated (:69-80 vs first tile) | Pass `canOpen`; drop the duplicate — BU6 (#248): `FinanceSummary` draws BB9's tiles per currency (Available · Committed · Awaiting approval · Spent 30d), each pinned to its row's own currency, and only the hand-off link; the repeated Available and `PolicyAmount` are gone. `canOpen` was dropped rather than passed: the band itself renders only on `canOpenFinance`, and the wallet opens a business's `?w=business:<id>` view for every member (`resolveWalletContext` — membership is `view`), so the link's gate IS the band's and a second prop could only ever be `true` | ✅ Fixed by BU6 (#248) |
| BD20 | B | MemberCard "Ceiling set" without amount or link (:778); MemberDrawer "edited on the spend policy" with no link (:359-366) | Show the envelope MetaLine + tier-5 link to Spend — BU7 (#249): the card and the People table's Spending column show the envelope MetaLine to viewers the read gives every envelope (`spend.readsAllEnvelopes`); the drawer's section adds a tier-5 "Edit in Spend" / "Open in Spend" to `/businesses/:h/spend#limit-<handle>`, which lands on and focuses that row | ✅ Fixed by BU7 (#249) |
| BD21 | T | Create modal kind radio is **unreachable** (`showKindChoice` always false; single mount `WorkspaceRoster:419`) and paints `--secondary` with a translucent mix (`roster.css:824-826`) | Delete the radio and its CSS — BU1 (#245): the hand-rolled radio and its translucent CSS went in Teams R3; R3's unmounted neutral-context `SelectButton` choice is deleted too (flag (b); closes #254 (d)), so the dialog's kind is always its route's — `/businesses` mounts it with `kind="business"`; the `.wsp-create__kind*` and `.wsp-create__label` rules, without a consumer since the invite dialog's chooser became a `SelectButton` (Teams C2), are deleted and held deleted by the W1 dead-rules gate; the placeholders are neutral ("Acme Studio" / `acme-studio`) and the intro no longer promises limits a free business lacks | ✅ Fixed by BU1 (#245) |
| BD22 | G | Business kind tint: `--wsp-business-edge` translucent (`tokens.css:83-88`); high-contrast widens `tint`/`edge` but **not `tint-hi`/`ink`** (:305-306); comments call it "the ACCENT tint" (amber is accent) | Opaque edge; HC values for all four; fix comments — BU1 (#245): the family is derived from `--wsp-business`, every mix opaque; high contrast widens tint 20% · tint-hi 26% · edge 70% · ink 65% (every text pair ≥ 7:1); the comments say "tertiary tint" and carry re-measured figures; `business-hue.gate.test.ts` | ✅ Fixed by BU1 (#245) |
| BD23 | G | `--wsp-business` = `--secondary`, which is also the **focus-ring colour** (`theme-engine.ts:203-213`): a ring on a business-tinted mark is invisible against it | Business marks use `--tertiary` (the CVD anchor already used at :334-338) or the ring gets the inverse-surface halo on business surfaces — BU1 (#245, per #230 (j)): `--wsp-business` = `--tertiary` (and `-on` = `--on-tertiary`) in every mode; the colour-vision block no longer re-anchors it, and the ring's ink is no longer the hue itself (ΔE_OK 0.00 → 0.03–0.05). But the two still share a tone — 1.00–1.01:1 in luminance — so a ring on a business mark would still not show by its ink; rings are off by directive — flag (a) RULED 2026-10-19: the directive stands, rings stay off; DESIGN_SYSTEM §A.1.3 | ⚠️ partly — `--wsp-business` = `--tertiary` in every mode: Fixed by BU1 (#245; ruled #230 (j)); the ring still shares the hue's tone (1.00–1.01:1), moot while rings are off by directive (#245 flag (a) RULED 2026-10-19; DESIGN_SYSTEM §A.1.3) |
| BD24 | M | Roster table money column header is the stats label "Spent (30d)" from the first card; only the largest currency is shown; `delta` always null | Explicit column def; multi-currency MetaLine; drop the delta slot until it has data — BU1 (#245): a business's table has its own column contract (`BUSINESS_ROSTER_COLUMNS`) with an explicit Spent (30d) — one `MoneyView` per currency pinned to its own currency, several on one meta line, no delta — from the new `WorkspaceSummary.money30d`; the card keeps `stats[2]`. The figure is Finance's, so `org.get_workspace_roster` answers it only under `get_workspace_detail`'s money predicate (contribute_funds · spend_funds · manage_finances) and withholds it (`null`) from anybody else — the card drops the stat, the cell shows the table's empty mark (BU1 review; flag (c) resolved; `probes/business_roster_spend.sql`) | ✅ Fixed by BU1 (#245) |
| BD25 | T | `PolicyAmount` literal 600 at every size (`tokens.css:401-416`) | `--fw-medium` (figures are not headings; weight is the money register's) — BU6 (#248): the four `.wsp-money--*` steps are `--fw-medium` (W1 had already replaced the literal with `--fw-semibold`); `MoneyView` amounts stay `--fw-semibold` (flag (f)) | ✅ Fixed by BU6 (#248) |
| BD26 | B | Talent and Verification render "Not built yet"; Verification shows "is verified" **and** "Not built yet" when verified; `ModulePlaceholder.tsx:15` still lists Billing as next; `VerificationLock` hard-codes "two working days" | Build Verification (BU4); Talent per #230 (i); correct stale copy — a business's Verification built and its stale copy corrected (BU4, Decision #242); a team's Verification is still the placeholder (Teams series, #242 flag (d)); Talent per BU5 | ✅ Fixed by BU4 (#242) + BU5 (#241) for a business; a team's Verification is still the placeholder — ❌ Open, Teams follow-up (#242 flag (d)) |

---

## 3. Component Refactoring Plan (business-specific)

The shared migration plan is `TEAMS_AUDIT.md` §3.1 and its prompts (U1–U4, W1, L1–L2, R1–R3 in
`TEAMS_BUILD_PROMPTS.md`). Business additions:

| File | Migrate / add | Pri | Status |
| :-- | :-- | :-- | :-- |
| `islands/SpendPolicyScreen.island.tsx` | `FormControl` + `MoneyInput` (threshold) · approver/contributor editor with `Listbox` or a `DataTable` with selection (BD1) · `InlineNotice` · tier-3/4/5 matrix · `useSignalEffect` | P0 | ✅ Fixed by BU2 (#246) |
| `components/SpendLimitRow.tsx` | `ProgressBar` (meter) · `MetaLine` (BD6) · `MoneyInput` for ceilings inside `FormControl` · `ToggleSwitch` for can-spend · `<ul>` (BD9) | P0 | ✅ Fixed by BU2 (#246) |
| `components/ApprovalQueue.tsx` | `Button` tiers (BD8) · rows on hairlines (no tinted boxes) · Pending · Decided via `TabMenu` | P0 | ✅ Fixed by BU2 (#246) |
| `islands/BillingScreen.island.tsx` | One tier-1 Pay + review dialog (BD14) · `InlineNotice` (BD16) · `FormControl` | P0 | ✅ Fixed by BU3 (#247) |
| `components/ContributionLedger.tsx` | `DataTable` (date · member · method · amount tabular); include card top-ups (BF25) | P1 | ⚠️ partly — card top-ups reach it (BB6, #238 (D)) and its span Tooltips gave way to MetaLine (BU2, #246 (k)); open: the `DataTable` (date · member · method · amount, tabular) was in no work order — it is still a `<ul>` with no method (❌ Open, a workspaces UI follow-up) |
| `components/ModuleScreen.tsx` | `verification` → new `BusinessVerificationScreen` island; `talent` per #230 (i) | P0 | ✅ Fixed by BU4 (#242) + BU5 (#241) |
| `components/VerificationLock.tsx` | Link to the real Verification module; drop hard-coded SLA copy | P1 | ✅ Fixed by BU4 (#242 (C), (D)) — links ask `canOpenVerification`; the hard-coded SLA copy deleted |
| `components/FinanceSummary.tsx`, `islands/WorkspaceOverview.island.tsx` | shared `canSeeMoney` (BD18-19) | P1 | ✅ Fixed by BU6 (#248) — the `canOpenFinance` band on BB9's tiles; business setup hero (Add money tier 1, Publish not gated); draft notice; Finance module `BusinessFinanceHead` |
| `components/MemberCard.tsx`, `islands/MemberDrawer.island.tsx` | envelope MetaLine + link (BD20) | P1 | ✅ Fixed by BU7 (#249) |
| `islands/CreateWorkspaceModal.island.tsx` | delete kind radio (BD21) | P2 | ✅ Fixed by BU1 (#245) |
| `styles/workspace-tokens.css` | business tint opaque + HC (BD22); hue per #230 (j) (BD23) | P0 | ⚠️ partly — BD22 Fixed and BD23 partly by BU1 (#245); the ring shares the hue's tone, moot while rings are off by directive (#245 flag (a) RULED 2026-10-19) |
| `apps/web/features/shell/core/{actions-model,nav-model,nav-fixtures}.ts` | persona predicate per #230 (a); replace the capabilities fixture with the session's real `has_business` / membership facts (BF3) | P0 | ✅ Fixed by BB1 (#230 (a)) — `account-facts.ts` `canCreateBusiness`; the nav reads the token's facts; the fixture is the `dev:mock` fallback only |

**`packages/ui` additions** beyond the Teams set: none required. Reuse `MoneyInput`, `Listbox`,
`ProgressBar`, `DataTable`, `MetaLine` (Teams U1). A **review step for tier-1 commits outside the
wallet** (BD14) should reuse the wallet `MoveDialog` review pattern; if it cannot be reused from
`apps/web/features/wallet/`, promote its review body to `@projective/ui/feedback` as
`CommitReview` — decided in BU3 (#247): promoted to `@projective/ui/feedback` as `CommitReview` (+ the
stylesheet-free `CommitReviewBody`); the wallet `MoveDialog` renders its body (DESIGN_SYSTEM §C.1).

---

## 4. Strategic Architecture Decisions

### 4.1 Persona and context

- **BX-a — RULED by #230 (a) as recommended, operators included; built by BB1:** any **adult**
  account may create and join a business. A freelancer is a superset of a client
  (PRODUCT_SPEC:1341-1342) and may own a business while selling elsewhere
  (:684-691). Drop the `isFreelancer` gate in `actions-model.ts`; retire the stale "Operator Mode"
  sentence (PRODUCT_SPEC:657-660) and the #16/#18 seller-surface wording for Business. No DB change
  beyond what exists (adult + entitlement).
- **Context truth:** acting as a business must stamp `isClient = true` in the access-token hook
  regardless of the person's freelancer status (BF4) — a business context is buyer-side by
  definition. Seller surfaces in a business context are already hidden by #61. Built by BB1 (BF4).
- **Nav truth:** replace the `ACCOUNT_CAPABILITIES` fixture with real session facts (owns or belongs
  to a business; has the `businesses_owned` entitlement) — the fixture shows Businesses to everyone.
  Built by BB1 (BF3).

### 4.2 Authority model: one capability per act

| Act | Required (proposed) | Built (2026-10-19) |
| :-- | :-- | :-- |
| Create a project billed to the business | `manage_projects` | ✅ BB2 (#237) — `manage_projects` in `create_project` / `fn_guard_project_ownership` |
| Buy (basket / services / products) as the business | `purchase` + vault `spend` + envelope + threshold + KYB | ✅ BB2 (#237) `purchase` + BB3 (#240) gate |
| Hire / assign / accept an application | `hire` | ✅ BB2 (#237) — `fn_assert_business_actor(…, 'hire')` |
| Review / accept a submission (releases escrow) | `hire` **or** being the project's owner | ✅ BB2 (#237) — `hire` or the project's owner (`fn_business_actor_can`) |
| Fund escrow (stage / ticket / revision / card lock) | vault `spend` + the **actor's** envelope + threshold-or-approval + KYB | ✅ BB2 (#237 (a) RULED: vault `spend` only, its creator included) + BB3 (#240); the card lock checks without the envelope (#240 (c)) |
| Decide a spend approval | vault `approve_spend`, not the requester | ✅ (unchanged) |
| Billing writes, KYB start | `manage_billing` (owner) — and the modules gated on it | ✅ BB6 (#238) — modules on `manage_billing` (BX-d → #230 (d), (d.1)) |

Implementation: a single `projects.fn_business_actor_can(p_project, p_capability)` helper (owner of
the project OR `fn_member_can('business', client_business_id, cap)`), used by `can_review_project`'s
write callers, the assign/accept doors and `create_project`. Funding doors stop leaning on
`has_project_access` (a broad read predicate granted to `anon` too — do not widen it) and call a
dedicated `projects.fn_can_fund_project(p_project)` = project owner OR a business member holding
vault `spend` on the paying wallet (SUPERSEDED by #237 (a): on a business project only a vault
`spend` holder funds; the owner rule holds for a personal project). One spend gate
`finance.fn_assert_business_spend(wallet, actor, amount, ref)` applies envelope (actor's, counted
**once** at the earliest door) + threshold (with the platform fallback) + approval redemption +
KYB, and every door calls it.

### 4.3 Approval redemption (BF20)

- A request binds to what it approves: `ref_table`/`ref_id` become required (`basket` → the basket
  id, `tickets` / `project_stages` / `invoices` → the row), plus `amount_cents` and `currency`.
- `fn_assert_business_spend` passes the threshold when an `approved`, unexpired, **unconsumed**
  approval exists for the same `(wallet, ref, amount ≥ charge)`; it sets `consumed_at` (a new column
  on `finance.spend_approvals`, edited in place) in the same transaction. One approval, one spend.
- Checkout's "needs approval" opens a request dialog bound to the basket, not a link to `/spend`.
- **Built:** BB4 (#239) + BP2 (#243).

### 4.4 Lifecycle guards

- **Only an `active` business transacts:** create project, buy, fund, hire, pay invoice all refuse a
  `draft` or `archived` business (`55000 business_not_active`).
- **Archive blockers:** held escrow (exists) + live projects (`active`/`on_hold`) + pending approvals
  + unpaid/overdue invoices + on-account balance owed + wallet balance > 0 (must withdraw or transfer
  first) + pending payouts. Each surfaces as a typed code so Settings can list them before the
  confirm (Teams C6 pattern).
- **Visibility (BX-h → #230 (h), built by BB5):** add `visibility` to `org.business_profiles`
  (edit `00000011` in place; values as teams) and read it in the directory view instead of
  `true as listed`.
- **Built:** BB5 (#236); visibility per #230 (h); money into an archived business refused (#248 (k)); a
  business's Settings does not list the blockers yet (#244 (d)).

### 4.5 Routing

Same contract as Teams #228 (B): uuid/case → **308**; module the viewer may not open → 303;
`/:handle/overview` → 308 to the root; missing/forbidden → ONE 303 to `/businesses?notice=unavailable`.
Built: Teams B6 (#228 (B)) + BB8.

---

## 5. Prioritised backlog

| Pri | Item | Area | Status |
| :-- | :-- | :-- | :-- |
| P0 | BF13-BF15, BF23 authority model (`purchase`, `hire`, `manage_projects`, funders) | DB | ✅ Fixed by BB2 (#237) |
| P0 | BF21-BF22 one spend gate on every door (actor envelope once, threshold + fallback, KYB) | DB | ✅ Fixed by BB3 (#240); the card lock's envelope check is Open (#240 (c)) |
| P0 | BF20 approval redemption | DB + API + UI | ✅ Fixed by BB4 (#239) + BP2 (#243) |
| P0 | BF8 active-only transacting; BF7 archive blockers | DB | ⚠️ partly — Fixed by BB5 (#236) + #248 (k); open: a business screen listing the blockers (#244 (d)) |
| P0 | BF2-BF4 persona (#230 (a)), context flag, real nav facts | DB hook + app | ✅ Fixed by BB1 (#230 (a)) |
| P0 | BF28 Verification module (KYB start, status) — removes the dead-end loop | UI + API | ✅ Fixed by BU4 (#242) |
| P0 | BD1-BD6, BD14-BD16 spend & billing bugs | UI | ✅ Fixed by BU2 (#246) + BU3 (#247) |
| P1 | BF29-BF30 module gates aligned with write capabilities | app | ✅ Fixed by BB6 (#238) |
| P1 | BF19 threshold fallback; BF25 ledger completeness; BF44 team-wallet requests | DB | ✅ Fixed by BB3 (#240), BB6 (#238), BB4 (#239) |
| P1 | BF40-BF42 routing | app | ✅ Fixed by Teams B6 (#228 (B)) + BB8 |
| P1 | BD18-BD24 console branches, tint, roster table | UI | ⚠️ partly — Fixed by BU6 (#248), BU7 (#249), BU1 (#245); BD23 partly (rings off, #245 (a)) |
| P2 | BF9 visibility; BF33-BF35 entitlement reads (#230 (e)/(b)); BF39 roles admin arm | DB | ⚠️ partly — Fixed by BB5 (#236), BB7 (#230 (b), (e)) + BU2 / BU3 / BU7, BB6 (#238); open: BF9's search index (#236 (b)) |
| P2 | BF43 Talent (#230 (i)); BD21, BD25-BD26 tidy | UI | ⚠️ partly — Fixed by BU5 (#241), BU1 (#245), BU6 (#248), BU4 (#242); open: a team's Verification (#242 (d)) |
| Out | BF37 business plan purchase (price TBD); #61 (b) Enterprises overlap | — | ❌ Open — out of MVP scope (product owner) |
