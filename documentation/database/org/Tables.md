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

| Column                              | Type    | Notes                                                                                                                       |
| :---------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------- |
| `user_id`                           | uuid    | PK, FK → `auth.users.id`.                                                                                                   |
| `skills`                            | text[]  | Fast-lookup array of skill tags.                                                                                            |
| `is_freelancer` (on `users_public`) | boolean | Denormalised persona flag; flipped to `true` by `org.enable_freelancer_profile` when a client unlocks a freelancer profile. |

### `org.business_profiles`

The "Buyer" persona. Users can manage multiple business profiles (e.g., for different brands or
projects).

| Column          | Type | Notes                                |
| :-------------- | :--- | :----------------------------------- |
| `id`            | uuid | PK.                                  |
| `owner_user_id` | uuid | FK → `auth.users.id`.                |
| `name`          | text | Business display name.               |
| `plan`          | text | Subscription tier (default: `free`). |
| `billing_email` | text | Primary contact for invoices.        |

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
