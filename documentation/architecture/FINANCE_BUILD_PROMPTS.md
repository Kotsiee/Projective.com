# Finance Build Prompts — Claude Code Work Orders for the Finance Engine, Stripe Rails & `/wallet`

> **Status: WORK ORDERS, not binding.** The finance engine, the Stripe rails, `/wallet`, `/checkout`
> and the money rows of [`PRODUCTION_READINESS.md`](../readiness/PRODUCTION_READINESS.md) §F (row
> map: §0.7). Evidence: [`FINANCE_AUDIT.md`](FINANCE_AUDIT.md), the one finance audit (FA's `L` `W`
> `E` `S` `K` `H` `A` `V` `R` `M` `Z` `C` `CO` `D`; FCA's `N` items; FDD's `X` and `D-` items).
> Ruling: Decision #337's OWNER RULINGS, cited `(Decision #337, ruling X)` (the table is
> [`FOUNDER_QUESTIONNAIRE.md`](FOUNDER_QUESTIONNAIRE.md) Part C); the readiness rows add #423, #435
> and #460–#472.
>
> **Verified against code 2026-11-23 at `f2e25929`.** 17 open, 8 partly done, 26 done or superseded
> (§0 ledger). Runnable now: DB14, DB9, SV8, DB13 and DB20 (SQL lane, one at a time); SV5, UI1
> and UI3 (app lane). DB17's last step waits on the owner's vendor pick (#471).
>
> **This file holds open work only.** A session that runs a prompt prunes it here when it finishes
> (§1's closing duty; [`build-prompts.md`](../reference/build-prompts.md) §2).

- Paste each prompt into its **own fresh session**, after the standard header (§1), in the §0.1
  order. A **🧑 DECISION** stops at its step and puts the options, with a recommendation, to a
  human; the rest of the prompt runs. **⚖️** marks a rule ruled but pending counsel: build behind a
  flag that stays off.
- Migrations are **edited in place** (root `CLAUDE.md` §1), so every prompt names its category file.
  Line numbers were right when each prompt was written: grep before trusting one.
- IDs: `DB` (SQL), `SV` (services), `UI` (islands), `E` (end-to-end), `Z1` (docs) and `MR`, the
  money readiness prompts merged in from `readiness/MONEY_BUILD_PROMPTS.md` on 2026-11-23 with their
  IDs unchanged (map at the end). The never-recorded "Decision #251" is superseded by #337.

---

## 0. Run order, conflicts and open decisions

### 0.0 Done

`Text at` is the commit where the prompt's full text can still be read:
`git show f2e25929:documentation/architecture/FINANCE_BUILD_PROMPTS.md`, or for an `MR` row
`git show f2e25929:documentation/readiness/MONEY_BUILD_PROMPTS.md`.

| ID   | What landed                                                                                               | Commit                 | Text at    |
| :--- | :-------------------------------------------------------------------------------------------------------- | :--------------------- | :--------- |
| F0   | Superseded: Decision #337's OWNER RULINGS carry FA §4.6's flags (ruling Q0.1 (c)); never run              | — (#337)               | `f2e25929` |
| DB1  | Deposit rules and pots written through doors only; `update_deposit_rule`; `finance_invariants.sql`        | `660c9658`, `172f9d66` | `f2e25929` |
| DB2  | Refunds, dispute updates, cancelled payouts and out-of-order disputes ledgered                            | `dd3986e5`             | `f2e25929` |
| DB3  | Enterprise KYB, inbound-transfer capability, approval expiry, fee fallback, no release in a dispute       | `44382c08`             | `f2e25929` |
| DB4  | Payout schedules run as withdrawals by their author; the cron route and job                               | `b61486be`             | `f2e25929` |
| DB5  | Pots are earmarks: doors, allocation on matured income, `finance.pot_movements`                           | `bc35b27b`             | `f2e25929` |
| DB6  | A card dispute freezes the payee's still-clearing rows it funded (`hold_chargeback_id`); lost recovers them first | `daae69b1` (#532)      | `f2e25929` |
| DB7  | Checkout integrity: charge assert, atomic promo, key re-check, second tab, `invoiced`                     | `24cbab02`             | `f2e25929` |
| DB8  | ISO-code CHECKs on every currency column; escrow status, owner type and reason CHECKed; one exponent      | #538                   | `de8ec700` |
| DB10 | On-account limit and approval threshold per currency (`finance.fn_param_minor`)                           | `f408e708`             | `f2e25929` |
| DB11 | A product sale pays the seller's Standing-tapered commission; the Agency contract ruled B (#252)          | `9d15fcd0`             | `f2e25929` |
| DB12 | A non-zero deadline bonus is refused (`ck_escrows_bonus_unfunded`)                                        | `4ff0ede2`             | `f2e25929` |
| DB15 | Payout-ready before earning without a ticket: publish, booking (HINT `seller`), paid calls; N14           | DB15_COMMIT            | `DB15_PARENT` |
| DB16 | Per-currency conservation identity, checked nightly, read on `/admin/ledger`; the seed conserves (#483)   | `85e7d4e4`             | `f2e25929` |
| DB19 | Order lines written `refunded` / `cancelled`, the order rolls up, one promo redemption per account (#511) | `3041e5ef`             | `f2e25929` |
| SV1  | Finance row schemas and `finance-tables.contract.test.ts`; its two CHECKs moved to DB8 step 3             | `4c9482a2`, `388d9952` | `f2e25929` |
| SV2  | The wallet read: resolved scope (303), decidable approvals, per-currency reads, `pdfHref`                 | `d4c4a194`             | `f2e25929` |
| SV3  | Recurring-rule actions; every automation control locked until its engine runs                             | `fdeb3018`             | `f2e25929` |
| SV4  | Checkout refuses before Stripe is touched; its tests; the `checkoutPayment` dev axis                      | `f691a0bb`             | `f2e25929` |
| SV6  | "Wallet covers" counts only the wallet that pays                                                          | `d2d7a07e`             | `f2e25929` |
| MR0  | The finance work orders refreshed, §F Track cells set, the money decision pack ruled (#466–#472)          | `19697b94`             | `f2e25929` |
| MR1  | An unclaimed escrow binds no payee on any project kind, so it is refunded, never paid (#474)              | `47f493c6`             | `f2e25929` |
| MR2  | A brief settles its escrow before it cancels; nothing archives while money is held (#479)                 | `18f0ed13`             | `f2e25929` |
| MR4  | Money alerts by webhook and email digest, with a dead-man check (#507); OPS5 extended the pipeline        | `322c4dc9`, `c93f6a18` | `f2e25929` |
| MR6  | A read-only `deno task stripe:preflight` and the SA §Stripe 1.4 go-live runbook (#476)                    | `cb01469d`, `e9e36f8d` | `f2e25929` |
| MR7  | One counsel brief (`FOUNDER_QUESTIONNAIRE.md` Part D, #473) and the Escrow age reader                     | `14f36cb0`             | `f2e25929` |

### 0.1 Run order

**This is the finance SQL lane.** It was `MONEY_BUILD_PROMPTS.md` §1 until 2026-11-23; the
MARKETPLACE, PROJECTS, OPERATIONS and LEGAL_COMPLIANCE readiness files point here for it. A money
prompt from another track takes a turn in it, and this order wins on a conflict.

Two lanes run side by side. The **SQL lane** runs one finance SQL prompt at a time, because nearly
all of them share `00001240`, `00001210`, `00001200`, `00000017`, `00002510` or `00005060`; a second
SQL session may run beside it only from another track, on disjoint migration files
(`FOUNDER_QUESTIONNAIRE.md` §B.0). The **app lane** runs up to three code or UI prompts at once,
file-disjoint. Inside a wave, §0.2 and §0.3 still decide what may overlap.

| Wave    | SQL lane (serial)                                                                                                                  | App lane (parallel, file-disjoint)                                                                        |
| :------ | :--------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| 2 (UAT) | PM **PM-GH1** (F23) → **DB14** (F6)                                                                                                 | **SV5** (F20) · **UI1**                                                                                   |
| ✔       | **UAT checkpoint:** F6, F14, F20 and F23 closed (F5: DB6, #532); re-score (MR9 step 1)                                               |                                                                                                           |
| 3       | **DB9** (F7) → **SV8** (F11) → **DB13** → **DB20** (F13) → **DB21** → **MR3** (F12) → **MR5** (F8)                | **UI2** → **UI6** · **UI4** (both after UI1) · **UI3** · **SV7** · **UI5** (after SV5) · **DB17 step 1** (F21, after the owner's vendor pick)              |
| 4       | **MR8a → MR8b** (F16), alone: nothing else runs in the SQL lane beside them                                                        | —                                                                                                         |
| Later   | **DB18** (after its 🧑 and DB17 step 1) · **E3** (after SCH-WP6)                                                                          | **E1** (after PRD-K3, the SQL lane through MR3, UI2, UI3, UI5) → **E2** (after every UI prompt)           |
| Last    | **MR9** re-scores §F → **Z1** sweeps the docs                                                                                      |                                                                                                           |

**SBP S1 → S2 (to its stop) → S3 → S4** (F14, UAT) run in Waves 2–3 as the second SQL session from
another track: before each starts, check that its FILES are disjoint from the SQL-lane prompt
running then. S4 never runs beside DB9, MR3 or MR5 (`00001230` + `stripe-webhook.ts`).

Why this order:

- **UAT rows lead,** in the order of PRD's UAT critical path: F23 → F5 → F6, with F20 (SV5) and F14
  (SBP) beside them. DB16 has landed, so every later money prompt proves in its own change that it
  conserved money.
- **Disputes are one chain:** DB6 ✅ (the freeze, ruling M3, #532) → DB21 (product disputes reuse it) → MR3
  (card refunds reuse DB21, DB19's line states and `/admin/ledger`).
- **Currency follows ruling M5:** the CHECKs and the exponent list (DB8, done: #538), settlement and
  entity currency (DB9), fresh rates (DB17), then the own-wallet conversion, if it is wanted (DB18).
- **External reconciliation (MR5) runs after DB9 and MR3:** it reuses DB16's terms and DB9's
  settlement currencies, and it has to recognise MR3's refunds.
- **The journal runs last and alone:** it touches every money definer.

### 0.2 Prompts in this file that may not run in parallel

- `00001240`: DB18, DB21, SV8, MR8b.
- `00001210`: DB9, DB13, MR8b. `00001200`: DB13, DB20, MR8a.
- `00000017`: DB13, DB18, DB21, MR3, MR5, MR8a.
- `00001230` + `stripe-webhook.ts`: DB9, MR3, MR5, MR8b.
- `00002510`: DB14, DB18, DB21, MR3, MR5 (SV7 if it adds a read).
- `00005060`: MR5. `00005001`: DB9, DB13, DB18. `00001830`: DB18, MR3, MR8a. `00003004`: DB18, MR5,
  MR8a. `00001150`: DB13, DB14, MR8b.
- `/admin/ledger` (`features/admin`, `LedgerHealthService`): MR3, MR5 and MR8b each add a section,
  one at a time.
- `wallet-actions.ts`: DB14, DB18. The checkout services (`CheckoutBackendService.ts`,
  `live-basket.ts`, `checkout-refusal.ts`, `commerce-*.ts`): SV5, SV7.
- The wallet stylesheets: UI1 with every UI prompt. `WalletDialogs.tsx`, `WalletHome.island.tsx`:
  UI2, UI3, UI5, DB18.
- `apps/web/features/checkout/**`: UI5, UI6, DB21. Check `git status` for the Decision #243 peers
  before any UI prompt.
- `packages/ui` and `DESIGN_SYSTEM.md`: SV5, UI1, UI2, UI4, UI5, UI6, DB18. Pull before each edit.

### 0.3 Hot files shared with other tracks (§B.0)

| Hot file                             | Finance prompts that write it                            | Other writers (never at the same time)                             |
| :----------------------------------- | :------------------------------------------------------- | :----------------------------------------------------------------- |
| `00001240` (finance money)           | DB18, DB21, SV8, MR8b                                    | PM-WP4, LEGAL_COMPLIANCE LG4                                       |
| `00005060` (jobs)                    | MR5                                                      | PM-GH1; comms, PM, scheduling and security packages that add a job |
| `00001150` (stage funding)           | DB13, DB14, MR8b                                         | PM-GH1 and every P-track SQL step on it                            |
| `00001155` (sessions)                | MR8b                                                     | every SCH work package                                             |
| `00001020` (workspaces)              | DB9 (entity wallet currency)                             | identity rank, archive and seat items; SA G4                       |
| `00002510` (grants)                  | DB14, DB18, DB21, MR3, MR5 (SV7 if it adds a read)       | many                                                               |
| `stripe-webhook.ts` + `00001230`     | DB9, MR3, MR5, MR8b                                      | SBP S4                                                             |
| `live-wallet.ts` / `wallet-scope.ts` | SV5, SV8, DB18                                           | RED WP2                                                            |
| `features/devtools` + `dev-seam.ts`  | UI3                                                      | SBP S4, S6; IDG F6                                                 |

### 0.4 Cross-track waits

- **SCH-WP6** (paid consultations) never runs beside DB13, which also edits `place_wallet_order` and
  the escrow holds. **E3** waits for SCH-WP6.
- **PM-WP4** (the Fair Exit floor, the ticket-level Fair Exit, removal refunds) no longer waits: DB6 landed (#532, B.3).
  DB13 and DB20 never run beside it: all three edit `00001200`'s release paths.
- **PM-GH1** (the ghosting auto-approve, FDD D-9 (a)) is `PM_BUILD_PROMPTS.md`'s; it takes Wave 2's
  first SQL slot here and judges a bonus as DB13 rules.
- **DB14** runs while no P-track SQL step edits `00001110`, `00001150` or `00001850`. **DB13**
  changes the project setup copy (`apps/web/features/projects/components/setup/*`): tell the P
  track.
- **SBP S4** never runs beside DB9, MR3 or MR5 (`stripe-webhook.ts`, `00001230`).
- **RED WP2 / WP11** (the wallet read path, SQL aggregates) wait for SV5. **RED WP4** (keyboard on
  money paths) waits for UI2, UI3 and UI5. **RED WP7** (the money sweep and its lint ban) waits for
  UI5 (and SBP S5).
- **Marketplace:** CK4 (checkout tax, #490) and SC7 (#493) wait for DB21.
- **LEGAL_COMPLIANCE LG4** adds one enqueue line each to `fn_mature_pending_releases` and
  `fn_wallet_credit_pending`'s immediate branch (`00001240`), and takes its turn here after DB6 (landed, #532),
  whose clearing-window holds decide which escrows count as finally released (#530 (g)).
- **Identity:** MFA's AAL2 step-up on withdrawals and payout-account changes, and IW-M13, wait for
  the finance SQL lane (`begin_payout`, `record_payout_account`). DB9's sign-up suggestion edits the
  identity track's wizard files (`apps/web/features/auth/core/*`): coordinate with
  `IDENTITY_BUILD_PROMPTS.md`.
- **Comms:** SV8's fan-out uses `comms.fn_notify` as it stands; a catalogue row it adds goes in
  `00005010`.

### 0.5 Open decisions

**🧑 stops in this file.** Each prompt runs up to its stop.

| Prompt | Question                                                                                                                                                                    | Recommendation                                     |
| :----- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------- |
| DB18   | Whether to offer a free-standing own-wallet Convert at all: #435 built conversion only inside a purchase the payer confirms, and ruling M5 (c) asked for the own-wallet one | None yet: counsel's answer to #435 (d) comes first |
| DB17   | #539 (a): a once-a-day feed against the 24-hour window leaves conversion quotes refused (`fx_rate_stale`) from each day's fix + 24 h until the next run, for a whole day after one failed run, and from Saturday afternoon to Monday's run every weekend (no fix is published then). Keep it (A), run the feed hourly (B), or age a rate in market time, so the weekend closure (Fri 22:00 – Sun 22:00 UTC) does not count (C)? | B + C, before `fx_checkout_enabled` is switched on |

**Ruled, and written into their prompts as steps:** DB9 step 3 (#423 (B)), DB13 (#468), DB17 (#471;
the vendor is still the owner's pick), DB18's margin (#435 (C)), DB21 (#470), MR3 (#464), MR5 (#460)
and MR8a (#463).

**⚖️ ruled, pending counsel** (build behind a flag that stays off; never switch it on). One brief
holds all three: `FOUNDER_QUESTIONNAIRE.md` Part D (#473, MR7).

- **M2's safeguarding question:** how long escrow may sit in the platform balance under Separate
  Charges & Transfers (PRD-F15). Nothing here builds on it.
- **M9:** a failed bank payout stays in the connected account's Stripe balance, as built (#202 (a)).
  SV8 only tells the right people and changes no money path, so it needs no flag.
- **#435 (d):** whether converting a held balance is a regulated service. `fx_checkout_enabled`
  stays off (PRD-F18), and DB18 waits.

**Open, and not this track's:** whether `project_stages.create_category` stays a label (#338 P4,
PM); Agency and Enterprise storage (#252 S2, SBP S2); and #472's UAT switch-off of the business plan
gates (SBP S1, back on in S4).

### 0.6 Covered elsewhere, or Planned

- **N2:** the paid-call money path is `SCHEDULING_BUILD_PROMPTS.md` SCH-WP6 (Decision #343, ruling
  C1; SCH-WP2's interim switch-off landed in `6882e0be`). E3 checks FDD D-2's finance riders once it
  merges.
- **N16:** the 14-day ghosting auto-approve (FDD D-9 (a), ruling P3: Build) is `PM_BUILD_PROMPTS.md`
  PM-GH1's.
- **FDD D-9 (b):** the Fair Exit floor (#338 P1) and the ticket-level Fair Exit (#338 P2 (a)) are
  PM-WP4's.
- **FDD D-1, D-4** (#343 C2): the review-window name and the reschedule lockout are the scheduling
  track's.
- **M1's `/pricing` copy** (#252 (l)) is `SUBSCRIPTIONS_BUILD_PROMPTS.md`'s. **#341 E2's lint ban**
  on `formatMoney` / `Intl.NumberFormat` is `OPTIMIZATION_BUILD_PROMPTS.md`'s (RED WP7).
- **Tax computation (A9)** (#490): Stripe Tax at checkout and on invoices, collected by the platform
  on digital products only and added on top of the price, behind `tax_collection_enabled` (off until
  counsel), as `readiness/MARKETPLACE_BUILD_PROMPTS.md` CK4, after DB21.
- **X4 / N31:** the root `CLAUDE.md` persona fix is the owner's edit (`f1f10e31`). No prompt here
  touches a guardrail file.
- **Planned, no prompt:** the Income Smoother engine (ruling M6: a `PRODUCT_SPEC.md` entry first),
  instant payouts and maintenance cycles (ruling P3), and the wallet-plus-card split payment (CO17).
  The Stripe-balance reconciliation (FA L6) and the shadow journal (ruling M2 B) have left Planned:
  MR5 (#460) and MR8a → MR8b (#463).

### 0.7 PRODUCTION_READINESS §F row map

**The flip rule.** A prompt that closes a row flips it in the SAME change (status, and evidence
naming the commit or decision), recomputes both scoreboards and adds one §Score history line (§1's
Readiness rules). A row stays 🟡 while a hosted or human step is left, named in its evidence (#507
(E)(3)).

| Row       | Crit · Gate             | Now | Closed by                                                               | Stops                           |
| :-------- | :---------------------- | :-: | :---------------------------------------------------------------------- | :------------------------------ |
| PRD-F1–F4 | Critical/High · MVP–UAT | ✅  | —                                                                       | —                               |
| PRD-F5    | Critical · UAT          | ✅  | DB6 done (#532; the freeze and the payee clawback)                      | —                               |
| PRD-F6    | High · UAT              | 🟡  | **DB14** (the remainder; DB15 done)                                     | —                               |
| PRD-F7    | High · PROD             | 🟡  | **DB9** (DB16 done, #483; DB8 done, #538)                               | ruled (#423)                    |
| PRD-F8    | Critical · PROD         | ❌  | **MR5** (after DB9, MR3)                                                | ruled (#460)                    |
| PRD-F9    | High · PROD             | 🟡  | No prompt: a hosted send on both channels (DB16 done, MR4 done; PRD-G6) | ruled (#507 (E)(3))             |
| PRD-F10   | High · PROD             | ✅  | DB8 done (#538; N24)                                                    | —                               |
| PRD-F11   | High · PROD             | ❌  | **SV8**                                                                 | ⚖️ M9 as built (no flag needed) |
| PRD-F12   | High · PROD             | ❌  | **DB21** + **MR3** (DB19 done, #511)                                    | ruled (#470, #464)              |
| PRD-F13   | Normal · PROD           | ❌  | **DB13 → DB20**                                                         | ruled (#468)                    |
| PRD-F14   | High · UAT              | ❌  | SBP **S1 → S2 → S3 → S4**                                               | ruled (#252 (f); #472)          |
| PRD-F15   | Critical · PROD         | ❌  | No prompt: counsel (MR7 done wrote the brief, #473)                     | ⚖️ counsel + Stripe             |
| PRD-F16   | High · PROD             | ❌  | **MR8a → MR8b**                                                         | ruled (#463)                    |
| PRD-F17   | Critical · PROD         | 🟡  | No prompt: a human's live run of MR6's preflight (MR6 done, #476)       | human Dashboard acts            |
| PRD-F18   | ⏸                       |  ⏸  | not scored (rides DB17 step 1 + counsel #435 (d))                       | —                               |
| PRD-F19   | ⏸                       |  ⏸  | not scored (#343)                                                       | —                               |
| PRD-F20   | High · UAT              | ❌  | **SV5 → UI5**                                                           | —                               |
| PRD-F21   | High · PROD             | 🟡  | **DB17 step 1** (the vendor's adapter) → **UI5** (DB17 steps 2–4 done, #539) | ruled (#471); 🧑 the vendor; 🧑 #539 (a) |
| PRD-F22   | Critical · UAT          | ✅  | MR2 done (#479)                                                         | —                               |
| PRD-F23   | Critical · UAT          | ❌  | PM **PM-GH1** (PM-WP1 done, `07d853f6`)                                 | —                               |
| PRD-F24   | Critical · UAT          | ✅  | MR1 done (#474)                                                         | —                               |
| PRD-F25   | High · UAT              | ✅  | #522 (quote evidence)                                                   | —                               |

**What no prompt here can close.** PRD-F15 needs counsel and Stripe; PRD-F17's live half is a
human's run of MR6's preflight on the production account; PRD-F9's hosted send needs
`OPS_CRON_SECRET` in the hosted Vault and the two alert targets set. Hosted dispatch of every job
these prompts add (`finance-fx-daily`, `finance-stripe-reconcile`, PM-GH1's sweep) needs its bearer
and `CRON_APP_URL` in the hosted Vault: PRD-G6, outside §F. PRD-F18 and F19 are ⏸ by decision (#435,
#343) and are not scored.

---

## 1. Standard header — paste above EVERY prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types the
Zod SSOT @projective/types; packages/backend fat services @server/services/*; supabase/migrations
Postgres with RLS everywhere; Stripe Separate Charges & Transfers on Accounts v2 Express).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (at least
     documentation/CLAUDE.md; documentation/database/CLAUDE.md when SQL changes;
     packages/ui/CLAUDE.md for UI), then documentation/reference/guardrails.md and
     documentation/reference/pr-checklist.md.
  2. Read the evidence your prompt cites: documentation/architecture/FINANCE_AUDIT.md
     (FCA: the re-verified FA IDs and the N items), FINANCE_AUDIT.md (FA) and
     FINANCE_AUDIT.md (FDD: the X and D- items).
  3. Read the rulings: Decision #337's OWNER RULINGS (grep -n '^| 337 |'
     documentation/reference/decisions/decisions-122-126.md) and the ruling table in
     documentation/architecture/FOUNDER_QUESTIONNAIRE.md Part C. Then grep
     documentation/reference/decisions/README.md for the surface you touch and read what it names:
     at minimum #10, #122-#126, #152, #157, #186-#191, #196, #200, #202, #203, #211, #212, #234,
     #239, #240, #243, #247, #252, #337, #338, #341, #343, #423, #435, #460-#472, #483, #497,
     #507 and #511.
  4. Read documentation/business/finance-model.md, the PRODUCT_SPEC.md section you touch and
     documentation/database/finance/{Tables,Functions,Policies}.md for the objects you change.
  5. Check documentation/architecture/FINANCE_BUILD_PROMPTS.md §0: if another session is writing
     one of your files, wait. Re-verify every premise and line number your prompt cites against
     HEAD; a premise that no longer holds goes in your final message, never silently worked around.

Hard rules (merge gates; reject your own diff if any fails):
  Rulings
  - A ruled rule that is not built is marked "**Not built yet** (Decision #NNN, ruling X)" or
    "**Planned**" in PRODUCT_SPEC.md, finance-model.md or PRODUCT_MANAGEMENT.md. The change that
    builds it removes its marker. A question still open stops at its 🧑 DECISION: put the options
    and the recommendation to me, and never pick a side.
  - ⚖️ (ruled, pending counsel): build behind a flag that stays off; never switch it on.
  Money
  - Integer minor units only; floor every cut; dust goes to a named sink (the main balance or the
    team vault), never lost. Every balance move goes through finance.fn_wallet_credit /
    fn_wallet_debit / fn_wallet_credit_pending; never UPDATE finance.wallets.balance_cents.
  - Every webhook effect claims finance.idempotency_keys ('stripe:<evt_id>') INSIDE the same SQL
    transaction as the effect (fn_claim_stripe_event). Replays must be no-ops.
  - Never drop or retype columns/FKs of escrows, wallets or stages without asking me.
    finance.escrows.fx_* stay (Decision #337, ruling Q0.2 (d)); since #435 a converted purchase
    writes them.
  - supabase/probes/finance_invariants.sql and supabase/probes/conservation_identity.sql stay
    green. A prompt that adds a money flow adds its terms to finance.v_conservation_identity in the
    same change.
  - Every user-initiated money write a finance service makes passes
    packages/backend/services/finance/money-gate.ts first (FINANCE_BACKEND_LIVE, #497);
    money-gate.gate.test.ts fails on a door called around it.
  Stripe
  - Never use a live key. Never change anything in the Stripe Dashboard, and never create, update
    or delete a webhook endpoint, event destination, account setting or object on any Stripe
    account: a human does all of these. Read-only calls with the .env.local TEST key only where
    your prompt says so. Use the stripe:stripe-docs skill for any Stripe API fact, and cite it.
  SSOT & architecture
  - Migrations are consolidated and EDITED IN PLACE (supabase/migrations/vvvvtooo_type_purpose.sql).
    Never append ALTER TABLE ADD COLUMN / ALTER TYPE ADD VALUE patches or a new "fix" file. Each
    statement goes in its category file: 0 enums/tables · 1 functions/triggers · 2 policies/grants
    · 3 views · 4 indexes · 5 seed (00005060 holds the scheduled jobs).
  - A schema or RPC-contract change lands with its Zod schema (packages/types/finance/*), the
    backend mapper and documentation/database/<schema>/* in the SAME change. A lifecycle or state
    change also updates documentation/PRODUCT_MANAGEMENT.md §3.5; a business rule also updates
    PRODUCT_SPEC.md / finance-model.md.
  - Thin routes (apps/web/routes/api/{wallet,finance,checkout}/*): HTTP parse + Zod + auth guard
    ONLY. Logic and money maths live in packages/backend/services/finance/* and return
    ServiceResult<T> (#10). A cron route takes a constant-time bearer and answers 404 otherwise.
  - Capability enforcement lives in the SQL door (fn_has_vault_capability); the service mirrors it
    only to decide what to OFFER. RLS on finance tables is SELECT-only unless a policy already
    exists and the audits do not flag it; a new write goes through a door.
  - Islands never import Supabase or @server/*; they call their feature's core service.
  - Signal-first state; useEffect only for external DOM/browser/Stripe APIs. No useState.
  - Path aliases only; folders components/ islands/ styles/ hooks/ wrappers/ types/ core/; no src/.
  - JSDoc on exports; // #region [Name] … // #endregion; no meta-comments.
  UI (DESIGN_SYSTEM.md; root CLAUDE.md §3)
  - Token-only pure CSS + strict BEM. No hex/rgb outside wallet-tokens.css's licensed aurora block,
    no literal radius/duration/shadow/weight/breakpoint, no inline style= except styleVars().
  - The scoped Wallet exception (#122/#123/#124/#152) licenses the hero aurora, the glass pills,
    the corner tools, the ruler, the sheet rim, the three popovers and the aurora violet of
    reserved funds (Decision #337, ruling E3 FA (l)), nothing else. Every backdrop-filter sits on a
    ::before underlay with an @supports not (backdrop-filter) opaque fallback.
  - Beyond the hero: solid tonal steps (--bg → --surface-1 → --surface-2); no color-mix(…,
    transparent), no opacity to dim text; no card in a card; static content unboxed.
  - Anti-tag (§B.11): financial metadata is inline --text-secondary MetaLine text joined by " · ".
    Containers only for controls, lifecycle statuses (Tag), required disclosures (InlineNotice)
    and count badges.
  - Type (§A.4): display/title at --fw-medium, section headers ≤ --fw-semibold. EVERY amount,
    balance, date, rate, percentage and chart tick is tabular-nums. Every visible money figure is a
    MoneyView (Decision #341, ruling E2); strings only in aria and sentences.
  - Button matrix (§B.8, #157): one filled control per decision region. Tier 1 <Button
    severity="accent" rounded> marks every act that starts or commits a money flow (Decision #337,
    ruling E3 D-13, which rules #157 flag (j)). Configuration and authorisation commits stay tier 3
    (DESIGN_SYSTEM "Commits that stay tier 3"); tier 4 neutral outlined utilities; tier 5 text.
    Press = transform: scale(var(--btn-press-scale)), removed (transform: none) under BOTH
    @media (prefers-reduced-motion: reduce) AND :root[data-motion="reduced"], rule for rule.
  - Contrast: text ≥ 4.5:1, non-text ≥ 3:1 in light, dark and data-contrast="high"; --accent /
    --on-accent are fixed-polarity (§A.1.2). Focus rings stay OFF app-wide: #245 (a) stands until
    the owner's design (Decision #341, ruling E3 Q3). Do not add or remove one.
  - Modals (§B.10.9): one dialog at a time (the walletDialog signal on /wallet); replace in place;
    never a second scrim; @projective/ui Dialog with a Signal `visible`; bottom sheet on mobile.
  - A control that renders must do something (§3.11). An automation whose engine does not run is
    LOCKED with a LockedDialog reason (Decision #337, ruling M6). A new or changed packages/ui
    component updates the DESIGN_SYSTEM.md §C.1 roster in the same change.
  Product
  - Every new simulatable axis gets its Dev Context Switcher control in the same change:
    DevOverrides + DEV_DEFAULTS, DevOption list, DevContextPanel control, reflect() set AND delete
    (apps/web/features/devtools/, seam apps/web/utils/dev-seam.ts).
  - No bespoke statuses; nothing hard-deleted (archive / active=false).
  - A NEW contradiction between source docs: do not pick a side. Add a decision row (the newest
    documentation/reference/decisions/decisions-*.md + a README index line; re-check the index for
    a number collision right before you write) and ask me.
  Readiness
  - This work closes or narrows rows of documentation/readiness/PRODUCTION_READINESS.md §F (this
    file's §0.7) and the documentation/readiness/USER_FLOWS.md rows your prompt names. In the SAME
    change: flip each row you close (status + evidence naming your commit or decision), recompute
    BOTH scoreboards (tier table and area table) with the file's formula, add one §Score history
    line, and update the USER_FLOWS rows and their scoreboard. Use 🟡 while a hosted or human step
    is left, and name it (#507 (E)(3)). Never flip a row on a test you did not run.

Verification: reproduce the defect first, then fix. A SQL probe lives in supabase/probes/: it sets
\set ON_ERROR_STOP on, asserts through a pg_temp helper that raises 'PROBE FAIL: …' and ends in
ROLLBACK; only a concurrency probe commits, gated on :{?disposable}. SQL sessions: at most 2 at once
on the one local DB, on disjoint migration files; `deno task db:reset` is standing-approved
(root CLAUDE.md), but announce every reset to the other sessions before you run it; run probes
with `deno task test:probes` (a name filters them) and finish with your own clean
`deno task test:probes:fresh`. Then `deno task check`, `deno task lint`, `deno task test:unit`, and
`deno fmt` on the files you touched only (never a directory). Four theme-engine.test.ts failures
are pre-existing (Decision #96(a)). UI prompts: `deno task dev`, the seeded personas
(documentation/database/Seed.md), and screenshots at 1440, 900 and 390 px in light, dark,
data-contrast="high" and data-motion="reduced".
Concurrent sessions share this tree: never git stash, never switch branch, stage only your own
hunks, and verify in a clean worktree before you commit. Commit on the branch you were given with a
clear message; do not open a PR unless I ask. Finish with: what you built; the rows you flipped
(old → new); every probe and test you ran, with its result; and every 🧑 question still open.

When you finish, do the closing duty (documentation/reference/build-prompts.md §2) in the same
commit as the work:
  - In documentation/architecture/FINANCE_BUILD_PROMPTS.md: a done prompt leaves the file. Delete
    its section and add its row to §0's Done ledger (ID · what landed · commit · text at
    <commit>^). A partly done prompt keeps only its open steps, with their numbers unchanged, under
    one rewritten Status line. A ruled 🧑 stop becomes the ruled step, with its decision number.
  - Treat any step you built for another prompt the same way, in the file that holds it.
  - Run git grep -n "<ID>" documentation/ and update every place that still calls it open: the
    PRODUCTION_READINESS / USER_FLOWS Track cells, the audit's Status column, other prompts' waits,
    and this file's row in documentation/reference/build-prompts.md §3.
  - If the file has no prompts left, delete it, log it in build-prompts.md §4 and repoint its links.
```

---

## 3. Phase 1 — Database RPCs, ledger gaps & webhook hardening

### DB9 — Settlement per currency, and an entity's currency from its owner's country (M5 (a), (b))

> **Status 2026-11-23:** step 0 was done read-only on 2026-11-12 (the platform account is GB,
> default `gbp`, GBP balance only), and step 1 landed in `1d8fc3e6` (Decision #435:
> `currencyForCountry`, `packages/types/finance/fx.ts`, clamped to the nine `settlement_currencies`,
> else GBP; it decides a buyer's billing currency today); steps 2–4 below are open. Ruled #423 (B):
> Stripe's GB spec cannot settle AED, INR or NGN (FA N37), so `settlement_currencies` is GBP USD EUR
> CAD AUD JPY SGD CHF ZAR and those three are display-only; a human adds the eight non-GBP
> settlement bank accounts in the Dashboard before live payouts in them (MR6's runbook). DB17 still
> quotes all 12 display currencies.

```text
PROMPT DB9: Money settles per currency, and an entity's currency comes from its owner's country

ROLE: Payments architect + Postgres engineer.

CONTEXT: FA C17, C1 and C16 (FCA: team and business wallets take the creator's DISPLAY currency;
projects default to USD; Stripe settles into one GBP balance); FDD X21, D-8. Decision #337, ruling
M5 (a): per-currency Stripe balances for the nine settlement currencies (#423 (B)), so a payout
transfers in the wallet's currency from a same-currency balance. Ruling M5 (b): an entity's currency
comes from its owner's country through one map (currencyForCountry, #435), and a project defaults to
its owner's currency;
location and browser signals only SUGGEST the sign-up country, for the person to confirm, and choose
a guest's display currency. These replace the decision DB9 used to stop on.

FILES:
  - supabase/migrations/00001020_functions_org_entities.sql (team, business and enterprise wallet
    creation, :1146-1171 and its siblings): HOT
  - supabase/migrations/00001210_functions_finance_kyc_wallet.sql and 00001230 (the
    COALESCE(…, 'USD') sites)
  - supabase/migrations/00000015_tables_projects.sql (:84 DEFAULT 'USD'), 00000011_tables_org.sql
    (:253, :945), 00000023_tables_catalogue.sql (:84, :209)
  - supabase/migrations/00005001_seed_platform_params.sql (settlement_currencies)
  - packages/types/finance/fx.ts (currencyForCountry: reuse it); packages/types/org preferenceHints
  - apps/web/features/auth/core/wizardValidation.ts (the identity track's wizard: coordinate) and
    apps/web/utils/currency-context.ts (a guest's display currency)
  - packages/backend/services/finance/stripe-rails.ts (:180-200, :381-385)
  - supabase/probes/entity_currency.sql (new)
  - finance-model.md §9 and §11, PRODUCT_SPEC.md §6 (the M5 (a), (b) markers),
    documentation/database/{finance,org,projects,catalogue}/Tables.md

STEPS:
  2. An entity's wallet currency at creation = currencyForCountry(the owner's confirmed country),
     never the display preference. A project takes its owner's currency in the create door; the
     'USD' column defaults go, in place (each writer sets the value): projects, business_profiles,
     enterprises and catalogue listings alike.
  3. settlement_currencies (the nine, seeded, #423 (B)): a listing or a project cannot
     be priced in a currency outside it (SV5 narrows packages/types/catalogue/catalogue.ts:147 to
     it). A Transfer Stripe refuses for an insufficient balance in its currency returns the money
     through the existing transfer-failure path and writes an ops.log_entries alert (C17).
  4. A suggestion only (the owner's M5 (b) note): preferenceHints proposes a sign-up country from
     the browser's languages and time zone (and an edge country header only if the host sets one),
     and the person confirms it. A guest's display currency comes from the same hint. Neither ever
     sets an entity's currency.

ACCEPTANCE: entity_currency.sql: a team created by a user whose confirmed country maps to EUR gets
an EUR wallet whatever their display currency; a JPY owner's new project is in JPY; a listing priced
outside settlement_currencies is refused. finance_invariants.sql and conservation_identity.sql
pass. Readiness: completes PRD-F7 (DB8 done, #538).

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod + database docs with every default and column change;
the PRODUCT_SPEC.md §6 and finance-model.md §11 markers removed for what this builds.
HOT: 00001020, 00001230 + stripe-webhook.ts (never beside SBP S4), and the identity track's
wizard files.
```

### DB13 — Deadline bonuses held with the escrow (M7, step A)

```text
PROMPT DB13: A deadline bonus is held with its escrow and paid only when the deadline is met

ROLE: Ledger engineer.

CONTEXT: FCA N4; FDD D-11. Decision #337, ruling M7 (A, after DB12's C, which landed in 4ff0ede2):
the bonus is held with the escrow at funding; release pays it when the deadline was met; otherwise
it is refunded to the payer with no fee. One-offs and pipelines both offer it (the owner's answer).
ck_projects_deadline_bonus_format no longer exists: only a comment (00001100:298) and the setup
copy still say "pipelines only". +10% (DEADLINE_BONUS_RATE = 0.1) is the starting dial.

What "met" means (ruled: Decision #468, A): per escrow, against the ticket's due date, which after a
claim moves only with both sides' agreement (Decision #338, ruling P5 (c)); met ⇔ the submission
that is later approved was SENT by it, so the client's review time never costs the freelancer the
bonus. Write it into PRODUCT_SPEC.md and finance-model.md §13 in the same change, so they agree.
#468 also rules #457's "no bonus" on a bought One-Off or Task interim: once this lands, a buyer may
add a held bonus to a bought One-Off or Task at checkout, judged the same way. So this prompt also
reaches place_wallet_order's One-Off line (00001210), marketplace.fn_buy_scoped_service (00001175)
and the two configure dialogs (ScopeBriefModal.island.tsx, ServiceDetailModal.tsx), or names the
follow-up that does.

FILES:
  - supabase/migrations/00005001_seed_platform_params.sql (deadline_bonus_bp = 1000;
    packages/types/projects/create.ts DEADLINE_BONUS_RATE pinned to it by a parity test, Decision
    #341, ruling E1 Q15)
  - supabase/migrations/00000017_tables_finance.sql (escrows: DB12's ck_escrows_bonus_unfunded goes
    back to ≥ 0; the deadline the escrow was funded against, snapshot in place if the ruling needs
    it)
  - supabase/migrations/00001100_functions_projects_read_access.sql (the :298 comment that still
    names the retired format CHECK)
  - supabase/migrations/00001200_functions_finance_core.sql (fn_hold_ticket_escrow :370 holds
    amount + bonus; fn_release_ticket_escrow :716 pays it when met, else refunds it;
    fn_fair_exit_release :935 and the dispute split refund it): PM-WP4 edits these too, never in
    parallel
  - supabase/migrations/00001150_functions_projects_stage_funding_submissions.sql (fund_stage's
    expected amount includes the bonus, after DB14) and the quotes that show the hold
    (packages/backend/services/finance/stage-funding.ts, the escrow quote route, the checkout lines)
  - apps/web/features/projects/components/setup/* (DB12's copy guard goes; tell the P track)
  - supabase/probes/deadline_bonus.sql (new)
  - finance-model.md §13 and PRODUCT_SPEC.md (One-offs, Pipelines) markers;
    documentation/database/{finance,projects}/*; the bonus term of finance.v_conservation_identity

STEPS:
  1. Holding: a ticket whose project allows bonuses and that has a due date holds
     amount + ⌊amount × deadline_bonus_bp / 10000⌋ from the payer in ONE hold (one debit, one escrow
     row), recording the bonus on the escrow. Every quote (stage funding, checkout, card lock) shows
     the same figure, and the payer's spend gate and approval count the whole hold.
  2. One-offs: correct that comment and the setup copy; the setup offers the bonus on both project
     types, and a bought One-Off or Task offers it at checkout (#468).
  3. Release, per the ruling: met → the payee gets amount + bonus − fee (the fee on the amount only,
     as today); missed → amount − fee to the payee, and the bonus goes back to the payer at once as
     a fee-free 'deadline_bonus_refund' credit.
  4. Every other exit (Fair Exit, a dispute split, removal before work, the claim TTL) refunds the
     bonus with no fee. PM's ghosting auto-approve judges "met" exactly as step 3 does.

ACCEPTANCE: deadline_bonus.sql: the hold = amount + 10%; on time → paid; late → refunded fee-free to
the payer; Fair Exit → refunded. finance_invariants.sql and conservation_identity.sql pass: a
released bonus now has its funding term. Readiness: closes PRD-F13 with DB20.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod + documentation/database/{finance,projects}/*; the M7
markers in finance-model.md and PRODUCT_SPEC.md removed, worded per the ruling.
HOT: 00001210 (SCH-WP6 never beside it); 00001200 and 00001150 (never beside PM-WP4 or a P-track
SQL step on them).
```

### DB14 — No ticket enters work unfunded, and stage funding asserts its amount (N6, N8)

> **Status 2026-11-23:** step 1's assignee half landed in `660c9658`, built differently
> (`projects.fn_ticket_immutability_guard`, BEFORE INSERT OR UPDATE, refuses a client-role INSERT
> that names an assignee, 42501); step 1's work-status half and step 2 below are open
> (`trg_ticket_escrow_sync` still fires AFTER UPDATE only; `fund_stage` has no `p_expected_minor`).

```text
PROMPT DB14: No ticket enters work without a held escrow, and stage funding asserts its amount

ROLE: Postgres engineer.

CONTEXT: FCA N6 (fn_ticket_escrow_sync fires AFTER UPDATE only, so a project owner can INSERT a
ticket already assigned and in work, skipping the escrow gate and fn_assign_ticket_core's
payout-ready check) and N8 (funding a stage from the wallet compares the quote in TS, then calls
fund_stage with no expected amount; the card path asserts it in the database). No ruling is needed.

FILES:
  - supabase/migrations/00001110_functions_projects_ticket_guards.sql (a BEFORE INSERT guard) and
    00001850_triggers_projects_tickets.sql (bind it)
  - supabase/migrations/00001150_functions_projects_stage_funding_submissions.sql
    (fund_stage(p_project_id, p_stage_id, p_expected_minor bigint), required, no DEFAULT)
  - supabase/migrations/00002510_permissions_function_grants.sql (:91, the new signature): HOT
  - packages/backend/services/finance/{wallet-actions.ts (:383-407, fund_escrow passes the quote),
    stage-funding.ts, PaymentBackendService.ts (the settlement call passes the payment amount)} and
    every other fund_stage caller (grep)
  - supabase/seeds/* if a seed inserts an assigned or in-work ticket
  - supabase/probes/ticket_insert_gate.sql (new), stage_funding_prepaid.sql (extend)
  - documentation/database/projects/Functions.md, documentation/database/finance/Functions.md

STEPS:
  1. N6, the work-status half: BEFORE INSERT ON projects.tickets. A ticket born in a work status is
     refused (PF402, as the UPDATE gate refuses entry into work without a held escrow). MR1 (#474)
     already refuses an unclaimed ticket entering work on UPDATE (PF402, DETAIL reason 'unclaimed',
     00001110:424): reuse its code; do not add a second one. No role is exempt: a seed that needs
     an in-work ticket inserts it unassigned and moves it by UPDATE, so the existing gates run.
  2. N8: fund_stage refuses PC409 'price_changed' when p_expected_minor differs from what it would
     hold. The wallet path passes the quote it showed; the card settlement passes the payment
     amount.

ACCEPTANCE: ticket_insert_gate.sql: an insert in work → PF402; the normal create-then-assign path
passes. stage_funding_prepaid.sql: a re-price between the quote and the commit → PC409, and nothing
is held. finance_invariants.sql and conservation_identity.sql pass. Readiness: closes PRD-F6 (DB15
has landed).

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; documentation/database/{projects,finance}/Functions.md with
the trigger and the signature.
HOT: 00002510; 00001110, 00001150 and 00001850 belong to the projects track too: never beside a
P-track SQL step on them.
```

### DB17 — A daily FX feed (M5 (f)) — step 1 waits on the owner's vendor pick

> **Status 2026-11-23:** steps 2–4 landed (Decision #539), built against the provider interface and
> its fixture adapter, as #471 asked until a key exists: `finance.record_fx_rates` and
> `fn_fx_feed_currencies` (`00001200`, service role only), the `finance-fx-daily` job (`00005060`,
> 16:23 UTC), `POST /api/finance/cron/fx`, `FxService.refreshRates` with `fx-feed.ts` (the
> `FxFeedAdapter` interface, the exact `parseJsonExact` read, `fixtureFxFeed`, `checkFxFeed`), the
> one 24-hour window (`FX_RATE_MAX_AGE_HOURS` = `fx_rate_max_age_hours`), the seed comment corrected,
> probe `fx_feed.sql`. Step 1 is open: the vendor's adapter, after the owner picks the vendor and its
> plan (#471). It edits no migration. 🧑 #539 (a) (the 24-hour window against a daily feed, §0.5)
> is the owner's before `fx_checkout_enabled` is switched on.

```text
PROMPT DB17 (step 1): The vendor's adapter feeds the daily FX job

ROLE: Backend engineer.

CONTEXT: Decision #471 (A): one commercial reference-rate API quoting all 12 display currencies
(GBP USD EUR CAD AUD JPY INR SGD CHF ZAR NGN AED) against GBP daily, licensed for display and
pricing use, keyed FX_FEED_URL / FX_FEED_API_KEY. The rest of the feed is built (Decision
#539): FxService.refreshRates checks a snapshot (checkFxFeed) and records it all or none through
finance.record_fx_rates; until this step configuredFxFeed() answers null and each run logs
feed_not_configured. Run it only once the owner has named the vendor and its plan.

FILES:
  - packages/backend/services/finance/fx-feed.ts (the vendor's FxFeedAdapter; configuredFxFeed reads
    serverEnv's FX_FEED_URL / FX_FEED_API_KEY) + its test with a recorded response body
  - packages/backend/core/env.ts and env-manifest.ts (FX_FEED_URL / FX_FEED_API_KEY planned → live),
    SYSTEM_ARCHITECTURE.md's Environment Variable Contract and .env.example (placeholders only)
  - finance-model.md §11 (the "until its adapter is added" sentence)

STEPS:
  1. The adapter: GBP-based quotes for the 12, parsed exactly (numeric strings, never floats:
     parseJsonExact, or the vendor's string fields), mapped to FxFeedSnapshot with the vendor's own
     observation instant as as_of and its slug as provider; a network failure, a non-2xx and an
     unreadable body each throw FxFeedError with their code (fetch_failed, http_error, body_invalid),
     and the key never reaches a log.

ACCEPTANCE: the adapter's test reads a recorded body into the 12 exact rates; a refusal of each kind
records nothing (FxService.refresh.test.ts's pattern). Readiness: PRD-F21 stays 🟡 until UI5 (USER_FLOWS
MW-11, MK-28).
```

### DB18 — Conversion between one's own wallets at a disclosed margin (M5 (c), (d)) — 🧑 whether

> **Status 2026-11-23:** the engine landed in `1d8fc3e6` for purchases only (Decision #435: locked
> quotes in `finance.fx_quotes` through `finance.quote_fx_conversion` / `fn_execute_fx_quote`, the
> append-only `finance.fx_conversions`, `fx_conversion` / `fx_spread` legs stamped with `fx_*`,
> pinned refunds and reconciliation views; `database/finance/Functions.md` §Paying in one's own
> currency), and the margin is ruled (#435 (C)). The free-standing Convert below is open and stops
> on its 🧑 (§0.5): a conversion exists only inside a purchase the payer confirms. Reuse #435's
> table, quote door and legs; FILES' "new" objects mostly exist.

> **Input from DB5 (2026-11-12):** `finance.fn_wallet_debit` raises `22023` for a debit reason in
> neither of its lists. The conversion's debit reason joins the voluntary list, so a conversion
> never reaches earmarked money ("an earmarked amount refuses" in the acceptance below is that
> rule).

```text
PROMPT DB18: Convert between your own wallets at a disclosed margin

ROLE: Ledger engineer, plus one dialog.

CONTEXT: FA C4 (FCA: balances are stranded per currency; there is no own-wallet conversion); FDD
D-8 (c), (d). Decision #337, ruling M5 (c): the owner chose to build the disclosed-spread conversion
now. Ruling M5 (d): mid-market plus a disclosed margin, paid by whoever converts; the margin is a
platform_params dial (ruled: Decision #435 (C), fx_spread_bp, a per-currency map seeded
{"default": 150} and switched off by fx_checkout_enabled until counsel answers #435 (d)). This
prompt writes the transactions' fx_* columns, as #435's purchase conversions do. DB5 (earmarks) and
DB9's settlement currencies are in place; it depends on DB17 step 1 (fresh rates).

🧑 DECISION (before step 1): whether to offer a free-standing own-wallet Convert at all. #435 built
conversion only inside a purchase the payer confirms. Put it to me only after counsel has answered
#435 (d) (is converting held client money a regulated currency-exchange service?); build nothing
before the answer. If built, it stays locked ('conversion_not_priced') while fx_checkout_enabled is
off.

FILES:
  - supabase/migrations/00000017_tables_finance.sql (finance.fx_conversions exists, #435: add only
    what an own-wallet conversion needs, in place) + 00001830_triggers_finance.sql (append-only)
  - supabase/migrations/00001240_functions_finance_money_movement.sql
    (finance.convert_between_own_wallets, on top of finance.quote_fx_conversion) + 00002510
  - supabase/migrations/00005001_seed_platform_params.sql (fx_spread_bp and fx_checkout_enabled
    exist: read them)
  - supabase/migrations/00003004 (finance.v_conservation_identity's conversion terms: out of X is
    external-out for X, into Y is external-in for Y, the margin is revenue)
  - packages/types/finance/{wallet.ts, fx.ts}; packages/backend/services/finance/{wallet-actions.ts,
    live-wallet.ts (actionsFor)}; apps/web/features/wallet/components/WalletDialogs.tsx (a Convert
    step in MoveDialog; CommitReviewBody shows the rate, the margin, the rate's date and the amount
    received)
  - supabase/probes/wallet_conversion.sql (new)
  - documentation/database/finance/*, finance-model.md §11 and PRODUCT_SPEC.md §6 (the M5 (c), (d)
    markers), DESIGN_SYSTEM.md "Where tier 1 renders today" (the Convert commit)

STEPS:
  1. The quote: mid-market from the newest fx_rates row, refused when it is older than 24 h (never
     convert on a stale rate); the margin; the amount received, floored in the target's minor units.
  2. convert(p_from_wallet, p_to_currency, p_amount_minor, p_expected_receive_minor,
     p_idempotency_key): the owner of a personal wallet, or `distribute` on a shared one (an active,
     KYB-verified business, as the spend gate requires); Available minus earmarks only
     (fn_available_cents); PC409 'rate_changed' when the expected amount no longer matches. One
     transaction: debit 'fx_conversion_out', credit 'fx_conversion_in' (both with fx_rate, fx_base
     and fx_as_of) and one fx_conversions row. A replay returns the first result.
  3. The dialog: one tier-1 accent commit ("Convert £X"), the margin stated before it, a MoneyView
     for every figure; locked while fx_checkout_enabled is off.
  4. Treasury: the ops reader (DB16) shows the net converted amount per currency. Rebalancing the
     Stripe balances is an ops act, not code.

ACCEPTANCE: wallet_conversion.sql: with fx_checkout_enabled off → refused; with it on inside the probe,
GBP → EUR moves the quoted amounts, writes both fx columns and one conversion row; a stale rate
refuses; an earmarked amount refuses; a replay changes nothing; conservation_identity.sql balances
in both currencies. Screenshots of the Convert step at 390 and 1440.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod + documentation/database/finance/* with the table and
the doors; the M5 (c), (d) markers removed only for what runs (the switch stays off); the
DESIGN_SYSTEM.md tier-1 list.
HOT: 00001240, 00002510, live-wallet.ts, WalletDialogs.tsx (never beside UI3 or UI5).
```

### DB20 — Team splits below Pro and departed finders (M10 (a))

```text
PROMPT DB20: A team below Pro falls back to Co-op, and a departed finder is not paid

ROLE: Postgres engineer.

CONTEXT: FA A19 (FCA: a downgraded team keeps applying its Pro template, and a finder who has left
is still paid); FA (f). Decision #337, ruling M10 (a): at its next release a team without the
template's entitlement falls back to co_op, and a finder who is no longer an active member gets
nothing: the finder's cut returns to the split. M10 (b) is built (org.fn_rebalance_departed_stake);
M10 (c) is #252's (per-engagement contribution agreements, no nested_split_rules key).

FILES: supabase/migrations/00001200_functions_finance_core.sql (fn_team_split_plan :106);
00001220_functions_finance_billing_entitlements.sql (the split_template_<type> entitlement read it
reuses); supabase/probes/team_split_properties.sql (extend);
documentation/database/finance/Functions.md; finance-model.md §5 (remove M10 (a)'s marker).

STEPS:
  1. At release, read the active template. If the team's plan lacks split_template_<type>, plan
     the release as co_op with the rule's vault cut. Nothing is written to split_rules: the stored
     rule stays as history, and an upgrade restores it.
  2. A finder's fee pays only an active member at release; otherwise the cut joins the members'
     split. Dust still goes to the vault.

ACCEPTANCE: team_split_properties.sql: a Team Free team with a stored finder template releases as
co_op; a departed finder gets 0 and the split still sums to the release less the fee; an upgraded
team pays its finder again. finance_invariants.sql and conservation_identity.sql pass. Readiness:
closes PRD-F13 with DB13.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; documentation/database/finance/Functions.md; the
finance-model.md §5 marker removed.
HOT: 00001200 (never beside PM-WP4).
```

### DB21 — Refunds a buyer or provider can start (M8)

```text
PROMPT DB21: Refunds a buyer or provider can start: an undelivered or defective product, and a
forfeit given back

ROLE: Ledger engineer.

CONTEXT: FA CO25; FDD D-12. Decision #337, ruling M8: no refund on a digital product after its
first download, except for non-delivery or a defective file, through a dispute, recovered from the
seller's pending row (M3's order); a provider may refund a session forfeit voluntarily
(finance-model.md §4).
Read from the ruling's wording: before the first download, a buyer may cancel the line.
DB6 has landed (#532: `on_hold` keyed by `pending_releases.hold_chargeback_id`). DB19's line states have landed (3041e5ef, #511: the line writer is
finance.fn_record_order_line_refund, called by fn_refund_escrow_to_payer). CK1 has landed (#488,
322c4dc9) and is the buyer's download path. Judge "downloaded" by ruling A8: the first completed
delivery of any file of the line, read from catalogue.entitlements.first_delivered_at. Do not rely
on files.download_events.item_id, which cascades on a hard purge (#488 (f)). The refusal stays
behind finance.delivered_refund_refusal (00005001, off until counsel), and cancel_order_line reads
it. A cancel or a buyer win also sets the line's entitlement to 'refunded', so
/api/downloads/[entitlement]/[fileId] answers 404. The buyer's order view is /checkout/orders
(CK3, f3ba4c3b).

A product dispute after the seller's money has cleared (ruled: Decision #470, A): a product dispute
may be opened only while the sale is still clearing (7 days), which is also when the seller's money
can be held; the order page says so. M3's "cleared money is never clawed back" holds.

FILES:
  - supabase/migrations/00000017_tables_finance.sql (an order-line subject on the dispute table
    F1260 uses, in place). Reuse PROJECTS EX2's dispute subject (finance.disputes.subject_kind,
    with order_line reserved for this prompt) and add no second subject column; if this prompt
    runs first, EX2 adopts its column instead. One design either way.
  - supabase/migrations/00001260_functions_finance_disputes.sql (open_order_line_dispute; the
    refund on a buyer win)
  - supabase/migrations/00001240_functions_finance_money_movement.sql (cancel_order_line before a
    download; refund_session_forfeit) + 00002510
  - catalogue.entitlements (read first_delivered_at; write the line's entitlement → 'refunded');
    finance.delivered_refund_refusal (read, never switched on)
  - packages/backend/services/finance/{OrderBackendService.ts, DisputeBackendService.ts}; the
    buyer's order view, /checkout/orders (a tier-5 "Cancel" before a download, "Report a problem"
    after); the
    provider's session view (a tier-5 "Refund this forfeit"); the types
  - supabase/probes/product_refunds.sql (new)
  - finance-model.md §4 and §15, PRODUCT_SPEC.md §Orders, Refunds & Promo Codes and §Sessions (the
    markers), PRODUCT_MANAGEMENT.md §3.5 (the line states), documentation/database/finance/*

STEPS:
  1. cancel_order_line(p_line): a member of the buying account, a download line whose entitlement
     has no first_delivered_at, and the seller's row still pending. The buyer gets the
     line's paid amount back at once ('order_refund'), the seller's pending row shrinks by its
     credit, and the platform's fee on the line is reversed. The line reads cancelled (DB19).
  2. open_order_line_dispute(p_line, p_reason, p_evidence): non-delivery or a defective file, within
     the ruling's window. It freezes the seller's pending row for the line (on_hold, DB6); the
     operator desk rules it through the existing ruling flow; a buyer win refunds as step 1 does,
     from the frozen row.
  3. refund_session_forfeit(p_escrow): the forfeit's payee gives back what the forfeit paid them,
     from their pending money first, then Available (it is voluntary, so cleared money is theirs to
     give). The buyer gets the forfeit back fee-free; the line reads refunded (DB19's writer).

ACCEPTANCE: product_refunds.sql: a cancel before any download refunds, reverses the fee and marks
the entitlement refunded; a cancel after a download is refused while delivered_refund_refusal is on
(set inside the probe); a dispute freezes and a buyer win recovers from the frozen row; a
provider's forfeit refund reaches the buyer. finance_invariants.sql and conservation_identity.sql
pass. Screenshots of the order view's actions at 390 and 1440. Readiness: part of PRD-F12 (MR3
completes it; USER_FLOWS MK-31).

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod + documentation/database/finance/*;
PRODUCT_MANAGEMENT.md §3.5; the M8 markers removed for what this builds.
HOT: 00001240, 00002510, apps/web/features/checkout/** (the #243 peers).
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
finance.v_ops_unledgered_payments (00003004:246) lists settled payments with no ledger credit, and
the settlement_mismatch / business_archived payments awaiting a human (SA §Stripe, #200). #457 (b)
adds captured payments whose engagement was refused. Each of these needs a card refund, and none
has a door. DB16 (/admin/ledger, 85e7d4e4) and DB19 (3041e5ef) have landed; it needs DB21.

Who may start a card refund (ruled: Decision #464, A): operators only, from /admin, for (i) a
payment on v_ops_unledgered_payments and (ii) a top-up that support agrees to return while the
wallet still holds it. Payers withdraw to their bank as today. The gate is security.is_admin() plus
a sign-in within the last 10 minutes (the token's amr, org.fn_session_signed_in_at() as #450 uses),
until MFA step-up (PRD-C17) replaces it. Read #464's FLAGS (a)-(d) before you build. The
refund-destination question for counsel is FOUNDER_QUESTIONNAIRE.md Part E2.13 (LEGAL_COMPLIANCE
LG2, #528); MR7's Part D does not hold it.

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
  1. The ruling (above): nothing to ask.
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
of the dialog at 1440 and 390. conservation_identity.sql passes.

SAME CHANGE: Zod + database docs; PRD-F12 narrowed. F12 flips to ✅ only once DB21 has landed too.
USER_FLOWS MK-31's operator half; both scoreboards; one Score history line.
HOT: 00001230 + stripe-webhook.ts (never beside SBP S4 or DB9), 00000017, 00002510.
```

### MR5 — The Stripe balance matches the ledger (PRD-F8)

```text
PROMPT MR5: An external reconciliation: what Stripe holds, matched line by line and in total
against what the ledger says it should hold

ROLE: Payments architect + ledger engineer.

CONTEXT: FA L6; SYSTEM_ARCHITECTURE.md §Stripe says no reconciliation against the Stripe balance
is built; finance-model.md §15 calls it an ops job. Why it can't wait for PROD: every internal check
(fn_reconcile_wallets, DB16's identity) compares the ledger with itself. A missed or mis-applied
webhook, where Stripe holds money the ledger never recorded or the reverse, is invisible to all of
them. Only an external check sees it.
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
DB16's terms have landed (85e7d4e4). It needs DB9 (the settlement currencies) and MR3 (card
refunds).

Taking L6 out of Planned (ruled: Decision #460, A): build it now, read-only and independent of the
journal (MR8). It needs only the Stripe API and DB16's terms, and it is the one check that catches
a lost webhook. The owner also ruled that MR5 waits for DB9 and MR3: re-verify each at HEAD before
you build, and stop if one has not landed.

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
  - finance-model.md §15, SYSTEM_ARCHITECTURE.md §Stripe (replace "not built"), this file's §0.6,
    FA L6's status, documentation/database/finance/*, Zod row schemas

STEPS:
  0. The ruling (above): nothing to ask.
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
     A non-zero gap writes one ops.log_entries error (scope finance.stripe_reconciliation); MR4's
     finance.* error rule already routes it (#507).
  4. Connected accounts, bounded: only accounts with a payout in flight or a failed bank payout.
     Compare balance.retrieve (stripeAccount) with what the ledger says sits there (M9).
  5. Nothing is ever corrected. An operator resolves an item with a note.
  6. A run records livemode. A test key reconciles test mode only (core/stripe.ts already refuses a
     live key outside production).
  7. Prove it against the real TEST-mode account, read-only, with the .env.local test key. Attach
     the run's figures.

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
MW-62; both scoreboards; one Score history line.
HOT: 00000017, 00001230 (never beside SBP S4 or DB9), 00003004, 00005060, 00002510,
stripe-rails.ts.
```

### MR8a / MR8b — The shadow double-entry journal (PRD-F16)

```text
PROMPT MR8a: The shadow double-entry journal — accounts, entries and the primitives that write
them

ROLE: Ledger architect.

CONTEXT: The ledger is single-entry with materialised balances (00001200:44, :148). Ruling M2 B:
"shadow double-entry written by every money definer once live money passes a pilot, an enterprise
asks for an audit trail, or an auditor or regulator does." System wallets are not materialised
(ruling M2; DB8 removed 'system' from WalletOwnerType, #538), so system accounts live in the journal,
never in finance.wallets. It needs MR5, a hard WAIT (#463 (a)); DB16 has landed. MR8b follows it.

Ruled (Decision #463, owner, 2026-11-18: A · A): a public launch IS "live money past a pilot", so
the journal is built before PROD (a journal added after live volume must be rebuilt from
single-entry rows, which DB16 showed cannot tell cash from credit without the event tables). It is
written inside the money primitives and the doors that move money without a wallet leg (escrow hold
and release, fees, chargeback loss, settlement, conversion): one balanced entry per movement in the
same transaction, as M2 says ("every money definer"), never an AFTER INSERT trigger on
finance.transactions.

FILES (MR8a): 00000017 (finance.journal_accounts: code, currency, kind, system; finance.
journal_entries: occurred_at, source_kind, source_id, idempotency_key, transaction_id;
finance.journal_lines: entry, account, wallet_id, debit_minor, credit_minor, exactly one of them
> 0); 00001830 (append-only, plus a DEFERRABLE constraint trigger: Σ debit = Σ credit per entry per
currency at commit); 00001200 (fn_wallet_credit, fn_wallet_debit, fn_wallet_credit_pending and
the escrow hold and release write entries); 00003004 (finance.v_trial_balance per currency);
supabase/seeds/gen/emit-finance.ts (the seed goes through doors since DB16, so the journal fills
itself; regenerate 07_finance.sql); probes journal_balance.sql (new);
documentation/database/finance/*, finance-model.md §6, SYSTEM_ARCHITECTURE.md (Integration
Blueprints: B built).

THE CHART (per currency; refine it in the change and document it): stripe_platform_cash ·
connected_in_transit · wallet_liability (one control account, with a subledger by wallet_id) ·
escrow_liability · pending_liability · fee_revenue · fx_spread_revenue · stripe_fees ·
platform_loss · fx_position.

STEPS (MR8a):
  0. The ruling (above): nothing to ask.
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
     Each gap writes ops.log_entries (scope finance.journal), which MR4's pipeline routes.
  3. /admin/ledger: a trial balance per currency.

ACCEPTANCE: journal_balance.sql extended to every door; conservation_identity.sql and every other
finance probe stay green; the seed's trial balance nets to zero.

SAME CHANGE (MR8b): PRD-F16 ❌ → ✅; the M2 B markers in finance-model.md §6 and SA; both
scoreboards; one Score history line.
HOT: every finance SQL file. Nothing else runs in the SQL lane beside MR8a or MR8b.
```

---

## 4. Phase 2 — Fat services & thin route controllers

### SV5 — Currency honesty: one exponent SSOT, estimates marked, nothing dropped

> **Status 2026-11-23:** step 1's one list landed in `1d8fc3e6` (Decision #435: `currencyExponent`
> in `packages/types/finance/wallet.ts`, mirrored by SQL `finance.fn_currency_exponent` and pinned
> by `fx-conversion.test.ts`); step 1's contract test and steps 2–6 below are open.

```text
PROMPT SV5: Every converted figure says it is an estimate, and no currency silently disappears

ROLE: Backend + types engineer.

CONTEXT: FA C10, C13 (P0), C6, C9, C11, C12 and C20; FCA N33 (the personal "spent this month"
converts each row, then sums). Decision #337, ruling M5 (f): every converted figure carries a
staleness mark. It no longer waits for DB8 or DB9: fn_currency_exponent exists (#435), and
settlement_currencies is seeded (#423), so step 5's narrowing can run before DB9's SQL refusal.
C13 is the point, and PRD-F20 is UAT-gated, so this runs in Wave 2: wallet-scope.ts still skips a
currency that has no rate (PRD-F20 cites :324).

FILES:
  - packages/types/finance/{wallet.ts (:1362-1407 the exponents and formatMoney), common.ts (:27),
    fx.ts (:35, :259-306)}; packages/types/catalogue/catalogue.ts (:147)
  - packages/ui/display/core/currency-store.ts (:99-122) + a DESIGN_SYSTEM.md §C.1 note if its API
    changes
  - packages/types/finance/currency.contract.test.ts (new: the TS list = the UI list = the SQL list
    parsed from 00001200's fn_currency_exponent)
  - packages/backend/services/finance/{FxService.ts (:118, :162-171), commerce-money.ts (:96-184),
    wallet-scope.ts (:265-300), live-wallet.ts (:137-139, :478-481, :483, :805, :809, :1732),
    stripe-rails.ts}
  - packages/types/finance/wallet.ts view types (an Aggregate: {minor, currency, estimated, asOf,
    stale, excluded[]})

STEPS:
  1. C10, the rest: currencyExponent (#435) is the one list. The UI store imports it if
     packages/ui may depend on @projective/types (check packages/ui/CLAUDE.md); otherwise it mirrors
     it, and currency.contract.test.ts pins the TS, UI and SQL lists to each other.
  2. C13: aggregates (the hero total, Available, analytics sums) return estimated: true when any
     currency was converted, asOf (the oldest rate used), stale (any rate older than 24 h) and
     excluded (currencies with no rate). Never drop a currency silently; never sum mixed currencies
     without estimated = true.
  3. C6, C9: FxService carries stale and the provider to every converted figure and reads the newest
     rate per quote (DISTINCT ON), not .limit(500).
  4. C12: commerce-money formats in the viewer's locale (the request's resolved locale) and shows
     every origin's rate at 4 significant figures, not 4 decimal places.
  5. C11: one toStripeAmount(minor, ccy) with tests: amounts in 3-decimal currencies rounded to a
     multiple of 10; ISK and UGX follow Stripe's 2-decimal API rule. Listing currencies narrow to
     settlement_currencies (seeded, #423).
  6. N33: "spent this month" sums per currency, then converts once.

ACCEPTANCE: the contract test is green; unit tests for an aggregate with an unconvertible currency
(it appears in excluded, and the hero total says so), a stale rate, the NGN rate label,
toStripeAmount (KWD, JPY, ISK, GBP) and N33's order of operations. Readiness: closes PRD-F20 with
UI5 (USER_FLOWS MW-01).

SAME CHANGE: Zod with the Aggregate; DESIGN_SYSTEM.md §C.1 with any packages/ui API change.
HOT: live-wallet.ts / wallet-scope.ts (RED WP2 / WP11 wait for this), the checkout services
(commerce-money.ts), packages/ui.
```

### SV7 — Seller-side refusals and the roster's payout readiness (N12, M4)

```text
PROMPT SV7: A seller's missing verification reads as the seller's, and a team roster shows who is
payout-ready

ROLE: Backend + frontend engineer.

CONTEXT: FCA N12 (no finance service maps payout_not_ready; checkout maps every PK403 to
verification_required, so a seller-side refusal reads as the buyer's own). Decision #337, ruling M4:
a team invite shows each invitee's readiness on the roster, and the refusal stays at accept (built).
PRODUCT_SPEC §Escrow 5: "Whoever is refused is told who has to act, and is linked to Settings →
Verification when it is them." DB15 built the refusals (HINT 'seller' at booking, 'self' or
'team' at publish and paid calls), and PayoutGateActor already carries 'seller'.

FILES:
  - packages/backend/services/finance/checkout-refusal.ts (+ test): payout_not_ready with HINT
    'seller' → a 'seller_unavailable' blocker (buyer copy: this seller can't take payments yet; the
    item stays in the basket), reusing packages/backend/core/payout-gate.ts payoutNotReadyRefusal
    for the self and team cases
  - packages/types/finance/checkout.ts (the blocker code)
  - the listing editor's publish action (grep set_listing_status's caller): "Verify to publish",
    linking to Settings → Verification when the actor is the one to act, and naming a team's
    unready members by handle
  - packages/backend/services/workspace/live-roster.ts (+ types and test): payoutReady per member
    and per pending invite, a boolean read server-side from finance.fn_freelancer_payout_ready (no
    other verification detail is exposed); the roster component shows it as inline MetaLine text
  - only if the boolean needs SQL: a STABLE definer read in 00001210 with its grant in 00002510

STEPS:
  1. The checkout mapping (self · team · seller).
  2. The publish refusal's copy and link.
  3. The roster read and its MetaLine, on both members and pending invites.
  4. finance-model.md §10 and PRODUCT_SPEC.md §Escrow 5: remove the roster half of the M4 marker.

ACCEPTANCE: refusal-mapping unit tests (self · team · seller); a roster read test; screenshots of
the publish refusal and the roster at 390 and 1440.

SQL SESSION (only if the definer read is added): run probes with `deno task test:probes`; at most 2
SQL sessions at once on the one local DB, on disjoint migration files, each reset announced first;
finish with your own clean `deno task test:probes:fresh`.
SAME CHANGE: Zod with the blocker code and the roster fields; the M4 roster marker removed.
HOT: the checkout services; 00002510 if the read is added.
```

### SV8 — A failed bank payout reaches whoever can fix it (M9)

```text
PROMPT SV8: A failed bank payout reaches whoever can fix it, and the wallet says so until it is
fixed

ROLE: Backend engineer, plus one small SQL edit.

CONTEXT: FDD X20. Decision #337, ruling M9 (⚖️ pending counsel; the as-built behaviour of #202 (a)):
the money stays in the connected account's Stripe balance, Stripe pays it again once the bank
details are fixed, and the owner is told; finance-model.md §8 already describes it. What is left:
record_bank_payout notifies only a PERSON owner, so a team's or business's failed bank payout tells
nobody; nothing on the wallet keeps saying so while it is unresolved; and the notice links to
/wallet/payouts, which lands on Upcoming, not on the payout details. This changes no money path, so
it needs no flag; if counsel reverses M9, the return-to-wallet path is a new prompt.

FILES:
  - supabase/migrations/00001240_functions_finance_money_movement.sql (record_bank_payout: on a
    team, business or enterprise account, notify the owner and every member holding withdraw): HOT
  - supabase/migrations/00005010_seed_notification_catalog.sql (payout.failed's action_url → the
    payout details in Settings → Verification & payouts, or the business's payout page for an
    entity)
  - packages/backend/services/finance/live-wallet.ts (payoutBankFailed: a payout whose bank_status
    is failed and that no later bank payout re-paid); packages/types/finance/wallet.ts
  - the wallet overview's notice slot: one InlineNotice (a required disclosure) with a tier-5 link
    to the payout details. Copy states facts only: "Stripe couldn't pay your bank. Update your
    payout details and Stripe will send it again."
  - supabase/probes/payout_lifecycle.sql (extend)

STEPS:
  1. The fan-out in record_bank_payout, idempotent on the event as today.
  2. The action_url.
  3. The flag, the notice and its link; the notice goes when a later bank payout re-pays it.

ACCEPTANCE: payout_lifecycle.sql: a team account's failed bank payout notifies the owner and each
withdraw holder once; a replay notifies nobody again. A unit test for payoutBankFailed; a screenshot
of the notice at 390 and 1440. Readiness: closes PRD-F11 (USER_FLOWS MW-16).

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod with the wallet flag; documentation/database/finance/*
and database/comms docs for the catalog row; finance-model.md §8 only if its wording changes.
HOT: 00001240 (so it runs in the SQL lane), live-wallet.ts.
```

---

## 5. Phase 3 — Islands & design-system alignment

### UI1 — Wallet stylesheet gates

> **Status 2026-11-23:** D6 (solid selection) and D11 (a `data-motion` twin for every reduced-motion
> block, in all eight sheets) landed before this prompt ran and must stay; steps 1–8 below are open
> (no high-contrast block in `wallet-tokens.css`, no `@supports not (backdrop-filter)`, no
> `wallet-contrast.test.ts`).

```text
PROMPT UI1: wallet/styles pass every §3 gate, the licensed aurora included

ROLE: Design-system engineer (CSS).

CONTEXT: FA D1, D2, D3, D4, D8, D9, D10 and D21-D25 (FCA §5: D6 and D11 are fixed; D23 is
unverified). Decision #337, ruling E3 FA (l): the owner keeps the aurora violet for reserved funds
(not the --help ramp role). FA (k): DESIGN_SYSTEM.md:1944 still cites the deleted
wallet-overlays.css:28.

FILES: apps/web/features/wallet/styles/*.css; apps/web/features/wallet/core/aurora-*.ts only if the
high-contrast static switch belongs there; apps/web/features/wallet/core/wallet-contrast.test.ts
(new); documentation/design-system/DESIGN_SYSTEM.md (the Wallet exception: the high-contrast and
static-ground rules, the reserved-funds violet licence; the :1944 citation).

STEPS:
  1. D1: a :root[data-contrast="high"] block in wallet-tokens.css: an opaque --wlt-hero-ink-soft, a
     stronger --wlt-glass-edge, opaque glass fills, and the aurora forced to the static ground.
  2. D2: hero ink ≥ 4.5:1 at every stop under the pill and the top row, in light and dark. The test
     computes it from the token values with packages/ui's luminance maths and fails under 4.5.
  3. D3, as ruled: --wlt-fund-reserved stays the aurora violet. Give it dark and high-contrast
     values that keep it ≥ 3:1 against its region, and write the licence into the Wallet exception
     paragraph (Decision #337, ruling E3 FA (l)).
  4. D4: @supports not (backdrop-filter) fallbacks for .wlt-pill and the corner tools.
  5. D8: every tint is an opaque color-mix against the region tone or a §B.4.2 *-tint token; no
     `transparent` operand outside the licensed glass veils (wallet-ledger.css:212 and
     wallet-tools.css:253 today).
  6. D9: no opacity on text-bearing elements; dim marks only. D10: spacing first, one hairline per
     group.
  7. D21-D25 (verify D23 first).
  8. FA (k): re-point DESIGN_SYSTEM.md:1944 to the sheet that now holds that rule.

ACCEPTANCE:
  - grep -n "transparent)" apps/web/features/wallet/styles/ → only the licensed glass and veil
    tokens, listed in the commit message.
  - Every rule inside a prefers-reduced-motion block has a :root[data-motion="reduced"] twin. The
    block count differs from the selector count by design: check rule for rule.
  - The contrast test is green; screenshots of the hero in light, dark, high contrast and reduced
    motion at 390 and 1440.

SAME CHANGE: DESIGN_SYSTEM.md's Wallet exception paragraph with D1, D2 and the violet licence.
HOT: the wallet stylesheets (UI1 runs before the other UI prompts), DESIGN_SYSTEM.md.
```

### UI2 — WalletHome and dialogs: honest gates, PDFs, money-verb tiers, focus

> **Status 2026-11-23:** step 3's D16 landed with #331 (CSV is an icon ghost); steps 1–2, the rest
> of step 3 and steps 4–6 below are open (`WalletHome.island.tsx:523` still computes `canDecide`; no
> statement or bill has a PDF action).

```text
PROMPT UI2: The island acts on what the server decided, and amber marks the money verbs

ROLE: Frontend engineer (Preact signals).

CONTEXT: FA V6, R10, R11, D17, D19, D24 and M2 (FCA §5: D16 was fixed by #331; D18 is ruled in
DESIGN_SYSTEM: Save card and Approve stay tier 3, as configuration and authorisation commits); FCA
N15 and N32. Decision #337, ruling E3 D-13 (A): the wallet lane's Top up becomes tier 1 (accent);
the hero pills stay glass (the #122 licence); amber marks every act that starts or commits a money
flow, which rules #157 flag (j) the broad way. SV2 has landed (d4c4a194); run it after UI1 (the
sheets).

FILES:
  - apps/web/features/wallet/islands/{WalletHome.island.tsx (:306-409 effects, :523 canDecide),
    WalletLane.island.tsx (:261-284)}
  - apps/web/features/wallet/components/{WalletDialogs.tsx (:453, the hand-dressed back link),
    InvoicesPanel.tsx, LedgerRow.tsx, LedgerFilters.tsx, UpcomingList.tsx}
  - packages/ui: fields/components/Button.tsx (an href mode) and
    navigation/components/LaneChrome.tsx (LaneCreateButton gains an accent mode), each with its
    DESIGN_SYSTEM.md §C.1 row
  - documentation/design-system/DESIGN_SYSTEM.md §B.8 (the tier-1 test: flag (j) ruled; "Where tier
    1 renders today" adds the wallet lane's Top up) and F.3 (rewritten as shipped by #331 and ruled
    by D-13)
  - tests: apps/web/features/wallet/core/wallet-home.test.ts, wallet-intent.test.ts

STEPS:
  1. V6: Review renders if and only if approval.decidable; the client capability maths at :523 goes.
  2. R10: a tier-5 "PDF" row action for each statement or bill with a pdfHref. Receipts and PDFs
     download through fetch → saveBlob (as the CSV export does); a refusal shows the InlineNotice
     copy, never raw JSON.
  3. Tiers: D17 Show N more → tier 4 neutral outlined.
     Save card and Approve stay tier 3 (DESIGN_SYSTEM "Commits that stay tier 3"). D19 Back to
     checkout → the Button href mode.
  4. D-13: the lane's Top up → tier 1 (LaneCreateButton's accent mode); Withdraw stays tier 4; the
     hero pills stay glass. N32: a locked Top up's accessible name carries its lock reason, as
     Withdraw's does.
  5. M2: a dialog opened from ?do= or a Stripe return focuses its heading (Dialog initialFocus), and
     focus returns to the control that opened it on close.
  6. D24: the effects that mirror a signal become computed() / effect().

ACCEPTANCE: unit tests for the decidable render; screenshots of /wallet/invoices with PDF actions
and of the lane footer (one amber control); a forced 403 PDF shows the notice; one filled control
per decision region.

SAME CHANGE: DESIGN_SYSTEM.md §C.1 rows for the Button and LaneCreateButton changes; §B.8 and F.3.
HOT: WalletDialogs.tsx / WalletHome.island.tsx, packages/ui, DESIGN_SYSTEM.md. RED WP4 waits for
this prompt.
```

### UI3 — Recurring rules, pots and locked automation in the wallet (M6)

> **Inputs from DB5 (2026-11-12):** `POST /api/wallet/action` takes `save_pot`
> (`SavePotInputSchema`: create, rename, re-weight, goal, `archive`) and `move_pot`
> (`MovePotInputSchema`: `in` / `out`). `WalletOverview.potActions` lists the ones the viewer may
> take, and `WalletPotView.goal` carries the goal; archived pots are not read. The doors already
> accept both; only the surface keeps `pots_not_running` (copy: "Pots set money aside as income
> clears, but they can't be changed here yet."), so lifting it is `actionsFor`'s
> `locked.push("pots_not_running")` line plus the copy. **Also yours (the read was left as it
> was):** the wallet read's Available is still the whole balance (`wallet-scope.ts` `availableOf`,
> the hero, the switcher, the allocation meter). It must become balance − Σ active pots, with an
> Earmarked figure beside it, and capital must still sum. Checkout's "wallet covers"
> (`commerce-owner.ts`) also reads the whole balance: a covered order whose pots hold the difference
> is refused `PF402` `earmarked` at the door. Until UI3 ships, only the seeded pots exist.

```text
PROMPT UI3: Upcoming rows act; pots become real; locked automation says why

ROLE: Frontend engineer.

CONTEXT: FA A13 (the UI half), A3, D7, A14 and A6; FCA R13 (no wallet dev axes); FA CO29. Decision
#337, ruling M6: lock each control until its engine runs; a pot is an earmark (Available ·
Earmarked). SV3 (the actions and locks, fdeb3018) and DB5 (the pot doors and actions, bc35b27b)
have landed.

FILES: apps/web/features/wallet/components/{UpcomingList,AccountRail,WalletDialogs}.tsx;
apps/web/features/wallet/core/{wallet-home,wallet-state}.ts;
apps/web/features/wallet/styles/{wallet-accounts,wallet-dialogs}.css; apps/web/features/devtools/*
and apps/web/utils/dev-seam.ts (the axes below); finance-model.md §13 (the pots lock note).

STEPS:
  1. Each recurring row in Upcoming gets an ActionMenu (tier 5): Pause or Resume · Change amount ·
     Remove, each present only when offered. Change amount opens ConfigDialog in place (replace,
     never stack); its copy says the rule then charges the editor's own card.
  2. Pots: the tax-pot tile becomes a link that opens a Pots dialog (the list, allocation %, balance
     and goal progress with ProgressBar). Save pot and Move funds are tier 3: an earmark moves no
     money between accounts, so it is a configuration commit, like the payout schedule. The rail
     shows "Available · Earmarked" as MetaLine text in tabular-nums. The static pot box goes (D7).
     SV3's 'pots_not_running' lock lifts, and finance-model.md §13's lock note goes.
  3. Locked automation: the Income Smoother's enrolment opens LockedDialog with SV3's reason copy.
     There is no savable control. (DB4 has merged, so the scheduled payout modes are not locked.)
  4. Dev Context Switcher: walletVerification (unverified · pending · verified-not-ready · ready)
     and walletProcessor (up · down), applied to the viewer in resolveWalletContext under the dev
     seam:
     DevOverrides + DEV_DEFAULTS, DevOption list, DevContextPanel control, reflect() set AND delete.

ACCEPTANCE: each axis value renders the matching lock or none; screenshots of the Pots dialog at 390
(bottom sheet) and 1440; one filled button per dialog footer.

SAME CHANGE: the Dev Context Switcher axes in full; the finance-model.md §13 pots marker removed.
HOT: WalletDialogs.tsx (never beside UI2, UI5 or DB18), features/devtools + dev-seam.ts (SBP S4, S6;
IDG F6). RED WP4 waits for this prompt.
```

### UI4 — Ledger, analytics and charts: tabular, accessible, shape-coded, expandable

```text
PROMPT UI4: Every figure tabular, every series distinguishable without colour, and an Expand

ROLE: Frontend + data-viz engineer.

CONTEXT: FA D12-D15, D20 and D26; FA §4.4. Decision #337, ruling E3 FA (h): an optional Expand opens
one Dialog; there is no /inspect for finance documents. Decision #341, ruling E3 Q3: focus rings are
not ruled yet, so #245 (a) and the FA D20 allocation-ring exception stand until the owner's design.

FILES: apps/web/features/wallet/components/{LedgerRow,AnalyticsView,CashFlow,FlowAreaChart}.tsx;
apps/web/features/wallet/styles/{wallet-ledger,wallet-analytics,wallet-flow,wallet-meter,
wallet-sheet}.css; packages/ui display charts only if AreaChart's ticks lack tabular-nums (then fix
it there, with a §C.1 note).

STEPS:
  1. D12: the ledger status is a Tag severity (a lifecycle status, so a container is allowed), not
     the hand-rolled .wlt-status; method, category and counterparty are MetaLine text.
  2. D13: the release-schedule pips get the meter's hatch and ring shape channel; legends name the
     encoding.
  3. D14: tabular-nums on .wlt-chart__when, the ledger dates, the FX rate, the hero meta and every
     SVG tick (each <text> gets font-variant-numeric through a class).
  4. D15: a wlt-section__count that holds a label becomes meta text; the viewer's locale replaces
     the hard-coded en-GB.
  5. D20: leave the allocation term's ring as it is (#341, ruling E3 Q3); add no ring anywhere.
  6. D26: .wlt-textlink's ink ≥ 4.5:1 in light mode at --text-sm, else the link token.
  7. FA (h): a tier-5 "Expand" on the cash-flow chart and on the ledger opens one Dialog (replace in
     place) hosting the same AreaChart or DataTable at full width; no /inspect hand-off.

ACCEPTANCE: a Playwright evaluate shows that every element inside .wlt-* whose text matches /\d/ has
tabular-nums; axe-core shows zero serious issues on /wallet/analytics; screenshots of the Expand
dialog at 390 (bottom sheet) and 1440.

SAME CHANGE: a DESIGN_SYSTEM.md §C.1 note if packages/ui charts change.
HOT: the wallet ledger and analytics sheets (after UI1).
```

### UI5 — Estimates, staleness and MoneyView on money surfaces (M5 (f), #341 E2)

```text
PROMPT UI5: Converted money reads as an estimate with its rate date, and every figure is a MoneyView

ROLE: Frontend engineer.

CONTEXT: FA D30 and C13 / C6 (the render side); FCA N10 (money rendered without MoneyView: Buy Now's
nine figures, FundStageDialog, WalletDialogs' review, headline and done figures, the line detail's
"Original"). Decision #337, ruling M5 (f): a staleness mark on every converted figure. Decision
#341, ruling E2: a MoneyView for every visible figure; strings only in aria and sentences. The
app-wide lint ban is the optimisation track's (RED WP7), after this prompt. Depends on SV5 (DB17's
feed landed, #539). Check git status first: peers may be editing apps/web/features/checkout/** (Decision #243).

FILES:
  - packages/ui display MoneyView (an estimate mark and a rate-date MetaLine) + its DESIGN_SYSTEM.md
    §C.1 row
  - apps/web/features/wallet/components/{WalletHero,AccountRail,AnalyticsView,WalletDialogs}.tsx
  - apps/web/features/checkout/components (the order summary and settlement lines),
    BuyNowModal.island.tsx (:380-618); the payments feature's FundStageDialog and
    packages/backend/services/finance/stage-funding.ts (:48-50)
  - finance-model.md §11 (the staleness half of the M5 (f) marker)

STEPS:
  1. A figure with estimated = true renders "≈" before it and a MetaLine "at rates from <date>"
     (tabular-nums); a stale one says the rate is stale; excluded renders "Excludes JPY · KRW" as
     Meta text, never a chip.
  2. N10: every money figure on those surfaces goes through MoneyView with its origin.
  3. Remove the staleness half of finance-model.md §11's M5 (f) marker (DB17 removed the feed half).

ACCEPTANCE: screenshots of the checkout summary with a converted line, and of the wallet hero with
an excluded currency and a stale rate, at 390 and 1440, in light, dark and high contrast.
Readiness: completes PRD-F20 and PRD-F21.

SAME CHANGE: DESIGN_SYSTEM.md §C.1 with the MoneyView change; the M5 (f) marker removed.
HOT: WalletDialogs.tsx (never beside DB18 or UI3), apps/web/features/checkout/**, packages/ui. RED
WP4 and WP7 wait for this prompt.
```

### UI6 — Checkout design gates and the commit's honesty (N28)

> **Status 2026-11-23:** steps 4–6 and step 1's press scale landed in `1d8fc3e6`, and step 3's
> accent in `8b63f2b0` (Decision #404); the rest of step 1, step 2, step 3's COMMITS entry (Buy Now
> is still missing from `checkout-commit-tier.test.ts`) and step 7 below are open. The style line
> numbers in FILES have moved: grep for `transparent)` and `opacity`.

```text
PROMPT UI6: Checkout passes the design gates, and the commit names the exact charge

ROLE: Frontend engineer (CSS + islands).

CONTEXT: FCA N28 (translucent zebra rows, text opacity, kind labels as bordered pills, a boxed
static banner, a literal scale(0.99) press, a reduced-motion rule present only under the media
query), N9 (Buy Now's Pay is tier 3 and missing from checkout-commit-tier.test.ts), N11 (the
stepper's Details link loops), N26 (the payment step's backward 302 drops display and the sim* dev
axes) and N29 (Pay names the display estimate); FA D27 (PromoField's Apply) and D29 (translucent
fills). Decision #337, ruling E3 D-13: amber marks every act that starts or commits a money flow.
SV4 has landed (f691a0bb); run it after UI2. Check git status first (the Decision #243 peers).

FILES: apps/web/features/checkout/styles/{checkout-confirmation.css (:236, :612),
checkout-body.css (:509), basket-body.css (:378, :765-767, :811, :968-975, :2151-2153),
checkout-payment.css (:119-128, :330)}; apps/web/features/checkout/components/{PromoField.tsx (:97),
CheckoutStepper.tsx (:97-105), ConfirmPayDialog.tsx (:18-21, a stale comment, N30; :79),
OrderSummaryRail.tsx (:329)}; BuyNowModal.island.tsx (:623-631); checkout-commit-tier.test.ts;
apps/web/routes/(dashboard)/checkout/payment.tsx (:42-51); packages/ui MoneyView.tsx (:103, the
spoken rate's locale).

STEPS:
  1. N28 and D29: solid ramp tones and opaque tints; full ink; kind labels as inline meta text; the
     static banner unboxed; the reduced-motion rule mirrored under :root[data-motion="reduced"].
  2. D27: Apply → tier 4 neutral outlined.
  3. N9: add Buy Now's Pay (already severity="accent") to COMMITS in checkout-commit-tier.test.ts.
  7. Mobile: confirm on a 390 px screenshot that the price and Pay move, never duplicate (§3.10).

ACCEPTANCE: checkout-commit-tier.test.ts is green with Buy Now; screenshots of the basket, payment
and confirmation pages at 390 and 1440 in light, dark and high contrast; no `transparent` operand
and no literal scale in the checkout styles.

SAME CHANGE: DESIGN_SYSTEM.md only if a rule changes; ROUTING.md if the payment redirect's rule is
stated there.
HOT: apps/web/features/checkout/**, packages/ui (MoneyView: never beside UI5).
```

---

## 6. Phase 4 — Playwright E2E, visual regression & cross-track contracts

### E1 — Money lifecycle E2E: hold → pending (7 days) → available → payout, and the rulings

```text
PROMPT E1: apps/web/tests/e2e/wallet.spec.ts — the money lifecycle, end to end

ROLE: QA engineer. Use the existing harness (deno.json "test:e2e";
apps/web/tests/e2e/catalogue.spec.ts is the pattern: npm:playwright-core, Chromium from
E2E_CHROMIUM or the Playwright cache, waitUntil "commit", hydration retries). Do NOT run
`playwright install`.

CONTEXT: verifies the finance track against the rulings it built: Decision #337, rulings M1, M3,
M5 (f), M6, M7, M8 and E3 D-13, and the readiness series end to end. Runs after the SQL lane
(through DB21 and MR3) and UI2, UI3 and UI5. `deno task test:e2e` names a deleted spec
(landing-hero.spec.ts, PRD-K3): that fix is SUBSCRIPTIONS_BUILD_PROMPTS S8 step 9's; if it has not
landed, make it first, or E1 cannot run.

FILES:
  - apps/web/tests/e2e/wallet.spec.ts (new); apps/web/tests/e2e/_finance-fixtures.ts (new:
    service-role helpers that run ONLY when SUPABASE_URL is localhost or 127.0.0.1, and refuse
    otherwise)
  - deno.json (a test:e2e:wallet task with its $comment, mirroring test:e2e)
  - .claude/launch.json only if a dedicated port config is needed (name it web-wallet-e2e)

STEPS (seeded personas per documentation/database/Seed.md; the client pays, a payout-ready
freelancer is paid):
  1. Hold: the client funds a stage from the wallet (Fund → MoveDialog fund_escrow, a tier-1
     commit). Available drops by exactly the amount and an escrow is held (read through
     /api/wallet/overview, never the DB).
  2. Release: the client approves. The freelancer's credit shows as Pending, 7 days out (the
     Upcoming row and the ledger row's status Tag), net of ⌊amount × 500 / 10000⌋.
  3. Mature: the fixture backdates THAT pending_releases row's available_at to now() − 1 minute and
     calls finance.fn_mature_pending_releases() (service role, local only). Available rises and
     Pending falls by the same amount; the pot allocations (DB5) land.
  4. Payout: withdraw through the hero's Withdraw pill (MoveDialog withdraw), in Stripe test mode
     only (sk_test_ keys from .env.local; the harness refuses a live key). The payout row is pending
     and the ledger shows the debit; a signed test payout.paid event to
     /api/finance/webhooks/stripe (stripe.webhooks.generateTestHeaderString with the local whsec)
     settles it, and replaying it changes nothing.
  5. Negative paths: an unready freelancer sees the verification lock (the walletVerification
     axis); a foreign ?w= scope 303s with its notice; a spend-only team member never sees Review.
  6. Checkout: a capped promo from two browser contexts at once makes exactly one order (DB7); the
     same account's second use is refused before payment (DB19); a promo on a basket with a ticket
     line is refused before any PaymentIntent exists (SV4; check through the payments read, never
     Stripe); card pay in two tabs resumes the first payment (one charge).
  7. Currency: a user holding GBP and JPY wallets with display currency USD sees the hero total
     marked "≈" with its rate date, a stale rate marked as such, and JPY never silently missing
     (SV5, UI5).
  8. M3: while a release is Pending, a signed charge.dispute.created for its funding payment shows
     the payee's row On hold, and it does not mature; a won charge.dispute.closed returns it to
     Pending with its original date.
  9. M1: a product bought from an L1 seller credits the seller net of 8%, not 5%.
  10. M7: a bonus-bearing ticket holds amount + 10%; on-time work approved pays it; late work
      refunds it to the client, fee-free.
  11. M6: a threshold payout schedule runs once through its cron route (the local bearer) and makes
      one payout.
  12. D-13: the wallet lane shows exactly one amber control (Top up).
  13. Clean-up: everything runs on data the fixture creates (a fresh stage on a seeded project).
      The spec header says the suite writes to the shared local DB and must not run during a
      peer's db:reset.
  14. Readiness legs: an unclaimed service escrow refunds and pays nothing (MR1, #474); a brief's
      cancel settles its escrow first (MR2, #479); a silent client's delivery auto-approves
      (PM-GH1, once it has landed).

ACCEPTANCE: `deno task test:e2e:wallet` passes twice in a row after a fresh `deno task db:reset`
(announced to the other sessions first, like any reset).
SAME CHANGE: the deno.json task with its $comment; no rule or schema changes here.
```

### E2 — Visual regression matrix: aurora hero, sheets, the modal stack, checkout

```text
PROMPT E2: Wallet and checkout snapshot matrix across devices, themes, contrast and motion

ROLE: QA engineer. Depends on UI1-UI6 and E1's harness.

FILES: apps/web/tests/e2e/wallet-visual.spec.ts (new); baselines under
apps/web/tests/e2e/__snapshots__/wallet/ (committed PNGs, each under 300 KB); a deno.json task
test:e2e:wallet-visual.

STEPS:
  1. Matrix: viewports 1440×900 (desktop), 900×1200 (tablet) and 390×844 (mobile; the sheet) × theme
     light/dark × contrast normal/high (documentElement data-contrast="high") × motion
     normal/reduced (data-motion="reduced" + emulateMedia reducedMotion). Pages: /wallet,
     /wallet/transactions, /wallet/analytics, /wallet/invoices, and the checkout basket, payment and
     confirmation pages.
  2. Determinism: freeze the aurora (data-aurora="static" through the walletAurora dev axis), freeze
     Date with page.clock, mask live figures derived from now() with a locator mask, and wait for
     document.fonts.ready.
  3. Modal states: open each dialog kind (Locked, Move top_up, Convert, Config recurring, Pots, an
     AddCard stub without Stripe Elements, Line, Approval, the analytics Expand) and snapshot it.
     Then replace one dialog with another and assert that exactly ONE element matches the Dialog
     scrim selector (no stacked scrims, §B.10.9) and that focus is inside the new dialog.
  4. States worth a baseline: the On hold figure, the failed-payout notice, the stale-rate mark.
  5. Gate assertions per page (not snapshots): at most one filled button per [data-region] (a tier-1
     + tier-2 pair allowed); no computed backdrop-filter outside the licensed selectors; no region
     background with alpha < 1 outside the hero; every element containing a digit is tabular-nums;
     hero ink contrast ≥ 4.5:1 sampled from computed colours over the static ground; the :active
     transform is a scale, and none under reduced motion; axe-core zero serious or critical; inputs
     ≥ 16px at 390.
  6. Threshold: maxDiffPixelRatio 0.002; the update flag documented in the spec header.

ACCEPTANCE: the matrix runs green; the suite fails if UI1's high-contrast block is reverted for a
moment (verify, then restore).
SAME CHANGE: the deno.json task with its $comment; no rule or schema changes here.
```

### E3 — Paid consultations meet the finance contract (N2, after SCH-WP6)

```text
PROMPT E3: Paid consultations meet the finance contract

ROLE: QA + payments engineer.

CONTEXT: FCA N2 (P0: paid calls are bookable and auto-confirmable unpaid, with no host payout-ready
check); FDD X2, D-2. Decision #343, ruling C1 (= #337 D-2): the paid flavour is off now
(SCHEDULING_BUILD_PROMPTS.md SCH-WP2 interim), then Option C (SCH-WP6): one hidden Consultations
engagement per host on #211's 1-1 session rail, with the money held at request and refunded on
decline or expiry. Decision #337, ruling M4 (built, DB15): enabling paid calls needs a payout-ready host.
Build NONE of it here. This prompt checks FDD D-2's finance riders once SCH-WP6 has merged, and
sends any failure back to the scheduling track.

FILES: supabase/probes/paid_call_money.sql (new); one case in apps/web/tests/e2e/wallet.spec.ts if
E1 has landed.

STEPS (each an assertion in the probe):
  1. Interim: a paid request is refused paid_unavailable while the flavour is off.
  2. Hold at request: the requester's money leaves Available into a held escrow on the host's
     Consultations engagement; finance.escrows.project_stage_id stays NOT NULL (no Additive change).
  3. Decline or expiry: a full, fee-free refund, Available at once.
  4. Completion: settles as a 1-1 sitting — the 24 h review window, then 7 days Pending — at the
     PAYER's platform fee (#187), with no project, workload or Standing effect beyond the session
     rail's.
  5. paid_enabled is still refused for an unready host (built by DB15).
  6. finance_invariants.sql and conservation_identity.sql hold after each step.

ACCEPTANCE: paid_call_money.sql passes after a fresh db:reset; any failure is reported against
SCH-WP6.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: none beyond the probe (no rule changes here).
```

---

## 7. Last — Docs

### MR9 — Close §F: re-verify, re-score, hand off

```text
PROMPT MR9: Re-verify every §F row against the code, re-score, and list what only a human can
finish

ROLE: Readiness auditor. No code changes; only documentation/readiness/*, this file and the
decision log. Runs once at Wave 2's UAT checkpoint (step 1, UAT rows only) and again before Z1.

STEPS:
  1. For each PRD §F row (and at the Wave 2 UAT checkpoint, the UAT rows only): grep its evidence
     at HEAD, run the probes it names (deno task test:probes <name>) and finish with one clean
     deno task test:probes:fresh. Flip a status only with that evidence; correct any row a build
     session over-claimed.
  2. Recompute both scoreboards with the file's formula; add the §Score history line; bump
     **Last verified**; refresh the §Critical path lines for MVP, UAT and PROD.
  3. USER_FLOWS: re-verify MW-01, MW-11, MW-14, MW-16, MW-19, MW-27, MW-62, MK-09, MK-28, MK-31,
     PJ-31, PJ-41 and PJ-42, then re-score.
  4. In this file, do the closing duty for every prompt you find done (the §0.0 ledger) and bring
     §0.7's row map to the statuses you set.
  5. Final message: §F's score (old → new) and a table of what remains, with whose act it is:
     counsel (F15, M9, #435 (d)), the live Stripe run (F17), the hosted alert send (F9), hosted
     secrets (PRD-G6), and any 🧑 the owner deferred.
```

### Z1 — Finance docs sweep and the audits' status columns

```text
PROMPT Z1: Finance documentation sweep

ROLE: Documentation steward. Runs after every prompt above has merged, and after MR9's re-score
has decided the statuses: Z1 sweeps the docs; it does not score.

FILES: documentation/database/finance/*; business/finance-model.md; business/PRODUCT_SPEC.md
(Wallet, Funding, Payouts, Multi-Currency, Orders); PRODUCT_MANAGEMENT.md §3.5 (fund state, deposit
rule, payout schedule, pots, checkout order and lines, spend approval);
architecture/SYSTEM_ARCHITECTURE.md (Stripe, reconciliation, the env contract);
architecture/ROUTING.md (the wallet 303, /admin/ledger, checkout); design-system/DESIGN_SYSTEM.md
(§C.1, the Wallet exception, §B.8); architecture/FINANCE_AUDIT.md
(a Status column: "Fixed by <prompt> (<commit>)" or "Open — <owner>");
FINANCE_AUDIT.md (each X and D- item: built, or open with its prompt);
Decision #337's row (each ruling marked built with its prompt; re-check the index for a number
collision before any decision edit).

SPEC: rollup, not restatement (documentation/CLAUDE.md rule 2). grep every "**Not built yet**" and
"**Planned**" that cites Decision #337: each one left names its open prompt or its Planned owner. Do
not edit the root CLAUDE.md: the X4 / N31 persona fix is the owner's (the root `CLAUDE.md` edit `f1f10e31`);
report whether it has landed.

ACCEPTANCE: every function, trigger, view and job named in the DB, SV and MR prompts (those left
here, and the §0.0 ledger's at their Text at commit) appears in documentation/database/finance/*;
neither audit's status column has a blank cell; every #337 ruling reads built, open with an owner,
or Planned.
```

---

## Map of merged files

| Old place                                        | Went                                                                                                                      |
| :----------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| This file's §2 (F0) and the done DB, SV sections | done or superseded, §0.0                                                                                                  |
| `readiness/MONEY_BUILD_PROMPTS.md` header        | this file's header (scope) and §0.1 (the finance SQL lane)                                                                |
| MONEY §0 "What closes each §F row"               | §0.7 row map, with the flip rule                                                                                          |
| MONEY §1 run order and hot files                 | §0.1 waves, §0.2 and §0.3                                                                                                 |
| MONEY §2 readiness addendum                      | §1 standard header (Stripe, Readiness, the shared tree and the final message)                                             |
| MONEY §3 decision pack                           | all ruled: each ruling written into its prompt (§0.5 lists them)                                                          |
| MONEY §4 deltas for FBP prompts                  | folded into DB6, DB8, DB9, DB13, DB14, DB15, DB17, DB20, DB21, SV5, SV8, UI5, E1 and Z1; DB16's and DB19's dropped (done) |
| MONEY §4 delta for PM-WP1                        | dropped: PM-WP1 landed in `07d853f6`                                                                                      |
| MONEY §4 delta for PM-GH1                        | handed off to `PM_BUILD_PROMPTS.md` PM-GH1                                                                                |
| MONEY §4 delta for SBP S1 → S4                   | `SUBSCRIPTIONS_BUILD_PROMPTS.md` §0 and S4                                                                                |
| MONEY §5 MR0, MR1, MR2, MR4, MR6, MR7            | done, §0.0                                                                                                                |
| MONEY §5 MR3, MR5, MR8a / MR8b                   | §3, after DB21                                                                                                            |
| MONEY §5 MR9                                     | §7, before Z1                                                                                                             |
| MONEY §6 "What no prompt here can close"         | §0.7, after the row map                                                                                                   |
