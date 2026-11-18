-- =============================================================================================
-- Probe: the conservation identity (FBP DB16; Decision #337, ruling M2 (A)) — per currency, every unit
-- the platform holds came in from outside and has not gone back out:
--     Σ external in − Σ external out = Σ held + Σ fees retained − Σ platform losses
-- (finance.v_conservation_identity, 00003004), checked nightly by finance.fn_check_conservation and read
-- by operators through finance.get_ledger_health (00001200), behind /admin/ledger.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/conservation_identity.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts.
--
--   1  grants and shape: neither view is readable by a client role; the nightly check is a pinned
--      definer only the service role may run; the operator read is a STABLE pinned definer that
--      authenticated may call and anon may not
--   2  the seeded database conserves money in every currency it holds, and no wallet drifts
--   3  doors conserve: a release and a refund of seeded escrows leave every imbalance where it was
--   4  a credit with no cash behind it (FCA CO20's shape) shows as an imbalance of exactly its amount,
--      in its own currency only: a `topup` in a currency nobody holds, and an `on_account_credit`
--   5  a released unfunded deadline bonus (FCA N4's shape: ck_escrows_bonus_unfunded dropped inside
--      this transaction) shows as an imbalance of exactly the bonus in the escrow's currency
--   6  the nightly check: one ops row per currency under one run id — `error` for the imbalanced
--      currency, `metric` for a balanced one — with every term in `data`, and it corrects nothing
--   7  the operator read: a member and a caller with no JWT get 42501; an operator gets the identity
--      the view computes, tonight's checks and the drift that is open, and the read writes nothing
--
-- A money flow added later adds its terms to the view and keeps sections 2 and 3 green (FBP §1).
-- =============================================================================================

BEGIN;
-- The pg_temp helpers below run as anon and authenticated, and 00002500 gives a new function no PUBLIC
-- EXECUTE; this hands it back to the helpers alone, and rolls back with them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region 0. Helpers (as postgres)
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_user IS NULL THEN
        PERFORM set_config('role', 'postgres', true);
        PERFORM set_config('request.jwt.claims', '', true);
    ELSE
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
        PERFORM set_config('role', 'authenticated', true);
    END IF;
END $$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- Every currency's imbalance now, as {currency: minor}.
CREATE FUNCTION pg_temp.imbalances() RETURNS jsonb LANGUAGE sql AS $$
    SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb)
      FROM finance.v_conservation_identity c;
$$;

-- What moved between two imbalance maps, as {currency: change}, currencies that did not move left out.
CREATE FUNCTION pg_temp.moved(p_before jsonb, p_after jsonb) RETURNS jsonb LANGUAGE sql AS $$
    SELECT COALESCE(jsonb_object_agg(k, d), '{}'::jsonb)
      FROM (SELECT k, COALESCE((p_after ->> k)::bigint, 0) - COALESCE((p_before ->> k)::bigint, 0) AS d
              FROM (SELECT jsonb_object_keys(p_before) AS k UNION SELECT jsonb_object_keys(p_after)) keys) x
     WHERE d <> 0;
$$;

-- The SQLSTATE finance.get_ledger_health() raises for p_user ('' when it answers). p_user NULL with
-- p_authenticated: the authenticated role with no JWT subject.
CREATE FUNCTION pg_temp.read_state(p_user uuid, p_authenticated boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text := '';
BEGIN
    IF p_user IS NULL AND p_authenticated THEN
        PERFORM set_config('request.jwt.claims', '', true);
        PERFORM set_config('role', 'authenticated', true);
    ELSE
        PERFORM pg_temp.act(p_user);
    END IF;
    BEGIN
        PERFORM finance.get_ledger_health();
    EXCEPTION WHEN OTHERS THEN
        v := SQLSTATE;
    END;
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

CREATE FUNCTION pg_temp.read_as(p_user uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
    PERFORM pg_temp.act(p_user);
    v := finance.get_ledger_health();
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

-- A held, bound ticket escrow the release door can pay: no open dispute, nothing else held on its
-- ticket, so releasing the ticket moves exactly this escrow.
CREATE FUNCTION pg_temp.releasable_escrow() RETURNS finance.escrows LANGUAGE sql AS $$
    SELECT e.* FROM finance.escrows e
     WHERE e.status = 'held' AND e.payee_id IS NOT NULL AND e.ticket_id IS NOT NULL
       AND e.revision_id IS NULL AND e.cohort_membership_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM finance.disputes d WHERE d.escrow_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM finance.escrows o
                        WHERE o.ticket_id = e.ticket_id AND o.id <> e.id AND o.status = 'held')
     ORDER BY e.created_at, e.id
     LIMIT 1;
$$;
-- #endregion

-- #region 1. Grants and shape
DO $$
DECLARE
    v_check pg_proc;
    v_read pg_proc;
BEGIN
    PERFORM pg_temp.check(
        NOT has_table_privilege('anon', 'finance.v_conservation_identity', 'SELECT')
        AND NOT has_table_privilege('authenticated', 'finance.v_conservation_identity', 'SELECT')
        AND has_table_privilege('service_role', 'finance.v_conservation_identity', 'SELECT')
        AND NOT has_table_privilege('anon', 'finance.v_wallet_drift', 'SELECT')
        AND NOT has_table_privilege('authenticated', 'finance.v_wallet_drift', 'SELECT')
        AND has_table_privilege('service_role', 'finance.v_wallet_drift', 'SELECT'),
        '1 both views are the service role''s alone');

    SELECT * INTO v_check FROM pg_proc WHERE oid = 'finance.fn_check_conservation()'::regprocedure;
    PERFORM pg_temp.check(
        v_check.prosecdef AND v_check.provolatile = 'v'
        AND v_check.proconfig @> ARRAY['search_path=""']
        AND NOT has_function_privilege('anon', v_check.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', v_check.oid, 'EXECUTE')
        AND has_function_privilege('service_role', v_check.oid, 'EXECUTE'),
        '1 the nightly check is a pinned definer only the service role runs');

    SELECT * INTO v_read FROM pg_proc WHERE oid = 'finance.get_ledger_health()'::regprocedure;
    PERFORM pg_temp.check(
        v_read.prosecdef AND v_read.provolatile = 's'
        AND v_read.proconfig @> ARRAY['search_path=""']
        AND NOT has_function_privilege('anon', v_read.oid, 'EXECUTE')
        AND has_function_privilege('authenticated', v_read.oid, 'EXECUTE'),
        '1 the operator read is a STABLE pinned definer for signed-in callers, never anon');

    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM ops.scheduled_jobs j
                 WHERE j.name = 'finance-conservation-check' AND j.command = 'SELECT finance.fn_check_conservation();'),
        '1 the nightly job is registered');
END $$;
-- #endregion

-- #region 2. The seeded database conserves money
DO $$
DECLARE
    v_rows integer;
    v_bad jsonb;
BEGIN
    SELECT count(*) INTO v_rows FROM finance.v_conservation_identity;
    SELECT jsonb_object_agg(c.currency, c.imbalance_minor) INTO v_bad
      FROM finance.v_conservation_identity c WHERE c.imbalance_minor <> 0;
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL 2 the database does not conserve money: imbalance by currency %', v_bad;
    END IF;
    PERFORM pg_temp.check(v_rows > 0, format('2 every one of %s currencies conserves money', v_rows));
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM finance.v_wallet_drift),
        '2 no wallet drifts from its ledger');
    PERFORM pg_temp.check(NOT EXISTS (
        SELECT 1 FROM finance.transactions t
         WHERE t.reason NOT IN (
             'topup', 'on_account_credit', 'payout', 'payout_reversal', 'chargeback', 'refund', 'invoice_payment',
             'escrow_hold', 'escrow_release', 'escrow_refund', 'fair_exit_release', 'fair_exit_refund',
             'team_split', 'team_finder_fee', 'escrow_release_vault_retention',
             'fair_exit_release_vault_retention', 'team_distribution', 'transfer_in', 'transfer_out',
             'order_payment', 'product_sale', 'fx_conversion', 'fx_spread')),
        '2 every ledger row carries a reason a door writes');
