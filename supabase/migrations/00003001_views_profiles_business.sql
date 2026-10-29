-- Views: org profiles index + business staff (from 0301, 0302)

-- The staff of the businesses the CALLER belongs to. security_invoker (2026-09-28): as a definer view
-- it read past every policy and handed any signed-in user every business member's primary email;
-- under the caller's own rights the roster is their own businesses' (org.business_members policy) and
-- an email is only ever their own (org.user_emails policy).
CREATE OR REPLACE VIEW org.view_business_staff
WITH (security_invoker = true) AS
SELECT
    bm.business_id,
    bm.user_id,
    bm.role as membership_role,
    bm.status,
    bm.joined_at,
    up.first_name,
    up.last_name,
    up.username,
    up.avatar_file_id,
    ue.email
FROM org.business_members bm
    JOIN org.users_public up ON up.user_id = bm.user_id
    LEFT JOIN org.user_emails ue ON ue.user_id = bm.user_id
    AND ue.is_primary = true;

-- THE PUBLIC PROFILE DIRECTORY — every card, owner attribution and profile header a visitor sees.
--
-- A view rather than a policy set, deliberately: the underlying tables hold far more than a visitor
-- may read (`users_public.dob`, a business's tax id and billing email, a team's payout model), and RLS
-- is ROW-level — a policy that lets a visitor see a user's row lets them see every column on it. This
-- view is the column-level answer: it runs as its owner, so it reads past those tables' policies, and
-- it projects ONLY the public facts. It is the one door the discovery and profile surfaces use.
--
-- Visibility is the view's own job for the same reason. `public` rows are LISTED (discovery ranks and
-- shows them); `unlisted` rows resolve by handle — the profile page — but are never listed. Anything
-- else (a suspended team, a closed business) is absent entirely. `listed` carries that distinction so
-- a reader filters on one column instead of re-deriving the rule. Before 2026-09-22 the view carried
-- no filter at all, so every account on the platform — unlisted included — was in the directory.
--
-- Image columns project the storage BUCKET and PATH, never a URL: the URL is a deployment fact (the
-- public storage host), built once in `packages/backend/core/storage-url.ts`. Only files that are
-- themselves `public` project a path, so an avatar pointed at a private object renders as absent
-- rather than as a path a visitor cannot load.
--
-- The earned Standing rung (`standing_level` / `standing_label`) is a public fact of a SELLER — the
-- listing, the card and the profile header print it — but `org.entity_standing` is readable only by a
-- signed-in caller, so a guest could never see it through the table. It is projected here, under the
-- same rule as `org.get_public_profile`: a seller with no computed row yet reads as level 1 ("New"),
-- the rung every seller starts on, and a buyer-only entity carries none at all.
--
-- The verification crest (`verification_stamp`, Decision #155) is projected under the SAME rule as
-- `org.get_profile_view`: a person's stored `org.entity_standing.verification_stamp` (read whether or
-- not they sell — the stamp is an identity fact), a business's `corporate_verified` from its own KYB,
-- and none for a team. A card, a review byline and a listing's seller line therefore draw the crest
-- the owner's profile hero draws, instead of guessing one from `verified` and the kind.
--
-- Columns are APPENDED after the original set, never reordered: `CREATE OR REPLACE VIEW` may only add
-- trailing columns, so reordering would make this file unappliable over a database that already has
-- the view.
CREATE OR REPLACE VIEW org.profiles_index AS
-- 1. USERS & FREELANCERS
SELECT
    u.user_id as entity_id,
    CASE
        WHEN u.is_freelancer THEN 'freelancer'::text
        ELSE 'user'::text
    END as entity_type,
    u.username as handle,
    trim(u.first_name || ' ' || COALESCE(u.last_name, '')) as name,
    u.avatar_file_id,
    u.banner_file_id,
    u.headline,
    u.bio,
    u.languages,
    -- A minor's location and local time are never broadcast (Decision #208). The rule is
    -- org.fn_is_minor's, spelled out: a view's function calls are checked against the READER, and
    -- fn_is_minor stays ungranted so no client can ask it about an arbitrary user id. The pure
    -- date helpers it is built from are granted to both client roles (00002510).
    CASE WHEN org.fn_age_years(u.dob, u.timezone) < 18 THEN NULL ELSE u.timezone END as timezone,
    CASE WHEN org.fn_age_years(u.dob, u.timezone) < 18 THEN NULL ELSE u.country END as location,

