-- =============================================================================================
-- 00000016_tables_comms.sql — comms schema tables (Category 0), final folded form.
-- Base: 0008_comms_tables.sql. Also: 20260724090000 (notification_types), 091000 (category_prefs,
--       type_mutes), 092000 (deliveries, queue, digests, delivery_events, channel_suppressions).
-- Folded ALTERs:
--   * comms.project_messages  += pii_masked, pii_categories                          (0311)
--   * comms.notifications     += event-envelope columns + 3 constraints              (20260724090000)
--   * comms.notification_prefs+= recurring quiet hours / digest / snooze cols + CHECKs (091000)
--   * comms.device_tokens     += push registration columns                           (091000)
-- =============================================================================================

CREATE TABLE comms.notification_prefs (
    user_id uuid NOT NULL,
    email boolean NOT NULL DEFAULT true,
    push boolean NOT NULL DEFAULT false,
    in_app boolean NOT NULL DEFAULT true,
    digest boolean NOT NULL DEFAULT false,
    quiet_hours tstzrange,
    -- Folded (091000): recurring quiet hours, digest cadence, global snooze.
    sms boolean NOT NULL DEFAULT false,
    digest_frequency comms.digest_frequency NOT NULL DEFAULT 'off',
    digest_hour smallint NOT NULL DEFAULT 8,
    digest_weekday smallint,
    timezone text NOT NULL DEFAULT 'UTC',
    quiet_hours_enabled boolean NOT NULL DEFAULT false,
    quiet_hours_start time,
    quiet_hours_end time,
    muted_until timestamptz,
    locale text,
    escalate_after interval NOT NULL DEFAULT '15 minutes',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_prefs_pkey PRIMARY KEY (user_id),
    CONSTRAINT notification_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.users_public (user_id),
    CONSTRAINT notification_prefs_digest_hour_check CHECK (digest_hour BETWEEN 0 AND 23),
    CONSTRAINT notification_prefs_digest_weekday_check CHECK (digest_weekday IS NULL OR digest_weekday BETWEEN 1 AND 7),
    CONSTRAINT notification_prefs_quiet_hours_complete
        CHECK (NOT quiet_hours_enabled OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL)),
    CONSTRAINT notification_prefs_weekly_needs_weekday
        CHECK (digest_frequency <> 'weekly' OR digest_weekday IS NOT NULL)
);

CREATE TABLE comms.device_tokens (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL,
    provider text NOT NULL,
    token text NOT NULL,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        -- Folded (091000): real Web Push / FCM / APNs registration columns.
        platform comms.device_platform NOT NULL DEFAULT 'web',
        endpoint text,
        p256dh text,
        auth_key text,
        label text,
        user_agent text,
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz,
        revoked_reason text,
        failure_count smallint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT device_tokens_pkey PRIMARY KEY (id),
        CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.users_public (user_id)
);

CREATE TABLE comms.notifications (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    entity_table text,
    entity_id uuid,
    read_at timestamp
    with
        time zone,
        created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        -- Folded (20260724090000): the event envelope, denormalized from the catalog at write time.
        category comms.notification_category NOT NULL DEFAULT 'system',
        urgency comms.notification_urgency NOT NULL DEFAULT 'medium',
        actor_user_id uuid,
        context_type text,
        context_id uuid,
        action_url text,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        group_key text,
        group_count integer NOT NULL DEFAULT 1,
        channels comms.notification_channel[] NOT NULL DEFAULT ARRAY['in_app']::comms.notification_channel[],
        seen_at timestamptz,
        archived_at timestamptz,
        expires_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT notifications_pkey PRIMARY KEY (id),
        CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.users_public (user_id),
        CONSTRAINT notifications_actor_user_id_fkey
            FOREIGN KEY (actor_user_id) REFERENCES org.users_public (user_id) ON DELETE SET NULL,
        CONSTRAINT notifications_context_type_check
            CHECK (context_type IS NULL OR context_type IN ('personal', 'project', 'team', 'business', 'organisation', 'conversation')),
        CONSTRAINT notifications_group_count_positive CHECK (group_count >= 1)
);

