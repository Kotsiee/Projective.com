-- =============================================================================================
-- 00001061_functions_org_data_export.sql — a person's copy of their own data (Decision #450).
--
-- Settings → Account files a request (org.request_data_export); the `account-data-exports` job
-- (00005060, POST /api/user/cron/data-exports) claims it, reads each domain through
-- security.collect_data_export, uploads one ZIP to the private `data_exports` bucket and settles the
-- row; the same job removes each archive once its 7 days are up. The rules:
--   * one open request at a time, and at most one per 24 hours (a failed one does not count);
--   * refused while an account erasure is scheduled;
--   * the session must have signed in within the last 10 minutes — the newest `amr` timestamp on the
--     verified access token, whatever the method — so a stolen session cookie cannot take a copy;
--   * minors (13–17) may export: it is their own right of access.
-- The constants are mirrored by DATA_EXPORT_POLICY (@projective/types/org).
-- =============================================================================================

-- #region 1. Helpers
-- The newest moment the session authenticated, from the verified token's `amr` (one entry per method
-- the session signed in with, each a unix `timestamp`). A refresh keeps it; a fresh sign-in renews it.
-- NULL without a token or an `amr`, which every caller reads as stale.
CREATE OR REPLACE FUNCTION org.fn_session_signed_in_at()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT max(pg_catalog.to_timestamp((e.value ->> 'timestamp')::double precision))
      FROM pg_catalog.jsonb_array_elements(
               CASE WHEN pg_catalog.jsonb_typeof(auth.jwt() -> 'amr') = 'array'
                    THEN auth.jwt() -> 'amr' ELSE '[]'::jsonb END) AS e (value)
     WHERE pg_catalog.jsonb_typeof(e.value -> 'timestamp') = 'number';
$$;

-- Where p_user stands: the latest request (a ready one past its expiry reads `expired`), when the
-- 24-hour limit lets the next one be filed, whether this session's sign-in is fresh enough, and
-- whether an erasure is scheduled.
CREATE OR REPLACE FUNCTION org.fn_data_export_state(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH latest AS (
        SELECT r.* FROM org.data_export_requests r
         WHERE r.user_id = p_user
         ORDER BY r.requested_at DESC, r.id DESC
         LIMIT 1
    ), counted AS (
        SELECT max(r.requested_at) AS last_at FROM org.data_export_requests r
         WHERE r.user_id = p_user AND r.status <> 'failed'
    )
    SELECT jsonb_build_object(
        'latest', (
            SELECT jsonb_build_object(
                'id', l.id,
                'status', CASE WHEN l.status = 'ready' AND l.expires_at <= now() THEN 'expired' ELSE l.status END,
                'requested_at', l.requested_at,
                'ready_at', l.ready_at,
                'expires_at', l.expires_at,
                'byte_size', l.byte_size,
                'failure_reason', l.failure_reason)
              FROM latest l),
        'next_request_at', (
            SELECT CASE WHEN c.last_at > now() - interval '24 hours' THEN c.last_at + interval '24 hours' END
              FROM counted c),
        'sign_in_fresh', COALESCE(org.fn_session_signed_in_at() >= now() - interval '10 minutes', false),
        'account_closing', EXISTS (
            SELECT 1 FROM org.deletion_requests d
             WHERE d.user_id = p_user AND d.scope = 'account' AND d.status = 'scheduled'));
$$;

-- Fail a request for good: tell the person (unless an erasure overtook it) and record it.
CREATE OR REPLACE FUNCTION org.fn_fail_data_export(p_request uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user uuid;
BEGIN
    UPDATE org.data_export_requests
       SET status = 'failed', failed_at = now(), failure_reason = p_reason
     WHERE id = p_request AND status IN ('pending', 'building')
    RETURNING user_id INTO v_user;
    IF v_user IS NULL THEN
        RETURN;
    END IF;
    IF p_reason <> 'account_erased' THEN
        PERFORM comms.fn_notify(
            v_user, 'account.data_export_failed', 'Your data copy couldn''t be prepared',
            CASE p_reason
                WHEN 'too_large' THEN 'It came out too large to store. Contact us and we''ll send it another way.'
                ELSE 'Something went wrong while we were preparing it. You can request it again from Settings.'
            END,
            'data_export_requests', p_request, jsonb_build_object('reason', p_reason), NULL, NULL, NULL, NULL,
            '/settings/account#data-export');
    END IF;
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_user, 'account.data_export_failed', 'org.data_export_requests', p_request,
            jsonb_build_object('reason', p_reason));
END;
$$;
-- #endregion

-- #region 2. The person's doors
CREATE OR REPLACE FUNCTION org.get_data_export()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;
    RETURN org.fn_data_export_state(v_uid);
END;
$$;

COMMENT ON FUNCTION org.get_data_export() IS
'The caller''s latest data export request, when the next may be filed, whether the session signed in recently enough, and whether an erasure is scheduled (Decision #450).';

CREATE OR REPLACE FUNCTION org.request_data_export()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_last timestamptz;
    v_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;

    -- The account-lifecycle lock: a request and an erasure being scheduled never interleave.
    PERFORM pg_advisory_xact_lock(hashtext('account-lifecycle:' || v_uid::text));

    IF NOT EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = v_uid) THEN
        RAISE EXCEPTION 'profile_required' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
        SELECT 1 FROM org.deletion_requests d
         WHERE d.user_id = v_uid AND d.scope = 'account' AND d.status = 'scheduled'
    ) THEN
        RAISE EXCEPTION 'account_closing' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
        SELECT 1 FROM org.data_export_requests r
         WHERE r.user_id = v_uid AND r.status IN ('pending', 'building')
    ) THEN
        RAISE EXCEPTION 'already_pending' USING ERRCODE = 'P0001';
    END IF;

    SELECT max(r.requested_at) INTO v_last
      FROM org.data_export_requests r
     WHERE r.user_id = v_uid AND r.status <> 'failed';
    IF v_last > now() - interval '24 hours' THEN
        RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001',
            DETAIL = to_jsonb(v_last + interval '24 hours') #>> '{}';
    END IF;

    -- Asked last, so nobody is sent to sign in again only to be refused for another reason.
    IF COALESCE(org.fn_session_signed_in_at() < now() - interval '10 minutes', true) THEN
        RAISE EXCEPTION 'reauth_required' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO org.data_export_requests (user_id) VALUES (v_uid) RETURNING id INTO v_id;
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, 'account.data_export_requested', 'org.data_export_requests', v_id, '{}'::jsonb);

    RETURN org.fn_data_export_state(v_uid);
