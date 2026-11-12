# Subscriptions, Agency Scale & Public Pricing Audit (2026-10-17)

> Read-only evaluation of the subscription ladder (`finance.plans` · `plan_entitlements` ·
> `subscriptions` · `allowance_periods`), the entitlement resolver and its fail-open switches, the
> agency-fairness mechanics, and the proposed public `/pricing` surface, against `PRODUCT_SPEC.md`,
> `finance-model.md` §1.3 / §16, `SYSTEM_ARCHITECTURE.md`, `ROUTING.md`, `DESIGN_SYSTEM.md` and
> `database/finance/Tables.md`. No code or migration was changed by this audit. The new
> contradictions and open product questions it found are logged as **Decision #252** (flags
> (a)–(m)); prompt S0 in [`SUBSCRIPTIONS_BUILD_PROMPTS.md`](SUBSCRIPTIONS_BUILD_PROMPTS.md) put them
> to a human before any behaviour changed.
>
> **Status annotated 2026-11-11, re-verified in code 2026-11-12 at `8a3fd595`.** Every finding
> carries a `Status`; `—` means compliant at audit time, nothing to track. The rows re-verified in
> code on 2026-11-12 are L3–L5, L7, L13–L16, M2–M4, R2, R5, R6 and D1–D11, plus the status
> lines in §1.3, §2.2, §2.4, §2.5, §4, §7, and §8 except flag (i). G4, flag (i) and the `—` rows
> keep their 2026-11-11 status, which was derived from the docs. S0 ran on 2026-10-30 (Wave 1.1,
> `94d22e84`): #252's OWNER RULINGS live in
> `reference/decisions/decisions-122-126.md` (index §8 below). No S1–S8 prompt has landed. The
> audit's own "S1" (the agency seed) and "S2" (`/pricing`) read as SBP S2 and S6. Pre-annotation
> text: `git show 08296359:documentation/architecture/SUBSCRIPTIONS_AUDIT.md`.
>
> Abbreviations: **E4** = `supabase/migrations/00000004_enums_domains.sql` · **T17** =
> `…/00000017_tables_finance.sql` · **F1140** =
> `…/00001140_functions_projects_automation_workload.sql` · **F1210** =
> `…/00001210_functions_finance_kyc_wallet.sql` · **F1220** =
> `…/00001220_functions_finance_billing_entitlements.sql` · **F1020** =
> `…/00001020_functions_org_entities.sql` · **P2016** =
> `…/00002016_policies_analytics_standing_billing.sql` · **S5001** =
> `…/00005001_seed_platform_params.sql` · **S5030** =
> `…/00005030_seed_billing_plans_entitlements.sql` · **S5050** =
> `…/00005050_seed_reference_data.sql` · **svc/** = `packages/backend/services/finance/` · **FM** =
> `business/finance-model.md` · **SBP** = `SUBSCRIPTIONS_BUILD_PROMPTS.md` · **FQ** =
> `FOUNDER_QUESTIONNAIRE.md` (Part C: the ruling table) · **FBP** = `FINANCE_BUILD_PROMPTS.md` ·
> **FA / FCA** = `FINANCE_AUDIT.md` · **PMA** = `PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md` · **DL**
> = PMA §9–§12 · **IWA** = `IDENTITY_AND_WORKSPACES_AUDIT.md` · **RED** =
> `PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md` · **MOD** =
> `PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md` §9.

## 0. Premise corrections

The brief that commissioned this audit carried assumptions the code and the canonical docs already
contradict. They are corrected here so the plan below does not re-open settled ground.

| Brief assumed                                                                                  | Actual (source)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| :--------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRODUCT_SPEC.md` §D.5 defines the `SiteHeader` megamenu                                       | The spec has no §D. The guest shell, `SiteHeader` and the four discovery megamenus are `DESIGN_SYSTEM.md` Part D (four navigation profiles, the `GuestShell` contract). Menu data is `apps/web/features/marketing/core/megamenu-data.ts`.                                                                                                                                                                                                                                                                                                          |
| "Two payment planes: Individual, Team / Agency, Business / Enterprise"                         | There are **two planes** — personal (the user) and entity (each team, business or enterprise) — `PRODUCT_SPEC.md` §7 "Two payment planes", FM §1.3. The **three** groups the brief lists are _audiences_ (`finance.plan_audience`: individual · team · business · enterprise, E4:45). `/pricing` therefore shows three audience tabs over two planes; it does not invent a third plane.                                                                                                                                                            |
| `/pricing` is missing from the topology                                                        | True for the route. The handle is already reserved (`packages/types/profile/reserved.ts:42`), so `/pricing` cannot be claimed by a profile. The only "Pricing" link today is mobile-drawer-only and points at `/help` (`megamenu-data.ts:213-216`); `flows/PUBLIC_ROUTES.md:883` already orders it fixed. The landing page's pricing section (PUBLIC_ROUTES L4) shows the 5% fee only.                                                                                                                                                             |
| The entitlement resolver fails open everywhere and route controllers call `fn_effective_limit` | Only three switches are fail-open: `proposal_allowance_enforced`, `footprint_caps_enforced`, `storage_quota_enforced`, all `'false'` (S5001:154, :156, :186). **`business_plan_gates_enforced` is `'true'`** (S5001:207, and a missing row reads as on, F1220:757-761). **Split templates are always enforced** (Decision #234, F1210:2401-2403). No TypeScript calls `fn_effective_limit` or `fn_has_entitlement`; the app reads `get_proposal_allowance` and `get_storage_quota` only. Plan-gate refusals are `PK402` → HTTP **402**, never 403. |
| Agencies could "monopolise marketplace tickets"                                                | Tickets are not a public pool. Only freelancers hired onto a stage see its `Ready` backlog (`PRODUCT_SPEC.md` §Resource Allocation 1), and the caps bite per person at claim or assignment (`projects.check_ticket_capacity`, F1140:192). Agencies compete for **seats**, through proposals and discovery. Fairness at agency scale is therefore a question about the proposal pool and the ranking, not about the ticket board (§2.2).                                                                                                            |
| An expired claim returns its ticket to `Ready`                                                 | Correct, and more: `projects.fn_release_expired_claims` (F1140:605-614, `claim_ttl_minutes` 1440, S5001:10) returns it to the backlog **and refunds the claim's escrow to the client in full**; the parker earns nothing (`PRODUCT_SPEC.md` §Resource Allocation 1). _Status:_ the sweep was not registered when this was written (PMA X7, DL S1); `e18489d4` registered it paused (#338 flag (a)) until PM-WP1 — the sweep is PMA's (DL D1).                                                                                                      |
| The SVG chart tier (`d3-scale`, `d3-shape`) must be defined                                    | Already defined by Decision #1 (tiered: D3 SVG → Canvas2D → WebGL) and #217 (m). `d3-scale`/`d3-shape` are imported **only** by `packages/ui/display/charts/geometry.ts:1-2`; features consume `AreaChart`, `Sparkline`, `StatTile`, `FunnelChart`, `HeatmapGrid`. Feature code importing D3 would breach the "no UI-lib deps" gate.                                                                                                                                                                                                               |
| `/teams/:teamHandle/finance` and `/wallet/analytics?w=team:{id}` are new surfaces              | Both exist: the `finance` module (the Team Vault) of `module-registry.tsx:277-290` through `routes/(dashboard)/teams/[teamHandle]/[module].tsx`, and `routes/(dashboard)/wallet/analytics.tsx` with `?w=` parsed by `wallet-model.ts:43-51`. There is **no team billing or plan module**.                                                                                                                                                                                                                                                          |
| `team_enterprise` slots into the existing Enterprise tier                                      | "Enterprise" is a **buyer entity kind** since Decision #231 (`org.enterprises`, plans `enterprise_free` / `enterprise`). A seller-side agency tier is new. The schema can hold it without an enum change (`audience='team'`, `tier='enterprise'`, E4:47), but the _name_ collides — flag #252 (a).                                                                                                                                                                                                                                                 |
| "Unlimited seats" needs an `agency_seats` key                                                  | `team_seats` already exists (E4:58-102) and `plan_entitlements.is_unlimited` expresses "unlimited". A second seat key would split one lever across two names.                                                                                                                                                                                                                                                                                                                                                                                      |
| "Dedicated proposal pools" are new                                                             | Pro Team already has a dedicated pool (`weekly_proposals` on the team subject, 150/wk, FM §16.1). The agency question is how large, and whether it scales with seats (§2.2).                                                                                                                                                                                                                                                                                                                                                                       |
| Multi-tier holding (Master Vault → Department → Squad) extends `finance.split_rules`           | `split_rules` has no parent or nesting column and allows one active rule per team (`uq_split_rules_team_active`, `00004005`:72; T17:483-493). Teams have **no departments** — departments are a business/enterprise lever. Nesting is a new money model, not a template (§2.4, flag #252 (d)).                                                                                                                                                                                                                                                     |
| Jira / ClickUp importers mount external assets through the storage broker                      | The `integrations` schema is a generic connector substrate (`database/integrations/Tables.md`); there are no Jira/ClickUp providers, and mounted files today come from cloud drives only. No `PRODUCT_SPEC.md` entry describes an importer. Flag #252 (g).                                                                                                                                                                                                                                                                                         |
| `/api/finance/plans` and a plan checkout exist to extend                                       | Neither exists. `PlanBackendService.current` (svc/`PlanBackendService.ts`:69) is the only plan service and is "read-only by design: there is no plan checkout yet" (:17). There is no Stripe Billing integration: no price, subscription or Checkout Session, and no `customer.subscription.*` webhook (`stripe-rails.ts`, `stripe-webhook.ts`, F1230).                                                                                                                                                                                            |

---

## 1. Ledger & Schema Invariants

Legend (the `Audit` column, the grade at 2026-10-17): ✅ compliant · ⚠️ partial / drift · ❌ missing
· 📄 doc conflict

### 1.1 The catalogue and the Additive Rule (`SYSTEM_ARCHITECTURE.md` §1, root `CLAUDE.md` §1)

| #   | Check                                                       | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Audit          | Status                                                                                                 |
| :-- | :---------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------- | :----------------------------------------------------------------------------------------------------- |
| L1  | `finance.plans` shape                                       | T17:269-287: `code` UNIQUE, `audience`, `tier`, `price_cents`, `currency char(3) DEFAULT 'GBP'`, `billing_interval`, `is_custom_priced`, `per_seat_cents`, `is_default`, `is_public`, `sort_order`, `provider DEFAULT 'stripe'`, `provider_price_ref`, `pricing_note`.                                                                                                                                                                                                  | ✅             | —                                                                                                      |
| L2  | Prices stored in one base currency, never converted at rest | Every seeded row is GBP (S5030:5-23); `PLATFORM_BASE_CURRENCY = "GBP"` (`packages/types/finance/fx.ts:34`).                                                                                                                                                                                                                                                                                                                                                             | ✅             | —                                                                                                      |
| L3  | Annual billing                                              | `billing_interval` has `annual` (E4:49) but **no annual plan row exists**, and `code` is UNIQUE, so an annual price needs either a second row per plan or a child price table. `/pricing?cycle=annual` has nothing to read.                                                                                                                                                                                                                                             | ❌ → #252 (b)  | Ruled → S2: one `finance.plan_prices` row per plan × interval, annual prices explicit · Open → SBP S2  |
| L4  | Provider price reference                                    | `provider_price_ref` is never seeded or written. Nothing maps a plan to a Stripe Price.                                                                                                                                                                                                                                                                                                                                                                                 | ❌             | Open → SBP S2 (`plan_prices.provider_price_ref`), S4 (the Stripe Price)                                |
| L5  | Unset prices                                                | `business_pro.price_cents` is `NULL` ("PRICE TBD", S5030); `enterprise` is `is_custom_priced`, interval `custom`. FM §1.3 flags Business Pro. A public page cannot list a price that does not exist.                                                                                                                                                                                                                                                                    | 📄 → #252 (b)  | Ruled → S2: Business Pro priced (FM §16.1); an unpriced plan reads "Price coming soon" · Open → SBP S2 |
| L6  | `finance.subscriptions` extended additively                 | Legacy `profile_id` / `plan` / `status` kept and mirrored by `trg_sync_legacy_subscription_columns` (`00001830`:18-21 → F1220:6-22); one live subscription per subject (partial UNIQUE).                                                                                                                                                                                                                                                                                | ✅             | —                                                                                                      |
| L7  | `subscription_events` audit trail                           | T17:692-706, `event_type` started · upgraded · downgraded · renewed · payment_failed · paused · resumed · cancelled · expired. No writer exists (no checkout).                                                                                                                                                                                                                                                                                                          | ⚠️ (no writer) | Open → SBP S4                                                                                          |
| L8  | `plan_entitlements`                                         | T17:675-690, `(plan_id, entitlement_key)` UNIQUE, `kind` limit/flag, `scaling` none/standing_base/standing_bonus, `multiplier_bp` default 10000.                                                                                                                                                                                                                                                                                                                        | ✅             | —                                                                                                      |
| L9  | `entitlement_key` ↔ Zod parity                              | 31 values in E4:58-102; `packages/types/finance/entitlements.ts:25-67` matches exactly.                                                                                                                                                                                                                                                                                                                                                                                 | ✅             | —                                                                                                      |
| L10 | `allowance_periods`                                         | T17:748-764, UNIQUE `(subject_type, subject_id, entitlement_key, period_start)`; `allowance_ledger` append-only (T17:766-777).                                                                                                                                                                                                                                                                                                                                          | ✅             | —                                                                                                      |
| L11 | Grants only raise                                           | `fn_effective_limit` takes `GREATEST(base, grant)` (F1220:122-180).                                                                                                                                                                                                                                                                                                                                                                                                     | ✅             | —                                                                                                      |
| L12 | Nothing writes Standing                                     | No plan table writes `org.entity_standing` (Tables.md §7 invariant; verified by grep).                                                                                                                                                                                                                                                                                                                                                                                  | ✅             | —                                                                                                      |
| L13 | RLS                                                         | "Read public plans" (`is_public OR is_admin`) and "Read plan entitlements" (`true`) are both `TO authenticated` (P2016:55-59); `GRANT SELECT … TO authenticated` only (`00002520`:561). **A guest cannot read the catalogue**, so a guest `/pricing` has no data source. Fix: a `SECURITY DEFINER` read `finance.get_public_plan_catalogue()` granted to `anon` + `authenticated`, returning public plans and their entitlements only — not a broad `anon` table grant. | ❌             | Open → SBP S1                                                                                          |

### 1.2 Subscription state ⇄ entitlement drift

| #   | Check                    | Implementation                                                                                                                                                                                                                                 | Audit         | Status                                                                                                  |
| :-- | :----------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------ | :------------------------------------------------------------------------------------------------------ |
| L14 | Which states hold a plan | SQL `fn_active_plan` (F1220:67-88): `trialing · active · past_due` with `current_period_end > now`. TS `PlanBackendService` `HELD_STATES` (:47) adds **`paused`**. The settings page can therefore show a plan the database no longer honours. | ❌ → #252 (m) | Ruled → S6: trialing · active, plus past_due inside the 7 grace days; paused falls back · Open → SBP S1 |
| L15 | Grace period             | `subscription_grace_days = 7` is seeded (S5001:162) and **read by nothing**; `fn_active_plan` checks the period end only.                                                                                                                      | ⚠️ → #252 (m) | Ruled → S6 · Open → SBP S1                                                                              |
| L16 | Lifecycle documented     | `PRODUCT_MANAGEMENT.md:232` lists the subscription lifecycle; it says nothing about which states keep entitlements.                                                                                                                            | 📄 → #252 (m) | Fixed (S0, `94d22e84`): PRODUCT_MANAGEMENT records the ruled set                                        |
| L17 | No unentitled state      | `fn_active_plan` falls back to the audience's `is_default` plan ("there is no unentitled state").                                                                                                                                              | ✅            | —                                                                                                       |

### 1.3 Expanding the ladder for an agency tier

The proposed tier fits the existing schema with **seed rows and enum values edited in place** — no
table or column change — provided the levers reuse existing keys:

| Brief's lever                                    | Existing key that already expresses it                             | New key needed?                                                                                     |
| :----------------------------------------------- | :----------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| Unlimited seats (`agency_seats`)                 | `team_seats` with `is_unlimited = true`                            | **No** — reuse.                                                                                     |
| Dedicated proposal pool                          | `weekly_proposals` + `proposal_buffer_per_10h` on the team subject | No — a larger _finite_ value (§2.2).                                                                |
| Custom audit retention                           | `audit_log_retention_days` (Enterprise has 730)                    | No — seed it on the agency plan.                                                                    |
| Team public projects                             | `team_public_projects`                                             | No.                                                                                                 |
| Storage                                          | `storage_megabytes` (MiB, never bytes)                             | No.                                                                                                 |
| ERP / treasury export (`custom_treasury_export`) | —                                                                  | **Yes** — a `flag`.                                                                                 |
| Hierarchical vaults (`nested_split_rules`)       | —                                                                  | Only after #252 (d) defines the money model. A flag with nothing behind it would breach gate §3.11. |
| Promoted placement, analytics                    | `promoted_placement`, `advanced_analytics`                         | No.                                                                                                 |

`analytics.event_catalogue` needs no new event: `entitlement.denied`, `subscription.started` /
`changed` / `cancelled` are registered (S5050:46).

**Ruled:** S4 = #252 (h), (j) ⭐ — reuse `team_seats`, `weekly_proposals` and
`audit_log_retention_days`; add only `custom_treasury_export`, a tool flag (402). S3 = (c): the pool
is 300 a week plus `proposal_buffer_per_10h` 18. M10 (c) = (d): no `nested_split_rules` key. 🧑
Agency and Enterprise storage is still open (S2). **Status:** Open → SBP S2.

---

## 2. Monetisation & Fairness Invariants for an Agency Tier

### 2.1 The two never-monetised axes stay out of reach

| #  | Invariant                                                        | Where it is held                                                                                                                                                          | Agency-tier risk                                                                                                                                                   | Audit                                             | Status                                                                                                                                                                                                                                                       |
| :- | :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 | Execution capacity is never sold                                 | `check_ticket_capacity` sums $W_i$ per **person** (`max_workload_intensity`, falling back to `global_workload_cap_default` 10.00, S5001:40). No entitlement key reads it. | A plan lever such as "higher workload caps for agencies" would break §7. The audit finds none proposed; S1 must not add one.                                       | ✅                                                | — (a standing rule on SBP S2)                                                                                                                                                                                                                                |
| M2 | Standing is never sold                                           | `fn_effective_limit` reads the rung to _scale_ a limit (F1220:98, :122-180) but nothing writes the rung.                                                                  | `discovery_boost` is an entitlement key (E4) that Pro holds unread (Decision #178 (a)). Seeding it on an agency plan would make ranking purchasable.               | ⚠️ → S1 must not seed `discovery_boost` on agency | Ruled → #252 (C): an agency tier never carries `discovery_boost` · Open → SBP S2 (seed + `agency_plan.sql` probe)                                                                                                                                            |
| M3 | Proposals are never sold à la carte and every tier has a ceiling | `PRODUCT_SPEC.md` §7 Proposal allowances; FM §16.2.                                                                                                                       | "Unlimited" is the natural agency ask. It is forbidden.                                                                                                            | → #252 (c)                                        | Ruled → S3: 300 a week + 18 per 10 h, Agency only, finite, never seat-scaled · Open → SBP S2                                                                                                                                                                 |
| M4 | The 5% fee flexes only by contract                               | `finance.negotiated_rates`, `subject_type` business/enterprise only (T17:730-744).                                                                                        | An agency tier that discounts the fee would be the "silent side effect of upgrading" FM §16.4 forbids. Agencies (teams) are not even a `negotiated_rates` subject. | ✅ (keep)                                         | Superseded in part: #252's contract-rate flag ruled **B** (2026-10-31) — a team may hold a contract rate (the commission on its own sales; its payer fee when it buys); Fixed (FBP DB11 step 6, `9d15fcd0`). The invariant holds; the fee copy is FCA's (§9) |

### 2.2 How a 200-person agency is held to the same field as a solo practitioner

1. **Per-person capacity, not per-entity.** A team's members each carry their own $W_i$ against
   their own Global Soft Cap; a 200-seat agency holding 200 seats on 200 stages still has every
   member capped individually. Seating adds no $W_i$ (Decision #214); claiming does.
2. **Claim TTL.** A ticket claimed and not started returns to the backlog after 24 h with its escrow
   refunded and nothing earned — an agency cannot park tickets on idle members. _Status:_ this holds
   only once the sweep runs; it is registered paused (`e18489d4`) and PM-WP1 turns it on. The sweep,
   its race and its fix are PMA's (DL D1, X7); this item keeps the agency angle.
3. **The proposal pool is the real lever.** A team applies from **one pool**, spent by members who
   may commit it to work (`bind_seat`). If the agency pool scaled with seats, a 200-seat agency
   would out-apply 200 solos on every posting — the exact crowding the allowance exists to stop.
   **Rule for S1:** the agency pool is a fixed, finite ceiling per team (a dial, fitted against
   `allowance.*` events), never `seats × n`, never unlimited. #252 (c). **Ruled:** S3 = (c), 300 a
   week plus 18 per 10 h. **Status:** Open → SBP S2.
4. **Discovery.** Ranking uses workload against the Global Intensity Cap, the newcomer Discovery
   Boost and Standing's weight (FM §16.7); none is purchasable. The team search row carries the live
   members' $W_i$ (Decision #235), so a fully loaded agency ranks as unavailable.
5. **Footprint, not reach.** Agency money buys seats, public projects, storage and tools — all
   footprint — which `PRODUCT_SPEC.md` §7 permits.

### 2.3 The payout-ready gate at roster scale (Decision #196)

The gate itself (its predicate, its doors and its breadth, FQ M4) is FCA's (FA K1, K2; FCA N12, N14,
D-7). This section keeps only the roster-scale delta.

| #            | Door                                                                                                                   | Gate                                                                                                                               | Audit     | Status                                                                                                      |
| :----------- | :--------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- | :-------- | :---------------------------------------------------------------------------------------------------------- |
| G1 · G2 · G3 | Create a team · accept an invitation (join, `respond_to_workspace_invitation`) · ownership transfer (on the successor) | `fn_assert_payout_ready('freelancer')` (F1020:1129, :1771, :2320) — the org doors of FA K2                                         | ✅        | —                                                                                                           |
| G4           | Invite a member                                                                                                        | **Not checked** — an owner can invite 200 unverified people; each is refused only on accept. TEAMS_AUDIT F4 / #196 (b) still open. | ⚠️        | Ruled → M4 (= #252 (i) = #196 (b)): readiness shown on the roster, refusal stays at accept · Open → FBP SV7 |
| G5           | Team seated on a stage                                                                                                 | "seated only when everyone with a share of its earnings is payout-ready" (`PRODUCT_SPEC.md` §5)                                    | ✅ (spec) | —                                                                                                           |
| G6           | The predicate                                                                                                          | `finance.fn_freelancer_payout_ready` = `kyc_status = 'verified' AND payout_ready` (F1210:17-28) — = FA K1                          | ✅        | —                                                                                                           |

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

**Ruled:** M10 (c) = #252 (d) → ⭐ [1] per-engagement contribution agreements on the single split
rule; no `nested_split_rules` key. **Status:** Open → SBP X1 (specify, do not build). Team money as
a whole (splits, departures, treasury, FQ M10) is FCA's (A19); this section keeps the nested-split
design.

### 2.5 Agency ingestion (importers and mounted assets)

| Piece                                | Exists?                                                                                               | Gap                                                                                   |
| :----------------------------------- | :---------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| Blueprint import into stages         | `marketplace.service_blueprints` / stage templates exist for listings                                 | No importer, no mapping of an external board onto stages → tickets.                   |
| Jira / ClickUp providers             | No                                                                                                    | Seed rows + adapters in `integrations.providers` (no schema change by design).        |
| Read-only mounting of external files | Yes for cloud drives (`/files`, `PRODUCT_SPEC.md` §Assets: mounted files never count against storage) | An issue tracker's attachments are not a drive; mounting them is a new provider type. |

The brief's "zero transfer friction" claim needs a spec entry before any build — #252 (g). The build
prompts list it as a roadmap phase with a 🧑 DECISION stop, not as buildable work.

**Ruled:** S8 = #252 (g) → CSV plus ClickUp first; attachments mounted ⭐. **Status:** Open → SBP X2
(the spec entry before any build).

---

## 3. Entitlement Resolver & the Fail-Open Gate

### 3.1 Switch inventory

| Switch (`security.platform_params`) | Seed                   | Read by                                                                     | Behaviour when off                               |
| :---------------------------------- | :--------------------- | :-------------------------------------------------------------------------- | :----------------------------------------------- |
| `proposal_allowance_enforced`       | `false` (S5001:154)    | F1140:711-716; `resolveProposalAllowance`                                   | Meter, emit `entitlement.denied`, refuse nothing |
| `footprint_caps_enforced`           | `false` (S5001:156)    | `projects.fn_check_public_project_footprint` (F1140:760-825, read :806-812) | Meter, emit, refuse nothing                      |
| `storage_quota_enforced`            | `false` (S5001:186)    | `files.fn_check_storage_quota`                                              | Warn, refuse nothing                             |
| `business_plan_gates_enforced`      | **`true`** (S5001:207) | `fn_business_plan_gates_enforced` (F1220:750)                               | Off: nothing refused                             |
| _(none)_ — split templates          | always on              | `save_split_rule` (F1210:2401)                                              | —                                                |

### 3.2 Controller thinness and emission

| #  | Check                                                       | Implementation                                                                                                                                                                                                                       | Audit                                                                                                                                                    | Status                                                                                                            |
| :- | :---------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| R1 | Routes stay thin; no route computes a limit                 | No route reads entitlements directly; allowance and storage reads go through services (`proposal-allowance.ts:62-63`, `live-library.ts:347`).                                                                                        | ✅                                                                                                                                                       | —                                                                                                                 |
| R2 | Emission happens in the app layer when the database refuses | A `RAISE` rolls back the event (F1220:32-46); `record_proposal_denial` (F1220:563, emit :592-598) is the app-layer door for proposals. Footprint emission sits inside the trigger (F1140:798-804) and survives only while fail-open. | ⚠️ — once `footprint_caps_enforced` flips, footprint denials stop being recorded unless an app-layer door like `record_proposal_denial` exists for them. | Open (no prompt)                                                                                                  |
| R3 | Refusal status                                              | Plan gates answer `PK402` → 402 (`PLAN_GATE_SQLSTATE`, `packages/types/finance/plan-gate.ts:14`). No path answers 403 for a plan reason.                                                                                             | ✅                                                                                                                                                       | —                                                                                                                 |
| R4 | A failed gate _read_ lets the action through                | Proposal pre-flight: yes (`SYSTEM_ARCHITECTURE.md` §Proposals).                                                                                                                                                                      | ✅                                                                                                                                                       | —                                                                                                                 |
| R5 | `/pricing` must never gate                                  | The page is a read; it may show "your plan" for a signed-in viewer but never refuses.                                                                                                                                                | (new — S2)                                                                                                                                               | Open → SBP S6                                                                                                     |
| R6 | New agency levers' enforcement family                       | Not decided. Footprint caps belong in the fail-open family; tool flags (`custom_treasury_export`) are either always-on like split templates or behind the business gates switch.                                                     | → #252 (h)                                                                                                                                               | Ruled → S4: `team_public_projects` stays fail-open; `custom_treasury_export` is a tool flag (402) · Open → SBP S2 |

---

## 4. `/pricing` — the contract this audit proposes

### 4.1 Route, shells and slots

- **File:** `apps/web/routes/(public)/pricing.tsx` re-exporting
  `apps/web/features/pricing/routes/PricingScreen.tsx` (root `CLAUDE.md` §4). Guest → `GuestShell`;
  signed-in → `UserShell` (the `(public)/_layout.tsx` branch already does this — no layout change
  beyond two resolver calls).
- **`pricingHeaderFor(url, authed)`** — a member of the `laneFor` / `viewHeaderFor` /
  `checkoutChromeFor` family (`DESIGN_SYSTEM.md` §D.7.5): pure, synchronous, `null` for every URL
  but `/pricing`. It returns the **plane switcher band**: the audience `TabMenu` (Individual · Team
  / Agency · Business / Enterprise) and the cycle `SelectButton` (Monthly · Annual, hidden until an
  annual price exists). It carries **no figure and no purchase control**, so the band is never a
  second transaction region.
- **`pricingLaneFor`** — **not built.** `/pricing` is lane-less like `/` and `/explore` State A; a
  lane would be a third column holding a plan purchase beside the body's (§3.10's "moved, never
  duplicated"). The `(public)` layout's lane chain is unchanged. #252 (e).
- **Not an entity view.** The conversion-lane gate (§3.10) governs `/view/*`; on `/pricing` the
  transaction is the plan's commit button, which hands off to the checkout (§4.4).

**Ruled:** S1 = #252 (e), (k) ⭐ — `pricingHeaderFor` and no `pricingLaneFor`; tabs "Team / Agency"
and "Business / Enterprise", with Enterprise now a priced column (S2). **Status:** Open → SBP S6.

### 4.2 Query contract

| Param    | Values                             | Default                                                                                                          | Rule                                                                                                                                              |
| :------- | :--------------------------------- | :--------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plane`  | `individual` · `team` · `business` | The acting context's audience (team context → `team`; business or enterprise → `business`); guest → `individual` | Unknown → default, dropped from the address by `replaceState`.                                                                                    |
| `cycle`  | `monthly` · `annual`               | `monthly`                                                                                                        | `annual` resolves only when the audience has annual prices (L3); otherwise dropped.                                                               |
| `target` | a public `PlanCode`                | none                                                                                                             | Emphasises one plan and **implies its plane** (`team_pro` → `team`); an unknown or non-public code is dropped. Never selects or charges anything. |

Parsed by one Zod `PricingQuerySchema` (`@projective/types/finance`); the canonical link is
`/pricing` with no query (SEO). Contextual upgrade links (the allowance meter today links to
`/settings/billing`, `AllowanceMeter.tsx:43-48`) become `/pricing?target=<next plan>` built by one
helper, `pricingHref(target, cycle?)`.

**Status:** Open → SBP S3 (`PricingQuerySchema`, `pricingHref`), S5 (the upgrade links).

### 4.3 Currency presentation

Figures are `finance.plans.price_cents` in GBP, rendered through `MoneyView` with the GBP origin.
The request's display currency comes from the `AsyncLocalStorage` scope (`currency-context.ts`: JWT
claim → `pj.currency` cookie → GBP), so the first SSR byte is already in the viewer's currency and
the server-rendered `[data-money]` nodes are re-projected in place by the shared sweep when the
currency changes (`currency-state.ts:96`). The stored base is never mutated; conversion is always
from the origin. Because the subscription is **charged in GBP**, every price shows the dual-currency
disclosure `MoneyView` already renders (`£29.00 (~€33.40 EUR)`) and the commit step states the
amount charged (`PRODUCT_SPEC.md` §6, line 1339's rule for checkout).

**Existing defect:** `PlanBlock.tsx:23` (`/settings/billing#plan`) formats with `formatMoney`, not
`MoneyView`, so plan prices are never converted — a breach of "`MoneyView` is the only component
permitted to render money" (`PRODUCT_SPEC.md:411`). This is D11 (Open → SBP S5); the `MoneyView`
doctrine itself is RED's (FQ E2).

### 4.4 The commit path

There is nothing to hand off to: no plan checkout, no Stripe Price, no subscription webhook (§0).
Whether a plan is bought through **Stripe Billing** (recurring card charge, the platform's own
revenue) or debited from the **wallet** is a product decision with a trust consequence — the wallet
holds client money bound for escrow, and FM §16.6 argues against platform-initiated wallet debits.
Recommendation: Stripe Billing Checkout, card-only, with `customer.subscription.*` webhooks writing
`finance.subscriptions` and `subscription_events`. #252 (f).

**Ruled:** S5 = #252 (f) → ⭐ Stripe Billing Checkout, card, recurring, never a wallet debit; the
buyers are a team owner (and, by the owner's follow-up, a co-owner) or a business member holding
`manage_billing` (#238); downgrades take effect at period end. **Status:** Open → SBP S4.

---

## 5. Design System & BEM Compliance (proposed surface + existing plan UI)

| #   | Gate                    | Requirement for `/pricing`                                                                                                                                                                                                                                                                                                  | Existing drift                                                                                         | Status                                                                                                                                          |
| :-- | :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Anti-card §B.9.2 / §3.6 | Plan columns are **unboxed** columns on `--bg`, separated by spacing and one hairline; the emphasised (`target` or recommended) plan takes a **solid** `--surface-1` region tone, never a nested card or an elevated panel. The comparison matrix is the `DataTable` (Decision #224), not cards.                            | —                                                                                                      | Open → SBP S6                                                                                                                                   |
| D2  | Anti-tag §B.11 / §3.7   | Limits ("15 seats · 500 GiB · 150 proposals a week") are inline `--text-secondary` middot text (`MetaLine`). The only container on a plan is its commit button. "Most popular" is not a Tag — it is a sentence in the meta register, or nothing. Included/not-included cells are icons with text alternatives, never chips. | —                                                                                                      | Open → SBP S6                                                                                                                                   |
| D3  | Hierarchy §3.8          | Four registers: plan name (section header), price (display, `tabular-nums`), limits (body), footnotes (meta). Headings `--fw-medium`; the price never bolder than `--fw-semibold`.                                                                                                                                          | —                                                                                                      | Open → SBP S6                                                                                                                                   |
| D4  | Button matrix §B.8      | One filled button per plan column at most; tier-3 `<Button>` for "Choose Pro"; "Talk to us" (custom-priced) is tier-4 outlined; the current plan shows text ("Your plan"), not a disabled button (§3.11).                                                                                                                   | `PlanBlock` renders no action at all ("Changing plans isn't available yet", :108-110) — correct today. | Open → SBP S6                                                                                                                                   |
| D5  | Contrast §3.12          | Text ≥ 4.5:1, non-text (hairlines that carry meaning, the included/excluded icons) ≥ 3:1 in all four mode × contrast states. Do **not** put small text on a solid `--success` / `--warning` / `--danger` / `--info` fill: four `--on-<role>` pairs measure ~3.17:1 in light mode (decisions README, #76).                   | —                                                                                                      | Open → SBP S6, S8                                                                                                                               |
| D6  | Glass §3.9              | No `backdrop-filter` on the pricing body or over any chart; the only glass is the shell's own header and the mobile drawer.                                                                                                                                                                                                 | —                                                                                                      | Open → SBP S6                                                                                                                                   |
| D7  | Press §3.12 / §B.12     | `transform: scale()` only, removed under both reduced-motion channels.                                                                                                                                                                                                                                                      | —                                                                                                      | Open → SBP S6, S8                                                                                                                               |
| D8  | Responsive §3.3         | Desktop: plans side by side, matrix below. Tablet: plans in two columns. Below `--bp-md`: one plan per row, the matrix collapses to per-plan accordions (`<details>`), the switcher band stays pinned under the header. Container queries where the frame narrows the canvas (`@container`, memory: laned surfaces).        | —                                                                                                      | Open → SBP S6, S8                                                                                                                               |
| D9  | Overlays §B.10.9        | Analytics "enlarge" replaces in place or hands off to a query-filtered page (`/wallet/analytics?w=team:{id}`); never a second scrim over a first. FINANCE_AUDIT §4.4's single-`Dialog` proposal is the pattern.                                                                                                             | —                                                                                                      | Ruled → E3 FA (h): an optional Expand opens one Dialog, no `/inspect` (the wallet's is FBP UI4) · Open → SBP S6. The overlay inventory is MOD's |
| D10 | Roster §3.5             | Every new component (`PlanColumn`, `PlanMatrix`, `PlaneSwitcher`) lands in `DESIGN_SYSTEM.md` §C.1.                                                                                                                                                                                                                         | —                                                                                                      | Open → SBP S6                                                                                                                                   |
| D11 | Money rendering         | `MoneyView` only (§4.3).                                                                                                                                                                                                                                                                                                    | `PlanBlock.tsx:23` ❌                                                                                  | Open → SBP S5                                                                                                                                   |

---

## 6. Analytics surfaces for agency finance

| Need                          | Existing surface                                                                 | Gap                                                                                                           |
| :---------------------------- | :------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| Team cash flow                | `/wallet/analytics?w=team:{id}` (`AnalyticsView`, `FlowAreaChart` → `AreaChart`) | None structural.                                                                                              |
| Squad allocation distribution | —                                                                                | Depends on #252 (d); with one split rule it is the existing stake split (`SplitBar`).                         |
| Escrow burn-down              | Project finance and stage burn on `/projects`                                    | No team-wide burn-down series; a `StatTile` + `AreaChart` over escrow held per week is enough at SVG density. |
| Treasury export               | Ledger CSV on `/wallet/transactions`                                             | ERP formats are the `custom_treasury_export` flag's job.                                                      |

Chart rule for every prompt: consume `@projective/ui/display/charts`; never import D3 in a feature;
escalate SVG → Canvas2D by density per Decision #1 / §C.5.

**Status:** #252 (d) is ruled (M10 (c) = [1]), so squad allocation stays the stake split. The
team-wide burn-down series is Open (no prompt); the treasury export rides the flag (SBP S2).

---

## 7. Remediation map

The prioritised backlog is restated as prompts in SBP; the audit's own priority is kept. Fix text
stays in the finding rows above.

| ID(s)                                                                                       | Priority | Prompt                | Status                                                                                       |
| :------------------------------------------------------------------------------------------ | :------- | :-------------------- | :------------------------------------------------------------------------------------------- |
| #252 (a)–(m)                                                                                | P0       | SBP S0                | Fixed (S0, Wave 1.1, `94d22e84`); 🧑 Agency and Enterprise storage still open (stops SBP S2) |
| L14, L15, L16                                                                               | P0       | SBP S1                | Open → S1 (L14, L15); L16 Fixed (S0, `94d22e84`)                                             |
| D11                                                                                         | P0       | SBP S5                | Open → S5                                                                                    |
| L13, §4.2, §4.3 (public plan read, `/api/finance/plans`, `PricingBackendService`)           | P1       | SBP S1 (the read), S3 | Open → S1, S3                                                                                |
| §4.1, D1–D10, R5 (`/pricing` route, switcher band, columns, matrix)                         | P1       | SBP S6                | Open → S6                                                                                    |
| §0 row 3 (megamenu / footer "Pricing" → `/pricing`); §4.2 upgrade links via `pricingHref`   | P1       | SBP S7; S5            | Partly fixed (P8, `9d5bc074`; `c82008df` → `/features#pricing`) · Open → S7, S5              |
| Pricing Dev Context Switcher axis (`pricingViewer`: guest · free · pro · team_pro · agency) | P1       | SBP S6                | Open → S6                                                                                    |
| §4.4, L4, L6, L7 (Stripe Billing checkout + webhook → `subscriptions`)                      | P2       | SBP S4                | Open → S4 (ruled S5)                                                                         |
| L3, L5, §1.3, M2, M3, R6 (annual prices; agency plan seed + `custom_treasury_export`)       | P2       | SBP S2                | Open → S2 (ruled S1–S4)                                                                      |
| G4 (invite-time payout readiness feedback)                                                  | P2       | FBP SV7               | Open → FBP SV7 (ruled M4)                                                                    |
| §2.4, §2.5 (nested treasury, importers)                                                     | P3       | SBP X1, X2            | Ruled (M10 (c), S8) · Open → X1, X2 (spec before build)                                      |
| Playwright pricing suite                                                                    | P3       | SBP S8                | Open → S8                                                                                    |
| R2 (app-layer door for footprint denials)                                                   | —        | —                     | Open (no prompt)                                                                             |
| Docs sweep (findings marked fixed, #252 index line)                                         | —        | SBP Z1                | Open → Z1                                                                                    |

---

## 8. Decision #252 flags — status index

The flags, their options and the OWNER RULINGS are the #252 row of
[`../reference/decisions/decisions-122-126.md`](../reference/decisions/decisions-122-126.md); FQ
Part C is the ruling table. This index adds status only.

| Flag          | Topic                                                                           | Ruled (FQ Part C)     | Status                                                        |
| :------------ | :------------------------------------------------------------------------------ | :-------------------- | :------------------------------------------------------------ |
| (a)           | Tier name                                                                       | S1                    | Open → SBP S2                                                 |
| (b)           | Prices and the annual model                                                     | S2                    | Open → SBP S2; 🧑 Agency and Enterprise storage               |
| (c)           | Agency proposal pool                                                            | S3                    | Open → SBP S2                                                 |
| (d)           | Hierarchical treasury                                                           | M10 (c)               | Open → SBP X1                                                 |
| (e)           | Slots                                                                           | S1                    | Open → SBP S6                                                 |
| (f)           | How a plan is paid                                                              | S5                    | Open → SBP S4                                                 |
| (g)           | Agency importers                                                                | S8                    | Open → SBP X2                                                 |
| (h)           | Enforcement family                                                              | S4                    | Open → SBP S2                                                 |
| (i)           | Invite readiness                                                                | M4 (= #196 (b))       | Open → FBP SV7                                                |
| (j)           | Entitlement keys                                                                | S4                    | Open → SBP S2                                                 |
| (k)           | Tab grouping                                                                    | S1                    | Open → SBP S6                                                 |
| (l)           | `/pricing` fee and taper copy                                                   | M1's sub-question     | Open → SBP S6 (`PricingPrinciples`); the fee wording is FCA's |
| (m)           | Which states keep a plan                                                        | S6                    | Open → SBP S1                                                 |
| contract rate | Which fee an Agency's contract rate covers (new conflict with #187, 2026-10-30) | B (owner, 2026-10-31) | Fixed (FBP DB11 step 6, `9d15fcd0`)                           |

---

## 9. Cross-domain pointers

| Topic                                                     | Our IDs                                                      | Owner (full text)                                      |
| :-------------------------------------------------------- | :----------------------------------------------------------- | :----------------------------------------------------- |
| Payout-ready gate scope (FQ M4)                           | §2.3 G1–G6 (the roster-scale delta stays here)               | FCA (FA K1, K2; FCA N12, N14, D-7)                     |
| Claim TTL sweep (FQ Q0.3)                                 | §0 row 6, §2.2 item 2 (the agency-fairness angle stays here) | PMA (DL D1, S1; PMA X7)                                |
| Enterprise SSO and verified domains (FQ S7)               | #252 (b), (j) (the SSO line of the S2 price table)           | IWA §6.6, §10 F5, F6                                   |
| Product-sale commission and the stage-fee wording (FQ M1) | #252 (l) `/pricing` fee copy; M4                             | FCA (N3, X3, X4, D-3)                                  |
| Team money: splits, departures, treasury (FQ M10)         | §2.4, #252 (d) (the nested-split design stays here)          | FCA (A19)                                              |
| Money on screen (FQ E2)                                   | D11, §4.3                                                    | RED (ADC Q16); FCA N10 holds the finance instance list |
| Modal and overlay inventory                               | D9                                                           | MOD                                                    |
