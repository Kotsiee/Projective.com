-- Indexes: projects (from 0007, 0119, 0120, 0307)

CREATE INDEX IF NOT EXISTS idx_project_stages_project ON projects.project_stages (project_id);
CREATE INDEX IF NOT EXISTS idx_tickets_project ON projects.tickets (project_id);
CREATE INDEX IF NOT EXISTS idx_tickets_stage ON projects.tickets (current_stage_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON projects.tickets (current_assignee_id);
CREATE INDEX IF NOT EXISTS idx_tickets_stage_sort ON projects.tickets (current_stage_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_tickets_stage_recent ON projects.tickets (current_stage_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket ON projects.ticket_history (ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_history_timeline ON projects.ticket_history (ticket_id, created_at DESC);
CREATE INDEX idx_workload_reports_ticket ON projects.ticket_workload_reports (ticket_id);
CREATE INDEX idx_workload_reports_sweep ON projects.ticket_workload_reports (status, hidden_until);

CREATE INDEX IF NOT EXISTS idx_project_status_history_project
    ON projects.project_status_history (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stage_submissions_stage   ON projects.stage_submissions (project_stage_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stage_submissions_ticket  ON projects.stage_submissions (ticket_id, created_at DESC);

-- The board's own two access shapes. Every column of a project's Kanban is a
-- (project_id, status) narrow, and the backlog lane is additionally ordered by
-- hand, so it reads (project_id, sort_order). The existing ticket indexes are all
-- led by current_stage_id or current_assignee_id, which serve a stage's tickets
-- and a person's tickets — neither answers "this project's board", the query the
-- board issues on every open.
CREATE INDEX IF NOT EXISTS idx_tickets_project_status ON projects.tickets (project_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_project_sort ON projects.tickets (project_id, sort_order);

-- The submission → files fan-out. Every submission render joins here, and without
-- it the join is a sequential scan of every attachment link on the platform.
-- (projects.stage_submissions is already covered for this by
-- idx_stage_submissions_stage, whose leading column is project_stage_id.)
CREATE INDEX IF NOT EXISTS idx_submission_files_submission ON projects.submission_files (submission_id);

CREATE INDEX IF NOT EXISTS idx_stage_open_seat_skills_seat ON projects.stage_open_seat_skills (seat_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_assignment_active_assignee
    ON projects.stage_assignments (
        project_stage_id,
        assignee_type,
        COALESCE(freelancer_profile_id, team_id)
    )
    WHERE status NOT IN ('released', 'cancelled', 'declined', 'completed');


-- Service instantiation + the 30-day draft sweep.
--
-- The sweep scans for `(status = 'draft', source_blueprint_id NOT NULL, last_activity_at < cutoff)`
-- daily, and the app resolves "does this buyer already have a draft for this listing?" on every
-- listing-page render — which is the hot one, since it decides whether the primary CTA reads "Add to
-- projects" or "Open project".
--
-- PARTIAL on `source_blueprint_id IS NOT NULL`: a project created from scratch is never in either
-- query's scope, and the overwhelming majority of rows will be exactly that.
CREATE INDEX IF NOT EXISTS idx_projects_source_blueprint
    ON projects.projects (source_blueprint_id, owner_user_id, status)
    WHERE source_blueprint_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_stale_drafts
    ON projects.projects (last_activity_at)
    WHERE status = 'draft' AND source_blueprint_id IS NOT NULL;
