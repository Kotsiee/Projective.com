-- =============================================================================================
-- Probe: a reschedule vote past its deadline settles with nobody reading it
-- (SCHEDULING_COMPLETENESS_AUDIT S-13; OPERATIONS_BUILD_PROMPTS OPS2; PRD-G4).
--
--   0. The contract fixtures: one vote per row, on its own entry. coordination.contract.test.ts reads
--      the rows between the two @contract-fixtures markers out of this file and settles each with
--      `settleVote`, so the SQL sweep and the TypeScript rule are held to one expected outcome.
--   1. Before the sweep every fixture round is past its deadline at the probe's clock and still
--      `voting`: nothing records a decided vote until somebody reads it. A round the read path closes
--      first (through close_reschedule_round, as live-calendar.ts does) is the control.
--   2. p_limit: a run of 3 closes the 3 earliest deadlines and nothing else.
--   3. The rest settle as their fixture says: a majority resolves and the entry moves to its slot;
--      no majority lapses and the time stands; optional seats vote and count; a guest's, a withdrawn
--      seat's and the host's ballots do not count.
--   4. Each notice once: everyone with an account on a moved entry hears "New time" once, its guest
--      is mailed once, each entry gets one history line; a second run returns 0 and tells nobody
--      again, and the read path's round is neither closed again nor announced again.
--   5. A failure is not silent: a round whose close raises is logged (WARNING + ops.log_entries,
--      `settle_failed`), the run settles the others, and the next run settles it.
--   6. Only the service role (and pg_cron) may run it; the registry runs it at :11/:26/:41/:56 under
--      the name the dormant 00005060 row waits for, and ops.run_job (what `deno task cron:run`
--      calls) finds nothing left.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   deno task test:probes settle_votes
--
-- A clean run prints only PASS notices (and the WARNING section 5 provokes); any failure raises
-- `PROBE FAIL …` and aborts. Fixtures are built on seeded people; no ids are hard-coded. The seed's
-- own live votes are set aside first, so every count below is the fixtures' alone.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

-- #region 0. The contract fixtures
-- `seats`: the roster, one token per seat, `<seat>:<ballot>`. A seat is `host`, `participant`,
-- `optional`, `guest` (no account) or `withdrawn` (a participant the host withdrew after it voted). A
-- ballot is `A` or `B`, the host's two slots (A the earlier), or `-` for none. `expect` is how the
-- round comes to rest once its deadline has passed: `resolved:<slot>` or `lapsed`. `n` orders the
-- deadlines.
CREATE TEMP TABLE probe_fixture (
    n integer PRIMARY KEY,
    name text NOT NULL UNIQUE,
    seats text NOT NULL,
    expect text NOT NULL,
    event_id uuid,
    round_id uuid,
    slot_a uuid,
    slot_b uuid,
    starts_at timestamptz
) ON COMMIT DROP;

INSERT INTO probe_fixture (n, name, seats, expect) VALUES
-- @contract-fixtures begin
    (1,  'majority',         'host participant:A participant:A participant:B guest:-',          'resolved:A'),
    (2,  'plurality',        'host participant:A participant:B participant:- participant:-',    'lapsed'),
    (3,  'exactly_half',     'host participant:B participant:B participant:A participant:-',    'lapsed'),
    (4,  'optional_counts',  'host participant:B optional:B optional:- optional:-',             'lapsed'),
    (5,  'optional_carries', 'host participant:- optional:B optional:B',                        'resolved:B'),
    (6,  'guest_ballots',    'host participant:A participant:- participant:- guest:A guest:A',  'lapsed'),
    (7,  'withdrawn_ballot', 'host participant:B participant:- withdrawn:B',                    'lapsed'),
    (8,  'host_ballot',      'host:A participant:A participant:- participant:-',                'lapsed'),
    (9,  'unanimous',        'host participant:B participant:B participant:B',                  'resolved:B'),
    (10, 'nobody_voted',     'host participant:- participant:- participant:-',                  'lapsed')
-- @contract-fixtures end
;
-- #endregion

