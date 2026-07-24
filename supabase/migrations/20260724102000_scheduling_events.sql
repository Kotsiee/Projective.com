-- =============================================================================================
-- 20260724102000_scheduling_events.sql
-- Availability & Discovery Calls foundation (3/5) — the generic calendar entry store plus the
-- external-calendar sync mirror that feeds privacy-masked busy blocks.
--
-- ADDITIVE ONLY. New tables/enums/policies in the `scheduling` schema created by migration 1/5.
-- No existing object is altered. Authored, NOT applied to any live database.
--
-- SCOPE — what this table is and is NOT:
--   * IS: the persisted backing for the `CalendarEvent` read projection every calendar surface
--     already renders (`@projective/types/scheduling`, Decision #37) — project/channel milestones
--     and syncs, availability/busy overlays, and bookings.
--   * IS NOT a replacement for `projects.session_events` (migration 0007), which remains the SSOT
--     for a PAID Session Service's delivered sessions and its cohort/attendance model. A row here
--     may MIRROR one for calendar rendering via `source_session_event_id`; the projects row stays
--     authoritative for money and delivery.
--
-- The `kind` / `status` enums mirror `CalendarEventKind` / `CalendarEventStatus` value-for-value.
-- A discovery call is deliberately NOT a new kind — it is a `booking`, so the shipped calendar
-- engine's exhaustive `Record<CalendarEventKind, …>` label/accent maps keep compiling untouched
-- (root CLAUDE.md §3: a new/changed component would otherwise be a design-system change).
-- =============================================================================================
-- #region 1. Vocabulary (mirrors the Zod SSOT exactly)
DO $$ BEGIN
    CREATE TYPE scheduling.event_kind AS ENUM (
        'deadline', 'milestone', 'sync', 'session', 'booking',
        'availability', 'busy', 'holiday', 'general'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE scheduling.event_status AS ENUM (
        'confirmed', 'tentative', 'busy', 'available', 'cancelled'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;
-- #endregion

-- #region 2. scheduling.events
-- One positioned calendar entry. Either owner-scoped (a schedule's own block) or project-scoped
-- (a milestone on a project calendar) — at least one anchor must be present, enforced below.
CREATE TABLE IF NOT EXISTS scheduling.events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    -- Owner anchor: the schedule this entry belongs to (availability, busy, bookings).
    schedule_id uuid REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    -- Project anchor: the engagement this entry belongs to (deadlines, milestones, syncs).
    project_id uuid REFERENCES projects.projects (id) ON DELETE CASCADE,
    channel_id uuid REFERENCES comms.project_channels (id) ON DELETE SET NULL,
    kind scheduling.event_kind NOT NULL DEFAULT 'general',
    status scheduling.event_status,
    title text NOT NULL DEFAULT '',
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    all_day boolean NOT NULL DEFAULT false,
    -- Privacy masking (PRODUCT_SPEC.md §Privacy Masking): when true the reader must render only the
    -- `status` label and never `title` — the rule that lets a synced external block appear as "Busy"
    -- on a public availability page without leaking what it actually is.
    is_masked boolean NOT NULL DEFAULT false,
    -- A CSS custom-property NAME (e.g. '--primary'), never a literal colour (root CLAUDE.md §3).
    accent text,
    location text,
    meta text,
    attendee_count integer CHECK (attendee_count >= 0),
    capacity integer CHECK (capacity >= 0),
    href text,
    -- Provenance. `source_connection_id` is set when the row was mirrored in from a connected
    -- external calendar; `external_event_id` is that provider's own id, so a re-sync updates rather
    -- than duplicates.
    source_connection_id uuid REFERENCES integrations.user_connections (id) ON DELETE SET NULL,
    external_event_id text,
    -- Set when this row mirrors a delivered Session Service session (projects.session_events stays
    -- authoritative for delivery + money).
    source_session_event_id uuid REFERENCES projects.session_events (id) ON DELETE CASCADE,
    created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_event_span CHECK (ends_at > starts_at),
    CONSTRAINT ck_event_anchor CHECK (
        schedule_id IS NOT NULL
        OR project_id IS NOT NULL
    ),
    -- A given external event maps to at most one row per connection: the re-sync upsert key.
    CONSTRAINT uq_event_external UNIQUE (source_connection_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_events_schedule_window ON scheduling.events (schedule_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_events_project_window ON scheduling.events (project_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_events_kind ON scheduling.events (kind, starts_at);

CREATE OR REPLACE TRIGGER trg_events_touch
    BEFORE UPDATE ON scheduling.events
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();
-- #endregion

-- #region 3. RLS
-- Two reader classes: a project-anchored row follows the existing `projects.has_project_access`
-- gate; a schedule-anchored row is readable by the schedule's own side, and additionally by the
-- world when the schedule is published AND the row is a masked/free-busy overlay. A published
-- schedule therefore leaks its SHAPE (when someone is free) but never its CONTENT.
ALTER TABLE scheduling.events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE scheduling.events TO anon,
authenticated;

GRANT
INSERT,
UPDATE,
DELETE ON TABLE scheduling.events TO authenticated;

GRANT ALL ON TABLE scheduling.events TO service_role;

DROP POLICY IF EXISTS "View scheduling events" ON scheduling.events;

CREATE POLICY "View scheduling events" ON scheduling.events FOR
SELECT TO anon,
authenticated USING (
        (
            schedule_id IS NOT NULL
            AND scheduling.fn_can_view_schedule (schedule_id)
        )
        OR (
            schedule_id IS NOT NULL
            AND scheduling.fn_schedule_is_public (schedule_id)
            AND kind IN (
                'availability'::scheduling.event_kind,
                'busy'::scheduling.event_kind,
                'holiday'::scheduling.event_kind
            )
        )
        OR (
            project_id IS NOT NULL
            AND projects.has_project_access (project_id)
        )
    );

DROP POLICY IF EXISTS "Manage scheduling events" ON scheduling.events;

CREATE POLICY "Manage scheduling events" ON scheduling.events FOR ALL TO authenticated USING (
    (
        schedule_id IS NOT NULL
        AND scheduling.fn_can_manage_schedule (schedule_id)
    )
    OR (
        project_id IS NOT NULL
        AND projects.has_project_access (project_id)
    )
)
WITH
    CHECK (
        (
            schedule_id IS NOT NULL
            AND scheduling.fn_can_manage_schedule (schedule_id)
        )
        OR (
            project_id IS NOT NULL
            AND projects.has_project_access (project_id)
        )
    );
-- #endregion

-- #region 4. Free/busy predicate
-- Does the owner already have something occupying this window? The booking gate in migration 5/5
-- composes this with the working-hours / call-window / blackout / buffer checks. `cancelled` rows
-- never occupy time.
CREATE OR REPLACE FUNCTION scheduling.fn_has_conflicting_event(
    p_schedule uuid, p_starts_at timestamptz, p_ends_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM scheduling.events e
        WHERE e.schedule_id = p_schedule
          AND COALESCE(e.status, 'confirmed'::scheduling.event_status) <> 'cancelled'::scheduling.event_status
          AND e.kind <> 'availability'::scheduling.event_kind
          AND e.starts_at < p_ends_at
          AND e.ends_at > p_starts_at
    );
$$;

-- Is the window inside a blackout span?
CREATE OR REPLACE FUNCTION scheduling.fn_is_blacked_out(
    p_schedule uuid, p_starts_at timestamptz, p_ends_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM scheduling.blackout_dates b
        WHERE b.schedule_id = p_schedule
          AND b.starts_at < p_ends_at
          AND b.ends_at > p_starts_at
    );
$$;

GRANT
EXECUTE ON FUNCTION scheduling.fn_has_conflicting_event (uuid, timestamptz, timestamptz) TO anon,
authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_is_blacked_out (uuid, timestamptz, timestamptz) TO anon,
authenticated;
-- #endregion
