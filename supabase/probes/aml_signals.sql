-- =============================================================================================
-- Probe: the AML monitoring signals and the 72-hour Safety Hold (LEGAL_COMPLIANCE LG7, Decision #529;
-- #336 ruling I1 ⚖️, the data half of "AML-ready"; PRODUCT_SPEC §Identity, Taxes & Compliance 3).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/aml_signals.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. Fixtures come from the
-- seed (deno task db:reset): a seeded personal project's ticket the owner takes for themselves, a
-- seeded business-paid escrow whose freelancer is given a seat on the paying business, and an adult
-- freelancer made payout-ready, as payout_lifecycle.sql does.
--
--   1  shape: finance.aml_signals has RLS on and no policy, no client or service-role grant, and is
--      append-only; the operator door is a STABLE pinned definer authenticated may call and anon may
--      not; the internals are pinned definers no client role may call
--   2  round-tripping: a self-hire (one person paying and paid) records a `round_trip` signal at its
--      funding and at its release; a freelancer with a seat on the paying business records one at the
--      release; an ordinary release records none
--   3  rapid churn: a withdrawal at the dial after as much settled card money inside the window records
--      a `rapid_churn` signal beside its payout; one below the dial, or after the window, records none
--   4  switch off (the shipped state): every hold trigger present, and nothing about money changes —
--      fn_safety_hold answers nothing and the withdrawal is begun and debited exactly as before
--   5  switch on: a flagged withdrawal is held — no payout, no debit, no attempt key, one `safety_hold`
--      signal, the hold's end in the answer — for each trigger (rapid churn, sign-in change, new
--      account, round trip), and goes through once its hold has passed; a trigger the dial leaves out
--      holds nothing; a held scheduled run is skipped, never struck
--   6  the hold moves no money: the conservation identity and every wallet are unchanged by a held
--      attempt
--   7  the operator read: a member and a caller with no JWT get 42501, an operator gets the signals with
--      their facts, the counts and the switch; the subject cannot read the table at all
-- =============================================================================================

BEGIN;
-- The pg_temp helpers below run as authenticated, and 00002500 gives a new function no PUBLIC EXECUTE;
-- this hands it back to the helpers alone, and rolls back with them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region 0. Helpers + fixtures (as postgres)
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', p_what; END IF;
    RAISE NOTICE 'PASS %', p_what;
END $$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key);
$$;

