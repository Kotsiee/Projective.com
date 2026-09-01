# org Schema: Tables

The `org` schema serves as the identity and organizational backbone of Projective. It handles user
profiles (freelancer and business), team structures, skill taxonomies, and cross-profile linkages.

## 👤 Identity Tables

### `org.users_public`

Public-facing profile data mirrored from `auth.users`. This ensures that sensitive internal auth
data remains isolated while providing a searchable directory for the platform.

| Column        | Type | Notes                                      |
| :------------ | :--- | :----------------------------------------- |
| `user_id`     | uuid | PK, FK → `auth.users.id`.                  |
| `username`    | text | Unique platform handle.                    |
| `first_name`  | text | User's legal/given name.                   |
| `last_name`   | text | User's family name.                        |
| `avatar_url`  | text | Reference to storage object.               |
| `headline`    | text | Short professional tagline.                |
| `description` | text | Long-form professional summary.            |
| `visibility`  | text | Defaults to `unlisted`.                    |
| `dob`         | date | Date of birth for verification/compliance. |

### `org.freelancer_profiles`

The "Seller" persona. A user has exactly one freelancer profile.

| Column                              | Type                 | Notes                                                                                                                                |
| :---------------------------------- | :------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| `user_id`                           | uuid                 | PK, FK → `auth.users.id`.                                                                                                            |
| `skills`                            | text[]               | Fast-lookup array of skill tags.                                                                                                     |
| `is_freelancer` (on `users_public`) | boolean              | Denormalised persona flag; flipped to `true` by `org.enable_freelancer_profile` when a client unlocks a freelancer profile.          |
| `kyc_status`                        | `finance.kyc_status` | **Additive (`20260723091000`).** `unverified` (default) / `pending` / `verified` / `rejected` / `expired`. The earner's KYC cache.   |
| `kyc_tier`                          | smallint             | **Additive.** Verification ladder tier (1 Basic / 2 Verified / 3 Business).                                                          |
| `kyc_verified_at`                   | timestamptz          | **Additive.** When KYC was granted.                                                                                                  |
| `payout_ready`                      | boolean              | **Additive.** The onboarding gate — `true` only when KYC-verified AND a payout method exists (`finance.fn_freelancer_payout_ready`). |
| `identity_provider_ref`             | text                 | **Additive.** Stripe Identity session id (placeholder; **no PII**).                                                                  |

> ⚠️ `kyc_*` is **identity/KYC** verification — distinct from **email** verification
> (`org.user_emails.verified_at`, migration 0312). Gating rule in `finance-model.md` §KYC/KYB
> Gating: freelancers are gated at onboarding; individual clients need **no** ID verification
> (tap-and-pay).

### `org.business_profiles`

The "Buyer" persona. Users can manage multiple business profiles (e.g., for different brands or
projects).

| Column             | Type                 | Notes                                                                                                                     |
| :----------------- | :------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| `id`               | uuid                 | PK.                                                                                                                       |
| `owner_user_id`    | uuid                 | FK → `auth.users.id`.                                                                                                     |
| `name`             | text                 | Business display name.                                                                                                    |
| `plan`             | text                 | Subscription tier (default: `free`).                                                                                      |
| `billing_email`    | text                 | Primary contact for invoices.                                                                                             |
| `default_currency` | text                 | Origin currency for the pooled fund (default `USD`).                                                                      |
| `kyb_status`       | `finance.kyc_status` | **Additive (`20260723091000`).** `unverified` (default) → `verified`. **Required to OPERATE the pooled Business Wallet.** |
| `kyb_verified_at`  | timestamptz          | **Additive.** When KYB was granted.                                                                                       |
| `kyb_provider_ref` | text                 | **Additive.** Stripe Connect account id (placeholder; **no PII**).                                                        |

