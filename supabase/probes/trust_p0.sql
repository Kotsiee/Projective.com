-- =============================================================================================
-- Probe: the P0 holes of SECURITY_MODERATION_AND_AI_GAPS.md §1, each replayed as the attacker.
--   E1  a sender's edit of a protected stage message is masked like an insert
--   E2  a reviewer cannot stamp `handover_unlocked_at` or move `status` past set_project_status
--   E3  comms definers (fn_notify, the runners) are not client RPCs; action_url is an in-app path
--   E4  a client cannot declare an upload's promotion target (the scan-file write primitive)
--   E5  the uncalled search definers are deleted (Q0.2 (f))
--   E7  comms.message_file_details runs as the reader
--   E8  a client writes no bucket but quarantine, reads are unchanged, public_assets takes no SVG (Q0.2 (a))
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/trust_p0.sql
--
-- A clean run prints only PASS notices; any gap raises `FAIL …` and aborts.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_msg uuid;
    v_sender uuid;
    v_project uuid;
    v_owner uuid;
BEGIN
    SELECT m.id, m.sender_user_id INTO v_msg, v_sender
    FROM comms.project_messages m JOIN comms.project_channels c ON c.id = m.channel_id
    WHERE m.deleted_at IS NULL AND m.sender_user_id IS NOT NULL
      AND projects.is_protected_phase(c.project_id)
    ORDER BY m.id LIMIT 1;
    IF v_msg IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no protected stage message (deno task db:reset)'; END IF;

    SELECT p.id, p.owner_user_id INTO v_project, v_owner FROM projects.projects p
    WHERE p.status = 'active' AND projects.is_protected_phase(p.id) ORDER BY p.id LIMIT 1;
    IF v_project IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no protected active project'; END IF;

    PERFORM set_config('probe.msg', v_msg::text, true);
    PERFORM set_config('probe.sender', v_sender::text, true);
    PERFORM set_config('probe.project', v_project::text, true);
    PERFORM set_config('probe.owner', v_owner::text, true);
END $$;
-- #endregion

-- #region E1. The sender edits a protected message
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.sender'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

UPDATE comms.project_messages SET body = 'call me on +44 7700 900123 or me@example.com', edited_at = now()
WHERE id = current_setting('probe.msg')::uuid;

RESET ROLE;

DO $$
DECLARE r record;
BEGIN
    SELECT body, pii_masked, pii_categories INTO r FROM comms.project_messages
    WHERE id = current_setting('probe.msg')::uuid;
    IF r.body LIKE '%7700%' OR r.body LIKE '%example.com%' OR NOT r.pii_masked
       OR NOT r.pii_categories @> ARRAY['email', 'phone'] THEN
        RAISE EXCEPTION 'FAIL edited body stored unmasked: % (masked=%, %)', r.body, r.pii_masked, r.pii_categories;
    END IF;
    RAISE NOTICE 'PASS E1 edit re-masked: %', r.body;
END $$;
-- #endregion

-- #region E2. The owner tries to lift the protected phase
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_project uuid := current_setting('probe.project')::uuid;
BEGIN
    BEGIN
        UPDATE projects.projects SET handover_unlocked_at = now() WHERE id = v_project;
        RAISE EXCEPTION 'FAIL owner stamped handover_unlocked_at';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS E2 handover stamp refused [%]', SQLERRM;
    END;
    BEGIN
        UPDATE projects.projects SET status = 'on_hold' WHERE id = v_project;
        RAISE EXCEPTION 'FAIL owner moved status directly';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS E2 direct status write refused [%]', SQLERRM;
    END;
    UPDATE projects.projects SET title = title WHERE id = v_project;
    RAISE NOTICE 'PASS E2 brief edits still permitted';
END $$;

RESET ROLE;

DO $$
BEGIN
    IF NOT projects.is_protected_phase(current_setting('probe.project')::uuid) THEN
        RAISE EXCEPTION 'FAIL project left its protected phase';
    END IF;
    RAISE NOTICE 'PASS E2 project still protected';
END $$;
-- #endregion

