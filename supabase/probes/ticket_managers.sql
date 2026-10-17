-- =============================================================================================
-- Probe: a business client's delegated ticket managers (Decision #294).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/ticket_managers.sql
--
-- The rule (product owner, 2026-10-17): a ticket's content is the client's. A freelancer never writes
-- it, except a project manager the BUSINESS client has explicitly let manage tickets on its behalf —
-- an `admin` / `manager` person seat carrying `project_participants.can_manage_tickets`, granted only
-- through projects.set_ticket_manager (review authority + `hire`, audited). The claim lock still binds
-- that manager as it binds the client: once a freelancer claims a ticket, its terms are frozen.
--
-- What is asserted: an ungranted manager writes no ticket; the grant refuses a non-reviewer, a
-- non-admin/manager seat, the caller's own seat and a direct table write; a granted manager composes
-- and edits unclaimed tickets but may not assign, move status, write the payment bookkeeping, delete,
-- or touch a claimed ticket's terms or stage; a granted manager who is the payee is still held to
-- their own claimed ticket; revoking, and a role change off the manager seat, end the grant. A clean
-- run prints only PASS notices; the first failed check raises `FAIL …` and aborts the run. Fixtures
-- are discovered from the seed (deno task db:reset); no ids are hard-coded.
-- =============================================================================================

BEGIN;
-- @prelude (in-flight definitions are spliced here when probing before a reset)

-- #region 0. Fixtures (as postgres)
-- A business project with a claimed ticket under way (its assignee no reviewer), another open stage, a
-- freelancer who can join it as a `manager` seat, and an unclaimed backlog ticket.
DO $$
DECLARE
    c record;
    v_user uuid;
    v_seat uuid;
    v_ticket uuid;
BEGIN
    FOR c IN
        SELECT t.id AS ticket, t.project_id AS project, t.current_stage_id AS stage,
               t.current_assignee_id AS assignee, p.owner_user_id AS owner,
               (SELECT s.id FROM projects.project_stages s
                 WHERE s.project_id = p.id AND s.id <> t.current_stage_id AND s.archived_at IS NULL
                 ORDER BY s.sort_order, s.id LIMIT 1) AS next_stage,
               (SELECT pp.id FROM projects.project_participants pp
                 WHERE pp.project_id = p.id AND pp.profile_type = 'freelancer'
                   AND pp.profile_id = t.current_assignee_id LIMIT 1) AS assignee_seat
        FROM projects.tickets t
        JOIN projects.projects p ON p.id = t.project_id
        WHERE t.status IN ('claimed'::ticket_status, 'in_progress'::ticket_status)
            AND p.client_business_id IS NOT NULL
            AND p.status NOT IN ('archived', 'cancelled', 'completed')
            AND t.current_assignee_id IS NOT NULL
            AND t.current_assignee_id <> p.owner_user_id
        ORDER BY t.id
    LOOP
        CONTINUE WHEN c.next_stage IS NULL OR c.assignee_seat IS NULL;
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', c.assignee, 'role', 'authenticated')::text, true);
        CONTINUE WHEN projects.can_review_project(c.project);
        PERFORM set_config('request.jwt.claims', '', true);

        -- A freelancer outside the project, seated as a manager the way an accepted invitation seats one.
        v_seat := NULL;
        FOR v_user IN
            SELECT fp.user_id FROM org.freelancer_profiles fp
            WHERE fp.user_id NOT IN (c.assignee, c.owner)
                AND NOT EXISTS (SELECT 1 FROM projects.project_participants pp
                                WHERE pp.project_id = c.project AND pp.profile_id = fp.user_id)
            ORDER BY fp.user_id
        LOOP
            BEGIN
                INSERT INTO projects.project_participants (project_id, profile_type, profile_id, role)
                VALUES (c.project, 'freelancer', v_user, 'manager')
                RETURNING id INTO v_seat;
            EXCEPTION WHEN OTHERS THEN
                CONTINUE;
            END;
            PERFORM set_config('request.jwt.claims',
                json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
            IF projects.has_project_access(c.project) AND NOT projects.can_review_project(c.project) THEN
                PERFORM set_config('request.jwt.claims', '', true);
                EXIT;
            END IF;
            PERFORM set_config('request.jwt.claims', '', true);
            DELETE FROM projects.project_participants WHERE id = v_seat;
            v_seat := NULL;
        END LOOP;
        CONTINUE WHEN v_seat IS NULL;

        INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description,
                                      unit_price_cents)
        VALUES (c.project, c.stage, 'probe unclaimed', jsonb_build_object('html', '<p>scope</p>'), 'scope', 50000)
        RETURNING id INTO v_ticket;

        PERFORM set_config('probe.ticket', c.ticket::text, true);
        PERFORM set_config('probe.open_ticket', v_ticket::text, true);
        PERFORM set_config('probe.project', c.project::text, true);
        PERFORM set_config('probe.stage', c.stage::text, true);
        PERFORM set_config('probe.next_stage', c.next_stage::text, true);
        PERFORM set_config('probe.assignee', c.assignee::text, true);
        PERFORM set_config('probe.assignee_seat', c.assignee_seat::text, true);
        PERFORM set_config('probe.owner', c.owner::text, true);
        PERFORM set_config('probe.manager', v_user::text, true);
        PERFORM set_config('probe.manager_seat', v_seat::text, true);
        RAISE NOTICE 'fixture ticket=% open_ticket=% project=% owner=% assignee=% manager=% seat=%',
            c.ticket, v_ticket, c.project, c.owner, c.assignee, v_user, v_seat;
        RETURN;
    END LOOP;
    RAISE EXCEPTION 'FAIL no fixture: need a business project with a claimed ticket, another stage and a joinable freelancer (deno task db:reset)';