-- Act as p_user (authenticated) or, with NULL, as postgres with no JWT.
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_user IS NULL THEN
        PERFORM set_config('role', 'postgres', true);
        PERFORM set_config('request.jwt.claims', '', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
    ELSE
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
        PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
        PERFORM set_config('role', 'authenticated', true);
    END IF;
END $$;

CREATE FUNCTION pg_temp.signals(p_kind text, p_subject uuid) RETURNS integer LANGUAGE sql AS $$
    SELECT COUNT(*)::integer FROM finance.aml_signals WHERE kind = p_kind AND subject_user_id = p_subject;
$$;

CREATE FUNCTION pg_temp.newest(p_kind text, p_subject uuid) RETURNS finance.aml_signals LANGUAGE sql AS $$
    SELECT * FROM finance.aml_signals WHERE kind = p_kind AND subject_user_id = p_subject
     ORDER BY created_at DESC, id DESC LIMIT 1;
$$;

CREATE FUNCTION pg_temp.bal() RETURNS bigint LANGUAGE sql AS $$
    SELECT balance_cents FROM finance.wallets WHERE id = pg_temp.s('wallet')::uuid;
$$;

-- Withdraw as the fixture freelancer: the door's answer, or `{"refused": <message>}`.
CREATE FUNCTION pg_temp.withdraw(p_amount bigint, p_key text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.s('payee')::uuid);
    BEGIN
        v := finance.begin_payout(pg_temp.s('wallet')::uuid, p_amount, pg_temp.s('currency'), false, p_key, NULL);
    EXCEPTION WHEN OTHERS THEN
        v := jsonb_build_object('refused', SQLERRM);
    END;
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

-- A settled card top-up of p_amount into the fixture wallet, made by the fixture freelancer, settled at
-- p_at; its ledger credit is real. Answers the payment's id.
CREATE FUNCTION pg_temp.card_in(p_amount bigint, p_at timestamptz) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_tx uuid;
BEGIN
    PERFORM finance.fn_wallet_credit(pg_temp.s('payee')::uuid, 'freelancer',
        (SELECT currency FROM finance.wallets WHERE id = pg_temp.s('wallet')::uuid), p_amount,
        'topup', 'inbound_payments', v_id);
    SELECT id INTO STRICT v_tx FROM finance.transactions WHERE ref_table = 'inbound_payments' AND ref_id = v_id;
    INSERT INTO finance.inbound_payments (
        id, purpose, wallet_id, amount_cents, currency, amount_received_cents, status, provider_ref,
        idempotency_key, transaction_id, created_by, succeeded_at, created_at
    ) VALUES (
        v_id, 'wallet_topup', pg_temp.s('wallet')::uuid, p_amount, pg_temp.s('currency'), p_amount,
        'succeeded', 'pi_probe_aml_' || substr(v_id::text, 1, 12), 'probe-aml-in-' || v_id, v_tx,
        pg_temp.s('payee')::uuid, p_at, p_at
    );
    RETURN v_id;
END $$;

-- Move every fixture settlement and every fixture sign-in change out of the window, so no trigger holds.
CREATE FUNCTION pg_temp.age_out() RETURNS void LANGUAGE sql AS $$
    UPDATE finance.inbound_payments SET succeeded_at = now() - interval '200 hours'
     WHERE created_by = pg_temp.s('payee')::uuid AND succeeded_at > now() - interval '200 hours';
    UPDATE security.audit_logs SET created_at = now() - interval '200 hours'
     WHERE user_id = pg_temp.s('payee')::uuid AND action = 'user.sign_in_changed';
$$;

CREATE FUNCTION pg_temp.set_param(p_key text, p_value jsonb) RETURNS void LANGUAGE sql AS $$
    UPDATE security.platform_params SET value = p_value WHERE key = p_key;
$$;

CREATE FUNCTION pg_temp.identity() RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_object_agg(currency, imbalance_minor) FROM finance.v_conservation_identity;
$$;

GRANT EXECUTE ON FUNCTION pg_temp.s(text) TO authenticated;

-- An adult freelancer with a freelancer wallet, payout-ready with a verified Connect account, an old
-- account (so new_account never holds it by accident), and no card money in.
DO $$
DECLARE r record;
BEGIN
    SELECT w.id AS wallet, w.owner_id AS payee, upper(w.currency) AS currency
      INTO r
      FROM finance.wallets w
      JOIN org.freelancer_profiles fp ON fp.user_id = w.owner_id
     WHERE w.owner_type = 'freelancer' AND NOT org.fn_is_minor(w.owner_id)
       AND finance.fn_param_minor('aml_churn_min_minor', w.currency) IS NOT NULL
     ORDER BY w.id LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FAIL fixtures: no adult freelancer wallet (run deno task db:reset)';
    END IF;
    PERFORM set_config('probe.wallet', r.wallet::text, true);
    PERFORM set_config('probe.payee', r.payee::text, true);
    PERFORM set_config('probe.currency', r.currency, true);
    PERFORM set_config('probe.churn', finance.fn_param_minor('aml_churn_min_minor', r.currency)::text, true);
    PERFORM set_config('probe.min', finance.fn_min_withdrawal_minor(r.currency)::text, true);

    UPDATE org.freelancer_profiles SET kyc_status = 'verified', payout_ready = true WHERE user_id = r.payee;
    DELETE FROM finance.payout_accounts WHERE owner_id = r.payee;
    INSERT INTO finance.payout_accounts (owner_type, owner_id, provider, account_id, status)
    VALUES ('freelancer', r.payee, 'stripe', 'acct_probe_aml' || substr(md5(r.payee::text), 1, 10), 'verified');
    UPDATE auth.users SET created_at = now() - interval '400 days' WHERE id = r.payee;
    UPDATE finance.inbound_payments SET succeeded_at = now() - interval '400 days', created_at = now() - interval '400 days'
     WHERE (created_by = r.payee OR wallet_id = r.wallet) AND succeeded_at IS NOT NULL;
    UPDATE security.audit_logs SET created_at = now() - interval '400 days'
     WHERE user_id = r.payee AND action = 'user.sign_in_changed';
    PERFORM finance.fn_wallet_credit(r.payee, 'freelancer', (SELECT currency FROM finance.wallets WHERE id = r.wallet),
        2000000, 'topup', 'probe', NULL);
END $$;

-- An operator and a member who is not one.
DO $$
DECLARE v_op uuid; v_member uuid;
BEGIN
    SELECT u.user_id INTO v_member FROM org.users_public u
     WHERE NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
       AND u.user_id <> pg_temp.s('payee')::uuid
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_op FROM org.users_public u
     WHERE u.user_id NOT IN (v_member, pg_temp.s('payee')::uuid)
     ORDER BY u.user_id DESC LIMIT 1;
    INSERT INTO ops.admin_users (user_id) VALUES (v_op) ON CONFLICT DO NOTHING;
    PERFORM set_config('probe.op', v_op::text, true);
    PERFORM set_config('probe.member', v_member::text, true);
END $$;

SELECT pg_temp.ok(pg_temp.s('churn')::bigint > pg_temp.s('min')::bigint,
    'the churn dial is seeded for the fixture currency, above its minimum withdrawal');
SELECT pg_temp.ok((SELECT value FROM security.platform_params WHERE key = 'aml_safety_hold_enabled') = 'false'::jsonb,
    'the Safety Hold ships off');
-- #endregion

-- #region 1. Shape
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'finance.aml_signals'::regclass),
    'finance.aml_signals has RLS on');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'finance' AND tablename = 'aml_signals'),
    'finance.aml_signals has no policy: no client row is ever visible');
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'finance.aml_signals', 'SELECT')
    AND NOT has_table_privilege('anon', 'finance.aml_signals', 'SELECT')
    AND NOT has_table_privilege('service_role', 'finance.aml_signals', 'INSERT')
    AND NOT has_table_privilege('service_role', 'finance.aml_signals', 'SELECT'),
    'no client role and not the service role holds the table');
