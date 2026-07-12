CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE org.bookmark_entity_type AS ENUM ('project', 'service_blueprint', 'freelancer', 'business', 'team');

CREATE TYPE org.team_permission AS ENUM (
	'manage_profile',
	'manage_portfolio',
	'manage_members',
	'manage_roles',
	'manage_services',
	'manage_projects',
	'send_messages',
	'manage_finances'
);

CREATE TYPE org.business_permission AS ENUM (
	'manage_profile',
	'manage_members',
	'manage_roles',
	'manage_hiring',
	'manage_projects',
	'manage_billing',
	'manage_escrow'
);

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
    billing_email text NOT NULL,
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
    
    CONSTRAINT business_pkey PRIMARY KEY (id),
    CONSTRAINT business_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id)
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
    
    CONSTRAINT teams_pkey PRIMARY KEY (id),
    CONSTRAINT teams_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id)
);


CREATE TABLE org.business_roles (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    title text NOT NULL, 
    permissions org.business_permission[] NOT NULL DEFAULT '{}', 
    
    CONSTRAINT business_roles_pkey PRIMARY KEY (id),
    CONSTRAINT business_roles_business_id_fkey FOREIGN KEY (business_id) REFERENCES org.business_profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_business_roles_business ON org.business_roles (business_id);

CREATE TABLE org.business_members (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL DEFAULT 'member'::text, 
    status text NOT NULL DEFAULT 'active'::text, 
    joined_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT business_memberships_pkey PRIMARY KEY (id),
    CONSTRAINT business_memberships_business_id_fkey FOREIGN KEY (business_id) REFERENCES org.business_profiles(id),
    CONSTRAINT business_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
    CONSTRAINT business_memberships_unique_user_per_business UNIQUE (business_id, user_id) 
);

CREATE INDEX idx_business_members_user ON org.business_members (user_id);

CREATE TABLE org.team_roles (
	id uuid NOT NULL DEFAULT gen_random_uuid(),
	team_id uuid NOT NULL REFERENCES org.teams (id) ON DELETE CASCADE,
	name text NOT NULL,
	permissions org.team_permission[] NOT NULL DEFAULT '{}'::org.team_permission[],
	is_system boolean NOT NULL DEFAULT false,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	updated_at timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT team_roles_pkey PRIMARY KEY (id),
	CONSTRAINT unique_team_role_name UNIQUE (team_id, name)
);

CREATE INDEX idx_team_roles_team ON org.team_roles (team_id);

CREATE TABLE org.team_members (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL DEFAULT 'member'::text, 
    status text NOT NULL DEFAULT 'active'::text, 
    default_split_share numeric(5,2), 
    invited_by uuid, 
    joined_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT team_memberships_pkey PRIMARY KEY (id),
    CONSTRAINT team_memberships_team_id_fkey FOREIGN KEY (team_id) REFERENCES org.teams(id),
    CONSTRAINT team_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
    CONSTRAINT team_memberships_inviter_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id),
    CONSTRAINT team_memberships_unique_user_per_team UNIQUE (team_id, user_id) 
);

CREATE INDEX idx_team_members_user ON org.team_members (user_id);

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

CREATE INDEX idx_user_bookmarks_lookup ON org.user_bookmarks (user_id, entity_type);

CREATE TABLE org.org_invitations (
	id uuid NOT NULL DEFAULT gen_random_uuid(),
	inviter_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
	target_email text NOT NULL,
	team_id uuid REFERENCES org.teams (id) ON DELETE CASCADE,
	business_id uuid REFERENCES org.business_profiles (id) ON DELETE CASCADE,
	role_id uuid NOT NULL, /* Intentionally loosely coupled to support either team or business roles */
	token text NOT NULL UNIQUE,
	status text NOT NULL DEFAULT 'pending'::text,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT org_invitations_pkey PRIMARY KEY (id),
	CONSTRAINT check_invitation_target CHECK (
		(team_id IS NOT NULL AND business_id IS NULL) OR 
		(team_id IS NULL AND business_id IS NOT NULL)
	)
);

CREATE INDEX idx_org_invitations_token ON org.org_invitations (token);