-- ============================================================================================
-- 00001500_functions_integrations.sql — integrations schema functions (Category 1).
--
-- In-DB predicates the app needs WITHOUT ever exposing the token vault or the definer-only tables:
--   * Connector capability gates (does this user hold an active calendar/conferencing consent?).
--   * Plugin authorization gates (is this plugin installed for the user, with a given scope?).
--   * The shared updated_at touch trigger fn (its CREATE TRIGGERs live in
--     00001870_triggers_integrations.sql, after this file).
--
-- SECURITY DEFINER where a function must read a definer-only table (user_connections,
-- plugin_installations); STABLE and pinned search_path throughout.
-- ============================================================================================

-- #region Connector capability predicates
-- "Can this user's stored consents do X?" — the gates the scheduling/booking flow needs. DEFINER so
-- they can read the definer-only integrations.user_connections without granting it to `authenticated`.

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
-- #endregion

-- #region Plugin authorization predicates
-- Governs what a plugin surface may render/read at runtime, without exposing the installation table
-- (which carries other users' configs). DEFINER, scoped to the caller via auth.uid().

-- Is this plugin ACTIVE-installed for the current user (personal install)?
CREATE OR REPLACE FUNCTION integrations.fn_plugin_installed(p_plugin uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = integrations, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM integrations.plugin_installations i
        WHERE i.plugin_id = p_plugin
          AND i.installer_user_id = auth.uid ()
          AND i.status = 'active'::integrations.install_status
    );
$$;

-- Has the current user's active installation of a plugin been granted a given capability scope?
-- This is the gate the Plugin-API mediator checks before honouring a plugin's data request.
CREATE OR REPLACE FUNCTION integrations.fn_plugin_has_scope(p_plugin uuid, p_scope text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = integrations, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM integrations.plugin_installations i
        WHERE i.plugin_id = p_plugin
          AND i.installer_user_id = auth.uid ()
          AND i.status = 'active'::integrations.install_status
          AND p_scope = ANY (i.granted_scopes)
    );
$$;

-- Does the current user publish this plugin? Backs the "manage own plugin" developer policies.
CREATE OR REPLACE FUNCTION integrations.fn_is_plugin_publisher(p_plugin uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = integrations, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM integrations.plugins p
        WHERE p.id = p_plugin
          AND p.developer_user_id = auth.uid ()
    );
$$;
-- #endregion

-- #region Shared triggers
-- Touch updated_at on any row carrying that column. CREATE TRIGGERs are in
-- 00001870_triggers_integrations.sql (a trigger needs its function to exist first).
CREATE OR REPLACE FUNCTION integrations.fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Keep integrations.plugins.install_count in step as installations are added/removed. Counts only
-- ACTIVE installs; runs on INSERT/UPDATE(status)/DELETE of an installation.
CREATE OR REPLACE FUNCTION integrations.fn_recount_installs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = integrations, public
AS $$
DECLARE
    v_plugin uuid := COALESCE (NEW.plugin_id, OLD.plugin_id);
BEGIN
    UPDATE integrations.plugins p
    SET install_count = (
        SELECT count(*)
        FROM integrations.plugin_installations i
        WHERE i.plugin_id = v_plugin
          AND i.status = 'active'::integrations.install_status
    )
    WHERE p.id = v_plugin;
    RETURN NULL;
END;
$$;
-- #endregion
