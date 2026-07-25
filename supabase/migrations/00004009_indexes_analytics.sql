-- Indexes: analytics (from 20260724110000)

CREATE INDEX IF NOT EXISTS idx_events_occurred_brin ON analytics.events USING brin (occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_subject ON analytics.events (subject_kind, subject_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_name ON analytics.events (name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_actor ON analytics.events (actor_user_id, occurred_at DESC)
    WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_rollups_metric ON analytics.daily_rollups (metric, day DESC);
CREATE INDEX IF NOT EXISTS idx_daily_rollups_subject ON analytics.daily_rollups (subject_kind, subject_id, day DESC);
