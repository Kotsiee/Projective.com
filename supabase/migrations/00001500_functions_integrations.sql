-- ============================================================================================
-- 00001500_functions_integrations.sql — integrations schema functions (Category 1).
--
-- In-DB predicates the app needs WITHOUT ever exposing the token vault or the definer-only tables:
--   * Connector capability gates (does this user hold an active calendar/conferencing consent?).
--   * The connector runtime's doors: consent, refresh, channel renewal, delivery claims, revocation.
--   * Plugin authorization gates (is this plugin installed for the user, with a given scope?).
--   * The shared updated_at touch trigger fn (its CREATE TRIGGERs live in
--     00001870_triggers_integrations.sql, after this file).
--
-- SECURITY DEFINER where a function must read a definer-only table (user_connections,
-- plugin_installations), and pinned search_path throughout; the predicates are STABLE.
-- ============================================================================================

-- #region Connector capability predicates
-- "Can this user's stored consents do X?" — the gates the scheduling/booking flow needs. DEFINER so
-- they can read the definer-only integrations.user_connections without granting it to `authenticated`.

-- Does the user hold an ACTIVE connection capable of the given kind?
CREATE OR REPLACE FUNCTION integrations.fn_has_capability(
    p_user uuid, p_kind integrations.provider_kind
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = integrations, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM integrations.user_connections c
        WHERE c.user_id = p_user
          AND c.status = 'active'::integrations.connection_status
          AND p_kind = ANY (c.granted_kinds)
    );
$$;

