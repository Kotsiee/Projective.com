# Marketplace Build Prompts — closing USER_FLOWS MK: Basket, checkout & orders · Reviews · Seller catalogue

> **Status: WORK ORDERS, not binding.** Claude Code prompts that take three sections of
> [USER_FLOWS.md](USER_FLOWS.md) to 100%: **Basket, checkout & orders** (MK-18–MK-31), **Reviews**
> (MK-32–MK-34, MW-64) and **Seller catalogue** (MK-35–MK-47, MK-57, MK-60), plus the Listing view's
> MK-12 and MK-16. The owner's rulings are Decisions #485–#506 (one per prompt), #525 for SC10–SC13
> and #393 for the asset-delivery phases.
>
> **Verified against code 2026-11-23 at `f2e25929`.** 11 open, 3 partly done, 10 done (§0 ledger).
> Runnable now: CK2, RV1, RV2, SC6, SC9 (phase 1), SC10, SC11, SC12, SC13.
>
> **This file holds open work only.** A session that runs a prompt prunes it here when it finishes
> (§1's closing duty; [`build-prompts.md`](../reference/build-prompts.md) §2).

**Rollup, not restatement.** Money rows have work orders in
[`FINANCE_BUILD_PROMPTS.md`](../architecture/FINANCE_BUILD_PROMPTS.md) (FBP), which owns the finance
SQL lane. Others sit in
[`SUBSCRIPTIONS_BUILD_PROMPTS.md`](../architecture/SUBSCRIPTIONS_BUILD_PROMPTS.md) (SBP),
[`SCHEDULING_BUILD_PROMPTS.md`](../architecture/SCHEDULING_BUILD_PROMPTS.md) (SCH),
[`TRUST_SAFETY_BUILD_PROMPTS.md`](../architecture/TRUST_SAFETY_BUILD_PROMPTS.md) (T&S),
[`COMMS_BUILD_PROMPTS.md`](../architecture/COMMS_BUILD_PROMPTS.md) and the #393 specs
([`ASSET_DELIVERY_ARCHITECTURE.md`](../architecture/ASSET_DELIVERY_ARCHITECTURE.md),
[`ANTI_PIRACY_ENGINE.md`](../architecture/ANTI_PIRACY_ENGINE.md)). Gaps with no work order get the
prompts here: **CK** (checkout), **RV** (reviews), **SC** (seller catalogue) and **MKZ** (the
closing sweep). Paste §1.1, then the prompt, then §1.2 with the rows given under it.

---

## 0. Map, run order and stops

### 0.0 Done

| ID  | What landed                                                                                         | Commit                                    | Text at    |
| :-- | :-------------------------------------------------------------------------------------------------- | :---------------------------------------- | :--------- |
| CK1 | Entitlements, product versions frozen into `originals`, the download route, the A8 box, Purchases   | `322c4dc9`, `82cdd7b7`, `197b0d0c` (#488) | `f2e25929` |
| CK3 | `/checkout/orders`, keyset-paged, each line linked home; a block's receipt lists every sitting      | `f3ba4c3b` (#517)                         | `10bb9b20` |
| CK5 | `comms.fn_enqueue_basket_nudges`: one Marketing email per idle basket; Marketing opt-in at the root | `630468cb` (#492)                         | `f2e25929` |
| CK6 | `deno task stripe:domains`, a redirect return lands once, the Apple Pay path (off), the runbook     | `322c4dc9`, `0d58d084` (#504)             | `f2e25929` |
| CK7 | `place_wallet_order` prices an accepted quote offer into its engagement; its expiry bounds payment  | `667196d5`, `67a5c305`, `e0231287` (#491) | `f2e25929` |
| SC1 | `CatalogueListingRowSchema` pins all 30 columns; `parseListingRow` is the one read boundary         | `5a95dbac`, `f2abf8e2` (#501)             | `f2e25929` |
| SC2 | A bought Pipeline's stages keep the CREATE category; a tiered Pipeline and a session plan seeded    | `a0671fbe` (#503)                         | `f2e25929` |
| SC3 | `projects.open_cohort` / `cancel_cohort`, the Cohorts block at `?cohort=`, one seeded cohort        | `322c4dc9`, `b87c276c` (#498)             | `f2e25929` |
| SC4 | Only the definer door publishes; the post-publish locks on the tables; a product needs a file; the follower notice | `0cf50f7d`, SC4_FIX (#535) | `0cf50f7d` |
| SC5 | `ListingViewBeacon` writes deduped views; the rollup derives view and order counts; 91 days seeded  | `322c4dc9` (#506)                         | `f2e25929` |

### 0.1 Row → work order

**Basket, checkout & orders**

| Row   | Now · Crit · Gate  | Work order                              | The row flips (or its note clears) when                                                                                                |
| :---- | :----------------- | :-------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| MK-20 | 🟡 · Crit · PROD   | **CK4** (ruled #490; ⚖️)                | ✅ only once the tax switch is on in the target environment after counsel; CK4 alone narrows the note                                  |
| MK-23 | 🟡 · High · UAT    | CK6 ✅ + you, on a hosted domain (§0.4) | Your device runs are recorded (Apple Pay on iOS Safari, Google Pay on Android Chrome, the PayPal return)                               |
| MK-24 | 🟡 · Normal · UAT  | SBP S1 → S4                             | A business buys Business Pro, sets monthly invoicing and places an on-account order                                                    |
| MK-25 | ✅ · Normal · UAT  | COMMS NT3 (email)                       | The approval notice also emails (note clears)                                                                                          |
| MK-26 | 🟡 · Normal · UAT  | **CK2** (DB19 built its cap, #511)      | A seller issues a code; a seller's code discounts only their lines; the route is throttled                                             |
| MK-27 | ⏸                  | — (#435, counsel)                       | Excluded                                                                                                                               |
| MK-28 | 🟡 · Normal · PROD | FBP DB17 → UI5                          | A live feed with a staleness mark                                                                                                      |
| MK-29 | 🟡 · Crit · UAT    | CK1 ✅ + the live run (§0.4)            | The live run is recorded                                                                                                               |
| MK-31 | ❌ · Crit · UAT    | FBP DB6 → DB21 → MR3                    | A buyer cancels an undownloaded line, disputes a defective one, an operator refunds a card; lines and orders read refunded / cancelled |

Two rows of the **Listing view** section are left to live runs of prompts that landed here (§0.4):
**MK-16** (a quote offer is paid at its price; CK7, #491) and **MK-12** (reserve a cohort seat; SC3,
#498).

**Reviews**

| Row   | Now · Crit · Gate  | Work order                        | The row flips when                                                                                                          |
| :---- | :----------------- | :-------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| MK-32 | 🟡 · High · UAT    | **RV1** (partly: the product arm) | A delivered purchase is reviewed and the signed-in walk is recorded (§0.4); the row cites T&S R2 for the Report entry point |
| MK-33 | ❌ · Normal · PROD | **RV2** (#486)                    | Providers review clients, double-blind as ruled; the Client Trust Score and its warning run                                 |
| MW-64 | ❌ · Normal · PROD | **RV3** (#489)                    | Standing reads real reviews, and Elite can be reached (#58-63 (h))                                                          |

**Seller catalogue**

| Row   | Now · Crit · Gate  | Work order                                        | The row flips (or its note clears) when                                                           |
| :---- | :----------------- | :------------------------------------------------ | :------------------------------------------------------------------------------------------------ |
| MK-36 | ✅ · High · MVP    | **SC13** (#525); T&S P2a refuses PII in copy      | The note names file answers and numeric follow-ups                                                |
| MK-37 | 🟡 · High · UAT    | CK1 ✅ + the live run (§0.4)                      | ✅ once the publish → copy → download run is walked live                                          |
| MK-40 | 🟡 · High · UAT    | SCH-WP7 step 5 (SC3 ✅, #498)                     | ✅ once WP7 step 5 schedules later sittings from the app and the seller's walk is recorded (§0.4) |
| MK-41 | 🟡 · Crit · PROD   | T&S SN2 → SN3 (SC4 ✅, #535)                      | ✅ once SN3 screens before publish                                                                |
| MK-42 | ✅ · Normal · UAT  | **MKZ** (🧑 close #219 (d))                       | The note cites SA's sanctioned loosening                                                          |
| MK-44 | 🟡 · Normal · UAT  | **SC6** (#500)                                    | Slug links; a team or business buyer is named                                                     |
| MK-45 | ✅ · High · UAT    | **SC6** (ruled #500)                              | The ruled team-editing scope is built (note clears)                                               |
| MK-46 | ❌ · Normal · PROD | **SC7** (ruled #493; ⚖️)                          | Request to Sell, the client's grant and the royalty leg run                                       |
| MK-47 | ❌ · High · PROD   | T&S R2 → **SC8** (R1 landed); **SC9** × every #393 phase | 🟡 once SC8 and ASSET phases 1–2 land; ✅ once every ASSET and ANTI_PIRACY phase lands            |

SC10, SC11 and SC12 each add a new MK row in the change that lands them (#525). Section scores live
in USER_FLOWS' Scoreboard. What UAT still needs from these sections: the live runs (§0.4), the MK-31
chain (DB21 → MR3), RV1's product arm, SC6, CK2, SCH-WP7 step 5, CK6's device runs and SBP S4.

### 0.2 Run order

The global rules hold: at most **two SQL sessions** on the one local DB, on disjoint migration
files; one writer at a time for `00002500` / `00002510` / `00002520` across **all** tracks. The
order below is priority and dependency (⏳); the file locks decide what may overlap. Before every
SQL prompt, compare its files with what is running (`git status`, and §0 of FINANCE,
[IDENTITY](../architecture/IDENTITY_BUILD_PROMPTS.md) and this file).

**Queue M — money files** (`00001210` `place_wallet_order`, `00000017`). Each takes a turn in the
finance SQL lane (FINANCE §0); FINANCE's order wins on a conflict.

1. **CK2** — runs now: CK1, CK7 and FBP DB16 have landed, and DB19 built its per-account cap.
2. **SC10**'s money half — no wait, but never beside CK2 (`00001210`).
3. FBP **DB21 → MR3** — ⏳ DB6.
4. **CK4** — ⏳ DB21 (a refund reverses the tax); ⚖️ counsel before the switch. LEGAL LG8 follows
   it.
5. **SC7** — ⏳ DB21 (a refund reverses the royalty too, #493 (D)); ⚖️ counsel before the grant
   switch. The last change to the money path in this file.

**Queue C — everything else**, as the second SQL session whenever its files are disjoint from what
is running. It shares that slot with SBP S1–S4 and the IDENTITY prompts.

1. **SC6** — runs now (`00001170`): SC4 landed (#535).
2. **RV1**'s product arm — runs now.
3. **RV2 → RV3** — RV2 runs now (RV1's doors are in); RV3 ⏳ RV2.
4. **SC11**, **SC12** — each stops at its 🧑 first. SC11 writes `00001155`, so no SCH package runs
   beside it.
5. T&S **R2** (their track; R1 landed) → **SC8**; **SC9** once per #393 phase (phase 1 runs now).

**App lane** (up to three at once, file-disjoint): **SC13** now; **MKZ** last.

**Hot files across this file:**

| File                                             | Writers here          | Writers elsewhere (never at the same time)                        |
| :----------------------------------------------- | :-------------------- | :---------------------------------------------------------------- |
| `00001210` (`place_wallet_order`, promo, orders) | CK2, CK4, SC7, SC10   | FBP DB9, DB10, DB11, DB13, DB15; SCH-WP6                          |
| `00000017` (finance tables)                      | CK2, CK4, SC7         | FBP DB6, DB8, DB21, MR3, MR5                                      |
| `00001170` (catalogue doors, `save_listing`)     | SC6, SC10, SC12       | —                                                                 |
| `00001155` (sessions, cohorts)                   | SC10, SC11            | every SCH package; FBP DB15                                       |
| `00005060` (jobs)                                | RV2, SC11             | FBP DB17, MR5; PM-GH1                                             |
| `00002500` / `00002510` / `00002520` (grants)    | every SQL prompt here | one writer at a time across all tracks                            |
| `supabase/seeds/gen/*` (+ `db:seed:generate`)    | RV1, RV2, RV3         | —                                                                 |
| `features/checkout/**`, `live-orders.ts`         | CK4, SC10             | FBP DB21, UI5, UI6                                                |
| `USER_FLOWS.md`, `PRODUCTION_READINESS.md`       | every prompt          | every readiness track: edit your rows and the computed lines only |

### 0.3 Human stops on this path

Answer them in one sitting and each prompt runs straight through. Each prompt keeps its own 🧑
block, so a question you defer still stops the build at the right step. Ruled stops are written into
their prompts with their decision numbers.

| #  | Question                                                                                        | Prompt        | Recommendation                                           |
| :- | :---------------------------------------------------------------------------------------------- | :------------ | :------------------------------------------------------- |
| 3  | #496 (b): does a strike count against the person or the owning workspace                        | SC8           | Asked before step 4                                      |
| 4  | #393 A1, A3–A5, A7, A9–A11 and B1–B10 (A2, A6 and A8 are ruled)                                 | SC9           | Per phase, as the spec recommends                        |
| 5  | Per-hour rounding; whether a per-session listing may vary its lengths; a seat priced per hour   | SC10          | None yet: the prompt asks                                |
| 6  | Rolling templates: the horizon and its opener, the capacity, an empty chain, beside Open cohort | SC11          | None yet: the prompt asks                                |
| 7  | Plan files: frozen or live, whether a manual reveal notifies, readable after a refund           | SC12          | None yet: the prompt asks                                |
| 8  | File answers: where they live, their limits and scan; a number's starting value in a follow-up  | SC13          | None yet: the prompt asks                                |
| 9  | Close #219 (d) as sanctioned                                                                    | MKZ           | Yes: SA already names it the second sanctioned loosening |
| —  | SCH-WP7 step 6 (#344 (f)); SBP S4's (f)                                                         | their prompts | Their own                                                |

**For counsel** (build behind a switch that stays off; never switch it on). Each item is in
[FOUNDER_QUESTIONNAIRE.md](../architecture/FOUNDER_QUESTIONNAIRE.md) Part E.2, LEGAL LG2's brief
(#528): the tax obligation and its tax-exclusive display (#490 (c); E2.20, E2.21), the nudge's
consent basis (CK5, built off; E2.8), A8's refund refusal (`finance.delivered_refund_refusal`, #488;
E2.11), SC7's licence wording (E2.14), SC8's notice regime (E2.10), and one money question: **may a
buyer-started refund of a card-paid line land in the wallet?** (E2.13). UK consumer rules generally
expect a refund to the original payment method unless the buyer agrees otherwise. DB21 credits the
wallet and MR3 keeps card refunds operator-only.

### 0.4 Live runs left by landed prompts

Each was blocked locally (a shared, saturated stack; scripted sign-in refused at the Turnstile
check, #447). Record each run in its row's evidence; MKZ step 1 checks them.

- **CK1** (#488 (m)): a wallet and a test-mode card purchase, both files of a two-file bundle, a
  second buyer's 404, screenshots of the confirmation and Purchases → MK-29, MK-37.
- **CK7** (#491): request → offer → accept → pay → the engagement's board, the quote card captured →
  MK-16.
- **SC3** (#498): the seller opens a cohort, and a buyer reserves a seat and checks out → MK-12,
  MK-40.
- **RV1** (#487): complete → review → the seller is notified → replies, signed in → MK-32.
- **CK6** (#504), yours: `--apply` on a hosted host, then Apple Pay (iOS Safari), Google Pay
  (Android Chrome) and PayPal, recorded in the providers spec §4.3 F → MK-23.

### 0.5 Not in this file

- **MK-21's wallet + card split** (CO17) is Planned with no prompt (FBP §0.6). Un-planning it is
  your call; then it needs a `PRODUCT_SPEC.md` entry first.
- **MK-27** (pay in your own currency) stays ⏸ until counsel answers #435 (d)
  (`FOUNDER_QUESTIONNAIRE.md` Part D).
- **MK-41's screening** is T&S SN2 → SN3; the safety node lives outside this repo (PRD-D10).
- **MK-56** (a business buys a One-Off) is ruled individuals-only for now (#457).
- **PRD-M5's seller tax forms** (1099 / W-9) were a payout-side question: LEGAL LG6 landed
  (Decision #527, Stripe first). CK4 covers checkout and invoice tax only.

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
     you touch 00001210 or 00000017, also read documentation/architecture/
     FINANCE_BUILD_PROMPTS.md §0: its finance SQL lane decides when you run.
  3. Grep documentation/reference/decisions/README.md for the surface you touch and read the
     decision files it names. If a decision already rules the behaviour you are about to change,
     stop and ask me.
  4. The CONTEXT below was verified at the commit it names. Re-check every file:line against the
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
    finance_invariants.sql and conservation_identity.sql stay green, and a new money flow adds
    its terms to finance.v_conservation_identity.
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
    nothing that depends on the answer until I give it. A stop already ruled reads "RULED #NNN":
    build the ruling. ⚖️: build behind a param or flag that stays off; never switch it on.

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

When you finish, do the closing duty (documentation/reference/build-prompts.md §2) in the same
commit as the work:
  - In documentation/readiness/MARKETPLACE_BUILD_PROMPTS.md: a done prompt leaves the file.
    Delete its section and add its row to §0's Done ledger (ID · what landed · commit · text at
    <commit>^). A partly done prompt keeps only its open steps, with their numbers unchanged,
    under one rewritten Status line. A ruled 🧑 stop becomes the ruled step, with its decision
    number.
  - Treat any step you built for another prompt the same way, in the file that holds it.
  - Run git grep -n "<ID>" documentation/ and update every place that still calls it open: the
    PRODUCTION_READINESS / USER_FLOWS Track cells, the audit's Status column, other prompts' waits,
    and this file's row in documentation/reference/build-prompts.md §3.
  - If the file has no prompts left, delete it, log it in build-prompts.md §4 and repoint its links.
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

## 2. Other files' prompts

This section held deltas onto other files' prompts. On 2026-11-23 each moved into its target prompt,
or was dropped because its target had landed. Run those prompts as their own files say, with §1.2's
rows from §0.1.

---

## 3. Basket, checkout & orders — new prompts

### CK2 — Sellers issue promo codes; one redemption per account; a throttled route

> **Status 2026-11-23:** step 3 landed in `3041e5ef` (FBP DB19, #511: the per-account cap, with its
> column from step 2); steps 1, 2 and 4–6 below are open, and step 1 and 2 keep only what is left.
> Every wait is met (CK1, CK7, FBP DB16).

Closes MK-26 (🟡 → ✅).

```text
PROMPT CK2: A seller issues and retires promo codes for their own products; an account redeems a
code once by default; the promo route is throttled

ROLE: Full-stack engineer. Queue M: 00000017, 00001210.

CONTEXT (verified at b7280787; DB19's lines at f2e25929; re-check every line):
  - finance.promo_codes (00000017:992-1035) has no issuer column. It is definer-only (00001210
    ~:1129; grants 00002520 ~:813). Its only writers are seeds and probes
    (supabase/seeds/07_finance.sql:243); the only function write is redemption_count (00001210).
    DB19 built the per-account cap (#511): max_redemptions_per_account (00000017:1010) and
    finance.fn_promo_uses, refused PC409 'promo_already_used' at preview and at commit.
    routes/api/basket/promo.ts has no rate limit (FA CO22, "Open, no prompt").
  - Rules: PRODUCT_SPEC.md §Digital Marketplace 6 ("each account may redeem a code once; a code
    may allow more"); finance-model.md §1.2 (the seller's commission is taken on what the buyer
    paid for the line, after any promo) and §15; Decision #337 ruling M8. #457 prices a One-Off
    or Task line with no promo: read which line kinds take one today and keep that set unless I
    rule otherwise.
  - The seller's console is /catalogue (apps/web/features/catalogue/**), with URL-addressed views
    (`?view=`).

Who issues a code, and who funds it (ruled: Decision #485, 2026-11-18, A): a seller (a person, or
a team member holding publish_listings: catalogue.fn_manages_listing / org.fn_member_can('team',
…, 'publish_listings'), #485 (b)) issues codes for their own product listings, all of them or
chosen ones; the seller funds the discount, and commission is taken on the discounted price, as
finance-model §1.2 says. Platform-wide codes stay operator-only. #485 (a): the platform pays for a
platform code. The seller is credited as if the code had not applied (commission on the line
before the platform's share); the cost is a new finance.v_conservation_identity term (DB16 has
landed, #483).

STEPS:
  1. Red first: extend supabase/probes/promo_redemption_concurrency.sql: no seller can create a
     code today.
  2. Schema in place: the issuer (owner type + id; NULL = the platform), the listing scope and
     archived_at (nothing is hard-deleted). Doors (SECURITY DEFINER, search_path ''):
     finance.save_promo_code, archive_promo_code and list_own_promo_codes, each checking the
     capability itself.
  4. In a mixed basket a seller's code discounts only that seller's eligible lines.
  5. Throttle POST /api/basket/promo per account and per client key with the helper the auth
     routes use (apps/web/utils/client-key.ts; routes/api/auth/confirm.ts): 429 with
     Retry-After, so a burst cannot enumerate codes.
  6. UI: a Promotions view in the seller console (`/catalogue?view=promotions`, in ROUTING.md):
     create, list (code · discount · n of m redeemed · expiry, as MetaLine text), archive.

ACCEPTANCE: the promo probe: DB19's per-account and concurrency arms stay green; a seller's code
never discounts another seller's line; commission is on the discounted price; a platform code
credits the seller in full and conservation_identity.sql passes. A 30-request burst on the promo
route draws 429s. finance_invariants.sql passes. Screenshots of the Promotions view.

SAME CHANGE: PRODUCT_SPEC.md §Digital Marketplace 6 and finance-model.md §15 (the issuer rule as
ruled); FINANCE_AUDIT.md CO22; finance-model.md §1.2 ("after any seller-funded promo", #485 (a));
documentation/database/finance/*; Zod; ROUTING.md; the decision row.
```

§1.2 rows: **MK-26** 🟡 → ✅.

### CK4 — Tax at checkout, built behind a switch that stays off

> **Status 2026-11-23:** open; waits for FBP DB21, which has not landed at `f2e25929`.

Narrows MK-20 (it stays 🟡 until the switch is on); narrows PRD-M5.

```text
PROMPT CK4: Tax is calculated, shown and recorded at checkout and on invoices — built behind a
switch that stays off until the owner and counsel rule

ROLE: Payments engineer (Stripe + Postgres). Queue M, after DB21: 00000017, 00001210, 00001200.

CONTEXT (verified at b7280787; line refs at f2e25929):
  - There is no tax anywhere. taxNote: null in CheckoutBackendService.ts:217 (with a "no tax
    engine" comment), checkout-ssr.ts:289 and live-orders.ts:658; fn_generate_consolidated_
    invoice hard-codes v_tax bigint := 0 (00001200:1416). Zod already accepts tax as an input
    (packages/types/finance/checkout.ts:441-538, order.ts:245-256).
  - A9 is "Planned, no prompt" (FBP §0.6) and PRD-M5 is ❌. PRODUCT_SPEC.md :3539-3555 promises
    tax documents (1099, W-9, EU reverse charge).
  - The platform charges the buyer itself under Separate Charges & Transfers, settles in the
    nine currencies a GB platform can (#423 (B)), and a wallet order spends a balance topped up
    earlier.
  - Use the stripe:stripe-best-practices and stripe:stripe-docs skills for the current Stripe Tax
    API (calculations, transactions, reversals, registrations, product tax codes) before you
    design anything.

The tax model (ruled: Decision #490, 2026-11-18, A split by kind; ⚖️ counsel confirms the
obligation before any switch goes on): the platform calculates tax at the order, card and wallet
alike (never at top-up), with Stripe Tax: a calculation at /checkout/payment's preview, a tax
transaction recorded at commit and reversed on refund. A business buyer may give a VAT ID on
/checkout/details for reverse charge. Invoices carry tax lines from the stored calculation.
Registrations are mine, in the Stripe Dashboard. Tax is added at checkout (tax-exclusive). The
platform collects only on the kinds `tax_collected_kinds` names (digital_product by default);
every other line says the seller is responsible for any tax on their work. The product tax codes
are as tabled in #490 (C). All of it behind `tax_collection_enabled` (a platform param, off).
Re-verify DB21 at HEAD and stop if it has not landed (#490 (f)).

STEPS:
  1. Red first: a unit test that a GB consumer buying a digital product, with the switch on, sees
     a tax line; an invoice probe that v_tax is not 0 when the switch is on.
  2. Schema in place: the tax amount, jurisdiction and calculation reference on orders and lines
     (integer minor units), and the buyer's tax ID on the order; doors only.
  3. Checkout: taxNote and a tax line in the summary from the calculation, recomputed when the
     details change. With the switch off, today's behaviour exactly, pinned by a test.
  4. Commit: the calculation reference is recorded inside place_wallet_order's transaction; the
     Stripe tax transaction is created after commit, idempotently (finance.idempotency_keys), and
     reversed by the refund paths (DB21, MR3). Keep the Stripe Tax calculation behind one service
     function that LEGAL LG8 can call for a fee line.
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
in the target environment. **PRD-M5** narrowed (the checkout half). **MW-57** goes ❌ → 🟡 with CK4
now that LEGAL LG6 has landed (#527: platform reporting and tax-residence certificates; no 1099 /
W-9, which Stripe offers no path to for this account).

---

## 4. Reviews — new prompts

### RV1 — A buyer reviews what they completed; the seller replies once

> **Status 2026-11-23:** steps 1, 2, 4, 5, 7 and 9 landed in `b8958f1d` (#487, with `406fe3ac`) for
> engagements and sessions, as ruled. Steps 3, 6 and 8 below are open for the product arm, which
> ruling 5 held for CK1's delivery record; CK1 has landed (#488).

Closes MK-32 (🟡 → ✅).

```text
PROMPT RV1: A buyer reviews what they completed — an engagement, a purchase or a session — and
the seller replies once

ROLE: Full-stack engineer (Postgres doors + services + one dialog). Queue C: 00001670 (the
review doors), 00002510, the review seeds.

CONTEXT (verified at f2e25929; re-check every line):
  - The engagement and session arms are built (#487): every review carries exactly one anchor
    (project_id · cohort_membership_id · order_line_id, ck_entity_reviews_one_anchor, 00000019);
    the doors are 00001670 (submit_review … hide_review, get_reviewables, get_review_actions);
    ReviewDialog opens at `?review=<projectSlug>` on the project Overview. submit_review refuses
    an order_line anchor PT501 "product reviews open once a purchase records its delivery"
    (00001670 ~:506).
  - CK1 has landed (#488): catalogue.entitlements (order_line_id UNIQUE; status active ·
    refunded · revoked; first_delivered_at) and `/files?source=purchases`. CK3's
    `/checkout/orders` (f3ba4c3b) lists every order. Neither links `?review=` (#487 (c)).
  - The 16 seeded product reviews wait in PRODUCT_REVIEWS_AWAITING_DELIVERY
    (supabase/seeds/gen/reviews.ts; #487 (h)).

The product arm (ruled: Decision #487, rulings 1–6 as recommended; ruling 5 held this arm for
CK1): a buyer whose entitlement is active and has been delivered at least once reviews the
product. The window, edits, the reply and one review per (anchor, party, target) are as for the
other arms (rulings 2–4); the anchor completes at its first delivery. Nobody reviews their own
product; a 13-17 account never writes one.

STEPS:
  3. The product arm in the doors: submit_review takes an order_line anchor whose entitlement is
     active, delivered and held by the reviewer's party, in place of today's PT501; each refusal
     keeps its own SQLSTATE. Extend supabase/probes/reviews_writer.sql red first.
  6. Entry points: `?review=` from CK3's `/checkout/orders` rows and from the purchases view on a
     delivered entitlement (in ROUTING.md).
  8. The seed obeys the rule you ship: anchor the 16 PRODUCT_REVIEWS_AWAITING_DELIVERY reviews on
     seeded, delivered entitlements (never relax the CHECK for seed data).
     `deno task db:seed:generate`, then `deno task db:reset` (announce it).

ACCEPTANCE: reviews_writer.sql: a review on a delivered entitlement succeeds and moves the
product's average; an undelivered, refunded, revoked or foreign one is refused with its SQLSTATE;
every seeded product review has an anchor. Live, as two seeded personas: buy → download → review
→ the seller is notified → replies → both render on /view. Screenshots.

SAME CHANGE: PRODUCT_SPEC.md §Reputation 3 (the product arm); documentation/database/reviews/*;
Zod inputs; ROUTING.md; Seed.md; the decision row closing #487 (c) and (h).
```

§1.2 rows: **MK-32** 🟡 → ✅ once the product arm lands and the signed-in walk (§0.4) is recorded;
the "What's missing" cell cites T&S R2 for the user-facing Report entry point.

### RV2 — Providers review clients; the Client Trust Score and its warning

> **Status 2026-11-23:** open, and runnable: RV1's doors are in (#487), which is all it waits for.

Closes MK-33 (❌ → ✅).

```text
PROMPT RV2: The provider reviews the client too, double-blind; the Client Trust Score and its
warning

ROLE: Full-stack engineer. Queue C: 00001670 (RV1's doors), 00005060, the review seeds.

CONTEXT (verified at b7280787; RV1's state at f2e25929):
  - RV1 built the doors (00001670) and the one-anchor reviews (#487). #487 (g): the seed's
    provider-to-client reviews left with RV1; RV2 re-seeds them through its door.
  - PRODUCT_SPEC.md §Reputation 3: Reciprocity (ratings feed the "Client Trust Score") and a
    Warning System (a search penalty, a warning modal, "Informed Consent" before a proposal or a
    hire). :3419-3423: until the score's weighting is defined, a business shows its client rating
    (#244). :3496-3498 names a "Business Trust Score": one score, or two? That is a new
    contradiction.
  - Decision #244 flag (c): the Client Trust Score "has no definition or weighting".
  - org.get_profile_reviews already reads author_role = 'freelancer' (a provider reviewing a
    client), and live-view.ts:504-560 shows a project owner's client reviews (#142).
    packages/types/profile/tabs.ts:181 labels `freelancer` "fellow freelancer", which is wrong.
  - finance-model.md §16.7: review_sentiment 1.75, review_count 1.00, a cold-start prior of 5
    pseudo-reviews per track, volume saturating at 50.

Ruled (Decision #486, 2026-11-18, all four as recommended):
  1. Reveal: double-blind. Neither side's review of the other is visible until both have
     submitted or the window closes, so neither can retaliate. It becomes a spec rule.
  2. Client Trust Score v1: the Bayesian mean of providers' ratings of the client, k = 5 at the
     client-track mean; −0.25 per dispute the client opened and lost (resolved_release) in 12
     months, capped at −1.00; ghosting −0.10 each, capped at −0.50, dormant until #337 P3's
     auto-approve is built; floor 1.00; shown from 3 reviews.
  3. The warning: below 3.00 with at least 3 reviews, a demotion weight in Explore's
     project-opening ranking (search.search_weights; the `client_trust` coefficient is unset,
     #486 (c), proposal 2.50), and a modal a freelancer must acknowledge before applying or
     accepting a hire (logged: that is the Informed Consent).
  4. One score per client party, a person or a business, under one name (the Client vs Business
     Trust Score contradiction is logged in #486).

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

> **Status 2026-11-23:** open; waits for RV2.

Closes MW-64 (new, #489; ❌ → ✅). It keeps Standing honest now that RV1 writes reviews.

```text
PROMPT RV3: Standing's review component reads the reviews people actually wrote

ROLE: Postgres engineer. Queue C, after RV2.

CONTEXT (verified at b7280787): org.entity_standing's components.reviews is (client_rating_avg +
peer_rating_avg) / 10 × 20 (00001030:74), but no SQL writes either average; only seeds do
(seeds/11_standing.sql:107-127). Decisions #58-63 flag (h). The "peer" track has no target type or
writer (Seed.md:118), while the reviews table's two tracks are client and provider.
finance.ratings (00000017:365-374) is an unread legacy table.

The peer track (ruled: Decision #489, 2026-11-18, B): drop it from the formula until it is
specified and weight the client track alone, and a review recomputes its subject. The
component is client_rating_avg / 5 × 20, the Bayesian mean of the subject's visible, revealed
client reviews (k = 5 at the delivery track's corpus mean); peer_rating_avg stays, reserved,
never written. A review write (RV1's submit, edit, withdraw, hide; RV2's reveal) calls
org.fn_recompute_standing for the reviewed subject only (#58 (e) narrowed for reviews). At
b7280787: the seed reads client_rating_avg from the cached rating_average, not a literal (only peer is,
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

### SC6 — The Clients view links by slug and names every buyer; a team edits its listings

> **Status 2026-11-23:** step 4 landed in `e900af75` (#500 rewrote MK-44's and MK-45's notes); steps
> 1–3 below are open, and runnable: CK1 and SC4 (#535) have landed.

Closes MK-44 (🟡 → ✅); builds MK-45's ruled scope.

```text
PROMPT SC6: The seller's Clients view links by slug and names team and business buyers; a team's
listings are editable by the team

ROLE: Full-stack engineer. Queue C: 00001170.

CONTEXT (verified at b7280787; 00001170 refs at f2e25929):
  - #218 (a): the Clients readers' hrefs carry uuids: /messages/<uuid> (00001170 ~:1808) and
    /calendar?event=<uuid>; PRD-J1. ROUTING.md owns the thread's address (Decision #444 flag (a)
    records a PRODUCT_SPEC-vs-ROUTING contradiction about it: follow ROUTING, and if the flag is
    still open, do not resolve it here); #388 owns ?event=.
  - #218 (d): fn_seller_order_lines resolves a buyer only for owner_type user or freelancer
    (:1733, :1744), so a team's or a business's order shows no buyer.
  - #312 flag (a): every catalogue write door is creator-only (save_listing, apply_listing_media,
    set_listing_status, duplicate, delete), so a teammate cannot edit a colleague's team listing;
    CK1's freeze hook checks the creator too (#500 (a)). Flag (e): presets are not team-scoped.

Who may edit a team's listing (ruled: Decision #500, 2026-11-18, A tightened): any active
publish_listings holder edits, publishes, pauses and duplicates any team listing, and
create_listing for a team needs it too; deleting is the creator while still a holder, or a
member at the admin or owner rank; a team listing's presets live on the team's own schedule. The
inquiry link becomes /messages/dm-<handle>; ?event= stays (ROUTING, #388; PRD-J1).

STEPS:
  1. Red first: a probe for the uuid hrefs and the missing team buyer.
  2. Slugs in every href, per ROUTING.md; a team or business buyer named as the entity (its name
     and handle, as MetaLine text), never a blank.
  3. The ruling across the five doors and the presets; extend catalogue_publish_locks.sql.

ACCEPTANCE: no uuid in any Clients href but ?event=; a team's order names the team; under the ruling, a
teammate edits a colleague's listing (or is refused with copy that says why). Screenshots.

SAME CHANGE: ROUTING.md if a shape changes; documentation/database/catalogue/*; the decision row
closing #218 (a), (d) and #312 (a), (e).
```

§1.2 rows: **MK-44** 🟡 → ✅; **MK-45**'s note cleared once the ruled scope is built.

### SC7 — Request to Sell, the client's grant, and the royalty

> **Status 2026-11-23:** open; waits for FBP DB21 (CK1 and DB19 have landed).

Closes MK-46 (❌ → ✅).

```text
PROMPT SC7: A freelancer asks to sell an asset made on a project; the client grants it; every
sale routes the client's royalty

ROLE: Full-stack + payments engineer. Queue M (it changes place_wallet_order's money), after DB21
(#493 (D); CK1 and DB19 have landed).

CONTEXT (verified at b7280787):
  - PRODUCT_SPEC.md §Digital Marketplace 3 (:3148-3158 at 693819fd): a "strict approval gate".
    The freelancer triggers Request Marketplace Listing; the client may grant shared IP for the
    whole asset or for parts; the approved asset is minted with "a cryptographic link back to the
    original project". §5 (:3174-3185): Shared Royalty, "a percentage of every sale is
    automatically routed to the original Client's wallet".
  - Nothing exists: no table, door or UI, and catalogue.products has no provenance column. The
    enum ip_option_mode includes shared_ownership (00000003:41), used by
    projects.ip_ownership_mode and project_stages.ip_mode; the deed text is
    apps/web/features/legal/core/content/ip-transfer-deed.ts.
  - CK1's product_versions is what a minted product sells.

The royalty, who may request, and erasure (ruled: Decision #493, 2026-11-18, two points
re-ruled the same day, #493 (G); ⚖️ the licence wording a grant creates is counsel's):
  (1) The freelancer proposes a rate and the client approves or declines it as proposed, never
      counters; 0-50% of the seller's net, fixed at the grant; the commission first, then the
      royalty floored from what is left, the dust to the seller; the client credited through
      fn_wallet_credit_pending beside the seller, so a refund recovers both.
  (2) Only a released exclusive_transfer or licensed_use stage takes a request; shared_ownership
      already lets the maker sell, so it lists with provenance, no grant and no royalty, and the
      client is told; projective_partner is refused; a business grants through a member holding
      manage_projects; no 13-17 account on either side.
  (3) The grant survives erasure, its royalty stops and the seller keeps it; the grant sits behind
      a platform param that stays off until counsel.
Re-verify DB21 at HEAD and stop if it has not landed, and read #493's flags (a)-(c) before step 2
((d) is ruled).

STEPS:
  1. Red first: a probe that no request door exists and a sale routes nothing to the client.
  2. catalogue.sale_requests (requested · approved · declined · withdrawn; nothing deleted) and
     its doors.
  3. On approval, a draft product with provenance (the project, the stage, the source files'
     hashes: the "cryptographic link"), which the freelancer edits and publishes through the
     normal gate.
  4. The royalty leg in place_wallet_order, through the wallet doors (integer minor units,
     floored, the dust named), with its terms in finance.v_conservation_identity (DB16, #483).
     The client sees the earnings in their wallet. Notices both ways.

ACCEPTANCE: the probe: a request on a stage that cannot share refuses; an approved one mints a
draft with provenance; a sale pays the seller, the platform and the client exactly, and conserves
money; finance_invariants.sql passes. A live walk across two personas.

SAME CHANGE: PRODUCT_SPEC.md §Digital Marketplace 3 and 5 (the markers removed); finance-model.md
(the royalty leg); PRODUCT_MANAGEMENT.md (the request lifecycle); documentation/database/
{catalogue,finance}/*; Zod; ROUTING.md; the decision row.
```

§1.2 rows: **MK-46** ❌ → ✅.

### SC8 — A rights-holder reports a listing; an operator takes it down; the seller answers

> **Status 2026-11-23:** open; waits for T&S R2. T&S R1 has landed (`00f8e1f9`, #533): `ops.reports`
> carries the 'notice' source, its CHECKs and an empty strict `ReportNoticeSchema` for SC8 to fill.

Part of MK-47 (with T&S R2 and SC9; R1 landed).

```text
PROMPT SC8: A rights-holder can report a listing, an operator can take it down, and the seller can
answer

ROLE: Full-stack engineer. Queue C, after T&S R2 has landed (the report route); T&S R1 (the
ops.reports sink) has.

CONTEXT (verified at b7280787; R1 at 00f8e1f9): there is no inbound copyright path (#393 flag
(n), ruling B8: "a separate track, finished before the marketplace opens"). T&S R1 built
ops.reports (database/ops/Tables.md): source 'notice' with reporter_user_id NULL, a notice jsonb
CHECKed present exactly on a notice row and only with reason intellectual_property (#533's
vocabulary), and @projective/types/ops ReportNoticeSchema, an empty strict shell for counsel's
fields. R2 builds /api/reports and a listing entry point. PRD-D9 is ❌.

The intake and the takedown (ruled: Decision #496, 2026-11-18; ⚖️ the notice regime — the fields
a valid notice needs, the counter-notice, the repeat-infringer rule — stays counsel's): build the
mechanism behind a param that keeps the public form off until counsel's words are in.
(A) A rights-holder needs no account: ops.reports.source takes 'notice' (reporter NULL), with
an immutable, Zod-typed notice block that SC8 fills and files through its own rate-limited
door, never ops.file_report. (B) The takedown is a hold on catalogue.listings that an operator
door sets and lifts; setting it pauses the listing through set_listing_status's code path, and
set_listing_status refuses 'published' while it stands. No new status. Re-verify R2 at HEAD and
stop if it is missing (#496 (D)); R1 shipped the 'notice' source. 🧑 Ask #496 flag (b) (a strike against the person or the owning workspace) before
step 4.

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

> **Status 2026-11-23:** open, once per phase. Phase 0 was CK1 (#488); phase 1 runs now (A2 ruled
> #499; `/api/files/object` still serves at `f2e25929`).

The rest of MK-47.

```text
PROMPT SC9: ASSET_DELIVERY_ARCHITECTURE.md §14 phase <N> (or ANTI_PIRACY_ENGINE.md §14 phase <N>)

ROLE: as the phase needs. Queue C, unless the phase edits place_wallet_order (then Queue M).

CONTEXT: CK1 built phase 0 (#488). Read the phase's row in §14, every section it names, and its
rulings in §13 (A1-A11) or ANTI_PIRACY_ENGINE.md §13 (B1-B10). A2 is ruled (#499) and A6 and A8
(#488); Decision #393 logs the rest as open. USER_FLOWS MK-47 still says "21 rulings open":
correct its count when your phase lands.

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
| 1     | Signed reads closed; `/api/files/object` retired        | — (A2 ruled #499)                           |
| 2     | The upload whitelist, mandatory ClamAV, large files     | T&S SN2 (the safety node); A7               |
| 3     | The edge host, `SUPABASE_PUBLIC_URL`, the link resolver | Your edge choice; A5                        |
| 4     | The sandbox origin, the CDN, previews, private buckets  | Phase 3; A1, A4                             |
| 5     | Fingerprinting, by format                               | ANTI_PIRACY B-rulings                       |
| 6     | The registry and licence gateway                        | —                                           |
| 7     | Leak monitoring and takedown packs                      | ANTI_PIRACY B-rulings; plan gates (PRD-F14) |

§1.2 rows: **MK-47** → ✅ once every ASSET and ANTI_PIRACY phase has landed, with SC8.

### Added by Decision #525 — the editor items the owner deferred

Decision #525 (2026-11-20) rebuilt the listing editor and gave the session plan and the buyer
questions their own pages (`/catalogue/:slug/plan`, `/catalogue/:slug/questions`). The owner
deferred four of its brief's items, each to a work order below (rulings R1–R3). None closes an
existing row: each adds its PRODUCT_SPEC text and its own USER_FLOWS row in the change that lands
it. Read the #525 row (`reference/decisions/decisions-122-126.md`) first.

### SC10 — A session sold by the hour, with sittings of their own length

> **Status 2026-11-23:** open; written by #525 (`f2e25929`). Its 🧑 stop comes before any code.

```text
PROMPT SC10: A Session or Group Session priced per hour, with sittings of their own length

ROLE: Postgres + money-path engineer. Queue M (place_wallet_order), then the app lane.

CONTEXT (verified at 862a4b14 with #525 applied):
  - A session sells per sitting today, and checkout prices it in ONE place,
    finance.place_wallet_order (00001210:2032 a seat line, session_price × held seats; :2089 a 1-1
    or block line, session_price × session_count). Card checkout replays it (00001230:1025). The
    basket's units come from packages/backend/services/finance/live-basket.ts:562-569, and every
    line is re-checked against them (PC409 "The price of … changed"). Escrow is held per sitting
    (projects.fn_book_session_slot, 00001155:683, its length at :747) and per seat
    (projects.reserve_seat, :275).
  - One length per listing: service_blueprints.session_minutes. A plan entry
    (BlueprintSessionPlanEntrySchema, packages/types/explore/stored.ts:87) holds a title and a
    description only. The slot grid (BookingBackendService.slots) books every sitting at that one
    length.
  - #525 ruling R1 deferred this because a stored per_hour that checkout ignores would misprice
    buyers. Build the money path first and the controls last.

🧑 DECISION (before any code): (1) rounding: a sitting's price is rate × minutes / 60 in minor
units; round half up per sitting, or per booking? (2) may a per-session listing vary its sittings'
lengths, or does a varying length force per hour (the #525 brief's rule)? (3) is a Group Session's
seat priced per hour × the sitting's length too?

STEPS:
  1. Red first: supabase/probes/session_hourly.sql books a 90-minute sitting of a £60/hour listing
     through place_wallet_order and expects 9000 held. It fails today.
  2. Schema, additively and Zod first: marketplace.service_blueprints.pricing_unit
     ('per_session' default | 'per_hour') and an optional per-entry duration_minutes in
     session_plan (15-600, multiples of 5), mirrored through catalogue.save_listing.
     SessionOfferSchema / CohortListingOfferSchema gain pricingUnit and hasVariableSessionLengths
     (a refine forcing per_hour while lengths vary); the plan entry gains durationMinutes.
  3. One pure price per sitting in @projective/types (sittingPriceMinor(rate, unit, minutes)),
     mirrored exactly in SQL (finance.fn_sitting_price) and used by place_wallet_order, the basket
     units, fn_book_session_slot's per-sitting hold, reserve_seat and the receipt lines.
  4. The slot grid books each sitting at its own length; a block's later sittings keep theirs.
  5. Display: resolveListingPricing captions "per hour"; /view's lane, ledger and booking dialog
     state the rate and each sitting's price; the card agrees.
  6. Only now the controls: Pricing's Per session · Per hour SelectButton (locked to Per hour with
     an InlineNotice while lengths vary), and /plan's Variable session lengths toggle with a
     minutes NumberInput per sitting.

ACCEPTANCE: the probe is green for 1-1, block and seat lines, by wallet and by card; a regression
probe shows a per-session listing's totals byte-identical to before; `deno task test` is green.

SAME CHANGE: PRODUCT_SPEC (sessions, checkout); finance-model.md if the rounding rule is a number;
documentation/database/{marketplace,finance,projects}; DESIGN_SYSTEM §C.1 for a new control;
USER_FLOWS (a new MK row); the decision row closing #525 flag (a) for this item.
```

§1.2 rows: a new **MK** row (a seller prices a session by the hour) ❌ → ✅.

### SC11 — Rolling weekly templates for a group session

> **Status 2026-11-23:** open; written by #525 (`f2e25929`). Its 🧑 stop comes before any code.

```text
PROMPT SC11: A group session runs on rolling weekly templates, each buyer starting on the next
open chain

ROLE: Postgres + scheduling engineer. Queue C (00001155), then the app lane.

CONTEXT (verified at 862a4b14 with #525 applied):
  - Cohorts: projects.cohorts (00000015:829: cadence weekly · fortnightly · fixed, min_seats,
    enrolment_closes_at), opened one at a time by projects.open_cohort (00001155:1243; a sitting
    per occurrence at :1297 and :1370), seats held by reserve_seat (:275), the waitlist (#455),
    cancel_cohort (#498). The seller's dialog is
    features/catalogue/components/edit/availability/OpenCohortDialog.tsx.
  - allow_continuous_enrollment renders and does nothing (MK-59).
  - #525's design: a template per session position (weekday, start minute, timezone, seat
    capacity). Each occurrence of session 1 starts one chain whose session k is the next
    occurrence of template k after session k-1, so chains never share a sitting. A template
    schedule is therefore a generator of ordinary cohorts: open the next weeks' chains as cohorts
    and seats, holds, escrow, refunds, the waitlist and cancellation all work unchanged.

🧑 DECISION (before any code): (1) the horizon (how many weeks of chains stay open) and what opens
them (a scheduled job in the registry, or a save); (2) one capacity per chain (the smallest
template's) or per sitting; (3) what happens to a generated chain that closes empty (it holds no
money: cancel it quietly?); (4) whether the mode replaces Open cohort or sits beside it.

STEPS:
  1. Red first: a probe in which a saved template schedule yields cohorts whose sittings follow
     the chain rule, across a daylight-saving change.
  2. Schema, Zod first: catalogue- or marketplace-side listing_session_templates (blueprint,
     position, weekday, start_minute, timezone, seat_capacity) and
     service_blueprints.group_schedule_mode ('fixed_cohorts' default | 'rolling_templates').
  3. projects.fn_open_template_cohorts(p_now, p_limit): FOR UPDATE SKIP LOCKED, idempotent per
     chain start, in the job registry (the OPERATIONS pattern, #514, #518).
  4. /plan for a Group Session: Fixed cohorts · Rolling weekly, and a template row per session
     (weekday Select, time, timezone, capacity NumberInput); Availability keeps Open cohort in
     fixed mode.
  5. /view shows the next chain starts; a buyer lands on the earliest open one.

ACCEPTANCE: the probe is green; a generated cohort refunds and cancels exactly as a manual one
(the cohort probes re-run green); a booking lands on the earliest open chain.

SAME CHANGE: PRODUCT_SPEC (group sessions); PRODUCT_MANAGEMENT only if a cohort state is added
(none planned); documentation/database/*; ROUTING for any API; a Dev Context Switcher control for
the mode; USER_FLOWS (a new MK row, and MK-59 re-read).
```

§1.2 rows: a new **MK** row (a seller runs a group session on weekly templates) ❌ → ✅.

### SC12 — Files on a session plan, revealed by policy

> **Status 2026-11-23:** open; written by #525 (`f2e25929`). Its 🧑 stop comes before any code.

```text
PROMPT SC12: A session plan's files reach the buyer when their reveal policy allows

ROLE: Postgres + app engineer. Queue C.

CONTEXT (verified at 862a4b14 with #525 applied):
  - A product's files reach its buyer through entitlements (CK1, #488:
    /api/downloads/[entitlement]/[fileId], originals frozen at publish). A session has no files of
    its own; a plan entry is a title and a description.
  - A reveal policy that renders but is not enforced on the buyer's read is a dead control (root
    CLAUDE.md §3 item 11), which is why #525 ruling R2 deferred it.
  - #525's design: plan entry attachments [{ fileId, revealPolicy: on_booking | at_session_start |
    on_session_complete | manual }]; the file stays the seller's; the buyer reads it through a door
    that checks the booking and the policy at read time, never a public URL; a manual reveal is a
    seller act on the session.

🧑 DECISION (before any code): (1) a file frozen at publish like a product original (A6), or read
live from the seller's library; (2) whether a manual reveal tells the buyer (a notification type);
(3) whether a revealed file stays readable after a refund or a cancellation.

STEPS:
  1. Red first: a probe in which a buyer reads a file before its policy allows (refused) and after
     (served).
  2. Schema, Zod first: the plan entry's attachments; save_listing checks each file is the
     seller's (file_manifest's 42501 precedent).
  3. The door (projects.fn_session_file_visible(session, file, now)) and a route under
     /api/sessions/.
  4. /plan: attach from the files AssetPicker, with a revealPolicy Select (On booking · At session
     start · After session · Manual reveal); the buyer's session page lists the revealed files;
     the seller's Reveal now.

ACCEPTANCE: the probe is green for each policy; a stranger and an unbooked buyer get a 404.

SAME CHANGE: ASSET_DELIVERY_ARCHITECTURE.md if delivery changes; ROUTING; documentation/database/*;
PRODUCT_SPEC (sessions); the notification catalogue if (2); USER_FLOWS (a new MK row).
```

§1.2 rows: a new **MK** row (a buyer receives a session's files on its schedule) ❌ → ✅.

### SC13 — File-upload questions and numeric follow-ups

> **Status 2026-11-23:** open; written by #525 (`f2e25929`). Its 🧑 stop comes before any code.

```text
PROMPT SC13: A buyer question may take a file, and a follow-up may follow a number

ROLE: TypeScript engineer, then Postgres for any column. App lane.

CONTEXT (verified at 862a4b14 with #525 applied):
  - IntakeFieldKind (packages/types/services/intake.ts:40) has nine kinds and no file;
    IntakeAnswerSchema (:292) holds strings, numbers, booleans and lists; IntakeConditionSchema
    (:89) matches anyOf on a yes/no or choice source.
  - The buyer answers in IntakeFields (features/profile/components/hire/IntakeFields.tsx) on
    /view's booking, quote and Service Detail dialogs; intakeRefusal checks every write; the
    answers ride basket lines, invitations and quote requests.
  - #525 ruling R3 built /catalogue/:slug/questions on IntakeField and deferred both items; the
    builder is features/catalogue/components/questions/.

🧑 DECISION (before any code): (1) where an uploaded answer lives (the buyer's library, shared
with the seller only once bought?), its size and type limits, and the safety scan (T&S SN2);
(2) whether a greater-than or less-than follow-up reads a number's starting value when the buyer
leaves it.

STEPS:
  1. Red first: intake.test cases for a file answer and a numeric follow-up.
  2. Types: a `file` kind (answer [{ fileId }], maxFiles) and greaterThan / lessThan conditions on
     a number source (CONDITION_SOURCE_KINDS gains number), through visibleIntakeIds,
     intakeRefusal, intakeAnswerLines and the publish lock (a new kind is locked like the rest).
  3. The buyer control (FileUpload over the files upload path) and the server's check that each
     fileId is the buyer's.
  4. The builder: a seventh palette tile (File upload, the `upload` glyph) and the number trigger
     in FollowUpRule.
  5. Where the seller reads it: the brief and the quote card.

ACCEPTANCE: an upload answer survives a basket line and a quote request; the publish lock refuses
a kind change; `deno task test` is green.

SAME CHANGE: flows/ServiceCreation.md §1.1; PRODUCT_SPEC; documentation/database/* for any column;
DESIGN_SYSTEM §C.1 for a control; USER_FLOWS (MK-36's note).
```

§1.2 rows: **MK-36**'s note.

---

## 6. Last — the sweep

### MKZ — The rows, the work orders and the specs agree with the code

> **Status 2026-11-23:** open; runs last. Step 3 is void: the stale-text list it fixed was folded
> into the prompts on 2026-11-23.

```text
PROMPT MKZ: The marketplace readiness rows, the work-order files and the specs agree with the code

ROLE: Documentation engineer. App lane, last.

STEPS:
  1. Re-check every row of USER_FLOWS §Basket, checkout & orders, §Reviews and §Seller catalogue
     (and MK-12, MK-16) against main: the status, the "What's missing" text and every file:line,
     and whether each live run in MARKETPLACE_BUILD_PROMPTS.md §0.4 is recorded.
  2. MK-42: x-frame-options is SA's "second sanctioned loosening" (SYSTEM_ARCHITECTURE.md
     :2831-2839, #217 ruling (j)). 🧑 Ask me to close #219 (d) as sanctioned; then the row cites
     SA instead of the flag.
  4. MARKETPLACE_BUILD_PROMPTS.md §0: every landed prompt sits in §0.0's ledger with its commit,
     and every §0.1 row names an open work order or what it still waits for.

SAME CHANGE: docs only. `deno fmt` on the files you touched.
```

§1.2 rows: **MK-42**'s note; the scoreboard as it then stands.
