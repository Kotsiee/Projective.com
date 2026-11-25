-- =============================================================================================
-- 00001135 · projects — membership writes from the Members tab
--
--   1. projects.set_member_role      — the owner/client side changes a participant's role
--   2. projects.invite_by_email      — an email-addressed project (or stage) invitation
--   3. projects.act_on_invitation    — cancel or dismiss an invitation record
--   4. stage invite links            — get / reset / revoke a stage's link, resolve and redeem it
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
-- Authority is the configuring side (`projects.can_edit_project_details` — review authority: the
-- owner, or an active member of the client business; on a seller-owned service its provider, Decision
-- #427), the side of the engagement that staffs it. The owner seat is not a participant
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
    IF NOT projects.can_edit_project_details(p_project_id) THEN
        RAISE EXCEPTION 'Only the project owner may change a member''s role.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- A role decides who staffs the project, so on a business project it is a `hire` decision.
    PERFORM projects.fn_assert_business_actor(p_project_id, 'hire');
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

    -- A ticket-management grant belongs to an admin/manager seat (Decision #294): leaving those seats
    -- ends it in the same write, or the seat check would refuse the change.
    UPDATE projects.project_participants
    SET role = v_stored,
        can_manage_tickets = can_manage_tickets AND v_stored IN ('admin', 'manager')
    WHERE id = v_row.id;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (
        v_actor, 'project.member_role_changed', 'projects.project_participants', v_row.id,
        jsonb_build_object('project_id', p_project_id, 'member_user_id', v_row.profile_id,
                           'from', v_row.role, 'to', v_stored,
                           'ticket_grant_ended', v_row.can_manage_tickets AND v_stored NOT IN ('admin', 'manager'))
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
'Changes one person-participant''s role on a project as its review authority (owner or client-business member). Stores `freelancer` as `assignee` (the vocabulary fn_apply_invitation_decision writes), refuses the caller''s own row and closed projects, is idempotent, and records the change in security.audit_logs and projects.project_activity. Ends a ticket-management grant when the seat leaves admin/manager. Moves no seat, ticket or escrow.';
-- #endregion

-- #region 1b. set_ticket_manager
-- projects.set_ticket_manager(project, participant, allowed) -> jsonb
--
-- The business client's explicit grant to a delegated project manager to compose and edit tickets on
-- its behalf (Decision #294; PRODUCT_SPEC §Editing & Reordering Restrictions). Ticket content is the
-- client's: a freelancer never writes it, except a delegate the business chose for exactly that.
--
-- Authority is the one that appoints the delegate: review authority, and on a business project the
-- `hire` capability (projects.fn_assert_business_actor). Only a BUSINESS client grants it — a personal
-- client's project has no business to act for — and only to a person seat the project made `admin` or
-- `manager`. Not the caller's own seat, and not on a closed project. Idempotent; the change is recorded
-- in security.audit_logs and projects.project_activity in the same transaction.
--
-- What the grant buys is narrow (projects.fn_ticket_immutability_guard): the ticket's content and
-- composition columns, on tickets nobody has claimed. Never its assignee, status, payment bookkeeping or
-- deletion, never a claimed ticket's terms or stage — a delegate edits what the client could edit
-- before a claim, and no more.
CREATE OR REPLACE FUNCTION projects.set_ticket_manager(
    p_project_id     uuid,
    p_participant_id uuid,
    p_allowed        boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, auth
AS $$
DECLARE
    v_actor   uuid := auth.uid();
    v_row     projects.project_participants%ROWTYPE;
    v_project record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to change who manages tickets.' USING ERRCODE = '42501';
    END IF;
    IF p_allowed IS NULL THEN
        RAISE EXCEPTION 'Say whether this member may manage tickets.' USING ERRCODE = 'check_violation';
    END IF;

    SELECT p.status, p.client_business_id INTO v_project
    FROM projects.projects p WHERE p.id = p_project_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project % not found.', p_project_id USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT projects.can_review_project(p_project_id) THEN
        RAISE EXCEPTION 'Only the client may let a member manage tickets.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Choosing who writes the work on the business's behalf is a staffing decision.
    PERFORM projects.fn_assert_business_actor(p_project_id, 'hire');
    IF v_project.client_business_id IS NULL THEN
        RAISE EXCEPTION 'Only a business client delegates its tickets to a project manager.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_project.status IN ('archived', 'cancelled', 'completed') THEN
        RAISE EXCEPTION 'This project is closed — who manages its tickets can no longer change.'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO v_row
    FROM projects.project_participants pp
    WHERE pp.id = p_participant_id AND pp.project_id = p_project_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That member is not part of this project.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_row.profile_id = v_actor THEN
        RAISE EXCEPTION 'You cannot change your own ticket permission.' USING ERRCODE = 'check_violation';
    END IF;
    IF p_allowed AND (v_row.profile_type <> 'freelancer' OR v_row.role NOT IN ('admin', 'manager')) THEN
        RAISE EXCEPTION 'Make this member a project admin or manager before letting them manage tickets.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_row.can_manage_tickets = p_allowed THEN
        RETURN jsonb_build_object('participant_id', v_row.id, 'can_manage_tickets', p_allowed, 'changed', false);
    END IF;

    UPDATE projects.project_participants SET can_manage_tickets = p_allowed WHERE id = v_row.id;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (
        v_actor, 'project.ticket_manager_changed', 'projects.project_participants', v_row.id,
        jsonb_build_object('project_id', p_project_id, 'member_user_id', v_row.profile_id,
                           'can_manage_tickets', p_allowed)
    );

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        p_project_id, v_actor, 'ticket_manager_changed',
        jsonb_build_object('participant_id', v_row.id, 'member_user_id', v_row.profile_id,
                           'can_manage_tickets', p_allowed),
        'projects.project_participants', v_row.id
    );

    RETURN jsonb_build_object('participant_id', v_row.id, 'can_manage_tickets', p_allowed, 'changed', true);
END;
$$;

COMMENT ON FUNCTION projects.set_ticket_manager(uuid, uuid, boolean) IS
'Grants or ends a delegated project manager''s right to compose and edit tickets on a business client''s project (Decision #294). Review authority plus `hire`; business projects only; admin/manager person seats only; not the caller''s own seat; not on a closed project. Idempotent; audited in security.audit_logs and projects.project_activity.';
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
-- the same transaction as the row, and the notice links to the invitation's own `/invite/<token>`,
-- where `answer_email_invitation` lets them answer (§2b). The lookup happens here, in definer context,
-- and nothing about its outcome reaches the caller: the function returns the same id whether or not
-- anyone matched. An unverified address is never notified, for the reason the invitee SELECT policy
-- gives.
--
-- An address no verified account holds is MAILED instead (PROJECTS NO1): one row in
-- `projects.invitation_mail`, in this transaction, sent by the service role's claim. Only while the ⚖️
-- switch `project_invite_mail_enabled` is on (seeded off until counsel confirms the lawful basis),
-- never to a suppressed address, and once per (project, address) within an invitation's 14-day life,
-- so cancelling and inviting again does not mail the same inbox twice. The send itself is inside the
-- invite caps already: each invitation spends one of the inviter's hire allowance before it exists.
--
-- Staffing authority (`can_manage_project_members`), like `invite_to_project`: an admin or a manager
-- may invite, and only review authority may offer the admin or manager role. One open offer per
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
SET search_path = ''
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
    v_id           uuid;
    v_token        text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to invite someone to a project.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_project FROM projects.projects WHERE id = p_project_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project % not found.', p_project_id USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT projects.can_manage_project_members(p_project_id) THEN
        RAISE EXCEPTION 'Only the project owner, an admin or a manager may invite people to it.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM projects.fn_assert_business_actor(p_project_id, 'hire', true);
    IF v_project.status IN ('archived', 'cancelled', 'completed') THEN
        RAISE EXCEPTION 'This project is closed — nobody can be invited to it.' USING ERRCODE = 'check_violation';
    END IF;
    IF p_role IS NULL OR p_role NOT IN ('admin', 'manager', 'freelancer', 'member', 'guest') THEN
        RAISE EXCEPTION 'That is not a role an invitation can grant.' USING ERRCODE = 'check_violation';
    END IF;
    IF p_role IN ('admin', 'manager') AND NOT projects.can_edit_project_details(p_project_id) THEN
        RAISE EXCEPTION 'Only the project owner may invite an admin or a manager.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_role IN ('admin', 'manager') THEN
        PERFORM projects.fn_assert_business_actor(p_project_id, 'hire');
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
        RETURNING id, token INTO v_id, v_token;
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
        SELECT NULLIF(trim(coalesce(up.first_name, '') || ' ' || coalesce(up.last_name, '')), '')
            INTO v_inviter_name
        FROM org.users_public up WHERE up.user_id = v_actor;

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
            '/invite/' || v_token
        );
    ELSIF COALESCE((SELECT (pp.value #>> '{}')::boolean FROM security.platform_params pp
                     WHERE pp.key = 'project_invite_mail_enabled'), false)
          AND NOT comms.fn_is_suppressed('email'::comms.notification_channel, v_email,
                                         'work'::comms.notification_category)
          AND NOT EXISTS (
              SELECT 1 FROM projects.invitation_mail m
                JOIN projects.project_invitations i ON i.id = m.invitation_id
               WHERE i.project_id = p_project_id AND lower(i.target_email) = v_email
                 AND m.created_at > now() - interval '14 days'
          ) THEN
        INSERT INTO projects.invitation_mail (invitation_id) VALUES (v_id);
    END IF;

    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION projects.invite_by_email(uuid, uuid, text, text) IS
'Issues one email-addressed project (or stage) invitation as the project''s staffing authority (can_manage_project_members; only review authority may offer admin or manager). The row stays addressed by email (never resolved to an identity the inviter could read back). The holder of a matching VERIFIED address is notified with `stage.invite`, linked to /invite/<token>; any other address is queued one mail in projects.invitation_mail while project_invite_mail_enabled is on and the address is not suppressed (PROJECTS NO1). Records project_activity and security.audit_logs.';
-- #endregion

-- #region 2b. Email invitations answered by their link (PROJECTS NO1)
-- An email invitation's token is its link: `/invite/<token>`, mailed to the address or carried by the
-- verified holder's `stage.invite`. The token alone opens nothing. The invitation answers only for the
-- account it is addressed to, which for an email-addressed row is any account holding that address
-- VERIFIED, the rule the invitee SELECT policy on project_invitations already applies, for the same
-- reason: anyone may add an arbitrary address to their own account unverified. A forwarded link, or an
-- account made with another address, reads `not_yours`; the inviter never answers their own.
--
-- projects.email_invitation(token) -> jsonb
-- The landing read. States: invalid (no such token) · not_yours (with a masked hint of the address,
-- the project's title and the inviter, nothing more) · open · accepted · declined · expired ·
-- withdrawn.
CREATE OR REPLACE FUNCTION projects.email_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor   uuid := auth.uid();
    v_inv     projects.project_invitations%ROWTYPE;
    v_project projects.projects%ROWTYPE;
    v_stage   text;
    v_inviter text;
    v_local   text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to open this invitation.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_inv FROM projects.project_invitations i WHERE i.token = p_token;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('state', 'invalid');
    END IF;
    SELECT * INTO v_project FROM projects.projects p WHERE p.id = v_inv.project_id;
    SELECT NULLIF(pg_catalog.btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '')
      INTO v_inviter
      FROM org.users_public u WHERE u.user_id = v_inv.inviter_user_id;

    IF v_inv.inviter_user_id = v_actor OR NOT (
        v_inv.target_user_id IS NOT DISTINCT FROM v_actor
        OR (v_inv.target_user_id IS NULL AND EXISTS (
            SELECT 1 FROM org.user_emails e
             WHERE e.user_id = v_actor AND e.verified_at IS NOT NULL
               AND lower(e.email) = lower(v_inv.target_email)))
    ) THEN
        v_local := pg_catalog.split_part(v_inv.target_email, '@', 1);
        RETURN pg_catalog.jsonb_build_object(
            'state', 'not_yours',
            'project_title', v_project.title,
            'inviter_name', v_inviter,
            'address_hint', CASE WHEN v_inv.target_email IS NOT NULL THEN
                pg_catalog.left(v_local, 1) || '•••@' || pg_catalog.split_part(v_inv.target_email, '@', 2) END
        );
    END IF;

    IF v_inv.project_stage_id IS NOT NULL THEN
        SELECT s.name INTO v_stage FROM projects.project_stages s WHERE s.id = v_inv.project_stage_id;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'state', CASE
            WHEN v_inv.status = 'pending' AND v_inv.expires_at IS NOT NULL AND v_inv.expires_at <= now() THEN 'expired'
            WHEN v_inv.status = 'pending' THEN 'open'
            WHEN v_inv.status = 'revoked' THEN 'withdrawn'
            ELSE v_inv.status
        END,
        'project_slug', v_project.slug,
        'project_title', v_project.title,
        'stage_name', v_stage,
        'inviter_name', v_inviter,
        'role', v_inv.role,
        'expires_at', v_inv.expires_at
    );
END;
$$;

COMMENT ON FUNCTION projects.email_invitation(text) IS
'The /invite/<token> landing read for a project invitation: invalid · not_yours · open · accepted · declined · expired · withdrawn. An email-addressed row is the caller''s only when they hold its address verified; not_yours carries a masked address hint, the project title and the inviter. Signed-in callers only (PROJECTS NO1).';

-- projects.answer_email_invitation(token, accept) -> jsonb
-- The invitee answers by the link. An open email-addressed row is first bound to the answering account
-- (`target_user_id` set, `target_email` cleared, as ck_project_invitations_addressee requires one), so
-- the acceptance body, the roster and the decline cooldown all read one identity, and the binding is
-- audited. Then the one acceptance body, `fn_apply_invitation_decision`, answers it with every gate it
-- already holds (expiry, payout readiness for paid work, the client-trust consent, the seat lock).
CREATE OR REPLACE FUNCTION projects.answer_email_invitation(p_token text, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_inv   projects.project_invitations%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to answer this invitation.' USING ERRCODE = '42501';
    END IF;
    IF p_accept IS NULL THEN
        RAISE EXCEPTION 'Say whether you accept this invitation.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_inv FROM projects.project_invitations i WHERE i.token = p_token FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This invitation link is not valid.' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_inv.inviter_user_id = v_actor OR NOT (
        v_inv.target_user_id IS NOT DISTINCT FROM v_actor
        OR (v_inv.target_user_id IS NULL AND EXISTS (
            SELECT 1 FROM org.user_emails e
             WHERE e.user_id = v_actor AND e.verified_at IS NOT NULL
               AND lower(e.email) = lower(v_inv.target_email)))
    ) THEN
        RAISE EXCEPTION 'This invitation was sent to another address. Sign in with that address, or add and verify it in Settings.'
            USING ERRCODE = '42501';
    END IF;

    IF v_inv.target_user_id IS NULL AND v_inv.status = 'pending' THEN
        BEGIN
            UPDATE projects.project_invitations
               SET target_user_id = v_actor, target_email = NULL
             WHERE id = v_inv.id;
        EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION 'You already have an open invitation to this stage. Answer that one instead.'
                USING ERRCODE = 'unique_violation';
        END;
        INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
        VALUES (v_actor, 'project.invitation_claimed', 'projects.project_invitations', v_inv.id,
                pg_catalog.jsonb_build_object('project_id', v_inv.project_id, 'stage_id', v_inv.project_stage_id,
                                              'by_email', true));
    END IF;

    RETURN projects.fn_apply_invitation_decision(v_inv.id, p_accept, v_actor);
END;
$$;

COMMENT ON FUNCTION projects.answer_email_invitation(text, boolean) IS
'The invitee accepts or declines a project invitation by its /invite/<token> link. Refused 42501 unless the caller is its addressee (an email-addressed row: a verified matching address; never the inviter). An open email-addressed row is bound to the caller first (audited project.invitation_claimed), then projects.fn_apply_invitation_decision answers it (PROJECTS NO1).';

-- projects.claim_invitation_mail(limit) -> the messages to send now (service role)
-- Leases up to `p_limit` queued mails (five minutes, so a sender that died is retried) and answers what
-- each one says. Nothing while the ⚖️ switch is off; what waits stays queued. A mail whose invitation
-- is no longer an open offer to an address (cancelled, answered, lapsed, taken by an account) or whose
-- address has been suppressed since is dropped unsent. Every text an inviter wrote goes through
-- scheduling.fn_guest_safe_text, because this leaves under Projective's name for an inbox that never
-- asked for it.
CREATE OR REPLACE FUNCTION projects.claim_invitation_mail(p_limit integer DEFAULT 25)
RETURNS TABLE (
    mail_id uuid, email text, token text, project_title text, stage_name text, inviter_name text,
    role text, expires_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    m projects.invitation_mail;
    i projects.project_invitations;
BEGIN
    IF NOT COALESCE((SELECT (pp.value #>> '{}')::boolean FROM security.platform_params pp
                      WHERE pp.key = 'project_invite_mail_enabled'), false) THEN
        RETURN;
    END IF;

    FOR m IN
        UPDATE projects.invitation_mail u
           SET claimed_at = pg_catalog.now(), attempts = u.attempts + 1
         WHERE u.id IN (
             SELECT x.id FROM projects.invitation_mail x
              WHERE x.sent_at IS NULL AND x.failed_at IS NULL
                AND (x.claimed_at IS NULL OR x.claimed_at < pg_catalog.now() - interval '5 minutes')
              ORDER BY x.created_at
              LIMIT GREATEST(COALESCE(p_limit, 25), 1)
                FOR UPDATE SKIP LOCKED
         )
        RETURNING u.*
    LOOP
        SELECT * INTO i FROM projects.project_invitations x WHERE x.id = m.invitation_id;
        IF i.status <> 'pending' OR i.target_email IS NULL
           OR (i.expires_at IS NOT NULL AND i.expires_at <= pg_catalog.now())
           OR comms.fn_is_suppressed('email'::comms.notification_channel, i.target_email,
                                     'work'::comms.notification_category) THEN
            DELETE FROM projects.invitation_mail x WHERE x.id = m.id;
            CONTINUE;
        END IF;

        mail_id := m.id;
        email := i.target_email;
        token := i.token;
        role := i.role;
        expires_at := i.expires_at;
        SELECT scheduling.fn_guest_safe_text(COALESCE(NULLIF(p.title, ''), 'A project'))
          INTO project_title
          FROM projects.projects p WHERE p.id = i.project_id;
        stage_name := NULL;
        IF i.project_stage_id IS NOT NULL THEN
            SELECT scheduling.fn_guest_safe_text(s.name) INTO stage_name
              FROM projects.project_stages s WHERE s.id = i.project_stage_id;
        END IF;
        SELECT scheduling.fn_guest_safe_text(COALESCE(
            NULLIF(pg_catalog.btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
            u.username
        )) INTO inviter_name
          FROM org.users_public u WHERE u.user_id = i.inviter_user_id;
        RETURN NEXT;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION projects.claim_invitation_mail(integer) IS
'Service role: leases queued invitation mail (five minutes) and answers address, token, project, stage, inviter, role and expiry for each; nothing while project_invite_mail_enabled is off. Drops, unsent, a mail whose invitation is no longer an open offer to an address or whose address is now suppressed (PROJECTS NO1).';

-- projects.finish_invitation_mail(mail, sent) — how a claimed message went. Five refusals in a row
-- and it stops.
CREATE OR REPLACE FUNCTION projects.finish_invitation_mail(p_mail uuid, p_sent boolean)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE projects.invitation_mail m
       SET sent_at = CASE WHEN p_sent THEN pg_catalog.now() END,
           failed_at = CASE WHEN NOT p_sent AND m.attempts >= 5 THEN pg_catalog.now() END
     WHERE m.id = p_mail;
$$;

COMMENT ON FUNCTION projects.finish_invitation_mail(uuid, boolean) IS
'Service role: records a claimed invitation mail as sent, or as failed after its fifth refused attempt (PROJECTS NO1).';
-- #endregion

-- #region 3. act_on_invitation
-- projects.act_on_invitation(invitation, action) -> jsonb
--
-- The managing side's two acts on an invitation record: `cancel` withdraws an open offer
-- (`pending → revoked`, which starts no cooldown) and `dismiss` takes an answered or lapsed record
-- off the list (`dismissed_at`, an attribute — the status underneath is kept). A definer door rather
-- than a direct UPDATE because the authority is `can_manage_project_members`, wider than the owner-only
-- write policy, and a delegate holding UPDATE on the row could rewrite its role or token.
--
-- A row the caller cannot manage is reported as not found, so a stranger learns nothing.
CREATE OR REPLACE FUNCTION projects.act_on_invitation(
    p_invitation_id uuid,
    p_action        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, auth
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_inv   projects.project_invitations%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to manage invitations.' USING ERRCODE = '42501';
    END IF;
    IF p_action IS NULL OR p_action NOT IN ('cancel', 'dismiss') THEN
        RAISE EXCEPTION 'That is not an action an invitation takes.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_inv FROM projects.project_invitations WHERE id = p_invitation_id FOR UPDATE;
    IF NOT FOUND OR NOT projects.can_manage_project_members(v_inv.project_id) THEN
        RAISE EXCEPTION 'Invitation % not found.', p_invitation_id USING ERRCODE = 'no_data_found';
    END IF;
    PERFORM projects.fn_assert_business_actor(v_inv.project_id, 'hire', true);

    IF p_action = 'cancel' THEN
        IF v_inv.status <> 'pending' THEN
            RAISE EXCEPTION 'This invitation has already been %; it can no longer be cancelled.', v_inv.status
                USING ERRCODE = 'check_violation';
        END IF;
        UPDATE projects.project_invitations SET status = 'revoked' WHERE id = v_inv.id;
    ELSE
        IF v_inv.status = 'pending' THEN
            RAISE EXCEPTION 'An open invitation is cancelled, not dismissed.' USING ERRCODE = 'check_violation';
        END IF;
        -- Idempotent: dismissing a dismissed record changes nothing and records nothing.
        IF v_inv.dismissed_at IS NOT NULL THEN
            RETURN jsonb_build_object('id', v_inv.id, 'action', p_action, 'changed', false);
        END IF;
        UPDATE projects.project_invitations SET dismissed_at = now() WHERE id = v_inv.id;
    END IF;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (
        v_actor,
        CASE p_action WHEN 'cancel' THEN 'project.invitation_revoked' ELSE 'project.invitation_dismissed' END,
        'projects.project_invitations', v_inv.id,
        jsonb_build_object('project_id', v_inv.project_id, 'stage_id', v_inv.project_stage_id)
    );

    RETURN jsonb_build_object('id', v_inv.id, 'action', p_action, 'changed', true);
END;
$$;

COMMENT ON FUNCTION projects.act_on_invitation(uuid, text) IS
'The managing side cancels a pending invitation (status revoked) or dismisses an answered or lapsed one (dismissed_at). Authority is projects.can_manage_project_members; a record the caller cannot manage is reported as not found. Records security.audit_logs.';
-- #endregion

-- #region 4. Stage invite links (Decision #145)
-- A stage's shareable link, its reset and its revocation are member-management acts
-- (`can_manage_project_members`). Redeeming one files a pending APPLICATION on the stage — the same
-- row `apply_to_project` writes, carrying `invite_link_id` — so the Requests section answers it with
-- `assign_from_application` / `reject_application` and nothing here can seat anybody.
--
-- `fn_invite_link_state` is the ONE rule for what a link means to a given person, read by both the
-- landing page (`resolve_invite_link`) and the redeem door, so the page never offers a request the
-- redeem would refuse.

-- The stage states a link cannot be used in: the work is signed off, paid, or abandoned.
CREATE OR REPLACE FUNCTION projects.fn_invite_link_state(
    p_link  projects.stage_invite_links,
    p_actor uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_project projects.projects%ROWTYPE;
    v_stage   projects.project_stages%ROWTYPE;
BEGIN
    IF p_link.status <> 'active' THEN
        RETURN 'revoked';
    END IF;
    SELECT * INTO v_project FROM projects.projects WHERE id = p_link.project_id;
    SELECT * INTO v_stage FROM projects.project_stages WHERE id = p_link.project_stage_id;
    IF v_project.status IN ('archived', 'cancelled', 'completed')
        OR v_stage.status IN ('approved', 'paid', 'cancelled') THEN
        RETURN 'closed';
    END IF;
    IF v_project.owner_user_id = p_actor OR EXISTS (
        SELECT 1 FROM projects.project_participants pp
        WHERE pp.project_id = v_project.id AND pp.profile_type = 'freelancer'
            AND pp.profile_id = p_actor AND pp.role IN ('admin', 'manager')
    ) THEN
        RETURN 'manager';
    END IF;
    IF EXISTS (
        SELECT 1 FROM projects.stage_assignments sa
        WHERE sa.project_stage_id = v_stage.id
            AND sa.assignee_type = 'freelancer'
            AND sa.freelancer_profile_id = p_actor
            AND sa.status NOT IN ('released', 'cancelled', 'declined', 'completed')
    ) THEN
        RETURN 'member';
    END IF;
    IF EXISTS (
        SELECT 1 FROM projects.project_invitations i
        WHERE i.project_id = v_project.id
            AND i.project_stage_id = v_stage.id
            AND i.target_user_id = p_actor
            AND i.status = 'pending'
    ) THEN
        RETURN 'invited';
    END IF;
    IF EXISTS (
        SELECT 1 FROM projects.project_applications pa
        JOIN projects.project_application_targets pat ON pat.application_id = pa.id
        WHERE pa.applicant_user_id = p_actor
            AND pa.status = 'pending'
            AND pat.target_type = 'stage'
            AND pat.target_id = v_stage.id
    ) THEN
        RETURN 'requested';
    END IF;
    -- An accepted request becomes a freelancer stage assignment, whose FK is the freelancer profile.
    IF NOT EXISTS (SELECT 1 FROM org.freelancer_profiles fp WHERE fp.user_id = p_actor) THEN
        RETURN 'no_profile';
    END IF;
    RETURN 'open';
END;
$$;

COMMENT ON FUNCTION projects.fn_invite_link_state(projects.stage_invite_links, uuid) IS
'What a stage invite link means to one person: revoked · closed · manager · member · invited · requested · no_profile · open. Internal — read by resolve_invite_link and redeem_invite_link only.';

-- projects.get_stage_invite_link(stage, rotate) -> jsonb
--
-- The stage's active link, minted on first use. `p_rotate` revokes the active link and mints a new
-- one in the same transaction ("Reset link"), so the old URL is dead before the new one exists.
CREATE OR REPLACE FUNCTION projects.get_stage_invite_link(
    p_stage_id uuid,
    p_rotate   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, auth
AS $$
DECLARE
    v_actor  uuid := auth.uid();
    v_stage  projects.project_stages%ROWTYPE;
    v_status project_status;
    v_link   projects.stage_invite_links%ROWTYPE;
    v_had    boolean;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to share an invite link.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_stage FROM projects.project_stages WHERE id = p_stage_id;
    IF NOT FOUND OR NOT projects.can_manage_project_members(v_stage.project_id) THEN
        RAISE EXCEPTION 'Only the project owner, an admin or a manager may share an invite link.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM projects.fn_assert_business_actor(v_stage.project_id, 'hire', true);
    SELECT p.status INTO v_status FROM projects.projects p WHERE p.id = v_stage.project_id;
    IF v_status IN ('archived', 'cancelled', 'completed') THEN
        RAISE EXCEPTION 'This project is closed — nobody can join it.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_stage.status IN ('approved', 'paid', 'cancelled') THEN
        RAISE EXCEPTION 'This stage is finished — nobody can join it.' USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO v_link FROM projects.stage_invite_links
    WHERE project_stage_id = p_stage_id AND status = 'active'
    FOR UPDATE;
    v_had := FOUND;

    IF v_had AND NOT COALESCE(p_rotate, false) THEN
        RETURN jsonb_build_object('id', v_link.id, 'token', v_link.token,
                                  'stageId', v_link.project_stage_id, 'createdAt', v_link.created_at);
    END IF;

    IF v_had THEN
        UPDATE projects.stage_invite_links
        SET status = 'revoked', revoked_at = now(), revoked_by = v_actor
        WHERE id = v_link.id;
        INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
        VALUES (v_actor, 'project.invite_link_revoked', 'projects.stage_invite_links', v_link.id,
                jsonb_build_object('project_id', v_stage.project_id, 'stage_id', p_stage_id, 'reset', true));
    END IF;

    BEGIN
        INSERT INTO projects.stage_invite_links (project_id, project_stage_id, token, created_by)
        VALUES (
            v_stage.project_id, p_stage_id,
            -- Schema-qualified: pgcrypto lives in `extensions`, outside this search_path.
            translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_'),
            v_actor
        )
        RETURNING * INTO v_link;
    EXCEPTION WHEN unique_violation THEN
        -- A concurrent first open minted the link a moment earlier; that one is the answer.
        SELECT * INTO v_link FROM projects.stage_invite_links
        WHERE project_stage_id = p_stage_id AND status = 'active';
        RETURN jsonb_build_object('id', v_link.id, 'token', v_link.token,
                                  'stageId', v_link.project_stage_id, 'createdAt', v_link.created_at);
    END;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_actor, 'project.invite_link_created', 'projects.stage_invite_links', v_link.id,
            jsonb_build_object('project_id', v_stage.project_id, 'stage_id', p_stage_id));

    RETURN jsonb_build_object('id', v_link.id, 'token', v_link.token,
                              'stageId', v_link.project_stage_id, 'createdAt', v_link.created_at);
END;
$$;

COMMENT ON FUNCTION projects.get_stage_invite_link(uuid, boolean) IS
'The stage''s active invite link, minted on first use; p_rotate revokes it and mints a replacement in one transaction. Member-management authority (can_manage_project_members); refused on a closed project or a finished stage. Records security.audit_logs.';

-- projects.revoke_stage_invite_link(stage) -> boolean
--
-- Turns the stage's link off. TRUE when a link was active; FALSE when there was nothing to revoke,
-- which is not an error — the caller asked for "no working link" and that is the state.
CREATE OR REPLACE FUNCTION projects.revoke_stage_invite_link(p_stage_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, auth
AS $$
DECLARE
    v_actor   uuid := auth.uid();
    v_project uuid;
    v_link    uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to manage an invite link.' USING ERRCODE = '42501';
    END IF;
    SELECT s.project_id INTO v_project FROM projects.project_stages s WHERE s.id = p_stage_id;
    IF NOT FOUND OR NOT projects.can_manage_project_members(v_project) THEN
        RAISE EXCEPTION 'Only the project owner, an admin or a manager may turn off an invite link.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM projects.fn_assert_business_actor(v_project, 'hire', true);

    UPDATE projects.stage_invite_links
    SET status = 'revoked', revoked_at = now(), revoked_by = v_actor
    WHERE project_stage_id = p_stage_id AND status = 'active'
    RETURNING id INTO v_link;
    IF v_link IS NULL THEN
        RETURN false;
    END IF;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_actor, 'project.invite_link_revoked', 'projects.stage_invite_links', v_link,
            jsonb_build_object('project_id', v_project, 'stage_id', p_stage_id, 'reset', false));
    RETURN true;
END;
$$;

COMMENT ON FUNCTION projects.revoke_stage_invite_link(uuid) IS
'Turns off a stage''s active invite link (status revoked, revoked_at, revoked_by). Member-management authority. TRUE when a link was active. Records security.audit_logs.';

-- projects.resolve_invite_link(token) -> jsonb
--
-- What the landing page shows the signed-in holder of a link: where it leads, who shared it, and
-- what this person can do with it (`fn_invite_link_state`). An unknown token answers
-- `{"state":"invalid"}` and nothing else — a 144-bit token is not guessable, so the uniform answer
-- costs nothing and the page can say "this link doesn't work" instead of a bare 404.
CREATE OR REPLACE FUNCTION projects.resolve_invite_link(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_actor   uuid := auth.uid();
    v_link    projects.stage_invite_links%ROWTYPE;
    v_project projects.projects%ROWTYPE;
    v_stage   projects.project_stages%ROWTYPE;
    v_name    text;
    v_handle  text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to open an invite link.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_link FROM projects.stage_invite_links WHERE token = p_token;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('state', 'invalid');
    END IF;
    SELECT * INTO v_project FROM projects.projects WHERE id = v_link.project_id;
    SELECT * INTO v_stage FROM projects.project_stages WHERE id = v_link.project_stage_id;
    SELECT NULLIF(trim(coalesce(up.first_name, '') || ' ' || coalesce(up.last_name, '')), ''), up.username
        INTO v_name, v_handle
    FROM org.users_public up WHERE up.user_id = v_link.created_by;

    RETURN jsonb_build_object(
        'state', projects.fn_invite_link_state(v_link, v_actor),
        'projectSlug', v_project.slug,
        'projectTitle', v_project.title,
        'stageSlug', v_stage.slug,
        'stageName', v_stage.name,
        'sharedByName', COALESCE(v_name, v_handle),
        'sharedByHandle', v_handle
    );
END;
$$;

COMMENT ON FUNCTION projects.resolve_invite_link(text) IS
'The landing-page answer for a stage invite link: the project, the stage, who shared it and the caller''s state (fn_invite_link_state). An unknown token answers {"state":"invalid"}. Signed-in callers only.';

-- projects.redeem_invite_link(token, message) -> jsonb
--
-- The link holder asks to join: a pending application on the link's stage, carrying the link, with
-- the owner told (`application.received`) exactly as `apply_to_project` tells them. Every refusal is
-- a state `fn_invite_link_state` already names, so the landing page and this door cannot disagree.
-- Unlike `apply_to_project` it does not require a public listing or an open hire trigger: the link is
-- the managers' own invitation to ask.
CREATE OR REPLACE FUNCTION projects.redeem_invite_link(
    p_token   text,
    p_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, comms, org, auth
AS $$
DECLARE
    v_actor    uuid := auth.uid();
    v_link     projects.stage_invite_links%ROWTYPE;
    v_project  projects.projects%ROWTYPE;
    v_stage    projects.project_stages%ROWTYPE;
    v_state    text;
    v_message  text := NULLIF(btrim(COALESCE(p_message, '')), '');
    v_app      uuid;
    v_name     text;
    v_username text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to ask to join a stage.' USING ERRCODE = '42501';
    END IF;
    IF v_message IS NOT NULL AND char_length(v_message) > 4000 THEN
        RAISE EXCEPTION 'message: too_long' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_link FROM projects.stage_invite_links WHERE token = p_token;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This invite link doesn''t work.' USING ERRCODE = 'no_data_found';
    END IF;

    -- One request per person per stage, even when the same link is pressed twice at once.
    PERFORM pg_advisory_xact_lock(hashtext('invite-link:' || v_link.project_stage_id::text || ':' || v_actor::text));

    v_state := projects.fn_invite_link_state(v_link, v_actor);
    IF v_state <> 'open' THEN
        RAISE EXCEPTION '%', CASE v_state
            WHEN 'revoked' THEN 'This invite link has been turned off.'
            WHEN 'closed' THEN 'This stage is no longer taking new people.'
            WHEN 'manager' THEN 'You already manage this project.'
            WHEN 'member' THEN 'You are already on this stage.'
            WHEN 'invited' THEN 'You already have an invitation to this stage — answer it from your inbox.'
            WHEN 'requested' THEN 'You have already asked to join this stage.'
            WHEN 'no_profile' THEN 'Set up your freelancer profile before asking to join.'
            ELSE 'This invite link can''t be used.'
        END
        USING ERRCODE = CASE WHEN v_state IN ('member', 'requested', 'invited', 'manager')
                             THEN 'unique_violation' ELSE 'check_violation' END,
              DETAIL = 'state=' || v_state;
    END IF;
    PERFORM finance.fn_assert_payout_ready('freelancer', v_actor);
    -- Asking to join a warned client's project needs the Informed Consent first (Decision #486 (C)).
    PERFORM reviews.fn_assert_client_trust_consent(
        (SELECT ps.project_id FROM projects.project_stages ps WHERE ps.id = v_link.project_stage_id), v_actor);

    SELECT * INTO v_project FROM projects.projects WHERE id = v_link.project_id;
    SELECT * INTO v_stage FROM projects.project_stages WHERE id = v_link.project_stage_id;

    IF v_message IS NOT NULL AND projects.is_protected_phase(v_project.id) THEN
        SELECT m.masked INTO v_message FROM comms.mask_pii(v_message) m;
    END IF;

    INSERT INTO projects.project_applications
        (project_id, applicant_user_id, applicant_type, applicant_profile_id, message, status, invite_link_id)
    VALUES
        (v_project.id, v_actor, 'freelancer', v_actor, v_message, 'pending', v_link.id)
    RETURNING id INTO v_app;

    INSERT INTO projects.project_application_targets (application_id, target_type, target_id)
    VALUES (v_app, 'stage', v_stage.id);

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        v_project.id, v_actor, 'application_submitted',
        jsonb_build_object('application_id', v_app, 'stage_id', v_stage.id, 'invite_link_id', v_link.id),
        'projects.project_applications', v_app
    );

    SELECT NULLIF(trim(coalesce(up.first_name, '') || ' ' || coalesce(up.last_name, '')), ''), up.username
      INTO v_name, v_username
      FROM org.users_public up
     WHERE up.user_id = v_actor;

    PERFORM comms.fn_notify(
        v_project.owner_user_id,
        'application.received',
        format('%s asked to join %s', COALESCE(v_name, 'A freelancer'), v_stage.name),
        v_project.title || ' · ' || v_stage.name || ' · via invite link'
            || CASE WHEN v_message IS NOT NULL THEN ' — ' || left(v_message, 140) ELSE '' END,
        'projects.project_applications',
        v_app,
        jsonb_build_object(
            'project_slug', v_project.slug,
            'project_title', v_project.title,
            'stage_id', v_stage.id,
            'stage_name', v_stage.name,
            'via_invite_link', true
        ),
        v_actor,
        'project',
        v_project.id,
        NULL,
        CASE WHEN v_username IS NOT NULL THEN '/messages/dm-' || v_username ELSE NULL END
    );

    RETURN jsonb_build_object(
        'id', v_app,
        'projectSlug', v_project.slug,
        'stageId', v_stage.id,
        'status', 'pending'
    );
END;
$$;

COMMENT ON FUNCTION projects.redeem_invite_link(text, text) IS
'The holder of an active stage invite link asks to join: a pending project application on the link''s stage (invite_link_id set), project_activity, and application.received to the owner. Refused with the fn_invite_link_state sentence (DETAIL state=…) for every state but open. Seats nobody.';
-- #endregion


-- #region Invitation note mask (SEC L6)
-- An invitation's `message` is the client's intro — the first thing a stranger reads from them.
-- projects.invite_to_project masks it in the protected phase, but "Owner manages invitations"
-- (00002011) is a FOR ALL policy, so the owner can also INSERT or UPDATE the row directly and skip that
-- door. This BEFORE trigger is the floor every path meets: the same mask, in the same phase, on every
-- write that sets the note. Masking an already-masked note changes nothing, so the door's own pass and
-- this one compose. SECURITY DEFINER so the mask does not depend on the writer's EXECUTE grants.
CREATE OR REPLACE FUNCTION projects.tg_mask_invitation_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.message IS NULL OR NEW.message = '' OR NOT projects.is_protected_phase(NEW.project_id) THEN
        RETURN NEW;
    END IF;
    SELECT m.masked INTO NEW.message FROM comms.mask_pii(NEW.message) m;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION projects.tg_mask_invitation_message() IS
'BEFORE INSERT OR UPDATE OF message on projects.project_invitations: masks contact details in the note while the project is in its protected phase, whichever path wrote it.';
-- #endregion