END $$;

CREATE FUNCTION pg_temp.open_title() RETURNS text LANGUAGE sql AS $$
    SELECT title FROM projects.tickets WHERE id = current_setting('probe.open_ticket')::uuid;
$$;

-- Run one statement as a signed-in user and say how it ended: 'ok:<rows>', or 'SQLSTATE|message'.
CREATE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_rows bigint;
BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN 'ok:' || v_rows;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || '|' || SQLERRM;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.try(text) TO authenticated;

-- Assert `p_sql`, run as `p_user`, ends as `p_want` ('ok:1', 'ok:0', '42501', 'P0001', '23514' …).
-- The database's sentence is printed beside each refusal, so a PASS names the rule that refused it.
CREATE FUNCTION pg_temp.expect(p_label text, p_user text, p_sql text, p_want text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_got text;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting(p_user), 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_got := pg_temp.try(p_sql);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF split_part(v_got, '|', 1) IS DISTINCT FROM p_want THEN
        RAISE EXCEPTION 'FAIL % — wanted %, got %: %', p_label, p_want, v_got, p_sql;
    END IF;
    RAISE NOTICE 'PASS % (%)', p_label, v_got;
END;
$$;
-- #endregion

-- #region 1. A manager seat without the grant writes no ticket
DO $$
DECLARE
    v_open text := quote_literal(current_setting('probe.open_ticket'));
BEGIN
    PERFORM pg_temp.expect('ungranted manager edits nothing (RLS)', 'probe.manager',
        'UPDATE projects.tickets SET title = ''manager'' WHERE id = ' || v_open, 'ok:0');
    PERFORM pg_temp.expect('ungranted manager composes nothing (RLS)', 'probe.manager',
        format('INSERT INTO projects.tickets (project_id, current_stage_id, title, text_description) VALUES (%L, %L, ''m'', ''x'')',
            current_setting('probe.project'), current_setting('probe.stage')), '42501');
    IF pg_temp.open_title() <> 'probe unclaimed' THEN
        RAISE EXCEPTION 'FAIL the ungranted manager''s edit landed';
    END IF;
END $$;
-- #endregion

-- #region 2. Who may grant, and to whom
DO $$
BEGIN
    PERFORM pg_temp.expect('a manager cannot grant themselves', 'probe.manager',
        format('SELECT projects.set_ticket_manager(%L, %L, true)',
            current_setting('probe.project'), current_setting('probe.manager_seat')), '42501');
    PERFORM pg_temp.expect('the assignee cannot grant', 'probe.assignee',
        format('SELECT projects.set_ticket_manager(%L, %L, true)',
            current_setting('probe.project'), current_setting('probe.manager_seat')), '42501');
    PERFORM pg_temp.expect('only an admin/manager seat can hold the grant', 'probe.owner',
        format('SELECT projects.set_ticket_manager(%L, %L, true)',
            current_setting('probe.project'), current_setting('probe.assignee_seat')), '23514');
    PERFORM pg_temp.expect('the owner cannot write the flag directly', 'probe.owner',
        format('UPDATE projects.project_participants SET can_manage_tickets = true WHERE id = %L',
            current_setting('probe.manager_seat')), '42501');
END $$;
-- #endregion

-- #region 3. The owner grants — once, audited
DO $$
DECLARE
    v_res jsonb;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_res := projects.set_ticket_manager(current_setting('probe.project')::uuid,
        current_setting('probe.manager_seat')::uuid, true);
    IF NOT (v_res->>'changed')::boolean THEN
        RAISE EXCEPTION 'FAIL the grant reported no change: %', v_res;
    END IF;
    v_res := projects.set_ticket_manager(current_setting('probe.project')::uuid,
        current_setting('probe.manager_seat')::uuid, true);
    IF (v_res->>'changed')::boolean THEN
        RAISE EXCEPTION 'FAIL a repeated grant reported a change: %', v_res;
    END IF;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);

    IF NOT EXISTS (SELECT 1 FROM security.audit_logs a
                   WHERE a.action = 'project.ticket_manager_changed'
                     AND a.entity_id = current_setting('probe.manager_seat')::uuid) THEN
        RAISE EXCEPTION 'FAIL the grant was not audited';
    END IF;
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.manager'), 'role', 'authenticated')::text, true);
    IF NOT projects.is_ticket_manager(current_setting('probe.project')::uuid) THEN
        RAISE EXCEPTION 'FAIL the granted manager is not a ticket manager';
    END IF;
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE NOTICE 'PASS the owner granted ticket management once, audited';
END $$;
-- #endregion