-- #region 0b. Helpers and the fixture build (as postgres)
CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'PROBE FAIL %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- One entry on the host's calendar with the fixture's roster, a vote round holding the host's two
-- slots, its ballots cast and its withdrawn seats withdrawn: the state a vote is in once its last
-- ballot is in and nobody has looked since. Written as the writer writes it (the service role's path,
-- here the owner): collecting, the ballot, then `voting`, which stamps the deadline.
CREATE FUNCTION pg_temp.build(p_n integer, p_seats text, p_host uuid, p_schedule uuid, p_people uuid[], p_base timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_start timestamptz := p_base + pg_catalog.make_interval(hours => p_n);
    v_event uuid;
    v_round uuid;
    v_a uuid;
    v_b uuid;
    v_tok text;
    v_seat_kind text;
    v_ballot text;
    v_seat uuid;
    v_i integer := 0;
    v_person integer := 0;
    v_withdrawn uuid[] := '{}';
BEGIN
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (p_schedule, 'sync', 'Probe vote ' || p_n, v_start, v_start + interval '1 hour', p_host)
    RETURNING id INTO v_event;

    INSERT INTO scheduling.event_reschedules (event_id, round, mode, status, opened_by_user_id, opened_at)
    VALUES (v_event, 0, 'vote', 'collecting', p_host, pg_catalog.now())
    RETURNING id INTO v_round;
    INSERT INTO scheduling.reschedule_proposals
        (reschedule_id, starts_at, ends_at, proposed_by_user_id, proposed_by_role, approved)
    VALUES (v_round, v_start + interval '2 days', v_start + interval '2 days 1 hour', p_host, 'host', true)
    RETURNING id INTO v_a;
    INSERT INTO scheduling.reschedule_proposals
        (reschedule_id, starts_at, ends_at, proposed_by_user_id, proposed_by_role, approved)
    VALUES (v_round, v_start + interval '3 days', v_start + interval '3 days 1 hour', p_host, 'host', true)
    RETURNING id INTO v_b;

    FOREACH v_tok IN ARRAY pg_catalog.string_to_array(p_seats, ' ') LOOP
        v_i := v_i + 1;
        v_seat_kind := pg_catalog.split_part(v_tok, ':', 1);
        v_ballot := NULLIF(pg_catalog.split_part(v_tok, ':', 2), '');
        IF v_seat_kind = 'host' THEN
            INSERT INTO scheduling.event_attendees (event_id, user_id, role, response, responded_at)
            VALUES (v_event, p_host, 'host', 'accepted', pg_catalog.now())
            RETURNING id INTO v_seat;
        ELSIF v_seat_kind = 'guest' THEN
            INSERT INTO scheduling.event_attendees (event_id, user_id, role, email)
            VALUES (v_event, NULL, 'participant', pg_catalog.format('probe-vote-%s-%s@example.test', p_n, v_i))
            RETURNING id INTO v_seat;
        ELSE
            v_person := v_person + 1;
            INSERT INTO scheduling.event_attendees (event_id, user_id, role)
            VALUES (v_event, p_people[v_person],
                    CASE v_seat_kind WHEN 'optional' THEN 'optional' ELSE 'participant' END::scheduling.attendee_role)
            RETURNING id INTO v_seat;
            IF v_seat_kind = 'withdrawn' THEN
                v_withdrawn := v_withdrawn || v_seat;
            END IF;
        END IF;
        PERFORM pg_catalog.set_config('probe.seat_' || p_n || '_' || v_i, v_seat::text, true);
    END LOOP;

    UPDATE scheduling.event_reschedules SET status = 'voting' WHERE id = v_round;

    v_i := 0;
    FOREACH v_tok IN ARRAY pg_catalog.string_to_array(p_seats, ' ') LOOP
        v_i := v_i + 1;
        v_ballot := NULLIF(NULLIF(pg_catalog.split_part(v_tok, ':', 2), ''), '-');
        CONTINUE WHEN v_ballot IS NULL;
        INSERT INTO scheduling.proposal_votes (reschedule_id, proposal_id, attendee_id)
        VALUES (v_round, CASE v_ballot WHEN 'A' THEN v_a ELSE v_b END,
                pg_catalog.current_setting('probe.seat_' || p_n || '_' || v_i)::uuid);
    END LOOP;

    UPDATE scheduling.event_attendees SET archived_at = pg_catalog.now() WHERE id = ANY (v_withdrawn);

    UPDATE pg_temp.probe_fixture
       SET event_id = v_event, round_id = v_round, slot_a = v_a, slot_b = v_b, starts_at = v_start
     WHERE n = p_n;
END $$;

-- How a fixture's round came to rest, in the fixtures' own vocabulary.
CREATE FUNCTION pg_temp.outcome(p_round uuid) RETURNS text LANGUAGE sql AS $$
    SELECT CASE
        WHEN r.status = 'resolved' AND r.resolved_proposal_id = f.slot_a THEN 'resolved:A'
        WHEN r.status = 'resolved' AND r.resolved_proposal_id = f.slot_b THEN 'resolved:B'
        ELSE r.status
    END
      FROM scheduling.event_reschedules r
      JOIN pg_temp.probe_fixture f ON f.round_id = r.id
     WHERE r.id = p_round;
$$;

CREATE FUNCTION pg_temp.new_time_notices(p_event uuid) RETURNS integer LANGUAGE sql AS $$
    SELECT count(*)::integer FROM comms.notifications n
     WHERE n.type = 'schedule.event_reschedule' AND n.entity_id = p_event AND n.title LIKE 'New time:%';
$$;

CREATE FUNCTION pg_temp.account_seats(p_event uuid) RETURNS integer LANGUAGE sql AS $$
    SELECT count(*)::integer FROM scheduling.event_attendees a
     WHERE a.event_id = p_event AND a.archived_at IS NULL AND a.user_id IS NOT NULL;
$$;

DO $$
DECLARE
    v_host uuid;
    v_people uuid[];
    v_schedule uuid;
    v_base timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now()) + interval '10 days';
    f record;