END;
$$;

COMMENT ON FUNCTION org.request_data_export() IS
'Files a request for a copy of the caller''s own data. Refuses account_closing (an erasure is scheduled) / already_pending (one is open) / rate_limited (DETAIL = when the next may be filed; 24 h, a failed request not counted) / reauth_required (no sign-in in the last 10 minutes). Decision #450.';
-- #endregion

-- #region 3. The job's doors (service role)
-- The service role holds USAGE on `security` and not on `org` (the purge_due_account_deletions
-- precedent), so the export job reaches every step through here.

-- Claim up to p_limit open requests, oldest first: every pending one, and a building one whose worker
-- died (started over 30 minutes ago). Each claim counts an attempt; one that has used its three fails.
CREATE OR REPLACE FUNCTION security.claim_data_exports(p_limit integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req record;
    v_out jsonb := '[]'::jsonb;
BEGIN
    FOR v_req IN
        SELECT r.id, r.user_id, r.attempts, r.requested_at FROM org.data_export_requests r
         WHERE r.status = 'pending'
            OR (r.status = 'building' AND r.started_at < now() - interval '30 minutes')
         ORDER BY r.requested_at
         LIMIT GREATEST(LEAST(COALESCE(p_limit, 5), 50), 1)
         FOR UPDATE SKIP LOCKED
    LOOP
        IF v_req.attempts >= 3 THEN
            PERFORM org.fn_fail_data_export(v_req.id, 'build_failed');
            CONTINUE;
        END IF;
        UPDATE org.data_export_requests
           SET status = 'building', started_at = now(), attempts = attempts + 1
         WHERE id = v_req.id;
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'id', v_req.id, 'user_id', v_req.user_id, 'attempts', v_req.attempts + 1,
            'requested_at', v_req.requested_at));
    END LOOP;
    RETURN v_out;
END;
$$;

