-- =============================================================================================
-- Probe: a seller's tax residence certificate (00001200 "Seller tax documents", LEGAL LG6; Decision
-- #527) — a private upload the seller marks, and shows to exactly one client party at a time.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/seller_tax_documents.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. The fixture is a seeded
-- freelancer on two projects whose clients differ, a co-worker, a stranger and one uploaded file.
--
--   1  grants and shape: three definers with a pinned search_path that authenticated may call and anon
--      may not; the two internal helpers no client role may call
--   2  marking: the seller marks their own uploaded file and it stays private, read by them alone; a
--      stranger cannot mark it, a file still uploading cannot be marked, and nobody can forge the mark
--      by writing the file's metadata
--   3  sharing: the targets are the seller's clients; a share reaches the chosen client and nobody
--      else (not the stranger, not a co-worker, not the other client); a second share replaces the
--      first; a project the seller is not on, or is the client of, is refused; no project makes it
--      private again
--   4  the list is the caller's own: another person sees none of it
-- =============================================================================================

BEGIN;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region 0. Fixtures and helpers (as postgres)
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_user IS NULL THEN
        PERFORM set_config('role', 'postgres', true);
        PERFORM set_config('request.jwt.claims', '', true);
    ELSE
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
        PERFORM set_config('role', 'authenticated', true);
    END IF;