BEGIN
    -- The seed's own live votes are set aside, so the counts below are the fixtures' alone.
    UPDATE scheduling.event_reschedules SET status = 'withdrawn', resolves_at = NULL WHERE status = 'voting';

    SELECT (pg_catalog.array_agg(p.user_id ORDER BY p.user_id))[1],
           (pg_catalog.array_agg(p.user_id ORDER BY p.user_id))[2:6]
      INTO v_host, v_people
      FROM org.users_public p
     WHERE NOT org.fn_is_minor(p.user_id);
    PERFORM pg_temp.check(pg_catalog.cardinality(v_people) = 5, 'fixture: the seed has a host and five adults to seat');

    SELECT id INTO v_schedule FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = v_host;
    IF v_schedule IS NULL THEN
        INSERT INTO scheduling.schedules (owner_type, owner_id) VALUES ('user', v_host)
        RETURNING id INTO v_schedule;
    END IF;

    FOR f IN SELECT * FROM pg_temp.probe_fixture ORDER BY n LOOP
        PERFORM pg_temp.build(f.n, f.seats, v_host, v_schedule, v_people, v_base);
    END LOOP;
    -- The control: a carried vote the read path records first, with the earliest deadline of all.
    INSERT INTO pg_temp.probe_fixture (n, name, seats, expect)
    VALUES (0, 'read_first', 'host participant:A participant:A participant:-', 'resolved:A');
    PERFORM pg_temp.build(0, 'host participant:A participant:A participant:-', v_host, v_schedule, v_people, v_base);

    PERFORM pg_catalog.set_config('probe.now', v_base::text, true);
    PERFORM pg_catalog.set_config('probe.host', v_host::text, true);
    PERFORM pg_catalog.set_config('probe.schedule', v_schedule::text, true);
    PERFORM pg_catalog.set_config('probe.people', v_people::text, true);
END $$;
-- #endregion

-- #region 1. Before the sweep: decided, and still voting
DO $$
DECLARE
    v_now timestamptz := current_setting('probe.now')::timestamptz;
    f record;
