DROP POLICY IF EXISTS "Project owner can view activity" ON projects.project_activity;

CREATE POLICY "Project owner can view activity" ON projects.project_activity FOR
SELECT TO public USING (
        EXISTS (
            SELECT 1
            FROM projects.projects p
            WHERE
                p.id = project_activity.project_id
                AND p.owner_user_id = auth.uid ()
        )
    );

DROP POLICY IF EXISTS "Users can insert their own activity" ON projects.project_activity;

CREATE POLICY "Users can insert their own activity" ON projects.project_activity FOR
INSERT
    TO public
WITH
    CHECK (auth.uid () = actor_user_id);

DROP POLICY IF EXISTS "Owner manage assignments" ON projects.stage_assignments;

CREATE POLICY "Owner manage assignments" ON projects.stage_assignments FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
            JOIN projects.projects p ON p.id = s.project_id
        WHERE
            s.id = stage_assignments.project_stage_id
            AND p.owner_user_id = auth.uid ()
    )
);

DROP POLICY IF EXISTS "View assignments" ON projects.stage_assignments;

CREATE POLICY "View assignments" ON projects.stage_assignments FOR
SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
        JOIN projects.projects p ON p.id = s.project_id
        WHERE s.id = stage_assignments.project_stage_id
        AND (
            p.owner_user_id = auth.uid() 
            OR (p.status = 'active'::project_status AND p.visibility = 'public'::visibility)
        )
    )
);

DROP POLICY IF EXISTS "Owner manage budget rules" ON projects.stage_budget_rules;

CREATE POLICY "Owner manage budget rules" ON projects.stage_budget_rules FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
            JOIN projects.projects p ON p.id = s.project_id
        WHERE
            s.id = stage_budget_rules.project_stage_id
            AND p.owner_user_id = auth.uid ()
    )
);

DROP POLICY IF EXISTS "View budget rules" ON projects.stage_budget_rules;

CREATE POLICY "View budget rules" ON projects.stage_budget_rules FOR
SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
        JOIN projects.projects p ON p.id = s.project_id
        WHERE s.id = stage_budget_rules.project_stage_id
        AND (
            p.owner_user_id = auth.uid() 
            OR (p.status = 'active'::project_status AND p.visibility = 'public'::visibility)
        )
    )
);

DROP POLICY IF EXISTS "Users can view/manage own contracts" ON projects.maintenance_contracts;

CREATE POLICY "Users can view/manage own contracts" ON projects.maintenance_contracts FOR ALL TO public USING (
    freelancer_profile_id = auth.uid ()
    OR EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE
            p.id = maintenance_contracts.project_id
            AND p.owner_user_id = auth.uid ()
    )
);

DROP POLICY IF EXISTS "Manage seats own" ON projects.stage_open_seats;

CREATE POLICY "Manage seats own" ON projects.stage_open_seats FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
            JOIN projects.projects p ON p.id = s.project_id
        WHERE
            s.id = stage_open_seats.project_stage_id
            AND p.owner_user_id = auth.uid ()
    )
);

DROP POLICY IF EXISTS "View seats public or own" ON projects.stage_open_seats;

CREATE POLICY "View seats public or own" ON projects.stage_open_seats FOR
SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
        JOIN projects.projects p ON p.id = s.project_id
        WHERE s.id = stage_open_seats.project_stage_id
        AND (
            p.owner_user_id = auth.uid() 
            OR (p.status = 'active'::project_status AND p.visibility = 'public'::visibility)
        )
    )
);

DROP POLICY IF EXISTS "Owner manage participants" ON projects.project_participants;

CREATE POLICY "Owner manage participants" ON projects.project_participants FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE
            p.id = project_participants.project_id
            AND p.owner_user_id = auth.uid ()
    )
);

DROP POLICY IF EXISTS "View participants" ON projects.project_participants;