-- #region 4. What a granted manager does — and does not
SAVEPOINT granted;
DO $$
DECLARE
    v_open text := quote_literal(current_setting('probe.open_ticket'));
    v_claimed text := quote_literal(current_setting('probe.ticket'));
BEGIN
    PERFORM pg_temp.expect('manager edits an unclaimed ticket''s content', 'probe.manager',
        'UPDATE projects.tickets SET title = ''edited for the client'', '
            || 'description = jsonb_build_object(''html'', ''<p>more scope</p>''), text_description = ''more scope'', '
            || 'unit_price_cents = 60000, priority = ''high'', '
            || 'tasks = jsonb_build_array(jsonb_build_object(''id'', gen_random_uuid(), ''text'', ''t'', ''done'', false)) '
            || 'WHERE id = ' || v_open, 'ok:1');
    PERFORM pg_temp.expect('manager moves an unclaimed ticket to another stage', 'probe.manager',
        format('UPDATE projects.tickets SET current_stage_id = %L WHERE id = %s',
            current_setting('probe.next_stage'), v_open), 'ok:1');
    PERFORM pg_temp.expect('manager composes an unassigned backlog ticket', 'probe.manager',
        format('INSERT INTO projects.tickets (project_id, current_stage_id, title, text_description, unit_price_cents) VALUES (%L, %L, ''composed'', ''x'', 1000)',
            current_setting('probe.project'), current_setting('probe.stage')), 'ok:1');

    PERFORM pg_temp.expect('manager cannot compose straight into work', 'probe.manager',
        format('INSERT INTO projects.tickets (project_id, current_stage_id, title, text_description, status) VALUES (%L, %L, ''c'', ''x'', ''in_progress'')',
            current_setting('probe.project'), current_setting('probe.stage')), '42501');
    PERFORM pg_temp.expect('manager cannot compose an assigned ticket', 'probe.manager',
        format('INSERT INTO projects.tickets (project_id, current_stage_id, title, text_description, current_assignee_id) VALUES (%L, %L, ''c'', ''x'', %L)',
            current_setting('probe.project'), current_setting('probe.stage'), current_setting('probe.assignee')), '42501');
    PERFORM pg_temp.expect('manager cannot assign on the table', 'probe.manager',
        format('UPDATE projects.tickets SET current_assignee_id = %L WHERE id = %s',
            current_setting('probe.assignee'), v_open), '42501');
    PERFORM pg_temp.expect('manager cannot set a status on the table', 'probe.manager',
        'UPDATE projects.tickets SET status = ''todo'' WHERE id = ' || v_open, '42501');
    PERFORM pg_temp.expect('manager cannot write the payment bookkeeping', 'probe.manager',
        'UPDATE projects.tickets SET payment_status = ''needs_funding'' WHERE id = ' || v_open, '42501');
    PERFORM pg_temp.expect('manager deletes nothing (RLS)', 'probe.manager',
        'DELETE FROM projects.tickets WHERE id = ' || v_open, 'ok:0');

    PERFORM pg_temp.expect('manager is held to a claimed ticket''s terms', 'probe.manager',
        'UPDATE projects.tickets SET unit_price_cents = COALESCE(unit_price_cents, 1) + 1 WHERE id = ' || v_claimed,
        'P0001');
    PERFORM pg_temp.expect('manager cannot reword a claimed ticket', 'probe.manager',
        'UPDATE projects.tickets SET title = title || '' (manager)'' WHERE id = ' || v_claimed, 'P0001');
    PERFORM pg_temp.expect('manager cannot move a claimed ticket''s stage', 'probe.manager',
        format('SELECT projects.move_ticket(%s, ''in_progress'', %L)', v_claimed, current_setting('probe.next_stage')),
        '42501');
    PERFORM pg_temp.expect('manager cannot grant anyone else', 'probe.manager',
        format('SELECT projects.set_ticket_manager(%L, %L, false)',
            current_setting('probe.project'), current_setting('probe.manager_seat')), '42501');
