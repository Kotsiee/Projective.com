-- ============================================================================
-- 00001010 functions org onboarding
-- Consolidated verbatim from: 0304_onboarding_session_and_audit.sql, 0312_email_verification_sync.sql, 0315_create_enterprise_rpc.sql, 20260722120000_seed_user_preferences.sql
-- ============================================================================

-- US-001 · Multi-Persona Onboarding — provisioning, session context (AC4) & audit (AC6)
--
-- Onboarding provisioning lives in SECURITY DEFINER Postgres functions:
--   * public.provision_user_profile(...) — the single reusable routine that creates
--     the profile rows, initialises security.session_context (AC4) and writes the
--     'user.onboarded' audit entry (AC6). audit_logs is not granted to the
--     `authenticated` role (see 0205), so it can only be written from a definer
--     context — that is why provisioning lives here, not in a TS backend service.
--   * public.handle_new_user() — the on_auth_user_created trigger. It provisions the
--     profile immediately ONLY when the required identity data is present. The
--     email/password wizard supplies username + dob via signUp metadata, so those
--     accounts are provisioned at once. OAuth sign-ups (Google) arrive with NO
--     username/dob — provisioning them here would violate users_public.username
--     NOT NULL and make Gotrue return "Database error saving new user", aborting the
--     handshake. Instead those accounts are created profile-less (isOnboarded =
--     false) and finish onboarding on /join via public.complete_onboarding().
--   * public.complete_onboarding(jsonb) — RPC an already-authenticated user (an OAuth
--     sign-up on /join) calls to provision their profile. Granted to `authenticated`.

