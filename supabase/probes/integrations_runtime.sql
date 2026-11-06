-- =============================================================================================
-- Probe: the connector runtime's doors (SCH-WP4a; Decision #343, ruling C4; Decision #383).
--
--   1. The vault's columns: ck_secret_nonces refuses a cipher without its nonce, and wrapped_dek and
--      its nonce are required.
--   2. The catalogue: the direct providers carry auth_config and the ruled scopes, Notion lost
--      `calendar`, the three jobs are registered, integration.reconnect_required is catalogued.
--   3. A consent is bound to auth.uid(), never to a caller's claim; consent_states has no client door
--      but fn_open_consent; the sweep drops only what is a day past its window.
--   4. fn_store_connection: one transaction; an already-linked account answers its own id and writes
--      nothing; a reconnect reopens the row.
--   5. The refresh claim: who is due, who is not, the lease; a stale commit writes nothing; invalid_grant
--      moves a connection to `expired` and tells its owner once; three transient failures degrade it.
--   6. Channels: the claim, a renewal, three failures degrade the connection.
--   7. Webhooks: a replayed presence delivery is one ledger row and one effect, and a failed effect
--      leaves no claim; a replayed app_deauthorized revokes once.
--   8. fn_revoke_connection: secrets gone, channels expired, busy rows cancelled and archived.
--   9. Grants: every door is the service role's, the two internals nobody's.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/integrations_runtime.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts (non-zero exit under
-- ON_ERROR_STOP). Fixtures are discovered from the seed (deno task db:reset) or built here. No door here
-- reads is_enabled: the service offers a provider only with this environment's client behind it.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

-- #region 0. Helpers
CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- An envelope as token-vault.ts hands it over; the bytes mean nothing to SQL, only their columns do.
CREATE FUNCTION pg_temp.secret(p_refresh text DEFAULT '\xbb') RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'key_id', 'env:00000000', 'wrapped_dek', '\xd0', 'wrapped_dek_nonce', '\xd1',
        'access_token_cipher', '\xaa', 'nonce', '\xa1',
        'refresh_token_cipher', p_refresh, 'refresh_token_nonce', '\xb1'
    );
$$;

CREATE FUNCTION pg_temp.user_at(p_offset integer) RETURNS uuid LANGUAGE sql AS $$
    SELECT p.user_id FROM org.users_public p ORDER BY p.user_id OFFSET p_offset LIMIT 1;
$$;

-- A connection through the real door, an hour old unless the caller moves it.
CREATE FUNCTION pg_temp.connect(p_user uuid, p_provider text, p_account text) RETURNS uuid
LANGUAGE sql AS $$
    SELECT integrations.fn_store_connection(
        gen_random_uuid(), p_user, p_provider, p_account, NULL,
        ARRAY['calendar']::integrations.provider_kind[], ARRAY['s'],
        now() + interval '5 minutes', NULL, pg_temp.secret()
    );
$$;

