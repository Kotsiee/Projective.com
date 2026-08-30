-- =============================================================================================
-- 00000011_tables_org.sql — org schema tables (Category 0), in final folded form.
-- Base: 0003_org_tables.sql, 0314_organisations.sql, 20260724111000_standing_reputation.sql.
-- Folded ALTERs:
--   * org.users_public       += is_operator                              (20260709120000)
--   * org.business_profiles  += status (+CHECK), kyb_status/kyb_verified_at/kyb_provider_ref;
--                              billing_email DROP NOT NULL                 (20260709120000 / 091000)
--   * org.teams              += status (+CHECK)                           (20260709120000)
--   * org.user_preferences   += preferred_display_currency, layout_direction (20260723090000)
--   * org.freelancer_profiles+= max_workload_intensity (0310); kyc_status/kyc_tier/
--                              kyc_verified_at/payout_ready/identity_provider_ref (091000)
-- =============================================================================================

CREATE TABLE org.skills (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    slug text NOT NULL UNIQUE,
    label text NOT NULL,
    CONSTRAINT skills_pkey PRIMARY KEY (id)
);

CREATE TABLE org.users_public (
    user_id uuid NOT NULL,
    username text NOT NULL UNIQUE,
    first_name text,
    last_name text,
    avatar_file_id uuid REFERENCES files.items(id) ON DELETE SET NULL,
    banner_file_id uuid REFERENCES files.items(id) ON DELETE SET NULL,
    headline text NOT NULL DEFAULT ''::text,
    -- The city half of the profile location line, which the meta rail renders as "{city}, {country}".
    -- Nullable rather than NOT NULL DEFAULT '': a profile that has never stated a city must stay
    -- distinguishable from one that deliberately cleared it, and the rail then degrades to the
    -- country alone instead of drawing an empty leading segment. address_city exists only on
    -- business_profiles and organisations, so the individual/freelancer kind had no city at all.
    city text,
    country text,
    timezone text,
    languages text[] NOT NULL DEFAULT '{}'::text[],
    dob date NOT NULL,
    visibility text NOT NULL DEFAULT 'public'::text,
    bio jsonb NOT NULL DEFAULT '{}'::jsonb,
    interests text[] NOT NULL DEFAULT '{}'::text[], -- Added for algorithm discovery
    rating_average numeric(3,2) DEFAULT 0.0,
    rating_count integer DEFAULT 0,
    active_project_count integer DEFAULT 0,
    total_project_count integer DEFAULT 0,
    service_count integer DEFAULT 0,
    product_count integer DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    is_freelancer boolean NOT NULL DEFAULT false,
    has_business boolean NOT NULL DEFAULT false,
    has_team boolean NOT NULL DEFAULT false,
    -- Folded (20260709120000): Client / Operator Mode flag gating the Businesses nav space.
    is_operator boolean NOT NULL DEFAULT false,
    CONSTRAINT users_public_pkey PRIMARY KEY (user_id),
    CONSTRAINT users_public_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE org.user_emails (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL,
    email text NOT NULL,
    is_primary boolean NOT NULL DEFAULT false,
    verified_at timestamp
    with
        time zone,
        created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        CONSTRAINT user_emails_pkey PRIMARY KEY (id),
        CONSTRAINT user_emails_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id),
        CONSTRAINT user_emails_user_id_fkey1 FOREIGN KEY (user_id) REFERENCES org.users_public (user_id)
);

