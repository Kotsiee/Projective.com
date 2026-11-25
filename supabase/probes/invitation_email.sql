-- =============================================================================================
-- Probe: an email invitation reaches an address with no account, and the account made from that
-- address answers it (PROJECTS NO1; the owner's rulings 2026-11-25: the mailed token answers only for
-- an account holding the invited address VERIFIED; one transactional mail per invitation behind
-- `project_invite_mail_enabled`, seeded off until counsel confirms the lawful basis ⚖️;
-- `application.received` gains the email channel).
--
-- THE DEFECT (2026-11-25): `projects.invite_by_email` told only a VERIFIED account holder. An address
-- with no account got nothing, because the token in `projects.project_invitations` was never mailed.
-- And nobody could answer an email-addressed invitation at all: `fn_apply_invitation_decision` refuses
-- every such row ("accepted through its link") and no door read the token (Decision #141 (a)).
--
-- What is asserted, as the project's owner unless named:
--   1. The switch is seeded off; with it off, an invitation to a new address queues no mail.
--   2. With it on, the invitation queues exactly one mail in its own transaction. The service-role
--      claim hands back the address, the token and the names once (a second claim inside the lease
--      returns nothing), and finish records it sent. A row queued while on does not go once the
--      switch is off again.
--   3. No mail for a suppressed address, nor for an address with a verified account: that holder is
--      told with `stage.invite`, whose link is the invitation's own `/invite/<token>`.
--   4. Cancel and invite the same address again: no second mail. A mail whose invitation was
--      cancelled before it went is dropped by the claim, never sent.
--   5. The landing read: an unknown token is `invalid`; an account with no verified matching address
--      is `not_yours` with a masked hint, and its answer is refused 42501.
--   6. The account made from the address is `not_yours` until its address is confirmed, then `open`;
--      it accepts. The invitation becomes theirs (`target_user_id`), accepted, and they are on the
--      roster; a second answer is refused 23514 and the landing reads `accepted`.
--   7. An existing verified holder answers through the same link (#141 (a)): here, declines.
--   8. An expired invitation reads `expired`.
--   9. `application.received` carries the email channel.
--  10. The landing and answer doors are `authenticated` only; claim and finish the service role's.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/invitation_email.sql
-- Fixtures are discovered from the seed (deno task db:reset); no ids are hard-coded.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region 0. Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key, true);
$$;

CREATE FUNCTION pg_temp.u(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT NULLIF(pg_catalog.current_setting('probe.' || p_key, true), '')::uuid;
$$;

CREATE FUNCTION pg_temp.put(p_key text, p_value text) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('probe.' || p_key, COALESCE(p_value, ''), true);
$$;

CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Runs p_sql; 'ok' when it succeeds, else its SQLSTATE and message. Every new door goes through here,
-- so the file still parses, and fails on its first assertion, against a database without them.
CREATE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.code(p_outcome text) RETURNS text LANGUAGE sql AS $$
    SELECT CASE WHEN p_outcome = 'ok' THEN 'ok' ELSE pg_catalog.split_part(p_outcome, ' ', 1) END;
$$;

-- The landing read for a token, as whoever is acting: its jsonb, or NULL without the door.
CREATE FUNCTION pg_temp.landing(p_token text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
    IF pg_catalog.to_regprocedure('projects.email_invitation(text)') IS NULL THEN RETURN NULL; END IF;
    EXECUTE 'SELECT projects.email_invitation($1)' INTO v USING p_token;
    RETURN v;
END $$;

CREATE FUNCTION pg_temp.answer(p_token text, p_accept boolean) RETURNS text LANGUAGE sql AS $$
    SELECT pg_temp.try(pg_catalog.format(
        'SELECT projects.answer_email_invitation(%L::text, %L::boolean)', p_token, p_accept));
$$;

-- An email invitation to the probe stage, issued as the owner.
CREATE FUNCTION pg_temp.invite(p_email text) RETURNS uuid LANGUAGE sql AS $$
    SELECT projects.invite_by_email(pg_temp.u('project'), pg_temp.u('stage'), p_email, 'member');
$$;

-- The mails queued for one invitation, read as postgres (the queue has no client policy). NULL while
-- the queue does not exist.
CREATE FUNCTION pg_temp.mails(p_invitation uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
    IF pg_catalog.to_regclass('projects.invitation_mail') IS NULL THEN RETURN NULL; END IF;
    EXECUTE 'SELECT count(*)::integer FROM projects.invitation_mail WHERE invitation_id = $1' INTO v USING p_invitation;
    RETURN v;
END $$;

CREATE FUNCTION pg_temp.token(p_invitation uuid) RETURNS text LANGUAGE sql AS $$
    SELECT i.token FROM projects.project_invitations i WHERE i.id = p_invitation;
$$;

-- Turn the ⚖️ switch, as postgres, inside this transaction only.
CREATE FUNCTION pg_temp.switch(p_on boolean) RETURNS void LANGUAGE sql AS $$
    INSERT INTO security.platform_params (key, value, description)
    VALUES ('project_invite_mail_enabled', pg_catalog.to_jsonb(p_on), 'probe')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
$$;

-- One claim as the service role, kept for the assertions that read it.
CREATE TEMP TABLE probe_claimed (round integer, mail_id uuid, email text, token text, project_title text,
    stage_name text, inviter_name text, role text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.claim(p_round integer) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    IF pg_catalog.to_regprocedure('projects.claim_invitation_mail(integer)') IS NULL THEN
        RETURN 'missing';
    END IF;
    EXECUTE 'INSERT INTO probe_claimed SELECT $1, c.mail_id, c.email, c.token, c.project_title,
                    c.stage_name, c.inviter_name, c.role
               FROM projects.claim_invitation_mail(500) c' USING p_round;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.legal_stamp() RETURNS jsonb LANGUAGE sql AS $$
    SELECT pg_catalog.jsonb_build_object(
        'terms', org.fn_current_legal_version('terms'),
        'acceptable-use', org.fn_current_legal_version('acceptable-use'),
        'privacy', org.fn_current_legal_version('privacy'));
$$;

-- A signed-up adult with this address, confirmed or not: the row GoTrue writes at /join.
CREATE FUNCTION pg_temp.sign_up(p_email text, p_confirmed boolean) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
    VALUES (gen_random_uuid(), p_email, 'authenticated', 'authenticated',
            CASE WHEN p_confirmed THEN pg_catalog.now() END,
            pg_catalog.jsonb_build_object(
                'legal_acceptance', pg_temp.legal_stamp(),
                'username', 'no1probe_' || pg_catalog.substr(pg_catalog.md5(p_email), 1, 10),
                'dob', (CURRENT_DATE - interval '30 years')::date))
    RETURNING id;
$$;

GRANT SELECT, INSERT ON probe_claimed TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean, text), pg_temp.s(text), pg_temp.u(text), pg_temp.put(text, text),
    pg_temp.act(uuid), pg_temp.try(text), pg_temp.code(text), pg_temp.landing(text),
    pg_temp.answer(text, boolean), pg_temp.invite(text), pg_temp.claim(integer)
    TO authenticated, service_role;
-- #endregion

-- #region 1. Fixtures (as postgres)
-- An open project of an individual owner with a stage; a verified account holder who is not on it
-- (H); a second verified account (S), the stranger who holds a forwarded link; fresh addresses that
-- belong to nobody.
DO $$
DECLARE
    c record;
    v_holder record;
    v_stranger uuid;
    v_tag text := pg_catalog.substr(pg_catalog.md5(pg_catalog.clock_timestamp()::text), 1, 12);
BEGIN
    SELECT p.id AS project, p.owner_user_id AS owner, s.id AS stage, p.title INTO c
      FROM projects.projects p
      JOIN projects.project_stages s ON s.project_id = p.id
     WHERE NOT p.is_personal AND p.client_business_id IS NULL AND p.archived_at IS NULL
       AND p.status NOT IN ('archived', 'cancelled', 'completed')
     ORDER BY p.created_at, s.sort_order
     LIMIT 1;
    PERFORM pg_temp.ok(c.project IS NOT NULL, 'the seed holds an open project of an individual owner, with a stage');

    SELECT e.user_id AS uid, lower(e.email) AS email INTO v_holder
      FROM org.user_emails e
     WHERE e.verified_at IS NOT NULL AND e.user_id <> c.owner AND NOT org.fn_is_minor(e.user_id)
       AND NOT EXISTS (SELECT 1 FROM projects.project_participants pp
                        WHERE pp.project_id = c.project AND pp.profile_id = e.user_id)
       AND NOT EXISTS (SELECT 1 FROM projects.project_invitations i
                        WHERE i.project_id = c.project AND i.status = 'pending'
                          AND (i.target_user_id = e.user_id OR lower(i.target_email) = lower(e.email)))
     ORDER BY e.verified_at, e.user_id
     LIMIT 1;
    PERFORM pg_temp.ok(v_holder.uid IS NOT NULL, 'the seed holds a verified account holder off the project');

    SELECT e.user_id INTO v_stranger
      FROM org.user_emails e
     WHERE e.verified_at IS NOT NULL AND e.user_id NOT IN (c.owner, v_holder.uid)
     ORDER BY e.verified_at, e.user_id
     LIMIT 1;
    PERFORM pg_temp.ok(v_stranger IS NOT NULL, 'the seed holds a second verified account');

    PERFORM pg_temp.put('project', c.project::text);
    PERFORM pg_temp.put('stage', c.stage::text);
    PERFORM pg_temp.put('title', c.title);
    PERFORM pg_temp.put('owner', c.owner::text);
    PERFORM pg_temp.put('holder', v_holder.uid::text);
    PERFORM pg_temp.put('holder_email', v_holder.email);
    PERFORM pg_temp.put('stranger', v_stranger::text);
    PERFORM pg_temp.put('seeded', (SELECT pp.value #>> '{}' FROM security.platform_params pp
                                    WHERE pp.key = 'project_invite_mail_enabled'));
    FOREACH v_tag IN ARRAY ARRAY['off', 'new', 'bounced', 'again', 'dropped', 'late', 'expired'] LOOP
        PERFORM pg_temp.put('addr_' || v_tag,
            'no1-' || v_tag || '-' || pg_catalog.substr(pg_catalog.md5(pg_catalog.random()::text), 1, 10) || '@example.com');
    END LOOP;

    INSERT INTO comms.channel_suppressions (channel, destination, reason)
    VALUES ('email', pg_temp.s('addr_bounced'), 'hard_bounce');
END $$;
-- #endregion

-- #region 2. The switch is seeded off, and off sends nothing
DO $$ BEGIN
    PERFORM pg_temp.ok(pg_temp.s('seeded') = 'false', 'project_invite_mail_enabled is seeded false');
END $$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act(pg_temp.u('owner'));
DO $$ BEGIN
    PERFORM pg_temp.put('inv_off', pg_temp.invite(pg_temp.s('addr_off'))::text);
END $$;
RESET ROLE;

DO $$ BEGIN
    PERFORM pg_temp.ok(pg_temp.mails(pg_temp.u('inv_off')) = 0, 'switch off: an invitation to a new address queues no mail');
END $$;
-- #endregion

-- #region 3. Switch on: one mail for a new address, none for a suppressed or a verified one
SELECT pg_temp.switch(true);

SET LOCAL ROLE authenticated;
SELECT pg_temp.act(pg_temp.u('owner'));
DO $$
DECLARE v_first uuid;
BEGIN
    PERFORM pg_temp.put('inv_new', pg_temp.invite(pg_temp.s('addr_new'))::text);
    PERFORM pg_temp.put('inv_bounced', pg_temp.invite(pg_temp.s('addr_bounced'))::text);
    PERFORM pg_temp.put('inv_holder', pg_temp.invite(pg_temp.s('holder_email'))::text);
    PERFORM pg_temp.put('inv_late', pg_temp.invite(pg_temp.s('addr_late'))::text);
    PERFORM pg_temp.put('inv_expired', pg_temp.invite(pg_temp.s('addr_expired'))::text);

    -- Invited, cancelled, invited again.
    v_first := pg_temp.invite(pg_temp.s('addr_again'));
    PERFORM pg_temp.put('inv_again1', v_first::text);
    PERFORM projects.act_on_invitation(v_first, 'cancel');
    PERFORM pg_temp.put('inv_again2', pg_temp.invite(pg_temp.s('addr_again'))::text);

    -- Invited, and cancelled before its mail went.
    v_first := pg_temp.invite(pg_temp.s('addr_dropped'));
    PERFORM pg_temp.put('inv_dropped', v_first::text);
    PERFORM projects.act_on_invitation(v_first, 'cancel');
END $$;
RESET ROLE;

-- The tokens, read as postgres: the people acting below see no invitation row they are not owed.
DO $$ BEGIN
    PERFORM pg_temp.put('tok_new', pg_temp.token(pg_temp.u('inv_new')));
    PERFORM pg_temp.put('tok_holder', pg_temp.token(pg_temp.u('inv_holder')));
    PERFORM pg_temp.put('tok_expired', pg_temp.token(pg_temp.u('inv_expired')));
    PERFORM pg_temp.put('tok_dropped', pg_temp.token(pg_temp.u('inv_dropped')));
END $$;

DO $$
DECLARE v_link text;
BEGIN
    PERFORM pg_temp.ok(pg_temp.mails(pg_temp.u('inv_new')) = 1, 'switch on: a new address''s invitation queues exactly one mail');
    PERFORM pg_temp.ok(pg_temp.mails(pg_temp.u('inv_bounced')) = 0, 'a suppressed address is never queued');
    PERFORM pg_temp.ok(pg_temp.mails(pg_temp.u('inv_holder')) = 0, 'an address with a verified account is told in-app, not mailed');
    PERFORM pg_temp.ok(pg_temp.mails(pg_temp.u('inv_again1')) = 1
                       AND pg_temp.mails(pg_temp.u('inv_again2')) = 0,
                       'cancelling and inviting the same address again queues no second mail');

    SELECT n.action_url INTO v_link
      FROM comms.notifications n
     WHERE n.user_id = pg_temp.u('holder') AND n.type = 'stage.invite'
       AND n.entity_id = pg_temp.u('inv_holder');
    PERFORM pg_temp.ok(v_link = '/invite/' || pg_temp.s('tok_holder'),
                       'the verified holder''s stage.invite links to the invitation''s own /invite/<token>');
END $$;
-- #endregion

-- #region 4. The sender's claim and finish (service role)
SET LOCAL ROLE service_role;
DO $$ BEGIN
    PERFORM pg_temp.ok(pg_temp.claim(1) = 'ok', 'the service role claims queued invitation mail');
END $$;
RESET ROLE;

DO $$
DECLARE r probe_claimed;
BEGIN
    SELECT * INTO r FROM probe_claimed WHERE round = 1 AND token = pg_temp.s('tok_new');
    PERFORM pg_temp.ok(r.mail_id IS NOT NULL AND r.email = pg_temp.s('addr_new'),
                       'the claim hands back the invited address and the invitation''s token');
    PERFORM pg_temp.ok(r.project_title IS NOT NULL AND r.inviter_name IS NOT NULL AND r.role = 'member',
                       'the claim names the project, the inviter and the role');
    PERFORM pg_temp.put('mail_new', r.mail_id::text);

    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM probe_claimed
                                    WHERE token = pg_temp.s('tok_dropped')),
                       'a mail whose invitation was cancelled is not handed out');
    PERFORM pg_temp.ok(pg_temp.mails(pg_temp.u('inv_dropped')) = 0, 'the claim drops it from the queue');
END $$;

-- inv_late was claimed too; queue it again as due, then turn the switch off: it must not go.
UPDATE projects.invitation_mail SET claimed_at = NULL WHERE invitation_id = pg_temp.u('inv_late');
SELECT pg_temp.switch(false);
SET LOCAL ROLE service_role;
SELECT pg_temp.claim(2);
RESET ROLE;
DO $$ BEGIN
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM probe_claimed WHERE round = 2),
                       'with the switch off again, nothing queued is handed out');
    PERFORM pg_temp.ok(pg_temp.mails(pg_temp.u('inv_late')) = 1, 'and what waits stays queued');
