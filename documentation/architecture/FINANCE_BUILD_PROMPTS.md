# Finance Build Prompts — Claude Code Work Orders for the Finance Engine, Stripe Rails & `/wallet`

> **Status: WORK ORDERS, not binding. Refreshed 2026-10-30 against the owner's rulings (Wave 1.2).**
> A sequenced series of self-contained Claude Code prompts for the finance engine, the Stripe rails,
> `/wallet` and `/checkout`. Every prompt cites its evidence by finding ID: the IDs of
> [`FINANCE_AUDIT.md`](FINANCE_AUDIT.md) (FA: `L` `W` `E` `S` `K` `H` `A` `V` `R` `M` `Z` `C` `CO`
> `D`), as re-verified by [`FINANCE_COMPLETENESS_AUDIT.md`](FINANCE_COMPLETENESS_AUDIT.md) (FCA,
> which adds `N1`–`N34`). It cites its ruling as `(Decision #337, ruling X)`, from the OWNER RULINGS
> on Decision #337 and the ruling table in [`FOUNDER_QUESTIONNAIRE.md`](FOUNDER_QUESTIONNAIRE.md)
> Part C. The `X` contradictions and `D-` items are those of
> [`FINANCE_DISCREPANCIES_AND_DECISIONS.md`](FINANCE_DISCREPANCIES_AND_DECISIONS.md) (FDD). The
> never-recorded "Decision #251" is superseded by #337, and F0 is retired (ruling Q0.1).
>
> **Done, each verified in git:** A12 and CO20 (`660c9658`); DB1's remainder, N1 and N5 (`172f9d66`;
> N1's cron job is registered by the Wave 1 jobs session); DB7 except the per-account promo cap and
> the refunded and cancelled writers (`24cbab02`; the rest is DB19); SV1's Zod half (`4c9482a2`,
> `388d9952`; its two CHECKs are DB8's). UI1 and UI2 are partly fixed (D6, D11, D16).
>
> **How to use it:** paste each prompt into its **own fresh session**, after the standard header
> (§1), in the §0 order. A prompt marked **🧑 DECISION** stops at the named step and puts the
> options, with a recommendation, to a human before it changes that behaviour; the rest of the
> prompt runs. Migrations are **edited in place** (root `CLAUDE.md` §1), so every prompt names the
> category file to edit. Line numbers are as of 2026-10-30: grep before trusting one.

---

## 0. Run order, conflicts and open decisions

### 0.1 Run order

Two lanes run side by side. The **SQL lane** runs one finance SQL prompt at a time, because nearly
all of them share `00001240`, `00001210`, `00000017` or `00002510`; a second SQL session may run
beside it only from another track, on disjoint migration files (`FOUNDER_QUESTIONNAIRE.md` §B.0).
The **app lane** runs up to three code or UI prompts at once, file-disjoint. P0 items lead both
lanes. The waves are indicative: inside a wave, §0.2 and §0.3 still decide what may overlap.

| Wave | SQL lane (serial)                                                                                        | App lane (parallel, file-disjoint)                                                 |
| :--- | :------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| Done | ✅ DB1 · ✅ DB7 (remainder → DB19) · ✅ N1 · ✅ N5                                                       | ✅ SV1 Zod half (CHECKs → DB8)                                                     |
| 1    | DB10 per-currency thresholds (P0)                                                                        | SV6 wallet covers (P0) · SV2 wallet honesty (P0) · UI1 wallet styles               |
| 2    | DB11 seller commission (P0)                                                                              | SV4 checkout service (P0; after SV6) · SV3 locks and recurring actions (after SV2) |
| 3    | DB16 conservation identity                                                                               | UI2 island and money-verb tiers (after SV2, UI1)                                   |
| 4    | DB12 bonus refused → DB2 webhooks → DB3 money doors → DB6 dispute freeze → SV8 failed payout (after SV3) | UI6 checkout gates (after SV4, UI2)                                                |
| 5    | DB4 payout schedules → DB5 pots                                                                          | UI4 ledger and charts (after UI1) · UI3 rows, pots, locks (after SV3, DB5)         |
| 6    | DB14 ticket and funding gates → DB15 payout-ready gate                                                   | SV7 seller-side refusals (after DB15)                                              |
| 7    | DB13 bonus held → DB20 team splits                                                                       | —                                                                                  |
| 8    | DB8 currency integrity → DB9 settlement and entity currency → DB17 FX feed → DB18 conversion             | SV5 currency honesty (after DB9) → UI5 estimates and MoneyView                     |
| 9    | DB19 order lifecycle and promo cap → DB21 buyer and provider refunds                                     | —                                                                                  |
| 10   | E3 paid-call contract (after SCH-WP6)                                                                    | E1 money lifecycle E2E → E2 visual matrix (after every UI prompt)                  |
| Last | Z1 docs sweep                                                                                            |                                                                                    |

Why this order:

- **P0 first.** C15 (DB10), N3 (DB11), N7 (SV6), V6 and R5 (SV2), CO8 (SV4) and C13 (SV5) are FCA's
  open P0 items; CO20, A12, N1, N5, CO4 and CO6 are done. C13 needs the one exponent list (DB8), so
  its lane position is later than its priority.
- **The conservation identity (DB16) runs early,** as FDD D-5 asks ("ship A with the P0 fixes").
  Every later money prompt then proves it moved nothing it should not, and adds its own terms.
- **Automation follows ruling M6's order:** payout schedules (DB4), then pots (DB5, UI3). The Income
  Smoother stays locked and Planned (SV3).
- **Disputes are one chain:** DB2 (out-of-order disputes, refunds) → DB3 (no release while a dispute
  is open) → DB6 (the freeze, ruling M3) → DB21 (product disputes reuse the freeze).
- **Bonuses follow ruling M7's two steps:** DB12 refuses them now; DB13 holds them with the escrow.
- **Currency follows ruling M5:** the CHECKs and the exponent list (DB8), settlement and entity
  currency (DB9), fresh rates (DB17), then the conversion that needs all three (DB18).

### 0.2 Prompts in this file that may not run in parallel

- `00001240`: DB2, DB3, DB4, DB5, DB6, DB8, DB15, DB18, DB21, SV8.
- `00001210`: DB3, DB9, DB10, DB11, DB13, DB15, DB19.
- `00000017`: DB4, DB5, DB6, DB8, DB11, DB12, DB13, DB18, DB19, DB21.
- `00001200`: DB3, DB8, DB10, DB13, DB16, DB17, DB20.
- `00002510`: DB2, DB3, DB4, DB5, DB10, DB11, DB14, DB16, DB17, DB18, DB21 (SV7 if it adds a read).
- `00005060`: DB3 (only a job the jobs session left), DB4, DB16, DB17.
- `00005001`: DB4, DB8, DB9, DB10, DB13, DB18. `00001830`: DB5, DB18, DB19.
- `wallet-actions.ts`: SV3, DB4, DB5, DB14, DB18.
- `CheckoutBackendService.ts`, `live-basket.ts`, `checkout-refusal.ts`, `commerce-*.ts`: SV4, SV5,
  SV6, SV7, DB19.
- The wallet stylesheets: UI1 with every UI prompt.
- `WalletDialogs.tsx`, `WalletHome.island.tsx`: UI2, UI3, UI5, DB18.
- `apps/web/features/checkout/**`: UI5, UI6, DB21. Check `git status` for the Decision #243 peers
  before any UI prompt.
- `packages/ui` and `DESIGN_SYSTEM.md`: SV5, UI1, UI2, UI4, UI5, UI6, DB18. Pull before each edit.

### 0.3 Hot files shared with other tracks (§B.0)

