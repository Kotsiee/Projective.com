# org: Functions

Only the functions touched by recent work are documented here; the remaining `org.*` routines
(`set_operator_mode`, …) are still to be backfilled. See `brain2.md`'s Database section for the
migration-numbering and RLS conventions.

> **Retired 2026-09-28 (Decision #122) — these no longer exist:** `org.create_team` (it trusted a
> caller-supplied owner and was executable by `anon`), `org.create_business` (it rewrote the
> caller's session context behind their back), `org.get_dashboard_teams` (it answered for any user
> id it was handed) and `org.get_dashboard_businesses`, and the 0309 business-dashboard quartet
> `org.get_business_finance` / `get_business_members` / `get_business_admin_profile` /
> `update_business`. Their replacements are the workspace RPCs in
> [§ The workspace console](#-the-workspace-console-00001020).
>
> **`EXECUTE` is deny-by-default on the whole `org` schema** (`00002510`, top of file): it is
> revoked from `PUBLIC`, `anon` and `authenticated` on every function and on future ones
> (`ALTER DEFAULT PRIVILEGES`), the service role keeps them all, and every function that SHOULD be
> reachable is granted back by name. `org` is exposed to PostgREST, and Postgres grants `EXECUTE` to
> `PUBLIC` by default — so before this every org function, predicate and internal helper was an RPC
> anybody could call. The three membership predicates the policies are built from
> (`is_active_team_member`, `is_active_business_member`, `is_organisation_member`) stay executable by
> both client roles, because a policy expression runs as the invoking role.

## `org.enable_freelancer_profile(p_payload jsonb) → jsonb`

**Migration:** `supabase/migrations/00001020_functions_org_entities.sql` (from `0313`) ·
**Security:** `SECURITY DEFINER` · **Grant:** `authenticated` (explicitly `REVOKE`d from `PUBLIC`,
`anon` in `00002510`).

The self-serve "Become a Partner" conversion — how a user who onboarded as a Client/Operator unlocks
a freelancer profile after the fact (persona is no longer fixed at signup; cf.
`provision_user_profile` in `0304`, which only creates a freelancer profile for
`objective = 'freelancer' | 'seller'`). Keyed off `auth.uid()`. Idempotent. Called by
`UserBackendService.enableFreelancer` behind `POST /api/user/freelancer` (the `/become-partner`
page, Decision #150).

`p_payload.skills` is an optional array of **`org.skills` slugs** (the vocabulary
`freelancer_profiles.skills` holds): trimmed, lower-cased and de-duplicated in the order given; more
than ten, or any slug the taxonomy does not hold, raises `22023`. In one transaction it:

1. **Links** the freelancer record —
   `INSERT INTO org.freelancer_profiles (user_id, skills) … ON
   CONFLICT (user_id) DO NOTHING`
   (the table is keyed by `user_id`).
2. **Flips** `org.users_public.is_freelancer = true` (the denormalised flag `getMe` + nav gates
   read).
3. **Activates** the freelancer persona through `security.fn_set_session_context('freelancer',
   uid, NULL, NULL, uid)` — the one session-context writer, which clears the team and organisation
   slots in the same statement (and audits `session.switch_context`). Until 2026-10-06 this step
   upserted only the profile slot, so a caller acting as a team or an organisation held two slots
   and `ck_session_context_one_slot` failed the whole conversion.
4. **Audits** a genuine conversion only — `security.audit_logs` `freelancer.unlocked` (written from
   the definer context because `audit_logs` is not granted to `authenticated`; cf. `0205`/`0304`).

Returns `{ freelancer_profile_id, handle, created, is_freelancer }` — `handle` is the person's
`@username` (the client navigates to `/[handle]/edit`); `created` is `false` when the profile
already existed (the call is then a no-op re-activation). Raises `28000` when unauthenticated,
`42501` when the caller has not completed onboarding (no `users_public` row) and `22023` for a
refused skill list. The access token is NOT re-minted here: the client must
`POST /api/auth/refresh` so the hook stamps `active_context.isFreelancer = true`.

> Note: `org.freelancer_profiles` no longer carries an `hourly_rate` column — rates are not a
> platform signalling field (see `org/Tables.md`).

## `org.get_acting_context_details(p_context_type text, p_context_id uuid) → jsonb`

**Migration:** `00001020_functions_org_entities.sql` §5b · **Security:** `SECURITY DEFINER`,
`STABLE`, `SET search_path = ''` · **Grant:** `authenticated` (revoked from `PUBLIC`, `anon`).

The acting entity's display name for the account popover (`UserBackendService.me` →
`workspace.name`). `p_context_type` is `team` · `business` · `organisation`; answers
`{ context_type, context_id, name, handle }` only when the caller holds an **active** seat in that
entity (an organisation's owner counts), else `NULL` — so it can never read an entity the caller is
not acting inside. It exists because `org.business_profiles` has no client SELECT policy: the
previous RLS read returned nothing for a business member and the header fell back to the slug. An
organisation's `name` is its trading name, else its legal name.

## `org.update_organisation(p_org_id uuid, p_payload jsonb) → jsonb`

**Migration:** `00001020_functions_org_entities.sql` §5c · **Security:** `SECURITY DEFINER`,
`SET search_path = ''` · **Grant:** `authenticated` (revoked from `PUBLIC`, `anon`).

The **only** write door on `org.organisations` since 2026-10-06 — the table's client UPDATE policy
is gone (`org/Policies.md`). `p_payload` is the camelCase `@projective/types/org`
`UpdateOrganisation` partial:

- **Who:** the owner, an active `admin` member, or a platform admin (`security.is_admin()`);
  otherwise `42501`.
- **Which keys:** `legalName` · `tradingName` · `registrationNumber` · `corporateEmail` ·
  `corporatePhone` · `website` · `addressLine1` · `addressCity` · `addressPostcode` ·
  `addressCountry` · `employeeScale` · `primaryIndustry` · `industryOther` · `departments` ·
  `purpose` · `billingEmail` · `defaultCurrency`. A platform-owned key (`handle`, `status`,
  `verificationLevel`, `ownerUserId`, `logoFileId`, …) raises `42501`; any other unknown key `22023`
  — refused, never ignored. An empty payload is `22023`.
- **Legal identity** (`legalName`, `registrationNumber`, `corporateEmail`): owner (or platform
  admin) only — `42501` for an admin member — and **frozen** while `verification_level` is
  `kyb_pending` or `verified` (`55000`): a verified identity that could be edited afterwards would
  verify nothing.
- **Validation:** every text key is trimmed and bounded exactly as the Zod schema states;
  `legalName` / `corporateEmail` / `defaultCurrency` cannot be blank; emails must look like emails
  (stored lower-cased); `defaultCurrency` is three letters (stored upper-cased); `employeeScale` must
  be an `org.employee_scale` value; `departments` (≤ 60 chars each) and `purpose` (≤ 40) must be
  string arrays; choosing `primaryIndustry = 'other'` without an `industryOther` is `22023`. An empty
  string clears an optional field.
- **Audit:** `security.audit_logs` `organisation.updated` with `{ fields, as_platform_admin }`.

Returns `{ id, updated_fields }`. No service or route calls it yet — organisation settings have no
UI (Decision #150 flag).

## `org.seed_user_preferences() → trigger`

**Migration:** `supabase/migrations/20260722120000_seed_user_preferences.sql` · **Security:**
`SECURITY DEFINER`, `SET search_path = ''` · **Trigger:** `on_users_public_created`
(`AFTER INSERT ON org.users_public FOR EACH ROW`).

Seeds a default `org.user_preferences` row whenever a public profile is created, so a fresh account
has preference defaults from the first byte instead of only once it first writes one. It fills just
the key — the table's own column defaults supply the values (`theme = 'system'`,
`notification_email = true`, `notification_push = false`, `locale = 'en-GB'`, `ui_settings = '{}'`).

Attaching to `org.users_public` (rather than re-declaring
`provision_user_profile`/`complete_onboarding`) covers **both** signup paths in one place: the
email/password path (`0304`'s `provision_user_profile`, which never created a preferences row) and
the OAuth completion path (`complete_onboarding`). Idempotent — `ON CONFLICT (user_id) DO NOTHING`
never clobbers a row already created lazily via the INSERT-own-preferences RLS policy (`0213`). The
migration also runs a one-time `ON CONFLICT DO NOTHING` backfill for pre-existing profiles. Purely
additive (root CLAUDE.md Decision #47); reads/writes for own preferences remain owner-scoped per
`org/Policies.md`.

## `org.is_organisation_member(p_org uuid, p_min_role org.organisation_role = 'member') → boolean`

**Migration:** `supabase/migrations/0314_organisations.sql` · **Security:** `SECURITY DEFINER`,
`STABLE`, `SET search_path = org, public`.

Returns `true` when `auth.uid()` is an **active** member of organisation `p_org` at or above
`p_min_role` (the enum ranks `owner` ≥ `admin` ≥ `member`). It exists so the RLS policies on
`org.organisations` / `org.organisation_members` can check membership without the policy on one
table triggering the policy on the other — the definer context bypasses RLS on
`org.organisation_members`, breaking the recursion the Policies doc's Security Notes warn about.
Keyed off `auth.uid()`; safe to call from any policy `USING`/`WITH CHECK` clause.

## `public.create_organisation(p_owner uuid, p_payload jsonb) → uuid`

**Migration:** `supabase/migrations/00001010_functions_org_onboarding.sql` (from `0315`) · **Security:**
`SECURITY DEFINER`, `SET search_path = public, org, security` · **Grant:** `service_role` only.

Atomic organisation provisioning, called by `@projective/backend`'s `AuthBackendService`
(service-role) **after** it admin-creates the owner identity in GoTrue. In one transaction it:
inserts `org.organisations` (owner = `p_owner`; `NULLIF` collapses the client's empty-string
defaults to `NULL`, and the 0314 `industry_other` CHECK still applies), seeds the owner's
`org.organisation_members` row (`role = 'owner'`), and writes an `organisation.created` entry to
`security.audit_logs` (definer context, because that table isn't granted to `authenticated` — cf.
`provision_user_profile` in 0304). `p_payload` is the camelCase `@projective/types`
`CreateOrganisation` shape. Returns the new org id.

**Handles share one namespace** (2026-10-06): the handle is trimmed and lower-cased, then checked
with `org.fn_handle_refusal` BEFORE the insert — the same rule (3–40 chars, lowercase letters,
digits and hyphens, not reserved, not taken by any person, team, business or organisation) and the
same sentence the create forms' availability probe shows. A taken handle raises `23505`, any other
refusal `22023`; `AuthBackendService` returns the message with a 422. The `UNIQUE` on
`organisations.handle` only ever saw other organisations, so before this an organisation could claim
a person's `@username` and the two fought over `/{handle}`.

**Grant:** `service_role` only, and explicitly `REVOKE`d from `PUBLIC`, `anon` and `authenticated`
(`00002510`) — it trusts the `p_owner` it is handed, and Postgres grants a new `public` function to
`PUBLIC`, so until 2026-10-06 any signed-out caller could mint an organisation owned by anybody.
Owner-only (buyer) by construction — organisations carry no service/product surface.

---

## 📧 Email addresses (`00001050`)

**Migration:** `supabase/migrations/00001050_functions_org_emails.sql` (trigger in `00001815`) ·
**Zod:** `packages/types/org/user-emails.ts` · **Service:** `EmailsBackendService`
(`packages/backend/services/user/`) · **Routes:** `/api/user/emails/*`.

`org.user_emails.verified_at` unlocks the invitations sent to an address, so the table is read-only to
a client ([Tables.md](Tables.md#orguser_emails), [Policies.md](Policies.md#orguser_emails)) and these
definers are its write doors (with `public.provision_user_profile` and `public.handle_email_confirmed`).
All are `SECURITY DEFINER`, `SET search_path = ''`, resolve the caller from `auth.uid()` and touch only
the caller's own rows; `EXECUTE` is `authenticated` only (`00002510` — the org schema is deny-by-default).
The per-person writes take `pg_advisory_xact_lock(hashtext('user-emails:' || uid))`, so concurrent
adds cannot both pass the limit and concurrent primary switches cannot race the one-primary index.

**Refusals** are raised as the exception MESSAGE with SQLSTATE `P0001`, the message being exactly one
`EmailRefusal` code — `email_invalid` · `email_exists` · `email_limit` · `email_not_found` ·
`email_unverified` · `email_is_primary` · `email_is_sign_in` · `email_in_use` · `token_invalid` ·
`token_expired` · `token_used` · `token_wrong_account`. Two conditions carry their own SQLSTATE instead:
no signed-in subject → `28000 'not_authenticated'`; no `org.users_public` row yet (an OAuth sign-up mid
onboarding) → `42501 'profile_required'` (`add_user_email` only). Every write appends a
`security.audit_logs` row (`user.email_added` · `user.email_removed` · `user.email_primary_changed` ·
`user.email_verified`) carrying no address.

| Function | Returns | Does / refuses |
| :-- | :-- | :-- |
| `org.get_my_emails()` | `TABLE (id, email, is_primary, verified_at, is_sign_in, created_at)` | The caller's rows, primary first then oldest. `is_sign_in` = the address equals `auth.users.email` (case-insensitive) — a different fact from `is_primary`. `LANGUAGE sql STABLE`; empty for no subject. |
| `org.add_user_email(p_email text)` | `uuid` | Trims + lower-cases; files the address **unverified, not primary**. `email_invalid` (not `x@y.z`-shaped, or > 254 chars) · `email_exists` (already the caller's, case-insensitively — also the `uq_user_emails_user_email` race) · `email_limit` (the caller already has 5 — `MAX_USER_EMAILS`). Deliberately NOT refused when another account holds the address verified: that would make this door a lookup of who is registered under which address; that refusal waits for `confirm`, when the caller has proved they hold the inbox. |
| `org.remove_user_email(p_email_id uuid)` | `void` | Deletes one of the caller's secondary addresses (its tokens cascade). `email_not_found` (also for another person's row — one answer, so ids cannot be probed) · `email_is_primary` · `email_is_sign_in`. |
| `org.set_primary_email(p_email_id uuid)` | `void` | Clears the old primary FIRST, then sets the new one (`uq_user_emails_one_primary` is partial, so never deferrable). The current primary again is a no-op. `email_not_found` · `email_unverified`. |
| `org.confirm_user_email(p_token text)` | `uuid` (the address id) | Lower-cases + trims the token; anything not 64 hex chars is `token_invalid` without hashing. Looks up `sha256(token)` and checks, in order: `token_invalid` (no such hash) → `token_used` → `token_expired` → `token_wrong_account` (`token.user_id <> auth.uid()`) → `email_in_use` (another account holds the address VERIFIED; checked under an advisory lock on the lower-cased address so two accounts cannot both win). On success stamps `verified_at = now()` (only if NULL) and consumes EVERY outstanding token of the address. A refusal consumes nothing. |

### `org.trg_user_emails_guard() → trigger`

`BEFORE INSERT OR UPDATE ON org.user_emails FOR EACH ROW` (trigger `user_emails_guard`, `00001815`).
**INVOKER** on purpose — inside a definer `current_user` is the function's owner, so the doors above,
provisioning, the GoTrue mirror, the service role and the seed all pass, and only a client role's own
statement is judged. For `anon`/`authenticated` it refuses (`42501`) an INSERT with `verified_at` set or
`is_primary = true`, and an UPDATE that changes `verified_at`, `email`, `is_primary` or `user_id`.
Defence in depth: the grants and policies already refuse every client write. Not executable by any
client role (trigger functions are checked at `CREATE TRIGGER`).

The token MINT is not here: `security.issue_email_verification` returns a raw token, so it is service
role only and lives in `security`, where the service role holds `USAGE`
([security/Functions.md](../security/Functions.md#securityissue_email_verificationp_email_id-uuid--text--service-role-only)).

---

## 🪪 Account lifecycle (`00001060`)

**Migration:** `supabase/migrations/00001060_functions_org_account_lifecycle.sql` · **Zod:**
`packages/types/org/account-lifecycle.ts` · **Service:** `AccountLifecycleBackendService`
(`packages/backend/services/user/`) · **Routes:** `/api/user/handle`, `/api/user/lifecycle`,
`/api/user/cron/erasures` (Decision #156).

All `SECURITY DEFINER`, `SET search_path = ''`; the doors resolve the caller from `auth.uid()` and act on
the caller alone, `EXECUTE` to `authenticated`; the `fn_*` helpers are definer-internal (the org schema
is deny-by-default). **Refusals** are the exception MESSAGE with `P0001`, one `AccountRefusal` code —
`handle_unchanged` · `handle_locked` · `handle_refused` (DETAIL = the namespace rule's sentence) ·
`account_closing` · `confirmation_mismatch` · `already_scheduled` · `not_freelancer` · `blocked` (DETAIL
= blocker codes) · `not_scheduled` · `scope_invalid`; no subject → `28000`, no profile → `42501
'profile_required'`. Writes take `pg_advisory_xact_lock` on the person (and, for a handle, on the handle).

| Function | Returns | Does / refuses |
| :-- | :-- | :-- |
| `org.fn_handle_change_policy(p_user uuid)` | `jsonb` | The policy clock: two changes inside a three-day window, then a 90-day lock after the window's second change. `{remaining (2·1·0), window_ends_at, locked_until, last_changed_at, total_changes}`. Mirrors `HANDLE_POLICY`. |
| `org.fn_handle_is_own_hold(p_handle, p_user)` | `boolean` | The handle is free in the four tables and held only by `p_user`'s own change in the last 90 days — they may take it back. |
| `org.get_handle_policy()` | `jsonb` | The caller's policy plus `handle`. |
| `org.change_username(p_handle text)` | `jsonb` | Lower-cases + trims; refuses `handle_unchanged` · `account_closing` · `handle_locked` · `handle_refused` (`fn_handle_refusal`, except the caller's own hold; a racing `unique_violation` too). Writes `users_public.username`, a `handle_changes` row and `user.handle_changed` to the audit log; answers the new policy + `previous`. The token carries the handle, so the caller renews the session. |
| `org.fn_account_blockers(p_user, p_scope)` | `text[]` | `escrow_held` (payee as a freelancer; payer too for `account`) · `live_work` (a live stage assignment on an active / on-hold project) · `wallet_balance` (a `freelancer` wallet; a `user` one too for `account`) · for `account` only, `active_projects` (owned, active / on hold) and `owns_workspaces` (an active owner seat on a live team, business or organisation). |
| `org.get_account_lifecycle()` | `jsonb` | `{is_freelancer, has_freelancer_profile, freelancer_removal, account_deletion, freelancer_blockers, account_blockers}`. |
| `org.schedule_freelancer_removal(p_confirmation)` | `jsonb` | Requires `CONFIRM`; `already_scheduled` · `not_freelancer` · `blocked`. Pauses the person's own published listings and unpublishes their own services (ids recorded in `metadata`), sets `is_freelancer = false`, returns the session context to personal, and schedules the erasure for **90 days**. |
| `org.schedule_account_deletion(p_confirmation)` | `jsonb` | Requires `CONFIRM`; `already_scheduled` · `blocked`. Pauses listings, hides the profile (`visibility = 'private'`, the prior value recorded) and schedules the erasure for **30 days**. |
| `org.cancel_deletion_request(p_scope)` / `org.fn_cancel_deletion(p_user, p_scope)` | `jsonb` / `boolean` | Republishes exactly what was paused, restores the persona (freelancer scope) or the visibility (account scope), and marks the request `cancelled`. `not_scheduled` · `scope_invalid`. |
| `org.fn_pause_personal_listings` / `org.fn_restore_personal_listings` | `jsonb` / `void` | The pause and its inverse — personal listings only (`owner_team_id IS NULL`); team listings belong to the team. |
| `org.fn_erase_freelancer_profile(p_user)` | `void` | Archives the personal listings (terminal), unpublishes services, clears the seller profile's skills, hire intake and identity reference, sets it unavailable. Standing, reviews and money records stay. |
| `org.fn_erase_account(p_user)` | `void` | The seller half, then the profile becomes an anonymous tombstone (`deleted-<id>` handle, names, copy, location, photos cleared, private, DOB `1900-01-01`), addresses anonymised, `auth.users` email scrubbed and banned, `auth.identities` and `auth.sessions` removed. |
| `org.fn_purge_due_deletions(p_limit = 100)` | `integer` | The sweep: every due `scheduled` request (`FOR UPDATE SKIP LOCKED`); one whose blockers came back is deferred (`metadata.deferred_by`), not forced. Reached by the service role through `security.purge_due_account_deletions`. |

`org.enable_freelancer_profile` cancels an open `freelancer_profile` request (becoming a freelancer again
inside the window restores everything) and refuses while an `account` deletion is scheduled.

---

## 🏅 Standing & progression (migration `20260724111000_standing_reputation.sql`)

All four mutating functions are `SECURITY DEFINER` with a pinned `search_path`, **`REVOKE`d from
`public`, and granted to `service_role` only** — Standing is earned, never client-written. The two
read helpers are granted to `authenticated`.

### Read helpers

- **`org.fn_level_for_score(score numeric, stages integer) → smallint`** — `STABLE`. The highest
  rung whose `min_score` **and** `min_completed_stages` are both satisfied; falls back to `1`.
  Mirrored exactly by the pure `levelForScore()` in `packages/types/org/standing.ts`.
- **`org.fn_standing_level(subject_type, subject_id) → smallint`** — `STABLE`, `SECURITY DEFINER`.
  The subject's current rung (default `1`). This is the single read the finance entitlement resolver
  uses to scale a plan value.

### Mutators

- **`org.fn_recompute_standing(subject_type, subject_id) → smallint`** — recomputes the composite
  from the stored inputs, persists `score`/`level`/`components`, appends an `org.standing_events`
  row (`promoted` / `demoted` / `recomputed`) and emits `standing.recomputed` (+
  `standing.level_changed` on a transition). Creates the `entity_standing` row on first call.

  The weight vector is a **tunable dial**, deliberately surfaced in `components` so the profile can
  explain the rung and the magnitudes can be re-fitted against `analytics.events`:

  | Component      | Weight | Source                                          |
  | :------------- | -----: | :---------------------------------------------- |
  | `completion`   |     25 | `completion_rate`                               |
  | `on_time`      |     25 | `on_time_rate`                                  |
  | `reviews`      |     20 | mean of `client_rating_avg` / `peer_rating_avg` |
  | `dispute_free` |     15 | `1 - dispute_rate`                              |
  | `workload`     |     10 | `workload_reliability` ($W_i$)                  |
  | `tenure`       |      5 | `min(tenure_days / 365, 1)`                     |
  | `penalty`      |      — | minus active `security.penalties` severity      |

- **`org.fn_award_achievement(subject_type, subject_id, code, source_ref) → boolean`** — idempotent.
  Returns `true` only on the **first** grant, so the caller can fire a celebration exactly once.
  Emits `achievement.awarded`.
- **`org.fn_touch_streak(subject_type, subject_id, kind, success) → integer`** — extends on a good
  outcome, resets to `0` on a bad one; maintains `best_count`. Emits `streak.extended` /
  `streak.broken`. Quality events only — there is no attendance streak.
- **`org.fn_record_mastery(subject_type, subject_id, category, intensity, on_time) → smallint`** —
  records one delivered stage against a CREATE category, then re-derives every category's `share_bp`
  (intensity-weighted, so specialisation reflects effort delivered rather than stage count) and
  `mastery_level`. Emits `mastery.progressed`.

> **Sweep, not trigger.** These are invoked by the backend / an Edge Function cron at
> `security.platform_params.standing_recompute_interval_hours` (default 24), not by triggers on the
> project tables — recomputing a composite inside a stage-approval transaction would couple money
> movement to reputation math. `standing_demotion_grace_days` (default 30) is reserved for the
> anti-flapping guard on demotions.

### Trust signals (`00001030` §9 — Decision #155)

All `SECURITY DEFINER`, `SET search_path = ''`, revoked from `PUBLIC` · `anon` · `authenticated` and
granted to `service_role` only. `org.fn_recompute_standing` calls the two refreshers at the end of
every recompute (the stamp for a `freelancer` subject only), so the sweep keeps both columns current.

- **`org.fn_refresh_active_adornments(subject_type, subject_id) → text[]`** — derives the earned
  trust signals from the delivery record (thresholds in [Tables.md](Tables.md#orgentity_standing)),
  stores the highest tier per dimension on `entity_standing.active_adornments` (only when it changed)
  and returns them. A `user` subject is cleared and returns `{}` — buyers are not gamified.
- **`org.fn_verification_stamp(user_id) → text`** — `STABLE`. `vault_verified` when
  `freelancer_profiles.kyc_status = 'verified'` AND `payout_ready`; `id_verified` on KYC alone; else
  `none` (also for a person with no seller row).
- **`org.fn_refresh_verification_stamp(user_id) → text`** — writes that stamp onto the person's
  `freelancer` Standing row: an `INSERT … ON CONFLICT DO UPDATE` when there is a stamp to hold (so a
  row is never created just to say `none`), an `UPDATE` back to `none` otherwise.
- **`org.trg_freelancer_profiles_verification_stamp() → trigger`** — attached `AFTER INSERT OR UPDATE
  OF kyc_status, payout_ready ON org.freelancer_profiles` (00001830); calls the refresher, so the
  crest moves in the same statement as the KYC webhook or `finance.sync_payout_account`.

---

## 🧭 Profile setup progress (`00001010` §2 — Decision #155)

- **`org.fn_compute_profile_setup_progress(user_id uuid) → jsonb`** — `STABLE`, `SECURITY DEFINER`,
  `SET search_path = ''`; granted to `authenticated` and `service_role`, revoked from `PUBLIC` and
  `anon`. The ONE completeness rule (reversing Decision #149(A)'s TypeScript rule). A caller may read
  only their own id (`42501` otherwise); the service role (no `auth.uid()`) may read anyone's. `NULL`
  when the person has no `org.users_public` row. Answers
  `{ score int, completed_keys text[], next_suggested_action text|null }`:

  | Key              | Weight | Done when                                                                                  |
  | :--------------- | -----: | :----------------------------------------------------------------------------------------- |
  | `account`        |     20 | a first or last name, a date of birth, and an address on the `auth.users` identity         |
  | `email_verified` |     10 | an `org.user_emails` row with `verified_at`                                                |
  | `skills`         |     10 | `freelancer_profiles.skills` or `users_public.interests` non-empty                         |
  | `avatar`         |     20 | `users_public.avatar_file_id` — an UPLOADED photo; a sign-in provider's does not count     |
  | `profile_copy`   |     20 | a non-blank `headline` and `org.fn_bio_has_text(bio)`                                      |
  | `working_hours`  |     20 | a published `scheduling.schedules` row (`owner_type = 'user'`) with an active band         |

  The first three are what `/join` collects, so a finished sign-up reads **40**. The next action is
  the first that applies of: `verify_email` · a seller's `verify_identity` · `add_payout` (the
  No-Forever-Escrow earning gate) · `add_photo` · `write_profile` · `publish_hours` · `add_skills` ·
  `complete_account` · a buyer's `become_partner`; `NULL` when nothing is left.
- **`org.fn_bio_has_text(bio jsonb) → boolean`** — `IMMUTABLE`. Whether a story holds any text across
  the three stored shapes (`{ text }`, a Quill Delta `{ ops }`, `{ html }`) — the SQL twin of the
  profile service's `bioText`.

---

## 👤 The public profile (`00001040`)

**Migration:**
[`00001040_functions_org_profiles.sql`](../../../supabase/migrations/00001040_functions_org_profiles.sql)
· **Grants:** [`00002510`](../../../supabase/migrations/00002510_permissions_function_grants.sql).

`/[handle]` resolves one of four entity kinds — an individual (`org.users_public`), a team, a business
or an organisation — and paints the same page for all of them. Everything it reads and writes comes
through the definer functions below, and that is the security model, not a convenience: the entity
rows hold far more than a visitor may see (`users_public.dob`, a business's billing email, a team's
payout model) and RLS is ROW-level, so any policy that admits a visitor to a row admits them to every
column on it. These functions project only the public facts and decide visibility themselves. On the
write side, `org.users_public` and `org.freelancer_profiles` carry counters, ratings, KYC state and
capability flags beside the handful of owner-editable fields, and a row-level UPDATE policy cannot
tell `headline` from `rating_average` — so their client write policies are gone
([Policies.md](Policies.md)) and `org.save_profile` is the one door.

The owner vocabulary everywhere is `'user' · 'team' · 'business' · 'organisation'`. Every function
pins `SET search_path = ''`. Every function returns **raw facts** (a bio document, skill labels,
language codes, storage **references**); the fat service maps them onto the `ProfileView` Zod SSOT, so
labels, tiers and URLs are decided once, in TypeScript
(`packages/backend/services/profile/live-profile.ts`).

### Predicates

| Function                                   | Grant                     | Answers                                                                                                                                                                                                                                                                                                               |
| :----------------------------------------- | :------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn_profile_manages(owner_type, owner_id)` | revoked from every client | May the caller EDIT this profile? A user their own; a team or a business whoever holds the `edit_profile` workspace capability there (`org.fn_member_can` — the owner and admin presets, or a custom role or override that grants it; since 2026-09-28); an organisation its owner or an admin member; a platform admin any. Deliberately narrower than membership.                                                                                                   |
| `can_manage_profile(owner_type, owner_id)` | `authenticated`           | The same predicate as an RPC, so the fat service can refuse an unauthorised media upload **before** it spends a decode on it.                                                                                                                                                                                         |
| `fn_profile_visible(owner_type, owner_id)` | `anon` · `authenticated`  | May the caller SEE it? Whoever manages it, plus: a `public`/`unlisted` individual; an `active` team that is `public`/`unlisted`, or its active member; an `active` business or its member; an `active` organisation or its member. It is also the SELECT predicate on the profile ledgers (education, experience, languages, certifications, showcase, settings), and — through `scheduling.fn_schedule_is_public` (since 2026-09-28) — the reason a hidden profile's published schedule is not visitor-readable. |
| `fn_resolve_profile(handle)`               | revoked from every client | `@handle` → `(owner_type, owner_id)`. Leading `@`s and case are ignored. The four namespaces are separate `UNIQUE` columns, so the tie-break is fixed: a person, then a team, a business, an organisation. It ignores visibility, which is why it is internal.                                                         |

### Reads (`anon` · `authenticated`)

Every read answers **`NULL` for an unknown handle and for a profile the caller may not see alike**,
so a private profile's existence is never disclosed by a different answer. The fat service maps
`NULL` to 404 and a failed call to 503: "we could not ask" is never rendered as "nobody is here".

| Function                             | Returns                                                                                                                                                                                                                                                                                                                  |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_profile_owner(handle)`          | `{owner_type, owner_id}` — the cheap resolution the scheduling readers use to find an owner's schedule without the whole document.                                                                                                                                                                                       |
| `get_profile_view(handle)`           | The whole profile chrome in one call: identity, avatar and banner references, the showcase (slot order, alt, references), the context-bar facts, the metrics strip and earned Standing, the `verification_stamp` (a person's stored stamp; a business's or organisation's `corporate_verified` derived from its own KYB; a team `none`) and a seller's unranked `adornments` (always `[]` for a buyer, business or organisation — the service ranks and caps them), the owner's presentation switches, the seller's hire intake, and the **viewer's** relationship to the profile (owner, follows). |
| `get_profile_experience(handle)`     | Career, education and certifications (individuals only).                                                                                                                                                                                                                                                                 |
| `get_profile_reviews(handle, limit)` | The latest reviews of the profile (default 60), each with its author's card.                                                                                                                                                                                                                                              |
| `get_profile_roster(handle)`         | A team's, business's or organisation's members. A team/business member's `role` label is their `title`, else the NAME of the role row they hold (was `initcap(role)`), ordered by preset rank then join date.                                                                                                                  |
| `get_profile_portfolio(handle)`      | The "Selected work" pieces with their cover references; a piece with no picture is omitted, never drawn empty.                                                                                                                                                                                                          |
| `get_profile_past_projects(handle)`  | Up to 24 **completed** projects the profile posted or delivered on (a delivery assignment that was not declined, cancelled or never funded), only where the project is `public` **and** its `portfolio_display_rights = 'allowed'`, newest first.                                                                        |

### `org.get_party_cards(p_user_ids uuid[])` — the identity door for every other surface

`STABLE` · `SECURITY DEFINER` · granted to `authenticated` (not `anon`). Returns
`(user_id, username, first_name, last_name, is_freelancer, avatar, oauth_avatar)` for at most **500**
ids, where `avatar` is `files.fn_public_media_ref(avatar_file_id)` and `oauth_avatar` is the sign-in
provider's picture from `auth.users.raw_user_meta_data` (`avatar_url`, else `picture`; `NULL` when
neither). `oauth_avatar` is the second rung of the avatar rule (`@projective/types/user` avatar.ts),
shown only when there is no uploaded photo. It is **user-writable** metadata, so it leaves the
function raw and the caller renders it only after the provider-host allowlist (`safeOAuthAvatarUrl`)
accepts it; no other metadata key is projected. It is the one place a person's display facts
are resolved for any surface that shows OTHER people — project rosters and feeds, message senders,
contact pickers, the nav's own account button — so an avatar change reaches every one of them on its
next read instead of living in a dozen copies, and it is the one door that reads other people's
`users_public` rows without exposing `dob` and the rest.

Wrapped caller-side by `packages/backend/services/profile/party-cards.ts` (`fetchPartyCards` /
`fetchPartyRows`, chunked to the 500 cap). Every party reader in `projects/` and `messaging/` resolves
through it, and falls back to names alone if it cannot be read. PL/pgSQL rather than SQL so its body
resolves `files.fn_public_media_ref` at run time — that function is created later, in `00001160`.

### The owner write path (`authenticated`)

All three are `VOLATILE` · `SECURITY DEFINER` and check `org.fn_profile_manages` first
(`owner: you cannot edit this profile`). They raise **`22023` with a `<field>: <reason>` message**, so
the fat service pins each refusal to the input that caused it. The friendly validation is the
route's (Zod); these re-check every hard limit, because a definer function is the last thing between
a crafted request and the row.

- **`org.save_profile(owner_type, owner_id, patch jsonb) → jsonb`** — one transaction. `patch`
  carries only the sections being changed (an absent key is untouched); list sections REPLACE the
  whole list.
  - Individual: `first_name` / `last_name`, `headline` (≤ 160), `story` (≤ 4,000), location,
    `timezone` (checked against the server's zone list), `visibility` (`public` / `unlisted` /
    `private`), `languages` (≤ 12, a 2–3 letter code and a proficiency each), `skills` (≤ 15, 1–40
    characters), `experience` (≤ 30), `education` (≤ 20), `certifications` (≤ 20, https-only links;
    `verified` is preserved on an unchanged row and **cleared** when the name or issuer changes).
  - Team: `name` (≤ 80), headline, story, `visibility` (`public` / `unlisted` / `invite_only`).
  - Business: name, headline, story, city, country, timezone.
  - Organisation: trading name, city, country.
  - Every kind: `settings` (`allow_avatar_expand`, `show_location`, `show_local_time`), upserted into
    `org.profile_settings`.
- **`org.set_profile_avatar(owner_type, owner_id, file_id) → jsonb`** — points the profile photo at
  a new **avatar rendition**. It re-checks the file rather than trusting where the id came from: a
  live, public, `uploaded` row with `purpose = 'avatar'` in the `avatars` bucket, owned by this
  profile's owner (`file: not a processed profile photo for this profile`). It writes
  `users_public.avatar_file_id`, `teams.avatar_file_id`, or the business's or organisation's
  `logo_file_id`, and retires the previous rendition (a soft delete — it leaves every listing, and its
  bytes stay). Returns `{ok, file_id, previous}`.
- **`org.save_showcase(owner_type, owner_id, slots jsonb) → jsonb`** — replaces the whole six-slot
  grid (`[{position, file_id, alt}]`; an absent slot is emptied). Each file must be a live, public
  `showcase` rendition of this owner, and **slot 1 must be an image** — it is the thumbnail every card
  of the profile leads with. Renditions that drop out of the grid are retired.

> **The derived- and identity-column guards** that stop a client writing `org.teams` /
> `org.organisations` ratings, counters, plan, ownership, verification, handle or media ids directly
> are `security.fn_guard_derived_columns` / `fn_guard_immutable_columns`, bound in `00001895` — see
> [`../security/Functions.md`](../security/Functions.md). These functions pass them because a
> definer's `current_user` is its owner.

---

## 🏢 The workspace console (`00001020`)

**Migration:**
[`00001020_functions_org_entities.sql`](../../../supabase/migrations/00001020_functions_org_entities.sql)
§6–§16 · **Grants:** [`00002510`](../../../supabase/migrations/00002510_permissions_function_grants.sql)
(the workspace region at the end) · **Decision:** root `CLAUDE.md` §8 #122 (Teams & Businesses goes
live). Tables: [Tables.md § Workspace membership](Tables.md#-workspace-membership-teams--businesses).

Every function below pins `SET search_path = ''` and is `SECURITY DEFINER`: `org.business_profiles`
carries no policy at all, a member cannot read a teammate's workload, and an invitee cannot read the
entity inviting them, so neither the reads nor the writes can run as the caller. Each resolves the
caller from `auth.uid()` — never a caller-supplied id — and gates on a **workspace capability**
(`org.fn_member_can`), never on a role name: five hand-written role-name lists that disagreed with
the TypeScript is what this replaced.

**Refusal convention** (every write RPC): `RAISE … ERRCODE '22023', MESSAGE '<field>: <reason>'`
for a bad input (the fat service maps it to a 422 with `fieldErrors[field]`), `42501` not allowed,
`P0002` not found, `23505` duplicate, `55000` refused by state (money held, plan full, already
answered, role in use), `23514` an integrity CHECK. The part after `<field>: ` is the human sentence.

### §6 — The permission engine's SQL twin

The SQL twin of `@projective/types/workspace` (`capabilitiesForKind`, `PRESET_GRANTS`, `roleRank`,
`effectivePermissions`), pinned by `packages/types/workspace/workspace.contract.test.ts`, which reads
this file. **All internal** (service role only): each answers for an arbitrary user, so exposing one
would be a capability oracle.

| Function                                               | Answers                                                                                                                                                                                                         |
| :----------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn_kind_capabilities(kind)`                           | `IMMUTABLE`. The capabilities a kind renders, in enum order. A team never has `purchase` · `hire` · `contribute_funds` · `approve_spend`; a business never has `bind_seat` · `publish_listings`.            |
| `fn_preset_capabilities(preset, kind)`                 | `IMMUTABLE`. A preset's bundle, kind-filtered. `owner` = everything the kind renders; `admin` = everything but `withdraw_funds` · `archive_entity`; `lead` = invite · bind seat · projects · listings · purchase · contribute · spend · analytics; `member` = contribute · analytics. |
| `fn_preset_rank(preset)`                               | `IMMUTABLE`. owner 4 · admin 3 · lead 2 · member 1 · else 0. A custom role ranks as its `base_preset`.                                                                                                    |
| `fn_role_capabilities(kind, preset, caps)`             | `IMMUTABLE`. A role row's resolved set — the preset bundle, or the custom list kind-filtered, so a stale capability on a custom row cannot leak into a kind that does not render it.                       |
| `fn_member_capabilities(kind, entity, user)`           | A member's EFFECTIVE set: `role ∪ granted − revoked`, kind-filtered, **revocation wins**. Empty for anybody who is not an ACTIVE member.                                                                     |
| `fn_member_can(kind, entity, cap)`                     | Does the CALLER hold `cap`? The one predicate every write RPC gates on.                                                                                                                                         |
| `fn_member_seat(kind, entity, user)`                   | The active membership row as `(member_id, preset, rank)`; no row when not a member.                                                                                                                             |
| `is_team_lead(team_id)`                                | **Redefined:** "lead" is no longer a role name — it is holding `bind_seat` on the team (the owner, admin and lead presets carry it; a custom role may). Still read by `projects.apply_to_seat` and `scheduling.fn_owner_manages`. |

### §7 — Money authority is DERIVED from the workspace capabilities

`finance.vault_permissions` is what every money function enforces (`transfer_funds`,
`distribute_vault`, `decide_spend_approval`, the basket and simulator predicates). It used to be a
second, hand-maintained authority that only the seed wrote — a newly created entity's owner could not
spend and a removed member kept `withdraw`. It is now a **projection** of the workspace capabilities:

| Workspace fact      | Vault capability                    |
| :------------------ | :---------------------------------- |
| every active member | `view`                              |
| `contribute_funds`  | `add_funds`                         |
| `spend_funds`       | `spend`                             |
| `manage_finances`   | `distribute`                        |
| `withdraw_funds`    | `withdraw`                          |
| `approve_spend`     | `approve_spend` (new enum value)    |
| the entity's owner  | `manage_members` + `manage_billing` |

- **`fn_vault_capabilities_for(kind, entity, user)`** — the table above; `'{}'` for anyone who is not
  an active member (their row is KEPT, inert, never deleted).
- **`fn_sync_vault_permissions(kind, entity, user = NULL)`** — rewrites the projection for one member
  (or, with `NULL`, every member) across every wallet the entity holds; an upsert that only touches a
  row whose capabilities changed. Called by every RPC below that changes who holds what, and by the
  `finance.wallets` insert trigger (`finance.fn_sync_vault_on_wallet`), so a wallet opened in a new
  currency is governed from birth.
- **`fn_set_member_capability(kind, member, cap, want)`** — moves a member's override so their
  EFFECTIVE set does or does not hold `cap`, as the smallest honest override (a grant only when the
  role lacks it, a revocation only when the role has it). The spend-policy editor and the member
  drawer both write through it, so "can spend" is one fact with one representation.

### §8 — Membership integrity

- **`fn_member_role_sync()`** — trigger function, `BEFORE INSERT OR UPDATE` on both member tables
  (`trg_team_members_role_sync` / `trg_business_members_role_sync`, bound in `00001895`). Sets `role`
  from the held role row's `base_preset`, and enforces the single-owner invariant row-level: an
  owner-preset seat for anyone but `owner_user_id` → `23514`; the owner holding another role →
  `23514`; the owner leaving → `23514` ("transfer ownership first"). Every writer, the seed included,
  passes through it.

### §9 — Handles: one namespace across people and entities

Four columns hold a public `@handle` (`users_public.username`, `teams.slug`,
`business_profiles.slug`, `organisations.handle`), each `UNIQUE` only within itself, and
`org.fn_resolve_profile` ranks a person above a team above a business — so an entity could claim a
handle a person held and be unreachable at `/@handle` forever. Every create now asks the whole
namespace under a `pg_advisory_xact_lock` on the handle.

- **`fn_is_reserved_handle(handle)`** — `IMMUTABLE`; the SQL twin of `RESERVED_HANDLES`
  (`@projective/types/profile`), pinned by the contract test. The two lists change together, edited
  in place in `00001020_functions_org_entities.sql`; the latest entry is `inspect`, the shell-free
  file inspector's top-level segment (Decision #161(G); the reasons per entry are in `ROUTING.md`
  §Reserved-handle precedence).
- **`fn_handle_taken(handle)`** — case-insensitively taken in any of the four tables, or **held**:
  given up by a person in the last 90 days (`org.handle_changes`, Decision #156), so nobody can step
  into a renamed person's old links. Only the previous owner may take it back (`org.change_username`).
- **`fn_handle_refusal(handle)`** — why a handle cannot be claimed (3–40 chars,
  `^[a-z0-9][a-z0-9-]*[a-z0-9]$`, reserved, taken) or `NULL`.
- **`check_handle(handle) → {handle, available, reason}`** — `authenticated`. The create form's
  probe; signed-in only because an availability answer is an existence oracle (the rate limit is the
  thin route's).

### §10 — Creating a team or business (Draft-First)

- **`fn_seed_preset_roles(kind, entity)`** — inserts the preset rows (Owner · Admin · [Lead] ·
  Member). Internal.
- **`fn_refresh_membership_flags(user)`** — keeps `users_public.has_team` / `has_business` true to
  ACTIVE membership. Internal.
- **`create_workspace(kind, name, handle) → {id, kind, handle}`** — `authenticated`. The ONE create
  door. Requires a `users_public` row; name 2–80; the handle passes `fn_handle_refusal` under the
  advisory lock; the plan's `teams_owned` / `businesses_owned` entitlement (`fn_effective_limit` vs
  `fn_footprint_usage`) → `55000` when full. In one transaction: the entity row at **`draft`**, the
  preset roles, the owner's owner-preset seat, a wallet in the owner's
  `preferred_display_currency` (else `USD`) — whose insert trigger projects the owner's vault
  authority — and for a team `treasury_wallet_id` + the owner's **100% payout stake**
  (`finance.contribution_agreements`, `10000` bp). Audits `{kind}.created`. **No wallet is credited**
  (the demo opening credit is gone — `../finance/Functions.md`).

### §11 — Lifecycle: draft → active → archived (nothing is hard-deleted)

- **`set_workspace_status(kind, id, status) → {id, status}`** — `authenticated`. Publishing
  (`draft → active`) needs `manage_settings`; archiving or restoring (to or from `archived`) needs
  `archive_entity`. A published entity never goes back to `draft`. **Archive is refused (`55000`)**
  while an escrow is `held` owed to the team (`payee_type = 'team'`) or funded by the business
  (`payer_business_id`), or while a team holds a live `projects.stage_assignments` row on an
  `active`/`on_hold` project. Audits `{kind}.status_changed`.
- **`update_workspace(kind, id, patch) → {id}`** — `authenticated`, needs `edit_profile`. Patch keys
  `name` (2–80) and `headline` (≤ 160, refused as `tagline:`). Pictures move through the media
  pipeline (`org.set_profile_avatar`), status through `set_workspace_status`.

### §12 — Invitations: named people only

- **`fn_role_of_entity(kind, entity, role)`** — the role row, resolved capabilities and `archived`
  flag, scoped to the entity. Internal.
- **`fn_assert_seat(kind, entity, extra)`** — a team's seat cap is its plan's `team_seats`
  entitlement (`NULL` = unlimited; a business has none). Active members **plus pending, unexpired
  invitations** count, or an owner could over-invite and have acceptances refused. `55000` when full.
- **`invite_workspace_member(kind, entity, handle, email, role, note) → {id}`** — `authenticated`,
  needs `invite_members`. Exactly one of `handle` / `email`; the entity must not be archived; the role
  must be a live role of THIS entity, never owner-ranked ("ownership moves only by transfer"), and —
  because offering a role is granting it (`mayGrant`) — carry nothing the caller lacks. A handle must
  resolve, not be the caller, not already be a member; an email must look like one (≤ 160). Seat
  cap checked. Inserts `pending` with a fresh 48-hex token and **`expires_at = now() + 14 days`**; a
  second pending offer collides on the partial unique index → `23505` ("they already have a pending
  invitation"). Notifies a platform invitee with `{kind}.invite`. Audits `{kind}.member_invited`.
- **`fn_is_invitee(invitation)`** — is the caller the addressee: by identity, by handle, or by one of
  their **VERIFIED** `org.user_emails` (never an unverified one — registering someone else's address
  must not intercept their invitations). Internal.
- **`respond_to_workspace_invitation(invitation, accept) → {status, kind, id, handle?, member_id?}`**
  — `authenticated`, invitee only (anyone else gets `P0002`). Refuses an answered (`55000`) or expired
  (`55000`) invitation. Decline → `declined` + `responded_at`. Accept additionally refuses an archived
  entity, an account with no profile, and an archived role; re-checks the seat cap (the invitation
  already holds a counted seat, so it adds none); inserts or **reactivates** the membership at the
  offered role with cleared overrides; for a team seeds a **0 bp** contribution stake; marks the row
  `accepted`; re-projects the vault and the membership flags; notifies the inviter with
  `{kind}.member_joined`.
- **`revoke_workspace_invitation(invitation) → {id, status}`** — `authenticated`, needs
  `invite_members` on the inviting entity (else `P0002`, the same as not found). Pending only →
  `revoked` + `revoked_at` / `revoked_by`.
- **`resend_workspace_invitation(invitation) → {id, status}`** — same gate; pending only. Re-mints
  the token and **renews `expires_at` to now + 14 days** (a lapsed pending row is resendable — expiry
  is derived, not a status); re-notifies a platform invitee.

### §13 — Changing a member

- **`fn_rebalance_departed_stake(team, user)`** — internal. Zeroes a departing member's stake and
  redistributes it over the remaining UNHELD active stakes in proportion to their size (`policy.ts`
  `rebalanceSplit`; a held stake is immovable), the rounding remainder to the largest absorber; with
  nobody to absorb it, the owner does. The split still totals exactly 10000.
- **`update_workspace_member(kind, member, patch) → {id}` or `{id, status: 'left'}`** —
  `authenticated`. Patch keys: `role_id`, `granted` / `revoked` (text[]), `title`, `reports_to`
  (member id or null), `can_spend`, `spend_limit_minor`, `per_transaction_minor`, `period`, `remove`.
  - **`remove`**: the owner can never leave or be removed here (`55000`, "transfer ownership first");
    anyone may remove THEMSELVES (leave); removing someone else needs `remove_members` **and**
    `manage_roles` **and** to outrank them. The row goes `left` with `left_at`, overrides and the
    reporting edge cleared, direct reports re-rooted; a team departure calls
    `fn_rebalance_departed_stake`. Vault re-projected (the departed member's row goes inert), flags
    refreshed, `{kind}.member_removed` notified (not on self-leave).
  - Everything else changes somebody ELSE's standing: never your own row (`42501`), never the
    owner's, and only with `manage_roles` over someone you **outrank**. A new role must be a live,
    non-owner role of the entity carrying nothing you lack; a grant must apply to the kind and be
    held by you; a revocation must apply to the kind.
  - Spend envelope (business only; needs `manage_finances`): `can_spend` moves the `spend_funds`
    override through `fn_set_member_capability` (granting needs you to hold `spend_funds`);
    `spend_limit_minor` / `per_transaction_minor` / `period` (`weekly`·`monthly`·`total`, default
    monthly) upsert `finance.spending_limits` on every business wallet — `NULL` limit = no ceiling.
  - `title` ≤ 80; `reports_to` must be an active member of the entity and must not close a loop (the
    RPC walks the chain up to 64 levels).
  - Re-projects the vault; a business member is notified with `business.permission_changed`. Audits
    `{kind}.member_updated`.

### §14 — Ownership transfer (one act)

- **`transfer_workspace_ownership(kind, entity, successor_member, leave = false) → {id, owner_user_id}`**
  — `authenticated`, the current owner only. Exactly one owner (product decision 2026-09-28). The
  successor must be another ACTIVE member. Order is load-bearing: `owner_user_id` moves FIRST (so the
  row-level check sees the new owner), the outgoing owner is re-seated to the **Admin** preset (or, with
  `leave`, to Admin and `left` in the same transaction, a team stake rebalanced), and only then the
  successor takes the owner seat with cleared overrides — the one-owner partial index is not
  deferrable. Both vault projections re-synced; `{kind}.ownership_transferred` notified.

### §15 — Custom roles

- **`upsert_workspace_role(kind, entity, role, name, summary, capabilities, base_preset = 'member') → {id}`**
  — `authenticated`, needs `manage_roles`. `role = NULL` creates; otherwise updates a live custom role
  (a preset is read-only → "duplicate it to a custom role"). Name 1–48 (unique among live roles →
  `23505`), summary ≤ 160; `base_preset` is `admin` · `lead` · `member` (no `lead` on a business) and
  may not rank above the caller; the capability list is kind-filtered and may carry nothing the
  caller lacks. An update re-touches every holder (so `fn_member_role_sync` re-derives `role`) and
  re-projects the vault — a role edit flows to its holders.
- **`archive_workspace_role(kind, entity, role) → {id, archived}`** — `authenticated`, needs
  `manage_roles`. Custom roles only; refused (`55000`) while any ACTIVE member holds it or a PENDING
  invitation offers it. Sets `archived_at` (the role-delete path is gone — nothing is hard-deleted).

### §16 — Reads, as raw facts

Both are `STABLE`, `authenticated`, and return RAW facts (ids, file refs, codes, instants); the fat
`WorkspaceBackendService` maps them onto `@projective/types/workspace` once, resolving faces through
`org.get_party_cards` and media through `files.get_public_media`.

- **`fn_workspace_verification(kind, entity)`** — internal. A business's KYB (`kyb_status`); a
  team's is its **OWNER's** KYC (`freelancer_profiles.kyc_status`), product decision 2026-09-28 — the
  owner is the person accountable for the team. `unverified | pending | verified`.
- **`get_workspace_roster(kind) → {items, invitations, create_limit, create_used}`** — the caller's
  ACTIVE memberships of that kind (owned first, then by name), each with its role, owner flag,
  verification, member count, up to five face user ids (by rank, then join date), pending-invite
  count, active projects, 30-day money by currency (team: payout splits + vault retention credited;
  business: debits other than `transfer_out`), the setup facts (`logo` · `bio` · `money`) and an
  unseen-notification flag; plus the caller's own PENDING, unexpired invitations to non-archived
  entities of that kind (via `fn_is_invitee`); plus the create entitlement's limit and usage.
- **`get_workspace_detail(kind, handle_or_id) → jsonb`** — the console for one entity, addressed by
  handle (the URL) or row id (a write knows only the id). `{status: 'not_found'}` for a reference no
  entity of that kind holds; `{status: 'forbidden', id}` for one the caller is not an active member
  of (the public profile already discloses it exists; the console discloses nothing else). Otherwise
  `status: 'ok'` with identity + pictures (file ids), `entity_status`, owner, verification, the
  `viewer` (member id, role id, EFFECTIVE capabilities), the ACTIVE members (role id, derived rank,
  overrides, title, reports-to, `is_self`, **email for the caller's own row only**, workload current /
  max — falling back to `security.platform_params.global_workload_cap_default` — and availability),
  the live roles with RESOLVED capabilities and holder counts, the outgoing pending invitations
  **only when the viewer holds `invite_members`**, a team's Standing label, the projects (team: via
  its stage assignments; business: as client, excluding `draft`/`archived`), the 30 most recent
  activity events (joins and `finance.ledger_audit` money movements), and the setup facts
  (`logo` · `bio` · `invite` · `money`).
