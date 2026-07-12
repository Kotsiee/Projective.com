# Database Schemas & Global Types

Projective utilizes a multi-schema approach within PostgreSQL to maintain strict domain boundaries,
simplify Row-Level Security (RLS) management, and ensure the platform can scale into enterprise and
marketplace layers without architectural friction.

## 🏗 Logical Schemas

The following schemas are initialized to isolate data by business domain:

| Schema             | Responsibility                                                     |
| :----------------- | :----------------------------------------------------------------- |
| **`org`**          | Identity, Freelancer/Business profiles, Teams, and Skills.         |
| **`projects`**     | Project headers, modular stages, assignments, and submissions.     |
| **`finance`**      | Wallets, multi-party escrows, transactions, and dispute records.   |
| **`comms`**        | Real-time project channels, DM threads, and notification delivery. |
| **`security`**     | Session context, JWT-linked RLS helpers, and audit logging.        |
| **`files`**        | User file library, folder structures, and storage item metadata.   |
| **`marketplace`**  | Digital asset listings, versions, and purchase history.            |
| **`search`**       | Full-text search indexes and semantic embeddings (pgvector).       |
| **`ops`**          | Platform administration, moderation flags, and outbound webhooks.  |
| **`analytics`**    | Event logging and pre-calculated daily rollups.                    |
| **`integrations`** | OAuth connections and third-party app installations.               |

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
