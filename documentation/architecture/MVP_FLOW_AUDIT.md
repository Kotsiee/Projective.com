# MVP Flow Audit — End-to-End Trace (October 2026)

> **Status: EVALUATION, not binding.** A read-only, end-to-end trace of the core MVP flows against
> [`PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md), [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md),
> [`ROUTING.md`](ROUTING.md), [`DESIGN_SYSTEM.md`](../design-system/DESIGN_SYSTEM.md) and
> [`../database/`](../database/README.md). Nothing was changed while it was written. Every claim was
> traced by reading the migrations, services, routes and islands. It was not run against a live
> database, so items marked _(confirm live)_ need a real `db reset` run before anyone acts on them.
>
> Per root [`CLAUDE.md`](../../CLAUDE.md) §8, the spec/code contradictions in §2.6 are **flagged, not
> resolved**. Each one needs a human decision and a decision-log row before it is fixed.

**Status legend:**

- **Wired:** Working & Wired. The UI calls the API, the API calls the service, and the service
  reaches the DB function.
- **Backend only:** Backend/Schema Only. The server path exists but no UI calls it.
- **Stubbed / Broken:** a path exists but does not achieve the outcome.
- **Missing:** no implementation found.

Paths are abbreviated:

- `mig/0000NNNN` → `supabase/migrations/0000NNNN_*.sql`
- `svc/` → `packages/backend/services/`
- `api/` → `apps/web/routes/api/`
- `feat/` → `apps/web/features/`

---

## 0. Executive summary

The MVP is further along than the backlog suggests. Auth, preferences seeding, the persona unlock,
invites with the 48-day cooldown, applications, submissions, free and paid revisions, stage approval
with the 5% fee from `platform_params`, team splits, card and wallet ticket funding, Stripe top-ups
and Connect withdrawals with debit-first and `payout_reversal` are all wired end to end.

What blocks a real-money launch is a small set of **integrity defects**, not missing features.

**P0 — fix before any real money moves:**

| # | Defect | Where |
| :-- | :-- | :-- |
| 1 | `public.provision_user_profile` is `SECURITY DEFINER`, has no `SET search_path`, and is **never revoked** from PUBLIC/anon in a PostgREST-exposed schema. Anyone can provision a profile row for any `user_id` with any DoB. | `mig/00001010:26`; revokes in `mig/00002510:15-20` cover `org` only |
| 2 | `projects.claim_ticket(p_ticket_id, p_assignee_id)` is `SECURITY DEFINER` and never checks `auth.uid()`, project access, or caller = assignee. It keeps the default PUBLIC EXECUTE, and `projects` is an exposed schema (`supabase/config.toml:13`). Any signed-in user can attach any user to an `open_pull` ticket, which triggers an escrow hold from the client's wallet. | `mig/00001120:418-437` |
| 3 | **Escrow release can double-pay.** `fn_release_ticket_escrow` loops over `status='held'` escrows with no `FOR UPDATE`, and its `UPDATE … WHERE id = r.id` does not re-check `status`. Two concurrent `approve_stage` or fair-exit calls under READ COMMITTED can both credit the payee. | `mig/00001200:589-625`, `mig/00001150:913`, `mig/00001200:770` |
| 4 | **Escrow hold can double-hold.** There is no partial unique index on `finance.escrows(ticket_id) WHERE status='held'`. `fn_hold_ticket_escrow` checks and then inserts, and `fund_stage` locks no ticket rows. | `mig/00004005:9`, `mig/00001200:377,423` |
| 5 | **No pending-release window.** `finance.pending_releases` is never inserted into and `pending_release_days=7` is unused. Escrow releases and fresh card top-ups land in the *available* balance and can be withdrawn at once. This is direct chargeback exposure. | `mig/00000017:453`, `mig/00001200:612`, `mig/00001240:137` |
| 6 | **Age rules are not enforced server-side.** The only check is in `AuthBackendService.provisionAccount`. Direct GoTrue signup, `complete_onboarding` over PostgREST and #1 all bypass it. Nobody persists or enforces the under-18 `restricted` flag. | `svc/auth/AuthBackendService.ts:263`, `mig/00001010:136-182` |
| 7 | **The payout-ready gate is not wired to earning.** `fn_freelancer_payout_ready` has exactly one caller (`begin_payout`). Unverified freelancers can claim, be assigned and earn. | `mig/00001210:9-16`, `mig/00001240:270` |

**P1 — flow-breaking for the advertised journeys:**

- Whole-stage funding is unreachable in practice (§2.2).
- Approval leaves tickets un-completed (§2.4).
- Sending a draft submission skips the move to Review (§2.3).
- Pipelines instantiate into an in-memory draft only (§1.2 row 2.17).
- No-show claims have no UI and no resolution path, so escrow is frozen forever (§1.2 row 2.19).
- No `transfer.reversed` / `payout.failed` webhooks (§1.3).
- No scheduler calls the two HTTP cron routes, and the pg_cron jobs silently no-op where pg_cron is
  absent (§2.5).

**Security, needs a human:** `.env`, `.env.development` and `.env.production` are tracked in git.
Their `SUPABASE_SERVICE_ROLE_KEY` values are not `XXXX-XXXX` placeholders (root `CLAUDE.md` §6).
This audit did not decode them. Confirm whether `.env.production` holds a real project key. If it
does, rotate it and untrack the file.

---

## 1. End-to-end flow audit matrix

### 1.1 Authentication, onboarding & baseline settings

| # | Step | Status | Chain (UI → API → service → DB) | Notes |
| :-- | :-- | :-- | :-- | :-- |
| 1.1 | Email/password join | **Wired** | `(public)/(auth)/join.tsx` → `StepForm.tsx` → `api/auth/join.ts` → `AuthBackendService.provisionAccount` → GoTrue signup → `handle_new_user` trigger → `public.provision_user_profile` | Zod join schema lives in `feat/auth/core/schema.ts`, not `@projective/types`. |
| 1.2 | Login / logout | **Wired** | `login.tsx` → `api/auth/login.ts` → `authenticate` (:435) / `signOut` (:538) | `LoginSchema.remember` is accepted and then ignored. Every session gets a 30-day refresh cookie. |
| 1.3 | `/verify`, confirm, resend | **Wired** | `VerifyForm.island.tsx` → `api/auth/{verify,confirm,resend,verification-status}.ts` | `verification-status` is unauthenticated, uses a service-role read, and answers `verified` for any email: an account-existence oracle. Its JSDoc says it "auto-logs the user in", but it only navigates. |
| 1.4 | Forgot / reset password | **Wired** | `forgot-password.tsx` → `api/auth/{forgot-password,reset}.ts` | Anti-enumeration is in place. |
| 1.5 | Google OAuth (PKCE) | **Wired** | `api/auth/oauth/google.ts` → `startGoogleOAuth` (:728) → `api/auth/callback.ts` → `exchangeOAuthCode` (:747) | Verifier is stored in an HttpOnly/Lax cookie for 600 s and cleared on every callback outcome. The `redirectTo` value goes through `safeRedirect`. |
| 1.6 | Cookie issuance | **Wired** | `apps/web/utils/auth-cookies.ts:38-53` | `HttpOnly; SameSite=Lax`. `Secure` is set only when `DENO_ENV==="production"`, so an HTTPS staging deploy without that variable ships cookies without `Secure`. |
| 1.7 | `ensureSession` refresh / fail-closed | **Wired** | `utils/session.ts:49-86`, `(dashboard)/_middleware.ts:38-96` | Silent refresh when only the refresh cookie is present. On failure it clears both cookies and redirects to `/login?redirectTo=`. No loop, because `safeRedirect` refuses auth paths. **Residual:** the access cookie is trusted by presence and its JWT is not verified (acknowledged at `auth-cookies.ts:79-83`). |
| 1.8 | `/api/auth/refresh` | **Stubbed / Broken (edge)** | `api/auth/refresh.ts:18-25` | Any failure clears both cookies. `partner-service.ts:89` and `useContextSwitch.ts:109` call it right after a successful mutation, so a transient GoTrue error signs the user out. |
| 1.9 | DoB collection | **Wired (client + app server)** | `DobField` in `StepForm.tsx:203-240` → `isJoinable(bracketFromDob())` in `packages/types/auth/age.ts` | Stored in `org.users_public.dob date NOT NULL` (`mig/00000011:38`). |
| 1.10 | Under-13 block | **Stubbed / Broken** | App layer only | No CHECK, trigger or function check in the DB. Bypassable via direct GoTrue signup (`enable_signup=true`), `complete_onboarding` (granted to `authenticated`, `mig/00002510:130`), or P0 #1. |
| 1.11 | Under-18 buy/sell block | **Missing** | — | No `restricted` column or claim, and no use of `ADULT_AGE` outside the auth UI. Not checked in checkout, catalogue, fund paths or `enable_freelancer_profile`. Contradicts `PRODUCT_SPEC.md:2489-2501`. |
| 1.12 | `org.seed_user_preferences()` | **Wired** | Trigger `on_users_public_created` (`mig/00001810:15`) → `mig/00001010:342` | Inserts `user_id` only. Column defaults give `theme='system'`, `locale='en-GB'`, `preferred_display_currency='GBP'`, `layout_direction='auto'`. Browser locale and currency at signup are not captured. |
| 1.13 | `comms.seed_notification_prefs()` | **Wired** | Trigger `mig/00001810:19` → `mig/00001310:46` | email and in_app on; push and sms off; `digest_frequency='off'`, `digest_hour=8`, `timezone='UTC'`. |
| 1.14 | Duplicate notification toggles | **Stubbed / Broken** | `org.user_preferences.notification_email/push` written by `UserBackendService.ts:117` | No SQL reads the `org` pair. Delivery uses `comms.notification_prefs`, so the settings toggles have no effect. |
| 1.15 | Org-owner preference rows | **Missing** | `create_organisation` path | Organisation owners never get an `org.users_public` row, so neither seed trigger runs for them. |
| 1.16 | `/become-partner` | **Wired** | `BecomePartnerWizard.island.tsx` → `partner-service.ts` → `api/user/freelancer.ts` → `UserBackendService.enableFreelancer` (:368) → `org.enable_freelancer_profile` (`mig/00001020:53`) | Inserts with `ON CONFLICT DO NOTHING` and keeps `is_operator`, so the client persona is intact. No KYC or age gate, so a 13–17-year-old can unlock selling. |
| 1.17 | JWT hook after unlock / switch | **Wired (client-forced)** | `public.custom_access_token_hook` (`mig/00001700`) | Emits `active_profile_*`, `active_team_id`, `active_organisation_id` and `app_metadata.active_context{type,id,role,isClient,isFreelancer,onboarded,…}`. A refresh is forced only by the client (`remintSession`, `useContextSwitch`). `POST /api/context/switch` does not refresh server-side, so any other caller leaves the claims stale. |

### 1.2 Core project lifecycle

| # | Step | Status | Chain | Notes |
| :-- | :-- | :-- | :-- | :-- |
| 2.1 | Quick-Init create (Task / One-off) | **Wired (unpriced)** | `ProjectCreateModal.tsx:351` → `ProjectSidebarService.create` → `api/projects/create.ts` → `ProjectBackendService.create` (:3247) → `insertProject` (`live-writes.ts:1930`) → `projects.create_stage` RPC | Creates a `draft` project with currency, root stage "Delivery"/"Stage 1" and a Discussion room. **The modal always sends `baselineAmountCents: null`** and has no price or currency field, so pricing happens later via `api/projects/setup.ts`. If the stage insert fails, only a warning is logged, leaving a stageless project. A profile-launched modal shows the invitee but never invites them. |
| 2.2 | Fund one ticket (card or wallet) | **Wired** | `ProjectBoard.island.tsx:489` → `BuyNowModal.island.tsx` → basket → checkout → card: `createCheckoutCardPayment` → webhook `payment_intent.succeeded` → `finance.settle_card_payment` → `place_wallet_order` → `projects.fund_ticket` → `fn_hold_ticket_escrow` | Amount is re-priced in the DB. `begin_card_payment` refuses a mismatched expected amount. |
| 2.3 | Fund whole stage from wallet | **Stubbed / Broken** | `WalletDialogs.tsx:309` → `api/wallet/action` (`fund_escrow`) → `wallet-actions.ts:323` → `projects.fund_stage` (`mig/00001150:509`) | The TS layer refuses non-business wallets, although `fund_stage` supports individuals. `fund_stage` funds only *assigned, unfunded* tickets, a state the escrow-sync trigger makes almost unreachable (§2.2). |
| 2.4 | Fund whole stage by card | **Backend only** | `api/finance/escrow/intent.ts` → `createEscrowLockIntent` → webhook → `fund_stage` | No UI caller. An unpriced ticket is excluded from the charge but raises `no_price` in `fund_stage`, so the money lands in the wallet and is not locked. |
| 2.5 | Discover / hire / invite | **Wired** | `ProjectAssignModal` → `api/projects/hire.ts`; roster → `api/projects/[id]/invites.ts`, `members/stage-invite.ts`; links → `invite-links/redeem.ts` → `invite_to_project` / `invite_by_email` / `redeem_invite_link` | Notifications `stage.invite` and `application.received` are sent. |
| 2.6 | Accept / decline invite | **Wired** | `ConversationContextPanel.island.tsx:80` → `api/projects/invites/respond.ts` → `respond_to_project_invitation` → `fn_apply_invitation_decision` (`FOR UPDATE`) | Inviter is notified. |
| 2.7 | 48-day decline cooldown | **Wired** | `mig/00001130:1795-1807` (`declined_at + 48 days`), `INVITE_COOLDOWN_DAYS=48` | Matches `PRODUCT_SPEC.md:1356` and `PRODUCT_MANAGEMENT.md:239`. Correctly not applied to email invites or self-redeemed links. |
| 2.8 | Apply / withdraw | **Wired** | `ProjectApplyModal.island.tsx` → `api/projects/apply.ts` → `apply_to_project`; `ProposalList.island.tsx` → `withdraw_application` | A withdrawal does not notify the owner. |
| 2.9 | Accept application | **Wired, with races** | `MemberRoster.island.tsx:363` → `api/projects/applications/accept.ts` → `assign_from_application` (`mig/00001130:1238`) | Has a per-candidate advisory lock, a same-stage unique index and `fn_assignee_slot_conflict`. **Does not call `check_ticket_capacity`.** Two different candidates accepted for one seat at the same moment can both land: the application is read without `FOR UPDATE` and the seat is set `filled` without `WHERE status='open'`. Auto-rejected applicants get no notification. |
| 2.10 | Accept invitation vs double-booking | **Stubbed / Broken** | `mig/00001130:2004-2017` | No `fn_assignee_slot_conflict` or advisory lock, so accepting invitations can double-book overlapping stages. |
| 2.11 | Capacity (Wᵢ) | **Wired at claim only** | `projects.check_ticket_capacity` (`mig/00001140:183`) ← `fn_assign_ticket_core` ← `claim_ticket`, `assign_ticket_manual`, auto-routers | Not checked at application or invite acceptance. **Update 2026-10-13 (Decision #214):** by design — acceptance seats a freelancer and lands no ticket, so it adds nothing to Wᵢ; the caps bite at claim/assign. |
| 2.12 | Ticket → `claimed` / `in_progress` | **Wired (move); self-claim UI missing** | `ProjectBoard.island.tsx:525,585` → `BoardService.move` → `api/projects/ticket/move.ts` → `moveTicket` → `projects.move_ticket` (`mig/00001120:326`) | `fn_ticket_escrow_sync` raises PF402 if the ticket isn't funded. A plain move to `claimed` sets no assignee, so it always PF402s. A real claim needs `claim_ticket`, **which no app code calls**, and which is P0 #2. |
| 2.13 | Submit deliverable | **Wired; draft path broken** | `SubmissionExplorer.island.tsx` → `SubmissionsService` → `api/projects/submissions/create.ts` → `createSubmission` (:3038) → `projects.submit_deliverable` (`mig/00001150:84`) | Attaches files, resolves open revision rounds, sets `revision_of`, moves the ticket to `in_review`. **Sending a saved draft** (`live-writes.ts:2830-2857`) is a bare status UPDATE: the ticket is not moved, rounds stay `open`, and `submission_files` errors are ignored. Neither path checks that the caller is the assignee or that the ticket belongs to `p_stage_id`. |
| 2.14 | Review / request changes | **Wired** | `SubmissionExplorer:606` → `SettlementService` → `…/submissions/[submissionId]/review.ts` → `projects.review_submission` (`mig/00001150:175`) | Included revisions are counted with `project_stages.file_revisions_allowed` (NULL means unlimited) and `revisions_used` under `FOR UPDATE`. Past the allotment it raises PR402 `paid_revision_required` with the price. Terms are frozen by `fn_stage_revision_terms`. |
| 2.15 | Paid revision | **Wired (basket only)** | `SubmissionExplorer:639` → `…/paid-revision.ts` → `request_paid_revision` → Buy Now `paid_revision` line → `place_wallet_order` → `fund_paid_revision` → `fn_hold_revision_escrow` | No direct-to-escrow funding endpoint. The test file `svc/finance/revision-purchase.test.ts` exists, but the logic lives in `live-basket.ts`. |
| 2.16 | Approve stage → release | **Wired, with defects** | `SubmissionExplorer:687` → `api/projects/[id]/stages/[stageId]/approve.ts` → `approveStage` → `projects.approve_stage` (`mig/00001150:913`) → `fn_release_ticket_escrow` → `fn_escrow_fee_bp` → `fn_effective_platform_fee_bp` (`platform_fee_bp=500`) → `fn_wallet_credit('escrow_release')` or `fn_split_team_payout` | The release happens immediately and the fee is computed in SQL (truncating, on the base amount only). **Defects:** the race (P0 #3); the stage's own state is not checked; **tickets are never set to `completed`**, so `payment_status='partially_released'` and cards stay in Review; the `stage_approved` notification goes to assignees only, not split members or the client. **Update 2026-10-13:** completion, notices and a single settle path landed in Decision #194; Decision #213 refuses a stage nobody was hired on and refunds (never completes) an unclaimed prepaid ticket. |
| 2.17 | Pipelines (JIT escrow, column locks) | **Stubbed / Broken** | `BookingCtaRig.tsx:98` / `ServiceDetailModal.tsx:302` → `api/services/instantiate-pipeline.ts` → `instantiateService` (:3313) | Fixture `findItem` plus the in-memory draft store. "LIVE: … RPC (not yet implemented)" (:3356). JIT per-ticket hold exists generically. **Column locks and "Chain Reaction" (approve → lock next) were not found.** **Update 2026-10-13 (Decision #210):** the Chain Reaction already lived in `force_complete_stage` (every approval path); it gained the per-stage `chain_reaction` toggle, chain history and notices, and the column lock is now a derived board rule (`workColumnLocked`). |
| 2.18 | Sessions: booking + handshake | **Wired** | `api/services/book-session.ts` → `BookingBackendService.bookSession` → basket, or `projects.reserve_seat` → `fn_confirm_seat`; reschedule via `api/scheduling/{reschedule,rsvp}.ts` → `scheduling.event_reschedules` rounds, `close_reschedule_round` | A set-session block books one slot; the "remaining n-1 after payment" flow was not found. |
| 2.19 | Sessions: 24h negative-consent | **Wired for cohort seats only** | `finance.auto_release_session_escrow` (`mig/00001155:1061`, `session_payout_hours=24`), `cron.schedule('*/15 * * * *')` | It is guarded, so it silently no-ops without pg_cron. 1:1 sessions have no auto-release. The no-show claim (`api/sessions/sittings/[eventId]/no-show.ts` → `claim_session_no_show`) has **no UI consumer** and **no dispute-resolution path** (`DisputeService` not found; no `UPDATE finance.disputes`), so a claim freezes escrow indefinitely. |
| 2.20 | Fair Exit cancel | **Backend only** | `…/stages/[stageId]/cancel.ts` → `cancel_stage_fair_exit` → `fn_fair_exit_release` | 25/50/75 tiers; fee only on the earned share; refund recorded as `fair_exit_refund`. No island calls `SettlementService` cancel. It has the same race as approve and leaves ticket statuses unchanged. |

### 1.3 Real fiat & wallet rails

| # | Step | Status | Chain | Notes |
| :-- | :-- | :-- | :-- | :-- |
| 3.1 | Card top-up | **Wired** | `WalletDialogs.tsx:324` → `api/wallet/action` → `wallet-actions.ts:164` → `PaymentBackendService.createTopUpIntent` (:372) → `finance.begin_card_payment` → `stripe-rails.ts createPaymentIntent` (idempotency `payment_intent:<id>`) → Payment Element `confirmPayment` → poll `waitForSettlement` | `POST /api/finance/topup/intent` is an **orphan** with a stale docstring; the UI uses `/api/wallet/action`. |
| 3.2 | Webhook settle | **Wired** | `api/finance/webhooks/stripe.ts` (raw body, signature check, livemode check) → `planStripeEvent`/`applyStripePlan` → `fn_claim_stripe_event` dedupe (`finance.idempotency_keys`) → `settle_card_payment` → `fn_wallet_credit` | Amount and currency are checked against the payment row. |
| 3.3 | Ledger integrity | **Stubbed / Broken (weak)** | `finance.wallets.balance_cents` + `finance.transactions` | Append-only only by grants (`authenticated` SELECT). **No trigger blocks UPDATE/DELETE**, `service_role` has `GRANT ALL`, and `transactions.wallet_id` is `ON DELETE CASCADE`. `balance_cents` is mutated alongside the ledger, not derived from it, and no reconciliation job exists. `fn_wallet_credit`/`fn_wallet_debit` silently `RETURN` when the wallet is missing, yet `settle_card_payment` still marks the payment `succeeded` with a NULL `transaction_id`. |
| 3.4 | Demo opening credits | **Resolved (honest ledger)** | `fn_seed_business_wallet` removed (`mig/00001200:813-816`) | Seeds are generated ledger rows loaded only by `db reset`. Leftovers: the `demo_opening_credit` label in `wallet-ledger.ts:103` and a stale header in `seeds/gen/emit-finance.ts:12-16`. |
| 3.5 | KYC (Stripe Identity) | **Wired** | `settings/verification.tsx` → `VerificationConsole.island.tsx` → `api/finance/verify/kyc.ts`, `identity/session.ts` → `createIdentitySession` → webhook → `apply_identity_event` → `verification_cases` / `kyc_status` | — |
| 3.6 | Stripe Connect onboarding | **Wired** | `api/finance/connect/{onboarding,refresh,return,status}.ts` → `record_payout_account` / `sync_payout_account` (`mig/00001230:1147`); v2 thin events in `stripe-v2.ts` | — |
| 3.7 | `fn_freelancer_payout_ready` gate | **Wired at withdrawal only** | Sole caller `begin_payout` (`mig/00001240:270`) | Not checked at claim, assign, apply, accept or redeem (P0 #7). `user`/`team` wallets skip KYC/KYB at withdrawal and need only a verified payout account. |
| 3.8 | Withdrawal | **Wired** | `WalletDialogs.tsx:315` → `api/wallet/action` or `api/wallet/payouts.ts` → `PaymentBackendService.withdraw` (:727) → `finance.begin_payout` (wallet `FOR UPDATE`, gate, balance check, **debit first**) → `createTransfer` (idempotency `payout_transfer:<id>`) → `complete_payout` or `fail_payout` → `payout_reversal` credit | **Gaps:** only `transfer.created` is handled (no `transfer.reversed`, `transfer.failed` or `payout.failed`); a transient error leaves the payout `pending` and debited, and nothing sweeps it; `destinationId` is accepted and then dropped (`wallet-actions.ts:189-195`); no minimum amount; P0 #5. |
| 3.9 | Scheduled deposits | **Backend only** | `POST /api/finance/cron/deposits` (bearer `FINANCE_CRON_SECRET`) → `processDueDeposits` → `claim_due_deposit_rules` (SKIP LOCKED) | Nothing calls the route. |
| 3.10 | Fee single source | **Stubbed / Broken (duplicated)** | Source of truth: `security.platform_params.platform_fee_bp=500` via `fn_effective_platform_fee_bp` | Duplicates: `place_wallet_order` hardcodes `c_fee_bp := 500` (`mig/00001210:925`) and its comment wrongly says the param "is seeded 0" (:902); `preview_team_split` reads the param but skips negotiated rates (:1876); TS has `PLATFORM_FEE_BP=500` (`packages/types/finance/checkout.ts:56`); `live-wallet.ts:642` rounds half-up where SQL truncates; `board-fixtures.ts:659` uses `0.05`. |
| 3.11 | Env contract | **Wired** | `packages/backend/core/env.ts` ↔ `SYSTEM_ARCHITECTURE.md` "Environment Variable Contract" | No `sk_live_`/`pk_live_`/`whsec_` literals found. Tracked `.env*` files: see the security note in §0. |

---

## 2. Flow breakages & missing connective tissue

### 2.1 Privilege holes in exposed schemas (P0 #1, #2)

`supabase/config.toml:13` exposes `public`, `org`, `security`, `projects`, `finance` and more through
PostgREST. Postgres grants EXECUTE to PUBLIC by default. `org` and `finance` revoke that blanket,
but `public` and `projects` do not. Every `SECURITY DEFINER` function in those two schemas must
either check the caller or be revoked.

**Fix:**

1. Add a schema-wide `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA projects, public FROM PUBLIC, anon`
   plus `ALTER DEFAULT PRIVILEGES … REVOKE`, in `mig/00002510`.
2. Re-grant to `authenticated` by name.
3. Add `auth.uid() = p_assignee_id` (or a reviewer/owner check) and `has_project_access` inside
   `claim_ticket`.
4. Add `SET search_path` to `provision_user_profile`.

Precedent: the same blanket-revoke reasoning for `org` and `finance`, and READ_API_FINDINGS §1.

### 2.2 Stage funding cannot reach its own precondition

`fund_stage` selects tickets that are assigned *and* unfunded (`mig/00001150:583-588`). The
AFTER trigger `fn_ticket_escrow_sync` either holds escrow the moment an assignee is set or aborts the
assignment, and a failed claim rolls the assignee back to NULL (`mig/00001140:383-392`). Neither
invite nor application acceptance sets ticket assignees, and `create_stage` creates no tickets. So
the "Lock the stage" CTA almost always answers "No assigned, unfunded tickets" _(confirm live)_.

A solo freelancer's unfunded ticket then dead-ends. It is `needs_funding` with no assignee, and
`fund_ticket` refuses with "Nobody can be paid … yet" (`:680`), because the prepayment store noted at
`:624` does not exist.

**Fix:** decide the funding model with a human (spec §2.6 a), then do one of two things:

- fund *priced* tickets regardless of assignee into a prepaid, unassigned escrow, then bind the
  payee at claim; or
- assign at acceptance and hold in the same transaction.

### 2.3 Submission and approval leave the board in the wrong state

- **Draft-send path** (`live-writes.ts:2830`): route it through `submit_deliverable`, so one door
  handles the ticket move, revision resolution, `revision_of` and file errors.
- **`approve_stage`:** set released tickets to `completed` (or a terminal `paid` column) before the
  `payment_status` CASE runs, and check the stage's own status. Today the stage reads `paid` while
  its cards sit in Review as `partially_released`.
- **`review_submission(accept)`:** marks only the submission. Per `PRODUCT_MANAGEMENT.md:442`
  ("Approve → Released"), either release per ticket here or relabel the UI so "Accept" ≠ "Approve &
  pay" (flag §2.6 b).
- **Notifications:** missing for team-split recipients and the client on approval, auto-rejected
  applicants, and withdrawn applications. Nothing emits the seeded `payout.failed`, and the seeded
  `smoother.deposit` type has no sender.

### 2.4 Concurrency on money

| Path | Gap | Fix |
| :-- | :-- | :-- |
| `fn_release_ticket_escrow` / `fn_fair_exit_release` | No row lock; no status re-check | `SELECT … FOR UPDATE` in the loop, plus `UPDATE … WHERE status='held' RETURNING`, skipping when no row comes back. |
| `fn_hold_ticket_escrow` / `fund_stage` | Check-then-insert | `CREATE UNIQUE INDEX … ON finance.escrows(ticket_id) WHERE status='held'` (category 4 file), plus `FOR UPDATE` on the ticket rows in `fund_stage`. |
| `assign_from_application` | Two candidates, one seat | `FOR UPDATE` on the seat and the application, plus `UPDATE … WHERE status='open'` with a row-count check. |
| Invite accept | No slot-conflict check | Reuse the advisory lock and `fn_assignee_slot_conflict` from application accept. |
| Capacity | Not checked at accept | Call `check_ticket_capacity` (or a stage-level analogue) in both accept paths. |

### 2.5 Wallet reconciliation and the scheduler gap

- **Ledger:** add a `BEFORE UPDATE OR DELETE` trigger on `finance.transactions` that raises
  unconditionally. Change `wallet_id` to `ON DELETE RESTRICT`; wallets are never hard-deleted (§5,
  "Archived"). Have `fn_wallet_credit` and `fn_wallet_debit` **raise** instead of returning
  silently. Add a nightly reconciliation of `balance_cents = Σ transactions` that writes to
  `ops.*` and alerts on drift.
- **Pending window:** insert into `finance.pending_releases` on `escrow_release`, `product_sale` and
  card `topup` credits, keyed by `pending_release_days`. Move the money from pending to available
  with a sweep. Withdrawal checks only available funds.
- **Payout webhooks:** handle `transfer.reversed` (→ `payout_reversal` credit, which already exists)
  and connected-account `payout.failed`/`payout.paid` (→ status and notification). Add a sweep that
  reconciles `pending` payouts older than N minutes against Stripe using the stored idempotency key.
- **Scheduler:** there is no runner for `POST /api/finance/cron/deposits` or
  `POST /api/user/cron/erasures`. The three `cron.schedule` blocks (`archive-stale-service-drafts`,
  `auto-release-session-escrow`, `finance-billing-cycle`) silently skip without pg_cron. Pick one
  scheduler (hosted pg_cron + `pg_net` calling the HTTP routes is the smallest change), document it
  in `SYSTEM_ARCHITECTURE.md`, and make the guarded blocks log loudly when they skip.

### 2.6 Spec ↔ code contradictions (flag for §8 — do not resolve silently)

| | Source says | Code does |
| :-- | :-- | :-- |
| a | `PRODUCT_SPEC.md:54`: escrow locks when the freelancer moves the ticket to In Progress. | Locks at claim or funding; In Progress only *requires* a held escrow. |
| b | `PRODUCT_SPEC.md:57`, `PRODUCT_MANAGEMENT.md:442`: approving a submission releases payout. | `review_submission(accept)` releases nothing; only `approve_stage` or dragging to Done does. |
| c | `PRODUCT_SPEC.md:1233-1237`: a freelancer cannot land a gig until KYC and payout account are both in place. | Gate exists only at withdrawal (`mig/00001210:9-13` says it awaits human sign-off). |
| d | `PRODUCT_SPEC.md:2489-2501`: a persisted `restricted` flag, re-derived server-side, blocks buy/sell for under-18s. | Not persisted; not enforced. |
| e | `PRODUCT_MANAGEMENT.md:443`: Pipeline "Chain Reaction" locks the next ticket's escrow on approval. | Resolved by Decision #210 — the same ticket's next stage, in `force_complete_stage`; probe `chain_reaction.sql`. |
| f | `PRODUCT_SPEC.md` session cancel → auto-refund, plus a `DisputeService` audit trail. | Not found; disputes have no resolution writer. |

### 2.7 Smaller connective-tissue gaps

- `ProjectCreateModal`'s docblock (`ProjectBackendService.ts:3238`) promises a currency selector
  that doesn't exist. The modal navigates by slug although the service says to use `id`.
- `finance.place_wallet_order` refuses whole-project, service and 1-1 slot lines (PS501). Only
  tickets, paid revisions, seats and digital products can be bought.
- `documentation/database/*/Functions.md` cites migration filenames from before consolidation (for
  example `org/Functions.md:112`).
- `API_BACKLOG.md` lists Explore and the booking offer as "Stub only", but both are live.
- `CookieKeys.AUTH_SESSION_TOKEN = pj_auth_session` is never set.

---

## 3. Post-MVP implementation roadmap

**Phase 0 is a hard prerequisite.** Do not start Phases 1–4 on top of the P0/P1 items: every later
phase moves money through the same release, hold and ledger primitives.

### Phase 0 — MVP integrity hardening (≈2–3 sprints)

| Epic | Stories (each lands with migration + Zod + `documentation/database/*` per §1) |
| :-- | :-- |
| **0.1 Function privilege sweep** | Blanket revoke for `public` and `projects` functions; caller checks in `claim_ticket`; `SET search_path` on every `SECURITY DEFINER` function; a `deno task check`-adjacent SQL lint listing definer functions without `search_path` or a revoke. |
| **0.2 Money concurrency** | Unique held-escrow index; `FOR UPDATE` and status-guarded updates in release and fair-exit; seat and application locks; capacity check at accept; slot conflict at invite accept. Pgtap or Deno integration tests that fire two concurrent approvals. |
| **0.3 Ledger guarantees** | Immutability trigger, `ON DELETE RESTRICT`, raising credit/debit, nightly reconciliation, `pending_releases` window, withdrawable = available only. |
| **0.4 Age & earning gates** | DB-side DoB check in `provision_user_profile`/`complete_onboarding` (or a CHECK on `users_public`); persisted `restricted` flag and JWT claim; enforcement in checkout, `place_wallet_order`, `enable_freelancer_profile`, apply/claim; `fn_freelancer_payout_ready` at claim/assign after sign-off on §2.6 c. Dev Context Switcher control for the `restricted` axis (root §5). |
| **0.5 Board truth** | `approve_stage` completes tickets; draft-send goes through `submit_deliverable`; decide §2.6 a/b; stage funding model from §2.2 and a card-funding UI for `escrow/intent`. |
| **0.6 Payout lifecycle** | `transfer.reversed`, `payout.failed`/`paid` handlers; stale-pending sweep; honour `destinationId`; minimum withdrawal param. |
| **0.7 Scheduler** | One runner for pg_cron and the HTTP cron routes; documented in `SYSTEM_ARCHITECTURE.md`; deposits and erasures switched on. |
| **0.8 Disputes MVP** | `DisputeService` with open → evidence → resolved (release/refund/split) transitions in `PRODUCT_MANAGEMENT.md`; no-show UI wired to `SessionService.claimNoShow`; Fair Exit UI wired to `SettlementService` cancel. |
| **0.9 Fee single source** | `place_wallet_order` and `preview_team_split` read `fn_effective_platform_fee_bp`; TS previews fetch the effective bp from the server and round the way SQL does (truncate); drop `PLATFORM_FEE_BP` from `@projective/types`, or keep it display-only with a test that pins it to the seed. |

### Phase 1 — Workspace & team scale

What exists: teams, businesses, seats via `fn_effective_limit('team_seats')`, roles/capabilities,
vault permissions, spend approvals, and team splits (`fn_team_split_plan` → `fn_split_team_payout`
with co_op / finders_fee / benevolent_dictator rules plus `percent_bp`). The console module
registry is complete (`feat/workspaces/core/module-registry.tsx:146`).

1. **Contribution agreements per engagement.** Splits today are team-level. Add per-stage
   overrides (`finance.contribution_agreements` keyed by stage and escrow) that freeze at funding
   time, as revision terms do, so a mid-project split edit can't redirect held money. Approval
   notifications go to every split recipient.
2. **Org → business hierarchy.** `org.organisations` has only `departments text[]`. Add a parent
   link (`org.organisation_businesses`), a hierarchical spend policy (department budget → business
   vault), a console switcher level, and JWT `active_context` support. `PRODUCT_SPEC.md:661` covers
   multi-business ownership.
3. **Seat billing.** Tie seat count to `finance.plans` (Phase 3.4) and prorate via the billing cycle.
4. **Team capacity.** Extend `check_ticket_capacity` to team assignees, aggregating member Wᵢ.

### Phase 2 — Catalogue & marketplace

What exists: `catalogue.products`, `listings`, `listing_media`, listing RPCs, digital-product
checkout (`product_sale` credit) and Explore ranking with semantic re-rank.

1. **Digital delivery (P1 for anyone selling).** Today a buyer pays and receives nothing.
   - Seller upload into `file_manifest` via the existing upload-init/complete pipeline.
   - `catalogue.order_entitlements` (order line → files, expiry, download count).
   - A guarded download route reusing `files/download-guard.ts` with signed URLs.
   - A buyer library under `/files` or `/saved`.
   - Refund → entitlement revoke.
2. **Product sales into the pending window.** Credit `product_sale` through `pending_releases`
   (Phase 0.3), then add a refund/dispute path for digital goods.
3. **Productized service templates.** `marketplace.service_blueprints` and `stage_template` exist,
   and buyer APIs are live.
   - Build seller editors for intake fields, the stage template and session rules
     (`flows/ServiceCreation.md` "Status").
   - Replace the fixture `findItem` in `instantiateService` and `BookingBackendService` with a live
     `instantiate_service_blueprint` RPC that creates the project, stages and tickets in one
     transaction. This also unblocks Pipelines (row 2.17).
4. **Pipelines properly.** Column locks (`projects.board_columns.locked_by_escrow`) and Chain
   Reaction (approve ticket N → JIT-hold ticket N+1 from a pre-authorised budget). Both go through
   `PRODUCT_MANAGEMENT.md` first.
5. **Storefront polish.** A media ordering and alt-text editor. Per DESIGN_SYSTEM Part E, the
   storefront body follows the conversion-lane gate (UI gate 10).

### Phase 3 — Financial tooling & invoicing

What exists: `wallet_pots` table and RLS, the `set_income_smoother` enrolment RPC and params, six
seeded plans (business price NULL), working entitlement enforcement, `fn_generate_consolidated_invoice`
(tax hard-coded to 0), a daily `fn_run_billing_cycle` cron, and invoice/statement PDFs.

1. **Income Smoother engine.** A buffer pot, a monthly payout schedule run by the Phase 0.7
   scheduler (`smoother.deposit` notifications), and the `income_smoother_fee_bp` (50) fee posted as
   its own transaction reason. It needs a `PRODUCT_SPEC.md` entry; today it exists only in
   `finance-model.md`.
2. **Tax auto-set-aside.** Apply `wallet_pots.auto_allocate_bp` inside the credit primitive for
   income reasons only (`escrow_release`, `product_sale`, team splits), as an internal pot transfer
   pair. Use `tax_pot_default_bp` on opt-in.
3. **Pots CRUD + UI.** Create, rename, archive (never delete) and move between pots, with ledger rows
   for every move.
4. **Subscriptions.** Set the business plan price (human decision). Plan checkout via Stripe
   Billing; handle `customer.subscription.*` and `invoice.*` webhooks into
   `subscriptions`/`subscription_events`; entitlement refresh on change; dunning → downgrade, never
   delete.
5. **Consolidated monthly invoicing.** Compute real tax in `fn_generate_consolidated_invoice` via
   Stripe Tax (or a tax-rates table), stop the hard-coded 0, keep invoice numbers sequential per
   issuer, and use the existing auto-fund billing for settlement.

### Phase 4 — Content, calendar & platform moderation

What exists: the scheduling schema, `get_free_busy`, reschedule rounds, `.ics` export,
`comms.mask_pii` as a BEFORE INSERT trigger on project and DM messages, file status
`scanning`/`quarantined` with a bucket guard, real link scanning, and a read-only `catalogue.articles`.

1. **Session polish.**
   - 1:1 negative-consent release (generalise `auto_release_session_escrow`).
   - The set-session "n-1 after payment" scheduling flow.
   - Freelancer-cancel auto-refund.
   - Calendar sync via Nylas (`integrations.*` is seeded; `IntegrationsBackendService` refuses
     connections on purpose) with busy-import into `get_free_busy`.
   - Replace the faked provenance in `scheduling/derive.ts:193`.
2. **PII masking completeness.** Apply `mask_pii` on UPDATE (message edits) as well as INSERT, and to
   proposal/application text and file names. Measure false positives via `ops` telemetry.
3. **File quarantine.** Replace the sniff-only `scanning` step (`files/live-uploads.ts:43`) with a
   real scanner (ClamAV sidecar or VirusTotal) invoked from `completeUpload`. Make
   `supabase/functions/scan-file` real or delete it, since it is a mock that nothing calls. Downloads
   are blocked while `scanning`/`quarantined`, and the owner is notified.
4. **Content moderation** (Decisions #147, #148).
   - `ops.reports` and `ops.moderation_flags` tables.
   - A report surface on profiles, listings and messages.
   - Publish-time screening (image nudity and PII models are named in the spec but not in code).
   - A moderator queue.
   - A `moderation.action` notification, which is already seeded.
5. **Editorial.** An authoring RPC and editor for `catalogue.articles` (draft → review → published
   → archived in `PRODUCT_MANAGEMENT.md`), plus moderation hooks from 4.4.

---

## 4. Method & limits

The audit had five parallel read-only traces: auth/onboarding, creation/staffing,
execution/settlement/archetypes, fiat rails, and the post-MVP inventory. The critical items (§0 P0
#1–#5, fee duplication) were re-verified directly against the migrations. No database was run,
so items marked _(confirm live)_ and every concurrency item should be reproduced by a test before
the fix lands. The decision index (`documentation/reference/decisions/README.md`) was consulted
for the topics named; spend approvals and the Income Smoother have no index line.
