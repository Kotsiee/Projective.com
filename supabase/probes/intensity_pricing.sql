-- =============================================================================================
-- Probe: intensity pricing and stage due dates (Decision #414).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/intensity_pricing.sql
--
-- What it pins:
--   • projects.fn_ticket_stage_price prices a ticket in a stage at its intensity there: 0.75 / 1 / 1.5
--     × the rate, the seller's own Low / High price where the stage sets one, the rate exactly on a
--     stage sold at one fixed intensity, and Standard for an element that stores no intensity (every
--     ticket written before intensity was stored) — the rule `stageCostCents` mirrors in TypeScript;
--   • the funding need — what fund_stage holds and a card intent for a stage charges — sums those
--     prices, so a Low ticket is funded at three quarters and a fixed stage at its one price;
--   • fn_enforce_ticket_due_date makes a ticket due on its latest stage `due_at`, refuses a `due_at`
--     that is not a date, and holds a stage date to the deadline-bonus gate as it holds the ticket's.
-- A clean run prints only PASS notices; the first failed check raises `FAIL …`.
-- =============================================================================================

BEGIN;

-- #region 0. Helpers and fixtures (as postgres)
CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_state text, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'FAIL % — the statement succeeded', p_label;
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
    IF p_state IS NOT NULL AND SQLSTATE <> p_state THEN
        RAISE EXCEPTION 'FAIL % — expected %, got % %', p_label, p_state, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- A fresh draft pipeline of two stages, priced and allowed deadlines, owned by the first project owner.
DO $$
DECLARE
    v_owner uuid;
    v_project uuid;
BEGIN
    SELECT p.owner_user_id INTO STRICT v_owner FROM projects.projects p ORDER BY p.created_at LIMIT 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    v_project := (projects.create_project(jsonb_build_object(
        'title', 'probe: intensity pricing', 'format', 'pipeline', 'structure_variation', 'standard',
        'stages', jsonb_build_array(jsonb_build_object('name', 'Design'), jsonb_build_object('name', 'Build'))
    )) ->> 'id')::uuid;
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE projects.projects SET allow_deadline_bonuses = true WHERE id = v_project;
    UPDATE projects.project_stages SET unit_price_cents = 40000 WHERE project_id = v_project;
    PERFORM set_config('probe.project', v_project::text, true);
    PERFORM set_config('probe.design', (
        SELECT s.id::text FROM projects.project_stages s WHERE s.project_id = v_project ORDER BY s.sort_order LIMIT 1), true);
    PERFORM set_config('probe.build', (
        SELECT s.id::text FROM projects.project_stages s WHERE s.project_id = v_project ORDER BY s.sort_order OFFSET 1 LIMIT 1), true);
    RAISE NOTICE 'fixture project=% design=% build=%', v_project, current_setting('probe.design'), current_setting('probe.build');
END $$;
-- #endregion

-- #region 1. The price rule
DO $$
DECLARE
    s projects.project_stages;
    rs jsonb;
BEGIN
    SELECT * INTO STRICT s FROM projects.project_stages WHERE id = current_setting('probe.design')::uuid;
    rs := jsonb_build_array(jsonb_build_object('stage_id', s.id, 'order', 0, 'intensity', 'low'));
    PERFORM pg_temp.check(projects.fn_ticket_stage_price(rs, NULL, s) = 30000, 'Low is 0.75 × the rate');
    rs := jsonb_build_array(jsonb_build_object('stage_id', s.id, 'order', 0, 'intensity', 'high'));
    PERFORM pg_temp.check(projects.fn_ticket_stage_price(rs, NULL, s) = 60000, 'High is 1.5 × the rate');
    rs := jsonb_build_array(jsonb_build_object('stage_id', s.id, 'order', 0));
    PERFORM pg_temp.check(projects.fn_ticket_stage_price(rs, NULL, s) = 40000,
        'an element storing no intensity prices at Standard, as every ticket did before');
    PERFORM pg_temp.check(projects.fn_ticket_stage_price(rs, 35000, s) = 35000,
        'the ticket''s own agreed rate stands in for the stage''s');
    s.high_price_cents := 70000;
    rs := jsonb_build_array(jsonb_build_object('stage_id', s.id, 'order', 0, 'intensity', 'high'));
    PERFORM pg_temp.check(projects.fn_ticket_stage_price(rs, NULL, s) = 70000, 'the seller''s own High price wins');
    s.intensity_locked := true;
    PERFORM pg_temp.check(projects.fn_ticket_stage_price(rs, NULL, s) = 40000,
        'a stage sold at one fixed intensity costs its rate, whatever the element asks');
    s.intensity_locked := false;
    s.high_price_cents := NULL;
    s.unit_price_cents := NULL;
    PERFORM pg_temp.check(projects.fn_ticket_stage_price(rs, NULL, s) IS NULL, 'an unpriced stage stays unpriced');
    PERFORM pg_temp.check(projects.fn_ticket_stage_price(rs, 12345, NULL) = 12345,
        'with no stage row the ticket''s own price answers');
END $$;
-- #endregion

-- #region 2. The funding need sums the intensity prices
DO $$
DECLARE
    v_before bigint;
    v_after bigint;
BEGIN
    v_before := (projects.fn_stage_funding_need(current_setting('probe.design')::uuid) ->> 'amount_cents')::bigint;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description, status,
                                  required_stages, workload_intensity)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.design')::uuid, 'probe: low',
            '{"html": "<p>A brief.</p>"}'::jsonb, 'A brief.', 'todo',
            jsonb_build_array(jsonb_build_object('stage_id', current_setting('probe.design'), 'order', 0,
                                                 'intensity', 'low')), 0.5);
    v_after := (projects.fn_stage_funding_need(current_setting('probe.design')::uuid) ->> 'amount_cents')::bigint;
    PERFORM pg_temp.check(v_after - v_before = 30000, 'a Low ticket adds three quarters of the rate to the stage''s funding');

    UPDATE projects.project_stages SET intensity_locked = true, default_intensity = 'high'
     WHERE id = current_setting('probe.design')::uuid;
    v_after := (projects.fn_stage_funding_need(current_setting('probe.design')::uuid) ->> 'amount_cents')::bigint;
    PERFORM pg_temp.check(v_after - v_before = 40000, 'on a fixed stage the same ticket is funded at the one price');
