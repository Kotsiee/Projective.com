-- =============================================================================================
-- Probe: the earning gate (Decision #196) — finance.fn_assert_payout_ready at every door that lands
-- a gig or seats a team member, and the earnings rule of finance.begin_payout.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/payout_ready_gate.sql
--
-- Fixture (seeded data, adjusted inside the transaction with triggers off): two unbooked payout-ready
-- freelancers R and U outside every team, U then made unready; a live stage S of a public project
-- owned by O; a ticket T on a stage no team holds; a seeded team TM whose non-owner shareholder X is
-- made unready. The doors run first, so on a database without the gate the first case fails — that is
-- the defect this probe reproduces. A clean run prints only PASS (and SKIP) notices.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid, txt text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Run p_sql as p_actor; it must be refused by the gate (PK403 `payout_not_ready:`) with HINT p_hint.
-- Returns the refusal's DETAIL.
CREATE FUNCTION pg_temp.expect_gate(p_label text, p_actor uuid, p_sql text, p_hint text)
RETURNS text LANGUAGE plpgsql AS $$
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
        RAISE EXCEPTION 'FAIL % — accepted; the earning gate did not run', p_label;
    END IF;
    IF v_state <> 'PK403' OR v_msg NOT LIKE 'payout_not_ready:%' THEN
        RAISE EXCEPTION 'FAIL % — refused % "%" instead of the earning gate', p_label, v_state, v_msg;
    END IF;
    IF v_hint IS DISTINCT FROM p_hint THEN
        RAISE EXCEPTION 'FAIL % — hint "%" (expected "%")', p_label, v_hint, p_hint;
    END IF;
    RAISE NOTICE 'PASS % (PK403 payout_not_ready, hint %)', p_label, v_hint;
    RETURN v_detail;
END $$;

-- Run p_sql as p_actor; the earning gate must NOT refuse it (any other outcome is the door's own).
CREATE FUNCTION pg_temp.expect_open(p_label text, p_actor uuid, p_sql text)
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
    IF v_state = 'PK403' AND v_msg LIKE 'payout_not_ready:%' THEN
        RAISE EXCEPTION 'FAIL % — the earning gate refused a payable person', p_label;
    END IF;
    RAISE NOTICE 'PASS % (not gated%)', p_label,
        CASE WHEN v_state IS NULL THEN '' ELSE '; the door answered ' || v_state || ' ' || left(v_msg, 80) END;
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_r uuid;
    v_u uuid;
    v_x uuid;
    v_team uuid;
    v_lead uuid;
    v_project uuid;
    v_slug text;
    v_stage uuid;
    v_stage_slug text;
    v_owner uuid;
    v_ticket uuid;
    v_ticket_owner uuid;
    v_seat uuid;
    v_link uuid;
    v_token text;
BEGIN
    SELECT t.id, t.owner_user_id, ca.member_user_id INTO v_team, v_lead, v_x
      FROM org.teams t
      JOIN finance.contribution_agreements ca ON ca.team_id = t.id AND ca.percent_bp > 0
      JOIN org.team_members tm ON tm.team_id = t.id AND tm.user_id = ca.member_user_id AND tm.status = 'active'
     WHERE ca.member_user_id <> t.owner_user_id
       AND (SELECT count(*) FROM org.team_members m WHERE m.team_id = t.id AND m.status = 'active') >= 2
       AND finance.fn_freelancer_payout_ready(t.owner_user_id)
     ORDER BY t.slug, ca.member_user_id
     LIMIT 1;

    SELECT p.id, p.slug, s.id, s.slug, p.owner_user_id
      INTO v_project, v_slug, v_stage, v_stage_slug, v_owner
      FROM projects.projects p
      JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.status = 'active' AND p.visibility = 'public'
       AND p.owner_team_id IS DISTINCT FROM v_team
       AND s.status = 'open' AND s.hire_trigger_active AND s.archived_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.team_id = v_team AND m.user_id = p.owner_user_id)
     ORDER BY p.slug, s.id
     LIMIT 1;

    SELECT fp.user_id INTO v_r FROM org.freelancer_profiles fp
     WHERE finance.fn_freelancer_payout_ready(fp.user_id)
       AND fp.user_id <> v_owner
       AND NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.user_id = fp.user_id)
       AND NOT EXISTS (SELECT 1 FROM projects.projects p WHERE p.owner_user_id = fp.user_id)
       AND NOT EXISTS (SELECT 1 FROM projects.stage_assignments sa
                        WHERE sa.freelancer_profile_id = fp.user_id
                          AND sa.status NOT IN ('released', 'cancelled', 'declined', 'completed'))
     ORDER BY fp.user_id LIMIT 1;
    SELECT fp.user_id INTO v_u FROM org.freelancer_profiles fp
     WHERE finance.fn_freelancer_payout_ready(fp.user_id)
       AND fp.user_id NOT IN (v_owner, v_r)
       AND NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.user_id = fp.user_id)
       AND NOT EXISTS (SELECT 1 FROM projects.project_participants pp
                        WHERE pp.project_id = v_project AND pp.profile_id = fp.user_id)
     ORDER BY fp.user_id DESC LIMIT 1;

    SELECT t.id, p.owner_user_id INTO v_ticket, v_ticket_owner
      FROM projects.tickets t
      JOIN projects.projects p ON p.id = t.project_id
     WHERE t.current_assignee_id IS NULL AND t.current_stage_id IS NOT NULL
       AND t.description IS NOT NULL AND t.description <> '{}'::jsonb
       AND p.status = 'active' AND p.owner_user_id NOT IN (v_r, v_u)
       AND NOT EXISTS (SELECT 1 FROM projects.stage_assignments sa
                        WHERE sa.project_stage_id = t.current_stage_id AND sa.assignee_type = 'team'
                          AND sa.status = 'accepted')
     ORDER BY t.id LIMIT 1;

    IF v_team IS NULL OR v_project IS NULL OR v_r IS NULL OR v_u IS NULL OR v_ticket IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (team %, project %, R %, U %, ticket %) — deno task db:reset',
            v_team, v_project, v_r, v_u, v_ticket;
    END IF;

    INSERT INTO probe_ids (k, id, txt) VALUES
        ('R', v_r, NULL), ('U', v_u, NULL), ('X', v_x, (SELECT username FROM org.users_public WHERE user_id = v_x)),
        ('team', v_team, NULL), ('lead', v_lead, NULL), ('project', v_project, v_slug), ('stage', v_stage, v_stage_slug),
        ('owner', v_owner, NULL), ('ticket', v_ticket, NULL), ('ticket_owner', v_ticket_owner, NULL);

    SET LOCAL session_replication_role = replica;
    UPDATE org.freelancer_profiles SET kyc_status = 'pending', payout_ready = false WHERE user_id IN (v_u, v_x);

    INSERT INTO projects.stage_open_seats (project_stage_id, description_of_need)
    VALUES (v_stage, 'Payout gate probe seat')
    RETURNING id INTO v_seat;
    INSERT INTO probe_ids (k, id) VALUES ('seat', v_seat);

    UPDATE projects.stage_invite_links SET status = 'revoked', revoked_at = now(), revoked_by = v_owner
     WHERE project_stage_id = v_stage AND status = 'active';
    INSERT INTO projects.stage_invite_links (project_id, project_stage_id, token, created_by)
    VALUES (v_project, v_stage, substr(md5(random()::text), 1, 24), v_owner)
    RETURNING id, token INTO v_link, v_token;
    INSERT INTO probe_ids (k, id, txt) VALUES ('link', v_link, v_token);

    WITH a AS (
        INSERT INTO projects.project_applications
            (project_id, applicant_user_id, applicant_type, applicant_profile_id, status)
        VALUES (v_project, v_lead, 'team', v_team, 'pending')
        RETURNING id, applicant_type
    ), t AS (
        INSERT INTO projects.project_application_targets (application_id, target_type, target_id)
        SELECT a.id, 'stage', v_stage FROM a RETURNING application_id
    )
    INSERT INTO probe_ids (k, id)
    SELECT 'app_' || a.applicant_type, a.id FROM a;

    INSERT INTO org.org_invitations (inviter_user_id, target_user_id, team_id, team_role_id, token, status, expires_at)
    SELECT v_lead, v_u, v_team, r.id, md5(random()::text || 'team'), 'pending', now() + interval '14 days'
      FROM org.team_roles r WHERE r.team_id = v_team AND r.preset = 'member'
     LIMIT 1;
    INSERT INTO probe_ids (k, id)
    SELECT 'team_inv', i.id FROM org.org_invitations i
     WHERE i.team_id = v_team AND i.target_user_id = v_u AND i.status = 'pending'
     ORDER BY i.created_at DESC LIMIT 1;
    SET LOCAL session_replication_role = origin;

    RAISE NOTICE 'fixture: team % (X @%), project %/% (owner %), R %, U %, ticket %',
        v_team, (SELECT txt FROM probe_ids WHERE k = 'X'), v_slug, v_stage_slug, v_owner, v_r, v_u, v_ticket;