CREATE TABLE org.user_preferences (
    user_id uuid NOT NULL,
    theme text DEFAULT 'system',
    notification_email boolean DEFAULT true,
    notification_push boolean DEFAULT false,
    locale text DEFAULT 'en-GB',
    ui_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Folded (20260723090000): presentational display-conversion target + document layout direction.
    -- The DEFAULT seeds a new row with the platform base ('GBP'); NULL remains meaningful and means
    -- "follow the origin currency" (an explicitly cleared preference), so the two are not the same
    -- state. Presentational ONLY: nothing here converts a stored ledger amount.
    preferred_display_currency char(3) DEFAULT 'GBP' CHECK (
        preferred_display_currency IS NULL
        OR preferred_display_currency ~ '^[A-Z]{3}$'
    ),
    layout_direction org.layout_direction NOT NULL DEFAULT 'auto',
    CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id),
    CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE TABLE org.freelancer_profiles (
    user_id uuid NOT NULL,
    skills text[] NOT NULL DEFAULT '{}'::text[],
    availability_status text DEFAULT 'available',

    current_workload_intensity integer NOT NULL DEFAULT 0,
    available_since timestamp with time zone NOT NULL DEFAULT now(),
    rating_average numeric(3,2) DEFAULT 0.0,
    rating_count integer DEFAULT 0,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    -- Folded (0310): Global Soft Cap on summed active-ticket Workload Intensity (NULL = platform default).
    max_workload_intensity numeric(6,2),
    -- Folded (20260723091000): freelancer KYC + payout-readiness cache.
    kyc_status finance.kyc_status NOT NULL DEFAULT 'unverified',
    kyc_tier smallint,
    kyc_verified_at timestamptz,
    payout_ready boolean NOT NULL DEFAULT false,
    identity_provider_ref text,   -- Stripe Identity session id (placeholder; no PII)

    CONSTRAINT freelancer_profiles_pkey PRIMARY KEY (user_id),
    CONSTRAINT freelancer_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE org.business_profiles (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    legal_name text,
    logo_file_id uuid REFERENCES files.items(id) ON DELETE SET NULL,
    banner_file_id uuid REFERENCES files.items(id) ON DELETE SET NULL,
    country text,
    -- Folded (20260709120000): billing_email NOT NULL was dropped (draft-first low-friction creation).
    billing_email text,
    plan text NOT NULL DEFAULT 'free'::text,
    headline text NOT NULL DEFAULT ''::text,
    bio jsonb NOT NULL DEFAULT '{}'::jsonb,
    languages text[] NOT NULL DEFAULT '{}'::text[],
    timezone text,
    default_currency text DEFAULT 'USD',
    tax_id text,
    address_line_1 text,
    address_city text,
    address_zip text,
    rating_average numeric(3,2) DEFAULT 0.0,
    rating_count integer DEFAULT 0,
    system_penalty_score numeric(6,2) NOT NULL DEFAULT 0,
    invoicing_mode text NOT NULL DEFAULT 'per_transaction'::text CHECK (invoicing_mode IN ('per_transaction', 'intervaled_monthly')),
    billing_day smallint CHECK (billing_day BETWEEN 1 AND 28),
    active_project_count integer DEFAULT 0,
    total_project_count integer DEFAULT 0,
    service_count integer DEFAULT 0,
    product_count integer DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    -- Folded (20260709120000): draft lifecycle status.
    status text NOT NULL DEFAULT 'draft',
    -- Folded (20260723091000): Business KYB cache (required to operate the pooled Business Wallet).
    kyb_status finance.kyc_status NOT NULL DEFAULT 'unverified',
    kyb_verified_at timestamptz,
    kyb_provider_ref text,         -- Stripe Connect account id (placeholder; no PII)

    CONSTRAINT business_pkey PRIMARY KEY (id),
    CONSTRAINT business_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id),
    CONSTRAINT business_profiles_status_check CHECK (status IN ('draft', 'active', 'archived'))
);

CREATE TABLE org.teams (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    avatar_file_id uuid REFERENCES files.items(id) ON DELETE SET NULL,
    banner_file_id uuid REFERENCES files.items(id) ON DELETE SET NULL,
    headline text DEFAULT ''::text,
    bio jsonb NOT NULL DEFAULT '{}'::jsonb,
    visibility text NOT NULL DEFAULT 'invite_only'::text,
    subscription_tier text NOT NULL DEFAULT 'free'::text,
    member_limit int NOT NULL DEFAULT 5,
    payout_model text NOT NULL DEFAULT 'manager_discretion'::text,
    default_payout_settings jsonb DEFAULT '{}'::jsonb,
    treasury_wallet_id uuid,

    current_workload_intensity integer NOT NULL DEFAULT 0,
    available_since timestamp with time zone NOT NULL DEFAULT now(),
    rating_average numeric(3,2) DEFAULT 0.0,
    rating_count integer DEFAULT 0,
    active_project_count integer DEFAULT 0,
    total_project_count integer DEFAULT 0,
    service_count integer DEFAULT 0,
    product_count integer DEFAULT 0,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    -- Folded (20260709120000): draft lifecycle status.
    status text NOT NULL DEFAULT 'draft',

    CONSTRAINT teams_pkey PRIMARY KEY (id),
    CONSTRAINT teams_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id),
    CONSTRAINT teams_status_check CHECK (status IN ('draft', 'active', 'archived'))
);