SELECT pg_temp.ok(has_function_privilege('authenticated', 'finance.read_aml_signals(integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'finance.read_aml_signals(integer)', 'EXECUTE'),
    'the operator door is callable by authenticated, not anon');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', f::regprocedure, 'EXECUTE'),
    'authenticated cannot call ' || f)
  FROM unnest(ARRAY[
      'finance.fn_safety_hold(uuid,uuid,bigint,text,timestamp with time zone)',
      'finance.fn_aml_churn(uuid,uuid,bigint,text,timestamp with time zone)',
      'finance.fn_aml_round_trip_people(finance.escrows)',
      'finance.fn_safety_hold_enabled()',
      'finance.fn_aml_dial_int(text,integer)'
  ]) f;
SELECT pg_temp.ok(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'],
    p.proname || ' is a definer with a pinned search_path')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'finance' AND p.proname IN (
     'read_aml_signals', 'fn_safety_hold', 'fn_aml_churn', 'fn_aml_round_trip_people',
     'fn_aml_record_round_trip', 'fn_safety_hold_enabled', 'fn_aml_dial_int');
SELECT pg_temp.ok((SELECT provolatile = 's' FROM pg_proc WHERE oid = 'finance.read_aml_signals(integer)'::regprocedure),
    'the operator door is STABLE');
-- #endregion

-- #region 2. Round-tripping
-- A seeded personal project's priced ticket, with no escrow and no team seat, taken by its own owner.
DO $$
DECLARE r record;
BEGIN
    SELECT t.id AS ticket, COALESCE(p.client_user_id, p.owner_user_id) AS spender, upper(p.currency) AS currency,
           projects.fn_ticket_stage_price(t.required_stages, t.unit_price_cents, ps) AS price
      INTO r
      FROM projects.tickets t
      JOIN projects.projects p ON p.id = t.project_id
      JOIN projects.project_stages ps ON ps.id = t.current_stage_id
     WHERE p.client_business_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM projects.stage_assignments sa
                        WHERE sa.project_stage_id = ps.id AND sa.assignee_type = 'team' AND sa.status = 'accepted')
       AND projects.fn_ticket_stage_price(t.required_stages, t.unit_price_cents, ps) > 0
       AND NOT org.fn_is_minor(COALESCE(p.client_user_id, p.owner_user_id))
     ORDER BY t.id LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FAIL fixtures: no seeded personal-project ticket to self-hire (run deno task db:reset)';
    END IF;
    PERFORM set_config('probe.self_ticket', r.ticket::text, true);
    PERFORM set_config('probe.self', r.spender::text, true);
    UPDATE projects.tickets SET current_assignee_id = r.spender WHERE id = r.ticket;
    PERFORM finance.fn_wallet_credit(r.spender, finance.fn_person_wallet_type(r.spender), r.currency, r.price,
        'topup', 'probe', NULL);
END $$;

SELECT pg_temp.ok(pg_temp.signals('round_trip', pg_temp.s('self')::uuid) = 0, 'the self-hirer has no signal yet');
SELECT finance.fn_hold_ticket_escrow(pg_temp.s('self_ticket')::uuid);
SELECT pg_temp.ok(pg_temp.signals('round_trip', pg_temp.s('self')::uuid) = 1,
    'funding a self-hire records one round_trip signal');