END $$;
SELECT pg_temp.switch(true);

SET LOCAL ROLE service_role;
SELECT pg_temp.claim(3);
SELECT projects.finish_invitation_mail(pg_temp.u('mail_new'), true);
RESET ROLE;
DO $$ BEGIN
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM probe_claimed
                                    WHERE round = 3 AND token = pg_temp.s('tok_new')),
                       'a claimed mail is not handed out again inside its lease');
    PERFORM pg_temp.ok((SELECT m.sent_at IS NOT NULL FROM projects.invitation_mail m
                         WHERE m.id = pg_temp.u('mail_new')),
                       'finish records the mail sent');
END $$;
-- #endregion

-- #region 5. The landing read and a stranger's answer
SET LOCAL ROLE authenticated;
SELECT pg_temp.act(pg_temp.u('stranger'));
DO $$
DECLARE v jsonb;
BEGIN
    v := pg_temp.landing(pg_catalog.repeat('0', 64));
    PERFORM pg_temp.ok(v ->> 'state' = 'invalid', 'an unknown token reads invalid');

    v := pg_temp.landing(pg_temp.s('tok_new'));
    PERFORM pg_temp.ok(v ->> 'state' = 'not_yours', 'an account without the invited address reads not_yours');
    PERFORM pg_temp.ok(v ->> 'address_hint' IS NOT NULL AND v ->> 'address_hint' <> pg_temp.s('addr_new')
                       AND v ->> 'project_slug' IS NULL,
                       'not_yours carries a masked hint of the address and no project link');
    PERFORM pg_temp.ok(pg_temp.code(pg_temp.answer(pg_temp.s('tok_new'), true)) = '42501',
                       'a forwarded link does not answer for an account without the invited address');
