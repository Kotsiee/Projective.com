-- email_bounce.sql — probe for transactional email's provider callbacks and suppression (COMMS_BUILD
-- NT3; Decision #339, ruling N3 (b); CAS §2.5 step 3).
--
--   0. Grants: fn_record_delivery_event and fn_unsubscribe_marketing are service role only; the
--      catalog has account.email_undeliverable (in-app, mandatory) and waitlist.invited emails.
--   1. A hard bounce: the delivery fails for good, the ADDRESS is suppressed for every category,
--      exactly one account.email_undeliverable reaches its owner, the same event replayed changes
--      nothing, a second bounce adds no second notice, and a later mandatory money email comes back
--      'suppressed' from NT2's claim. The account read reports the address undeliverable.
--   2. A complaint suppresses Marketing only; a later hard bounce widens it (one notice).
--   3. delivered marks the delivery delivered; a temporary bounce is only recorded.
--   4. Re-verifying the bounced address mints a token although it is verified, and confirming it lifts
--      the suppression ('reverified'); a deliverable verified address mints none; a marketing-only
--      suppression is not lifted by re-verifying.
--   5. The one-click marketing unsubscribe suppresses the primary address for Marketing only.
--
-- Every section runs in a transaction that is ROLLED BACK, so this is safe on the shared local DB.
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/email_bounce.sql
\set ON_ERROR_STOP on
\set QUIET on

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- The n-th seeded person with notification preferences and a primary verified email.
CREATE FUNCTION pg_temp.person(p_n int) RETURNS uuid LANGUAGE sql AS $$
    SELECT p.user_id
      FROM comms.notification_prefs p
      JOIN org.user_emails ue ON ue.user_id = p.user_id AND ue.is_primary AND ue.verified_at IS NOT NULL
     ORDER BY p.user_id OFFSET p_n - 1 LIMIT 1;
$$;

CREATE FUNCTION pg_temp.address(p_user uuid) RETURNS text LANGUAGE sql AS $$
    SELECT lower(email) FROM org.user_emails WHERE user_id = p_user AND is_primary;
$$;

CREATE FUNCTION pg_temp.primary_id(p_user uuid) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM org.user_emails WHERE user_id = p_user AND is_primary;
$$;

