-- =============================================================================================
-- Probe: sharing a file with a person tells them, everything shared with someone is listed in their
-- Shared with me, and a share link cannot outlive its tier (PROJECTS FL4; Decision #570, ruling
-- #402 (d) and (k) as recommended; (e) deferred: the schema has no block pair to check against).
--
-- THE DEFECT (2026-11-25): files.set_item_access inserted a person grant and called no comms.fn_notify,
-- so the grantee was never told; nothing listed the files shared with someone; and files.fn_resolve_share
-- read no items.visibility, so a link made while a file was on Anyone with the link still opened it
-- after the owner set it to Only you.
--
-- What is asserted:
--   1. A new person grant tells that person once (`file.shared`, the file as its entity). A team grant,
--      a change of level and a grant saved on a file left Only you tell nobody.
--   2. files.list_shared_with_me lists a file granted to the caller by name and one granted to a team
--      they are in, with who shared it and through what; never the caller's own file; a file set to
--      Only you leaves the list.
--   3. A live link opens its file while the file is on Anyone with the link. Setting the file to Only
--      you, through the Access tab's door or the hub's direct update, revokes the link in the same
--      transaction (the row is kept, stamped); raising the file again leaves it dead.
--   4. A link minted on a file below Anyone with the link never opens it.
--   5. files.list_shared_with_me is callable by `authenticated`, not by `anon`.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/file_sharing.sql
-- Fixtures are discovered from the seed (deno task db:reset); no ids are hard-coded.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region 0. Helpers and fixtures (as postgres)
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.u(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key)::uuid;
$$;

CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Notices of `file.shared` written to one person in this transaction.
CREATE FUNCTION pg_temp.told(p_user uuid, p_item uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT count(*) FROM comms.notifications n
    WHERE n.user_id = p_user AND n.type = 'file.shared' AND n.entity_id = p_item
      AND n.created_at >= pg_catalog.now();
$$;

-- What one person's Shared with me lists, as that person.
CREATE FUNCTION pg_temp.shared_with(p_user uuid) RETURNS SETOF uuid LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_user);
    RETURN QUERY SELECT s.item_id FROM files.list_shared_with_me() s;
END $$;

CREATE FUNCTION pg_temp.resolves(p_key text) RETURNS boolean LANGUAGE sql AS $$
    SELECT EXISTS (SELECT 1 FROM files.fn_resolve_share(pg_catalog.current_setting('probe.' || p_key)));
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

DO $$
DECLARE
    v_team uuid;
    v_owner uuid;
    v_mate uuid;
    v_person uuid;
    v_granted uuid := gen_random_uuid();
    v_teamed uuid := gen_random_uuid();
    v_linked uuid := gen_random_uuid();
    v_hub uuid := gen_random_uuid();
    v_dormant uuid := gen_random_uuid();
BEGIN
    PERFORM pg_temp.ok(pg_catalog.now() < pg_catalog.statement_timestamp(),
        'the probe runs inside its own transaction');

    -- A team with two active members: the owner shares with it, the mate is reached through it.
    SELECT m.team_id INTO v_team FROM org.team_members m
    JOIN org.teams t ON t.id = m.team_id AND t.status = 'active'
    WHERE m.status = 'active' GROUP BY m.team_id HAVING count(*) >= 2 ORDER BY m.team_id LIMIT 1;
    IF v_team IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture: need a live team with two active members (deno task db:reset)';
    END IF;
    SELECT min(m.user_id::text)::uuid, max(m.user_id::text)::uuid INTO v_owner, v_mate
    FROM org.team_members m WHERE m.team_id = v_team AND m.status = 'active';
    -- A person outside the team.
    SELECT u.user_id INTO v_person FROM org.users_public u
    WHERE NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.team_id = v_team AND m.user_id = u.user_id)
    ORDER BY u.user_id LIMIT 1;
    IF v_person IS NULL THEN RAISE EXCEPTION 'PROBE FAIL: no fixture: need a person outside the team'; END IF;

    INSERT INTO files.items (id, owner_user_id, bucket_id, storage_path, display_name, original_name,
                             mime_type, size_bytes, status, visibility, source, owner_type)
    SELECT f.id, v_owner, 'personal', v_owner || '/' || f.name, f.name, f.name, 'application/pdf', 1024,
           'uploaded', f.tier::files.file_visibility, 'supabase', 'user'
    FROM (VALUES (v_granted, 'probe-share-grant.pdf', 'private'),
                 (v_teamed, 'probe-share-team.pdf', 'private'),
                 (v_linked, 'probe-share-link.pdf', 'link'),
                 (v_hub, 'probe-share-hub.pdf', 'public'),
                 (v_dormant, 'probe-share-dormant.pdf', 'private')) AS f (id, name, tier);
    INSERT INTO files.share_links (slug, item_id, created_by, visibility)
    VALUES (files.fn_mint_share_slug(), v_linked, v_owner, 'link'),
           (files.fn_mint_share_slug(), v_hub, v_owner, 'link'),
           (files.fn_mint_share_slug(), v_dormant, v_owner, 'link');

    PERFORM pg_catalog.set_config('probe.team', v_team::text, true);
    PERFORM pg_catalog.set_config('probe.owner', v_owner::text, true);
    PERFORM pg_catalog.set_config('probe.mate', v_mate::text, true);
    PERFORM pg_catalog.set_config('probe.person', v_person::text, true);
    PERFORM pg_catalog.set_config('probe.granted', v_granted::text, true);
    PERFORM pg_catalog.set_config('probe.teamed', v_teamed::text, true);
    PERFORM pg_catalog.set_config('probe.linked', v_linked::text, true);
    PERFORM pg_catalog.set_config('probe.hub', v_hub::text, true);
    PERFORM pg_catalog.set_config('probe.dormant', v_dormant::text, true);
    PERFORM pg_catalog.set_config('probe.link_slug',
        (SELECT s.slug FROM files.share_links s WHERE s.item_id = v_linked), true);
    PERFORM pg_catalog.set_config('probe.hub_slug',
        (SELECT s.slug FROM files.share_links s WHERE s.item_id = v_hub), true);
    PERFORM pg_catalog.set_config('probe.dormant_slug',
        (SELECT s.slug FROM files.share_links s WHERE s.item_id = v_dormant), true);
