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
| **`integrations`** | OAuth connections and third-party app installations.                                                                                         |

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
