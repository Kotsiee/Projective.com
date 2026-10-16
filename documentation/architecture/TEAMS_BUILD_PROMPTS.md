# Teams Build Prompts — Claude Code Work Orders for `/teams` and `/teams/:teamHandle`

> **Status: WORK ORDERS, not binding.** A sequenced series of self-contained Claude Code prompts that
> rebuild and harden the Teams roster (`/teams`), the team console (`/teams/:teamHandle[/:module]`)
> and the team storefront (`/:handle`). Every prompt cites its evidence in
> [`TEAMS_AUDIT.md`](TEAMS_AUDIT.md) (finding IDs `F*`, `P*`, `S*`, `A*`, `W*`, `B*`, `D*`) and
> Decision #226. Paste each prompt into its **own fresh session**, after the standard header (§1).
>
> **Before you start:** merge the branch that adds `TEAMS_AUDIT.md` and this file — every prompt
> cites them. Run the prompts in the §0 order. A prompt marked **🧑 DECISION** must stop and put the
> named question to a human before it changes behaviour; it presents options with a recommendation.

---

## 0. Run order & dependencies

| Wave | Prompts | Why this order |
| :-- | :-- | :-- |
| **0 — Rulings** | T0 | Records the owner rulings this brief carries, so later prompts cite a decision instead of re-arguing it. |
| **1 — Backend gates** (any order) | B1, B2, B3 | Persona gate, apply-path hardening, vault backstop + transfer gate. Pure DB/service; no UI dependency. |
| **2 — Money & read model** | B4 → B5, B6, B7 | `save_split_rule` before its property tests; the routing and read-model work feed every console screen. |
| **3 — `packages/ui` primitives** | U1 → U2, U3, U4 | Tokens + `MetaLine` first; the rest consume them. |
| **4 — Feature CSS foundation** | W1 | Token sweep of `features/workspaces/styles/` so every later UI prompt edits a clean sheet. |
| **5 — Chrome** | L1 → L2 | The lane, then the header band + footer rig that share its zones. |
| **6 — Roster** | R1, R2, R3 | `/teams`, the invitation strip, the create modal. |
| **7 — Console modules** | C1, C2, C3, C4, C5, C6 | Overview · Members · Roles · Payouts · Projects · Settings. C4 needs B4; C5 needs B7. |
| **8 — Storefront** | P1 | `/:handle` for a team. |
| **Last** | Z1, Z2 | Docs sweep, then the cross-surface verification pass. |

Prompts that may **not** run in parallel because they edit the same files: L1/L2 (chrome islands) ·
C2/C3 (`MemberDrawer`, `RolesMatrix`) · W1 with any UI prompt (stylesheets).

---

