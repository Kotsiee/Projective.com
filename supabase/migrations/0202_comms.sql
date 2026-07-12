ALTER TABLE comms.project_messages REPLICA IDENTITY DEFAULT;

ALTER TABLE comms.dm_messages REPLICA IDENTITY DEFAULT;

DROP POLICY IF EXISTS "view_attachments_if_member" ON comms.message_attachments;

CREATE POLICY "view_attachments_if_member" ON comms.message_attachments
    FOR SELECT
    TO authenticated
    USING (
        (
            (message_table = 'comms.project_messages'::text) AND 
            (EXISTS ( 
                SELECT 1
                FROM (comms.project_messages pm
                JOIN comms.project_channels pc ON ((pm.channel_id = pc.id)))
                WHERE ((pm.id = message_attachments.message_id) AND projects.has_project_access(pc.project_id))
            ))
        ) 
        OR 
        (
            (message_table = 'comms.dm_messages'::text) AND 
            (EXISTS ( 
                SELECT 1
                FROM comms.dm_participants dp
                WHERE (
                    (dp.thread_id = ( SELECT dm_messages.thread_id FROM comms.dm_messages WHERE (dm_messages.id = message_attachments.message_id))) 
                    AND (dp.user_id = auth.uid())
                )
            ))
        )
    );

DROP POLICY IF EXISTS "view_channels_if_member" ON comms.project_channels;

CREATE POLICY "view_channels_if_member" ON comms.project_channels FOR
SELECT TO authenticated USING (
        projects.has_project_access (project_id)
    );

DROP POLICY IF EXISTS "send_messages_if_member" ON comms.project_messages;

CREATE POLICY "send_messages_if_member" ON comms.project_messages FOR
INSERT
    TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM comms.project_channels pc
            WHERE (
                    (
                        pc.id = project_messages.channel_id
                    )
                    AND projects.has_project_access (pc.project_id)
                )
        )
    );

DROP POLICY IF EXISTS "view_messages_if_member" ON comms.project_messages;

CREATE POLICY "view_messages_if_member" ON comms.project_messages FOR
SELECT TO authenticated USING (
        EXISTS (
            SELECT 1
            FROM comms.project_channels pc
            WHERE (
                    (
                        pc.id = project_messages.channel_id
                    )
                    AND projects.has_project_access (pc.project_id)
                )
        )
    );

DROP POLICY IF EXISTS "Users link own message attachments" ON comms.message_attachments;

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