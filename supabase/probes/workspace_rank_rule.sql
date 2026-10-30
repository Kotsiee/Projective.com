-- =============================================================================================
-- Probe: the workspace rank rule — "only someone you outrank" (SYSTEM_ARCHITECTURE §Teams &
-- Businesses; IDENTITY_AND_WORKSPACES_AUDIT IW-H4, IW-M4, K6). Every door that offers, assigns or
-- edits a role asks org.fn_assert_role_below: the role must rank STRICTLY below the actor's seat.
--
--   * org.upsert_workspace_role — a new role may not rank at the author's rank or above; an EDIT is
--     also held to the role as it stands, so an admin cannot demote the admin-ranked role a peer
--     admin holds (the IW-H4 escalation: demote the peer's role, then remove the peer).
--   * org.update_workspace_member — the role a member moves to must rank below the actor (IW-M4), on
--     top of the target ranking below them.
--   * org.invite_workspace_member — an invitation may not offer a role at or above the inviter's rank.
--   * org.respond_to_join_request — approving is seating, so the same rule holds for the approver.
--   * the owner (rank 4) still creates and offers admin-ranked roles; lower ranks still pass.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/workspace_rank_rule.sql
--
-- Fixture (seeded data, Seed.md): team Atelier Nova (`ateliernova` — owner inesduarte, admin
-- lenamueller, member aikotanaka), team Northloop (`northloop` — lead samuelnkemelu), business Helia
-- Finance (`heliafinance` — owner priyaraman, admin hannahcole), and any adult with a profile who
-- belongs to Helia in no way (the join-request requester). A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_got text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FAIL % — got %', p_label, p_got;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- Run p_sql as p_actor inside a savepoint. p_state NULL: it must succeed. Otherwise it must be refused
-- with that SQLSTATE and a MESSAGE starting p_prefix. Nothing it did survives a refusal.
CREATE FUNCTION pg_temp.expect(p_label text, p_actor uuid, p_sql text, p_state text, p_prefix text)
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
    IF p_state IS NULL THEN
        IF v_state IS NOT NULL THEN
            RAISE EXCEPTION 'FAIL % — refused % "%" (expected it to go through)', p_label, v_state, v_msg;
        END IF;
        RAISE NOTICE 'PASS % (allowed)', p_label;
        RETURN;
    END IF;
    IF v_state IS NULL THEN
        RAISE EXCEPTION 'FAIL % — went through (expected % %)', p_label, p_state, p_prefix;
    END IF;
    IF v_state <> p_state OR v_msg NOT LIKE p_prefix || '%' THEN
        RAISE EXCEPTION 'FAIL % — refused % "%" (expected % %)', p_label, v_state, v_msg, p_state, p_prefix;
    END IF;
    RAISE NOTICE 'PASS % (% %)', p_label, v_state, p_prefix;
END $$;

-- A preset role of an entity by its preset name.
CREATE FUNCTION pg_temp.team_preset(p_team uuid, p_preset text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM org.team_roles WHERE team_id = p_team AND preset = p_preset;
$$;

CREATE FUNCTION pg_temp.business_preset(p_business uuid, p_preset text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM org.business_roles WHERE business_id = p_business AND preset = p_preset;
$$;

-- The refusal every door raises for a role that does not rank below the actor.
CREATE FUNCTION pg_temp.rank_refusal(p_field text) RETURNS text LANGUAGE sql AS $$
    SELECT p_field || ': that role does not rank below yours';
$$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_missing text[];
BEGIN
    INSERT INTO probe_ids (k, id)
    SELECT 'NOVA', id FROM org.teams WHERE slug = 'ateliernova'
    UNION ALL SELECT 'LOOP', id FROM org.teams WHERE slug = 'northloop'
    UNION ALL SELECT 'HELIA', id FROM org.business_profiles WHERE slug = 'heliafinance'
    UNION ALL SELECT 'INES', user_id FROM org.users_public WHERE username = 'inesduarte'
    UNION ALL SELECT 'LENA', user_id FROM org.users_public WHERE username = 'lenamueller'
    UNION ALL SELECT 'AIKO', user_id FROM org.users_public WHERE username = 'aikotanaka'
    UNION ALL SELECT 'SAM', user_id FROM org.users_public WHERE username = 'samuelnkemelu'
    UNION ALL SELECT 'PRIYA', user_id FROM org.users_public WHERE username = 'priyaraman'
    UNION ALL SELECT 'HANNAH', user_id FROM org.users_public WHERE username = 'hannahcole';

    INSERT INTO probe_ids (k, id)
    SELECT 'AIKO_SEAT', m.id FROM org.team_members m
     WHERE m.team_id = pg_temp.id('NOVA') AND m.user_id = pg_temp.id('AIKO') AND m.status = 'active';

    -- An adult with a profile who has no seat, invitation or request at Helia: the requester.
    INSERT INTO probe_ids (k, id)
    SELECT 'ASKER', u.user_id FROM org.users_public u
     WHERE NOT org.fn_is_minor(u.user_id)
       AND u.user_id NOT IN (SELECT user_id FROM org.business_members WHERE business_id = pg_temp.id('HELIA'))
       AND u.user_id NOT IN (SELECT requester_user_id FROM org.org_join_requests WHERE business_id = pg_temp.id('HELIA'))
       AND NOT EXISTS (SELECT 1 FROM org.deletion_requests d WHERE d.user_id = u.user_id AND d.status = 'scheduled')
     ORDER BY u.username LIMIT 1;

    SELECT array_agg(k) INTO v_missing
      FROM unnest(ARRAY['NOVA', 'LOOP', 'HELIA', 'INES', 'LENA', 'AIKO', 'SAM', 'PRIYA', 'HANNAH', 'AIKO_SEAT', 'ASKER']) k
     WHERE pg_temp.id(k) IS NULL;
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL fixture — not seeded: % (run deno task db:reset)', v_missing;
    END IF;
    RAISE NOTICE 'PASS fixture';
END $$;
-- #endregion

-- #region 1. upsert_workspace_role (IW-H4)
-- The owner outranks an admin-ranked role: creating one is theirs.
DO $$
BEGIN
    PERFORM pg_temp.act(pg_temp.id('INES'));
    INSERT INTO probe_ids (k, id)
    SELECT 'COORD', (org.upsert_workspace_role('team', pg_temp.id('NOVA'), NULL, 'Probe Coordinators', '',
        ARRAY['invite_members', 'view_analytics']::org.workspace_capability[], 'admin')->>'id')::uuid;
    PERFORM pg_temp.check('owner creates an admin-ranked role', pg_temp.id('COORD') IS NOT NULL, 'no id');
END $$;

SELECT pg_temp.expect('admin may not create an admin-ranked role (equal rank)', pg_temp.id('LENA'),
    format($q$SELECT org.upsert_workspace_role('team', %L, NULL, 'Probe Peers', '',
        ARRAY['view_analytics']::org.workspace_capability[], 'admin')$q$, pg_temp.id('NOVA')),
    '42501', pg_temp.rank_refusal('basePreset'));

SELECT pg_temp.expect('admin may create a lead-ranked role', pg_temp.id('LENA'),
    format($q$SELECT org.upsert_workspace_role('team', %L, NULL, 'Probe Leads', '',
        ARRAY['view_analytics']::org.workspace_capability[], 'lead')$q$, pg_temp.id('NOVA')),
    NULL, NULL);

-- Seat the member in the admin-ranked role (the owner may): they are now the admin's peer.
SELECT pg_temp.expect('owner seats a member in the admin-ranked role', pg_temp.id('INES'),
    format($q$SELECT org.update_workspace_member('team', %L, jsonb_build_object('role_id', %L))$q$,
        pg_temp.id('AIKO_SEAT'), pg_temp.id('COORD')),
    NULL, NULL);

-- The escalation itself: demote the role the peer holds (to member rank), then remove the peer.
SELECT pg_temp.expect('admin may not demote the admin-ranked role a peer holds', pg_temp.id('LENA'),
    format($q$SELECT org.upsert_workspace_role('team', %L, %L, 'Probe Coordinators', '',
        ARRAY['view_analytics']::org.workspace_capability[], 'member')$q$, pg_temp.id('NOVA'), pg_temp.id('COORD')),
    '42501', pg_temp.rank_refusal('role'));

SELECT pg_temp.expect('admin may not manage the peer directly either', pg_temp.id('LENA'),
    format($q$SELECT org.update_workspace_member('team', %L, jsonb_build_object('remove', true))$q$,
        pg_temp.id('AIKO_SEAT')),
    '42501', 'member: you cannot remove this member');

DO $$
BEGIN
    PERFORM pg_temp.check('the peer''s role kept its rank',
        (SELECT base_preset = 'admin' FROM org.team_roles WHERE id = pg_temp.id('COORD')),
        (SELECT base_preset FROM org.team_roles WHERE id = pg_temp.id('COORD')));
END $$;

SELECT pg_temp.expect('owner may edit the admin-ranked role', pg_temp.id('INES'),
    format($q$SELECT org.upsert_workspace_role('team', %L, %L, 'Probe Coordinators', 'Edited',
        ARRAY['invite_members', 'view_analytics']::org.workspace_capability[], 'admin')$q$,
        pg_temp.id('NOVA'), pg_temp.id('COORD')),
    NULL, NULL);
-- #endregion

-- #region 2. update_workspace_member (IW-M4)
-- Back to a member-ranked seat (the owner may), so the admin outranks the target again.
SELECT pg_temp.expect('owner seats the member back at Member', pg_temp.id('INES'),
    format($q$SELECT org.update_workspace_member('team', %L, jsonb_build_object('role_id', %L))$q$,
        pg_temp.id('AIKO_SEAT'), pg_temp.team_preset(pg_temp.id('NOVA'), 'member')),
    NULL, NULL);

SELECT pg_temp.expect('admin may not move a member into the Admin preset (equal rank)', pg_temp.id('LENA'),
    format($q$SELECT org.update_workspace_member('team', %L, jsonb_build_object('role_id', %L))$q$,
        pg_temp.id('AIKO_SEAT'), pg_temp.team_preset(pg_temp.id('NOVA'), 'admin')),
    '42501', pg_temp.rank_refusal('roleId'));

SELECT pg_temp.expect('admin may not move a member into a custom admin-ranked role', pg_temp.id('LENA'),
    format($q$SELECT org.update_workspace_member('team', %L, jsonb_build_object('role_id', %L))$q$,
        pg_temp.id('AIKO_SEAT'), pg_temp.id('COORD')),
    '42501', pg_temp.rank_refusal('roleId'));

SELECT pg_temp.expect('admin may move a member into the Lead preset', pg_temp.id('LENA'),
    format($q$SELECT org.update_workspace_member('team', %L, jsonb_build_object('role_id', %L))$q$,
        pg_temp.id('AIKO_SEAT'), pg_temp.team_preset(pg_temp.id('NOVA'), 'lead')),
    NULL, NULL);
-- #endregion

-- #region 3. invite_workspace_member (IW-M4)
SELECT pg_temp.expect('lead may not invite into the Lead preset (equal rank)', pg_temp.id('SAM'),
    format($q$SELECT org.invite_workspace_member('team', %L, NULL, 'probe-rank-lead@example.com', %L)$q$,
        pg_temp.id('LOOP'), pg_temp.team_preset(pg_temp.id('LOOP'), 'lead')),
    '42501', pg_temp.rank_refusal('roleId'));

SELECT pg_temp.expect('admin may not invite into the Admin preset (equal rank)', pg_temp.id('HANNAH'),
    format($q$SELECT org.invite_workspace_member('business', %L, NULL, 'probe-rank-admin@example.com', %L)$q$,
        pg_temp.id('HELIA'), pg_temp.business_preset(pg_temp.id('HELIA'), 'admin')),
    '42501', pg_temp.rank_refusal('roleId'));

SELECT pg_temp.expect('admin may invite into the Member preset', pg_temp.id('HANNAH'),
    format($q$SELECT org.invite_workspace_member('business', %L, NULL, 'probe-rank-member@example.com', %L)$q$,
        pg_temp.id('HELIA'), pg_temp.business_preset(pg_temp.id('HELIA'), 'member')),
    NULL, NULL);

-- #endregion

-- #region 4. respond_to_join_request (IW-M4)
WITH r AS (
    INSERT INTO org.org_join_requests (business_id, requester_user_id, business_role_id, status)
    VALUES (pg_temp.id('HELIA'), pg_temp.id('ASKER'),
            pg_temp.business_preset(pg_temp.id('HELIA'), 'admin'), 'pending')
    RETURNING id
)
INSERT INTO probe_ids (k, id) SELECT 'REQ', id FROM r;

SELECT pg_temp.expect('admin may not approve at the role the request asked for (equal rank)',
    pg_temp.id('HANNAH'),
    format($q$SELECT org.respond_to_join_request(%L, true)$q$, pg_temp.id('REQ')),
    '42501', pg_temp.rank_refusal('roleId'));

SELECT pg_temp.expect('admin may not approve at the Admin preset named outright', pg_temp.id('HANNAH'),
    format($q$SELECT org.respond_to_join_request(%L, true, %L)$q$,
        pg_temp.id('REQ'), pg_temp.business_preset(pg_temp.id('HELIA'), 'admin')),
    '42501', pg_temp.rank_refusal('roleId'));

DO $$
BEGIN
    PERFORM pg_temp.check('the refused approval left the request pending',
        (SELECT status = 'pending' FROM org.org_join_requests WHERE id = pg_temp.id('REQ')),
        (SELECT status FROM org.org_join_requests WHERE id = pg_temp.id('REQ')));
END $$;

SELECT pg_temp.expect('admin may approve at the Member preset', pg_temp.id('HANNAH'),
    format($q$SELECT org.respond_to_join_request(%L, true, %L)$q$,
        pg_temp.id('REQ'), pg_temp.business_preset(pg_temp.id('HELIA'), 'member')),
    NULL, NULL);
-- #endregion

-- #region 5. The helper on its own
DO $$
BEGIN
    PERFORM org.fn_assert_role_below(4, 'admin', 'x');
    PERFORM org.fn_assert_role_below(3, 'lead', 'x');
    PERFORM org.fn_assert_role_below(2, 'member', 'x');
    RAISE NOTICE 'PASS fn_assert_role_below passes a role strictly below';
END $$;

DO $$
DECLARE
    v_refused integer := 0;
    v_case record;
BEGIN
    FOR v_case IN SELECT * FROM (VALUES (3, 'admin'), (2, 'lead'), (1, 'member'), (2, 'admin'), (NULL::integer, 'member')) c(r, b) LOOP
        BEGIN
            PERFORM org.fn_assert_role_below(v_case.r, v_case.b, 'x');
        EXCEPTION WHEN insufficient_privilege THEN
            v_refused := v_refused + 1;
        END;
    END LOOP;
    PERFORM pg_temp.check('fn_assert_role_below refuses equal, higher and no seat', v_refused = 5, v_refused::text);
    PERFORM pg_temp.check('fn_assert_role_below is not executable by a client role',
        NOT has_function_privilege('authenticated', 'org.fn_assert_role_below(integer, text, text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'org.fn_assert_role_below(integer, text, text)', 'EXECUTE'),
        'executable');
END $$;
-- #endregion

ROLLBACK;
