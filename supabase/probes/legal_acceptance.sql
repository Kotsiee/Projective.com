-- =============================================================================================
-- Probe: sign-up records which Terms, Acceptable Use and Privacy versions a person accepted or was
-- shown (Decision #446), inside the transaction that creates their profile.
--
--   * an email sign-up (public.handle_new_user), an OAuth completion (public.complete_onboarding), an
--     enterprise sign-up (public.create_enterprise) and a profile-less owner finishing step 1.6 each
--     write exactly three rows at today's versions: terms + acceptable-use `accepted`, privacy `shown`,
--     on the surface of the door, and the owner's on behalf of the enterprise;
--   * a missing stamp or a forged version (one not in effect) is refused 22023 and writes nothing —
--     no profile, no enterprise, no acceptance;
--   * an under-13 date of birth writes nothing at all;
--   * a client cannot INSERT, UPDATE or DELETE a row, nor call the recorder; it reads only its own
--     rows; even the table owner cannot rewrite one (append-only);
--   * a material new version makes the person due (org.fn_needs_reacceptance, the token's `termsDue`)
--     until public.accept_current_terms records it; a non-material one does not; a person with no
--     record is due; no seeded persona is due.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/legal_acceptance.sql
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

CREATE FUNCTION pg_temp.mint(p_user uuid) RETURNS jsonb LANGUAGE sql AS $$
    SELECT public.custom_access_token_hook(jsonb_build_object(
        'user_id', p_user, 'claims', jsonb_build_object('sub', p_user, 'app_metadata', '{}'::jsonb)))->'claims';
$$;

-- The stamp AuthBackendService sends: every sign-up document at the version in effect today.
CREATE FUNCTION pg_temp.stamp() RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'terms', org.fn_current_legal_version('terms'),
        'acceptable-use', org.fn_current_legal_version('acceptable-use'),
        'privacy', org.fn_current_legal_version('privacy'));
$$;

-- What p_user's rows say, in a stable order: `slug version kind surface enterprise?`.
CREATE FUNCTION pg_temp.rows(p_user uuid) RETURNS text LANGUAGE sql AS $$
    SELECT coalesce(string_agg(
        concat_ws(' ', a.document_slug, a.version, a.kind, a.surface, CASE WHEN a.enterprise_id IS NOT NULL THEN 'ent' END),
        ', ' ORDER BY a.document_slug), '')
      FROM org.legal_acceptances a WHERE a.user_id = p_user;
$$;

-- The three rows a sign-up on p_surface must leave, at today's versions.
CREATE FUNCTION pg_temp.expected(p_surface text, p_ent boolean DEFAULT false) RETURNS text LANGUAGE sql AS $$
    SELECT concat_ws(', ',
        concat_ws(' ', 'acceptable-use', org.fn_current_legal_version('acceptable-use'), 'accepted', p_surface, CASE WHEN p_ent THEN 'ent' END),
        concat_ws(' ', 'privacy', org.fn_current_legal_version('privacy'), 'shown', p_surface, CASE WHEN p_ent THEN 'ent' END),
        concat_ws(' ', 'terms', org.fn_current_legal_version('terms'), 'accepted', p_surface, CASE WHEN p_ent THEN 'ent' END));
$$;

-- An email sign-up as AuthBackendService.provisionAccount makes it: the onboarding metadata on the
-- GoTrue identity, which public.handle_new_user provisions from. `p_legal` NULL leaves the stamp out.
CREATE FUNCTION pg_temp.email_signup(p_tag text, p_age integer, p_legal jsonb) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'legal-' || p_tag || '@projective.invalid', 'authenticated', 'authenticated',
            jsonb_strip_nulls(jsonb_build_object(
                'first_name', 'Lex', 'last_name', 'Probe', 'username', 'lex-' || p_tag,
                'dob', (CURRENT_DATE - make_interval(years => p_age))::date, 'timezone', 'UTC',
                'objective', 'client', 'legal_acceptance', p_legal)))
    RETURNING id;
$$;

