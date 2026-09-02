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

CREATE POLICY "Users can create their own profile" ON org.users_public FOR
INSERT
    TO public
WITH
    CHECK (
        user_id = auth.uid ()
        OR security.is_admin ()
    );

CREATE POLICY "Users can update their own profile" ON org.users_public FOR
UPDATE TO public USING (
    user_id = auth.uid ()
    OR security.is_admin ()
);

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

CREATE POLICY "Users can create teams" ON org.teams FOR
INSERT
    TO public
WITH
    CHECK (
        owner_user_id = auth.uid ()
        OR security.is_admin ()
    );

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

CREATE POLICY "Users can create their own freelancer profile" ON org.freelancer_profiles FOR
INSERT
    TO public
WITH
    CHECK (
        user_id = auth.uid ()
        OR security.is_admin ()
    );

CREATE POLICY "Users can update their own freelancer profile" ON org.freelancer_profiles FOR
UPDATE TO public USING (
    user_id = auth.uid ()
    OR security.is_admin ()
);


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
