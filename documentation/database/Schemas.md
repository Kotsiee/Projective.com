# Database Schemas & Global Types

Projective utilizes a multi-schema approach within PostgreSQL to maintain strict domain boundaries,
simplify Row-Level Security (RLS) management, and ensure the platform can scale into enterprise and
marketplace layers without architectural friction.

## 🏗 Logical Schemas

The following schemas are initialized to isolate data by business domain:

| Schema             | Responsibility                                                                                                                               |
| :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| **`org`**          | Identity, Freelancer/Business profiles, Teams, and Skills.                                                                                   |
| **`projects`**     | Project headers, modular stages, assignments, and submissions.                                                                               |
| **`finance`**      | Wallets, escrows, the transaction ledger, disputes, invoicing/statements, multi-currency/FX, KYC/KYB, payment methods, and vault governance. |
| **`comms`**        | Real-time project channels, DM threads, and notification delivery.                                                                           |
| **`security`**     | Session context, JWT-linked RLS helpers, and audit logging.                                                                                  |
| **`files`**        | User file library, folder structures, and storage item metadata.                                                                             |
| **`marketplace`**  | Digital asset listings, versions, and purchase history.                                                                                      |
| **`search`**       | Full-text search indexes and semantic embeddings (pgvector).                                                                                 |
| **`ops`**          | Platform administration, moderation flags, and outbound webhooks.                                                                            |
| **`analytics`**    | Event logging and pre-calculated daily rollups.                                                                                              |
| **`integrations`** | The connector + plugin substrate: third-party OAuth connections (calendar/storage/dev…) with a KMS token vault, sync + webhook machinery, and the plugin ecosystem (registry, versions, extension points, scoped installations). |
| **`scheduling`**   | Availability (working hours, call windows, blackouts), calendar events, and discovery/courtesy calls.                                        |

---

## 🏷 Global Enums

These custom types ensure data consistency across all schemas and are defined during initial
migration.

### Identity & Access

```sql
-- Profile & Assignment Types
CREATE TYPE profile_type AS ENUM ('freelancer', 'business');
CREATE TYPE assignment_type AS ENUM ('freelancer', 'team');
CREATE TYPE visibility AS ENUM ('public', 'invite_only', 'unlisted');
```

### Project Lifecycle

```sql
-- Status Tracking
CREATE TYPE project_status AS ENUM ('draft', 'active', 'on_hold', 'completed', 'cancelled');
CREATE TYPE stage_status AS ENUM ('open', 'assigned', 'in_progress', 'submitted', 'approved', 'revisions', 'paid');
CREATE TYPE dispute_status AS ENUM ('open', 'under_review', 'resolved', 'refunded');
```

### Modular Stage Configuration

```sql
-- Stage Behavior & Logic
CREATE TYPE stage_type_enum AS ENUM ('file_based', 'session_based', 'group_session_based', 'management_based', 'maintenance_based');
CREATE TYPE start_trigger_type AS ENUM ('fixed_date', 'on_project_start', 'on_hire_confirmed', 'dependent_on_stage');
CREATE TYPE timeline_preset AS ENUM ('sequential', 'simultaneous', 'staggered', 'custom');
```

### Legal & Financial

```sql
-- IP & Budgeting
CREATE TYPE ip_option_mode AS ENUM ('exclusive_transfer', 'licensed_use', 'shared_ownership', 'projective_partner');
CREATE TYPE portfolio_rights AS ENUM ('allowed', 'forbidden', 'embargoed');
CREATE TYPE budget_type AS ENUM ('fixed_price', 'hourly_cap');
```

### Wallet & Finance (schema-scoped, migrations `20260723090000`–`20260723094000`)