-- A GoTrue identity with no profile (an OAuth landing, or an owner created before step 1.6).
CREATE FUNCTION pg_temp.bare_identity(p_tag text) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'legal-' || p_tag || '@projective.invalid', 'authenticated', 'authenticated', '{}'::jsonb)
    RETURNING id;
$$;

CREATE FUNCTION pg_temp.onboarding(p_tag text, p_age integer, p_legal jsonb) RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'first_name', 'Lex', 'last_name', 'Probe', 'username', 'lex-' || p_tag,
        'dob', (CURRENT_DATE - make_interval(years => p_age))::date, 'timezone', 'UTC',
        'objective', 'client', 'legal_acceptance', p_legal));
$$;

CREATE FUNCTION pg_temp.enterprise(p_tag text, p_legal jsonb) RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'legalName', 'Legal Probe ' || p_tag || ' Ltd', 'handle', 'legal-ent-' || p_tag,
        'corporateEmail', 'legal-' || p_tag || '@projective.invalid',
        'owner', jsonb_build_object('firstName', 'Lex', 'lastName', 'Probe', 'username', 'lex-' || p_tag,
            'dob', (CURRENT_DATE - interval '40 years')::date, 'timeZone', 'UTC'),
        'legalAcceptance', p_legal));
$$;

CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

-- #region The sign-up doors
DO $$
DECLARE
    v_tag text := substr(md5(random()::text), 1, 8);
    v_user uuid := pg_temp.email_signup(v_tag, 30, pg_temp.stamp());
BEGIN
    INSERT INTO probe_ids VALUES ('EMAIL', v_user);
    PERFORM pg_temp.check('an email sign-up writes three rows at today''s versions, surface join',
        pg_temp.rows(v_user) = pg_temp.expected('join'), pg_temp.rows(v_user));
END $$;

DO $$
DECLARE
    v_tag text := substr(md5(random()::text), 1, 8);
    v_user uuid := pg_temp.bare_identity(v_tag);
BEGIN
    PERFORM pg_temp.act(v_user);
    PERFORM public.complete_onboarding(pg_temp.onboarding(v_tag, 30, pg_temp.stamp()));
    PERFORM pg_temp.check('an OAuth completion writes three rows at today''s versions, surface join_oauth',
        pg_temp.rows(v_user) = pg_temp.expected('join_oauth'), pg_temp.rows(v_user));
END $$;

DO $$
DECLARE
    v_tag text := substr(md5(random()::text), 1, 8);
    v_owner uuid := pg_temp.bare_identity(v_tag);
    v_ent uuid;
BEGIN
    v_ent := public.create_enterprise(v_owner, pg_temp.enterprise(v_tag, pg_temp.stamp()));
    PERFORM pg_temp.check('an enterprise sign-up writes three rows for the enterprise, surface join_enterprise',
        pg_temp.rows(v_owner) = pg_temp.expected('join_enterprise', true)
        AND NOT EXISTS (SELECT 1 FROM org.legal_acceptances a
                         WHERE a.user_id = v_owner AND a.enterprise_id IS DISTINCT FROM v_ent),
        pg_temp.rows(v_owner));
END $$;

DO $$
DECLARE
    v_tag text := substr(md5(random()::text), 1, 8);
    v_owner uuid := pg_temp.bare_identity(v_tag);
    v_ent uuid;
BEGIN
    -- An owner whose enterprise predates step 1.6: an enterprise row and no profile.
    INSERT INTO org.enterprises (owner_user_id, legal_name, handle, corporate_email, default_currency)
    VALUES (v_owner, 'Legacy ' || v_tag, 'legal-legacy-' || v_tag, 'legal-' || v_tag || '@projective.invalid', 'USD')
    RETURNING id INTO v_ent;
    PERFORM pg_temp.act(v_owner);
    PERFORM public.complete_onboarding(pg_temp.onboarding(v_tag, 40, pg_temp.stamp()));
    PERFORM pg_temp.check('a profile-less owner finishing step 1.6 accepts for their enterprise',
        pg_temp.rows(v_owner) = pg_temp.expected('join_enterprise', true)
        AND (SELECT bool_and(a.enterprise_id = v_ent) FROM org.legal_acceptances a WHERE a.user_id = v_owner),
        pg_temp.rows(v_owner));
