# Subscriptions, Agency Scale & Public Pricing Audit (2026-10-17)

> Read-only evaluation of the subscription ladder (`finance.plans` · `plan_entitlements` ·
> `subscriptions` · `allowance_periods`), the entitlement resolver and its fail-open switches, the
> agency-fairness mechanics, and the proposed public `/pricing` surface, against `PRODUCT_SPEC.md`,
> `finance-model.md` §1.3 / §16, `SYSTEM_ARCHITECTURE.md`, `ROUTING.md`, `DESIGN_SYSTEM.md` and
> `database/finance/Tables.md`. No code or migration was changed by this audit. The new
> contradictions and open product questions it found are logged as **Decision #252** (flags
> (a)–(m)); prompt S0 in [`SUBSCRIPTIONS_BUILD_PROMPTS.md`](SUBSCRIPTIONS_BUILD_PROMPTS.md) puts
> them to a human before any behaviour changes.
>
> Abbreviations: **E4** = `supabase/migrations/00000004_enums_domains.sql` · **T17** =
> `…/00000017_tables_finance.sql` · **F1140** = `…/00001140_functions_projects_automation_workload.sql` ·
> **F1210** = `…/00001210_functions_finance_kyc_wallet.sql` · **F1220** =
> `…/00001220_functions_finance_billing_entitlements.sql` · **F1020** =
> `…/00001020_functions_org_entities.sql` · **P2016** = `…/00002016_policies_analytics_standing_billing.sql` ·
> **S5001** = `…/00005001_seed_platform_params.sql` · **S5030** =
> `…/00005030_seed_billing_plans_entitlements.sql` · **S5050** = `…/00005050_seed_reference_data.sql` ·
> **svc/** = `packages/backend/services/finance/` · **FM** = `business/finance-model.md`.

## 0. Premise corrections

The brief that commissioned this audit carried assumptions the code and the canonical docs already
contradict. They are corrected here so the plan below does not re-open settled ground.

| Brief assumed | Actual (source) |
| :-- | :-- |
| `PRODUCT_SPEC.md` §D.5 defines the `SiteHeader` megamenu | The spec has no §D. The guest shell, `SiteHeader` and the four discovery megamenus are `DESIGN_SYSTEM.md` Part D (four navigation profiles, the `GuestShell` contract). Menu data is `apps/web/features/marketing/core/megamenu-data.ts`. |
| "Two payment planes: Individual, Team / Agency, Business / Enterprise" | There are **two planes** — personal (the user) and entity (each team, business or enterprise) — `PRODUCT_SPEC.md` §7 "Two payment planes", FM §1.3. The **three** groups the brief lists are *audiences* (`finance.plan_audience`: individual · team · business · enterprise, E4:45). `/pricing` therefore shows three audience tabs over two planes; it does not invent a third plane. |
| `/pricing` is missing from the topology | True for the route. The handle is already reserved (`packages/types/profile/reserved.ts:42`), so `/pricing` cannot be claimed by a profile. The only "Pricing" link today is mobile-drawer-only and points at `/help` (`megamenu-data.ts:213-216`); `flows/PUBLIC_ROUTES.md:883` already orders it fixed. The landing page's pricing section (PUBLIC_ROUTES L4) shows the 5% fee only. |
| The entitlement resolver fails open everywhere and route controllers call `fn_effective_limit` | Only three switches are fail-open: `proposal_allowance_enforced`, `footprint_caps_enforced`, `storage_quota_enforced`, all `'false'` (S5001:154, :156, :186). **`business_plan_gates_enforced` is `'true'`** (S5001:207, and a missing row reads as on, F1220:757-761). **Split templates are always enforced** (Decision #234, F1210:2401-2403). No TypeScript calls `fn_effective_limit` or `fn_has_entitlement`; the app reads `get_proposal_allowance` and `get_storage_quota` only. Plan-gate refusals are `PK402` → HTTP **402**, never 403. |
| Agencies could "monopolise marketplace tickets" | Tickets are not a public pool. Only freelancers hired onto a stage see its `Ready` backlog (`PRODUCT_SPEC.md` §Resource Allocation 1), and the caps bite per person at claim or assignment (`projects.check_ticket_capacity`, F1140:192). Agencies compete for **seats**, through proposals and discovery. Fairness at agency scale is therefore a question about the proposal pool and the ranking, not about the ticket board (§2.2). |
| An expired claim returns its ticket to `Ready` | Correct, and more: `projects.fn_release_expired_claims` (F1140:605-614, `claim_ttl_minutes` 1440, S5001:10) returns it to the backlog **and refunds the claim's escrow to the client in full**; the parker earns nothing (`PRODUCT_SPEC.md` §Resource Allocation 1). |
| The SVG chart tier (`d3-scale`, `d3-shape`) must be defined | Already defined by Decision #1 (tiered: D3 SVG → Canvas2D → WebGL) and #217 (m). `d3-scale`/`d3-shape` are imported **only** by `packages/ui/display/charts/geometry.ts:1-2`; features consume `AreaChart`, `Sparkline`, `StatTile`, `FunnelChart`, `HeatmapGrid`. Feature code importing D3 would breach the "no UI-lib deps" gate. |
| `/teams/:teamHandle/finance` and `/wallet/analytics?w=team:{id}` are new surfaces | Both exist: the `finance` module (the Team Vault) of `module-registry.tsx:277-290` through `routes/(dashboard)/teams/[teamHandle]/[module].tsx`, and `routes/(dashboard)/wallet/analytics.tsx` with `?w=` parsed by `wallet-model.ts:43-51`. There is **no team billing or plan module**. |
| `team_enterprise` slots into the existing Enterprise tier | "Enterprise" is a **buyer entity kind** since Decision #231 (`org.enterprises`, plans `enterprise_free` / `enterprise`). A seller-side agency tier is new. The schema can hold it without an enum change (`audience='team'`, `tier='enterprise'`, E4:47), but the *name* collides — flag #252 (a). |
| "Unlimited seats" needs an `agency_seats` key | `team_seats` already exists (E4:58-102) and `plan_entitlements.is_unlimited` expresses "unlimited". A second seat key would split one lever across two names. |
| "Dedicated proposal pools" are new | Pro Team already has a dedicated pool (`weekly_proposals` on the team subject, 150/wk, FM §16.1). The agency question is how large, and whether it scales with seats (§2.2). |
| Multi-tier holding (Master Vault → Department → Squad) extends `finance.split_rules` | `split_rules` has no parent or nesting column and allows one active rule per team (`uq_split_rules_team_active`, `00004005`:72; T17:483-493). Teams have **no departments** — departments are a business/enterprise lever. Nesting is a new money model, not a template (§2.4, flag #252 (d)). |
| Jira / ClickUp importers mount external assets through the storage broker | The `integrations` schema is a generic connector substrate (`database/integrations/Tables.md`); there are no Jira/ClickUp providers, and mounted files today come from cloud drives only. No `PRODUCT_SPEC.md` entry describes an importer. Flag #252 (g). |
| `/api/finance/plans` and a plan checkout exist to extend | Neither exists. `PlanBackendService.current` (svc/`PlanBackendService.ts`:69) is the only plan service and is "read-only by design: there is no plan checkout yet" (:17). There is no Stripe Billing integration: no price, subscription or Checkout Session, and no `customer.subscription.*` webhook (`stripe-rails.ts`, `stripe-webhook.ts`, F1230). |

---

## 1. Ledger & Schema Invariants

Legend: ✅ compliant · ⚠️ partial / drift · ❌ missing · 📄 doc conflict

### 1.1 The catalogue and the Additive Rule (`SYSTEM_ARCHITECTURE.md` §1, root `CLAUDE.md` §1)

| # | Check | Implementation | Status |
| :-- | :-- | :-- | :-- |
| L1 | `finance.plans` shape | T17:269-287: `code` UNIQUE, `audience`, `tier`, `price_cents`, `currency char(3) DEFAULT 'GBP'`, `billing_interval`, `is_custom_priced`, `per_seat_cents`, `is_default`, `is_public`, `sort_order`, `provider DEFAULT 'stripe'`, `provider_price_ref`, `pricing_note`. | ✅ |
| L2 | Prices stored in one base currency, never converted at rest | Every seeded row is GBP (S5030:5-23); `PLATFORM_BASE_CURRENCY = "GBP"` (`packages/types/finance/fx.ts:34`). | ✅ |
| L3 | Annual billing | `billing_interval` has `annual` (E4:49) but **no annual plan row exists**, and `code` is UNIQUE, so an annual price needs either a second row per plan or a child price table. `/pricing?cycle=annual` has nothing to read. | ❌ → #252 (b) |
| L4 | Provider price reference | `provider_price_ref` is never seeded or written. Nothing maps a plan to a Stripe Price. | ❌ |
| L5 | Unset prices | `business_pro.price_cents` is `NULL` ("PRICE TBD", S5030); `enterprise` is `is_custom_priced`, interval `custom`. FM §1.3 flags Business Pro. A public page cannot list a price that does not exist. | 📄 → #252 (b) |
| L6 | `finance.subscriptions` extended additively | Legacy `profile_id` / `plan` / `status` kept and mirrored by `trg_sync_legacy_subscription_columns` (`00001830`:18-21 → F1220:6-22); one live subscription per subject (partial UNIQUE). | ✅ |
| L7 | `subscription_events` audit trail | T17:692-706, `event_type` started · upgraded · downgraded · renewed · payment_failed · paused · resumed · cancelled · expired. No writer exists (no checkout). | ⚠️ (no writer) |
| L8 | `plan_entitlements` | T17:675-690, `(plan_id, entitlement_key)` UNIQUE, `kind` limit/flag, `scaling` none/standing_base/standing_bonus, `multiplier_bp` default 10000. | ✅ |
| L9 | `entitlement_key` ↔ Zod parity | 31 values in E4:58-102; `packages/types/finance/entitlements.ts:25-67` matches exactly. | ✅ |
| L10 | `allowance_periods` | T17:748-764, UNIQUE `(subject_type, subject_id, entitlement_key, period_start)`; `allowance_ledger` append-only (T17:766-777). | ✅ |
| L11 | Grants only raise | `fn_effective_limit` takes `GREATEST(base, grant)` (F1220:122-180). | ✅ |
| L12 | Nothing writes Standing | No plan table writes `org.entity_standing` (Tables.md §7 invariant; verified by grep). | ✅ |
| L13 | RLS | "Read public plans" (`is_public OR is_admin`) and "Read plan entitlements" (`true`) are both `TO authenticated` (P2016:55-59); `GRANT SELECT … TO authenticated` only (`00002520`:561). **A guest cannot read the catalogue**, so a guest `/pricing` has no data source. Fix: a `SECURITY DEFINER` read `finance.get_public_plan_catalogue()` granted to `anon` + `authenticated`, returning public plans and their entitlements only — not a broad `anon` table grant. | ❌ |

### 1.2 Subscription state ⇄ entitlement drift

| # | Check | Implementation | Status |
| :-- | :-- | :-- | :-- |
| L14 | Which states hold a plan | SQL `fn_active_plan` (F1220:67-88): `trialing · active · past_due` with `current_period_end > now`. TS `PlanBackendService` `HELD_STATES` (:47) adds **`paused`**. The settings page can therefore show a plan the database no longer honours. | ❌ → #252 (m) |
| L15 | Grace period | `subscription_grace_days = 7` is seeded (S5001:162) and **read by nothing**; `fn_active_plan` checks the period end only. | ⚠️ → #252 (m) |
| L16 | Lifecycle documented | `PRODUCT_MANAGEMENT.md:232` lists the subscription lifecycle; it says nothing about which states keep entitlements. | 📄 → #252 (m) |
| L17 | No unentitled state | `fn_active_plan` falls back to the audience's `is_default` plan ("there is no unentitled state"). | ✅ |

### 1.3 Expanding the ladder for an agency tier

The proposed tier fits the existing schema with **seed rows and enum values edited in place** — no
table or column change — provided the levers reuse existing keys:

| Brief's lever | Existing key that already expresses it | New key needed? |
| :-- | :-- | :-- |
| Unlimited seats (`agency_seats`) | `team_seats` with `is_unlimited = true` | **No** — reuse. |
| Dedicated proposal pool | `weekly_proposals` + `proposal_buffer_per_10h` on the team subject | No — a larger *finite* value (§2.2). |
| Custom audit retention | `audit_log_retention_days` (Enterprise has 730) | No — seed it on the agency plan. |
| Team public projects | `team_public_projects` | No. |
| Storage | `storage_megabytes` (MiB, never bytes) | No. |
| ERP / treasury export (`custom_treasury_export`) | — | **Yes** — a `flag`. |
| Hierarchical vaults (`nested_split_rules`) | — | Only after #252 (d) defines the money model. A flag with nothing behind it would breach gate §3.11. |
| Promoted placement, analytics | `promoted_placement`, `advanced_analytics` | No. |

`analytics.event_catalogue` needs no new event: `entitlement.denied`, `subscription.started` /
`changed` / `cancelled` are registered (S5050:46).

---

## 2. Monetisation & Fairness Invariants for an Agency Tier

### 2.1 The two never-monetised axes stay out of reach

| # | Invariant | Where it is held | Agency-tier risk | Status |
| :-- | :-- | :-- | :-- | :-- |
| M1 | Execution capacity is never sold | `check_ticket_capacity` sums $W_i$ per **person** (`max_workload_intensity`, falling back to `global_workload_cap_default` 10.00, S5001:40). No entitlement key reads it. | A plan lever such as "higher workload caps for agencies" would break §7. The audit finds none proposed; S1 must not add one. | ✅ |
| M2 | Standing is never sold | `fn_effective_limit` reads the rung to *scale* a limit (F1220:98, :122-180) but nothing writes the rung. | `discovery_boost` is an entitlement key (E4) that Pro holds unread (Decision #178 (a)). Seeding it on an agency plan would make ranking purchasable. | ⚠️ → S1 must not seed `discovery_boost` on agency |
| M3 | Proposals are never sold à la carte and every tier has a ceiling | `PRODUCT_SPEC.md` §7 Proposal allowances; FM §16.2. | "Unlimited" is the natural agency ask. It is forbidden. | → #252 (c) |
| M4 | The 5% fee flexes only by contract | `finance.negotiated_rates`, `subject_type` business/enterprise only (T17:730-744). | An agency tier that discounts the fee would be the "silent side effect of upgrading" FM §16.4 forbids. Agencies (teams) are not even a `negotiated_rates` subject. | ✅ (keep) |

### 2.2 How a 200-person agency is held to the same field as a solo practitioner

1. **Per-person capacity, not per-entity.** A team's members each carry their own $W_i$ against
   their own Global Soft Cap; a 200-seat agency holding 200 seats on 200 stages still has every
   member capped individually. Seating adds no $W_i$ (Decision #214); claiming does.
2. **Claim TTL.** A ticket claimed and not started returns to the backlog after 24 h with its
   escrow refunded and nothing earned — an agency cannot park tickets on idle members.
3. **The proposal pool is the real lever.** A team applies from **one pool**, spent by members who
   may commit it to work (`bind_seat`). If the agency pool scaled with seats, a 200-seat agency
   would out-apply 200 solos on every posting — the exact crowding the allowance exists to stop.
   **Rule for S1:** the agency pool is a fixed, finite ceiling per team (a dial, fitted against
   `allowance.*` events), never `seats × n`, never unlimited. #252 (c).
4. **Discovery.** Ranking uses workload against the Global Intensity Cap, the newcomer Discovery
   Boost and Standing's weight (FM §16.7); none is purchasable. The team search row carries the live
   members' $W_i$ (Decision #235), so a fully loaded agency ranks as unavailable.
5. **Footprint, not reach.** Agency money buys seats, public projects, storage and tools — all
   footprint — which `PRODUCT_SPEC.md` §7 permits.

### 2.3 The payout-ready gate at roster scale (Decision #196)

| # | Door | Gate | Status |
| :-- | :-- | :-- | :-- |
| G1 | Create a team | `fn_assert_payout_ready('freelancer')` (F1020:1129) | ✅ |
| G2 | Accept an invitation (join) | Same, in `respond_to_workspace_invitation` (F1020:1771) | ✅ |
| G3 | Ownership transfer | Same, on the successor (F1020:2320) | ✅ |
| G4 | Invite a member | **Not checked** — an owner can invite 200 unverified people; each is refused only on accept. TEAMS_AUDIT F4 / #196 (b) still open. | ⚠️ |
| G5 | Team seated on a stage | "seated only when everyone with a share of its earnings is payout-ready" (`PRODUCT_SPEC.md` §5) | ✅ (spec) |
| G6 | The predicate | `finance.fn_freelancer_payout_ready` = `kyc_status = 'verified' AND payout_ready` (F1210:17-28) | ✅ |

The gate already prevents anonymous pooled labour: nobody unverified can hold a seat or a share. At
agency scale the gap is **feedback**, not integrity — the owner learns of an unverified invitee only
when the invitee is refused. Recommendation (no ruling needed): the agency roster shows each
invitee's readiness, and invite answers the count of not-yet-ready invitees inline.

### 2.4 Treasury governance — what "nested split rules" would actually require

Today one active `split_rules` row per team decides vault cut → finder → stakes
(`fn_team_split_plan`, `00001200`:106), with dust kept by the vault (#228 (F)). A Master Vault →
Department reserve → Squad contribution chain needs, at minimum: a sub-entity a share can be
addressed to (teams have no departments or squads), a rule per sub-entity, an ordering guarantee so
the plan stays deterministic, and a property test that the sum of every leaf equals the release.
That is a new money model under escrow release — the most guarded code path on the platform — and
`PRODUCT_SPEC.md` has no entry for it. **Recommendation:** do not sell it in the first agency tier;
specify it first (#252 (d)). Until then the agency tier's treasury tools are export and analytics.

### 2.5 Agency ingestion (importers and mounted assets)

| Piece | Exists? | Gap |
| :-- | :-- | :-- |
| Blueprint import into stages | `marketplace.service_blueprints` / stage templates exist for listings | No importer, no mapping of an external board onto stages → tickets. |
| Jira / ClickUp providers | No | Seed rows + adapters in `integrations.providers` (no schema change by design). |
| Read-only mounting of external files | Yes for cloud drives (`/files`, `PRODUCT_SPEC.md` §Assets: mounted files never count against storage) | An issue tracker's attachments are not a drive; mounting them is a new provider type. |

The brief's "zero transfer friction" claim needs a spec entry before any build — #252 (g).
The build prompts list it as a roadmap phase with a 🧑 DECISION stop, not as buildable work.

---

## 3. Entitlement Resolver & the Fail-Open Gate

### 3.1 Switch inventory

| Switch (`security.platform_params`) | Seed | Read by | Behaviour when off |
| :-- | :-- | :-- | :-- |
| `proposal_allowance_enforced` | `false` (S5001:154) | F1140:711-716; `resolveProposalAllowance` | Meter, emit `entitlement.denied`, refuse nothing |
| `footprint_caps_enforced` | `false` (S5001:156) | `projects.fn_check_public_project_footprint` (F1140:760-825, read :806-812) | Meter, emit, refuse nothing |
| `storage_quota_enforced` | `false` (S5001:186) | `files.fn_check_storage_quota` | Warn, refuse nothing |
| `business_plan_gates_enforced` | **`true`** (S5001:207) | `fn_business_plan_gates_enforced` (F1220:750) | Off: nothing refused |
| *(none)* — split templates | always on | `save_split_rule` (F1210:2401) | — |

### 3.2 Controller thinness and emission

| # | Check | Implementation | Status |
| :-- | :-- | :-- | :-- |
| R1 | Routes stay thin; no route computes a limit | No route reads entitlements directly; allowance and storage reads go through services (`proposal-allowance.ts:62-63`, `live-library.ts:347`). | ✅ |
| R2 | Emission happens in the app layer when the database refuses | A `RAISE` rolls back the event (F1220:32-46); `record_proposal_denial` (F1220:563, emit :592-598) is the app-layer door for proposals. Footprint emission sits inside the trigger (F1140:798-804) and survives only while fail-open. | ⚠️ — once `footprint_caps_enforced` flips, footprint denials stop being recorded unless an app-layer door like `record_proposal_denial` exists for them. |
| R3 | Refusal status | Plan gates answer `PK402` → 402 (`PLAN_GATE_SQLSTATE`, `packages/types/finance/plan-gate.ts:14`). No path answers 403 for a plan reason. | ✅ |
| R4 | A failed gate *read* lets the action through | Proposal pre-flight: yes (`SYSTEM_ARCHITECTURE.md` §Proposals). | ✅ |
| R5 | `/pricing` must never gate | The page is a read; it may show "your plan" for a signed-in viewer but never refuses. | (new — S2) |
| R6 | New agency levers' enforcement family | Not decided. Footprint caps belong in the fail-open family; tool flags (`custom_treasury_export`) are either always-on like split templates or behind the business gates switch. | → #252 (h) |

---

## 4. `/pricing` — the contract this audit proposes

### 4.1 Route, shells and slots

- **File:** `apps/web/routes/(public)/pricing.tsx` re-exporting
  `apps/web/features/pricing/routes/PricingScreen.tsx` (root `CLAUDE.md` §4). Guest → `GuestShell`;
  signed-in → `UserShell` (the `(public)/_layout.tsx` branch already does this — no layout change
  beyond two resolver calls).
- **`pricingHeaderFor(url, authed)`** — a member of the `laneFor` / `viewHeaderFor` /
  `checkoutChromeFor` family (`DESIGN_SYSTEM.md` §D.7.5): pure, synchronous, `null` for every URL
  but `/pricing`. It returns the **plane switcher band**: the audience `TabMenu` (Individual ·
  Team / Agency · Business / Enterprise) and the cycle `SelectButton` (Monthly · Annual, hidden until an
  annual price exists). It carries **no figure and no purchase control**, so the band is never a
  second transaction region.
- **`pricingLaneFor`** — **not built.** `/pricing` is lane-less like `/` and `/explore` State A; a
  lane would be a third column holding a plan purchase beside the body's (§3.10's "moved, never
  duplicated"). The `(public)` layout's lane chain is unchanged. #252 (e).
- **Not an entity view.** The conversion-lane gate (§3.10) governs `/view/*`; on `/pricing` the
  transaction is the plan's commit button, which hands off to the checkout (§4.4).

### 4.2 Query contract

| Param | Values | Default | Rule |
| :-- | :-- | :-- | :-- |
| `plane` | `individual` · `team` · `business` | The acting context's audience (team context → `team`; business or enterprise → `business`); guest → `individual` | Unknown → default, dropped from the address by `replaceState`. |
| `cycle` | `monthly` · `annual` | `monthly` | `annual` resolves only when the audience has annual prices (L3); otherwise dropped. |
| `target` | a public `PlanCode` | none | Emphasises one plan and **implies its plane** (`team_pro` → `team`); an unknown or non-public code is dropped. Never selects or charges anything. |

Parsed by one Zod `PricingQuerySchema` (`@projective/types/finance`); the canonical link is
`/pricing` with no query (SEO). Contextual upgrade links (the allowance meter today links to
`/settings/billing`, `AllowanceMeter.tsx:43-48`) become `/pricing?target=<next plan>` built by one
helper, `pricingHref(target, cycle?)`.

### 4.3 Currency presentation

Figures are `finance.plans.price_cents` in GBP, rendered through `MoneyView` with the GBP origin.
The request's display currency comes from the `AsyncLocalStorage` scope (`currency-context.ts`:
JWT claim → `pj.currency` cookie → GBP), so the first SSR byte is already in the viewer's currency
and the server-rendered `[data-money]` nodes are re-projected in place by the shared sweep when the
currency changes (`currency-state.ts:96`). The stored base is never mutated; conversion is always
from the origin. Because the subscription is **charged in GBP**, every price shows the dual-currency
disclosure `MoneyView` already renders (`£29.00 (~€33.40 EUR)`) and the commit step states the
amount charged (`PRODUCT_SPEC.md` §6, line 1339's rule for checkout).

**Existing defect:** `PlanBlock.tsx:23` (`/settings/billing#plan`) formats with `formatMoney`, not
`MoneyView`, so plan prices are never converted — a breach of "`MoneyView` is the only component
permitted to render money" (`PRODUCT_SPEC.md:411`).

### 4.4 The commit path

There is nothing to hand off to: no plan checkout, no Stripe Price, no subscription webhook (§0).
Whether a plan is bought through **Stripe Billing** (recurring card charge, the platform's own
revenue) or debited from the **wallet** is a product decision with a trust consequence — the wallet
holds client money bound for escrow, and FM §16.6 argues against platform-initiated wallet debits.
Recommendation: Stripe Billing Checkout, card-only, with `customer.subscription.*` webhooks writing
`finance.subscriptions` and `subscription_events`. #252 (f).

---

## 5. Design System & BEM Compliance (proposed surface + existing plan UI)

| # | Gate | Requirement for `/pricing` | Existing drift |
| :-- | :-- | :-- | :-- |
| D1 | Anti-card §B.9.2 / §3.6 | Plan columns are **unboxed** columns on `--bg`, separated by spacing and one hairline; the emphasised (`target` or recommended) plan takes a **solid** `--surface-1` region tone, never a nested card or an elevated panel. The comparison matrix is the `DataTable` (Decision #224), not cards. | — |
| D2 | Anti-tag §B.11 / §3.7 | Limits ("15 seats · 500 GiB · 150 proposals a week") are inline `--text-secondary` middot text (`MetaLine`). The only container on a plan is its commit button. "Most popular" is not a Tag — it is a sentence in the meta register, or nothing. Included/not-included cells are icons with text alternatives, never chips. | — |
| D3 | Hierarchy §3.8 | Four registers: plan name (section header), price (display, `tabular-nums`), limits (body), footnotes (meta). Headings `--fw-medium`; the price never bolder than `--fw-semibold`. | — |
| D4 | Button matrix §B.8 | One filled button per plan column at most; tier-3 `<Button>` for "Choose Pro"; "Talk to us" (custom-priced) is tier-4 outlined; the current plan shows text ("Your plan"), not a disabled button (§3.11). | `PlanBlock` renders no action at all ("Changing plans isn't available yet", :108-110) — correct today. |
| D5 | Contrast §3.12 | Text ≥ 4.5:1, non-text (hairlines that carry meaning, the included/excluded icons) ≥ 3:1 in all four mode × contrast states. Do **not** put small text on a solid `--success` / `--warning` / `--danger` / `--info` fill: four `--on-<role>` pairs measure ~3.17:1 in light mode (decisions README, #76). | — |
| D6 | Glass §3.9 | No `backdrop-filter` on the pricing body or over any chart; the only glass is the shell's own header and the mobile drawer. | — |
| D7 | Press §3.12 / §B.12 | `transform: scale()` only, removed under both reduced-motion channels. | — |
| D8 | Responsive §3.3 | Desktop: plans side by side, matrix below. Tablet: plans in two columns. Below `--bp-md`: one plan per row, the matrix collapses to per-plan accordions (`<details>`), the switcher band stays pinned under the header. Container queries where the frame narrows the canvas (`@container`, memory: laned surfaces). | — |
| D9 | Overlays §B.10.9 | Analytics "enlarge" replaces in place or hands off to a query-filtered page (`/wallet/analytics?w=team:{id}`); never a second scrim over a first. FINANCE_AUDIT §4.4's single-`Dialog` proposal is the pattern. | — |
| D10 | Roster §3.5 | Every new component (`PlanColumn`, `PlanMatrix`, `PlaneSwitcher`) lands in `DESIGN_SYSTEM.md` §C.1. | — |
| D11 | Money rendering | `MoneyView` only (§4.3). | `PlanBlock.tsx:23` ❌ |

---

## 6. Analytics surfaces for agency finance

| Need | Existing surface | Gap |
| :-- | :-- | :-- |
| Team cash flow | `/wallet/analytics?w=team:{id}` (`AnalyticsView`, `FlowAreaChart` → `AreaChart`) | None structural. |
| Squad allocation distribution | — | Depends on #252 (d); with one split rule it is the existing stake split (`SplitBar`). |
| Escrow burn-down | Project finance and stage burn on `/projects` | No team-wide burn-down series; a `StatTile` + `AreaChart` over escrow held per week is enough at SVG density. |
| Treasury export | Ledger CSV on `/wallet/transactions` | ERP formats are the `custom_treasury_export` flag's job. |

Chart rule for every prompt: consume `@projective/ui/display/charts`; never import D3 in a feature;
escalate SVG → Canvas2D by density per Decision #1 / §C.5.

---

## 7. Prioritised backlog

| Priority | Item | Kind |
| :-- | :-- | :-- |
| P0 | #252 rulings (a)–(m) | Human |
| P0 | L14/L15 held-state + grace drift | DB + service |
| P0 | `PlanBlock` → `MoneyView` (D11) | UI |
| P1 | Public plan read + `/api/finance/plans` + `PricingBackendService` | Service |
| P1 | `/pricing` route, switcher band, columns, matrix | UI |
| P1 | Megamenu/footer "Pricing" → `/pricing`; upgrade links via `pricingHref` | UI |
| P1 | Pricing Dev Context Switcher axis (`pricingViewer`: guest · free · pro · team_pro · agency) | Devtools |
| P2 | Stripe Billing checkout + webhook → `subscriptions` (after #252 (f)) | Service + DB |
| P2 | Agency plan seed + `custom_treasury_export` (after #252 (a)–(c), (h)) | DB |
| P2 | Invite-time payout readiness feedback (G4) | DB + UI |
| P3 | Nested treasury, importers (after #252 (d), (g) and spec entries) | Roadmap |
| P3 | Playwright pricing suite | Test |