END $$;
-- #endregion

-- #region Landing a gig — the person's own doors
SELECT pg_temp.expect_gate('apply_to_project: an unready freelancer cannot apply', pg_temp.id('U'),
    format('SELECT projects.apply_to_project(%L, %L)',
        (SELECT txt FROM probe_ids WHERE k = 'project'), (SELECT txt FROM probe_ids WHERE k = 'stage')),
    'self');
SELECT pg_temp.expect_open('apply_to_project: a payout-ready freelancer can', pg_temp.id('R'),
    format('SELECT projects.apply_to_project(%L, %L)',
        (SELECT txt FROM probe_ids WHERE k = 'project'), (SELECT txt FROM probe_ids WHERE k = 'stage')));
SELECT pg_temp.expect_gate('apply_to_seat: an unready freelancer cannot apply to a seat', pg_temp.id('U'),
    format('SELECT projects.apply_to_seat(%L, %L, %L)', pg_temp.id('seat'), 'freelancer', pg_temp.id('U')),
    'self');
SELECT pg_temp.expect_gate('redeem_invite_link: an unready freelancer cannot ask to join', pg_temp.id('U'),
    format('SELECT projects.redeem_invite_link(%L)', (SELECT txt FROM probe_ids WHERE k = 'link')),
    'self');
