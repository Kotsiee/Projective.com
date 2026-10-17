-- =============================================================================================
-- 00000001_schemas_core.sql — Consolidated schema definitions (Category 0).
-- Every unique CREATE SCHEMA gathered from the historical migration set, deduplicated.
-- Sources: 0001_init_schemas.sql (security..reviews); 0011_reviews_tables.sql (reviews, dup);
--          20260724100000_scheduling_schema_availability.sql (scheduling);
--          20260724110000_analytics_event_substrate.sql (analytics, dup);
--          editorial + community (Decision #274, 2026-10-17).
-- =============================================================================================

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

CREATE SCHEMA IF NOT EXISTS reviews;

CREATE SCHEMA IF NOT EXISTS scheduling;

-- `catalogue` — the seller's publishable inventory (products, listings, collections).
--
-- Added for the /catalogue console, whose Zod SSOT (@projective/types/catalogue) and fixtures both
-- existed with NO backing schema: `catalogue` appeared in supabase/migrations/ only as a storage
-- bucket name and inside the unrelated `analytics.event_catalogue`. It is a separate schema rather
-- than more tables in `marketplace` because the two answer different questions — `marketplace`
-- models how a SERVICE is delivered and priced (`service_blueprints`), while `catalogue` models what
-- a seller has listed for sale and its publication lifecycle. See the header of
-- 00000023_tables_catalogue.sql for the seam between them, which is a flagged open decision.
CREATE SCHEMA IF NOT EXISTS catalogue;

-- `editorial` — the content the PLATFORM authors and publishes (Decision #274): the help centre's
-- categories, articles and FAQs, the changelog's releases, and Projective's own articles with their
-- authors. It is reference data, not demo-world data, so it must exist in every environment: its
-- rows are category-5 migrations GENERATED from Zod-validated TypeScript content sources
-- (`deno task db:editorial:generate`), never the development seed. Member-authored posts stay in
-- `catalogue.articles`; legal documents stay versioned TypeScript modules.
CREATE SCHEMA IF NOT EXISTS editorial;

-- `community` — what people DO around the platform and its promises (Decision #274): newsletter
-- subscriptions (moved here from `comms`), help-article helpfulness votes and the feedback board's
-- ideas, votes and status history. Every row is written by a person, through a definer door or the
-- service role, never by a content generator. Contact requests stay in `ops`.
CREATE SCHEMA IF NOT EXISTS community;
