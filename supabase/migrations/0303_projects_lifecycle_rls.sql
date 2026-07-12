-- =============================================================================================
-- 0303_projects_lifecycle_rls.sql
-- RLS refinements for the Project Lifecycle / Kanban / Submissions work (0119–0121).
--
-- Must run AFTER 0204_projects.sql (which defines the base project policies) — otherwise 0204 would
-- re-create the narrower "View submissions" policy on top of these. The mutation paths all go
-- through SECURITY DEFINER RPCs (which bypass RLS); these policies govern *direct reads* so every
-- project participant (working freelancers + the paying client) can see the deliverable ledger, not
-- just the submitter and the owner.
-- =============================================================================================

-- Broaden submission visibility to the whole project roster + paying client business.
DROP POLICY IF EXISTS "View submissions" ON projects.stage_submissions;
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

-- Submission files are visible to anyone who can see the parent submission.
DROP POLICY IF EXISTS "View submission files" ON projects.submission_files;
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
