-- =============================================================================================
-- Probe: only an active business transacts; archiving lists every blocker; business visibility
-- (BUSINESSES_AUDIT BF7, BF8, BF9, BF48; BB5; Decision #230 (h)).
--
--   A. A draft (then archived) business is refused 55000 `business_not_active` on every door that
--      commissions, buys, funds, hires or bills: create_project, place_wallet_order, the spend gate
--      (finance.fn_assert_business_spend — every money door's), fund_stage, the hire assertion and a
--      hiring door, pay_invoice and set_invoicing_terms. The same doors pass that check once it is active.
--   B. Each archive blocker refuses org.set_workspace_status('archived') with its own code, and
--      org.get_workspace_detail lists it (to an archive_entity holder only); with none, archiving works.
--   C. Visibility: the directory (org.profiles_index) holds an active business only when `public`
--      (listed) or `unlisted` (not listed); `invite_only` and drafts are absent; create_workspace
--      defaults to `invite_only`; update_workspace sets it and refuses an unknown value.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/business_lifecycle.sql
--
-- Fixture (seeded): `heliafinance` (owner priyaraman, KYB verified, USD wallet) and its project
-- prj-k9gmv68pe9 (one stage, one ticket) for A; a fresh business `probe-bb5` owned by priyaraman,
-- inserted here, for B and C, with hannahcole as a plain member.
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

CREATE FUNCTION pg_temp.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    RAISE NOTICE 'ok   %', p_label;
END $$;

-- Run p_sql as p_actor in a subtransaction that is always rolled back. Returns 'ok', or
-- '<SQLSTATE> <message>' for the refusal.
CREATE FUNCTION pg_temp.try(p_actor uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    BEGIN
        PERFORM pg_temp.act(p_actor);
        EXECUTE p_sql;
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    RETURN CASE WHEN v_state = 'PX000' THEN 'ok' ELSE v_state || ' ' || v_msg END;
END $$;

-- The door refuses 55000 business_not_active.
CREATE FUNCTION pg_temp.expect_inactive(p_label text, p_actor uuid, p_sql text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v text := pg_temp.try(p_actor, p_sql);
BEGIN
    IF v LIKE '55000 business_not_active:%' THEN
        PERFORM pg_temp.pass(p_label);
    ELSE
        PERFORM pg_temp.fail(p_label, 'expected 55000 business_not_active, got ' || v);
    END IF;
END $$;

-- The door does not refuse for the business's status (it may refuse for something else).
CREATE FUNCTION pg_temp.expect_not_inactive(p_label text, p_actor uuid, p_sql text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v text := pg_temp.try(p_actor, p_sql);
BEGIN
    IF v LIKE '%business_not_active%' THEN
        PERFORM pg_temp.fail(p_label, 'an active business was refused: ' || v);
    ELSE
        PERFORM pg_temp.pass(p_label || ' (' || left(v, 70) || ')');
    END IF;
END $$;

-- In a rolled-back subtransaction: run p_setup (triggers off), read the detail's archive_blockers as
-- p_viewer, then try the archive as the owner. Returns both.
CREATE FUNCTION pg_temp.archive_attempt(p_setup text, p_viewer uuid, OUT blockers jsonb, OUT outcome text)
LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    BEGIN
        IF p_setup IS NOT NULL THEN
            SET LOCAL session_replication_role = replica;
            EXECUTE p_setup;
            SET LOCAL session_replication_role = origin;
        END IF;
        PERFORM pg_temp.act(p_viewer);
        blockers := org.get_workspace_detail('business', 'probe-bb5') -> 'archive_blockers';
        PERFORM pg_temp.act(pg_temp.id('owner'));
        PERFORM org.set_workspace_status('business', pg_temp.id('biz'), 'archived');
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    outcome := CASE WHEN v_state = 'PX000' THEN 'archived' ELSE v_state || ' ' || v_msg END;
END $$;

CREATE FUNCTION pg_temp.expect_blocker(p_code text, p_setup text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    SELECT * INTO r FROM pg_temp.archive_attempt(p_setup, pg_temp.id('owner'));
    IF r.outcome NOT LIKE '55000 ' || p_code || ':%' THEN
        PERFORM pg_temp.fail('archive refused: ' || p_code, 'got ' || r.outcome);
    ELSE
        PERFORM pg_temp.pass('archive refused: ' || p_code);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.blockers, '[]')) b
                    WHERE b->>'code' = p_code AND (b->>'count')::int > 0) THEN
        PERFORM pg_temp.fail('detail lists: ' || p_code, 'archive_blockers = ' || COALESCE(r.blockers::text, 'NULL'));
    ELSE
        PERFORM pg_temp.pass('detail lists: ' || p_code);
    END IF;
END $$;
-- #endregion

-- #region Fixture
INSERT INTO probe_ids VALUES
    ('owner',   (SELECT user_id FROM org.users_public WHERE username = 'priyaraman')),
    ('member',  (SELECT user_id FROM org.users_public WHERE username = 'hannahcole')),
    ('creator', (SELECT user_id FROM org.users_public WHERE username = 'lenamueller')),
    ('helia',   (SELECT id FROM org.business_profiles WHERE slug = 'heliafinance')),
    ('project', (SELECT id FROM projects.projects WHERE slug = 'prj-k9gmv68pe9'));
INSERT INTO probe_ids VALUES
    ('stage',  (SELECT id FROM projects.project_stages WHERE project_id = pg_temp.id('project') LIMIT 1)),
    ('ticket', (SELECT id FROM projects.tickets WHERE project_id = pg_temp.id('project') LIMIT 1)),
    ('helia_wallet', (SELECT id FROM finance.wallets WHERE owner_type = 'business' AND owner_id = pg_temp.id('helia') AND currency = 'USD'));
INSERT INTO probe_ids VALUES
    ('basket', gen_random_uuid()),
    ('invoice', gen_random_uuid());

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM probe_ids WHERE id IS NULL) THEN
        RAISE EXCEPTION 'fixture missing: %', (SELECT string_agg(k, ', ') FROM probe_ids WHERE id IS NULL);
    END IF;
END $$;

INSERT INTO finance.baskets (id, owner_type, owner_id) VALUES (pg_temp.id('basket'), 'business', pg_temp.id('helia'));
INSERT INTO finance.invoices (id, issue_to_business_id, amount_cents, total_cents, amount_due_cents, currency, status)
VALUES (pg_temp.id('invoice'), pg_temp.id('helia'), 100, 100, 100, 'USD', 'issued');

-- The stage's ticket waits for funding again (its escrow refunded, triggers off), so fund_stage reaches
-- the spend gate rather than answering "nothing to fund".
SET LOCAL session_replication_role = replica;
UPDATE finance.escrows SET status = 'refunded' WHERE ticket_id = pg_temp.id('ticket') AND status = 'held';
UPDATE projects.tickets SET payment_status = 'needs_funding', unit_price_cents = COALESCE(unit_price_cents, 1000)
 WHERE id = pg_temp.id('ticket');
SET LOCAL session_replication_role = origin;
-- #endregion

-- #region A. Draft and archived businesses do not transact
CREATE FUNCTION pg_temp.doors(p_phase text, p_expect_inactive boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_owner uuid := pg_temp.id('owner');
    v_doors text[][] := ARRAY[
        ['create_project', format($q$SELECT projects.create_project(jsonb_build_object('title', 'Probe', 'client_business_id', %L))$q$, pg_temp.id('helia'))],
        ['place_wallet_order', format($q$SELECT finance.place_wallet_order(%L, ARRAY[gen_random_uuid()], 'USD', '{}'::jsonb, NULL, 'probe-bb5-order-0001', 0)$q$, pg_temp.id('basket'))],
        ['spend gate', format($q$SELECT finance.fn_assert_business_spend(%L, %L, 1000, 'project_stages', %L)$q$, pg_temp.id('helia_wallet'), v_owner, pg_temp.id('stage'))],
        ['fund_stage', format($q$SELECT projects.fund_stage(%L, %L)$q$, pg_temp.id('project'), pg_temp.id('stage'))],
        ['hire assertion', format($q$SELECT projects.fn_assert_business_actor(%L, 'hire')$q$, pg_temp.id('project'))],
        ['assign_ticket_manual', format($q$SELECT projects.assign_ticket_manual(%L, %L)$q$, pg_temp.id('ticket'), pg_temp.id('member'))],
        ['pay_invoice', format($q$SELECT finance.pay_invoice(%L)$q$, pg_temp.id('invoice'))],
        ['set_invoicing_terms', format($q$SELECT finance.set_invoicing_terms('business', %L, 'intervaled_monthly', 28)$q$, pg_temp.id('helia'))]
    ];
    i int;
BEGIN
    FOR i IN 1 .. array_length(v_doors, 1) LOOP
        IF p_expect_inactive THEN
            PERFORM pg_temp.expect_inactive(p_phase || ': ' || v_doors[i][1], v_owner, v_doors[i][2]);
        ELSE
            PERFORM pg_temp.expect_not_inactive(p_phase || ': ' || v_doors[i][1], v_owner, v_doors[i][2]);
        END IF;
    END LOOP;
END $$;

SELECT pg_temp.doors('active', false);

UPDATE org.business_profiles SET status = 'draft' WHERE id = pg_temp.id('helia');
SELECT pg_temp.doors('draft', true);

UPDATE org.business_profiles SET status = 'archived' WHERE id = pg_temp.id('helia');
SELECT pg_temp.doors('archived', true);

DO $$
DECLARE
    v text := pg_temp.try(pg_temp.id('owner'),
        format($q$SELECT projects.create_project(jsonb_build_object('title', 'Probe', 'client_business_id', %L))$q$, pg_temp.id('helia')));
BEGIN
    IF v LIKE '%archived%restore%' THEN
        PERFORM pg_temp.pass('archived: refusal says restore');
    ELSE
        PERFORM pg_temp.fail('archived: refusal says restore', v);
    END IF;
END $$;

UPDATE org.business_profiles SET status = 'active' WHERE id = pg_temp.id('helia');
-- #endregion

-- #region B. Archive blockers
INSERT INTO org.business_profiles (owner_user_id, name, slug, status, headline, visibility)
VALUES (pg_temp.id('owner'), 'Probe BB5', 'probe-bb5', 'active', '', 'public');
INSERT INTO probe_ids VALUES ('biz', (SELECT id FROM org.business_profiles WHERE slug = 'probe-bb5'));
SELECT org.fn_seed_preset_roles('business', pg_temp.id('biz'));
INSERT INTO org.business_members (business_id, user_id, role_id, status)
SELECT pg_temp.id('biz'), pg_temp.id('owner'), r.id, 'active'
  FROM org.business_roles r WHERE r.business_id = pg_temp.id('biz') AND r.preset = 'owner';
INSERT INTO org.business_members (business_id, user_id, role_id, status)
SELECT pg_temp.id('biz'), pg_temp.id('member'), r.id, 'active'
  FROM org.business_roles r WHERE r.business_id = pg_temp.id('biz') AND r.preset = 'member';
INSERT INTO finance.wallets (owner_type, owner_id, currency) VALUES ('business', pg_temp.id('biz'), 'USD');
INSERT INTO probe_ids VALUES ('biz_wallet', (SELECT id FROM finance.wallets WHERE owner_type = 'business' AND owner_id = pg_temp.id('biz')));

DO $$
BEGIN
    IF org.fn_business_archive_blockers(pg_temp.id('biz')) = '[]'::jsonb THEN
        PERFORM pg_temp.pass('fresh business: no blockers');
    ELSE
        PERFORM pg_temp.fail('fresh business: no blockers', org.fn_business_archive_blockers(pg_temp.id('biz'))::text);
    END IF;
END $$;

SELECT pg_temp.expect_blocker('escrow_held', format(
    $q$INSERT INTO finance.escrows (project_stage_id, payer_business_id, payee_type, payee_id, amount_cents, currency, status)
       VALUES (%L, %L, 'freelancer', %L, 100, 'USD', 'held')$q$, pg_temp.id('stage'), pg_temp.id('biz'), pg_temp.id('member')));
SELECT pg_temp.expect_blocker('live_projects', format(
    $q$UPDATE projects.projects SET client_business_id = %L WHERE id = %L$q$, pg_temp.id('biz'), pg_temp.id('project')));
SELECT pg_temp.expect_blocker('pending_approvals', format(
    $q$INSERT INTO finance.spend_approvals (wallet_id, requested_by, amount_cents, currency, reason, ref_table, ref_id)
       VALUES (%L, %L, 100, 'USD', 'probe', 'baskets', gen_random_uuid())$q$, pg_temp.id('biz_wallet'), pg_temp.id('member')));
SELECT pg_temp.expect_blocker('unpaid_invoices', format(
    $q$INSERT INTO finance.invoices (issue_to_business_id, amount_cents, currency, status) VALUES (%L, 0, 'USD', 'overdue')$q$,
    pg_temp.id('biz')));
SELECT pg_temp.expect_blocker('on_account_owed', format(
    $q$SELECT finance.fn_wallet_credit(%L, 'business', 'USD', 100, 'on_account_credit', 'baskets', gen_random_uuid())$q$,
    pg_temp.id('biz')));
SELECT pg_temp.expect_blocker('wallet_balance', format(
    $q$UPDATE finance.wallets SET balance_cents = 100 WHERE id = %L$q$, pg_temp.id('biz_wallet')));
SELECT pg_temp.expect_blocker('pending_payouts', format(
    $q$INSERT INTO finance.payouts (wallet_id, amount_cents, currency, status) VALUES (%L, 100, 'USD', 'pending')$q$,
    pg_temp.id('biz_wallet')));

-- Several at once: the refusal leads with the first in order, and the detail lists every one.
DO $$
DECLARE
    r record;
BEGIN
    SELECT * INTO r FROM pg_temp.archive_attempt(format(
        $q$UPDATE finance.wallets SET balance_cents = 100 WHERE id = %L;
           INSERT INTO finance.invoices (issue_to_business_id, amount_cents, currency, status) VALUES (%L, 0, 'USD', 'issued')$q$,
        pg_temp.id('biz_wallet'), pg_temp.id('biz')), pg_temp.id('owner'));
    IF r.outcome LIKE '55000 unpaid_invoices:%'
       AND (SELECT array_agg(b->>'code' ORDER BY ord) FROM jsonb_array_elements(r.blockers) WITH ORDINALITY x(b, ord))
           = ARRAY['unpaid_invoices', 'wallet_balance'] THEN
        PERFORM pg_temp.pass('two blockers: first refuses, both listed in order');
    ELSE
        PERFORM pg_temp.fail('two blockers: first refuses, both listed in order', r.outcome || ' / ' || COALESCE(r.blockers::text, 'NULL'));
    END IF;

    -- A member without archive_entity is not shown the blockers.
    SELECT * INTO r FROM pg_temp.archive_attempt(format(
        $q$UPDATE finance.wallets SET balance_cents = 100 WHERE id = %L$q$, pg_temp.id('biz_wallet')), pg_temp.id('member'));
    IF r.blockers = '[]'::jsonb THEN
        PERFORM pg_temp.pass('member without archive_entity sees no blockers');
    ELSE
        PERFORM pg_temp.fail('member without archive_entity sees no blockers', COALESCE(r.blockers::text, 'NULL'));
    END IF;

    -- Nothing in the way: the archive goes through.
    SELECT * INTO r FROM pg_temp.archive_attempt(NULL, pg_temp.id('owner'));
    IF r.outcome = 'archived' AND r.blockers = '[]'::jsonb THEN
        PERFORM pg_temp.pass('no blockers: archived');
    ELSE
        PERFORM pg_temp.fail('no blockers: archived', r.outcome || ' / ' || COALESCE(r.blockers::text, 'NULL'));
    END IF;
END $$;
-- #endregion

-- #region C. Visibility
CREATE FUNCTION pg_temp.directory(p_status text, p_visibility text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_listed boolean;
BEGIN
    UPDATE org.business_profiles SET status = p_status, visibility = p_visibility WHERE id = pg_temp.id('biz');
    SELECT pi.listed INTO v_listed FROM org.profiles_index pi WHERE pi.entity_type = 'business' AND pi.entity_id = pg_temp.id('biz');
    RETURN CASE WHEN NOT FOUND THEN 'absent' WHEN v_listed THEN 'listed' ELSE 'by handle' END;
END $$;

DO $$
DECLARE
    c record;
    v text;
BEGIN
    FOR c IN SELECT * FROM (VALUES
        ('active', 'public', 'listed'),
        ('active', 'unlisted', 'by handle'),
        ('active', 'invite_only', 'absent'),
        ('draft', 'public', 'absent'),
        ('archived', 'public', 'absent')) x(status, visibility, expected)
    LOOP
        v := pg_temp.directory(c.status, c.visibility);
        IF v = c.expected THEN
            PERFORM pg_temp.pass(format('directory: %s + %s → %s', c.status, c.visibility, v));
        ELSE
            PERFORM pg_temp.fail(format('directory: %s + %s', c.status, c.visibility), 'expected ' || c.expected || ', got ' || v);
        END IF;
    END LOOP;
    UPDATE org.business_profiles SET status = 'active', visibility = 'public' WHERE id = pg_temp.id('biz');

    -- The seeded businesses stay listed.
    IF (SELECT count(*) FROM org.profiles_index WHERE entity_type = 'business' AND listed
          AND handle IN ('heliafinance', 'atlaslabs')) = 2 THEN
        PERFORM pg_temp.pass('seeded businesses listed');
    ELSE
        PERFORM pg_temp.fail('seeded businesses listed', 'not both listed');
    END IF;

    -- update_workspace sets it; an unknown value is refused.
    v := pg_temp.try(pg_temp.id('owner'), format(
        $q$DO $d$ BEGIN
            PERFORM org.update_workspace('business', %L, '{"visibility":"unlisted"}');
            IF (SELECT visibility FROM org.business_profiles WHERE id = %L) <> 'unlisted' THEN
                RAISE EXCEPTION 'not set';
            END IF;
        END $d$ $q$, pg_temp.id('biz'), pg_temp.id('biz')));
    IF v = 'ok' THEN PERFORM pg_temp.pass('update_workspace sets visibility');
    ELSE PERFORM pg_temp.fail('update_workspace sets visibility', v); END IF;

    v := pg_temp.try(pg_temp.id('owner'), format(
        $q$SELECT org.update_workspace('business', %L, '{"visibility":"secret"}')$q$, pg_temp.id('biz')));
    IF v LIKE '22023 visibility:%' THEN PERFORM pg_temp.pass('update_workspace refuses an unknown visibility');
    ELSE PERFORM pg_temp.fail('update_workspace refuses an unknown visibility', v); END IF;

    -- A created business starts draft and invite_only, and is not in the directory.
    v := pg_temp.try(pg_temp.id('creator'),
        $q$DO $d$ DECLARE r jsonb; BEGIN
            r := org.create_workspace('business', 'Probe Created', 'probe-bb5-created');
            IF (SELECT visibility || '/' || status FROM org.business_profiles WHERE id = (r->>'id')::uuid) <> 'invite_only/draft' THEN
                RAISE EXCEPTION 'created as %', (SELECT visibility || '/' || status FROM org.business_profiles WHERE id = (r->>'id')::uuid);
            END IF;
            IF EXISTS (SELECT 1 FROM org.profiles_index WHERE entity_id = (r->>'id')::uuid) THEN
                RAISE EXCEPTION 'draft is in the directory';
            END IF;
        END $d$ $q$);
    IF v = 'ok' THEN PERFORM pg_temp.pass('create_workspace: draft + invite_only, not in the directory');
    ELSE PERFORM pg_temp.fail('create_workspace: draft + invite_only, not in the directory', v); END IF;
END $$;
-- #endregion

-- #region Verdict
DO $$
DECLARE
    v_n int := (SELECT count(*) FROM probe_fails);
BEGIN
    IF v_n > 0 THEN
        RAISE EXCEPTION 'business_lifecycle: % failure(s): %', v_n, (SELECT string_agg(label, '; ') FROM probe_fails);
    END IF;
    RAISE NOTICE 'business_lifecycle: all checks passed';
END $$;
-- #endregion

ROLLBACK;
