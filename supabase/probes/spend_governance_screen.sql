-- =============================================================================================
-- Probe: the business Spend screen's server half (BU2, Decision #246).
--
--   1. finance.save_spend_policy reads a limits entry PER KEY: an owner's or one's own row is refused
--      whatever it carries, so the editor must send only the rows it may change; a `can_spend`-only
--      entry is never plan-gated, while restating a stored ceiling is (BB7) — so only changed keys go.
--   2. A member's period is editable (`period`: weekly · monthly · total). Changing it carries the
--      spend counted in the current window over and restarts the window at the new period's next
--      boundary (NULL for `total`); a period change on a row that keeps a ceiling is Business Pro's.
--      The draft preview reads the same key.
--   3. finance.withdraw_spend_approval — the requester's own pending request only; a terminal
--      `withdrawn` status that stamps decided_at with no approver; a withdrawn request is never decided
--      or redeemed, and the ref is free for a new request. A lapsed request answers `expired`.
--   4. org.get_workspace_detail's spend block answers `editable_member_ids` (the rows the viewer may
--      change), `approver_gap` (nobody besides the owner approves), `limits_plan_gated` and, per
--      request, `ref` (what it is for) and `consumed`.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/spend_governance_screen.sql
--
-- Fixture (seeded data): Helia Finance (KYB verified, Business Free, the plan-gate switch on) —
-- priyaraman owner, hannahcole admin with a 25 000.00 monthly cap and a 10 000.00 per-purchase
-- ceiling, and her seeded pending request on the "UX and flows" stage; Atlas Labs — danielokafor
-- owner, miguelsantos member. noor joins Helia as a plain member and theo as a member granted
-- spend_funds (both rolled back). A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('finance.spend_cover', '', true);
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', p_what; END IF;
    RAISE NOTICE 'PASS %', p_what;
END $$;

-- Run p_sql as p_actor; it must be refused with SQLSTATE p_state and a message starting p_prefix.
CREATE FUNCTION pg_temp.expect_refused(p_label text, p_actor uuid, p_sql text, p_state text, p_prefix text)
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
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF v_state IS NULL THEN
        RAISE EXCEPTION 'FAIL % — it went through', p_label;
    END IF;
    IF v_state <> p_state OR v_msg NOT LIKE p_prefix || '%' THEN
        RAISE EXCEPTION 'FAIL % — refused % "%" (expected % %)', p_label, v_state, v_msg, p_state, p_prefix;
    END IF;
    RAISE NOTICE 'PASS % (% %)', p_label, v_state, split_part(v_msg, ':', 1);
END $$;