-- Act as `p_user` for auth.uid() (the account read and the confirm door are definers keyed on it).
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.undeliverable(p_user uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
    v boolean;
BEGIN
    PERFORM pg_temp.act(p_user);
    SELECT e.undeliverable INTO v FROM org.get_my_emails() e WHERE e.is_primary;
    RETURN v;
END $$;

CREATE FUNCTION pg_temp.active(p_address text) RETURNS comms.channel_suppressions LANGUAGE sql AS $$
    SELECT * FROM comms.channel_suppressions
     WHERE channel = 'email' AND lower(destination) = lower(p_address) AND lifted_at IS NULL;
$$;

CREATE FUNCTION pg_temp.notices(p_user uuid) RETURNS int LANGUAGE sql AS $$
    SELECT count(*)::int FROM comms.notifications
     WHERE user_id = p_user AND type = 'account.email_undeliverable';
$$;

-- One sent email delivery for `p_user`, tagged with the provider's message id `p_ref`.
CREATE FUNCTION pg_temp.sent_email(p_user uuid, p_ref text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_n uuid;
    v_d uuid;
BEGIN
    UPDATE comms.notification_prefs SET quiet_hours_enabled = false, muted_until = NULL WHERE user_id = p_user;
    v_n := comms.fn_notify(p_user, 'probe.bounce_money', 'Probe money notice', 'Private body');
    UPDATE security.feature_flags SET enabled = true WHERE key = 'comms.dispatch_webhook';
    PERFORM comms.fn_claim_deliveries(ARRAY['email']::comms.notification_channel[], v_n);
    SELECT id INTO v_d FROM comms.notification_deliveries WHERE notification_id = v_n AND channel = 'email';
    PERFORM comms.fn_record_delivery_result(v_d, 'sent', 'resend', p_ref);
    RETURN v_d;
END $$;

CREATE FUNCTION pg_temp.types() RETURNS void LANGUAGE sql AS $$
    INSERT INTO comms.notification_types (key, category, urgency, default_channels, mandatory, digestible)
    VALUES ('probe.bounce_money', 'money', 'high', '{in_app,email}', true, false)
    ON CONFLICT (key) DO NOTHING;
$$;

DO $$
BEGIN
    PERFORM pg_temp.ok(pg_temp.person(3) IS NOT NULL, 'fixture: three seeded people with a primary verified email');
END $$;
-- #endregion

-- #region 0. Grants and the catalog
DO $$
DECLARE
    v_fn text;
    t comms.notification_types;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'comms.fn_record_delivery_event(text,text,text,text,text,text,timestamptz)',
        'comms.fn_unsubscribe_marketing(uuid)'
    ] LOOP
        PERFORM pg_temp.ok(
            has_function_privilege('service_role', v_fn, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
            AND NOT has_function_privilege('anon', v_fn, 'EXECUTE'),
            v_fn || ' is executable by service_role only');
    END LOOP;
    SELECT * INTO t FROM comms.notification_types WHERE key = 'account.email_undeliverable';
    PERFORM pg_temp.ok(t.mandatory AND t.category = 'account' AND t.urgency = 'high'
        AND t.default_channels = '{in_app}' AND t.action_url_template = '/settings/account#emails',
        'account.email_undeliverable: account · high · in-app only · mandatory · /settings/account#emails');
    PERFORM pg_temp.ok((SELECT 'email' = ANY (default_channels) FROM comms.notification_types WHERE key = 'waitlist.invited'),
        'waitlist.invited now routes email too (#455)');
END $$;
-- #endregion

-- #region 1. A hard bounce suppresses the address for every category, once
BEGIN;
DO $$ BEGIN PERFORM pg_temp.types(); END $$;
DO $$
DECLARE
    v_user uuid := pg_temp.person(1);
    v_addr text := pg_temp.address(v_user);
    v_d uuid;
    v_n uuid;
    d comms.notification_deliveries;
    s comms.channel_suppressions;
    r record;
BEGIN
    DELETE FROM comms.channel_suppressions WHERE channel = 'email' AND lower(destination) = v_addr;
    v_d := pg_temp.sent_email(v_user, 'probe_ref_1');

    PERFORM pg_temp.ok(comms.fn_record_delivery_event('resend', 'probe_evt_1', 'email.bounced', 'probe_ref_1',
        upper(v_addr), 'Permanent', now()) = 'hard_bounce', 'a permanent bounce answers hard_bounce');
    SELECT * INTO d FROM comms.notification_deliveries WHERE id = v_d;
    PERFORM pg_temp.ok(d.status = 'failed' AND d.error = 'hard_bounce' AND d.attempts >= 5 AND d.failed_at IS NOT NULL,
        'the delivery fails for good (never retried)');
    s := pg_temp.active(v_addr);
    PERFORM pg_temp.ok(s.id IS NOT NULL AND NOT s.marketing_only AND s.reason = 'hard_bounce' AND s.user_id = v_user
        AND s.source_event_id IS NOT NULL,
        'the address is suppressed for every category (marketing_only false), tied to its event and owner');
    PERFORM pg_temp.ok(comms.fn_is_suppressed('email', v_addr, 'money') AND comms.fn_is_suppressed('email', v_addr, 'system'),
        'fn_is_suppressed refuses it for money and system mail');
    PERFORM pg_temp.ok(pg_temp.notices(v_user) = 1, 'exactly one account.email_undeliverable reaches the owner');
    PERFORM pg_temp.ok((SELECT channels = '{in_app}' AND action_url = '/settings/account#emails'
                          FROM comms.notifications WHERE user_id = v_user AND type = 'account.email_undeliverable'),
        'the notice is in-app only and links to /settings/account#emails');
    PERFORM pg_temp.ok(pg_temp.undeliverable(v_user), 'the account read reports the primary address undeliverable');

    PERFORM pg_temp.ok(comms.fn_record_delivery_event('resend', 'probe_evt_1', 'email.bounced', 'probe_ref_1',
        v_addr, 'Permanent', now()) = 'replayed', 'the same event replayed answers replayed');
    PERFORM pg_temp.ok(comms.fn_record_delivery_event('resend', 'probe_evt_2', 'email.bounced', NULL,
        v_addr, 'Permanent', now()) = 'hard_bounce', 'a second, different bounce is recorded');
    PERFORM pg_temp.ok(pg_temp.notices(v_user) = 1
        AND (SELECT count(*) FROM comms.channel_suppressions WHERE channel = 'email' AND lower(destination) = v_addr AND lifted_at IS NULL) = 1
        AND (SELECT count(*) FROM comms.delivery_events WHERE provider = 'resend' AND provider_event_id LIKE 'probe_evt_%') = 2,
        'replay and repeat change nothing: one suppression, one notice, one event row per event id');

    -- NT2's claim now refuses the address for a mandatory money email.
    v_n := comms.fn_notify(v_user, 'probe.bounce_money', 'Probe later money notice', 'Private body');
    SELECT * INTO r FROM comms.fn_claim_deliveries(ARRAY['email']::comms.notification_channel[], v_n);
    PERFORM pg_temp.ok(r.status = 'suppressed' AND r.suppressed_reason = 'suppressed_destination',
        'a later mandatory money email comes back suppressed from the claim');
END $$;
ROLLBACK;
-- #endregion

-- #region 2. A complaint is Marketing only; a hard bounce widens it
BEGIN;
DO $$
DECLARE
    v_user uuid := pg_temp.person(2);
    v_addr text := pg_temp.address(v_user);
    s comms.channel_suppressions;
BEGIN
    DELETE FROM comms.channel_suppressions WHERE channel = 'email' AND lower(destination) = v_addr;
    DELETE FROM comms.notifications WHERE user_id = v_user AND type = 'account.email_undeliverable';

    PERFORM pg_temp.ok(comms.fn_record_delivery_event('resend', 'probe_evt_c1', 'email.complained', NULL,
        v_addr, NULL, now()) = 'complaint', 'a complaint answers complaint');
    s := pg_temp.active(v_addr);
    PERFORM pg_temp.ok(s.marketing_only AND s.reason = 'complaint', 'a complaint suppresses Marketing only');
    PERFORM pg_temp.ok(comms.fn_is_suppressed('email', v_addr, 'marketing') AND NOT comms.fn_is_suppressed('email', v_addr, 'money'),
        'marketing mail is refused; money mail still goes');
    PERFORM pg_temp.ok(NOT pg_temp.undeliverable(v_user) AND pg_temp.notices(v_user) = 0,
        'a complaint is not undeliverable: no notice, no account flag');

    PERFORM comms.fn_record_delivery_event('resend', 'probe_evt_c2', 'email.bounced', NULL, v_addr, 'Permanent', now());
    s := pg_temp.active(v_addr);
    PERFORM pg_temp.ok(NOT s.marketing_only AND s.reason = 'hard_bounce' AND pg_temp.notices(v_user) = 1,
        'a later hard bounce widens the one row to every category and tells the owner once');
END $$;
ROLLBACK;
-- #endregion

-- #region 3. delivered, and a temporary bounce
BEGIN;
DO $$ BEGIN PERFORM pg_temp.types(); END $$;
DO $$
DECLARE
    v_user uuid := pg_temp.person(3);
    v_addr text := pg_temp.address(v_user);
    v_d uuid;
BEGIN
    DELETE FROM comms.channel_suppressions WHERE channel = 'email' AND lower(destination) = v_addr;
    v_d := pg_temp.sent_email(v_user, 'probe_ref_3');
    PERFORM pg_temp.ok(comms.fn_record_delivery_event('resend', 'probe_evt_d1', 'email.delivered', 'probe_ref_3',
        v_addr, NULL, now()) = 'delivered', 'email.delivered answers delivered');
    PERFORM pg_temp.ok((SELECT status = 'delivered' AND delivered_at IS NOT NULL FROM comms.notification_deliveries WHERE id = v_d),
        'the delivery is delivered');
    PERFORM pg_temp.ok((SELECT delivery_id = v_d FROM comms.delivery_events WHERE provider = 'resend' AND provider_event_id = 'probe_evt_d1'),
        'the event row points at its delivery');

    PERFORM pg_temp.ok(comms.fn_record_delivery_event('resend', 'probe_evt_d2', 'email.bounced', 'probe_ref_3',
        v_addr, 'Temporary', now()) = 'recorded', 'a temporary bounce is only recorded');
    PERFORM pg_temp.ok(pg_temp.active(v_addr) IS NULL OR (pg_temp.active(v_addr)).id IS NULL,
        'a temporary bounce suppresses nothing');
END $$;
ROLLBACK;
-- #endregion

-- #region 4. Re-verifying lifts a hard bounce, and only a hard bounce
BEGIN;
DO $$
DECLARE
    v_user uuid := pg_temp.person(1);
    v_addr text := pg_temp.address(v_user);
    v_email uuid := pg_temp.primary_id(v_user);
    v_token text;
    s comms.channel_suppressions;
BEGIN
    DELETE FROM comms.channel_suppressions WHERE channel = 'email' AND lower(destination) = v_addr;
    PERFORM pg_temp.ok(security.issue_email_verification(v_email) IS NULL,
        'a verified, deliverable address mints no token (nothing to prove)');

    PERFORM comms.fn_record_delivery_event('resend', 'probe_evt_r1', 'email.bounced', NULL, v_addr, 'Permanent', now());
    v_token := security.issue_email_verification(v_email);
    PERFORM pg_temp.ok(v_token IS NOT NULL, 'a verified address that bounced hard mints a token');

    PERFORM pg_temp.act(v_user);
    PERFORM pg_temp.ok(org.confirm_user_email(v_token) = v_email, 'its owner confirms it');
    PERFORM pg_temp.ok(pg_temp.active(v_addr) IS NULL OR (pg_temp.active(v_addr)).id IS NULL,
        'confirming lifts the suppression');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM comms.channel_suppressions
                               WHERE channel = 'email' AND lower(destination) = v_addr AND lifted_reason = 'reverified'),
        'the lifted row is kept (lifted_at, lifted_reason reverified), never deleted');
    PERFORM pg_temp.ok(NOT pg_temp.undeliverable(v_user), 'the account read reports the address deliverable again');

    -- An unsubscribe is consent, not deliverability: re-verifying leaves it.
    PERFORM comms.fn_record_delivery_event('resend', 'probe_evt_r2', 'email.complained', NULL, v_addr, NULL, now());
    PERFORM pg_temp.ok(security.issue_email_verification(v_email) IS NULL,
        'a marketing-only suppression does not open re-verification');
    s := pg_temp.active(v_addr);
    PERFORM pg_temp.ok(s.marketing_only, 'and it stays in place');
END $$;
ROLLBACK;
-- #endregion

-- #region 5. The account's one-click marketing unsubscribe
BEGIN;
DO $$
DECLARE
    v_user uuid := pg_temp.person(2);
    v_addr text := pg_temp.address(v_user);
    s comms.channel_suppressions;
BEGIN
    DELETE FROM comms.channel_suppressions WHERE channel = 'email' AND lower(destination) = v_addr;
    PERFORM pg_temp.ok(comms.fn_unsubscribe_marketing(v_user) = 'unsubscribed', 'one click unsubscribes');
    s := pg_temp.active(v_addr);
    PERFORM pg_temp.ok(s.marketing_only AND s.reason = 'unsubscribe' AND s.user_id = v_user,
        'the primary verified address is suppressed for Marketing only');
    PERFORM pg_temp.ok(comms.fn_unsubscribe_marketing(v_user) = 'already', 'a second click changes nothing');
    PERFORM pg_temp.ok(comms.fn_unsubscribe_marketing(gen_random_uuid()) = 'no_address',
        'a person with no confirmed address has nothing to unsubscribe');
END $$;
ROLLBACK;
-- #endregion
