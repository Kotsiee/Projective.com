-- =============================================================================================
-- Probe: the first paid claim records the maker's acceptance of the IP Transfer Deed, and the first
-- funding records the payer's acceptance of the Escrow Terms, once per version (LG3).
--
--   * a claim that holds an escrow on a non-personal project, and a funding through any client door
--     (fund_stage, fund_ticket, a card `escrow_lock`; fund_paid_revision and fund_with_conversion by
--     their definitions), is refused PN409 `legal_acceptance_required` with DETAIL {document, version}
--     once its own gates pass, while the caller has not accepted the version in effect, and commits
--     nothing;
--   * the same commit carrying that version records exactly one row (`accepted`, surface `claim` or
--     `fund`) and goes ahead; the next commit at that version asks nothing and records nothing; a new
--     version asks again;
--   * a stale, unpublished or other document's version is refused the same way;
--   * a 13–17 account and a signed-out caller (a definer or cron path) record nothing and pass;
--   * the guard and the internal funding doors are not a client's to call; the sign-up documents'
--     re-accept gate ignores the commit documents.
--
-- The probe publishes a 9.0 of both documents, effective today, so nobody has accepted the version in
-- effect whatever the seed or an earlier session recorded.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/legal_commit_acceptance.sql
--
-- Before LG3 the fixture's 9.0 rows broke legal_document_versions_slug_check and every commit door
-- took money and work with no acceptance at all. A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

-- What a statement raised: `ok`, or its SQLSTATE and DETAIL. A refused statement rolls back alone.
CREATE FUNCTION pg_temp.try(p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_detail text;
BEGIN
    EXECUTE p_sql;
    RETURN jsonb_build_object('state', 'ok');
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    RETURN jsonb_build_object('state', SQLSTATE, 'message', SQLERRM, 'detail', NULLIF(v_detail, ''));
END $$;

-- Whether a refusal is the guard asking for p_slug at p_version.
CREATE FUNCTION pg_temp.asks(p_out jsonb, p_slug text, p_version text) RETURNS boolean LANGUAGE sql AS $$
    SELECT p_out ->> 'state' = 'PN409'
       AND p_out ->> 'message' LIKE 'legal_acceptance_required:%'
       AND (p_out ->> 'detail')::jsonb = jsonb_build_object('document', p_slug, 'version', p_version);
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims',
        CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$$;

-- p_user's rows at the versions this probe publishes, in a stable order: `slug version kind surface`.
CREATE FUNCTION pg_temp.rows(p_user uuid) RETURNS text LANGUAGE sql AS $$
    SELECT coalesce(string_agg(concat_ws(' ', a.document_slug, a.version, a.kind, a.surface), ', '
                               ORDER BY a.document_slug, a.version), '')
      FROM org.legal_acceptances a
     WHERE a.user_id = p_user AND a.document_slug IN ('ip-transfer-deed', 'escrow-terms')
       AND a.version LIKE '9.%';
$$;

-- Whether a door's definition asks for the Escrow Terms (for the doors whose gates need a whole
-- revision or conversion fixture to reach).
CREATE FUNCTION pg_temp.asks_in_body(p_fn regprocedure) RETURNS boolean LANGUAGE sql AS $$
    SELECT pg_get_functiondef(p_fn) LIKE '%PERFORM org.fn_require_legal_acceptance(''escrow-terms'', p_legal)%';
$$;

DO $$
DECLARE
    v_project uuid;
    v_owner uuid;
    v_biz uuid;
    v_currency text;
    v_fl uuid;
    v_minor uuid;
    v_stage uuid;
    v_s2 uuid;
    v_t1 uuid;
    v_t2 uuid;
    v_t3 uuid;
    v_s3 uuid;
    v_t4 uuid;
    v_out jsonb;
    r record;
