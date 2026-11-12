-- =============================================================================================
-- Probe: the money-door gaps FINANCE_BUILD_PROMPTS DB3 closes (FINANCE_AUDIT K4, V4, A16, S4, L9, V2,
-- L8). Each refusal and each allowed path:
--
--   1. K4: an unverified ENTERPRISE vault is refused by the spend gate, by transfer_funds and by
--      begin_payout (PK403); once verified, each passes KYB (the payout then stops at its destination).
--   2. V4: transfer_funds INTO a team vault needs the payer's add_funds (PK403 missing_permission).
--   3. A16: finance.fn_expire_spend_approvals expires pending requests past expires_at, and only those.
--   4. S4: with no platform_fee_bp the fee resolver raises PX500 instead of returning 0.
--   5. L9: a ticket release, a fair-exit split and a seat forfeit are refused (PD409 dispute_open)
--      while a dispute is open on the escrow, and go through without one.
--   6. V2: changing a team's or a business's owner re-projects the vault (manage_members moves).
--   7. L8: finance.fn_sweep_idempotency_keys deletes keys expired over 30 days ago, never a Stripe
--      event claim, a recent key or one with no expiry.
--   8. Both sweeps resolve by bare name, which is how 00005060's dormant jobs find them.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/finance_doors.sql
--
-- Fixtures come from the seed (deno task db:reset) or are inserted as postgres; each section sits
-- between a SAVEPOINT and a ROLLBACK TO. A clean run prints only `ok` notices.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region 0. Helpers + fixtures (as postgres)
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key);
$$;

CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', p_uid::text, true),
           pg_catalog.set_config('request.jwt.claims',
               pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Run one statement and answer `ok`, or `SQLSTATE: message` when it raised.
CREATE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ': ' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.bal(p_wallet uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT balance_cents FROM finance.wallets WHERE id = p_wallet;
$$;

CREATE FUNCTION pg_temp.caps(p_wallet uuid, p_user uuid) RETURNS finance.vault_capability[] LANGUAGE sql AS $$
    SELECT capabilities FROM finance.vault_permissions WHERE wallet_id = p_wallet AND member_user_id = p_user;
$$;

DO $$
DECLARE
    v_uw finance.wallets;
BEGIN
    SELECT w.* INTO v_uw
      FROM finance.wallets w
      JOIN auth.users u ON u.id = w.owner_id
     WHERE w.owner_type = 'user' AND NOT org.fn_is_minor(w.owner_id)
     ORDER BY w.id LIMIT 1;
    IF v_uw.id IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixtures: no seeded adult user wallet (run deno task db:reset)';
    END IF;
    PERFORM pg_catalog.set_config('probe.user', v_uw.owner_id::text, true);
    PERFORM pg_catalog.set_config('probe.uwallet', v_uw.id::text, true);
    PERFORM pg_catalog.set_config('probe.currency', v_uw.currency, true);
END $$;
-- #endregion

-- #region 1. K4: an enterprise vault's KYB
SAVEPOINT s_k4;
DO $$
DECLARE
    v_user uuid := pg_temp.s('user')::uuid;
    v_cur text := pg_temp.s('currency');
    v_ent uuid;
    v_ew uuid;
    v_out text;
BEGIN
    INSERT INTO org.enterprises (owner_user_id, legal_name, handle, corporate_email, status, verification_level)
    VALUES (v_user, 'Probe Enterprise Ltd', 'probe-db3-ent', 'probe@example.invalid', 'active', 'kyb_pending')
    RETURNING id INTO v_ent;
    v_ew := finance.fn_ensure_wallet('enterprise', v_ent, v_cur);
    INSERT INTO finance.vault_permissions (wallet_id, member_user_id, capabilities)
    VALUES (v_ew, v_user, ARRAY['view', 'add_funds', 'spend', 'withdraw']::finance.vault_capability[]);
    PERFORM finance.fn_wallet_credit(v_ent, 'enterprise', v_cur, 500000, 'topup', NULL, NULL);
    PERFORM pg_catalog.set_config('probe.ent', v_ent::text, true);
    PERFORM pg_catalog.set_config('probe.ewallet', v_ew::text, true);

    PERFORM pg_temp.ok(finance.fn_kyb_missing('enterprise', v_ent) AND NOT finance.fn_kyb_missing('team', v_ent)
        AND NOT finance.fn_kyb_missing('user', v_user),
        '1 fn_kyb_missing: an unverified enterprise lacks KYB; a team or a person needs none');

    v_out := pg_temp.try(pg_catalog.format(
        'SELECT finance.fn_assert_business_spend(%L, %L, 100, %L, %L)', v_ew, v_user, 'transfers', v_ew));
    PERFORM pg_temp.ok(v_out LIKE 'PK403: kyb_required%', '1 the spend gate refuses an unverified enterprise vault: ' || v_out);

    PERFORM pg_temp.act(v_user);
    v_out := pg_temp.try(pg_catalog.format(
        'SELECT finance.transfer_funds(%L, %L, 100, NULL, %L)', v_ew, pg_temp.s('uwallet'), 'probe-db3-k4-transfer'));
    PERFORM pg_temp.ok(v_out LIKE 'PK403: kyb_required%' AND pg_temp.bal(v_ew) = 500000,
        '1 transfer_funds refuses to move an unverified enterprise''s money: ' || v_out);
    v_out := pg_temp.try(pg_catalog.format(
        'SELECT finance.begin_payout(%L, 2000, %L, false, %L)', v_ew, v_cur, 'probe-db3-k4-payout'));
    PERFORM pg_temp.ok(v_out LIKE 'PK403: verification: this enterprise must be verified%',
        '1 begin_payout refuses an unverified enterprise vault: ' || v_out);

    UPDATE org.enterprises SET verification_level = 'verified' WHERE id = v_ent;
    PERFORM pg_temp.ok(NOT finance.fn_kyb_missing('enterprise', v_ent), '1 a verified enterprise has its KYB');
    v_out := pg_temp.try(pg_catalog.format(
        'SELECT finance.transfer_funds(%L, %L, 100, NULL, %L)', v_ew, pg_temp.s('uwallet'), 'probe-db3-k4-transfer2'));
    PERFORM pg_temp.ok(v_out = 'ok' AND pg_temp.bal(v_ew) = 500000 - 100,
        '1 once verified, transfer_funds moves the enterprise''s money: ' || v_out);
    v_out := pg_temp.try(pg_catalog.format(
        'SELECT finance.begin_payout(%L, 2000, %L, false, %L)', v_ew, v_cur, 'probe-db3-k4-payout2'));
    PERFORM pg_temp.ok(v_out NOT LIKE 'PK403%',
        '1 once verified, begin_payout passes KYB (and stops at the next check): ' || v_out);
END $$;
ROLLBACK TO SAVEPOINT s_k4;
-- #endregion

-- #region 2. V4: paying into a vault needs add_funds
SAVEPOINT s_v4;
DO $$
DECLARE
    v_team uuid;
    v_member uuid;
    v_tw finance.wallets;
    v_mw uuid;
    v_out text;
BEGIN
    SELECT t.id, m.user_id INTO v_team, v_member
      FROM org.teams t
      JOIN org.team_members m ON m.team_id = t.id AND m.status = 'active' AND m.user_id <> t.owner_user_id
     WHERE EXISTS (SELECT 1 FROM finance.wallets w WHERE w.owner_type = 'team' AND w.owner_id = t.id)
     ORDER BY t.id, m.user_id LIMIT 1;
    IF v_team IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixtures: no seeded team with a wallet and a non-owner member';
    END IF;
    SELECT * INTO v_tw FROM finance.wallets WHERE owner_type = 'team' AND owner_id = v_team ORDER BY id LIMIT 1;
    v_mw := finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_member), v_member, v_tw.currency);
    PERFORM finance.fn_wallet_credit(v_member, finance.fn_person_wallet_type(v_member), v_tw.currency, 5000,
        'topup', NULL, NULL);
    INSERT INTO finance.vault_permissions (wallet_id, member_user_id, capabilities)
    VALUES (v_tw.id, v_member, ARRAY['view']::finance.vault_capability[])
    ON CONFLICT (wallet_id, member_user_id) DO UPDATE SET capabilities = EXCLUDED.capabilities;

    PERFORM pg_temp.act(v_member);
    v_out := pg_temp.try(pg_catalog.format(
        'SELECT finance.transfer_funds(%L, %L, 700, NULL, %L)', v_mw, v_tw.id, 'probe-db3-v4-a'));
    PERFORM pg_temp.ok(v_out LIKE 'PK403: missing_permission: add_funds%' AND pg_temp.bal(v_mw) >= 5000,
        '2 a member without add_funds cannot pay into the team vault: ' || v_out);

    UPDATE finance.vault_permissions SET capabilities = ARRAY['view', 'add_funds']::finance.vault_capability[]
     WHERE wallet_id = v_tw.id AND member_user_id = v_member;
    v_out := pg_temp.try(pg_catalog.format(
        'SELECT finance.transfer_funds(%L, %L, 700, NULL, %L)', v_mw, v_tw.id, 'probe-db3-v4-b'));
    PERFORM pg_temp.ok(v_out = 'ok' AND pg_temp.bal(v_tw.id) = v_tw.balance_cents + 700,
        '2 with add_funds the same member pays in: ' || v_out);
