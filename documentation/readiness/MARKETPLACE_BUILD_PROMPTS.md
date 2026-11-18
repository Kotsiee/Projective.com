# Marketplace Build Prompts — closing USER_FLOWS MK: Basket, checkout & orders · Reviews · Seller catalogue

> **Status: WORK ORDERS, not binding.** Claude Code prompts that take three sections of
> [USER_FLOWS.md](USER_FLOWS.md) to 100%: **Basket, checkout & orders** (MK-18–MK-31, 63% at
> 2026-11-18), **Reviews** (MK-32–MK-34, 25%) and **Seller catalogue** (MK-35–MK-47, 66%). Written
> 2026-11-18 against `main` @ `b7280787`. Every open row was re-checked in code that day by a
> read-only audit, and every gap the rows name is still open (four row texts are stale, §0.4).
>
> **Rollup, not restatement.** Money rows already have work orders in
> [`FINANCE_BUILD_PROMPTS.md`](../architecture/FINANCE_BUILD_PROMPTS.md) (FBP), sequenced by
> [`MONEY_BUILD_PROMPTS.md`](MONEY_BUILD_PROMPTS.md) (MONEY), which owns the finance SQL lane.
> Others sit in `SUBSCRIPTIONS_BUILD_PROMPTS.md` (SBP), `SCHEDULING_BUILD_PROMPTS.md` (SCH),
> `TRUST_SAFETY_BUILD_PROMPTS.md` (T&S), `COMMS_BUILD_PROMPTS.md` and the #393 specs
> ([`ASSET_DELIVERY_ARCHITECTURE.md`](../architecture/ASSET_DELIVERY_ARCHITECTURE.md),
> [`ANTI_PIRACY_ENGINE.md`](../architecture/ANTI_PIRACY_ENGINE.md)). This file links to them and
> adds only what changed (§2). Gaps with no work order get new prompts: **CK1–CK7** (checkout),
> **RV1–RV3** (reviews), **SC1–SC9** (seller catalogue) and **MKZ** (the closing sweep).

---

## 0. Map, run order and stops

### 0.1 Row → work order

**Basket, checkout & orders**

