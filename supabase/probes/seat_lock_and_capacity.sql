-- =============================================================================================
-- Probe: a taken seat cannot be un-taken, a pin needs a seat, and capacity counts what is held
-- (PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md X4, X8, W7). PM-WP2.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/seat_lock_and_capacity.sql
--
-- THE DEFECTS, found by reading on 2026-10-29:
--   • stage_assignments.status was free text, and the owner's FOR ALL policy let a taken seat be
--     flipped to `declined`, re-pointed or deleted — which lifted the shape and price locks that read
--     it;
--   • assign_ticket_manual pinned anyone, hired on the stage or not;
--   • check_ticket_capacity left `reported_hidden` tickets out of the sums (a reporter freed their own
--     capacity), read them unlocked (two concurrent claims could both pass), and labelled a stage-cap
--     refusal `project`.
-- PROJECTS ST3 (Decision #547), 2026-11-24: a client could neither set a stage to manual
-- (set_stage_assignment_mode had no grant) nor pin through any product path, and a pin bound the
-- ticket at once, with no acceptance and no IP Transfer Deed. Region 4: manual routing through its
-- door, the planned modes refused, a pin that reserves (seat, cap, manual stage) and the pinned
-- freelancer's accept-by-claim or decline.
--
-- A clean run prints only PASS notices; the first failed check raises `FAIL …`. Fixtures are
-- discovered from the seed (deno task db:reset) or created inside the transaction.
-- =============================================================================================

BEGIN;

-- #region 0. Helpers and fixtures (as postgres)
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_state text, p_label text, p_like text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'FAIL % — the statement succeeded', p_label;
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
    IF p_state IS NOT NULL AND SQLSTATE <> p_state THEN
        RAISE EXCEPTION 'FAIL % — expected %, got % %', p_label, p_state, SQLSTATE, SQLERRM;
    END IF;
    IF p_like IS NOT NULL AND SQLERRM NOT LIKE p_like THEN
        RAISE EXCEPTION 'FAIL % — unexpected message: %', p_label, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

DO $$
DECLARE
    c record;
BEGIN
    SELECT sa.id AS seat, sa.project_stage_id AS stage, sa.freelancer_profile_id AS freelancer,
           p.id AS project, p.owner_user_id AS owner,
           (SELECT s.id FROM projects.project_stages s
             WHERE s.project_id = p.id AND s.id <> sa.project_stage_id ORDER BY s.sort_order LIMIT 1) AS sibling
      INTO c
      FROM projects.stage_assignments sa
      JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
      JOIN projects.projects p ON p.id = ps.project_id
     WHERE sa.assignee_type = 'freelancer' AND sa.status = 'accepted'
       AND p.format = 'pipeline' AND sa.freelancer_profile_id <> p.owner_user_id
     ORDER BY sa.id LIMIT 1;
    IF c.seat IS NULL OR c.sibling IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need an accepted freelancer seat on a multi-stage pipeline';
    END IF;
    PERFORM set_config('probe.seat', c.seat::text, true);
    PERFORM set_config('probe.stage', c.stage::text, true);
    PERFORM set_config('probe.sibling', c.sibling::text, true);
    PERFORM set_config('probe.freelancer', c.freelancer::text, true);
    PERFORM set_config('probe.project', c.project::text, true);
    PERFORM set_config('probe.owner', c.owner::text, true);
    -- A freelancer with no seat anywhere on this project.
    PERFORM set_config('probe.stranger', (
        SELECT fp.user_id::text FROM org.freelancer_profiles fp
         WHERE fp.user_id <> c.owner AND NOT EXISTS (
             SELECT 1 FROM projects.stage_assignments x
               JOIN projects.project_stages s ON s.id = x.project_stage_id
              WHERE s.project_id = c.project AND x.freelancer_profile_id = fp.user_id)
         ORDER BY fp.user_id LIMIT 1), true);
    RAISE NOTICE 'fixture seat=% stage=% project=% owner=% freelancer=%',
        c.seat, c.stage, c.project, c.owner, c.freelancer;
END $$;
-- #endregion

-- #region 1. X8 — the seat vocabulary and the taken-seat guard
SELECT pg_temp.expect_error(format(
    $q$INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
       VALUES (%L, 'freelancer', %L, %L, 'active')$q$,
    current_setting('probe.sibling'), current_setting('probe.freelancer'), current_setting('probe.owner')),
    '23514', 'an unknown seat status is refused by ck_stage_assignments_status');

SELECT pg_temp.expect_error(format(
    'UPDATE projects.stage_assignments SET status = ''declined'' WHERE id = %L', current_setting('probe.seat')),
    '23514', 'a taken seat cannot be flipped to declined', '%cannot be returned%');
SELECT pg_temp.expect_error(format(
    'UPDATE projects.stage_assignments SET status = ''pending_funding'' WHERE id = %L', current_setting('probe.seat')),
    '23514', 'a taken seat cannot be parked back at pending_funding');
SELECT pg_temp.expect_error(format(
    'UPDATE projects.stage_assignments SET project_stage_id = %L WHERE id = %L',
    current_setting('probe.sibling'), current_setting('probe.seat')),
    '23514', 'a taken seat cannot be re-pointed at another stage', '%stays on its stage%');
SELECT pg_temp.expect_error(format(
    'DELETE FROM projects.stage_assignments WHERE id = %L', current_setting('probe.seat')),
    '23514', 'a taken seat cannot be deleted', '%cannot be deleted%');

DO $$
DECLARE
    v_free uuid;
BEGIN
    -- Forward through the taken states is allowed.
    UPDATE projects.stage_assignments SET status = 'completed' WHERE id = current_setting('probe.seat')::uuid;
    UPDATE projects.stage_assignments SET status = 'accepted' WHERE id = current_setting('probe.seat')::uuid;
    RAISE NOTICE 'PASS a taken seat still moves between taken states';

    -- A seat that was never taken stays free to change and to remove.
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
    VALUES (current_setting('probe.sibling')::uuid, 'freelancer', current_setting('probe.stranger')::uuid,
            current_setting('probe.owner')::uuid, 'pending_funding')
    RETURNING id INTO v_free;
    UPDATE projects.stage_assignments SET status = 'declined' WHERE id = v_free;
    DELETE FROM projects.stage_assignments WHERE id = v_free;
    RAISE NOTICE 'PASS an untaken seat is declined and deleted freely';
END $$;

-- The shape lock it protects still holds after the refused flips.
SELECT pg_temp.expect_error(format(
    'UPDATE projects.projects SET structure_variation = ''single_stage'' WHERE id = %L', current_setting('probe.project')),
    '23514', 'the shape lock still holds on the staffed project', '%cannot be modified%');
-- #endregion

-- #region 2. X8 / P0 4 — assign_ticket_manual needs a live seat on the ticket's stage
DO $$
DECLARE
    v_ticket uuid;
BEGIN
    -- A pin is a manual stage's (ST3); region 4 drives the mode through its door.
    UPDATE projects.project_stages SET assignment_mode = 'manual' WHERE id = current_setting('probe.stage')::uuid;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, status)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid,
            'probe: manual pin', '{"html":"<p>work</p>"}'::jsonb, 'todo')
    RETURNING id INTO v_ticket;
    PERFORM set_config('probe.ticket', v_ticket::text, true);
