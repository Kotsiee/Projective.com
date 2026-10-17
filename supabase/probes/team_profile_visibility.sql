-- =============================================================================================
-- Probe: a team's /:handle — visibility, the member's facts, the public roster, the collective
-- reviews and the Standing readout (Teams P1; TEAMS_AUDIT §4.2; Decisions #226 (b), #250 (b)).
--
--   A. Visibility matrix. For every status x visibility of a team, a stranger and a guest get every
--      profile read (view, roster, reviews, completed projects, owner, identity card) only while it
--      is `active` and `public` or `unlisted`; a member and the owner always get it, and the view's
--      `workspace.hidden_reason` tells them why outsiders do not (archived > draft > invite_only,
--      NULL while it is open). The view carries the real visibility.
--   B. Viewer facts. `workspace.viewer_edits` / `viewer_settings` are the viewer's OWN seat's
--      edit_profile / manage_settings: the owner and admin presets hold both, a lead and a member
--      neither — and a lead given edit_profile through a custom role edits (and manages) the profile
--      (#250 (b)). Outsiders hold nothing and are told nothing. `contact` names the team's owner,
--      whom a Message reaches (a DM is person-to-person, as for a business, #244 (C)).
--   C. Roster. A row is the PUBLIC role — the preset's name, a custom role read as its base preset,
--      never the member's private title or a custom role's name — plus `since` (joined_at) and the
--      member's top two skills by label; nothing else (no title, stake or workload key). The skills
--      are the member's own profile's: a member whose profile is private shows none to a stranger,
--      a guest or a teammate, and their own to themselves.
--   D. Reviews. A team's list is the reviews whose subject is the team, and nothing a member
--      received personally; the hero aggregate is those reviews' average and count.
--   E. Standing. A team's `standing` is its own `org.entity_standing` row's rung, and carries that
--      row's factors (stages, completion, on-time, disputes) only from the volume floor of the
--      ladder's first earned rung (level 2's `min_completed_stages`) — never below it, never for a
--      person (whose rates are not published), and none when the subject has no row (level 1).
--   F. Regression. A business still names its owner `contact`; a person carries no workspace facts.
--   G. Namespace guard. Every top-level route segment is a reserved handle: `/saved` and `/invite`
--      (the two the contract test found unreserved) are refused as handles, in any case.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/team_profile_visibility.sql
--
-- Fixture (seeded): `northloop` (owner kwamemensah, lead samuelnkemelu, member tomaszwojcik; one
-- team review, by danielokafor) and `ateliernova` (owner inesduarte, admin lenamueller). Strangers:
-- noor and a guest. `heliafinance` (owner priyaraman) for the business regression.
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

CREATE FUNCTION pg_temp.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    RAISE NOTICE 'ok   %', p_label;
END $$;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_got text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE(p_ok, false) THEN
        PERFORM pg_temp.pass(p_label);
    ELSE
        PERFORM pg_temp.fail(p_label, 'got ' || COALESCE(p_got, 'NULL'));
    END IF;
END $$;

-- Which profile readers answer the CURRENT actor for a handle, as a mask: V view · R roster ·
-- r reviews · P completed projects · O owner · C identity card; '.' where the reader answered NULL.
CREATE FUNCTION pg_temp.mask(p_handle text, p_type text, p_id uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    RETURN CASE WHEN org.get_profile_view(p_handle) IS NULL THEN '.' ELSE 'V' END
        || CASE WHEN org.get_profile_roster(p_handle) IS NULL THEN '.' ELSE 'R' END
        || CASE WHEN org.get_profile_reviews(p_handle) IS NULL THEN '.' ELSE 'r' END
        || CASE WHEN org.get_profile_past_projects(p_handle) IS NULL THEN '.' ELSE 'P' END
        || CASE WHEN org.get_profile_owner(p_handle) IS NULL THEN '.' ELSE 'O' END
        || CASE WHEN EXISTS (SELECT 1 FROM org.get_profile_cards(ARRAY[p_type], ARRAY[p_id])) THEN 'C' ELSE '.' END;
END $$;

-- One roster row of a handle, by member handle, as the current actor reads it.
CREATE FUNCTION pg_temp.row_of(p_handle text, p_member text) RETURNS jsonb LANGUAGE sql AS $$
    SELECT m FROM jsonb_array_elements(org.get_profile_roster(p_handle) -> 'members') m
    WHERE m ->> 'handle' = p_member;
$$;
-- #endregion

-- #region Fixture
INSERT INTO probe_ids
SELECT u.username, u.user_id FROM org.users_public u
WHERE u.username IN (
    'kwamemensah', 'samuelnkemelu', 'tomaszwojcik', 'inesduarte', 'lenamueller', 'noor', 'priyaraman'
);
INSERT INTO probe_ids VALUES
    ('northloop', (SELECT id FROM org.teams WHERE slug = 'northloop')),
    ('atelier', (SELECT id FROM org.teams WHERE slug = 'ateliernova'));

DO $$
BEGIN
    IF (SELECT count(*) FROM probe_ids WHERE id IS NOT NULL) <> 9 THEN
        RAISE EXCEPTION 'team_profile_visibility: seed fixture missing (%)',
            (SELECT string_agg(k, ', ') FROM probe_ids WHERE id IS NULL);
    END IF;
END $$;
-- #endregion

-- #region A. Visibility matrix
DO $$
DECLARE
    v_status text;
    v_vis text;
    v_open boolean;
    v_reason text;
    v_mask text;
    v_view jsonb;
    v_who text;
BEGIN
    FOREACH v_status IN ARRAY ARRAY['draft', 'active', 'archived'] LOOP
        FOREACH v_vis IN ARRAY ARRAY['public', 'unlisted', 'invite_only'] LOOP
            SET LOCAL session_replication_role = replica;
            UPDATE org.teams SET status = v_status, visibility = v_vis WHERE id = pg_temp.id('northloop');
            SET LOCAL session_replication_role = origin;

            v_open := v_status = 'active' AND v_vis IN ('public', 'unlisted');
            v_reason := CASE
                WHEN v_status = 'archived' THEN 'archived'
                WHEN v_status = 'draft' THEN 'draft'
                WHEN v_vis = 'invite_only' THEN 'invite_only'
            END;

            -- Outsiders: everything or nothing — a hidden team is the unknown handle's 404.
            FOREACH v_who IN ARRAY ARRAY['noor', 'guest'] LOOP
                PERFORM pg_temp.act(CASE WHEN v_who = 'guest' THEN NULL ELSE pg_temp.id(v_who) END);
                v_mask := pg_temp.mask('northloop', 'team', pg_temp.id('northloop'));
                PERFORM pg_temp.check(
                    format('A %s/%s: %s reads %s', v_status, v_vis, v_who, CASE WHEN v_open THEN 'every section' ELSE 'nothing' END),
                    v_mask = CASE WHEN v_open THEN 'VRrPOC' ELSE '......' END,
                    v_mask
                );
            END LOOP;

            -- Insiders: always, with the reason outsiders are turned away.
            FOREACH v_who IN ARRAY ARRAY['tomaszwojcik', 'kwamemensah'] LOOP
                PERFORM pg_temp.act(pg_temp.id(v_who));
                v_mask := pg_temp.mask('northloop', 'team', pg_temp.id('northloop'));
                v_view := org.get_profile_view('northloop');
                PERFORM pg_temp.check(
                    format('A %s/%s: %s reads every section', v_status, v_vis, v_who),
                    v_mask = 'VRrPOC', v_mask
                );
                PERFORM pg_temp.check(
                    format('A %s/%s: %s is told hidden_reason=%s', v_status, v_vis, v_who, COALESCE(v_reason, 'NULL')),
                    v_view ? 'workspace' AND (v_view -> 'workspace' ->> 'hidden_reason') IS NOT DISTINCT FROM v_reason,
                    v_view ->> 'workspace'
                );
                PERFORM pg_temp.check(
                    format('A %s/%s: %s sees the real visibility', v_status, v_vis, v_who),
                    v_view ->> 'visibility' = v_vis, v_view ->> 'visibility'
                );
            END LOOP;
        END LOOP;
    END LOOP;

    SET LOCAL session_replication_role = replica;
    UPDATE org.teams SET status = 'active', visibility = 'public' WHERE id = pg_temp.id('northloop');
    SET LOCAL session_replication_role = origin;
END $$;
-- #endregion

-- #region B. Viewer facts
DO $$
DECLARE
    v jsonb;
    v_who text;
    v_role uuid;
    v_custom jsonb;
BEGIN
    -- The owner and an admin hold edit_profile and manage_settings on their own seats.
    PERFORM pg_temp.act(pg_temp.id('kwamemensah'));
    v := org.get_profile_view('northloop');
    PERFORM pg_temp.check('B northloop owner: viewer_edits + viewer_settings + viewer_is_owner',
        (v -> 'workspace' ->> 'viewer_edits')::boolean AND (v -> 'workspace' ->> 'viewer_settings')::boolean
        AND (v ->> 'viewer_is_owner')::boolean,
        (v ->> 'workspace') || ' owner=' || (v ->> 'viewer_is_owner'));
    PERFORM pg_temp.act(pg_temp.id('lenamueller'));
    v := org.get_profile_view('ateliernova');
    PERFORM pg_temp.check('B ateliernova admin: viewer_edits + viewer_settings + viewer_is_owner',
        (v -> 'workspace' ->> 'viewer_edits')::boolean AND (v -> 'workspace' ->> 'viewer_settings')::boolean
        AND (v ->> 'viewer_is_owner')::boolean,
        (v ->> 'workspace') || ' owner=' || (v ->> 'viewer_is_owner'));

    -- A lead and a member hold neither: edit_profile is the owner's and an admin's (#250 (b)).
    FOREACH v_who IN ARRAY ARRAY['samuelnkemelu', 'tomaszwojcik'] LOOP
        PERFORM pg_temp.act(pg_temp.id(v_who));
        v := org.get_profile_view('northloop');
        PERFORM pg_temp.check('B ' || v_who || ' on northloop: no edit, no settings, not the editor',
            NOT (v -> 'workspace' ->> 'viewer_edits')::boolean
            AND NOT (v -> 'workspace' ->> 'viewer_settings')::boolean
            AND NOT (v ->> 'viewer_is_owner')::boolean,
            (v ->> 'workspace') || ' owner=' || (v ->> 'viewer_is_owner'));
    END LOOP;

    -- A team gives a lead the right through a custom role (#250 (b)).
    BEGIN
        SET LOCAL session_replication_role = replica;
        INSERT INTO org.team_roles (team_id, name, preset, base_preset, capabilities)
        VALUES (pg_temp.id('northloop'), 'Probe editor', NULL, 'lead', '{edit_profile}')
        RETURNING id INTO v_role;
        UPDATE org.team_members SET role_id = v_role
        WHERE team_id = pg_temp.id('northloop') AND user_id = pg_temp.id('samuelnkemelu');
        SET LOCAL session_replication_role = origin;
        PERFORM pg_temp.act(pg_temp.id('samuelnkemelu'));
        v_custom := org.get_profile_view('northloop');
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN SQLSTATE 'PX000' THEN
        NULL;
    END;
    PERFORM pg_temp.check('B a lead granted edit_profile by a custom role edits the profile',
        (v_custom -> 'workspace' ->> 'viewer_edits')::boolean
        AND NOT (v_custom -> 'workspace' ->> 'viewer_settings')::boolean
        AND (v_custom ->> 'viewer_is_owner')::boolean,
        (v_custom ->> 'workspace') || ' owner=' || (v_custom ->> 'viewer_is_owner'));

    -- A stranger and a guest hold nothing and are told nothing.
    FOREACH v_who IN ARRAY ARRAY['noor', 'guest'] LOOP
        PERFORM pg_temp.act(CASE WHEN v_who = 'guest' THEN NULL ELSE pg_temp.id(v_who) END);
        v := org.get_profile_view('northloop');
        PERFORM pg_temp.check('B ' || v_who || ' on northloop: no doors, no hidden reason',
            NOT (v -> 'workspace' ->> 'viewer_edits')::boolean
            AND NOT (v -> 'workspace' ->> 'viewer_settings')::boolean
            AND (v -> 'workspace' ->> 'hidden_reason') IS NULL,
            v ->> 'workspace');
    END LOOP;

    -- A Message reaches a person: the team's owner, as a business's does (#244 (C)).
    PERFORM pg_temp.act(pg_temp.id('noor'));
    v := org.get_profile_view('northloop');
    PERFORM pg_temp.check('B northloop contact is its owner kwamemensah',
        v -> 'contact' ->> 'handle' = 'kwamemensah' AND v -> 'contact' ->> 'name' = 'Kwame Mensah',
        v ->> 'contact');
END $$;
-- #endregion

-- #region C. Roster
DO $$
DECLARE
    v_owner jsonb;
    v_lead jsonb;
    v_custom text;
    v_role uuid;
    v_skills jsonb;
    v_keys text;
    v_private_stranger jsonb;
    v_private_guest jsonb;
    v_private_mate jsonb;
    v_private_self jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('noor'));
    v_owner := pg_temp.row_of('northloop', 'kwamemensah');
    v_lead := pg_temp.row_of('northloop', 'samuelnkemelu');
    PERFORM pg_temp.check('C the owner reads the preset "Owner", not their private title',
        v_owner ->> 'role' = 'Owner', v_owner ->> 'role');
    PERFORM pg_temp.check('C the lead reads the preset "Lead"', v_lead ->> 'role' = 'Lead', v_lead ->> 'role');
    PERFORM pg_temp.check('C since is the membership joined_at',
        (v_owner ->> 'since')::timestamptz = (
            SELECT joined_at FROM org.team_members
            WHERE team_id = pg_temp.id('northloop') AND user_id = pg_temp.id('kwamemensah')
        ),
        v_owner ->> 'since');

    SELECT COALESCE(jsonb_agg(COALESCE(sk.label, s.slug) ORDER BY s.ord), '[]'::jsonb) INTO v_skills
    FROM org.freelancer_profiles f,
        unnest(f.skills) WITH ORDINALITY AS s (slug, ord)
    LEFT JOIN org.skills sk ON sk.slug = s.slug
    WHERE f.user_id = pg_temp.id('kwamemensah') AND s.ord <= 2;
    PERFORM pg_temp.check('C skills are the member''s top two, by label',
        v_owner -> 'skills' = v_skills AND jsonb_array_length(v_skills) = 2,
        (v_owner ->> 'skills') || ' want ' || v_skills::text);

    SELECT string_agg(k, ',' ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_owner) k;
    PERFORM pg_temp.check('C a row carries only public facts — no title, stake or workload',
        v_keys = 'avatar,departments,handle,is_freelancer,name,role,since,skills', v_keys);

    -- A custom role's name is a member-only fact: its holder reads the base preset.
    BEGIN
        SET LOCAL session_replication_role = replica;
        INSERT INTO org.team_roles (team_id, name, preset, base_preset, capabilities)
        VALUES (pg_temp.id('northloop'), 'Probe architect', NULL, 'lead', '{}')
        RETURNING id INTO v_role;
        UPDATE org.team_members SET role_id = v_role
        WHERE team_id = pg_temp.id('northloop') AND user_id = pg_temp.id('samuelnkemelu');
        SET LOCAL session_replication_role = origin;
        v_custom := pg_temp.row_of('northloop', 'samuelnkemelu') ->> 'role';
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN SQLSTATE 'PX000' THEN
        NULL;
    END;
    PERFORM pg_temp.check('C a custom role reads as its base preset, never its name',
        v_custom = 'Lead', v_custom);

    -- The skills are the member's OWN profile's: a private member's reach nobody their profile does
    -- not admit — a stranger, a guest, a teammate — while the row itself stays.
    BEGIN
        SET LOCAL session_replication_role = replica;
        UPDATE org.users_public SET visibility = 'private' WHERE user_id = pg_temp.id('kwamemensah');
        SET LOCAL session_replication_role = origin;
        PERFORM pg_temp.act(pg_temp.id('noor'));
        v_private_stranger := pg_temp.row_of('northloop', 'kwamemensah');
        PERFORM pg_temp.act(NULL);
        v_private_guest := pg_temp.row_of('northloop', 'kwamemensah');
        PERFORM pg_temp.act(pg_temp.id('tomaszwojcik'));
        v_private_mate := pg_temp.row_of('northloop', 'kwamemensah');
        PERFORM pg_temp.act(pg_temp.id('kwamemensah'));
        v_private_self := pg_temp.row_of('northloop', 'kwamemensah');
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN SQLSTATE 'PX000' THEN
        NULL;
    END;
    PERFORM pg_temp.check('C a private member''s row stays, with no skills, for a stranger',
        v_private_stranger ->> 'role' = 'Owner' AND v_private_stranger -> 'skills' = '[]'::jsonb,
        v_private_stranger::text);
    PERFORM pg_temp.check('C … and for a guest',
        v_private_guest IS NOT NULL AND v_private_guest -> 'skills' = '[]'::jsonb,
        v_private_guest::text);
    PERFORM pg_temp.check('C … and for a teammate',
        v_private_mate IS NOT NULL AND v_private_mate -> 'skills' = '[]'::jsonb,
        v_private_mate::text);
    PERFORM pg_temp.check('C a private member still reads their own skills',
        v_private_self -> 'skills' = v_skills, v_private_self::text);
END $$;
-- #endregion

-- #region D. Reviews
DO $$
DECLARE
    v_list jsonb;
    v_view jsonb;
    v_count int;
    v_avg numeric;
    v_member_review uuid;
    v_after jsonb;
BEGIN
    SELECT count(*), round(avg(rating), 2) INTO v_count, v_avg
    FROM reviews.entity_reviews
    WHERE target_entity_type = 'team' AND target_entity_id = pg_temp.id('northloop');

    PERFORM pg_temp.act(pg_temp.id('noor'));
    v_list := org.get_profile_reviews('northloop');
    v_view := org.get_profile_view('northloop');
    PERFORM pg_temp.check(format('D the list is the team''s %s collective review(s)', v_count),
        v_count > 0 AND jsonb_array_length(v_list) = v_count, jsonb_array_length(v_list)::text);
    PERFORM pg_temp.check('D the hero aggregate is those reviews'' average and count',
        (v_view -> 'rating' -> 'as_helper' ->> 'count')::int = v_count
        AND (v_view -> 'rating' -> 'as_helper' ->> 'value')::numeric = v_avg,
        v_view -> 'rating' ->> 'as_helper');
    PERFORM pg_temp.check('D every team review is written from the client side',
        NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) r WHERE r ->> 'author_role' <> 'client'),
        v_list::text);

    -- A review a member received personally is theirs, and never reaches the team's list.
    BEGIN
        SET LOCAL session_replication_role = replica;
        INSERT INTO reviews.entity_reviews (target_entity_id, target_entity_type, reviewer_user_id, rating, comment)
        VALUES (
            pg_temp.id('tomaszwojcik'), 'freelancer', pg_temp.id('noor'), 2.0,
            repeat('A personal review of one member, which the team page must never merge in. ', 3)
        )
        RETURNING id INTO v_member_review;
        SET LOCAL session_replication_role = origin;
        v_after := org.get_profile_reviews('northloop');
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN SQLSTATE 'PX000' THEN
        NULL;
    END;
    PERFORM pg_temp.check('D a member''s own review is not merged into the team''s',
        jsonb_array_length(v_after) = v_count, jsonb_array_length(v_after)::text);
END $$;
-- #endregion

-- #region E. Standing
DO $$
DECLARE
    v jsonb;
    v_row org.entity_standing;
    v_floor int := (SELECT min_completed_stages FROM org.standing_levels WHERE level = 2);
    v_below jsonb;
    v_at jsonb;
    v_person jsonb;
    v_bare jsonb;
BEGIN
    IF v_floor IS NULL OR v_floor < 1 THEN
        RAISE EXCEPTION 'team_profile_visibility: the level-2 volume floor is missing (%)', v_floor;
    END IF;
    SELECT * INTO v_row FROM org.entity_standing
    WHERE subject_type = 'team' AND subject_id = pg_temp.id('northloop');

    PERFORM pg_temp.act(pg_temp.id('noor'));
    v := org.get_profile_view('northloop');
    PERFORM pg_temp.check('E the team''s rung is its own Standing row',
        (v -> 'standing' ->> 'level')::int = v_row.level, v ->> 'standing');

    -- One stage short of the floor, a flawless record cites nothing; at the floor it cites its
    -- factors; a person at the floor never does.
    BEGIN
        SET LOCAL session_replication_role = replica;
        UPDATE org.entity_standing
        SET stages_completed = v_floor - 1, completion_rate = 1, on_time_rate = 1, dispute_rate = 0
        WHERE subject_type = 'team' AND subject_id = pg_temp.id('northloop');
        v_below := org.get_profile_view('northloop');
        UPDATE org.entity_standing
        SET stages_completed = v_floor, completion_rate = 0.9, on_time_rate = 0.8, dispute_rate = 0.05
        WHERE subject_type = 'team' AND subject_id = pg_temp.id('northloop');
        v_at := org.get_profile_view('northloop');
        UPDATE org.entity_standing
        SET stages_completed = v_floor + 10, completion_rate = 1, on_time_rate = 1, dispute_rate = 0
        WHERE subject_type = 'freelancer' AND subject_id = pg_temp.id('kwamemensah');
        IF NOT FOUND THEN
            RAISE EXCEPTION 'team_profile_visibility: kwamemensah has no freelancer Standing row';
        END IF;
        v_person := org.get_profile_view('kwamemensah');
        SET LOCAL session_replication_role = origin;
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN SQLSTATE 'PX000' THEN
        NULL;
    END;
    PERFORM pg_temp.check(format('E below the %s-stage floor: the rung, no factors', v_floor),
        (v_below -> 'standing' ->> 'level')::int = v_row.level
        AND NOT (v_below -> 'standing' ? 'factors'),
        v_below ->> 'standing');
    PERFORM pg_temp.check(format('E at the %s-stage floor: the team''s own factors', v_floor),
        (v_at -> 'standing' -> 'factors' ->> 'stages_completed')::int = v_floor
        AND (v_at -> 'standing' -> 'factors' ->> 'completion_rate')::numeric = 0.9
        AND (v_at -> 'standing' -> 'factors' ->> 'on_time_rate')::numeric = 0.8
        AND (v_at -> 'standing' -> 'factors' ->> 'dispute_rate')::numeric = 0.05,
        v_at -> 'standing' ->> 'factors');
    PERFORM pg_temp.check('E a freelancer past the floor: the rung, no factors',
        v_person -> 'standing' ? 'level' AND NOT (v_person -> 'standing' ? 'factors'),
        v_person ->> 'standing');

    -- No Standing row yet: the rung falls back to level 1, and there is no factor to cite.
    BEGIN
        DELETE FROM org.entity_standing WHERE subject_type = 'team' AND subject_id = pg_temp.id('northloop');
        v_bare := org.get_profile_view('northloop');
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN SQLSTATE 'PX000' THEN
        NULL;
    END;
    PERFORM pg_temp.check('E without a Standing row: level 1, no factors',
        (v_bare -> 'standing' ->> 'level')::int = 1 AND NOT (v_bare -> 'standing' ? 'factors'),
        v_bare ->> 'standing');
END $$;
-- #endregion

-- #region F. Regression
DO $$
DECLARE
    v jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('noor'));
    v := org.get_profile_view('heliafinance');
    PERFORM pg_temp.check('F a business still names its owner contact, with no Standing',
        v -> 'contact' ->> 'handle' = 'priyaraman' AND v ? 'workspace' AND v -> 'standing' = 'null'::jsonb,
        left(v::text, 80));

    PERFORM pg_temp.act(NULL);
    v := org.get_profile_view('noor');
    PERFORM pg_temp.check('F a person carries no workspace facts and no contact',
        v IS NOT NULL AND NOT (v ? 'workspace') AND NOT (v ? 'contact'), left(v::text, 80));
END $$;
-- #endregion

-- #region G. Namespace guard
DO $$
DECLARE
    v_handle text;
BEGIN
    FOREACH v_handle IN ARRAY ARRAY['saved', 'invite', 'Saved', '@invite'] LOOP
        PERFORM pg_temp.check(format('G "%s" is a reserved handle', v_handle),
            org.fn_is_reserved_handle(regexp_replace(v_handle, '^@+', '')),
            org.fn_is_reserved_handle(regexp_replace(v_handle, '^@+', ''))::text);
    END LOOP;
    PERFORM pg_temp.check('G a team cannot take @saved',
        org.fn_handle_refusal('saved') IS NOT NULL, COALESCE(org.fn_handle_refusal('saved'), 'NULL'));
    PERFORM pg_temp.check('G an ordinary handle is still free to the guard',
        NOT org.fn_is_reserved_handle('northloop-studio'), 'reserved');
END $$;
-- #endregion

-- #region Verdict
DO $$
DECLARE
    v_n int := (SELECT count(*) FROM probe_fails);
BEGIN
    IF v_n > 0 THEN
        RAISE EXCEPTION 'team_profile_visibility: % failure(s): %', v_n, (SELECT string_agg(label, '; ') FROM probe_fails);
    END IF;
    RAISE NOTICE 'team_profile_visibility: all checks passed';
END $$;
-- #endregion

ROLLBACK;
