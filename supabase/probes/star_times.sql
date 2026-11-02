-- =============================================================================================
-- Probe: star times (Decision #370) — `comms.dm_participants.starred_at` and
-- `projects.user_preferences.starred_at` record when a star was set, so the rail's previews and
-- /saved can order stars newest first. `comms.set_dm_starred` stamps a new star, keeps the time of a
-- repeat star and clears it on un-star; the seeds carry a time on every starred row and none on the rest.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/star_times.sql
--
-- A wrong answer raises `FAIL …` and aborts the run. A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

CREATE TEMP TABLE probe_pick ON COMMIT DROP AS
SELECT thread_id, user_id
FROM comms.dm_participants
WHERE NOT is_starred AND deleted_at IS NULL
ORDER BY thread_id, user_id
LIMIT 1;
GRANT SELECT ON probe_pick TO authenticated;

-- #region 1. Seeded stars carry a time; unstarred rows carry none
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM comms.dm_participants WHERE is_starred AND starred_at IS NULL)
        OR EXISTS (SELECT 1 FROM comms.dm_participants WHERE NOT is_starred AND starred_at IS NOT NULL)
    THEN
        RAISE EXCEPTION 'FAIL a conversation star and its time disagree';
    END IF;
    IF EXISTS (SELECT 1 FROM projects.user_preferences WHERE is_starred AND starred_at IS NULL)
        OR EXISTS (
            SELECT 1 FROM projects.user_preferences
            WHERE NOT COALESCE(is_starred, false) AND starred_at IS NOT NULL
        )
    THEN
        RAISE EXCEPTION 'FAIL a project star and its time disagree';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM comms.dm_participants WHERE is_starred)
        OR NOT EXISTS (SELECT 1 FROM projects.user_preferences WHERE is_starred)
    THEN
        RAISE EXCEPTION 'FAIL the seeds hold no starred conversation or project to check';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM probe_pick) THEN
        RAISE EXCEPTION 'FAIL no unstarred conversation participant to probe';
    END IF;
    RAISE NOTICE 'PASS seeded stars carry a time and unstarred rows none';
END $$;
-- #endregion

SELECT set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated')::text,
    true
)
FROM probe_pick;

-- #region 2. A new star is stamped now
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM comms.set_dm_starred((SELECT thread_id FROM probe_pick), true);
END $$;
RESET ROLE;

DO $$
DECLARE
    v_at timestamptz;
BEGIN
    SELECT p.starred_at INTO v_at
    FROM comms.dm_participants p JOIN probe_pick k USING (thread_id, user_id);
    IF v_at IS DISTINCT FROM now() THEN
        RAISE EXCEPTION 'FAIL a new star was stamped % (expected now)', COALESCE(v_at::text, 'NULL');
    END IF;
    -- Back-date it, so a repeat star that re-stamped would show.
    UPDATE comms.dm_participants p SET starred_at = now() - interval '3 days'
    FROM probe_pick k WHERE p.thread_id = k.thread_id AND p.user_id = k.user_id;
    RAISE NOTICE 'PASS a new star is stamped now';
END $$;
-- #endregion

-- #region 3. A repeat star keeps its time
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM comms.set_dm_starred((SELECT thread_id FROM probe_pick), true);
END $$;
RESET ROLE;

DO $$
DECLARE
    v_at timestamptz;
BEGIN
    SELECT p.starred_at INTO v_at
    FROM comms.dm_participants p JOIN probe_pick k USING (thread_id, user_id);
    IF v_at IS DISTINCT FROM now() - interval '3 days' THEN
        RAISE EXCEPTION 'FAIL a repeat star moved its time to %', COALESCE(v_at::text, 'NULL');
    END IF;
    RAISE NOTICE 'PASS a repeat star keeps its time';
END $$;
-- #endregion

-- #region 4. Un-starring clears the time
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM comms.set_dm_starred((SELECT thread_id FROM probe_pick), false);
END $$;
RESET ROLE;

DO $$
DECLARE
    v_row record;
BEGIN
    SELECT p.is_starred, p.starred_at INTO v_row
    FROM comms.dm_participants p JOIN probe_pick k USING (thread_id, user_id);
    IF v_row.is_starred OR v_row.starred_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL un-starring left starred=% at=%', v_row.is_starred, v_row.starred_at;
    END IF;
    RAISE NOTICE 'PASS un-starring clears the time';
END $$;
-- #endregion

ROLLBACK;