CREATE FUNCTION pg_temp.refused(p_sql text, p_state text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
        RETURN v_state = p_state;
    END;
    RETURN false;
END $$;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- The probe's own connections, so a connection the seed may carry never answers for one here.
CREATE TEMP TABLE probe_claims (rows jsonb) ON COMMIT DROP;
-- #endregion

-- #region 1. The vault's columns
DO $$
DECLARE
    v_user uuid := pg_temp.user_at(0);
    v_id uuid;
    v_prefix text := 'INSERT INTO integrations.connection_secrets (connection_id, key_id, wrapped_dek, wrapped_dek_nonce';
BEGIN
    INSERT INTO integrations.user_connections (user_id, provider_slug, external_account_id)
    VALUES (v_user, 'google', 'probe-nonces') RETURNING id INTO v_id;
    PERFORM pg_temp.check(pg_temp.refused(
        format('%s, access_token_cipher) VALUES (%L, %L, %L, %L, %L)', v_prefix, v_id, 'k', '\x01', '\x02', '\x03'),
        '23514'), 'ck_secret_nonces refuses an access token without its nonce');
    PERFORM pg_temp.check(pg_temp.refused(
        format('%s, refresh_token_cipher) VALUES (%L, %L, %L, %L, %L)', v_prefix, v_id, 'k', '\x01', '\x02', '\x03'),
        '23514'), 'ck_secret_nonces refuses a refresh token without its nonce');
    PERFORM pg_temp.check(pg_temp.refused(
        format('%s, api_secret_cipher) VALUES (%L, %L, %L, %L, %L)', v_prefix, v_id, 'k', '\x01', '\x02', '\x03'),
        '23514'), 'ck_secret_nonces refuses an API secret without its nonce');
    PERFORM pg_temp.check(pg_temp.refused(
        format('INSERT INTO integrations.connection_secrets (connection_id, key_id, wrapped_dek_nonce) VALUES (%L, %L, %L)', v_id, 'k', '\x02'),
        '23502'), 'wrapped_dek is required');
    PERFORM pg_temp.check(pg_temp.refused(
        format('INSERT INTO integrations.connection_secrets (connection_id, key_id, wrapped_dek) VALUES (%L, %L, %L)', v_id, 'k', '\x01'),
        '23502'), 'the wrapped DEK''s nonce is required');
END $$;
-- #endregion

-- #region 2. The catalogue
DO $$
DECLARE
    v_google integrations.providers;
    v_outlook integrations.providers;
    v_zoom integrations.providers;
BEGIN
    SELECT * INTO v_google FROM integrations.providers WHERE slug = 'google';
    SELECT * INTO v_outlook FROM integrations.providers WHERE slug = 'outlook';
    SELECT * INTO v_zoom FROM integrations.providers WHERE slug = 'zoom';

    PERFORM pg_temp.check(v_google.broker = 'direct' AND v_outlook.broker = 'direct', 'calendars are direct, no Nylas (R1)');
    PERFORM pg_temp.check(v_google.supports_webhooks AND v_zoom.supports_webhooks, 'google and zoom take webhooks');
    PERFORM pg_temp.check(
        'https://www.googleapis.com/auth/calendar.events.owned.readonly' = ANY (v_google.default_scopes)
        AND NOT 'https://www.googleapis.com/auth/calendar.events' = ANY (v_google.default_scopes),
        'google reads the calendars a person owns, and cannot change an event on them');
    PERFORM pg_temp.check(ARRAY['offline_access', 'User.Read'] <@ v_outlook.default_scopes, 'outlook can refresh and identify');
    PERFORM pg_temp.check('meeting:write:meeting' = ANY (v_zoom.default_scopes), 'zoom has granular scopes');
    PERFORM pg_temp.check(
        v_google.auth_config ->> 'token_url' = 'https://oauth2.googleapis.com/token'
        AND v_google.auth_config -> 'authorize_params' ->> 'access_type' = 'offline'
        AND (v_google.auth_config ->> 'pkce')::boolean,
        'google carries its endpoints, PKCE and offline access');
    PERFORM pg_temp.check(
        v_outlook.auth_config ->> 'authorize_url' LIKE '%{tenant}%' AND NOT v_outlook.auth_config ? 'revoke_url',
        'outlook''s URLs carry {tenant}, and it has no revoke endpoint');
    PERFORM pg_temp.check(v_zoom.auth_config ->> 'token_auth' = 'basic', 'zoom authenticates with HTTP Basic');
    PERFORM pg_temp.check(
        (SELECT array_agg(slug ORDER BY slug) FROM integrations.providers WHERE is_enabled)
            = ARRAY['google', 'google_drive', 'outlook', 'zoom'],
        'only the providers with a consent flow ship on, and credentials decide the rest');
    PERFORM pg_temp.check((v_zoom.auth_config ->> 'send_scopes')::boolean IS FALSE,
        'zoom''s consent URL names no scopes, which it would refuse');
    PERFORM pg_temp.check(
        (SELECT NOT 'calendar'::integrations.provider_kind = ANY (capabilities) FROM integrations.providers WHERE slug = 'notion'),
        'notion lost the calendar capability (R9)');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM integrations.providers WHERE slug = 'microsoft_teams' AND auth_config = '{}'),
        'microsoft_teams stays as vocabulary, with no consent of its own');
    PERFORM pg_temp.check(
        (SELECT broker FROM integrations.providers WHERE slug = 'apple') = 'nylas',
        'apple is left alone');

    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM ops.scheduled_jobs WHERE name = 'integrations-refresh-tokens'
                 AND kind = 'http' AND schedule = '*/10 * * * *' AND secret_name = 'INTEGRATIONS_CRON_SECRET'
                 AND path = '/api/integrations/cron/refresh?limit=100'),
        'the refresh job is an http job every 10 minutes');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM ops.scheduled_jobs WHERE name = 'integrations-renew-channels'
                 AND kind = 'http' AND schedule = '35 * * * *' AND secret_name = 'INTEGRATIONS_CRON_SECRET'
                 AND path = '/api/integrations/cron/channels?limit=100'),
        'the renewal job is an http job at :35');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM ops.scheduled_jobs WHERE name = 'integrations-consent-sweep'
                 AND kind = 'sql' AND schedule = '25 3 * * *'),
        'the consent sweep is a daily sql job');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM comms.notification_types WHERE key = 'integration.reconnect_required'
                 AND category = 'account' AND NOT mandatory),
        'integration.reconnect_required is catalogued: account, not mandatory');