CREATE TABLE comms.dm_threads (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    created_by_user_id uuid NOT NULL,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        CONSTRAINT dm_threads_pkey PRIMARY KEY (id),
        CONSTRAINT dm_threads_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES org.users_public (user_id)
);

CREATE TABLE comms.dm_participants (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    thread_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        CONSTRAINT dm_participants_pkey PRIMARY KEY (id),
        CONSTRAINT dm_participants_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES comms.dm_threads (id),
        CONSTRAINT dm_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.users_public (user_id)
);

CREATE TABLE comms.dm_messages (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    thread_id uuid NOT NULL,
    sender_user_id uuid NOT NULL,
    project_id uuid NULL, -- Direct messages pertaining to a specific project
    service_id uuid NULL, -- Messages likely between potential customers pertaining to a service
    body text NOT NULL,
    has_attachments boolean NOT NULL DEFAULT false,
    is_audio boolean NOT NULL DEFAULT false,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        deleted_at timestamp
    with
        time zone,
        CONSTRAINT dm_messages_pkey PRIMARY KEY (id),
        CONSTRAINT dm_messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES org.users_public (user_id),
        CONSTRAINT dm_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES comms.dm_threads (id)
);

CREATE TABLE comms.project_channels (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    name text NOT NULL,
    stage_id uuid,
    visibility text NOT NULL DEFAULT 'project_all'::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT project_channels_pkey PRIMARY KEY (id),
    CONSTRAINT project_channels_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects.projects(id)
);

CREATE TABLE comms.project_messages (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    channel_id uuid NOT NULL,
    sender_user_id uuid NOT NULL,
    body text NOT NULL,
    has_attachments boolean NOT NULL DEFAULT false,
    is_audio boolean NOT NULL DEFAULT false,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        edited_at timestamp
    with
        time zone,
        deleted_at timestamp
    with
        time zone,
        -- Folded (0311): PII filter state during the protected phase.
        pii_masked boolean NOT NULL DEFAULT false,
        pii_categories text[] NOT NULL DEFAULT '{}'::text[],
        CONSTRAINT project_messages_pkey PRIMARY KEY (id),
        CONSTRAINT project_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES comms.project_channels (id),
        CONSTRAINT project_messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES org.users_public (user_id)
);

CREATE TABLE comms.project_channel_participants (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    channel_id uuid NOT NULL,
    profile_type public.profile_type NOT NULL,
    profile_id uuid NOT NULL,
    role text NOT NULL DEFAULT 'participant'::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT project_channel_participants_pkey PRIMARY KEY (id),
    CONSTRAINT project_channel_participants_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES comms.project_channels(id)
);

CREATE TABLE comms.channel_files (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    channel_type text NOT NULL CHECK (
        channel_type IN ('project', 'dm')
    ),
    channel_id uuid NOT NULL,
    attachment_id uuid NOT NULL,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        CONSTRAINT channel_files_pkey PRIMARY KEY (id),
        CONSTRAINT channel_files_attachment_id_fkey FOREIGN KEY (attachment_id) REFERENCES files.items (id)
);

CREATE TABLE comms.message_attachments (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    message_table text NOT NULL CHECK (
        message_table IN (
            'comms.project_messages',
            'comms.dm_messages'
        )
    ),
    message_id uuid NOT NULL,
    attachment_id uuid NOT NULL,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        CONSTRAINT message_attachments_pkey PRIMARY KEY (id),
        CONSTRAINT message_attachments_attachment_id_fkey FOREIGN KEY (attachment_id) REFERENCES files.items (id)
);

