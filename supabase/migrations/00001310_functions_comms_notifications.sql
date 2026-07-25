-- ============================================================================
-- 00001310 functions comms notifications
-- Consolidated verbatim from: 20260724090000_comms_notification_catalog.sql, 20260724091000_comms_notification_preferences.sql, 20260724093000_comms_notification_dispatch.sql, 20260724094000_comms_notification_rls_jobs.sql
-- ============================================================================

-- #endregion

-- #region 6. Type resolution — canonical key from any registered alias
-- Pure and total: an unknown key resolves to itself so a caller is never blocked. Used by
-- `comms.fn_notify` (migration 4/5) to translate the legacy underscored keys emitted by the escrow
-- RPCs (0305 / 0311) into their canonical dotted form without editing those functions.
CREATE OR REPLACE FUNCTION comms.fn_resolve_type_key(p_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = comms, public
AS $$
    SELECT COALESCE(
        (SELECT nt.key FROM comms.notification_types nt WHERE nt.key = p_key),
        (SELECT nt.key FROM comms.notification_types nt WHERE p_key = ANY (nt.aliases) ORDER BY nt.key LIMIT 1),
        p_key
    );
$$;

COMMENT ON FUNCTION comms.fn_resolve_type_key(text) IS
    'Maps a notification type key (canonical or legacy alias) to its canonical catalog key. Total — an unregistered key resolves to itself so an emit site can never fail.';

-- Keeps `updated_at` honest on the catalog.
CREATE OR REPLACE FUNCTION comms.fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- #endregion

-- #region 5. Preference provisioning — seed on signup, plus a one-time backfill
-- Mirrors org.seed_user_preferences (migration 20260722120000, Decision #47): a focused AFTER
-- INSERT trigger on org.users_public rather than re-declaring either provisioning routine. A
-- SEPARATE trigger name is used — `on_users_public_created` already exists and is not touched.
CREATE OR REPLACE FUNCTION comms.seed_notification_prefs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Idempotent: 1:1 on user_id, and a lazily-created row must not be clobbered. Column defaults
    -- supply the values (in_app + email on, push off, digest off, no quiet hours).
    INSERT INTO comms.notification_prefs (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION comms.seed_notification_prefs() IS
    'Seeds a default comms.notification_prefs row when a public profile is created (email + OAuth signup paths). Idempotent. Companion to org.seed_user_preferences (Decision #47).';

-- Callable ensure-helper for any path that needs prefs to exist right now (the API's
-- read-then-write settings flow, the digest builder).
CREATE OR REPLACE FUNCTION comms.fn_ensure_notification_prefs(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = comms, public
AS $$
    INSERT INTO comms.notification_prefs (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
$$;

-- =============================================================================================
-- 20260724093000_comms_notification_dispatch.sql
-- Notification engine foundation (4/5) — the router, the writer, the inbox RPCs & read models.
--
-- ADDITIVE ONLY in effect. One pre-existing function is REPLACED BY A SUPERSET:
-- `comms.fn_notify(uuid, text, text, text, text, uuid)` (migration 0305) is dropped and recreated
-- with the SAME six leading parameters plus eight DEFAULTed ones. Every existing six-argument call
-- site (migrations 0305 / 0311) therefore resolves to the new function unchanged — this is a
-- compatible supersede, not a removal. It is done as DROP + CREATE rather than CREATE OR REPLACE
-- because adding parameters changes the signature, and leaving both in place would make a
-- six-argument call ambiguous ("function is not unique").
--
-- Authored, NOT applied to any live database.
--
-- THE ROUTING CONTRACT, in one place:
--   1. A notification ROW IS ALWAYS WRITTEN (unless the recipient is NULL). It is the ledger.
--   2. `comms.notifications.channels` records what the router decided to deliver over. An empty
--      array means "recorded, delivered nowhere" — the user muted it.
--   3. The in-app inbox shows a row only when `in_app` is among its channels (see
--      `comms.notification_feed`). Realtime already streams the table (migration 0206).
--   4. `mandatory` catalog types ignore every user preference. Security, money-movement, legal and
--      moderation events are not suppressible.
--   5. `critical` urgency pierces a global snooze; `overrides_quiet_hours` pierces quiet hours.
--   6. NOTHING IN HERE EVER RAISES. `fn_notify` is called from inside escrow and stage RPCs — a
--      notification problem must never roll back a money movement.
-- =============================================================================================

-- #region 1. Quiet hours — the recurring, timezone-aware predicate
CREATE OR REPLACE FUNCTION comms.fn_is_quiet_hours(p_user_id uuid, p_at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = comms, public
AS $$
DECLARE
    v_prefs comms.notification_prefs%ROWTYPE;
    v_local time;
BEGIN
    SELECT * INTO v_prefs FROM comms.notification_prefs WHERE user_id = p_user_id;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Legacy absolute window (migration 0008). Retained under the Additive Rule; an existing row
    -- that set it keeps working alongside the recurring columns.
    IF v_prefs.quiet_hours IS NOT NULL AND v_prefs.quiet_hours @> p_at THEN
        RETURN true;
    END IF;

    IF NOT v_prefs.quiet_hours_enabled
       OR v_prefs.quiet_hours_start IS NULL
       OR v_prefs.quiet_hours_end IS NULL THEN
        RETURN false;
    END IF;

    -- An invalid/unknown IANA zone must not break a money-movement RPC — fall back to UTC.
    BEGIN
        v_local := (p_at AT TIME ZONE COALESCE(NULLIF(v_prefs.timezone, ''), 'UTC'))::time;
    EXCEPTION WHEN OTHERS THEN
        v_local := (p_at AT TIME ZONE 'UTC')::time;
    END;

    IF v_prefs.quiet_hours_start <= v_prefs.quiet_hours_end THEN
        -- Same-day window, e.g. 13:00 → 14:00.
        RETURN v_local >= v_prefs.quiet_hours_start AND v_local < v_prefs.quiet_hours_end;
    END IF;

    -- Window crosses midnight, e.g. 22:00 → 07:00.
    RETURN v_local >= v_prefs.quiet_hours_start OR v_local < v_prefs.quiet_hours_end;
END;
$$;

COMMENT ON FUNCTION comms.fn_is_quiet_hours(uuid, timestamptz) IS
    'TRUE when the instant falls inside the recipient''s recurring local quiet-hours window (timezone-aware, midnight-crossing aware) or the legacy absolute quiet_hours range. Never raises.';

-- #endregion

-- #region 2. Suppression check — is this destination contactable?
CREATE OR REPLACE FUNCTION comms.fn_is_suppressed(
    p_channel comms.notification_channel,
    p_destination text,
    p_category comms.notification_category DEFAULT 'system'
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = comms, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM comms.channel_suppressions cs
        WHERE cs.channel = p_channel
          AND lower(cs.destination) = lower(p_destination)
          AND cs.lifted_at IS NULL
          -- A marketing-only suppression (an unsubscribe) never blocks a transactional send.
          AND (NOT cs.marketing_only OR p_category = 'marketing')
    );
$$;

COMMENT ON FUNCTION comms.fn_is_suppressed(comms.notification_channel, text, comms.notification_category) IS
    'TRUE when a destination is on the suppression list for a channel. A marketing_only suppression blocks only the marketing category, so an unsubscribe can never silence a security or money-movement email.';

-- #endregion

-- #region 3. The router — resolve the channel fan-out for one (recipient, event)
-- Precedence, highest first:
--   catalog.mandatory  >  global snooze (unless critical)  >  per-type mute  >
--   per-category toggles  >  global toggles  >  quiet hours  >  digest deferral
CREATE OR REPLACE FUNCTION comms.fn_resolve_channels(p_user_id uuid, p_type_key text)
RETURNS comms.notification_channel[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = comms, public
AS $$
DECLARE
    v_type comms.notification_types%ROWTYPE;
    v_prefs comms.notification_prefs%ROWTYPE;
    v_cat comms.notification_category_prefs%ROWTYPE;
    v_mute comms.notification_type_mutes%ROWTYPE;
    v_out comms.notification_channel[] := '{}';
    v_ch comms.notification_channel;
    v_allowed boolean;
    v_digest comms.digest_frequency;
    v_quiet boolean;
BEGIN
    SELECT * INTO v_type FROM comms.notification_types WHERE key = comms.fn_resolve_type_key(p_type_key);

    -- An unregistered event still reaches the inbox. Never block on catalog data.
    IF NOT FOUND THEN
        RETURN ARRAY['in_app']::comms.notification_channel[];
    END IF;

    IF NOT v_type.enabled THEN
        RETURN '{}'::comms.notification_channel[];
    END IF;

    -- (1) Mandatory events ignore every preference.
    IF v_type.mandatory THEN
        RETURN v_type.default_channels;
    END IF;

    SELECT * INTO v_prefs FROM comms.notification_prefs WHERE user_id = p_user_id;
    IF NOT FOUND THEN
        -- No prefs row yet (should not happen — see the seed trigger) — behave like the defaults.
        RETURN ARRAY['in_app']::comms.notification_channel[];
    END IF;

    -- (2) Global snooze. Only `critical` gets through.
    IF v_prefs.muted_until IS NOT NULL
       AND v_prefs.muted_until > now()
       AND v_type.urgency <> 'critical' THEN
        RETURN '{}'::comms.notification_channel[];
    END IF;

    -- (3) Per-type mute. A lapsed mute (muted_until in the past) is ignored, not deleted.
    SELECT * INTO v_mute
    FROM comms.notification_type_mutes
    WHERE user_id = p_user_id
      AND type_key = v_type.key
      AND (muted_until IS NULL OR muted_until > now());

    IF FOUND AND (v_mute.channels IS NULL OR array_length(v_mute.channels, 1) IS NULL) THEN
        -- Muted across every transport.
        RETURN '{}'::comms.notification_channel[];
    END IF;

    SELECT * INTO v_cat
    FROM comms.notification_category_prefs
    WHERE user_id = p_user_id AND category = v_type.category;

    v_quiet := comms.fn_is_quiet_hours(p_user_id);
    v_digest := COALESCE(v_cat.digest_frequency, v_prefs.digest_frequency, 'off');

    FOREACH v_ch IN ARRAY v_type.default_channels LOOP
        -- (3b) Transport-scoped mute.
        IF v_mute.user_id IS NOT NULL AND v_ch = ANY (COALESCE(v_mute.channels, '{}'::comms.notification_channel[])) THEN
            CONTINUE;
        END IF;

        -- (4) + (5) Category override, else the global toggle.
        v_allowed := CASE v_ch
            WHEN 'in_app'  THEN COALESCE(v_cat.in_app, v_prefs.in_app)
            WHEN 'push'    THEN COALESCE(v_cat.push,   v_prefs.push)
            WHEN 'email'   THEN COALESCE(v_cat.email,  v_prefs.email)
            WHEN 'sms'     THEN COALESCE(v_cat.sms,    v_prefs.sms)
            -- `webhook` is an integration, not a user preference — always allowed if the catalog
            -- asked for it.
            WHEN 'webhook' THEN true
        END;

        IF NOT COALESCE(v_allowed, false) THEN
            CONTINUE;
        END IF;

        -- (6) Quiet hours mute the intrusive transports only. The inbox and email still land.
        IF v_quiet AND NOT v_type.overrides_quiet_hours AND v_ch IN ('push', 'sms') THEN
            CONTINUE;
        END IF;

        -- (7) Digest deferral: a digestible, non-urgent event's EMAIL is rolled up instead of sent
        -- individually. The in-app row is unaffected — the inbox is always real time.
        IF v_ch = 'email'
           AND v_digest <> 'off'
           AND v_type.digestible
           AND v_type.urgency IN ('low', 'medium') THEN
            CONTINUE;
        END IF;

        v_out := array_append(v_out, v_ch);
    END LOOP;

    RETURN v_out;
END;
$$;

COMMENT ON FUNCTION comms.fn_resolve_channels(uuid, text) IS
    'Resolves the delivery fan-out for one (recipient, event key) by intersecting the catalog default_channels with the recipient''s global, per-category and per-type preferences, quiet hours and digest cadence. Mandatory types bypass all of it. Never raises.';

-- #endregion

-- #region 4. Deep-link resolution
CREATE OR REPLACE FUNCTION comms.fn_resolve_action_url(
    p_template text,
    p_notification_id uuid,
    p_entity_id uuid,
    p_context_id uuid
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v text := p_template;
BEGIN
    IF v IS NULL THEN
        RETURN NULL;
    END IF;

    -- A placeholder whose value is NULL cannot be substituted. Substituting an empty string would
    -- mint a broken link (`/projects/{context_id}` with no context becomes `/projects/`), so bail
    -- out and let the row render as non-clickable instead.
    IF position('{id}' IN v) > 0 THEN
        IF p_notification_id IS NULL THEN RETURN NULL; END IF;
        v := replace(v, '{id}', p_notification_id::text);
    END IF;
    IF position('{entity_id}' IN v) > 0 THEN
        IF p_entity_id IS NULL THEN RETURN NULL; END IF;
        v := replace(v, '{entity_id}', p_entity_id::text);
    END IF;
    IF position('{context_id}' IN v) > 0 THEN
        IF p_context_id IS NULL THEN RETURN NULL; END IF;
        v := replace(v, '{context_id}', p_context_id::text);
    END IF;

    -- Any placeholder left over (e.g. `{handle}`, which the database cannot resolve) means the same
    -- thing: better no link than a 404. The client may build its own from `payload`.
    IF position('{' IN v) > 0 THEN
        RETURN NULL;
    END IF;
    RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION comms.fn_notify(
    -- The original six parameters, in the original order, with the original meaning.
    p_user_id uuid,
    p_type text,
    p_title text,
    p_body text,
    p_entity_table text DEFAULT NULL,
    p_entity_id uuid DEFAULT NULL,
    -- Everything below is new and optional.
    p_payload jsonb DEFAULT '{}'::jsonb,
    p_actor_user_id uuid DEFAULT NULL,
    p_context_type text DEFAULT NULL,
    p_context_id uuid DEFAULT NULL,
    p_group_key text DEFAULT NULL,
    p_action_url text DEFAULT NULL,
    p_urgency comms.notification_urgency DEFAULT NULL,
    p_expires_at timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = comms, org, security, public
AS $$
DECLARE
    v_key text;
    v_type comms.notification_types%ROWTYPE;
    v_id uuid;
    v_existing uuid;
    v_channels comms.notification_channel[];
    v_urgency comms.notification_urgency;
    v_category comms.notification_category;
    v_action_url text;
    v_ch comms.notification_channel;
    v_device record;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    v_key := comms.fn_resolve_type_key(p_type);
    SELECT * INTO v_type FROM comms.notification_types WHERE key = v_key;

    -- Auto-register an unknown event so the catalog converges on reality instead of silently
    -- dropping policy. Wrapped: the key-format CHECK rejects a dotless legacy key, and that must
    -- not abort the caller's transaction.
    IF NOT FOUND THEN
        BEGIN
            INSERT INTO comms.notification_types (key, category, urgency, description)
            VALUES (v_key, 'system', 'medium', 'Auto-registered on first use by comms.fn_notify.')
            ON CONFLICT (key) DO NOTHING;
            SELECT * INTO v_type FROM comms.notification_types WHERE key = v_key;
        EXCEPTION WHEN OTHERS THEN
            v_type := NULL;
        END;
    END IF;

    v_category := COALESCE(v_type.category, 'system');
    v_urgency := COALESCE(p_urgency, v_type.urgency, 'medium');
    v_channels := comms.fn_resolve_channels(p_user_id, v_key);

    -- ── Collapse. A second event with the same (recipient, group_key) inside the catalog's window
    -- refreshes the existing row rather than adding another line to the inbox.
    IF p_group_key IS NOT NULL AND v_type.group_window IS NOT NULL THEN
        SELECT n.id INTO v_existing
        FROM comms.notifications n
        WHERE n.user_id = p_user_id
          AND n.group_key = p_group_key
          AND n.archived_at IS NULL
          AND n.created_at > now() - v_type.group_window
        ORDER BY n.created_at DESC
        LIMIT 1;

        IF v_existing IS NOT NULL THEN
            UPDATE comms.notifications
            SET title = p_title,
                body = p_body,
                payload = COALESCE(p_payload, '{}'::jsonb),
                group_count = group_count + 1,
                -- Resurface: a collapsed event is new information, so it becomes unread again.
                read_at = NULL,
                seen_at = NULL,
                created_at = now()
            WHERE id = v_existing;
            RETURN v_existing;
        END IF;
    END IF;

    INSERT INTO comms.notifications (
        user_id, type, title, body, entity_table, entity_id,
        category, urgency, actor_user_id, context_type, context_id,
        payload, group_key, channels, expires_at
    ) VALUES (
        p_user_id, v_key, p_title, p_body, p_entity_table, p_entity_id,
        v_category, v_urgency, p_actor_user_id, p_context_type, p_context_id,
        COALESCE(p_payload, '{}'::jsonb), p_group_key, v_channels, p_expires_at
    ) RETURNING id INTO v_id;

    -- Deep link: an explicit argument wins, otherwise resolve the catalog template.
    v_action_url := COALESCE(
        p_action_url,
        comms.fn_resolve_action_url(v_type.action_url_template, v_id, p_entity_id, p_context_id)
    );
    IF v_action_url IS NOT NULL THEN
        UPDATE comms.notifications SET action_url = v_action_url WHERE id = v_id;
    END IF;

    -- ── Delivery rows. `in_app` is already delivered the moment the row exists (Realtime streams
    -- comms.notifications, migration 0206); the rest are picked up by the dispatch Edge Function.
    FOREACH v_ch IN ARRAY COALESCE(v_channels, '{}'::comms.notification_channel[]) LOOP
        IF v_ch = 'push' THEN
            -- One row per live device, so a per-device failure can retire exactly that token.
            FOR v_device IN
                SELECT id FROM comms.device_tokens
                WHERE user_id = p_user_id AND revoked_at IS NULL
            LOOP
                INSERT INTO comms.notification_deliveries (notification_id, user_id, channel, device_token_id, status)
                VALUES (v_id, p_user_id, 'push', v_device.id, 'pending')
                ON CONFLICT DO NOTHING;
            END LOOP;

            -- Nothing registered: record the miss instead of leaving a silent gap.
            IF NOT EXISTS (
                SELECT 1 FROM comms.device_tokens WHERE user_id = p_user_id AND revoked_at IS NULL
            ) THEN
                INSERT INTO comms.notification_deliveries (notification_id, user_id, channel, status, suppressed_reason)
                VALUES (v_id, p_user_id, 'push', 'skipped', 'no_target')
                ON CONFLICT DO NOTHING;
            END IF;
        ELSE
            INSERT INTO comms.notification_deliveries (notification_id, user_id, channel, status, delivered_at)
            VALUES (
                v_id, p_user_id, v_ch,
                CASE WHEN v_ch = 'in_app' THEN 'delivered'::comms.delivery_status ELSE 'pending'::comms.delivery_status END,
                CASE WHEN v_ch = 'in_app' THEN now() ELSE NULL END
            )
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    -- ── Immutable audit trail for financial, security and moderation events. security.audit_logs
    -- has no `authenticated` grant, so this can only happen in a definer context — which is exactly
    -- where we are (see migrations 0107 / 0304 / 0313 for the same pattern).
    IF COALESCE(v_type.audit, false) THEN
        BEGIN
            INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
            VALUES (
                p_user_id,
                'notification.' || v_key,
                COALESCE(p_entity_table, 'comms.notifications'),
                COALESCE(p_entity_id, v_id),
                jsonb_build_object(
                    'notification_id', v_id,
                    'category', v_category,
                    'urgency', v_urgency,
                    'channels', v_channels,
                    'actor_user_id', p_actor_user_id
                )
            );
        EXCEPTION WHEN OTHERS THEN
            -- An audit-write problem must never roll back the money movement that emitted this.
            NULL;
        END;
    END IF;

    RETURN v_id;
EXCEPTION WHEN OTHERS THEN
    -- Rule 6: nothing in the notification engine may abort its caller.
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION comms.fn_notify IS
    'Writes one notification: resolves the catalog key (aliases included), collapses into a recent same-group row when the catalog defines a window, resolves the channel fan-out against the recipient''s preferences, materialises per-channel delivery rows, and audits when the catalog says so. Compatible superset of the six-argument 0305 signature. Never raises — a notification failure must never roll back an escrow or stage transition.';

-- #endregion

-- #region 6. Fan-out helper — one event, many recipients
CREATE OR REPLACE FUNCTION comms.fn_notify_many(
    p_user_ids uuid[],
    p_type text,
    p_title text,
    p_body text,
    p_entity_table text DEFAULT NULL,
    p_entity_id uuid DEFAULT NULL,
    p_payload jsonb DEFAULT '{}'::jsonb,
    p_actor_user_id uuid DEFAULT NULL,
    p_context_type text DEFAULT NULL,
    p_context_id uuid DEFAULT NULL,
    p_group_key text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = comms, public
AS $$
DECLARE
    v_uid uuid;
    v_count integer := 0;
BEGIN
    -- DISTINCT so a user who is both (say) stage lead and team member is told once. The actor is
    -- never notified about their own action.
    FOR v_uid IN
        SELECT DISTINCT u FROM unnest(COALESCE(p_user_ids, '{}'::uuid[])) AS u
        WHERE u IS NOT NULL AND (p_actor_user_id IS NULL OR u <> p_actor_user_id)
    LOOP
        IF comms.fn_notify(
            v_uid, p_type, p_title, p_body, p_entity_table, p_entity_id,
            p_payload, p_actor_user_id, p_context_type, p_context_id, p_group_key
        ) IS NOT NULL THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;
    RETURN v_count;
END;
$$;

-- #endregion

-- #region 7. Scheduling — enqueue, cancel, and materialise
CREATE OR REPLACE FUNCTION comms.fn_enqueue(
    p_user_id uuid,
    p_type text,
    p_title text,
    p_body text,
    p_scheduled_for timestamptz,
    p_dedupe_key text DEFAULT NULL,
    p_entity_table text DEFAULT NULL,
    p_entity_id uuid DEFAULT NULL,
    p_payload jsonb DEFAULT '{}'::jsonb,
    p_context_type text DEFAULT NULL,
    p_context_id uuid DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL,
    p_group_key text DEFAULT NULL,
    p_reason text DEFAULT 'scheduled'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = comms, public
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_user_id IS NULL OR p_scheduled_for IS NULL THEN
        RETURN NULL;
    END IF;

    -- Re-scheduling the same promise (a session moved) updates in place thanks to the partial
    -- unique index on live dedupe keys.
    INSERT INTO comms.notification_queue (
        user_id, type, title, body, scheduled_for, dedupe_key,
        entity_table, entity_id, payload, context_type, context_id,
        actor_user_id, group_key, reason
    ) VALUES (
        p_user_id, comms.fn_resolve_type_key(p_type), p_title, p_body, p_scheduled_for, p_dedupe_key,
        p_entity_table, p_entity_id, COALESCE(p_payload, '{}'::jsonb), p_context_type, p_context_id,
        p_actor_user_id, p_group_key, p_reason
    )
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('scheduled', 'processing')
    DO UPDATE SET
        scheduled_for = EXCLUDED.scheduled_for,
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        payload = EXCLUDED.payload
    RETURNING id INTO v_id;

    RETURN v_id;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION comms.fn_enqueue IS
    'Schedules a future notification. A deterministic dedupe_key makes re-running a scheduler a no-op and lets the event that invalidates the reminder cancel it by key.';

-- Cancel by key (the session was cancelled) or by entity (the whole project ended).
CREATE OR REPLACE FUNCTION comms.fn_cancel_queued(
    p_dedupe_key text DEFAULT NULL,
    p_entity_table text DEFAULT NULL,
    p_entity_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = comms, public
AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE comms.notification_queue
    SET status = 'cancelled'
    WHERE status = 'scheduled'
      AND (
            (p_dedupe_key IS NOT NULL AND dedupe_key = p_dedupe_key)
         OR (p_entity_table IS NOT NULL AND p_entity_id IS NOT NULL
             AND entity_table = p_entity_table AND entity_id = p_entity_id)
      );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- The cron worker: claim due rows and turn each into a real notification.
CREATE OR REPLACE FUNCTION comms.fn_process_queue(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = comms, public
AS $$
DECLARE
    v_row record;
    v_id uuid;
    v_count integer := 0;
BEGIN
    FOR v_row IN
        SELECT * FROM comms.notification_queue
        WHERE status = 'scheduled' AND scheduled_for <= now()
        ORDER BY scheduled_for
        LIMIT GREATEST(p_limit, 0)
        -- Two overlapping cron ticks must not both send the same reminder.
        FOR UPDATE SKIP LOCKED
    LOOP
        v_id := comms.fn_notify(
            v_row.user_id, v_row.type, v_row.title, v_row.body,
            v_row.entity_table, v_row.entity_id, v_row.payload,
            v_row.actor_user_id, v_row.context_type, v_row.context_id,
            v_row.group_key
        );

        IF v_id IS NOT NULL THEN
            UPDATE comms.notification_queue
            SET status = 'sent', notification_id = v_id, attempts = attempts + 1
            WHERE id = v_row.id;
            v_count := v_count + 1;
        ELSE
            UPDATE comms.notification_queue
            SET status = CASE WHEN attempts + 1 >= 3 THEN 'failed'::comms.queue_status ELSE 'scheduled'::comms.queue_status END,
                attempts = attempts + 1,
                -- Linear backoff; three strikes and the row is parked for inspection.
                scheduled_for = now() + (interval '5 minutes' * (attempts + 1)),
                last_error = 'fn_notify returned NULL'
            WHERE id = v_row.id;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$;

-- #endregion

-- #region 8. Inbox RPCs (SECURITY INVOKER — RLS is the guard, not a WHERE clause I wrote)
-- These run as the caller, so the RLS policies in migration 5/5 are what actually restrict them.
-- The explicit `auth.uid()` predicates are belt-and-braces, not the security boundary.

CREATE OR REPLACE FUNCTION comms.mark_notifications_read(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SET search_path = comms, public
AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE comms.notifications
    SET read_at = now(), seen_at = COALESCE(seen_at, now())
    WHERE id = ANY (COALESCE(p_ids, '{}'::uuid[]))
      AND user_id = auth.uid()
      AND read_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION comms.mark_all_notifications_read(p_category comms.notification_category DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path = comms, public
AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE comms.notifications
    SET read_at = now(), seen_at = COALESCE(seen_at, now())
    WHERE user_id = auth.uid()
      AND read_at IS NULL
      AND archived_at IS NULL
      AND (p_category IS NULL OR category = p_category);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- Clears the badge without marking anything read — what opening the notifications drawer does.
CREATE OR REPLACE FUNCTION comms.mark_notifications_seen()
RETURNS integer
LANGUAGE plpgsql
SET search_path = comms, public
AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE comms.notifications
    SET seen_at = now()
    WHERE user_id = auth.uid() AND seen_at IS NULL AND archived_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- Dismiss = archive. Nothing is hard-deleted (root CLAUDE.md §5).
CREATE OR REPLACE FUNCTION comms.archive_notifications(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SET search_path = comms, public
AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE comms.notifications
    SET archived_at = now()
    WHERE id = ANY (COALESCE(p_ids, '{}'::uuid[]))
      AND user_id = auth.uid()
      AND archived_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- The shell badge: total unread plus a per-category breakdown, in one round trip.
CREATE OR REPLACE FUNCTION comms.get_notification_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = comms, public
AS $$
    SELECT jsonb_build_object(
        'unread', COALESCE(SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END), 0),
        'unseen', COALESCE(SUM(CASE WHEN seen_at IS NULL THEN 1 ELSE 0 END), 0),
        'total', COUNT(*),
        'by_category', COALESCE(
            (SELECT jsonb_object_agg(category::text, cnt)
             FROM (
                SELECT category, COUNT(*) AS cnt
                FROM comms.notifications
                WHERE user_id = auth.uid()
                  AND read_at IS NULL
                  AND archived_at IS NULL
                  AND (expires_at IS NULL OR expires_at > now())
                  AND 'in_app' = ANY (channels)
                GROUP BY category
             ) c),
            '{}'::jsonb
        )
    )
    FROM comms.notifications
    WHERE user_id = auth.uid()
      AND archived_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
      AND 'in_app' = ANY (channels);
$$;

-- #endregion

-- #region 9. Device registration RPCs
CREATE OR REPLACE FUNCTION comms.register_device(
    p_token text,
    p_platform comms.device_platform DEFAULT 'web',
    p_provider text DEFAULT 'web_push',
    p_endpoint text DEFAULT NULL,
    p_p256dh text DEFAULT NULL,
    p_auth_key text DEFAULT NULL,
    p_label text DEFAULT NULL,
    p_user_agent text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = comms, public
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF auth.uid() IS NULL OR p_token IS NULL OR p_token = '' THEN
        RETURN NULL;
    END IF;

    -- Re-registering the same browser refreshes the live row (and resurrects a revoked one)
    -- instead of accumulating duplicates that each cost a push request.
    INSERT INTO comms.device_tokens (
        user_id, token, platform, provider, endpoint, p256dh, auth_key, label, user_agent, last_seen_at
    ) VALUES (
        auth.uid(), p_token, p_platform, p_provider, p_endpoint, p_p256dh, p_auth_key, p_label, p_user_agent, now()
    )
    ON CONFLICT (user_id, token) WHERE revoked_at IS NULL
    DO UPDATE SET
        platform = EXCLUDED.platform,
        provider = EXCLUDED.provider,
        endpoint = EXCLUDED.endpoint,
        p256dh = EXCLUDED.p256dh,
        auth_key = EXCLUDED.auth_key,
        label = COALESCE(EXCLUDED.label, device_tokens.label),
        user_agent = EXCLUDED.user_agent,
        last_seen_at = now(),
        failure_count = 0
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION comms.revoke_device(p_id uuid, p_reason text DEFAULT 'user_revoked')
RETURNS boolean
LANGUAGE plpgsql
SET search_path = comms, public
AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE comms.device_tokens
    SET revoked_at = now(),
        revoked_reason = p_reason,
        -- Drop the transport credentials the moment they stop being needed.
        auth_key = NULL,
        p256dh = NULL
    WHERE id = p_id AND user_id = auth.uid() AND revoked_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count > 0;
END;
$$;

-- #endregion

-- #region 9. Scheduled jobs — the time-based half of the routing matrix
-- Each is idempotent and bounded, so a missed tick self-heals and an overlapping tick cannot
-- double-send.

-- (a) Unread escalation: "still unread after the user's escalate_after window → fall back to email".
-- Only for urgent, non-digestible events that were pushed but not read. The `NOT EXISTS` guard on an
-- existing email delivery row is what stops every cron tick sending another copy.
CREATE OR REPLACE FUNCTION comms.fn_escalate_unread(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = comms, public
AS $$
DECLARE
    v_row record;
    v_count integer := 0;
BEGIN
    FOR v_row IN
        SELECT n.id, n.user_id, n.category
        FROM comms.notifications n
        JOIN comms.notification_prefs p ON p.user_id = n.user_id
        LEFT JOIN comms.notification_types t ON t.key = n.type
        WHERE n.read_at IS NULL
          AND n.archived_at IS NULL
          AND n.urgency IN ('critical', 'high')
          AND p.email IS TRUE
          AND p.escalate_after IS NOT NULL
          AND n.created_at <= now() - p.escalate_after
          -- Bounded window: an unread notification from last month is not escalated today.
          AND n.created_at > now() - interval '24 hours'
          AND 'email'::comms.notification_channel <> ALL (n.channels)
          AND (t.key IS NULL OR NOT t.digestible OR t.urgency = 'critical')
          AND NOT EXISTS (
              SELECT 1 FROM comms.notification_deliveries d
              WHERE d.notification_id = n.id AND d.channel = 'email'
          )
        ORDER BY n.created_at
        LIMIT GREATEST(p_limit, 0)
    LOOP
        INSERT INTO comms.notification_deliveries (notification_id, user_id, channel, status, provider)
        VALUES (v_row.id, v_row.user_id, 'email', 'pending', 'escalation')
        ON CONFLICT DO NOTHING;

        -- Record the escalation on the notification itself so the channel audit stays truthful.
        UPDATE comms.notifications
        SET channels = array_append(channels, 'email'::comms.notification_channel)
        WHERE id = v_row.id AND 'email'::comms.notification_channel <> ALL (channels);

        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

-- (b0) Safe local-clock helper. A bad IANA zone must degrade to UTC, not abort the digest run for
-- every other user. Kept as its own function so the digest loop needs no exception block (PL/pgSQL
-- will not let CONTINUE cross out of one).
CREATE OR REPLACE FUNCTION comms.fn_local_now(p_timezone text, p_at timestamptz DEFAULT now())
RETURNS timestamp
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN p_at AT TIME ZONE COALESCE(NULLIF(p_timezone, ''), 'UTC');
EXCEPTION WHEN OTHERS THEN
    RETURN p_at AT TIME ZONE 'UTC';
END;
$$;

-- (b) Digest builder. Run hourly; picks the users whose LOCAL clock has just reached their
-- digest hour (and, for weekly, their digest weekday). The unique index on
-- (user_id, period, window_start) makes a double tick a no-op.
CREATE OR REPLACE FUNCTION comms.fn_build_digests(p_period comms.digest_frequency)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = comms, public
AS $$
DECLARE
    v_user record;
    v_start timestamptz;
    v_end timestamptz := date_trunc('hour', now());
    v_ids uuid[];
    v_summary jsonb;
    v_count integer := 0;
BEGIN
    IF p_period NOT IN ('daily', 'weekly') THEN
        RETURN 0;
    END IF;

    v_start := CASE p_period WHEN 'daily' THEN v_end - interval '1 day' ELSE v_end - interval '7 days' END;

    -- The local-clock gate lives in the WHERE clause (via the safe helper) so the loop body is
    -- reached only for users who are actually due right now.
    FOR v_user IN
        SELECT p.user_id, p.timezone, p.digest_hour, p.digest_weekday
        FROM comms.notification_prefs p
        WHERE p.digest_frequency = p_period
          AND p.email IS TRUE
          AND EXTRACT(HOUR FROM comms.fn_local_now(p.timezone))::int = p.digest_hour
          AND (
                p_period <> 'weekly'
                OR EXTRACT(ISODOW FROM comms.fn_local_now(p.timezone))::int = COALESCE(p.digest_weekday, 1)
          )
    LOOP
        SELECT array_agg(n.id ORDER BY n.created_at DESC),
               jsonb_object_agg(n.category::text, n.cnt)
        INTO v_ids, v_summary
        FROM (
            SELECT n2.id, n2.category, n2.created_at, COUNT(*) OVER (PARTITION BY n2.category) AS cnt
            FROM comms.notifications n2
            LEFT JOIN comms.notification_types t ON t.key = n2.type
            WHERE n2.user_id = v_user.user_id
              AND n2.created_at >= v_start
              AND n2.created_at < v_end
              AND n2.archived_at IS NULL
              AND COALESCE(t.digestible, true)
        ) n;

        INSERT INTO comms.notification_digests (
            user_id, period, window_start, window_end, status, notification_ids, item_count, summary
        ) VALUES (
            v_user.user_id, p_period, v_start, v_end,
            CASE WHEN COALESCE(array_length(v_ids, 1), 0) = 0 THEN 'skipped' ELSE 'pending' END,
            COALESCE(v_ids, '{}'::uuid[]),
            COALESCE(array_length(v_ids, 1), 0),
            COALESCE(v_summary, '{}'::jsonb)
        )
        ON CONFLICT (user_id, period, window_start) DO NOTHING;

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

-- (c) Expiry sweep: a reminder that has come and gone stops cluttering the inbox. Archives, never
-- deletes (root CLAUDE.md §5).
CREATE OR REPLACE FUNCTION comms.fn_sweep_expired()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = comms, public
AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE comms.notifications
    SET archived_at = now()
    WHERE archived_at IS NULL
      AND expires_at IS NOT NULL
      AND expires_at <= now();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- (d) Dead-device reaper: a token that has failed repeatedly, or that has not been seen for six
-- months, costs a gateway request per notification forever. Soft-revoke it.
CREATE OR REPLACE FUNCTION comms.fn_reap_dead_devices(p_failure_threshold smallint DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = comms, public
AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE comms.device_tokens
    SET revoked_at = now(),
        revoked_reason = CASE WHEN failure_count >= p_failure_threshold THEN 'gateway_failures' ELSE 'stale' END,
        auth_key = NULL,
        p256dh = NULL
    WHERE revoked_at IS NULL
      AND (failure_count >= p_failure_threshold OR last_seen_at < now() - interval '180 days');
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- (e) Callback compaction: keep the delivery-event ROW (it is the idempotency key and must never
-- disappear) but drop its raw provider body once it is no longer useful for debugging.
CREATE OR REPLACE FUNCTION comms.fn_compact_delivery_events(p_older_than interval DEFAULT '30 days')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = comms, public
AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE comms.delivery_events
    SET raw = '{}'::jsonb
    WHERE created_at < now() - p_older_than
      AND raw <> '{}'::jsonb;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION comms.fn_dispatch_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = comms, security, public
AS $$
DECLARE
    v_enabled boolean;
    v_url text;
BEGIN
    -- Fast exit on the default path.
    SELECT enabled INTO v_enabled FROM security.feature_flags WHERE key = 'comms.dispatch_webhook';
    IF NOT COALESCE(v_enabled, false) THEN
        RETURN NEW;
    END IF;

    -- Nothing to fan out: the in-app row is already delivered by Realtime.
    IF NEW.channels IS NULL
       OR array_length(NEW.channels, 1) IS NULL
       OR NEW.channels = ARRAY['in_app']::comms.notification_channel[] THEN
        RETURN NEW;
    END IF;

    SELECT value #>> '{}' INTO v_url FROM security.platform_params WHERE key = 'comms_dispatch_url';
    IF v_url IS NULL OR v_url = '' OR v_url = 'XXXX-XXXX' THEN
        RETURN NEW;
    END IF;

    -- Dynamic so the function still compiles where pg_net is not installed. Any failure is
    -- swallowed: the cron worker re-drives pending deliveries, and a webhook problem must never
    -- roll back the money movement that emitted this notification.
    BEGIN
        EXECUTE format(
            'SELECT net.http_post(url := %L, body := %L::jsonb, headers := %L::jsonb)',
            v_url,
            jsonb_build_object('notification_id', NEW.id, 'user_id', NEW.user_id, 'type', NEW.type)::text,
            jsonb_build_object('Content-Type', 'application/json')::text
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION comms.fn_dispatch_notification() IS
    'AFTER INSERT hook that pokes the dispatch Edge Function for the non-in_app channels. Feature-flagged off by default, placeholder URL, pg_net-optional, and failure-swallowing — it can never block or roll back the transaction that emitted the notification.';
