-- =============================================================================================
-- Probe: the business plan gates — the Business Pro entitlements that were seeded but never read
-- (BUSINESSES_AUDIT BF33–BF36, Decision #230 (b), (e), (f)).
--
-- One switch, `security.platform_params.business_plan_gates_enforced`, SEEDED TRUE (the reverse of
-- the fail-open `*_enforced` family). While on, a business without the entitlement is refused
-- `PK402` with MESSAGE `entitlement: <key>: …` and the key in HINT:
--   * `business_managers` (limit) — inviting to a manager's role (admin-ranked, or holding
--     `manage_projects`), accepting such an invitation, a role change or `manage_projects` grant that
--     makes a member a manager, and a role edit that adds managers. Pending invitations count.
--   * `intervaled_invoicing` (flag) — finance.set_invoicing_terms to monthly.
--   * `pooled_wallet_full` (flag) — a threshold or a per-member ceiling through
--     finance.save_spend_policy or org.update_workspace_member. Clearing either is never refused.
-- With the switch off nothing is refused. The development header `x-pj-dev-plan-gates`
-- (`enforced` · `free`) only makes the gates stricter. `businesses_owned` on Individual Pro is 3.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/business_entitlements.sql
--
-- Fixture (seeded data): an active, KYB-verified business H on Business Free whose owner O holds
-- every capability and which has exactly one manager, an admin A; and five adult users X1–X5 who
-- belong to H in no way. The probe adds two plain members M1, M2, and moves H between Business Free
-- and Business Pro by inserting or deleting an active subscription. A clean run prints only PASS
-- notices.
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

-- The development simulation header, or none.
CREATE FUNCTION pg_temp.dev(p_value text) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.headers',
        CASE WHEN p_value IS NULL THEN '{}' ELSE json_build_object('x-pj-dev-plan-gates', p_value)::text END, true);
$$;

CREATE FUNCTION pg_temp.gates(p_on boolean) RETURNS void LANGUAGE sql AS $$
    UPDATE security.platform_params SET value = to_jsonb(p_on) WHERE key = 'business_plan_gates_enforced';
$$;

