-- =============================================================================================
-- 00001135 · projects — membership writes from the Members tab
--
--   1. projects.set_member_role      — the owner/client side changes a participant's role
--   2. projects.invite_by_email      — an email-addressed project (or stage) invitation
--
-- Both are SECURITY DEFINER for the reason every staffing write in 00001130 is: the row change and
-- the record of it (`security.audit_logs`, definer-only; `comms.fn_notify`, service-role-only) must
-- commit in ONE transaction, and neither table is reachable from the `authenticated` role.
--
-- `anon` holds USAGE on `projects` (00002500, Decision #85(e)) and a new function is EXECUTE-able by
-- PUBLIC by default, so each function refuses a NULL `auth.uid()` FIRST and its EXECUTE is narrowed to
-- `authenticated` in 00002510 ("membership doors").
-- =============================================================================================

-- #region 1. set_member_role
-- projects.set_member_role(project, participant, role) -> jsonb
--
-- Authority is REVIEW authority (`projects.can_review_project` — the owner, or an active member of
-- the client business), the side of the engagement that hires. The owner seat is not a participant
-- row (the roster seeds it from `projects.owner_user_id`), so it can never be addressed here, and an
-- entity participant is a workspace rather than a person, so it is refused rather than relabelled.
--
-- The stored vocabulary is the one `fn_apply_invitation_decision` writes: a `freelancer` is stored as
-- `'assignee'`, every other role verbatim — so a role set here and a role granted by an accepted
-- invitation are the same value, and `toMemberRole` reads both back identically.
--
-- A role is a permission label and NOTHING ELSE moves: stage assignments, held escrow and claimed
-- tickets are untouched. Removing someone's seat is `remove_project_member`, which applies the
-- money consequences; a role change must never be a side door around it.
CREATE OR REPLACE FUNCTION projects.set_member_role(
    p_project_id     uuid,
    p_participant_id uuid,
    p_role           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, auth
AS $$
DECLARE
    v_actor   uuid := auth.uid();
    v_row     projects.project_participants%ROWTYPE;
    v_stored  text;
    v_status  project_status;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to change a member''s role.' USING ERRCODE = '42501';
    END IF;

    SELECT p.status INTO v_status FROM projects.projects p WHERE p.id = p_project_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project % not found.', p_project_id USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT projects.can_review_project(p_project_id) THEN
        RAISE EXCEPTION 'Only the project owner may change a member''s role.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_status IN ('archived', 'cancelled', 'completed') THEN
        RAISE EXCEPTION 'This project is closed — its roles can no longer change.' USING ERRCODE = 'check_violation';
    END IF;
    IF p_role IS NULL OR p_role NOT IN ('admin', 'manager', 'freelancer', 'member', 'guest') THEN
        RAISE EXCEPTION 'That is not a role a member can hold.' USING ERRCODE = 'check_violation';
    END IF;

    -- Locked so two concurrent edits serialise and the audit row records the value actually replaced.
    SELECT * INTO v_row
    FROM projects.project_participants pp
    WHERE pp.id = p_participant_id AND pp.project_id = p_project_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That member is not part of this project.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_row.profile_type <> 'freelancer' THEN
        RAISE EXCEPTION 'A workspace on the project has no role to change.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_row.profile_id = v_actor THEN
        RAISE EXCEPTION 'You cannot change your own role.' USING ERRCODE = 'check_violation';
    END IF;

    v_stored := CASE WHEN p_role = 'freelancer' THEN 'assignee' ELSE p_role END;
    -- Idempotent: a retry after an unseen response must not stamp a second audit row for no change.
    IF v_row.role = v_stored THEN
        RETURN jsonb_build_object('participant_id', v_row.id, 'role', p_role, 'changed', false);
    END IF;

    UPDATE projects.project_participants SET role = v_stored WHERE id = v_row.id;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (
        v_actor, 'project.member_role_changed', 'projects.project_participants', v_row.id,
        jsonb_build_object('project_id', p_project_id, 'member_user_id', v_row.profile_id,
                           'from', v_row.role, 'to', v_stored)
    );

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        p_project_id, v_actor, 'member_role_changed',
        jsonb_build_object('participant_id', v_row.id, 'member_user_id', v_row.profile_id,
                           'from', v_row.role, 'to', v_stored),
        'projects.project_participants', v_row.id
    );

    RETURN jsonb_build_object('participant_id', v_row.id, 'role', p_role, 'changed', true);
END;
$$;

COMMENT ON FUNCTION projects.set_member_role(uuid, uuid, text) IS
'Changes one person-participant''s role on a project as its review authority (owner or client-business member). Stores `freelancer` as `assignee` (the vocabulary fn_apply_invitation_decision writes), refuses the caller''s own row and closed projects, is idempotent, and records the change in security.audit_logs and projects.project_activity. Moves no seat, ticket or escrow.';
-- #endregion

-- #region 2. invite_by_email
-- projects.invite_by_email(project, stage, email, role) -> invitation id
--
-- The email-addressed twin of `invite_to_project`. The row stays ADDRESSED BY EMAIL even when the
-- address belongs to an account: resolving it to `target_user_id` would show the inviter whose
-- account owns that address the moment the roster re-reads its queue — an address-to-identity oracle
-- for anyone who can create a project. This is the rule `org.invite_workspace_member` follows.
--
-- The holder of a VERIFIED matching address is still told, through the router (`stage.invite`), in
-- the same transaction as the row. The lookup happens here, in definer context, and nothing about
-- its outcome reaches the caller: the function returns the same id whether or not anyone matched.
-- An unverified address is never notified, for the reason the invitee SELECT policy gives.
--
-- Owner-only, like `invite_to_project` and the `Owner manages invitations` policy. One open offer per
-- (project, stage, address), enforced by `uq_project_invitations_open_email` (00004003).
CREATE OR REPLACE FUNCTION projects.invite_by_email(
    p_project_id uuid,
    p_stage_id   uuid,
    p_email      text,
    p_role       text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, comms, org, auth
AS $$
DECLARE
    v_actor        uuid := auth.uid();
    v_project      projects.projects%ROWTYPE;
    v_email        text := lower(btrim(COALESCE(p_email, '')));
    v_stage_name   text;
    v_placeholder  boolean;
    v_stage_price  bigint;
    v_holder       uuid;
    v_inviter_name text;
    v_inviter_slug text;
    v_id           uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to invite someone to a project.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_project FROM projects.projects WHERE id = p_project_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project % not found.', p_project_id USING ERRCODE = 'no_data_found';
    END IF;
    IF v_project.owner_user_id <> v_actor THEN
        RAISE EXCEPTION 'Only the project owner may invite people to it.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_project.status IN ('archived', 'cancelled', 'completed') THEN
        RAISE EXCEPTION 'This project is closed — nobody can be invited to it.' USING ERRCODE = 'check_violation';
    END IF;
    IF p_role IS NULL OR p_role NOT IN ('admin', 'manager', 'freelancer', 'member', 'guest') THEN
        RAISE EXCEPTION 'That is not a role an invitation can grant.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 160 THEN
        RAISE EXCEPTION 'Enter a valid email address.' USING ERRCODE = 'check_violation';
    END IF;

    IF p_stage_id IS NOT NULL THEN
        SELECT s.name, s.unit_price_cents INTO v_stage_name, v_stage_price
        FROM projects.project_stages s
        WHERE s.id = p_stage_id AND s.project_id = p_project_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'That stage is not part of this project.' USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- Derived exactly as `invite_to_project` derives it: a draft, or no configured figure, is a
    -- placeholder. An email invitation states no price of its own.
    v_placeholder := v_project.status = 'draft'
        OR (CASE WHEN p_stage_id IS NULL THEN v_project.budget_amount_cents ELSE v_stage_price END) IS NULL;

    BEGIN
        INSERT INTO projects.project_invitations (
            project_id, project_stage_id, target_email, role, inviter_user_id, token,
            placeholder, status, expires_at
        ) VALUES (
            p_project_id, p_stage_id, v_email, p_role, v_actor, encode(extensions.gen_random_bytes(32), 'hex'),
            v_placeholder, 'pending', now() + interval '14 days'
        )
        RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'An invitation to this address for this stage is already pending.' USING ERRCODE = 'unique_violation';
    END;

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        p_project_id, v_actor, 'invitation_sent',
        jsonb_build_object('invitation_id', v_id, 'stage_id', p_stage_id, 'by_email', true,
                           'role', p_role, 'placeholder', v_placeholder),
        'projects.project_invitations', v_id
    );

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_actor, 'project.member_invited', 'projects.project_invitations', v_id,
            jsonb_build_object('project_id', p_project_id, 'stage_id', p_stage_id, 'role', p_role, 'by_email', true));

    SELECT e.user_id INTO v_holder
    FROM org.user_emails e
    WHERE lower(e.email) = v_email AND e.verified_at IS NOT NULL AND e.user_id <> v_actor
    ORDER BY e.is_primary DESC, e.verified_at
    LIMIT 1;

    IF v_holder IS NOT NULL THEN
        SELECT trim(coalesce(up.first_name, '') || ' ' || coalesce(up.last_name, '')), up.username
            INTO v_inviter_name, v_inviter_slug
        FROM org.users_public up WHERE up.user_id = v_actor;
        v_inviter_name := NULLIF(v_inviter_name, '');

        PERFORM comms.fn_notify(
            v_holder,
            'stage.invite',
            format('%s invited you to %s', COALESCE(v_inviter_name, 'A client'), COALESCE(v_stage_name, v_project.title)),
            v_project.title || CASE WHEN v_stage_name IS NOT NULL THEN ' · ' || v_stage_name ELSE '' END,
            'projects.project_invitations',
            v_id,
            jsonb_build_object(
                'project_slug', v_project.slug,
                'project_title', v_project.title,
                'stage_id', p_stage_id,
                'stage_name', v_stage_name,
                'currency', v_project.currency,
                'placeholder', v_placeholder,
                'by_email', true
            ),
            v_actor,
            'project',
            p_project_id,
            NULL,
            CASE WHEN v_inviter_slug IS NOT NULL THEN '/messages/dm-' || v_inviter_slug ELSE NULL END
        );
    END IF;

    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION projects.invite_by_email(uuid, uuid, text, text) IS
'Issues one email-addressed project (or stage) invitation as the project owner. The row stays addressed by email (never resolved to an identity the inviter could read back); the holder of a matching VERIFIED address is notified with `stage.invite` through comms.fn_notify in the same transaction. Records project_activity and security.audit_logs. Owner-only.';
-- #endregion