-- #region E3. comms doors and action_url
DO $$
BEGIN
    IF has_function_privilege('authenticated', 'comms.fn_notify(uuid,text,text,text,text,uuid,jsonb,uuid,text,uuid,text,text,comms.notification_urgency,timestamptz)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'comms.fn_process_queue(integer)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'comms.fn_build_digests(comms.digest_frequency)', 'EXECUTE')
       OR has_function_privilege('anon', 'comms.mask_pii(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL a comms writer or runner is still a client RPC';
    END IF;
    IF NOT (has_function_privilege('authenticated', 'comms.get_or_create_dm_thread(uuid,uuid)', 'EXECUTE')
            AND has_function_privilege('authenticated', 'comms.is_dm_participant(uuid)', 'EXECUTE')
            AND has_function_privilege('authenticated', 'comms.has_channel_access(uuid)', 'EXECUTE')
            AND has_function_privilege('authenticated', 'comms.mark_notifications_read(uuid[])', 'EXECUTE')
            AND has_function_privilege('service_role', 'comms.fn_notify(uuid,text,text,text,text,uuid,jsonb,uuid,text,uuid,text,text,comms.notification_urgency,timestamptz)', 'EXECUTE')) THEN
        RAISE EXCEPTION 'FAIL a client door or the service role lost EXECUTE';
    END IF;
    RAISE NOTICE 'PASS E3 comms grants: writers service-only, doors kept';

    BEGIN
        INSERT INTO comms.notifications (user_id, type, title, body, action_url)
        SELECT current_setting('probe.owner')::uuid, 'system.maintenance', 't', 'b', 'javascript:alert(1)';
        RAISE EXCEPTION 'FAIL a javascript: action_url was stored';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS E3 non-relative action_url refused [%]', SQLERRM;
    END;
END $$;
-- #endregion

-- #region E4. A client names its own promotion target
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_user uuid := current_setting('probe.owner')::uuid;
BEGIN
    BEGIN
        INSERT INTO files.items (owner_user_id, owner_type, bucket_id, storage_path, target_bucket, target_path,
            display_name, original_name, mime_type, size_bytes, status, visibility, source, purpose)
        VALUES (v_user, 'user', 'quarantine', v_user::text || '/x/a.png', 'avatars', 'someone-else/avatar.webp',
            'a.png', 'a.png', 'image/png', 1, 'pending_upload', 'private', 'supabase', 'library');
        RAISE EXCEPTION 'FAIL client declared a promotion target';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS E4 client promotion target refused [%]', SQLERRM;
    END;
END $$;

RESET ROLE;
-- #endregion

-- #region E5 + E7. Search definers and the attachment view
DO $$
BEGIN
    IF to_regprocedure('search.fn_search_entities(text,text,jsonb,text,integer,integer,uuid,vector)') IS NOT NULL
       OR to_regprocedure('search.fn_search_global(text,uuid,integer)') IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL a dead search definer still exists';
    END IF;
    RAISE NOTICE 'PASS E5 search definers deleted';

    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'comms.message_file_details'::regclass
                   AND 'security_invoker=true' = ANY (reloptions)) THEN
        RAISE EXCEPTION 'FAIL comms.message_file_details is not security_invoker';
    END IF;
    RAISE NOTICE 'PASS E7 attachment view runs as the reader';
END $$;
-- #endregion

-- #region E8. Client writes to the six buckets
-- One object per bucket, where the old policies let `actor` write: the actor's own object, except in
-- `project`, where it is another participant's (the old UPDATE asked for access, not ownership).
DO $$
DECLARE
    v_owner uuid := current_setting('probe.owner')::uuid;
    v_project uuid; v_assignee uuid; v_holder uuid;
    v_thread uuid; v_dm_user uuid;
    v_team uuid; v_member uuid;
    v_writers text;
    v_cases jsonb;