SELECT pg_temp.ok((pg_temp.newest('round_trip', pg_temp.s('self')::uuid)).facts ->> 'event' = 'funding'
    AND (pg_temp.newest('round_trip', pg_temp.s('self')::uuid)).facts ->> 'relation' = 'same_account'
    AND (pg_temp.newest('round_trip', pg_temp.s('self')::uuid)).escrow_id =
        (SELECT id FROM finance.escrows WHERE ticket_id = pg_temp.s('self_ticket')::uuid AND status = 'held')
    AND (pg_temp.newest('round_trip', pg_temp.s('self')::uuid)).amount_minor =
        (SELECT amount_cents FROM finance.escrows WHERE ticket_id = pg_temp.s('self_ticket')::uuid AND status = 'held'),
    'the funding signal names the escrow, its amount, the event and the relation (same account)');

SELECT finance.fn_release_ticket_escrow(pg_temp.s('self_ticket')::uuid);
SELECT pg_temp.ok(pg_temp.signals('round_trip', pg_temp.s('self')::uuid) = 2
    AND (pg_temp.newest('round_trip', pg_temp.s('self')::uuid)).facts ->> 'event' = 'release',
    'releasing the self-hire records a second round_trip signal, at the release');

-- A seeded business-paid escrow for a freelancer, who is given a member seat on the paying business.
DO $$
DECLARE r record;
BEGIN
    SELECT e.ticket_id, e.payee_id, e.payer_business_id INTO r
      FROM finance.escrows e
     WHERE e.status = 'held' AND e.payee_type = 'freelancer' AND e.payer_business_id IS NOT NULL
       AND e.ticket_id IS NOT NULL AND e.revision_id IS NULL
     ORDER BY e.id LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FAIL fixtures: no seeded business-paid freelancer escrow (run deno task db:reset)';
    END IF;
    PERFORM set_config('probe.seat_ticket', r.ticket_id::text, true);
    PERFORM set_config('probe.seat', r.payee_id::text, true);
    INSERT INTO org.business_members (business_id, user_id, role_id, role, status)
    SELECT r.payer_business_id, r.payee_id, br.id, 'member', 'active'
      FROM org.business_roles br WHERE br.business_id = r.payer_business_id AND br.preset = 'member'
    ON CONFLICT DO NOTHING;
END $$;
SELECT pg_catalog.set_config('probe.rt_seat0', pg_temp.signals('round_trip', pg_temp.s('seat')::uuid)::text, true);
SELECT finance.fn_release_ticket_escrow(pg_temp.s('seat_ticket')::uuid);
SELECT pg_temp.ok(pg_temp.signals('round_trip', pg_temp.s('seat')::uuid) = pg_temp.s('rt_seat0')::integer + 1
    AND (pg_temp.newest('round_trip', pg_temp.s('seat')::uuid)).facts ->> 'relation' = 'business_seat'
    AND (pg_temp.newest('round_trip', pg_temp.s('seat')::uuid)).facts ->> 'event' = 'release',
    'a freelancer with a seat on the paying business records a round_trip signal at the release');

-- An ordinary release: a business-paid escrow whose payee holds no seat on the payer.
DO $$
DECLARE r record;
BEGIN
    SELECT e.ticket_id INTO r
      FROM finance.escrows e
     WHERE e.status = 'held' AND e.payer_business_id IS NOT NULL AND e.ticket_id IS NOT NULL
       AND e.revision_id IS NULL AND e.payee_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM finance.fn_aml_round_trip_people(e))
     ORDER BY e.id LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FAIL fixtures: no ordinary held escrow to release';
    END IF;
    PERFORM set_config('probe.plain_ticket', r.ticket_id::text, true);
END $$;
SELECT pg_catalog.set_config('probe.rt_all0', (SELECT COUNT(*) FROM finance.aml_signals)::text, true);
SELECT finance.fn_release_ticket_escrow(pg_temp.s('plain_ticket')::uuid);
SELECT pg_temp.ok((SELECT COUNT(*) FROM finance.aml_signals) = pg_temp.s('rt_all0')::bigint,
    'an ordinary release records no signal');
-- #endregion

-- #region 3. Rapid churn (switch off)
SELECT pg_temp.card_in(pg_temp.s('churn')::bigint, now() - interval '1 hour');
SELECT pg_catalog.set_config('probe.b0', pg_temp.bal()::text, true);
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(pg_temp.s('churn')::bigint, 'probe-aml-churn-1')::text, true);
SELECT pg_temp.ok(pg_temp.s('out')::jsonb ? 'id' AND NOT (pg_temp.s('out')::jsonb ? 'held'),
    'with the switch off, a churn withdrawal is begun as before: ' || pg_temp.s('out'));
