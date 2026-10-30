-- ============================================================================
-- 00001020 functions org entities
-- Consolidated from: 0109_is_active_team_member.sql, 0111_business_helpers.sql, 0307_stage_staffing.sql, 0313_freelancer_conversion.sql, 0314_enterprises.sql, 20260709120000_business_teams_overhaul.sql; the workspace permission engine and its write/read RPCs are Decision #122.
-- ============================================================================

CREATE OR REPLACE FUNCTION org.is_active_team_member(_team_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = org, public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM org.team_members 
    WHERE team_id = _team_id 
    AND user_id = auth.uid() 
    AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION org.is_active_business_member(_business_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = org, public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM org.business_members 
    WHERE business_id = _business_id 
    AND user_id = auth.uid() 
    AND status = 'active'
  );
$$;

-- #endregion


-- Post-onboarding persona expansion — "Become a Partner" (client/operator → freelancer)
--
-- US-001 provisions a freelancer profile only at signup (when objective = freelancer/seller,
-- see public.provision_user_profile in 0304). A user who onboarded as a client/operator had no
-- way to unlock a freelancer profile later. This RPC is that path: it is the mutation behind the
-- "Become a Partner" / "Unlock Freelancer Suite" CTAs on the /become-partner conversion page.
--
-- It is idempotent and self-serve (granted to `authenticated`, keyed off auth.uid()). Like the
-- onboarding provisioning it must run in a SECURITY DEFINER context because it writes
-- security.audit_logs, which is not granted to `authenticated` (see 0205 / 0304).

-- #region enable_freelancer_profile RPC
CREATE OR REPLACE FUNCTION org.enable_freelancer_profile(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_handle text;
    v_skills text[];
    v_unknown text;
    v_created boolean := false;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    -- Must be a fully-onboarded user (owns a public profile) before adding a persona.
    SELECT u.username INTO v_handle FROM org.users_public u WHERE u.user_id = v_uid;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Complete onboarding before unlocking a freelancer profile'
            USING ERRCODE = '42501';
    END IF;

    -- Selling unlocks at 18 (Decision #190).
    PERFORM org.fn_assert_adult(v_uid);

    -- An account on its way out cannot take on a new persona (00001060).
    IF EXISTS (
        SELECT 1 FROM org.deletion_requests d
         WHERE d.user_id = v_uid AND d.scope = 'account' AND d.status = 'scheduled'
    ) THEN
        RAISE EXCEPTION 'Your account is scheduled for deletion. Cancel that first.'
            USING ERRCODE = '42501';
    END IF;

    -- Optional starter skills: `org.skills` slugs (the vocabulary `freelancer_profiles.skills`
    -- holds), de-duplicated in the order given, at most ten, every one a known slug.
    IF p_payload ? 'skills' AND jsonb_typeof(p_payload->'skills') = 'array' THEN
        SELECT COALESCE(array_agg(slug ORDER BY first_at), '{}'::text[]) INTO v_skills
        FROM (
            SELECT lower(btrim(e.value)) AS slug, min(e.ordinality) AS first_at
            FROM jsonb_array_elements_text(p_payload->'skills') WITH ORDINALITY AS e(value, ordinality)
            WHERE btrim(e.value) <> ''
            GROUP BY lower(btrim(e.value))
        ) picked;
    ELSE
        v_skills := '{}'::text[];
    END IF;

    IF COALESCE(array_length(v_skills, 1), 0) > 10 THEN
        RAISE EXCEPTION 'Choose at most 10 starter skills' USING ERRCODE = '22023';
    END IF;

    SELECT s INTO v_unknown
    FROM unnest(v_skills) AS s
    WHERE NOT EXISTS (SELECT 1 FROM org.skills k WHERE k.slug = s)
    LIMIT 1;
    IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION 'Unknown skill: %', v_unknown USING ERRCODE = '22023';
    END IF;

    -- 1. Link the freelancer profile record to the account (idempotent — freelancer_profiles is
    --    keyed by user_id). FOUND is true only when a row was actually inserted (not on conflict).
    INSERT INTO org.freelancer_profiles (user_id, skills)
    VALUES (v_uid, v_skills)
    ON CONFLICT (user_id) DO NOTHING;
    v_created := FOUND;

    -- 2. Flip the denormalised persona flag consumed by getMe + the nav gates. Coming back inside a
    --    scheduled removal's 90 days cancels it and republishes what it paused (00001060).
    PERFORM org.fn_cancel_deletion(v_uid, 'freelancer_profile');
    UPDATE org.users_public
       SET is_freelancer = true, updated_at = now()
     WHERE user_id = v_uid;

    -- 3. Activate the freelancer persona immediately so the suite unlocks without a manual switch.
    --    Freelancer profiles are keyed by user_id, so the active profile id is the user id. It goes
    --    through the one session-context writer, which clears the team and enterprise slots in the
    --    same statement: writing only the profile slot left a caller acting as a team or an
    --    enterprise holding two slots, which ck_session_context_one_slot refuses — so the
    --    conversion failed for exactly the people most likely to attempt it.
    PERFORM security.fn_set_session_context('freelancer', v_uid, NULL, NULL, v_uid);

    -- 4. Audit a genuine conversion only (definer context — audit_logs isn't granted to authenticated).
    IF v_created THEN
        INSERT INTO security.audit_logs (
            user_id, action, entity_table, entity_id, metadata, actor_profile_id
        ) VALUES (
            v_uid,
            'freelancer.unlocked',
            'org.freelancer_profiles',
            v_uid,
            jsonb_build_object(
                'source', 'become_partner',
                'skills_count', COALESCE(array_length(v_skills, 1), 0)
            ),
            v_uid
        );
    END IF;

    RETURN jsonb_build_object(
        'freelancer_profile_id', v_uid,
        'handle', v_handle,
        'created', v_created,
        'is_freelancer', true
    );
END;
$$;

-- #endregion

-- #region Membership helper (SECURITY DEFINER — bypasses RLS so the policies below can't recurse)
CREATE OR REPLACE FUNCTION org.is_enterprise_member(
    p_enterprise uuid,
    p_min_role org.enterprise_role DEFAULT 'member'
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = org, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM org.enterprise_members m
        WHERE m.enterprise_id = p_enterprise
          AND m.user_id = auth.uid ()
          AND m.status = 'active'
          AND (
              p_min_role = 'member'
              OR (p_min_role = 'admin' AND m.role IN ('admin', 'owner'))
              OR (p_min_role = 'owner' AND m.role = 'owner')
          )
    );
$$;

-- Toggle helper so the flag is switchable at runtime (settings / testing).
CREATE OR REPLACE FUNCTION org.set_operator_mode(p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, org, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE org.users_public SET is_operator = p_enabled, updated_at = now()
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object('is_operator', p_enabled);
END;
$$;

-- #endregion

-- #region 5b. The acting entity's own name — read through a door, not through RLS
-- `UserBackendService.me` names the entity a person acts as. It read the name as the caller under
-- RLS, which works for a team (members may SELECT their team) and an enterprise, and returns
-- NOTHING for a business: `org.business_profiles` has no client SELECT policy at all, so a business
-- member's header fell back to the slug. This answers for exactly one entity — the one named — and
-- only when the caller holds an active seat in it (the owner of an enterprise counts), so it can
-- never be used to read an entity the caller is not acting inside. NULL when they are not.
CREATE OR REPLACE FUNCTION org.get_acting_context_details(p_context_type text, p_context_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_name text;
    v_handle text;
    v_status text;
BEGIN
    IF v_uid IS NULL OR p_context_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF p_context_type = 'team' THEN
        SELECT t.name, t.slug, t.status INTO v_name, v_handle, v_status
        FROM org.teams t
        WHERE t.id = p_context_id
          AND EXISTS (
              SELECT 1 FROM org.team_members m
              WHERE m.team_id = t.id AND m.user_id = v_uid AND m.status = 'active'
          );
    ELSIF p_context_type = 'business' THEN
        SELECT b.name, b.slug, b.status INTO v_name, v_handle, v_status
        FROM org.business_profiles b
        WHERE b.id = p_context_id
          AND EXISTS (
              SELECT 1 FROM org.business_members m
              WHERE m.business_id = b.id AND m.user_id = v_uid AND m.status = 'active'
          );
    ELSIF p_context_type = 'enterprise' THEN
        SELECT COALESCE(NULLIF(btrim(o.trading_name), ''), o.legal_name), o.handle, o.status::text
          INTO v_name, v_handle, v_status
        FROM org.enterprises o
        WHERE o.id = p_context_id
          AND (
              o.owner_user_id = v_uid
              OR EXISTS (
                  SELECT 1 FROM org.enterprise_members m
                  WHERE m.enterprise_id = o.id AND m.user_id = v_uid AND m.status = 'active'
              )
          );
    ELSE
        RETURN NULL;
    END IF;

    IF v_handle IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'context_type', p_context_type,
        'context_id', p_context_id,
        'name', NULLIF(btrim(v_name), ''),
        'handle', v_handle,
        'status', v_status
    );
END;
$$;
-- #endregion

-- #region 5c. Editing an enterprise — the one write door
-- `org.enterprises` had a bare `FOR UPDATE` policy for its owner and admins: no column list, no
-- WITH CHECK, no validation. Any admin could rewrite the legal name, the registration number and the
-- corporate and billing addresses over PostgREST, with nothing checked and nothing recorded. The
-- policy is gone (00002010); this is the only way an enterprise changes now.
--
--   * Only the keys below are accepted; an unknown key is refused, never ignored, and the
--     platform-owned columns (owner · handle · status · verification · logo) are refused by name.
--   * The LEGAL identity — legal name, registration number, corporate email — is the owner's to
--     change, and is frozen once KYB has begun (`kyb_pending`, `verified`): a verified identity that
--     could be edited afterwards would verify nothing.
--   * Every value is checked against the bounds `@projective/types/org` UpdateEnterpriseSchema
--     states; an empty string clears an optional field.
--   * Every edit is audited (`enterprise.updated`, with the keys changed).
CREATE OR REPLACE FUNCTION org.update_enterprise(p_enterprise_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_enterprise org.enterprises%ROWTYPE;
    v_is_owner boolean;
    v_is_enterprise_admin boolean;
    v_key text;
    v_text text;
    v_spec record;
    v_fields jsonb;
    v_identity_keys text[] := ARRAY['legalName', 'registrationNumber', 'corporateEmail'];
    v_platform_keys text[] := ARRAY[
        'handle', 'status', 'verificationLevel', 'ownerUserId', 'logoFileId', 'id', 'createdAt', 'updatedAt'
    ];
    v_editable_keys text[] := ARRAY[
        'legalName', 'tradingName', 'registrationNumber', 'corporateEmail', 'corporatePhone', 'website',
        'addressLine1', 'addressCity', 'addressPostcode', 'addressCountry', 'employeeScale',
        'primaryIndustry', 'industryOther', 'billingEmail', 'defaultCurrency', 'departments', 'purpose'
    ];
    v_email_re text := '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$';
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;
    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR p_payload = '{}'::jsonb THEN
        RAISE EXCEPTION 'Nothing to update' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_enterprise FROM org.enterprises o WHERE o.id = p_enterprise_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enterprise not found' USING ERRCODE = 'P0002';
    END IF;

    v_is_owner := v_enterprise.owner_user_id = v_uid;
    v_is_enterprise_admin := org.is_enterprise_member(p_enterprise_id, 'admin');
    IF NOT v_is_owner AND NOT v_is_enterprise_admin AND NOT security.is_admin() THEN
        RAISE EXCEPTION 'Only the owner or an admin can edit this enterprise' USING ERRCODE = '42501';
    END IF;

    -- Which keys, and who may send them.
    FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
        IF v_key = ANY (v_platform_keys) THEN
            RAISE EXCEPTION '% is set by the platform and cannot be edited', v_key USING ERRCODE = '42501';
        ELSIF NOT v_key = ANY (v_editable_keys) THEN
            RAISE EXCEPTION 'Unknown field: %', v_key USING ERRCODE = '22023';
        END IF;
        IF v_key = ANY (v_identity_keys) THEN
            IF NOT v_is_owner AND NOT security.is_admin() THEN
                RAISE EXCEPTION 'Only the owner can change the enterprise''s legal identity'
                    USING ERRCODE = '42501';
            END IF;
            IF v_enterprise.verification_level IN ('kyb_pending', 'verified') THEN
                RAISE EXCEPTION 'The legal identity is locked while verification is under way or complete'
                    USING ERRCODE = '55000';
            END IF;
        END IF;
    END LOOP;

    -- Text keys: (key, max length, may be cleared). One table so every bound is stated once.
    FOR v_spec IN
        SELECT * FROM (VALUES
            ('legalName', 160, false), ('tradingName', 160, true), ('registrationNumber', 60, true),
            ('corporateEmail', 160, false), ('corporatePhone', 40, true), ('website', 200, true),
            ('addressLine1', 160, true), ('addressCity', 80, true), ('addressPostcode', 20, true),
            ('addressCountry', 60, true), ('employeeScale', 20, true), ('primaryIndustry', 60, true),
            ('industryOther', 80, true), ('billingEmail', 160, true), ('defaultCurrency', 3, false)
        ) AS t(key, max_len, nullable)
    LOOP
        CONTINUE WHEN NOT p_payload ? v_spec.key;
        IF jsonb_typeof(p_payload->v_spec.key) NOT IN ('string', 'null') THEN
            RAISE EXCEPTION '% must be text', v_spec.key USING ERRCODE = '22023';
        END IF;
        v_text := btrim(p_payload->>v_spec.key);
        IF COALESCE(v_text, '') = '' AND NOT v_spec.nullable THEN
            RAISE EXCEPTION '% is required', v_spec.key USING ERRCODE = '22023';
        END IF;
        IF length(v_text) > v_spec.max_len THEN
            RAISE EXCEPTION '% is % characters at most', v_spec.key, v_spec.max_len USING ERRCODE = '22023';
        END IF;
    END LOOP;

    IF p_payload ? 'corporateEmail' AND btrim(p_payload->>'corporateEmail') !~ v_email_re THEN
        RAISE EXCEPTION 'corporateEmail is not an email address' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(btrim(p_payload->>'billingEmail'), '') <> ''
       AND btrim(p_payload->>'billingEmail') !~ v_email_re THEN
        RAISE EXCEPTION 'billingEmail is not an email address' USING ERRCODE = '22023';
    END IF;
    IF p_payload ? 'defaultCurrency' AND upper(btrim(p_payload->>'defaultCurrency')) !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'defaultCurrency is a three-letter currency code' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(btrim(p_payload->>'employeeScale'), '') <> ''
       AND NOT btrim(p_payload->>'employeeScale') = ANY (enum_range(NULL::org.employee_scale)::text[]) THEN
        RAISE EXCEPTION 'employeeScale is not a known scale' USING ERRCODE = '22023';
    END IF;
    FOR v_spec IN SELECT * FROM (VALUES ('departments', 60), ('purpose', 40)) AS t(key, max_len) LOOP
        CONTINUE WHEN NOT p_payload ? v_spec.key;
        IF jsonb_typeof(p_payload->v_spec.key) <> 'array' THEN
            RAISE EXCEPTION '% must be a list', v_spec.key USING ERRCODE = '22023';
        END IF;
        IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_payload->v_spec.key) e
            WHERE jsonb_typeof(e) <> 'string' OR length(e #>> '{}') > v_spec.max_len
        ) THEN
            RAISE EXCEPTION 'Each % entry is text of % characters at most', v_spec.key, v_spec.max_len
                USING ERRCODE = '22023';
        END IF;
    END LOOP;

    -- An 'other' industry needs its specifier (enterprises_industry_other_ck) — said in words here
    -- rather than as a constraint violation.
    IF COALESCE(
           CASE WHEN p_payload ? 'primaryIndustry' THEN NULLIF(btrim(p_payload->>'primaryIndustry'), '')
                ELSE v_enterprise.primary_industry END, ''
       ) = 'other'
       AND COALESCE(
           CASE WHEN p_payload ? 'industryOther' THEN NULLIF(btrim(p_payload->>'industryOther'), '')
                ELSE v_enterprise.industry_other END, ''
       ) = '' THEN
        RAISE EXCEPTION 'Name the industry when choosing Other' USING ERRCODE = '22023';
    END IF;

    UPDATE org.enterprises o SET
        legal_name = CASE WHEN p_payload ? 'legalName' THEN btrim(p_payload->>'legalName') ELSE o.legal_name END,
        trading_name = CASE WHEN p_payload ? 'tradingName'
            THEN NULLIF(btrim(p_payload->>'tradingName'), '') ELSE o.trading_name END,
        registration_number = CASE WHEN p_payload ? 'registrationNumber'
            THEN NULLIF(btrim(p_payload->>'registrationNumber'), '') ELSE o.registration_number END,
        corporate_email = CASE WHEN p_payload ? 'corporateEmail'
            THEN lower(btrim(p_payload->>'corporateEmail')) ELSE o.corporate_email END,
        corporate_phone = CASE WHEN p_payload ? 'corporatePhone'
            THEN NULLIF(btrim(p_payload->>'corporatePhone'), '') ELSE o.corporate_phone END,
        website = CASE WHEN p_payload ? 'website'
            THEN NULLIF(btrim(p_payload->>'website'), '') ELSE o.website END,
        address_line_1 = CASE WHEN p_payload ? 'addressLine1'
            THEN NULLIF(btrim(p_payload->>'addressLine1'), '') ELSE o.address_line_1 END,
        address_city = CASE WHEN p_payload ? 'addressCity'
            THEN NULLIF(btrim(p_payload->>'addressCity'), '') ELSE o.address_city END,
        address_postcode = CASE WHEN p_payload ? 'addressPostcode'
            THEN NULLIF(btrim(p_payload->>'addressPostcode'), '') ELSE o.address_postcode END,
        address_country = CASE WHEN p_payload ? 'addressCountry'
            THEN NULLIF(btrim(p_payload->>'addressCountry'), '') ELSE o.address_country END,
        employee_scale = CASE WHEN p_payload ? 'employeeScale'
            THEN NULLIF(btrim(p_payload->>'employeeScale'), '')::org.employee_scale ELSE o.employee_scale END,
        primary_industry = CASE WHEN p_payload ? 'primaryIndustry'
            THEN NULLIF(btrim(p_payload->>'primaryIndustry'), '') ELSE o.primary_industry END,
        industry_other = CASE WHEN p_payload ? 'industryOther'
            THEN NULLIF(btrim(p_payload->>'industryOther'), '') ELSE o.industry_other END,
        departments = CASE WHEN p_payload ? 'departments'
            THEN ARRAY(SELECT btrim(v) FROM jsonb_array_elements_text(p_payload->'departments') v
                       WHERE btrim(v) <> '')
            ELSE o.departments END,
        purpose = CASE WHEN p_payload ? 'purpose'
            THEN ARRAY(SELECT btrim(v) FROM jsonb_array_elements_text(p_payload->'purpose') v
                       WHERE btrim(v) <> '')
            ELSE o.purpose END,
        billing_email = CASE WHEN p_payload ? 'billingEmail'
            THEN NULLIF(lower(btrim(p_payload->>'billingEmail')), '') ELSE o.billing_email END,
        default_currency = CASE WHEN p_payload ? 'defaultCurrency'
            THEN upper(btrim(p_payload->>'defaultCurrency')) ELSE o.default_currency END,
        updated_at = now()
    WHERE o.id = p_enterprise_id;

    SELECT jsonb_agg(k ORDER BY k) INTO v_fields FROM jsonb_object_keys(p_payload) k;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (
        v_uid,
        'enterprise.updated',
        'org.enterprises',
        p_enterprise_id,
        jsonb_build_object(
            'fields', v_fields,
            'as_platform_admin', NOT v_is_owner AND NOT v_is_enterprise_admin
        )
    );

    RETURN jsonb_build_object('id', p_enterprise_id, 'updated_fields', v_fields);
END;
$$;
-- #endregion

-- #region 6. The permission engine's SQL twin (@projective/types/workspace)
-- The console's authority model is three layers — a preset role, a custom role, per-member overrides
-- — resolved as `role ∪ granted − revoked`, intersected with what the entity's kind renders
-- (members.ts `effectivePermissions`). Every write RPC below asks THESE functions rather than keeping
-- its own role-name list: five hand-written lists that disagreed with the TypeScript is what this
-- replaced. `coordination`-style contract test: `workspace.contract.test.ts` reads this file and pins
-- the kind subsets and the four preset bundles to `capabilitiesForKind` / `PRESET_GRANTS`.

-- The capabilities a kind renders. A team never approves spend (it earns, it does not run a purchase
-- ladder); a business never binds a seat (it buys delivery).
CREATE OR REPLACE FUNCTION org.fn_kind_capabilities(p_kind text)
RETURNS org.workspace_capability[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY(
        SELECT e.c
        FROM unnest(enum_range(NULL::org.workspace_capability)) WITH ORDINALITY AS e(c, n)
        WHERE CASE p_kind
            WHEN 'team' THEN e.c NOT IN ('purchase', 'hire', 'contribute_funds', 'approve_spend', 'manage_billing')
            WHEN 'business' THEN e.c NOT IN ('bind_seat', 'publish_listings')
            ELSE false
        END
        ORDER BY e.n
    );
$$;

-- The bundle a preset role grants, scoped to the kind. Presets are a DEFINITION, not a default: a
-- preset role row stores no capabilities of its own and always resolves through here.
CREATE OR REPLACE FUNCTION org.fn_preset_capabilities(p_preset text, p_kind text)
RETURNS org.workspace_capability[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY(
        SELECT e.c
        FROM unnest(org.fn_kind_capabilities(p_kind)) WITH ORDINALITY AS e(c, n)
        WHERE e.c = ANY (CASE p_preset
            WHEN 'owner' THEN enum_range(NULL::org.workspace_capability)
            WHEN 'admin' THEN ARRAY['invite_members', 'remove_members', 'manage_roles', 'edit_profile', 'manage_settings', 'bind_seat', 'manage_projects', 'publish_listings', 'purchase', 'hire', 'contribute_funds', 'spend_funds', 'manage_finances', 'approve_spend', 'view_analytics', 'view_audit']::org.workspace_capability[]
            WHEN 'lead' THEN ARRAY['invite_members', 'bind_seat', 'manage_projects', 'publish_listings', 'purchase', 'contribute_funds', 'spend_funds', 'view_analytics']::org.workspace_capability[]
            WHEN 'member' THEN ARRAY['contribute_funds', 'view_analytics']::org.workspace_capability[]
            ELSE '{}'::org.workspace_capability[]
        END)
        ORDER BY e.n
    );
$$;

-- Privilege rank of a preset — higher outranks lower (common.ts `roleRank`). A custom role ranks as
-- its `base_preset`.
CREATE OR REPLACE FUNCTION org.fn_preset_rank(p_preset text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_preset WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'lead' THEN 2 WHEN 'member' THEN 1 ELSE 0 END;
$$;

-- A role row's resolved capability set: a preset's bundle, or a custom role's own list — both
-- kind-filtered, so a stale capability on a custom row can never leak into a kind that does not
-- render it.
CREATE OR REPLACE FUNCTION org.fn_role_capabilities(p_kind text, p_preset text, p_caps org.workspace_capability[])
RETURNS org.workspace_capability[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_preset IS NOT NULL THEN org.fn_preset_capabilities(p_preset, p_kind)
        ELSE ARRAY(
            SELECT e.c
            FROM unnest(org.fn_kind_capabilities(p_kind)) WITH ORDINALITY AS e(c, n)
            WHERE e.c = ANY (COALESCE(p_caps, '{}'))
            ORDER BY e.n
        )
    END;
$$;

-- A member's EFFECTIVE capabilities on an entity: `role ∪ granted − revoked`, kind-filtered, with
-- revocation winning. Empty for anybody who is not an active member. Internal (REVOKEd from every
-- client role): it answers for an arbitrary user, so exposing it would be a capability oracle.
CREATE OR REPLACE FUNCTION org.fn_member_capabilities(p_kind text, p_entity uuid, p_user uuid)
RETURNS org.workspace_capability[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_preset text;
    v_caps org.workspace_capability[];
    v_granted org.workspace_capability[];
    v_revoked org.workspace_capability[];
    v_base org.workspace_capability[];
BEGIN
    IF p_user IS NULL OR p_entity IS NULL THEN
        RETURN '{}';
    END IF;
    IF p_kind = 'team' THEN
        SELECT r.preset, r.capabilities, m.granted_capabilities, m.revoked_capabilities
          INTO v_preset, v_caps, v_granted, v_revoked
          FROM org.team_members m
          JOIN org.team_roles r ON r.id = m.role_id
         WHERE m.team_id = p_entity AND m.user_id = p_user AND m.status = 'active';
    ELSIF p_kind = 'business' THEN
        SELECT r.preset, r.capabilities, m.granted_capabilities, m.revoked_capabilities
          INTO v_preset, v_caps, v_granted, v_revoked
          FROM org.business_members m
          JOIN org.business_roles r ON r.id = m.role_id
         WHERE m.business_id = p_entity AND m.user_id = p_user AND m.status = 'active';
    ELSE
        RETURN '{}';
    END IF;
    IF NOT FOUND THEN
        RETURN '{}';
    END IF;

    v_base := org.fn_role_capabilities(p_kind, v_preset, v_caps);
    RETURN ARRAY(
        SELECT e.c
        FROM unnest(org.fn_kind_capabilities(p_kind)) WITH ORDINALITY AS e(c, n)
        WHERE (e.c = ANY (v_base) OR e.c = ANY (v_granted))
          AND NOT (e.c = ANY (v_revoked))
        ORDER BY e.n
    );
END;
$$;

-- Does the CALLER hold a capability on an entity? The one predicate every write RPC gates on.
CREATE OR REPLACE FUNCTION org.fn_member_can(p_kind text, p_entity uuid, p_cap org.workspace_capability)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_cap = ANY (org.fn_member_capabilities(p_kind, p_entity, auth.uid()));
$$;

-- The caller's active membership row on an entity, as (member id, preset rank). NULL row when not a
-- member.
CREATE OR REPLACE FUNCTION org.fn_member_seat(p_kind text, p_entity uuid, p_user uuid)
RETURNS TABLE (member_id uuid, preset text, rank integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT m.id, m.role, org.fn_preset_rank(m.role)
      FROM org.team_members m
     WHERE p_kind = 'team' AND m.team_id = p_entity AND m.user_id = p_user AND m.status = 'active'
    UNION ALL
    SELECT m.id, m.role, org.fn_preset_rank(m.role)
      FROM org.business_members m
     WHERE p_kind = 'business' AND m.business_id = p_entity AND m.user_id = p_user AND m.status = 'active';
$$;

-- The rank rule (SYSTEM_ARCHITECTURE §Teams & Businesses: "only someone you outrank"; IW-H4, IW-M4).
-- A member offers, assigns or edits only a role that ranks strictly BELOW their own seat. Equal is
-- refused as well as higher: a role at your own rank is your peers' standing, so seating somebody in
-- it, or rewriting it, is how one admin out-votes another — demote the role a peer holds, then remove
-- the peer. A seat ranks as its role (org.fn_member_role_sync), so outranking a role also means not
-- holding it. Not a member (`p_actor_rank` NULL): refused. One raise for the four doors that ask it —
-- invite_workspace_member, respond_to_join_request, update_workspace_member and upsert_workspace_role
-- — so they cannot word it four ways; `p_field` is the input the refusal names. Internal.
CREATE OR REPLACE FUNCTION org.fn_assert_role_below(p_actor_rank integer, p_role_base text, p_field text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
    IF p_actor_rank IS NULL OR org.fn_preset_rank(p_role_base) >= p_actor_rank THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = p_field || ': that role does not rank below yours';
    END IF;
END;
$$;
-- #endregion

-- #region 6b. org.is_team_lead — the authority to bind the team to work
-- "Lead" is not a role name any more: it is holding `bind_seat` on the team, which the owner, admin
-- and lead presets carry and a custom role may. Asked of the permission twin (§6) rather than a
-- hard-coded role list, so a custom role that grants seat-binding is honoured everywhere a lead is.
CREATE OR REPLACE FUNCTION org.is_team_lead(_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT org.fn_member_can('team', _team_id, 'bind_seat');
$$;
-- #endregion

-- #region 7. Money authority is DERIVED from the workspace capabilities
-- finance.vault_permissions is what every money function enforces (transfer_funds, distribute_vault,
-- decide_spend_approval, baskets). It used to be a second, hand-maintained authority that nothing but
-- the seed wrote, so a newly created entity's owner could not spend and a removed member kept
-- `withdraw`. It is now a PROJECTION of the workspace capabilities, rewritten by every membership,
-- role and override change — one fact, one editor:
--
--   every active member   → view
--   contribute_funds      → add_funds          spend_funds      → spend
--   withdraw_funds        → withdraw           manage_finances  → distribute
--   approve_spend         → approve_spend      the owner        → manage_members + manage_billing
--   manage_billing        → manage_billing     (business only: the owner's explicit grant to a named
--                                               admin, Decision #230 (d); a team's stays the owner's)
--
-- Anybody who is not an active member projects to the empty set (their row is kept, inert).
CREATE OR REPLACE FUNCTION org.fn_vault_capabilities_for(p_kind text, p_entity uuid, p_user uuid)
RETURNS finance.vault_capability[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caps org.workspace_capability[];
    v_owner uuid;
    v_out finance.vault_capability[] := '{}';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM org.fn_member_seat(p_kind, p_entity, p_user)) THEN
        RETURN '{}';
    END IF;
    v_caps := org.fn_member_capabilities(p_kind, p_entity, p_user);
    v_owner := CASE p_kind
        WHEN 'team' THEN (SELECT t.owner_user_id FROM org.teams t WHERE t.id = p_entity)
        WHEN 'business' THEN (SELECT b.owner_user_id FROM org.business_profiles b WHERE b.id = p_entity)
    END;

    v_out := ARRAY['view']::finance.vault_capability[];
    IF 'contribute_funds' = ANY (v_caps) THEN v_out := v_out || 'add_funds'::finance.vault_capability; END IF;
    IF 'spend_funds' = ANY (v_caps) THEN v_out := v_out || 'spend'::finance.vault_capability; END IF;
    IF 'manage_finances' = ANY (v_caps) THEN v_out := v_out || 'distribute'::finance.vault_capability; END IF;
    IF 'withdraw_funds' = ANY (v_caps) THEN v_out := v_out || 'withdraw'::finance.vault_capability; END IF;
    IF 'approve_spend' = ANY (v_caps) THEN v_out := v_out || 'approve_spend'::finance.vault_capability; END IF;
    IF v_owner = p_user THEN
        v_out := v_out || ARRAY['manage_members', 'manage_billing']::finance.vault_capability[];
    ELSIF p_kind = 'business' AND 'manage_billing' = ANY (v_caps) THEN
        v_out := v_out || 'manage_billing'::finance.vault_capability;
    END IF;
    RETURN v_out;
END;
$$;

-- Rewrite the vault projection for one member (or, with p_user NULL, every member) across every
-- wallet the entity holds. Called by every RPC below that changes who holds what, and by the
-- finance.wallets insert trigger, so a wallet opened in a new currency is governed from birth.
CREATE OR REPLACE FUNCTION org.fn_sync_vault_permissions(p_kind text, p_entity uuid, p_user uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT w.id AS wallet_id, u.user_id
          FROM finance.wallets w
         CROSS JOIN LATERAL (
            SELECT m.user_id FROM org.team_members m
             WHERE p_kind = 'team' AND m.team_id = p_entity AND (p_user IS NULL OR m.user_id = p_user)
            UNION
            SELECT m.user_id FROM org.business_members m
             WHERE p_kind = 'business' AND m.business_id = p_entity AND (p_user IS NULL OR m.user_id = p_user)
         ) u
         WHERE w.owner_type = p_kind AND w.owner_id = p_entity
           AND EXISTS (SELECT 1 FROM org.users_public up WHERE up.user_id = u.user_id)
    LOOP
        INSERT INTO finance.vault_permissions (wallet_id, member_user_id, capabilities, granted_by)
        VALUES (r.wallet_id, r.user_id, org.fn_vault_capabilities_for(p_kind, p_entity, r.user_id), auth.uid())
        ON CONFLICT (wallet_id, member_user_id) DO UPDATE
            SET capabilities = EXCLUDED.capabilities,
                granted_by = EXCLUDED.granted_by,
                updated_at = now()
          WHERE finance.vault_permissions.capabilities IS DISTINCT FROM EXCLUDED.capabilities;
    END LOOP;
END;
$$;

-- The backstop (Decision #226 (e)): the RPCs above sync explicitly, and these triggers re-project on
-- ANY write to a member's role, status or overrides, or to a role's capabilities, so a future write
-- path that forgets the call cannot leave a stale vault grant. Both are no-ops when the projection
-- already matches (fn_sync_vault_permissions writes only a changed row). A departed member's row is
-- rewritten to '{}', never deleted. Bound in 00001895.
CREATE OR REPLACE FUNCTION org.fn_trg_sync_vault_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_TABLE_NAME = 'team_members' THEN
        PERFORM org.fn_sync_vault_permissions('team', NEW.team_id, NEW.user_id);
    ELSE
        PERFORM org.fn_sync_vault_permissions('business', NEW.business_id, NEW.user_id);
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION org.fn_trg_sync_vault_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r record;
BEGIN
    IF TG_TABLE_NAME = 'team_roles' THEN
        FOR r IN SELECT m.user_id FROM org.team_members m WHERE m.role_id = NEW.id AND m.status = 'active' LOOP
            PERFORM org.fn_sync_vault_permissions('team', NEW.team_id, r.user_id);
        END LOOP;
    ELSE
        FOR r IN SELECT m.user_id FROM org.business_members m WHERE m.role_id = NEW.id AND m.status = 'active' LOOP
            PERFORM org.fn_sync_vault_permissions('business', NEW.business_id, r.user_id);
        END LOOP;
    END IF;
    RETURN NULL;
END;
$$;

-- Move a member's workspace override so their EFFECTIVE set does (p_want) or does not hold a
-- capability, recording it as the smallest honest override: a grant only when the role lacks it, a
-- revocation only when the role has it. The Spend-policy editor and the member drawer both write
-- through here, so "can spend" is one fact with one representation.
CREATE OR REPLACE FUNCTION org.fn_set_member_capability(
    p_kind text, p_member uuid, p_cap org.workspace_capability, p_want boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_base org.workspace_capability[];
    v_granted org.workspace_capability[];
    v_revoked org.workspace_capability[];
BEGIN
    IF p_kind = 'team' THEN
        SELECT org.fn_role_capabilities('team', r.preset, r.capabilities), m.granted_capabilities, m.revoked_capabilities
          INTO v_base, v_granted, v_revoked
          FROM org.team_members m JOIN org.team_roles r ON r.id = m.role_id
         WHERE m.id = p_member;
    ELSE
        SELECT org.fn_role_capabilities('business', r.preset, r.capabilities), m.granted_capabilities, m.revoked_capabilities
          INTO v_base, v_granted, v_revoked
          FROM org.business_members m JOIN org.business_roles r ON r.id = m.role_id
         WHERE m.id = p_member;
    END IF;

    v_granted := array_remove(v_granted, p_cap);
    v_revoked := array_remove(v_revoked, p_cap);
    IF p_want AND NOT (p_cap = ANY (v_base)) THEN
        v_granted := v_granted || p_cap;
    ELSIF NOT p_want AND p_cap = ANY (v_base) THEN
        v_revoked := v_revoked || p_cap;
    END IF;

    IF p_kind = 'team' THEN
        UPDATE org.team_members SET granted_capabilities = v_granted, revoked_capabilities = v_revoked WHERE id = p_member;
    ELSE
        UPDATE org.business_members SET granted_capabilities = v_granted, revoked_capabilities = v_revoked WHERE id = p_member;
    END IF;
END;
$$;
-- #endregion

-- #region 7b. Owner-reserved rights (business) — Decision #230 (d), (d.1)
-- A business's withdraw_funds, manage_billing and archive_entity are the OWNER's: the owner preset
-- holds them and the admin preset does not. The owner — and only the owner — hands them on, one named
-- member at a time: the billing right to an admin seat, and all three to an admin seat to make a
-- co-owner (the owner's own set on an admin seat; never a second owner seat — fn_member_role_sync's
-- 23514 stands). They are never a role's on a business (org.upsert_workspace_role refuses them), so a
-- member's per-person override is the only way to hold one, and org.update_workspace_member is the
-- only door that moves it: the owner grants (answered with the typed CONFIRM the console's warning
-- asks for) or revokes, the holder may give a grant up (`relinquish`), leaving clears it, and an
-- ownership transfer clears every grant of them. A team reserves nothing.
CREATE OR REPLACE FUNCTION org.fn_reserved_capabilities(p_kind text)
RETURNS org.workspace_capability[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE WHEN p_kind = 'business'
        THEN ARRAY['withdraw_funds', 'manage_billing', 'archive_entity']::org.workspace_capability[]
        ELSE '{}'::org.workspace_capability[]
    END;
$$;

-- The one check every reserved-right move answers: when a member's EFFECTIVE hold on the reserved
-- set differs between p_before and p_after, the caller must be the owner, and a newly held right needs
-- the typed confirmation.
CREATE OR REPLACE FUNCTION org.fn_assert_reserved_change(
    p_kind text, p_entity uuid, p_before org.workspace_capability[], p_after org.workspace_capability[], p_confirm text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reserved org.workspace_capability[] := org.fn_reserved_capabilities(p_kind);
    v_before org.workspace_capability[];
    v_after org.workspace_capability[];
BEGIN
    IF cardinality(v_reserved) = 0 THEN
        RETURN;
    END IF;
    v_before := ARRAY(SELECT DISTINCT c FROM unnest(COALESCE(p_before, '{}')) c WHERE c = ANY (v_reserved) ORDER BY c);
    v_after := ARRAY(SELECT DISTINCT c FROM unnest(COALESCE(p_after, '{}')) c WHERE c = ANY (v_reserved) ORDER BY c);
    IF v_before = v_after THEN
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org.business_profiles b WHERE b.id = p_entity AND b.owner_user_id = auth.uid()) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'reserved: only the owner grants or takes away billing, withdrawal or archiving';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_after) c WHERE NOT (c = ANY (v_before)))
       AND COALESCE(p_confirm, '') <> 'CONFIRM' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'confirm: type CONFIRM to grant billing, withdrawal or archiving';
    END IF;
END;
$$;
-- #endregion

-- #region 8. Membership integrity (trigger functions)
-- A member's `role` is DERIVED from the role row they hold (its `base_preset`), and the single-owner
-- invariant is structural: the owner-preset seat is held by exactly the entity's `owner_user_id`, and
-- the owner always holds it. Row-level, so the transfer RPC must move `owner_user_id` BEFORE it
-- re-seats the two members (it does).
CREATE OR REPLACE FUNCTION org.fn_member_role_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_base text;
    v_owner uuid;
BEGIN
    IF TG_TABLE_NAME = 'team_members' THEN
        SELECT r.base_preset INTO v_base FROM org.team_roles r WHERE r.id = NEW.role_id;
        SELECT t.owner_user_id INTO v_owner FROM org.teams t WHERE t.id = NEW.team_id;
    ELSE
        SELECT r.base_preset INTO v_base FROM org.business_roles r WHERE r.id = NEW.role_id;
        SELECT b.owner_user_id INTO v_owner FROM org.business_profiles b WHERE b.id = NEW.business_id;
    END IF;
    NEW.role := v_base;

    IF NEW.status = 'active' THEN
        IF v_base = 'owner' AND NEW.user_id IS DISTINCT FROM v_owner THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'role: only the owner holds the owner role — transfer ownership instead';
        END IF;
        IF NEW.user_id = v_owner AND v_base <> 'owner' THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'role: the owner always holds the owner role';
        END IF;
    ELSIF NEW.user_id = v_owner THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'member: the owner cannot leave — transfer ownership first';
    END IF;
    RETURN NEW;
END;
$$;
-- #endregion

-- #region 9. Handles — one namespace across people and entities
-- Four tables hold a public `@handle` (users_public.username, teams.slug, business_profiles.slug,
-- enterprises.handle), each UNIQUE only within itself, and org.fn_resolve_profile ranks a person
-- above a team above a business. So an entity could claim a handle a person already held and then
-- be unreachable at /@handle forever. Every create path now asks the whole namespace, under an
-- advisory lock on the handle so two creates racing for it cannot both see it free.

-- The SQL twin of @projective/types/profile RESERVED_HANDLES (pinned by workspace.contract.test.ts,
-- which also fails when a top-level segment under apps/web/routes/ is missing from the list — a new
-- top-level route is reserved here AND in RESERVED_HANDLES in the same change, pr-checklist.md).
CREATE OR REPLACE FUNCTION org.fn_is_reserved_handle(p_handle text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT lower(btrim(COALESCE(p_handle, ''))) = ANY (ARRAY[
        'about', 'explore', 'help', 'view', 'join', 'login', 'register', 'signin', 'signup', 'logout',
        'forgot-password', 'reset-password', 'verify', 'index', 'home', 'pricing', 'terms', 'privacy',
        'legal', 'contact', 'blog', 'careers', 'status', 'changelog', 'feedback', 'features',
        'dashboard', 'projects', 'project', 'business',
        'businesses', 'teams', 'team', 'messages', 'inbox', 'files', 'file', 'inspect', 'share', 'exit', 'wallet', 'billing',
        'settings', 'services', 'service', 'products', 'portfolio', 'reviews', 'articles', 'members',
        'departments', 'education', 'experience', 'availability', 'become-partner', 'onboarding',
        'notifications', 'basket', 'cart', 'checkout', 'catalogue', 'orders', 'order', 'pay', 'payment',
        'payments', 'invoice', 'invoices', 'create', 'new', 'search', 'submissions', 'attachments',
        'board', 'tasks', 'calendar', 'invite', 'saved', 'api', 'assets', 'static', 'public', '_app',
        '_middleware', '_layout', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'admin', 'internal'
    ]);
$$;

-- Is this handle taken anywhere in the namespace (case-insensitively)? A handle a person gave up in
-- the last 90 days (org.handle_changes) counts as taken, so nobody can step into a renamed person's
-- old links; only its previous owner may take it back (org.change_username, 00001060).
CREATE OR REPLACE FUNCTION org.fn_handle_taken(p_handle text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (SELECT 1 FROM org.users_public u WHERE lower(u.username) = lower(p_handle))
        OR EXISTS (SELECT 1 FROM org.teams t WHERE lower(t.slug) = lower(p_handle))
        OR EXISTS (SELECT 1 FROM org.business_profiles b WHERE lower(b.slug) = lower(p_handle))
        OR EXISTS (SELECT 1 FROM org.enterprises o WHERE lower(o.handle) = lower(p_handle))
        OR EXISTS (
            SELECT 1 FROM org.handle_changes h
             WHERE lower(h.old_handle) = lower(p_handle) AND h.changed_at > now() - interval '90 days'
        );
$$;

-- Why a handle cannot be claimed, or NULL when it can. The same rule the create form's probe shows.
CREATE OR REPLACE FUNCTION org.fn_handle_refusal(p_handle text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_handle IS NULL OR length(p_handle) < 3 THEN 'Handles are at least 3 characters.'
        WHEN length(p_handle) > 40 THEN 'Handles are 40 characters or fewer.'
        WHEN p_handle !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' THEN 'Lowercase letters, numbers and hyphens only.'
        WHEN org.fn_is_reserved_handle(p_handle) THEN 'That handle is reserved.'
        WHEN org.fn_handle_taken(p_handle) THEN 'That handle is taken.'
        ELSE NULL
    END;
$$;

-- The create form's availability probe. Authenticated only: an availability answer is an existence
-- oracle, and the rate limit lives in the thin route.
CREATE OR REPLACE FUNCTION org.check_handle(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reason text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in to check a handle';
    END IF;
    v_reason := org.fn_handle_refusal(lower(btrim(COALESCE(p_handle, ''))));
    RETURN jsonb_build_object('handle', lower(btrim(COALESCE(p_handle, ''))), 'available', v_reason IS NULL, 'reason', v_reason);
END;
$$;
-- #endregion

-- #region 10. Creating a team or business — Draft-First
-- The one door (the old create_team / create_business are retired: create_team trusted a
-- caller-supplied owner and was executable by anon; create_business rewrote the caller's session
-- context behind their back). Identity is auth.uid() only; the entity starts `draft`; the preset
-- roles, the owner's seat, the wallet (whose insert trigger projects the owner's vault authority) and,
-- for a team, the owner's 100% payout stake are written in one transaction. The plan's
-- `teams_owned` / `businesses_owned` entitlement is enforced here, not in the client.
CREATE OR REPLACE FUNCTION org.fn_seed_preset_roles(p_kind text, p_entity uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_kind = 'team' THEN
        INSERT INTO org.team_roles (team_id, name, summary, preset, base_preset) VALUES
            (p_entity, 'Owner', 'Full authority, including archiving and transferring ownership.', 'owner', 'owner'),
            (p_entity, 'Admin', 'Runs the roster, the money and the settings — everything but archiving.', 'admin', 'admin'),
            (p_entity, 'Lead', 'Binds the team to seats and runs delivery, without restructuring the roster.', 'lead', 'lead'),
            (p_entity, 'Member', 'Does the work and sees how the entity is performing.', 'member', 'member');
    ELSE
        -- A business's own remits (PRODUCT_SPEC's role table): its Admin lacks the three owner-reserved
        -- rights unless granted (Decision #230 (d), #238), and its Member is buyer-side (#249 (m)).
        INSERT INTO org.business_roles (business_id, name, summary, preset, base_preset) VALUES
            (p_entity, 'Owner', 'Full authority, including archiving and transferring ownership.', 'owner', 'owner'),
            (p_entity, 'Admin', 'Runs the roster, the money and the settings — everything but withdrawing, billing and archiving, unless the owner grants them.', 'admin', 'admin'),
            (p_entity, 'Member', 'Adds funds to the wallet and sees the analytics; anything more comes from a custom role.', 'member', 'member');
    END IF;
END;
$$;

-- Keep the two derived flags on org.users_public true to membership.
CREATE OR REPLACE FUNCTION org.fn_refresh_membership_flags(p_user uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE org.users_public up
       SET has_team = EXISTS (SELECT 1 FROM org.team_members m WHERE m.user_id = p_user AND m.status = 'active'),
           has_business = EXISTS (SELECT 1 FROM org.business_members m WHERE m.user_id = p_user AND m.status = 'active')
     WHERE up.user_id = p_user;
$$;

-- Teams are freelancer-only (Decision #228 (A)): a client, or a freelancer in operator mode, never
-- creates, joins or is invited to one. "Is a freelancer" is the row finance.fn_freelancer_payout_ready
-- reads (org.freelancer_profiles) AND the live persona flag: dropping the persona (a scheduled removal)
-- keeps the row but clears is_freelancer, and that account is a client. Asked before the earning gate,
-- so the refusal names the real reason. HINT says whose persona it is — `self` or `other` (an invitee,
-- a successor); DETAIL says which side they are on — `client` or `operator`.
CREATE OR REPLACE FUNCTION org.fn_assert_team_persona(p_user uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_freelancer boolean;
    v_operator boolean;
BEGIN
    SELECT u.is_freelancer AND EXISTS (SELECT 1 FROM org.freelancer_profiles fp WHERE fp.user_id = u.user_id),
           u.is_operator IS TRUE
      INTO v_freelancer, v_operator
      FROM org.users_public u
     WHERE u.user_id = p_user;
    IF v_freelancer IS TRUE AND NOT v_operator THEN
        RETURN;
    END IF;
    RAISE EXCEPTION USING
        ERRCODE = 'PK403',
        MESSAGE = 'persona_not_freelancer: ' || CASE WHEN p_user = auth.uid()
            THEN 'Teams are for freelancer accounts'
            ELSE 'only freelancer accounts can join a team' END,
        HINT = CASE WHEN p_user = auth.uid() THEN 'self' ELSE 'other' END,
        DETAIL = CASE WHEN v_freelancer IS TRUE AND v_operator THEN 'operator' ELSE 'client' END;
END;
$$;

CREATE OR REPLACE FUNCTION org.create_workspace(p_kind text, p_name text, p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_name text := btrim(COALESCE(p_name, ''));
    v_handle text := lower(btrim(COALESCE(p_handle, '')));
    v_refusal text;
    v_key finance.entitlement_key;
    v_limit integer;
    v_used integer;
    v_currency text;
    v_id uuid;
    v_owner_role uuid;
    v_wallet uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in to create a team or business';
    END IF;
    IF p_kind IS NULL OR p_kind NOT IN ('team', 'business') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kind: choose a team or a business';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = v_uid) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: finish setting up your account first';
    END IF;
    -- A team or business holds a pooled wallet and signs for work: an adult's (Decision #208).
    PERFORM org.fn_assert_adult(v_uid);
    IF length(v_name) < 2 OR length(v_name) > 80 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'name: give it a name between 2 and 80 characters';
    END IF;
    -- A team is a freelancer persona made multi-seat (Decision #228 (A)), and it earns as one:
    -- everyone in it must be payable before it exists (Decision #196).
    IF p_kind = 'team' THEN
        PERFORM org.fn_assert_team_persona(v_uid);
        PERFORM finance.fn_assert_payout_ready('freelancer', v_uid);
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('handle:' || v_handle));
    v_refusal := org.fn_handle_refusal(v_handle);
    IF v_refusal IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'handle: ' || v_refusal;
    END IF;

    v_key := CASE p_kind WHEN 'team' THEN 'teams_owned' ELSE 'businesses_owned' END::finance.entitlement_key;
    v_limit := finance.fn_effective_limit('user', v_uid, v_key);
    v_used := finance.fn_footprint_usage('user', v_uid, v_key);
    IF v_limit IS NOT NULL AND v_used >= v_limit THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'plan: your plan includes ' || v_limit || ' '
            || CASE p_kind
                WHEN 'team' THEN CASE WHEN v_limit = 1 THEN 'team' ELSE 'teams' END
                ELSE CASE WHEN v_limit = 1 THEN 'business' ELSE 'businesses' END
            END || ' — archive one or upgrade to create another';
    END IF;

    v_currency := COALESCE(
        (SELECT upper(p.preferred_display_currency) FROM org.user_preferences p WHERE p.user_id = v_uid),
        'USD'
    );

    IF p_kind = 'team' THEN
        INSERT INTO org.teams (owner_user_id, name, slug, status, headline, visibility)
        VALUES (v_uid, v_name, v_handle, 'draft', '', 'invite_only')
        RETURNING id INTO v_id;
        PERFORM org.fn_seed_preset_roles('team', v_id);
        SELECT r.id INTO v_owner_role FROM org.team_roles r WHERE r.team_id = v_id AND r.preset = 'owner';
        INSERT INTO org.team_members (team_id, user_id, role_id, status) VALUES (v_id, v_uid, v_owner_role, 'active');
        INSERT INTO finance.wallets (owner_type, owner_id, currency) VALUES ('team', v_id, v_currency)
        RETURNING id INTO v_wallet;
        UPDATE org.teams SET treasury_wallet_id = v_wallet WHERE id = v_id;
        INSERT INTO finance.contribution_agreements (team_id, member_user_id, percent_bp, held)
        VALUES (v_id, v_uid, 10000, false);
    ELSE
        INSERT INTO org.business_profiles (owner_user_id, name, slug, status, headline, default_currency, visibility)
        VALUES (v_uid, v_name, v_handle, 'draft', '', v_currency, 'invite_only')
        RETURNING id INTO v_id;
        PERFORM org.fn_seed_preset_roles('business', v_id);
        SELECT r.id INTO v_owner_role FROM org.business_roles r WHERE r.business_id = v_id AND r.preset = 'owner';
        INSERT INTO org.business_members (business_id, user_id, role_id, status) VALUES (v_id, v_uid, v_owner_role, 'active');
        INSERT INTO finance.wallets (owner_type, owner_id, currency) VALUES ('business', v_id, v_currency);
    END IF;

    PERFORM org.fn_refresh_membership_flags(v_uid);

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, p_kind || '.created', CASE p_kind WHEN 'team' THEN 'org.teams' ELSE 'org.business_profiles' END, v_id,
            jsonb_build_object('handle', v_handle, 'name', v_name));

    RETURN jsonb_build_object('id', v_id, 'kind', p_kind, 'handle', v_handle);
END;
$$;
-- #endregion

-- #region 11. Lifecycle — draft → active → archived (nothing is hard-deleted)
-- Only a published business transacts (BUSINESSES_AUDIT BF7): a draft is still being set up and an
-- archived one is gone, so neither creates projects, buys, funds, hires, pays an invoice or changes its
-- invoicing terms. Every such door calls this with the business it acts for; NULL is "no business"
-- (a personal project, an individual buyer) and passes, so a door can call it unconditionally.
CREATE OR REPLACE FUNCTION org.fn_assert_business_active(p_business uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status text;
BEGIN
    IF p_business IS NULL THEN
        RETURN;
    END IF;
    SELECT b.status INTO v_status FROM org.business_profiles b WHERE b.id = p_business;
    IF v_status IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workspace: not found';
    END IF;
    IF v_status <> 'active' THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = CASE v_status
                WHEN 'archived' THEN 'business_not_active: this business is archived — restore it first'
                ELSE 'business_not_active: publish the business first' END,
            DETAIL = pg_catalog.jsonb_build_object('business_id', p_business, 'status', v_status)::text;
    END IF;
END;
$$;

COMMENT ON FUNCTION org.fn_assert_business_active(uuid) IS
'Refuse 55000 business_not_active unless the business is active (DETAIL {business_id, status}); NULL
passes, P0002 when the business does not exist. Called by every door that spends, hires or bills for a
business. Internal — not executable by clients.';

-- Money INTO a business wallet (Decision #248 (k)): a draft may be funded before it publishes — its
-- setup asks for money before Publish (#236 (f)) — but an archived business takes nothing in, since
-- nothing can spend from it until it is restored. Every door that credits a business wallet calls this
-- with the wallet's business; NULL passes. The row is locked FOR SHARE until the caller's transaction
-- ends: org.set_workspace_status locks it FOR UPDATE before it counts the archive blockers, so an
-- archive racing a credit either waits and then sees the money (`wallet_balance`), or wins and the
-- credit sees `archived`.
CREATE OR REPLACE FUNCTION org.fn_assert_business_not_archived(p_business uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status text;
BEGIN
    IF p_business IS NULL THEN
        RETURN;
    END IF;
    SELECT b.status INTO v_status FROM org.business_profiles b WHERE b.id = p_business FOR SHARE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workspace: not found';
    END IF;
    IF v_status = 'archived' THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'business_not_active: this business is archived — restore it first',
            DETAIL = pg_catalog.jsonb_build_object('business_id', p_business, 'status', v_status)::text;
    END IF;
END;
$$;

COMMENT ON FUNCTION org.fn_assert_business_not_archived(uuid) IS
'Refuse 55000 business_not_active (org.fn_assert_business_active''s archived wording, DETAIL
{business_id, status}) when the business is archived; a draft or active business passes, NULL passes,
P0002 when it does not exist. Locks the business row FOR SHARE. Called by every door that moves money
into a business wallet. Internal — not executable by clients.';

-- Everything that would be stranded if a team were archived now, in a business's {code, count} shape
-- and a fixed order — `[]` when it may be archived. The archive door refuses on the first, and the
-- console detail lists them all before the confirm (Teams C6; TEAMS_AUDIT S3, S4):
--   escrow_held        held escrows for the team's work: owed to the team, or — on a stage the team is
--                      (or was, to completion) assigned to — not bound yet (Decision #197's prepaid
--                      escrow) or bound to one of its members (the team-seat payee rule). A non-member's
--                      escrow on a shared stage is theirs, and a stage the team handed back (released ·
--                      cancelled · declined) is its next assignee's.
--   live_assignments   its stage assignments still live (not declined, cancelled, released or
--                      completed) on an active or on-hold project
CREATE OR REPLACE FUNCTION org.fn_team_archive_blockers(p_team uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_out jsonb := '[]'::jsonb;
    v_count bigint;
BEGIN
    SELECT count(*) INTO v_count FROM finance.escrows e
     WHERE e.status = 'held'
       AND ((e.payee_type = 'team' AND e.payee_id = p_team)
         OR ((e.payee_id IS NULL
              OR (e.payee_type = 'freelancer' AND EXISTS (
                    SELECT 1 FROM org.team_members tm
                     WHERE tm.team_id = p_team AND tm.user_id = e.payee_id)))
             AND EXISTS (
                SELECT 1 FROM projects.stage_assignments sa
                 WHERE sa.project_stage_id = e.project_stage_id
                   AND sa.team_id = p_team
                   AND sa.status NOT IN ('declined', 'cancelled', 'released'))));
    IF v_count > 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'escrow_held', 'count', v_count));
    END IF;

    SELECT count(*) INTO v_count FROM projects.stage_assignments sa
      JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
      JOIN projects.projects pr ON pr.id = ps.project_id
     WHERE sa.team_id = p_team
       AND sa.status NOT IN ('declined', 'cancelled', 'released', 'completed')
       AND pr.status IN ('active', 'on_hold');
    IF v_count > 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'live_assignments', 'count', v_count));
    END IF;

    RETURN v_out;
END;
$$;

COMMENT ON FUNCTION org.fn_team_archive_blockers(uuid) IS
'What stops a team being archived: [{code, count}] over escrow_held · live_assignments, in that order;
[] when nothing does. Read by org.set_workspace_status and org.get_workspace_detail. Internal.';

-- Everything that would be stranded if a business were archived now, one {code, count} per kind of
-- blocker that applies, in a fixed order — `[]` when it may be archived. The archive door refuses on the
-- first, and the console detail lists them all before the confirm (BUSINESSES_AUDIT BF8, BF9):
--   escrow_held        held escrows the business funded
--   live_projects      its projects that are active or on hold
--   pending_approvals  spend requests on its wallets still awaiting a decision (and not lapsed)
--   unpaid_invoices    invoices issued to it or overdue
--   on_account_owed    currencies in which it owes on account (finance.fn_on_account_owed > 0)
--   wallet_balance     its wallets holding a positive balance
--   pending_payouts    withdrawals from its wallets still in flight
CREATE OR REPLACE FUNCTION org.fn_business_archive_blockers(p_business uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_out jsonb := '[]'::jsonb;
    v_count bigint;
BEGIN
    SELECT count(*) INTO v_count FROM finance.escrows e
     WHERE e.payer_business_id = p_business AND e.status = 'held';
    IF v_count > 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'escrow_held', 'count', v_count));
    END IF;

    SELECT count(*) INTO v_count FROM projects.projects p
     WHERE p.client_business_id = p_business AND p.status::text IN ('active', 'on_hold');
    IF v_count > 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'live_projects', 'count', v_count));
    END IF;

    SELECT count(*) INTO v_count FROM finance.spend_approvals sa
      JOIN finance.wallets w ON w.id = sa.wallet_id
     WHERE w.owner_type = 'business' AND w.owner_id = p_business
       AND sa.status = 'pending'::finance.approval_status
       AND (sa.expires_at IS NULL OR sa.expires_at > now());
    IF v_count > 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'pending_approvals', 'count', v_count));
    END IF;

    SELECT count(*) INTO v_count FROM finance.invoices i
     WHERE i.issue_to_business_id = p_business AND i.status IN ('issued', 'overdue');
    IF v_count > 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'unpaid_invoices', 'count', v_count));
    END IF;

    SELECT count(*) INTO v_count FROM (
        SELECT DISTINCT upper(w.currency) AS currency FROM finance.wallets w
         WHERE w.owner_type = 'business' AND w.owner_id = p_business
    ) c
     WHERE finance.fn_on_account_owed(p_business, c.currency) > 0;
    IF v_count > 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'on_account_owed', 'count', v_count));
    END IF;

    SELECT count(*) INTO v_count FROM finance.wallets w
     WHERE w.owner_type = 'business' AND w.owner_id = p_business AND w.balance_cents > 0;
    IF v_count > 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'wallet_balance', 'count', v_count));
    END IF;

    SELECT count(*) INTO v_count FROM finance.payouts po
      JOIN finance.wallets w ON w.id = po.wallet_id
     WHERE w.owner_type = 'business' AND w.owner_id = p_business
       AND po.status = 'pending'::finance.payout_status;
    IF v_count > 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object('code', 'pending_payouts', 'count', v_count));
    END IF;

    RETURN v_out;
END;
$$;

COMMENT ON FUNCTION org.fn_business_archive_blockers(uuid) IS
'What stops a business being archived: [{code, count}] over escrow_held · live_projects ·
pending_approvals · unpaid_invoices · on_account_owed · wallet_balance · pending_payouts, in that order;
[] when nothing does. Read by org.set_workspace_status and org.get_workspace_detail. Internal.';

-- Where a restore lands (Decision #250 (c); for a business, #236 (d) as the owner ruled it): `active`
-- when the entity was ever published, else `draft` — so a published entity never returns to draft, and
-- one that never was cannot skip the publish step by being archived and restored. "Ever published" is
-- read from the trail org.set_workspace_status writes on every change (`{kind}.status_changed`,
-- metadata {from, to}): a change to or from `active`. Active → draft is refused, so that is exactly "it
-- was live once". An entity with no such trail (a seeded or hand-written row) has no evidence of ever
-- being published and restores to `draft` — one Publish away from live, never listed without its
-- owner's say.
CREATE OR REPLACE FUNCTION org.fn_workspace_restore_target(p_kind text, p_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM security.audit_logs a
         WHERE a.entity_id = p_id
           AND a.action = p_kind || '.status_changed'
           AND a.entity_table = CASE p_kind WHEN 'team' THEN 'org.teams' ELSE 'org.business_profiles' END
           AND 'active' IN (a.metadata->>'from', a.metadata->>'to')
    ) THEN 'active' ELSE 'draft' END;
$$;

COMMENT ON FUNCTION org.fn_workspace_restore_target(text, uuid) IS
'Where restoring an archived team or business lands: active if its status trail ever touched active,
else draft (no trail at all = draft). Read by org.set_workspace_status and org.get_workspace_detail.
Internal.';

-- Publishing needs `manage_settings`; archiving or restoring needs `archive_entity`. An entity with
-- money in flight is not archived: a team is held to every blocker org.fn_team_archive_blockers lists
-- (money held for its work, a live stage assignment) and a business to every one
-- org.fn_business_archive_blockers lists, each refused on the first with DETAIL {blockers}. A restore —
-- `restore`, or its target named outright — lands where org.fn_workspace_restore_target says
-- (Decision #250 (c)): naming the other status is refused `22023 restore_target:` with DETAIL {target},
-- so nobody publishes an entity by restoring it, or sends a published one back to draft.
CREATE OR REPLACE FUNCTION org.set_workspace_status(p_kind text, p_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_current text;
    v_to text := p_status;
    v_target text;
    v_blockers jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('draft', 'active', 'archived', 'restore') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'status: choose draft, active, archived or restore';
    END IF;
    IF p_kind = 'team' THEN
        SELECT t.status INTO v_current FROM org.teams t WHERE t.id = p_id FOR UPDATE;
    ELSIF p_kind = 'business' THEN
        SELECT b.status INTO v_current FROM org.business_profiles b WHERE b.id = p_id FOR UPDATE;
    ELSE
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kind: choose a team or a business';
    END IF;
    IF v_current IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workspace: not found';
    END IF;
    IF v_current = p_status THEN
        RETURN jsonb_build_object('id', p_id, 'status', p_status);
    END IF;
    IF p_status = 'restore' AND v_current <> 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'status: only an archived ' || p_kind || ' is restored';
    END IF;

    IF p_status = 'archived' OR v_current = 'archived' THEN
        IF NOT org.fn_member_can(p_kind, p_id, 'archive_entity') THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'status: you cannot archive or restore this ' || p_kind;
        END IF;
    ELSIF NOT org.fn_member_can(p_kind, p_id, 'manage_settings') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'status: you cannot change this ' || p_kind || '''s settings';
    END IF;

    IF v_current = 'archived' THEN
        v_target := org.fn_workspace_restore_target(p_kind, p_id);
        IF p_status = 'restore' THEN
            v_to := v_target;
        ELSIF p_status <> v_target THEN
            RAISE EXCEPTION USING
                ERRCODE = '22023',
                MESSAGE = 'restore_target: ' || CASE v_target
                    WHEN 'active' THEN 'this ' || p_kind || ' was published, so it is restored to active — a published '
                                       || p_kind || ' never goes back to draft'
                    ELSE 'this ' || p_kind || ' was never published, so it is restored as a draft — publish it from there' END,
                DETAIL = jsonb_build_object('target', v_target)::text;
        END IF;
    END IF;
    IF v_to = 'draft' AND v_current = 'active' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'status: a published ' || p_kind || ' cannot go back to draft';
    END IF;

    IF v_to = 'archived' THEN
        v_blockers := CASE p_kind
            WHEN 'team' THEN org.fn_team_archive_blockers(p_id)
            ELSE org.fn_business_archive_blockers(p_id) END;
        IF jsonb_array_length(v_blockers) > 0 THEN
            -- A team's two refusals keep their `status:` sentences; a business's MESSAGE leads with the
            -- blocker's code. Both carry every blocker in DETAIL.
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = CASE WHEN p_kind = 'team' THEN CASE v_blockers->0->>'code'
                        WHEN 'escrow_held' THEN 'status: money is held in escrow for this team — let it release first'
                        ELSE 'status: this team is still assigned to live work — finish or hand it back first' END
                    ELSE (v_blockers->0->>'code') || ': ' || CASE v_blockers->0->>'code'
                        WHEN 'escrow_held' THEN 'money is held in escrow for this business — let it release first'
                        WHEN 'live_projects' THEN 'this business still has live projects — complete or archive them first'
                        WHEN 'pending_approvals' THEN 'spend requests are still waiting for a decision — decide them first'
                        WHEN 'unpaid_invoices' THEN 'this business has unpaid invoices — pay them first'
                        WHEN 'on_account_owed' THEN 'this business still owes on account — settle it first'
                        WHEN 'wallet_balance' THEN 'the business wallet still holds money — withdraw or move it first'
                        ELSE 'a withdrawal from the business wallet is still in flight — let it settle first' END END,
                DETAIL = jsonb_build_object('blockers', v_blockers)::text;
        END IF;
    END IF;

    IF p_kind = 'team' THEN
        UPDATE org.teams SET status = v_to, updated_at = now() WHERE id = p_id;
    ELSE
        UPDATE org.business_profiles SET status = v_to, updated_at = now() WHERE id = p_id;
    END IF;
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, p_kind || '.status_changed', CASE p_kind WHEN 'team' THEN 'org.teams' ELSE 'org.business_profiles' END, p_id,
            jsonb_build_object('from', v_current, 'to', v_to));
    RETURN jsonb_build_object('id', p_id, 'status', v_to);
END;
$$;

-- The identity patch: name, headline and directory visibility. Pictures move through the media pipeline
-- (org.set_profile_avatar / org.set_profile_banner), status through org.set_workspace_status. Visibility
-- is `public` · `unlisted` · `invite_only` for either kind (Decision #230 (h)); being in the directory at
-- all still needs the entity to be active (org.profiles_index).
CREATE OR REPLACE FUNCTION org.update_workspace(p_kind text, p_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_name text;
    v_headline text;
    v_visibility text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_kind NOT IN ('team', 'business') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kind: choose a team or a business';
    END IF;
    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'patch: expected an object';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM org.teams t WHERE p_kind = 'team' AND t.id = p_id
        UNION ALL SELECT 1 FROM org.business_profiles b WHERE p_kind = 'business' AND b.id = p_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workspace: not found';
    END IF;
    IF NOT org.fn_member_can(p_kind, p_id, 'edit_profile') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'workspace: you cannot edit this ' || p_kind || '''s profile';
    END IF;
    IF p_patch ? 'name' THEN
        v_name := btrim(COALESCE(p_patch->>'name', ''));
        IF length(v_name) < 2 OR length(v_name) > 80 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'name: give it a name between 2 and 80 characters';
        END IF;
    END IF;
    IF p_patch ? 'headline' THEN
        v_headline := btrim(COALESCE(p_patch->>'headline', ''));
        IF length(v_headline) > 160 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'tagline: keep the tagline to 160 characters';
        END IF;
    END IF;
    IF p_patch ? 'visibility' THEN
        v_visibility := p_patch->>'visibility';
        IF v_visibility IS NULL OR v_visibility NOT IN ('public', 'unlisted', 'invite_only') THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'visibility: choose public, unlisted or invite only';
        END IF;
    END IF;

    IF p_kind = 'team' THEN
        UPDATE org.teams
           SET name = COALESCE(v_name, name), headline = COALESCE(v_headline, headline),
               visibility = COALESCE(v_visibility, visibility), updated_at = now()
         WHERE id = p_id;
    ELSE
        UPDATE org.business_profiles
           SET name = COALESCE(v_name, name), headline = COALESCE(v_headline, headline),
               visibility = COALESCE(v_visibility, visibility), updated_at = now()
         WHERE id = p_id;
    END IF;
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, p_kind || '.updated', CASE p_kind WHEN 'team' THEN 'org.teams' ELSE 'org.business_profiles' END, p_id,
            jsonb_build_object('fields', to_jsonb(ARRAY(SELECT jsonb_object_keys(p_patch)))));
    RETURN jsonb_build_object('id', p_id);
END;
$$;
-- #endregion

-- #region 12. Invitations — named people, plus the ask-to-join link (§12b)
-- A workspace invitation addresses one person (by handle) or one address (by email); the table's own
-- CHECK forbids an addressee-less row. The 2026-09-28 cut of share links and join requests is
-- REVERSED by Decision #318 on a stage invite link's terms: a link only lets its holder ASK
-- (§12b, org_join_requests), and an invite_members holder answers. org_invitations carries no client
-- policy at all — the token IS the accept capability — so every read and write below is a definer.
CREATE OR REPLACE FUNCTION org.fn_role_of_entity(p_kind text, p_entity uuid, p_role uuid)
RETURNS TABLE (id uuid, preset text, base_preset text, capabilities org.workspace_capability[], name text, archived boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT r.id, r.preset, r.base_preset, org.fn_role_capabilities('team', r.preset, r.capabilities), r.name, r.archived_at IS NOT NULL
      FROM org.team_roles r WHERE p_kind = 'team' AND r.team_id = p_entity AND r.id = p_role
    UNION ALL
    SELECT r.id, r.preset, r.base_preset, org.fn_role_capabilities('business', r.preset, r.capabilities), r.name, r.archived_at IS NOT NULL
      FROM org.business_roles r WHERE p_kind = 'business' AND r.business_id = p_entity AND r.id = p_role;
$$;

-- What holds a team's seats: its active members plus its pending, unexpired invitations. The ONE
-- count the seat cap is checked against (fn_assert_seat) and the console shows beside the cap
-- (get_workspace_detail's `seats`), so the two can never disagree about how full a team is.
CREATE OR REPLACE FUNCTION org.fn_team_seats_used(p_team uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT ((SELECT count(*) FROM org.team_members m WHERE m.team_id = p_team AND m.status = 'active')
          + (SELECT count(*) FROM org.org_invitations i
              WHERE i.team_id = p_team AND i.status = 'pending'
                AND (i.expires_at IS NULL OR i.expires_at > now())))::integer;
$$;

-- The seat cap. A team's is its plan's `team_seats` entitlement (NULL = unlimited); a business has
-- none. Pending invitations count, or an owner could over-invite and have acceptances refused.
CREATE OR REPLACE FUNCTION org.fn_assert_seat(p_kind text, p_entity uuid, p_extra integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_limit integer;
    v_used integer;
BEGIN
    IF p_kind <> 'team' THEN
        RETURN;
    END IF;
    v_limit := finance.fn_effective_limit('team', p_entity, 'team_seats'::finance.entitlement_key);
    IF v_limit IS NULL THEN
        RETURN;
    END IF;
    v_used := org.fn_team_seats_used(p_entity);
    IF v_used + p_extra > v_limit THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'plan: this team''s plan has ' || v_limit || ' seats, and they are all taken or offered';
    END IF;
END;
$$;

-- Does holding this business role make a member a MANAGER — the seat `business_managers` caps
-- (Decision #230 (b))? An admin-ranked role, or one whose capabilities hold `manage_projects`; never
-- the owner's, who is not counted.
CREATE OR REPLACE FUNCTION org.fn_business_role_is_manager(p_business uuid, p_role uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((
        SELECT r.base_preset <> 'owner'
               AND (r.base_preset = 'admin' OR 'manage_projects'::org.workspace_capability = ANY (r.capabilities))
          FROM org.fn_role_of_entity('business', p_business, p_role) r
    ), false);
$$;

-- Is this active business member counted as a manager now — their role, or a per-member grant of
-- `manage_projects`? The predicate finance.fn_footprint_usage('business_managers') counts by.
CREATE OR REPLACE FUNCTION org.fn_business_member_is_manager(p_business uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((
        SELECT m.role <> 'owner'
               AND (m.role = 'admin'
                    OR 'manage_projects'::org.workspace_capability
                       = ANY (org.fn_member_capabilities('business', p_business, p_user)))
          FROM org.business_members m
         WHERE m.business_id = p_business AND m.user_id = p_user AND m.status = 'active'
    ), false);
$$;

CREATE OR REPLACE FUNCTION org.invite_workspace_member(
    p_kind text,
    p_entity uuid,
    p_handle text,
    p_email text,
    p_role uuid,
    p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_handle text := NULLIF(lower(btrim(COALESCE(p_handle, ''))), '');
    v_email text := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
    v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
    v_role record;
    v_caller org.workspace_capability[];
    v_rank integer;
    v_target uuid;
    v_entity_name text;
    v_entity_status text;
    v_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_kind NOT IN ('team', 'business') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kind: choose a team or a business';
    END IF;
    SELECT x.name, x.status INTO v_entity_name, v_entity_status FROM (
        SELECT t.name, t.status FROM org.teams t WHERE p_kind = 'team' AND t.id = p_entity
        UNION ALL
        SELECT b.name, b.status FROM org.business_profiles b WHERE p_kind = 'business' AND b.id = p_entity
    ) x;
    IF v_entity_name IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workspace: not found';
    END IF;
    IF v_entity_status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'workspace: restore it before inviting anyone';
    END IF;
    v_caller := org.fn_member_capabilities(p_kind, p_entity, v_uid);
    IF NOT ('invite_members' = ANY (v_caller)) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invite: you cannot invite people to this ' || p_kind;
    END IF;
    IF (v_handle IS NULL) = (v_email IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'handle: invite by a handle or an email address';
    END IF;
    IF v_note IS NOT NULL AND length(v_note) > 400 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'note: keep the note to 400 characters';
    END IF;

    SELECT * INTO v_role FROM org.fn_role_of_entity(p_kind, p_entity, p_role);
    IF NOT FOUND OR v_role.archived THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'roleId: choose one of this ' || p_kind || '''s roles';
    END IF;
    IF v_role.base_preset = 'owner' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'roleId: ownership moves only by transfer';
    END IF;
    -- A member can never grant what they lack (members.ts `mayGrant`): offering a role is granting it.
    IF EXISTS (SELECT 1 FROM unnest(v_role.capabilities) c WHERE NOT (c = ANY (v_caller))) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'roleId: that role carries permissions you do not hold';
    END IF;
    -- Nor seat anybody at or above their own rank (IW-M4).
    SELECT s.rank INTO v_rank FROM org.fn_member_seat(p_kind, p_entity, v_uid) s;
    PERFORM org.fn_assert_role_below(v_rank, v_role.base_preset, 'roleId');

    IF v_handle IS NOT NULL THEN
        SELECT u.user_id INTO v_target FROM org.users_public u WHERE lower(u.username) = v_handle;
        IF v_target IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'handle: no one on Projective has that handle';
        END IF;
        IF v_target = v_uid THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'handle: you are already in this ' || p_kind;
        END IF;
        IF EXISTS (SELECT 1 FROM org.fn_member_seat(p_kind, p_entity, v_target)) THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'handle: they are already a member';
        END IF;
        -- A named invitee must be able to accept (Decision #228 (A)); an email one is asked at accept.
        IF p_kind = 'team' THEN
            PERFORM org.fn_assert_team_persona(v_target);
        END IF;
    ELSIF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 160 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'email: enter a valid email address';
    END IF;

    PERFORM org.fn_assert_seat(p_kind, p_entity, 1);
    -- Offering a manager's role takes one of the plan's manager seats (Decision #230 (b)).
    IF p_kind = 'business' AND org.fn_business_role_is_manager(p_entity, p_role) THEN
        PERFORM finance.fn_assert_business_entitlement(p_entity, 'business_managers'::finance.entitlement_key, 1);
    END IF;

    BEGIN
        INSERT INTO org.org_invitations (
            inviter_user_id, target_email, target_handle, target_user_id, team_id, business_id,
            team_role_id, business_role_id, token, note, status, expires_at
        ) VALUES (
            v_uid, v_email, v_handle, v_target,
            CASE p_kind WHEN 'team' THEN p_entity END, CASE p_kind WHEN 'business' THEN p_entity END,
            CASE p_kind WHEN 'team' THEN p_role END, CASE p_kind WHEN 'business' THEN p_role END,
            encode(extensions.gen_random_bytes(24), 'hex'), v_note, 'pending', now() + interval '14 days'
        ) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION USING ERRCODE = '23505',
            MESSAGE = CASE WHEN v_handle IS NOT NULL THEN 'handle' ELSE 'email' END || ': they already have a pending invitation';
    END;

    IF v_target IS NOT NULL THEN
        PERFORM comms.fn_notify(
            v_target, p_kind || '.invite',
            'Invitation to join ' || v_entity_name,
            COALESCE(v_note, 'You were invited to join ' || v_entity_name || ' as ' || v_role.name || '.'),
            'org_invitations', v_id, '{}'::jsonb, v_uid, p_kind, p_entity, NULL,
            CASE p_kind WHEN 'team' THEN '/teams' ELSE '/businesses' END
        );
    END IF;
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, p_kind || '.member_invited', 'org.org_invitations', v_id,
            jsonb_build_object('entity', p_entity, 'role', p_role, 'by_email', v_email IS NOT NULL));
    RETURN jsonb_build_object('id', v_id);
END;
$$;

-- The ONE way somebody becomes an active member: an accepted invitation and an approved join request
-- (§12b) both seat through here, so the two can never apply different guards. In order: an adult
-- (Decision #208), an entity that is not archived, a finished account, a team's freelancer persona
-- and payout readiness (Decision #228 (A) / #196), a live role, the seat cap and a business's manager
-- cap. `p_extra` is how many seats the admission ADDS: 0 when a pending invitation already holds one,
-- 1 for a join request, which holds none. `p_subject` words the refusals for the door that called.
-- A former member is reactivated, never inserted twice (UNIQUE (entity, user)). Internal only.
CREATE OR REPLACE FUNCTION org.fn_admit_workspace_member(
    p_kind text,
    p_entity uuid,
    p_user uuid,
    p_role uuid,
    p_by uuid,
    p_extra integer,
    p_subject text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status text;
    v_member uuid;
    v_self boolean := p_user = auth.uid();
BEGIN
    PERFORM org.fn_assert_adult(p_user);
    SELECT x.status INTO v_status FROM (
        SELECT t.status FROM org.teams t WHERE p_kind = 'team' AND t.id = p_entity
        UNION ALL
        SELECT b.status FROM org.business_profiles b WHERE p_kind = 'business' AND b.id = p_entity
    ) x;
    IF v_status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = p_subject || ': this ' || p_kind || ' has been archived';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = p_user) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = CASE WHEN v_self
            THEN 'auth: finish setting up your account first'
            ELSE p_subject || ': they have not finished setting up their account' END;
    END IF;
    IF p_kind = 'team' THEN
        PERFORM org.fn_assert_team_persona(p_user);
        PERFORM finance.fn_assert_payout_ready('freelancer', p_user);
    END IF;
    IF EXISTS (SELECT 1 FROM org.fn_role_of_entity(p_kind, p_entity, p_role) r WHERE r.archived) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = CASE p_subject
            WHEN 'invitation' THEN 'invitation: the role offered no longer exists — ask for a new invitation'
            ELSE 'roleId: that role no longer exists — choose another' END;
    END IF;
    PERFORM org.fn_assert_seat(p_kind, p_entity, p_extra);
    -- A manager's role takes one of the plan's manager seats (Decision #230 (b)); a pending invitation
    -- is already counted, so with p_extra 0 this refuses only a business already past its plan.
    IF p_kind = 'business' AND org.fn_business_role_is_manager(p_entity, p_role) THEN
        PERFORM finance.fn_assert_business_entitlement(p_entity, 'business_managers'::finance.entitlement_key, p_extra);
    END IF;

    IF p_kind = 'team' THEN
        INSERT INTO org.team_members (team_id, user_id, role_id, status, invited_by, joined_at)
        VALUES (p_entity, p_user, p_role, 'active', p_by, now())
        ON CONFLICT (team_id, user_id) DO UPDATE
            SET role_id = EXCLUDED.role_id, status = 'active', left_at = NULL,
                invited_by = EXCLUDED.invited_by, joined_at = now(),
                granted_capabilities = '{}', revoked_capabilities = '{}'
        RETURNING id INTO v_member;
        INSERT INTO finance.contribution_agreements (team_id, member_user_id, percent_bp, held)
        VALUES (p_entity, p_user, 0, false)
        ON CONFLICT (team_id, member_user_id) DO NOTHING;
    ELSE
        INSERT INTO org.business_members (business_id, user_id, role_id, status, invited_by, joined_at)
        VALUES (p_entity, p_user, p_role, 'active', p_by, now())
        ON CONFLICT (business_id, user_id) DO UPDATE
            SET role_id = EXCLUDED.role_id, status = 'active', left_at = NULL,
                invited_by = EXCLUDED.invited_by, joined_at = now(),
                granted_capabilities = '{}', revoked_capabilities = '{}'
        RETURNING id INTO v_member;
    END IF;
    PERFORM org.fn_sync_vault_permissions(p_kind, p_entity, p_user);
    PERFORM org.fn_refresh_membership_flags(p_user);
    RETURN v_member;
END;
$$;

-- Is the caller the addressee of this invitation? By identity, by handle, or by one of their
-- VERIFIED email addresses — never by an unverified one, or registering somebody else's address would
-- be a way to intercept their invitations.
CREATE OR REPLACE FUNCTION org.fn_is_invitee(p_invitation uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM org.org_invitations i
         WHERE i.id = p_invitation
           AND auth.uid() IS NOT NULL
           AND (
               i.target_user_id = auth.uid()
               OR (i.target_user_id IS NULL AND i.target_handle IS NOT NULL
                   AND EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = auth.uid() AND lower(u.username) = lower(i.target_handle)))
               OR (i.target_email IS NOT NULL
                   AND EXISTS (SELECT 1 FROM org.user_emails e
                                WHERE e.user_id = auth.uid() AND e.verified_at IS NOT NULL
                                  AND lower(e.email) = lower(i.target_email)))
           )
    );
$$;

CREATE OR REPLACE FUNCTION org.respond_to_workspace_invitation(p_invitation uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_inv org.org_invitations;
    v_kind text;
    v_entity uuid;
    v_role uuid;
    v_member uuid;
    v_status text;
    v_handle text;
    v_name text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    SELECT * INTO v_inv FROM org.org_invitations WHERE id = p_invitation FOR UPDATE;
    IF NOT FOUND OR NOT org.fn_is_invitee(p_invitation) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'invitation: not found';
    END IF;
    IF v_inv.status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invitation: this invitation has already been answered';
    END IF;
    IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at <= now() THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invitation: this invitation has expired — ask for a new one';
    END IF;
    v_kind := CASE WHEN v_inv.team_id IS NOT NULL THEN 'team' ELSE 'business' END;
    v_entity := COALESCE(v_inv.team_id, v_inv.business_id);
    v_role := COALESCE(v_inv.team_role_id, v_inv.business_role_id);

    IF NOT p_accept THEN
        UPDATE org.org_invitations SET status = 'declined', responded_at = now() WHERE id = p_invitation;
        RETURN jsonb_build_object('status', 'declined', 'kind', v_kind, 'id', v_entity);
    END IF;

    SELECT x.slug, x.status, x.name INTO v_handle, v_status, v_name FROM (
        SELECT t.slug, t.status, t.name FROM org.teams t WHERE t.id = v_inv.team_id
        UNION ALL
        SELECT b.slug, b.status, b.name FROM org.business_profiles b WHERE b.id = v_inv.business_id
    ) x;
    -- This invitation already holds one of the counted seats (and, for a manager's role, one of the
    -- counted manager seats), so the admission adds none.
    v_member := org.fn_admit_workspace_member(v_kind, v_entity, v_uid, v_role, v_inv.inviter_user_id, 0, 'invitation');

    UPDATE org.org_invitations SET status = 'accepted', responded_at = now() WHERE id = p_invitation;
    PERFORM comms.fn_notify(
        v_inv.inviter_user_id, v_kind || '.member_joined', 'Someone joined ' || v_name,
        (SELECT COALESCE(NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.username)
           FROM org.users_public u WHERE u.user_id = v_uid) || ' accepted your invitation.',
        'org_invitations', p_invitation, '{}'::jsonb, v_uid, v_kind, v_entity, NULL,
        CASE v_kind WHEN 'team' THEN '/teams/' ELSE '/businesses/' END || v_handle || '/members'
    );
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, v_kind || '.member_joined', 'org.org_invitations', p_invitation, jsonb_build_object('entity', v_entity));
    RETURN jsonb_build_object('status', 'accepted', 'kind', v_kind, 'id', v_entity, 'handle', v_handle, 'member_id', v_member);
END;
$$;

-- The inviting side's two queue actions. Both need `invite_members` on the entity the invitation
-- belongs to; neither ever admits anybody (acceptance is the invitee's act alone).
CREATE OR REPLACE FUNCTION org.revoke_workspace_invitation(p_invitation uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_inv org.org_invitations;
    v_kind text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    SELECT * INTO v_inv FROM org.org_invitations WHERE id = p_invitation FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'invitation: not found';
    END IF;
    v_kind := CASE WHEN v_inv.team_id IS NOT NULL THEN 'team' ELSE 'business' END;
    IF NOT org.fn_member_can(v_kind, COALESCE(v_inv.team_id, v_inv.business_id), 'invite_members') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'invitation: not found';
    END IF;
    IF v_inv.status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invitation: this invitation has already been answered';
    END IF;
    UPDATE org.org_invitations SET status = 'revoked', revoked_at = now(), revoked_by = auth.uid() WHERE id = p_invitation;
    RETURN jsonb_build_object('id', p_invitation, 'status', 'revoked');
END;
$$;

CREATE OR REPLACE FUNCTION org.resend_workspace_invitation(p_invitation uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_inv org.org_invitations;
    v_kind text;
    v_entity uuid;
    v_name text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    SELECT * INTO v_inv FROM org.org_invitations WHERE id = p_invitation FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'invitation: not found';
    END IF;
    v_kind := CASE WHEN v_inv.team_id IS NOT NULL THEN 'team' ELSE 'business' END;
    v_entity := COALESCE(v_inv.team_id, v_inv.business_id);
    IF NOT org.fn_member_can(v_kind, v_entity, 'invite_members') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'invitation: not found';
    END IF;
    IF v_inv.status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invitation: this invitation has already been answered';
    END IF;
    UPDATE org.org_invitations
       SET token = encode(extensions.gen_random_bytes(24), 'hex'), expires_at = now() + interval '14 days'
     WHERE id = p_invitation;
    IF v_inv.target_user_id IS NOT NULL THEN
        SELECT x.name INTO v_name FROM (
            SELECT t.name FROM org.teams t WHERE t.id = v_inv.team_id
            UNION ALL SELECT b.name FROM org.business_profiles b WHERE b.id = v_inv.business_id
        ) x;
        PERFORM comms.fn_notify(
            v_inv.target_user_id, v_kind || '.invite', 'Invitation to join ' || v_name,
            COALESCE(v_inv.note, 'A reminder: you were invited to join ' || v_name || '.'),
            'org_invitations', p_invitation, '{}'::jsonb, auth.uid(), v_kind, v_entity, NULL,
            CASE v_kind WHEN 'team' THEN '/teams' ELSE '/businesses' END
        );
    END IF;
    RETURN jsonb_build_object('id', p_invitation, 'status', 'pending');
END;
$$;
-- #endregion

-- #region 12b. Invite links & join requests (Decision #318)
-- A team's or business's ask-to-join link, on a stage invite link's terms (Decision #145): sharing,
-- resetting and turning it off are invite_members acts; redeeming files a pending org_join_requests
-- row and nothing more; an invite_members holder approves it — seating through
-- fn_admit_workspace_member, the same admission an accepted invitation runs — or declines it.
--
-- fn_org_invite_link_state is the ONE rule for what a link means to a given person, read by both the
-- landing page (resolve_workspace_invite_link) and the redeem door, so the page never offers a
-- request the redeem would refuse.

-- A fresh link token: `w-` + 18 random bytes as unpadded base64url (24 characters).
CREATE OR REPLACE FUNCTION org.fn_new_invite_link_token()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
    -- Schema-qualified: pgcrypto lives in `extensions`.
    SELECT 'w-' || translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
$$;

CREATE OR REPLACE FUNCTION org.fn_org_invite_link_state(p_link org.org_invite_links, p_actor uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_kind text := CASE WHEN p_link.team_id IS NOT NULL THEN 'team' ELSE 'business' END;
    v_entity uuid := COALESCE(p_link.team_id, p_link.business_id);
    v_status text;
BEGIN
    IF p_link.status <> 'active' THEN
        RETURN 'revoked';
    END IF;
    SELECT x.status INTO v_status FROM (
        SELECT t.status FROM org.teams t WHERE t.id = p_link.team_id
        UNION ALL
        SELECT b.status FROM org.business_profiles b WHERE b.id = p_link.business_id
    ) x;
    IF v_status IS NULL OR v_status = 'archived' THEN
        RETURN 'archived';
    END IF;
    -- A link whose role was retired does not work (archive_workspace_role refuses while a link is
    -- active, so this is a belt over that brace).
    IF EXISTS (SELECT 1 FROM org.fn_role_of_entity(v_kind, v_entity, COALESCE(p_link.team_role_id, p_link.business_role_id)) r
                WHERE r.archived) THEN
        RETURN 'revoked';
    END IF;
    IF EXISTS (SELECT 1 FROM org.fn_member_seat(v_kind, v_entity, p_actor)) THEN
        RETURN 'member';
    END IF;
    -- An open, unexpired invitation addressed to them — by identity, handle or a verified address.
    IF EXISTS (
        SELECT 1 FROM org.org_invitations i
         WHERE COALESCE(i.team_id, i.business_id) = v_entity
           AND i.status = 'pending'
           AND (i.expires_at IS NULL OR i.expires_at > now())
           AND (
               i.target_user_id = p_actor
               OR (i.target_user_id IS NULL AND i.target_handle IS NOT NULL
                   AND EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = p_actor AND lower(u.username) = lower(i.target_handle)))
               OR (i.target_email IS NOT NULL
                   AND EXISTS (SELECT 1 FROM org.user_emails e
                                WHERE e.user_id = p_actor AND e.verified_at IS NOT NULL
                                  AND lower(e.email) = lower(i.target_email)))
           )
    ) THEN
        RETURN 'invited';
    END IF;
    IF EXISTS (SELECT 1 FROM org.org_join_requests r
                WHERE COALESCE(r.team_id, r.business_id) = v_entity
                  AND r.requester_user_id = p_actor AND r.status = 'pending') THEN
        RETURN 'requested';
    END IF;
    -- A team takes freelancers only — fn_assert_team_persona's predicate, answered rather than raised.
    IF v_kind = 'team' AND NOT EXISTS (
        SELECT 1 FROM org.users_public u
         WHERE u.user_id = p_actor AND u.is_freelancer IS TRUE AND u.is_operator IS NOT TRUE
           AND EXISTS (SELECT 1 FROM org.freelancer_profiles fp WHERE fp.user_id = u.user_id)
    ) THEN
        RETURN 'persona';
    END IF;
    RETURN 'open';
END;
$$;

COMMENT ON FUNCTION org.fn_org_invite_link_state(org.org_invite_links, uuid) IS
'What a workspace invite link means to one person: revoked · archived · member · invited · requested · persona · open. Internal — read by resolve_workspace_invite_link and redeem_workspace_invite_link only.';

-- The link's shape as the console reads it.
CREATE OR REPLACE FUNCTION org.fn_invite_link_json(p_link org.org_invite_links)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object('id', p_link.id, 'token', p_link.token,
                              'role_id', COALESCE(p_link.team_role_id, p_link.business_role_id),
                              'created_at', p_link.created_at);
$$;

-- org.get_workspace_invite_link(kind, entity, role, rotate) -> jsonb
--
-- The entity's active link, minted on first use at `p_role` (default: the Member preset). With an
-- active link, `p_role` re-points it at another role ("Anyone with the link can ask to join as …");
-- `p_rotate` revokes it and mints a replacement in the same transaction ("Reset link"), keeping its
-- role unless `p_role` names another. The role is offered to whoever holds the URL, so it passes the
-- same test invite_workspace_member applies: never the owner seat, never a capability the caller
-- lacks.
CREATE OR REPLACE FUNCTION org.get_workspace_invite_link(
    p_kind text,
    p_entity uuid,
    p_role uuid DEFAULT NULL,
    p_rotate boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_status text;
    v_caller org.workspace_capability[];
    v_link org.org_invite_links;
    v_had boolean;
    v_role_id uuid;
    v_role record;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_kind NOT IN ('team', 'business') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kind: choose a team or a business';
    END IF;
    SELECT x.status INTO v_status FROM (
        SELECT t.status FROM org.teams t WHERE p_kind = 'team' AND t.id = p_entity
        UNION ALL
        SELECT b.status FROM org.business_profiles b WHERE p_kind = 'business' AND b.id = p_entity
    ) x;
    IF v_status IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workspace: not found';
    END IF;
    v_caller := org.fn_member_capabilities(p_kind, p_entity, v_uid);
    IF NOT ('invite_members' = ANY (v_caller)) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invite: you cannot share an invite link for this ' || p_kind;
    END IF;
    IF v_status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'workspace: restore it before sharing an invite link';
    END IF;

    SELECT * INTO v_link FROM org.org_invite_links l
     WHERE COALESCE(l.team_id, l.business_id) = p_entity AND l.status = 'active'
     FOR UPDATE;
    v_had := FOUND;

    -- Reading the link is all a keep-as-is open asks for.
    IF v_had AND NOT COALESCE(p_rotate, false)
       AND (p_role IS NULL OR p_role = COALESCE(v_link.team_role_id, v_link.business_role_id)) THEN
        RETURN org.fn_invite_link_json(v_link);
    END IF;

    v_role_id := COALESCE(p_role,
        CASE WHEN v_had THEN COALESCE(v_link.team_role_id, v_link.business_role_id) END,
        (SELECT x.id FROM (
            SELECT r.id FROM org.team_roles r WHERE p_kind = 'team' AND r.team_id = p_entity AND r.preset = 'member' AND r.archived_at IS NULL
            UNION ALL
            SELECT r.id FROM org.business_roles r WHERE p_kind = 'business' AND r.business_id = p_entity AND r.preset = 'member' AND r.archived_at IS NULL
        ) x LIMIT 1));
    SELECT * INTO v_role FROM org.fn_role_of_entity(p_kind, p_entity, v_role_id);
    IF NOT FOUND OR v_role.archived THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'roleId: choose one of this ' || p_kind || '''s roles';
    END IF;
    IF v_role.base_preset = 'owner' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'roleId: ownership moves only by transfer';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_role.capabilities) c WHERE NOT (c = ANY (v_caller))) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'roleId: that role carries permissions you do not hold';
    END IF;

    -- Re-pointing the live link: the URL stays the same.
    IF v_had AND NOT COALESCE(p_rotate, false) THEN
        UPDATE org.org_invite_links
           SET team_role_id = CASE p_kind WHEN 'team' THEN v_role_id END,
               business_role_id = CASE p_kind WHEN 'business' THEN v_role_id END
         WHERE id = v_link.id
        RETURNING * INTO v_link;
        INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
        VALUES (v_uid, p_kind || '.invite_link_role_changed', 'org.org_invite_links', v_link.id,
                jsonb_build_object('entity', p_entity, 'role', v_role_id));
        RETURN org.fn_invite_link_json(v_link);
    END IF;

    IF v_had THEN
        UPDATE org.org_invite_links SET status = 'revoked', revoked_at = now(), revoked_by = v_uid WHERE id = v_link.id;
        INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
        VALUES (v_uid, p_kind || '.invite_link_revoked', 'org.org_invite_links', v_link.id,
                jsonb_build_object('entity', p_entity, 'reset', true));
    END IF;

    BEGIN
        INSERT INTO org.org_invite_links (team_id, business_id, team_role_id, business_role_id, token, created_by)
        VALUES (
            CASE p_kind WHEN 'team' THEN p_entity END, CASE p_kind WHEN 'business' THEN p_entity END,
            CASE p_kind WHEN 'team' THEN v_role_id END, CASE p_kind WHEN 'business' THEN v_role_id END,
            org.fn_new_invite_link_token(), v_uid
        )
        RETURNING * INTO v_link;
    EXCEPTION WHEN unique_violation THEN
        -- A concurrent first open minted the link a moment earlier; that one is the answer.
        SELECT * INTO v_link FROM org.org_invite_links l
         WHERE COALESCE(l.team_id, l.business_id) = p_entity AND l.status = 'active';
        RETURN org.fn_invite_link_json(v_link);
    END;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, p_kind || '.invite_link_created', 'org.org_invite_links', v_link.id,
            jsonb_build_object('entity', p_entity, 'role', v_role_id));
    RETURN org.fn_invite_link_json(v_link);
END;
$$;

COMMENT ON FUNCTION org.get_workspace_invite_link(text, uuid, uuid, boolean) IS
'The entity''s active ask-to-join link, minted on first use at p_role (default the Member preset); p_role re-points a live link, p_rotate revokes it and mints a replacement in one transaction. invite_members only; the role must be grantable by the caller and never the owner''s. Refused on an archived entity. Records security.audit_logs (Decision #318).';

-- Turns the entity's link off. TRUE when a link was active; FALSE when there was nothing to revoke,
-- which is not an error — the caller asked for "no working link" and that is the state.
CREATE OR REPLACE FUNCTION org.revoke_workspace_invite_link(p_kind text, p_entity uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_link uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_kind NOT IN ('team', 'business') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kind: choose a team or a business';
    END IF;
    IF NOT org.fn_member_can(p_kind, p_entity, 'invite_members') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invite: you cannot turn off this ' || p_kind || '''s invite link';
    END IF;
    UPDATE org.org_invite_links l
       SET status = 'revoked', revoked_at = now(), revoked_by = v_uid
     WHERE COALESCE(l.team_id, l.business_id) = p_entity AND l.status = 'active'
    RETURNING l.id INTO v_link;
    IF v_link IS NULL THEN
        RETURN false;
    END IF;
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, p_kind || '.invite_link_revoked', 'org.org_invite_links', v_link,
            jsonb_build_object('entity', p_entity, 'reset', false));
    RETURN true;
END;
$$;

COMMENT ON FUNCTION org.revoke_workspace_invite_link(text, uuid) IS
'Turns off the entity''s active invite link. invite_members only. TRUE when a link was active. Records security.audit_logs (Decision #318).';

-- org.resolve_workspace_invite_link(token) -> jsonb
--
-- What the landing page shows the signed-in holder of a link: which entity, at which role, who
-- shared it, and what this person can do with it (fn_org_invite_link_state). An unknown token
-- answers {"state":"invalid"} and nothing else — a 144-bit token is not guessable.
CREATE OR REPLACE FUNCTION org.resolve_workspace_invite_link(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_link org.org_invite_links;
    v_kind text;
    v_entity uuid;
    v_e record;
    v_role_name text;
    v_name text;
    v_handle text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    SELECT * INTO v_link FROM org.org_invite_links WHERE token = p_token;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('state', 'invalid');
    END IF;
    v_kind := CASE WHEN v_link.team_id IS NOT NULL THEN 'team' ELSE 'business' END;
    v_entity := COALESCE(v_link.team_id, v_link.business_id);
    SELECT x.name, x.slug, x.avatar INTO v_e FROM (
        SELECT t.name, t.slug, t.avatar_file_id AS avatar FROM org.teams t WHERE t.id = v_link.team_id
        UNION ALL
        SELECT b.name, b.slug, b.logo_file_id FROM org.business_profiles b WHERE b.id = v_link.business_id
    ) x;
    SELECT r.name INTO v_role_name
      FROM org.fn_role_of_entity(v_kind, v_entity, COALESCE(v_link.team_role_id, v_link.business_role_id)) r;
    SELECT NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.username
      INTO v_name, v_handle
      FROM org.users_public u WHERE u.user_id = v_link.created_by;
    RETURN jsonb_build_object(
        'state', org.fn_org_invite_link_state(v_link, v_uid),
        'kind', v_kind,
        'workspaceName', v_e.name,
        'workspaceHandle', v_e.slug,
        'workspaceAvatarFileId', v_e.avatar,
        'roleName', v_role_name,
        'sharedByName', COALESCE(v_name, v_handle),
        'sharedByHandle', v_handle
    );
END;
$$;

COMMENT ON FUNCTION org.resolve_workspace_invite_link(text) IS
'The landing-page answer for a workspace invite link: the entity, the role offered, who shared it and the caller''s state (fn_org_invite_link_state). An unknown token answers {"state":"invalid"}. Signed-in callers only (Decision #318).';

-- org.redeem_workspace_invite_link(token, message) -> jsonb
--
-- The holder asks to join: a pending org_join_requests row at the link's role, and every active
-- member who may answer it (invite_members) told (`team.join_request` / `business.join_request`).
-- Every refusal is a state fn_org_invite_link_state already names, so the landing page and this door
-- cannot disagree. A team asks for payout readiness up front, as a stage link does: approving
-- somebody who could not be paid would only be refused at the admission.
CREATE OR REPLACE FUNCTION org.redeem_workspace_invite_link(p_token text, p_message text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_link org.org_invite_links;
    v_kind text;
    v_entity uuid;
    v_state text;
    v_message text := NULLIF(btrim(COALESCE(p_message, '')), '');
    v_request uuid;
    v_e record;
    v_name text;
    v_admins uuid[];
    v_admin uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF v_message IS NOT NULL AND char_length(v_message) > 400 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'message: keep the note to 400 characters';
    END IF;
    SELECT * INTO v_link FROM org.org_invite_links WHERE token = p_token;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'This invite link doesn''t work.';
    END IF;
    v_kind := CASE WHEN v_link.team_id IS NOT NULL THEN 'team' ELSE 'business' END;
    v_entity := COALESCE(v_link.team_id, v_link.business_id);

    -- One request per person per entity, even when the same link is pressed twice at once.
    PERFORM pg_advisory_xact_lock(hashtext('org-invite-link:' || v_entity::text || ':' || v_uid::text));

    v_state := org.fn_org_invite_link_state(v_link, v_uid);
    IF v_state <> 'open' THEN
        RAISE EXCEPTION '%', CASE v_state
            WHEN 'revoked' THEN 'This invite link has been turned off.'
            WHEN 'archived' THEN 'This ' || v_kind || ' has been archived — nobody can join it.'
            WHEN 'member' THEN 'You are already a member of this ' || v_kind || '.'
            WHEN 'invited' THEN 'You already have an invitation to this ' || v_kind || ' — answer it from your invitations.'
            WHEN 'requested' THEN 'You have already asked to join this ' || v_kind || '.'
            WHEN 'persona' THEN 'Teams are for freelancer accounts — set up your freelancer profile to ask to join.'
            ELSE 'This invite link can''t be used.'
        END
        USING ERRCODE = CASE WHEN v_state IN ('member', 'invited', 'requested')
                             THEN 'unique_violation' ELSE 'check_violation' END,
              DETAIL = 'state=' || v_state;
    END IF;
    PERFORM org.fn_assert_adult(v_uid);
    IF v_kind = 'team' THEN
        PERFORM finance.fn_assert_payout_ready('freelancer', v_uid);
    END IF;

    INSERT INTO org.org_join_requests (team_id, business_id, requester_user_id, invite_link_id,
                                       team_role_id, business_role_id, message)
    VALUES (v_link.team_id, v_link.business_id, v_uid, v_link.id,
            v_link.team_role_id, v_link.business_role_id, v_message)
    RETURNING id INTO v_request;

    SELECT x.name, x.slug INTO v_e FROM (
        SELECT t.name, t.slug FROM org.teams t WHERE t.id = v_link.team_id
        UNION ALL
        SELECT b.name, b.slug FROM org.business_profiles b WHERE b.id = v_link.business_id
    ) x;
    SELECT COALESCE(NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.username)
      INTO v_name FROM org.users_public u WHERE u.user_id = v_uid;
    SELECT array_agg(m.user_id) INTO v_admins FROM (
        SELECT x.user_id FROM org.team_members x WHERE v_kind = 'team' AND x.team_id = v_entity AND x.status = 'active'
        UNION
        SELECT x.user_id FROM org.business_members x WHERE v_kind = 'business' AND x.business_id = v_entity AND x.status = 'active'
    ) m
     WHERE 'invite_members' = ANY (org.fn_member_capabilities(v_kind, v_entity, m.user_id));
    -- One fn_notify per answerer (fn_notify_many carries no action URL), grouped per request.
    FOREACH v_admin IN ARRAY COALESCE(v_admins, '{}'::uuid[]) LOOP
        PERFORM comms.fn_notify(
            v_admin, v_kind || '.join_request',
            COALESCE(v_name, 'Someone') || ' asked to join ' || v_e.name,
            COALESCE(left(v_message, 140), 'Through your invite link.'),
            'org_join_requests', v_request, '{}'::jsonb, v_uid, v_kind, v_entity, 'join_request:' || v_request::text,
            CASE v_kind WHEN 'team' THEN '/teams/' ELSE '/businesses/' END || v_e.slug || '/members?view=pending'
        );
    END LOOP;
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, v_kind || '.join_requested', 'org.org_join_requests', v_request,
            jsonb_build_object('entity', v_entity, 'invite_link_id', v_link.id));
    RETURN jsonb_build_object('id', v_request, 'kind', v_kind, 'workspaceHandle', v_e.slug, 'status', 'pending');
END;
$$;

COMMENT ON FUNCTION org.redeem_workspace_invite_link(text, text) IS
'The holder of an active workspace invite link asks to join: a pending org_join_requests row at the link''s role, and <kind>.join_request to every invite_members holder. Refused with the fn_org_invite_link_state sentence (DETAIL state=…) for every state but open. Seats nobody (Decision #318).';

-- org.respond_to_join_request(request, accept, role) -> jsonb
--
-- The inviting side answers a request. Approving seats the requester at `p_role` (default: the role
-- they asked for) through fn_admit_workspace_member with ONE seat added — a request holds none — after
-- the role passes the invitation test for the approver. Declining only records the answer. Both
-- notify the requester.
CREATE OR REPLACE FUNCTION org.respond_to_join_request(p_request uuid, p_accept boolean, p_role uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_req org.org_join_requests;
    v_kind text;
    v_entity uuid;
    v_caller org.workspace_capability[];
    v_rank integer;
    v_role_id uuid;
    v_role record;
    v_member uuid;
    v_e record;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    SELECT * INTO v_req FROM org.org_join_requests WHERE id = p_request FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'request: not found';
    END IF;
    v_kind := CASE WHEN v_req.team_id IS NOT NULL THEN 'team' ELSE 'business' END;
    v_entity := COALESCE(v_req.team_id, v_req.business_id);
    v_caller := org.fn_member_capabilities(v_kind, v_entity, v_uid);
    IF NOT ('invite_members' = ANY (v_caller)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'request: not found';
    END IF;
    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'request: this request has already been answered';
    END IF;
    SELECT x.name, x.slug INTO v_e FROM (
        SELECT t.name, t.slug FROM org.teams t WHERE t.id = v_req.team_id
        UNION ALL
        SELECT b.name, b.slug FROM org.business_profiles b WHERE b.id = v_req.business_id
    ) x;

    IF NOT p_accept THEN
        UPDATE org.org_join_requests SET status = 'declined', responded_at = now(), responded_by = v_uid
         WHERE id = p_request;
        PERFORM comms.fn_notify(
            v_req.requester_user_id, v_kind || '.join_request_declined',
            'Your request to join ' || v_e.name,
            'Your request to join ' || v_e.name || ' was declined.',
            'org_join_requests', p_request, '{}'::jsonb, v_uid, v_kind, v_entity, NULL,
            CASE v_kind WHEN 'team' THEN '/teams' ELSE '/businesses' END
        );
        INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
        VALUES (v_uid, v_kind || '.join_request_declined', 'org.org_join_requests', p_request,
                jsonb_build_object('entity', v_entity));
        RETURN jsonb_build_object('id', p_request, 'status', 'declined', 'kind', v_kind, 'entity', v_entity);
    END IF;

    v_role_id := COALESCE(p_role, v_req.team_role_id, v_req.business_role_id);
    SELECT * INTO v_role FROM org.fn_role_of_entity(v_kind, v_entity, v_role_id);
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'roleId: choose one of this ' || v_kind || '''s roles';
    END IF;
    IF v_role.base_preset = 'owner' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'roleId: ownership moves only by transfer';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_role.capabilities) c WHERE NOT (c = ANY (v_caller))) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'roleId: that role carries permissions you do not hold';
    END IF;
    -- Approving is seating, so the invitation's rank rule holds too (IW-M4).
    SELECT s.rank INTO v_rank FROM org.fn_member_seat(v_kind, v_entity, v_uid) s;
    PERFORM org.fn_assert_role_below(v_rank, v_role.base_preset, 'roleId');
    -- A request holds no seat, so admitting it adds one (and a manager's role, one manager seat).
    v_member := org.fn_admit_workspace_member(v_kind, v_entity, v_req.requester_user_id, v_role_id, v_uid, 1, 'request');

    UPDATE org.org_join_requests SET status = 'accepted', responded_at = now(), responded_by = v_uid,
           team_role_id = CASE v_kind WHEN 'team' THEN v_role_id END,
           business_role_id = CASE v_kind WHEN 'business' THEN v_role_id END
     WHERE id = p_request;
    PERFORM comms.fn_notify(
        v_req.requester_user_id, v_kind || '.join_request_accepted',
        'Welcome to ' || v_e.name,
        'Your request to join ' || v_e.name || ' was approved — you joined as ' || v_role.name || '.',
        'org_join_requests', p_request, '{}'::jsonb, v_uid, v_kind, v_entity, NULL,
        CASE v_kind WHEN 'team' THEN '/teams/' ELSE '/businesses/' END || v_e.slug
    );
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, v_kind || '.member_joined', 'org.org_join_requests', p_request,
            jsonb_build_object('entity', v_entity, 'role', v_role_id, 'via', 'join_request'));
    RETURN jsonb_build_object('id', p_request, 'status', 'accepted', 'kind', v_kind, 'entity', v_entity, 'member_id', v_member);
END;
$$;

COMMENT ON FUNCTION org.respond_to_join_request(uuid, boolean, uuid) IS
'Approve (seat through fn_admit_workspace_member, one seat added) or decline a pending join request. invite_members only (anyone else reads not found); the approval role must be grantable by the caller and never the owner''s. Notifies the requester (Decision #318).';

-- The requester takes a pending request back.
CREATE OR REPLACE FUNCTION org.withdraw_join_request(p_request uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_req org.org_join_requests;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    SELECT * INTO v_req FROM org.org_join_requests WHERE id = p_request FOR UPDATE;
    IF NOT FOUND OR v_req.requester_user_id <> v_uid THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'request: not found';
    END IF;
    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'request: this request has already been answered';
    END IF;
    UPDATE org.org_join_requests SET status = 'withdrawn', responded_at = now(), responded_by = v_uid
     WHERE id = p_request;
    RETURN jsonb_build_object('id', p_request, 'status', 'withdrawn');
END;
$$;

COMMENT ON FUNCTION org.withdraw_join_request(uuid) IS
'The requester withdraws their own pending join request (status withdrawn). Anyone else reads not found (Decision #318).';
-- #endregion

-- #region 13. Changing a member — role, overrides, spend envelope, title, org chart, removal
-- Ports every guard of the fixture's updateMemberRow, in one transaction, and re-projects the vault:
--   · nobody changes their own authority (the transfer path exists for the owner);
--   · an actor manages only somebody they OUTRANK and only with `manage_roles` (mayManageMember);
--   · a role or a grant is given only by somebody who holds every capability in it (mayGrant);
--   · the owner is never demoted or removed here (ownership moves by transfer);
--   · leaving is a status, and a departing team member's stake is redistributed so the split still
--     totals 100% over the people who remain.
CREATE OR REPLACE FUNCTION org.fn_rebalance_departed_stake(p_team uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_freed integer;
    v_absorb integer;
    v_given integer := 0;
    v_owner uuid;
    r record;
    v_share integer;
    v_biggest uuid;
BEGIN
    SELECT ca.percent_bp INTO v_freed FROM finance.contribution_agreements ca
     WHERE ca.team_id = p_team AND ca.member_user_id = p_user FOR UPDATE;
    IF v_freed IS NULL OR v_freed = 0 THEN
        UPDATE finance.contribution_agreements SET held = false WHERE team_id = p_team AND member_user_id = p_user;
        RETURN;
    END IF;
    UPDATE finance.contribution_agreements SET percent_bp = 0, held = false WHERE team_id = p_team AND member_user_id = p_user;

    -- Absorbed by the remaining UNHELD active stakes in proportion to their size (policy.ts
    -- `rebalanceSplit`): a held stake is immovable. With no unheld stake left, the owner absorbs it.
    SELECT COALESCE(sum(ca.percent_bp), 0) INTO v_absorb
      FROM finance.contribution_agreements ca
      JOIN org.team_members m ON m.team_id = ca.team_id AND m.user_id = ca.member_user_id AND m.status = 'active'
     WHERE ca.team_id = p_team AND NOT ca.held AND ca.member_user_id <> p_user;
    SELECT t.owner_user_id INTO v_owner FROM org.teams t WHERE t.id = p_team;

    IF v_absorb = 0 THEN
        INSERT INTO finance.contribution_agreements (team_id, member_user_id, percent_bp, held)
        VALUES (p_team, v_owner, v_freed, false)
        ON CONFLICT (team_id, member_user_id) DO UPDATE
            SET percent_bp = finance.contribution_agreements.percent_bp + EXCLUDED.percent_bp;
        RETURN;
    END IF;

    FOR r IN
        SELECT ca.member_user_id, ca.percent_bp
          FROM finance.contribution_agreements ca
          JOIN org.team_members m ON m.team_id = ca.team_id AND m.user_id = ca.member_user_id AND m.status = 'active'
         WHERE ca.team_id = p_team AND NOT ca.held AND ca.member_user_id <> p_user
         ORDER BY ca.percent_bp DESC, ca.member_user_id
    LOOP
        v_biggest := COALESCE(v_biggest, r.member_user_id);
        v_share := (v_freed::bigint * r.percent_bp / v_absorb)::integer;
        v_given := v_given + v_share;
        UPDATE finance.contribution_agreements SET percent_bp = percent_bp + v_share
         WHERE team_id = p_team AND member_user_id = r.member_user_id;
    END LOOP;
    -- The rounding remainder lands on the largest absorber, so the total is exactly 10000 again.
    IF v_freed - v_given <> 0 THEN
        UPDATE finance.contribution_agreements SET percent_bp = percent_bp + (v_freed - v_given)
         WHERE team_id = p_team AND member_user_id = v_biggest;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION org.update_workspace_member(p_kind text, p_member uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_entity uuid;
    v_target_user uuid;
    v_target_status text;
    v_target_rank integer;
    v_owner uuid;
    v_actor_rank integer;
    v_actor org.workspace_capability[];
    v_role record;
    v_cap org.workspace_capability;
    v_caps org.workspace_capability[];
    v_kind_caps org.workspace_capability[];
    v_self boolean;
    v_title text;
    v_reports uuid;
    v_walk uuid;
    v_depth integer := 0;
    v_limit bigint;
    v_per_tx bigint;
    v_period text;
    v_was_manager boolean := false;
    v_before_caps org.workspace_capability[];
    v_seat_role text;
    v_seat_granted org.workspace_capability[];
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'patch: expected an object';
    END IF;
    IF p_kind = 'team' THEN
        SELECT m.team_id, m.user_id, m.status, org.fn_preset_rank(m.role) INTO v_entity, v_target_user, v_target_status, v_target_rank
          FROM org.team_members m WHERE m.id = p_member FOR UPDATE;
        SELECT t.owner_user_id INTO v_owner FROM org.teams t WHERE t.id = v_entity;
    ELSIF p_kind = 'business' THEN
        SELECT m.business_id, m.user_id, m.status, org.fn_preset_rank(m.role) INTO v_entity, v_target_user, v_target_status, v_target_rank
          FROM org.business_members m WHERE m.id = p_member FOR UPDATE;
        SELECT b.owner_user_id INTO v_owner FROM org.business_profiles b WHERE b.id = v_entity;
    ELSE
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kind: choose a team or a business';
    END IF;
    SELECT s.rank INTO v_actor_rank FROM org.fn_member_seat(p_kind, v_entity, v_uid) s;
    IF v_entity IS NULL OR v_actor_rank IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'member: not found';
    END IF;
    IF v_target_status <> 'active' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'member: they have already left';
    END IF;
    v_actor := org.fn_member_capabilities(p_kind, v_entity, v_uid);
    v_self := v_target_user = v_uid;
    v_kind_caps := org.fn_kind_capabilities(p_kind);
    IF p_kind = 'business' THEN
        v_was_manager := org.fn_business_member_is_manager(v_entity, v_target_user);
    END IF;

    -- #region removal (and leaving)
    IF COALESCE((p_patch->>'remove')::boolean, false) THEN
        IF v_target_user = v_owner THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'member: the owner can''t leave — transfer ownership first';
        END IF;
        IF NOT v_self AND NOT ('remove_members' = ANY (v_actor) AND 'manage_roles' = ANY (v_actor) AND v_actor_rank > v_target_rank) THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'member: you cannot remove this member';
        END IF;
        IF p_kind = 'team' THEN
            UPDATE org.team_members SET status = 'left', left_at = now(), granted_capabilities = '{}', revoked_capabilities = '{}', reports_to = NULL WHERE id = p_member;
            UPDATE org.team_members SET reports_to = NULL WHERE reports_to = p_member;
            PERFORM org.fn_rebalance_departed_stake(v_entity, v_target_user);
        ELSE
            UPDATE org.business_members SET status = 'left', left_at = now(), granted_capabilities = '{}', revoked_capabilities = '{}', reports_to = NULL WHERE id = p_member;
            UPDATE org.business_members SET reports_to = NULL WHERE reports_to = p_member;
        END IF;
        PERFORM org.fn_sync_vault_permissions(p_kind, v_entity, v_target_user);
        PERFORM org.fn_refresh_membership_flags(v_target_user);
        IF NOT v_self THEN
            PERFORM comms.fn_notify(
                v_target_user, p_kind || '.member_removed', 'You were removed from a ' || p_kind,
                'An admin removed you from this ' || p_kind || '.', NULL, NULL, '{}'::jsonb, v_uid, p_kind, v_entity
            );
        END IF;
        INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
        VALUES (v_uid, p_kind || CASE WHEN v_self THEN '.member_left' ELSE '.member_removed' END,
                'org.' || p_kind || '_members', p_member, jsonb_build_object('entity', v_entity));
        RETURN jsonb_build_object('id', p_member, 'status', 'left');
    END IF;
    -- #endregion

    -- #region giving up an owner-reserved grant (business, §7b) — the one change to one's own seat
    IF p_patch ? 'relinquish' THEN
        IF p_kind <> 'business' OR NOT v_self THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'relinquish: only the holder gives up their own grant';
        END IF;
        IF v_target_user = v_owner THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'relinquish: the owner''s rights move only by transfer';
        END IF;
        SELECT COALESCE(array_agg(DISTINCT x::org.workspace_capability), '{}') INTO v_caps
          FROM jsonb_array_elements_text(p_patch->'relinquish') x;
        IF EXISTS (SELECT 1 FROM unnest(v_caps) c WHERE NOT (c = ANY (org.fn_reserved_capabilities('business')))) THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'relinquish: only billing, withdrawal or archiving is given up this way';
        END IF;
        UPDATE org.business_members
           SET granted_capabilities = ARRAY(SELECT c FROM unnest(granted_capabilities) c WHERE NOT (c = ANY (v_caps)))
         WHERE id = p_member;
        PERFORM org.fn_sync_vault_permissions('business', v_entity, v_target_user);
        INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
        VALUES (v_uid, 'business.reserved_relinquished', 'org.business_members', p_member,
                jsonb_build_object('entity', v_entity, 'capabilities', to_jsonb(v_caps)));
        RETURN jsonb_build_object('id', p_member);
    END IF;
    -- #endregion

    -- Everything below changes somebody else's standing.
    IF v_self THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'member: you can''t change your own role or permissions';
    END IF;
    IF NOT ('manage_roles' = ANY (v_actor)) OR v_actor_rank <= v_target_rank THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'member: you cannot manage this member';
    END IF;
    IF v_target_user = v_owner THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'member: the owner''s standing only changes by transfer';
    END IF;
    v_before_caps := org.fn_member_capabilities(p_kind, v_entity, v_target_user);

    IF p_patch ? 'role_id' THEN
        SELECT * INTO v_role FROM org.fn_role_of_entity(p_kind, v_entity, (p_patch->>'role_id')::uuid);
        IF NOT FOUND OR v_role.archived THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'roleId: choose one of this ' || p_kind || '''s roles';
        END IF;
        IF v_role.base_preset = 'owner' THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'roleId: ownership moves only by transfer';
        END IF;
        IF EXISTS (SELECT 1 FROM unnest(v_role.capabilities) c WHERE NOT (c = ANY (v_actor))) THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'roleId: that role carries permissions you do not hold';
        END IF;
        -- The target already ranks below the actor (above); the role they move to must as well (IW-M4).
        PERFORM org.fn_assert_role_below(v_actor_rank, v_role.base_preset, 'roleId');
        IF p_kind = 'team' THEN
            UPDATE org.team_members SET role_id = v_role.id WHERE id = p_member;
        ELSE
            UPDATE org.business_members SET role_id = v_role.id WHERE id = p_member;
        END IF;
    END IF;

    IF p_patch ? 'granted' THEN
        SELECT COALESCE(array_agg(DISTINCT x::org.workspace_capability), '{}') INTO v_caps
          FROM jsonb_array_elements_text(p_patch->'granted') x;
        FOREACH v_cap IN ARRAY v_caps LOOP
            IF NOT (v_cap = ANY (v_kind_caps)) THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'granted: ' || v_cap || ' does not apply to a ' || p_kind;
            END IF;
            IF NOT (v_cap = ANY (v_actor)) THEN
                RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'granted: you cannot grant a permission you do not hold';
            END IF;
        END LOOP;
        IF p_kind = 'team' THEN
            UPDATE org.team_members SET granted_capabilities = v_caps WHERE id = p_member;
        ELSE
            UPDATE org.business_members SET granted_capabilities = v_caps WHERE id = p_member;
        END IF;
    END IF;

    IF p_patch ? 'revoked' THEN
        SELECT COALESCE(array_agg(DISTINCT x::org.workspace_capability), '{}') INTO v_caps
          FROM jsonb_array_elements_text(p_patch->'revoked') x;
        FOREACH v_cap IN ARRAY v_caps LOOP
            IF NOT (v_cap = ANY (v_kind_caps)) THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'revoked: ' || v_cap || ' does not apply to a ' || p_kind;
            END IF;
        END LOOP;
        IF p_kind = 'team' THEN
            UPDATE org.team_members SET revoked_capabilities = v_caps WHERE id = p_member;
        ELSE
            UPDATE org.business_members SET revoked_capabilities = v_caps WHERE id = p_member;
        END IF;
    END IF;

    -- The spend envelope (business): can the member spend at all, and how much.
    IF p_kind = 'business' AND (p_patch ? 'can_spend' OR p_patch ? 'spend_limit_minor' OR p_patch ? 'per_transaction_minor') THEN
        IF NOT ('manage_finances' = ANY (v_actor)) THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'spend: you cannot change spend limits';
        END IF;
        IF p_patch ? 'can_spend' THEN
            IF (p_patch->>'can_spend')::boolean AND NOT ('spend_funds' = ANY (v_actor)) THEN
                RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'canSpend: you cannot grant a permission you do not hold';
            END IF;
            PERFORM org.fn_set_member_capability('business', p_member, 'spend_funds', (p_patch->>'can_spend')::boolean);
        END IF;
        IF p_patch ? 'spend_limit_minor' OR p_patch ? 'per_transaction_minor' THEN
            v_limit := NULLIF(p_patch->>'spend_limit_minor', '')::bigint;
            v_per_tx := NULLIF(p_patch->>'per_transaction_minor', '')::bigint;
            v_period := COALESCE(NULLIF(p_patch->>'period', ''), 'monthly');
            IF (v_limit IS NOT NULL AND v_limit < 0) OR (v_per_tx IS NOT NULL AND v_per_tx < 0) THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'spendLimitMinor: a limit cannot be negative';
            END IF;
            IF v_period NOT IN ('weekly', 'monthly', 'total') THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'period: choose weekly, monthly or total';
            END IF;
            -- Setting a ceiling is Business Pro's (`pooled_wallet_full`, Decision #230 (e)); clearing one
            -- never is, so a downgraded business can always lift its caps.
            IF v_limit IS NOT NULL OR v_per_tx IS NOT NULL THEN
                PERFORM finance.fn_assert_business_entitlement(v_entity, 'pooled_wallet_full'::finance.entitlement_key);
            END IF;
            INSERT INTO finance.spending_limits (wallet_id, member_user_id, cap_cents, per_transaction_cents, period_interval)
            SELECT w.id, v_target_user, v_limit, v_per_tx, v_period
              FROM finance.wallets w WHERE w.owner_type = 'business' AND w.owner_id = v_entity
            ON CONFLICT (wallet_id, member_user_id) DO UPDATE
                SET cap_cents = CASE WHEN p_patch ? 'spend_limit_minor' THEN EXCLUDED.cap_cents ELSE finance.spending_limits.cap_cents END,
                    per_transaction_cents = CASE WHEN p_patch ? 'per_transaction_minor' THEN EXCLUDED.per_transaction_cents ELSE finance.spending_limits.per_transaction_cents END,
                    period_interval = EXCLUDED.period_interval;
        END IF;
    END IF;

    IF p_patch ? 'title' THEN
        v_title := NULLIF(btrim(COALESCE(p_patch->>'title', '')), '');
        IF v_title IS NOT NULL AND length(v_title) > 80 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'title: keep the title to 80 characters';
        END IF;
        IF p_kind = 'team' THEN
            UPDATE org.team_members SET title = v_title WHERE id = p_member;
        ELSE
            UPDATE org.business_members SET title = v_title WHERE id = p_member;
        END IF;
    END IF;

    IF p_patch ? 'reports_to' THEN
        v_reports := NULLIF(p_patch->>'reports_to', '')::uuid;
        IF v_reports = p_member THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reportsTo: nobody reports to themselves';
        END IF;
        IF v_reports IS NOT NULL THEN
            -- Walk up from the new manager: reaching this member would close a loop.
            v_walk := v_reports;
            WHILE v_walk IS NOT NULL AND v_depth < 64 LOOP
                IF v_walk = p_member THEN
                    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reportsTo: that would make a reporting loop';
                END IF;
                v_depth := v_depth + 1;
                IF p_kind = 'team' THEN
                    SELECT m.reports_to INTO v_walk FROM org.team_members m
                     WHERE m.id = v_walk AND m.team_id = v_entity AND m.status = 'active';
                    IF NOT FOUND AND v_depth = 1 THEN
                        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reportsTo: choose an active member';
                    END IF;
                ELSE
                    SELECT m.reports_to INTO v_walk FROM org.business_members m
                     WHERE m.id = v_walk AND m.business_id = v_entity AND m.status = 'active';
                    IF NOT FOUND AND v_depth = 1 THEN
                        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reportsTo: choose an active member';
                    END IF;
                END IF;
            END LOOP;
        END IF;
        IF p_kind = 'team' THEN
            UPDATE org.team_members SET reports_to = v_reports WHERE id = p_member;
        ELSE
            UPDATE org.business_members SET reports_to = v_reports WHERE id = p_member;
        END IF;
    END IF;

    -- A role change or a `manage_projects` grant that makes this member a manager takes one of the
    -- plan's manager seats (Decision #230 (b)); they are counted now, so nothing extra is added. A
    -- change that leaves a manager a manager is never refused, even past a downgraded ceiling.
    IF p_kind = 'business' AND NOT v_was_manager AND org.fn_business_member_is_manager(v_entity, v_target_user) THEN
        PERFORM finance.fn_assert_business_entitlement(v_entity, 'business_managers'::finance.entitlement_key, 0);
    END IF;

    -- Owner-reserved rights (§7b): the billing right lives only on an admin seat, so a member moved
    -- off one loses it with the move — unless this very patch grants it, which is refused. Then the
    -- whole patch's effect on the reserved set answers the owner-only, typed-confirm check.
    IF p_kind = 'business' THEN
        SELECT m.role, m.granted_capabilities INTO v_seat_role, v_seat_granted
          FROM org.business_members m WHERE m.id = p_member;
        IF v_seat_role <> 'admin' AND 'manage_billing' = ANY (v_seat_granted) THEN
            IF p_patch ? 'granted' AND p_patch->'granted' ? 'manage_billing' THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'granted: the billing right goes only to an admin';
            END IF;
            UPDATE org.business_members
               SET granted_capabilities = array_remove(granted_capabilities, 'manage_billing')
             WHERE id = p_member;
        END IF;
        PERFORM org.fn_assert_reserved_change('business', v_entity, v_before_caps,
            org.fn_member_capabilities('business', v_entity, v_target_user), p_patch->>'confirm');
    END IF;

    PERFORM org.fn_sync_vault_permissions(p_kind, v_entity, v_target_user);
    IF p_kind = 'business' THEN
        PERFORM comms.fn_notify(
            v_target_user, 'business.permission_changed', 'Your permissions changed',
            'An admin changed what you can do on this business.', NULL, NULL, '{}'::jsonb, v_uid, p_kind, v_entity
        );
    END IF;
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, p_kind || '.member_updated', 'org.' || p_kind || '_members', p_member,
            jsonb_build_object('entity', v_entity, 'fields', to_jsonb(ARRAY(SELECT jsonb_object_keys(p_patch)))));
    RETURN jsonb_build_object('id', p_member);
END;
$$;
-- #endregion

-- #region 14. Ownership transfer — one act
-- Exactly one owner (product decision 2026-09-28). The owner hands the owner seat to an active
-- member; they keep an admin seat, or leave in the same transaction. owner_user_id moves FIRST so the
-- row-level single-owner check (fn_member_role_sync) sees the new owner when the seats are rewritten.
CREATE OR REPLACE FUNCTION org.transfer_workspace_ownership(p_kind text, p_entity uuid, p_successor uuid, p_leave boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_owner uuid;
    v_successor_user uuid;
    v_successor_status text;
    v_owner_role uuid;
    v_admin_role uuid;
    v_self_member uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_kind = 'team' THEN
        SELECT t.owner_user_id INTO v_owner FROM org.teams t WHERE t.id = p_entity FOR UPDATE;
        SELECT m.user_id, m.status INTO v_successor_user, v_successor_status FROM org.team_members m WHERE m.id = p_successor AND m.team_id = p_entity;
        SELECT r.id INTO v_owner_role FROM org.team_roles r WHERE r.team_id = p_entity AND r.preset = 'owner';
        SELECT r.id INTO v_admin_role FROM org.team_roles r WHERE r.team_id = p_entity AND r.preset = 'admin';
        SELECT m.id INTO v_self_member FROM org.team_members m WHERE m.team_id = p_entity AND m.user_id = v_uid;
    ELSIF p_kind = 'business' THEN
        SELECT b.owner_user_id INTO v_owner FROM org.business_profiles b WHERE b.id = p_entity FOR UPDATE;
        SELECT m.user_id, m.status INTO v_successor_user, v_successor_status FROM org.business_members m WHERE m.id = p_successor AND m.business_id = p_entity;
        SELECT r.id INTO v_owner_role FROM org.business_roles r WHERE r.business_id = p_entity AND r.preset = 'owner';
        SELECT r.id INTO v_admin_role FROM org.business_roles r WHERE r.business_id = p_entity AND r.preset = 'admin';
        SELECT m.id INTO v_self_member FROM org.business_members m WHERE m.business_id = p_entity AND m.user_id = v_uid;
    ELSE
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kind: choose a team or a business';
    END IF;
    IF v_owner IS NULL OR v_owner <> v_uid THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'owner: only the owner can transfer ownership';
    END IF;
    IF v_successor_user IS NULL OR v_successor_status <> 'active' OR v_successor_user = v_uid THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'successor: choose another active member';
    END IF;
    -- A team's withdrawer and its verification follow the owner (§16), so its successor must be a
    -- freelancer account (Decision #228 (A)) who can be paid (Decision #196). Persona first, so the
    -- refusal names the real reason.
    IF p_kind = 'team' THEN
        PERFORM org.fn_assert_team_persona(v_successor_user);
        PERFORM finance.fn_assert_payout_ready('freelancer', v_successor_user);
    END IF;

    -- Order matters: the one-active-owner index is not deferrable, so the outgoing owner is demoted
    -- (or leaves, as an admin) BEFORE the successor takes the owner seat.
    IF p_kind = 'team' THEN
        UPDATE org.teams SET owner_user_id = v_successor_user, updated_at = now() WHERE id = p_entity;
        IF p_leave THEN
            UPDATE org.team_members
               SET role_id = v_admin_role, status = 'left', left_at = now(), reports_to = NULL,
                   granted_capabilities = '{}', revoked_capabilities = '{}'
             WHERE id = v_self_member;
            UPDATE org.team_members SET reports_to = NULL WHERE reports_to = v_self_member;
        ELSE
            UPDATE org.team_members SET role_id = v_admin_role WHERE id = v_self_member;
        END IF;
        UPDATE org.team_members SET role_id = v_owner_role, granted_capabilities = '{}', revoked_capabilities = '{}' WHERE id = p_successor;
        IF p_leave THEN
            PERFORM org.fn_rebalance_departed_stake(p_entity, v_uid);
        END IF;
    ELSE
        UPDATE org.business_profiles SET owner_user_id = v_successor_user, updated_at = now() WHERE id = p_entity;
        IF p_leave THEN
            UPDATE org.business_members
               SET role_id = v_admin_role, status = 'left', left_at = now(), reports_to = NULL,
                   granted_capabilities = '{}', revoked_capabilities = '{}'
             WHERE id = v_self_member;
            UPDATE org.business_members SET reports_to = NULL WHERE reports_to = v_self_member;
        ELSE
            UPDATE org.business_members SET role_id = v_admin_role WHERE id = v_self_member;
        END IF;
        UPDATE org.business_members SET role_id = v_owner_role, granted_capabilities = '{}', revoked_capabilities = '{}' WHERE id = p_successor;
        -- The owner-reserved grants were the outgoing owner's to give (§7b, Decision #230 (d.1)): they
        -- end with the transfer, and the new owner grants afresh whoever they choose.
        UPDATE org.business_members
           SET granted_capabilities = ARRAY(
                   SELECT c FROM unnest(granted_capabilities) c
                    WHERE NOT (c = ANY (org.fn_reserved_capabilities('business'))))
         WHERE business_id = p_entity AND status = 'active'
           AND granted_capabilities && org.fn_reserved_capabilities('business');
        PERFORM org.fn_sync_vault_permissions('business', p_entity);
    END IF;

    PERFORM org.fn_sync_vault_permissions(p_kind, p_entity, v_successor_user);
    PERFORM org.fn_sync_vault_permissions(p_kind, p_entity, v_uid);
    PERFORM org.fn_refresh_membership_flags(v_uid);
    PERFORM comms.fn_notify(
        v_successor_user, p_kind || '.ownership_transferred', 'You now own this ' || p_kind,
        'Ownership was transferred to you.', NULL, NULL, '{}'::jsonb, v_uid, p_kind, p_entity
    );
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, p_kind || '.ownership_transferred', CASE p_kind WHEN 'team' THEN 'org.teams' ELSE 'org.business_profiles' END, p_entity,
            jsonb_build_object('to', v_successor_user, 'left', p_leave));
    RETURN jsonb_build_object('id', p_entity, 'owner_user_id', v_successor_user);
END;
$$;
-- #endregion

-- #region 15. Custom roles
CREATE OR REPLACE FUNCTION org.upsert_workspace_role(
    p_kind text,
    p_entity uuid,
    p_role uuid,
    p_name text,
    p_summary text,
    p_capabilities org.workspace_capability[],
    p_base_preset text DEFAULT 'member'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_actor org.workspace_capability[];
    v_actor_rank integer;
    v_name text := btrim(COALESCE(p_name, ''));
    v_summary text := btrim(COALESCE(p_summary, ''));
    v_caps org.workspace_capability[];
    v_existing record;
    v_id uuid;
    v_managers_before integer;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_kind NOT IN ('team', 'business') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kind: choose a team or a business';
    END IF;
    v_actor := org.fn_member_capabilities(p_kind, p_entity, v_uid);
    SELECT s.rank INTO v_actor_rank FROM org.fn_member_seat(p_kind, p_entity, v_uid) s;
    IF NOT ('manage_roles' = ANY (v_actor)) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'role: you cannot manage roles here';
    END IF;
    IF length(v_name) < 1 OR length(v_name) > 48 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'name: give the role a name up to 48 characters';
    END IF;
    IF length(v_summary) > 160 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'summary: keep the summary to 160 characters';
    END IF;
    IF p_base_preset IS NULL OR p_base_preset NOT IN ('admin', 'lead', 'member')
       OR (p_kind = 'business' AND p_base_preset = 'lead') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'basePreset: choose which role this one ranks as';
    END IF;
    -- What the role WILL rank as must sit below the author (IW-H4); an edit is also held to what it
    -- ranks as NOW, below.
    PERFORM org.fn_assert_role_below(v_actor_rank, p_base_preset, 'basePreset');
    v_caps := org.fn_role_capabilities(p_kind, NULL, COALESCE(p_capabilities, '{}'));
    IF EXISTS (SELECT 1 FROM unnest(v_caps) c WHERE NOT (c = ANY (v_actor))) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'capabilities: you cannot grant a permission you do not hold';
    END IF;
    -- A business's owner-reserved rights are granted to a named member, never carried by a role (§7b).
    IF v_caps && org.fn_reserved_capabilities(p_kind) THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'capabilities: billing, withdrawal and archiving are the owner''s to grant to a named admin, never a role''s';
    END IF;

    BEGIN
        IF p_role IS NULL THEN
            IF p_kind = 'team' THEN
                INSERT INTO org.team_roles (team_id, name, summary, preset, base_preset, capabilities)
                VALUES (p_entity, v_name, v_summary, NULL, p_base_preset, v_caps) RETURNING id INTO v_id;
            ELSE
                INSERT INTO org.business_roles (business_id, name, summary, preset, base_preset, capabilities)
                VALUES (p_entity, v_name, v_summary, NULL, p_base_preset, v_caps) RETURNING id INTO v_id;
            END IF;
        ELSE
            SELECT * INTO v_existing FROM org.fn_role_of_entity(p_kind, p_entity, p_role);
            IF NOT FOUND OR v_existing.archived THEN
                RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'role: not found';
            END IF;
            IF v_existing.preset IS NOT NULL THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'role: presets are read-only — duplicate it to a custom role';
            END IF;
            -- The role as it stands, and so everyone who holds it, must rank below the editor: an
            -- admin may not demote the admin-ranked role a peer holds (IW-H4), nor edit their own.
            PERFORM org.fn_assert_role_below(v_actor_rank, v_existing.base_preset, 'role');
            IF p_kind = 'team' THEN
                UPDATE org.team_roles SET name = v_name, summary = v_summary, base_preset = p_base_preset, capabilities = v_caps, updated_at = now() WHERE id = p_role;
                UPDATE org.team_members SET role_id = role_id WHERE role_id = p_role;
            ELSE
                v_managers_before := finance.fn_footprint_usage('business', p_entity, 'business_managers'::finance.entitlement_key);
                UPDATE org.business_roles SET name = v_name, summary = v_summary, base_preset = p_base_preset, capabilities = v_caps, updated_at = now() WHERE id = p_role;
                UPDATE org.business_members SET role_id = role_id WHERE role_id = p_role;
                -- An edit that makes the role's holders (or its pending invitees) managers takes plan
                -- seats (Decision #230 (b)): refused only when it ADDS managers past the ceiling.
                IF finance.fn_footprint_usage('business', p_entity, 'business_managers'::finance.entitlement_key) > v_managers_before THEN
                    PERFORM finance.fn_assert_business_entitlement(p_entity, 'business_managers'::finance.entitlement_key, 0);
                END IF;
            END IF;
            v_id := p_role;
            -- Everyone holding the role is re-projected: a role edit flows to its holders.
            PERFORM org.fn_sync_vault_permissions(p_kind, p_entity, NULL);
        END IF;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'name: a role with that name already exists';
    END;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, p_kind || CASE WHEN p_role IS NULL THEN '.role_created' ELSE '.role_updated' END,
            'org.' || p_kind || '_roles', v_id, jsonb_build_object('entity', p_entity));
    RETURN jsonb_build_object('id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION org.archive_workspace_role(p_kind text, p_entity uuid, p_role uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role record;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF NOT org.fn_member_can(p_kind, p_entity, 'manage_roles') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'role: you cannot manage roles here';
    END IF;
    SELECT * INTO v_role FROM org.fn_role_of_entity(p_kind, p_entity, p_role);
    IF NOT FOUND OR v_role.archived THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'role: not found';
    END IF;
    IF v_role.preset IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'role: presets cannot be removed';
    END IF;
    IF EXISTS (SELECT 1 FROM org.team_members m WHERE m.role_id = p_role AND m.status = 'active')
       OR EXISTS (SELECT 1 FROM org.business_members m WHERE m.role_id = p_role AND m.status = 'active') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'role: move its members to another role first';
    END IF;
    IF EXISTS (SELECT 1 FROM org.org_invitations i
                WHERE (i.team_role_id = p_role OR i.business_role_id = p_role) AND i.status = 'pending') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'role: a pending invitation offers this role — revoke it first';
    END IF;
    -- The invite link offers it to whoever holds the URL (Decision #318); a pending join request that
    -- asked for it is NOT a blocker — the approval picks a live role, or refuses an archived one.
    IF EXISTS (SELECT 1 FROM org.org_invite_links l
                WHERE (l.team_role_id = p_role OR l.business_role_id = p_role) AND l.status = 'active') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'role: the invite link offers this role — change the link''s role or turn it off first';
    END IF;
    IF p_kind = 'team' THEN
        UPDATE org.team_roles SET archived_at = now(), updated_at = now() WHERE id = p_role;
    ELSE
        UPDATE org.business_roles SET archived_at = now(), updated_at = now() WHERE id = p_role;
    END IF;
    RETURN jsonb_build_object('id', p_role, 'archived', true);
END;
$$;
-- #endregion

-- #region 16. Reads — the roster and the console, as raw facts
-- Definers, because a member cannot read their own business row (org.business_profiles has no
-- policy, deliberately: RLS is row-level and every member would then read the tax id and the
-- address), cannot read a teammate's workload, and an invitee cannot read the entity inviting them.
-- They return RAW facts (ids, file refs, codes, instants); the fat service maps them onto
-- @projective/types/workspace once, resolving faces (org.get_party_cards) and media
-- (files.get_public_media) in batches.

-- Verification: a business's KYB; a team's is its OWNER's identity verification (product decision
-- 2026-09-28 — the owner is the person accountable for the team).
CREATE OR REPLACE FUNCTION org.fn_workspace_verification(p_kind text, p_entity uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_kind = 'business' THEN (
            SELECT CASE b.kyb_status::text WHEN 'verified' THEN 'verified' WHEN 'pending' THEN 'pending' ELSE 'unverified' END
              FROM org.business_profiles b WHERE b.id = p_entity)
        ELSE (
            SELECT COALESCE(CASE fp.kyc_status::text WHEN 'verified' THEN 'verified' WHEN 'pending' THEN 'pending' END, 'unverified')
              FROM org.teams t LEFT JOIN org.freelancer_profiles fp ON fp.user_id = t.owner_user_id
             WHERE t.id = p_entity)
    END;
$$;

CREATE OR REPLACE FUNCTION org.get_workspace_roster(p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_items jsonb;
    v_invites jsonb;
    v_key finance.entitlement_key;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_kind NOT IN ('team', 'business') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kind: choose a team or a business';
    END IF;

    WITH mine AS (
        SELECT t.id, t.name, t.slug, t.avatar_file_id AS avatar, t.headline, t.status, t.owner_user_id, t.created_at, t.updated_at, m.role
          FROM org.team_members m JOIN org.teams t ON t.id = m.team_id
         WHERE p_kind = 'team' AND m.user_id = v_uid AND m.status = 'active'
        UNION ALL
        SELECT b.id, b.name, b.slug, b.logo_file_id, b.headline, b.status, b.owner_user_id, b.created_at, b.updated_at, m.role
          FROM org.business_members m JOIN org.business_profiles b ON b.id = m.business_id
         WHERE p_kind = 'business' AND m.user_id = v_uid AND m.status = 'active'
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', e.id,
        'name', e.name,
        'handle', e.slug,
        'avatar_file_id', e.avatar,
        'headline', COALESCE(e.headline, ''),
        'status', e.status,
        'role', e.role,
        'is_owner', e.owner_user_id = v_uid,
        'created_at', e.created_at,
        'updated_at', e.updated_at,
        'verification', org.fn_workspace_verification(p_kind, e.id),
        'member_count', (SELECT count(*) FROM (
            SELECT 1 FROM org.team_members x WHERE p_kind = 'team' AND x.team_id = e.id AND x.status = 'active'
            UNION ALL SELECT 1 FROM org.business_members x WHERE p_kind = 'business' AND x.business_id = e.id AND x.status = 'active') c),
        'face_user_ids', (SELECT COALESCE(jsonb_agg(f.user_id ORDER BY f.rk DESC, f.joined_at), '[]'::jsonb) FROM (
            SELECT x.user_id, x.rk, x.joined_at FROM (
                SELECT m2.user_id, m2.joined_at, org.fn_preset_rank(m2.role) AS rk FROM org.team_members m2
                 WHERE p_kind = 'team' AND m2.team_id = e.id AND m2.status = 'active'
                UNION ALL
                SELECT m2.user_id, m2.joined_at, org.fn_preset_rank(m2.role) FROM org.business_members m2
                 WHERE p_kind = 'business' AND m2.business_id = e.id AND m2.status = 'active') x
            ORDER BY x.rk DESC, x.joined_at LIMIT 5) f),
        'pending_invites', (SELECT count(*) FROM org.org_invitations i
            WHERE COALESCE(i.team_id, i.business_id) = e.id AND i.status = 'pending'
              AND (i.expires_at IS NULL OR i.expires_at > now())),
        'active_projects', CASE p_kind
            WHEN 'team' THEN (SELECT count(DISTINCT ps.project_id) FROM projects.stage_assignments sa
                JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
                JOIN projects.projects pr ON pr.id = ps.project_id
               WHERE sa.team_id = e.id AND sa.status NOT IN ('declined', 'cancelled', 'released', 'completed')
                 AND pr.status IN ('active', 'on_hold'))
            ELSE (SELECT count(*) FROM projects.projects pr
               WHERE pr.client_business_id = e.id AND pr.status IN ('active', 'on_hold')) END,
        'money_30d', CASE p_kind
            WHEN 'team' THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', s.currency, 'minor', s.total)), '[]'::jsonb) FROM (
                SELECT x.currency, sum(x.amount) AS total FROM (
                    SELECT ps2.currency, ps2.amount_cents AS amount FROM finance.payout_splits ps2
                      JOIN finance.escrows es ON es.id = ps2.escrow_id
                     WHERE es.payee_type = 'team' AND es.payee_id = e.id AND ps2.created_at > now() - interval '30 days'
                    UNION ALL
                    SELECT tx.currency, tx.amount_cents FROM finance.transactions tx
                      JOIN finance.wallets w ON w.id = tx.wallet_id
                     WHERE w.owner_type = 'team' AND w.owner_id = e.id AND tx.direction = 'credit'
                       AND tx.reason LIKE '%vault_retention' AND tx.created_at > now() - interval '30 days') x
                 GROUP BY x.currency) s)
            -- A business's spend is the Finance figure (get_workspace_detail's `money_tiles`
            -- spent_30d_minor), so it is answered under that read's own predicate, `v_sees_money`:
            -- only to a viewer holding contribute_funds · spend_funds · manage_finances. Anybody else
            -- gets NULL (withheld), which is not `[]` (nothing moved) — the roster drops the figure.
            ELSE CASE WHEN org.fn_member_capabilities('business', e.id, v_uid)
                    && ARRAY['contribute_funds', 'spend_funds', 'manage_finances']::org.workspace_capability[]
                THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', s.currency, 'minor', s.total)), '[]'::jsonb) FROM (
                    SELECT tx.currency, sum(tx.amount_cents) AS total FROM finance.transactions tx
                      JOIN finance.wallets w ON w.id = tx.wallet_id
                     WHERE w.owner_type = 'business' AND w.owner_id = e.id AND tx.direction = 'debit'
                       AND tx.reason <> 'transfer_out' AND tx.created_at > now() - interval '30 days'
                     GROUP BY tx.currency) s) END END,
        -- The Draft-First facts, the same as the console's (org.get_workspace_detail): a business's
        -- `funded` (money was ever added to its pooled wallet) and `limits_offered` (its plan lets it
        -- set a threshold or member limits — Business Pro's `pooled_wallet_full`, or the gates off).
        'setup', jsonb_build_object(
            'logo', e.avatar IS NOT NULL,
            'bio', COALESCE(e.headline, '') <> '',
            'money', CASE p_kind
                WHEN 'team' THEN (SELECT count(*) FROM finance.contribution_agreements ca
                    JOIN org.team_members m3 ON m3.team_id = ca.team_id AND m3.user_id = ca.member_user_id AND m3.status = 'active'
                   WHERE ca.team_id = e.id AND ca.percent_bp > 0) > 1
                ELSE EXISTS (SELECT 1 FROM finance.wallets w WHERE w.owner_type = 'business' AND w.owner_id = e.id
                              AND COALESCE(w.approval_threshold_cents, 0) > 0) END,
            'funded', p_kind = 'business' AND EXISTS (SELECT 1 FROM finance.ledger_audit la
                JOIN finance.wallets w ON w.id = la.wallet_id
               WHERE w.owner_type = 'business' AND w.owner_id = e.id AND la.action = 'add_funds'),
            'limits_offered', p_kind = 'business' AND NOT (finance.fn_business_plan_gates_enforced()
                AND NOT finance.fn_business_gate_flag(e.id, 'pooled_wallet_full'::finance.entitlement_key))),
        'has_update', EXISTS (SELECT 1 FROM comms.notifications n
            WHERE n.user_id = v_uid AND n.context_type = p_kind AND n.context_id = e.id
              AND n.seen_at IS NULL AND n.archived_at IS NULL)
    ) ORDER BY (e.owner_user_id = v_uid) DESC, e.name), '[]'::jsonb)
    INTO v_items
    FROM mine e;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', i.id,
        'entity_id', COALESCE(i.team_id, i.business_id),
        'entity_name', x.name,
        'entity_handle', x.slug,
        'entity_avatar_file_id', x.avatar,
        'from_user_id', i.inviter_user_id,
        'role_name', x.role_name,
        'note', i.note,
        'created_at', i.created_at,
        'expires_at', i.expires_at
    ) ORDER BY i.created_at DESC), '[]'::jsonb)
    INTO v_invites
    FROM org.org_invitations i
    JOIN LATERAL (
        SELECT t.name, t.slug, t.avatar_file_id AS avatar, r.name AS role_name, t.status
          FROM org.teams t JOIN org.team_roles r ON r.id = i.team_role_id WHERE t.id = i.team_id
        UNION ALL
        SELECT b.name, b.slug, b.logo_file_id, r.name, b.status
          FROM org.business_profiles b JOIN org.business_roles r ON r.id = i.business_role_id WHERE b.id = i.business_id
    ) x ON true
    WHERE i.status = 'pending'
      AND (i.expires_at IS NULL OR i.expires_at > now())
      AND x.status <> 'archived'
      AND ((p_kind = 'team' AND i.team_id IS NOT NULL) OR (p_kind = 'business' AND i.business_id IS NOT NULL))
      AND org.fn_is_invitee(i.id);

    v_key := CASE p_kind WHEN 'team' THEN 'teams_owned' ELSE 'businesses_owned' END::finance.entitlement_key;
    RETURN jsonb_build_object(
        'items', v_items,
        'invitations', v_invites,
        'create_limit', finance.fn_effective_limit('user', v_uid, v_key),
        'create_used', finance.fn_footprint_usage('user', v_uid, v_key)
    );
END;
$$;

-- The console for one entity, addressed by its handle (the console URL) or by its id (a write knows
-- only the id, and a business row is not readable under RLS to look its handle up). `{status:
-- 'not_found'}` for a reference no entity of that kind holds; `{status:'forbidden'}` for one the caller
-- is not an active member of — the entity's public profile already discloses that it exists, the
-- console discloses nothing else.
--
-- It is the console's ONE read (Decision #233): besides the roster, roles and activity it answers
--   * each member's live W_i (`wi`) and cap (`wi_cap`), summed exactly as projects.check_ticket_capacity
--     sums them, and a team member's split stake (`share_bp`, `share_held`);
--   * each role's `pending_invites` — how many pending invitations offer it, counted exactly as
--     org.archive_workspace_role's refusal counts them — for a `manage_roles` holder only (NULL for
--     anybody else), so the Roles screen says that refusal before the press even to a role manager who
--     cannot read the outgoing queue (`invites` is `invite_members`' alone);
--   * each project's counterparty face (a team's client; a business's providers) from org.profiles_index;
--   * for a team: `payout` — the active split rule, the vault wallet and finance.preview_team_split —
--     ONLY for a caller holding `manage_finances`; `engagements` — the team's live stage assignments with
--     each assignee's W_i on the stage (slugs only, Decision #88); and `allowance` —
--     finance.get_proposal_allowance's answer for the team;
--   * for a business (BB9), every flag and figure decided here so no screen recomputes policy:
--     `spend` — for a viewer who may open Spend (spend_funds · manage_finances · approve_spend): the
--     policy wallet's threshold and the platform default, the approvers and contributors, the members'
--     envelopes (finance.fn_business_envelopes — their own unless they read the wallet's), what each
--     member contributed, the attributable ledger, and the spend requests they may read (their own
--     unless finance.fn_reads_wallet_envelopes) as `approvals {pending, decided (last 30)}`, each with
--     its `ref` (what it is for and whether the viewer may open it — finance.fn_spend_ref) and
--     `consumed`; plus, for the editor (BU2), `editable_member_ids` (whose limits and grants the viewer
--     may change), `approver_gap` (nobody besides the owner approves) and `limits_plan_gated`; and,
--     for the Members table (BU7), `reads_all_envelopes` — whether `limits` is everyone's or only the
--     viewer's own, fn_business_envelopes' own rule;
--     `managers` — to every member (BU7): `used`, the managers finance.fn_footprint_usage counts for
--     `business_managers` (invitations included), and `limit`, the ceiling the plan gate refuses past
--     (finance.fn_business_gate_limit; NULL while the gates are off or the plan is unlimited);
--     `money_tiles` — for a viewer who may open Finance (contribute_funds · spend_funds ·
--     manage_finances): per wallet currency, available · pending · committed · awaiting approval ·
--     spent in 30 days; `viewer_can` — what the viewer may do, as the write doors decide it; and `kyb` —
--     the KYB status, the Connect account's presence and what is still due;
--   * `setup` — the Draft-First facts the Overview's setup hero is decided on (the same as the
--     roster's): mark, one-liner, invite, money (a team's split, a business's threshold) and, for a
--     business (BU6), `funded` (any `add_funds` ledger row on its wallets) and `limits_offered` (its
--     plan lets it set a threshold or member limits — NOT `limits_plan_gated`);
--   * for either kind, the lifecycle Settings renders before anybody presses anything:
--     `archive_blockers` — what would refuse an archive now (org.fn_team_archive_blockers /
--     org.fn_business_archive_blockers), for an `archive_entity` holder only — and `restore_target` —
--     where a restore would land (org.fn_workspace_restore_target), while the entity is archived;
--   * `channels` — the live entity channels (comms.fn_entity_channel_list, Decision #306).
-- VOLATILE because the allowance read opens the week and pays out the lazy drip.
CREATE OR REPLACE FUNCTION org.get_workspace_detail(p_kind text, p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_e record;
    v_caps org.workspace_capability[];
    v_member uuid;
    v_rank integer;
    v_member_role_id uuid;
    v_cap_default numeric;
    v_blockers jsonb := '[]'::jsonb;
    -- Business only (BB9).
    v_currency text;
    v_wallet uuid;
    v_active boolean := false;
    v_verified boolean := false;
    v_spender boolean := false;
    v_sees_spend boolean := false;
    v_sees_money boolean := false;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_kind = 'team' THEN
        SELECT t.id, t.name, t.slug, t.avatar_file_id AS avatar, t.banner_file_id AS banner, t.headline,
               t.status, t.owner_user_id, t.created_at, t.treasury_wallet_id, t.visibility,
               NULL::text AS currency, NULL::finance.kyc_status AS kyb_status, NULL::timestamptz AS kyb_verified_at
          INTO v_e FROM org.teams t
         WHERE lower(t.slug) = lower(btrim(COALESCE(p_handle, '')))
            OR t.id = CASE WHEN p_handle ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p_handle::uuid END;
    ELSIF p_kind = 'business' THEN
        SELECT b.id, b.name, b.slug, b.logo_file_id AS avatar, b.banner_file_id AS banner, b.headline,
               b.status, b.owner_user_id, b.created_at, NULL::uuid AS treasury_wallet_id, b.visibility,
               b.default_currency AS currency, b.kyb_status, b.kyb_verified_at
          INTO v_e FROM org.business_profiles b
         WHERE lower(b.slug) = lower(btrim(COALESCE(p_handle, '')))
            OR b.id = CASE WHEN p_handle ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p_handle::uuid END;
    ELSE
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kind: choose a team or a business';
    END IF;
    IF v_e.id IS NULL THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    SELECT s.member_id, s.rank INTO v_member, v_rank FROM org.fn_member_seat(p_kind, v_e.id, v_uid) s;
    IF v_member IS NULL THEN
        RETURN jsonb_build_object('status', 'forbidden', 'id', v_e.id);
    END IF;
    v_caps := org.fn_member_capabilities(p_kind, v_e.id, v_uid);
    SELECT x.role_id INTO v_member_role_id FROM (
        SELECT m.role_id FROM org.team_members m WHERE m.id = v_member
        UNION ALL SELECT m.role_id FROM org.business_members m WHERE m.id = v_member) x;
    SELECT (p.value #>> '{}')::numeric INTO v_cap_default FROM security.platform_params p WHERE p.key = 'global_workload_cap_default';
    v_cap_default := COALESCE(v_cap_default, 10.00);
    IF p_kind = 'business' THEN
        -- The policy wallet is the one in the business's default currency (save_spend_policy's default).
        v_currency := upper(COALESCE(v_e.currency, 'USD'));
        SELECT w.id INTO v_wallet FROM finance.wallets w
         WHERE w.owner_type = 'business' AND w.owner_id = v_e.id AND upper(w.currency) = v_currency;
        v_active := v_e.status = 'active';
        v_verified := finance.fn_business_kyb_verified(v_e.id);
        -- Vault `spend` is what request_spend_approval and place_wallet_order check; before the wallet
        -- exists, the workspace right it will be projected from.
        v_spender := CASE WHEN v_wallet IS NOT NULL
            THEN finance.fn_has_vault_capability(v_wallet, v_uid, 'spend'::finance.vault_capability)
            ELSE 'spend_funds' = ANY (v_caps) END;
        v_sees_spend := v_caps && ARRAY['spend_funds', 'manage_finances', 'approve_spend']::org.workspace_capability[];
        v_sees_money := v_caps && ARRAY['contribute_funds', 'spend_funds', 'manage_finances']::org.workspace_capability[];
    END IF;
    -- The archive door's own blocker list, for the people it would refuse (Settings lists them first).
    IF 'archive_entity' = ANY (v_caps) THEN
        v_blockers := CASE p_kind
            WHEN 'team' THEN org.fn_team_archive_blockers(v_e.id)
            ELSE org.fn_business_archive_blockers(v_e.id) END;
    END IF;

    RETURN jsonb_build_object(
        'status', 'ok',
        'id', v_e.id,
        'name', v_e.name,
        'handle', v_e.slug,
        'avatar_file_id', v_e.avatar,
        'banner_file_id', v_e.banner,
        'headline', COALESCE(v_e.headline, ''),
        'entity_status', v_e.status,
        'visibility', v_e.visibility,
        'owner_user_id', v_e.owner_user_id,
        'created_at', v_e.created_at,
        'verification', org.fn_workspace_verification(p_kind, v_e.id),
        'viewer', jsonb_build_object('member_id', v_member, 'role_id', v_member_role_id, 'capabilities', to_jsonb(v_caps)),
        'members', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', m.id,
                'user_id', m.user_id,
                'role_id', m.role_id,
                'role', m.role,
                'status', m.status,
                'granted', to_jsonb(m.granted),
                'revoked', to_jsonb(m.revoked),
                'joined_at', m.joined_at,
                'title', m.title,
                'reports_to', m.reports_to,
                'is_self', m.user_id = v_uid,
                'email', CASE WHEN m.user_id = v_uid THEN (
                    SELECT e.email FROM org.user_emails e WHERE e.user_id = v_uid ORDER BY e.is_primary DESC NULLS LAST LIMIT 1) END,
                'wi', (SELECT COALESCE(sum(t.workload_intensity), 0) FROM projects.tickets t
                        WHERE t.current_assignee_id = m.user_id
                          AND t.status::text IN ('claimed', 'in_progress', 'in_review')),
                'wi_cap', COALESCE(fp.max_workload_intensity, v_cap_default),
                'availability', fp.availability_status,
                -- Payout stakes are for the people who run payouts (Decision #233), as the `payout`
                -- block is: everybody else reads none, not merely a hidden column.
                'share_bp', CASE WHEN 'manage_finances' = ANY (v_caps) THEN ca.percent_bp END,
                'share_held', CASE WHEN 'manage_finances' = ANY (v_caps) THEN ca.held END
            ) ORDER BY org.fn_preset_rank(m.role) DESC, m.joined_at), '[]'::jsonb)
            FROM (
                SELECT x.id, x.user_id, x.role_id, x.role, x.status, x.granted_capabilities AS granted,
                       x.revoked_capabilities AS revoked, x.joined_at, x.title, x.reports_to
                  FROM org.team_members x WHERE p_kind = 'team' AND x.team_id = v_e.id AND x.status = 'active'
                UNION ALL
                SELECT x.id, x.user_id, x.role_id, x.role, x.status, x.granted_capabilities, x.revoked_capabilities,
                       x.joined_at, x.title, x.reports_to
                  FROM org.business_members x WHERE p_kind = 'business' AND x.business_id = v_e.id AND x.status = 'active'
            ) m
            LEFT JOIN org.freelancer_profiles fp ON fp.user_id = m.user_id
            LEFT JOIN finance.contribution_agreements ca
                   ON p_kind = 'team' AND ca.team_id = v_e.id AND ca.member_user_id = m.user_id),
        'roles', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', r.id,
                'name', r.name,
                'summary', r.summary,
                'preset', r.preset,
                'base_preset', r.base_preset,
                'capabilities', to_jsonb(org.fn_role_capabilities(p_kind, r.preset, r.capabilities)),
                'member_count', (SELECT count(*) FROM (
                    SELECT 1 FROM org.team_members x WHERE x.role_id = r.id AND x.status = 'active'
                    UNION ALL SELECT 1 FROM org.business_members x WHERE x.role_id = r.id AND x.status = 'active') c),
                -- org.archive_workspace_role's second refusal, counted as it counts: a count, never the
                -- invitees, and only for the people who may archive a role.
                'pending_invites', CASE WHEN 'manage_roles' = ANY (v_caps) THEN (
                    SELECT count(*) FROM org.org_invitations i
                     WHERE (i.team_role_id = r.id OR i.business_role_id = r.id) AND i.status = 'pending') END
            ) ORDER BY r.preset IS NULL, org.fn_preset_rank(r.base_preset) DESC, r.name), '[]'::jsonb)
            FROM (
                SELECT x.id, x.name, x.summary, x.preset, x.base_preset, x.capabilities
                  FROM org.team_roles x WHERE p_kind = 'team' AND x.team_id = v_e.id AND x.archived_at IS NULL
                UNION ALL
                SELECT x.id, x.name, x.summary, x.preset, x.base_preset, x.capabilities
                  FROM org.business_roles x WHERE p_kind = 'business' AND x.business_id = v_e.id AND x.archived_at IS NULL
            ) r),
        -- The outgoing queue is for the people who run invitations; everybody else sees none.
        'invites', CASE WHEN 'invite_members' = ANY (v_caps) THEN (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', i.id,
                'target_user_id', i.target_user_id,
                'target_handle', i.target_handle,
                'target_email', i.target_email,
                'role_id', COALESCE(i.team_role_id, i.business_role_id),
                'note', i.note,
                'created_at', i.created_at,
                'expires_at', i.expires_at
            ) ORDER BY i.created_at DESC), '[]'::jsonb)
            FROM org.org_invitations i
            WHERE COALESCE(i.team_id, i.business_id) = v_e.id AND i.status = 'pending') ELSE '[]'::jsonb END,
        -- The ask-to-join link and the requests it filed (Decision #318), for the same people as the
        -- queue: the link is a capability, so nobody else reads its token.
        'invite_link', CASE WHEN 'invite_members' = ANY (v_caps) THEN (
            SELECT org.fn_invite_link_json(l) FROM org.org_invite_links l
             WHERE COALESCE(l.team_id, l.business_id) = v_e.id AND l.status = 'active') END,
        'join_requests', CASE WHEN 'invite_members' = ANY (v_caps) THEN (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', r.id,
                'requester_user_id', r.requester_user_id,
                'role_id', COALESCE(r.team_role_id, r.business_role_id),
                'message', r.message,
                'via_link', r.invite_link_id IS NOT NULL,
                'created_at', r.created_at
            ) ORDER BY r.created_at), '[]'::jsonb)
            FROM org.org_join_requests r
            WHERE COALESCE(r.team_id, r.business_id) = v_e.id AND r.status = 'pending') ELSE '[]'::jsonb END,
        -- A team's seats as fn_assert_seat counts them, beside its plan's cap (NULL = unlimited). A
        -- business is not seat-capped, so it answers none.
        'seats', CASE WHEN p_kind = 'team' THEN jsonb_build_object(
            'used', org.fn_team_seats_used(v_e.id),
            'limit', finance.fn_effective_limit('team', v_e.id, 'team_seats'::finance.entitlement_key)
        ) END,
        -- A business's managers (Decision #230 (b), BU7) as finance.fn_assert_business_entitlement counts
        -- them — admins and members whose role or grants manage projects, plus the pending, unexpired
        -- invitations that offer such a seat — beside the ceiling it refuses past. `limit` is NULL while
        -- the plan gates are off or the plan is unlimited (nothing would refuse). Answered to every
        -- member, as a team's seats are; a team answers none.
        'managers', CASE WHEN p_kind = 'business' THEN jsonb_build_object(
            'used', finance.fn_footprint_usage('business', v_e.id, 'business_managers'::finance.entitlement_key),
            'limit', CASE WHEN finance.fn_business_plan_gates_enforced()
                THEN finance.fn_business_gate_limit(v_e.id, 'business_managers'::finance.entitlement_key) END
        ) END,
        'standing', (SELECT l.label FROM org.entity_standing s JOIN org.standing_levels l ON l.level = s.level
                      WHERE p_kind = 'team' AND s.subject_type = 'team' AND s.subject_id = v_e.id),
        'projects', CASE p_kind
            WHEN 'team' THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'slug', p.slug, 'title', p.title, 'status', p.status,
                    'client_business_id', p.client_business_id, 'owner_user_id', p.owner_user_id,
                    'stage_name', p.stage_name, 'stage_status', p.stage_status, 'due', p.due,
                    'stages_total', p.stages_total, 'stages_done', p.stages_done,
                    'client', (SELECT jsonb_build_object('name', pi.name, 'avatar_bucket', pi.avatar_bucket,
                                                         'avatar_path', pi.avatar_path)
                                 FROM org.profiles_index pi WHERE pi.entity_id = p.client_business_id)
                ) ORDER BY p.status = 'completed', p.updated_at DESC), '[]'::jsonb)
                FROM (
                    SELECT DISTINCT ON (pr.id) pr.id, pr.slug, pr.title, pr.status, pr.client_business_id, pr.owner_user_id,
                           pr.updated_at, ps.name AS stage_name, ps.status::text AS stage_status,
                           COALESCE(ps.file_due_date::timestamptz, ps.session_end_date::timestamptz) AS due,
                           (SELECT count(*) FROM projects.project_stages s2 WHERE s2.project_id = pr.id) AS stages_total,
                           (SELECT count(*) FROM projects.project_stages s2 WHERE s2.project_id = pr.id AND s2.status IN ('approved', 'paid')) AS stages_done
                      FROM projects.stage_assignments sa
                      JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
                      JOIN projects.projects pr ON pr.id = ps.project_id
                     WHERE sa.team_id = v_e.id AND sa.status NOT IN ('declined', 'cancelled')
                     ORDER BY pr.id, sa.created_at DESC
                ) p)
            ELSE (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'slug', pr.slug, 'title', pr.title, 'status', pr.status,
                    'client_business_id', pr.client_business_id, 'owner_user_id', pr.owner_user_id,
                    'stage_name', NULL, 'stage_status', NULL, 'due', NULL,
                    'stages_total', (SELECT count(*) FROM projects.project_stages s2 WHERE s2.project_id = pr.id),
                    'stages_done', (SELECT count(*) FROM projects.project_stages s2 WHERE s2.project_id = pr.id AND s2.status IN ('approved', 'paid')),
                    -- Who is delivering it: the teams by face, the individual freelancers by user id
                    -- (the service resolves people in its one party-card batch).
                    'provider_user_ids', (SELECT COALESCE(jsonb_agg(DISTINCT sa.freelancer_profile_id), '[]'::jsonb)
                        FROM projects.stage_assignments sa JOIN projects.project_stages s2 ON s2.id = sa.project_stage_id
                       WHERE s2.project_id = pr.id AND sa.team_id IS NULL AND sa.freelancer_profile_id IS NOT NULL
                         AND sa.status NOT IN ('declined', 'cancelled', 'released')),
                    'provider_teams', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', pi.name,
                            'avatar_bucket', pi.avatar_bucket, 'avatar_path', pi.avatar_path) ORDER BY pi.name), '[]'::jsonb)
                        FROM org.profiles_index pi
                       WHERE pi.entity_id IN (
                           SELECT sa.team_id FROM projects.stage_assignments sa
                             JOIN projects.project_stages s2 ON s2.id = sa.project_stage_id
                            WHERE s2.project_id = pr.id AND sa.team_id IS NOT NULL
                              AND sa.status NOT IN ('declined', 'cancelled', 'released')))
                ) ORDER BY pr.status = 'completed', pr.updated_at DESC), '[]'::jsonb)
                FROM projects.projects pr
                WHERE pr.client_business_id = v_e.id AND pr.status NOT IN ('draft', 'archived')) END,
        -- A team's live stage assignments (not declined, cancelled, released or completed, on an active or
        -- on-hold project), one row per stage, with every active member holding claimed / in-progress /
        -- in-review tickets on it and their W_i there. Slugs address everything; the only ids are the
        -- assignees' user ids, which the service turns into faces and never forwards.
        'engagements', CASE WHEN p_kind = 'team' THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'project_slug', g.project_slug, 'title', g.title,
                    'stage_slug', g.stage_slug, 'stage_title', g.stage_title,
                    'assignment_status', g.assignment_status, 'project_status', g.project_status,
                    'stage_cap', g.stage_cap,
                    'stage_wi', COALESCE(w.stage_wi, 0),
                    'assignees', COALESCE(w.assignees, '[]'::jsonb)
                ) ORDER BY g.updated_at DESC, g.project_slug, g.sort_order), '[]'::jsonb)
                FROM (
                    SELECT DISTINCT ON (ps.id) ps.id AS stage_id, pr.slug AS project_slug, pr.title,
                           ps.slug AS stage_slug, ps.name AS stage_title, sa.status AS assignment_status,
                           pr.status::text AS project_status, ps.max_concurrent_intensity AS stage_cap,
                           pr.updated_at, ps.sort_order
                      FROM projects.stage_assignments sa
                      JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
                      JOIN projects.projects pr ON pr.id = ps.project_id
                     WHERE sa.team_id = v_e.id
                       AND sa.status NOT IN ('declined', 'cancelled', 'released', 'completed')
                       AND pr.status::text IN ('active', 'on_hold')
                     ORDER BY ps.id, sa.created_at DESC
                ) g
                LEFT JOIN LATERAL (
                    SELECT jsonb_agg(jsonb_build_object('user_id', a.user_id, 'stage_wi', a.stage_wi)
                               ORDER BY a.stage_wi DESC, a.user_id) AS assignees,
                           sum(a.stage_wi) AS stage_wi
                      FROM (
                          SELECT t.current_assignee_id AS user_id, sum(t.workload_intensity) AS stage_wi
                            FROM projects.tickets t
                            JOIN org.team_members tm ON tm.team_id = v_e.id AND tm.user_id = t.current_assignee_id
                                                    AND tm.status = 'active'
                           WHERE t.current_stage_id = g.stage_id
                             AND t.status::text IN ('claimed', 'in_progress', 'in_review')
                           GROUP BY t.current_assignee_id
                      ) a
                ) w ON true)
            ELSE '[]'::jsonb END,
        -- The split rule, the vault wallet (the treasury wallet, else the fullest) and the projected release
        -- — the Payouts module's facts, for the people who run the team's money and nobody else — plus the
        -- templates the team's plan unlocks (one `split_template_<type>` flag each, the gate
        -- finance.save_split_rule applies, Decision #234) and every active member's vault capabilities
        -- (org.fn_vault_capabilities_for, the projection finance.vault_permissions holds).
        'payout', CASE WHEN p_kind = 'team' AND 'manage_finances' = ANY (v_caps) THEN jsonb_build_object(
                'rule', (SELECT jsonb_build_object('rule_type', r.rule_type, 'vault_bp', r.vault_bp,
                                                   'finder_user_id', r.finder_user_id, 'finder_bp', r.finder_bp)
                           FROM finance.split_rules r WHERE r.team_id = v_e.id AND r.active
                          ORDER BY r.created_at DESC LIMIT 1),
                'unlocked_templates', (SELECT COALESCE(jsonb_agg(t.rule_type ORDER BY t.rule_type), '[]'::jsonb)
                    FROM unnest(enum_range(NULL::finance.split_rule_type)) AS t(rule_type)
                   WHERE finance.fn_has_entitlement('team', v_e.id,
                             ('split_template_' || t.rule_type::text)::finance.entitlement_key)),
                'vault_capabilities', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'user_id', m.user_id,
                        'capabilities', to_jsonb(org.fn_vault_capabilities_for('team', v_e.id, m.user_id)))
                        ORDER BY org.fn_preset_rank(m.role) DESC, m.joined_at, m.user_id), '[]'::jsonb)
                    FROM org.team_members m
                   WHERE m.team_id = v_e.id AND m.status = 'active'),
                'wallet', (SELECT jsonb_build_object('id', w.id, 'currency', upper(w.currency),
                                'available_minor', w.balance_cents,
                                'pending_minor', COALESCE((
                                    SELECT sum(GREATEST(pr.amount_cents - pr.recovered_cents, 0))
                                      FROM finance.pending_releases pr
                                     WHERE pr.wallet_id = w.id AND pr.state = 'pending'), 0))
                             FROM finance.wallets w
                            WHERE w.owner_type = 'team' AND w.owner_id = v_e.id
                            ORDER BY COALESCE(w.id = v_e.treasury_wallet_id, false) DESC, w.balance_cents DESC, w.currency
                            LIMIT 1),
                'preview', finance.preview_team_split(v_e.id)
            ) END,
        'allowance', CASE WHEN p_kind = 'team' THEN finance.get_proposal_allowance(v_e.id) END,
        -- The entity's live channels (Decision #306), default first then by slug, with the viewer's
        -- unread count and the last message's time — every active member reads them.
        'channels', comms.fn_entity_channel_list(p_kind, v_e.id, v_uid),
        -- What would refuse an archive right now, for the people who may archive (Settings lists them
        -- before the confirm); `[]` for everybody else.
        'archive_blockers', v_blockers,
        -- Where a restore would land, while the entity is archived (Settings names it on the control).
        'restore_target', CASE WHEN v_e.status = 'archived' THEN org.fn_workspace_restore_target(p_kind, v_e.id) END,
        -- A business's pooled-wallet governance, for the people who may open Spend (BB9).
        'spend', CASE WHEN p_kind = 'business' AND v_sees_spend THEN jsonb_build_object(
                'currency', v_currency,
                'approval_threshold_minor', (SELECT w.approval_threshold_cents FROM finance.wallets w WHERE w.id = v_wallet),
                'platform_threshold_minor', (SELECT NULLIF((pp.value #>> '{}')::bigint, 0) FROM security.platform_params pp
                                              WHERE pp.key = 'vault_approval_threshold_cents'),
                'approver_user_ids', (SELECT COALESCE(jsonb_agg(m.user_id ORDER BY org.fn_preset_rank(m.role) DESC, m.joined_at), '[]'::jsonb)
                    FROM org.business_members m
                   WHERE m.business_id = v_e.id AND m.status = 'active'
                     AND 'approve_spend' = ANY (org.fn_member_capabilities('business', v_e.id, m.user_id))),
                'contributor_user_ids', (SELECT COALESCE(jsonb_agg(m.user_id ORDER BY org.fn_preset_rank(m.role) DESC, m.joined_at), '[]'::jsonb)
                    FROM org.business_members m
                   WHERE m.business_id = v_e.id AND m.status = 'active'
                     AND 'contribute_funds' = ANY (org.fn_member_capabilities('business', v_e.id, m.user_id))),
                -- The members whose limits and grants the viewer may change, by finance.save_spend_policy's
                -- own rules — never the owner, never oneself, only somebody one outranks (BU2, #246).
                'editable_member_ids', CASE WHEN 'manage_finances' = ANY (v_caps) THEN (
                    SELECT COALESCE(jsonb_agg(m.id ORDER BY org.fn_preset_rank(m.role) DESC, m.joined_at), '[]'::jsonb)
                      FROM org.business_members m
                     WHERE m.business_id = v_e.id AND m.status = 'active'
                       AND m.user_id <> v_e.owner_user_id AND m.user_id <> v_uid
                       AND org.fn_preset_rank(m.role) < v_rank) ELSE '[]'::jsonb END,
                -- Nobody besides the owner approves spending, so the owner's own spend over the threshold
                -- or a limit has nobody to decide it (nobody decides their own request — #239 (e)).
                'approver_gap', NOT EXISTS (
                    SELECT 1 FROM org.business_members m
                     WHERE m.business_id = v_e.id AND m.status = 'active' AND m.user_id <> v_e.owner_user_id
                       AND 'approve_spend' = ANY (org.fn_member_capabilities('business', v_e.id, m.user_id))),
                -- Setting a threshold, a ceiling or a capped period is Business Pro's (`pooled_wallet_full`)
                -- and would be refused right now; clearing one never is.
                'limits_plan_gated', finance.fn_business_plan_gates_enforced()
                    AND NOT finance.fn_business_gate_flag(v_e.id, 'pooled_wallet_full'::finance.entitlement_key),
                'limits', finance.fn_business_envelopes(v_e.id, v_wallet, NULL),
                -- Whether `limits` holds every member's envelope or only the viewer's own — exactly
                -- finance.fn_business_envelopes' own v_reads_all, so the Members table shows a Spending
                -- column only to a viewer who reads everyone's (BU7).
                'reads_all_envelopes', CASE WHEN v_wallet IS NOT NULL THEN finance.fn_reads_wallet_envelopes(v_wallet)
                    ELSE org.fn_member_can('business', v_e.id, 'manage_finances')
                      OR org.fn_member_can('business', v_e.id, 'approve_spend') END,
                'contributed', (SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', c.actor_user_id, 'minor', c.total)), '[]'::jsonb)
                    FROM (SELECT la.actor_user_id, sum(la.amount_cents) AS total FROM finance.ledger_audit la
                           WHERE la.wallet_id = v_wallet AND la.action = 'add_funds' AND la.actor_user_id IS NOT NULL
                           GROUP BY la.actor_user_id) c),
                'contributions', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'id', a.id, 'actor_user_id', a.actor_user_id, 'amount_minor', a.amount_cents,
                        'currency', upper(a.currency), 'note', a.metadata->>'note', 'kind', a.metadata->>'kind',
                        'at', a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
                    FROM (SELECT la.* FROM finance.ledger_audit la JOIN finance.wallets w ON w.id = la.wallet_id
                           WHERE w.owner_type = 'business' AND w.owner_id = v_e.id AND la.action = 'add_funds'
                           ORDER BY la.created_at DESC LIMIT 40) a),
                'debits', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'id', d.id, 'amount_minor', d.amount_cents, 'currency', upper(d.currency),
                        'reason', d.reason, 'at', d.created_at) ORDER BY d.created_at DESC), '[]'::jsonb)
                    FROM (SELECT tx.* FROM finance.transactions tx JOIN finance.wallets w ON w.id = tx.wallet_id
                           WHERE w.owner_type = 'business' AND w.owner_id = v_e.id AND tx.direction = 'debit'
                             AND tx.reason <> 'transfer_out'
                           ORDER BY tx.created_at DESC LIMIT 40) d),
                -- The requests the viewer may read, as the spend_approvals SELECT policy narrows them (BB6).
                -- Each row names what it is for (`ref`, finance.fn_spend_ref) — resolved only for the rows
                -- answered, never for the whole history.
                'approvals', (SELECT jsonb_build_object(
                        'pending', COALESCE(jsonb_agg(q.row || jsonb_build_object('ref', finance.fn_spend_ref(q.ref_table, q.ref_id)) ORDER BY q.created_at DESC) FILTER (WHERE q.open), '[]'::jsonb),
                        'decided', COALESCE((jsonb_agg(q.row || jsonb_build_object('ref', finance.fn_spend_ref(q.ref_table, q.ref_id)) ORDER BY q.settled_at DESC) FILTER (WHERE NOT q.open)), '[]'::jsonb))
                    FROM (
                        SELECT r.row, r.ref_table, r.ref_id, r.created_at, r.open, r.settled_at,
                               row_number() OVER (PARTITION BY r.open ORDER BY r.settled_at DESC) AS n
                          FROM (
                            SELECT jsonb_build_object(
                                       'id', sa.id, 'requested_by', sa.requested_by, 'amount_minor', sa.amount_cents,
                                       'currency', upper(sa.currency), 'reason', sa.reason, 'status', sa.status,
                                       'approver_user_id', sa.approver_user_id, 'decided_at', sa.decided_at,
                                       'expires_at', sa.expires_at, 'created_at', sa.created_at,
                                       'ref_table', sa.ref_table, 'ref_id', sa.ref_id,
                                       'consumed', sa.consumed_at IS NOT NULL) AS row,
                                   sa.ref_table, sa.ref_id,
                                   sa.created_at,
                                   sa.status = 'pending'::finance.approval_status
                                       AND (sa.expires_at IS NULL OR sa.expires_at > now()) AS open,
                                   COALESCE(sa.decided_at, LEAST(sa.expires_at, now()), sa.created_at) AS settled_at
                              FROM finance.spend_approvals sa JOIN finance.wallets w ON w.id = sa.wallet_id
                             WHERE w.owner_type = 'business' AND w.owner_id = v_e.id
                               AND (sa.requested_by = v_uid OR finance.fn_reads_wallet_envelopes(sa.wallet_id))
                          ) r
                    ) q
                   WHERE q.open OR q.n <= 30)
            ) END,
        -- One currency's tiles per business wallet, summed in that currency, for the people who may open
        -- Finance; `[]` for everybody else and for a team.
        'money_tiles', CASE WHEN p_kind = 'business' AND v_sees_money THEN (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'currency', upper(w.currency),
                    'available_minor', w.balance_cents,
                    'pending_minor', COALESCE((SELECT sum(GREATEST(pr.amount_cents - pr.recovered_cents, 0))
                        FROM finance.pending_releases pr WHERE pr.wallet_id = w.id AND pr.state = 'pending'), 0),
                    'committed_minor', COALESCE((SELECT sum(e.amount_cents) FROM finance.escrows e
                        WHERE e.payer_business_id = v_e.id AND e.status IN ('held', 'funded')
                          AND upper(e.currency) = upper(w.currency)), 0),
                    'awaiting_approval_minor', COALESCE((SELECT sum(sa.amount_cents) FROM finance.spend_approvals sa
                        WHERE sa.wallet_id = w.id AND sa.status = 'pending'::finance.approval_status
                          AND (sa.expires_at IS NULL OR sa.expires_at > now())), 0),
                    'spent_30d_minor', COALESCE((SELECT sum(tx.amount_cents) FROM finance.transactions tx
                        WHERE tx.wallet_id = w.id AND tx.direction = 'debit' AND tx.reason <> 'transfer_out'
                          AND tx.created_at > now() - interval '30 days'), 0)
                ) ORDER BY upper(w.currency) = v_currency DESC, w.balance_cents DESC, w.currency), '[]'::jsonb)
              FROM finance.wallets w WHERE w.owner_type = 'business' AND w.owner_id = v_e.id)
            ELSE '[]'::jsonb END,
        -- What the viewer may do, by the same conditions the doors enforce: the capability, plus an active
        -- business (org.fn_assert_business_active) and KYB (the spend gate, pay_invoice) where they apply.
        'viewer_can', CASE WHEN p_kind = 'business' THEN jsonb_build_object(
                'edit_policy', 'manage_finances' = ANY (v_caps),
                'decide', 'approve_spend' = ANY (v_caps) AND v_verified,
                'request_spend', v_spender AND v_active,
                'pay_invoice', 'manage_billing' = ANY (v_caps) AND v_verified AND v_active,
                'start_kyb', 'manage_billing' = ANY (v_caps),
                'hire', 'hire' = ANY (v_caps) AND v_active,
                'purchase', 'purchase' = ANY (v_caps) AND v_spender AND v_verified AND v_active,
                'manage_projects', 'manage_projects' = ANY (v_caps) AND v_active,
                'archive', 'archive_entity' = ANY (v_caps) AND v_e.status <> 'archived' AND jsonb_array_length(v_blockers) = 0
            ) END,
        -- The business's KYB picture: its status, whether a Connect account exists, and what is still due
        -- (stable codes; the provider's field-level list is not stored).
        'kyb', CASE WHEN p_kind = 'business' THEN (
            SELECT jsonb_build_object(
                'status', v_e.kyb_status,
                'verified_at', v_e.kyb_verified_at,
                'has_account', pa.id IS NOT NULL,
                'requirements_due', CASE
                    WHEN v_e.kyb_status = 'verified' THEN '[]'::jsonb
                    WHEN v_e.kyb_status = 'rejected' THEN jsonb_build_array('kyb_rejected')
                    WHEN v_e.kyb_status = 'expired' THEN jsonb_build_array('kyb_expired')
                    WHEN pa.id IS NULL THEN jsonb_build_array('connect_account')
                    WHEN pa.status IN ('restricted', 'disabled') THEN jsonb_build_array('provider_restricted')
                    ELSE jsonb_build_array('finish_onboarding') END)
              FROM (SELECT 1) one
              LEFT JOIN LATERAL (SELECT x.id, x.status FROM finance.payout_accounts x
                                  WHERE x.owner_type = 'business' AND x.owner_id = v_e.id
                                  ORDER BY x.updated_at DESC LIMIT 1) pa ON true) END,
        -- The 30 most recent events, joins and money movements interleaved by time.
        'activity', (SELECT COALESCE(jsonb_agg(q.a ORDER BY q.at DESC), '[]'::jsonb) FROM (
            SELECT u.a, u.at FROM (
                SELECT jsonb_build_object('kind', 'member', 'event', 'joined', 'actor_user_id', m.user_id, 'at', m.joined_at) AS a,
                       m.joined_at AS at
                  FROM (SELECT x.user_id, x.joined_at FROM org.team_members x WHERE p_kind = 'team' AND x.team_id = v_e.id AND x.status = 'active'
                        UNION ALL SELECT x.user_id, x.joined_at FROM org.business_members x WHERE p_kind = 'business' AND x.business_id = v_e.id AND x.status = 'active') m
                UNION ALL
                SELECT jsonb_build_object('kind', 'money', 'event', la.action::text, 'actor_user_id', la.actor_user_id,
                                          'amount_minor', la.amount_cents, 'currency', la.currency, 'at', la.created_at),
                       la.created_at
                  FROM finance.ledger_audit la JOIN finance.wallets w ON w.id = la.wallet_id
                 WHERE w.owner_type = p_kind AND w.owner_id = v_e.id
            ) u
            ORDER BY u.at DESC
            LIMIT 30
        ) q),
        'setup', jsonb_build_object(
            'logo', v_e.avatar IS NOT NULL,
            'bio', COALESCE(v_e.headline, '') <> '',
            'invite', (SELECT count(*) FROM (
                SELECT 1 FROM org.team_members x WHERE p_kind = 'team' AND x.team_id = v_e.id AND x.status = 'active'
                UNION ALL SELECT 1 FROM org.business_members x WHERE p_kind = 'business' AND x.business_id = v_e.id AND x.status = 'active') c) > 1
                OR EXISTS (SELECT 1 FROM org.org_invitations i WHERE COALESCE(i.team_id, i.business_id) = v_e.id AND i.status = 'pending'),
            'money', CASE p_kind
                WHEN 'team' THEN (SELECT count(*) FROM finance.contribution_agreements ca
                    JOIN org.team_members m3 ON m3.team_id = ca.team_id AND m3.user_id = ca.member_user_id AND m3.status = 'active'
                   WHERE ca.team_id = v_e.id AND ca.percent_bp > 0) > 1
                ELSE EXISTS (SELECT 1 FROM finance.wallets w WHERE w.owner_type = 'business' AND w.owner_id = v_e.id
                              AND COALESCE(w.approval_threshold_cents, 0) > 0) END,
            -- Money was ever added to the business's pooled wallet (any `add_funds` row), so the
            -- Overview's "Add money" step stays done once the wallet is spent.
            'funded', p_kind = 'business' AND EXISTS (SELECT 1 FROM finance.ledger_audit la
                JOIN finance.wallets w ON w.id = la.wallet_id
               WHERE w.owner_type = 'business' AND w.owner_id = v_e.id AND la.action = 'add_funds'),
            -- The plan lets the business set a threshold or member limits: the negation of the Spend
            -- editor's `limits_plan_gated`. Without it the Overview leaves out "Set spending rules".
            'limits_offered', p_kind = 'business' AND NOT (finance.fn_business_plan_gates_enforced()
                AND NOT finance.fn_business_gate_flag(v_e.id, 'pooled_wallet_full'::finance.entitlement_key)))
    );
