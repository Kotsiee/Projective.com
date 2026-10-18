# Subscriptions Build Prompts — Claude Code Work Orders for `/pricing`, the Plan Ladder and Agency Scale

> **Status: WORK ORDERS, not binding.** A sequenced series of self-contained Claude Code prompts that
> make the subscription ladder sellable: a correct catalogue and entitlement state, a guest-readable
> plan read, the public `/pricing` page, a plan checkout, and an agency tier. Every prompt cites its
> evidence in [`SUBSCRIPTIONS_AUDIT.md`](SUBSCRIPTIONS_AUDIT.md) (finding IDs `L*`, `M*`, `G*`, `R*`,
> `D*`) and Decision #252. Paste each prompt into its **own fresh session**, after the standard
> header (§1).
>
> **Before you start:** merge the change that adds `SUBSCRIPTIONS_AUDIT.md` and this file. Run the
> prompts in the §0 order. A prompt marked **🧑 DECISION** must stop and put the named question to a
> human before it changes behaviour; it presents options with a recommendation. Nothing here
> monetises execution capacity ($W_i$) or Standing — a prompt that would is wrong, whatever it says.

---

## 0. Run order & dependencies

| Phase | Prompts | Why this order |
| :-- | :-- | :-- |
| **0 — Rulings** | S0 | Records the #252 answers so later prompts cite a ruling instead of re-arguing it. |
| **1 — Database & seeds** | S1 → S2 | S1 fixes state drift and adds the public catalogue read (no ruling needed beyond (m)). S2 adds annual prices and the agency tier (needs (a)–(c), (h)). |
| **2 — Services & routes** | S3 → S4 | The read service and `/api/finance/plans` first; the checkout (S4) needs (f) and S3's contract. |
| **3 — UI** | S5 → S6 → S7 | Fix the existing plan UI and the link helper; then the `/pricing` page; then the entry points (megamenu, footer, upgrade links). |
| **4 — Verification** | S8 | Playwright across viewports, currencies and contrast modes. |
| **Roadmap (not buildable yet)** | X1, X2 | Hierarchical treasury and agency importers. Each stops at a 🧑 DECISION and a spec entry. |
| **Last** | Z1 | Docs sweep. |

Prompts that may **not** run in parallel because they edit the same files: S1/S2 (`00001220`,
`00005030`, `entitlements.ts`) · S5/S6 (`features/pricing/`, `PlanBlock.tsx`) · S6/S7
(`megamenu-data.ts`).

---