-- Settle a built archive: the path must be the request's own (`{user_id}/{id}.zip`). Ready for 7
-- days, announced in-app with a link to Settings, never to the archive itself (the link is minted per
-- read). False when the request is no longer building — an erasure failed it meanwhile — so the job
-- removes what it uploaded.
CREATE OR REPLACE FUNCTION security.complete_data_export(
    p_request uuid,
    p_path text,
    p_bytes bigint,
    p_manifest_version integer
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req org.data_export_requests;
BEGIN
    SELECT * INTO v_req FROM org.data_export_requests r WHERE r.id = p_request FOR UPDATE;
    IF NOT FOUND OR v_req.status <> 'building' THEN
        RETURN false;
    END IF;
    IF p_path IS DISTINCT FROM v_req.user_id::text || '/' || v_req.id::text || '.zip' THEN
        RAISE EXCEPTION 'path_mismatch' USING ERRCODE = '22023';
    END IF;
    IF p_bytes IS NULL OR p_bytes < 0 OR p_manifest_version IS NULL OR p_manifest_version < 1 THEN
        RAISE EXCEPTION 'archive_invalid' USING ERRCODE = '22023';
    END IF;

    UPDATE org.data_export_requests
       SET status = 'ready', ready_at = now(), expires_at = now() + interval '7 days',
           storage_path = p_path, byte_size = p_bytes, manifest_version = p_manifest_version
     WHERE id = p_request;

    PERFORM comms.fn_notify(
        v_req.user_id, 'account.data_export_ready', 'Your data is ready to download',
        'Download it from Settings → Account within 7 days.',
        'data_export_requests', p_request, '{}'::jsonb, NULL, NULL, NULL, NULL,
        '/settings/account#data-export', NULL, now() + interval '7 days');
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_req.user_id, 'account.data_export_ready', 'org.data_export_requests', p_request,
            jsonb_build_object('bytes', p_bytes, 'manifest_version', p_manifest_version));
    RETURN true;
END;
$$;

-- Hand a claimed request back: a `build_failed` one with attempts left goes back to pending for the
-- next run; anything else (out of attempts, `too_large`) fails for good. Answers the new status, or
-- NULL when the request was not building.
CREATE OR REPLACE FUNCTION security.release_data_export(p_request uuid, p_reason text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req org.data_export_requests;
BEGIN
    IF p_reason IS NULL OR p_reason NOT IN ('build_failed', 'too_large') THEN
        RAISE EXCEPTION 'reason_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_req FROM org.data_export_requests r WHERE r.id = p_request FOR UPDATE;
    IF NOT FOUND OR v_req.status <> 'building' THEN
        RETURN NULL;
    END IF;
    IF p_reason = 'build_failed' AND v_req.attempts < 3 THEN
        UPDATE org.data_export_requests SET status = 'pending' WHERE id = p_request;
        RETURN 'pending';
    END IF;
    PERFORM org.fn_fail_data_export(p_request, p_reason);
    RETURN 'failed';
END;
$$;

-- Ready archives past their expiry (an erasure brings the expiry forward to now), oldest first.
CREATE OR REPLACE FUNCTION security.due_data_export_expiries(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'storage_path', d.storage_path) ORDER BY d.expires_at), '[]'::jsonb)
      FROM (
        SELECT r.id, r.storage_path, r.expires_at FROM org.data_export_requests r
         WHERE r.status = 'ready' AND r.expires_at <= now()
         ORDER BY r.expires_at
         LIMIT GREATEST(LEAST(COALESCE(p_limit, 50), 500), 1)
      ) d;
$$;