> KYB verification for **businesses** is the new `kyb_*` cache here; **organisations** keep their
> own `org.organisation_verification_level` (migration 0314). Reconciles with the tiered KYC/KYB
> model (Decisions #6/#7). Predicate: `finance.fn_business_kyb_verified(business_id)`.

---

## 🧑‍🤝‍🧑 Organization & Teams

### `org.teams`

Micro-agencies or collaborative units.

| Column          | Type | Notes                                       |
| :-------------- | :--- | :------------------------------------------ |
| `id`            | uuid | PK.                                         |
| `owner_user_id` | uuid | FK → `auth.users.id` (Ultimate controller). |
| `slug`          | text | UNIQUE, used for team URLs.                 |
| `payout_model`  | text | Internal distribution logic.                |

### `org.team_members`

Join table mapping users to teams with specific roles.

| Column    | Type | Notes                              |
| :-------- | :--- | :--------------------------------- |
| `id`      | uuid | PK.                                |
| `team_id` | uuid | FK → `org.teams.id`.               |
| `user_id` | uuid | FK → `auth.users.id`.              |
| `role`    | text | e.g., `owner`, `admin`, `member`.  |
| `status`  | text | e.g., `active`, `invited`, `left`. |

---

## 🛠 Skills & Assets

### `org.skills`

The canonical taxonomy of platform skills.

```sql
CREATE TABLE org.skills (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    slug text NOT NULL UNIQUE,
    label text NOT NULL,
    CONSTRAINT skills_pkey PRIMARY KEY (id)
);
```

### `org.attachments`

Centralized metadata for files associated with profiles or portfolios.

| Column             | Type | Notes                                        |
| :----------------- | :--- | :------------------------------------------- |
| `owner_profile_id` | uuid | Link to creator profile.                     |
| `bucket`           | text | Target storage bucket (e.g., `attachments`). |
| `status`           | text | `draft`, `uploaded`, `quarantined`, `clean`. |

---

## 🔗 Portfolios & Links

### `org.portfolios`

Freelancer work samples.

| Column                  | Type | Notes                                        |
| :---------------------- | :--- | :------------------------------------------- |
| `freelancer_profile_id` | uuid | FK → `org.freelancer_profiles.id`.           |
| `attachment_id`         | uuid | FK → `org.attachments.id` for proof of work. |

### `org.profile_links`

Social and portfolio links for both profile types.

```sql
CREATE TABLE org.profile_links (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    profile_type text NOT NULL, -- 'freelancer' or 'business'
    profile_id uuid NOT NULL,
    kind text NOT NULL, -- 'github', 'linkedin', etc.
    url text NOT NULL,
    is_public boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT profile_links_pkey PRIMARY KEY (id)
);
```

---

## ⚙️ Preferences

### `org.user_preferences`

Per-user preferences (one row per user, seeded by the `org.seed_user_preferences` trigger — Decision
#47 — which inserts only the PK and relies on column DEFAULTs). Zod SSOT in
`packages/types/org/preferences.ts`.

| Column                       | Type                   | Notes                                                                                                                                                                                                                                                                                                          |
| :--------------------------- | :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_id`                    | uuid                   | PK, FK → `auth.users.id` (CASCADE).                                                                                                                                                                                                                                                                            |
| `theme`                      | text                   | `system` (default) / `light` / `dark`.                                                                                                                                                                                                                                                                         |
| `notification_email`         | boolean                | Default `true`.                                                                                                                                                                                                                                                                                                |
| `notification_push`          | boolean                | Default `false`.                                                                                                                                                                                                                                                                                               |
| `locale`                     | text                   | BCP-47 locale (language + region), default `en-GB`. **This is the language source.**                                                                                                                                                                                                                           |
| `preferred_display_currency` | char(3)                | **Additive (`20260723090000`).** Presentational display-conversion target (ISO-4217), `DEFAULT 'GBP'`, `CHECK ~ '^[A-Z]{3}$'`; `NULL` = follow origin (an explicitly cleared preference, distinct from the default). Never affects stored/settled amounts. Stamped into the JWT by `custom_access_token_hook`. |
| `layout_direction`           | `org.layout_direction` | **Additive.** `auto` (default) / `ltr` / `rtl`. Chosen INDEPENDENT of language; `auto` → the locale's natural direction. See `DESIGN_SYSTEM.md` §A.6.                                                                                                                                                          |
| `ui_settings`                | jsonb                  | Misc client UI state.                                                                                                                                                                                                                                                                                          |

> **Reconciliation (flagged, root `CLAUDE.md` §8):** `locale` already carries the BCP-47 locale, so
> **no** separate `preferred_locale`/`language` column was added (avoids duplication);
> `layout_direction` is deliberately independent of it. RLS (migration 0213: view/update/insert own)
> is table-level and already covers the new columns. The seed trigger picks up the new DEFAULTs
> automatically — no trigger change was required.

---

## 🏢 Organisations (client/buyer-only)

Added in `supabase/migrations/0314_organisations.sql`; Zod SSOT in
`packages/types/org/organisations.ts`. An **Organisation** is a corporate **client/buyer** entity —
it registers only to hire/buy and **cannot offer services**. It is deliberately **distinct** from
`org.business_profiles` (the seller-side entity above): different table, different purpose, no
service/product surface. Multi-tenancy is a membership join table, **not** a `users.organisation_id`
column, because a user can belong to several organisations.

### `org.organisations`

| Column                | Type                                  | Notes                                                                                 |
| :-------------------- | :------------------------------------ | :------------------------------------------------------------------------------------ |
| `id`                  | uuid                                  | PK.                                                                                   |
| `owner_user_id`       | uuid                                  | FK → `auth.users.id`. The creator/ultimate controller.                                |
| `legal_name`          | text                                  | Registered legal company name (required).                                             |
| `trading_name`        | text                                  | Brand / trading name, if different.                                                   |
| `handle`              | text                                  | UNIQUE `@handle` for the org namespace.                                               |
| `registration_number` | text                                  | CRN / EIN / VAT / Tax ID.                                                             |
| `corporate_email`     | text                                  | Primary corporate contact (required).                                                 |
| `corporate_phone`     | text                                  | Corporate phone.                                                                      |
| `website`             | text                                  | Corporate website / domain.                                                           |
| `address_line_1`      | text                                  | Registered address.                                                                   |
| `address_city`        | text                                  | —                                                                                     |
| `address_postcode`    | text                                  | —                                                                                     |
| `address_country`     | text                                  | —                                                                                     |
| `employee_scale`      | `org.employee_scale`                  | Headcount tier: `1-50` / `51-200` / `201-500` / `500+`.                               |
| `primary_industry`    | text                                  | Industry slug from the onboarding set.                                                |
| `industry_other`      | text                                  | Free-text sector; **required by CHECK** when `primary_industry = 'other'`.            |
| `departments`         | text[]                                | Initial departments (presets + custom-typed).                                         |
| `purpose`             | text[]                                | Optional stated goals.                                                                |
| `status`              | `org.organisation_status`             | `draft` (default) / `active` / `suspended` / `archived`. Nothing is hard-deleted.     |
| `verification_level`  | `org.organisation_verification_level` | `unverified` (default) → `email_verified` → `kyb_pending` → `verified`. KYB deferred. |
| `logo_file_id`        | uuid                                  | FK → `files.items.id` (ON DELETE SET NULL).                                           |
| `billing_email`       | text                                  | Invoicing contact.                                                                    |
| `default_currency`    | text                                  | Default `USD`.                                                                        |

### `org.organisation_members`

Join table mapping users to organisations with a role — the multi-tenant link.

| Column            | Type                    | Notes                                                           |
| :---------------- | :---------------------- | :-------------------------------------------------------------- |
| `id`              | uuid                    | PK.                                                             |
| `organisation_id` | uuid                    | FK → `org.organisations.id` (ON DELETE CASCADE).                |
| `user_id`         | uuid                    | FK → `auth.users.id` (ON DELETE CASCADE).                       |
| `role`            | `org.organisation_role` | `owner` / `admin` / `member`.                                   |
| `status`          | text                    | Default `active`.                                               |
| `invited_by`      | uuid                    | FK → `auth.users.id` (ON DELETE SET NULL).                      |
| UNIQUE            | —                       | `(organisation_id, user_id)` — one membership per user per org. |

---

## 🏅 Standing, Mastery & Progression (the EARNED ladder)

Added in `supabase/migrations/20260724111000_standing_reputation.sql`; Zod SSOT in
`packages/types/org/standing.ts`.

**Standing is the discretised rung of the continuous Reliability Index ($R_i$)** already specified
in `PRODUCT_SPEC.md` §Reputation & Discovery. It does **not** fork or replace $R_i$ —
`entity_standing.score` _is_ the composite, and `level` is the ladder derived from it. The existing
caches (`org.users_public.rating_average`, `org.freelancer_profiles.rating_*`, `finance.ratings`,
`security.penalties`) are untouched and are the **inputs** this layer reads.

> ⚠️ **Standing can never be purchased.** No subscription plan, entitlement grant or payment writes
> to any table below — every mutating function is `SECURITY DEFINER` and revoked from `public`. The
> paid ladder (`finance.plans`) accelerates _capacity_; only delivery moves a rung. Keeping the two
> ladders strictly separate is what makes the rung a trustworthy signal to a client.

### `org.standing_levels`

The tunable ladder. Money perks live in `finance.standing_commission_tiers`; this table holds only
the non-money rungs.

| Column                 | Type         | L1    | L2          | L3      | L4     | L5    |
| :--------------------- | :----------- | :---- | :---------- | :------ | :----- | :---- |
| `level` (PK)           | smallint     | 1     | 2           | 3       | 4      | 5     |
| `code` / `label`       | text         | New   | Established | Trusted | Expert | Elite |
| `min_score`            | numeric(5,2) | 0     | 55          | 70      | 82     | 92    |
| `min_completed_stages` | integer      | 0     | 5           | 20      | 50     | 120   |
| `listing_base`         | integer      | 10    | 15          | 20      | 30     | 50    |
| `proposal_bonus`       | integer      | 0     | +10         | +20     | +30    | +40   |
| `discovery_weight_bp`  | integer      | 10000 | 10500       | 11000   | 11500  | 12000 |

`min_completed_stages` is a **volume floor** — a flawless single engagement must not vault a subject
to the top of the ladder.

### `org.entity_standing`

One row per earning subject (`subject_type` ∈ `user` | `freelancer` | `team`; UNIQUE on
`(subject_type, subject_id)`). Buyers are deliberately **not** ranked here — they carry the separate
Client Trust Score.

| Column                                  | Type         | Notes                                                               |
| :-------------------------------------- | :----------- | :------------------------------------------------------------------ |
| `level`                                 | smallint     | FK → `org.standing_levels.level`. Default `1`.                      |
| `score`                                 | numeric(5,2) | 0–100 composite.                                                    |
| `stages_completed`                      | integer      | Volume, for the floor above.                                        |
| `completion_rate` / `on_time_rate`      | numeric(5,4) | 0–1 rates.                                                          |
| `client_rating_avg` / `peer_rating_avg` | numeric(3,2) | The **dual-track** reviews (§Reciprocal Reviews).                   |
| `dispute_rate`                          | numeric(5,4) | 0–1.                                                                |
| `workload_reliability`                  | numeric(5,4) | Delivering at capacity without dropping tickets — the $W_i$ signal. |
| `tenure_days`                           | integer      | —                                                                   |
| `penalty_severity`                      | numeric(6,2) | Active `security.penalties` aggregate, subtracted at recompute.     |
| `components`                            | jsonb        | Per-component contribution, for the "why am I this rung" surface.   |
| `level_changed_at` / `computed_at`      | timestamptz  | —                                                                   |

> **Every input is client-valued.** Raw earnings and raw proposal counts are deliberately absent:
> ranking by spend or by volume is exactly the pay-to-win trap this ladder exists to avoid.

### `org.standing_events`

Append-only progression audit (`recomputed` / `promoted` / `demoted` / `penalty_applied` /
`manual_review`) with `from_level`, `to_level`, `score`, `components`. Private to the subject — it
carries the score internals; the level itself is public via `entity_standing`.

### `org.create_mastery`

Specialisation **derived** from delivered work, never self-declared. UNIQUE on
`(subject_type, subject_id, category)` over `org.create_category` (`create` · `run` · `educate` ·
`advise` · `test` · `empower` — `PRODUCT_SPEC.md` §The CREATE Framework).

| Column                | Type          | Notes                                                                      |
| :-------------------- | :------------ | :------------------------------------------------------------------------- |
| `stages_completed`    | integer       | —                                                                          |
| `intensity_delivered` | numeric(10,2) | $W_i$-weighted, so a hard Create stage counts for more than a trivial one. |
| `on_time_rate`        | numeric(5,4)  | Running average.                                                           |
| `share_bp`            | integer       | This category's share of delivered intensity (0–10000).                    |
| `mastery_level`       | smallint      | 0–5.                                                                       |

`share_bp` is a real **matching** signal: it routes Create-heavy stages to proven Create
specialists. No other marketplace can compute this, because none have the stage taxonomy.

### `org.achievements` + `org.entity_achievements`

Catalogue + awards. `tier` ∈ `milestone` | `bronze` | `silver` | `gold` | `designation`, where
`designation` carries **real capability** — the `architect` row is the "Architect" designation of
`PRODUCT_SPEC.md` §Reliability Index (unlocks leading Team-based stages and authoring Marketplace
stage templates). Awards are idempotent (UNIQUE on `(subject_type, subject_id, achievement_code)`).
Seeded: `first_payout`, `first_five_star`, `repeat_client`, `squad_ten_stages`, `dispute_free_year`,
`architect`.

### `org.quality_streaks`

Consecutive good outcomes over `org.streak_kind` (`on_time_delivery` · `fast_response` ·
`dispute_free` · `client_repeat`) with `current_count` / `best_count` / `last_event_at` /
`broken_at`.

> **There is deliberately no login/attendance streak kind.** A streak must celebrate good work,
> never mere presence — the guilt mechanic is hostile to freelancer wellbeing and attracts exactly
> the behaviour this platform is trying to avoid.

### 🏷 Enums

```sql
CREATE TYPE org.standing_subject  AS ENUM ('user', 'freelancer', 'team');
CREATE TYPE org.create_category   AS ENUM ('create', 'run', 'educate', 'advise', 'test', 'empower');
CREATE TYPE org.streak_kind       AS ENUM ('on_time_delivery', 'fast_response', 'dispute_free', 'client_repeat');
CREATE TYPE org.achievement_tier  AS ENUM ('milestone', 'bronze', 'silver', 'gold', 'designation');
```

---

## 🚩 Refactor Notes & Suggestions

- **DRY Violations**: `headline`, `description`, `languages`, and `timezone` are currently
  duplicated across `users_public`, `freelancer_profiles`, and `business_profiles`.
  - _Suggestion_: Move shared attributes to `users_public` and only keep persona-specific data in
    the profiles.
- **Team Roles**: The `org.team_roles` table uses `jsonb` for permissions. Ensure the Deno backend
  has a strict TypeScript interface to validate these structures during team operations.
- **Email Management**: `org.user_emails` allows for secondary emails but the auth linkage remains
  strictly on the primary `auth.users` record.
  - `verified_at` is the app-owned mirror of GoTrue's `auth.users.email_confirmed_at`. Because the
    email/password profile is provisioned at signup (before confirmation), the
    `on_auth_user_confirmed` trigger (`public.handle_email_confirmed`,
    `migrations/0312_email_verification_sync.sql`) advances `verified_at` on the NULL→timestamp
    transition so it stays trustworthy. GoTrue still owns the single-use confirmation token; no
    second token is stored here. The `/verify` page polls this via
    `api/v1/auth/verification-status`.