CREATE POLICY "View participants" ON projects.project_participants FOR
SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE p.id = project_participants.project_id
        AND (
            p.owner_user_id = auth.uid() 
            OR (p.status = 'active'::project_status AND p.visibility = 'public'::visibility)
        )
    )
);

DROP POLICY IF EXISTS "Public can view active published projects" ON projects.projects;

CREATE POLICY "Public can view active published projects" ON projects.projects FOR
SELECT TO public USING (status = 'active'::project_status AND visibility = 'public'::visibility);

DROP POLICY IF EXISTS "Users can create projects" ON projects.projects;

CREATE POLICY "Users can create projects" ON projects.projects FOR
INSERT
    TO public
WITH
    CHECK (auth.uid () = owner_user_id);

DROP POLICY IF EXISTS "Users can delete own projects" ON projects.projects;

CREATE POLICY "Users can delete own projects" ON projects.projects FOR DELETE TO public USING (auth.uid () = owner_user_id);

DROP POLICY IF EXISTS "Users can update own projects" ON projects.projects;

CREATE POLICY "Users can update own projects" ON projects.projects FOR
UPDATE TO public USING (auth.uid () = owner_user_id);

DROP POLICY IF EXISTS "Users can view own projects" ON projects.projects;

CREATE POLICY "Users can view own projects" ON projects.projects FOR
SELECT TO public USING (auth.uid () = owner_user_id);

DROP POLICY IF EXISTS "Manage own revisions" ON projects.stage_revision_requests;

CREATE POLICY "Manage own revisions" ON projects.stage_revision_requests FOR ALL TO public USING (requested_by = auth.uid ());

DROP POLICY IF EXISTS "View revisions" ON projects.stage_revision_requests;

CREATE POLICY "View revisions" ON projects.stage_revision_requests FOR
SELECT TO public USING (
        requested_by = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM projects.project_stages s
                JOIN projects.projects p ON p.id = s.project_id
            WHERE
                s.id = stage_revision_requests.project_stage_id
                AND p.owner_user_id = auth.uid ()
        )
    );

DROP POLICY IF EXISTS "Manage roles own" ON projects.stage_staffing_roles;

CREATE POLICY "Manage roles own" ON projects.stage_staffing_roles FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
            JOIN projects.projects p ON p.id = s.project_id
        WHERE
            s.id = stage_staffing_roles.project_stage_id
            AND p.owner_user_id = auth.uid ()
    )
);

DROP POLICY IF EXISTS "View roles public or own" ON projects.stage_staffing_roles;

CREATE POLICY "View roles public or own" ON projects.stage_staffing_roles FOR
SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
        JOIN projects.projects p ON p.id = s.project_id
        WHERE s.id = stage_staffing_roles.project_stage_id
        AND (
            p.owner_user_id = auth.uid() 
            OR (p.status = 'active'::project_status AND p.visibility = 'public'::visibility)
        )
    )
);

DROP POLICY IF EXISTS "Users can manage stages of own projects" ON projects.project_stages;

CREATE POLICY "Users can manage stages of own projects" ON projects.project_stages FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE
            p.id = project_stages.project_id
            AND p.owner_user_id = auth.uid ()
    )
);

DROP POLICY IF EXISTS "Users can view stages of visible projects" ON projects.project_stages;

CREATE POLICY "Users can view stages of visible projects" ON projects.project_stages FOR
SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE p.id = project_stages.project_id
        AND (
            p.owner_user_id = auth.uid()
            OR (p.status = 'active'::project_status AND p.visibility = 'public'::visibility)
        )
    )
);

DROP POLICY IF EXISTS "Participants can view stages" ON projects.project_stages;

-- Assigned freelancers / business members / team members can read stages of projects they work on.
CREATE POLICY "Participants can view stages" ON projects.project_stages FOR
SELECT TO public USING (projects.has_project_access (project_stages.project_id));

DROP POLICY IF EXISTS "Insert own submissions" ON projects.stage_submissions;

