# Businesses Build Prompts — Claude Code Work Orders for `/businesses` and `/businesses/:businessHandle`

> **Status: WORK ORDERS, not binding.** A sequenced series of self-contained Claude Code prompts that
> harden the business (buyer-side) entity: its authority model, spend governance, KYB, billing,
> lifecycle, routing, console screens and public profile. Evidence lives in
> [`BUSINESSES_AUDIT.md`](BUSINESSES_AUDIT.md) (IDs `BF*`, `BD*`, `BX-*`) and Decision #229.
>
> **Relationship to the Teams series.** Teams and Businesses share one implementation. The shared
> UI foundation — `packages/ui` primitives (U1–U4), the workspace stylesheet sweep (W1), the lane,
> header band and footer rig (L1–L2), the roster and create modal (R1–R3), and the Members/Roles
> screens (C2–C3) — is built ONCE by [`TEAMS_BUILD_PROMPTS.md`](TEAMS_BUILD_PROMPTS.md). This series
> assumes those have landed (or run them first) and adds only what is business-specific. Its
> backend wave is independent of the Teams series and can run in parallel with it.
>
> Paste each prompt into its **own fresh session**, below the standard header (§1). Prompts marked
> **🧑 DECISION** stop and ask before changing behaviour, presenting options with a recommendation.

---

## 0. Run order & dependencies

| Wave | Prompts | Why this order |
| :-- | :-- | :-- |
| **0 — Rulings** | BZ0 🧑 | Collects the owner rulings (persona, roles, pool-short, billing gates, entitlements, visibility, Talent, tint) every later prompt cites as Decision #230. |
| **1 — Authority & spend integrity** | BB1 → BB2 → BB3 → BB4 | Persona/context first; then one-capability-per-act; then the single spend gate every door calls; then approval redemption on top of it. Money integrity before any UI. |
| **2 — Lifecycle, vault, entitlements** | BB5, BB6, BB7 | Active-only transacting + archive blockers + visibility; vault/billing alignment + ledger completeness; entitlement reads. |
| **3 — Routing & read model** | BB8, BB9 | 308 canonicalisation, module gates aligned to write capabilities, and the detail payload the screens need. |
| **Prerequisite (Teams series)** | U1–U4, W1, L1, L2, R1–R3, C2, C3 | Shared UI foundation. |
| **4 — Business screens** | BU1, BU2, BU3, BU4, BU5, BU6, BU7 | Roster/tint · Spend · Billing · Verification · Talent · Overview/Finance · Members/Roles business branches. BU2 needs BB3–BB4; BU3 needs BB6; BU4 needs BB9. |
| **5 — Buyer storefront & checkout** | BP1, BP2 | `/:handle` for a business; the checkout "needs approval" flow (needs BB4). |
| **Last** | BZ1, BZ2 | Docs sweep; cross-surface verification. |

No-parallel pairs: BB2/BB3 (both edit `00001100`/`00001150`/`00001200`) · BB3/BB4 (`00001210`) ·
BU2 with BU6 (`FinanceSummary`, `WorkspaceOverview`).

---

