-- =============================================================================================
-- 20260724094000_comms_notification_rls_jobs.sql
-- Notification engine foundation (5/5) — RLS policies, grants, realtime, the scheduled jobs and
-- the outbound dispatch webhook.
--
-- ADDITIVE ONLY. New policies, grants, functions and (guarded) cron schedules. Nothing existing is
-- dropped or altered. Authored, NOT applied to any live database.
--
-- ⚠️ THE BUG THIS FIXES FIRST. `comms.notifications`, `comms.notification_prefs` and
-- `comms.device_tokens` have had ROW LEVEL SECURITY ENABLED since migration 0201 and ZERO POLICIES
-- ever since. RLS with no policy is default-deny, so `authenticated` could not read a single
-- notification — and because Supabase Realtime enforces the same SELECT policy before it will emit
-- a row, the in-app channel could never have delivered anything even though the table has been in
-- the `supabase_realtime` publication since migration 0206. The policies in §2 are what make the
-- in-app channel actually work.
--
-- The write side stays closed on purpose: no INSERT policy exists on `comms.notifications`. Rows
-- are created ONLY by `comms.fn_notify` (SECURITY DEFINER) or the service role. A client cannot
-- forge a notification for itself or anyone else.
-- =============================================================================================

-- #region 1. Grants — the new tables (0200's blanket comms grant predates them)
GRANT SELECT ON TABLE comms.notification_types TO authenticated;
GRANT ALL ON TABLE comms.notification_types TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE comms.notification_category_prefs TO authenticated;
GRANT ALL ON TABLE comms.notification_category_prefs TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE comms.notification_type_mutes TO authenticated;
GRANT ALL ON TABLE comms.notification_type_mutes TO service_role;

GRANT SELECT ON TABLE comms.notification_deliveries TO authenticated;
GRANT ALL ON TABLE comms.notification_deliveries TO service_role;

GRANT SELECT ON TABLE comms.notification_queue TO authenticated;
GRANT ALL ON TABLE comms.notification_queue TO service_role;

GRANT SELECT ON TABLE comms.notification_digests TO authenticated;
GRANT ALL ON TABLE comms.notification_digests TO service_role;

-- Provider callbacks and suppressions are operational data. `authenticated` gets a read on its own
-- suppressions only (so the settings screen can explain "we stopped emailing you because…"), and
-- no access at all to raw gateway events.
GRANT SELECT ON TABLE comms.channel_suppressions TO authenticated;
GRANT ALL ON TABLE comms.channel_suppressions TO service_role;
GRANT ALL ON TABLE comms.delivery_events TO service_role;

GRANT SELECT ON comms.notification_feed TO authenticated;
GRANT SELECT ON comms.notification_unread_counts TO authenticated;
GRANT SELECT ON comms.notification_delivery_health TO authenticated;
-- #endregion

-- #region 2. comms.notifications — the read + mark-read policies that were missing
ALTER TABLE comms.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own notifications" ON comms.notifications;
CREATE POLICY "Users view own notifications" ON comms.notifications FOR
SELECT TO authenticated USING (user_id = auth.uid ());

-- The ONLY client write: flipping read/seen/archived on your own row. The USING clause scopes the
-- rows; the WITH CHECK clause stops a client rewriting `user_id` to someone else's.
DROP POLICY IF EXISTS "Users update own notification state" ON comms.notifications;
CREATE POLICY "Users update own notification state" ON comms.notifications FOR
UPDATE TO authenticated USING (user_id = auth.uid ())
WITH CHECK (user_id = auth.uid ());

-- Deliberately NO INSERT and NO DELETE policy:
--   * INSERT — a notification is written by comms.fn_notify (SECURITY DEFINER) or the service role.
--     A client forging one would let anyone spoof "Payout sent".
--   * DELETE — nothing is hard-deleted (root CLAUDE.md §5); dismissing sets `archived_at` via the
--     UPDATE policy above.
-- #endregion

-- #region 3. Preferences — full self-service, scoped to the owner
ALTER TABLE comms.notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own notification prefs" ON comms.notification_prefs;
CREATE POLICY "Users view own notification prefs" ON comms.notification_prefs FOR
SELECT TO authenticated USING (user_id = auth.uid ());

DROP POLICY IF EXISTS "Users insert own notification prefs" ON comms.notification_prefs;
CREATE POLICY "Users insert own notification prefs" ON comms.notification_prefs FOR
INSERT TO authenticated WITH CHECK (user_id = auth.uid ());

DROP POLICY IF EXISTS "Users update own notification prefs" ON comms.notification_prefs;
CREATE POLICY "Users update own notification prefs" ON comms.notification_prefs FOR
UPDATE TO authenticated USING (user_id = auth.uid ())
WITH CHECK (user_id = auth.uid ());

