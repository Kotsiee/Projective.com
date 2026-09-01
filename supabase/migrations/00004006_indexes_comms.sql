-- Indexes: comms notifications (from 20260724090000, 20260724091000, 20260724092000)
--          plus the messaging read/write paths.

-- Messaging had NO indexes at all beyond its primary keys, while the chat feed is
-- the platform's hottest read: it pages a channel newest-first and re-reads it on
-- every navigation. DESC matches the order the feed actually asks for, so the
-- cursor walk is an index scan rather than a sort over the channel's whole
-- history.
CREATE INDEX IF NOT EXISTS idx_project_messages_channel_recent
    ON comms.project_messages (channel_id, created_at DESC);

-- The polymorphic attachment lookup. There is no foreign key on message_id —
-- Postgres cannot point one column at two parents — so the discriminator pair is
-- the only way in, and every rendered message asks it.
CREATE INDEX IF NOT EXISTS idx_message_attachments_message
    ON comms.message_attachments (message_table, message_id);

-- The channel Files tab. Same shape, different vocabulary: this table
-- discriminates on the BARE 'project' / 'dm' pair, not the schema-qualified one
-- above.
CREATE INDEX IF NOT EXISTS idx_channel_files_channel
    ON comms.channel_files (channel_type, channel_id);

CREATE INDEX IF NOT EXISTS idx_notification_types_aliases ON comms.notification_types USING gin (aliases);
CREATE INDEX IF NOT EXISTS idx_notification_types_category ON comms.notification_types (category) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_notifications_user_feed
    ON comms.notifications (user_id, created_at DESC)
    WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON comms.notifications (user_id, category)
    WHERE read_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_category
    ON comms.notifications (user_id, category, created_at DESC)
    WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_group
    ON comms.notifications (user_id, group_key, created_at DESC)
    WHERE group_key IS NOT NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_entity
    ON comms.notifications (entity_table, entity_id)
    WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_context
    ON comms.notifications (context_type, context_id, created_at DESC)
    WHERE context_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_expiring
    ON comms.notifications (expires_at)
    WHERE expires_at IS NOT NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_escalation
    ON comms.notifications (created_at)
    WHERE read_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_type ON comms.notifications (type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_type_mutes_lookup
    ON comms.notification_type_mutes (user_id, type_key) INCLUDE (muted_until);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tokens_user_token_live
    ON comms.device_tokens (user_id, token)
    WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_live
    ON comms.device_tokens (user_id, platform)
    WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_deliveries_unique_target
    ON comms.notification_deliveries
       (notification_id, channel, COALESCE(device_token_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_pending
    ON comms.notification_deliveries (channel, created_at)
    WHERE status IN ('pending', 'queued');
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notification
    ON comms.notification_deliveries (notification_id, channel);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user
    ON comms.notification_deliveries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_provider_ref
    ON comms.notification_deliveries (provider, provider_ref)
    WHERE provider_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_queue_dedupe_live
    ON comms.notification_queue (dedupe_key)
    WHERE dedupe_key IS NOT NULL AND status IN ('scheduled', 'processing');
CREATE INDEX IF NOT EXISTS idx_notification_queue_due
    ON comms.notification_queue (scheduled_for)
    WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_notification_queue_user
    ON comms.notification_queue (user_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_notification_queue_entity
    ON comms.notification_queue (entity_table, entity_id)
    WHERE status = 'scheduled';
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_digests_window
    ON comms.notification_digests (user_id, period, window_start);
CREATE INDEX IF NOT EXISTS idx_notification_digests_pending
    ON comms.notification_digests (created_at)
    WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_events_provider_unique
    ON comms.delivery_events (provider, provider_event_id);
CREATE INDEX IF NOT EXISTS idx_delivery_events_delivery
    ON comms.delivery_events (delivery_id, occurred_at DESC)
    WHERE delivery_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_events_unprocessed
    ON comms.delivery_events (created_at)
    WHERE processed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_suppressions_active
    ON comms.channel_suppressions (channel, lower(destination))
    WHERE lifted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_channel_suppressions_user
    ON comms.channel_suppressions (user_id)
    WHERE lifted_at IS NULL;
