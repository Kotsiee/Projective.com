BEGIN;

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

COMMIT;