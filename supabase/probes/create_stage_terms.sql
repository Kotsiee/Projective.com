-- =============================================================================================
-- Probe: the Create stage popover's terms (Decision #416) — `projects.create_stage` stores the
-- baseline rate it is given (`p_unit_price_cents`) and the CREATE category carried in its settings
-- bag (`p_payload.create_category`, `project_stages.create_category`); an empty category leaves the
-- stage untyped, the call without either still builds an unpriced, untyped stage, an unknown category
-- is refused, and every stage still opens its room in the same transaction.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/create_stage_terms.sql
--
-- A wrong answer raises `FAIL …` and aborts the run. A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

CREATE TEMP TABLE probe_pick ON COMMIT DROP AS
SELECT p.id AS project_id, p.owner_user_id AS owner_id
FROM projects.projects p
WHERE NOT p.is_personal AND p.archived_at IS NULL AND p.format IN ('pipeline', 'one_off')
ORDER BY p.created_at
LIMIT 1;
GRANT SELECT ON probe_pick TO authenticated;

CREATE TEMP TABLE probe_made (label text PRIMARY KEY, stage_id uuid) ON COMMIT DROP;
GRANT SELECT, INSERT ON probe_made TO authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM probe_pick) THEN
        RAISE EXCEPTION 'FAIL the seeds hold no staged, non-personal project to probe';
    END IF;
END $$;

SELECT set_config(
    'request.jwt.claims',
    json_build_object('sub', owner_id, 'role', 'authenticated')::text,
    true
)
FROM probe_pick;

-- #region 1. The owner creates three stages: priced and typed, bare, and with an empty category
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_project uuid := (SELECT project_id FROM probe_pick);
BEGIN
    INSERT INTO probe_made VALUES
        ('typed', projects.create_stage(v_project, 'Probe typed stage', '{}'::jsonb, '', 125000,
            '{"create_category":"test"}'::jsonb)),
        ('bare', projects.create_stage(v_project, 'Probe bare stage')),
        ('blank', projects.create_stage(v_project, 'Probe blank stage', '{}'::jsonb, '', NULL,
            '{"create_category":""}'::jsonb));
END $$;
RESET ROLE;
-- #endregion

-- #region 2. What landed
DO $$
DECLARE
    v_row record;
BEGIN
    SELECT ps.unit_price_cents, ps.create_category INTO v_row
    FROM projects.project_stages ps JOIN probe_made m ON m.stage_id = ps.id WHERE m.label = 'typed';
    IF v_row.unit_price_cents IS DISTINCT FROM 125000 OR v_row.create_category IS DISTINCT FROM 'test' THEN
        RAISE EXCEPTION 'FAIL the typed stage stored % / % (expected 125000 / test)',
            COALESCE(v_row.unit_price_cents::text, 'NULL'), COALESCE(v_row.create_category::text, 'NULL');
    END IF;
    RAISE NOTICE 'PASS the rate and the CREATE category are stored';

    SELECT ps.unit_price_cents, ps.create_category INTO v_row
    FROM projects.project_stages ps JOIN probe_made m ON m.stage_id = ps.id WHERE m.label = 'bare';
    IF v_row.unit_price_cents IS NOT NULL OR v_row.create_category IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL a stage created without terms carries some';
    END IF;
    RAISE NOTICE 'PASS a stage created without terms is unpriced and untyped';

    SELECT ps.create_category INTO v_row
    FROM projects.project_stages ps JOIN probe_made m ON m.stage_id = ps.id WHERE m.label = 'blank';
    IF v_row.create_category IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL an empty CREATE category was stored as %', v_row.create_category;
    END IF;
    RAISE NOTICE 'PASS an empty CREATE category leaves the stage untyped';

    IF (SELECT count(*) FROM comms.project_channels c JOIN probe_made m ON m.stage_id = c.stage_id) <> 3 THEN
        RAISE EXCEPTION 'FAIL a created stage opened no room';
    END IF;
    RAISE NOTICE 'PASS every created stage opened its room';
END $$;
-- #endregion

-- #region 3. An unknown CREATE category is refused
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    BEGIN
        PERFORM projects.create_stage((SELECT project_id FROM probe_pick), 'Probe bogus stage',
            '{}'::jsonb, '', NULL, '{"create_category":"bogus"}'::jsonb);
        RAISE EXCEPTION 'FAIL an unknown CREATE category was accepted';
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE NOTICE 'PASS an unknown CREATE category is refused';
    END;
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
