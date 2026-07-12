CREATE TABLE comms.notification_prefs (
    user_id uuid NOT NULL,
    email boolean NOT NULL DEFAULT true,
    push boolean NOT NULL DEFAULT false,
    in_app boolean NOT NULL DEFAULT true,
    digest boolean NOT NULL DEFAULT false,
    quiet_hours tstzrange,
    CONSTRAINT notification_prefs_pkey PRIMARY KEY (user_id),
    CONSTRAINT notification_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.users_public (user_id)
);

CREATE TABLE comms.device_tokens (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL,
    provider text NOT NULL,
    token text NOT NULL,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
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
        CONSTRAINT notifications_pkey PRIMARY KEY (id),
        CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.users_public (user_id)
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