-- Put H on Business Pro (true) or back on its default Business Free (false).
CREATE FUNCTION pg_temp.pro(p_on boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM finance.subscriptions WHERE subject_type = 'business' AND subject_id = pg_temp.id('H');
    IF p_on THEN
        INSERT INTO finance.subscriptions (profile_id, subject_type, subject_id, plan_id, state)
        SELECT pg_temp.id('O'), 'business', pg_temp.id('H'), p.id, 'active'
          FROM finance.plans p WHERE p.code = 'business_pro';
    END IF;
END $$;

-- Run p_sql as p_actor inside a savepoint. p_key NULL: it must succeed. Otherwise it must be refused
-- PK402 with MESSAGE `entitlement: <p_key>:` and HINT p_key. Nothing it did survives a refusal.
CREATE FUNCTION pg_temp.expect(p_label text, p_actor uuid, p_sql text, p_key text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
    v_hint text;
BEGIN
    PERFORM pg_temp.act(p_actor);
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
    END;
    IF p_key IS NULL THEN
        IF v_state IS NOT NULL THEN
            RAISE EXCEPTION 'FAIL % — refused % "%" (expected it to go through)', p_label, v_state, v_msg;
        END IF;
        RAISE NOTICE 'PASS % (allowed)', p_label;
        RETURN;
    END IF;
    IF v_state IS NULL THEN
        RAISE EXCEPTION 'FAIL % — went through (expected PK402 %)', p_label, p_key;
    END IF;
    IF v_state <> 'PK402' OR v_msg NOT LIKE 'entitlement: ' || p_key || ':%' OR v_hint IS DISTINCT FROM p_key THEN
        RAISE EXCEPTION 'FAIL % — refused % "%" hint % (expected PK402 entitlement: %)', p_label, v_state, v_msg, v_hint, p_key;
    END IF;
    RAISE NOTICE 'PASS % (PK402 %)', p_label, p_key;
END $$;

CREATE FUNCTION pg_temp.managers() RETURNS integer LANGUAGE sql AS $$
    SELECT finance.fn_footprint_usage('business', pg_temp.id('H'), 'business_managers');
$$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_business uuid;
    v_owner uuid;
    v_admin uuid;
    v_member_role uuid;
    v_admin_role uuid;
    v_x uuid[];
BEGIN
    SELECT b.id, b.owner_user_id INTO v_business, v_owner
      FROM org.business_profiles b
     WHERE b.status = 'active' AND b.kyb_status = 'verified'
       AND finance.fn_active_plan('business', b.id) = (SELECT p.id FROM finance.plans p WHERE p.code = 'business_free')
       AND finance.fn_footprint_usage('business', b.id, 'business_managers') = 1
       AND NOT EXISTS (SELECT 1 FROM finance.entitlement_grants g WHERE g.subject_type = 'business' AND g.subject_id = b.id)
     ORDER BY b.slug
     LIMIT 1;
    SELECT m.user_id INTO v_admin FROM org.business_members m
     WHERE m.business_id = v_business AND m.status = 'active' AND m.role = 'admin' LIMIT 1;
    SELECT r.id INTO v_admin_role FROM org.business_roles r WHERE r.business_id = v_business AND r.preset = 'admin';
    SELECT r.id INTO v_member_role FROM org.business_roles r WHERE r.business_id = v_business AND r.preset = 'member';

    SELECT array_agg(u.user_id ORDER BY u.user_id) INTO v_x FROM (
        SELECT u.user_id FROM org.users_public u
         WHERE u.username IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM org.business_members m WHERE m.business_id = v_business AND m.user_id = u.user_id)
           AND NOT EXISTS (SELECT 1 FROM org.org_invitations i WHERE i.business_id = v_business AND i.target_user_id = u.user_id)
           AND NOT EXISTS (SELECT 1 FROM org.deletion_requests d WHERE d.user_id = u.user_id)
           AND NOT org.fn_is_minor(u.user_id)
         ORDER BY u.user_id
         LIMIT 7
    ) u;

    IF v_business IS NULL OR v_admin IS NULL OR v_admin_role IS NULL OR v_member_role IS NULL
       OR COALESCE(array_length(v_x, 1), 0) < 7 THEN
        RAISE EXCEPTION 'FAIL no fixture (business %, admin %, outsiders %) — deno task db:reset',
            v_business, v_admin, COALESCE(array_length(v_x, 1), 0);
    END IF;

    INSERT INTO probe_ids (k, id) VALUES
        ('H', v_business), ('O', v_owner), ('A', v_admin), ('RA', v_admin_role), ('RM', v_member_role),
        ('X1', v_x[1]), ('X2', v_x[2]), ('X3', v_x[3]), ('X4', v_x[4]), ('X5', v_x[5]),
        ('M1', v_x[6]), ('M2', v_x[7]);

    -- Two plain members to change: written as the seed writes members, then given their vault rows.
    INSERT INTO org.business_members (business_id, user_id, role_id, status, joined_at)
    VALUES (v_business, v_x[6], v_member_role, 'active', now()), (v_business, v_x[7], v_member_role, 'active', now());
    PERFORM org.fn_sync_vault_permissions('business', v_business, NULL);
    INSERT INTO probe_ids (k, id)
    SELECT 'MM' || right(k, 1), m.id
      FROM probe_ids p JOIN org.business_members m ON m.user_id = p.id AND m.business_id = v_business
     WHERE p.k IN ('M1', 'M2');

    RAISE NOTICE 'fixture: business % (owner %, admin %), managers %', v_business, v_owner, v_admin,
        finance.fn_footprint_usage('business', v_business, 'business_managers');
END $$;

-- The handle an invitation names.
CREATE FUNCTION pg_temp.handle(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT u.username FROM org.users_public u WHERE u.user_id = pg_temp.id(p_key);
$$;

CREATE FUNCTION pg_temp.invite_sql(p_key text, p_role text) RETURNS text LANGUAGE sql AS $$
    SELECT format($q$SELECT org.invite_workspace_member('business', %L, %L, NULL, %L)$q$,
                  pg_temp.id('H'), pg_temp.handle(p_key), pg_temp.id(p_role));
$$;
-- #endregion

-- #region 0. Seeded state — the switch is on; businesses_owned is 1 free / 3 pro (Decision #230 (f))
DO $$
DECLARE
    v_on boolean;
    v_free integer;
    v_pro integer;
BEGIN
    SELECT (value #>> '{}')::boolean INTO v_on FROM security.platform_params WHERE key = 'business_plan_gates_enforced';
    IF v_on IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FAIL 0a business_plan_gates_enforced is % (seeded true expected)', v_on;
    END IF;
    IF NOT finance.fn_business_plan_gates_enforced() THEN
        RAISE EXCEPTION 'FAIL 0a the gates read as off';
    END IF;
    SELECT e.limit_value INTO v_free FROM finance.plan_entitlements e JOIN finance.plans p ON p.id = e.plan_id
     WHERE p.audience = 'individual' AND p.is_default AND e.entitlement_key = 'businesses_owned';
    SELECT e.limit_value INTO v_pro FROM finance.plan_entitlements e JOIN finance.plans p ON p.id = e.plan_id
     WHERE p.code = 'individual_pro' AND e.entitlement_key = 'businesses_owned';
    IF v_free IS DISTINCT FROM 1 OR v_pro IS DISTINCT FROM 3 THEN
        RAISE EXCEPTION 'FAIL 0b businesses_owned is % free / % pro (expected 1 / 3)', v_free, v_pro;
    END IF;
    IF (SELECT e.limit_value FROM finance.plan_entitlements e JOIN finance.plans p ON p.id = e.plan_id
         WHERE p.code = 'business_free' AND e.entitlement_key = 'business_managers') IS DISTINCT FROM 2
       OR (SELECT e.limit_value FROM finance.plan_entitlements e JOIN finance.plans p ON p.id = e.plan_id
         WHERE p.code = 'business_pro' AND e.entitlement_key = 'business_managers') IS DISTINCT FROM 15 THEN
        RAISE EXCEPTION 'FAIL 0c business_managers is not 2 free / 15 pro';
    END IF;
    RAISE NOTICE 'PASS 0 seeded: gates on; businesses_owned 1 / 3; business_managers 2 / 15';
END $$;
-- #endregion

-- #region 1. business_managers on Business Free (ceiling 2; A already holds one)
SELECT pg_temp.expect('1a free: inviting X1 as an admin takes the second manager seat', pg_temp.id('O'),
    pg_temp.invite_sql('X1', 'RA'), NULL);
SELECT pg_temp.expect('1b free: inviting X2 as an admin is refused (pending invitations count)', pg_temp.id('O'),
    pg_temp.invite_sql('X2', 'RA'), 'business_managers');
SELECT pg_temp.expect('1c free: inviting X2 as a plain member is not a manager seat', pg_temp.id('O'),
    pg_temp.invite_sql('X2', 'RM'), NULL);

-- A Project Manager template: a member-ranked custom role holding manage_projects.
DO $$
BEGIN
    PERFORM pg_temp.act(pg_temp.id('O'));
    INSERT INTO probe_ids (k, id)
    SELECT 'RP', (org.upsert_workspace_role('business', pg_temp.id('H'), NULL, 'Probe Project Manager', '',
                  ARRAY['manage_projects', 'view_analytics']::org.workspace_capability[], 'member')->>'id')::uuid;
    INSERT INTO probe_ids (k, id)
    SELECT 'RO', (org.upsert_workspace_role('business', pg_temp.id('H'), NULL, 'Probe Observer', '',
                  ARRAY['view_analytics']::org.workspace_capability[], 'member')->>'id')::uuid;
    RAISE NOTICE 'PASS 1d free: creating a manager role with no holders is never refused';
END $$;
SELECT pg_temp.expect('1e free: inviting X3 to a custom manage_projects role is refused', pg_temp.id('O'),
    pg_temp.invite_sql('X3', 'RP'), 'business_managers');
SELECT pg_temp.expect('1f free: promoting M1 to admin is refused at the ceiling', pg_temp.id('O'),
    format($q$SELECT org.update_workspace_member('business', %L, jsonb_build_object('role_id', %L))$q$,
           pg_temp.id('MM1'), pg_temp.id('RA')), 'business_managers');
SELECT pg_temp.expect('1g free: granting M1 manage_projects directly is refused at the ceiling', pg_temp.id('O'),
    format($q$SELECT org.update_workspace_member('business', %L, '{"granted": ["manage_projects"]}'::jsonb)$q$,
           pg_temp.id('MM1')), 'business_managers');

-- Withdraw X1's invitation: one seat frees, and M1 may take it.
DO $$
BEGIN
    PERFORM pg_temp.act(pg_temp.id('O'));
    PERFORM org.revoke_workspace_invitation(
        (SELECT i.id FROM org.org_invitations i WHERE i.business_id = pg_temp.id('H')
            AND i.target_user_id = pg_temp.id('X1') AND i.status = 'pending'));
    IF pg_temp.managers() <> 1 THEN
        RAISE EXCEPTION 'FAIL 1h managers % after the revoke (expected 1)', pg_temp.managers();
    END IF;
END $$;
SELECT pg_temp.expect('1h free: granting M1 manage_projects takes the freed seat', pg_temp.id('O'),
    format($q$SELECT org.update_workspace_member('business', %L, '{"granted": ["manage_projects"]}'::jsonb)$q$,
           pg_temp.id('MM1')), NULL);
SELECT pg_temp.expect('1i free: changing a manager''s title is never refused at the ceiling', pg_temp.id('O'),
    format($q$SELECT org.update_workspace_member('business', %L, '{"title": "Lead buyer"}'::jsonb)$q$,
           pg_temp.id('MM1')), NULL);
SELECT pg_temp.expect('1j free: moving M2 onto the Observer role is not a manager seat', pg_temp.id('O'),
    format($q$SELECT org.update_workspace_member('business', %L, jsonb_build_object('role_id', %L))$q$,
           pg_temp.id('MM2'), pg_temp.id('RO')), NULL);
SELECT pg_temp.expect('1k free: editing the Observer role to manage projects (M2 holds it) is refused', pg_temp.id('O'),
    format($q$SELECT org.upsert_workspace_role('business', %L, %L, 'Probe Observer', '',
                  ARRAY['manage_projects', 'view_analytics']::org.workspace_capability[], 'member')$q$,
           pg_temp.id('H'), pg_temp.id('RO')), 'business_managers');
DO $$
BEGIN
    IF pg_temp.managers() <> 2 THEN
        RAISE EXCEPTION 'FAIL 1l managers % (expected 2: A and M1)', pg_temp.managers();
    END IF;
    RAISE NOTICE 'PASS 1l refusals left nothing behind (managers 2)';
END $$;
-- #endregion

-- #region 2. business_managers on Business Pro (ceiling 15), then a downgrade before an acceptance
SELECT pg_temp.pro(true);
SELECT pg_temp.expect('2a pro: inviting X3 to the manage_projects role goes through', pg_temp.id('O'),
    pg_temp.invite_sql('X3', 'RP'), NULL);
SELECT pg_temp.expect('2b pro: inviting X4 as an admin goes through', pg_temp.id('O'),
    pg_temp.invite_sql('X4', 'RA'), NULL);
SELECT pg_temp.pro(false);
SELECT pg_temp.expect('2c downgraded: X4 accepting a manager''s invitation past the ceiling is refused', pg_temp.id('X4'),
    format($q$SELECT org.respond_to_workspace_invitation(%L, true)$q$,
           (SELECT i.id FROM org.org_invitations i WHERE i.business_id = pg_temp.id('H')
               AND i.target_user_id = pg_temp.id('X4') AND i.status = 'pending')), 'business_managers');
SELECT pg_temp.expect('2d downgraded: X2 accepting a plain member''s invitation goes through', pg_temp.id('X2'),
    format($q$SELECT org.respond_to_workspace_invitation(%L, true)$q$,
           (SELECT i.id FROM org.org_invitations i WHERE i.business_id = pg_temp.id('H')
               AND i.target_user_id = pg_temp.id('X2') AND i.status = 'pending')), NULL);
-- #endregion

-- #region 3. intervaled_invoicing — monthly terms are Business Pro's
SELECT pg_temp.expect('3a free: monthly invoicing is refused', pg_temp.id('O'),
    format($q$SELECT finance.set_invoicing_terms('business', %L, 'intervaled_monthly', 5)$q$, pg_temp.id('H')),
    'intervaled_invoicing');
SELECT pg_temp.expect('3b free: per-transaction invoicing goes through', pg_temp.id('O'),
    format($q$SELECT finance.set_invoicing_terms('business', %L, 'per_transaction', NULL)$q$, pg_temp.id('H')), NULL);
SELECT pg_temp.pro(true);
SELECT pg_temp.expect('3c pro: monthly invoicing goes through', pg_temp.id('O'),
    format($q$SELECT finance.set_invoicing_terms('business', %L, 'intervaled_monthly', 5)$q$, pg_temp.id('H')), NULL);
SELECT pg_temp.pro(false);
-- #endregion

-- #region 4. pooled_wallet_full — a threshold or a ceiling is Business Pro's; clearing never is
SELECT pg_temp.expect('4a free: an approval threshold is refused', pg_temp.id('O'),
    format($q$SELECT finance.save_spend_policy(%L, '{"approval_threshold_minor": 50000}'::jsonb)$q$, pg_temp.id('H')),
    'pooled_wallet_full');
SELECT pg_temp.expect('4b free: clearing the threshold goes through', pg_temp.id('O'),
    format($q$SELECT finance.save_spend_policy(%L, '{"approval_threshold_minor": null}'::jsonb)$q$, pg_temp.id('H')), NULL);
SELECT pg_temp.expect('4c free: a per-member ceiling through the spend policy is refused', pg_temp.id('O'),
    format($q$SELECT finance.save_spend_policy(%L, jsonb_build_object('limits',
        jsonb_build_array(jsonb_build_object('member_id', %L, 'limit_minor', 20000))))$q$,
        pg_temp.id('H'), pg_temp.id('MM2')), 'pooled_wallet_full');
SELECT pg_temp.expect('4d free: letting M2 spend without a ceiling (basic mode) goes through', pg_temp.id('O'),
    format($q$SELECT finance.save_spend_policy(%L, jsonb_build_object('limits',
        jsonb_build_array(jsonb_build_object('member_id', %L, 'can_spend', true))))$q$,
        pg_temp.id('H'), pg_temp.id('MM2')), NULL);
SELECT pg_temp.expect('4e free: a ceiling through the member drawer is refused', pg_temp.id('O'),
    format($q$SELECT org.update_workspace_member('business', %L, '{"spend_limit_minor": 20000}'::jsonb)$q$,
           pg_temp.id('MM2')), 'pooled_wallet_full');
SELECT pg_temp.pro(true);
SELECT pg_temp.expect('4f pro: an approval threshold goes through', pg_temp.id('O'),
    format($q$SELECT finance.save_spend_policy(%L, '{"approval_threshold_minor": 50000}'::jsonb)$q$, pg_temp.id('H')), NULL);
SELECT pg_temp.expect('4g pro: a per-member ceiling goes through', pg_temp.id('O'),
    format($q$SELECT finance.save_spend_policy(%L, jsonb_build_object('limits',
        jsonb_build_array(jsonb_build_object('member_id', %L, 'limit_minor', 20000))))$q$,
        pg_temp.id('H'), pg_temp.id('MM2')), NULL);
-- #endregion

-- #region 5. The development header only makes the gates stricter
SELECT pg_temp.dev('free');
SELECT pg_temp.expect('5a pro under `free`: monthly invoicing is refused', pg_temp.id('O'),
    format($q$SELECT finance.set_invoicing_terms('business', %L, 'intervaled_monthly', 7)$q$, pg_temp.id('H')),
    'intervaled_invoicing');
SELECT pg_temp.expect('5b pro under `free`: inviting X5 as an admin is refused at Business Free''s 2', pg_temp.id('O'),
    pg_temp.invite_sql('X5', 'RA'), 'business_managers');
SELECT pg_temp.dev(NULL);
SELECT pg_temp.pro(false);
SELECT pg_temp.gates(false);
SELECT pg_temp.dev('enforced');
SELECT pg_temp.expect('5c switch off under `enforced`: a threshold is still refused', pg_temp.id('O'),
    format($q$SELECT finance.save_spend_policy(%L, '{"approval_threshold_minor": 70000}'::jsonb)$q$, pg_temp.id('H')),
    'pooled_wallet_full');
SELECT pg_temp.dev('anything else');
SELECT pg_temp.expect('5d an unknown header value is no simulation (switch off: allowed)', pg_temp.id('O'),
    format($q$SELECT finance.save_spend_policy(%L, '{"approval_threshold_minor": 70000}'::jsonb)$q$, pg_temp.id('H')), NULL);
SELECT pg_temp.dev(NULL);
-- #endregion

-- #region 6. Switch off — nothing is refused, on Business Free
SELECT pg_temp.expect('6a off: monthly invoicing on free goes through', pg_temp.id('O'),
    format($q$SELECT finance.set_invoicing_terms('business', %L, 'intervaled_monthly', 9)$q$, pg_temp.id('H')), NULL);
SELECT pg_temp.expect('6b off: a ceiling on free goes through', pg_temp.id('O'),
    format($q$SELECT org.update_workspace_member('business', %L, '{"spend_limit_minor": 30000}'::jsonb)$q$,
           pg_temp.id('MM2')), NULL);
SELECT pg_temp.expect('6c off: inviting X5 as an admin past the ceiling goes through', pg_temp.id('O'),
    pg_temp.invite_sql('X5', 'RA'), NULL);
SELECT pg_temp.expect('6d off: X4 accepting a manager''s invitation past the ceiling goes through', pg_temp.id('X4'),
    format($q$SELECT org.respond_to_workspace_invitation(%L, true)$q$,
           (SELECT i.id FROM org.org_invitations i WHERE i.business_id = pg_temp.id('H')
               AND i.target_user_id = pg_temp.id('X4') AND i.status = 'pending')), NULL);
DO $$
BEGIN
    DELETE FROM security.platform_params WHERE key = 'business_plan_gates_enforced';
    IF NOT finance.fn_business_plan_gates_enforced() THEN
        RAISE EXCEPTION 'FAIL 6e a missing switch reads as off';
    END IF;
    RAISE NOTICE 'PASS 6e a missing switch reads as on';
END $$;
-- #endregion

ROLLBACK;
