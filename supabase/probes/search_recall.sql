-- =============================================================================================
-- Probe: nearest-neighbour recall at scale (COMMS SR1 = RED WP14; CAS S3, S7, S11; SEC G18;
-- Decision #339 ruling N4). HNSW post-filters: with pgvector's default hnsw.ef_search = 40 a
-- filtered ask ("20 teams") gets only the teams among the first 40 candidates, so it starves. Both
-- nearest functions therefore run with hnsw.ef_search = 200 and hnsw.iterative_scan =
-- relaxed_order (pgvector 0.8+), and pin search_path = ''. search.fn_set_embedding refuses a vector
-- whose L2 norm is not 1 ± 1e-3 with SQLSTATE PV422, which the embedding sync logs and skips.
--
-- Rollback-safe: one transaction, ends in ROLLBACK. Run against a migrated DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/search_recall.sql
--
-- Fixture (synthetic; search.profiles_index has no FK on entity_id): random unit vectors, first 700
-- users and 300 teams, then 1,960 users and 40 teams. Every stored vector already in the index is
-- set aside first, so only the fixture is ranked. enable_seqscan and enable_sort are off so the HNSW
-- index serves the scan at probe scale: a table this small is otherwise sorted exactly, which hides
-- the starvation. The control cases run the same scan inline, without the functions' settings, to
-- show the shortfall the settings fix. Every case runs and reports; any FAIL aborts at the end.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_fails (label text);
CREATE TEMP TABLE probe_q (v public.vector(1024));
CREATE TEMP TABLE probe_rows (entity_id uuid PRIMARY KEY, entity_type text);

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE(p_ok, false) THEN
        RAISE NOTICE 'PASS %', p_label;
    ELSE
        INSERT INTO probe_fails VALUES (p_label);
        RAISE NOTICE 'FAIL % — %', p_label, p_why;
    END IF;
END $$;

-- A random direction in 1024 dimensions, unit length.
CREATE FUNCTION pg_temp.unit_vector() RETURNS public.vector LANGUAGE sql VOLATILE AS $$
    SELECT public.l2_normalize(array_agg(random_normal())::public.vector(1024))
      FROM generate_series(1, 1024);
$$;

-- A 1024-wide vector whose first element is p_head and the rest 0: its norm is |p_head|.
CREATE FUNCTION pg_temp.axis(p_head double precision) RETURNS public.vector LANGUAGE sql IMMUTABLE AS $$
    SELECT ('[' || p_head::text || repeat(',0', 1023) || ']')::public.vector(1024);
$$;

-- Replace the fixture: p_users user rows and p_teams team rows, each public, named and embedded.
CREATE FUNCTION pg_temp.fixture(p_users int, p_teams int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM search.profiles_index pi USING probe_rows r
     WHERE pi.entity_id = r.entity_id AND pi.entity_type::text = r.entity_type;
    DELETE FROM probe_rows;
    INSERT INTO probe_rows (entity_id, entity_type)
    SELECT gen_random_uuid(), CASE WHEN g <= p_users THEN 'user' ELSE 'team' END
      FROM generate_series(1, p_users + p_teams) g;
    INSERT INTO search.profiles_index (entity_id, entity_type, display_name, embedding, is_active)
    SELECT r.entity_id, r.entity_type::search.profile_entity_type, 'probe ' || r.entity_id,
           pg_temp.unit_vector(), true
      FROM probe_rows r;
END $$;

-- fn_nearest's profiles branch run inline, under the caller's settings: how many of p_limit teams
-- the HNSW scan yields without the function's own ef_search and iterative_scan. The query vector is
-- a variable (a plan parameter), as it is inside fn_nearest: a joined column cannot drive the index.
CREATE FUNCTION pg_temp.inline_teams(p_limit int) RETURNS int LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_q public.vector(1024) := (SELECT v FROM probe_q);
BEGIN
    RETURN (SELECT count(*)::int FROM (
        SELECT pi.entity_id
          FROM search.profiles_index pi
         WHERE pi.is_active AND pi.embedding IS NOT NULL AND pi.entity_type::text = ANY (ARRAY['team'])
         ORDER BY pi.embedding OPERATOR(public.<#>) v_q
         LIMIT p_limit
    ) t);
END $$;

-- What fn_nearest answers for p_limit teams: (rows, rows that are fixture teams).
CREATE FUNCTION pg_temp.nearest_teams(p_limit int, OUT n int, OUT teams int) LANGUAGE sql STABLE AS $$
    SELECT count(*)::int, count(*) FILTER (WHERE r.entity_type = 'team' AND nb.entity_type = 'team')::int
      FROM probe_q q
     CROSS JOIN LATERAL search.fn_nearest(q.v, ARRAY['team'], '{}'::uuid[], p_limit) nb
      LEFT JOIN probe_rows r ON r.entity_id = nb.entity_id;
$$;

-- fn_set_embedding's SQLSTATE for one vector against a fixture row, or 'ok'.
CREATE FUNCTION pg_temp.set_state(p_id uuid, p_v public.vector) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    PERFORM search.fn_set_embedding('team', p_id, p_v, 'voyage-4', 'probe-hash');
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;
-- #endregion

-- #region Fixture
UPDATE search.profiles_index SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE search.projects_index SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE search.services_index SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE search.catalogue_index SET embedding = NULL WHERE embedding IS NOT NULL;
INSERT INTO probe_q SELECT pg_temp.unit_vector();
SELECT pg_temp.fixture(700, 300);

SET LOCAL enable_seqscan = off;
SET LOCAL enable_sort = off;
-- The caller's own settings: pgvector's defaults, which the functions must override for themselves.
SET LOCAL hnsw.ef_search = 40;
SET LOCAL hnsw.iterative_scan = off;
-- #endregion

-- #region The settings the functions carry
DO $$
DECLARE
    v_fn text;
    v_cfg text[];
BEGIN
    FOREACH v_fn IN ARRAY ARRAY['search.fn_nearest', 'search.fn_nearest_to_entity'] LOOP
        SELECT p.proconfig INTO v_cfg FROM pg_proc p WHERE p.oid = v_fn::regproc;
        PERFORM pg_temp.check(v_fn || ' runs with hnsw.ef_search = 200',
            'hnsw.ef_search=200' = ANY (v_cfg), format('proconfig %s', v_cfg));
        PERFORM pg_temp.check(v_fn || ' runs with hnsw.iterative_scan = relaxed_order',
            'hnsw.iterative_scan=relaxed_order' = ANY (v_cfg), format('proconfig %s', v_cfg));
        PERFORM pg_temp.check(v_fn || ' pins search_path = '''' (SEC G18)',
            'search_path=""' = ANY (v_cfg), format('proconfig %s', v_cfg));
    END LOOP;
END $$;
-- #endregion

-- #region 1,000 rows, 300 teams: 20 teams come back
DO $$
DECLARE
    v_control int := pg_temp.inline_teams(20);
    v_n int;
    v_teams int;
BEGIN
    RAISE NOTICE 'control: the bare HNSW scan at ef_search 40 yields % of 20 teams among 1,000 rows', v_control;
    SELECT n, teams INTO v_n, v_teams FROM pg_temp.nearest_teams(20);
    PERFORM pg_temp.check('fn_nearest returns 20 teams from 700 users and 300 teams',
        v_n = 20 AND v_teams = 20, format('%s rows, %s fixture teams (control %s)', v_n, v_teams, v_control));
END $$;

DO $$
DECLARE
    v_seed uuid := (SELECT entity_id FROM probe_rows WHERE entity_type = 'team' LIMIT 1);
    v_n int;
    v_self int;
BEGIN
    SELECT count(*), count(*) FILTER (WHERE n.entity_id = v_seed) INTO v_n, v_self
      FROM search.fn_nearest_to_entity('team', v_seed, ARRAY['team'], '{}'::uuid[], 20) n;
    PERFORM pg_temp.check('fn_nearest_to_entity returns 20 teams and never the team itself',
        v_n = 20 AND v_self = 0, format('%s rows, itself %s times', v_n, v_self));
END $$;
-- #endregion

-- #region 2,000 rows, 40 teams: the iterative scan still fills 20
SELECT pg_temp.fixture(1960, 40);
SET LOCAL hnsw.ef_search = 200;

DO $$
DECLARE
    v_control int := pg_temp.inline_teams(20);
    v_n int;
    v_teams int;
BEGIN
    -- Without iterative_scan even ef_search = 200 holds ~4 of the 40 teams: the probe would prove
    -- nothing if the bare scan already filled.
    PERFORM pg_temp.check('control: ef_search 200 alone starves (the HNSW index serves the scan)',
        v_control < 20, format('the bare scan yielded %s of 20 teams', v_control));
    SELECT n, teams INTO v_n, v_teams FROM pg_temp.nearest_teams(20);
    PERFORM pg_temp.check('fn_nearest returns 20 teams from 1,960 users and 40 teams (iterative_scan)',
        v_n = 20 AND v_teams = 20, format('%s rows, %s fixture teams (control %s)', v_n, v_teams, v_control));
END $$;
-- #endregion

-- #region fn_set_embedding stores unit vectors only (CAS S3)
DO $$
DECLARE
    v_id uuid := (SELECT entity_id FROM probe_rows WHERE entity_type = 'team' LIMIT 1);
    v_before public.vector := (SELECT pi.embedding FROM search.profiles_index pi
                                WHERE pi.entity_id = v_id AND pi.entity_type = 'team');
    v_state text;
BEGIN
    PERFORM pg_temp.check('a vector of norm 2.0 is refused with PV422',
        pg_temp.set_state(v_id, pg_temp.axis(2.0)) = 'PV422', pg_temp.set_state(v_id, pg_temp.axis(2.0)));
    PERFORM pg_temp.check('a vector of norm 0.998 is refused with PV422',
        pg_temp.set_state(v_id, pg_temp.axis(0.998)) = 'PV422', pg_temp.set_state(v_id, pg_temp.axis(0.998)));
    PERFORM pg_temp.check('the zero vector is refused with PV422',
        pg_temp.set_state(v_id, pg_temp.axis(0)) = 'PV422', pg_temp.set_state(v_id, pg_temp.axis(0)));
    PERFORM pg_temp.check('a refused vector leaves the stored one as it was',
        (SELECT pi.embedding FROM search.profiles_index pi
          WHERE pi.entity_id = v_id AND pi.entity_type = 'team') = v_before, 'the row changed');
    PERFORM pg_temp.check('a width other than 1024 is still 22023, not PV422',
        pg_temp.set_state(v_id, '[1,0,0]'::public.vector) = '22023', pg_temp.set_state(v_id, '[1,0,0]'::public.vector));
    PERFORM pg_temp.check('a vector of norm 1.0005 is stored (within 1 ± 1e-3)',
        pg_temp.set_state(v_id, pg_temp.axis(1.0005)) = 'ok', pg_temp.set_state(v_id, pg_temp.axis(1.0005)));
    -- Its own statement: a query's snapshot predates the write a function inside it makes.
    v_state := pg_temp.set_state(v_id, pg_temp.axis(1));
    PERFORM pg_temp.check('a unit vector is stored',
        v_state = 'ok' AND (SELECT pi.embedding FROM search.profiles_index pi
                             WHERE pi.entity_id = v_id AND pi.entity_type = 'team') = pg_temp.axis(1),
        v_state);
END $$;
-- #endregion

-- #region The dead search functions are gone (Q0.2 (f); #340 (E); SEC G11; RED D-29)
DO $$
BEGIN
    PERFORM pg_temp.check('search.fn_search_entities is deleted',
        to_regproc('search.fn_search_entities') IS NULL, 'it still exists');
    PERFORM pg_temp.check('search.fn_search_global is deleted',
        to_regproc('search.fn_search_global') IS NULL, 'it still exists');
    -- Its only caller was fn_search_entities; the app clamps in ranking.ts.
    PERFORM pg_temp.check('search.fn_norm is deleted',
        to_regproc('search.fn_norm') IS NULL, 'it still exists');
END $$;
-- #endregion

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM probe_fails) THEN
        RAISE EXCEPTION 'search_recall: % case(s) failed: %',
            (SELECT count(*) FROM probe_fails), (SELECT string_agg(label, '; ') FROM probe_fails);
    END IF;
    RAISE NOTICE 'search_recall: all cases passed';
END $$;

ROLLBACK;