SELECT pg_temp.ok(pg_temp.bal() = pg_temp.s('b0')::bigint - pg_temp.s('churn')::bigint, 'and debited exactly once');
SELECT pg_temp.ok(pg_temp.signals('rapid_churn', pg_temp.s('payee')::uuid) = 1
    AND (pg_temp.newest('rapid_churn', pg_temp.s('payee')::uuid)).payout_id = (pg_temp.s('out')::jsonb ->> 'id')::uuid
    AND (pg_temp.newest('rapid_churn', pg_temp.s('payee')::uuid)).amount_minor = pg_temp.s('churn')::bigint
    AND ((pg_temp.newest('rapid_churn', pg_temp.s('payee')::uuid)).facts ->> 'in_minor')::bigint = pg_temp.s('churn')::bigint
    AND ((pg_temp.newest('rapid_churn', pg_temp.s('payee')::uuid)).facts ->> 'window_hours')::integer = 72,
    'a withdrawal at the dial after as much card money inside the window records rapid_churn beside its payout');

SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(pg_temp.s('churn')::bigint - 1, 'probe-aml-churn-2')::text, true);
SELECT pg_temp.ok(pg_temp.s('out')::jsonb ? 'id' AND pg_temp.signals('rapid_churn', pg_temp.s('payee')::uuid) = 1,
    'a withdrawal one unit below the dial records no churn');

SELECT pg_temp.age_out();
SELECT pg_temp.card_in(pg_temp.s('churn')::bigint, now() - interval '73 hours');
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(pg_temp.s('churn')::bigint, 'probe-aml-churn-3')::text, true);
SELECT pg_temp.ok(pg_temp.s('out')::jsonb ? 'id' AND pg_temp.signals('rapid_churn', pg_temp.s('payee')::uuid) = 1,
    'card money that settled before the window records no churn');
-- #endregion

-- #region 4. Switch off: every trigger present, nothing about money changes
SELECT pg_temp.card_in(pg_temp.s('churn')::bigint, now() - interval '1 hour');
INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, created_at)
VALUES (pg_temp.s('payee')::uuid, 'user.sign_in_changed', 'user_emails', gen_random_uuid(), now() - interval '1 hour');
UPDATE auth.users SET created_at = now() - interval '1 day' WHERE id = pg_temp.s('payee')::uuid;
SELECT pg_temp.ok((SELECT held_until IS NULL AND triggers = '{}'
                     FROM finance.fn_safety_hold(pg_temp.s('payee')::uuid, pg_temp.s('wallet')::uuid,
                          pg_temp.s('churn')::bigint, pg_temp.s('currency'), now())),
    'switch off: fn_safety_hold answers nothing, whatever holds the account');
SELECT pg_catalog.set_config('probe.b0', pg_temp.bal()::text, true);
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(pg_temp.s('churn')::bigint, 'probe-aml-off')::text, true);
SELECT pg_temp.ok(pg_temp.s('out')::jsonb ? 'id' AND pg_temp.bal() = pg_temp.s('b0')::bigint - pg_temp.s('churn')::bigint
    AND pg_temp.signals('safety_hold', pg_temp.s('payee')::uuid) = 0,
    'switch off: a flagged withdrawal is begun and debited exactly as before, and nothing is held');
UPDATE auth.users SET created_at = now() - interval '400 days' WHERE id = pg_temp.s('payee')::uuid;
SELECT pg_temp.age_out();
-- #endregion

-- #region 5. Switch on
SELECT pg_temp.set_param('aml_safety_hold_enabled', 'true'::jsonb);

-- 5a. Rapid churn holds, until 72 hours after the card money settled.
SELECT pg_catalog.set_config('probe.in_at', (now() - interval '1 hour')::text, true);
SELECT pg_temp.card_in(pg_temp.s('churn')::bigint, pg_temp.s('in_at')::timestamptz);
SELECT pg_catalog.set_config('probe.b0', pg_temp.bal()::text, true);
SELECT pg_catalog.set_config('probe.id0', pg_temp.identity()::text, true);
SELECT pg_catalog.set_config('probe.p0', (SELECT COUNT(*) FROM finance.payouts)::text, true);
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(pg_temp.s('churn')::bigint, 'probe-aml-held-churn')::text, true);
SELECT pg_temp.ok((pg_temp.s('out')::jsonb ->> 'held')::boolean
    AND (pg_temp.s('out')::jsonb ->> 'held_until')::timestamptz = pg_temp.s('in_at')::timestamptz + interval '72 hours',
    'switch on: a churn withdrawal is held until 72 hours after the card money settled: ' || pg_temp.s('out'));
