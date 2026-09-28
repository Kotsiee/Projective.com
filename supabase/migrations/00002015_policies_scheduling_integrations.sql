-- =============================================================================
-- RLS POLICIES — scheduling & integrations schemas
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 20260724100000_scheduling_schema_availability.sql ---

CREATE POLICY "View published or own schedule" ON scheduling.schedules FOR
SELECT TO anon,
authenticated USING (
        scheduling.fn_schedule_is_public (id)
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

-- Blackout rows are the schedule's own members' only: a visitor reads a published schedule's spans
-- through scheduling.get_public_blackouts, which masks a label its owner did not make public — a row
-- policy cannot hide one column, and this one used to hand a visitor the private label too.
CREATE POLICY "View blackout dates" ON scheduling.blackout_dates FOR
SELECT TO authenticated USING (
        scheduling.fn_can_view_schedule (schedule_id)
    );

CREATE POLICY "Manage blackout dates" ON scheduling.blackout_dates FOR ALL TO authenticated USING (
    scheduling.fn_can_manage_schedule (schedule_id)
)
WITH
    CHECK (
        scheduling.fn_can_manage_schedule (schedule_id)
    );


-- --- integrations: connectors ---
-- The provider catalogue and the extension-point / scope catalogues are public reference data.
-- user_connections and every secret/operational table (connection_secrets, connection_sync_state,
-- webhook_subscriptions, webhook_deliveries) carry NO policy on purpose — definer-only /
-- service-role only; clients read integrations.v_my_connections instead.

CREATE POLICY "View integration providers" ON integrations.providers FOR
SELECT TO anon,
authenticated USING (true);

CREATE POLICY "View own connection audit" ON integrations.connection_audit FOR
SELECT TO authenticated USING (
        user_id = auth.uid ()
        OR security.is_admin ()
    );

-- --- integrations: plugin ecosystem ---

-- Catalogues are public reference data.
CREATE POLICY "View extension points" ON integrations.extension_points FOR
SELECT TO anon,
authenticated USING (true);

CREATE POLICY "View plugin scopes" ON integrations.plugin_scopes FOR
SELECT TO anon,
authenticated USING (true);

-- A plugin is visible when published, or to its own publisher/an admin at any status.
CREATE POLICY "View published or own plugins" ON integrations.plugins FOR
SELECT TO anon,
authenticated USING (
        status = 'published'::integrations.plugin_status
        OR developer_user_id = auth.uid ()
        OR security.is_admin ()
    );

CREATE POLICY "Publisher manages own plugin" ON integrations.plugins FOR ALL TO authenticated USING (
    developer_user_id = auth.uid ()
    OR security.is_admin ()
)
WITH
    CHECK (
        developer_user_id = auth.uid ()
        OR security.is_admin ()
    );

-- Versions follow their plugin: published versions are world-visible, drafts only to the publisher.
CREATE POLICY "View published or own plugin versions" ON integrations.plugin_versions FOR
SELECT TO anon,
authenticated USING (
        status = 'published'::integrations.plugin_version_status
        OR integrations.fn_is_plugin_publisher (plugin_id)
        OR security.is_admin ()
    );

CREATE POLICY "Publisher manages own plugin versions" ON integrations.plugin_versions FOR ALL TO authenticated USING (
    integrations.fn_is_plugin_publisher (plugin_id)
    OR security.is_admin ()
)
WITH
    CHECK (
        integrations.fn_is_plugin_publisher (plugin_id)
        OR security.is_admin ()
    );

-- Installations belong to their installer. Uninstall is a soft UPDATE (status → revoked).
CREATE POLICY "View own installations" ON integrations.plugin_installations FOR
SELECT TO authenticated USING (
        installer_user_id = auth.uid ()
        OR security.is_admin ()
    );

CREATE POLICY "Install a plugin" ON integrations.plugin_installations FOR INSERT TO authenticated
WITH
    CHECK (installer_user_id = auth.uid ());

CREATE POLICY "Manage own installations" ON integrations.plugin_installations FOR
UPDATE TO authenticated USING (
    installer_user_id = auth.uid ()
)
WITH
    CHECK (installer_user_id = auth.uid ());

CREATE POLICY "View own plugin audit" ON integrations.plugin_audit FOR
SELECT TO authenticated USING (
        user_id = auth.uid ()
        OR integrations.fn_is_plugin_publisher (plugin_id)
        OR security.is_admin ()
    );


-- --- from 20260724102000_scheduling_events.sql ---

-- Who may see an event ROW: the schedule's own members, the engagement's participants (a project's
-- meetings are on its calendar), and anyone seated on it. NOT a visitor of a published schedule
-- (2026-09-28): the arm that admitted one exposed every column of every busy block — the private
-- titles, `created_by`, the external-calendar provenance — which get_free_busy exists to reduce to
-- bare spans. The room (url, passcode, details) is withheld at the COLUMN level from every client
-- role (00002520) and read by a party through scheduling.get_event_rooms.
CREATE POLICY "View scheduling events" ON scheduling.events FOR
SELECT TO authenticated USING (
        (
            schedule_id IS NOT NULL
            AND scheduling.fn_can_view_schedule (schedule_id)
        )
        OR (
            project_id IS NOT NULL
            AND projects.has_project_access (project_id)
        )
        OR scheduling.fn_is_event_attendee (id)
    );

-- A schedule's owner manages the entries on their own calendar. A PROJECT's events have no client write
-- path: this policy used to admit any participant of the engagement, which let one member move a
-- meeting's `starts_at` straight through PostgREST — skipping the 12-hour lockout, the host-approval
-- gate and the majority rule the reschedule negotiation exists to apply — or hard-delete it with its
-- roster and history (root CLAUDE.md §5). A project event now moves only when the scheduling service
-- closes a round (`scheduling.close_reschedule_round`, service role). The `project_id IS NULL` guard
-- is on BOTH halves so a schedule owner cannot re-anchor their own entry onto somebody's engagement.
CREATE POLICY "Manage scheduling events" ON scheduling.events FOR ALL TO authenticated USING (
    schedule_id IS NOT NULL
    AND project_id IS NULL
    AND scheduling.fn_can_manage_schedule (schedule_id)
)
WITH
    CHECK (
        schedule_id IS NOT NULL
        AND project_id IS NULL
        AND scheduling.fn_can_manage_schedule (schedule_id)
    );

-- Event coordination — read by the event's parties (scheduling.fn_can_see_event_coordination), and
-- written ONLY by the scheduling service as the service role, after the SSOT's rules have run. There
-- is deliberately no client write policy on any of the six: a negotiation's rules (the 12-hour
-- lockout, who may put a slot on the ballot, one vote per attendee per round, the majority) have one
-- implementation, and a direct write through PostgREST would bypass every one of them.
CREATE POLICY "Parties view event attendees" ON scheduling.event_attendees FOR
SELECT TO authenticated USING (scheduling.fn_can_see_event_coordination (event_id));