## 1. Standard header — paste above EVERY prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types the
Zod SSOT @projective/types; packages/backend fat services @server/services/*; supabase/migrations
Postgres with RLS everywhere).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (at least
     documentation/CLAUDE.md, packages/ui/CLAUDE.md, documentation/database/CLAUDE.md when SQL
     changes), then documentation/reference/guardrails.md and documentation/reference/pr-checklist.md.
  2. Read documentation/architecture/TEAMS_AUDIT.md — the finding IDs cited below — and Decision
     #226 (+ #228 once T0 has landed) in documentation/reference/decisions/decisions-122-126.md.
  3. Grep documentation/reference/decisions/README.md for the surface you touch and read the
     decision files it names (at minimum #61, #154, #196, #208, #222, #224).
  4. Teams and Businesses share ONE implementation (WorkspaceKind, Decision #61). Every UI change
     must keep /businesses rendering correctly; a team-only rule is gated on kind === "team".

Hard rules (merge gates — reject your own diff if any fails):
  SSOT & architecture
  - @projective/types (packages/types/workspace/*, and finance/* / org/* where they exist) is the
    SSOT. A schema or RPC-contract change lands with its Zod schema, the backend mapper, and
    documentation/database/<schema>/* in the SAME change. Lifecycle changes also update
    documentation/PRODUCT_MANAGEMENT.md; business rules also update documentation/business/PRODUCT_SPEC.md.
  - Migrations are consolidated and EDITED IN PLACE (supabase/migrations/vvvvtooo_type_purpose.sql).
    Never append ALTER TABLE ADD COLUMN / ALTER TYPE ADD VALUE patches. Each statement goes in its
    category file: 0 schemas/enums/tables · 1 functions/rpcs/triggers · 2 policies/grants · 3 views ·
    4 indexes · 5 seed. Never drop columns/FKs of escrows, wallets or stages without asking me.
  - Thin routes (apps/web/routes/api/workspace/*): HTTP parse + Zod + auth guard ONLY. Logic, money
    maths and RPC calls live in packages/backend/services/workspace/* (WorkspaceBackendService +
    live-*.ts) and return ServiceResult<T> (Decision #10). The service is LIVE-ONLY (no fixture branch).
  - Islands (*.island.tsx) never import Supabase or @server/*; they call
    apps/web/features/workspaces/core/WorkspaceService.ts, which fetches /api/workspace/* only.
  - Signal-first state; useEffect only for external DOM reads/focus. No useState.
  - Path aliases only (@projective/ui/*, @features/*, @server/services/*); no cross-workspace ../../../.
  - Folders: components/ islands/ styles/ hooks/ wrappers/ types/ core/ (+ routes/, services/). No src/.
  - JSDoc on exports; // #region [Name] … // #endregion groupings; no meta-comments.
  UI (DESIGN_SYSTEM.md; root CLAUDE.md §3)
  - Pure CSS, strict BEM, token-only values (var(--*)): no hex/rgb, literal radius, duration, shadow,
    font-weight or breakpoint. No Tailwind, CSS-in-JS, inline style=, or UI-lib deps. The ONE
    seam is packages/ui's own styleVars() setting a custom property for a runtime-continuous value
    (ProgressBar's --progressbar-value is the precedent); feature code gets such values by using
    the ui component that owns them, never by writing style= itself.
  - Separation (§B.4): spacing (--space-7 above a section, --space-3 below its heading) → SOLID
    tonal step (--bg → --surface-1 → --surface-2) → type → one --hairline. Full borders only on
    interactive controls. No color-mix(…, transparent), no rgba, no opacity used to dim a state.
  - Anti-card (§B.9): static content is never boxed; no card inside a card or an elevated panel.
  - Anti-tag (§B.11): non-actionable metadata (roles, kinds, counts in prose, skills, limits) is
    inline --text-secondary text joined by " · " (use MetaLine once U1 lands). Containers only for
    controls (Chip/ToggleButton), lifecycle statuses (Tag), required disclosures (InlineNotice) and
    numeric count badges (Badge).
  - Glass (§B.4.3): no backdrop-filter anywhere in this feature.
  - Type (§A.4): display/title headings at var(--fw-medium) (500); the uppercase section-header
    register at var(--fw-semibold) (600); nothing heavier. Levels never differ by weight alone.
    Every figure, balance, stake, count and percentage is tabular-nums.
  - Button matrix (§B.8): ONE filled button per decision region (exception: tier-1 amber beside
    tier-2 monochrome). Tier 1 <Button severity="accent" rounded> for money movement only · Tier 2
    the monochrome structural tone (U2) for primary creation (Create team, Invite member when it is
    the region's commit) · Tier 3 <Button> (primary filled) for workflow commits (Save, Publish,
    Send invitation) · Tier 4 <Button severity="neutral" variant="outlined"> for utilities
    (Settings, Invite as a utility, Try again, Upload, Share) · Tier 5 variant="text" for Cancel,
    escape hatches and row actions. Destructive confirms use severity="danger".
  - Press (§B.12): every interactive control compresses with
    transform: scale(var(--btn-press-scale)) (0.97) or var(--btn-press-scale-icon) (0.92) for
    icon-only, on var(--dur-press); never moves padding/margin/inset/border-width/size; and is
    transform: none under BOTH @media (prefers-reduced-motion: reduce) and :root[data-motion="reduced"].
  - Fields (§A.7): @projective/ui/fields controls only (InputText, Select, Checkbox, RadioGroup,
    SelectButton, ToggleButton, SortControl, Textarea) wrapped in FormControl; --fld-* geometry
    (32/40/48), 16px type floor below --bp-md; validation paints only at rest after blur and clears
    on focus so the :focus-visible --focus-ring-shadow shows. Never `outline: none` without the ring.
  - A control that renders must do something (§3.11). A new/changed ui component updates the
    DESIGN_SYSTEM.md §C.1 roster in the same change.
  Product
  - Any new simulatable axis gets its Dev Context Switcher control in the same change: DevOverrides +
    DEV_DEFAULTS, DevOption list, DevContextPanel control, reflect() set AND delete
    (apps/web/features/devtools/, seam apps/web/utils/dev-seam.ts).
  - No bespoke statuses; nothing hard-deleted (archive).
  - A NEW contradiction between source docs: do not pick a side — add a decision row (newest
    documentation/reference/decisions/decisions-*.md + README index line) and ask me.

Verification: reproduce the defect first (a SQL probe under supabase/probes/ or a Deno unit test),
then fix, then run `deno task db:reset` (if SQL changed), `deno task check`, `deno task lint`,
`deno task test:unit`, and `deno fmt` on the files you touched only (never the whole tree). Four
theme-engine.test.ts failures are pre-existing (Decision #96(a)). For UI prompts also run
`deno task dev`, sign in as the seeded team owner (documentation/database/Seed.md), and capture
Playwright screenshots at 1440, 900 and 390 px wide in light and dark, plus one with
data-motion="reduced" — Chromium is at /opt/pw-browsers; do not run `playwright install`.
Commit on the branch you were given with a clear message; do not open a PR unless I ask.
```

---

## 2. Wave 0 — Rulings

### T0 — Record the owner rulings and correct the stale spec rows

```text
PROMPT T0: Decision #228 — Teams owner rulings, and the factual spec corrections

ROLE: Documentation steward. Docs only; no code.

CONTEXT: The Teams rebuild brief (2026-10-16) rules several questions Decision #226 left open.
Record them once so every later prompt cites #228 instead of re-arguing them.

FILES:
  - documentation/reference/decisions/decisions-122-126.md (append row 227)
  - documentation/reference/decisions/README.md (index line)
  - documentation/business/PRODUCT_SPEC.md (route table ~2975-2981; Teams persona §~153-161)
  - documentation/architecture/ROUTING.md (rows 98-101; the 303/308 sentence)
  - documentation/PRODUCT_MANAGEMENT.md (:194 Teams row — decision citation only)
  - documentation/architecture/SYSTEM_ARCHITECTURE.md (:1747), documentation/database/org/Functions.md
    (:579), documentation/database/org/Tables.md (:226) — decision citation only

SPEC — Decision #228 records these OWNER RULINGS (quote the brief as the source):
  (A) Persona: /teams*, the Create Team action and every team write are freelancer-only. Client and
      operator (org.users_public.is_operator = true) accounts are refused in the app AND the
      database. RESOLVES #226 (g).
  (B) URL identity: a uuid (or non-canonical-case handle) in :teamHandle answers 308 to the
      canonical handle; a module the viewer may not open stays 303 (viewer-dependent, uncacheable).
  (C) The console's primary views are Overview · Members · Projects · Payouts · Roles · Settings
      (/teams/:teamHandle, /members, /projects, /payouts, /roles, /settings). The other ModuleKey
      modules stay reachable (they are real) but render in the lane's secondary group.
  (D) Tier 2 for LaneCreateButton: the lane's create action is the §D.7.7 monochrome structural
      tone on EVERY lane (Projects, Catalogue, Messages, Teams, Businesses) — DESIGN_SYSTEM
      §B.8.1 already lists it as tier 2; the component's teal fill is the drift.
  (E) Apply paths refuse a team that is not `active` or holds fewer than two active members, on
      both apply_to_project and apply_to_seat.
  (F) Split templates are writable (finance.save_split_rule); dust stays with the Team Vault.
  (G) The DataTable in @projective/ui/display is "the Table" the brief names (Decision #224).
  Still OPEN after #228 (list them; later prompts stop on them): #226 (a) Contributor role,
  (b) lead vs edit_profile, (c) restore target, (d) which templates are Pro-only, (f) the team
  member preset, (h) team W_i column.

FACTUAL CORRECTIONS (not rulings — they align stale prose with the code):
  - PRODUCT_SPEC route table: replace `/teams/[team id]` + `index · members · settings · projects ·
    vault` with `/teams/[teamHandle]` + the (C) list, linking ROUTING.md rows 98-101.
  - PRODUCT_SPEC persona: state (A).
  - ROUTING.md: state (B) beside the existing 303 sentence.
  - The five "Decision #122" citations for the 2026-09-28 live console: re-cite to #61 (the console
    decision) — #122 is the wallet. RESOLVES #226 (i) and (j).

ACCEPTANCE:
  - Row 227 follows the table format of rows 217-226 and is indexed in README.md.
  - grep -rn "teams/\[team id\]" documentation/  → no hits.
  - grep -rn "Decision #122" documentation/ | grep -i "console\|workspace" → no hits.
  - No code files changed.
```

---

## 3. Wave 1 — Backend gates

### B1 — Freelancer-only persona gate (DB + app + Dev Context Switcher)

```text
PROMPT B1: Persona gate — Teams are freelancer-only, refused for client and operator accounts

ROLE: Full-stack engineer (Postgres + Fresh middleware). Audit P2, P3, P4, P5; Decision #228 (A).

FILES:
  - supabase/migrations/00001020_functions_org_entities.sql (new helper + calls in
    create_workspace, respond_to_workspace_invitation, invite_workspace_member)
  - supabase/migrations/00001010_*.sql only if the helper belongs beside fn_assert_adult (check)
  - supabase/migrations/00002510_*.sql (grants for the helper, if it is callable)
  - supabase/probes/teams_persona_gate.sql (new)
  - packages/backend/services/workspace/live-support.ts (refusalFrom mapping)
  - packages/backend/core/* only if a shared refusal code table lives there
  - packages/types/workspace/common.ts (refusal code enum, if refusals are typed there)
  - apps/web/features/shell/core/restricted-surfaces.ts (+ .test.ts)
  - apps/web/routes/(dashboard)/_middleware.ts
  - apps/web/features/shell/core/actions-model.ts (:43-45) (+ a test)
  - apps/web/features/shell/core/nav-model.ts (:91-94) (+ nav-model.test.ts)
  - apps/web/features/shell/islands/UserActions.island.tsx (:630)
  - apps/web/features/devtools/* and apps/web/utils/dev-seam.ts (operator axis)
  - documentation/database/org/Functions.md, documentation/business/PRODUCT_SPEC.md

SPEC:
  DB
  1. Add org.fn_assert_team_persona(p_user uuid) (SECURITY DEFINER, search_path pinned) that raises
     ERRCODE 'PK403', MESSAGE 'persona_not_freelancer: Teams are for freelancer accounts' unless the
     user has an org.freelancer_profiles row AND org.users_public.is_operator IS NOT TRUE. Use the
     same row the payout gate reads (finance.fn_freelancer_payout_ready, F1210:17-29) so the two
     never disagree on "is a freelancer".
  2. Call it FIRST (before fn_assert_payout_ready, so the refusal names the real reason) in
     org.create_workspace when p_kind = 'team', in respond_to_workspace_invitation on accept for a
     team, and in invite_workspace_member for the INVITEE when resolved by handle (an email invite
     is checked at accept). Business kinds are untouched.
  3. Probe: a client-only user and an operator-mode freelancer both get PK403 persona_not_freelancer
     on create and on accept; a payout-ready freelancer still succeeds; an unready freelancer still
     gets payout_not_ready (ordering preserved).
  App
  4. restricted-surfaces.ts: add a persona rule — /teams and /teams/* are allowed only when the
     effective context isFreelancer && !isOperator, OR the acting context is a team (a member acting
     as the team). Middleware: a refused request 303s to "/" with ?notice=teams-freelancer (reuse the
     restricted-surface notice path; do not invent a new banner component).
  5. actions-model.ts createMenuOptions: offer "Create Team" only under the same predicate.
     nav-model.ts: make showTeams use the same exported predicate (one function, two callers) and
     drop the "unresolved is_operator ⁄ isFreelancer" comment for Teams only.
  6. live-support.ts refusalFrom: map persona_not_freelancer → 403 with code "persona" so
     CreateWorkspaceModal can show its own sentence (R3 renders it).
  7. Dev Context Switcher: if operator mode is not already a simulatable axis, add it (DevOverrides
     + DEV_DEFAULTS, DevOption list, DevContextPanel control, reflect() set AND delete, a
     data-dev-operator attribute on the seam) so the gate is testable without a DB flip.

ACCEPTANCE:
  - Probe passes after db:reset; the three refusal orderings above are asserted.
  - restricted-surfaces.test.ts: client → refused; operator freelancer → refused; freelancer →
    allowed; team context → allowed; minor → refused (existing rule still wins).
  - nav-model.test.ts + a new actions-model test: Teams link and Create Team hidden for client and
    operator, shown for freelancer.
  - documentation/database/org/Functions.md documents the helper and its three call sites.
```

### B2 — Apply-path hardening (team status + two members on both doors)

```text
PROMPT B2: Team applications refuse non-active teams and teams under two members

ROLE: Postgres engineer. Audit A3, A4; Decision #228 (E); Decision #154.

FILES:
  - supabase/migrations/00001130_functions_projects_stages.sql (apply_to_project ~:980-1050,
    apply_to_seat ~:881-930)
  - supabase/migrations/00001220_functions_finance_billing_entitlements.sql
    (finance.get_proposal_allowance :465-548 — report, not enforce)
  - supabase/probes/team_apply_gates.sql (new)
  - packages/backend/services/project/* (ProjectBackendService.apply pre-flight) and its tests
  - packages/types (allowance / apply refusal enum: add `team_not_active`)
  - apps/web/features/projects/** (ProjectApplyModal copy for the new refusal)
  - documentation/database/projects/Functions.md, documentation/PRODUCT_MANAGEMENT.md (team lifecycle
    row: "only an active team applies"), documentation/business/PRODUCT_SPEC.md (§~1356-1377)

SPEC:
  1. Extract ONE helper projects.fn_assert_team_can_apply(p_team_id uuid) that, in this order:
     (a) org.is_team_lead(p_team_id) else 'missing_permission' (keep the existing message);
     (b) org.teams.status = 'active' else ERRCODE 'check_violation', MESSAGE
         'team_not_active: only a published team can apply — publish it in Settings';
     (c) ≥2 active org.team_members else 'team_too_small' (existing message);
     (d) finance.fn_assert_payout_ready('team', p_team_id).
     Replace the inline checks in apply_to_project with it and ADD it to apply_to_seat.
  2. finance.get_proposal_allowance: add `team_status` to the payload so the pre-flight can refuse
     before the RPC; it stays a report.
  3. ProjectBackendService.apply pre-flight: refuse team_not_active alongside team_too_small and
     missing_permission — these three ALWAYS refuse, even while the allowance is meter-only
     (SYSTEM_ARCHITECTURE.md:1985-1986). Record entitlement.denied as today.
  4. Zod: add `team_not_active` to the block-reason enum; the modal shows "Publish the team before
     applying" with a tier-4 "Open settings" link to workspaceHref("team", handle, "settings").

ACCEPTANCE:
  - Probe: draft team → team_not_active on both doors; archived → team_not_active; active with one
    member → team_too_small on BOTH doors (apply_to_seat previously passed); active with two members
    and a bind_seat lead → succeeds; member without bind_seat → missing_permission.
  - Backend unit test covers the pre-flight ordering and the 422 shape (errors.allowance +
    details.blockReason).
  - documentation updated in the same commit.
```

### B3 — Vault-permission backstop triggers and the ownership-transfer gate

```text
PROMPT B3: Backstop finance.vault_permissions with triggers; gate ownership transfer on payout-readiness

ROLE: Postgres engineer (finance integrity). Audit B8, §4.3; Decision #226 (e); Decision #196.

FILES:
  - supabase/migrations/00001895_triggers_derived_columns.sql (new triggers — category 1, in place)
  - supabase/migrations/00001020_functions_org_entities.sql (trigger function; transfer_workspace_ownership
    :1859-1942)
  - supabase/probes/vault_sync_backstop.sql, supabase/probes/ownership_transfer_gate.sql (new)
  - documentation/database/org/Functions.md, documentation/database/finance/Tables.md
    (vault_permissions "written only by fn_sync_vault_permissions, backstopped by triggers")

SPEC:
  1. org.fn_trg_sync_vault_member() (definer): AFTER INSERT OR UPDATE OF role_id, status, granted,
     revoked ON org.team_members FOR EACH ROW → PERFORM org.fn_sync_vault_permissions('team',
     NEW.team_id, NEW.user_id). Check the real override column names in 00000011_tables_org.sql
     before writing the OF list. Mirror for business_members ('business').
  2. org.fn_trg_sync_vault_role() (definer): AFTER UPDATE OF capabilities, base_preset ON
     org.team_roles → sync every active member holding that role (p_user NULL syncs the entity).
     Mirror for business roles.
  3. Idempotency: the explicit calls in the RPCs stay; the trigger must be a no-op when the
     projection already matches (fn_sync_vault_permissions upserts — confirm it does not bump
     updated_at needlessly; if it does, compare before writing).
  4. A `left` member's row is rewritten to capabilities '{}' (non-member → {} per
     fn_vault_capabilities_for), never deleted.
  5. transfer_workspace_ownership: for p_kind = 'team', PERFORM
     finance.fn_assert_payout_ready('freelancer', p_successor) and org.fn_assert_team_persona(p_successor)
     (B1) BEFORE moving owner_user_id. The withdrawer and the team's verification follow the owner
     (database/org/Functions.md:792-794).

ACCEPTANCE:
  - Probe 1: revoke withdraw_funds from a member by a DIRECT UPDATE as service role (simulating a
    future write path that forgets the call) → vault_permissions loses 'withdraw' for that wallet.
  - Probe 2: editing a custom role's capabilities re-projects all holders.
  - Probe 3: a member leaving → their row is '{}' and still present.
  - Probe 4: transfer to an unready successor → PK403 payout_not_ready; nothing moved
    (owner_user_id unchanged, roles unchanged).
  - db:reset clean; the trigger count in docs matches the migration.
```

---

## 4. Wave 2 — Money, routing and read model

### B4 — `finance.save_split_rule` writer, contract and API

```text
PROMPT B4: Split templates become writable — finance.save_split_rule end to end

ROLE: Full-stack engineer (finance). Audit F11, §4.4; Decision #228 (F); open #226 (d).

🧑 DECISION — stop and ask before step 6: which templates are Pro-only ("Advanced vault splits",
documentation/business/finance-model.md:482)? Recommend: co_op free; finders_fee and
benevolent_dictator Pro. Build the gate as an entitlement check that reads the answer from the
entitlement table; do not hard-code it.

FILES:
  - supabase/migrations/00001210_functions_finance_kyc_wallet.sql (new RPC beside save_team_split
    :1982-2047)
  - supabase/migrations/00002510_*.sql (GRANT EXECUTE to authenticated)
  - supabase/migrations/00001220_*.sql only if the Pro gate needs a new entitlement key
  - supabase/probes/save_split_rule.sql (new)
  - packages/types/workspace/policy.ts (SplitRule schema + payout request union)
  - packages/backend/services/workspace/live-writes.ts, live-money.ts, WorkspaceBackendService.ts,
    mappers.ts (+ mappers.test.ts, live.test.ts)
  - apps/web/routes/api/workspace/payout.ts
  - apps/web/features/workspaces/core/WorkspaceService.ts
  - documentation/database/finance/Functions.md, documentation/business/finance-model.md (§160-175),
    documentation/architecture/ROUTING.md (/api/workspace/payout row)

SPEC:
  1. finance.save_split_rule(p_team_id uuid, p_rule_type finance.split_rule_type, p_vault_bp integer,
     p_finder_user_id uuid DEFAULT NULL, p_finder_bp integer DEFAULT NULL) RETURNS uuid,
     SECURITY DEFINER, search_path pinned.
     - Caller needs manage_finances (org.fn_member_can('team', p_team_id, 'manage_finances')).
     - Team must not be archived.
     - 0 ≤ vault_bp ≤ 10000. finders_fee: finder is an ACTIVE member, 1 ≤ finder_bp and
       finder_bp + vault_bp ≤ 10000. co_op and benevolent_dictator: finder fields must be NULL.
       benevolent_dictator ignores vault_bp (store 10000 for clarity — check fn_team_split_plan reads
       it consistently; if not, store what the plan expects and document it).
     - Take pg_advisory_xact_lock(hashtext('split:'||p_team_id)); set the current active row
       active = false (NEVER delete); insert the new row active = true. uq_split_rules_team_active
       keeps one active row.
     - Writes an audit row wherever save_team_split writes one (match it).
  2. Zod (policy.ts): SplitRuleInput = discriminatedUnion on ruleType; the payout request becomes
     { stakes?: Stake[]; rule?: SplitRuleInput } with at least one present. Integers in basis points.
  3. Service: payout() applies `rule` then `stakes` in ONE call order (rule first; the plan reads
     both) and returns the re-read detail as every write does. No money maths in the route.
  4. Read: live-money.ts returns the active rule (type, vaultBp, finderUserId, finderBp) in the
     detail's payout block; mapper + test.
  5. Route payout.ts: parse with the Zod schema, auth guard, call the service — nothing else.
  6. Pro gate per the ruling: refuse with ERRCODE 'PK402' 'entitlement: …' mapped to 402 by
     refusalFrom (follow the existing entitlement refusal mapping).

ACCEPTANCE:
  - Probe: lead without manage_finances → refused; finder not a member → refused; finder_bp +
    vault_bp > 10000 → refused; two saves → exactly one active row, previous row active = false and
    still present.
  - mappers.test.ts and live.test.ts cover the new payload; packages/types contract test passes.
  - `grep -rn "INSERT INTO finance.split_rules" supabase/migrations` → only the new RPC.
```

### B5 — Deterministic split ledger: property tests and the archive escrow guard

```text
PROMPT B5: Prove the split plan is deterministic; widen the archive escrow guard

ROLE: Postgres + test engineer. Audit B9, B10, S3; Decision #197 flag (b).

FILES:
  - supabase/probes/team_split_properties.sql (new; generate_series-driven property probe)
  - packages/backend/services/workspace/*.test.ts (a pure TS mirror of the plan for the preview,
    only if live-money.ts already mirrors it — otherwise test through preview_team_split)
  - supabase/migrations/00001020_functions_org_entities.sql (set_workspace_status :1086-1095)
  - documentation/database/finance/Functions.md (fn_team_split_plan invariants),
    documentation/business/finance-model.md (§396-399: vault dust vs. rebalance remainder),
    documentation/PRODUCT_MANAGEMENT.md (:214 archive blockers)

SPEC:
  1. Property probe over ≥ 500 generated cases (random 2-15 members, random stakes summing to 10000,
     random payout 1..10^9 minor units, each template, random vault_bp/finder_bp within B4 bounds):
     assert Σ member credits + finder + vault_total_minor = payout − platform fee EXACTLY; each
     member cut = floor(pool * bp / 10000); dust = pool − Σ member cuts ∈ [0, members); dust lands in
     vault_total_minor; benevolent_dictator → every member cut is 0. Same inputs twice → identical plan.
  2. Document the two remainder rules as distinct: MONEY dust → Team Vault (fn_team_split_plan);
     STAKE remainder on departure → largest absorber (fn_rebalance_departed_stake), because stakes
     must total 10000 bp and the vault holds no stake.
  3. Archive guard: also refuse when a 'held' escrow funds a projects.stage_assignments row whose
     team_id = the team (join escrow → stage/assignment by the real FK — read
     00000017_tables_finance.sql and the projects tables first), even if the escrow's payee is a
     member or not yet bound. Same ERRCODE 55000 and message.

ACCEPTANCE:
  - Property probe passes after db:reset with zero violations and prints the case count.
  - New archive probe: a held escrow bound to a member for a team-assigned stage blocks archive.
  - Docs state both remainder rules and the widened blocker.
```

### B6 — Console routing: 308 canonicalisation and the primary-view module order

```text
PROMPT B6: uuid → handle answers 308; the console's primary views lead the module registry

ROLE: Fresh routing engineer. Audit §4.1; Decision #228 (B), (C); ROUTING.md rows 98-101.

FILES:
  - apps/web/features/workspaces/core/workspace-route.tsx (consoleOutcome :86-110)
  - apps/web/features/workspaces/core/module-registry.tsx (:70-88)
  - apps/web/features/workspaces/core/workspace-model.ts (tabs/primary helpers)
  - apps/web/routes/(dashboard)/teams/[teamHandle]/index.tsx, [module].tsx
  - apps/web/routes/(dashboard)/businesses/[businessHandle]/index.tsx, [module].tsx
  - apps/web/features/workspaces/core/*.test.ts (new: workspace-route.test.ts)
  - apps/web/features/workspaces/islands/WorkspaceRoster.island.tsx (?notice= read only)
  - documentation/architecture/ROUTING.md

SPEC:
  1. ConsoleOutcome gains { kind: "canonical"; to } distinct from { kind: "redirect"; to }:
     - canonical: ref !== workspace.handle and NOT bootstrap.redirectedFrom (uuid or case variant;
       keep ?query). Route answers 308.
     - redirect: bootstrap.redirectedFrom (module the viewer may not open). Route answers 303 and
       drops ?view= as today.
     - If both apply, issue ONE 308 straight to the final module URL (no chain).
  2. missing/forbidden: keep the 303 to /teams but append ?notice=unavailable; the roster shows one
     InlineNotice "That team isn't available to you" (no existence disclosure).
  3. module-registry: add `primary: true` + an explicit `order` to overview, members, projects,
     payouts, roles, settings for kind "team" (business keeps its own primary set: overview,
     members, projects, finance, spend, settings — confirm with the registry's business modules;
     do not invent modules). Export primaryModules(kind, caps) and secondaryModules(kind, caps),
     both filtered by capability exactly like the existing tab helper. Primary order is the lane
     order (L1) and the header band order (L2).
  4. roles is primary but capability-gated (manage_roles) — a member without it never sees it, and
     /roles still 303s for them.

ACCEPTANCE:
  - workspace-route.test.ts: uuid → 308 with query kept; uppercase handle → 308; forbidden module →
    303 without ?view; uuid + forbidden module → single 308 to the allowed module; unknown module →
    303 to the console root; non-member → 303 /teams?notice=unavailable.
  - module-registry test: team primary set and order exactly as (C); member without manage_roles
    gets 5 primaries.
  - ROUTING.md rows updated in the same commit.
```

### B7 — One console read: fold direct selects into `get_workspace_detail`; Projects payload

```text
PROMPT B7: get_workspace_detail returns the payout rule, wallet and the Projects/W_i payload

ROLE: Postgres + service engineer. Audit B5, W3, A6/A7; open #226 (h).

🧑 DECISION — stop and ask before touching org.teams.current_workload_intensity: (1) derive it from
members (Σ active members' current W_i on team-held stages) via the existing
fn_sync_workload_intensity, or (2) stop exposing it and compute the team figure in the read.
Recommend (2): no stored counter to drift; the read sums live ticket W_i.

FILES:
  - supabase/migrations/00001020_functions_org_entities.sql (get_workspace_detail)
  - supabase/migrations/00003001_views_profiles_business.sql (:265-273 team workload_cap) — per ruling
  - supabase/migrations/00001140_functions_projects_automation_workload.sql (read helpers only)
  - packages/types/workspace/workspace.ts (+ contract test)
  - packages/backend/services/workspace/live-detail.ts (:120), live-money.ts (:112-117), mappers.ts
    (+ tests)
  - documentation/database/org/Functions.md

SPEC:
  1. get_workspace_detail('team', …) adds, gated server-side by the caller's capabilities:
     - payout: { rule (B4 shape), stakes[], walletId, availableMinor, pendingMinor, currency } —
       only when the caller holds manage_finances or view (vault) — replaces the direct selects in
       live-money.ts:112-117.
     - profileIndex fields currently read at live-detail.ts:120.
     - projects: [{ projectSlug (prj-…), title, stageSlug (stg-…), stageTitle, assignmentStatus,
       projectStatus, assignees: [{ handle, displayName, avatarUrl, wi, wiCap }] , stageWi,
       stageCap }] for the team's live stage_assignments (status not in declined/cancelled/released/
       completed; project active/on_hold). Slugs only — uuids never reach the client (Decision #88).
     - allowance: the team's proposal allowance summary (reuse finance.get_proposal_allowance's
       shape; include team_status from B2 and team_member_count, can_bind_seat for the caller).
     - members[].wi and members[].wiCap from the same source check_ticket_capacity reads.
  2. The service makes ONE RPC for the detail; delete the extra reads.
  3. Zod: extend the detail schema; every new figure is an integer minor unit or a number with a
     documented unit.

ACCEPTANCE:
  - live.test.ts asserts one RPC call per detail read (spy on callRpc).
  - A member without manage_finances receives no payout block (probe + mapper test).
  - Contract test green; documentation updated.
```

---

## 5. Wave 3 — `packages/ui` primitives

### U1 — Motion tokens, opaque status tints and `MetaLine`

```text
PROMPT U1: @projective/ui — motion tokens, opaque tint tokens and the MetaLine primitive

ROLE: Design-system engineer (packages/ui). Audit D3, D9, D17-D21; §B.11.

FILES:
  - packages/ui/system/** (token source; find where --dur-* and --btn-press-scale are declared)
  - packages/ui/styles/** (generated/compiled token sheet if separate)
  - packages/ui/display/components/MetaLine.tsx (new), packages/ui/display/styles/meta-line.css (new)
  - packages/ui/display/mod.ts (export)
  - packages/ui/display/components/MetaLine.test.ts(x) (new)
  - documentation/design-system/DESIGN_SYSTEM.md (§A motion table, §B.11, §C.1 roster)

SPEC:
  1. Tokens: --dur-stagger (the per-item entrance offset, replacing the literal 40ms) and
     --dur-ambient (slow pulse/breathe loops, replacing 2s / 2.4s). Both collapse to 0ms under both
     reduced-motion channels in the same place the other --dur-* tokens do.
  2. Opaque tint tokens for each status ramp used as a quiet fill: --success-tint, --warning-tint,
     --danger-tint, --primary-tint (skip any that exist), each defined as
     color-mix(in oklab, var(--<ramp>) <N>%, var(--surface-1)) — OPAQUE (mixed against a surface,
     never `transparent`), with dark and high-contrast values, and a contrast check that
     --on-surface ink on each tint ≥ 4.5:1 in all four mode/contrast states (extend the existing
     contrast test; do not add a new test harness).
  3. MetaLine: props { items: Array<string | { text: string; tabular?: boolean; title?: string }>;
     as?: "p" | "span" | "div"; size?: "sm" | "xs"; class?: string }. Renders items joined by a
     separator span `.ui-meta-line__sep` containing "·" with aria-hidden="true"; falsy items are
     dropped; tabular items get .ui-meta-line__item--tabular (font-variant-numeric: tabular-nums).
     Colour --text-secondary; type the Meta register (§A.4). No container, no border, no fill.
     BEM: .ui-meta-line, __item, __item--tabular, __sep.
  4. Document MetaLine in §B.11 as THE way to render non-actionable metadata and add it to §C.1.

ACCEPTANCE:
  - Unit test: ["Owner", null, {text:"4 members", tabular:true}] → two items, one separator, the
    second tabular; separators aria-hidden.
  - grep the new CSS for color-mix(.*transparent → none; no literal durations.
  - deno task check/lint/test:unit green; §C.1 roster updated.
```

### U2 — Tier-2 structural tone and the monochrome `LaneCreateButton`

```text
PROMPT U2: Tier 2 becomes a first-class tone; LaneCreateButton renders monochrome on every lane

ROLE: Design-system engineer. Audit D22-D24; Decision #228 (D); DESIGN_SYSTEM §B.8.1, §D.7.7.

FILES:
  - packages/ui/fields/components/Button.tsx (+ its CSS), packages/ui/fields/mod.ts
  - packages/ui/navigation/components/LaneChrome.tsx (:160-190) (+ lane CSS)
  - every LaneCreateButton consumer (grep: ProjectsLane, CatalogueLane, MessagesSidebar, …) —
    visual check only; no prop changes expected
  - documentation/design-system/DESIGN_SYSTEM.md (§B.8.1 table row 2, the "Tier 2 has no severity of
    its own" paragraph ~:1285, §D.7.7, §C.1)

SPEC:
  1. DESIGN_SYSTEM says tier 2 "has no severity of its own: it is the §D.7.7 override
     --btn-accent: var(--on-surface); --btn-on: var(--surface) on a filled Button". Keep that model —
     do NOT add a severity. Add a `structural?: boolean` prop to the semantic-tone Button contract
     (filled only; a type error with outlined/text/link and with severity accent/neutral) that sets
     the class .ui-button--structural, whose CSS is exactly that override. Update the paragraph to
     say the override is spelled `structural`.
  2. LaneCreateButton: render the same tone (.ui-lane-create gets the §D.7.7 override; hover keeps
     the §B.12 zero tonal step via the border channel; press scale only). Update its JSDoc
     ("the filled brand pill" → "the tier-2 monochrome pill").
  3. Verify filled monochrome contrast (--surface ink on --on-surface) ≥ 4.5:1 in all four
     mode/contrast states — it swaps with the theme by construction; assert it in the contrast test.
  4. Hue ranking: a tier-1 amber Button may sit beside a structural Button in one region; document
     the pair as already allowed (§B.8.2).

ACCEPTANCE:
  - Type test: <Button structural variant="text"> fails to compile; <Button structural> compiles.
  - Screenshots of the Projects, Catalogue, Messages and Teams lanes, light + dark, show the
    monochrome pill; reduced-motion shows no press transform.
  - §C.1 roster + §B.8.1 updated in the same commit.
```

### U3 — Keyboardable `PermissionMatrix`

```text
PROMPT U3: @projective/ui/display PermissionMatrix — tri-state, keyboardable, opaque, press-scaled

ROLE: Design-system engineer (a11y). Audit D1, D9, §3.2; feeds C3.

FILES:
  - packages/ui/display/components/PermissionMatrix.tsx (new) + styles/permission-matrix.css (new)
  - packages/ui/display/core/permission-matrix-nav.ts (new pure roving-focus model) + test
  - packages/ui/display/mod.ts
  - documentation/design-system/DESIGN_SYSTEM.md (§C.1; a short §B entry for the pattern)

SPEC:
  1. Props: rows: { key; label; hint?; group?; sensitive?: boolean }[] (capabilities);
     columns: { key; label; meta?: string; locked?: boolean }[] (roles); value(row, col) →
     "allowed" | "conditional" | "locked" | "off"; onToggle?(row, col) (absent → read-only);
     caption (required, visually hidden allowed); rowHeaderLabel.
  2. Semantics: <table role="grid"> with <caption>, <th scope="col"> role headers, <th scope="row">
     capability headers; each cell a <button role="gridcell"> with aria-pressed for allowed/off,
     aria-disabled + aria-describedby for locked, and an accessible name "<capability> for <role>:
     <state>". One tab stop; arrows move, Home/End to row ends, Ctrl+Home/End to the grid ends,
     Space/Enter toggles (pure model in permission-matrix-nav.ts).
  3. Visuals: allowed = --primary-tint fill + a check glyph (IconShell, supplied by consumer);
     conditional = --warning-tint + a half glyph; locked = --surface-2 + a lock glyph and NO hatch
     gradient with hard-coded stops; off = transparent cell on the row's own surface. All tints are
     U1 opaque tokens. Shape AND glyph carry the state (colour-blind overlay safe). Sticky header row
     and sticky first column on --surface-1 (solid). Group rows use the section-header register.
     Cells never overlap: fixed grid template, min cell size --fld-h-md, horizontal scroll inside a
     ScrollArea on narrow widths with the first column sticky.
  4. Press: cell :active → transform: scale(var(--btn-press-scale-icon)); transform: none under both
     reduced-motion channels. Focus: the shared --focus-ring-shadow, never outline: none alone.

ACCEPTANCE:
  - Nav model unit tests (arrows, wrap rules, Home/End, disabled cells skipped for toggle but
    focusable for reading).
  - axe-clean in a Playwright check on the C3 page (run in C3); here, a unit render test asserts
    roles/names.
  - No color-mix(…transparent), no literal stops/durations; §C.1 updated.
```

### U4 — Responsive `SplitBar` slider

```text
PROMPT U4: @projective/ui/fields SplitBar — proportional basis-point slider with per-handle a11y

ROLE: Design-system engineer. Audit §3.2; feeds C4. Replace apps/web/features/workspaces/components/
SplitBar.tsx's custom control (its behaviour is the reference; read it first).

FILES:
  - packages/ui/fields/islands/SplitBar.tsx (new; islands/ because it needs pointer handling like
    SplitButton) + packages/ui/fields/styles/split-bar.css (new)
  - packages/ui/fields/core/split-bar-model.ts (new pure model) + split-bar-model.test.ts
  - packages/ui/fields/mod.ts
  - documentation/design-system/DESIGN_SYSTEM.md (§C.1; §A.7 if it adds a field state)

SPEC:
  1. Model (pure, integer basis points): segments { key; label; bp; held?: boolean; min?: number }[],
     total 10000 always. Dragging handle i moves bp between segment i and i+1 only; held segments are
     never changed by a neighbour's drag; step 1 bp with pointer, 100 bp with arrows, 1000 bp with
     PageUp/PageDown, Shift = 10 bp; clamp to each segment's min (default 0). Output always sums to
     10000 (assert in the model).
  2. Rendering: a track of segments in solid ramp tones from a supplied categorical token list.
     Segment widths are runtime-continuous, so set them exactly as ProgressBar does
     (packages/ui/feedback/components/ProgressBar.tsx:69 — styleVars({"--split-bar-seg": "42.5%"})
     consumed by flex-basis in split-bar.css); this is the package-owned seam, not app inline style.
     Each handle is role="slider" with aria-valuemin/max/now (in percent with two decimals),
     aria-valuetext "<left label> 42.50% · <right label> 17.50%", aria-label naming both neighbours.
  3. A legend row below uses MetaLine (U1) with tabular percentages; no chips.
  4. Responsive: below --bp-md the handles grow to a 44px hit area (touch) without changing the
     visual track height; the legend wraps.
  5. Press: handle :active scale(var(--btn-press-scale-icon)); none under reduced motion. No layout
     shift while dragging. pointer capture; Escape restores the value at drag start.
  6. Controlled: value + onValueChange(segments, source: "drag" | "key"); onCommit on pointerup/keyup
     so the console only marks dirty, never saves per frame.

ACCEPTANCE:
  - Model tests: sum invariant over 10k random drags; held segments untouched; min clamps; keyboard
    steps.
  - A Playwright keyboard test in C4 (arrows move 1%, value text announced).
  - §C.1 roster updated.
```

---

## 6. Wave 4 — Feature CSS foundation

### W1 — Workspace stylesheet token sweep

```text
PROMPT W1: Bring apps/web/features/workspaces/styles/* onto tokens and the merge gates

ROLE: CSS engineer. Audit D2-D16, D38, D39 (CSS half), D41. Needs U1. No markup redesign here —
later prompts restructure; this one makes every existing rule legal so they start clean.

FILES:
  - apps/web/features/workspaces/styles/workspace-tokens.css, workspace-chrome.css,
    workspace-roster.css, workspace-console.css, workspace-people.css, workspace-matrix.css,
    workspace-money.css, workspace-billing.css
  - every wsp TSX that sets style={styleVars(...)} for the --wsp-i stagger (Overview, Billing, Roles,
    Roster, Spend, Members, Payout) — replace with data-i
  - a new lint script only if the repo already has a CSS lint hook (check deno.json tasks); else a
    Deno test apps/web/features/workspaces/styles/styles.gate.test.ts that greps the sheets

SPEC:
  1. Weights: every literal 600/700 → token. Display/title headings (.wsp-roster__title,
     .wsp-idhead__name, .wsp-pagehead__title, .wsp-headerband__name, .wsp-empty__title,
     .wsp-checklist__title, .wsp-invitestrip__title, .wsp-people__group-title, .wsp-mdrawer__name,
     .wsp-mdrawer__section-title, .wsp-roleeditor__group-title) → var(--fw-medium); where two levels
     now share a weight, separate them by size/colour. Section-header labels (.wsp-band__title) →
     var(--fw-semibold). .wsp-matrix__ovr 700 → var(--fw-semibold). Names → var(--fw-medium).
  2. Translucency: every color-mix(…, transparent) and every --wsp-*-tint/-edge/-ring/-hatch token
     re-derived as an opaque mix against its region surface, or replaced by U1 tint tokens. Include
     the high-contrast copies.
  3. Opacity-as-state → --text-secondary / --fld-disabled-mix tokens. Keep opacity only for
     enter/exit animation.
  4. Boxes: remove the inset rings on .wsp-mcard[data-self|data-state=requested], .wsp-card[data-acting],
     .wsp-lane__entity[data-acting], .wsp-chip[muted]; express self/acting with a leading
     --hairline-strong rule (inline-start border on a non-interactive row is a hairline divider, not
     a box) or a --surface-2 step.
  5. Literals: 1px borders → var(--hairline)/(--hairline-strong); px gaps/sizes → --space-* /
     --hairline-w / existing size tokens; rings → --focus-ring-* tokens; @media literals → the ui
     breakpoint custom media (--bp-md etc. — copy how packages/ui sheets express breakpoints);
     40ms/2s/2.4s → --dur-stagger/--dur-ambient.
  6. tabular-nums on .wsp-card__stats, __stat, __stat-delta and any figure class missing it.
  7. Reduced motion: add :root[data-motion="reduced"] beside the media query at chrome.css:274 and
     anywhere else a sheet has only one channel.
  8. Focus: delete the 47 local `:focus-visible { outline: none }` rules; confirm in the browser the
     ui base ring paints on every control afterwards (packages/ui/styles/index.css:988-1002 — if the
     base removes the ring for all, STOP and log it as a new conflict; do not paper over it here).
  9. Stagger: replace style="--wsp-i:N" with data-i="N" and a selector ladder
     [data-i="0"]…[data-i="11"] { --wsp-i: N } capped at 12 (items past 12 enter with the last delay).
  10. Delete dead CSS: .wsp-footerrig__action[data-variant], .wsp-lane__new, .wsp-skel__*.

ACCEPTANCE:
  - styles.gate.test.ts fails on: /color-mix\([^)]*transparent/, /font-weight:\s*[0-9]/,
    /\b\d+ms\b|\b\d+(\.\d+)?s\b/ outside var(), /#[0-9a-f]{3,8}\b/i, /rgba?\(/, /backdrop-filter/,
    /@media[^{]*\d+px/, /outline:\s*none/ without a box-shadow ring in the same rule. It passes.
  - grep -rn 'style=' apps/web/features/workspaces → only package-owned seams (none expected).
  - Screenshots before/after of roster, overview, members, roles, payouts (light/dark/HC).
```

---

## 7. Wave 5 — Chrome

### L1 — The four-zone workspace lane

```text
PROMPT L1: WorkspaceLane rebuilt as four zones — header strip · primary views · context controls ·
docked footer rig

ROLE: Frontend engineer (navigation). Audit D23, D17 (lane), §3.1 lane rows; Decisions #228 (C),
(D); needs B6, U1, U2, W1.

FILES:
  - apps/web/features/workspaces/islands/WorkspaceLane.island.tsx
  - apps/web/features/workspaces/components/WorkspaceRail.tsx, ContextSwitchControl.tsx, EntityMark.tsx
  - apps/web/features/workspaces/core/workspace-lane-slot.tsx, workspace-model.ts (+ tests)
  - apps/web/features/workspaces/styles/workspace-chrome.css
  - reference lanes to match: apps/web/features/projects/**/ProjectsLane*, apps/web/features/
    catalogue/**/CatalogueLane*

