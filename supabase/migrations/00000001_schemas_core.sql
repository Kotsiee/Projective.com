-- =============================================================================================
-- 00000001_schemas_core.sql — Consolidated schema definitions (Category 0).
-- Every unique CREATE SCHEMA gathered from the historical migration set, deduplicated.
-- Sources: 0001_init_schemas.sql (security..reviews); 0011_reviews_tables.sql (reviews, dup);
--          20260724100000_scheduling_schema_availability.sql (scheduling);
--          20260724110000_analytics_event_substrate.sql (analytics, dup).
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
