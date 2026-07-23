-- Seed default user preferences on profile creation — email AND OAuth sign-up paths.
-- ---------------------------------------------------------------------------------
-- Closes a gap in provisioning (root CLAUDE.md Decision #47). The `on_auth_user_created` trigger's
-- `public.provision_user_profile` (migration 0304) creates `org.users_public` + `org.user_emails` +
-- `security.session_context`, and the OAuth completion path (`public.complete_onboarding`) creates
-- the same `org.users_public` row — but NEITHER seeds an `org.user_preferences` row. Preferences were
-- created only lazily (an INSERT-own-preferences RLS policy), so a fresh account had no defaults for
-- theme / notification channels / locale until it first wrote one.
--
-- Rather than re-declare either provisioning routine (and risk drift), this attaches a small, focused
-- trigger to `org.users_public` itself: whenever a public profile row is created — by the email path,
-- the OAuth completion path, or any future path — a default `org.user_preferences` row is seeded. The
-- table's own column defaults supply the values (`theme='system'`, `notification_email=true`,
-- `notification_push=false`, `locale='en-GB'`, `ui_settings='{}'`), so this inserts only the key.
--
-- Purely additive: a new function + a new trigger + a one-time backfill. No table, column, FK, policy,
-- or existing function/trigger is dropped or altered (the Additive Rule). Timestamped so it runs after
-- every 0xxx migration and the prior 20260715 hook migration.

-- #region 1. Seed-on-profile-create trigger function
CREATE OR REPLACE FUNCTION org.seed_user_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Idempotent: the profile→preferences relationship is 1:1 on user_id, and a lazily-created row (via
  -- the INSERT-own-preferences RLS policy) must not be clobbered.
  INSERT INTO org.user_preferences (user_id)
  VALUES (NEW.user_id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.seed_user_preferences() IS
  'Seeds a default org.user_preferences row when a public profile is created (email + OAuth signup). Idempotent (ON CONFLICT DO NOTHING). See root CLAUDE.md Decision #47.';
-- #endregion

-- #region 2. Attach to org.users_public
DROP TRIGGER IF EXISTS on_users_public_created ON org.users_public;

CREATE TRIGGER on_users_public_created
AFTER INSERT ON org.users_public
FOR EACH ROW EXECUTE FUNCTION org.seed_user_preferences();
-- #endregion

-- #region 3. One-time backfill for existing profiles
-- Give every profile that predates this trigger its default preferences too. Idempotent — a profile
-- that already has a preferences row is skipped.
INSERT INTO org.user_preferences (user_id)
SELECT up.user_id
FROM org.users_public AS up
ON CONFLICT (user_id) DO NOTHING;
-- #endregion