END $$;
ROLLBACK TO SAVEPOINT s_v4;
-- #endregion

-- #region 3. A16: the spend-approval expiry sweep
SAVEPOINT s_a16;
DO $$
DECLARE
    v_user uuid := pg_temp.s('user')::uuid;
    v_wallet uuid := pg_temp.s('uwallet')::uuid;
    v_lapsed uuid;
    v_live uuid;
    v_decided uuid;
    v_n integer;
BEGIN
    INSERT INTO finance.spend_approvals (wallet_id, requested_by, amount_cents, currency, reason, ref_table, ref_id,
        status, expires_at, created_at)
    VALUES (v_wallet, v_user, 900, pg_temp.s('currency'), 'probe lapsed', 'transfers', gen_random_uuid(),
        'pending', now() - interval '1 hour', now() - interval '8 days')
    RETURNING id INTO v_lapsed;
    INSERT INTO finance.spend_approvals (wallet_id, requested_by, amount_cents, currency, reason, ref_table, ref_id,
        status, expires_at)
    VALUES (v_wallet, v_user, 900, pg_temp.s('currency'), 'probe live', 'transfers', gen_random_uuid(),
        'pending', now() + interval '6 days')
    RETURNING id INTO v_live;
    INSERT INTO finance.spend_approvals (wallet_id, requested_by, amount_cents, currency, reason, ref_table, ref_id,
        status, approver_user_id, decided_at, expires_at)
    VALUES (v_wallet, v_user, 900, pg_temp.s('currency'), 'probe decided', 'transfers', gen_random_uuid(),
        'approved', v_user, now() - interval '2 hours', now() - interval '1 hour')
    RETURNING id INTO v_decided;

    v_n := finance.fn_expire_spend_approvals();
    PERFORM pg_temp.ok(v_n >= 1
        AND (SELECT status::text FROM finance.spend_approvals WHERE id = v_lapsed) = 'expired'
        AND (SELECT decided_at IS NULL AND approver_user_id IS NULL FROM finance.spend_approvals WHERE id = v_lapsed),
        '3 a pending request past expires_at is expired, stamping nothing');
    PERFORM pg_temp.ok((SELECT status::text FROM finance.spend_approvals WHERE id = v_live) = 'pending'
        AND (SELECT status::text FROM finance.spend_approvals WHERE id = v_decided) = 'approved',
        '3 a live request and a decided one are left as they are');
    PERFORM pg_temp.ok(NOT EXISTS (
        SELECT 1 FROM finance.spend_approvals WHERE status = 'pending' AND expires_at <= now()),
        '3 no pending request past its expiry is left anywhere');
    PERFORM pg_temp.ok(finance.fn_expire_spend_approvals() = 0, '3 a second run expires nothing');
END $$;
ROLLBACK TO SAVEPOINT s_a16;
-- #endregion

