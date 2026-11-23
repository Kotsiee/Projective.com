# Founder Questionnaire & Execution Order — every open ruling from the 2026-10 architecture audits

> **Status: ANSWERED 2026-10-30.** The owner filled in Part A, then answered two follow-up rounds
> the same day (the unanswered, ambiguous and self-contradictory items, and a replacement price
> table). Wave 1.1 recorded every ruling on Decisions #252, #336–#341 and #343 (the scheduling draft
> "#335"). **Part C is the ruling table.** **Part D (2026-11-18, Decision #473) is the counsel brief
> for the money ⚖️ items (M2, M9, #435 (a)). Part E (2026-11-23, Decision #528) is the counsel brief
> for the legal library and every other open ⚖️ item, with the sign-off runbook.** This file
> merges every open question in the twelve audit files of `documentation/architecture/` into one
> form. Where several audits ask the same thing, they share one question. Part A is the form. Part B
> is the order in which to run the build work, and which parts can run in parallel Claude sessions.
>
> **Sources (short names used below):**
>
> - FDD = `FINANCE_DISCREPANCIES_AND_DECISIONS.md` (#337).
> - Since 2026-11-11 each source pair is one file: FA, FCA and FDD are `FINANCE_AUDIT.md`; DL is in
>   PMA, SDG in SCA, IDG in IWA and ADC in RED, each with a section map at its end.
> - FA / FBP = `FINANCE_AUDIT.md` / `FINANCE_BUILD_PROMPTS.md`.
> - SA / SBP = `SUBSCRIPTIONS_AUDIT.md` / `_BUILD_PROMPTS.md` (#252).
> - IDG / IWA = the identity pair (#336).
> - DL / PMA = the project-management pair (#338).
> - SDG / SCA = the scheduling pair (draft "#335", which needs a new number; see Q0.1). Recorded as
>   #343.
> - CAS = comms, assets and search (#339).
> - SEC = security, moderation and AI (#340).
> - ADC / RED = architectural clarifications and the redundancy audit (#341).
>
> **How to fill it in:** tick one box per question, or write in the `Answer:` line. ⭐ marks the
> audit's recommendation. 🖊 means the audits have no recommendation, so only you can answer it. ⚖️
> means counsel must confirm.

---

## Fast path

- [ ] **Accept every ⭐ recommendation below, except where I have written a different answer.**

If you tick this, you still need to answer only the 🖊 and ⚖️ items:

- Q0.2 (d)
- M9
- S2 (prices)
- S3 (pool size)
- S8 (importers)
- I1 (retention periods)
- I4
- T2 (classifier)
- T5 (sub-processors)
- N4 (ef_search)

---

# PART A — THE QUESTIONNAIRE

## 0 · Housekeeping and approvals (yes/no)

### Q0.1 · Fix the decision numbering

- Scheduling's rulings are drafted as "#335", but #335 is now the providers spec.
- `FINANCE_BUILD_PROMPTS.md` F0 still records "#251", but #251 went to Teams W1 and #337 supersedes
  it.

Approve the following:

- (a) give scheduling the next free number;
- (b) re-point every "#251 (x)" in FBP to its #337 D-item;
- (c) rewrite F0, because it is obsolete as written.

- [x] Yes ⭐ · [ ] No — Answer: ______

### Q0.2 · Destructive changes that need your approval (Additive Rule / root §1)

Answer each line separately:

| #  | Change                                                                                                                                                                                                                                | Rec                             | Yes / No         |
| :- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------ | :--------------- |
| a  | Remove the `authenticated` INSERT/UPDATE/DELETE storage policies on 6 buckets, and drop SVG from `public_assets` (SEC E8/G10, #340 (d)). This is the **last open P0**, and it unblocks ClamAV, NudeNet, admission and quota metering. | ⭐ Yes                          | Yes              |
| b  | Drop the dead tables `security.refresh_tokens` and `security.turnstile_verifications` (IW-M6).                                                                                                                                        | ⭐ Yes                          | Yes              |
| c  | Change the cascades to RESTRICT on `finance.payout_splits`, `split_rules`, `contribution_agreements` and `vault_permissions` (K11; these sit next to escrows).                                                                        | ⭐ Yes                          | Yes              |
| d  | Drop the dead `finance.escrows.fx_*` snapshot columns (FBP DB8 / C7). 🖊 Keep them as "reserved" if you pick FX conversion in M5 (c).                                                                                                  | 🖊                               | Keep as Reserved |
| e  | Drop the `awaiting_payment` order-enum value (FBP DB7). The alternative is to retire it in the comment only.                                                                                                                          | ⭐ No, retire it in the comment | No               |
| f  | Delete `search.fn_search_entities` and `fn_search_global`. The revoke is already done. SEC G11 says this needs a human; RED treats it as a quick win.                                                                                 | ⭐ Yes                          | Yes              |

### Q0.3 · Register the scheduled-job set (#203 (a), PM D1, SDG D9)

pg_cron jobs are written but not registered. Approve registering this whole set in `00005060`:

- the claim-TTL sweep (15 min, hardened: SKIP LOCKED, status re-check, history row, notices to both
  sides);
- the comms queue worker plus escalation, digests, sweep, reaper and compaction;
- discovery-call expiry (15 min) and vote settlement;
- spend-approval expiry and the idempotency-key sweep;
- `query_logs` retention.

The workload-report sweep follows P3 (workload reporting).

- [x] Yes, register all of them ⭐ · [ ] Only: ______

### Q0.4 · Factual doc corrections: approve them as one sweep

These need sign-off only, not a ruling:

- #340 (a), (h), (j), (k), (l), (m);
- #339 (e), (i), (k), (l);
- FDD §3 (X11–X14, X19, X22, X23, N30);
- FA (d), (s);
- IDG §4;
- scheduling (c), the stale Tables.md §3.

- [x] Approve all ⭐ · [ ] Approve except: ______

### Q0.5 · Root `CLAUDE.md` (a human edit; agents may not touch guardrail files)

- (a) ADC Q1: replace hard counts ("135 decisions") with pointers.
- (b) Persona row 3: "adjusted by Standing" belongs to the marketplace **commission**, not the stage
  fee. This follows from M1.

- [ ] Draft the diff for me to apply ⭐ · [ ] I'll do it · [ ] Leave it
- [x] You have permission to edit the claude.md as needed

---

## 1 · Money and fees

### M1 · Fee on product sales: commission or 5%? (FDD D-3, X3/X4, N3, FA (q); ADC Q1; SBP #252 (l))

Today product sales charge the buyer's 5% platform fee. The seeded seller commission ladder (8%
falling to 6.5% by Standing) is never called.

- [x] **A** — Sellers pay the Standing-tapered commission on product sales. #187's payer-rate rule
      is scoped to escrow fees. ⭐
- [ ] B — Keep 5% at the payer's rate, and delete the commission ladder from FM and PS.
- [ ] C — Commission, floored at the payer's negotiated rate.

Sub-question: on `/pricing`, show the fee as one sentence ("same on every plan") and the Standing
taper as one line linking to help?

- [x] Yes ⭐ · [ ] No

Answer / notes: ______

### M2 · Ledger model (FDD D-5, X6/X8, #54 (b))

- [x] **A now, B before scale** ⭐
  - A: a per-currency conservation-identity view, checked nightly beside `fn_reconcile_wallets`,
    with an ops reader.
  - B: shadow double-entry, written by every money definer. Triggers for B: live money beyond a
    pilot, an enterprise audit-trail ask, or an auditor or regulator.
- [ ] B now
- [ ] C — derived balances now (a big-bang rewrite; needs Additive approval)

⚖️ Confirm with Stripe and counsel how long escrow may sit in the platform balance under Separate
Charges & Transfers, and what safeguarding posture follows. FM §9 says "legally segregated", but the
code cannot prove it. Answer: ______ (the brief for counsel is Part D, Decision #473)

### M3 · Disputes inside the 7-day clearing window (FDD D-6, FA (c), #126, #191 B3; gates FBP DB6)

- [x] **A** — Freeze the payee's pending rows on dispute (on_hold). ⭐
  - A lost dispute recovers from those rows first, then the payer, then platform loss.
  - A won dispute restores the original `available_at`.
  - Inside the 7 days only. Published line: "Money that has cleared is yours; money still clearing
    can be held while a payment dispute is open."
- [ ] B — Status quo: recover from the payer only.
- [ ] C — A platform reserve funded from the fee.

### M4 · Where the payout-ready (KYC) gate bites (FDD D-7 + D-2 rider 1, FA (e); SA G4 = #252 (i) = #196 (b))

- [x] **A** — Gate at listing publish, at session/seat booking, and at enabling paid calls. For a
      team, every shareholder must be payout-ready. ⭐
- [ ] B — Earn freely; gate only withdrawal.
- [ ] C — Gate at the buyer's checkout.

Sub-question: at team **invite**, should an unverified invitee be refused, or should the gap only be
shown?

- [x] Show readiness on the roster and refuse at accept ⭐ · [ ] Refuse at invite

### M5 · Currency bundle (FDD D-8, FA (m), (n), (o), #54 (a); gates FBP DB8/DB9)

| Sub | Question                                              | ⭐ Recommendation                                                                                                                                                             | Your answer                                                                                                                  |
| :-- | :---------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| a   | Platform settlement currency                          | Per-currency Stripe balances for the 12 display currencies. The alternatives are converting at payout with a disclosed spread, or the status quo plus a reconciliation alert. | As Recommended                                                                                                               |
| b   | Where an entity's currency comes from                 | The owner's country, through one map in `countries.ts`. Projects default to the owner's currency, not USD.                                                                    | As Recommeded, ensure that there are services that can check the users current location and device/browser currency settings |
| c   | Stranded balances                                     | Launch per-currency and withdraw-only. Build a disclosed-spread conversion later.                                                                                             | Build the disclosed spread conversion now to ensure less refactoring later on                                                |
| d   | Who bears the FX spread (rule this before c is built) | Mid-market plus a disclosed margin, paid by the payer.                                                                                                                        | As Recommeded                                                                                                                |
| e   | Thresholds                                            | Per-currency maps for `on_account_limit` and `vault_approval_threshold`. This is P0 whatever else you decide.                                                                 | As Recommeded                                                                                                                |
| f   | Rates                                                 | A daily FX feed **and** a staleness mark on every converted figure.                                                                                                           | As Recommeded                                                                                                                |

### M6 · Automation that saves settings but never runs (FDD D-10, FA (j); FBP DB4/DB5/SV3/UI3)

- [x] **Lock each control behind a LockedDialog reason until its engine runs.** ⭐ Build order:
      payout schedules, then pots, then the income smoother. The smoother needs a PRODUCT_SPEC entry
      first.
- [ ] Leave the controls savable. This fails merge gate §3.11.

Pot model (FBP DB5):

- [x] An earmark inside the wallet, not a separate balance ⭐ · [ ] Separate balances

### M7 · Deadline bonuses (FDD D-11 / N4; DL D16-a)

The bonus money is never held, and the +10% bonus is in no source-of-truth doc. PS gives it to
one-offs; the build gives it to pipelines only.

- [x] **C then A** — Refuse non-zero bonuses now with a CHECK. Then hold the bonus with the escrow
      at funding, and refund it fee-free if the deadline is missed. ⭐
- [ ] B — A separate hold taken when the deadline is met.

🖊 Which project types get the bonus?

- [ ] One-offs
- [ ] Pipelines
- [x] Both

### M8 · Commerce rules (FDD D-12, FA (p), (r); FBP DB7)

| Rule                               | ⭐ Recommendation                                                                                                                               | Agree? |
| :--------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- | :----- |
| Refund on a digital product        | None after the first download, except non-delivery or a defective file through a dispute. Recovery comes from the seller's pending row, per M3. | Yes    |
| Order state after an escrow refund | The line becomes refunded. The order becomes refunded only when every line is.                                                                  | Yes    |
| Order lifecycle writers            | Write `invoiced` (on-account), `refunded` and `cancelled`. Retire `processing` and `awaiting_payment`.                                          | Yes    |
| Promo codes                        | Record the code on the order. Default one redemption per account per code, configurable per code.                                               | Yes    |
| Refunding a session forfeit        | The provider may refund it voluntarily.                                                                                                         | Yes    |

### M9 · 🖊 A failed bank payout (FDD X20, #202 (a))

FM §8 says the funds bounce back to the Personal Wallet. As built, the money stays in the Stripe
payout account. The audits make no recommendation.

- [ ] Return the money to the wallet (as the spec says)
- [ ] Keep it in the Stripe account and amend FM §8
- [x] Whichever option is most widely acceptable in accordance with the law

### M10 · Team money: splits, departures and treasury (FA (f)/A19; IDG F3 rider; SBP #252 (d), X1)

- (a) A team downgraded below Pro keeps its Pro split template, and a departed finder is still paid.
  Proposal: fall back to `co_op` and drop the departed finder's cut.
  - [x] Yes ⭐
  - [ ] No
- (b) A departing member's share redistributes according to the team's split rule (a PS §Teams
  promise).
  - [x] Confirm ⭐ · [ ] Other: ______
- (c) Agency treasury:
  - [x] [1] Per-engagement contribution agreements on the single split rule ⭐
  - [ ] [2] Squads as sub-entities with their own split rule
  - [ ] [3] Both

---

## 2 · Sessions, calls and scheduling

### C1 · Paid 1-on-1 discovery calls (FDD D-2 = SDG D1; S-02, N2 — a P0)

Paid calls can be booked today with no payment, no cap and no expiry.

- [x] **Turn the paid flavour off now** (refuse `paid_unavailable` and hide the paid card), then
      build **Option C**. ⭐
  - Option C: one hidden "Consultations" engagement per host, reusing #211's session rail.
  - Money is held at request and refunded on decline or expiry.
  - `paid_enabled` requires payout-ready (M4).
- [ ] Option A — make `escrows.project_stage_id` nullable. This forks about 25 functions and needs
      Additive approval.
- [ ] Option B — a micro-project per call.
- [ ] Option D — retire paid calls permanently.

### C2 · Cancellation, reschedule and release windows (FDD D-1, D-4; SDG D2; #71 (a), #72 (b), #211 (c))

- (a) Late cancellation:
  - [x] **100% forfeit, as built and in #171** ⭐
  - [ ] 50% (FM §4)
  - [ ] Tiered: 100% under 12h, 50% at 12–24h
- (b) Reschedule lockout:
  - [x] **C** ⭐ — money-bearing events use the money window (lockout = vote lead =
        `session_cancel_notice_hours`), and other events keep 12h. Includes:
    - a 60-minute grace for bookings made inside the window;
    - a provider-moved sitting inside the window counts as a provider cancellation for anyone who
      did not support the move.
  - [ ] A — 24h everywhere
  - [ ] B — 12h, with the dissenter rule
- (c) Session release: a 24h **review window** plus 7 days of **pending**, keeping both steps and
  renaming the first.
  - [x] Yes ⭐
  - [ ] Sessions skip the 7 days
  - [ ] One 7-day window with a 24h no-show claim

### C3 · Discovery-call doors (SDG D3)

Approve this door matrix:

- confirm and decline (host; decline refunds);
- propose a new time (either side, outside the lockout);
- cancel (lateness derived);
- no-show (from start + 15 min, with presence evidence);
- a 15-minute expiry job;
- the system completes courtesy calls past their end time.

- [x] Yes ⭐ · [ ] Changes: ______

### C4 · Integration runtime and presence (SDG D6, D4; #59; draft (d))

- (a) Runtime:
  - [x] **Fresh routes plus pg_cron http jobs** (CalendarSync- and RoomBackendService, a
        deduplicated webhook route). Amend SA §3.3. ⭐
  - [ ] Supabase Edge Functions
- (b) Presence:
  - [x] **Per-registrant join links minted by the platform**, with email as a flagged fallback ⭐
  - [ ] Email matching (spoofable)
- (c) 🖊 The token vault key (#59):
  - [ ] KMS
  - [x] `ENCRYPTION_KEY` env
- (d) The Zoom seed says `supports_webhooks=false`, but the presence webhook ships.
  - [x] Fix the seed to true ⭐

When selecting a meeting location, such as for zoom, the meeting should be creating in that third
parties calendar as well with a link automatically populated upon creation of the event. For
example, if the location is Zoom, when a session or call if created or set up, the user should not
need to manually create a new link in zoom, a link for it should autmatically appear for both the
freelancers and clients.

### C5 · Session settlement edge cases (SCA S-08, S-21)

- (a) A sitting with no presence data:
  - [x] Hold it for review ⭐ · [ ] Release it on negative consent
- (b) Dispute dismissal threshold:
  - [x] Code to "> 80%", per the spec ⭐ · [ ] Ratify ">= 80%"
- (c) A missing "left" event counts as present today.
  - [x] Fix ⭐

### C6 · Coordination rules (SDG D5, D7, D8). Accept each ⭐?

- [x] D5: the majority denominator follows the TS rule; correct the enum comment, and the workspace
      read excludes the host.
- [x] D7: courtesy-call reliability feeds Standing at low weight, only from presence-verified
      no-shows, at most 1 mark per counterparty per 30 days.
- [x] D8: at most 3 unapproved attendee slots; a replacement keeps the original duration; a 24h span
      backstop.

### C7 · Calendar UI (SCA S-25; draft (e))

- (a) Until an event write door exists, the authoring controls are:
  - [x] Hidden ⭐ · [ ] Labelled "preview only"
- (b) Month view:
  - [x] Continuous scroll, as built (DS is fixed to match) ⭐ · [ ] Paginates, as DS says

---

## 3 · Projects and execution

### P1 · Fair Exit (DL D2, D16-c; FDD D-9 (b); #198 (b), (e), (f))

The client picks 25/50/75%. FM §3 derives 0/50/100% from elapsed time.

- [x] **B now, A once deadlines are reliable** ⭐
  - B: the server derives a tier that acts as a **floor** the client may only raise, and the payee
    can contest it through the Evidence Vault.
  - A: the server derives the tier and the client only confirms.
  - Rejected: amending the spec to the built chooser.
- With no stage deadline, fall back to the submissions: one on file gives 50%, an accepted one gives
  100%.
  - [x] Yes ⭐
- 🖊 Who is notified of a Fair Exit?
  - [x] Owner and acting reviewer (as built)
  - [ ] Every billing member
- 🖊 A multi-stage ticket on the ended stage is cancelled, so its later stages never run.
  - [x] Accept
  - [ ] Carry it forward

### P2 · Removal, deletion and archive (DL D3, D4; #163; root §5; SCA S-25; PMA S13)

- (a) Removing a freelancer, or deleting a ticket, pays the freelancer 100% today.
  - [x] **B + C** ⭐ — before `in_progress`, refund the client (TTL parity); after it, apply the P1
        split at ticket level through a ticket-level Fair Exit door.
  - [ ] Keep 100%
- (b) "Nothing is hard-deleted":
  - [x] **Hard-delete only a ticket or stage that was never claimed, funded or submitted against;
        archive everything else** ⭐. This means:
    - adding `tickets.archived_at`;
    - dropping the project DELETE policy and the stage hard-DELETE;
    - calendar events archive too.
  - [ ] Other: ______
- (c) `payment_status='refunded'` is documented but never written.
  - [x] Write it ⭐ · [ ] Correct the doc

### P3 · Spec promises with no build: build now, or mark them Planned

| Item (source)                                                          | ⭐ Recommendation                                                       | Build now / Planned                                         |
| :--------------------------------------------------------------------- | :---------------------------------------------------------------------- | :---------------------------------------------------------- |
| 14-day ghosting auto-approve, with notices at 7 and 13 days (FDD D-9a) | **Build (P1)**, needed for "No Forever-Escrow"                          | Build                                                       |
| Maintenance cycles, 48h negative confirmation, 3-day pre-auth (D-9c)   | Planned; strike "pre-authorize"                                         | Planned                                                     |
| Instant payouts (D-9d)                                                 | Planned; fee unset until priced                                         | Planned                                                     |
| Workload reporting / $W_i$ dispute (DL D5)                             | Planned for MVP; build before the agency tier                           | Build now                                                   |
| Round-robin and parallel-stream assignment (DL D6)                     | Planned; ship open_pull plus manual (unless the agency tier needs them) | Planned                                                     |
| Global Workload Kanban (DL D15)                                        | Planned                                                                 |                                                             |
| Stage dependencies as an engine (DL D7)                                | Presentation only now; the cycle guard either way                       | Build                                                       |
| Kanban canvas rewrite (DL D8)                                          | No: keep DOM, and window the columns after measuring                    |                                                             |
| SMS notifications (CAS #339 (n))                                       | Correct PS, and hide the SMS toggle until Twilio                        | Set up whatever is needed for twilio while I get the tokens |
| E2E-encrypted chat (SA:683, #339 (j))                                  | Drop it from SA; keep encryption at rest                                | Planned after MVP                                           |
| Context-aware ranking and pgvector KV cache (#339 (c))                 | Planned                                                                 | Build now                                                   |

### P4 · Store the CREATE category for $W_i$ (DL D9)

Today $W_i$ is difficulty alone. Proposal:

- add `project_stages.create_category`;
- make the six weights platform-param dials;
- compute $W_i$ in SQL at commit;
- existing tickets keep their figure.

- [ ] Yes ⭐
- [ ] No
- [x] Disconnect workload intensity from CREATE category completely. Wi should instead be a
      measurement calculated after finding out additional data about how efficiently the freelancer
      works: How long each project takes, if multiple projects results in a significant bottle neck,
      how long the freelancer says they will take compared to how long they actually take, how long
      a client requests for a job to be done compared to how well the freelancer has hit that
      deadline. Workload intensity shoulf be a data based metric as a collation of many other
      metrics to provide a singlular score on performance and efficiency in comparision to what a
      client would be looking for. It should not be based on arbirary metrics such as the CREATE
      category or the workload instensity set in a ticket - though it may factor in.\
      When there is not enough data to know about the freelancers performance, the workload
      intensity is set to a baseline until more data comes in.

### P5 · Board authority (DL D10, D12, D16-b; #293 (b); ADC Q14)

- (a) Unclaimed ticket moves belong to review authority plus granted ticket managers (#294).
  - [x] Yes ⭐
- (b) A claimed ticket is draggable only by the people allowed to move it (today `canDrag` is true
  for everyone).
  - [x] Yes ⭐ - they are the project owners or admins with explicit permissions, they can also be
        project manager type freelancers within a business with explicit permissions. This
        freelancer type has not yet been introduce and has no support for it yet.
- (c) 🖊 Lock `due_date` after a claim?
  - [ ] Yes
  - [x] No - Due date should stay the same if there is a claim
- (d) A draft submission is visible only to its submitter and their team until sent.
  - [x] Yes ⭐
- (e) Pure rules are mirrored in TS with a SQL parity test; state-dependent rules (caps, balances,
  rollups) come from the server as DTO flags. Never a permissive client on money paths.
  - [x] Yes ⭐

### P6 · Chain Reaction price (DL flag (k))

Today a ticket price overrides every stage price in its chain.

- [ ] Per ticket (as built)
- [ ] Per stage

### P7 · Addressable state and URLs (DL D11, D13, D14; SCA S-31; #315 (a); #339 (f) addresses in N1)

Approve all of these:

- A 303 to the parent page for views a type doesn't answer.
- Board `?view=&group=&q=&sort=&dir=`.
- Calendar `?view=&date=&zoom=&kind=`.
- `/files` sort, search and facets in the URL.
- Submission-tree addresses as `stg-` · handle · number.

- [x] Yes ⭐ · [ ] Except: ______

---

## 4 · Subscriptions and plans (#252)

### S1 · Naming and page shape (#252 (a), (e), (k))

- Agency tier: code `team_agency`, label "Agency".
  - [x] ⭐ · [ ] Other: ______
- `/pricing` gets a header slot (the plane switcher) and **no** conversion lane.
  - [x] ⭐
- Tab grouping: "Team / Agency" and "Business / Enterprise", with Enterprise as the custom-priced
  column.
  - [x] ⭐

### S2 · 🖊 Prices (#252 (b)) — figures in GBP

| Plan                            | Monthly                                                                                                            | Annual (or discount %) |
| :------------------------------ | :----------------------------------------------------------------------------------------------------------------- | :--------------------- |
| Agency (flat or per seat? ____) | Alter free teams max size to 6. Agencies pay flat up to 20 seats then per seat. £14.99 flat, £1.29 per set over 20 | 30%                    |
| Business Pro (currently NULL)   | Same as agency                                                                                                     | 30%                    |
| Every other paid plan           | (existing)                                                                                                         |                        |

Storage: a `finance.plan_prices` child table, one row per plan × interval. Unpriced plans show
"Price coming soon".

- [x] ⭐

### S3 · 🖊 Agency proposal pool (#252 (c))

Finite, never seats × n. The suggested start is 300 per week plus 8 per 10h.

- Pool: 300 /wk · buffer: 18

### S4 · Entitlement keys and enforcement (#252 (h), (j))

- Reuse `team_seats`, `weekly_proposals` and `audit_log_retention_days`.
- Add only `custom_treasury_export`, enforced as a tool flag (402).
- `team_public_projects` stays fail-open.

- [x] Yes ⭐

### S5 · How a plan is paid (#252 (f); #238)

- [x] **Stripe Billing Checkout, card, recurring; platform revenue, never the wallet** ⭐ · [ ]
      Monthly wallet debit
- Who may buy:
  - [x] Team owner, or a business member with `manage_billing` ⭐
  - Note: the team role filter drops `manage_billing`, so on a team only the owner can buy. 🖊 [ ]
    Accept · [ ] Let team co-owners buy
- Downgrades take effect at period end.
  - [x] ⭐

### S6 · Which subscription states keep a plan (#252 (m))

- [x] **trialing · active, plus past_due for 7 grace days; paused falls back** ⭐
- [ ] trialing · active · past_due · paused, with no grace

### S7 · Enterprise domains and SSO (IDG F5, F6; #252 (b), (j))

- (a) Domain-colleague alerts (already disabled):
  - [x] Rebuild later on DNS-verified domains with a free-mail denylist ⭐ · [ ] Remove permanently
- (b) SSO:
  - [x] **Hide the SSO panel now**, with the roadmap verified domains → SAML (GoTrue) → JIT seat ⭐
  - [ ] Generic OIDC first
- (c) 🖊 Which plan carries SSO?
  - [x] Enterprise only · [ ] Business Pro too

### S8 · 🖊 Agency importers (#252 (g))

Suggested: CSV plus one tracker first, with attachments mounted rather than copied.

- First tracker:
- [ ] Jira
- [x] ClickUp
- [ ] Asana
- [ ] Linear
- Attachments:
- [x] Mounted ⭐
- [ ] Copied

---

## 5 · Identity, privacy and compliance (#336)

### I1 · Erasure: one model across every audit (IDG F1, F2, F3, K1; SEC G16; CAS S17)

- (a) What survives:
  - [x] **B: a legal-hold vault** ⭐ — a minimal encrypted identity record linked to the retained
        ledger rows, service-role only, purged at the end of the statutory period.
  - [ ] A: full anonymisation
  - [ ] C: keep the account until retention ends
- (b) Windows:
  - [x] **90 days for "switch to client"; explicit erasure requests ≤ 30 days**; both windows as
        platform params ⭐
  - [ ] 30 days for everything
  - [ ] 90 days for everything
- (c) Workspace seats:
  - [x] **Leave every seat when erasure is _scheduled_** ⭐
  - [ ] Block deletion while seats are held
  - [ ] Leave at day 30
- (d) Erasure also nulls search embeddings, query logs and affinity rows.
  - [x] Yes ⭐
- ⚖️ Counsel:
  - Does the wallet make Projective AML-obliged?
    - **Owner position:** No, Projective operates as not AML-obliged. But every AML function, record
      and process that shows due diligence must exist and be deployable, in case a court or
      regulator rules that it is.
    - **Architect note:** "deployable" can't fill in records that were never captured. The data half
      has to run from day one:
      - CDD and KYC references, and the transaction-monitoring signals;
      - retention long enough to cover the AML period (UK: 5 years after the relationship ends);
      - so I1 (a) option B, the legal-hold vault, has to keep the AML-grade identity set.
    - The programme half can stay dormant behind flags: MLRO role, suspicious-activity review queue,
      regulator registration, reporting exports.
    - Counsel still needs to confirm the "No".
  - What are the retention periods per record type (ledger about 7 years?)?
    - **Owner position:** keep each record class for the longest period any obligation could
      require, assuming the AML-ready posture above. Every period is a `security.platform_params`
      dial with a per-jurisdiction override, never a hard-coded constant. Counsel to confirm.

      | Record class                                                                                 | Retain for                                                          | Basis                                                                          |
      | :------------------------------------------------------------------------------------------- | :------------------------------------------------------------------ | :----------------------------------------------------------------------------- |
      | Ledger, escrow, payouts, invoices, orders, fees                                              | 7 years after the end of the financial year                         | UK statutory 6 years, plus a buffer; override where stricter (DE/FR: 10 years) |
      | Legal-hold identity set (legal name, DoB, country, Stripe/KYC refs)                          | 5 years after the relationship ends, or the ledger period if longer | MLR 2017 reg. 40 (AML-ready)                                                   |
      | Seller tax-reporting data (platform reporting)                                               | 6 years (UK), 10 years (EU sellers, DAC7)                           | Digital-platform reporting rules                                               |
      | Dispute record and its evidence (Evidence Vault, the messages attached to it, presence data) | 6 years after the dispute closes                                    | UK limitation period for contract claims                                       |
      | Consent and terms-acceptance records                                                         | Life of the account, plus 6 years                                   | Proof of lawful basis                                                          |
      | Security and auth logs                                                                       | 12 months                                                           | Incident investigation                                                         |
      | Messages, files and profiles not under a hold                                                | Erased with the account                                             | No obligation                                                                  |
      | Search query logs and embeddings                                                             | 90 days, and erased with the account                                | Minimisation                                                                   |

  - Does the erasure statement cover PITR backups?
    - **Owner position:** yes. The published statement says:
      - erased data persists only in encrypted backups until they expire (the PITR window plus the
        backup rotation, at most 30 days);
      - backups are never used for normal access;
      - any restore re-applies every erasure before the system goes live.
    - This needs an erasure log that survives a restore: a tombstone of erased subject ids and the
      time each was erased, with no personal data in it. The restore runbook replays it. The "beyond
      use" posture follows the ICO's guidance.

  Answer: see the owner positions above. Counsel to confirm the AML "No" and the retention table.
  Brief: Part E.2, E2.1–E2.3 (#528).

### I2 · Is an enterprise owner a person? (IDG F4; #87 (b), (c))

- [x] **A: every natural person gets a `users_public` row with DoB** (wizard step 1.6, plus a
      back-fill) ⭐
- [ ] B: keep profile-less owners, plus a DoB attestation

`fn_is_minor` fails closed either way.

### I3 · MFA and session revocation: one sensitive-route guard (IDG F7, F9)

- (a) MFA:
  - [x] **Opt-in TOTP for everyone, plus mandatory step-up (AAL2)** for withdrawals, payout-account
        changes, ownership transfer, co-owner grants and erasure ⭐
  - [ ] Opt-in only
  - [ ] Defer
- (b) Revoked sessions:
  - [x] **Keep the 1h JWT; check `auth.sessions` (KV-cached) on the same money, authority and
        erasure routes** ⭐
  - [ ] A 15-minute JWT
  - [ ] Accept the gap

### I4 · ⚖️ Minors (IDG F8)

- Workspaces:
  - [ ] **Minors stay in personal projects and portfolios; drop the proxy model until counsel
        designs one** ⭐
  - [x] Build the adult-proxy model
  - [ ] Verified guardians
- EU/EEA users aged 13–15:
  - [x] **One global rule with a non-consent basis; no marketing email or non-essential cookies
        under 16** ⭐
  - [ ] Each member state's Art. 8 age
  - [ ] Refuse EU sign-ups under 16
- Correct PS's "Article 9" rationale to Art. 5(1)(c).
  - [x] ⭐
- Brief: Part E.2, E2.4 (#528).

---

## 6 · Trust, safety and moderation (#340, #147, #148, #335)

### T1 · Protected-phase scope (#340 (b), L4)

- [x] **Adopt SEC §2.6** ⭐ — threads that start on a marketplace surface (inquiry, listing, explore
      card, proposal) are protected until the first escrow funds or 30 days pass. Profile DMs
      between connected users are unprotected. Add a cooling-off window after an engagement ends.
- [ ] Keep the code as is
- [ ] Other: ______

### T2 · Screening public copy (#340 (c); P-5; SEC open items)

- (a) BEFORE INSERT/UPDATE triggers refuse at the DB floor; services translate the error to 422.
  - [x] Yes ⭐
- (b) 🖊 Text classifier:
  - [ ] Small self-hosted model
  - [x] Hosted fallback
- (c) 🖊 Categories NudeNet misses (violence, hate symbols):
  - [x] Hosted fallback
  - [ ] A second model
- 🖊 GIF/video frame-sampling density: ______

#### T2.1 · Owner direction: the screening stack

| Concern                                         | Engine                                                                                | Where it runs                           |
| :---------------------------------------------- | :------------------------------------------------------------------------------------ | :-------------------------------------- |
| Images: nudity / visual                         | NudeNet                                                                               | Self-hosted CPU container (safety node) |
| Images: text inside images (PII in screenshots) | Microsoft Presidio Image Redactor (OCR)                                               | Safety node                             |
| Violence, hate symbols; cloud fallback          | **Sightengine** (hosted API). This answers T2 (c).                                    | Hosted                                  |
| Links                                           | Google Safe Browsing v4 (`files/link-reputation.ts`)                                  | Hosted                                  |
| Malware and file type                           | MIME/magic-byte sniffing and image decoders (`@server/services/media`); ClamAV per T5 | In-process; safety node                 |
| Text and PII, Tier 1                            | In-process pre-filter: Unicode normalisation, `tldts`, `linkify-it`, Luhn checks      | Send path, synchronous                  |
| Text and PII, Tier 2                            | DB regex in `BEFORE INSERT` triggers running `comms.mask_pii`                         | Postgres, synchronous                   |
| Text and PII, Tier 3                            | Microsoft Presidio Analyzer: spaCy NER plus custom contextual regex recognisers       | Safety node, async, off the send path   |

#### T2.2 · Owner direction: PII split across consecutive messages

**The gap.** A sender can split PII across messages ("555", "123", "4567") so that no single-message
regex sees it.

**Where the check lives.**

- Tier 2 stays single-row. Cross-row lookups or concatenation inside a synchronous trigger would add
  write latency, contention and deadlock risk to live channels.
- Tier 3 is asynchronous, so it is the right place to catch multi-message evasion without slowing
  delivery.

**Design.**

1. **Rolling context window.** The Tier 3 worker buffers the last _N_ messages, or a 3–5 minute
   window, per (`sender_user_id`, channel / `dm_thread_id`).
2. **Normalised concatenation.** Join consecutive texts after stripping whitespace, zero-width
   characters, line breaks and punctuation.
3. **Sliding re-score** of the joined string:
   - a digit-run collector runs Luhn checks (cards) and country-specific format checks (phone
     numbers, E.164);
   - Presidio custom recognisers catch split phone numbers, fragmented emails (`user` → `at` →
     `domain.com`) and segmented external handles.
4. **Consequence.** When the joined buffer crosses the suspicion threshold, write an immutable
   `ops.reports` row flagged `evasion_fragmentation` for human review, and queue a penalty against
   the sender's Reliability Index ($R_i$).

#### T2.3 · Architect notes (confirm or override each)

- [x] **Safe Browsing licence.** The v4 API is licensed for non-commercial use only (SEC §6, EPI
      flag (c)). Naming it here conflicts with T5's open choice.
  - ⭐ Use **Google Web Risk**. It is the commercial twin with the same lookup shape, so
    `link-reputation.ts` changes little. Either way, SA:1149-1150 must disclose the URL lookups
    (#340 (j)).
- [x] **Sightengine is a new sub-processor.**
  - It must be registered in the providers spec (#335 / EPI) and disclosed in SA §Security.
  - It needs data-processing terms.
  - ⭐ Send it **Glass Front (public) media only**, never private-zone files. This matches the
    two-zone model in SEC §3.
- [x] **(b) Text classifier: which hosted provider?** "Hosted fallback" is ticked, but no vendor is
      named, and Presidio detects PII rather than toxicity.
  - ## ⭐ Use Sightengine's text moderation, so one hosted vendor covers both. 🖊 Or name another:
- [x] **Window scope.** ⭐ Run the fragmentation window only on threads inside the **protected
      phase** (T1). Once escrow funds, sharing contact details is allowed, so scanning after that
      point only produces false positives.
- [x] **No payload kept.** ⭐ The rolling buffer lives in worker memory (or KV with TTL = window
      length) and is never persisted. This matches EPI's "the node keeps no payload". `ops.reports`
      stores a reference to the message ids, never the reassembled text (the same rule as #147 (b)).
- [x] **Penalty only after human confirmation.** ⭐ An `evasion_fragmentation` report queues for
      review, and the penalty lands only when a reviewer confirms it. Digit runs from prices, order
      numbers and dates will produce false positives.
  - 🖊 Confirm the target: the **Reliability Index** ($R_i$), or Standing's
    `entity_standing.penalty_severity` (T4)? The audits route content-report penalties to the
    latter. ______
- [x] **Dependencies.** This needs the T4 review sink (`ops.reports` with `source`). It also needs
      `evasion_fragmentation` added to the #148 (g) reason vocabulary, and the Tier 3 node (T5).
      Fail mode stays **open**: Tier 2 is the floor (SEC §6 step 4).

### T3 · Public images (#340 (e), (f))

- (a) Public library rows serve originals with EXIF, worldwide.
  - [ ] Route them through publish (renditions only)
  - [x] Treat them as a screened Glass Front surface
- (b) A private group's photo in the public avatars bucket is Glass Front and gets screened.
  - [x] Yes ⭐

### T4 · Reports, penalties and Standing (EPI (g); #148 (a), (c), (d); #147 (b); #340 (i))

- Review sink: an `ops.reports.source` column.
  - [x] ⭐ · [ ] Separate findings table
- Content-report penalties feed `entity_standing.penalty_severity`.
  - [x] ⭐
- Refusal logging: a count per user per day, never the text.
  - [x] ⭐
- `discovery_penalty` is read server-side only; guests no longer read it.
  - [x] ⭐

### T5 · The safety node and sub-processors (#335 EPI proposed; AV-5; EPI (c); #339 (d); #340 (g))

- Approve EPI §6: a self-hosted node running ClamAV, NudeNet and Presidio (4 vCPU / 8 GB).
  - [x] ⭐
- Office files with macros: admit privately, record, never publish.
  - [x] ⭐
- 🖊 Google Safe Browsing (non-commercial licence):
  - [x] Move to Web Risk
  - [ ] Keep it and disclose in SA
- 🖊 Embeddings endpoint:
  - [x] Pin `VOYAGE_API_BASE` to Voyage
  - [ ] Disclose MongoDB Atlas
  - Plus written no-training terms before `EMBEDDINGS_ENABLED`.
- ⚖️ Hash-match uploads against known illegal imagery (PhotoDNA) in both zones.
  - [x] Yes ⭐ (counsel). Brief: Part E.2, E2.9 (#528).

---

## 7 · Messaging, notifications and search (#339)

### N1 · Unified messaging and the inbox read model (#339 (f), #218 (a), ADC Q8). One schema window

- [x] **Adopt CAS §6.1** ⭐ — this changes addresses:
  - a `cht-` slug on `dm_threads`;
  - `/messages/dm-<handle>` answers 303;
  - one `sendMessage(actor, ChatRef)`;
  - `dm_messages.project_id` is written;
  - the tables are not merged.
- Inbox:
  - [x] **`inbox_tails` RPC now, then additive summary columns plus a trigger** in the same window
        as the slug ⭐
  - [ ] A materialised view

### N2 · Live updates and cache invalidation (#339 (g); ADC Q7)

- [x] **An ETag long-poll first (SSE later); drop the five comms tables from the Realtime
      publication; invalidate caches with KV version keys bumped by the writing service, with TTL as
      backstop** ⭐
- [ ] TTL only
- [ ] pg_notify/Realtime listeners

### N3 · Notification rules (#339 (b), (h); #335 (e); #308 (a); #57 (a))

- (a) Mandatory notices ignore preferences and snooze; only types flagged `overrides_quiet_hours`
  break quiet hours for push/SMS.
  - [x] ⭐
- (b) A hard bounce blocks every category for that address and prompts the user in-app to fix the
  email.
  - [x] ⭐ · [ ] Marketing only (PS)
- (c) Sign the outbound dispatch webhook with a Vault-held bearer.
  - [x] ⭐
- (d) 🖊 Chat mute persists:
  - [x] Server-side
  - [ ] Per device

### N4 · Search ranking (#339 (a); CAS S11 vs RED DB-9)

- Write the semantic blend (0.5 weight, 0.30 floor, 12 extras) into PS, and put the dials in FM
  §16.7.
  - [x] ⭐
- 🖊 HNSW:
  - [ ] `ef_search=100` (RED)
  - [x] `200` + `iterative_scan` (CAS)
  - [ ] Per-type partial indexes

---

## 8 · Engineering doctrine and design system (#341 ADC; FA design flags)

### E1 · Caching and read models: accept the ⭐ set?

- [x] Q2 A: rewrite SA §Caching to the four real tiers, plus `cachedGlobal` on KV.
- [x] Q10 C: single-flight in `ArcCache.through` plus a shared request memo.
- [x] Q11 B+C: memory-first with KV only for small global values; fetch less with SQL aggregates; a
      placement table in SA.
- [x] Q12 C: an in-memory catalogue loaded correctly now (D-09 is P0), with a measured switch to
      per-query later.
- [x] Q13 C: memoise the wallet context, then SQL aggregates. If any displayed figure comes from the
      1,000-row window, this becomes P0.
- [x] Q9 A: JWT claims drive presentation only (add `layout_direction` and `timezone`), never role
      or capability.
- [x] Q15: a runtime DTO for product constants (`pendingReleaseDays`); literals plus a parity test
      on the landing page.

### E2 · Money on screen (ADC Q16; FDD N10)

- [x] **`MoneyView` for every visible figure, plus a lint ban on
      `formatMoney`/`Intl.NumberFormat`**. Strings only in aria and sentences. ⭐

### E3 · Design-system rulings

| #      | Question                                                                             | ⭐ Recommendation                                                                                                               | Agree?                                                   |
| :----- | :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------- |
| Q3     | Focus visibility (re-raises the owner's no-ring directive #245 (a); WCAG 2.4.7 fail) | A keyboard-only `:focus-visible` ring app-wide, plus forced-colors. The wallet allocation-ring exception (FA D20) is then moot. | Yes but not yet. I am still considering the right design |
| Q4     | Reach of the "solid active state"                                                    | Ban brand washes everywhere; the neutral `--tint` (#330) is the rule.                                                           | Yes                                                      |
| Q5     | Split-pane panes                                                                     | "One tonal step or one hairline, never a shadow, never both"; refresh the list.                                                 | Yes                                                      |
| Q6     | Card                                                                                 | A token contract plus a lint gate (not a migration of 17 families).                                                             | Yes                                                      |
| Q17    | The unused `Overlay` export (RED SC-10 describes A; ADC recommends B)                | Delete it and extract `useAppModal()`.                                                                                          | Yes                                                      |
| D-13   | Wallet lane Top up and hero pills                                                    | Top up becomes tier 1 (accent); pills stay glass; amber marks every act that starts or commits a money flow (#157 (j)).         | Yes                                                      |
| FA (l) | Reserved-funds colour                                                                | Move from aurora violet to the `--help` ramp role.                                                                              |                                                          |
| FA (h) | Enlarging finance charts                                                             | An optional "Expand" opens one Dialog; no `/inspect`.                                                                           |                                                          |

---

_End of Part A. Return the file. One session records the rulings (Part B, Wave 1.1)._

---

# PART B — EXECUTION ORDER

## B.0 Constraints that decide what can run in parallel

1. **There is one local Supabase DB.** Every SQL prompt runs `deno task db:reset` and probes against
   it, and a reset in one session wipes another session's run. At most **2 SQL sessions at once**,
   on disjoint migration files. Each session announces its resets. Code-only, UI and docs sessions
   do not have this limit.
2. **Hot files have one writer at a time.** Never put two sessions on the same one:

   | File                                 | Writers                                      |
   | :----------------------------------- | :------------------------------------------- |
   | `00001240` (finance money)           | FBP DB1–DB8, PM-WP4                          |
   | `00005060` (jobs)                    | finance, comms, PM, scheduling, security     |
   | `00001155` (sessions)                | every SCH work package                       |
   | `00001020` (workspaces)              | identity rank, archive and seat items; SA G4 |
   | `00001060` (erasure)                 | identity erasure, SEC G16                    |
   | `00001300` (comms)                   | SEC L2/L4–L8, CAS messaging                  |
   | `00002510` (grants)                  | many                                         |
   | `stripe-webhook.ts` + `00001230`     | FBP DB2, DB6; SBP S4                         |
   | `live-wallet.ts` / `wallet-scope.ts` | FBP SV2, SV3, SV5; RED WP2                   |
   | `features/devtools` + `dev-seam.ts`  | FBP SV4, UI3; SBP S4, S6; IDG F6             |

3. **Only finance and subscriptions have paste-ready prompts.** The finance ones are partly stale:
   - F0 cites #251;
   - DB1's deposit-rules half is done;
   - DB7 steps 1–2 conflict with the shipped CO20 assert;
   - UI1/UI2 are partly fixed.

   They also miss N1, N2, N3, N4, N6–N8, N12, N28, the FX feed and the conservation view. PM,
   scheduling, comms, security, identity and the redundancy audit have work packages but no prompts.
   Wave 1 writes those prompts.

## B.1 Wave 0: start now, while you fill in the form (nothing here needs a ruling)

**SQL lane** (serial; or two at once when the files differ, e.g. S-A1 ∥ S-A4):

| Step | Session            | Work                                                                                                                                                                                                 |
| :--- | :----------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-A1 | Finance P0         | The rest of DB1: `wallet_pots` SELECT-only, `update_deposit_rule`, `finance_invariants.sql`. Then N1 (bind `settle_card_payment` by metadata, plus a recovery sweep) and N5 (on-account limit lock). |
| S-A2 | Checkout P0        | DB7, revised against the shipped CO20 assert: atomic promo, `p_expected_minor`, idempotency re-check, own-listing checks. Without the per-user promo cap (M8).                                       |
| S-A3 | Comms/search P0–P1 | SEC L2 (delta smuggling), SEC E6/G12 (search visibility), SEC L4 (a)/(c), L5, L6, G9, then CAS M5/M10/M24 (same `00001300`; run after the SEC items).                                                |
| S-A4 | Projects P0        | PM-WP2 without D12 (X8 seat guard, X4/W7 capacity), then PM-WP3 constraints (without the D7 guard), then PM-WP7.                                                                                     |
| S-A5 | Identity schema    | IW-H7 per-table grants, IW-M8/M10, the `enterprise_members` CHECK, IW-H4/M4/K6 rank rule, `fn_is_minor` fail-closed, IW-L items.                                                                     |
| S-A6 | Scheduling         | SCH-WP1 (sitting doors), S-06/S-07 from SCH-WP2, SCH-WP11 (call_settings grant, under-18 guard).                                                                                                     |

**App lane** (parallel; up to 3 at once, all file-disjoint):

| Session | Work                                                                                                                                                |
| :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-B1    | Identity HTTP hardening: IW-H3 rate limits, IW-M2 CSRF, IW-M3 enumeration, IW-M1 DENO_ENV, IW-H8 orphan cleanup.                                    |
| A-B2    | RED WP3: catalogue truncation D-09 (P0) plus QW-8 and QW-9. Leave out the invalidation half, which waits for N2.                                    |
| A-B3    | SEC-P1c upload acceptance (V1, V2, V4; refuse video renditions until remux).                                                                        |
| A-B4    | Zod SSOT: FBP SV1, IW-M9, PM-WP10 row schemas. These live in separate `packages/types` folders, so one session or three.                            |
| A-B5    | Design hygiene: RED WP15 icons and dead CSS, PM-WP11, SCH-WP12, IW-D1–D5. One session per feature folder. Pull `DESIGN_SYSTEM.md` before each edit. |
| A-B6    | CI: run `supabase/probes/*.sql` in CI. This is PM-WP13 and IWA §8, the same item.                                                                   |

Also check that RED QW-1–QW-3 ("landed, uncommitted" on 2026-10-29) are in `660c9658`. The tree is
now clean.

## B.2 Wave 1: as soon as you return the form

> **Status 2026-10-30:** step 1 is done (Part C; the rows; PRODUCT_SPEC, `finance-model.md` and
> PRODUCT_MANAGEMENT; the Q0.4 sweep; the root `CLAUDE.md` edit `f1f10e31`). Steps 2–3 follow.

1. **One session only:** record every ruling.
   - Rows: #252 (subsumes SBP S0), #336, #337, #338, #339, #340, #341, and the new scheduling
     number. Use a single session so decision numbers cannot collide.
   - Also apply Q0.4's doc sweep, and draft the Q0.5 `CLAUDE.md` diff for you to apply.
2. **Then in parallel, one docs session per new file.** Each reads the rulings and writes no code:
   - refresh `FINANCE_BUILD_PROMPTS.md` (re-point to #337, drop the done steps, add the missing
     prompts);
   - write `PM_BUILD_PROMPTS.md`, `SCHEDULING_BUILD_PROMPTS.md`, `COMMS_BUILD_PROMPTS.md`,
     `TRUST_SAFETY_BUILD_PROMPTS.md`, `IDENTITY_BUILD_PROMPTS.md` and
     `OPTIMIZATION_BUILD_PROMPTS.md`;
   - each one copies FBP's §0 run-order and conflict-list format.
3. **One jobs session:** register the Q0.3 set in `00005060`. After this, a work package that adds a
   job owns `00005060` only while it runs.

## B.3 Wave 2: domain tracks in parallel

> **Status 2026-10-31:** batch 1 is merged (`f5955b7c`): T·E8, M·NT1, F·SV2, O·WP10a and T·W1. Batch
> 2 is merged (`7e476d6e`): F·DB10, I·OWN1, F·SV6, F·SV3 and O·WP3b.
>
> **Status 2026-11-12 (re-verified in code, Decision #412):** also merged are F·DB11, F·SV4,
> I·OWN2 and SCH-WP2 (`def078c2`), and SCH-WP3, WP4a, WP4b, WP5 and WP8 (`ac19de8f`, unmarked
> until now). The next batches are §B.5, which wins where it differs from the table below.

Run about **one SQL track step and two or three app/UI steps at a time**. Arrows are serial inside a
track. "⏳ X" means wait for step X in another track.

| Track                               | Order                                                                                                                                                                                                                                                                               | Cross-track waits                                                                                                                                                       |
| :---------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F · Finance**                     | DB2 → DB3 → DB4 → DB5 → DB6 → DB8 → DB9, then the new prompts for N3 commission (M1), N4 bonus (M7), N6/N8, the payout gate (M4), the conservation view (M2) and the FX feed (M5 f), all serial on `00001240`. Then SV2 → SV3; SV4; SV5. Then UI1 → UI2 → UI3; UI4; UI5.            | UI prompts: check `git status` for the #243 peers first.                                                                                                                |
| **S · Subscriptions**               | S1 → S2 → S3, then S4 ∥ S5, then S6 → S7 → S8. X1/X2 are docs and can run any time after the rulings.                                                                                                                                                                               | S4 ⏳ F·DB2 (webhook file). S7 ⏳ PUBLIC_ROUTES P8. S6 and S4 share devtools, so do not run them together.                                                              |
| **P · Projects**                    | WP1 (TTL sweep) → WP4 (Fair Exit, removal, archive) → WP5 ($W_i$ / workload) → WP6; WP8 (URLs) → WP9 (submissions).                                                                                                                                                                 | WP1 ⏳ jobs (Wave 1.3). WP4 ⏳ F·DB3 + F·DB6 (`00001200`/`00001240`). WP8 ⏳ WP3 (the UNIQUE on number).                                                                |
| **C · Scheduling**                  | WP2 interim (paid off) → WP3 (call doors) → WP4 (runtime) → WP5 (presence) → WP8 (settlement) → WP7 (windows) → WP6 (paid consultations) → WP9 → WP10. All serial on `00001155`.                                                                                                    | WP6 ⏳ F·DB7 + F·SV4 (`place_wallet_order`). WP3 notices ⏳ the comms worker.                                                                                           |
| **M · Messaging and notifications** | One schema window: N1 unified messaging + RED WP12 inbox. Then M6 long-poll (N2). Separately: N8–N12 notify engine → email → web push → SMS (if not Planned). Search: CAS S11/S14/S37/S30 + RED WP14.                                                                               | Starts after S-A3. Email ⏳ N3 rulings.                                                                                                                                 |
| **T · Trust and safety**            | E8 storage policies (Q0.2a) → SEC-P1d Tier 1 pre-filter → P2 hardening (public-copy triggers, L7 masking) → moderation loop R1 → R4 → R5 → R3 → R2 → safety node: ClamAV → admission contract (CAS §6.4) → NudeNet → Presidio.                                                      | Tier 1 is better ⏳ M's single send door (one insertion point, not two). Hardening triggers touch ticket, catalogue and event text, so run them after P·WP4 and C·WP10. |
| **I · Identity**                    | F4 enterprise owner (+IW-M7) first: it restores enterprise sign-up. Then erasure on `00001060`: IW-H6 + SEC G16 → I1 windows → seats → legal-hold vault. Then the F6 SSO-panel flag. Then IW-M5 archive. Then MFA + session guard (I3). **Last:** IW-M13 `users_public` row policy. | IW-M13 touches finance, project and business readers, so ⏳ the F, P and C SQL steps. MFA's AAL2 checks in money RPCs ⏳ F·DB phase.                                    |
| **O · Optimisation and design**     | WP2 read-path → WP11 wallet aggregates. WP10 cache primitives. WP5 shared pure rules → WP6 server capability flags. WP4 keyboard on money paths. WP7 money sweep. WP8 + WP9 card, tag, solid and lint. WP16 modal shell. WP13 chrome endpoint. WP17 SA caching doc.                 | WP2/WP11 ⏳ F·SV2/SV5. WP5/WP6 ⏳ P·WP2. WP4 ⏳ F·UI2/UI3/UI5. WP7 ⏳ F·UI5 + S5. WP13 ⏳ N2.                                                                           |

## B.4 Wave 3: verification and close-out

- F·E1 → F·E2 and S8, after their tracks.
- Every track's Z1 docs sweep.
- Then one final cross-domain docs sweep: PRODUCT_SPEC, PRODUCT_MANAGEMENT, ROUTING and
  SYSTEM_ARCHITECTURE, plus a status column on every audit file.

## B.5 Next batches (re-verified in code 2026-11-12, Decision #412)

> Where B.3 and this section differ, this section wins. Waves 0 and 1 are done; Wave 2 has landed 24
> of the 150 architecture prompts, with 13 partly built ([`README.md`](README.md) has the progress
> table; each prompts file's §0 has the evidence). Track names are B.3's; a prompt ID keeps its
> file's prefix (F·, S·, PM-, SCH-, I·, M·, T·, O·).

**Live on 2026-11-12.** Three SQL sessions opened, one over B.0 (1)'s cap: F·DB2 (`00000017`,
`00001230`, `00001240`, its own block in `00002510`), M·MS1 (slot B's head) and an unprompted
stage-intensity / create-stage change (`00000014`, `00000015`, `00001130`, `00001170`, `00001175`,
`00001850`, `00002510`, the board and pricing TypeScript). No new SQL session starts until two of
them land. M·MS1 has landed (`bbcf3506`, after a clean shared `db:reset`: 133/133 probes), and so
has F·DB2 (`dd3986e5`).

**The `00002510` assumption (owner to confirm).** B.0 (2) gives each hot file one writer at a time,
and nearly every SQL prompt writes `00002510`, so under that rule the SQL lane is one session wide.
This plan assumes the practice F·DB2 follows: a session adds its own grant block and edits no other
hunk, and a prompt that must change an existing grant line holds the file alone. Under strict B.0,
slot B takes only prompts that leave `00002510` alone: PM-D7a, I·HK1, O·Q9, I·MIN1 and T·R5.

### B.5.1 Start now: app and docs sessions (no SQL slot needed)

| Session | Prompts, in order                                      | Writes                                                                     | Never beside                                                 |
| :------ | :----------------------------------------------------- | :------------------------------------------------------------------------- | :----------------------------------------------------------- |
| App 1   | SCH-WP10 (calendar URL state, authoring hidden, Month) | `features/calendar`, `packages/ui/calendar`, DESIGN_SYSTEM, ROUTING        | PM-WP8 (ROUTING), SCH-WP9 (`EventModal`)                     |
| App 2   | I·SSO1 → I·LOW1                                        | `features/auth`, `env.ts`, devtools + `dev-seam.ts` (SSO1), ROUTING        | another devtools writer (SCH-WP7, I·MFA1, S·S4, S·S6, F·UI3) |
| App 3   | F·UI1 (wallet stylesheet gates)                        | the wallet stylesheets, DESIGN_SYSTEM                                      | F·UI2, F·UI4, O·WP8 (they follow it)                         |
| Docs    | O·WP17 → S·X1 → S·X2                                   | SYSTEM_ARCHITECTURE; PRODUCT_SPEC §7, `finance-model.md`, one decision row | O·Q9, O·WP10b, O·Q12 (SYSTEM_ARCHITECTURE)                   |

**For the owner, in parallel.** Each item unblocks a step below; a prompt reaching an unanswered one
skips it.

- #410 (c), RESTRICT on `enterprise_members.user_id`: I·HK1 runs without that one FK if it is
  refused.
- #344 (f): SCH-WP7 step 6. PM §0.5 #3 (how a Fair Exit contest holds money): PM-WP4a step 6.
- #410 (g), where the notification dispatcher runs: M·NT2's entry point.
- Clone `Projective-Safety` beside this repo and finish TRUST §8.3 H1–H2: every T·SN prompt waits on
  the node.
- `deno task test:e2e` names `landing-hero.spec.ts`, deleted in `21309eeb`: a one-line fix with no
  prompt.

### B.5.2 The two SQL slots, as they free

| Slot         | Order (serial inside the slot)                                                                                                                                    | Rules                                                                                                                                                                                                                                                                                                                     |
| :----------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A · money    | F·DB2 (live) → DB12 → DB3 → DB6 → DB16 → PM-WP4a → PM-WP4b → PM-P6 → PM-GH1 → SV8 → DB4 → DB5 → DB14 → ✅ DB15 → DB13 → DB20 → DB8 → DB9 → DB17 → DB18 → DB19 → DB21 | The PM money exits sit here: they hold `00001200` / `00001240` and wait only on DB3 + DB6. DB16 lands first so they prove conservation. DB14 never beside PM-D7a, PM-S3 or PM-WP9 (`00001110`, `00001850`).                                                                                                               |
| B · the rest | ✅ M·MS1 → SCH-WP7 → S·S1 → PM-WP1 → ✅ T·R1 → I·HK1 → SCH-WP9 → PM-D7a → PM-S3 → T·R4 → T·P1d → T·R5 → T·R3 → S·S2 → SCH-WP6 → M·NT2 → M·SR1 → O·Q9 → I·MIN1        | M·MS1 has landed (`bbcf3506`); the next step starts once the stage-intensity change lands too. SCH-WP7, WP9 and WP6 never beside DB3 or DB15 (`00001155`); SCH-WP6 never beside DB13 or DB19 (`00001210`). I·HK1 never beside a slot-A writer of `00000017`. A step whose ruling is not in yet is skipped, not waited on. |

Slot A departs from FBP §0.1 on purpose: F·DB2 is already live, and DB3 + DB6 unblock four PM
prompts (WP4a, WP4b, P6, GH1), so the dispute chain runs before DB16. Slot B leads with M·MS1
because six prompts in three tracks wait on it (M·MS2, M·MS4, T·P1d, T·P2a–c), the leakage guard
among them. SCH-WP7 comes next because SCH-WP6, paid consultations, now waits on it alone.

### B.5.3 App sessions that open as their waits clear

| When this merges                | Start (app lane, at most three at once, file-disjoint)                      |
| :------------------------------ | :-------------------------------------------------------------------------- |
| The stage-intensity change      | PM-WP8 (after SCH-WP10: ROUTING) · O·WP10b · O·WP5a                         |
| ✅ M·MS1 (`bbcf3506`)           | M·MS2 → M·MS3; then M·MS4 (SQL, slot B) → M·MS5                             |
| I·SSO1, I·LOW1                  | I·MFA1 (stops at step 5)                                                    |
| F·UI1                           | F·UI2 → F·UI4 · O·WP8                                                       |
| S·S1 (+ S·S2 for annual prices) | S·S3 → S·S5 ∥ S·S6 → S·S7 → S·S8 (S·S4 also needs F·DB2; never beside S·S6) |
| PM-WP8                          | PM-WP9 (SQL, slot B)                                                        |

**Further out (no action yet):** the T·SN chain and H1 (the node, then H3); I·ERA1–ERA4 → ARC1 →
MFA2 → MFA3, MIN2 and RLS1 (after I·HK1 and the F, P and C SQL steps); O·WP2, WP11, WP4, WP7, WP9,
WP16, WP13, Q15, WP5b and WP6 (behind F·SV5, F·UI2/UI3/UI5, PM-WP6 and M·MS3); F·UI3, UI5, SV5,
SV7, E1–E3; and every track's Z1, then B.4.

---

# PART C — THE RULINGS AS RECORDED (Wave 1.1, 2026-10-30)

The Fast-path box was not ticked, so an item counts as answered only where a box was ticked or an
`Answer:` line filled. Everything else went back to the owner in two follow-up rounds on 2026-10-30,
and the owner answered all of it.

- ⭐ = the audit's recommendation, taken.
- ✎ = the owner's own answer, or the owner's follow-up answer.
- ⚖️ = ruled, pending counsel.
- 🧑 = still open, so the build prompt stops there.
- "Reading" = an architect reading of an answer, put to the owner on 2026-10-30 and not objected to.

The full text of every ruling is in the **OWNER RULINGS** of the row named in "Settles" (first row
named = primary). Track and step names are Part B's.

| ID     | Ruling                                                                                                                                                                                                                                                                                                                                                 | Settles                                                                                             | Unblocks                                                    |
| :----- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- | :---------------------------------------------------------- |
| Q0.1   | ⭐ Scheduling takes #343; FBP's "#251 (x)" re-point to #337 D-items; F0 becomes a superseded note                                                                                                                                                                                                                                                      | #343; #337 (FA's "#251")                                                                            | finance-prompts                                             |
| Q0.2 a | ⭐ Yes: drop the client write policies on 6 buckets, and SVG from `public_assets`                                                                                                                                                                                                                                                                      | #340 (d), E8/G10                                                                                    | T: E8 storage (last P0) → ClamAV, NudeNet, admission, quota |
| Q0.2 b | ⭐ Yes: drop `security.refresh_tokens` and `security.turnstile_verifications`                                                                                                                                                                                                                                                                          | #336 (G), IW-M6                                                                                     | I                                                           |
| Q0.2 c | ⭐ Yes: RESTRICT on `payout_splits`, `split_rules`, `contribution_agreements`, `vault_permissions`                                                                                                                                                                                                                                                     | #336 (G), K11                                                                                       | I, F                                                        |
| Q0.2 d | ✎ Keep `finance.escrows.fx_*`, marked reserved (M5 (c) builds conversion now)                                                                                                                                                                                                                                                                          | #337, FBP DB8/C7                                                                                    | F: DB8                                                      |
| Q0.2 e | ⭐ No: retire `awaiting_payment` in the comment only                                                                                                                                                                                                                                                                                                   | #337, FBP DB7                                                                                       | F: M8 prompt                                                |
| Q0.2 f | ⭐ Yes: delete `search.fn_search_entities` and `fn_search_global`                                                                                                                                                                                                                                                                                      | #340 (E), G11                                                                                       | T, O                                                        |
| Q0.3   | ⭐ Register the whole set, plus N1's card-payment recovery sweep. Reading: the workload-report sweep is not in this set; PM-WP5 registers it with its fixes                                                                                                                                                                                            | #343 D9; #338 (a) D1; #203 (a); #290 (a); #337 N1                                                   | jobs-sql; P: WP1; M: notify engine                          |
| Q0.4   | ⭐ Approve the factual sweep (doc halves applied in Wave 1.1; code-comment halves wait for Wave 2)                                                                                                                                                                                                                                                     | #340 (a)(h)(j)–(m); #339 (e)(i)(k)(l); FDD X11–X14, X19, X22, X23, N30; FA (d)(s); IDG §4; #343 (c) | —                                                           |
| Q0.5   | Reading: the Wave 1 brief stands over the form's edit permission, so the diff is drafted for the owner to apply                                                                                                                                                                                                                                        | #341 (a) Q1; #337 X4                                                                                | the root `CLAUDE.md` edit `f1f10e31`                        |
| M1     | ⭐ A: product sales pay the seller's Standing-tapered commission; #187's payer rate covers escrow fees only. ⭐ /pricing: the fee in one sentence, the taper in one line; ✎ "negotiable fee" = a contract term via `negotiated_rates`, never a plan perk                                                                                               | #337 D-3 (X3, X4, N3, FA (q)); #252 (l)                                                             | F: N3 commission                                            |
| M2     | ⭐ A now (a conservation-identity view), B (shadow double-entry) before scale. ✎ ⚖️ How long escrow may sit in the platform balance: open, no owner position                                                                                                                                                                                           | #337 D-5 (X6, X8); #54 (b)                                                                          | F: conservation view                                        |
| M3     | ⭐ A: freeze the payee's pending rows inside the 7 days                                                                                                                                                                                                                                                                                                | #337 D-6 (X9), FA (c), #126, #191 B3                                                                | F: DB6                                                      |
| M4     | ⭐ A: payout-ready at publish, at booking and for paid calls, and for every team shareholder. ⭐ Show readiness on the roster, refuse at accept                                                                                                                                                                                                        | #337 D-7 (X10), FA (e); #252 (i) = #196 (b)                                                         | F: payout gate; C: WP6                                      |
| M5     | ⭐ (a)(d)(e)(f); ⭐ (b), with ✎ detection that only suggests a country and sets a guest's display currency; ✎ (c) build the disclosed-spread conversion now; 🧑 the margin value                                                                                                                                                                       | #337 D-8 (X21), FA (m)(n)(o), #54 (a)                                                               | F: DB8, DB9, FX feed                                        |
| M6     | ⭐ Lock each control until its engine runs (schedules → pots → smoother); ⭐ a pot is an earmark                                                                                                                                                                                                                                                       | #337 D-10 (X17), FA (j)                                                                             | F: DB4, DB5, SV3, UI3                                       |
| M7     | ⭐ C then A; ✎ one-offs and pipelines; reading: +10 % is the starting dial                                                                                                                                                                                                                                                                             | #337 D-11 (N4); #338 D16-a                                                                          | F: N4 bonus                                                 |
| M8     | ⭐ All five commerce rules                                                                                                                                                                                                                                                                                                                             | #337 D-12, FA (p)(r)                                                                                | F: M8 (refunded and cancelled, promo cap)                   |
| M9     | ✎ "Most widely acceptable in law" → reading accepted: the money stays in Stripe and FM §8 is amended. ⚖️                                                                                                                                                                                                                                               | #337 X20; #202 (a)                                                                                  | F                                                           |
| M10    | ⭐ (a) co_op fallback, the departed finder's cut dropped; ⭐ (b) redistribute by the split rule; ⭐ (c) [1] per-engagement contribution agreements                                                                                                                                                                                                     | #337 (FA (f)/A19); #336 F3 rider; #252 (d), X1                                                      | F: splits; S: X1                                            |
| C1     | ⭐ Paid calls off now, then Option C                                                                                                                                                                                                                                                                                                                   | #343 D1; #337 D-2 (X2)                                                                              | C: WP2 interim → WP6                                        |
| C2     | ⭐ (a) 100 % forfeit; ⭐ (b) C (the money window, a 60-minute grace, a provider move counts as a cancellation); ⭐ (c) a 24 h review window, then 7 days pending                                                                                                                                                                                       | #343 D2; #337 D-1, D-4 (X1, X5); #71 (a), #72 (b), #211 (c)                                         | C: WP7                                                      |
| C3     | ⭐ The door matrix                                                                                                                                                                                                                                                                                                                                     | #343 D3                                                                                             | C: WP3                                                      |
| C4     | ⭐ (a) Fresh + pg_cron `http`; ⭐ (b) per-registrant links; ✎ (c) the `ENCRYPTION_KEY` env; ⭐ (d) the Zoom seed set to true; ✎ provider meetings created automatically, with links for both sides                                                                                                                                                     | #343 D6, D4, (b), (d); #59; #335 (b)                                                                | C: WP4, WP5                                                 |
| C5     | ⭐ Held for review; "> 80 %"; a missing "left" is not presence                                                                                                                                                                                                                                                                                         | #343 (S-08, S-21)                                                                                   | C: WP8                                                      |
| C6     | ⭐ D5, D7, D8                                                                                                                                                                                                                                                                                                                                          | #343 D5, D7, D8, (a)                                                                                | C: WP9, WP10                                                |
| C7     | ⭐ Authoring hidden; Month scrolls continuously                                                                                                                                                                                                                                                                                                        | #343 (S-25), (e)                                                                                    | C: WP10                                                     |
| P1     | ⭐ B now, A later; ⭐ the no-deadline fallback; ✎ owner + acting reviewer notified; ✎ the chained ticket is cancelled                                                                                                                                                                                                                                  | #338 (b) D2; FDD D-9 (b); #198 (b)(e)(f)                                                            | P: WP4                                                      |
| P2     | ⭐ (a) B + C; ⭐ (b) hard-delete only untouched rows, archive the rest; ⭐ (c) write `refunded`                                                                                                                                                                                                                                                        | #338 (c)(d) D3, D4; #163; PMA S13                                                                   | P: WP4                                                      |
| P3     | Build: ghosting auto-approve (⭐), workload reporting (✎), the stage-dependency engine (✎, read as D7 (A)), SMS behind the Twilio config (✎), context ranking + pgvector KV cache (✎). Planned: maintenance cycles, instant payouts, round robin, the Global Workload Kanban (⭐, follow-up), E2E chat after MVP (✎). Kanban stays DOM (⭐, follow-up) | #337 D-9 (a)(c)(d); #338 D5–D8, D15; #339 (c)(j)(n)                                                 | F: ghosting; P: WP5, D7; M: SMS, search                     |
| P4     | ✎ Two numbers: $W_i$ = per-ticket load from difficulty (no CREATE weights); the data-based measure extends $R_i$, at a baseline until enough data; both weigh heavily in search. 🧑 Whether `create_category` is still stored as a label                                                                                                               | #338 (h) D9, W9                                                                                     | P: WP5; M: search                                           |
| P5     | ⭐ (a), (b) (a project-manager freelancer type is a future persona), (d), (e); ✎ (c) after a claim, a change needs the other side's agreement                                                                                                                                                                                                          | #338 D10, D12, D16-b; #293 (b); #291 (c); #341 (n) Q14                                              | P: WP6; O: WP5, WP6                                         |
| P6     | ✎ Per stage                                                                                                                                                                                                                                                                                                                                            | #338 (k), S11                                                                                       | P: WP4, the D7 engine                                       |
| P7     | ⭐ All                                                                                                                                                                                                                                                                                                                                                 | #338 D11, D13, D14, (l); SCA S-31; #315 (a); #339 (f)                                               | P: WP8, WP9; C: calendar URLs                               |
| S1     | ⭐ `team_agency` "Agency"; a header slot, no lane; the tab grouping                                                                                                                                                                                                                                                                                    | #252 (a)(e)(k)                                                                                      | S: S1                                                       |
| S2     | ✎ The owner's price table (`finance-model.md` §16.1): the "organisation" row → `team_agency` + `enterprise` at £89 + £6 a seat; Individual Pro £12.99; extra annual seats at 12 × monthly. 🧑 Agency and Enterprise storage; 🧑 which fee an Agency's contract rate applies to (a new conflict with #187, flagged on #252)                             | #252 (b)                                                                                            | S: S2                                                       |
| S3     | ✎ 300 a week + 18 per 10 h (Agency only)                                                                                                                                                                                                                                                                                                               | #252 (c)                                                                                            | S: S2                                                       |
| S4     | ⭐                                                                                                                                                                                                                                                                                                                                                     | #252 (h)(j)                                                                                         | S: S2, S4                                                   |
| S5     | ⭐ Stripe Billing; ⭐ the buyers; ✎ team co-owners may buy; ⭐ downgrades at period end                                                                                                                                                                                                                                                                | #252 (f); #238                                                                                      | S: S4, S5                                                   |
| S6     | ⭐ trialing · active · past_due inside 7 grace days; paused falls back                                                                                                                                                                                                                                                                                 | #252 (m)                                                                                            | S: S1                                                       |
| S7     | ⭐ (a) rebuild later; ⭐ (b) hide the SSO panel; ✎ (c) Enterprise only                                                                                                                                                                                                                                                                                 | #336 (e)(f) F5, F6; #252 (b)(j)                                                                     | I: SSO flag; S: S7                                          |
| S8     | ✎ CSV + ClickUp first; ⭐ attachments mounted                                                                                                                                                                                                                                                                                                          | #252 (g), X2                                                                                        | S: X2                                                       |
| I1     | ⭐ (a)–(d); ⚖️ the owner's positions on AML, the retention table and PITR                                                                                                                                                                                                                                                                              | #336 (a)(b)(c) F1–F3, K1, K2, K7; SEC G16; CAS S17                                                  | I: the erasure chain                                        |
| I2     | ⭐ A                                                                                                                                                                                                                                                                                                                                                   | #336 (d) F4; #87 (b)(c)                                                                             | I: F4 first (restores enterprise sign-up)                   |
| I3     | ⭐ (a), (b)                                                                                                                                                                                                                                                                                                                                            | #336 (g)(i) F7, F9                                                                                  | I: MFA and the session guard                                |
| I4     | ✎ ⚖️ Build the adult-proxy model behind a flag that stays off until counsel (no flag exists yet: a trigger refuses every minor seat today); ⭐ one EU rule; ⭐ Art. 5(1)(c)                                                                                                                                                                            | #336 (h) F8                                                                                         | I                                                           |
| T1     | ⭐ SEC §2.6                                                                                                                                                                                                                                                                                                                                            | #340 (b), L4                                                                                        | T: P2 hardening                                             |
| T2     | ⭐ (a); ✎ (b)(c) hosted = Sightengine; ✎ frames 1 per 2 s, ≤ 30, first and last, plus derived thumbnails; T2.1–T2.3 as directed; ✎ the penalty lands on `penalty_severity`                                                                                                                                                                             | #340 (c), P-5; #148 (g)                                                                             | T: P2, Tier 3, safety node                                  |
| T3     | ✎ (a) a screened Glass Front surface, served as a metadata-stripped copy; ⭐ (b)                                                                                                                                                                                                                                                                       | #340 (e)(f)                                                                                         | T: admission, NudeNet                                       |
| T4     | ⭐ All                                                                                                                                                                                                                                                                                                                                                 | #340 (i); EPI (g); #148 (a)(c)(d); #147 (b)                                                         | T: the moderation loop                                      |
| T5     | ⭐ The node; ⭐ macros admitted privately; ✎ Web Risk; ✎ Voyage; ⚖️ PhotoDNA                                                                                                                                                                                                                                                                           | #340 (g); #335 (c); AV-5; #339 (d)                                                                  | T: the safety node                                          |
| N1     | ⭐ CAS §6.1; ⭐ `inbox_tails`, then summary columns                                                                                                                                                                                                                                                                                                    | #339 (f); #218 (a); #341 (h) Q8                                                                     | M: the N1 schema window; RED WP12                           |
| N2     | ⭐                                                                                                                                                                                                                                                                                                                                                     | #339 (g); #341 (g) Q7                                                                               | M: long-poll; O: WP13; RED WP3 invalidation                 |
| N3     | ⭐ (a)(b)(c); ✎ (d) server-side                                                                                                                                                                                                                                                                                                                        | #339 (b)(h); #335 (e); #308 (a); #57 (a)                                                            | M: notify → email                                           |
| N4     | ⭐ The blend in PS and FM; ✎ `ef_search` 200 + `iterative_scan`                                                                                                                                                                                                                                                                                        | #339 (a); CAS S11 vs RED DB-9                                                                       | M: search; RED WP14                                         |
| E1     | ⭐ All                                                                                                                                                                                                                                                                                                                                                 | #341 (b)(i)–(m)(o): Q2, Q9–Q13, Q15                                                                 | O: WP2, WP10, WP11, WP17                                    |
| E2     | ⭐                                                                                                                                                                                                                                                                                                                                                     | #341 (p) Q16; FDD N10                                                                               | O: WP7                                                      |
| E3     | ✎ Q3 yes, but not yet (the design is pending); Q4–Q6, Q17 and D-13 yes; ✎ FA (l) keeps aurora violet; ⭐ FA (h) an Expand Dialog                                                                                                                                                                                                                       | #341 (c)–(f)(q); #337 D-13, FA (h)(l); #245 (a)                                                     | O: WP8, WP9, WP16; F: UI                                    |

---

# PART D — COUNSEL BRIEF: HOW LONG MONEY MAY SIT IN THE PLATFORM BALANCE (2026-11-18)

> **Status: WRITTEN 2026-11-18 (Decision #473); awaiting counsel.** It rules nothing and draws no
> legal conclusion. It puts three ⚖️ items in front of counsel as one brief, because they turn on
> the same fact: where Projective's users' money sits, and for how long.
>
> | Item                                                    | Ruling so far                                                                                    | Readiness row |
> | :------------------------------------------------------ | :----------------------------------------------------------------------------------------------- | :------------ |
> | **Q1.** How long escrow may sit in the platform balance | Ruling M2 (Part A §1, Part C): open, pending Stripe and counsel, with no owner position          | PRD-F15       |
> | **Q2.** A failed bank payout left in Stripe             | Ruling M9 (Part C): "Most widely acceptable in law"; built as "stays in Stripe" (#202 (a))       | PRD-F11       |
> | **Q3.** Whether converting a buyer's money is regulated | #435 flag (a) and `FINANCE_BUILD_PROMPTS.md` §0.5 (d): built, switched off until counsel answers | PRD-F18       |
>
> **Sources.** The flows (D.1) and timers (D.2) were read from the code at `b7280787`. The Stripe
> facts (D.3) were read from Stripe's own documentation with the Stripe CLI on 2026-11-18, read-only
> and with no account access. The ages (D.4) are measured by `finance.read_escrow_age()` on a seeded
> local database, so they are **synthetic**: they show the reader works, not how real money behaves.

## D.1 How the money moves today

1. **Every card payment is charged on the platform's Stripe account.** Projective is a GB platform
   on Stripe Connect, using Separate Charges & Transfers with Express connected accounts on Accounts
   v2 (Decision #125). A charge carries no `on_behalf_of`, no `transfer_data` and no application fee
   (`stripe-rails.ts`, `paymentIntentParams`), so Projective is the business of record for the
   charge. Settled money is credited to the payer's ledger wallet (`finance.settle_card_payment`).
   The platform is ruled to settle in nine currencies (GBP USD EUR CAD AUD JPY SGD CHF ZAR, Decision
   #423).
2. **Escrow is held from that wallet**, as a row in `finance.escrows`. It is a ledger record inside
   the platform balance, not a separate account at Stripe or a bank.
3. **On release, the payee's share waits 7 days** as a `finance.pending_releases` row (Decision
   #191), then becomes the payee's **Available** wallet balance.
4. **Money leaves the platform balance only when someone withdraws.** `begin_payout` debits the
   wallet, then a Stripe Transfer moves the amount from the platform balance to the payee's
   connected account (no `source_transaction`), and Stripe pays their bank on its own schedule. A
   payee may automate this with a weekly, monthly or threshold payout schedule (ruling M6). Without
   one, an Available balance stays put until the payee asks.
5. **So four kinds of users' money sit in the platform balance:** client top-ups not yet spent,
   escrow (held, reserved or disputed), releases still inside their 7 days, and payees' Available
   balances not yet withdrawn. Escrow is only part of it.
6. **The platform carries the losses.** Connected accounts are created with
   `losses_collector: "application"` and the recipient configuration (`stripe-rails.ts`), so the
   platform owns refunds, chargebacks and negative balances. The ledger is single-entry with
   materialised balances (ruling M2 A; the shadow journal is Decision #463). `finance-model.md` §9
   says the funds are "legally segregated", but nothing in the code can show that.

## D.2 The timers the platform enforces today

| Money                                     | Timer                                                                                                                                                                                      | Source                                                                                                                     | Status                                                                                  |
| :---------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| Unclaimed prepaid ticket escrow           | **120 h** (a productised service) or **168 h** (a client project), then refunded whole to the payer's wallet                                                                               | Decision #428; `prepaid_service_ttl_hours` / `prepaid_project_ttl_hours`; `fn_sweep_expired_prepaid_escrows`, every 15 min | Built and running                                                                       |
| A claimed ticket nobody works on          | **1,440 min** idle, then back to the backlog, with its escrow refunded to the client                                                                                                       | #338 D1; `claim_ttl_minutes`; `projects.fn_release_expired_claims`                                                         | Built, but its job is registered **paused** (`enabled = false`) until PM-WP1 hardens it |
| A submission the client never reviews     | **14 days** (notices at 7 and 13), then auto-approve and the standard payout                                                                                                               | Ruling P3; PM-GH1                                                                                                          | **Not built.** A bound ticket escrow has no timer today (`finance-model.md` §8)         |
| A session seat                            | **24 h** after its sitting ends, then released (a cohort seat waits for the cohort's last sitting)                                                                                         | #171, #211; `session_payout_hours`; `auto_release_session_escrow`, every 15 min                                            | Built and running                                                                       |
| A later stage paid for ahead (`reserved`) | **None of its own.** Held when the ticket reaches its stage; refunded only by an event on its ticket (completed, cancelled, deleted, the stage removed, a service cancel, the prepaid TTL) | #430; `fn_refund_ticket_reservations`                                                                                      | Built                                                                                   |
| A disputed escrow                         | Respondent **48 h**, then escalated; the review target is **72 h**. Past it the case stays held, and the operators are alerted daily                                                       | #212; `dispute_response_hours`, `dispute_review_hours`; `sweep_disputes`                                                   | Built. **No maximum:** the money waits for a ruling                                     |
| A release inside its clearing window      | **7 days**, then Available                                                                                                                                                                 | #191; `pending_release_days`; `fn_mature_pending_releases`, hourly                                                         | Built and running                                                                       |
| A payment dispute on clearing money       | Freezes the payee's pending rows (`on_hold`) until the card dispute is decided                                                                                                             | Ruling M3; FBP DB6                                                                                                         | Built (FBP DB6, #532)                                                                    |
| A payee's Available balance               | **None.** It stays until the payee withdraws or their payout schedule runs                                                                                                                 | Ruling M6; `finance-payout-schedules`, every 15 min                                                                        | Built                                                                                   |
| A client's top-up                         | **None.** Spent, or withdrawn, at the client's pace                                                                                                                                        | PRODUCT_SPEC §Escrow, Wallets & Finance                                                                                    | Built                                                                                   |

## D.3 What Stripe documents

Read 2026-11-18 from docs.stripe.com. The bullets paraphrase Stripe; they are not legal advice and
not Projective's reading of the law.

- **When charged money can move.** A transfer is paid from the platform's available balance, and one
  that exceeds it fails and is not retried. A transfer that names its charge (`source_transaction`)
  succeeds at once, but waits for that charge's funds to become available. In GB, a new account's
  first payment settles after 7 days and later ones after 3 business days by default
  ([SCT](https://docs.stripe.com/connect/separate-charges-and-transfers),
  [balances](https://docs.stripe.com/payments/balances)).
- **Holding money.** Stripe recommends holding money only for a clear purpose, with a commitment to
  transfer it when an event happens or a condition is met. It advises against holding money
  arbitrarily, says platforms should pay connected accounts as soon as they are identified (usually
  at the charge), and tells a platform that is unsure to ask its legal advisor
  ([account balances, "Holding funds"](https://docs.stripe.com/connect/account-balances)).
- **The 90-day figure.** The same section says Stripe may, for compliance reasons, hold funds in
  reserve for a period set by the business's country: 10 days in Thailand, 2 years in the United
  States, **90 days everywhere else**. The page does not say whether the period runs on the
  platform's balance or the connected account's. The manual-payouts page applies the same table as a
  hard deadline for paying out money held in a connected account's balance
  ([manual payouts](https://docs.stripe.com/connect/manual-payouts)). We found no documented
  deadline for creating an SCT transfer after a charge.
- **Escrow, by name.** Stripe says, on the manual-payouts page, that "Escrow has a precise legal
  definition, and Stripe doesn't provide escrow services". Projective's product, code and public
  copy call the held money "escrow".
- **Funds segregation exists, as a private preview available in GB.** Allocated money sits outside
  the platform balance, can only be transferred to a connected account, and is protected from
  platform payouts, unrelated refunds and chargebacks, and Stripe fees. It requires the platform to
  carry negative balances (Projective does), a `source_transaction` on every transfer (Projective
  sets none), and no `on_behalf_of`. Only Visa, Mastercard, Discover, American Express and Swish
  payments made without `automatic_payment_methods` qualify (Projective's express-wallet path uses
  them), and recipient accounts cannot take cross-border payouts. It is requested through a Stripe
  account manager ([funds segregation](https://docs.stripe.com/connect/funds-segregation)).
- **Cross-border.** Transfers on the payments balance work between the US, Canada, the UK, the EEA
  and Switzerland. Outside those, the platform and the account must be in the same region. Accounts
  on the recipient service agreement cannot receive cross-border payouts without Global Payouts, and
  their transfers take an extra 24 hours to become available. Projective creates its connected
  accounts with the recipient configuration
  ([SCT](https://docs.stripe.com/connect/separate-charges-and-transfers),
  [cross-border payouts](https://docs.stripe.com/connect/connect-cross-border-payouts),
  [service agreements](https://docs.stripe.com/connect/service-agreement-types)).
- **Who answers for what.** Without `on_behalf_of` the platform is the business of record, and its
  balance pays refunds, chargebacks and Stripe fees. Stripe recommends SCT only where the platform
  also carries connected accounts' negative balances. Merchant of record is judged from the
  customer's point of view, and Stripe suggests legal advice where that is unclear
  ([charges](https://docs.stripe.com/connect/charges),
  [merchant of record](https://docs.stripe.com/connect/merchant-of-record),
  [risk management](https://docs.stripe.com/connect/risk-management)).
- **A failed bank payout (Q2).** The bank returns the money, the payout's
  `failure_balance_transaction` puts it back in the account's Stripe balance, and the bank account
  is disabled until it is updated. A payout can read `paid` and turn `failed` up to 5 business days
  later. Stripe's general payouts page says it reattempts at the next scheduled payout once the
  details are corrected. The Connect pages we read do not say so for connected accounts
  ([payouts](https://docs.stripe.com/payouts),
  [payout object](https://docs.stripe.com/api/payouts/object),
  [connected-account payouts](https://docs.stripe.com/connect/manage-connected-account-payouts)).
- **Currency conversion (Q3).** Under SCT without `on_behalf_of`, Stripe converts a charge into the
  platform's currency, and converts again at transfer if the connected account's currency differs
  ([Connect currencies](https://docs.stripe.com/connect/currencies),
  [FX Quotes](https://docs.stripe.com/connect/currencies/fx-quotes-api)). The pages we read say
  nothing about a platform converting money in its own ledger.
- **Not documented on the pages read:** money transmission, licensing, safeguarding (outside
  stablecoin custody) or e-money.

## D.4 The ages, measured

`finance.read_escrow_age()` (00001200, operators only) reads seven kinds of held money, one per
clock in D.2: `held_bound`, `held_prepaid`, `held_seat`, `reserved`, `disputed`, `pending` and
`on_hold`. For each kind and currency it gives the count, the total, the oldest, the p50, p90 and
maximum age in days, and the count and total older than 30, 60 and 90 days. Age runs from when the
money entered that state, so a release starts a second clock, and the total time in the platform
balance is the two added together. The probe `supabase/probes/escrow_age.sql` proves the figures on
a fixture. The reader moves nothing.

**Seeded local database, read as the seeded operator at 2026-11-18 19:41 UTC** (synthetic: the seed
dates its rows relative to the last reset):

| Kind         | Currency | Count |         Total | Oldest     | p50 |  p90 |  Max | Over 30 / 60 / 90 days |
| :----------- | :------- | ----: | ------------: | :--------- | --: | ---: | ---: | :--------------------- |
| `held_bound` | USD      |     5 | US$107,000.00 | 2026-11-06 | 9.0 | 11.6 | 12.0 | 0 · 0 · 0              |

The seed holds no prepaid, seat, reserved or disputed escrow and no pending release, so those kinds
have no row. The probe covers every kind on its own fixture.

Payees' and clients' Available wallet balances are outside the reader, because a wallet balance has
no single age. On the same database they came to US$54,799.75 across 15 wallets: freelancers
US$25,515.32, businesses US$18,897.00, users US$7,500.00 and teams US$2,887.43. All of it sits in
the platform balance until it is withdrawn or spent.

On production, the operator reads the same figures from `/admin/ledger`'s Escrow age section. That
page is FBP DB16's and has **not landed yet**, so until it does, the read is
`select finance.read_escrow_age()` as an operator.

## D.5 The questions for counsel

**Q1 (ruling M2, PRD-F15).** A GB platform holds users' money in its own Stripe balance under
Separate Charges & Transfers, as D.1 describes. It holds escrow until approval, 7 days of clearing,
payees' released balances until they withdraw, and clients' top-ups.

- (a) May it hold each of these four in its own balance at all, and if so for how long?
- (b) Does any of them make it a payment institution or e-money issuer, or bring a safeguarding
  duty? Does calling it "escrow" carry a legal meaning it cannot meet?
- (c) Is "legally segregated" (`finance-model.md` §9) a claim it can make? Would Stripe's funds
  segregation, or transferring to the payee's connected account at release instead of at withdrawal,
  change the answer?

**Q2 (ruling M9, PRD-F11).** When a payee's bank rejects a payout, the money is already in the
payee's connected account and stays in its Stripe balance until Stripe pays it again (#202 (a)). Is
leaving it there the most widely acceptable option in law, or must it return to the platform wallet?
Is there a limit on how long it may stay there?

**Q3 (#435 flag (a), FBP §0.5 (d), PRD-F18).** At checkout, Projective converts a buyer's
billing-currency money into the seller's currency inside its own ledger. It uses a locked 30-minute
quote with a disclosed margin of 150 basis points (seeded, switched off), and holds the converted
amount until payout, possibly for weeks (#435, #436 (C)).

- (a) Is that a regulated currency-exchange or dynamic-currency-conversion service?
- (b) What markup disclosure is owed?
- (c) A refund returns the exact amount paid, margin included. Does that meet UK cancellation rules?

## D.6 What the answers decide

| If counsel says                                   | Then the platform must decide                                                                                                                                                            | Where it lands                                                            |
| :------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------ |
| A maximum hold, for some or all of the four kinds | Per kind, what happens at the maximum: **refund** the payer, **release** to the payee, or **escalate** to an operator. Plus the alert thresholds (`read_escrow_age`'s 30 / 60 / 90 days) | A sweep per kind; MR4's money alerts; D.2's "None" and "No maximum" rows  |
| Transfer at release, not at withdrawal            | Move the Transfer from `begin_payout` to the release. This puts the 90-day figure in D.3 on the connected account's balance                                                              | `PaymentBackendService`, `fn_mature_pending_releases`; the journal (#463) |
| Funds segregation                                 | Ask Stripe for the preview (a human act), and set `source_transaction` on every transfer                                                                                                 | `stripe-rails.ts` `transferParams`; Decision #125                         |
| "Escrow" is the wrong word                        | Rename it in the public copy and the legal documents                                                                                                                                     | PRD-M1; PRODUCT_SPEC; the legal content                                   |
| Q2: return the money to the wallet                | Reverse the transfer on `payout.failed`                                                                                                                                                  | FBP SV8; `finance-model.md` §8                                            |
| Q3: conversion may run, with a stated disclosure  | Switch on `fx_checkout_enabled`, keep or change `fx_spread_bp`, and write the disclosure copy                                                                                            | #435 (C); FBP DB17; PRD-F18                                               |

**Counsel's answer:** Q1 ______ · Q2 ______ · Q3 ______ (by, date)

---

# PART E — COUNSEL BRIEF: THE LEGAL LIBRARY AND THE OPEN COMPLIANCE QUESTIONS (2026-11-23)

> **Status: WRITTEN 2026-11-23 (Decision #528); awaiting counsel.** It rules nothing and draws no
> legal conclusion. It puts three things in front of counsel as one brief: the six legal documents
> (E.1), every open ⚖️ item that Part D does not hold (E.2), and the regimes to rule in or out
> (E.3). E.4 is the owner's runbook for each document counsel approves, and E.5 lists what counsel
> needs before starting. Part D (#473) keeps the money questions: how long users' money may sit in
> the platform balance and whether "escrow" is the right word (Q1), a failed bank payout (Q2), and
> checkout currency conversion (Q3). They are not repeated here.
>
> **Sources.** The library, the code and the decision log were read at `3ec3592c`. Every clause of
> every document names its source in the code (`content.test.ts` pins a citation on each). LEGAL LG1
> is bringing the drafts in line with the product in a parallel change, and E.1.7 is filled from its
> drift table.

## E.1 The library

**How it works today** (Decision #270). Each document is a versioned TypeScript content module in
`apps/web/features/legal/core/content/`, compared clause by clause (`?compare=`) and downloadable
per version as a PDF. Versions are append-only once published. Every version carries
`reviewedAt: null`, so every page shows "Draft — pending legal review", is `noindex`, and is left
out of `/sitemap.xml` (`core/view.ts`, `core/sitemap.ts`). Sign-up records three of the six (#446):
the Terms and the Acceptable Use Policy as `accepted`, the Privacy Policy as `shown`, at versions
the database re-checks. The Terms link the Escrow Terms and the IP Transfer Deed, and on the owner's
choice of A (E2.16) a payer's first funding records the one and a maker's first paid claim the other,
once per version (LG3, #534). Checkout and an owner's assignment are not asked yet (PRD-M10).

### E.1.1 Terms of Service (`terms`)

- **Newest version:** 2.0, effective 2026-10-17. Version 1.0 (2026-08-01) is a reconstructed
  baseline that was never published, kept so Compare has something to compare with. The owner ruled
  it is removed before launch (#270 (b), E.4).
- **Governs:** the agreement between a user and Projective: accounts, age, roles, verification,
  hiring, payments and fees, conduct, content and IP, closing an account, the platform's role and
  its limits, and changes.
- **Rules it states:** no hiring yourself through a second account (PRODUCT_SPEC §Identity, Taxes &
  Compliance 3); the age bands, with 13–17 restricted and under-13 refused (#190, #192, #208);
  payout-ready verification before earning (#196); the invitation cooldown and proposal allowances
  (#228 (E)); a flat 5% stage-completion fee (`platform_fee_bp` 500; `finance-model.md` §1.1); the
  deletion windows (#156); the platform as system of record, not a party to the work (PRODUCT_SPEC
  §Dispute Resolution 5).
- **Open clause-level questions:** whether accepting these Terms at sign-up is the assignor's signed
  writing for a copyright assignment (E2.16); where the sellers' tax duties are stated (LG1 stop (a)
  puts them here; E2.24).

### E.1.2 Escrow Terms (`escrow-terms`)

- **Newest version:** 2.0, effective 2026-10-17. Version 1.0 (2026-08-01) is a reconstructed
  baseline, removed before launch (#270 (b)).
- **Governs:** how money for work is held, released, refunded and split.
- **Rules it states:** no hold, no work (#165); when money locks, including prepaying (#197);
  release and the pipeline Chain Reaction (#210), each session sitting its own transaction (#211);
  the 5% fee on the earned share only (#198); the 7-day pending window (#191); the 24-hour session
  rule; Fair Exit at a reviewer-chosen 25, 50 or 75% (#198); disputes, the 48-hour respondent
  deadline and the no-show attendance audit (#212); refunds and card disputes (#200, #126) and the
  24-hour claim expiry; business wallets (#230 (c), #240); withdrawals only to a verified payout
  account (#202). The figures are the seeded `security.platform_params`.
- **Open clause-level questions:** #270 (c) (Fair Exit against `finance-model.md` §3's older
  duration thresholds), (d) (a late session cancellation forfeits to the freelancer, not §4's 50%)
  and (o) (the no-show wording against PRODUCT_SPEC §Dispute Resolution 3), which LG1 settles at
  their source; the Refunds clause still says a lapsed claim's escrow is refunded, while since #516
  a prepaid escrow is re-armed (#516 (d)); whether a payer accepts these terms at funding (E2.16);
  the word "escrow" (Part D Q1 (b)).

### E.1.3 Privacy Policy (`privacy`)

- **Newest version:** 1.1, effective 2026-11-18 (the self-serve data copy, #450). 1.0 is effective
  2026-10-17.
- **Governs:** what personal data Projective stores, why, who processes it, how long it is kept, and
  the rights over it.
- **Rules it states:** the data categories the schema stores; the uses (leakage screening, identity
  checks, reputation, notifications); young people (high-privacy defaults for 13–17 under the
  Children's Code; nothing kept for an under-13 attempt); the processors the server talks to
  (Supabase, Stripe, Google Web Risk, Voyage AI, sign-in providers, S3-compatible storage, calendar
  providers, Zoom), some only "when switched on" (#270 (h)); identity documents through Stripe
  Identity, with personal data encrypted in Supabase Vault; retention "typically 7 years", a 30-day
  erasure and a 90-day freelancer removal; a self-serve copy of your data (#450); security.
- **Open clause-level questions:** the data controller's identity is absent (#270 (h); E.5); the
  owner's per-class retention table (E2.2) and the backup statement (E2.3) are not stated yet; the
  newsletter and the Marketing consent are not named (the monitoring signals are, since LG7, #529) (§0.2 finding 7; LG1
  step 6); the explicit ≤ 30-day erasure path waits for IDENTITY ERA2's draft version.

### E.1.4 Cookie Policy (`cookies`)

- **Newest version:** 1.0, effective 2026-10-17.
- **Governs:** every cookie and browser-storage key the site sets.
- **Rules it states:** the sign-in cookies (`sb-access-token`, `sb-refresh-token`,
  `pj_session_transient`, `pj_pending_verification`, the sign-in code verifier, `pj_join_age_lock`);
  two preference cookies (`pj.a11y`, `pj.currency`); Stripe's cookies on the payment steps only;
  `pj.dev.*` in development builds only; local and session storage, the `pj-offline` IndexedDB queue
  and the `pj-shell-v1` service-worker cache; no third-party analytics or advertising tags.
- **Open clause-level questions:** keys declared in code but never set (#270 (g)), which LG1 step 5
  reconciles against the setters; which items are strictly necessary and which need consent (E.3,
  PECR); no non-essential cookie under 16 (#336 I4; IDENTITY MIN1).

### E.1.5 Acceptable Use Policy (`acceptable-use`)

- **Newest version:** 1.0, effective 2026-10-17.
- **Governs:** what users may and may not do: keeping payments on the platform, what public pages
  may contain, the creative safe harbor for private work, what is never allowed, reporting, and the
  consequences.
- **Rules it states:** the Protected Phase and contact masking (#147); public pages never carry
  contact or payment details; the two-zone content model (#148); AML, round-tripping and sanctions
  (PRODUCT_SPEC §Identity, Taxes & Compliance 3); reports kept as an immutable snapshot, the
  reporter never revealed; penalties that feed the Reliability Index and Standing.
- **Open clause-level questions:** it states rules whose automated enforcement is planned (#270
  (e)): public-copy refusal, image screening and the report button (T&S R1–R3, PRD-D9); the
  `/contact` link.

### E.1.6 IP Transfer Deed (`ip-transfer-deed`)

- **Newest version:** 1.0, effective 2026-10-17.
- **Governs:** who owns the work delivered through a project, when ownership passes, and the record
  Projective keeps.
- **Rules it states:** the project's IP setting (`projects.projects.ip_ownership_mode`:
  `exclusive_transfer`, `licensed_use`, `shared_ownership`, `projective_partner`; and
  `portfolio_display_rights`); ownership passes on final escrow release; the maker's portfolio
  right; Request to Sell (#493); work made outside a project; the record of transfer (not built:
  LG4); IP disputes; only an adult account transfers ownership (PRODUCT_SPEC §Age guardrails).
- **Open clause-level questions:** the assignor's signature (finding 2; E2.16); the word "deed"
  (finding 3; E2.17); "finally released" against escrow that releases per ticket and matures 7 days
  later (finding 5; LG4 stop (a)); a Fair Exit's partial release (E2.18); `projective_partner` has
  no terms (#270 (f); E2.19); the licence `licensed_use` gives the client, and the licence a Request
  to Sell grant creates (E2.14); PRODUCT_SPEC §Digital Marketplace 1 says a grant changes the IP
  status to Shared Ownership, which a partial grant cannot do (#493 (c)).

**Two more documents** (LG1 stop (a), ruled 2026-11-23, #540): the **Copyright & Notice Policy**
(`copyright` 1.0: how to report a copy through the contact form until SC8's notice form opens, staff
review, takedown, a review on request; the notice fields, counter-notice and repeat-infringer rule are
E2.10) and the **Marketplace Licence Terms** (`marketplace-licence` 1.0: the licence the listing shows,
delivery, the download notice, refunds through the contact form, price and tax; the licence wording
and a Request to Sell grant are E2.14). Both are drafts for counsel with the rest. A Data Processing
Addendum with a sub-processor list waits until the first business client asks for one.

### E.1.7 Drift found by LG1

LG1 (#531) checked every clause of every newest version against its cited source and the code, and
corrected the drafts in place (the drafts are unpublished, so no version was added). Where a fixed
clause differs from E.1.1–E.1.6 above, the draft is right and #531 (B) lists the change. #270 (c),
(d), (e), (g) and (o) are settled (#531 (C)). These rows stay open, because the rule itself is
unsettled or only counsel or the owner can answer:

| Document · clause                       | What it says now                                                                         | What is true / unsettled                                                                                                                                                           | Source                                                       | For            |
| :-------------------------------------- | :--------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------- | :------------- |
| Terms `payments` · Escrow Terms `fees`  | Nothing on card processing costs (the pass-through sentence is gone)                     | The ruling says 5% plus Stripe processing passed through; the code charges no Stripe fee to anyone, and the receipt still claims pass-through                                      | `finance-model.md` §1.1; `stripe-rails.ts`; #531 flag (A)    | Owner          |
| Terms `payments`                        | No tax collected at checkout today; services and sessions: the seller                    | Who answers for tax on a digital product while `tax_collection_enabled` is off, and whether "the price shown" may stay tax-exclusive for consumers                                 | #490 (c); E2.24; LG8                                         | Counsel        |
| Escrow Terms `disputes`                 | A dispute is a session no-show claim                                                     | PRODUCT_SPEC §Dispute Resolution 1, 2 and 5 describe stage-work disputes, the Evidence Vault and a Dispute Summary PDF as if built                                                 | `00001260`; #531 flag (B)                                    | Owner          |
| Privacy `who-we-are`                    | "Projective is responsible…", with no legal identity                                     | The controller's legal name, company number, registered address, ICO number and data-protection contact                                                                            | #270 (h); E.5 item 1                                         | Owner          |
| Privacy `retention`                     | No period for newsletter, contact-request, acceptance or push data                       | `ops.contact_requests` is never deleted; newsletter subscriptions, `org.legal_acceptances` and push subscriptions have no stated period                                            | `00000013`, `00000025`, `00000011`; E2.2                     | Owner, counsel |
| Privacy `sharing`                       | No hosting provider named                                                                | The host that serves the app and sees every request is not in `.env.example`; only a hosted environment can name it                                                                | SYSTEM_ARCHITECTURE §Environment Variable Contract           | Owner          |
| Cookie Policy `local-storage`           | The tab's discovery key and the device's recent views and searches are disclosed         | Set for every reader, guests and 13–17 accounts included, with no consent: strictly necessary, or consent first (PECR reg. 6)?                                                     | `discovery-beacon.ts`; `storage-keys.ts`; PRD-M8; E2.25 | Counsel        |
| Cookie Policy `other-services`          | Turnstile, the YouTube embed (on play) and the preview viewers may set their own cookies | Whether loading a provider's frame on the reader's own click is consent enough, and whether Turnstile's processing needs its own notice                                            | `utils/csp.ts`; #401; #447; E2.25                                   | Counsel        |
| AUP `consequences`                      | Removal, suspension or closure                                                           | The penalty ladder of PRODUCT_SPEC §Messaging 1.C (penalties into the Reliability Index and Standing) has no writer for a policy breach, and no suspension mechanism exists        | `security.penalties`; SECURITY_MODERATION_AND_AI_GAPS        | Owner (T&S)    |
| AUP `keep-payments-on-projective`       | Masks emails, phone numbers and payment or messaging links                               | Bank numbers and IBANs are forbidden but not masked: `comms.mask_pii` has no pattern for them                                                                                      | `00001300` `comms.mask_pii`                                  | Owner (T&S)    |
| IP Transfer Deed `shared-ip`            | Ask; the Client agrees, wholly or in part; no sale without it                            | What a grant gives the maker (#493: a right to sell at a royalty; the licence wording counsel's) and PRODUCT_SPEC §1's "changes to Shared Ownership"; Request to Sell is not built | #493 (c); E2.14                                              | Counsel        |
| Marketplace Licence Terms `the-licence` | The listing's licence terms apply; neither definition restated | The buyer's terms on `/view` (`licenceTerms`) keep client work to the extended licence; the seller's hint (`LICENCE_SUMMARY`) puts it under commercial | `packages/types/explore/stored.ts`; `features/catalogue/core/offer-model.ts`; #540 flag (A) | Owner |
| IP Transfer Deed `the-projects-setting`              | | `projective_partner`: "set out separately for each partner"                              | The mode has no terms                                                                                                                                                              | #270 (f); E2.19                                              | Counsel, owner |

Product observations, no text change: every money door refuses a 13–17 account but
`finance.fn_ensure_wallet` does not (PRODUCTION_READINESS §C); the 10-invitations-in-10-minutes cap
is an in-memory limiter per server instance; proposal allowances are metered but not enforced
(`proposal_allowance_enforced` false); an erased account's handle is not held.

## E.2 Every open ⚖️ item not in Part D

"Owner's position" is the ruling or recommendation on record; "—" means none. The last column is
what waits on counsel's answer. Every switch named there ships off, and no agent switches one on.

### Privacy and data

| #    | Question                                                                                                                                                                                                                                                                                                                                                                             | Source                                 | Owner's position                                                                                                                                                                                                                | What waits                                                                                                                                 |
| :--- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------- |
| E2.1 | Does holding users' money in platform wallets make Projective AML-obliged under MLR 2017?                                                                                                                                                                                                                                                                                            | #336 ruling I1 (Part A I1)             | **No**, but AML-ready: the data half (CDD and KYC references, the monitoring signals, retention long enough for the AML period) runs from day one; the programme half (MLRO, review queue, registration, exports) stays dormant | LEGAL LG7 (the signals; the Safety Hold, off) · IDENTITY X2 (the programme flags) · PRD-M6, MW-58                                          |
| E2.2 | The retention period for each record class: ledger and invoices (7 years after the financial year; DE and FR 10), the legal-hold identity set (5 years after the relationship ends), seller tax-reporting data (6 years UK, 10 EU), dispute records and evidence (6 years after closing), consent records (account life + 6 years), security logs (12 months), search logs (90 days) | #336 ruling I1; `finance-model.md` §17 | The table in Part A I1: the longest period any obligation could need, each a `security.platform_params` dial with a per-country override                                                                                        | IDENTITY ERA2 (the dials; `retention_search_query_log_days` is built at 90, OPS4 #515, PRD-G5) · ERA4's periods · E.1.3's retention clause |
| E2.3 | May the erasure statement say erased data persists only in encrypted backups for at most 30 days (the PITR window plus rotation), is never used for normal access, and is erased again on any restore?                                                                                                                                                                               | #336 ruling I1; IDENTITY ERA4          | Yes, as stated, with a personal-data-free tombstone log the restore runbook replays (ICO "beyond use")                                                                                                                          | IDENTITY ERA4 (the vault, the tombstone, the replay) · OPERATIONS OPS6 stop (e) (PITR on production) · a Privacy Policy draft version      |
| E2.4 | (a) May minors (13–17) hold workspace seats through an adult-proxy model, and on what terms? (b) Is one global rule for EU/EEA users aged 13–15, on a basis other than consent, with no marketing email and no non-essential cookies under 16, enough?                                                                                                                               | #336 ruling I4 (h)                     | (a) Build the proxy behind a flag that stays off (today a trigger refuses every minor seat). (b) Yes, one global rule                                                                                                           | IDENTITY MIN2's flag · USER_FLOWS ID-30 (⏸) · MIN1                                                                                         |
| E2.5 | How long is a dispute's Evidence Vault snapshot kept (stage rooms, ticket history, submitted file versions, the terms at raise), including against an erasure request?                                                                                                                                                                                                               | PROJECTS_BUILD_PROMPTS §0.3 stop 19    | 6 years after the dispute closes (the table in E2.2); EX3 builds with no purge                                                                                                                                                  | PROJECTS EX3's purge · USER_FLOWS PJ-43                                                                                                    |
| E2.6 | May the original of a message deleted "for everyone" be kept, unseen by the parties, as evidence?                                                                                                                                                                                                                                                                                    | PROJECTS_BUILD_PROMPTS §0.3 stop 21    | Recommended: keep originals for evidence, the period left open                                                                                                                                                                  | PROJECTS CH1's retention period                                                                                                            |
| E2.7 | May a project invitation be emailed to an address with no account (one transactional message naming the inviter, no reminders)? On what lawful basis?                                                                                                                                                                                                                                | PROJECTS_BUILD_PROMPTS §0.3 stop 24    | Recommended: yes, behind a switch                                                                                                                                                                                               | PROJECTS NO1's platform-param switch · USER_FLOWS PJ-17                                                                                    |
| E2.8 | Is the idle-basket reminder lawful on the person's Marketing opt-in alone, or may a signed-in buyer's own basket rely on a soft opt-in?                                                                                                                                                                                                                                              | #492 ruling (1), flag (a)              | It is Marketing: sent only with the category on, one-step opt-out, never to a 13–17 account                                                                                                                                     | `comms.basket_nudge` (`security.feature_flags`) · USER_FLOWS MK-18                                                                         |
| E2.25 | Two browser-storage entries are set for every reader, a guest or a 13–17 account included, with no consent: the tab's discovery key, sent with the events that measure and rank search, and the device's list of recently opened items and recent searches. Are they strictly necessary under PECR reg. 6, or does each need consent first? And is a third-party frame loaded on the reader's own click (an article's video, a file preview's provider viewer) consent enough for the cookies that provider sets? | LG1 (#531 (D)); E.1.7 | The Cookie Policy discloses both; no consent surface exists | PRD-M8; the Cookie Policy's `local-storage` and `other-services` clauses |

### Safety and moderation

| #     | Question                                                                                                                                                                                                                                                                                                                                                                | Source                              | Owner's position                                                                                                   | What waits                                                                                              |
| :---- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------- | :----------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| E2.9  | Known illegal imagery: which hash list or provider (PhotoDNA Cloud Service or an equivalent), which reporting body per jurisdiction (NCMEC, IWF / NCA, …), how long matched material is preserved and who may access it, and whether the provider becomes a sub-processor                                                                                               | #340 ruling T5 (g); TRUST_SAFETY H1 | Yes, hash-match in both zones                                                                                      | `HASH_MATCH_LIVE` (default `false`) · PRD-D14                                                           |
| E2.10 | The inbound copyright notice regime: the fields a valid notice needs, the counter-notice and its waiting period, the repeat-infringer rule and its threshold (and whether a strike counts against the person, the owning workspace or both), the designated agent, the public copy, how much of a notice the seller sees, and how long a non-user's notice data is kept | #496 (C), flags (b), (c); #393 B8   | The mechanism is ruled: a `notice` report source that needs no account, and a takedown hold only an operator lifts | MARKETPLACE SC8's public-form switch · USER_FLOWS MK-47, PRD-D9 · the planned Copyright & Notice Policy |

### Consumers and the marketplace

| #     | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Source                                                                  | Owner's position                                                                                                           | What waits                                                                                                             |
| :---- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| E2.11 | Before Pay, a basket that delivers files shows "Digital files are non-refundable once downloaded" and an unticked box: "I want the files now, and I understand I lose the right to a refund once one has downloaded in full" (PRODUCT_SPEC §Digital Marketplace 6). Are these words enough for the digital-content waiver, and may a refund then be refused?                                                                                                                                                                                                                                                                                         | #393 ruling A8 (#488)                                                   | "Downloaded" means delivered in full; the tick is recorded with each product line                                          | `finance.delivered_refund_refusal` (off) · USER_FLOWS MK-29, MK-31                                                     |
| E2.12 | Nothing tells a consumer about a statutory right to cancel, for services, sessions or products. Which purchases carry one, what must be said before and after the contract, and does a service or session that starts inside the cancellation period need the buyer's express request?                                                                                                                                                                                                                                                                                                                                                               | LEGAL_COMPLIANCE §0.2 finding 8                                         | —                                                                                                                          | No work order yet: a candidate gap, not a readiness row                                                                |
| E2.13 | May a buyer-started refund of a card-paid line land in the buyer's wallet, or must it go back to the card unless the buyer agrees otherwise?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | MARKETPLACE_BUILD_PROMPTS §0.3 "For counsel"                            | —. As built and planned: FBP DB21 credits the wallet; MR3 keeps card refunds operator-only                                 | FBP DB21's refund destination · MR3 · PRD-F12, USER_FLOWS MK-31                                                        |
| E2.14 | The licence a Request to Sell grant creates; and whether the `licensed_use` licence a client gets is exclusive (a resale may breach an exclusive licence). Is stopping the royalty when the client's account is erased enough?                                                                                                                                                                                                                                                                                                                                                                                                                       | #493 (A), (C), (F)                                                      | Agreed per request, 0–50% of the seller's net after commission; the client grants it whole or in part; it stops on erasure | MARKETPLACE SC7's grant switch (`security.platform_params`) · USER_FLOWS MK-46 · the planned Marketplace Licence Terms |
| E2.15 | The anti-piracy and delivery specs (unbuilt) assume these answers: originals screened by the content classifier only if the owner rules so (A10); originals kept while any entitlement lives, with a stated re-download window (A11); an opaque watermark token, not literal buyer ids (B1); a creator never learns a traced buyer's identity except through legal process (B3); the creator, not Projective, sends a takedown notice (B6); a client co-owner is notified of a takedown, not asked (B7); buyers are told before payment that files carry a traceable mark, likely with a DPIA; whether health or research scans may be listed at all | #393; `ASSET_DELIVERY_ARCHITECTURE.md` §13; `ANTI_PIRACY_ENGINE.md` §13 | The specs' recommendations                                                                                                 | ASSET_DELIVERY phases 1+ and the anti-piracy engine (no work order yet)                                                |

### Intellectual property

| #     | Question                                                                                                                                                                                                                                                                                                                                                                                                                                            | Source                                        | Owner's position                                                                                                                                    | What waits                                                                                                                                     |
| :---- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| E2.16 | An assignment of copyright needs a writing signed by or on behalf of the assignor (CDPA 1988 s.90(3); 17 U.S.C. §204(a)). Is the maker's click acceptance a signature? Is acceptance at sign-up enough, or must the maker accept the deed, and the payer the Escrow Terms, when each first commits? Who signs: PRODUCT_SPEC §Identity, Taxes & Compliance 4 has Projective sign, while §Age guardrails has the adult party "sign IP transfer deeds" | LEGAL_COMPLIANCE §0.2 findings 1, 2; stop 4   | **A**: each accepts once per version, at the first paid claim or the first funding (LG3, being built). B (the Terms' links) only if counsel says so | LEGAL LG3 (the acceptance rows) · LG4 (the record carries the platform's signature and the assignor's acceptance by reference) · PRD-M4, MW-56 |
| E2.17 | In English law a deed has execution formalities (LP(MP)A 1989 s.1) that a click cannot meet. May the document keep the name "IP Transfer Deed", and what should the record of transfer be called?                                                                                                                                                                                                                                                   | LEGAL_COMPLIANCE §0.2 finding 3; LG4 stop (d) | Ruled (#530, LG4 stop (d)): "deed" stays in the code; the UI says "Transfer record" until counsel rules                                             | LG4's label · the document's title                                                                                                             |
| E2.18 | A Fair Exit releases part of a held escrow. What happens to the IP in the work delivered so far?                                                                                                                                                                                                                                                                                                                                                    | LEGAL LG4 stop (b)                            | Ruled (#530, LG4 stop (b)): no transfer record; counsel words what the deed says happens                                                            | LG4 · the deed's `when-ownership-passes` clause                                                                                                |
| E2.19 | The `projective_partner` IP mode is a value of `ip_ownership_mode`, labelled "Projective partner terms" in project setup (`setup-format.ts`), but its terms are "set out separately for each partner" and none exist. Define it, or retire it?                                                                                                                                                                                                      | #270 (f)                                      | —                                                                                                                                                   | The deed's `the-projects-setting` clause · the mode's place in the project IP setting                                                          |

### Tax

| #     | Question                                                                                                                                                                                                                                                                                 | Source                                      | Owner's position                                                                                                                                                                                      | What waits                                                                                       |
| :---- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| E2.20 | Who is liable for tax on a marketplace sale, where, and on what? The platform charges every card payment on its own Stripe account (Part D, D.1).                                                                                                                                        | #490 (A)                                    | **A, split by kind**: the platform collects through Stripe Tax on digital products only; on services and sessions the seller is named as responsible. Widening `tax_collected_kinds` needs no rebuild | `tax_collection_enabled` (off) · MARKETPLACE CK4 · PRD-M5, USER_FLOWS MK-20, MW-57               |
| E2.21 | Prices exclude tax and tax is added at checkout. Does that display meet the UK drip-pricing rules (DMCC Act 2024) and the price-indication rules for consumers?                                                                                                                          | #490 ruling (2), flag (c)                   | Tax-exclusive, added at checkout                                                                                                                                                                      | CK4's price display                                                                              |
| E2.22 | Stripe warns that `txcd_10000000` (General - Electronically Supplied Services) is too broad for US state taxability, and the `course` code assumes delivery that both streams and downloads. Are the seven product tax codes right?                                                      | #490 (C), flag (d)                          | The codes tabled in #490 (C)                                                                                                                                                                          | CK4's tax-code map                                                                               |
| E2.23 | Tax on Projective's own fees (the 5% stage-completion fee, the marketplace commission, a `buyer_added` fee): the place of supply, the registrations, and whether a business payer's reverse charge applies. And is the fee tax-inclusive (the 5% stays 5%) or is tax added on top?       | #490 (a); LEGAL LG8 stop; PRD-M7            | The inclusive or on-top choice is the owner's (LG8 recommends inclusive); the rest is counsel's and an accountant's                                                                                   | `platform_fee_tax_enabled` (off) · LEGAL LG8 · PRD-M7                                            |
| E2.24 | PRODUCT_SPEC §Identity, Taxes & Compliance 2 promises 1099-K / 1099-NEC and W-9 collection, a US framing, for a GB platform on Connect Express. What must Projective report about its sellers under the UK platform-operator rules (2023) and EU DAC7, and what does Stripe file for it? | LEGAL_COMPLIANCE §0.2 finding 6; #527 (LG6) | The owner ruled Stripe first (#527 (D)), built (#527 (E)). Stripe issues no 1099 for this set-up, and its W-9 collection is a US-business preview whose API is not on Accounts v2; UK and DAC7 reporting runs through its Platform tax reporting preview on the totals the operator CSV gives                                                                                                      | LEGAL LG6 (landed) · PRD-M5, USER_FLOWS MW-57 · E2.2's tax-reporting period |

## E.3 Regimes for counsel to rule in or out

Each regime below is a candidate only. The middle column says where the product touches it, and
draws no conclusion about whether it applies.

| Regime                                                                   | Where the product touches it                                                                                                                                                                                                                                                                       | Questions                          |
| :----------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------- |
| UK GDPR and DPA 2018                                                     | Accounts and profiles, messages, files, identity checks through Stripe Identity, leakage screening, search logs and embeddings, erasure and the legal-hold vault (#336), the 13–17 high-privacy defaults, the processors in E.1.3, a self-serve data copy (#450), the anti-piracy watermark (#393) | E2.1–E2.7, E2.10, E2.15; E.5       |
| PECR                                                                     | The cookies and browser storage in E.1.4; the newsletter's double opt-in and per-topic consent (#480); Marketing opt-in at the root and the idle-basket reminder (#492); invitation emails to non-users                                                                                            | E2.7, E2.8; E.1.4                  |
| Consumer Contracts Regulations 2013 and the EU Consumer Rights Directive | Consumers buy digital products, services and sessions at checkout. The only acknowledgement before Pay is the files notice (#488); nothing names a right to cancel                                                                                                                                 | E2.11, E2.12, E2.13; Part D Q3 (c) |
| DMCC Act 2024                                                            | Subscription plans (#252; nothing is buyable yet, #472); reviews, double-blind and allowed only after a completed engagement, and the Client Trust Score (#486); tax added at checkout (#490 (c))                                                                                                  | E2.21                              |
| Online Safety Act 2023                                                   | User-to-user messaging (rooms, direct messages, inquiries); public profiles, listings and portfolios; reports and penalties (T&S R1–R3, PRD-D9); 13–17 accounts; known-image hash matching                                                                                                         | E2.9; E.1.5                        |
| EU Digital Services Act                                                  | Notice and action (#496); a marketplace where sellers sell to consumers, settling in EUR among nine currencies (#423), with seller identity verified through Stripe Connect onboarding; we found no trader information shown to buyers on a listing page                                           | E2.10                              |
| UK platform-operator reporting regulations (2023) and EU DAC7            | Sellers paid through the platform for services, sessions and products; the seller tax-reporting retention row                                                                                                                                                                                      | E2.24, E2.2                        |
| CDPA 1988 s.90(3) and s.91; 17 U.S.C. §204(a)                            | IP passes from maker to client on final release (E.1.6); future work assigned in advance; the record of transfer (LG4)                                                                                                                                                                             | E2.16–E2.19                        |
| MLR 2017                                                                 | Platform wallets, top-ups, escrow and withdrawals; KYC through Stripe; the AML-ready signals (LG7) and the dormant programme (X2)                                                                                                                                                                  | E2.1                               |
| E-money and safeguarding                                                 | Users' money held in the platform's Stripe balance                                                                                                                                                                                                                                                 | Part D Q1                          |

## E.4 The sign-off runbook (for a human, once counsel approves a document)

No agent sets `reviewedAt`. Do these in order, one change per approved document.

1. **Record the approval** on the answer line below: the document, the version, counsel's name and
   the date.
2. **Make the approved text the version.** If counsel changed words, they go into the draft first,
   following #270's versioning: a published version is never rewritten.
3. **Set `reviewedAt`** to the approval date in the document's content module
   (`apps/web/features/legal/core/content/<slug>.ts`). A review never pre-dates the text it reviews,
   so the date is on or after the version's `updatedAt`.
4. **Confirm the effective date** with counsel, and set `effectiveDate` and `updatedAt` to match.
   `define.ts` refuses a version dated before an older one.
5. **Remove the reconstructed 1.0 baselines** of the Terms and the Escrow Terms once their first
   real version is approved (#270 (b)): from the content module, from `LEGAL_VERSIONS`
   (`packages/types/legal/manifest.ts`, the Terms only) and from the `org.legal_document_versions`
   seed (`00005050`, edited in place). On a database that holds data, check first that no
   `org.legal_acceptances` row names the baseline: the foreign key refuses the delete if one does.
6. **For an accepted document** (the Terms, the Acceptable Use Policy and the Privacy Policy at
   sign-up; the IP Transfer Deed and the Escrow Terms at a first claim or funding, #534): list the
   version newest first in `LEGAL_VERSIONS` and in the `00005050` seed, with `material` set as
   counsel says. A material sign-up version makes `org.fn_needs_reacceptance` ask everyone who
   accepted an older one to accept again (`/join?complete=terms`); every new version of a commit
   document, material or not, is asked for at the next claim or funding.
   `manifest.contract.test.ts` and `features/legal/core/manifest.test.ts`
   hold the three copies together. A hosted database gets the seed row through the release process
   (OPERATIONS OPS6; how a seed edit reaches a database that holds data is #512 (c), still open).
7. **Check the page.** The "Draft — pending legal review" disclosure is gone; the page is no longer
   `noindex` (`core/view.ts`); `/sitemap.xml` lists the document and `/legal` (`core/sitemap.ts`);
   the PDF carries the approved version. Run `deno task check` and `deno task test:unit`.
8. **Update the tracker.** Name the document and the approval in PRD-M1's evidence. When the last
   current version is reviewed and both baselines are gone, flip PRD-M1 ✅, and with it USER_FLOWS
   ID-11 (and MW-56 once the IP Transfer Deed's text is reviewed), recompute both scoreboards and
   add a §Score history line to each.

## E.5 What counsel needs before starting

Only the owner can supply these:

1. **The data controller's identity** (#270 (h), LG1 stop (b)): the legal name, company number,
   registered address, ICO registration number and a data-protection contact. Until then the Privacy
   Policy carries no placeholder text.
2. **The launch markets.** Whether the platform sells to consumers and sellers in the UK only, or in
   the EU and the US too, decides which of E.3's regimes counsel must read (the DSA, DAC7, 17 U.S.C.
   §204(a), US state taxability in E2.22).
3. **The VAT position:** whether the company is registered, and where, for E2.20–E2.23.
4. ~~**The answer to LG1 stop (a):** which new documents to add.~~ Answered 2026-11-23 (#540): both
   recommended documents are in the library, so counsel reviews all eight at once.
5. **The drafts brought current:** LG1's changes and its drift table (E.1.7). That is agent work, in
   progress, not the owner's.

**Counsel's answer:** E.1 documents approved ______ · E2.1–E2.24 ______ · E.3 regimes in / out
______ (by, date)