CREATE POLICY "Insert own submissions" ON projects.stage_submissions FOR
INSERT
    TO public
WITH
    CHECK (submitted_by = auth.uid ());

DROP POLICY IF EXISTS "View submissions" ON projects.stage_submissions;

CREATE POLICY "View submissions" ON projects.stage_submissions FOR
SELECT TO public USING (
        submitted_by = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM projects.project_stages s
                JOIN projects.projects p ON p.id = s.project_id
            WHERE
                s.id = stage_submissions.project_stage_id
                AND p.owner_user_id = auth.uid ()
        )
    );

DROP POLICY IF EXISTS "View tickets" ON projects.tickets;

-- Assignee and project owner always see the ticket; other participants / the public see it unless it
-- is suspended inside an active workload-report ("reported_hidden") window.
CREATE POLICY "View tickets" ON projects.tickets FOR
SELECT TO public USING (
        current_assignee_id = auth.uid ()
        OR EXISTS (
            SELECT 1 FROM projects.projects p
            WHERE p.id = project_id AND p.owner_user_id = auth.uid ()
        )
        OR (
            (
                projects.has_project_access (project_id)
                OR EXISTS (
                    SELECT 1 FROM projects.projects p
                    WHERE p.id = project_id
                        AND p.status = 'active'::project_status
                        AND p.visibility = 'public'::visibility
                )
            )
            AND NOT (
                status = 'reported_hidden'::ticket_status
                AND hidden_until IS NOT NULL
                AND hidden_until > now()
            )
        )
    );

DROP POLICY IF EXISTS "Manage tickets" ON projects.tickets;

-- The assignee manages their claimed ticket; the project owner manages otherwise. Column-level
-- immutability once claimed is enforced by projects.fn_ticket_immutability_guard (0007).
CREATE POLICY "Manage tickets" ON projects.tickets FOR ALL TO public USING (
    current_assignee_id = auth.uid ()
    OR EXISTS (
        SELECT 1 FROM projects.projects p
        WHERE p.id = project_id AND p.owner_user_id = auth.uid ()
    )
)
WITH CHECK (
    current_assignee_id = auth.uid ()
    OR EXISTS (
        SELECT 1 FROM projects.projects p
        WHERE p.id = project_id AND p.owner_user_id = auth.uid ()
    )
);

DROP POLICY IF EXISTS "File workload report" ON projects.ticket_workload_reports;

-- Only the ticket's current assignee (the working freelancer) may flag a workload mismatch.
CREATE POLICY "File workload report" ON projects.ticket_workload_reports FOR
INSERT
    TO public
WITH
    CHECK (
        reporter_user_id = auth.uid ()
        AND EXISTS (
            SELECT 1 FROM projects.tickets t
            WHERE t.id = ticket_id AND t.current_assignee_id = auth.uid ()
        )
    );

DROP POLICY IF EXISTS "View workload reports" ON projects.ticket_workload_reports;

CREATE POLICY "View workload reports" ON projects.ticket_workload_reports FOR
SELECT TO public USING (
        reporter_user_id = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM projects.tickets t
                JOIN projects.projects p ON p.id = t.project_id
            WHERE t.id = ticket_id
                AND (p.owner_user_id = auth.uid () OR projects.has_project_access (p.id))
        )
    );

DROP POLICY IF EXISTS "View cohorts" ON projects.cohorts;

CREATE POLICY "View cohorts" ON projects.cohorts FOR
SELECT TO public USING (
        EXISTS (
            SELECT 1
            FROM projects.cohort_memberships cm
            WHERE
                cm.cohort_id = id
                AND cm.user_id = auth.uid ()
        )
        OR EXISTS (
            SELECT 1
            FROM projects.projects p
            WHERE
                p.id = project_id
                AND (
                    p.owner_user_id = auth.uid ()
                    OR p.visibility = 'public'
                )
        )
    );

DROP POLICY IF EXISTS "Manage cohorts" ON projects.cohorts;

