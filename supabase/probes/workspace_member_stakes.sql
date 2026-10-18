-- =============================================================================================
-- Probe: payout stakes on the console read are for the people who run payouts (TEAMS_BUILD_PROMPTS
-- C2 review — the People table's Stake column; Decision #233). org.get_workspace_detail answers each
-- team member's `share_bp` / `share_held` (finance.contribution_agreements) ONLY to a viewer holding
-- `manage_finances` — the same gate as its `payout` block. Everybody else reads null for every member,
-- so hiding the column is not the only thing keeping the split private.
--
-- Rollback-safe: one transaction, ends in ROLLBACK. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/workspace_member_stakes.sql
--
-- Fixture (seeded): the team `northloop` — owner O (holds manage_finances), a plain member M (does
-- not) — and its contribution agreements. Every case runs and reports; a clean run prints only PASS
-- notices, and any FAIL aborts the run at the end.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);
CREATE TEMP TABLE probe_fails (label text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE(p_ok, false) THEN
        RAISE NOTICE 'PASS %', p_label;
    ELSE
        INSERT INTO probe_fails VALUES (p_label);
        RAISE NOTICE 'FAIL % — %', p_label, p_why;
    END IF;
END $$;

-- The whole console read as p_user sees it.
CREATE FUNCTION pg_temp.detail(p_user uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    RETURN org.get_workspace_detail('team', 'northloop');
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_team uuid;
    v_owner uuid;
    v_member uuid;
BEGIN
    SELECT t.id, t.owner_user_id INTO v_team, v_owner FROM org.teams t WHERE t.slug = 'northloop';
    SELECT m.user_id INTO v_member FROM org.team_members m
     WHERE m.team_id = v_team AND m.status = 'active' AND m.role = 'member'
     ORDER BY m.user_id LIMIT 1;
    IF v_team IS NULL OR v_member IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (team %, member %) — deno task db:reset', v_team, v_member;
    END IF;
    -- Every active member holds an agreement, so "null" can only mean "withheld".
    INSERT INTO finance.contribution_agreements (team_id, member_user_id, percent_bp, held)
    SELECT v_team, m.user_id, 0, false FROM org.team_members m
     WHERE m.team_id = v_team AND m.status = 'active'
    ON CONFLICT (team_id, member_user_id) DO NOTHING;
    INSERT INTO probe_ids VALUES ('team', v_team), ('owner', v_owner), ('member', v_member);
END $$;
-- #endregion

-- #region Cases
DO $$
DECLARE
    v_team uuid := pg_temp.id('team');
    v_owner jsonb := pg_temp.detail(pg_temp.id('owner'));
    v_member jsonb := pg_temp.detail(pg_temp.id('member'));
    v_agreed integer := (SELECT count(*) FROM finance.contribution_agreements ca WHERE ca.team_id = v_team);
    v_owner_match integer;
    v_member_leak integer;
BEGIN
    PERFORM pg_temp.check('the owner holds manage_finances; the plain member does not',
        (v_owner -> 'viewer' -> 'capabilities') ? 'manage_finances'
            AND NOT ((v_member -> 'viewer' -> 'capabilities') ? 'manage_finances'),
        format('owner = %s, member = %s', v_owner -> 'viewer' -> 'capabilities', v_member -> 'viewer' -> 'capabilities'));

    SELECT count(*) INTO v_owner_match
      FROM jsonb_array_elements(v_owner -> 'members') e
      JOIN finance.contribution_agreements ca
        ON ca.team_id = v_team AND ca.member_user_id = (e ->> 'user_id')::uuid
     WHERE (e ->> 'share_bp')::integer = ca.percent_bp AND (e ->> 'share_held')::boolean = ca.held;
    PERFORM pg_temp.check('a manage_finances holder reads every member''s stake',
        v_agreed > 0 AND v_owner_match = jsonb_array_length(v_owner -> 'members'),
        format('matched %s of %s members (%s agreements)', v_owner_match, jsonb_array_length(v_owner -> 'members'), v_agreed));

    SELECT count(*) INTO v_member_leak
      FROM jsonb_array_elements(v_member -> 'members') e
     WHERE jsonb_typeof(e -> 'share_bp') IS DISTINCT FROM 'null'
        OR jsonb_typeof(e -> 'share_held') IS DISTINCT FROM 'null';
    PERFORM pg_temp.check('anyone else reads no stake for any member — their own included',
        jsonb_array_length(v_member -> 'members') > 0 AND v_member_leak = 0,
        format('%s of %s members carry a stake', v_member_leak, jsonb_array_length(v_member -> 'members')));

    PERFORM pg_temp.check('the stakes follow the payout block''s gate',
        jsonb_typeof(v_owner -> 'payout') = 'object'
            AND (jsonb_typeof(v_member -> 'payout') IS NULL OR jsonb_typeof(v_member -> 'payout') = 'null'),
        format('owner payout = %s, member payout = %s', jsonb_typeof(v_owner -> 'payout'), jsonb_typeof(v_member -> 'payout')));
END $$;
-- #endregion

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM probe_fails) THEN
        RAISE EXCEPTION 'workspace_member_stakes: % case(s) failed: %',
            (SELECT count(*) FROM probe_fails), (SELECT string_agg(label, '; ') FROM probe_fails);
    END IF;
    RAISE NOTICE 'workspace_member_stakes: all cases passed';
END $$;

ROLLBACK;
