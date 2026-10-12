-- Indexes: security (from 0004)

CREATE INDEX idx_penalties_subject ON security.penalties (subject_type, subject_id, status);
CREATE INDEX idx_penalties_source ON security.penalties (source_type, source_id);

-- Indexes: ops

CREATE INDEX idx_log_entries_created ON ops.log_entries (created_at DESC);
CREATE INDEX idx_log_entries_level_created ON ops.log_entries (level, created_at DESC);