BEGIN
    FOR f IN SELECT * FROM pg_temp.probe_fixture ORDER BY n LOOP
        PERFORM pg_temp.check(
            (SELECT r.status = 'voting' AND r.resolves_at <= v_now AND r.resolves_at = scheduling.fn_vote_deadline(r.id)
               FROM scheduling.event_reschedules r WHERE r.id = f.round_id),
            pg_catalog.format('S-13: %s is past its deadline and still voting until somebody records it', f.name)
        );
    END LOOP;
    PERFORM pg_temp.check(
        pg_catalog.to_regproc('scheduling.fn_settle_votes') IS NOT NULL,
        'S-13: scheduling.fn_settle_votes exists, so a decided vote does not wait for a reader'
    );
END $$;

-- The read path records the control round first, as the service role, exactly as
-- live-calendar.ts settleDecidedVotes does.
DO $$
BEGIN
    PERFORM set_config('probe.control_round', f.round_id::text, true), set_config('probe.control_slot', f.slot_a::text, true)
       FROM pg_temp.probe_fixture f WHERE f.n = 0;
END $$;
SET LOCAL ROLE service_role;
DO $$
BEGIN
    IF scheduling.close_reschedule_round(current_setting('probe.control_round')::uuid, 'resolved',
            current_setting('probe.control_slot')::uuid, NULL, 'Moved to the read path''s slot',
            'Carried by a majority of the attendees.') IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL control: the read path could not close its round';
    END IF;
    RAISE NOTICE 'PASS control: the read path closes its round first';
END $$;
RESET ROLE;
DO $$
DECLARE f pg_temp.probe_fixture;
BEGIN
    SELECT * INTO f FROM pg_temp.probe_fixture WHERE n = 0;
    PERFORM pg_catalog.set_config('probe.control_notices', pg_temp.new_time_notices(f.event_id)::text, true);
    PERFORM pg_temp.check(pg_temp.new_time_notices(f.event_id) = pg_temp.account_seats(f.event_id),
        'control: everyone on the read path''s entry hears its new time');
END $$;
-- #endregion

-- #region 2. p_limit: the earliest deadlines first, and no more than asked
DO $$
DECLARE
    v_now timestamptz := current_setting('probe.now')::timestamptz;
    v_n integer;
BEGIN
    v_n := scheduling.fn_settle_votes(v_now, 3);
    PERFORM pg_temp.check(v_n = 3, pg_catalog.format('p_limit: a run of 3 closes 3 rounds (closed %s)', v_n));
    PERFORM pg_temp.check(
        (SELECT pg_catalog.array_agg(f.n ORDER BY f.n) FROM pg_temp.probe_fixture f
           JOIN scheduling.event_reschedules r ON r.id = f.round_id
          WHERE f.n > 0 AND r.status <> 'voting') = ARRAY[1, 2, 3],
        'p_limit: they are the three earliest deadlines, and the read path''s round is not one of them'
    );
END $$;
-- #endregion

-- #region 3. The rest settle as their fixture says
DO $$
DECLARE
    v_now timestamptz := current_setting('probe.now')::timestamptz;
    v_n integer;
    f record;
    e scheduling.events;
BEGIN
    v_n := scheduling.fn_settle_votes(v_now);
    PERFORM pg_temp.check(v_n = 7, pg_catalog.format('the next run closes the other 7 (closed %s)', v_n));

    FOR f IN SELECT * FROM pg_temp.probe_fixture WHERE n > 0 ORDER BY n LOOP
        PERFORM pg_temp.check(pg_temp.outcome(f.round_id) = f.expect,
            pg_catalog.format('%s: %s (%s)', f.name, f.expect, pg_temp.outcome(f.round_id)));
        SELECT * INTO e FROM scheduling.events WHERE id = f.event_id;
        IF f.expect = 'lapsed' THEN
            PERFORM pg_temp.check(e.starts_at = f.starts_at
                AND (SELECT resolved_proposal_id IS NULL FROM scheduling.event_reschedules WHERE id = f.round_id),
                pg_catalog.format('%s: no majority, so the original time stands', f.name));
        ELSE
            PERFORM pg_temp.check(
                (e.starts_at, e.ends_at) = (SELECT p.starts_at, p.ends_at FROM scheduling.reschedule_proposals p
                                             WHERE p.id = CASE f.expect WHEN 'resolved:A' THEN f.slot_a ELSE f.slot_b END),
                pg_catalog.format('%s: the entry moved to the winning slot', f.name));
        END IF;
    END LOOP;
