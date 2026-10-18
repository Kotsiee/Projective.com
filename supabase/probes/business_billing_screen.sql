-- =============================================================================================
-- Probe: the business Billing module's reads and its Pay door (BU3, Decision #247; BUSINESSES_AUDIT
-- BD14–BD17, BF32, BF33).
--
-- Pins:
--   1. finance.get_billing_settings answers `plan_allows_monthly` — whether monthly invoicing is open
--      to the business under the Business Pro gate (`intervaled_invoicing`, Decision #230 (e)), by the
--      same rule finance.fn_assert_business_entitlement refuses with: false on Business Free with the
--      switch on, true with the switch off, on Business Pro, or with a grant; the development header
--      `x-pj-dev-plan-gates: free` only makes it stricter.
--   2. Its `can_pay` agrees with org.get_workspace_detail's `viewer_can.pay_invoice` for the owner, an
--      admin without the billing right and the owner of a KYB-pending business.
--   3. finance.pay_invoice refuses PF402 when the wallet holds less than is due, PC409 on a paid
--      invoice and 55000 on a business that is not active; it pays once from the wallet in the
--      invoice's currency, writing one `invoice_payment` debit.
--   4. pay_invoice refuses a KYB-pending business (PK403 `kyb_required:`), as `can_pay` and
--      `viewer_can.pay_invoice` already say — the door and the reads agree (Decision #247 (h)).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/business_billing_screen.sql
--
-- Fixture (seeded data): Helia Finance (`heliafinance`) — active, KYB verified, on Business Free with no
-- grant, its owner priyaraman and an admin hannahcole who does not hold `manage_billing`; Atlas Labs
-- (`atlaslabs`) — active, KYB pending, its owner danielokafor. The probe inserts its own consolidated
-- invoices. A clean run prints only PASS notices.
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

-- Put Helia on Business Pro (true) or back on its default Business Free (false).
CREATE FUNCTION pg_temp.pro(p_on boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM finance.subscriptions WHERE subject_type = 'business' AND subject_id = pg_temp.id('H');
    IF p_on THEN
        INSERT INTO finance.subscriptions (profile_id, subject_type, subject_id, plan_id, state)
        SELECT pg_temp.id('O'), 'business', pg_temp.id('H'), p.id, 'active'
          FROM finance.plans p WHERE p.code = 'business_pro';
    END IF;
END $$;

-- Helia's billing read as the owner: whether monthly invoicing is open to it.
CREATE FUNCTION pg_temp.allows() RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
    v jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('O'));
    v := finance.get_billing_settings(pg_temp.id('H'));
    IF v IS NULL OR NOT (v ? 'plan_allows_monthly') THEN
        RAISE EXCEPTION 'FAIL get_billing_settings answers no plan_allows_monthly (keys: %)',
            (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(COALESCE(v, '{}'::jsonb)) k);
    END IF;
    RETURN (v ->> 'plan_allows_monthly')::boolean;
END $$;

CREATE FUNCTION pg_temp.expect_allows(p_label text, p_want boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_got boolean := pg_temp.allows();
BEGIN
    IF v_got IS DISTINCT FROM p_want THEN
        RAISE EXCEPTION 'FAIL % — plan_allows_monthly is % (expected %)', p_label, v_got, p_want;
    END IF;
    RAISE NOTICE 'PASS % (plan_allows_monthly = %)', p_label, v_got;
END $$;

-- The two reads agree for p_user on the business p_handle, and both say p_want.
CREATE FUNCTION pg_temp.expect_pay(p_label text, p_user uuid, p_handle text, p_business uuid, p_want boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_settings jsonb;
    v_detail jsonb;
    v_can_pay boolean;
    v_viewer boolean;
BEGIN
    PERFORM pg_temp.act(p_user);
    v_settings := finance.get_billing_settings(p_business);
    v_detail := org.get_workspace_detail('business', p_handle);
    v_can_pay := COALESCE((v_settings ->> 'can_pay')::boolean, false);
    v_viewer := COALESCE((v_detail -> 'viewer_can' ->> 'pay_invoice')::boolean, false);
    IF v_can_pay IS DISTINCT FROM v_viewer THEN
        RAISE EXCEPTION 'FAIL % — can_pay % but viewer_can.pay_invoice %', p_label, v_can_pay, v_viewer;
    END IF;
    IF v_can_pay IS DISTINCT FROM p_want THEN
        RAISE EXCEPTION 'FAIL % — Pay offered = % (expected %)', p_label, v_can_pay, p_want;
    END IF;
    RAISE NOTICE 'PASS % (can_pay = viewer_can.pay_invoice = %)', p_label, v_can_pay;
END $$;

-- Pay p_invoice as p_actor inside a savepoint. p_state NULL: it must succeed. Otherwise it must be
-- refused with that SQLSTATE. Nothing a refusal did survives.
CREATE FUNCTION pg_temp.expect_paid(p_label text, p_actor uuid, p_invoice uuid, p_state text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    PERFORM pg_temp.act(p_actor);
    BEGIN
        PERFORM finance.pay_invoice(p_invoice);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF p_state IS NULL THEN
        IF v_state IS NOT NULL THEN
            RAISE EXCEPTION 'FAIL % — refused % "%" (expected it to go through)', p_label, v_state, v_msg;
        END IF;
        RAISE NOTICE 'PASS % (paid)', p_label;
        RETURN;
    END IF;
    IF v_state IS DISTINCT FROM p_state THEN
        RAISE EXCEPTION 'FAIL % — % "%" (expected %)', p_label, COALESCE(v_state, 'went through'), v_msg, p_state;
    END IF;
    RAISE NOTICE 'PASS % (% "%")', p_label, v_state, v_msg;
END $$;

CREATE FUNCTION pg_temp.invoice(p_business uuid, p_months_ago integer, p_due bigint, p_status text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO finance.invoices (issue_to_business_id, invoice_type, billing_period_start, billing_period_end,
        amount_cents, subtotal_cents, total_cents, amount_due_cents, currency, status, due_date)
    VALUES (p_business, 'consolidated_monthly',
        date_trunc('month', now()) - make_interval(months => p_months_ago + 24),
        date_trunc('month', now()) - make_interval(months => p_months_ago + 23),
        p_due, p_due, p_due, p_due, 'USD', p_status, now() + interval '5 days')
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_helia uuid;
    v_owner uuid;
    v_admin uuid;
    v_atlas uuid;
    v_atlas_owner uuid;
BEGIN
    SELECT b.id, b.owner_user_id INTO v_helia, v_owner FROM org.business_profiles b
     WHERE b.slug = 'heliafinance' AND b.status = 'active' AND b.kyb_status = 'verified'
       AND finance.fn_active_plan('business', b.id) = (SELECT p.id FROM finance.plans p WHERE p.code = 'business_free')
       AND NOT EXISTS (SELECT 1 FROM finance.entitlement_grants g WHERE g.subject_type = 'business' AND g.subject_id = b.id);
    SELECT m.user_id INTO v_admin FROM org.business_members m
      JOIN org.users_public u ON u.user_id = m.user_id
     WHERE m.business_id = v_helia AND m.status = 'active' AND m.role = 'admin' AND u.username = 'hannahcole';
    SELECT b.id, b.owner_user_id INTO v_atlas, v_atlas_owner FROM org.business_profiles b
     WHERE b.slug = 'atlaslabs' AND b.status = 'active' AND b.kyb_status IS DISTINCT FROM 'verified';
    IF v_helia IS NULL OR v_admin IS NULL OR v_atlas IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (helia %, admin %, atlas %) — deno task db:reset', v_helia, v_admin, v_atlas;
    END IF;
    INSERT INTO probe_ids (k, id) VALUES
        ('H', v_helia), ('O', v_owner), ('A', v_admin), ('L', v_atlas), ('D', v_atlas_owner);
    PERFORM pg_temp.gates(true);
    PERFORM pg_temp.dev(NULL);
END $$;
-- #endregion

-- #region 1. plan_allows_monthly follows the Business Pro gate
SELECT pg_temp.expect_allows('1a Business Free, gates on: monthly is Business Pro''s', false);
SELECT pg_temp.gates(false);
SELECT pg_temp.expect_allows('1b gates off: nothing is refused', true);
SELECT pg_temp.gates(true);
SELECT pg_temp.pro(true);
SELECT pg_temp.expect_allows('1c Business Pro: monthly is open', true);
SELECT pg_temp.dev('free');
SELECT pg_temp.expect_allows('1d Business Pro under the free simulation: stricter, closed', false);
SELECT pg_temp.dev(NULL);
SELECT pg_temp.pro(false);
INSERT INTO finance.entitlement_grants (subject_type, subject_id, entitlement_key, flag_value, reason)
VALUES ('business', pg_temp.id('H'), 'intervaled_invoicing', true, 'probe');
SELECT pg_temp.expect_allows('1e Business Free with a grant: open', true);
DELETE FROM finance.entitlement_grants WHERE subject_type = 'business' AND subject_id = pg_temp.id('H') AND reason = 'probe';
SELECT pg_temp.expect_allows('1f grant gone: closed again', false);
-- #endregion

-- #region 2. can_pay agrees with viewer_can.pay_invoice
SELECT pg_temp.expect_pay('2a the owner of a verified, active business', pg_temp.id('O'), 'heliafinance', pg_temp.id('H'), true);
SELECT pg_temp.expect_pay('2b an admin without the billing right', pg_temp.id('A'), 'heliafinance', pg_temp.id('H'), false);
SELECT pg_temp.expect_pay('2c the owner of a KYB-pending business', pg_temp.id('D'), 'atlaslabs', pg_temp.id('L'), false);
-- #endregion

-- #region 3. pay_invoice
DO $$
DECLARE
    v_balance bigint;
BEGIN
    SELECT w.balance_cents INTO v_balance FROM finance.wallets w
     WHERE w.owner_type = 'business' AND w.owner_id = pg_temp.id('H') AND upper(w.currency) = 'USD';
    INSERT INTO probe_ids (k, id) VALUES
        ('BIG', pg_temp.invoice(pg_temp.id('H'), 3, COALESCE(v_balance, 0) + 1, 'issued')),
        ('PAID', pg_temp.invoice(pg_temp.id('H'), 2, 64000, 'paid')),
        ('DUE', pg_temp.invoice(pg_temp.id('H'), 1, 64000, 'issued'));
END $$;

SELECT pg_temp.expect_paid('3a more due than the wallet holds', pg_temp.id('O'), pg_temp.id('BIG'), 'PF402');
SELECT pg_temp.expect_paid('3b an invoice already paid', pg_temp.id('O'), pg_temp.id('PAID'), 'PC409');
SELECT pg_temp.expect_paid('3c an admin without the billing right', pg_temp.id('A'), pg_temp.id('DUE'), '42501');

UPDATE org.business_profiles SET status = 'draft' WHERE id = pg_temp.id('H');
SELECT pg_temp.expect_pay('3d a draft business offers no Pay', pg_temp.id('O'), 'heliafinance', pg_temp.id('H'), false);
SELECT pg_temp.expect_paid('3e a draft business does not pay', pg_temp.id('O'), pg_temp.id('DUE'), '55000');
UPDATE org.business_profiles SET status = 'active' WHERE id = pg_temp.id('H');

DO $$
DECLARE
    v_before bigint;
    v_after bigint;
    v_debits integer;
BEGIN
    SELECT w.balance_cents INTO v_before FROM finance.wallets w
     WHERE w.owner_type = 'business' AND w.owner_id = pg_temp.id('H') AND upper(w.currency) = 'USD';
    PERFORM pg_temp.expect_paid('3f the owner pays what is due', pg_temp.id('O'), pg_temp.id('DUE'), NULL);
    SELECT w.balance_cents INTO v_after FROM finance.wallets w
     WHERE w.owner_type = 'business' AND w.owner_id = pg_temp.id('H') AND upper(w.currency) = 'USD';
    SELECT count(*) INTO v_debits FROM finance.transactions t
     WHERE t.reason = 'invoice_payment' AND t.direction = 'debit' AND t.ref_id = pg_temp.id('DUE');
    IF v_before - v_after <> 64000 OR v_debits <> 1 THEN
        RAISE EXCEPTION 'FAIL 3f — balance % → %, % invoice_payment debits (expected −64000 and 1)', v_before, v_after, v_debits;
    END IF;
    IF (SELECT status FROM finance.invoices WHERE id = pg_temp.id('DUE')) <> 'paid' THEN
        RAISE EXCEPTION 'FAIL 3f — the invoice is not marked paid';
    END IF;
    RAISE NOTICE 'PASS 3g one invoice_payment debit of the amount due; the invoice reads paid';
END $$;
SELECT pg_temp.expect_paid('3h paying it twice', pg_temp.id('O'), pg_temp.id('DUE'), 'PC409');
-- #endregion

-- #region 4. pay_invoice checks KYB, as the reads do
-- The wallet is funded first, so only KYB can refuse: a short wallet would answer PF402 instead.
DO $$
DECLARE
    v_invoice uuid := pg_temp.invoice(pg_temp.id('L'), 1, 100, 'issued');
    v_state text;
    v_msg text;
BEGIN
    UPDATE finance.wallets SET balance_cents = balance_cents + 100
     WHERE owner_type = 'business' AND owner_id = pg_temp.id('L') AND upper(currency) = 'USD';
    IF NOT FOUND THEN
        INSERT INTO finance.wallets (owner_type, owner_id, currency, balance_cents)
        VALUES ('business', pg_temp.id('L'), 'USD', 100);
    END IF;
    PERFORM pg_temp.act(pg_temp.id('D'));
    BEGIN
        PERFORM finance.pay_invoice(v_invoice);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_state IS DISTINCT FROM 'PK403' OR v_msg NOT LIKE 'kyb_required:%' THEN
        RAISE EXCEPTION 'FAIL 4 a KYB-pending business pays an invoice — % "%" (expected PK403 kyb_required:)',
            COALESCE(v_state, 'went through'), v_msg;
    END IF;
    IF (SELECT status FROM finance.invoices WHERE id = v_invoice) <> 'issued' THEN
        RAISE EXCEPTION 'FAIL 4 — the refused invoice changed status';
    END IF;
    RAISE NOTICE 'PASS 4 a KYB-pending business does not pay (% "%")', v_state, v_msg;
END $$;
-- #endregion

ROLLBACK;
