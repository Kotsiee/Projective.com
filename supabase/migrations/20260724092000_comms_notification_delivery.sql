-- =============================================================================================
-- 20260724092000_comms_notification_delivery.sql
-- Notification engine foundation (3/5) — per-channel delivery tracking, the scheduled-send queue,
-- digests, provider callbacks & suppressions.
--
-- ADDITIVE ONLY. Five new tables in the `comms` schema. Nothing existing is dropped or altered.
-- Authored, NOT applied to any live database.
--
-- WHY THESE TABLES EXIST.
--   * `notification_deliveries` — a notification is ONE event but MANY sends. Without a row per
--     (notification, channel) nothing can answer "did the push actually arrive?", "has the email
--     fallback already fired?" (the still-unread-after-15-minutes rule would double-send on every
--     cron tick), or "why did this user not get told?".
--   * `notification_queue` — every time-based flow in the product (session T-60/T-15/T-5 reminders,
--     abandoned basket at 24h, ghosting/auto-approve timers, weekly earnings digest, and quiet-hours
--     deferral) is "materialise this notification later, unless the reason for it goes away". A
--     durable, cancellable, deduplicated row is the only way to express that in the database.
--   * `notification_digests` — the rolled-up delivery a `digest_frequency` user gets instead of N
--     individual sends.
--   * `delivery_events` — inbound provider callbacks (delivered / bounced / complaint / device
--     unregistered). Unique on the provider's own event id: the SYSTEM_ARCHITECTURE webhook
--     standard is idempotency, and this table IS the idempotency key.
--   * `channel_suppressions` — a destination that must never be contacted again (hard bounce, spam
--     complaint, unsubscribe). Legally and operationally non-negotiable for an email channel.
-- =============================================================================================

-- #region 1. comms.notification_deliveries — one row per (notification, channel, target)
CREATE TABLE IF NOT EXISTS comms.notification_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    notification_id uuid NOT NULL,
    -- Denormalized recipient so RLS never has to join back to comms.notifications.
    user_id uuid NOT NULL,
    channel comms.notification_channel NOT NULL,
    status comms.delivery_status NOT NULL DEFAULT 'pending',
    -- Which device this send targets. Only meaningful for `push` — a user with three registered
    -- browsers gets three delivery rows for one notification.
    device_token_id uuid,
    -- Gateway identity, e.g. 'web_push' | 'fcm' | 'apns' | 'resend' | 'sendgrid' | 'twilio'.
    provider text,
    -- The gateway's own message id, used to correlate an inbound delivery_event.
    provider_ref text,
    attempts smallint NOT NULL DEFAULT 0,
    -- Set when the router decided NOT to send: 'muted' | 'quiet_hours' | 'digest_deferred' |
    -- 'suppressed_destination' | 'no_target' | 'channel_disabled'. Kept as free text so a new
    -- reason never needs a migration.
    suppressed_reason text,
    error text,
    queued_at timestamptz,
    sent_at timestamptz,
    delivered_at timestamptz,
    failed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_deliveries_notification_id_fkey
        FOREIGN KEY (notification_id) REFERENCES comms.notifications (id) ON DELETE CASCADE,
    CONSTRAINT notification_deliveries_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    CONSTRAINT notification_deliveries_device_token_id_fkey
        FOREIGN KEY (device_token_id) REFERENCES comms.device_tokens (id) ON DELETE SET NULL,
    CONSTRAINT notification_deliveries_attempts_check CHECK (attempts >= 0)
);

