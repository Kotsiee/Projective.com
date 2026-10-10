-- ============================================================================
-- 00001020 functions org entities
-- Consolidated from: 0109_is_active_team_member.sql, 0111_business_helpers.sql, 0307_stage_staffing.sql, 0313_freelancer_conversion.sql, 0314_organisations.sql, 20260709120000_business_teams_overhaul.sql; the workspace permission engine and its write/read RPCs are Decision #122.
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
SET search_path = public, org, security, auth
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
    --    through the one session-context writer, which clears the team and organisation slots in the
    --    same statement: writing only the profile slot left a caller acting as a team or an
    --    organisation holding two slots, which ck_session_context_one_slot refuses — so the
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
CREATE OR REPLACE FUNCTION org.is_organisation_member(
    p_org uuid,
    p_min_role org.organisation_role DEFAULT 'member'
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = org, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM org.organisation_members m
        WHERE m.organisation_id = p_org
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
-- RLS, which works for a team (members may SELECT their team) and an organisation, and returns
-- NOTHING for a business: `org.business_profiles` has no client SELECT policy at all, so a business
-- member's header fell back to the slug. This answers for exactly one entity — the one named — and
-- only when the caller holds an active seat in it (the owner of an organisation counts), so it can
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
BEGIN
    IF v_uid IS NULL OR p_context_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF p_context_type = 'team' THEN
        SELECT t.name, t.slug INTO v_name, v_handle
        FROM org.teams t
        WHERE t.id = p_context_id
          AND EXISTS (
              SELECT 1 FROM org.team_members m
              WHERE m.team_id = t.id AND m.user_id = v_uid AND m.status = 'active'
          );
    ELSIF p_context_type = 'business' THEN
        SELECT b.name, b.slug INTO v_name, v_handle
        FROM org.business_profiles b
        WHERE b.id = p_context_id
          AND EXISTS (
              SELECT 1 FROM org.business_members m
              WHERE m.business_id = b.id AND m.user_id = v_uid AND m.status = 'active'
          );
    ELSIF p_context_type = 'organisation' THEN
        SELECT COALESCE(NULLIF(btrim(o.trading_name), ''), o.legal_name), o.handle
          INTO v_name, v_handle
        FROM org.organisations o
        WHERE o.id = p_context_id
          AND (
              o.owner_user_id = v_uid
              OR EXISTS (
                  SELECT 1 FROM org.organisation_members m
                  WHERE m.organisation_id = o.id AND m.user_id = v_uid AND m.status = 'active'
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
        'handle', v_handle
    );
END;
$$;
-- #endregion

-- #region 5c. Editing an organisation — the one write door
-- `org.organisations` had a bare `FOR UPDATE` policy for its owner and admins: no column list, no
-- WITH CHECK, no validation. Any admin could rewrite the legal name, the registration number and the
-- corporate and billing addresses over PostgREST, with nothing checked and nothing recorded. The
-- policy is gone (00002010); this is the only way an organisation changes now.
--
--   * Only the keys below are accepted; an unknown key is refused, never ignored, and the
--     platform-owned columns (owner · handle · status · verification · logo) are refused by name.
--   * The LEGAL identity — legal name, registration number, corporate email — is the owner's to
--     change, and is frozen once KYB has begun (`kyb_pending`, `verified`): a verified identity that
--     could be edited afterwards would verify nothing.
--   * Every value is checked against the bounds `@projective/types/org` UpdateOrganisationSchema
--     states; an empty string clears an optional field.
--   * Every edit is audited (`organisation.updated`, with the keys changed).
CREATE OR REPLACE FUNCTION org.update_organisation(p_org_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_org org.organisations%ROWTYPE;
    v_is_owner boolean;
    v_is_org_admin boolean;
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

    SELECT * INTO v_org FROM org.organisations o WHERE o.id = p_org_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Organisation not found' USING ERRCODE = 'P0002';
    END IF;

    v_is_owner := v_org.owner_user_id = v_uid;
    v_is_org_admin := org.is_organisation_member(p_org_id, 'admin');
    IF NOT v_is_owner AND NOT v_is_org_admin AND NOT security.is_admin() THEN
        RAISE EXCEPTION 'Only the owner or an admin can edit this organisation' USING ERRCODE = '42501';
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
                RAISE EXCEPTION 'Only the owner can change the organisation''s legal identity'
                    USING ERRCODE = '42501';
            END IF;
            IF v_org.verification_level IN ('kyb_pending', 'verified') THEN
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

    -- An 'other' industry needs its specifier (organisations_industry_other_ck) — said in words here
    -- rather than as a constraint violation.
    IF COALESCE(
           CASE WHEN p_payload ? 'primaryIndustry' THEN NULLIF(btrim(p_payload->>'primaryIndustry'), '')
                ELSE v_org.primary_industry END, ''
       ) = 'other'
       AND COALESCE(
           CASE WHEN p_payload ? 'industryOther' THEN NULLIF(btrim(p_payload->>'industryOther'), '')
                ELSE v_org.industry_other END, ''
       ) = '' THEN
        RAISE EXCEPTION 'Name the industry when choosing Other' USING ERRCODE = '22023';
    END IF;

    UPDATE org.organisations o SET
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
    WHERE o.id = p_org_id;

    SELECT jsonb_agg(k ORDER BY k) INTO v_fields FROM jsonb_object_keys(p_payload) k;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (
        v_uid,
        'organisation.updated',
        'org.organisations',
        p_org_id,
        jsonb_build_object(
            'fields', v_fields,
            'as_platform_admin', NOT v_is_owner AND NOT v_is_org_admin
        )
    );

    RETURN jsonb_build_object('id', p_org_id, 'updated_fields', v_fields);
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
            WHEN 'team' THEN e.c NOT IN ('purchase', 'hire', 'contribute_funds', 'approve_spend')
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
-- organisations.handle), each UNIQUE only within itself, and org.fn_resolve_profile ranks a person
-- above a team above a business. So an entity could claim a handle a person already held and then
-- be unreachable at /@handle forever. Every create path now asks the whole namespace, under an
-- advisory lock on the handle so two creates racing for it cannot both see it free.

-- The SQL twin of @projective/types/profile RESERVED_HANDLES (pinned by workspace.contract.test.ts).
CREATE OR REPLACE FUNCTION org.fn_is_reserved_handle(p_handle text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT lower(btrim(COALESCE(p_handle, ''))) = ANY (ARRAY[
        'about', 'explore', 'help', 'view', 'join', 'login', 'register', 'signin', 'signup', 'logout',
        'forgot-password', 'reset-password', 'verify', 'index', 'home', 'pricing', 'terms', 'privacy',
        'legal', 'contact', 'blog', 'careers', 'status', 'dashboard', 'projects', 'project', 'business',
        'businesses', 'teams', 'team', 'messages', 'inbox', 'files', 'file', 'inspect', 'share', 'exit', 'wallet', 'billing',
        'settings', 'services', 'service', 'products', 'portfolio', 'reviews', 'articles', 'members',
        'departments', 'education', 'experience', 'availability', 'become-partner', 'onboarding',
        'notifications', 'basket', 'cart', 'checkout', 'catalogue', 'orders', 'order', 'pay', 'payment',
        'payments', 'invoice', 'invoices', 'create', 'new', 'search', 'submissions', 'attachments',
        'board', 'tasks', 'calendar', 'api', 'assets', 'static', 'public', '_app', '_middleware',
        '_layout', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'admin', 'internal'
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
        OR EXISTS (SELECT 1 FROM org.organisations o WHERE lower(o.handle) = lower(p_handle))
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
        INSERT INTO org.business_roles (business_id, name, summary, preset, base_preset) VALUES
            (p_entity, 'Owner', 'Full authority, including archiving and transferring ownership.', 'owner', 'owner'),
            (p_entity, 'Admin', 'Runs the roster, the money and the settings — everything but archiving.', 'admin', 'admin'),
            (p_entity, 'Member', 'Does the work and sees how the entity is performing.', 'member', 'member');
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
    IF length(v_name) < 2 OR length(v_name) > 80 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'name: give it a name between 2 and 80 characters';
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
            || CASE p_kind WHEN 'team' THEN 'team' ELSE 'business' END
            || CASE WHEN v_limit = 1 THEN '' ELSE 'es' END || ' — archive one or upgrade to create another';
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
        INSERT INTO org.business_profiles (owner_user_id, name, slug, status, headline, default_currency)
        VALUES (v_uid, v_name, v_handle, 'draft', '', v_currency)
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
-- Publishing needs `manage_settings`; archiving or restoring needs `archive_entity`. An entity with
-- money in flight is not archived: a held escrow owed to (team) or funded by (business) the entity,
-- or a live stage assignment, would otherwise be stranded against something that says it is gone.
CREATE OR REPLACE FUNCTION org.set_workspace_status(p_kind text, p_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_current text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('draft', 'active', 'archived') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'status: choose draft, active or archived';
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

    IF p_status = 'archived' OR v_current = 'archived' THEN
        IF NOT org.fn_member_can(p_kind, p_id, 'archive_entity') THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'status: you cannot archive or restore this ' || p_kind;
        END IF;
    ELSIF NOT org.fn_member_can(p_kind, p_id, 'manage_settings') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'status: you cannot change this ' || p_kind || '''s settings';
    END IF;
    IF p_status = 'draft' AND v_current = 'active' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'status: a published ' || p_kind || ' cannot go back to draft';
    END IF;

    IF p_status = 'archived' THEN
        IF EXISTS (
            SELECT 1 FROM finance.escrows e
             WHERE e.status = 'held'
               AND ((p_kind = 'team' AND e.payee_type = 'team' AND e.payee_id = p_id)
                 OR (p_kind = 'business' AND e.payer_business_id = p_id))
        ) THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'status: money is held in escrow for this ' || p_kind || ' — let it release first';
        END IF;
        IF p_kind = 'team' AND EXISTS (
            SELECT 1 FROM projects.stage_assignments sa
              JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
              JOIN projects.projects pr ON pr.id = ps.project_id
             WHERE sa.team_id = p_id
               AND sa.status NOT IN ('declined', 'cancelled', 'released', 'completed')
               AND pr.status IN ('active', 'on_hold')
        ) THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'status: this team is still assigned to live work — finish or hand it back first';
        END IF;
    END IF;

    IF p_kind = 'team' THEN
        UPDATE org.teams SET status = p_status, updated_at = now() WHERE id = p_id;
    ELSE
        UPDATE org.business_profiles SET status = p_status, updated_at = now() WHERE id = p_id;
    END IF;
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, p_kind || '.status_changed', CASE p_kind WHEN 'team' THEN 'org.teams' ELSE 'org.business_profiles' END, p_id,
            jsonb_build_object('from', v_current, 'to', p_status));
    RETURN jsonb_build_object('id', p_id, 'status', p_status);
END;
$$;

-- The identity patch: name and headline. Pictures move through the media pipeline
-- (org.set_profile_avatar / org.set_profile_banner), status through org.set_workspace_status.
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

    IF p_kind = 'team' THEN
        UPDATE org.teams
           SET name = COALESCE(v_name, name), headline = COALESCE(v_headline, headline), updated_at = now()
         WHERE id = p_id;
    ELSE
        UPDATE org.business_profiles
           SET name = COALESCE(v_name, name), headline = COALESCE(v_headline, headline), updated_at = now()
         WHERE id = p_id;
    END IF;
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, p_kind || '.updated', CASE p_kind WHEN 'team' THEN 'org.teams' ELSE 'org.business_profiles' END, p_id,
            jsonb_build_object('fields', to_jsonb(ARRAY(SELECT jsonb_object_keys(p_patch)))));
    RETURN jsonb_build_object('id', p_id);
END;
$$;
-- #endregion

-- #region 12. Invitations — named people only
-- A workspace invitation addresses one person (by handle) or one address (by email). Join requests
-- and share links were CUT (product decision 2026-09-28): the table's own CHECK forbids an
-- addressee-less row, and nothing could redeem one. org_invitations carries no client policy at all
-- — the token IS the accept capability — so every read and write below is a definer.
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
    v_used := (SELECT count(*) FROM org.team_members m WHERE m.team_id = p_entity AND m.status = 'active')
            + (SELECT count(*) FROM org.org_invitations i
                WHERE i.team_id = p_entity AND i.status = 'pending'
                  AND (i.expires_at IS NULL OR i.expires_at > now()));
    IF v_used + p_extra > v_limit THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'plan: this team''s plan has ' || v_limit || ' seats, and they are all taken or offered';
    END IF;
END;
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
    ELSIF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 160 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'email: enter a valid email address';
    END IF;

    PERFORM org.fn_assert_seat(p_kind, p_entity, 1);

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
    IF v_status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invitation: this ' || v_kind || ' has been archived';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = v_uid) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: finish setting up your account first';
    END IF;
    IF EXISTS (SELECT 1 FROM org.fn_role_of_entity(v_kind, v_entity, v_role) r WHERE r.archived) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invitation: the role offered no longer exists — ask for a new invitation';
    END IF;
    -- This invitation already holds one of the counted seats, so it adds none.
    PERFORM org.fn_assert_seat(v_kind, v_entity, 0);

    -- A former member is reactivated, never inserted twice (UNIQUE (entity, user)).
    IF v_kind = 'team' THEN
        INSERT INTO org.team_members (team_id, user_id, role_id, status, invited_by, joined_at)
        VALUES (v_entity, v_uid, v_role, 'active', v_inv.inviter_user_id, now())
        ON CONFLICT (team_id, user_id) DO UPDATE
            SET role_id = EXCLUDED.role_id, status = 'active', left_at = NULL,
                invited_by = EXCLUDED.invited_by, joined_at = now(),
                granted_capabilities = '{}', revoked_capabilities = '{}'
        RETURNING id INTO v_member;
        INSERT INTO finance.contribution_agreements (team_id, member_user_id, percent_bp, held)
        VALUES (v_entity, v_uid, 0, false)
        ON CONFLICT (team_id, member_user_id) DO NOTHING;
    ELSE
        INSERT INTO org.business_members (business_id, user_id, role_id, status, invited_by, joined_at)
        VALUES (v_entity, v_uid, v_role, 'active', v_inv.inviter_user_id, now())
        ON CONFLICT (business_id, user_id) DO UPDATE
            SET role_id = EXCLUDED.role_id, status = 'active', left_at = NULL,
                invited_by = EXCLUDED.invited_by, joined_at = now(),
                granted_capabilities = '{}', revoked_capabilities = '{}'
        RETURNING id INTO v_member;
    END IF;

    UPDATE org.org_invitations SET status = 'accepted', responded_at = now() WHERE id = p_invitation;
    PERFORM org.fn_sync_vault_permissions(v_kind, v_entity, v_uid);
    PERFORM org.fn_refresh_membership_flags(v_uid);
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
    IF org.fn_preset_rank(p_base_preset) > v_actor_rank THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'basePreset: a role cannot rank above you';
    END IF;
    v_caps := org.fn_role_capabilities(p_kind, NULL, COALESCE(p_capabilities, '{}'));
    IF EXISTS (SELECT 1 FROM unnest(v_caps) c WHERE NOT (c = ANY (v_actor))) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'capabilities: you cannot grant a permission you do not hold';
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
            IF p_kind = 'team' THEN
                UPDATE org.team_roles SET name = v_name, summary = v_summary, base_preset = p_base_preset, capabilities = v_caps, updated_at = now() WHERE id = p_role;
                UPDATE org.team_members SET role_id = role_id WHERE role_id = p_role;
            ELSE
                UPDATE org.business_roles SET name = v_name, summary = v_summary, base_preset = p_base_preset, capabilities = v_caps, updated_at = now() WHERE id = p_role;
                UPDATE org.business_members SET role_id = role_id WHERE role_id = p_role;
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
        SELECT t.id, t.name, t.slug, t.avatar_file_id AS avatar, t.headline, t.status, t.owner_user_id, t.created_at, m.role
          FROM org.team_members m JOIN org.teams t ON t.id = m.team_id
         WHERE p_kind = 'team' AND m.user_id = v_uid AND m.status = 'active'
        UNION ALL
        SELECT b.id, b.name, b.slug, b.logo_file_id, b.headline, b.status, b.owner_user_id, b.created_at, m.role
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
            ELSE (SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', s.currency, 'minor', s.total)), '[]'::jsonb) FROM (
                SELECT tx.currency, sum(tx.amount_cents) AS total FROM finance.transactions tx
                  JOIN finance.wallets w ON w.id = tx.wallet_id
                 WHERE w.owner_type = 'business' AND w.owner_id = e.id AND tx.direction = 'debit'
                   AND tx.reason <> 'transfer_out' AND tx.created_at > now() - interval '30 days'
                 GROUP BY tx.currency) s) END,
        'setup', jsonb_build_object(
            'logo', e.avatar IS NOT NULL,
            'bio', COALESCE(e.headline, '') <> '',
            'money', CASE p_kind
                WHEN 'team' THEN (SELECT count(*) FROM finance.contribution_agreements ca
                    JOIN org.team_members m3 ON m3.team_id = ca.team_id AND m3.user_id = ca.member_user_id AND m3.status = 'active'
                   WHERE ca.team_id = e.id AND ca.percent_bp > 0) > 1
                ELSE EXISTS (SELECT 1 FROM finance.wallets w WHERE w.owner_type = 'business' AND w.owner_id = e.id
                              AND COALESCE(w.approval_threshold_cents, 0) > 0) END),
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
CREATE OR REPLACE FUNCTION org.get_workspace_detail(p_kind text, p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_e record;
    v_caps org.workspace_capability[];
    v_member uuid;
    v_member_role_id uuid;
    v_cap_default numeric;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_kind = 'team' THEN
        SELECT t.id, t.name, t.slug, t.avatar_file_id AS avatar, t.banner_file_id AS banner, t.headline,
               t.status, t.owner_user_id, t.created_at, t.treasury_wallet_id
          INTO v_e FROM org.teams t
         WHERE lower(t.slug) = lower(btrim(COALESCE(p_handle, '')))
            OR t.id = CASE WHEN p_handle ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p_handle::uuid END;
    ELSIF p_kind = 'business' THEN
        SELECT b.id, b.name, b.slug, b.logo_file_id AS avatar, b.banner_file_id AS banner, b.headline,
               b.status, b.owner_user_id, b.created_at, NULL::uuid AS treasury_wallet_id
          INTO v_e FROM org.business_profiles b
         WHERE lower(b.slug) = lower(btrim(COALESCE(p_handle, '')))
            OR b.id = CASE WHEN p_handle ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p_handle::uuid END;
    ELSE
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kind: choose a team or a business';
    END IF;
    IF v_e.id IS NULL THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    SELECT s.member_id INTO v_member FROM org.fn_member_seat(p_kind, v_e.id, v_uid) s;
    IF v_member IS NULL THEN
        RETURN jsonb_build_object('status', 'forbidden', 'id', v_e.id);
    END IF;
    v_caps := org.fn_member_capabilities(p_kind, v_e.id, v_uid);
    SELECT x.role_id INTO v_member_role_id FROM (
        SELECT m.role_id FROM org.team_members m WHERE m.id = v_member
        UNION ALL SELECT m.role_id FROM org.business_members m WHERE m.id = v_member) x;
    SELECT (p.value #>> '{}')::numeric INTO v_cap_default FROM security.platform_params p WHERE p.key = 'global_workload_cap_default';

    RETURN jsonb_build_object(
        'status', 'ok',
        'id', v_e.id,
        'name', v_e.name,
        'handle', v_e.slug,
        'avatar_file_id', v_e.avatar,
        'banner_file_id', v_e.banner,
        'headline', COALESCE(v_e.headline, ''),
        'entity_status', v_e.status,
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
                'workload_current', fp.current_workload_intensity,
                'workload_max', COALESCE(fp.max_workload_intensity, v_cap_default),
                'availability', fp.availability_status
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
            LEFT JOIN org.freelancer_profiles fp ON fp.user_id = m.user_id),
        'roles', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', r.id,
                'name', r.name,
                'summary', r.summary,
                'preset', r.preset,
                'base_preset', r.base_preset,
                'capabilities', to_jsonb(org.fn_role_capabilities(p_kind, r.preset, r.capabilities)),
                'member_count', (SELECT count(*) FROM (
                    SELECT 1 FROM org.team_members x WHERE x.role_id = r.id AND x.status = 'active'
                    UNION ALL SELECT 1 FROM org.business_members x WHERE x.role_id = r.id AND x.status = 'active') c)
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
        'standing', (SELECT l.label FROM org.entity_standing s JOIN org.standing_levels l ON l.level = s.level
                      WHERE p_kind = 'team' AND s.subject_type = 'team' AND s.subject_id = v_e.id),
        'projects', CASE p_kind
            WHEN 'team' THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'slug', p.slug, 'title', p.title, 'status', p.status,
                    'client_business_id', p.client_business_id, 'owner_user_id', p.owner_user_id,
                    'stage_name', p.stage_name, 'stage_status', p.stage_status, 'due', p.due,
                    'stages_total', p.stages_total, 'stages_done', p.stages_done
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
                    'stages_done', (SELECT count(*) FROM projects.project_stages s2 WHERE s2.project_id = pr.id AND s2.status IN ('approved', 'paid'))
                ) ORDER BY pr.status = 'completed', pr.updated_at DESC), '[]'::jsonb)
                FROM projects.projects pr
                WHERE pr.client_business_id = v_e.id AND pr.status NOT IN ('draft', 'archived')) END,
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
                              AND COALESCE(w.approval_threshold_cents, 0) > 0) END)
    );
END;
$$;
-- #endregion
