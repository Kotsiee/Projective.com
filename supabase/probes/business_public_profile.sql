-- =============================================================================================
-- Probe: a business's /:handle is a buyer profile that honours its visibility (BP1, Decision #244;
-- BUSINESSES_AUDIT BF45-BF48).
--
--   A. Visibility matrix. For every status x visibility of a business, a stranger and a guest get
--      every profile read (view, roster, reviews, completed projects, owner, identity card) only
--      while it is `active` and `public` or `unlisted`; a member and the owner always get it, and
--      the view's `workspace.hidden_reason` says why outsiders do not (archived > draft >
--      invite_only, NULL while it is open). The view carries the real visibility.
--   B. Viewer facts. `workspace.viewer_edits` / `viewer_settings` are the viewer's OWN seat's
--      edit_profile / manage_settings; `contact` names the business owner (a DM is person-to-person).
--   C. Trust. The crest is `corporate_verified` only while KYB is verified; a business carries no
--      Standing and no adornments.
--   D. Roster. A business roster row is the member's title, else the base preset label, never a
--      custom role name; it carries `since` (the membership's joined_at).
--   E. Client proof. A completed project the business commissioned appears for a stranger only when
--      it is public and its portfolio display is allowed.
--   F. Reviews invariant. Every review of a business is about a project the business commissioned,
--      written by somebody who delivered on it, at most once per (project, reviewer) — the only rule
--      the schema enforces (`unique_review_per_project`) — and at most once per (project, provider
--      entity: the freelancer, or the team they delivered with), BP1's "one aggregate per
--      engagement". That last check is a SEED tripwire, not a guarantee: no review writer exists,
--      and `get_profile_reviews` returns rows unaggregated (Decision #244 (e)). The read names the
--      author's side as `freelancer`.
--   G. Regression. A draft team stays hidden; a public person stays visible to a guest; a team's
--      view carries no `workspace` / `contact` key.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/business_public_profile.sql
--
-- Fixture (seeded): `atlaslabs` (owner danielokafor "CTO", member miguelsantos "Design Ops", KYB
-- pending, its project prj-xghufr2r5b delivered by team northloop and reviewed by kwamemensah) and
-- `heliafinance` (owner priyaraman, admin hannahcole, KYB verified). Strangers: noor and a guest.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);
CREATE TEMP TABLE probe_fails (label text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

-- Act as a user; NULL acts as a guest (no `sub`, so auth.uid() is NULL).
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config(
        'request.jwt.claims',
        CASE WHEN p_user IS NULL THEN json_build_object('role', 'anon')::text
             ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END,
        true
    );
$$;

CREATE FUNCTION pg_temp.fail(p_label text, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO probe_fails VALUES (p_label);
    RAISE NOTICE 'FAIL % — %', p_label, p_why;
END $$;

CREATE FUNCTION pg_temp.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    RAISE NOTICE 'ok   %', p_label;
END $$;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_got text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE(p_ok, false) THEN
        PERFORM pg_temp.pass(p_label);
    ELSE
        PERFORM pg_temp.fail(p_label, 'got ' || COALESCE(p_got, 'NULL'));
    END IF;
END $$;

-- Which profile readers answer the CURRENT actor for a handle, as a mask: V view · R roster ·
-- r reviews · P completed projects · O owner · C identity card; '.' where the reader answered NULL.
CREATE FUNCTION pg_temp.mask(p_handle text, p_type text, p_id uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    RETURN CASE WHEN org.get_profile_view(p_handle) IS NULL THEN '.' ELSE 'V' END
        || CASE WHEN org.get_profile_roster(p_handle) IS NULL THEN '.' ELSE 'R' END
        || CASE WHEN org.get_profile_reviews(p_handle) IS NULL THEN '.' ELSE 'r' END
        || CASE WHEN org.get_profile_past_projects(p_handle) IS NULL THEN '.' ELSE 'P' END
        || CASE WHEN org.get_profile_owner(p_handle) IS NULL THEN '.' ELSE 'O' END
        || CASE WHEN EXISTS (SELECT 1 FROM org.get_profile_cards(ARRAY[p_type], ARRAY[p_id])) THEN 'C' ELSE '.' END;
END $$;
-- #endregion

-- #region Fixture
INSERT INTO probe_ids
SELECT u.username, u.user_id FROM org.users_public u
WHERE u.username IN ('danielokafor', 'miguelsantos', 'priyaraman', 'hannahcole', 'noor', 'kwamemensah');
INSERT INTO probe_ids VALUES
    ('atlas', (SELECT id FROM org.business_profiles WHERE slug = 'atlaslabs')),
    ('helia', (SELECT id FROM org.business_profiles WHERE slug = 'heliafinance')),
    ('northloop', (SELECT id FROM org.teams WHERE slug = 'northloop')),
    ('atlas_project', (SELECT id FROM projects.projects WHERE slug = 'prj-xghufr2r5b'));

DO $$
BEGIN
    IF (SELECT count(*) FROM probe_ids WHERE id IS NOT NULL) <> 10 THEN
        RAISE EXCEPTION 'business_public_profile: seed fixture missing (%)',
            (SELECT string_agg(k, ', ') FROM probe_ids WHERE id IS NULL);
    END IF;
END $$;
-- #endregion

-- #region A. Visibility matrix
DO $$
DECLARE
    v_status text;
    v_vis text;
    v_open boolean;
    v_reason text;
    v_mask text;
    v_view jsonb;
    v_who text;
BEGIN
    FOREACH v_status IN ARRAY ARRAY['draft', 'active', 'archived'] LOOP
        FOREACH v_vis IN ARRAY ARRAY['public', 'unlisted', 'invite_only'] LOOP
            SET LOCAL session_replication_role = replica;
            UPDATE org.business_profiles SET status = v_status, visibility = v_vis WHERE id = pg_temp.id('atlas');
            SET LOCAL session_replication_role = origin;

            v_open := v_status = 'active' AND v_vis IN ('public', 'unlisted');
            v_reason := CASE
                WHEN v_status = 'archived' THEN 'archived'
                WHEN v_status = 'draft' THEN 'draft'
                WHEN v_vis = 'invite_only' THEN 'invite_only'
            END;

            -- Outsiders: everything or nothing.
            FOREACH v_who IN ARRAY ARRAY['noor', 'guest'] LOOP
                PERFORM pg_temp.act(CASE WHEN v_who = 'guest' THEN NULL ELSE pg_temp.id(v_who) END);
                v_mask := pg_temp.mask('atlaslabs', 'business', pg_temp.id('atlas'));
                PERFORM pg_temp.check(
                    format('A %s/%s: %s reads %s', v_status, v_vis, v_who, CASE WHEN v_open THEN 'every section' ELSE 'nothing' END),
                    v_mask = CASE WHEN v_open THEN 'VRrPOC' ELSE '......' END,
                    v_mask
                );
            END LOOP;

            -- Insiders: always, with the reason outsiders are turned away.
            FOREACH v_who IN ARRAY ARRAY['miguelsantos', 'danielokafor'] LOOP
                PERFORM pg_temp.act(pg_temp.id(v_who));
                v_mask := pg_temp.mask('atlaslabs', 'business', pg_temp.id('atlas'));
                v_view := org.get_profile_view('atlaslabs');
                PERFORM pg_temp.check(
                    format('A %s/%s: %s reads every section', v_status, v_vis, v_who),
                    v_mask = 'VRrPOC', v_mask
                );
                PERFORM pg_temp.check(
                    format('A %s/%s: %s is told hidden_reason=%s', v_status, v_vis, v_who, COALESCE(v_reason, 'NULL')),
                    v_view ? 'workspace' AND (v_view -> 'workspace' ->> 'hidden_reason') IS NOT DISTINCT FROM v_reason,
                    v_view ->> 'workspace'
                );
                PERFORM pg_temp.check(
                    format('A %s/%s: %s sees the real visibility', v_status, v_vis, v_who),
                    v_view ->> 'visibility' = v_vis, v_view ->> 'visibility'
                );
            END LOOP;
        END LOOP;
    END LOOP;

    SET LOCAL session_replication_role = replica;
    UPDATE org.business_profiles SET status = 'active', visibility = 'public' WHERE id = pg_temp.id('atlas');
    SET LOCAL session_replication_role = origin;
END $$;
-- #endregion

-- #region B. Viewer facts
DO $$
DECLARE
    v jsonb;
    v_who text;
BEGIN
    -- Helia's owner and admin hold edit_profile and manage_settings on their own seats.
    FOREACH v_who IN ARRAY ARRAY['priyaraman', 'hannahcole'] LOOP
        PERFORM pg_temp.act(pg_temp.id(v_who));
        v := org.get_profile_view('heliafinance');
        PERFORM pg_temp.check('B ' || v_who || ' on helia: viewer_edits + viewer_settings',
            (v -> 'workspace' ->> 'viewer_edits')::boolean AND (v -> 'workspace' ->> 'viewer_settings')::boolean,
            v ->> 'workspace');
        PERFORM pg_temp.check('B ' || v_who || ' on helia: viewer_is_owner',
            (v ->> 'viewer_is_owner')::boolean, v ->> 'viewer_is_owner');
    END LOOP;

    -- A plain member holds neither, and does not manage the profile.
    PERFORM pg_temp.act(pg_temp.id('miguelsantos'));
    v := org.get_profile_view('atlaslabs');
    PERFORM pg_temp.check('B miguelsantos on atlas: no edit, no settings, not the owner',
        NOT (v -> 'workspace' ->> 'viewer_edits')::boolean
        AND NOT (v -> 'workspace' ->> 'viewer_settings')::boolean
        AND NOT (v ->> 'viewer_is_owner')::boolean,
        v ->> 'workspace' || ' owner=' || (v ->> 'viewer_is_owner'));

    -- A stranger and a guest hold nothing, and are told nothing.
    FOREACH v_who IN ARRAY ARRAY['noor', 'guest'] LOOP
        PERFORM pg_temp.act(CASE WHEN v_who = 'guest' THEN NULL ELSE pg_temp.id(v_who) END);
        v := org.get_profile_view('heliafinance');
        PERFORM pg_temp.check('B ' || v_who || ' on helia: no doors, no hidden reason',
            NOT (v -> 'workspace' ->> 'viewer_edits')::boolean
            AND NOT (v -> 'workspace' ->> 'viewer_settings')::boolean
            AND (v -> 'workspace' ->> 'hidden_reason') IS NULL,
            v ->> 'workspace');
    END LOOP;

    -- A Message reaches the owner.
    PERFORM pg_temp.act(pg_temp.id('noor'));
    v := org.get_profile_view('heliafinance');
    PERFORM pg_temp.check('B helia contact is its owner priyaraman',
        v -> 'contact' ->> 'handle' = 'priyaraman' AND v -> 'contact' ->> 'name' = 'Priya Raman',
        v ->> 'contact');
    v := org.get_profile_view('atlaslabs');
    PERFORM pg_temp.check('B atlas contact is its owner danielokafor',
        v -> 'contact' ->> 'handle' = 'danielokafor', v ->> 'contact');
END $$;
-- #endregion

-- #region C. Trust
DO $$
DECLARE
    v jsonb;
    v_pending jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('noor'));
    v := org.get_profile_view('heliafinance');
    PERFORM pg_temp.check('C helia (KYB verified): corporate_verified crest',
        v ->> 'verification_stamp' = 'corporate_verified' AND (v ->> 'verified')::boolean,
        (v ->> 'verification_stamp') || ' verified=' || (v ->> 'verified'));
    PERFORM pg_temp.check('C helia: no Standing, no adornments',
        v -> 'standing' = 'null'::jsonb AND v -> 'adornments' = '[]'::jsonb,
        (v ->> 'standing') || ' ' || (v ->> 'adornments'));

    -- The same business with its KYB pending carries no crest.
    BEGIN
        SET LOCAL session_replication_role = replica;
        UPDATE org.business_profiles SET kyb_status = 'pending' WHERE id = pg_temp.id('helia');
        SET LOCAL session_replication_role = origin;
        v_pending := org.get_profile_view('heliafinance');
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN SQLSTATE 'PX000' THEN
        NULL;
    END;
    PERFORM pg_temp.check('C helia with KYB pending: no crest',
        v_pending ->> 'verification_stamp' = 'none' AND NOT (v_pending ->> 'verified')::boolean,
        (v_pending ->> 'verification_stamp') || ' verified=' || (v_pending ->> 'verified'));

    v := org.get_profile_view('atlaslabs');
    PERFORM pg_temp.check('C atlas (KYB pending): no crest, no Standing, no adornments',
        v ->> 'verification_stamp' = 'none' AND v -> 'standing' = 'null'::jsonb AND v -> 'adornments' = '[]'::jsonb,
        (v ->> 'verification_stamp') || ' ' || (v ->> 'standing') || ' ' || (v ->> 'adornments'));
END $$;
-- #endregion

-- #region D. Roster
DO $$
DECLARE
    v jsonb;
    v_daniel jsonb;
    v_untitled text;
    v_custom text;
    v_role uuid;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('noor'));
    v := org.get_profile_roster('atlaslabs');
    SELECT m INTO v_daniel FROM jsonb_array_elements(v -> 'members') m WHERE m ->> 'handle' = 'danielokafor';
    PERFORM pg_temp.check('D atlas roster: the owner reads their title "CTO"',
        v_daniel ->> 'role' = 'CTO', v_daniel ->> 'role');
    PERFORM pg_temp.check('D atlas roster: since is the membership joined_at',
        (v_daniel ->> 'since')::timestamptz = (
            SELECT joined_at FROM org.business_members
            WHERE business_id = pg_temp.id('atlas') AND user_id = pg_temp.id('danielokafor')
        ),
        v_daniel ->> 'since');

    -- No title: the base preset's label.
    BEGIN
        UPDATE org.business_members SET title = NULL
        WHERE business_id = pg_temp.id('atlas') AND user_id = pg_temp.id('miguelsantos');
        SELECT m ->> 'role' INTO v_untitled
        FROM jsonb_array_elements(org.get_profile_roster('atlaslabs') -> 'members') m
        WHERE m ->> 'handle' = 'miguelsantos';
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN SQLSTATE 'PX000' THEN
        NULL;
    END;
    PERFORM pg_temp.check('D untitled member reads "Member"', v_untitled = 'Member', v_untitled);

    -- A custom role's name is a member-only fact: an untitled holder still reads its base preset.
    BEGIN
        SET LOCAL session_replication_role = replica;
        INSERT INTO org.business_roles (business_id, name, preset, base_preset, capabilities)
        VALUES (pg_temp.id('atlas'), 'Probe approver', NULL, 'member', '{}')
        RETURNING id INTO v_role;
        UPDATE org.business_members SET role_id = v_role, title = NULL
        WHERE business_id = pg_temp.id('atlas') AND user_id = pg_temp.id('miguelsantos');
        SET LOCAL session_replication_role = origin;
        SELECT m ->> 'role' INTO v_custom
        FROM jsonb_array_elements(org.get_profile_roster('atlaslabs') -> 'members') m
        WHERE m ->> 'handle' = 'miguelsantos';
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN SQLSTATE 'PX000' THEN
        NULL;
    END;
    PERFORM pg_temp.check('D a custom role''s name never reaches the public roster',
        v_custom = 'Member', v_custom);
END $$;
-- #endregion

-- #region E. Client proof
DO $$
DECLARE
    v_open boolean;
    v_private boolean;
    v_embargoed boolean;
    v_seeded boolean;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('noor'));
    v_seeded := org.get_profile_past_projects('atlaslabs') @> '[{"slug": "prj-xghufr2r5b"}]';
    PERFORM pg_temp.check('E an active project is not client proof', NOT v_seeded, v_seeded::text);

    BEGIN
        SET LOCAL session_replication_role = replica;
        UPDATE projects.projects SET status = 'completed' WHERE id = pg_temp.id('atlas_project');
        SET LOCAL session_replication_role = origin;
        v_open := org.get_profile_past_projects('atlaslabs') @> '[{"slug": "prj-xghufr2r5b"}]';

        SET LOCAL session_replication_role = replica;
        UPDATE projects.projects SET visibility = 'unlisted' WHERE id = pg_temp.id('atlas_project');
        SET LOCAL session_replication_role = origin;
        v_private := org.get_profile_past_projects('atlaslabs') @> '[{"slug": "prj-xghufr2r5b"}]';

        SET LOCAL session_replication_role = replica;
        UPDATE projects.projects SET visibility = 'public', portfolio_display_rights = 'embargoed'
        WHERE id = pg_temp.id('atlas_project');
        SET LOCAL session_replication_role = origin;
        v_embargoed := org.get_profile_past_projects('atlaslabs') @> '[{"slug": "prj-xghufr2r5b"}]';
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN SQLSTATE 'PX000' THEN
        NULL;
    END;
    PERFORM pg_temp.check('E a completed public project the business commissioned is client proof',
        v_open, v_open::text);
    PERFORM pg_temp.check('E a non-public one is not', NOT v_private, v_private::text);
    PERFORM pg_temp.check('E an embargoed one is not', NOT v_embargoed, v_embargoed::text);
END $$;
-- #endregion

-- #region F. Reviews invariant
DO $$
DECLARE
    v_bad int;
    v_dupes int;
    v_total int;
    v_roles text;
BEGIN
    SELECT count(*) INTO v_total FROM reviews.entity_reviews WHERE target_entity_type = 'business';
    SELECT count(*) INTO v_bad
    FROM reviews.entity_reviews rv
    LEFT JOIN projects.projects p ON p.id = rv.project_id
    WHERE rv.target_entity_type = 'business'
      AND (
          rv.project_id IS NULL
          OR p.client_business_id IS DISTINCT FROM rv.target_entity_id
          OR NOT EXISTS (
              SELECT 1
              FROM projects.stage_assignments sa
              JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
              WHERE ps.project_id = rv.project_id
                AND sa.status NOT IN ('declined', 'cancelled', 'pending_funding')
                AND (
                    sa.freelancer_profile_id = rv.reviewer_user_id
                    OR EXISTS (
                        SELECT 1 FROM org.team_members tm
                        WHERE tm.team_id = sa.team_id AND tm.user_id = rv.reviewer_user_id AND tm.status = 'active'
                    )
                )
          )
      );
    PERFORM pg_temp.check(format('F all %s business reviews are by a provider on a project it commissioned', v_total),
        v_total > 0 AND v_bad = 0, v_bad || ' bad of ' || v_total);

    SELECT count(*) INTO v_dupes FROM (
        SELECT 1 FROM reviews.entity_reviews
        WHERE target_entity_type = 'business'
        GROUP BY target_entity_id, project_id, reviewer_user_id HAVING count(*) > 1
    ) d;
    PERFORM pg_temp.check('F one review per (business, project, reviewer)', v_dupes = 0, v_dupes::text);

    -- The engagement aggregate: a team's members may not each review the business for one project.
    SELECT count(*) INTO v_dupes FROM (
        SELECT 1
        FROM reviews.entity_reviews rv
        CROSS JOIN LATERAL (
            SELECT COALESCE(
                (
                    SELECT 'freelancer:' || rv.reviewer_user_id::text
                    FROM projects.stage_assignments sa
                    JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
                    WHERE ps.project_id = rv.project_id
                      AND sa.freelancer_profile_id = rv.reviewer_user_id
                      AND sa.status NOT IN ('declined', 'cancelled', 'pending_funding')
                    LIMIT 1
                ),
                (
                    SELECT 'team:' || min(sa.team_id::text)
                    FROM projects.stage_assignments sa
                    JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
                    JOIN org.team_members tm
                      ON tm.team_id = sa.team_id AND tm.user_id = rv.reviewer_user_id AND tm.status = 'active'
                    WHERE ps.project_id = rv.project_id
                      AND sa.status NOT IN ('declined', 'cancelled', 'pending_funding')
                )
            ) AS provider
        ) pv
        WHERE rv.target_entity_type = 'business'
        GROUP BY rv.target_entity_id, rv.project_id, pv.provider HAVING count(*) > 1
    ) d;
    PERFORM pg_temp.check('F one review per (business, project, provider entity) in the seed — no writer enforces it',
        v_dupes = 0, v_dupes::text);

    PERFORM pg_temp.act(pg_temp.id('noor'));
    SELECT string_agg(DISTINCT r ->> 'author_role', ',') INTO v_roles
    FROM jsonb_array_elements(org.get_profile_reviews('atlaslabs') || org.get_profile_reviews('heliafinance')) r;
    PERFORM pg_temp.check('F a business''s reviews are written from the freelancer side',
        v_roles = 'freelancer', v_roles);
END $$;
-- #endregion

-- #region G. Regression
DO $$
DECLARE
    v_draft jsonb;
    v jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('noor'));
    BEGIN
        SET LOCAL session_replication_role = replica;
        UPDATE org.teams SET status = 'draft' WHERE id = pg_temp.id('northloop');
        SET LOCAL session_replication_role = origin;
        v_draft := org.get_profile_view('northloop');
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN SQLSTATE 'PX000' THEN
        NULL;
    END;
    PERFORM pg_temp.check('G a draft team is hidden from a stranger', v_draft IS NULL, v_draft::text);

    v := org.get_profile_view('northloop');
    PERFORM pg_temp.check('G a team''s view carries no workspace / contact facts',
        v IS NOT NULL AND NOT (v ? 'workspace') AND NOT (v ? 'contact'), left(v::text, 80));

    PERFORM pg_temp.act(NULL);
    v := org.get_profile_view('noor');
    PERFORM pg_temp.check('G a public person is visible to a guest', v IS NOT NULL AND NOT (v ? 'workspace'), left(v::text, 80));
END $$;
-- #endregion

-- #region Verdict
DO $$
DECLARE
    v_n int := (SELECT count(*) FROM probe_fails);
BEGIN
    IF v_n > 0 THEN
        RAISE EXCEPTION 'business_public_profile: % failure(s): %', v_n, (SELECT string_agg(label, '; ') FROM probe_fails);
    END IF;
    RAISE NOTICE 'business_public_profile: all checks passed';
END $$;
-- #endregion

ROLLBACK;