-- #region Notification engine — catalog (20260724090000_comms_notification_catalog.sql)
CREATE TABLE comms.notification_types (
    -- Canonical dotted `domain.event` key. This is what `comms.notifications.type` should carry.
    key text PRIMARY KEY,
    -- Historic / alternate keys that resolve to this row.
    aliases text[] NOT NULL DEFAULT '{}'::text[],
    category comms.notification_category NOT NULL,
    urgency comms.notification_urgency NOT NULL DEFAULT 'medium',
    default_channels comms.notification_channel[] NOT NULL DEFAULT ARRAY['in_app']::comms.notification_channel[],
    mandatory boolean NOT NULL DEFAULT false,
    overrides_quiet_hours boolean NOT NULL DEFAULT false,
    digestible boolean NOT NULL DEFAULT true,
    audit boolean NOT NULL DEFAULT false,
    group_window interval,
    action_url_template text,
    default_lead_time interval,
    description text NOT NULL DEFAULT '',
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_types_key_format CHECK (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
    CONSTRAINT notification_types_marketing_never_mandatory CHECK (NOT (category = 'marketing' AND mandatory)),
    CONSTRAINT notification_types_channels_not_empty CHECK (array_length(default_channels, 1) >= 1)
);
-- #endregion

-- #region Notification engine — preferences (20260724091000_comms_notification_preferences.sql)
CREATE TABLE comms.notification_category_prefs (
    user_id uuid NOT NULL,
    category comms.notification_category NOT NULL,
    -- NULL = inherit the corresponding global toggle on comms.notification_prefs.
    in_app boolean,
    push boolean,
    email boolean,
    sms boolean,
    digest_frequency comms.digest_frequency,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_category_prefs_pkey PRIMARY KEY (user_id, category),
    CONSTRAINT notification_category_prefs_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE CASCADE
);

CREATE TABLE comms.notification_type_mutes (
    user_id uuid NOT NULL,
    type_key text NOT NULL,
    muted_until timestamptz,
    channels comms.notification_channel[],
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_type_mutes_pkey PRIMARY KEY (user_id, type_key),
    CONSTRAINT notification_type_mutes_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE CASCADE
);
-- #endregion

-- #region Notification engine — delivery & scheduling (20260724092000_comms_notification_delivery.sql)
CREATE TABLE comms.notification_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    notification_id uuid NOT NULL,
    user_id uuid NOT NULL,
    channel comms.notification_channel NOT NULL,
    status comms.delivery_status NOT NULL DEFAULT 'pending',
    device_token_id uuid,
    provider text,
    provider_ref text,
    attempts smallint NOT NULL DEFAULT 0,
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

CREATE TABLE comms.notification_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL,
    type text NOT NULL,
    scheduled_for timestamptz NOT NULL,
    status comms.queue_status NOT NULL DEFAULT 'scheduled',
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
    notification_id uuid,
    attempts smallint NOT NULL DEFAULT 0,
    last_error text,
    reason text NOT NULL DEFAULT 'scheduled',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_queue_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    CONSTRAINT notification_queue_notification_id_fkey
        FOREIGN KEY (notification_id) REFERENCES comms.notifications (id) ON DELETE SET NULL,
    CONSTRAINT notification_queue_attempts_check CHECK (attempts >= 0)
);

CREATE TABLE comms.notification_digests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL,
    period comms.digest_frequency NOT NULL,
    window_start timestamptz NOT NULL,
    window_end timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    notification_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
    item_count integer NOT NULL DEFAULT 0,
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

CREATE TABLE comms.delivery_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    provider text NOT NULL,
    provider_event_id text NOT NULL,
    delivery_id uuid,
    event_type text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT delivery_events_delivery_id_fkey
        FOREIGN KEY (delivery_id) REFERENCES comms.notification_deliveries (id) ON DELETE SET NULL
);

CREATE TABLE comms.channel_suppressions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    channel comms.notification_channel NOT NULL,
    destination text NOT NULL,
    user_id uuid,
    reason text NOT NULL,
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
-- #endregion