END $$;
RESET ROLE;
-- #endregion

-- #region 6. The account made from the address answers, once its address is confirmed
DO $$ BEGIN
    PERFORM pg_temp.put('newcomer', pg_temp.sign_up(pg_temp.s('addr_new'), false)::text);
END $$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act(pg_temp.u('newcomer'));
DO $$ BEGIN
    PERFORM pg_temp.ok(pg_temp.landing(pg_temp.s('tok_new')) ->> 'state' = 'not_yours',
                       'before its address is confirmed the new account reads not_yours');
    PERFORM pg_temp.ok(pg_temp.code(pg_temp.answer(pg_temp.s('tok_new'), true)) = '42501',
                       'and cannot answer');
END $$;
RESET ROLE;

UPDATE auth.users SET email_confirmed_at = pg_catalog.now() WHERE id = pg_temp.u('newcomer');

SET LOCAL ROLE authenticated;
SELECT pg_temp.act(pg_temp.u('newcomer'));
DO $$
DECLARE
    v jsonb;
    v_outcome text;
BEGIN
    v := pg_temp.landing(pg_temp.s('tok_new'));
    PERFORM pg_temp.ok(v ->> 'state' = 'open' AND v ->> 'project_title' = pg_temp.s('title')
                       AND v ->> 'project_slug' IS NOT NULL,
                       'once confirmed the new account reads open, with the project');
    v_outcome := pg_temp.answer(pg_temp.s('tok_new'), true);
    PERFORM pg_temp.ok(v_outcome = 'ok', 'the new account accepts: ' || v_outcome);
    PERFORM pg_temp.ok(pg_temp.code(pg_temp.answer(pg_temp.s('tok_new'), true)) = '23514',
                       'a second answer is refused');
    PERFORM pg_temp.ok(pg_temp.landing(pg_temp.s('tok_new')) ->> 'state' = 'accepted',
                       'the landing then reads accepted');
