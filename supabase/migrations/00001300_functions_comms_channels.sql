-- ============================================================================
-- 00001300 functions comms channels
-- Consolidated verbatim from: 0113_get_or_create_dm_thread.sql, 0311_e7_private_channels_pii_handover.sql
-- ============================================================================

-- `p_subject_listing` (Decision #217(g)): the listing a buyer pressed Contact on. A thread this call
-- OPENS then becomes a `service_inquiry` about that listing; an existing service inquiry without a
-- subject gains it. A thread already under way between the pair keeps its kind — unified messaging
-- keeps one record per pair, and a DM cannot carry a subject (`ck_dm_threads_subject_inquiry`).
CREATE OR REPLACE FUNCTION comms.get_or_create_dm_thread(
    target_user_id uuid,
    p_subject_listing uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, org, auth
AS $$
DECLARE
    v_current_user_id uuid := auth.uid();
    v_thread_id uuid;
BEGIN
    -- The subject must be a live listing the recipient sells; otherwise a thread could claim to be
    -- about a listing that has nothing to do with them.
    IF p_subject_listing IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM catalogue.listings l
         WHERE l.id = p_subject_listing
           AND l.owner_user_id = target_user_id
           AND l.status = 'published'::catalogue.listing_status
    ) THEN
        RAISE EXCEPTION 'That listing is not on sale from this person' USING ERRCODE = '22023';
    END IF;

    -- A GROUP that happens to contain both people is not their DM: the join alone would return
    -- it (nothing requires the thread to hold ONLY these two), so a "message this person" from a
    -- profile would land in a group chat everyone else can read. A service inquiry IS the pair's
    -- thread (unified messaging, one record per pair); a group and an entity channel are not.
    SELECT t.id INTO v_thread_id
    FROM comms.dm_threads t
    JOIN comms.dm_participants p1 ON p1.thread_id = t.id AND p1.user_id = v_current_user_id
    JOIN comms.dm_participants p2 ON p2.thread_id = t.id AND p2.user_id = target_user_id
    WHERE t.kind IN ('dm', 'service_inquiry')
    ORDER BY t.created_at
    LIMIT 1;

    IF v_thread_id IS NOT NULL THEN
        IF p_subject_listing IS NOT NULL THEN
            UPDATE comms.dm_threads t
               SET subject_listing_id = p_subject_listing
             WHERE t.id = v_thread_id AND t.kind = 'service_inquiry' AND t.subject_listing_id IS NULL;
        END IF;
        RETURN v_thread_id;
    END IF;

    INSERT INTO comms.dm_threads (created_by_user_id, kind, subject_listing_id)
    VALUES (
        v_current_user_id,
        CASE WHEN p_subject_listing IS NULL THEN 'dm' ELSE 'service_inquiry' END::comms.conversation_kind,
        p_subject_listing
    )
    RETURNING id INTO v_thread_id;

    
    INSERT INTO comms.dm_participants (thread_id, user_id)
    VALUES (v_thread_id, v_current_user_id), (v_thread_id, target_user_id);

    RETURN v_thread_id;
END;
$$;

-- Does the current user belong to a given (project, stage, visibility) scope? Single source of truth
-- reused by has_channel_access, the channel opener and the channel lister.
CREATE OR REPLACE FUNCTION comms.can_access_scope(
    p_project_id uuid,
    p_stage_id uuid,
    p_visibility text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, comms, projects, org, auth
AS $$
BEGIN
    -- Whole-project channels keep the broad project gate.
    IF p_stage_id IS NULL THEN
        RETURN projects.has_project_access(p_project_id);
    END IF;

    -- Every scoped stage room requires stage-room membership first.
    IF NOT projects.has_stage_access(p_stage_id) THEN
        RETURN false;
    END IF;

    IF p_visibility = 'business_private' THEN
        -- Client side only: owner or an active (verified) member of the paying business.
        RETURN projects.can_review_project(p_project_id);
    ELSIF p_visibility = 'team_private' THEN
        -- Talent side only: an assigned freelancer or an active member of an assigned team.
        RETURN EXISTS (
            SELECT 1 FROM projects.stage_assignments sa
            WHERE sa.project_stage_id = p_stage_id
                AND sa.assignee_type = 'freelancer'
                AND sa.freelancer_profile_id = auth.uid()
                AND sa.status NOT IN ('released', 'cancelled', 'declined')
        ) OR EXISTS (
            SELECT 1 FROM projects.stage_assignments sa
            JOIN org.team_members tm ON tm.team_id = sa.team_id
            WHERE sa.project_stage_id = p_stage_id
                AND sa.assignee_type = 'team'
                AND tm.user_id = auth.uid()
                AND tm.status = 'active'
                AND sa.status NOT IN ('released', 'cancelled', 'declined')
        );
    ELSE
        -- 'stage_all' General room: everyone with stage access.
        RETURN true;
    END IF;
END;
$$;

-- Resolve a channel row to its scope and delegate. Used by every comms RLS policy below.
CREATE OR REPLACE FUNCTION comms.has_channel_access(p_channel_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, comms, projects, org, auth
AS $$
DECLARE
    v_project uuid;
    v_stage uuid;
    v_vis text;
BEGIN
    SELECT project_id, stage_id, visibility
        INTO v_project, v_stage, v_vis
    FROM comms.project_channels
    WHERE id = p_channel_id;

    IF v_project IS NULL THEN
        RETURN false;
    END IF;

    RETURN comms.can_access_scope(v_project, v_stage, v_vis);
END;
$$;

CREATE OR REPLACE FUNCTION comms.get_or_create_project_channel(
    p_project_id uuid,
    p_stage_id uuid,
    p_name text,
    p_visibility text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, projects, org, auth
AS $$
DECLARE
    v_channel_id uuid;
    v_visibility text;
BEGIN
    -- Default scope: stage rooms open the General ('stage_all') room; project-wide channels stay
    -- 'project_all'. Existing 3-arg callers resolve here with p_visibility = NULL.
    v_visibility := COALESCE(
        p_visibility,
        CASE WHEN p_stage_id IS NULL THEN 'project_all' ELSE 'stage_all' END
    );

    IF NOT comms.can_access_scope(p_project_id, p_stage_id, v_visibility) THEN
        RAISE EXCEPTION 'You do not have access to this % channel.', v_visibility
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT id INTO v_channel_id
    FROM comms.project_channels
    WHERE project_id = p_project_id
        AND stage_id IS NOT DISTINCT FROM p_stage_id
        AND visibility = v_visibility
    LIMIT 1;

    IF v_channel_id IS NOT NULL THEN
        RETURN v_channel_id;
    END IF;

    INSERT INTO comms.project_channels (project_id, stage_id, name, visibility)
    VALUES (p_project_id, p_stage_id, p_name, v_visibility)
    RETURNING id INTO v_channel_id;

    RETURN v_channel_id;
END;
$$;

-- Ensure the three scoped rooms exist for a stage and return them with a per-row access flag plus the
-- project's protected-phase status. Channel creation is system-level (definer) so the General room can
-- be provisioned even for a caller who only belongs to one scope; message access is still RLS-gated.
CREATE OR REPLACE FUNCTION comms.get_stage_channels(p_stage_id uuid)
RETURNS TABLE (
    id uuid,
    visibility text,
    name text,
    accessible boolean,
    protected_phase boolean,
    handover_unlocked_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, projects, org, auth
AS $$
DECLARE
    v_project uuid;
    v_stage_name text;
    v_scopes text[] := ARRAY['stage_all', 'team_private', 'business_private'];
    v_scope text;
    v_label text;
BEGIN
    -- An archived stage (projects.sanitize_single_room_topology) is gone from the product.
    SELECT ps.project_id, ps.name INTO v_project, v_stage_name
    FROM projects.project_stages ps WHERE ps.id = p_stage_id AND ps.archived_at IS NULL;

    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Stage not found.' USING ERRCODE = 'no_data_found';
    END IF;

    IF NOT projects.has_stage_access(p_stage_id) THEN
        RAISE EXCEPTION 'You do not have access to this stage workspace.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- A Session presents one room, its project-wide Discussion, so its stages (its sessions) are never
    -- given rooms of their own — provisioning here would undo the sanitizer on the next open. The
    -- existence test below deliberately counts archived rooms, so an archived scope is not re-created.
    FOREACH v_scope IN ARRAY v_scopes LOOP
        EXIT WHEN EXISTS (
            SELECT 1 FROM projects.projects p WHERE p.id = v_project AND p.format::text = 'session'
        );
        IF NOT EXISTS (
            SELECT 1 FROM comms.project_channels pc
            WHERE pc.project_id = v_project AND pc.stage_id = p_stage_id AND pc.visibility = v_scope
        ) THEN
            v_label := CASE v_scope
                WHEN 'stage_all' THEN v_stage_name
                WHEN 'team_private' THEN v_stage_name || ' — Team'
                WHEN 'business_private' THEN v_stage_name || ' — Business'
            END;
            INSERT INTO comms.project_channels (project_id, stage_id, name, visibility)
            VALUES (v_project, p_stage_id, v_label, v_scope);
        END IF;
    END LOOP;

    RETURN QUERY
    SELECT
        pc.id,
        pc.visibility,
        pc.name,
        comms.can_access_scope(v_project, p_stage_id, pc.visibility) AS accessible,
        projects.is_protected_phase(v_project) AS protected_phase,
        (SELECT p.handover_unlocked_at FROM projects.projects p WHERE p.id = v_project)
            AS handover_unlocked_at
    FROM comms.project_channels pc
    WHERE pc.project_id = v_project
        AND pc.stage_id = p_stage_id
        AND pc.archived_at IS NULL
        AND pc.visibility IN ('stage_all', 'team_private', 'business_private')
    ORDER BY array_position(v_scopes, pc.visibility);
END;
$$;

-- Regex masker. Order matters: emails, then payment links/handles, then bare phone numbers (a payment
-- URL can contain digits that would otherwise be eaten by the phone pass). Kept intentionally aligned
-- with the @projective/backend PIIFilter so both layers mask the same shapes.
CREATE OR REPLACE FUNCTION comms.mask_pii(p_text text)
RETURNS TABLE (masked text, categories text[])
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v text := p_text;
    cats text[] := '{}';
BEGIN
    IF v IS NULL OR v = '' THEN
        RETURN QUERY SELECT p_text, '{}'::text[];
        RETURN;
    END IF;

    -- Email addresses.
    IF v ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}' THEN
        v := regexp_replace(v, '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[email hidden]', 'gi');
        cats := array_append(cats, 'email');
    END IF;

    -- Third-party payment links / off-platform contact URLs.
    IF v ~* '(https?://)?(www\.)?(paypal(\.me)?|venmo|cash\.?app|cash\.me|zelle|wise\.com|revolut\.me|monzo\.me|ko-?fi\.com|buymeacoffee\.com|t\.me|wa\.me|telegram\.me)[[:graph:]]*' THEN
        v := regexp_replace(v, '(https?://)?(www\.)?(paypal(\.me)?|venmo|cash\.?app|cash\.me|zelle|wise\.com|revolut\.me|monzo\.me|ko-?fi\.com|buymeacoffee\.com|t\.me|wa\.me|telegram\.me)[[:graph:]]*', '[link hidden]', 'gi');
        cats := array_append(cats, 'payment_link');
    END IF;

    -- Payment handles / cashtags ($name).
    IF v ~ '\$[[:alpha:]][[:alnum:]_]{1,}' THEN
        v := regexp_replace(v, '\$[[:alpha:]][[:alnum:]_]{1,}', '[handle hidden]', 'g');
        cats := array_append(cats, 'handle');
    END IF;

    -- External phone numbers: 7+ digits, optional +, spaces, dashes, parens, dots.
    IF v ~ '[+(]?[0-9][0-9 ().-]{6,}[0-9]' THEN
        v := regexp_replace(v, '[+(]?[0-9][0-9 ().-]{6,}[0-9]', '[phone hidden]', 'g');
        cats := array_append(cats, 'phone');
    END IF;

    RETURN QUERY SELECT v, cats;
END;
$$;

-- BEFORE INSERT gate: mask + flag messages sent while the parent project is in its protected phase.
-- This is the authoritative enforcement point — it fires for every insert path (service or direct).
--
-- A masked message also LOSES its formatting (`body_delta := NULL`). The Delta spells the ORIGINAL
-- words run by run, so leaving it in place would keep every address and number this trigger just
-- hid readable one column over. It is not masked op by op instead, because a contact detail can
-- straddle formatting runs — a bold area code, an italic domain — and the patterns match the JOINED
-- text: a per-run pass misses exactly the split ones, and mapping the masked text back onto the runs
-- would have to invent where each mark now begins and ends inside a placeholder. So the message
-- renders plain. Losing the bold on a sentence is the cheap failure here; a leaked phone number is
-- not. (The read side would also discard the stale Delta, which no longer spells the body — but the
-- original words must not be STORED, not merely go unrendered.)
CREATE OR REPLACE FUNCTION comms.tg_mask_message_pii()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, projects
AS $$
DECLARE
    v_project uuid;
    v_masked text;
    v_cats text[];
BEGIN
    IF NEW.body IS NULL OR NEW.body = '' THEN
        RETURN NEW;
    END IF;

    SELECT project_id INTO v_project FROM comms.project_channels WHERE id = NEW.channel_id;
    IF v_project IS NULL OR NOT projects.is_protected_phase(v_project) THEN
        RETURN NEW;
    END IF;

    SELECT m.masked, m.categories INTO v_masked, v_cats FROM comms.mask_pii(NEW.body) m;
    IF array_length(v_cats, 1) IS NOT NULL THEN
        NEW.body := v_masked;
        NEW.body_delta := NULL;
        NEW.pii_masked := true;
        NEW.pii_categories := v_cats;
    END IF;

    RETURN NEW;
END;
$$;

-- The protected engagement a DM falls under, or NULL. The message's own `project_id` when that
-- project is still protected; otherwise a live, protected project the sender and another member of
-- the thread are BOTH party to. A client cannot opt a message out: omitting `project_id` only sends
-- the lookup to the derivation, and naming an unrelated project can only add masking.
CREATE OR REPLACE FUNCTION comms.fn_dm_protected_project(
    p_thread_id uuid,
    p_sender uuid,
    p_project_id uuid
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, comms, projects
AS $$
    SELECT COALESCE(
        (SELECT p.id FROM projects.projects p
          WHERE p.id = p_project_id AND p.handover_unlocked_at IS NULL),
        (SELECT p.id
           FROM projects.projects p
          WHERE p.handover_unlocked_at IS NULL
            AND p.status IN ('draft', 'active', 'on_hold')
            AND p.id IN (SELECT e.project_id FROM projects.fn_engaged_projects(p_sender) e)
            AND p.id IN (
                SELECT e.project_id
                  FROM comms.dm_participants o
                  CROSS JOIN LATERAL projects.fn_engaged_projects(o.user_id) e
                 WHERE o.thread_id = p_thread_id AND o.user_id <> p_sender
            )
          LIMIT 1)
    );
$$;

-- BEFORE INSERT gate for direct messages: the same mask + flag comms.tg_mask_message_pii applies to
-- a stage room, applied whenever the thread falls under a protected engagement — a hiring request,
-- an application, or two parties already working together. A masked body drops its formatting for
-- the reason stated on that function: the Delta spells the unmasked words.
CREATE OR REPLACE FUNCTION comms.tg_mask_dm_message_pii()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, projects
AS $$
DECLARE
    v_masked text;
    v_cats text[];
BEGIN
    IF NEW.body IS NULL OR NEW.body = '' THEN
        RETURN NEW;
    END IF;

    IF comms.fn_dm_protected_project(NEW.thread_id, NEW.sender_user_id, NEW.project_id) IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT m.masked, m.categories INTO v_masked, v_cats FROM comms.mask_pii(NEW.body) m;
    IF array_length(v_cats, 1) IS NOT NULL THEN
        NEW.body := v_masked;
        NEW.body_delta := NULL;
        NEW.pii_masked := true;
        NEW.pii_categories := v_cats;
    END IF;

    RETURN NEW;
END;
$$;

-- =============================================================================
-- Replies stay inside their own conversation.
--
-- `reply_to_id` is a self-reference (00000016), so the foreign key already
-- guarantees the original EXISTS and is a message of the same table. What it
-- cannot say is that the original sits in the same CHANNEL (or, for a DM, the
-- same THREAD) as the reply. Without that, a member of two rooms could post a
-- reply in one whose quote is a message from the other — and every reader of the
-- first room would be shown words from a room they may not be allowed into. The
-- quote is rendered from the original, so this is a disclosure, not a cosmetic
-- mismatch.
--
-- BEFORE INSERT, and BEFORE UPDATE of the two columns that could break the rule
-- afterwards: `edit_own_messages` (00002012) lets a sender UPDATE their own
-- project message, and a guard that ran only on INSERT would be one PATCH away
-- from being bypassed. dm_messages has no client UPDATE policy today; the guard
-- covers it anyway so the rule does not depend on that staying true.
--
-- SECURITY DEFINER for the same reason as the PII gates above: the rule is
-- structural, so its lookup must not depend on what the inserting role's SELECT
-- policy happens to admit. That reveals nothing — the refusal is ONE sentence for
-- an original that is missing, in another room, or the row itself, so it cannot
-- be used to probe which ids exist where. The sentence is written for a reader
-- and raised as `check_violation`, which `refusalFrom` (projects/live-writes.ts)
-- matches by its words and reports as a 422 on the `replyToId` field. The fat
-- services refuse the same reply with the same words BEFORE inserting; this is
-- the backstop every other insert path (service role, a hand-rolled request)
-- cannot step around.
--
-- A soft-deleted original is NOT refused. It still exists and is still in the
-- room, the reply is a true statement about what it answered, and its quote
-- renders as unavailable — refusing would only punish somebody for a delete that
-- landed while they were typing.
-- =============================================================================
CREATE OR REPLACE FUNCTION comms.tg_guard_message_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms
AS $$
BEGIN
    IF NEW.reply_to_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.reply_to_id = NEW.id OR NOT EXISTS (
        SELECT 1 FROM comms.project_messages o
        WHERE o.id = NEW.reply_to_id
          AND o.channel_id = NEW.channel_id
    ) THEN
        RAISE EXCEPTION 'That message can''t be replied to here.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- The DM twin of comms.tg_guard_message_reply: the original must sit in the reply's own thread.
CREATE OR REPLACE FUNCTION comms.tg_guard_dm_message_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms
AS $$
BEGIN
    IF NEW.reply_to_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.reply_to_id = NEW.id OR NOT EXISTS (
        SELECT 1 FROM comms.dm_messages o
        WHERE o.id = NEW.reply_to_id
          AND o.thread_id = NEW.thread_id
    ) THEN
        RAISE EXCEPTION 'That message can''t be replied to here.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- BEFORE INSERT on comms.dm_messages: a reply accepts a request. When the SENDER's own copy of the
-- thread sits in their Requests folder, posting into it moves it to their Primary inbox. Every other
-- participant's folder is left alone, so a requester's follow-up can never pull a thread out of the
-- recipient's Requests — only the recipient answering does.
CREATE OR REPLACE FUNCTION comms.fn_promote_thread_on_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms
AS $$
BEGIN
    -- An automatic reply is not the person answering, so it never accepts a request; an entity
    -- channel never holds one.
    IF NEW.auto_response_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM comms.dm_threads t WHERE t.id = NEW.thread_id AND t.kind = 'entity_channel'
    ) THEN
        RETURN NEW;
    END IF;

    UPDATE comms.dm_participants p
    SET inbox_folder = 'primary'
    WHERE p.thread_id = NEW.thread_id
      AND p.user_id = NEW.sender_user_id
      AND p.inbox_folder = 'requests'
      AND p.deleted_at IS NULL;

    RETURN NEW;
END;
$$;

-- =============================================================================
-- DM thread membership — the predicate the /messages read policies are built on.
--
-- SECURITY DEFINER is not a convenience here, it is the whole point. The natural
-- way to write "may I read this thread" is an EXISTS over comms.dm_participants,
-- and the policy ON comms.dm_participants would then subquery its own table —
-- which re-enters the policy and fails at runtime with 42P17 (infinite recursion
-- detected in policy for relation "dm_participants"). A definer function runs as
-- the owner, so the lookup inside it is NOT re-filtered by RLS and the cycle is
-- broken. This is the same shape comms.has_channel_access already uses for the
-- project-channel side.
--
-- It answers membership ONLY. It grants nothing by itself: every caller is a
-- policy that has already narrowed to a specific row, and a bare `true` from
-- here still has to survive the policy it is embedded in.
--
-- `deleted_at IS NULL` is load-bearing. A participant row is soft-deleted when
-- that member deletes the conversation for themselves, and treating a deleted
-- participation as membership would resurrect a thread the user meant to be rid
-- of — for them alone, since everyone else's row is untouched.
-- =============================================================================
CREATE OR REPLACE FUNCTION comms.is_dm_participant(p_thread_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, comms, auth
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM comms.dm_participants p
        WHERE
            p.thread_id = p_thread_id
            AND p.user_id = auth.uid()
            AND p.deleted_at IS NULL
    );
$$;

COMMENT ON FUNCTION comms.is_dm_participant(uuid) IS
'True when the calling user has an undeleted participant row in the given DM thread. SECURITY DEFINER so the RLS policies on comms.dm_participants can use it without recursing into themselves.';

-- =============================================================================
-- DM thread roster — identity WITHOUT per-viewer state.
--
-- The inbox needs to know who else is in a thread: to title a DM after its
-- counterparty and to draw a group's roster. It does NOT need to know whether
-- those people muted, archived, deleted or last read the conversation, and the
-- policy on comms.dm_participants deliberately will not tell it (see 00002012) —
-- RLS is row-level, so admitting a co-participant's row admits every private
-- column on it.
--
-- This function is the narrow answer: three columns, and none of them is state.
-- SECURITY DEFINER so it can read past that own-row-only policy, with the
-- membership check done here instead: a caller only ever receives rosters for
-- threads they are themselves an undeleted participant of.
--
-- Note what is NOT filtered: a co-participant whose own `deleted_at` is set is
-- still returned. They are still in the conversation as far as everyone else is
-- concerned — deleting it for yourself is not leaving it — and omitting them
-- would silently rewrite a group's roster for the remaining members.
-- =============================================================================
CREATE OR REPLACE FUNCTION comms.dm_thread_roster(p_thread_ids uuid[])
RETURNS TABLE (thread_id uuid, user_id uuid, joined_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, comms, auth
AS $$
    SELECT p.thread_id, p.user_id, p.joined_at
    FROM comms.dm_participants p
    WHERE
        p.thread_id = ANY (p_thread_ids)
        AND EXISTS (
            SELECT 1
            FROM comms.dm_participants mine
            WHERE
                mine.thread_id = p.thread_id
                AND mine.user_id = auth.uid()
                AND mine.deleted_at IS NULL
        );
$$;

COMMENT ON FUNCTION comms.dm_thread_roster(uuid[]) IS
'Thread membership as identity only (thread_id, user_id, joined_at) for threads the caller participates in. Exists so the inbox can draw a roster without the own-row-only SELECT policy on comms.dm_participants having to disclose other members private per-viewer state.';

-- =============================================================================
-- Message readability — the one predicate behind reactions, pins and favourites.
--
-- comms.message_reactions, message_pins, message_favorites and message_attachments
-- are all POLYMORPHIC on (message_table, message_id): Postgres cannot point one
-- column at two parents, so there is no foreign key and no join a policy can
-- lean on. Each therefore needs the same question answered — "may the caller read
-- the message this row hangs off?" — and answering it four times in four policies
-- is four places for the project half and the DM half to drift apart.
--
-- SECURITY DEFINER for the same reason comms.is_dm_participant is: the lookups
-- inside reach comms.project_messages and comms.dm_messages, both of which carry
-- their own SELECT policies, and a policy that re-enters another policy is at best
-- a performance cliff and at worst a recursion error. Running as owner makes the
-- inner reads plain table reads and the authority decision explicit, right here.
--
-- The discriminator vocabulary is the SCHEMA-QUALIFIED pair
-- ('comms.project_messages' / 'comms.dm_messages') that the CHECK constraints on
-- those four tables use — NOT the bare 'project'/'dm' pair comms.channel_files
-- uses for the same concept. Two vocabularies for one idea inside one schema;
-- matching the wrong one returns false rather than erroring, which is why this is
-- written once.
--
-- An unrecognised discriminator returns FALSE, not NULL: a policy treats NULL as
-- "no", but returning it explicitly means a future third message table fails
-- closed and visibly rather than by accident.
-- =============================================================================
CREATE OR REPLACE FUNCTION comms.can_read_message(
    p_message_table text,
    p_message_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, comms, projects, org, auth
AS $$
DECLARE
    v_channel uuid;
    v_thread  uuid;
BEGIN
    IF p_message_id IS NULL THEN
        RETURN false;
    END IF;

    IF p_message_table = 'comms.project_messages' THEN
        SELECT channel_id INTO v_channel
        FROM comms.project_messages
        WHERE id = p_message_id AND deleted_at IS NULL;

        IF v_channel IS NULL THEN
            RETURN false;
        END IF;
        RETURN comms.has_channel_access(v_channel);
    END IF;

    IF p_message_table = 'comms.dm_messages' THEN
        SELECT thread_id INTO v_thread
        FROM comms.dm_messages
        WHERE id = p_message_id AND deleted_at IS NULL;

        IF v_thread IS NULL THEN
            RETURN false;
        END IF;
        RETURN comms.is_dm_participant(v_thread);
    END IF;

    RETURN false;
END;
$$;

COMMENT ON FUNCTION comms.can_read_message(text, uuid) IS
'True when the calling user may read the message identified by the polymorphic (message_table, message_id) pair — channel access for a project message, thread participation for a DM. SECURITY DEFINER so the policies on the interaction tables do not re-enter the policies on the message tables.';

-- =============================================================================
-- Group conversations — minting one, and adding people to an existing thread.
--
-- The write policies on comms.dm_threads / dm_participants are deliberately
-- ABSENT (00002012): who may open a thread and who may join one is decided
-- here, once, as SECURITY DEFINER, exactly as comms.get_or_create_dm_thread
-- already decides it for a DM. A client INSERT policy on dm_participants would
-- have to admit "a participant may add a row for somebody else", which is the
-- shape that lets anyone be added to anything; a definer function can check
-- the caller's membership first and then write the rows the policy could not.
--
-- Both refuse an anonymous caller explicitly. auth.uid() is NULL for anon, and
-- without the guard the NOT NULL on created_by_user_id would refuse the insert
-- anyway — but by constraint violation, which is the wrong sentence and, for
-- add_dm_thread_members, no refusal at all (nothing is NOT NULL there).
-- =============================================================================

-- A new group thread with the caller plus the given people. Members are
-- de-duplicated, the caller is never listed twice, and an id that names no
-- org.users_public row is dropped rather than left to fail the FK — the picker
-- offers only real people, so a phantom id is a stale client, not a request.
CREATE OR REPLACE FUNCTION comms.create_group_thread(
    p_title text,
    p_member_ids uuid[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, org, auth
AS $$
DECLARE
    v_me      uuid := auth.uid();
    v_thread  uuid;
    v_members uuid[];
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'create_group_thread: no acting user' USING ERRCODE = '42501';
    END IF;

    SELECT array_agg(DISTINCT m) INTO v_members
    FROM unnest(p_member_ids) AS m
    WHERE m IS NOT NULL
      AND m <> v_me
      AND EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = m);

    IF v_members IS NULL OR array_length(v_members, 1) < 1 THEN
        RAISE EXCEPTION 'A group needs at least one other person' USING ERRCODE = '22023';
    END IF;

    INSERT INTO comms.dm_threads (kind, title, created_by_user_id)
    VALUES ('group', NULLIF(btrim(p_title), ''), v_me)
    RETURNING id INTO v_thread;

    INSERT INTO comms.dm_participants (thread_id, user_id)
    SELECT v_thread, m FROM unnest(v_members || v_me) AS m;

    RETURN v_thread;
END;
$$;

COMMENT ON FUNCTION comms.create_group_thread(text, uuid[]) IS
'Mint a group thread (kind = group) containing the caller and the given users, in one transaction. SECURITY DEFINER because dm_threads/dm_participants carry no client INSERT policy on purpose; the membership decision is made here. A NULL/blank title is stored as NULL (a group may be unnamed).';

-- Add people to a thread the caller is an undeleted participant of. Returns
-- how many were actually added: already-present members are skipped, and a
-- member who had deleted the conversation for themselves is RESTORED rather
-- than duplicated — being added back by somebody is the one event that should
-- bring a conversation back into a person's inbox. A plain DM that gains a
-- third person becomes a group, because that is what the kind column exists to
-- record; a service inquiry keeps its kind.
CREATE OR REPLACE FUNCTION comms.add_dm_thread_members(
    p_thread_id uuid,
    p_member_ids uuid[]
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, org, auth
AS $$
DECLARE
    v_me       uuid := auth.uid();
    v_added    integer := 0;
    v_restored integer := 0;
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'add_dm_thread_members: no acting user' USING ERRCODE = '42501';
    END IF;

    IF NOT comms.is_dm_participant(p_thread_id) THEN
        RAISE EXCEPTION 'Not a participant of this conversation' USING ERRCODE = '42501';
    END IF;

    -- An entity channel's people are the entity's active members (comms.fn_sync_channel_member);
    -- joining the entity is the only way in.
    IF EXISTS (SELECT 1 FROM comms.dm_threads t WHERE t.id = p_thread_id AND t.kind = 'entity_channel') THEN
        RAISE EXCEPTION 'A channel''s members are its workspace''s members' USING ERRCODE = '22023';
    END IF;

    UPDATE comms.dm_participants p
    SET deleted_at = NULL
    WHERE p.thread_id = p_thread_id
      AND p.user_id = ANY (p_member_ids)
      AND p.user_id <> v_me
      AND p.deleted_at IS NOT NULL;
    GET DIAGNOSTICS v_restored = ROW_COUNT;

    INSERT INTO comms.dm_participants (thread_id, user_id)
    SELECT DISTINCT p_thread_id, m
    FROM unnest(p_member_ids) AS m
    WHERE m IS NOT NULL
      AND m <> v_me
      AND EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = m)
      AND NOT EXISTS (
          SELECT 1 FROM comms.dm_participants p
          WHERE p.thread_id = p_thread_id AND p.user_id = m
      );
    GET DIAGNOSTICS v_added = ROW_COUNT;

    IF v_added + v_restored > 0 THEN
        UPDATE comms.dm_threads t
        SET kind = 'group'
        WHERE t.id = p_thread_id
          AND t.kind = 'dm'
          AND (SELECT count(*) FROM comms.dm_participants p WHERE p.thread_id = p_thread_id) > 2;
    END IF;

    RETURN v_added + v_restored;
END;
$$;

-- Set (or, with NULL, clear) a GROUP's photo. Any participant may: a group's picture is shared
-- furniture, like its name. The file must be a processed public profile-style rendition the CALLER
-- owns (the server cut it from the caller's own library, in the `avatars` bucket) — the same proof
-- org.set_profile_avatar demands, so a client cannot point a thread at somebody else's file. The
-- photo it replaces is soft-deleted, exactly as a replaced profile photo is.
CREATE OR REPLACE FUNCTION comms.set_group_photo(
    p_thread_id uuid,
    p_file_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_me   uuid := auth.uid();
    v_kind comms.conversation_kind;
    v_prev uuid;
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'set_group_photo: no acting user' USING ERRCODE = '42501';
    END IF;

    IF NOT comms.is_dm_participant(p_thread_id) THEN
        RAISE EXCEPTION 'Not a participant of this conversation' USING ERRCODE = '42501';
    END IF;

    SELECT t.kind, t.photo_file_id INTO v_kind, v_prev
    FROM comms.dm_threads t WHERE t.id = p_thread_id
    FOR UPDATE;

    IF v_kind IS DISTINCT FROM 'group'::comms.conversation_kind
       AND v_kind IS DISTINCT FROM 'entity_channel'::comms.conversation_kind THEN
        RAISE EXCEPTION 'Only a group conversation or a channel has its own photo' USING ERRCODE = '22023';
    END IF;

    -- A channel's photo is part of its identity, so it follows the edit right (Decision #308) rather
    -- than a group's any-participant rule.
    IF v_kind = 'entity_channel'::comms.conversation_kind
       AND NOT comms.fn_can_manage_entity_channel(p_thread_id, v_me) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'channel: only the person who added it, or someone who manages settings, can change it';
    END IF;

    IF p_file_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM files.items i
        WHERE i.id = p_file_id
          AND i.purpose = 'avatar'::files.asset_purpose
          AND i.bucket_id = 'avatars'
          AND i.visibility = 'public'::files.file_visibility
          AND i.status = 'uploaded'::files.file_status
          AND i.deleted_at IS NULL
          AND i.owner_type = 'user'::files.owner_kind
          AND i.owner_user_id = v_me
    ) THEN
        RAISE EXCEPTION 'file: not a processed photo of yours' USING ERRCODE = '22023';
    END IF;

    UPDATE comms.dm_threads SET photo_file_id = p_file_id WHERE id = p_thread_id;

    IF v_prev IS NOT NULL AND v_prev IS DISTINCT FROM p_file_id THEN
        UPDATE files.items SET deleted_at = now()
        WHERE id = v_prev AND purpose = 'avatar'::files.asset_purpose AND deleted_at IS NULL;
    END IF;

    RETURN jsonb_build_object('ok', true, 'file_id', p_file_id, 'previous', v_prev);
END;
$$;

COMMENT ON FUNCTION comms.set_group_photo(uuid, uuid) IS
'Set or clear (NULL) a group conversation''s or an entity channel''s photo. Any undeleted participant of a group may; a channel''s creator or a manage_settings holder for a channel (Decision #308); the file must be a processed public avatars-bucket rendition owned by the caller. SECURITY DEFINER because dm_threads carries no client UPDATE policy; the previous photo is soft-deleted.';

COMMENT ON FUNCTION comms.add_dm_thread_members(uuid, uuid[]) IS
'Add users to a thread the caller participates in; returns the number added (restored self-deletions included). Converts a plain DM with a third participant into a group. SECURITY DEFINER for the same reason as create_group_thread.';

-- =============================================================================
-- Inbox folders and hiring requests.
--
-- `comms.dm_participants.inbox_folder` is per-participant state with no client UPDATE policy, for the
-- reason the SELECT policy is own-row-only: a policy wide enough to write it would also reach
-- `last_read_at` and `deleted_at`. The two doors below each touch exactly one thing.
-- =============================================================================

-- Move a conversation between the caller's own folders (Primary · Requests · Archived). Refusals use
-- the '<field>: <reason>' 22023 / 42501 shape the fat service maps to 422 / 403.
CREATE OR REPLACE FUNCTION comms.set_dm_inbox_folder(
    p_thread_id uuid,
    p_folder text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, auth
AS $$
DECLARE
    v_me uuid := auth.uid();
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'set_dm_inbox_folder: no acting user' USING ERRCODE = '42501';
    END IF;
    IF p_folder IS NULL OR p_folder NOT IN ('primary', 'requests', 'archived') THEN
        RAISE EXCEPTION 'folder: not_a_folder' USING ERRCODE = '22023';
    END IF;

    UPDATE comms.dm_participants p
    SET inbox_folder = p_folder
    WHERE p.thread_id = p_thread_id
      AND p.user_id = v_me
      AND p.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Not a participant of this conversation' USING ERRCODE = '42501';
    END IF;

    RETURN p_folder;
END;
$$;

COMMENT ON FUNCTION comms.set_dm_inbox_folder(uuid, text) IS
'Set the caller''s own inbox folder (primary | requests | archived) for a thread they are an undeleted participant of. SECURITY DEFINER because dm_participants carries no client UPDATE policy.';

-- Star or unstar a conversation for the caller only (the /saved system, Decision #180). Idempotent:
-- setting the state it already has succeeds.
CREATE OR REPLACE FUNCTION comms.set_dm_starred(
    p_thread_id uuid,
    p_starred boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, auth
AS $$
DECLARE
    v_me uuid := auth.uid();
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'set_dm_starred: no acting user' USING ERRCODE = '42501';
    END IF;
    IF p_starred IS NULL THEN
        RAISE EXCEPTION 'starred: required' USING ERRCODE = '22023';
    END IF;

    UPDATE comms.dm_participants p
    SET is_starred = p_starred
    WHERE p.thread_id = p_thread_id
      AND p.user_id = v_me
      AND p.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Not a participant of this conversation' USING ERRCODE = '42501';
    END IF;

    RETURN p_starred;
END;
$$;

COMMENT ON FUNCTION comms.set_dm_starred(uuid, boolean) IS
'Set the caller''s own star on a thread they are an undeleted participant of. SECURITY DEFINER because dm_participants carries no client UPDATE policy.';

-- Mute or unmute a conversation for the caller only (Decision #308): the participant row's `is_muted`,
-- which the inbox and the channel header read. Idempotent, as set_dm_starred is.
CREATE OR REPLACE FUNCTION comms.set_dm_muted(
    p_thread_id uuid,
    p_muted boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, auth
AS $$
DECLARE
    v_me uuid := auth.uid();
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'set_dm_muted: no acting user' USING ERRCODE = '42501';
    END IF;
    IF p_muted IS NULL THEN
        RAISE EXCEPTION 'muted: required' USING ERRCODE = '22023';
    END IF;

    UPDATE comms.dm_participants p
    SET is_muted = p_muted
    WHERE p.thread_id = p_thread_id
      AND p.user_id = v_me
      AND p.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Not a participant of this conversation' USING ERRCODE = '42501';
    END IF;

    RETURN p_muted;
END;
$$;

COMMENT ON FUNCTION comms.set_dm_muted(uuid, boolean) IS
'Set the caller''s own mute on a thread they are an undeleted participant of (Decision #308). SECURITY DEFINER because dm_participants carries no client UPDATE policy.';

-- Post the opening message of a hiring request into the pair's DM, opening the thread if there is
-- none. The caller must hold an OPEN engagement with the recipient on `p_project_id` — a pending
-- invitation they issued, or a pending application of theirs to the recipient's project — so the
-- Requests folder cannot be used to file arbitrary messages into a stranger's inbox.
--
-- Routing applies only to a thread this request effectively OPENS (created now, holding no message
-- yet, or restored from the recipient's own deletion): the sender keeps it in Primary and the
-- recipient gets it in Requests unless the two follow each other. A conversation already under way
-- is never re-filed. The message carries `p_project_id`, so comms.tg_mask_dm_message_pii masks it
-- while that project is protected.
CREATE OR REPLACE FUNCTION comms.send_request_message(
    p_recipient uuid,
    p_body text,
    p_project_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, projects, org, auth
AS $$
DECLARE
    v_me       uuid := auth.uid();
    v_body     text := btrim(COALESCE(p_body, ''));
    v_thread   uuid;
    v_opens    boolean := false;
    v_restored integer := 0;
    v_mutual   boolean;
    v_routed   text;
    v_message  uuid;
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'send_request_message: no acting user' USING ERRCODE = '42501';
    END IF;
    IF p_recipient IS NULL OR p_recipient = v_me THEN
        RAISE EXCEPTION 'recipient: invalid' USING ERRCODE = '22023';
    END IF;
    IF v_body = '' THEN
        RAISE EXCEPTION 'message: required' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_body) > 4000 THEN
        RAISE EXCEPTION 'message: too_long' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM projects.project_invitations i
         WHERE i.project_id = p_project_id
           AND i.inviter_user_id = v_me
           AND i.target_user_id = p_recipient
           AND i.status = 'pending'
    ) AND NOT EXISTS (
        SELECT 1 FROM projects.project_applications a
          JOIN projects.projects p ON p.id = a.project_id
         WHERE a.project_id = p_project_id
           AND a.applicant_user_id = v_me
           AND p.owner_user_id = p_recipient
           AND a.status = 'pending'
    ) THEN
        RAISE EXCEPTION 'No open request to this person on that project' USING ERRCODE = '42501';
    END IF;

    SELECT t.id INTO v_thread
    FROM comms.dm_threads t
    JOIN comms.dm_participants p1 ON p1.thread_id = t.id AND p1.user_id = v_me
    JOIN comms.dm_participants p2 ON p2.thread_id = t.id AND p2.user_id = p_recipient
    WHERE t.kind IN ('dm', 'service_inquiry')
    ORDER BY t.created_at
    LIMIT 1;

    IF v_thread IS NULL THEN
        INSERT INTO comms.dm_threads (created_by_user_id)
        VALUES (v_me)
        RETURNING id INTO v_thread;

        INSERT INTO comms.dm_participants (thread_id, user_id)
        VALUES (v_thread, v_me), (v_thread, p_recipient);
        v_opens := true;
    ELSE
        -- A new request is the one event that should bring a conversation somebody deleted for
        -- themselves back into their inbox (the add_dm_thread_members rule).
        UPDATE comms.dm_participants p
        SET deleted_at = NULL
        WHERE p.thread_id = v_thread
          AND p.user_id = p_recipient
          AND p.deleted_at IS NOT NULL;
        GET DIAGNOSTICS v_restored = ROW_COUNT;

        UPDATE comms.dm_participants p
        SET deleted_at = NULL
        WHERE p.thread_id = v_thread
          AND p.user_id = v_me
          AND p.deleted_at IS NOT NULL;

        v_opens := v_restored > 0 OR NOT EXISTS (
            SELECT 1 FROM comms.dm_messages m
             WHERE m.thread_id = v_thread AND m.deleted_at IS NULL
        );
    END IF;

    IF v_opens THEN
        v_mutual := EXISTS (
            SELECT 1 FROM org.profile_follows f
             WHERE f.follower_user_id = v_me
               AND f.target_entity_type = 'user'
               AND f.target_entity_id = p_recipient
        ) AND EXISTS (
            SELECT 1 FROM org.profile_follows f
             WHERE f.follower_user_id = p_recipient
               AND f.target_entity_type = 'user'
               AND f.target_entity_id = v_me
        );
        v_routed := CASE WHEN v_mutual THEN 'primary' ELSE 'requests' END;

        UPDATE comms.dm_participants p
        SET inbox_folder = v_routed
        WHERE p.thread_id = v_thread AND p.user_id = p_recipient;

        UPDATE comms.dm_participants p
        SET inbox_folder = 'primary'
        WHERE p.thread_id = v_thread AND p.user_id = v_me;
    END IF;

    INSERT INTO comms.dm_messages (thread_id, sender_user_id, project_id, body)
    VALUES (v_thread, v_me, p_project_id, v_body)
    RETURNING id INTO v_message;

    RETURN jsonb_build_object(
        'thread_id', v_thread,
        'message_id', v_message,
        'opened', v_opens,
        'routed_to', v_routed
    );
END;
$$;

COMMENT ON FUNCTION comms.send_request_message(uuid, text, uuid) IS
'Post a hiring request''s opening message (an invitation''s intro or an application''s cover note) into the pair''s DM, opening it if needed. A thread the request opens is filed in the recipient''s Requests folder unless the two follow each other; the sender keeps it in Primary. Requires an open invitation or application between the two on p_project_id.';

-- #region Auto-replies (Settings → Messaging)
-- Is a person in a status an auto-reply answers during? Every condition is DERIVED from what the
-- person already keeps, never asserted (Decision #149(C) — there is no hand-set presence):
--   away         notifications are paused (comms.notification_prefs.muted_until)
--   busy         inside a calendar event or a blackout on their own schedule
--   out_of_hours outside their published weekly working hours (no published hours, never matches)
--   holiday      the rule's own dates, which the caller's window test has already applied
-- PL/pgSQL, not SQL: the scheduling predicates it reads are created later (00001510), and a SQL body
-- is resolved at CREATE time while a PL/pgSQL one is resolved when it runs.
CREATE OR REPLACE FUNCTION comms.fn_auto_reply_status(p_user uuid, p_status text, p_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN CASE p_status
        WHEN 'away' THEN EXISTS (
            SELECT 1 FROM comms.notification_prefs np
             WHERE np.user_id = p_user AND np.muted_until > p_at
        )
        WHEN 'busy' THEN EXISTS (
            SELECT 1 FROM scheduling.schedules s
             WHERE s.owner_id = p_user AND s.owner_type IN ('user', 'freelancer')
               AND (scheduling.fn_has_conflicting_event(s.id, p_at, p_at + interval '1 minute')
                 OR scheduling.fn_is_blacked_out(s.id, p_at, p_at + interval '1 minute'))
        )
        WHEN 'out_of_hours' THEN EXISTS (
            SELECT 1 FROM scheduling.schedules s
             WHERE s.owner_id = p_user AND s.owner_type IN ('user', 'freelancer') AND s.is_published
               AND EXISTS (
                   SELECT 1 FROM scheduling.availability_rules r
                    WHERE r.schedule_id = s.id AND r.kind = 'working_hours' AND r.is_active
               )
               AND NOT scheduling.fn_band_covers(
                   s.id, 'working_hours'::scheduling.availability_kind, p_at, p_at + interval '1 minute')
        )
        WHEN 'holiday' THEN true
        ELSE false
    END;
END;
$$;

-- AFTER INSERT on comms.dm_messages: answer a human message in a one-to-one thread with the
-- recipient's best matching rule. Most specific first — a keyword, a named service, a hiring
-- invitation, any service request, a status, then a first-contact greeting — and each rule at most
-- once per thread per day. A product rule matches nothing yet: an inquiry carries no product.
--
-- Best effort by design: the person's own message has already been written, and an auto-reply that
-- cannot be sent must never take it down with it, so a failure is reported as a WARNING (server log)
-- and the insert stands.
CREATE OR REPLACE FUNCTION comms.tg_dm_auto_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_kind comms.conversation_kind;
    v_recipient uuid;
    v_invite boolean;
    v_first boolean;
    v_rule comms.auto_responses;
    v_now timestamptz := now();
BEGIN
    IF NEW.auto_response_id IS NOT NULL OR NEW.deleted_at IS NOT NULL THEN
        RETURN NULL;
    END IF;

    BEGIN
        SELECT t.kind INTO v_kind FROM comms.dm_threads t WHERE t.id = NEW.thread_id;
        IF NOT FOUND OR v_kind NOT IN ('dm', 'service_inquiry') THEN
            RETURN NULL;
        END IF;
        IF (SELECT count(*) FROM comms.dm_participants p WHERE p.thread_id = NEW.thread_id) <> 2 THEN
            RETURN NULL;
        END IF;
        SELECT p.user_id INTO v_recipient
          FROM comms.dm_participants p
         WHERE p.thread_id = NEW.thread_id AND p.user_id <> NEW.sender_user_id
         LIMIT 1;
        IF v_recipient IS NULL OR NOT EXISTS (
            SELECT 1 FROM comms.notification_prefs np
             WHERE np.user_id = v_recipient AND np.auto_responses_enabled
        ) THEN
            RETURN NULL;
        END IF;

        v_invite := NEW.project_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM projects.project_invitations i
             WHERE i.project_id = NEW.project_id AND i.inviter_user_id = NEW.sender_user_id
               AND i.target_user_id = v_recipient AND i.status = 'pending'
        );
        v_first := NOT EXISTS (
            SELECT 1 FROM comms.dm_messages m
             WHERE m.thread_id = NEW.thread_id AND m.sender_user_id = v_recipient
               AND m.auto_response_id IS NULL AND m.deleted_at IS NULL
        );

        SELECT r.* INTO v_rule
          FROM comms.auto_responses r
         WHERE r.user_id = v_recipient AND r.enabled AND btrim(r.message) <> ''
           AND (r.starts_at IS NULL OR r.starts_at <= v_now)
           AND (r.ends_at IS NULL OR r.ends_at > v_now)
           AND CASE r.trigger
               WHEN 'keyword' THEN strpos(lower(NEW.body), lower(r.keyword)) > 0
               WHEN 'service' THEN (NEW.service_id IS NOT NULL OR v_kind = 'service_inquiry')
                   AND (r.service_id IS NULL OR r.service_id = NEW.service_id)
               WHEN 'project_invitation' THEN v_invite
               WHEN 'status' THEN comms.fn_auto_reply_status(v_recipient, r.status_condition, v_now)
               WHEN 'any' THEN v_first
               ELSE false
           END
           AND NOT EXISTS (
               SELECT 1 FROM comms.dm_messages m
                WHERE m.thread_id = NEW.thread_id AND m.auto_response_id = r.id
                  AND m.created_at > v_now - interval '24 hours'
           )
         ORDER BY CASE
               WHEN r.trigger = 'keyword' THEN 0
               WHEN r.trigger = 'service' AND r.service_id IS NOT NULL THEN 1
               WHEN r.trigger = 'project_invitation' THEN 2
               WHEN r.trigger = 'service' THEN 3
               WHEN r.trigger = 'status' THEN 4
               ELSE 5
           END, r.created_at, r.id
         LIMIT 1;
        IF NOT FOUND THEN
            RETURN NULL;
        END IF;

        INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, auto_response_id)
        VALUES (NEW.thread_id, v_recipient, v_rule.message, v_rule.id);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'comms.tg_dm_auto_reply: thread % — % (%)', NEW.thread_id, SQLERRM, SQLSTATE;
    END;
    RETURN NULL;
END;
$$;
-- #endregion

-- #region Direct-message shielding for under-18 accounts (Decision #208)
-- UK Children's Code: a restricted (13–17) account is not messaged by — and does not message —
-- arbitrary people. A direct thread that includes a minor holds only people who follow each other.
-- Two triggers enforce it on every path: a participant row may join a thread only if it is allowed
-- with every participant already there (get_or_create_dm_thread, create_group_thread,
-- add_dm_thread_members, send_request_message all write participants), and a message may be sent
-- only while its sender is still allowed with every other participant (an unfollow ends it).
-- Project and stage channels are a separate table and unaffected; a minor is never on anyone
-- else's project anyway.
CREATE OR REPLACE FUNCTION comms.fn_is_mutual_follow(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM org.profile_follows f
         WHERE f.follower_user_id = p_a AND f.target_entity_type = 'user' AND f.target_entity_id = p_b
    ) AND EXISTS (
        SELECT 1 FROM org.profile_follows f
         WHERE f.follower_user_id = p_b AND f.target_entity_type = 'user' AND f.target_entity_id = p_a
    );
$$;

-- Whether two people may share a direct thread: always, unless one is a minor — then only when they
-- follow each other.
CREATE OR REPLACE FUNCTION comms.fn_dm_allowed(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_a = p_b
        OR NOT (org.fn_is_minor(p_a) OR org.fn_is_minor(p_b))
        OR comms.fn_is_mutual_follow(p_a, p_b);
$$;

CREATE OR REPLACE FUNCTION comms.trg_dm_shield()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_person uuid := (pg_catalog.to_jsonb(NEW) ->> CASE WHEN TG_TABLE_NAME = 'dm_messages' THEN 'sender_user_id' ELSE 'user_id' END)::uuid;
BEGIN
    -- An entity channel is not a direct thread: who is in it is the entity's roster, decided when they
    -- joined the entity, not a contact one person opened with another.
    IF EXISTS (SELECT 1 FROM comms.dm_threads t WHERE t.id = NEW.thread_id AND t.kind = 'entity_channel') THEN
        RETURN NEW;
    END IF;
    IF EXISTS (
        SELECT 1 FROM comms.dm_participants p
         WHERE p.thread_id = NEW.thread_id AND p.user_id <> v_person
           AND NOT comms.fn_dm_allowed(v_person, p.user_id)
    ) THEN
        RAISE EXCEPTION 'messages: people under 18 can message only people they follow who follow them back'
            USING ERRCODE = 'PM403';
    END IF;
    RETURN NEW;
END;
$$;
-- #endregion

-- #region Entity channels (Decision #306)
-- A team's or a business's named rooms (`# general`, `# delivery-sync`). A channel is a comms.dm_threads
-- row of kind `entity_channel`, so the /messages chat stack — the feed, the send path, read state,
-- attachments, reactions and every policy built on comms.is_dm_participant — serves it unchanged. What
-- differs is who is in it: never somebody a person added, always the owner's ACTIVE members, kept in
-- step by the triggers in 00001840. Leaving soft-deletes the participation (`deleted_at`), so the
-- history stays and the access ends; rejoining restores it on every live channel.
--
-- The two doors are SECURITY DEFINER for the reason create_group_thread is: dm_threads and
-- dm_participants carry no client write policy on purpose (00002012), and a channel's participant rows
-- are written for OTHER people (every member), which no INSERT policy may admit. Each re-checks the
-- caller's active membership itself. Refusals follow the workspace doors' '<field>: <reason>'
-- convention (packages/backend/services/workspace/live-support.ts refusalFrom).

-- The name a person typed, as a channel slug: trimmed, a leading `#` dropped, lowercased. The TS twin is
-- channelSlugOf (@projective/types/workspace channels.ts).
CREATE OR REPLACE FUNCTION comms.fn_channel_slug(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT lower(regexp_replace(btrim(COALESCE(p_name, '')), '^#+\s*', ''));
$$;

-- The user ids of an entity's active members who can hold a participant row (org.users_public).
CREATE OR REPLACE FUNCTION comms.fn_entity_member_ids(p_kind text, p_entity uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT m.user_id FROM org.team_members m
     WHERE p_kind = 'team' AND m.team_id = p_entity AND m.status = 'active'
       AND EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = m.user_id)
    UNION
    SELECT m.user_id FROM org.business_members m
     WHERE p_kind = 'business' AND m.business_id = p_entity AND m.status = 'active'
       AND EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = m.user_id);
$$;

-- Whether a person may edit or archive an entity channel (Decision #308): an active member who added it,
-- or one holding `manage_settings`. FALSE for anything that is not a live channel. Internal.
CREATE OR REPLACE FUNCTION comms.fn_can_manage_entity_channel(p_channel_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((
        SELECT EXISTS (SELECT 1 FROM org.fn_member_seat(t.owner_type, t.owner_entity_id, p_user))
           AND (t.created_by_user_id = p_user
                OR 'manage_settings'::org.workspace_capability
                   = ANY (org.fn_member_capabilities(t.owner_type, t.owner_entity_id, p_user)))
          FROM comms.dm_threads t
         WHERE t.id = p_channel_id AND t.kind = 'entity_channel' AND t.archived_at IS NULL
    ), false);
$$;

-- An entity's live channels as the console lists them for one viewer: the default first, then by slug,
-- each with the viewer's unread count (other people's messages after their read watermark; a NULL
-- watermark is "never opened", so every one) and the newest message's time, its display name, emoji and
-- photo, the viewer's own star and mute, and whether the viewer may edit it (Decision #308). Internal —
-- read by org.get_workspace_detail, which has already decided the viewer is an active member.
CREATE OR REPLACE FUNCTION comms.fn_entity_channel_list(p_kind text, p_entity uuid, p_viewer uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', t.id,
            'slug', t.slug,
            'name', t.title,
            'topic', t.topic,
            'emoji', t.emoji,
            'photo_file_id', t.photo_file_id,
            'starred', COALESCE(me.is_starred, false),
            'muted', COALESCE(me.is_muted, false),
            'can_manage', comms.fn_can_manage_entity_channel(t.id, p_viewer),
            'is_default', t.is_default,
            'unread', (SELECT count(*) FROM comms.dm_messages m
                        WHERE m.thread_id = t.id AND m.deleted_at IS NULL
                          AND m.sender_user_id <> p_viewer
                          AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)),
            'last_activity_at', (SELECT max(m.created_at) FROM comms.dm_messages m
                                  WHERE m.thread_id = t.id AND m.deleted_at IS NULL)
        ) ORDER BY t.is_default DESC, t.slug), '[]'::jsonb)
      FROM comms.dm_threads t
      LEFT JOIN comms.dm_participants me
             ON me.thread_id = t.id AND me.user_id = p_viewer AND me.deleted_at IS NULL
     WHERE t.kind = 'entity_channel' AND t.owner_type = p_kind AND t.owner_entity_id = p_entity
       AND t.archived_at IS NULL;
$$;

-- The entity's default `general` channel, created when it is missing; its id either way. NULL when the
-- creator has no org.users_public row to stand as the thread's author (the entity is still created).
CREATE OR REPLACE FUNCTION comms.fn_ensure_default_channel(p_kind text, p_entity uuid, p_creator uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT t.id INTO v_id FROM comms.dm_threads t
     WHERE t.kind = 'entity_channel' AND t.owner_type = p_kind AND t.owner_entity_id = p_entity
       AND t.is_default;
    IF v_id IS NOT NULL THEN
        RETURN v_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = p_creator) THEN
        RETURN NULL;
    END IF;
    INSERT INTO comms.dm_threads (kind, owner_type, owner_entity_id, slug, is_default, created_by_user_id)
    VALUES ('entity_channel', p_kind, p_entity, 'general', true, p_creator)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- Put one person into, or take them out of, every channel of an entity. Joining restores a participation
-- they had and adds the rest, on LIVE channels only; leaving soft-deletes it on every channel, archived
-- ones included, so no channel of an entity they left stays readable.
CREATE OR REPLACE FUNCTION comms.fn_sync_channel_member(
    p_kind text,
    p_entity uuid,
    p_user uuid,
    p_active boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_active THEN
        UPDATE comms.dm_participants p
           SET deleted_at = NULL
          FROM comms.dm_threads t
         WHERE p.thread_id = t.id AND p.user_id = p_user AND p.deleted_at IS NOT NULL
           AND t.kind = 'entity_channel' AND t.owner_type = p_kind AND t.owner_entity_id = p_entity
           AND t.archived_at IS NULL;
        INSERT INTO comms.dm_participants (thread_id, user_id)
        SELECT t.id, p_user FROM comms.dm_threads t
         WHERE t.kind = 'entity_channel' AND t.owner_type = p_kind AND t.owner_entity_id = p_entity
           AND t.archived_at IS NULL
           AND EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = p_user)
           AND NOT EXISTS (
               SELECT 1 FROM comms.dm_participants p WHERE p.thread_id = t.id AND p.user_id = p_user
           );
    ELSE
        UPDATE comms.dm_participants p
           SET deleted_at = now()
          FROM comms.dm_threads t
         WHERE p.thread_id = t.id AND p.user_id = p_user AND p.deleted_at IS NULL
           AND t.kind = 'entity_channel' AND t.owner_type = p_kind AND t.owner_entity_id = p_entity;
    END IF;
END;
$$;

-- AFTER INSERT on comms.dm_threads, entity channels only: every active member of the owner joins.
CREATE OR REPLACE FUNCTION comms.tg_entity_channel_seed_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO comms.dm_participants (thread_id, user_id)
    SELECT NEW.id, m.user_id
      FROM comms.fn_entity_member_ids(NEW.owner_type, NEW.owner_entity_id) AS m(user_id)
     WHERE NOT EXISTS (
         SELECT 1 FROM comms.dm_participants p WHERE p.thread_id = NEW.id AND p.user_id = m.user_id
     );
    RETURN NULL;
END;
$$;

-- AFTER INSERT OR UPDATE OF status on org.team_members / org.business_members (TG_ARGV[0] = the kind):
-- a membership that becomes active joins the entity's channels, one that stops being active leaves them.
CREATE OR REPLACE FUNCTION comms.tg_entity_member_channels()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_kind text := TG_ARGV[0];
    v_entity uuid := (to_jsonb(NEW) ->> CASE WHEN TG_ARGV[0] = 'team' THEN 'team_id' ELSE 'business_id' END)::uuid;
    v_was boolean := false;
    v_is boolean := NEW.status = 'active';
BEGIN
    IF TG_OP = 'UPDATE' THEN
        v_was := OLD.status = 'active';
    END IF;
    IF v_is IS DISTINCT FROM v_was THEN
        PERFORM comms.fn_sync_channel_member(v_kind, v_entity, NEW.user_id, v_is);
    END IF;
    RETURN NULL;
END;
$$;

-- AFTER INSERT on org.teams / org.business_profiles (TG_ARGV[0] = the kind): the entity's `general`.
CREATE OR REPLACE FUNCTION comms.tg_entity_default_channel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM comms.fn_ensure_default_channel(TG_ARGV[0], NEW.id, NEW.owner_user_id);
    RETURN NULL;
END;
$$;

-- A new channel, by an active member of a team or business that is not archived. Returns the channel as
-- the console lists it. Caps an entity at 30 live channels (CHANNEL_LIVE_CAP); the count and the insert
-- run under a per-entity advisory lock so two concurrent creates cannot both take the last place.
CREATE OR REPLACE FUNCTION comms.create_entity_channel(
    p_entity_type text,
    p_entity_id uuid,
    p_name text,
    p_topic text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_status text;
    v_slug text := comms.fn_channel_slug(p_name);
    v_topic text := NULLIF(btrim(COALESCE(p_topic, '')), '');
    v_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_entity_type IS NULL OR p_entity_type NOT IN ('team', 'business') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kind: choose a team or a business';
    END IF;
    v_status := CASE p_entity_type
        WHEN 'team' THEN (SELECT t.status FROM org.teams t WHERE t.id = p_entity_id)
        ELSE (SELECT b.status FROM org.business_profiles b WHERE b.id = p_entity_id) END;
    IF v_status IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workspace: not found';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org.fn_member_seat(p_entity_type, p_entity_id, v_uid)) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'workspace: only its members can add a channel';
    END IF;
    IF v_status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'workspace: restore it before adding a channel';
    END IF;
    IF char_length(v_slug) < 2 OR char_length(v_slug) > 40 OR v_slug !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'name: use 2 to 40 lowercase letters, numbers or hyphens, starting and ending with a letter or number';
    END IF;
    IF v_topic IS NOT NULL AND char_length(v_topic) > 200 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'topic: keep it to 200 characters';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('comms.entity_channels:' || p_entity_id::text));
    IF EXISTS (
        SELECT 1 FROM comms.dm_threads t
         WHERE t.kind = 'entity_channel' AND t.owner_type = p_entity_type AND t.owner_entity_id = p_entity_id
           AND t.archived_at IS NULL AND t.slug = v_slug
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'name: there is already a #' || v_slug || ' channel';
    END IF;
    IF (SELECT count(*) FROM comms.dm_threads t
         WHERE t.kind = 'entity_channel' AND t.owner_type = p_entity_type AND t.owner_entity_id = p_entity_id
           AND t.archived_at IS NULL) >= 30 THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'channel: a workspace holds at most 30 channels — archive one to make room';
    END IF;

    INSERT INTO comms.dm_threads (kind, owner_type, owner_entity_id, slug, topic, created_by_user_id)
    VALUES ('entity_channel', p_entity_type, p_entity_id, v_slug, v_topic, v_uid)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'id', v_id,
        'slug', v_slug,
        'name', NULL,
        'topic', v_topic,
        'emoji', NULL,
        'photo_file_id', NULL,
        'starred', false,
        'muted', false,
        'can_manage', true,
        'is_default', false,
        'unread', 0,
        'last_activity_at', NULL
    );
END;
$$;

-- Archive a channel: its creator, or a member holding `manage_settings`. The default channel never is.
-- A channel the caller cannot see (not an active member, already archived, not a channel at all) is one
-- answer — not found — so the door cannot be used to probe ids.
CREATE OR REPLACE FUNCTION comms.archive_entity_channel(p_channel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_t record;
    v_at timestamptz := now();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    SELECT t.id, t.owner_type, t.owner_entity_id, t.is_default, t.created_by_user_id, t.archived_at
      INTO v_t
      FROM comms.dm_threads t
     WHERE t.id = p_channel_id AND t.kind = 'entity_channel'
       FOR UPDATE;
    IF v_t.id IS NULL OR v_t.archived_at IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM org.fn_member_seat(v_t.owner_type, v_t.owner_entity_id, v_uid)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'channel: not found';
    END IF;
    IF v_t.is_default THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'channel: the default channel stays — every member is in it';
    END IF;
    IF v_t.created_by_user_id <> v_uid
       AND NOT ('manage_settings'::org.workspace_capability
                = ANY (org.fn_member_capabilities(v_t.owner_type, v_t.owner_entity_id, v_uid))) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'channel: only the person who added it, or someone who manages settings, can archive it';
    END IF;

    UPDATE comms.dm_threads SET archived_at = v_at WHERE id = v_t.id;

    RETURN jsonb_build_object(
        'id', v_t.id,
        'owner_type', v_t.owner_type,
        'owner_entity_id', v_t.owner_entity_id,
        'archived_at', v_at
    );
END;
$$;

-- Edit a channel's display name, topic and emoji (Decision #308): its creator, or a member holding
-- `manage_settings`, on an entity that is not archived. Every field is replaced — NULL or blank clears
-- it — and the slug is never touched, so the channel keeps its address. The default channel may be
-- renamed like any other. A channel the caller cannot see is one answer, not found, as on archive.
CREATE OR REPLACE FUNCTION comms.update_entity_channel(
    p_channel_id uuid,
    p_name text,
    p_topic text,
    p_emoji text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_t record;
    v_status text;
    v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
    v_topic text := NULLIF(btrim(COALESCE(p_topic, '')), '');
    v_emoji text := NULLIF(btrim(COALESCE(p_emoji, '')), '');
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    SELECT t.id, t.owner_type, t.owner_entity_id, t.slug, t.archived_at
      INTO v_t
      FROM comms.dm_threads t
     WHERE t.id = p_channel_id AND t.kind = 'entity_channel'
       FOR UPDATE;
    IF v_t.id IS NULL OR v_t.archived_at IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM org.fn_member_seat(v_t.owner_type, v_t.owner_entity_id, v_uid)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'channel: not found';
    END IF;
    IF NOT comms.fn_can_manage_entity_channel(v_t.id, v_uid) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'channel: only the person who added it, or someone who manages settings, can edit it';
    END IF;
    v_status := CASE v_t.owner_type
        WHEN 'team' THEN (SELECT e.status FROM org.teams e WHERE e.id = v_t.owner_entity_id)
        ELSE (SELECT e.status FROM org.business_profiles e WHERE e.id = v_t.owner_entity_id) END;
    IF v_status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'workspace: restore it before editing a channel';
    END IF;
    IF v_name IS NOT NULL AND char_length(v_name) > 60 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'name: keep it to 60 characters';
    END IF;
    IF v_topic IS NOT NULL AND char_length(v_topic) > 200 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'topic: keep it to 200 characters';
    END IF;
    IF v_emoji IS NOT NULL AND char_length(v_emoji) > 16 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'emoji: choose a single emoji';
    END IF;

    UPDATE comms.dm_threads
       SET title = v_name, topic = v_topic, emoji = v_emoji
     WHERE id = v_t.id;

    RETURN jsonb_build_object(
        'id', v_t.id,
        'slug', v_t.slug,
        'name', v_name,
        'topic', v_topic,
        'emoji', v_emoji
    );
END;
$$;

COMMENT ON FUNCTION comms.update_entity_channel(uuid, text, text, text) IS
'Replace an entity channel''s display name (title, <= 60), topic (<= 200) and emoji (<= 16); blank clears. The creator or a manage_settings holder on a non-archived entity; the slug never changes. A channel the caller cannot see is P0002. SECURITY DEFINER because dm_threads carries no client UPDATE policy (Decision #308).';

COMMENT ON FUNCTION comms.fn_can_manage_entity_channel(uuid, uuid) IS
'Whether a user may edit or archive a live entity channel: an active member who created it, or one holding manage_settings (Decision #308). Internal.';

COMMENT ON FUNCTION comms.create_entity_channel(text, uuid, text, text) IS
'Create a channel (kind entity_channel) on a team or business the caller is an active member of. Name normalised by comms.fn_channel_slug and held to 2-40 of [a-z0-9-]; a duplicate live slug is 23505, more than 30 live channels 55000, an archived entity 55000. Participants are seeded by trigger. SECURITY DEFINER because dm_threads/dm_participants carry no client write policy (Decision #306).';

COMMENT ON FUNCTION comms.archive_entity_channel(uuid) IS
'Archive an entity channel (archived_at; never deleted). The creator or a manage_settings holder; the default channel is refused (55000); a channel the caller cannot see is P0002. SECURITY DEFINER because dm_threads carries no client UPDATE policy (Decision #306).';
-- #endregion