SPEC — the lane has exactly four zones, top to bottom, on --surface-1 (solid):
  Z1 Header strip (LaneHead): on /teams — the title "Teams" in the title register + a MetaLine
     count ("3 teams · 1 invitation", tabular). Inside a console — EntityMark + team name + MetaLine
     (`@handle · Draft|Active` where the lifecycle status is a <Tag> — the one allowed container),
     and ContextSwitchControl as a tier-4 neutral outlined Button ("Act as team" / "Stop acting").
     LaneCollapseButton at the end.
  Z2 Primary views (LaneList of NavItem-style rows, or LaneTabs where the lane already uses tabs —
     match ProjectsLane): on /teams — the caller's teams, owned first, each row = EntityMark + name +
     MetaLine (role · members · status-as-text); no chips. Inside a console — primaryModules(kind,
     caps) from B6 in order, each with its glyph and aria-current="page" on the active one; then a
     LaneSection "More" (collapsed by default, remembered per viewer in localStorage inside
     try/catch) listing secondaryModules.
  Z3 Context controls (only when the current view has filters): roster — a SelectButton for
     All · Owned · Member · Invitations (replacing the raw wsp-lane__filter-pill buttons) and a
     LaneSearch; Members — a SelectButton for People · Org chart; Projects — Active · Proposals. The
     reset is a tier-5 Button variant="text". Hidden entirely when the view has none (no empty band).
  Z4 Docked footer rig (LaneFooter / LaneFooterActions): ONE LaneCreateButton (tier 2, U2) —
     "New team" on /teams (opens the create modal via workspace-state), "Invite member" inside a
     console when the viewer holds invite_members, otherwise no create button at all (never a dead
     control). Zoom stays where the shell puts it.
  Collapsed rail (WorkspaceRail): the same four zones folded to glyphs — mark, module glyphs with
  Tooltip names, LaneCreateButton glyph with aria-label. The raw rail "New" button is removed.
  Responsive: ≥ --bp-md the lane docks in MiddleNav; below it the lane is the MiddleNavPanel sheet
  the shell already provides (no app-side override). Spacing: --space-7 above each zone, --space-3
  below a zone heading; zones separated by space and one --hairline, never boxes.
  Every lane control is a ui component, so press scale and reduced-motion come from the package.