END $$;
-- #endregion

-- #region 3. Consent
DO $$
DECLARE
    v_user uuid := pg_temp.user_at(0);
    v_state text := repeat('a', 43);
    v_expires timestamptz;
    v_row integrations.consent_states;
BEGIN
    PERFORM pg_temp.check(
        (SELECT relrowsecurity FROM pg_class WHERE oid = 'integrations.consent_states'::regclass),
        'consent_states has RLS on');
    PERFORM pg_temp.check(
        NOT has_table_privilege('authenticated', 'integrations.consent_states', 'SELECT')
        AND NOT has_table_privilege('anon', 'integrations.consent_states', 'SELECT'),
        'no client reads a consent, whose state is the credential');
    PERFORM pg_temp.check(
        has_table_privilege('service_role', 'integrations.consent_states', 'UPDATE'),
        'the service role spends consents');

    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM pg_temp.check(pg_temp.refused(
        format('SELECT integrations.fn_open_consent(%L, %L, NULL, %L, NULL)', v_state, 'google', '{freebusy}'),
        '42501'), 'a consent needs a signed-in caller');

    PERFORM pg_temp.as_user(v_user);
    v_expires := integrations.fn_open_consent(v_state, 'google', 'verifier', '{freebusy}', '/calendar');
    SELECT * INTO v_row FROM integrations.consent_states WHERE state = v_state;
    PERFORM pg_temp.check(v_row.user_id = v_user, 'the consent is bound to auth.uid()');
    PERFORM pg_temp.check(v_expires = now() + interval '10 minutes', 'the window is 10 minutes, set by the door');
    PERFORM pg_temp.check(v_row.return_to = '/calendar', 'the return path is stored');
    PERFORM pg_temp.check(pg_temp.refused(
        format('SELECT integrations.fn_open_consent(%L, %L, NULL, %L, %L)', repeat('b', 43), 'google', '{freebusy}', '//evil.example'),
        '23514'), 'a protocol-relative return path is unrepresentable');

    UPDATE integrations.consent_states
       SET created_at = now() - interval '3 days', expires_at = now() - interval '2 days'
     WHERE state = v_state;
    INSERT INTO integrations.consent_states (state, user_id, provider_slug, created_at, expires_at)
    VALUES (repeat('c', 43), v_user, 'google', now() - interval '2 hours', now() - interval '1 hour');
    PERFORM integrations.fn_sweep_consent_states();
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM integrations.consent_states WHERE state = v_state)
        AND EXISTS (SELECT 1 FROM integrations.consent_states WHERE state = repeat('c', 43)),
        'the sweep drops only what is a day past its window');
    PERFORM set_config('request.jwt.claims', '', true);
END $$;
-- #endregion

-- #region 4. Storing a consent
DO $$
DECLARE
    v_user uuid := pg_temp.user_at(0);
    v_id uuid := gen_random_uuid();
    v_got uuid;
    v_stale uuid := gen_random_uuid();
