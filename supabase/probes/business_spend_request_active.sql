-- =============================================================================================
-- Probe: a spend request is filed only on an ACTIVE business's wallet (Decision #299 code follow-up
-- (5); BZ2).
--
-- Only an active business transacts (BB5, Decision #236): every spend through
-- finance.fn_assert_business_spend is refused `55000 business_not_active` on a draft or archived
-- business, so an approval filed there could never be spent. finance.request_spend_approval refuses
-- it the same way — after the wallet and the requester's `spend` right, before the ref and the amount.
--
--   1. Active: a member over her per-purchase ceiling files a request (allowed).
--   2. Draft: the same member is refused 55000 `business_not_active: publish the business first`.
--   3. Archived: refused 55000 `business_not_active: this business is archived — restore it first`.
--   4. No request was written by either refusal.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/business_spend_request_active.sql
--
-- Fixture (seeded data): Helia Finance (`heliafinance`, active, KYB verified) — hannahcole, an admin
-- with a 10 000.00 per-purchase ceiling on its USD wallet — and two of its stages no request names.
-- A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

-- Hannah files 12 000.00 for p_stage. p_prefix NULL: it must succeed. Otherwise it must be refused
-- 55000 with a MESSAGE starting p_prefix.
CREATE FUNCTION pg_temp.file(p_label text, p_stage uuid, p_prefix text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    PERFORM set_config('finance.spend_cover', '', true);
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', pg_temp.id('hannah'), 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM finance.request_spend_approval(pg_temp.id('wallet'), 1200000, 'Probe request', 'project_stages', p_stage);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    IF p_prefix IS NULL THEN
        IF v_state IS NOT NULL THEN
            RAISE EXCEPTION 'FAIL % — refused % "%" (expected it to go through)', p_label, v_state, v_msg;
        END IF;
        RAISE NOTICE 'PASS % (filed)', p_label;
        RETURN;
    END IF;
    IF v_state IS DISTINCT FROM '55000' OR v_msg NOT LIKE p_prefix || '%' THEN
        RAISE EXCEPTION 'FAIL % — got % "%" (expected 55000 "%…")', p_label, COALESCE(v_state, 'a filed request'), v_msg, p_prefix;
    END IF;
    RAISE NOTICE 'PASS % (55000 %)', p_label, p_prefix;
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_helia uuid;
BEGIN
    SELECT b.id INTO v_helia FROM org.business_profiles b WHERE b.slug = 'heliafinance' AND b.status = 'active';
    INSERT INTO probe_ids VALUES
        ('helia', v_helia),
        ('wallet', (SELECT w.id FROM finance.wallets w WHERE w.owner_type = 'business' AND w.owner_id = v_helia AND w.currency = 'USD')),
        ('hannah', (SELECT user_id FROM org.users_public WHERE username = 'hannahcole')),
        ('stage_a', (SELECT ps.id FROM projects.project_stages ps JOIN projects.projects p ON p.id = ps.project_id
                      WHERE p.client_business_id = v_helia
                        AND NOT EXISTS (SELECT 1 FROM finance.spend_approvals sa WHERE sa.ref_id = ps.id)
                      ORDER BY ps.id LIMIT 1)),
        ('stage_b', (SELECT ps.id FROM projects.project_stages ps JOIN projects.projects p ON p.id = ps.project_id
                      WHERE p.client_business_id = v_helia
                        AND NOT EXISTS (SELECT 1 FROM finance.spend_approvals sa WHERE sa.ref_id = ps.id)
                      ORDER BY ps.id OFFSET 1 LIMIT 1));
    IF pg_temp.id('wallet') IS NULL OR pg_temp.id('hannah') IS NULL OR pg_temp.id('stage_b') IS NULL
       OR (SELECT per_transaction_cents FROM finance.spending_limits
            WHERE wallet_id = pg_temp.id('wallet') AND member_user_id = pg_temp.id('hannah')) IS DISTINCT FROM 1000000 THEN
        RAISE EXCEPTION 'FAIL fixture — active Helia, its USD wallet, hannahcole''s 10 000.00 ceiling and two free stages — deno task db:reset';
    END IF;
END $$;
-- #endregion

-- #region 1–4
SELECT pg_temp.file('1 active: a request over the ceiling is filed', pg_temp.id('stage_a'), NULL);

UPDATE org.business_profiles SET status = 'draft' WHERE id = pg_temp.id('helia');
SELECT pg_temp.file('2 draft: refused', pg_temp.id('stage_b'), 'business_not_active: publish the business first');

UPDATE org.business_profiles SET status = 'archived' WHERE id = pg_temp.id('helia');
SELECT pg_temp.file('3 archived: refused', pg_temp.id('stage_b'), 'business_not_active: this business is archived');

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM finance.spend_approvals WHERE ref_id = pg_temp.id('stage_b')) THEN
        RAISE EXCEPTION 'FAIL 4 a refused filing wrote a request';
    END IF;
    RAISE NOTICE 'PASS 4 neither refusal wrote a request';
END $$;
-- #endregion

ROLLBACK;