| Row   | Now · Crit · Gate  | Work order                                       | The row flips (or its note clears) when                                                                                                |
| :---- | :----------------- | :----------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| MK-18 | ✅ · High · UAT    | **CK5**                                          | An idle basket gets one nudge, within consent (note clears)                                                                            |
| MK-19 | ✅ · High · UAT    | —                                                | —                                                                                                                                      |
| MK-20 | 🟡 · Crit · PROD   | **CK4** (ruled #490; ⚖️)                         | ✅ only once the tax switch is on in the target environment after counsel; CK4 alone narrows the note                                  |
| MK-21 | ✅ · Crit · MVP    | — (CO17 is Planned, §0.5)                        | —                                                                                                                                      |
| MK-22 | ✅ · Crit · MVP    | — (environment)                                  | —                                                                                                                                      |
| MK-23 | 🟡 · High · UAT    | **CK6** + you, on a hosted domain                | Your device runs are recorded (Apple Pay on iOS Safari, Google Pay on Android Chrome, the PayPal return)                               |
| MK-24 | 🟡 · Normal · UAT  | SBP S1 → S4 (MONEY §4 delta)                     | A business buys Business Pro, sets monthly invoicing and places an on-account order                                                    |
| MK-25 | ✅ · Normal · UAT  | COMMS NT3 (email)                                | The approval notice also emails (note clears)                                                                                          |
| MK-26 | 🟡 · Normal · UAT  | **CK2** (takes FBP DB19 step 1)                  | A seller issues a code; the same account's second use is PC409; the route is throttled                                                 |
| MK-27 | ⏸                  | — (#435, counsel)                                | Excluded                                                                                                                               |
| MK-28 | 🟡 · Normal · PROD | FBP DB17 → UI5 (MONEY §1 wave 3)                 | A live feed with a staleness mark                                                                                                      |
| MK-29 | ❌ · Crit · UAT    | **CK1** (🧑 A6, A8)                              | A real checkout delivers every file of a bundle; a refunded line answers 404                                                           |
| MK-30 | ✅ · High · UAT    | **CK3**                                          | Every past order is findable; a block's receipt names every sitting (note clears)                                                      |
| MK-31 | ❌ · Crit · UAT    | FBP DB6 → DB19 → DB21 → MONEY MR3 (⏳ CK1, DB16) | A buyer cancels an undownloaded line, disputes a defective one, an operator refunds a card; lines and orders read refunded / cancelled |

Two rows of the **Listing view** section close here too, because their gap sits in checkout or in a
door built below: **MK-16** (a quote offer is paid at its price) → **CK7**; **MK-12** (reserve a
cohort seat) → **SC3**.

**Reviews**

| Row   | Now · Crit · Gate  | Work order      | The row flips when                                                                                         |
| :---- | :----------------- | :-------------- | :--------------------------------------------------------------------------------------------------------- |
| MK-32 | ❌ · High · UAT    | **RV1** (🧑 ×4) | A completed buyer reviews, the seller is told and replies; the row cites T&S R2 for the report entry point |
| MK-33 | ❌ · Normal · PROD | **RV2** (#486)  | Providers review clients, double-blind as ruled; the Client Trust Score and its warning run                |
| MK-34 | ✅ · Normal · UAT  | **RV1**         | Real reviews replace seed-only data (note clears)                                                          |
| MW-64 | ❌ · Normal · PROD | **RV3** (#489)  | Standing reads real reviews, and Elite can be reached (#58-63 (h))                                         |

**Seller catalogue**

| Row   | Now · Crit · Gate  | Work order                                        | The row flips (or its note clears) when                                                |
| :---- | :----------------- | :------------------------------------------------ | :------------------------------------------------------------------------------------- |
| MK-35 | ✅ · Crit · MVP    | **SC1**                                           | `catalogue.listings` has a pinned Zod row schema (note clears; PRD-I3 narrows)         |
| MK-36 | ✅ · High · MVP    | — (T&S P2a refuses PII in listing copy)           | —                                                                                      |
| MK-37 | 🟡 · High · UAT    | **CK1**                                           | ✅ once sale originals are private, frozen at publish (A6) and delivered               |
| MK-38 | ✅ · Crit · MVP    | **SC2**                                           | The CREATE category is copied; a tiered Pipeline is seeded (note clears)               |
| MK-39 | ✅ · High · UAT    | **SC2**                                           | A session plan is seeded (note clears)                                                 |
| MK-40 | ❌ · High · UAT    | **SC3** → SCH-WP7                                 | 🟡 after SC3 (a seller opens a cohort); ✅ after WP7 (sittings scheduled from the app) |
| MK-41 | 🟡 · Crit · PROD   | **SC4** (#494) + T&S SN2 → SN3                    | ✅ once SN3 screens before publish; SC4 closes the write bypass and the emitter        |
| MK-42 | ✅ · Normal · UAT  | **MKZ** (🧑 close #219 (d))                       | The note cites SA's sanctioned loosening                                               |
| MK-43 | 🟡 · Normal · UAT  | **SC5**                                           | Views are written and counted; 90 days are seeded                                      |
| MK-44 | 🟡 · Normal · UAT  | **SC6** (#500; ⏳ CK1, SC4)                       | Slug links; a team or business buyer is named                                          |
| MK-45 | ✅ · High · UAT    | **SC6** (ruled #500; ⏳ CK1, SC4)                 | The note states the ruled team-editing scope                                           |
| MK-46 | ❌ · Normal · PROD | **SC7** (ruled #493; ⚖️)                          | Request to Sell, the client's grant and the royalty leg run                            |
| MK-47 | ❌ · High · PROD   | T&S R1 → R2 → **SC8**; **SC9** × every #393 phase | 🟡 once SC8 and ASSET phases 1–2 land; ✅ once every ASSET and ANTI_PIRACY phase lands |
| MK-57 | 🟡 · High · PROD   | **SC4**, if it takes #494 (a)                     | A direct write meets the doors' locks (#494 (A) 3–4)                                   |

**Score projection** (section score = Σ weight × credit / Σ weight; Critical 3 · High 2 · Normal 1;
✅ 1 · 🟡 0.5 · ❌ 0; ⏸ excluded):

| Section                   | Today | Path                                                                                        |
| :------------------------ | ----: | :------------------------------------------------------------------------------------------ |
| Basket, checkout & orders |   63% | CK1 74% → DB21 85% → CK2 87% → CK6 + you 91% → SBP S4 93% → DB17 94% → CK4 switched on 100% |
| Reviews                   |   25% | RV1 75% → RV2 100%                                                                          |
| Seller catalogue          |   65% | CK1 69% → SC4 72% → SC3 + WP7 80% → SC5 81% → SC6 83% → SN3 89% → MK-47 96% → SC7 100%      |

What UAT needs from these sections: **CK1** and the MK-31 chain (the cluster's two Critical · UAT
❌s in the Scoreboard), **RV1**, **SC3** + SCH-WP7, **SC5**, **SC6**, **CK2**, **CK6** + you and SBP
S4.

### 0.2 Run order

The global rules hold: at most **two SQL sessions** on the one local DB, on disjoint migration
files; one writer at a time for `00002500` / `00002510` / `00002520` across **all** tracks. The
order below is priority and dependency (⏳); the file locks decide what may overlap. Before every
SQL prompt, compare its files with what is running (`git status`, and §0 of MONEY, SECURITY_ACCESS
and this file).

**Queue M — money files** (`00001210` `place_wallet_order`, `00000017`). Each takes a turn in MONEY
§1's serial SQL lane; MONEY's order wins on a conflict.

1. **CK1** — MK-29, and the download record MONEY's DB21 delta asks for. It edits neither `00001240`
   nor `00000017`, so it can be the second SQL session beside MONEY's Wave 2 once `00002510` is
   free.
2. **CK7 → CK2** — ⏳ CK1 (`00001210`). CK2's 🧑 is ruled (#485), and CK2 waits here for CK7 and for
   FBP DB16, because #485 (a) adds a conservation-identity term.
3. MONEY's **DB19 → DB21 → MR3** — ⏳ CK1 (DB21 step 1), DB6 and DB16. CK2 has taken DB19 step 1.
4. **CK4** — ⏳ DB21 (a refund reverses the tax); 🧑 ruled #490, ⚖️ counsel before the switch.
5. **SC7** — ⏳ CK1, DB19 and DB21 (a refund reverses the royalty too, #493 (D)); 🧑 ruled #493, ⚖️
   counsel before the grant switch. The last change to the money path in this file.

**Queue C — everything else**, as the second SQL session whenever its files are disjoint from what
is running. It shares that slot with SBP S1–S4 (MONEY §1) and the SAC prompts.

1. **SC4 → SC6** — ⏳ CK1 (`00001170`). SC4 leads: the write bypass is live and wider than its
   CONTEXT says (#494), and SC4 also writes `00002018` and `00002020`.
2. **RV1** — ⏳ SAC1 (`00002500`, `00002510`). Better after CK3, which gives it an entry point.
3. **SC2 → SC3 → SCH-WP7** — the seed generator is one writer at a time; `00001155` runs with no
   other SCH package.
4. **CK5** — ⏳ `00005060` free (DB16, PM-WP1, PM-GH1, MR4, MR5 and DB17 also write it).
5. **SC5 → RV2 → RV3.** RV3's 🧑 is ruled (#489), and RV3 waits here for RV2.
6. T&S **R1 → R2** (their track) → **SC8** (rulings #496; ⚖️ counsel words the regime); **SC9** once
   per #393 phase.

**App lane** (up to three at once, file-disjoint): **SC1** and **CK6** now; **CK3** ⏳ CK1
(`live-orders.ts`); **MKZ** last.

**Hot files across this file:**

| File                                             | Writers here            | Writers elsewhere (never at the same time)                        |
| :----------------------------------------------- | :---------------------- | :---------------------------------------------------------------- |
| `00001210` (`place_wallet_order`, promo, orders) | CK1, CK7, CK2, CK4, SC7 | FBP DB9, DB10, DB11, DB13, DB15, DB19; SCH-WP6                    |
| `00000017` (finance tables)                      | CK2, CK4, SC7           | FBP DB6, DB8, DB19, DB21; MONEY MR3, MR5                          |
| `00001170` (catalogue doors)                     | CK1, SC4, SC6           | —                                                                 |
| `00001155` (sessions, cohorts)                   | SC3                     | every SCH package; FBP DB15                                       |
| `00005060` (jobs)                                | CK5, RV1, RV2           | FBP DB16, DB17; PM-WP1, PM-GH1; MONEY MR4, MR5                    |
| `00002500` / `00002510` / `00002520` (grants)    | every SQL prompt here   | SAC1 holds `00002500` + `00002510` while it runs; then by name    |
| `supabase/seeds/gen/*` (+ `db:seed:generate`)    | CK1, RV1, SC2, SC3, SC5 | FBP DB16 (`emit-finance.ts`)                                      |
| `features/checkout/**`, `live-orders.ts`         | CK1, CK3, CK4, CK6, CK7 | FBP DB21, UI5, UI6                                                |
| `USER_FLOWS.md`, `PRODUCTION_READINESS.md`       | every prompt            | every readiness track: edit your rows and the computed lines only |

### 0.3 Human stops on this path

Answer them in one sitting and each prompt runs straight through. Each prompt keeps its own 🧑
block, so a question you defer still stops the build at the right step.

| #  | Question                                                                                         | Prompt              | Recommendation                                                                                          |
| :- | :----------------------------------------------------------------------------------------------- | :------------------ | :------------------------------------------------------------------------------------------------------ |
| 1  | #393 A6: sale originals as a third zone, snapshotted at publish                                  | CK1                 | Yes, as the spec recommends                                                                             |
| 2  | #393 A8 (⚖️): what "downloaded" means for the refund rule                                        | CK1                 | The first completed delivery (or a reader session, once one exists), expressly accepted before Pay      |
| 3  | #458 (b): an accepted quote offer left unpaid                                                    | CK7                 | The offer's own expiry bounds payment                                                                   |
| 4  | Who issues a promo code, and who funds it                                                        | CK2                 | **Ruled #485 (2026-11-18): A.** Seller-funded, own products; the platform pays for its codes (#485 (a)) |
| 5  | DB19 `cancelled` vs `refunded`; DB21 a dispute after clearing (#344 (l)); MR3 who refunds a card | MONEY §3 #3, #8, #9 | As MONEY §3 recommends                                                                                  |
| 6  | The tax model (⚖️)                                                                               | CK4                 | **Ruled #490:** Stripe Tax on digital products only, tax-exclusive; off until counsel                   |
| 7  | Is the abandoned-basket nudge marketing (⚖️)                                                     | CK5                 | Yes: sent only with consent, with an opt-out in every message, never to a 13–17 account                 |
| 8  | Review eligibility, window and edits, the reply, one aggregate (#244 (e))                        | RV1                 | RV1's four recommendations                                                                              |
| 9  | The reveal rule, Client Trust Score v1 (#244 (c)), the warning, one name or two                  | RV2                 | **Ruled #486:** double-blind; a Bayesian mean with named deductions; demote and acknowledge; one score. |
| 10 | What Standing's peer track is                                                                    | RV3                 | **Ruled #489:** B, the client track alone, for all 20 points; a review recomputes its subject.          |
| 11 | What a seller sets when opening a cohort, and what happens if it under-fills                     | SC3                 | Capacity, start, cadence, close; an optional minimum, and a cancel that refunds every seat in full      |
| 12 | Who may edit a team's listing (#312 (a), (e))                                                    | SC6                 | **Ruled #500:** A, tightened: holders edit any team listing and create; delete: the creator or an admin |
| 13 | The royalty: who sets it, its order against commission; who may request; ⚖️ licence words        | SC7                 | **Ruled #493:** approved as asked, 0–50% of net; `exclusive_transfer`/`licensed_use`; stops on erasure  |
| 14 | ⚖️ Which notice-and-takedown regime                                                              | SC8                 | **Ruled #496:** a `notice` source and a takedown hold; the regime itself stays counsel's                |
| 15 | #393 A1–A5, A7, A9–A11 and B1–B10                                                                | SC9                 | **Ruled #499:** A2 reads only (signed uploads stay); the rest per phase, as the spec recommends         |
| 16 | Close #219 (d) as sanctioned                                                                     | MKZ                 | Yes: SA already names it the second sanctioned loosening                                                |
| 17 | Who `catalogue.listing_published` tells, and on which publish                                    | SC4                 | **Ruled #494:** the owning party's followers, in a daily digest, on a listing's first publish only      |
| —  | SCH-WP7 step 6 (#344 (f)); SBP S4's (f)                                                          | their prompts       | Their own                                                                                               |

**For counsel** (build behind a switch that stays off; never switch it on): A8's wording, the tax
obligation and its tax-exclusive display (#490 (c)), the nudge's consent basis, SC7's licence
wording, SC8's notice regime, and one question to add to MONEY MR7's brief: **may a buyer-started
refund of a card-paid line land in the wallet?** UK consumer rules generally expect a refund to the
original payment method unless the buyer agrees otherwise. DB21 credits the wallet and MR3 keeps
card refunds operator-only.

### 0.4 Stale text found on 2026-11-18

Fix each in the prompt named, or in MKZ if that prompt has already landed.

| Where                                                  | Says                                                   | Truth                                                                   | Fix in |
| :----------------------------------------------------- | :----------------------------------------------------- | :---------------------------------------------------------------------- | :----- |
| USER_FLOWS MK-29                                       | `live-orders.ts:376`                                   | The note is `:359`; the download gate `:386`                            | CK1    |
| `ASSET_DELIVERY_ARCHITECTURE.md` §2                    | `00001210:1892`, `live-orders.ts:342`                  | `:2153`, `:386`                                                         | CK1    |
| USER_FLOWS MK-16                                       | "after LV2's checkout lands"                           | LV2 has landed (#457); the branch is still missing                      | CK7    |
| USER_FLOWS MK-40                                       | `schedule_sitting` has no caller, so SCH-WP7 closes it | No door opens a group cohort at all; WP7 schedules sittings of one      | SC3    |
| USER_FLOWS MK-44                                       | "quotes cannot be acted on"                            | `QuotePanel only="host"` is in `ClientDrawerBody.tsx:213` (#458)        | SC6    |
| USER_FLOWS MK-45                                       | "—"                                                    | #312 flags (a) and (e) are open                                         | SC6    |
| `FINANCE_AUDIT.md` A9                                  | `F1200:~788`                                           | `00001200:1413`                                                         | #490   |
| `database/comms/Functions.md:131-135`                  | `fn_enqueue` has no caller                             | `00001510:3143` calls it                                                | CK5    |
| `database/reviews/Tables.md:43`                        | the landing testimonials read the table                | `testimonials()` is dead (#349)                                         | RV1    |
| `00002018:52-63`, `database/reviews/Policies.md:14-15` | no table records a product purchase                    | `finance.order_lines` does                                              | RV1    |
| `packages/types/profile/tabs.ts:180`                   | `freelancer` = "fellow freelancer"                     | the RPC's `author_role = 'freelancer'` is a provider reviewing a client | RV2    |
| FBP header                                             | DB3 is uncommitted                                     | committed in `44382c08` (MONEY's addendum already says so)              | MKZ    |
| USER_FLOWS MK-47                                       | "21 rulings open"                                      | A2 ruled (#499); A6 and A8 are CK1's (#488)                             | SC9    |

### 0.5 Not in this file

- **MK-21's wallet + card split** (CO17) is Planned with no prompt (FBP §0.6). Un-planning it is
  your call; then it needs a `PRODUCT_SPEC.md` entry first.
- **MK-27** (pay in your own currency) stays ⏸ until counsel answers #435 (d) (MONEY MR7).
- **MK-41's screening** is T&S SN2 → SN3; the safety node lives outside this repo (PRD-D10).
- **MK-56** (a business buys a One-Off) is ruled individuals-only for now (#457).
- **PRD-M5's seller tax forms** (1099 / W-9) are a payout-side question. CK4 covers checkout and
  invoice tax only.

---

## 1. Headers

### 1.1 Standard header — paste above every CK, RV, SC and MKZ prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types
the Zod SSOT @projective/types; packages/backend fat services @server/services/*;
supabase/migrations Postgres with RLS everywhere; Stripe Separate Charges & Transfers on
Accounts v2 Express).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (always
     documentation/CLAUDE.md; documentation/database/CLAUDE.md when SQL changes;
     packages/ui/CLAUDE.md for UI), then documentation/reference/guardrails.md and
     documentation/reference/pr-checklist.md.
  2. Read documentation/readiness/USER_FLOWS.md (your rows) and
     documentation/readiness/MARKETPLACE_BUILD_PROMPTS.md §0 (run order, file locks, stops). If
     you touch 00001210 or 00000017, also read MONEY_BUILD_PROMPTS.md §1-§2: its SQL lane decides
     when you run.
  3. Grep documentation/reference/decisions/README.md for the surface you touch and read the
     decision files it names. If a decision already rules the behaviour you are about to change,
     stop and ask me.
  4. The CONTEXT below was verified at main @ b7280787. Re-check every file:line against the
     current tree before relying on it; another track may have landed since. Report any premise
     that no longer holds in your final message; never work around it silently.

Hard rules (merge gates; reject your own diff if any fails):
  - Migrations are consolidated and EDITED IN PLACE (vvvvtooo_type_purpose.sql); never an ALTER
    patch or a "fix" file. Each statement in its category file (0 tables · 1 functions · 2
    policies/grants: 00002500 schema grants, 00002510 function grants, 00002520 table grants · 3
    views · 4 indexes · 5 seed; 00005060 jobs). The Additive Rule: no dropped table, column or FK
    without my OK, above all on escrows, wallets and stages.
  - SECURITY DEFINER functions pin search_path = '' and schema-qualify every name. RLS stays on;
    a new write goes through a door, never a client policy. A signed-in request runs under the
    user's JWT; the service role only inside a definer, cron or webhook door.
  - Money: integer minor units; floor every cut; dust to a named sink. Every balance move goes
    through finance.fn_wallet_credit / fn_wallet_debit / fn_wallet_credit_pending. Every Stripe
    effect claims finance.idempotency_keys inside the same transaction. supabase/probes/
    finance_invariants.sql stays green; once FBP DB16 lands, so does conservation_identity.sql,
    and a new money flow adds its terms to finance.v_conservation_identity.
  - Stripe: never a live key; never change the Dashboard, an endpoint or an account setting. Use
    the stripe:stripe-docs skill for any Stripe API fact.
  - Thin routes (HTTP parse + Zod + auth guard); logic in packages/backend/services/* returning
    ServiceResult<T> (Decision #10). Islands never import Supabase or @server/*.
  - A schema or RPC-contract change lands with its Zod schema, the backend mapper and
    documentation/database/* in the same change; a business rule with PRODUCT_SPEC.md (and
    finance-model.md for numbers); a lifecycle or state with PRODUCT_MANAGEMENT.md; a route or
    URL state with ROUTING.md (prefixed opaque slugs, Decision #88; state that should be
    addressable is a URL, not a signal); a component with DESIGN_SYSTEM.md §C.1; an env key with
    SYSTEM_ARCHITECTURE.md §Environment Variable Contract and .env.example (XXXX-XXXX).
  - UI: token-only pure CSS + strict BEM; no card in a card; non-actionable metadata as inline
    --text-secondary MetaLine text; tabular-nums on every figure; every money figure a MoneyView;
    one filled control per decision region (§B.8); one dialog at a time (@projective/ui Dialog
    with a Signal `visible`, a bottom sheet on mobile); press feedback transform: scale() only,
    removed under both reduced-motion channels; focus rings stay OFF app-wide (#245 (a)). A
    control that renders must do something.
  - Signal-first state; no useState; useEffect only for browser or Stripe APIs. Path aliases only;
    JSDoc on exports; // #region blocks; no meta-comments.
  - Every new simulatable axis gets its Dev Context Switcher control in the same change
    (DevOverrides + DEV_DEFAULTS, DevOption list, DevContextPanel, reflect() set AND delete).
  - Nothing hard-deleted (archive / withdrawn_at); no bespoke statuses.
  - Log one decision row for the work, as LV1-LV5 did: what is now true, the date, the prompt ID,
    the USER_FLOWS rows it moves, OWNER RULINGS, BUILT, FLAGS (a)… for what you leave open. The
    newest decisions-*.md + a README index line; grep for the next free number right before you
    write (numbers collide across peers). A NEW contradiction between source docs: do not pick a
    side; log it and ask me.
  - 🧑 DECISION: stop at the named step, put the options and your recommendation to me, and build
    nothing that depends on the answer until I give it. ⚖️: build behind a param or flag that
    stays off; never switch it on.

Verification: reproduce the defect first (a failing probe or test), then fix.
  SQL: rollback-safe probes under supabase/probes/ (\set ON_ERROR_STOP on, a pg_temp helper that
  raises 'PROBE FAIL: …', ROLLBACK; only a concurrency probe commits, gated on :{?disposable});
  `deno task test:probes` (a name filters); `deno task db:reset` is standing-approved but
  announce it to concurrent sessions first; finish with your own clean
  `deno task test:probes:fresh`.
  Always: `deno task check`, `deno task lint`, `deno task test:unit`, and `deno fmt` on the files
  you touched only (never a directory). Compare a red unit test with main before calling it yours
  (theme-engine failures are pre-existing, Decisions #96 (a) and #157 (m)).
  UI-visible changes: `deno task dev`, the seeded personas (documentation/database/Seed.md), and
  screenshots at 1440, 900 and 390 px in light, dark, data-contrast="high" and
  data-motion="reduced".
This checkout is shared with other sessions: never switch branch, never stash, stage only your
own hunks, verify in a clean worktree. Commit on the branch you were given. Do not push or open a
PR unless I ask.
```

### 1.2 Readiness addendum — paste after every prompt

```text
READINESS (Decision #444): in the same change, update documentation/readiness/USER_FLOWS.md:
the row(s) <ROWS> — Status and "What's missing", with evidence naming your commit and decision;
recompute the MK cluster line and the three tier rows of the Scoreboard (score = Σ weight ×
credit / Σ weight; ✅ 1 · 🟡 0.5 · ❌ 0; Critical 3 · High 2 · Normal 1; ⏸ excluded; a row counts
in every tier from its own Gate on) and the "Critical flows not yet ✅" list; add one §Score
history line in the file's format ("CK1 (#NNN): MK-29 ❌ → ✅ (…)"). If your prompt names a PRD-
row, update documentation/readiness/PRODUCTION_READINESS.md the same way. Use 🟡 when a hosted or
human step is left, and name it; never flip a row on a test you did not run. Other sessions edit
both files: re-read right before you edit, change only your rows and the computed lines. A gap you
find and do not fix gets a new row at the end of its section (IDs are never reused), never
silence. Finish with: what you built; the rows you moved (old → new); every probe and test you
ran, with its result; every 🧑 question still open.
```

---

## 2. Existing work orders — what changed since they were written

Paste the source file's own header, then MONEY's addendum where MONEY names one, then the prompt as
written, then the delta below, then §1.2 with the rows given. Only the delta is new.

| Prompt        | Source                 | `<ROWS>` for §1.2                                  | Delta (re-verified 2026-11-18 at `b7280787`)                                                                                                                                                                                                                                                                       |
| :------------ | :--------------------- | :------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB6           | FBP §3 · MONEY §4      | (MK-31's prerequisite)                             | MONEY's delta stands. Nothing here changes it.                                                                                                                                                                                                                                                                     |
| DB19          | FBP §3 · MONEY §4      | MK-31 (with DB21)                                  | **Skip step 1 if CK2 has landed**: CK2 builds the per-account cap with the seller's codes. Step 2's links: #457 gave `order_lines` its `project_id` / `escrow_id` for this trigger, and CK1's entitlement carries a product line's status (`refunded`).                                                            |
| DB21          | FBP §3 · MONEY §4      | MK-31 → ✅ only once MR3 lands too                 | MONEY's delta asks whether the buyer's download path writes `files.download_events`: **CK1 is that path**, so run DB21 after CK1, and judge "downloaded" by ruling A8 as CK1 records it. A cancel or a buyer win also sets CK1's entitlement to `refunded` (the route then 404s). The buyer's order view is CK3's. |
| MR3           | MONEY §5               | MK-31's operator half                              | Carry the refund-destination question (§0.3, counsel) into MR7's brief.                                                                                                                                                                                                                                            |
| DB17 → UI5    | FBP · MONEY §4         | MK-28 → ✅                                         | MONEY's delta stands.                                                                                                                                                                                                                                                                                              |
| SBP S1 → S4   | SBP · MONEY §4         | MK-24 → ✅ once an on-account order is walked live | MONEY's delta stands. `place_on_account_order` (`00001250:494-617`) also needs a KYB-verified business; the plan gate sits in `set_invoicing_terms` (`00001210:~1240`).                                                                                                                                            |
| SCH-WP7       | SCH §… (`:1045`)       | MK-40 → ✅ (with SC3)                              | Run right after SC3, in the same slot: SC3 opens the cohort, and step 5 schedules its later sittings. Its 🧑 at step 6 (#344 (f)) stands. Step 8 (`cancelSeat`, S-22) closes Calls & sessions MK-53, which is not this file's row.                                                                                 |
| T&S P2a       | T&S §… (`:496`)        | —                                                  | Add `reviews.entity_reviews.title`, `comment` and `reply_comment` to the public copy it refuses at the floor (RV1 makes them writable).                                                                                                                                                                            |
| T&S R1 → R2   | T&S (`:722`, `:926`)   | MK-47 (with SC8, SC9)                              | `ops.reports`' proposed subject CHECK (SA:1265-1279) has `listing` but no `review`: add `review`. R1's `source` also takes `notice`, with no reporter (#496 (A)). R2's listing entry point is MK-47's report half, and RV1's reviews need a Report action from it.                                                 |
| T&S SN2 → SN3 | T&S (`:1029`, `:1082`) | MK-41 → ✅                                         | SN3 hooks `cutShowcaseRendition` in `live-catalogue-writes.ts`. SC4 must have landed first, so no listing reaches `published` around the gate.                                                                                                                                                                     |
| COMMS NT3     | COMMS                  | MK-25's note (and MK-13's)                         | CK5's email rides it.                                                                                                                                                                                                                                                                                              |

---

## 3. Basket, checkout & orders — new prompts

### CK1 — A bought product reaches its buyer (ASSET Phase 0)

Closes MK-29 (❌ → ✅) and MK-37's delivery half; clears MK-08's note.

```text
PROMPT CK1: A bought product reaches its buyer — entitlements, frozen versions, the originals
zone, the download route and the purchases view (ASSET_DELIVERY_ARCHITECTURE.md §14 Phase 0)

ROLE: Full-stack engineer (Postgres + Deno services + one view). Queue M: you hold 00001210 and
00001170 while this runs.

CONTEXT (verified at b7280787; re-check every line):
  - No buyer can receive a purchased file. finance.place_wallet_order (00001210:1326) inserts the
    product line at ~:2153-2166, keeping only `manifest -> 0`, and never writes
    finance.order_lines.asset_id (00000017:1305). live-orders.ts prints "the seller hasn't
    attached files" (:359) because the download link needs asset_id (:386). files.fn_can_read
    (00001160) has no purchase arm.
  - A product's files are catalogue.products.file_manifest jsonb (00000023:91): entries are
    AttachmentRefSchema {name, mime, size, fileId?} (packages/types/catalogue/offer.ts:46-63, at
    most 24), each fileId a seller library files.items row in the private personal / workspace
    bucket, checked by catalogue.fn_listing_file_ok (00001170:235-257) inside save_listing. The
    `catalogue` bucket is public and images-only (00005040:162-170). The seller fills it through
    features/catalogue/components/edit/offer/AttachmentList.tsx.
  - The design: ASSET_DELIVERY_ARCHITECTURE.md §3 invariants, §4 storage isolation, §6 the
    protected request pipeline, §10 the data model (product_versions and entitlements now;
    deliveries and licence_tokens are later phases), §11 the route contract, §12 config and the
    two Dev Context Switcher axes, §14 Phase 0. PRODUCT_SPEC.md §Digital Marketplace 6 and 7.
    ROUTING.md §Proposed: asset delivery and protection, and the purchases view
    `/files?source=purchases`.
  - files.download_events exists (00000010:319). MONEY's DB21 delta judges "downloaded" from it:
    what you record is what DB21 reads.

🧑 DECISION (before step 2) — the two #393 rulings Phase 0 depends on. Put both to me with the
spec's recommendation:
  A6: sale originals are a third zone, exempt from automatic elevation, and snapshotted at
      publish, never shared with the seller's working copy (recommended; amends PRODUCT_SPEC
      §Assets & Attachments).
  A8 (⚖️): what counts as "downloaded" for the refund rule. Recommended: the first completed
      delivery of any file of the line (a reader session joins this once a reader exists), and
      the buyer expressly accepts that at checkout, before Pay, on any line with files.

STEPS:
  1. Red first: supabase/probes/product_delivery.sql buys a seeded product as a seeded persona
     and asserts an entitlement exists for the line. It fails today.
  2. Schema, in place (§10): the files.asset_purpose / variant_tier values (00000004), the
     entitlement_status enum, catalogue.product_versions and catalogue.entitlements with the
     `ent-` slug (security.fn_slug_guard('ent'), Decision #88), indexes (00004012), the private
     `originals` bucket with no policy (00005040), RLS and grants (00002020, 00002520, 00002510
     by name). Decide and document what order_lines.asset_id now means (the entitlement's
     version, or reserved); never drop it.
  3. Publish freezes a version (A6): set_listing_status's publish arm (00001170) writes the next
     product_versions row from file_manifest. Bytes cannot be copied into `originals` from SQL:
     design the service-side copy plus a definer that marks the version ready, and say how a
     purchase made before then behaves (the route answers 503 + Retry-After, never a broken
     file). A re-publish with changed files makes a new version; an entitlement keeps its own
     (updates_until is a later phase: leave it NULL and say so).
  4. Purchase writes the entitlement (§10 "Money path"): inside place_wallet_order, in the same
     transaction as its order line, held by the order's owner. Prove that place_on_account_order
     reaches it too. A concurrency probe (two parallel checkouts of one product) passes.
  5. GET/HEAD /api/downloads/[entitlement]/[fileId] (§6, §11): a thin route over
     DeliveryBackendService.stream; the holder, or a member of the holding entity, only;
     streamed through the app, never a signed read URL (ruling A2's recommendation); §5.4's
     header matrix; Range / 206 and 304; 404 for anything not entitled, a refunded entitlement
     included. Record each completed delivery (entitlements.first_delivered_at and a
     files.download_events row): that is the A8 fact.
  6. Checkout: on /checkout/payment, a line with files carries the A8 acknowledgement (a required
     disclosure, InlineNotice + a checkbox that gates Pay, its words in PRODUCT_SPEC). The
     confirmation's download lines link to the route, and live-orders.ts / OrderLineRow stop
     printing "hasn't attached".
  7. The purchases view `/files?source=purchases`: every entitlement the acting account holds,
     newest first, each file downloadable, a refunded one shown as such. Follow the /files
     feature's layout; add a component only if the roster lacks one (then DESIGN_SYSTEM §C.1).
  8. Seed: at least two seeded products whose manifests point at real seeded files (uploaded by
     the bucket seeding), so a fresh `deno task db:reset` can be walked end to end. Dev Context
     Switcher: pj.dev.delivery and pj.dev.entitlement (§12).

ACCEPTANCE: product_delivery.sql is green (the entitlement is written; a refunded or a foreign
entitlement 404s through the service; concurrency holds); finance_invariants.sql passes. Live, as
a seeded buyer: pay by wallet, then by card in test mode, and download every file of a two-file
bundle; a second persona gets 404 on the first's URL; the A8 box gates Pay. Screenshots of the
confirmation and the purchases view.

SAME CHANGE: ASSET_DELIVERY_ARCHITECTURE.md (Phase 0 built; §2's stale refs corrected);
PRODUCT_SPEC.md §Digital Marketplace 6-7 (markers; A6 and A8's words); ROUTING.md (the routes
move from Proposed to live); documentation/database/{catalogue,files,finance}/*; Zod
(packages/types/catalogue/*); the decision row (A6, A8 ruled; Decision #393 updated).
```

§1.2 rows: **MK-29** ❌ → ✅ (and its stale `:376`); **MK-37** → ✅ if originals are private and
snapshotted; **MK-08**'s note cleared.

### CK2 — Sellers issue promo codes; one redemption per account; a throttled route

Closes MK-26 (🟡 → ✅).

```text
PROMPT CK2: A seller issues and retires promo codes for their own products; an account redeems a
code once by default; the promo route is throttled

ROLE: Full-stack engineer. Queue M: 00000017, 00001210 (after CK7).

CONTEXT (verified at b7280787; re-check every line):
  - finance.promo_codes (00000017:992-1021) has no issuer column. It is definer-only (00001210
    ~:1129; grants 00002520 ~:813). Its only writers are seeds and probes
    (supabase/seeds/07_finance.sql:243); the only function write is redemption_count (00001210
    ~:1880). There is no max_redemptions_per_account (FA CO7, which is FBP DB19 step 1, not
    started). routes/api/basket/promo.ts has no rate limit (FA CO22, "Open, no prompt").
  - Rules: PRODUCT_SPEC.md §Digital Marketplace 6 ("each account may redeem a code once; a code
    may allow more"); finance-model.md §1.2 (the seller's commission is taken on what the buyer
    paid for the line, after any promo) and §15; Decision #337 ruling M8. #457 prices a One-Off
    or Task line with no promo: read which line kinds take one today and keep that set unless I
    rule otherwise.
  - The seller's console is /catalogue (apps/web/features/catalogue/**), with URL-addressed views
    (`?view=`).

🧑 DECISION (before step 2): who may issue a code, and who funds the discount. Put this to me:
  A (recommended): a seller (a person, or a team member holding the team's catalogue capability)
     issues codes for their own product listings (all of them, or chosen ones); the seller funds
     the discount, and commission is taken on the discounted price, as finance-model §1.2
     already says. Platform-wide codes stay operator-only, unchanged.
  B: as A, and a seller's code may also cover their session lines.
  C: platform codes only; an ops door replaces the seller one.
  RULED #485 (2026-11-18): A. The team issuer asks catalogue.fn_manages_listing /
  org.fn_member_can('team', …, 'publish_listings') (#485 (b)). #485 (a) RULED: the platform
  pays for a platform code. The seller is credited as if the code had not applied (commission on
  the line before the platform's share). The cost is a new v_conservation_identity term, so CK2
  also waits for FBP DB16.

STEPS:
  1. Red first: extend supabase/probes/promo_redemption_concurrency.sql. Today the same
     account's second use succeeds (it should be PC409), and no seller can create a code.
  2. Schema in place: the issuer (owner type + id; NULL = the platform), the listing scope,
     archived_at (nothing is hard-deleted), and max_redemptions_per_account integer DEFAULT 1
     CHECK (> 0), with NULL meaning unlimited. Doors (SECURITY DEFINER, search_path ''):
     finance.save_promo_code, archive_promo_code and list_own_promo_codes, each checking the
     capability itself.
  3. FBP DB19 step 1, here: under the promo row's existing FOR UPDATE, count this owner's orders
     that used the code, in every status (a refund does not give a redemption back). Refuse
     PC409 'promo_already_used'. resolve_promo_code refuses first, so no basket shows a discount
     the commit will refuse; checkout-refusal.ts maps it to buyer copy.
  4. In a mixed basket a seller's code discounts only that seller's eligible lines.
  5. Throttle POST /api/basket/promo per account and per client key with the helper the auth
     routes use (apps/web/utils/client-key.ts; routes/api/auth/confirm.ts): 429 with
     Retry-After, so a burst cannot enumerate codes.
  6. UI: a Promotions view in the seller console (`/catalogue?view=promotions`, in ROUTING.md):
     create, list (code · discount · n of m redeemed · expiry, as MetaLine text), archive.

ACCEPTANCE: the promo probe: one account's second use → PC409 at preview and at commit; two
accounts both succeed; max_redemptions holds under concurrency; a seller's code never discounts
another seller's line; commission is on the discounted price. A 30-request burst on the promo
route draws 429s. finance_invariants.sql passes. Screenshots of the Promotions view.

SAME CHANGE: PRODUCT_SPEC.md §Digital Marketplace 6 and finance-model.md §15 (the per-account
marker removed; the issuer rule as ruled); FBP DB19 (step 1 marked done by CK2); FINANCE_AUDIT.md
CO7 and CO22; finance-model.md §1.2 ("after any seller-funded promo", #485 (a));
documentation/database/finance/*; Zod; ROUTING.md; the decision row.
```

§1.2 rows: **MK-26** 🟡 → ✅.

### CK3 — Every past order, and a block's receipt names every sitting

Clears MK-30's note.

```text
PROMPT CK3: A buyer finds every past order, and a block's receipt names every sitting

ROLE: App engineer (services + islands). App lane, after CK1 (you share live-orders.ts).

CONTEXT (verified at b7280787):
  - readOrderPage (packages/backend/services/finance/live-orders.ts:524-546) returns the named
    order plus the 20 most recent (limit(20) at :530); findOrder (:556) fetches one outside that
    window. No order-history route exists (apps/web/routes, ROUTING.md).
  - Decision #453 flag (c): OrderLineRow labels a block by its first sitting, because
    order_lines keeps only scheduled_at.
  - `?order=` names an order on /checkout/confirmation (ROUTING.md:629). Orders have no prefixed
    slug (there is no fn_slug_guard('ord')).

STEPS:
  1. Red first: a unit test that a buyer's 21st order is unreachable from any list.
  2. An order history for the acting account, following the basket's owner switch (personal,
     team, business): keyset-paged on (created_at, id), never offset. Put it under an existing
     segment, because a new top-level segment needs SECURITY_ACCESS SAC5's reserved-handle work.
     Propose the path in ROUTING.md first (recommended: `/checkout/orders`); each row opens the
     existing confirmation view by `?order=`.
  3. Each line links to its home: a download line to CK1's purchases view, an engagement to its
     project, a session or seat to its session workspace.
  4. #453 (c): a block's line lists every sitting, read from the sittings through the line's
     session link, never copied onto order_lines.
  5. If `?order=` carries a raw uuid, that is a Decision #88 gap: add a row for it (USER_FLOWS or
     PRODUCTION_READINESS). Do not mint slugs here: 00000017 belongs to Queue M.

ACCEPTANCE: a seeded buyer with 25+ orders (seed or create them) pages through all of them; a
three-sitting block lists three times on its receipt; the keyset reader has unit tests.
Screenshots.

SAME CHANGE: ROUTING.md; the decision row closing #453 (c).
```

§1.2 rows: **MK-30**'s note cleared (it stays ✅).

### CK4 — Tax at checkout, built behind a switch that stays off

Narrows MK-20 (it stays 🟡 until the switch is on); narrows PRD-M5.

```text
PROMPT CK4: Tax is calculated, shown and recorded at checkout and on invoices — built behind a
switch that stays off until the owner and counsel rule

ROLE: Payments engineer (Stripe + Postgres). Queue M, after DB21: 00000017, 00001210, 00001200.

CONTEXT (verified at b7280787):
  - There is no tax anywhere. taxNote: null in CheckoutBackendService.ts:215 (with a "no tax
    engine" comment), checkout-ssr.ts:269 and live-orders.ts:476; fn_generate_consolidated_
    invoice hard-codes v_tax bigint := 0 (00001200:1407; FINANCE_AUDIT A9's "F1200:~788" is
    stale). Zod already accepts tax as an input (packages/types/finance/checkout.ts:441-538,
    order.ts:245-256).
  - A9 is "Planned, no prompt" (FBP §0.6) and PRD-M5 is ❌. PRODUCT_SPEC.md :3539-3555 promises
    tax documents (1099, W-9, EU reverse charge).
  - The platform charges the buyer itself under Separate Charges & Transfers, settles in the
    nine currencies a GB platform can (#423 (B)), and a wallet order spends a balance topped up
    earlier.
  - Use the stripe:stripe-best-practices and stripe:stripe-docs skills for the current Stripe Tax
    API (calculations, transactions, reversals, registrations, product tax codes) before you
    design anything.

🧑 + ⚖️ DECISION (before step 2): the tax model. Put this to me, and say plainly that counsel must
confirm the obligation before any switch goes on:
  A (recommended): the platform calculates tax on every order, card and wallet alike, at the
     order (never at top-up), with Stripe Tax: a calculation at /checkout/payment's preview, a
     tax transaction recorded at commit and reversed on refund. A business buyer may give a VAT
     ID on /checkout/details for reverse charge. Invoices carry tax lines from the stored
     calculation. Registrations are yours, in the Stripe Dashboard. All of it behind
     `tax_collection_enabled` (a platform param, off).
  B: no tax collected at launch; checkout, receipts and invoices say plainly that prices exclude
     tax and who is responsible for it, in words counsel approves. Still behind a param, so A can
     follow.
  Either way, a table for me to confirm: which product tax code a digital product, a service
  engagement and a session each take.
  RULED #490 (2026-11-18): A, split by kind · tax added at checkout (tax-exclusive) · the codes as
  tabled in #490 (C) · wait for DB21. The engine is A's whole, but the platform collects only on
  the kinds tax_collected_kinds names (digital_product by default); every other line says the
  seller is responsible for any tax on their work. Skip this block when you run: re-verify DB21 at
  HEAD and stop if it has not landed (#490 (f)). Counsel still confirms before any switch goes on.

STEPS (for A; for B, steps 1, 3 and 5 only):
  1. Red first: a unit test that a GB consumer buying a digital product, with the switch on, sees
     a tax line; an invoice probe that v_tax is not 0 when the switch is on.
  2. Schema in place: the tax amount, jurisdiction and calculation reference on orders and lines
     (integer minor units), and the buyer's tax ID on the order; doors only.
  3. Checkout: taxNote and a tax line in the summary from the calculation, recomputed when the
     details change. With the switch off, today's behaviour exactly, pinned by a test.
  4. Commit: the calculation reference is recorded inside place_wallet_order's transaction; the
     Stripe tax transaction is created after commit, idempotently (finance.idempotency_keys), and
     reversed by the refund paths (DB21, MR3).
  5. Invoices: fn_generate_consolidated_invoice sums the stored tax lines, and the PDF shows them.

ACCEPTANCE: with the switch off, every existing checkout and invoice test passes unchanged. With
it on, in test mode: a GB consumer, an EU business with a VAT ID and a US buyer each get the tax
Stripe returns, recorded and shown; a refund reverses it; finance_invariants.sql passes.

SAME CHANGE: finance-model.md (a Tax section); PRODUCT_SPEC.md (the ruled rule, marked "Not
switched on" until counsel); SYSTEM_ARCHITECTURE.md §Environment Variable Contract and
.env.example if you add a key; FINANCE_AUDIT.md A9; documentation/database/finance/*; Zod; the
decision row.
```

§1.2 rows: **MK-20** stays 🟡 with the note "built, off pending counsel"; → ✅ when the switch is on
in the target environment. **PRD-M5** narrowed (the checkout half).

### CK5 — The abandoned-basket nudge

Clears MK-18's note.

```text
PROMPT CK5: A basket left idle gets one reminder, within the notification rules

ROLE: Backend engineer (Postgres jobs + comms). Queue C: 00005060 and the comms emitter.

CONTEXT (verified at b7280787):
  - The catalogue row exists: basket.abandoned (00005010:89; email, low, group window 3 days,
    lead 1 day), key in packages/types/comms/catalog.ts:109. Nothing emits it. The queue worker
    exists and names "basket nudges" (00005060 ~:144). comms.fn_enqueue already has a caller
    (00001510:3143), whatever documentation/database/comms/Functions.md:131-135 says.
  - The two tracks each hand it to the other: COMMS NT1 step 6 (COMMS_BUILD_PROMPTS.md:848) gives
    the caller to FBP SV4; SV4 step 5 (FBP:1906) and FBP §0.6 give it back (FA (t), CO15). This
    prompt owns it.
  - Email delivery is COMMS NT3's; until NT3 lands, the nudge is in-app.

🧑 ⚖️ DECISION (before step 2): is the nudge marketing? Recommended A: treat it as marketing — sent
only to a person whose notification preferences allow the category, with a one-step opt-out in
every message, never to a 13-17 account — and counsel confirms. B: a service message, sent to
everyone with a basket, if counsel agrees.

STEPS:
  1. Red first: a probe. A basket with a line, idle past the lead time, enqueues nothing today.
  2. A daily job (00005060) and a definer finder: baskets with at least one live line, untouched
     for the row's lead time, whose owner has not ordered since and has not been nudged inside
     the group window. One notice per basket per window. The payload names the lines but never a
     price that may have changed: the link opens /checkout, which reprices.
  3. Respect preferences and quiet hours exactly as comms.fn_notify does for other low notices.

ACCEPTANCE: the probe: an idle basket → one enqueue; a second run inside the window → none; a
checked-out or emptied basket → none; an opted-out person → none.

SAME CHANGE: documentation/database/comms/Functions.md (the stale "no caller" line, and the new
emitter); COMMS_BUILD_PROMPTS.md NT1 step 6 and FBP SV4 step 5 / §0.6 (both now say CK5 owns
it); FINANCE_AUDIT.md (t) / CO15; the decision row.
```

§1.2 rows: **MK-18**'s note cleared (it stays ✅).

### CK6 — Express pay you can prove

MK-23 → ✅ once your device runs are recorded.

```text
PROMPT CK6: Apple Pay, Google Pay and PayPal can be proven on a hosted domain

ROLE: Payments / front-end engineer. App lane.

CONTEXT (verified at b7280787):
  - Built: apps/web/features/checkout/components/ExpressCheckoutElement.tsx (Stripe's Express
    Checkout Element with a deferred intent, provider `express`, Decision #153);
    features/payments/core/stripe-js.ts:57-79; capability flags in
    routes/api/checkout/session.ts:9-17.
  - Missing: apps/web/static has no .well-known; no domain is registered as a payment method
    domain; nothing proves the PayPal redirect return. documentation/api/
    EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md §F (:447-452).
  - Use the stripe:stripe-docs skill for the current payment-method-domain and Apple Pay domain
    association requirements.

STEPS:
  1. Serve the Apple Pay domain association file at the path Stripe requires, from a committed
     public file or an env-driven value, as Stripe's current docs say (it is not a secret).
  2. `deno task stripe:domains`: lists, and with --apply registers, payment method domains for
     the hosts in env, idempotently, refusing a live key. It never prints or stores a secret.
     The human runs --apply; you only dry-run it.
  3. Prove the redirect return: a PayPal (or any redirect method) return to /checkout/payment
     with redirect_status lands on the confirmation exactly once — a unit test, and a Playwright
     test in test mode where the method is offered.
  4. A runbook (EPI spec §F, linked from SYSTEM_ARCHITECTURE.md §Integration Blueprints):
     register the domains, then pay a test-mode order on a real iPhone (Safari, Apple Pay) and an
     Android phone (Chrome, Google Pay), and record each run where the runbook says.

ACCEPTANCE: the association path serves the right body and content type locally; the task's dry
run lists the hosts; the redirect tests pass.

SAME CHANGE: the runbook; SYSTEM_ARCHITECTURE.md §Environment Variable Contract and .env.example
for any key; the decision row.
```

§1.2 rows: **MK-23** stays 🟡 ("built; the device runs are yours") until the runs are recorded, then
✅.

### CK7 — An accepted quote is paid at its price (adjacent: MK-16)

Closes MK-16 (Listing view, 🟡 → ✅).

```text
PROMPT CK7: An accepted quote offer is paid at its offered price and becomes its funded engagement

ROLE: Postgres payments engineer. Queue M: 00001210, after CK1.

CONTEXT (verified at b7280787):
  - #458 (LV5) lets a seller answer a request with a priced offer that the buyer accepts into one
    basket line, a one_off_service line (00001177 ~:499, ~:769). Its flag (a): checkout has no
    quote branch. place_wallet_order has no offer path, so the line falls into the
    listing-priced branch (00001210 ~:1547-1590, fn_scoped_service_price), and the engagement
    call (~:2047) passes no p_terms. marketplace.fn_buy_scoped_service (00001175:743) already
    takes p_terms, and fn_write_blueprint_stages has the seam (#457 (B)). LV2's wait is met.
  - Its flag (b): an accepted offer has no payment deadline.

🧑 DECISION (before step 3): an accepted offer left unpaid. Recommended A: the offer's own
seller-set expiry (3-30 days, #458) still bounds payment; past it the line refuses PC409 and the
buyer may ask again. B: a fixed payment window after acceptance (a platform dial).

STEPS:
  1. Red first: a probe. Accept a seeded offer priced below the listing, check out: today the
     line is charged the listing's price, or refused.
  2. place_wallet_order: a line that names an offer is priced from the offer (accepted, the
     buyer's own, not superseded, not expired, in the same currency) and handed to
     fn_buy_scoped_service as p_terms, so its milestones are the offer's checklist in one escrow
     (#458's ruling). Refusals in checkout's own words (checkout-refusal.ts).
  3. The ruled deadline.

ACCEPTANCE: the probe: the order and the escrow equal the offer; a superseded or expired offer
refuses; finance_invariants.sql passes. Live: request → offer → accept → pay → the engagement's
board shows the milestones.

SAME CHANGE: documentation/database/{finance,marketplace}/*; PRODUCT_SPEC.md (the deadline
rule); the decision row closing #458 (a) and (b).
```

§1.2 rows: **MK-16** 🟡 → ✅ (and its stale "after LV2" text).

---

## 4. Reviews — new prompts

### RV1 — A buyer reviews what they completed; the seller replies once

Closes MK-32 (❌ → ✅); clears MK-34's note.

```text
PROMPT RV1: A buyer reviews what they completed — an engagement, a purchase or a session — and
the seller replies once

ROLE: Full-stack engineer (Postgres doors + services + one dialog). Queue C: the reviews files,
00002500 / 00002510 / 00002520 (after SAC1), 00005010, 00005060, the review seeds.

CONTEXT (verified at b7280787; re-check every line):
  - One table, reviews.entity_reviews (00000019:5-47): a polymorphic target (review_target_type:
    user, freelancer, business, team, service_blueprint, product), reviewer_user_id, a nullable
    project_id, rating numeric(3,2) from 1 to 5, title, comment (at least 100 characters),
    reply_comment (at least 100) and replied_at. UNIQUE(target_entity_id, reviewer_user_id,
    project_id): NULLs are distinct, so it bounds nothing without a project. No indexes.
  - RLS has one SELECT policy, USING (true) (00002018:49-50); its comment (:52-63) says writes
    wait for "the engagement-checked review RPC". But 00002500:204 GRANTs ALL on the schema's
    tables to anon and authenticated (Decision #83 flagged it), so RLS is the only barrier.
  - trg_update_ratings (00001800:42-44) runs reviews.recalculate_entity_rating (00001005:22-69),
    which writes rating_average / rating_count onto six owner tables (guarded by
    security.fn_guard_derived_columns, 00001895:86).
  - Readers: live-view.ts:423-474 (listing reviews; verifiedEngagement = project_id !== null;
    reciprocal hard-coded false) and :504-560; live-profile.ts:590-605; org.get_profile_reviews
    (00001040:598-643). UI: features/view/islands/ReviewsPanel.island.tsx (#evp-reviews) and
    features/profile/islands/ReviewsList.island.tsx. Nothing writes a review; nothing reads
    reply_comment.
  - Notices seeded, never emitted: review.received (00005010:91, URL /{handle}/reviews, which is
    wrong for a listing target) and review.reminder (:92). session_events.review_asked_at exists
    (00000015:922-925).
  - Rules: PRODUCT_SPEC.md §Reputation 3 (:3303-3326): Atomic Reviews (a project or service is
    "completed, or a freelancer must have exited"); Entity Consolidation ("only one aggregate
    review per business-freelancer engagement"); Reciprocity is RV2's. The spec is silent on the
    window, edits, the reply and moderation. Decision #244 flag (e) asks this work order to rule
    the one-aggregate scope.
  - Anchors that exist: projects.status `completed`; stage_assignments.status `released` (ended
    after work began); session_events `completed` with attendance; a `completed` cohort
    membership; an order line with fulfilment `download`, whose verified purchase is CK1's
    entitlement.
  - Seeds: 37 listing reviews with project_id NULL (seeds/05_catalogue.sql:438-477, from
    seeds/gen/reviews.ts) and 4 engagement reviews (06_projects.sql:223-228); none has a reply.
  - No report path exists yet (T&S R1, R2 not started).

🧑 DECISIONS (one sitting, before step 2). Put each with its recommendation:
  1. Who may review what. Recommended: the client side of a completed engagement, or of a seat
     released after work began, reviews the provider (freelancer, team or business): one review,
     shown on the listing the engagement came from through its anchor. A buyer whose entitlement
     is active and has been delivered at least once reviews the product. The attendee of a
     completed sitting, or of a completed cohort membership, reviews the session listing. Nobody
     reviews themselves, their own team or their own business; a 13-17 account never writes one.
  2. The window and edits. Recommended: open for 30 days from the anchor's completion; the author
     may edit until the window closes or the seller replies, whichever comes first; the author
     may withdraw a review (hidden, kept), never delete it.
  3. The reply. Recommended: one public reply per review, by the target's owner or a member
     holding the entity's catalogue or profile capability, editable for 7 days. The comment's
     100-character floor stays; the reply's becomes 1-1,000 characters.
  4. #244 (e), one aggregate. Recommended: one review per (anchor, reviewing party, target),
     where a business client is one party however many of its members took part.

STEPS:
  1. Red first: supabase/probes/reviews_writer.sql. As authenticated, a direct INSERT into
     reviews.entity_reviews succeeds today (it should be 42501), and no door exists.
  2. Schema in place: an explicit anchor (nullable FKs to the project or seat, the order line,
     the sitting or the cohort membership, with a CHECK of exactly one on door-written rows),
     edited_at, withdrawn_at, hidden_at + hidden_reason (operator), a unique index for ruling 4,
     and the indexes the readers need (00004xxx).
  3. Doors (SECURITY DEFINER, search_path '', every name qualified): submit_review, edit_review,
     withdraw_review, reply_to_review and edit_reply; reviews.hide_review for an ops.admin_users
     member. Eligibility lives in the doors. 00002500: the schema's tables become SELECT-only for
     anon and authenticated (the GRANT ALL goes); 00002510 grants the doors by name.
  4. The rating trigger counts visible reviews only (neither withdrawn nor hidden).
  5. review.received goes to the target's owners through comms.fn_notify, with a URL that fits
     the target (a listing → its /view page at #evp-reviews; a profile → /{handle}/reviews); fix
     the catalogue row. review.reminder: a daily job (00005060) asks once per eligible anchor and
     sets review_asked_at for sittings.
  6. UI: one ReviewDialog, addressable as `?review=<anchor slug>` on the surface that hosts it
     (in ROUTING.md), opened from the anchor's home: CK3's order history and CK1's purchases
     view (if they have landed; otherwise leave a FLAG), the project's completion surface, and
     the session workspace after a sitting. Reply and Edit are tier-5 text actions on the review,
     shown to whoever may use them; the reply renders under the review.
  7. Readers: verifiedEngagement means "has an anchor"; the reply shows; hidden and withdrawn
     reviews leave every reader, every aggregate and the public part of the data export.
  8. The seed obeys the rule you ship: regenerate seeds/gen/reviews.ts so every seeded review has
     a seeded anchor (never relax the CHECK for seed data), and seed two replies.
     `deno task db:seed:generate`, then `deno task db:reset` (announce it).
  9. If the UI branches on a review-eligibility state, that state gets its Dev Context Switcher
     control.

ACCEPTANCE: reviews_writer.sql: direct writes are refused for anon and authenticated; each refusal
(no anchor, not the reviewer, self or own entity, outside the window, a duplicate under ruling 4,
a minor) has its SQLSTATE; a valid review moves the target's average, and hiding it moves it back;
there is one reply only. Live, as two seeded personas: complete → review → the seller is notified
→ replies → both render on /view and on /{handle}/reviews. Screenshots.

SAME CHANGE: PRODUCT_SPEC.md §Reputation 3 (the ruled rules); PRODUCT_MANAGEMENT.md (the review
lifecycle: submitted · edited · withdrawn · hidden, and the reply); documentation/database/
reviews/* (Tables.md:43 and Policies.md:14-15 corrected, and the 00002018 comment); Zod inputs;
ROUTING.md; the decision row closing #244 (e) and #83's reviews half.
```

§1.2 rows: **MK-32** ❌ → ✅ (the "What's missing" cell cites T&S R2 for the user-facing Report
entry point); **MK-34**'s note cleared.

### RV2 — Providers review clients; the Client Trust Score and its warning

Closes MK-33 (❌ → ✅).

```text
PROMPT RV2: The provider reviews the client too, double-blind; the Client Trust Score and its
warning

ROLE: Full-stack engineer. Queue C, after RV1.

CONTEXT (verified at b7280787):
  - PRODUCT_SPEC.md §Reputation 3: Reciprocity (ratings feed the "Client Trust Score") and a
    Warning System (a search penalty, a warning modal, "Informed Consent" before a proposal or a
    hire). :3419-3423: until the score's weighting is defined, a business shows its client rating
    (#244). :3496-3498 names a "Business Trust Score": one score, or two? That is a new
    contradiction.
  - Decision #244 flag (c): the Client Trust Score "has no definition or weighting".
  - org.get_profile_reviews already reads author_role = 'freelancer' (a provider reviewing a
    client), and live-view.ts:504-560 shows a project owner's client reviews (#142).
    packages/types/profile/tabs.ts:180 labels `freelancer` "fellow freelancer", which is wrong.
  - finance-model.md §16.7: review_sentiment 1.75, review_count 1.00, a cold-start prior of 5
    pseudo-reviews per track, volume saturating at 50.

🧑 DECISIONS (before step 2):
  1. Reveal. Recommended: double-blind. Neither side's review of the other is visible until both
     have submitted or the window closes, so neither can retaliate. It becomes a spec rule.
  2. Client Trust Score v1. Recommended: the Bayesian mean of providers' ratings of the client
     with §16.7's prior, with disputes lost and ghosting auto-approvals (PM's 14-day rule) as
     named deductions, shown only past 3 reviews. I propose the numbers; you set them.
  3. The warning. Recommended: below 3.0 with at least 3 reviews, a demotion weight in Explore's
     project-opening ranking (search.search_weights), and a modal a freelancer must acknowledge
     before applying or accepting a hire (logged: that is the Informed Consent).
  4. One score or two (Client vs Business Trust Score). Recommended: one score per client party,
     a person or a business, under one name. Log the contradiction as a decision row either way.
  RULED #486 (2026-11-18): all four as recommended; skip this stop. The numbers: k = 5 at the
  client-track mean; −0.25 per dispute the client opened and lost (resolved_release) in 12
  months, capped at −1.00; ghosting −0.10 each, capped at −0.50, dormant until #337 P3's
  auto-approve is built; floor 1.00; shown from 3 reviews; warned below 3.00. The `client_trust`
  coefficient is unset (#486 (c), proposal 2.50). RV2 waits for RV1, re-verified at HEAD.

STEPS:
  1. Red first: a provider cannot review a client today, and the SELECT policy shows every
     review at once.
  2. RV1's doors take the provider → client direction on the same anchors (a released seat, a
     completed engagement), targeting the client party.
  3. Reveal: the SELECT policy and the readers hide an unrevealed review from everyone but its
     author; the second submit, or a job at the window's close, reveals the pair; review.received
     fires at reveal.
  4. The score: a definer computes it and stores it where the profile and Explore read it,
     recomputed on reveal; readers show it per the ruling (MetaLine text, no new badge).
  5. The warning: the ranking weight, and the acknowledgement modal (one dialog at a time).
  6. Fix tabs.ts's label; live-view.ts's `reciprocal` becomes real.

ACCEPTANCE: a probe: a provider's review stays hidden until the client's arrives or the window
closes; the scores match a hand-computed fixture. A client under the bar demotes in a seeded
search, and the modal blocks Apply until acknowledged. Screenshots.

SAME CHANGE: PRODUCT_SPEC.md §Reputation 3 (reveal, score, warning); finance-model.md §16.7 if a
weight is added; documentation/database/{reviews,search}/*; Zod; the decision row closing #244
(c).
```

§1.2 rows: **MK-33** ❌ → ✅.

### RV3 — Standing reads real reviews

Closes MW-64 (new, #489; ❌ → ✅). It keeps Standing honest once RV1 writes reviews.

```text
PROMPT RV3: Standing's review component reads the reviews people actually wrote

ROLE: Postgres engineer. Queue C, after RV2.

CONTEXT (verified at b7280787): org.entity_standing's components.reviews is (client_rating_avg +
peer_rating_avg) / 10 × 20 (00001030:74), but no SQL writes either average; only seeds do
(seeds/11_standing.sql:107-127). Decisions #58-63 flag (h). The "peer" track has no target type or
writer (Seed.md:118), while the reviews table's two tracks are client and provider.
finance.ratings (00000017:365-374) is an unread legacy table.

🧑 DECISION (before step 2): what the peer track is. Recommended A: reviews between providers who
shared an engagement (teammates, freelancers on the same stages), written through RV1's doors on
the shared anchor. B: drop the peer track from the formula until it is specified, and weight the
client track alone.
RULED #489 (2026-11-18): B, and a review recomputes its subject; skip this stop. The
component is client_rating_avg / 5 × 20, the Bayesian mean of the subject's visible, revealed
client reviews (k = 5 at the delivery track's corpus mean); peer_rating_avg stays, reserved,
never written. A review write (RV1's submit, edit, withdraw, hide; RV2's reveal) calls
org.fn_recompute_standing for the reviewed subject only (#58 (e) narrowed for reviews). At HEAD:
the seed reads client_rating_avg from the cached rating_average, not a literal (only peer is,
seeds/11_standing.sql:116); no standing probe exists yet; fn_recompute_standing (00001030:51)
does not pin search_path = '', so RV3 pins it. #489 (a) ruled: the component is 0 until
the subject's first client review, then the prior applies. #489 (b): dispute_free is also 0 until
the first escrow (RV3 builds it with (a)). (c): a team's Standing reads only the team's reviews.
RV3 waits for RV2, re-verified at HEAD.

STEPS:
  1. Red first: a new review does not move Standing.
  2. Write both averages from visible, revealed reviews (with §16.7's prior) whenever one
     changes, through the derived-column guard.
  3. finance.ratings: mark it reserved in the docs (the Additive Rule: never dropped without my
     OK).
  4. Re-seed Standing from the seeded reviews instead of literals.

ACCEPTANCE: a review moves Standing's review component by the hand-computed amount; the standing
probes and finance_invariants.sql pass.

SAME CHANGE: PRODUCT_SPEC.md §Standing; finance-model.md; documentation/database/org/*; Seed.md;
the decision row closing #58-63 (h)'s ratings half.
```

§1.2 rows: **MW-64** ❌ → ✅ (new, #489). If Standing's display changes, update MK-06's note.

---

## 5. Seller catalogue — new prompts

### SC1 — `catalogue.listings` has a Zod row schema

Clears MK-35's note; narrows PRD-I3.

```text
PROMPT SC1: catalogue.listings has a Zod row schema, pinned to the table

ROLE: TypeScript engineer. App lane (no SQL).

CONTEXT (verified at b7280787): catalogue.listings (00000023:170-244) has 30 columns. The service
types it with a plain interface, CatalogueListingRow (packages/backend/services/catalogue/
live-catalogue.ts:67-95; 27 fields, missing order_count, rating_average and rating_count), and
LISTING_COLUMNS (:118). packages/types/catalogue/*.ts holds projections and inputs only. PRD-I3
(PRODUCTION_READINESS.md). The pattern: packages/types/finance/finance-tables.contract.test.ts
(a ROWS map with derived / rename / omitted, and columnDrift / tableColumns from
packages/types/core/table-contract.ts); local examples are
packages/types/catalogue/client-pipeline.contract.test.ts and
packages/types/projects/projects-tables.contract.test.ts.

STEPS:
  1. Red first: a contract test for catalogue.listings that fails against today's 27-field type.
  2. CatalogueListingRowSchema: every column, enums from their SSOT, derived columns marked.
     CatalogueListingRow becomes its z.infer, and LISTING_COLUMNS derives from the schema's keys,
     so the two cannot drift.
  3. Parse at the one read boundary where the service maps rows, not in every caller.
  4. List the catalogue tables still without a row schema in PRD-I3's evidence. Do not build
     them.

ACCEPTANCE: the contract test passes, and fails if a column is added without the schema;
`deno task check` and `deno task test:unit` are green.

SAME CHANGE: documentation/database/catalogue/Tables.md (names the schema); PRD-I3's evidence.
```

§1.2 rows: **MK-35**'s note cleared; **PRD-I3** narrowed (listings done; the comms message tables
remain).

### SC2 — A bought Pipeline keeps its CREATE category; the seed gains a tiered Pipeline and a plan

Clears MK-38's and MK-39's notes.

```text
PROMPT SC2: A bought Pipeline keeps its stages' CREATE category, and the seed holds a tiered
Pipeline and a planned session

ROLE: Postgres + seed engineer. Queue C: 00001175, supabase/seeds/gen/*.

CONTEXT (verified at b7280787):
  - marketplace.fn_write_blueprint_stages (00001175:284; the INSERT at :373-405) copies intensity
    and tier prices but not create_category. The source is catalogue.listings.create_category
    (00000023:196, per listing; the blueprint has no such column), joined through
    listings.service_blueprint_id. The target, project_stages.create_category (00000015:329), is
    written only by projects.create_stage (00001130:505, :543). #417 flags (c) and (f).
  - #338 P4 (whether the category stays a label) is open (PM_BUILD_PROMPTS.md:142), but
    documentation/database/projects/Tables.md:221 already documents it as "a label… never a
    weight". Copying a label is safe either way; do not weight it.
  - Seeds: supabase/seeds/gen/emit-catalogue.ts emitMarketplace (:99-185) emits no
    allow_tiered_intensity, no stage intensity or low / high prices, and no session_plan or
    session_rolling (#411 (f)); the corpus types are in gen/corpus.ts. Only the app fixture
    svc-brandpipe01 is tiered.

STEPS:
  1. Red first: extend supabase/probes/service_instantiation.sql to assert that a bought
     Pipeline's stages carry the listing's create_category. It fails today.
  2. Copy it in fn_write_blueprint_stages, so all three callers get it.
  3. Seed one tiered Pipeline (allow_tiered_intensity, per-stage low / high prices) and one
     1-on-1 session listing with a session_plan, through the corpus and the emitter;
     `deno task db:seed:generate`, then `deno task db:reset` (announce it).
  4. Seed.md: its sources table and Known gaps.

ACCEPTANCE: the probe is green. On a fresh reset, the tiered Pipeline's /view shows its tiers and
the session listing shows its plan; stage_intensity_terms.sql is green.

SAME CHANGE: documentation/database/{marketplace,projects}/*; Seed.md; the decision row closing
#417 (c), (f) and #411 (f).
```

§1.2 rows: **MK-38** and **MK-39**'s notes cleared.

### SC3 — A seller opens a cohort, and the waitlist hears about it

MK-40 ❌ → 🟡 (✅ after SCH-WP7); closes MK-12 (Listing view, 🟡 → ✅).

```text
PROMPT SC3: A seller opens a cohort on a group-session listing, and the waitlist hears about it

ROLE: Full-stack engineer (sessions). Queue C: 00001155. No SCH work package runs beside you;
SCH-WP7 runs right after you, in the same slot.

CONTEXT (verified at b7280787):
  - No door opens a group cohort. The only INSERT INTO projects.cohorts is fn_book_session_slot's
    one-seat cohort for a 1-on-1 (00001155 ~:786). projects.schedule_sitting (:963) needs a
    cohort that is already enrolling or active (:1002-1015), and get_cohort_offer (:187) finds
    only an `enrolling` one. So a new group listing is waitlist-only. USER_FLOWS MK-40 says
    SCH-WP7 fixes it, but WP7 step 5 only schedules sittings of a cohort that exists.
  - Rules: PRODUCT_SPEC.md: a group seat is one transaction for the whole cohort, timed from its
    first sitting (:188); a cohort is never a dead end (:739); the waitlist is invited in order
    when a cohort opens (#455, the cohort-waitlist-invites job); the delivery commitment shows
    the cohort's start and cadence (:768).
  - The seller works in the listing's Availability section (features/catalogue/components/edit/…)
    and the session workspace.

🧑 DECISION (before step 2): what a seller sets, and what happens if the cohort under-fills. Put
this to me:
  A (recommended): the seller sets the capacity, the first sitting, the cadence (or fixed
     sittings) and an enrolment close, and may set a minimum. If the minimum is not met by the
     close, the seller may cancel the cohort: every seat is refunded in full through the seat
     escrow's refund path, and the seat-holders and the waitlist are told.
  B: no minimum; an opened cohort always runs.

STEPS:
  1. Red first: a probe that a group listing has no way to open a cohort, then the door's cases.
  2. projects.open_cohort (and cancel_cohort, as ruled) as definers: the listing's owner, or a
     team member with the capability; a group-session listing; one enrolling cohort at a time
     unless the spec says otherwise; the first sitting scheduled through the path
     schedule_sitting uses.
  3. Opening wakes the waitlist (the #455 job's trigger condition): prove the first invite and its
     48-hour hold.
  4. Seller UI: "Open a cohort" on the listing (URL-addressed, in ROUTING.md). The buyer's /view
     lane then offers Reserve a seat (MK-12) with the start and the cadence.
  5. Seed one enrolling cohort on a seeded group listing (#453 (e)).

ACCEPTANCE: the probe: opening makes an enrolling cohort with its first sitting; the waitlist's
first person is invited with a 48-hour hold; a second open refuses; a cancel (if ruled) refunds
every seat and conserves money. Live: the seller opens a cohort, and a buyer reserves a seat and
checks out. Screenshots.

SAME CHANGE: PRODUCT_SPEC.md (the opening rules); PRODUCT_MANAGEMENT.md (the cohort lifecycle);
documentation/database/projects/*; Zod (packages/types/projects/sessions.ts); ROUTING.md; Seed.md;
a note on SCH-WP7 (SCHEDULING_BUILD_PROMPTS.md) that SC3 opens cohorts; the decision row closing
#453 (e).
```

§1.2 rows: **MK-40** ❌ → 🟡 (its text corrected; ✅ after SCH-WP7); **MK-12** 🟡 → ✅ if the live
seat checkout passes.

### SC4 — Only the publish door publishes, and publishing tells people

Narrows MK-41 (✅ once T&S SN3 lands).

```text
PROMPT SC4: Only the publish door can publish a listing, and publishing tells the people it
should

ROLE: Postgres security engineer. Queue C: 00001170, 00001895, 00002520, 00005010.

CONTEXT (verified at b7280787):
  - The publish path: routes/api/catalogue/status.ts → CatalogueBackendService.setStatus (:214) →
    live-catalogue-writes.ts:362 → catalogue.set_listing_status (00001170:889-963), whose gate
    checks a title, a price, a slot-1 cover and, for a Pipeline, a stage; set_listings_status
    (:1063) for batches; trg_listings_publish_age_gate (00001810:37-39).
  - A suspected bypass, inferred from the grants and not probed: GRANT UPDATE on
    catalogue.listings (00002520 ~:869) plus the owner UPDATE policy (00002020:57-65) may let a
    seller PATCH status = 'published' through PostgREST, skipping the gate. Only the age trigger
    guards status.
  - catalogue.listing_published is seeded (00005010:87: in-app, discovery, low; Zod
    packages/types/comms/catalog.ts:107) and never emitted.
  - Screening (PRD-D10) is T&S SN2 → SN3, through cutShowcaseRendition in
    live-catalogue-writes.ts. It is not this prompt's.

STEPS:
  1. Red first: a probe (extend catalogue_publish_locks.sql) that, under a seller's JWT, UPDATEs
     status to 'published' on a listing with no cover. Prove whether it succeeds. If it does
     not, record why, and skip step 2.
  2. Close it: status, and every column the publish gate owns (published_at, …), changes only
     inside the doors. Extend the derived-column guard (security.fn_guard_derived_columns,
     00001895) or narrow the UPDATE grant to the editable columns. Prove save_listing and the
     live editor still work.
  3. Emit listing_published from the door on a real draft → published transition (not on a
     resume from paused, unless the row's spec says so), to the audience its catalogue row and
     its doc name. A batch emits one per listing, grouped by the row's window.
  4. Name the bypass, as found, in MK-41's row either way.

ACCEPTANCE: the probe: a direct UPDATE of status → 42501 (or the documented reason it never
worked); the door still publishes; one notice per publish and none on pause or resume.

SAME CHANGE: documentation/database/catalogue/{Policies,Functions}.md; the comms docs for the
emitter; the decision row.
```

§1.2 rows: **MK-41** stays 🟡 with a narrower note (screening is SN3's), and becomes ✅ when SN3
lands.

**Step 1 ran on 2026-11-18, and the rulings are in (#494).** The bypass is live and wider than the
CONTEXT says: a bare UPDATE or INSERT publishes past the gate, clearing `published_at` reopens
#217's lock, and a published listing's currency, questions, delivery model and showcase files change
directly (#494 (A)). The doors are INVOKER, so step 2 makes `set_listing_status` and
`set_listings_status` definers (#494 (B)) and also writes `00002018` and `00002020`. Step 3's
audience is **the owning party's followers, in a daily digest** (`group_window` `1 day`, a link to
`/view/<slug>`, a listing's first publish only; #494 (C)), and the rule enters PRODUCT_SPEC.md in
SC4's change. SC4 waits for CK1 (#494 (D)). When it runs, its step 1 commits the red probe, it asks
whether MK-57 rides along (#494 (a)), and its CONTEXT's `00005010:87` and `catalog.ts:107` read
`:88` and `:108`.

### SC5 — A listing's views are counted

Closes MK-43 (🟡 → ✅).

```text
PROMPT SC5: A listing's views are counted, so the seller's analytics are real

ROLE: Full-stack engineer. Queue C: 00001600 (rollups), the search interest files, the seeds.

CONTEXT (verified at b7280787):
  - Events go to search.interest_events (00000018:130-145; its CHECK already allows 'view'). The
    only writer is InterestBackendService (:66), through POST /api/explore/events, whose
    InterestRow.event_type allows impression, click and rail_depth only (interest-rows.ts:7),
    gated by isExploreBackendLive() (:47).
  - analytics.fn_rollup_listings (00001600:106) already reads 'view' (:143, :212) into
    analytics.daily_rollups; catalogue.get_listing_rollups (00001170:1015) →
    live-catalogue-analytics.ts:97 reads that. listings.view_count and order_count are derived
    and guarded (00001895:67-71), and nothing writes them. #218 (b) (no view writer) and (c) (no
    90-day seed).

STEPS:
  1. Red first: opening a published listing's /view writes no 'view' event.
  2. The writer: a beacon from the /view page after hydration, through the existing events route
     ('view' added to InterestRow and its Zod): at most one per viewer per listing per 30
     minutes, never the owner's own view, never a bot (the route's existing filters), with the
     same consent the explore events already honour.
  3. The rollup writes view_count and order_count through the derived-column guard's allowed
     path.
  4. Seed 90 days of rollups for the seeded sellers (#218 (c)).

ACCEPTANCE: a view by a second persona adds one to the next rollup; repeat views inside 30
minutes do not, and nor does the owner's own; on a fresh reset the analytics view shows 90 days;
listing_analytics.sql is green.

SAME CHANGE: documentation/database/{search,analytics,catalogue}/*; Zod; Seed.md; the decision row
closing #218 (b) and (c).
```

§1.2 rows: **MK-43** 🟡 → ✅ (the EXPLORE flag is environment).

### SC6 — The Clients view links by slug and names every buyer; a team edits its listings

Closes MK-44 (🟡 → ✅); settles MK-45's hidden flag.

```text
PROMPT SC6: The seller's Clients view links by slug and names team and business buyers; a team's
listings are editable by the team

ROLE: Full-stack engineer. Queue C: 00001170.

CONTEXT (verified at b7280787):
  - #218 (a): the Clients readers' hrefs carry uuids: /messages/<uuid> (00001170 ~:1566) and
    /calendar?event=<uuid> (~:1623, ~:1668); PRD-J1. ROUTING.md owns the thread's address
    (Decision #444 flag (a) records a PRODUCT_SPEC-vs-ROUTING contradiction about it: follow
    ROUTING, and if the flag is still open, do not resolve it here); #388 owns ?event=.
  - #218 (d): fn_seller_order_lines resolves a buyer only for owner_type user or freelancer
    (:1491, :1502), so a team's or a business's order shows no buyer.
  - MK-44's "quotes cannot be acted on" is stale: QuotePanel only="host" is mounted in
    components/clients/ClientDrawerBody.tsx:213 (#458).
  - #312 flag (a): every catalogue write door is creator-only (save_listing :317,
    apply_listing_media :810, set_listing_status :914, duplicate :1149, delete :1336), so a
    teammate cannot edit a colleague's team listing. Flag (e): presets are not team-scoped.

🧑 DECISION (before step 3), #312 (a) and (e): who may edit a team's listing. Recommended A: any
member holding the team's catalogue capability (read the team role matrix) may edit, publish,
pause and duplicate any team listing; deleting stays with the creator and the team's admins;
presets follow the same scope. B: creator-only stays, and the UI says so.
RULED #500 (2026-11-18): A, tightened. Any active publish_listings holder edits, publishes,
pauses and duplicates any team listing, and create_listing for a team needs it too; deleting is
the creator while still a holder, or a member at the admin or owner rank; a team listing's
presets live on the team's own schedule. ?event= stays (ROUTING, #388; PRD-J1), so ACCEPTANCE
reads "no uuid in any Clients href but ?event=". SC6 waits for CK1 (#488) and SC4 (#494).

STEPS:
  1. Red first: a probe for the uuid hrefs and the missing team buyer.
  2. Slugs in every href, per ROUTING.md; a team or business buyer named as the entity (its name
     and handle, as MetaLine text), never a blank.
  3. The ruling across the five doors and the presets; extend catalogue_publish_locks.sql.
  4. Fix MK-44's stale text and MK-45's hidden flag in USER_FLOWS.

ACCEPTANCE: no uuid in any Clients href; a team's order names the team; under the ruling, a
teammate edits a colleague's listing (or is refused with copy that says why). Screenshots.

SAME CHANGE: ROUTING.md if a shape changes; documentation/database/catalogue/*; the decision row
closing #218 (a), (d) and #312 (a), (e).
```

§1.2 rows: **MK-44** 🟡 → ✅; **MK-45**'s note per the ruling.

### SC7 — Request to Sell, the client's grant, and the royalty

Closes MK-46 (❌ → ✅).

```text
PROMPT SC7: A freelancer asks to sell an asset made on a project; the client grants it; every
sale routes the client's royalty

ROLE: Full-stack + payments engineer. Queue M (it changes place_wallet_order's money), after CK1,
DB19 and DB21 (#493 (D)).

CONTEXT (verified at b7280787):
  - PRODUCT_SPEC.md §Digital Marketplace 3 (:3148-3158 at 7cb49117): a "strict approval gate".
    The freelancer triggers Request Marketplace Listing; the client may grant shared IP for the
    whole asset or for parts; the approved asset is minted with "a cryptographic link back to the
    original project". §5 (:3174-3185): Shared Royalty, "a percentage of every sale is
    automatically routed to the original Client's wallet".
  - Nothing exists: no table, door or UI, and catalogue.products has no provenance column. The
    enum ip_option_mode includes shared_ownership (00000003:41), used by
    projects.ip_ownership_mode and project_stages.ip_mode; the deed text is
    apps/web/features/legal/core/content/ip-transfer-deed.ts.
  - CK1's product_versions is what a minted product sells.

🧑 + ⚖️ DECISIONS (before step 2):
  1. The royalty: who sets the percentage (recommended: the client and the freelancer agree it in
     the request, within bounds you set) and its order against the commission (recommended: the
     platform's commission first, the royalty from the seller's net, the dust to the seller).
  2. Who may request: only for a stage whose IP mode allows it, after its release; a client
     business decides through a member with the right capability; never a 13-17 account.
  3. ⚖️ The licence wording a grant creates (counsel), and what happens to a royalty when the
     client's account is erased (recommended: it stops, and the seller keeps it).
  RULED #493 (2026-11-18), all as recommended, with stop 2's premise corrected, and two points
  re-ruled the same day (#493 (G)): (1) the freelancer proposes a rate and the client approves or
  declines it as proposed, never counters; 0-50% of the seller's net, fixed at the grant; the
  commission first, then the royalty floored from what is left, the dust to the seller; the client
  credited through fn_wallet_credit_pending beside the seller, so a refund recovers both. (2) Only
  a released exclusive_transfer or licensed_use stage takes a request; shared_ownership already
  lets the maker sell, so it lists with provenance, no grant and no royalty, and the client is
  told; projective_partner is refused; a business grants through a member holding
  manage_projects; no 13-17 account on either side. (3) The grant survives erasure, its royalty
  stops and the seller keeps it; the grant sits behind a platform param that stays off until
  counsel. Wait for CK1, DB19 and DB21. Skip this block when you run: re-verify all three at HEAD
  and stop if one has not landed, and read #493's flags (a)-(c) before step 2 ((d) is ruled).

STEPS:
  1. Red first: a probe that no request door exists and a sale routes nothing to the client.
  2. catalogue.sale_requests (requested · approved · declined · withdrawn; nothing deleted) and
     its doors.
  3. On approval, a draft product with provenance (the project, the stage, the source files'
     hashes: the "cryptographic link"), which the freelancer edits and publishes through the
     normal gate.
  4. The royalty leg in place_wallet_order, through the wallet doors (integer minor units,
     floored, the dust named), with its terms in finance.v_conservation_identity once DB16
     exists. The client sees the earnings in their wallet. Notices both ways.

ACCEPTANCE: the probe: a request on a stage that cannot share refuses; an approved one mints a
draft with provenance; a sale pays the seller, the platform and the client exactly, and conserves
money; finance_invariants.sql passes. A live walk across two personas.

SAME CHANGE: PRODUCT_SPEC.md §Digital Marketplace 3 and 5 (the markers removed); finance-model.md
(the royalty leg); PRODUCT_MANAGEMENT.md (the request lifecycle); documentation/database/
{catalogue,finance}/*; Zod; ROUTING.md; the decision row.
```

§1.2 rows: **MK-46** ❌ → ✅.

### SC8 — A rights-holder reports a listing; an operator takes it down; the seller answers

Part of MK-47 (with T&S R1 → R2 and SC9).

```text
PROMPT SC8: A rights-holder can report a listing, an operator can take it down, and the seller can
answer

ROLE: Full-stack engineer. Queue C, after T&S R1 and R2 have landed (ops.reports and the report
route).

CONTEXT (verified at b7280787): there is no inbound copyright path (#393 flag (n), ruling B8: "a
separate track, finished before the marketplace opens"). T&S R1 (:722) builds ops.reports, with a
reason vocabulary that recommends intellectual_property; R2 (:926) builds /api/reports and a
listing entry point. PRD-D9 is ❌.

⚖️ DECISION (before step 2): which notice regime the intake follows (counsel): the fields a valid
notice needs, the counter-notice, and the repeat-infringer rule. Build the mechanism; the words
are counsel's, behind a param that keeps the public form off until they are in.
RULED #496 (2026-11-18): record and wait; SC8 ran step 0 only, as R1 and R2 had not landed.
(A) A rights-holder needs no account: ops.reports.source takes 'notice' (reporter NULL), with
an immutable, Zod-typed notice block that SC8 fills and files through its own rate-limited
door, never ops.file_report. (B) The takedown is a hold on catalogue.listings that an operator
door sets and lifts; setting it pauses the listing through set_listing_status's code path, and
set_listing_status refuses 'published' while it stands. No new status. Skip this block when
you run: re-verify R1 and R2 at HEAD and stop if either is missing (#496 (D)); add the
'notice' source yourself if R1 shipped without it. Ask #496 flag (b) before step 4.

STEPS:
  1. Red first: a probe that a notice has nowhere to go.
  2. A notice intake: a public form, rate-limited, on an existing legal segment (in ROUTING.md),
     writing an ops.reports row of category intellectual_property with the notice's fields.
  3. An operator door that takes the listing down (paused with a reason, through
     set_listing_status's door, never a direct write) and tells the seller and the complainant.
  4. The seller's counter-notice, and a per-seller repeat count the operator sees.

ACCEPTANCE: the probe: a notice creates a report; a takedown pauses the listing and hides it from
Explore and /view (404 for the public, visible to the seller with the reason); a counter-notice is
recorded; nothing is hard-deleted.

SAME CHANGE: PRODUCT_SPEC.md (the takedown rule); SYSTEM_ARCHITECTURE.md (ops.reports' subjects);
ROUTING.md; documentation/database/ops/*; the decision row closing #393 (n).
```

§1.2 rows: none flip alone. **MK-47** → 🟡 once SC8, R1, R2 and ASSET phases 1–2 have landed.

### SC9 — One #393 phase (run once per phase)

The rest of MK-47.

```text
PROMPT SC9: ASSET_DELIVERY_ARCHITECTURE.md §14 phase <N> (or ANTI_PIRACY_ENGINE.md §14 phase <N>)

ROLE: as the phase needs. Queue C, unless the phase edits place_wallet_order (then Queue M).

CONTEXT: CK1 built phase 0. Read the phase's row in §14, every section it names, and its rulings
in §13 (A1-A11) or ANTI_PIRACY_ENGINE.md §13 (B1-B10). Decision #393 logs them all as open.

🧑 DECISION (before any code): put each of the phase's rulings to me with the spec's
recommendation; build nothing that depends on one I have not answered. A ⚖️ ruling: build behind
a param or env flag that stays off.

STEPS: as the phase's row says, red first. Its "Done when" is the acceptance.

SAME CHANGE: the spec marks the phase built and corrects any stale line it cites; ROUTING.md for
routes; SYSTEM_ARCHITECTURE.md §Environment Variable Contract and .env.example for any key
(XXXX-XXXX placeholders); documentation/database/*; one decision row per ruling set.
```

| Phase | Delivers                                                | Waits for                                   |
| :---- | :------------------------------------------------------ | :------------------------------------------ |
| 1     | Signed reads closed; `/api/files/object` retired        | CK1; A2 ruled #499                          |
| 2     | The upload whitelist, mandatory ClamAV, large files     | T&S SN2 (the safety node); A7               |
| 3     | The edge host, `SUPABASE_PUBLIC_URL`, the link resolver | Your edge choice; A5                        |
| 4     | The sandbox origin, the CDN, previews, private buckets  | Phase 3; A1, A4                             |
| 5     | Fingerprinting, by format                               | ANTI_PIRACY B-rulings                       |
| 6     | The registry and licence gateway                        | CK1                                         |
| 7     | Leak monitoring and takedown packs                      | ANTI_PIRACY B-rulings; plan gates (PRD-F14) |

§1.2 rows: **MK-47** → ✅ once every ASSET and ANTI_PIRACY phase has landed, with SC8.

---

## 6. Last — the sweep

### MKZ — The rows, the work orders and the specs agree with the code

```text
PROMPT MKZ: The marketplace readiness rows, the work-order files and the specs agree with the code

ROLE: Documentation engineer. App lane, last.

STEPS:
  1. Re-check every row of USER_FLOWS §Basket, checkout & orders, §Reviews and §Seller catalogue
     (and MK-12, MK-16) against main: the status, the "What's missing" text and every file:line.
  2. MK-42: x-frame-options is SA's "second sanctioned loosening" (SYSTEM_ARCHITECTURE.md
     :2831-2839, #217 ruling (j)). 🧑 Ask me to close #219 (d) as sanctioned; then the row cites
     SA instead of the flag.
  3. Fix every stale line in MARKETPLACE_BUILD_PROMPTS.md §0.4 that its prompt left.
  4. MARKETPLACE_BUILD_PROMPTS.md §0.1: mark each work order ✅ with its commit, or name what it
     still waits for.

SAME CHANGE: docs only. `deno fmt` on the files you touched.
```

§1.2 rows: **MK-42**'s note; the scoreboard as it then stands.