END $$;
-- #endregion

-- #region 3. Doors conserve
SAVEPOINT doors;
DO $$
DECLARE
    v_before jsonb := pg_temp.imbalances();
    e finance.escrows := pg_temp.releasable_escrow();
    r finance.escrows;
BEGIN
    IF e.id IS NULL THEN
        RAISE EXCEPTION 'FAIL 3 fixture: no held, bound ticket escrow to release';
    END IF;
    PERFORM finance.fn_release_ticket_escrow(e.ticket_id);
    SELECT * INTO r FROM finance.escrows WHERE id = e.id;
    PERFORM pg_temp.check(r.status = 'released' AND r.platform_fee_cents > 0,
        '3 fixture: the release door released the escrow and kept its fee');
    PERFORM pg_temp.check(pg_temp.moved(v_before, pg_temp.imbalances()) = '{}'::jsonb,
        format('3 releasing %s %s leaves every imbalance where it was', e.amount_cents, e.currency));
END $$;
ROLLBACK TO SAVEPOINT doors;

SAVEPOINT doors;
DO $$
DECLARE
    v_before jsonb := pg_temp.imbalances();
    e finance.escrows := pg_temp.releasable_escrow();
BEGIN
    PERFORM finance.fn_refund_ticket_escrow(e.ticket_id);
    PERFORM pg_temp.check((SELECT status FROM finance.escrows WHERE id = e.id) = 'refunded',
        '3 fixture: the refund door refunded the escrow');
    PERFORM pg_temp.check(pg_temp.moved(v_before, pg_temp.imbalances()) = '{}'::jsonb,
        format('3 refunding %s %s leaves every imbalance where it was', e.amount_cents, e.currency));
