-- =============================================================================================
-- Probe: the Stripe Identity (Level-2 KYC) and Connect payout-account doors — Decisions #125 / #126.
--
--   * Only the processor doors (service role) can move a verification case, a payout account or the
--     profile's earning-gate cache (`kyc_status`, `kyc_verified_at`, `payout_ready`); a signed-in
--     user can neither call them nor write those rows directly.
--   * finance.apply_identity_event claims `stripe:<evt_id>` in finance.idempotency_keys, replays a
--     redelivery, denormalises the decision onto org.freelancer_profiles and never regresses a
--     verified case.
--   * finance.sync_payout_account keeps `payout_ready` — and so finance.fn_freelancer_payout_ready —
--     in step with the account status Stripe reports, idempotently by value.
--   * Zero-PII: no finance / profile column is shaped like an identity document or bank number.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/identity_payout_doors.sql
--
-- Fixture (seeded data, adjusted inside the transaction): two adult freelancers F and G, F reset to
-- unverified with no active payout account and no checks today. A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

-- #region Helpers
-- Act as p_user under p_role (`authenticated` / `service_role`), for the rest of the transaction.
CREATE FUNCTION pg_temp.act(p_role text, p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', p_user, 'role', p_role)::text, true);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;

-- Run p_sql as p_role / p_user; it must be refused with SQLSTATE p_state. The role switch happens
-- inside the sub-block, so it is undone with it.
CREATE FUNCTION pg_temp.expect_refusal(p_label text, p_role text, p_user uuid, p_sql text, p_state text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    BEGIN
        PERFORM pg_temp.act(p_role, p_user);
        EXECUTE p_sql;
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'accepted';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_state = 'PX000' THEN
        RAISE EXCEPTION 'FAIL % — accepted; expected %', p_label, p_state;
    END IF;
    IF v_state <> p_state THEN
        RAISE EXCEPTION 'FAIL % — refused % "%" (expected %)', p_label, v_state, v_msg, p_state;
    END IF;
    RAISE NOTICE 'PASS % (%)', p_label, v_state;
END $$;

-- Apply one identity event as the service role and return the door's outcome object.
CREATE FUNCTION pg_temp.identity(p_event text, p_type text, p_session text, p_code text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_out jsonb;
BEGIN
    PERFORM pg_temp.act('service_role', NULL);
    v_out := finance.apply_identity_event(p_event, p_type, p_session, p_code, false);
    RESET ROLE;
    RETURN v_out;
END $$;

-- Apply one payout account status as the service role and return the door's answer.
CREATE FUNCTION pg_temp.sync(p_account text, p_status text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_out jsonb;
BEGIN
    PERFORM pg_temp.act('service_role', NULL);
    v_out := finance.sync_payout_account(p_account, p_status);
    RESET ROLE;
    RETURN v_out;
END $$;

CREATE FUNCTION pg_temp.f() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('probe.f')::uuid $$;
CREATE FUNCTION pg_temp.g() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('probe.g')::uuid $$;
CREATE FUNCTION pg_temp.case1() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('probe.case1')::uuid $$;
-- #endregion

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_ids uuid[];
BEGIN
    SELECT pg_catalog.array_agg(fp.user_id ORDER BY fp.user_id) INTO v_ids
      FROM org.freelancer_profiles fp
     WHERE NOT org.fn_is_minor(fp.user_id);
    IF pg_catalog.cardinality(v_ids) < 2 THEN
        RAISE EXCEPTION 'FAIL fixtures: need two adult freelancers (run deno task db:reset)';
    END IF;
    PERFORM set_config('probe.f', v_ids[1]::text, true);
    PERFORM set_config('probe.g', v_ids[2]::text, true);

    UPDATE org.freelancer_profiles
       SET kyc_status = 'unverified', kyc_tier = NULL, kyc_verified_at = NULL,
           payout_ready = false, identity_provider_ref = NULL
     WHERE user_id = v_ids[1];
    UPDATE finance.payout_accounts SET status = 'disabled'
     WHERE owner_type IN ('freelancer', 'user') AND owner_id = v_ids[1];
    UPDATE finance.verification_cases SET created_at = now() - interval '2 days'
     WHERE subject_id = v_ids[1];

    IF finance.fn_freelancer_payout_ready(v_ids[1]) THEN
        RAISE EXCEPTION 'FAIL fixtures: F is still payout-ready after the reset';
    END IF;
    RAISE NOTICE 'fixture f=% g=%', v_ids[1], v_ids[2];
END $$;
-- #endregion

-- #region 1. Zero-PII — no column shaped like an identity document or a bank number
DO $$
DECLARE
    v_cols text;
BEGIN
    SELECT pg_catalog.string_agg(table_schema || '.' || table_name || '.' || column_name, ', ')
      INTO v_cols
      FROM information_schema.columns
     WHERE (table_schema = 'finance'
            OR (table_schema = 'org' AND table_name IN ('freelancer_profiles', 'business_profiles')))
       AND column_name ~* '(ssn|social_sec|passport|birth|dob|iban|routing|sort_code|account_number|document_number|id_number|national_id|selfie|driving_lic)';
    IF v_cols IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL zero-PII: identity/bank-shaped columns exist: %', v_cols;
    END IF;
    RAISE NOTICE 'PASS no identity-document or bank-number columns in finance / profiles';
END $$;
-- #endregion

-- #region 2. Nothing but the processor doors can write the verdicts
SELECT pg_temp.expect_refusal('authenticated cannot call apply_identity_event', 'authenticated', pg_temp.f(),
    $q$SELECT finance.apply_identity_event('evt_probe_forged', 'identity.verification_session.verified', 'vs_probe_forged', NULL, false)$q$,
    '42501');
SELECT pg_temp.expect_refusal('authenticated cannot call sync_payout_account', 'authenticated', pg_temp.f(),
    $q$SELECT finance.sync_payout_account('acct_probeforged', 'verified')$q$, '42501');
SELECT pg_temp.expect_refusal('authenticated cannot claim a Stripe event', 'authenticated', pg_temp.f(),
    $q$SELECT finance.fn_claim_stripe_event('evt_probe_forged', 'x')$q$, '42501');
SELECT pg_temp.expect_refusal('authenticated cannot read the payout-ready oracle directly', 'authenticated', pg_temp.f(),
    $q$SELECT finance.fn_freelancer_payout_ready(auth.uid())$q$, '42501');
SELECT pg_temp.expect_refusal('authenticated cannot insert a verification case', 'authenticated', pg_temp.f(),
    $q$INSERT INTO finance.verification_cases (subject_type, subject_id, kind, status, tier, provider)
       VALUES ('freelancer', auth.uid(), 'kyc', 'verified', 2, 'stripe_identity')$q$, '42501');
SELECT pg_temp.expect_refusal('authenticated cannot update a payout account', 'authenticated', pg_temp.f(),
    $q$UPDATE finance.payout_accounts SET status = 'verified' WHERE owner_id = auth.uid()$q$, '42501');
SELECT pg_temp.expect_refusal('anon cannot call apply_identity_event', 'anon', NULL,
    $q$SELECT finance.apply_identity_event('evt_probe_forged', 'identity.verification_session.verified', 'vs_probe_forged', NULL, false)$q$,
    '42501');

-- The profile row is the user's to read, never to write: RLS has no UPDATE policy, so a direct
-- self-verification touches nothing.
DO $$
DECLARE
    v_rows integer;
BEGIN
    PERFORM pg_temp.act('authenticated', pg_temp.f());
    UPDATE org.freelancer_profiles
       SET kyc_status = 'verified', kyc_verified_at = now(), payout_ready = true
     WHERE user_id = pg_temp.f();
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'FAIL a freelancer self-verified through a direct UPDATE (% rows)', v_rows;
    END IF;
    IF finance.fn_freelancer_payout_ready(pg_temp.f()) THEN
        RAISE EXCEPTION 'FAIL the earning gate opened after a direct UPDATE';
    END IF;
    RAISE NOTICE 'PASS a direct UPDATE of the KYC / payout cache touches 0 rows (RLS)';
END $$;
-- #endregion

-- #region 3. Identity — the user doors
DO $$
DECLARE
    v_case jsonb;
BEGIN
    PERFORM pg_temp.act('authenticated', pg_temp.f());
    v_case := finance.begin_identity_verification();
    v_case := finance.attach_identity_session((v_case ->> 'id')::uuid, 'vs_probe_one');
    RESET ROLE;
    PERFORM set_config('probe.case1', v_case ->> 'id', true);

    IF v_case ->> 'status' <> 'pending' OR v_case ->> 'provider_ref' <> 'vs_probe_one'
       OR (v_case ->> 'subject_id')::uuid <> pg_temp.f() THEN
        RAISE EXCEPTION 'FAIL the opened case is %', v_case;
    END IF;
    IF (SELECT kyc_status FROM org.freelancer_profiles WHERE user_id = pg_temp.f()) <> 'unverified' THEN
        RAISE EXCEPTION 'FAIL opening a session moved the profile''s kyc_status';
    END IF;
    RAISE NOTICE 'PASS begin + attach open a pending case bound to the session; the profile is untouched';
END $$;

SELECT pg_temp.expect_refusal('the case cannot be re-bound to another session', 'authenticated', pg_temp.f(),
    format($q$SELECT finance.attach_identity_session(%L, 'vs_probe_other')$q$, pg_temp.case1()), 'PX409');
SELECT pg_temp.expect_refusal('another user cannot bind the case', 'authenticated', pg_temp.g(),
    format($q$SELECT finance.attach_identity_session(%L, 'vs_probe_one')$q$, pg_temp.case1()), 'P0002');
-- #endregion

-- #region 4. Identity — the processor door (webhook)
DO $$
DECLARE
    v_out jsonb;
    v_case finance.verification_cases;
    v_fp org.freelancer_profiles;
    v_claim finance.idempotency_keys;
BEGIN
    -- requires_input → rejected, with the error CODE only.
    v_out := pg_temp.identity('evt_probe_ident_ri', 'identity.verification_session.requires_input',
        'vs_probe_one', 'document_unverified_other');
    SELECT * INTO v_case FROM finance.verification_cases WHERE id = pg_temp.case1();
    SELECT * INTO v_fp FROM org.freelancer_profiles WHERE user_id = pg_temp.f();
    IF v_out ->> 'outcome' <> 'applied' OR v_case.status <> 'rejected'
       OR v_case.notes NOT LIKE '%document_unverified_other%' OR v_fp.kyc_status <> 'rejected' THEN
        RAISE EXCEPTION 'FAIL requires_input: % / case % / profile %', v_out, v_case.status, v_fp.kyc_status;
    END IF;
    SELECT * INTO v_claim FROM finance.idempotency_keys WHERE key = 'stripe:evt_probe_ident_ri';
    IF NOT FOUND OR v_claim.status <> 'succeeded' OR v_claim.scope <> 'stripe.webhook'
       OR v_claim.response ->> 'outcome' <> 'applied' THEN
        RAISE EXCEPTION 'FAIL requires_input left no completed claim on stripe:evt_probe_ident_ri';
    END IF;
    RAISE NOTICE 'PASS requires_input rejects the case and the profile, claimed as stripe:<evt_id>';

    -- The same event again is a replay of the stored outcome, not a second application.
    v_out := pg_temp.identity('evt_probe_ident_ri', 'identity.verification_session.requires_input',
        'vs_probe_one', 'document_unverified_other');
    IF v_out ->> 'outcome' <> 'replayed' OR v_out #>> '{first,outcome}' <> 'applied' THEN
        RAISE EXCEPTION 'FAIL a redelivered event answered %', v_out;
    END IF;
    RAISE NOTICE 'PASS a redelivered event replays its first outcome';

    -- verified → the case, and the profile's KYC cache at tier 2.
    v_out := pg_temp.identity('evt_probe_ident_ok', 'identity.verification_session.verified',
        'vs_probe_one', NULL);
    SELECT * INTO v_case FROM finance.verification_cases WHERE id = pg_temp.case1();
    SELECT * INTO v_fp FROM org.freelancer_profiles WHERE user_id = pg_temp.f();
    IF v_out ->> 'outcome' <> 'applied' OR v_case.status <> 'verified' OR v_case.tier <> 2
       OR v_case.notes IS NOT NULL OR v_fp.kyc_status <> 'verified' OR v_fp.kyc_tier < 2
       OR v_fp.kyc_verified_at IS NULL OR v_fp.identity_provider_ref <> 'vs_probe_one' THEN
        RAISE EXCEPTION 'FAIL verified: % / case % / profile % %', v_out, v_case.status, v_fp.kyc_status, v_fp.kyc_verified_at;
    END IF;
    IF finance.fn_freelancer_payout_ready(pg_temp.f()) THEN
        RAISE EXCEPTION 'FAIL KYC alone opened the earning gate (no payout account yet)';
    END IF;
    RAISE NOTICE 'PASS verified sets the case and kyc_status / kyc_tier / kyc_verified_at; the gate stays shut without payouts';

    -- A late or reordered decision never regresses a verified case.
    v_out := pg_temp.identity('evt_probe_ident_late', 'identity.verification_session.requires_input',
        'vs_probe_one', 'selfie_face_mismatch');
    IF v_out ->> 'outcome' <> 'ignored'
       OR (SELECT kyc_status FROM org.freelancer_profiles WHERE user_id = pg_temp.f()) <> 'verified'
       OR (SELECT status FROM finance.verification_cases WHERE id = pg_temp.case1()) <> 'verified' THEN
        RAISE EXCEPTION 'FAIL a late requires_input regressed a verified case: %', v_out;
    END IF;
    v_out := pg_temp.identity('evt_probe_ident_cxl', 'identity.verification_session.canceled',
        'vs_probe_one', NULL);
    IF v_out ->> 'outcome' <> 'ignored'
       OR (SELECT status FROM finance.verification_cases WHERE id = pg_temp.case1()) <> 'verified' THEN
        RAISE EXCEPTION 'FAIL a late canceled regressed a verified case: %', v_out;
    END IF;
    RAISE NOTICE 'PASS late requires_input / canceled events leave a verified case verified';

    -- A session no case is bound to is acknowledged as unmatched, and its claim kept.
    v_out := pg_temp.identity('evt_probe_ident_nobody', 'identity.verification_session.verified',
        'vs_probe_nobody', NULL);
    IF v_out ->> 'outcome' <> 'unmatched'
       OR NOT EXISTS (SELECT 1 FROM finance.idempotency_keys
                       WHERE key = 'stripe:evt_probe_ident_nobody' AND status = 'succeeded') THEN
        RAISE EXCEPTION 'FAIL an unbound session answered %', v_out;
    END IF;
    RAISE NOTICE 'PASS an unbound session is unmatched, with its claim completed';
END $$;

-- canceled on an open case expires it and leaves the person's KYC where it was.
DO $$
DECLARE
    v_case uuid;
    v_before finance.kyc_status;
    v_out jsonb;
BEGIN
    SELECT kyc_status INTO v_before FROM org.freelancer_profiles WHERE user_id = pg_temp.g();
    INSERT INTO finance.verification_cases (subject_type, subject_id, kind, status, tier, provider, provider_ref, submitted_at)
    VALUES ('freelancer', pg_temp.g(), 'kyc', 'pending', 2, 'stripe_identity', 'vs_probe_two', now())
    RETURNING id INTO v_case;
    v_out := pg_temp.identity('evt_probe_ident_g_cxl', 'identity.verification_session.canceled',
        'vs_probe_two', NULL);
    IF v_out ->> 'outcome' <> 'applied'
       OR (SELECT status FROM finance.verification_cases WHERE id = v_case) <> 'expired'
       OR (SELECT kyc_status FROM org.freelancer_profiles WHERE user_id = pg_temp.g()) <> v_before THEN
        RAISE EXCEPTION 'FAIL canceled: %', v_out;
    END IF;
    RAISE NOTICE 'PASS canceled expires the case and leaves the profile''s kyc_status (%)', v_before;
END $$;

SELECT pg_temp.expect_refusal('a malformed event id is refused', 'service_role', NULL,
    $q$SELECT finance.apply_identity_event('not_an_event', 'identity.verification_session.verified', 'vs_probe_one', NULL, false)$q$,
    '22023');
SELECT pg_temp.expect_refusal('a non-identity event type is refused', 'service_role', NULL,
    $q$SELECT finance.apply_identity_event('evt_probe_wrongtype', 'account.updated', 'vs_probe_one', NULL, false)$q$,
    '22023');
SELECT pg_temp.expect_refusal('a verified freelancer cannot open another check', 'authenticated', pg_temp.f(),
    $q$SELECT finance.begin_identity_verification()$q$, 'PX409');
-- #endregion

-- #region 5. Connect payout account — the earning gate's second half
DO $$
DECLARE
    v_acct jsonb;
    v_out jsonb;
BEGIN
    PERFORM pg_temp.act('authenticated', pg_temp.f());
    v_acct := finance.record_payout_account('personal', NULL, 'acct_probeF1');
    RESET ROLE;
    IF v_acct ->> 'status' <> 'pending_verification' OR (v_acct ->> 'owner_id')::uuid <> pg_temp.f() THEN
        RAISE EXCEPTION 'FAIL record_payout_account: %', v_acct;
    END IF;
    IF finance.fn_freelancer_payout_ready(pg_temp.f()) THEN
        RAISE EXCEPTION 'FAIL a pending payout account opened the earning gate';
    END IF;
    RAISE NOTICE 'PASS record_payout_account stores only the acct_ reference, pending verification';

    v_out := pg_temp.sync('acct_probeF1', 'verified');
    IF NOT (v_out ->> 'payout_ready')::boolean
       OR NOT (SELECT payout_ready FROM org.freelancer_profiles WHERE user_id = pg_temp.f())
       OR NOT finance.fn_freelancer_payout_ready(pg_temp.f()) THEN
        RAISE EXCEPTION 'FAIL verified account: % — gate %', v_out, finance.fn_freelancer_payout_ready(pg_temp.f());
    END IF;
    RAISE NOTICE 'PASS a verified account sets payout_ready and opens fn_freelancer_payout_ready (KYC + payouts)';

    v_out := pg_temp.sync('acct_probeF1', 'restricted');
    IF (v_out ->> 'payout_ready')::boolean
       OR (SELECT payout_ready FROM org.freelancer_profiles WHERE user_id = pg_temp.f())
       OR finance.fn_freelancer_payout_ready(pg_temp.f()) THEN
        RAISE EXCEPTION 'FAIL a restricted account kept the gate open: %', v_out;
    END IF;
    RAISE NOTICE 'PASS a restricted account clears payout_ready and shuts the gate';

    PERFORM pg_temp.sync('acct_probeF1', 'verified');
    v_out := pg_temp.sync('acct_probeF1', 'verified');
    IF NOT (v_out ->> 'payout_ready')::boolean OR NOT finance.fn_freelancer_payout_ready(pg_temp.f())
       OR (SELECT count(*) FROM finance.payout_accounts WHERE account_id = 'acct_probeF1') <> 1 THEN
        RAISE EXCEPTION 'FAIL re-applying the same status is not idempotent: %', v_out;
    END IF;
    RAISE NOTICE 'PASS re-applying a status is idempotent by value';
END $$;

SELECT pg_temp.expect_refusal('sync of an unrecorded account is P0002 (webhook: unmatched)', 'service_role', NULL,
    $q$SELECT finance.sync_payout_account('acct_probenobody', 'verified')$q$, 'P0002');
SELECT pg_temp.expect_refusal('sync of an unknown status is refused', 'service_role', NULL,
    $q$SELECT finance.sync_payout_account('acct_probeF1', 'active')$q$, '22023');
SELECT pg_temp.expect_refusal('another user cannot claim the connected account', 'authenticated', pg_temp.g(),
    $q$SELECT finance.record_payout_account('personal', NULL, 'acct_probeF1')$q$, 'PX409');
-- #endregion

ROLLBACK;
