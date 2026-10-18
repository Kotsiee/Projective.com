-- =============================================================================
-- RLS POLICIES — security & ops schemas
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0205_security.sql ---

CREATE POLICY "Users can view own session context" ON security.session_context FOR
SELECT TO authenticated USING (user_id = auth.uid ());

-- NO client write policy (2026-09-28). The acting context is written only by the security.switch_*
-- definers (00001001), each of which re-checks the membership it names. The FOR ALL policy this
-- replaces let any user write `active_team_id` / `active_profile_id` to ANY entity over PostgREST, and
-- the access-token hook then stamped that forged context into their JWT for RLS to trust.

-- A subject sees its own penalties; admins see all. Writes are service/definer-only (no policy).
CREATE POLICY "View own penalties" ON security.penalties FOR
SELECT TO authenticated USING (
        security.is_admin ()
        OR (subject_type IN ('freelancer', 'user') AND subject_id = auth.uid ())
        OR (subject_type = 'business' AND org.is_active_business_member (subject_id))
        OR (subject_type = 'team' AND org.is_active_team_member (subject_id))
    );

CREATE POLICY "Read platform params" ON security.platform_params FOR
SELECT TO authenticated USING (true);


-- --- ops.log_entries (production log + web-vitals ingestion) ---

-- `/api/logs` is reachable from public surfaces, so an anonymous row is the normal case. A signed-in
-- writer may only attribute a row to themselves; nobody may attribute one to someone else.
CREATE POLICY "Insert own or anonymous log entries" ON ops.log_entries FOR
INSERT TO anon, authenticated WITH CHECK (user_id IS NULL OR user_id = auth.uid ());

-- Diagnostics carry paths, user agents and payloads: admins only. No UPDATE/DELETE policy —
-- entries are append-only and the retention sweep runs as the service role.
CREATE POLICY "Admins read log entries" ON ops.log_entries FOR
SELECT TO authenticated USING (security.is_admin ());


-- --- ops.scheduled_jobs / ops.http_job_dispatches (the job registry, Decision #203) ---

-- Admins read the registry and every dispatch outcome. No client write policy: a cadence is changed
-- by the service role or in SQL (the registry trigger reschedules pg_cron), never as a signed-in user.
CREATE POLICY "Admins read scheduled jobs" ON ops.scheduled_jobs FOR
SELECT TO authenticated USING (security.is_admin ());

CREATE POLICY "Admins read http job dispatches" ON ops.http_job_dispatches FOR
SELECT TO authenticated USING (security.is_admin ());


-- #region [contact] ops.contact_requests / ops.contact_request_attachments (Decision #276)
-- Operators read every request and its attachment links; nobody else reads any (a sender keeps the
-- reference they were shown, not a read path). No write policy at all: the one writer is the definer
-- door ops.submit_contact_request, and the one status move is ops.set_contact_request_status.
CREATE POLICY "Admins read contact requests" ON ops.contact_requests FOR
SELECT TO authenticated USING (security.is_admin ());

CREATE POLICY "Admins read contact request attachments" ON ops.contact_request_attachments FOR
SELECT TO authenticated USING (security.is_admin ());
-- #endregion