-- #region Reusable provisioning routine
CREATE OR REPLACE FUNCTION public.provision_user_profile(
    p_user_id uuid,
    p_email text,
    p_email_confirmed_at timestamptz,
    p_meta jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, org, pg_temp
AS $$
DECLARE
    v_is_freelancer boolean := false;
    v_first_name text;
    v_last_name text;
    v_username text;
    v_dob date;
    v_objective text;
    v_skills text[];
    v_interests text[];
    v_avatar_file_id uuid;
    v_timezone text;
    v_active_profile_type public.profile_type;
    v_active_profile_id uuid;
BEGIN
    v_first_name := p_meta->>'first_name';
    v_last_name := p_meta->>'last_name';
    v_username := p_meta->>'username';
    v_dob := (p_meta->>'dob')::date;
    -- The browser's zone becomes the profile's, and is the zone its birthdays are counted in
    -- (Decision #192); an unknown one is dropped and the age counts in UTC.
    v_timezone := org.fn_valid_time_zone(NULLIF(p_meta->>'timezone', ''));
    -- Every path lands here — the GoTrue signup trigger and complete_onboarding alike — so the age
    -- floor holds even for a client that skips /join (Decision #190).
    PERFORM org.fn_check_dob(v_dob, v_timezone);
    v_objective := p_meta->>'objective';
    v_avatar_file_id := NULLIF(p_meta->>'avatar_file_id', '')::uuid;

    -- A seller persona needs an adult: someone under 18 who chose "I want to work" starts as a client
    -- and unlocks selling at 18 (Decisions #190, #192).
    IF (v_objective = 'freelancer' OR v_objective = 'seller')
       AND org.fn_age_years(v_dob, v_timezone) >= 18 THEN
        v_is_freelancer := true;
    END IF;

    IF p_meta ? 'skills' AND jsonb_typeof(p_meta->'skills') = 'array' THEN
        SELECT ARRAY(SELECT jsonb_array_elements_text(p_meta->'skills')) INTO v_skills;
    ELSE
        v_skills := '{}'::text[];
    END IF;

    IF p_meta ? 'interests' AND jsonb_typeof(p_meta->'interests') = 'array' THEN
        SELECT ARRAY(SELECT jsonb_array_elements_text(p_meta->'interests')) INTO v_interests;
    ELSE
        v_interests := '{}'::text[];
    END IF;

    -- The preference seeders on org.users_public read this payload: complete_onboarding's never
    -- reaches auth.users (org.fn_signup_meta, Decision #207).
    PERFORM pg_catalog.set_config(
        'projective.signup_meta', jsonb_build_object('user_id', p_user_id, 'meta', p_meta)::text, true
    );

    -- 1. Core profile
    INSERT INTO org.users_public (
        user_id, first_name, last_name, username, dob, timezone, visibility,
        interests, is_freelancer, avatar_file_id
    ) VALUES (
        p_user_id, v_first_name, v_last_name, v_username, v_dob, v_timezone, 'unlisted',
        v_interests, v_is_freelancer, v_avatar_file_id
    );

    -- 2. Email relationship (handles NULL verification times automatically)
    INSERT INTO org.user_emails (user_id, email, is_primary, verified_at)
    VALUES (p_user_id, p_email, true, p_email_confirmed_at);

    -- 3. Persona routing → resolve the account's initial active profile
    IF v_is_freelancer THEN
        INSERT INTO org.freelancer_profiles (user_id, skills)
        VALUES (p_user_id, v_skills);

        -- Freelancer profiles are keyed by user_id, so the active profile id is the user id.
        v_active_profile_type := 'freelancer';
        v_active_profile_id := p_user_id;
    ELSE
        -- Client/buyer persona: no owned profile exists yet (a Business is created
        -- later in US-002), so the account starts with no active profile selected.
        v_active_profile_type := NULL;
        v_active_profile_id := NULL;
    END IF;

    -- AC4 — Initialise session context with the resolved active profile (idempotent).
    INSERT INTO security.session_context (
        user_id, active_profile_type, active_profile_id, active_team_id, updated_at
    ) VALUES (
        p_user_id, v_active_profile_type, v_active_profile_id, NULL, NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
        active_profile_type = EXCLUDED.active_profile_type,
        active_profile_id = EXCLUDED.active_profile_id,
        active_team_id = NULL,
        updated_at = NOW();

    -- AC6 — Immutable onboarding audit entry. actor_profile_id mirrors the profile
    -- active in session_context (per documentation/database/security/Tables.md).
    INSERT INTO security.audit_logs (
        user_id, action, entity_table, entity_id, metadata, actor_profile_id
    ) VALUES (
        p_user_id,
        'user.onboarded',
        'org.users_public',
        p_user_id,
        jsonb_build_object(
            'objective', v_objective,
            'is_freelancer', v_is_freelancer,
            'username', v_username,
            'active_profile_type', v_active_profile_type
        ),
        v_active_profile_id
    );
END;
$$;

-- #endregion

-- #region Trigger — provision only when identity data is present (email/password path)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    -- The email/password wizard supplies username + dob via signUp metadata, so we
    -- can provision the full profile immediately. OAuth sign-ups arrive without
    -- them; those accounts stay profile-less (isOnboarded = false) and finish via
    -- public.complete_onboarding() after landing on /join.
    IF NULLIF(NEW.raw_user_meta_data->>'username', '') IS NOT NULL
       AND NULLIF(NEW.raw_user_meta_data->>'dob', '') IS NOT NULL THEN
        PERFORM public.provision_user_profile(
            NEW.id, NEW.email, NEW.email_confirmed_at, NEW.raw_user_meta_data
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, org, pg_temp;

-- #endregion

-- #region complete_onboarding RPC — called by an authenticated OAuth sign-up on /join
CREATE OR REPLACE FUNCTION public.complete_onboarding(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, org, pg_temp
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_email text;
    v_confirmed timestamptz;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    IF EXISTS (SELECT 1 FROM org.users_public WHERE user_id = v_uid) THEN
        RAISE EXCEPTION 'User has already completed onboarding' USING ERRCODE = '23505';
    END IF;

    IF NULLIF(p_payload->>'username', '') IS NULL OR NULLIF(p_payload->>'dob', '') IS NULL THEN
        RAISE EXCEPTION 'username and dob are required' USING ERRCODE = '22023';
    END IF;

    SELECT email, email_confirmed_at INTO v_email, v_confirmed
    FROM auth.users WHERE id = v_uid;

    PERFORM public.provision_user_profile(v_uid, v_email, v_confirmed, p_payload);
END;
$$;

-- Under 13, nothing is kept (Decision #208). An OAuth sign-up exists in auth.users before /join asks
-- for a date of birth, so refusing provisioning is not enough: the identity, its email and its
-- sessions go too. Only the caller's own identity, only while it has no profile, and only for a date
-- of birth that is under 13 in the given zone — so an onboarded account can never be deleted through
-- this door, and a future or implausible date deletes nothing.
CREATE OR REPLACE FUNCTION public.discard_underage_signup(p_dob date, p_zone text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_zone text := org.fn_valid_time_zone(p_zone);
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;
    IF p_dob IS NULL OR p_dob > org.fn_today_in(v_zone) OR org.fn_age_years(p_dob, v_zone) >= 13 THEN
        RETURN false;
    END IF;
    IF EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = v_uid) THEN
        RETURN false;
    END IF;
    DELETE FROM auth.users WHERE id = v_uid;
    RETURN true;
END;
$$;

-- US-001 · Multi-Persona Onboarding — keep the app-owned email-verification status
-- in lockstep with GoTrue.
--
-- Profiles for the email/password wizard are provisioned by handle_new_user()
-- (mig 0304) at the auth.users INSERT — i.e. BEFORE the user clicks the
-- confirmation link. provision_user_profile() therefore seeds
-- org.user_emails.verified_at from the (still NULL) email_confirmed_at and, until
-- now, nothing ever advanced it once the user confirmed. verified_at was dead
-- data for every email/password account.
--
-- This trigger closes that gap: whenever GoTrue stamps email_confirmed_at, we
-- mirror it into org.user_emails.verified_at so the value is a trustworthy,
-- app-owned view of verification the /verify subscription can poll.
--
-- Note on tokens: GoTrue still owns the confirmation token end-to-end. It is
-- single-use and invalidated the moment ConfirmBackendService calls verifyOtp
-- (see confirm.ts / ConfirmBackendService.ts). We deliberately do NOT introduce a
-- second, hand-rolled verification_token — that would only add an attack surface
-- with no benefit.

-- #region Sync trigger — email_confirmed_at -> user_emails.verified_at
CREATE OR REPLACE FUNCTION public.handle_email_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, org, pg_temp
AS $$
BEGIN
    -- Fire only on the NULL -> timestamp transition (the first confirmation).
    -- email_change confirmations reuse this column but keep an existing value, so
    -- the guard also prevents clobbering an already-verified primary email.
    IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
        UPDATE org.user_emails
           SET verified_at = NEW.email_confirmed_at
         WHERE user_id = NEW.id
           AND lower(email) = lower(NEW.email)
           AND verified_at IS NULL;
    END IF;

    RETURN NEW;
END;
$$;

-- 0315_create_enterprise_rpc.sql — atomic enterprise provisioning RPC.
--
-- Additive: adds one SECURITY DEFINER function; no table/column/FK is changed. Pairs with
-- 0314_enterprises.sql. Called by @projective/backend's AuthBackendService (service-role) AFTER it
-- admin-creates the owner identity in GoTrue: it inserts org.enterprises and seeds the owner's
-- org.enterprise_members row in a single transaction, and writes the onboarding audit entry
-- (security.audit_logs is definer-only — see 0205/0304 — so provisioning that audits must run here,
-- not in the TS service).
--
-- The payload keys are the camelCase @projective/types `CreateEnterprise` shape, so the service can
-- pass the validated object straight through as jsonb.

CREATE OR REPLACE FUNCTION public.create_enterprise(p_owner uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, org, security
AS $$
DECLARE
    v_enterprise uuid;
    v_handle text := lower(btrim(COALESCE(p_payload->>'handle', '')));
    v_refusal text;
BEGIN
    IF p_owner IS NULL THEN
        RAISE EXCEPTION 'owner is required' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(p_payload->>'legalName', '') IS NULL OR v_handle = '' THEN
        RAISE EXCEPTION 'legalName and handle are required' USING ERRCODE = '22023';
    END IF;

    -- One handle namespace across people, teams, businesses and enterprises (00001020 §9). The
    -- UNIQUE on org.enterprises.handle only ever saw other enterprises, so an enterprise could
    -- claim a person's `@username` or a team's slug and the two would fight over `/{handle}`. The
    -- refusal is the same sentence the create forms' availability probe shows.
    v_refusal := org.fn_handle_refusal(v_handle);
    IF v_refusal IS NOT NULL THEN
        RAISE EXCEPTION '%', v_refusal
            USING ERRCODE = CASE WHEN org.fn_handle_taken(v_handle) THEN '23505' ELSE '22023' END;
    END IF;

    -- The enterprise row. NULLIF collapses the client's empty-string defaults to NULL; the
    -- industry_other CHECK (0314) still enforces a specifier when primary_industry = 'other'.
    INSERT INTO org.enterprises (
        owner_user_id, legal_name, trading_name, handle, registration_number,
        corporate_email, corporate_phone, website,
        address_line_1, address_city, address_postcode, address_country,
        employee_scale, primary_industry, industry_other, departments, purpose, billing_email
    ) VALUES (
        p_owner,
        p_payload->>'legalName',
        NULLIF(p_payload->>'tradingName', ''),
        v_handle,
        NULLIF(p_payload->>'registrationNumber', ''),
        p_payload->>'corporateEmail',
        NULLIF(p_payload->>'corporatePhone', ''),
        NULLIF(p_payload->>'website', ''),
        NULLIF(p_payload->>'addressLine1', ''),
        NULLIF(p_payload->>'addressCity', ''),
        NULLIF(p_payload->>'addressPostcode', ''),
        NULLIF(p_payload->>'addressCountry', ''),
        NULLIF(p_payload->>'employeeScale', '')::org.employee_scale,
        NULLIF(p_payload->>'primaryIndustry', ''),
        NULLIF(p_payload->>'industryOther', ''),
        COALESCE(
            (SELECT array_agg(v) FROM jsonb_array_elements_text(COALESCE(p_payload->'departments', '[]'::jsonb)) v),
            '{}'::text[]
        ),
        COALESCE(
            (SELECT array_agg(v) FROM jsonb_array_elements_text(COALESCE(p_payload->'purpose', '[]'::jsonb)) v),
            '{}'::text[]
        ),
        p_payload->>'corporateEmail'
    )
    RETURNING id INTO v_enterprise;

    -- Seed the owner membership (RLS INSERT policy also allows this via the owner_user_id EXISTS).
    INSERT INTO org.enterprise_members (enterprise_id, user_id, role, status)
    VALUES (v_enterprise, p_owner, 'owner', 'active');

    -- AC6-style immutable onboarding audit (mirrors provision_user_profile in 0304).
    INSERT INTO security.audit_logs (
        user_id, action, entity_table, entity_id, metadata, actor_profile_id
    ) VALUES (
        p_owner,
        'enterprise.created',
        'org.enterprises',
        v_enterprise,
        jsonb_build_object('handle', v_handle, 'legal_name', p_payload->>'legalName'),
        NULL
    );

    RETURN v_enterprise;
END;
$$;

-- Seed default user preferences on profile creation — email AND OAuth sign-up paths.
-- ---------------------------------------------------------------------------------
-- Closes a gap in provisioning (root CLAUDE.md Decision #47). The `on_auth_user_created` trigger's
-- `public.provision_user_profile` (migration 0304) creates `org.users_public` + `org.user_emails` +
-- `security.session_context`, and the OAuth completion path (`public.complete_onboarding`) creates
-- the same `org.users_public` row — but NEITHER seeds an `org.user_preferences` row. Preferences were
-- created only lazily (an INSERT-own-preferences RLS policy), so a fresh account had no defaults for
-- theme / locale until it first wrote one.
--
-- Rather than re-declare either provisioning routine (and risk drift), this attaches a small, focused
-- trigger to `org.users_public` itself: whenever a public profile row is created — by the email path,
-- the OAuth completion path, or any future path — a default `org.user_preferences` row is seeded. The
-- table's own column defaults supply the values (`theme='system'`, `locale='en-GB'`,
-- `ui_settings='{}'`), so this inserts only the key. The email/push toggles live in
-- `comms.notification_prefs`, seeded by `comms.seed_notification_prefs` (Decision #204).
--
-- The row starts from the browser's hints in the sign-up metadata (Decision #207): `locale` and
-- `display_currency`, each kept only when the platform supports it — a locale listed in
-- org.supported_locales, a display currency with seeded rates both ways in finance.fx_rates — and
-- otherwise left to the column default. A row that already exists is never touched.
--
-- An enterprise owner gets no org.users_public row (Decision #87 flag (b)), so the owner membership
-- public.create_enterprise writes seeds theirs (org.seed_owner_preferences). Their
-- comms.notification_prefs waits for a profile row, because that table keys onto org.users_public.

-- #region 1. Sign-up preference seeding
-- The supported locale a tag names, matched ignoring case and `_` / `-`, in its canonical form.
CREATE OR REPLACE FUNCTION org.fn_supported_locale(p_locale text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT l.tag
    FROM org.supported_locales l
    WHERE pg_catalog.lower(l.tag)
        = pg_catalog.lower(pg_catalog.replace(pg_catalog.btrim(p_locale), '_', '-'));
$$;

-- An offerable display currency (the DISPLAY_CURRENCIES rule in @projective/types/finance): the
-- platform base, or a code with a seeded rate both ways against it. Upper-cased; NULL otherwise.
CREATE OR REPLACE FUNCTION org.fn_supported_display_currency(p_code text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    WITH c AS (
        SELECT
            pg_catalog.upper(pg_catalog.btrim(p_code)) AS code,
            COALESCE(
                (SELECT p.value #>> '{}' FROM security.platform_params p WHERE p.key = 'base_currency'),
                'GBP'
            ) AS base
    )
    SELECT c.code
    FROM c
    WHERE c.code ~ '^[A-Z]{3}$'
      AND (
          c.code = c.base
          OR (
              EXISTS (SELECT 1 FROM finance.fx_rates r WHERE r.base = c.base AND r.quote = c.code)
              AND EXISTS (SELECT 1 FROM finance.fx_rates r WHERE r.base = c.code AND r.quote = c.base)
          )
      );
$$;

-- The sign-up metadata a person is being provisioned from: the payload public.provision_user_profile
-- publishes for the transaction (keyed by user, so it never applies to anybody else), else the
-- identity's raw_user_meta_data — the enterprise owner's path. '{}' when there is neither.
CREATE OR REPLACE FUNCTION org.fn_signup_meta(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pending jsonb := NULLIF(pg_catalog.current_setting('projective.signup_meta', true), '')::jsonb;
BEGIN
    IF v_pending ->> 'user_id' = p_user_id::text THEN
        RETURN COALESCE(v_pending -> 'meta', '{}'::jsonb);
    END IF;
    RETURN COALESCE(
        (SELECT u.raw_user_meta_data FROM auth.users u WHERE u.id = p_user_id),
        '{}'::jsonb
    );
END;
$$;

CREATE OR REPLACE FUNCTION org.fn_seed_user_preferences(p_user_id uuid, p_meta jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    INSERT INTO org.user_preferences (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE org.user_preferences
       SET locale = COALESCE(org.fn_supported_locale(p_meta ->> 'locale'), locale),
           preferred_display_currency = COALESCE(
               org.fn_supported_display_currency(p_meta ->> 'display_currency'),
               preferred_display_currency
           )
     WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION org.seed_user_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM org.fn_seed_user_preferences(NEW.user_id, org.fn_signup_meta(NEW.user_id));
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.seed_user_preferences() IS
  'Seeds org.user_preferences when a public profile is created (email + OAuth signup), from the supported sign-up locale and display-currency hints. Idempotent. Decisions #47, #207.';

CREATE OR REPLACE FUNCTION org.seed_owner_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_meta jsonb := org.fn_signup_meta(NEW.user_id);
BEGIN
    PERFORM org.fn_seed_user_preferences(NEW.user_id, v_meta);
    IF EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = NEW.user_id) THEN
        PERFORM comms.fn_seed_notification_prefs(NEW.user_id, v_meta);
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.seed_owner_preferences() IS
  'Seeds an enterprise owner''s org.user_preferences from their owner membership (they get no public profile), and their comms.notification_prefs when a profile exists. Idempotent. Decision #207.';
-- #endregion

-- #region 2. Profile setup progress (Decision #155)
-- Whether a profile story holds any text, across the three stored bio shapes: `{ text }` (what
-- org.save_profile and the seed write), a Quill Delta `{ ops }`, and `{ html }`. The SQL twin of
-- `bioText` in the profile service; anything else reads as empty.
CREATE OR REPLACE FUNCTION org.fn_bio_has_text(p_bio jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_bio IS NULL OR jsonb_typeof(p_bio) <> 'object' THEN false
        WHEN jsonb_typeof(p_bio -> 'text') = 'string' THEN btrim(p_bio ->> 'text', E' \t\r\n') <> ''
        WHEN jsonb_typeof(p_bio -> 'ops') = 'array' THEN EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_bio -> 'ops') AS op
            WHERE jsonb_typeof(op -> 'insert') = 'string' AND btrim(op ->> 'insert', E' \t\r\n') <> ''
        )
        WHEN jsonb_typeof(p_bio -> 'html') = 'string' THEN
            btrim(regexp_replace(p_bio ->> 'html', '<[^>]*>|&nbsp;', ' ', 'g'), E' \t\r\n') <> ''
        ELSE false
    END;
$$;

-- How far a person's own profile is set up — the ONE completeness rule, read by the account popover's
-- ring (`ProfileSetupProgress`, @projective/types/org). Every step is DERIVED from stored state;
-- nothing is awarded for visiting a page. The weights total 100:
--
--   account          20  name + date of birth on the profile, an address on the sign-in identity
--   email_verified   10  one of the person's addresses is confirmed (org.user_emails.verified_at)
--   skills           10  seller skills or buyer interests chosen
--   avatar           20  an UPLOADED photo (a sign-in provider's picture does not count)
--   profile_copy     20  a headline and a story
--   working_hours    20  a published schedule with at least one active band
--
-- The first three are what /join collects, so a finished sign-up reads 40. `next_suggested_action`
-- is the single highest-yield next step: an unconfirmed address first, then a seller's earning gate
-- (identity, then payout — PRODUCT_SPEC "No Forever-Escrow"), then the setup steps by weight, and
-- for a fully set-up buyer the freelancer unlock. NULL when nothing is left. A caller may read only
-- their own progress; the service role may read anyone's. NULL for a person with no profile row.
CREATE OR REPLACE FUNCTION org.fn_compute_profile_setup_progress(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid ();
    v_user org.users_public%ROWTYPE;
    v_fp org.freelancer_profiles%ROWTYPE;
    v_seller boolean;
    v_account boolean;
    v_email boolean;
    v_skills boolean;
    v_avatar boolean;
    v_copy boolean;
    v_hours boolean;
    v_score integer := 0;
    v_keys text[] := '{}'::text[];
    v_next text;
    -- A minor publishes no hours (Decision #208), so the step does not apply: it leaves the ladder
    -- (`not_applicable_keys`) and the score is taken over the 80 points that remain.
    v_minor boolean := org.fn_is_minor(p_user_id);
BEGIN
    IF v_uid IS NOT NULL AND v_uid IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'auth: you can only read your own setup progress' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_user FROM org.users_public u WHERE u.user_id = p_user_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_fp FROM org.freelancer_profiles f WHERE f.user_id = p_user_id;
    v_seller := FOUND AND v_user.is_freelancer;

    v_account := NULLIF(btrim(concat_ws(' ', v_user.first_name, v_user.last_name)), '') IS NOT NULL
        AND v_user.dob IS NOT NULL
        AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = p_user_id AND au.email IS NOT NULL);
    v_email := EXISTS (
        SELECT 1 FROM org.user_emails ue WHERE ue.user_id = p_user_id AND ue.verified_at IS NOT NULL
    );
    v_skills := COALESCE(cardinality(v_fp.skills), 0) > 0 OR cardinality(v_user.interests) > 0;
    v_avatar := v_user.avatar_file_id IS NOT NULL;
    v_copy := btrim(COALESCE(v_user.headline, '')) <> '' AND org.fn_bio_has_text(v_user.bio);
    v_hours := EXISTS (
        SELECT 1
        FROM scheduling.schedules sc
        JOIN scheduling.availability_rules ar ON ar.schedule_id = sc.id AND ar.is_active
        WHERE sc.owner_type = 'user'::scheduling.owner_type AND sc.owner_id = p_user_id AND sc.is_published
    );

    IF v_account THEN v_score := v_score + 20; v_keys := v_keys || 'account'::text; END IF;
    IF v_email THEN v_score := v_score + 10; v_keys := v_keys || 'email_verified'::text; END IF;
    IF v_skills THEN v_score := v_score + 10; v_keys := v_keys || 'skills'::text; END IF;
    IF v_avatar THEN v_score := v_score + 20; v_keys := v_keys || 'avatar'::text; END IF;
    IF v_copy THEN v_score := v_score + 20; v_keys := v_keys || 'profile_copy'::text; END IF;
    IF v_hours AND NOT v_minor THEN v_score := v_score + 20; v_keys := v_keys || 'working_hours'::text; END IF;
    IF v_minor THEN v_score := round(v_score * 100.0 / 80)::integer; END IF;

    v_next := CASE
        WHEN NOT v_email THEN 'verify_email'
        WHEN v_seller AND v_fp.kyc_status IS DISTINCT FROM 'verified'::finance.kyc_status THEN 'verify_identity'
        WHEN v_seller AND NOT v_fp.payout_ready THEN 'add_payout'
        WHEN NOT v_avatar THEN 'add_photo'
        WHEN NOT v_copy THEN 'write_profile'
        WHEN NOT v_hours AND NOT v_minor THEN 'publish_hours'
        WHEN NOT v_skills THEN 'add_skills'
        WHEN NOT v_account THEN 'complete_account'
        -- Selling unlocks at 18, so a minor is never pointed at it (Decision #192).
        WHEN NOT v_seller AND NOT v_minor THEN 'become_partner'
        ELSE NULL
    END;

    RETURN jsonb_build_object(
        'score', v_score,
        'completed_keys', to_jsonb(v_keys),
        'not_applicable_keys', CASE WHEN v_minor THEN '["working_hours"]'::jsonb ELSE '[]'::jsonb END,
        'next_suggested_action', v_next
    );
END;
$$;
-- #endregion

-- #region 3. Age guardrails (Decision #190)
-- PRODUCT_SPEC §Age guardrails, held where no door can skip it: under 13 cannot hold an account
-- (PM422); 13–17 is RESTRICTED — no buying and no selling (PM403); 18 and over is unrestricted. The
-- thresholds are MIN_AGE / ADULT_AGE in @projective/types/auth/age.ts. Restriction is never stored:
-- it is derived from org.users_public.dob on every read, so it lifts on the 18th birthday with
-- nothing to run. Whole years on today's date in the person's own zone (users_public.timezone, UTC
-- when unknown) — the rule computeAge applies in the form and the API, so every layer turns a
-- birthday over at the same moment (Decision #192). None of these is granted to a client role (org
-- is deny-by-default, 00002510), so no caller can ask whether somebody else is a minor; definers,
-- triggers and the access-token hook call them.

-- An IANA zone Postgres resolves, else NULL — so a bad zone degrades to UTC rather than raising.
CREATE OR REPLACE FUNCTION org.fn_valid_time_zone(p_zone text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
    IF p_zone IS NULL OR pg_catalog.btrim(p_zone) = '' THEN
        RETURN NULL;
    END IF;
    PERFORM pg_catalog.now() AT TIME ZONE p_zone;
    RETURN p_zone;
EXCEPTION
    WHEN invalid_parameter_value THEN
        RETURN NULL;
END;
$$;

-- Today's calendar date in a zone; an absent or unknown zone is UTC.
CREATE OR REPLACE FUNCTION org.fn_today_in(p_zone text DEFAULT NULL)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT (pg_catalog.now() AT TIME ZONE COALESCE(org.fn_valid_time_zone(p_zone), 'UTC'))::date;
$$;

CREATE OR REPLACE FUNCTION org.fn_age_years(p_dob date, p_zone text DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT pg_catalog.date_part(
        'year', pg_catalog.age(org.fn_today_in(p_zone)::timestamp, p_dob::timestamp)
    )::integer;
$$;

-- The one date-of-birth rule for a profile row: present, not in the future, not before 1900, and at
-- least 13 years ago — "today" in the person's zone. Provisioning calls it before writing anything;
-- org.trg_users_public_dob_guard calls it on every insert and every dob change.
CREATE OR REPLACE FUNCTION org.fn_check_dob(p_dob date, p_zone text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
    IF p_dob IS NULL THEN
        RAISE EXCEPTION 'dob: enter your date of birth' USING ERRCODE = '22023';
    END IF;
    IF p_dob > org.fn_today_in(p_zone) OR p_dob < DATE '1900-01-01' THEN
        RAISE EXCEPTION 'dob: enter a real date of birth' USING ERRCODE = '22023';
    END IF;
    IF org.fn_age_years(p_dob, p_zone) < 13 THEN
        RAISE EXCEPTION 'dob: you need to be at least 13 to join Projective' USING ERRCODE = 'PM422';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION org.trg_users_public_dob_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM org.fn_check_dob(NEW.dob, NEW.timezone);
    RETURN NEW;
END;
$$;

-- A minor's profile is never in the public directory (Decision #208): unlisted or private only.
CREATE OR REPLACE FUNCTION org.trg_users_public_minor_visibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.visibility = 'public' AND org.fn_age_years(NEW.dob, NEW.timezone) < 18 THEN
        RAISE EXCEPTION 'visibility: profiles of people under 18 stay unlisted' USING ERRCODE = 'PM403';
    END IF;
    RETURN NEW;
END;
$$;

-- Whether a person is NOT provably 18 today: 13–17 by their stored date of birth, or an identity
-- (an auth.users row) with no profile row and so no date of birth at all. It fails CLOSED (IW-H2,
-- FOUNDER_QUESTIONNAIRE F4): an identity that never gave a DoB (a profile-less enterprise owner; a
-- future SSO identity) used to answer `false` here and pass every fn_assert_adult door. Whatever F4
-- rules — a profile for every owner, or a DoB on the enterprise step — no DoB means not provably
-- adult. An id that names no identity at all stays `false`: several callers pass a polymorphic id
-- (trg_project_joiner_adult sees a business profile id as a participant), and a NULL user is no
-- person either (a signed-out caller, the service role).
CREATE OR REPLACE FUNCTION org.fn_is_minor(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT org.fn_age_years(u.dob, u.timezone) < 18 FROM org.users_public u WHERE u.user_id = p_user),
        EXISTS (SELECT 1 FROM auth.users a WHERE a.id = p_user)
    );
$$;

-- The one buy/sell gate. Every door that spends, earns, sells or takes paid work calls it with the
-- person acting (or, for an assignment, the person being given the work); a NULL user is the service
-- role and passes.
CREATE OR REPLACE FUNCTION org.fn_assert_adult(p_user uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_user IS NOT NULL AND org.fn_is_minor(p_user) THEN
        RAISE EXCEPTION 'age: buying and selling unlock on the account holder''s 18th birthday'
            USING ERRCODE = 'PM403';
    END IF;
END;
$$;

-- Refuses a row that would put a minor in a team, business or enterprise, or address an invitation
-- to one (Decision #208) — every path in, the definers' upserts included. TG_ARGV[0] names the column
-- holding the person.
CREATE OR REPLACE FUNCTION org.trg_workspace_member_adult()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_person uuid := (pg_catalog.to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
BEGIN
    IF v_person IS NOT NULL AND org.fn_is_minor(v_person) THEN
        RAISE EXCEPTION 'workspace: people under 18 cannot join a team, business or enterprise'
            USING ERRCODE = 'PM403';
    END IF;
    RETURN NEW;
END;
$$;
-- #endregion