ACCEPTANCE:
  - workspace-model tests: zone composition per (kind, view, caps); no create button without
    invite_members; "More" lists only permitted secondaries.
  - Keyboard: Tab order Z1 → Z2 → Z3 → Z4; arrows within the module list if LaneList supports it.
  - Screenshots: /teams and a console at 1440/900/390, light/dark, collapsed and expanded.
  - No raw <button> left in WorkspaceLane.island.tsx or WorkspaceRail.tsx.
```

### L2 — Header band and footer rig on the Button matrix

```text
PROMPT L2: WorkspaceHeaderBand uses TabMenu + ActionMenu; WorkspaceFooterRig uses tiered Buttons

ROLE: Frontend engineer. Audit D27-D29, §3.1 header/footer rows; Decision #222; needs L1.

FILES:
  - apps/web/features/workspaces/islands/WorkspaceHeaderBand.island.tsx
  - apps/web/features/workspaces/islands/WorkspaceFooterRig.island.tsx
  - apps/web/features/workspaces/core/workspace-header-slot.tsx, workspace-footer-slot.tsx,
    workspace-state.ts
  - apps/web/features/workspaces/styles/workspace-chrome.css
  - reference: apps/web/features/catalogue/**/CatalogueHeader.island.tsx and its header-band.css
    (Decision #220 three-region band)

SPEC:
  1. Header band = the #220 three-region flow: identity start (module title in the title register +
     MetaLine meta), the module's sub-view TabMenu centred (only when the module has sub-views — e.g.
     Members: People · Invitations; Payouts: Split · Ledger), actions end. Replace the hand-rolled
     <nav class="wsp-headerband__tabs">.
  2. Actions end: at most ONE filled control (the module's commit, supplied by the module via
     workspace-state — e.g. Members: none; Settings: "Publish team" tier 3 when draft), then tier-4
     utilities (Share profile → links to /:handle), then the ActionMenu kebab (Button iconOnly
     variant="text") carrying the rest (Copy handle, View public profile, Archive… for
     archive_entity holders → ConfirmDialog severity danger). Use composeMenu/linkActionItems like
     WorkspaceCard; the Popover + raw buttons go.
  3. Footer rig: RigButton → <Button>: Save = tier 3 filled, rendered only while policyDirty (one
     filled in the rig); Discard = tier 5 text beside it; Org chart / view toggles = tier 5; Settings
     = tier 4 (or a Link styled by ui when it navigates). The <a class="wsp-footerrig__action">
     anchors become ui Link (navigation) — never a button-styled anchor.
  4. saveRequested pulse: keep the signal but drive it with useSignalEffect, not useEffect.

