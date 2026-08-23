-- =============================================================================================
-- 00000022_tables_scheduling.sql — scheduling schema tables (Category 0).
-- Sources: 20260724100000 (schedules, availability_rules, blackout_dates), 102000 (events),
--          103000 (call_settings, discovery_calls, call_attendance, call_audit).
-- Ordered after finance/integrations/comms/projects (scheduling.events → integrations.user_connections,
-- projects.session_events, comms.project_channels; scheduling.discovery_calls → finance.escrows).
-- =============================================================================================

CREATE TABLE scheduling.schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type scheduling.owner_type NOT NULL,
    owner_id uuid NOT NULL,
    timezone text NOT NULL DEFAULT 'Europe/London',
    is_published boolean NOT NULL DEFAULT false,
    mask_external_events boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_schedule_owner UNIQUE (owner_type, owner_id)
);

CREATE TABLE scheduling.availability_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    schedule_id uuid NOT NULL REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    kind scheduling.availability_kind NOT NULL DEFAULT 'working_hours',
    -- 0 = Sunday … 6 = Saturday (matches the Zod contract and JS `Date#getDay`).
    weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
    end_minute integer NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
    label text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_availability_rule_span CHECK (end_minute > start_minute)
);

CREATE TABLE scheduling.blackout_dates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    schedule_id uuid NOT NULL REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    label text NOT NULL DEFAULT 'Unavailable',
    label_is_public boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_blackout_span CHECK (ends_at > starts_at)
);

CREATE TABLE scheduling.events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    -- Owner anchor: the schedule this entry belongs to (availability, busy, bookings).
    schedule_id uuid REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    -- Project anchor: the engagement this entry belongs to (deadlines, milestones, syncs).
    project_id uuid REFERENCES projects.projects (id) ON DELETE CASCADE,
    channel_id uuid REFERENCES comms.project_channels (id) ON DELETE SET NULL,
    kind scheduling.event_kind NOT NULL DEFAULT 'general',
    status scheduling.event_status,
    title text NOT NULL DEFAULT '',
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    all_day boolean NOT NULL DEFAULT false,
    is_masked boolean NOT NULL DEFAULT false,
    -- A CSS custom-property NAME (e.g. '--primary'), never a literal colour (root CLAUDE.md §3).
    accent text,
    location text,
    meta text,
    attendee_count integer CHECK (attendee_count >= 0),
    capacity integer CHECK (capacity >= 0),
    href text,
    source_connection_id uuid REFERENCES integrations.user_connections (id) ON DELETE SET NULL,
    external_event_id text,
    source_session_event_id uuid REFERENCES projects.session_events (id) ON DELETE CASCADE,
    created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- `>=`, not `>`: a DEADLINE is a point in time and has no duration to record. The UI engine has
    -- always drawn `end === start` as a pin rather than as a box, precisely so a due date is not
    -- asserted to be a plausible half-hour meeting, and a `>` check here would refuse to persist the
    -- one shape that view exists to render. A milestone — a review that genuinely takes time — keeps
    -- its span; the two are different objects, not one object recorded two ways.
    CONSTRAINT ck_event_span CHECK (ends_at >= starts_at),
    CONSTRAINT ck_event_anchor CHECK (
        schedule_id IS NOT NULL
        OR project_id IS NOT NULL
    ),
    CONSTRAINT uq_event_external UNIQUE (source_connection_id, external_event_id)
);

CREATE TABLE scheduling.call_settings (
    schedule_id uuid PRIMARY KEY REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    accepts_calls boolean NOT NULL DEFAULT false,
    courtesy_enabled boolean NOT NULL DEFAULT false,
    courtesy_duration_minutes integer NOT NULL DEFAULT 15 CHECK (
        courtesy_duration_minutes BETWEEN 5 AND 240
    ),
    courtesy_max_per_week integer NOT NULL DEFAULT 0 CHECK (courtesy_max_per_week >= 0),
    courtesy_cooldown_days integer NOT NULL DEFAULT 0 CHECK (courtesy_cooldown_days >= 0),
    paid_enabled boolean NOT NULL DEFAULT false,
    paid_duration_minutes integer NOT NULL DEFAULT 30 CHECK (
        paid_duration_minutes BETWEEN 5 AND 480
    ),
    fee_amount_minor bigint CHECK (fee_amount_minor >= 0),
    fee_currency char(3),
    buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (
        buffer_before_minutes BETWEEN 0 AND 240
    ),
    buffer_after_minutes integer NOT NULL DEFAULT 10 CHECK (
        buffer_after_minutes BETWEEN 0 AND 240
    ),
    min_notice_minutes integer NOT NULL DEFAULT 720 CHECK (min_notice_minutes >= 0),
    max_advance_days integer NOT NULL DEFAULT 60 CHECK (max_advance_days BETWEEN 1 AND 365),
    auto_confirm boolean NOT NULL DEFAULT false,
    agenda_required boolean NOT NULL DEFAULT true,
    preferred_provider_slug text REFERENCES integrations.providers (slug) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_paid_call_priced CHECK (
        NOT paid_enabled
        OR (
            fee_amount_minor IS NOT NULL
            AND fee_amount_minor > 0
            AND fee_currency IS NOT NULL
        )
    )
);