-- Idempotency for the dispatcher: one attempt row per (notification, channel, device). The
-- COALESCE puts non-push rows (device_token_id IS NULL) on a single stable key rather than letting
-- NULL defeat the uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_deliveries_unique_target
    ON comms.notification_deliveries
       (notification_id, channel, COALESCE(device_token_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- The dispatcher's work queue.
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_pending
    ON comms.notification_deliveries (channel, created_at)
    WHERE status IN ('pending', 'queued');

-- The escalation job's "has the email fallback already fired for this notification?" check.
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notification
    ON comms.notification_deliveries (notification_id, channel);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user
    ON comms.notification_deliveries (user_id, created_at DESC);

-- Provider-callback correlation.
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_provider_ref
    ON comms.notification_deliveries (provider, provider_ref)
    WHERE provider_ref IS NOT NULL;

COMMENT ON TABLE comms.notification_deliveries IS
    'One row per (notification, channel, device) send attempt — the audit of what the router decided and what the gateway did. Also the double-send guard for the unread-escalation job.';
-- #endregion

-- #region 2. comms.notification_queue — deferred & scheduled sends
-- A queue row is a PROMISE of a notification, not a notification. It carries everything
-- `comms.fn_notify` needs so the cron worker can materialise it without re-deriving context.
CREATE TABLE IF NOT EXISTS comms.notification_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL,
    -- Canonical catalog key. Not a FK — same reasoning as everywhere else in this engine.
    type text NOT NULL,
    scheduled_for timestamptz NOT NULL,
    status comms.queue_status NOT NULL DEFAULT 'scheduled',
    -- Idempotency + cancellation handle. The scheduler writes a deterministic key
    -- (e.g. `session:{session_id}:reminder_15m`), so re-running the scheduler is a no-op and
    -- cancelling the session cancels the reminder by key without knowing the row id.
    dedupe_key text,
    title text NOT NULL,
    body text NOT NULL,
    entity_table text,
    entity_id uuid,
    context_type text,
    context_id uuid,
    actor_user_id uuid,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    group_key text,
    -- Set once materialised, so a queue row links to the notification it became.
    notification_id uuid,
    attempts smallint NOT NULL DEFAULT 0,
    last_error text,
    -- Why this row exists: 'scheduled' (a planned reminder) | 'quiet_hours' (deferred by the
    -- router) | 'digest' (rolled up) | 'retry'.
    reason text NOT NULL DEFAULT 'scheduled',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_queue_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    CONSTRAINT notification_queue_notification_id_fkey
        FOREIGN KEY (notification_id) REFERENCES comms.notifications (id) ON DELETE SET NULL,
    CONSTRAINT notification_queue_attempts_check CHECK (attempts >= 0)
);

-- One live promise per dedupe key. Re-scheduling the same reminder updates instead of duplicating;
-- a cancelled/sent row frees the key for a genuine re-schedule.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_queue_dedupe_live
    ON comms.notification_queue (dedupe_key)
    WHERE dedupe_key IS NOT NULL AND status IN ('scheduled', 'processing');

-- The cron worker's claim query.
CREATE INDEX IF NOT EXISTS idx_notification_queue_due
    ON comms.notification_queue (scheduled_for)
    WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_notification_queue_user
    ON comms.notification_queue (user_id, scheduled_for);

-- Cancel-by-entity: "the session was cancelled, drop every reminder pointing at it".
CREATE INDEX IF NOT EXISTS idx_notification_queue_entity
    ON comms.notification_queue (entity_table, entity_id)
    WHERE status = 'scheduled';

COMMENT ON TABLE comms.notification_queue IS
    'Durable, cancellable, deduplicated promises of future notifications: session reminders, abandoned-basket nudges, ghosting/auto-approve timers, and quiet-hours deferrals. Materialised into comms.notifications by comms.fn_process_queue.';
-- #endregion

-- #region 3. comms.notification_digests — the rolled-up delivery
CREATE TABLE IF NOT EXISTS comms.notification_digests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL,
    period comms.digest_frequency NOT NULL,
    window_start timestamptz NOT NULL,
    window_end timestamptz NOT NULL,
    -- 'pending' → built, awaiting send. 'sent' → handed to the email gateway. 'skipped' → the
    -- window was empty, recorded so the job is provably idempotent rather than silently absent.
    status text NOT NULL DEFAULT 'pending',
    -- The notifications rolled up. An array rather than a join table: a digest is built once from a
    -- single windowed query and is never incrementally amended.
    notification_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
    item_count integer NOT NULL DEFAULT 0,
    -- Per-category counts + headline items for the email template.
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_digests_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    CONSTRAINT notification_digests_status_check CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
    CONSTRAINT notification_digests_window_check CHECK (window_end > window_start),
    CONSTRAINT notification_digests_item_count_check CHECK (item_count >= 0)
);

-- One digest per user per period per window — the job may run twice, the user gets one email.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_digests_window
    ON comms.notification_digests (user_id, period, window_start);

CREATE INDEX IF NOT EXISTS idx_notification_digests_pending
    ON comms.notification_digests (created_at)
    WHERE status = 'pending';

COMMENT ON TABLE comms.notification_digests IS
    'Rolled-up periodic delivery for users on a daily/weekly cadence. Unique per (user, period, window_start) so the cron job is idempotent.';
-- #endregion