SELECT pg_temp.ok(pg_temp.bal() = pg_temp.s('b0')::bigint
    AND (SELECT COUNT(*) FROM finance.payouts) = pg_temp.s('p0')::bigint
    AND NOT EXISTS (SELECT 1 FROM finance.idempotency_keys WHERE key = 'probe-aml-held-churn'),
    'a held withdrawal moves nothing: no payout, no debit, no attempt key');
SELECT pg_temp.ok(pg_temp.signals('safety_hold', pg_temp.s('payee')::uuid) = 1
    AND (pg_temp.newest('safety_hold', pg_temp.s('payee')::uuid)).facts -> 'triggers' = '["rapid_churn"]'::jsonb
    AND ((pg_temp.newest('safety_hold', pg_temp.s('payee')::uuid)).facts ->> 'held_until')::timestamptz
        = pg_temp.s('in_at')::timestamptz + interval '72 hours'
    AND (pg_temp.newest('safety_hold', pg_temp.s('payee')::uuid)).facts ? 'churn',
    'the held attempt is recorded once as safety_hold, with its trigger, its end and the churn facts');
SELECT pg_temp.ok(pg_temp.identity() = pg_temp.s('id0')::jsonb,
    'the conservation identity is unchanged by a held attempt');

SELECT pg_temp.ok((SELECT held_until IS NOT NULL FROM finance.fn_safety_hold(pg_temp.s('payee')::uuid,
        pg_temp.s('wallet')::uuid, pg_temp.s('churn')::bigint, pg_temp.s('currency'),
        pg_temp.s('in_at')::timestamptz + interval '72 hours' - interval '1 second')),
    'one second before its end the hold still holds');
SELECT pg_temp.ok((SELECT held_until IS NULL FROM finance.fn_safety_hold(pg_temp.s('payee')::uuid,
        pg_temp.s('wallet')::uuid, pg_temp.s('churn')::bigint, pg_temp.s('currency'),
        pg_temp.s('in_at')::timestamptz + interval '72 hours' + interval '1 second')),
    'one second after its end the hold has passed');
SELECT pg_temp.ok((SELECT held_until IS NULL FROM finance.fn_safety_hold(pg_temp.s('payee')::uuid,
        pg_temp.s('wallet')::uuid, pg_temp.s('min')::bigint, pg_temp.s('currency'), now())),
    'a small withdrawal from an old account is not churn and is not held');

SELECT pg_temp.age_out();
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(pg_temp.s('churn')::bigint, 'probe-aml-held-churn')::text, true);
SELECT pg_temp.ok(pg_temp.s('out')::jsonb ? 'id' AND pg_temp.bal() = pg_temp.s('b0')::bigint - pg_temp.s('churn')::bigint,
    'once the hold has passed, the same attempt key withdraws');

-- 5b. A sign-in change holds any withdrawal for 72 hours (Decision #451 (c)).
SELECT pg_catalog.set_config('probe.at', (now() - interval '2 hours')::text, true);
INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, created_at)
VALUES (pg_temp.s('payee')::uuid, 'user.sign_in_changed', 'user_emails', gen_random_uuid(), pg_temp.s('at')::timestamptz);
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(pg_temp.s('min')::bigint, 'probe-aml-held-signin')::text, true);
SELECT pg_temp.ok((pg_temp.s('out')::jsonb ->> 'held')::boolean
    AND (pg_temp.s('out')::jsonb ->> 'held_until')::timestamptz = pg_temp.s('at')::timestamptz + interval '72 hours'
    AND (pg_temp.newest('safety_hold', pg_temp.s('payee')::uuid)).facts -> 'triggers' = '["sign_in_change"]'::jsonb,
    'a sign-in change holds a withdrawal until 72 hours after it');
SELECT pg_temp.set_param('aml_safety_hold_triggers', '["rapid_churn", "round_trip", "new_account"]'::jsonb);
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(pg_temp.s('min')::bigint, 'probe-aml-held-signin')::text, true);
SELECT pg_temp.ok(pg_temp.s('out')::jsonb ? 'id', 'a trigger the dial leaves out holds nothing');
SELECT pg_temp.set_param('aml_safety_hold_triggers', '["sign_in_change", "rapid_churn", "round_trip", "new_account"]'::jsonb);
SELECT pg_temp.age_out();

