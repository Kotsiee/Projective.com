# security Schema: Tables

The `security` schema manages platform-level access control, session state, and auditability. It
bridges the gap between Supabase Auth and the application's domain-specific RLS requirements.

## 🔑 Session & Context

### `security.session_context`

The heart of the application's context-switching logic. It tracks which persona (freelancer,
business, or team) the user is currently acting as. This state is synchronized with the user's JWT
to drive Row-Level Security across all other schemas. The row is initialised during onboarding by
`public.handle_new_user()` — freelancers get their profile as the active context, while client/buyer
accounts start with no active profile until they create a Business or Team.

| Column                   | Type         | Notes                                                                                                                                                           |
| :----------------------- | :----------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Column                   | Type         | Notes                                                                                                                                                           |
| :----------------------- | :----------- | :-----------------------------------------------------------------                                                                                              |
| `user_id`                | uuid         | PK, FK → `auth.users.id`.                                                                                                                                       |
| `active_profile_type`    | profile_type | `freelancer` or `business`.                                                                                                                                     |
| `active_profile_id`      | uuid         | UUID of the active profile.                                                                                                                                     |
| `active_team_id`         | uuid         | Optional active team context.                                                                                                                                   |
| `active_organisation_id` | uuid         | Optional active organisation (buyer-only entity) context. FK → `org.organisations.id` (added `20260715120000`). Mutually exclusive with the profile/team slots. |
| `updated_at`             | timestamptz  | Last context switch timestamp.                                                                                                                                  |

The active slots are kept mutually exclusive by the switch RPCs (`security.switch_session_context`
selects a profile and clears team/organisation; `security.switch_organisation_context` selects an
organisation and clears profile/team). All four are read back into the JWT by the custom
access-token hook — see [Functions.md](Functions.md).

```sql
CREATE TABLE security.session_context (
    user_id uuid NOT NULL,
    active_profile_type public.profile_type,
    active_profile_id uuid,
    active_team_id uuid,
    active_organisation_id uuid,  -- added 20260715120000; FK → org.organisations(id) ON DELETE SET NULL
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT session_context_pkey PRIMARY KEY (user_id),
    CONSTRAINT session_context_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id)
);
```

---

## 🛡️ Trust & Verification

### `security.feature_flags`

Allows for granular rollout of new features (e.g., Phase 2 payments or Phase 3 templates) without
redeploying the backend.

| Column    | Type    | Notes                                |
| :-------- | :------ | :----------------------------------- |
| `key`     | text    | PK (e.g., `enable-marketplace`).     |
| `enabled` | boolean | Global toggle.                       |
| `payload` | jsonb   | Extra configuration for the feature. |

### `security.turnstile_verifications`

Logs bot protection results from Cloudflare Turnstile to prevent automated abuse of anonymous
endpoints.

| Column         | Type    | Notes                              |
| :------------- | :------ | :--------------------------------- |
| `token_prefix` | text    | Partial token for audit reference. |
| `success`      | boolean | Verification result.               |

---

## 📜 Auditability

### `security.audit_logs`

A comprehensive, immutable record of critical actions. This table provides the necessary trail for
dispute resolution and security auditing.

| Column             | Type  | Notes                                                       |
| :----------------- | :---- | :---------------------------------------------------------- |
| `user_id`          | uuid  | The human user performing the action.                       |
| `action`           | text  | e.g., `user.onboarded`, `stage.approved`, `dispute.opened`. |
| `actor_profile_id` | uuid  | The profile ID active at the time of the action.            |
| `ip`               | inet  | Client IP address.                                          |
| `metadata`         | jsonb | Structured data regarding the change.                       |

```sql
CREATE TABLE security.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  entity_table text NOT NULL,
  entity_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet,
  user_agent text,
  request_id uuid,
  actor_profile_id uuid,
  actor_team_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
```

---

## ⚙️ Tunable Parameters

### `security.platform_params`

A `key`/`value(jsonb)` store of tunable platform magnitudes (created in `0004_security_tables.sql`).
`SELECT` is open to `authenticated` (`0205`); writes are service-role only. Magnitudes intentionally
default to safe values — the concrete numbers live in `finance-model.md`, not hardcoded in schema.

Finance-relevant keys:

| Key                                | Default | Meaning                                                                            |
| :--------------------------------- | :------ | :--------------------------------------------------------------------------------- |
| `platform_fee_bp`                  | `500`   | Platform service fee in basis points (canonical **5%**, set in `0305`).            |
| `base_currency`                    | `"GBP"` | **Additive (`20260723090000`).** Internal accounting/FX-bridging base currency.    |
| `pending_release_days`             | `7`     | **Additive.** Length of the post-release safety ("Pending") window.                |
| `instant_payout_fee_bp`            | `0`     | **Additive.** Fee for an Instant Payout (magnitude pending pricing sign-off).      |
| `income_smoother_fee_bp`           | `50`    | **Additive.** Income Smoother micro-fee (~0.5%).                                   |
| `income_smoother_min_months`       | `3`     | **Additive.** Minimum earnings-history months for smoother eligibility.            |
| `income_smoother_min_volume_cents` | `0`     | **Additive.** Minimum lifetime earnings volume for eligibility (pending sign-off). |
| `tax_pot_default_bp`               | `0`     | **Additive.** Suggested default tax-pot auto-set-aside percentage (opt-in).        |
| `vault_approval_threshold_cents`   | `0`     | **Additive.** Spend amount at/above which a second approver is required (0 = off). |
| `session_payout_hours`             | `24`    | Negative-consent window before a session payout auto-releases.                     |

---

## 🚩 Refactor Notes & Suggestions

- **Persona Consistency**: `actor_profile_id` in `audit_logs` should strictly reference the profile
  that was active in `session_context` during the event to ensure we can distinguish between "User
  acting as Freelancer" vs "User acting as Business" for the same human user.
- **Retention Policy**: Audit logs will grow rapidly. I recommend implementing a partitioning
  strategy (by `created_at` month/year) for this table early to maintain query performance on large
  datasets.
