-- =============================================================================================
-- Probe: age guardrails (Decision #190) — org.fn_check_dob through both provisioning paths
-- (public.complete_onboarding and the GoTrue on_auth_user_created trigger), the users_public dob
-- guard, org.fn_assert_adult on every buy/sell door, the catalogue publish trigger and the
-- `isRestricted` claim of public.custom_access_token_hook.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/age_guardrails.sql
--
-- Four profile-less identities stand in for OAuth sign-ups: a 12-year-old, a 16-year-old, a 17-year-old
-- who turns 18 tomorrow and an adult whose 18th birthday is today. Every door is called with ids that
-- do not exist, so a PM403 proves the age gate ran before anything else. A clean run prints only PASS.
-- =============================================================================================

BEGIN;

DO $$
DECLARE
    v_kid uuid := gen_random_uuid();
    v_teen uuid := gen_random_uuid();
    v_eve uuid := gen_random_uuid();
    v_adult uuid := gen_random_uuid();
    v_tag text := substr(md5(random()::text), 1, 8);
    v_ticket uuid;
    v_listing uuid;
    v_door text;
BEGIN
    -- #region Fixture (as postgres): identities with no profile, as an OAuth sign-up leaves them
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    SELECT u, 'age-probe-' || u || '@projective.invalid', 'authenticated', 'authenticated', '{}'::jsonb, now()
      FROM unnest(ARRAY[v_kid, v_teen, v_eve, v_adult]) AS u;
    -- #endregion

    -- #region Under 13 cannot hold an account
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_kid, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM public.complete_onboarding(jsonb_build_object(
            'username', 'ageprobe_kid_' || v_tag, 'dob', (CURRENT_DATE - interval '12 years')::date));
        RAISE EXCEPTION 'FAIL complete_onboarding accepted a 12-year-old';
    EXCEPTION WHEN SQLSTATE 'PM422' THEN
        RAISE NOTICE 'PASS complete_onboarding refuses a 12-year-old (PM422)';
    END;

    BEGIN
        PERFORM public.complete_onboarding(jsonb_build_object(
            'username', 'ageprobe_kid_' || v_tag, 'dob', (CURRENT_DATE + 1)));
        RAISE EXCEPTION 'FAIL complete_onboarding accepted a date of birth in the future';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'PASS complete_onboarding refuses a future date of birth (22023)';
    END;

    PERFORM set_config('request.jwt.claims', '', true);
    BEGIN
        INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data)
        VALUES (gen_random_uuid(), 'age-probe-gotrue-' || v_tag || '@projective.invalid', 'authenticated', 'authenticated',
                jsonb_build_object('username', 'ageprobe_gt_' || v_tag, 'dob', (CURRENT_DATE - interval '12 years')::date));
        RAISE EXCEPTION 'FAIL a direct GoTrue signup provisioned a 12-year-old';
    EXCEPTION WHEN SQLSTATE 'PM422' THEN
        RAISE NOTICE 'PASS direct GoTrue signup refuses a 12-year-old (PM422)';
    END;
    -- #endregion

    -- #region Provision the restricted and unrestricted accounts
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teen, 'role', 'authenticated')::text, true);
    PERFORM public.complete_onboarding(jsonb_build_object(
        'username', 'ageprobe_teen_' || v_tag, 'dob', (CURRENT_DATE - interval '16 years')::date));
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_eve, 'role', 'authenticated')::text, true);
    PERFORM public.complete_onboarding(jsonb_build_object(
        'username', 'ageprobe_eve_' || v_tag, 'dob', (CURRENT_DATE - interval '18 years' + interval '1 day')::date));
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role', 'authenticated')::text, true);
    PERFORM public.complete_onboarding(jsonb_build_object(
        'username', 'ageprobe_adult_' || v_tag, 'dob', (CURRENT_DATE - interval '18 years')::date));
    RAISE NOTICE 'PASS 16-, 17- and 18-year-olds are provisioned';

    IF org.fn_is_minor(v_teen) AND org.fn_is_minor(v_eve) AND NOT org.fn_is_minor(v_adult) THEN
        RAISE NOTICE 'PASS fn_is_minor: 16 and 17 (18 tomorrow) restricted, 18 today unrestricted';
    ELSE
        RAISE EXCEPTION 'FAIL fn_is_minor misjudged the 18th-birthday boundary';
    END IF;
    -- #endregion

    -- #region A 16-year-old is refused every buy/sell door
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teen, 'role', 'authenticated')::text, true);
    FOREACH v_door IN ARRAY ARRAY[
        'SELECT org.enable_freelancer_profile(''{}''::jsonb)',
        'SELECT projects.apply_to_project(''prj-none'', ''stg-none'')',
        'SELECT finance.begin_card_payment(''wallet_topup'', NULL, NULL, NULL, 1000, ''GBP'', ''ageprobe-card-1'')',
        'SELECT finance.place_wallet_order(gen_random_uuid(), ARRAY[gen_random_uuid()], ''GBP'', ''{}''::jsonb, NULL, ''ageprobe-order-1'', 0)',
        'SELECT projects.fund_stage(gen_random_uuid(), gen_random_uuid())',
        'SELECT projects.fund_ticket(gen_random_uuid(), gen_random_uuid())',
        'SELECT projects.fund_paid_revision(gen_random_uuid())',
        'SELECT finance.begin_payout(gen_random_uuid(), 100, ''GBP'', false, ''ageprobe-payout-1'')'
    ] LOOP
        BEGIN
            EXECUTE v_door;
            RAISE EXCEPTION 'FAIL a 16-year-old got through: %', v_door;
        EXCEPTION WHEN SQLSTATE 'PM403' THEN
            RAISE NOTICE 'PASS PM403: %', split_part(split_part(v_door, '(', 1), ' ', 2);
        END;
    END LOOP;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_eve, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM org.enable_freelancer_profile('{}'::jsonb);
        RAISE EXCEPTION 'FAIL become-partner let in a 17-year-old who turns 18 tomorrow';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS PM403: become-partner the day before the 18th birthday';
    END;

    SELECT t.id INTO v_ticket FROM projects.tickets t
     WHERE t.current_assignee_id IS NULL AND t.description IS NOT NULL AND t.description <> '{}'::jsonb
     ORDER BY t.id LIMIT 1;
    IF v_ticket IS NULL THEN
        RAISE NOTICE 'SKIP fn_assign_ticket_core: the seed has no unclaimed described ticket';
    ELSE
        BEGIN
            PERFORM projects.fn_assign_ticket_core(v_ticket, v_teen, false);
            RAISE EXCEPTION 'FAIL a ticket was assigned to a 16-year-old';
        EXCEPTION WHEN SQLSTATE 'PM403' THEN
            RAISE NOTICE 'PASS PM403: projects.fn_assign_ticket_core (claim / assignment)';
        END;
    END IF;

    PERFORM set_config('request.jwt.claims', '', true);
    SELECT l.id INTO v_listing FROM catalogue.listings l ORDER BY l.id LIMIT 1;
    IF v_listing IS NULL THEN
        RAISE NOTICE 'SKIP publish gate: the seed has no listing';
    ELSE
        UPDATE catalogue.listings SET owner_user_id = v_teen, status = 'draft' WHERE id = v_listing;
        BEGIN
            UPDATE catalogue.listings SET status = 'published' WHERE id = v_listing;
            RAISE EXCEPTION 'FAIL a 16-year-old published a listing';
        EXCEPTION WHEN SQLSTATE 'PM403' THEN
            RAISE NOTICE 'PASS PM403: catalogue.listings publish';
        END;
    END IF;
    -- #endregion

    -- #region The adult passes, and the claim tells the two apart
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role', 'authenticated')::text, true);
    PERFORM org.enable_freelancer_profile('{}'::jsonb);
    RAISE NOTICE 'PASS an 18-year-old (birthday today) can become a partner';
    PERFORM set_config('request.jwt.claims', '', true);

    IF (public.custom_access_token_hook(jsonb_build_object('user_id', v_teen, 'claims', '{}'::jsonb))
            #>> '{claims,app_metadata,active_context,isRestricted}') = 'true'
       AND (public.custom_access_token_hook(jsonb_build_object('user_id', v_adult, 'claims', '{}'::jsonb))
            #>> '{claims,app_metadata,active_context,isRestricted}') = 'false' THEN
        RAISE NOTICE 'PASS access token: isRestricted true for 16, false for 18';
    ELSE
        RAISE EXCEPTION 'FAIL access token isRestricted claim';
    END IF;
    -- #endregion

    -- #region Plausibility on later writes
    BEGIN
        UPDATE org.users_public SET dob = CURRENT_DATE + 1 WHERE user_id = v_adult;
        RAISE EXCEPTION 'FAIL a future date of birth was stored';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'PASS users_public refuses a future date of birth (22023)';
    END;
    BEGIN
        UPDATE org.users_public SET dob = DATE '1899-12-31' WHERE user_id = v_adult;
        RAISE EXCEPTION 'FAIL a pre-1900 date of birth was stored';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'PASS users_public refuses a date of birth before 1900 (22023)';
    END;
    UPDATE org.users_public SET dob = DATE '1900-01-01' WHERE user_id = v_adult;
    RAISE NOTICE 'PASS the erasure sentinel 1900-01-01 is still accepted';
    -- #endregion
END;
$$;

ROLLBACK;
