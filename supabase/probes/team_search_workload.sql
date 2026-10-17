-- =============================================================================================
-- Probe: a team's search row carries its live W_i (Decision #235, closing #233 FLAG (a)) —
-- search.profiles_index.current_workload_intensity for a team is its active members' live W_i
-- (Σ projects.tickets.workload_intensity over claimed / in_progress / in_review tickets they hold),
-- the figure org.profiles_index's team `workload` computes, never the dead
-- org.teams.current_workload_intensity column. It stays fresh when a ticket changes intensity,
-- status or assignee and when a member leaves or rejoins.
--
-- Rollback-safe: one transaction, ends in ROLLBACK. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/team_search_workload.sql
--
-- Fixture (seeded): the team `northloop` with an active non-owner member L holding a live ticket, a
-- user U who is an active member of two teams, and a live ticket held by somebody other than U. Every
-- case runs and reports; a clean run prints only PASS notices, and any FAIL aborts the run at the end.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);
CREATE TEMP TABLE probe_fails (label text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE(p_ok, false) THEN
        RAISE NOTICE 'PASS %', p_label;
    ELSE
        INSERT INTO probe_fails VALUES (p_label);
        RAISE NOTICE 'FAIL % — %', p_label, p_why;
    END IF;
END $$;

-- A team's live W_i, summed as org.profiles_index's team branch sums it.
CREATE FUNCTION pg_temp.live(p_team uuid) RETURNS int LANGUAGE sql AS $$
    SELECT COALESCE((
        SELECT round(sum(tk.workload_intensity))::int
          FROM org.team_members tm
          JOIN projects.tickets tk ON tk.current_assignee_id = tm.user_id
                                  AND tk.status::text IN ('claimed', 'in_progress', 'in_review')
         WHERE tm.team_id = p_team AND tm.status = 'active'
    ), 0);
$$;

-- The team's figure in the search index.
CREATE FUNCTION pg_temp.indexed(p_team uuid) RETURNS int LANGUAGE sql AS $$
    SELECT pi.current_workload_intensity FROM search.profiles_index pi
     WHERE pi.entity_id = p_team AND pi.entity_type = 'team';
$$;

-- Every team whose search row disagrees with its live W_i or with org.profiles_index, or NULL.
CREATE FUNCTION pg_temp.drift() RETURNS text LANGUAGE sql AS $$
    SELECT string_agg(format('%s index=%s live=%s view=%s', t.slug, pi.current_workload_intensity,
                             pg_temp.live(t.id), v.workload), '; ')
      FROM org.teams t
      JOIN search.profiles_index pi ON pi.entity_id = t.id AND pi.entity_type = 'team'
      LEFT JOIN org.profiles_index v ON v.entity_id = t.id AND v.entity_type = 'team'
     WHERE pi.current_workload_intensity IS DISTINCT FROM pg_temp.live(t.id)
        OR (v.entity_id IS NOT NULL AND v.workload IS DISTINCT FROM pi.current_workload_intensity);
$$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_team uuid;
    v_lead uuid;
    v_lead_ticket uuid;
    v_multi uuid;
    v_move_ticket uuid;
BEGIN
    SELECT t.id INTO v_team FROM org.teams t WHERE t.slug = 'northloop';

    SELECT tm.user_id, tk.id INTO v_lead, v_lead_ticket
      FROM org.team_members tm
      JOIN org.teams t ON t.id = tm.team_id
      JOIN projects.tickets tk ON tk.current_assignee_id = tm.user_id
                              AND tk.status::text IN ('claimed', 'in_progress', 'in_review')
     WHERE tm.team_id = v_team AND tm.status = 'active' AND tm.user_id <> t.owner_user_id
     ORDER BY tk.id LIMIT 1;

    SELECT tm.user_id INTO v_multi
      FROM org.team_members tm WHERE tm.status = 'active'
     GROUP BY tm.user_id HAVING count(*) >= 2
     ORDER BY tm.user_id LIMIT 1;

    SELECT tk.id INTO v_move_ticket
      FROM projects.tickets tk
     WHERE tk.status::text IN ('claimed', 'in_progress', 'in_review')
       AND tk.current_assignee_id IS NOT NULL
       AND tk.current_assignee_id IS DISTINCT FROM v_multi
       AND tk.id IS DISTINCT FROM v_lead_ticket
     ORDER BY tk.id LIMIT 1;

    IF v_team IS NULL OR v_lead IS NULL OR v_multi IS NULL OR v_move_ticket IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (team %, lead %, two-team member %, ticket to move %) — deno task db:reset',
            v_team, v_lead, v_multi, v_move_ticket;
    END IF;

    INSERT INTO probe_ids VALUES
        ('team', v_team), ('lead', v_lead), ('lead_ticket', v_lead_ticket),
        ('multi', v_multi), ('move_ticket', v_move_ticket);
END $$;
-- #endregion

-- #region 1. The seeded index already carries the live figure
SELECT pg_temp.check('seeded: every team row = live W_i = org.profiles_index workload',
    pg_temp.drift() IS NULL, pg_temp.drift());
-- #endregion

-- #region 2. Rewriting the team row never resurrects the dead column
UPDATE org.teams SET current_workload_intensity = 77 WHERE id = pg_temp.id('team');
SELECT pg_temp.check('team row rewrite: index ignores org.teams.current_workload_intensity',
    pg_temp.indexed(pg_temp.id('team')) = pg_temp.live(pg_temp.id('team')) AND pg_temp.drift() IS NULL,
    format('index %s, live %s; %s', pg_temp.indexed(pg_temp.id('team')), pg_temp.live(pg_temp.id('team')),
           pg_temp.drift()));
-- #endregion

-- #region 3. A ticket's intensity moves the team's figure
DO $$
DECLARE
    v_before int := pg_temp.indexed(pg_temp.id('team'));
BEGIN
    UPDATE projects.tickets SET workload_intensity = workload_intensity + 3 WHERE id = pg_temp.id('lead_ticket');
    PERFORM pg_temp.check('intensity +3: the team row rises by 3',
        pg_temp.indexed(pg_temp.id('team')) = v_before + 3 AND pg_temp.drift() IS NULL,
        format('before %s, after %s; %s', v_before, pg_temp.indexed(pg_temp.id('team')), pg_temp.drift()));
END $$;
-- #endregion

-- #region 4. A member leaving takes their load with them; rejoining brings it back
DO $$
DECLARE
    v_before int := pg_temp.indexed(pg_temp.id('team'));
    v_after_leave int;
BEGIN
    UPDATE org.team_members SET status = 'left', left_at = now()
     WHERE team_id = pg_temp.id('team') AND user_id = pg_temp.id('lead');
    v_after_leave := pg_temp.indexed(pg_temp.id('team'));
    PERFORM pg_temp.check('member leaves: the team row drops by their W_i',
        v_after_leave < v_before AND pg_temp.drift() IS NULL,
        format('before %s, after %s; %s', v_before, v_after_leave, pg_temp.drift()));

    UPDATE org.team_members SET status = 'active', left_at = NULL
     WHERE team_id = pg_temp.id('team') AND user_id = pg_temp.id('lead');
    PERFORM pg_temp.check('member rejoins: the team row returns',
        pg_temp.indexed(pg_temp.id('team')) = v_before AND pg_temp.drift() IS NULL,
        format('expected %s, got %s; %s', v_before, pg_temp.indexed(pg_temp.id('team')), pg_temp.drift()));
END $$;
-- #endregion

-- #region 5. Reassigning a ticket refreshes the old holder's teams and every team of the new one
UPDATE projects.tickets SET current_assignee_id = pg_temp.id('multi') WHERE id = pg_temp.id('move_ticket');
SELECT pg_temp.check('reassign to a two-team member: old and new teams all = live',
    pg_temp.drift() IS NULL, pg_temp.drift());
-- #endregion

-- #region 6. A ticket leaving the live statuses drops out of the figure
DO $$
DECLARE
    v_before int := pg_temp.indexed(pg_temp.id('team'));
BEGIN
    UPDATE projects.tickets SET status = 'completed' WHERE id = pg_temp.id('lead_ticket');
    PERFORM pg_temp.check('ticket completed: the team row drops',
        pg_temp.indexed(pg_temp.id('team')) < v_before AND pg_temp.drift() IS NULL,
        format('before %s, after %s; %s', v_before, pg_temp.indexed(pg_temp.id('team')), pg_temp.drift()));
END $$;
-- #endregion

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM probe_fails) THEN
        RAISE EXCEPTION 'team_search_workload: % case(s) failed: %',
            (SELECT count(*) FROM probe_fails), (SELECT string_agg(label, '; ') FROM probe_fails);
    END IF;
    RAISE NOTICE 'team_search_workload: all cases passed';
END $$;

ROLLBACK;
