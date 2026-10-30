-- =============================================================================================
-- Probe: the comms and search trust defects of SECURITY_MODERATION_AND_AI_GAPS.md §8 (P1) and
-- COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md §8 that need no ruling, each replayed as the attacker.
--   L2   a Delta that does not spell the stored body is dropped (Delta smuggling)
--   L4   a client-business member is party to the engagement; a cancelled project stays protected
--   L5   a client cannot set server-owned columns on a message INSERT
--   L6   an invitation note written directly is masked like one written through invite_to_project
--   G9   a link row cannot claim another bucket's address
--   E6   search index visibility is the directory's listed predicate (G12: the freelancer row too)
--   M5   one participant row per person per thread; the pair's thread is found, not minted twice
--   M10  comms.mark_dm_read moves the caller's own watermark, and only theirs
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/trust_p1_comms_search.sql
--
-- A clean run prints only PASS notices; any gap raises `FAIL …` and aborts.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_chan uuid;
    v_sender uuid;
    v_thread uuid;
    v_a uuid;
    v_b uuid;
    v_outsider uuid;
    v_inv uuid;
    v_inv_owner uuid;
BEGIN
    SELECT m.channel_id, m.sender_user_id INTO v_chan, v_sender
    FROM comms.project_messages m JOIN comms.project_channels c ON c.id = m.channel_id
    WHERE m.deleted_at IS NULL AND c.archived_at IS NULL AND projects.is_protected_phase(c.project_id)
    ORDER BY m.id LIMIT 1;
    IF v_chan IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no protected stage message (deno task db:reset)'; END IF;

    -- A two-person DM between adults (the under-18 shield would refuse the probe's own sends).
    SELECT t.id, p1.user_id, p2.user_id INTO v_thread, v_a, v_b
    FROM comms.dm_threads t
    JOIN comms.dm_participants p1 ON p1.thread_id = t.id AND p1.deleted_at IS NULL
    JOIN comms.dm_participants p2 ON p2.thread_id = t.id AND p2.user_id > p1.user_id
    WHERE t.kind = 'dm' AND t.archived_at IS NULL
      AND comms.fn_dm_allowed(p1.user_id, p2.user_id)
      AND (SELECT count(*) FROM comms.dm_participants x WHERE x.thread_id = t.id) = 2
    ORDER BY t.id LIMIT 1;
    IF v_thread IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no two-person DM'; END IF;

    SELECT u.user_id INTO v_outsider FROM org.users_public u
    WHERE NOT EXISTS (SELECT 1 FROM comms.dm_participants p WHERE p.thread_id = v_thread AND p.user_id = u.user_id)
    ORDER BY u.user_id LIMIT 1;

    SELECT i.id, i.inviter_user_id INTO v_inv, v_inv_owner
    FROM projects.project_invitations i JOIN projects.projects p ON p.id = i.project_id
    WHERE p.owner_user_id = i.inviter_user_id AND projects.is_protected_phase(p.id)
    ORDER BY i.id LIMIT 1;
    IF v_inv IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no owner-issued invitation on a protected project'; END IF;

    PERFORM set_config('probe.chan', v_chan::text, true);
    PERFORM set_config('probe.sender', v_sender::text, true);
    PERFORM set_config('probe.thread', v_thread::text, true);
    PERFORM set_config('probe.a', v_a::text, true);
    PERFORM set_config('probe.b', v_b::text, true);
    PERFORM set_config('probe.outsider', v_outsider::text, true);
    PERFORM set_config('probe.inv', v_inv::text, true);
    PERFORM set_config('probe.inv_owner', v_inv_owner::text, true);
END $$;
-- #endregion

-- #region Grants
DO $$
BEGIN
    IF NOT has_function_privilege('authenticated', 'comms.mark_dm_read(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL comms.mark_dm_read is not a client door';
    END IF;
    IF has_function_privilege('authenticated', 'comms.fn_lock_dm_pair(uuid,uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'comms.mark_dm_read(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL a comms internal is a client RPC';
    END IF;
    IF has_column_privilege('authenticated', 'comms.project_messages', 'created_at', 'INSERT')
       OR has_column_privilege('authenticated', 'comms.project_messages', 'pii_masked', 'INSERT')
       OR has_column_privilege('authenticated', 'comms.dm_messages', 'created_at', 'INSERT')
       OR has_column_privilege('authenticated', 'comms.dm_messages', 'pii_categories', 'INSERT')
       OR NOT has_column_privilege('authenticated', 'comms.dm_messages', 'body_delta', 'INSERT') THEN
        RAISE EXCEPTION 'FAIL message INSERT grants are not column-scoped';
    END IF;
    RAISE NOTICE 'PASS grants: mark_dm_read a door, pair lock internal, message INSERT column-scoped';
END $$;
-- #endregion

-- #region L2. fn_delta_text
DO $$
BEGIN
    IF comms.fn_delta_text('{"ops":[{"insert":"he"},{"insert":"llo","attributes":{"bold":true}}]}') IS DISTINCT FROM 'hello'
       OR comms.fn_delta_text('{"ops":[{"insert":"hello","x":"07700 900123"}]}') IS NOT NULL
       OR comms.fn_delta_text('{"ops":[{"insert":"hello","attributes":{"bold":"07700 900123"}}]}') IS NOT NULL
       OR comms.fn_delta_text('{"ops":[{"insert":"hello"}],"note":"07700 900123"}') IS NOT NULL
       OR comms.fn_delta_text('{"ops":["hello"]}') IS NOT NULL
       OR comms.fn_delta_text('{"ops":[]}') IS NOT NULL
       OR comms.fn_delta_text('{"ops":{}}') IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL fn_delta_text accepts a shape the renderer would not';
    END IF;
    RAISE NOTICE 'PASS L2 fn_delta_text spells only the normalised shape';
END $$;
-- #endregion

-- #region L2 + L5. Smuggling and forging through a stage-room INSERT
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.sender'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_chan uuid := current_setting('probe.chan')::uuid;
    v_me uuid := current_setting('probe.sender')::uuid;
    v_id uuid;
    v_delta jsonb;
BEGIN
    INSERT INTO comms.project_messages (channel_id, sender_user_id, body, body_delta)
    VALUES (v_chan, v_me, 'hi', '{"ops":[{"insert":"call +44 7700 900123"}]}')
    RETURNING id, body_delta INTO v_id, v_delta;
    IF v_delta IS NOT NULL THEN RAISE EXCEPTION 'FAIL a Delta spelling other words was stored: %', v_delta; END IF;

    INSERT INTO comms.project_messages (channel_id, sender_user_id, body, body_delta)
    VALUES (v_chan, v_me, '', '{"ops":[{"insert":"me@example.com"}]}')
    RETURNING body_delta INTO v_delta;
    IF v_delta IS NOT NULL THEN RAISE EXCEPTION 'FAIL a Delta beside an empty body was stored'; END IF;

    INSERT INTO comms.project_messages (channel_id, sender_user_id, body, body_delta)
    VALUES (v_chan, v_me, 'hello', '{"ops":[{"insert":"hello","x":"me@example.com"}]}')
    RETURNING body_delta INTO v_delta;
    IF v_delta IS NOT NULL THEN RAISE EXCEPTION 'FAIL a Delta with a hidden key was stored'; END IF;

    INSERT INTO comms.project_messages (channel_id, sender_user_id, body, body_delta)
    VALUES (v_chan, v_me, 'hello', '{"ops":[{"insert":"hel","attributes":{"bold":true}},{"insert":"lo"}]}')
    RETURNING body_delta INTO v_delta;
    IF v_delta IS NULL THEN RAISE EXCEPTION 'FAIL an agreeing Delta was dropped'; END IF;

    UPDATE comms.project_messages SET body_delta = '{"ops":[{"insert":"me@example.com"}]}' WHERE id = v_id;
    SELECT body_delta INTO v_delta FROM comms.project_messages WHERE id = v_id;
    IF v_delta IS NOT NULL THEN RAISE EXCEPTION 'FAIL a smuggled Delta was stored by an edit'; END IF;
    RAISE NOTICE 'PASS L2 stage room: smuggled Deltas dropped on insert and edit, agreeing Delta kept';

    BEGIN
        INSERT INTO comms.project_messages (channel_id, sender_user_id, body, created_at)
        VALUES (v_chan, v_me, 'backdated', now() - interval '90 days');
        RAISE EXCEPTION 'FAIL a backdated stage message was inserted';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS L5 stage room created_at refused [%]', SQLERRM;
    END;
    BEGIN
        INSERT INTO comms.project_messages (channel_id, sender_user_id, body, pii_masked)
        VALUES (v_chan, v_me, 'x', true);
        RAISE EXCEPTION 'FAIL a client set pii_masked on insert';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS L5 stage room pii_masked refused [%]', SQLERRM;
    END;
END $$;

RESET ROLE;
-- #endregion

-- #region L2 + L5 + M10. The DM door
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_thread uuid := current_setting('probe.thread')::uuid;
    v_me uuid := current_setting('probe.a')::uuid;
    v_delta jsonb;
    v_moved boolean;
BEGIN
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, body_delta)
    VALUES (v_thread, v_me, 'hi', '{"ops":[{"insert":"call +44 7700 900123"}]}')
    RETURNING body_delta INTO v_delta;
    IF v_delta IS NOT NULL THEN RAISE EXCEPTION 'FAIL a DM Delta spelling other words was stored'; END IF;
    RAISE NOTICE 'PASS L2 DM: smuggled Delta dropped';

    BEGIN
        INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, created_at)
        VALUES (v_thread, v_me, 'backdated', now() - interval '90 days');
        RAISE EXCEPTION 'FAIL a backdated DM was inserted';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS L5 DM created_at refused [%]', SQLERRM;
    END;

    -- The message above is newer than any seeded watermark, so the first mark moves it.
    v_moved := comms.mark_dm_read(v_thread);
    IF NOT v_moved THEN RAISE EXCEPTION 'FAIL mark_dm_read did not move a stale watermark'; END IF;
    v_moved := comms.mark_dm_read(v_thread);
    IF v_moved THEN RAISE EXCEPTION 'FAIL mark_dm_read rewrote a current watermark'; END IF;
    RAISE NOTICE 'PASS M10 mark_dm_read moves a stale watermark once';
END $$;

RESET ROLE;

DO $$
DECLARE r record;
BEGIN
    SELECT p.last_read_at INTO r FROM comms.dm_participants p
    WHERE p.thread_id = current_setting('probe.thread')::uuid AND p.user_id = current_setting('probe.a')::uuid;
    IF r.last_read_at IS NULL THEN RAISE EXCEPTION 'FAIL the caller''s watermark was not written'; END IF;
    RAISE NOTICE 'PASS M10 the caller''s own row carries the watermark';
END $$;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.outsider'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
    BEGIN
        PERFORM comms.mark_dm_read(current_setting('probe.thread')::uuid);
        RAISE EXCEPTION 'FAIL an outsider marked a thread read';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS M10 outsider refused [%]', SQLERRM;
    END;
END $$;

RESET ROLE;
-- #endregion

-- #region M5. One thread per pair
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_first uuid;
    v_second uuid;
BEGIN
    v_first := comms.get_or_create_dm_thread(current_setting('probe.b')::uuid);
    v_second := comms.get_or_create_dm_thread(current_setting('probe.b')::uuid);
    IF v_first IS DISTINCT FROM v_second THEN RAISE EXCEPTION 'FAIL the pair was given two threads'; END IF;
    BEGIN
        PERFORM comms.get_or_create_dm_thread(current_setting('probe.a')::uuid);
        RAISE EXCEPTION 'FAIL a DM with oneself was opened';
    EXCEPTION WHEN invalid_parameter_value THEN
        RAISE NOTICE 'PASS M5 a DM with oneself refused [%]', SQLERRM;
    END;
    RAISE NOTICE 'PASS M5 the pair''s thread is found, not minted twice';
END $$;

RESET ROLE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dm_participants_thread_user_key' AND contype = 'u') THEN
        RAISE EXCEPTION 'FAIL dm_participants has no UNIQUE (thread_id, user_id)';
    END IF;
    BEGIN
        INSERT INTO comms.dm_participants (thread_id, user_id)
        VALUES (current_setting('probe.thread')::uuid, current_setting('probe.a')::uuid);
        RAISE EXCEPTION 'FAIL a second participant row for one person was stored';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'PASS M5 duplicate participant row refused';
    END;
    IF position('fn_lock_dm_pair' IN pg_get_functiondef('comms.send_request_message(uuid,text,uuid)'::regprocedure)) = 0
       OR position('fn_lock_dm_pair' IN pg_get_functiondef('comms.get_or_create_dm_thread(uuid,uuid)'::regprocedure)) = 0 THEN
        RAISE EXCEPTION 'FAIL a DM opener does not take the pair lock';
    END IF;
    RAISE NOTICE 'PASS M5 both openers take the pair lock';
END $$;
-- #endregion

-- #region L6. A note written straight into the invitation row
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.inv_owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

UPDATE projects.project_invitations SET message = 'email me at me@example.com or call +44 7700 900123'
WHERE id = current_setting('probe.inv')::uuid;

RESET ROLE;

DO $$
DECLARE v_msg text;
BEGIN
    SELECT message INTO v_msg FROM projects.project_invitations WHERE id = current_setting('probe.inv')::uuid;
    IF v_msg LIKE '%example.com%' OR v_msg LIKE '%7700%' THEN
        RAISE EXCEPTION 'FAIL a direct invitation note was stored unmasked: %', v_msg;
    END IF;
    RAISE NOTICE 'PASS L6 direct invitation note masked: %', v_msg;
END $$;
-- #endregion

-- #region G9. A forged link row
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.sender'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v_me uuid := current_setting('probe.sender')::uuid;
    v_id uuid := gen_random_uuid();
BEGIN
    BEGIN
        INSERT INTO files.items (owner_user_id, owner_type, bucket_id, storage_path, display_name, original_name,
            mime_type, size_bytes, status, visibility, source, purpose, link_url, link_domain, link_scan_status)
        SELECT v_me, 'user', 'project', p.id::text || '/forged/' || v_id::text, 'Brief', 'https://example.com',
            'text/uri-list', 0, 'uploaded', 'private', 'link', 'library', 'https://example.com', 'example.com', 'pending'
        FROM projects.projects p ORDER BY p.id LIMIT 1;
        RAISE EXCEPTION 'FAIL a link row claimed a project path';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS G9 forged link address refused [%]', SQLERRM;
    END;

    INSERT INTO files.items (id, owner_user_id, owner_type, bucket_id, storage_path, display_name, original_name,
        mime_type, size_bytes, status, visibility, source, purpose, link_url, link_domain, link_scan_status)
    VALUES (v_id, v_me, 'user', 'link', v_id::text, 'Brief', 'https://example.com',
        'text/uri-list', 0, 'uploaded', 'private', 'link', 'library', 'https://example.com', 'example.com', 'pending');
    RAISE NOTICE 'PASS G9 an honest link row is still accepted';
END $$;

RESET ROLE;
-- #endregion

-- #region E6 + G12. The search index lists what the directory lists
DO $$
DECLARE
    v_bad int;
    v_user uuid;
    v_team uuid;
BEGIN
    SELECT count(*) INTO v_bad FROM search.profiles_index pi
    WHERE pi.is_active IS DISTINCT FROM CASE pi.entity_type
        WHEN 'user' THEN (SELECT u.visibility = 'public' FROM org.users_public u WHERE u.user_id = pi.entity_id)
        WHEN 'freelancer' THEN (SELECT u.visibility = 'public' AND u.is_freelancer FROM org.users_public u WHERE u.user_id = pi.entity_id)
        WHEN 'team' THEN (SELECT t.status = 'active' AND t.visibility = 'public' FROM org.teams t WHERE t.id = pi.entity_id)
        WHEN 'business' THEN (SELECT b.status = 'active' AND b.visibility = 'public' FROM org.business_profiles b WHERE b.id = pi.entity_id)
    END;
    IF v_bad > 0 THEN RAISE EXCEPTION 'FAIL % profile index rows disagree with the directory', v_bad; END IF;

    SELECT count(*) INTO v_bad FROM search.projects_index pi JOIN projects.projects p ON p.id = pi.project_id
    WHERE pi.is_active IS DISTINCT FROM (p.status = 'active' AND p.visibility = 'public');
    IF v_bad > 0 THEN RAISE EXCEPTION 'FAIL % project index rows disagree with the public policy', v_bad; END IF;
    RAISE NOTICE 'PASS E6 every index row is active exactly when its source is listed';

    SELECT pi.entity_id INTO v_user FROM search.profiles_index pi
    WHERE pi.entity_type = 'freelancer' AND pi.is_active ORDER BY pi.entity_id LIMIT 1;
    UPDATE org.users_public SET visibility = 'private' WHERE user_id = v_user;
    IF (SELECT is_active FROM search.profiles_index WHERE entity_type = 'freelancer' AND entity_id = v_user) THEN
        RAISE EXCEPTION 'FAIL a private person''s freelancer row stayed listed';
    END IF;
    RAISE NOTICE 'PASS G12 a profile turned private takes its freelancer row out';

    SELECT pi.entity_id INTO v_team FROM search.profiles_index pi
    WHERE pi.entity_type = 'team' AND pi.is_active ORDER BY pi.entity_id LIMIT 1;
    UPDATE org.teams SET visibility = 'invite_only' WHERE id = v_team;
    IF (SELECT is_active FROM search.profiles_index WHERE entity_type = 'team' AND entity_id = v_team) THEN
        RAISE EXCEPTION 'FAIL an invite-only team stayed listed';
    END IF;
    RAISE NOTICE 'PASS E6 an invite-only team leaves the index';
END $$;
-- #endregion

-- #region L4. Who is party, and what ends the protected phase
DO $$
DECLARE
    v_project uuid;
    v_member uuid;
    v_owner uuid;
    v_free uuid;
    v_thread uuid;
BEGIN
    -- (a) An active member of the client business who is not its owner.
    SELECT p.id, bm.user_id INTO v_project, v_member
    FROM projects.projects p
    JOIN org.business_profiles bp ON bp.id = p.client_business_id
    JOIN org.business_members bm ON bm.business_id = bp.id AND bm.status = 'active' AND bm.user_id <> bp.owner_user_id
    WHERE projects.is_protected_phase(p.id)
    ORDER BY p.id LIMIT 1;
    IF v_project IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no client business with a non-owner member'; END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.fn_engaged_projects(v_member) e WHERE e.project_id = v_project) THEN
        RAISE EXCEPTION 'FAIL a client-business member is not party to the engagement';
    END IF;
    RAISE NOTICE 'PASS L4(a) client-business members are party to the engagement';

    -- (c) Every project between an owner and an assigned freelancer is cancelled: the DM stays protected.
    SELECT p.owner_user_id, sa.freelancer_profile_id INTO v_owner, v_free
    FROM projects.projects p
    JOIN projects.project_stages ps ON ps.project_id = p.id
    JOIN projects.stage_assignments sa ON sa.project_stage_id = ps.id
    WHERE sa.assignee_type = 'freelancer' AND sa.status NOT IN ('declined', 'cancelled', 'released')
      AND projects.is_protected_phase(p.id)
    ORDER BY p.id LIMIT 1;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no assigned freelancer on a protected project'; END IF;

    INSERT INTO comms.dm_threads (created_by_user_id, kind) VALUES (v_owner, 'dm') RETURNING id INTO v_thread;
    INSERT INTO comms.dm_participants (thread_id, user_id) VALUES (v_thread, v_owner), (v_thread, v_free);

    SET LOCAL session_replication_role = replica;
    UPDATE projects.projects SET status = 'cancelled' WHERE handover_unlocked_at IS NULL;
    SET LOCAL session_replication_role = origin;

    IF comms.fn_dm_protected_project(v_thread, v_owner, NULL) IS NULL THEN
        RAISE EXCEPTION 'FAIL cancelling the engagement lifted the DM mask';
    END IF;
    RAISE NOTICE 'PASS L4(c) a cancelled engagement keeps its DM protected, as its rooms are';
END $$;
-- #endregion

ROLLBACK;