BEGIN
    v_got := integrations.fn_store_connection(
        v_id, v_user, 'google', 'probe-store', 'ada@example.com',
        '{calendar,freebusy}', ARRAY['s1'], now() + interval '1 hour', NULL, pg_temp.secret());
    PERFORM pg_temp.check(v_got = v_id, 'a new account stores under the caller''s id');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM integrations.user_connections
                 WHERE id = v_id AND status = 'active' AND connected_at IS NOT NULL
                   AND granted_kinds = '{calendar,freebusy}'),
        'the connection is active with what was granted');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM integrations.connection_secrets
                 WHERE connection_id = v_id AND wrapped_dek = '\xd0' AND refresh_token_nonce = '\xb1'
                   AND access_token_expires_at IS NOT NULL),
        'the envelope lands column by column');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM integrations.connection_audit WHERE connection_id = v_id AND action = 'connected') = 1,
        'one connected line');

    v_got := integrations.fn_store_connection(
        v_stale, v_user, 'google', 'probe-store', 'other@example.com',
        '{calendar}', ARRAY['s2'], NULL, NULL, pg_temp.secret('\xcc'));
    PERFORM pg_temp.check(v_got = v_id, 'an already-linked account answers its own id');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM integrations.user_connections WHERE id = v_stale)
        AND (SELECT refresh_token_cipher FROM integrations.connection_secrets WHERE connection_id = v_id) = '\xbb'
        AND (SELECT external_account_label FROM integrations.user_connections WHERE id = v_id) = 'ada@example.com',
        'and nothing was written under the other id');

    PERFORM integrations.fn_revoke_connection(v_id);
    v_got := integrations.fn_store_connection(
        v_id, v_user, 'google', 'probe-store', 'ada@example.com',
        '{calendar}', ARRAY['s3'], now() + interval '1 hour', NULL, pg_temp.secret('\xcc'));
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM integrations.user_connections
                 WHERE id = v_id AND status = 'active' AND revoked_at IS NULL AND granted_scopes = ARRAY['s3'])
        AND (SELECT count(*) FROM integrations.connection_audit WHERE connection_id = v_id AND action = 'reconnected') = 1,
        'a fresh consent reopens the row, as a reconnect');
END $$;
-- #endregion

-- #region 5. Refresh
DO $$
DECLARE
    v_user uuid := pg_temp.user_at(1);
    v_due uuid := pg_temp.connect(v_user, 'google', 'probe-due');
    v_idle uuid := pg_temp.connect(v_user, 'google', 'probe-idle');
    v_fresh uuid := pg_temp.connect(v_user, 'google', 'probe-fresh');
    v_keep uuid := pg_temp.connect(v_user, 'google', 'probe-keepalive');
    v_expired uuid := pg_temp.connect(v_user, 'google', 'probe-expired');
    v_claimed jsonb;
    v_ids text[];
    v_note integer;