END $$;

DO $$
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM projects.assign_ticket_manual(current_setting('probe.ticket')::uuid, current_setting('probe.stranger')::uuid);
        RAISE EXCEPTION 'FAIL a seat-less pin succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
        IF SQLSTATE <> '23514' OR SQLERRM NOT LIKE '%not hired on this ticket''s stage%' THEN
            RAISE EXCEPTION 'FAIL seat-less pin refused for the wrong reason: % %', SQLSTATE, SQLERRM;
        END IF;
        RAISE NOTICE 'PASS a pin to someone with no seat on the stage is refused';
    END;
    -- The seated freelancer passes the seat check (payout, cap or funding gates may still answer).
    BEGIN
        PERFORM projects.assign_ticket_manual(current_setting('probe.ticket')::uuid, current_setting('probe.freelancer')::uuid);
        RAISE NOTICE 'PASS the seated freelancer is pinned';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%not hired on this ticket''s stage%' THEN
            RAISE EXCEPTION 'FAIL the seated freelancer was refused as seat-less';
        END IF;
        RAISE NOTICE 'PASS the seated freelancer clears the seat check (then: %)', SQLERRM;
    END;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;
-- #endregion

-- #region 3. X4 / W7 — capacity counts suspended work, is serialised, and names the stage cap
DO $$
DECLARE
    v_held uuid;
    v_open uuid;
    v_verdict jsonb;
    v_cap numeric;
