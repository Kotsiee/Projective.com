-- Indexes: standing / reputation (org schema) (from 20260724111000)

CREATE INDEX IF NOT EXISTS idx_entity_standing_level ON org.entity_standing (level DESC, score DESC);
CREATE INDEX IF NOT EXISTS idx_standing_events_subject ON org.standing_events (subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_create_mastery_category ON org.create_mastery (category, mastery_level DESC, share_bp DESC);
CREATE INDEX IF NOT EXISTS idx_entity_achievements_subject ON org.entity_achievements (subject_type, subject_id, awarded_at DESC);