-- #region 4. S4: a missing fee param raises
SAVEPOINT s_s4;
DO $$
DECLARE
    v_user uuid := pg_temp.s('user')::uuid;
    v_bp integer;
    v_out text;
BEGIN
    SELECT (value #>> '{}')::integer INTO v_bp FROM security.platform_params WHERE key = 'platform_fee_bp';
    PERFORM pg_temp.ok(v_bp IS NOT NULL AND finance.fn_effective_platform_fee_bp('user', v_user) = v_bp
        AND finance.fn_escrow_fee_bp(NULL, v_user) = v_bp,
        '4 with the param set, the fee is the param (' || COALESCE(v_bp::text, 'unset') || ' bp)');
    DELETE FROM security.platform_params WHERE key = 'platform_fee_bp';
    v_out := pg_temp.try(pg_catalog.format('SELECT finance.fn_effective_platform_fee_bp(%L, %L)', 'user', v_user));
    PERFORM pg_temp.ok(v_out LIKE 'PX500: platform_fee_not_configured%',
        '4 with no param, the resolver raises instead of waiving the fee: ' || v_out);
    v_out := pg_temp.try(pg_catalog.format('SELECT finance.fn_escrow_fee_bp(NULL, %L)', v_user));
    PERFORM pg_temp.ok(v_out LIKE 'PX500%', '4 so does every release''s fee: ' || v_out);
END $$;
ROLLBACK TO SAVEPOINT s_s4;
-- #endregion

-- #region 5. L9: no release while a dispute is open
SAVEPOINT s_l9_ticket;
DO $$
DECLARE
    v_e finance.escrows;
    v_out text;
BEGIN
    SELECT * INTO v_e FROM finance.escrows
     WHERE status = 'held' AND ticket_id IS NOT NULL AND revision_id IS NULL
       AND payee_type = 'freelancer' AND payee_id IS NOT NULL
     ORDER BY id LIMIT 1;
    IF v_e.id IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixtures: no seeded held ticket escrow with a freelancer payee';
    END IF;
    PERFORM pg_catalog.set_config('probe.escrow', v_e.id::text, true);
    PERFORM pg_catalog.set_config('probe.ticket', v_e.ticket_id::text, true);
    INSERT INTO finance.disputes (escrow_id, opened_by_profile, reason)
    VALUES (v_e.id, COALESCE(v_e.payer_user_id, v_e.payee_id), 'probe: work not delivered');

    v_out := pg_temp.try(pg_catalog.format('SELECT finance.fn_release_ticket_escrow(%L)', v_e.ticket_id));
    PERFORM pg_temp.ok(v_out LIKE 'PD409: dispute_open%' AND (SELECT status FROM finance.escrows WHERE id = v_e.id) = 'held',
        '5 a ticket release waits for an open dispute: ' || v_out);
    v_out := pg_temp.try(pg_catalog.format('SELECT finance.fn_fair_exit_release(%L, 5000)', v_e.ticket_id));
    PERFORM pg_temp.ok(v_out LIKE 'PD409: dispute_open%' AND (SELECT status FROM finance.escrows WHERE id = v_e.id) = 'held',
        '5 so does a fair-exit split: ' || v_out);
END $$;
ROLLBACK TO SAVEPOINT s_l9_ticket;

SAVEPOINT s_l9_ticket_ok;
DO $$
DECLARE
    v_out text;
BEGIN
    v_out := pg_temp.try(pg_catalog.format('SELECT finance.fn_release_ticket_escrow(%L)', pg_temp.s('ticket')));
    PERFORM pg_temp.ok(v_out = 'ok' AND (SELECT status FROM finance.escrows WHERE id = pg_temp.s('escrow')::uuid) = 'released',
        '5 without a dispute the same escrow is released: ' || v_out);
END $$;
ROLLBACK TO SAVEPOINT s_l9_ticket_ok;

-- A seat with one sitting two hours away, so an attendee's cancel forfeits it to the host.
DO $$
DECLARE
    v_project uuid; v_stage uuid; v_host uuid; v_a uuid;
    v_cohort uuid; v_member uuid; v_event uuid; v_escrow uuid;
BEGIN
    SELECT p.id, s.id, p.owner_user_id INTO v_project, v_stage, v_host
      FROM projects.projects p JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.owner_user_id IS NOT NULL AND p.owner_team_id IS NULL
     ORDER BY p.id, s.id LIMIT 1;
    SELECT u.user_id INTO v_a FROM org.users_public u
     WHERE u.user_id <> v_host AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name)
    VALUES (v_project, v_stage, 'Probe DB3 forfeit') RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, v_a) RETURNING id INTO v_member;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, status)
    VALUES (v_cohort, 'Probe DB3 forfeit', now() + interval '2 hours', now() + interval '3 hours', 'scheduled')
    RETURNING id INTO v_event;
    INSERT INTO finance.escrows (project_stage_id, cohort_membership_id, session_event_id, payer_user_id,
                                 payee_type, payee_id, amount_cents, currency, status)
    VALUES (v_stage, v_member, v_event, v_a, 'freelancer', v_host, 10000, 'GBP', 'held')
    RETURNING id INTO v_escrow;
    PERFORM pg_catalog.set_config('probe.attendee', v_a::text, true);
    PERFORM pg_catalog.set_config('probe.seat', v_member::text, true);
    PERFORM pg_catalog.set_config('probe.seat_escrow', v_escrow::text, true);
    PERFORM pg_catalog.set_config('probe.seat_event', v_event::text, true);
