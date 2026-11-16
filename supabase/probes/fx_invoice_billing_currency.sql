-- =============================================================================================
-- Probe: a business's consolidated invoice states FX-funded escrow in the currency it paid in
-- (Decision #435) — finance.fn_generate_consolidated_invoice. An escrow a conversion funded from the
-- business's GBP wallet, released in the period, is invoiced on the GBP invoice at what it cost there
-- (its `fx_source_minor`), with its own EUR amount, the rate and its date on the line; its platform fee is
-- stated the same way, truncated. No EUR invoice is issued for it.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/fx_invoice_billing_currency.sql
--
-- Fixture: a seeded KYB-verified business with a GBP wallet funded inside the transaction, a conversion
-- executed from a quote written as postgres, and one escrow released in an otherwise empty period
-- (January 2030). A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

DO $$
DECLARE
    v_biz uuid;
    v_stage uuid;
    v_freelancer uuid;
    v_gbp uuid;
    v_quote uuid;
    v_conv finance.fx_conversions;
    v_escrow uuid;
    v_ids uuid[];
    v_inv finance.invoices;
    v_n integer;
    v_fail text[] := '{}';
BEGIN
    -- #region Fixture (as postgres)
    SELECT b.id INTO v_biz FROM org.business_profiles b WHERE b.kyb_status = 'verified' ORDER BY b.id LIMIT 1;
    SELECT ps.id INTO v_stage FROM projects.project_stages ps ORDER BY ps.id LIMIT 1;
    SELECT fp.user_id INTO v_freelancer FROM org.freelancer_profiles fp ORDER BY fp.user_id LIMIT 1;
    IF v_biz IS NULL OR v_stage IS NULL OR v_freelancer IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: a verified business, a stage and a freelancer are needed';
    END IF;
    v_gbp := finance.fn_ensure_wallet('business', v_biz, 'GBP');
    PERFORM finance.fn_wallet_credit(v_biz, 'business', 'GBP', 50000, 'topup', 'probe', NULL);
    INSERT INTO finance.fx_quotes (owner_type, owner_id, purpose, ref_table, ref_id, from_currency, to_currency, to_minor,
        principal_minor, spread_bp, spread_minor, from_minor, from_rate, to_rate, mid_rate, rate_as_of, rate_provider,
        created_by, expires_at)
    SELECT 'business', v_biz, 'funding', 'project_stages', v_stage, 'GBP', 'EUR', 9000, 7692, 150, 115, 7807,
           1, 1.17, 1.17, pg_catalog.now(), 'probe', u.id, pg_catalog.now() + interval '30 minutes'
      FROM auth.users u ORDER BY u.id LIMIT 1
    RETURNING id INTO v_quote;
    v_conv := finance.fn_execute_fx_quote(v_quote, v_gbp, 'project_stages', v_stage, false);
    PERFORM finance.fn_wallet_debit(v_biz, 'business', 'EUR', 9000, 'escrow_hold', 'probe', NULL);
    INSERT INTO finance.escrows (project_stage_id, payer_business_id, payee_type, payee_id, amount_cents,
        platform_fee_cents, currency, status, released_at)
    VALUES (v_stage, v_biz, 'freelancer', v_freelancer, 9000, 450, 'EUR', 'released', TIMESTAMPTZ '2030-01-15 12:00:00+00')
    RETURNING id INTO v_escrow;
    PERFORM finance.fn_stamp_escrow_fx(v_conv.id, ARRAY[v_escrow]);
    -- #endregion

    v_ids := finance.fn_generate_consolidated_invoice(v_biz, TIMESTAMPTZ '2030-01-01 00:00:00+00', TIMESTAMPTZ '2030-02-01 00:00:00+00');
    SELECT * INTO v_inv FROM finance.invoices WHERE id = ANY (v_ids) AND currency = 'GBP';
    IF v_inv.id IS NULL OR v_inv.subtotal_cents <> 7807 OR v_inv.platform_fee_cents <> 390 THEN
        v_fail := v_fail || ('GBP invoice: ' || COALESCE(pg_catalog.to_jsonb(v_inv)::text, 'none'));
    END IF;
    IF EXISTS (SELECT 1 FROM finance.invoices WHERE id = ANY (v_ids) AND currency = 'EUR') THEN
        v_fail := v_fail || 'an EUR invoice was issued for escrow paid in GBP'::text;
    END IF;
    SELECT pg_catalog.count(*) INTO v_n FROM finance.invoice_line_items li
     WHERE li.invoice_id = v_inv.id AND li.ref_id = v_escrow AND li.currency = 'GBP' AND li.origin_currency = 'EUR'
       AND li.fx_rate = 1.17 AND li.fx_as_of IS NOT NULL
       AND ((li.ref_type = 'escrow' AND li.amount_cents = 7807 AND li.origin_minor = 9000)
         OR (li.ref_type = 'platform_fee' AND li.amount_cents = 390 AND li.origin_minor = 450));
    IF v_n <> 2 THEN v_fail := v_fail || ('lines: ' || v_n); END IF;

    IF pg_catalog.cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'PROBE FAIL: %', pg_catalog.array_to_string(v_fail, ' | ');
    END IF;
    RAISE NOTICE 'PASS converted escrow invoiced in the currency the business paid in, with its origin on the line';
END $$;

ROLLBACK;