CREATE TABLE org.business_roles (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    title text NOT NULL,
    -- One-line remit rendered under the role name in the matrix, the role picker and the invite
    -- preview. NOT NULL DEFAULT '' rather than nullable because every consumer renders it
    -- unconditionally: an unwritten summary is the empty string, never a null to branch on.
    summary text NOT NULL DEFAULT '',
    permissions org.business_permission[] NOT NULL DEFAULT '{}',
    -- Mirrors org.team_roles.is_system on the buyer side: a PRESET role is a read-only bundle the
    -- matrix refuses to edit (the escape hatch is "duplicate to a custom role"). The distinction has
    -- to be storable on both kinds or the one shared roles editor cannot enforce it symmetrically.
    is_system boolean NOT NULL DEFAULT false,

    CONSTRAINT business_roles_pkey PRIMARY KEY (id),
    CONSTRAINT business_roles_business_id_fkey FOREIGN KEY (business_id) REFERENCES org.business_profiles(id) ON DELETE CASCADE
);

CREATE TABLE org.business_members (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL DEFAULT 'member'::text,
    status text NOT NULL DEFAULT 'active'::text,
    -- Layer 3 of the three-layer permission model (preset role -> custom role -> per-member
    -- override). The effective set is `role union granted minus revoked`, so the two arrays are
    -- stored SEPARATELY rather than as one materialised result: the roster renders the PROVENANCE of
    -- an override ("+ granted" / "- revoked"), which a flattened set cannot reconstruct, and a later
    -- edit to the role must keep flowing through to members who never overrode anything themselves.
    granted_capabilities org.workspace_capability[] NOT NULL DEFAULT '{}',
    revoked_capabilities org.workspace_capability[] NOT NULL DEFAULT '{}',
    -- Short job title shown under the name on the roster card, the member table and the org-chart
    -- node. Per MEMBERSHIP, not per user: the same person is "Design lead" in one workspace and
    -- "Reviewer" in another, so it cannot live on org.users_public.
    title text,
    -- The org-chart edge. Self-referencing, NULL for a root. ON DELETE SET NULL so removing a
    -- manager re-roots their reports rather than cascading a whole subtree out of the workspace.
    -- Points at the MEMBERSHIP, not the user, so an edge cannot outlive the reporting party's seat.
    -- A FK cannot forbid a cycle; detecting one stays the application's job.
    reports_to uuid,
    joined_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT business_memberships_pkey PRIMARY KEY (id),
    CONSTRAINT business_memberships_business_id_fkey FOREIGN KEY (business_id) REFERENCES org.business_profiles(id),
    CONSTRAINT business_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
    CONSTRAINT business_memberships_reports_to_fkey FOREIGN KEY (reports_to) REFERENCES org.business_members(id) ON DELETE SET NULL,
    CONSTRAINT business_memberships_unique_user_per_business UNIQUE (business_id, user_id)
);

CREATE TABLE org.team_roles (
	id uuid NOT NULL DEFAULT gen_random_uuid(),
	team_id uuid NOT NULL REFERENCES org.teams (id) ON DELETE CASCADE,
	name text NOT NULL,
	-- One-line remit rendered under the role name in the matrix, the role picker and the invite
	-- preview. NOT NULL DEFAULT '' rather than nullable because every consumer renders it
	-- unconditionally: an unwritten summary is the empty string, never a null to branch on.
	summary text NOT NULL DEFAULT '',
	permissions org.team_permission[] NOT NULL DEFAULT '{}'::org.team_permission[],
	is_system boolean NOT NULL DEFAULT false,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	updated_at timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT team_roles_pkey PRIMARY KEY (id),
	CONSTRAINT unique_team_role_name UNIQUE (team_id, name)
);

