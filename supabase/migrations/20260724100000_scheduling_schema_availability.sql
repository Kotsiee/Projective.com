-- =============================================================================================
-- 20260724100000_scheduling_schema_availability.sql
-- Availability & Discovery Calls foundation (1/5) — the `scheduling` schema, owner schedules,
-- weekly availability rules (working hours + CALL WINDOWS) and blackout dates.
--
-- ADDITIVE ONLY. Creates a brand-new schema plus its own enums, tables, indexes, RLS policies and
-- helpers. No existing schema, table, column, FK, function, or policy is altered.
-- Authored, NOT applied to any live database (a human step — Decision #47/#54 precedent).
--
-- WHY A NEW SCHEMA. `@projective/types/scheduling` (Decision #37) has always described itself as a
-- READ PROJECTION "over the eventual `scheduling.*` tables" — but the schema never existed: the
-- eleven `CREATE SCHEMA` statements in `0001_init_schemas.sql` do not include it. This migration
-- materialises it. It is deliberately NOT folded into `projects` (a `@handle`'s availability is not
-- project-scoped) nor into `org` (a schedule is not identity).
--
-- WHAT LIVES WHERE (no forking — root CLAUDE.md §1):
--   * `projects.session_events` / `projects.cohorts` / `projects.session_attendance` (migration 0007)
--     remain the SSOT for a PAID, project-scoped Session Service delivery. They are untouched.
--   * `scheduling.*` owns the PRE-ENGAGEMENT layer: when a person is generally bookable, and the
--     top-of-funnel discovery call that has no project behind it yet (migration 3/5).
--   * `org.freelancer_profiles.availability_status` (migration 0003) stays the coarse
--     available/busy discovery signal. It is a cache for ranking, NOT a calendar; nothing here
--     alters or replaces it.
-- =============================================================================================

CREATE SCHEMA IF NOT EXISTS scheduling;

-- `anon` needs schema usage because a PUBLISHED schedule is deliberately visitor-readable (a
-- visitor must see when someone is free in order to book them). Row-level exposure is still
-- governed entirely by the policies in §7 — usage on the schema grants nothing by itself.
GRANT USAGE ON SCHEMA scheduling TO anon,
authenticated;

GRANT USAGE ON SCHEMA scheduling TO service_role;

-- #region 1. Shared vocabulary
-- The owning entity of a schedule. Mirrors the `finance.wallets.owner_type` vocabulary so a single
-- mental model spans money and time; expressed as a real enum here because it is new.
DO $$ BEGIN
    CREATE TYPE scheduling.owner_type AS ENUM ('user', 'freelancer', 'team', 'business', 'organisation');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- What a weekly recurring band MEANS. `working_hours` is the broad "I am at my desk" overlay the
-- calendar already renders; `call_window` is the NARROWER subset during which the owner will accept
-- a discovery call (PRODUCT_SPEC.md §Discovery & Courtesy Calls). A call window is validated against
-- its working hours by `scheduling.fn_call_window_covers` (migration 5/5) but is stored
-- independently, so an owner may take calls outside desk hours if they choose.
DO $$ BEGIN
    CREATE TYPE scheduling.availability_kind AS ENUM ('working_hours', 'call_window');
EXCEPTION WHEN duplicate_object THEN null; END $$;
-- #endregion

-- #region 2. scheduling.schedules — one owner-level schedule header
-- Holds the settings that are true for the WHOLE schedule regardless of which weekly band applies:
-- the IANA timezone every rule below is expressed in, and the publication/visibility posture.
-- Exactly one row per (owner_type, owner_id).
CREATE TABLE IF NOT EXISTS scheduling.schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type scheduling.owner_type NOT NULL,
    owner_id uuid NOT NULL,
    -- IANA timezone id (e.g. 'Europe/London'). Every minute-of-day column in this schema is
    -- interpreted in THIS zone, so SSR and the hydrated island resolve identical positions.
    timezone text NOT NULL DEFAULT 'Europe/London',
    -- Whether `/[handle]/availability` renders the schedule to a visitor at all.
    is_published boolean NOT NULL DEFAULT false,
    -- Privacy posture for synced external blocks (PRODUCT_SPEC.md §Privacy Masking): when true a
    -- visitor sees only the Available/Busy/Tentative status label, never the source event's title.
    mask_external_events boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_schedule_owner UNIQUE (owner_type, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_schedules_owner ON scheduling.schedules (owner_type, owner_id);
-- #endregion

-- #region 3. Visibility & management helpers
-- Mirrors `finance.fn_owner_visible` / `fn_can_view_wallet`: SECURITY DEFINER so a policy can read
-- the membership tables without RLS recursion.

-- May the caller SEE this owner's schedule internals (unmasked)?
CREATE OR REPLACE FUNCTION scheduling.fn_owner_visible(
    p_owner_type scheduling.owner_type, p_owner_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, org, security, public
AS $$
    SELECT
        security.is_admin ()
        OR (p_owner_type IN ('user', 'freelancer') AND p_owner_id = auth.uid ())
        OR (p_owner_type = 'team' AND org.is_active_team_member (p_owner_id))
        OR (p_owner_type = 'business' AND org.is_active_business_member (p_owner_id))
        OR (p_owner_type = 'organisation' AND org.is_organisation_member (p_owner_id));
$$;

-- May the caller MUTATE this owner's schedule? Deliberately narrower than visibility: an individual
-- owns their own schedule outright, while a shared entity's schedule is edited by a team lead /
-- business member / organisation member. Tightening the shared-entity write gate to a specific
-- permission (`org.team_permission` / `org.business_permission`) is FLAGGED for human sign-off
-- rather than guessed at here (root CLAUDE.md §8).
CREATE OR REPLACE FUNCTION scheduling.fn_owner_manages(
    p_owner_type scheduling.owner_type, p_owner_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, org, security, public
AS $$
    SELECT
        security.is_admin ()
        OR (p_owner_type IN ('user', 'freelancer') AND p_owner_id = auth.uid ())
        OR (p_owner_type = 'team' AND org.is_team_lead (p_owner_id))
        OR (p_owner_type = 'business' AND org.is_active_business_member (p_owner_id))
        OR (p_owner_type = 'organisation' AND org.is_organisation_member (p_owner_id));
$$;

-- Resolve a schedule id to its owner then defer to the two predicates above.
CREATE OR REPLACE FUNCTION scheduling.fn_can_view_schedule(p_schedule uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
    SELECT COALESCE((
        SELECT scheduling.fn_owner_visible (s.owner_type, s.owner_id)
        FROM scheduling.schedules s WHERE s.id = p_schedule
    ), false);
$$;

CREATE OR REPLACE FUNCTION scheduling.fn_can_manage_schedule(p_schedule uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
    SELECT COALESCE((
        SELECT scheduling.fn_owner_manages (s.owner_type, s.owner_id)
        FROM scheduling.schedules s WHERE s.id = p_schedule
    ), false);
$$;

-- Is this schedule publicly readable at all? Drives the anonymous/visitor path on
-- `/[handle]/availability` — a visitor may read a PUBLISHED schedule's shape (bands, blackouts) so
-- the booking grid can render, but never an unpublished one.
CREATE OR REPLACE FUNCTION scheduling.fn_schedule_is_public(p_schedule uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
    SELECT COALESCE((
        SELECT s.is_published FROM scheduling.schedules s WHERE s.id = p_schedule
    ), false);
$$;

GRANT EXECUTE ON FUNCTION scheduling.fn_owner_visible(scheduling.owner_type, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION scheduling.fn_owner_manages(scheduling.owner_type, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION scheduling.fn_can_view_schedule(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION scheduling.fn_can_manage_schedule(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION scheduling.fn_schedule_is_public(uuid) TO anon,
authenticated;
-- #endregion

-- #region 4. scheduling.availability_rules — the weekly recurring bands
-- One row per weekly-recurring window, expressed in the parent schedule's timezone as minutes from
-- local midnight. This is the row shape `@projective/types/scheduling` `AvailabilityRuleSchema`
-- mirrors, plus the `kind` discriminator that separates working hours from call windows.
CREATE TABLE IF NOT EXISTS scheduling.availability_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    schedule_id uuid NOT NULL REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    kind scheduling.availability_kind NOT NULL DEFAULT 'working_hours',
    -- 0 = Sunday … 6 = Saturday (matches the Zod contract and JS `Date#getDay`).
    weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
    end_minute integer NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
    label text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_availability_rule_span CHECK (end_minute > start_minute)
);

CREATE INDEX IF NOT EXISTS idx_availability_rules_schedule ON scheduling.availability_rules (schedule_id, kind, weekday);
-- #endregion

-- #region 5. scheduling.blackout_dates — holiday / time-off spans
-- An absolute-time span the schedule is unavailable, overriding every weekly band beneath it.
CREATE TABLE IF NOT EXISTS scheduling.blackout_dates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    schedule_id uuid NOT NULL REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    label text NOT NULL DEFAULT 'Unavailable',
    -- A blackout label is owner-authored free text and can be intimate ("Surgery", "Bereavement").
    -- Because a PUBLISHED schedule's blackouts are readable by `anon` (a visitor must see the gaps
    -- to avoid picking a dead slot), the label is withheld by default: only the SPAN is public
    -- unless the owner opts in. Readers that are not `fn_can_view_schedule` must render the generic
    -- 'Unavailable' string, never `label`, whenever this is false.
    label_is_public boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_blackout_span CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_blackout_dates_schedule ON scheduling.blackout_dates (schedule_id, starts_at, ends_at);
-- #endregion

-- #region 6. updated_at maintenance
CREATE OR REPLACE FUNCTION scheduling.fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_schedules_touch
    BEFORE UPDATE ON scheduling.schedules
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();

CREATE OR REPLACE TRIGGER trg_availability_rules_touch
    BEFORE UPDATE ON scheduling.availability_rules
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();

CREATE OR REPLACE TRIGGER trg_blackout_dates_touch
    BEFORE UPDATE ON scheduling.blackout_dates
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();
-- #endregion

-- #region 7. RLS
ALTER TABLE scheduling.schedules ENABLE ROW LEVEL SECURITY;

ALTER TABLE scheduling.availability_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE scheduling.blackout_dates ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE scheduling.schedules TO anon,
authenticated;

GRANT SELECT ON TABLE scheduling.availability_rules TO anon,
authenticated;

GRANT SELECT ON TABLE scheduling.blackout_dates TO anon,
authenticated;

GRANT
INSERT,
UPDATE,
DELETE ON TABLE scheduling.schedules TO authenticated;

GRANT
INSERT,
UPDATE,
DELETE ON TABLE scheduling.availability_rules TO authenticated;

GRANT
INSERT,
UPDATE,
DELETE ON TABLE scheduling.blackout_dates TO authenticated;

GRANT ALL ON TABLE scheduling.schedules TO service_role;

GRANT ALL ON TABLE scheduling.availability_rules TO service_role;

GRANT ALL ON TABLE scheduling.blackout_dates TO service_role;

-- A published schedule is world-readable (a visitor must see the bands to pick a slot); an
-- unpublished one is visible only to its owner side.
DROP POLICY IF EXISTS "View published or own schedule" ON scheduling.schedules;

CREATE POLICY "View published or own schedule" ON scheduling.schedules FOR
SELECT TO anon,
authenticated USING (
        is_published
        OR scheduling.fn_owner_visible (owner_type, owner_id)
    );

DROP POLICY IF EXISTS "Manage own schedule" ON scheduling.schedules;

CREATE POLICY "Manage own schedule" ON scheduling.schedules FOR ALL TO authenticated USING (
    scheduling.fn_owner_manages (owner_type, owner_id)
)
WITH
    CHECK (
        scheduling.fn_owner_manages (owner_type, owner_id)
    );

DROP POLICY IF EXISTS "View availability rules" ON scheduling.availability_rules;

CREATE POLICY "View availability rules" ON scheduling.availability_rules FOR
SELECT TO anon,
authenticated USING (
        scheduling.fn_schedule_is_public (schedule_id)
        OR scheduling.fn_can_view_schedule (schedule_id)
    );

DROP POLICY IF EXISTS "Manage availability rules" ON scheduling.availability_rules;

CREATE POLICY "Manage availability rules" ON scheduling.availability_rules FOR ALL TO authenticated USING (
    scheduling.fn_can_manage_schedule (schedule_id)
)
WITH
    CHECK (
        scheduling.fn_can_manage_schedule (schedule_id)
    );

DROP POLICY IF EXISTS "View blackout dates" ON scheduling.blackout_dates;

CREATE POLICY "View blackout dates" ON scheduling.blackout_dates FOR
SELECT TO anon,
authenticated USING (
        scheduling.fn_schedule_is_public (schedule_id)
        OR scheduling.fn_can_view_schedule (schedule_id)
    );

DROP POLICY IF EXISTS "Manage blackout dates" ON scheduling.blackout_dates;

CREATE POLICY "Manage blackout dates" ON scheduling.blackout_dates FOR ALL TO authenticated USING (
    scheduling.fn_can_manage_schedule (schedule_id)
)
WITH
    CHECK (
        scheduling.fn_can_manage_schedule (schedule_id)
    );
-- #endregion
