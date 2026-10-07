-- ============================================================================
-- 00001010 functions org onboarding
-- Consolidated verbatim from: 0304_onboarding_session_and_audit.sql, 0312_email_verification_sync.sql, 0315_create_organisation_rpc.sql, 20260722120000_seed_user_preferences.sql
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
    v_active_profile_type public.profile_type;
    v_active_profile_id uuid;
BEGIN
    v_first_name := p_meta->>'first_name';
    v_last_name := p_meta->>'last_name';
    v_username := p_meta->>'username';
    v_dob := (p_meta->>'dob')::date;
    v_objective := p_meta->>'objective';
    v_avatar_file_id := NULLIF(p_meta->>'avatar_file_id', '')::uuid;

    IF v_objective = 'freelancer' OR v_objective = 'seller' THEN
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

    -- 1. Core profile
    INSERT INTO org.users_public (
        user_id, first_name, last_name, username, dob, visibility,
        interests, is_freelancer, avatar_file_id
    ) VALUES (
        p_user_id, v_first_name, v_last_name, v_username, v_dob, 'unlisted',
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- #endregion

-- #region complete_onboarding RPC — called by an authenticated OAuth sign-up on /join
CREATE OR REPLACE FUNCTION public.complete_onboarding(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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

-- 0315_create_organisation_rpc.sql — atomic organisation provisioning RPC.
--
-- Additive: adds one SECURITY DEFINER function; no table/column/FK is changed. Pairs with
-- 0314_organisations.sql. Called by @projective/backend's AuthBackendService (service-role) AFTER it
-- admin-creates the owner identity in GoTrue: it inserts org.organisations and seeds the owner's
-- org.organisation_members row in a single transaction, and writes the onboarding audit entry
-- (security.audit_logs is definer-only — see 0205/0304 — so provisioning that audits must run here,
-- not in the TS service).
--
-- The payload keys are the camelCase @projective/types `CreateOrganisation` shape, so the service can
-- pass the validated object straight through as jsonb.

CREATE OR REPLACE FUNCTION public.create_organisation(p_owner uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, org, security
AS $$
DECLARE
    v_org uuid;
    v_handle text := lower(btrim(COALESCE(p_payload->>'handle', '')));
    v_refusal text;
BEGIN
    IF p_owner IS NULL THEN
        RAISE EXCEPTION 'owner is required' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(p_payload->>'legalName', '') IS NULL OR v_handle = '' THEN
        RAISE EXCEPTION 'legalName and handle are required' USING ERRCODE = '22023';
    END IF;

    -- One handle namespace across people, teams, businesses and organisations (00001020 §9). The
    -- UNIQUE on org.organisations.handle only ever saw other organisations, so an organisation could
    -- claim a person's `@username` or a team's slug and the two would fight over `/{handle}`. The
    -- refusal is the same sentence the create forms' availability probe shows.
    v_refusal := org.fn_handle_refusal(v_handle);
    IF v_refusal IS NOT NULL THEN
        RAISE EXCEPTION '%', v_refusal
            USING ERRCODE = CASE WHEN org.fn_handle_taken(v_handle) THEN '23505' ELSE '22023' END;
    END IF;

    -- The org row. NULLIF collapses the client's empty-string defaults to NULL; the
    -- industry_other CHECK (0314) still enforces a specifier when primary_industry = 'other'.
    INSERT INTO org.organisations (
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
    RETURNING id INTO v_org;

    -- Seed the owner membership (RLS INSERT policy also allows this via the owner_user_id EXISTS).
    INSERT INTO org.organisation_members (organisation_id, user_id, role, status)
    VALUES (v_org, p_owner, 'owner', 'active');

    -- AC6-style immutable onboarding audit (mirrors provision_user_profile in 0304).
    INSERT INTO security.audit_logs (
        user_id, action, entity_table, entity_id, metadata, actor_profile_id
    ) VALUES (
        p_owner,
        'organisation.created',
        'org.organisations',
        v_org,
        jsonb_build_object('handle', v_handle, 'legal_name', p_payload->>'legalName'),
        NULL
    );

    RETURN v_org;
END;
$$;

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
    IF v_hours THEN v_score := v_score + 20; v_keys := v_keys || 'working_hours'::text; END IF;

    v_next := CASE
        WHEN NOT v_email THEN 'verify_email'
        WHEN v_seller AND v_fp.kyc_status IS DISTINCT FROM 'verified'::finance.kyc_status THEN 'verify_identity'
        WHEN v_seller AND NOT v_fp.payout_ready THEN 'add_payout'
        WHEN NOT v_avatar THEN 'add_photo'
        WHEN NOT v_copy THEN 'write_profile'
        WHEN NOT v_hours THEN 'publish_hours'
        WHEN NOT v_skills THEN 'add_skills'
        WHEN NOT v_account THEN 'complete_account'
        WHEN NOT v_seller THEN 'become_partner'
        ELSE NULL
    END;

    RETURN jsonb_build_object(
        'score', v_score,
        'completed_keys', to_jsonb(v_keys),
        'next_suggested_action', v_next
    );
END;
$$;
-- #endregion
