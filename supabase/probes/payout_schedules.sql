-- =============================================================================================
-- Probe: payout schedules are written through their door and run as withdrawals by their author
-- (FINANCE_AUDIT A14; Decision #337, ruling M6; FINANCE_BUILD_PROMPTS DB4).
--
-- A schedule is a standing withdrawal: finance.save_payout_schedule writes it with a withdrawal's
-- authority and stamps its author, and finance.fn_claim_due_payout_schedules runs each due one as that
-- author through finance.begin_payout. Clients hold SELECT only. Checked here:
--   1. no write policy and no INSERT / UPDATE / DELETE privilege: a direct client write is 42501;
--   2. the door: author stamped, next slot set, Instant refused (`instant_payout_planned`), a threshold
--      below the minimum refused, another owner's destination refused, a wallet that is not there;
--   3. a spend-only member of a business vault cannot save one, directly or through the door; a
--      `withdraw` member can, and becomes its author;
--   4. the claim maths: weekly and monthly are due at their slot and advance to the next one, a
--      threshold is due once Available reaches it, a due run pays the whole of Available on the attempt
--      key `payout_schedule:<schedule>:<run_at>` and tags the payout, and a run below the minimum is
--      skipped without a strike; a claimed schedule is not claimed again;
--   5. a transfer Stripe refused (finance.fail_payout) counts once against its schedule;
--   6. a refusal (the author lost `withdraw`; no author at all) moves nothing and counts; the third in
--      a row pauses the schedule and tells the author; a paused schedule is not claimed; a save
--      starts it clean.
-- Two concurrent claims never returning one schedule is supabase/probes/payout_schedule_race.sql (it
-- commits, so it runs only against a disposable database).
--
-- Rollback-safe: one transaction, ends in ROLLBACK. now() is constant inside it, so each forced run
-- gets its own slot (`pg_temp.force_due`) and so its own attempt key. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/payout_schedules.sql
--
-- Fixture (seeded): a payout-ready freelancer with a verified Connect account and an active payout
-- method (not one of the shared-case people); business `heliafinance` (owner `priyaraman`), which
-- seats `theo` ({view, spend}) and `marisdelacroix` ({view, withdraw}) inside the transaction.
-- =============================================================================================
\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
\o /dev/null

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.uid(p_username text) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT user_id FROM org.users_public WHERE username = p_username;
$$;

CREATE FUNCTION pg_temp.setting(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT pg_catalog.current_setting('probe.' || p_name)::uuid;
$$;

-- Run one statement as a signed-in person: 'ok', or `<SQLSTATE>: <message>`. A refusal's
-- subtransaction is undone, which also restores the role and the claims.
CREATE FUNCTION pg_temp.try_as(p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
    PERFORM pg_catalog.set_config('request.jwt.claims',
        CASE WHEN p_uid IS NULL THEN '' ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END,
        true);
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    RESET ROLE;
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
    PERFORM pg_catalog.set_config('request.jwt.claims', '', true);
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ': ' || SQLERRM;
END $$;

-- The save door's call for an owner, as SQL text.
CREATE FUNCTION pg_temp.save_sql(
    p_owner_type text, p_owner uuid, p_currency text, p_mode text,
    p_threshold bigint DEFAULT NULL, p_method uuid DEFAULT NULL, p_instant boolean DEFAULT false
) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT pg_catalog.format(
        'SELECT finance.save_payout_schedule(%L, %L::uuid, %L, %L::finance.payout_mode, %s, %s, %L)',
        p_owner_type, p_owner, p_currency, p_mode,
        COALESCE(p_threshold::text, 'NULL'), COALESCE(pg_catalog.quote_literal(p_method) || '::uuid', 'NULL'),
        p_instant
    );
$$;

-- Move a wallet's Available to exactly `p_target` through the ledger functions (as postgres).
CREATE FUNCTION pg_temp.set_available(p_wallet uuid, p_target bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE w finance.wallets;
BEGIN
    SELECT * INTO STRICT w FROM finance.wallets WHERE id = p_wallet;
    IF p_target > w.balance_cents THEN
        PERFORM finance.fn_wallet_credit(w.owner_id, w.owner_type, w.currency, p_target - w.balance_cents, 'topup', 'probe', NULL);
    ELSIF p_target < w.balance_cents THEN
        PERFORM finance.fn_wallet_debit(w.owner_id, w.owner_type, w.currency, w.balance_cents - p_target, 'transfer_out', 'probe', NULL);
    END IF;
END $$;

-- Make a weekly / monthly schedule's slot come `p_minutes` ago: a distinct slot, so a distinct key.
CREATE FUNCTION pg_temp.force_due(p_schedule uuid, p_minutes integer) RETURNS void LANGUAGE sql AS $$
    UPDATE finance.payout_schedules
       SET next_run_at = pg_catalog.now() - pg_catalog.make_interval(mins => p_minutes)
     WHERE id = p_schedule;
$$;

-- One scheduler sweep (no identity), and this schedule's entry in it; NULL when it was not claimed.
CREATE FUNCTION pg_temp.claim_for(p_schedule uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_runs jsonb; v_entry jsonb;
BEGIN
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
    PERFORM pg_catalog.set_config('request.jwt.claims', '', true);
    v_runs := finance.fn_claim_due_payout_schedules(200);
    SELECT x INTO v_entry FROM pg_catalog.jsonb_array_elements(v_runs) x WHERE x ->> 'schedule_id' = p_schedule::text;
    RETURN v_entry;
END $$;

CREATE FUNCTION pg_temp.schedule(p_id uuid) RETURNS finance.payout_schedules LANGUAGE sql STABLE AS $$
    SELECT * FROM finance.payout_schedules WHERE id = p_id;
$$;

CREATE FUNCTION pg_temp.balance(p_wallet uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
    SELECT balance_cents FROM finance.wallets WHERE id = p_wallet;
$$;
-- #endregion

-- #region Fixture (as postgres)
SELECT pg_catalog.set_config('probe.f', (
    SELECT fp.user_id::text FROM org.freelancer_profiles fp
      JOIN org.users_public u ON u.user_id = fp.user_id
     WHERE u.username NOT IN ('marisdelacroix', 'theo', 'priyaraman')
       AND finance.fn_freelancer_payout_ready(fp.user_id)
       AND NOT org.fn_is_minor(fp.user_id)
       AND EXISTS (SELECT 1 FROM finance.payout_accounts a
                    WHERE a.owner_id = fp.user_id AND a.provider = 'stripe' AND a.status = 'verified')
       AND EXISTS (SELECT 1 FROM finance.payment_methods m
                    WHERE m.owner_id = fp.user_id AND m.owner_type IN ('user', 'freelancer')
                      AND m.method_role IN ('payout', 'both') AND m.status = 'active')
     ORDER BY fp.user_id LIMIT 1), true);
SELECT pg_catalog.set_config('probe.fw', finance.fn_ensure_wallet('freelancer', pg_temp.setting('f'), 'USD')::text, true);
SELECT pg_catalog.set_config('probe.method', (
    SELECT m.id::text FROM finance.payment_methods m
     WHERE m.owner_id = pg_temp.setting('f') AND m.owner_type IN ('user', 'freelancer')
       AND m.method_role IN ('payout', 'both') AND m.status = 'active'
     ORDER BY m.id LIMIT 1), true);
SELECT pg_catalog.set_config('probe.foreign_method', (
    SELECT m.id::text FROM finance.payment_methods m
     WHERE m.owner_id <> pg_temp.setting('f') AND m.method_role IN ('payout', 'both') AND m.status = 'active'
     ORDER BY m.id LIMIT 1), true);

DO $$
DECLARE
    v_b uuid;
    v_wallet uuid;
    v_role uuid;
BEGIN
    SELECT id INTO STRICT v_b FROM org.business_profiles WHERE slug = 'heliafinance';
    v_wallet := finance.fn_ensure_wallet('business', v_b, 'USD');
    SELECT id INTO STRICT v_role FROM org.business_roles WHERE business_id = v_b AND preset = 'member';
    INSERT INTO org.business_members (business_id, user_id, role_id, status)
    SELECT v_b, pg_temp.uid(u), v_role, 'active' FROM pg_catalog.unnest(ARRAY['theo', 'marisdelacroix']) AS u
    ON CONFLICT DO NOTHING;
    INSERT INTO finance.vault_permissions (wallet_id, member_user_id, capabilities)
    VALUES (v_wallet, pg_temp.uid('theo'), ARRAY['view', 'spend']::finance.vault_capability[]),
           (v_wallet, pg_temp.uid('marisdelacroix'), ARRAY['view', 'withdraw']::finance.vault_capability[])
    ON CONFLICT (wallet_id, member_user_id) DO UPDATE SET capabilities = EXCLUDED.capabilities;
    PERFORM pg_catalog.set_config('probe.biz', v_b::text, true);
    PERFORM pg_catalog.set_config('probe.bw', v_wallet::text, true);
END $$;

DO $$ BEGIN
    PERFORM pg_temp.ok(pg_catalog.current_setting('probe.f', true) <> ''
        AND pg_catalog.current_setting('probe.method', true) <> ''
        AND pg_catalog.current_setting('probe.foreign_method', true) <> '',
        'fixture: a payout-ready freelancer with a payout method, and another owner''s method');
END $$;
-- #endregion

-- #region 1. Clients only read: no write policy, no write privilege, a direct write is 42501
DO $$ BEGIN
    PERFORM pg_temp.ok(NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
         WHERE schemaname = 'finance' AND tablename = 'payout_schedules' AND cmd <> 'SELECT'),
        '1 finance.payout_schedules has SELECT policies only');
    PERFORM pg_temp.ok(
        NOT pg_catalog.has_table_privilege('authenticated', 'finance.payout_schedules', 'INSERT')
        AND NOT pg_catalog.has_table_privilege('authenticated', 'finance.payout_schedules', 'UPDATE')
        AND NOT pg_catalog.has_table_privilege('authenticated', 'finance.payout_schedules', 'DELETE')
        AND pg_catalog.has_table_privilege('authenticated', 'finance.payout_schedules', 'SELECT'),
        '1 authenticated holds SELECT only on finance.payout_schedules');
    PERFORM pg_temp.ok(
        pg_temp.try_as(pg_temp.setting('f'),
            'UPDATE finance.payout_schedules SET next_run_at = now(), failure_count = 0, created_by = NULL')
        LIKE '42501:%',
        '1 a direct client UPDATE is refused 42501, the owner''s own included');
    PERFORM pg_temp.ok(
        pg_temp.try_as(pg_temp.setting('f'), pg_catalog.format(
            'INSERT INTO finance.payout_schedules (owner_type, owner_id, currency, mode, next_run_at) VALUES (%L, %L, %L, %L, now())',
            'freelancer', pg_temp.setting('f'), 'EUR', 'scheduled_weekly'))
        LIKE '42501:%',
        '1 a direct client INSERT is refused 42501');
END $$;
-- #endregion

-- #region 2. The door: author, slot, Instant refused, threshold minimum, destination, wallet
DO $$
DECLARE s finance.payout_schedules;
BEGIN
    PERFORM pg_temp.ok(pg_temp.try_as(pg_temp.setting('f'), pg_temp.save_sql(
        'freelancer', pg_temp.setting('f'), 'usd', 'scheduled_weekly', NULL, pg_temp.setting('method'))) = 'ok',
        '2 the owner saves a weekly schedule through the door');
    SELECT * INTO s FROM finance.payout_schedules
     WHERE owner_type = 'freelancer' AND owner_id = pg_temp.setting('f') AND currency = 'USD';
    PERFORM pg_catalog.set_config('probe.s', s.id::text, true);
    PERFORM pg_temp.ok(s.created_by = pg_temp.setting('f') AND s.mode = 'scheduled_weekly' AND s.active
        AND s.failure_count = 0 AND s.last_error IS NULL AND NOT s.instant
        AND s.destination_method_id = pg_temp.setting('method') AND s.threshold_cents IS NULL,
        '2 the saved row: authored by the caller, active, clean, not instant, its destination');
    PERFORM pg_temp.ok(s.next_run_at = finance.fn_payout_schedule_next_run('scheduled_weekly', pg_catalog.now())
        AND EXTRACT(isodow FROM s.next_run_at AT TIME ZONE 'UTC') = 1
        AND (s.next_run_at AT TIME ZONE 'UTC')::time = '00:00',
        '2 its next run is the coming Monday, 00:00 UTC');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM security.audit_logs
                                WHERE action = 'payout_schedule.saved' AND entity_id = s.id
                                  AND user_id = pg_temp.setting('f')),
        '2 the save is audited');

    PERFORM pg_temp.ok(pg_temp.try_as(pg_temp.setting('f'), pg_temp.save_sql(
        'freelancer', pg_temp.setting('f'), 'USD', 'scheduled_weekly', NULL, NULL, true))
        LIKE '0A000: instant_payout_planned:%',
        '2 an Instant schedule is refused instant_payout_planned (ruling P3)');
    PERFORM pg_temp.ok(pg_temp.try_as(pg_temp.setting('f'), pg_temp.save_sql(
        'freelancer', pg_temp.setting('f'), 'USD', 'threshold', 999)) LIKE '22023: thresholdMinor:%',
        '2 a threshold below the USD minimum is refused');
    PERFORM pg_temp.ok(pg_temp.try_as(pg_temp.setting('f'), pg_temp.save_sql(
        'freelancer', pg_temp.setting('f'), 'USD', 'threshold', NULL)) LIKE '22023: thresholdMinor:%',
        '2 a threshold schedule needs its threshold');
    PERFORM pg_temp.ok(pg_temp.try_as(pg_temp.setting('f'), pg_temp.save_sql(
        'freelancer', pg_temp.setting('f'), 'USD', 'scheduled_weekly', NULL, pg_temp.setting('foreign_method')))
        LIKE '42501: destinationId:%',
        '2 another owner''s payout method is refused as a destination');
    PERFORM pg_temp.ok(pg_temp.try_as(pg_temp.setting('f'), pg_temp.save_sql(
        'freelancer', pg_temp.setting('f'), 'ZAR', 'scheduled_weekly')) LIKE 'P0002:%',
        '2 a currency the owner holds no wallet in is refused');
    PERFORM pg_temp.ok(pg_temp.try_as(NULL, pg_temp.save_sql(
        'freelancer', pg_temp.setting('f'), 'USD', 'manual')) LIKE '42501:%',
        '2 nobody signed in saves nothing');
    PERFORM pg_temp.ok(pg_temp.try_as(pg_temp.uid('theo'), pg_temp.save_sql(
        'freelancer', pg_temp.setting('f'), 'USD', 'manual')) LIKE '42501:%',
        '2 somebody else cannot save a person''s schedule');
    PERFORM pg_temp.ok((pg_temp.schedule(pg_temp.setting('s'))).mode = 'scheduled_weekly',
        '2 no refused save changed the schedule');
END $$;
-- #endregion

-- #region 3. A shared vault: a spend-only member cannot save; a withdraw member can and authors it
DO $$
DECLARE v_bs uuid;
BEGIN
    PERFORM pg_temp.ok(pg_temp.try_as(pg_temp.uid('theo'), pg_temp.save_sql(
        'business', pg_temp.setting('biz'), 'USD', 'scheduled_weekly')) LIKE '42501: auth:%',
        '3 a spend-only member cannot save the vault''s schedule through the door');
    PERFORM pg_temp.ok(pg_temp.try_as(pg_temp.uid('theo'), pg_catalog.format(
        'UPDATE finance.payout_schedules SET mode = %L WHERE owner_id = %L', 'manual', pg_temp.setting('biz')))
        LIKE '42501:%',
        '3 nor directly');
    PERFORM pg_temp.ok(pg_temp.try_as(pg_temp.uid('marisdelacroix'), pg_temp.save_sql(
        'business', pg_temp.setting('biz'), 'USD', 'scheduled_weekly')) = 'ok',
        '3 a withdraw member saves it');
    SELECT id INTO STRICT v_bs FROM finance.payout_schedules
     WHERE owner_type = 'business' AND owner_id = pg_temp.setting('biz') AND currency = 'USD';
    PERFORM pg_catalog.set_config('probe.bs', v_bs::text, true);
    PERFORM pg_temp.ok((pg_temp.schedule(v_bs)).created_by = pg_temp.uid('marisdelacroix'),
        '3 and becomes its author');
END $$;
-- #endregion

-- #region 4. The claim maths: weekly · monthly · threshold · below the minimum
DO $$
DECLARE
    v_s uuid := pg_temp.setting('s');
    v_fw uuid := pg_temp.setting('fw');
    e jsonb;
    s finance.payout_schedules;
    p finance.payouts;
    v_run_at timestamptz;
BEGIN
    PERFORM pg_temp.ok(
        finance.fn_payout_schedule_next_run('scheduled_weekly', '2026-11-11 12:00Z') = '2026-11-16 00:00Z'
        AND finance.fn_payout_schedule_next_run('scheduled_weekly', '2026-11-16 00:00Z') = '2026-11-23 00:00Z'
        AND finance.fn_payout_schedule_next_run('scheduled_monthly', '2026-11-12 09:30Z') = '2026-12-01 00:00Z'
        AND finance.fn_payout_schedule_next_run('scheduled_monthly', '2026-12-01 00:00Z') = '2027-01-01 00:00Z'
        AND finance.fn_payout_schedule_next_run('threshold', '2026-11-12 09:30Z') IS NULL
        AND finance.fn_payout_schedule_next_run('manual', '2026-11-12 09:30Z') IS NULL,
        '4 the slots: the coming Monday or the 1st, 00:00 UTC, strictly later (payout-schedules.test.ts holds the same)');

    -- Weekly, not due yet: not claimed.
    PERFORM pg_temp.set_available(v_fw, 50000);
    PERFORM pg_temp.ok(pg_temp.claim_for(v_s) IS NULL, '4 weekly: a slot still ahead is not claimed');

    -- Weekly, due: the whole of Available, as the author, on the run's key, tagged with the schedule.
    PERFORM pg_temp.force_due(v_s, 1);
    v_run_at := (pg_temp.schedule(v_s)).next_run_at;
    e := pg_temp.claim_for(v_s);
    PERFORM pg_temp.ok(e ->> 'outcome' = 'begun' AND (e ->> 'amount_cents')::bigint = 50000
        AND (e ->> 'run_at')::timestamptz = v_run_at AND e ->> 'destination' IS NOT NULL,
        '4 weekly: due at its slot, it pays the whole of Available (50000) to the Connect account');
    SELECT * INTO p FROM finance.payouts WHERE id = (e -> 'payout' ->> 'id')::uuid;
    PERFORM pg_temp.ok(p.status = 'pending' AND p.schedule_id = v_s AND p.amount_cents = 50000
        AND p.wallet_id = v_fw AND NOT p.instant AND p.destination_method_id = pg_temp.setting('method')
        AND (e -> 'payout' ->> 'schedule_id')::uuid = v_s,
        '4 weekly: one pending payout, tagged with its schedule, to the schedule''s destination');
    PERFORM pg_temp.ok(pg_temp.balance(v_fw) = 0, '4 weekly: the wallet was debited once, by everything Available');
    PERFORM pg_temp.ok(EXISTS (
        SELECT 1 FROM finance.idempotency_keys k
         WHERE k.key = 'payout_schedule:' || v_s::text || ':' || pg_catalog.to_char(v_run_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS')
           AND k.scope = 'payout:' || pg_temp.setting('f')::text
           AND (k.response ->> 'payout_id')::uuid = p.id),
        '4 weekly: begin_payout recorded the attempt key payout_schedule:<schedule>:<run_at> in the author''s scope');
    s := pg_temp.schedule(v_s);
    PERFORM pg_temp.ok(s.next_run_at = finance.fn_payout_schedule_next_run('scheduled_weekly', pg_catalog.now())
        AND s.next_run_at > pg_catalog.now() AND s.last_run_at = pg_catalog.now()
        AND s.failure_count = 0 AND s.last_error IS NULL,
        '4 weekly: it advanced to the next Monday and records the run');
    PERFORM pg_temp.ok(pg_temp.claim_for(v_s) IS NULL, '4 weekly: a claimed schedule is not claimed again');

    -- Below the minimum: skipped, advanced, no strike, nothing paid.
    PERFORM pg_temp.set_available(v_fw, 999);
    PERFORM pg_temp.force_due(v_s, 2);
    e := pg_temp.claim_for(v_s);
    s := pg_temp.schedule(v_s);
    PERFORM pg_temp.ok(e ->> 'outcome' = 'skipped' AND e ->> 'detail' = 'below_minimum' AND e -> 'payout' IS NULL
        AND pg_temp.balance(v_fw) = 999 AND s.failure_count = 0 AND s.next_run_at > pg_catalog.now()
        AND (SELECT count(*) FROM finance.payouts WHERE schedule_id = v_s) = 1,
        '4 below the minimum (999 < 1000 USD): skipped, advanced, no strike, no payout');

    -- Monthly: the 1st, then the next month's 1st.
    PERFORM pg_temp.ok(pg_temp.try_as(pg_temp.setting('f'), pg_temp.save_sql(
        'freelancer', pg_temp.setting('f'), 'USD', 'scheduled_monthly', NULL, pg_temp.setting('method'))) = 'ok',
        '4 monthly: saved');
    s := pg_temp.schedule(v_s);
    PERFORM pg_temp.ok(s.next_run_at = finance.fn_payout_schedule_next_run('scheduled_monthly', pg_catalog.now())
        AND EXTRACT(day FROM s.next_run_at AT TIME ZONE 'UTC') = 1,
        '4 monthly: its next run is the 1st, 00:00 UTC');
    PERFORM pg_temp.set_available(v_fw, 120000);
    PERFORM pg_temp.ok(pg_temp.claim_for(v_s) IS NULL, '4 monthly: not due before the 1st');
    PERFORM pg_temp.force_due(v_s, 3);
    e := pg_temp.claim_for(v_s);
    s := pg_temp.schedule(v_s);
    PERFORM pg_temp.ok(e ->> 'outcome' = 'begun' AND (e ->> 'amount_cents')::bigint = 120000
        AND pg_temp.balance(v_fw) = 0
        AND s.next_run_at = finance.fn_payout_schedule_next_run('scheduled_monthly', pg_catalog.now()),
        '4 monthly: due, it pays the whole of Available (120000) and advances to the next 1st');

    -- Threshold: due once Available reaches it, on no date.
    PERFORM pg_temp.ok(pg_temp.try_as(pg_temp.setting('f'), pg_temp.save_sql(
        'freelancer', pg_temp.setting('f'), 'USD', 'threshold', 20000, pg_temp.setting('method'))) = 'ok',
        '4 threshold: saved at 20000');
    PERFORM pg_temp.ok((pg_temp.schedule(v_s)).next_run_at IS NULL, '4 threshold: it has no slot');
    PERFORM pg_temp.set_available(v_fw, 19999);
    PERFORM pg_temp.ok(pg_temp.claim_for(v_s) IS NULL, '4 threshold: 19999 has not reached 20000');
    PERFORM pg_temp.set_available(v_fw, 25000);
    e := pg_temp.claim_for(v_s);
    PERFORM pg_temp.ok(e ->> 'outcome' = 'begun' AND (e ->> 'amount_cents')::bigint = 25000
        AND pg_temp.balance(v_fw) = 0,
        '4 threshold: at 25000 it pays everything Available, not the threshold');
    PERFORM pg_catalog.set_config('probe.threshold_payout', e -> 'payout' ->> 'id', true);
    PERFORM pg_temp.ok(pg_temp.claim_for(v_s) IS NULL, '4 threshold: once paid, Available is below it again');
END $$;
-- #endregion

-- #region 5. A transfer Stripe refused counts once against its schedule
DO $$
DECLARE
    v_s uuid := pg_temp.setting('s');
    s finance.payout_schedules;
BEGIN
    PERFORM finance.fail_payout(pg_temp.setting('threshold_payout'), 'account_closed');
    s := pg_temp.schedule(v_s);
    PERFORM pg_temp.ok(pg_temp.balance(pg_temp.setting('fw')) = 25000
        AND s.failure_count = 1 AND s.active
        AND s.last_error = 'Stripe couldn''t send the payout (account_closed).',
        '5 the money is back, and the refusal counts once against the schedule');
    PERFORM finance.fail_payout(pg_temp.setting('threshold_payout'), 'account_closed');
    PERFORM pg_temp.ok((pg_temp.schedule(v_s)).failure_count = 1, '5 a replayed failure counts nothing more');
END $$;
-- #endregion

-- #region 6. Refusals move nothing and count; three in a row pause and tell the author
DO $$
DECLARE
    v_bs uuid := pg_temp.setting('bs');
    v_bw uuid := pg_temp.setting('bw');
    v_maris uuid := pg_temp.uid('marisdelacroix');
    e jsonb;
    s finance.payout_schedules;
    i integer;
BEGIN
    -- The author loses `withdraw`; the vault holds enough to pay.
    UPDATE finance.vault_permissions SET capabilities = ARRAY['view']::finance.vault_capability[]
     WHERE wallet_id = v_bw AND member_user_id = v_maris;
    PERFORM pg_temp.set_available(v_bw, 50000);
    FOR i IN 1..3 LOOP
        PERFORM pg_temp.force_due(v_bs, 10 + i);
        e := pg_temp.claim_for(v_bs);
        s := pg_temp.schedule(v_bs);
        PERFORM pg_temp.ok(e ->> 'outcome' = 'refused' AND e ->> 'code' = '42501' AND e -> 'payout' IS NULL
            AND pg_temp.balance(v_bw) = 50000 AND s.failure_count = i
            AND s.last_error = 'You can''t withdraw from this wallet.'
            AND (e ->> 'paused')::boolean = (i = 3) AND s.active = (i < 3),
            pg_catalog.format('6 refusal %s: the author lost withdraw, nothing moved, it counts (%s in a row)', i, i));
    END LOOP;
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM finance.payouts WHERE schedule_id = v_bs),
        '6 no payout was ever begun for it');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM comms.notifications
                                WHERE user_id = v_maris AND type = 'payout.schedule_paused'
                                  AND entity_table = 'payout_schedules' AND entity_id = v_bs),
        '6 the third refusal paused it and told its author');
    PERFORM pg_temp.force_due(v_bs, 20);
    PERFORM pg_temp.ok(pg_temp.claim_for(v_bs) IS NULL, '6 a paused schedule is never claimed');

    PERFORM pg_temp.ok(pg_temp.try_as(pg_temp.uid('priyaraman'), pg_temp.save_sql(
        'business', pg_temp.setting('biz'), 'USD', 'scheduled_weekly')) = 'ok',
        '6 the owner saves it again');
    s := pg_temp.schedule(v_bs);
    PERFORM pg_temp.ok(s.active AND s.failure_count = 0 AND s.last_error IS NULL
        AND s.created_by = pg_temp.uid('priyaraman') AND s.next_run_at > pg_catalog.now(),
        '6 a save starts it clean, authored by whoever saved it');

    -- No author at all (the account that set it up is gone): refused the same way.
    UPDATE finance.payout_schedules SET created_by = NULL WHERE id = pg_temp.setting('s');
    PERFORM pg_temp.set_available(pg_temp.setting('fw'), 30000);
    e := pg_temp.claim_for(pg_temp.setting('s'));
    PERFORM pg_temp.ok(e ->> 'outcome' = 'refused' AND e ->> 'code' = '42501'
        AND e ->> 'detail' = 'The person who set up these payouts is no longer available.'
        AND pg_temp.balance(pg_temp.setting('fw')) = 30000,
        '6 a schedule nobody authorised pays nothing out');