END $$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- The SQLSTATE p_sql raises when run as p_user ('' when it succeeds).
CREATE FUNCTION pg_temp.state_of(p_user uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text := '';
BEGIN
    PERFORM pg_temp.act(p_user);
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        v := SQLSTATE;
    END;
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

-- p_sql's jsonb answer when run as p_user.
CREATE FUNCTION pg_temp.as_user(p_user uuid, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
    PERFORM pg_temp.act(p_user);
    EXECUTE p_sql INTO v;
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

-- Whether p_user may read the file, by the files schema's own rule.
CREATE FUNCTION pg_temp.reads(p_user uuid, p_file uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v boolean;
BEGIN
    PERFORM pg_temp.act(p_user);
    v := files.fn_can_read(p_file);
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

DO $$
DECLARE
    v_seller uuid; v_p1 uuid; v_p2 uuid; v_c1 uuid; v_c2 uuid; v_mate uuid; v_stranger uuid;
    v_off uuid; v_own uuid; v_file uuid; v_pending uuid;
BEGIN
    SELECT pp.profile_id INTO v_seller
      FROM projects.project_participants pp JOIN projects.projects p ON p.id = pp.project_id
     WHERE pp.profile_type = 'freelancer' AND COALESCE(p.client_user_id, p.owner_user_id) <> pp.profile_id
     GROUP BY pp.profile_id
    HAVING count(DISTINCT COALESCE(p.client_user_id, p.owner_user_id)) >= 2
     ORDER BY count(DISTINCT p.id) DESC, pp.profile_id LIMIT 1;
    SELECT p.id, COALESCE(p.client_user_id, p.owner_user_id) INTO v_p1, v_c1
      FROM projects.projects p JOIN projects.project_participants pp ON pp.project_id = p.id
     WHERE pp.profile_type = 'freelancer' AND pp.profile_id = v_seller
       AND COALESCE(p.client_user_id, p.owner_user_id) <> v_seller
     ORDER BY p.id LIMIT 1;
    SELECT p.id, COALESCE(p.client_user_id, p.owner_user_id) INTO v_p2, v_c2
      FROM projects.projects p JOIN projects.project_participants pp ON pp.project_id = p.id
     WHERE pp.profile_type = 'freelancer' AND pp.profile_id = v_seller
       AND COALESCE(p.client_user_id, p.owner_user_id) NOT IN (v_seller, v_c1)
     ORDER BY p.id LIMIT 1;
    SELECT pp.profile_id INTO v_mate FROM projects.project_participants pp
     WHERE pp.project_id = v_p1 AND pp.profile_type = 'freelancer' AND pp.profile_id NOT IN (v_seller, v_c1, v_c2)
     ORDER BY pp.profile_id LIMIT 1;
    -- A project the seller has nothing to do with.
    SELECT p.id INTO v_off FROM projects.projects p
     WHERE p.owner_user_id <> v_seller AND p.client_user_id IS DISTINCT FROM v_seller
       AND NOT EXISTS (SELECT 1 FROM projects.project_participants pp WHERE pp.project_id = p.id AND pp.profile_id = v_seller)
       AND NOT EXISTS (SELECT 1 FROM projects.stage_assignments sa JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
                        WHERE ps.project_id = p.id AND sa.freelancer_profile_id = v_seller)
     ORDER BY p.id LIMIT 1;
    SELECT u.user_id INTO v_stranger FROM org.users_public u
     WHERE u.user_id NOT IN (v_seller, v_c1, v_c2) AND u.user_id IS DISTINCT FROM v_mate
       AND NOT EXISTS (SELECT 1 FROM projects.project_participants pp WHERE pp.project_id IN (v_p1, v_p2) AND pp.profile_id = u.user_id)
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    IF v_p2 IS NULL OR v_off IS NULL OR v_stranger IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a freelancer on two projects with different clients, an unrelated project and a stranger (deno task db:reset)';
    END IF;
    -- A project where the seller is the client: another project of the off project's owner, made theirs.
    SELECT p.id INTO v_own FROM projects.projects p
     WHERE p.id NOT IN (v_p1, v_p2, v_off) AND p.owner_user_id <> v_seller
       AND NOT EXISTS (SELECT 1 FROM projects.project_participants pp WHERE pp.project_id = p.id AND pp.profile_id = v_seller)
     ORDER BY p.id LIMIT 1;
    UPDATE projects.projects SET client_user_id = v_seller WHERE id = v_own;

    INSERT INTO files.items (owner_user_id, bucket_id, storage_path, display_name, original_name, mime_type, size_bytes, status)
    VALUES (v_seller, 'personal', v_seller || '/probe-residence.pdf', 'Residence certificate 2026.pdf',
            'residence.pdf', 'application/pdf', 2048, 'uploaded')
    RETURNING id INTO v_file;
    INSERT INTO files.items (owner_user_id, bucket_id, storage_path, display_name, original_name, mime_type, size_bytes, status)
    VALUES (v_seller, 'quarantine', v_seller || '/probe-pending.pdf', 'pending.pdf', 'pending.pdf', 'application/pdf', 10, 'pending_upload')
    RETURNING id INTO v_pending;

    PERFORM set_config('probe.seller', v_seller::text, true);
    PERFORM set_config('probe.p1', v_p1::text, true);
    PERFORM set_config('probe.p2', v_p2::text, true);
    PERFORM set_config('probe.c1', v_c1::text, true);
    PERFORM set_config('probe.c2', v_c2::text, true);
    PERFORM set_config('probe.mate', COALESCE(v_mate::text, ''), true);
    PERFORM set_config('probe.stranger', v_stranger::text, true);
    PERFORM set_config('probe.off', v_off::text, true);
    PERFORM set_config('probe.own', COALESCE(v_own::text, ''), true);
    PERFORM set_config('probe.file', v_file::text, true);
    PERFORM set_config('probe.pending', v_pending::text, true);
END $$;
-- #endregion

-- #region 1. Grants and shape
DO $$
DECLARE
    v_door text;
BEGIN
    FOREACH v_door IN ARRAY ARRAY['finance.list_tax_documents()', 'finance.mark_tax_document(uuid)',
                                  'finance.share_tax_document(uuid,uuid)'] LOOP
        PERFORM pg_temp.check(
            (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] FROM pg_proc p WHERE p.oid = v_door::regprocedure)
            AND has_function_privilege('authenticated', v_door::regprocedure, 'EXECUTE')
            AND NOT has_function_privilege('anon', v_door::regprocedure, 'EXECUTE'),
            '1a ' || v_door || ' is a definer with an empty search_path; authenticated may call it, anon may not');
    END LOOP;
    FOREACH v_door IN ARRAY ARRAY['finance.fn_tax_document_client(uuid)', 'finance.fn_tax_document_json(uuid)'] LOOP
        PERFORM pg_temp.check(
            NOT has_function_privilege('anon', v_door::regprocedure, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', v_door::regprocedure, 'EXECUTE'),
            '1b ' || v_door || ' is internal: no client role may call it');
    END LOOP;
END $$;
-- #endregion

-- #region 2. Marking
DO $$
DECLARE
    v_seller uuid := current_setting('probe.seller')::uuid;
    v_c1 uuid := current_setting('probe.c1')::uuid;
    v_stranger uuid := current_setting('probe.stranger')::uuid;
    v_file uuid := current_setting('probe.file')::uuid;
    v jsonb;
BEGIN
    PERFORM pg_temp.check(pg_temp.state_of(v_stranger, format('SELECT finance.mark_tax_document(%L)', v_file)) = 'PF404',
        '2a a stranger cannot mark the seller''s file (PF404)');
    PERFORM pg_temp.check(pg_temp.state_of(v_seller, format('SELECT finance.mark_tax_document(%L)',
        current_setting('probe.pending'))) = '22023', '2b a file still uploading cannot be marked (22023)');
    PERFORM pg_temp.check(pg_temp.state_of(NULL, format('SELECT finance.mark_tax_document(%L)', v_file)) <> '',
        '2c a caller with no session cannot mark anything');
    PERFORM pg_temp.check(pg_temp.state_of(v_seller, format(
        $q$UPDATE files.items SET metadata = metadata || '{"tax_document":{"kind":"residence_certificate"}}' WHERE id = %L$q$,
        v_file)) = '42501', '2d nobody forges the mark by writing the file''s metadata (42501)');

    v := pg_temp.as_user(v_seller, format('SELECT finance.mark_tax_document(%L)', v_file));
    PERFORM pg_temp.check(v ->> 'kind' = 'residence_certificate' AND (v ->> 'file_id')::uuid = v_file
                          AND v -> 'shared' = 'null'::jsonb,
        '2e the seller marks their own uploaded file; it is shared with nobody');
    PERFORM pg_temp.check(
        (SELECT visibility = 'private' FROM files.items WHERE id = v_file)
        AND NOT EXISTS (SELECT 1 FROM files.item_grants g WHERE g.item_id = v_file AND g.revoked_at IS NULL),
        '2f a marked certificate is private with no live grant');
    PERFORM pg_temp.check(pg_temp.reads(v_seller, v_file) AND NOT pg_temp.reads(v_c1, v_file)
                          AND NOT pg_temp.reads(v_stranger, v_file),
        '2g only the seller reads it');
END $$;
-- #endregion

-- #region 3. Sharing
DO $$
DECLARE
    v_seller uuid := current_setting('probe.seller')::uuid;
    v_c1 uuid := current_setting('probe.c1')::uuid;
    v_c2 uuid := current_setting('probe.c2')::uuid;
    v_mate uuid := NULLIF(current_setting('probe.mate'), '')::uuid;
    v_stranger uuid := current_setting('probe.stranger')::uuid;
    v_p1 uuid := current_setting('probe.p1')::uuid;
    v_p2 uuid := current_setting('probe.p2')::uuid;
    v_file uuid := current_setting('probe.file')::uuid;
    v jsonb;
BEGIN
    v := pg_temp.as_user(v_seller, 'SELECT finance.list_tax_documents()');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'targets') t
                 WHERE (t ->> 'project_id')::uuid = v_p1 AND (t ->> 'client_user_id')::uuid = v_c1)
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'targets') t
                         WHERE (t ->> 'client_user_id')::uuid = v_seller
                            OR (t ->> 'project_id')::uuid = current_setting('probe.off')::uuid),
        '3a the targets are the seller''s projects, each with its client; never the seller, never a stranger''s project');

    v := pg_temp.as_user(v_seller, format('SELECT finance.share_tax_document(%L, %L)', v_file, v_p1));
    PERFORM pg_temp.check((v #>> '{shared,client_user_id}')::uuid = v_c1 AND (v #>> '{shared,project_id}')::uuid = v_p1,
        '3b sharing to a project names its client');
    PERFORM pg_temp.check(pg_temp.reads(v_c1, v_file), '3c the chosen client reads it');
    PERFORM pg_temp.check(NOT pg_temp.reads(v_stranger, v_file) AND NOT pg_temp.reads(v_c2, v_file)
                          AND (v_mate IS NULL OR NOT pg_temp.reads(v_mate, v_file)),
        '3d nobody else does: not a stranger, not another client, not a co-worker on the project');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM files.item_grants g WHERE g.item_id = v_file AND g.revoked_at IS NULL) = 1,
        '3e exactly one live grant');

    v := pg_temp.as_user(v_seller, format('SELECT finance.share_tax_document(%L, %L)', v_file, v_p2));
    PERFORM pg_temp.check(pg_temp.reads(v_c2, v_file) AND NOT pg_temp.reads(v_c1, v_file)
                          AND (v #>> '{shared,client_user_id}')::uuid = v_c2,
        '3f a second share replaces the first: the new client reads it, the old one no longer does');

    PERFORM pg_temp.check(pg_temp.state_of(v_seller, format('SELECT finance.share_tax_document(%L, %L)',
        v_file, current_setting('probe.off'))) = '22023', '3g a project the seller is not on is refused (22023)');
    PERFORM pg_temp.check(NULLIF(current_setting('probe.own'), '') IS NULL
        OR pg_temp.state_of(v_seller, format('SELECT finance.share_tax_document(%L, %L)',
               v_file, current_setting('probe.own'))) = '22023',
        '3h a project whose client is the seller is refused (22023)');
    PERFORM pg_temp.check(pg_temp.state_of(v_c2, format('SELECT finance.share_tax_document(%L, %L)', v_file, v_p1)) = 'PF404',
        '3i the client a document was shown to cannot pass it on (PF404)');
    PERFORM pg_temp.check(pg_temp.reads(v_c2, v_file) AND NOT pg_temp.reads(v_c1, v_file),
        '3j a refused share changes nothing');

    v := pg_temp.as_user(v_seller, format('SELECT finance.share_tax_document(%L, NULL)', v_file));
    PERFORM pg_temp.check(v -> 'shared' = 'null'::jsonb AND NOT pg_temp.reads(v_c2, v_file)
                          AND (SELECT visibility = 'private' FROM files.items WHERE id = v_file),
        '3k sharing to no project makes it private again');
END $$;
-- #endregion

-- #region 4. The list is the caller's own
DO $$
DECLARE
    v_seller uuid := current_setting('probe.seller')::uuid;
    v_stranger uuid := current_setting('probe.stranger')::uuid;
    v_file uuid := current_setting('probe.file')::uuid;
    v jsonb;
BEGIN
    v := pg_temp.as_user(v_seller, 'SELECT finance.list_tax_documents()');
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'documents') d WHERE (d ->> 'file_id')::uuid = v_file),
        '4a the seller''s list holds the certificate');
    v := pg_temp.as_user(v_stranger, 'SELECT finance.list_tax_documents()');
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'documents') d WHERE (d ->> 'file_id')::uuid = v_file),
        '4b another person''s list never holds it');
    PERFORM pg_temp.check(pg_temp.state_of(NULL, 'SELECT finance.list_tax_documents()') <> '',
        '4c a caller with no session reads no list');
END $$;
-- #endregion

ROLLBACK;
