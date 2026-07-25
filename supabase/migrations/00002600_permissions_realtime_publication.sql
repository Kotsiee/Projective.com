-- =============================================================================
-- REALTIME — supabase_realtime publication membership
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0206_realtime.sql ---

ALTER PUBLICATION supabase_realtime ADD TABLE comms.project_messages;

ALTER PUBLICATION supabase_realtime ADD TABLE comms.dm_messages;

ALTER PUBLICATION supabase_realtime ADD TABLE comms.notifications;

ALTER PUBLICATION supabase_realtime ADD TABLE comms.project_channels;

ALTER PUBLICATION supabase_realtime ADD TABLE comms.dm_threads;

ALTER PUBLICATION supabase_realtime
ADD
TABLE projects.project_activity;

ALTER PUBLICATION supabase_realtime
ADD
TABLE projects.project_stages;

ALTER PUBLICATION supabase_realtime
ADD
TABLE projects.stage_submissions;

ALTER PUBLICATION supabase_realtime
ADD
TABLE projects.stage_assignments;
