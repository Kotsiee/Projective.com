-- ============================================================================
-- 00001600 functions analytics
-- Consolidated verbatim from: 20260724110000_analytics_event_substrate.sql
-- ============================================================================

-- Can the current user see analytics attributed to this subject? Mirrors finance.fn_owner_visible's
-- posture (owner scope → membership) but covers the broader, non-money subject kinds. Project-scoped
-- and platform-scoped rows are admin-only; the app reads project analytics through the projects
-- domain, not here.
CREATE OR REPLACE FUNCTION analytics.fn_subject_visible(
    p_subject_kind analytics.subject_kind,
    p_subject_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = analytics, org, security, public
AS $$
    SELECT
        security.is_admin ()
        OR (p_subject_kind IN ('user', 'freelancer') AND p_subject_id = auth.uid ())
        OR (p_subject_kind = 'business' AND org.is_active_business_member (p_subject_id))
        OR (p_subject_kind = 'team' AND org.is_active_team_member (p_subject_id))
        OR (p_subject_kind = 'organisation' AND org.is_organisation_member (p_subject_id));
$$;

-- #endregion

-- #region 5. analytics.fn_emit — the single write path
-- SECURITY DEFINER so RLS-scoped callers (and the other three migrations in this set) can record an
-- event without a direct INSERT grant. `p_actor` defaults to auth.uid() — a client cannot spoof it,
-- because the parameter is ignored unless the caller is an admin or the service role.
CREATE OR REPLACE FUNCTION analytics.fn_emit(
    p_name text,
    p_subject_kind analytics.subject_kind,
    p_subject_id uuid DEFAULT NULL,
    p_properties jsonb DEFAULT '{}'::jsonb,
    p_value numeric DEFAULT NULL,
    p_project_id uuid DEFAULT NULL,
    p_domain text DEFAULT NULL,
    p_actor uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, security, public
AS $$
DECLARE
    v_id uuid;
    v_domain text;
    v_actor uuid;
BEGIN
    -- Trust the caller's actor only when it is privileged; otherwise attribute to the session user.
    v_actor := CASE
        WHEN p_actor IS NOT NULL AND (security.is_admin () OR auth.uid () IS NULL) THEN p_actor
        ELSE COALESCE(auth.uid (), p_actor)
    END;

    SELECT c.domain INTO v_domain FROM analytics.event_catalogue c WHERE c.name = p_name;

    INSERT INTO analytics.events (
        name, domain, subject_kind, subject_id, actor_user_id, project_id, value, properties
    ) VALUES (
        p_name,
        COALESCE(p_domain, v_domain, 'platform'),
        p_subject_kind,
        p_subject_id,
        v_actor,
        p_project_id,
        p_value,
        COALESCE(p_properties, '{}'::jsonb)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
EXCEPTION WHEN OTHERS THEN
    -- Telemetry must NEVER break the business transaction that emitted it.
    RETURN NULL;
END;
$$;