-- Run p_sql as p_actor; it must succeed. Returns its jsonb answer (or NULL).
CREATE FUNCTION pg_temp.expect_ok(p_label text, p_actor uuid, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_out jsonb;
    v_state text;
    v_msg text;
BEGIN
    PERFORM pg_temp.act(p_actor);
    BEGIN
        EXECUTE p_sql INTO v_out;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        PERFORM set_config('request.jwt.claims', NULL, true);
        RAISE EXCEPTION 'FAIL % — refused % "%"', p_label, v_state, v_msg;
    END;
    PERFORM set_config('request.jwt.claims', NULL, true);
    RAISE NOTICE 'PASS %', p_label;
    RETURN v_out;
END $$;

-- A save_spend_policy call on Helia with one limits entry.
CREATE FUNCTION pg_temp.save_sql(p_entry jsonb) RETURNS text LANGUAGE sql AS $$
    SELECT format('SELECT finance.save_spend_policy(%L, %L::jsonb)', pg_temp.id('helia'),
                  jsonb_build_object('limits', jsonb_build_array(p_entry)));
$$;

-- Hannah's stored envelope row on Helia's USD wallet.
CREATE FUNCTION pg_temp.hannah_row() RETURNS finance.spending_limits LANGUAGE sql AS $$
    SELECT * FROM finance.spending_limits WHERE wallet_id = pg_temp.id('wallet') AND member_user_id = pg_temp.id('hannah');
$$;

-- The detail as p_actor reads it.
CREATE FUNCTION pg_temp.detail(p_actor uuid, p_handle text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v jsonb;
BEGIN
    PERFORM pg_temp.act(p_actor);
    v := org.get_workspace_detail('business', p_handle);
    PERFORM set_config('request.jwt.claims', NULL, true);
    RETURN v;
END $$;

-- The member ids a detail's spend block says the viewer may edit.
CREATE FUNCTION pg_temp.editable(p_detail jsonb) RETURNS uuid[] LANGUAGE sql AS $$
    SELECT COALESCE(array_agg(x::uuid), '{}') FROM jsonb_array_elements_text(p_detail->'spend'->'editable_member_ids') x;
$$;

CREATE FUNCTION pg_temp.gates(p_on boolean) RETURNS void LANGUAGE sql AS $$
    UPDATE security.platform_params SET value = to_jsonb(p_on) WHERE key = 'business_plan_gates_enforced';
$$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_helia uuid;
    v_member_role uuid;
BEGIN
    SELECT b.id INTO v_helia FROM org.business_profiles b WHERE b.slug = 'heliafinance';
    SELECT r.id INTO v_member_role FROM org.business_roles r WHERE r.business_id = v_helia AND r.preset = 'member';
    INSERT INTO probe_ids VALUES
        ('helia', v_helia),
        ('atlas', (SELECT id FROM org.business_profiles WHERE slug = 'atlaslabs')),
        ('wallet', (SELECT w.id FROM finance.wallets w WHERE w.owner_type = 'business' AND w.owner_id = v_helia AND w.currency = 'USD')),
        ('priya', (SELECT user_id FROM org.users_public WHERE username = 'priyaraman')),
        ('hannah', (SELECT user_id FROM org.users_public WHERE username = 'hannahcole')),
        ('daniel', (SELECT user_id FROM org.users_public WHERE username = 'danielokafor')),
        ('noor', (SELECT user_id FROM org.users_public WHERE username = 'noor')),
        ('theo', (SELECT user_id FROM org.users_public WHERE username = 'theo'));

    INSERT INTO org.business_members (business_id, user_id, role_id, role)
    SELECT v_helia, u.user_id, v_member_role, 'member' FROM org.users_public u WHERE u.username IN ('noor', 'theo');
    UPDATE org.business_members SET granted_capabilities = ARRAY['spend_funds']::org.workspace_capability[]
     WHERE business_id = v_helia AND user_id = pg_temp.id('theo');
    PERFORM org.fn_sync_vault_permissions('business', v_helia, NULL);

    INSERT INTO probe_ids VALUES
        ('m_priya', (SELECT id FROM org.business_members WHERE business_id = v_helia AND user_id = pg_temp.id('priya'))),
        ('m_hannah', (SELECT id FROM org.business_members WHERE business_id = v_helia AND user_id = pg_temp.id('hannah'))),
        ('m_noor', (SELECT id FROM org.business_members WHERE business_id = v_helia AND user_id = pg_temp.id('noor'))),
        ('m_theo', (SELECT id FROM org.business_members WHERE business_id = v_helia AND user_id = pg_temp.id('theo'))),
        -- Two Helia stages the seed has no request on: the probe's withdraw fixtures.
        ('stage_a', (SELECT ps.id FROM projects.project_stages ps JOIN projects.projects p ON p.id = ps.project_id
                      WHERE p.client_business_id = v_helia
                        AND NOT EXISTS (SELECT 1 FROM finance.spend_approvals sa WHERE sa.ref_id = ps.id)
                      ORDER BY ps.id LIMIT 1)),
        ('stage_b', (SELECT ps.id FROM projects.project_stages ps JOIN projects.projects p ON p.id = ps.project_id
                      WHERE p.client_business_id = v_helia
                        AND NOT EXISTS (SELECT 1 FROM finance.spend_approvals sa WHERE sa.ref_id = ps.id)
                      ORDER BY ps.id OFFSET 1 LIMIT 1));

    -- The fixture's facts, so a reseeded DB that drifts fails here rather than misleading below.
    IF pg_temp.id('wallet') IS NULL OR pg_temp.id('stage_b') IS NULL OR pg_temp.id('m_noor') IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture — Helia, its USD wallet, two free stages and the probe members are needed';
    END IF;
    IF (SELECT cap_cents FROM pg_temp.hannah_row()) IS NULL
       OR (SELECT per_transaction_cents FROM pg_temp.hannah_row()) <> 1000000 THEN
        RAISE EXCEPTION 'FAIL fixture — hannahcole holds a cap and a 10 000.00 per-purchase ceiling on Helia';
    END IF;
    PERFORM pg_temp.gates(true);
END $$;
-- #endregion

-- #region 1. Per-key limits (the editor's diff)
SELECT pg_temp.expect_refused('a patch that names the owner''s row is refused, even unchanged',
    pg_temp.id('hannah'),
    pg_temp.save_sql(jsonb_build_object('member_id', pg_temp.id('m_priya'), 'can_spend', true)),
    '42501', 'limits: you cannot change this member');
SELECT pg_temp.expect_refused('a patch that names one''s own row is refused',
    pg_temp.id('hannah'),
    pg_temp.save_sql(jsonb_build_object('member_id', pg_temp.id('m_hannah'), 'can_spend', true)),
    '42501', 'limits: you cannot change this member');
SELECT pg_temp.expect_ok('a can_spend-only entry on a capped member of a Free business is not plan-gated',
    pg_temp.id('priya'),
    pg_temp.save_sql(jsonb_build_object('member_id', pg_temp.id('m_hannah'), 'can_spend', true)));
SELECT pg_temp.expect_refused('restating a stored ceiling on a Free business is plan-gated (so the editor sends only changed keys)',
    pg_temp.id('priya'),
    pg_temp.save_sql(jsonb_build_object('member_id', pg_temp.id('m_hannah'),
        'limit_minor', (SELECT cap_cents FROM pg_temp.hannah_row()))),
    'PK402', 'entitlement: pooled_wallet_full');
-- #endregion

-- #region 2. Period
SELECT pg_temp.expect_refused('a period is weekly, monthly or total',
    pg_temp.id('priya'),
    pg_temp.save_sql(jsonb_build_object('member_id', pg_temp.id('m_hannah'), 'period', 'daily')),
    '22023', 'limits: a period is weekly, monthly or total');
SELECT pg_temp.expect_refused('a period change on a row that keeps a ceiling is Business Pro''s',
    pg_temp.id('priya'),
    pg_temp.save_sql(jsonb_build_object('member_id', pg_temp.id('m_hannah'), 'period', 'weekly')),
    'PK402', 'entitlement: pooled_wallet_full');
SELECT pg_temp.expect_ok('a period on a member with no ceiling is free (inserts their row)',
    pg_temp.id('priya'),
    pg_temp.save_sql(jsonb_build_object('member_id', pg_temp.id('m_theo'), 'period', 'weekly')));
SELECT pg_temp.check((SELECT period_interval = 'weekly' AND cap_cents IS NULL AND per_transaction_cents IS NULL AND spent_cents = 0
                        FROM finance.spending_limits WHERE wallet_id = pg_temp.id('wallet') AND member_user_id = pg_temp.id('theo')),
                     'theo''s new row: weekly, no ceilings, nothing spent');

SELECT pg_temp.gates(false);
CREATE TEMP TABLE hannah_before ON COMMIT DROP AS SELECT * FROM pg_temp.hannah_row();
SELECT pg_temp.expect_ok('with the switch off, a period change on a capped row is saved',
    pg_temp.id('priya'),
    pg_temp.save_sql(jsonb_build_object('member_id', pg_temp.id('m_hannah'), 'period', 'weekly')));
SELECT pg_temp.check((SELECT h.period_interval = 'weekly' AND h.spent_cents = b.spent_cents AND h.cap_cents = b.cap_cents
                             AND h.resets_at = date_trunc('week', now()) + interval '1 week'
                        FROM pg_temp.hannah_row() h, hannah_before b),
                     'weekly: the window''s spend carries over, the window restarts at next week''s boundary');
SELECT pg_temp.expect_ok('a period change to total',
    pg_temp.id('priya'),
    pg_temp.save_sql(jsonb_build_object('member_id', pg_temp.id('m_hannah'), 'period', 'total')));
SELECT pg_temp.check((SELECT h.period_interval = 'total' AND h.spent_cents = b.spent_cents AND h.resets_at IS NULL
                        FROM pg_temp.hannah_row() h, hannah_before b),
                     'total: spend carried, no reset');
SELECT pg_temp.expect_ok('back to monthly',
    pg_temp.id('priya'),
    pg_temp.save_sql(jsonb_build_object('member_id', pg_temp.id('m_hannah'), 'period', 'monthly')));
SELECT pg_temp.check((SELECT h.period_interval = 'monthly' AND h.spent_cents = b.spent_cents
                             AND h.resets_at = date_trunc('month', now()) + interval '1 month'
                        FROM pg_temp.hannah_row() h, hannah_before b),
                     'monthly: spend carried, the window restarts at next month''s boundary');
-- A lapsed window carries nothing over: what it counted belongs to a window that has closed.
UPDATE finance.spending_limits SET resets_at = now() - interval '1 minute'
 WHERE wallet_id = pg_temp.id('wallet') AND member_user_id = pg_temp.id('hannah');
SELECT pg_temp.expect_ok('a period change after the window lapsed',
    pg_temp.id('priya'),
    pg_temp.save_sql(jsonb_build_object('member_id', pg_temp.id('m_hannah'), 'period', 'weekly')));
SELECT pg_temp.check((SELECT spent_cents = 0 FROM pg_temp.hannah_row()), 'a lapsed window carries nothing over');
UPDATE finance.spending_limits sl SET spent_cents = b.spent_cents, resets_at = b.resets_at, period_interval = b.period_interval
  FROM hannah_before b WHERE sl.id = b.id;
SELECT pg_temp.check((
    SELECT e->>'period' = 'weekly' AND (e->>'spent_minor')::bigint = (SELECT spent_cents FROM hannah_before)
      FROM jsonb_array_elements(
               pg_temp.expect_ok('the preview reads a draft period', pg_temp.id('priya'),
                   format('SELECT finance.preview_spend_envelope(%L, %L::jsonb)', pg_temp.id('helia'),
                          jsonb_build_object('limits', jsonb_build_array(jsonb_build_object(
                              'member_id', pg_temp.id('m_hannah'), 'period', 'weekly')))))->'limits') e
     WHERE e->>'member_id' = pg_temp.id('m_hannah')::text),
    'the preview prices a draft period against the window''s real spend');
SELECT pg_temp.expect_refused('the preview refuses a bad period',
    pg_temp.id('priya'),
    format('SELECT finance.preview_spend_envelope(%L, %L::jsonb)', pg_temp.id('helia'),
           jsonb_build_object('limits', jsonb_build_array(jsonb_build_object(
               'member_id', pg_temp.id('m_hannah'), 'period', 'yearly')))),
    '22023', 'limits: a period is weekly, monthly or total');
SELECT pg_temp.gates(true);
-- #endregion

-- #region 3. Withdraw
INSERT INTO probe_ids VALUES ('req_a', (pg_temp.expect_ok('hannah files 12 000.00 for stage A (over her per-purchase ceiling)',
    pg_temp.id('hannah'),
    format('SELECT finance.request_spend_approval(%L, 1200000, ''Probe stage A'', ''project_stages'', %L)',
           pg_temp.id('wallet'), pg_temp.id('stage_a')))->>'id')::uuid);
SELECT pg_temp.expect_refused('only the member who asked can withdraw it',
    pg_temp.id('priya'),
    format('SELECT finance.withdraw_spend_approval(%L)', pg_temp.id('req_a')),
    '42501', 'request: only the member who asked');
SELECT pg_temp.check((pg_temp.expect_ok('hannah withdraws her request', pg_temp.id('hannah'),
                         format('SELECT finance.withdraw_spend_approval(%L)', pg_temp.id('req_a')))->>'status') = 'withdrawn',
                     'the answer says withdrawn');
SELECT pg_temp.check((SELECT status = 'withdrawn' AND decided_at IS NOT NULL AND approver_user_id IS NULL AND consumed_at IS NULL
                        FROM finance.spend_approvals WHERE id = pg_temp.id('req_a')),
                     'withdrawn: decided_at stamped, no approver, never spent');
SELECT pg_temp.check((SELECT count(*) = 1 FROM security.audit_logs
                       WHERE action = 'business.spend_request_withdrawn' AND entity_id = pg_temp.id('req_a')),
                     'the withdrawal is audited');
SELECT pg_temp.expect_refused('a second withdraw is refused',
    pg_temp.id('hannah'),
    format('SELECT finance.withdraw_spend_approval(%L)', pg_temp.id('req_a')),
    'PC409', 'request: it has already been withdrawn');
SELECT pg_temp.expect_refused('a withdrawn request is never decided',
    pg_temp.id('priya'),
    format('SELECT finance.decide_spend_approval(%L, ''approve'')', pg_temp.id('req_a')),
    'PC409', 'That request was withdrawn');
SELECT pg_temp.expect_refused('a withdrawn request is never redeemed',
    pg_temp.id('hannah'),
    format('SELECT finance.fn_redeem_spend_approval(%L, %L, 1200000, ''project_stages'', %L)',
           pg_temp.id('wallet'), pg_temp.id('hannah'), pg_temp.id('stage_a')),
    'PA403', 'needs_approval');
SELECT pg_temp.expect_ok('the ref is free for a new request once withdrawn',
    pg_temp.id('hannah'),
    format('SELECT finance.request_spend_approval(%L, 1200000, ''Probe stage A again'', ''project_stages'', %L)',
           pg_temp.id('wallet'), pg_temp.id('stage_a')));
SELECT pg_temp.expect_refused('a withdrawn request cannot be faked onto a decider',
    pg_temp.id('priya'),
    format('UPDATE finance.spend_approvals SET approver_user_id = %L WHERE id = %L', pg_temp.id('priya'), pg_temp.id('req_a')),
    '23514', 'new row for relation "spend_approvals" violates check constraint "spend_approvals_withdrawn_check"');

INSERT INTO probe_ids VALUES ('req_b', (pg_temp.expect_ok('hannah files 12 000.00 for stage B',
    pg_temp.id('hannah'),
    format('SELECT finance.request_spend_approval(%L, 1200000, ''Probe stage B'', ''project_stages'', %L)',
           pg_temp.id('wallet'), pg_temp.id('stage_b')))->>'id')::uuid);
UPDATE finance.spend_approvals SET expires_at = now() - interval '1 minute' WHERE id = pg_temp.id('req_b');
SELECT pg_temp.check((pg_temp.expect_ok('withdrawing a lapsed request', pg_temp.id('hannah'),
                         format('SELECT finance.withdraw_spend_approval(%L)', pg_temp.id('req_b')))->>'status') = 'expired',
                     'a lapsed request answers expired, as a decision would');
SELECT pg_temp.check((SELECT status = 'expired' AND decided_at IS NULL FROM finance.spend_approvals WHERE id = pg_temp.id('req_b')),
                     'the lapsed request is marked expired, not withdrawn');
SELECT pg_temp.expect_refused('a missing request',
    pg_temp.id('hannah'),
    format('SELECT finance.withdraw_spend_approval(%L)', gen_random_uuid()),
    'PB404', 'request: not found');
SELECT pg_temp.check(NOT has_function_privilege('anon', 'finance.withdraw_spend_approval(uuid)', 'EXECUTE')
                     AND has_function_privilege('authenticated', 'finance.withdraw_spend_approval(uuid)', 'EXECUTE'),
                     'withdraw: authenticated only');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'finance.fn_spend_ref(text,uuid)', 'EXECUTE')
                     AND NOT has_function_privilege('anon', 'finance.fn_spend_ref(text,uuid)', 'EXECUTE'),
                     'fn_spend_ref is internal');
