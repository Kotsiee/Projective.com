-- =============================================================================
-- RLS POLICIES — scheduling & integrations schemas
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 20260724100000_scheduling_schema_availability.sql ---

CREATE POLICY "View published or own schedule" ON scheduling.schedules FOR
SELECT TO anon,
authenticated USING (
        is_published
        OR scheduling.fn_owner_visible (owner_type, owner_id)
    );

CREATE POLICY "Manage own schedule" ON scheduling.schedules FOR ALL TO authenticated USING (
    scheduling.fn_owner_manages (owner_type, owner_id)
)
WITH
    CHECK (
        scheduling.fn_owner_manages (owner_type, owner_id)
    );

CREATE POLICY "View availability rules" ON scheduling.availability_rules FOR
SELECT TO anon,
authenticated USING (
        scheduling.fn_schedule_is_public (schedule_id)
        OR scheduling.fn_can_view_schedule (schedule_id)
    );

CREATE POLICY "Manage availability rules" ON scheduling.availability_rules FOR ALL TO authenticated USING (
    scheduling.fn_can_manage_schedule (schedule_id)
)
WITH
    CHECK (
        scheduling.fn_can_manage_schedule (schedule_id)
    );

CREATE POLICY "View blackout dates" ON scheduling.blackout_dates FOR
SELECT TO anon,
authenticated USING (
        scheduling.fn_schedule_is_public (schedule_id)
        OR scheduling.fn_can_view_schedule (schedule_id)
    );

CREATE POLICY "Manage blackout dates" ON scheduling.blackout_dates FOR ALL TO authenticated USING (
    scheduling.fn_can_manage_schedule (schedule_id)
)
WITH
    CHECK (
        scheduling.fn_can_manage_schedule (schedule_id)
    );


-- --- from 20260724101000_integrations_connections.sql ---

CREATE POLICY "View integration providers" ON integrations.providers FOR
SELECT TO anon,
authenticated USING (true);

CREATE POLICY "View own connection audit" ON integrations.connection_audit FOR
SELECT TO authenticated USING (
        user_id = auth.uid ()
        OR security.is_admin ()
    );


-- --- from 20260724102000_scheduling_events.sql ---

CREATE POLICY "View scheduling events" ON scheduling.events FOR
SELECT TO anon,
authenticated USING (
        (
            schedule_id IS NOT NULL
            AND scheduling.fn_can_view_schedule (schedule_id)
        )
        OR (
            schedule_id IS NOT NULL
            AND scheduling.fn_schedule_is_public (schedule_id)
            AND kind IN (
                'availability'::scheduling.event_kind,
                'busy'::scheduling.event_kind,
                'holiday'::scheduling.event_kind
            )
        )
        OR (
            project_id IS NOT NULL
            AND projects.has_project_access (project_id)
        )
    );

CREATE POLICY "Manage scheduling events" ON scheduling.events FOR ALL TO authenticated USING (
    (
        schedule_id IS NOT NULL
        AND scheduling.fn_can_manage_schedule (schedule_id)
    )
    OR (
        project_id IS NOT NULL
        AND projects.has_project_access (project_id)
    )
)
WITH
    CHECK (
        (
            schedule_id IS NOT NULL
            AND scheduling.fn_can_manage_schedule (schedule_id)
        )
        OR (
            project_id IS NOT NULL
            AND projects.has_project_access (project_id)
        )
    );


-- --- from 20260724103000_scheduling_discovery_calls.sql ---

CREATE POLICY "View call settings" ON scheduling.call_settings FOR
SELECT TO anon,
authenticated USING (
        scheduling.fn_schedule_is_public (schedule_id)
        OR scheduling.fn_can_view_schedule (schedule_id)
    );

CREATE POLICY "Manage call settings" ON scheduling.call_settings FOR ALL TO authenticated USING (
    scheduling.fn_can_manage_schedule (schedule_id)
)
WITH
    CHECK (
        scheduling.fn_can_manage_schedule (schedule_id)
    );

CREATE POLICY "View own discovery calls" ON scheduling.discovery_calls FOR
SELECT TO authenticated USING (
        host_user_id = auth.uid ()
        OR requester_user_id = auth.uid ()
        OR security.is_admin ()
    );

CREATE POLICY "Request a discovery call" ON scheduling.discovery_calls FOR INSERT TO authenticated
WITH
    CHECK (
        requester_user_id = auth.uid ()
        AND status = 'proposed'::scheduling.call_status
    );

CREATE POLICY "Update own discovery calls" ON scheduling.discovery_calls FOR
UPDATE TO authenticated USING (
    host_user_id = auth.uid ()
    OR requester_user_id = auth.uid ()
    OR security.is_admin ()
)
WITH
    CHECK (
        host_user_id = auth.uid ()
        OR requester_user_id = auth.uid ()
        OR security.is_admin ()
    );

CREATE POLICY "View call attendance" ON scheduling.call_attendance FOR
SELECT TO authenticated USING (
        scheduling.fn_is_call_party (call_id)
    );

CREATE POLICY "View call audit" ON scheduling.call_audit FOR
SELECT TO authenticated USING (
        scheduling.fn_is_call_party (call_id)
    );
