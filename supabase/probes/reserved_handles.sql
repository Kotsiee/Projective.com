-- =============================================================================================
-- Probe: reserved handles (org.fn_is_reserved_handle and the refusal the create / rename doors read,
-- org.fn_handle_refusal) — the public editorial routes `/changelog` and `/feedback` and the landing
-- track's `/features` are top-level words no handle may take.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/reserved_handles.sql
--
-- A wrong answer raises `FAIL …` and aborts the run (non-zero exit under ON_ERROR_STOP). A clean run
-- prints only PASS notices. The TypeScript twin (RESERVED_HANDLES) is pinned to the same list by
-- packages/types/workspace/workspace.contract.test.ts; this probe pins the database's behaviour.
-- =============================================================================================

BEGIN;

-- #region 1. The new words are reserved, however they are typed
DO $$
DECLARE
    v_handle text;
BEGIN
    FOREACH v_handle IN ARRAY ARRAY['changelog', 'feedback', 'features', 'Changelog', '  FEATURES ', 'Feedback']
    LOOP
        IF NOT org.fn_is_reserved_handle(v_handle) THEN
            RAISE EXCEPTION 'FAIL "%" is not reserved', v_handle;
        END IF;
        RAISE NOTICE 'PASS reserved: "%"', v_handle;
    END LOOP;
END $$;
-- #endregion

-- #region 2. The existing words still are; ordinary handles and near-misses are not
DO $$
DECLARE
    v_handle text;
BEGIN
    FOREACH v_handle IN ARRAY ARRAY['legal', 'help', 'about', 'articles', 'contact', 'inspect', 'share']
    LOOP
        IF NOT org.fn_is_reserved_handle(v_handle) THEN
            RAISE EXCEPTION 'FAIL "%" lost its reservation', v_handle;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS the existing reservations stand';

    FOREACH v_handle IN ARRAY ARRAY['ahmed-k', 'changelogs', 'feedback-team', 'featured', 'my-features', '']
    LOOP
        IF org.fn_is_reserved_handle(v_handle) THEN
            RAISE EXCEPTION 'FAIL ordinary handle "%" is reserved', v_handle;
        END IF;
        RAISE NOTICE 'PASS not reserved: "%"', v_handle;
    END LOOP;

    IF org.fn_is_reserved_handle(NULL) THEN
        RAISE EXCEPTION 'FAIL NULL is reserved';
    END IF;
    RAISE NOTICE 'PASS NULL is not a reserved word';
END $$;
-- #endregion

-- #region 3. The refusal every create / rename door shows
DO $$
DECLARE
    v_handle text;
    v_reason text;
BEGIN
    FOREACH v_handle IN ARRAY ARRAY['changelog', 'feedback', 'features']
    LOOP
        v_reason := org.fn_handle_refusal(v_handle);
        IF v_reason IS DISTINCT FROM 'That handle is reserved.' THEN
            RAISE EXCEPTION 'FAIL refusal for "%" is %', v_handle, COALESCE(v_reason, 'NULL (claimable)');
        END IF;
        RAISE NOTICE 'PASS "%" refused: %', v_handle, v_reason;
    END LOOP;
END $$;
-- #endregion

-- #region 4. Nobody already holds a newly reserved word (it would be shadowed by its route)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM org.users_public WHERE lower(username) IN ('changelog', 'feedback', 'features'))
        OR EXISTS (SELECT 1 FROM org.teams WHERE lower(slug) IN ('changelog', 'feedback', 'features'))
        OR EXISTS (SELECT 1 FROM org.business_profiles WHERE lower(slug) IN ('changelog', 'feedback', 'features'))
        OR EXISTS (SELECT 1 FROM org.enterprises WHERE lower(handle) IN ('changelog', 'feedback', 'features'))
    THEN
        RAISE EXCEPTION 'FAIL a profile, team, business or enterprise already holds a newly reserved handle';
    END IF;
    RAISE NOTICE 'PASS no existing holder of changelog / feedback / features';
END $$;
-- #endregion

ROLLBACK;