BEGIN
    -- Idle: its token has lapsed, but nobody has used it this week.
    UPDATE integrations.user_connections SET connected_at = now() - interval '8 days' WHERE id = v_idle;
    -- Fresh: its token has an hour to run.
    UPDATE integrations.connection_secrets SET access_token_expires_at = now() + interval '1 hour' WHERE connection_id = v_fresh;
    -- Keep-alive: idle too, but not refreshed in over 30 days. The touch trigger sets updated_at, so
    -- it is stepped out of the way to backdate this row.
    ALTER TABLE integrations.connection_secrets DISABLE TRIGGER trg_connection_secrets_touch;
    UPDATE integrations.connection_secrets SET updated_at = now() - interval '31 days' WHERE connection_id = v_keep;
    ALTER TABLE integrations.connection_secrets ENABLE TRIGGER trg_connection_secrets_touch;
    UPDATE integrations.user_connections SET connected_at = now() - interval '40 days' WHERE id = v_keep;
    UPDATE integrations.user_connections SET status = 'expired' WHERE id = v_expired;

    v_claimed := integrations.fn_claim_connections_for_refresh(500);
    SELECT array_agg(e -> 'secret' ->> 'connection_id') INTO v_ids FROM jsonb_array_elements(v_claimed) e;
    PERFORM pg_temp.check(v_due::text = ANY (v_ids), 'a connection in use, near expiry, is due');
    PERFORM pg_temp.check(v_keep::text = ANY (v_ids), 'one not refreshed in 30 days is due, as a keep-alive');
    PERFORM pg_temp.check(NOT v_idle::text = ANY (v_ids), 'one nobody used this week waits');
    PERFORM pg_temp.check(NOT v_fresh::text = ANY (v_ids), 'one with time left waits');
    PERFORM pg_temp.check(NOT v_expired::text = ANY (v_ids), 'an expired connection is not refreshed');
    PERFORM pg_temp.check(
        (SELECT e -> 'auth_config' ->> 'token_url' FROM jsonb_array_elements(v_claimed) e
          WHERE e -> 'secret' ->> 'connection_id' = v_due::text)
            = 'https://oauth2.googleapis.com/token',
        'a claim carries the provider''s config');
    PERFORM pg_temp.check(
        (SELECT e -> 'secret' ->> 'refresh_token_cipher' FROM jsonb_array_elements(v_claimed) e
          WHERE e -> 'secret' ->> 'connection_id' = v_due::text) = '\xbb',
        'bytea travels as \x hex');
    PERFORM pg_temp.check(
        NOT integrations.fn_claim_connections_for_refresh(500) @> jsonb_build_array(jsonb_build_object('secret', jsonb_build_object('connection_id', v_due))),
        'the lease keeps a second run off it');

    PERFORM pg_temp.check(
        NOT integrations.fn_commit_refresh(v_due, '\xee', pg_temp.secret('\xdd'), now() + interval '1 hour', NULL),
        'a commit over a token the row no longer holds is refused');
    PERFORM pg_temp.check(
        (SELECT refresh_token_cipher FROM integrations.connection_secrets WHERE connection_id = v_due) = '\xbb',
        'and writes nothing');

    UPDATE integrations.user_connections SET error_count = 2, last_error = 'x', status = 'degraded' WHERE id = v_due;
    PERFORM pg_temp.check(
        integrations.fn_commit_refresh(v_due, '\xbb', pg_temp.secret('\xdd'), now() + interval '1 hour', NULL),
        'a commit over the token it read lands');
    PERFORM pg_temp.check(
        (SELECT refresh_token_cipher FROM integrations.connection_secrets WHERE connection_id = v_due) = '\xdd',
        'the rotated token is stored');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM integrations.user_connections
                 WHERE id = v_due AND status = 'active' AND error_count = 0 AND last_error IS NULL
                   AND refresh_claimed_at IS NULL AND token_expires_at > now()),
        'a refresh heals the connection and clears the lease');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM integrations.connection_audit WHERE connection_id = v_due AND action = 'refreshed') = 1,
        'one refreshed line');

    PERFORM pg_temp.check(
        integrations.fn_record_refresh_failure(v_due, '\xbb', true, 'old token') IS NULL,
        'a failure about a token nobody holds is ignored');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM integrations.user_connections WHERE id = v_due AND status = 'active'),
        'and leaves the connection alone');

    SELECT count(*) INTO v_note FROM comms.notifications WHERE user_id = v_user AND type = 'integration.reconnect_required';
    PERFORM pg_temp.check(
        integrations.fn_record_refresh_failure(v_due, '\xdd', true, 'google answered 400: invalid_grant') = 'expired',
        'invalid_grant expires the connection');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM comms.notifications WHERE user_id = v_user AND type = 'integration.reconnect_required') = v_note + 1,
        'and tells its owner');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM integrations.connection_audit WHERE connection_id = v_due AND action = 'expired') = 1,
        'with an expired line');

    PERFORM pg_temp.check(
        integrations.fn_record_refresh_failure(v_fresh, '\xbb', false, 'google answered 503') = 'active'
        AND integrations.fn_record_refresh_failure(v_fresh, '\xbb', false, 'google answered 503') = 'active',
        'a transient failure leaves the connection active, twice');
    PERFORM pg_temp.check(
        integrations.fn_record_refresh_failure(v_fresh, '\xbb', false, 'google answered 503') = 'degraded',
        'the third degrades it');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM integrations.connection_audit WHERE connection_id = v_fresh AND action = 'refresh_failed') = 3,
        'each failure leaves a line');
