-- =============================================================================================
-- Probe: restricted (13–17) accounts, Decision #192 — ages counted in the person's own zone, the
-- seller persona withheld at provisioning, personal projects (one person, no money, never listed,
-- work without escrow) and minors kept out of everybody else's projects.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/personal_projects.sql
--
-- Every refusal is caught by its SQLSTATE; a clean run prints only PASS.
-- =============================================================================================

BEGIN;

DO $$
DECLARE
    v_teen uuid := gen_random_uuid();
    v_adult uuid := gen_random_uuid();
    v_tag text := substr(md5(random()::text), 1, 8);
    v_kiri date := org.fn_today_in('Pacific/Kiritimati');
    v_dob date;
    v_project uuid;
    v_adult_project uuid;
    v_stage uuid;
    v_ticket uuid;
    v_row projects.projects%ROWTYPE;
    v_business uuid;
BEGIN
    -- #region Ages in the person's own zone
    -- Kiritimati (UTC+14) and Pago Pago (UTC−11) are always on different calendar days, so a birthday
    -- that is today in Kiritimati has not arrived in Pago Pago.
    v_dob := (v_kiri - interval '18 years')::date;
    IF org.fn_age_years(v_dob, 'Pacific/Kiritimati') = 18 AND org.fn_age_years(v_dob, 'Pacific/Pago_Pago') = 17 THEN
        RAISE NOTICE 'PASS an 18th birthday turns over on the person''s own date';
    ELSE
        RAISE EXCEPTION 'FAIL fn_age_years ignored the zone';
    END IF;
    IF org.fn_valid_time_zone('Mars/Olympus') IS NULL AND org.fn_today_in('Mars/Olympus') = org.fn_today_in('UTC') THEN
        RAISE NOTICE 'PASS an unknown zone counts in UTC';
    ELSE
        RAISE EXCEPTION 'FAIL an unknown zone was not treated as UTC';
    END IF;
    -- #endregion

    -- #region Provisioning: zone stored, seller persona withheld under 18
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    SELECT u, 'personal-probe-' || u || '@projective.invalid', 'authenticated', 'authenticated', '{}'::jsonb, now()
      FROM unnest(ARRAY[v_teen, v_adult]) AS u;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teen, 'role', 'authenticated')::text, true);
    PERFORM public.complete_onboarding(jsonb_build_object(
        'username', 'pprobe_teen_' || v_tag, 'dob', (CURRENT_DATE - interval '16 years')::date,
        'timezone', 'Europe/London', 'objective', 'freelancer'));
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role', 'authenticated')::text, true);
    PERFORM public.complete_onboarding(jsonb_build_object(
        'username', 'pprobe_adult_' || v_tag, 'dob', (CURRENT_DATE - interval '30 years')::date,
        'timezone', 'Mars/Olympus', 'objective', 'freelancer'));

    IF (SELECT timezone FROM org.users_public WHERE user_id = v_teen) = 'Europe/London'
       AND (SELECT timezone FROM org.users_public WHERE user_id = v_adult) IS NULL THEN
        RAISE NOTICE 'PASS the sign-up zone is stored, an unknown one is dropped';
    ELSE
        RAISE EXCEPTION 'FAIL provisioning stored the wrong zone';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org.freelancer_profiles WHERE user_id = v_teen)
       AND NOT (SELECT is_freelancer FROM org.users_public WHERE user_id = v_teen)
       AND EXISTS (SELECT 1 FROM org.freelancer_profiles WHERE user_id = v_adult) THEN
        RAISE NOTICE 'PASS a 16-year-old who chose freelancer starts as a client; an adult gets the persona';
    ELSE
        RAISE EXCEPTION 'FAIL the seller persona was provisioned for a minor';
    END IF;
    -- #endregion

    -- #region A minor's project is personal, private and free of money
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teen, 'role', 'authenticated')::text, true);
    INSERT INTO projects.projects (owner_user_id, title, visibility, publish_visibility, budget_amount_cents, auto_fund_override, session_kind)
    VALUES (v_teen, 'Revision planner', 'public', 'public', 50000, 'from_wallet', 'group')
    RETURNING * INTO v_row;
    v_project := v_row.id;
    IF v_row.is_personal AND v_row.visibility = 'invite_only' AND v_row.publish_visibility = 'invite_only'
       AND v_row.budget_amount_cents IS NULL AND v_row.auto_fund_override IS NULL AND v_row.session_kind = 'none' THEN
        RAISE NOTICE 'PASS a minor''s project is personal: invite-only, no budget, no auto-fund, no sessions';
    ELSE
        RAISE EXCEPTION 'FAIL personal project row: %', row_to_json(v_row);
    END IF;

    BEGIN
        UPDATE projects.projects SET visibility = 'public' WHERE id = v_project;
        IF (SELECT visibility FROM projects.projects WHERE id = v_project) <> 'invite_only' THEN
            RAISE EXCEPTION 'FAIL a personal project was made public';
        END IF;
        RAISE NOTICE 'PASS a personal project cannot be made public';
    END;

    BEGIN
        UPDATE projects.projects SET is_personal = false WHERE id = v_project;
        RAISE EXCEPTION 'FAIL a personal project was switched off';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a personal project stays personal (PM403)';
    END;

    SELECT b.id INTO v_business FROM org.business_profiles b LIMIT 1;
    IF v_business IS NOT NULL THEN
        BEGIN
            INSERT INTO projects.projects (owner_user_id, title, client_business_id)
            VALUES (v_teen, 'Business work', v_business);
            RAISE EXCEPTION 'FAIL a minor filed a project under a business';
        EXCEPTION WHEN SQLSTATE 'PM403' THEN
            RAISE NOTICE 'PASS a personal project cannot belong to a business (PM403)';
        END;
    END IF;

    INSERT INTO projects.project_stages (project_id, name, sort_order, unit_price_cents, extra_revision_price_cents)
    VALUES (v_project, 'Week 1', 0, 25000, 5000)
    RETURNING id INTO v_stage;
    IF (SELECT unit_price_cents IS NULL AND extra_revision_price_cents IS NULL AND NOT hire_trigger_active
          FROM projects.project_stages WHERE id = v_stage) THEN
        RAISE NOTICE 'PASS a personal stage carries no price and does not hire';
    ELSE
        RAISE EXCEPTION 'FAIL a personal stage kept money or hiring';
    END IF;

    INSERT INTO projects.tickets (project_id, current_stage_id, title, text_description, unit_price_cents)
    VALUES (v_project, v_stage, 'Chapter 3 notes', 'Summarise chapter 3.', 9900)
    RETURNING id INTO v_ticket;
    UPDATE projects.tickets SET current_assignee_id = v_teen, status = 'in_progress' WHERE id = v_ticket;
    IF (SELECT status::text = 'in_progress' AND unit_price_cents IS NULL FROM projects.tickets WHERE id = v_ticket)
       AND NOT EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id = v_ticket) THEN
        RAISE NOTICE 'PASS personal work starts with no price and no escrow';
    ELSE
        RAISE EXCEPTION 'FAIL personal ticket state';
    END IF;
    UPDATE projects.tickets SET status = 'completed' WHERE id = v_ticket;
    RAISE NOTICE 'PASS a personal ticket completes without a release';

    BEGIN
        UPDATE projects.tickets SET current_assignee_id = v_adult WHERE id = v_ticket;
        RAISE EXCEPTION 'FAIL someone else took a personal ticket';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS only the owner holds a personal ticket (PM403)';
    END;

    BEGIN
        INSERT INTO projects.project_invitations (project_id, project_stage_id, target_user_id)
        VALUES (v_project, v_stage, v_adult);
        RAISE EXCEPTION 'FAIL a personal project invited someone';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a personal project invites nobody (PM403)';
    END;
    BEGIN
        INSERT INTO projects.stage_open_seats (project_stage_id, description_of_need) VALUES (v_stage, 'Help wanted');
        RAISE EXCEPTION 'FAIL a personal project posted a seat';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a personal project posts no seat (PM403)';
    END;
    BEGIN
        INSERT INTO projects.stage_invite_links (project_id, project_stage_id, token, created_by)
        VALUES (v_project, v_stage, md5(random()::text), v_teen);
        RAISE EXCEPTION 'FAIL a personal project minted an invite link';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a personal project mints no invite link (PM403)';
    END;
    -- #endregion

    -- #region Minors stay out of other people's projects; adults are unaffected
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role', 'authenticated')::text, true);
    INSERT INTO projects.projects (owner_user_id, title) VALUES (v_adult, 'Brand refresh') RETURNING * INTO v_row;
    v_adult_project := v_row.id;
    IF NOT v_row.is_personal THEN
        RAISE NOTICE 'PASS an adult''s project is not personal';
    ELSE
        RAISE EXCEPTION 'FAIL an adult''s project was made personal';
    END IF;
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_adult_project, 'Discovery', 0)
    RETURNING id INTO v_stage;

    BEGIN
        INSERT INTO projects.project_invitations (project_id, project_stage_id, target_user_id)
        VALUES (v_adult_project, v_stage, v_teen);
        RAISE EXCEPTION 'FAIL an adult invited a 16-year-old';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a 16-year-old cannot be invited into someone else''s project (PM403)';
    END;
    BEGIN
        INSERT INTO projects.project_participants (project_id, profile_type, profile_id, role)
        VALUES (v_adult_project, 'freelancer', v_teen, 'member');
        RAISE EXCEPTION 'FAIL a 16-year-old was seated';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a 16-year-old cannot be seated on someone else''s project (PM403)';
    END;
    BEGIN
        INSERT INTO projects.project_applications (project_id, applicant_user_id, applicant_type, applicant_profile_id)
        VALUES (v_adult_project, v_teen, 'freelancer', v_teen);
        RAISE EXCEPTION 'FAIL a 16-year-old applied';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a 16-year-old''s application is refused on every path (PM403)';
    END;
    -- #endregion
END;
$$;

ROLLBACK;