END $$;
-- #endregion

-- #region 3. Stage due dates
DO $$
DECLARE
    v_ticket uuid;
    v_due timestamptz;
BEGIN
    INSERT INTO projects.tickets (project_id, current_stage_id, title, status, required_stages, workload_intensity)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.build')::uuid, 'probe: dated', 'backlog',
            jsonb_build_array(
                jsonb_build_object('stage_id', current_setting('probe.design'), 'order', 0, 'due_at', '2026-12-01'),
                jsonb_build_object('stage_id', current_setting('probe.build'), 'order', 1, 'due_at', '2026-12-09')),
            2)
    RETURNING id, due_date INTO v_ticket, v_due;
    PERFORM set_config('probe.dated', v_ticket::text, true);
    PERFORM pg_temp.check(v_due = '2026-12-09 00:00:00+00'::timestamptz, 'the ticket is due on its latest stage date');

    UPDATE projects.tickets
       SET required_stages = jsonb_build_array(
               jsonb_build_object('stage_id', current_setting('probe.design'), 'order', 0, 'due_at', '2026-12-03'))
     WHERE id = v_ticket
    RETURNING due_date INTO v_due;
    PERFORM pg_temp.check(v_due = '2026-12-03 00:00:00+00'::timestamptz, 'changing the stages re-derives the due date');
END $$;

SELECT pg_temp.expect_error(format(
    $q$UPDATE projects.tickets SET required_stages = jsonb_build_array(
         jsonb_build_object('stage_id', %L, 'order', 0, 'due_at', 'soon')) WHERE id = %L$q$,
    current_setting('probe.design'), current_setting('probe.dated')),
    '22007', 'a stage due_at that is not a date is refused');

UPDATE projects.projects SET allow_deadline_bonuses = false WHERE id = current_setting('probe.project')::uuid;

DO $$
DECLARE
    v_due timestamptz;
BEGIN
    UPDATE projects.tickets SET title = 'probe: dated, renamed' WHERE id = current_setting('probe.dated')::uuid
    RETURNING due_date INTO v_due;
    PERFORM pg_temp.check(v_due IS NOT NULL, 'an edit that leaves the date where it was is not refused for it');
END $$;

SELECT pg_temp.expect_error(format(
    $q$UPDATE projects.tickets SET required_stages = jsonb_build_array(
         jsonb_build_object('stage_id', %L, 'order', 0, 'due_at', '2026-12-20')) WHERE id = %L$q$,
    current_setting('probe.design'), current_setting('probe.dated')),
    'P0001', 'a stage date needs the deadline-bonus terms, like the ticket''s own');
-- #endregion

ROLLBACK;
