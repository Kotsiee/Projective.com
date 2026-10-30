-- paid_revisions.sql — probe for revision allotments and paid revisions (Decision #167).
--
-- Drives the doors as the people who use them: the client reviews and pays, the freelancer resubmits.
-- One transaction, ROLLED BACK, so the seeded database is left as it was. Run after `deno task db:reset`:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/paid_revisions.sql
\set ON_ERROR_STOP on
\set QUIET on
BEGIN;

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.act(p_uid text) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', p_uid, true),
           pg_catalog.set_config('request.jwt.claims',
               pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.s(text), pg_temp.ok(boolean, text) TO authenticated;
-- #endregion

-- #region Fixture: an individual client's USD project with a claimed ticket, one free round, $50 extra
DO $$
DECLARE r record; v_sub uuid; v_wallet uuid;
BEGIN
    SELECT ps.id AS stage, p.id AS project, p.owner_user_id AS owner, t.id AS ticket,
           t.current_assignee_id AS assignee
      INTO r
      FROM projects.tickets t
      JOIN projects.project_stages ps ON ps.id = t.current_stage_id
      JOIN projects.projects p ON p.id = t.project_id
     WHERE p.client_business_id IS NULL AND upper(p.currency) = 'USD' AND p.source_blueprint_id IS NULL
       AND t.current_assignee_id IS NOT NULL AND t.current_assignee_id <> p.owner_user_id
       AND t.status IN ('in_progress', 'in_review')
       AND NOT EXISTS (SELECT 1 FROM projects.stage_assignments sa
                        WHERE sa.project_stage_id = ps.id AND sa.assignee_type = 'team' AND sa.status = 'accepted')
     ORDER BY t.id LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture ticket — run `deno task db:reset` for the seeded world';
    END IF;
    UPDATE projects.project_stages
       SET file_revisions_allowed = 1, extra_revision_price_cents = 5000, revisions_used = 0
     WHERE id = r.stage;
    UPDATE projects.tickets SET status = 'in_review' WHERE id = r.ticket;
    INSERT INTO projects.stage_submissions (project_stage_id, ticket_id, submitted_by, title, status, number)
    VALUES (r.stage, r.ticket, r.assignee, 'Probe v1', 'pending_review', 9001)
    RETURNING id INTO v_sub;
    v_wallet := finance.fn_ensure_wallet(finance.fn_person_wallet_type(r.owner), r.owner, 'USD');
    PERFORM finance.fn_wallet_credit(r.owner, finance.fn_person_wallet_type(r.owner), 'USD', 10000,
        'topup', 'probe', NULL);
    PERFORM pg_catalog.set_config('probe.stage', r.stage::text, true);
    PERFORM pg_catalog.set_config('probe.project', r.project::text, true);
    PERFORM pg_catalog.set_config('probe.owner', r.owner::text, true);
    PERFORM pg_catalog.set_config('probe.ticket', r.ticket::text, true);
    PERFORM pg_catalog.set_config('probe.assignee', r.assignee::text, true);
    PERFORM pg_catalog.set_config('probe.sub1', v_sub::text, true);
    PERFORM pg_catalog.set_config('probe.wallet', v_wallet::text, true);
END $$;
-- #endregion

-- #region 1. The free round is counted and opened; both notifications are emitted
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT projects.review_submission(pg_temp.s('sub1')::uuid, 'request_revision', '{"global":"Tighten the hero"}');
RESET ROLE;
SELECT pg_temp.ok((SELECT revisions_used = 1 FROM projects.project_stages WHERE id = pg_temp.s('stage')::uuid),
    'free round: revisions_used 0 → 1');
SELECT pg_temp.ok((SELECT status = 'open' AND request_type = 'revision' AND submission_id = pg_temp.s('sub1')::uuid
    FROM projects.stage_revision_requests WHERE ticket_id = pg_temp.s('ticket')::uuid), 'free round: request open, linked');
SELECT pg_temp.ok((SELECT status::text = 'in_progress' FROM projects.tickets WHERE id = pg_temp.s('ticket')::uuid),
    'free round: ticket back in progress');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM comms.notifications n
    WHERE n.user_id = pg_temp.s('assignee')::uuid AND n.entity_table = 'projects.stage_revision_requests'),
    'free round: submission.revision_requested reaches the submitter');
-- #endregion

-- #region 2. The freelancer reads the round (RLS) and the resubmission resolves it
SELECT pg_temp.act(pg_temp.s('assignee')); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) = 1 FROM projects.stage_revision_requests WHERE ticket_id = pg_temp.s('ticket')::uuid),
    'RLS: the assigned freelancer reads the round raised against them');
