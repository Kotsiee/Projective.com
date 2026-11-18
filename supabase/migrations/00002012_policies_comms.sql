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
        )
        -- The linker must already be able to read the file. files.fn_can_read admits anyone who
        -- can read a message a file is attached to, so without this arm attaching somebody else's
        -- private asset id to your own message would be a way to read it.
        AND files.fn_can_read (attachment_id)
    );


-- --- from 0311_e7_private_channels_pii_handover.sql ---

-- An archived room (projects.sanitize_single_room_topology) is never listed. The filter lives here and
-- NOT in comms.has_channel_access, which also gates the room's messages and attachments: those stay
-- readable as history, the room simply stops being a place anybody is shown.
CREATE POLICY "view_channels_if_member" ON comms.project_channels FOR SELECT TO authenticated
USING (archived_at IS NULL AND comms.has_channel_access (id));

-- 🚨 The `sender_user_id = auth.uid()` arm is not redundant with channel access.
-- Channel access answers "may this person post here"; it says nothing about WHOSE
-- name goes on the message. Without it any member of a channel could insert a row
-- attributed to another member of the same channel — and a chat message is read as
-- a statement its named author made, so this is impersonation inside the one
-- surface where a client and a freelancer negotiate scope and agree changes. The
-- feed renders the claimed sender verbatim; nothing downstream can tell the
-- difference.
CREATE POLICY "send_messages_if_member" ON comms.project_messages FOR INSERT TO authenticated
WITH CHECK (
    sender_user_id = auth.uid ()
    AND comms.has_channel_access (channel_id)
);

CREATE POLICY "view_messages_if_member" ON comms.project_messages FOR SELECT TO authenticated
USING (comms.has_channel_access (channel_id));

-- No UPDATE policy, on purpose, on either message table. Editing and deleting are the sender's own
-- acts and go through comms.edit_message and comms.delete_message (00001300, PROJECTS CH1), definers
-- that keep the replaced words in comms.message_revisions first, hold the edit window, and refuse an
-- archived room or one frozen by a live dispute. The `edit_own_messages` policy they replace let a
-- sender rewrite a message by a raw PostgREST UPDATE at any age, in an archived room or mid-dispute,
-- and the words it replaced were lost: exactly the evidence the dispute vault needs. 00002520 revokes
-- the column grant that went with it, so a direct UPDATE is refused outright (42501) rather than
-- matching no row. The archive gate T&S P2d planned for this policy lives in the doors instead.