END $$;
-- #endregion

-- #region 1. A person grant tells that person; a team grant, a level change and a private save tell nobody
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM pg_temp.act(pg_temp.u('owner'));
    -- Saved on Only you, a grant opens nothing, so nobody is told.
    PERFORM files.set_item_access(pg_temp.u('granted'), NULL, NULL, pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('kind', 'user', 'id', pg_temp.u('person'), 'role', 'viewer')));
    PERFORM files.set_item_access(pg_temp.u('granted'), NULL, NULL, '[]'::jsonb);
    PERFORM files.set_item_access(pg_temp.u('granted'), 'restricted', NULL, pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('kind', 'user', 'id', pg_temp.u('person'), 'role', 'viewer')));
    PERFORM files.set_item_access(pg_temp.u('granted'), NULL, NULL, pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('kind', 'user', 'id', pg_temp.u('person'), 'role', 'editor')));
    PERFORM files.set_item_access(pg_temp.u('teamed'), 'restricted', NULL, pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('kind', 'team', 'id', pg_temp.u('team'), 'role', 'viewer')));
END $$;
RESET ROLE;

DO $$
DECLARE
    v_n comms.notifications%ROWTYPE;
BEGIN
    PERFORM pg_temp.ok(pg_temp.told(pg_temp.u('person'), pg_temp.u('granted')) = 1,
        '(d) the person a file is shared with is told once, in the same transaction');
    SELECT * INTO v_n FROM comms.notifications n
    WHERE n.user_id = pg_temp.u('person') AND n.type = 'file.shared' AND n.entity_id = pg_temp.u('granted');
    PERFORM pg_temp.ok(v_n.actor_user_id = pg_temp.u('owner') AND v_n.body = 'probe-share-grant.pdf'
        AND v_n.entity_table = 'files.items' AND v_n.action_url = '/inspect/' || pg_temp.u('granted'),
        '(d) the notice names the sharer, the file and opens it in the inspector');
    PERFORM pg_temp.ok(pg_temp.told(pg_temp.u('mate'), pg_temp.u('teamed')) = 0,
        '(d) a team grant tells none of its members');
END $$;
-- #endregion

-- #region 2. Shared with me lists direct and group grants, never the caller's own
DO $$
DECLARE
    v_row record;
