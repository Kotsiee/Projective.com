-- ============================================================================
-- 00001500 functions integrations
-- Consolidated verbatim from: 20260724101000_integrations_connections.sql
-- ============================================================================

-- #endregion

-- #region 6. Capability predicates
-- "Can this user's stored consents do X?" — the in-DB gates the booking flow needs without ever
-- exposing the token store. SECURITY DEFINER so they can read the definer-only table.

-- Does the user hold an ACTIVE connection capable of the given kind?
CREATE OR REPLACE FUNCTION integrations.fn_has_capability(
    p_user uuid, p_kind integrations.provider_kind
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = integrations, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM integrations.user_connections c
        WHERE c.user_id = p_user
          AND c.status = 'active'::integrations.connection_status
          AND p_kind = ANY (c.granted_kinds)
    );
$$;

-- The provider slug that should mint a meeting room for this user, or NULL when none is connected
-- (the caller then falls back to a platform-hosted room or a manual link).
CREATE OR REPLACE FUNCTION integrations.fn_conferencing_provider(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = integrations, public
AS $$
    SELECT c.provider_slug
    FROM integrations.user_connections c
    WHERE c.user_id = p_user
      AND c.status = 'active'::integrations.connection_status
      AND 'conferencing'::integrations.provider_kind = ANY (c.granted_kinds)
    ORDER BY c.updated_at DESC
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION integrations.fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