END $$;
-- #endregion

-- #region Refusals write nothing
DO $$
DECLARE
    v_tag text := substr(md5(random()::text), 1, 8);
    v_code text := 'none';
BEGIN
    BEGIN
        PERFORM pg_temp.email_signup(v_tag, 30, NULL);
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
    END;
    PERFORM pg_temp.check('an email sign-up without the stamp is refused 22023, and no identity or profile stays',
        v_code = '22023'
        AND NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'legal-' || v_tag || '@projective.invalid')
        AND NOT EXISTS (SELECT 1 FROM org.users_public WHERE username = 'lex-' || v_tag),
        v_code);

    v_code := 'none';
    BEGIN
        PERFORM pg_temp.email_signup(v_tag, 30, pg_temp.stamp() || jsonb_build_object('terms', '1.0'));
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
    END;
    PERFORM pg_temp.check('a forged Terms version (one not in effect) is refused 22023 and writes nothing',
        v_code = '22023' AND NOT EXISTS (SELECT 1 FROM org.users_public WHERE username = 'lex-' || v_tag),
        v_code);

    v_code := 'none';
    BEGIN
        PERFORM pg_temp.email_signup(v_tag, 30, pg_temp.stamp() || jsonb_build_object('privacy', '9.9'));
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
    END;
    PERFORM pg_temp.check('a version that was never published is refused 22023 too', v_code = '22023', v_code);
END $$;

DO $$
DECLARE
    v_tag text := substr(md5(random()::text), 1, 8);
    v_owner uuid := pg_temp.bare_identity(v_tag);
    v_code text := 'none';
BEGIN
    BEGIN
        PERFORM public.create_enterprise(v_owner, pg_temp.enterprise(v_tag, NULL));
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
    END;
    PERFORM pg_temp.check('an enterprise sign-up without the stamp writes no profile, enterprise or acceptance',
        v_code = '22023'
        AND NOT EXISTS (SELECT 1 FROM org.users_public WHERE user_id = v_owner)
        AND NOT EXISTS (SELECT 1 FROM org.enterprises WHERE owner_user_id = v_owner)
        AND pg_temp.rows(v_owner) = '',
        v_code);
END $$;

DO $$
DECLARE
    v_tag text := substr(md5(random()::text), 1, 8);
    v_user uuid := pg_temp.bare_identity(v_tag);
    v_code text := 'none';
BEGIN
    PERFORM pg_temp.act(v_user);
    BEGIN
        PERFORM public.complete_onboarding(pg_temp.onboarding(v_tag, 30, pg_temp.stamp() || jsonb_build_object('acceptable-use', '0.9')));
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
    END;
    PERFORM pg_temp.check('an OAuth completion with a forged version is refused and stays profile-less',
        v_code = '22023' AND NOT EXISTS (SELECT 1 FROM org.users_public WHERE user_id = v_user)
        AND pg_temp.rows(v_user) = '',
        v_code);
END $$;

DO $$
DECLARE
    v_tag text := substr(md5(random()::text), 1, 8);
    v_user uuid := pg_temp.bare_identity(v_tag);
    v_email_code text := 'none';
    v_oauth_code text := 'none';
BEGIN
    BEGIN
        PERFORM pg_temp.email_signup(v_tag || 'e', 11, pg_temp.stamp());
    EXCEPTION WHEN OTHERS THEN v_email_code := SQLSTATE;
    END;
    PERFORM pg_temp.act(v_user);
    BEGIN
        PERFORM public.complete_onboarding(pg_temp.onboarding(v_tag, 11, pg_temp.stamp()));
    EXCEPTION WHEN OTHERS THEN v_oauth_code := SQLSTATE;
    END;
    PERFORM pg_temp.check('an under-13 sign-up, email or OAuth, is refused PM422 and records no acceptance',
        v_email_code = 'PM422' AND v_oauth_code = 'PM422'
        AND NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'legal-' || v_tag || 'e@projective.invalid')
        AND pg_temp.rows(v_user) = '',
        v_email_code || ' / ' || v_oauth_code);
