-- =============================================================================================
-- 00000003_enums_core.sql — Consolidated ENUM types, part 1 (Category 0).
-- public / org / projects / marketplace / search / reviews enums, gathered and deduplicated.
-- `ALTER TYPE ... ADD VALUE` folded inline:
--   * stage_status                          += 'cancelled'  (from 0305_stage_funding_payout.sql)
--   * projects.application_target_type       += 'seat'       (from 0306_staffing_enums.sql)
-- Sources: 0000_init_enums.sql, 0003_org_tables.sql, 0006_marketplace_tables.sql,
--          0007_projects_tables.sql, 0010_search_tables.sql, 0011_reviews_tables.sql,
--          0310_ticket_automation_engine.sql, 0314_organisations.sql,
--          20260723090000_finance_currency_fx.sql (org.layout_direction),
--          20260724111000_standing_reputation.sql (org standing enums).
-- =============================================================================================

-- #region public
CREATE TYPE profile_type AS ENUM ('freelancer', 'business');

CREATE TYPE assignment_type AS ENUM ('freelancer', 'team');

CREATE TYPE visibility AS ENUM ('public', 'invite_only', 'unlisted');

-- `archived` is the SOFT-DELETE terminal state. Nothing on this platform is hard-deleted (root
-- CLAUDE.md §7), so a draft the client abandons — or one the 30-day sweep
-- (`projects.fn_archive_stale_service_drafts`) reclaims — moves here rather than being removed. It is
-- deliberately distinct from `cancelled`, which records a decision somebody made about live work;
-- `archived` records that nothing ever happened.
CREATE TYPE project_status AS ENUM ('draft', 'active', 'on_hold', 'completed', 'cancelled', 'archived');

-- Folded: 0305 ALTER TYPE stage_status ADD VALUE 'cancelled'.
CREATE TYPE stage_status AS ENUM ('open','assigned','in_progress','submitted','approved','revisions','paid','cancelled');

CREATE TYPE dispute_status AS ENUM ('open', 'under_review', 'resolved', 'refunded');

CREATE TYPE public.timeline_preset AS ENUM ('sequential', 'simultaneous', 'staggered', 'custom');

CREATE TYPE public.ip_option_mode AS ENUM ('exclusive_transfer', 'licensed_use', 'shared_ownership', 'projective_partner');

CREATE TYPE public.portfolio_rights AS ENUM ('allowed', 'forbidden', 'embargoed');

CREATE TYPE public.budget_type AS ENUM ('fixed_price', 'hourly_cap');

CREATE TYPE public.start_trigger_type AS ENUM ('fixed_date', 'on_project_start', 'on_hire_confirmed', 'dependent_on_stage');
-- #endregion

-- #region org
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

CREATE TYPE org.organisation_role AS ENUM ('owner', 'admin', 'member');

CREATE TYPE org.employee_scale AS ENUM ('1-50', '51-200', '201-500', '500+');

CREATE TYPE org.organisation_status AS ENUM ('draft', 'active', 'suspended', 'archived');

CREATE TYPE org.organisation_verification_level AS ENUM (
    'unverified',
    'email_verified',
    'kyb_pending',
    'verified'
);

CREATE TYPE org.layout_direction AS ENUM ('ltr', 'rtl', 'auto');

CREATE TYPE org.standing_subject AS ENUM ('user', 'freelancer', 'team');

CREATE TYPE org.create_category AS ENUM ('create', 'run', 'educate', 'advise', 'test', 'empower');

CREATE TYPE org.streak_kind AS ENUM ('on_time_delivery', 'fast_response', 'dispute_free', 'client_repeat');

CREATE TYPE org.achievement_tier AS ENUM ('milestone', 'bronze', 'silver', 'gold', 'designation');
-- #endregion

-- #region projects
CREATE TYPE project_format AS ENUM ('one_off', 'pipeline', 'session');

CREATE TYPE ticket_status AS ENUM ('backlog', 'todo', 'claimed', 'in_progress', 'in_review', 'completed', 'cancelled', 'reported_hidden');

CREATE TYPE payment_status AS ENUM ('unpaid', 'escrow_funded', 'partially_released', 'released', 'refunded');

CREATE TYPE projects.structure_variation AS ENUM ('standard', 'one_off', 'single_task', 'single_stage');

CREATE TYPE projects.workload_report_status AS ENUM ('open', 'acknowledged', 'adjusted', 'expired_penalized', 'dismissed_bad_faith');

CREATE TYPE projects.cohort_status AS ENUM ('enrolling', 'active', 'completed', 'cancelled');

CREATE TYPE projects.session_event_status AS ENUM ('scheduled', 'completed', 'cancelled_by_freelancer', 'cancelled_by_client');

CREATE TYPE projects.waitlist_status AS ENUM ('waiting', 'invited', 'expired', 'converted');

CREATE TYPE projects.application_status AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');

-- Folded: 0306 ALTER TYPE projects.application_target_type ADD VALUE 'seat'.
CREATE TYPE projects.application_target_type AS ENUM ('stage', 'role', 'seat');

CREATE TYPE projects.assignment_routing_mode AS ENUM ('open_pull', 'round_robin', 'manual', 'parallel_stream');
-- #endregion

-- #region marketplace
CREATE TYPE marketplace.pricing_model AS ENUM ('flat_fee', 'per_seat', 'recurring_retainer');
-- #endregion

-- #region search
CREATE TYPE search.profile_entity_type AS ENUM ('user', 'freelancer', 'business', 'team');
-- #endregion

-- #region reviews
CREATE TYPE reviews.review_target_type AS ENUM ('user', 'freelancer', 'business', 'team', 'service_blueprint');
-- #endregion
