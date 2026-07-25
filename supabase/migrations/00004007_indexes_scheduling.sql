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
CREATE INDEX IF NOT EXISTS idx_call_attendance_call ON scheduling.call_attendance (call_id, joined_at);
CREATE INDEX IF NOT EXISTS idx_call_audit_call ON scheduling.call_audit (call_id, created_at);