CREATE TABLE org.team_members (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL DEFAULT 'member'::text,
    status text NOT NULL DEFAULT 'active'::text,
    default_split_share numeric(5,2),
    invited_by uuid,
    -- Layer 3 of the three-layer permission model. See the identical pair on org.business_members
    -- for why granted and revoked are kept apart instead of being flattened into one set; the
    -- capability vocabulary is shared across both kinds so the matrix, the union that resolves an
    -- effective set, and the server guard are each written once rather than per kind.
    granted_capabilities org.workspace_capability[] NOT NULL DEFAULT '{}',
    revoked_capabilities org.workspace_capability[] NOT NULL DEFAULT '{}',
    -- Short job title shown under the name on the roster card, the member table and the org-chart
    -- node. Per MEMBERSHIP, not per user: the same person holds a different title in each workspace.
    title text,
    -- The org-chart edge. Self-referencing, NULL for a root. ON DELETE SET NULL so removing a
    -- manager re-roots their reports rather than cascading a whole subtree out of the team. Points
    -- at the MEMBERSHIP, so an edge cannot outlive the reporting party's seat.
    reports_to uuid,
    joined_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT team_memberships_pkey PRIMARY KEY (id),
    CONSTRAINT team_memberships_team_id_fkey FOREIGN KEY (team_id) REFERENCES org.teams(id),
    CONSTRAINT team_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
    CONSTRAINT team_memberships_inviter_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id),
    CONSTRAINT team_memberships_reports_to_fkey FOREIGN KEY (reports_to) REFERENCES org.team_members(id) ON DELETE SET NULL,
    CONSTRAINT team_memberships_unique_user_per_team UNIQUE (team_id, user_id)
);

CREATE TABLE org.portfolios (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    cover_url text,
    attachment_id uuid,
    is_public boolean NOT NULL DEFAULT true,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        CONSTRAINT portfolios_pkey PRIMARY KEY (id),
        CONSTRAINT portfolios_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.freelancer_profiles (user_id) ON DELETE CASCADE
);

CREATE TABLE org.profile_links (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    profile_type text NOT NULL,
    profile_id uuid NOT NULL,
    kind text NOT NULL,
    url text NOT NULL,
    is_public boolean NOT NULL DEFAULT true,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        CONSTRAINT profile_links_pkey PRIMARY KEY (id)
);

CREATE TABLE org.user_skills (
    user_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    proficiency smallint,
    CONSTRAINT user_skills_pkey PRIMARY KEY (user_id, skill_id),
    CONSTRAINT user_skills_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id),
    CONSTRAINT user_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES org.skills (id)
);

CREATE TABLE org.user_bookmarks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    entity_type org.bookmark_entity_type NOT NULL,
    entity_id uuid NOT NULL,
    created_at timestamp
    with
        time zone DEFAULT now(),
        CONSTRAINT unique_user_bookmark UNIQUE (
            user_id,
            entity_type,
            entity_id
        )
);

-- #region Profile detail (structured tab entries + the public follow graph)
CREATE TABLE org.education_entries (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL,
    school text NOT NULL,
    credential text NOT NULL,
    field text NOT NULL,
    -- Years are text, not date or integer. A credential is stated as "2019", occasionally as a term
    -- or a range the holder writes themselves, and a date column would force a month and a day the
    -- profile never asks for and never renders -- a fabricated precision the reader would trust.
    start_year text NOT NULL,
    -- NULL = still studying; the entry renders with no end rather than a placeholder.
    end_year text,
    logo_file_id uuid REFERENCES files.items (id) ON DELETE SET NULL,
    -- Author-controlled ordering. Sorting by start_year alone cannot separate two credentials that
    -- began in the same year, and the list is a narrative the owner arranges, not a chronology.
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT education_entries_pkey PRIMARY KEY (id),
    CONSTRAINT education_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE CASCADE
);

