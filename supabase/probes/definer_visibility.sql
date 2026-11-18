-- =============================================================================================
-- Probe: three definers the SAC1 review found answering for any id now answer only what the caller
-- may see (Decision #481; PRD-C26, C28, C29).
--   1. PRD-C28 finance.get_purchase_owner (00001210 §8): a team's or business's public face reaches
--      a non-member only while the entity is active and public or unlisted (org.fn_profile_visible),
--      and its avatar only while the file is public, uploaded and not deleted, for members too.
--   2. PRD-C29 the free/busy helpers (00001510): fn_slot_is_free, fn_has_conflicting_event,
--      fn_is_blacked_out, fn_band_covers and fn_call_window_covers are executable by no client role.
--      Every caller is a definer that runs them as their owner; a guest reads free/busy only
--      through get_free_busy / get_public_blackouts, which ask fn_schedule_is_public first.
--   3. PRD-C26 org.get_party_cards (00001040): a private person's card reaches only the people
--      org.fn_party_visible admits.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a seeded local DB
-- (deno task db:reset):
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/definer_visibility.sql
-- Fixtures are discovered from the seed and every state change (an archived team, a private
-- person, a deleted avatar, an unpublished schedule) is made inside the transaction. The stranger
-- is a person created here, so they share nothing with anybody. Every check raises `FAIL …` and
-- aborts; a clean run prints only PASS notices.
-- =============================================================================================

BEGIN;
SET LOCAL search_path = '';

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_stranger uuid := pg_catalog.gen_random_uuid();
    v_team     uuid;
    v_tmember  uuid;
    v_biz      uuid;
    v_bmember  uuid;
    v_sched    uuid;
    v_ev_start timestamptz;
    v_ev_end   timestamptz;
BEGIN
    -- The stranger: a fresh adult freelancer account, member of nothing, party to nothing, not an
    -- admin. (A freelancer, so a project seat given in region 3 counts for projects.has_project_access.)
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    VALUES (v_stranger, 'visibility-probe-' || v_stranger || '@projective.invalid', 'authenticated',
            'authenticated', '{}'::jsonb, pg_catalog.now());
    INSERT INTO org.users_public (user_id, username, dob, first_name, last_name, visibility)
    VALUES (v_stranger, 'visprobe_' || pg_catalog.left(pg_catalog.replace(v_stranger::text, '-', ''), 12),
            DATE '1990-01-01', 'Probe', 'Stranger', 'public');
    INSERT INTO org.freelancer_profiles (user_id) VALUES (v_stranger);

    -- A team and a business with an avatar and an active member who is not an admin.
    SELECT t.id, m.user_id INTO v_team, v_tmember
    FROM org.teams t
    JOIN org.team_members m ON m.team_id = t.id AND m.status = 'active'
    WHERE t.avatar_file_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ops.admin_users a WHERE a.user_id = m.user_id)
    ORDER BY t.slug, m.user_id
    LIMIT 1;
    SELECT b.id, m.user_id INTO v_biz, v_bmember
    FROM org.business_profiles b
    JOIN org.business_members m ON m.business_id = b.id AND m.status = 'active'
    WHERE b.logo_file_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ops.admin_users a WHERE a.user_id = m.user_id)
    ORDER BY b.slug, m.user_id
    LIMIT 1;

    -- A schedule holding a busy event (one fn_has_conflicting_event counts) and a blackout.
    SELECT e.schedule_id, e.starts_at, e.ends_at INTO v_sched, v_ev_start, v_ev_end
    FROM scheduling.events e
    WHERE COALESCE(e.status, 'confirmed'::scheduling.event_status) <> 'cancelled'::scheduling.event_status
        AND e.kind <> 'availability'::scheduling.event_kind
        AND e.availability_behavior <> 'passive'
        AND EXISTS (SELECT 1 FROM scheduling.blackout_dates b WHERE b.schedule_id = e.schedule_id)
    ORDER BY e.schedule_id, e.starts_at
    LIMIT 1;

    IF v_team IS NULL OR v_biz IS NULL OR v_sched IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: team=% business=% schedule=% (deno task db:reset)', v_team, v_biz, v_sched;
    END IF;

    PERFORM pg_catalog.set_config('probe.stranger', v_stranger::text, true);
    PERFORM pg_catalog.set_config('probe.team', v_team::text, true);
    PERFORM pg_catalog.set_config('probe.tmember', v_tmember::text, true);
    PERFORM pg_catalog.set_config('probe.biz', v_biz::text, true);
    PERFORM pg_catalog.set_config('probe.bmember', v_bmember::text, true);
    PERFORM pg_catalog.set_config('probe.sched', v_sched::text, true);
    PERFORM pg_catalog.set_config('probe.ev_start', v_ev_start::text, true);
    PERFORM pg_catalog.set_config('probe.ev_end', v_ev_end::text, true);
    RAISE NOTICE 'fixture stranger=% team=% (member %) business=% (member %) schedule=%',
        v_stranger, v_team, v_tmember, v_biz, v_bmember, v_sched;