END $$;
-- #endregion

-- #region 4. Each notice once, and a second run does nothing
DO $$
DECLARE
    v_now timestamptz := current_setting('probe.now')::timestamptz;
    f record;
    v_notices jsonb := '{}';
    v_mail integer;
    v_n integer;
BEGIN
    FOR f IN SELECT * FROM pg_temp.probe_fixture WHERE n > 0 ORDER BY n LOOP
        PERFORM pg_temp.check(
            (SELECT count(*) = 1 FROM scheduling.event_history h WHERE h.event_id = f.event_id),
            pg_catalog.format('%s: one history line', f.name));
        IF f.expect = 'lapsed' THEN
            PERFORM pg_temp.check(
                (SELECT h.kind = 'vote' AND h.summary = 'Vote closed without a majority'
                        AND h.detail = 'The original time stands.' AND h.actor_user_id IS NULL
                   FROM scheduling.event_history h WHERE h.event_id = f.event_id),
                pg_catalog.format('%s: the read path''s lapse line, by nobody', f.name));
            PERFORM pg_temp.check(pg_temp.new_time_notices(f.event_id) = 0,
                pg_catalog.format('%s: a lapse tells nobody, as on the read path', f.name));
        ELSE
            PERFORM pg_temp.check(
                (SELECT h.kind = 'rescheduled' AND h.summary ~ '^Moved to [A-Z][a-z]{2} [0-9]{1,2} [A-Z][a-z]{2}, [0-9]{2}:[0-9]{2} [A-Z+0-9-]+$'
                        AND h.detail = 'Carried by a majority of the attendees.' AND h.actor_user_id IS NULL
                        AND h.target_id = (SELECT resolved_proposal_id::text FROM scheduling.event_reschedules WHERE id = f.round_id)
                   FROM scheduling.event_history h WHERE h.event_id = f.event_id),
                pg_catalog.format('%s: the read path''s move line names the slot in a zone [%s]', f.name,
                    (SELECT h.summary FROM scheduling.event_history h WHERE h.event_id = f.event_id)));
            PERFORM pg_temp.check(
                pg_temp.new_time_notices(f.event_id) = pg_temp.account_seats(f.event_id)
                AND (SELECT count(DISTINCT n.user_id) FROM comms.notifications n
                      WHERE n.type = 'schedule.event_reschedule' AND n.entity_id = f.event_id)
                    = pg_temp.new_time_notices(f.event_id),
                pg_catalog.format('%s: everyone with an account on the entry hears its new time once (%s)',
                    f.name, pg_temp.new_time_notices(f.event_id)));
        END IF;
        v_notices := v_notices || pg_catalog.jsonb_build_object(f.name, pg_temp.new_time_notices(f.event_id));
    END LOOP;

    SELECT count(*) INTO v_mail FROM scheduling.guest_mail m
      JOIN scheduling.event_attendees a ON a.id = m.attendee_id
      JOIN pg_temp.probe_fixture x ON x.event_id = a.event_id
     WHERE x.name = 'majority' AND m.kind = 'moved';
    PERFORM pg_temp.check(v_mail = 1, pg_catalog.format('majority: its guest is mailed the move once (%s)', v_mail));

    v_n := scheduling.fn_settle_votes(v_now);
    PERFORM pg_temp.check(v_n = 0, pg_catalog.format('a second run finds nothing to settle (closed %s)', v_n));
    v_n := scheduling.fn_settle_votes(v_now + interval '30 days');
    PERFORM pg_temp.check(v_n = 0, 'nor does a run long after, on rounds already at rest');

    FOR f IN SELECT * FROM pg_temp.probe_fixture WHERE n > 0 ORDER BY n LOOP
        PERFORM pg_temp.check(
            pg_temp.new_time_notices(f.event_id) = (v_notices ->> f.name)::integer
            AND (SELECT count(*) = 1 FROM scheduling.event_history h WHERE h.event_id = f.event_id),
            pg_catalog.format('%s: the second run told nobody and wrote nothing', f.name));
    END LOOP;
    PERFORM pg_temp.check(
        (SELECT count(*) FROM scheduling.guest_mail m JOIN scheduling.event_attendees a ON a.id = m.attendee_id
           JOIN pg_temp.probe_fixture x ON x.event_id = a.event_id
          WHERE x.name = 'majority' AND m.kind = 'moved') = 1,
        'majority: and its guest is not mailed twice');

    SELECT * INTO f FROM pg_temp.probe_fixture WHERE n = 0;
    PERFORM pg_temp.check(
        (SELECT h.summary FROM scheduling.event_history h WHERE h.event_id = f.event_id) = 'Moved to the read path''s slot'
        AND (SELECT count(*) = 1 FROM scheduling.event_history h WHERE h.event_id = f.event_id)
        AND pg_temp.new_time_notices(f.event_id) = current_setting('probe.control_notices')::integer,
        'control: the round the read path closed is not closed again, nor announced again');