```sql
-- Verification, methods & money-movement
CREATE TYPE finance.kyc_status       AS ENUM ('unverified', 'pending', 'verified', 'rejected', 'expired');
CREATE TYPE finance.method_role      AS ENUM ('funding', 'payout', 'both');
CREATE TYPE finance.deposit_interval AS ENUM ('weekly', 'monthly');
CREATE TYPE finance.payout_mode      AS ENUM ('manual', 'scheduled_weekly', 'scheduled_monthly', 'threshold');
CREATE TYPE finance.pot_purpose      AS ENUM ('tax', 'savings', 'goal', 'general');
-- Vault governance
CREATE TYPE finance.vault_capability AS ENUM ('view', 'add_funds', 'spend', 'distribute', 'withdraw', 'manage_members', 'manage_billing');
CREATE TYPE finance.split_rule_type  AS ENUM ('co_op', 'finders_fee', 'benevolent_dictator');
CREATE TYPE finance.approval_status  AS ENUM ('pending', 'approved', 'rejected', 'expired');
CREATE TYPE finance.vault_action     AS ENUM ('add_funds', 'spend', 'distribute', 'withdraw', 'transfer');
-- Fund states & settlement
CREATE TYPE finance.fund_state       AS ENUM ('locked', 'pending', 'available', 'on_hold');
CREATE TYPE finance.statement_status AS ENUM ('draft', 'issued', 'final');
CREATE TYPE finance.chargeback_status AS ENUM ('opened', 'under_review', 'won', 'lost', 'refunded');

-- i18n preference (org schema, migration 20260723090000)
CREATE TYPE org.layout_direction    AS ENUM ('ltr', 'rtl', 'auto');
```

### Notification Engine (schema-scoped, migrations `20260724090000`–`20260724094000`)

```sql
-- Routing vocabulary
CREATE TYPE comms.notification_channel  AS ENUM ('in_app', 'push', 'email', 'sms', 'webhook');
CREATE TYPE comms.notification_urgency  AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE comms.notification_category AS ENUM ('money', 'work', 'messages', 'schedule', 'discovery', 'account', 'system', 'marketing');
-- Delivery & scheduling
CREATE TYPE comms.delivery_status       AS ENUM ('pending', 'queued', 'sent', 'delivered', 'failed', 'suppressed', 'skipped');
CREATE TYPE comms.queue_status          AS ENUM ('scheduled', 'processing', 'sent', 'cancelled', 'failed');
CREATE TYPE comms.digest_frequency      AS ENUM ('off', 'daily', 'weekly');
CREATE TYPE comms.device_platform       AS ENUM ('web', 'ios', 'android');
```

`notification_category` is a **UI taxonomy** (preference-centre groups and inbox tabs), not the event
namespace — event keys live in the `comms.notification_types` catalog as dotted `domain.event`
strings. See [comms/Tables.md](comms/Tables.md).

### Subscriptions, Standing & Analytics (migrations `20260724110000`–`20260724113000`)

```sql
-- The event substrate (analytics schema — its first tables)
CREATE TYPE analytics.subject_kind AS ENUM ('user', 'freelancer', 'business', 'team', 'organisation',
                                            'project', 'stage', 'ticket', 'listing', 'platform');

-- The EARNED ladder (org schema). Standing is never purchasable.
CREATE TYPE org.standing_subject   AS ENUM ('user', 'freelancer', 'team');
CREATE TYPE org.create_category    AS ENUM ('create', 'run', 'educate', 'advise', 'test', 'empower');
CREATE TYPE org.streak_kind        AS ENUM ('on_time_delivery', 'fast_response', 'dispute_free', 'client_repeat');
CREATE TYPE org.achievement_tier   AS ENUM ('milestone', 'bronze', 'silver', 'gold', 'designation');

-- The PAID ladder (finance schema)
CREATE TYPE finance.plan_audience       AS ENUM ('individual', 'team', 'business', 'organisation');
CREATE TYPE finance.plan_tier           AS ENUM ('free', 'pro', 'enterprise');
CREATE TYPE finance.billing_interval    AS ENUM ('monthly', 'annual', 'custom');
CREATE TYPE finance.subscription_state  AS ENUM ('trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired');
CREATE TYPE finance.entitlement_kind    AS ENUM ('limit', 'flag');
CREATE TYPE finance.entitlement_scaling AS ENUM ('none', 'standing_base', 'standing_bonus');
CREATE TYPE finance.entitlement_key     AS ENUM (
    'active_public_projects', 'private_drafts', 'published_listings',
    'weekly_proposals', 'proposal_buffer_per_10h',
    'teams_owned', 'businesses_owned', 'teams_joined', 'businesses_joined',
    'team_seats', 'team_public_projects', 'business_public_projects', 'business_managers',
    'organisation_seats', 'organisation_businesses', 'departments',
    'promoted_placement', 'advanced_analytics', 'discovery_boost', 'instant_payouts_included',
    'pooled_wallet_full', 'advanced_vault_splits', 'intervaled_invoicing',
    'sso_enabled', 'api_access', 'audit_log_retention_days', 'dedicated_support',
    'negotiated_platform_fee'
);
```