-- Mark an archive expired once the job has removed it from storage. The row stays as the record.
CREATE OR REPLACE FUNCTION security.expire_data_export(p_request uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE org.data_export_requests
       SET status = 'expired', expired_at = now()
     WHERE id = p_request AND status = 'ready' AND expires_at <= now();
    RETURN FOUND;
END;
$$;
-- #endregion

-- #region 4. The collectors (one per archive domain)
-- Each answers one domain of p_user's own data, column by column, so nothing new is exported until it
-- is chosen here. Never exported: credentials and secrets (tokens, hashes, passcodes, share slugs,
-- provider references, embeddings), connector internals, and other people's personal data — their
-- messages, their ids on shared rows, who reviewed, who completed a task. Other people appear only by
-- @handle, as thread participants. Reached only through security.collect_data_export.

-- Projects the person holds personally: owned outside any workspace, or bought as the client.
CREATE OR REPLACE FUNCTION org.fn_export_own_project_ids(p_user uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT p.id FROM projects.projects p
     WHERE (p.owner_user_id = p_user AND p.owner_team_id IS NULL AND p.owner_enterprise_id IS NULL)
        OR p.client_user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION org.fn_export_profile(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'account', (
            SELECT jsonb_build_object('user_id', a.id, 'email', a.email, 'email_confirmed_at', a.email_confirmed_at,
                       'created_at', a.created_at, 'last_sign_in_at', a.last_sign_in_at)
              FROM auth.users a WHERE a.id = p_user),
        'profile', (
            SELECT jsonb_build_object('username', u.username, 'first_name', u.first_name, 'last_name', u.last_name,
                       'headline', u.headline, 'bio', u.bio, 'city', u.city, 'country', u.country,
                       'timezone', u.timezone, 'languages', u.languages, 'interests', u.interests, 'dob', u.dob,
                       'visibility', u.visibility, 'is_freelancer', u.is_freelancer,
                       'created_at', u.created_at, 'updated_at', u.updated_at)
              FROM org.users_public u WHERE u.user_id = p_user),
        'freelancer', (
            SELECT jsonb_build_object('skills', f.skills, 'availability_status', f.availability_status,
                       'available_since', f.available_since, 'max_workload_intensity', f.max_workload_intensity,
                       'kyc_status', f.kyc_status, 'kyc_verified_at', f.kyc_verified_at, 'hire_intake', f.hire_intake,
                       'created_at', f.created_at, 'updated_at', f.updated_at)
              FROM org.freelancer_profiles f WHERE f.user_id = p_user),
        'languages', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('code', l.code, 'level', l.level) ORDER BY l.code), '[]'::jsonb)
              FROM org.user_languages l WHERE l.user_id = p_user),
        'education', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('school', e.school, 'credential', e.credential, 'field', e.field,
                       'start_year', e.start_year, 'end_year', e.end_year, 'created_at', e.created_at)
                       ORDER BY e.sort_order, e.created_at), '[]'::jsonb)
              FROM org.education_entries e WHERE e.user_id = p_user),
        'experience', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('org_name', x.org_name, 'role', x.role,
                       'start_year', x.start_year, 'end_year', x.end_year, 'is_current', x.is_current,
                       'summary', x.summary, 'created_at', x.created_at)
                       ORDER BY x.sort_order, x.created_at), '[]'::jsonb)
              FROM org.experience_entries x WHERE x.user_id = p_user),
        'certifications', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('name', c.name, 'issuer', c.issuer,
                       'issued_year', c.issued_year, 'expires_year', c.expires_year,
                       'credential_url', c.credential_url, 'verified', c.verified, 'created_at', c.created_at)
                       ORDER BY c.sort_order, c.created_at), '[]'::jsonb)
              FROM org.certifications c WHERE c.user_id = p_user),
        'portfolio', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('title', p.title, 'description', p.description,
                       'client_name', p.client_name, 'category', p.category, 'is_public', p.is_public,
                       'created_at', p.created_at, 'archived_at', p.archived_at)
                       ORDER BY p.sort_order, p.created_at), '[]'::jsonb)
              FROM org.portfolios p WHERE p.user_id = p_user),
        'handle_changes', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('old_handle', h.old_handle, 'new_handle', h.new_handle,
                       'changed_at', h.changed_at) ORDER BY h.changed_at), '[]'::jsonb)
              FROM org.handle_changes h WHERE h.user_id = p_user));
$$;

CREATE OR REPLACE FUNCTION org.fn_export_emails(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('email', e.email, 'is_primary', e.is_primary,
               'verified_at', e.verified_at, 'created_at', e.created_at) ORDER BY e.created_at), '[]'::jsonb)
      FROM org.user_emails e WHERE e.user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION org.fn_export_preferences(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'display', (
            SELECT jsonb_build_object('theme', p.theme, 'locale', p.locale,
                       'preferred_display_currency', p.preferred_display_currency,
                       'layout_direction', p.layout_direction, 'contrast', p.contrast, 'font', p.font,
                       'cvd', p.cvd, 'motion', p.motion, 'date_format', p.date_format, 'ui_settings', p.ui_settings)
              FROM org.user_preferences p WHERE p.user_id = p_user),
        'notifications', (
            SELECT jsonb_build_object('email', n.email, 'push', n.push, 'in_app', n.in_app, 'sms', n.sms,
                       'digest', n.digest, 'digest_frequency', n.digest_frequency, 'digest_hour', n.digest_hour,
                       'digest_weekday', n.digest_weekday, 'timezone', n.timezone,
                       'quiet_hours_enabled', n.quiet_hours_enabled, 'quiet_hours_start', n.quiet_hours_start,
                       'quiet_hours_end', n.quiet_hours_end, 'muted_until', n.muted_until, 'locale', n.locale,
                       'read_receipts', n.read_receipts, 'show_typing_indicator', n.show_typing_indicator,
                       'sound', n.sound, 'auto_responses_enabled', n.auto_responses_enabled)
              FROM comms.notification_prefs n WHERE n.user_id = p_user),
        'notification_categories', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('category', c.category, 'in_app', c.in_app, 'push', c.push,
                       'email', c.email, 'sms', c.sms, 'digest_frequency', c.digest_frequency)
                       ORDER BY c.category), '[]'::jsonb)
              FROM comms.notification_category_prefs c WHERE c.user_id = p_user));
$$;