DO $$
BEGIN
    SET LOCAL session_replication_role = replica;
    WITH i AS (
        INSERT INTO projects.project_invitations
            (project_id, project_stage_id, target_user_id, role, inviter_user_id, token, status, expires_at)
        VALUES
            (pg_temp.id('project'), pg_temp.id('stage'), pg_temp.id('U'), 'freelancer', pg_temp.id('owner'),
             md5(random()::text || 'f'), 'pending', now() + interval '14 days'),
            (pg_temp.id('project'), NULL, pg_temp.id('U'), 'manager', pg_temp.id('owner'),
             md5(random()::text || 'm'), 'pending', now() + interval '14 days')
        RETURNING id, role
    )
    INSERT INTO probe_ids (k, id) SELECT 'inv_' || i.role, i.id FROM i;
    SET LOCAL session_replication_role = origin;
END $$;
SELECT pg_temp.expect_gate('respond_to_project_invitation: an unready freelancer cannot accept work', pg_temp.id('U'),
    format('SELECT projects.respond_to_project_invitation(%L, true)', pg_temp.id('inv_freelancer')),
    'self');
DO $$
BEGIN
    IF (SELECT status FROM projects.project_invitations WHERE id = pg_temp.id('inv_freelancer')) <> 'pending' THEN
        RAISE EXCEPTION 'FAIL the refused invitation did not stay pending';
    END IF;
    RAISE NOTICE 'PASS the refused invitation stays pending';
END $$;
SELECT pg_temp.expect_open('respond_to_project_invitation: a manager invitation is not paid work', pg_temp.id('U'),
    format('SELECT projects.respond_to_project_invitation(%L, true)', pg_temp.id('inv_manager')));
SELECT pg_temp.expect_open('respond_to_project_invitation: declining is never gated', pg_temp.id('U'),
    format('SELECT projects.respond_to_project_invitation(%L, false)', pg_temp.id('inv_freelancer')));
-- #endregion

-- #region Landing a gig — the owner's doors
DO $$
DECLARE
    v_app uuid;