END;
$$;
-- #endregion

-- #region 17. The business bench — who a business has hired (Talent, BU5 — Decision #230 (i), #241)
-- The Talent module's ONE read: every freelancer and team with at least one completed or live
-- engagement on a project billed to this business (projects.client_business_id), from
-- projects.stage_assignments — the source the console's Projects module names its providers
-- from. An engagement is a PROJECT, counted once however many of its stages the party held.
--   completed: the stage was approved or paid (projects.approve_stage pays it), or the project
--              completed with work begun on the stage (in progress, submitted or in revisions) — a
--              seat on a stage nobody started or funded is a cancelled booking, not a past
--              engagement. No live door writes an assignment's own 'completed' status (only the
--              seed does), so the stage is the evidence.
--   live:      the assignment is in the live set (the uq_stage_assignment_active_assignee
--              predicate), the project active or on hold, and the stage still open to work.
-- A declined, cancelled or released (left) seat is no engagement; a draft project has hired nobody;
-- an erased account (a completed account deletion) has left the platform and the bench.
-- `last_worked_at` is the latest paid stage's completed_at (the one instant a delivery is dated
-- by); the rating is the mean of the reviews the BUSINESS gave the party — written by one of its
-- members, on one of its own projects.
-- Per row, for the caller: `profile_visible` (org.fn_profile_visible — whether /@handle opens for
-- them; a team starts invite-only, a person may go private) and `viewer_manages`
-- (org.fn_profile_manages — their own profile or a team they administer, where the profile offers
-- no Add to project).
-- Answered only to an active member holding `hire` — the console's Talent gate asks the same
-- capability; anybody else is told 'forbidden', a reference no business holds 'not_found'.
-- Handles, names and public avatar objects only: no row id is a field of the answer (an avatar
-- object path keeps the storage bucket's owner-id prefix, the platform's avatar layout). A team's
-- Message reaches its OWNER (a DM is between two people — comms.get_or_create_dm_thread takes a
-- user), so the owner's handle rides the row.
CREATE OR REPLACE FUNCTION org.get_business_bench(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_business uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    SELECT b.id INTO v_business FROM org.business_profiles b
     WHERE lower(b.slug) = lower(btrim(COALESCE(p_handle, '')))
        OR b.id = CASE WHEN p_handle ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p_handle::uuid END;
    IF v_business IS NULL THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF NOT org.fn_member_can('business', v_business, 'hire') THEN
        RETURN jsonb_build_object('status', 'forbidden');
    END IF;

    RETURN jsonb_build_object('status', 'ok', 'entries', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'kind', x.kind,
                   'handle', x.handle,
                   'name', x.name,
                   'avatar_bucket', x.avatar_bucket,
                   'avatar_path', x.avatar_path,
                   'contact_handle', x.contact_handle,
                   'contact_name', x.contact_name,
                   'engagements', x.engagements,
                   'live_now', x.live_now,
                   'last_worked_at', x.last_worked_at,
                   'rating_average', x.rating_average,
                   'rating_count', x.rating_count,
                   'profile_visible', x.profile_visible,
                   'viewer_manages', x.viewer_manages
               ) ORDER BY x.live_now DESC, x.last_worked_at DESC NULLS LAST, lower(x.name), x.handle)
          FROM (
              SELECT g.kind, g.engagements, g.live_now, g.last_worked_at,
                     org.fn_profile_visible(CASE WHEN g.kind = 'team' THEN 'team' ELSE 'user' END, g.party_id)
                         AS profile_visible,
                     org.fn_profile_manages(CASE WHEN g.kind = 'team' THEN 'team' ELSE 'user' END, g.party_id)
                         AS viewer_manages,
                     COALESCE(u.username, t.slug) AS handle,
                     CASE WHEN g.kind = 'team' THEN t.name
                          ELSE btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) END AS name,
                     fa.bucket_id AS avatar_bucket, fa.storage_path AS avatar_path,
                     COALESCE(u.username, o.username) AS contact_handle,
                     CASE WHEN g.kind = 'team' THEN btrim(COALESCE(o.first_name, '') || ' ' || COALESCE(o.last_name, ''))
                          ELSE btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) END AS contact_name,
                     rv.average AS rating_average, COALESCE(rv.n, 0) AS rating_count
                FROM (
                    SELECT e.kind, e.party_id,
                           count(DISTINCT e.project_id)::int AS engagements,
                           bool_or(e.live) AS live_now,
                           max(e.completed_at) FILTER (WHERE e.completed) AS last_worked_at
                      FROM (
                          SELECT sa.assignee_type::text AS kind,
                                 CASE WHEN sa.assignee_type = 'team' THEN sa.team_id ELSE sa.freelancer_profile_id END AS party_id,
                                 pr.id AS project_id,
                                 (sa.status = 'completed' OR ps.status IN ('approved', 'paid')
                                   OR (pr.status = 'completed' AND ps.status IN ('in_progress', 'submitted', 'revisions')))
                                     AS completed,
                                 ps.completed_at,
                                 (sa.status NOT IN ('released', 'cancelled', 'declined', 'completed')
                                   AND pr.status IN ('active', 'on_hold')
                                   AND ps.status NOT IN ('approved', 'paid', 'cancelled')) AS live
                            FROM projects.projects pr
                            JOIN projects.project_stages ps ON ps.project_id = pr.id
                            JOIN projects.stage_assignments sa ON sa.project_stage_id = ps.id
                           WHERE pr.client_business_id = v_business
                             AND pr.status <> 'draft'
                             AND sa.status NOT IN ('declined', 'cancelled', 'released')
                      ) e
                     WHERE e.party_id IS NOT NULL AND (e.completed OR e.live)
                     GROUP BY e.kind, e.party_id
                ) g
                LEFT JOIN org.users_public u ON g.kind = 'freelancer' AND u.user_id = g.party_id
                LEFT JOIN org.teams t ON g.kind = 'team' AND t.id = g.party_id
                LEFT JOIN org.users_public o ON o.user_id = t.owner_user_id
                LEFT JOIN files.items fa ON fa.id = COALESCE(u.avatar_file_id, t.avatar_file_id)
                                        AND fa.visibility = 'public' AND fa.deleted_at IS NULL
                LEFT JOIN LATERAL (
                    SELECT round(avg(r.rating), 2) AS average, count(*)::int AS n
                      FROM reviews.entity_reviews r
                      JOIN projects.projects rp ON rp.id = r.project_id
                     WHERE rp.client_business_id = v_business
                       AND r.target_entity_id = g.party_id
                       AND r.target_entity_type::text = ANY (CASE WHEN g.kind = 'team' THEN ARRAY['team']
                                                                ELSE ARRAY['freelancer', 'user'] END)
                       AND EXISTS (SELECT 1 FROM org.business_members bm
                                    WHERE bm.business_id = v_business AND bm.user_id = r.reviewer_user_id)
                ) rv ON true
               WHERE COALESCE(u.username, t.slug) IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM org.deletion_requests d
                                  WHERE g.kind = 'freelancer' AND d.user_id = g.party_id
                                    AND d.scope = 'account' AND d.status = 'completed')
          ) x
    ), '[]'::jsonb));
END;
$$;
-- #endregion
