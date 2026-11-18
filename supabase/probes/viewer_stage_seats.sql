-- =============================================================================================
-- Probe: projects.get_viewer_stage_seats (00001100) — the seats the board's provider filter reads.
--
-- A bought TEAM service is seated on a team (Decision #427 (C)), and `stage_assignments` RLS shows a
-- non-owner no seat at all, so before this read a team member — and the seller who listed it — was
-- onboarded to nothing and the board handed them no cards (#427 (c)). The same RLS hid a hired
-- freelancer's own seat on a private engagement. The read answers for the caller only: their own
-- seats, and the seats of teams they are an ACTIVE member of, with each seat's status (the board
-- applies `countsAsOnboarded`); a live one agrees with the claim door's roster (`fn_holds_live_seat`).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a seeded local DB:
--   deno task test:probes viewer_stage_seats
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
-- A published TEAM pipeline with stages, its seller, an active member who did not list it, an adult
-- buyer outside the team with no draft of it, a stranger, and a freelancer outside the team.
DO $$
DECLARE
    v_bp record;
    v_member uuid;
    v_buyer uuid;
    v_stranger uuid;
    v_hired uuid;
BEGIN
    SELECT sb.id, sb.freelancer_profile_id AS seller, sb.owner_team_id AS team INTO v_bp
      FROM marketplace.service_blueprints sb
     WHERE sb.delivery_model = 'pipeline' AND sb.is_published AND sb.owner_team_id IS NOT NULL
       AND jsonb_array_length(sb.stage_template) > 0
       AND EXISTS (SELECT 1 FROM org.team_members tm
                    WHERE tm.team_id = sb.owner_team_id AND tm.status = 'active'
                      AND tm.user_id <> sb.freelancer_profile_id)
     ORDER BY sb.slug LIMIT 1;
    IF v_bp.id IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no published team pipeline with a second member'; END IF;

    SELECT tm.user_id INTO v_member FROM org.team_members tm
     WHERE tm.team_id = v_bp.team AND tm.status = 'active' AND tm.user_id <> v_bp.seller
     ORDER BY tm.user_id LIMIT 1;

    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm WHERE tm.team_id = v_bp.team AND tm.user_id = u.user_id)
       AND NOT EXISTS (SELECT 1 FROM projects.projects p
                        WHERE p.client_user_id = u.user_id AND p.source_blueprint_id = v_bp.id)
     ORDER BY u.user_id LIMIT 1;

    SELECT fp.user_id INTO v_hired FROM org.freelancer_profiles fp
     WHERE fp.user_id NOT IN (v_bp.seller, v_member, v_buyer)
       AND NOT org.fn_is_minor(fp.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm WHERE tm.team_id = v_bp.team AND tm.user_id = fp.user_id)
     ORDER BY fp.user_id LIMIT 1;

    SELECT u.user_id INTO v_stranger FROM org.users_public u
     WHERE u.user_id NOT IN (v_bp.seller, v_member, v_buyer, v_hired)
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm WHERE tm.team_id = v_bp.team AND tm.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;

    IF v_member IS NULL OR v_buyer IS NULL OR v_hired IS NULL OR v_stranger IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: member=% buyer=% hired=% stranger=%', v_member, v_buyer, v_hired, v_stranger;
    END IF;

    PERFORM set_config('probe.bp', v_bp.id::text, true);
    PERFORM set_config('probe.team', v_bp.team::text, true);
    PERFORM set_config('probe.seller', v_bp.seller::text, true);
    PERFORM set_config('probe.member', v_member::text, true);
    PERFORM set_config('probe.buyer', v_buyer::text, true);
    PERFORM set_config('probe.hired', v_hired::text, true);
    PERFORM set_config('probe.stranger', v_stranger::text, true);
    RAISE NOTICE 'fixture bp=% team=% seller=% member=% buyer=% hired=% stranger=%',
        v_bp.id, v_bp.team, v_bp.seller, v_member, v_buyer, v_hired, v_stranger;
END $$;
-- #endregion

-- #region 1. anon — no EXECUTE
SET LOCAL ROLE anon;
DO $$
BEGIN
    PERFORM projects.get_viewer_stage_seats(gen_random_uuid());
    RAISE EXCEPTION 'FAIL anon executed get_viewer_stage_seats';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS anon refused';
END $$;
RESET ROLE;
-- #endregion

-- #region 2. The buyer instantiates the team's service
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.buyer'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v jsonb;
BEGIN
    v := marketplace.instantiate_service_blueprint(
        current_setting('probe.bp')::uuid, '{}', NULL, 'probe-viewer-seats-0001');
    PERFORM set_config('probe.project', v->>'project_id', true);
    RAISE NOTICE 'PASS instantiated % (% stages)', v->>'slug', v->>'stage_count';
END $$;
RESET ROLE;

DO $$
DECLARE
    v_stages int;
    v_team_seats int;