CREATE POLICY "Manage cohorts" ON projects.cohorts FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE
            p.id = project_id
            AND p.owner_user_id = auth.uid ()
    )
);

DROP POLICY IF EXISTS "View cohort memberships" ON projects.cohort_memberships;

CREATE POLICY "View cohort memberships" ON projects.cohort_memberships FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM projects.cohorts c
                JOIN projects.projects p ON p.id = c.project_id
            WHERE
                c.id = cohort_id
                AND p.owner_user_id = auth.uid ()
        )
    );

DROP POLICY IF EXISTS "Manage cohort memberships" ON projects.cohort_memberships;

CREATE POLICY "Manage cohort memberships" ON projects.cohort_memberships FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.cohorts c
            JOIN projects.projects p ON p.id = c.project_id
        WHERE
            c.id = cohort_id
            AND p.owner_user_id = auth.uid ()
    )
);

DROP POLICY IF EXISTS "View session events" ON projects.session_events;

CREATE POLICY "View session events" ON projects.session_events FOR
SELECT TO public USING (
        EXISTS (
            SELECT 1
            FROM projects.cohort_memberships cm
            WHERE
                cm.cohort_id = cohort_id
                AND cm.user_id = auth.uid ()
        )
        OR EXISTS (
            SELECT 1
            FROM projects.cohorts c
                JOIN projects.projects p ON p.id = c.project_id
            WHERE
                c.id = cohort_id
                AND p.owner_user_id = auth.uid ()
        )
    );

DROP POLICY IF EXISTS "Manage session events" ON projects.session_events;

CREATE POLICY "Manage session events" ON projects.session_events FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.cohorts c
            JOIN projects.projects p ON p.id = c.project_id
        WHERE
            c.id = cohort_id
            AND p.owner_user_id = auth.uid ()
    )
);

DROP POLICY IF EXISTS "View own attendance" ON projects.session_attendance;

CREATE POLICY "View own attendance" ON projects.session_attendance FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM projects.session_events se
                JOIN projects.cohorts c ON c.id = se.cohort_id
                JOIN projects.projects p ON p.id = c.project_id
            WHERE
                se.id = session_event_id
                AND p.owner_user_id = auth.uid ()
        )
    );

DROP POLICY IF EXISTS "Log own attendance" ON projects.session_attendance;

CREATE POLICY "Log own attendance" ON projects.session_attendance FOR
INSERT
    TO public
WITH
    CHECK (user_id = auth.uid ());

DROP POLICY IF EXISTS "View waitlists" ON projects.waitlists;

CREATE POLICY "View waitlists" ON projects.waitlists FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM marketplace.service_blueprints sb
            WHERE
                sb.id = service_blueprint_id
                AND sb.freelancer_profile_id = auth.uid ()
        )
    );

DROP POLICY IF EXISTS "Join waitlist" ON projects.waitlists;

CREATE POLICY "Join waitlist" ON projects.waitlists FOR
INSERT
    TO public
WITH
    CHECK (user_id = auth.uid ());

DROP POLICY IF EXISTS "Manage waitlists" ON projects.waitlists;

CREATE POLICY "Manage waitlists" ON projects.waitlists FOR
UPDATE TO public USING (
    user_id = auth.uid ()
    OR EXISTS (
        SELECT 1
        FROM marketplace.service_blueprints sb
        WHERE
            sb.id = service_blueprint_id
            AND sb.freelancer_profile_id = auth.uid ()
    )
);

DROP POLICY IF EXISTS "Leave waitlist" ON projects.waitlists;

CREATE POLICY "Leave waitlist" ON projects.waitlists FOR DELETE TO public USING (user_id = auth.uid ());

DROP POLICY IF EXISTS "Users manage own bookmarks" ON org.user_bookmarks;

CREATE POLICY "Users manage own bookmarks" ON org.user_bookmarks FOR ALL TO public USING (user_id = auth.uid ());