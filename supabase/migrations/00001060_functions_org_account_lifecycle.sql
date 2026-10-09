-- =============================================================================================
-- 00001060_functions_org_account_lifecycle.sql — the person's own account lifecycle (Category 1:
-- functions). Zod SSOT: packages/types/org/account-lifecycle.ts.
--
--   org.get_handle_policy / org.change_username   the @handle change policy: two changes inside a
--                                                  three-day window, then a 90-day lock; a released
--                                                  handle is held for 90 days so nobody else can take it
--   org.get_account_lifecycle                     what is scheduled, and what blocks scheduling
--   org.schedule_freelancer_removal               freelancer → client; the profile is erased in 90 days
--   org.schedule_account_deletion                 the whole account is erased in 30 days
--   org.cancel_deletion_request                   undo either, restoring exactly what scheduling paused
--   org.fn_purge_due_deletions                    (service role) the sweep that runs the erasure
--
-- Refusals are the exception MESSAGE with SQLSTATE `P0001` and are one of the `AccountRefusal`
-- codes; a blocked schedule carries the blocker codes, comma-separated, in DETAIL. Nothing is
-- deleted from the product's own tables: listings are archived, profile content is cleared, and the
-- request row is the record that the erasure ran. The one exception is GoTrue's credentials
-- (`auth.identities`, `auth.sessions`), which an erased account must not keep.
-- =============================================================================================

