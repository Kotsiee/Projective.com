# Founder Questionnaire & Execution Order — every open ruling from the 2026-10 architecture audits

> **Status: ANSWERED 2026-10-30.** The owner filled in Part A, then answered two follow-up rounds
> the same day (the unanswered, ambiguous and self-contradictory items, and a replacement price
> table). Wave 1.1 recorded every ruling on Decisions #252, #336–#341 and #343 (the scheduling draft
> "#335"). **Part C is the ruling table.** This file merges every open question in the twelve audit
> files of `documentation/architecture/` into one form. Where several audits ask the same thing,
> they share one question. Part A is the form. Part B is the order in which to run the build work,
> and which parts can run in parallel Claude sessions.
>
> **Sources (short names used below):**
>
> - FDD = `FINANCE_DISCREPANCIES_AND_DECISIONS.md` (#337).
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
code cannot prove it. Answer: ______

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
  - [x] Yes ⭐ (counsel)

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
> PRODUCT_MANAGEMENT; the Q0.4 sweep; `WAVE1_CLAUDE_MD_PROPOSAL.md`). Steps 2–3 follow.

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

Run about **one SQL track step and two or three app/UI steps at a time**. Arrows are serial inside a
track. "⏳ X" means wait for step X in another track.

| Track                               | Order                                                                                                                                                                                                                                                                    | Cross-track waits                                                                                                                                                       |
| :---------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F · Finance**                     | DB2 → DB3 → DB4 → DB5 → DB6 → DB8 → DB9, then the new prompts for N3 commission (M1), N4 bonus (M7), N6/N8, the payout gate (M4), the conservation view (M2) and the FX feed (M5 f), all serial on `00001240`. Then SV2 → SV3; SV4; SV5. Then UI1 → UI2 → UI3; UI4; UI5. | UI prompts: check `git status` for the #243 peers first.                                                                                                                |
| **S · Subscriptions**               | S1 → S2 → S3, then S4 ∥ S5, then S6 → S7 → S8. X1/X2 are docs and can run any time after the rulings.                                                                                                                                                                    | S4 ⏳ F·DB2 (webhook file). S7 ⏳ PUBLIC_ROUTES P8. S6 and S4 share devtools, so do not run them together.                                                              |
| **P · Projects**                    | WP1 (TTL sweep) → WP4 (Fair Exit, removal, archive) → WP5 ($W_i$ / workload) → WP6; WP8 (URLs) → WP9 (submissions).                                                                                                                                                      | WP1 ⏳ jobs (Wave 1.3). WP4 ⏳ F·DB3 + F·DB6 (`00001200`/`00001240`). WP8 ⏳ WP3 (the UNIQUE on number).                                                                |
| **C · Scheduling**                  | WP2 interim (paid off) → WP3 (call doors) → WP4 (runtime) → WP5 (presence) → WP8 (settlement) → WP7 (windows) → WP6 (paid consultations) → WP9 → WP10. All serial on `00001155`.                                                                                         | WP6 ⏳ F·DB7 + F·SV4 (`place_wallet_order`). WP3 notices ⏳ the comms worker.                                                                                           |
| **M · Messaging and notifications** | One schema window: N1 unified messaging + RED WP12 inbox. Then M6 long-poll (N2). Separately: N8–N12 notify engine → email → web push → SMS (if not Planned). Search: CAS S11/S14/S37/S30 + RED WP14.                                                                    | Starts after S-A3. Email ⏳ N3 rulings.                                                                                                                                 |
| **T · Trust and safety**            | E8 storage policies (Q0.2a) → SEC-P1d Tier 1 pre-filter → P2 hardening (public-copy triggers, L7 masking) → moderation loop R1 → R4 → R5 → R3 → R2 → safety node: ClamAV → admission contract (CAS §6.4) → NudeNet → Presidio.                                           | Tier 1 is better ⏳ M's single send door (one insertion point, not two). Hardening triggers touch ticket, catalogue and event text, so run them after P·WP4 and C·WP10. |
| **I · Identity**                    | Erasure on `00001060`: IW-H6 + SEC G16 → I1 windows → seats → legal-hold vault. Then F4 enterprise owner (+IW-M7). Then the F6 SSO-panel flag. Then IW-M5 archive. Then MFA + session guard (I3). **Last:** IW-M13 `users_public` row policy.                            | IW-M13 touches finance, project and business readers, so ⏳ the F, P and C SQL steps. MFA's AAL2 checks in money RPCs ⏳ F·DB phase.                                    |
| **O · Optimisation and design**     | WP2 read-path → WP11 wallet aggregates. WP10 cache primitives. WP5 shared pure rules → WP6 server capability flags. WP4 keyboard on money paths. WP7 money sweep. WP8 + WP9 card, tag, solid and lint. WP16 modal shell. WP13 chrome endpoint. WP17 SA caching doc.      | WP2/WP11 ⏳ F·SV2/SV5. WP5/WP6 ⏳ P·WP2. WP4 ⏳ F·UI2/UI3/UI5. WP7 ⏳ F·UI5 + S5. WP13 ⏳ N2.                                                                           |

## B.4 Wave 3: verification and close-out

- F·E1 → F·E2 and S8, after their tracks.
- Every track's Z1 docs sweep.
- Then one final cross-domain docs sweep: PRODUCT_SPEC, PRODUCT_MANAGEMENT, ROUTING and
  SYSTEM_ARCHITECTURE, plus a status column on every audit file.

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
| Q0.5   | Reading: the Wave 1 brief stands over the form's edit permission, so the diff is drafted for the owner to apply                                                                                                                                                                                                                                        | #341 (a) Q1; #337 X4                                                                                | `WAVE1_CLAUDE_MD_PROPOSAL.md`                               |
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
| I4     | ✎ ⚖️ Build the adult-proxy model, behind its off flag until counsel; ⭐ one EU rule; ⭐ Art. 5(1)(c)                                                                                                                                                                                                                                                   | #336 (h) F8                                                                                         | I                                                           |
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
