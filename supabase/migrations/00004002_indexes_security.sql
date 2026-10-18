-- Indexes: security (from 0004)

CREATE INDEX idx_penalties_subject ON security.penalties (subject_type, subject_id, status);
CREATE INDEX idx_penalties_source ON security.penalties (source_type, source_id);
-- One entity's trail by action — org.fn_workspace_restore_target reads a team's or a business's
-- `{kind}.status_changed` rows to decide where a restore lands.
CREATE INDEX idx_audit_logs_entity ON security.audit_logs (entity_id, action);

-- Indexes: ops

CREATE INDEX idx_log_entries_created ON ops.log_entries (created_at DESC);
CREATE INDEX idx_log_entries_level_created ON ops.log_entries (level, created_at DESC);
CREATE INDEX idx_http_job_dispatches_unsettled ON ops.http_job_dispatches (dispatched_at) WHERE settled_at IS NULL;
CREATE INDEX idx_http_job_dispatches_job ON ops.http_job_dispatches (job_name, dispatched_at DESC);
