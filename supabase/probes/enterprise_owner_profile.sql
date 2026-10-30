-- =============================================================================================
-- Probe: every natural person has a profile, the enterprise owner included (Decision #336, ruling I2;
-- IW-H2, IW-M7). public.create_enterprise provisions the owner's org.users_public row in the same
-- transaction as the enterprise:
--
--   * an adult owner → a private profile with their date of birth, the corporate email as the
--     primary address, the owner seat, a session pointed at the enterprise, preferences seeded from
--     the identity's sign-up hints, and a token that says onboarded with boolean isClient and
--     isFreelancer (Decision #87 (c));
--   * the owner can leave the enterprise context and switch back. security.session_context keys onto
--     org.users_public, so a profile-less owner's switch and clear both failed 23503 (IW-M7);
--   * under 13 → PM422, aged 15 → PM403, and either way nothing is written;
--   * a taken owner handle → 23505 with nothing written, so the service's retry on the next
--     alternative goes through on the same identity; an enterprise handle equal to the owner's is
--     taken too.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/enterprise_owner_profile.sql
--
-- A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_got text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FAIL % — got %', p_label, p_got;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- The claims the access-token hook would mint for p_user.
CREATE FUNCTION pg_temp.mint(p_user uuid) RETURNS jsonb LANGUAGE sql AS $$
    SELECT public.custom_access_token_hook(jsonb_build_object(
        'user_id', p_user, 'claims', jsonb_build_object('sub', p_user, 'app_metadata', '{}'::jsonb)))->'claims';
$$;

-- A GoTrue identity as AuthBackendService creates an owner's: only the sign-up hints in its metadata.
CREATE FUNCTION pg_temp.identity(p_email text) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data)
    VALUES (gen_random_uuid(), p_email, 'authenticated', 'authenticated',
            jsonb_build_object('objective', 'enterprise', 'locale', 'ja-JP', 'display_currency', 'JPY'))
    RETURNING id;
$$;

-- The create_enterprise payload AuthBackendService sends: the enterprise and its owner.
CREATE FUNCTION pg_temp.payload(p_handle text, p_email text, p_username text, p_age integer) RETURNS jsonb
LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'legalName', 'Owner Probe ' || p_handle || ' Ltd', 'handle', p_handle, 'corporateEmail', p_email,
        'owner', jsonb_build_object(
            'firstName', 'Ada', 'lastName', 'Probe', 'username', p_username,
            'dob', (CURRENT_DATE - make_interval(years => p_age))::date, 'timeZone', 'Asia/Tokyo'));
$$;

-- What was written for p_user beyond its GoTrue identity: '' when nothing.
CREATE FUNCTION pg_temp.traces(p_user uuid) RETURNS text LANGUAGE sql AS $$
    SELECT concat_ws(', ',
        CASE WHEN EXISTS (SELECT 1 FROM org.users_public WHERE user_id = p_user) THEN 'users_public' END,
        CASE WHEN EXISTS (SELECT 1 FROM org.user_emails WHERE user_id = p_user) THEN 'user_emails' END,
        CASE WHEN EXISTS (SELECT 1 FROM org.user_preferences WHERE user_id = p_user) THEN 'user_preferences' END,
        CASE WHEN EXISTS (SELECT 1 FROM security.session_context WHERE user_id = p_user) THEN 'session_context' END,
        CASE WHEN EXISTS (SELECT 1 FROM org.enterprises WHERE owner_user_id = p_user) THEN 'enterprises' END,
        CASE WHEN EXISTS (SELECT 1 FROM org.enterprise_members WHERE user_id = p_user) THEN 'enterprise_members' END,
        CASE WHEN EXISTS (SELECT 1 FROM security.audit_logs WHERE user_id = p_user) THEN 'audit_logs' END);
$$;

CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid, handle text);

-- #region An adult owner
DO $$
DECLARE
    v_tag text := substr(md5(random()::text), 1, 8);
    v_email text := 'owner-probe-' || v_tag || '@projective.invalid';
    v_owner uuid := pg_temp.identity(v_email);
    v_username text := 'ada-probe-' || v_tag;
    v_ent uuid;
    v_up org.users_public%ROWTYPE;
    v_sc security.session_context%ROWTYPE;
    v_claims jsonb;