END $$;
ROLLBACK TO SAVEPOINT doors;
-- #endregion

-- #region 4. A credit with no cash (CO20's shape)
SAVEPOINT co20;
DO $$
DECLARE
    v_before jsonb := pg_temp.imbalances();
    v_owner uuid;
    v_type text;
    v_currency text;
    v_moved jsonb;
BEGIN
    -- A settlement currency no wallet holds yet, so the imbalance is a row of its own.
    SELECT s INTO v_currency
      FROM unnest(ARRAY['EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'SGD', 'CHF', 'ZAR']) WITH ORDINALITY AS c (s, n)
     WHERE NOT EXISTS (SELECT 1 FROM finance.wallets w WHERE upper(w.currency) = c.s)
     ORDER BY c.n
     LIMIT 1;
    SELECT w.owner_id, w.owner_type INTO v_owner, v_type
      FROM finance.wallets w WHERE w.owner_type IN ('user', 'freelancer') ORDER BY w.created_at, w.id LIMIT 1;
    PERFORM finance.fn_ensure_wallet(v_type, v_owner, v_currency);
    PERFORM finance.fn_wallet_credit(v_owner, v_type, v_currency, 4321, 'topup', NULL, NULL);
    v_moved := pg_temp.moved(v_before, pg_temp.imbalances());
    PERFORM pg_temp.check(v_moved = jsonb_build_object(v_currency, 4321),
        format('4 a %s top-up credited with no payment behind it reads +4321 in %s only (moved %s)',
               v_currency, v_currency, v_moved));
END $$;
ROLLBACK TO SAVEPOINT co20;

SAVEPOINT co20;
DO $$
DECLARE
    v_before jsonb := pg_temp.imbalances();
    w finance.wallets;
    v_moved jsonb;
BEGIN
    SELECT * INTO w FROM finance.wallets x WHERE x.owner_type = 'business' ORDER BY x.created_at, x.id LIMIT 1;
    PERFORM finance.fn_wallet_credit(w.owner_id, 'business', w.currency, 77000, 'on_account_credit', 'baskets', NULL);
    v_moved := pg_temp.moved(v_before, pg_temp.imbalances());
    PERFORM pg_temp.check(v_moved = jsonb_build_object(upper(w.currency), 77000),
        format('4 an on-account credit with no invoiced order reads +77000 in %s only (moved %s)',
               upper(w.currency), v_moved));
END $$;
ROLLBACK TO SAVEPOINT co20;
-- #endregion

-- #region 5. A released unfunded deadline bonus (N4's shape)
SAVEPOINT n4;
ALTER TABLE finance.escrows DROP CONSTRAINT ck_escrows_bonus_unfunded;
DO $$
DECLARE
    v_before jsonb;
    e finance.escrows := pg_temp.releasable_escrow();
    v_moved jsonb;
BEGIN
    UPDATE finance.escrows SET deadline_bonus_cents = 12500 WHERE id = e.id;
    v_before := pg_temp.imbalances();
    PERFORM finance.fn_release_ticket_escrow(e.ticket_id);
    v_moved := pg_temp.moved(v_before, pg_temp.imbalances());
    PERFORM pg_temp.check(v_moved = jsonb_build_object(upper(e.currency), 12500),
        format('5 releasing a 12500 bonus nothing funded reads +12500 in %s only (moved %s)',
               upper(e.currency), v_moved));
END $$;
ROLLBACK TO SAVEPOINT n4;
-- #endregion

-- #region 6. The nightly check
SAVEPOINT nightly;
DO $$
DECLARE
    v_owner uuid;
    v_type text;
    v_currency text;
    v_bad integer;
    v_run text;
    v_rows integer;
    v_balance bigint;
    v_err ops.log_entries;
BEGIN
    SELECT s INTO v_currency
      FROM unnest(ARRAY['EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'SGD', 'CHF', 'ZAR']) WITH ORDINALITY AS c (s, n)
     WHERE NOT EXISTS (SELECT 1 FROM finance.wallets w WHERE upper(w.currency) = c.s)
     ORDER BY c.n
     LIMIT 1;
    SELECT w.owner_id, w.owner_type INTO v_owner, v_type
      FROM finance.wallets w WHERE w.owner_type IN ('user', 'freelancer') ORDER BY w.created_at, w.id LIMIT 1;
    PERFORM finance.fn_ensure_wallet(v_type, v_owner, v_currency);
    PERFORM finance.fn_wallet_credit(v_owner, v_type, v_currency, 990, 'topup', NULL, NULL);
    SELECT sum(balance_cents) INTO v_balance FROM finance.wallets;

    v_bad := finance.fn_check_conservation();
    SELECT l.data ->> 'run_id' INTO v_run FROM ops.log_entries l
     WHERE l.scope = 'finance.conservation' ORDER BY l.created_at DESC LIMIT 1;
    SELECT count(*) INTO v_rows FROM ops.log_entries l
     WHERE l.scope = 'finance.conservation' AND l.data ->> 'run_id' = v_run;
    PERFORM pg_temp.check(v_bad = 1 AND v_rows = (SELECT count(*) FROM finance.v_conservation_identity),
        format('6 one row per currency (%s) under one run, and it counts the 1 imbalanced currency', v_rows));
    SELECT * INTO v_err FROM ops.log_entries l
     WHERE l.scope = 'finance.conservation' AND l.data ->> 'run_id' = v_run AND l.level = 'error';
    PERFORM pg_temp.check(
        v_err.source = 'server' AND v_err.data ->> 'currency' = v_currency
        AND (v_err.data ->> 'imbalance_minor')::bigint = 990
        AND v_err.data ? 'in_cash_minor' AND v_err.data ? 'held_wallets_minor' AND v_err.data ? 'fees_escrows_minor',
        format('6 the %s row is an error from the server carrying its imbalance and every term', v_currency));
    PERFORM pg_temp.check(NOT EXISTS (
        SELECT 1 FROM ops.log_entries l
         WHERE l.scope = 'finance.conservation' AND l.data ->> 'run_id' = v_run
           AND l.data ->> 'currency' <> v_currency AND l.level <> 'metric'),
        '6 every balanced currency is a metric row');
    PERFORM pg_temp.check((SELECT sum(balance_cents) FROM finance.wallets) = v_balance
        AND (SELECT imbalance_minor FROM finance.v_conservation_identity WHERE currency = v_currency) = 990,
        '6 the check corrects nothing');
END $$;
-- #endregion

-- #region 7. The operator read (runs inside section 6's savepoint, so tonight's rows exist)
DO $$
DECLARE
    v_operator uuid;
    v_member uuid;
    v_health jsonb;
    v_logs bigint := (SELECT count(*) FROM ops.log_entries);
    v_wallet uuid;
BEGIN
    SELECT a.user_id INTO v_operator FROM ops.admin_users a ORDER BY a.created_at LIMIT 1;
    SELECT u.user_id INTO v_member FROM org.users_public u
     WHERE NOT EXISTS (SELECT 1 FROM ops.admin_users a WHERE a.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    IF v_operator IS NULL OR v_member IS NULL THEN
        RAISE EXCEPTION 'FAIL 7 fixture: the seed needs an operator and a member';
    END IF;

    PERFORM pg_temp.check(pg_temp.read_state(v_member) = '42501', '7 a member is refused (42501)');
    PERFORM pg_temp.check(pg_temp.read_state(NULL, true) = '42501', '7 a caller with no JWT is refused (42501)');

    v_health := pg_temp.read_as(v_operator);
    PERFORM pg_temp.check(
        v_health -> 'currencies' = (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.currency) FROM finance.v_conservation_identity c),
        '7 the operator sees the identity the view computes, per currency');
    PERFORM pg_temp.check(
        jsonb_array_length(v_health -> 'nights') = (SELECT count(*) FROM ops.log_entries l
                                                     WHERE l.scope = 'finance.conservation'
                                                       AND l.created_at >= now() - interval '30 days')
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_health -> 'nights') n
                     WHERE (n ->> 'balanced')::boolean = false AND (n ->> 'imbalance_minor')::bigint = 990),
        '7 the operator sees the last 30 nights, tonight''s imbalance among them');
    PERFORM pg_temp.check(jsonb_array_length(v_health -> 'drift' -> 'wallets') = 0,
        '7 no drift is open on the seed');

    -- A balance written past the ledger: open drift, and an imbalance too.
    SELECT w.id INTO v_wallet FROM finance.wallets w WHERE w.balance_cents > 0 ORDER BY w.id LIMIT 1;
    UPDATE finance.wallets SET balance_cents = balance_cents + 1 WHERE id = v_wallet;
    v_health := pg_temp.read_as(v_operator);
    PERFORM pg_temp.check(
        (v_health -> 'drift' -> 'wallets' -> 0 ->> 'wallet_id')::uuid = v_wallet
        AND jsonb_array_length(v_health -> 'drift' -> 'wallets') = 1,
        '7 a balance written past its ledger is listed as open drift');
    PERFORM pg_temp.check((SELECT count(*) FROM ops.log_entries) = v_logs,
        '7 the read writes nothing');
END $$;
ROLLBACK TO SAVEPOINT nightly;
-- #endregion

ROLLBACK;