END $$;
-- #endregion

-- #region A client reads its own rows and writes none
DO $$
DECLARE
    v_user uuid := (SELECT id FROM probe_ids WHERE k = 'EMAIL');
    v_other uuid := (SELECT a.user_id FROM org.legal_acceptances a WHERE a.user_id <> v_user LIMIT 1);
    v_own integer;
    v_theirs integer;
    v_insert text := 'none';
    v_update text := 'none';
    v_delete text := 'none';
    v_record text := 'none';
    v_version text := org.fn_current_legal_version('terms');
    v_stamp jsonb := pg_temp.stamp();
BEGIN
    PERFORM pg_temp.act(v_user);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_own FROM org.legal_acceptances WHERE user_id = v_user;
    SELECT count(*) INTO v_theirs FROM org.legal_acceptances WHERE user_id = v_other;
    BEGIN
        INSERT INTO org.legal_acceptances (user_id, document_slug, version, kind, surface)
        VALUES (v_user, 'terms', v_version, 'accepted', 'reaccept');
    EXCEPTION WHEN OTHERS THEN v_insert := SQLSTATE;
    END;
    BEGIN
        UPDATE org.legal_acceptances SET version = '1.0' WHERE user_id = v_user;
    EXCEPTION WHEN OTHERS THEN v_update := SQLSTATE;
    END;
    BEGIN
        DELETE FROM org.legal_acceptances WHERE user_id = v_user;
    EXCEPTION WHEN OTHERS THEN v_delete := SQLSTATE;
    END;
    BEGIN
        PERFORM org.fn_record_legal_acceptance(v_user, v_stamp, 'reaccept');
    EXCEPTION WHEN OTHERS THEN v_record := SQLSTATE;
    END;
    RESET ROLE;

    PERFORM pg_temp.check('a person reads their own three rows and nobody else''s',
        v_own = 3 AND v_theirs = 0, v_own || ' / ' || v_theirs);
    PERFORM pg_temp.check('a client cannot INSERT, UPDATE or DELETE a row, nor call the recorder (42501)',
        v_insert = '42501' AND v_update = '42501' AND v_delete = '42501' AND v_record = '42501',
        concat_ws(' / ', v_insert, v_update, v_delete, v_record));
    PERFORM pg_temp.check('the rows are untouched', pg_temp.rows(v_user) = pg_temp.expected('join'), pg_temp.rows(v_user));
END $$;

DO $$
DECLARE
    v_user uuid := (SELECT id FROM probe_ids WHERE k = 'EMAIL');
    v_update text := 'none';
    v_delete text := 'none';
BEGIN
    BEGIN
        UPDATE org.legal_acceptances SET surface = 'reaccept' WHERE user_id = v_user;
    EXCEPTION WHEN OTHERS THEN v_update := SQLSTATE;
    END;
    BEGIN
        DELETE FROM org.legal_acceptances WHERE user_id = v_user;
    EXCEPTION WHEN OTHERS THEN v_delete := SQLSTATE;
    END;
    PERFORM pg_temp.check('even the table owner cannot rewrite or remove the evidence (append-only, 55000)',
        v_update = '55000' AND v_delete = '55000', v_update || ' / ' || v_delete);
END $$;
-- #endregion

-- #region Seeded personas
DO $$
DECLARE
    v_due text;
BEGIN
    SELECT string_agg(u.username, ', ') INTO v_due
      FROM org.users_public u
      JOIN org.user_emails e ON e.user_id = u.user_id AND e.is_primary
     WHERE e.email LIKE '%@projective.dev'
       AND org.fn_needs_reacceptance(u.user_id);
    PERFORM pg_temp.check('no seeded persona meets the re-accept gate', v_due IS NULL, v_due);