END $$;
RESET ROLE;

DO $$
DECLARE i projects.project_invitations;
BEGIN
    SELECT * INTO i FROM projects.project_invitations WHERE id = pg_temp.u('inv_new');
    PERFORM pg_temp.ok(i.status = 'accepted' AND i.target_user_id = pg_temp.u('newcomer') AND i.target_email IS NULL,
                       'the accepted invitation is now addressed to the account that answered it');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM projects.project_participants pp
                                WHERE pp.project_id = pg_temp.u('project') AND pp.profile_id = pg_temp.u('newcomer')),
                       'the new account is on the project''s roster');
END $$;
-- #endregion

-- #region 7. A verified holder answers through the same kind of link (#141 (a))
SET LOCAL ROLE authenticated;
SELECT pg_temp.act(pg_temp.u('holder'));
DO $$
DECLARE v_outcome text;
BEGIN
    PERFORM pg_temp.ok(pg_temp.landing(pg_temp.s('tok_holder')) ->> 'state' = 'open',
                       'the verified holder reads open');
    v_outcome := pg_temp.answer(pg_temp.s('tok_holder'), false);
    PERFORM pg_temp.ok(v_outcome = 'ok', 'the verified holder declines: ' || v_outcome);
END $$;
RESET ROLE;

DO $$ BEGIN
    PERFORM pg_temp.ok((SELECT i.status = 'declined' AND i.target_user_id = pg_temp.u('holder')
                          FROM projects.project_invitations i WHERE i.id = pg_temp.u('inv_holder')),
                       'the decline is recorded against the holder, so the cooldown counts from it');