## 1. Standard header — paste above EVERY prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types the
Zod SSOT @projective/types; packages/backend fat services @server/services/*; supabase/migrations
Postgres with RLS everywhere).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (at least
     documentation/CLAUDE.md, documentation/database/CLAUDE.md when SQL changes, packages/ui/CLAUDE.md
     for UI), then documentation/reference/guardrails.md and documentation/reference/pr-checklist.md.
  2. Read documentation/architecture/SUBSCRIPTIONS_AUDIT.md — the finding IDs cited below — and
     Decision #252 in documentation/reference/decisions/decisions-122-126.md (with its rulings once
     S0 has landed).
  3. Grep documentation/reference/decisions/README.md for the surface you touch and read the
     decision files it names (at minimum #1, #58, #154, #178, #196, #224, #230, #231, #234).
  4. Read finance-model.md §1.3 and §16 and PRODUCT_SPEC.md §Escrow, Wallets & Finance 7
     "Subscriptions, Allowances & Entitlements". The four axes are law: execution capacity and
     Standing are NEVER monetised; proposals are never sold a la carte and every tier has a ceiling;
     the 5% fee flexes only through finance.negotiated_rates.

Hard rules (merge gates — reject your own diff if any fails):
  SSOT & architecture
  - @projective/types/finance (plans.ts, entitlements.ts, plan-gate.ts) is the SSOT. A schema or
    RPC-contract change lands with its Zod schema, the backend mapper, and
    documentation/database/finance/{Tables,Functions,Policies}.md in the SAME change. Business rules
    also update PRODUCT_SPEC.md (abstract) and finance-model.md (numbers); lifecycle changes update
    PRODUCT_MANAGEMENT.md.
  - Migrations are consolidated and EDITED IN PLACE. Never append ALTER TABLE ADD COLUMN / ALTER TYPE
    ADD VALUE patches. Each statement goes in its category file: enums 00000004, finance tables
    00000017, billing functions 00001220, Stripe functions 00001230, policies 00002016, grants
    00002510 (functions) / 00002520 (tables), indexes 00004005, platform params 00005001, plan seed
    00005030, event catalogue 00005050. Never drop columns/FKs of escrows, wallets or stages.
  - Thin routes (apps/web/routes/api/finance/*): HTTP parse + Zod + auth guard ONLY. Logic and RPC
    calls live in packages/backend/services/finance/* and return ServiceResult<T> (Decision #10).
  - Islands never import Supabase or @server/*; they fetch /api/* only.
  - Signal-first state; useEffect only for external DOM reads/focus. No useState.
  - Path aliases only; folders components/ islands/ styles/ hooks/ wrappers/ types/ core/ (+ routes/,
    services/). No src/. JSDoc on exports; // #region [Name] … // #endregion; no meta-comments.
  Money
  - finance.plans prices are GBP minor units and are never converted at rest. Every figure renders
    through @projective/ui/display MoneyView with its GBP origin; no formatMoney, toFixed or
    Intl.NumberFormat in feature code. The display currency comes from the request's
    AsyncLocalStorage scope (apps/web/utils/currency-context.ts) on SSR and the shared store on the
    client; a switch re-projects [data-money] nodes from their origin, never from the last
    conversion.
  - Footprint caps stay fail-open behind security.platform_params (proposal_allowance_enforced,
    footprint_caps_enforced, storage_quota_enforced all 'false'); a refusal records
    entitlement.denied from the APP layer (a RAISE rolls the event back). Plan-gate refusals are
    PK402 → HTTP 402, never 403. business_plan_gates_enforced is 'true' and split templates are
    always enforced — do not "make them fail open".
  UI (DESIGN_SYSTEM.md; root CLAUDE.md §3)
  - Pure CSS, strict BEM, token-only values (var(--*)). No hex/rgb, literal radius, duration, shadow,
    font-weight or breakpoint; no Tailwind, CSS-in-JS, inline style=, or UI-lib deps. Charts come
    from @projective/ui/display/charts only — feature code never imports d3-*.
  - Separation (§B.4): spacing → SOLID tonal step (--bg → --surface-1 → --surface-2) → type → one
    --hairline. Full borders only on interactive controls. No color-mix(…, transparent), no rgba,
    no opacity used to dim a state.
  - Anti-card (§B.9): plan columns are never boxed cards; no card inside a card or elevated panel.
  - Anti-tag (§B.11): limits and plan facts are inline --text-secondary text joined by " · "
    (MetaLine). Containers only for controls, lifecycle statuses (Tag), required disclosures
    (InlineNotice) and numeric count badges. "Most popular" is never a Tag.
  - Glass (§B.4.3): no backdrop-filter in feature code; the shell's header owns it.
  - Type (§A.4): titles var(--fw-medium); uppercase section labels var(--fw-semibold); nothing
    heavier; levels never differ by weight alone; every price and count tabular-nums.
  - Button matrix (§B.8): ONE filled button per decision region. Tier 3 <Button> for a plan commit;
    tier 4 neutral outlined for "Talk to us"; tier 5 text for "Compare all features". The current
    plan reads "Your plan" as text, never a disabled button (§3.11).
  - Press (§B.12): transform: scale(var(--btn-press-scale)) only, transform: none under BOTH
    @media (prefers-reduced-motion: reduce) and :root[data-motion="reduced"].
  - Contrast (§3.12): text ≥ 4.5:1 and meaningful non-text ≥ 3:1 in light, dark, and both
    data-contrast="high" states. No small text on a solid --success/--warning/--danger/--info fill
    (four --on-<role> pairs measure ~3.17:1 in light, Decision #76).
  - Overlays (§B.10.9): a second modal REPLACES the first; never stack scrims. An "enlarge" either
    replaces in place or hands off to a query-filtered page (/wallet/analytics?w=team:{id}).
  - A control that renders must do something (§3.11). A new/changed ui component updates the
    DESIGN_SYSTEM.md §C.1 roster in the same change.
  Product
  - Any new simulatable axis gets its Dev Context Switcher control in the same change: DevOverrides +
    DEV_DEFAULTS, DevOption list, DevContextPanel control, reflect() set AND delete
    (apps/web/features/devtools/, seam apps/web/utils/dev-seam.ts).
  - No bespoke statuses; nothing hard-deleted (archive, or is_public = false for a plan).
  - A NEW contradiction between source docs: do not pick a side — add a decision row (newest
    documentation/reference/decisions/decisions-*.md + README index line) and ask me. Decision
    numbers collide across branches: check every local branch's decisions README for the next free
    number before claiming one.

Verification: reproduce first (a SQL probe under supabase/probes/ or a Deno unit test), then fix,
then run `deno task db:reset` (if SQL changed — it is standing-approved; tell concurrent sessions),
`deno task check`, `deno task lint`, `deno task test:unit`, and `deno fmt` on the files you touched
only (never the whole tree). Four theme-engine.test.ts failures are pre-existing (Decision #96(a)).
For UI prompts also run `deno task dev`, open the page as a guest AND as the seeded personas
(documentation/database/Seed.md — marisdelacroix holds individual_pro; the Atelier Nova team holds
team_pro), and capture screenshots at 1440, 900 and 390 px wide in light and dark, plus one with
data-motion="reduced" and one with data-contrast="high".
Commit on the branch you were given with a clear message; do not open a PR unless I ask.
```

---

## 2. Phase 0 — Rulings

### S0 — Record the #252 owner rulings

```text
PROMPT S0: Decision #252 — subscriptions, agency tier and /pricing rulings

ROLE: Documentation steward. Docs only; no code.

CONTEXT: Decision #252 logged thirteen open questions (a)–(m) from SUBSCRIPTIONS_AUDIT.md. Put each
to me as a 🧑 DECISION with the options and the recommendation recorded in #252, then record the
answers as "OWNER RULINGS" in the #252 row (question → answer → what it settles), the format of
#238 and #250.

FILES:
  - documentation/reference/decisions/decisions-122-126.md (#252 row — append the rulings)
  - documentation/reference/decisions/README.md (#252 index line — add "RULED (x)…")
  - documentation/business/finance-model.md §1.3 + §16.1 (only the numbers I rule: agency price,
    annual prices, the agency pool)
  - documentation/business/PRODUCT_SPEC.md §7 "Agency scale" and "Public pricing" (replace each
    "(pending Decision #252 (x))" with the ruled wording)

ACCEPTANCE:
  - Every flag in #252 reads RULED or STILL OPEN; no flag is silently dropped.
  - grep -n "pending Decision #252" documentation/business/PRODUCT_SPEC.md lists only STILL OPEN flags.
  - No code files changed.
```

---

## 3. Phase 1 — Database & seeds

### S1 — Held-state drift, the grace window and a guest-readable catalogue

```text
PROMPT S1: Subscription state honours one rule, and guests can read the public plan catalogue

ROLE: Database + types engineer. Evidence: SUBSCRIPTIONS_AUDIT L13, L14, L15, L16. Ruling: #252 (m).

STOP FIRST (🧑 DECISION, unless S0 recorded it): #252 (m) — which subscription states keep a plan's
entitlements?
  [1] trialing · active, and past_due for subscription_grace_days after current_period_end;
      paused and later states fall back to the default plan (Recommended — a paused plan is not
      paid; the grace window is already seeded and only needs reading)
  [2] trialing · active · past_due · paused, with no grace window (today's TS behaviour)

FILES:
  - supabase/migrations/00001220_functions_finance_billing_entitlements.sql
      * finance.fn_active_plan: read security.platform_params.subscription_grace_days and apply the
        ruled state set.
      * NEW finance.get_public_plan_catalogue() RETURNS jsonb, SECURITY DEFINER,
        SET search_path = '', STABLE: every plan WHERE is_public, ordered by audience then
        sort_order, each with code, label, audience, tier, price_cents, currency,
        billing_interval, is_custom_priced, per_seat_cents, pricing_note and its entitlements
        (entitlement_key, kind, limit_value, is_unlimited, flag_value, scaling, multiplier_bp).
        Schema-qualify every type (a search_path='' definer breaks unqualified types). No
        subscription, grant or subject data — it is a catalogue.
  - supabase/migrations/00002510_permissions_function_grants.sql: REVOKE ALL FROM PUBLIC; GRANT
    EXECUTE TO anon, authenticated. Do NOT grant SELECT on finance.plans to anon.
  - packages/backend/services/finance/PlanBackendService.ts: HELD_STATES matches the ruled set and
    cites fn_active_plan as its twin.
  - packages/types/finance/plans.ts: PublicPlanCatalogueSchema (+ PublicPlanSchema with an
    entitlements array of PlanEntitlementSchema.pick(...)), exported from mod.ts.
  - supabase/probes/plan_held_states.sql (new): a past_due subscription inside / outside the grace
    window, a paused one, an expired one → fn_active_plan answers per the ruling; anon can execute
    get_public_plan_catalogue and cannot SELECT finance.plans.
  - documentation/database/finance/Functions.md (both functions), Policies.md (the anon door),
    PRODUCT_MANAGEMENT.md:232 (which states keep entitlements).

ACCEPTANCE:
  - The probe passes after `deno task db:reset`.
  - A TS unit test pins HELD_STATES to the SQL set (one list exported from plans.ts, read by both
    the service and the test).
  - `set role anon; select finance.get_public_plan_catalogue();` returns the 8 public plans.
```

### S2 — Annual prices, the agency tier and the treasury-export flag

```text
PROMPT S2: Annual prices and the agency team tier — catalogue rows, not a new money model

ROLE: Database + types engineer. Evidence: SUBSCRIPTIONS_AUDIT L3, L4, L5, §1.3, §2.1, §2.2.
Rulings needed: #252 (a) name, (b) prices and annual model, (c) agency pool, (h) enforcement family.
If S0 has not recorded them, STOP and ask (🧑 DECISION) with #252's options.

SPEC (assuming the recommended options — adapt to the rulings):
  (1) Annual prices — a child price table, so one plan keeps one code and one entitlement set:
      supabase/migrations/00000017_tables_finance.sql (edited in place, beside finance.plans):

        CREATE TABLE finance.plan_prices (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          plan_id uuid NOT NULL REFERENCES finance.plans (id),
          billing_interval finance.billing_interval NOT NULL,
          price_cents integer CHECK (price_cents IS NULL OR price_cents >= 0),
          currency char(3) NOT NULL DEFAULT 'GBP',
          provider_price_ref text,
          is_active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT ck_plan_prices_interval CHECK (billing_interval IN ('monthly', 'annual'))
        );

      00004005_indexes_finance.sql: CREATE UNIQUE INDEX uq_plan_prices_plan_interval_active ON
      finance.plan_prices (plan_id, billing_interval) WHERE is_active;
      00002016: RLS on; "Read plan prices" TO authenticated USING (true); the S1 catalogue read
      returns prices[] per plan. 00002520: SELECT to authenticated, ALL to service_role.
      00005030: one monthly row per priced plan (mirroring plans.price_cents) + annual rows ONLY
      for ruled prices (NULL price = not offered). finance.plans.price_cents stays as the
      catalogue's headline monthly figure; a trigger or a probe keeps the two equal — pick the
      probe if a trigger would be the only writer.
  (2) The agency tier — seed rows only, no enum change for the tier itself:
      00005030: INSERT INTO finance.plans (code, label, audience, tier, price_cents, currency,
      billing_interval, is_custom_priced, per_seat_cents, is_default, is_public, sort_order,
      pricing_note) VALUES ('<ruled code, recommended team_agency>', '<ruled label, recommended
      Agency>', 'team', 'enterprise', <ruled or NULL>, 'GBP', 'monthly', <ruled>, <ruled or NULL>,
      false, true, 30, '<ruled note>');
      Entitlements (plan_entitlements rows):
        team_seats              limit  is_unlimited = true
        team_public_projects    limit  <ruled, recommended 50>
        weekly_proposals        limit  <ruled FINITE value, recommended 300> — never is_unlimited,
                                       never scaled by seats (§2.2)
        proposal_buffer_per_10h limit  <ruled, recommended 8>
        storage_megabytes       limit  <ruled, recommended 2048000 (2 000 GiB)>
        audit_log_retention_days limit <ruled, recommended 730>
        split_template_co_op / _finders_fee / _benevolent_dictator  flag true
        promoted_placement      flag true
        advanced_analytics      flag true
        custom_treasury_export  flag true
      NEVER seed discovery_boost on this plan (it would make ranking purchasable, Decision #178 (a)).
  (3) One new entitlement key: supabase/migrations/00000004_enums_domains.sql — add
      'custom_treasury_export' to finance.entitlement_key IN PLACE (the CREATE TYPE list), and to
      EntitlementKey in packages/types/finance/entitlements.ts. Do NOT add agency_seats (team_seats
      + is_unlimited expresses it) or nested_split_rules (X1 has not defined it).
  (4) PlanCode in packages/types/finance/plans.ts gains the agency code.
  (5) Enforcement (#252 (h), recommended): team_public_projects stays in the fail-open footprint
      family; custom_treasury_export is a tool flag enforced like split templates (PK402 → 402).

DOCS (same change — paste and adapt):
  documentation/database/finance/Tables.md §7:
    - Table row: "`finance.plan_prices` | One price per plan and billing interval: `plan_id` FK,
      `billing_interval` (monthly/annual), `price_cents` (NULL = not offered), `currency`,
      `provider_price_ref` (the Stripe Price), `is_active`. Partial UNIQUE `(plan_id,
      billing_interval) WHERE is_active`. `finance.plans.price_cents` stays the monthly headline."
    - "The seeded plans": add the agency row ("team | <price> | Unlimited seats; a finite dedicated
      proposal pool; never buys capacity or Standing — Decision #252"), and change "Seeded with the
      8 plans" to 9.
    - Entitlement matrix: a third team column for the agency tier with the values above.
    - Add `custom_treasury_export` to the key list in §9 Enums.
  documentation/business/finance-model.md §1.3 table + §16.1 team table: the agency column.
  documentation/business/PRODUCT_SPEC.md §7 "Agency scale": drop "Planned" once the rows exist.

ACCEPTANCE:
  - supabase/probes/agency_plan.sql: the agency plan resolves team_seats NULL (unlimited),
    weekly_proposals finite, and fn_effective_limit for discovery_boost = 0 on an agency team.
  - The SQL and Zod entitlement_key lists are identical (an existing parity test, or add one).
  - No ALTER TYPE / ALTER TABLE statement anywhere in the diff.
```

---

## 4. Phase 2 — Services & routes

### S3 — `PricingBackendService` and `GET /api/finance/plans`

```text
PROMPT S3: One read for the plan catalogue, shaped for display

ROLE: Backend engineer. Evidence: SUBSCRIPTIONS_AUDIT L13, §4.2, §4.3. Needs S1 (and S2 for
annual prices; without S2 every plan has one monthly price).

FILES:
  - packages/backend/services/finance/PricingBackendService.ts (new):
      * static catalogue(viewer | null): ServiceResult<PricingCatalogue> — calls
        finance.get_public_plan_catalogue with the anon client for a guest and the viewer's JWT
        for a signed-in caller; maps to PricingCatalogue (packages/types/finance/pricing.ts, new):
        planes → audiences → plans → { code, label, tier, prices: { monthly?, annual? } as
        MoneyFigure (minor units + 'GBP' origin, NEVER converted here), customPriced,
        perSeat?, highlights: string[] built from entitlements by ONE pure function
        describeEntitlements() (e.g. "15 seats", "Unlimited seats", "150 proposals a week") }.
      * static current(viewer): delegates to PlanBackendService.current for the viewer's ACTING
        subject (personal, team, business, enterprise) — extend PlanBackendService.current to take
        the acting subject instead of reading audience='individual' only.
      * Cache the catalogue per isolate for 5 minutes (it is public and changes on deploy).
  - packages/types/finance/pricing.ts (new): PricingCatalogueSchema, PricingQuerySchema
    ({ plane?: 'individual'|'team'|'business', cycle?: 'monthly'|'annual', target?: PlanCode }, every
    unknown value parsed to undefined — never a 400 for a marketing URL), pricingHref(target?, cycle?).
  - apps/web/routes/api/finance/plans.ts (new): GET · HEAD; parse nothing but optional ?plane=; call
    PricingBackendService.catalogue; Cache-Control public, max-age=300 for a guest, private for a
    signed-in caller (the response then carries `current`).
  - documentation/architecture/ROUTING.md API table: the /api/finance/plans row (the "Planned"
    marker S6 removes for the page row).

ACCEPTANCE:
  - Unit tests: describeEntitlements() for unlimited, limit, flag and standing-scaled keys
    (published_listings reads "2× your Standing base", never a number); PricingQuerySchema drops
    unknown values; pricingHref('team_pro', 'annual') === '/pricing?target=team_pro&cycle=annual'.
  - curl as a guest returns 200 with the public plans and no `current`.
```

### S4 — Plan checkout on Stripe Billing (🧑 DECISION (f))

```text
PROMPT S4: Buying a plan — Stripe Billing Checkout and the subscription webhook

ROLE: Payments engineer. Evidence: SUBSCRIPTIONS_AUDIT §0 last row, L4, L6, L7, §4.4. Needs S3.

STOP FIRST (🧑 DECISION, unless S0 recorded #252 (f)): how is a plan paid?
  [1] Stripe Billing Checkout, card only, recurring; the platform's own revenue, never the wallet
      (Recommended — the wallet holds client money bound for escrow; a platform-initiated debit
      there is the "least forgivable" surprise finance-model §16.6 warns about)
  [2] A monthly debit from the subject's wallet
  Also ask: who may buy for an entity (recommended: the team owner / a business member holding
  manage_billing — Decision #238), and whether downgrades take effect at period end (recommended).

SPEC ([1]):
  - packages/backend/services/finance/SubscriptionBackendService.ts (new — there is no existing
    one to extend): startCheckout(actor, { planCode, cycle, subject }) → { url } after: the actor
    may bill the subject; the plan is public, priced, of the subject's audience, not the current
    one; a Stripe Price exists (plan_prices.provider_price_ref). Stripe objects are created
    server-side with the SECRET key from .env.local (env contract in SYSTEM_ARCHITECTURE.md);
    metadata carries subject_type, subject_id, plan_id, cycle — never trusted on return without
    re-reading the Stripe object.
  - Webhook: extend the existing stripe-webhook.ts planStripeEvent with checkout.session.completed
    (mode=subscription), customer.subscription.created/updated/deleted, invoice.payment_failed,
    invoice.paid → a service-role definer finance.apply_subscription_event(...) in
    00001230_functions_finance_stripe.sql that upserts finance.subscriptions (state,
    billing_interval, period, cancel_at_period_end, provider_ref) and appends
    finance.subscription_events, idempotent on the Stripe event id. Emit subscription.started /
    changed / cancelled through analytics.fn_emit (registered in 00005050).
  - Routes: POST /api/finance/subscriptions/checkout { planCode, cycle, subject } → 200 { url } |
    402 (PK402) | 403 (cannot bill this subject) | 409 (already on it); POST
    /api/finance/subscriptions/portal → the Stripe customer portal for cancel / card change.
  - Dev Context Switcher: a `planCheckout` axis (auto · success · cancelled · payment_failed)
    simulating the return states without Stripe (DevOverrides + DEV_DEFAULTS, DevOption,
    DevContextPanel, reflect() set AND delete).
  - Docs: SYSTEM_ARCHITECTURE.md Stripe section (Billing next to Connect), database/finance/
    Functions.md, PRODUCT_SPEC.md §7 (how a plan is bought and cancelled), PRODUCT_MANAGEMENT.md
    subscription lifecycle (which webhook moves which state).

ACCEPTANCE:
  - Unit tests on planStripeEvent for every new event; a probe replays the same event twice and
    finds one subscription_events row.
  - Stripe test mode only, with test keys from .env.local; the four test cards for success,
    decline, 3DS and insufficient funds.
```

---

## 5. Phase 3 — UI

### S5 — Fix the existing plan block and route every upgrade link through one helper

```text
PROMPT S5: Plan prices in the viewer's currency, and one way to say "see plans"

ROLE: Frontend engineer. Evidence: SUBSCRIPTIONS_AUDIT D11, §4.2. Needs S3 (pricingHref).

FILES:
  - apps/web/features/settings/components/sections/billing/PlanBlock.tsx: render every price
    through MoneyView with its GBP origin (drop formatMoney, :23). Keep the read-only copy until S4
    lands; once it has, the block offers "Change plan" (tier 4) → /pricing?target=<next plan>.
  - apps/web/features/proposals/components/AllowanceMeter.tsx:43-48: "Accelerate volume with Pro →"
    links to pricingHref(<the upgrade plan code the allowance read returns>) instead of
    settingsHref("billing"). Carry the plan code in the allowance contract if it only carries a
    label today.
  - apps/web/features/files/components/QuotaMeter.tsx:120 and UploadDrawer.island.tsx:558: "upgrade"
    becomes a link to pricingHref(<the subject's next plan>) — a sentence that names an action must
    offer it (§3.11).

ACCEPTANCE:
  - With the display currency set to EUR, /settings/billing shows "£12.99 (~€15.xx EUR)" and flips
    back to "£12.99" exactly on GBP (origin sweep, no drift).
  - grep -rn "formatMoney" apps/web/features/settings → no hits.
```

### S6 — The public `/pricing` page

```text
PROMPT S6: /pricing — two planes, three audiences, one comparison, in the viewer's currency

ROLE: Frontend engineer. Evidence: SUBSCRIPTIONS_AUDIT §4, §5 (D1–D10). Needs S3. Read
DESIGN_SYSTEM.md Part D (GuestShell, slot resolvers §D.7.5), §B.4, §B.8, §B.9, §B.11, §C.1.

FILES:
  - apps/web/routes/(public)/pricing.tsx — re-exports the controller.
  - apps/web/features/pricing/routes/PricingScreen.tsx — handler: PricingQuerySchema.parse(url);
    PricingBackendService.catalogue + current; resolve the default plane from the acting context
    (team → team, business/enterprise → business, else individual); `target` implies its plane.
    SEO: <title>Pricing — Projective</title>, a description, canonical /pricing.
  - apps/web/features/pricing/core/pricing-header-slot.tsx — pricingHeaderFor(url, authed): pure,
    synchronous, null for every path but /pricing; returns <PlaneSwitcher …/> (the audience TabMenu
    + the cycle SelectButton, the latter rendered only when the plane has an annual price). It holds
    NO figure and NO purchase control. Wire it into (public)/_layout.tsx beside viewHeaderFor
    (first non-null wins). Do NOT add a pricingLaneFor: the page is lane-less (#252 (e)).
  - apps/web/features/pricing/islands/PlaneSwitcher.island.tsx — signals for plane and cycle;
    writes ?plane=&cycle= with replaceState and toggles [data-plane] / [data-cycle] on the
    server-rendered page root so the switch acts on SSR DOM with no re-fetch and no VDOM flash
    (§3.11: a control driving server-rendered DOM acts on the DOM). Every plane's columns are in the
    SSR HTML; CSS shows the active one. Keyboard: TabMenu arrow keys; aria-controls on each tab.
  - apps/web/features/pricing/components/PlanColumn.tsx — unboxed column: name (section header
    register), price via MoneyView (display register, tabular-nums; monthly and annual both in the
    DOM, shown by [data-cycle]), "per seat" / "custom" / "price coming soon" meta, MetaLine of
    highlights, ONE commit:
      * current plan → "Your plan" text (no button)
      * priced + S4 landed → tier-3 <Button> "Choose {label}" → POST
        /api/finance/subscriptions/checkout (guest → /join?redirectTo=/pricing?target=…)
      * priced, S4 not landed → no button; the meta line "Plan changes open soon" (§3.11)
      * custom-priced → tier-4 outlined "Talk to us" → /contact?topic=plans
      * price NULL (Business Pro today) → "Price coming soon", no button.
    The emphasised plan (target, else the plane's paid tier) sits on a SOLID --surface-1 region —
    never a nested card, never a translucent wash.
  - apps/web/features/pricing/components/PlanMatrix.tsx — the comparison as @projective/ui DataTable
    (Decision #224): rows = levers, columns = the plane's plans; included/excluded as icons with
    visually-hidden text; limits as text. Below --bp-md one <details> per plan instead.
  - apps/web/features/pricing/components/PricingPrinciples.tsx — four static sentences under the
    matrix, unboxed: execution capacity is never sold; Standing is earned, never bought; every tier
    has a proposal ceiling; the 5% service fee is the same on every plan. These are the platform's
    promises (PRODUCT_SPEC §7), so they are text, not marketing chips.
  - apps/web/features/pricing/styles/pricing.css — BEM `.pricing`, `.pricing-plan`,
    `.pricing-matrix`; token-only; @container for the column count; both reduced-motion channels;
    imported by the island that carries it (a server component's CSS import reaches no page) and
    WRITTEN BEFORE it is imported.
  - Dev Context Switcher: a `pricingViewer` axis (auto · guest · individual_free · individual_pro ·
    team_free · team_pro · agency) that only changes which plan reads "Your plan" and which plane is
    the default — never what is charged (DevOverrides + DEV_DEFAULTS, DevOption, DevContextPanel,
    reflect() set AND delete).
  - DESIGN_SYSTEM.md §C.1: PlaneSwitcher, PlanColumn, PlanMatrix (feature components — record them
    in the feature roster, not packages/ui, unless a second surface needs them).
  - ROUTING.md: drop "Planned" from the /pricing row. PRODUCT_SPEC.md sitemap: same.

ACCEPTANCE:
  - Guest and signed-in render the same body; signed-in adds "Your plan" on the held plan.
  - /pricing?target=team_pro&cycle=annual opens the Team plane, emphasises Pro Team, and shows the
    annual price if one exists (else cycle is dropped from the address).
  - No layout shift on switching plane or cycle (CLS 0 in the WebVitals beacon).
  - The DOM contains exactly one filled button per plan column at most, and none in the header band.
```

### S7 — Entry points

```text
PROMPT S7: Every "Pricing" link leads to /pricing

ROLE: Frontend engineer. Evidence: SUBSCRIPTIONS_AUDIT §0 row 3. Needs S6. Coordinate with
flows/PUBLIC_ROUTES_BUILD_PROMPTS.md P8 (it owns the footer/megamenu sweep) — if P8 has landed,
edit on top of it; if it is in flight, hand this change to that session.

FILES:
  - apps/web/features/marketing/core/megamenu-data.ts: SECONDARY_LINKS "Pricing" → /pricing.
    Desktop: add Pricing as a plain link after the four pillars (not a fifth megamenu — it has no
    columns), with the same keyboard path as the pillar triggers.
  - apps/web/features/marketing/components/PublicFooter.tsx: Pricing in the product link group.
  - The landing page's pricing section (PUBLIC_ROUTES L4): its CTA → /pricing; it keeps the 5%
    fee statement and does not restate plan prices (rollup, not restatement).
  - The account popover allowance meter already moved in S5; the popover gains no new "Upgrade" row.

ACCEPTANCE:
  - grep -rn '"/help"' apps/web/features/marketing/core/megamenu-data.ts → no Pricing entry.
  - The mobile drawer, desktop header and footer each reach /pricing by keyboard alone.
```

---

## 6. Phase 4 — Verification

### S8 — Playwright pricing suite

```text
PROMPT S8: apps/web/tests/e2e/pricing.spec.ts

ROLE: Test engineer. Needs S6 (and S4 for the checkout steps, skipped otherwise). Follow the
existing harness: Deno.test + t.step, npm:playwright-core@1.56.1 chromium,
E2E_BASE_URL, a launch config of its own (copy web-catalogue-e2e on a new port), the seeded
persona sign-in by email. Add the file to the test:e2e task in deno.json.

STEPS (each a t.step, each at 1440×900, 768×1024 and 390×844):
  1. Guest /pricing: three tabs; Individual default; every price is a [data-money] node with
     data-origin GBP; no filled button in the header band.
  2. Plane switch: click Team → URL ?plane=team, Team columns visible, no network request for the
     catalogue, layout-shift entries sum to 0.
  3. ?target=team_pro&cycle=annual → Team plane, Pro Team emphasised; cycle kept only if an annual
     price exists.
  4. Currency in place: set pj.currency=EUR (or use the wallet's currency control), reload → EUR
     disclosure on every price; switch back to GBP without reload → exact original figures
     (string-equal to step 1).
  5. Signed in as marisdelacroix → "Your plan" on Pro, no button on it.
  6. Accessibility: data-contrast="high" and dark — run axe-core (npm:axe-core, injected) with
     color-contrast enabled; zero violations. data-motion="reduced" → the press transform is none
     (getComputedStyle on a pressed button).
  7. Mobile (390): the matrix is <details> per plan; the switcher band stays below the header while
     scrolling.
  8. (S4 only) Choose Pro as individual_free → Stripe test Checkout URL returned (do not complete a
     real payment; stub at the network layer).

ACCEPTANCE: `deno task test:e2e` runs catalogue + pricing green against a fresh `deno task dev`.
Screenshots saved under the scratchpad, never committed. Clean up .playwright-mcp/ if created.
```

---

## 7. Roadmap — not buildable until ruled and specified

### X1 — Hierarchical treasury (🧑 DECISION (d))

```text
PROMPT X1: Specify, do not build, a nested agency treasury

ROLE: Product + finance architect. Docs only. Evidence: SUBSCRIPTIONS_AUDIT §2.4.

Put #252 (d) to me: does an agency need sub-vaults (department → squad) at all, or are per-
engagement contribution agreements (TEAMS_AUDIT F12) the real need? Options:
  [1] Per-engagement contribution agreements on the existing single split rule (Recommended —
      smallest change to the escrow-release path, and it is the gap teams already have)
  [2] Squads as a team sub-entity with their own split rule, applied after the master vault cut
  [3] Both
For the chosen option, write the PRODUCT_SPEC.md entry, the finance-model.md numbers, and a
schema sketch in a decision row — the release path's determinism and "every leaf sums to the
release" property test are acceptance criteria of the LATER build prompt, which this prompt writes
into this file as X1-B. Only then may an entitlement key (nested_split_rules or the ruled name) be
added, in X1-B, never before.
```

### X2 — Agency ingestion (🧑 DECISION (g))

```text
PROMPT X2: Specify, do not build, board importers and external mounts

ROLE: Product + integrations architect. Docs only. Evidence: SUBSCRIPTIONS_AUDIT §2.5.

Put #252 (g) to me: which sources (Jira, ClickUp, Asana, Linear, CSV), what maps to what (board →
project, epic/list → stage, issue → ticket with its W_i weight chosen by the importer, never
inferred), what is NOT imported (money, assignees who are not members, history), and whether
attachments mount read-only like cloud-drive files (never counting against storage_megabytes) or
are copied. Recommend CSV + one tracker first, attachments mounted. Write the PRODUCT_SPEC.md entry
and the integrations.providers seed shape (no schema change — the connector substrate is generic),
then append the build prompt here as X2-B.
```

---

## 8. Last

### Z1 — Docs sweep

```text
PROMPT Z1: Subscriptions docs sweep

ROLE: Documentation steward. After S1–S8.
  - Every "Planned" marker for /pricing and /api/finance/plans in ROUTING.md and the PRODUCT_SPEC
    sitemap is gone where the route exists, and remains where it does not.
  - finance-model.md §1.3 / §16.1 and database/finance/Tables.md §7 agree on every plan, price and
    limit (one table each; rollup, not restatement).
  - SUBSCRIPTIONS_AUDIT.md findings are marked fixed with the decision or commit that fixed them.
  - The #252 index line lists what is BUILT and what is STILL OPEN.
```
