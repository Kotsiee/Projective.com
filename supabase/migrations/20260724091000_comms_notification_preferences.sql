-- =============================================================================================
-- 20260724091000_comms_notification_preferences.sql
-- Notification engine foundation (2/5) — preference granularity, quiet hours & push registration.
--
-- ADDITIVE ONLY. Adds nullable/defaulted columns to the pre-existing `comms.notification_prefs`
-- and `comms.device_tokens`, plus two new preference tables and a seed-on-signup trigger. No
-- existing column, FK, trigger, or function is dropped or altered. Authored, NOT applied to any
-- live database.
--
-- WHAT WAS MISSING. `comms.notification_prefs` (migration 0008) is a SINGLE global row per user:
-- one `email` toggle, one `push` toggle, one `in_app` toggle, one boolean `digest`, and one
-- `quiet_hours tstzrange`. The routing matrix needs three things it cannot express:
--   1. PER-CATEGORY control — a freelancer muting `discovery` suggestions while keeping every
--      `money` and `work` alert. → `comms.notification_category_prefs`.
--   2. PER-TYPE control — muting exactly one noisy event (`message.reaction`) without muting its
--      whole category, and muting it TEMPORARILY. → `comms.notification_type_mutes`.
--   3. RECURRING quiet hours. `quiet_hours tstzrange` is an ABSOLUTE instant range: it can express
--      "quiet from 2026-07-24T22:00Z to 2026-07-25T07:00Z" but NOT "quiet 22:00–07:00 every night in
--      Europe/London". → `quiet_hours_start`/`quiet_hours_end` (local `time`) + `timezone`.
--
-- ⚠️ FLAGGED SUPERSESSION (surface, do not silently resolve — root CLAUDE.md §8). Two pre-existing
-- columns are kept (the Additive Rule forbids dropping them) but are NO LONGER the source of truth:
--   * `quiet_hours tstzrange` → superseded by `quiet_hours_enabled` + `quiet_hours_start`/`_end` +
--     `timezone`. `comms.fn_is_quiet_hours` (migration 4/5) reads the recurring columns and honours
--     the legacy range only as an additional absolute window, so an existing row keeps working.
--   * `digest boolean` → superseded by `digest_frequency`. The new column is BACKFILLED from the
--     boolean below (`true` → `'daily'`), so no user silently loses their digest.
-- Dropping the two legacy columns needs human sign-off and is not done here.
--
-- ⚠️ ALSO FLAGGED: `org.user_preferences` (migration 0213) carries `notification_email` /
-- `notification_push` — a SECOND, coarser copy of the same two toggles, seeded on signup by
-- `org.seed_user_preferences` (migration 20260722120000, Decision #47). `comms.notification_prefs`
-- is the notification engine's source of truth; the `org.*` pair is the profile-settings mirror.
-- They are NOT reconciled here (that means choosing which one wins for existing accounts, a data
-- decision) — reconcile with a human.
-- =============================================================================================

-- #region 1. comms.notification_prefs — recurring quiet hours, digest cadence, global snooze
ALTER TABLE comms.notification_prefs
    -- Fourth transport toggle, matching `comms.notification_channel`. `webhook` is not a user
    -- preference (it is an integration), so it has no toggle here.
    ADD COLUMN IF NOT EXISTS sms boolean NOT NULL DEFAULT false,
    -- Authoritative digest cadence (supersedes the legacy `digest boolean`).
    ADD COLUMN IF NOT EXISTS digest_frequency comms.digest_frequency NOT NULL DEFAULT 'off',
    -- Local hour-of-day the digest is delivered (0–23, in `timezone`).
    ADD COLUMN IF NOT EXISTS digest_hour smallint NOT NULL DEFAULT 8,
    -- ISO-8601 weekday for a weekly digest: 1 = Monday … 7 = Sunday. NULL for a daily digest.
    ADD COLUMN IF NOT EXISTS digest_weekday smallint,
    -- IANA zone the local-time columns are evaluated in. The single most important column here:
    -- without it "quiet at 22:00" is meaningless.
    ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC',
    ADD COLUMN IF NOT EXISTS quiet_hours_enabled boolean NOT NULL DEFAULT false,
    -- Local wall-clock window. `start > end` is legal and means the window crosses midnight
    -- (22:00 → 07:00) — the predicate in migration 4/5 handles both orientations.
    ADD COLUMN IF NOT EXISTS quiet_hours_start time,
    ADD COLUMN IF NOT EXISTS quiet_hours_end time,
    -- Global snooze ("pause everything until…"). `critical` catalog rows still pierce this.
    ADD COLUMN IF NOT EXISTS muted_until timestamptz,
    -- Message-body language for email/push copy. Falls back to `org.user_preferences.locale`.
    ADD COLUMN IF NOT EXISTS locale text,
    -- How long an unread, escalatable notification waits before the email fallback fires
    -- (the "still unread after 15 minutes → email" rule). NULL = never escalate for this user.
    ADD COLUMN IF NOT EXISTS escalate_after interval NOT NULL DEFAULT '15 minutes',
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
    ALTER TABLE comms.notification_prefs
        ADD CONSTRAINT notification_prefs_digest_hour_check CHECK (digest_hour BETWEEN 0 AND 23);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE comms.notification_prefs
        ADD CONSTRAINT notification_prefs_digest_weekday_check CHECK (digest_weekday IS NULL OR digest_weekday BETWEEN 1 AND 7);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Quiet hours are only meaningful with BOTH bounds present.
DO $$ BEGIN
    ALTER TABLE comms.notification_prefs
        ADD CONSTRAINT notification_prefs_quiet_hours_complete
        CHECK (NOT quiet_hours_enabled OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- A weekly digest needs a weekday.
DO $$ BEGIN
    ALTER TABLE comms.notification_prefs
        ADD CONSTRAINT notification_prefs_weekly_needs_weekday
        CHECK (digest_frequency <> 'weekly' OR digest_weekday IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN null; END $$;

COMMENT ON COLUMN comms.notification_prefs.quiet_hours IS
    'LEGACY (migration 0008): an absolute tstzrange. Superseded by quiet_hours_enabled + quiet_hours_start/_end + timezone, which express a RECURRING nightly window. Retained under the Additive Rule and still honoured as an extra absolute window.';
COMMENT ON COLUMN comms.notification_prefs.digest IS
    'LEGACY (migration 0008): boolean digest opt-in. Superseded by digest_frequency (backfilled from this column). Retained under the Additive Rule.';
COMMENT ON COLUMN comms.notification_prefs.escalate_after IS
    'How long an unread escalatable notification waits before the email fallback fires. Consumed by comms.fn_escalate_unread (migration 5/5).';

-- Backfill the new cadence from the legacy boolean so nobody loses an opted-in digest.
UPDATE comms.notification_prefs
SET digest_frequency = 'daily'
WHERE digest IS TRUE AND digest_frequency = 'off';
-- #endregion

-- #region 2. comms.notification_category_prefs — per-category transport overrides
-- A row here NARROWS the global toggles for one category. Absence of a row means "inherit the
-- global prefs" — so the table stays sparse and a new category needs no backfill.
CREATE TABLE IF NOT EXISTS comms.notification_category_prefs (
    user_id uuid NOT NULL,
    category comms.notification_category NOT NULL,
    -- NULL = inherit the corresponding global toggle on comms.notification_prefs.
    in_app boolean,
    push boolean,
    email boolean,
    sms boolean,
    -- NULL = inherit the global cadence. `'off'` here means "deliver this category in real time".
    digest_frequency comms.digest_frequency,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_category_prefs_pkey PRIMARY KEY (user_id, category),
    CONSTRAINT notification_category_prefs_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE CASCADE
);

COMMENT ON TABLE comms.notification_category_prefs IS
    'Sparse per-category transport overrides. A NULL column inherits the global comms.notification_prefs toggle; an absent row inherits everything. Mandatory catalog events ignore these entirely.';
-- #endregion

-- #region 3. comms.notification_type_mutes — surgical, optionally temporary mutes
-- The finest grain: "stop telling me about `message.reaction`", optionally "until Monday".
-- A mute on a `mandatory` catalog row is accepted at the table level but IGNORED by the router —
-- security, legal, money-movement and moderation events are never suppressible.
CREATE TABLE IF NOT EXISTS comms.notification_type_mutes (
    user_id uuid NOT NULL,
    -- Canonical catalog key. Not a FK: the catalog is policy, not a gate (migration 1/5), and a
    -- user's mute must survive a type being retired and re-registered.
    type_key text NOT NULL,
    -- NULL = muted indefinitely. A past instant means the mute has lapsed (rows are kept, not
    -- deleted, so the preference centre can show "you un-muted this on …").
    muted_until timestamptz,
    -- Optional narrowing: mute only these transports. Empty/NULL = mute every transport.
    channels comms.notification_channel[],
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_type_mutes_pkey PRIMARY KEY (user_id, type_key),
    CONSTRAINT notification_type_mutes_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE CASCADE
);

-- No partial predicate on `muted_until > now()` — `now()` is not IMMUTABLE and is rejected in an
-- index predicate. The lapsed-mute filter is applied by the router at query time instead.
CREATE INDEX IF NOT EXISTS idx_notification_type_mutes_lookup
    ON comms.notification_type_mutes (user_id, type_key) INCLUDE (muted_until);

COMMENT ON TABLE comms.notification_type_mutes IS
    'Per-event-key mutes, optionally time-boxed and optionally per-transport. A mute on a mandatory catalog type is stored but ignored by comms.fn_resolve_channels.';
-- #endregion

-- #region 4. comms.device_tokens — real push registration (additive columns)
-- The 0008 shape is (id, user_id, provider, token, created_at) — enough to store a string, not
-- enough to actually send a Web Push message (which needs the subscription endpoint plus the
-- `p256dh` and `auth` keys) or to retire a dead token.
ALTER TABLE comms.device_tokens
    ADD COLUMN IF NOT EXISTS platform comms.device_platform NOT NULL DEFAULT 'web',
    -- Web Push subscription endpoint (FCM/APNs use `token` instead).
    ADD COLUMN IF NOT EXISTS endpoint text,
    -- Web Push subscription keys. These are per-subscription transport credentials generated by the
    -- browser — NOT user PII and NOT a platform secret. They are useless without the server's VAPID
    -- private key, which lives in the Edge Function environment, never in the database.
    ADD COLUMN IF NOT EXISTS p256dh text,
    ADD COLUMN IF NOT EXISTS auth_key text,
    -- Human label for the device list in settings ("Chrome on Windows").
    ADD COLUMN IF NOT EXISTS label text,
    ADD COLUMN IF NOT EXISTS user_agent text,
    ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
    -- Soft retirement (root CLAUDE.md §5 — nothing is hard-deleted). A revoked token is skipped by
    -- the router but stays for the audit trail.
    ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
    ADD COLUMN IF NOT EXISTS revoked_reason text,
    -- Consecutive gateway failures. The dispatcher auto-revokes at a threshold so a dead token
    -- stops costing a request per notification.
    ADD COLUMN IF NOT EXISTS failure_count smallint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- One live registration per (user, token). Re-registering the same browser must UPDATE, not
-- accumulate duplicates that each cost a push send.
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tokens_user_token_live
    ON comms.device_tokens (user_id, token)
    WHERE revoked_at IS NULL;

-- The router's hot path: every live token for a recipient.
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_live
    ON comms.device_tokens (user_id, platform)
    WHERE revoked_at IS NULL;

COMMENT ON COLUMN comms.device_tokens.auth_key IS
    'Web Push subscription auth secret (browser-generated, per-subscription). Not user PII and not a platform secret — the VAPID private key stays in the Edge Function environment. Cleared when the token is revoked.';
-- #endregion

-- #region 5. Preference provisioning — seed on signup, plus a one-time backfill
-- Mirrors org.seed_user_preferences (migration 20260722120000, Decision #47): a focused AFTER
-- INSERT trigger on org.users_public rather than re-declaring either provisioning routine. A
-- SEPARATE trigger name is used — `on_users_public_created` already exists and is not touched.
CREATE OR REPLACE FUNCTION comms.seed_notification_prefs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Idempotent: 1:1 on user_id, and a lazily-created row must not be clobbered. Column defaults
    -- supply the values (in_app + email on, push off, digest off, no quiet hours).
    INSERT INTO comms.notification_prefs (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION comms.seed_notification_prefs() IS
    'Seeds a default comms.notification_prefs row when a public profile is created (email + OAuth signup paths). Idempotent. Companion to org.seed_user_preferences (Decision #47).';

DROP TRIGGER IF EXISTS on_users_public_created_notification_prefs ON org.users_public;
CREATE TRIGGER on_users_public_created_notification_prefs
    AFTER INSERT ON org.users_public
    FOR EACH ROW EXECUTE FUNCTION comms.seed_notification_prefs();

-- Callable ensure-helper for any path that needs prefs to exist right now (the API's
-- read-then-write settings flow, the digest builder).
CREATE OR REPLACE FUNCTION comms.fn_ensure_notification_prefs(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = comms, public
AS $$
    INSERT INTO comms.notification_prefs (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
$$;

-- One-time backfill for every profile that predates this migration.
INSERT INTO comms.notification_prefs (user_id)
SELECT up.user_id FROM org.users_public AS up
ON CONFLICT (user_id) DO NOTHING;
-- #endregion

-- #region 6. updated_at triggers
DROP TRIGGER IF EXISTS trg_notification_prefs_touch ON comms.notification_prefs;
CREATE TRIGGER trg_notification_prefs_touch
    BEFORE UPDATE ON comms.notification_prefs
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_notification_category_prefs_touch ON comms.notification_category_prefs;
CREATE TRIGGER trg_notification_category_prefs_touch
    BEFORE UPDATE ON comms.notification_category_prefs
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_notification_type_mutes_touch ON comms.notification_type_mutes;
CREATE TRIGGER trg_notification_type_mutes_touch
    BEFORE UPDATE ON comms.notification_type_mutes
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_device_tokens_touch ON comms.device_tokens;
CREATE TRIGGER trg_device_tokens_touch
    BEFORE UPDATE ON comms.device_tokens
    FOR EACH ROW EXECUTE FUNCTION comms.fn_touch_updated_at();
-- #endregion