BEGIN
    SELECT count(*) INTO v_stages FROM projects.project_stages
     WHERE project_id = current_setting('probe.project')::uuid;
    SELECT count(*) INTO v_team_seats
      FROM projects.stage_assignments sa JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
     WHERE ps.project_id = current_setting('probe.project')::uuid
       AND sa.assignee_type = 'team' AND sa.team_id = current_setting('probe.team')::uuid
       AND sa.status = 'accepted';
    IF v_stages = 0 OR v_team_seats <> v_stages THEN
        RAISE EXCEPTION 'FAIL the service is not team-seated on every stage: stages=% team seats=%', v_stages, v_team_seats;
    END IF;
    PERFORM set_config('probe.stages', v_stages::text, true);
    RAISE NOTICE 'PASS the team holds an accepted seat on all % stages', v_stages;
END $$;
-- #endregion

-- #region 3. A member who did not list it reads every team seat; each agrees with the claim roster
CREATE TEMP TABLE probe_member_seats (project_stage_id uuid, status text, team_id uuid) ON COMMIT DROP;
GRANT ALL ON probe_member_seats TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.member'), 'role', 'authenticated')::text, true);
INSERT INTO probe_member_seats
    SELECT * FROM projects.get_viewer_stage_seats(current_setting('probe.project')::uuid);
DO $$
DECLARE
    v_rls int;
BEGIN
    IF (SELECT count(*) FROM probe_member_seats) <> current_setting('probe.stages')::int
        OR EXISTS (SELECT 1 FROM probe_member_seats
                    WHERE status <> 'accepted' OR team_id IS DISTINCT FROM current_setting('probe.team')::uuid) THEN
        RAISE EXCEPTION 'FAIL member seats: %', (SELECT json_agg(s) FROM probe_member_seats s);
    END IF;
    SELECT count(*) INTO v_rls
      FROM projects.stage_assignments sa JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
     WHERE ps.project_id = current_setting('probe.project')::uuid;
    RAISE NOTICE 'PASS the member reads % team seats through the definer (% through RLS)',
        (SELECT count(*) FROM probe_member_seats), v_rls;
END $$;
RESET ROLE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM probe_member_seats s
                WHERE NOT projects.fn_holds_live_seat(s.project_stage_id, current_setting('probe.member')::uuid)) THEN
        RAISE EXCEPTION 'FAIL a seat the board reads is one the claim door refuses';
    END IF;
    RAISE NOTICE 'PASS every live seat the member reads is one fn_holds_live_seat lets them claim on';
END $$;
-- #endregion

-- #region 4. The seller who listed it reads the same team seats
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.seller'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF (SELECT count(*) FROM projects.get_viewer_stage_seats(current_setting('probe.project')::uuid)
         WHERE team_id = current_setting('probe.team')::uuid AND status = 'accepted')
        <> current_setting('probe.stages')::int THEN
        RAISE EXCEPTION 'FAIL the seller does not read their team''s seats';
    END IF;
    RAISE NOTICE 'PASS the seller reads the team seats';
END $$;
RESET ROLE;
-- #endregion

-- #region 5. The buyer and a stranger hold no seat
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.buyer'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM projects.get_viewer_stage_seats(current_setting('probe.project')::uuid)) THEN
        RAISE EXCEPTION 'FAIL the buyer reads a seat';
    END IF;
    RAISE NOTICE 'PASS the buyer reads no seat';
END $$;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.stranger'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM projects.get_viewer_stage_seats(current_setting('probe.project')::uuid)) THEN
        RAISE EXCEPTION 'FAIL a stranger reads a seat';
    END IF;
    RAISE NOTICE 'PASS a stranger reads no seat';
END $$;
RESET ROLE;
-- #endregion

-- #region 6. A hired freelancer reads their own seat that RLS hides from them
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
SELECT ps.id, 'freelancer', current_setting('probe.hired')::uuid, current_setting('probe.seller')::uuid, 'accepted'
  FROM projects.project_stages ps
 WHERE ps.project_id = current_setting('probe.project')::uuid
 ORDER BY ps.sort_order DESC LIMIT 1;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.hired'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_rls int;
BEGIN
    SELECT count(*) INTO v_rls
      FROM projects.stage_assignments sa JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
     WHERE ps.project_id = current_setting('probe.project')::uuid
       AND sa.freelancer_profile_id = current_setting('probe.hired')::uuid;
    IF (SELECT count(*) FROM projects.get_viewer_stage_seats(current_setting('probe.project')::uuid)
         WHERE team_id IS NULL AND status = 'accepted') <> 1
        OR EXISTS (SELECT 1 FROM projects.get_viewer_stage_seats(current_setting('probe.project')::uuid)
                    WHERE team_id IS NOT NULL) THEN
        RAISE EXCEPTION 'FAIL the hired freelancer does not read exactly their own seat';
    END IF;
    RAISE NOTICE 'PASS the hired freelancer reads their own seat (% through RLS)', v_rls;
END $$;
RESET ROLE;
-- #endregion

-- #region 7. A member who has left the team reads none of its seats
SELECT set_config('request.jwt.claims', '', true);
UPDATE org.team_members SET status = 'left', left_at = now()
 WHERE team_id = current_setting('probe.team')::uuid AND user_id = current_setting('probe.member')::uuid;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.member'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM projects.get_viewer_stage_seats(current_setting('probe.project')::uuid)) THEN
        RAISE EXCEPTION 'FAIL a former member still reads the team''s seats';
    END IF;
    RAISE NOTICE 'PASS a former member reads no seat';
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