BEGIN
    SET LOCAL session_replication_role = replica;
    INSERT INTO projects.project_applications (project_id, applicant_user_id, applicant_type, applicant_profile_id, status)
    VALUES (pg_temp.id('project'), pg_temp.id('U'), 'freelancer', pg_temp.id('U'), 'pending')
    RETURNING id INTO v_app;
    INSERT INTO projects.project_application_targets (application_id, target_type, target_id)
    VALUES (v_app, 'stage', pg_temp.id('stage'));
    INSERT INTO probe_ids (k, id) VALUES ('app_freelancer', v_app);
    SET LOCAL session_replication_role = origin;
END $$;
SELECT pg_temp.expect_gate('assign_from_application: the owner cannot seat an unready freelancer', pg_temp.id('owner'),
    format('SELECT projects.assign_from_application(%L)', pg_temp.id('app_freelancer')),
    'other');
SELECT pg_temp.expect_gate('assign_ticket_manual: the owner cannot pin an unready freelancer', pg_temp.id('ticket_owner'),
    format('SELECT projects.assign_ticket_manual(%L, %L)', pg_temp.id('ticket'), pg_temp.id('U')),
    'other');
DO $$
BEGIN
    IF projects.fn_ticket_assignee_payout_ready(pg_temp.id('ticket'), pg_temp.id('U'))
       OR NOT projects.fn_ticket_assignee_payout_ready(pg_temp.id('ticket'), pg_temp.id('R')) THEN
        RAISE EXCEPTION 'FAIL fn_ticket_assignee_payout_ready misjudged U/R on a freelancer stage';
    END IF;
    RAISE NOTICE 'PASS the routing loops'' predicate skips U and keeps R on a freelancer stage';
END $$;
SELECT pg_temp.expect_open('assign_ticket_manual: a payout-ready freelancer can be pinned', pg_temp.id('ticket_owner'),
    format('SELECT projects.assign_ticket_manual(%L, %L)', pg_temp.id('ticket'), pg_temp.id('R')));
-- #endregion

-- #region Teams
SELECT pg_temp.expect_gate('create_workspace: an unready freelancer cannot create a team', pg_temp.id('U'),
    format('SELECT org.create_workspace(%L, %L, %L)', 'team', 'Payout probe team', 'payoutprobe' || substr(md5(random()::text), 1, 8)),
    'self');
SELECT pg_temp.expect_open('create_workspace: a business is not gated', pg_temp.id('U'),
    format('SELECT org.create_workspace(%L, %L, %L)', 'business', 'Payout probe co', 'payoutprobeco' || substr(md5(random()::text), 1, 8)));
SELECT pg_temp.expect_open('create_workspace: a payout-ready freelancer can create a team', pg_temp.id('R'),
    format('SELECT org.create_workspace(%L, %L, %L)', 'team', 'Payout probe team', 'payoutprober' || substr(md5(random()::text), 1, 8)));
SELECT pg_temp.expect_gate('respond_to_workspace_invitation: an unready freelancer cannot join a team', pg_temp.id('U'),
    format('SELECT org.respond_to_workspace_invitation(%L, true)', pg_temp.id('team_inv')),
    'self');

DO $$
DECLARE
    v_detail text;
BEGIN
    v_detail := pg_temp.expect_gate('apply_to_project: a team with an unready shareholder cannot apply', pg_temp.id('lead'),
        format('SELECT projects.apply_to_project(%L, %L, NULL, NULL, %L)',
            (SELECT txt FROM probe_ids WHERE k = 'project'), (SELECT txt FROM probe_ids WHERE k = 'stage'), pg_temp.id('team')),
        'team');
    IF v_detail NOT LIKE '%@' || (SELECT txt FROM probe_ids WHERE k = 'X') || '%' THEN
        RAISE EXCEPTION 'FAIL the team lead was not told who still has to verify (detail "%")', v_detail;
    END IF;
    RAISE NOTICE 'PASS the team lead is told who still has to verify (%)', v_detail;

    v_detail := pg_temp.expect_gate('assign_from_application: the owner cannot seat a team with an unready shareholder',
        pg_temp.id('owner'), format('SELECT projects.assign_from_application(%L)', pg_temp.id('app_team')), 'team');
    IF v_detail <> '' THEN
        RAISE EXCEPTION 'FAIL the project owner was shown the team''s members (detail "%")', v_detail;
    END IF;
    RAISE NOTICE 'PASS the project owner is not shown the team''s members';
