-- =============================================================================
-- RLS POLICIES — org schema (users, teams, businesses, organisations, profiles, skills, preferences)
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0203_users.sql ---

CREATE POLICY "Any authenticated user can view public profiles" ON org.users_public FOR
SELECT TO public USING (
        auth.role () = 'authenticated'
    );

-- NO client INSERT or UPDATE policy on org.users_public, deliberately (2026-09-22). The row carries
-- the handful of fields an owner edits (name, headline, story, location, visibility) beside columns
-- nobody may set about themselves — `rating_average`/`rating_count`, the project counters,
-- `is_freelancer`/`is_operator`/`has_team`/`has_business`, `dob` — and a row-level policy cannot
-- tell one column from another: "Users can update their own profile" let any signed-in user PATCH
-- their own rating to 5.00 over PostgREST. Every legitimate writer is already a SECURITY DEFINER
-- function (provision_user_profile / complete_onboarding / enable_freelancer_profile /
-- set_operator_mode / create_team / create_business, the rating and counter triggers), and profile
-- edits go through org.save_profile, which names every column it touches. With no write policy the
-- table is default-deny to a client, which is the whole point.

CREATE POLICY "Users can view their own emails" ON org.user_emails FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR security.is_admin ()
    );

CREATE POLICY "Users can add their own emails" ON org.user_emails FOR
INSERT
    TO public
WITH
    CHECK (
        user_id = auth.uid ()
        OR security.is_admin ()
    );

CREATE POLICY "Users can update their own emails" ON org.user_emails FOR
UPDATE TO public USING (
    user_id = auth.uid ()
    OR security.is_admin ()
);

CREATE POLICY "Users can delete their own emails" ON org.user_emails FOR DELETE TO public USING (
    user_id = auth.uid ()
    OR security.is_admin ()
);


-- --- from 0204_projects.sql ---

CREATE POLICY "Users manage own bookmarks" ON org.user_bookmarks FOR ALL TO public USING (user_id = auth.uid ());


-- --- from 0209_teams.sql ---

CREATE POLICY "Users can view teams they belong to or own" ON org.teams FOR
SELECT TO public USING (
        owner_user_id = auth.uid ()
        OR org.is_active_team_member (id)
        OR security.is_admin ()
    );

-- NO client INSERT policy on org.teams (2026-09-23). A team is created by org.create_team (definer),
-- which also opens its treasury wallet; a raw client INSERT skipped that and could set
-- `subscription_tier`, `member_limit` and `treasury_wallet_id` at birth, where the UPDATE-only
-- immutability guard (00001895) cannot reach.

CREATE POLICY "Team owners can update their teams" ON org.teams FOR
UPDATE TO public USING (
    owner_user_id = auth.uid ()
    OR security.is_admin ()
);

CREATE POLICY "Team owners can delete their teams" ON org.teams FOR DELETE TO public USING (
    owner_user_id = auth.uid ()
    OR security.is_admin ()
);


-- --- from 0210_freelancers.sql ---

CREATE POLICY "Users can view their own freelancer profile" ON org.freelancer_profiles FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR security.is_admin ()
    );

-- NO client INSERT or UPDATE policy here either, for the org.users_public reason and with higher
-- stakes: this row holds `kyc_status`, `kyc_tier`, `payout_ready` and `max_workload_intensity` —
-- the payout-readiness gate and the capacity cap — beside the one field an owner edits (`skills`,
-- written through org.save_profile). The old UPDATE policy let a freelancer mark themselves
-- KYC-verified and payout-ready over PostgREST. The row is created by enable_freelancer_profile /
-- provision_user_profile (definers) and maintained by definer triggers.


-- --- from 0211_business.sql ---

CREATE POLICY "Members can view business roster" ON org.business_members FOR
SELECT TO authenticated USING (
        org.is_active_business_member (business_id)
        OR security.is_admin ()
    );

CREATE POLICY "Owners can manage members" ON org.business_members FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM org.business_profiles
        WHERE
            id = business_id
            AND owner_user_id = auth.uid ()
    )
    OR security.is_admin ()
);