SELECT pg_catalog.set_config('probe.sub2', (projects.submit_deliverable(
    pg_temp.s('ticket')::uuid, pg_temp.s('stage')::uuid, 'Probe v2') ->> 'id'), true);
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'resolved' AND resolved_at IS NOT NULL FROM projects.stage_revision_requests
    WHERE submission_id = pg_temp.s('sub1')::uuid), 'resubmission: round resolved, resolved_at set');
SELECT pg_temp.ok((SELECT revision_of = pg_temp.s('sub1')::uuid FROM projects.stage_submissions
    WHERE id = pg_temp.s('sub2')::uuid), 'resubmission: revision_of written');
-- #endregion

-- #region 3. Past the allotment the request is refused with its price; the client raises a paid round
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM projects.review_submission(pg_temp.s('sub2')::uuid, 'request_revision', '{"global":"Again"}');
    RAISE EXCEPTION 'PROBE FAIL: an exhausted allotment granted a free round';
EXCEPTION WHEN SQLSTATE 'PR402' THEN
    DECLARE v_detail text;
    BEGIN
        GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
        PERFORM pg_temp.ok((v_detail::jsonb ->> 'code') = 'paid_revision_required'
            AND (v_detail::jsonb ->> 'price_minor')::bigint = 5000, 'exhausted: PR402 paid_revision_required, price 5000');
    END;
END $$;
SELECT pg_catalog.set_config('probe.rev', (projects.request_paid_revision(pg_temp.s('sub2')::uuid,
    '{"global":"Swap the palette"}') ->> 'revision_id'), true);
SELECT pg_temp.ok((projects.request_paid_revision(pg_temp.s('sub2')::uuid, '{"global":"Swap the palette"}')
    ->> 'revision_id') = pg_temp.s('rev'), 'paid round: raising twice returns the same round');
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'awaiting_payment' AND price_cents = 5000 FROM projects.stage_revision_requests
    WHERE id = pg_temp.s('rev')::uuid), 'paid round: awaiting_payment at the snapshot price');
SELECT pg_temp.ok((SELECT status = 'pending_review' FROM projects.stage_submissions WHERE id = pg_temp.s('sub2')::uuid),
    'paid round: nothing is sent back before payment');
-- #endregion

-- #region 3b. Rounds are raised only through the doors, and paid only at the stage's price
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
DO $$
BEGIN
    INSERT INTO projects.stage_revision_requests
        (project_stage_id, ticket_id, requested_by, request_type, reason, status, submission_id, price_cents)
    VALUES (pg_temp.s('stage')::uuid, pg_temp.s('ticket')::uuid, pg_temp.s('owner')::uuid, 'paid_revision',
            'One cent', 'awaiting_payment', pg_temp.s('sub2')::uuid, 1);
    RAISE EXCEPTION 'PROBE FAIL: a client raised a paid round at its own price';
EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.ok(true, 'guard: a client cannot insert a paid round at its own price (42501)');
END $$;
DO $$
BEGIN
    INSERT INTO projects.stage_revision_requests
        (project_stage_id, ticket_id, requested_by, request_type, reason, status, submission_id)
    VALUES (pg_temp.s('stage')::uuid, pg_temp.s('ticket')::uuid, pg_temp.s('owner')::uuid, 'revision',
            'Free extra', 'open', pg_temp.s('sub2')::uuid);
    RAISE EXCEPTION 'PROBE FAIL: a client opened a free round past its allotment';
EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.ok(true, 'guard: a client cannot insert a free round outside review_submission (42501)');
END $$;
RESET ROLE;

UPDATE projects.stage_revision_requests SET price_cents = 1 WHERE id = pg_temp.s('rev')::uuid;
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM projects.fund_paid_revision(pg_temp.s('rev')::uuid);
    RAISE EXCEPTION 'PROBE FAIL: a round was paid below the stage''s price';
EXCEPTION WHEN SQLSTATE 'PC409' THEN
    PERFORM pg_temp.ok(true, 'guard: a round whose price is not the stage''s is refused (PC409)');
END $$;
RESET ROLE;
UPDATE projects.stage_revision_requests SET price_cents = 5000 WHERE id = pg_temp.s('rev')::uuid;
-- #endregion

-- #region 4. Buying it holds escrow on the ticket and only then opens the round
DO $$
DECLARE v_basket uuid; v_line uuid;
BEGIN
    INSERT INTO finance.baskets (owner_type, owner_id, name)
    VALUES (finance.fn_person_wallet_type(pg_temp.s('owner')::uuid), pg_temp.s('owner')::uuid, 'Probe basket')
    RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, stage_id, revision_id, title, unit_price_minor, currency)
    VALUES (v_basket, 'paid_revision', pg_temp.s('rev')::uuid, pg_temp.s('stage')::uuid, pg_temp.s('rev')::uuid,
            'Paid revision · probe', 5000, 'USD')
    RETURNING id INTO v_line;
    PERFORM pg_catalog.set_config('probe.basket', v_basket::text, true);
    PERFORM pg_catalog.set_config('probe.line', v_line::text, true);
    PERFORM pg_catalog.set_config('probe.b0', (SELECT balance_cents FROM finance.wallets
        WHERE id = pg_temp.s('wallet')::uuid)::text, true);
    PERFORM pg_catalog.set_config('probe.held0', (SELECT count(*) FROM finance.escrows
        WHERE ticket_id = pg_temp.s('ticket')::uuid AND status = 'held')::text, true);
