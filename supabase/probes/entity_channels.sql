-- Decision #306 — entity channels: a team's or business's named rooms on comms.dm_threads
-- (kind = 'entity_channel'), their people kept equal to the entity's active members by trigger.
-- Proves: a member reads the channels on org.get_workspace_detail and a non-member reads none; the
-- participants follow joins and departures; create's name / duplicate / cap refusals; archive's
-- default / authority refusals; an archived channel leaves the list and refuses a send; a channel
-- send works under RLS; the DM lookup, auto-replies and add-members leave channels alone; a new
-- entity gets its `general`. Run on a reset DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/probes/entity_channels.sql
-- Everything runs in one transaction and is rolled back.
BEGIN;
-- North Loop (kwamemensah owner, samuelnkemelu lead, tomaszwojcik member) holds general,
-- delivery-sync and client-updates in the seed; Studio Fern (saoirsebyrne, aikotanaka) only general.
CREATE FUNCTION pg_temp.act(p_username text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
    SELECT u.user_id INTO v FROM org.users_public u WHERE u.username = p_username;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v::text, true);
END $f$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAILED: %', p_what; END IF;
    RAISE NOTICE 'ok — %', p_what;
END $f$;

-- Run a statement and require it to fail with one SQLSTATE.
CREATE FUNCTION pg_temp.refused(p_sql text, p_state text, p_what text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = p_state THEN
            RAISE NOTICE 'ok — % (% %)', p_what, SQLSTATE, SQLERRM;
            RETURN;
        END IF;
        RAISE EXCEPTION 'PROBE FAILED: % — expected %, got % %', p_what, p_state, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION 'PROBE FAILED: % — it was not refused', p_what;
END $f$;

CREATE FUNCTION pg_temp.slugs(p_kind text, p_handle text) RETURNS text[] LANGUAGE sql AS $f$
    SELECT COALESCE(array_agg(c->>'slug' ORDER BY ord), '{}')
      FROM jsonb_array_elements(org.get_workspace_detail(p_kind, p_handle)->'channels') WITH ORDINALITY AS x(c, ord);
$f$;

CREATE FUNCTION pg_temp.uid(p_username text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $f$
    SELECT u.user_id FROM org.users_public u WHERE u.username = p_username;
$f$;

CREATE FUNCTION pg_temp.team(p_slug text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $f$
    SELECT t.id FROM org.teams t WHERE t.slug = p_slug;
$f$;

CREATE FUNCTION pg_temp.channel(p_team text, p_slug text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $f$
    SELECT t.id FROM comms.dm_threads t
     WHERE t.kind = 'entity_channel' AND t.owner_type = 'team' AND t.slug = p_slug
       AND t.owner_entity_id = (SELECT x.id FROM org.teams x WHERE x.slug = p_team) AND t.archived_at IS NULL;
$f$;

CREATE FUNCTION pg_temp.live_participants(p_channel uuid) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $f$
    SELECT count(*) FROM comms.dm_participants p WHERE p.thread_id = p_channel AND p.deleted_at IS NULL;
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.act(text), pg_temp.check(boolean, text), pg_temp.refused(text, text, text),
    pg_temp.slugs(text, text), pg_temp.uid(text), pg_temp.team(text), pg_temp.channel(text, text),
    pg_temp.live_participants(uuid) TO authenticated;

-- #region A member reads the channels; a non-member reads none
SELECT pg_temp.act('tomaszwojcik');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(pg_temp.slugs('team', 'northloop') = ARRAY['general', 'client-updates', 'delivery-sync'],
                     'a member lists North Loop''s channels: the default first, then by slug');
SELECT pg_temp.check((SELECT (c->>'unread')::int = 1 AND c->>'last_activity_at' IS NOT NULL
                        FROM jsonb_array_elements(org.get_workspace_detail('team', 'northloop')->'channels') c
                       WHERE c->>'slug' = 'delivery-sync'),
                     'delivery-sync carries the member''s own unread count (1, seeded) and its last activity');
SELECT pg_temp.check((SELECT count(*) FROM comms.dm_threads t WHERE t.kind = 'entity_channel'
                        AND t.owner_entity_id = pg_temp.team('northloop')) = 3,
                     'the member reads the three channel threads under RLS');
RESET ROLE;

SELECT pg_temp.act('aikotanaka');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(org.get_workspace_detail('team', 'northloop')->>'status' = 'forbidden',
                     'a non-member gets no console, so no channels');
SELECT pg_temp.check((SELECT count(*) FROM comms.dm_threads t WHERE t.kind = 'entity_channel'
                        AND t.owner_entity_id = pg_temp.team('northloop')) = 0,
                     'a non-member reads none of North Loop''s channel threads');
SELECT pg_temp.check((SELECT count(*) FROM comms.dm_messages m
                       WHERE m.thread_id = pg_temp.channel('northloop', 'delivery-sync')) = 0,
                     'nor any of their messages');
SELECT pg_temp.refused($$SELECT comms.create_entity_channel('team', pg_temp.team('northloop'), 'intruders')$$,
                       '42501', 'a non-member cannot add a channel');
SELECT pg_temp.refused($$SELECT comms.archive_entity_channel(pg_temp.channel('northloop', 'client-updates'))$$,
                       'P0002', 'a non-member archiving a real channel is told it does not exist');
RESET ROLE;
-- #endregion

-- #region Participants follow the membership
INSERT INTO org.team_members (team_id, user_id, role_id, role)
SELECT pg_temp.team('northloop'), pg_temp.uid('theo'), r.id, 'member'
  FROM org.team_roles r WHERE r.team_id = pg_temp.team('northloop') AND r.preset = 'member';
SELECT pg_temp.check(pg_temp.live_participants(pg_temp.channel('northloop', 'general')) = 4
                     AND pg_temp.live_participants(pg_temp.channel('northloop', 'delivery-sync')) = 4
                     AND pg_temp.live_participants(pg_temp.channel('northloop', 'client-updates')) = 4,
                     'a new member joins every live channel');

UPDATE org.team_members SET status = 'left', left_at = now()
 WHERE team_id = pg_temp.team('northloop') AND user_id = pg_temp.uid('tomaszwojcik');
SELECT pg_temp.check(pg_temp.live_participants(pg_temp.channel('northloop', 'delivery-sync')) = 3,
                     'a member who leaves is taken out of the channels');
SELECT pg_temp.act('tomaszwojcik');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check((SELECT count(*) FROM comms.dm_messages m
                       WHERE m.thread_id = pg_temp.channel('northloop', 'delivery-sync')) = 0,
                     'and can no longer read their history');
RESET ROLE;

UPDATE org.team_members SET status = 'active', left_at = NULL
 WHERE team_id = pg_temp.team('northloop') AND user_id = pg_temp.uid('tomaszwojcik');
SELECT pg_temp.check(pg_temp.live_participants(pg_temp.channel('northloop', 'delivery-sync')) = 4
                     AND (SELECT count(*) FROM comms.dm_participants p
                           WHERE p.thread_id = pg_temp.channel('northloop', 'delivery-sync')
                             AND p.user_id = pg_temp.uid('tomaszwojcik')) = 1,
                     'rejoining restores the same participation, never a second row');
-- #endregion

-- #region Create: name, duplicate and cap refusals
SELECT pg_temp.act('tomaszwojcik');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check((comms.create_entity_channel('team', pg_temp.team('northloop'), '  # Infra ', 'Servers and spend'))->>'slug' = 'infra',
                     'any active member adds a channel; the name is normalised');
SELECT pg_temp.check(pg_temp.live_participants(pg_temp.channel('northloop', 'infra')) = 4,
                     'every active member is in the new channel');
SELECT pg_temp.refused($$SELECT comms.create_entity_channel('team', pg_temp.team('northloop'), 'delivery-sync')$$,
                       '23505', 'a live duplicate name is refused');
SELECT pg_temp.refused($$SELECT comms.create_entity_channel('team', pg_temp.team('northloop'), '-bad-')$$,
                       '22023', 'a name outside the rule is refused');
SELECT pg_temp.refused($$SELECT comms.create_entity_channel('team', pg_temp.team('northloop'), 'x')$$,
                       '22023', 'a one-character name is refused');
SELECT pg_temp.refused($$SELECT comms.create_entity_channel('team', pg_temp.team('northloop'), 'ok-name', repeat('t', 201))$$,
                       '22023', 'a topic over 200 characters is refused');
SELECT count(comms.create_entity_channel('team', pg_temp.team('northloop'), 'room-' || n)) FROM generate_series(1, 26) n;
SELECT pg_temp.check(cardinality(pg_temp.slugs('team', 'northloop')) = 30, 'thirty live channels');
SELECT pg_temp.refused($$SELECT comms.create_entity_channel('team', pg_temp.team('northloop'), 'one-too-many')$$,
                       '55000', 'the thirty-first is refused');
RESET ROLE;
-- #endregion

-- #region Archive: default, authority, then gone from the list and closed to sends
SELECT pg_temp.act('kwamemensah');
SET LOCAL ROLE authenticated;
SELECT pg_temp.refused($$SELECT comms.archive_entity_channel(pg_temp.channel('northloop', 'general'))$$,
                       '55000', 'the default channel can never be archived');
RESET ROLE;

SELECT pg_temp.act('samuelnkemelu');
SET LOCAL ROLE authenticated;
SELECT pg_temp.refused($$SELECT comms.archive_entity_channel(pg_temp.channel('northloop', 'infra'))$$,
                       '42501', 'a lead without manage_settings cannot archive another''s channel');
RESET ROLE;

SELECT pg_temp.act('tomaszwojcik');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check((comms.archive_entity_channel(pg_temp.channel('northloop', 'infra')))->>'archived_at' IS NOT NULL,
                     'the creator archives their own channel');
SELECT pg_temp.check(NOT ('infra' = ANY (pg_temp.slugs('team', 'northloop'))), 'an archived channel leaves the list');
SELECT pg_temp.refused(
    $$INSERT INTO comms.dm_messages (thread_id, sender_user_id, body)
      SELECT t.id, auth.uid(), 'still here?' FROM comms.dm_threads t
       WHERE t.kind = 'entity_channel' AND t.slug = 'infra' AND t.archived_at IS NOT NULL$$,
    '42501', 'an archived channel refuses a new message');
SELECT pg_temp.check((comms.create_entity_channel('team', pg_temp.team('northloop'), 'room-1-b'))->>'slug' IS NOT NULL
                     AND cardinality(pg_temp.slugs('team', 'northloop')) = 30,
                     'archiving frees a place under the cap');
RESET ROLE;

SELECT pg_temp.act('kwamemensah');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check((comms.archive_entity_channel(pg_temp.channel('northloop', 'room-1')))->>'id' IS NOT NULL,
                     'a manage_settings holder archives somebody else''s channel');
SELECT pg_temp.check((comms.create_entity_channel('team', pg_temp.team('northloop'), 'infra'))->>'slug' = 'infra',
                     'an archived channel''s name can be used again');
RESET ROLE;
-- #endregion

-- #region Sending, and what a channel stays out of
UPDATE comms.notification_prefs SET auto_responses_enabled = true WHERE user_id = pg_temp.uid('saoirsebyrne');
INSERT INTO comms.notification_prefs (user_id, auto_responses_enabled)
SELECT pg_temp.uid('saoirsebyrne'), true
 WHERE NOT EXISTS (SELECT 1 FROM comms.notification_prefs np WHERE np.user_id = pg_temp.uid('saoirsebyrne'));

SELECT pg_temp.act('aikotanaka');
SET LOCAL ROLE authenticated;
INSERT INTO comms.dm_messages (thread_id, sender_user_id, body)
VALUES (pg_temp.channel('studiofern', 'general'), auth.uid(), 'Probe: morning, Fern.');
SELECT pg_temp.check((SELECT count(*) FROM comms.dm_messages m
                       WHERE m.thread_id = pg_temp.channel('studiofern', 'general') AND m.body = 'Probe: morning, Fern.') = 1,
                     'a member posts into a channel under RLS');
SELECT pg_temp.check((SELECT count(*) FROM comms.dm_messages m
                       WHERE m.thread_id = pg_temp.channel('studiofern', 'general') AND m.auto_response_id IS NOT NULL) = 0,
                     'a two-person channel never fires the other member''s auto-reply');
SELECT set_config('probe.dm', comms.get_or_create_dm_thread(pg_temp.uid('saoirsebyrne'))::text, true);
SELECT pg_temp.check((SELECT t.kind FROM comms.dm_threads t
                       WHERE t.id = current_setting('probe.dm')::uuid) IN ('dm', 'service_inquiry'),
                     'two co-members'' DM is never their channel');
SELECT pg_temp.refused($$SELECT comms.add_dm_thread_members(pg_temp.channel('studiofern', 'general'), ARRAY[pg_temp.uid('noor')])$$,
                       '22023', 'nobody is added to a channel by hand');
RESET ROLE;
-- #endregion

-- #region A new entity gets its general
INSERT INTO org.teams (owner_user_id, name, slug) VALUES (pg_temp.uid('chloewinters'), 'Probe Team', 'probe-team-306');
SELECT pg_temp.check((SELECT count(*) FROM comms.dm_threads t
                       WHERE t.kind = 'entity_channel' AND t.owner_entity_id = pg_temp.team('probe-team-306')
                         AND t.slug = 'general' AND t.is_default) = 1,
                     'a new team is created with its default general channel');
-- #endregion

-- #region Grants
SELECT pg_temp.check(has_function_privilege('authenticated', 'comms.create_entity_channel(text, uuid, text, text)', 'EXECUTE')
                     AND has_function_privilege('authenticated', 'comms.archive_entity_channel(uuid)', 'EXECUTE')
                     AND NOT has_function_privilege('anon', 'comms.create_entity_channel(text, uuid, text, text)', 'EXECUTE')
                     AND NOT has_function_privilege('authenticated', 'comms.fn_sync_channel_member(text, uuid, uuid, boolean)', 'EXECUTE')
                     AND NOT has_function_privilege('authenticated', 'comms.fn_entity_channel_list(text, uuid, uuid)', 'EXECUTE'),
                     'the doors are granted to signed-in callers; the internals to nobody');
-- #endregion
ROLLBACK;