-- 5c. A new account's withdrawal waits 72 hours after its last card payment, whatever its size.
UPDATE auth.users SET created_at = now() - interval '2 days' WHERE id = pg_temp.s('payee')::uuid;
SELECT pg_catalog.set_config('probe.in_at', (now() - interval '3 hours')::text, true);
SELECT pg_temp.card_in(pg_temp.s('min')::bigint, pg_temp.s('in_at')::timestamptz);
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(pg_temp.s('min')::bigint, 'probe-aml-held-new')::text, true);
SELECT pg_temp.ok((pg_temp.s('out')::jsonb ->> 'held')::boolean
    AND (pg_temp.s('out')::jsonb ->> 'held_until')::timestamptz = pg_temp.s('in_at')::timestamptz + interval '72 hours'
    AND (pg_temp.newest('safety_hold', pg_temp.s('payee')::uuid)).facts -> 'triggers' = '["new_account"]'::jsonb,
    'a new account''s withdrawal is held until 72 hours after its card money settled');
UPDATE auth.users SET created_at = now() - interval '31 days' WHERE id = pg_temp.s('payee')::uuid;
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(pg_temp.s('min')::bigint, 'probe-aml-held-new')::text, true);
SELECT pg_temp.ok(pg_temp.s('out')::jsonb ? 'id', 'past aml_new_account_days the same withdrawal goes through');
UPDATE auth.users SET created_at = now() - interval '400 days' WHERE id = pg_temp.s('payee')::uuid;
SELECT pg_temp.age_out();

-- 5d. A round-trip signal holds the person it names for 72 hours from the signal.
SELECT pg_temp.ok((SELECT h.held_until = (pg_temp.newest('round_trip', pg_temp.s('self')::uuid)).created_at + interval '72 hours'
                          AND h.triggers = ARRAY['round_trip']
                     FROM finance.fn_safety_hold(pg_temp.s('self')::uuid, NULL, 1, pg_temp.s('currency'), now()) h),
    'a round_trip signal holds its subject until 72 hours after the signal');
SELECT pg_temp.ok((SELECT held_until IS NULL FROM finance.fn_safety_hold(pg_temp.s('self')::uuid, NULL, 1,
        pg_temp.s('currency'), (pg_temp.newest('round_trip', pg_temp.s('self')::uuid)).created_at + interval '73 hours')),
    'and the round-trip hold passes after 72 hours');

-- 5e. A held scheduled run is skipped, never struck.
DO $$
DECLARE v_sched uuid; v_runs jsonb;
BEGIN
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, created_at)
    VALUES (pg_temp.s('payee')::uuid, 'user.sign_in_changed', 'user_emails', gen_random_uuid(), now() - interval '1 hour');
    DELETE FROM finance.payout_schedules WHERE owner_type = 'freelancer' AND owner_id = pg_temp.s('payee')::uuid;
    INSERT INTO finance.payout_schedules (owner_type, owner_id, currency, mode, next_run_at, created_by, active)
    SELECT 'freelancer', w.owner_id, w.currency, 'scheduled_weekly', now() - interval '1 minute', w.owner_id, true
      FROM finance.wallets w WHERE w.id = pg_temp.s('wallet')::uuid
    RETURNING id INTO v_sched;
    PERFORM set_config('probe.sched', v_sched::text, true);
    SET LOCAL ROLE service_role;
    v_runs := finance.fn_claim_due_payout_schedules(50);
    RESET ROLE;
    PERFORM set_config('probe.runs', COALESCE((
        SELECT r FROM jsonb_array_elements(v_runs) r WHERE r ->> 'schedule_id' = v_sched::text
    ), 'null'::jsonb)::text, true);
END $$;
SELECT pg_temp.ok(pg_temp.s('runs')::jsonb ->> 'outcome' = 'skipped' AND pg_temp.s('runs')::jsonb ->> 'detail' = 'safety_hold'
    AND (SELECT failure_count = 0 FROM finance.payout_schedules WHERE id = pg_temp.s('sched')::uuid)
    AND NOT EXISTS (SELECT 1 FROM finance.payouts WHERE schedule_id = pg_temp.s('sched')::uuid),
    'a held scheduled run is skipped (safety_hold), never struck, and pays nothing: ' || pg_temp.s('runs'));
SELECT pg_temp.age_out();
-- #endregion

