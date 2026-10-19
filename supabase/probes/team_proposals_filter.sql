-- =============================================================================================
-- Probe: a team's sent proposals (Teams C5) — projects.list_my_applications(p_project, p_team).
-- The team console's Projects → Proposals view reads the same caller-scoped list as "Your proposals"
-- on /projects, narrowed to ONE team: every application filed for it, whoever filed it, and nothing
-- else — never the caller's personal proposals, never another team's — with the narrowing applied
-- before the list's 200-row cap, so a busy member's own proposals cannot push the team's out.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/team_proposals_filter.sql
--
-- Fixture (seeded data, rows inserted inside the transaction with triggers off): the seeded two-member
-- team `studiofern` — owner L holds bind_seat, member M does not — another team T2 neither belongs to,
-- and two projects P1, P2 with a stage each. Four applications: L for the team on P1, L personally on
-- P2, M for the team on P2, and T2's own on P1. A clean run prints only PASS notices; any FAIL aborts
-- the run at the end.
-- =============================================================================================

BEGIN;
-- @prelude

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid, txt text);
CREATE TEMP TABLE probe_fails (label text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.txt(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT txt FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.fail(p_label text, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO probe_fails VALUES (p_label);
    RAISE NOTICE 'FAIL % — %', p_label, p_why;
END $$;

-- The probe's own application keys a list read as p_actor returned, sorted (rows the probe did not
-- insert — the seed's — are ignored, so the cases hold whatever else the caller has sent).
CREATE FUNCTION pg_temp.seen(p_actor uuid, p_project text, p_team uuid) RETURNS text[]
LANGUAGE plpgsql AS $$
DECLARE
    v_rows jsonb;
BEGIN
    PERFORM pg_temp.act(p_actor);
    v_rows := projects.list_my_applications(p_project, p_team);
    RETURN ARRAY(
        SELECT k.k FROM jsonb_array_elements(v_rows) r
          JOIN probe_ids k ON k.id = (r ->> 'id')::uuid AND k.k LIKE 'app_%'
         ORDER BY k.k
    );
END $$;

CREATE FUNCTION pg_temp.expect(p_label text, p_got text[], p_want text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF p_got IS DISTINCT FROM p_want THEN
        PERFORM pg_temp.fail(p_label, format('got %s, expected %s', p_got, p_want));
    ELSE
        RAISE NOTICE 'PASS % (%)', p_label, p_want;
    END IF;
END $$;

-- Whether p_actor may withdraw the probe application p_key, as the list reports it.
CREATE FUNCTION pg_temp.can_withdraw(p_actor uuid, p_key text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_actor);
    RETURN (
        SELECT (r ->> 'canWithdraw')::boolean
          FROM jsonb_array_elements(projects.list_my_applications(NULL, pg_temp.id('team'))) r
         WHERE (r ->> 'id')::uuid = pg_temp.id(p_key)
    );
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_team uuid;
    v_lead uuid;
    v_member uuid;
    v_other uuid;
    v_other_member uuid;
    v_p1 uuid;
    v_p1_slug text;
    v_s1 uuid;
    v_p2 uuid;
    v_s2 uuid;
    v_app uuid;
BEGIN
    SELECT t.id, t.owner_user_id INTO v_team, v_lead FROM org.teams t WHERE t.slug = 'studiofern';
    SELECT m.user_id INTO v_member FROM org.team_members m
     WHERE m.team_id = v_team AND m.status = 'active' AND m.user_id <> v_lead
     ORDER BY m.user_id LIMIT 1;
    SELECT t.id, m.user_id INTO v_other, v_other_member
      FROM org.teams t
      JOIN org.team_members m ON m.team_id = t.id AND m.status = 'active'
     WHERE t.id <> v_team
       AND NOT EXISTS (SELECT 1 FROM org.team_members x
                        WHERE x.team_id = t.id AND x.status = 'active'
                          AND x.user_id IN (v_lead, v_member))
     ORDER BY t.slug, m.user_id LIMIT 1;

    SELECT p.id, p.slug, s.id INTO v_p1, v_p1_slug, v_s1
      FROM projects.projects p JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.status = 'active' AND s.archived_at IS NULL
     ORDER BY p.slug, s.id LIMIT 1;
    SELECT p.id, s.id INTO v_p2, v_s2
      FROM projects.projects p JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.status = 'active' AND s.archived_at IS NULL AND p.id <> v_p1
     ORDER BY p.slug, s.id LIMIT 1;

    IF v_team IS NULL OR v_member IS NULL OR v_other IS NULL OR v_p1 IS NULL OR v_p2 IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (team %, member %, other team %, projects % %) — deno task db:reset',
            v_team, v_member, v_other, v_p1, v_p2;
    END IF;

    INSERT INTO probe_ids VALUES
        ('team', v_team, NULL), ('lead', v_lead, NULL), ('member', v_member, NULL),
        ('other', v_other, NULL), ('other_member', v_other_member, NULL), ('p1', v_p1, v_p1_slug);

    -- Inserted with triggers off: the metering trigger would draw on real allowances, and the probe is
    -- about who READS a row, not how one is filed. Distinct created_at values — rows written in one
    -- transaction share now(), and the list orders by it.
    SET LOCAL session_replication_role = replica;

    INSERT INTO projects.project_applications
        (project_id, applicant_user_id, applicant_type, applicant_profile_id, status, created_at)
    VALUES (v_p1, v_lead, 'team', v_team, 'pending', now() - interval '1 hour') RETURNING id INTO v_app;
    INSERT INTO projects.project_application_targets (application_id, target_type, target_id)
    VALUES (v_app, 'stage', v_s1);
    INSERT INTO probe_ids VALUES ('app_lead_team', v_app, NULL);

    INSERT INTO projects.project_applications
        (project_id, applicant_user_id, applicant_type, applicant_profile_id, status, created_at)
    VALUES (v_p2, v_lead, 'freelancer', v_lead, 'pending', now() - interval '2 hours') RETURNING id INTO v_app;
    INSERT INTO projects.project_application_targets (application_id, target_type, target_id)
    VALUES (v_app, 'stage', v_s2);
    INSERT INTO probe_ids VALUES ('app_lead_self', v_app, NULL);

    INSERT INTO projects.project_applications
        (project_id, applicant_user_id, applicant_type, applicant_profile_id, status, created_at)
    VALUES (v_p2, v_member, 'team', v_team, 'pending', now() - interval '3 hours') RETURNING id INTO v_app;
    INSERT INTO projects.project_application_targets (application_id, target_type, target_id)
    VALUES (v_app, 'stage', v_s2);
    INSERT INTO probe_ids VALUES ('app_member_team', v_app, NULL);

    INSERT INTO projects.project_applications
        (project_id, applicant_user_id, applicant_type, applicant_profile_id, status, created_at)
    VALUES (v_p1, v_other_member, 'team', v_other, 'pending', now() - interval '4 hours') RETURNING id INTO v_app;
    INSERT INTO projects.project_application_targets (application_id, target_type, target_id)
    VALUES (v_app, 'stage', v_s1);
    INSERT INTO probe_ids VALUES ('app_other_team', v_app, NULL);

    SET LOCAL session_replication_role = origin;
END $$;
-- #endregion

-- #region Cases
DO $$
BEGIN
    PERFORM pg_temp.expect('the team filter: every application filed for the team, whoever filed it',
        pg_temp.seen(pg_temp.id('lead'), NULL, pg_temp.id('team')),
        ARRAY['app_lead_team', 'app_member_team']);

    PERFORM pg_temp.expect('no filter: the caller''s own and their teams'', never another team''s',
        pg_temp.seen(pg_temp.id('lead'), NULL, NULL),
        ARRAY['app_lead_self', 'app_lead_team', 'app_member_team']);

    PERFORM pg_temp.expect('the team filter composes with the project filter',
        pg_temp.seen(pg_temp.id('lead'), pg_temp.txt('p1'), pg_temp.id('team')),
        ARRAY['app_lead_team']);

    PERFORM pg_temp.expect('a team the caller is not in and filed nothing for reads empty',
        pg_temp.seen(pg_temp.id('lead'), NULL, pg_temp.id('other')),
        ARRAY[]::text[]);

    PERFORM pg_temp.expect('a member reads the team''s list, not the lead''s personal proposals',
        pg_temp.seen(pg_temp.id('member'), NULL, pg_temp.id('team')),
        ARRAY['app_lead_team', 'app_member_team']);

    IF pg_temp.can_withdraw(pg_temp.id('lead'), 'app_member_team') IS DISTINCT FROM true THEN
        PERFORM pg_temp.fail('a bind_seat holder may withdraw any team proposal', 'canWithdraw is not true');
    ELSE
        RAISE NOTICE 'PASS a bind_seat holder may withdraw any team proposal';
    END IF;
    IF pg_temp.can_withdraw(pg_temp.id('member'), 'app_lead_team') IS DISTINCT FROM false THEN
        PERFORM pg_temp.fail('a member without bind_seat may not withdraw another''s', 'canWithdraw is not false');
    ELSE
        RAISE NOTICE 'PASS a member without bind_seat may not withdraw another''s';
    END IF;
    IF pg_temp.can_withdraw(pg_temp.id('member'), 'app_member_team') IS DISTINCT FROM true THEN
        PERFORM pg_temp.fail('the filer may withdraw their own team proposal', 'canWithdraw is not true');
    ELSE
        RAISE NOTICE 'PASS the filer may withdraw their own team proposal';
    END IF;
END $$;
-- #endregion

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM probe_fails) THEN
        RAISE EXCEPTION 'team_proposals_filter: % case(s) failed', (SELECT count(*) FROM probe_fails);
    END IF;
END $$;

ROLLBACK;