END $$;

SAVEPOINT s_l9_forfeit;
DO $$
DECLARE
    v_escrow uuid := pg_temp.s('seat_escrow')::uuid;
    v_out text;
BEGIN
    INSERT INTO finance.disputes (escrow_id, session_event_id, opened_by_profile, reason)
    VALUES (v_escrow, pg_temp.s('seat_event')::uuid, pg_temp.s('attendee')::uuid, 'probe: host no-show');
    PERFORM pg_temp.act(pg_temp.s('attendee')::uuid);
    v_out := pg_temp.try(pg_catalog.format('SELECT projects.cancel_cohort_membership(%L)', pg_temp.s('seat')));
    PERFORM pg_temp.ok(v_out LIKE 'PD409: dispute_open%' AND (SELECT status FROM finance.escrows WHERE id = v_escrow) = 'held',
        '5 a late cancel does not forfeit a seat whose escrow is disputed: ' || v_out);
END $$;
ROLLBACK TO SAVEPOINT s_l9_forfeit;

SAVEPOINT s_l9_forfeit_ok;
DO $$
DECLARE
    v_escrow uuid := pg_temp.s('seat_escrow')::uuid;
    v_out text;
BEGIN
    PERFORM pg_temp.act(pg_temp.s('attendee')::uuid);
    v_out := pg_temp.try(pg_catalog.format('SELECT projects.cancel_cohort_membership(%L)', pg_temp.s('seat')));
    PERFORM pg_temp.ok(v_out = 'ok' AND (SELECT status FROM finance.escrows WHERE id = v_escrow) = 'released',
        '5 without a dispute the late cancel forfeits the seat to the host: ' || v_out);
END $$;
ROLLBACK TO SAVEPOINT s_l9_forfeit_ok;
-- #endregion

-- #region 6. V2: an owner change re-projects the vault
SAVEPOINT s_v2;
DO $$
DECLARE
    v_kind text;
    v_entity uuid;
    v_owner uuid;
    v_next uuid;
    v_wallet uuid;