CREATE OR REPLACE FUNCTION org.fn_export_projects(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'slug', p.slug,
               'role', CASE WHEN p.owner_user_id = p_user AND p.owner_team_id IS NULL AND p.owner_enterprise_id IS NULL
                            THEN 'owner' ELSE 'client' END,
               'title', p.title, 'description', p.description_text, 'format', p.format, 'status', p.status,
               'visibility', p.visibility, 'currency', p.currency, 'budget_type', p.budget_type,
               'budget_amount_cents', p.budget_amount_cents, 'created_at', p.created_at,
               'updated_at', p.updated_at, 'archived_at', p.archived_at,
               'stages', (
                   SELECT COALESCE(jsonb_agg(jsonb_build_object('slug', s.slug, 'name', s.name,
                              'description', s.description_text, 'status', s.status, 'sort_order', s.sort_order,
                              'unit_price_cents', s.unit_price_cents, 'created_at', s.created_at,
                              'completed_at', s.completed_at, 'archived_at', s.archived_at)
                              ORDER BY s.sort_order, s.created_at), '[]'::jsonb)
                     FROM projects.project_stages s WHERE s.project_id = p.id),
               'tickets', (
                   SELECT COALESCE(jsonb_agg(jsonb_build_object('slug', t.slug, 'title', t.title,
                              'description', t.text_description, 'status', t.status, 'priority', t.priority,
                              'due_date', t.due_date, 'workload_intensity', t.workload_intensity,
                              'payment_status', t.payment_status, 'unit_price_cents', t.unit_price_cents,
                              'total_amount_paid', t.total_amount_paid, 'created_at', t.created_at,
                              'updated_at', t.updated_at)
                              ORDER BY t.created_at, t.slug), '[]'::jsonb)
                     FROM projects.tickets t WHERE t.project_id = p.id))
               ORDER BY p.created_at, p.slug), '[]'::jsonb)
      FROM projects.projects p
     WHERE p.id IN (SELECT org.fn_export_own_project_ids(p_user));
$$;

-- What the person did in projects they do not hold: seats, stage assignments, claimed tickets, and
-- the submissions they made.
CREATE OR REPLACE FUNCTION org.fn_export_contributions(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    WITH theirs AS (
        SELECT p.id, p.slug, p.title FROM projects.projects p
         WHERE p.id NOT IN (SELECT org.fn_export_own_project_ids(p_user))
    )
    SELECT jsonb_build_object(
        'memberships', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('project_slug', t.slug, 'project_title', t.title,
                       'role', pp.role, 'joined_at', pp.created_at) ORDER BY pp.created_at), '[]'::jsonb)
              FROM projects.project_participants pp JOIN theirs t ON t.id = pp.project_id
             WHERE pp.profile_type = 'freelancer' AND pp.profile_id = p_user),
        'stage_assignments', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('project_slug', t.slug, 'stage_slug', s.slug,
                       'stage_name', s.name, 'status', sa.status, 'assigned_at', sa.created_at)
                       ORDER BY sa.created_at), '[]'::jsonb)
              FROM projects.stage_assignments sa
              JOIN projects.project_stages s ON s.id = sa.project_stage_id
              JOIN theirs t ON t.id = s.project_id
             WHERE sa.freelancer_profile_id = p_user),
        'claimed_tickets', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('project_slug', t.slug, 'ticket_slug', k.slug,
                       'title', k.title, 'status', k.status, 'claimed_at', k.claimed_at)
                       ORDER BY k.claimed_at, k.slug), '[]'::jsonb)
              FROM projects.tickets k JOIN theirs t ON t.id = k.project_id
             WHERE k.current_assignee_id = p_user),
        'submissions', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('project_slug', t.slug, 'stage_slug', s.slug,
                       'ticket_slug', k.slug, 'number', ss.number, 'title', ss.title, 'notes', ss.notes,
                       'status', ss.status, 'created_at', ss.created_at, 'reviewed_at', ss.reviewed_at)
                       ORDER BY ss.created_at), '[]'::jsonb)
              FROM projects.stage_submissions ss
              JOIN projects.project_stages s ON s.id = ss.project_stage_id
              JOIN theirs t ON t.id = s.project_id
              LEFT JOIN projects.tickets k ON k.id = ss.ticket_id
             WHERE ss.submitted_by = p_user));
$$;