BEGIN
    SELECT COALESCE(fp.max_workload_intensity, 10) INTO v_cap
      FROM org.freelancer_profiles fp WHERE fp.user_id = current_setting('probe.stranger')::uuid;
    v_cap := COALESCE(v_cap, 10);

    -- A suspended ticket the stranger still holds, worth all but one unit of their cap.
    INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, description,
                                  status, workload_intensity)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.sibling')::uuid,
            current_setting('probe.stranger')::uuid, 'probe: suspended', '{"html":"<p>x</p>"}'::jsonb,
            'reported_hidden', v_cap - 1)
    RETURNING id INTO v_held;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, status, workload_intensity)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid,
            'probe: open', '{"html":"<p>x</p>"}'::jsonb, 'todo', 2)
    RETURNING id INTO v_open;

    v_verdict := projects.check_ticket_capacity(v_open, current_setting('probe.stranger')::uuid);
    IF (v_verdict ->> 'allowed')::boolean OR v_verdict ->> 'scope' <> 'global' THEN
        RAISE EXCEPTION 'FAIL a reported_hidden ticket was left out of the global sum: %', v_verdict;
    END IF;
    RAISE NOTICE 'PASS a suspended ticket still counts against the global cap';

    IF NOT EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid()) THEN
        RAISE EXCEPTION 'FAIL check_ticket_capacity took no per-user lock';
    END IF;
    IF (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'projects.check_ticket_capacity(uuid,uuid)'::regprocedure) <> 'v' THEN
        RAISE EXCEPTION 'FAIL check_ticket_capacity is not VOLATILE (a STABLE body reads one snapshot past the lock)';
    END IF;
    RAISE NOTICE 'PASS the check is volatile and serialised per user';

    -- The stage cap: move the suspended ticket onto the open one's stage at a small W_i and cap the stage.
    UPDATE projects.tickets SET workload_intensity = 2, current_stage_id = current_setting('probe.stage')::uuid
     WHERE id = v_held;
    UPDATE projects.project_stages SET max_concurrent_intensity = 3 WHERE id = current_setting('probe.stage')::uuid;
    v_verdict := projects.check_ticket_capacity(v_open, current_setting('probe.stranger')::uuid);
    IF (v_verdict ->> 'allowed')::boolean OR v_verdict ->> 'scope' <> 'stage' THEN
        RAISE EXCEPTION 'FAIL the stage cap did not refuse with scope stage: %', v_verdict;
    END IF;
    RAISE NOTICE 'PASS the stage cap refuses with scope stage, counting the suspended ticket';
END $$;
-- #endregion

-- #region 4. ST3 — a client routes a stage by hand: manual mode, a pin the freelancer accepts or declines
-- Run one statement as `p_who` (a probe.* setting holding a user id), signed in as `authenticated`.
CREATE FUNCTION pg_temp.run_as(p_who text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.' || p_who), 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;

CREATE FUNCTION pg_temp.refused_as(p_who text, p_sql text, p_state text, p_label text, p_like text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.run_as(p_who, p_sql);
    RAISE EXCEPTION 'FAIL % — the statement succeeded', p_label;
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
    IF p_state IS NOT NULL AND SQLSTATE <> p_state THEN
        RAISE EXCEPTION 'FAIL % — expected %, got % %', p_label, p_state, SQLSTATE, SQLERRM;
    END IF;
    IF p_like IS NOT NULL AND SQLERRM NOT LIKE p_like THEN
        RAISE EXCEPTION 'FAIL % — unexpected message: %', p_label, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- Fresh state: open pull, no stage cap, and two open tickets on the seated stage.
DO $$
DECLARE
    v_id uuid;
BEGIN
    UPDATE projects.project_stages SET assignment_mode = 'open_pull', max_concurrent_intensity = NULL
     WHERE id = current_setting('probe.stage')::uuid;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, status, workload_intensity)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid,
            'probe: pin me', '{"html":"<p>work</p>"}'::jsonb, 'todo', 1)
    RETURNING id INTO v_id;
    PERFORM set_config('probe.pin', v_id::text, true);
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, status, workload_intensity)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid,
            'probe: too heavy', '{"html":"<p>work</p>"}'::jsonb, 'todo',
            COALESCE((SELECT fp.max_workload_intensity FROM org.freelancer_profiles fp
                       WHERE fp.user_id = current_setting('probe.freelancer')::uuid), 10) + 1)
    RETURNING id INTO v_id;
    PERFORM set_config('probe.heavy', v_id::text, true);
END $$;