-- The provider slug that should mint a meeting room for this user, or NULL when none is connected
-- (the caller then falls back to a platform-hosted room or a manual link).
CREATE OR REPLACE FUNCTION integrations.fn_conferencing_provider(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = integrations, public
AS $$
    SELECT c.provider_slug
    FROM integrations.user_connections c
    WHERE c.user_id = p_user
      AND c.status = 'active'::integrations.connection_status
      AND 'conferencing'::integrations.provider_kind = ANY (c.granted_kinds)
    ORDER BY c.updated_at DESC
    LIMIT 1;
$$;
-- #endregion

-- #region The connector runtime's doors (SCH-WP4a; Decision #343, ruling C4)
-- The app makes the network calls (Fresh routes plus pg_cron http jobs) and each function here is one
-- SQL call, so a connection, its sealed tokens and its audit line land or fail together. All are the
-- service role's except fn_open_consent (00002510 grants them). None ever sees a plaintext: p_secret
-- is the envelope token-vault.ts sealed, keyed by column, with each bytea as \x hex.

-- Open a consent for the caller. The one client door here: it runs under the caller's JWT because
-- auth.uid() is the identity a forged cookie cannot name, and this row binds the whole round trip to
-- it. Called directly it gains nothing: the row is the caller's own, and the window is set here.
CREATE OR REPLACE FUNCTION integrations.fn_open_consent(
    p_state text,
    p_provider_slug text,
    p_code_verifier text,
    p_requested_kinds integrations.provider_kind[],
    p_return_to text
)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user uuid := auth.uid ();
    v_expires timestamptz := pg_catalog.now() + interval '10 minutes';
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in to connect an account';
    END IF;
    INSERT INTO integrations.consent_states (
        state, user_id, provider_slug, code_verifier, requested_kinds, return_to, expires_at
    )
    VALUES (
        p_state, v_user, p_provider_slug, p_code_verifier, p_requested_kinds, p_return_to, v_expires
    );
    RETURN v_expires;
END;
$$;

-- Drop consents past their window a day ago: spent or abandoned CSRF bindings, of no further use. The
-- job's `command` must be one SELECT, so the delete lives here (integrations-consent-sweep).
CREATE OR REPLACE FUNCTION integrations.fn_sweep_consent_states()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count integer;
BEGIN
    DELETE FROM integrations.consent_states c
     WHERE c.expires_at < pg_catalog.now() - interval '1 day';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- Internal. Write a row's envelope and its authoritative expiries; both writers come through here, so
-- the columns are listed once.
CREATE OR REPLACE FUNCTION integrations.fn_write_secret(
    p_connection_id uuid,
    p_secret jsonb,
    p_access_expires_at timestamptz,
    p_refresh_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s integrations.connection_secrets :=
        pg_catalog.jsonb_populate_record(NULL::integrations.connection_secrets, p_secret);
BEGIN
    INSERT INTO integrations.connection_secrets (
        connection_id, key_id, wrapped_dek, wrapped_dek_nonce,
        access_token_cipher, nonce,
        refresh_token_cipher, refresh_token_nonce,
        api_secret_cipher, api_secret_nonce,
        access_token_expires_at, refresh_token_expires_at
    )
    VALUES (
        p_connection_id, s.key_id, s.wrapped_dek, s.wrapped_dek_nonce,
        s.access_token_cipher, s.nonce,
        s.refresh_token_cipher, s.refresh_token_nonce,
        s.api_secret_cipher, s.api_secret_nonce,
        p_access_expires_at, p_refresh_expires_at
    )
    ON CONFLICT (connection_id) DO UPDATE SET
        key_id = EXCLUDED.key_id,
        wrapped_dek = EXCLUDED.wrapped_dek,
        wrapped_dek_nonce = EXCLUDED.wrapped_dek_nonce,
        access_token_cipher = EXCLUDED.access_token_cipher,
        nonce = EXCLUDED.nonce,
        refresh_token_cipher = EXCLUDED.refresh_token_cipher,
        refresh_token_nonce = EXCLUDED.refresh_token_nonce,
        api_secret_cipher = EXCLUDED.api_secret_cipher,
        api_secret_nonce = EXCLUDED.api_secret_nonce,
        access_token_expires_at = EXCLUDED.access_token_expires_at,
        refresh_token_expires_at = EXCLUDED.refresh_token_expires_at;
END;
$$;

-- Store a completed consent: the connection, its sealed tokens and its audit line, in one transaction.
-- The caller minted p_connection_id and sealed under it, because each ciphertext's AAD names the
-- connection. When this account is already linked under another id, nothing is written and that id is
-- the answer, for the caller to seal again; p_connection_id coming back means it was stored. A fresh
-- consent reopens a revoked or expired row, since the account's row is unique.
CREATE OR REPLACE FUNCTION integrations.fn_store_connection(
    p_connection_id uuid,
    p_user_id uuid,
    p_provider_slug text,
    p_external_account_id text,
    p_external_account_label text,
    p_granted_kinds integrations.provider_kind[],
    p_granted_scopes text[],
    p_access_expires_at timestamptz,
    p_refresh_expires_at timestamptz,
    p_secret jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_new boolean;
    v_existing uuid;
BEGIN
    INSERT INTO integrations.user_connections AS c (
        id, user_id, provider_slug, status, granted_kinds, granted_scopes,
        external_account_id, external_account_label, token_expires_at, connected_at
    )
    VALUES (
        p_connection_id, p_user_id, p_provider_slug, 'active', p_granted_kinds, p_granted_scopes,
        p_external_account_id, p_external_account_label, p_access_expires_at, pg_catalog.now()
    )
    ON CONFLICT ON CONSTRAINT uq_user_connection DO UPDATE SET
        status = 'active',
        granted_kinds = EXCLUDED.granted_kinds,
        granted_scopes = EXCLUDED.granted_scopes,
        external_account_label = EXCLUDED.external_account_label,
        token_expires_at = EXCLUDED.token_expires_at,
        connected_at = EXCLUDED.connected_at,
        revoked_at = NULL,
        refresh_claimed_at = NULL,
        last_error = NULL,
        error_count = 0
    WHERE c.id = EXCLUDED.id
    RETURNING (c.xmax = 0) INTO v_new;

    IF NOT FOUND THEN
        SELECT c.id INTO v_existing
          FROM integrations.user_connections c
         WHERE c.user_id = p_user_id
           AND c.provider_slug = p_provider_slug
           AND c.external_account_id IS NOT DISTINCT FROM p_external_account_id;
        RETURN v_existing;
    END IF;

    PERFORM integrations.fn_write_secret(
        p_connection_id, p_secret, p_access_expires_at, p_refresh_expires_at
    );
    INSERT INTO integrations.connection_audit (connection_id, user_id, provider_slug, action)
    VALUES (
        p_connection_id, p_user_id, p_provider_slug,
        (CASE WHEN v_new THEN 'connected' ELSE 'reconnected' END)::integrations.connection_action
    );
    IF 'conferencing' = ANY (p_granted_kinds) THEN
        PERFORM scheduling.fn_queue_waiting_rooms(p_user_id, p_provider_slug);
    END IF;
    -- Busy time is read in the job, so this only puts the calendar in its queue. A reconnect that no
    -- longer consents to the read stops it and takes back what the old consent brought in.
    IF 'freebusy' = ANY (p_granted_kinds) THEN
        INSERT INTO integrations.connection_sync_state (connection_id, resource, kind, due_at)
        VALUES (p_connection_id, 'calendar:primary', 'freebusy', pg_catalog.now())
        ON CONFLICT ON CONSTRAINT uq_sync_resource DO UPDATE SET due_at = EXCLUDED.due_at;
    ELSE
        DELETE FROM integrations.connection_sync_state s
         WHERE s.connection_id = p_connection_id AND s.kind = 'freebusy';
        UPDATE scheduling.events e
           SET status = 'cancelled', archived_at = pg_catalog.now()
         WHERE e.source_connection_id = p_connection_id AND e.archived_at IS NULL;
        DELETE FROM scheduling.connected_event_details d
         USING scheduling.events e
         WHERE d.event_id = e.id AND e.source_connection_id = p_connection_id;
    END IF;
    RETURN p_connection_id;
END;
$$;

-- Claim the connections due a refresh (providers spec §7.6) and answer each with its sealed row and
-- its provider's auth_config. Due: the access token ends within 15 minutes on a connection in use, or
-- no refresh for 30 days, which outruns Google's idle lapse and finds a revoked grant early. A fresh
-- connection counts as in use; anything using one later writes last_synced_at or last_used_at.
--
-- The exchange is a network call, so no row lock can span it. refresh_claimed_at is the lease instead:
-- it keeps a second run off a refresh token in flight, and fn_commit_refresh then writes only over the
-- token this claim handed out.
CREATE OR REPLACE FUNCTION integrations.fn_claim_connections_for_refresh(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rows jsonb;
BEGIN
    WITH due AS (
        SELECT c.id
          FROM integrations.user_connections c
          JOIN integrations.connection_secrets s ON s.connection_id = c.id
         WHERE c.status IN ('active', 'degraded')
           AND s.refresh_token_cipher IS NOT NULL
           AND (c.refresh_claimed_at IS NULL
                OR c.refresh_claimed_at < pg_catalog.now() - interval '5 minutes')
           AND ((s.access_token_expires_at < pg_catalog.now() + interval '15 minutes'
                 AND GREATEST(c.last_synced_at, c.last_used_at, c.connected_at) > pg_catalog.now() - interval '7 days')
                OR s.updated_at < pg_catalog.now() - interval '30 days')
         ORDER BY s.access_token_expires_at
         LIMIT GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1)
           FOR UPDATE OF c SKIP LOCKED
    ), claimed AS (
        UPDATE integrations.user_connections c
           SET refresh_claimed_at = pg_catalog.now()
          FROM due
         WHERE c.id = due.id
        RETURNING c.id, c.provider_slug
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'provider_slug', claimed.provider_slug,
               'auth_config', p.auth_config,
               'secret', pg_catalog.to_jsonb(s)
           )), '[]'::jsonb)
      INTO v_rows
      FROM claimed
      JOIN integrations.connection_secrets s ON s.connection_id = claimed.id
      JOIN integrations.providers p ON p.slug = claimed.provider_slug;
    RETURN v_rows;
END;
$$;

-- Land a refresh: the new envelope, the connection's expiry and its audit line, only if the row still
-- holds p_read_cipher, the refresh token this run spent. Answers false when it does not (a revoke
-- deleted it), and the tokens in hand are discarded.
CREATE OR REPLACE FUNCTION integrations.fn_commit_refresh(
    p_connection_id uuid,
    p_read_cipher bytea,
    p_secret jsonb,
    p_access_expires_at timestamptz,
    p_refresh_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user uuid;
    v_provider text;
BEGIN
    PERFORM 1 FROM integrations.connection_secrets s
      WHERE s.connection_id = p_connection_id AND s.refresh_token_cipher = p_read_cipher
        FOR UPDATE;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    PERFORM integrations.fn_write_secret(
        p_connection_id, p_secret, p_access_expires_at, p_refresh_expires_at
    );
    UPDATE integrations.user_connections c
       SET status = 'active',
           token_expires_at = p_access_expires_at,
           refresh_claimed_at = NULL,
           last_error = NULL,
           error_count = 0
     WHERE c.id = p_connection_id
    RETURNING c.user_id, c.provider_slug INTO v_user, v_provider;
    INSERT INTO integrations.connection_audit (connection_id, user_id, provider_slug, action)
    VALUES (p_connection_id, v_user, v_provider, 'refreshed');
    RETURN true;
END;
$$;

-- Record a failed refresh of the token in p_read_cipher, and answer the connection's status (NULL when
-- the row has moved on, so the failure is about a token nobody holds). invalid_grant is terminal for
-- this grant: the connection is `expired` and its owner is told, since only they can consent again.
-- Anything else may pass, and three in a row is `degraded`.
CREATE OR REPLACE FUNCTION integrations.fn_record_refresh_failure(
    p_connection_id uuid,
    p_read_cipher bytea,
    p_invalid_grant boolean,
    p_detail text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c integrations.user_connections;
    v_label text;
BEGIN
    PERFORM 1 FROM integrations.connection_secrets s
      WHERE s.connection_id = p_connection_id AND s.refresh_token_cipher = p_read_cipher
        FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    UPDATE integrations.user_connections u
       SET status = CASE
               WHEN p_invalid_grant THEN 'expired'::integrations.connection_status
               WHEN u.error_count + 1 >= 3 THEN 'degraded'::integrations.connection_status
               ELSE u.status
           END,
           error_count = u.error_count + 1,
           last_error = pg_catalog.left(p_detail, 500)
     WHERE u.id = p_connection_id
    RETURNING u.* INTO c;
    INSERT INTO integrations.connection_audit (connection_id, user_id, provider_slug, action, detail)
    VALUES (
        c.id, c.user_id, c.provider_slug,
        (CASE WHEN p_invalid_grant THEN 'expired' ELSE 'refresh_failed' END)::integrations.connection_action,
        pg_catalog.left(p_detail, 500)
    );
    IF p_invalid_grant THEN
        SELECT p.label INTO v_label FROM integrations.providers p WHERE p.slug = c.provider_slug;
        PERFORM comms.fn_notify(
            c.user_id, 'integration.reconnect_required',
            pg_catalog.format('Reconnect %s', v_label),
            pg_catalog.format(
                '%s no longer accepts Projective''s access. Reconnect it to keep your calendar and meeting rooms working.',
                v_label
            ),
            'integrations.user_connections', c.id
        );
    END IF;
    RETURN c.status::text;
END;
$$;

-- Claim the push channels within 24 hours of lapsing, and answer each with its connection's sealed row
-- (the renewal is made with the access token). `expiring` marks one in flight, and a run that died
-- leaves it claimable again after 30 minutes.
CREATE OR REPLACE FUNCTION integrations.fn_claim_channels_for_renewal(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rows jsonb;
BEGIN
    WITH due AS (
        SELECT w.id
          FROM integrations.webhook_subscriptions w
          JOIN integrations.user_connections c ON c.id = w.connection_id
         WHERE c.status IN ('active', 'degraded')
           AND w.expires_at < pg_catalog.now() + interval '24 hours'
           AND (w.status = 'active'
                OR (w.status = 'expiring' AND w.updated_at < pg_catalog.now() - interval '30 minutes'))
         ORDER BY w.expires_at
         LIMIT GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1)
           FOR UPDATE OF w SKIP LOCKED
    ), claimed AS (
        UPDATE integrations.webhook_subscriptions w
           SET status = 'expiring'
          FROM due
         WHERE w.id = due.id
        RETURNING w.*
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'channel', pg_catalog.to_jsonb(claimed),
               'secret', pg_catalog.to_jsonb(s)
           )), '[]'::jsonb)
      INTO v_rows
      FROM claimed
      JOIN integrations.connection_secrets s ON s.connection_id = claimed.connection_id;
    RETURN v_rows;