CREATE TABLE org.experience_entries (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL,
    -- The employer as the owner wrote it. Free text, with no FK to org.business_profiles or
    -- org.organisations: most past employers are not Projective entities, and a nullable FK plus a
    -- fallback string would be two sources for one name that could disagree.
    org_name text NOT NULL,
    role text NOT NULL,
    start_year text NOT NULL,
    end_year text,
    -- Renders "Present". Kept as an explicit flag rather than inferred from end_year IS NULL because
    -- a role can be ongoing while the owner still records an end year for a fixed-term contract; the
    -- CHECK below makes the one incoherent combination -- current AND ended -- unrepresentable.
    is_current boolean NOT NULL DEFAULT false,
    -- NOT NULL DEFAULT '' rather than nullable: the card always renders this line, so an unwritten
    -- summary is the empty string and no consumer has to branch on a null.
    summary text NOT NULL DEFAULT '',
    logo_file_id uuid REFERENCES files.items (id) ON DELETE SET NULL,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT experience_entries_pkey PRIMARY KEY (id),
    CONSTRAINT experience_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    CONSTRAINT experience_entries_current_check CHECK (NOT is_current OR end_year IS NULL)
);

CREATE TABLE org.user_languages (
    user_id uuid NOT NULL,
    -- Short language code (EN, FR) -- the compact chip label. The full display name is derived from
    -- the code by the application, so it is deliberately NOT stored: two spellings of "French" that
    -- disagree is a worse failure than a lookup.
    code text NOT NULL,
    -- The proficiency ramp, which is the whole reason this table exists: org.users_public.languages
    -- is a text[] of codes and an array cannot pair a code with a level. The array is left in place
    -- because the search weighting engine and the profile views already read it as a match set.
    -- A CHECK rather than an enum: no language-level type exists yet and creating one belongs to the
    -- enums file, which this migration does not own.
    level text NOT NULL,
    CONSTRAINT user_languages_pkey PRIMARY KEY (user_id, code),
    CONSTRAINT user_languages_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    CONSTRAINT user_languages_level_check CHECK (
        level IN ('native', 'fluent', 'professional', 'conversational', 'basic')
    )
);

CREATE TABLE org.profile_follows (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    follower_user_id uuid NOT NULL,
    -- Polymorphic by entity kind, so no FK is possible on the target -- the same reason
    -- org.user_bookmarks carries a bare entity_id. Note the vocabulary is 'user', NOT the profile
    -- kinds 'client'/'freelancer': an individual is ONE row in org.users_public whichever way their
    -- profile renders, and a per-kind discriminator would let the same person be followed twice and
    -- counted twice. This is not org.user_bookmarks: a bookmark is a private saved item whose enum
    -- cannot express a client or an organisation, whereas a follow is a public, counted edge.
    target_entity_type text NOT NULL,
    target_entity_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profile_follows_pkey PRIMARY KEY (id),
    CONSTRAINT profile_follows_follower_fkey FOREIGN KEY (follower_user_id) REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    CONSTRAINT profile_follows_target_type_check CHECK (
        target_entity_type IN ('user', 'team', 'business', 'organisation')
    ),
    -- A user id can never collide with a team/business/organisation id, so this only ever blocks the
    -- one bad state it is aimed at: following yourself, which would inflate your own follower count.
    CONSTRAINT profile_follows_no_self_follow_check CHECK (target_entity_id <> follower_user_id),
    -- Following is idempotent: the control is a toggle, so a repeat press must not add an edge.
    CONSTRAINT profile_follows_unique UNIQUE (
        follower_user_id,
        target_entity_type,
        target_entity_id
    )
);
-- #endregion

