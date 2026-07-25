-- =============================================================================
-- RLS POLICIES — comms schema (messaging, channels, notifications)
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0202_comms.sql ---

CREATE POLICY "Users link own message attachments" ON comms.message_attachments FOR
INSERT
    TO authenticated
WITH
    CHECK (
        (
            message_table = 'comms.project_messages'
            AND EXISTS (
                SELECT 1
                FROM comms.project_messages pm
                WHERE
                    pm.id = message_id
                    AND pm.sender_user_id = auth.uid ()
            )
        )
        OR (
            message_table = 'comms.dm_messages'
            AND EXISTS (
                SELECT 1
                FROM comms.dm_messages dm
                WHERE
                    dm.id = message_id
                    AND dm.sender_user_id = auth.uid ()
            )
        )
    );


-- --- from 0311_e7_private_channels_pii_handover.sql ---

CREATE POLICY "view_channels_if_member" ON comms.project_channels FOR SELECT TO authenticated
USING (comms.has_channel_access (id));

CREATE POLICY "send_messages_if_member" ON comms.project_messages FOR INSERT TO authenticated
WITH CHECK (comms.has_channel_access (channel_id));

CREATE POLICY "view_messages_if_member" ON comms.project_messages FOR SELECT TO authenticated
USING (comms.has_channel_access (channel_id));

CREATE POLICY "view_attachments_if_member" ON comms.message_attachments FOR SELECT TO authenticated
USING (
    (
        message_table = 'comms.project_messages'::text AND EXISTS (
            SELECT 1 FROM comms.project_messages pm
            WHERE pm.id = message_attachments.message_id
                AND comms.has_channel_access (pm.channel_id)
        )
    )
    OR (
        message_table = 'comms.dm_messages'::text AND EXISTS (
            SELECT 1 FROM comms.dm_participants dp
            WHERE dp.thread_id = (
                    SELECT dm_messages.thread_id FROM comms.dm_messages
                    WHERE dm_messages.id = message_attachments.message_id
                )
                AND dp.user_id = auth.uid ()
        )
    )
);


-- --- from 20260724094000_comms_notification_rls_jobs.sql ---

CREATE POLICY "Users view own notifications" ON comms.notifications FOR
SELECT TO authenticated USING (user_id = auth.uid ());

CREATE POLICY "Users update own notification state" ON comms.notifications FOR
UPDATE TO authenticated USING (user_id = auth.uid ())
WITH CHECK (user_id = auth.uid ());

CREATE POLICY "Users view own notification prefs" ON comms.notification_prefs FOR
SELECT TO authenticated USING (user_id = auth.uid ());

CREATE POLICY "Users insert own notification prefs" ON comms.notification_prefs FOR
INSERT TO authenticated WITH CHECK (user_id = auth.uid ());

CREATE POLICY "Users update own notification prefs" ON comms.notification_prefs FOR
UPDATE TO authenticated USING (user_id = auth.uid ())
WITH CHECK (user_id = auth.uid ());

CREATE POLICY "Users manage own category prefs" ON comms.notification_category_prefs FOR ALL
TO authenticated USING (user_id = auth.uid ())
WITH CHECK (user_id = auth.uid ());

CREATE POLICY "Users manage own type mutes" ON comms.notification_type_mutes FOR ALL
TO authenticated USING (user_id = auth.uid ())
WITH CHECK (user_id = auth.uid ());

CREATE POLICY "Read notification catalog" ON comms.notification_types FOR
SELECT TO authenticated USING (enabled OR security.is_admin ());

CREATE POLICY "Users view own devices" ON comms.device_tokens FOR
SELECT TO authenticated USING (user_id = auth.uid ());

CREATE POLICY "Users register own devices" ON comms.device_tokens FOR
INSERT TO authenticated WITH CHECK (user_id = auth.uid ());

CREATE POLICY "Users update own devices" ON comms.device_tokens FOR
UPDATE TO authenticated USING (user_id = auth.uid ())
WITH CHECK (user_id = auth.uid ());

CREATE POLICY "Users delete own devices" ON comms.device_tokens FOR
DELETE TO authenticated USING (user_id = auth.uid ());

CREATE POLICY "Users view own deliveries" ON comms.notification_deliveries FOR
SELECT TO authenticated USING (user_id = auth.uid () OR security.is_admin ());

CREATE POLICY "Users view own queued notifications" ON comms.notification_queue FOR
SELECT TO authenticated USING (user_id = auth.uid () OR security.is_admin ());

CREATE POLICY "Users view own digests" ON comms.notification_digests FOR
SELECT TO authenticated USING (user_id = auth.uid () OR security.is_admin ());

CREATE POLICY "Users view own suppressions" ON comms.channel_suppressions FOR
SELECT TO authenticated USING (user_id = auth.uid () OR security.is_admin ());