END $$;
-- #endregion

-- #region 1. PRD-C28 finance.get_purchase_owner
-- Each step sets the entity's state as postgres, then asks as `authenticated` with the caller's
-- claims, exactly as PostgREST would.
DO $$
DECLARE
    v_stranger uuid := pg_catalog.current_setting('probe.stranger')::uuid;
    v_out      jsonb;
    r          record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            -- kind, entity, member, status, visibility, a non-member sees it
            ('team',     pg_catalog.current_setting('probe.team')::uuid, pg_catalog.current_setting('probe.tmember')::uuid, 'active',   'public',      true),
            ('team',     pg_catalog.current_setting('probe.team')::uuid, pg_catalog.current_setting('probe.tmember')::uuid, 'active',   'unlisted',    true),
            ('team',     pg_catalog.current_setting('probe.team')::uuid, pg_catalog.current_setting('probe.tmember')::uuid, 'active',   'invite_only', false),
            ('team',     pg_catalog.current_setting('probe.team')::uuid, pg_catalog.current_setting('probe.tmember')::uuid, 'draft',    'public',      false),
            ('team',     pg_catalog.current_setting('probe.team')::uuid, pg_catalog.current_setting('probe.tmember')::uuid, 'archived', 'public',      false),
            ('business', pg_catalog.current_setting('probe.biz')::uuid,  pg_catalog.current_setting('probe.bmember')::uuid, 'active',   'public',      true),
            ('business', pg_catalog.current_setting('probe.biz')::uuid,  pg_catalog.current_setting('probe.bmember')::uuid, 'active',   'unlisted',    true),
            ('business', pg_catalog.current_setting('probe.biz')::uuid,  pg_catalog.current_setting('probe.bmember')::uuid, 'active',   'invite_only', false),
            ('business', pg_catalog.current_setting('probe.biz')::uuid,  pg_catalog.current_setting('probe.bmember')::uuid, 'draft',    'public',      false),
            ('business', pg_catalog.current_setting('probe.biz')::uuid,  pg_catalog.current_setting('probe.bmember')::uuid, 'archived', 'public',      false)
        ) AS t(kind, entity, member, status, visibility, outsider_sees)
    LOOP
        PERFORM pg_catalog.set_config('role', 'none', true);
        IF r.kind = 'team' THEN
            UPDATE org.teams SET status = r.status, visibility = r.visibility WHERE id = r.entity;
        ELSE
            UPDATE org.business_profiles SET status = r.status, visibility = r.visibility WHERE id = r.entity;
        END IF;

        PERFORM pg_catalog.set_config('role', 'authenticated', true);
        PERFORM pg_catalog.set_config('request.jwt.claims',
            pg_catalog.json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
        v_out := finance.get_purchase_owner(r.kind, r.entity);
        IF r.outsider_sees AND (v_out IS NULL OR v_out ->> 'name' IS NULL OR (v_out ->> 'is_member')::boolean
                                OR v_out ->> 'platform_fee_bp' IS NOT NULL OR v_out -> 'billing' <> 'null'::jsonb) THEN
            RAISE EXCEPTION 'FAIL a non-member should see only the public face of a % % %: %', r.status, r.visibility, r.kind, v_out;
        ELSIF NOT r.outsider_sees AND v_out IS NOT NULL THEN
            RAISE EXCEPTION 'FAIL a non-member was told the name of a % % % (%)', r.status, r.visibility, r.kind, v_out ->> 'name';
        END IF;

        PERFORM pg_catalog.set_config('request.jwt.claims',
            pg_catalog.json_build_object('sub', r.member, 'role', 'authenticated')::text, true);
        v_out := finance.get_purchase_owner(r.kind, r.entity);
        IF v_out IS NULL OR NOT (v_out ->> 'is_member')::boolean THEN
            RAISE EXCEPTION 'FAIL an active member lost their own % % % (%)', r.status, r.visibility, r.kind, v_out;
        END IF;
        RAISE NOTICE 'PASS % % %: a non-member %, a member sees it', r.status, r.visibility, r.kind,
            CASE WHEN r.outsider_sees THEN 'sees the public face' ELSE 'is told nothing' END;
    END LOOP;
    PERFORM pg_catalog.set_config('role', 'none', true);
    UPDATE org.teams SET status = 'active', visibility = 'public' WHERE id = pg_catalog.current_setting('probe.team')::uuid;
    UPDATE org.business_profiles SET status = 'active', visibility = 'public' WHERE id = pg_catalog.current_setting('probe.biz')::uuid;
END $$;

-- The avatar leaves only while its file is public, uploaded and not deleted, to members as well:
-- a stale path names an object nobody may fetch.
DO $$
DECLARE
    v_team  uuid := pg_catalog.current_setting('probe.team')::uuid;
    v_file  uuid;
    v_out   jsonb;
    v_who   uuid;
    r       record;
BEGIN
    SELECT t.avatar_file_id INTO v_file FROM org.teams t WHERE t.id = v_team;
    PERFORM pg_catalog.set_config('role', 'authenticated', true);
    PERFORM pg_catalog.set_config('request.jwt.claims',
        pg_catalog.json_build_object('sub', pg_catalog.current_setting('probe.stranger'), 'role', 'authenticated')::text, true);
    v_out := finance.get_purchase_owner('team', v_team);
    IF v_out ->> 'avatar_path' IS NULL THEN
        RAISE EXCEPTION 'FAIL a public team''s public avatar is missing from its public face (%)', v_out;
    END IF;

    FOR r IN SELECT * FROM (VALUES ('deleted'), ('private')) AS t(state) LOOP
        PERFORM pg_catalog.set_config('role', 'none', true);
        IF r.state = 'deleted' THEN
            UPDATE files.items SET deleted_at = pg_catalog.now() WHERE id = v_file;
        ELSE
            UPDATE files.items SET deleted_at = NULL, visibility = 'private'::files.file_visibility WHERE id = v_file;
        END IF;
        PERFORM pg_catalog.set_config('role', 'authenticated', true);
        FOREACH v_who IN ARRAY ARRAY[pg_catalog.current_setting('probe.stranger')::uuid,
                                     pg_catalog.current_setting('probe.tmember')::uuid] LOOP
            PERFORM pg_catalog.set_config('request.jwt.claims',
                pg_catalog.json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
            v_out := finance.get_purchase_owner('team', v_team);
            IF v_out IS NULL OR v_out ->> 'avatar_path' IS NOT NULL OR v_out ->> 'avatar_bucket' IS NOT NULL THEN
                RAISE EXCEPTION 'FAIL a % avatar file left get_purchase_owner (caller %): %', r.state, v_who, v_out;
            END IF;
        END LOOP;
        RAISE NOTICE 'PASS a % avatar file is withheld from a non-member and a member alike', r.state;
    END LOOP;
    PERFORM pg_catalog.set_config('role', 'none', true);
END $$;
-- #endregion

-- #region 2. PRD-C29 the free/busy helpers are no client's to call
DO $$
DECLARE
    v_fail text[] := '{}';
    r      record;
BEGIN
    FOR r IN
        SELECT ro.rolname, f.sig
        FROM (VALUES ('anon'), ('authenticated')) AS ro(rolname)
        CROSS JOIN (VALUES
            ('scheduling.fn_slot_is_free(uuid,timestamp with time zone,timestamp with time zone,uuid)'),
            ('scheduling.fn_has_conflicting_event(uuid,timestamp with time zone,timestamp with time zone)'),
            ('scheduling.fn_is_blacked_out(uuid,timestamp with time zone,timestamp with time zone)'),
            ('scheduling.fn_band_covers(uuid,scheduling.availability_kind,timestamp with time zone,timestamp with time zone,uuid)'),
            ('scheduling.fn_call_window_covers(uuid,timestamp with time zone,timestamp with time zone)')
        ) AS f(sig)
    LOOP
        IF pg_catalog.has_function_privilege(r.rolname, pg_catalog.to_regprocedure(r.sig), 'EXECUTE') THEN
            v_fail := v_fail || pg_catalog.format('%s may execute %s', r.rolname, r.sig);
        END IF;
    END LOOP;
    IF pg_catalog.cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL % free/busy helper grant(s) answer for any schedule id:%', pg_catalog.cardinality(v_fail),
            E'\n  ' || pg_catalog.array_to_string(v_fail, E'\n  ');
    END IF;
    RAISE NOTICE 'PASS no client role may execute the five free/busy helpers';
END $$;

-- At run time, on an UNPUBLISHED schedule, as a guest and as a signed-in stranger.
UPDATE scheduling.schedules SET is_published = false WHERE id = pg_catalog.current_setting('probe.sched')::uuid;
DO $$
DECLARE
    v_s    text := pg_catalog.current_setting('probe.sched');
    v_from text := pg_catalog.current_setting('probe.ev_start');
    v_to   text := pg_catalog.current_setting('probe.ev_end');
    v_role text;
    v_sql  text;
    v_rows bigint;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        PERFORM pg_catalog.set_config('role', v_role, true);
        PERFORM pg_catalog.set_config('request.jwt.claims', CASE v_role
            WHEN 'anon' THEN '{"role":"anon"}'
            ELSE pg_catalog.json_build_object('sub', pg_catalog.current_setting('probe.stranger'), 'role', 'authenticated')::text
        END, true);
        FOREACH v_sql IN ARRAY ARRAY[
            pg_catalog.format('SELECT scheduling.fn_slot_is_free(%L, %L, %L)', v_s, v_from, v_to),
            pg_catalog.format('SELECT scheduling.fn_has_conflicting_event(%L, %L, %L)', v_s, v_from, v_to),
            pg_catalog.format('SELECT scheduling.fn_is_blacked_out(%L, %L, %L)', v_s, v_from, v_to),
            pg_catalog.format('SELECT scheduling.fn_band_covers(%L, ''working_hours'', %L, %L)', v_s, v_from, v_to),
            pg_catalog.format('SELECT scheduling.fn_call_window_covers(%L, %L, %L)', v_s, v_from, v_to)
        ] LOOP
            BEGIN
                EXECUTE v_sql;
                RAISE EXCEPTION 'FAIL % answered for an unpublished schedule: %', v_role, v_sql;
            EXCEPTION WHEN insufficient_privilege THEN
                NULL;
            END;
        END LOOP;

        -- The published door answers nothing about it.
        SELECT pg_catalog.count(*) INTO v_rows
        FROM scheduling.get_free_busy(v_s::uuid, v_from::timestamptz - interval '1 day', v_to::timestamptz + interval '1 day');
        IF v_rows <> 0 THEN
            RAISE EXCEPTION 'FAIL get_free_busy gave % % busy spans of an unpublished schedule', v_role, v_rows;
        END IF;
        RAISE NOTICE 'PASS % is refused all five helpers (42501) and reads no free/busy of an unpublished schedule', v_role;
    END LOOP;
    PERFORM pg_catalog.set_config('role', 'none', true);
END $$;

-- Published again, a guest still reads its busy spans through the one door built for it.
UPDATE scheduling.schedules SET is_published = true WHERE id = pg_catalog.current_setting('probe.sched')::uuid;
DO $$
DECLARE
    v_rows bigint;
BEGIN
    PERFORM pg_catalog.set_config('role', 'anon', true);
    PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
    IF NOT scheduling.fn_schedule_is_public(pg_catalog.current_setting('probe.sched')::uuid) THEN
        RAISE EXCEPTION 'FAIL fixture: the schedule is not public once published (owner hidden or a minor?)';
    END IF;
    SELECT pg_catalog.count(*) INTO v_rows
    FROM scheduling.get_free_busy(pg_catalog.current_setting('probe.sched')::uuid,
        pg_catalog.current_setting('probe.ev_start')::timestamptz - interval '1 day',
        pg_catalog.current_setting('probe.ev_end')::timestamptz + interval '1 day');
    IF v_rows = 0 THEN
        RAISE EXCEPTION 'FAIL a guest reads no busy span of a published schedule through get_free_busy';
    END IF;
    PERFORM pg_catalog.set_config('role', 'none', true);
    RAISE NOTICE 'PASS a guest reads % busy span(s) of a published schedule through get_free_busy', v_rows;
END $$;
-- #endregion

-- #region 3. PRD-C26 org.get_party_cards
-- A person with a team, a project seat and a conversation is made private. A stranger is told
-- nothing about them; they still read their own card; a public person's card reaches the stranger
-- as before. Then the stranger is given ONE shared context at a time (the owner's ruling, #481 (a)),
-- and the card must appear with it and go again without it.
DO $$
DECLARE
    v_p       uuid;
    v_team    uuid;
    v_role    uuid;
    v_owner   uuid;
    v_project uuid;
    v_powner  uuid;
    v_thread  uuid;
BEGIN
    SELECT tm.user_id, tm.team_id, t.owner_user_id, pp.project_id, p.owner_user_id, d.thread_id
      INTO v_p, v_team, v_owner, v_project, v_powner, v_thread
    FROM org.team_members tm
    JOIN org.teams t ON t.id = tm.team_id
    JOIN projects.project_participants pp ON pp.profile_type = 'freelancer' AND pp.profile_id = tm.user_id
    JOIN projects.projects p ON p.id = pp.project_id AND p.owner_user_id <> tm.user_id
    JOIN comms.dm_participants d ON d.user_id = tm.user_id
    WHERE tm.status = 'active' AND t.owner_user_id <> tm.user_id
        AND NOT EXISTS (SELECT 1 FROM ops.admin_users a WHERE a.user_id = tm.user_id)
    ORDER BY tm.user_id, tm.team_id, pp.project_id, d.thread_id
    LIMIT 1;
    SELECT r.id INTO v_role FROM org.team_roles r WHERE r.team_id = v_team ORDER BY r.id LIMIT 1;
    IF v_p IS NULL OR v_role IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: no active team member with a project seat and a conversation (deno task db:reset)';
    END IF;
    PERFORM pg_catalog.set_config('probe.p', v_p::text, true);
    PERFORM pg_catalog.set_config('probe.p_team', v_team::text, true);
    PERFORM pg_catalog.set_config('probe.p_team_role', v_role::text, true);
    PERFORM pg_catalog.set_config('probe.p_team_owner', v_owner::text, true);
    PERFORM pg_catalog.set_config('probe.p_project', v_project::text, true);
    PERFORM pg_catalog.set_config('probe.p_project_owner', v_powner::text, true);
    PERFORM pg_catalog.set_config('probe.p_thread', v_thread::text, true);
    UPDATE org.users_public SET visibility = 'private' WHERE user_id = v_p;
    RAISE NOTICE 'fixture private person=% team=% project=% thread=%', v_p, v_team, v_project, v_thread;
END $$;

DO $$
DECLARE
    v_private uuid := pg_catalog.current_setting('probe.p')::uuid;
    v_public  uuid;
    v_rows    bigint;
BEGIN
    SELECT u.user_id INTO v_public FROM org.users_public u
    WHERE u.visibility = 'public' AND u.user_id <> pg_catalog.current_setting('probe.stranger')::uuid
    ORDER BY u.user_id LIMIT 1;

    PERFORM pg_catalog.set_config('role', 'authenticated', true);
    PERFORM pg_catalog.set_config('request.jwt.claims',
        pg_catalog.json_build_object('sub', pg_catalog.current_setting('probe.stranger'), 'role', 'authenticated')::text, true);
    SELECT pg_catalog.count(*) INTO v_rows FROM org.get_party_cards(ARRAY[v_private]);
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'FAIL a stranger read a private person''s party card';
    END IF;
    SELECT pg_catalog.count(*) INTO v_rows FROM org.get_party_cards(ARRAY[v_public]);
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'FAIL a stranger lost a public person''s party card';
    END IF;
    RAISE NOTICE 'PASS a stranger reads a public person''s card and not a private one''s';

    PERFORM pg_catalog.set_config('request.jwt.claims',
        pg_catalog.json_build_object('sub', v_private, 'role', 'authenticated')::text, true);
    SELECT pg_catalog.count(*) INTO v_rows FROM org.get_party_cards(ARRAY[v_private]);
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'FAIL a private person lost their own party card';
    END IF;
    RAISE NOTICE 'PASS a private person reads their own card';
    PERFORM pg_catalog.set_config('role', 'none', true);
END $$;

-- One context at a time. Each arm is created as postgres, asked as the stranger, then removed, so the
-- next arm starts from "shares nothing" again.
DO $$
DECLARE
    v_s       uuid := pg_catalog.current_setting('probe.stranger')::uuid;
    v_p       uuid := pg_catalog.current_setting('probe.p')::uuid;
    v_team    uuid := pg_catalog.current_setting('probe.p_team')::uuid;
    v_project uuid := pg_catalog.current_setting('probe.p_project')::uuid;
    v_rows    bigint;
    r         record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('nothing shared',                         false),
            ('a conversation both are in',             true),
            ('a notification the person caused',       true),
            ('an active team membership',              true),
            ('a pending invitation to the team',       true),
            ('a team the stranger has left',           false),
            ('a revoked invitation to the team',       false),
            ('a seat on the same project',             true),
            ('a pending invitation to the project',    true),
            ('a declined invitation to the project',   false),
            ('an application to the project',          true)
        ) AS t(arm, expected)
    LOOP
        PERFORM pg_catalog.set_config('role', 'none', true);
        CASE r.arm
            WHEN 'nothing shared' THEN NULL;
            WHEN 'a conversation both are in' THEN
                INSERT INTO comms.dm_participants (thread_id, user_id)
                VALUES (pg_catalog.current_setting('probe.p_thread')::uuid, v_s);
            WHEN 'a notification the person caused' THEN
                INSERT INTO comms.notifications (user_id, actor_user_id, type, title, body)
                VALUES (v_s, v_p, 'probe.visibility', 'Probe', 'Probe');
            WHEN 'an active team membership' THEN
                INSERT INTO org.team_members (team_id, user_id, role_id)
                VALUES (v_team, v_s, pg_catalog.current_setting('probe.p_team_role')::uuid);
            WHEN 'a pending invitation to the team' THEN
                INSERT INTO org.org_invitations (inviter_user_id, target_user_id, team_id, team_role_id, token, status)
                VALUES (pg_catalog.current_setting('probe.p_team_owner')::uuid, v_s, v_team,
                        pg_catalog.current_setting('probe.p_team_role')::uuid, pg_catalog.gen_random_uuid()::text, 'pending');
            WHEN 'a team the stranger has left' THEN
                INSERT INTO org.team_members (team_id, user_id, role_id, status, left_at)
                VALUES (v_team, v_s, pg_catalog.current_setting('probe.p_team_role')::uuid, 'left', pg_catalog.now());
            WHEN 'a revoked invitation to the team' THEN
                INSERT INTO org.org_invitations (inviter_user_id, target_user_id, team_id, team_role_id, token, status,
                                                 revoked_at, revoked_by)
                VALUES (pg_catalog.current_setting('probe.p_team_owner')::uuid, v_s, v_team,
                        pg_catalog.current_setting('probe.p_team_role')::uuid, pg_catalog.gen_random_uuid()::text, 'revoked',
                        pg_catalog.now(), pg_catalog.current_setting('probe.p_team_owner')::uuid);
            WHEN 'a seat on the same project' THEN
                INSERT INTO projects.project_participants (project_id, profile_type, profile_id, role)
                VALUES (v_project, 'freelancer', v_s, 'assignee');
            WHEN 'a pending invitation to the project' THEN
                INSERT INTO projects.project_invitations (project_id, role, inviter_user_id, token, target_user_id, status)
                VALUES (v_project, 'freelancer', pg_catalog.current_setting('probe.p_project_owner')::uuid,
                        pg_catalog.gen_random_uuid()::text, v_s, 'pending');
            WHEN 'a declined invitation to the project' THEN
                INSERT INTO projects.project_invitations (project_id, role, inviter_user_id, token, target_user_id, status, declined_at)
                VALUES (v_project, 'freelancer', pg_catalog.current_setting('probe.p_project_owner')::uuid,
                        pg_catalog.gen_random_uuid()::text, v_s, 'declined', pg_catalog.now());
            WHEN 'an application to the project' THEN
                INSERT INTO projects.project_applications (project_id, applicant_user_id, applicant_type, applicant_profile_id)
                VALUES (v_project, v_s, 'freelancer', v_s);
        END CASE;

        PERFORM pg_catalog.set_config('role', 'authenticated', true);
        PERFORM pg_catalog.set_config('request.jwt.claims',
            pg_catalog.json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
        SELECT pg_catalog.count(*) INTO v_rows FROM org.get_party_cards(ARRAY[v_p]);
        IF (v_rows = 1) <> r.expected THEN
            RAISE EXCEPTION 'FAIL %: a stranger % the private person''s card', r.arm,
                CASE WHEN r.expected THEN 'did not get' ELSE 'got' END;
        END IF;
        RAISE NOTICE 'PASS %: the card is %', r.arm, CASE WHEN r.expected THEN 'shown' ELSE 'withheld' END;

        PERFORM pg_catalog.set_config('role', 'none', true);
        DELETE FROM comms.dm_participants WHERE user_id = v_s;
        DELETE FROM comms.notifications WHERE user_id = v_s;
        DELETE FROM org.team_members WHERE user_id = v_s;
        DELETE FROM org.org_invitations WHERE target_user_id = v_s;
        DELETE FROM projects.project_participants WHERE profile_id = v_s;
        DELETE FROM projects.project_invitations WHERE target_user_id = v_s;
        DELETE FROM projects.project_applications WHERE applicant_user_id = v_s;
    END LOOP;
END $$;
-- #endregion

ROLLBACK;