BEGIN
    PERFORM pg_temp.ok(pg_temp.u('granted') IN (SELECT pg_temp.shared_with(pg_temp.u('person'))),
        'Shared with me lists a file granted to the caller by name');
    PERFORM pg_temp.ok(pg_temp.u('teamed') IN (SELECT pg_temp.shared_with(pg_temp.u('mate'))),
        'Shared with me lists a file granted to a team the caller is in');
    PERFORM pg_temp.ok(pg_temp.u('teamed') NOT IN (SELECT pg_temp.shared_with(pg_temp.u('person'))),
        'a team grant does not reach someone outside the team');
    PERFORM pg_temp.ok(pg_temp.u('teamed') NOT IN (SELECT pg_temp.shared_with(pg_temp.u('owner'))),
        'Shared with me never lists the caller''s own file');

    PERFORM pg_temp.act(pg_temp.u('mate'));
    SELECT * INTO v_row FROM files.list_shared_with_me() s WHERE s.item_id = pg_temp.u('teamed');
    PERFORM pg_temp.ok(v_row.via_kind = 'team' AND v_row.via_name IS NOT NULL AND v_row.role = 'viewer'
        AND v_row.shared_by = pg_temp.u('owner') AND v_row.name = 'probe-share-team.pdf',
        'a row says what was shared, by whom, through which team and at what level');
END $$;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM pg_temp.act(pg_temp.u('owner'));
    PERFORM files.set_item_access(pg_temp.u('teamed'), 'private', NULL, NULL);
END $$;
RESET ROLE;

DO $$
BEGIN
    PERFORM pg_temp.ok(pg_temp.u('teamed') NOT IN (SELECT pg_temp.shared_with(pg_temp.u('mate'))),
        'a file set to Only you leaves Shared with me');
END $$;
-- #endregion

-- #region 3. A link does not outlive its tier, through either write
DO $$
BEGIN
    PERFORM pg_temp.ok(pg_temp.resolves('link_slug') AND pg_temp.resolves('hub_slug'),
        '(k) a live link opens its file while the file is on Anyone with the link or Public');
END $$;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM pg_temp.act(pg_temp.u('owner'));
    PERFORM files.set_item_access(pg_temp.u('linked'), 'private', NULL, NULL);
    -- The hub's visibility change is a direct UPDATE under the owner's session.
    UPDATE files.items SET visibility = 'restricted' WHERE id = pg_temp.u('hub');
END $$;
RESET ROLE;

DO $$
BEGIN
    PERFORM pg_temp.ok(NOT pg_temp.resolves('link_slug'),
        '(k) once the file is Only you, its link resolves to nothing');
    PERFORM pg_temp.ok(NOT pg_temp.resolves('hub_slug'),
        '(k) the hub''s own tier change to Specific people stops its link too');
    PERFORM pg_temp.ok((SELECT count(*) FROM files.share_links s
                        WHERE s.item_id IN (pg_temp.u('linked'), pg_temp.u('hub'))
                          AND s.revoked_at = pg_catalog.now()) = 2,
        '(k) both links are revoked in the same transaction, their rows kept');
END $$;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM pg_temp.act(pg_temp.u('owner'));
    PERFORM files.set_item_access(pg_temp.u('linked'), 'link', NULL, NULL);
END $$;
RESET ROLE;

DO $$
BEGIN
    PERFORM pg_temp.ok(NOT pg_temp.resolves('link_slug'),
        '(k) raising the file again leaves the revoked link dead');
END $$;
-- #endregion

-- #region 4. A link minted below Anyone with the link never opens the file
DO $$
BEGIN
    PERFORM pg_temp.ok(NOT pg_temp.resolves('dormant_slug'),
        '(k) a link to a file on Only you opens nothing');
END $$;
-- #endregion

-- #region 5. Who may call the list
DO $$
BEGIN
    PERFORM pg_temp.ok(pg_catalog.has_function_privilege('authenticated', 'files.list_shared_with_me(integer)', 'EXECUTE'),
        'authenticated may read its own Shared with me');
    PERFORM pg_temp.ok(NOT pg_catalog.has_function_privilege('anon', 'files.list_shared_with_me(integer)', 'EXECUTE'),
        'anon may not');
    PERFORM pg_temp.ok(NOT pg_catalog.has_function_privilege('authenticated', 'files.fn_revoke_links_on_tier_drop()', 'EXECUTE'),
        'nobody calls the trigger function');
END $$;
-- #endregion

ROLLBACK;