BEGIN
    -- #region Fixture (as postgres)
    INSERT INTO org.legal_document_versions (slug, version, effective_date, material) VALUES
        ('ip-transfer-deed', '9.0', CURRENT_DATE, false),
        ('escrow-terms', '9.0', CURRENT_DATE, false);

    FOR r IN
        SELECT p.id, p.owner_user_id, p.client_business_id, upper(COALESCE(p.currency, 'USD')) AS currency
          FROM projects.projects p
         WHERE p.client_business_id IS NOT NULL AND p.format = 'pipeline' AND p.structure_variation = 'standard'
         ORDER BY p.id
    LOOP
        PERFORM pg_temp.act(r.owner_user_id);
        IF finance.fn_owner_capability('business', r.client_business_id, 'spend'::finance.vault_capability) THEN
            v_project := r.id; v_owner := r.owner_user_id; v_biz := r.client_business_id; v_currency := r.currency;
            EXIT;
        END IF;
    END LOOP;
    PERFORM pg_temp.act(NULL);
    IF v_project IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no business pipeline project whose owner can spend'; END IF;
    SELECT fp.user_id INTO v_fl FROM org.freelancer_profiles fp
     WHERE fp.user_id <> v_owner AND finance.fn_freelancer_payout_ready(fp.user_id) AND NOT org.fn_is_minor(fp.user_id)
     ORDER BY fp.user_id LIMIT 1;
    IF v_fl IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no payout-ready freelancer'; END IF;

    UPDATE org.business_profiles SET kyb_status = 'verified' WHERE id = v_biz;
    PERFORM finance.fn_ensure_wallet('business', v_biz, v_currency);
    PERFORM finance.fn_wallet_credit(v_biz, 'business', v_currency, 1000000, 'topup', 'inbound_payments', gen_random_uuid());

    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'LG3 stage', 990, 'assigned', 20000) RETURNING id INTO v_stage;
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'LG3 second stage', 991, 'open', 20000) RETURNING id INTO v_s2;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description)
    VALUES (v_project, v_stage, 'LG3 T1', '{"t":"x"}', 'A description.') RETURNING id INTO v_t1;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description)
    VALUES (v_project, v_stage, 'LG3 T2', '{"t":"x"}', 'A description.') RETURNING id INTO v_t2;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description)
    VALUES (v_project, v_s2, 'LG3 T3', '{"t":"x"}', 'A description.') RETURNING id INTO v_t3;
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'LG3 card stage', 992, 'open', 20000) RETURNING id INTO v_s3;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description)
    VALUES (v_project, v_s3, 'LG3 T5', '{"t":"x"}', 'A description.');
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, is_client_managed, status)
    VALUES (v_stage, 'freelancer', v_fl, v_owner, false, 'assigned');

    -- A 15-year-old, signed up as AuthBackendService provisions one.
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'lg3-minor@projective.invalid', 'authenticated', 'authenticated',
            jsonb_build_object('first_name', 'Lex', 'last_name', 'Probe', 'username', 'lg3-minor',
                'dob', (CURRENT_DATE - make_interval(years => 15))::date, 'timezone', 'UTC', 'objective', 'client',
                'legal_acceptance', jsonb_build_object(
                    'terms', org.fn_current_legal_version('terms'),
                    'acceptable-use', org.fn_current_legal_version('acceptable-use'),
                    'privacy', org.fn_current_legal_version('privacy'))))
    RETURNING id INTO v_minor;
    -- #endregion

    -- #region 1. Funding asks for the Escrow Terms, records them once, then asks nothing
    PERFORM pg_temp.act(v_owner);
    v_out := pg_temp.try(format('SELECT projects.fund_stage(%L, %L, NULL)', v_project, v_stage));
    IF NOT pg_temp.asks(v_out, 'escrow-terms', '9.0') OR pg_temp.rows(v_owner) <> ''
       OR EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id IN (v_t1, v_t2)) THEN
        RAISE EXCEPTION 'FAIL 1a: a first funding without the Escrow Terms must be refused and hold nothing, got % / %', v_out, pg_temp.rows(v_owner);
    END IF;
    RAISE NOTICE 'PASS 1a a first funding without the Escrow Terms is refused PN409 {escrow-terms, 9.0}, nothing held';

    FOREACH v_out IN ARRAY ARRAY[
        pg_temp.try(format('SELECT projects.fund_stage(%L, %L, %L)', v_project, v_stage, '{"escrow-terms": "1.0"}')),
        pg_temp.try(format('SELECT projects.fund_stage(%L, %L, %L)', v_project, v_stage, '{"escrow-terms": "9.9"}')),
        pg_temp.try(format('SELECT projects.fund_stage(%L, %L, %L)', v_project, v_stage, '{"ip-transfer-deed": "9.0"}')),
        pg_temp.try(format('SELECT projects.fund_stage(%L, %L, %L)', v_project, v_stage, '"9.0"'))
    ] LOOP
        IF NOT pg_temp.asks(v_out, 'escrow-terms', '9.0') THEN
            RAISE EXCEPTION 'FAIL 1b: a stale, unpublished or wrong-document version must be refused, got %', v_out;
        END IF;
    END LOOP;
    IF pg_temp.rows(v_owner) <> '' THEN RAISE EXCEPTION 'FAIL 1b: a refused version recorded %', pg_temp.rows(v_owner); END IF;
    RAISE NOTICE 'PASS 1b a stale (1.0), unpublished (9.9), other-document or non-object stamp is refused, nothing recorded';

    v_out := projects.fund_stage(v_project, v_stage, '{"escrow-terms": "9.0"}');
    IF (v_out ->> 'funded_count')::int <> 2 OR pg_temp.rows(v_owner) <> 'escrow-terms 9.0 accepted fund' THEN
        RAISE EXCEPTION 'FAIL 1c: funding with the version in effect must fund and record one row, got % / %', v_out, pg_temp.rows(v_owner);
    END IF;
    RAISE NOTICE 'PASS 1c funding carrying 9.0 funds the stage and records escrow-terms 9.0 accepted fund';

    v_out := projects.fund_stage(v_project, v_s2, NULL);
    IF (v_out ->> 'funded_count')::int <> 1 OR pg_temp.rows(v_owner) <> 'escrow-terms 9.0 accepted fund' THEN
        RAISE EXCEPTION 'FAIL 1d: a second funding at the same version must ask nothing and record nothing, got % / %', v_out, pg_temp.rows(v_owner);
    END IF;
    RAISE NOTICE 'PASS 1d a second funding at 9.0 asks nothing and records nothing';
    -- #endregion

    -- #region 2. A new version asks again, at every client funding door
    INSERT INTO org.legal_document_versions (slug, version, effective_date, material)
    VALUES ('escrow-terms', '9.1', CURRENT_DATE, false);
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description)
    VALUES (v_project, v_s2, 'LG3 T4', '{"t":"x"}', 'A description.') RETURNING id INTO v_t4;
    v_out := pg_temp.try(format('SELECT projects.fund_ticket(%L, %L, NULL, NULL)', v_project, v_t4));
    IF NOT pg_temp.asks(v_out, 'escrow-terms', '9.1')
       OR EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id = v_t4) THEN
        RAISE EXCEPTION 'FAIL 2a: fund_ticket must ask for 9.1 and hold nothing, got %', v_out;
    END IF;
    v_out := pg_temp.try(format('SELECT finance.begin_card_payment(%L, NULL, %L, %L, 20000, %L, %L, NULL, NULL, NULL, NULL)',
                                'escrow_lock', v_project, v_s3, v_currency, 'lg3-card-key-1'));
    IF NOT pg_temp.asks(v_out, 'escrow-terms', '9.1')
       OR EXISTS (SELECT 1 FROM finance.inbound_payments p WHERE p.idempotency_key = 'lg3-card-key-1') THEN
        RAISE EXCEPTION 'FAIL 2a: a card escrow_lock must ask for 9.1 and record no attempt, got %', v_out;
    END IF;
    IF NOT pg_temp.asks_in_body('projects.fund_paid_revision(uuid, jsonb)')
       OR NOT pg_temp.asks_in_body('finance.fund_with_conversion(uuid, uuid, uuid, uuid, uuid, jsonb)') THEN
        RAISE EXCEPTION 'FAIL 2a: fund_paid_revision and fund_with_conversion must ask for the Escrow Terms';
    END IF;
    v_out := pg_temp.try(format('SELECT finance.begin_card_payment(%L, NULL, NULL, NULL, 100, %L, %L)',
                                'wallet_topup', v_currency, 'lg3-topup-key'));
    IF v_out ->> 'state' = 'PN409' THEN
        RAISE EXCEPTION 'FAIL 2b: a wallet top-up is not a funding and must not ask, got %', v_out;
    END IF;
    RAISE NOTICE 'PASS 2a at 9.1 fund_ticket and a card escrow_lock ask again and commit nothing; fund_paid_revision and fund_with_conversion ask';

    v_out := projects.fund_ticket(v_project, v_t4, NULL, '{"escrow-terms": "9.1"}');
    IF v_out ->> 'escrow_id' IS NULL
       OR pg_temp.rows(v_owner) <> 'escrow-terms 9.0 accepted fund, escrow-terms 9.1 accepted fund' THEN
        RAISE EXCEPTION 'FAIL 2b: fund_ticket carrying 9.1 must fund and record one more row, got % / %', v_out, pg_temp.rows(v_owner);
    END IF;
    RAISE NOTICE 'PASS 2b fund_ticket carrying 9.1 funds the ticket and records escrow-terms 9.1; a top-up never asks';
    -- #endregion

    -- #region 3. A paid claim asks for the IP Transfer Deed, records it once, then asks nothing
    PERFORM pg_temp.act(v_fl);
    v_out := pg_temp.try(format('SELECT projects.claim_ticket(%L, %L)', v_t1, v_fl));
    IF NOT pg_temp.asks(v_out, 'ip-transfer-deed', '9.0') OR pg_temp.rows(v_fl) <> ''
       OR (SELECT current_assignee_id FROM projects.tickets WHERE id = v_t1) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL 3a: a first paid claim without the deed must be refused and claim nothing, got % / %', v_out, pg_temp.rows(v_fl);
    END IF;
    RAISE NOTICE 'PASS 3a a first paid claim without the deed is refused PN409 {ip-transfer-deed, 9.0}, ticket unclaimed';

    v_out := pg_temp.try(format('SELECT projects.claim_ticket(%L, %L, %L)', v_t1, v_fl, '{"ip-transfer-deed": "1.0"}'));
    IF NOT pg_temp.asks(v_out, 'ip-transfer-deed', '9.0') OR pg_temp.rows(v_fl) <> '' THEN
        RAISE EXCEPTION 'FAIL 3b: a stale deed version must be refused, got %', v_out;
    END IF;
    RAISE NOTICE 'PASS 3b a stale deed version is refused, nothing recorded';

    IF projects.claim_ticket(v_t1, v_fl, '{"ip-transfer-deed": "9.0"}') IS NULL
       OR pg_temp.rows(v_fl) <> 'ip-transfer-deed 9.0 accepted claim' THEN
        RAISE EXCEPTION 'FAIL 3c: a claim carrying 9.0 must claim and record one row, got %', pg_temp.rows(v_fl);
    END IF;
    RAISE NOTICE 'PASS 3c a claim carrying 9.0 claims the ticket and records ip-transfer-deed 9.0 accepted claim';

    IF projects.claim_ticket(v_t2, v_fl) IS NULL OR pg_temp.rows(v_fl) <> 'ip-transfer-deed 9.0 accepted claim' THEN
        RAISE EXCEPTION 'FAIL 3d: a second claim at the same version must ask nothing and record nothing, got %', pg_temp.rows(v_fl);
    END IF;
    RAISE NOTICE 'PASS 3d a second claim at 9.0 asks nothing and records nothing';
    -- #endregion

    -- #region 4. A restricted account and a signed-out caller record nothing and pass
    PERFORM pg_temp.act(v_minor);
    PERFORM org.fn_require_legal_acceptance('escrow-terms', NULL);
    PERFORM org.fn_require_legal_acceptance('ip-transfer-deed', '{"ip-transfer-deed": "9.0"}');
    IF pg_temp.rows(v_minor) <> '' THEN RAISE EXCEPTION 'FAIL 4: a 13–17 account recorded %', pg_temp.rows(v_minor); END IF;
    PERFORM pg_temp.act(NULL);
    PERFORM org.fn_require_legal_acceptance('escrow-terms', NULL);
    v_out := pg_temp.try('SELECT org.fn_require_legal_acceptance(''terms'', NULL)');
    IF v_out ->> 'state' <> '22023' THEN
        RAISE EXCEPTION 'FAIL 4: a sign-up document is not a commit document, got %', v_out;
    END IF;
    RAISE NOTICE 'PASS 4 a 15-year-old and a signed-out caller pass with nothing recorded; a sign-up slug is refused 22023';
    -- #endregion

    -- #region 5. Who may call what; the re-accept gate ignores the commit documents
    IF has_function_privilege('authenticated', 'org.fn_require_legal_acceptance(text, jsonb)', 'EXECUTE')
       OR has_function_privilege('anon', 'org.fn_require_legal_acceptance(text, jsonb)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'projects.fund_stage(uuid, uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'projects.fund_ticket(uuid, uuid, uuid[])', 'EXECUTE')
       OR has_function_privilege('authenticated', 'projects.fund_paid_revision(uuid)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'projects.fund_stage(uuid, uuid, jsonb)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'projects.fund_ticket(uuid, uuid, uuid[], jsonb)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'projects.fund_paid_revision(uuid, jsonb)', 'EXECUTE')
       OR has_function_privilege('anon', 'projects.fund_stage(uuid, uuid, jsonb)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 5: only the asking doors are a client''s to call';
    END IF;
    IF org.fn_needs_reacceptance(v_fl) OR org.fn_needs_reacceptance(v_owner) THEN
        RAISE EXCEPTION 'FAIL 5: an unaccepted commit document must not make anyone due at sign-in';
    END IF;
    RAISE NOTICE 'PASS 5 the guard and the internal doors are not executable by a client; the asking doors are; nobody is termsDue';
    -- #endregion
END $$;

ROLLBACK;