-- #endregion

-- #region 4. The detail
CREATE TEMP TABLE d ON COMMIT DROP AS
SELECT 'owner' AS who, pg_temp.detail(pg_temp.id('priya'), 'heliafinance') AS v
UNION ALL SELECT 'admin', pg_temp.detail(pg_temp.id('hannah'), 'heliafinance')
UNION ALL SELECT 'spender', pg_temp.detail(pg_temp.id('theo'), 'heliafinance')
UNION ALL SELECT 'atlas', pg_temp.detail(pg_temp.id('daniel'), 'atlaslabs');

SELECT pg_temp.check((SELECT pg_temp.editable(v) @> ARRAY[pg_temp.id('m_hannah'), pg_temp.id('m_noor'), pg_temp.id('m_theo')]
                             AND NOT pg_temp.editable(v) @> ARRAY[pg_temp.id('m_priya')]
                        FROM d WHERE who = 'owner'),
                     'owner may edit every member but themselves');
SELECT pg_temp.check((SELECT pg_temp.editable(v) @> ARRAY[pg_temp.id('m_noor'), pg_temp.id('m_theo')]
                             AND NOT pg_temp.editable(v) && ARRAY[pg_temp.id('m_priya'), pg_temp.id('m_hannah')]
                        FROM d WHERE who = 'admin'),
                     'admin may edit the members she outranks — never the owner or herself');