END $$;

DO $$
DECLARE
    v_ticket uuid := pg_temp.id('ticket');
BEGIN
    SET LOCAL session_replication_role = replica;
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, team_id, assigned_by, status)
    SELECT t.current_stage_id, 'team', pg_temp.id('team'), pg_temp.id('ticket_owner'), 'accepted'
      FROM projects.tickets t WHERE t.id = v_ticket;
    SET LOCAL session_replication_role = origin;
    IF NOT projects.fn_ticket_assignee_payout_ready(v_ticket, pg_temp.id('U')) THEN
        RAISE EXCEPTION 'FAIL a claim on a team-held stage was re-gated (grandfathered teams keep working)';
    END IF;
    RAISE NOTICE 'PASS a claim on a team-held stage is not re-gated (the team was cleared when seated)';
END $$;
-- #endregion

-- #region Withdrawing earnings from a user wallet
DO $$
DECLARE
    v_u uuid := pg_temp.id('U');
    v_wallet uuid;
    v_escrow uuid;
    v_state text;
    v_msg text;
BEGIN
    SET LOCAL session_replication_role = replica;
    DELETE FROM finance.wallets WHERE owner_type = 'user' AND owner_id = v_u AND currency = 'USD';
    INSERT INTO finance.wallets (owner_type, owner_id, currency, balance_cents)
    VALUES ('user', v_u, 'USD', 5000) RETURNING id INTO v_wallet;
    SET LOCAL session_replication_role = origin;

    PERFORM pg_temp.act(v_u);
    BEGIN
        PERFORM finance.begin_payout(v_wallet, 100, 'USD', false, 'payout-gate-probe-' || md5(random()::text));
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_state = 'PK403' THEN
        RAISE EXCEPTION 'FAIL a refund-only user wallet needed ID to withdraw: %', v_msg;
    END IF;
    RAISE NOTICE 'PASS a user wallet without earnings withdraws without ID (door answered %)', COALESCE(v_state, 'ok');

    SELECT e.id INTO v_escrow FROM finance.escrows e ORDER BY e.created_at LIMIT 1;
    IF v_escrow IS NULL THEN
        RAISE NOTICE 'SKIP the earnings case: no seeded escrow to attribute a pending release to';
        RETURN;
    END IF;
    SET LOCAL session_replication_role = replica;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'finance' AND table_name = 'pending_releases' AND column_name = 'reason') THEN
        EXECUTE 'INSERT INTO finance.pending_releases (escrow_id, wallet_id, reason, amount_cents, currency, available_at)
                 VALUES ($1, $2, ''team_split'', 100, ''USD'', now() + interval ''7 days'')' USING v_escrow, v_wallet;
    ELSE
        EXECUTE 'INSERT INTO finance.pending_releases (escrow_id, wallet_id, amount_cents, currency, available_at)
                 VALUES ($1, $2, 100, ''USD'', now() + interval ''7 days'')' USING v_escrow, v_wallet;
    END IF;
    SET LOCAL session_replication_role = origin;

    v_state := NULL;
    PERFORM pg_temp.act(v_u);
    BEGIN
        PERFORM finance.begin_payout(v_wallet, 100, 'USD', false, 'payout-gate-probe-' || md5(random()::text));
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_state IS DISTINCT FROM 'PK403' OR v_msg NOT LIKE '%money you earned%' THEN
        RAISE EXCEPTION 'FAIL a user wallet holding earnings let an unverified person withdraw (% %)', v_state, v_msg;
    END IF;
    RAISE NOTICE 'PASS a user wallet holding earnings needs a payout-ready withdrawer (PK403)';
END $$;
-- #endregion

-- #region Client roles cannot reach the gate's parts
DO $$
DECLARE
    v_fn text;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'finance.fn_team_shareholders(uuid)', 'finance.fn_assert_payout_ready(text, uuid)',
        'finance.fn_wallet_holds_earnings(uuid)', 'projects.fn_ticket_assignee_payout_ready(uuid, uuid)'
    ] LOOP
        IF has_function_privilege('authenticated', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION 'FAIL % is executable by a client role', v_fn;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS the gate''s parts are not client-callable';
END $$;
-- #endregion

ROLLBACK;