END $$;
-- #endregion

-- #region 7. Grants: the scheduler's door is service_role's; the helpers are nobody's
DO $$ BEGIN
    PERFORM pg_temp.ok(
        pg_catalog.has_function_privilege('authenticated', 'finance.save_payout_schedule(text, uuid, text, finance.payout_mode, bigint, uuid, boolean)', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('anon', 'finance.save_payout_schedule(text, uuid, text, finance.payout_mode, bigint, uuid, boolean)', 'EXECUTE'),
        '7 save_payout_schedule: authenticated only');
    PERFORM pg_temp.ok(
        pg_catalog.has_function_privilege('service_role', 'finance.fn_claim_due_payout_schedules(integer)', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', 'finance.fn_claim_due_payout_schedules(integer)', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('anon', 'finance.fn_claim_due_payout_schedules(integer)', 'EXECUTE'),
        '7 fn_claim_due_payout_schedules: service_role only');
    PERFORM pg_temp.ok(
        NOT pg_catalog.has_function_privilege('authenticated', 'finance.fn_payout_schedule_strike(uuid, text)', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('service_role', 'finance.fn_payout_schedule_strike(uuid, text)', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', 'finance.fn_payout_schedule_available(finance.wallets)', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', 'finance.fn_payout_schedule_next_run(finance.payout_mode, timestamptz)', 'EXECUTE'),
        '7 the strike and the two calculators are internal');
END $$;
-- #endregion

\o
\echo PASS payout_schedules
ROLLBACK;