BEGIN
    v_ent := public.create_enterprise(v_owner, pg_temp.payload('owner-probe-' || v_tag, v_email, v_username, 30));
    INSERT INTO probe_ids VALUES ('OWNER', v_owner, v_username), ('ENT', v_ent, 'owner-probe-' || v_tag);

    SELECT * INTO v_up FROM org.users_public WHERE user_id = v_owner;
    PERFORM pg_temp.check('an adult owner gets a profile: name, DoB and zone, the handle, private, a client',
        v_up.dob = (CURRENT_DATE - interval '30 years')::date AND v_up.timezone = 'Asia/Tokyo'
        AND v_up.first_name = 'Ada' AND v_up.last_name = 'Probe' AND v_up.username = v_username
        AND v_up.visibility = 'private' AND NOT v_up.is_freelancer,
        row_to_json(v_up)::text);
    PERFORM pg_temp.check('the corporate email is the owner''s primary address',
        EXISTS (SELECT 1 FROM org.user_emails e WHERE e.user_id = v_owner AND e.is_primary AND e.email = v_email),
        (SELECT string_agg(e.email, ', ') FROM org.user_emails e WHERE e.user_id = v_owner));
    PERFORM pg_temp.check('the owner holds the owner seat',
        EXISTS (SELECT 1 FROM org.enterprise_members m
                 WHERE m.enterprise_id = v_ent AND m.user_id = v_owner AND m.role = 'owner' AND m.status = 'active'),
        'no seat');

    SELECT * INTO v_sc FROM security.session_context WHERE user_id = v_owner;
    PERFORM pg_temp.check('the owner''s session points at the enterprise',
        v_sc.active_enterprise_id = v_ent AND num_nonnulls(v_sc.active_profile_id, v_sc.active_team_id) = 0,
        row_to_json(v_sc)::text);
    PERFORM pg_temp.check('the profile seeders cover the owner, from the identity''s hints (ja-JP · JPY · Asia/Tokyo)',
        EXISTS (SELECT 1 FROM org.user_preferences p
                 WHERE p.user_id = v_owner AND p.locale = 'ja-JP' AND p.preferred_display_currency = 'JPY')
        AND EXISTS (SELECT 1 FROM comms.notification_prefs n
                     WHERE n.user_id = v_owner AND n.locale = 'ja-JP' AND n.timezone = 'Asia/Tokyo'),
        (SELECT concat_ws(' / ', p.locale, p.preferred_display_currency) FROM org.user_preferences p WHERE p.user_id = v_owner));

    v_claims := pg_temp.mint(v_owner);
    PERFORM pg_temp.check('the first token carries the enterprise, onboarded, with boolean persona claims (#87 (c))',
        v_claims->>'active_enterprise_id' = v_ent::text
        AND v_claims #>> '{app_metadata,active_context,type}' = 'enterprise'
        AND v_claims #> '{app_metadata,active_context,onboarded}' = 'true'::jsonb
        AND v_claims #> '{app_metadata,active_context,isClient}' = 'true'::jsonb
        AND v_claims #> '{app_metadata,active_context,isFreelancer}' = 'false'::jsonb,
        (v_claims #> '{app_metadata,active_context}')::text);
END $$;
-- #endregion

-- #region IW-M7: the owner holds and leaves the enterprise context
DO $$
DECLARE
    v_owner uuid := (SELECT id FROM probe_ids WHERE k = 'OWNER');
    v_ent uuid := (SELECT id FROM probe_ids WHERE k = 'ENT');
    v_claims jsonb;
BEGIN
    PERFORM pg_temp.act(v_owner);
    PERFORM security.clear_session_context();
    v_claims := pg_temp.mint(v_owner);
    PERFORM pg_temp.check('clear_session_context takes the owner to their personal context',
        jsonb_typeof(v_claims->'active_enterprise_id') = 'null'
        AND v_claims #>> '{app_metadata,active_context,type}' = 'personal'
        AND v_claims #>> '{app_metadata,active_context,handle}' = (SELECT handle FROM probe_ids WHERE k = 'OWNER'),
        (v_claims #> '{app_metadata,active_context}')::text);

    PERFORM security.switch_enterprise_context(v_ent);
    v_claims := pg_temp.mint(v_owner);
    PERFORM pg_temp.check('switch_enterprise_context takes them back into the enterprise',
        v_claims->>'active_enterprise_id' = v_ent::text
        AND v_claims #>> '{app_metadata,active_context,type}' = 'enterprise'
        AND v_claims #>> '{app_metadata,active_context,role}' = 'admin',
        (v_claims #> '{app_metadata,active_context}')::text);
    PERFORM set_config('request.jwt.claims', '', true);
END $$;
-- #endregion

-- #region Minors: refused, nothing written
DO $$
DECLARE
    v_case record;
    v_tag text;
    v_email text;
    v_owner uuid;
BEGIN
    FOR v_case IN SELECT * FROM (VALUES (12, 'PM422'), (15, 'PM403')) AS c (age, code) LOOP
        v_tag := substr(md5(random()::text), 1, 8);
        v_email := 'minor-probe-' || v_tag || '@projective.invalid';
        v_owner := pg_temp.identity(v_email);
        BEGIN
            PERFORM public.create_enterprise(v_owner,
                pg_temp.payload('minor-probe-' || v_tag, v_email, 'minor-owner-' || v_tag, v_case.age));
            RAISE EXCEPTION 'FAIL an owner aged % opened an enterprise', v_case.age;
        EXCEPTION WHEN OTHERS THEN
            IF SQLSTATE <> v_case.code THEN
                RAISE;
            END IF;
        END;
        PERFORM pg_temp.check(format('an owner aged %s is refused %s and nothing is written', v_case.age, v_case.code),
            pg_temp.traces(v_owner) = '', pg_temp.traces(v_owner));
    END LOOP;
END $$;
-- #endregion

-- #region The owner's handle shares the one namespace
DO $$
DECLARE
    v_tag text := substr(md5(random()::text), 1, 8);
    v_email text := 'taken-probe-' || v_tag || '@projective.invalid';
    v_owner uuid := pg_temp.identity(v_email);
    v_taken text := (SELECT handle FROM probe_ids WHERE k = 'OWNER');
    v_twin uuid;
BEGIN
    BEGIN
        PERFORM public.create_enterprise(v_owner, pg_temp.payload('taken-probe-' || v_tag, v_email, v_taken, 30));
        RAISE EXCEPTION 'FAIL a taken owner handle was accepted';
    EXCEPTION WHEN unique_violation THEN
        PERFORM pg_temp.check('a taken owner handle is refused 23505 and nothing is written',
            pg_temp.traces(v_owner) = '', pg_temp.traces(v_owner));
    END;

    -- The service retries once, on the first of handleAlternatives (`-hq`), with the same identity.
    PERFORM public.create_enterprise(v_owner, pg_temp.payload('taken-probe-' || v_tag, v_email, v_taken || '-hq', 30));
    PERFORM pg_temp.check('the retry on the next alternative goes through',
        (SELECT u.username FROM org.users_public u WHERE u.user_id = v_owner) = v_taken || '-hq',
        (SELECT u.username FROM org.users_public u WHERE u.user_id = v_owner));

    v_twin := pg_temp.identity('twin-probe-' || v_tag || '@projective.invalid');
    BEGIN
        PERFORM public.create_enterprise(v_twin,
            pg_temp.payload('twin-probe-' || v_tag, 'twin-probe-' || v_tag || '@projective.invalid', 'twin-probe-' || v_tag, 30));
        RAISE EXCEPTION 'FAIL an enterprise took its owner''s handle';
    EXCEPTION WHEN unique_violation THEN
        PERFORM pg_temp.check('an enterprise handle equal to its owner''s is refused 23505 and nothing is written',
            pg_temp.traces(v_twin) = '', pg_temp.traces(v_twin));
    END;
END $$;
-- #endregion

ROLLBACK;