-- #region 1. Handle policy
-- Mirrors HANDLE_POLICY in packages/types/org/account-lifecycle.ts.
CREATE OR REPLACE FUNCTION org.fn_handle_change_policy(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_last timestamptz;
    v_prev timestamptz;
    v_total integer;
    v_remaining integer := 2;
    v_window_ends timestamptz := NULL;
    v_locked_until timestamptz := NULL;
BEGIN
    SELECT h.changed_at INTO v_last
      FROM org.handle_changes h WHERE h.user_id = p_user
     ORDER BY h.changed_at DESC LIMIT 1;
    SELECT h.changed_at INTO v_prev
      FROM org.handle_changes h WHERE h.user_id = p_user
     ORDER BY h.changed_at DESC OFFSET 1 LIMIT 1;
    SELECT count(*) INTO v_total FROM org.handle_changes h WHERE h.user_id = p_user;

    IF v_last IS NOT NULL AND v_prev IS NOT NULL
       AND v_last - v_prev <= interval '3 days'
       AND now() < v_last + interval '90 days' THEN
        v_remaining := 0;
        v_locked_until := v_last + interval '90 days';
    ELSIF v_last IS NOT NULL AND now() < v_last + interval '3 days' THEN
        v_remaining := 1;
        v_window_ends := v_last + interval '3 days';
    END IF;

    RETURN jsonb_build_object(
        'remaining', v_remaining,
        'window_ends_at', v_window_ends,
        'locked_until', v_locked_until,
        'last_changed_at', v_last,
        'total_changes', v_total
    );
END;
$$;

-- A released handle is held for its previous owner: only they may take it back inside 90 days.
CREATE OR REPLACE FUNCTION org.fn_handle_is_own_hold(p_handle text, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT NOT (
            EXISTS (SELECT 1 FROM org.users_public u WHERE lower(u.username) = lower(p_handle))
            OR EXISTS (SELECT 1 FROM org.teams t WHERE lower(t.slug) = lower(p_handle))
            OR EXISTS (SELECT 1 FROM org.business_profiles b WHERE lower(b.slug) = lower(p_handle))
            OR EXISTS (SELECT 1 FROM org.organisations o WHERE lower(o.handle) = lower(p_handle))
        )
        AND EXISTS (
            SELECT 1 FROM org.handle_changes h
             WHERE lower(h.old_handle) = lower(p_handle) AND h.user_id = p_user
               AND h.changed_at > now() - interval '90 days'
        )
        AND NOT EXISTS (
            SELECT 1 FROM org.handle_changes h
             WHERE lower(h.old_handle) = lower(p_handle) AND h.user_id <> p_user
               AND h.changed_at > now() - interval '90 days'
        );
$$;

CREATE OR REPLACE FUNCTION org.get_handle_policy()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_handle text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;
    SELECT u.username INTO v_handle FROM org.users_public u WHERE u.user_id = v_uid;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'profile_required' USING ERRCODE = '42501';
    END IF;
    RETURN org.fn_handle_change_policy(v_uid) || jsonb_build_object('handle', v_handle);
END;
$$;

CREATE OR REPLACE FUNCTION org.change_username(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_new text := lower(btrim(COALESCE(p_handle, '')));
    v_old text;
    v_reason text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('handle-change:' || v_uid::text));
    PERFORM pg_advisory_xact_lock(hashtext('handle:' || v_new));

    SELECT u.username INTO v_old FROM org.users_public u WHERE u.user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'profile_required' USING ERRCODE = '42501';
    END IF;
    IF lower(v_old) = v_new THEN
        RAISE EXCEPTION 'handle_unchanged' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
        SELECT 1 FROM org.deletion_requests d
         WHERE d.user_id = v_uid AND d.scope = 'account' AND d.status = 'scheduled'
    ) THEN
        RAISE EXCEPTION 'account_closing' USING ERRCODE = 'P0001';
    END IF;
    IF (org.fn_handle_change_policy(v_uid) ->> 'remaining')::integer = 0 THEN
        RAISE EXCEPTION 'handle_locked' USING ERRCODE = 'P0001';
    END IF;

    v_reason := org.fn_handle_refusal(v_new);
    IF v_reason = 'That handle is taken.' AND org.fn_handle_is_own_hold(v_new, v_uid) THEN
        v_reason := NULL;
    END IF;
    IF v_reason IS NOT NULL THEN
        RAISE EXCEPTION 'handle_refused' USING ERRCODE = 'P0001', DETAIL = v_reason;
    END IF;

    BEGIN
        UPDATE org.users_public SET username = v_new, updated_at = now() WHERE user_id = v_uid;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'handle_refused' USING ERRCODE = 'P0001', DETAIL = 'That handle is taken.';
    END;

    INSERT INTO org.handle_changes (user_id, old_handle, new_handle) VALUES (v_uid, v_old, v_new);
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, 'user.handle_changed', 'org.users_public', v_uid,
            jsonb_build_object('from', v_old, 'to', v_new));

    RETURN org.fn_handle_change_policy(v_uid)
        || jsonb_build_object('handle', v_new, 'previous', v_old);
END;
$$;

COMMENT ON FUNCTION org.change_username(text) IS
'Changes the caller''s @handle. Refuses handle_unchanged / handle_locked / account_closing / handle_refused (DETAIL = the namespace rule''s sentence). Two changes within three days lock changes for 90 days.';
-- #endregion

