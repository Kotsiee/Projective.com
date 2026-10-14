-- =============================================================================================
-- Probe: availability presets, compiled occurrences and the booking gate (Decision #217 (c)/(d)).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded
-- local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/scheduling_presets.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. It checks:
--    1. the seed: every seeded schedule has one default library preset, every Session and Group
--       Session blueprint is bound to its owner's;
--    2. the single default: saving a preset as the default moves it, and a second live default is
--       unrepresentable;
--    3. save_availability_preset refuses a bad RRULE shape, more than 64 rules or 6 bands;
--    4. a stranger reads no preset and cannot save one onto another's schedule;
--    5. a blueprint binds only a preset of its owner's schedule (the CHECK half of the FK);
--    6. replace_preset_occurrences is refused to `authenticated`;
--    7. the gate: a preset not yet compiled falls back to the weekly bands; once compiled, a slot
--       inside an occurrence is covered and a slot outside one is refused — by fn_band_covers and by
--       projects.fn_book_session_slot (PS409); editing the rules marks the preset not compiled;
--    8. minors: a restricted caller cannot save a preset, and a minor buyer is refused (PM403);
--    9. archiving unbinds every bound blueprint and returns its id, hands the default on, and the
--       default cannot be archived while it is the only library preset.
-- =============================================================================================

BEGIN;

DO $$
DECLARE
    v_tag text := substr(md5(random()::text), 1, 8);
    v_adult uuid := gen_random_uuid();
    v_teen uuid := gen_random_uuid();
    v_teen_schedule uuid;
    -- Maris: an individual seller with a seeded Group Session listing.
    v_maris uuid;
    v_maris_schedule uuid;
    v_maris_default uuid;
    v_maris_listing uuid;
    -- Studio Fern: a team selling 1-1 sessions.
    v_fern_listing uuid;
    v_fern_schedule uuid;
    v_fern_preset uuid;
    v_fern_rule uuid;
    v_tz text;
    v_band record;
    v_day date;
    v_in_start timestamptz;
    v_off_start timestamptz;
    v_new uuid;
    v_other uuid;
    v_ids uuid[];
    v_n integer;
    v_rules jsonb;
    v_weekly_rule jsonb := jsonb_build_object(
        'kind', 'working_hours', 'effect', 'add', 'rrule', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        'starts_on', '2026-01-05', 'bands', jsonb_build_array(jsonb_build_object('start_minute', 540, 'end_minute', 1020)));
BEGIN
    -- #region Fixture
    SELECT b.id, b.freelancer_profile_id INTO v_maris_listing, v_maris
      FROM marketplace.service_blueprints b
     WHERE b.delivery_model = 'group_session' AND b.owner_team_id IS NULL AND b.availability_preset_id IS NOT NULL
     ORDER BY b.id LIMIT 1;
    SELECT b.id INTO v_fern_listing
      FROM marketplace.service_blueprints b
     WHERE b.delivery_model = 'session' AND b.owner_team_id IS NOT NULL AND b.is_published
       AND COALESCE(b.session_count, 1) = 1
     ORDER BY b.id LIMIT 1;
    IF v_maris_listing IS NULL OR v_fern_listing IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a seeded individual group session and a team 1-1 session (deno task db:reset)';
    END IF;
    SELECT p.schedule_id, p.id INTO v_maris_schedule, v_maris_default
      FROM scheduling.availability_presets p
      JOIN marketplace.service_blueprints b ON b.availability_preset_id = p.id
     WHERE b.id = v_maris_listing;

    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    SELECT u, 'presets-probe-' || u || '@projective.invalid', 'authenticated', 'authenticated', '{}'::jsonb, now()
      FROM unnest(ARRAY[v_teen, v_adult]) AS u;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teen, 'role', 'authenticated')::text, true);
    PERFORM public.complete_onboarding(jsonb_build_object(
        'username', 'presetprobe_teen_' || v_tag, 'dob', (CURRENT_DATE - interval '16 years')::date, 'timezone', 'UTC'));
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role', 'authenticated')::text, true);
    PERFORM public.complete_onboarding(jsonb_build_object(
        'username', 'presetprobe_adult_' || v_tag, 'dob', (CURRENT_DATE - interval '30 years')::date, 'timezone', 'UTC'));
    INSERT INTO scheduling.schedules (owner_type, owner_id, timezone)
    VALUES ('user', v_teen, 'UTC') RETURNING id INTO v_teen_schedule;
    -- #endregion

    -- #region 1. The seed
    IF EXISTS (
        SELECT 1 FROM scheduling.schedules s
         WHERE EXISTS (SELECT 1 FROM scheduling.availability_presets p
                        WHERE p.schedule_id = s.id AND p.scope = 'library' AND p.archived_at IS NULL)
           AND (SELECT count(*) FROM scheduling.availability_presets p
                 WHERE p.schedule_id = s.id AND p.is_default AND p.archived_at IS NULL) <> 1
    ) OR (SELECT count(*) FROM scheduling.availability_presets p
           WHERE p.schedule_id = v_maris_schedule AND p.is_default AND p.archived_at IS NULL) <> 1 THEN
        RAISE EXCEPTION 'FAIL 1: a seeded schedule does not hold exactly one default preset';
    END IF;
    IF EXISTS (
        SELECT 1 FROM marketplace.service_blueprints b
         WHERE b.delivery_model IN ('session', 'group_session') AND b.availability_preset_id IS NULL
    ) THEN
        RAISE EXCEPTION 'FAIL 1: a seeded session listing is unbound';
    END IF;
    IF EXISTS (SELECT 1 FROM scheduling.availability_presets WHERE compiled_through IS NOT NULL) THEN
        RAISE EXCEPTION 'FAIL 1: a seeded preset claims to be compiled';
    END IF;
    RAISE NOTICE 'PASS 1: one default preset per seeded schedule, every session listing bound, none compiled';
    -- #endregion

    -- #region 2. The single default, as Maris
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_maris, 'role', 'authenticated')::text, true);
    v_new := scheduling.save_availability_preset(v_maris_schedule, jsonb_build_object(
        'name', 'Probe evenings ' || v_tag, 'is_default', true, 'rules', jsonb_build_array(v_weekly_rule)));
    SELECT count(*) INTO v_n FROM scheduling.availability_presets
     WHERE schedule_id = v_maris_schedule AND is_default AND archived_at IS NULL;
    IF v_n <> 1 OR NOT (SELECT is_default FROM scheduling.availability_presets WHERE id = v_new) THEN
        RAISE EXCEPTION 'FAIL 2: saving a default left % defaults', v_n;
    END IF;
    -- A default is moved, never cleared: saving it with is_default false keeps it the default.
    PERFORM scheduling.save_availability_preset(v_maris_schedule, jsonb_build_object(
        'id', v_new, 'name', 'Probe evenings ' || v_tag, 'is_default', false, 'rules', jsonb_build_array(v_weekly_rule)));
    IF NOT (SELECT is_default FROM scheduling.availability_presets WHERE id = v_new) THEN
        RAISE EXCEPTION 'FAIL 2: the only default was cleared';
    END IF;
    IF (SELECT count(*) FROM scheduling.recurrence_rules WHERE preset_id = v_new) <> 1
       OR (SELECT count(*) FROM scheduling.recurrence_rule_bands b
             JOIN scheduling.recurrence_rules r ON r.id = b.rule_id WHERE r.preset_id = v_new) <> 1 THEN
        RAISE EXCEPTION 'FAIL 2: the rules were not replaced wholesale';
    END IF;
    BEGIN
        UPDATE scheduling.availability_presets SET is_default = true WHERE id = v_maris_default;
        RAISE EXCEPTION 'FAIL 2: a second live default was stored';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    -- Hand the default back to the seeded preset for section 9.
    PERFORM scheduling.save_availability_preset(v_maris_schedule, jsonb_build_object(
        'id', v_maris_default, 'name', (SELECT name FROM scheduling.availability_presets WHERE id = v_maris_default),
        'is_default', true,
        'rules', (SELECT jsonb_agg(jsonb_build_object(
                     'id', r.id, 'kind', r.kind, 'effect', r.effect, 'rrule', r.rrule, 'starts_on', r.starts_on,
                     'bands', (SELECT jsonb_agg(jsonb_build_object('start_minute', b.start_minute, 'end_minute', b.end_minute)
                                 ORDER BY b.position) FROM scheduling.recurrence_rule_bands b WHERE b.rule_id = r.id))
                     ORDER BY r.position)
                    FROM scheduling.recurrence_rules r WHERE r.preset_id = v_maris_default)));
    IF NOT (SELECT is_default FROM scheduling.availability_presets WHERE id = v_maris_default)
       OR (SELECT is_default FROM scheduling.availability_presets WHERE id = v_new) THEN
        RAISE EXCEPTION 'FAIL 2: the default did not move back';
    END IF;
    RAISE NOTICE 'PASS 2: one live default per schedule — saved defaults move it, a second is refused';
    -- #endregion

    -- #region 3. Shape checks
    BEGIN
        PERFORM scheduling.save_availability_preset(v_maris_schedule, jsonb_build_object(
            'name', 'Probe bad ' || v_tag, 'rules', jsonb_build_array(v_weekly_rule || '{"rrule": "BYDAY=MO"}')));
        RAISE EXCEPTION 'FAIL 3: an RRULE without FREQ= was stored';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    BEGIN
        PERFORM scheduling.save_availability_preset(v_maris_schedule, jsonb_build_object(
            'name', 'Probe long ' || v_tag,
            'rules', jsonb_build_array(v_weekly_rule || jsonb_build_object('rrule', 'FREQ=WEEKLY;' || repeat('X', 400)))));
        RAISE EXCEPTION 'FAIL 3: an RRULE over 400 characters was stored';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    BEGIN
        PERFORM scheduling.save_availability_preset(v_maris_schedule, jsonb_build_object(
            'name', 'Probe many ' || v_tag,
            'rules', (SELECT jsonb_agg(v_weekly_rule) FROM generate_series(1, 65))));
        RAISE EXCEPTION 'FAIL 3: 65 rules were stored';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    BEGIN
        PERFORM scheduling.save_availability_preset(v_maris_schedule, jsonb_build_object(
            'name', 'Probe bands ' || v_tag,
            'rules', jsonb_build_array(v_weekly_rule || jsonb_build_object('bands',
                (SELECT jsonb_agg(jsonb_build_object('start_minute', g * 60, 'end_minute', g * 60 + 30))
                   FROM generate_series(1, 7) g)))));
        RAISE EXCEPTION 'FAIL 3: a rule with 7 bands was stored';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    RAISE NOTICE 'PASS 3: the RRULE prefix and length, 64 rules and 6 bands per rule are enforced';
    -- #endregion

    -- #region 4. A stranger
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role', 'authenticated')::text, true);
    IF EXISTS (SELECT 1 FROM scheduling.availability_presets WHERE schedule_id = v_maris_schedule)
       OR EXISTS (SELECT 1 FROM scheduling.recurrence_rules WHERE preset_id = v_maris_default)
       OR EXISTS (SELECT 1 FROM scheduling.recurrence_rule_bands b
                    JOIN scheduling.recurrence_rules r ON r.id = b.rule_id WHERE r.preset_id = v_new) THEN
        RAISE EXCEPTION 'FAIL 4: a stranger read another seller''s preset';
    END IF;
    BEGIN
        PERFORM scheduling.save_availability_preset(v_maris_schedule, jsonb_build_object('name', 'Probe theft ' || v_tag));
        RAISE EXCEPTION 'FAIL 4: a stranger saved a preset onto another''s schedule';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM scheduling.archive_availability_preset(v_new);
        RAISE EXCEPTION 'FAIL 4: a stranger archived another''s preset';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'PASS 4: a stranger reads no preset, rule or band, and cannot save or archive one';
    -- #endregion

    -- #region 6. The occurrence door is the service role's
    BEGIN
        PERFORM scheduling.replace_preset_occurrences(v_new, now(), now() + interval '1 day', '[]'::jsonb);
        RAISE EXCEPTION 'FAIL 6: authenticated wrote occurrences';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        INSERT INTO scheduling.availability_occurrences (preset_id, kind, starts_at, ends_at)
        VALUES (v_new, 'working_hours', now(), now() + interval '1 hour');
        RAISE EXCEPTION 'FAIL 6: authenticated inserted an occurrence';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'PASS 6: replace_preset_occurrences and the occurrence table refuse authenticated';
    RESET ROLE;
    -- #endregion

    -- #region 5. Binding a blueprint
    BEGIN
        UPDATE marketplace.service_blueprints
           SET availability_preset_id = scheduling.fn_preset_for_blueprint(v_fern_listing)
         WHERE id = v_maris_listing;
        RAISE EXCEPTION 'FAIL 5: a listing was bound to another owner''s preset';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO scheduling.availability_presets (schedule_id, scope, blueprint_id, name)
    VALUES (v_maris_schedule, 'service', v_maris_listing, 'Probe fork ' || v_tag) RETURNING id INTO v_other;
    BEGIN
        INSERT INTO scheduling.availability_presets (schedule_id, scope, blueprint_id, name)
        VALUES (v_maris_schedule, 'service', v_fern_listing, 'Probe stray fork ' || v_tag);
        RAISE EXCEPTION 'FAIL 5: a fork named a service sold from another schedule';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    UPDATE marketplace.service_blueprints SET availability_preset_id = v_other WHERE id = v_maris_listing;
    IF scheduling.fn_preset_for_blueprint(v_maris_listing) <> v_other THEN
        RAISE EXCEPTION 'FAIL 5: the fork does not resolve for its own listing';
    END IF;
    UPDATE marketplace.service_blueprints SET availability_preset_id = v_maris_default WHERE id = v_maris_listing;
    RAISE NOTICE 'PASS 5: a listing binds only its owner''s presets, and a fork only its own service';
    -- #endregion

    -- #region 7. The gate
    v_fern_preset := scheduling.fn_preset_for_blueprint(v_fern_listing);
    SELECT p.schedule_id INTO v_fern_schedule FROM scheduling.availability_presets p WHERE p.id = v_fern_preset;
    SELECT s.timezone INTO v_tz FROM scheduling.schedules s WHERE s.id = v_fern_schedule;
    SELECT r.id INTO v_fern_rule FROM scheduling.recurrence_rules r WHERE r.preset_id = v_fern_preset ORDER BY r.position LIMIT 1;
    SELECT r.weekday, r.start_minute, r.end_minute INTO v_band
      FROM scheduling.availability_rules r
     WHERE r.schedule_id = v_fern_schedule AND r.kind = 'working_hours' AND r.is_active
       AND r.end_minute - r.start_minute >= 90 AND r.start_minute >= 300
     ORDER BY r.weekday, r.start_minute LIMIT 1;
    IF v_fern_preset IS NULL OR v_band IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: Studio Fern needs a preset and a weekly working band of 90 minutes after 05:00';
    END IF;
    v_day := (now() AT TIME ZONE v_tz)::date + 3;
    WHILE extract(dow FROM v_day)::integer <> v_band.weekday LOOP
        v_day := v_day + 1;
    END LOOP;
    -- Inside a weekly band, and 03:00 the same day (before every band this fixture can pick).
    v_in_start := (v_day + make_interval(mins => v_band.start_minute + 15)) AT TIME ZONE v_tz;
    v_off_start := (v_day + time '03:00') AT TIME ZONE v_tz;

    IF NOT scheduling.fn_band_covers(v_fern_schedule, 'working_hours', v_in_start, v_in_start + interval '1 hour', v_fern_listing)
       OR scheduling.fn_band_covers(v_fern_schedule, 'working_hours', v_off_start, v_off_start + interval '1 hour', v_fern_listing) THEN
        RAISE EXCEPTION 'FAIL 7: a preset not yet compiled did not fall back to the weekly bands';
    END IF;
    RAISE NOTICE 'PASS 7: a preset not yet compiled falls back to the weekly bands';

    -- Compile, as the service role, one 02:00–06:00 working span the weekly bands do not have.
    SET LOCAL ROLE service_role;
    v_n := scheduling.replace_preset_occurrences(
        v_fern_preset,
        (v_day - 1)::timestamp AT TIME ZONE v_tz,
        (v_day + 2)::timestamp AT TIME ZONE v_tz,
        jsonb_build_array(jsonb_build_object(
            'kind', 'working_hours',
            'startsAt', (v_day + time '02:00') AT TIME ZONE v_tz,
            'endsAt', (v_day + time '06:00') AT TIME ZONE v_tz,
            'ruleIds', jsonb_build_array(v_fern_rule))));
    BEGIN
        PERFORM scheduling.replace_preset_occurrences(v_fern_preset, (v_day - 1)::timestamp AT TIME ZONE v_tz,
            (v_day + 2)::timestamp AT TIME ZONE v_tz, jsonb_build_array(jsonb_build_object(
                'kind', 'working_hours', 'startsAt', (v_day + time '02:00') AT TIME ZONE v_tz,
                'endsAt', (v_day + time '03:00') AT TIME ZONE v_tz, 'ruleIds', jsonb_build_array(v_maris_default))));
        RAISE EXCEPTION 'FAIL 7: a span naming another preset''s rule was stored';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    RESET ROLE;
    IF v_n <> 1 OR (SELECT compiled_from FROM scheduling.availability_presets WHERE id = v_fern_preset) <> v_day - 1
       OR (SELECT compiled_through FROM scheduling.availability_presets WHERE id = v_fern_preset) <> v_day + 1 THEN
        RAISE EXCEPTION 'FAIL 7: the compiled window was not stamped (% spans)', v_n;
    END IF;

    IF NOT scheduling.fn_band_covers(v_fern_schedule, 'working_hours', v_off_start, v_off_start + interval '1 hour', v_fern_listing) THEN
        RAISE EXCEPTION 'FAIL 7: a slot inside a compiled occurrence was refused';
    END IF;
    IF scheduling.fn_band_covers(v_fern_schedule, 'working_hours', v_in_start, v_in_start + interval '1 hour', v_fern_listing) THEN
        RAISE EXCEPTION 'FAIL 7: a slot outside every compiled occurrence was covered';
    END IF;
    IF NOT scheduling.fn_band_covers(v_fern_schedule, 'working_hours', v_in_start, v_in_start + interval '1 hour') THEN
        RAISE EXCEPTION 'FAIL 7: the weekly answer changed for a caller without a listing';
    END IF;
    RAISE NOTICE 'PASS 7: once compiled, a slot inside an occurrence is covered and one outside is not';

    BEGIN
        PERFORM projects.fn_book_session_slot(v_fern_listing, v_adult, 'user', v_adult, 1000, 1, 'USD', v_in_start, NULL);
        RAISE EXCEPTION 'FAIL 7: a session was booked outside the compiled hours';
    EXCEPTION WHEN SQLSTATE 'PS409' THEN
        IF SQLERRM NOT LIKE '%outside the provider''s hours%' THEN
            RAISE EXCEPTION 'FAIL 7: refused for another reason: %', SQLERRM;
        END IF;
    END;
    RAISE NOTICE 'PASS 7: fn_book_session_slot refuses a first sitting outside the compiled hours (PS409)';

    -- Editing the rules makes the compiled spans stale: the gate is back on the weekly bands.
    UPDATE scheduling.recurrence_rules SET label = 'Probe edit' WHERE id = v_fern_rule;
    IF (SELECT compiled_through FROM scheduling.availability_presets WHERE id = v_fern_preset) IS NOT NULL
       OR NOT scheduling.fn_band_covers(v_fern_schedule, 'working_hours', v_in_start, v_in_start + interval '1 hour', v_fern_listing) THEN
        RAISE EXCEPTION 'FAIL 7: a rule edit left the preset compiled';
    END IF;
    RAISE NOTICE 'PASS 7: a rule edit marks the preset not compiled';
    -- #endregion

    -- #region 8. Minors
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teen, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM scheduling.save_availability_preset(v_teen_schedule, jsonb_build_object('name', 'Probe teen ' || v_tag));
        RAISE EXCEPTION 'FAIL 8: a restricted account saved a preset';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN NULL;
    END;
    RESET ROLE;
    BEGIN
        PERFORM projects.fn_book_session_slot(v_fern_listing, v_teen, 'user', v_teen, 1000, 1, 'USD', v_in_start, NULL);
        RAISE EXCEPTION 'FAIL 8: a minor booked a session';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN NULL;
    END;
    RAISE NOTICE 'PASS 8: a restricted account saves no preset and books no session (PM403)';
    -- #endregion

    -- #region 9. Archiving, as Maris
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_maris, 'role', 'authenticated')::text, true);
    v_ids := scheduling.archive_availability_preset(v_maris_default);
    IF NOT v_maris_listing = ANY (v_ids)
       OR EXISTS (SELECT 1 FROM marketplace.service_blueprints WHERE availability_preset_id = v_maris_default)
       OR (SELECT archived_at FROM scheduling.availability_presets WHERE id = v_maris_default) IS NULL THEN
        RAISE EXCEPTION 'FAIL 9: archiving left a listing bound (returned %)', v_ids;
    END IF;
    IF NOT (SELECT is_default FROM scheduling.availability_presets WHERE id = v_new)
       OR scheduling.fn_preset_for_blueprint(v_maris_listing) <> v_new THEN
        RAISE EXCEPTION 'FAIL 9: the default was not handed on, or the unbound listing does not fall back to it';
    END IF;
    IF scheduling.archive_availability_preset(v_maris_default) <> '{}'::uuid[] THEN
        RAISE EXCEPTION 'FAIL 9: archiving twice was not a no-op';
    END IF;
    BEGIN
        PERFORM scheduling.archive_availability_preset(v_new);
        RAISE EXCEPTION 'FAIL 9: the only library preset was archived';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    RESET ROLE;
    BEGIN
        UPDATE marketplace.service_blueprints SET availability_preset_id = v_maris_default WHERE id = v_maris_listing;
        RAISE EXCEPTION 'FAIL 9: a listing was bound to an archived preset';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    RAISE NOTICE 'PASS 9: archiving unbinds and names the listings, hands the default on, and keeps the last default';
    -- #endregion
END $$;

ROLLBACK;
