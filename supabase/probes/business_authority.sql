-- =============================================================================================
-- Probe: one capability per act on a business project (BUSINESSES_AUDIT BF13, BF14, BF15, BF23,
-- §4.2; work order BB2). Hiring, assigning and every review that releases escrow need `hire`;
-- billing a new project to the business needs `manage_projects`; a business basket order needs
-- `purchase` on top of vault `spend`; funding escrow is projects.fn_can_fund_project (vault `spend`
-- on the business wallet), not has_project_access. Reads keep can_review_project (Decision #163).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/business_authority.sql
--
-- Fixture (seeded data, adjusted inside the transaction): Helia Finance (`heliafinance`, KYB verified)
-- with its owner Priya and admin Hannah; Noor joins on the `member` preset and Theo on a custom
-- "Finance" role holding only `spend_funds`. The business project is "Helia wallet redesign" (owned by
-- Hannah): a pending application, a submission awaiting review, a funded ticket in progress and an
-- unfunded one. The project-owner case is Atlas Labs' "Loop mobile app", created by Miguel, whose
-- extra `hire` / `manage_projects` grants are taken away first — he keeps the project's authority as
-- its owner. Every door runs in a subtransaction that is always rolled back; a clean run prints only
-- PASS notices, and any FAIL aborts the run at the end.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);
CREATE TEMP TABLE probe_fails (label text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.fail(p_label text, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO probe_fails VALUES (p_label);
    RAISE NOTICE 'FAIL % — %', p_label, p_why;
END $$;

-- Run p_sql as p_actor in a subtransaction that is always rolled back. Returns ('ok', NULL) when the
-- door completed, else the refusal's SQLSTATE and message.
CREATE FUNCTION pg_temp.attempt(p_actor uuid, p_sql text, OUT state text, OUT message text)
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_actor);
    BEGIN
        EXECUTE p_sql;
        RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'P9999';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = 'P9999' THEN
            state := 'ok';
        ELSE
            state := SQLSTATE;
            message := SQLERRM;
        END IF;
    END;
END $$;

-- An authority refusal: the typed BB2 refusal, or the generic privilege refusal a door raises before
-- it reaches its business rules. A downstream refusal (payout readiness, funding, state) means the
-- caller got PAST authority, which is what "may" asserts.
CREATE FUNCTION pg_temp.is_authority_refusal(p_state text, p_message text) RETURNS boolean
LANGUAGE sql AS $$
    SELECT (p_state = 'PK403' AND p_message LIKE 'missing_permission:%')
        OR (p_state = 'PK403' AND p_message LIKE 'not_funder:%')
        OR p_state = '42501';
$$;

-- p_actor must be refused by authority with exactly p_expect (a message prefix).
CREATE FUNCTION pg_temp.expect_refused(p_label text, p_actor uuid, p_sql text, p_expect text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    SELECT * INTO r FROM pg_temp.attempt(p_actor, p_sql);
    IF r.state = 'PK403' AND r.message LIKE p_expect || '%' THEN
        RAISE NOTICE 'PASS % — refused: %', p_label, r.message;
    ELSE
        PERFORM pg_temp.fail(p_label, format('expected PK403 %s…, got %s %s', p_expect, r.state, COALESCE(r.message, '')));
    END IF;
END $$;

-- p_actor must get past authority (the door may still refuse on a later business rule).
CREATE FUNCTION pg_temp.expect_allowed(p_label text, p_actor uuid, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    SELECT * INTO r FROM pg_temp.attempt(p_actor, p_sql);
    IF pg_temp.is_authority_refusal(r.state, COALESCE(r.message, '')) THEN
        PERFORM pg_temp.fail(p_label, format('expected past authority, got %s %s', r.state, r.message));
    ELSE
        RAISE NOTICE 'PASS % — %', p_label, CASE WHEN r.state = 'ok' THEN 'completed' ELSE r.state || ' ' || r.message END;
    END IF;
END $$;
-- #endregion

-- #region Fixture
INSERT INTO probe_ids
SELECT 'helia', id FROM org.business_profiles WHERE slug = 'heliafinance'
UNION ALL SELECT 'atlas', id FROM org.business_profiles WHERE slug = 'atlaslabs'
UNION ALL SELECT 'priya', user_id FROM org.users_public WHERE username = 'priyaraman'
UNION ALL SELECT 'hannah', user_id FROM org.users_public WHERE username = 'hannahcole'
UNION ALL SELECT 'noor', user_id FROM org.users_public WHERE username = 'noor'
UNION ALL SELECT 'theo', user_id FROM org.users_public WHERE username = 'theo'
UNION ALL SELECT 'miguel', user_id FROM org.users_public WHERE username = 'miguelsantos'
UNION ALL SELECT 'maris', user_id FROM org.users_public WHERE username = 'marisdelacroix'
UNION ALL SELECT 'aiko', user_id FROM org.users_public WHERE username = 'aikotanaka'
UNION ALL SELECT 'project', id FROM projects.projects WHERE slug = 'prj-6ndtxa9u9x'
UNION ALL SELECT 'loop', id FROM projects.projects WHERE slug = 'prj-67o7d44y6x';

INSERT INTO probe_ids
SELECT 'stage_live', ps.id FROM projects.project_stages ps
 WHERE ps.project_id = pg_temp.id('project') AND ps.name = 'Discovery and research'
UNION ALL
SELECT 'stage_open', ps.id FROM projects.project_stages ps
 WHERE ps.project_id = pg_temp.id('project') AND ps.name = 'UX and flows'
UNION ALL
SELECT 'application', pa.id FROM projects.project_applications pa
 WHERE pa.project_id = pg_temp.id('project') AND pa.status = 'pending'
UNION ALL
SELECT 'loop_application', (SELECT pa.id FROM projects.project_applications pa
 WHERE pa.project_id = pg_temp.id('loop') AND pa.status = 'pending' ORDER BY pa.id LIMIT 1)
UNION ALL
SELECT 'submission', ss.id FROM projects.stage_submissions ss
  JOIN projects.project_stages ps ON ps.id = ss.project_stage_id
 WHERE ps.project_id = pg_temp.id('project') AND ss.status = 'pending_review'
UNION ALL
SELECT 'ticket_live', t.id FROM projects.tickets t
 WHERE t.project_id = pg_temp.id('project') AND t.status = 'in_progress'
UNION ALL
SELECT 'ticket_unfunded', t.id FROM projects.tickets t
 WHERE t.project_id = pg_temp.id('project') AND t.status = 'todo'
UNION ALL
SELECT 'maris_participant', pp.id FROM projects.project_participants pp
 WHERE pp.project_id = pg_temp.id('project') AND pp.profile_id = pg_temp.id('maris')
UNION ALL
SELECT 'basket', b.id FROM finance.baskets b
 WHERE b.owner_type = 'business' AND b.owner_id = pg_temp.id('helia') AND b.is_default;

DO $$
DECLARE
    v_missing text;
BEGIN
    SELECT string_agg(k, ', ') INTO v_missing FROM probe_ids WHERE id IS NULL;
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'probe fixture missing: %', v_missing;
    END IF;
END $$;

-- Noor on the `member` preset; Theo on a custom spend-only "Finance" role. The vault projection
-- triggers give Theo `spend` on the Helia wallet and Noor only `add_funds` + `view`.
WITH r AS (
    INSERT INTO org.business_roles (business_id, name, summary, preset, base_preset, capabilities)
    VALUES (pg_temp.id('helia'), 'Finance', 'Pays for work; hires nobody.', NULL, 'member',
            ARRAY['spend_funds']::org.workspace_capability[])
    RETURNING id
)
INSERT INTO probe_ids SELECT 'finance_role', id FROM r;

INSERT INTO org.business_members (business_id, user_id, role_id, role, status)
SELECT pg_temp.id('helia'), pg_temp.id('noor'), r.id, 'member', 'active'
  FROM org.business_roles r WHERE r.business_id = pg_temp.id('helia') AND r.preset = 'member';
INSERT INTO org.business_members (business_id, user_id, role_id, role, status)
VALUES (pg_temp.id('helia'), pg_temp.id('theo'), pg_temp.id('finance_role'), 'member', 'active');

-- Miguel keeps his Atlas seat on the `member` preset with nothing extra granted.
UPDATE org.business_members SET granted_capabilities = '{}'
 WHERE business_id = pg_temp.id('atlas') AND user_id = pg_temp.id('miguel');
-- #endregion

-- #region Hiring and money-releasing review doors need `hire`
DO $$
DECLARE
    v_doors text[][] := ARRAY[
        ARRAY['assign_from_application', format('SELECT projects.assign_from_application(%L)', pg_temp.id('application'))],
        ARRAY['reject_application', format('SELECT projects.reject_application(%L)', pg_temp.id('application'))],
        ARRAY['assign_ticket_manual', format('SELECT projects.assign_ticket_manual(%L, %L)', pg_temp.id('ticket_unfunded'), pg_temp.id('maris'))],
        ARRAY['auto_assign_round_robin', format('SELECT projects.auto_assign_round_robin(%L)', pg_temp.id('stage_open'))],
        ARRAY['assign_parallel_stream', format('SELECT projects.assign_parallel_stream(%L)', pg_temp.id('stage_open'))],
        ARRAY['invite_to_project', format('SELECT projects.invite_to_project(%L, NULL, %L, ''freelancer'')', pg_temp.id('project'), pg_temp.id('aiko'))],
        ARRAY['invite_by_email', format('SELECT projects.invite_by_email(%L, NULL, ''probe-bb2@example.com'', ''freelancer'')', pg_temp.id('project'))],
        ARRAY['get_stage_invite_link', format('SELECT projects.get_stage_invite_link(%L, false)', pg_temp.id('stage_open'))],
        ARRAY['set_member_role', format('SELECT projects.set_member_role(%L, %L, ''manager'')', pg_temp.id('project'), pg_temp.id('maris_participant'))],
        ARRAY['review_submission(accept)', format('SELECT projects.review_submission(%L, ''accept'')', pg_temp.id('submission'))],
        ARRAY['approve_stage', format('SELECT projects.approve_stage(%L, %L)', pg_temp.id('project'), pg_temp.id('stage_live'))],
        ARRAY['complete_ticket', format('SELECT projects.complete_ticket(%L)', pg_temp.id('ticket_live'))],
        ARRAY['force_complete_stage', format('SELECT projects.force_complete_stage(%L)', pg_temp.id('ticket_live'))],
        ARRAY['cancel_stage_fair_exit', format('SELECT projects.cancel_stage_fair_exit(%L, %L, 50)', pg_temp.id('project'), pg_temp.id('stage_live'))]
    ];
    i integer;
BEGIN
    FOR i IN 1 .. array_length(v_doors, 1) LOOP
        PERFORM pg_temp.expect_refused('member: ' || v_doors[i][1], pg_temp.id('noor'), v_doors[i][2], 'missing_permission: hire');
        PERFORM pg_temp.expect_refused('finance role: ' || v_doors[i][1], pg_temp.id('theo'), v_doors[i][2], 'missing_permission: hire');
        PERFORM pg_temp.expect_allowed('admin: ' || v_doors[i][1], pg_temp.id('hannah'), v_doors[i][2]);
        PERFORM pg_temp.expect_allowed('owner: ' || v_doors[i][1], pg_temp.id('priya'), v_doors[i][2]);
    END LOOP;
END $$;

-- Removing a hire stays the project owner's alone (narrower than `hire`), so a business member who
-- does not own the project is refused whatever they hold.
DO $$
DECLARE
    r record;
BEGIN
    SELECT * INTO r FROM pg_temp.attempt(pg_temp.id('priya'),
        format('SELECT projects.remove_project_member(%L, %L, NULL)', pg_temp.id('project'), pg_temp.id('maris_participant')));
    IF pg_temp.is_authority_refusal(r.state, COALESCE(r.message, '')) THEN
        RAISE NOTICE 'PASS business owner (not project owner): remove_project_member — refused: %', r.message;
    ELSE
        PERFORM pg_temp.fail('business owner: remove_project_member', format('expected an authority refusal, got %s %s', r.state, r.message));
    END IF;
END $$;
SELECT pg_temp.expect_allowed('project owner (admin): remove_project_member', pg_temp.id('hannah'),
    format('SELECT projects.remove_project_member(%L, %L, NULL)', pg_temp.id('project'), pg_temp.id('maris_participant')));

-- Asking for free revisions is review, not release: the member keeps it.
SELECT pg_temp.expect_allowed('member: review_submission(request_revision)', pg_temp.id('noor'),
    format('SELECT projects.review_submission(%L, ''request_revision'')', pg_temp.id('submission')));

-- The project's owner keeps its hiring authority without holding `hire` on the business.
SELECT pg_temp.expect_allowed('project owner: assign_from_application', pg_temp.id('miguel'),
    format('SELECT projects.assign_from_application(%L)', pg_temp.id('loop_application')));
SELECT pg_temp.expect_allowed('project owner: reject_application', pg_temp.id('miguel'),
    format('SELECT projects.reject_application(%L)', pg_temp.id('loop_application')));
-- #endregion

-- #region Billing a new project to the business needs `manage_projects`
SELECT pg_temp.expect_refused('member: create_project (business)', pg_temp.id('noor'),
    format('SELECT projects.create_project(%L::jsonb)', json_build_object('title', 'BB2 probe', 'client_business_id', pg_temp.id('helia'))),
    'missing_permission: manage_projects');
SELECT pg_temp.expect_refused('finance role: create_project (business)', pg_temp.id('theo'),
    format('SELECT projects.create_project(%L::jsonb)', json_build_object('title', 'BB2 probe', 'client_business_id', pg_temp.id('helia'))),
    'missing_permission: manage_projects');
SELECT pg_temp.expect_refused('member without grant: create_project (atlas)', pg_temp.id('miguel'),
    format('SELECT projects.create_project(%L::jsonb)', json_build_object('title', 'BB2 probe', 'client_business_id', pg_temp.id('atlas'))),
    'missing_permission: manage_projects');
SELECT pg_temp.expect_allowed('admin: create_project (business)', pg_temp.id('hannah'),
    format('SELECT projects.create_project(%L::jsonb)', json_build_object('title', 'BB2 probe', 'client_business_id', pg_temp.id('helia'))));
SELECT pg_temp.expect_allowed('member: create_project (personal)', pg_temp.id('noor'),
    format('SELECT projects.create_project(%L::jsonb)', json_build_object('title', 'BB2 probe')));
-- #endregion

-- #region Funding escrow is the funder predicate (vault `spend`), not project access
SELECT pg_temp.expect_allowed('finance role: fund_stage', pg_temp.id('theo'),
    format('SELECT projects.fund_stage(%L, %L)', pg_temp.id('project'), pg_temp.id('stage_open')));
SELECT pg_temp.expect_allowed('finance role: fund_ticket', pg_temp.id('theo'),
    format('SELECT projects.fund_ticket(%L, %L)', pg_temp.id('project'), pg_temp.id('ticket_unfunded')));
SELECT pg_temp.expect_allowed('finance role: begin_card_payment(escrow_lock)', pg_temp.id('theo'),
    format('SELECT finance.begin_card_payment(''escrow_lock'', NULL, %L, %L, 1, ''USD'', ''bb2-probe-card-1'')',
           pg_temp.id('project'), pg_temp.id('stage_open')));
SELECT pg_temp.expect_allowed('admin: fund_stage', pg_temp.id('hannah'),
    format('SELECT projects.fund_stage(%L, %L)', pg_temp.id('project'), pg_temp.id('stage_open')));
SELECT pg_temp.expect_refused('member: fund_stage', pg_temp.id('noor'),
    format('SELECT projects.fund_stage(%L, %L)', pg_temp.id('project'), pg_temp.id('stage_open')), 'not_funder');
SELECT pg_temp.expect_refused('member: fund_ticket', pg_temp.id('noor'),
    format('SELECT projects.fund_ticket(%L, %L)', pg_temp.id('project'), pg_temp.id('ticket_unfunded')), 'not_funder');
SELECT pg_temp.expect_refused('member: begin_card_payment(escrow_lock)', pg_temp.id('noor'),
    format('SELECT finance.begin_card_payment(''escrow_lock'', NULL, %L, %L, 1, ''USD'', ''bb2-probe-card-2'')',
           pg_temp.id('project'), pg_temp.id('stage_open')), 'not_funder');
SELECT pg_temp.expect_refused('assignee: fund_stage', pg_temp.id('maris'),
    format('SELECT projects.fund_stage(%L, %L)', pg_temp.id('project'), pg_temp.id('stage_open')), 'not_funder');

DO $$
DECLARE
    v_fund boolean;
    v_hire boolean;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('theo'));
    BEGIN
        EXECUTE 'SELECT projects.fn_can_fund_project($1), projects.fn_business_actor_can($1, ''hire'')'
            INTO v_fund, v_hire USING pg_temp.id('project');
    EXCEPTION WHEN undefined_function THEN
        PERFORM pg_temp.fail('predicates', 'fn_can_fund_project / fn_business_actor_can do not exist');
        RETURN;
    END;
    IF v_fund AND NOT v_hire THEN
        RAISE NOTICE 'PASS predicates — the finance role funds but does not hire';
    ELSE
        PERFORM pg_temp.fail('predicates', format('fn_can_fund_project %s, fn_business_actor_can(hire) %s', v_fund, v_hire));
    END IF;
END $$;
-- #endregion

-- #region A business basket order needs `purchase` as well as vault `spend`
SELECT pg_temp.expect_refused('finance role (spend, no purchase): place_wallet_order', pg_temp.id('theo'),
    format('SELECT finance.place_wallet_order(%L, ARRAY[gen_random_uuid()], ''USD'', ''{}''::jsonb, NULL, ''bb2-probe-order-1'', 0)', pg_temp.id('basket')),
    'missing_permission: purchase');
SELECT pg_temp.expect_allowed('admin: place_wallet_order', pg_temp.id('hannah'),
    format('SELECT finance.place_wallet_order(%L, ARRAY[gen_random_uuid()], ''USD'', ''{}''::jsonb, NULL, ''bb2-probe-order-2'', 0)', pg_temp.id('basket')));

DO $$
DECLARE
    r record;
BEGIN
    SELECT * INTO r FROM pg_temp.attempt(pg_temp.id('noor'),
        format('SELECT finance.place_wallet_order(%L, ARRAY[gen_random_uuid()], ''USD'', ''{}''::jsonb, NULL, ''bb2-probe-order-3'', 0)', pg_temp.id('basket')));
    IF pg_temp.is_authority_refusal(r.state, COALESCE(r.message, '')) THEN
        RAISE NOTICE 'PASS member: place_wallet_order — refused: % %', r.state, r.message;
    ELSE
        PERFORM pg_temp.fail('member: place_wallet_order', format('expected an authority refusal, got %s %s', r.state, r.message));
    END IF;
END $$;
-- #endregion

-- #region Reads are unchanged: review authority and project access (Decision #163)
DO $$
DECLARE
    v_who text;
    v_review boolean;
    v_access boolean;
    v_expect_access boolean;
BEGIN
    FOREACH v_who IN ARRAY ARRAY['noor', 'theo', 'hannah', 'priya'] LOOP
        PERFORM pg_temp.act(pg_temp.id(v_who));
        v_review := projects.can_review_project(pg_temp.id('project'));
        v_access := projects.has_project_access(pg_temp.id('project'));
        -- has_project_access admits Hannah as the project's owner and Priya as the paying business's
        -- owner (its participant row); it never admits a plain member, and BB2 does not widen it.
        v_expect_access := v_who IN ('hannah', 'priya');
        IF v_review AND v_access = v_expect_access THEN
            RAISE NOTICE 'PASS reads: % — can_review_project %, has_project_access %', v_who, v_review, v_access;
        ELSE
            PERFORM pg_temp.fail('reads: ' || v_who, format('can_review_project %s, has_project_access %s', v_review, v_access));
        END IF;
    END LOOP;
END $$;
-- #endregion

DO $$
DECLARE
    v_n integer;
BEGIN
    SELECT count(*) INTO v_n FROM probe_fails;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'business_authority: % case(s) failed', v_n;
    END IF;
    RAISE NOTICE 'business_authority: all cases passed';
END $$;

ROLLBACK;