END $$;
-- #endregion

-- #region 6. Channels
DO $$
DECLARE
    v_user uuid := pg_temp.user_at(2);
    v_conn uuid := pg_temp.connect(v_user, 'outlook', 'probe-channels');
    v_later uuid := pg_temp.connect(v_user, 'outlook', 'probe-channels-later');
    v_sub uuid;
    v_far uuid;
    v_claimed jsonb;
BEGIN
    INSERT INTO integrations.webhook_subscriptions (connection_id, provider_slug, resource, external_channel_id, expires_at)
    VALUES (v_conn, 'outlook', 'calendar:primary', 'sub-1', now() + interval '2 hours') RETURNING id INTO v_sub;
    INSERT INTO integrations.webhook_subscriptions (connection_id, provider_slug, resource, external_channel_id, expires_at)
    VALUES (v_later, 'outlook', 'calendar:primary', 'sub-2', now() + interval '2 days') RETURNING id INTO v_far;

    v_claimed := integrations.fn_claim_channels_for_renewal(500);
    PERFORM pg_temp.check(
        v_claimed @> jsonb_build_array(jsonb_build_object('channel', jsonb_build_object('id', v_sub))),
        'a channel within 24 hours is claimed');
    PERFORM pg_temp.check(
        NOT v_claimed @> jsonb_build_array(jsonb_build_object('channel', jsonb_build_object('id', v_far))),
        'one with days left is not');
    PERFORM pg_temp.check(
        (SELECT status FROM integrations.webhook_subscriptions WHERE id = v_sub) = 'expiring',
        'the claim marks it expiring');
    PERFORM pg_temp.check(
        NOT integrations.fn_claim_channels_for_renewal(500) @> jsonb_build_array(jsonb_build_object('channel', jsonb_build_object('id', v_sub))),
        'and a second run keeps off it');

    PERFORM integrations.fn_record_channel_renewal(v_sub, true, now() + interval '2 days', 'sub-1b', NULL);
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM integrations.webhook_subscriptions
                 WHERE id = v_sub AND status = 'active' AND failure_count = 0
                   AND external_channel_id = 'sub-1b' AND last_renewed_at IS NOT NULL
                   AND expires_at > now() + interval '1 day'),
        'a renewal stores what the provider answered');

    PERFORM pg_temp.check(integrations.fn_record_channel_renewal(v_sub, false) = 'active', 'one failed renewal counts');
    PERFORM pg_temp.check(integrations.fn_record_channel_renewal(v_sub, false) = 'active', 'two count');
    PERFORM pg_temp.check(integrations.fn_record_channel_renewal(v_sub, false) = 'failed', 'the third fails the channel');
    PERFORM pg_temp.check(
        (SELECT status FROM integrations.user_connections WHERE id = v_conn) = 'degraded',
        'and degrades the connection');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM integrations.connection_audit WHERE connection_id = v_conn AND action = 'webhook_expired') = 1,
        'with a webhook_expired line');
END $$;
-- #endregion

-- #region 7. Webhooks
DO $$
DECLARE
    v_member uuid := pg_temp.user_at(3);
    v_email text;
    v_project uuid;
    v_cohort uuid;
    v_event uuid;
    v_first jsonb;
    v_replay jsonb;
    v_conn uuid := pg_temp.connect(pg_temp.user_at(3), 'zoom', 'probe-zoom-user');
    v_joined timestamptz;
