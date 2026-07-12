DO $$ BEGIN
    CREATE TYPE profile_type AS ENUM ('freelancer', 'business');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE assignment_type AS ENUM ('freelancer', 'team');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE visibility AS ENUM ('public', 'invite_only', 'unlisted');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE project_status AS ENUM ('draft', 'active', 'on_hold', 'completed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE stage_status AS ENUM ('open','assigned','in_progress','submitted','approved','revisions','paid');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE dispute_status AS ENUM ('open', 'under_review', 'resolved', 'refunded');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.timeline_preset AS ENUM ('sequential', 'simultaneous', 'staggered', 'custom');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.ip_option_mode AS ENUM ('exclusive_transfer', 'licensed_use', 'shared_ownership', 'projective_partner');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.portfolio_rights AS ENUM ('allowed', 'forbidden', 'embargoed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.budget_type AS ENUM ('fixed_price', 'hourly_cap');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.start_trigger_type AS ENUM ('fixed_date', 'on_project_start', 'on_hire_confirmed', 'dependent_on_stage');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;