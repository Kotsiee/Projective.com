-- ============================================================================
-- 00001300 functions comms channels
-- Consolidated verbatim from: 0113_get_or_create_dm_thread.sql, 0311_e7_private_channels_pii_handover.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION comms.get_or_create_dm_thread(
    target_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, org, auth
AS $$
DECLARE
    v_current_user_id uuid := auth.uid();
    v_thread_id uuid;
BEGIN
    
    SELECT t.id INTO v_thread_id
    FROM comms.dm_threads t
    JOIN comms.dm_participants p1 ON p1.thread_id = t.id AND p1.user_id = v_current_user_id
    JOIN comms.dm_participants p2 ON p2.thread_id = t.id AND p2.user_id = target_user_id
    LIMIT 1;

    IF v_thread_id IS NOT NULL THEN
        RETURN v_thread_id;
    END IF;

    
    INSERT INTO comms.dm_threads (created_by_user_id)
    VALUES (v_current_user_id)
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
    SELECT ps.project_id, ps.name INTO v_project, v_stage_name
    FROM projects.project_stages ps WHERE ps.id = p_stage_id;

    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Stage not found.' USING ERRCODE = 'no_data_found';
    END IF;

    IF NOT projects.has_stage_access(p_stage_id) THEN
        RAISE EXCEPTION 'You do not have access to this stage workspace.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    FOREACH v_scope IN ARRAY v_scopes LOOP
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
        NEW.pii_masked := true;
        NEW.pii_categories := v_cats;
    END IF;

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