> `finance.entitlement_key` is a **closed** vocabulary on purpose: adding a lever requires a migration
> plus a matching change in `@projective/types/finance/entitlements.ts` in the same commit. That
> friction is what stops the tier matrix drifting away from the SSOT.

### Availability, Integrations & Discovery Calls (schema-scoped, migrations `20260724100000`–`20260724104000`)

```sql
-- Third-party connectors + plugin ecosystem (full set in database/integrations/Tables.md)
CREATE TYPE integrations.provider_kind     AS ENUM ('calendar','conferencing','freebusy','storage','docs','contacts','code','issues','crm','messaging','identity','payments');
CREATE TYPE integrations.provider_category AS ENUM ('identity','payments','calendar','conferencing','storage','productivity','developer','crm','communication','automation');
CREATE TYPE integrations.connection_status AS ENUM ('pending','active','degraded','expired','revoked','disconnected','error');
CREATE TYPE integrations.plugin_status     AS ENUM ('draft','submitted','in_review','approved','published','suspended','delisted');
CREATE TYPE integrations.plugin_runtime    AS ENUM ('iframe','declarative','headless');
-- + auth_scheme, sync_direction, webhook_status, connection_action, plugin_version_status,
--   plugin_surface, install_status, install_scope, scope_risk, plugin_action

-- Availability & calendar entries
CREATE TYPE scheduling.owner_type          AS ENUM ('user', 'freelancer', 'team', 'business', 'organisation');
CREATE TYPE scheduling.availability_kind   AS ENUM ('working_hours', 'call_window');
CREATE TYPE scheduling.event_kind          AS ENUM ('deadline', 'milestone', 'sync', 'session', 'booking', 'availability', 'busy', 'holiday', 'general');
CREATE TYPE scheduling.event_status        AS ENUM ('confirmed', 'tentative', 'busy', 'available', 'cancelled');

-- Discovery / courtesy calls
CREATE TYPE scheduling.call_type           AS ENUM ('courtesy', 'paid');
CREATE TYPE scheduling.call_status         AS ENUM ('proposed', 'confirmed', 'declined', 'cancelled', 'completed', 'no_show', 'expired');
CREATE TYPE scheduling.call_party          AS ENUM ('host', 'requester', 'both');
CREATE TYPE scheduling.call_action         AS ENUM ('requested', 'confirmed', 'declined', 'rescheduled', 'cancelled', 'completed', 'marked_no_show', 'expired', 'link_generated', 'reminder_sent');
```

> `scheduling.event_kind` / `event_status` mirror `CalendarEventKind` / `CalendarEventStatus` in
> `@projective/types/scheduling` **value-for-value**. A discovery call is deliberately **not** a
> tenth kind — it is a `booking` — because a new kind would break the shipped calendar engine's
> exhaustive `Record<CalendarEventKind, …>` maps, turning a data change into a design-system change
> (root `CLAUDE.md` §3).

---

## 🛠 Initialization SQL

The schemas are created as follows to ensure the environment is ready for table migrations:

```sql
CREATE SCHEMA IF NOT EXISTS security;
CREATE SCHEMA IF NOT EXISTS org;
CREATE SCHEMA IF NOT EXISTS projects;
CREATE SCHEMA IF NOT EXISTS comms;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS marketplace;
CREATE SCHEMA IF NOT EXISTS search;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS integrations;
CREATE SCHEMA IF NOT EXISTS files;
```

A twelfth schema was added later, by migration `20260724100000_scheduling_schema_availability.sql`:

```sql
CREATE SCHEMA IF NOT EXISTS scheduling;
```

> `scheduling` was **not** part of the original eleven, even though
> `@projective/types/scheduling` had described itself as a read projection "over the eventual
> `scheduling.*` tables" since 2026-07-21 (root `CLAUDE.md` §8 Decision #37). Creating it is
> additive; the pre-existing `projects.session_events` / `cohorts` / `session_attendance` tables
> remain the SSOT for a **paid Session Service's delivery** and were not touched.