-- Planned modes stay closed (#338 P3); only review authority routes a stage.
SELECT pg_temp.refused_as('owner', format('SELECT projects.set_stage_assignment_mode(%L, ''round_robin'')',
    current_setting('probe.stage')), '0A000', 'round robin is refused while it is Planned', '%planned%');
SELECT pg_temp.refused_as('owner', format('SELECT projects.set_stage_assignment_mode(%L, ''parallel_stream'')',
    current_setting('probe.stage')), '0A000', 'parallel stream is refused while it is Planned', '%planned%');
SELECT pg_temp.refused_as('freelancer', format('SELECT projects.set_stage_assignment_mode(%L, ''manual'')',
    current_setting('probe.stage')), '42501', 'a seated freelancer cannot route the stage');

-- A pin needs a manual stage.
SELECT pg_temp.refused_as('owner', format('SELECT projects.assign_ticket_manual(%L, %L)',
    current_setting('probe.pin'), current_setting('probe.freelancer')),
    '23514', 'a pin on an open-pull stage is refused', '%manual%');

SELECT pg_temp.run_as('owner', format('SELECT projects.set_stage_assignment_mode(%L, ''manual'')',
    current_setting('probe.stage')));
DO $$
BEGIN
    IF (SELECT assignment_mode::text FROM projects.project_stages WHERE id = current_setting('probe.stage')::uuid) <> 'manual' THEN
        RAISE EXCEPTION 'FAIL the client''s switch to manual did not land';
    END IF;
    RAISE NOTICE 'PASS the client sets the stage to manual through its granted door';
END $$;

-- Who may be pinned, and by whom.
SELECT pg_temp.refused_as('owner', format('SELECT projects.assign_ticket_manual(%L, %L)',
    current_setting('probe.pin'), current_setting('probe.stranger')),
    '23514', 'a pin to someone with no live seat is refused', '%not hired on this ticket''s stage%');
SELECT pg_temp.refused_as('freelancer', format('SELECT projects.assign_ticket_manual(%L, %L)',
    current_setting('probe.pin'), current_setting('probe.freelancer')),
    '42501', 'a freelancer cannot pin a ticket, even to themselves');
SELECT pg_temp.refused_as('owner', format('SELECT projects.assign_ticket_manual(%L, %L)',
    current_setting('probe.heavy'), current_setting('probe.freelancer')),
    '23514', 'a pin over the freelancer''s cap is refused', '%against their % cap of %');
SELECT pg_temp.refused_as('freelancer', format('SELECT projects.claim_ticket(%L, %L)',
    current_setting('probe.pin'), current_setting('probe.freelancer')),
    '23514', 'an unpinned ticket on a manual stage is not self-claimed', '%routed by the project owner%');
SELECT pg_temp.refused_as('owner', format('UPDATE projects.tickets SET pinned_assignee_id = %L WHERE id = %L',
    current_setting('probe.freelancer'), current_setting('probe.pin')),
    '42501', 'a pin is never written to the ticket directly');

-- The pin reserves; it holds nothing and tells the assignee.
SELECT pg_temp.run_as('owner', format('SELECT projects.assign_ticket_manual(%L, %L)',
    current_setting('probe.pin'), current_setting('probe.freelancer')));
DO $$
DECLARE
    t record;
BEGIN
    SELECT pinned_assignee_id, current_assignee_id, status::text AS status, claimed_at INTO t
      FROM projects.tickets WHERE id = current_setting('probe.pin')::uuid;
    IF t.pinned_assignee_id IS DISTINCT FROM current_setting('probe.freelancer')::uuid THEN
        RAISE EXCEPTION 'FAIL the pin was not recorded: %', t.pinned_assignee_id;
    END IF;
    IF t.current_assignee_id IS NOT NULL OR t.claimed_at IS NOT NULL OR t.status <> 'todo' THEN
        RAISE EXCEPTION 'FAIL a pin bound the ticket before the freelancer accepted: % % %',
            t.current_assignee_id, t.claimed_at, t.status;
    END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id = current_setting('probe.pin')::uuid AND e.status = 'held') THEN
        RAISE EXCEPTION 'FAIL a pin held escrow';
    END IF;
    RAISE NOTICE 'PASS the pin reserves the ticket and holds nothing';
    IF NOT EXISTS (SELECT 1 FROM comms.notifications n
                    WHERE n.user_id = current_setting('probe.freelancer')::uuid AND n.type = 'ticket.assigned'
                      AND n.entity_id = current_setting('probe.pin')::uuid) THEN
        RAISE EXCEPTION 'FAIL the pinned freelancer was not told (ticket.assigned)';
    END IF;
    RAISE NOTICE 'PASS the pinned freelancer is told';