-- #region 2. What blocks a removal
-- Blocker codes (BLOCKER_CODES in packages/types/org/account-lifecycle.ts): money held in escrow,
-- live work, a wallet that still holds money, live projects the person owns, workspaces they own.
CREATE OR REPLACE FUNCTION org.fn_account_blockers(p_user uuid, p_scope text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_out text[] := '{}'::text[];
BEGIN
    IF EXISTS (
        SELECT 1 FROM finance.escrows e
         WHERE e.status = 'held'
           AND ((e.payee_type = 'freelancer' AND e.payee_id = p_user)
             OR (p_scope = 'account' AND e.payer_user_id = p_user))
    ) THEN
        v_out := array_append(v_out, 'escrow_held');
    END IF;

    IF EXISTS (
        SELECT 1 FROM projects.stage_assignments sa
          JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
          JOIN projects.projects pr ON pr.id = ps.project_id
         WHERE sa.freelancer_profile_id = p_user
           AND sa.status NOT IN ('declined', 'cancelled', 'released', 'completed')
           AND pr.status IN ('active', 'on_hold')
    ) THEN
        v_out := array_append(v_out, 'live_work');
    END IF;

    IF EXISTS (
        SELECT 1 FROM finance.wallets w
         WHERE w.owner_id = p_user AND w.balance_cents > 0
           AND (w.owner_type = 'freelancer' OR (p_scope = 'account' AND w.owner_type = 'user'))
    ) THEN
        v_out := array_append(v_out, 'wallet_balance');
    END IF;

    IF p_scope = 'account' THEN
        IF EXISTS (
            SELECT 1 FROM projects.projects pr
             WHERE pr.owner_user_id = p_user AND pr.status IN ('active', 'on_hold')
        ) THEN
            v_out := array_append(v_out, 'active_projects');
        END IF;
        IF EXISTS (
            SELECT 1 FROM org.team_members tm JOIN org.teams t ON t.id = tm.team_id
             WHERE tm.user_id = p_user AND tm.role = 'owner' AND tm.status = 'active'
               AND t.status <> 'archived'
        ) OR EXISTS (
            SELECT 1 FROM org.business_members bm JOIN org.business_profiles b ON b.id = bm.business_id
             WHERE bm.user_id = p_user AND bm.role = 'owner' AND bm.status = 'active'
               AND b.status <> 'archived'
        ) OR EXISTS (
            SELECT 1 FROM org.organisation_members om
             WHERE om.user_id = p_user AND om.role = 'owner' AND om.status = 'active'
        ) THEN
            v_out := array_append(v_out, 'owns_workspaces');
        END IF;
    END IF;

    RETURN v_out;
END;
$$;
-- #endregion

-- #region 3. Reading the lifecycle
CREATE OR REPLACE FUNCTION org.fn_deletion_request_json(p_user uuid, p_scope text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'id', d.id,
        'scope', d.scope,
        'status', d.status,
        'requested_at', d.requested_at,
        'scheduled_for', d.scheduled_for
    )
      FROM org.deletion_requests d
     WHERE d.user_id = p_user AND d.scope = p_scope AND d.status = 'scheduled'
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION org.get_account_lifecycle()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_is_freelancer boolean;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;
    SELECT u.is_freelancer INTO v_is_freelancer FROM org.users_public u WHERE u.user_id = v_uid;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'profile_required' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
        'is_freelancer', v_is_freelancer,
        'has_freelancer_profile', EXISTS (SELECT 1 FROM org.freelancer_profiles f WHERE f.user_id = v_uid),
        'freelancer_removal', org.fn_deletion_request_json(v_uid, 'freelancer_profile'),
        'account_deletion', org.fn_deletion_request_json(v_uid, 'account'),
        'freelancer_blockers', to_jsonb(org.fn_account_blockers(v_uid, 'freelancer_profile')),
        'account_blockers', to_jsonb(org.fn_account_blockers(v_uid, 'account'))
    );
END;
$$;
-- #endregion