END $$;
-- #endregion

-- #region 5. A failure is logged, and the run goes on
SAVEPOINT s5;
CREATE FUNCTION pg_temp.refuse_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.event_id::text = current_setting('probe.failing_event', true) THEN
        RAISE EXCEPTION 'probe: this entry''s history refuses the line' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER probe_refuse_line BEFORE INSERT ON scheduling.event_history
    FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_line();
DO $$
DECLARE
    v_now timestamptz := current_setting('probe.now')::timestamptz;
    v_bad pg_temp.probe_fixture;
    v_good pg_temp.probe_fixture;
    v_n integer;
BEGIN
    INSERT INTO pg_temp.probe_fixture (n, name, seats, expect)
    VALUES (21, 'failing', 'host participant:A participant:A participant:-', 'resolved:A'),
           (22, 'beside_it', 'host participant:B participant:B participant:-', 'resolved:B');
    PERFORM pg_temp.build(21, 'host participant:A participant:A participant:-',
        current_setting('probe.host')::uuid, current_setting('probe.schedule')::uuid,
        current_setting('probe.people')::uuid[], v_now - interval '1 day');
    PERFORM pg_temp.build(22, 'host participant:B participant:B participant:-',
        current_setting('probe.host')::uuid, current_setting('probe.schedule')::uuid,
        current_setting('probe.people')::uuid[], v_now - interval '1 day');
    SELECT * INTO v_bad FROM pg_temp.probe_fixture WHERE n = 21;
    SELECT * INTO v_good FROM pg_temp.probe_fixture WHERE n = 22;
    PERFORM pg_catalog.set_config('probe.failing_event', v_bad.event_id::text, true);

    v_n := scheduling.fn_settle_votes(v_now);
    PERFORM pg_temp.check(v_n = 1, pg_catalog.format('failure: the run settles the round beside the failing one (closed %s)', v_n));
    PERFORM pg_temp.check(pg_temp.outcome(v_good.round_id) = 'resolved:B', 'failure: the other round resolved');
    PERFORM pg_temp.check(
        (SELECT r.status = 'voting' FROM scheduling.event_reschedules r WHERE r.id = v_bad.round_id)
        AND (SELECT e.starts_at = v_bad.starts_at FROM scheduling.events e WHERE e.id = v_bad.event_id)
        AND pg_temp.new_time_notices(v_bad.event_id) = 0,
        'failure: the failing round is rolled back alone: still voting, not moved, nobody told');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM ops.log_entries l
                 WHERE l.client_id = 'scheduler:scheduling-settle-votes:settle_failed'
                   AND l.scope = 'ops.scheduler' AND l.level = 'error'
                   AND l.data ->> 'reschedule_id' = v_bad.round_id::text
                   AND l.data ->> 'sqlstate' = 'P0001'),
        'failure: it is written to ops.log_entries as settle_failed, with the round and the SQLSTATE');

    PERFORM pg_catalog.set_config('probe.failing_event', '', true);
    v_n := scheduling.fn_settle_votes(v_now);
    PERFORM pg_temp.check(v_n = 1 AND pg_temp.outcome(v_bad.round_id) = 'resolved:A',
        'failure: the next run settles it once the fault is gone');
