-- =============================================================================================
-- Probe: the Teams persona gate (Decision #228 (A)) — org.fn_assert_team_persona at every door that
-- creates a team or seats someone in one: org.create_workspace ('team'), org.invite_workspace_member
-- (a team invitee named by handle) and org.respond_to_workspace_invitation (accepting a team's).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/teams_persona_gate.sql
--
-- Fixture (seeded data, adjusted inside the transaction with triggers off): C, an adult client with
-- no freelancer profile; P, a freelancer made payout-ready and switched into operator mode; X, a
-- payout-ready freelancer whose persona was dropped (is_freelancer = false, the profile row kept — what
-- a scheduled freelancer removal leaves); R, a payout-ready freelancer; U, one made unready; and a seeded
-- team TM whose owner holds invite_members. On a database without the gate the first case fails — the
-- client is refused `payout_not_ready`, which names the wrong reason. A clean run prints only PASS.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid, txt text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.txt(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT txt FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Run p_sql as p_actor inside a subtransaction; it must be refused PK403 with a message starting
-- `p_reason:` and (when given) HINT p_hint and DETAIL p_detail.
CREATE FUNCTION pg_temp.expect_refusal(
    p_label text, p_actor uuid, p_sql text, p_reason text, p_hint text DEFAULT NULL, p_detail text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
    v_hint text;
    v_detail text;
BEGIN
    PERFORM pg_temp.act(p_actor);
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT,
                                v_hint = PG_EXCEPTION_HINT, v_detail = PG_EXCEPTION_DETAIL;
    END;
    IF v_state IS NULL THEN
        RAISE EXCEPTION 'FAIL % — accepted; expected PK403 %', p_label, p_reason;
    END IF;
    IF v_state <> 'PK403' OR v_msg NOT LIKE p_reason || ':%' THEN
        RAISE EXCEPTION 'FAIL % — refused % "%" (expected PK403 %)', p_label, v_state, v_msg, p_reason;
    END IF;
    IF p_hint IS NOT NULL AND v_hint IS DISTINCT FROM p_hint THEN
        RAISE EXCEPTION 'FAIL % — hint "%" (expected "%")', p_label, v_hint, p_hint;
    END IF;
    IF p_detail IS NOT NULL AND v_detail IS DISTINCT FROM p_detail THEN
        RAISE EXCEPTION 'FAIL % — detail "%" (expected "%")', p_label, v_detail, p_detail;
    END IF;
    RAISE NOTICE 'PASS % (PK403 %, hint %, detail %)', p_label, p_reason, v_hint, v_detail;
END $$;

-- Run p_sql as p_actor; it must succeed outright.
CREATE FUNCTION pg_temp.expect_ok(p_label text, p_actor uuid, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    PERFORM pg_temp.act(p_actor);
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_state IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL % — refused % "%"', p_label, v_state, v_msg;
    END IF;
    RAISE NOTICE 'PASS % (accepted)', p_label;
END $$;

-- Run p_sql as p_actor; the persona gate must NOT be what answers (any other outcome is the door's own).
CREATE FUNCTION pg_temp.expect_no_persona_gate(p_label text, p_actor uuid, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    PERFORM pg_temp.act(p_actor);
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_msg LIKE 'persona_not_freelancer:%' THEN
        RAISE EXCEPTION 'FAIL % — the persona gate refused a door it does not govern', p_label;
    END IF;
    RAISE NOTICE 'PASS % (not persona-gated%)', p_label,
        CASE WHEN v_state IS NULL THEN '' ELSE '; the door answered ' || v_state || ' ' || left(v_msg, 80) END;
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_c uuid;
    v_p uuid;
    v_x uuid;
    v_r uuid;
    v_u uuid;
    v_team uuid;
    v_owner uuid;
    v_member_role uuid;
BEGIN
    SELECT t.id, t.owner_user_id INTO v_team, v_owner
      FROM org.teams t
     WHERE t.status <> 'archived'
       AND finance.fn_freelancer_payout_ready(t.owner_user_id)
       AND 'invite_members' = ANY (org.fn_member_capabilities('team', t.id, t.owner_user_id))
     ORDER BY t.slug
     LIMIT 1;
    SELECT r.id INTO v_member_role FROM org.team_roles r WHERE r.team_id = v_team AND r.preset = 'member';

    SELECT u.user_id INTO v_c FROM org.users_public u
     WHERE NOT u.is_freelancer AND NOT u.is_operator AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.freelancer_profiles fp WHERE fp.user_id = u.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;

    -- Four distinct adult freelancers outside every team: R, U, P and X (readiness is set below).
    WITH ready AS (
        SELECT fp.user_id, row_number() OVER (ORDER BY fp.user_id) AS n
          FROM org.freelancer_profiles fp
          JOIN org.users_public u ON u.user_id = fp.user_id
         WHERE u.is_freelancer AND NOT u.is_operator AND NOT org.fn_is_minor(fp.user_id)
           AND NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.user_id = fp.user_id)
           AND NOT EXISTS (SELECT 1 FROM org.teams t WHERE t.owner_user_id = fp.user_id)
    )
    SELECT max(user_id::text) FILTER (WHERE n = 1)::uuid, max(user_id::text) FILTER (WHERE n = 2)::uuid,
           max(user_id::text) FILTER (WHERE n = 3)::uuid, max(user_id::text) FILTER (WHERE n = 4)::uuid
      INTO v_r, v_u, v_p, v_x
      FROM ready;

    IF v_team IS NULL OR v_member_role IS NULL OR v_c IS NULL
       OR v_r IS NULL OR v_u IS NULL OR v_p IS NULL OR v_x IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (team %, C %, R %, U %, P %, X %) — deno task db:reset',
            v_team, v_c, v_r, v_u, v_p, v_x;
    END IF;

    INSERT INTO probe_ids (k, id, txt)
    SELECT k, id, (SELECT username FROM org.users_public WHERE user_id = id)
      FROM (VALUES ('C', v_c), ('P', v_p), ('X', v_x), ('R', v_r), ('U', v_u), ('owner', v_owner)) AS f(k, id);
    INSERT INTO probe_ids (k, id) VALUES ('team', v_team), ('member_role', v_member_role);

    SET LOCAL session_replication_role = replica;
    UPDATE org.freelancer_profiles SET kyc_status = 'verified', payout_ready = true
     WHERE user_id IN (v_r, v_p, v_x);
    UPDATE org.users_public SET is_operator = true WHERE user_id = v_p;
    UPDATE org.users_public SET is_freelancer = false WHERE user_id = v_x;
    UPDATE org.freelancer_profiles SET kyc_status = 'pending', payout_ready = false WHERE user_id = v_u;

    -- A pending team invitation addressed to each of C, P, X, U and R, as the owner would have sent
    -- it before the invitee's persona changed (or by email, which is checked only at accept).
    INSERT INTO org.org_invitations (inviter_user_id, target_user_id, team_id, team_role_id, token, status, expires_at)
    SELECT v_owner, f.id, v_team, v_member_role, md5(random()::text || f.k), 'pending', now() + interval '14 days'
      FROM (VALUES ('C', v_c), ('P', v_p), ('X', v_x), ('U', v_u), ('R', v_r)) AS f(k, id);
    INSERT INTO probe_ids (k, id)
    SELECT 'inv_' || p.k, i.id
      FROM org.org_invitations i JOIN probe_ids p ON p.id = i.target_user_id
     WHERE i.team_id = v_team AND i.status = 'pending' AND p.k IN ('C', 'P', 'X', 'U', 'R');
    SET LOCAL session_replication_role = origin;

    RAISE NOTICE 'fixture: team % (owner @%), C @%, P @%, X @%, R @%, U @%', v_team, pg_temp.txt('owner'),
        pg_temp.txt('C'), pg_temp.txt('P'), pg_temp.txt('X'), pg_temp.txt('R'), pg_temp.txt('U');
END $$;
-- #endregion

-- #region Creating a team — the persona is asked before readiness
SELECT pg_temp.expect_refusal('create_workspace: a client cannot create a team', pg_temp.id('C'),
    $q$SELECT org.create_workspace('team', 'Persona Probe C', 'persona-probe-c')$q$,
    'persona_not_freelancer', 'self', 'client');
SELECT pg_temp.expect_refusal('create_workspace: a freelancer in operator mode cannot create a team', pg_temp.id('P'),
    $q$SELECT org.create_workspace('team', 'Persona Probe P', 'persona-probe-p')$q$,
    'persona_not_freelancer', 'self', 'operator');
SELECT pg_temp.expect_refusal('create_workspace: a dropped freelancer persona cannot create a team', pg_temp.id('X'),
    $q$SELECT org.create_workspace('team', 'Persona Probe X', 'persona-probe-x')$q$,
    'persona_not_freelancer', 'self', 'client');
SELECT pg_temp.expect_refusal('create_workspace: an unready freelancer still meets the earning gate', pg_temp.id('U'),
    $q$SELECT org.create_workspace('team', 'Persona Probe U', 'persona-probe-u')$q$,
    'payout_not_ready', 'self');
SELECT pg_temp.expect_ok('create_workspace: a payout-ready freelancer creates a team', pg_temp.id('R'),
    $q$SELECT org.create_workspace('team', 'Persona Probe R', 'persona-probe-r')$q$);
SELECT pg_temp.expect_no_persona_gate('create_workspace: a client may still create a business', pg_temp.id('C'),
    $q$SELECT org.create_workspace('business', 'Persona Probe Biz', 'persona-probe-biz')$q$);
SELECT pg_temp.expect_no_persona_gate('create_workspace: operator mode may still create a business', pg_temp.id('P'),
    $q$SELECT org.create_workspace('business', 'Persona Probe Biz P', 'persona-probe-biz-p')$q$);
-- #endregion

-- #region Accepting a team invitation
SELECT pg_temp.expect_refusal('respond_to_workspace_invitation: a client cannot join a team', pg_temp.id('C'),
    format('SELECT org.respond_to_workspace_invitation(%L, true)', pg_temp.id('inv_C')),
    'persona_not_freelancer', 'self', 'client');
SELECT pg_temp.expect_refusal('respond_to_workspace_invitation: operator mode cannot join a team', pg_temp.id('P'),
    format('SELECT org.respond_to_workspace_invitation(%L, true)', pg_temp.id('inv_P')),
    'persona_not_freelancer', 'self', 'operator');
SELECT pg_temp.expect_refusal('respond_to_workspace_invitation: a dropped persona cannot join a team', pg_temp.id('X'),
    format('SELECT org.respond_to_workspace_invitation(%L, true)', pg_temp.id('inv_X')),
    'persona_not_freelancer', 'self', 'client');
SELECT pg_temp.expect_refusal('respond_to_workspace_invitation: an unready freelancer still meets the earning gate',
    pg_temp.id('U'), format('SELECT org.respond_to_workspace_invitation(%L, true)', pg_temp.id('inv_U')),
    'payout_not_ready', 'self');
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM org.org_invitations
                WHERE id IN (pg_temp.id('inv_C'), pg_temp.id('inv_P'), pg_temp.id('inv_X'))
                  AND status <> 'pending') THEN
        RAISE EXCEPTION 'FAIL a refused invitation did not stay pending';
    END IF;
    RAISE NOTICE 'PASS the refused invitations stay pending';
END $$;
SELECT pg_temp.expect_ok('respond_to_workspace_invitation: declining is never persona-gated', pg_temp.id('C'),
    format('SELECT org.respond_to_workspace_invitation(%L, false)', pg_temp.id('inv_C')));
SELECT pg_temp.expect_ok('respond_to_workspace_invitation: a payout-ready freelancer joins', pg_temp.id('R'),
    format('SELECT org.respond_to_workspace_invitation(%L, true)', pg_temp.id('inv_R')));
-- #endregion

-- #region Inviting someone to a team by handle
DO $$
BEGIN
    -- The fixture's pending invitations would otherwise make every handle invite below a 23505.
    SET LOCAL session_replication_role = replica;
    UPDATE org.org_invitations SET status = 'revoked', revoked_at = now()
     WHERE team_id = pg_temp.id('team') AND status = 'pending';
    SET LOCAL session_replication_role = origin;
END $$;
SELECT pg_temp.expect_refusal('invite_workspace_member: a client cannot be invited to a team by handle',
    pg_temp.id('owner'),
    format('SELECT org.invite_workspace_member(%L, %L, %L, NULL, %L)',
        'team', pg_temp.id('team'), pg_temp.txt('C'), pg_temp.id('member_role')),
    'persona_not_freelancer', 'other', 'client');
SELECT pg_temp.expect_refusal('invite_workspace_member: operator mode cannot be invited to a team by handle',
    pg_temp.id('owner'),
    format('SELECT org.invite_workspace_member(%L, %L, %L, NULL, %L)',
        'team', pg_temp.id('team'), pg_temp.txt('P'), pg_temp.id('member_role')),
    'persona_not_freelancer', 'other', 'operator');
SELECT pg_temp.expect_ok('invite_workspace_member: an unready freelancer may still be invited (readiness is asked at accept)',
    pg_temp.id('owner'),
    format('SELECT org.invite_workspace_member(%L, %L, %L, NULL, %L)',
        'team', pg_temp.id('team'), pg_temp.txt('U'), pg_temp.id('member_role')));
SELECT pg_temp.expect_ok('invite_workspace_member: an email invitation is checked at accept, not here',
    pg_temp.id('owner'),
    format('SELECT org.invite_workspace_member(%L, %L, NULL, %L, %L)',
        'team', pg_temp.id('team'), 'persona-probe@example.com', pg_temp.id('member_role')));
-- #endregion

ROLLBACK;
