# Legal & Compliance Build Prompts — closing PRODUCTION_READINESS §M

> **Status: WORK ORDERS, not binding.** Claude Code prompts that take
> [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) §M (Legal & compliance) to 100%, and with it
> the "Legal, IP & compliance" flows of [USER_FLOWS.md](USER_FLOWS.md) (MW-55 – MW-58), ID-11 and
> PRD-A4. The rulings it builds on are the legal library's (#270), the AML posture (#336 I1) and
> checkout tax (#490).
>
> **Verified against code 2026-11-23 at `f2e25929`.** 9 open, 1 partly done, 0 done (§0 ledger).
> Runnable now: LG0, LG1, LG6, LG7.
>
> **This file holds open work only.** A session that runs a prompt prunes it here when it finishes
> (§1's closing duty; [`build-prompts.md`](../reference/build-prompts.md) §2).

**Rollup, not restatement.** Three rows already have owners elsewhere, and this file links to them:

- PRD-M3's hosted half is [OPERATIONS_BUILD_PROMPTS.md](OPERATIONS_BUILD_PROMPTS.md) **OPS7**.
- PRD-M5's checkout and invoice half is [MARKETPLACE_BUILD_PROMPTS.md](MARKETPLACE_BUILD_PROMPTS.md)
  **CK4** (#490).
- PRD-M6's dormant programme is
  [IDENTITY_BUILD_PROMPTS.md](../architecture/IDENTITY_BUILD_PROMPTS.md) **X2**.

No work order covers the rest: the counsel-ready library behind PRD-M1, the chain of title behind
PRD-M4 (and PRD-A4), the seller tax documents, the AML signals and tax on the platform's own fees.
Those get the prompts here, **LG0–LG9** (§3). ⚖️ items are built behind a switch that stays off; no
agent turns one on, and no agent sets `reviewedAt`.

---

## 0. Map, run order and stops

### 0.0 Done

No LG prompt has landed (checked at `f2e25929`). A prompt that lands gets its row here.

| ID | What landed | Commit | Text at |
| :- | :---------- | :----- | :------ |

### 0.1 Row → work order

| Row    | Gate | Crit     | Work order                           | The row flips when                                                                                                                                                           |
| :----- | :--- | :------- | :----------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRD-M1 | PROD | Critical | **LG1** → **LG2** → ⚖️ counsel → you | ✅ only when a human sets `reviewedAt` on every current version after counsel signs off, and the reconstructed 1.0 baselines are gone (#270 (b)). No agent sets `reviewedAt` |
| PRD-M2 | PROD | Critical | — (✅, AU1 #446)                     | — (LG3 extends it to two more documents if you choose A)                                                                                                                     |
| PRD-M3 | PROD | Normal   | OPS7 (OPERATIONS)                    | ✅ when `account-data-exports` returns a 2xx from the hosted scheduler                                                                                                       |
| PRD-M4 | PROD | High     | (LG3) → **LG4** → **LG5**            | 🟡 on LG4 (a signed transfer record on each final release) · ✅ on LG5 (audit packs)                                                                                         |
| PRD-M5 | PROD | High     | CK4 + **LG6**                        | 🟡 when both land with their switches off · ✅ when counsel confirms the obligations and the switches are on in the target environment                                       |
| PRD-M6 | PROD | Normal   | **LG7** + X2                         | ✅ when the signals record on every money movement they cover, an operator can read them, and the Safety Hold is built behind its switch · 🟡 if only the signals land       |
| PRD-M7 | PROD | High     | **LG8** (⏳ CK4)                     | 🟡 when built behind `platform_fee_tax_enabled` (off) · ✅ when counsel confirms and the switch is on                                                                        |
| PRD-A4 | UAT  | Normal   | **LG0**                              | ✅ when no placeholder is reachable. It stays ✅ when LG4 and LG5 open the pages again                                                                                       |

**USER_FLOWS rows that move:**

| Flow  | Crit     | Moves                                                                                                          |
| :---- | :------- | :------------------------------------------------------------------------------------------------------------- |
| ID-11 | Critical | 🟡 → ✅ with PRD-M1                                                                                            |
| MW-55 | Normal   | ❌ → 🟡 on LG4 (the workspace and its transfers page) · ✅ on LG5                                              |
| MW-56 | High     | ❌ → 🟡 on LG4 · ✅ once the IP Transfer Deed's text is counsel-reviewed (PRD-M1)                              |
| MW-57 | High     | ❌ → 🟡 when CK4 and LG6 land with their switches off · ✅ when the switches are on                            |
| MW-58 | Normal   | ❌ → ✅ on LG7 (signals recorded and readable by an operator; the reporting programme stays dormant by ruling) |

### 0.2 Findings the prompts rely on (checked 2026-11-19, still true at `f2e25929`)

These facts shape the prompts. Each prompt re-verifies the ones it relies on.

1. **Two documents are linked but never accepted on their own.** `org.legal_document_versions`
   allows only `terms`, `acceptable-use` and `privacy` (`00000011_tables_org.sql`, the slug CHECK),
   and the only acceptance surfaces are `join`, `join_oauth`, `join_enterprise` and `reaccept`
   (`00000003_enums_core.sql:97`). The Terms link the Escrow Terms and the IP Transfer Deed
   (`features/legal/core/content/terms.ts:42-44, 172-183`). Nothing records that a payer accepted
   the Escrow Terms, or that a maker accepted the deed, when they commit money or work.
2. **A copyright assignment needs the assignor's signature.** In the UK an assignment is effective
   only "in writing signed by or on behalf of the assignor" (CDPA 1988 s.90(3)); future copyright
   can be assigned in advance (s.91). The US rule is the same (17 U.S.C. §204(a)). PRODUCT_SPEC
   §Identity, Taxes & Compliance 4 has **Projective** sign the deed, while §18 and over (rule 1) has
   the adult party "sign IP transfer deeds". Whether the sign-up acceptance of the Terms is that
   signature is for counsel (FOUNDER_QUESTIONNAIRE Part E2.16; LG3).
3. **"Deed" is a legal term of art.** In English law a deed has execution formalities (LP(MP)A 1989
   s.1) that a click cannot meet. An assignment needs only a signed writing. Counsel may prefer
   another name. Code keeps "deed" (the spec's word) until counsel rules, and the UI label follows
   that ruling.
4. **File hashes come from the browser.** `files.items.content_hash` is computed client-side and may
   be a sampled digest (`00000010_tables_files.sql:130-140`). A transfer record must hash the stored
   bytes on the server.
5. **Escrow releases per ticket and matures later.** `finance.fn_release_ticket_escrow`
   (`00001200:1341`) moves money to `finance.pending_releases`, and `fn_mature_pending_releases`
   (`00001240:2611`) credits it 7 days later. Submissions belong to a ticket
   (`projects.stage_submissions.ticket_id`, `projects.submission_files`). The deed text says
   ownership passes when escrow is "finally released".
6. **The tax section is written for a US platform.** PRODUCT_SPEC §Identity, Taxes & Compliance 2
   promises 1099-K / 1099-NEC and W-9 collection. The platform account is GB (#423 (B)), on Connect
   Express (#125), and finance-model §9 says "Stripe issues 1099/local tax forms per jurisdiction".
   Nobody has checked that for a GB platform. Seller reporting under the UK platform-operator rules
   (2023 regulations) and EU DAC7 appears only in the retention table (FOUNDER_QUESTIONNAIRE I1).
7. **The library lags the product.** The words copyright, takedown, royalty, newsletter and
   controller appear in none of the six content modules. That leaves #496's notice regime, #493's
   royalty, #480's consent and #270 (h)'s data controller identity uncovered. #270's flags (c), (d),
   (f), (g) and (o) are still open.
8. **No cancellation-right step at checkout.** Nothing in `features/checkout` or the legal content
   mentions a consumer's statutory right to cancel. Since #488, `/checkout/payment` shows
   `DeliveryTermsNotice` for a basket that delivers files: a notice and an unticked box before Pay,
   which speak of a refund, not of the right to cancel. Nothing covers services or sessions. This is
   a candidate gap for counsel (FOUNDER_QUESTIONNAIRE Part E2.11, E2.12), not a row yet.

### 0.3 Run order

| Wave | Content / docs lane | SQL lane (serial)                                                                        | App lane                 | Waits for                                                                                       |
| :--- | :------------------ | :--------------------------------------------------------------------------------------- | :----------------------- | :---------------------------------------------------------------------------------------------- |
| 1    | **LG1** → **LG2**   | —                                                                                        | **LG0**                  | Nothing. LG2's brief is written (#528); its E.1.7 waits for LG1's drift table                   |
| 2    | —                   | (**LG3**, if you choose A) → **LG4** → **LG5**                                           | (LG4/LG5's UI halves)    | LG4 builds once LG2's brief is sent and LG3 and FINANCE DB6 land (#530 (g)); counsel rules text |
| 3    | —                   | **LG7** takes a turn in [the finance SQL lane](../architecture/FINANCE_BUILD_PROMPTS.md) | **LG6** (research first) | LG7: never beside MR8a/MR8b. LG6's reader after its 🧑                                          |
| 4    | —                   | **LG8**, in Queue M after CK4                                                            | —                        | CK4 (which waits for DB21)                                                                      |
| Last | **LG9**             | —                                                                                        | —                        | Everything above that can land                                                                  |

**Hot files.** LG3 edits `00001120` (`claim_ticket`) and `00001150` (`fund_stage`, `fund_ticket`).
PM-GH1, DB13 and DB14 write `00001150`, so LG3 never runs beside them. LG4, LG5 and LG7 each edit
`00002510` (one writer across all tracks) and `00005060` (jobs: one writer). LG4 adds one enqueue
line to `00001240` and LG7 edits its withdrawal path, so both take the finance SQL lane
(FINANCE_BUILD_PROMPTS.md §0).

**§M score projection** (weights: Critical 3 · High 2 · Normal 1; total 14):

| After                               | Score | Rows that flip |
| :---------------------------------- | ----: | :------------- |
| Today                               |   25% | —              |
| Wave 1                              |   25% | (PRD-A4 in §A) |
| Wave 2                              |   39% | M4             |
| Wave 3 (with CK4 built, switch off) |   54% | M6; M5 → 🟡    |
| Wave 4                              |   61% | M7 → 🟡        |
| OPS7 on staging                     |   64% | M3             |
| Counsel signs the library           |   86% | M1             |
| Counsel confirms tax; switches on   |  100% | M5, M7         |

### 0.4 Human stops and actions on this path

**Decisions** (each prompt states the options and the recommendation):

1. **LG0:** while the IP workspace is unbuilt, its addresses 404 (recommended) or 308 to `/legal`.
2. **LG1:** which new legal documents to add. Recommended now: a Copyright & Notice Policy (#496)
   and Marketplace Licence Terms (#493, product licences). A Data Processing Addendum with a
   sub-processor list should wait until the first business client asks for one. Seller tax duties go
   into the Terms. A new document widens the slug enum, so it needs your yes.
3. **LG1 / LG2 (🖊 yours alone):** the data controller's identity: legal name, company number,
   registered address, ICO registration number and the data-protection contact. No agent invents
   them.
4. **LG3 (⚖️):** does the maker accept the IP Transfer Deed, and the payer the Escrow Terms, when
   each first commits? Recommended **A**: once per version, at the first paid claim or the first
   funding, so friction stays low. **B** (rely on the Terms' links) is valid only if counsel says
   so. On B, skip LG3.
5. **LG4:** ruled (#530), every recommendation taken:
   - (a) a record issues at maturity, one per ticket escrow, and never for money that went back;
   - (b) no record on a Fair Exit; what happens to its IP is counsel's (⚖️, E2.18);
   - (c) a platform Ed25519 signature over RFC 8785 JSON, with a key id and published keys;
   - (d) "deed" in code, "Transfer record" in the UI until counsel rules (⚖️, E2.17);
   - (e) a public check that answers only "valid, issued <date>" or "not valid";
   - (f) every IP setting issues a record, which names the setting;
   - (g) LG4 builds after FINANCE DB6, LG2's brief and LG3.
6. **LG5:** ruled (#530): A. The client party gets the whole project, with every consolidated
   invoice that carries a line for it. A payee gets their own records, the agreements they are party
   to and their own payout statement, never a client invoice. An operator produces either through an
   audited door.
7. **LG6:** Stripe first (recommended): use what Stripe files, and keep a reporting dataset for what
   it doesn't. Log the US framing (finding 6) as a decision row.
8. **LG7:** answer Identity X2's stop (who builds what; A recommended), and set the signal
   thresholds as dials. The Safety Hold ships switched off.
9. **LG8:** is the 5% fee VAT-inclusive (**A**, recommended: "flat 5%" stays true and payout maths
   is unchanged) or is VAT added on top (**B**: it changes finance-model, every payout preview and
   the landing's claims)?

**Actions:**

- **⚖️ Counsel:** the library sign-off and every item in LG2's brief (FOUNDER_QUESTIONNAIRE Part E).
- **You, after counsel signs a document:** run LG2's sign-off runbook (Part E.4): set `reviewedAt`,
  remove the reconstructed baselines, mark material versions. That is the only route to PRD-M1 ✅.
- **You:** the switches (`tax_collection_enabled`, LG6's, LG7's Safety Hold, LG8's) in each hosted
  environment, once counsel has answered. No agent turns a ⚖️ switch on.
- **You:** generate LG4's signing key and put it in each environment's secrets. No agent sees the
  private key.

---

## 1. Headers

### 1.1 Standard header — paste above every LG prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types
the Zod SSOT @projective/types; packages/backend fat services @server/services/*;
supabase/migrations Postgres with RLS everywhere; Supabase Auth (GoTrue)).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (always
     documentation/CLAUDE.md; documentation/database/CLAUDE.md when SQL changes;
     packages/ui/CLAUDE.md for UI), then documentation/reference/guardrails.md and
     documentation/reference/pr-checklist.md.
  2. Read the documentation/readiness/PRODUCTION_READINESS.md §M rows and the USER_FLOWS.md rows
     your prompt names, and documentation/readiness/LEGAL_COMPLIANCE_BUILD_PROMPTS.md §0 (run
     order, file locks, stops). If you touch 00001240 or 00000017, also read
     documentation/architecture/FINANCE_BUILD_PROMPTS.md §0: its finance SQL lane decides when
     you run.
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
    views · 4 indexes · 5 seed). The Additive Rule: no dropped table, column or FK without my OK.
  - SECURITY DEFINER functions pin search_path = '' and schema-qualify every name. RLS stays on.
    A signed-in request runs under the user's JWT; the service role only before a session exists
    or inside a definer/cron door.
  - Thin routes (HTTP parse + Zod + auth guard); logic in packages/backend/services/* returning
    ServiceResult<T> (Decision #10). Islands never import Supabase or @server/*; they fetch
    /api/* through their feature's client service.
  - A schema or RPC-contract change lands with its Zod schema, the backend mapper and
    documentation/database/* in the same change; a route or URL change with ROUTING.md; an env
    key with SYSTEM_ARCHITECTURE.md §Environment Variable Contract and .env.example (XXXX-XXXX
    placeholders, never a real value).
  - Signal-first state; no useState; useEffect only for browser APIs. Token-only pure CSS + BEM.
    Path aliases only; JSDoc on exports; // #region blocks; no meta-comments.
  - A NEW contradiction between source docs: do not pick a side; add a decision row (newest
    decisions-*.md + README index line; re-check the next free number right before writing) and
    ask me.
  - 🧑 STOP or DECISION: stop at the named step, put the options and your recommendation to me,
    and build nothing that depends on the answer until I give it. ⚖️: build behind a param or
    flag that stays off; never switch it on. No agent sets reviewedAt.

Verification: reproduce the defect first (a failing probe or test), then fix.
  SQL: rollback-safe probes under supabase/probes/ (BEGIN … ROLLBACK); `deno task test:probes`;
  `deno task db:reset` is standing-approved but announce it to concurrent sessions; finish with
  your own clean `deno task test:probes:fresh`.
  Always: `deno task check`, `deno task lint`, `deno task test:unit`, and `deno fmt` on the files
  you touched only (never a directory). Compare any red unit test with main before calling it
  yours (theme-engine failures are pre-existing, Decisions #96 (a) and #157 (m)).
  UI-visible changes: `deno task dev`, sign in as the seeded personas
  (documentation/database/Seed.md), capture 1440 and 390 px.
This checkout may be shared with other sessions: never switch branch, never stash, stage only
your own hunks. Commit on the branch you were given. Do not push or open a PR unless I ask.

READINESS (Decision #444): in the same change, update documentation/readiness/
PRODUCTION_READINESS.md: the row(s) given under your prompt — status, and evidence naming your
commit and decision; recompute §M's line and the three tier rows of the Scoreboard (score =
Σ weight × credit / Σ weight; ✅ 1 · 🟡 0.5 · ❌ 0; Critical 3 · High 2 · Normal 1; ⏸ rows
excluded); add one line to §Score history. Update USER_FLOWS.md the same way if a flow's status
changes. Use 🟡 when a hosted or human step is left, and name it; never flip a row on a test you
did not run. A gap you find and do not fix gets a new row at the end of its area, never silence.

When you finish, do the closing duty (documentation/reference/build-prompts.md §2) in the same
commit as the work:
  - In documentation/readiness/LEGAL_COMPLIANCE_BUILD_PROMPTS.md: a done prompt leaves the file.
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

### 1.2 CK4, OPS7 and X2

Run them from their own files, with their own headers: CK4 in
[MARKETPLACE_BUILD_PROMPTS.md](MARKETPLACE_BUILD_PROMPTS.md), OPS7 in
[OPERATIONS_BUILD_PROMPTS.md](OPERATIONS_BUILD_PROMPTS.md) §2, X2 in
[IDENTITY_BUILD_PROMPTS.md](../architecture/IDENTITY_BUILD_PROMPTS.md). Their rows here: CK4 narrows
PRD-M5 (MW-57 stays ❌ until LG6), OPS7 flips PRD-M3, X2 shares PRD-M6 with LG7.

---

## 2. Other files' prompts

This section held deltas onto CK4, OPS7 and X2. On 2026-11-23 CK4's moved into CK4 itself, OPS7's
said nothing new, and X2's went to IDENTITY. Nothing is left here.

---

## 3. New prompts

### LG0 — The IP workspace answers 404 until it is built

> **Status 2026-11-23:** open; runs now.

Closes PRD-A4 (UAT).

```text
PROMPT LG0: No placeholder is reachable: /legal/workspace and its two pages answer 404 until
LG4 builds them

ROLE: Web engineer (Fresh routes). App lane. Not beside LG4 or LG5 (same routes).

CONTEXT (verified at 197b0d0c; re-check every line):
  - features/legal/workspace/routes/LegalWorkspaceScreens.tsx renders PagePlaceholder for
    /legal/workspace, /audit-packs and /transfers (routes/(dashboard)/legal/workspace/*.tsx).
    The only placeholder left besides it is /home (PRD-A1).
  - Nothing links there: grep finds only robots.ts:38 (disallowed), restricted-surfaces.ts:26
    (13–17 bounce) and tests/e2e/public-routes.spec.ts:692. The deed's record clause tells
    readers the workspace "will" hold deeds; that sentence stays true.
  - Root CLAUDE.md §3.11: a control that renders must do something; UAT means no placeholder
    is reachable.

🧑 STOP (architect default; confirm or override): 404 (recommended: the page does not exist
yet, and a redirect would imply it has a home elsewhere), or a 308 to /legal.

STEPS:
  1. Red: a route test that GET /legal/workspace, /legal/workspace/audit-packs and
     /legal/workspace/transfers answer 404 for a signed-in adult. It fails today.
  2. Each handler throws the app's 404 (as other unbuilt addresses do; grep for the house
     pattern). Keep the files, the reserved `workspace` segment (LEGAL_RESERVED_SLUGS), the
     restricted-surface entry and the robots line. Delete the PagePlaceholder screens, and leave
     one constant naming LG4 as the prompt that opens them.
  3. Update the e2e expectation at public-routes.spec.ts:692.

ACCEPTANCE: the three addresses 404 signed in, and a guest still meets the (dashboard) guard
first. check, lint and test:unit are green.
SAME CHANGE: ROUTING.md's IP workspace row ("reserved; 404 until LG4"); #270's index line gets
"(workspace hidden until built, LG0)"; PRODUCT_SPEC sitemap row unchanged.
```

Readiness rows (§1.1): **PRD-A4** → ✅. MW-55's note changes to "Hidden until LG4 (PRD-A4 ✅)" and
its status stays ❌.

### LG1 — The six legal documents say what the product does

> **Status 2026-11-23:** open; runs now.

Prepares PRD-M1. Nothing flips to ✅.

```text
PROMPT LG1: Bring every legal document's newest draft into line with the product as built and
ruled, and make the Cookie Policy match what the code stores

ROLE: Legal-content engineer. Content lane: apps/web/features/legal/core/content/*, their
tests, and the storage-key files. Not beside another prompt that edits features/legal/**.

CONTEXT (verified at 197b0d0c; re-check every line):
  - Six documents, each a versioned content module (Decision #270): terms (2.0, 1.0),
    escrow-terms (2.0, 1.0), privacy (1.1 dated 2026-11-18 + earlier), cookies, acceptable-use,
    ip-transfer-deed (1.0). Every version has reviewedAt: null, so each page is a noindexed
    "Draft — pending legal review", and the sitemap lists none (core/sitemap.ts:34).
    content.test.ts pins a citation on every clause constant.
  - #270's open flags: (b) the reconstructed 1.0 baselines of Terms and Escrow Terms must be
    removed once a lawyer approves the first real version (owner ruling, a launch blocker,
    #279); (c) Fair Exit: Escrow Terms 2.0 states the shipped 25/50/75% tier, while
    finance-model §3 still has the old duration thresholds; (d) a late session cancellation
    forfeits to the freelancer, not finance-model §4's 50%; (e) the AUP's planned enforcement
    and its /contact link; (f) `projective_partner` has no terms; (g) cookie keys declared but
    never set (pj_auth_refresh, pj_csrf, pj_active_context, pj.locale; CacheKeys
    pj-cache-assets, pj-cache-onboarding-stage); (h) no data controller identity; (o) the
    no-show rule's wording versus PRODUCT_SPEC §Dispute Resolution 3.
  - Rulings since the documents were written that may not be reflected (grep each module):
    #446 acceptance, #450 data export, #480 / #492 / #502 consent and the newsletter, #486
    reviews (double-blind, the Client Trust Score), #490 tax (prices exclude tax; the seller is
    responsible on services and sessions), #493 Request to Sell and its royalty, #496 copyright
    notices and takedown holds, #435 FX quotes, #474 / #479 / #511 refunds and settle-first,
    #498 cohorts. Today the words copyright, takedown, royalty, newsletter and controller appear
    in none of the six modules.
  - Versions are append-only once published (#270), and nothing has been published. Before you
    edit, read `git log -p -- apps/web/features/legal/core/content` and follow how privacy 1.1
    was added (a new version, or a correction to an unpublished draft).

🧑 STOPS (put both to me before step 4):
  (a) New documents. Each one widens LegalDocSchema's slug enum (packages/types/content/
      legal.ts), the registry and the hub. Recommended now: a Copyright & Notice Policy (#496's
      notice, counter-notice and repeat-infringer rule, left as counsel's blanks behind its
      public-form switch), and Marketplace Licence Terms (what a buyer of a digital product
      gets, and #493's licence wording). Later: a Data Processing Addendum and a sub-processor
      list, when the first business client asks. No separate seller terms: their tax duty goes
      into the Terms.
  (b) The data controller's identity (#270 (h)): legal name, company number, registered
      address, ICO registration number and a data-protection contact. Only I can supply these.
      Until I do, the Privacy Policy keeps no placeholder text, and LG2's brief lists it as
      missing.

STEPS:
  1. Drift table first, in your report and in LG2's brief: for every clause of every newest
     version, check it against its cited source and the current code, and add a row for each
     difference (document · clause id · what it says · what is true now · source file:line or
     decision).
  2. Fix the drift in the newest draft of each document, following the convention you found.
     Each fixed clause cites its source. Never touch a clause's `id` (Compare matches on it).
     Where the product rule itself is unsettled, write nothing new: list it in the drift table
     for LG2.
  3. Settle #270 (c), (d) and (o) at their source. Where finance-model.md or PRODUCT_SPEC.md is
     the stale side, fix that doc in the same change. Where the code and the spec disagree, add
     a decision row and ask me; don't pick a side.
  4. After (a): add the documents I approve, each at 1.0 with reviewedAt: null, its clauses
     cited, linked from the hub and the Terms. For any blank that is counsel's, the clause says
     what the platform does today and nothing more.
  5. Cookies and storage: list every cookie, localStorage / sessionStorage key, IndexedDB store
     and service-worker cache the code actually sets (grep the setters, not the key catalogue).
     Then remove each key that is declared but never set (#270 (g)), or wire it if a live
     feature needs it, and make the Cookie Policy match. If anything non-essential is set
     without consent, add a new PRD-M row (❌), and don't fix it here.
  6. The Privacy Policy names every processor that is on in some environment, and every use of
     personal data the product makes, including LG7's monitoring signals if LG7 has landed. If
     LG7 hasn't landed, the clause waits, and the drift table records it.

ACCEPTANCE: content.test.ts, legal-views.test.tsx and the diff tests are green. Every
document's newest version has no drift row left that is not listed for LG2. The hub and each
document render (1440 and 390 px, with the draft disclosure still shown). check, lint and
test:unit are green.
SAME CHANGE: finance-model.md / PRODUCT_SPEC.md where they were the stale side;
DESIGN_SYSTEM §C.1 only if a component changed; a decision row for any contradiction found.
```

Readiness rows (§1.1): **PRD-M1** stays ❌, with the evidence "library brought current (LG1,
<commit>); awaiting counsel". Add any new rows from step 5.

### LG2 — One counsel brief for the legal library and every open ⚖️ item

> **Status 2026-11-23:** partly done. Steps 2 and 3, and step 1 except Part E.1.7, landed in
> `b3148e47` (FOUNDER_QUESTIONNAIRE Part E, Decision #528). Step 1's E.1.7 is open: it waits for
> LG1's drift table. Sending the brief to counsel is yours.

Prepares PRD-M1. Docs only.

```text
PROMPT LG2 (the rest): Fill FOUNDER_QUESTIONNAIRE.md Part E.1.7 from LG1's drift table

ROLE: Compliance analyst. Docs only; no code. Runs once LG1 has landed.

CONTEXT:
  - Part E is written (#528). E.1.7 is a slot that reads "Pending: LG1's drift table …".
  - LG1's drift table has one row per difference: document · clause id · what it says · what
    is true now · source. LG1 fixes what it can in the drafts and leaves the rows whose product
    rule is unsettled for this brief.

STEPS:
  1. (E.1.7 only.) Replace the slot with the rows LG1 left open, one line each, naming the
     question each puts to counsel. A row that is the owner's product question, not counsel's,
     gets a row in PRODUCTION_READINESS §Decisions awaiting a human instead. A new ⚖️ item
     goes into E.2 at the next free E2 number, with its §Decisions row. If the owner has
     answered LG1's stops, update E.1's planned documents and E.5 items 1 and 4.

ACCEPTANCE: E.1.7 has no "Pending" text. Every ⚖️ on the tracker is in Part D, in Part E, or
ruled.
SAME CHANGE: PRODUCTION_READINESS §Decisions awaiting a human, for any row added; #528's index
line, if E.2 grows.
```

Readiness rows (§1.1): **PRD-M1** stays ❌ (its evidence already names the brief). No score changes.
### LG3 — The maker accepts the deed and the payer the Escrow Terms, once per version (conditional)

> **Status 2026-11-23:** open; runs only on A at §0.4 item 4, after LG2's brief is sent.

Runs only if you choose **A** at §0.4 item 4. It strengthens the evidence LG4 references.

```text
PROMPT LG3: The first paid claim records the maker's acceptance of the IP Transfer Deed, and the
first funding records the payer's acceptance of the Escrow Terms, once per version

ROLE: Full-stack engineer (Postgres + Deno + one dialog). SQL lane. You hold 00002510 while you
run. Never beside PM-GH1, MR1, MR2, DB13 or DB14 (00001150).

CONTEXT (verified at 197b0d0c; re-check every line):
  - org.legal_document_versions allows slug IN ('terms','acceptable-use','privacy')
    (00000011_tables_org.sql); org.legal_acceptance_surface is ('join','join_oauth',
    'join_enterprise','reaccept') (00000003_enums_core.sql:97); LEGAL_VERSIONS mirrors the seed
    (packages/types/legal/manifest.ts:57, with a unit test); acceptances are append-only, with
    no IP address and no user agent (#446).
  - The Terms link the Escrow Terms and the IP Transfer Deed (terms.ts:42-44, 172-183), and
    nothing records acceptance of either one by itself.
  - The commit points: projects.claim_ticket (00001120:687); projects.fund_stage (00001150:935),
    fund_ticket (:1100) and fund_paid_revision (:625); finance.fund_with_conversion
    (00001240:2400). A bought service funds through checkout (Queue M): only its claim is in
    scope here, not the checkout.
  - #446's pattern: the client sends the versions it showed, the door re-checks them against
    the database, and a forged or stale version is refused. A restricted (13–17) account
    records nothing.

⚖️ Counsel decides whether this is needed (LG2 E.3). You chose A, so build it. The text being a
draft does not block it: #446 also recorded drafts.

STEPS:
  1. Red: probes that (a) a first paid claim without the current deed version is refused, and
     the same claim carrying it records one acceptance row; (b) a second claim at the same
     version records nothing and asks nothing; (c) funding behaves the same way for
     escrow-terms; (d) a forged version is refused.
  2. Schema, edited in place: the two slugs added to the CHECK; surfaces `claim` and `fund`;
     the 1.0 rows seeded in 00005050; LEGAL_VERSIONS and its test.
  3. One guard, org.fn_require_legal_acceptance(p_slug, p_versions jsonb): it returns if the
     caller has accepted the current version, records the acceptance if the given version is
     current, and otherwise raises a coded error the services map to 409
     `legal_acceptance_required`. Each commit door calls it with one PERFORM line. Grant it in
     00002510.
  4. UI: when a claim or a funding door answers `legal_acceptance_required`, show a Dialog with
     an unticked box ("I accept the IP Transfer Deed v1.0" with a link, or the Escrow Terms)
     and retry the action with the version. One dialog component, used in both places.
  5. ERA classification: these rows are HOLD (contract evidence; ERA1's
     account_erasure_scope.sql, if it has landed; otherwise say so for ERA1).

ACCEPTANCE: the probes are green; a seeded freelancer's first claim shows the dialog once and
never again for that version; a client's first funding the same. test:probes, check, lint and
test:unit are green; screenshots at 1440 and 390 px.
SAME CHANGE: documentation/database/org/*; Zod; SYSTEM_ARCHITECTURE's legal acceptance
paragraph; PRODUCT_SPEC §Identity, Taxes & Compliance 4 (when the maker accepts); the decision
row.
```

Readiness rows (§1.1): **PRD-M2**'s evidence gains "the Escrow Terms and the deed at first commit
(LG3)". It stays ✅. No score changes.

### LG4 — A signed transfer record on each final release

> **Status 2026-11-23:** open; its stops are ruled (#530). It builds once FINANCE DB6 has landed,
> LG2's brief is sent (not answered) and LG3 has landed (#530 (g)). Step 1 was run red in the ruling
> session and lands with step 2, so peers' gates stay green.

PRD-M4 → 🟡, MW-56 → 🟡, MW-55 → 🟡.

```text
PROMPT LG4: When a ticket's escrow finally releases, Projective issues a signed transfer record
naming the files (hashed on the server), the project, the parties and the IP setting

ROLE: Backend engineer (Postgres + a Fresh job + crypto) with one UI page. SQL lane: 00002510,
00005060 and one enqueue line in 00001240, taken in the finance SQL lane (FINANCE_BUILD_PROMPTS.md
§0).

CONTEXT (verified at 197b0d0c; re-check every line):
  - Release is per ticket: finance.fn_release_ticket_escrow (00001200:1341) moves the payout to
    finance.pending_releases. finance.fn_mature_pending_releases (00001240:2611) credits it
    once available_at passes (7 days, #191). A Fair Exit releases part (fn_fair_exit_release,
    00001200:1585). Sessions and cohort seats release too, but carry no IP.
  - Deliverables: projects.stage_submissions (ticket_id) → projects.submission_files →
    files.items. files.items.content_hash is computed in the browser and may be sampled
    (00000010:130-140), so it cannot anchor a legal record.
  - The IP setting (ip_option_mode, 00000003:41): projects.ip_ownership_mode, overridden per
    stage by project_stages.ip_ownership_override (NULL inherits), plus
    portfolio_display_rights. project_stages.ip_mode is a copy written at stage creation that
    falls back to exclusive_transfer (00001130:541), and nothing reads it (#530 (D) 1).
  - The clearing window: a lost chargeback recovers from the payee's pending rows across the
    whole wallet, soonest first (finance.fn_recover_from_pending), until DB6 ties a hold to the
    disputed escrow. With pending_release_days at 0, fn_wallet_credit_pending credits at once
    and writes no row. A team release clears as several rows (members, finder, vault), and a
    team Fair Exit's member rows carry `team_split`, as a full release's do (#530 (D) 2–4).
  - The deed text (ip-transfer-deed.ts): ownership passes "when the escrow for that work is
    finally released"; the record clause says a signed deed is being built.
  - Machinery to reuse: the PDF writer (packages/backend/core/pdf.ts + services/legal/
    legal-pdf.ts); the HTTP job pattern and its bearer registry (OPS1); the notification
    catalogue (00005010).
  - LG3's acceptance rows if LG3 ran; otherwise the assignor's latest acceptance of the Terms.

RULED (Decision #530; the owner took every recommendation):
  (a) A record issues when the escrow's money has cleared to its payee, never at release: at
      the sweep's maturity, and at the immediate credit when pending_release_days is 0. One
      request per ticket escrow, however many rows it cleared as. An escrow whose clearing
      money went back (DB6's hold, then a lost dispute) gets none.
  (b) A Fair Exit partial release issues no record. Tell it apart by how the escrow settled
      (its `fair_exit_refund`), not by the row's reason. ⚖️ What happens to the IP after a
      Fair Exit is counsel's (FOUNDER_QUESTIONNAIRE E2.18); the deed's text follows the answer.
  (c) An Ed25519 platform signature over the record's canonical JSON (RFC 8785), with a key
      id. The private key is env LEGAL_DEED_SIGNING_KEY, which the owner generates; the public
      keys are published at a stable URL.
  (d) ⚖️ The code keeps "deed"; the UI says "Transfer record" until counsel rules (E2.17).
  (e) A public check: given a record's slug and hash, it answers only "valid, issued <date>"
      or "not valid", and names no party.
  (f) Every IP setting issues a record, and the record names the setting as at issue: the
      effective one, COALESCE(stage ip_ownership_override, project ip_ownership_mode).
  (g) Who signs (#530 (C); counsel: E2.16): the record carries the platform's signature and
      the assignor's acceptance by reference.

STEPS:
  1. Red: a probe that a matured ticket release under exclusive_transfer creates exactly one
     pending record request per escrow (individual, and a team release that clears as several
     rows) and that a second sweep adds none; a probe that a refund, a dispute reversal or a
     Fair Exit (individual and team) creates none; a unit test that the canonical payload
     signs and verifies, and fails verification if one byte changes.
  2. Schema, additive and in place: projects.ip_transfer_deeds (or the schema you justify in a
     decision row). It holds a prefixed opaque slug (pick an unused prefix, Decision #88); the
     ticket, stage, project, pending release and escrow; the assignor (person or team) and the
     assignee party (person or business); the ip mode and portfolio rights as at issue; the
     document version and the acceptance ids; the file manifest (file id, name, size, server
     SHA-256); the canonical payload, its SHA-256, the signature and key id; and issued_at.
     Append-only by trigger. Its lifecycle (requested → issued; never deleted) goes into
     PRODUCT_MANAGEMENT.md. Read by the parties through RLS helpers (a business party's
     members by the capability you name), and never by a 13–17 account. In the same change,
     either make project_stages.ip_mode follow the effective setting (if the P track is clear
     of 00001130) or give the stale copy a PRODUCTION_READINESS row (#530 (D) 1).
  3. Enqueue, per (a): fn_mature_pending_releases and fn_wallet_credit_pending's immediate
     branch each record the escrow's request in the same transaction, with one PERFORM line
     each in 00001240 (one request per escrow, a replay adds none).
  4. The job `legal-issue-deeds` (registered in 00005060, its bearer added to OPS1's registry)
     takes requests, streams each submission file from storage and hashes the stored bytes,
     builds the payload, signs it, and writes the record through a service-role definer door.
     It is idempotent per request; a failed hash retries and never issues a partial manifest.
  5. Notify both parties (a catalogue event in 00005010, through comms.fn_notify).
  6. UI: open /legal/workspace (its index: a short explanation and the latest records) and
     /legal/workspace/transfers (the records the viewer is party to), undoing LG0 for these
     two. Add a per-record PDF (legal-pdf, the hash, the key id and the verify address) and the
     public check from (e). /audit-packs stays 404 until LG5.
  7. Erasure: the records are HOLD (ERA1's scope file, or a note for ERA1).

ACCEPTANCE: on a seeded project, approve a ticket, advance time past maturity in a probe, run
the job, and see one signed record whose file hashes equal sha256 of the stored objects; the
verify check passes, and fails for an altered payload; a refunded ticket has no record; a
13–17 account cannot read one. test:probes, check, lint and test:unit are green; screenshots of
both pages at 1440 and 390 px.
SAME CHANGE: documentation/database/projects/*; Zod; ROUTING.md (the two pages, the PDF, the
verify address); SYSTEM_ARCHITECTURE §Scheduled jobs and §Environment Variable Contract;
.env.example (LEGAL_DEED_SIGNING_KEY=XXXX-XXXX); PRODUCT_SPEC §Identity, Taxes & Compliance 4
("Not built yet" removed for the record); PRODUCT_MANAGEMENT.md; the deed's record clause in
LG1's convention; the decision rows.
```

Readiness rows (§1.1): **PRD-M4** → 🟡; **MW-56** → 🟡 ("text pending counsel, PRD-M1"); **MW-55** →
🟡.

### LG5 — Audit packs

> **Status 2026-11-23:** open; its stop is ruled (#530); waits for LG4.

PRD-M4 → ✅, MW-55 → ✅.

```text
PROMPT LG5: A project's audit pack: its agreements, invoices and transfer records in one signed
bundle, built in the background and downloaded through a short-lived link

ROLE: Full-stack engineer. SQL lane (00002510, 00005060), after LG4.

CONTEXT (verified at 197b0d0c; re-check every line):
  - PRODUCT_SPEC §Identity, Taxes & Compliance 4: "all contracts, invoices, and IP deeds in a
    single, verified bundle", for a dispute or an acquisition.
  - The data export (#450) already does this shape: a request door (recent sign-in, one open,
    one a day), the account-data-exports job (routes/api/user/cron/data-exports.ts,
    DataExportBackendService.ts) writing a ZIP to a service-only bucket, and a 7-day per-read
    link. Reuse the pattern and its helpers; don't fork them.
  - Contents to gather: LG4's records (PDF + JSON); each party's legal acceptances
    (org.legal_acceptances, LG3's if any); the project's NDA document if one is set
    (projects.nda_document_id); the invoices and receipts for the project's money (finance; the
    consolidated invoice PDF); the project's IP setting history if it is stored.
  - A consolidated invoice spans many stages and projects (finance.invoices.project_stage_id
    is nullable; its line items point at escrows), so no invoice belongs to one project.

RULED (Decision #530, A): the client party (a person, or a business member holding the
capability you name) gets the whole project, with every consolidated invoice that carries a
line for the project's escrows, whole. A payee gets their own transfer records, the agreements
they are party to and a statement of their own payouts on the project, never a client invoice
or another payee's payout. An operator may produce either for a dispute, through an audited
door.

STEPS:
  1. Red: probes that a payee's pack never contains a client invoice or another payee's
     payout; that the client's holds every invoice with a line for the project; that a 13–17
     account and a stranger are refused.
  2. The request door and the job, on #450's pattern. The ZIP holds a manifest.json listing
     every file with its SHA-256, and the manifest is signed with LG4's key, so the bundle is
     "verified".
  3. /legal/workspace/audit-packs: request, status, download. Undo LG0 for this page.

ACCEPTANCE: a seeded client downloads a pack whose manifest verifies and whose hashes match
its files; a payee's pack holds only their own material; the probes are green; screenshots at
1440 and 390 px.
SAME CHANGE: documentation/database/*; ROUTING.md; SYSTEM_ARCHITECTURE §Scheduled jobs;
PRODUCT_SPEC (the rule on who gets which pack); the decision row.
```

Readiness rows (§1.1): **PRD-M4** → ✅; **MW-55** → ✅.

### LG6 — Seller tax documents and platform reporting

> **Status 2026-11-23:** open; its research runs now, its reader after the stop.

Covers PRD-M5's payout half and MW-57, beside CK4.

```text
PROMPT LG6: Find out what Stripe already files for this platform, collect only what it does not,
and keep the seller-reporting dataset a GB platform may owe

ROLE: Payments engineer + compliance analyst. App lane for the research; the SQL lane for the
reader after the stop.

CONTEXT (verified at 197b0d0c; re-check every line):
  - PRODUCT_SPEC §Identity, Taxes & Compliance 2 promises 1099-K / 1099-NEC, W-9 collection at
    Level 2, EU reverse charge on invoices (CK4's), and storage for tax residence
    certificates. finance-model §9: "Stripe issues 1099/local tax forms per jurisdiction" is
    unverified.
  - The platform account is GB (#423 (B)), Connect Express on Accounts v2 (#125). org has a
    tax_id column (00000011:292) and finance a business_tax_id (00000017:1393): find what
    writes and reads each.
  - The retention table (FOUNDER_QUESTIONNAIRE I1) already names "seller tax-reporting data
    (platform reporting)": 6 years (UK), 10 years (EU sellers, DAC7).

STEPS:
  1. Research, read-only, with the stripe:stripe-docs and stripe:stripe-best-practices skills:
     what Connect tax reporting offers a GB platform with Express accounts (1099 forms, W-9 / TIN
     collection during onboarding, DAC7 or UK platform reporting support), and what the Express
     dashboard shows a seller. Cite URLs, quote at most one sentence each, and draw no legal
     conclusion.
  2. 🧑 + ⚖️ STOP. Put this to me with the research:
     A (recommended), Stripe first: what Stripe collects and files stays Stripe's. Projective
       keeps a per-seller, per-period reporting reader over the ledger (gross consideration,
       fees, number of paid activities, country, and the identity and TIN references Stripe
       holds), exported by an operator. Filing is a human's job. Tax residence certificates are
       a private upload in Settings → Payouts that a seller can share with a client party.
     B: Projective generates per-jurisdiction forms itself.
     Also log a decision row: the spec's tax section is written for a US platform (1099 / W-9)
     while the platform is GB, and UK and EU seller reporting is unmentioned (§0.2 finding 6).
     That is a gap for me and counsel, not one for you to resolve.
  3. On A: the operator-only STABLE reader and its CSV export (00001200 or the finance read file
     the house uses; grant in 00002510), and a probe on fixtures. In Settings → Payouts, a "Tax
     documents" section: where Stripe's forms live (the Express dashboard link, if step 1 shows
     one) and the certificate upload (the files pipeline, private, scanned).
  4. Correct finance-model §9's tax sentence to what step 1 proved.

ACCEPTANCE: the research and the ruling are recorded. The reader's figures for a seeded seller
match the ledger in a probe, and a member gets 404. The certificate upload is private, and
sharing reaches only the chosen client party. check, lint, test:unit and test:probes are green.
SAME CHANGE: PRODUCT_SPEC §Identity, Taxes & Compliance 2 (as ruled; anything not built marked
so); finance-model §9; documentation/database/finance/*; the decision rows.
```

Readiness rows (§1.1): **PRD-M5** → 🟡 once CK4 has also landed (each with its switch off);
otherwise the row is narrowed only. **MW-57** follows the same rule.

### LG7 — AML signals and the Safety Hold

> **Status 2026-11-23:** open; runs now, to its stops (IDENTITY X2's included).

PRD-M6 → ✅, MW-58 → ✅. Carries Identity X2's stop.

```text
PROMPT LG7: Record the monitoring signals the AML-ready posture needs from day one, let an
operator read them, and build the 72-hour Safety Hold behind a switch that stays off

ROLE: Postgres engineer (money). SQL lane: a turn in the finance SQL lane (FINANCE_BUILD_PROMPTS.md
§0; 00001240 withdrawal path, 00005001 params, 00002510). Never beside MR8a or MR8b.

CONTEXT (verified at 197b0d0c; re-check every line):
  - Ruled, pending counsel (#336 I1; PRODUCT_SPEC §Identity, Taxes & Compliance 3 "Posture"):
    Projective is not AML-obliged but AML-ready. The data half (CDD and KYC references, the
    monitoring signals, retention for the AML period) runs from day one. The programme half
    (MLRO, review queue, registration, exports) is dormant behind flags.
  - The spec promises round-tripping flags (hiring yourself through a second account), rapid
    churn (a large deposit and then an immediate withdrawal) and a 72-hour Safety Hold before
    withdrawal for new or high-risk accounts. None of it exists: grep finds no signal, hold or
    sanctions code.
  - #446 ruled that no IP address or user agent is stored. Signals use only data the platform
    already holds lawfully.
  - The Safety Hold sits next to PRD-F15's holding-period question (FOUNDER_QUESTIONNAIRE Part
    D). Don't let it pre-empt that ruling.

🧑 STOPS (before step 2):
  (a) Identity X2: A (recommended), this prompt builds the signals, their reader and the hold,
      and X2 builds the dormant programme; or B, this prompt builds both.
  (b) The thresholds (the churn amount and window; what makes an account "new"; which signals
      start a hold) as platform-param dials, with the starting values I set.
  (c) The hold switch ships off. Turning it on is mine, after counsel.

STEPS:
  1. Inventory first: list which candidate signals the data already supports (the same
     verified-identity or Stripe account reference on both sides of a ticket; one person on
     both sides through a team or business seat; a payment-method or bank-account fingerprint,
     only if it is already stored; a top-up followed by a withdrawal inside the window). Report
     anything a signal would need that is not stored, and capture nothing new without a
     decision row.
  2. Red: probes that a seeded self-hire (the same person on both sides of a ticket) records a
     round-tripping signal on funding or release; a top-up followed by a withdrawal above the
     dial records a churn signal; with the switch on, a flagged account's withdrawal is held
     and refused until the hold passes, and with it off, nothing about money changes.
  3. An append-only signals table (the schema you justify; its retention follows the I1 table,
     and ERA classifies it HOLD), written only by definers on the money paths, and never
     visible to the subject.
  4. An operator-only reader (on the admin surface the house uses; a section beside
     /admin/ledger is fine) that lists signals with their facts. No action buttons: the review
     queue is X2's and dormant (root §3.11).
  5. The Safety Hold: a check in the withdrawal door, behind `aml_safety_hold_enabled` (a
     platform param, off), with the hold's end shown to the person in plain words when it
     applies.

ACCEPTANCE: the probes are green; finance_invariants.sql and conservation_identity.sql pass
(the hold moves no money; it only refuses a withdrawal for a while). The reader renders for an
operator and 404s for a member. check, lint and test:unit are green.
SAME CHANGE: PRODUCT_SPEC §3 ("Not built yet" narrowed to the programme half); the Privacy
Policy's monitoring clause (LG1's convention; it stays a draft); finance-model (the hold and its
dials); documentation/database/*; X2's status in IDENTITY_BUILD_PROMPTS; the decision row.
```

Readiness rows (§1.1): **PRD-M6** → ✅ (🟡 if step 5 is deferred); **MW-58** → ✅.

### LG8 — Tax on the platform's own fees

> **Status 2026-11-23:** open; waits for MARKETPLACE CK4, which waits for FBP DB21.

PRD-M7 → 🟡.

```text
PROMPT LG8: The platform's own fees carry their tax: a tax line on each fee, and a monthly fee
statement per payer, behind a switch that stays off

ROLE: Payments engineer. Queue M (00000017, the fee lines), after CK4. Never beside MR8a/MR8b.

CONTEXT (verified at 197b0d0c; re-check every line):
  - #490 (a): the 5% stage-completion fee (kept by transferring less), the marketplace
    commission and a `buyer_added` fee are supplies Projective itself makes, and nothing
    charges, records or invoices tax on them. CK4 taxes the buyer's order only.
  - The fee is "a flat 5%; it never tapers, and no plan buys a lower one" (root CLAUDE.md,
    finance-model.md). The landing's claims gate (#281) holds every figure on / and /features.
  - CK4's Stripe Tax engine is the calculation to reuse: CK4 keeps it behind one service function
    you can call for a fee line (MARKETPLACE_BUILD_PROMPTS.md CK4 step 4).

🧑 + ⚖️ STOP: A (recommended): the fee is tax-inclusive. The 5% stays 5%; where Projective must
charge tax on it, the tax is inside it, so no payout, preview or claim changes and the
statement shows the tax part. B: tax is added on top, which changes finance-model, every payout
preview, the checkout fee line and the landing's claims. Either way, counsel and an accountant
confirm Projective's place of supply, its registrations, and whether a business payer's
reverse charge applies.

STEPS (for A):
  1. Red: a unit test that, with the switch on, a GB consumer freelancer's 5% fee on a £100
     release records a tax part inside the £5, and the payout is unchanged; with it off,
     nothing changes.
  2. Each fee ledger row gains its tax amount, rate and jurisdiction (integer minor units, in
     place, through the money doors), computed through CK4's service function for a fee line.
  3. A monthly fee statement per payer (PDF, under Wallet's statements), listing each fee and
     its tax part, with Projective's details as the supplier (LG1 (b)).
  4. Behind `platform_fee_tax_enabled` (a platform param, off).

ACCEPTANCE: with the switch off, every money test and probe passes unchanged. With it on, in
test mode, a GB consumer, an EU business with a VAT ID and a US freelancer each get the tax
Stripe returns, recorded and shown. finance_invariants.sql passes.
SAME CHANGE: finance-model.md (the fee's tax treatment, marked "Not switched on");
PRODUCT_SPEC; documentation/database/finance/*; Zod; the decision row.
```

Readiness rows (§1.1): **PRD-M7** → 🟡 (✅ when counsel confirms and the switch is on).

### LG9 — Close §M (last)

> **Status 2026-11-23:** open; runs last.

```text
PROMPT LG9: Re-verify every §M row and the five legal flows against HEAD, re-score, and hand off

ROLE: Readiness steward. Docs only.

STEPS:
  1. For PRD-M1 – M7, PRD-A4, ID-11 and MW-55 – MW-58: re-check the evidence at HEAD. Name the
     commit that closed each one, or say what is left and who holds it (counsel, a switch, a
     hosted step).
  2. Recompute §M's line and the three tier rows of PRODUCTION_READINESS's Scoreboard and of
     USER_FLOWS's Scoreboard and cluster line; add one §Score history line in each file; bump
     **Last verified**.
  3. Update this file's §0: every landed LG prompt sits in §0.0's ledger with its commit, and
     §0.1 names what each open row still waits for.

ACCEPTANCE: every number recomputes from the rows; no row cites a prompt that did not land.
```

Readiness rows (§1.1): all §M rows, as found.