END $$;
ROLLBACK TO SAVEPOINT s5;
-- #endregion

-- #region 6. Who may run it, and the job that does
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.host'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM scheduling.fn_settle_votes();
    RAISE EXCEPTION 'PROBE FAIL a signed-in client ran the vote sweep';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS a signed-in client cannot run the sweep [%]', SQLERRM;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

DO $$
DECLARE j ops.scheduled_jobs;
BEGIN
    PERFORM pg_temp.check(
        NOT has_function_privilege('anon', 'scheduling.fn_settle_votes(timestamptz, integer)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'scheduling.fn_settle_votes(timestamptz, integer)', 'EXECUTE')
        AND has_function_privilege('service_role', 'scheduling.fn_settle_votes(timestamptz, integer)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'scheduling.fn_slot_label(timestamptz, text)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'scheduling.fn_slot_label(timestamptz, text)', 'EXECUTE'),
        'the sweep is the service role''s alone, and its label helper nobody''s');
    -- The dormant row matches by name (to_regproc), so an overload or a rename would leave the job
    -- silently unregistered.
    PERFORM pg_temp.check(pg_catalog.to_regproc('scheduling.fn_settle_votes') IS NOT NULL,
        'to_regproc resolves scheduling.fn_settle_votes by name');
    SELECT * INTO j FROM ops.scheduled_jobs s WHERE s.name = 'scheduling-settle-votes';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROBE FAIL scheduling-settle-votes is not registered; reset the database once the function exists';
    END IF;
    PERFORM pg_temp.check(
        j.enabled AND j.kind = 'sql' AND j.schedule = '11,26,41,56 * * * *'
        AND j.command = 'SELECT scheduling.fn_settle_votes();',
        pg_catalog.format('the registry runs it as sql at :11/:26/:41/:56 (%s / %s / %s)', j.kind, j.schedule, j.command));
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM cron.job c
                 WHERE c.jobname = 'scheduling-settle-votes' AND c.active AND c.schedule = '11,26,41,56 * * * *'),
        'pg_cron runs scheduling-settle-votes');
END $$;

-- The by-hand path, `deno task cron:run scheduling-settle-votes`, is the registry's own runner as the
-- service role. On the swept database it finds nothing and tells nobody.
SET LOCAL ROLE service_role;
DO $$
DECLARE r jsonb;
BEGIN
    r := ops.run_job('scheduling-settle-votes');
    IF r ->> 'kind' <> 'sql' OR (r #>> '{result,fn_settle_votes}')::integer IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'PROBE FAIL ops.run_job answered % on a swept database', r;
    END IF;
    RAISE NOTICE 'PASS the job runs by hand through ops.run_job [%]', r;
END $$;
RESET ROLE;

-- The label helper names a slot the way the read path's line does, in the zone it is given, and in UTC
-- for a zone nobody knows.
SET LOCAL "TimeZone" = 'America/Toronto';
DO $$
DECLARE
    v_summer text := scheduling.fn_slot_label(timestamptz '2026-07-16 14:00+00', 'Europe/London');
    v_winter text := scheduling.fn_slot_label(timestamptz '2026-12-17 14:00+00', 'Europe/London');
    v_unknown text := scheduling.fn_slot_label(timestamptz '2026-12-17 14:00+00', 'Nowhere/Atlantis');
BEGIN
    PERFORM pg_temp.check(
        v_summer = 'Thu 16 Jul, 15:00 BST' AND v_winter = 'Thu 17 Dec, 14:00 GMT' AND v_unknown = 'Thu 17 Dec, 14:00 UTC',
        pg_catalog.format('the label names the slot in its zone, and in UTC for an unknown one [%s · %s · %s]',
            v_summer, v_winter, v_unknown));
    PERFORM pg_temp.check(pg_catalog.current_setting('TimeZone') = 'America/Toronto',
        'the label leaves the caller''s own zone as it found it');
END $$;
-- #endregion

ROLLBACK;
