-- =============================================================================================
-- Probe: the Best match coefficient (CAS S21) — the typed-search order blends each item's quality
-- score with how well it matches the words through search.search_weights 'text_relevance'
-- (packages/backend/services/explore/ranking.ts bestMatchScore). The discovery catalogue reads the
-- coefficient as `anon` through search.ranking_weights(), so the row must be seeded, active and
-- positive, and the definer must project it to a guest, while the table itself (labels,
-- descriptions, updated_by) stays out of a guest's reach.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/search_best_match_weight.sql
--
-- A clean run prints only PASS notices; any FAIL aborts the run at the end.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_fails (label text);

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE(p_ok, false) THEN
        RAISE NOTICE 'PASS %', p_label;
    ELSE
        INSERT INTO probe_fails VALUES (p_label);
        RAISE NOTICE 'FAIL % — %', p_label, p_why;
    END IF;
END $$;
-- #endregion

-- #region 1. The seeded row
SELECT pg_temp.check('text_relevance is seeded, active and positive',
    EXISTS (SELECT 1 FROM search.search_weights
             WHERE key = 'text_relevance' AND is_active AND weight > 0),
    (SELECT format('row: %s', to_jsonb(w)) FROM search.search_weights w WHERE key = 'text_relevance'));
-- #endregion

-- #region 2. A guest reads the coefficient through the definer, never the table
SET LOCAL ROLE anon;
SELECT set_config('probe.guest_weight', COALESCE((
    SELECT weight::text FROM search.ranking_weights() WHERE key = 'text_relevance' AND is_active
), ''), true);
DO $$
BEGIN
    PERFORM set_config('probe.guest_rows', (SELECT count(*) FROM search.search_weights)::text, true);
EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('probe.guest_rows', '0', true);
END $$;
RESET ROLE;

SELECT pg_temp.check('a guest reads text_relevance through search.ranking_weights()',
    current_setting('probe.guest_weight') <> ''
        AND current_setting('probe.guest_weight')::numeric
            = (SELECT weight FROM search.search_weights WHERE key = 'text_relevance'),
    format('guest saw %L', current_setting('probe.guest_weight')));

SELECT pg_temp.check('a guest reads no row of search.search_weights itself',
    current_setting('probe.guest_rows') = '0',
    format('anon read %s row(s)', current_setting('probe.guest_rows')));
-- #endregion

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM probe_fails) THEN
        RAISE EXCEPTION 'search_best_match_weight: % case(s) failed: %',
            (SELECT count(*) FROM probe_fails), (SELECT string_agg(label, '; ') FROM probe_fails);
    END IF;
    RAISE NOTICE 'search_best_match_weight: all cases passed';
END $$;

ROLLBACK;
