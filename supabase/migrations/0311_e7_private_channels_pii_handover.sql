-- =============================================================================================
-- 0311_e7_private_channels_pii_handover.sql
-- Epic E7 (Collaboration & Communications) — the remaining privacy / platform-integrity layer.
--
-- Three features land together because they share the same access + lifecycle spine:
--
--   1. Team & Business PRIVATE CHANNELS. A stage room is split into three scoped channels driven by
--      comms.project_channels.visibility:
--        • 'stage_all'        → the whole stage roster (client + assigned talent) — the General room.
--        • 'team_private'     → only the assigned talent (freelancer/active team member on the stage).
--        • 'business_private' → only the client side (owner + active client-business member) — i.e.
--          "verified business members" = an active org.business_members row (can_review_project).
--      Access is centralised in comms.can_access_scope / comms.has_channel_access and enforced by RLS
--      on both project_channels and project_messages, so a private channel can never leak over the
--      realtime WAL stream (the SSE subscribe route gates on the same RLS SELECT).
--
--   2. The PII FILTER & PROTECTED PHASE (anti-disintermediation). While a project is in its protected
--      phase (projects.handover_unlocked_at IS NULL) a BEFORE INSERT trigger masks emails, external
--      phone numbers and third-party payment links/handles out of every stage message and flags the
--      row (pii_masked / pii_categories). Enforced in SQL so it cannot be bypassed via direct PostgREST
--      — the @projective/backend PIIFilter mirrors it for instant UX. (brain.md §Messaging.)
--
--   3. The "PROJECTIVE UNLOCK" HANDOVER STATE. When the final escrow releases (projects.approve_stage
--      settles the last stage) or a project is force-completed, projects.handover_unlocked_at is set:
--      the protected phase ends, the PII filter switches off and the full file library unlocks for the
--      "Contact Handover".
--
-- Runs after 0202/0305/0308 so these DROP/CREATE statements win over the earlier definitions.
-- SECURITY DEFINER wrappers in the exposed schemas, guarded internally, per the sibling RPCs.
-- =============================================================================================

-- #region 1. Handover / protected-phase state on the project
ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS handover_unlocked_at timestamptz;

COMMENT ON COLUMN projects.projects.handover_unlocked_at IS
    'Set when the final escrow releases (or the project completes). NULL = protected phase active '
    '(PII filter on, file library locked); non-NULL = the Projective Unlock has fired.';

