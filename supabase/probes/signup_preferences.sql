-- =============================================================================================
-- Probe: sign-up preference seeding (Decision #207) — org.seed_user_preferences and
-- comms.seed_notification_prefs read the browser's locale, zone and display-currency hint from the
-- sign-up metadata on both provisioning paths (the GoTrue on_auth_user_created trigger and
-- public.complete_onboarding), keep only supported values, and fall back to the column defaults; an
-- onboarded enterprise owner keeps the preferences they chose, and a profile-less identity cannot open
-- an enterprise at all (no DoB: org.fn_is_minor fails closed, IW-H2).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/signup_preferences.sql
--
-- Every check is collected, so one run reports every failure at once. A clean run prints only PASS.
-- =============================================================================================

BEGIN;

DO $$
DECLARE
    v_email uuid := gen_random_uuid();
    v_bad uuid := gen_random_uuid();
    v_none uuid := gen_random_uuid();
    v_case uuid := gen_random_uuid();
    v_oauth uuid := gen_random_uuid();
    v_owner uuid := gen_random_uuid();
    v_tag text := substr(md5(random()::text), 1, 8);
    v_adult date := (CURRENT_DATE - interval '30 years')::date;
    v_failures text[] := '{}';
    v_up org.user_preferences%ROWTYPE;
    v_np comms.notification_prefs%ROWTYPE;

    -- One check: record a FAIL instead of aborting, so the run lists every defect.
    v_label text;
    v_ok boolean;
BEGIN
    -- #region Fixture (as postgres): email/password sign-ups through the GoTrue trigger
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data)
    VALUES
        (v_email, 'prefs-probe-' || v_email || '@projective.invalid', 'authenticated', 'authenticated',
            jsonb_build_object('username', 'prefsprobe_a_' || v_tag, 'dob', v_adult, 'first_name', 'Ada',
                'last_name', 'Probe', 'objective', 'client', 'locale', 'en-US', 'display_currency', 'USD',
                'timezone', 'America/New_York')),
        (v_bad, 'prefs-probe-' || v_bad || '@projective.invalid', 'authenticated', 'authenticated',
            jsonb_build_object('username', 'prefsprobe_b_' || v_tag, 'dob', v_adult, 'first_name', 'Bea',
                'last_name', 'Probe', 'objective', 'client', 'locale', 'xx-YY', 'display_currency', 'XYZ',
                'timezone', 'Mars/Olympus_Mons')),
        (v_none, 'prefs-probe-' || v_none || '@projective.invalid', 'authenticated', 'authenticated',
            jsonb_build_object('username', 'prefsprobe_c_' || v_tag, 'dob', v_adult, 'first_name', 'Cy',
                'last_name', 'Probe', 'objective', 'client')),
        (v_case, 'prefs-probe-' || v_case || '@projective.invalid', 'authenticated', 'authenticated',
            jsonb_build_object('username', 'prefsprobe_d_' || v_tag, 'dob', v_adult, 'first_name', 'Di',
                'last_name', 'Probe', 'objective', 'freelancer', 'locale', ' fr_fr ', 'display_currency', 'eur'));
    -- #endregion

    -- #region Supported hints are kept
    SELECT * INTO v_up FROM org.user_preferences WHERE user_id = v_email;
    SELECT * INTO v_np FROM comms.notification_prefs WHERE user_id = v_email;
    v_label := 'email path keeps a supported locale (en-US)';
    v_ok := v_up.locale IS NOT DISTINCT FROM 'en-US';
    IF v_ok THEN RAISE NOTICE 'PASS %', v_label; ELSE v_failures := v_failures || format('%s — got %s', v_label, v_up.locale); END IF;
    v_label := 'email path keeps a supported display currency (USD)';
    v_ok := v_up.preferred_display_currency IS NOT DISTINCT FROM 'USD';
    IF v_ok THEN RAISE NOTICE 'PASS %', v_label; ELSE v_failures := v_failures || format('%s — got %s', v_label, v_up.preferred_display_currency); END IF;
    v_label := 'email path seeds the notification zone (America/New_York)';
    v_ok := v_np.timezone IS NOT DISTINCT FROM 'America/New_York';
    IF v_ok THEN RAISE NOTICE 'PASS %', v_label; ELSE v_failures := v_failures || format('%s — got %s', v_label, v_np.timezone); END IF;
    v_label := 'email path seeds the notification locale (en-US)';
    v_ok := v_np.locale IS NOT DISTINCT FROM 'en-US';
    IF v_ok THEN RAISE NOTICE 'PASS %', v_label; ELSE v_failures := v_failures || format('%s — got %s', v_label, v_np.locale); END IF;
    -- #endregion

    -- #region Unsupported or absent hints fall back to the defaults
    SELECT * INTO v_up FROM org.user_preferences WHERE user_id = v_bad;
    SELECT * INTO v_np FROM comms.notification_prefs WHERE user_id = v_bad;
    v_label := 'unsupported hints fall back to en-GB / GBP / UTC / no notification locale';
    v_ok := v_up.locale = 'en-GB' AND v_up.preferred_display_currency = 'GBP'
        AND v_np.timezone = 'UTC' AND v_np.locale IS NULL;
    IF v_ok THEN RAISE NOTICE 'PASS %', v_label; ELSE v_failures := v_failures || format('%s — got %s / %s / %s / %s', v_label, v_up.locale, v_up.preferred_display_currency, v_np.timezone, v_np.locale); END IF;

    SELECT * INTO v_up FROM org.user_preferences WHERE user_id = v_none;
    SELECT * INTO v_np FROM comms.notification_prefs WHERE user_id = v_none;
    v_label := 'absent hints fall back to en-GB / GBP / UTC / no notification locale';
    v_ok := v_up.locale = 'en-GB' AND v_up.preferred_display_currency = 'GBP'
        AND v_np.timezone = 'UTC' AND v_np.locale IS NULL;
    IF v_ok THEN RAISE NOTICE 'PASS %', v_label; ELSE v_failures := v_failures || format('%s — got %s / %s / %s / %s', v_label, v_up.locale, v_up.preferred_display_currency, v_np.timezone, v_np.locale); END IF;

    SELECT * INTO v_up FROM org.user_preferences WHERE user_id = v_case;
    v_label := 'hints are matched case- and separator-insensitively and stored canonical (fr-FR / EUR)';
    v_ok := v_up.locale IS NOT DISTINCT FROM 'fr-FR' AND v_up.preferred_display_currency IS NOT DISTINCT FROM 'EUR';
    IF v_ok THEN RAISE NOTICE 'PASS %', v_label; ELSE v_failures := v_failures || format('%s — got %s / %s', v_label, v_up.locale, v_up.preferred_display_currency); END IF;
    -- #endregion

    -- #region OAuth completion: the hints arrive in complete_onboarding's payload, not auth.users
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    VALUES (v_oauth, 'prefs-probe-' || v_oauth || '@projective.invalid', 'authenticated', 'authenticated',
        jsonb_build_object('locale', 'en'), now());
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_oauth, 'role', 'authenticated')::text, true);
    PERFORM public.complete_onboarding(jsonb_build_object(
        'username', 'prefsprobe_e_' || v_tag, 'dob', v_adult, 'first_name', 'Eve', 'last_name', 'Probe',
        'objective', 'client', 'locale', 'de-DE', 'display_currency', 'CHF', 'timezone', 'Europe/Zurich'));
    PERFORM set_config('request.jwt.claims', '', true);

    SELECT * INTO v_up FROM org.user_preferences WHERE user_id = v_oauth;
    SELECT * INTO v_np FROM comms.notification_prefs WHERE user_id = v_oauth;
    v_label := 'OAuth completion seeds from the payload (de-DE / CHF / Europe/Zurich)';
    v_ok := v_up.locale IS NOT DISTINCT FROM 'de-DE' AND v_up.preferred_display_currency IS NOT DISTINCT FROM 'CHF'
        AND v_np.timezone IS NOT DISTINCT FROM 'Europe/Zurich' AND v_np.locale IS NOT DISTINCT FROM 'de-DE';
    IF v_ok THEN RAISE NOTICE 'PASS %', v_label; ELSE v_failures := v_failures || format('%s — got %s / %s / %s / %s', v_label, v_up.locale, v_up.preferred_display_currency, v_np.timezone, v_np.locale); END IF;
    -- #endregion

    -- #region Enterprise owner
    -- A profile-less identity (Decision #87(b)) can no longer open an enterprise: it has no date of
    -- birth, org.fn_is_minor fails closed on that (IW-H2), and the owner seat is refused by
    -- trg_workspace_member_adult. Until FOUNDER_QUESTIONNAIRE F4 gives every owner a DoB, the
    -- owner-membership preference seed (org.seed_owner_preferences) has no profile-less owner to serve.
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data)
    VALUES (v_owner, 'prefs-probe-' || v_owner || '@projective.invalid', 'authenticated', 'authenticated',
        jsonb_build_object('objective', 'enterprise', 'locale', 'ja-JP', 'display_currency', 'JPY'));
    v_label := 'a profile-less identity cannot open an enterprise (no DoB, fn_is_minor fails closed: PM403)';
    BEGIN
        PERFORM public.create_enterprise(v_owner, jsonb_build_object(
            'legalName', 'Prefs Probe ' || v_tag || ' Ltd', 'handle', 'prefsorg' || v_tag,
            'corporateEmail', 'owner-' || v_tag || '@projective.invalid'));
        v_failures := v_failures || (v_label || ' — it went through');
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        v_ok := NOT EXISTS (SELECT 1 FROM org.enterprises WHERE owner_user_id = v_owner);
        IF v_ok THEN RAISE NOTICE 'PASS %', v_label; ELSE v_failures := v_failures || (v_label || ' — an enterprise row survived'); END IF;
    END;

    -- An onboarded person who creates an enterprise keeps the preferences they already chose.
    UPDATE org.user_preferences SET locale = 'it-IT', preferred_display_currency = 'EUR' WHERE user_id = v_email;
    PERFORM public.create_enterprise(v_email, jsonb_build_object(
        'legalName', 'Prefs Probe Two ' || v_tag || ' Ltd', 'handle', 'prefsorgb' || v_tag,
        'corporateEmail', 'owner-b-' || v_tag || '@projective.invalid'));
    SELECT * INTO v_up FROM org.user_preferences WHERE user_id = v_email;
    v_label := 'an existing owner''s chosen preferences are not overwritten';
    v_ok := v_up.locale = 'it-IT' AND v_up.preferred_display_currency = 'EUR';
    IF v_ok THEN RAISE NOTICE 'PASS %', v_label; ELSE v_failures := v_failures || format('%s — got %s / %s', v_label, v_up.locale, v_up.preferred_display_currency); END IF;
    -- #endregion

    IF cardinality(v_failures) > 0 THEN
        RAISE EXCEPTION E'FAIL %', array_to_string(v_failures, E'\nFAIL ');
    END IF;
END;
$$;

ROLLBACK;