SELECT pg_temp.check((SELECT v->'spend'->'editable_member_ids' = '[]'::jsonb FROM d WHERE who = 'spender'),
                     'a spender edits nobody');
SELECT pg_temp.check((SELECT (v->'spend'->>'approver_gap')::boolean = false FROM d WHERE who = 'owner'),
                     'Helia: an admin approves besides the owner');
SELECT pg_temp.check((SELECT (v->'spend'->>'approver_gap')::boolean FROM d WHERE who = 'atlas'),
                     'Atlas: nobody besides the owner approves');
SELECT pg_temp.check((SELECT (v->'spend'->>'limits_plan_gated')::boolean FROM d WHERE who = 'owner'),
                     'Helia is on Business Free with the switch on: limits are plan-gated');
SELECT pg_temp.gates(false);
SELECT pg_temp.check(NOT (pg_temp.detail(pg_temp.id('priya'), 'heliafinance')->'spend'->>'limits_plan_gated')::boolean,
                     'with the switch off, nothing is plan-gated');
SELECT pg_temp.gates(true);
SELECT pg_temp.check((SELECT r->'ref'->>'project_slug' = 'prj-6ndtxa9u9x' AND (r->'ref'->>'stage_slug') LIKE 'stg-%'
                             AND r->>'ref_table' = 'project_stages' AND (r->'ref'->>'opens')::boolean
                             AND NOT (r->>'consumed')::boolean
                        FROM d, jsonb_array_elements(v->'spend'->'approvals'->'pending') r
                       WHERE who = 'owner' AND r->>'reason' NOT LIKE 'Probe%'
                       ORDER BY r->>'created_at' LIMIT 1),
                     'the seeded request says what it is for, and the owner can open it');
SELECT pg_temp.check((SELECT r->>'status' = 'withdrawn'
                        FROM d, jsonb_array_elements(v->'spend'->'approvals'->'decided') r
                       WHERE who = 'admin' AND (r->>'id')::uuid = pg_temp.id('req_a')),
                     'a withdrawn request is in the decided history');
SELECT pg_temp.check((SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'spend'->'approvals'->'pending') r
                                          WHERE (r->>'id')::uuid = pg_temp.id('req_a'))
                        FROM d WHERE who = 'admin'),
                     'and is no longer pending');
-- #endregion

ROLLBACK;