-- #region 6. The hold moves no money
SELECT pg_temp.card_in(pg_temp.s('churn')::bigint, now() - interval '1 hour');
SELECT pg_catalog.set_config('probe.id0', pg_temp.identity()::text, true);
SELECT pg_catalog.set_config('probe.w0', (SELECT jsonb_object_agg(id, balance_cents) FROM finance.wallets)::text, true);
SELECT pg_catalog.set_config('probe.t0', (SELECT COUNT(*) FROM finance.transactions)::text, true);
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(pg_temp.s('churn')::bigint, 'probe-aml-held-money')::text, true);
SELECT pg_temp.ok((pg_temp.s('out')::jsonb ->> 'held')::boolean
    AND pg_temp.identity() = pg_temp.s('id0')::jsonb
    AND (SELECT jsonb_object_agg(id, balance_cents) FROM finance.wallets) = pg_temp.s('w0')::jsonb
    AND (SELECT COUNT(*) FROM finance.transactions) = pg_temp.s('t0')::bigint,
    'a held withdrawal leaves the identity, every wallet and the ledger exactly as they were');
SELECT pg_temp.set_param('aml_safety_hold_enabled', 'false'::jsonb);
-- #endregion

-- #region 7. The operator read, and the subject
SELECT pg_temp.act(pg_temp.s('member')::uuid);
DO $$ BEGIN
    PERFORM finance.read_aml_signals();
    RAISE EXCEPTION 'FAIL a member read the AML signals';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS a member is refused the AML signals (42501)';
END $$;
SELECT pg_temp.act(NULL);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
    PERFORM finance.read_aml_signals();
    RAISE EXCEPTION 'FAIL a caller with no JWT read the AML signals';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS a caller with no JWT is refused the AML signals (42501)';
END $$;
RESET ROLE;

SELECT pg_temp.act(pg_temp.s('payee')::uuid);
DO $$ BEGIN
    PERFORM 1 FROM finance.aml_signals;
    RAISE EXCEPTION 'FAIL the subject read finance.aml_signals';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS the subject cannot read finance.aml_signals at all';
END $$;
SELECT pg_temp.act(NULL);

SELECT pg_catalog.set_config('probe.n0', (SELECT COUNT(*) FROM finance.aml_signals)::text, true);
SELECT pg_temp.act(pg_temp.s('op')::uuid);
SELECT pg_catalog.set_config('probe.read', finance.read_aml_signals(500)::text, true);
SELECT pg_temp.act(NULL);
SELECT pg_temp.ok((pg_temp.s('read')::jsonb ->> 'hold_enabled')::boolean = false
    AND (pg_temp.s('read')::jsonb #>> '{counts,round_trip}')::bigint = (SELECT COUNT(*) FROM finance.aml_signals WHERE kind = 'round_trip')
    AND (pg_temp.s('read')::jsonb #>> '{counts,rapid_churn}')::bigint = (SELECT COUNT(*) FROM finance.aml_signals WHERE kind = 'rapid_churn')
    AND (pg_temp.s('read')::jsonb #>> '{counts,safety_hold}')::bigint = (SELECT COUNT(*) FROM finance.aml_signals WHERE kind = 'safety_hold'),
    'an operator reads every kind''s count and whether the hold is on');
SELECT pg_temp.ok(EXISTS (
        SELECT 1 FROM jsonb_array_elements(pg_temp.s('read')::jsonb -> 'signals') x
         WHERE x ->> 'kind' = 'round_trip' AND (x ->> 'subject_user_id')::uuid = pg_temp.s('self')::uuid
           AND x #>> '{facts,relation}' = 'same_account' AND x ->> 'subject_username' IS NOT NULL
    ) AND (SELECT (x ->> 'created_at')::timestamptz FROM jsonb_array_elements(pg_temp.s('read')::jsonb -> 'signals') x LIMIT 1)
        = (SELECT MAX(created_at) FROM finance.aml_signals),
    'the signals come newest first, with their facts and the subject''s handle');
SELECT pg_temp.ok((SELECT COUNT(*) FROM finance.aml_signals) = pg_temp.s('n0')::bigint, 'the read writes nothing');

DO $$ BEGIN
    UPDATE finance.aml_signals SET amount_minor = 0;
    RAISE EXCEPTION 'FAIL a signal was rewritten';
EXCEPTION WHEN SQLSTATE 'PL403' THEN
    RAISE NOTICE 'PASS a signal is never rewritten, even by the owner';
END $$;
DO $$ BEGIN
    DELETE FROM finance.aml_signals;
    RAISE EXCEPTION 'FAIL a signal was removed';
EXCEPTION WHEN SQLSTATE 'PL403' THEN
    RAISE NOTICE 'PASS a signal is never removed, even by the owner';
END $$;
-- #endregion

ROLLBACK;