CREATE POLICY "view_attachments_if_member" ON comms.message_attachments FOR SELECT TO authenticated
USING (
    (
        message_table = 'comms.project_messages'::text AND EXISTS (
            SELECT 1 FROM comms.project_messages pm
            WHERE pm.id = message_attachments.message_id
                AND comms.has_channel_access (pm.channel_id)
        )
    )
    -- A DM message's attachment rows follow the message itself (PRD-C33, Decision #509): readable from
    -- where the caller's history in the thread begins, so a group newcomer never lists the files sent
    -- before they joined. This arm once asked only for a participant row, deleted or not, so a member
    -- who had deleted the conversation for themselves still listed its attachments.
    OR (
        message_table = 'comms.dm_messages'::text AND EXISTS (
            SELECT 1 FROM comms.dm_messages m
            WHERE m.id = message_attachments.message_id
                AND m.created_at >= comms.dm_readable_from (m.thread_id)
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


-- =============================================================================
-- DM STACK — SELECT policies (the read path for /messages)
--
-- These five tables have had RLS ENABLED since 00002001 with ZERO policies. RLS
-- with no policy is DEFAULT DENY, so as `authenticated` every one of them
-- returned `200 []` — never an error, never a hint — and the entire global inbox
-- was unreadable the moment MESSAGING_BACKEND_LIVE was switched on. The fixture
-- corpus masked it, because with the gate off nothing reached Postgres at all.
--
-- SELECT, plus exactly ONE write: posting into a thread one is a member of
-- (`send_dm_messages_if_participant`, below). The rest of the write surface (who
-- may join a thread, who may mark a message read, who may star or archive) is
-- still deliberately absent — adding it here would be granting rights nothing
-- yet exercises. A missing write policy fails closed and visibly; a wrong one
-- does not.
--
-- Membership is expressed as "the caller has an undeleted participant row in
-- this thread". `deleted_at` is a SOFT DELETE of the participation, not of the
-- thread, so a member who deleted the conversation stops being able to read it
-- while everyone else is unaffected — which is what the column was added for.
--
-- The five interaction / auto-response / newsletter tables that 00002001 once
-- missed are covered further down this file; their own section explains what the
-- gap cost. (newsletter_subscriptions has since moved to `community`, #274.)
-- =============================================================================

CREATE POLICY "view_own_dm_participation" ON comms.dm_participants FOR
SELECT TO authenticated USING (user_id = auth.uid ());

-- A room read mark is its reader's own, for the reason below: when somebody last read a room is
-- private state, so nobody reads another person's mark. There is no write policy: comms.mark_room_read
-- (00001300) is the one writer, and it moves only the caller's own row.
CREATE POLICY "view_own_room_reads" ON comms.project_channel_reads FOR
SELECT TO authenticated USING (user_id = auth.uid ());

-- A thread's place in a project (brought in, taken out) is the conversation's own fact, shared by its
-- participants like its messages, so a participant reads it and nobody else does. There is no write
-- policy: comms.bring_dm_into_project and comms.take_dm_out_of_project (00001300) are its writers.
CREATE POLICY "view_dm_thread_projects_if_participant" ON comms.dm_thread_projects FOR
SELECT TO authenticated USING (comms.is_dm_participant (thread_id));

-- OWN ROW ONLY. An earlier draft added a second arm — `OR comms.is_dm_participant(thread_id)` — so
-- that the inbox could read the other members of a thread for its roster. That is a disclosure, not
-- a convenience: RLS is ROW-level, not column-level, and every private per-viewer field lives on
-- this same row (`last_read_at`, `is_starred`, `is_archived`, `is_muted`, `deleted_at`). Returning a
-- co-participant's row at all tells the caller whether that person muted the conversation, archived
-- it, deleted it, and exactly when they last read it. There is no column-level fallback: 00002500
-- grants the whole table to `authenticated`, so a policy that admits the row admits all of it.
--
-- The roster the inbox genuinely needs is identity, not state, and it is served by
-- `comms.dm_thread_roster()` (00001300), which returns thread_id + user_id + joined_at and nothing
-- else.
CREATE POLICY "view_dm_threads_if_participant" ON comms.dm_threads FOR
SELECT TO authenticated USING (comms.is_dm_participant (id));

-- Membership AND history (PRD-C33, Decision #509): a participant reads a message written at or after
-- the point their history in the thread begins, which is their own `joined_at` in a group and the
-- thread's start everywhere else (comms.dm_readable_from, 00001300). So someone added to a group, or
-- to a DM their arrival makes one, reads nothing said before they joined, while an entity channel's
-- member reads the channel's whole record. The predicate is NULL for a non-member, and NULL is never
-- true, so it is the whole gate. Every other DM read hangs off this one or off comms.can_read_message,
-- which asks the same question: the inbox previews (comms.inbox_tails is INVOKER), a reply's quoted
-- original, the message search the inbox runs over what it read, and every TS reader in
-- packages/backend/services/messaging, all of which run under the caller's JWT.
CREATE POLICY "view_dm_messages_if_participant" ON comms.dm_messages FOR
SELECT TO authenticated USING (created_at >= comms.dm_readable_from (thread_id));

-- The inbox's one write: a participant may post into their own thread. The
-- `sender_user_id = auth.uid()` arm is not redundant with membership, for the
-- same reason it is not on `comms.project_messages` above — membership answers
-- "may this person post here" and says nothing about WHOSE name goes on the row.
-- Without it either party to a DM could insert a message attributed to the other,
-- and the feed renders the claimed sender verbatim.
--
-- The thread itself is minted by `comms.get_or_create_dm_thread` (00001300),
-- which is SECURITY DEFINER and writes both participant rows, so this policy
-- never has to admit an insert into a thread the caller is not yet a member of:
-- by the time a message is posted, the membership row exists.
--
-- An archived entity channel (Decision #306) takes no new message: its history stays readable to its
-- participants, but a retired room that still accepted posts would not be retired. The thread read is
-- the caller's own (they are a participant, so `view_dm_threads_if_participant` admits the row).
CREATE POLICY "send_dm_messages_if_participant" ON comms.dm_messages FOR
INSERT TO authenticated
WITH
    CHECK (
        sender_user_id = auth.uid ()
        AND comms.is_dm_participant (thread_id)
        AND NOT EXISTS (
            SELECT 1 FROM comms.dm_threads t
             WHERE t.id = dm_messages.thread_id AND t.archived_at IS NOT NULL
        )
    );

CREATE POLICY "view_channel_files_if_member" ON comms.channel_files FOR
SELECT TO authenticated USING (
    -- The discriminator vocabulary here is the BARE 'project' / 'dm' pair, not
    -- the schema-qualified 'comms.project_messages' / 'comms.dm_messages' that
    -- message_attachments, message_reactions, message_pins and message_favorites
    -- use. Two vocabularies for one concept inside one schema; matching the wrong
    -- one returns no rows rather than erroring.
    --
    -- A DM thread's Files tab lists a file from where the caller's history begins (PRD-C33, Decision
    -- #509): the row is registered when its message is sent, so its `created_at` stands for the
    -- message's, and a group newcomer is not shown the files shared before they joined.
    (
        channel_type = 'project'
        AND comms.has_channel_access (channel_id)
    )
    OR (
        channel_type = 'dm'
        AND created_at >= comms.dm_readable_from (channel_id)
    )
);

-- The register had SELECT and nothing else, so a channel attachment could be read
-- and never recorded — which is precisely what the message-send path has to do:
-- an attachment reaches the Files tab through this table, so without an INSERT
-- policy a file sent in a channel is visible in its message and absent from the
-- channel's own file list.
--
-- Same predicate as the read, on purpose: the right to put a file into a room is
-- the right to be in it. Note again the BARE 'project' / 'dm' vocabulary — the
-- sibling tables discriminate on the schema-qualified
-- 'comms.project_messages' / 'comms.dm_messages' pair, and a policy written
-- against the wrong one of the two admits nothing and raises nothing, so it fails
-- as a silently empty file list rather than an error anybody would chase.
CREATE POLICY "register_channel_files_if_member" ON comms.channel_files FOR
INSERT TO authenticated
WITH
    CHECK (
        (
            channel_type = 'project'
            AND comms.has_channel_access (channel_id)
        )
        OR (
            channel_type = 'dm'
            AND comms.is_dm_participant (channel_id)
        )
    );

CREATE POLICY "view_channel_participants_if_member" ON comms.project_channel_participants FOR
SELECT TO authenticated USING (
    -- Keyed on the CHANNEL rather than on the row's own (profile_type,
    -- profile_id): this table has no user_id, so "is this row mine" is not a
    -- question it can answer. Access to the channel is what grants sight of its
    -- roster, which is the predicate every other channel policy already uses.
    comms.has_channel_access (channel_id)
);

-- =============================================================================
-- MESSAGE INTERACTIONS, AUTO-RESPONSES, NEWSLETTER
--
-- These five tables had RLS switched OFF entirely (00002001 never named them)
-- while 00002500 grants `ALL ON ALL TABLES IN SCHEMA comms TO authenticated`.
-- The combination is not weak protection, it is none: any signed-in user could
-- read and rewrite every other user's reactions, pins, favourites and auto-reply
-- rules, and read the whole newsletter list including each row's unsubscribe
-- token. RLS is enabled on all five in 00002001; these are their policies.
--
-- The three interaction tables share one predicate, comms.can_read_message()
-- (00001300), because they share one question: may the caller read the message
-- this row hangs off? Writing it three times would be three places for the
-- project half and the DM half to drift.
-- =============================================================================

-- --- reactions: visible to the room, owned by the reactor ---
--
-- A reaction is public WITHIN the conversation — the whole point is that everyone
-- sees it — so SELECT follows the message. Writing one is personal: the UNIQUE is
-- (message_table, message_id, user_id, emoji), so a row belongs to exactly one
-- person and only that person may add or remove it. The `user_id = auth.uid()`
-- arm on INSERT is what stops a caller reacting AS someone else.

CREATE POLICY "view_reactions_on_readable_messages" ON comms.message_reactions FOR
SELECT TO authenticated USING (comms.can_read_message (message_table, message_id));

CREATE POLICY "react_as_self_on_readable_messages" ON comms.message_reactions FOR
INSERT TO authenticated
WITH
    CHECK (
        user_id = auth.uid ()
        AND comms.can_read_message (message_table, message_id)
    );

CREATE POLICY "remove_own_reaction" ON comms.message_reactions FOR
DELETE TO authenticated USING (user_id = auth.uid ());

-- --- pins: a SHARED act, not a personal one ---
--
-- Note the UNIQUE is (message_table, message_id) with no user_id in it: a message
-- is pinned once for the whole channel, so pinning and un-pinning act on everyone
-- else's view. That makes DELETE the sharp edge here, and it is deliberately NOT
-- restricted to the pinner: in a two-person DM the counterparty must be able to
-- clear a pin, and in a channel a stale pin outliving whoever set it is the state
-- this avoids.
--
-- What this CANNOT express is the product's finer rule — MessagePage.permissions
-- .canPin is "anyone in a DM; owner-granted in a project/team channel" — because
-- no column records that grant. Channel access is the closest the schema can get,
-- and the app layer holds the narrower gate. Recorded rather than silently
-- approximated: a reader comparing the policy to the product rule should find the
-- difference named.

CREATE POLICY "view_pins_on_readable_messages" ON comms.message_pins FOR
SELECT TO authenticated USING (comms.can_read_message (message_table, message_id));

CREATE POLICY "pin_readable_messages" ON comms.message_pins FOR
INSERT TO authenticated
WITH
    CHECK (
        pinned_by_user_id = auth.uid ()
        AND comms.can_read_message (message_table, message_id)
    );

CREATE POLICY "unpin_in_readable_conversations" ON comms.message_pins FOR
DELETE TO authenticated USING (comms.can_read_message (message_table, message_id));

-- --- favourites: entirely private ---
--
-- The UNIQUE is (user_id, message_table, message_id) and nothing renders another
-- person's favourites, so every verb is own-row-only. There is deliberately NO
-- `can_read_message` arm on SELECT/DELETE: a favourite that outlives the caller's
-- access to its message should still be listable and removable by its owner, and
-- the row carries no content to leak.

CREATE POLICY "view_own_favorites" ON comms.message_favorites FOR
SELECT TO authenticated USING (user_id = auth.uid ());

CREATE POLICY "favorite_readable_messages" ON comms.message_favorites FOR
INSERT TO authenticated
WITH
    CHECK (
        user_id = auth.uid ()
        AND comms.can_read_message (message_table, message_id)
    );

CREATE POLICY "remove_own_favorite" ON comms.message_favorites FOR
DELETE TO authenticated USING (user_id = auth.uid ());

-- --- auto-responses: a user's own automation ---
--
-- Split into four policies rather than one FOR ALL so that UPDATE carries both a
-- USING and a WITH CHECK. FOR ALL would apply the single expression to both, which
-- reads as equivalent and is not: without the WITH CHECK arm a caller can UPDATE
-- their own row and set user_id to somebody else in the same statement, handing
-- the row away. That is the same shape as the files.items defect recorded in
-- Decision #67.

CREATE POLICY "view_own_auto_responses" ON comms.auto_responses FOR
SELECT TO authenticated USING (user_id = auth.uid ());

CREATE POLICY "create_own_auto_responses" ON comms.auto_responses FOR
INSERT TO authenticated
WITH
    CHECK (user_id = auth.uid ());

CREATE POLICY "update_own_auto_responses" ON comms.auto_responses FOR
UPDATE TO authenticated USING (user_id = auth.uid ())
WITH
    CHECK (user_id = auth.uid ());

CREATE POLICY "delete_own_auto_responses" ON comms.auto_responses FOR
DELETE TO authenticated USING (user_id = auth.uid ());

-- --- newsletter subscriptions: moved ---
--
-- The opt-in table is community.newsletter_subscriptions now (Decision #274). It
-- still has NO POLICY, ON PURPOSE — the reasoning moved with it, to its region in
-- 00002021_policies_editorial_community.sql. Read it there before adding one.

