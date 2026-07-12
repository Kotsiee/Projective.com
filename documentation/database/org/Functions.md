# org: Functions

Only the functions touched by recent work are documented here; the remaining `org.*` routines
(`create_business`, `create_team`, `get_dashboard_*`, `set_operator_mode`, …) are still to be
backfilled. See `brain2.md`'s Database section for the migration-numbering and RLS conventions.

## `org.enable_freelancer_profile(p_payload jsonb) → jsonb`

**Migration:** `supabase/migrations/0313_freelancer_conversion.sql` · **Security:** `SECURITY DEFINER`
· **Grant:** `authenticated`.

The self-serve "Become a Partner" conversion — how a user who onboarded as a Client/Operator unlocks
a freelancer profile after the fact (persona is no longer fixed at signup; cf.
`provision_user_profile` in `0304`, which only creates a freelancer profile for
`objective = 'freelancer' | 'seller'`). Keyed off `auth.uid()`. Idempotent.

In one transaction it:

1. **Links** the freelancer record — `INSERT INTO org.freelancer_profiles (user_id, skills) … ON
   CONFLICT (user_id) DO NOTHING` (the table is keyed by `user_id`; optional starter `skills` come
   from `p_payload`).
2. **Flips** `org.users_public.is_freelancer = true` (the denormalised flag `getMe` + nav gates read).
3. **Activates** the freelancer persona — upserts `security.session_context`
   (`active_profile_type = 'freelancer'`, `active_profile_id = user_id`), leaving any active team.
4. **Audits** a genuine conversion only — `security.audit_logs` `freelancer.unlocked` (written from
   the definer context because `audit_logs` is not granted to `authenticated`; cf. `0205`/`0304`).

Returns `{ freelancer_profile_id, created, is_freelancer }`; `created` is `false` when the profile
already existed (the call is then a no-op re-activation). Raises `28000` when unauthenticated and
`42501` when the caller has not completed onboarding (no `users_public` row).

> Note: `org.freelancer_profiles` no longer carries an `hourly_rate` column — rates are not a
> platform signalling field (see `org/Tables.md`).
