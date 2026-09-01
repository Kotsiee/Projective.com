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

-- Editing and soft-deleting are the sender's own acts, so `edited_at` and
-- `deleted_at` had no writer at all: the table carried both columns and no UPDATE
-- policy, which made them unwritable by any client and the edit path silently
-- impossible rather than refused.
--
-- The WITH CHECK arm re-asserts authorship on the POST-image. Postgres would
-- substitute `USING` for it anyway, so it is explicit rather than corrective —
-- but what it constrains is real and worth reading without knowing that rule: a
-- sender must not be able to edit their own message and set `sender_user_id` to
-- somebody else in the same statement, turning their own words into that person's,
-- which is the impersonation the INSERT policy above closes, reached from the
-- other side. Channel access is re-checked too so an edit cannot outlive the
-- sender's membership of the room.
CREATE POLICY "edit_own_messages" ON comms.project_messages FOR UPDATE TO authenticated
USING (
    sender_user_id = auth.uid ()
    AND comms.has_channel_access (channel_id)
)
WITH CHECK (
    sender_user_id = auth.uid ()
    AND comms.has_channel_access (channel_id)
);

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


-- =============================================================================
-- DM STACK — SELECT policies (the read path for /messages)
--
-- These five tables have had RLS ENABLED since 00002001 with ZERO policies. RLS
-- with no policy is DEFAULT DENY, so as `authenticated` every one of them
-- returned `200 []` — never an error, never a hint — and the entire global inbox
-- was unreadable the moment MESSAGING_BACKEND_LIVE was switched on. The fixture
-- corpus masked it, because with the gate off nothing reached Postgres at all.
--
-- SELECT ONLY, deliberately. The write path (who may post into a thread, who may
-- join one, who may mark a message read) is a larger surface with its own
-- consequences, and adding INSERT/UPDATE policies here would be granting rights
-- the read API does not need. A missing write policy fails closed and visibly;
-- a wrong one does not.
--
-- Membership is expressed as "the caller has an undeleted participant row in
-- this thread". `deleted_at` is a SOFT DELETE of the participation, not of the
-- thread, so a member who deleted the conversation stops being able to read it
-- while everyone else is unaffected — which is what the column was added for.
--
-- The five interaction / auto-response / newsletter tables that 00002001 once
-- missed are covered further down this file; their own section explains what the
-- gap cost and why newsletter_subscriptions deliberately still has no policy.
-- =============================================================================

CREATE POLICY "view_own_dm_participation" ON comms.dm_participants FOR
SELECT TO authenticated USING (user_id = auth.uid ());

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

CREATE POLICY "view_dm_messages_if_participant" ON comms.dm_messages FOR
SELECT TO authenticated USING (comms.is_dm_participant (thread_id));

CREATE POLICY "view_channel_files_if_member" ON comms.channel_files FOR
SELECT TO authenticated USING (
    -- The discriminator vocabulary here is the BARE 'project' / 'dm' pair, not
    -- the schema-qualified 'comms.project_messages' / 'comms.dm_messages' that
    -- message_attachments, message_reactions, message_pins and message_favorites
    -- use. Two vocabularies for one concept inside one schema; matching the wrong
    -- one returns no rows rather than erroring.
    (
        channel_type = 'project'
        AND comms.has_channel_access (channel_id)
    )
    OR (
        channel_type = 'dm'
        AND comms.is_dm_participant (channel_id)
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

-- --- newsletter subscriptions: NO POLICY, ON PURPOSE ---
--
-- Read this before adding one. RLS is enabled in 00002001 and no policy follows,
-- so the table is default-deny for `anon` and `authenticated` alike and reachable
-- only through the service-role key, which bypasses RLS.
--
-- That is the correct shape here and NOT the bug this same pass fixed on the DM
-- stack. There the app genuinely needed to read those tables as the signed-in
-- user, so default-deny silently returned an empty inbox. Here nothing should
-- ever read this table as a user: every row is somebody's email address paired
-- with a `token` that is the unsubscribe capability, so a SELECT policy wide
-- enough to be useful is a subscriber-list dump, and a per-row one would still
-- confirm whether a given address is subscribed.
--
-- The public subscribe form therefore posts to /api/newsletter/subscribe, and
-- NewsletterBackendService performs the upsert with the service-role client. A
-- direct PostgREST INSERT from the browser is not a capability this table wants:
-- it would let anyone enumerate addresses by observing unique-violation errors.