BEGIN
    FOREACH v_kind IN ARRAY ARRAY['team', 'business'] LOOP
        IF v_kind = 'team' THEN
            SELECT t.id, t.owner_user_id, m.user_id INTO v_entity, v_owner, v_next
              FROM org.teams t
              JOIN org.team_members m ON m.team_id = t.id AND m.status = 'active' AND m.user_id <> t.owner_user_id
             WHERE EXISTS (SELECT 1 FROM finance.wallets w WHERE w.owner_type = 'team' AND w.owner_id = t.id)
             ORDER BY t.id, m.user_id LIMIT 1;
        ELSE
            SELECT b.id, b.owner_user_id, m.user_id INTO v_entity, v_owner, v_next
              FROM org.business_profiles b
              JOIN org.business_members m ON m.business_id = b.id AND m.status = 'active' AND m.user_id <> b.owner_user_id
             WHERE EXISTS (SELECT 1 FROM finance.wallets w WHERE w.owner_type = 'business' AND w.owner_id = b.id)
             ORDER BY b.id, m.user_id LIMIT 1;
        END IF;
        IF v_entity IS NULL THEN
            RAISE EXCEPTION 'PROBE FAIL: fixtures: no seeded % with a wallet and a non-owner member', v_kind;
        END IF;
        SELECT w.id INTO v_wallet FROM finance.wallets w WHERE w.owner_type = v_kind AND w.owner_id = v_entity
         ORDER BY w.id LIMIT 1;
        PERFORM pg_temp.ok('manage_members' = ANY (pg_temp.caps(v_wallet, v_owner))
            AND NOT ('manage_members' = ANY (COALESCE(pg_temp.caps(v_wallet, v_next), '{}'))),
            '6 ' || v_kind || ': before, only the owner manages the vault');

        IF v_kind = 'team' THEN
            UPDATE org.teams SET owner_user_id = v_next WHERE id = v_entity;
        ELSE
            UPDATE org.business_profiles SET owner_user_id = v_next WHERE id = v_entity;
        END IF;
        PERFORM pg_temp.ok('manage_members' = ANY (pg_temp.caps(v_wallet, v_next))
            AND NOT ('manage_members' = ANY (pg_temp.caps(v_wallet, v_owner))),
            '6 ' || v_kind || ': a direct owner change moves manage_members with it');
    END LOOP;
END $$;
ROLLBACK TO SAVEPOINT s_v2;
-- #endregion

-- #region 7. L8: the idempotency-key sweep
SAVEPOINT s_l8;
DO $$
DECLARE
    v_n integer;
BEGIN
    INSERT INTO finance.idempotency_keys (key, scope, request_hash, status, response, expires_at) VALUES
        ('probe-db3-old', 'transfer:probe', 'x', 'succeeded', '{}', now() - interval '40 days'),
        ('probe-db3-recent', 'transfer:probe', 'x', 'succeeded', '{}', now() - interval '10 days'),
        ('probe-db3-forever', 'transfer:probe', 'x', 'succeeded', '{}', NULL),
        ('stripe:evt_probe_db3_old', 'stripe.webhook', 'x', 'succeeded', '{"outcome": "applied"}', now() - interval '400 days');
    v_n := finance.fn_sweep_idempotency_keys();
    PERFORM pg_temp.ok(v_n >= 1 AND NOT EXISTS (SELECT 1 FROM finance.idempotency_keys WHERE key = 'probe-db3-old'),
        '7 a key expired more than 30 days ago is deleted');
    PERFORM pg_temp.ok(
        (SELECT pg_catalog.count(*) FROM finance.idempotency_keys
          WHERE key IN ('probe-db3-recent', 'probe-db3-forever', 'stripe:evt_probe_db3_old')) = 3,
        '7 a recently expired key, a key with no expiry and a Stripe event claim are kept');
    PERFORM pg_temp.ok(finance.fn_sweep_idempotency_keys() = 0, '7 a second run deletes nothing');
END $$;
ROLLBACK TO SAVEPOINT s_l8;
-- #endregion

-- #region 8. The dormant jobs find both sweeps by name
DO $$
BEGIN
    PERFORM pg_temp.ok(pg_catalog.to_regproc('finance.fn_expire_spend_approvals') IS NOT NULL
        AND pg_catalog.to_regproc('finance.fn_sweep_idempotency_keys') IS NOT NULL,
        '8 both sweeps resolve by bare name (one signature each), as 00005060 looks them up');
    PERFORM pg_temp.ok(NOT pg_catalog.has_function_privilege('authenticated', 'finance.fn_expire_spend_approvals(integer)', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', 'finance.fn_sweep_idempotency_keys(integer)', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', 'finance.fn_kyb_missing(text, uuid)', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', 'finance.fn_assert_no_open_dispute(uuid)', 'EXECUTE'),
        '8 no client reaches the sweeps, the KYB predicate or the dispute refusal');
END $$;
-- #endregion

ROLLBACK;
