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
| F7 | `contributor` role | `PRODUCT_SPEC.md:197` | Absent everywhere | 📄 → Decision #226 (a) | Fixed by #250 (a) — C3's Contributor template (#264); spec by Z1 |
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
| D41 | T | Dead CSS: `.wsp-footerrig__action[data-variant]` (chrome 807-818), `.wsp-lane__new` (~299), `.wsp-skel__*` (console ~944) | Delete. | Fixed by W1 (#251) + L2 (#258); the kept `.wsp-footerrig__action` is dead since BU2 — Open (a tidy) |
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
| P0 | D1, D4-D6, D9, D11-D12, D17-D20, D25, D34-D35, D38 | UI gates | Fixed by W1 (#251) + R1–R3, L1–L2, C1–C4 (#253–#264) |
| P1 | B8 vault-sync backstop triggers | DB | Fixed by B3 |
| P1 | §4.1 308 canonicalisation split | app | Fixed by B6 (#228 (B)) |
| P1 | D22-D30 button matrix; TabMenu / ActionMenu / LaneCreateButton parity | UI | Fixed by R1, R3, L1, L2, C3 + BU2 (D30) |
| P1 | `MetaLine`, tier-2 `LaneCreateButton` in `packages/ui` (+ `DESIGN_SYSTEM.md` §C.1 roster) | ui | Fixed by U1 + U2 |
| P2 | S3 escrow guard widening (#197 b); W3 dead team W_i column; D14-D16, D39-D41 tidy | DB / UI | Fixed by B5 + C6 (S3), B7 + #235 (W3), W1 (+ R1, C1, C2, C4, BU2 for D39) |
| P2 | Spec corrections once #226 is ruled (`PRODUCT_SPEC.md:189-198, 591, 2975-2981`; PM restore rule) | docs | Fixed by T0 (#228), P1 (#257), C6 (#261) and Z1 |
