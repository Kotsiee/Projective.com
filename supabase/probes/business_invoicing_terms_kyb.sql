-- =============================================================================================
-- Probe: monthly invoicing terms refuse an unverified business the way every other KYB door does
-- (Decision #299 code follow-up (1); BZ2).
--
-- Pins:
--   1. finance.set_invoicing_terms to `intervaled_monthly` on an active, KYB-unverified business whose
--      plan gate passes (an `intervaled_invoicing` grant) is refused PK403 with MESSAGE
--      `kyb_required: …` and DETAIL `{business_id}` — the sub-code finance.fn_assert_business_spend and
--      finance.pay_invoice raise, so BillingBackendService.billingRefusal answers `details.reason
--      kyb_required` instead of a bare 403.
--   2. Going back to (or staying on) `per_transaction` is never KYB-gated.
--   3. The same business once verified sets monthly terms: KYB was the only refusal left.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/business_invoicing_terms_kyb.sql
--
-- Fixture (seeded data): an active business whose KYB is not verified (Atlas Labs, `atlaslabs`, in the
-- committed seed) and its owner, who holds `manage_billing`. A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims',
        CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$$;

-- Run p_sql as the owner inside a savepoint. p_code NULL: it must succeed. Otherwise it must be
-- refused with SQLSTATE p_code and a MESSAGE starting p_prefix; the refusal's DETAIL is returned.
CREATE FUNCTION pg_temp.expect(p_label text, p_sql text, p_code text, p_prefix text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
    v_detail text;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('O'));
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    END;
    PERFORM pg_temp.act(NULL);
    IF p_code IS NULL THEN
        IF v_state IS NOT NULL THEN
            RAISE EXCEPTION 'FAIL % — refused % "%" (expected it to go through)', p_label, v_state, v_msg;
        END IF;
        RAISE NOTICE 'PASS % (allowed)', p_label;
        RETURN NULL;
    END IF;
    IF v_state IS DISTINCT FROM p_code OR v_msg NOT LIKE p_prefix || '%' THEN
        RAISE EXCEPTION 'FAIL % — got % "%" (expected % "%…")', p_label, COALESCE(v_state, 'success'), v_msg, p_code, p_prefix;
    END IF;
    RAISE NOTICE 'PASS % (% %)', p_label, p_code, p_prefix;
    RETURN v_detail;
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_business uuid;
    v_owner uuid;
BEGIN
    SELECT b.id, b.owner_user_id INTO v_business, v_owner
      FROM org.business_profiles b
     WHERE b.status = 'active' AND b.kyb_status IS DISTINCT FROM 'verified'
     ORDER BY b.slug
     LIMIT 1;
    PERFORM pg_temp.act(v_owner);
    IF v_business IS NULL OR NOT finance.fn_owner_capability('business', v_business, 'manage_billing'::finance.vault_capability) THEN
        RAISE EXCEPTION 'FAIL no fixture (an active, KYB-unverified business and its billing owner) — deno task db:reset';
    END IF;
    PERFORM pg_temp.act(NULL);
    INSERT INTO probe_ids (k, id) VALUES ('H', v_business), ('O', v_owner);
END $$;

-- The plan gate passes whatever the business's plan is, so the call reaches the KYB check.
INSERT INTO finance.entitlement_grants (subject_type, subject_id, entitlement_key, flag_value, reason)
VALUES ('business', pg_temp.id('H'), 'intervaled_invoicing', true, 'probe');
UPDATE org.business_profiles SET invoicing_mode = 'per_transaction' WHERE id = pg_temp.id('H');
-- #endregion

-- #region 1–3
DO $$
DECLARE
    v_detail text;
BEGIN
    v_detail := pg_temp.expect('1 unverified: monthly refused as kyb_required',
        format($q$SELECT finance.set_invoicing_terms('business', %L, 'intervaled_monthly', 5)$q$, pg_temp.id('H')),
        'PK403', 'kyb_required:');
    IF (NULLIF(v_detail, '')::jsonb ->> 'business_id') IS DISTINCT FROM pg_temp.id('H')::text THEN
        RAISE EXCEPTION 'FAIL 1 DETAIL names the business — got %', v_detail;
    END IF;
    RAISE NOTICE 'PASS 1 DETAIL names the business';
    IF (SELECT invoicing_mode FROM org.business_profiles WHERE id = pg_temp.id('H')) <> 'per_transaction' THEN
        RAISE EXCEPTION 'FAIL 1 the refused change was written';
    END IF;

    PERFORM pg_temp.expect('2 unverified: per_transaction is never KYB-gated',
        format($q$SELECT finance.set_invoicing_terms('business', %L, 'per_transaction', 7)$q$, pg_temp.id('H')),
        NULL, NULL);

    UPDATE org.business_profiles SET kyb_status = 'verified', kyb_verified_at = now() WHERE id = pg_temp.id('H');
    PERFORM pg_temp.expect('3 verified: monthly goes through',
        format($q$SELECT finance.set_invoicing_terms('business', %L, 'intervaled_monthly', 5)$q$, pg_temp.id('H')),
        NULL, NULL);
    IF (SELECT invoicing_mode FROM org.business_profiles WHERE id = pg_temp.id('H')) <> 'intervaled_monthly' THEN
        RAISE EXCEPTION 'FAIL 3 monthly terms were not written';
    END IF;
END $$;
-- #endregion

ROLLBACK;