CREATE TABLE org.org_invitations (
	id uuid NOT NULL DEFAULT gen_random_uuid(),
	inviter_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
	-- An invitation is addressed EITHER to an email (a stranger) or to an existing platform
	-- identity (the common case, since the invitee usually already has a handle). target_email is
	-- therefore nullable: keeping it NOT NULL would have forced a by-handle invitation to invent
	-- an address it does not know. target_handle is kept alongside target_user_id so the queue can
	-- still render who was invited after the account is gone, and so an invitation may be issued
	-- against a handle before it is resolved. org_invitations_target_identity_check below makes an
	-- invitation addressed to nobody unrepresentable.
	target_email text,
	target_handle text,
	target_user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
	team_id uuid REFERENCES org.teams (id) ON DELETE CASCADE,
	business_id uuid REFERENCES org.business_profiles (id) ON DELETE CASCADE,
	role_id uuid NOT NULL, /* Intentionally loosely coupled to support either team or business roles */
	token text NOT NULL UNIQUE,
	-- Free-text message from the sender, shown on the invite-queue row. Nullable because most
	-- invitations carry none, and an empty string would read on the row as an emptied note.
	note text,
	status text NOT NULL DEFAULT 'pending'::text,
	-- When the invitation stops being acceptable. NULL means it does not expire, which is a real
	-- state (a direct invitation) and not an unset value; a share link sets one. Lapsed rows are
	-- never deleted -- the queue keeps rendering them so they can be resent.
	expires_at timestamptz,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT org_invitations_pkey PRIMARY KEY (id),
	CONSTRAINT check_invitation_target CHECK (
		(team_id IS NOT NULL AND business_id IS NULL) OR
		(team_id IS NULL AND business_id IS NOT NULL)
	),
	CONSTRAINT org_invitations_target_identity_check CHECK (
		target_email IS NOT NULL OR target_handle IS NOT NULL OR target_user_id IS NOT NULL
	)
);

-- #region Organisations (0314_organisations.sql) — the client/buyer-only entity
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

CREATE TABLE org.organisation_members (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    organisation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role org.organisation_role NOT NULL DEFAULT 'member',
    status text NOT NULL DEFAULT 'active',
    -- Which departments this member sits in. An array rather than a child table because a member
    -- belongs to a handful of departments at most and every read wants all of them at once; and
    -- because the department CATALOGUE is itself org.organisations.departments text[], so a child
    -- table would give the assignment a stronger shape than the thing it points at. Multi-valued by
    -- product rule: a member in N departments renders under EACH of them in the grouped Members view
    -- and carries a multi-department badge, and DepartmentEntry.memberCount counts them in each.
    -- Values are names drawn from that parent array; PostgreSQL cannot FK an array element, so
    -- referential agreement is the application's job.
    departments text[] NOT NULL DEFAULT '{}'::text[],
    invited_by uuid,
    joined_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT organisation_members_pkey PRIMARY KEY (id),
    CONSTRAINT organisation_members_org_fkey FOREIGN KEY (organisation_id) REFERENCES org.organisations (id) ON DELETE CASCADE,
    CONSTRAINT organisation_members_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
    CONSTRAINT organisation_members_inviter_fkey FOREIGN KEY (invited_by) REFERENCES auth.users (id) ON DELETE SET NULL,
    CONSTRAINT organisation_members_unique UNIQUE (organisation_id, user_id)
);
-- #endregion

