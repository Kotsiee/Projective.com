-- escrow_bonus_unfunded.sql — no unfunded deadline bonus can be paid (Decision #337, ruling M7, step C;
-- FCA N4).
--
-- Release pays amount + deadline_bonus_cents − fee, and nothing debits the bonus from the payer, so a
-- non-zero bonus is money created at release. Until the bonus is held with its escrow (ruling M7, step
-- A), finance.escrows refuses one (ck_escrows_bonus_unfunded). Rolled back; writes nothing:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/escrow_bonus_unfunded.sql
--   1. The column stays bigint NOT NULL DEFAULT 0 and carries ck_escrows_bonus_unfunded (= 0).
--   2. No escrow carries a bonus: the seeds write 0.
--   3. A bonus of 1, written by INSERT or by UPDATE, is refused with 23514.
--   4. A seeded held escrow still releases amount − fee, the fee on the amount at its payer's rate.
\set ON_ERROR_STOP on
\set QUIET on

BEGIN;

-- #region Helpers
CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- Runs one statement that must be refused by ck_escrows_bonus_unfunded; returns 'SQLSTATE constraint'.
CREATE OR REPLACE FUNCTION pg_temp.refusal(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_constraint text;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
        RETURN v_state || ' ' || COALESCE(NULLIF(v_constraint, ''), '-');
    END;
    RETURN 'accepted';
END $$;
-- #endregion

-- #region 1. The column and its CHECK
SELECT pg_temp.ok(
    (SELECT format_type(a.atttypid, a.atttypmod) = 'bigint' AND a.attnotnull
            AND pg_get_expr(d.adbin, d.adrelid) = '0'
       FROM pg_attribute a
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'finance.escrows'::regclass AND a.attname = 'deadline_bonus_cents'
        AND NOT a.attisdropped),
    '1: finance.escrows.deadline_bonus_cents is still bigint NOT NULL DEFAULT 0');
SELECT pg_temp.ok(
    (SELECT pg_get_constraintdef(c.oid) = 'CHECK ((deadline_bonus_cents = 0))'
       FROM pg_constraint c
      WHERE c.conrelid = 'finance.escrows'::regclass AND c.conname = 'ck_escrows_bonus_unfunded'),
    '1: ck_escrows_bonus_unfunded is CHECK (deadline_bonus_cents = 0)');
SELECT pg_temp.ok(
    NOT EXISTS (SELECT 1 FROM pg_constraint c
                 WHERE c.conrelid = 'finance.escrows'::regclass AND c.contype = 'c'
                   AND c.conname <> 'ck_escrows_bonus_unfunded'
                   AND pg_get_constraintdef(c.oid) LIKE '%deadline_bonus_cents%'),
    '1: no other CHECK governs the bonus');
-- #endregion

-- #region 2. The seeds write 0
SELECT pg_temp.ok((SELECT count(*) > 0 FROM finance.escrows), '2: the seeds hold escrows');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM finance.escrows WHERE deadline_bonus_cents <> 0),
    '2: no escrow carries a deadline bonus');
-- #endregion

-- #region 3. A bonus of 1 is refused
SELECT id AS any_escrow FROM finance.escrows ORDER BY id LIMIT 1 \gset
SELECT pg_temp.ok(
    pg_temp.refusal(format(
        'INSERT INTO finance.escrows (project_stage_id, ticket_id, payer_business_id, payer_user_id,
                                      payee_type, payee_id, amount_cents, currency, status,
                                      deadline_bonus_cents)
         SELECT project_stage_id, ticket_id, payer_business_id, payer_user_id,
                payee_type, payee_id, amount_cents, currency, ''released'', 1
           FROM finance.escrows WHERE id = %L', :'any_escrow')) = '23514 ck_escrows_bonus_unfunded',
    '3: an escrow inserted with a bonus of 1 is refused (23514, ck_escrows_bonus_unfunded)');
SELECT pg_temp.ok(
    pg_temp.refusal(format(
        'UPDATE finance.escrows SET deadline_bonus_cents = 1 WHERE id = %L', :'any_escrow'))
        = '23514 ck_escrows_bonus_unfunded',
    '3: a bonus of 1 written onto an existing escrow is refused (23514, ck_escrows_bonus_unfunded)');
-- #endregion

-- #region 4. A seeded escrow still releases amount − fee
DO $probe$
DECLARE
    e finance.escrows;
    v_fee_bp integer;
    v_paid_before bigint;
    v_paid_after bigint;
    v_credited bigint;
    v_after finance.escrows;
BEGIN
    SELECT x.* INTO e
      FROM finance.escrows x
     WHERE x.status = 'held' AND x.ticket_id IS NOT NULL AND x.payee_type = 'freelancer'
       AND x.revision_id IS NULL AND NOT finance.fn_escrow_has_open_dispute(x.id)
       AND (SELECT count(*) FROM finance.escrows o
             WHERE o.ticket_id = x.ticket_id AND o.status = 'held') = 1
     ORDER BY x.id
     LIMIT 1;
    PERFORM pg_temp.ok(e.id IS NOT NULL, '4: the seeds hold a lone, undisputed, held freelancer escrow');

    v_fee_bp := finance.fn_escrow_fee_bp(e.payer_business_id, e.payer_user_id);
    SELECT total_amount_paid INTO v_paid_before FROM projects.tickets WHERE id = e.ticket_id;

    PERFORM finance.fn_release_ticket_escrow(e.ticket_id);

    SELECT * INTO v_after FROM finance.escrows WHERE id = e.id;
    SELECT total_amount_paid INTO v_paid_after FROM projects.tickets WHERE id = e.ticket_id;
    v_credited := COALESCE((SELECT sum(p.amount_cents) FROM finance.pending_releases p
                             WHERE p.escrow_id = e.id), 0)
                + COALESCE((SELECT sum(t.amount_cents) FROM finance.transactions t
                             WHERE t.ref_table = 'escrows' AND t.ref_id = e.id
                               AND t.direction = 'credit' AND t.reason = 'escrow_release'), 0);

    PERFORM pg_temp.ok(v_after.status = 'released', '4: the escrow is released');
    PERFORM pg_temp.ok(v_after.deadline_bonus_cents = 0, '4: the released escrow carries no bonus');
    PERFORM pg_temp.ok(v_after.platform_fee_cents = (e.amount_cents * v_fee_bp) / 10000,
        format('4: the fee is the payer''s %s bp on the amount alone (%s)', v_fee_bp, v_after.platform_fee_cents));
    PERFORM pg_temp.ok(v_credited = e.amount_cents - v_after.platform_fee_cents,
        format('4: the payee is credited amount − fee (%s = %s − %s)',
               v_credited, e.amount_cents, v_after.platform_fee_cents));
    PERFORM pg_temp.ok(v_paid_after - v_paid_before = e.amount_cents - v_after.platform_fee_cents,
        '4: the ticket''s total paid moves by amount − fee');
END
$probe$;
-- #endregion

ROLLBACK;