ACCEPTANCE:
  - A unit test over the header model: ≤ 1 filled action in any module; Archive only with
    archive_entity.
  - Right-click / Shift+F10 on the band opens the same ActionMenu rows (Decision #222 surface prop).
  - No raw <button>/<a class="…action"> left in either island.
```

---

## 8. Wave 6 — Roster `/teams`

### R1 — Roster canvas: cards, table, tabs, empty and error states

```text
PROMPT R1: /teams roster on ui primitives — TabMenu, MetaLine cards, DataTable, EmptyState

ROLE: Frontend engineer. Audit D8, D17, D22, D26, §3.1 roster rows; needs U1, U2, W1, L1.

FILES:
  - apps/web/features/workspaces/islands/WorkspaceRoster.island.tsx
  - apps/web/features/workspaces/components/WorkspaceCard.tsx, WorkspaceTable.tsx, RosterEmpty.tsx
  - apps/web/features/workspaces/styles/workspace-roster.css
  - apps/web/features/workspaces/core/workspace-model.ts (+ tests)
  - reference: apps/web/features/projects/**/ProjectPortfolio.tsx (EmptyState usage)

SPEC:
  1. Page head: title register "Teams" + MetaLine; no filled button in the head (the create action
     lives in the lane footer, L1 — one per region, and the canvas does not duplicate it).
  2. Grid ⇄ list: the existing zoom/mode stays; tabs (All · Owned · Member) → TabMenu, synced with
     the lane's SelectButton (one signal in workspace-state, URL ?view= via the existing
     replaceState — move it to useSignalEffect).
  3. WorkspaceCard: EntityMark, name (title register, --fw-medium), MetaLine
     ["Owner", "4 members", "2 live projects"] tabular counts; lifecycle status as <Tag> ONLY when
     not active (Draft / Archived); progress meter → ui ProgressBar (no inline style); kebab →
     <Button iconOnly variant="text"> as the ActionMenu trigger; the whole card is one link to the
     console (the kebab stops propagation). The card sits on --surface-1 with no border (it is the
     interactive container: hover = tonal lift, press = scale; a full border is not needed).
     Acting state: a leading --hairline-strong rule + "Acting" in the MetaLine, not a ring.
  4. WorkspaceTable: DataTable columns Name · Your role · Members · Live projects · Status (Tag only
     for non-active) · Updated; counts right-aligned tabular; sortable; selection None.
  5. RosterEmpty: ui EmptyState — first run: title "Start a team", one sentence on the Virtual Agency
     (from PRODUCT_SPEC §153-161, no new claims), ONE tier-2 structural Button "Create a team"
     (the lane footer button is hidden in first-run so the region still has one structural commit);
     filtered-empty: no button, a tier-5 "Clear filters".
  6. Error: InlineNotice severity danger + tier-4 <Button severity="neutral" variant="outlined">
     "Try again".
  7. ?notice=unavailable (B6) and ?notice=teams-freelancer are not shown here (the latter never
     reaches /teams); unavailable → one InlineNotice above the grid, dismissible.