## 1. Standard header — paste above EVERY prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types the
Zod SSOT @projective/types; packages/backend fat services @server/services/*; supabase/migrations
Postgres with RLS everywhere; Stripe for fiat rails).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (at least
     documentation/CLAUDE.md, documentation/database/CLAUDE.md for SQL, packages/ui/CLAUDE.md for UI),
     then documentation/reference/guardrails.md and documentation/reference/pr-checklist.md.
  2. Read documentation/architecture/BUSINESSES_AUDIT.md (the IDs cited below) and Decisions #229 and
     #230 (once BZ0 has landed) in the newest documentation/reference/decisions/decisions-*.md.
     For UI prompts also read documentation/architecture/TEAMS_AUDIT.md §2 and the Teams prompt your
     screen builds on.
  3. Grep documentation/reference/decisions/README.md for the surface and read the decision files it
     names — at minimum #61, #126, #153, #157, #165, #168, #172, #196, #208, #225.
  4. A business is BUYER-side ("a Client with multiple members", #61). Teams and Businesses share one
     implementation (WorkspaceKind): a business-only rule is gated on kind === "business" and every
     change keeps /teams rendering correctly.

Hard rules (merge gates — reject your own diff if any fails):
  SSOT & architecture
  - @projective/types is the SSOT. A schema/RPC-contract change lands with its Zod schema, the backend
    mapper, and documentation/database/<schema>/* in the SAME change; lifecycle changes also update
    documentation/PRODUCT_MANAGEMENT.md; business rules also update documentation/business/PRODUCT_SPEC.md
    or documentation/business/finance-model.md (concrete numbers).
  - Migrations are consolidated and EDITED IN PLACE (vvvvtooo_type_purpose.sql). Never append ALTER
    TABLE ADD COLUMN / ALTER TYPE ADD VALUE patches. Category files: 0 tables · 1 functions/triggers ·
    2 policies/grants · 3 views · 4 indexes · 5 seed. NEVER drop columns/FKs of escrows, wallets or
    stages without asking me.
  - Money: integer minor units only; every money check runs in the database inside the same
    transaction as the movement; the client never decides whether money may move.
  - Thin routes (apps/web/routes/api/*): HTTP parse + Zod + auth guard. Logic in
    packages/backend/services/* returning ServiceResult<T>. Islands never import Supabase or
    @server/*; they call feature core services that fetch /api/* only.
  - Signal-first state; useEffect only for external DOM reads/focus or external subscriptions.
  - Path aliases only; folders components/ islands/ styles/ hooks/ wrappers/ types/ core/; no src/.
  - JSDoc on exports; // #region [Name] … // #endregion; no meta-comments.
  UI (DESIGN_SYSTEM.md; root CLAUDE.md §3)
  - Pure CSS, strict BEM, token-only (no hex/rgb, literal radius/duration/shadow/font-weight/
    breakpoint). No Tailwind, CSS-in-JS, inline style= (packages/ui's own styleVars seam excepted),
    or UI-lib deps. No backdrop-filter in this feature.
  - Separation by spacing (--space-7 above, --space-3 below a heading) → SOLID tonal step → type →
    one --hairline. No color-mix(…, transparent), no opacity-as-state. Static content never boxed.
  - Non-actionable metadata as MetaLine (--text-secondary, " · "); containers only for controls,
    lifecycle Tag, required disclosures (InlineNotice), count Badge.
  - Headings --fw-medium; uppercase section labels --fw-semibold; all figures tabular-nums.
  - Button matrix (§B.8): ONE filled per decision region (tier-1 amber + tier-2 monochrome pair
    allowed). Tier 1 <Button severity="accent" rounded> = a commit inside a financial/conversion flow
    or the act that starts one (Pay invoice, Top up, Fund escrow, Place order). Tier 2 structural
    (Create business, Add to project, LaneCreateButton). Tier 3 primary = workflow & wallet
    configuration commits (Save policy, Approve a spend request, Publish, Start KYB — #225(A)).
    Tier 4 neutral outlined = utilities. Tier 5 text = Cancel, row actions. Destructive = danger.
  - Press feedback scale(var(--btn-press-scale)) / (--btn-press-scale-icon), transform: none under
    both reduced-motion channels. Fields from @projective/ui/fields inside FormControl (§A.7).
  - A control that renders must do something; a link must land on a working surface (§3.11).
  Product
  - New simulatable axis → Dev Context Switcher control in the same change (DevOverrides +
    DEV_DEFAULTS, DevOption list, DevContextPanel, reflect() set AND delete).
  - No bespoke statuses; nothing hard-deleted.
  - A NEW contradiction between source docs → decision row + index line, and ask me.

Verification: reproduce the defect first (a SQL probe under supabase/probes/ or a Deno unit test),
then fix, then `deno task db:reset` (if SQL changed), `deno task check`, `deno task lint`,
`deno task test:unit`, and `deno fmt` on touched files only. Four theme-engine.test.ts failures are
pre-existing. UI prompts: `deno task dev`, sign in as the seeded business owner / admin / member
(documentation/database/Seed.md), Playwright screenshots at 1440 / 900 / 390 px in light, dark and
high-contrast, plus data-motion="reduced" (Chromium at /opt/pw-browsers; never `playwright install`).
Commit on the branch you were given; do not open a PR unless I ask.
```

---

## 2. Wave 0 — Rulings

### BZ0 — Owner rulings for the business entity (Decision #230)

```text
PROMPT BZ0: Collect and record the business owner rulings; correct stale spec rows

ROLE: Documentation steward + product analyst. Docs only; no code.

🧑 DECISION — this prompt's job is to ASK. Put each question below to me in ONE message, each with
the options and the recommendation shown, wait for my answers, then record them.

QUESTIONS (BUSINESSES_AUDIT §1 / §4):
  (a) Who may create a business? [1] any adult account (recommended: a freelancer is a superset of a
      client, PRODUCT_SPEC:1341-1342, :684-691) · [2] client persona only · [3] Operator Mode only
      (PRODUCT_SPEC:657-660).
  (b) Business roles: [1] keep owner · admin · member and treat "Project Manager"/"Observer" as
      custom-role templates; business_managers counts admins + custom roles with manage_projects
      (recommended) · [2] add PM/Observer presets.
  (c) Pool short at checkout/funding (#61 d): [1] refuse with a one-click "Contribute" prompt for
      members holding contribute_funds, never charge a personal card (recommended; PRODUCT_SPEC:
      1262-1264) · [2] fall back to on-account credit when eligible · [3] both, on-account first.
  (d) Billing and Verification modules: [1] gate both on manage_billing (owner) and keep
      manage_billing owner-only (recommended — every write needs it) · [2] add manage_billing to the
      admin preset.
  (e) Plan gates: are intervaled (monthly) invoicing and spending caps (pooled_wallet_full) Pro-only
      as finance-model:478-483 says? [1] yes, enforce now · [2] free during MVP, enforce later
      (recommended until business_pro has a price).
  (f) businesses_owned on personal Pro: 3 (table) or 5 (finance-model:57)?
  (h) Business visibility: [1] add `visibility` like teams (listed / unlisted / invite_only)
      (recommended) · [2] every active business stays listed.
  (i) Talent module: [1] build "the bench" — freelancers and teams this business has hired, with
      re-hire and message actions (recommended; the registry blurb) · [2] remove the module.
  (j) Business kind hue: --secondary collides with the focus ring. [1] anchor business marks to
      --tertiary in every mode (recommended) · [2] keep --secondary and add an inverse halo to the
      ring on business surfaces.

FILES:
  - documentation/reference/decisions/decisions-122-126.md (row 230) + README.md index
  - documentation/business/PRODUCT_SPEC.md (§647-725 Businesses; sitemap :2950-2957; persona per (a))
  - documentation/business/finance-model.md (per (e), (f))
  - packages/types/org/enterprises.ts:6 comment ("seller-side" → buyer-side) — the ONE code edit,
    a comment correction

SPEC:
  - Row 230 records each answer verbatim with the question it settles, and marks #229 BX-a…BX-j and
    #61 (a), (d) resolved where answered.
  - Factual corrections regardless of rulings: sitemap `/business/[business id]` →
    `/businesses/[businessHandle]` with the registry modules for kind business; the invoice-content
    sentence at PRODUCT_SPEC:703-706 aligned with :1194-1197 (released escrow; fee shown, not added);
    the stale "individual clients cannot lock escrow by card" text in database/finance/Tables.md
    :635-638 and Functions.md:243-244 aligned with #126 / #165(D).

ACCEPTANCE:
  - Row 230 exists and is indexed; every later prompt's 🧑 references it.
  - grep -rn "/business/\[business id\]" documentation/ → no hits.
```

---

## 3. Wave 1 — Authority and spend integrity

### BB1 — Persona gate, acting-context flags and real nav facts

```text
PROMPT BB1: Business persona per #230(a); a business context is always a client context; nav reads
real facts

ROLE: Full-stack engineer. BUSINESSES_AUDIT BF2, BF3, BF4; #230 (a); #61 (a).

FILES:
  - supabase/migrations/00001700_*.sql (access-token hook, business context :157-166)
  - supabase/migrations/00001020_functions_org_entities.sql (create_workspace — only if (a) ≠ [1])
  - supabase/probes/business_context_flags.sql (new)
  - apps/web/features/shell/core/actions-model.ts (:30, :46-47) + a test
  - apps/web/features/shell/core/nav-model.ts (:95) + nav-model.test.ts
  - apps/web/features/shell/core/nav-fixtures.ts (:63-64, :121-126, :141)
  - apps/web/features/shell/core/effective-context.ts (if the session facts are assembled there)
  - packages/backend/services/* that build the session/context payload (find where isClient,
    isFreelancer reach the shell)
  - apps/web/features/devtools/*, apps/web/utils/dev-seam.ts (only if a new axis appears)
  - documentation/reference/decisions (#16/#18 wording), PRODUCT_SPEC per #230(a)

SPEC:
  1. Access-token hook: in a business context stamp isClient = true and isFreelancer = false for
     the context (the person's own flags stay on the personal claims). Probe: a freelancer switching
     into a business context gets context isClient=true; switching back restores.
  2. Create Business predicate per #230(a). With [1]: shown to every adult not in a restricted
     account and not in an enterprise context; update the doc comment (:30) — Business is a
     buyer surface. With [2]/[3]: add the matching DB refusal in create_workspace for p_kind =
     'business' with a typed code and mirror it in the predicate (one exported function used by
     both actions-model and nav-model).
  3. Replace ACCOUNT_CAPABILITIES with real facts: belongsToBusiness = the session has ≥1 active
     business membership; businessAccountEnabled = the person may create one (predicate above)
     AND has businesses_owned headroom (read the entitlement the roster already meters,
     live-roster.ts:146). Keep nav-fixtures only for dev:mock, behind the existing seam.
  4. showBusinesses = belongsToBusiness || businessAccountEnabled || isBusinessCtx.

ACCEPTANCE:
  - nav-model and actions-model tests: client adult, freelancer, minor, enterprise context,
    business member without create headroom — each gets the expected Businesses link and Create item.
  - Probe passes; no seller surface (Services, Products, Teams create) is shown in a business context.
```

### BB2 — One capability per act: `purchase`, `hire`, `manage_projects`, funders

```text
PROMPT BB2: Enforce purchase / hire / manage_projects on every business door; give funders their own
predicate

ROLE: Postgres engineer (authorization). BUSINESSES_AUDIT BF13, BF14, BF15, BF23, §4.2.

FILES:
  - supabase/migrations/00001100_functions_projects_read_access.sql (create_project :74-540,
    has_project_access :661-745 — READ ONLY, can_review_project :927-940)
  - supabase/migrations/00001130_functions_projects_stages.sql (assign_from_application ~:1404,
    accept/decline application doors)
  - supabase/migrations/00001140_functions_projects_automation_workload.sql (assign_ticket_manual,
    assign_parallel_stream :467-489)
  - supabase/migrations/00001150_functions_projects_stage_funding_submissions.sql (fund_stage :783+,
    fund_ticket, fund_paid_revision, submission accept/approve doors)
  - supabase/migrations/00001230_*.sql (begin_card_payment escrow_lock branch)
  - supabase/migrations/00001210_functions_finance_kyc_wallet.sql (place_wallet_order — `purchase`)
  - supabase/migrations/00002510_permissions_function_grants.sql
  - supabase/probes/business_authority.sql (new)
  - packages/backend/services/project/*, finance/live-buyer.ts (map new refusal codes)
  - documentation/database/projects/Functions.md, documentation/database/finance/Functions.md

SPEC:
  1. projects.fn_business_actor_can(p_project uuid, p_cap org.workspace_capability) RETURNS boolean
     (definer, STABLE): true when the caller is the project's owner_user_id; else, when
     client_business_id IS NOT NULL, org.fn_member_can('business', client_business_id, p_cap);
     else false. Personal projects keep today's owner-only behaviour.
  2. Hiring doors (assign_from_application, accept application, assign_ticket_manual,
     assign_parallel_stream, invite-to-seat if present): require fn_business_actor_can(project,
     'hire') for business projects, ERRCODE 'PK403' 'missing_permission: hire'.
  3. Review doors that RELEASE money (accept/approve submission, approve-and-release): same 'hire'
     check. Pure reads and comments keep can_review_project (do NOT narrow can_review_project
     itself — it gates reads of /details and /preview, Decision #163).
  4. create_project with a client_business_id: require 'manage_projects' and (BB5) an active
     business.
  5. place_wallet_order with a business payer: require 'purchase' (workspace) in addition to vault
     'spend'.
  6. Funding: projects.fn_can_fund_project(p_project) = owner OR (business project AND
     finance.fn_has_vault_capability(<the business wallet in the project currency>, 'spend')).
     fund_stage / fund_ticket / begin_card_payment(escrow_lock) replace their has_project_access
     check with it. has_project_access is NOT widened (it is granted to anon and gates reads).
  7. Typed refusals map to 403 in the backend with codes hire / purchase / manage_projects /
     not_funder; UI copy comes later (BU6).

ACCEPTANCE (probe with seeded business owner, admin, member, custom "Finance" role with spend only):
  - member cannot hire, assign, accept an application or approve a submission → missing_permission.
  - admin can; owner can; the project owner (a member who created it before this change) can.
  - member cannot create a project billed to the business; admin can.
  - custom spend-only role CAN fund a stage on a business project (previously refused) but cannot hire.
  - member without purchase cannot place a business basket order.
  - All /details and /preview reads unchanged for members (regression probe on can_review_project).
```

### BB3 — One spend gate on every door

```text
PROMPT BB3: finance.fn_assert_business_spend — actor envelope counted once, threshold with fallback,
KYB — called by every door that moves business money

ROLE: Postgres engineer (money integrity). BUSINESSES_AUDIT BF19, BF21, BF22, §4.2.

FILES:
  - supabase/migrations/00001200_*.sql (fn_check_spending_limit :~262; fn_hold_ticket_escrow :432;
    fn_hold_revision_escrow :616)
  - supabase/migrations/00001210_functions_finance_kyc_wallet.sql (place_wallet_order :1440-1470,
    transfer_funds :1720-1745, request_spend_approval :2228-2294)
  - supabase/migrations/00001150_*.sql (fund_stage, fund_ticket, fund_paid_revision)
  - supabase/migrations/00001230_*.sql (begin_card_payment / settle_card_payment escrow_lock)
  - supabase/migrations/00001250_*.sql (fn_auto_fund_drain :226-252, place_on_account_order :451-517)
  - claim-lock triggers that hold escrow (00001110:136, 00001130:704 — read and route through the gate)
  - supabase/probes/business_spend_gate.sql (new)
  - documentation/database/finance/Functions.md, documentation/business/finance-model.md §387-389

SPEC:
  1. finance.fn_business_threshold(p_wallet uuid) RETURNS bigint: COALESCE(wallet.approval_threshold_cents,
     platform 'vault_approval_threshold_cents', 0). Every threshold read uses it (place_wallet_order,
     request_spend_approval, fn_auto_fund_drain).
  2. finance.fn_assert_business_spend(p_wallet uuid, p_actor uuid, p_amount bigint, p_ref_table text,
     p_ref_id uuid, p_count_envelope boolean DEFAULT true) — definer, no return, raises typed:
     (a) wallet owner is a business; else return (team/personal paths unchanged);
     (b) KYB: finance.fn_business_kyb_verified(owner) else 'PK403 kyb_required';
     (c) envelope: when p_count_envelope, fn_check_spending_limit(p_wallet, p_actor, p_amount) else
         'PA403 over_limit' — the ACTOR, never the project owner;
     (d) threshold: when threshold > 0 AND amount ≥ threshold → call the approval redeemer from BB4
         (until BB4 lands, raise 'PA403 needs_approval' — exactly today's basket behaviour).
  3. Call sites: place_wallet_order, place_on_account_order, transfer_funds (source = business),
     fund_stage, fund_ticket, fund_paid_revision, card escrow_lock (at begin, re-checked at settle),
     and the escrow holds. Count the envelope ONCE: the earliest door the actor touches counts it
     (p_count_envelope = true) and passes a flag/ref down so the downstream hold calls with
     p_count_envelope = false. A basket ticket line therefore counts once, against the buyer.
  4. Automatic holds with no human actor (claim-lock triggers, auto-fund drain): actor = the project
     owner (today's spender) and the threshold path uses the existing auto-fund approval flow.
  5. Keep error codes stable where they exist (PA403, PK403, PF402) and add the sub-code prefix in
     MESSAGE so the backend can map them (needs_approval / over_limit / kyb_required).

ACCEPTANCE (probe):
  - Unverified business: fund_stage, fund_ticket, fund_paid_revision, card escrow lock all refuse
    kyb_required (previously succeeded).
  - Platform threshold set, wallet threshold NULL: basket and fund_stage at/above it → needs_approval
    (previously passed).
  - A member funding a stage counts against THEIR envelope; the project owner's spent_cents unchanged.
  - Basket ticket line: spent_cents increases by the net exactly once.
  - Team and personal funding paths unchanged (regression cases).
```

### BB4 — Approval redemption

```text
PROMPT BB4: Spend approvals bind to what they approve and are consumed exactly once

ROLE: Postgres + service engineer. BUSINESSES_AUDIT BF20, BF44, §4.3; needs BB3.

FILES:
  - supabase/migrations/00000017_tables_finance.sql (finance.spend_approvals :495-509 — edit in place:
    amount_cents NOT NULL, currency, consumed_at timestamptz NULL, consumed_ref_table, consumed_ref_id;
    ref_table/ref_id NOT NULL with a CHECK on allowed ref tables)
  - supabase/migrations/00004005_indexes_finance.sql (partial index on approved & unconsumed)
  - supabase/migrations/00001210_functions_finance_kyc_wallet.sql (request_spend_approval,
    decide_spend_approval :1909-1966, the redeemer)
  - supabase/migrations/00001250_*.sql (fn_auto_fund_drain consumes through the same redeemer)
  - supabase/seeds/* that insert spend_approvals (keep db:reset green)
  - supabase/probes/spend_approval_redemption.sql (new)
  - packages/types/finance/* (SpendApproval schema), packages/backend/services/finance/wallet-actions.ts
    (:420-436 requestSpend — send the ref), live-buyer.ts (:526-532)
  - apps/web/routes/api/** for spend requests (Zod: ref required)
  - documentation/database/finance/Tables.md + Functions.md

SPEC:
  1. Allowed refs: 'baskets' (checkout), 'tickets', 'project_stages', 'revisions', 'invoices',
     'transfers'. A request stores the amount and currency it was filed for.
  2. request_spend_approval: refuse team wallets (BF44 — teams never hold approve_spend); require a
     ref; refuse a duplicate pending request for the same (wallet, ref).
  3. finance.fn_redeem_spend_approval(p_wallet, p_actor, p_amount, p_ref_table, p_ref_id): finds an
     approved, unexpired, unconsumed request for (wallet, ref) with amount_cents ≥ p_amount, filed by
     p_actor (or any member for automatic refs), locks it FOR UPDATE, sets consumed_at and
     consumed_ref_*; returns true. Otherwise raises 'PA403 needs_approval' with the ref in DETAIL so
     the app can offer "Request approval" bound to it.
  4. fn_assert_business_spend (BB3) calls the redeemer on the threshold path. fn_auto_fund_drain uses
     the same redeemer instead of its own status scan.
  5. decide_spend_approval: unchanged authority; an already-consumed or expired request cannot be
     re-decided; on approve it no longer special-cases tickets except to kick the drain.
  6. Service/API: requestSpend takes { walletRef, refTable, refId, amountMinor, reason } (Zod); the
     checkout refusal carries { refTable: 'baskets', refId } so BP2 can file against it.

ACCEPTANCE (probe):
  - Approve a basket request for €600 → the next place_wallet_order for that basket at €600 passes;
    a second order for the same basket at €600 needs approval again (consumed).
  - An approval for €500 does not cover a €600 charge.
  - Requester cannot approve; expired request cannot be redeemed; team wallet request refused.
  - Auto-fund drain still funds an approved ticket exactly once.
```

---

## 4. Wave 2 — Lifecycle, vault, entitlements

### BB5 — Active-only transacting, archive blockers, visibility

```text
PROMPT BB5: Only an active business transacts; archive lists every blocker; businesses gain visibility

ROLE: Postgres engineer. BUSINESSES_AUDIT BF7, BF8, BF9, BF48, §4.4; #230 (h); open #226 (c).

🧑 DECISION — if #230 (h) chose "every business stays listed", skip step 4.

FILES:
  - supabase/migrations/00000011_tables_org.sql (org.business_profiles — add `visibility` IN PLACE,
    same values/CHECK as org.teams)
  - supabase/migrations/00001020_functions_org_entities.sql (set_workspace_status :1045-1117;
    create_workspace insert; update_workspace accepts visibility for business)
  - supabase/migrations/00001100_*.sql (create_project), 00001150_*.sql, 00001210_*.sql, 00001250_*.sql
    (the money doors — through fn_assert_business_spend from BB3 where possible)
  - supabase/migrations/00003001_views_profiles_business.sql (:180, :206-211 listed)
  - supabase/probes/business_lifecycle.sql (new)
  - packages/types/workspace/workspace.ts (visibility for business; archive blocker codes)
  - packages/backend/services/workspace/live-writes.ts (map 55000 sub-codes)
  - documentation/database/org/Tables.md + Functions.md, documentation/PRODUCT_MANAGEMENT.md (:214)

SPEC:
  1. org.fn_assert_business_active(p_business uuid): 'status' = 'active' else
     '55000 business_not_active: publish the business first'. Called by create_project (business),
     fn_assert_business_spend (BB3 — so every money door inherits it), pay_invoice, the hiring doors
     (BB2), and set_invoicing_terms.
  2. Archive blockers for p_kind = 'business', each its own sub-code in MESSAGE:
     escrow_held (exists) · live_projects (client_business_id, status active/on_hold) ·
     pending_approvals · unpaid_invoices (issued/overdue) · on_account_owed · wallet_balance (> 0 in
     any currency) · pending_payouts. Check the real table/column names before writing.
  3. org.get_workspace_detail('business') returns `archiveBlockers: { code, count }[]` so Settings can
     show them before the confirm (BB9 consumes; Teams C6 pattern).
  4. Visibility: add the column; the directory view reads it (listed only when active AND
     visibility = 'listed'); create defaults to the same as teams ('invite_only').

ACCEPTANCE (probe): draft business cannot create a project, place an order, fund, hire or pay an
invoice; each archive blocker refuses with its code and is listed in the detail; an unlisted active
business is absent from the directory view; db:reset clean.
```

### BB6 — Vault and billing alignment, ledger completeness

```text
PROMPT BB6: manage_billing and the modules agree; card top-ups reach the contribution ledger; RLS
parity on business roles

ROLE: Postgres + app engineer. BUSINESSES_AUDIT BF25, BF29, BF30, BF39; #230 (d).

🧑 DECISION — #230 (d.1) is open: ask which acts the co-owner grant carries before step 5.

FILES:
  - apps/web/features/workspaces/core/module-registry.tsx (billing, verification, spend, finance gates)
  - supabase/migrations/00001020_*.sql (owner-granted billing right + co-owner grant per #230 (d);
    fn_vault_capabilities_for projects it to vault manage_billing)
  - supabase/migrations/00000004_*.sql (the new workspace capability, enum edited in place)
  - packages/types/workspace/* (capability vocabulary, PRESET_GRANTS unchanged)
  - supabase/migrations/00001230_*.sql (card top-up settle path — write ledger_audit add_funds)
  - supabase/migrations/00002010_policies_org.sql (:128-131 business_roles policy + is_admin() arm)
  - supabase/migrations/00002013_policies_finance.sql (:90-105 spending_limits / spend_approvals
    SELECT — narrow per step 4)
  - packages/backend/services/workspace/live-money.ts (:356-358 ledger read)
  - supabase/probes/business_vault_alignment.sql (new)
  - documentation/database/finance/*, documentation/database/org/*

SPEC:
  1. Registry gates for kind business (per #230 (d)): billing → manage_billing (vault);
     verification → manage_billing; spend → any of spend_funds, manage_finances, approve_spend (the
     registry permission becomes a predicate over caps, not one capability — extend its type);
     finance → contribute_funds OR spend_funds OR manage_finances. Export the same predicates for
     Overview (BU6) so a module and its Overview band never disagree.
  2. Card top-up settlement (wallet_topup) writes ledger_audit action 'add_funds' with the member
     and amount, exactly like transfer_funds does, in the same transaction.
  3. business_roles SELECT policy gains `OR security.is_admin()` (parity with the roster).
  4. spending_limits / spend_approvals SELECT: a member sees their OWN rows; holders of
     manage_finances / approve_spend / manage_members see all rows of the wallet. (A plain member
     reading every colleague's ceiling is a disclosure the screens never intended.)
  5. Per #230 (d), kind business only: the owner — and only the owner — may grant the billing right
     to a named admin, and may grant an admin the owner's own permission set (co-owner, per (d.1)).
     Never a second owner seat (fn_member_role_sync 23514 stands); the admin PRESET is unchanged.
     Both grants answer a typed confirm the UI shows as an explicit warning (BU7).

ACCEPTANCE: probe — card top-up appears in the ledger read; a plain member reads only their own
envelope and requests; an approver reads all; module-registry tests for each preset and a custom
approve-only role (can open Spend; sees the queue, not the editor).
```

### BB7 — Entitlement reads per #230 (b), (e), (f)

```text
PROMPT BB7: Enforce the business entitlements that are seeded but unread

ROLE: Postgres engineer (billing/entitlements). BUSINESSES_AUDIT BF33-BF36; #230 (b), (e), (f).

Per #230 (e): the checks run behind ONE footprint_caps_enforced-style platform parameter (name it,
e.g. business_plan_gates_enforced) SEEDED TRUE — the reverse of that family — and set per
environment. It is a new simulatable axis: add its Dev Context Switcher control (DevOverrides +
DEV_DEFAULTS, DevOption, DevContextPanel, reflect() set AND delete).

FILES:
  - supabase/migrations/00001220_functions_finance_billing_entitlements.sql (entitlement helpers,
    usage counters :633-647)
  - supabase/migrations/00001020_*.sql (fn_assert_seat — business_managers; invite/accept/role change)
  - supabase/migrations/00001210_*.sql (set_invoicing_terms — intervaled_invoicing; save_spend_policy —
    pooled_wallet_full for limits/threshold)
  - supabase/migrations/00005030_*.sql (seed values per #230 (f))
  - supabase/probes/business_entitlements.sql (new)
  - packages/backend/services/workspace/live-support.ts (402 mapping)
  - documentation/business/finance-model.md (§57, §469-483), documentation/database/finance/Tables.md

SPEC:
  1. business_managers (per #230(b) [1]): count active members whose effective role is admin or a
     custom role holding manage_projects; refuse invite/accept/role change that would exceed it with
     'PK402 entitlement: business_managers'. Pending invitations for such roles count (team parity).
  2. intervaled_invoicing: set_invoicing_terms to monthly requires it.
  3. pooled_wallet_full: setting a per-member ceiling or a threshold via save_spend_policy requires
     it (basic mode = shared wallet without caps), per finance-model:479.
  4. businesses_owned Pro = 3 per #230(f): the seed already agrees and finance-model §1.3 is fixed
     (BZ0); assert it in the probe.
  5. Every refusal is PK402 with the entitlement key in MESSAGE; the app maps 402 to an upgrade
     InlineNotice (copy in BU2/BU3).

ACCEPTANCE: probe per entitlement at free and pro; refusals carry the key; with the parameter off
nothing is refused; seeded, it is on.
```

---

## 5. Wave 3 — Routing and read model

### BB8 — Business console routing

```text
PROMPT BB8: /businesses routing — 308 canonical, /overview folded, one-hop missing redirect

ROLE: Fresh routing engineer. BUSINESSES_AUDIT BF40-BF42, §4.5; Teams prompt B6 (same contract).

If Teams B6 has landed, this prompt only verifies the business side and adds step 2; otherwise
implement B6's consoleOutcome split for both kinds here and tell me.

FILES:
  - apps/web/features/workspaces/core/workspace-route.tsx (+ workspace-route.test.ts)
  - apps/web/routes/(dashboard)/businesses/[businessHandle]/index.tsx, [module].tsx
  - apps/web/features/workspaces/core/module-registry.tsx (business primaryModules)
  - documentation/architecture/ROUTING.md (row 102)

SPEC:
  1. uuid / case variant → 308 (keep query); forbidden module → 303 (drop ?view=); combined → one 308.
  2. /businesses/:h/overview → 308 to /businesses/:h (for teams too).
  3. Missing / forbidden (index AND [module]) → ONE 303 to /businesses?notice=unavailable (no
     intermediate /businesses/<ref> hop).
  4. Business primary views (lane order): overview · members · projects · spend · billing · settings;
     secondary: finance, talent (per #230(i)), roles, invitations, verification, analytics, profile,
     calendar, messages — each still capability-filtered (BB6 predicates).

ACCEPTANCE: route tests for each case, both kinds; ROUTING.md updated.
```

### BB9 — Business console read model

```text
PROMPT BB9: get_workspace_detail('business') returns what the business screens need, server-decided

ROLE: Postgres + service engineer. BUSINESSES_AUDIT BD2-BD5, BD15, BD18-BD20, BF28; needs BB4-BB6.

FILES:
  - supabase/migrations/00001020_*.sql (get_workspace_detail business branch)
  - supabase/migrations/00001210_*.sql (a read-only finance.preview_spend_envelope)
  - packages/types/workspace/workspace.ts, policy.ts (+ contract test)
  - packages/backend/services/workspace/live-detail.ts, live-money.ts, mappers.ts (+ tests; the
    "Spent (30d)" stats at mappers.ts:332-344)
  - packages/backend/services/finance/BillingBackendService.ts (actions in the view)

SPEC — add to the business detail, every flag computed in SQL from the caller's capabilities:
  1. viewerCan: { editPolicy (manage_finances), decide (approve_spend & verified), requestSpend,
     payInvoice (manage_billing & verified & active), startKyb (manage_billing), hire, purchase,
     manageProjects, archive } — the UI renders from these; no client-side policy maths.
  2. spend: approvals { pending[], decided[] (last 30) } always present for viewers who may see
     them; limits[] with { memberHandle, capMinor, perTransactionMinor, period, spentMinor,
     remainingMinor, usedFraction, canSpend } where null cap means unlimited; approverHandles[],
     contributorHandles[].
  3. finance.preview_spend_envelope(p_business, p_patch jsonb) (read-only, manage_finances): returns
     the limits[] the patch WOULD produce, so a draft ceiling never renders against stale figures
     (BD2). Service exposes it at POST /api/workspace/spend/preview (thin route).
  4. kyb: { status, verifiedAt, connectOnboardingUrl? (only for startKyb holders, generated by the
     existing Connect onboarding service), requirementsDue[] }.
  5. archiveBlockers (from BB5).
  6. Money tiles from the server: available, pending, committed, awaitingApproval, spent30d per
     currency (all currencies, not just the largest).

ACCEPTANCE: mapper tests per preset; a plain member's payload has no other members' limits (BB6);
contract test green; one RPC per detail read (spy).
```

---

## 6. Wave 4 — Business screens (after the Teams UI foundation)

### BU1 — Roster, create, and the business kind hue

```text
PROMPT BU1: /businesses roster and create modal on the shared foundation; business hue per #230(j)

ROLE: Frontend engineer. BUSINESSES_AUDIT BD21-BD24; Teams R1, R3 must have landed.

FILES:
  - apps/web/features/workspaces/components/RosterEmpty.tsx (business copy :37-41, :69)
  - apps/web/features/workspaces/components/WorkspaceTable.tsx (:42-48 money column)
  - apps/web/features/workspaces/islands/CreateWorkspaceModal.island.tsx (:271-299 kind radio)
  - apps/web/features/workspaces/styles/workspace-tokens.css (:54, :76-88, :264-271, :305-306, :334-338)
  - apps/web/features/workspaces/styles/workspace-roster.css (:824-826)
  - apps/web/features/workspaces/components/EntityMark.tsx (:18 comment)
  - packages/types/workspace/common.ts (:283-285 pitch copy — keep, verify against PRODUCT_SPEC)

SPEC:
  1. Hue per #230(j): [1] --wsp-business = --tertiary (and its -on/-tint/-ink derived from it) in
     every mode; the CVD block no longer re-anchors business. Edge opaque; high-contrast values for
     tint, tint-hi, edge AND ink. Re-run the documented contrast numbers and update the comment
     (:76-77). Fix "ACCENT tint" wording (amber is --accent).
  2. Delete the unreachable kind radio and its CSS; the modal's kind is its route's kind.
  3. Empty state: EmptyState with "Hire as a company" + the three points as a MetaLine-free short
     list (body text), ONE tier-2 "Create a business" (structural). Placeholder name copy stays
     neutral ("Acme Studio"), not a real-sounding firm.
  4. Table: explicit columns Name · Your role · Members · Live projects · Spent (30d) (tabular,
     MoneyView per currency, multi-currency as MetaLine) · Status (Tag only when not active). No delta.

ACCEPTANCE: focus ring visible on every business-tinted mark in light/dark/HC (screenshot proof);
no translucent tokens left in the business block; exactly one filled control per roster state.
```

### BU2 — Spend governance screen

```text
PROMPT BU2: /businesses/:h/spend — editable approvers and contributors, honest envelopes, a working queue

ROLE: Frontend engineer (money UI). BUSINESSES_AUDIT BD1-BD13; needs BB3, BB4, BB6, BB9, Teams W1/L2.

FILES:
  - apps/web/features/workspaces/islands/SpendPolicyScreen.island.tsx
  - apps/web/features/workspaces/components/SpendLimitRow.tsx, ApprovalQueue.tsx, PolicyAmount.tsx
  - apps/web/features/workspaces/styles/workspace-money.css (spend, approvals, pool, lock sections)
  - apps/web/features/workspaces/core/WorkspaceService.ts (spend preview call)
  - apps/web/features/wallet/** (walletHrefFor — read; fix the access link)

SPEC — three sections, separated by --space-7 + one --hairline, no boxes; render from viewerCan:
  1. "Approval threshold": MoneyInput inside FormControl (min 1 minor unit; empty = off) with a
     MetaLine explaining the platform default when empty; plan-gated (BB7) → InlineNotice + tier-4
     "See plans".
  2. "Who can approve" and "Who can add money": two member pickers (Listbox multi-select or a
     selectable DataTable) listing active members the editor outranks; the owner shown as always
     able (Meta), self never editable. Warning "Nobody can approve" now comes from the server
     payload and links (tier 4) to the picker itself.
  3. "Member limits" as a <ul> of SpendLimitRow: name + MetaLine
     ("Spending off" | "€500 / month · €100 per purchase" | "No ceiling") with tabular figures;
     ProgressBar from remaining/used; edit expands inline: ToggleSwitch can-spend, MoneyInput cap,
     MoneyInput per purchase, period SelectButton (weekly · monthly · total), all in FormControl.
     While a draft differs, figures come from POST /api/workspace/spend/preview (BB9) and carry the
     `stale` marker until saved; spent is never shown as a ceiling.
  4. "Requests": TabMenu Pending · Decided, always rendered (empty states from ApprovalQueue).
     Pending rows on hairlines: requester, amount (tabular), reason, ref (what it is for — basket,
     stage, invoice — linked), expiry. Actions: the FIRST pending row's Approve is tier 3, others
     tier 4; Decline tier 5; the requester's own row shows "Waiting for a decision" with Withdraw
     tier 5. An approver on an unverified business sees the KYB InlineNotice with a link to the
     Verification module (BU4), not the requester copy. After a decision, re-read limits.
  5. Save: footer rig tier-3 Save (policy is wallet configuration — NOT amber).
  6. Fix accessHref to walletHrefFor("business", id, "access").
  7. useSignalEffect instead of the dirty/save-pulse effects; no inline style; no tooltip on
     non-focusable elements.

ACCEPTANCE: Playwright as owner / admin / approve-only custom role / member: each sees exactly the
controls viewerCan allows; editing a ceiling on an unlimited member never shows the spent amount as
the ceiling; one filled control per section; approver decision updates the meter without reload.
```

### BU3 — Billing screen

```text
PROMPT BU3: /businesses/:h/billing — one tier-1 Pay with a review step, real notices, FormControl terms

ROLE: Frontend engineer (money UI). BUSINESSES_AUDIT BD14-BD17, BF32; needs BB6, BB7, BB9.

FILES:
  - apps/web/features/workspaces/islands/BillingScreen.island.tsx
  - apps/web/features/workspaces/styles/workspace-billing.css
  - apps/web/features/wallet/** (the MoveDialog review pattern — read; reuse if exported)
  - packages/ui/feedback/** (only if promoting a CommitReview body — see step 2)
  - packages/backend/services/finance/BillingBackendService.ts (read)

SPEC:
  1. Invoices list (DataTable: period · issued · due · amount due tabular · status Tag · PDF link).
     ONE tier-1 <Button severity="accent" rounded> "Pay €X" for the oldest payable invoice in the
     band above the table; every other payable row has a tier-5 "Pay" that opens the same review.
     Hidden unless viewerCan.payInvoice; unverified/inactive → InlineNotice with a link to
     Verification / Settings.
  2. Review step before money moves: reuse the wallet MoveDialog review body (amount, source wallet,
     balance after). If it cannot be imported from apps/web/features/wallet cleanly, promote its
     review body to @projective/ui/feedback as CommitReview (props: rows, total, commitLabel,
     onCommit) — update DESIGN_SYSTEM §C.1. ConfirmDialog cannot host an accent commit (#157 o).
  3. Balance band: below the floor → InlineNotice severity warning with a tier-1 "Top up" that opens
     the wallet MoveDialog for the business wallet (starting a financial flow = tier 1). Only one
     filled control in that band.
  4. Terms form (invoicing mode SelectButton, billing day Select 1–28, auto-fund SelectButton, floor
     MoneyInput) in FormControl; plan-gated monthly mode → InlineNotice (BB7); copy "Issued on the
     {billing_day}" from data; save via the footer rig tier-3 Save.
  5. Remove the empty spacer span; band meta tabular; useSignalEffect for dirty/save pulse; the
     dev-seam subscription effect stays.

ACCEPTANCE: two payable invoices → exactly one amber control on the page; Pay always passes through
the review; admin without manage_billing (per #230(d)) cannot reach the module (BB6); 390px
screenshot shows fields ≥ 16px.
```

### BU4 — Verification (KYB) module

```text
PROMPT BU4: /businesses/:h/verification — a real KYB surface that ends the dead-end loop

ROLE: Full-stack engineer. BUSINESSES_AUDIT BF27, BF28, BD26; Decisions #126, #225(A); needs BB9.

FILES:
  - apps/web/features/workspaces/components/ModuleScreen.tsx (:160-168)
  - apps/web/features/workspaces/islands/BusinessVerificationScreen.island.tsx (new) + styles
  - apps/web/features/workspaces/components/VerificationLock.tsx (:75-105, :98)
  - packages/backend/services/finance/* (the existing Connect onboarding / payout-account service —
    find the one the personal /settings/verification uses, Decision #225; reuse it for owner_type
    'business')
  - apps/web/routes/api/** (a thin POST to start/continue business onboarding, if none exists)
  - reference: apps/web/features/settings/** verification screen (#225)

SPEC:
  1. Status header: Tag (Unverified · In review · Verified · Action needed) + MetaLine (verified on
     date | requirements due count). Verified crest glyph per #225 rules.
  2. Primary action (one filled): "Verify {business}" / "Continue verification" — TIER 3 (#225(A):
     a business's KYB gates its vault, it does not receive money) — for viewerCan.startKyb only;
     others see Meta "Ask the owner to verify the business".
  3. Requirements list from requirementsDue[] as plain rows; what verification unlocks as a short
     list (fund and spend from the pooled wallet, monthly invoicing, withdrawals — from
     PRODUCT_SPEC:2448-2456 / finance-model:289; no new claims).
  4. VerificationLock links here; delete the hard-coded "two working days" copy unless a doc states
     it; ModulePlaceholder no longer used for verification; fix its stale "Billing is next" doc.

ACCEPTANCE: every "Finish KYB" / "Verify" link in the console lands on a working screen with an
action for the owner; Playwright as owner (start → redirected to the Connect onboarding URL mock in
dev) and as admin (no action, explanation).
```

### BU5 — Talent module per #230 (i)

```text
PROMPT BU5: /businesses/:h/talent — the bench (or remove the module)

ROLE: Full-stack engineer. BUSINESSES_AUDIT BF43; #230 (i).

🧑 DECISION — if #230 (i) chose "remove", delete the registry entry, its glyph and any links, add a
308 from /talent to the console root, and stop.

FILES:
  - supabase/migrations/00001020_*.sql or a projects read file (a definer read
    org.get_business_bench(p_business) — members with `hire` only)
  - packages/types/workspace/* (Bench schema), packages/backend/services/workspace/* (+ test)
  - apps/web/routes/api/workspace/bench.ts (thin) — or fold into the detail if small
  - apps/web/features/workspaces/islands/TalentScreen.island.tsx (new), components/BenchRow.tsx (new)
  - apps/web/features/workspaces/components/ModuleScreen.tsx

SPEC:
  1. The bench = freelancers and teams with ≥1 completed or live engagement on a project whose
     client_business_id is this business: handle, display name, kind, engagements count, last
     worked (date), aggregate rating the business gave (if any), live now (boolean). Slugs/handles
     only.
  2. Screen: DataTable (Name + Avatar · Kind as text · Engagements tabular · Last worked · Rating) +
     row ActionMenu: View profile (/:handle), Message, Add to project (tier 2 in the row menu is a
     menu item — no filled buttons in rows). Empty state: one sentence + tier-4 link to /explore.
  3. Gate: hire (registry already).

ACCEPTANCE: seeded business with two past freelancers lists both; member without hire is 303'd.
```

### BU6 — Overview and Finance business branches

```text
PROMPT BU6: Business Overview and Finance — server-decided money visibility, honest tiles, typed refusals

ROLE: Frontend engineer. BUSINESSES_AUDIT BD18, BD19, BD25; needs BB2, BB6, BB9; Teams C1.

FILES:
  - apps/web/features/workspaces/islands/WorkspaceOverview.island.tsx (:75-76, :237, :260, :270)
  - apps/web/features/workspaces/components/FinanceSummary.tsx (:38-80)
  - apps/web/features/workspaces/components/ModuleScreen.tsx (finance :86-95)
  - apps/web/features/workspaces/core/workspace-model.ts (canSeeMoney from BB6 predicates)
  - apps/web/features/workspaces/styles/workspace-tokens.css (PolicyAmount weights :401-416)

SPEC:
  1. Overview money band shows when the Finance module is openable (same predicate); tiles from
     BB9 (Available · Committed · Awaiting approval · Spent 30d) per currency; no duplicate
     Available in the moneyhead; FinanceSummary link only when canOpen.
  2. Business setup hero (Teams C1 pattern) steps: Invite a colleague · Verify the business (→ BU4)
     · Add money (tier 1 "Add money" starts the wallet MoveDialog — the act that starts a financial
     flow) · Set spending rules (→ Spend) · Publish. ONE filled control in the hero at a time
     (the next step's action); when the next step is "Add money" that is the amber one.
  3. Finance module: keep the hand-off to the pooled wallet but as a real screen header with the
     balance MetaLine and a tier-4 "Open the business wallet" link (walletHrefFor business) — not a
     placeholder.
  4. Refusal copy for BB2/BB3/BB4/BB5 codes (hire, purchase, manage_projects, not_funder,
     kyb_required, over_limit, needs_approval, business_not_active, entitlement) in one map in
     workspace-model.ts, used by every business screen's InlineNotice.
  5. PolicyAmount figures at --fw-medium.

ACCEPTANCE: member (contribute only) sees the money band iff Finance is openable; each refusal code
renders its sentence (unit test over the map).
```

### BU7 — Members and Roles: business specifics

```text
PROMPT BU7: Business members and roles — no lead, envelope visibility, manager cap, PM/Observer templates

ROLE: Frontend engineer. BUSINESSES_AUDIT BF11, BF12, BF35, BD20; #230 (b); Teams C2, C3 landed.

FILES:
  - apps/web/features/workspaces/components/MemberCard.tsx (:764-781), MemberTable.tsx
  - apps/web/features/workspaces/islands/MemberDrawer.island.tsx (:359-366), RolesMatrix.island.tsx (:406),
    InviteModal.island.tsx
  - apps/web/features/workspaces/core/module-registry.tsx (capability groups for business)

SPEC:
  1. Members DataTable business columns: Member · Role · Spending (MetaLine "€500 / month" | "No
     ceiling" | "Spending off", tabular; visible only to viewers who may see others' envelopes, BB6)
     · Joined · row ActionMenu. No Stake/Workload columns for business.
  2. Drawer: the spend envelope section always renders for viewers with editPolicy, showing the
     MetaLine and a tier-5 "Edit in Spend" link (deep link to the member's row); read-only for others.
  3. Roles: PermissionMatrix rows = the capabilities the BUSINESS kind renders (exclude bind_seat,
     publish_listings — import the filtered list). Presets owner · admin · member only (never lead).
     Per #230(b) [1]: the role editor offers "Project Manager" (base admin minus withdraw/finance) and
     "Observer" (base member, view_analytics only) as templates — data, not presets.
  4. business_managers headroom (BB7) as a MetaLine in the Members header ("2 of 2 managers") and an
     InlineNotice + upgrade link when an invite/role change would exceed it.

ACCEPTANCE: no "lead" anywhere in a business console; manager cap notice shown at the limit;
templates produce custom roles that pass the server's grant-what-you-hold rule.
```

---

## 7. Wave 5 — Buyer storefront and checkout

### BP1 — Business public profile `/:handle`

```text
PROMPT BP1: A business's /:handle is a buyer profile — Message primary, Corporate verified, Client
Trust Score, no Standing; respects visibility

ROLE: Frontend + platform engineer. BUSINESSES_AUDIT BF45-BF48; PRODUCT_SPEC:490-521, :2240-2242,
:2326-2349; needs BB5 (visibility).

FILES:
  - apps/web/routes/[handle]/index.tsx, [tab].tsx, _layout.tsx (read first)
  - apps/web/features/profile/components/tabs/WorkTab.tsx, components/work/WorkRoster.tsx,
    ClientProofStrip.tsx, ReviewsTab.tsx
  - apps/web/features/profile/** header rig / conversion lane composition
  - packages/backend/services/profile/* (business read)
  - documentation/business/PRODUCT_SPEC.md (:591 editor wording per #226(b)/#230)

SPEC:
  1. Visibility: draft, archived, or non-listed (BB5) → 404 for strangers (worded as missing);
     members see it with an InlineNotice + tier-4 link to Settings.
  2. Lane/header: a buyer cannot be hired — Message is the primary (tier 3), Follow tier 4
     icon-only; no Hire, no Add to project, no price controls. Editors (edit_profile) see
     "Manage business" tier 4 → /businesses/:h.
  3. Trust: "Corporate verified" crest when kyb verified (verification_tier 3); Client Trust Score
     readout; NO Standing block (buyers carry none).
  4. Work: client proof (completed projects the business commissioned, public ones only), roster
     rows with MetaLine (role · since) — no chips; reviews = one aggregate per business–freelancer
     engagement, as given by freelancers about the business.

ACCEPTANCE: no Hire control on any business profile; crest only when verified; unlisted business is
404 to a stranger; Playwright at three widths.
```

### BP2 — Checkout "needs approval" flow

```text
PROMPT BP2: Checkout as a business — request approval bound to the basket, redeem it, contribute when short

ROLE: Full-stack engineer (checkout). BUSINESSES_AUDIT BF20, BF24; needs BB3, BB4; #230 (c).

FILES:
  - packages/backend/services/finance/live-buyer.ts (:526-532), wallet-actions.ts (:420-436)
  - apps/web/features/basket/** and apps/web/features/checkout/** (find the business-payer path)
  - apps/web/routes/api/** checkout + spend request routes (Zod)
  - documentation/flows/* (checkout flow doc, if present), documentation/business/PRODUCT_SPEC.md
    (§1209-1267 per #230 (c))

SPEC:
  1. needs_approval refusal (BB4 DETAIL carries refTable 'baskets' + refId): the checkout shows an
     InlineNotice "This order needs approval from {approvers}" and ONE tier-3 "Request approval"
     that opens a reason Textarea (1–400) and files the bound request — never a link to /spend.
     Pending → the checkout shows "Waiting for approval" with the request's expiry; approved → the
     amber Place order is enabled again and the next attempt redeems the approval.
  2. over_limit → InlineNotice with the member's remaining envelope (from the refusal DETAIL).
  3. kyb_required → InlineNotice with a link to the business Verification module (BU4) for
     startKyb holders; others "Ask the owner to verify the business".
  4. Pool short per #230(c): [1] InlineNotice + tier-1 "Add money" (contribute_funds holders) that
     opens the wallet MoveDialog for the business wallet, then returns to checkout; never offers a
     personal card for a business order. [2]/[3] add the on-account route when eligible.
  5. All copy from the BU6 refusal map.

ACCEPTANCE: Playwright: member over the threshold requests approval, approver approves in /spend,
member places the order once; a second identical order needs a fresh approval; unverified business
cannot place the order and sees the verification path.
```

---

## 8. Last — Docs and verification

### BZ1 — Businesses docs sweep

```text
PROMPT BZ1: Businesses docs sweep after every prompt above has merged

ROLE: Documentation steward.

FILES:
  - documentation/business/PRODUCT_SPEC.md (§647-725 Businesses, §1183-1267 billing/spend, sitemap)
  - documentation/business/finance-model.md (spend governance, approval redemption, entitlements)
  - documentation/PRODUCT_MANAGEMENT.md (business lifecycle row: active-only transacting, blockers,
    visibility; spend-approval lifecycle pending → approved → consumed | declined | expired)
  - documentation/database/org/*, documentation/database/finance/*, documentation/database/projects/*
  - documentation/design-system/DESIGN_SYSTEM.md (§C.1 if CommitReview was promoted; the business
    hue note per #230(j))
  - documentation/architecture/BUSINESSES_AUDIT.md (Status column: Fixed by <prompt> / Open)
  - documentation/reference/decisions/* (#229 flags marked resolved by #230 or later)

SPEC: rollup, not restatement; the spend-approval "consumed" state is a lifecycle change and lands in
PRODUCT_MANAGEMENT.md; no blank Status cells.

ACCEPTANCE: every new function/column/trigger from BB1–BB9 appears in documentation/database/*; the
#16/#18 "seller surface" wording for Business is gone or marked superseded by #230(a).
```

### BZ2 — Cross-surface verification pass

```text
PROMPT BZ2: End-to-end verification of /businesses, the console, checkout and /:handle

ROLE: QA engineer. Read-only except fixes ≤ 10 lines; larger findings → decision row + note to me.

STEPS:
  1. deno task db:reset; deno task test; run every probe added by BB1–BB9.
  2. Playwright with seeded personas: client adult, freelancer, minor, business owner, admin, member,
     custom approve-only and spend-only roles, a member of an UNVERIFIED business, a member of a
     DRAFT business. For each: /businesses, /businesses/create, every primary module, a forbidden
     module, the uuid URL, /:h/overview, the business /:handle, and a business checkout above the
     threshold. Assert redirects (303/308), refusal codes and visible controls against
     BUSINESSES_AUDIT §1 and Decision #230.
  3. Money integrity script: as the spend-only role fund a stage (passes, own envelope counted once);
     as a member hire (refused); as an unverified business fund a stage (refused kyb_required);
     approve a basket request and redeem it once.
  4. Design gates per page at 1440/900/390 × light/dark/HC × data-motion reduced: ≤ 1 filled control
     per region (tier-1 + tier-2 pair allowed); no alpha < 1 region backgrounds; headings ≤ 500
     (section labels ≤ 600); tabular-nums on every figure; press transforms are scales and none
     under reduced motion; axe zero serious/critical; focus ring visible on business-tinted marks;
     inputs ≥ 16px at 390.
  5. Write results into BUSINESSES_AUDIT.md §6 "Verification (date)"; screenshots in the scratch
     directory, not committed.

ACCEPTANCE: every row green, or each red row has a decision entry and an owner.
```