-- #region 4. comms.delivery_events — inbound provider callbacks (the idempotency ledger)
-- Every gateway (Web Push, FCM, APNs, the email provider, the SMS provider) reports back
-- asynchronously. The webhook standard in SYSTEM_ARCHITECTURE §Edge Functions & Webhooks is
-- "handle duplicate events without corrupting data" — the unique index below IS that guarantee.
CREATE TABLE IF NOT EXISTS comms.delivery_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    provider text NOT NULL,
    -- The provider's own event identifier. Unique per provider — a replayed webhook is a no-op.
    provider_event_id text NOT NULL,
    -- Correlated delivery row, if the provider_ref matched one. NULL for an orphan callback (kept
    -- anyway: an unmatched bounce still tells us to suppress a destination).
    delivery_id uuid,
    -- 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'unsubscribed' |
    -- 'unregistered' | 'failed'. Free text so a provider-specific event needs no migration.
    event_type text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    -- The raw provider body, for debugging and for replaying a mis-parsed event.
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT delivery_events_delivery_id_fkey
        FOREIGN KEY (delivery_id) REFERENCES comms.notification_deliveries (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_events_provider_unique
    ON comms.delivery_events (provider, provider_event_id);

CREATE INDEX IF NOT EXISTS idx_delivery_events_delivery
    ON comms.delivery_events (delivery_id, occurred_at DESC)
    WHERE delivery_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_events_unprocessed
    ON comms.delivery_events (created_at)
    WHERE processed_at IS NULL;

COMMENT ON TABLE comms.delivery_events IS
    'Inbound gateway callbacks. UNIQUE (provider, provider_event_id) is the platform''s webhook idempotency guarantee (SYSTEM_ARCHITECTURE §Webhook Standards) — a replayed event can never double-apply.';
-- #endregion

-- #region 5. comms.channel_suppressions — destinations we must never contact again
-- A hard bounce, a spam complaint, or an unsubscribe click. The router checks this table BEFORE
-- creating an email/SMS delivery row, so a suppressed destination costs zero gateway requests.
-- Nothing is hard-deleted: lifting a suppression sets `lifted_at`.
CREATE TABLE IF NOT EXISTS comms.channel_suppressions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    channel comms.notification_channel NOT NULL,
    -- The address that must not be contacted. Held here (rather than only in org.user_emails)
    -- because a suppression must survive the user changing or removing the address, and must apply
    -- even if no account currently owns it.
    destination text NOT NULL,
    -- The account that owned the destination at suppression time, when known.
    user_id uuid,
    -- 'hard_bounce' | 'complaint' | 'unsubscribe' | 'manual' | 'invalid'.
    reason text NOT NULL,
    -- Marketing-only suppression (an unsubscribe from the newsletter) must NOT block a mandatory
    -- security or money-movement email. TRUE = only `marketing` category sends are blocked.
    marketing_only boolean NOT NULL DEFAULT false,
    source_event_id uuid,
    lifted_at timestamptz,
    lifted_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT channel_suppressions_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE SET NULL,
    CONSTRAINT channel_suppressions_source_event_id_fkey
        FOREIGN KEY (source_event_id) REFERENCES comms.delivery_events (id) ON DELETE SET NULL,
    CONSTRAINT channel_suppressions_channel_check CHECK (channel IN ('email', 'sms', 'push'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_suppressions_active
    ON comms.channel_suppressions (channel, lower(destination))
    WHERE lifted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_channel_suppressions_user
    ON comms.channel_suppressions (user_id)
    WHERE lifted_at IS NULL;

COMMENT ON TABLE comms.channel_suppressions IS
    'Destinations that must never be contacted again (hard bounce / complaint / unsubscribe). marketing_only=TRUE suppresses only the marketing category, so an unsubscribe can never silence a security or money-movement email.';
-- #endregion

-- #region 6. updated_at triggers
DROP TRIGGER IF EXISTS trg_notification_deliveries_touch ON comms.notification_deliveries;
CREATE TRIGGER trg_notification_deliveries_touch
    BEFORE UPDATE ON comms.notification_deliveries
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_notification_queue_touch ON comms.notification_queue;
CREATE TRIGGER trg_notification_queue_touch
    BEFORE UPDATE ON comms.notification_queue
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_notification_digests_touch ON comms.notification_digests;
CREATE TRIGGER trg_notification_digests_touch
    BEFORE UPDATE ON comms.notification_digests
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();
-- #endregion