CREATE POLICY "Members can view business roles" ON org.business_roles FOR
SELECT TO authenticated USING (
        org.is_active_business_member (business_id)
    );

CREATE POLICY "Owners can manage business roles" ON org.business_roles FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM org.business_profiles
        WHERE
            id = business_id
            AND owner_user_id = auth.uid ()
    )
);


-- --- from 0212_team_memberships.sql ---

CREATE POLICY "Users can view members of their teams" ON org.team_members FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR org.is_active_team_member (team_id)
        OR security.is_admin ()
    );

CREATE POLICY "Team owners can add members" ON org.team_members FOR
INSERT
    TO public
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM org.teams t
            WHERE
                t.id = team_id
                AND t.owner_user_id = auth.uid ()
        )
        OR security.is_admin ()
    );

CREATE POLICY "Team owners can update members" ON org.team_members FOR
UPDATE TO public USING (
    EXISTS (
        SELECT 1
        FROM org.teams t
        WHERE
            t.id = team_id
            AND t.owner_user_id = auth.uid ()
    )
    OR security.is_admin ()
);

CREATE POLICY "Team owners can remove members or members can leave" ON org.team_members FOR DELETE TO public USING (
    user_id = auth.uid ()
    OR EXISTS (
        SELECT 1
        FROM org.teams t
        WHERE
            t.id = team_id
            AND t.owner_user_id = auth.uid ()
    )
    OR security.is_admin ()
);


-- --- from 0213_user_preferences.sql ---

CREATE POLICY "Users can view own preferences" ON org.user_preferences FOR
SELECT TO authenticated USING (user_id = auth.uid ());

CREATE POLICY "Users can update own preferences" ON org.user_preferences FOR
UPDATE TO authenticated USING (user_id = auth.uid ())
WITH
    CHECK (user_id = auth.uid ());

CREATE POLICY "Users can insert own preferences" ON org.user_preferences FOR
INSERT
    TO authenticated
WITH
    CHECK (user_id = auth.uid ());


-- --- from 0314_organisations.sql ---

-- organisations: the owner, any active member, or an admin may view.
CREATE POLICY "Members can view their organisation" ON org.organisations FOR
SELECT TO public USING (
        owner_user_id = auth.uid ()
        OR org.is_organisation_member (id)
        OR security.is_admin ()
    );

-- NO client INSERT policy on org.organisations (2026-09-23). An organisation is provisioned by
-- public.create_organisation (service role) with its owner membership in the same transaction; a raw
-- client INSERT could set `verification_level` and `status` at birth, where the UPDATE-only
-- immutability guard (00001895) cannot reach.

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


-- =============================================================================
-- SKILLS — the canonical vocabulary, and the hole its absence left
--
-- `org.skills` has had RLS enabled since 00002001 and NOT ONE POLICY anywhere in
-- the tree, which is default-deny. It fails the way default-deny always fails on
-- a SELECT: not with an error a caller can see, but with `200 []`. So every
-- skills picker in the product — project staffing, stage requirements, a
-- freelancer's own profile — returned an empty list and reported it as "no
-- skills found", and `projects.project_required_skills` referenced a vocabulary
-- its own readers could not resolve. Nothing logged, nothing raised, and the one
-- symptom is a control that renders and offers nothing (root CLAUDE.md §3 gate
-- 11).
--
-- Read by `anon` as well as `authenticated` because the list is public reference
-- data: three columns (id, slug, label), no owner, no membership, no personal
-- information, and it is rendered on the signed-out `/explore` filters. `anon`
-- already holds USAGE on the schema and `ALL` on its tables (00002500), so the
-- policy is what actually decides.
--
-- SELECT only, and deliberately nothing else. The vocabulary is a controlled
-- list seeded in 00005050: a client that could INSERT would let one person's
-- typo become an option everybody else picks from, and the matching that
-- staffing runs on stops meaning anything the moment the terms multiply. New
-- skills arrive through a seed or an admin path, both of which run as
-- service_role and are unaffected by RLS.
-- =============================================================================
CREATE POLICY "Skills are public reference data" ON org.skills FOR
SELECT TO authenticated, anon USING (true);