CREATE POLICY "Parties view event reschedules" ON scheduling.event_reschedules FOR
SELECT TO authenticated USING (scheduling.fn_can_see_event_coordination (event_id));

CREATE POLICY "Parties view reschedule proposals" ON scheduling.reschedule_proposals FOR
SELECT TO authenticated USING (
        EXISTS (
            SELECT 1 FROM scheduling.event_reschedules r
            WHERE r.id = reschedule_id
              AND scheduling.fn_can_see_event_coordination (r.event_id)
        )
    );

CREATE POLICY "Parties view proposal votes" ON scheduling.proposal_votes FOR
SELECT TO authenticated USING (
        EXISTS (
            SELECT 1 FROM scheduling.event_reschedules r
            WHERE r.id = reschedule_id
              AND scheduling.fn_can_see_event_coordination (r.event_id)
        )
    );

CREATE POLICY "Parties view event history" ON scheduling.event_history FOR
SELECT TO authenticated USING (scheduling.fn_can_see_event_coordination (event_id));

CREATE POLICY "Parties view event attachments" ON scheduling.event_attachments FOR
SELECT TO authenticated USING (scheduling.fn_can_see_event_coordination (event_id));


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

-- The offered-platform allow-list follows call_settings exactly: visitor-readable where the schedule
-- is published (a booker chooses a platform BEFORE signing in), owner-managed otherwise. It discloses
-- only which providers the host offers, never a connection, a token or an account id.
CREATE POLICY "View call platforms" ON scheduling.call_platforms FOR
SELECT TO anon,
authenticated USING (
        scheduling.fn_schedule_is_public (schedule_id)
        OR scheduling.fn_can_view_schedule (schedule_id)
    );

CREATE POLICY "Manage call platforms" ON scheduling.call_platforms FOR ALL TO authenticated USING (
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

-- NO client INSERT policy. A discovery call is requested through `scheduling.request_discovery_call`
-- (00001520), which derives the host, the fee and the status from the schedule. The policy this
-- replaces let the requester write every column — the host the call notifies, the fee a paid call
-- charges, the meeting link the host would click — while checking only that they named themselves.

-- NO client UPDATE policy either (2026-09-28). The one that stood here checked only that the caller
-- was a party, on both halves, and the transition trigger returns early when the status is unchanged
-- — so either party could rewrite any column of a call: a paid fee down to 1, a paid call into a free
-- one past the courtesy caps, the host's meeting link, times inside the notice window or outside every
-- call window, the host's own no-show; and, by re-pointing `host_schedule_id`, a busy span onto an
-- unrelated provider's free/busy. Nothing in the app wrote through it. Answering, rescheduling and
-- cancelling a call will each be a definer RPC that names who may make which move.

CREATE POLICY "View call attendance" ON scheduling.call_attendance FOR
SELECT TO authenticated USING (
        scheduling.fn_is_call_party (call_id)
    );

CREATE POLICY "View call audit" ON scheduling.call_audit FOR
SELECT TO authenticated USING (
        scheduling.fn_is_call_party (call_id)
    );
