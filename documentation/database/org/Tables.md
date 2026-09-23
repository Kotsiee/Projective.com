# org Schema: Tables

The `org` schema serves as the identity and organizational backbone of Projective. It handles user
profiles (freelancer and business), team structures, skill taxonomies, and cross-profile linkages.

## 👤 Identity Tables

### `org.users_public`

Public-facing profile data mirrored from `auth.users`. This ensures that sensitive internal auth
data remains isolated while providing a searchable directory for the platform.

| Column                                   | Type    | Notes                                                                                                                                                  |
| :--------------------------------------- | :------ | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_id`                                | uuid    | PK, FK → `auth.users.id`.                                                                                                                              |
| `username`                               | text    | Unique platform handle — the `@handle` (lower-cased index `idx_users_public_username_lower`).                                                          |
| `first_name` / `last_name`               | text    | Nullable.                                                                                                                                              |
| `avatar_file_id` / `banner_file_id`      | uuid    | FK → `files.items.id`, `ON DELETE SET NULL`. The avatar is an `avatar` RENDITION, set only by `org.set_profile_avatar`; read through `files.fn_public_media_ref`. |
| `headline`                               | text    | `NOT NULL DEFAULT ''`.                                                                                                                                 |
| `bio`                                    | jsonb   | The story, as `{"text": …}`.                                                                                                                           |
| `city` / `country` / `timezone`          | text    | The location line and the live local clock; `city` nullable so "never stated" stays distinct from "cleared".                                          |
| `languages`                              | text[]  | `NOT NULL DEFAULT '{}'`.                                                                                                                               |
| `dob`                                    | date    | `NOT NULL`. Never projected to anyone but its owner.                                                                                                   |
| `visibility`                             | text    | `NOT NULL DEFAULT 'public'`, `CHECK IN ('public','unlisted','private')` (`users_public_visibility_check`) — see below.                                 |
| `interests`                              | text[]  | Discovery signal.                                                                                                                                      |
| `rating_*` · `*_project_count` · `service_count` · `product_count` | numeric/int | Platform-computed; written only by definer triggers.                                                                          |
| `is_freelancer` · `has_business` · `has_team` · `is_operator`      | boolean     | Capability flags; written only by definer RPCs.                                                                                |

**`visibility` is a closed vocabulary** because three readers branch on it: the public directory view
(`org.profiles_index` lists `public`, resolves `unlisted` by handle, omits the rest), the profile
read (`org.get_profile_view` answers `private` to its owner alone) and the owner's settings control.
Free text here let a typo silently hide a profile from everyone. The one predicate every read asks is
`org.fn_profile_visible` ([Functions.md](Functions.md#-the-public-profile-00001040)).

**There is no client write policy** — see [Policies.md](Policies.md#orgusers_public). Owner edits go
through `org.save_profile`, which names every column it touches.

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
| `hire_intake`                       | jsonb                | NOT NULL `DEFAULT '[]'`. The seller's HIRE intake — an ordered `IntakeField[]`, `CHECK` array ≤ 12 (`ck_freelancer_profiles_hire_intake_shape`). |

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
| `hire_intake`   | jsonb | NOT NULL `DEFAULT '[]'`. Same shape and CHECK as `org.freelancer_profiles.hire_intake` (`ck_teams_hire_intake_shape`). |

> **`hire_intake`** (Decision #108) is what a client answers when adding this seller to a project
> FROM THE PROFILE — the Project Assignment modal — as opposed to buying one of its listings, whose
> questions live on `marketplace.service_blueprints.intake_fields`. Same `IntakeFieldSchema`, same
> validator (`intakeRefusal`), same cap; the projection is `ProfileView.hireIntake` and the answers
> land on `projects.project_invitations.answers`. A team carries its own because a team is a seller
> too (Decision #61). The seller-side editor is a settings surface that does not exist yet — see
> [`../../flows/ServiceCreation.md`](../../flows/ServiceCreation.md).

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

Freelancer work samples — the profile's "Selected work" masonry.

| Column                   | Type    | Notes                                                                                                                               |
| :----------------------- | :------ | :---------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | uuid    | PK.                                                                                                                                 |
| `user_id`                | uuid    | FK → `org.freelancer_profiles.user_id`, `ON DELETE CASCADE`.                                                                        |
| `title` / `description`  | text    | `NOT NULL`.                                                                                                                         |
| `cover_file_id`          | uuid    | FK → `files.items.id`, `ON DELETE SET NULL`. The piece's picture as an asset reference, read with its WebP tiers.                  |
| `cover_url`              | text    | Predates the asset layer; kept for older rows. A piece with neither picture is left out of the read, never drawn as an empty tile. |
| `client_name` / `category` | text  | The two captions a tile carries besides its title; both optional (undisclosed work names no client).                              |
| `attachment_id`          | uuid    | Legacy proof-of-work link.                                                                                                          |
| `is_public`              | boolean | `NOT NULL DEFAULT true`.                                                                                                            |
| `sort_order`             | integer | `NOT NULL DEFAULT 0`. Index `idx_portfolios_user (user_id, sort_order)`.                                                           |

RLS is on with **no policy** — every read is `org.get_profile_portfolio` (definer).

---

## 🪪 Profile presentation (`/[handle]`)

The owner vocabulary on the two presentation tables is polymorphic — `'user' · 'team' · 'business' ·
'organisation'`, the `org.profile_follows` one — because an individual is ONE owner however their
profile renders. A polymorphic target cannot carry a foreign key, so **every write goes through a
definer RPC** (`org.save_showcase` / `org.save_profile`) that checks the owner exists and that the
caller manages it; none of the three tables below has a client write policy. Reads follow the
profile: a row is visible exactly when `org.fn_profile_visible(owner)` is true.

### `org.profile_showcase_items`

One row per filled showcase slot. Six slots; **slot 1 is the primary still** — the thumbnail every
explore card, search result and public listing of this profile leads with (projected as
`org.profiles_index.showcase_bucket` / `showcase_path`, below) — so it must be an image (a card
cannot lead with a video). That rule needs the file's MIME type, which a `CHECK` cannot read, so
`org.save_showcase` enforces it.

| Column                    | Type        | Notes                                                                                                   |
| :------------------------ | :---------- | :------------------------------------------------------------------------------------------------------ |
| `id`                      | uuid        | PK.                                                                                                     |
| `owner_type` / `owner_id` | text / uuid | The polymorphic owner; `CHECK` on the four owner kinds.                                                 |
| `position`                | smallint    | `CHECK (position BETWEEN 1 AND 6)`; `UNIQUE (owner_type, owner_id, position)`.                          |
| `file_id`                 | uuid        | FK → `files.items.id`, `ON DELETE CASCADE` — a **showcase rendition**, never the library original.     |
| `alt`                     | text        | `NOT NULL DEFAULT ''`, ≤ 200 chars; an empty string reads back as "{name} — work", never `alt=""`.       |
| `created_by`              | uuid        | FK → `auth.users.id` — who placed it (a team lead, say, rather than the team's owner).                  |
| `created_at` / `updated_at` | timestamptz |                                                                                                       |

Zod mirrors (`@projective/types/profile`): the read is `ProfileShowcaseItemSchema` (`profile.ts`),
the write is `ShowcaseSlotSchema` / `SaveShowcaseSchema` (`edit.ts`).

### `org.profile_settings`

The owner's presentation switches. One row per profile, created on first save; an **absent row
reads as the column defaults**, so a profile nobody has configured behaves exactly like one whose
owner accepted every default. Each column is read by exactly one surface — a switch with no reader is
not allowed here (root `CLAUDE.md` §3 gate 11).

| Column                    | Type        | Default | Read by                                                                              |
| :------------------------ | :---------- | :------ | :----------------------------------------------------------------------------------- |
| `owner_type` / `owner_id` | text / uuid | —       | PK `(owner_type, owner_id)`.                                                         |
| `allow_avatar_expand`     | boolean     | `false` | The hero: visitors may open the profile photo full size. Off by default — a larger copy of someone's face is theirs to offer. |
| `show_location`           | boolean     | `true`  | The context bar's "City, Country" line.                                              |
| `show_local_time`         | boolean     | `true`  | The live local clock beside the availability badge.                                  |

Zod mirror: `ProfileSettingsSchema` (`@projective/types/profile`).

### `org.certifications`

A professional certification on an individual's Experience section.

| Column                        | Type        | Notes                                                                                     |
| :---------------------------- | :---------- | :---------------------------------------------------------------------------------------- |
| `id`                          | uuid        | PK.                                                                                       |
| `user_id`                     | uuid        | FK → `org.users_public.user_id`, `ON DELETE CASCADE`.                                     |
| `name` / `issuer`             | text        | `NOT NULL`.                                                                               |
| `issued_year` / `expires_year`| text        | Years as text, like education/experience — a date column would invent a month and a day. |
| `credential_url`              | text        | `CHECK` https-only: it renders as a link on a public profile.                             |
| `verified` / `verified_at`    | boolean / timestamptz | A **platform** claim; `CHECK (NOT verified OR verified_at IS NOT NULL)`.        |
| `logo_file_id`                | uuid        | FK → `files.items.id`, `ON DELETE SET NULL`.                                              |
| `sort_order`                  | integer     | Index `idx_certifications_user (user_id, sort_order)`.                                    |

`verified` is the only reason the row may carry the trust crest, and it is never client-writable:
`org.save_profile` preserves it on an unchanged row and **clears it the moment the name or issuer is
edited**, because a verification describes the credential that was checked, not whatever the row
says now. Zod mirrors: `CertificationEntrySchema` (`tabs.ts`, the read) and `CertificationEditSchema`
(`edit.ts`, the write).

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

## 🔎 `org.profiles_index` — the public profile directory (view)

Migration [`00003001_views_profiles_business.sql`](../../../supabase/migrations/00003001_views_profiles_business.sql).
Every card, owner attribution and profile header a visitor sees is read from this view — the
discovery catalogue (`packages/backend/services/explore/live-catalog.ts`) reads it with the anon
client.

It is a VIEW rather than a policy set because RLS is row-level: a policy that let a visitor see a
user's row would let them see every column on it, including `users_public.dob` and a business's
billing details. The view runs as its owner and projects only public facts — the column-level
answer.

**Visibility is the view's own job.** Users appear when `visibility IN ('public','unlisted')`,
businesses when `status = 'active'`, teams when `status = 'active'` and public or unlisted; anything
else is absent. `listed` separates the two: `public` rows are ranked and shown by discovery,
`unlisted` rows resolve by handle (the profile page) but are never listed.

Columns appended on 2026-09-22 (after the original set, never reordered — `CREATE OR REPLACE VIEW`
may only add trailing columns):

| Column                              | Meaning                                                                                              |
| :---------------------------------- | :--------------------------------------------------------------------------------------------------- |
| `listed`                            | Shown by discovery (public), versus reachable by handle only (unlisted).                             |
| `city`                              | The location line's city.                                                                            |
| `avatar_bucket` / `avatar_path`     | The avatar's storage object — only for a file that is itself `public`. Never a URL: the URL is a deployment fact built by `packages/backend/core/storage-url.ts`. |
| `banner_bucket` / `banner_path`     | Same, for the banner.                                                                               |
| `verified`                          | The verified crest.                                                                                  |
| `skills`                            | `org.skills` slugs.                                                                                  |
| `workload`                          | Current workload intensity (the card's capacity meter).                                              |
| `joined_at`                         |                                                                                                      |
| `verification_tier`                 | Users: their KYC tier once verified; businesses: 3 when KYB-verified; teams: NULL.                  |
| `language_codes`                    | Upper-cased codes from `org.user_languages`, native first; `'{}'` for businesses and teams (a code is never guessed from a name). |
| `delivered_count`                   | Completed `projects.stage_assignments` for the freelancer or the team; 0 for a business.            |
| `showcase_bucket` / `showcase_path` | _(appended 2026-09-23)_ Showcase **slot 1** — the profile's primary thumbnail — as a storage object: the `org.profile_showcase_items` row at position 1, joined to a live, `public` file. The discovery card leads with it and falls back to the banner (`live-catalog.ts`); NULL when the slot is empty. |
| `standing_level` / `standing_label` | _(appended 2026-09-23)_ A SELLER's earned Standing rung (a freelancer or a team) from `org.entity_standing` joined to `org.standing_levels`. `org.entity_standing` is readable only by a signed-in caller, so this is how a guest sees the rung a listing and a card print. Same rule as `org.get_public_profile`: a seller with no computed row reads as level 1 ("New"); a buyer-only account and a business carry NULL. |

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