BEGIN
    SELECT email INTO v_email FROM auth.users WHERE id = v_member;
    SELECT s.project_id INTO v_project FROM projects.project_stages s ORDER BY s.id LIMIT 1;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name)
    SELECT v_project, s.id, 'Probe cohort' FROM projects.project_stages s WHERE s.project_id = v_project ORDER BY s.id LIMIT 1
    RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, v_member);
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, meeting_provider, provider_meeting_id)
    VALUES (v_cohort, 'Probe sitting', now(), now() + interval '1 hour', 'zoom', 'probe-room')
    RETURNING id INTO v_event;

    v_first := integrations.fn_record_presence_delivery('zoom', 'probe-room', 'joined', now(), 'probe-delivery-1', 'probe-person', v_email);
    PERFORM pg_temp.check(v_first ->> 'outcome' = 'recorded', 'a presence delivery records');
    SELECT joined_at INTO v_joined FROM projects.session_attendance WHERE session_event_id = v_event AND user_id = v_member;

    v_replay := integrations.fn_record_presence_delivery('zoom', 'probe-room', 'joined', now() - interval '5 minutes', 'probe-delivery-1', 'probe-person', v_email);
    PERFORM pg_temp.check(v_replay ->> 'outcome' = 'replayed', 'the same delivery twice is a replay');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM integrations.webhook_deliveries WHERE provider_slug = 'zoom' AND external_delivery_id = 'probe-delivery-1') = 1,
        'one delivery row');
    PERFORM pg_temp.check(
        (SELECT joined_at FROM projects.session_attendance WHERE session_event_id = v_event AND user_id = v_member) = v_joined,
        'and one effect: the replay moved nothing');
    PERFORM pg_temp.check(
        (SELECT signature_verified AND status = 'processed' AND processed_at IS NOT NULL
           FROM integrations.webhook_deliveries WHERE external_delivery_id = 'probe-delivery-1'),
        'the row records a verified, processed delivery');

    -- A failed effect must take its claim with it, or the redelivery would be swallowed as a replay.
    PERFORM pg_temp.check(pg_temp.refused(
        format('SELECT integrations.fn_record_presence_delivery(%L, %L, %L, %L::timestamptz, %L, %L, %L)',
               'zoom', 'probe-room', 'joined', 'not-a-time', 'probe-delivery-2', 'probe-person', v_email),
        '22007'), 'a failing call raises');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM integrations.webhook_deliveries WHERE external_delivery_id = 'probe-delivery-2'),
        'and leaves no claim behind');

    PERFORM pg_temp.check(
        integrations.fn_deauthorize_connection('zoom', 'probe-zoom-user', 'app_deauthorized:probe-zoom-user:1') = 1,
        'app_deauthorized revokes the account''s connection');
    PERFORM pg_temp.check(
        (SELECT status FROM integrations.user_connections WHERE id = v_conn) = 'revoked'
        AND NOT EXISTS (SELECT 1 FROM integrations.connection_secrets WHERE connection_id = v_conn),
        'and deletes its secrets');
    PERFORM pg_temp.check(
        integrations.fn_deauthorize_connection('zoom', 'probe-zoom-user', 'app_deauthorized:probe-zoom-user:1') = 0,
        'a replay revokes nothing');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM integrations.connection_audit WHERE connection_id = v_conn AND action = 'revoked') = 1,
        'one revoked line');
    PERFORM pg_temp.check(
        integrations.fn_deauthorize_connection('zoom', 'nobody-here', 'app_deauthorized:nobody-here:1') = 0,
        'an account we never linked is acknowledged');
END $$;
-- #endregion

-- #region 8. Revocation
DO $$
DECLARE
    v_user uuid := pg_temp.user_at(4);
    v_conn uuid := pg_temp.connect(v_user, 'google', 'probe-revoke');
    v_other uuid := pg_temp.connect(v_user, 'google', 'probe-revoke-other');
    v_schedule uuid;
    v_busy uuid;
    v_keep uuid;
    v_sub uuid;