END $$;
ROLLBACK TO granted;
-- #endregion

-- #region 4b. A granted manager who is the payee is still held to their own claimed ticket
SAVEPOINT payee_manager;
UPDATE projects.project_participants SET role = 'manager' WHERE id = current_setting('probe.assignee_seat')::uuid;
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM projects.set_ticket_manager(current_setting('probe.project')::uuid,
        current_setting('probe.assignee_seat')::uuid, true);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);

    PERFORM pg_temp.expect('a manager-payee cannot reprice their own claimed ticket', 'probe.assignee',
        format('UPDATE projects.tickets SET unit_price_cents = COALESCE(unit_price_cents, 1) * 10 WHERE id = %L',
            current_setting('probe.ticket')), '42501');
END $$;
ROLLBACK TO payee_manager;
-- #endregion

-- #region 5. Revoking, and a role change off the seat, end the grant
DO $$
DECLARE
    v_open text := quote_literal(current_setting('probe.open_ticket'));
    v_res jsonb;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_res := projects.set_ticket_manager(current_setting('probe.project')::uuid,
        current_setting('probe.manager_seat')::uuid, false);
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT (v_res->>'changed')::boolean THEN
        RAISE EXCEPTION 'FAIL the revoke reported no change: %', v_res;
    END IF;
    PERFORM pg_temp.expect('a revoked manager edits nothing', 'probe.manager',
        'UPDATE projects.tickets SET title = ''after revoke'' WHERE id = ' || v_open, 'ok:0');

    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM projects.set_ticket_manager(current_setting('probe.project')::uuid,
        current_setting('probe.manager_seat')::uuid, true);
    PERFORM projects.set_member_role(current_setting('probe.project')::uuid,
        current_setting('probe.manager_seat')::uuid, 'freelancer');
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF (SELECT can_manage_tickets FROM projects.project_participants
        WHERE id = current_setting('probe.manager_seat')::uuid) THEN
        RAISE EXCEPTION 'FAIL a role change off the manager seat kept the grant';
    END IF;
    PERFORM pg_temp.expect('a former manager edits nothing', 'probe.manager',
        'UPDATE projects.tickets SET title = ''after role change'' WHERE id = ' || v_open, 'ok:0');
    RAISE NOTICE 'PASS revoking and a role change both end the grant';
END $$;
-- #endregion

-- #region 6. Only a business client delegates its tickets
DO $$
DECLARE
    c record;
    v_seat uuid;
BEGIN
    SELECT p.id AS project, p.owner_user_id AS owner INTO c
    FROM projects.projects p
    WHERE p.client_business_id IS NULL
        AND NOT p.is_personal
        AND p.status NOT IN ('archived', 'cancelled', 'completed')
    ORDER BY p.id LIMIT 1;
    IF c.project IS NULL THEN
        RAISE NOTICE 'SKIP no individual-client project in the seed';
        RETURN;
    END IF;
    INSERT INTO projects.project_participants (project_id, profile_type, profile_id, role)
    VALUES (c.project, 'freelancer', current_setting('probe.manager')::uuid, 'manager')
    RETURNING id INTO v_seat;
    PERFORM set_config('probe.other_owner', c.owner::text, true);
    PERFORM pg_temp.expect('an individual client cannot delegate tickets', 'probe.other_owner',
        format('SELECT projects.set_ticket_manager(%L, %L, true)', c.project, v_seat), '23514');
END $$;
-- #endregion

ROLLBACK;