-- TRUE while the project is still in its protected phase (before the Projective Unlock). Defaults to
-- TRUE for an unknown project id so the filter fails safe (masks) rather than open.
CREATE OR REPLACE FUNCTION projects.is_protected_phase(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, projects
AS $$
    SELECT COALESCE(
        (SELECT handover_unlocked_at IS NULL FROM projects.projects WHERE id = p_project_id),
        true
    );
$$;

-- Belt-and-braces: a project force-completed through projects.set_project_status (0119) also lifts
-- the protected phase, keeping is_protected_phase consistent with the project lifecycle.
CREATE OR REPLACE FUNCTION projects.tg_project_handover_on_complete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'completed'::project_status AND NEW.handover_unlocked_at IS NULL THEN
        NEW.handover_unlocked_at := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_handover_on_complete ON projects.projects;
CREATE TRIGGER trg_project_handover_on_complete
    BEFORE UPDATE OF status ON projects.projects
    FOR EACH ROW
    WHEN (NEW.status = 'completed'::project_status)
    EXECUTE FUNCTION projects.tg_project_handover_on_complete();
-- #endregion

-- #region 2. Scoped-channel access model
-- Normalise legacy stage rooms (created lazily with the 'project_all' default) to the General scope.
UPDATE comms.project_channels
SET visibility = 'stage_all'
WHERE stage_id IS NOT NULL AND visibility = 'project_all';

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
-- #endregion

-- #region 3. Scope-aware channel opener (supersedes the 3-arg opener from 0308)
-- Adding the visibility argument would create an overload rather than replace, so drop first.
DROP FUNCTION IF EXISTS comms.get_or_create_project_channel(uuid, uuid, text);
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

GRANT EXECUTE ON FUNCTION comms.can_access_scope(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION comms.has_channel_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION comms.get_stage_channels(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION projects.is_protected_phase(uuid) TO authenticated;
-- #endregion

-- #region 4. Scope-aware comms RLS (supersedes the stage-level policies in 0308)
DROP POLICY IF EXISTS "view_channels_if_member" ON comms.project_channels;
CREATE POLICY "view_channels_if_member" ON comms.project_channels FOR SELECT TO authenticated
USING (comms.has_channel_access (id));

DROP POLICY IF EXISTS "send_messages_if_member" ON comms.project_messages;
CREATE POLICY "send_messages_if_member" ON comms.project_messages FOR INSERT TO authenticated
WITH CHECK (comms.has_channel_access (channel_id));

DROP POLICY IF EXISTS "view_messages_if_member" ON comms.project_messages;
CREATE POLICY "view_messages_if_member" ON comms.project_messages FOR SELECT TO authenticated
USING (comms.has_channel_access (channel_id));

-- Attachments follow the same channel gate (project messages) / DM participation (DMs).
DROP POLICY IF EXISTS "view_attachments_if_member" ON comms.message_attachments;
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
-- #endregion

-- #region 5. PII filter — mask contact info during the protected phase
ALTER TABLE comms.project_messages
    ADD COLUMN IF NOT EXISTS pii_masked boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS pii_categories text[] NOT NULL DEFAULT '{}'::text[];

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

DROP TRIGGER IF EXISTS trg_mask_message_pii ON comms.project_messages;
CREATE TRIGGER trg_mask_message_pii
    BEFORE INSERT ON comms.project_messages
    FOR EACH ROW
    EXECUTE FUNCTION comms.tg_mask_message_pii();
-- #endregion

-- #region 6. Projective Unlock — fire the handover when the final escrow releases
-- Re-creates projects.approve_stage (0305) verbatim, then appends the handover transition: once no
-- stage of the project remains unsettled, the last escrow has just been released, so the protected
-- phase is lifted for the whole project and every participant is notified of the Contact Handover.
CREATE OR REPLACE FUNCTION projects.approve_stage(p_project_id uuid, p_stage_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_currency text;
    v_stage_name text;
    t record;
    a record;
    v_released int := 0;
    v_paid bigint := 0;
    v_fee bigint := 0;
    v_splits jsonb;
    v_unlocked boolean := false;
BEGIN
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized for this project.' USING ERRCODE = '42501';
    END IF;

    SELECT ps.name, p.currency INTO v_stage_name, v_currency
    FROM projects.project_stages ps
    JOIN projects.projects p ON p.id = ps.project_id
    WHERE ps.id = p_stage_id AND ps.project_id = p_project_id;

    IF v_stage_name IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.';
    END IF;

    -- Release every held escrow for this stage's tickets. fn_release_ticket_escrow applies the
    -- 5% platform fee (AC2) and routes team payees through fn_split_team_payout (AC3).
    FOR t IN
        SELECT DISTINCT ticket_id
        FROM finance.escrows
        WHERE project_stage_id = p_stage_id AND status = 'held' AND ticket_id IS NOT NULL
    LOOP
        PERFORM finance.fn_release_ticket_escrow(t.ticket_id);
        v_released := v_released + 1;
    END LOOP;

    IF v_released = 0 THEN
        RAISE EXCEPTION 'No funded (held) escrow to release for this stage.';
    END IF;

    SELECT COALESCE(SUM(amount_cents + deadline_bonus_cents - platform_fee_cents), 0),
           COALESCE(SUM(platform_fee_cents), 0)
    INTO v_paid, v_fee
    FROM finance.escrows
    WHERE project_stage_id = p_stage_id AND status = 'released';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'member_user_id', psp.member_user_id,
        'amount_cents', psp.amount_cents,
        'currency', psp.currency)), '[]'::jsonb)
    INTO v_splits
    FROM finance.payout_splits psp
    JOIN finance.escrows e ON e.id = psp.escrow_id
    WHERE e.project_stage_id = p_stage_id;

    UPDATE projects.project_stages
    SET status = 'paid'::stage_status, completed_at = now()
    WHERE id = p_stage_id;

    FOR a IN
        SELECT DISTINCT current_assignee_id AS uid
        FROM projects.tickets
        WHERE current_stage_id = p_stage_id AND current_assignee_id IS NOT NULL
    LOOP
        PERFORM comms.fn_notify(
            a.uid, 'stage_approved', 'Stage approved & paid',
            format('"%s" was approved — your payout has been released.', v_stage_name),
            'project_stages', p_stage_id
        );
    END LOOP;

    -- ── Projective Unlock (E7 handover) ──────────────────────────────────────────────────────────
    -- If no stage remains unsettled, the final escrow has just been released: lift the protected phase
    -- for the whole project (disables the PII filter, unlocks the full file library — the "Contact
    -- Handover", brain.md §Messaging) and notify everyone who took part.
    IF NOT EXISTS (
        SELECT 1 FROM projects.project_stages
        WHERE project_id = p_project_id
            AND status NOT IN ('paid'::stage_status, 'cancelled'::stage_status)
    ) THEN
        UPDATE projects.projects
        SET handover_unlocked_at = now()
        WHERE id = p_project_id AND handover_unlocked_at IS NULL;

        IF FOUND THEN
            v_unlocked := true;
            FOR a IN
                SELECT DISTINCT pm.sender_user_id AS uid
                FROM comms.project_messages pm
                JOIN comms.project_channels pc ON pc.id = pm.channel_id
                WHERE pc.project_id = p_project_id
                UNION
                SELECT p.owner_user_id FROM projects.projects p WHERE p.id = p_project_id
            LOOP
                PERFORM comms.fn_notify(
                    a.uid, 'project_handover', 'Projective Unlock',
                    'This project is complete — contact sharing is unlocked and every file is ready to download.',
                    'projects', p_project_id
                );
            END LOOP;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'released_count', v_released,
        'total_paid_cents', v_paid,
        'fee_cents', v_fee,
        'splits', v_splits,
        'stage_status', 'paid',
        'handover_unlocked', v_unlocked
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, comms, security, org;
-- #endregion