-- #region 4. Scheduling and cancelling
-- Pause what the person sells on their own (team listings belong to the team) and remember exactly
-- which rows were paused, so a cancel republishes those and nothing else.
CREATE OR REPLACE FUNCTION org.fn_pause_personal_listings(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_listings jsonb;
    v_services jsonb;
BEGIN
    WITH paused AS (
        UPDATE catalogue.listings l SET status = 'paused', updated_at = now()
         WHERE l.owner_user_id = p_user AND l.owner_team_id IS NULL AND l.status = 'published'
        RETURNING l.id
    )
    SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_listings FROM paused;

    WITH hidden AS (
        UPDATE marketplace.service_blueprints s SET is_published = false
         WHERE s.freelancer_profile_id = p_user AND s.owner_type = 'freelancer' AND s.is_published
        RETURNING s.id
    )
    SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_services FROM hidden;

    RETURN jsonb_build_object('paused_listings', v_listings, 'unpublished_services', v_services);
END;
$$;

CREATE OR REPLACE FUNCTION org.fn_restore_personal_listings(p_user uuid, p_metadata jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE catalogue.listings l SET status = 'published', updated_at = now()
     WHERE l.owner_user_id = p_user AND l.status = 'paused'
       AND l.id IN (
           SELECT (x.value)::uuid FROM jsonb_array_elements_text(COALESCE(p_metadata -> 'paused_listings', '[]'::jsonb)) x
       );
    UPDATE marketplace.service_blueprints s SET is_published = true
     WHERE s.freelancer_profile_id = p_user AND NOT s.is_published
       AND s.id IN (
           SELECT (x.value)::uuid FROM jsonb_array_elements_text(COALESCE(p_metadata -> 'unpublished_services', '[]'::jsonb)) x
       );
END;
$$;

-- Cancel a person's open request of one scope; false when there is none. Shared by the cancel door
-- and by org.enable_freelancer_profile (becoming a freelancer again inside the window is a cancel).
CREATE OR REPLACE FUNCTION org.fn_cancel_deletion(p_user uuid, p_scope text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req org.deletion_requests;
BEGIN
    SELECT * INTO v_req FROM org.deletion_requests d
     WHERE d.user_id = p_user AND d.scope = p_scope AND d.status = 'scheduled'
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    PERFORM org.fn_restore_personal_listings(p_user, v_req.metadata);
    IF p_scope = 'freelancer_profile' THEN
        UPDATE org.users_public SET is_freelancer = true, updated_at = now() WHERE user_id = p_user;
    ELSE
        UPDATE org.users_public
           SET visibility = COALESCE(v_req.metadata ->> 'prior_visibility', visibility), updated_at = now()
         WHERE user_id = p_user;
    END IF;

    UPDATE org.deletion_requests SET status = 'cancelled', cancelled_at = now() WHERE id = v_req.id;
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (p_user, 'account.deletion_cancelled', 'org.deletion_requests', v_req.id,
            jsonb_build_object('scope', p_scope));
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION org.schedule_freelancer_removal(p_confirmation text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_is_freelancer boolean;
    v_blockers text[];
    v_paused jsonb;
    v_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;
    IF COALESCE(p_confirmation, '') <> 'CONFIRM' THEN
        RAISE EXCEPTION 'confirmation_mismatch' USING ERRCODE = 'P0001';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('account-lifecycle:' || v_uid::text));

    SELECT u.is_freelancer INTO v_is_freelancer FROM org.users_public u WHERE u.user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'profile_required' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
        SELECT 1 FROM org.deletion_requests d
         WHERE d.user_id = v_uid AND d.scope = 'freelancer_profile' AND d.status = 'scheduled'
    ) THEN
        RAISE EXCEPTION 'already_scheduled' USING ERRCODE = 'P0001';
    END IF;
    IF NOT v_is_freelancer THEN
        RAISE EXCEPTION 'not_freelancer' USING ERRCODE = 'P0001';
    END IF;

    v_blockers := org.fn_account_blockers(v_uid, 'freelancer_profile');
    IF cardinality(v_blockers) > 0 THEN
        RAISE EXCEPTION 'blocked' USING ERRCODE = 'P0001', DETAIL = array_to_string(v_blockers, ',');
    END IF;

    v_paused := org.fn_pause_personal_listings(v_uid);
    UPDATE org.users_public SET is_freelancer = false, updated_at = now() WHERE user_id = v_uid;
    PERFORM security.fn_set_session_context(NULL, NULL, NULL, NULL, v_uid);

    INSERT INTO org.deletion_requests (user_id, scope, scheduled_for, metadata)
    VALUES (v_uid, 'freelancer_profile', now() + interval '90 days', v_paused)
    RETURNING id INTO v_id;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, 'freelancer.removal_scheduled', 'org.deletion_requests', v_id, v_paused);

    RETURN org.fn_deletion_request_json(v_uid, 'freelancer_profile');
END;
$$;

COMMENT ON FUNCTION org.schedule_freelancer_removal(text) IS
'Freelancer → client: requires the typed confirmation CONFIRM; refuses not_freelancer / already_scheduled / blocked (DETAIL = blocker codes). Pauses personal listings, drops the persona at once, and schedules the erasure for 90 days. Cancelled by org.cancel_deletion_request or by becoming a freelancer again.';

CREATE OR REPLACE FUNCTION org.schedule_account_deletion(p_confirmation text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_visibility text;
    v_blockers text[];
    v_meta jsonb;
    v_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;
    IF COALESCE(p_confirmation, '') <> 'CONFIRM' THEN
        RAISE EXCEPTION 'confirmation_mismatch' USING ERRCODE = 'P0001';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('account-lifecycle:' || v_uid::text));

    SELECT u.visibility INTO v_visibility FROM org.users_public u WHERE u.user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'profile_required' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
        SELECT 1 FROM org.deletion_requests d
         WHERE d.user_id = v_uid AND d.scope = 'account' AND d.status = 'scheduled'
    ) THEN
        RAISE EXCEPTION 'already_scheduled' USING ERRCODE = 'P0001';
    END IF;

    v_blockers := org.fn_account_blockers(v_uid, 'account');
    IF cardinality(v_blockers) > 0 THEN
        RAISE EXCEPTION 'blocked' USING ERRCODE = 'P0001', DETAIL = array_to_string(v_blockers, ',');
    END IF;

    v_meta := org.fn_pause_personal_listings(v_uid) || jsonb_build_object('prior_visibility', v_visibility);
    UPDATE org.users_public SET visibility = 'private', updated_at = now() WHERE user_id = v_uid;

    INSERT INTO org.deletion_requests (user_id, scope, scheduled_for, metadata)
    VALUES (v_uid, 'account', now() + interval '30 days', v_meta)
    RETURNING id INTO v_id;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, 'account.deletion_scheduled', 'org.deletion_requests', v_id, v_meta);

    RETURN org.fn_deletion_request_json(v_uid, 'account');
