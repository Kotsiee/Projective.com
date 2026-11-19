# Money Readiness Build Prompts — closing PRODUCTION_READINESS §F

> **Status: WORK ORDERS, not binding.** Written 2026-11-18 at `b7280787` against
> [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) §F "Money, ledger & reconciliation" (22 scored
> rows, **28%**). Static basis: nothing here was run against Stripe or a hosted database.
>
> **What this file is.** Most §F rows already have a work order in
> [`FINANCE_BUILD_PROMPTS.md`](../architecture/FINANCE_BUILD_PROMPTS.md) (FBP),
> [`PM_BUILD_PROMPTS.md`](../architecture/PM_BUILD_PROMPTS.md) (PM) or
> [`SUBSCRIPTIONS_BUILD_PROMPTS.md`](../architecture/SUBSCRIPTIONS_BUILD_PROMPTS.md) (SBP). This
> file does not restate them (documentation/CLAUDE.md rule 2). It gives each one a **readiness
> delta** (§4): what went stale since FBP was last verified (2026-11-12, `8a3fd595`) and which row
> it closes. Rows that have no work order get a new **MR** prompt (§5): MR0–MR9.
>
> **How to use it.** Paste each prompt into its **own fresh session**, in the §1 order. Put FBP §1's
> standard header first, then this file's readiness addendum (§2), then the prompt. For an FBP, PM
> or SBP prompt, paste its §4 delta between the addendum and the prompt. A **🧑 DECISION** stops at
> its step, puts the options and a recommendation to a human, and runs the rest of the prompt. **MR0
> collects every open 🧑 into one owner sitting**, so ten build sessions don't each stall on their
> own question.

---

## 0. What closes each §F row

