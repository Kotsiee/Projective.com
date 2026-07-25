-- =============================================================================
-- RLS POLICIES — projects & files schemas
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0119_project_lifecycle.sql ---

CREATE POLICY "View project status history" ON projects.project_status_history FOR
SELECT TO public USING (
    actor_user_id = auth.uid()
    OR projects.has_project_access (project_id)
    OR EXISTS (
        SELECT 1 FROM projects.projects p
        WHERE p.id = project_status_history.project_id
            AND (p.owner_user_id = auth.uid()
                OR (p.client_business_id IS NOT NULL AND org.is_active_business_member (p.client_business_id)))
    )
);


-- --- from 0204_projects.sql ---

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

CREATE POLICY "Users can insert their own activity" ON projects.project_activity FOR
INSERT
    TO public
WITH
    CHECK (auth.uid () = actor_user_id);

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

CREATE POLICY "Owner manage participants" ON projects.project_participants FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE
            p.id = project_participants.project_id
            AND p.owner_user_id = auth.uid ()
    )
);

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

CREATE POLICY "Public can view active published projects" ON projects.projects FOR
SELECT TO public USING (status = 'active'::project_status AND visibility = 'public'::visibility);

CREATE POLICY "Users can create projects" ON projects.projects FOR
INSERT
    TO public
WITH
    CHECK (auth.uid () = owner_user_id);

CREATE POLICY "Users can delete own projects" ON projects.projects FOR DELETE TO public USING (auth.uid () = owner_user_id);

CREATE POLICY "Users can update own projects" ON projects.projects FOR
UPDATE TO public USING (auth.uid () = owner_user_id);

CREATE POLICY "Users can view own projects" ON projects.projects FOR
SELECT TO public USING (auth.uid () = owner_user_id);

CREATE POLICY "Manage own revisions" ON projects.stage_revision_requests FOR ALL TO public USING (requested_by = auth.uid ());

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

CREATE POLICY "Users can manage stages of own projects" ON projects.project_stages FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE
            p.id = project_stages.project_id
            AND p.owner_user_id = auth.uid ()
    )
);

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

-- Assigned freelancers / business members / team members can read stages of projects they work on.
CREATE POLICY "Participants can view stages" ON projects.project_stages FOR
SELECT TO public USING (projects.has_project_access (project_stages.project_id));

CREATE POLICY "Insert own submissions" ON projects.stage_submissions FOR
INSERT
    TO public
WITH
    CHECK (submitted_by = auth.uid ());

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

CREATE POLICY "Manage cohorts" ON projects.cohorts FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE
            p.id = project_id
            AND p.owner_user_id = auth.uid ()
    )
);

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

CREATE POLICY "Log own attendance" ON projects.session_attendance FOR
INSERT
    TO public
WITH
    CHECK (user_id = auth.uid ());

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

CREATE POLICY "Join waitlist" ON projects.waitlists FOR
INSERT
    TO public
WITH
    CHECK (user_id = auth.uid ());

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

CREATE POLICY "Leave waitlist" ON projects.waitlists FOR DELETE TO public USING (user_id = auth.uid ());


-- --- from 0208_files.sql ---

CREATE POLICY "Authenticated users can view files" ON files.items FOR
SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert own files" ON files.items FOR
INSERT
    TO authenticated
WITH
    CHECK (owner_user_id = auth.uid ());

CREATE POLICY "Users can update own files" ON files.items FOR
UPDATE TO authenticated USING (owner_user_id = auth.uid ());

CREATE POLICY "Users can delete own files" ON files.items FOR DELETE TO authenticated USING (owner_user_id = auth.uid ());


-- --- from 0303_projects_lifecycle_rls.sql ---

CREATE POLICY "View submissions" ON projects.stage_submissions FOR
SELECT TO public USING (
    submitted_by = auth.uid ()
    OR projects.has_project_access (
        (SELECT ps.project_id FROM projects.project_stages ps WHERE ps.id = stage_submissions.project_stage_id)
    )
    OR EXISTS (
        SELECT 1
        FROM projects.project_stages s
        JOIN projects.projects p ON p.id = s.project_id
        WHERE s.id = stage_submissions.project_stage_id
            AND (
                p.owner_user_id = auth.uid ()
                OR (p.client_business_id IS NOT NULL AND org.is_active_business_member (p.client_business_id))
            )
    )
);

CREATE POLICY "View submission files" ON projects.submission_files FOR
SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.stage_submissions ss
        JOIN projects.project_stages s ON s.id = ss.project_stage_id
        JOIN projects.projects p ON p.id = s.project_id
        WHERE ss.id = submission_files.submission_id
            AND (
                ss.submitted_by = auth.uid ()
                OR projects.has_project_access (p.id)
                OR p.owner_user_id = auth.uid ()
                OR (p.client_business_id IS NOT NULL AND org.is_active_business_member (p.client_business_id))
            )
    )
);


-- --- from 0307_stage_staffing.sql ---

CREATE POLICY "View seat skills" ON projects.stage_open_seat_skills FOR SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.stage_open_seats s
        JOIN projects.project_stages ps ON ps.id = s.project_stage_id
        WHERE s.id = stage_open_seat_skills.seat_id
            AND (projects.has_project_access (ps.project_id) OR EXISTS (
                SELECT 1 FROM projects.projects p
                WHERE p.id = ps.project_id AND p.status = 'active'::project_status
            ))
    )
);

CREATE POLICY "View own or owned applications" ON projects.project_applications FOR SELECT TO public USING (
    applicant_user_id = auth.uid()
    OR projects.can_review_project (project_id)
);

CREATE POLICY "View application targets" ON projects.project_application_targets FOR SELECT TO public USING (
    EXISTS (
        SELECT 1 FROM projects.project_applications pa
        WHERE pa.id = project_application_targets.application_id
            AND (pa.applicant_user_id = auth.uid() OR projects.can_review_project (pa.project_id))
    )
);
