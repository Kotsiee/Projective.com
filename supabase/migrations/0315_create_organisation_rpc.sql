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
BEGIN
    IF p_owner IS NULL THEN
        RAISE EXCEPTION 'owner is required' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(p_payload->>'legalName', '') IS NULL OR NULLIF(p_payload->>'handle', '') IS NULL THEN
        RAISE EXCEPTION 'legalName and handle are required' USING ERRCODE = '22023';
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
        p_payload->>'handle',
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
        jsonb_build_object('handle', p_payload->>'handle', 'legal_name', p_payload->>'legalName'),
        NULL
    );

    RETURN v_org;
END;
$$;

-- Only the service-role backend provisions organisations (after admin-creating the owner identity).
GRANT EXECUTE ON FUNCTION public.create_organisation(uuid, jsonb) TO service_role;