END $$;

-- Only the pinned freelancer declines; declining clears the pin and tells the client.
SELECT pg_temp.refused_as('stranger', format('SELECT projects.decline_ticket_pin(%L)', current_setting('probe.pin')),
    '42501', 'someone else cannot decline the pin');
SELECT pg_temp.run_as('freelancer', format('SELECT projects.decline_ticket_pin(%L)', current_setting('probe.pin')));
DO $$
BEGIN
    IF (SELECT pinned_assignee_id FROM projects.tickets WHERE id = current_setting('probe.pin')::uuid) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL the decline left the pin in place';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM comms.notifications n
                    WHERE n.user_id = current_setting('probe.owner')::uuid AND n.type = 'ticket.pin_declined'
                      AND n.entity_id = current_setting('probe.pin')::uuid) THEN
        RAISE EXCEPTION 'FAIL the client was not told of the decline (ticket.pin_declined)';
    END IF;
    RAISE NOTICE 'PASS the pinned freelancer declines, and the client is told';
END $$;

-- Accepting is the freelancer's own claim, with the IP Transfer Deed it asks: the routing check lets
-- the pinned person through, a claim that lands consumes the pin, and one whose hold is refused
-- (Needs funding, #165) leaves the pin for the next try.
SELECT pg_temp.refused_as('freelancer', format('SELECT projects.claim_ticket(%L, %L)',
    current_setting('probe.pin'), current_setting('probe.freelancer')),
    '23514', 'the declined ticket is no longer the freelancer''s to accept', '%routed by the project owner%');
SELECT pg_temp.run_as('owner', format('SELECT projects.assign_ticket_manual(%L, %L)',
    current_setting('probe.pin'), current_setting('probe.freelancer')));
DO $$
DECLARE
    v_landed boolean := false;
BEGIN
    BEGIN
        PERFORM pg_temp.run_as('freelancer', format('SELECT projects.claim_ticket(%L, %L, %L::jsonb)',
            current_setting('probe.pin'), current_setting('probe.freelancer'),
            jsonb_build_object('ip-transfer-deed', org.fn_current_legal_version('ip-transfer-deed'))));
        v_landed := (SELECT current_assignee_id FROM projects.tickets WHERE id = current_setting('probe.pin')::uuid)
            IS NOT DISTINCT FROM current_setting('probe.freelancer')::uuid;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%routed by the project owner%' THEN
            RAISE EXCEPTION 'FAIL the pinned freelancer''s acceptance was refused as a self-claim';
        END IF;
        RAISE NOTICE 'PASS the pinned freelancer clears the routing check (then: %)', SQLERRM;
    END;
    IF v_landed THEN
        IF (SELECT pinned_assignee_id FROM projects.tickets WHERE id = current_setting('probe.pin')::uuid) IS NOT NULL THEN
            RAISE EXCEPTION 'FAIL the accepted pin was not consumed';
        END IF;
        RAISE NOTICE 'PASS the pinned freelancer accepts by claiming, and the pin is consumed';
    ELSIF (SELECT pinned_assignee_id FROM projects.tickets WHERE id = current_setting('probe.pin')::uuid)
            IS DISTINCT FROM current_setting('probe.freelancer')::uuid THEN
        RAISE EXCEPTION 'FAIL an acceptance that did not land dropped the pin';
    ELSE
        RAISE NOTICE 'PASS an acceptance that did not land keeps the pin';
    END IF;
END $$;

-- Back to open pull: pins clear and planned modes are still refused.
DO $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, status)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid,
            'probe: pinned, then reopened', '{"html":"<p>work</p>"}'::jsonb, 'todo')
    RETURNING id INTO v_id;
    PERFORM set_config('probe.reopen', v_id::text, true);
END $$;
SELECT pg_temp.run_as('owner', format('SELECT projects.assign_ticket_manual(%L, %L)',
    current_setting('probe.reopen'), current_setting('probe.freelancer')));
SELECT pg_temp.run_as('owner', format('SELECT projects.set_stage_assignment_mode(%L, ''open_pull'')',
    current_setting('probe.stage')));
DO $$
BEGIN
    IF (SELECT pinned_assignee_id FROM projects.tickets WHERE id = current_setting('probe.reopen')::uuid) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL a pin outlived the stage''s switch back to open pull';
    END IF;
    RAISE NOTICE 'PASS switching back to open pull clears the stage''s pins';
END $$;
-- #endregion

ROLLBACK;
