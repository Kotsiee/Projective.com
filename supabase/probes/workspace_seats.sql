-- =============================================================================================
-- Probe: a team's seats on the console read (TEAMS_BUILD_PROMPTS C2 — the Members header's
-- "5 of 15 seats", the invite dialog's seat line). org.get_workspace_detail answers `seats` for a team
-- as `{used, limit}`: `used` is org.fn_team_seats_used — active members plus pending, unexpired
-- invitations, the one count org.fn_assert_seat checks the cap against — and `limit` the plan's
-- `team_seats` entitlement (NULL = unlimited). A business is not seat-capped and answers none.
--
-- Rollback-safe: one transaction, ends in ROLLBACK (the invitations it files are rolled back with it).
-- Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/workspace_seats.sql
--
-- Fixture (seeded): the team `northloop` — owner O, a plain member M — and any active business with
-- its owner B. Every case runs and reports; a clean run prints only PASS notices, and any FAIL aborts
-- the run at the end.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid, txt text);
CREATE TEMP TABLE probe_fails (label text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

-- The detail's `seats` as p_user sees it.
CREATE FUNCTION pg_temp.seats(p_user uuid, p_kind text, p_handle text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_user);
    RETURN org.get_workspace_detail(p_kind, p_handle) -> 'seats';
END $$;

-- The count fn_assert_seat has always used, spelled out independently of fn_team_seats_used.
CREATE FUNCTION pg_temp.counted(p_team uuid) RETURNS integer LANGUAGE sql AS $$
    SELECT ((SELECT count(*) FROM org.team_members m WHERE m.team_id = p_team AND m.status = 'active')
          + (SELECT count(*) FROM org.org_invitations i
              WHERE i.team_id = p_team AND i.status = 'pending'
                AND (i.expires_at IS NULL OR i.expires_at > now())))::integer;
$$;

-- Whether fn_assert_seat refuses p_extra more seats.
CREATE FUNCTION pg_temp.refuses(p_team uuid, p_extra integer) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
    PERFORM org.fn_assert_seat('team', p_team, p_extra);
    RETURN false;
EXCEPTION WHEN SQLSTATE '55000' THEN
    RETURN true;
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_team uuid;
    v_owner uuid;
    v_member uuid;
    v_business_owner uuid;
    v_business_slug text;
BEGIN
    SELECT t.id, t.owner_user_id INTO v_team, v_owner FROM org.teams t WHERE t.slug = 'northloop';
    SELECT m.user_id INTO v_member FROM org.team_members m
     WHERE m.team_id = v_team AND m.status = 'active' AND m.role = 'member'
     ORDER BY m.user_id LIMIT 1;
    SELECT b.owner_user_id, b.slug INTO v_business_owner, v_business_slug
      FROM org.business_profiles b WHERE b.status = 'active' ORDER BY b.slug LIMIT 1;
    IF v_team IS NULL OR v_member IS NULL OR v_business_owner IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (team %, member %, business owner %) — deno task db:reset',
            v_team, v_member, v_business_owner;
    END IF;
    INSERT INTO probe_ids VALUES
        ('team', v_team, 'northloop'), ('owner', v_owner, NULL), ('member', v_member, NULL),
        ('business_owner', v_business_owner, v_business_slug);
END $$;
-- #endregion

-- #region Cases
DO $$
DECLARE
    v_team uuid := pg_temp.id('team');
    v_owner_seats jsonb := pg_temp.seats(pg_temp.id('owner'), 'team', 'northloop');
    v_member_seats jsonb := pg_temp.seats(pg_temp.id('member'), 'team', 'northloop');
    v_business_seats jsonb := pg_temp.seats(pg_temp.id('business_owner'), 'business',
        (SELECT txt FROM probe_ids WHERE k = 'business_owner'));
    v_limit integer := finance.fn_effective_limit('team', v_team, 'team_seats'::finance.entitlement_key);
    v_before integer := pg_temp.counted(v_team);
    v_after jsonb;
BEGIN
    PERFORM pg_temp.check('a team answers seats {used, limit}',
        jsonb_typeof(v_owner_seats) = 'object' AND v_owner_seats ? 'used' AND v_owner_seats ? 'limit',
        format('seats = %s', v_owner_seats));
    PERFORM pg_temp.check('used = active members + pending, unexpired invitations',
        (v_owner_seats ->> 'used')::integer = v_before, format('used = %s, counted = %s', v_owner_seats ->> 'used', v_before));
    PERFORM pg_temp.check('limit = the plan''s team_seats entitlement (null = unlimited)',
        (v_owner_seats ->> 'limit')::integer IS NOT DISTINCT FROM v_limit,
        format('limit = %s, entitlement = %s', v_owner_seats ->> 'limit', v_limit));
    PERFORM pg_temp.check('a plain member reads the same seats as the owner',
        v_member_seats = v_owner_seats, format('member = %s, owner = %s', v_member_seats, v_owner_seats));
    PERFORM pg_temp.check('a business answers no seats',
        jsonb_typeof(v_business_seats) IS NULL OR jsonb_typeof(v_business_seats) = 'null',
        format('seats = %s', v_business_seats));

    -- A live pending invitation takes a seat; a lapsed one does not.
    INSERT INTO org.org_invitations (inviter_user_id, target_email, team_id, team_role_id, token, status, expires_at)
    SELECT pg_temp.id('owner'), 'seat-probe-live@example.test', v_team, r.id,
           encode(extensions.gen_random_bytes(24), 'hex'), 'pending', now() + interval '14 days'
      FROM org.team_roles r WHERE r.team_id = v_team AND r.preset = 'member';
    INSERT INTO org.org_invitations (inviter_user_id, target_email, team_id, team_role_id, token, status, expires_at)
    SELECT pg_temp.id('owner'), 'seat-probe-lapsed@example.test', v_team, r.id,
           encode(extensions.gen_random_bytes(24), 'hex'), 'pending', now() - interval '1 day'
      FROM org.team_roles r WHERE r.team_id = v_team AND r.preset = 'member';
    v_after := pg_temp.seats(pg_temp.id('owner'), 'team', 'northloop');
    PERFORM pg_temp.check('a pending invitation takes a seat, a lapsed one does not',
        (v_after ->> 'used')::integer = v_before + 1, format('before = %s, after = %s', v_before, v_after ->> 'used'));
    PERFORM pg_temp.check('fn_team_seats_used is the count fn_assert_seat always used',
        org.fn_team_seats_used(v_team) = pg_temp.counted(v_team),
        format('helper = %s, counted = %s', org.fn_team_seats_used(v_team), pg_temp.counted(v_team)));

    -- The cap refuses exactly the seat past `limit - used`.
    IF v_limit IS NOT NULL THEN
        PERFORM pg_temp.check('the seat cap admits up to limit - used more',
            NOT pg_temp.refuses(v_team, GREATEST(v_limit - (v_after ->> 'used')::integer, 0)),
            format('limit = %s, used = %s', v_limit, v_after ->> 'used'));
        PERFORM pg_temp.check('the seat cap refuses one past limit - used',
            pg_temp.refuses(v_team, v_limit - (v_after ->> 'used')::integer + 1),
            format('limit = %s, used = %s', v_limit, v_after ->> 'used'));
    ELSE
        PERFORM pg_temp.check('an unlimited plan never refuses a seat', NOT pg_temp.refuses(v_team, 1000), 'refused');
    END IF;
END $$;
-- #endregion

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM probe_fails) THEN
        RAISE EXCEPTION 'workspace_seats: % case(s) failed: %',
            (SELECT count(*) FROM probe_fails), (SELECT string_agg(label, '; ') FROM probe_fails);
    END IF;
    RAISE NOTICE 'workspace_seats: all cases passed';
END $$;

ROLLBACK;