-- Split Ratings
u.rating_average as rating_as_client,
u.rating_count as reviews_as_client,
COALESCE(f.rating_average, 0.0) as rating_as_freelancer,
COALESCE(f.rating_count, 0) as reviews_as_freelancer,

-- Counter Stats
u.active_project_count,
    u.total_project_count,
    u.service_count,
    u.product_count,
    (SELECT COUNT(*)::int FROM org.portfolios p WHERE p.user_id = u.user_id) as portfolio_count,
    (SELECT COUNT(*)::int FROM org.team_members tm WHERE tm.user_id = u.user_id AND tm.status = 'active') as team_count,
    (SELECT COUNT(*)::int FROM org.business_members bm WHERE bm.user_id = u.user_id AND bm.status = 'active') as business_count,
    0 as member_count,

-- Public directory facts (appended)
    u.visibility = 'public' as listed,
    CASE WHEN org.fn_age_years(u.dob, u.timezone) < 18 THEN NULL ELSE u.city END as city,
    fa.bucket_id as avatar_bucket,
    fa.storage_path as avatar_path,
    fb.bucket_id as banner_bucket,
    fb.storage_path as banner_path,
    COALESCE(f.kyc_status = 'verified'::finance.kyc_status, false) as verified,
    COALESCE(f.skills, '{}'::text[]) as skills,
    COALESCE(f.current_workload_intensity, 0) as workload,
    u.created_at as joined_at,
    -- The attained verification level (1-3, the `VerificationTier` ladder), and only once verified:
    -- a tier recorded against a pending or failed check is not a tier the person holds.
    CASE WHEN f.kyc_status = 'verified'::finance.kyc_status THEN f.kyc_tier::int ELSE NULL END as verification_tier,
    -- Language CODES (`EN`, `FR`), strongest first — what a card prints. `users_public.languages`
    -- holds display names and carries no level; `org.user_languages` is the proficiency record.
    COALESCE((
        SELECT array_agg(upper(ul.code) ORDER BY array_position(
            ARRAY['native', 'fluent', 'professional', 'conversational', 'basic'], ul.level::text
        ), ul.code)
        FROM org.user_languages ul
        WHERE ul.user_id = u.user_id
    ), '{}'::text[]) as language_codes,
    -- Stages this person has DELIVERED — a completed assignment, not a project they happen to own.
    (SELECT COUNT(*)::int FROM projects.stage_assignments sa
      WHERE sa.freelancer_profile_id = u.user_id AND sa.status = 'completed') as delivered_count,
    -- Showcase slot 1 — the profile's primary thumbnail, which every card of it leads with. A slot
    -- only ever holds a public showcase RENDITION (org.save_showcase), and a live one is re-checked
    -- here so a retired rendition can never become a card's picture.
    fs.bucket_id as showcase_bucket,
    fs.storage_path as showcase_path,
    -- A freelancer's earned rung; NULL for a buyer-only account, which has no seller standing.
    sl.level as standing_level,
    sl.label::text as standing_label,
    -- The rung's discovery multiplier, which scales a seller's discovery score
    -- (packages/backend/services/explore/ranking.ts). NULL for a buyer.
    sl.discovery_weight_bp,
    -- The Global Intensity Cap `workload` is measured against: the person's own override, else the
    -- platform default (security.platform_params, which only this owner-run view can read for a
    -- guest). At the cap a seller's ranking is temporarily lowered. NULL for a buyer.
    CASE WHEN u.is_freelancer THEN COALESCE(
        f.max_workload_intensity,
        (SELECT (pp.value #>> '{}')::numeric FROM security.platform_params pp
          WHERE pp.key = 'global_workload_cap_default'),
        10.00
    ) END::numeric as workload_cap,
    COALESCE((
        SELECT es_v.verification_stamp FROM org.entity_standing es_v
        WHERE es_v.subject_type = 'freelancer'::org.standing_subject AND es_v.subject_id = u.user_id
    ), 'none') as verification_stamp
FROM org.users_public u
    LEFT JOIN org.freelancer_profiles f ON u.user_id = f.user_id
    LEFT JOIN org.entity_standing es ON u.is_freelancer
        AND es.subject_type = 'freelancer'::org.standing_subject AND es.subject_id = u.user_id
    LEFT JOIN org.standing_levels sl ON u.is_freelancer AND sl.level = COALESCE(es.level, 1)
    LEFT JOIN files.items fa ON fa.id = u.avatar_file_id AND fa.visibility = 'public' AND fa.deleted_at IS NULL
    LEFT JOIN files.items fb ON fb.id = u.banner_file_id AND fb.visibility = 'public' AND fb.deleted_at IS NULL
    LEFT JOIN org.profile_showcase_items si ON si.owner_type = 'user' AND si.owner_id = u.user_id AND si.position = 1
    LEFT JOIN files.items fs ON fs.id = si.file_id AND fs.visibility = 'public' AND fs.deleted_at IS NULL
WHERE u.visibility IN ('public', 'unlisted')

UNION ALL

-- 2. BUSINESSES
SELECT
    b.id as entity_id,
    'business'::text as entity_type,
    b.slug as handle,
    b.name,
    b.logo_file_id as avatar_file_id,
    b.banner_file_id,
    b.headline,
    b.bio,
    b.languages,
    b.timezone,
    b.country as location,

-- Split Ratings
b.rating_average as rating_as_client,
b.rating_count as reviews_as_client,
0.0 as rating_as_freelancer,
0 as reviews_as_freelancer,

-- Counter Stats
b.active_project_count,
    b.total_project_count,
    b.service_count,
    b.product_count,
    0 as portfolio_count,
    0 as team_count,
    0 as business_count,
    (SELECT COUNT(*)::int FROM org.business_members bm WHERE bm.business_id = b.id AND bm.status = 'active') as member_count,

-- Public directory facts (appended)
    b.visibility = 'public' as listed,
    b.address_city as city,
    fa.bucket_id as avatar_bucket,
    fa.storage_path as avatar_path,
    fb.bucket_id as banner_bucket,
    fb.storage_path as banner_path,
    COALESCE(b.kyb_status = 'verified'::finance.kyc_status, false) as verified,
    '{}'::text[] as skills,
    0 as workload,
    b.created_at as joined_at,
    -- A verified business has passed KYB, which is Level 3 on the verification ladder.
    CASE WHEN b.kyb_status = 'verified'::finance.kyc_status THEN 3 ELSE NULL END as verification_tier,
    -- `business_profiles.languages` holds display names with no proficiency and no code, so there is
    -- no code to project; guessing one from a name ("Portuguese" is `PT`, not `PO`) would print a
    -- language the business never stated.
    '{}'::text[] as language_codes,
    -- A business buys; it has no delivered work of its own.
    0 as delivered_count,
    fs.bucket_id as showcase_bucket,
    fs.storage_path as showcase_path,
    -- A business buys, so it has no seller standing.
    NULL::smallint as standing_level,
    NULL::text as standing_label,
    NULL::integer as discovery_weight_bp,
    NULL::numeric as workload_cap,
    CASE WHEN b.kyb_status = 'verified'::finance.kyc_status
        THEN 'corporate_verified' ELSE 'none' END as verification_stamp
FROM org.business_profiles b
    LEFT JOIN files.items fa ON fa.id = b.logo_file_id AND fa.visibility = 'public' AND fa.deleted_at IS NULL
    LEFT JOIN files.items fb ON fb.id = b.banner_file_id AND fb.visibility = 'public' AND fb.deleted_at IS NULL
    LEFT JOIN org.profile_showcase_items si ON si.owner_type = 'business' AND si.owner_id = b.id AND si.position = 1
    LEFT JOIN files.items fs ON fs.id = si.file_id AND fs.visibility = 'public' AND fs.deleted_at IS NULL
-- A business is in the directory only once published, and only as its owner chose (Decision #230 (h)):
-- `public` listed, `unlisted` by handle only, `invite_only` absent.
WHERE b.status = 'active' AND b.visibility IN ('public', 'unlisted')

UNION ALL

-- 3. TEAMS
SELECT
    t.id as entity_id,
    'team'::text as entity_type,
    t.slug as handle,
    t.name,
    t.avatar_file_id,
    t.banner_file_id,
    t.headline,
    t.bio,
    '{}'::text[] as languages,
    NULL as timezone,
    NULL as location,

-- Split Ratings
0.0 as rating_as_client,
0 as reviews_as_client,
t.rating_average as rating_as_freelancer,
t.rating_count as reviews_as_freelancer,

-- Counter Stats
t.active_project_count,
    t.total_project_count,
    t.service_count,
    t.product_count,
    0 as portfolio_count, -- Requires org.portfolios schema update to support team_id later
    0 as team_count,
    0 as business_count,
    (SELECT COUNT(*)::int FROM org.team_members tm WHERE tm.team_id = t.id AND tm.status = 'active') as member_count,

-- Public directory facts (appended)
    t.visibility = 'public' as listed,
    NULL::text as city,
    fa.bucket_id as avatar_bucket,
    fa.storage_path as avatar_path,
    fb.bucket_id as banner_bucket,
    fb.storage_path as banner_path,
    false as verified,
    '{}'::text[] as skills,
    -- A team's load is its active members' LIVE W_i — every claimed / in-progress / in-review ticket
    -- they hold, summed as projects.check_ticket_capacity sums it (Decision #233, #226 (h)). The stored
    -- org.teams.current_workload_intensity has no writer and is not read.
    COALESCE((
        SELECT round(sum(tk.workload_intensity))::int
          FROM org.team_members tm
          JOIN projects.tickets tk ON tk.current_assignee_id = tm.user_id
                                  AND tk.status::text IN ('claimed', 'in_progress', 'in_review', 'reported_hidden')
         WHERE tm.team_id = t.id AND tm.status = 'active'
    ), 0) as workload,
    t.created_at as joined_at,
    NULL::int as verification_tier,
    '{}'::text[] as language_codes,
    (SELECT COUNT(*)::int FROM projects.stage_assignments sa
      WHERE sa.team_id = t.id AND sa.status = 'completed') as delivered_count,
    fs.bucket_id as showcase_bucket,
    fs.storage_path as showcase_path,
    sl.level as standing_level,
    sl.label::text as standing_label,
    sl.discovery_weight_bp,
    -- The W_i cap is per PERSON (projects.check_ticket_capacity), so a team's ceiling is its active
    -- members' own caps combined: each member's override, else the platform default.
    COALESCE((
        SELECT sum(COALESCE(
            fp.max_workload_intensity,
            (SELECT (pp.value #>> '{}')::numeric FROM security.platform_params pp
              WHERE pp.key = 'global_workload_cap_default'),
            10.00))
          FROM org.team_members tm
          LEFT JOIN org.freelancer_profiles fp ON fp.user_id = tm.user_id
         WHERE tm.team_id = t.id AND tm.status = 'active'
    ), COALESCE(
        (SELECT (pp.value #>> '{}')::numeric FROM security.platform_params pp
          WHERE pp.key = 'global_workload_cap_default'),
        10.00))::numeric as workload_cap,
    -- A team holds no verification of its own; its members' crests are their own.
    'none'::text as verification_stamp
FROM org.teams t
    LEFT JOIN org.entity_standing es ON es.subject_type = 'team'::org.standing_subject AND es.subject_id = t.id
    LEFT JOIN org.standing_levels sl ON sl.level = COALESCE(es.level, 1)
    LEFT JOIN files.items fa ON fa.id = t.avatar_file_id AND fa.visibility = 'public' AND fa.deleted_at IS NULL
    LEFT JOIN files.items fb ON fb.id = t.banner_file_id AND fb.visibility = 'public' AND fb.deleted_at IS NULL
    LEFT JOIN org.profile_showcase_items si ON si.owner_type = 'team' AND si.owner_id = t.id AND si.position = 1
    LEFT JOIN files.items fs ON fs.id = si.file_id AND fs.visibility = 'public' AND fs.deleted_at IS NULL
WHERE t.status = 'active' AND t.visibility IN ('public', 'unlisted');