-- Messages the person SENT, never anyone else's, and the metadata of every conversation they are in.
CREATE OR REPLACE FUNCTION org.fn_export_messages(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'direct', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'thread', t.ref, 'body', m.body,
                       'has_attachments', m.has_attachments, 'is_audio', m.is_audio, 'reply_to_id', m.reply_to_id,
                       'created_at', m.created_at, 'deleted_at', m.deleted_at) ORDER BY m.created_at, m.id), '[]'::jsonb)
              FROM comms.dm_messages m JOIN comms.dm_threads t ON t.id = m.thread_id
             WHERE m.sender_user_id = p_user),
        'channel', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'project_slug', p.slug, 'channel', c.name,
                       'body', m.body, 'has_attachments', m.has_attachments, 'is_audio', m.is_audio,
                       'reply_to_id', m.reply_to_id, 'created_at', m.created_at, 'edited_at', m.edited_at,
                       'deleted_at', m.deleted_at) ORDER BY m.created_at, m.id), '[]'::jsonb)
              FROM comms.project_messages m
              JOIN comms.project_channels c ON c.id = m.channel_id
              JOIN projects.projects p ON p.id = c.project_id
             WHERE m.sender_user_id = p_user),
        'threads', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('ref', t.ref, 'kind', t.kind, 'title', t.title,
                       'created_at', t.created_at, 'last_message_at', t.last_message_at,
                       'joined_at', dp.joined_at, 'last_read_at', dp.last_read_at, 'is_starred', dp.is_starred,
                       'is_muted', dp.is_muted, 'inbox_folder', dp.inbox_folder, 'left_at', dp.deleted_at,
                       'participants', (
                           SELECT COALESCE(jsonb_agg(u.username ORDER BY u.username), '[]'::jsonb)
                             FROM comms.dm_participants o JOIN org.users_public u ON u.user_id = o.user_id
                            WHERE o.thread_id = t.id AND o.user_id <> p_user))
                       ORDER BY t.created_at, t.id), '[]'::jsonb)
              FROM comms.dm_participants dp JOIN comms.dm_threads t ON t.id = dp.thread_id
             WHERE dp.user_id = p_user));
$$;

-- The manifest of the person's own files: what each is and how to recognise it, never its bytes.
CREATE OR REPLACE FUNCTION org.fn_export_files(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.display_name,
               'original_name', i.original_name, 'folder', f.name, 'mime_type', i.mime_type,
               'size_bytes', i.size_bytes, 'category', i.category, 'content_hash', i.content_hash,
               'hash_algo', i.hash_algo, 'hash_sampled', i.hash_sampled, 'status', i.status,
               'visibility', i.visibility, 'is_archived', i.is_archived, 'starred', i.starred,
               'link_url', i.link_url, 'link_title', i.link_title,
               'created_at', i.created_at, 'updated_at', i.updated_at) ORDER BY i.created_at, i.id), '[]'::jsonb)
      FROM files.items i LEFT JOIN files.folders f ON f.id = i.folder_id
     WHERE i.owner_user_id = p_user AND i.owner_type = 'user' AND i.deleted_at IS NULL;
$$;

-- The person's own wallets (client and earnings, never a team or business one) and their ledgers.
CREATE OR REPLACE FUNCTION org.fn_export_wallet(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', w.id, 'kind', w.owner_type, 'currency', w.currency,
               'balance_cents', w.balance_cents, 'created_at', w.created_at,
               'transactions', (
                   SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'direction', x.direction,
                              'amount_cents', x.amount_cents, 'currency', x.currency, 'reason', x.reason,
                              'ref_table', x.ref_table, 'ref_id', x.ref_id,
                              'balance_after_cents', x.balance_after_cents, 'fund_state', x.fund_state,
                              'fx_rate', x.fx_rate, 'fx_base', x.fx_base, 'fx_as_of', x.fx_as_of,
                              'created_at', x.created_at) ORDER BY x.created_at, x.id), '[]'::jsonb)
                     FROM finance.transactions x WHERE x.wallet_id = w.id))
               ORDER BY w.owner_type, w.currency), '[]'::jsonb)
      FROM finance.wallets w
     WHERE w.owner_type IN ('user', 'freelancer') AND w.owner_id = p_user;
$$;