BEGIN
    SELECT string_agg(polname, ', ') INTO v_writers FROM pg_policy
    WHERE polrelid = 'storage.objects'::regclass AND polcmd <> 'r'
      AND polname <> 'Authenticated users can upload to quarantine';
    IF v_writers IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL storage write policies outside quarantine: %', v_writers;
    END IF;
    IF (SELECT coalesce('image/svg+xml' = ANY (allowed_mime_types), true) FROM storage.buckets WHERE id = 'public_assets') THEN
        RAISE EXCEPTION 'FAIL public_assets accepts SVG';
    END IF;
    RAISE NOTICE 'PASS E8 quarantine is the only client-written bucket; public_assets takes no SVG';

    SELECT ps.project_id, sa.freelancer_profile_id, p.owner_user_id INTO v_project, v_assignee, v_holder
    FROM projects.stage_assignments sa
    JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
    JOIN projects.projects p ON p.id = ps.project_id
    WHERE sa.assignee_type = 'freelancer' AND sa.status NOT IN ('declined', 'cancelled', 'released')
      AND sa.freelancer_profile_id <> p.owner_user_id
    ORDER BY 1, 2 LIMIT 1;
    SELECT thread_id, user_id INTO v_thread, v_dm_user FROM comms.dm_participants ORDER BY 1, 2 LIMIT 1;
    SELECT team_id, user_id INTO v_team, v_member FROM org.team_members WHERE status = 'active' ORDER BY 1, 2 LIMIT 1;
    IF v_project IS NULL OR v_thread IS NULL OR v_team IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: an engaged freelancer, a DM participant and an active team member';
    END IF;

    v_cases := jsonb_build_array(
        jsonb_build_object('bucket', 'project', 'actor', v_assignee, 'holder', v_holder, 'path', v_project || '/e8/peer.txt'),
        jsonb_build_object('bucket', 'messages', 'actor', v_dm_user, 'holder', v_dm_user, 'path', v_thread || '/e8/own.txt'),
        jsonb_build_object('bucket', 'personal', 'actor', v_owner, 'holder', v_owner, 'path', 'users/' || v_owner || '/e8/own.txt'),
        jsonb_build_object('bucket', 'workspace', 'actor', v_member, 'holder', v_member, 'path', v_team || '/e8/own.txt'),
        jsonb_build_object('bucket', 'public_assets', 'actor', v_owner, 'holder', v_owner, 'path', v_owner || '/e8/own.png'),
        jsonb_build_object('bucket', 'catalogue', 'actor', v_owner, 'holder', v_owner, 'path', v_owner || '/e8/own.png'));
    INSERT INTO storage.objects (bucket_id, name, owner)
    SELECT c.bucket, c.path, c.holder FROM jsonb_to_recordset(v_cases) AS c(bucket text, path text, holder uuid);
    PERFORM set_config('probe.e8', v_cases::text, true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
    c record;
    n integer;
BEGIN
    -- The Storage API sets this for its own deletes. Without it storage.protect_delete refuses every SQL
    -- DELETE before a policy is asked, and the DELETE check would pass for the wrong reason.
    PERFORM set_config('storage.allow_delete_query', 'true', true);
    FOR c IN SELECT * FROM jsonb_to_recordset(current_setting('probe.e8')::jsonb) AS t(bucket text, actor uuid, path text)
    LOOP
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', c.actor, 'role', 'authenticated')::text, true);
        BEGIN
            INSERT INTO storage.objects (bucket_id, name, owner) VALUES (c.bucket, c.path || '.new', c.actor);
            RAISE EXCEPTION 'FAIL % accepted a client INSERT', c.bucket;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
        UPDATE storage.objects SET metadata = '{}'::jsonb WHERE bucket_id = c.bucket AND name = c.path;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN RAISE EXCEPTION 'FAIL % accepted a client UPDATE', c.bucket; END IF;
        DELETE FROM storage.objects WHERE bucket_id = c.bucket AND name = c.path;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN RAISE EXCEPTION 'FAIL % accepted a client DELETE', c.bucket; END IF;
        IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = c.bucket AND name = c.path) THEN
            RAISE EXCEPTION 'FAIL % lost its read', c.bucket;
        END IF;
        RAISE NOTICE 'PASS E8 % refuses a client INSERT, UPDATE and DELETE; its read is unchanged', c.bucket;
    END LOOP;

    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'personal') THEN
        RAISE EXCEPTION 'FAIL a stranger reads a personal object';
    END IF;
    RAISE NOTICE 'PASS E8 a personal object stays its owner''s to read';
END $$;

RESET ROLE;
-- #endregion

ROLLBACK;