ALTER TABLE comms.notification_category_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own category prefs" ON comms.notification_category_prefs;
CREATE POLICY "Users manage own category prefs" ON comms.notification_category_prefs FOR ALL
TO authenticated USING (user_id = auth.uid ())
WITH CHECK (user_id = auth.uid ());

ALTER TABLE comms.notification_type_mutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own type mutes" ON comms.notification_type_mutes;
CREATE POLICY "Users manage own type mutes" ON comms.notification_type_mutes FOR ALL
TO authenticated USING (user_id = auth.uid ())
WITH CHECK (user_id = auth.uid ());
-- #endregion

-- #region 4. Catalog — readable by everyone signed in (the preference centre renders from it)
ALTER TABLE comms.notification_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read notification catalog" ON comms.notification_types;
CREATE POLICY "Read notification catalog" ON comms.notification_types FOR
SELECT TO authenticated USING (enabled OR security.is_admin ());

-- Writes are service-role/definer only — the catalog is platform policy, not user data.
-- #endregion

-- #region 5. Device tokens — register, list, revoke your own
ALTER TABLE comms.device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own devices" ON comms.device_tokens;
CREATE POLICY "Users view own devices" ON comms.device_tokens FOR
SELECT TO authenticated USING (user_id = auth.uid ());

DROP POLICY IF EXISTS "Users register own devices" ON comms.device_tokens;
CREATE POLICY "Users register own devices" ON comms.device_tokens FOR
INSERT TO authenticated WITH CHECK (user_id = auth.uid ());

DROP POLICY IF EXISTS "Users update own devices" ON comms.device_tokens;
CREATE POLICY "Users update own devices" ON comms.device_tokens FOR
UPDATE TO authenticated USING (user_id = auth.uid ())
WITH CHECK (user_id = auth.uid ());

-- A hard DELETE is allowed here (unlike a notification): un-registering a browser should genuinely
-- remove its push credentials. `comms.revoke_device` is still the preferred path — it keeps the
-- audit row and clears the keys.
DROP POLICY IF EXISTS "Users delete own devices" ON comms.device_tokens;
CREATE POLICY "Users delete own devices" ON comms.device_tokens FOR
DELETE TO authenticated USING (user_id = auth.uid ());
-- #endregion

-- #region 6. Delivery, queue, digests, suppressions — read-own, write-never
ALTER TABLE comms.notification_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own deliveries" ON comms.notification_deliveries;
CREATE POLICY "Users view own deliveries" ON comms.notification_deliveries FOR
SELECT TO authenticated USING (user_id = auth.uid () OR security.is_admin ());

ALTER TABLE comms.notification_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own queued notifications" ON comms.notification_queue;
CREATE POLICY "Users view own queued notifications" ON comms.notification_queue FOR
SELECT TO authenticated USING (user_id = auth.uid () OR security.is_admin ());

ALTER TABLE comms.notification_digests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own digests" ON comms.notification_digests;
CREATE POLICY "Users view own digests" ON comms.notification_digests FOR
SELECT TO authenticated USING (user_id = auth.uid () OR security.is_admin ());

ALTER TABLE comms.channel_suppressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own suppressions" ON comms.channel_suppressions;
CREATE POLICY "Users view own suppressions" ON comms.channel_suppressions FOR
SELECT TO authenticated USING (user_id = auth.uid () OR security.is_admin ());

-- Raw provider callbacks: no `authenticated` policy at all. Service role only.
ALTER TABLE comms.delivery_events ENABLE ROW LEVEL SECURITY;
-- #endregion