-- Invoices the person issued, their own wallet statements, and their own orders.
CREATE OR REPLACE FUNCTION org.fn_export_invoices(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'issued', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'invoice_type', i.invoice_type,
                       'status', i.status, 'currency', i.currency, 'subtotal_cents', i.subtotal_cents,
                       'platform_fee_cents', i.platform_fee_cents, 'tax_cents', i.tax_cents,
                       'total_cents', i.total_cents, 'amount_due_cents', i.amount_due_cents,
                       'billing_period_start', i.billing_period_start, 'billing_period_end', i.billing_period_end,
                       'due_date', i.due_date, 'paid_at', i.paid_at, 'created_at', i.created_at)
                       ORDER BY i.created_at, i.id), '[]'::jsonb)
              FROM finance.invoices i WHERE i.issue_from_profile = p_user),
        'statements', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('period_start', s.period_start, 'period_end', s.period_end,
                       'currency', s.currency, 'opening_balance_cents', s.opening_balance_cents,
                       'closing_balance_cents', s.closing_balance_cents, 'total_in_cents', s.total_in_cents,
                       'total_out_cents', s.total_out_cents, 'total_fees_cents', s.total_fees_cents,
                       'status', s.status, 'issued_at', s.issued_at) ORDER BY s.period_start, s.currency), '[]'::jsonb)
              FROM finance.statements s
             WHERE s.owner_type IN ('user', 'freelancer') AND s.owner_id = p_user),
        'orders', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('reference', o.reference, 'status', o.status,
                       'placed_at', o.placed_at, 'currency', o.currency, 'subtotal_minor', o.subtotal_minor,
                       'creator_discount_minor', o.creator_discount_minor,
                       'promo_discount_minor', o.promo_discount_minor, 'promo_code', o.promo_code,
                       'platform_fee_minor', o.platform_fee_minor, 'tax_minor', o.tax_minor,
                       'total_minor', o.total_minor, 'charged_minor', o.charged_minor,
                       'payment_method_label', o.payment_method_label, 'created_at', o.created_at)
                       ORDER BY o.created_at, o.reference), '[]'::jsonb)
              FROM finance.orders o WHERE o.owner_type = 'user' AND o.owner_id = p_user));
$$;

-- Reviews the person wrote, and those written about them or their own listings — never who wrote one.
CREATE OR REPLACE FUNCTION org.fn_export_reviews(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'written', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('target_type', r.target_entity_type,
                       'target_id', r.target_entity_id, 'rating', r.rating, 'title', r.title,
                       'comment', r.comment, 'reply', r.reply_comment, 'replied_at', r.replied_at,
                       'created_at', r.created_at, 'updated_at', r.updated_at) ORDER BY r.created_at, r.id), '[]'::jsonb)
              FROM reviews.entity_reviews r WHERE r.reviewer_user_id = p_user),
        'received', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('about', x.about, 'listing_title', x.listing_title,
                       'rating', x.rating, 'title', x.title, 'comment', x.comment, 'reply', x.reply_comment,
                       'replied_at', x.replied_at, 'created_at', x.created_at) ORDER BY x.created_at, x.id), '[]'::jsonb)
              FROM (
                SELECT r.id, 'you'::text AS about, NULL::text AS listing_title, r.rating, r.title, r.comment,
                       r.reply_comment, r.replied_at, r.created_at
                  FROM reviews.entity_reviews r
                 WHERE r.target_entity_type IN ('user', 'freelancer') AND r.target_entity_id = p_user
                   AND r.is_visible
                UNION ALL
                SELECT r.id, 'listing', l.title, r.rating, r.title, r.comment, r.reply_comment, r.replied_at, r.created_at
                  FROM catalogue.listings l
                  JOIN reviews.entity_reviews r
                    ON (r.target_entity_type = 'service_blueprint' AND r.target_entity_id = l.service_blueprint_id)
                    OR (r.target_entity_type = 'product' AND r.target_entity_id = l.product_id)
                 WHERE l.owner_user_id = p_user AND l.owner_team_id IS NULL
                   AND r.is_visible
              ) x));
$$;

CREATE OR REPLACE FUNCTION org.fn_export_saved(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'collections', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('name', c.name, 'created_at', c.created_at)
                       ORDER BY c.created_at, c.id), '[]'::jsonb)
              FROM org.user_bookmark_collections c WHERE c.user_id = p_user),
        'bookmarks', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('entity_type', b.entity_type, 'entity_id', b.entity_id,
                       'collection', c.name, 'created_at', b.created_at) ORDER BY b.created_at, b.id), '[]'::jsonb)
              FROM org.user_bookmarks b LEFT JOIN org.user_bookmark_collections c ON c.id = b.collection_id
             WHERE b.user_id = p_user));
$$;

-- The person's own calendar entries, and their answers to events others invited them to. No meeting
-- link or passcode: those are keys to someone's meeting room, not facts about the person.
CREATE OR REPLACE FUNCTION org.fn_export_calendar(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'entries', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'status', e.status,
                       'title', e.title, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'all_day', e.all_day,
                       'location', e.location, 'description', e.description,
                       'meeting_provider', e.meeting_provider_label, 'recurrence_rule', e.recurrence_rule,
                       'availability_behavior', e.availability_behavior, 'created_at', e.created_at,
                       'updated_at', e.updated_at, 'archived_at', e.archived_at) ORDER BY e.starts_at, e.id), '[]'::jsonb)
              FROM scheduling.events e JOIN scheduling.schedules s ON s.id = e.schedule_id
             WHERE s.owner_type = 'user' AND s.owner_id = p_user),
        'invitations', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('title', e.title, 'starts_at', e.starts_at,
                       'ends_at', e.ends_at, 'role', a.role, 'response', a.response,
                       'responded_at', a.responded_at, 'note', a.note) ORDER BY e.starts_at, a.id), '[]'::jsonb)
              FROM scheduling.event_attendees a JOIN scheduling.events e ON e.id = a.event_id
             WHERE a.user_id = p_user));