END $$;
-- #endregion

-- #region 8. An expired invitation
UPDATE projects.project_invitations SET expires_at = pg_catalog.now() - interval '1 minute'
 WHERE id = pg_temp.u('inv_expired');
DO $$ BEGIN
    PERFORM pg_temp.put('late_joiner', pg_temp.sign_up(pg_temp.s('addr_expired'), true)::text);
END $$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act(pg_temp.u('late_joiner'));
DO $$ BEGIN
    PERFORM pg_temp.ok(pg_temp.landing(pg_temp.s('tok_expired')) ->> 'state' = 'expired',
                       'an expired invitation reads expired');
END $$;
RESET ROLE;
-- #endregion

-- #region 9. application.received emails
DO $$ BEGIN
    PERFORM pg_temp.ok((SELECT 'email' = ANY (t.default_channels) FROM comms.notification_types t
                         WHERE t.key = 'application.received'),
                       'application.received carries the email channel');
END $$;
-- #endregion

-- #region 10. Who may call the doors
DO $$
DECLARE
    v_fn text;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY['projects.email_invitation(text)', 'projects.answer_email_invitation(text,boolean)'] LOOP
        PERFORM pg_temp.ok(pg_catalog.to_regprocedure(v_fn) IS NOT NULL
                           AND pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
                           AND NOT pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE'),
                           v_fn || ' is callable by authenticated only');
    END LOOP;
    FOREACH v_fn IN ARRAY ARRAY['projects.claim_invitation_mail(integer)', 'projects.finish_invitation_mail(uuid,boolean)'] LOOP
        PERFORM pg_temp.ok(pg_catalog.to_regprocedure(v_fn) IS NOT NULL
                           AND pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
                           AND NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
                           AND NOT pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE'),
                           v_fn || ' is the service role''s alone');
    END LOOP;
END $$;
-- #endregion

ROLLBACK;