-- #region Earned Standing ladder (20260724111000_standing_reputation.sql)
CREATE TABLE org.standing_levels (
    level smallint PRIMARY KEY CHECK (level BETWEEN 1 AND 5),
    code text NOT NULL UNIQUE,
    label text NOT NULL,
    min_score numeric(5, 2) NOT NULL CHECK (min_score BETWEEN 0 AND 100),
    -- Volume floor: a flawless single engagement must not vault a subject to the top of the ladder.
    min_completed_stages integer NOT NULL DEFAULT 0 CHECK (min_completed_stages >= 0),
    -- Earned footprint: the published-listing allowance a FREE subject enjoys at this rung.
    listing_base integer NOT NULL DEFAULT 10 CHECK (listing_base >= 0),
    -- Earned distribution: extra weekly proposals on top of the plan's base allowance.
    proposal_bonus integer NOT NULL DEFAULT 0 CHECK (proposal_bonus >= 0),
    -- Discovery ranking multiplier in basis points (10000 = 1.0x). Feeds the search weighting engine.
    discovery_weight_bp integer NOT NULL DEFAULT 10000 CHECK (discovery_weight_bp >= 0),
    description text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org.entity_standing (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type org.standing_subject NOT NULL,
    subject_id uuid NOT NULL,
    level smallint NOT NULL DEFAULT 1 REFERENCES org.standing_levels (level),
    score numeric(5, 2) NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
    -- Inputs (all 0..1 rates unless noted)
    stages_completed integer NOT NULL DEFAULT 0 CHECK (stages_completed >= 0),
    completion_rate numeric(5, 4) NOT NULL DEFAULT 0 CHECK (completion_rate BETWEEN 0 AND 1),
    on_time_rate numeric(5, 4) NOT NULL DEFAULT 0 CHECK (on_time_rate BETWEEN 0 AND 1),
    -- Dual-track reviews (PRODUCT_SPEC.md §Reciprocal Reviews): what clients say, and what peers say.
    client_rating_avg numeric(3, 2) NOT NULL DEFAULT 0 CHECK (client_rating_avg BETWEEN 0 AND 5),
    peer_rating_avg numeric(3, 2) NOT NULL DEFAULT 0 CHECK (peer_rating_avg BETWEEN 0 AND 5),
    dispute_rate numeric(5, 4) NOT NULL DEFAULT 0 CHECK (dispute_rate BETWEEN 0 AND 1),
    -- Delivering at capacity without dropping tickets — the $W_i$ reliability signal.
    workload_reliability numeric(5, 4) NOT NULL DEFAULT 0 CHECK (workload_reliability BETWEEN 0 AND 1),
    tenure_days integer NOT NULL DEFAULT 0 CHECK (tenure_days >= 0),
    -- Active penalty severity subtracted at recompute (security.penalties aggregate).
    penalty_severity numeric(6, 2) NOT NULL DEFAULT 0,
    -- Per-component contribution, for the "why am I this rung" profile surface.
    components jsonb NOT NULL DEFAULT '{}'::jsonb,
    level_changed_at timestamptz,
    computed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_entity_standing UNIQUE (subject_type, subject_id)
);

CREATE TABLE org.standing_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type org.standing_subject NOT NULL,
    subject_id uuid NOT NULL,
    event_type text NOT NULL CHECK (event_type IN ('recomputed', 'promoted', 'demoted', 'penalty_applied', 'manual_review')),
    from_level smallint,
    to_level smallint,
    score numeric(5, 2),
    components jsonb NOT NULL DEFAULT '{}'::jsonb,
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org.create_mastery (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type org.standing_subject NOT NULL,
    subject_id uuid NOT NULL,
    category org.create_category NOT NULL,
    stages_completed integer NOT NULL DEFAULT 0 CHECK (stages_completed >= 0),
    -- Weighted by $W_i$, so a hard Create stage counts for more than a trivial one.
    intensity_delivered numeric(10, 2) NOT NULL DEFAULT 0 CHECK (intensity_delivered >= 0),
    on_time_rate numeric(5, 4) NOT NULL DEFAULT 0 CHECK (on_time_rate BETWEEN 0 AND 1),
    share_bp integer NOT NULL DEFAULT 0 CHECK (share_bp BETWEEN 0 AND 10000),
    mastery_level smallint NOT NULL DEFAULT 0 CHECK (mastery_level BETWEEN 0 AND 5),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_create_mastery UNIQUE (subject_type, subject_id, category)
);

CREATE TABLE org.achievements (
    code text PRIMARY KEY,
    label text NOT NULL,
    description text NOT NULL,
    tier org.achievement_tier NOT NULL DEFAULT 'milestone',
    category org.create_category,                  -- NULL = not CREATE-specific
    -- Client-visible on the public profile? A reward a client would not respect must not be shown.
    is_public boolean NOT NULL DEFAULT true,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org.entity_achievements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type org.standing_subject NOT NULL,
    subject_id uuid NOT NULL,
    achievement_code text NOT NULL REFERENCES org.achievements (code) ON DELETE CASCADE,
    awarded_at timestamptz NOT NULL DEFAULT now(),
    source_ref uuid,                               -- the escrow / review / stage that triggered it
    CONSTRAINT uq_entity_achievement UNIQUE (subject_type, subject_id, achievement_code)
);

CREATE TABLE org.quality_streaks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type org.standing_subject NOT NULL,
    subject_id uuid NOT NULL,
    kind org.streak_kind NOT NULL,
    current_count integer NOT NULL DEFAULT 0 CHECK (current_count >= 0),
    best_count integer NOT NULL DEFAULT 0 CHECK (best_count >= 0),
    last_event_at timestamptz,
    broken_at timestamptz,
    CONSTRAINT uq_quality_streak UNIQUE (subject_type, subject_id, kind)
);
-- #endregion