$$;

CREATE OR REPLACE FUNCTION org.fn_export_notifications(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('type', n.type, 'category', n.category, 'urgency', n.urgency,
               'title', n.title, 'body', n.body, 'action_url', n.action_url, 'created_at', n.created_at,
               'seen_at', n.seen_at, 'read_at', n.read_at, 'archived_at', n.archived_at)
               ORDER BY n.created_at, n.id), '[]'::jsonb)
      FROM comms.notifications n WHERE n.user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION org.fn_export_search(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'queries', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('query', q.search_query, 'filters', q.filters_applied,
                       'entity_type', q.entity_type, 'result_count', q.result_count, 'created_at', q.created_at)
                       ORDER BY q.created_at, q.id), '[]'::jsonb)
              FROM search.query_logs q WHERE q.user_id = p_user),
        'recent_views', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('entity_type', v.entity_type, 'entity_id', v.entity_id,
                       'view_count', v.view_count, 'first_viewed_at', v.first_viewed_at, 'viewed_at', v.viewed_at)
                       ORDER BY v.viewed_at, v.id), '[]'::jsonb)
              FROM org.recent_views v WHERE v.user_id = p_user));
$$;

-- Sign-ins (the auth server's audit trail, without its token refreshes), the open sessions, and the
-- platform's own audit rows about the person (without their metadata, which can name others).
CREATE OR REPLACE FUNCTION org.fn_export_security(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'sign_ins', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('action', e.payload ->> 'action',
                       'provider', e.payload -> 'traits' ->> 'provider',
                       'ip_address', NULLIF(e.ip_address, ''), 'at', e.created_at)
                       ORDER BY e.created_at, e.id), '[]'::jsonb)
              FROM auth.audit_log_entries e
             WHERE e.payload ->> 'actor_id' = p_user::text
               AND COALESCE(e.payload ->> 'action', '') <> 'token_refreshed'),
        'sessions', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('created_at', s.created_at, 'updated_at', s.updated_at,
                       'refreshed_at', s.refreshed_at, 'user_agent', s.user_agent, 'ip', s.ip, 'aal', s.aal,
                       'not_after', s.not_after) ORDER BY s.created_at, s.id), '[]'::jsonb)
              FROM auth.sessions s WHERE s.user_id = p_user),
        'activity', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('action', a.action, 'entity_table', a.entity_table,
                       'ip', a.ip, 'user_agent', a.user_agent, 'created_at', a.created_at)
                       ORDER BY a.created_at, a.id), '[]'::jsonb)
              FROM security.audit_logs a WHERE a.user_id = p_user));
$$;

-- The job's one read: a domain of a request it holds. Refused unless the request is building, so a
-- request an erasure failed (or a stray id) reads nothing.
CREATE OR REPLACE FUNCTION security.collect_data_export(p_request uuid, p_domain text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user uuid;
    v_out jsonb;
BEGIN
    SELECT r.user_id INTO v_user FROM org.data_export_requests r
     WHERE r.id = p_request AND r.status = 'building';
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'not_building' USING ERRCODE = 'P0002';
    END IF;
    v_out := CASE p_domain
        WHEN 'profile' THEN org.fn_export_profile(v_user)
        WHEN 'emails' THEN org.fn_export_emails(v_user)
        WHEN 'preferences' THEN org.fn_export_preferences(v_user)
        WHEN 'projects' THEN org.fn_export_projects(v_user)
        WHEN 'contributions' THEN org.fn_export_contributions(v_user)
        WHEN 'messages' THEN org.fn_export_messages(v_user)
        WHEN 'files' THEN org.fn_export_files(v_user)
        WHEN 'wallet' THEN org.fn_export_wallet(v_user)
        WHEN 'invoices' THEN org.fn_export_invoices(v_user)
        WHEN 'reviews' THEN org.fn_export_reviews(v_user)
        WHEN 'saved' THEN org.fn_export_saved(v_user)
        WHEN 'calendar' THEN org.fn_export_calendar(v_user)
        WHEN 'notifications' THEN org.fn_export_notifications(v_user)
        WHEN 'search' THEN org.fn_export_search(v_user)
        WHEN 'security' THEN org.fn_export_security(v_user)
    END;
    IF v_out IS NULL THEN
        RAISE EXCEPTION 'domain_invalid' USING ERRCODE = '22023';
    END IF;
    RETURN v_out;
END;
$$;
-- #endregion