-- #region 7. Function grants
GRANT EXECUTE ON FUNCTION comms.mark_notifications_read(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION comms.mark_all_notifications_read(comms.notification_category) TO authenticated;
GRANT EXECUTE ON FUNCTION comms.mark_notifications_seen() TO authenticated;
GRANT EXECUTE ON FUNCTION comms.archive_notifications(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION comms.get_notification_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION comms.register_device(text, comms.device_platform, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION comms.revoke_device(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION comms.fn_resolve_type_key(text) TO authenticated;

-- The writer, the router and the schedulers are NOT granted to `authenticated`. A client that could
-- call fn_notify could spoof any notification to any user; a client that could call fn_process_queue
-- could force-send every pending reminder.
GRANT EXECUTE ON FUNCTION comms.fn_notify(uuid, text, text, text, text, uuid, jsonb, uuid, text, uuid, text, text, comms.notification_urgency, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION comms.fn_notify_many(uuid[], text, text, text, text, uuid, jsonb, uuid, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION comms.fn_enqueue(uuid, text, text, text, timestamptz, text, text, uuid, jsonb, text, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION comms.fn_cancel_queued(text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION comms.fn_process_queue(integer) TO service_role;
GRANT EXECUTE ON FUNCTION comms.fn_is_quiet_hours(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION comms.fn_resolve_channels(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION comms.fn_is_suppressed(comms.notification_channel, text, comms.notification_category) TO service_role;
-- #endregion

-- #region 8. Realtime — stream the per-channel delivery state too
-- comms.notifications is already published (migration 0206). Adding the delivery rows lets the
-- client show "sent → delivered" state without polling. Guarded: re-adding a published table
-- raises, and this migration must be re-runnable.
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE comms.notification_deliveries;
EXCEPTION WHEN duplicate_object THEN null; WHEN OTHERS THEN null; END $$;
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

GRANT EXECUTE ON FUNCTION comms.fn_escalate_unread(integer) TO service_role;
GRANT EXECUTE ON FUNCTION comms.fn_build_digests(comms.digest_frequency) TO service_role;
GRANT EXECUTE ON FUNCTION comms.fn_sweep_expired() TO service_role;
GRANT EXECUTE ON FUNCTION comms.fn_reap_dead_devices(smallint) TO service_role;
GRANT EXECUTE ON FUNCTION comms.fn_compact_delivery_events(interval) TO service_role;
-- #endregion

-- #region 10. pg_cron schedules
-- Guarded end to end: the extension may not be installed (local `supabase start` does not ship it
-- by default), and `cron.schedule` needs privileges a migration run may not have. A failure here
-- must not block the rest of the migration — the jobs can be scheduled by hand afterwards using
-- exactly the statements below.
DO $$
BEGIN
    -- No `WITH SCHEMA` — pg_cron insists on its own `cron` schema.
    CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable — notification jobs must be scheduled manually.';
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Materialise due reminders (session T-60/T-15/T-5, basket nudges, ghosting timers).
        PERFORM cron.schedule('comms-process-queue', '* * * * *', 'SELECT comms.fn_process_queue(500);');
        -- Unread → email fallback.
        PERFORM cron.schedule('comms-escalate-unread', '*/5 * * * *', 'SELECT comms.fn_escalate_unread(500);');
        -- Digests, evaluated hourly against each user's local clock.
        PERFORM cron.schedule('comms-digest-daily', '5 * * * *', $q$SELECT comms.fn_build_digests('daily');$q$);
        PERFORM cron.schedule('comms-digest-weekly', '10 * * * *', $q$SELECT comms.fn_build_digests('weekly');$q$);
        -- Housekeeping.
        PERFORM cron.schedule('comms-sweep-expired', '0 * * * *', 'SELECT comms.fn_sweep_expired();');
        PERFORM cron.schedule('comms-reap-devices', '30 3 * * *', 'SELECT comms.fn_reap_dead_devices();');
        PERFORM cron.schedule('comms-compact-events', '45 3 * * *', 'SELECT comms.fn_compact_delivery_events();');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not register comms cron jobs (%). Schedule them manually.', SQLERRM;
END $$;
-- #endregion

-- #region 11. Outbound dispatch webhook (comms.notifications INSERT → the push/email Edge Function)
-- The in-app channel needs nothing here (Realtime already streams the table). Push, email and SMS
-- need a worker, and the cheapest trigger is the insert itself.
--
-- Everything is feature-flagged and guarded:
--   * `security.feature_flags['comms.dispatch_webhook']` must be enabled;
--   * `security.platform_params['comms_dispatch_url']` supplies the Edge Function URL — a
--     placeholder is seeded, NEVER a real key (root CLAUDE.md §6, zero-trust placeholders);
--   * `pg_net` may be absent, so the call is made through dynamic SQL inside an exception block.
-- With the flag off (the default) this trigger costs one flag lookup per notification and does
-- nothing else.
INSERT INTO security.feature_flags (key, enabled, payload)
VALUES ('comms.dispatch_webhook', false, jsonb_build_object(
    'description', 'When enabled, a comms.notifications INSERT calls the dispatch Edge Function via pg_net for push/email/SMS fan-out.'
))
ON CONFLICT (key) DO NOTHING;

INSERT INTO security.platform_params (key, value, description)
VALUES (
    'comms_dispatch_url',
    to_jsonb('XXXX-XXXX'::text),
    'Edge Function URL for notification dispatch (push/email/SMS). Placeholder — set per environment; never commit a real URL or key.'
)
ON CONFLICT (key) DO NOTHING;

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

DROP TRIGGER IF EXISTS on_notification_created_dispatch ON comms.notifications;
CREATE TRIGGER on_notification_created_dispatch
    AFTER INSERT ON comms.notifications
    FOR EACH ROW EXECUTE FUNCTION comms.fn_dispatch_notification();
-- #endregion
