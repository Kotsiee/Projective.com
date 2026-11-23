-- =============================================================================================
-- Probe: the earning gate (Decision #196) — finance.fn_assert_payout_ready at every door that lands
-- a gig or seats a team member, and the earnings rule of finance.begin_payout. And where a seller
-- earns without a ticket (Decision #337, ruling M4; FBP DB15): publishing a product or session
-- listing (a blueprint stays free), booking a session or seat (HINT `seller`, no names), switching
-- paid calls on, and every route earnings take into a wallet counting at withdrawal (FCA N14).
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
       -- Not a warned client's project (Decision #486): the Informed Consent is not what this probe tests.
       AND reviews.fn_project_trust_warning(p.id) IS NULL
     ORDER BY p.slug, s.id
     LIMIT 1;

    SELECT fp.user_id INTO v_r FROM org.freelancer_profiles fp
     WHERE finance.fn_freelancer_payout_ready(fp.user_id)
       AND fp.user_id <> v_owner
       AND NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.user_id = fp.user_id)
       AND NOT EXISTS (SELECT 1 FROM projects.projects p
                        WHERE p.owner_user_id = fp.user_id AND p.source_blueprint_id IS NULL)
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

-- #region Readiness that lapses, and comes back (the regions below)
-- A region sets sellers' readiness through pg_temp.set_ready and puts every one of them back with
-- pg_temp.restore_ready before it ends, so no region leaks into the next.
CREATE TEMP TABLE probe_ready (user_id uuid PRIMARY KEY, kyc finance.kyc_status, ready boolean);

CREATE FUNCTION pg_temp.set_ready(p_users uuid[], p_ready boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO probe_ready (user_id, kyc, ready)
    SELECT fp.user_id, fp.kyc_status, fp.payout_ready FROM org.freelancer_profiles fp
     WHERE fp.user_id = ANY (p_users)
    ON CONFLICT (user_id) DO NOTHING;
    SET LOCAL session_replication_role = replica;
    UPDATE org.freelancer_profiles
       SET kyc_status = CASE WHEN p_ready THEN 'verified' ELSE 'pending' END::finance.kyc_status,
           payout_ready = p_ready
     WHERE user_id = ANY (p_users);
    SET LOCAL session_replication_role = origin;
END $$;

CREATE FUNCTION pg_temp.make_unready(p_users uuid[]) RETURNS void LANGUAGE sql AS $$
    SELECT pg_temp.set_ready(p_users, false);
$$;

CREATE FUNCTION pg_temp.restore_ready() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE org.freelancer_profiles fp SET kyc_status = r.kyc, payout_ready = r.ready
      FROM probe_ready r WHERE fp.user_id = r.user_id;
    SET LOCAL session_replication_role = origin;
    DELETE FROM probe_ready;
END $$;
-- #endregion

-- #region Publishing a listing that earns without a ticket (Decision #337, ruling M4)
-- A product or session listing goes on sale only with a payable seller; a team listing only with every
-- shareholder payable; a Pipeline / one-off / direct-deliverable service binds no seller and publishes.
-- Each listing is put back to `draft` with triggers off and its owner (or one shareholder) made unready,
-- then published through catalogue.set_listing_status as its seller, and once by a direct write.
DO $$
DECLARE
    v_product uuid;
    v_product_owner uuid;
    v_session uuid;
    v_session_owner uuid;
    v_blueprint uuid;
    v_blueprint_owner uuid;
    v_team_listing uuid;
    v_team_caller uuid;
    v_team_other uuid;
BEGIN
    -- A team listing whose publisher is payable, with another shareholder to make unready (it may be
    -- one the fixture above already made unready).
    SELECT l.id, l.owner_user_id, s.uid INTO v_team_listing, v_team_caller, v_team_other
      FROM catalogue.listings l
      CROSS JOIN LATERAL finance.fn_team_shareholders(l.owner_team_id) AS s(uid)
     WHERE l.status = 'published' AND l.owner_team_id IS NOT NULL
       AND (l.kind = 'product' OR EXISTS (
            SELECT 1 FROM marketplace.service_blueprints b
             WHERE b.id = l.service_blueprint_id AND b.delivery_model IN ('session', 'group_session')))
       AND s.uid <> l.owner_user_id
       AND finance.fn_freelancer_payout_ready(l.owner_user_id)
     ORDER BY (l.kind = 'service') DESC, l.id, s.uid LIMIT 1;
    -- The personal listings' owners are made unready, so none of them is the team's publisher.
    SELECT l.id, l.owner_user_id INTO v_product, v_product_owner
      FROM catalogue.listings l
     WHERE l.kind = 'product' AND l.status = 'published' AND l.owner_team_id IS NULL
       AND l.owner_user_id IS DISTINCT FROM v_team_caller
     ORDER BY l.id LIMIT 1;
    SELECT l.id, l.owner_user_id INTO v_session, v_session_owner
      FROM catalogue.listings l
      JOIN marketplace.service_blueprints b ON b.id = l.service_blueprint_id
     WHERE l.status = 'published' AND l.owner_team_id IS NULL
       AND b.delivery_model IN ('session', 'group_session')
       AND l.owner_user_id IS DISTINCT FROM v_team_caller
     ORDER BY l.id LIMIT 1;
    SELECT l.id, l.owner_user_id INTO v_blueprint, v_blueprint_owner
      FROM catalogue.listings l
      JOIN marketplace.service_blueprints b ON b.id = l.service_blueprint_id
     WHERE l.status = 'published' AND l.owner_team_id IS NULL
       AND b.delivery_model IN ('pipeline', 'one_off', 'direct_deliverable')
       AND l.owner_user_id IS DISTINCT FROM v_team_caller
     ORDER BY l.id LIMIT 1;
    IF v_product IS NULL OR v_session IS NULL OR v_blueprint IS NULL OR v_team_listing IS NULL THEN
        RAISE EXCEPTION 'FAIL no publish fixture (product %, session %, blueprint %, team listing %) — deno task db:reset',
            v_product, v_session, v_blueprint, v_team_listing;
    END IF;
    INSERT INTO probe_ids (k, id) VALUES
        ('pub_product', v_product), ('pub_product_owner', v_product_owner),
        ('pub_session', v_session), ('pub_session_owner', v_session_owner),
        ('pub_blueprint', v_blueprint), ('pub_blueprint_owner', v_blueprint_owner),
        ('pub_team', v_team_listing), ('pub_team_caller', v_team_caller), ('pub_team_other', v_team_other);

    SET LOCAL session_replication_role = replica;
    UPDATE catalogue.listings SET status = 'draft'
     WHERE id IN (v_product, v_session, v_blueprint, v_team_listing);
    UPDATE marketplace.service_blueprints b SET is_published = false
      FROM catalogue.listings l
     WHERE l.id IN (v_session, v_blueprint, v_team_listing) AND b.id = l.service_blueprint_id;
    SET LOCAL session_replication_role = origin;
    PERFORM pg_temp.make_unready(ARRAY[v_product_owner, v_session_owner, v_blueprint_owner, v_team_other]);
END $$;

SELECT pg_temp.expect_gate('set_listing_status: an unready seller cannot publish a product', pg_temp.id('pub_product_owner'),
    format('SELECT catalogue.set_listing_status(%L, %L)', pg_temp.id('pub_product'), 'published'),
    'self');
SELECT pg_temp.expect_gate('set_listing_status: an unready host cannot publish a session listing', pg_temp.id('pub_session_owner'),
    format('SELECT catalogue.set_listing_status(%L, %L)', pg_temp.id('pub_session'), 'published'),
    'self');
SELECT pg_temp.expect_gate('a direct write cannot publish past the gate either', pg_temp.id('pub_product_owner'),
    format('UPDATE catalogue.listings SET status = %L, published_at = now() WHERE id = %L', 'published', pg_temp.id('pub_product')),
    'self');
DO $$
BEGIN
    IF (SELECT status FROM catalogue.listings WHERE id = pg_temp.id('pub_product')) <> 'draft' THEN
        RAISE EXCEPTION 'FAIL the refused product listing did not stay a draft';
    END IF;
    RAISE NOTICE 'PASS the refused listing stays a draft';
END $$;
SELECT pg_temp.expect_open('set_listing_status: drafting stays free for an unready seller', pg_temp.id('pub_product_owner'),
    format('SELECT catalogue.set_listing_status(%L, %L)', pg_temp.id('pub_product'), 'draft'));
SELECT pg_temp.expect_open('set_listing_status: a blueprint binds no seller, so it publishes', pg_temp.id('pub_blueprint_owner'),
    format('SELECT catalogue.set_listing_status(%L, %L)', pg_temp.id('pub_blueprint'), 'published'));
DO $$
BEGIN
    IF (SELECT status FROM catalogue.listings WHERE id = pg_temp.id('pub_blueprint')) <> 'published' THEN
        RAISE EXCEPTION 'FAIL the blueprint listing did not publish (status %)',
            (SELECT status FROM catalogue.listings WHERE id = pg_temp.id('pub_blueprint'));
    END IF;
    RAISE NOTICE 'PASS the blueprint listing is published';
END $$;
DO $$
DECLARE
    v_detail text;
    v_team uuid := (SELECT owner_team_id FROM catalogue.listings WHERE id = pg_temp.id('pub_team'));
BEGIN
    v_detail := pg_temp.expect_gate('set_listing_status: a team with one unready shareholder cannot publish',
        pg_temp.id('pub_team_caller'),
        format('SELECT catalogue.set_listing_status(%L, %L)', pg_temp.id('pub_team'), 'published'),
        'team');
    PERFORM pg_temp.act(pg_temp.id('pub_team_caller'));
    IF org.is_team_lead(v_team)
       AND v_detail NOT LIKE '%@' || (SELECT username FROM org.users_public WHERE user_id = pg_temp.id('pub_team_other')) || '%' THEN
        RAISE EXCEPTION 'FAIL the team''s publisher was not told who still has to verify (detail "%")', v_detail;
    END IF;
    RAISE NOTICE 'PASS a team lead is told who still has to verify (detail "%")', v_detail;
    PERFORM pg_temp.restore_ready();
END $$;
-- #endregion

-- #region Booking a session or a seat from an unready seller (Decision #337, ruling M4)
-- The backstop to the publish gate, for a seller whose readiness lapsed after publishing: the buyer is
-- refused with HINT `seller` and is shown nobody's handle.
DO $$
DECLARE
    v_cohort uuid;
    v_cohort_host uuid;
    v_session_bp uuid;
    v_session_team uuid;
    v_session_other uuid;
    v_buyer uuid;
    v_payer uuid;
    v_hold uuid;
BEGIN
    SELECT c.id, p.owner_user_id INTO v_cohort, v_cohort_host
      FROM projects.cohorts c
      JOIN projects.projects p ON p.id = c.project_id
     WHERE c.status = 'enrolling' AND p.owner_team_id IS NULL
       AND (c.enrolment_closes_at IS NULL OR c.enrolment_closes_at > now())
       AND c.max_seats - projects.fn_cohort_seats_taken(c.id) - projects.fn_cohort_seats_owed(c.id) >= 2
     ORDER BY c.id LIMIT 1;
    SELECT b.id, b.owner_team_id, s.uid INTO v_session_bp, v_session_team, v_session_other
      FROM marketplace.service_blueprints b
      CROSS JOIN LATERAL finance.fn_team_shareholders(b.owner_team_id) AS s(uid)
     WHERE b.is_published AND b.delivery_model = 'session' AND b.owner_team_id IS NOT NULL
     ORDER BY b.id, s.uid LIMIT 1;
    -- Two adult buyers who host neither and hold no seat on the cohort.
    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE NOT org.fn_is_minor(u.user_id) AND u.user_id IS DISTINCT FROM v_cohort_host
       AND NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.team_id = v_session_team AND m.user_id = u.user_id)
       AND NOT EXISTS (SELECT 1 FROM projects.cohort_memberships cm WHERE cm.cohort_id = v_cohort AND cm.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_payer FROM org.users_public u
     WHERE NOT org.fn_is_minor(u.user_id) AND u.user_id IS DISTINCT FROM v_cohort_host AND u.user_id <> v_buyer
       AND NOT EXISTS (SELECT 1 FROM projects.cohort_memberships cm WHERE cm.cohort_id = v_cohort AND cm.user_id = u.user_id)
     ORDER BY u.user_id DESC LIMIT 1;
    IF v_cohort IS NULL OR v_session_bp IS NULL OR v_buyer IS NULL OR v_payer IS NULL THEN
        RAISE EXCEPTION 'FAIL no booking fixture (cohort %, team session listing %, buyers % %) — deno task db:reset',
            v_cohort, v_session_bp, v_buyer, v_payer;
    END IF;
    INSERT INTO probe_ids (k, id) VALUES ('bk_cohort', v_cohort), ('bk_cohort_host', v_cohort_host),
        ('bk_session_bp', v_session_bp), ('bk_session_other', v_session_other), ('bk_buyer', v_buyer),
        ('bk_payer', v_payer);

    -- A payable host's seat can be held (the gate stays out of the way); then their readiness lapses.
    PERFORM pg_temp.set_ready(ARRAY[v_cohort_host], true);
    PERFORM pg_temp.expect_open('reserve_seat: a payable host''s seat can be held', v_buyer,
        format('SELECT projects.reserve_seat(%L, 1)', v_cohort));
    SET LOCAL session_replication_role = replica;
    INSERT INTO projects.cohort_seat_holds (cohort_id, user_id, seats, expires_at)
    VALUES (v_cohort, v_payer, 1, now() + interval '15 minutes')
    RETURNING id INTO v_hold;
    INSERT INTO probe_ids (k, id) VALUES ('bk_hold', v_hold);
    SET LOCAL session_replication_role = origin;
    PERFORM pg_temp.make_unready(ARRAY[v_cohort_host, v_session_other]);
END $$;

DO $$
DECLARE
    v_detail text;
BEGIN
    v_detail := pg_temp.expect_gate('reserve_seat: a seat cannot be held from an unready host', pg_temp.id('bk_buyer'),
        format('SELECT projects.reserve_seat(%L, 1)', pg_temp.id('bk_cohort')),
        'seller');
    IF v_detail <> '' THEN
        RAISE EXCEPTION 'FAIL the buyer was shown the seller''s side (detail "%")', v_detail;
    END IF;
    v_detail := pg_temp.expect_gate('fn_confirm_seat: a paid hold seats nobody with an unready host', pg_temp.id('bk_payer'),
        format('SELECT projects.fn_confirm_seat(%L, %L, %L, %L, 1000, %L, %L)', pg_temp.id('bk_hold'), pg_temp.id('bk_payer'),
            'user', pg_temp.id('bk_payer'),
            (SELECT p.currency FROM projects.cohorts c JOIN projects.projects p ON p.id = c.project_id WHERE c.id = pg_temp.id('bk_cohort')),
            gen_random_uuid()),
        'seller');
    IF EXISTS (SELECT 1 FROM projects.cohort_memberships
                WHERE cohort_id = pg_temp.id('bk_cohort') AND user_id = pg_temp.id('bk_payer')) THEN
        RAISE EXCEPTION 'FAIL the refused confirmation seated the buyer';
    END IF;
    v_detail := pg_temp.expect_gate('fn_book_session_slot: a team with an unready shareholder takes no 1-1 booking', pg_temp.id('bk_buyer'),
        format('SELECT projects.fn_book_session_slot(%L, %L, %L, %L, 5000, 1, %L, %L, %L, NULL)',
            pg_temp.id('bk_session_bp'), pg_temp.id('bk_buyer'), 'user', pg_temp.id('bk_buyer'),
            (SELECT currency FROM marketplace.service_blueprints WHERE id = pg_temp.id('bk_session_bp')),
            now() + interval '3 days', gen_random_uuid()),
        'seller');
    IF v_detail <> '' THEN
        RAISE EXCEPTION 'FAIL the buyer was shown the team''s members (detail "%")', v_detail;
    END IF;
    RAISE NOTICE 'PASS a buyer refused for the seller''s readiness is shown no one''s handle';
    PERFORM pg_temp.restore_ready();
END $$;
-- #endregion

-- #region Switching paid calls on (Decision #337, ruling M4)
-- Through the owner's Availability editor (scheduling.save_owner_availability) and by a direct write,
-- which the "Manage call settings" policy also allows. Each host starts with paid calls off; keeping
-- them on is never refused.
SELECT pg_temp.expect_open('save_owner_availability: an unready host may offer free calls', pg_temp.id('U'),
    format('SELECT scheduling.save_owner_availability(%L, %L, %L::jsonb)', 'user', pg_temp.id('U'),
        '{"timezone":"Europe/London","published":true,"call":{"accepts_calls":true,"courtesy_enabled":true,"paid_enabled":false}}'));
SELECT pg_temp.expect_gate('save_owner_availability: an unready host cannot switch paid calls on', pg_temp.id('U'),
    format('SELECT scheduling.save_owner_availability(%L, %L, %L::jsonb)', 'user', pg_temp.id('U'),
        '{"timezone":"Europe/London","published":true,"call":{"accepts_calls":true,"paid_enabled":true,"fee_amount_minor":5000,"fee_currency":"GBP"}}'),
    'self');
SELECT pg_temp.expect_gate('a direct write cannot switch paid calls on either', pg_temp.id('U'),
    format('UPDATE scheduling.call_settings SET paid_enabled = true, fee_amount_minor = 5000, fee_currency = %L
             WHERE schedule_id = (SELECT id FROM scheduling.schedules WHERE owner_type = %L AND owner_id = %L)',
        'GBP', 'user', pg_temp.id('U')),
    'self');
DO $$
BEGIN
    IF (SELECT c.paid_enabled FROM scheduling.call_settings c JOIN scheduling.schedules s ON s.id = c.schedule_id
         WHERE s.owner_type = 'user' AND s.owner_id = pg_temp.id('U')) THEN
        RAISE EXCEPTION 'FAIL the unready host''s paid calls are on';
    END IF;
    RAISE NOTICE 'PASS the unready host''s paid calls stay off';
END $$;
SELECT pg_temp.expect_open('save_owner_availability: a payable host switches paid calls off', pg_temp.id('R'),
    format('SELECT scheduling.save_owner_availability(%L, %L, %L::jsonb)', 'user', pg_temp.id('R'),
        '{"timezone":"Europe/London","published":true,"call":{"accepts_calls":true,"courtesy_enabled":true,"paid_enabled":false}}'));
SELECT pg_temp.expect_open('save_owner_availability: a payable host switches paid calls on', pg_temp.id('R'),
    format('SELECT scheduling.save_owner_availability(%L, %L, %L::jsonb)', 'user', pg_temp.id('R'),
        '{"timezone":"Europe/London","published":true,"call":{"accepts_calls":true,"paid_enabled":true,"fee_amount_minor":5000,"fee_currency":"GBP"}}'));
DO $$
BEGIN
    IF NOT (SELECT c.paid_enabled FROM scheduling.call_settings c JOIN scheduling.schedules s ON s.id = c.schedule_id
             WHERE s.owner_type = 'user' AND s.owner_id = pg_temp.id('R')) THEN
        RAISE EXCEPTION 'FAIL the payable host''s paid calls are not on';
    END IF;
    PERFORM pg_temp.make_unready(ARRAY[pg_temp.id('R')]);
END $$;
SELECT pg_temp.expect_open('save_owner_availability: paid calls already on stay on when readiness lapses', pg_temp.id('R'),
    format('SELECT scheduling.save_owner_availability(%L, %L, %L::jsonb)', 'user', pg_temp.id('R'),
        '{"timezone":"Europe/London","published":true,"call":{"accepts_calls":true,"paid_enabled":true,"fee_amount_minor":6000,"fee_currency":"GBP"}}'));
DO $$
BEGIN
    IF (SELECT c.fee_amount_minor FROM scheduling.call_settings c JOIN scheduling.schedules s ON s.id = c.schedule_id
         WHERE s.owner_type = 'user' AND s.owner_id = pg_temp.id('R')) <> 6000 THEN
        RAISE EXCEPTION 'FAIL the re-save with paid calls on did not land';
    END IF;
    RAISE NOTICE 'PASS a host whose paid calls are on can still edit them';
    PERFORM pg_temp.restore_ready();
END $$;
-- #endregion

-- #region Withdrawing: every route earnings take into a wallet counts (FCA N14)
-- A 0-day window credits at once and writes no pending row; a team distribution and a transfer in from
-- an earning wallet never had one. Each now needs a payout-ready withdrawer. A transfer in of money that
-- was never earned, like a refund, still needs no ID.
DO $$
DECLARE
    v_u uuid := pg_temp.id('U');
    v_escrow uuid;
    v_zero uuid;
    v_dist uuid;
    v_earner uuid;
    v_fed uuid;
    v_source uuid;
    v_plain uuid;
    v_business uuid := gen_random_uuid();
    v_days jsonb;
    v_state text;
    v_msg text;
    r record;
BEGIN
    SELECT e.id INTO v_escrow FROM finance.escrows e ORDER BY e.created_at LIMIT 1;
    IF v_escrow IS NULL THEN
        RAISE EXCEPTION 'FAIL no seeded escrow to key an earned credit to — deno task db:reset';
    END IF;
    SET LOCAL session_replication_role = replica;
    DELETE FROM finance.wallets
     WHERE owner_id = v_u AND currency IN ('CHF', 'SGD', 'ZAR', 'INR')
       AND NOT EXISTS (SELECT 1 FROM finance.transactions t WHERE t.wallet_id = finance.wallets.id);
    INSERT INTO finance.wallets (owner_type, owner_id, currency, balance_cents) VALUES
        ('user', v_u, 'CHF', 0), ('user', v_u, 'SGD', 0), ('freelancer', v_u, 'ZAR', 0), ('user', v_u, 'ZAR', 0),
        ('business', v_business, 'INR', 0), ('user', v_u, 'INR', 0)
    ON CONFLICT (owner_type, owner_id, currency) DO NOTHING;
    SET LOCAL session_replication_role = origin;
    SELECT id INTO v_zero FROM finance.wallets WHERE owner_type = 'user' AND owner_id = v_u AND currency = 'CHF';
    SELECT id INTO v_dist FROM finance.wallets WHERE owner_type = 'user' AND owner_id = v_u AND currency = 'SGD';
    SELECT id INTO v_earner FROM finance.wallets WHERE owner_type = 'freelancer' AND owner_id = v_u AND currency = 'ZAR';
    SELECT id INTO v_fed FROM finance.wallets WHERE owner_type = 'user' AND owner_id = v_u AND currency = 'ZAR';
    SELECT id INTO v_source FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v_business AND currency = 'INR';
    SELECT id INTO v_plain FROM finance.wallets WHERE owner_type = 'user' AND owner_id = v_u AND currency = 'INR';

    -- A 0-day window: the share is credited at once, with no pending row.
    SELECT value INTO v_days FROM security.platform_params WHERE key = 'pending_release_days';
    UPDATE security.platform_params SET value = '0'::jsonb WHERE key = 'pending_release_days';
    PERFORM finance.fn_wallet_credit_pending(v_u, 'user', 'CHF', 500, 'team_split', 'escrows', v_escrow);
    UPDATE security.platform_params SET value = v_days WHERE key = 'pending_release_days';
    IF EXISTS (SELECT 1 FROM finance.pending_releases WHERE wallet_id = v_zero) THEN
        RAISE EXCEPTION 'FAIL the 0-day credit wrote a pending row, so this case proves nothing';
    END IF;
    -- A team distribution, credited straight to the member's wallet.
    PERFORM finance.fn_wallet_credit(v_u, 'user', 'SGD', 500, 'team_distribution', 'team_distribution', gen_random_uuid());
    -- A transfer in from the person's freelancer wallet, which holds a share still clearing.
    INSERT INTO finance.pending_releases (escrow_id, wallet_id, reason, amount_cents, currency, available_at)
    VALUES (v_escrow, v_earner, 'escrow_release', 500, 'ZAR', now() + interval '7 days');
    PERFORM finance.fn_wallet_credit(v_u, 'freelancer', 'ZAR', 500, 'topup', NULL, NULL);
    PERFORM finance.fn_wallet_debit(v_u, 'freelancer', 'ZAR', 500, 'transfer_out', 'wallets', v_fed);
    PERFORM finance.fn_wallet_credit(v_u, 'user', 'ZAR', 500, 'transfer_in', 'wallets', v_earner);
    -- A transfer in of money nobody earned: a business wallet's top-up.
    PERFORM finance.fn_wallet_credit(v_business, 'business', 'INR', 500, 'topup', NULL, NULL);
    PERFORM finance.fn_wallet_debit(v_business, 'business', 'INR', 500, 'transfer_out', 'wallets', v_plain);
    PERFORM finance.fn_wallet_credit(v_u, 'user', 'INR', 500, 'transfer_in', 'wallets', v_source);

    FOR r IN SELECT * FROM (VALUES
        (v_zero, 'CHF', 'a 0-day credit'), (v_dist, 'SGD', 'a team distribution'),
        (v_fed, 'ZAR', 'a transfer in from an earning wallet')) AS c(wallet, currency, label)
    LOOP
        v_state := NULL;
        PERFORM pg_temp.act(v_u);
        BEGIN
            PERFORM finance.begin_payout(r.wallet, 100, r.currency, false, 'payout-gate-probe-' || md5(random()::text));
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        END;
        IF v_state IS DISTINCT FROM 'PK403' OR v_msg NOT LIKE '%money you earned%' THEN
            RAISE EXCEPTION 'FAIL % skipped the withdrawal earnings gate (% %)', r.label, v_state, v_msg;
        END IF;
        RAISE NOTICE 'PASS % needs a payout-ready withdrawer (PK403)', r.label;
    END LOOP;

    v_state := NULL;
    PERFORM pg_temp.act(v_u);
    BEGIN
        PERFORM finance.begin_payout(v_plain, 100, 'INR', false, 'payout-gate-probe-' || md5(random()::text));
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_state = 'PK403' THEN
        RAISE EXCEPTION 'FAIL a transfer in of money nobody earned needed ID to withdraw: %', v_msg;
    END IF;
    RAISE NOTICE 'PASS a transfer in of money nobody earned withdraws without ID (door answered %)', COALESCE(v_state, 'ok');
END $$;
-- #endregion

-- #region Client roles cannot reach the gate's parts
DO $$
DECLARE
    v_fn text;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'finance.fn_team_shareholders(uuid)', 'finance.fn_assert_payout_ready(text, uuid)',
        'finance.fn_assert_seller_payout_ready(text, uuid)',
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