| Row     | Crit · Gate     | Now | Closed by                                                        | Stops                           |
| :------ | :-------------- | :-: | :--------------------------------------------------------------- | :------------------------------ |
| PRD-F1  | Critical · MVP  | ✅  | —                                                                | —                               |
| PRD-F2  | Critical · MVP  | ✅  | —                                                                | —                               |
| PRD-F3  | Critical · UAT  | ✅  | —                                                                | —                               |
| PRD-F4  | High · UAT      | ✅  | —                                                                | —                               |
| PRD-F5  | Critical · UAT  | 🟡  | FBP **DB6** (the freeze and the payee clawback)                  | —                               |
| PRD-F6  | High · UAT      | 🟡  | FBP **DB14** (the remainder) → **DB15**                          | —                               |
| PRD-F7  | High · PROD     | ❌  | FBP **DB16 → DB8 → DB9**                                         | ruled (#423)                    |
| PRD-F8  | Critical · PROD | ❌  | **MR5** (after DB16, DB9, MR3)                                   | ruled (#460)                    |
| PRD-F9  | High · PROD     | ❌  | FBP **DB16** (the reader) + **MR4** (the alert)                  | ruled (#461)                    |
| PRD-F10 | High · PROD     | ❌  | FBP **DB8 step 2** (N24). PRD's Track "—" is wrong; MR0 fixes it | —                               |
| PRD-F11 | High · PROD     | ❌  | FBP **SV8**                                                      | ⚖️ M9 as built (no flag needed) |
| PRD-F12 | High · PROD     | ❌  | FBP DB19 ✅ (#511) → **DB21** + **MR3** (the card-refund half)   | ruled (#469, #470; MR3 #464)    |
| PRD-F13 | Normal · PROD   | ❌  | FBP **DB13 → DB20**                                              | ruled (#468)                    |
| PRD-F14 | High · UAT      | ❌  | SBP **S1 → S2 → S3 → S4**                                        | ruled (#252 (f); interim #472)  |
| PRD-F15 | Critical · PROD | ❌  | **MR7**, then counsel. No prompt can close it                    | ⚖️ counsel + Stripe             |
| PRD-F16 | High · PROD     | ❌  | **MR8a → MR8b**                                                  | Ruled #463                      |
| PRD-F17 | Critical · PROD | ❌  | **MR6**, then the human's live run                               | human Dashboard acts            |
| PRD-F18 | ⏸               |  ⏸  | not scored (rides DB17 + counsel #435 (d))                       | —                               |
| PRD-F19 | ⏸               |  ⏸  | not scored (#343)                                                | —                               |
| PRD-F20 | High · UAT      | ❌  | FBP **SV5** → **UI5**                                            | —                               |
| PRD-F21 | High · PROD     | ❌  | FBP **DB17** → **UI5**                                           | ruled (#471)                    |
| PRD-F22 | Critical · UAT  | 🟡  | **MR2** (client briefs)                                          | ruled (#467)                    |
| PRD-F23 | Critical · UAT  | ❌  | PM **PM-WP1 → PM-GH1**                                           | —                               |
| PRD-F24 | Critical · UAT  | ❌  | **MR1**                                                          | ruled (#466)                    |

**What the series buys.** §F weighs 53. Today it scores 15 (28%). If every code prompt lands, F15
stays ❌ (counsel) and F17 sits at 🟡 until the live run. That puts §F at **48.5 / 53 ≈ 92%**. If
the owner defers the journal (MR8), F16 becomes ⏸ and drops out of the sum: 46.5 / 51 ≈ 91%. The
counsel ruling and the live Stripe run take it to 100%. Every UAT-gated §F row closes in Waves 1–2.

---

## 1. Run order

There are two lanes, as in FBP §0.1. The **SQL lane** runs one prompt at a time, because almost all
of them share `00001200`, `00001240`, `00000017`, `00002510` or `00005060`. The **app lane** runs up
to three file-disjoint prompts at once.

| Wave | SQL lane (serial)                                                                                          | App lane (parallel, file-disjoint)             |
| :--- | :--------------------------------------------------------------------------------------------------------- | :--------------------------------------------- |
| 0    | **MR0** refresh + decision pack (docs only)                                                                | —                                              |
| 1    | FBP **DB16** conservation identity + `/admin/ledger`                                                       | FBP **SV5** (F20) · **MR6** (Stripe preflight) |
| 2    | PM **PM-WP1 → PM-GH1** → **MR1** → **MR2** → FBP **DB6** → **DB14** → **DB15**                             | —                                              |
| ✔    | **UAT checkpoint:** F5, F6, F14, F20, F22, F23, F24 closed (re-score; see MR9 step 1)                      |                                                |
| 3    | FBP **DB8 → DB9 → SV8** → **MR4** → **DB13 → DB20 → DB19 → DB21** → **MR3** → **DB17** → **MR5** → **MR7** | FBP **UI5** (after SV5 + DB17)                 |
| 4    | **MR8a → MR8b**, alone: nothing else runs in the SQL lane beside them                                      | —                                              |
| Last | FBP **E1** (needs PRD-K3 fixed first) → FBP **Z1** → **MR9**                                               |                                                |

**SBP S1 → S2 (to its stop) → S3 → S4** (F14, UAT) runs in Waves 1–2 as the **second SQL session
from another track** that FBP §0.1 allows: before each SBP prompt starts, check that its FILES are
disjoint from the SQL-lane prompt running at that moment. S4 never runs beside DB6, DB9 or MR3
(`00001230` + `stripe-webhook.ts`). MR4 and MR7 sit in the SQL lane because each edits `00002510`
(and MR4 also `00005060`).

Why this order:

- **Measure before you move money (DB16 first).** Wave 2 changes four release and refund paths: the
  auto-approve, the unclaimed service escrow, the brief cancel and the dispute freeze. With DB16 in
  place, each proves in the same change that it conserved money. Without it, each re-asserts
  conservation inside its own probe, as #456 (e) and #457 (f) had to. The cost is one SQL session of
  delay to UAT. **Trade-off:** if a UAT date presses, move DB16 to just after DB6, and accept that
  Wave 2's probes carry their own conservation asserts.
- **UAT rows lead everything after DB16.** That covers every Critical · UAT row: F23 → F24 → F22 →
  F5, in the order of PRD's own UAT critical path, then F6. F20 (SV5, app lane) and F14 (SBP, the
  second SQL session) run at the same time.
- **The ghosting timer follows the claim sweep.** PM-WP1 hardens `fn_release_expired_claims`, which
  MR1's prepaid TTL also depends on. PM-GH1's WAITs (DB3 and the jobs merge) are both met.
- **F12 is a chain.** DB19's line states come first, then DB21's buyer and provider refunds, then
  MR3's card refunds, which reuse both and DB16's `/admin/ledger`.
- **External reconciliation (MR5) runs after DB16, DB9 and MR3.** It reuses DB16's terms and DB9's
  settlement currencies, and it has to recognise MR3's refunds.
- **The journal runs last and alone.** It touches every money definer.

**Hot files across these prompts** (on top of FBP §0.2 and §0.3):

| File                                                      | Writers here                                                                   |
| :-------------------------------------------------------- | :----------------------------------------------------------------------------- |
| `00001150` (stage funding, submissions, `cancel_service`) | PM-GH1, MR1, MR2, DB13, DB14                                                   |
| `00001140` (claim TTL)                                    | PM-WP1, MR1                                                                    |
| `00001100` (`set_project_status`)                         | MR2                                                                            |
| `00001230` + `stripe-webhook.ts`                          | DB6, DB9, MR3, SBP S4, which never run at the same time                        |
| `00005060` (jobs)                                         | DB16, PM-WP1, PM-GH1, MR4, MR5, DB17                                           |
| `/admin/ledger` (`features/admin`, `LedgerHealthService`) | DB16 creates it; MR4, MR3, MR5, MR7 and MR8b each add a section, one at a time |

---

## 2. Readiness addendum (paste after FBP §1's header, before every prompt)

```text
READINESS ADDENDUM

- This work closes or narrows rows of documentation/readiness/PRODUCTION_READINESS.md §F, and the
  documentation/readiness/USER_FLOWS.md rows your prompt names. In the SAME change: flip each row
  you close (status + evidence naming your commit or decision), recompute BOTH scoreboards
  (tier table and area table) with the file's formula, add one §Score history line, and update the
  USER_FLOWS rows and their scoreboard. Use 🟡 when a hosted or human step is left, and name it. Never
  flip a row on a test you did not run.
- Re-verify your prompt against HEAD before you build. The finance track's §0 was last verified
  2026-11-12 at 8a3fd595. Since then, DB2, DB3 (44382c08), DB4, DB5 and DB12 have landed. #435
  shipped currency conversion inside purchases. #456 and #457 changed how bought services and
  One-Offs fund their escrow. 35dfe268 rewrote parts of 00001210 and 00000017 (checkout). Grep
  every premise and line number your prompt cites. If a premise no longer holds, report it in your
  final message; never silently work around it.
- Concurrent sessions share this tree. Never git stash. Never switch branch. Stage only your own
  hunks, and verify in a clean worktree before you commit. deno task db:reset is standing-approved
  (root CLAUDE.md); announce it to the other sessions first.
- Decision numbers collide across peers. Grep documentation/reference/decisions/README.md for the
  next free number right before you write a row.
- Once FBP DB16 has landed, a new money flow adds its terms to finance.v_conservation_identity and
  keeps supabase/probes/conservation_identity.sql green. Before DB16 lands, assert conservation
  inside your own probe and say so.
- Stripe: never use a live key; never change anything in the Stripe Dashboard; never create,
  update or delete a webhook endpoint, event destination, account setting or object on any Stripe
  account. A human does all of these. Read-only calls with the .env.local TEST key are allowed only
  where your prompt says so. Use the stripe:stripe-docs skill for any Stripe API fact, and cite it.
- Finish with: what you built; the rows you flipped (old → new); every probe and test you ran, with
  its result; and every 🧑 question still open.
```

---

## 3. The decisions this series needs

MR0 puts these to the owner in one sitting. Each prompt keeps its own 🧑 block too, so a question
the owner defers still stops the build at the right step.

| #  | Question                                                                        | Prompt   | Recommendation                                                                                                     |
| :- | :------------------------------------------------------------------------------ | :------- | :----------------------------------------------------------------------------------------------------------------- |
| 1  | Bought service: where "claimed" lives (the payee is bound at funding, #456 (b)) | MR1      | **Ruled #466: A · yes.** Payee NULL until the claim; `move_ticket` refuses with `PF402`                            |
| 2  | Client brief: cancel or archive with escrow held                                | MR2      | **Ruled #467: A.** Settle first, through one helper for every kind; archive refused while held                     |
| 3  | Who may start a card refund                                                     | MR3      | **Ruled #464: A.** Operators only, from `/admin`; MR3 still runs after DB16, DB19 and DB21                         |
| 4  | Where money alerts go                                                           | MR4      | **Ruled #461: A.** A webhook plus a Resend email digest; MR4 still runs after DB16                                 |
| 5  | Take Stripe-balance reconciliation (FA L6) out of "Planned" (ruling M2 B)       | MR5      | **Ruled #460: A.** Build it read-only, without the journal, once DB16, DB9 and MR3 land                            |
| 6  | Is the public launch the M2 B trigger for the shadow journal?                   | MR8      | **Ruled #463: A · A.** Before PROD, written in the money doors, once DB16 and MR5 land                             |
| 7  | Deadline bonus: what "met" means                                                | FBP DB13 | **Ruled #468: A · interim.** Met = the approved submission was SENT by the due date; #457's "no bonus" was interim |
| 8  | Order line `cancelled` vs `refunded`                                            | FBP DB19 | **Ruled #469: A.** Refunded in full before any delivery began                                                      |
| 9  | A product dispute after the sale has cleared                                    | FBP DB21 | **Ruled #470: A.** Only while the sale is still clearing (7 days)                                                  |
| 10 | The daily FX provider (it now prices #435 conversions, not only display)        | FBP DB17 | **Ruled #471: A.** One commercial API for all 12; the vendor is still the owner's pick                             |
| 11 | How a plan is paid, unless SBP S0 recorded #252 (f)                             | SBP S4   | **Ruled #252 (f)** (2026-10-30; recorded by SBP S0, `94d22e84`): Stripe Billing Checkout                           |
| 12 | Plan gates while nothing can be bought (`business_plan_gates_enforced` is on)   | MR0      | **Ruled #472: A.** Gates off for UAT; SBP S4 switches them back on                                                 |

**For counsel, not the owner** (MR7 writes one brief): how long escrow may sit in the platform
balance (F15, ruling M2); a failed payout left in Stripe (M9, F11); whether conversion is a
regulated service (#435 (d), F18).

---

## 4. Readiness deltas for the existing prompts

Paste a prompt's delta between the addendum and the prompt. Only the delta is new; the prompt itself
stays as FBP, PM or SBP wrote it.

```text
DELTA FOR FBP DB16 (closes PRD-F7 with DB8 + DB9; the reader half of PRD-F9; USER_FLOWS MW-62)
- Its "Input" notes (2026-11-12) still hold. Three money flows have landed since, and the identity
  must count each one, or each will read as an imbalance:
  (a) #435's conversions: finance.fx_conversions, the fx_conversion / fx_spread legs and
      finance.v_fx_conversion_reconciliation. Out of X is external-out for X, into Y is
      external-in for Y, and the spread is revenue, as FBP DB18's text already states.
  (b) #456's projects.cancel_service settlements.
  (c) #457's whole-project prepay for One-Offs.
  Grep every reason written since 8a3fd595 and classify it in step 1.
- Once conservation_identity.sql exists, re-point service_cancel.sql and one_off_checkout.sql at
  it, and delete their inline conservation asserts (#456 (e), #457 (f)).
- /admin/disputes (features/admin/routes/DisputeDeskScreen.tsx, #212) is the operator pattern to
  copy: the same gate, and a 404 for everyone else. MR3, MR4, MR5, MR7 and MR8b add sections to
  /admin/ledger later, so build the page as a list of sections, with one LedgerHealthService read
  per section.
- The seed must conserve money (FA N35): rebuild it through emit-finance.ts and prove it on a fresh
  reset, never on the shared DB.

DELTA FOR FBP DB8 (closes PRD-F10 with step 2, and part of PRD-F7)
- Step 4 is done (#435: finance.fn_currency_exponent + currencyExponent, pinned by
  fx-conversion.test.ts). Step 5 changed: escrows.fx_* are no longer "reserved", because a
  conversion writes them. Word Tables.md accordingly.
- The reason CHECK must include every reason #435, #456 and #457 added. Build it from ONE list that
  fn_wallet_debit's arrays and fn_is_income_reason read (the Input note).
- Run it after DB16.

DELTA FOR FBP DB9 (completes PRD-F7)
- Step 0 is done. Step 1 is done (#435: currencyForCountry, clamped to the nine). Read "the 12" as
  the nine settlement currencies (#423 (B)).
- Steps 2–4 remain. Never run it beside SBP S4 (00001230 + stripe-webhook.ts).

DELTA FOR FBP DB6 (closes PRD-F5; USER_FLOWS MW-19)
- Both of its dependencies have landed: DB2 (dd3986e5) and DB3 (44382c08). Line numbers in
  00001230 and 00001240 have moved, so grep them.
- Never run it beside SBP S4 or DB9.
- PRD-F5 flips to ✅ only when the freeze AND the payee clawback hold in dispute_window.sql.

DELTA FOR FBP DB14 (with DB15, closes PRD-F6)
- Only step 1's work-status half and step 2 remain (see the status note on the prompt).
- MR1 may already make move_ticket refuse an unclaimed funded ticket entering a work status
  (#456 (c)). If MR1 has landed, reuse its refusal code; do not add a second one.

DELTA FOR FBP DB15 (with DB14, closes PRD-F6; USER_FLOWS MW-14)
- SCH-WP2's interim has merged (6882e0be). Run it only while no SCH work package is running.

DELTA FOR FBP SV8 (closes PRD-F11; USER_FLOWS MW-16)
- No dependency is pending. It edits 00001240, so it runs serially in the SQL lane.

DELTA FOR FBP DB13 (with DB20, closes PRD-F13)
- Stale premise: ck_projects_deadline_bonus_format no longer exists (FBP §0).
- Both 🧑 questions are RULED #468 (2026-11-18). "Met" is A: per escrow, the submission later
  approved was SENT by the ticket's due date. #457's "optional target date, no bonus" for a bought
  One-Off or Task was interim: once DB13 lands, a buyer may add a held bonus to a bought One-Off or
  Task at checkout, judged the same way. So DB13 also reaches place_wallet_order's One-Off line,
  marketplace.fn_buy_scoped_service and the two configure dialogs (ScopeBriefModal,
  ServiceDetailModal), or names the follow-up that does.

DELTA FOR FBP DB20 (with DB13, closes PRD-F13)
- No dependency is pending. It edits 00001200, so never run it beside PM-WP4, MR1 or MR2.

DELTA FOR FBP DB19 (part of PRD-F12; USER_FLOWS MK-31)
- 35dfe268 rewrote place_wallet_order's neighbourhood in 00001210 (+132 lines), so every line
  number has moved. #457 (b) adds a case: a captured card payment whose engagement is refused stays
  in the wallet (settled_unapplied) and has no order line; it touches no order.

DELTA FOR FBP DB21 (part of PRD-F12; USER_FLOWS MK-31)
- Step 1 judges "downloaded" from files.download_events, which 00001160 writes. USER_FLOWS MK-29
  (receive and download a purchased product) is ❌. Prove the buyer's download path writes that row
  before building on it. If it doesn't, the cancel-before-download rule cannot be judged: report it
  as a finding.

DELTA FOR FBP DB17 (closes PRD-F21 with UI5; USER_FLOWS MW-11, MK-28)
- #435 made the feed price conversions at checkout, not only display (PRD-F18 waits on it). So the
  provider choice now has a money consequence: a stale or wrong rate mis-prices a charge. Keep its
  refusal on a partial feed. If #435's conversion quote has its own staleness rule, make it and
  FxService's STALE_AFTER_MS one constant (grep both).

DELTA FOR FBP SV5 (closes PRD-F20 with UI5; USER_FLOWS MW-01)
- PRD-F20 is UAT-gated, so run this in Wave 1, ahead of its FBP wave. Step 1 is mostly done by
  #435 (currencyExponent + fn_currency_exponent); verify it, then write only the contract test.
  settlement_currencies already exists (#423), so step 5's narrowing can run before DB9's SQL
  refusal.
- C13 (P0) is the point: wallet-scope.ts still skips a currency that has no rate (PRD-F20 cites
  :324).

DELTA FOR FBP UI5 (completes PRD-F20 and PRD-F21)
- It runs after SV5 and DB17. Check git status for the checkout peers first (Decision #243).

DELTA FOR PM PM-WP1 (PRD-G2; the prerequisite for PRD-F23 and PRD-F24)
- The jobs branch has merged (817dbbd1). It shares 00005060 and 00002510 with DB16, so it runs
  after DB16 in the SQL lane.
- MR1 changes which tickets the prepaid TTL sees. Leave its predicate payee-based as written; MR1
  adjusts it.

DELTA FOR PM PM-GH1 (closes PRD-F23; USER_FLOWS PJ-31)
- Both of its WAITs are met: DB3 (44382c08) and the jobs merge. FBP and PM both list the ghosting
  timer; this one is canonical, so FBP's §0.6 pointer stands.
- Its release must keep conservation_identity.sql green, and judge a deadline bonus exactly as
  DB13 will. If DB13 hasn't landed, a bonus is still refused (DB12), so there is nothing to judge.
- Its reminders ride the in-app engine (NT1). Their email is PRD-E5's: say so in USER_FLOWS PJ-31.

DELTA FOR SBP S1 → S2 → S3 → S4 (closes PRD-F14; USER_FLOWS MW-27, MW-20, MW-25, MK-07, MK-24)
- Only S0 has landed. S2 stops at #252 S2 (storage), which is ⏸ (MW-29). Run S2 up to its stop,
  then S3; S4 needs S3. S4's other wait, FBP DB2, landed in dd3986e5.
- S4 adds subscription events to HANDLED_STRIPE_EVENTS. MR6's preflight reads that list, so the
  check stays correct without an edit.
- Never run S4 beside DB6, DB9 or MR3 (00001230 + stripe-webhook.ts).

DELTA FOR FBP E1 (proves the whole series end to end)
- `deno task test:e2e` names a deleted spec (PRD-K3). Fix the task first, or E1 cannot run. Add
  legs for MR1 (an unclaimed service escrow refunds), MR2 (a brief cancel settles first) and
  PM-GH1 (an auto-approve).

DELTA FOR FBP Z1
- Run it after MR9's re-score has decided the statuses. Z1 sweeps the docs; it does not score.
```

---

## 5. New prompts

### MR0 — Refresh the finance track and gather every money ruling (docs only)

```text
PROMPT MR0: Bring the finance work orders up to date, point every §F row at its owner, and get the
owner's rulings in one sitting

ROLE: Finance coordinator. No code and no migrations change in this prompt.

CONTEXT: FINANCE_BUILD_PROMPTS.md (FBP) §0 was last re-verified 2026-11-12 at 8a3fd595, and its
header still calls DB3 uncommitted. PRODUCTION_READINESS.md §Doc drift lists that, plus
FINANCE_AUDIT.md §5 IDs that are closed in code. PRD §F's Track column reads "—" on F10 (owned by
FBP DB8 step 2) and on rows that had no work order until this file (MONEY_BUILD_PROMPTS.md).

FILES: documentation/architecture/FINANCE_BUILD_PROMPTS.md (header, §0); FINANCE_AUDIT.md (§5
status column); documentation/readiness/PRODUCTION_READINESS.md (§F Track cells, §Decisions
awaiting a human, §Doc drift); documentation/readiness/MONEY_BUILD_PROMPTS.md (§3: mark each
answered question "Ruled #NNN"); documentation/reference/decisions/ (the newest decisions-*.md +
README index).

STEPS:
  1. Re-verify FBP against HEAD. For each prompt named in MONEY_BUILD_PROMPTS §0, grep its
     deliverable and mark it Done, Partly or Not started, with the commit. Update the FBP header
     and §0 ("Since then" paragraph, the wave table's ✅ marks). Correct FINANCE_AUDIT.md §5 only
     where code proves a fix (A14, A16, K4, L9, V4, S4, H3 per PRD §Doc drift). Strike the doc-drift
     bullets you fixed.
  2. Set the §F Track cells:
     F8 → MR5 · F9 → DB16 + MR4 · F10 → DB8 · F12 → DB19, DB21, MR3 · F15 → MR7, 🧑 counsel ·
     F16 → MR8 · F17 → MR6 · F22 → MR2 · F24 → MR1.
     A Track edit flips no status, so the scoreboard and Score history do not change.
  3. Decision pack: put MONEY_BUILD_PROMPTS §3 rows 1–12 to me, ONE question at a time. For each,
     give the options, the recommendation and what it blocks. Take the options from the owning
     prompt's 🧑 block (MR1–MR8 in this file; DB13, DB17, DB19, DB21 in FBP; SBP S4). For row 12,
     the facts: business_plan_gates_enforced is on (00005001), and nothing can be bought until
     SBP S4 (PRD-F14). Beta testers would therefore meet Pro-gated controls they cannot unlock,
     which root CLAUDE.md §3.11 forbids. The options are: (A) switch the gates off for UAT, and
     back on in S4's change; (B) leave them on and land S4 before UAT; (C) grant beta entities a
     time-boxed Pro entitlement (entitlement_grants).
     Record every answer as a decision row (newest decisions-*.md + README index line, with a
     number re-checked right before writing). Mark the question "Ruled #NNN" in the owning
     prompt's 🧑 block and in §3. Leave a deferred question open at its prompt. Never pick a side.
  4. In PRD §Decisions awaiting a human, update the rows for F15, F16, F22 and F24, and add rows
     for rows 3–6 and 12 of the pack.

ACCEPTANCE: FBP §0 matches HEAD; every §F row names its owner; every ruling given is a decision
row; git diff touches documentation/ only.
```

### MR1 — A bought service's unclaimed escrow is refunded, never paid out (PRD-F24)

```text
PROMPT MR1: On a bought Pipeline service, an escrow nobody claimed can only be refunded

ROLE: Ledger + projects Postgres engineer.

CONTEXT: Decision #456 flag (b): on a bought service, a funded ticket's escrow is bound to the
seller when it is held, before anyone claims (finance.fn_ticket_payee resolves the stage's one
seat). So every rule keyed on payee_id IS NULL misses a service:
  - the prepaid TTL refund (#428) never sweeps an unclaimed ticket (expires_at stays NULL, seen
    live);
  - approve_stage would release an unclaimed ticket's escrow to the seller instead of refunding it
    (#197);
  - a stage-level Fair Exit pays a share of it.
#456 (c): move_ticket lets any participant move an unclaimed funded ticket into In progress.
The contrast is #457 (c): a bought One-Off's master ticket IS held prepaid (payee NULL) until the
seller claims it. The invariant to restore (PRODUCT_SPEC §Escrow; #197; #428): an escrow nobody
claimed earned nothing. It can be refunded and never released. Run after PM-WP1, which hardens the
claim and TTL sweep in 00001140.

🧑 DECISION (step 1): where "claimed" lives for a bought service. RULED #466 (2026-11-18): A, and
yes to the move_ticket question (PF402). Skip the question and build per A:
  A (recommended): hold a service ticket's escrow with payee NULL, exactly as a One-Off (#457 (c))
     and a brief (#428) are held. The payee binds at the claim, through the existing claim door.
     That gives one rule for every project kind, and the TTL, approve_stage's refund-unclaimed
     branch and the Fair Exit work unchanged. The cost: the seller or a seat member must claim, so
     the claim's W_i cap applies (#457 (c) names the same trade).
  B: keep the binding at funding, and give the three readers a second test for "unclaimed" (no
     assignee and no claim event). That means two definitions of one fact at every
     payee_id IS NULL site, which is the drift class #197 exists to prevent.
  Also ask: should move_ticket refuse an unclaimed funded ticket entering a work status (#456 (c))?
  Recommended: yes, with the PF402 code DB14 step 1 uses for INSERT.

FILES (grep each; line numbers move):
  - wherever finance.fn_ticket_payee is created (grep CREATE … fn_ticket_payee) and its callers in
    00001150 (the hold, around :925; approve_stage) and 00001175 (instantiate_pipeline)
  - 00001200 (fn_hold_ticket_escrow, fn_prepaid_escrow_ttl_hours :676, fn_fair_exit_release)
  - 00001140 (fn_release_expired_claims :690, after PM-WP1); move_ticket's file (grep)
  - 00002510 if a signature changes
  - supabase/seeds/* (every seeded Pipeline service must still seed, fund and claim)
  - supabase/probes/service_unclaimed_escrow.sql (new); service_cancel.sql (must stay green)
  - documentation/database/{finance,projects}/Functions.md; PRODUCT_MANAGEMENT.md §3.5 (fund
    state); PRODUCT_SPEC.md §Productised Services, if its wording names when the seller is bound

STEPS:
  0. Reproduce first. On a fresh reset, as a seeded client persona, buy the seeded Pipeline service
     and fund a stage. Show, in a ROLLBACK probe, that: the escrow's payee is the seller before any
     claim; expires_at is NULL; and approve_stage would release it.
  1. The ruling.
  2. Per A: an unclaimed service ticket holds with payee NULL and an expires_at from
     fn_prepaid_escrow_ttl_hours (#428's service window). The claim binds the payee. A team
     seller's split still resolves at release (fn_team_split_plan).
  3. approve_stage and a stage Fair Exit refund an unclaimed service escrow whole and pay nothing
     for it. Prove it for a service and re-prove it for a brief.
  4. Per the move_ticket ruling: refuse, or leave a pointer to DB14.
  5. No hosted data exists yet, so nothing needs a backfill. Say so in the decision row.

ACCEPTANCE: service_unclaimed_escrow.sql proves:
  - a funded, unclaimed service ticket holds payee NULL with expires_at set;
  - the TTL sweep refunds it whole to the payer after the window;
  - approve_stage refunds it and pays nothing;
  - a stage Fair Exit pays nothing for it;
  - a claimed ticket pays as before.
service_cancel.sql, finance_invariants.sql and conservation_identity.sql (if DB16 has landed) pass.
Live check: the client persona funds, nobody claims, and the board shows the ticket prepaid.

SAME CHANGE: migrations edited in place; database docs; the decision row with the ruling and any
new flags; PRD-F24 ❌ → ✅ with evidence; USER_FLOWS MK-09 narrowed; both scoreboards; one Score
history line.
HOT: 00001150, 00001200 (never beside PM-WP4, DB13 or DB20), 00001140 (after PM-WP1).
```

### MR2 — Cancelling or archiving a client brief settles its escrow first (PRD-F22)

```text
PROMPT MR2: A client brief cannot be cancelled or archived with money still held

ROLE: Projects Postgres engineer, plus the client's cancel UI.

CONTEXT: Decision #456 ruled this for services. projects.cancel_service (00001150:1667) refunds
unclaimed escrow whole, settles claimed or in-review work under Fair Exit per stage, then cancels.
projects.set_project_status (00001100:1184) refuses a funded service's cancel or archive. Briefs
were left out (#456 (a)). A brief still cancels from any state, and archives while escrow is held
or reserved, settling nothing (USER_FLOWS PJ-41: no app door; PJ-42: DELETE /api/projects/:id
archives). #456 (d): Cancel lives in the lane, so at 390 px a client has no way to cancel.

🧑 DECISION (step 1). RULED #467 (2026-11-18): A. Skip the question and build per A:
  A (recommended): the services rule, for every project kind. Generalise cancel_service's body
     into one settle-first helper (projects.fn_settle_project_escrow) that both cancel_service and
     a brief cancel call. Archive is refused while any escrow is held or reserved (PF409, HINT
     'cancel'), so Archived always means "finished and settled". Clients get one mental model, and
     neither kind can strand money.
  B: refuse both cancel and archive while escrow is held; the client Fair-Exits each stage first.
     Less code; n dialogs for the client; the same money result.
  Both: the Fair Exit tier stays the client's pick until PM-WP4a (#456). An open dispute refuses
  the cancel (fn_assert_no_open_dispute, DB3) instead of settling around it.

FILES:
  - 00001150 (cancel_service → the shared helper), 00001100 (set_project_status's brief branch),
    00002510
  - apps/web/routes/api/projects/[id]/cancel.ts (exists for services; extend it) and the archive
    route (map the refusal)
  - packages/backend/services/projects/{live-settlement,ProjectBackendService}.ts + tests
  - apps/web/features/projects: CancelServiceDialog becomes one cancel dialog for both kinds; add a
    cancel entry outside the lane (the feed card's menu) so it works at 390 px (#456 (d))
  - supabase/probes/brief_cancel.sql (new); service_cancel.sql stays green
  - PRODUCT_SPEC.md (project cancel/archive), PRODUCT_MANAGEMENT.md (the project lifecycle's
    Cancelled and Archived transitions), documentation/database/projects/Functions.md
  - the Dev Context Switcher, if the dialog adds a simulatable state (root CLAUDE.md §5)

STEPS:
  0. Reproduce: a funded brief archives and cancels with escrow held (ROLLBACK probe).
  1. The ruling.
  2. Build it per the ruling. One door does the money; the route stays thin.
  3. UI: one tier-1 accent commit only if the cancel moves money (a refund does). The settlement is
     stated before the commit, with a MoneyView for every figure.

ACCEPTANCE: brief_cancel.sql proves:
  - a brief with an unclaimed funded ticket and a claimed in-review ticket cancels by refunding the
    first whole and settling the second at the chosen tier, then reads Cancelled;
  - conservation holds;
  - archive is refused while money is held, and passes once settled;
  - an open dispute refuses the cancel with PD409.
Screenshots: the client persona cancels a funded brief at 1440 and 390, in light, dark and
data-contrast="high".

SAME CHANGE: PRD-F22 🟡 → ✅; USER_FLOWS PJ-41 and PJ-42 (✅ only if both hold at 390 px); MK-09's
mobile half; both scoreboards; one Score history line; the decision row.
HOT: 00001150 and 00001100 (projects track: never beside a P-track SQL step on them), 00001200
(through the Fair Exit; never beside PM-WP4).
```

### MR3 — An operator can refund a card payment, and money still moves in one place (PRD-F12, card half)

```text
PROMPT MR3: Card refunds start inside Projective, are recorded with who and why, and settle
through the existing webhook

ROLE: Payments engineer.

CONTEXT: finance-model.md §15: a card refund is made at Stripe (Dashboard or API) and arrives as
charge.refunded. finance.record_charge_refunded (00001230:1975) debits the wallet the payment
credited, by the newly refunded amount; whatever that wallet cannot cover is a platform loss, sent
to ops. Nothing calls refunds.create (stripe-rails.ts), so today a human refunds in the Stripe
Dashboard and Projective records neither who did it nor why.
finance.v_ops_unledgered_payments (00003004:100) lists settled payments with no ledger credit, and
the settlement_mismatch / business_archived payments awaiting a human (SA §Stripe, #200). #457 (b)
adds captured payments whose engagement was refused. Each of these needs a card refund, and none
has a door. Needs FBP DB16 (/admin/ledger), DB19 and DB21.

🧑 DECISION (step 1): who may start a card refund. RULED #464 (2026-11-18): A. Skip the question;
read #464's FLAGS (a)-(d) before you build.
  A (recommended): operators only, from /admin, for (i) a payment on v_ops_unledgered_payments and
     (ii) a top-up that support agrees to return while the wallet still holds it. Payers withdraw
     to their bank as today. The gate is security.is_admin() plus a sign-in within the last 10
     minutes (the token's amr, the pattern #450 uses), until MFA step-up (PRD-C17) replaces it.
  B: also a payer self-serve "return unspent top-up to card" within N days. Not recommended now:
     Stripe keeps its processing fee on a refund, so every self-serve refund is a platform loss,
     and top-up-then-refund loops are a known card-testing pattern.

FILES:
  - 00000017: finance.card_refunds (payment, amount_minor, currency, reason, requested_by,
    provider_ref re_…, status requested|succeeded|failed|canceled, timestamps); RLS on, no client
    policy
  - 00001230: finance.begin_card_refund(p_payment, p_amount_minor, p_reason, p_idempotency_key)
    (an operator definer); record_charge_refunded (see step 4); the refund.* processor door;
    00001830 (append-only, status moves through doors only); 00002510
  - packages/types/finance/payments.ts (HANDLED_STRIPE_EVENTS: add the refund lifecycle events the
    pinned API version emits, verified with the stripe:stripe-docs skill); a Zod row schema
  - packages/backend/services/finance/{stripe-rails.ts (refundParams, with an idempotency key
    derived from the row), PaymentBackendService.ts or a new CardRefundService.ts, stripe-webhook.ts}
  - apps/web/routes/api/finance/payments/[id]/refund.ts (thin; operator only, 404 otherwise)
  - /admin/ledger: an "Unledgered payments" section with a "Refund to card" dialog
  - supabase/probes/card_refund.sql (new); scripts/stripe-smoke.ts (a refund leg on stripe-mock)
  - finance-model.md §15, SYSTEM_ARCHITECTURE.md §Stripe (table 1.1 and the webhook list),
    documentation/database/finance/*, ROUTING.md, DESIGN_SYSTEM.md "Where tier 1 renders today"

STEPS:
  1. The ruling.
  2. The door records the request first, and refuses:
     - an amount above what is refundable (captured − refunded − already requested);
     - a payment with an open chargeback;
     - a payment from the other mode.
  3. The service calls refunds.create with the row's idempotency key, then binds re_… write-once.
  4. The money moves ONLY in the webhook. record_charge_refunded learns two facts:
     (a) a refund of a payment that was never credited (settled_unapplied without a transaction,
         settlement_mismatch, business_archived) debits nothing, records no platform loss and
         resolves the ops item;
     (b) a refund Projective asked for links to its card_refunds row, and refund.failed marks it
         failed.
     A converted payment (#435) refunds the charged amount and debits the payer's pinned share.
  5. The dialog shows the default (the full refundable amount), a required reason, and the wallet
     effect before the commit: "Takes £X back from <wallet>; £Y would be a platform loss". It has
     one tier-1 accent commit and one Dialog with a Signal visible.

ACCEPTANCE: card_refund.sql (ROLLBACK) proves:
  - refunding a settlement_mismatch payment records the row, and its simulated charge.refunded
    debits nothing and resolves the item;
  - a partial refund of a credited top-up debits the wallet by that part;
  - a request above the refundable amount, and a payment with an open chargeback, are both refused;
  - a replayed event changes nothing.
Unit tests cover the idempotency key and the route's 404. The smoke has a refund leg. Screenshots
of the dialog at 1440 and 390.

SAME CHANGE: Zod + database docs; PRD-F12 narrowed. F12 flips to ✅ only once DB19 and DB21 have
landed too. USER_FLOWS MK-31's operator half; both scoreboards; one Score history line.
HOT: 00001230 + stripe-webhook.ts (never beside SBP S4, DB6 or DB9), 00000017, 00002510.
```

### MR4 — Ledger drift reaches a human (PRD-F9's alert half; PRD-G7's money half)

```text
PROMPT MR4: Every money check that fails tells a person within minutes, and a check that stops
running is itself an alert

ROLE: Backend + ops engineer.

CONTEXT: finance.fn_reconcile_wallets (00001200:1764) writes one ops.log_entries error row per
drifted wallet every night (scope finance.reconcile_wallets). FBP DB16 adds finance.conservation
and the /admin/ledger reader. settle_card_payment writes settlement_mismatch and business_archived
errors, and MR5 will add finance.stripe_reconciliation. Nobody is told: an error waits until
someone happens to open /admin/ledger. PRD-G7: the repo has no alert routing. Needs DB16.

🧑 DECISION (step 1): the channel. RULED #461 (2026-11-18): A. Skip the question; read #461's
FLAGS (a)-(d) before you build.
  A (recommended): an incoming-webhook URL (Slack-compatible JSON, OPS_ALERT_WEBHOOK_URL) plus an
     email digest to OPS_ALERT_EMAIL through the existing Resend transport
     (services/mail/transport.ts). Two independent channels, so one outage is not silence.
  B: a hosted error tracker. A new vendor and a new data-processing agreement.
  C: email only.

FILES:
  - 00000013 (ops.alert_rules: scope pattern, minimum level, channel, dedupe window;
    ops.alert_deliveries, append-only: group key, first and last seen, count, channel, status);
    the rules' rows go in a category-5 seed file, never beside the CREATE TABLE
  - the ops functions file (grep where ops.* functions live): ops.fn_claim_alerts(p_limit)
    (service role); 00002510
  - 00005060 (http job 'ops-deliver-alerts', every 5 minutes)
  - apps/web/routes/api/ops/cron/alerts.ts (constant-time bearer, 404 otherwise);
    packages/backend/services/ops/OpsAlertService.ts + tests, with a transport port and a fake
  - packages/backend/core/env.ts, .env.example (XXXX-XXXX placeholders), SYSTEM_ARCHITECTURE.md
    (the Environment Variable Contract and the §Scheduled jobs table), scripts/cron-vault.ts (it
    provisions INTEGRATIONS_CRON_SECRET only: add this job's secret, part of PRD-G6)
  - supabase/probes/ops_alerts.sql (new); documentation/database/ops/*

STEPS:
  1. The ruling.
  2. Seed rules: the finance.* scopes at level error alert now, and a metric row never alerts.
     Adding a scope later is a seeded row, not code.
  3. fn_claim_alerts groups new error rows by scope + fingerprint (wallet, currency, payment) into
     one alert per group per dedupe window. It records the delivery, so a re-run never re-sends.
  4. A dead-man switch: if no finance.reconcile_wallets or finance.conservation row has appeared
     in 26 hours, that is an alert in itself.
  5. Delivery retries with backoff, and a failed delivery stays pending. Payloads carry figures,
     short ids and a link to /admin/ledger: never a name, email or bank detail.
  6. /admin/ledger shows recent deliveries.

ACCEPTANCE: unit tests with the fake transport prove:
  - a drift row sends one alert;
  - the same drift the next night is deduped inside the window and alerts again after it;
  - a missing nightly run raises the dead-man alert;
  - a failed delivery retries;
  - no payload carries personal data.
ops_alerts.sql proves the claim cursor is idempotent. A wrong bearer gets a 404.

SAME CHANGE: PRD-F9 → ✅ once DB16 has landed (🟡 otherwise); PRD-G7 narrowed, with job failures
named as what is left unless a job-failure scope already writes ops.log_entries; USER_FLOWS
MW-62; both scoreboards; one Score history line.
HOT: 00005060, 00002510, scripts/cron-vault.ts.
```

### MR5 — The Stripe balance matches the ledger (PRD-F8)

```text
PROMPT MR5: An external reconciliation: what Stripe holds, matched line by line and in total
against what the ledger says it should hold

ROLE: Payments architect + ledger engineer.

CONTEXT: FA L6; SYSTEM_ARCHITECTURE.md §Stripe says no reconciliation against the Stripe balance
is built; finance-model.md §15 calls it an ops job; ruling M2 filed it with B, as Planned (FBP
§0.6). Why it can't wait for PROD: every internal check (fn_reconcile_wallets, DB16) compares the
ledger with itself. A missed or mis-applied webhook, where Stripe holds money the ledger never
recorded or the reverse, is invisible to all of them. Only an external check sees it.
Facts the design must respect:
  - The platform is GB, with default gbp (#423 (B)). Until a human adds a currency's settlement
    bank account, Stripe converts a charge in that currency into GBP at settlement, and its
    balance transaction carries the exchange_rate.
  - Stripe's fees come out of the platform balance and are never ledgered.
  - Under Separate Charges & Transfers, money leaves the platform balance at the transfer
    (begin_payout → transfers.create). It then sits in the connected account until that account's
    automatic bank payout (bankPayoutContents assumes automatic payouts). A failed bank payout
    stays there (M9).
  - stripe-mock is stateless, so it can prove the calls but never the identity.
Needs DB16 (the terms), DB9 (the settlement currencies) and MR3 (card refunds).

🧑 DECISION (step 0): take L6 out of Planned. RULED #460 (see below):
  A (recommended): build it now, read-only and independent of the journal (MR8). It needs only the
     Stripe API and DB16's terms, and it is the one check that catches a lost webhook.
  B: keep it with M2 B. PRD-F8 stays ❌ and blocks PROD.
  RULED #460 (2026-11-18): A. Skip step 0. The owner also ruled that MR5 waits for DB16, DB9 and
  MR3: re-verify each at HEAD before you build, and stop if one has not landed.

FILES:
  - 00000017: finance.stripe_balance_snapshots (as_of, livemode, currency, available, pending);
    finance.stripe_reconciliation_runs (window, livemode, status, counts; unique on window +
    livemode); finance.stripe_reconciliation_items (run, kind stripe_only | ledger_only |
    amount_mismatch | unclassified, Stripe object id, ledger ref, amounts, currency,
    resolved_at/by, note). RLS on, no client policy.
  - 00001230: service-role record doors; an operator resolve door (it writes a note and never
    moves money); 00002510
  - 00003004: finance.v_stripe_expected_balance per settlement currency, built from DB16's terms
  - 00005060: http job 'finance-stripe-reconcile', daily, after 'finance-conservation-check'
  - apps/web/routes/api/finance/cron/stripe-reconcile.ts (FINANCE_CRON_SECRET, 404 otherwise)
  - packages/backend/services/finance/StripeReconciliationService.ts + tests, over a READ-ONLY
    Stripe port (balance.retrieve, balanceTransactions.list, the retrieves it needs; the port has
    no write method) with a fixture adapter; stripe-rails.ts helpers
  - LedgerHealthService + /admin/ledger: a "Stripe" section
  - supabase/probes/stripe_reconciliation.sql (new); scripts/stripe-smoke.ts (a leg that proves the
    calls)
  - finance-model.md §15, SYSTEM_ARCHITECTURE.md §Stripe (replace "not built"), FBP §0.6, FA L6's
    status, documentation/database/finance/*, Zod row schemas

STEPS:
  0. The ruling.
  1. Snapshot: balance.retrieve on the platform → one row per currency.
  2. Activity: list the window's balance transactions [last run's end, now − 1 h), auto-paginated,
     with the source expanded. Match each one to a ledger fact by id: a charge or payment to
     inbound_payments.provider_ref (via the charge's payment_intent); a refund to the payment's
     refund or to card_refunds; a dispute adjustment to chargebacks.provider_ref; a transfer or
     its reversal to payouts.provider_ref; a fee to the fee total. A payout to the platform's own
     bank is revenue leaving, with no ledger counterpart expected. Enumerate every type from the
     docs. An unknown type is an 'unclassified' item and is never skipped. Ledger facts in the
     window with no Stripe counterpart become ledger_only items.
  3. The two identities, per settlement currency:
     (a) Completeness: the previous snapshot plus the window's net activity equals this snapshot.
         This proves the activity list is whole.
     (b) Expected: Stripe (available + pending) equals the ledger's held side (DB16), less what was
         already transferred out to connected accounts, less Stripe's fees, less the platform's
         own payouts, plus adjustments. Read each balance transaction's own currency and amount,
         so a USD charge settled as GBP reconciles in GBP, with its rate recorded.
     A non-zero gap writes one ops.log_entries error (scope finance.stripe_reconciliation), which
     MR4 routes.
  4. Connected accounts, bounded: only accounts with a payout in flight or a failed bank payout.
     Compare balance.retrieve (stripeAccount) with what the ledger says sits there (M9).
  5. Nothing is ever corrected. An operator resolves an item with a note.
  6. A run records livemode. A test key reconciles test mode only (core/stripe.ts already refuses a
     live key outside production).
  7. Prove it against the real TEST-mode account, read-only, with the .env.local test key, as FBP
     DB9 step 0 did. Attach the run's figures.

ACCEPTANCE: unit tests with the fixture port prove:
  - a complete window balances both identities;
  - a charge Stripe has and the ledger lacks (a lost payment_intent.succeeded) gives one
    stripe_only item and an error;
  - a payout whose transfer Stripe lacks gives a ledger_only item;
  - a USD charge settled as GBP reconciles in GBP;
  - fees are accounted;
  - re-running a window adds nothing.
stripe_reconciliation.sql covers the doors and the view. The smoke leg passes on stripe-mock. One
test-mode run is recorded. A wrong bearer gets a 404.

SAME CHANGE: PRD-F8 ❌ → ✅ (test mode proven; the live run belongs to F17's runbook); USER_FLOWS
MW-62; both scoreboards; one Score history line; the decision row if step 0 was ruled here.
HOT: 00000017, 00001230 (never beside SBP S4, DB6 or DB9), 00003004, 00005060, 00002510,
stripe-rails.ts.
```

### MR6 — The production Stripe account is configured, and checkable (PRD-F17)

```text
PROMPT MR6: A read-only preflight that proves a Stripe account is configured the way the code
expects, plus the go-live runbook a human follows

ROLE: Payments + release engineer. App lane; no migration.

CONTEXT: PRD-F17: nothing in the repo shows live keys or the v1, v2 and Connect webhook endpoints.
What the code expects (SYSTEM_ARCHITECTURE.md §Stripe):
  - the snapshot endpoint /api/finance/webhooks/stripe (STRIPE_WEBHOOK_SECRET), taking exactly
    HANDLED_STRIPE_EVENTS (packages/types/finance/payments.ts);
  - a Connect destination for connected accounts' payout.* events (STRIPE_CONNECT_WEBHOOK_SECRET,
    which may share the URL);
  - the v2 thin endpoint /api/finance/webhooks/stripe-v2 (STRIPE_THIN_WEBHOOK_SECRET), taking
    HANDLED_STRIPE_THIN_EVENTS;
  - API version 2026-08-26.dahlia;
  - automatic payouts on connected accounts (bankPayoutContents);
  - the nine settlement currencies, each with a bank account a human adds (#423 (B));
  - a live key refused outside production (core/stripe.ts:145-154, PRD-H3).
Activating the account, entering keys and creating endpoints are a human's acts. This prompt only
makes them checkable.

FILES: scripts/stripe-preflight.ts + a `stripe:preflight` task in deno.json (with a $comment);
packages/backend/services/finance/stripe-preflight.ts (pure checks over a READ-ONLY port) + tests;
the go-live runbook as a section of SYSTEM_ARCHITECTURE.md §Stripe (link to it; restate nothing);
.env.example if a new key is named (placeholders only).

STEPS:
  1. Checks, each pass/fail with a fix line:
     - v1 webhook endpoints: the URL is on APP_URL's host; it is enabled; its api_version matches;
       its enabled_events equal HANDLED_STRIPE_EVENTS, diffed both ways; a Connect endpoint carries
       the payout.* set;
     - v2 event destinations carry HANDLED_STRIPE_THIN_EVENTS;
     - the platform account: country, default currency, capabilities;
     - balance currencies against the settlement currencies;
     - whatever the API exposes about connected-account payout defaults. Confirm each field with
       the stripe:stripe-docs skill. What the API cannot read becomes a manual line in the runbook.
     The script prints the mode, never a secret, and masks ids. It exits non-zero on any failure.
  2. Production use: it runs on the production host only, so the H3 guard stays intact. Do not add
     a bypass.
  3. Run it now against the TEST account with the .env.local test key. Report what fails. Fix
     nothing on Stripe: a human creates or changes endpoints.
  4. The runbook, in the order a human acts:
     1. activate the account;
     2. add the settlement bank accounts;
     3. create the three destinations;
     4. store the secrets in the host's secret store (never in git);
     5. review the Radar and Connect onboarding settings;
     6. run the preflight in production;
     7. run MR5's reconciliation once on live, with a small real top-up and refund;
     8. record the date in PRD-F17.

ACCEPTANCE: fixture-port tests for pass, a missing event, an extra event, a wrong API version, a
missing settlement currency and a missing Connect endpoint. The test-mode report is attached to
your final message.

SAME CHANGE: PRD-F17 ❌ → 🟡 (tooling and runbook built; the live run is the human's, and flips it
to ✅); SA's env contract if a key is added; both scoreboards; one Score history line.
HOT: none. SBP S4 adds events, and the preflight reads the list, so it needs no edit.
```

### MR7 — The money questions for counsel, with the facts measured (PRD-F15)

```text
PROMPT MR7: One counsel brief for the open money questions, and an escrow-age reader so the
answer can be checked

ROLE: Finance analyst + backend engineer. No money path changes.

CONTEXT: Decision #337, ruling M2: "How long escrow may sit in the platform balance under
Separate Charges & Transfers, and the safeguarding posture that follows: open, pending Stripe and
counsel, with no owner position." That is PRD-F15 (Critical, PROD). No code can rule it. What
code can do: measure how long escrow actually sits; state every timer the platform already
enforces; and put one precise brief in front of counsel. Two neighbouring questions go in the same
brief: M9 (a failed payout stays in the connected account's Stripe balance, PRD-F11) and #435 (d)
(is converting a held balance a regulated service, PRD-F18). Needs DB16 (/admin/ledger).

FILES: LedgerHealthService + /admin/ledger (an "Escrow age" section) through a STABLE operator
definer read (00001200 + 00002510); a probe; the brief in the repo's existing home for counsel
questions (grep -rli "pending counsel" documentation/ and use an existing file over a new one);
PRD §Decisions awaiting a human.

STEPS:
  1. Research, read-only, with the stripe:stripe-docs skill: what Stripe documents about holding
     funds under Separate Charges & Transfers (availability, any limit on time before a transfer,
     cross-border transfers, the platform's obligations). Cite URLs, quote at most one sentence,
     and draw no legal conclusion.
  2. The reader: held and disputed escrows and outstanding pending_releases, per currency. Show
     the oldest, p50, p90 and max age in days, and the counts and sums over 30, 60 and 90 days.
     Read-only; operators only.
  3. The platform's timers today, each with its source: the prepaid TTL 120 h / 168 h (#428); the
     claim TTL (PM-WP1); the 14-day auto-approve (PM-GH1, once built); the 7-day pending window
     (#191); the dispute freeze (DB6).
  4. The brief: each question, the facts, the timers, Stripe's documented constraints, the measured
     ages from the seeded or test DB (labelled as such), and the decision counsel's answer would
     drive (a maximum hold, then what: refund, release or escalate).

ACCEPTANCE: the reader renders for an operator and 404s for a member; a probe proves the ages on a
fixture; the brief exists and the decision log points at it.

SAME CHANGE: PRD-F15 stays ❌, with evidence "brief written <date>; awaiting counsel"; the
§Decisions awaiting a human rows for F15, M9 and #435 (d) point at the brief. No score changes
unless the reader closes part of MW-62.
```

### MR8a / MR8b — The shadow double-entry journal (PRD-F16)

```text
PROMPT MR8a: The shadow double-entry journal — accounts, entries and the primitives that write
them

ROLE: Ledger architect.

CONTEXT: The ledger is single-entry with materialised balances (00001200:44, :148). Ruling M2 B:
"shadow double-entry written by every money definer once live money passes a pilot, an enterprise
asks for an audit trail, or an auditor or regulator does." System wallets are not materialised
(ruling M2; DB8 removes 'system' from WalletOwnerType), so system accounts live in the journal,
never in finance.wallets. Needs DB16 and MR5, a hard WAIT (#463 (a)). MR8b follows it.

🧑 DECISION (step 0). RULED #463 (owner, 2026-11-18): 1 → A, 2 → A. Skip this step; the options
stay below for the record:
  1. The trigger. A (recommended): a public launch IS "live money past a pilot", so build the
     journal before PROD. A journal added after live volume must be rebuilt from single-entry
     rows, which DB16 already showed cannot tell cash from credit without the event tables.
     B: launch on DB16 + MR5, and build this at the first trigger.
  2. Where it is written. A (recommended): inside the money primitives and the doors that move
     money without a wallet leg (escrow hold and release, fees, chargeback loss, settlement,
     conversion), one balanced entry per movement in the same transaction, as M2 says ("every
     money definer"). B: an AFTER INSERT trigger on finance.transactions. Cheaper, but it inherits
     single-entry's blind spots (escrow and fee moves that have no transactions row).

FILES (MR8a): 00000017 (finance.journal_accounts: code, currency, kind, system; finance.
journal_entries: occurred_at, source_kind, source_id, idempotency_key, transaction_id;
finance.journal_lines: entry, account, wallet_id, debit_minor, credit_minor, exactly one of them
> 0); 00001830 (append-only, plus a DEFERRABLE constraint trigger: Σ debit = Σ credit per entry per
currency at commit); 00001200 (fn_wallet_credit, fn_wallet_debit, fn_wallet_credit_pending and
the escrow hold and release write entries); 00003004 (finance.v_trial_balance per currency);
supabase/seeds/gen/emit-finance.ts (the seed already goes through doors after DB16, so the
journal fills itself; regenerate 07_finance.sql); probes journal_balance.sql (new);
documentation/database/finance/*, finance-model.md §6, SYSTEM_ARCHITECTURE.md (Integration
Blueprints: B built).

THE CHART (per currency; refine it in the change and document it): stripe_platform_cash ·
connected_in_transit · wallet_liability (one control account, with a subledger by wallet_id) ·
escrow_liability · pending_liability · fee_revenue · fx_spread_revenue · stripe_fees ·
platform_loss · fx_position.

STEPS (MR8a):
  0. The ruling.
  1. Tables, the append-only trigger and the balance constraint.
  2. The primitives and the escrow doors write their entries.
  3. Before and after the change, measure fn_wallet_credit's cost (EXPLAIN ANALYZE on a seeded
     wallet), and report both figures.

ACCEPTANCE (MR8a): journal_balance.sql proves:
  - every movement through the primitives and escrow doors writes one balanced entry;
  - an unbalanced entry is refused at commit;
  - the trial balance nets to zero per currency;
  - the wallet_liability subledger equals balance_cents for every wallet;
  - escrow_liability equals the held escrows.
Every existing finance probe passes unchanged.
```

```text
PROMPT MR8b: Every remaining money door writes the journal, and the journal ties to DB16 and MR5

ROLE: Ledger engineer. Runs alone in the SQL lane: it touches 00001150, 00001155, 00001210,
00001230, 00001240 and 00001260.

STEPS:
  1. Grep every door that changes money: card settlement, refunds, chargebacks and losses,
     transfers and payouts (connected_in_transit), the fees, team splits and vault retention, Fair
     Exit, session forfeits, orders and product sales, #435's conversions, MR3's card refunds.
     Each writes its entry. A door you cannot place in the chart is a finding to report, never an
     account to invent.
  2. The ties:
     - v_trial_balance's cash and liability accounts reproduce v_conservation_identity's two sides
       per currency (DB16);
     - stripe_platform_cash equals MR5's latest snapshot, less in-flight timing.
     Each gap writes ops.log_entries (scope finance.journal), which MR4 routes.
  3. /admin/ledger: a trial balance per currency.

ACCEPTANCE: journal_balance.sql extended to every door; conservation_identity.sql and every other
finance probe stay green; the seed's trial balance nets to zero.

SAME CHANGE (MR8b): PRD-F16 ❌ → ✅ (or ⏸ with the decision, if the owner chose B); the M2 B
markers in finance-model.md §6 and SA; both scoreboards; one Score history line.
HOT: every finance SQL file. Nothing else runs in the SQL lane beside MR8a or MR8b.
```

### MR9 — Close §F: re-verify, re-score, hand off (last)

```text
PROMPT MR9: Re-verify every §F row against the code, re-score, and list what only a human can
finish

ROLE: Readiness auditor. No code changes; only documentation/readiness/* and the decision log.

STEPS:
  1. For each PRD §F row (and at the Wave 2 UAT checkpoint, the UAT rows only): grep its evidence
     at HEAD, run the probes it names (deno task test:probes <name>) and finish with one clean
     deno task test:probes:fresh. Flip a status only with that evidence; correct any row a build
     session over-claimed.
  2. Recompute both scoreboards with the file's formula; add the §Score history line; bump
     **Last verified**; refresh the §Critical path lines for MVP, UAT and PROD.
  3. USER_FLOWS: re-verify MW-01, MW-11, MW-14, MW-16, MW-19, MW-27, MW-62, MK-09, MK-28, MK-31,
     PJ-31, PJ-41 and PJ-42, then re-score.
  4. In MONEY_BUILD_PROMPTS.md §0, mark each prompt Done with its commit.
  5. Final message: §F's score (old → new) and a table of what remains, with whose act it is:
     counsel (F15, M9, #435 (d)), the live Stripe run (F17), hosted secrets (PRD-G6), and any 🧑
     the owner deferred.
```

---

## 6. What no prompt here can close

- **PRD-F15** needs counsel and Stripe. MR7 makes the question precise and measurable.
- **PRD-F17's live half** is a human's run of MR6's preflight on the production account.
- **Hosted dispatch** of every job these prompts add (`finance-conservation-check`,
  `finance-stripe-reconcile`, `ops-deliver-alerts`, PM-GH1's sweep) needs its bearer and
  `CRON_APP_URL` in the hosted Vault: PRD-G6, which sits outside §F.
- **PRD-F18 / F19** are ⏸ by decision (#435, #343) and are not scored.