-- =============================================================================
-- FOLLOWS — a public, counted edge that anyone could forge
--
-- `org.profile_follows` was created (00000011) with RLS OFF and never named in
-- 00002001, while 00002500 grants `ALL ON ALL TABLES IN SCHEMA org TO anon,
-- authenticated`. RLS off plus a blanket grant is not weak protection, it is
-- none: any caller — including a signed-OUT one — could INSERT a row naming
-- somebody else as `follower_user_id`, delete anybody's follows, or rewrite the
-- graph wholesale. The follower count on every profile was therefore forgeable
-- by anyone with the URL. Found by the ranked contact picker, which is the first
-- reader of this table (the profile's Follow control is still a client stub).
--
-- SELECT is public on purpose: the table's own comment calls a follow "a public,
-- counted edge", the profile prints the count to guests, and the picker needs
-- BOTH directions (who I follow, who follows me) to rank a mutual follow — an
-- own-rows-only policy would hide exactly the incoming half. Nothing on the row
-- is private: two ids and an instant.
--
-- Writes are the caller's own edges and nothing else. There is no UPDATE
-- policy because a follow has no mutable column — you follow or you do not —
-- and an UPDATE that could rewrite `follower_user_id` is the forgery the INSERT
-- check exists to stop.
-- =============================================================================
CREATE POLICY "Follows are public" ON org.profile_follows FOR
SELECT TO authenticated, anon USING (true);

CREATE POLICY "Users follow as themselves" ON org.profile_follows FOR
INSERT TO authenticated
WITH
    CHECK (follower_user_id = auth.uid ());

CREATE POLICY "Users unfollow their own follows" ON org.profile_follows FOR DELETE TO authenticated USING (
    follower_user_id = auth.uid ()
);


-- =============================================================================
-- PROFILE DETAIL — the Experience ledger, languages, the showcase and the owner's switches
--
-- org.education_entries, org.experience_entries and org.user_languages were created with RLS OFF
-- under 00002500's `GRANT ALL ... TO anon, authenticated` (Decision #102(a)) — anyone, signed in or
-- not, could rewrite anyone's career history. RLS is now on (00002001 for those three; below, until
-- that list settles, for the three new tables — ENABLE is idempotent, so the duplication is
-- harmless).
--
-- READ follows the profile: a row is visible exactly when its profile is (org.fn_profile_visible —
-- public/unlisted, or the caller manages it). WRITE has no client policy at all: org.save_profile
-- and org.save_showcase are the only writers, because they validate what a policy cannot (a year's
-- shape, an https-only credential link, that slot 1 is an image, that a certification keeps its
-- platform verification only while its name and issuer are unchanged).
-- =============================================================================
ALTER TABLE org.certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.profile_showcase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.profile_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Education follows its profile" ON org.education_entries FOR
SELECT TO authenticated, anon USING (org.fn_profile_visible ('user', user_id));

CREATE POLICY "Experience follows its profile" ON org.experience_entries FOR
SELECT TO authenticated, anon USING (org.fn_profile_visible ('user', user_id));

CREATE POLICY "Languages follow their profile" ON org.user_languages FOR
SELECT TO authenticated, anon USING (org.fn_profile_visible ('user', user_id));

CREATE POLICY "Certifications follow their profile" ON org.certifications FOR
SELECT TO authenticated, anon USING (org.fn_profile_visible ('user', user_id));

CREATE POLICY "Showcase follows its profile" ON org.profile_showcase_items FOR
SELECT TO authenticated, anon USING (org.fn_profile_visible (owner_type, owner_id));

CREATE POLICY "Profile settings follow their profile" ON org.profile_settings FOR
SELECT TO authenticated, anon USING (org.fn_profile_visible (owner_type, owner_id));
