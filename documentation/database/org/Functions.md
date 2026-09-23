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
| `fn_profile_manages(owner_type, owner_id)` | revoked from every client | May the caller EDIT this profile? A user their own; a team its owner or a team lead; a business its owner; an organisation its owner or an admin member; a platform admin any. Deliberately narrower than membership.                                                                                                   |
| `can_manage_profile(owner_type, owner_id)` | `authenticated`           | The same predicate as an RPC, so the fat service can refuse an unauthorised media upload **before** it spends a decode on it.                                                                                                                                                                                         |
| `fn_profile_visible(owner_type, owner_id)` | `anon` · `authenticated`  | May the caller SEE it? Whoever manages it, plus: a `public`/`unlisted` individual; an `active` team that is `public`/`unlisted`, or its active member; an `active` business or its member; an `active` organisation or its member. It is also the SELECT predicate on the profile ledgers (education, experience, languages, certifications, showcase, settings). |
| `fn_resolve_profile(handle)`               | revoked from every client | `@handle` → `(owner_type, owner_id)`. Leading `@`s and case are ignored. The four namespaces are separate `UNIQUE` columns, so the tie-break is fixed: a person, then a team, a business, an organisation. It ignores visibility, which is why it is internal.                                                         |

### Reads (`anon` · `authenticated`)

Every read answers **`NULL` for an unknown handle and for a profile the caller may not see alike**,
so a private profile's existence is never disclosed by a different answer. The fat service maps
`NULL` to 404 and a failed call to 503: "we could not ask" is never rendered as "nobody is here".

| Function                             | Returns                                                                                                                                                                                                                                                                                                                  |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_profile_owner(handle)`          | `{owner_type, owner_id}` — the cheap resolution the scheduling readers use to find an owner's schedule without the whole document.                                                                                                                                                                                       |
| `get_profile_view(handle)`           | The whole profile chrome in one call: identity, avatar and banner references, the showcase (slot order, alt, references), the context-bar facts, the metrics strip and earned Standing, the owner's presentation switches, the seller's hire intake, and the **viewer's** relationship to the profile (owner, follows). |
| `get_profile_experience(handle)`     | Career, education and certifications (individuals only).                                                                                                                                                                                                                                                                 |
| `get_profile_reviews(handle, limit)` | The latest reviews of the profile (default 60), each with its author's card.                                                                                                                                                                                                                                              |
| `get_profile_roster(handle)`         | A team's, business's or organisation's members.                                                                                                                                                                                                                                                                          |
| `get_profile_portfolio(handle)`      | The "Selected work" pieces with their cover references; a piece with no picture is omitted, never drawn empty.                                                                                                                                                                                                          |
| `get_profile_past_projects(handle)`  | Up to 24 **completed** projects the profile posted or delivered on (a delivery assignment that was not declined, cancelled or never funded), only where the project is `public` **and** its `portfolio_display_rights = 'allowed'`, newest first.                                                                        |

### `org.get_party_cards(p_user_ids uuid[])` — the identity door for every other surface

`STABLE` · `SECURITY DEFINER` · granted to `authenticated` (not `anon`). Returns
`(user_id, username, first_name, last_name, is_freelancer, avatar)` for at most **500** ids, where
`avatar` is `files.fn_public_media_ref(avatar_file_id)`. It is the one place a person's display facts
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
