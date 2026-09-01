# org: Functions

Only the functions touched by recent work are documented here; the remaining `org.*` routines
(`create_business`, `create_team`, `get_dashboard_*`, `set_operator_mode`, …) are still to be
backfilled. See `brain2.md`'s Database section for the migration-numbering and RLS conventions.

## `org.enable_freelancer_profile(p_payload jsonb) → jsonb`

**Migration:** `supabase/migrations/0313_freelancer_conversion.sql` · **Security:**
`SECURITY DEFINER` · **Grant:** `authenticated`.

The self-serve "Become a Partner" conversion — how a user who onboarded as a Client/Operator unlocks
a freelancer profile after the fact (persona is no longer fixed at signup; cf.
`provision_user_profile` in `0304`, which only creates a freelancer profile for
`objective = 'freelancer' | 'seller'`). Keyed off `auth.uid()`. Idempotent.

In one transaction it:

1. **Links** the freelancer record —
   `INSERT INTO org.freelancer_profiles (user_id, skills) … ON
   CONFLICT (user_id) DO NOTHING`
   (the table is keyed by `user_id`; optional starter `skills` come from `p_payload`).
2. **Flips** `org.users_public.is_freelancer = true` (the denormalised flag `getMe` + nav gates
   read).
3. **Activates** the freelancer persona — upserts `security.session_context`
   (`active_profile_type = 'freelancer'`, `active_profile_id = user_id`), leaving any active team.
4. **Audits** a genuine conversion only — `security.audit_logs` `freelancer.unlocked` (written from
   the definer context because `audit_logs` is not granted to `authenticated`; cf. `0205`/`0304`).

Returns `{ freelancer_profile_id, created, is_freelancer }`; `created` is `false` when the profile
already existed (the call is then a no-op re-activation). Raises `28000` when unauthenticated and
`42501` when the caller has not completed onboarding (no `users_public` row).

> Note: `org.freelancer_profiles` no longer carries an `hourly_rate` column — rates are not a
> platform signalling field (see `org/Tables.md`).

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

**Migration:** `supabase/migrations/0315_create_organisation_rpc.sql` · **Security:**
`SECURITY DEFINER`, `SET search_path = public, org, security` · **Grant:** `service_role` only.

Atomic organisation provisioning, called by `@projective/backend`'s `AuthBackendService`
(service-role) **after** it admin-creates the owner identity in GoTrue. In one transaction it:
inserts `org.organisations` (owner = `p_owner`; `NULLIF` collapses the client's empty-string
defaults to `NULL`, and the 0314 `industry_other` CHECK still applies), seeds the owner's
`org.organisation_members` row (`role = 'owner'`), and writes an `organisation.created` entry to
`security.audit_logs` (definer context, because that table isn't granted to `authenticated` — cf.
`provision_user_profile` in 0304). `p_payload` is the camelCase `@projective/types`
`CreateOrganisation` shape. Returns the new org id; a duplicate `handle` surfaces as a
`unique_violation` the service maps to a 422. Owner-only (buyer) by construction — organisations
carry no service/product surface.

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