END;
$$;

-- Record one renewal. A failure counts on the channel, and the third leaves it `failed` and its
-- connection `degraded`, so the owner sees a reconnect rather than a sync that silently stopped.
CREATE OR REPLACE FUNCTION integrations.fn_record_channel_renewal(
    p_subscription_id uuid,
    p_renewed boolean,
    p_expires_at timestamptz DEFAULT NULL,
    p_external_channel_id text DEFAULT NULL,
    p_external_resource_id text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    w integrations.webhook_subscriptions;
    c integrations.user_connections;
BEGIN
    UPDATE integrations.webhook_subscriptions s
       SET status = CASE
               WHEN p_renewed THEN 'active'::integrations.webhook_status
               WHEN s.failure_count + 1 >= 3 THEN 'failed'::integrations.webhook_status
               ELSE s.status
           END,
           failure_count = CASE WHEN p_renewed THEN 0 ELSE s.failure_count + 1 END,
           expires_at = CASE WHEN p_renewed THEN p_expires_at ELSE s.expires_at END,
           last_renewed_at = CASE WHEN p_renewed THEN pg_catalog.now() ELSE s.last_renewed_at END,
           external_channel_id = COALESCE(p_external_channel_id, s.external_channel_id),
           external_resource_id = COALESCE(p_external_resource_id, s.external_resource_id)
     WHERE s.id = p_subscription_id
    RETURNING s.* INTO w;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO c FROM integrations.user_connections u WHERE u.id = w.connection_id;
    IF w.status = 'failed' AND c.status = 'active' THEN
        UPDATE integrations.user_connections u SET status = 'degraded' WHERE u.id = c.id;
    END IF;
    IF p_renewed OR w.status = 'failed' THEN
        INSERT INTO integrations.connection_audit (connection_id, user_id, provider_slug, action)
        VALUES (
            c.id, c.user_id, c.provider_slug,
            (CASE WHEN p_renewed THEN 'webhook_renewed' ELSE 'webhook_expired' END)::integrations.connection_action
        );
    END IF;
    RETURN w.status::text;
END;
$$;

-- Internal. Claim one inbound delivery in the caller's transaction, as finance.fn_claim_stripe_event
-- does for Stripe: false means this delivery already had its effect. A row here is a delivery that
-- verified, so a forged one leaves none.
CREATE OR REPLACE FUNCTION integrations.fn_claim_webhook_delivery(
    p_provider_slug text,
    p_external_delivery_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO integrations.webhook_deliveries (
        provider_slug, external_delivery_id, signature_verified, status, processed_at
    )
    VALUES (p_provider_slug, p_external_delivery_id, true, 'processed', pg_catalog.now())
    ON CONFLICT ON CONSTRAINT uq_webhook_delivery DO NOTHING;
    RETURN FOUND;
END;
$$;

-- One verified presence event: its delivery claim and its effect in one SQL call, so a replay is a
-- no-op and a failed write leaves no claim behind to swallow the redelivery.
-- scheduling.record_presence keeps its own logic; this wrapper is the only thing that knows about
-- deliveries.
CREATE OR REPLACE FUNCTION integrations.fn_record_presence_delivery(
    p_provider text,
    p_meeting_id text,
    p_action text,
    p_at timestamptz,
    p_event_key text,
    p_participant_key text,
    p_email text DEFAULT NULL,
    p_registrant_id text DEFAULT NULL,
    p_account_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT integrations.fn_claim_webhook_delivery(p_provider, p_event_key) THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'replayed');
    END IF;
    RETURN scheduling.record_presence(
        p_provider, p_meeting_id, p_action, p_at, p_event_key, p_participant_key,
        p_email, p_registrant_id, p_account_id
    );
END;
$$;

-- A token to call a provider with now, for work that cannot wait for the refresh job: minting a room,
-- reading a meeting's record. Stamping the use is what keeps the job refreshing this connection. The
-- stored token if it has two minutes left. Otherwise the row is leased to the caller, who refreshes it
-- as the job would (`refresh`), and `busy` while another run holds that lease, so a rotating token is
-- never spent twice. NULL for a connection that cannot give one.
CREATE OR REPLACE FUNCTION integrations.fn_claim_connection_token(p_connection_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c integrations.user_connections;
    s integrations.connection_secrets;
    v_auth jsonb;
    v_refresh boolean;
BEGIN
    SELECT * INTO c FROM integrations.user_connections x
     WHERE x.id = p_connection_id AND x.status IN ('active', 'degraded')
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO s FROM integrations.connection_secrets x WHERE x.connection_id = c.id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_refresh := s.access_token_expires_at < pg_catalog.now() + interval '2 minutes';
    IF v_refresh AND c.refresh_claimed_at > pg_catalog.now() - interval '5 minutes' THEN
        RETURN pg_catalog.jsonb_build_object('busy', true);
    END IF;
    UPDATE integrations.user_connections u
       SET last_used_at = pg_catalog.now(),
           refresh_claimed_at = CASE WHEN v_refresh THEN pg_catalog.now() ELSE u.refresh_claimed_at END
     WHERE u.id = c.id;
    SELECT p.auth_config INTO v_auth FROM integrations.providers p WHERE p.slug = c.provider_slug;
    RETURN pg_catalog.jsonb_build_object(
        'provider_slug', c.provider_slug,
        'auth_config', v_auth,
        'secret', pg_catalog.to_jsonb(s),
        'refresh', COALESCE(v_refresh, false)
    );
END;
$$;

-- Close a connection for good: the revoke-on-disconnect door, and the one account erasure calls. Its
-- tokens are deleted, its channels stop counting, its busy rows leave every calendar and the booking
-- gate, and its read cursor, Projective calendar and mirror queue go, so a fresh consent starts clean
-- and inbound, all in one transaction. Answers false when there was nothing left to close. Telling the
-- provider is the app's, after this commits.
CREATE OR REPLACE FUNCTION integrations.fn_revoke_connection(
    p_connection_id uuid,
    p_detail text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c integrations.user_connections;
BEGIN
    SELECT * INTO c FROM integrations.user_connections u WHERE u.id = p_connection_id FOR UPDATE;
    IF NOT FOUND OR c.status = 'revoked' THEN
        RETURN false;
    END IF;
    DELETE FROM integrations.connection_secrets s WHERE s.connection_id = p_connection_id;
    UPDATE integrations.user_connections u
       SET status = 'revoked', revoked_at = pg_catalog.now(), sync_direction = 'inbound',
           config = u.config - 'outbound_calendar_id'
     WHERE u.id = p_connection_id;
    UPDATE integrations.webhook_subscriptions w
       SET status = 'expired'
     WHERE w.connection_id = p_connection_id AND w.status <> 'expired';
    UPDATE scheduling.events e
       SET status = 'cancelled', archived_at = pg_catalog.now()
     WHERE e.source_connection_id = p_connection_id AND e.archived_at IS NULL;
    DELETE FROM scheduling.connected_event_details d
     USING scheduling.events e
     WHERE d.event_id = e.id AND e.source_connection_id = p_connection_id;
    DELETE FROM integrations.connection_sync_state s WHERE s.connection_id = p_connection_id;
    DELETE FROM scheduling.event_mirrors m WHERE m.connection_id = p_connection_id;
    INSERT INTO integrations.connection_audit (connection_id, user_id, provider_slug, action, detail)
    VALUES (c.id, c.user_id, c.provider_slug, 'revoked', p_detail);
    RETURN true;
END;
$$;

-- A provider says a person removed the app (Zoom's app_deauthorized): revoke every connection of that
-- account, once per delivery. Answers how many it closed; none is a normal answer.
CREATE OR REPLACE FUNCTION integrations.fn_deauthorize_connection(
    p_provider_slug text,
    p_external_account_id text,
    p_delivery_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_count integer := 0;
BEGIN
    IF NOT integrations.fn_claim_webhook_delivery(p_provider_slug, p_delivery_id) THEN
        RETURN 0;
    END IF;
    FOR v_id IN
        SELECT c.id FROM integrations.user_connections c
         WHERE c.provider_slug = p_provider_slug AND c.external_account_id = p_external_account_id
         ORDER BY c.id
    LOOP
        IF integrations.fn_revoke_connection(v_id, 'The app was removed at the provider.') THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;
    RETURN v_count;
END;
$$;
-- #endregion

-- #region Calendar sync (SCH-WP4b; Decision #383, ruling R3)
-- Two one-way flows, never one loop. Busy time comes in from a person's primary calendar as rows of
-- scheduling.events with no title, and their Projective events go out to a separate calendar
-- (scheduling.event_mirrors, 00001510 §7g). The two calendars never overlap, so nothing here suppresses
-- an echo or resolves a conflict. Every door is the service role's.

-- Take the calendars due a read: marked by a push, or not read for an hour, which catches a missed
-- push and a calendar with no channel. A push goes first: somebody's calendar just changed. `cursor` is
-- withheld once a week, which makes the read a full one: a cursor only reports changes, and an old
-- event comes into the window with no change at all.
CREATE OR REPLACE FUNCTION integrations.fn_claim_calendar_syncs(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rows jsonb;
BEGIN
    WITH due AS (
        SELECT s.id
          FROM integrations.connection_sync_state s
          JOIN integrations.user_connections c ON c.id = s.connection_id
         WHERE s.kind = 'freebusy'
           AND c.status IN ('active', 'degraded')
           AND 'freebusy' = ANY (c.granted_kinds)
           AND c.sync_direction <> 'outbound'
           AND (s.claimed_at IS NULL OR s.claimed_at < pg_catalog.now() - interval '10 minutes')
           AND (s.due_at <= pg_catalog.now()
                OR s.last_delta_at IS NULL
                OR s.last_delta_at < pg_catalog.now() - interval '1 hour')
         ORDER BY s.due_at NULLS LAST, s.last_delta_at NULLS FIRST
         LIMIT GREATEST(LEAST(COALESCE(p_limit, 50), 500), 1)
           FOR UPDATE OF s SKIP LOCKED
    ), claimed AS (
        UPDATE integrations.connection_sync_state s
           SET claimed_at = pg_catalog.now()
          FROM due
         WHERE s.id = due.id
        RETURNING s.*
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'connection_id', claimed.connection_id,
               'provider_slug', c.provider_slug,
               'resource', claimed.resource,
               'claimed_at', claimed.claimed_at,
               'cursor', CASE WHEN claimed.full_sync_completed_at > pg_catalog.now() - interval '7 days'
                              THEN claimed.sync_token END,
               -- A channel past its expiry is the renewal job's, which opens a new one if it must.
               'has_channel', EXISTS (
                   SELECT 1 FROM integrations.webhook_subscriptions w
                    WHERE w.connection_id = claimed.connection_id AND w.resource = claimed.resource
                      AND w.status IN ('active', 'expiring')
               )
           )), '[]'::jsonb)
      INTO v_rows
      FROM claimed
      JOIN integrations.user_connections c ON c.id = claimed.connection_id;
    RETURN v_rows;
END;
$$;

-- Land one read in one transaction, keyed on uq_event_external, and only while the run still holds its
-- claim: a calendar disconnected mid-read writes nothing back. p_busy is {id, starts_at, ends_at}, or
-- {id, start_date, end_date} for a whole day, taken in the schedule's own zone. A full read also
-- removes whatever it did not see, and otherwise p_gone names what went. A busy row carries a span and
-- nothing else: no title, no attendees, whatever the provider said. A row that left is archived like
-- any other, and comes back through the same key if it reappears.
CREATE OR REPLACE FUNCTION integrations.fn_apply_busy_sync(
    p_connection_id uuid,
    p_resource text,
    p_claimed_at timestamptz,
    p_full boolean,
    p_busy jsonb,
    p_gone text[],
    p_cursor text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user uuid;
    v_schedule uuid;
    v_zone text;
    v_seen text[];
BEGIN
    SELECT u.user_id INTO v_user FROM integrations.user_connections u
     WHERE u.id = p_connection_id AND u.status IN ('active', 'degraded')
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    PERFORM 1 FROM integrations.connection_sync_state s
      WHERE s.connection_id = p_connection_id AND s.resource = p_resource AND s.claimed_at = p_claimed_at
        FOR UPDATE;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Busy time still has to block once this person opens a schedule, so one is opened for it.
    IF NOT EXISTS (
        SELECT 1 FROM scheduling.schedules s WHERE s.owner_type = 'user' AND s.owner_id = v_user
    ) THEN
        INSERT INTO scheduling.schedules (owner_type, owner_id, timezone)
        SELECT 'user', p.user_id, COALESCE(z.name, 'Europe/London')
          FROM org.users_public p
          LEFT JOIN pg_catalog.pg_timezone_names z ON z.name = p.timezone
         WHERE p.user_id = v_user
        ON CONFLICT ON CONSTRAINT uq_schedule_owner DO NOTHING;
    END IF;
    SELECT s.id, s.timezone INTO v_schedule, v_zone FROM scheduling.schedules s
     WHERE s.owner_type = 'user' AND s.owner_id = v_user;

    INSERT INTO scheduling.events AS e (
        schedule_id, kind, status, title, starts_at, ends_at, all_day, is_masked,
        source_connection_id, external_event_id
    )
    SELECT v_schedule, 'busy', 'busy', '',
           COALESCE(b.starts_at, b.start_date::timestamp AT TIME ZONE v_zone),
           COALESCE(b.ends_at, b.end_date::timestamp AT TIME ZONE v_zone),
           b.start_date IS NOT NULL, true, p_connection_id, b.id
      FROM pg_catalog.jsonb_to_recordset(COALESCE(p_busy, '[]'::jsonb)) AS b (
          id text, starts_at timestamptz, ends_at timestamptz, start_date date, end_date date
      )
    ON CONFLICT ON CONSTRAINT uq_event_external DO UPDATE
       SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, all_day = EXCLUDED.all_day,
           status = 'busy', archived_at = NULL
     WHERE (e.starts_at, e.ends_at, e.all_day) IS DISTINCT FROM (EXCLUDED.starts_at, EXCLUDED.ends_at, EXCLUDED.all_day)
        OR e.archived_at IS NOT NULL;

    -- What only the owner reads. A rule this read could not get keeps the one already held.
    INSERT INTO scheduling.connected_event_details AS d (
        event_id, title, location, description, series_id, recurrence_rule, join_url
    )
    SELECT e.id,
           NULLIF(pg_catalog.left(pg_catalog.btrim(b.title), 200), ''),
           NULLIF(pg_catalog.left(pg_catalog.btrim(b.location), 160), ''),
           NULLIF(pg_catalog.left(pg_catalog.btrim(b.description), 8000), ''),
           pg_catalog.left(b.series_id, 1024),
           CASE WHEN pg_catalog.char_length(b.recurrence_rule) <= 400 AND b.recurrence_rule ~ '^FREQ='
                THEN b.recurrence_rule END,
           CASE WHEN pg_catalog.char_length(b.join_url) <= 600 AND b.join_url ~ '^https://'
                THEN b.join_url END
      FROM pg_catalog.jsonb_to_recordset(COALESCE(p_busy, '[]'::jsonb)) AS b (
          id text, title text, location text, description text, series_id text, recurrence_rule text,
          join_url text
      )
      JOIN scheduling.events e
        ON e.source_connection_id = p_connection_id AND e.external_event_id = b.id
    ON CONFLICT (event_id) DO UPDATE
       SET title = EXCLUDED.title, location = EXCLUDED.location, description = EXCLUDED.description,
           series_id = EXCLUDED.series_id, join_url = EXCLUDED.join_url,
           recurrence_rule = COALESCE(EXCLUDED.recurrence_rule, d.recurrence_rule);

    -- A provider rolls a series forward one occurrence at a time, so a new one joins the routine its
    -- siblings were organised into (scheduling.organise_event moves a series whole). Otherwise each
    -- week would slip back out of the group, and out of a passive routine holding time it should not.
    UPDATE scheduling.events e
       SET routine_id = sibling.routine_id, availability_behavior = sibling.availability_behavior
      FROM scheduling.connected_event_details d
     CROSS JOIN LATERAL (
         SELECT x.routine_id, x.availability_behavior
           FROM scheduling.connected_event_details xd
           JOIN scheduling.events x ON x.id = xd.event_id
          WHERE xd.series_id = d.series_id AND x.source_connection_id = p_connection_id
            AND x.routine_id IS NOT NULL
          LIMIT 1
     ) sibling
     WHERE d.event_id = e.id AND d.series_id IS NOT NULL
       AND e.source_connection_id = p_connection_id AND e.routine_id IS NULL;

    IF p_full THEN
        SELECT COALESCE(pg_catalog.array_agg(b ->> 'id'), '{}') INTO v_seen
          FROM pg_catalog.jsonb_array_elements(COALESCE(p_busy, '[]'::jsonb)) b;
    END IF;
    UPDATE scheduling.events e
       SET status = 'cancelled', archived_at = pg_catalog.now()
     WHERE e.source_connection_id = p_connection_id AND e.archived_at IS NULL
       AND CASE WHEN p_full THEN e.external_event_id <> ALL (v_seen)
                ELSE e.external_event_id = ANY (COALESCE(p_gone, '{}')) END;
    DELETE FROM scheduling.connected_event_details d
     USING scheduling.events e
     WHERE d.event_id = e.id AND e.source_connection_id = p_connection_id AND e.archived_at IS NOT NULL;

    -- A push that arrived during the read stays due: this read may have missed what it announced.
    UPDATE integrations.connection_sync_state s
       SET sync_token = p_cursor,
           full_sync_completed_at = CASE WHEN p_full THEN pg_catalog.now() ELSE s.full_sync_completed_at END,
           last_delta_at = pg_catalog.now(),
           last_error = NULL,
           claimed_at = NULL,
           due_at = CASE WHEN s.due_at > p_claimed_at THEN s.due_at END
     WHERE s.connection_id = p_connection_id AND s.resource = p_resource;
    UPDATE integrations.user_connections u
       SET status = 'active', last_synced_at = pg_catalog.now(), last_error = NULL, error_count = 0
     WHERE u.id = p_connection_id;
    RETURN true;
END;
$$;

-- Give a claim back. With no error nothing happened (no token to hand, say) and the next run tries
-- again. An error counts as a refresh failure does: the third in a row degrades the connection.
-- p_error reaches the owner as last_error, so it carries a provider's status and nothing else.
CREATE OR REPLACE FUNCTION integrations.fn_release_calendar_sync(
    p_connection_id uuid,
    p_resource text,
    p_claimed_at timestamptz,
    p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM 1 FROM integrations.user_connections u WHERE u.id = p_connection_id FOR UPDATE;
    UPDATE integrations.connection_sync_state s
       SET claimed_at = NULL, last_error = COALESCE(pg_catalog.left(p_error, 500), s.last_error)
     WHERE s.connection_id = p_connection_id AND s.resource = p_resource AND s.claimed_at = p_claimed_at;
    IF FOUND AND p_error IS NOT NULL THEN
        UPDATE integrations.user_connections u
           SET status = CASE WHEN u.error_count + 1 >= 3 AND u.status = 'active'
                             THEN 'degraded'::integrations.connection_status ELSE u.status END,
               error_count = u.error_count + 1,
               last_error = pg_catalog.left(p_error, 500)
         WHERE u.id = p_connection_id;
    END IF;
END;
$$;

-- Record a push channel the provider just opened. A row for this resource, however it ended, is taken
-- over rather than added to. Answers false when the connection closed while the channel was opening,
-- and that channel then lapses at the provider with nothing here listening.
CREATE OR REPLACE FUNCTION integrations.fn_register_channel(
    p_connection_id uuid,
    p_resource text,
    p_external_channel_id text,
    p_external_resource_id text,
    p_verification_token text,
    p_callback_url text,
    p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c integrations.user_connections;
BEGIN
    SELECT * INTO c FROM integrations.user_connections u
     WHERE u.id = p_connection_id AND u.status IN ('active', 'degraded')
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    INSERT INTO integrations.webhook_subscriptions AS w (
        connection_id, provider_slug, resource, external_channel_id, external_resource_id,
        verification_token, callback_url, status, expires_at, last_renewed_at
    )
    VALUES (
        c.id, c.provider_slug, p_resource, p_external_channel_id, p_external_resource_id,
        p_verification_token, p_callback_url, 'active', p_expires_at, pg_catalog.now()
    )
    ON CONFLICT ON CONSTRAINT uq_webhook_resource DO UPDATE SET
        external_channel_id = EXCLUDED.external_channel_id,
        external_resource_id = EXCLUDED.external_resource_id,
        verification_token = EXCLUDED.verification_token,
        callback_url = EXCLUDED.callback_url,
        status = 'active',
        expires_at = EXCLUDED.expires_at,
        last_renewed_at = EXCLUDED.last_renewed_at,
        failure_count = 0;
    INSERT INTO integrations.connection_audit (connection_id, user_id, provider_slug, action)
    VALUES (c.id, c.user_id, c.provider_slug, 'webhook_registered');
    RETURN true;
END;
$$;

-- A verified push. It says only "look again", so marking the calendar due is its whole effect and a
-- replay repeats that and nothing else, which is why no webhook_deliveries row is claimed here.
-- p_renew brings the channel's own lapse forward: the provider says it needs renewing now.
CREATE OR REPLACE FUNCTION integrations.fn_mark_calendar_due(
    p_provider_slug text,
    p_channel text,
    p_renew boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    w integrations.webhook_subscriptions;
BEGIN
    UPDATE integrations.webhook_subscriptions s
       SET last_delivery_at = pg_catalog.now(),
           expires_at = CASE WHEN p_renew THEN LEAST(s.expires_at, pg_catalog.now()) ELSE s.expires_at END
     WHERE s.provider_slug = p_provider_slug AND s.external_channel_id = p_channel
       AND s.status IN ('active', 'expiring')
    RETURNING s.* INTO w;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    UPDATE integrations.connection_sync_state s
       SET due_at = pg_catalog.now()
     WHERE s.connection_id = w.connection_id AND s.resource = w.resource;
    RETURN true;
END;
$$;

-- Turn a connection's Projective calendar on or off. On, its owner's upcoming events are queued. Off,
-- every copy is queued, and the job removes each from the provider because the connection no longer
-- wants it. Answers false when nothing changed. The caller has proved the connection is the owner's.
CREATE OR REPLACE FUNCTION integrations.fn_set_sync_direction(
    p_connection_id uuid,
    p_direction integrations.sync_direction
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c integrations.user_connections;
BEGIN
    UPDATE integrations.user_connections u
       SET sync_direction = p_direction
     WHERE u.id = p_connection_id AND u.status IN ('active', 'degraded')
       AND u.sync_direction <> p_direction
    RETURNING u.* INTO c;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    IF p_direction = 'inbound' THEN
        UPDATE scheduling.event_mirrors m
           SET dirty_at = pg_catalog.now(), attempts = 0
         WHERE m.connection_id = p_connection_id;
    ELSE
        PERFORM scheduling.fn_open_event_mirrors(p_connection_id);
    END IF;
    INSERT INTO integrations.connection_audit (connection_id, user_id, provider_slug, action, detail)
    VALUES (c.id, c.user_id, c.provider_slug, 'scope_changed', pg_catalog.format('Sync direction: %s.', p_direction));
    RETURN true;
END;
$$;

-- Remember which calendar a connection writes to. The first stored id wins and is the answer, so a
-- run that lost a race writes into the same calendar as the run that won.
-- shortcut: Google has no way to look a calendar up under calendar.app.created, so a lost response or
-- a lost race leaves one empty stray calendar there. Delete it if a person ever notices.
CREATE OR REPLACE FUNCTION integrations.fn_set_outbound_calendar(
    p_connection_id uuid,
    p_calendar_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_calendar text;
BEGIN
    UPDATE integrations.user_connections u
       SET config = u.config || pg_catalog.jsonb_build_object('outbound_calendar_id', p_calendar_id)
     WHERE u.id = p_connection_id AND NOT (u.config ? 'outbound_calendar_id');
    SELECT u.config ->> 'outbound_calendar_id' INTO v_calendar
      FROM integrations.user_connections u WHERE u.id = p_connection_id;
    RETURN v_calendar;
END;
$$;

-- The person deleted their Projective calendar at the provider, and every copy went with it. Forget it
-- and queue their upcoming events again, so the next run makes a new one.
CREATE OR REPLACE FUNCTION integrations.fn_reset_outbound_calendar(p_connection_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE integrations.user_connections u
       SET config = u.config - 'outbound_calendar_id'
     WHERE u.id = p_connection_id;
    DELETE FROM scheduling.event_mirrors m WHERE m.connection_id = p_connection_id;
    PERFORM scheduling.fn_open_event_mirrors(p_connection_id);
END;
$$;
-- #endregion

-- #region Plugin authorization predicates
-- Governs what a plugin surface may render/read at runtime, without exposing the installation table
-- (which carries other users' configs). DEFINER, scoped to the caller via auth.uid().

-- Is this plugin ACTIVE-installed for the current user (personal install)?
CREATE OR REPLACE FUNCTION integrations.fn_plugin_installed(p_plugin uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = integrations, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM integrations.plugin_installations i
        WHERE i.plugin_id = p_plugin
          AND i.installer_user_id = auth.uid ()
          AND i.status = 'active'::integrations.install_status
    );
$$;

-- Has the current user's active installation of a plugin been granted a given capability scope?
-- This is the gate the Plugin-API mediator checks before honouring a plugin's data request.
CREATE OR REPLACE FUNCTION integrations.fn_plugin_has_scope(p_plugin uuid, p_scope text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = integrations, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM integrations.plugin_installations i
        WHERE i.plugin_id = p_plugin
          AND i.installer_user_id = auth.uid ()
          AND i.status = 'active'::integrations.install_status
          AND p_scope = ANY (i.granted_scopes)
    );
$$;

-- Does the current user publish this plugin? Backs the "manage own plugin" developer policies.
CREATE OR REPLACE FUNCTION integrations.fn_is_plugin_publisher(p_plugin uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = integrations, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM integrations.plugins p
        WHERE p.id = p_plugin
          AND p.developer_user_id = auth.uid ()
    );
$$;
-- #endregion

-- #region Shared triggers
-- Touch updated_at on any row carrying that column. CREATE TRIGGERs are in
-- 00001870_triggers_integrations.sql (a trigger needs its function to exist first).
CREATE OR REPLACE FUNCTION integrations.fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Keep integrations.plugins.install_count in step as installations are added/removed. Counts only
-- ACTIVE installs; runs on INSERT/UPDATE(status)/DELETE of an installation.
CREATE OR REPLACE FUNCTION integrations.fn_recount_installs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = integrations, public
AS $$
DECLARE
    v_plugin uuid := COALESCE (NEW.plugin_id, OLD.plugin_id);
BEGIN
    UPDATE integrations.plugins p
    SET install_count = (
        SELECT count(*)
        FROM integrations.plugin_installations i
        WHERE i.plugin_id = v_plugin
          AND i.status = 'active'::integrations.install_status
    )
    WHERE p.id = v_plugin;
    RETURN NULL;
END;
$$;
-- #endregion
