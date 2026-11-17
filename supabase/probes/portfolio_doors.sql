-- =============================================================================================
-- Probe: the portfolio write doors (Decision #439) — org.save_portfolio_piece and
-- org.archive_portfolio_piece, read back through org.get_profile_portfolio.
--
--   A. Create. The owner adds a piece with a forged showcase still as its cover: it is stored first in
--      the order, an empty client reads as none, and the owner's read carries it with `is_public`.
--   B. Edit. A new cover replaces the old one and retires it; an edit without a cover keeps the cover;
--      a private piece is the owner's alone (a stranger and a guest never read it).
--   C. Archive. The piece leaves every read, its cover is retired, the row stays (never deleted), and
--      a second archive or an edit of the archived piece is refused.
--   D. Refusals. A stranger and a guest (42501); a new piece with no cover; a cover that is somebody
--      else's, a library original, a video, or already a showcase slot; a blank or over-long title, an
--      over-long category; a client's profile; archiving somebody else's piece (all 22023).
--   E. Grants. Neither door is executable by anon; both are by authenticated.
--   F. Cap. The 61st live piece is refused.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/portfolio_doors.sql
--
-- Fixture (seeded): marisdelacroix (freelancer, portfolio pieces + showcase slots), inesduarte
-- (another freelancer — the stranger, and the owner of a foreign file), priyaraman (a client).
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);
CREATE TEMP TABLE probe_fails (label text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

-- Act as a user; NULL acts as a guest (no `sub`, so auth.uid() is NULL).
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config(
        'request.jwt.claims',
        CASE WHEN p_user IS NULL THEN json_build_object('role', 'anon')::text
             ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END,
        true
    );
$$;

CREATE FUNCTION pg_temp.fail(p_label text, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO probe_fails VALUES (p_label);
    RAISE NOTICE 'FAIL % — %', p_label, p_why;
END $$;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_got text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE(p_ok, false) THEN
        RAISE NOTICE 'ok   %', p_label;
    ELSE
        PERFORM pg_temp.fail(p_label, 'got ' || COALESCE(p_got, 'NULL'));
    END IF;
END $$;

-- Run the save door as the current actor: its result, or `<sqlstate> <message>` when it refuses.
CREATE FUNCTION pg_temp.save(p_type text, p_owner uuid, p_piece jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    RETURN org.save_portfolio_piece(p_type, p_owner, p_piece)::text;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.archive(p_type text, p_owner uuid, p_piece uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    RETURN org.archive_portfolio_piece(p_type, p_owner, p_piece)::text;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- Whether the current actor's portfolio read of a handle carries a piece.
CREATE FUNCTION pg_temp.reads(p_handle text, p_piece uuid) RETURNS boolean LANGUAGE sql AS $$
    SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(org.get_profile_portfolio(p_handle), '[]'::jsonb)) e
        WHERE (e ->> 'id')::uuid = p_piece
    );
$$;

-- A forged, processed showcase-pipeline file: what the media pipeline leaves before a door places it.
CREATE FUNCTION pg_temp.file(p_key text, p_owner uuid, p_purpose text, p_mime text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid := gen_random_uuid();
BEGIN
    INSERT INTO files.items (id, owner_user_id, owner_type, bucket_id, storage_path, display_name, original_name,
                             mime_type, size_bytes, status, visibility, purpose)
    VALUES (v_id, p_owner, 'user'::files.owner_kind,
            CASE WHEN p_purpose = 'showcase' THEN 'showcase' ELSE 'library' END,
            'probe/' || v_id || '/full.webp', 'Probe ' || p_key, 'probe-' || p_key,
            p_mime, 1024, 'uploaded'::files.file_status,
            CASE WHEN p_purpose = 'showcase' THEN 'public' ELSE 'private' END::files.file_visibility,
            p_purpose::files.asset_purpose);
    INSERT INTO probe_ids VALUES (p_key, v_id);
    RETURN v_id;
END $$;
-- #endregion

-- #region Fixture
INSERT INTO probe_ids
SELECT u.username, u.user_id FROM org.users_public u
WHERE u.username IN ('marisdelacroix', 'inesduarte', 'priyaraman');

DO $$
BEGIN
    IF (SELECT count(*) FROM probe_ids) <> 3 THEN
        RAISE EXCEPTION 'portfolio_doors: fixture personas missing (need marisdelacroix, inesduarte, priyaraman)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org.freelancer_profiles WHERE user_id = pg_temp.id('marisdelacroix'))
       OR EXISTS (SELECT 1 FROM org.freelancer_profiles WHERE user_id = pg_temp.id('priyaraman')) THEN
        RAISE EXCEPTION 'portfolio_doors: expected marisdelacroix to be a freelancer and priyaraman a client';
    END IF;
END $$;

SELECT pg_temp.file('cover1', pg_temp.id('marisdelacroix'), 'showcase', 'image/webp');
SELECT pg_temp.file('cover2', pg_temp.id('marisdelacroix'), 'showcase', 'image/webp');
SELECT pg_temp.file('video', pg_temp.id('marisdelacroix'), 'showcase', 'video/mp4');
SELECT pg_temp.file('original', pg_temp.id('marisdelacroix'), 'library', 'image/jpeg');
SELECT pg_temp.file('foreign', pg_temp.id('inesduarte'), 'showcase', 'image/webp');
-- #endregion

-- #region A. Create
DO $$
DECLARE
    v_mar uuid := pg_temp.id('marisdelacroix');
    v_min integer;
    r text;
    v_id uuid;
    v_row org.portfolios;
    v_first jsonb;
BEGIN
    SELECT min(sort_order) INTO v_min FROM org.portfolios WHERE user_id = v_mar AND archived_at IS NULL;
    PERFORM pg_temp.act(v_mar);
    r := pg_temp.save('user', v_mar, jsonb_build_object(
        'title', '  Probe piece  ', 'client', '', 'category', 'Probe', 'description', 'Made by a probe.',
        'is_public', true, 'cover_file_id', pg_temp.id('cover1')));
    PERFORM pg_temp.check('A the owner adds a piece', r LIKE '{%"ok": true%', r);
    v_id := (r::jsonb ->> 'id')::uuid;
    INSERT INTO probe_ids VALUES ('piece', v_id);

    SELECT * INTO v_row FROM org.portfolios WHERE id = v_id;
    PERFORM pg_temp.check('A the title is trimmed and an empty client is none',
        v_row.title = 'Probe piece' AND v_row.client_name IS NULL AND v_row.category = 'Probe', row_to_json(v_row)::text);
    PERFORM pg_temp.check('A a new piece goes first in the order',
        v_row.sort_order < COALESCE(v_min, 1), v_row.sort_order::text || ' vs ' || COALESCE(v_min::text, 'none'));

    v_first := org.get_profile_portfolio('marisdelacroix') -> 0;
    PERFORM pg_temp.check('A the owner''s read leads with it and carries is_public',
        (v_first ->> 'id')::uuid = v_id AND (v_first ->> 'is_public')::boolean, left(v_first::text, 120));
END $$;
-- #endregion

-- #region B. Edit
DO $$
DECLARE
    v_mar uuid := pg_temp.id('marisdelacroix');
    v_id uuid := pg_temp.id('piece');
    r text;
BEGIN
    PERFORM pg_temp.act(v_mar);
    r := pg_temp.save('user', v_mar, jsonb_build_object(
        'id', v_id, 'title', 'Renamed', 'is_public', false, 'cover_file_id', pg_temp.id('cover2')));
    PERFORM pg_temp.check('B the owner edits the piece and replaces its cover', r LIKE '{%"ok": true%', r);
    PERFORM pg_temp.check('B the new cover is stored',
        (SELECT cover_file_id FROM org.portfolios WHERE id = v_id) = pg_temp.id('cover2'), NULL);
    PERFORM pg_temp.check('B the replaced cover is retired',
        (SELECT deleted_at IS NOT NULL FROM files.items WHERE id = pg_temp.id('cover1')), NULL);
    PERFORM pg_temp.check('B every field is replaced (description cleared)',
        (SELECT title = 'Renamed' AND description = '' AND category IS NULL AND NOT is_public
         FROM org.portfolios WHERE id = v_id), NULL);

    r := pg_temp.save('user', v_mar, jsonb_build_object('id', v_id, 'title', 'Renamed again', 'is_public', false));
    PERFORM pg_temp.check('B an edit without a cover keeps it',
        r LIKE '{%"ok": true%' AND (SELECT cover_file_id FROM org.portfolios WHERE id = v_id) = pg_temp.id('cover2'), r);

    PERFORM pg_temp.check('B the owner reads their private piece', pg_temp.reads('marisdelacroix', v_id), NULL);
    PERFORM pg_temp.act(pg_temp.id('inesduarte'));
    PERFORM pg_temp.check('B a stranger never reads a private piece', NOT pg_temp.reads('marisdelacroix', v_id), NULL);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check('B a guest never reads a private piece', NOT pg_temp.reads('marisdelacroix', v_id), NULL);
END $$;
-- #endregion

-- #region D. Refusals (before the archive, while the piece is live)
DO $$
DECLARE
    v_mar uuid := pg_temp.id('marisdelacroix');
    v_ines uuid := pg_temp.id('inesduarte');
    v_priya uuid := pg_temp.id('priyaraman');
    v_slot uuid;
    v_new jsonb := jsonb_build_object('title', 'Refused', 'is_public', true);
    r text;
BEGIN
    PERFORM pg_temp.act(v_ines);
    r := pg_temp.save('user', v_mar, v_new || jsonb_build_object('cover_file_id', pg_temp.id('cover2')));
    PERFORM pg_temp.check('D a stranger cannot write to somebody else''s portfolio', r LIKE '42501 owner:%', r);
    r := pg_temp.archive('user', v_mar, pg_temp.id('piece'));
    PERFORM pg_temp.check('D a stranger cannot archive somebody else''s piece', r LIKE '42501 owner:%', r);
    r := pg_temp.archive('user', v_ines, pg_temp.id('piece'));
    PERFORM pg_temp.check('D nobody archives another''s piece through their own profile', r LIKE '22023 piece:%', r);

    PERFORM pg_temp.act(NULL);
    r := pg_temp.save('user', v_mar, v_new || jsonb_build_object('cover_file_id', pg_temp.id('cover2')));
    PERFORM pg_temp.check('D a guest cannot write', r LIKE '42501 owner:%', r);

    PERFORM pg_temp.act(v_mar);
    r := pg_temp.save('user', v_mar, v_new);
    PERFORM pg_temp.check('D a new piece needs a cover', r LIKE '22023 cover: choose%', r);
    r := pg_temp.save('user', v_mar, v_new || jsonb_build_object('cover_file_id', pg_temp.id('foreign')));
    PERFORM pg_temp.check('D somebody else''s file is not a cover', r LIKE '22023 cover: not a processed%', r);
    r := pg_temp.save('user', v_mar, v_new || jsonb_build_object('cover_file_id', pg_temp.id('original')));
    PERFORM pg_temp.check('D a library original is not a cover', r LIKE '22023 cover: not a processed%', r);
    r := pg_temp.save('user', v_mar, v_new || jsonb_build_object('cover_file_id', pg_temp.id('video')));
    PERFORM pg_temp.check('D a video is not a cover', r LIKE '22023 cover: a portfolio cover has to be a still%', r);

    SELECT s.file_id INTO v_slot FROM org.profile_showcase_items s
    JOIN files.items i ON i.id = s.file_id AND i.mime_type LIKE 'image/%' AND i.deleted_at IS NULL
    WHERE s.owner_type = 'user' AND s.owner_id = v_mar LIMIT 1;
    IF v_slot IS NULL THEN
        PERFORM pg_temp.fail('D a showcase slot''s file is not a cover', 'fixture has no image showcase slot');
    ELSE
        r := pg_temp.save('user', v_mar, v_new || jsonb_build_object('cover_file_id', v_slot));
        PERFORM pg_temp.check('D a showcase slot''s file is not a cover', r LIKE '22023 cover: that picture is already in use%', r);
    END IF;
    r := pg_temp.save('user', v_mar, jsonb_build_object('title', 'Twin', 'is_public', true, 'cover_file_id', pg_temp.id('cover2')));
    PERFORM pg_temp.check('D another piece''s cover is not a cover', r LIKE '22023 cover: that picture is already in use%', r);

    r := pg_temp.save('user', v_mar, jsonb_build_object('id', pg_temp.id('piece'), 'title', '   ', 'is_public', true));
    PERFORM pg_temp.check('D a blank title is refused', r LIKE '22023 title:%', r);
    r := pg_temp.save('user', v_mar, jsonb_build_object('id', pg_temp.id('piece'), 'title', repeat('t', 121), 'is_public', true));
    PERFORM pg_temp.check('D a 121-character title is refused', r LIKE '22023 title:%', r);
    r := pg_temp.save('user', v_mar, jsonb_build_object('id', pg_temp.id('piece'), 'title', 'ok', 'category', repeat('c', 61), 'is_public', true));
    PERFORM pg_temp.check('D a 61-character category is refused', r LIKE '22023 category:%', r);
    r := pg_temp.save('user', v_mar, jsonb_build_object('id', pg_temp.id('piece'), 'title', 'ok', 'description', repeat('d', 2001), 'is_public', true));
    PERFORM pg_temp.check('D a 2,001-character description is refused', r LIKE '22023 description:%', r);
    r := pg_temp.save('user', v_mar, jsonb_build_object('id', gen_random_uuid(), 'title', 'ok', 'is_public', true));
    PERFORM pg_temp.check('D an id that is not theirs is refused', r LIKE '22023 piece:%', r);

    PERFORM pg_temp.act(v_priya);
    r := pg_temp.save('user', v_priya, v_new || jsonb_build_object('cover_file_id', pg_temp.id('cover2')));
    PERFORM pg_temp.check('D a client''s profile has no portfolio', r LIKE '22023 owner: only a freelancer%', r);
END $$;
-- #endregion

-- #region C. Archive
DO $$
DECLARE
    v_mar uuid := pg_temp.id('marisdelacroix');
    v_id uuid := pg_temp.id('piece');
    r text;
BEGIN
    PERFORM pg_temp.act(v_mar);
    r := pg_temp.archive('user', v_mar, v_id);
    PERFORM pg_temp.check('C the owner archives the piece', r LIKE '{%"ok": true%', r);
    PERFORM pg_temp.check('C the row stays, stamped archived',
        (SELECT archived_at IS NOT NULL FROM org.portfolios WHERE id = v_id), NULL);
    PERFORM pg_temp.check('C its cover is retired',
        (SELECT deleted_at IS NOT NULL FROM files.items WHERE id = pg_temp.id('cover2')), NULL);
    PERFORM pg_temp.check('C it leaves even the owner''s read', NOT pg_temp.reads('marisdelacroix', v_id), NULL);
    r := pg_temp.archive('user', v_mar, v_id);
    PERFORM pg_temp.check('C a second archive is refused', r LIKE '22023 piece:%', r);
    r := pg_temp.save('user', v_mar, jsonb_build_object('id', v_id, 'title', 'Back', 'is_public', true));
    PERFORM pg_temp.check('C an archived piece cannot be edited', r LIKE '22023 piece:%', r);
END $$;
-- #endregion

-- #region E. Grants
DO $$
BEGIN
    PERFORM pg_temp.check('E anon cannot execute either door',
        NOT has_function_privilege('anon', 'org.save_portfolio_piece(text,uuid,jsonb)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'org.archive_portfolio_piece(text,uuid,uuid)', 'EXECUTE'), NULL);
    PERFORM pg_temp.check('E authenticated executes both doors',
        has_function_privilege('authenticated', 'org.save_portfolio_piece(text,uuid,jsonb)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'org.archive_portfolio_piece(text,uuid,uuid)', 'EXECUTE'), NULL);
END $$;
-- #endregion

-- #region F. Cap
DO $$
DECLARE
    v_mar uuid := pg_temp.id('marisdelacroix');
    v_live integer;
    r text;
BEGIN
    SELECT count(*) INTO v_live FROM org.portfolios WHERE user_id = v_mar AND archived_at IS NULL;
    INSERT INTO org.portfolios (user_id, title, description, is_public, sort_order)
    SELECT v_mar, 'Filler ' || g, '', true, 1000 + g FROM generate_series(1, 60 - v_live) g;
    PERFORM pg_temp.act(v_mar);
    r := pg_temp.save('user', v_mar, jsonb_build_object(
        'title', 'One too many', 'is_public', true,
        'cover_file_id', pg_temp.file('cover3', v_mar, 'showcase', 'image/webp')));
    PERFORM pg_temp.check('F the 61st live piece is refused', r LIKE '22023 piece: up to 60%', r);
END $$;
-- #endregion

-- #region Verdict
DO $$
DECLARE
    v_n int := (SELECT count(*) FROM probe_fails);
BEGIN
    IF v_n > 0 THEN
        RAISE EXCEPTION 'portfolio_doors: % failure(s): %', v_n, (SELECT string_agg(label, '; ') FROM probe_fails);
    END IF;
    RAISE NOTICE 'portfolio_doors: all checks passed';
END $$;
-- #endregion

ROLLBACK;
