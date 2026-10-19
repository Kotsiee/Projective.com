# Teams Surfaces Audit — `/teams` and `/teams/:teamHandle` (2026-10-16)

> Read-only evaluation of the Teams roster and the team console against `PRODUCT_SPEC.md`,
> `PRODUCT_MANAGEMENT.md`, `SYSTEM_ARCHITECTURE.md`, `ROUTING.md` and `DESIGN_SYSTEM.md`. No code
> was changed by this audit. New contradictions it found are logged as **Decision #226** (flags
> for a human; root `CLAUDE.md` §8). Teams and Businesses share one implementation
> (`WorkspaceKind`, Decision #61), so every UI defect below also applies to `/businesses`.
>
> Abbreviations: **F1020** = `supabase/migrations/00001020_functions_org_entities.sql` ·
> **F1210** = `…/00001210_functions_finance_kyc_wallet.sql` · **wsp/** =
> `apps/web/features/workspaces/` · **css/** = `wsp/styles/`.
>
> **Status (Teams Z1, 2026-10-19).** Every finding table ends in a **Status** column: _Fixed by_ the
> work order that closed it ([`TEAMS_BUILD_PROMPTS.md`](TEAMS_BUILD_PROMPTS.md); its decision row
> where it has one, #228–#264), _Open_ with its owner, or _Compliant_ when the audit found nothing
> to do. In §1 the audit's own verdict column is renamed **Audit**. Line numbers in the cells are
> the audit's (2026-10-16) and have since moved.

## 0. Premise corrections

The brief that commissioned this audit carried several assumptions the code and the canonical docs
already contradict. They are corrected here so the plan below does not re-open settled ground.

| Brief assumed | Actual (source) | Status |
| :-- | :-- | :-- |
| Console lives at `/teams/[id]` | Already `/teams/[teamHandle]` (`routes/(dashboard)/teams/[teamHandle]/`), addressed by `org.teams.slug` (`ROUTING.md:100`, `:207`). Only `PRODUCT_SPEC.md:2977` still says `/teams/[team id]` — stale. | Fixed by T0 (#228, the §Sitemap route table) |
| Roles `owner · admin/lead · member · contributor` | Presets are `owner · admin · lead · member` (`ck_team_member_role`, `00000011_tables_org.sql`; `packages/types/workspace/common.ts:53`). **There is no `contributor`** — only the stale RBAC table at `PRODUCT_SPEC.md:189-198` names one. Custom roles cover the gap (`base_preset` admin/lead/member). | Fixed by Z1 — the RBAC table is a link; Contributor is a role template (#250 (a), C3 #264) |
| Modules Overview · Members · Projects · Vault · Settings | The `ModuleKey` vocabulary (`wsp/core/module-registry.tsx:70-88`) is 18 modules. **No `vault`** — team money is `finance` + `payouts`. | Fixed by T0 (#228 (C)); module order by B6 |
| Fixture vs live path in `WorkspaceBackendService` | Live-only; no fixture branch exists (`WorkspaceBackendService.ts:34-38`). `deno task dev:mock` therefore renders `/teams` as 503/401, not fixtures. | No change needed (premise correction) |
| Headings never exceed `--fw-medium` (500) | §A.4 sets **Display / titles at 500** but the **Section-header register at 600** (uppercase label). Root `CLAUDE.md` §3.8 only bans `≥ --fw-bold`. The defect log applies §A.4 as written. | No change needed (premise correction; W1 #251 applies §A.4) |

---

## 1. Functional Audit Matrix

Legend: ✅ compliant · ⚠️ partial / drift · ❌ missing · 📄 doc conflict

### 1.1 Virtual Agency model

| # | Capability | Spec | Implementation | Audit | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| F1 | Draft-first create (name + `@handle` only) | `PRODUCT_SPEC.md:179-182`; `PRODUCT_MANAGEMENT.md:214` | `org.create_workspace(kind, name, handle)` inserts `status='draft'`, `visibility='invite_only'` (F1020:950-1038); seeds 4 preset roles, owner seat, wallet, owner stake 10000 bp. | ✅ | Compliant — no change |
| F2 | Handle charset | Spec: "alphanumeric" | DB: `^[a-z0-9][a-z0-9-]*[a-z0-9]$` (hyphens allowed, F1020:870-886) | 📄 minor — DB is the SSOT; spec wording stale | Fixed by R3 (#254 — PRODUCT_SPEC Draft-First charset) |
| F3 | Create entitlement | `teams_owned` | Enforced (F1020:994-1001) | ✅ | Compliant — no change (R3 #254 types the refusal 402 `entitlement`) |
| F4 | Payout-ready to create / join (#196) | `PRODUCT_SPEC.md:1288-1294` | `fn_assert_payout_ready('freelancer')` on create (F1020:978-980) and accept (:1412-1414). Not on `invite_workspace_member` or `save_team_split` (#196 flags b/d still open). | ⚠️ | Open (#196 (b), #234 (b)/(c) — a finance prompt): `save_team_split` / `save_split_rule` run neither gate |
| F5 | Invitations (named only, 14-day, seat cap incl. pending) | `PRODUCT_MANAGEMENT.md:213` | `invite_* / respond_* / revoke_* / resend_*` (F1020:1229-1542). Join requests / share links cut by design. | ✅ | Compliant — no change |
| F6 | Role hierarchy + rank (owner 4 · admin 3 · lead 2 · member 1) | `database/org/Functions.md:605` | `org.team_roles` presets + custom roles; `fn_member_role_sync` derives `role` from `base_preset`; removal needs strictly higher rank (F1020:1669-1671). | ✅ | Compliant — no change |
| F7 | `contributor` role | `PRODUCT_SPEC.md:197` | Absent everywhere | 📄 → Decision #226 (a) | Fixed by #250 (a) — C3's Contributor template (#264); spec by Z1; whether it adds a grant to Member is Open (#264 (a), product) |
| F8 | Spec RBAC table vs preset bundles | `PRODUCT_SPEC.md:189-198` vs `Functions.md:604` | Bundles diverge (e.g. spec "Lead/Admin = manage splits" but lead lacks `manage_finances`; spec "Member = claim tickets" — not a workspace capability at all) | 📄 → #226 (a) | Fixed by Z1 — PRODUCT_SPEC links `database/org/Functions.md` §6 (#250) |
| F9 | Team member preset effectively holds only `view_analytics` | (inference) | Member preset = `contribute_funds, view_analytics`; team kind filters `contribute_funds` out (F1020:497, :507-527) | ⚠️ intended? → #226 (f) | Ruled by #250 (f) — kept as built |
| F10 | Automated split on escrow release | `PRODUCT_SPEC.md:183-185` | `fn_team_split_plan` / `fn_split_team_payout` (`00001200…:106-221`), credits pass the 7-day pending window (#191) | ✅ | Compliant — no change (B5 property probe) |
| F11 | Split **template** selection (co_op · finders_fee · benevolent_dictator) | `finance-model.md:160-175` | `finance.split_rules` has **no writer** — only `supabase/seeds/03_entities.sql:61` inserts. `save_team_split` writes stakes only. Every live-created team is co_op with `vault_bp = 0`. The `wsp-split__template` buttons in `PayoutPolicyScreen.island.tsx:259` only re-shape stakes client-side. **Fixed:** B4 added the writer `finance.save_split_rule` (#234); C4 wired the Payouts module to it — a SelectButton of the three templates with their cuts, a plan-locked template offered disabled beside "See plans" (the detail's `payout.unlocked_templates`), one Save sending `{ rule, stakes }`. | ✅ | Fixed by B4 (#234) + C4 (#262) |
| F12 | Per-engagement contribution agreements | `MVP_FLOW_AUDIT.md:267-270` | Not built (one team-wide agreement) | ❌ (known, post-MVP) | Open (post-MVP — product) |

### 1.2 Persona restriction

| # | Check | Implementation | Audit | Status |
| :-- | :-- | :-- | :-- | :-- |
| P1 | Hidden from Client persona (nav) | `nav-model.ts:91-94` `showTeams = isSeller \|\| contextType==='team'` | ✅ | Compliant — no change |
| P2 | Hidden from Client persona (create menu) | `actions-model.ts:43-45` offers **Create Team** to every non-enterprise context, clients included | ❌ | Fixed by B1 (#228 (A)) |
| P3 | Route guard for `/teams*` by persona | Only the minor guard (`restricted-surfaces.ts:16`) applies; a client can type `/teams` and reach the roster + create modal | ❌ | Fixed by B1 (#228 (A)) |
| P4 | DB refusal for a non-freelancer | Incidental only: `fn_assert_payout_ready('freelancer')` fails for lack of a `freelancer_profiles` row → refusal reads `payout_not_ready`, not a persona refusal | ⚠️ | Fixed by B1 (`org.fn_assert_team_persona`) |
| P5 | Operator mode | `org.is_operator` never consulted by team paths; no app gate | ❌ (needs a ruling — #226 (g)) | Fixed by B1 (#228 (A)) |
| P6 | Minors (13–17) | DB (`fn_assert_adult`, `trg_workspace_member_adult`) + app guard; #192(b) resolved by #208 | ✅ | Compliant — no change |

### 1.3 State machine `draft → active → archived`

| # | Check | Implementation | Audit | Status |
| :-- | :-- | :-- | :-- | :-- |
| S1 | Publish needs `manage_settings`; never back to draft | `set_workspace_status` (F1020:1045-1118, :1079, :1082-1084) | ✅ | Compliant — no change (C6 #261 offers Publish on Settings) |
| S2 | Archive / restore owner-only (`archive_entity`) | F1020:1075-1078 | ✅ | Compliant — no change |
| S3 | Archive blocked by held escrow | F1020:1086-1095 — matches only `payee_type='team' AND payee_id=team` | ⚠️ escrows bound to a member for team work, or not yet bound, slip past (#197 flag b) | Fixed by B5 (guard widened) + C6 (#261 `fn_team_archive_blockers`) |
| S4 | Archive blocked by live stage assignment | F1020:1096-1105 (`sa.team_id`, project `active/on_hold`) | ✅ | Compliant — no change; listed before the press by C6 (#261) |
| S5 | Restore target | PM says restore → `active` **or** `draft`, and also "a published entity never returns to draft" | 📄 → #226 (c) | Fixed by #250 (c) + C6 (#261 `fn_workspace_restore_target`) |
| S6 | ≥2 members to **activate** | Not required by spec or DB (≥2 is a *proposal* rule only) | ✅ by spec — note the brief conflated the two | Compliant — no change |
| S7 | Hard delete | None; `Archived` only | ✅ | Compliant — no change |
| S8 | Membership `active → left` only | `ck_team_member_status`; reactivation on re-join. Stale comment in `common.ts:55-58` mentions `invited/requested` | ✅ / tidy | Fixed by C3 (#264 — the stale comment) |

### 1.4 Proposal allowance & `bind_seat`

| # | Check | Implementation | Audit | Status |
| :-- | :-- | :-- | :-- | :-- |
| A1 | Only `bind_seat` holders apply for the team | `apply_to_project` → `org.is_team_lead` = `fn_member_can(…,'bind_seat')` (`00001130…:1025-1041`; F1020:642-650) | ✅ | Compliant — no change |
| A2 | Team needs ≥2 active members | Enforced in `apply_to_project` (`check_violation`) | ✅ | Compliant — no change |
| A3 | ≥2 on `apply_to_seat` | **Missing** (`00001130…:881ff` checks lead + payout-ready only) | ✅ fixed by B2: both doors run `projects.fn_assert_team_can_apply` (`supabase/probes/team_apply_gates.sql`) | Fixed by B2 (#228 (E)) |
| A4 | Team status checked on apply | Neither path checks `org.teams.status` — a **draft or archived** team can apply | ✅ fixed by B2: `team_not_active` on both doors and in the pre-flight (#228 (E)) | Fixed by B2 (#228 (E)) |
| A5 | `team_too_small` / `missing_permission` refuse even meter-only | `SYSTEM_ARCHITECTURE.md:1985-1986`; pre-flight in `ProjectBackendService.apply` | ✅ | Compliant — no change |
| A6 | Team pool vs members' pool | `finance-model.md:480` vs `database/finance/Tables.md:311` vs `PRODUCT_SPEC.md:1376` | 📄 (#154 flag b, still open) | Open (#154 (b) — product ruling; C5 #259 leaves the pool unnamed) |
| A7 | Apply modal defaults to "Yourself" in team context | #154 flag (c) | ✅ fixed by C5: acting as a team the viewer may bind (`bind_seat`, read from the team's allowance), "Apply as" opens on the team; otherwise "Yourself" (`features/view/core/apply-as.ts`) | Fixed by C5 (#259; closes #154 (c)) |

### 1.5 Workload Intensity (W_i)

| # | Check | Implementation | Audit | Status |
| :-- | :-- | :-- | :-- | :-- |
| W1 | Per-person stage hard cap + global soft cap at claim/assign | `projects.check_ticket_capacity` (`00001140…:183-260`), used by `fn_assign_ticket_core` and RR/parallel assignment | ✅ | Compliant — no change |
| W2 | Accepting a seat adds no W_i (Decision #214) | Keyed on `current_assignee_id` | ✅ | Compliant — no change |
| W3 | Team-level capacity | `org.teams.current_workload_intensity` has **no writer** (`fn_sync_workload_intensity` updates `freelancer_profiles` only); view's team `workload_cap` = default × members, cosmetic (`00003001…:265-273`) | ✅ ruled by #233 (a): the team figure is the members' live W_i summed in the read (`org.profiles_index`, `get_workspace_detail`); the column is no longer read (`supabase/probes/workspace_detail_payload.sql`); the team's search row carries the same live figure (#235, `supabase/probes/team_search_workload.sql`) | Fixed by B7 (#233 (a)) + #235 |

### 1.6 Backend & data integrity

| # | Check | Implementation | Audit | Status |
| :-- | :-- | :-- | :-- | :-- |
| B1 | Roster RPC | `WorkspaceBackendService.roster` → `org.get_workspace_roster('team')` (`live-roster.ts:120`) | ✅ | Compliant — no change |
| B2 | Detail RPC | `.detail` → `org.get_workspace_detail('team', handle)` (`live-detail.ts:228-238`); `not_found`→404, `forbidden`→403 | ✅ | Compliant — no change |
| B3 | `ServiceResult<T>` everywhere; guest 401, DB down 503 | `WorkspaceBackendService.ts:18, 223-235` | ✅ | Compliant — no change |
| B4 | Thin routes | 15 `/api/workspace/*` routes, each one RPC via `live-writes.ts`; each write re-reads detail | ✅ | Compliant — no change |
| B5 | Direct table reads in service | `live-detail.ts:120` reads `org.profiles_index`; `live-money.ts:112-117` selects `finance.wallets` / `finance.split_rules` directly (user JWT, RLS applies) | ✅ fixed by B7: folded into `get_workspace_detail` — one RPC per detail read; the payout block for `manage_finances` only (#233 (b)) | Fixed by B7 (#233) |
| B6 | RLS on `org.teams` / `team_members` / `team_roles` / `org_invitations` | Enabled (`00002001…:76-93`); SELECT-only policies; zero write policies; invitations zero policies (token = capability); all writes are definer doors | ✅ | Compliant — no change |
| B7 | `finance.vault_permissions` projection | `fn_vault_capabilities_for` + `fn_sync_vault_permissions` (F1020:666-733) | ✅ mapping | Compliant — no change |
| B8 | Projection kept in sync | Called explicitly by every RPC + wallet-insert trigger. **No trigger on `team_members` / `team_roles`** — any future write path that forgets the call leaves a stale vault grant (e.g. a revoked `withdraw_funds` still in `vault_permissions`) | ⚠️ add a backstop trigger (#226 (e)) | Fixed by B3 (#226 (e) backstop triggers) |
| B9 | Split dust → vault | `fn_team_split_plan`: floor every cut, `dust_minor` added to `vault_total_minor` | ✅ | Compliant — no change (B5 property probe) |
| B10 | Departure rebalance remainder | Goes to the **largest absorber**, not the vault (F1020:1553-1610) | ✅ deliberate (stakes must total 10000 bp; there is no vault stake) | Compliant — no change (documented in finance-model by B5) |

---

## 2. Visual & Design-System Defect Log

Severity: **G** = merge-gate violation (root `CLAUDE.md` §3) · **M** = matrix / parity drift · **T** = tidy.

### 2.1 Press feedback & motion (§3.12, §B.12)

| ID | Sev | Defect | Fix | Status |
| :-- | :-- | :-- | :-- | :-- |
| D1 | G | No `:active` rule anywhere in `css/`; ~45 raw controls have **no press feedback** | Migrating to `Button` (§3 below) inherits `scale(var(--btn-press-scale))` 0.97 / icon 0.92. Non-Button custom controls (`wsp-matrix__cell`, `SplitBar` handle, `wsp-chart__card`) get `transform: scale(var(--btn-press-scale))` on `:active` + `transform: none` under both reduced-motion channels. ✅ matrix: C3 — the cells are the ui `PermissionMatrix`'s (`scale(var(--btn-press-scale-icon))`, none under both channels); `wsp-matrix__cell` is deleted. | Fixed by U3/U4 + L1–L2, R1–R3, C1–C6 (ui controls press); the ui lane controls' own gap is Open (packages/ui, #255) |
| D2 | G | `chrome.css:274` (lane filter pill) handles `prefers-reduced-motion` but not `:root[data-motion="reduced"]` | Add the attribute selector. | Fixed by W1 (#251); L1 (#255) deleted the pill |
| D3 | G | Literal durations: `console.css:1040` `* 40ms`; `tokens.css:547` `2.4s`; `:699` `2s` | `--dur-stagger`, `--dur-ambient-*` tokens (add to `packages/ui` if absent). | Fixed by U1 + W1 (#251) |

### 2.2 Typography (§3.8, §A.4)

| ID | Sev | Defect | Fix | Status |
| :-- | :-- | :-- | :-- | :-- |
| D4 | G | Display H1s at `600`: `.wsp-roster__title` (roster.css:36), `.wsp-idhead__name` (console.css:254) | `var(--fw-medium)`. | Fixed by W1 (#251) |
| D5 | G | Title-register headings at `600`: `.wsp-pagehead__title` (console:177), `.wsp-headerband__name` (chrome:596), `.wsp-empty__title` (roster:658), `.wsp-checklist__title` (console:441), `.wsp-invitestrip__title` (roster:154), `.wsp-people__group-title` (people:154), `.wsp-mdrawer__name` / `__section-title` (people:695/743), `.wsp-roleeditor__group-title` (matrix:503) | `--fw-medium`; where a level must differ, change size/case/colour, never weight alone (§3.8). Section-header ones (uppercase label) keep `--fw-semibold` as a **token**. ✅ `.wsp-roleeditor__group-title`: C3 — the rule is deleted with the inline composer (the role editor is a `Dialog` of `FormControl` fields). | Fixed by W1 (#251) + C3 (#264) |
| D6 | G | `700` on `.wsp-matrix__ovr` (matrix:352) | `--fw-semibold` at most. ✅ C3 — the rule is deleted with the hand-rolled matrix. | Fixed by W1 (#251) + C3 (#264) |
| D7 | M | ~25 further literal `600`s (names, values, chips) | Replace with `var(--fw-*)`; names at `--fw-medium`. | Fixed by W1 (#251) |
| D8 | M | `tabular-nums` missing on `.wsp-card__stats / __stat / __stat-delta` (roster.css:500-549) | Add `.wsp-num` or `font-variant-numeric: tabular-nums`. ✅ fixed by R1: the stat grid is gone — the card's counts are tabular `MetaLine` entries and its one money figure (`.wsp-card__figure` / `__figure-value`) is tabular, both held by `styles.gate.test.ts` | Fixed by R1 (#260) + the W1 gate |

### 2.3 Separation, anti-card & solid tones (§3.1, §3.6)

| ID | Sev | Defect | Fix | Status |
| :-- | :-- | :-- | :-- | :-- |
| D9 | G | Translucent backgrounds via `color-mix(…, transparent)`: matrix cells (281, 291), legend marks (407, 412), preset hover (325), `.wsp-capchip[consequential]` (595); `.wsp-verdict[…]` (money 863-873); `.wsp-override[grant/revoke]` (people 395/400); `.wsp-create__kind[data-on]` (roster 821/826); `.wsp-chip[tone]` (tokens 608-618); tokens 66/87/109/134/136/148/149/176 + HC copies | Re-derive every `--wsp-*-tint` as an **opaque** mix against the region tone (`color-mix(in oklab, var(--success) 12%, var(--surface-1))`). ✅ matrix: C3 — the cells, legend marks, preset hover and `.wsp-capchip` are gone with their tokens and hatches; the ui `PermissionMatrix` paints the opaque U1 tints. | Fixed by W1 (#251) + C3 (#264) |
| D10 | M | `opacity` used as a state dim (chrome 829; matrix 549; money 206/212/235/627/781/982; people 204; roster 332) — lowers label contrast below 4.5:1 | Use `--text-secondary` / `--fld-disabled-mix` tokens instead of opacity. | Fixed by W1 (#251) |
| D11 | G | Inset rings reading as four-sided borders on static containers: `.wsp-mcard[data-self]` (people:193), `[data-state=requested]` (:200), `.wsp-card[data-acting]` (roster:327), `.wsp-lane__entity[data-acting]` (chrome:167) | Express "self / acting" with a leading `--hairline` accent rule or tonal step (`--surface-2`), not a box. ✅ Members half by W1 + C2: the card and the table row keep W1's leading rule in `--wsp-acting-ring` (the row's as a logical `::before` the table's hover and focus never reset — C2 review) and their MetaLine says "You"; the `[data-state]` rules are gone with the states (the roster holds active members only) | Fixed by W1 (#251) + C2 (#263) |
| D12 | G | Boxed static content: `.wsp-propose` (console:326), `.wsp-verdict` (money:858), `.wsp-split__drift` (money:407), `.wsp-lock[pending]` (money:921) | `InlineNotice` (a required disclosure may be contained) or unboxed Meta text. ✅ `.wsp-verdict` (dead) and `.wsp-split__drift` deleted by C4 — split drift is an `InlineNotice` with a Rebalance action; `styles.gate.test.ts` keeps both deleted | Fixed by C1 (#256) + C4 (#262) |
| D13 | M | `.wsp-approvals__item` rows on `--surface-1` inside a band | Plain rows separated by one `--hairline`. | Fixed by BU2 (#246 — plain rows, one hairline) |
| D14 | T | `border: 1px solid` literals (chrome 79/227/787/865; money 433; people 561; roster 246/796/886) | `var(--hairline)` / `--hairline-strong`. | Fixed by W1 (#251 — named tokens) |
| D15 | T | Literal `@media (max-width: 767px \| 1100px)` across 6 sheets | Breakpoint tokens (`--bp-md` via the ui custom-media set). | Fixed by W1 (#251); the unit convention is Open (#251 (a), a human) |
| D16 | T | Literal px gaps/sizes/rings (see agent list: chrome 103/173/467, console 433/519/682/728, matrix 106/340-350, money 203/311/582/792/938/1021-1023, people 55/306/343, roster 61/206/362) | `--space-*`, `--hairline-w`, `--focus-ring-*` tokens. | Fixed by W1 (#251 — px only in token declarations) |

### 2.4 Anti-tagification (§3.7, §B.11)

| ID | Sev | Defect | Fix | Status |
| :-- | :-- | :-- | :-- | :-- |
| D17 | G | Role label as `wsp-chip`: `WorkspaceCard.tsx:114,121`, `WorkspaceTable.tsx:157`, `WorkspaceLane.island.tsx:498` | Inline Meta: `Owner · 4 members · Active 2d ago`. ✅ fixed by R1 (the lane row by L1): the card's facts are one `MetaLine` (`cardMeta`, `core/roster-model.ts`: role · N members · N live projects · Acting), the table's role cell a `MetaLine`; `roster.gate.test.ts` fails on any `wsp-chip` in the roster | Fixed by R1 (#260) + L1 (#255) |
| D18 | G | Kind chip "Team" in `InvitationStrip.tsx:111` | Meta text. ✅ fixed by R2: the row's facts are one `MetaLine` (kind · as role · from @inviter · expires in N days, tabular); `.wsp-chip--kind` deleted. | Fixed by R2 (#253) |
| D19 | G | "Unlimited" / "Per purchase" chips (`SpendLimitRow.tsx:161,168`) | Meta text. | Fixed by BU2 (#246 — `MetaLine` facts) |
| D20 | G | `wsp-capchip` capability labels (`MemberCard.tsx:492`, `MemberTable.tsx:89`, `WorkspaceOverview:134` standing) | Meta text list; the sensitive count may stay a **count** badge. ✅ Members half fixed by C2: the card and the table say a member's overrides as one `MetaLine` and the sensitive grants as a ui `Badge` count (`OverrideLine` / `SensitiveCount`); `CapChip` is deleted. The Overview's Standing chip is C1's | Fixed by C2 (#263) + C1 (#256, Standing) |
| D21 | M | `wsp-override` grant/revoke chips (`MemberCard.tsx:449,480`; `MemberTable.tsx:77`) | Meta text with `+`/`−` glyph prefix; "+N more" stays a count. ✅ fixed by C2: "+2 granted · −1 revoked" as a `MetaLine` (`overrideItems`, `core/members-model.ts`, unit-tested), every override by name in its title; the `.wsp-override` rules are deleted | Fixed by C2 (#263) |
| ✅ | — | Lifecycle `Tag` (Billing), acting chip, status dots | Allowed containers. | Compliant — no change |

### 2.5 Buttons (§B.8 matrix, one filled per region)

| ID | Sev | Region · control | Current | Required | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| D22 | M | Roster empty · "Create a team" (`RosterEmpty.tsx:86`) | Tier 3 filled primary | **Tier 2** monochrome inverted (primary creation trigger) ✅ fixed by R1: the first run is the ui `EmptyState` with one tier-2 structural Create (`rosterCanvasControls`), and the lane footer withholds its own create in first run (`lane-model.ts` `firstRun`), so the page holds exactly one filled control (`roster-model.test.ts`) | Fixed by R1 (#260) |
| D23 | M | Roster lane · New (`WorkspaceLane.island.tsx:~308`), rail New (`WorkspaceRail.tsx:249`) | `LaneIconButton accent` / raw button | `LaneCreateButton` (tier 2) — parity with ProjectsLane:567, CatalogueLane:151 | Fixed by L1 (#255) on U2's tone |
| D24 | M | Create modal · "Create team" (`CreateWorkspaceModal.island.tsx:258`); Roles · "Create role" (`RolesMatrix.island.tsx:538`) | Tier 3 | Tier 2 (structural creation) ✅ Roles: C3 — the `RoleEditor`'s Create role is tier 2 structural (Save role, renaming, tier 3; Cancel tier 5), and New role is the header band's tier-2 commit (`roleEditorFooter`, `rolesCommit`, `roles-model.test.ts`) | Fixed by R3 (#254) + C3 (#264) |
| D25 | G | Invitation strip · Accept ×N (`InvitationStrip.tsx:119`, `roster.css:254` `background: var(--wsp-kind)`) | Raw filled button **per row** → N filled in one region | `Button` tier 3 on the *first/focused* invite only, or all rows `variant="outlined"` with one filled "Accept" inside an expanded row; Decline `variant="text"` ✅ fixed by R2: `planInviteActions` (`core/invitation-strip-model.ts`, unit-tested) gives the first row's Accept tier 3 and every other tier 4 neutral outlined, Decline tier 5 on every row; the `.wsp-invitestrip__accept` fill is deleted | Fixed by R2 (#253) |
| D26 | M | Error · "Try again" (`WorkspaceRoster.island.tsx:355`) | Raw ghost | Tier 4 `severity="neutral" variant="outlined"` (B.8.1 names it) ✅ fixed by R1: a failed read is an assertive `InlineNotice` with a danger mark and a tier-4 Try again (a failed act says so with no retry — the menu repeats it) | Fixed by R1 (#260) |
| D27 | M | Footer rig · Save (`WorkspaceFooterRig.island.tsx:183`) | Ghost with `data-active` tint | Tier 3 `Button` filled when dirty — the console's one workflow commit ✅ fixed by L2: `rigModel` (`core/rig-model.ts`, unit-tested) renders Save as a tier-3 `Button` ONLY while `policyDirty`, with a tier-5 Discard beside it and the save state said before them; the rig's one filled control | Fixed by L2 (#258) |
| D28 | M | Footer rig · Invite, Settings, Org chart; header band icon (`HeaderBand:197`) | Raw ghost `wsp-footerrig__action` | Tier 4 neutral outlined (Invite, Settings are named utilities); Org chart tier 5 ✅ fixed by L2: New and Invite (in place) are tier-4 neutral outlined `Button`s, Invite elsewhere and Settings are ui `Link`s (navigation), the Org chart toggle is a tier-5 text `Button` with `aria-pressed`, and the band's kebab is a tier-5 `Button iconOnly` (ui `Button` gained `triggerRef`) | Fixed by L2 (#258) |
| D29 | M | Header band actions (`HeaderBand.island.tsx:162,175`) | Popover + raw buttons | `ActionMenu` (as `WorkspaceCard` / `MemberCard` already do; Decision #222) ✅ fixed by L2: `headerMenu` (`core/header-model.ts`, unit-tested) builds the rows with `linkActionItems` / `composeMenu`; the band is the menu's `surface`, so right-click, the ContextMenu key and Shift+F10 open the kebab's rows; Archive… only with `archive_entity`, confirmed as a danger | Fixed by L2 (#258) |
| D30 | M | Spend approvals · Approve / Decline (`ApprovalQueue.tsx:81,95`, business) | Raw ghost | Approve tier 3, Decline tier 5 | Fixed by BU2 (#246 — `Button` tiers) |
| D31 | ✅ | Ownership transfer · `filled danger` (`OwnershipTransfer.tsx:95`) | — | Matches `DESIGN_SYSTEM.md:1393-1398` | Compliant — no change |
| D32 | ✅ | Billing · Pay (`BillingScreen.island.tsx:221`) tier 1 accent rounded | — | Correct (business only) | Compliant — no change |
| D33 | T | Payout split has no tier-1 control — correct: saving a split is wallet **configuration** (tier 3, `DESIGN_SYSTEM.md:1492-1494`), not a money movement | — | Keep tier 3 | Compliant — no change (C4 #262 keeps tier 3) |

### 2.6 Fields & focus (§A.7)

| ID | Sev | Defect | Fix | Status |
| :-- | :-- | :-- | :-- | :-- |
| D34 | G | 6 native `<select class="wsp-select">` (OwnershipTransfer:123; RolesMatrix:509; MemberDrawer:282,326; MembersScreen:295; InviteModal:171) bypass `--fld-*` geometry and the 16px mobile floor | `Select` (MembersScreen sort → `SortControl`) ✅ five of six fixed by C2: the transfer's successor, the drawer's Role and Reports to and the invite's Role are ui `Select`s in `FormControl`s; the Members sort select is deleted (the People `DataTable` sorts by its own header). RolesMatrix's is C3's, and its `.wsp-select` rules moved into C3's `workspace-matrix.css` (C2 review) so they go with their last user; `core/members-screen.gate.test.ts` holds the C2 files. ✅ six of six with C3: the role editor's Based on (and Start from) are ui `Select`s in `FormControl`s, `.wsp-select` is deleted, and `core/roles-screen.gate.test.ts` holds the C3 files | Fixed by C2 (#263) + C3 (#264) |
| D35 | G | Raw checkbox (`OwnershipTransfer.tsx:158`) | `Checkbox` ✅ fixed by C2 ("Leave the team after the transfer") | Fixed by C2 (#263) |
| D36 | M | Hand-rolled `role="radio"` groups (InviteModal:125; CreateWorkspaceModal:274) | `RadioGroup` or `SelectButton` ✅ fixed: R3 (create) and C2 (invite: By handle · By email as a `SelectButton`) | Fixed by R3 (#254) + C2 (#263) |
| D37 | M | Hand-rolled `<label class="wsp-*__label">` (InviteModal 151/170/200; Create 304/317; Roles 490/508; Drawer 310/325; Transfer 120/157) — no touched/blur validation, no error wiring | `FormControl` (gives the §A.7 rest-only validation paint and focus clearing) ✅ Invite, Drawer and Transfer fixed by C2 (every field a `FormControl`; the invite's handle and email paint at rest through `useFieldValidation`); Create by R3; Roles is C3's ✅ Roles: C3 — the `RoleEditor`'s Name, Start from and Based on are `FormControl` fields (Name paints at rest through `useFieldValidation`); `core/roles-screen.gate.test.ts` holds no `<label>` | Fixed by C2 (#263), R3 (#254), C3 (#264) |
| D38 | G | 47 local `:focus-visible { outline: none }` with no replacement ring → keyboard focus invisible unless the ui base paints it | Delete the local overrides; controls inherit `--focus-ring-shadow` from ui. Verify in the browser before merge. | Fixed by W1 (#251; rings off app-wide, #217 (n)) |

### 2.7 Other gates

| ID | Sev | Defect | Fix | Status |
| :-- | :-- | :-- | :-- | :-- |
| D39 | G | Inline `style=` (custom properties only) in ~30 places (`--wsp-i` stagger; meter fills; `SplitBar.tsx:294` `${lift}px`) | Stagger: `:nth-child()` + `--wsp-i` set by CSS counter or a `data-i` attribute selector ladder; fills: `ProgressBar value` (ui owns its own style seam). ✅ the split bar's half fixed by C4: `components/SplitBar.tsx` deleted, the payouts module uses the ui `SplitBar` (U4), whose widths ride the package's own `styleVars` seam | Fixed — stagger by W1 (#251), fills by R1, C1, C2, C4, BU2: no `style=` is left in `wsp/` |
| D40 | M | `useEffect` that only mirrors one signal into another (Spend/Payout/Billing `policyDirty`, `saveRequested`) | `useSignalEffect` / `computed`; keep `useEffect` only for DOM reads (`WorkspaceLane:157`, `SplitBar:163`, focus). ✅ the `policyDirty` / `saveRequested` half fixed by L2: Payouts, Spend and Billing answer the rig through one `usePolicyBridge` (`hooks/usePolicyBridge.ts`, `useSignalEffect` only), which also carries Discard | Fixed by L2 (#258 — `usePolicyBridge`) |
| D41 | T | Dead CSS: `.wsp-footerrig__action[data-variant]` (chrome 807-818), `.wsp-lane__new` (~299), `.wsp-skel__*` (console ~944) | Delete. | Fixed by W1 (#251) + L2 (#258); the kept `.wsp-footerrig__action` is dead since BU2 — Open (a workspaces CSS tidy, #258 (g)) |
| ✅ | — | No `backdrop-filter`; no hex/rgb; no Supabase in islands; no `useState` | Compliant. | Compliant — no change |

---

## 3. Component Refactoring Plan

Order: P0 = gate violations, P1 = matrix/parity, P2 = tidy. All paths under `wsp/` unless noted.

### 3.1 File-by-file

| File | Migrate to `@projective/ui/*` | Notes | Pri | Status |
| :-- | :-- | :-- | :-- | :-- |
| `islands/WorkspaceRoster.island.tsx` | `navigation/TabMenu` (tabs :293-318) · `fields/Button` neutral outlined (retry :355) · `feedback/InlineNotice` (error) | drop `--wsp-i` inline styles | P1 | Fixed by R1 (#260) |
| `components/RosterEmpty.tsx` | `utils/EmptyState` + tier-2 `Button` | parity with `ProjectPortfolio` | P1 | Fixed by R1 (#260) |
| `components/InvitationStrip.tsx` | `fields/Button` (Accept/Decline/dismiss) | one filled per region (D25); kind chip → meta (D18) | P0 | Fixed by R2 (#253) |
| `components/WorkspaceCard.tsx`, `WorkspaceTable.tsx` | `Button iconOnly text` kebab trigger; `display/ProgressBar` (meter :173) | role chip → meta (D17); tabular stats (D8) | P0 | Fixed by R1 (#260) |
| `islands/WorkspaceLane.island.tsx` | `navigation/LaneCreateButton` (New) · `fields/ToggleButton` or `SelectButton` (filter pills :354) · `Button text` (reset :367) | role chip :498 → meta | P0 | Fixed by L1 (#255) |
| `components/WorkspaceRail.tsx` | `LaneCreateButton` / `LaneIconButton` | | P1 | Fixed by L1 (#255) |
| `components/ContextSwitchControl.tsx` | `Button` ×4 | | P1 | Fixed by L1 (#255 — tier-4 `Button`) |
| `islands/WorkspaceHeaderBand.island.tsx` | `navigation/TabMenu` (tabs :127-147, parity with `CatalogueHeader`) · `navigation/ActionMenu` (:162,175) · `Button iconOnly` (:197) | anchor-styled actions → `Link` | P1 | Fixed by L2 (#258) |
| `islands/WorkspaceFooterRig.island.tsx` | `Button` (RigButton → tier 4/5; Save → tier 3) · `Link`/`LaneIconButton href` for anchors (:164,:199) | delete `data-variant` CSS | P1 | Fixed by L2 (#258) |
| `islands/WorkspaceOverview.island.tsx` | — | capchip :134 → meta; drop inline stagger | P0 | Fixed by C1 (#256) |
| `components/SetupChecklist.tsx` | `display/ProgressRing` (:93-99) · `Button iconOnly text` dismiss | heading weight | P1 | Fixed by C1 (#256 — replaced by `SetupHero`) |
| `components/ProjectList.tsx`, `SpendLimitRow.tsx` | `display/ProgressBar` | SpendLimitRow chips → meta | P0 | Fixed by C1 (#256, ProjectList) + BU2 (#246, SpendLimitRow) |
| `components/MemberCard.tsx`, `MemberTable.tsx` | `Button iconOnly text` kebabs | capchip/override chips → meta (D20-21); self/requested rings (D11) | P0 | Fixed by C2 (#263) |
| `islands/MemberDrawer.island.tsx` | `fields/Select` ×2 · `fields/FormControl` · `Button variant="link"` (:380) | | P0 | Fixed by C2 (#263) |
| `islands/MembersScreen.island.tsx` | `fields/SortControl` (:295) · `Button link` (:325) | `.wsp-propose` box → `InlineNotice` | P0 | Fixed by C2 (#263) |
| `components/OrgChart.tsx` | `display/OrgChart` (already exported) | delete local tree | P2 | Open (packages/ui) — kept local by C2 (#263): the ui `OrgChart` is single-root |
| `components/OwnershipTransfer.tsx` | `fields/Select` (:123) · `fields/Checkbox` (:158) · `FormControl` | keep `filled danger` | P0 | Fixed by C2 (#263) |
| `islands/InviteModal.island.tsx` | `RadioGroup`/`SelectButton` (:125) · `Select` (:171) · `FormControl` | | P0 | Fixed by C2 (#263) |
| `islands/CreateWorkspaceModal.island.tsx` | `RadioGroup`/`SelectButton` (:274) · `Button text` (suggestion :359) · `FormControl` · tier-2 Create | replace `setTimeout(60)` focus with Dialog `initialFocus` | P1 | Fixed by R3 (#254) |
| `islands/RolesMatrix.island.tsx` | `Select` (:509) · `Button text` (col buttons :358-385) · `FormControl` | matrix cell keeps custom control + press scale (D1); opaque tints (D9) — ✅ C3: the matrix is the ui `PermissionMatrix` (U3), the column actions an `ActionMenu`, the editor `components/RoleEditor.tsx` (`FormControl` · `InputText` · `Select`) | P0 | Fixed by C3 (#264) |
| `islands/PayoutPolicyScreen.island.tsx` | `SelectButton` (templates :259) | wire templates to the new `save_split_rule` RPC (§4.4) ✅ C4 | P0 (functional) | Fixed by C4 (#262) |
| `components/SplitLegend.tsx`, `SplitBar.tsx` | `ToggleButton` (hold :149); SplitBar handle stays custom | remove `${lift}px` inline style ✅ C4: the legend is a `MetaLine` + one hold toggle per member — a tier-5 text `Button` with `aria-pressed` (the unfilled two-state toggle, as the rig's Org chart toggle; a pressed `ToggleButton` is a `--primary` fill, so C4 review replaced it); the feature's `SplitBar.tsx` is replaced by the ui `SplitBar` | P1 | Fixed by C4 (#262) on U4 |
| `components/ApprovalQueue.tsx` (business) | `Button` tier 3 / 5 | | P1 | Fixed by BU2 (#246) |
| `styles/*.css` | — | D2-D16, D38, D41; replace literal weights/durations/breakpoints with tokens | P0/P2 | Fixed by W1 (#251) |
| `apps/web/features/shell/core/actions-model.ts:43-45` | — | gate "Create Team" on `isFreelancer` (P2) | P0 | Fixed by B1 (#228 (A)) |
| `apps/web/routes/(dashboard)/teams/*` | — | persona guard (P3) via the dashboard middleware's surface table | P0 | Fixed by B1 (#228 (A)) |

### 3.2 Proposed `packages/ui` additions

| Addition | Package | Why | Status |
| :-- | :-- | :-- | :-- |
| `LaneCreateButton` **tier-2 skin** (monochrome inverted) | `navigation` | §B.8.1 names it tier 2; it still ships teal (agent finding). Fix once, every lane inherits. | Fixed by U2 (#228 (D)) |
| `MetaLine` (`items: string[]`, middot-joined, `--text-secondary`, optional `tabular` per item) | `display` | Every chip→meta migration (D17-D21) and the catalogue/projects equivalents re-implement this. One primitive enforces §B.11. | Fixed by U1 |
| `Button severity="inverse"` (tier 2) if not present | `fields` | Tier 2 is currently a per-surface recipe (§D.7.7); a severity makes it auditable. | Fixed by U2 — the `structural` prop, not a severity |
| `PermissionMatrix` cell primitive (tri-state allowed / conditional / locked, keyboardable, press-scaled, opaque tints) | `display` | Roles grid is the only custom grid control left; Businesses and Enterprises need the same. | Fixed by U3 (+ C3 #264) |
| `SplitBar` (draggable proportional bar, bp-integer output, `aria-valuenow` per handle) | `fields` | Money control used by team payouts; must meet §A.7 focus + reduced motion. | Fixed by U4 |
| Motion tokens `--dur-stagger`, `--dur-ambient` | `system/` tokens | Removes D3 literals. | Fixed by U1 |

---

## 4. Strategic Architecture Decisions (ready for implementation)

Each is logged under **Decision #226** with a proposal; items marked *needs ruling* await a human.

### 4.1 Routing & URL identity — RESOLVED by existing contract; two fixes

- **Contract (unchanged):** the console is `/teams/:teamHandle[/:module]`, `:teamHandle` =
  `org.teams.slug`, immutable after insert (`trg_teams_immutable`). Builder:
  `workspaceHref(kind, handle, module?)`. `PRODUCT_SPEC.md:2975-2981` is to be corrected to this
  and to the real module list (`overview · projects · catalogue · calendar · messages · members ·
  roles · invitations · finance · payouts · analytics · standing · profile · verification ·
  settings` for a team). There is no `vault` module; "Vault" is the user-facing name of the
  `finance` module's team wallet.
- **Fix 1 — UUID canonicalisation is 303, should be 308.** `get_workspace_detail` accepts a uuid,
  and `consoleOutcome` (`workspace-route.tsx:100-104`) redirects to the handle — but the route
  answers **303** (`teams/[teamHandle]/index.tsx:27`). Split the outcome: `canonical` (uuid → handle,
  wrong-case handle → lowercase) answers **308** (the mapping is permanent: slug is immutable);
  `module` (viewer may not open it) stays **303** (viewer-dependent, must not be cached). Only a
  member ever receives either — a non-member gets `forbidden`, so the 308 discloses nothing.
  ✅ Fixed by B6 (#228 (B); `core/console-route.ts`).
- **Fix 2 — handle history.** `org.handle_changes` already reserves an old handle for 90 days, but
  team slugs are immutable, so it never fires for teams. If team renames are ever allowed, the
  console must 308 an `old_handle` to the new one inside that window; until then nothing to build.
- A missing / forbidden team currently 303s to `/teams` (`index.tsx:30`). Keep it (does not
  disclose existence) but carry `?notice=unavailable` so the roster can say why. ✅ Fixed by B6
  (the redirect) and R1 (#260, the roster's one dismissible `InlineNotice`).

### 4.2 Single namespace & console vs public profile

- **Collision prevention is sound:** `fn_handle_refusal` → `fn_handle_taken` checks
  `users_public.username`, `teams.slug`, `business_profiles.slug`, `enterprises.handle`
  (case-insensitive) plus 90-day `handle_changes`; `fn_is_reserved_handle` blocks every top-level
  route segment (`teams`, `team`, `create`, …); `create_workspace` takes
  `pg_advisory_xact_lock(hashtext('handle:'||handle))` so two concurrent creates cannot both pass.
  The reserved list is pinned to TS `RESERVED_HANDLES` by `workspace.contract.test.ts`.
  **Rule to add:** any new top-level route segment must be appended to both lists in the same change
  (PR checklist line). ✅ Fixed by P1 (#257): the line is in `pr-checklist.md`, and
  `workspace.contract.test.ts` fails on any top-level route segment missing from the list.
- **Two surfaces, one entity** (`ROUTING.md:209-211`):

  | | `/teams/:teamHandle` (console) | `/:handle` (public storefront) | Status |
  | :-- | :-- | :-- | :-- |
  | Audience | active members only (`get_workspace_detail` → `forbidden` otherwise) | anyone; drafts / `invite_only` not listed | Holds; P1 (#257) makes a draft, archived or invite-only team a 404 to outsiders |
  | Shell | `(dashboard)` UserShell: lane + header band + footer rig, modules gated by capability | `[handle]` profile layout, conversion lane (§3.10) | Holds; the chrome is L1 (#255) and L2 (#258) |
  | Data | roles, stakes, invites, wallet, settings | public roster (Work), services, reviews, Standing | Holds; P1 (#257) limits the roster to public facts |
  | Edit | per-module capability | profile edit needs `edit_profile` (owner + admin) | Holds; ruled by #250 (b) |
  | Money controls | configuration only (tier 3) | the lane's Hire / Add to project (tier 1 / 2) | Holds; P1 (#257) gives an editor Manage team in Hire's place |

  **Conflict:** `PRODUCT_SPEC.md:591` says owner **or lead** manages the profile; the lead preset
  lacks `edit_profile`. *Proposal:* follow the DB (owner + admin); a team that wants leads to edit
  grants `edit_profile` through a custom role. (#226 (b), needs ruling.) ✅ Ruled by #250 (b)
  (follow the DB); PRODUCT_SPEC corrected by P1 (#257).

### 4.3 Ownership vs administrative transfer — RESOLVED by existing contract

- One active owner is enforced twice: `uq_team_members_one_owner` (partial unique index) and
  `fn_member_role_sync` (owner role ⇔ `owner_user_id`).
- The owner cannot leave or be removed (`update_workspace_member`, F1020:1666-1668; trigger
  backstop). The only door is `org.transfer_workspace_ownership(kind, entity, successor, leave)`:
  owner-only, successor an active member, moves `owner_user_id` first, demotes the old owner to
  Admin (or Admin + `left` with `leave = true`, stake rebalanced), re-syncs the vault.
- **Gaps to close:**
  1. Transfer does **not** call `fn_assert_payout_ready('freelancer', successor)`. The vault's
     `withdraw` and the team's verification follow the owner (`Functions.md:792-794`), so an
     unready successor would leave the team unable to withdraw. *Add the assert.* ✅ Fixed by B3:
     a team transfer runs `org.fn_assert_team_persona` then `fn_assert_payout_ready` on the
     successor (`supabase/probes/ownership_transfer_gate.sql`).
  2. Successor must be an adult freelancer — implied by membership (adult trigger, payout-ready at
     join), but grandfathered members (#196 (3)) may not be. Covered by (1).
  3. UI: "Leave team" for the owner must route to the transfer dialog, never render a dead
     control (§3.11). Verify `MemberDrawer.island.tsx:380` `lastowner-link` does exactly that.
     ✅ C2: the owner's own row offers "Transfer ownership" (a tier-5 `Button variant="link"` in the
     drawer, "Transfer ownership…" in the row menu) and no row ever offers the owner Leave or Remove
     (`memberAbilities`, `core/members-model.ts`, unit-tested).

### 4.4 Vault governance & split reconciliation

- **Two layers, one direction:** workspace capabilities (role ∪ grants − revokes) are the SSOT;
  `finance.vault_permissions` is a derived projection. Nobody writes the projection except
  `fn_sync_vault_permissions`. Mapping (`fn_vault_capabilities_for`): member→`view`,
  `contribute_funds`→`add_funds` (never for teams), `spend_funds`→`spend`,
  `manage_finances`→`distribute`, `withdraw_funds`→`withdraw` (owner only by preset),
  `approve_spend`→`approve_spend` (business only), owner→`manage_members`+`manage_billing`.
- **Backstop (implement):** `AFTER INSERT OR UPDATE OF role_id, status, granted, revoked ON
  org.team_members` and `AFTER UPDATE OF capabilities ON org.team_roles` triggers calling
  `fn_sync_vault_permissions` — a category-1 triggers file edit in place
  (`00001895_triggers_derived_columns.sql`), idempotent with the explicit calls. ✅ Fixed by B3
  (business tables too; `supabase/probes/vault_sync_backstop.sql`).
- **Split templates (implement — F11):** add `finance.save_split_rule(p_team_id, p_rule_type,
  p_vault_bp, p_finder_user_id, p_finder_bp)` (definer, needs `manage_finances`; archives the
  previous active row — `active = false` — never deletes; `finders_fee` requires an active-member
  finder and `finder_bp + vault_bp ≤ 10000`; Pro-gate "advanced" templates once #226 (d) rules
  which are advanced). Route: extend `POST /api/workspace/payout` with a `rule` block; Zod in
  `packages/types/workspace`; doc rows in `database/finance/Functions.md`. ✅ Fixed by B4 (#234 —
  one plan flag per template) and C4 (#262 — the Payouts UI).
- **Determinism (confirmed):** `fn_team_split_plan` is pure integer arithmetic in minor units,
  floors at every cut in a fixed order (5% platform fee → finder → vault_bp → member stakes by
  `percent_bp`), and sends all dust to the vault: `vault_total = vault_bp_cut + (pool − Σ member
  cuts)`. Same inputs → same ledger, and Σ outputs = payout exactly. `benevolent_dictator` →
  100% vault, distributed manually via `distribute`. This already satisfies "remainder cents to the
  Team Vault"; no change. Add a property test: for random stakes summing to 10000 and random
  payouts, Σ credits = payout and every member cut = ⌊pool·bp/10000⌋. ✅ Fixed by B5
  (`supabase/probes/team_split_properties.sql`, 600 cases).
- **Rebalance remainder** on departure goes to the largest absorber (stakes, not money: there is no
  vault *stake*). Keep; document the distinction in `finance-model.md`. ✅ Fixed by B5.

---

## 5. Prioritised backlog

| Pri | Item | Area | Status |
| :-- | :-- | :-- | :-- |
| P0 | A4 team status check on both apply paths; A3 ≥2 on `apply_to_seat` | DB | Fixed by B2 (#228 (E)) |
| P0 | P2/P3 persona gate on create menu + `/teams` routes | app | Fixed by B1 (#228 (A)) |
| P0 | F11 `save_split_rule` + template UI wiring | DB + API + UI | Fixed by B4 (#234) + C4 (#262) |
| P0 | §4.3 payout-ready assert on ownership transfer | DB | Fixed by B3 |
| P0 | D1, D4-D6, D9, D11-D12, D17-D20, D25, D34-D35, D38 | UI gates | Fixed by W1 (#251) + U3/U4, R1–R3, L1–L2, C1–C6 (#253–#264) + BU2 (#246, D19); D1's ui lane controls' own press is Open (packages/ui, #255 — see §2) |
| P1 | B8 vault-sync backstop triggers | DB | Fixed by B3 |
| P1 | §4.1 308 canonicalisation split | app | Fixed by B6 (#228 (B)) |
| P1 | D22-D30 button matrix; TabMenu / ActionMenu / LaneCreateButton parity | UI | Fixed by R1, R2, R3, L1, L2, C3 + BU2 (D30) |
| P1 | `MetaLine`, tier-2 `LaneCreateButton` in `packages/ui` (+ `DESIGN_SYSTEM.md` §C.1 roster) | ui | Fixed by U1 + U2 |
| P2 | S3 escrow guard widening (#197 b); W3 dead team W_i column; D14-D16, D39-D41 tidy | DB / UI | Fixed by B5 + C6 (S3), B7 + #235 (W3), W1 (+ R1, C1, C2, C4, BU2 for D39; L2 for D40, D41); D15's unit convention (#251 (a), a human) and D41's kept `.wsp-footerrig__action` rule (a workspaces CSS tidy, #258 (g)) Open (see §2) |
| P2 | Spec corrections once #226 is ruled (`PRODUCT_SPEC.md:189-198, 591, 2975-2981`; PM restore rule) | docs | Fixed by T0 (#228), P1 (#257), C6 (#261) and Z1 |

---

## 6. Verification (2026-10-19)

> Teams Z2 ([`TEAMS_BUILD_PROMPTS.md`](TEAMS_BUILD_PROMPTS.md) §11 Z2), measured on main at
> `dee9a336` (the Z1 merge); this section is its step 4. The evidence — logs, raw gate JSON and the
> screenshots — stays in the session scratch directory
> `%TEMP%/claude/C--Users-Ahmed-Documents-0-Websites-Projective/636c9d6d-6a42-48ab-b2f4-48da39af3170/scratchpad/Z2/`
> (cited below as `Z2/`: `step1/` logs and probe output, `matrix/` the persona pass and its
> `shots/`, `A-out/` and `gatesB/out/` the gate results, `shots/A-<page>__<variant>.png` and
> `shots/B__<page>__<variant>.png` the gate captures). Nothing there is committed.
>
> **How it ran.** Step 1: `deno task check`, `lint` and `test:unit`, and every probe under
> `supabase/probes/` that B1–B7, P1 and C2–C6 added or changed, each on the live DB inside
> `BEGIN … ROLLBACK`. The live DB lags main by C2's and C3's edits to `00001020`, so those three
> probes were also proved with main's file spliced into the probe's own transaction (T19–T21); no
> `db:reset` ran. Step 2: system Chrome headless (Playwright) with the seeded personas signed in
> through `/api/auth/login`, every route asserted by status and `Location` with redirects not
> followed, then opened for its visible controls; the personas the seed lacks (a minor, an
> operator-mode freelancer) are the Dev Context Switcher's simulations. Step 3: every page at
> 1440 / 900 / 390 × light · dark · high contrast, plus 1440 HC-dark, reduced motion and a
> touch-emulated 390 — 14 variants in part A, 15 in part B (which adds the OS reduce channel) — with
> `:active` forced through CDP and axe-core 4.10.3.
>
> **Result.** 269 rows (T1–T21 · M1–M140 · A1–A45 · B1–B63): 213 green, 51 red, 5 n/a. Of the red rows,
> 4 are fixed by this pass, 7 partly (the cause left has an owner) and 40 are
> open; every open cause is a lettered item of **Decision #265**, with its file:line and owner. The
> fixes, each one focused change of ≤ 10 lines (`fix(teams): … (Z2)` on `feat/teams-z2-verification`):
>
> 1. **Member drawer width.** `.wsp-mdrawer`'s column moves onto `.ui-drawer.wsp-mdrawer
>    .ui-drawer__body`, so the panel keeps `--drawer-size` (M140; closes #263 (g)).
> 2. **Lane splitter handle.** `MiddleNavSplitter`'s `role="separator"` carries `aria-valuenow` over
>    an `aria-valuemin`/`aria-valuemax` clamp and resizes on Arrow/Home/End — the axe critical on
>    every laned page at 1440 and 900.
> 3. **DataTable live region.** The `role="status"` announcer is the grid's sibling, not its child —
>    the axe critical on every `DataTable`.
> 4. **Settings links.** A link inside a sentence is underlined — axe link-in-text-block.
> 5. **Overlay titles.** `.ui-dialog__title` and `.ui-drawer__title` take §A.4's title register,
>    `--fw-medium` — /teams/create's heading row.
>
> They were re-checked with `deno task check` (exit 0), `deno task lint` (3438 files, 0 problems),
> `deno task test:unit` (5632 passed; the 4 failures are #96(a)'s) and the W1 gate
> (`styles.gate.test.ts` + `business-hue.gate.test.ts`, 29 passed). The browser columns still say
> what step 3 measured on `dee9a336`; a re-run after landing should turn the fixed causes green.
>
> **Reading the tables.** "Fixed in this pass?" is _Yes_ when every cause of a red row is fixed,
> _Partly_ when one is left (named with its #265 item) and _No — #265 (x)_ when none is. T, M and
> A1–A21 are the orchestrator's rows; A22–A45 and the B rows are summarised from the same raw
> results (`Z2/visA/summ.ts`, `Z2/gatesB/sum.ts`). "#96(a)" is the known dark brand pair
> (`packages/ui/system/core/theme-engine.test.ts` :149, :210, :353). Every heading weight is read
> against §A.4 as TEAMS_AUDIT §0 applies it: a title at `--fw-medium`, an uppercase section label at
> `--fw-semibold`; every digit against §A.4's "a changing figure".

### 6.1 Test gate and probes (Z2 step 1)

21 rows: 21 green, 0 red, 0 n/a.

| # | Check | Scope | Result | Evidence | file:line (reds) | Fixed in this pass? |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| T1 | deno task check (deno check types/ui/backend entry + apps/web/main.ts + every apps/web/routes/\*\*/\*.ts(x)) | Z2 step 1 — test gate, worktree detached at dee9a336 | green | exit 0 in 59.5 s; 401 Check entry points type-checked, 0 diagnostics. Log: Z2/step1/check.log | — | — |
| T2 | deno task lint | Z2 step 1 — test gate, dee9a336 | green | 'Checked 3438 files', exit 0, 0 problems. Log: Z2/step1/lint.log | — | — |
| T3 | deno task test:unit (packages/ apps/web/features/ apps/web/utils/) | Z2 step 1 — test gate, dee9a336 | green | 5632 passed, 4 failed (3m13s). All 4 failures are the known Decision #96(a) cases in packages/ui/system/core/theme-engine.test.ts: :149 'every filled pair clears 4.5:1 — dark', :149 '— dark + high contrast', :210 'brand pair is byte-identical', :353 'brand fill has no headroom … in dark'. No other failures. workspaces/styles/styles.gate.test.ts ran 20 tests and business-hue.gate.test.ts ran 9, all ok. Log: Z2/step1/unit.log | — | — |
| T4 | probe teams_persona_gate.sql (B1) | B1 probe, added in 4db182c8; live DB, BEGIN…ROLLBACK | green | exit 0; 18 PASS, 0 FAIL (last: 'invite_workspace_member: an email invitation is checked at accept, not here') | — | — |
| T5 | probe team_apply_gates.sql (B2) | B2 probe, added in 4db182c8; live DB, BEGIN…ROLLBACK | green | exit 0; 16 PASS, 'team_apply_gates: all cases PASS' | — | — |
| T6 | probe vault_sync_backstop.sql (B3) | B3 probe, added in 4db182c8; live DB, BEGIN…ROLLBACK | green | exit 0; 11 PASS, 0 FAIL (last: '3 business: a departed member's row is kept and projects to {}') | — | — |
| T7 | probe ownership_transfer_gate.sql (B3) | B3 probe, added in 4db182c8; live DB, BEGIN…ROLLBACK | green | exit 0; 5 PASS, 0 FAIL (last: 'business: an unready successor still takes a business (no team gate)') | — | — |
| T8 | probe save_split_rule.sql (B4) | B4 probe, added in f94f565b; live DB, BEGIN…ROLLBACK | green | exit 0; 23 PASS, 0 FAIL (last: '7 finance.split_rules is read-only to clients') | — | — |
| T9 | probe team_split_properties.sql (B5) | B5 probe, added in 7d596592; live DB, BEGIN…ROLLBACK | green | exit 0; 600 cases (seed 0.2026, fee 500 bp; 150 each none/co_op/finders_fee/benevolent_dictator) + 60 preview/release cross-checks, 'zero violations — all cases PASS' | — | — |
| T10 | probe team_archive_escrow_guard.sql (B5) | B5 probe, added in 7d596592; live DB, BEGIN…ROLLBACK | green | exit 0; 9 PASS, 'team_archive_escrow_guard: all cases PASS' | — | — |
| T11 | probe workspace_detail_payload.sql (B7) | B7 probe, added in 1d21b8d5; live DB, BEGIN…ROLLBACK | green | exit 0; 16 PASS, 'workspace_detail_payload: all cases passed' | — | — |
| T12 | probe team_profile_visibility.sql (P1) | P1 probe, added in merge 3305abf6; live DB, BEGIN…ROLLBACK | green | exit 0; 107 'ok' checks, 0 not-ok, 'team_profile_visibility: all checks passed'. Covers draft/public/unlisted/invite_only × noor/guest/tomaszwojcik/kwamemensah | — | — |
| T13 | probe business_public_profile.sql (changed by P1) | Changed in merge 3305abf6 (P1); /businesses regression; live DB, BEGIN…ROLLBACK | green | exit 0; 100 'ok' checks, 0 not-ok, 'business_public_profile: all checks passed' | — | — |
| T14 | probe team_proposals_filter.sql (C5) | C5 probe, added in merge f82f76ae; live DB, BEGIN…ROLLBACK | green | exit 0; 8 PASS, 0 FAIL (last: 'the filer may withdraw their own team proposal') | — | — |
| T15 | probe team_archive_blockers.sql (C6) | C6 probe, added in merge 1ede400a; live DB, BEGIN…ROLLBACK | green | exit 0; 16 PASS, 'team_archive_blockers: all cases PASS' | — | — |
| T16 | probe team_restore_target.sql (C6 restore probe, Decision #250 restore rule) | C6 probe, added in merge 1ede400a; live DB, BEGIN…ROLLBACK | green | exit 0; 26 PASS, 'team_restore_target: all cases PASS' | — | — |
| T17 | probe payout_preview_amount.sql (C4) | C4 probe, added in merge d68f6747; live DB, BEGIN…ROLLBACK | green | exit 0; 19 PASS, 0 FAIL (last: '5f a member without manage_finances reads the detail without a payout block') | — | — |
| T18 | probe platform_fee_single_source.sql (changed by C4) | Changed in merge d68f6747 (C4); live DB, BEGIN…ROLLBACK | green | exit 0; 8 PASS, 0 FAIL (e.g. 'preview_team_split fee 96000 = 3200000 at the payer's 300 bp', 'reports fee_bp 300') | — | — |
| T19 | probe workspace_member_stakes.sql (C2) | C2 probe, added in merge e85aab05. Live DB lags main: it is missing C2's edit to supabase/migrations/00001020_functions_org_entities.sql. Proved by splicing main's 00001020 into the probe's own transaction (rolled back). | green | Plain live run: exit 3, 1 FAIL ('anyone else reads no stake … — 3 of 3 members carry a stake'). Cause: the live org.get_workspace_detail still emits ungated share_bp/share_held (prosrc has no "'share_bp', CASE WHEN"). With main's 00001020 spliced in, BEGIN…ROLLBACK: exit 0, 4/4 PASS, 'workspace_member_stakes: all cases passed'. Main is correct; a db:reset brings the live DB up to date. | supabase/migrations/00001020_functions_org_entities.sql:2984 (C2 hunk not applied on the live DB) | — |
| T20 | probe workspace_seats.sql (C2) | C2 probe, added in merge e85aab05. Live DB lags main: it is missing C2's edit to supabase/migrations/00001020_functions_org_entities.sql (org.fn_team_seats_used plus the get_workspace_detail `seats` key). Proved by splice, rolled back. | green | Plain live run: exit 3, 'ERROR: function org.fn_team_seats_used(uuid) does not exist' (to_regprocedure gives null on the live DB), and 5 FAIL notices because `seats` is absent. With main's 00001020 spliced in, BEGIN…ROLLBACK: exit 0, 9/9 PASS ('a team answers seats {used, limit}' … 'the seat cap refuses one past limit - used'). After the run, fn_team_seats_used is still absent on the live DB, so nothing persisted. | supabase/migrations/00001020_functions_org_entities.sql:1630 and :3038 (C2 hunks not applied on the live DB) | — |
| T21 | probe workspace_role_pending_invites.sql (C3) | C3 probe, added in merge ab1fdfbc. Live DB lags main: it is missing C3's `pending_invites` edit to supabase/migrations/00001020_functions_org_entities.sql. Proved by splice, rolled back. | green | Plain live run: exit 3, 5 FAIL / 5 PASS. The roles JSON has no pending_invites key (live prosrc has no 'pending_invites'). With main's 00001020 spliced in, BEGIN…ROLLBACK: exit 0, 10/10 PASS, 'workspace_role_pending_invites: all cases pass'. | supabase/migrations/00001020_functions_org_entities.sql:3011 (C3 hunk not applied on the live DB) | — |

### 6.2 Persona × route matrix (Z2 step 2)

140 rows: 136 green, 1 red, 3 n/a.

| # | Check | Scope | Result | Evidence | file:line (reds) | Fixed in this pass? |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| M1 | /teams -> 200 | owner kwamemensah x GET /teams | green | 200; lane+rig 'New team' (tier-4 outlined), 1 card -> /teams/northloop; shell Teams link + Create Team shown | — | — |
| M2 | /teams/create -> 200 | owner kwamemensah x GET /teams/create | green | 200; CreateWorkspaceModal open: name+handle, Cancel (tier-5), 'Create team' tier-2 structural filled, disabled until valid | — | — |
| M3 | overview -> 200 + only usable controls | owner kwamemensah x GET /teams/northloop | green | 200; lane Invite member, rig Invite members + Settings links, header Share profile + kebab (View public profile, Open in new tab, Copy handle, Hand over ownership...); Archive... withheld (2 held escrows + 1 live stage); Vault metric shown; 0 header fills | — | — |
| M4 | members -> 200 + only usable controls | owner kwamemensah x GET /teams/northloop/members | green | 200; Invite member (lane, in place) + rig Invite members + Settings; tabs People/Invitations/Org chart; STAKE column; rows: self -> Transfer ownership..., Samuel/Tomasz -> Message+Remove, drawers editable (Role/Title/Reports to, 14 switches, Remove, Save changes disabled until dirty) | — | — |
| M5 | projects -> 200 + only usable controls | owner kwamemensah x GET /teams/northloop/projects | green | 200; tabs Active/Proposals; Invite member; allowance 'PROPOSALS THIS WEEK 0 / 50'; 1 engagement; 0 pending proposals so no Withdraw | — | — |
| M6 | payouts -> 200 + only usable controls | owner kwamemensah x GET /teams/northloop/payouts | green | 200; SelectButton Co-op (Finder's fee/Benevolent dictator disabled + 'See plans', plan-gated #234), SplitBar 2 handles, 3 hold toggles, Split evenly; Save only when dirty | — | — |
| M7 | roles -> 200 + only usable controls | owner kwamemensah x GET /teams/northloop/roles | green | 200; header 'New role' tier-2 filled (the one fill); 56 preset matrix cells disabled (presets locked) | — | — |
| M8 | settings -> 200 + only usable controls | owner kwamemensah x GET /teams/northloop/settings | green | 200; Name, 'Edit the profile' (edit_profile), Visibility SelectButton; archive blockers listed (2 held escrows, 1 live stage) and no Archive control; rig Invite members, no self Settings link | — | — |
| M9 | forbidden:spend(business-only) -> 303, ?view= dropped, rest of query kept | owner kwamemensah x GET /teams/northloop/spend?view=x&z2=1 | green | 303 -> /teams/northloop?z2=1 (owner/admin hold every team module; /spend is business-only, so it is the module they may not open) | — | — |
| M10 | uuid -> 308 canonical, query kept | owner kwamemensah x GET /teams/edc2d943-8062-426a-a6f2-29fdc6b4363c?view=x&z2=1 | green | 308 -> /teams/northloop?view=x&z2=1 | — | — |
| M11 | wrong-case -> 308 canonical, query kept | owner kwamemensah x GET /teams/NorthLoop?z2=1 | green | 308 -> /teams/northloop?z2=1 | — | — |
| M12 | storefront -> 200 public storefront | owner kwamemensah x GET /northloop | green | 200; 'Manage team' (outlined) in Hire's place (P1 #257) + 'Add to project' mono filled; Edit profile & settings links | — | — |
| M13 | /teams -> 200 | admin lenamueller x GET /teams | green | 200; lane+rig 'New team'; 1 card -> /teams/ateliernova | — | — |
| M14 | /teams/create -> 200 | admin lenamueller x GET /teams/create | green | 200; modal open; 'Create team' tier-2 disabled until valid | — | — |
| M15 | overview -> 303 /teams?notice=unavailable | admin lenamueller x GET /teams/northloop | green | 303 -> /teams?notice=unavailable; roster renders the one InlineNotice 'That team isn't available to you' + Dismiss, URL stripped to /teams | — | — |
| M16 | members -> 303 /teams?notice=unavailable | admin lenamueller x GET /teams/northloop/members | green | 303 -> /teams?notice=unavailable | — | — |
| M17 | projects -> 303 /teams?notice=unavailable | admin lenamueller x GET /teams/northloop/projects | green | 303 -> /teams?notice=unavailable | — | — |
| M18 | payouts -> 303 /teams?notice=unavailable | admin lenamueller x GET /teams/northloop/payouts | green | 303 -> /teams?notice=unavailable | — | — |
| M19 | roles -> 303 /teams?notice=unavailable | admin lenamueller x GET /teams/northloop/roles | green | 303 -> /teams?notice=unavailable | — | — |
| M20 | settings -> 303 /teams?notice=unavailable | admin lenamueller x GET /teams/northloop/settings | green | 303 -> /teams?notice=unavailable | — | — |
| M21 | forbidden:finance -> 303 /teams?notice=unavailable | admin lenamueller x GET /teams/northloop/finance?view=ledger&z2=1 | green | 303 -> /teams?notice=unavailable | — | — |
| M22 | uuid -> 303 /teams?notice=unavailable | admin lenamueller x GET /teams/edc2d943-8062-426a-a6f2-29fdc6b4363c?view=x&z2=1 | green | 303 -> /teams?notice=unavailable; non-member gets no 308, nothing disclosed | — | — |
| M23 | wrong-case -> 303 /teams?notice=unavailable | admin lenamueller x GET /teams/NorthLoop?z2=1 | green | 303 -> /teams?notice=unavailable; non-member gets no 308, nothing disclosed | — | — |
| M24 | storefront -> 200 public storefront | admin lenamueller x GET /northloop | green | 200; as an outsider: Hire + Add to project, no Manage team | — | — |
| M25 | overview -> 200 + only usable controls | admin lenamueller x GET /teams/ateliernova | green | 200; lane Invite member, rig Invite members + Settings; kebab View public profile/Open in new tab/Copy handle/Leave team... (no Archive..., no Hand over) | — | — |
| M26 | members -> 200 + only usable controls | admin lenamueller x GET /teams/ateliernova/members | green | 200; Invite in place; STAKE column; rows: Ines (owner) -> Message/View profile, no edit or Remove, drawer read-only; self -> Leave; Aiko (member) -> Message+Remove, drawer editable with 12 switches (withdraw_funds/archive_entity not offered) | — | — |
| M27 | projects -> 200 + only usable controls | admin lenamueller x GET /teams/ateliernova/projects | green | 200; tabs Active/Proposals; Invite member; rig Settings link | — | — |
| M28 | payouts -> 200 + only usable controls | admin lenamueller x GET /teams/ateliernova/payouts | green | 200; 3 templates enabled (team plan), SplitBar, Split evenly; no withdraw control (admin lacks withdraw_funds) | — | — |
| M29 | roles -> 200 + only usable controls | admin lenamueller x GET /teams/ateliernova/roles | green | 200; 'New role' tier-2 filled (manage_roles); preset cells disabled | — | — |
| M30 | settings -> 200 + only usable controls | admin lenamueller x GET /teams/ateliernova/settings | green | 200; Name, 'Edit the profile', Visibility; NO Archive (admin lacks archive_entity) | — | — |
| M31 | forbidden:spend(business-only) -> 303, ?view= dropped, rest of query kept | admin lenamueller x GET /teams/ateliernova/spend?view=x&z2=1 | green | 303 -> /teams/ateliernova?z2=1 (owner/admin hold every team module; /spend is business-only, so it is the module they may not open) | — | — |
| M32 | uuid -> 308 canonical, query kept | admin lenamueller x GET /teams/213dc9f8-3ad7-4f35-ac4b-baa674bf48b3?view=x&z2=1 | green | 308 -> /teams/ateliernova?view=x&z2=1 | — | — |
| M33 | wrong-case -> 308 canonical, query kept | admin lenamueller x GET /teams/AtelierNova?z2=1 | green | 308 -> /teams/ateliernova?z2=1 | — | — |
| M34 | storefront -> 200 public storefront | admin lenamueller x GET /ateliernova | green | 200; Manage team + Edit profile & settings (edit_profile holder) | — | — |
| M35 | /teams -> 200 | lead samuelnkemelu x GET /teams | green | 200; lane+rig 'New team'; 1 card (Lead) -> /teams/northloop | — | — |
| M36 | /teams/create -> 200 | lead samuelnkemelu x GET /teams/create | green | 200; modal open; 'Create team' tier-2 disabled until valid | — | — |
| M37 | overview -> 200 + only usable controls | lead samuelnkemelu x GET /teams/northloop | green | 200; lane Invite member + rig Invite members (invite_members); no Settings link; kebab ... Leave team...; no Vault metric; lane: Overview/Members/Projects/Catalogue/Calendar/Messages/Invitations/Analytics/Standing (no Payouts/Roles/Settings/Finance/Profile/Verification) | — | — |
| M38 | members -> 200 + only usable controls | lead samuelnkemelu x GET /teams/northloop/members | green | 200; Invite in place; tabs People/Invitations/Org chart; no STAKE; rows Kwame/Tomasz -> Message+View profile only (no edit/Remove: lacks manage_roles); self -> Leave; drawers read-only (Close only) | — | — |
| M39 | projects -> 200 + only usable controls | lead samuelnkemelu x GET /teams/northloop/projects | green | 200; tabs Active/Proposals; Invite member; no 'Ask a lead' line (holds bind_seat); 0 pending so no Withdraw | — | — |
| M40 | payouts -> 303 withheld -> console root, no ?view | lead samuelnkemelu x GET /teams/northloop/payouts | green | 303 -> /teams/northloop; lacks manage_finances; module absent from the lane (not shown locked) | — | — |
| M41 | roles -> 303 withheld -> console root, no ?view | lead samuelnkemelu x GET /teams/northloop/roles | green | 303 -> /teams/northloop; lacks manage_roles; module absent from the lane (not shown locked) | — | — |
| M42 | settings -> 303 withheld -> console root, no ?view | lead samuelnkemelu x GET /teams/northloop/settings | green | 303 -> /teams/northloop; lacks manage_settings; module absent from the lane (not shown locked) | — | — |
| M43 | forbidden:finance -> 303, ?view= dropped, rest of query kept | lead samuelnkemelu x GET /teams/northloop/finance?view=ledger&z2=1 | green | 303 -> /teams/northloop?z2=1 (finance needs manage_finances on a team) | — | — |
| M44 | uuid -> 308 canonical, query kept | lead samuelnkemelu x GET /teams/edc2d943-8062-426a-a6f2-29fdc6b4363c?view=x&z2=1 | green | 308 -> /teams/northloop?view=x&z2=1 | — | — |
| M45 | wrong-case -> 308 canonical, query kept | lead samuelnkemelu x GET /teams/NorthLoop?z2=1 | green | 308 -> /teams/northloop?z2=1 | — | — |
| M46 | uuid+withheld -> ONE 308 to the module the viewer may open (ROUTING.md:119) | lead samuelnkemelu x GET /teams/edc2d943-8062-426a-a6f2-29fdc6b4363c/settings?view=x&z2=1 | green | 308 -> /teams/northloop?z2=1; ?view= dropped, z2 kept, no 308->303 chain (see notes: viewer-dependent target in a cacheable 308) | — | — |
| M47 | storefront -> 200 public storefront | lead samuelnkemelu x GET /northloop | green | 200; Hire (teal filled) + Add to project (mono filled) offered to a member of the team (see notes) | — | — |
| M48 | /teams -> 200 | member tomaszwojcik x GET /teams | green | 200; lane+rig 'New team'; 1 card (Member) -> /teams/northloop | — | — |
| M49 | /teams/create -> 200 | member tomaszwojcik x GET /teams/create | green | 200; modal open; 'Create team' tier-2 disabled until valid | — | — |
| M50 | overview -> 200 + only usable controls | member tomaszwojcik x GET /teams/northloop | green | 200; no Invite anywhere, no Settings link, no Vault metric; kebab ... Leave team...; lane: Overview/Members/Projects/Calendar/Messages/Analytics/Standing | — | — |
| M51 | members -> 200 + only usable controls | member tomaszwojcik x GET /teams/northloop/members | green | 200; tabs People/Org chart only (?view=pending coerced to People); no Invite; no STAKE; rows Message+View profile; self -> Leave; drawers read-only | — | — |
| M52 | projects -> 200 + only usable controls | member tomaszwojcik x GET /teams/northloop/projects | green | 200; 'Ask a lead to apply for the team'; no apply/withdraw controls; tabs Active/Proposals | — | — |
| M53 | payouts -> 303 withheld -> console root, no ?view | member tomaszwojcik x GET /teams/northloop/payouts | green | 303 -> /teams/northloop; lacks manage_finances; module absent from the lane (not shown locked) | — | — |
| M54 | roles -> 303 withheld -> console root, no ?view | member tomaszwojcik x GET /teams/northloop/roles | green | 303 -> /teams/northloop; lacks manage_roles; module absent from the lane (not shown locked) | — | — |
| M55 | settings -> 303 withheld -> console root, no ?view | member tomaszwojcik x GET /teams/northloop/settings | green | 303 -> /teams/northloop; lacks manage_settings; module absent from the lane (not shown locked) | — | — |
| M56 | forbidden:finance -> 303, ?view= dropped, rest of query kept | member tomaszwojcik x GET /teams/northloop/finance?view=ledger&z2=1 | green | 303 -> /teams/northloop?z2=1 (finance needs manage_finances on a team) | — | — |
| M57 | uuid -> 308 canonical, query kept | member tomaszwojcik x GET /teams/edc2d943-8062-426a-a6f2-29fdc6b4363c?view=x&z2=1 | green | 308 -> /teams/northloop?view=x&z2=1 | — | — |
| M58 | wrong-case -> 308 canonical, query kept | member tomaszwojcik x GET /teams/NorthLoop?z2=1 | green | 308 -> /teams/northloop?z2=1 | — | — |
| M59 | uuid+withheld -> ONE 308 to the module the viewer may open (ROUTING.md:119) | member tomaszwojcik x GET /teams/edc2d943-8062-426a-a6f2-29fdc6b4363c/settings?view=x&z2=1 | green | 308 -> /teams/northloop?z2=1; ?view= dropped, z2 kept, no 308->303 chain (see notes: viewer-dependent target in a cacheable 308) | — | — |
| M60 | storefront -> 200 public storefront | member tomaszwojcik x GET /northloop | green | 200; Hire + Add to project offered to a member of the team (see notes) | — | — |
| M61 | /teams -> 303 /home?notice=teams-freelancer | client noor x GET /teams | green | 303 -> /home?notice=teams-freelancer; landing /home toasts 'Teams are for freelancer accounts', URL stripped to /home; shell: no Teams link, Create menu without Create Team | — | — |
| M62 | /teams/create -> 303 /home?notice=teams-freelancer | client noor x GET /teams/create | green | 303 -> /home?notice=teams-freelancer | — | — |
| M63 | overview -> 303 /home?notice=teams-freelancer | client noor x GET /teams/northloop | green | 303 -> /home?notice=teams-freelancer | — | — |
| M64 | members -> 303 /home?notice=teams-freelancer | client noor x GET /teams/northloop/members | green | 303 -> /home?notice=teams-freelancer | — | — |
| M65 | projects -> 303 /home?notice=teams-freelancer | client noor x GET /teams/northloop/projects | green | 303 -> /home?notice=teams-freelancer | — | — |
| M66 | payouts -> 303 /home?notice=teams-freelancer | client noor x GET /teams/northloop/payouts | green | 303 -> /home?notice=teams-freelancer | — | — |
| M67 | roles -> 303 /home?notice=teams-freelancer | client noor x GET /teams/northloop/roles | green | 303 -> /home?notice=teams-freelancer | — | — |
| M68 | settings -> 303 /home?notice=teams-freelancer | client noor x GET /teams/northloop/settings | green | 303 -> /home?notice=teams-freelancer | — | — |
| M69 | uuid -> 303 /home?notice=teams-freelancer | client noor x GET /teams/edc2d943-8062-426a-a6f2-29fdc6b4363c?view=x&z2=1 | green | 303 -> /home?notice=teams-freelancer (persona gate runs before console routing: nothing disclosed) | — | — |
| M70 | wrong-case -> 303 /home?notice=teams-freelancer | client noor x GET /teams/NorthLoop?z2=1 | green | 303 -> /home?notice=teams-freelancer (persona gate runs before console routing: nothing disclosed) | — | — |
| M71 | storefront -> 200 public storefront | client noor x GET /northloop | green | 200; Hire + Add to project + Message + Follow | — | — |
| M72 | /teams -> 303 /home?notice=teams-freelancer | operator priyaraman x GET /teams | green | 303 -> /home?notice=teams-freelancer; landing /home toasts 'Teams are for freelancer accounts', URL stripped to /home; shell: no Teams link, Create menu without Create Team | — | — |
| M73 | /teams/create -> 303 /home?notice=teams-freelancer | operator priyaraman x GET /teams/create | green | 303 -> /home?notice=teams-freelancer | — | — |
| M74 | overview -> 303 /home?notice=teams-freelancer | operator priyaraman x GET /teams/northloop | green | 303 -> /home?notice=teams-freelancer | — | — |
| M75 | members -> 303 /home?notice=teams-freelancer | operator priyaraman x GET /teams/northloop/members | green | 303 -> /home?notice=teams-freelancer | — | — |
| M76 | projects -> 303 /home?notice=teams-freelancer | operator priyaraman x GET /teams/northloop/projects | green | 303 -> /home?notice=teams-freelancer | — | — |
| M77 | payouts -> 303 /home?notice=teams-freelancer | operator priyaraman x GET /teams/northloop/payouts | green | 303 -> /home?notice=teams-freelancer | — | — |
| M78 | roles -> 303 /home?notice=teams-freelancer | operator priyaraman x GET /teams/northloop/roles | green | 303 -> /home?notice=teams-freelancer | — | — |
| M79 | settings -> 303 /home?notice=teams-freelancer | operator priyaraman x GET /teams/northloop/settings | green | 303 -> /home?notice=teams-freelancer | — | — |
| M80 | uuid -> 303 /home?notice=teams-freelancer | operator priyaraman x GET /teams/edc2d943-8062-426a-a6f2-29fdc6b4363c?view=x&z2=1 | green | 303 -> /home?notice=teams-freelancer (persona gate runs before console routing: nothing disclosed) | — | — |
| M81 | wrong-case -> 303 /home?notice=teams-freelancer | operator priyaraman x GET /teams/NorthLoop?z2=1 | green | 303 -> /home?notice=teams-freelancer (persona gate runs before console routing: nothing disclosed) | — | — |
| M82 | storefront -> 200 public storefront | operator priyaraman x GET /northloop | green | 200; Hire + Add to project | — | — |
| M83 | /teams -> 303 /home?notice=teams-freelancer | operator-mode sim marisdelacroix x GET /teams | green | 303 -> /home?notice=teams-freelancer; landing /home toasts 'Teams are for freelancer accounts', URL stripped to /home; shell: no Teams link, Create menu without Create Team | — | — |
| M84 | /teams/create -> 303 /home?notice=teams-freelancer | operator-mode sim marisdelacroix x GET /teams/create | green | 303 -> /home?notice=teams-freelancer | — | — |
| M85 | overview -> 303 /home?notice=teams-freelancer | operator-mode sim marisdelacroix x GET /teams/northloop | green | 303 -> /home?notice=teams-freelancer | — | — |
| M86 | members -> 303 /home?notice=teams-freelancer | operator-mode sim marisdelacroix x GET /teams/northloop/members | green | 303 -> /home?notice=teams-freelancer | — | — |
| M87 | projects -> 303 /home?notice=teams-freelancer | operator-mode sim marisdelacroix x GET /teams/northloop/projects | green | 303 -> /home?notice=teams-freelancer | — | — |
| M88 | payouts -> 303 /home?notice=teams-freelancer | operator-mode sim marisdelacroix x GET /teams/northloop/payouts | green | 303 -> /home?notice=teams-freelancer | — | — |
| M89 | roles -> 303 /home?notice=teams-freelancer | operator-mode sim marisdelacroix x GET /teams/northloop/roles | green | 303 -> /home?notice=teams-freelancer | — | — |
| M90 | settings -> 303 /home?notice=teams-freelancer | operator-mode sim marisdelacroix x GET /teams/northloop/settings | green | 303 -> /home?notice=teams-freelancer | — | — |
| M91 | uuid -> 303 /home?notice=teams-freelancer | operator-mode sim marisdelacroix x GET /teams/edc2d943-8062-426a-a6f2-29fdc6b4363c?view=x&z2=1 | green | 303 -> /home?notice=teams-freelancer (persona gate runs before console routing: nothing disclosed) | — | — |
| M92 | wrong-case -> 303 /home?notice=teams-freelancer | operator-mode sim marisdelacroix x GET /teams/NorthLoop?z2=1 | green | 303 -> /home?notice=teams-freelancer (persona gate runs before console routing: nothing disclosed) | — | — |
| M93 | storefront -> 200 public storefront | operator-mode sim marisdelacroix x GET /northloop | green | 200; public | — | — |
| M94 | /teams -> 200 | unready chloewinters x GET /teams | green | 200; invitation strip (Studio Fern): Accept filled + Decline; DB refuses Accept with payout_not_ready + Set up payouts link (invitation-strip-model.ts:145) - not exercised (write) | — | — |
| M95 | /teams/create -> 200 | unready chloewinters x GET /teams/create | green | 200; modal open, Create team disabled until valid; payout refusal arrives at submit (R3 PayoutGateLink) - not exercised (write) | — | — |
| M96 | overview -> 303 /teams?notice=unavailable | unready chloewinters x GET /teams/northloop | green | 303 -> /teams?notice=unavailable; roster renders the one InlineNotice 'That team isn't available to you' + Dismiss, URL stripped to /teams | — | — |
| M97 | members -> 303 /teams?notice=unavailable | unready chloewinters x GET /teams/northloop/members | green | 303 -> /teams?notice=unavailable | — | — |
| M98 | projects -> 303 /teams?notice=unavailable | unready chloewinters x GET /teams/northloop/projects | green | 303 -> /teams?notice=unavailable | — | — |
| M99 | payouts -> 303 /teams?notice=unavailable | unready chloewinters x GET /teams/northloop/payouts | green | 303 -> /teams?notice=unavailable | — | — |
| M100 | roles -> 303 /teams?notice=unavailable | unready chloewinters x GET /teams/northloop/roles | green | 303 -> /teams?notice=unavailable | — | — |
| M101 | settings -> 303 /teams?notice=unavailable | unready chloewinters x GET /teams/northloop/settings | green | 303 -> /teams?notice=unavailable | — | — |
| M102 | uuid -> 303 /teams?notice=unavailable | unready chloewinters x GET /teams/edc2d943-8062-426a-a6f2-29fdc6b4363c?view=x&z2=1 | green | 303 -> /teams?notice=unavailable; non-member gets no 308, nothing disclosed | — | — |
| M103 | wrong-case -> 303 /teams?notice=unavailable | unready chloewinters x GET /teams/NorthLoop?z2=1 | green | 303 -> /teams?notice=unavailable; non-member gets no 308, nothing disclosed | — | — |
| M104 | storefront -> 200 public storefront | unready chloewinters x GET /northloop | green | 200; public | — | — |
| M105 | /teams -> 303 /home?notice=teams-freelancer | platform operator rosalindqvist x GET /teams | green | 303 -> /home?notice=teams-freelancer; landing /home toasts 'Teams are for freelancer accounts', URL stripped to /home; shell: no Teams link, Create menu without Create Team | — | — |
| M106 | /teams/create -> 303 /home?notice=teams-freelancer | platform operator rosalindqvist x GET /teams/create | green | 303 -> /home?notice=teams-freelancer | — | — |
| M107 | overview -> 303 /home?notice=teams-freelancer | platform operator rosalindqvist x GET /teams/northloop | green | 303 -> /home?notice=teams-freelancer | — | — |
| M108 | members -> 303 /home?notice=teams-freelancer | platform operator rosalindqvist x GET /teams/northloop/members | green | 303 -> /home?notice=teams-freelancer | — | — |
| M109 | projects -> 303 /home?notice=teams-freelancer | platform operator rosalindqvist x GET /teams/northloop/projects | green | 303 -> /home?notice=teams-freelancer | — | — |
| M110 | payouts -> 303 /home?notice=teams-freelancer | platform operator rosalindqvist x GET /teams/northloop/payouts | green | 303 -> /home?notice=teams-freelancer | — | — |
| M111 | roles -> 303 /home?notice=teams-freelancer | platform operator rosalindqvist x GET /teams/northloop/roles | green | 303 -> /home?notice=teams-freelancer | — | — |
| M112 | settings -> 303 /home?notice=teams-freelancer | platform operator rosalindqvist x GET /teams/northloop/settings | green | 303 -> /home?notice=teams-freelancer | — | — |
| M113 | uuid -> 303 /home?notice=teams-freelancer | platform operator rosalindqvist x GET /teams/edc2d943-8062-426a-a6f2-29fdc6b4363c?view=x&z2=1 | green | 303 -> /home?notice=teams-freelancer (persona gate runs before console routing: nothing disclosed) | — | — |
| M114 | wrong-case -> 303 /home?notice=teams-freelancer | platform operator rosalindqvist x GET /teams/NorthLoop?z2=1 | green | 303 -> /home?notice=teams-freelancer (persona gate runs before console routing: nothing disclosed) | — | — |
| M115 | storefront -> 200 public storefront | platform operator rosalindqvist x GET /northloop | green | 200; public | — | — |
| M116 | /teams -> 303 /home (restricted gate wins) | minor sim tomaszwojcik x GET /teams | green | 303 -> /home; restricted gate precedes the persona gate (B1: existing rule wins); with full DevOverrides (sessionStorage) the shell drops Teams + Create Team | — | — |
| M117 | /teams/create -> 303 /home (restricted gate wins) | minor sim tomaszwojcik x GET /teams/create | green | 303 -> /home | — | — |
| M118 | overview -> 303 /home (restricted gate wins) | minor sim tomaszwojcik x GET /teams/northloop | green | 303 -> /home | — | — |
| M119 | members -> 303 /home (restricted gate wins) | minor sim tomaszwojcik x GET /teams/northloop/members | green | 303 -> /home | — | — |
| M120 | projects -> 303 /home (restricted gate wins) | minor sim tomaszwojcik x GET /teams/northloop/projects | green | 303 -> /home | — | — |
| M121 | payouts -> 303 /home (restricted gate wins) | minor sim tomaszwojcik x GET /teams/northloop/payouts | green | 303 -> /home | — | — |
| M122 | roles -> 303 /home (restricted gate wins) | minor sim tomaszwojcik x GET /teams/northloop/roles | green | 303 -> /home | — | — |
| M123 | settings -> 303 /home (restricted gate wins) | minor sim tomaszwojcik x GET /teams/northloop/settings | green | 303 -> /home | — | — |
| M124 | uuid -> 303 /home (restricted gate wins) | minor sim tomaszwojcik x GET /teams/edc2d943-8062-426a-a6f2-29fdc6b4363c?view=x&z2=1 | green | 303 -> /home | — | — |
| M125 | wrong-case -> 303 /home (restricted gate wins) | minor sim tomaszwojcik x GET /teams/NorthLoop?z2=1 | green | 303 -> /home | — | — |
| M126 | storefront -> 200 public storefront | minor sim tomaszwojcik x GET /northloop | green | 200; public storefront | — | — |
| M127 | persona exists | minor (13-17) seeded persona x all routes | n/a | no seeded minor: youngest org.users_public dob = 23 y (Seed.md 18 personas); dev-sim rows above (pj.dev.age=minor) stand in | — | — |
| M128 | persona exists | operator-mode freelancer seeded persona x all routes | n/a | no account has is_freelancer AND is_operator (the 4 is_operator accounts priyaraman/danielokafor/hannahcole/miguelsantos are is_freelancer=false); covered by real operator priyaraman + Dev Context Switcher sim | — | — |
| M129 | persona exists | northloop admin x northloop console | n/a | northloop seats = owner kwamemensah, lead samuelnkemelu, member tomaszwojcik; admin checks ran on Atelier Nova (lenamueller, caps = all but withdraw_funds/archive_entity) | — | — |
| M130 | /overview spelled out -> 308 root, query kept | owner kwamemensah x GET /teams/northloop/overview?z2=1 | green | 308 -> /teams/northloop?z2=1 | — | — |
| M131 | unregistered module -> 303 canonical root | owner kwamemensah x GET /teams/northloop/nonsense?z2=1 | green | 303 -> /teams/northloop (ROUTING.md:119 'missing') | — | — |
| M132 | owner may open Finance | owner kwamemensah x GET /teams/northloop/finance?view=ledger&z2=1 | green | 200 (manage_finances); owner's withheld-module row uses /spend | — | — |
| M133 | missing team uuid -> 303 unavailable | owner kwamemensah x GET /teams/00000000-0000-0000-0000-000000000000?z2=1 | green | 303 -> /teams?notice=unavailable (exists vs forbidden indistinguishable) | — | — |
| M134 | another team's console -> 303 unavailable | owner kwamemensah x GET /teams/ateliernova | green | 303 -> /teams?notice=unavailable | — | — |
| M135 | withheld + wrong case -> ONE 308 | lead samuelnkemelu x GET /teams/NORTHLOOP/payouts?view=ledger&z2=1 | green | 308 -> /teams/northloop?z2=1 (view dropped, one hop) | — | — |
| M136 | sim control: the cookie alone flips the answer | marisdelacroix (no override cookie) x GET /teams, /teams/northloop | green | /teams 200; /teams/northloop 303 -> /teams?notice=unavailable (non-member), so the sim's 303 teams-freelancer comes from pj.dev.operator-mode=on | — | — |
| M137 | shell hides Teams + Create Team for refused personas (#228 (A), P1/P2) | client noor, operator priyaraman, platform operator rosalindqvist x /home shell | green | no a[href^=/teams]; Create menu noor: Project/Business/Article; priyaraman: Project/Article; rosalindqvist: Project/Business/Article. Freelancers (kwame, lena, samuel, tomasz, chloe) show Teams + Create Team | — | — |
| M138 | shell under the Dev Context Switcher sims | operator-mode sim + minor sim x /home shell | green | with pj.session.dev.contextOverrides {enabled, operatorMode:on} -> data-dev-operator=on, no Teams link, no Create Team; {ageRestriction:minor} -> no Teams link, Create menu Project/Article. Cookie alone (no sessionStorage) leaves SSR chrome showing Teams: expected, the chrome reads data-dev-operator (SYSTEM_ARCHITECTURE.md:2617) | — | — |
| M139 | /home?notice=teams-freelancer toasts the reason and strips the query | client / operator / operator sim / platform operator x /home landing | green | toast 'Teams are for freelancer accounts' + Dismiss; final URL /home; 0 console errors on all 47 pages opened | — | — |
| M140 | incidental (found while opening drawers; belongs to the step-3 gates): member drawer keeps --drawer-size | owner kwamemensah x /teams/northloop/members -> row drawer (same Drawer on every persona and on /businesses) | **red** | at 1440 the .ui-drawer.ui-drawer--right.wsp-mdrawer panel computes inline-size 1440px although --drawer-size = min(30rem, 92vw) (480px): .wsp-mdrawer { inline-size: 100% } lands on the Drawer root (class prop) and wins the equal-specificity tie with .ui-drawer--right { inline-size: var(--drawer-size) } (drawer.css:28). Shots: Z2/matrix/shots/drawer-\*.png | apps/web/features/workspaces/styles/workspace-people.css:441 | Yes — Z2 fix 1: the member drawer's column moves to the Drawer body, the panel keeps --drawer-size |

### 6.3 Design gates — `/teams`, `/teams/create`, Overview, Members, Roles (Z2 step 3, part A)

45 rows: 23 green, 20 red, 2 n/a.

| # | Check | Scope | Result | Evidence | file:line (reds) | Fixed in this pass? |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| A1 | Filled buttons per region ≤ 1 (tier-1 + tier-2 pair allowed) | /teams (roster, grid + list) | green | Grid and list views, 14 variants each (1440/900/390 in light, dark and HC, plus 1440 HC-dark, reduced at 1440 and 390, and 390 touch light/dark): no region has more than 1 filled button. The lane region (.ui-middle-nav__lane) has 1 filled button, "New team", a T2 .ui-lane-create, at 1440 and 900. There are 0 filled buttons at 390, where the lane is removed. The frame-footer "New team" is an outlined T4. The canvas bands have 0 filled. The dev-only .ui-speed-dial FAB is excluded. | — | — |
| A2 | No computed backdrop-filter | /teams (roster, grid + list) | **red** | Feature (wsp-\*) elements: 0. Shell elements on the page: (1) .ui-middle-nav__footer::before has blur(18px) saturate(1.3) at every width and mode. That is a band, and DESIGN_SYSTEM §B.4.3 bans glass on bands with no decision granting an exception. (2) nav.ui-bottom-nav has blur(18px) on the element itself (not a ::before) at 390. (3) header.ui-shell-topbar::before is the sanctioned §B.4.3 case 1. | packages/ui/navigation/styles/middle-nav.css:304; packages/ui/navigation/styles/bottom-nav.css:15 | No — #265 (a), (b) |
| A3 | No region/container background with alpha < 1 | /teams (roster, grid + list) | **red** | Every feature region is solid. Feature non-container marks with alpha < 1: the ui-zoom rail (112x2, α0.28), ticks (1x6, α0.45) and centre (2x12, α0.7). Shell: the .ui-middle-nav__footer::before veil is α0.76 (1096x48 at 1440, 556x48 at 900, 390x48 at 390). nav.ui-bottom-nav is α0.76 (390x56) at 390. The topbar::before veil (α0.76) is the sanctioned glass. | packages/ui/navigation/styles/middle-nav.css:303; packages/ui/navigation/styles/bottom-nav.css:14 | No — #265 (a), (b) |
| A4 | Heading weight ≤ 500 (uppercase section labels ≤ 600) | /teams (roster, grid + list) | green | 0 violations in 28 runs. Semantic headings max 500 (h1 "Teams", lane title). Title-class max 500 (400 at 390). Uppercase labels max 600 (list column heads). | — | — |
| A5 | Digit-bearing elements use tabular-nums | /teams (roster, grid + list) | green | Grid: 9 digit elements at 1440/900 and 7 at 390. List: 8 at 1440, 6 at 900, 3 at 390. All have font-variant-numeric tabular-nums (0 without), including the US$28,500.00 MoneyView and the tab count badges. | — | — |
| A6 | :active transform is a scale (none under data-motion=reduced) | /teams (roster, grid + list) | **red** | Checked with CDP CSS.forcePseudoState :active, with transitions disabled. Grid at 1440/900: feature 11/16 own-scale, shell 0/7. List at 1440: 22/28, where 6 DataTable gridcells compress through div.ui-dt__row scale(0.970) when the full active chain is forced. Failures: (a) lane ui-select-button__option ×4 (All/Owned/Member/Invitations) at 1440/900; (b) ui-lane-collapse at 1440/900; (c) ui-tabmenu__chevron prev/next at 390, both touch and non-touch; (d) the list tail gridcell (by design: data-table.css:103 holds the row still, and its kebab compresses itself); (e) shell controls shell-search__entity-btn/__search-go, shell-util__btn ×3, shell-util__profile and ui-shell-sidebar__toggle. Reduced: 16/16 and 28/28 at 1440 and 390 are none, including ancestors. | packages/ui/fields/styles/select-button.css:64; packages/ui/navigation/styles/lane.css:497; packages/ui/navigation/styles/tabmenu.css:129; apps/web/features/shell/styles/user-shell.css:181 | No — #265 (d) |
| A7 | axe-core: zero serious/critical | /teams (roster, grid + list) | **red** | Grid: aria-required-attr (critical) on .ui-splitter__handle, a focusable role=separator with no aria-valuenow. It fails at 1440 and 900 in every mode, and there are 0 violations at 390. List: the same, plus aria-required-children (critical) on .ui-dt.wsp-rtable in all 14 variants (a role=status div is a child of role=grid). | packages/ui/navigation/islands/MiddleNavSplitter.tsx:59; packages/ui/display/islands/DataTable.tsx:665 | Yes — the lane splitter handle announces aria-valuenow/min/max and resizes from the keyboard (Z2 fix 2); the DataTable live region is the grid's sibling (Z2 fix 3) |
| A8 | Inputs ≥ 16px at 390 | /teams (roster, grid + list) | green | Touch-emulated 390 (isMobile + hasTouch, pointer: coarse): "Search your teams" input is 16px in both views and both themes. Non-touch 390 (fine pointer): 13px (ui-field--size-sm). The floor applies to coarse pointers by design (DESIGN_SYSTEM:618; field.css:348). | — | — |
| A9 | No horizontal scroll at 390 | /teams (roster, grid + list) | green | Document scrollWidth equals clientWidth (390) in all 6 variants at 390, with 0 overflowing elements. Scrolling happens only inside components: the roster TabMenu strip (471/294, with chevrons) and, in the list view, the DataTable body (392/358: Name minWidth 224 + Status 120 + 3rem tail, with Name pinned). The DataTable docs make that its narrow-width behaviour. | — | — |
| A10 | Filled buttons per region ≤ 1 (tier-1 + tier-2 pair allowed) | /teams/create | green | The dialog panel ([role=dialog]) has 1 filled button, "Create team" (T2 structural, disabled until valid), in all 14 variants. Cancel is a text button. The lane region keeps its single T2 "New team" behind the scrim at 1440/900. No region has more than 1. | — | — |
| A11 | No computed backdrop-filter | /teams/create | **red** | Feature: 0. Shell: .ui-middle-nav__footer::before has blur(18px) everywhere, and nav.ui-bottom-nav has it on the element at 390, the same as on /teams. Also div.ui-backdrop (the scrim) has blur(8px) on the element itself in all variants. §B.4.3 case 2 allows a scrim but requires the ::before underlay. The topbar::before is sanctioned. | packages/ui/navigation/styles/middle-nav.css:304; packages/ui/overlay/styles/backdrop.css:17; packages/ui/navigation/styles/bottom-nav.css:15 | No — #265 (a), (b), (c) |
| A12 | No region/container background with alpha < 1 | /teams/create | **red** | Feature regions are solid. The only feature translucency: the focused field's interaction wash (span.ui-field, α0.06, 382x40) and the ui-zoom marks, both controls and not regions. The scrim is α0.42 light and α0.62 dark, which is sanctioned. Shell: the footer band veil at α0.76 at every width, and nav.ui-bottom-nav at α0.76 at 390. | packages/ui/navigation/styles/middle-nav.css:303; packages/ui/navigation/styles/bottom-nav.css:14 | No — #265 (a), (b) |
| A13 | Heading weight ≤ 500 (uppercase section labels ≤ 600) | /teams/create | **red** | h2.ui-dialog__title "Create a team" has computed font-weight 600 and is not uppercase, in all 14 variants. Every wsp heading is ≤ 500. The rule is in the ui Dialog, so it applies to every dialog title in the app. | packages/ui/feedback/styles/dialog.css:120 | Yes — Z2 fix 5: the Dialog and Drawer titles take the §A.4 title register (--fw-medium) |
| A14 | Digit-bearing elements use tabular-nums | /teams/create | green | 9 digit elements at 1440/900 and 7 at 390. All are tabular-nums (0 without). | — | — |
| A15 | :active transform is a scale (none under data-motion=reduced) | /teams/create | **red** | At 1440/900, feature controls pass 12/17. button.ui-dialog__close "Close" has no :active at any width. The 4 lane SelectButton options and ui-lane-collapse also fail. At 390, 11/13 pass (tabmenu chevrons fail) and Close fails. Shell passes 0/8. Reduced: 17/17 at 1440 and 13/13 at 390 are none. | packages/ui/feedback/styles/dialog.css:130; packages/ui/fields/styles/select-button.css:64; packages/ui/navigation/styles/lane.css:497 | No — #265 (d) |
| A16 | axe-core: zero serious/critical | /teams/create | green | 0 serious or critical violations in all 14 variants. The page behind the open modal is inert, so the splitter hit does not surface. | — | — |
| A17 | Inputs ≥ 16px at 390 | /teams/create | green | Touch 390: Display name, Handle and the roster search are all 16px in light and dark. Non-touch 390: 15px, 15px (size-md) and 13px. The 16px floor applies to coarse pointers by design (DESIGN_SYSTEM:618). | — | — |
| A18 | No horizontal scroll at 390 | /teams/create | green | Document 390/390 in all 6 variants at 390, with 0 overflowing elements. The only scroller is the roster TabMenu strip behind the scrim (471/294). | — | — |
| A19 | Filled buttons per region ≤ 1 (tier-1 + tier-2 pair allowed) | /teams/northloop (overview) | green | The lane has 1 filled button, "Invite member" (T2 .ui-lane-create), at 1440 and 900. The header band has 0 filled ("Share profile" is outlined). The bands "North Loop header", "At a glance", "Projects" and "Activity" have 0 each. There are 0 filled buttons at 390. | — | — |
| A20 | No computed backdrop-filter | /teams/northloop (overview) | **red** | Feature: 0. Shell: .ui-middle-nav__header::before and .ui-middle-nav__footer::before both have blur(18px) saturate(1.3) at every width and mode. Those are the frame bands that carry the Teams header band and footer rig, and §B.4.3 bans glass on bands. nav.ui-bottom-nav has it on the element at 390. The topbar::before is sanctioned. | packages/ui/navigation/styles/middle-nav.css:135; packages/ui/navigation/styles/middle-nav.css:304; packages/ui/navigation/styles/bottom-nav.css:15 | No — #265 (a), (b) |
| A21 | No region/container background with alpha < 1 | /teams/northloop (overview) | **red** | Feature: 0 translucent elements. Shell: the header band veil and footer band veil are each α0.76 (1096x48 at 1440, 556x48 at 900, 390x48 at 390). nav.ui-bottom-nav is α0.76 at 390. | packages/ui/navigation/styles/middle-nav.css:134; packages/ui/navigation/styles/middle-nav.css:303; packages/ui/navigation/styles/bottom-nav.css:14 | No — #265 (a), (b) |
| A22 | Heading weight ≤ 500 (uppercase section labels ≤ 600) | /teams/northloop (overview) | green | 0 violations in 14 variants. Semantic headings max 500 (h1.wsp-idhead__name "North Loop", h2.wsp-headerband__title "Overview"); title-class max 500; uppercase labels (the lane's "More" section toggle, the band labels) max 600. | — | — |
| A23 | Digit-bearing elements use tabular-nums | /teams/northloop (overview) | green | 11 digit elements in every variant, all tabular-nums (0 without). | — | — |
| A24 | :active transform is a scale (none under data-motion=reduced) | /teams/northloop (overview) | **red** | 1440/900: feature 3/5 own-scale — the lane's "More" section toggle and ui-lane-collapse have no :active; both header links and the kebab compress (0.97/0.92). 390: feature 2/2. Shell 0/7 at 1440/900 (shell-search entity/go, shell-util Create/Notifications/Basket, profile, sidebar toggle) and 0/2 at 390. Reduced: 5/5 + 7/7 at 1440 and 2/2 + 2/2 at 390 are none. | packages/ui/navigation/styles/lane.css:368; packages/ui/navigation/styles/lane.css:497; apps/web/features/shell/styles/user-shell.css:181 | No — #265 (d) |
| A25 | axe-core: zero serious/critical | /teams/northloop (overview) | **red** | aria-required-attr (critical) on .ui-splitter__handle at 1440 and 900 in every mode. color-contrast (serious) 3.57:1 on the active lane item's label (#ebfdff on #00929e) in 1440-dark, 1440-HC-dark and 900-dark — the Decision #96(a) brand pair. 0 violations at 390. | packages/ui/navigation/islands/MiddleNavSplitter.tsx:59; packages/ui/system/core/theme-engine.test.ts:149 (#96(a)) | Partly — the lane splitter handle announces aria-valuenow/min/max and resizes from the keyboard (Z2 fix 2); the dark brand pair is #265 (f) |
| A26 | Inputs ≥ 16px at 390 | /teams/northloop (overview) | n/a | No text input renders on the Overview at 390 (0 measured in all 6 variants). | — | — |
| A27 | No horizontal scroll at 390 | /teams/northloop (overview) | green | Document 390/390 in all 6 variants at 390, 0 overflowing elements, no inner scroller. | — | — |
| A28 | Filled buttons per region ≤ 1 (tier-1 + tier-2 pair allowed) | /teams/northloop/members (owner kwamemensah, People table) | green | The lane has 1 filled button, "Invite member" (T2), at 1440 and 900; 0 at 390. No other region holds a fill (Save changes lives in the drawer, which is closed). | — | — |
| A29 | No computed backdrop-filter | /teams/northloop/members (owner kwamemensah, People table) | **red** | Feature (wsp-\*) elements: 0. Shell: .ui-middle-nav__header::before and .ui-middle-nav__footer::before blur(18px) saturate(1.3) at every width and mode (the frame bands carrying the header band and the footer rig); nav.ui-bottom-nav blurs on the element itself at 390. header.ui-shell-topbar::before is the sanctioned §B.4.3 case 1. | packages/ui/navigation/styles/middle-nav.css:135; packages/ui/navigation/styles/middle-nav.css:304; packages/ui/navigation/styles/bottom-nav.css:15 | No — #265 (a), (b) |
| A30 | No region/container background with alpha < 1 | /teams/northloop/members (owner kwamemensah, People table) | **red** | Feature regions are solid; the only feature translucency is the rig's ui-zoom marks (rail 112×2 α0.28, ticks 1×6 α0.45, centre 2×12 α0.7) — a control. Shell: the header and footer band veils α0.76 (1096×48 at 1440, 556×48 at 900, 390×48 at 390), nav.ui-bottom-nav α0.76 (390×56) at 390; the topbar::before veil is the sanctioned glass. | packages/ui/navigation/styles/middle-nav.css:134; packages/ui/navigation/styles/middle-nav.css:303; packages/ui/navigation/styles/bottom-nav.css:14 | No — #265 (a), (b) |
| A31 | Heading weight ≤ 500 (uppercase section labels ≤ 600) | /teams/northloop/members (owner kwamemensah, People table) | green | 0 violations in 14 variants. Semantic headings max 500; uppercase labels max 600 (the table's column heads, the lane section toggle). | — | — |
| A32 | Digit-bearing elements use tabular-nums | /teams/northloop/members (owner kwamemensah, People table) | green | 9 digit elements at 1440 (the Stake, Workload and Joined cells among them); 1 at 900 and 390, where the DataTable has dropped those columns by priority. All tabular-nums. | — | — |
| A33 | :active transform is a scale (none under data-motion=reduced) | /teams/northloop/members (owner kwamemensah, People table) | **red** | 1440: feature 36/43 (18 of them compress through the DataTable row's scale(0.970)); 900: 20/27; 390: 18/21 (touch 21/24). Failures: the lane's "More" section toggle, the SelectButton options People / Org chart, ui-lane-collapse, and the row's tail gridcell (data-table.css:103 holds it still by design; its kebab compresses itself). Shell 0/7 (0/2 at 390). Reduced: 43/43 + 7/7 at 1440 and 21/21 + 2/2 at 390 are none. | packages/ui/fields/styles/select-button.css:64; packages/ui/navigation/styles/lane.css:368; packages/ui/navigation/styles/lane.css:497; apps/web/features/shell/styles/user-shell.css:181 | No — #265 (d) |
| A34 | axe-core: zero serious/critical | /teams/northloop/members (owner kwamemensah, People table) | **red** | aria-required-attr (critical) on .ui-splitter__handle at 1440 and 900; aria-required-children (critical) on .ui-dt.wsp-mtable in all 14 variants (a role=status div is a child of role=grid); color-contrast (serious) 3.57:1 on the active lane item in 1440-dark, 1440-HC-dark and 900-dark (#96(a)). | packages/ui/navigation/islands/MiddleNavSplitter.tsx:59; packages/ui/display/islands/DataTable.tsx:665 | Partly — the lane splitter handle announces aria-valuenow/min/max and resizes from the keyboard (Z2 fix 2); the DataTable live region is the grid's sibling (Z2 fix 3); the dark brand pair is #265 (f) |
| A35 | Inputs ≥ 16px at 390 | /teams/northloop/members (owner kwamemensah, People table) | green | "Search members" is 16px on the touch-emulated 390 (light and dark); 15px (size-md) on a fine pointer at 390 — the floor is coarse-pointer only by design (DESIGN_SYSTEM:618). | — | — |
| A36 | No horizontal scroll at 390 | /teams/northloop/members (owner kwamemensah, People table) | green | Document 390/390 in all 6 variants at 390, 0 overflowing elements. Only the People DataTable body scrolls inside itself (476/358) — DataTable's documented narrow-width behaviour (#263 (h)). | — | — |
| A37 | Filled buttons per region ≤ 1 (tier-1 + tier-2 pair allowed) | /teams/northloop/roles (owner kwamemensah) | green | Two regions, one fill each: the lane's T2 "Invite member" (1440/900) and the header band's T2 "New role" (every width). | — | — |
| A38 | No computed backdrop-filter | /teams/northloop/roles (owner kwamemensah) | **red** | Feature (wsp-\*) elements: 0. Shell: .ui-middle-nav__header::before and .ui-middle-nav__footer::before blur(18px) saturate(1.3) at every width and mode (the frame bands carrying the header band and the footer rig); nav.ui-bottom-nav blurs on the element itself at 390. header.ui-shell-topbar::before is the sanctioned §B.4.3 case 1. | packages/ui/navigation/styles/middle-nav.css:135; packages/ui/navigation/styles/middle-nav.css:304; packages/ui/navigation/styles/bottom-nav.css:15 | No — #265 (a), (b) |
| A39 | No region/container background with alpha < 1 | /teams/northloop/roles (owner kwamemensah) | **red** | Feature regions are solid; the only feature translucency is the PermissionMatrix ScrollArea thumbs (8×381 vertical, 369×8 / 183×8 horizontal, α0.28) — controls. Shell: the header and footer band veils α0.76 (1096×48 at 1440, 556×48 at 900, 390×48 at 390), nav.ui-bottom-nav α0.76 (390×56) at 390; the topbar::before veil is the sanctioned glass. | packages/ui/navigation/styles/middle-nav.css:134; packages/ui/navigation/styles/middle-nav.css:303; packages/ui/navigation/styles/bottom-nav.css:14 | No — #265 (a), (b) |
| A40 | Heading weight ≤ 500 (uppercase section labels ≤ 600) | /teams/northloop/roles (owner kwamemensah) | green | 0 violations in 14 variants. Semantic headings max 500; uppercase labels (the matrix's group rows) max 600. | — | — |
| A41 | Digit-bearing elements use tabular-nums | /teams/northloop/roles (owner kwamemensah) | green | 6 digit elements in every variant, all tabular-nums (0 without). | — | — |
| A42 | :active transform is a scale (none under data-motion=reduced) | /teams/northloop/roles (owner kwamemensah) | **red** | 1440/900: feature 4/6 — the lane's "More" section toggle and ui-lane-collapse fail; 390: 3/3. The 56 preset matrix cells are aria-disabled (locked) and skipped. Shell 0/7 (0/2 at 390). Reduced: all none. | packages/ui/navigation/styles/lane.css:368; packages/ui/navigation/styles/lane.css:497; apps/web/features/shell/styles/user-shell.css:181 | No — #265 (d) |
| A43 | axe-core: zero serious/critical | /teams/northloop/roles (owner kwamemensah) | **red** | aria-required-attr (critical) on .ui-splitter__handle at 1440 and 900; color-contrast (serious) 3.57:1 on the active lane item in 1440-dark, 1440-HC-dark and 900-dark (#96(a)). | packages/ui/navigation/islands/MiddleNavSplitter.tsx:59 | Partly — the lane splitter handle announces aria-valuenow/min/max and resizes from the keyboard (Z2 fix 2); the dark brand pair is #265 (f) |
| A44 | Inputs ≥ 16px at 390 | /teams/northloop/roles (owner kwamemensah) | n/a | No text input renders on Roles at 390 (the role editor dialog is closed). | — | — |
| A45 | No horizontal scroll at 390 | /teams/northloop/roles (owner kwamemensah) | green | Document 390/390 in all 6 variants at 390; the PermissionMatrix's ScrollArea scrolls inside itself (700/358), as its contract says. | — | — |

### 6.4 Design gates — Payouts, Projects, Settings, the storefront, `/businesses` (Z2 step 3, part B)

63 rows: 33 green, 30 red, 0 n/a.

| # | Check | Scope | Result | Evidence | file:line (reds) | Fixed in this pass? |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| B1 | Filled buttons per region ≤ 1 (tier-1 + tier-2 pair allowed) | /teams/northloop/payouts (owner kwamemensah) | green | 1 T2 "Invite member" in the lane at 1440/900 (and in both reduced runs); 0 at 390. The rig's Save is not drawn until the split is dirty. No region over 1. | — | — |
| B2 | No computed backdrop-filter | /teams/northloop/payouts (owner kwamemensah) | **red** | Feature: 0. Shell: .ui-middle-nav__header::before and .ui-middle-nav__footer::before blur(18px) saturate(1.3) in all 15 variants; nav.ui-bottom-nav blurs on the element itself at 390 (not on a ::before). header.ui-shell-topbar::before is the sanctioned §B.4.3 case 1. | packages/ui/navigation/styles/middle-nav.css:135; packages/ui/navigation/styles/middle-nav.css:304; packages/ui/navigation/styles/bottom-nav.css:15 | No — #265 (a), (b) |
| B3 | No region/container background with alpha < 1 | /teams/northloop/payouts (owner kwamemensah) | **red** | Feature: 0 translucent regions. Shell: the .ui-middle-nav__header and .ui-middle-nav__footer veils at α0.76 in every variant and nav.ui-bottom-nav α0.76 at 390; the topbar veil is the sanctioned glass. | packages/ui/navigation/styles/middle-nav.css:134; packages/ui/navigation/styles/middle-nav.css:303; packages/ui/navigation/styles/bottom-nav.css:14 | No — #265 (a), (b) |
| B4 | Heading weight ≤ 500 (uppercase section labels ≤ 600) | /teams/northloop/payouts (owner kwamemensah) | green | 0 violations. h1 / h2 "Payouts" at 500; the section labels (Split rule, Member stakes, Preview, Who can move money) are uppercase h2 at 600. | — | — |
| B5 | Digit-bearing elements use tabular-nums | /teams/northloop/payouts (owner kwamemensah) | green | Every figure is tabular. One prose sentence carries a digit without it: p.wsp-payout__meta "… the stakes always total 100% …" (MemberStakesSection.tsx:50) — a fixed figure inside prose, not a changing one (§A.4). | — | — |
| B6 | :active transform is a scale (none under data-motion=reduced) | /teams/northloop/payouts (owner kwamemensah) | **red** | The one enabled template option, SelectButton "Co-op", has no :active at every width (touch included); the lane's "More" toggle and ui-lane-collapse fail at 1440/900. The SplitBar handles compress to 0.92; the hold toggles, Split evenly, See plans and Share profile to 0.97. Shell 0/7 at 1440/900 (shell-search entity/go, shell-util Create/Notifications/Basket, profile, sidebar toggle) and 0/2 at 390. Reduced (both channels): nothing compresses. | packages/ui/fields/styles/select-button.css:64; packages/ui/navigation/styles/lane.css:368; packages/ui/navigation/styles/lane.css:497; apps/web/features/shell/styles/user-shell.css:181 | No — #265 (d) |
| B7 | axe-core: zero serious/critical | /teams/northloop/payouts (owner kwamemensah) | **red** | aria-required-attr (critical) on .ui-splitter__handle at 1440/900 in every mode; color-contrast (serious) 3.57:1 on the active lane item's label (#ebfdff on #00929e) in 1440-dark, 1440-HC-dark and 900-dark — the Decision #96(a) brand pair. 0 in both touch runs. | packages/ui/navigation/islands/MiddleNavSplitter.tsx:59 | Partly — the lane splitter handle announces aria-valuenow/min/max and resizes from the keyboard (Z2 fix 2); the dark brand pair is #265 (f) |
| B8 | Inputs ≥ 16px at 390 | /teams/northloop/payouts (owner kwamemensah) | green | Touch 390: 0 inputs under 16px. Fine-pointer 390: the InputNumber and MoneyInput are 15px — the floor is coarse-pointer only by design (DESIGN_SYSTEM:618). | — | — |
| B9 | No horizontal scroll at 390 | /teams/northloop/payouts (owner kwamemensah) | green | No document or body overflow and 0 elements past the edge in any of the 15 variants. | — | — |
| B10 | Filled buttons per region ≤ 1 (tier-1 + tier-2 pair allowed) | /teams/northloop/projects (owner kwamemensah) | green | 1 T2 "Invite member" in the lane at 1440/900; 0 at 390. The allowance band and the engagements hold no fill. | — | — |
| B11 | No computed backdrop-filter | /teams/northloop/projects (owner kwamemensah) | **red** | Feature: 0. Shell: .ui-middle-nav__header::before and .ui-middle-nav__footer::before blur(18px) saturate(1.3) in all 15 variants; nav.ui-bottom-nav blurs on the element itself at 390 (not on a ::before). header.ui-shell-topbar::before is the sanctioned §B.4.3 case 1. | packages/ui/navigation/styles/middle-nav.css:135; packages/ui/navigation/styles/middle-nav.css:304; packages/ui/navigation/styles/bottom-nav.css:15 | No — #265 (a), (b) |
| B12 | No region/container background with alpha < 1 | /teams/northloop/projects (owner kwamemensah) | **red** | Feature: 0 translucent regions. Shell: the .ui-middle-nav__header and .ui-middle-nav__footer veils at α0.76 in every variant and nav.ui-bottom-nav α0.76 at 390; the topbar veil is the sanctioned glass. | packages/ui/navigation/styles/middle-nav.css:134; packages/ui/navigation/styles/middle-nav.css:303; packages/ui/navigation/styles/bottom-nav.css:14 | No — #265 (a), (b) |
| B13 | Heading weight ≤ 500 (uppercase section labels ≤ 600) | /teams/northloop/projects (owner kwamemensah) | green | 0 violations. h2 "Projects" at 500; the labels "Proposals this week" and "Live engagements" are uppercase 600. | — | — |
| B14 | Digit-bearing elements use tabular-nums | /teams/northloop/projects (owner kwamemensah) | green | Every digit-bearing element is tabular-nums (0 without), the allowance's "0 / 50" among them. | — | — |
| B15 | :active transform is a scale (none under data-motion=reduced) | /teams/northloop/projects (owner kwamemensah) | **red** | The lane's "More" toggle and ui-lane-collapse fail at 1440/900; the tabs and links compress. Shell 0/7 at 1440/900 (shell-search entity/go, shell-util Create/Notifications/Basket, profile, sidebar toggle) and 0/2 at 390. Reduced (both channels): nothing compresses. | packages/ui/navigation/styles/lane.css:368; packages/ui/navigation/styles/lane.css:497; apps/web/features/shell/styles/user-shell.css:181 | No — #265 (d) |
| B16 | axe-core: zero serious/critical | /teams/northloop/projects (owner kwamemensah) | **red** | aria-required-attr (critical) on .ui-splitter__handle at 1440/900 in every mode; color-contrast (serious) 3.57:1 on the active lane item's label (#ebfdff on #00929e) in 1440-dark, 1440-HC-dark and 900-dark — the Decision #96(a) brand pair. 0 in both touch runs. | packages/ui/navigation/islands/MiddleNavSplitter.tsx:59 | Partly — the lane splitter handle announces aria-valuenow/min/max and resizes from the keyboard (Z2 fix 2); the dark brand pair is #265 (f) |
| B17 | Inputs ≥ 16px at 390 | /teams/northloop/projects (owner kwamemensah) | green | Touch 390: 0 inputs under 16px; the only sub-16px field is the shell search at 1440/900 (14.4px, a fine pointer). | — | — |
| B18 | No horizontal scroll at 390 | /teams/northloop/projects (owner kwamemensah) | green | No document or body overflow and 0 elements past the edge in any of the 15 variants. | — | — |
| B19 | Filled buttons per region ≤ 1 (tier-1 + tier-2 pair allowed) | /teams/northloop/settings (owner kwamemensah) | green | 1 T2 "Invite member" in the lane at 1440/900; 0 at 390. No Archive control (2 held escrows + 1 live stage block it), so no danger fill. | — | — |
| B20 | No computed backdrop-filter | /teams/northloop/settings (owner kwamemensah) | **red** | Feature: 0. Shell: .ui-middle-nav__header::before and .ui-middle-nav__footer::before blur(18px) saturate(1.3) in all 15 variants; nav.ui-bottom-nav blurs on the element itself at 390 (not on a ::before). header.ui-shell-topbar::before is the sanctioned §B.4.3 case 1. | packages/ui/navigation/styles/middle-nav.css:135; packages/ui/navigation/styles/middle-nav.css:304; packages/ui/navigation/styles/bottom-nav.css:15 | No — #265 (a), (b) |
| B21 | No region/container background with alpha < 1 | /teams/northloop/settings (owner kwamemensah) | **red** | Feature: 0 translucent regions. Shell: the .ui-middle-nav__header and .ui-middle-nav__footer veils at α0.76 in every variant and nav.ui-bottom-nav α0.76 at 390; the topbar veil is the sanctioned glass. | packages/ui/navigation/styles/middle-nav.css:134; packages/ui/navigation/styles/middle-nav.css:303; packages/ui/navigation/styles/bottom-nav.css:14 | No — #265 (a), (b) |
| B22 | Heading weight ≤ 500 (uppercase section labels ≤ 600) | /teams/northloop/settings (owner kwamemensah) | green | 0 violations. h1 / h2 "Settings" at 500; Identity, Visibility and Lifecycle are uppercase 600. | — | — |
| B23 | Digit-bearing elements use tabular-nums | /teams/northloop/settings (owner kwamemensah) | green | Every digit-bearing element is tabular (the blockers' counts ride .ui-inline-notice.wsp-settings__blocker's tabular-nums). | — | — |
| B24 | :active transform is a scale (none under data-motion=reduced) | /teams/northloop/settings (owner kwamemensah) | **red** | The Visibility SelectButton's options Public / Unlisted / Invite only have no :active at every width (touch included); the lane's "More" toggle and ui-lane-collapse fail at 1440/900. Shell 0/7 at 1440/900 (shell-search entity/go, shell-util Create/Notifications/Basket, profile, sidebar toggle) and 0/2 at 390. Reduced (both channels): nothing compresses. | packages/ui/fields/styles/select-button.css:64; packages/ui/navigation/styles/lane.css:368; packages/ui/navigation/styles/lane.css:497; apps/web/features/shell/styles/user-shell.css:181 | No — #265 (d) |
| B25 | axe-core: zero serious/critical | /teams/northloop/settings (owner kwamemensah) | **red** | aria-required-attr (critical) on .ui-splitter__handle at 1440/900 in every mode; link-in-text-block (serious) on the blockers' links (.wsp-settings__blocker .ui-link, the …/projects link) in light 1.2:1, dark 1.63:1, HC 1.86:1, HC-dark 2.33:1, and on "Edit the profile" (a[href$=edit]) at 390-dark 2.9:1 — ink-only links in running text; color-contrast (serious) 3.57:1 on the active lane item's label (#ebfdff on #00929e) in 1440-dark, 1440-HC-dark and 900-dark — the Decision #96(a) brand pair. | packages/ui/navigation/islands/MiddleNavSplitter.tsx:59; apps/web/features/workspaces/islands/TeamSettingsScreen.island.tsx:383, :556 (ui Link without an underline) | Partly — the lane splitter handle announces aria-valuenow/min/max and resizes from the keyboard (Z2 fix 2); the Settings links in running text are underlined (Z2 fix 4); the dark brand pair is #265 (f) |
| B26 | Inputs ≥ 16px at 390 | /teams/northloop/settings (owner kwamemensah) | green | Touch 390: 0 inputs under 16px. Fine-pointer: the Name field is 15px (size-md) — the floor is coarse-pointer only by design (DESIGN_SYSTEM:618). | — | — |
| B27 | No horizontal scroll at 390 | /teams/northloop/settings (owner kwamemensah) | green | No document or body overflow and 0 elements past the edge in any of the 15 variants. | — | — |
| B28 | Filled buttons per region ≤ 1 (tier-1 + tier-2 pair allowed) | /northloop storefront (owner kwamemensah, signed in) | green | The hero holds one fill, "Add to project" (mono), beside the outlined "Manage team" (P1 #257); the footer's "Subscribe" is its own region. No region over 1. | — | — |
| B29 | No computed backdrop-filter | /northloop storefront (owner kwamemensah, signed in) | **red** | Sanctioned: header.ui-shell-topbar::before (§B.4.3 case 1), .pf-showcase__rail::before blur(8px) over the showcase photography (case 3), .pf-tabs__pill::before (the floating tab pill, Decision #111). Not sanctioned: nav.ui-bottom-nav blurs on the element at 390. | packages/ui/navigation/styles/bottom-nav.css:15 | No — #265 (b) |
| B30 | No region/container background with alpha < 1 | /northloop storefront (owner kwamemensah, signed in) | **red** | Every region is solid. Translucent and sanctioned or controls: the topbar and tab-pill veils (α0.76), the showcase rail scrim (α0.58, photography), the showcase dots (controls), the newsletter field's wash (α0.06, a control). Shell: nav.ui-bottom-nav α0.76 at 390. | packages/ui/navigation/styles/bottom-nav.css:14 | No — #265 (b) |
| B31 | Heading weight ≤ 500 (uppercase section labels ≤ 600) | /northloop storefront (owner kwamemensah, signed in) | **red** | h1.pf-hero__name "North Loop" at 700 is Decision #96's sanctioned profile-hero exception (§A.4). Over the Z2 gate: h3.ex-card__title "Realtime MVP build" at 600 (not uppercase) in every variant; h2.ui-visually-hidden "Work" at 700 is clipped to 1px and never painted. Section labels (Availability, Services, Products, People) and the footer's column heads are uppercase 600. | apps/web/features/explore/styles/explore.css:644 | No — #265 (g) |
| B32 | Digit-bearing elements use tabular-nums | /northloop storefront (owner kwamemensah, signed in) | green | Three prose/meta strings carry digits without tabular-nums: p.pf-avail__next "Back Tue 9:00 AM", span.ex-card__aside "4-week delivery", the footer's "© 2026 Projective" — none is a changing figure (§A.4 scopes tabular-nums to figures that change); every price and count is tabular. | — | — |
| B33 | :active transform is a scale (none under data-motion=reduced) | /northloop storefront (owner kwamemensah, signed in) | **red** | No :active at any width (touch included): button.pf-hero__count "2 followers", button.pf-showcase__open, the two button.pf-showcase__dot tabs, and the footer's button.lp-footer__news-submit "Subscribe". Shell top bar controls fail as on the console. The hero's Manage team / Add to project compress. Reduced: nothing compresses. | apps/web/features/profile/styles/profile-hero.css:341; apps/web/features/profile/styles/profile-showcase.css:90; apps/web/features/profile/styles/profile-showcase.css:188; apps/web/features/marketing/styles/footer.css:307; apps/web/features/shell/styles/user-shell.css:181 | No — #265 (d), (e) |
| B34 | axe-core: zero serious/critical | /northloop storefront (owner kwamemensah, signed in) | **red** | list (serious): ul.pf-showcase__track owns role=tabpanel children (1440/900/390, both touch runs); target-size (serious): .ex-prod__owner is 61×16 px (every variant). | apps/web/features/profile/components/ProfileShowcase.tsx:286; apps/web/features/explore/styles/explore.css:1964 | No — #265 (h) |
| B35 | Inputs ≥ 16px at 390 | /northloop storefront (owner kwamemensah, signed in) | **red** | Touch 390 (pointer: coarse): the footer's newsletter field input.lp-footer__news-input is 14.8px in light and dark. | apps/web/features/marketing/styles/footer.css:288 | No — #265 (i) |
| B36 | No horizontal scroll at 390 | /northloop storefront (owner kwamemensah, signed in) | green | No document or body overflow and 0 elements past the edge in any of the 15 variants. | — | — |
| B37 | Filled buttons per region ≤ 1 (tier-1 + tier-2 pair allowed) | /northloop storefront (signed-out visitor) | green | The hero's Hire (tier 3) with the mono Add to project is the conversion pair; the guest header's "Open menu" (900/390) and the footer's "Subscribe" sit in their own regions. No region over 1. | — | — |
| B38 | No computed backdrop-filter | /northloop storefront (signed-out visitor) | green | Only sanctioned glass: .pf-showcase__rail::before blur(8px) and, on touch, the .ex-actions buttons' ::before over card photography (§B.4.3 case 3), and .pf-tabs__pill::before (Decision #111). All on ::before underlays. | — | — |
| B39 | No region/container background with alpha < 1 | /northloop storefront (signed-out visitor) | green | Every region is solid. Translucent: the tab pill's veil (α0.76, Decision #111), the showcase rail scrim (α0.58, photography) and controls only — the guest search field (α0.55), the theme toggle (α0.45), the burger (α0.55), the showcase dots, the newsletter field wash (α0.06), the touch card actions (α0.62). | — | — |
| B40 | Heading weight ≤ 500 (uppercase section labels ≤ 600) | /northloop storefront (signed-out visitor) | **red** | h1.pf-hero__name "North Loop" at 700 is Decision #96's sanctioned profile-hero exception (§A.4). Over the Z2 gate: h3.ex-card__title "Realtime MVP build" at 600 (not uppercase) in every variant; h2.ui-visually-hidden "Work" at 700 is clipped to 1px and never painted. Section labels (Availability, Services, Products, People) and the footer's column heads are uppercase 600. | apps/web/features/explore/styles/explore.css:644 | No — #265 (g) |
| B41 | Digit-bearing elements use tabular-nums | /northloop storefront (signed-out visitor) | green | Three prose/meta strings carry digits without tabular-nums: p.pf-avail__next "Back Tue 9:00 AM", span.ex-card__aside "4-week delivery", the footer's "© 2026 Projective" — none is a changing figure (§A.4 scopes tabular-nums to figures that change); every price and count is tabular. | — | — |
| B42 | :active transform is a scale (none under data-motion=reduced) | /northloop storefront (signed-out visitor) | **red** | No :active: the profile's pf-hero__count, pf-showcase__open and the two pf-showcase__dot tabs; the guest chrome's site-header__pillar-trigger ×4 (1440), site-header__entity-btn, site-header__search-go, the theme toggle (1440), site-header__burger (900/390) and lp-footer__news-submit. Reduced: nothing compresses. | apps/web/features/profile/styles/profile-hero.css:341; apps/web/features/profile/styles/profile-showcase.css:90; apps/web/features/profile/styles/profile-showcase.css:188; apps/web/features/marketing/styles/site-shell.css:517; apps/web/features/marketing/styles/footer.css:307 | No — #265 (e) |
| B43 | axe-core: zero serious/critical | /northloop storefront (signed-out visitor) | **red** | list (serious): ul.pf-showcase__track owns role=tabpanel children (1440/900/390, both touch runs); target-size (serious): .ex-prod__owner is 61×16 px (every variant); color-contrast (serious) 3.57:1 (#ebfdff on #00929e) on the Hire button's label in 1440/900/390 dark and 390 touch-dark, and on .site-header__cta in 1440-dark and 1440-HC-dark — the Decision #96(a) brand pair. | apps/web/features/profile/components/ProfileShowcase.tsx:286; apps/web/features/explore/styles/explore.css:1964; apps/web/features/marketing/styles/site-shell.css:449 | No — #265 (f), (h) |
| B44 | Inputs ≥ 16px at 390 | /northloop storefront (signed-out visitor) | **red** | Touch 390 (pointer: coarse): the guest header's input.site-header__search-input is 13.6px and the footer's input.lp-footer__news-input 14.8px, in light and dark. | apps/web/features/marketing/styles/site-shell.css:394, :774; apps/web/features/marketing/styles/footer.css:288 | No — #265 (i) |
| B45 | No horizontal scroll at 390 | /northloop storefront (signed-out visitor) | green | No document or body overflow and 0 elements past the edge in any of the 15 variants. | — | — |
| B46 | Filled buttons per region ≤ 1 (tier-1 + tier-2 pair allowed) | /businesses (operator priyaraman) — the shared roster, Decision #61 | green | No region holds more than one fill. The lane footer withholds its create ("Your plan includes 1 business — archive one or upgrade…"). At 390 the heuristic counts the TabMenu's two scroll chevrons as "other-opaque" in the head band: they are icon controls on the strip's own --surface mask (tabmenu.css:129), unfilled on the page (shot B__biz-roster__390-light__fold.png); the /teams pass did not count the same chevrons. | — | — |
| B47 | No computed backdrop-filter | /businesses (operator priyaraman) — the shared roster, Decision #61 | **red** | Feature: 0. Shell: .ui-middle-nav__footer::before blur(18px) saturate(1.3) in all 15 variants; nav.ui-bottom-nav blurs on the element itself at 390 (not on a ::before). header.ui-shell-topbar::before is the sanctioned §B.4.3 case 1. | packages/ui/navigation/styles/middle-nav.css:304; packages/ui/navigation/styles/bottom-nav.css:15 | No — #265 (a), (b) |
| B48 | No region/container background with alpha < 1 | /businesses (operator priyaraman) — the shared roster, Decision #61 | **red** | Feature: 0 translucent regions. Shell: the .ui-middle-nav__footer veils at α0.76 in every variant and nav.ui-bottom-nav α0.76 at 390; the topbar veil is the sanctioned glass. | packages/ui/navigation/styles/middle-nav.css:303; packages/ui/navigation/styles/bottom-nav.css:14 | No — #265 (a), (b) |
| B49 | Heading weight ≤ 500 (uppercase section labels ≤ 600) | /businesses (operator priyaraman) — the shared roster, Decision #61 | green | 0 violations. h1 / title "Businesses" and the card's h3 "Helia Finance" at 500. | — | — |
| B50 | Digit-bearing elements use tabular-nums | /businesses (operator priyaraman) — the shared roster, Decision #61 | green | Every figure is tabular (the US$76,000.00 MoneyView, the tab badges). The lane footer's sentence "Your plan includes 1 business — …" carries a digit in prose (§A.4 scopes tabular-nums to changing figures). | — | — |
| B51 | :active transform is a scale (none under data-motion=reduced) | /businesses (operator priyaraman) — the shared roster, Decision #61 | **red** | The lane SelectButton options All / Owned / Member / Invitations and ui-lane-collapse fail at 1440/900; the TabMenu chevrons fail at 390 (touch included). Shell 0/7 at 1440/900 (shell-search entity/go, shell-util Create/Notifications/Basket, profile, sidebar toggle) and 0/2 at 390. Reduced (both channels): nothing compresses. | packages/ui/fields/styles/select-button.css:64; packages/ui/navigation/styles/lane.css:497; packages/ui/navigation/styles/tabmenu.css:129; apps/web/features/shell/styles/user-shell.css:181 | No — #265 (d) |
| B52 | axe-core: zero serious/critical | /businesses (operator priyaraman) — the shared roster, Decision #61 | **red** | aria-required-attr (critical) on .ui-splitter__handle at 1440/900 in every mode. Nothing else; 0 in both touch runs. | packages/ui/navigation/islands/MiddleNavSplitter.tsx:59 | Yes — the lane splitter handle announces aria-valuenow/min/max and resizes from the keyboard (Z2 fix 2) |
| B53 | Inputs ≥ 16px at 390 | /businesses (operator priyaraman) — the shared roster, Decision #61 | green | Touch 390: 0 inputs under 16px. Fine-pointer: the lane search and the roster search are 13px (size-sm) — the floor is coarse-pointer only by design (DESIGN_SYSTEM:618). | — | — |
| B54 | No horizontal scroll at 390 | /businesses (operator priyaraman) — the shared roster, Decision #61 | green | No document or body overflow and 0 elements past the edge in any of the 15 variants. | — | — |
| B55 | Filled buttons per region ≤ 1 (tier-1 + tier-2 pair allowed) | /businesses/heliafinance (operator priyaraman) — the shared console, Decision #61 | green | 1 T2 "Invite member" in the lane at 1440/900; 0 at 390. | — | — |
| B56 | No computed backdrop-filter | /businesses/heliafinance (operator priyaraman) — the shared console, Decision #61 | **red** | Feature: 0. Shell: .ui-middle-nav__header::before and .ui-middle-nav__footer::before blur(18px) saturate(1.3) in all 15 variants; nav.ui-bottom-nav blurs on the element itself at 390 (not on a ::before). header.ui-shell-topbar::before is the sanctioned §B.4.3 case 1. | packages/ui/navigation/styles/middle-nav.css:135; packages/ui/navigation/styles/middle-nav.css:304; packages/ui/navigation/styles/bottom-nav.css:15 | No — #265 (a), (b) |
| B57 | No region/container background with alpha < 1 | /businesses/heliafinance (operator priyaraman) — the shared console, Decision #61 | **red** | Feature: 0 translucent regions. Shell: the .ui-middle-nav__header and .ui-middle-nav__footer veils at α0.76 in every variant and nav.ui-bottom-nav α0.76 at 390; the topbar veil is the sanctioned glass. | packages/ui/navigation/styles/middle-nav.css:134; packages/ui/navigation/styles/middle-nav.css:303; packages/ui/navigation/styles/bottom-nav.css:14 | No — #265 (a), (b) |
| B58 | Heading weight ≤ 500 (uppercase section labels ≤ 600) | /businesses/heliafinance (operator priyaraman) — the shared console, Decision #61 | green | 0 violations. h1 "Helia Finance" and h2 "Overview" at 500; Money, Projects and Activity are uppercase 600; the project titles 500. | — | — |
| B59 | Digit-bearing elements use tabular-nums | /businesses/heliafinance (operator priyaraman) — the shared console, Decision #61 | green | Every figure is tabular. The stat label span.ui-stat__label "Spent (30d)" carries a digit in a label, not a figure; its value beside it is tabular. | — | — |
| B60 | :active transform is a scale (none under data-motion=reduced) | /businesses/heliafinance (operator priyaraman) — the shared console, Decision #61 | **red** | The lane's "More" toggle and ui-lane-collapse fail at 1440/900. Shell 0/7 at 1440/900 (shell-search entity/go, shell-util Create/Notifications/Basket, profile, sidebar toggle) and 0/2 at 390. Reduced (both channels): nothing compresses. | packages/ui/navigation/styles/lane.css:368; packages/ui/navigation/styles/lane.css:497; apps/web/features/shell/styles/user-shell.css:181 | No — #265 (d) |
| B61 | axe-core: zero serious/critical | /businesses/heliafinance (operator priyaraman) — the shared console, Decision #61 | **red** | aria-required-attr (critical) on .ui-splitter__handle at 1440/900 in every mode; color-contrast (serious) 3.57:1 on the active lane item's label (#ebfdff on #00929e) in 1440-dark, 1440-HC-dark and 900-dark — the Decision #96(a) brand pair. 0 in both touch runs. | packages/ui/navigation/islands/MiddleNavSplitter.tsx:59 | Partly — the lane splitter handle announces aria-valuenow/min/max and resizes from the keyboard (Z2 fix 2); the dark brand pair is #265 (f) |
| B62 | Inputs ≥ 16px at 390 | /businesses/heliafinance (operator priyaraman) — the shared console, Decision #61 | green | Touch 390: 0 inputs under 16px; the only sub-16px field is the shell search at 1440/900 (14.4px, a fine pointer). | — | — |
| B63 | No horizontal scroll at 390 | /businesses/heliafinance (operator priyaraman) — the shared console, Decision #61 | green | No document or body overflow and 0 elements past the edge in any of the 15 variants. | — | — |

### 6.5 Notes

- **Green, with a question for the owner.** (1) M46, M59, M135: a uuid or wrong-case address that
  also names a withheld module answers ONE 308 straight to the module the viewer may open
  (ROUTING.md:119), but `consoleResponse` sends a 308 with no `Cache-Control`
  (`apps/web/features/workspaces/core/console-route.ts:100`). A 308 is cacheable by default and this
  target depends on the viewer's capabilities, so a browser that cached a member's answer keeps
  sending them to the console root after they are granted the module (B6, #228 (B)). (2) M47, M60:
  a team's own lead and member are offered Hire and Add to project on its storefront; P1 (#257) put
  Manage team in Hire's place only for `edit_profile` holders.
- **The live DB lags main** (T19–T21): C2's and C3's `00001020` hunks are not applied there; main is
  correct, and the orchestrator's `db:reset` after landing brings the live DB level.
- **Heuristics.** Part B's filled-button count reads the TabMenu's scroll chevrons as fills at 390
  (B46); part A's does not (A1). They are an opaque mask over the scrolled strip, not a filled tier.
  The DataTable's tail gridcell holds still on press by design (`data-table.css:103`); its kebab
  compresses itself.
- **Already open elsewhere.** The lane's own collapse and section toggles were left Open by L1
  (#255, §2 D1); #265 (d) restates them with the rest of the press gaps the gates found.
