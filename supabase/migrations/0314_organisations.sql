-- 0314_organisations.sql — the CLIENT/BUYER-ONLY organisation entity.
--
-- Net-new and ADDITIVE: no existing table, column, or foreign-key relationship is modified. An
-- Organisation is DISTINCT from org.business_profiles (the seller-side entity that offers
-- services/products) — an organisation registers only to hire/buy, never to sell, so it carries no
-- service/product surface. Multi-tenant membership is modelled as a join table
-- (org.organisation_members), NOT a single users.organisation_id column, because a user may belong
-- to several organisations.
--
-- Zod SSOT: lands with `packages/types/org/organisations.ts` and the
-- `documentation/database/org/{Tables,Policies,Functions}.md` updates in the same change.

-- #region Enums
CREATE TYPE org.organisation_role AS ENUM ('owner', 'admin', 'member');

CREATE TYPE org.employee_scale AS ENUM ('1-50', '51-200', '201-500', '500+');

CREATE TYPE org.organisation_status AS ENUM ('draft', 'active', 'suspended', 'archived');

CREATE TYPE org.organisation_verification_level AS ENUM (
    'unverified',
    'email_verified',
    'kyb_pending',
    'verified'
);
-- #endregion

-- #region org.organisations
CREATE TABLE org.organisations (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    owner_user_id uuid NOT NULL,
    legal_name text NOT NULL,
    trading_name text,
    handle text NOT NULL UNIQUE,
    registration_number text, -- CRN / EIN / VAT / Tax ID
    corporate_email text NOT NULL,
    corporate_phone text,
    website text, -- corporate website / domain
    address_line_1 text,
    address_city text,
    address_postcode text,
    address_country text,
    employee_scale org.employee_scale,
    primary_industry text, -- industry slug from the onboarding set
    industry_other text, -- free-text sector when primary_industry = 'other'
    departments text[] NOT NULL DEFAULT '{}'::text[],
    purpose text[] NOT NULL DEFAULT '{}'::text[],
    status org.organisation_status NOT NULL DEFAULT 'draft',
    verification_level org.organisation_verification_level NOT NULL DEFAULT 'unverified',
    logo_file_id uuid REFERENCES files.items (id) ON DELETE SET NULL,
    billing_email text,
    default_currency text NOT NULL DEFAULT 'USD',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT organisations_pkey PRIMARY KEY (id),
    CONSTRAINT organisations_owner_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users (id),
    -- Mirror the @projective/types refinement: 'other' requires a free-text specifier.
    CONSTRAINT organisations_industry_other_ck CHECK (
        primary_industry IS DISTINCT FROM 'other'
        OR (
            industry_other IS NOT NULL
            AND btrim(industry_other) <> ''
        )
    )
);

CREATE INDEX idx_organisations_owner ON org.organisations (owner_user_id);

CREATE INDEX idx_organisations_handle ON org.organisations (lower(handle));
-- #endregion

-- #region org.organisation_members (multi-tenant user↔organisation link + role)
CREATE TABLE org.organisation_members (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    organisation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role org.organisation_role NOT NULL DEFAULT 'member',
    status text NOT NULL DEFAULT 'active',
    invited_by uuid,
    joined_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT organisation_members_pkey PRIMARY KEY (id),
    CONSTRAINT organisation_members_org_fkey FOREIGN KEY (organisation_id) REFERENCES org.organisations (id) ON DELETE CASCADE,
    CONSTRAINT organisation_members_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
    CONSTRAINT organisation_members_inviter_fkey FOREIGN KEY (invited_by) REFERENCES auth.users (id) ON DELETE SET NULL,
    CONSTRAINT organisation_members_unique UNIQUE (organisation_id, user_id)
);

CREATE INDEX idx_organisation_members_user ON org.organisation_members (user_id);

CREATE INDEX idx_organisation_members_org ON org.organisation_members (organisation_id);
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
-- #endregion

-- #region RLS
ALTER TABLE org.organisations ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.organisation_members ENABLE ROW LEVEL SECURITY;

-- organisations: the owner, any active member, or an admin may view.
CREATE POLICY "Members can view their organisation" ON org.organisations FOR
SELECT TO public USING (
        owner_user_id = auth.uid ()
        OR org.is_organisation_member (id)
        OR security.is_admin ()
    );

-- Any authenticated user may create an organisation they own.
CREATE POLICY "Users can create organisations they own" ON org.organisations FOR
INSERT
    TO public
WITH
    CHECK (owner_user_id = auth.uid ());

-- Owner or admin members may update.
CREATE POLICY "Owners and admins can update the organisation" ON org.organisations FOR
UPDATE TO public USING (
    owner_user_id = auth.uid ()
    OR org.is_organisation_member (id, 'admin')
    OR security.is_admin ()
);

-- organisation_members: a user sees their own row; owners/admins see the whole roster.
CREATE POLICY "Members can view the roster" ON org.organisation_members FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR org.is_organisation_member (organisation_id, 'admin')
        OR security.is_admin ()
    );

-- The owner seeds their own owner-membership at creation; owners/admins add others thereafter.
CREATE POLICY "Admins manage membership" ON org.organisation_members FOR
INSERT
    TO public
WITH
    CHECK (
        org.is_organisation_member (organisation_id, 'admin')
        OR EXISTS (
            SELECT 1
            FROM org.organisations o
            WHERE
                o.id = organisation_id
                AND o.owner_user_id = auth.uid ()
        )
        OR security.is_admin ()
    );

CREATE POLICY "Admins update membership" ON org.organisation_members FOR
UPDATE TO public USING (
    org.is_organisation_member (organisation_id, 'admin')
    OR security.is_admin ()
);

CREATE POLICY "Admins remove membership" ON org.organisation_members FOR DELETE TO public USING (
    org.is_organisation_member (organisation_id, 'admin')
    OR security.is_admin ()
);
-- #endregion