CREATE TABLE scheduling.discovery_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    host_schedule_id uuid NOT NULL REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    host_user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    requester_user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    call_type scheduling.call_type NOT NULL DEFAULT 'courtesy',
    status scheduling.call_status NOT NULL DEFAULT 'proposed',
    proposed_start timestamptz NOT NULL,
    proposed_end timestamptz NOT NULL,
    confirmed_start timestamptz,
    confirmed_end timestamptz,
    requester_timezone text,
    agenda text,
    provider_slug text REFERENCES integrations.providers (slug) ON DELETE SET NULL,
    connection_id uuid REFERENCES integrations.user_connections (id) ON DELETE SET NULL,
    meeting_url text,
    meeting_external_id text,
    event_id uuid REFERENCES scheduling.events (id) ON DELETE SET NULL,
    fee_amount_minor bigint CHECK (fee_amount_minor >= 0),
    fee_currency char(3),
    payment_ref text,
    escrow_id uuid REFERENCES finance.escrows (id) ON DELETE SET NULL,
    refund_amount_minor bigint CHECK (refund_amount_minor >= 0),
    penalty_amount_minor bigint CHECK (penalty_amount_minor >= 0),
    proposed_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    confirmed_at timestamptz,
    cancelled_at timestamptz,
    cancelled_by scheduling.call_party,
    cancellation_reason text,
    is_late_cancel boolean NOT NULL DEFAULT false,
    completed_at timestamptz,
    no_show_party scheduling.call_party,
    reschedule_count integer NOT NULL DEFAULT 0 CHECK (reschedule_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_call_parties_distinct CHECK (host_user_id <> requester_user_id),
    CONSTRAINT ck_call_proposed_span CHECK (proposed_end > proposed_start),
    CONSTRAINT ck_call_confirmed_span CHECK (
        confirmed_end IS NULL
        OR confirmed_start IS NULL
        OR confirmed_end > confirmed_start
    ),
    CONSTRAINT ck_call_confirmed_has_slot CHECK (
        status <> 'confirmed'::scheduling.call_status
        OR (
            confirmed_start IS NOT NULL
            AND confirmed_end IS NOT NULL
        )
    ),
    CONSTRAINT ck_call_fee_matches_type CHECK (
        (
            call_type = 'paid'::scheduling.call_type
            AND fee_amount_minor IS NOT NULL
            AND fee_amount_minor > 0
            AND fee_currency IS NOT NULL
        )
        OR (
            call_type = 'courtesy'::scheduling.call_type
            AND COALESCE(fee_amount_minor, 0) = 0
        )
    )
);

CREATE TABLE scheduling.call_attendance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    call_id uuid NOT NULL REFERENCES scheduling.discovery_calls (id) ON DELETE CASCADE,
    user_id uuid REFERENCES org.users_public (user_id) ON DELETE SET NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    left_at timestamptz,
    source_provider_slug text REFERENCES integrations.providers (slug) ON DELETE SET NULL,
    external_participant_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_attendance_span CHECK (
        left_at IS NULL
        OR left_at >= joined_at
    )
);

CREATE TABLE scheduling.call_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    call_id uuid NOT NULL REFERENCES scheduling.discovery_calls (id) ON DELETE CASCADE,
    action scheduling.call_action NOT NULL,
    actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    from_status scheduling.call_status,
    to_status scheduling.call_status,
    slot_start timestamptz,
    slot_end timestamptz,
    detail text,
    created_at timestamptz NOT NULL DEFAULT now()
);