ACCEPTANCE:
  - No wsp-chip on any roster metadata; no raw <button>.
  - Exactly one filled control on the page in each state (first-run, populated, error).
  - Screenshots: empty, populated grid, list, error — 1440/900/390, light/dark.
```

### R2 — Invitation strip: one filled action per region

```text
PROMPT R2: InvitationStrip — accept/decline on the matrix, kind and role as text

ROLE: Frontend engineer. Audit D18, D25; Decision #61; invite-respond API.

FILES:
  - apps/web/features/workspaces/components/InvitationStrip.tsx
  - apps/web/features/workspaces/styles/workspace-roster.css (.wsp-invitestrip*)
  - apps/web/features/workspaces/core/WorkspaceService.ts (respond call — unchanged contract)
  - apps/web/routes/api/workspace/invite-respond.ts (read only; confirm the payout/persona refusals
    reach the client as typed codes)

SPEC:
  1. The strip is a section (section-header register "Invitations" + a count Badge — a count is an
     allowed container), rows separated by --hairline, no per-row boxes.
  2. Each row: EntityMark, "<Team name>" (title register), MetaLine ["Team", "as Lead", "from
     @inviter", "expires in 5 days"] (tabular days; the kind is text, never wsp-chip--kind), the
     inviter's note in body text if present.
  3. Actions: exactly ONE filled button in the whole strip — the FIRST pending row's "Accept" is
     tier 3; every other row's Accept is tier 4 neutral outlined; Decline is tier 5 text on every
     row; dismiss is <Button iconOnly variant="text"> with aria-label. When the first row resolves,
     the next becomes the filled one (computed signal, no effect).
  4. Refusals: payout_not_ready → InlineNotice with a tier-4 link to /settings/verification (the
     #196 flow); persona_not_freelancer (B1) → InlineNotice "Teams are for freelancer accounts";
     seat cap → "This team is full". No toast-only errors.
  5. Optimistic removal on success; restore the row on failure.

ACCEPTANCE:
  - A unit test over the strip's action model: N rows → exactly one tier-3 Accept.
  - Keyboard: each row's actions reachable in order; focus moves to the next row's Accept after a
    resolution.
  - No translucent fills; `.wsp-invitestrip__accept` background rule deleted.
```

### R3 — Draft-first create modal

```text
PROMPT R3: CreateWorkspaceModal — name + @handle only, FormControl fields, live handle check, tier 2

ROLE: Frontend engineer (forms). Audit F1, F2, D24, D36, D37; §A.7; needs B1, U2.

FILES:
  - apps/web/features/workspaces/islands/CreateWorkspaceModal.island.tsx
  - apps/web/features/workspaces/styles/workspace-roster.css (.wsp-create*)
  - apps/web/features/workspaces/core/WorkspaceService.ts (handle check + create — contracts unchanged)
  - packages/types/workspace/workspace.ts (reuse RESERVED_HANDLES + the handle regex; do not copy)
  - apps/web/routes/(dashboard)/teams/create.tsx (auto-open stays)

SPEC:
  1. Fields, each in FormControl: Display name (InputText, 2-80 chars, required) and Handle
     (InputText with a leading "@" adornment if InputText supports one, else a prefix span inside
     FormControl; lowercase on input; 3-40 chars; the SAME regex as org.fn_handle_refusal, imported
     from packages/types). Nothing else — no description, avatar or members (draft-first).
  2. Handle check: debounced (use an existing debounce util; no setTimeout in the island body) call
     to /api/workspace/handle; states idle · checking (ProgressSpinner inline, aria-live polite) ·
     available · taken · reserved · invalid; validation paints only after blur (§A.7), clears on
     focus. Suggestions (when taken) are tier-5 Buttons, max three, as a row — not chips.
  3. Kind choice: on /teams the kind is fixed to team (no radio). The kind radio exists only when
     the modal is opened from a neutral context that offers both; it uses RadioGroup (or
     SelectButton) — never role="radio" buttons.
  4. Footer: Cancel tier 5; "Create team" tier 2 structural (U2), disabled until name valid +
     handle available. On success navigate to workspaceHref("team", handle) (the new draft console).
  5. Refusals: persona_not_freelancer, payout_not_ready (link to /settings/verification),
     entitlement teams_owned (link to billing/upgrade), handle race (23505 → re-run the check) —
     each as an InlineNotice inside the dialog, not a toast.
  6. Focus: Dialog's initial-focus prop on the name field; delete the setTimeout(60) effect.

ACCEPTANCE:
  - Unit tests for the handle state machine (typed sequence → states), reusing the TS regex.
  - The TS regex and RESERVED_HANDLES remain pinned to SQL by workspace.contract.test.ts.
  - Fields are 16px below --bp-md (screenshot at 390).
  - No raw role="radio", no native select, no setTimeout.
```

---

## 9. Wave 7 — Console modules

### C1 — Overview: unboxed setup hero, metrics, activity stream

```text
PROMPT C1: /teams/:teamHandle Overview — horizontal setup hero, StatTile metrics, live activity

ROLE: Frontend engineer. Audit D5, D12, D20, D39; Decision #61(A) (Overview is permissionless).

FILES:
  - apps/web/features/workspaces/islands/WorkspaceOverview.island.tsx
  - apps/web/features/workspaces/components/SetupChecklist.tsx, ActivityFeed.tsx, ProjectList.tsx,
    FinanceSummary.tsx, VerificationLock.tsx
  - apps/web/features/workspaces/styles/workspace-console.css
  - packages/backend/services/workspace/mappers.ts (setup step derivation, if it lives there) + test

SPEC:
  1. Setup hero (only while the team is draft or any step is open): a full-width band on
     --surface-1 (solid), NOT a card and NOT a checklist box. Left: title "Get <Team> ready" + a
     MetaLine "3 of 5 done" (tabular) + ProgressRing (ui). Right/below: the steps as a horizontal
     ui Steps (or an ordered list styled as one line of steps with --hairline connectors) — Invite a
     second member (≥2 — required to apply), Set the split, Complete the public profile, Verify the
     owner (#196), Publish. Each step shows done/undone by glyph + text; the NEXT undone step's action
     is the band's ONE filled Button: tier 2 structural for "Invite member", tier 3 for "Publish",
     links (tier 4) for the others. Dismiss: Button iconOnly text, remembered per viewer
     (localStorage, try/catch). Steps derive from the detail payload, never from client guesses.
  2. Metrics row: StatTileRow (ui) — Members, Live projects, Vault available (MoneyView, tabular),
     Proposal allowance remaining (from B7). StatTiles render unboxed per the ui package; do not wrap
     them in a card or band border. A member without vault view sees no money tile (B7 omits it).
  3. Activity stream: a section (section-header register "Activity") of rows separated by one
     --hairline: avatar, sentence in body, MetaLine [relative time, module]. No boxes, no chips.
     Empty → one Meta line, no illustration.
  4. Projects preview: the first three live engagements (B7 payload) as rows linking to
     /projects/prj-…; "See all" tier-5 link to the Projects module.
  5. .wsp-propose box → InlineNotice ("Teams need two members to send proposals") only when relevant.
  6. Standing: wsp-capchip → MetaLine text.
  7. useEffect publishDetail → useSignalEffect.

ACCEPTANCE:
  - Exactly one filled control on Overview in every setup state (unit test on the hero model).
  - A plain member (view_analytics only) sees Overview with no money and no setup actions they
    cannot perform (no dead controls).
  - Screenshots draft / active / member view at three widths, light/dark.
```

### C2 — Members: DataTable, AvatarStack, drawer, invite, ownership transfer

```text
PROMPT C2: /teams/:teamHandle/members — DataTable roster, FormControl drawer, accessible invite and
transfer

ROLE: Frontend engineer. Audit D11, D20, D21, D34-D37, §4.3; Decisions #224, #222; needs B3, U1.

FILES:
  - apps/web/features/workspaces/islands/MembersScreen.island.tsx, MemberDrawer.island.tsx,
    InviteModal.island.tsx
  - apps/web/features/workspaces/components/MemberCard.tsx, MemberTable.tsx, InviteQueue.tsx,
    OwnershipTransfer.tsx, OrgChart.tsx
  - apps/web/features/workspaces/styles/workspace-people.css
  - packages/types/workspace/members.ts (read; no contract change expected)

SPEC:
  1. Header: section title "Members" + MetaLine ["5 of 15 seats", "2 pending invitations"]
     (tabular) + an AvatarStack (ui display) of active members (max 5 + count). Sub-views via the
     header band TabMenu (L2): People · Invitations (InviteQueue) · Org chart.
  2. People default = DataTable (Decision #224): Member (Avatar + name + @handle as Meta) · Role
     (text; custom role shows "Name · based on Lead") · Overrides (MetaLine "+2 granted · −1 revoked",
     sensitive count may be a Badge) · Stake (tabular %, only for manage_finances holders) ·
     Workload (W_i "3 / 10", tabular, from B7) · Joined (relative) · row ActionMenu (Button iconOnly
     text). Sort via the table's own header sort (delete the native sort select; SortControl only if
     the grid view keeps a sort). Grid view keeps MemberCard, rewritten with MetaLine — no
     wsp-capchip / wsp-override chips; self = "You" in the MetaLine, not a ring.
  3. MemberDrawer: Role → Select inside FormControl; Reports to → Select inside FormControl;
     capability overrides → a compact list of ToggleSwitch rows grouped by capability group, each
     row labelled, sensitive ones with a Meta warning; Save tier 3, Close tier 5. The owner row's
     "Leave/Remove" never renders; instead a tier-5 link "Transfer ownership" opens OwnershipTransfer
     (the lastowner-link becomes <Button variant="link">). Rank rule: actions the viewer cannot
     perform (strictly higher rank + remove_members + manage_roles) are absent, not disabled.
  4. InviteModal: By handle · By email → SelectButton (or RadioGroup); handle field InputText with
     the same live lookup as R3 (reuse its hook — move it to features/workspaces/hooks/); role →
     Select listing only roles the inviter can grant (server already refuses the rest; mirror it);
     note → Textarea; all in FormControl. Seat-cap and pending counts as MetaLine. "Send invitation"
     tier 3, Cancel tier 5. When opened from the lane footer the lane button was the tier-2 trigger.
  5. OwnershipTransfer: successor → Select (active members only, excluding self); "Leave the team
     after transfer" → Checkbox; consequences as an InlineNotice (required disclosure: you become
     Admin; withdrawals move to the successor; successor must be payout-ready); confirm stays
     <Button severity="danger"> ("Transfer ownership"), Cancel tier 5. payout_not_ready from B3 →
     inline notice naming the successor.
  6. OrgChart: replace the local component with @projective/ui/display OrgChart if it covers the tree
     (reports-to edges, focusable nodes); otherwise keep local and log why in the PR description.

ACCEPTANCE:
  - No native <select>/<input type=checkbox>, no wsp-select class, no raw radio in these files.
  - Unit tests: available actions per (viewerRank, targetRank, caps); invite role list filtered.
  - Keyboard: table row → Enter opens the drawer; Escape returns focus to the row.
  - Screenshots at three widths; DataTable degrades to the card grid below --bp-md if that is the
    table's documented behaviour (do not add an app-side override).
```

### C3 — Roles: PermissionMatrix and the role editor

```text
PROMPT C3: /teams/:teamHandle/roles — PermissionMatrix adoption and a FormControl role editor

ROLE: Frontend engineer (a11y). Audit D1, D6, D9, D34; needs U3; open #226 (a), (f).

🧑 DECISION — stop and ask before changing preset bundles or adding a "Contributor" preset
(#226 (a) and (f)). Recommend: no new preset; offer a one-click "Contributor" custom-role template
(base_preset member, capabilities view_analytics + manage_projects read-only) in the editor, so the
vocabulary stays owner · admin · lead · member. Build the editor so the template list is data.

FILES:
  - apps/web/features/workspaces/islands/RolesMatrix.island.tsx
  - apps/web/features/workspaces/styles/workspace-matrix.css
  - apps/web/features/workspaces/core/module-registry.tsx (capability groups/labels, if they live there)
  - packages/types/workspace/common.ts (capability labels/groups — read; and the stale invited/
    requested comment at :55-58 — fix it)

SPEC:
  1. Matrix: <PermissionMatrix> (U3) — columns = presets then custom roles (MetaLine meta: "3
     members"); rows = the capabilities the TEAM kind renders (filter purchase, hire,
     contribute_funds, approve_spend, as F1020:497 does — import the filtered list, don't re-list),
     grouped (People · Work · Money · Admin), sensitive rows flagged. Presets are locked columns
     (read-only, aria-describedby "Preset roles can't be edited — create a custom role"). The owner
     column is all-allowed and locked.
  2. Editing a custom role column toggles cells locally and marks policyDirty; Save is the footer
     rig's tier-3 Save (L2). The server refuses granting what the editor lacks; mirror that by
     locking those cells with the reason.
  3. Role editor (create/rename): Name InputText + Based on Select (admin · lead · member) +
     optional template Select (per the ruling) inside FormControl; Cancel tier 5; "Create role"
     tier 2 structural; Archive role (role-archive API) via the column header's ActionMenu →
     ConfirmDialog danger; a role held by members cannot be archived (show the count and the reason).
  4. Delete the hand-rolled matrix cells/colbtns and all hatch-gradient CSS.

ACCEPTANCE:
  - Playwright + axe on /roles: no violations; arrow-key navigation across cells; Space toggles a
    custom-role cell; preset cells announce the lock reason.
  - Colour-blind overlay screenshot: states distinguishable by glyph.
  - No raw <button>/<select> left in RolesMatrix.island.tsx.
```

### C4 — Payouts: SplitBar, templates, ledger, vault readout

```text
PROMPT C4: /teams/:teamHandle/payouts — split templates, SplitBar stakes, deterministic preview,
ledger and vault capabilities

ROLE: Frontend engineer (money UI). Audit F11, D9, D12, D33, §4.4; needs B4, B5, B7, U4.

FILES:
  - apps/web/features/workspaces/islands/PayoutPolicyScreen.island.tsx
  - apps/web/features/workspaces/components/SplitBar.tsx (delete after migration), SplitLegend.tsx,
    ContributionLedger.tsx, PolicyAmount.tsx, policy-glyphs.tsx
  - apps/web/features/workspaces/styles/workspace-money.css
  - apps/web/features/workspaces/core/WorkspaceService.ts (payout request now { rule?, stakes? })

SPEC:
  1. Module gated by manage_finances (registry already); a member without it is 303'd (B6).
  2. Section "Split rule": SelectButton Co-op · Finder's fee · Benevolent dictator (templates are
     real now — they call save_split_rule, B4). Under it, the template's parameters in FormControl:
     Vault cut % (InputNumber in percent, stored as bp — conversion in one pure helper with tests);
     Finder (Select of active members) + Finder % for finders_fee. One sentence of Meta explaining
     the template (finance-model.md §160-175 wording). Pro-gated templates (B4 ruling) render
     disabled with an InlineNotice + tier-4 "See plans" link — not hidden, not dead.
  3. Section "Member stakes" (hidden for benevolent_dictator, replaced by a Meta line "Everything is
     paid to the Team Vault; distribute it from Finance"): <SplitBar> (U4) with one segment per
     active member, held members marked held (SplitLegend's toggle → ToggleButton). The legend is
     MetaLine tabular percentages; drift (stakes ≠ 10000 — impossible via SplitBar, possible from
     the server after a departure) shows InlineNotice, not a tinted box.
  4. Section "Preview": an amount input (MoneyInput, default 1,000.00 in the team currency) and a
     ledger list from finance.preview_team_split — Platform fee · Finder · Vault cut · each member ·
     Vault dust — as rows with tabular MoneyView figures separated by --hairline; the total row
     equals the input exactly (assert in a unit test against the preview payload). No boxes.
  5. Section "Who can move money": a read-only MetaLine per member of their vault capabilities from
     the detail (view · distribute · withdraw …), so the role ⇄ vault projection (B3) is visible;
     link "Edit in Roles" (tier 5).
  6. Commit: footer rig tier-3 Save (wallet configuration is tier 3 — DESIGN_SYSTEM:1492-1494; NOT
     amber). Save sends { rule, stakes } once; on success re-read detail; on refusal InlineNotice.
  7. No inline style; delete wsp-verdict/wsp-split__drift boxes; useSignalEffect for policyDirty.

ACCEPTANCE:
  - bp ⇄ % helper tests (round-trip, 2-decimal display, integer storage).
  - Preview total == input for 50 random inputs against a mocked preview payload.
  - Keyboard SplitBar test (arrows 1%, PageUp 10%), value text announced.
  - No tier-1 button on this page; exactly one filled control (Save, when dirty).
```

### C5 — Projects: engagements, W_i, proposal allowance

```text
PROMPT C5: /teams/:teamHandle/projects — live engagements, stage assignments with W_i, the team's
proposal allowance

ROLE: Frontend engineer. Audit A6, A7, W1-W3; Decisions #154, #214; needs B2, B7.

FILES:
  - apps/web/features/workspaces/components/ModuleScreen.tsx, ModulePlaceholder.tsx (projects
    currently hands off — replace with a real screen)
  - apps/web/features/workspaces/islands/TeamProjectsScreen.island.tsx (new) +
    components/EngagementRow.tsx (new)
  - apps/web/features/workspaces/styles/workspace-projects.css (new; import from workspace.css)
  - apps/web/features/projects/**/ProjectApplyModal* (team default, #154 (c))
  - documentation/reference/decisions (close #154 (c) if fixed)

SPEC:
  1. Allowance band (top, --surface-1 solid, no card): "Proposals this week" with a ui ProgressBar
     (weekly units used/total, tabular), MetaLine ["buffer 1", "refills Mon", "pool: team"], and the
     gate state: if team_status ≠ active → InlineNotice "Publish the team to send proposals" + tier-4
     link to Settings; if < 2 members → InlineNotice + tier-2 "Invite member" (the band's one
     filled); if the viewer lacks bind_seat → Meta "Ask a lead to apply for the team". Pool wording
     follows the documented answer to #154 (b); if still open, show the payload's numbers without
     naming the pool's owner.
  2. Sub-views (TabMenu in the band, L2): Active · Proposals.
  3. Active: one EngagementRow per B7 projects entry, rows separated by --hairline: project title
     (link /projects/prj-…), stage title (link to the stage), status as <Tag> (lifecycle), assignees
     as AvatarStack, and a W_i readout per assignee "3 / 10" tabular with a ui ProgressBar sized to
     the stage cap; a member at or over the global soft cap shows a Meta warning, never colour alone.
     A stage over its hard cap cannot happen (the DB refuses) — do not draw a state for it.
  4. Proposals: the team's pending applications (reuse the /projects "Your proposals" read with a
     team filter — find it; do not write a new endpoint unless none exists, then add it thin over the
     existing service) with tier-5 "Withdraw" for the filer or a bind_seat holder (#154).
  5. ProjectApplyModal: when the shell is acting as a team and the viewer holds bind_seat, default
     "Apply as" to the team (fixes #154 (c)); refusals from B2 (team_not_active, team_too_small,
     missing_permission) render as the modal's InlineNotice.

ACCEPTANCE:
  - Unit test: band gate state per (status, members, bind_seat) — exactly one filled control or none.
  - The module no longer renders ModulePlaceholder for team projects.
  - Screenshots with 0, 1 and 3 engagements; a member at the soft cap.
```

### C6 — Settings: lifecycle, profile basics, archive blockers

```text
PROMPT C6: /teams/:teamHandle/settings — publish/archive lifecycle with visible blockers

ROLE: Frontend engineer. Audit S1-S5; PRODUCT_MANAGEMENT.md:214; needs B5; open #226 (c).

🧑 DECISION — stop and ask before building Restore: restore to `active` or to `draft` (#226 (c))?
Recommend: restore returns to `active` if the team was ever published, else `draft`, so "a published
entity never returns to draft" holds.

FILES:
  - apps/web/features/workspaces/components/ModuleScreen.tsx (settings route-in)
  - apps/web/features/workspaces/islands/TeamSettingsScreen.island.tsx (new, if settings is a
    placeholder today — check) + styles in workspace-console.css or a new workspace-settings.css
  - apps/web/routes/api/workspace/update.ts (read; contract unchanged)
  - packages/backend/services/workspace/live-writes.ts (map the two 55000 archive messages to typed
    codes `escrow_held` and `live_assignments` so the UI can name them)
  - packages/types/workspace/workspace.ts (refusal codes)

SPEC:
  1. Sections separated by --space-7 and one --hairline, no boxes: Identity (display name InputText
     in FormControl; @handle read-only Meta "Handles can't change" — slugs are immutable), Visibility
     (the existing visibility field via SelectButton), Lifecycle.
  2. Lifecycle: current status as <Tag>; draft → "Publish team" tier 3 (needs manage_settings) with
     a MetaLine of what publishing does (listed on /:handle, can apply once 2 members); active →
     "Archive team…" <Button severity="danger" variant="outlined"> for archive_entity holders only,
     opening ConfirmDialog; archived → Restore (per the ruling) tier 3.
  3. Blockers are shown BEFORE the confirm: the detail exposes (or B7 adds) heldEscrowCount and
     liveAssignmentCount; when either is > 0 the archive control is replaced by an InlineNotice
     naming each blocker with a link (Projects module / wallet) — never a button that will fail.
     Server refusals (escrow_held, live_assignments) still render inline if they race.
  4. The settings save (name, visibility) is the footer rig's tier-3 Save; Publish is the band's
     filled action only while draft (one filled per region: the band and the rig are two regions).

ACCEPTANCE:
  - Unit test: control set per (status, caps, blockers).
  - Probe-backed integration: a team with a held escrow shows the blocker, not the button.
  - PRODUCT_MANAGEMENT.md unchanged unless the restore ruling changes it (then update in this commit).
```

---

## 10. Wave 8 — Storefront `/:handle`

### P1 — Team storefront, public roster, reviews, Standing, namespace guard

```text
PROMPT P1: /:handle for a team — showcase, public roster, collective reviews, Standing; the handle
namespace guard

ROLE: Frontend + platform engineer. Audit §4.2; ROUTING.md:16, 104-105, 207-215; DESIGN_SYSTEM §3.10
(conversion lane); open #226 (b).

🧑 DECISION — stop and ask before changing who may edit the team profile (#226 (b)): PRODUCT_SPEC:591
says owner or lead; the DB grants edit_profile to owner + admin. Recommend: follow the DB; a team
grants leads edit_profile through a custom role.

FILES:
  - apps/web/routes/[handle]/index.tsx, [tab].tsx, _layout.tsx, _middleware.ts (read first)
  - apps/web/features/profile/components/tabs/WorkTab.tsx, components/work/WorkRoster.tsx,
    tabs/ReviewsTab.tsx
  - apps/web/features/profile/** (Standing readout, header rig)
  - packages/backend/services/profile/* (team read — confirm drafts are not listed)
  - packages/types/workspace/workspace.contract.test.ts (RESERVED_HANDLES ⇄ SQL pin)
  - documentation/reference/pr-checklist.md (new line), documentation/business/PRODUCT_SPEC.md (:591
    per ruling), documentation/architecture/ROUTING.md

SPEC:
  1. Visibility: a draft or invite_only team's /:handle is a 404 for non-members (worded as missing);
     a member sees it with a top InlineNotice "Only members can see this until the team is published"
     and a tier-4 link to the console Settings. Archived → 404 for everyone but members.
  2. Work tab roster (WorkRoster): rows, not cards — Avatar, name, MetaLine [role, "since 2025",
     top skill · skill] (skills as text, §B.11), each linking to the member's /:handle. Public roles
     only (preset names; custom roles shown as their base preset name unless the team marks them
     public — if no such flag exists, show the base preset). No stakes, no W_i.
  3. Reviews: the team's collective reviews (reviews whose subject is the team) with the aggregate
     RatingStars + count Badge; members' individual reviews are NOT merged in.
  4. Standing: the team's Standing readout as on a person's profile, MetaLine for its factors.
  5. Conversion lane: unchanged contract — Hire + Add to project (tier 3 Hire per #183, tier 2 Add
     to project), Message and Follow icon-only tier 4; no price control in the main stage (§3.10).
     The owner/editor sees "Manage team" tier 4 → /teams/:teamHandle instead of Hire.
  6. Namespace guard: add to pr-checklist.md: "A new top-level route segment is added to
     org.fn_is_reserved_handle AND packages/types RESERVED_HANDLES in the same change." Extend
     workspace.contract.test.ts to enumerate apps/web/routes/ top-level directories/files and fail
     if any segment (minus route groups and [params]) is missing from RESERVED_HANDLES.

ACCEPTANCE:
  - Contract test fails if you add a dummy routes/foo.tsx without reserving "foo" (verify, then
    remove the dummy).
  - Draft team: 404 for a stranger, notice for a member (integration test or Playwright).
  - Screenshots of a team storefront at three widths; no chips on roster metadata.
```

---

## 11. Last — Docs and verification

### Z1 — Documentation sweep

```text
PROMPT Z1: Teams docs sweep — DESIGN_SYSTEM roster, PRODUCT_SPEC, PRODUCT_MANAGEMENT, database docs

ROLE: Documentation steward. Runs after every prompt above has merged.

FILES:
  - documentation/design-system/DESIGN_SYSTEM.md (§C.1 roster: MetaLine, PermissionMatrix, SplitBar,
    Button structural, LaneCreateButton tone; a short "Workspace console" subsection under Part D
    describing the four-zone lane, the header band and the footer rig — link, don't restate)
  - documentation/business/PRODUCT_SPEC.md (§153-198 Teams: replace the RBAC table with a link to
    database/org/Functions.md:604 and the rulings; persona rule; split templates writable)
  - documentation/PRODUCT_MANAGEMENT.md (team lifecycle row: apply gate, archive blockers, restore)
  - documentation/database/org/*, documentation/database/finance/* (every new function/trigger)
  - documentation/architecture/TEAMS_AUDIT.md (add a "Status" column: Fixed by <prompt> / Open)
  - documentation/reference/decisions/* (mark #226 flags resolved with the deciding prompt/ruling)

SPEC:
  - Rollup, not restatement (documentation/CLAUDE.md rule 2): link to the SSOT row.
  - Every #226 flag ends Resolved (by #228 or a later ruling) or explicitly Open with its owner.

ACCEPTANCE:
  - grep -rn "Contributor" documentation/business/PRODUCT_SPEC.md → only in the ruled form.
  - Every function named in the migrations' team paths appears in documentation/database/*.
  - TEAMS_AUDIT.md status column has no blank cells.
```

### Z2 — Cross-surface verification pass

```text
PROMPT Z2: End-to-end verification of /teams, the console and the storefront against the gates

ROLE: QA engineer. Read-only except for fixes ≤ 10 lines each; anything larger becomes a new
decision row + a note to me.

STEPS:
  1. deno task db:reset; deno task test (check + lint + unit); every probe under supabase/probes/
     touched by B1-B7 run and green.
  2. Playwright (Chromium at /opt/pw-browsers), seeded personas from documentation/database/Seed.md:
     client, operator-mode freelancer, unready freelancer, team owner, team admin, team lead, team
     member, minor. For each: visit /teams, /teams/create, every primary module, a forbidden module,
     the uuid URL of a team, and the team's /:handle. Assert redirects (303/308), refusals and the
     visible controls against TEAMS_AUDIT §1 and Decision #228.
  3. Design gates per page at 1440/900/390 × light/dark/high-contrast × data-motion reduced:
     - count filled buttons per [data-region] (or per landmark/section) ≤ 1 (tier-1 + tier-2 pair
       allowed);
     - no element with a computed backdrop-filter; no computed background colour with alpha < 1 on
       a region/container;
     - every heading's computed font-weight ≤ 500 except section-header labels (≤ 600);
     - every element showing a number has font-variant-numeric containing tabular-nums;
     - every button/[role=button]/[role=gridcell] :active computed transform is a scale and, with
       data-motion="reduced", none;
     - axe-core: zero serious/critical violations;
     - inputs ≥ 16px font-size at 390.
  4. Write the results as a table into documentation/architecture/TEAMS_AUDIT.md §6 "Verification
     (date)", with screenshots saved under the scratch directory (not committed) and the failing
     cases listed with file:line.

ACCEPTANCE: every row green, or each red row has a decision entry and an owner.
```