END $$;
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT finance.place_wallet_order(pg_temp.s('basket')::uuid, ARRAY[pg_temp.s('line')::uuid], 'USD',
    jsonb_build_object(pg_temp.s('line'), 5000), NULL, 'probe-paid-revision-1', 5000);
RESET ROLE;
SELECT pg_temp.ok((SELECT balance_cents FROM finance.wallets WHERE id = pg_temp.s('wallet')::uuid)
    = pg_temp.s('b0')::bigint - 5000, 'paid: the wallet paid 5000 once (no double debit)');
SELECT pg_temp.ok((SELECT count(*) FROM finance.escrows WHERE ticket_id = pg_temp.s('ticket')::uuid
    AND status = 'held' AND amount_cents = 5000) = 1
    AND (SELECT count(*) FROM finance.escrows WHERE ticket_id = pg_temp.s('ticket')::uuid AND status = 'held')
        = pg_temp.s('held0')::bigint + 1, 'paid: one more escrow held on the ticket for the round');
SELECT pg_temp.ok((SELECT status = 'open' FROM projects.stage_revision_requests WHERE id = pg_temp.s('rev')::uuid)
    AND (SELECT status = 'revisions_requested' FROM projects.stage_submissions WHERE id = pg_temp.s('sub2')::uuid)
    AND (SELECT status::text = 'in_progress' FROM projects.tickets WHERE id = pg_temp.s('ticket')::uuid),
    'paid: round open, submission sent back, ticket in progress');
SELECT pg_temp.ok((SELECT revisions_used = 1 FROM projects.project_stages WHERE id = pg_temp.s('stage')::uuid),
    'paid: a bought round does not consume the free allotment');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM comms.notifications n WHERE n.user_id = pg_temp.s('assignee')::uuid
    AND n.entity_id = pg_temp.s('rev')::uuid AND n.body = 'Paid revision, funded, you can start.'),
    'paid: the freelancer is told "Paid revision, funded, you can start."');
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM projects.fund_paid_revision(pg_temp.s('rev')::uuid);
    RAISE EXCEPTION 'PROBE FAIL: a paid round was funded twice';
EXCEPTION WHEN SQLSTATE 'PC409' THEN
    PERFORM pg_temp.ok(true, 'replay: an open round cannot be paid again');
END $$;
-- #endregion

-- #region 5. Derived and frozen columns
DO $$
BEGIN
    UPDATE projects.project_stages SET revisions_used = 0 WHERE id = pg_temp.s('stage')::uuid;
    IF FOUND THEN RAISE EXCEPTION 'PROBE FAIL: the owner reset revisions_used'; END IF;
    PERFORM pg_temp.ok(true, 'guard: revisions_used not writable by the owner (no row reachable)');
EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.ok(true, 'guard: revisions_used is derived (42501)');
END $$;
RESET ROLE;

DO $$
DECLARE v_bp uuid; v_stage uuid;
BEGIN
    SELECT b.id INTO v_bp FROM marketplace.service_blueprints b ORDER BY b.id LIMIT 1;
    UPDATE marketplace.service_blueprints SET free_revisions = 3, extra_revision_price_cents = 7000 WHERE id = v_bp;
    UPDATE projects.projects SET source_blueprint_id = v_bp WHERE id = pg_temp.s('project')::uuid;
    INSERT INTO projects.project_stages (project_id, name, sort_order, file_revisions_allowed, extra_revision_price_cents)
    VALUES (pg_temp.s('project')::uuid, 'Probe stage', 999, 99, 1)
    RETURNING id INTO v_stage;
    PERFORM pg_temp.ok((SELECT file_revisions_allowed = 3 AND extra_revision_price_cents = 7000
        FROM projects.project_stages WHERE id = v_stage), 'terms: a blueprint stage copies the seller''s allotment');
    UPDATE projects.project_stages SET file_revisions_allowed = 50 WHERE id = v_stage;
    PERFORM pg_temp.ok((SELECT file_revisions_allowed = 3 FROM projects.project_stages WHERE id = v_stage),
        'terms: frozen after insert');
END $$;
-- #endregion

ROLLBACK;
\echo 'paid_revisions probe: all checks passed (rolled back)'