END $$;
-- #endregion

-- #region A material new version, and the re-accept door
DO $$
DECLARE
    v_user uuid := (SELECT id FROM probe_ids WHERE k = 'EMAIL');
    v_next text;
    v_stamp jsonb;
    v_written integer;
    v_code text := 'none';
BEGIN
    PERFORM pg_temp.check('a person who accepted today''s versions is not due',
        NOT org.fn_needs_reacceptance(v_user)
        AND pg_temp.mint(v_user) #> '{app_metadata,active_context,termsDue}' = 'false'::jsonb,
        (pg_temp.mint(v_user) #> '{app_metadata,active_context}')::text);

    -- A non-material version in effect relies on the continued-use clause.
    v_next := (org.fn_legal_version_key(org.fn_current_legal_version('terms')))[1] + 1 || '.0';
    INSERT INTO org.legal_document_versions (slug, version, effective_date, material)
    VALUES ('terms', v_next, CURRENT_DATE, false);
    PERFORM pg_temp.check('a non-material new version does not make anyone due',
        NOT org.fn_needs_reacceptance(v_user), 'due');
    PERFORM pg_temp.check('the new version is the one in effect today',
        org.fn_current_legal_version('terms') = v_next, org.fn_current_legal_version('terms'));

    UPDATE org.legal_document_versions SET material = true WHERE slug = 'terms' AND version = v_next;
    PERFORM pg_temp.check('a material new version in effect makes the person due, in the database and the token',
        org.fn_needs_reacceptance(v_user)
        AND pg_temp.mint(v_user) #> '{app_metadata,active_context,termsDue}' = 'true'::jsonb,
        (pg_temp.mint(v_user) #> '{app_metadata,active_context}')::text);

    v_stamp := pg_temp.stamp();
    PERFORM pg_temp.act(v_user);
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM public.accept_current_terms(v_stamp || jsonb_build_object('terms', '2.0'));
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
    END;
    v_written := public.accept_current_terms(v_stamp);
    RESET ROLE;

    PERFORM pg_temp.check('re-accepting with a stale version is refused 22023', v_code = '22023', v_code);
    PERFORM pg_temp.check('re-accepting records only the new Terms version, surface reaccept',
        v_written = 1
        AND EXISTS (SELECT 1 FROM org.legal_acceptances a
                     WHERE a.user_id = v_user AND a.document_slug = 'terms' AND a.version = v_next
                       AND a.kind = 'accepted' AND a.surface = 'reaccept' AND a.enterprise_id IS NULL),
        v_written::text || ' — ' || pg_temp.rows(v_user));
    PERFORM pg_temp.check('once accepted, the person is no longer due',
        NOT org.fn_needs_reacceptance(v_user)
        AND pg_temp.mint(v_user) #> '{app_metadata,active_context,termsDue}' = 'false'::jsonb,
        'still due');
END $$;

DO $$
DECLARE
    v_user uuid := gen_random_uuid();
    v_tag text := substr(md5(random()::text), 1, 8);
    v_code text := 'none';
BEGIN
    -- A profile that reached the table without any sign-up door (a hand-made account).
    INSERT INTO auth.users (id, email, aud, role) VALUES (v_user, 'legal-' || v_tag || '@projective.invalid', 'authenticated', 'authenticated');
    INSERT INTO org.users_public (user_id, username, first_name, last_name, dob)
    VALUES (v_user, 'lex-bare-' || v_tag, 'Lex', 'Bare', (CURRENT_DATE - interval '30 years')::date);
    PERFORM pg_temp.check('a person with no acceptance on record is due', org.fn_needs_reacceptance(v_user), 'not due');

    PERFORM pg_temp.act(gen_random_uuid());
    BEGIN
        PERFORM public.accept_current_terms(pg_temp.stamp());
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
    END;
    PERFORM pg_temp.check('the re-accept door refuses an account with no profile (42501)', v_code = '42501', v_code);
END $$;

-- #endregion

ROLLBACK;