| Hot file                             | Finance prompts that write it                                                        | Other writers (never at the same time)                                                      |
| :----------------------------------- | :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ |
| `00001240` (finance money)           | DB2, DB3, DB4, DB5, DB6, DB8, DB15, DB18, DB21, SV8                                  | PM-WP4                                                                                      |
| `00005060` (jobs)                    | DB3 (only a job the jobs session left), DB4, DB16, DB17                              | the Wave 1 jobs session (first); comms, PM, scheduling and security packages that add a job |
| `00001155` (sessions)                | DB3 (L9's forfeit path), DB15 (booking backstops)                                    | every SCH work package                                                                      |
| `00001020` (workspaces)              | DB9 (entity wallet currency), DB10 (a threshold reader)                              | identity rank, archive and seat items; SA G4                                                |
| `00001060` (erasure)                 | none                                                                                 | identity erasure, SEC G16                                                                   |
| `00001300` (comms)                   | none (DB4 and SV8 only call `comms.fn_notify`)                                       | SEC L2/L4–L8, CAS messaging                                                                 |
| `00002510` (grants)                  | DB2, DB3, DB4, DB5, DB10, DB11, DB14, DB16, DB17, DB18, DB21 (SV7 if it adds a read) | many                                                                                        |
| `stripe-webhook.ts` + `00001230`     | DB2, DB6, DB9                                                                        | SBP S4                                                                                      |
| `live-wallet.ts` / `wallet-scope.ts` | SV2, SV3, SV5, SV8, DB4, DB5, DB18                                                   | RED WP2                                                                                     |
| `features/devtools` + `dev-seam.ts`  | SV4, UI3                                                                             | SBP S4, S6; IDG F6                                                                          |

### 0.4 Cross-track waits

- **SCH-WP6** (paid consultations) waits for SV4 (B.3) and never runs beside DB11, DB13 or DB19,
  which also edit `place_wallet_order` and the escrow holds. **E3** waits for SCH-WP2's interim,
  SCH-WP6 and DB15.
- **DB15** waits for SCH-WP2's interim to merge and runs while no SCH work package is running
  (`00001155`, `00001510`). **DB3** needs no SCH package running either (`00001155`).
- **DB3, DB4, DB16 and DB17** wait for the Wave 1 jobs session to merge. After it, each owns
  `00005060` only while it runs; DB3 first checks whether the jobs session already wrote the
  spend-approval expiry and the idempotency-key sweep.
- **PM-WP4** (the Fair Exit floor, the ticket-level Fair Exit, removal refunds) waits for DB3 and
  DB6 (B.3). DB13 and DB20 never run beside it: all three edit `00001200`'s release paths.
- **PM's ghosting auto-approve** (FDD D-9 (a), `PM_BUILD_PROMPTS.md`) releases through
  `fn_release_ticket_escrow`, so it lands after DB3 (no release while a dispute is open), and its
  bonus is judged as DB13 rules.
- **DB14** runs while no P-track SQL step edits `00001110`, `00001150` or `00001850`. **DB12 and
  DB13** change the project setup copy (`apps/web/features/projects/components/setup/*`): tell the P
  track.
- **SBP S4** waits for DB2; DB6 and DB9 never run beside S4 (`stripe-webhook.ts`, `00001230`).
- **RED WP2 / WP11** (the wallet read path, SQL aggregates) wait for SV2 and SV5. **RED WP4**
  (keyboard on money paths) waits for UI2, UI3 and UI5. **RED WP7** (the money sweep and its lint
  ban) waits for UI5 (and SBP S5).
- **Identity:** MFA's AAL2 step-up on withdrawals and payout-account changes waits for the finance
  SQL lane (`begin_payout`, `record_payout_account`), and so does IW-M13. DB9's sign-up suggestion
  edits the identity track's wizard files (`apps/web/features/auth/core/*`): coordinate with
  `IDENTITY_BUILD_PROMPTS.md`.
- **Comms:** DB4's pause notice and SV8's fan-out use `comms.fn_notify` as it stands; a catalogue
  row they add goes in `00005010`.

### 0.5 Open decisions

**🧑 stops in this file.** Each prompt runs up to its stop.

| Prompt      | Question                                                                                    | Recommendation                                                                                            |
| :---------- | :------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------- |
| DB11 step 6 | Which fee an Agency's contract rate applies to: the new conflict with #187, flagged on #252 | B: an Agency contract covers its product-sale commission (and its payer fee when it buys); #187 unchanged |
| DB13        | What "met" means for a deadline bonus, and against which deadline                           | A: per escrow, the ticket's due date; met when the work later approved was sent by it                     |
| DB17        | The daily FX provider (it must quote all 12 display currencies, NGN and AED included)       | A: one reference-rate API that covers all 12                                                              |
| DB18        | The conversion margin's value (Decision #337, ruling M5 (d): still open)                    | B: a per-currency map, set only after counsel answers (d) below                                           |
| DB19        | What `cancelled` means beside `refunded`                                                    | A: refunded in full before any delivery began                                                             |
| DB21        | A product dispute raised after the sale has cleared                                         | A: allowed only while the sale is still clearing                                                          |

**⚖️ ruled, pending counsel** (build behind a flag that stays off; never switch it on):

- **M2's safeguarding question**, how long escrow may sit in the platform balance under Separate
  Charges & Transfers: open with Stripe and counsel, with no owner position. Nothing here builds on
  it.
- **M9**, a failed bank payout stays in the connected account's Stripe balance: that is how it is
  built (#202 (a)). SV8 only tells the right people and changes no money path, so it needs no flag.

**Still open from Wave 1, not this track's:** whether `project_stages.create_category` stays as a
label (#338 P4, PM) and Agency and Enterprise storage (#252 S2, SBP S2).

**New contradictions and questions** found while writing this file. They are listed here, not
logged; the coordinator logs them.

- (a) **Deadline bonus.** `PRODUCT_SPEC.md` (One-offs; Pipelines "the same") pays it "only if the
  final stage is approved before the soft deadline"; `finance-model.md` §13 pays it "for delivery by
  a stage's deadline", per stage. Both were written in Wave 1.1 from ruling M7, which does not say
  what "met" means. → DB13's stop.
- (b) **Agency contracts.** `finance-model.md` §16.4 lets an Agency hold a
  `finance.negotiated_rates` contract, but that table's `subject_type` CHECK allows only `business`
  and `enterprise`. Part of #252's open flag. → DB11's stop.
- (c) **Refunds after clearing.** Ruling M8 recovers a refunded digital product from the seller's
  pending row (per M3), and M3 never claws back cleared money, so a refund after the 7-day window is
  unruled. → DB21's stop.
- (d) **Conversion and regulation.** Ruling M5 (c) converts held client balances between currencies.
  That may be a regulated currency-exchange service: counsel should confirm before the margin is set
  (DB18). A question, not a conflict between docs.
- (e) **Stale, not a conflict:** `DESIGN_SYSTEM.md` §B.8 still lists #157 flag (j) as open, and F.3
  describes the pre-#331 hero pills. Ruling E3 D-13 settles both; UI2 updates them.

### 0.6 Covered elsewhere, or Planned

- **N2:** the interim switch-off and the money path are `SCHEDULING_BUILD_PROMPTS.md` SCH-WP2
  (interim) and SCH-WP6 (Decision #343, ruling C1). E3 here checks FDD D-2's finance riders once
  they merge.
- **N16:** the 14-day ghosting auto-approve (FDD D-9 (a), ruling P3: Build) is
  `PM_BUILD_PROMPTS.md`'s.
- **FDD D-9 (b):** the Fair Exit floor (#338 P1) and the ticket-level Fair Exit (#338 P2 (a)) are
  PM-WP4's.
- **FDD D-1, D-4** (#343 C2): the review-window name and the reschedule lockout are the scheduling
  track's.
- **M1's `/pricing` copy** (#252 (l)) is `SUBSCRIPTIONS_BUILD_PROMPTS.md`'s. **#341 E2's lint ban**
  on `formatMoney` / `Intl.NumberFormat` is `OPTIMIZATION_BUILD_PROMPTS.md`'s (RED WP7). **The
  abandoned-basket nudge** (FA (t)) is a comms notification (`COMMS_BUILD_PROMPTS.md`).
- **X4 / N31:** the root `CLAUDE.md` persona fix is the owner's edit
  (`WAVE1_CLAUDE_MD_PROPOSAL.md`). No prompt here touches a guardrail file.
- **Planned, no prompt:** the Income Smoother engine (ruling M6: a `PRODUCT_SPEC.md` entry first),
  instant payouts and maintenance cycles (ruling P3), the shadow double-entry journal and the
  Stripe-balance reconciliation (ruling M2 B; FA L6), tax computation (A9) and the wallet-plus-card
  split payment (CO17).

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
  2. Read the evidence your prompt cites: documentation/architecture/FINANCE_COMPLETENESS_AUDIT.md
     (FCA: the re-verified FA IDs and N1-N34), FINANCE_AUDIT.md (FA) and
     FINANCE_DISCREPANCIES_AND_DECISIONS.md (FDD: the X and D- items).
  3. Read the rulings: Decision #337's OWNER RULINGS (grep -n '^| 337 |'
     documentation/reference/decisions/decisions-122-126.md) and the ruling table in
     documentation/architecture/FOUNDER_QUESTIONNAIRE.md Part C. Then grep
     documentation/reference/decisions/README.md for the surface you touch and read what it names:
     at minimum #10, #122-#126, #152, #157, #186-#191, #196, #200, #202, #203, #211, #212, #234,
     #239, #240, #243, #247, #252, #337, #338, #341 and #343.
  4. Read documentation/business/finance-model.md, the PRODUCT_SPEC.md section you touch and
     documentation/database/finance/{Tables,Functions,Policies}.md for the objects you change.
  5. Check documentation/architecture/FINANCE_BUILD_PROMPTS.md §0: if another session is writing
     one of your files, wait.

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
    finance.escrows.fx_* stay, marked reserved (Decision #337, ruling Q0.2 (d)).
  - supabase/probes/finance_invariants.sql stays green. Once DB16 lands, so does
    supabase/probes/conservation_identity.sql, and a prompt that adds a money flow adds its terms
    to finance.v_conservation_identity in the same change.
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

Verification: reproduce the defect first, then fix. A SQL probe lives in supabase/probes/: it sets
\set ON_ERROR_STOP on, asserts through a pg_temp helper that raises 'PROBE FAIL: …' and ends in
ROLLBACK; only a concurrency probe commits, gated on :{?disposable}. SQL sessions: at most 2 at once
on the one local DB, on disjoint migration files; announce every `deno task db:reset` to the other
sessions before you run it; run probes with `deno task test:probes` (a name filters them) and
finish with your own clean `deno task test:probes:fresh`. Then `deno task check`, `deno task lint`,
`deno task test:unit`, and `deno fmt` on the files you touched only (never a directory). Four
theme-engine.test.ts failures are pre-existing (Decision #96(a)). UI prompts: `deno task dev`, the
seeded personas (documentation/database/Seed.md), and screenshots at 1440, 900 and 390 px in light,
dark, data-contrast="high" and data-motion="reduced".
Commit on the branch you were given with a clear message; do not open a PR unless I ask.
```

---

## 2. Phase 0 — Rulings

### F0 — Superseded by Decision #337's OWNER RULINGS (ruling Q0.1 (c))

F0 would have recorded FA §4.6's flags as "Decision #251". That number went to Teams W1. Decision
#337 carries the flags, and the owner ruled them on 2026-10-30; Wave 1.1 applied the factual doc
halves (ruling Q0.4). **Do not run F0.** Where each flag went:

| FA flag                                        | Now                                                                      | Built by                  |
| :--------------------------------------------- | :----------------------------------------------------------------------- | :------------------------ |
| (a) deposit-rule and pot RLS                   | FCA A12, A4 (P0, no ruling)                                              | ✅ `660c9658`, `172f9d66` |
| (b) `/wallet/create`                           | FDD X19, factual                                                         | ✅ Wave 1.1               |
| (c) dispute freeze and clawback                | D-6 = ruling M3                                                          | DB6, DB21                 |
| (d) Stripe key storage                         | factual                                                                  | ✅ Wave 1.1               |
| (e) earning-gate breadth                       | D-7 = ruling M4                                                          | DB15, SV7                 |
| (f) splits at payout                           | ruling M10 (a)                                                           | DB20                      |
| (g) button tiers                               | D-13 = ruling E3 D-13; Save card and Approve stay tier 3 (DESIGN_SYSTEM) | UI2, UI6                  |
| (h) no `/inspect` for finance documents        | ruling E3 FA (h)                                                         | UI4                       |
| (i) Express-only; the fee account; SA's claims | FDD X13, X6, X14, factual                                                | ✅ Wave 1.1               |
| (j) the Income Smoother                        | D-10 = ruling M6                                                         | SV3 (locked; Planned)     |
| (k) the stale DESIGN_SYSTEM cite               | factual, not yet applied (`DESIGN_SYSTEM.md:1944`)                       | UI1                       |
| (l) the reserved-funds colour                  | ruling E3 FA (l): keep the aurora violet                                 | UI1                       |
| (m) platform settlement currency               | D-8 (a) = ruling M5 (a)                                                  | DB9                       |
| (n) the default currency                       | D-8 (b) = ruling M5 (b)                                                  | DB9                       |
| (o) own-wallet conversion                      | D-8 (c), (d) = rulings M5 (c), (d)                                       | DB18                      |
| (p) per-user promo caps                        | D-12 = ruling M8                                                         | DB19                      |
| (q) the product-sale fee rate                  | D-3 = ruling M1                                                          | DB11                      |
| (r) refunds and cancellations                  | D-12 = ruling M8                                                         | DB19, DB21                |
| (s) the FX docs                                | factual (the doc half ✅ Wave 1.1)                                       | DB17 (the seed comment)   |
| (t) comments that code must make true          | CO6 ✅ (DB7); CO13 → DB19; CO15 → SV4                                    | —                         |

---

## 3. Phase 1 — Database RPCs, ledger gaps & webhook hardening

### DB1 — ✅ Done: deposit rules and pots are written through doors only

Shipped. A12 landed in `660c9658`: `finance.deposit_rules` is SELECT-only for clients (probe
`deposit_rule_authority.sql`). `172f9d66` added the rest. `finance.wallet_pots` is SELECT-only
(`00002013`, `00002520`; probe `wallet_pot_authority.sql`). `finance.update_deposit_rule` pauses,
resumes, re-prices and archives a rule, re-stamping `created_by` on a re-price or a resume
(`00001240`; `archived_at` on `00000017`; `trg_deposit_rules_immutable` in `00001830`; grants in
`00002510`; probe `deposit_rule_authority.sql` §6–12). `supabase/probes/finance_invariants.sql`
asserts three invariants: balance = ledger = newest `balance_after`; Σ pots ≤ balance; no pending or
on-hold release already credited. `388d9952` fixed the `DepositRuleSchema` contract. Still open from
DB1's scope: A13's service and UI halves (SV3, UI3). **Do not re-run this prompt.**

### DB2 — Webhook coverage: refunds, dispute updates, cancelled payouts, out-of-order disputes

```text
PROMPT DB2: Ledger every Stripe money event, in any delivery order

ROLE: Payments engineer (Postgres + Stripe).

CONTEXT: FA H3, H4 and E3, all still open (FCA §2.2): charge.refunded, charge.dispute.updated,
charge.dispute.funds_withdrawn / funds_reinstated and payout.canceled are unhandled; a dispute
closed before it is created strands the case; a thaw can collide with uq_escrows_ticket_base_held.
No ruling is needed. DB6 (Decision #337, ruling M3) builds on step 3. A connected account's
payout.canceled is a bank outcome: under ruling M9 (as built, #202 (a)) it moves nothing.

FILES:
  - supabase/migrations/00001230_functions_finance_stripe.sql (record_dispute_opened :1659; new
    record_dispute_updated and record_charge_refunded)
  - supabase/migrations/00001240_functions_finance_money_movement.sql (record_dispute_closed :37
    and its thaw; record_bank_payout for payout.canceled)
  - supabase/migrations/00000004_enums_domains.sql (a chargeback status, only if none fits)
  - supabase/migrations/00002510_permissions_function_grants.sql (the new doors: service_role only)
  - packages/types/finance/payments.ts (HANDLED_STRIPE_EVENTS; BankPayoutStatus if it gains
    'canceled'), billing.ts (a chargeback status, if one is added)
  - packages/backend/services/finance/stripe-webhook.ts (planStripeEvent) + stripe-webhook.test.ts;
    PaymentBackendService.ts (dispatch; the stale card-path comment at :366-368, N30)
  - supabase/probes/stripe_event_order.sql (new)
  - documentation/database/finance/Functions.md; SYSTEM_ARCHITECTURE.md's webhook section links to
    HANDLED_STRIPE_EVENTS instead of restating the list

STEPS:
  1. charge.refunded → finance.record_charge_refunded(p_event_id, p_payment_intent,
     p_amount_refunded, p_refund_id), claiming 'stripe:<evt>' in the same transaction. The delta is
     amount_refunded minus what is already ledgered for that intent, so partial refunds and replays
     are exact. Debit the wallet the payment credited (fn_wallet_debit). If that would go negative,
     record the shortfall on the payment row (the chargeback unrecovered_cents pattern) and an
     ops.log_entries row. Never fail the webhook.
  2. charge.dispute.updated → record_dispute_updated: chargebacks.status 'under_review' (or the
     value that exists; add one in place only if none fits, with Zod and docs). No money moves.
     funds_withdrawn and funds_reinstated are recorded on the chargeback with no ledger move
     (opened and closed move the money), so they read "applied", not "ignored".
  3. H4, out of order: when record_dispute_closed finds no chargeback, INSERT a resolved one keyed
     on the Stripe dispute id; record_dispute_opened then sees it resolved and freezes nothing.
  4. payout.canceled → record_bank_payout with the failed outcome (or 'canceled', if
     BankPayoutStatus gains it in place with Zod and docs). Nothing moves in the ledger, and the
     owner is told (SV8 widens who). It is NOT the transfer-failure path that credits the wallet.
  5. E3: when a thaw (disputed → held) would break uq_escrows_ticket_base_held, leave the escrow
     disputed, set a resolution note and write an ops.log_entries row for manual review. Never
     raise out of the webhook.
  6. Every event goes into HANDLED_STRIPE_EVENTS and planStripeEvent, with a unit test per plan.

ACCEPTANCE:
  - stripe_event_order.sql (ROLLBACK): closed-before-created leaves nothing disputed; replaying any
    event changes nothing; a partial refund twice (5, then 8 cumulative) debits 5, then 3;
    payout.canceled moves no money.
  - stripe-webhook.test.ts covers the new events; the fixture replay test stays green;
    finance_invariants.sql and (after DB16) conservation_identity.sql pass.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place (root §1); the Zod schema and
documentation/database/finance/* with any status or contract change.
HOT: 00001230 + stripe-webhook.ts (SBP S4 waits for this prompt), 00001240, 00002510.
```

### DB3 — Money-door gaps: enterprise KYB, inbound transfers, expiry, fee fallback, open disputes

```text
PROMPT DB3: Enterprise KYB, inbound vault transfers, approval expiry, the fee fallback, releases
during a dispute, the owner backstop and the key sweep

ROLE: Postgres engineer.

CONTEXT: FA K4 (FDD X11: finance-model.md §10 marks the enterprise half Not built yet), V4, A16,
S4, L9, V2 and L8, all still open (FCA §5; L9 now has three paths: F1200's ticket and fair-exit
releases and S1155's forfeit). No ruling is needed. Decision #337, ruling Q0.3: the Wave 1 jobs
session registers the spend-approval expiry and the idempotency-key sweep in 00005060.

FILES:
  - supabase/migrations/00001210_functions_finance_kyc_wallet.sql (fn_assert_business_spend;
    transfer_funds :1944)
  - supabase/migrations/00001240_functions_finance_money_movement.sql (begin_payout :248)
  - supabase/migrations/00001220_functions_finance_billing_entitlements.sql
    (fn_effective_platform_fee_bp)
  - supabase/migrations/00001200_functions_finance_core.sql (fn_release_ticket_escrow :716,
    fn_fair_exit_release :935; the stale "silent no-op" comment near :368, N30)
  - supabase/migrations/00001155_functions_projects_sessions.sql (the forfeit release path): HOT
  - supabase/migrations/00001895_triggers_derived_columns.sql (the owner backstop, beside the
    vault-sync triggers)
  - supabase/migrations/00005060_seed_scheduled_jobs.sql, only for a job the jobs session left
  - supabase/migrations/00002510_permissions_function_grants.sql
  - supabase/probes/finance_doors.sql (new)
  - documentation/database/finance/Functions.md, documentation/database/org/Functions.md (the
    trigger), PRODUCT_MANAGEMENT.md §3.5 (Spend approval: expiry becomes a sweep),
    finance-model.md §10 (remove K4's Not built yet)

STEPS:
  1. K4: fn_assert_business_spend, transfer_funds and begin_payout treat an 'enterprise' owner as
     they treat 'business', reading its KYB as place_wallet_order already does
     (org.enterprises.verification_level = 'verified'). One predicate, reused.
  2. V4: transfer_funds INTO a team, business or enterprise wallet needs
     fn_has_vault_capability(dest, 'add_funds') → PK403 'missing_permission: add_funds'.
  3. A16: finance.fn_expire_spend_approvals() moves pending rows past expires_at to 'expired' (the
     existing value). FIRST check main: if the jobs session already wrote the function and its job,
     verify them against this step and move on; otherwise write the function and an hourly job row
     (the to_regprocedure-guarded pattern in 00005060).
  4. S4: fn_effective_platform_fee_bp RAISEs (PX500 'platform_fee_not_configured') when
     platform_fee_bp is missing. A silent 0 would waive the fee.
  5. L9: fn_release_ticket_escrow, fn_fair_exit_release and the S1155 forfeit release refuse
     (PD409 'dispute_open') while fn_escrow_has_open_dispute is true, which makes F1260's comment
     true. PM's ghosting auto-approve and PM-WP4 release through these and inherit the refusal.
  6. V2: AFTER UPDATE OF owner_user_id ON org.teams and org.business_profiles → re-project the
     vault (org.fn_sync_vault_permissions), beside the existing backstop triggers.
  7. L8: the idempotency-key sweep deletes finance.idempotency_keys past expires_at + 30 days,
     except scope 'stripe.webhook' (kept for replay safety; document why). Check main as in step 3.

ACCEPTANCE:
  - finance_doors.sql asserts each refusal and each allowed path: an unverified enterprise, a member
    without add_funds, a missing fee param, a release during an open dispute, an owner change that
    re-projects the vault.
  - grep -n "silent no-op" supabase/migrations/00001200_functions_finance_core.sql → none.
  - finance_invariants.sql and conservation_identity.sql pass.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; documentation/database/{finance,org}/*;
PRODUCT_MANAGEMENT.md §3.5 (the approval lifecycle's writer); the finance-model.md §10 marker
removed.
HOT: 00001240, 00001155 (no SCH work package beside it), 00002510, 00005060 (steps 3 and 7 only).
```

### DB4 — Payout schedules run (M6, first in the build order)

```text
PROMPT DB4: Scheduled payouts execute through begin_payout, and the lock lifts

ROLE: Payments engineer.

CONTEXT: FA A14 (FCA: schedules save and never run; a client writes the table through a FOR ALL
policy); FDD X17, D-10. Decision #337, ruling M6: each automation control stays locked until its
engine runs, and payout schedules are built first. SV3 locks the scheduled modes
('schedule_not_running'); this prompt builds the engine and lifts that lock. Instant payouts stay
Planned (Decision #337, ruling P3): the fee is unset until priced.

FILES:
  - supabase/migrations/00000017_tables_finance.sql (payout_schedules in place: created_by,
    last_run_at, last_error, failure_count)
  - supabase/migrations/00001240_functions_finance_money_movement.sql (finance.save_payout_schedule;
    finance.fn_claim_due_payout_schedules)
  - supabase/migrations/00002013_policies_finance.sql + 00002520_permissions_table_grants.sql (the
    "Manage own payout schedule" FOR ALL policy and the INSERT/UPDATE grant go: SELECT-only, as
    A12 and A4 did)
  - supabase/migrations/00002510_permissions_function_grants.sql
  - supabase/migrations/00005001_seed_platform_params.sql (instant_payout_fee_bp → JSON null,
    described "Planned; unset until priced (Decision #337, ruling P3)")
  - supabase/migrations/00005010_seed_notification_catalog.sql (a payout.schedule_paused row, if
    none exists)
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (http job 'finance-payout-schedules' on
    FINANCE_CRON_SECRET)
  - apps/web/routes/api/finance/cron/payout-schedules.ts (NEW: cron/payouts.ts is the stale-payout
    sweep and stays as it is)
  - packages/backend/services/finance/{payout-schedules.ts (new) + test, PaymentBackendService.ts,
    wallet-actions.ts (setPayout calls the door), live-wallet.ts (actionsFor lifts the lock)}
  - packages/types/finance/* (the schedule's Zod)
  - supabase/probes/payout_schedules.sql (new)
  - documentation/database/finance/*, finance-model.md §13 (remove the schedules' Not built yet),
    PRODUCT_MANAGEMENT.md §3.5 (a payout schedule's states, if it gains any)

STEPS:
  1. finance.save_payout_schedule(p_owner_type, p_owner_id, p_currency, p_mode, p_threshold_cents,
     p_destination_method_id, p_instant): SECURITY DEFINER, search_path pinned. It needs the owner
     on a personal wallet, `withdraw` on a shared one; a destination is the owner's own active
     payout method; p_instant = true refuses ('instant_payout_planned'); it stamps
     created_by := auth.uid(). One row per (owner, currency), as today.
  2. fn_claim_due_payout_schedules(p_limit int): FOR UPDATE SKIP LOCKED; weekly and monthly when
     next_run_at ≤ now(); threshold when Available ≥ threshold. It advances next_run_at in the same
     transaction. Amount = Available (DB5 later makes it Available minus earmarks), skipped below
     fn_min_withdrawal_minor(currency).
  3. The cron route → the service → the SAME begin_payout path as a manual withdrawal: payout-ready,
     KYB, the author's `withdraw` re-checked at run time, Stripe idempotency key
     'payout_schedule:<schedule>:<run_at>'.
  4. A refusal (unready, an account issue, a lost capability) records last_error and counts
     failure_count. Three in a row → active = false and a notice to the author (comms.fn_notify).
     No retry loop.
  5. actionsFor offers the scheduled modes again (SV3's lock reason goes); setPayout writes through
     the door, in the action's currency (N17, fixed in SV3).

ACCEPTANCE:
  - Unit tests for the claim maths: weekly · monthly · threshold · below the minimum.
  - payout_schedules.sql: a direct client UPDATE is refused (42501); a spend-only member cannot
    save one; two concurrent claims never return the same schedule (dblink, under :{?disposable}).
  - A cron route test: a wrong bearer → 404.
  - finance_invariants.sql and conservation_identity.sql pass.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod + documentation/database/finance/* with the columns and
the door; the finance-model.md §13 marker removed; PRODUCT_MANAGEMENT.md if a state appears.
HOT: 00001240, 00002510, 00005060, live-wallet.ts.
```

### DB5 — Pots: the earmark engine (M6, second in the build order)

```text
PROMPT DB5: Pots are earmarks: the engine, its doors and the allocation on matured income

ROLE: Ledger engineer.

CONTEXT: FA A2, A3, L7 (FCA: pots are never allocated, have no movement door and no Σbp cap); A4
is done (DB1). FDD X17, D-10. Decision #337, ruling M6: a pot is an earmark inside the wallet,
never a separate balance, and pots come second in the build order, after DB4. The wallet's
balance_cents stays the total; Available to spend = balance_cents − Σ pots. SV3 keeps any pot
control locked ('pots_not_running') until UI3 ships the dialog on top of this prompt.

FILES:
  - supabase/migrations/00000017_tables_finance.sql (wallet_pots in place: goal_cents, archived_at;
    a new finance.pot_movements table) + 00001830_triggers_finance.sql (pot_movements append-only,
    like transactions)
  - supabase/migrations/00001240_functions_finance_money_movement.sql (fn_available_cents;
    fn_apply_pot_allocations; save_wallet_pot; move_pot_funds; the calls in
    fn_mature_pending_releases :1745 and in fn_wallet_credit_pending's zero-day branch :1662; the
    earmark rule in fn_wallet_debit; fn_claim_due_payout_schedules)
  - supabase/migrations/00003004_views_finance_integrations_analytics.sql (v_wallet_reconciliation
    includes pots, L7)
  - supabase/migrations/00002510_permissions_function_grants.sql; 00005001 (tax_pot_default_bp is
    read as save_wallet_pot's default)
  - packages/types/finance/{methods.ts (WalletPotSchema, PotMovementSchema), wallet.ts (the
    save_pot and move_pot actions)}; packages/backend/services/finance/{wallet-actions.ts,
    live-wallet.ts}
  - supabase/probes/wallet_pots.sql (new)
  - documentation/database/finance/*, finance-model.md §13 (the engine half of the pots marker; UI3
    removes the lock half), PRODUCT_MANAGEMENT.md §3.5 if a pot gains an archived state

STEPS:
  1. fn_available_cents(wallet) = balance_cents − Σ active pots. Enforce it in ONE place, inside
     fn_wallet_debit (signature unchanged), by reason. A voluntary spend (an escrow hold, a checkout
     payment, a transfer or distribution out, a payout, an invoice payment, a conversion) may not
     reach earmarked money (PF402 'earmarked'). An involuntary recovery (a chargeback, dispute or
     refund recovery) may, and then shrinks pots newest first, each with a pot_movements row, so
     Σ pots ≤ balance always holds. List both sets of reasons explicitly; a reason in neither set
     raises, so a new writer has to choose.
  2. fn_apply_pot_allocations(p_wallet, p_amount, p_reason, p_ref_table, p_ref_id): income reasons
     only (escrow_release, team_split, team_finder_fee, fair_exit_release, product_sale). Each
     active pot with auto_allocate_bp > 0 earmarks ⌊p_amount × bp / 10000⌋, in created_at order;
     dust stays unallocated; a zero amount writes nothing.
  3. Call it on maturation (fn_mature_pending_releases) and in fn_wallet_credit_pending's zero-day
     branch. Never on a top-up, refund or transfer, and never twice for one release.
  4. save_wallet_pot(p_wallet, p_id, p_purpose, p_name, p_auto_allocate_bp, p_goal_cents): the
     owner on a personal wallet, `distribute` on a shared one. Σ auto_allocate_bp over the active
     pots ≤ 10000, under pg_advisory_xact_lock(hashtext('pots:' || wallet)). Archive only at
     balance 0 (active = false, archived_at); never DELETE.
  5. move_pot_funds(p_pot, p_amount, p_direction 'in' | 'out'): 'in' needs Available ≥ amount; 'out'
     needs the pot's balance ≥ amount; the save capability; one pot_movements row.
  6. fn_claim_due_payout_schedules (DB4) pays Available minus earmarks.
  7. The service offers save_pot and move_pot only to a viewer the door would accept.

ACCEPTANCE:
  - wallet_pots.sql (ROLLBACK): a 30% tax pot and a 10% savings pot on a £1,000.01 matured release
    earmark 300.00 and 100.00, and 600.01 stays available; Σbp 10001 refused; a spend into an
    earmark refused; a chargeback recovery shrinks the newest pot; a replayed maturation allocates
    once.
  - finance_invariants.sql (Σ pots ≤ balance) and conservation_identity.sql pass: an earmark moves
    no money, so the identity is unchanged.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod + documentation/database/finance/* with the columns,
the table and the doors; the engine half of the finance-model.md §13 marker removed.
HOT: 00001240, 00002510, live-wallet.ts.
```

### DB6 — Disputes inside the seven-day window (M3)

```text
PROMPT DB6: A payment dispute freezes the payee's money still clearing, and recovers from it first

ROLE: Ledger engineer.

CONTEXT: FA W3, W4 (FCA: on_hold is never written; a lost chargeback recovers from the payer
only); FDD X9, D-6. Decision #337, ruling M3 (A): inside the 7-day clearing window the payee's
pending rows that the disputed payment funded go on_hold; a lost dispute recovers from them first,
then from the payer, then as platform loss; a won one restores each row's original release date.
Cleared money is never clawed back. PRODUCT_SPEC §Escrow, Wallets & Finance 5 states the published
rule. Depends on DB2 (out-of-order disputes) and DB3 (no release while a dispute is open). N22 (the
wallet read shows On hold) shipped with SV2.

FILES:
  - supabase/migrations/00001230_functions_finance_stripe.sql (record_dispute_opened :1659)
  - supabase/migrations/00001240_functions_finance_money_movement.sql (record_dispute_closed :37
    and its recovery order; fn_mature_pending_releases :1745 skips on_hold)
  - supabase/migrations/00000017_tables_finance.sql (pending_releases: the freeze's columns in
    place if needed — the chargeback that froze a row; the original available_at is kept)
  - packages/types/finance/{billing,disputes}.ts if shapes change
  - supabase/probes/dispute_window.sql (new)
  - PRODUCT_SPEC.md §Escrow, Wallets & Finance 5 (remove the Not built yet; this closes #126's
    flag), finance-model.md §7 (marker), PRODUCT_MANAGEMENT.md §3.5 (fund state: pending ⇄ on_hold
    → recovered or available), documentation/database/finance/*

STEPS:
  1. Which rows: the pending_releases rows the disputed payment funded — those of the order, escrow
     or paid revision it paid for, and the team-split rows of those releases — up to the disputed
     amount, oldest first. A plain top-up funded nothing in particular, so it freezes no payee row;
     the payer recovery covers it.
  2. record_dispute_opened sets those rows on_hold; fn_mature_pending_releases skips on_hold.
  3. Lost (record_dispute_closed): recover from the on_hold rows first, then from the payer as
     today, then record the rest as unrecovered_cents (platform loss). Won: back to pending with the
     original available_at; a row whose date has passed matures on the next sweep.
  4. A row already credited (Available) is never touched.

ACCEPTANCE: dispute_window.sql walks hold → release (pending) → dispute opened (on_hold, not matured
at +8 days) → lost (recovered from on_hold first, then the payer) and → won (pending again, maturing
at its original time). finance_invariants.sql (invariant 3 covers on_hold) and
conservation_identity.sql pass.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod + database docs with any column; PRODUCT_MANAGEMENT.md
§3.5 (the fund-state lifecycle); the PRODUCT_SPEC.md and finance-model.md markers removed.
HOT: 00001230 + stripe-webhook.ts (SBP S4), 00001240.
```

### DB7 — ✅ Done: checkout integrity (the rest is DB19)

Shipped in `24cbab02`, re-checked against the code:

- **Steps 1–2 are superseded by the shipped CO20 assert,** not by the drafted signature change.
  `place_on_account_order` keeps `p_amount`, but only as the expected total. It is passed to
  `place_wallet_order` as `p_expected_minor` (PC409 `price_changed` on any other net) and asserted
  again against the order's `charged_minor` after the credit, under N5's advisory lock per business
  and currency, with the idempotency key re-checked after the lock. No surplus can stay in the
  wallet, so `fn_basket_net` is not needed (probe `on_account_amount.sql` §3, §5–6).
- **Steps 3–7:** the promo row is read `FOR UPDATE` and redeemed atomically under `max_redemptions`
  (PC409 `promo_exhausted`), and the code is recorded on the order (CO6, and CO7's record half);
  `place_wallet_order` takes `p_expected_minor` (CO4); the key is re-checked after the basket lock
  (CO10); a second card tab is refused `payment_in_progress` and resumes the live payment (CO11);
  own-listing refuses an active team member for products, sessions and cohort seats (CO18). Probes
  `checkout_charge_assert.sql` and `promo_redemption_concurrency.sql`.
- **Step 8:** `invoiced` is written for on-account orders ("On account", nothing charged now).

Not done, now DB19 (Decision #337, ruling M8): the per-account promo cap, the `refunded` and
`cancelled` writers, and retiring `processing` and `awaiting_payment` in the enum comment (ruling
Q0.2 (e)). **Do not re-run this prompt.**

### DB8 — Currency integrity: CHECKs, one exponent list, reserved FX columns

```text
PROMPT DB8: Every currency column is a real ISO code, every status a known value, one exponent list

ROLE: Postgres engineer.

CONTEXT: FA C14, C10 (the SQL side) and C7; FCA N24 (no CHECK on escrows.status,
wallets.owner_type or transactions.reason) and N13 / FDD X22 (fund_state is never written; Wave 1.1
corrected the doc half, ruling Q0.4, and the T17 comment is the code half); SV1's SQL half (pot name
≤ 120 and approval reason ≤ 2000, as the Zod already says). Decision #337, ruling Q0.2 (d):
finance.escrows.fx_* stay, marked reserved, because M5 (c) builds conversion now (DB18 writes the
transactions' fx_* columns). The per-currency thresholds moved to DB10.

FILES:
  - supabase/migrations/00000017_tables_finance.sql: CHECKs inside each CREATE TABLE —
    currency ~ '^[A-Z]{3}$' on wallets, transactions, escrows, invoices, payouts, wallet_pots,
    spend_approvals, payout_schedules, fx_rates, negotiated_rates, promo_codes and every other
    unconstrained currency column; escrows.status, wallets.owner_type, transactions.reason;
    wallet_pots.name ≤ 120; spend_approvals.reason ≤ 2000; the fund_state comment (:56-65)
  - supabase/migrations/00000015_tables_projects.sql (projects.currency),
    00000011_tables_org.sql (business_profiles and enterprises default_currency)
  - supabase/migrations/00001200_functions_finance_core.sql (new finance.fn_currency_exponent(text)
    IMMUTABLE); 00001240_functions_finance_money_movement.sql (fn_minor_units_text uses it)
  - supabase/migrations/00005001_seed_platform_params.sql and supabase/seeds/* (any seed a CHECK
    refuses)
  - supabase/probes/currency_integrity.sql (new)
  - documentation/database/finance/Tables.md (the CHECKs; escrows.fx_* "reserved, Decision #337,
    ruling Q0.2 (d)"), finance-model.md §11

STEPS:
  1. C14: the currency CHECKs, edited into each CREATE TABLE. char(3) columns keep their type.
  2. N24: escrows.status IN (the values some function writes — grep every writer; the DEFAULT
     'funded' is written by no code, so set the DEFAULT, in place, to the value the hold door
     writes, and list 'funded' only if a writer exists); wallets.owner_type IN ('user',
     'freelancer', 'team', 'business', 'enterprise'); transactions.reason IN (every reason a
     function writes — grep; a reason you cannot place is a finding to report, never to invent). No
     escrow column is dropped or retyped.
  3. SV1's two length CHECKs.
  4. C10: fn_currency_exponent(p_ccy) returns 0, 2 or 3 from ONE list, equal to
     packages/types/finance CURRENCY_EXPONENTS (SV5's contract test diffs the two).
     fn_minor_units_text uses it (KWD three decimals; JPY and ISK none).
  5. C7: nothing is dropped. Tables.md and finance-model.md §11 call escrows.fx_* reserved (verify
     Wave 1.1's wording).
  6. SQL reads security.platform_params.base_currency; a TS constant that must mirror it gets a
     contract test.
  7. N13 / X22: the T17 fund_state comment says what is written.

ACCEPTANCE: currency_integrity.sql: 'usd', 'US' and 'EURO' → 23514; an unknown escrow status, owner
type or reason → 23514; KWD 1234 formats as 1.234 and JPY 1234 as 1,234; the seeds load.
finance_invariants.sql passes.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place (the CHECKs never drop or retype an escrow, wallet or stage
column); documentation/database/finance/* with every CHECK.
HOT: 00001240.
```

### DB9 — Settlement per currency, and an entity's currency from its owner's country (M5 (a), (b))

```text
PROMPT DB9: Money settles per currency, and an entity's currency comes from its owner's country

ROLE: Payments architect + Postgres engineer.

CONTEXT: FA C17, C1 and C16 (FCA: team and business wallets take the creator's DISPLAY currency;
projects default to USD; Stripe settles into one GBP balance); FDD X21, D-8. Decision #337, ruling
M5 (a): per-currency Stripe balances for the 12 display currencies, so a payout transfers in the
wallet's currency from a same-currency balance. Ruling M5 (b): an entity's currency comes from its
owner's country through one map in countries.ts, and a project defaults to its owner's currency;
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
  - packages/types/finance/countries.ts (+ countries.test.ts); packages/types/org preferenceHints
  - apps/web/features/auth/core/wizardValidation.ts (the identity track's wizard: coordinate) and
    apps/web/utils/currency-context.ts (a guest's display currency)
  - packages/backend/services/finance/stripe-rails.ts (:180-200, :381-385)
  - supabase/probes/entity_currency.sql (new)
  - finance-model.md §9 and §11, PRODUCT_SPEC.md §6 (the M5 (a), (b) markers),
    documentation/database/{finance,org,projects,catalogue}/Tables.md

STEPS:
  0. Read-only first: list the TEST platform account's balances per currency (stripe balance
     retrieve with the test key from .env.local; never a live key). Adding a settlement bank
     account or balance per currency is a Dashboard act for a human: report which of the 12 are
     missing and carry on. The code below refuses what is not enabled.
  1. countries.ts: one COUNTRY_CURRENCY map (ISO 3166 → one of the 12 display currencies, else the
     platform base) and currencyForCountry(). A unit test pins every DISPLAY_CURRENCIES country.
  2. An entity's wallet currency at creation = currencyForCountry(the owner's confirmed country),
     never the display preference. A project takes its owner's currency in the create door; the
     'USD' column defaults go, in place (each writer sets the value): projects, business_profiles,
     enterprises and catalogue listings alike.
  3. settlement_currencies (the 12, or those step 0 found enabled): a listing or a project cannot
     be priced in a currency outside it (SV5 narrows packages/types/catalogue/catalogue.ts:147 to
     it). A Transfer Stripe refuses for an insufficient balance in its currency returns the money
     through the existing transfer-failure path and writes an ops.log_entries alert (C17).
  4. A suggestion only (the owner's M5 (b) note): preferenceHints proposes a sign-up country from
     the browser's languages and time zone (and an edge country header only if the host sets one),
     and the person confirms it. A guest's display currency comes from the same hint. Neither ever
     sets an entity's currency.

ACCEPTANCE: entity_currency.sql: a team created by a user whose confirmed country maps to EUR gets
an EUR wallet whatever their display currency; a JPY owner's new project is in JPY; a listing priced
outside settlement_currencies is refused. countries.test.ts covers the map. finance_invariants.sql
passes.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod + database docs with every default and column change;
the PRODUCT_SPEC.md §6 and finance-model.md §11 markers removed for what this builds.
HOT: 00001020, 00001230 + stripe-webhook.ts (not beside SBP S4), and the identity track's wizard
files.
```

### DB10 — Per-currency thresholds (M5 (e), P0)

```text
PROMPT DB10: The on-account limit and the approval threshold are set per currency

ROLE: Postgres engineer.

CONTEXT: FA C15 (P0 whatever else is ruled, FDD D-8 (e)). One 2 500 000 minor-unit on-account limit
serves every currency (about £236 in INR and £13k in JPY), and vault_approval_threshold_cents is one
figure too. Decision #337, ruling M5 (e): both become per-currency maps shaped like
min_withdrawal_minor. finance-model.md §14 and §15 and PRODUCT_SPEC.md §6 carry the markers.

FILES:
  - supabase/migrations/00005001_seed_platform_params.sql (on_account_limit_cents and
    vault_approval_threshold_cents become JSON maps, {"default": …, "GBP": …, …}, in each
    currency's minor units; the descriptions say so)
  - supabase/migrations/00001200_functions_finance_core.sql (new finance.fn_param_minor(p_key text,
    p_currency text): one resolver for every per-currency param; fn_min_withdrawal_minor may
    delegate to it) + 00002510 (definer use only, no client grant)
  - supabase/migrations/00001250_functions_finance_auto_fund_billing.sql (place_on_account_order
    :559, get_on_account_standing :595), 00001210 (fn_business_threshold :138-151), 00001020 (the
    threshold reader near :3847): HOT
  - packages/backend/services/finance/live-buyer.ts (:752-761), packages/types/workspace/policy.ts
    (:426) and every other TS reader of the two keys (grep)
  - supabase/probes/on_account_amount.sql and business_spend_gate.sql (extend)
  - documentation/database/finance/Functions.md, finance-model.md §14 and §15, PRODUCT_SPEC.md §6
    (the M5 (e) markers)

STEPS:
  1. The maps. on_account_limit: GBP 2 500 000 as today, and about £25,000 in each other currency,
     stated as dials pending product sign-off, like min_withdrawal_minor.
     vault_approval_threshold: {"default": 0} (0 = no threshold, as today).
  2. One resolver. A currency missing from on_account_limit with no "default" REFUSES on account
     (PF402 'limit_not_configured'); it never falls back to a flat number. The threshold keeps
     "0 = none" as its default.
  3. Every reader, SQL and TS, goes through the resolver or the service that wraps it.

ACCEPTANCE: on_account_amount.sql: an INR order is judged against the INR limit; a currency with no
entry and no default is refused PF402. business_spend_gate.sql: a per-currency threshold applies in
its own currency. finance_invariants.sql passes.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod for the param shapes; documentation/database/finance/*;
the M5 (e) markers removed.
HOT: 00001020 (not beside an identity step on it), 00002510.
```

### DB11 — The seller's commission on product sales (M1, P0) — 🧑 at step 6

```text
PROMPT DB11: A product sale pays the seller's Standing-tapered commission

ROLE: Postgres payments engineer.

CONTEXT: FCA N3 (P0 revenue: finance.fn_effective_commission_bp has no caller, and product sales pay
the buyer's 5%) and N19 (the Standing "commission paid" figure is computed in TS with Math.round
from net volume); FDD X3, X4, D-3. Decision #337, ruling M1 (A): a product sale pays the seller's
commission at their Standing rung (8% → 6.5%, finance.standing_commission_tiers); #187's payer-rate
rule covers escrow fees only; the stage-completion fee never tapers. The 20% boost tier waits for
boosts. The root CLAUDE.md persona fix (X4) is the owner's edit; do not touch it. The /pricing copy
is SUBSCRIPTIONS_BUILD_PROMPTS' (#252 (l)).

🧑 DECISION (step 6 only; steps 1-5 run): which fee an Agency's contract rate applies to, the new
conflict flagged on Decision #252. An escrow fee is the PAYER's rate (#187), so an Agency (a team,
and so a payee) has no escrow fee of its own. And finance.negotiated_rates.subject_type CHECKs
('business', 'enterprise'), so a team cannot hold a contract row at all, although finance-model.md
§16.4 names Agency commitments. Put this to me:
  A: the payee's contract rate also applies to escrow fees on its own engagements, the lower of the
     payer's and the payee's rates winning. Amends #187; both sides' previews must show that fee.
  B (recommended): an Agency contract covers the commission on its product sales (the existing
     marketplace_commission_bp column, which fn_effective_commission_bp already reads) and its
     payer fee when it buys. #187 is unchanged; subject_type widens to 'team', in place.
  C: only buyers (Business, Enterprise) hold a contract rate; strike the Agency "negotiable fee"
     from finance-model.md §1.3 and §16.4.
  Why B: one rate per escrow (the payer's) keeps a previewed fee the charged fee for both sides,
  and M1 already makes the seller's own rate govern a sale. A is the only option that reaches an
  agency's main revenue: the upgrade path if Agency sales ask for it.

FILES:
  - supabase/migrations/00001210_functions_finance_kyc_wallet.sql (place_wallet_order: the fee rate
    :1746 and the product-sale fee :1857; the stale "silent no-op" comment beside it, N30)
  - supabase/migrations/00000017_tables_finance.sql (order_lines: platform_fee_bp and
    platform_fee_minor per line, in place)
  - supabase/migrations/00001220_functions_finance_billing_entitlements.sql only if
    fn_effective_commission_bp (:211) needs a fix; 00002510 if the seller preview needs a grant
  - packages/types/finance/{order.ts, fee.ts}; packages/backend/services/finance/live-orders.ts (the
    mapper) and wallet-standing.ts (:128-153, N19); the seller's earnings preview (grep the listing
    editor's "you receive" figure)
  - supabase/probes/product_commission.sql (new)
  - documentation/database/finance/*, finance-model.md §1.2 and §16.4, PRODUCT_SPEC.md §Marketplace
    "Direct Sale" (the M1 markers)

STEPS:
  1. For each digital_product line: fee = ⌊paid × fn_effective_commission_bp(seller_type, seller_id)
     / 10000⌋ (truncated, #187), where paid is the line's amount after its promo share and the
     seller is the line's owner_team_id, else its owner_user_id. Record the rate and the fee on the
     line.
  2. orders.platform_fee_minor stays the order's total fee (Σ lines); orders.platform_fee_bp stays
     the payer's rate, which escrow lines use. The column comments say so.
  3. Session, seat and engagement lines are escrow lines: their fee stays the payer's, charged at
     release.
  4. N19: the Standing "commission paid" and "at next level" figures read the recorded line fees and
     the next rung's rate from standing_commission_tiers, never TS maths over net volume.
  5. The seller's preview uses the same resolver (a STABLE read for the caller's own subject), so a
     previewed commission is the charged one.
  6. After the ruling: B → widen negotiated_rates.subject_type to 'team' (in place, Zod, docs) and
     probe a team contract; A → the dual-rate resolver and both previews; C → strike the Agency
     negotiable-fee text. Record the owner's answer on #252's row (re-check the index first).

ACCEPTANCE: product_commission.sql: an L1 seller pays 8% and an L5 seller 6.5% on the same sale,
truncated; a mixed basket charges each seller their own rate; an escrow line's fee is unchanged (the
payer's). finance_invariants.sql passes (and conservation_identity.sql, if DB16 has landed).

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod + documentation/database/finance/* with the line
columns; the M1 markers in finance-model.md and PRODUCT_SPEC.md removed.
HOT: 00001210 (SCH-WP6 never beside it), 00002510 if a grant is added.
```

### DB12 — Deadline bonuses refused until they are funded (M7, step C)

```text
PROMPT DB12: No unfunded deadline bonus can be paid

ROLE: Postgres engineer.

CONTEXT: FCA N4 (release pays amount + deadline_bonus_cents − fee, and nothing funds the bonus; only
the seed writes the column, as 0); FDD D-11. Decision #337, ruling M7: C now (a CHECK refuses a
non-zero bonus), then A (DB13). Decision #338 defers its D16-a to this ruling.

FILES:
  - supabase/migrations/00000017_tables_finance.sql (finance.escrows :115: the
    deadline_bonus_cents CHECK becomes = 0, named ck_escrows_bonus_unfunded, in place; the column is
    neither dropped nor retyped)
  - the project setup copy that promises "+10%":
    apps/web/features/projects/components/setup/setup-format.ts (DEADLINE_BONUS_PERCENT) and its
    readers (tell the P track)
  - supabase/probes/escrow_bonus_unfunded.sql (new)
  - documentation/database/finance/Tables.md

STEPS:
  1. The CHECK. The seeds still load: they write 0.
  2. Until DB13 lands, no surface promises a bonus amount (gate §3.11): the setup and ticket copy
     show the deadline without "+10%". allow_deadline_bonuses keeps gating due dates as it does
     today.

ACCEPTANCE: escrow_bonus_unfunded.sql: an escrow with a bonus of 1 → 23514; a seeded escrow still
releases amount − fee. The finance-model.md §13 marker stays: it already says a non-zero bonus is
refused, and DB13 removes it.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place (a CHECK only); documentation/database/finance/Tables.md.
```

### DB13 — Deadline bonuses held with the escrow (M7, step A) — 🧑 before step 3

```text
PROMPT DB13: A deadline bonus is held with its escrow and paid only when the deadline is met

ROLE: Ledger engineer.

CONTEXT: FCA N4; FDD D-11. Decision #337, ruling M7 (A, after DB12's C): the bonus is held with the
escrow at funding; release pays it when the deadline was met; otherwise it is refunded to the payer
with no fee. One-offs and pipelines both offer it (the owner's answer; today
ck_projects_deadline_bonus_format allows pipelines only). +10% (DEADLINE_BONUS_RATE = 0.1) is the
starting dial.

🧑 DECISION (before step 3): what "met" means. PRODUCT_SPEC.md (One-offs; Pipelines "the same") pays
the bonus "only if the final stage is approved before the soft deadline"; finance-model.md §13 pays
it "for delivery by a stage's deadline … when the deadline was met". This is a new contradiction
(§0.5 (a)). Put this to me:
  A (recommended): per escrow, against the ticket's due date, which after a claim moves only with
     both sides' agreement (Decision #338, ruling P5 (c)); met ⇔ the submission that is later
     approved was SENT by it. The client's review time can never cost the freelancer the bonus.
  B: PRODUCT_SPEC's wording, met ⇔ APPROVED by the deadline. Simple, but a client who waits keeps
     the bonus: a perverse incentive beside a 14-day auto-approve.
  C: per project, judged on the final stage only (PRODUCT_SPEC's one-off wording), paid with the
     last release.
  Write the ruling into PRODUCT_SPEC.md and finance-model.md in the same change, so they agree.

FILES:
  - supabase/migrations/00005001_seed_platform_params.sql (deadline_bonus_bp = 1000;
    packages/types/projects/create.ts DEADLINE_BONUS_RATE pinned to it by a parity test, Decision
    #341, ruling E1 Q15)
  - supabase/migrations/00000017_tables_finance.sql (escrows: DB12's ck_escrows_bonus_unfunded goes
    back to ≥ 0; the deadline the escrow was funded against, snapshot in place if the ruling needs
    it)
  - supabase/migrations/00000015_tables_projects.sql and wherever ck_projects_deadline_bonus_format
    lives (grep): allow one-offs
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
  2. One-offs: relax the format CHECK; the setup offers the bonus on both project types.
  3. Release, per the ruling: met → the payee gets amount + bonus − fee (the fee on the amount only,
     as today); missed → amount − fee to the payee, and the bonus goes back to the payer at once as
     a fee-free 'deadline_bonus_refund' credit.
  4. Every other exit (Fair Exit, a dispute split, removal before work, the claim TTL) refunds the
     bonus with no fee. PM's ghosting auto-approve judges "met" exactly as step 3 does.

ACCEPTANCE: deadline_bonus.sql: the hold = amount + 10%; on time → paid; late → refunded fee-free to
the payer; Fair Exit → refunded. finance_invariants.sql and conservation_identity.sql pass: a
released bonus now has its funding term.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod + documentation/database/{finance,projects}/*; the M7
markers in finance-model.md and PRODUCT_SPEC.md removed, worded per the ruling.
HOT: 00001210 (SCH-WP6 never beside it); 00001200 and 00001150 (never beside PM-WP4 or a P-track
SQL step on them).
```

### DB14 — No ticket enters work unfunded, and stage funding asserts its amount (N6, N8)

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
  1. N6: BEFORE INSERT ON projects.tickets. A ticket born in a work status is refused (PF402, as the
     UPDATE gate refuses entry into work without a held escrow). A ticket born with
     current_assignee_id set runs the same payout-ready and assignment checks as
     fn_assign_ticket_core. No role is exempt: a seed that needs an assigned ticket inserts it
     unassigned and assigns it by UPDATE, so the existing gates run.
  2. N8: fund_stage refuses PC409 'price_changed' when p_expected_minor differs from what it would
     hold. The wallet path passes the quote it showed; the card settlement passes the payment
     amount.

ACCEPTANCE: ticket_insert_gate.sql: an insert in work → PF402; an insert with an unready assignee →
PK403; the normal create-then-assign path passes. stage_funding_prepaid.sql: a re-price between the
quote and the commit → PC409, and nothing is held. finance_invariants.sql passes.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; documentation/database/{projects,finance}/Functions.md with
the trigger and the signature.
HOT: 00002510; 00001110, 00001150 and 00001850 belong to the projects track too: never beside a
P-track SQL step on them.
```

### DB15 — Payout-ready before earning: publish, booking, paid calls (M4)

```text
PROMPT DB15: Payout-ready at listing publish, at session and seat booking, and for paid calls

ROLE: Postgres engineer.

CONTEXT: FA K3 (FCA: confirmed for sessions, seats and products; refuted for blueprints, which bind
no seller) and FCA N14 (the withdrawal earnings gate keys on whether pending rows exist, so 0-day
credits, distributions and transfers in skip #196); FDD X10, D-7. Decision #337, ruling M4 (A):
payout-ready is required at listing publish, at session or seat booking and at enabling paid calls,
and on a team for every shareholder; the team invite shows readiness on the roster and refuses at
accept (#252 (i) = #196 (b); accepting is already gated in 00001020). SV7 maps these refusals as the
seller's (N12) and adds the roster read.

FILES:
  - supabase/migrations/00001170_functions_catalogue.sql (a publish payout gate beside
    catalogue.trg_listings_publish_age_gate :934) and 00001810_triggers_auth_onboarding.sql (to
    bind it)
  - supabase/migrations/00001155_functions_projects_sessions.sql (reserve_seat :183, fn_confirm_seat
    :274, fn_book_session_slot :569: the host's readiness as a backstop): HOT
  - supabase/migrations/00001510_functions_scheduling.sql (save_owner_availability :1135:
    paid_enabled := true needs a payout-ready host)
  - supabase/migrations/00001210 (:110-118) and 00001240 (begin_payout :329-334): N14
  - supabase/seeds/* (a seeded published listing or paid-call host who is not payout-ready)
  - supabase/probes/payout_ready_gate.sql (extend)
  - documentation/database/{catalogue,finance,projects,scheduling}/Functions.md; finance-model.md
    §10 and PRODUCT_SPEC.md §Escrow 5 and its paid-calls paragraph (the M4 markers for these doors)

STEPS:
  1. Publish: a product listing, or a service listing that sells sessions (1-1 or cohort), cannot
     become published unless finance.fn_assert_payout_ready passes for its owner (a team listing:
     the team, so every shareholder). A blueprint binds no seller and stays ungated (K3). Drafting
     stays free. The gate is a trigger on the table, like the age gate, so no write path skips it.
  2. Booking backstop: fn_book_session_slot, fn_confirm_seat and reserve_seat assert the same for
     the host, refusing PK403 'payout_not_ready' with HINT 'seller' (the buyer is not the one to
     act).
  3. Paid calls: save_owner_availability refuses turning paid_enabled on for an unready host. Paid
     requests themselves stay refused until SCH-WP6 (SCH-WP2's interim).
  4. N14: the withdrawal gate keys on the wallet's owner kind and earnings history. A user,
     freelancer or team wallet that has ever received an earned credit (escrow_release, team_split,
     team_finder_fee, *_vault_retention, fair_exit_release, product_sale, team_distribution,
     transfer_in) needs a payout-ready withdrawer; a buyer's refund balance never needs ID
     (PRODUCT_SPEC §Escrow 5).
  5. Seeds comply: a seeded published listing's owner is payout-ready, or the listing is a draft.

ACCEPTANCE: payout_ready_gate.sql: publish refused for an unready seller and for a team with one
unready shareholder; a blueprint publishes; a booking refused with HINT 'seller'; paid_enabled
refused; a 0-day credit, a distribution and a transfer in no longer skip the withdrawal gate; a
refund-only wallet withdraws without ID. finance_invariants.sql passes.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; the database docs of every schema touched; the M4 markers
removed for the doors this builds (the roster half stays for SV7).
HOT: 00001155 and 00001510 (no SCH work package running; SCH-WP2's interim merged first),
00001240, 00001210.
```

### DB16 — The conservation identity, checked nightly, with an ops reader (M2)

```text
PROMPT DB16: The money is all accounted for: a per-currency conservation identity, checked nightly

ROLE: Ledger engineer.

CONTEXT: FDD X6, X8, D-5; FCA §4.4 (CO20, N4, S5 and W4 would each show as an imbalance) and FA L5
(the nightly drift writer has no reader). Decision #337, ruling M2 (A now): a per-currency
conservation-identity view, checked nightly beside finance.fn_reconcile_wallets, with an ops reader
for both. B, a shadow double-entry journal, is Planned: it is built when live money passes a pilot,
an enterprise asks for an audit trail, or an auditor or regulator does. ⚖️ How long escrow may sit
in the platform balance is open with Stripe and counsel; nothing here depends on it.

FILES:
  - supabase/migrations/00003004_views_finance_integrations_analytics.sql
    (finance.v_conservation_identity) + 00003005_permissions_view_grants.sql (no client grant)
  - supabase/migrations/00001200_functions_finance_core.sql (finance.fn_check_conservation(): one
    ops.log_entries row per currency per night, source 'finance.conservation', level error on any
    imbalance; finance.get_ledger_health(): a STABLE definer read for operators only,
    security.is_admin(), returning the last 30 nights and the open drift rows)
  - supabase/migrations/00002510_permissions_function_grants.sql
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (sql job 'finance-conservation-check',
    after 'finance-reconcile-wallets')
  - apps/web/routes/(dashboard)/admin/ledger.tsx (re-export) →
    apps/web/features/admin/routes/LedgerHealthScreen.tsx, through
    packages/backend/services/finance/LedgerHealthService.ts (new; ServiceResult)
  - supabase/probes/conservation_identity.sql (new)
  - documentation/database/finance/Functions.md and its views doc, finance-model.md §6 and §15 (the
    M2 A markers), SYSTEM_ARCHITECTURE.md (Integration Blueprints 1: A now, B before scale),
    ROUTING.md (/admin/ledger, operator-only; a bare /admin stays a 404)

STEPS:
  1. Classify every distinct finance.transactions.reason a function writes (grep the migrations):
     external-in (a settled top-up or card payment, on-account credit), external-out (a completed
     payout net of reversals, a chargeback recovery, a refund to a card), internal (both legs inside
     the system) or revenue. A reason that fits none is a finding: stop and report it.
  2. The identity, per currency: Σ external-in − Σ external-out = Σ wallet balances + Σ escrows held
     or disputed + Σ pending_releases outstanding (pending or on_hold, net of recoveries) + Σ fees
     retained (released escrows' platform_fee_cents, order fees) − Σ platform losses (unrecovered
     chargebacks). Derive each term from the code, starting from FCA §4.4's draft, and prove it on
     the seeded DB.
  3. The nightly check runs after the reconcile job and never corrects anything.
  4. The ops reader: /admin/ledger, operator-only and read-only, with DataTable, MetaLine and Tag
     (status) and no new component; everyone else gets a 404.
  5. From here on, every money prompt keeps this identity green and adds its own flow's terms (§1).

ACCEPTANCE: conservation_identity.sql: the seeded DB balances in every currency; a probe-made credit
with no cash (CO20's shape) and a released unfunded bonus (N4's shape) each show as an imbalance in
their currency (ROLLBACK). The page renders for an operator and 404s for a member.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; documentation/database/finance/* with the view, functions
and job; ROUTING.md with the route; the M2 A markers removed.
HOT: 00005060 (after the jobs session), 00002510.
```

### DB17 — A daily FX feed (M5 (f)) — 🧑 provider

```text
PROMPT DB17: A daily FX feed keeps the rates fresh

ROLE: Backend + Postgres engineer.

CONTEXT: FA C5 (FCA: only the seed 00005050 writes finance.fx_rates, so every converted figure uses
a rate dated 2026-08-01). Decision #337, ruling M5 (f): a daily FX feed and a staleness mark on
every converted figure. The mark renders in SV5 and UI5. FxService already reads only GBP-quoted
rows (FA (s)) and caches them 15 minutes in Deno KV, so a new day's rates reach every isolate
within 15 minutes with no invalidation (RED's FX version key is optional).

🧑 DECISION (before step 1): the provider. It must quote all 12 display currencies (GBP USD EUR CAD
AUD JPY INR SGD CHF ZAR NGN AED) daily, allow display use under its licence, and keep its key in the
env contract. Put this to me:
  A (recommended): one commercial reference-rate API that quotes all 12 against GBP, keyed in
     .env.local (FX_FEED_URL, FX_FEED_API_KEY; XXXX-XXXX in .env.example).
  B: the ECB reference rates (free, but 10 of the 12: no NGN or AED) plus a second source for those
     two: two parsers and two failure modes.
  Until the answer, build steps 2-4 against a provider interface with a fixture adapter only.

FILES:
  - supabase/migrations/00001200_functions_finance_core.sql (finance.record_fx_rates(p_provider
    text, p_as_of timestamptz, p_rates jsonb): service_role only; appends rows ON CONFLICT (base,
    quote, as_of) DO NOTHING) + 00002510
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (http job 'finance-fx-daily', after the
    provider's daily fix); 00005050_seed_reference_data.sql (the seed comment's inverse-pairs claim,
    FA (s)'s code half: the rows stay as a floor, the comment is corrected)
  - apps/web/routes/api/finance/cron/fx.ts (new; constant-time bearer on FINANCE_CRON_SECRET, 404
    otherwise); packages/backend/services/finance/FxService.ts (refreshRates and the provider
    adapters) + tests
  - SYSTEM_ARCHITECTURE.md's Environment Variable Contract and .env.example (placeholders only)
  - finance-model.md §11 (the feed half of M5 (f)'s marker; UI5 removes the staleness half),
    documentation/database/finance/Functions.md

STEPS:
  1. The adapter: GBP-based quotes for the 12, parsed exactly (numeric strings, never floats).
  2. refreshRates(): fetch → validate (every rate > 0, every currency present, as_of not in the
     future) → record_fx_rates. A failed or partial feed writes an ops.log_entries error and records
     nothing: yesterday's rates stay, and age into the stale mark (24 h, FxService STALE_AFTER_MS).
  3. A replay records nothing new (the unique key).
  4. The job runs daily.

ACCEPTANCE: FxService tests with the fixture adapter: a full feed records 12 rows; a missing
currency records none and logs; a replay records nothing; a wrong bearer on the route → 404.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; documentation/database/finance/* with the door and the job;
SYSTEM_ARCHITECTURE.md's env contract with the new keys; the feed half of the M5 (f) marker removed.
HOT: 00005060 (after the jobs session), 00002510.
```

### DB18 — Conversion between one's own wallets at a disclosed margin (M5 (c), (d)) — 🧑 margin

```text
PROMPT DB18: Convert between your own wallets at a disclosed margin

ROLE: Ledger engineer, plus one dialog.

CONTEXT: FA C4 (FCA: balances are stranded per currency; there is no own-wallet conversion); FDD
D-8 (c), (d). Decision #337, ruling M5 (c): the owner chose to build the disclosed-spread conversion
now. Ruling M5 (d): mid-market plus a disclosed margin, paid by whoever converts; the margin is a
platform_params dial whose value is NOT set. Ruling Q0.2 (d): finance.escrows.fx_* stay reserved;
this prompt writes the transactions' fx_* columns (T17 :77-79). Depends on DB5 (earmarks), DB9
(settlement currencies) and DB17 (fresh rates).

🧑 DECISION: the margin's value (fx_conversion_margin_bp), still open (#337 M5 (d)). Build with the
dial UNSET: the door refuses (PX500 'fx_margin_not_configured') and the Convert action shows locked
('conversion_not_priced'). Put this to me:
  A: one margin on every pair, e.g. 100 bp (1%): simple to disclose.
  B (recommended): a per-currency map shaped like min_withdrawal_minor (majors low; NGN, INR, ZAR
     and AED higher), because the platform's cost of rebalancing its per-currency Stripe balances
     (DB9) differs by currency, and the margin has to cover it.
  Ask counsel first whether converting held client money is a regulated currency-exchange service
  (§0.5 (d)); set no value before the answer.

FILES:
  - supabase/migrations/00000017_tables_finance.sql (new finance.fx_conversions: owner, from and to
    wallet, from and to amounts, mid rate, margin bp, margin minor, as_of, idempotency_key) +
    00001830_triggers_finance.sql (append-only)
  - supabase/migrations/00001240_functions_finance_money_movement.sql
    (finance.quote_wallet_conversion, finance.convert_between_own_wallets) + 00002510
  - supabase/migrations/00005001_seed_platform_params.sql (fx_conversion_margin_bp: JSON null,
    "unset until priced, Decision #337, ruling M5 (d)")
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
     for every figure; locked while the dial is unset.
  4. Treasury: the ops reader (DB16) shows the net converted amount per currency. Rebalancing the
     Stripe balances is an ops act, not code.

ACCEPTANCE: wallet_conversion.sql: with the dial unset → PX500; with it set inside the probe,
GBP → EUR moves the quoted amounts, writes both fx columns and one conversion row; a stale rate
refuses; an earmarked amount refuses; a replay changes nothing; conservation_identity.sql balances
in both currencies. Screenshots of the Convert step at 390 and 1440.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod + documentation/database/finance/* with the table and
the doors; the M5 (c), (d) markers removed only for what runs (the margin stays "not set"); the
DESIGN_SYSTEM.md tier-1 list.
HOT: 00001240, 00002510, live-wallet.ts, WalletDialogs.tsx (never beside UI3 or UI5).
```

### DB19 — Order lifecycle writers and one redemption per account (M8) — 🧑 at step 3

```text
PROMPT DB19: Orders reach every state they can: refunded and cancelled lines, and one redemption per
account

ROLE: Postgres payments engineer.

CONTEXT: FA CO7, CO13, CO25 (FCA: refunded and cancelled have no writer; there is no per-account
cap); FDD D-12. DB7 (24cbab02) shipped invoiced, the recorded code and the atomic max_redemptions
cap. Decision #337, ruling M8: an escrow refund makes its line refunded, and the order is refunded
only when every line is; the lifecycle writes refunded and cancelled and retires processing and
awaiting_payment (ruling Q0.2 (e): in the enum comment only, never dropped); one redemption per
account per code by default, configurable per code. The digital-product and session-forfeit refunds
are DB21's.

🧑 DECISION (step 3): what `cancelled` means beside `refunded`. No source defines it. Put this to me:
  A (recommended): a line is cancelled when it is refunded in full before any delivery began (no
     download, no sitting held, no work started), and refunded when it is refunded in full after.
     The order is cancelled when every line is cancelled, and refunded when every line is refunded
     or cancelled with at least one refunded.
  B: cancelled only for an order the platform voids before money moves. It is never written today,
     because an order is written once it is paid; every return is refunded.

FILES:
  - supabase/migrations/00000017_tables_finance.sql (promo_codes.max_redemptions_per_account
    integer DEFAULT 1 CHECK (> 0), NULL = no per-account limit; order_lines.refunded_minor bigint
    NOT NULL DEFAULT 0, never above the line's charge, and refunded_at; orders.status DEFAULT
    'confirmed' instead of the retired 'processing')
  - supabase/migrations/00000004_enums_domains.sql (the order_status comment :486-491: processing
    and awaiting_payment retired, no writer)
  - supabase/migrations/00001210_functions_finance_kyc_wallet.sql (place_wallet_order's promo block:
    the per-account count; resolve_promo_code: the same refusal at preview; the order rollup
    function beside them)
  - supabase/migrations/00001830_triggers_finance.sql (an AFTER INSERT trigger on
    finance.transactions for the refund reasons)
  - packages/backend/services/finance/{live-basket.ts (resolvePromo), checkout-refusal.ts
    (promo_already_used → buyer copy) + test, live-orders.ts}; packages/types/finance/order.ts (the
    line state)
  - supabase/probes/promo_redemption_concurrency.sql (extend), order_refund_lifecycle.sql (new)
  - PRODUCT_MANAGEMENT.md §3.5 (Checkout order: the markers and the line states), finance-model.md
    §15, PRODUCT_SPEC.md §Orders, Refunds & Promo Codes (the markers),
    documentation/database/finance/*

STEPS:
  1. Per-account cap: under the promo row's existing FOR UPDATE, count this owner's orders (the
     order's owner_type and owner_id) that used the code, in every status: a refund does not give a
     redemption back. Refuse PC409 'promo_already_used'. The basket preview refuses first, so no
     buyer sees a discount the database will refuse.
  2. The line writer: ONE trigger on the refund reasons (enumerate them from the migrations:
     escrow, fair-exit, session and seat refunds …) maps the refunded escrow to its line through the
     existing links (order_lines.ticket_id, the seat membership's order line, the paid-revision
     line, the 1-1 session line). A refund with no order line (a stage funded from the Finance tab)
     touches no order. refunded_minor accumulates partial refunds (a Fair Exit split).
  3. The rollup, per the ruling.
  4. Retire processing and awaiting_payment in the comment; the column DEFAULT stops naming one.

ACCEPTANCE: the promo probe: the same account's second use → PC409 at preview and at commit; two
accounts both succeed; max_redemptions still holds under concurrency. order_refund_lifecycle.sql: a
full escrow refund marks its line and, once every line is marked, the order; a 50% Fair Exit leaves
the line partly refunded and the order confirmed. finance_invariants.sql passes.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod + documentation/database/finance/* with every column;
PRODUCT_MANAGEMENT.md §3.5 (the order and line lifecycle); the M8 markers removed for what this
builds.
HOT: 00001210 (SCH-WP6 never beside it); the checkout services (never beside SV4, SV5, SV6, SV7).
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
team pays its finder again. finance_invariants.sql passes.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; documentation/database/finance/Functions.md; the
finance-model.md §5 marker removed.
HOT: 00001200 (never beside PM-WP4).
```

### DB21 — Refunds a buyer or provider can start (M8) — 🧑 at step 2

```text
PROMPT DB21: Refunds a buyer or provider can start: an undelivered or defective product, and a
forfeit given back

ROLE: Ledger engineer.

CONTEXT: FA CO25; FDD D-12. Decision #337, ruling M8: no refund on a digital product after its
first download, except for non-delivery or a defective file, through a dispute, recovered from the
seller's pending row (M3's order); a provider may refund a session forfeit voluntarily
(finance-model.md §4).
Read from the ruling's wording: before the first download, a buyer may cancel the line. Depends on
DB6 (the on_hold machinery) and DB19 (the line states).

🧑 DECISION (step 2): a product dispute raised after the seller's money has cleared. M3 never claws
back cleared money; M8 recovers from the seller's pending row (§0.5 (c)). Put this to me:
  A (recommended): a product dispute may be opened only while the sale is still clearing (7 days),
     which is also when the seller's money can be held; the order page says so.
  B: allowed later, and a refund past the window is the platform's loss.
  C: allowed later and recovered from the seller's Available balance (contradicts M3's published
     line).

FILES:
  - supabase/migrations/00000017_tables_finance.sql (an order-line subject on the dispute table
    F1260 uses, in place)
  - supabase/migrations/00001260_functions_finance_disputes.sql (open_order_line_dispute; the
    refund on a buyer win)
  - supabase/migrations/00001240_functions_finance_money_movement.sql (cancel_order_line before a
    download; refund_session_forfeit) + 00002510
  - files.download_events (read only: a download by the buying account of the line's asset since
    the order)
  - packages/backend/services/finance/{OrderBackendService.ts, DisputeBackendService.ts}; the
    buyer's order view (a tier-5 "Cancel" before a download, "Report a problem" after); the
    provider's session view (a tier-5 "Refund this forfeit"); the types
  - supabase/probes/product_refunds.sql (new)
  - finance-model.md §4 and §15, PRODUCT_SPEC.md §Orders, Refunds & Promo Codes and §Sessions (the
    markers), PRODUCT_MANAGEMENT.md §3.5 (the line states), documentation/database/finance/*

STEPS:
  1. cancel_order_line(p_line): a member of the buying account, a download line no member of that
     account has downloaded since the order, and the seller's row still pending. The buyer gets the
     line's paid amount back at once ('order_refund'), the seller's pending row shrinks by its
     credit, and the platform's fee on the line is reversed. The line reads cancelled (DB19).
  2. open_order_line_dispute(p_line, p_reason, p_evidence): non-delivery or a defective file, within
     the ruling's window. It freezes the seller's pending row for the line (on_hold, DB6); the
     operator desk rules it through the existing ruling flow; a buyer win refunds as step 1 does,
     from the frozen row.
  3. refund_session_forfeit(p_escrow): the forfeit's payee gives back what the forfeit paid them,
     from their pending money first, then Available (it is voluntary, so cleared money is theirs to
     give). The buyer gets the forfeit back fee-free; the line reads refunded (DB19's trigger).

ACCEPTANCE: product_refunds.sql: a cancel before any download refunds and reverses the fee; a cancel
after a download is refused; a dispute freezes and a buyer win recovers from the frozen row; a
provider's forfeit refund reaches the buyer. finance_invariants.sql and conservation_identity.sql
pass. Screenshots of the order view's actions at 390 and 1440.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod + documentation/database/finance/*;
PRODUCT_MANAGEMENT.md §3.5; the M8 markers removed for what this builds.
HOT: 00001240, 00002510, apps/web/features/checkout/** (the #243 peers).
```

---

## 4. Phase 2 — Fat services & thin route controllers

### SV1 — ✅ Zod half done (the CHECKs are DB8's)

Shipped in `4c9482a2` (+ `388d9952`): `EscrowSchema` (`payerBusinessId` nullable; `payerUserId`,
`releasedAt` and `autoFunded` added; `status` is `EscrowStatus`),
`ChargebackSchema.unrecoveredCents`, `WalletPageQuerySchema` / `parseWalletPageQuery` returning
`{value, corrected}` with `walletPageSearch` building the canonical query, and
`finance-tables.contract.test.ts`, which diffs every finance table's columns against its row schema
(the parser is `packages/types/core/table-contract.ts`). Left: the two SQL CHECKs the Zod already
promises (pot name ≤ 120, approval reason ≤ 2000), now DB8 step 3; the wallet routes do not parse
with the schema yet (SV2). **Do not re-run this prompt.**

### SV2 — `WalletBackendService` honesty: scope, approvals, per-currency reads, statements

```text
PROMPT SV2: The wallet read says what is true: resolved scope, decidable approvals, per-currency
reads

ROLE: Backend engineer.

CONTEXT: FA R5 and V6 (P0, FCA §1), A7, R10, R11 and R7 (finance routes still on UUID_RE); FCA
N20 (the smoother projection uses floats and a hard-coded fee), N21 (the forecast hard-codes 7
days), N22 (the pending read drops on_hold, which DB6 starts writing) and N25
(DisputeBackendService is unguarded). SV1 shipped WalletPageQuerySchema, parseWalletPageQuery
({value, corrected}) and walletPageSearch (4c9482a2), but the routes do not use them yet. N21's
read is the wallet half of RED SC-4's pendingReleaseDays: the optimisation track reuses it.

FILES:
  - packages/backend/services/finance/{wallet-scope.ts (:112-120, :220-224), live-wallet.ts (:262
    the pending read, :352-376 actionsFor, :436-447 the smoother, :498-527 smoother and pots, :1184
    and :1372 the 7, :1748 hasPdf), WalletBackendService.ts, DisputeBackendService.ts (:56-159)}
  - packages/types/finance/wallet.ts (SpendApprovalView.decidable, StatementRow.pdfHref,
    BillRow.pdfHref, WalletContext.requested/resolved, an onHold figure)
  - apps/web/routes/(dashboard)/wallet/{index,transactions,analytics,invoices}.tsx (parse with
    parseWalletPageQuery; 303 on a scope mismatch or a corrected query)
  - every apps/web/routes/api/finance/** route still on UUID_RE (z.uuid())
  - unit tests beside each service file

STEPS:
  1. R5: resolveWalletContext returns {requested, resolved}. When they differ, every wallet page
     answers 303 to the same path with w=<resolved>, without do and back, plus
     notice=wallet-unavailable (FA §4.3). A corrected query 303s to walletPageSearch's canonical
     form, so the island never has to repair its URL.
  2. V6: SpendApprovalView.decidable = the viewer holds approve_spend on the wallet AND is not the
     requester, from the same capability set the door uses.
  3. A7 + N20: the smoother read is per wallet currency, in integer minor units, with the fee from
     income_smoother_fee_bp (the smoother itself is Planned and locked, SV3; existing enrolments
     stay readable). Pots: every pot, in created_at order, in its currency.
  4. N21: the Upcoming forecast reads pending_release_days. N22: the read counts pending AND
     on_hold; On hold is its own figure and is never dropped.
  5. R10: pdfHref from /api/finance/{statements,invoices}/[id]/pdf when a PDF can be produced;
     hasPdf goes. Every PDF refusal is JSON {code, message} with its status.
  6. R7 + N25: z.uuid() on every finance route still on UUID_RE; DisputeBackendService's methods use
     the guarded read/write wrappers their siblings use.

ACCEPTANCE: unit tests: a scope mismatch (303, do stripped); a corrected query (303 to the canonical
form); decidable for an approver, a distribute-only member and the requester; a two-currency
smoother; on_hold counted; pdfHref present.

SAME CHANGE: Zod with every view-type change; ROUTING.md with the wallet 303 and its notice, if it
does not list them yet.
HOT: live-wallet.ts / wallet-scope.ts (RED WP2 waits for this prompt).
```

### SV3 — Recurring-rule actions, and every automation control locked until it runs (M6)

```text
PROMPT SV3: Recurring-rule actions, and every automation control locked until its engine runs

ROLE: Backend engineer.

CONTEXT: FA A13 (the door shipped in 172f9d66; no service or UI calls it), A14, A6 and A2; FCA N17
(setPayout writes to account.rows[0], an arbitrary currency). Decision #337, ruling M6: each
automation control is locked behind a LockedDialog reason until its engine runs — payout schedules
(DB4), then pots (DB5, UI3), then the Income Smoother, which is Planned and needs a PRODUCT_SPEC.md
entry first (finance-model.md §1.4).

FILES:
  - packages/types/finance/wallet.ts (the WalletAction union; request schemas; lock reason codes)
  - packages/backend/services/finance/{wallet-actions.ts, live-wallet.ts (actionsFor)}
  - apps/web/routes/api/wallet/action.ts (Zod only; no new route)
  - apps/web/features/wallet/core/{wallet-home.ts (:286-303: Upcoming rows carry their actions),
    wallet-refusal.ts (the lock copy)}
  - tests beside each

STEPS:
  1. pause_recurring · resume_recurring · edit_recurring (the amount) · archive_recurring →
     finance.update_deposit_rule. Each is offered only to a viewer the door accepts (the owner, or
     add_funds on a shared wallet). The copy for edit and resume says the rule then charges the
     editor's own card (the door re-stamps created_by).
  2. Locks: actionsFor returns them LOCKED with a reason, never absent while needed.
     set_payout's scheduled modes → 'schedule_not_running' (DB4 lifts it); any pot control →
     'pots_not_running' (UI3 lifts it); enrol_smoother → 'smoother_planned' (it stays until a
     PRODUCT_SPEC.md entry and an engine exist). A manual payout stays savable.
  3. N17: setPayout takes the currency from the action and writes that currency's schedule.

ACCEPTANCE: wallet-actions tests per action; actionsFor tests for a holder, a non-holder and each
lock; a multi-currency account saves the schedule in the currency it named.

SAME CHANGE: Zod with the actions and lock codes. (No marker moves: the engines are not built.)
HOT: live-wallet.ts / wallet-scope.ts, wallet-actions.ts.
```

### SV4 — Checkout service: blockers before charges, the right comparison, tests and an axis

```text
PROMPT SV4: CheckoutBackendService refuses before Stripe is touched

ROLE: Backend engineer.

CONTEXT: FA CO8 (P0: a promo on escrow lines charges the card before the order fails), C8 (the
commit compares the display total, CheckoutBackendService.ts:769), CO15 (stale requires_payment
intents), CO29 (no dev axis) and CO30 (create, promo and replay untested); FCA N23 (the on-account
headroom is shown in the display currency) and N34 (the checkout order, line and calendar routes
pass ids unvalidated). DB7 (24cbab02) already passes the listing-currency charge to the database as
p_expected_minor, raises PC409 promo_exhausted / price_changed / payment_in_progress, and resumes a
live card payment. SCH-WP6 (paid consultations) waits for this prompt.

FILES:
  - packages/backend/services/finance/{CheckoutBackendService.ts (blockersFor; create: the
    comparison :755-790; the on-account headroom :426, :452), live-basket.ts (resolvePromo :1200),
    checkout-refusal.ts (+ test), PaymentBackendService.ts (sweepUnsettledCardPayments)}
  - packages/backend/services/finance/CheckoutBackendService.test.ts (new)
  - apps/web/features/checkout/core/basket-state.ts (:279-292: no resetAttempt() on PC409
    payment_in_progress or a replay)
  - apps/web/routes/api/checkout/{order,calendar}.ts (Zod at the edge, N34)
  - apps/web/features/devtools/*, apps/web/utils/dev-seam.ts (the checkoutPayment axis): HOT

STEPS:
  1. CO8: a promo on a basket with any ticket, revision, seat or session line → the blocker
     'promo_not_applicable', in resolvePromo AND blockersFor, before createCheckoutCardPayment.
  2. C8: compare the listing-currency charge (charge.minor) with the client's expected amount; the
     display total is never part of the price check.
  3. checkout-refusal.ts maps the PC409 prefixes promo_exhausted, price_changed and
     payment_in_progress to buyer copy; payment_in_progress resumes the returned payment.
  4. N23: the on-account headroom is read in the charge currency (get_on_account_standing with it).
  5. CO15: the N1 recovery sweep (cron/card-payments, registered by the jobs session) also cancels
     an intent still requires_* after 24 h (with an idempotency key); the handled
     payment_intent.canceled webhook marks the row. No new job. The abandoned-basket nudge is a
     comms notification, not this prompt's.
  6. N34: Zod uuid on the order, line and calendar routes.
  7. Dev Context Switcher: checkoutPayment (ok · declined · authenticate · timeout · unapplied ·
     price_changed · promo_exhausted), applied in the service under the dev seam: DevOverrides +
     DEV_DEFAULTS, DevOption list, DevContextPanel control, reflect() set AND delete.

ACCEPTANCE: CheckoutBackendService.test.ts covers price_changed, a promo mismatch, a promo on escrow
lines (no Stripe call, asserted with a spy), a prior-key replay, card-id ownership and the
display-versus-listing comparison with a moved rate. A sweep test cancels a 25-hour-old intent and
leaves a succeeded one to settle.

SAME CHANGE: Zod with the blocker codes; the Dev Context Switcher axis in full.
HOT: the checkout services (after SV6); features/devtools + dev-seam.ts (SBP S4, S6; IDG F6).
```

### SV5 — Currency honesty: one exponent SSOT, estimates marked, nothing dropped

```text
PROMPT SV5: Every converted figure says it is an estimate, and no currency silently disappears

ROLE: Backend + types engineer.

CONTEXT: FA C10, C13 (P0), C6, C9, C11, C12 and C20; FCA N33 (the personal "spent this month"
converts each row, then sums). Decision #337, ruling M5 (f): every converted figure carries a
staleness mark. Depends on DB8 (fn_currency_exponent) and DB9 (settlement_currencies).

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
  1. C10: one CURRENCY_EXPONENTS, a superset of the UI's 24 codes. The UI store imports it if
     packages/ui may depend on @projective/types (check packages/ui/CLAUDE.md); otherwise it mirrors
     it and the contract test pins the mirror.
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
     settlement_currencies (DB9).
  6. N33: "spent this month" sums per currency, then converts once.

ACCEPTANCE: the contract test is green; unit tests for an aggregate with an unconvertible currency
(it appears in excluded, and the hero total says so), a stale rate, the NGN rate label,
toStripeAmount (KWD, JPY, ISK, GBP) and N33's order of operations.

SAME CHANGE: Zod with the Aggregate; DESIGN_SYSTEM.md §C.1 with any packages/ui API change.
HOT: live-wallet.ts / wallet-scope.ts (RED WP2 / WP11 wait for this), the checkout services
(commerce-money.ts), packages/ui.
```

### SV6 — "Wallet covers" counts only the wallet that pays (N7, P0)

```text
PROMPT SV6: "Wallet covers" counts only the wallet that will pay

ROLE: Backend engineer.

CONTEXT: FCA N7 (P0, with C13): "wallet covers" and the wallet-provider offer sum every wallet the
owner has, converted to the display currency, while place_wallet_order debits only the
charge-currency wallet (PF402 "Your wallet holds no …"). No ruling is needed.

FILES: packages/backend/services/finance/{commerce-owner.ts (:324-343), CheckoutBackendService.ts
(:371, :425, :528), stage-funding.ts (:43)} and their tests.

STEPS:
  1. The cover is the charge-currency wallet's Available, read through the service (once DB5 lands,
     Available minus earmarks, from the same read, never a TS subtraction).
  2. The wallet provider is offered only when that wallet covers the charge. A buyer with money in
     another currency is told which wallet would pay and that it does not cover the charge; never a
     total across currencies.
  3. The shortfall (CheckoutBackendService.ts:528) is computed in the charge currency.

ACCEPTANCE: unit tests: an owner holding GBP 50 and EUR 100 is not offered the wallet for a GBP 80
item and is offered it for a GBP 40 item; a stage quote follows the same rule.

SAME CHANGE: Zod with any view change.
HOT: the checkout services (SV4 follows this prompt).
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
Verification when it is them." Depends on DB15 (the new refusals, HINT 'seller').

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
of the notice at 390 and 1440.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each reset announced first; finish with your own clean
`deno task test:probes:fresh`.
SAME CHANGE: migrations edited in place; Zod with the wallet flag; documentation/database/finance/*
and database/comms docs for the catalog row; finance-model.md §8 only if its wording changes.
HOT: 00001240, live-wallet.ts (after SV3).
```

---

## 5. Phase 3 — Islands & design-system alignment

### UI1 — Wallet stylesheet gates (partly fixed: D6 and D11 are done)

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
  ✅ D6 (solid selection) and D11 (reduced-motion twins in all eight sheets) are done: keep them.
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

### UI2 — WalletHome and dialogs: honest gates, PDFs, money-verb tiers, focus (partly fixed: D16)

```text
PROMPT UI2: The island acts on what the server decided, and amber marks the money verbs

ROLE: Frontend engineer (Preact signals).

CONTEXT: FA V6, R10, R11, D17, D19, D24 and M2 (FCA §5: D16 was fixed by #331; D18 is ruled in
DESIGN_SYSTEM: Save card and Approve stay tier 3, as configuration and authorisation commits); FCA
N15 and N32. Decision #337, ruling E3 D-13 (A): the wallet lane's Top up becomes tier 1 (accent);
the hero pills stay glass (the #122 licence); amber marks every act that starts or commits a money
flow, which rules #157 flag (j) the broad way. Depends on SV2 (and UI1 for the sheets).

FILES:
  - apps/web/features/wallet/islands/{WalletHome.island.tsx (:306-409 effects, :474 canDecide),
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
  1. V6: Review renders if and only if approval.decidable; the client capability maths at :474 goes.
  2. R10: a tier-5 "PDF" row action for each statement or bill with a pdfHref. Receipts and PDFs
     download through fetch → saveBlob (as the CSV export does); a refusal shows the InlineNotice
     copy, never raw JSON.
  3. Tiers: ✅ D16 (CSV is an icon ghost since #331). D17 Show N more → tier 4 neutral outlined.
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

```text
PROMPT UI3: Upcoming rows act; pots become real; locked automation says why

ROLE: Frontend engineer.

CONTEXT: FA A13 (the UI half), A3, D7, A14 and A6; FCA R13 (no wallet dev axes); FA CO29. Decision
#337, ruling M6: lock each control until its engine runs; a pot is an earmark (Available ·
Earmarked). Depends on SV3 (the actions and locks) and DB5 (the pot doors and actions).

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
  3. Locked automation: the Income Smoother's enrolment (and the scheduled payout modes, if DB4 has
     not merged) open LockedDialog with SV3's reason copy. There is no savable control.
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
app-wide lint ban is the optimisation track's (RED WP7), after this prompt. Depends on SV5. Check
git status first: peers may be editing apps/web/features/checkout/** (Decision #243).

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

SAME CHANGE: DESIGN_SYSTEM.md §C.1 with the MoneyView change; the M5 (f) marker removed.
HOT: WalletDialogs.tsx (never beside DB18 or UI3), apps/web/features/checkout/**, packages/ui. RED
WP4 and WP7 wait for this prompt.
```

### UI6 — Checkout design gates and the commit's honesty (N28)

```text
PROMPT UI6: Checkout passes the design gates, and the commit names the exact charge

ROLE: Frontend engineer (CSS + islands).

CONTEXT: FCA N28 (translucent zebra rows, text opacity, kind labels as bordered pills, a boxed
static banner, a literal scale(0.99) press, a reduced-motion rule present only under the media
query), N9 (Buy Now's Pay is tier 3 and missing from checkout-commit-tier.test.ts), N11 (the
stepper's Details link loops), N26 (the payment step's backward 302 drops display and the sim* dev
axes) and N29 (Pay names the display estimate); FA D27 (PromoField's Apply) and D29 (translucent
fills). Decision #337, ruling E3 D-13: amber marks every act that starts or commits a money flow.
Depends on SV4 and UI2. Check git status first (the Decision #243 peers).

FILES: apps/web/features/checkout/styles/{checkout-confirmation.css (:236, :612),
checkout-body.css (:509), basket-body.css (:378, :765-767, :811, :968-975, :2151-2153),
checkout-payment.css (:119-128, :330)}; apps/web/features/checkout/components/{PromoField.tsx (:97),
CheckoutStepper.tsx (:97-105), ConfirmPayDialog.tsx (:18-21, a stale comment, N30; :79),
OrderSummaryRail.tsx (:329)}; BuyNowModal.island.tsx (:623-631); checkout-commit-tier.test.ts;
apps/web/routes/(dashboard)/checkout/payment.tsx (:42-51); packages/ui MoneyView.tsx (:103, the
spoken rate's locale).

STEPS:
  1. N28 and D29: solid ramp tones and opaque tints; full ink; kind labels as inline meta text; the
     static banner unboxed; press = scale(var(--btn-press-scale)); the reduced-motion rule mirrored
     under :root[data-motion="reduced"].
  2. D27: Apply → tier 4 neutral outlined.
  3. N9: Buy Now's Pay → severity="accent"; add it to COMMITS in checkout-commit-tier.test.ts.
  4. N11: the completed Details step links with ?edit=1.
  5. N26: the payment step's backward 302 keeps the search string (display, sim*), as Details does.
  6. N29: the Pay label and the confirm dialog name the charged amount (the listing-currency
     charge), with the estimate only as the rail's MetaLine; MoneyView's spoken rate uses the
     viewer's locale.
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
M5 (f), M6, M7, M8 and E3 D-13. Runs after the SQL lane (through DB21) and UI2, UI3 and UI5.

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
decline or expiry. Decision #337, ruling M4 (DB15): enabling paid calls needs a payout-ready host.
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
  5. paid_enabled is refused for an unready host (DB15).
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

### Z1 — Finance docs sweep and the audits' status columns

```text
PROMPT Z1: Finance documentation sweep

ROLE: Documentation steward. Runs after every prompt above has merged.

FILES: documentation/database/finance/*; business/finance-model.md; business/PRODUCT_SPEC.md
(Wallet, Funding, Payouts, Multi-Currency, Orders); PRODUCT_MANAGEMENT.md §3.5 (fund state, deposit
rule, payout schedule, pots, checkout order and lines, spend approval);
architecture/SYSTEM_ARCHITECTURE.md (Stripe, reconciliation, the env contract);
architecture/ROUTING.md (the wallet 303, /admin/ledger, checkout); design-system/DESIGN_SYSTEM.md
(§C.1, the Wallet exception, §B.8); architecture/FINANCE_AUDIT.md and FINANCE_COMPLETENESS_AUDIT.md
(a Status column: "Fixed by <prompt> (<commit>)" or "Open — <owner>");
FINANCE_DISCREPANCIES_AND_DECISIONS.md (each X and D- item: built, or open with its prompt);
Decision #337's row (each ruling marked built with its prompt; re-check the index for a number
collision before any decision edit).

SPEC: rollup, not restatement (documentation/CLAUDE.md rule 2). grep every "**Not built yet**" and
"**Planned**" that cites Decision #337: each one left names its open prompt or its Planned owner. Do
not edit the root CLAUDE.md: the X4 / N31 persona fix is the owner's (WAVE1_CLAUDE_MD_PROPOSAL.md);
report whether it has landed.

ACCEPTANCE: every function, trigger, view and job named in DB2-DB21 and SV8 appears in
documentation/database/finance/*; neither audit's status column has a blank cell; every #337 ruling
reads built, open with an owner, or Planned.
```
