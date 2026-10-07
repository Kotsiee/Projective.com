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
-- set_operator_mode / create_workspace, the rating and counter triggers), and profile
-- edits go through org.save_profile, which names every column it touches. With no write policy the
-- table is default-deny to a client, which is the whole point.

-- org.user_emails is READ-ONLY to a client (2026-10-06): one SELECT policy, and NO INSERT, UPDATE or
-- DELETE policy. `verified_at` unlocks the invitations sent to an address (the
-- projects.project_invitations SELECT policy, org.fn_is_invitee, projects.invite_by_email), and the
-- own-row write policies this replaces let any signed-in user INSERT somebody else's address with
-- `verified_at` already set — or UPDATE it onto a row they had (the UPDATE policy had no WITH CHECK)
-- — and so read and accept invitations meant for that person. Every write is now a definer:
-- provisioning, public.handle_email_confirmed, and the 00001050 email functions, where a secondary
-- address is verified only by redeeming a mailed token. Write grants are revoked too (00002520) and
-- org.trg_user_emails_guard (00001815) refuses a client write to the trusted columns regardless.
CREATE POLICY "Users can view their own emails" ON org.user_emails FOR
SELECT TO authenticated USING (
        user_id = auth.uid ()
        OR security.is_admin ()
    );

-- org.email_verification_tokens: RLS on (00002001) and NO policy, deliberately — definer-only.


-- --- from 0204_projects.sql ---

CREATE POLICY "Users manage own bookmarks" ON org.user_bookmarks FOR ALL TO public USING (user_id = auth.uid ());


-- --- from 0209_teams.sql ---

CREATE POLICY "Users can view teams they belong to or own" ON org.teams FOR
SELECT TO public USING (
        owner_user_id = auth.uid ()
        OR org.is_active_team_member (id)
        OR security.is_admin ()
    );

-- NO client INSERT, UPDATE or DELETE policy on org.teams (2026-09-28). A team is created by
-- org.create_workspace, renamed by org.update_workspace, published or archived by
-- org.set_workspace_status and handed on by org.transfer_workspace_ownership — each a definer that
-- checks the caller's workspace capability (org.fn_member_can). The owner-only UPDATE policy this
-- replaces let an owner rewrite any column the guards did not name, and the DELETE policy let one
-- hard-delete a team with money held in escrow for it (root CLAUDE.md §5: nothing is hard-deleted).


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

-- NO client write policy on org.business_members or org.business_roles (2026-09-28). The roster and
-- its roles change only through the workspace RPCs (org.invite_workspace_member,
-- org.respond_to_workspace_invitation, org.update_workspace_member, org.transfer_workspace_ownership,
-- org.upsert_workspace_role, org.archive_workspace_role), which enforce the three-layer permission
-- model — rank, "never grant what you lack", the single owner — and re-project the vault. The FOR ALL
-- policies these replace let an owner INSERT a second owner, and let a member DELETE themselves while
-- keeping every vault grant they held.

CREATE POLICY "Members can view business roles" ON org.business_roles FOR
SELECT TO authenticated USING (
        org.is_active_business_member (business_id)
    );



-- --- from 0212_team_memberships.sql ---

CREATE POLICY "Users can view members of their teams" ON org.team_members FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR org.is_active_team_member (team_id)
        OR security.is_admin ()
    );

-- Team roles are read by every active member (the matrix, the role picker). Like the business
-- roster, neither table has a client write policy: see the business note above.
CREATE POLICY "Members can view team roles" ON org.team_roles FOR
SELECT TO authenticated USING (
        org.is_active_team_member (team_id)
        OR security.is_admin ()
    );

-- NO client write policy on org.team_members (2026-09-28). The INSERT policy let an owner add anybody
-- — without an invitation, at any role, past the seat cap; the DELETE policy let a member hard-delete
-- themselves and keep their payout stake, so every later release kept paying them.


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

-- NO client UPDATE (or DELETE) policy on org.organisations (2026-10-06). The bare
-- "Owners and admins can update the organisation" policy this replaces had no column list and no
-- WITH CHECK, so any admin could rewrite the legal name, registration number and corporate and
-- billing emails over PostgREST, unvalidated and unaudited. Every edit now goes through
-- org.update_organisation (00001020 §5c): an allow-list of keys, the legal identity owner-only and
-- frozen once KYB begins, every value bounded, every edit audited.

-- organisation_members: a user sees their own row; owners/admins see the whole roster.
CREATE POLICY "Members can view the roster" ON org.organisation_members FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR org.is_organisation_member (organisation_id, 'admin')
        OR security.is_admin ()
    );

-- NO client write policy on org.organisation_members (2026-09-28). An organisation's owner membership
-- is written by public.create_organisation (service role). The policies this replaces let an admin
-- UPDATE any row to role `owner` — including their own — and hard-DELETE the owner. Nothing in the
-- app writes the table today; organisation roster management will get definer RPCs of its own.


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
