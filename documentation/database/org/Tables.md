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

**`headline` and `bio` never carry contact or payment details (Decision #147).** Public profile copy
is permanently outside the Projective Unlock (`PRODUCT_SPEC.md` §Messaging 1.B): no email address,
phone number, messaging link (`t.me`, `wa.me`, …), off-platform payment link or `$cashtag`, bank or
card detail, or handle offered as a route off-platform — whatever the state of any project the user
is on (`projects.projects.handover_unlocked_at` is never consulted). The check runs at create/update
time in the write door (`org.save_profile` / the profile fat service), reusing the Tier 1 detector,
and **refuses** the save naming the field rather than masking it. There is no CHECK constraint or
trigger on these columns. **Not yet enforced** — today both columns accept any text.
`org.profile_links` (below) is a separate structured surface whose status under this rule is open
(Decision #147 flag (a)).

### `org.freelancer_profiles`

The "Seller" persona. A user has exactly one freelancer profile.

| Column                              | Type                 | Notes                                                                                                                                |
| :---------------------------------- | :------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| `user_id`                           | uuid                 | PK, FK → `auth.users.id`.                                                                                                            |
| `skills`                            | text[]               | Fast-lookup array of skill tags.                                                                                                     |
| `is_freelancer` (on `users_public`) | boolean              | Denormalised persona flag; flipped to `true` by `org.enable_freelancer_profile` when a client unlocks a freelancer profile.          |
| `kyc_status`                        | `finance.kyc_status` | **Additive (`20260723091000`).** `unverified` (default) / `pending` / `verified` / `rejected` / `expired`. The earner's KYC cache — written only by `finance.apply_identity_event` from the signed Stripe Identity webhook (Decision #125); a `verified` value never regresses on a late event. |
| `kyc_tier`                          | smallint             | **Additive.** Verification ladder tier (1 Basic / 2 Verified / 3 Business). `CHECK (kyc_tier IS NULL OR kyc_tier BETWEEN 1 AND 3)` — the same ladder `finance.verification_cases.tier` holds. A verified Identity session raises it to at least 2. |
| `kyc_verified_at`                   | timestamptz          | **Additive.** When KYC was granted.                                                                                                  |
| `payout_ready`                      | boolean              | **Additive.** Cache of "this person has a VERIFIED Stripe payout account" — recomputed by `finance.sync_payout_account` from what Stripe reports, never by a client. The onboarding GATE is `finance.fn_freelancer_payout_ready`, which requires this flag AND `kyc_status = 'verified'`. |
| `identity_provider_ref`             | text                 | **Additive.** The latest Stripe Identity session id (`vs_…`; **no PII**), mirrored by `finance.attach_identity_session` until the person is verified. |
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
| `slug`             | text                 | The business's `@handle` — one namespace with people, teams and organisations (see `org.fn_handle_refusal`, [Functions.md](Functions.md#-the-workspace-console-00001020)). The console is addressed by it (`/businesses/[businessHandle]`). |
| `status`           | text                 | `CHECK IN ('draft','active','archived')` (`business_profiles_status_check`). Created `draft` by `org.create_workspace`; moved only by `org.set_workspace_status`. |

> A business is created by **`org.create_workspace`** (Decision #122) — never a client INSERT, and
> the retired `org.create_business` no longer exists. Its members, roles and invitations are the
> tables in [§ Workspace membership](#-workspace-membership-teams--businesses) below.

> KYB verification for **businesses** is the new `kyb_*` cache here; **organisations** keep their
> own `org.organisation_verification_level` (migration 0314). Reconciles with the tiered KYC/KYB
> model (Decisions #6/#7). Predicate: `finance.fn_business_kyb_verified(business_id)`.

### `org.user_emails`

A person's email addresses — the GoTrue sign-in address (filed at signup) plus up to four secondary
ones. Zod SSOT: `packages/types/org/user-emails.ts`.

| Column        | Type        | Notes                                                                                                                                                                         |
| :------------ | :---------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | uuid        | PK.                                                                                                                                                                           |
| `user_id`     | uuid        | FK → `auth.users.id` and → `org.users_public.user_id` (so an account that has not finished onboarding has no addresses here).                                                |
| `email`       | text        | Stored as given by GoTrue for the sign-in row; trimmed and lower-cased by `org.add_user_email` for the rest. Unique per person case-insensitively (`uq_user_emails_user_email`). |
| `is_primary`  | boolean     | The contact address the platform writes to — NOT "can sign in with". At most one per person (`uq_user_emails_one_primary`, partial, not deferrable).                        |
| `verified_at` | timestamptz | `NULL` while unverified. **Load-bearing** — see below.                                                                                                                        |
| `created_at`  | timestamptz | `NOT NULL DEFAULT now()`.                                                                                                                                                     |

**`verified_at` unlocks invitations, so the table is read-only to a client** (2026-10-06). A verified
address admits its holder to the invitations sent to it: the `projects.project_invitations` SELECT
policy, `org.fn_is_invitee` and `projects.invite_by_email` all trust it. Until 2026-10-06 the table
carried own-row INSERT/UPDATE/DELETE policies (the UPDATE without a `WITH CHECK`) under a blanket
`GRANT ALL`, so any signed-in user could file somebody else's address already verified — or stamp
`verified_at` onto a row they had — and read and accept that person's invitations. Now:

- **One SELECT policy** (own rows, or a platform admin) and no write policy
  ([Policies.md](Policies.md#orguser_emails)); `INSERT`/`UPDATE`/`DELETE` are revoked from `anon` and
  `authenticated` (`00002520`).
- **Every writer is a definer:** `public.provision_user_profile` files the sign-in address as primary
  at signup; `public.handle_email_confirmed` mirrors GoTrue's `email_confirmed_at` into it; a secondary
  address is filed UNVERIFIED by `org.add_user_email` and stamped verified only by
  `org.confirm_user_email` redeeming a token mailed to it ([Functions.md](Functions.md#-email-addresses-00001050)).
- **`org.trg_user_emails_guard`** (`BEFORE INSERT OR UPDATE`, trigger `user_emails_guard`, `00001815`)
  refuses a client role's insert that arrives verified or primary and a client update to `verified_at`,
  `email`, `is_primary` or `user_id` — defence in depth should a grant or policy ever come back.
- `idx_user_emails_verified_email` (`lower(email) WHERE verified_at IS NOT NULL`) serves "who holds
  this address verified" — `projects.invite_by_email` and the `email_in_use` check.

### `org.email_verification_tokens`

Single-use proof that a person holds the inbox of one of their `org.user_emails` rows. **Definer-only:**
RLS is on with **no policy** and no client grant (`REVOKE ALL … FROM anon, authenticated`), so no client
role reads or writes a row. **The raw token is never stored.**

| Column        | Type        | Notes                                                                                                                                  |
| :------------ | :---------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | uuid        | PK.                                                                                                                                    |
| `email_id`    | uuid        | FK → `org.user_emails.id` `ON DELETE CASCADE` (removing an address takes its tokens). Indexed (`idx_email_verification_tokens_email`). |
| `user_id`     | uuid        | FK → `auth.users.id` `ON DELETE CASCADE`. The account the token redeems for (the row's owner at issue time).                          |
| `token_hash`  | text        | `UNIQUE`, `CHECK ~ '^[0-9a-f]{64}$'` — the SHA-256 (hex) of the raw token. The lookup key.                                              |
| `expires_at`  | timestamptz | `now() + 24 hours` at issue (`EMAIL_TOKEN_TTL_HOURS`); a reissue sets every earlier outstanding token's to `now()`.                     |
| `consumed_at` | timestamptz | Set when redeemed — for every outstanding token of the address at once. A row is consumed, never deleted.                              |
| `created_at`  | timestamptz | `NOT NULL DEFAULT now()`.                                                                                                              |

`security.issue_email_verification` (service role only) mints 32 random bytes as hex, stores only the
hash and returns the raw value once, for the mailer; `org.confirm_user_email` hashes what the link
carries and looks that up ([security/Functions.md](../security/Functions.md)).

---

## 🧑‍🤝‍🧑 Organization & Teams

### `org.teams`

Micro-agencies or collaborative units.

| Column               | Type  | Notes                                                                                                                                       |
| :------------------- | :---- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                 | uuid  | PK.                                                                                                                                         |
| `owner_user_id`      | uuid  | FK → `auth.users.id`. The ONE owner; moves only by `org.transfer_workspace_ownership`, and always holds the owner-preset seat (see below). |
| `name`               | text  | 2–80 characters (`org.create_workspace` / `org.update_workspace`).                                                                          |
| `slug`               | text  | UNIQUE — the team's `@handle`, in the one handle namespace; the console is addressed by it (`/teams/[teamHandle]`).                        |
| `status`             | text  | `CHECK IN ('draft','active','archived')`, default `draft`. Moved only by `org.set_workspace_status`.                                         |
| `subscription_tier`  | text  | The team's plan tier. **Guarded** (`trg_teams_immutable`) — a plan is bought, never PATCHed.                                                |
| `treasury_wallet_id` | uuid  | The team's wallet, set by `org.create_workspace` (and by the seed). Guarded.                                                                |
| `payout_model`       | text  | Internal distribution logic.                                                                                                                |
| `hire_intake`        | jsonb | NOT NULL `DEFAULT '[]'`. Same shape and CHECK as `org.freelancer_profiles.hire_intake` (`ck_teams_hire_intake_shape`).                     |

> **No `member_limit` column** (removed 2026-09-28). A team's seat cap is the `team_seats`
> entitlement of its plan (`finance.fn_effective_limit`, enforced by `org.fn_assert_seat`); a second
> stored answer (5, against the free plan's 4) is how the two had drifted apart.
>
> **No client write policy** since 2026-09-28 — a team is created, renamed, published/archived and
> handed on only through the workspace RPCs ([Policies.md](Policies.md#orgteams)).

> **`hire_intake`** (Decision #108) is what a client answers when adding this seller to a project
> FROM THE PROFILE — the Project Assignment modal — as opposed to buying one of its listings, whose
> questions live on `marketplace.service_blueprints.intake_fields`. Same `IntakeFieldSchema`, same
> validator (`intakeRefusal`), same cap; the projection is `ProfileView.hireIntake` and the answers
> land on `projects.project_invitations.answers`. A team carries its own because a team is a seller
> too (Decision #61). The seller-side editor is a settings surface that does not exist yet — see
> [`../../flows/ServiceCreation.md`](../../flows/ServiceCreation.md).

---

## 👥 Workspace membership (teams & businesses)

Migration [`00000011_tables_org.sql`](../../../supabase/migrations/00000011_tables_org.sql), reshaped
2026-09-28 for the Teams & Businesses console (root `CLAUDE.md` §8 Decision #122). Zod SSOT:
`@projective/types/workspace` (`members.ts`, `common.ts`). A team (seller side) and a business
(buyer side) are ONE architecture parameterised by kind (Decision #61), so the two role tables and
the two member tables are **column-for-column twins** — one roles editor and one SQL twin
([Functions.md](Functions.md#-the-workspace-console-00001020)) serve both.

**The permission engine is three layers**: a preset role → a custom role → per-member overrides,
resolved as `role ∪ granted − revoked`, intersected with what the kind renders. The vocabulary of
every layer is the one enum **`org.workspace_capability`** (`00000004`). The two older per-kind enums
`org.team_permission` / `org.business_permission` were **retired** (`00000003`): nothing read them and
they could not express a custom role.

No table in this section has a client write policy ([Policies.md](Policies.md)); every change is a
`SECURITY DEFINER` workspace RPC.

### `org.team_roles` / `org.business_roles`

A role an entity grants its members — layers 1 and 2. The two tables are identical but for the
parent key (`team_id` / `business_id`) and the preset vocabulary: a team offers `owner · admin ·
lead · member`; a business has **no `lead`** (seat-binding is seller-side authority).

| Column          | Type                         | Notes                                                                                                                                                                  |
| :-------------- | :--------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | uuid                         | PK. `UNIQUE (id, team_id)` / `(id, business_id)` — the target of the composite FKs below, so a role can only be held in, or offered by, its own entity.                |
| `name`          | text                         | `NOT NULL`. (The business table's former `title` column is renamed `name`, matching the team table.) Unique per entity among live roles, case-insensitively (index). |
| `summary`       | text                         | `NOT NULL DEFAULT ''` — the one-line remit every consumer renders.                                                                                                     |
| `preset`        | text                         | `NULL` for a CUSTOM role, else the preset it IS. `CHECK` on the kind's preset vocabulary. At most one row per preset per entity (index).                            |
| `base_preset`   | text                         | `NOT NULL DEFAULT 'member'` — the preset this role RANKS as (what "may this person manage that one" compares). Never `owner` on a custom role.                      |
| `capabilities`  | `org.workspace_capability[]` | A custom role's own list. A PRESET row stores **none** — its bundle is `org.fn_preset_capabilities(preset, kind)`, so a stale row cannot drift from the definition.  |
| `archived_at`   | timestamptz                  | A retired custom role (nothing is hard-deleted). An archived role is refused as the target of any new membership or invitation, and frees its name.                  |
| `created_at` / `updated_at` | timestamptz      |                                                                                                                                                                        |

**Shape CHECK** (`ck_team_role_shape` / `ck_business_role_shape`): a preset row has
`base_preset = preset`, `capabilities = '{}'` and is never archived; a custom row has
`base_preset <> 'owner'` — **a custom role can never rank as owner**; ownership moves only by
transfer. Retired: the `permissions org.*_permission[]` and `is_system boolean` columns (a preset IS
the system role now) and team's `UNIQUE (team_id, name)` (replaced by the partial name index, which
lets an archived role free its name).

Every entity is created with its preset rows by `org.fn_seed_preset_roles`: **Owner** · **Admin** ·
(team only) **Lead** · **Member**, each with a fixed one-line summary.

### `org.team_members` / `org.business_members`

One row per person per entity (`UNIQUE (team_id, user_id)` / `(business_id, user_id)`); a former
member is **reactivated**, never inserted twice.

| Column                                          | Type                         | Notes                                                                                                                                                                                                    |
| :---------------------------------------------- | :--------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                            | uuid                         | PK — the **member id** every console write addresses.                                                                                                                                                    |
| `team_id` / `business_id`                       | uuid                         | FK → the entity.                                                                                                                                                                                         |
| `user_id`                                       | uuid                         | FK → `auth.users.id`.                                                                                                                                                                                    |
| `role_id`                                       | uuid                         | `NOT NULL`. The role row held — a preset or a custom role of THIS entity: composite FK `(role_id, team_id) → team_roles (id, team_id)` (and the business twin), `ON DELETE RESTRICT`.                   |
| `role`                                          | text                         | The PRESET the member ranks as — **derived** from the role row's `base_preset` by `org.fn_member_role_sync` on every write, so every SQL predicate reading `role` agrees with the role held. `CHECK` on the kind's preset vocabulary. |
| `status`                                        | text                         | `CHECK IN ('active','left')`. A departure is a status, never a `DELETE`; an invitation is a row in `org.org_invitations`, **not** a member state (the former `invited` state is gone). |
| `left_at`                                       | timestamptz                  | `ck_*_member_left`: set exactly when `status = 'left'`.                                                                                                                                                  |
| `invited_by`                                    | uuid                         | FK → `auth.users.id` (`ON DELETE SET NULL` on the business table). Written by the acceptance RPC.                                                                                                       |
| `granted_capabilities` / `revoked_capabilities` | `org.workspace_capability[]` | Layer 3 — per-member overrides, stored SEPARATELY so the roster can show provenance ("+ granted" / "− revoked") and a later role edit keeps flowing to members who never overrode anything.            |
| `title`                                         | text                         | Job title on the roster card / org chart (≤ 80 through the RPC). Per membership, not per user.                                                                                                          |
| `reports_to`                                    | uuid                         | The org-chart edge — FK → the same table's `id`, `ON DELETE SET NULL`. A FK cannot forbid a cycle; `org.update_workspace_member` walks the chain and refuses one.                                     |
| `joined_at` / `created_at`                      | timestamptz                  |                                                                                                                                                                                                          |

Retired: `org.team_members.default_split_share` — a member's payout share lives ONLY in
`finance.contribution_agreements.percent_bp`, the one place the money functions read it.

**Cross-row invariants** (indexes, `00004001`, because a row-level CHECK cannot span rows):
`uq_team_members_one_owner` / `uq_business_members_one_owner` — exactly one ACTIVE owner-preset seat
per entity (not deferrable, which is why the transfer RPC demotes the outgoing owner before seating
the successor); plus `org.fn_member_role_sync` refuses an owner-preset seat for anyone but the
entity's `owner_user_id`, refuses the owner holding any other role, and refuses the owner leaving.

### `org.org_invitations`

A workspace invitation — **named people only**. It addresses one person (`target_user_id`, with
`target_handle` kept so the queue can still render who was invited after an account is gone) or one
address (`target_email`). Join requests and share links were **cut** (product decision 2026-09-28):
the table's own `org_invitations_target_identity_check` forbids an addressee-less row, and nothing
could redeem one.

| Column                                  | Type        | Notes                                                                                                                                                                                               |
| :-------------------------------------- | :---------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inviter_user_id`                       | uuid        | FK → `auth.users.id`.                                                                                                                                                                               |
| `target_email` / `target_handle` / `target_user_id` | text / text / uuid | The addressee (see above).                                                                                                                                                     |
| `team_id` / `business_id`               | uuid        | Exactly one (`check_invitation_target`).                                                                                                                                                            |
| `team_role_id` / `business_role_id`     | uuid        | The role OFFERED, as a real FK into the inviting entity's own role table (`(team_role_id, team_id) → team_roles (id, team_id)`, `ON DELETE RESTRICT`, and the business twin). `ck_org_invitation_role`: the role column of the entity's kind is set, the other is `NULL`. Replaces the loosely-coupled `role_id`, which could point at another entity's role. |
| `token`                                 | text        | `UNIQUE` — the accept capability; re-minted on resend.                                                                                                                                              |
| `note`                                  | text        | Optional sender message (≤ 400 through the RPC).                                                                                                                                                    |
| `status`                                | text        | `CHECK IN ('pending','accepted','declined','revoked')` (`ck_org_invitation_status`). **Expiry is derived from `expires_at`, never a status**, so a lapsed row stays resendable.                     |
| `expires_at`                            | timestamptz | `now() + 14 days` on create and on every resend. `NULL` = does not expire.                                                                                                                         |
| `responded_at`                          | timestamptz | When the invitee accepted or declined.                                                                                                                                                              |
| `revoked_at` / `revoked_by`             | timestamptz / uuid | When, and by whom (FK → `auth.users.id`, `ON DELETE SET NULL`), the inviting side withdrew it.                                                                                               |

`ck_org_invitation_lifecycle` pins the timestamps to the status: `pending` → neither stamp;
`accepted` / `declined` → `responded_at` only; `revoked` → `revoked_at` only. Indexes (`00004001`):
`uq_org_invitations_pending_user` / `uq_org_invitations_pending_email` — at most ONE pending
invitation per entity per person or per address (a double-press cannot stack offers; the RPC maps the
violation to "they already have a pending invitation"); the invitee inbox
(`idx_org_invitations_target_user`) and the two per-kind queue indexes. The former non-unique
`idx_org_invitations_token` is dropped as redundant with the `UNIQUE` on `token`.

RLS is on with **no client policy** — the token IS the accept capability, so every read and write is
a definer ([Policies.md](Policies.md#orgorg_invitations)).

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

Social and portfolio links for both profile types. Whether these rows are exempt from the public-copy
contact prohibition on `org.users_public` is open — Decision #147 flag (a).

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
| `theme`                      | text                   | `system` (default) / `light` / `dark` — `CHECK` (`user_preferences_theme_check`, 2026-10-06; nullable). `system` follows `prefers-color-scheme` live.                                                                                                                                                         |
| `notification_email`         | boolean                | Default `true`.                                                                                                                                                                                                                                                                                                |
| `notification_push`          | boolean                | Default `false`.                                                                                                                                                                                                                                                                                               |
| `locale`                     | text                   | BCP-47 locale (language + region), default `en-GB`. **This is the language source.**                                                                                                                                                                                                                           |
| `preferred_display_currency` | char(3)                | **Additive (`20260723090000`).** Presentational display-conversion target (ISO-4217), `DEFAULT 'GBP'`, `CHECK ~ '^[A-Z]{3}$'`; `NULL` = follow origin (an explicitly cleared preference, distinct from the default). Never affects stored/settled amounts. Stamped into the JWT by `custom_access_token_hook`. |
| `layout_direction`           | `org.layout_direction` | **Additive.** `auto` (default) / `ltr` / `rtl`. Chosen INDEPENDENT of language; `auto` → the locale's natural direction. See `DESIGN_SYSTEM.md` §A.6.                                                                                                                                                          |
| `ui_settings`                | jsonb                  | Misc client UI state.                                                                                                                                                                                                                                                                                          |
| `contrast`                   | text                   | **2026-10-06.** `NOT NULL DEFAULT 'standard'`, `CHECK IN ('standard','high')`. `high` forces the AAA overlay.                                                                                                                                                                                                 |
| `font`                       | text                   | **2026-10-06.** `NOT NULL DEFAULT 'sans'`, `CHECK IN ('sans','dyslexic')`. `dyslexic` remaps every family to OpenDyslexic (`DESIGN_SYSTEM.md` §A.5).                                                                                                                                                         |
| `cvd`                        | text                   | **2026-10-06.** `NOT NULL DEFAULT 'none'`, `CHECK IN ('none','protan','deutan','tritan')`. The colour-vision shift; mirrors `@projective/ui/system` `CvdMode`.                                                                                                                                                 |
| `motion`                     | text                   | **2026-10-06.** `NOT NULL DEFAULT 'standard'`, `CHECK IN ('standard','reduced')`. `reduced` forces reduced motion on every device.                                                                                                                                                                            |

> **The appearance overlays (`theme` · `contrast` · `font` · `cvd` · `motion`, 2026-10-06).**
> `standard` / `sans` / `none` mean **no overlay**, not "force the default": the reader's OS media
> queries (`prefers-contrast`, `prefers-reduced-motion`, and `prefers-color-scheme` under
> `theme = 'system'`) still apply. This row is the durable cross-device copy; the `pj.a11y` cookie is
> its per-device mirror, and that cookie is what server rendering reads so the overlays paint in the
> first byte. Zod: `AppearancePreferencesSchema` / `DEFAULT_APPEARANCE`.

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
`org.business_profiles` (also buyer-side — a Client with multiple members, root `CLAUDE.md` §8
Decision #61; the distinction is scale and structure, not side of market): different table,
different purpose, no service/product surface. Multi-tenancy is a membership join table, **not** a `users.organisation_id`
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
- **Team Roles**: resolved 2026-09-28 — `org.team_roles` / `org.business_roles` store an
  `org.workspace_capability[]` (a real enum array, not `jsonb`), and the preset bundles are an SQL
  twin of `PRESET_GRANTS` pinned by `packages/types/workspace/workspace.contract.test.ts`.
- **Email Management**: `org.user_emails` allows for secondary emails but the auth linkage remains
  strictly on the primary `auth.users` record.
  - `verified_at` is the app-owned mirror of GoTrue's `auth.users.email_confirmed_at`. Because the
    email/password profile is provisioned at signup (before confirmation), the
    `on_auth_user_confirmed` trigger (`public.handle_email_confirmed`,
    `migrations/0312_email_verification_sync.sql`) advances `verified_at` on the NULL→timestamp
    transition so it stays trustworthy. GoTrue still owns the single-use confirmation token for the
    SIGN-IN address. The `/verify` page polls this via `api/v1/auth/verification-status`.
  - _Since 2026-10-06_ a SECONDARY address is verified by the app's own token handshake
    (`org.email_verification_tokens`, hash-only — see above), because GoTrue knows nothing about
    secondary addresses. The table is read-only to clients; see `org.user_emails` above.
  - _Open:_ a GoTrue **email change** (new sign-in address) is not mirrored — `handle_email_confirmed`
    fires only on the first `email_confirmed_at`, so the old sign-in row stays and `is_sign_in`
    (`org.get_my_emails`) then marks no row. No email-change flow exists in the app yet.
