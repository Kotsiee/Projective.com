-- Indexes: security (from 0004)

CREATE INDEX idx_penalties_subject ON security.penalties (subject_type, subject_id, status);
CREATE INDEX idx_penalties_source ON security.penalties (source_type, source_id);