END;
$$;

COMMENT ON FUNCTION org.schedule_account_deletion(text) IS
'Schedules the caller''s account for erasure in 30 days: requires CONFIRM; refuses already_scheduled / blocked (DETAIL = blocker codes). Hides the profile and pauses personal listings at once; org.cancel_deletion_request restores both.';

CREATE OR REPLACE FUNCTION org.cancel_deletion_request(p_scope text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;
    IF p_scope IS NULL OR p_scope NOT IN ('freelancer_profile', 'account') THEN
        RAISE EXCEPTION 'scope_invalid' USING ERRCODE = 'P0001';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('account-lifecycle:' || v_uid::text));
    IF NOT org.fn_cancel_deletion(v_uid, p_scope) THEN
        RAISE EXCEPTION 'not_scheduled' USING ERRCODE = 'P0001';
    END IF;
    RETURN org.get_account_lifecycle();
END;
$$;
-- #endregion

-- #region 5. The erasure sweep (service role)
-- Erase what only a seller has: listings archive (terminal, never deleted), services unpublish, and
-- the seller's own profile content is cleared. Standing, reviews and money records stay — they are
-- other people's evidence and the regulator's (PRODUCT_SPEC §Security, 7-year retention).
CREATE OR REPLACE FUNCTION org.fn_erase_freelancer_profile(p_user uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE catalogue.listings l SET status = 'archived', updated_at = now()
     WHERE l.owner_user_id = p_user AND l.owner_team_id IS NULL AND l.status <> 'archived';
    UPDATE marketplace.service_blueprints s SET is_published = false
     WHERE s.freelancer_profile_id = p_user AND s.owner_type = 'freelancer' AND s.is_published;
    UPDATE org.freelancer_profiles f
       SET skills = '{}'::text[], hire_intake = '[]'::jsonb, identity_provider_ref = NULL,
           availability_status = 'unavailable', updated_at = now()
     WHERE f.user_id = p_user;
    UPDATE org.users_public SET is_freelancer = false, updated_at = now() WHERE user_id = p_user;
END;
$$;

-- Erase the person: the seller half, then every personal field on the profile, the secondary
-- addresses, and the sign-in credentials. The profile row stays as an anonymous tombstone so the
-- money, reviews and work it is referenced by stay explicable.
CREATE OR REPLACE FUNCTION org.fn_erase_account(p_user uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tag text := substr(replace(p_user::text, '-', ''), 1, 12);
BEGIN
    PERFORM org.fn_erase_freelancer_profile(p_user);
    UPDATE org.users_public
       SET username = 'deleted-' || v_tag, first_name = '', last_name = '', headline = '',
           bio = '{}'::jsonb, city = NULL, country = NULL, timezone = NULL, languages = '{}'::text[],
           interests = '{}'::text[], avatar_file_id = NULL, banner_file_id = NULL,
           visibility = 'private', dob = DATE '1900-01-01', updated_at = now()
     WHERE user_id = p_user;
    UPDATE org.user_emails e
       SET email = 'erased-' || e.id::text || '@invalid.invalid', verified_at = NULL
     WHERE e.user_id = p_user;
    UPDATE auth.users
       SET email = 'erased+' || v_tag || '@invalid.invalid', phone = NULL,
           raw_user_meta_data = '{}'::jsonb, banned_until = 'infinity'
     WHERE id = p_user;
    DELETE FROM auth.identities WHERE user_id = p_user;
    DELETE FROM auth.sessions WHERE user_id = p_user;
END;
$$;

-- Run every due erasure. A request whose blockers came back since it was scheduled (a client who
-- funded a new escrow during the grace period) is deferred, not forced: the reason is recorded and
-- the next sweep tries again.
CREATE OR REPLACE FUNCTION org.fn_purge_due_deletions(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req org.deletion_requests;
    v_blockers text[];
    v_done integer := 0;
BEGIN
    FOR v_req IN
        SELECT * FROM org.deletion_requests d
         WHERE d.status = 'scheduled' AND d.scheduled_for <= now()
         ORDER BY d.scheduled_for
         LIMIT GREATEST(COALESCE(p_limit, 100), 1)
         FOR UPDATE SKIP LOCKED
    LOOP
        v_blockers := org.fn_account_blockers(v_req.user_id, v_req.scope);
        IF cardinality(v_blockers) > 0 THEN
            UPDATE org.deletion_requests
               SET metadata = metadata || jsonb_build_object(
                       'deferred_at', now(), 'deferred_by', to_jsonb(v_blockers))
             WHERE id = v_req.id;
            CONTINUE;
        END IF;

        IF v_req.scope = 'freelancer_profile' THEN
            PERFORM org.fn_erase_freelancer_profile(v_req.user_id);
        ELSE
            PERFORM org.fn_erase_account(v_req.user_id);
        END IF;

        UPDATE org.deletion_requests SET status = 'completed', completed_at = now() WHERE id = v_req.id;
        INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
        VALUES (v_req.user_id, 'account.erasure_completed', 'org.deletion_requests', v_req.id,
                jsonb_build_object('scope', v_req.scope));
        v_done := v_done + 1;
    END LOOP;
    RETURN v_done;
END;
$$;
-- #endregion

-- #region 6. The service role's door
-- The service role holds USAGE on `security` and not on `org`, so the scheduler reaches the sweep
-- through here (the security.issue_email_verification precedent).
CREATE OR REPLACE FUNCTION security.purge_due_account_deletions(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT org.fn_purge_due_deletions(p_limit);
$$;
-- #endregion
