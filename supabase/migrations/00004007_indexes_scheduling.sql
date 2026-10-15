-- Indexes: scheduling (from 20260724100000, 20260724102000, 20260724103000)

CREATE INDEX IF NOT EXISTS idx_schedules_owner ON scheduling.schedules (owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_availability_rules_schedule ON scheduling.availability_rules (schedule_id, kind, weekday);
CREATE INDEX IF NOT EXISTS idx_blackout_dates_schedule ON scheduling.blackout_dates (schedule_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_events_schedule_window ON scheduling.events (schedule_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_events_project_window ON scheduling.events (project_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_events_kind ON scheduling.events (kind, starts_at);

CREATE INDEX IF NOT EXISTS idx_discovery_calls_host ON scheduling.discovery_calls (host_user_id, status, confirmed_start);
CREATE INDEX IF NOT EXISTS idx_discovery_calls_requester ON scheduling.discovery_calls (
    requester_user_id,
    status,
    confirmed_start
);
CREATE INDEX IF NOT EXISTS idx_discovery_calls_schedule_window ON scheduling.discovery_calls (
    host_schedule_id,
    confirmed_start,
    confirmed_end
);
CREATE INDEX IF NOT EXISTS idx_discovery_calls_blueprint ON scheduling.discovery_calls (service_blueprint_id)
    WHERE service_blueprint_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_attendance_call ON scheduling.call_attendance (call_id, joined_at);
CREATE INDEX IF NOT EXISTS idx_call_audit_call ON scheduling.call_audit (call_id, created_at);

-- Availability presets (Decision #217). One live library name per schedule — a service fork may carry
-- its origin's name — and exactly one live default (save_availability_preset moves it, never clears
-- it). availability_occurrences needs no index here: its primary key (preset_id, kind, starts_at) is
-- the gate's lookup.
CREATE UNIQUE INDEX IF NOT EXISTS uq_availability_presets_library_name ON scheduling.availability_presets (
    schedule_id,
    lower(name)
) WHERE archived_at IS NULL AND scope = 'library';
CREATE UNIQUE INDEX IF NOT EXISTS uq_availability_presets_one_default ON scheduling.availability_presets (schedule_id)
WHERE is_default AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_availability_presets_blueprint ON scheduling.availability_presets (blueprint_id)
WHERE blueprint_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recurrence_rules_preset ON scheduling.recurrence_rules (preset_id, position);
-- archive_availability_preset unbinds by this column.
CREATE INDEX IF NOT EXISTS idx_service_blueprints_availability_preset ON marketplace.service_blueprints (
    availability_preset_id
) WHERE availability_preset_id IS NOT NULL;

-- #region The client pipeline (Decision #217)
-- Only an open round can be waiting on a seller; closed rounds are the long tail.
CREATE INDEX IF NOT EXISTS idx_event_reschedules_open
    ON scheduling.event_reschedules (event_id)
    WHERE status IN ('collecting', 'awaiting_counterparty', 'voting');
-- A sitting's calendar mirror, looked up from the sitting (the pipeline's next event and handshakes).
CREATE INDEX IF NOT EXISTS idx_events_source_session_event
    ON scheduling.events (source_session_event_id)
    WHERE source_session_event_id IS NOT NULL;
-- #endregion