BEGIN
    SELECT id INTO v_schedule FROM scheduling.schedules ORDER BY id LIMIT 1;
    INSERT INTO scheduling.events (schedule_id, kind, status, starts_at, ends_at, source_connection_id, external_event_id)
    VALUES (v_schedule, 'general', 'busy', now() + interval '1 day', now() + interval '25 hours', v_conn, 'probe-ext-1')
    RETURNING id INTO v_busy;
    INSERT INTO scheduling.events (schedule_id, kind, status, starts_at, ends_at, source_connection_id, external_event_id)
    VALUES (v_schedule, 'general', 'busy', now() + interval '1 day', now() + interval '25 hours', v_other, 'probe-ext-2')
    RETURNING id INTO v_keep;
    INSERT INTO integrations.webhook_subscriptions (connection_id, provider_slug, resource, expires_at)
    VALUES (v_conn, 'google', 'calendar:primary', now() + interval '2 days') RETURNING id INTO v_sub;

    PERFORM pg_temp.check(integrations.fn_revoke_connection(v_conn, 'Probe.'), 'the door revokes');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM integrations.connection_secrets WHERE connection_id = v_conn),
        'its secrets are gone');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM integrations.user_connections WHERE id = v_conn AND status = 'revoked' AND revoked_at IS NOT NULL),
        'the connection is revoked');
    PERFORM pg_temp.check(
        (SELECT status FROM integrations.webhook_subscriptions WHERE id = v_sub) = 'expired',
        'its channels are expired');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM scheduling.events WHERE id = v_busy AND status = 'cancelled' AND archived_at IS NOT NULL),
        'its busy rows are cancelled and archived');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM scheduling.events WHERE id = v_keep AND status = 'busy' AND archived_at IS NULL),
        'another connection''s busy rows are untouched');
    PERFORM pg_temp.check(
        (SELECT detail FROM integrations.connection_audit WHERE connection_id = v_conn AND action = 'revoked') = 'Probe.',
        'the audit line says why');
    PERFORM pg_temp.check(NOT integrations.fn_revoke_connection(v_conn), 'a second revoke is a no-op');
    PERFORM pg_temp.check(NOT integrations.fn_revoke_connection(gen_random_uuid()), 'an unknown connection is a no-op');
END $$;
-- #endregion

-- #region 9. Grants
DO $$
DECLARE
    v_door text;
BEGIN
    FOREACH v_door IN ARRAY ARRAY[
        'integrations.fn_store_connection(uuid,uuid,text,text,text,integrations.provider_kind[],text[],timestamptz,timestamptz,jsonb)',
        'integrations.fn_claim_connections_for_refresh(integer)',
        'integrations.fn_commit_refresh(uuid,bytea,jsonb,timestamptz,timestamptz)',
        'integrations.fn_record_refresh_failure(uuid,bytea,boolean,text)',
        'integrations.fn_claim_channels_for_renewal(integer)',
        'integrations.fn_record_channel_renewal(uuid,boolean,timestamptz,text,text)',
        'integrations.fn_record_presence_delivery(text,text,text,timestamptz,text,text,text,text,text)',
        'integrations.fn_claim_connection_token(uuid)',
        'integrations.fn_revoke_connection(uuid,text)',
        'integrations.fn_deauthorize_connection(text,text,text)',
        'integrations.fn_sweep_consent_states()'
    ] LOOP
        PERFORM pg_temp.check(
            has_function_privilege('service_role', v_door, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', v_door, 'EXECUTE')
            AND NOT has_function_privilege('anon', v_door, 'EXECUTE'),
            format('%s is the service role''s alone', split_part(v_door, '(', 1)));
    END LOOP;

    FOREACH v_door IN ARRAY ARRAY[
        'integrations.fn_write_secret(uuid,jsonb,timestamptz,timestamptz)',
        'integrations.fn_claim_webhook_delivery(text,text)'
    ] LOOP
        PERFORM pg_temp.check(
            NOT has_function_privilege('service_role', v_door, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', v_door, 'EXECUTE')
            AND NOT has_function_privilege('anon', v_door, 'EXECUTE'),
            format('%s is internal', split_part(v_door, '(', 1)));
    END LOOP;

    PERFORM pg_temp.check(
        has_function_privilege('authenticated', 'integrations.fn_open_consent(text,text,text,integrations.provider_kind[],text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'integrations.fn_open_consent(text,text,text,integrations.provider_kind[],text)', 'EXECUTE'),
        'fn_open_consent is the signed-in caller''s');
END $$;
-- #endregion

ROLLBACK;
