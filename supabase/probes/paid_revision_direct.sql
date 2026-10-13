-- paid_revision_direct.sql — probe for paying a paid revision round directly (Decision #199).
--
-- The client pays one raised round from the wallet (projects.fund_paid_revision) and another by card
-- (finance.begin_card_payment revision mode → attach → the webhook's settle_card_payment), never
-- through a basket. One transaction, ROLLED BACK. Run after `deno task db:reset`:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/paid_revision_direct.sql
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

CREATE FUNCTION pg_temp.balance() RETURNS bigint LANGUAGE sql AS $$
    SELECT balance_cents FROM finance.wallets WHERE id = pg_temp.s('wallet')::uuid;
$$;

CREATE FUNCTION pg_temp.submission(p_number int) RETURNS uuid LANGUAGE sql AS $$
    UPDATE projects.tickets SET status = 'in_review' WHERE id = pg_temp.s('ticket')::uuid;
    INSERT INTO projects.stage_submissions (project_stage_id, ticket_id, submitted_by, title, status, number)
    VALUES (pg_temp.s('stage')::uuid, pg_temp.s('ticket')::uuid, pg_temp.s('assignee')::uuid,
            'Probe v' || p_number, 'pending_review', p_number)
    RETURNING id;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.s(text), pg_temp.ok(boolean, text) TO authenticated;
-- #endregion

-- #region Fixture: an individual client's USD project, a claimed ticket, no free rounds, $50 extra
DO $$
DECLARE r record; v_wallet uuid;
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
       SET file_revisions_allowed = 0, extra_revision_price_cents = 5000, revisions_used = 0
     WHERE id = r.stage;
    v_wallet := finance.fn_ensure_wallet(finance.fn_person_wallet_type(r.owner), r.owner, 'USD');
    PERFORM finance.fn_wallet_credit(r.owner, finance.fn_person_wallet_type(r.owner), 'USD', 10000,
        'topup', 'probe', NULL);
    PERFORM pg_catalog.set_config('probe.stage', r.stage::text, true);
    PERFORM pg_catalog.set_config('probe.project', r.project::text, true);
    PERFORM pg_catalog.set_config('probe.owner', r.owner::text, true);
    PERFORM pg_catalog.set_config('probe.ticket', r.ticket::text, true);
    PERFORM pg_catalog.set_config('probe.assignee', r.assignee::text, true);
    PERFORM pg_catalog.set_config('probe.wallet', v_wallet::text, true);
    PERFORM pg_catalog.set_config('probe.sub1', pg_temp.submission(9101)::text, true);
END $$;
-- #endregion

-- #region 1. Pay from wallet: the round's escrow is held from the Available balance, then it opens
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('probe.rev1', (projects.request_paid_revision(pg_temp.s('sub1')::uuid,
    '{"global":"Swap the palette"}') ->> 'revision_id'), true);
RESET ROLE;
SELECT pg_catalog.set_config('probe.b0', pg_temp.balance()::text, true);
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT projects.fund_paid_revision(pg_temp.s('rev1')::uuid);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.balance() = pg_temp.s('b0')::bigint - 5000, 'wallet: Available debited 5000 once');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM finance.escrows WHERE revision_id = pg_temp.s('rev1')::uuid
    AND status = 'held' AND amount_cents = 5000), 'wallet: one escrow held for the round');
SELECT pg_temp.ok((SELECT status = 'open' FROM projects.stage_revision_requests WHERE id = pg_temp.s('rev1')::uuid)
    AND (SELECT status = 'revisions_requested' FROM projects.stage_submissions WHERE id = pg_temp.s('sub1')::uuid),
    'wallet: round open, submission sent back');
-- #endregion

-- #region 2. Pay by card: the door prices the round itself and applies fund_paid_revision's gates
DO $$ BEGIN PERFORM pg_catalog.set_config('probe.sub2', pg_temp.submission(9102)::text, true); END $$;
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('probe.rev2', (projects.request_paid_revision(pg_temp.s('sub2')::uuid,
    '{"global":"Tighten the hero"}') ->> 'revision_id'), true);
DO $$
BEGIN
    PERFORM finance.begin_card_payment('escrow_lock', NULL, pg_temp.s('project')::uuid, pg_temp.s('stage')::uuid,
        4000, 'USD', 'probe-rev-card-low', NULL, pg_temp.s('rev2')::uuid);
    RAISE EXCEPTION 'PROBE FAIL: a card payment started at a price nobody was shown';
EXCEPTION WHEN SQLSTATE 'PC409' THEN
    PERFORM pg_temp.ok(true, 'card: an amount other than the round''s price is refused (PC409)');
END $$;
DO $$
BEGIN
    PERFORM finance.begin_card_payment('escrow_lock', NULL, pg_temp.s('project')::uuid, pg_temp.s('stage')::uuid,
        5000, 'USD', 'probe-rev-card-ticket', pg_temp.s('ticket')::uuid, pg_temp.s('rev2')::uuid);
    RAISE EXCEPTION 'PROBE FAIL: a revision was paid for together with a ticket hold';
EXCEPTION WHEN SQLSTATE '22023' THEN
    PERFORM pg_temp.ok(true, 'card: a revision is paid for on its own, never with a ticket (22023)');
END $$;
DO $$
BEGIN
    PERFORM finance.begin_card_payment('escrow_lock', NULL, pg_temp.s('project')::uuid, pg_temp.s('stage')::uuid,
        5000, 'USD', 'probe-rev-card-rev1', NULL, pg_temp.s('rev1')::uuid);
    RAISE EXCEPTION 'PROBE FAIL: an open round was charged again';
EXCEPTION WHEN SQLSTATE 'PC409' THEN
    PERFORM pg_temp.ok(true, 'card: a round already paid for is refused (PC409)');
END $$;
RESET ROLE;
SELECT pg_temp.act(pg_temp.s('assignee')); SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM finance.begin_card_payment('escrow_lock', NULL, pg_temp.s('project')::uuid, pg_temp.s('stage')::uuid,
        5000, 'USD', 'probe-rev-card-stranger', NULL, pg_temp.s('rev2')::uuid);
    RAISE EXCEPTION 'PROBE FAIL: the freelancer started a payment for the client''s round';
EXCEPTION WHEN SQLSTATE '42501' THEN
    PERFORM pg_temp.ok(true, 'card: only the project''s client may pay (42501)');
END $$;
RESET ROLE;

SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('probe.pay', (finance.begin_card_payment('escrow_lock', NULL,
    pg_temp.s('project')::uuid, pg_temp.s('stage')::uuid, 5000, 'USD', 'probe-rev-card-1', NULL,
    pg_temp.s('rev2')::uuid) ->> 'id'), true);
SELECT pg_temp.ok((finance.begin_card_payment('escrow_lock', NULL, pg_temp.s('project')::uuid,
    pg_temp.s('stage')::uuid, 5000, 'USD', 'probe-rev-card-1', NULL, pg_temp.s('rev2')::uuid) ->> 'replayed')::boolean,
    'card: the same attempt key replays the recorded attempt');
SELECT finance.attach_card_payment(pg_temp.s('pay')::uuid, 'pi_probe_revision_1');
RESET ROLE;
SELECT pg_temp.ok((SELECT revision_id = pg_temp.s('rev2')::uuid AND ticket_id IS NULL AND amount_cents = 5000
    AND lock_status = 'pending' FROM finance.inbound_payments WHERE id = pg_temp.s('pay')::uuid),
    'card: the attempt names the round, no ticket, at its price');
SELECT pg_temp.ok((SELECT status = 'awaiting_payment' FROM projects.stage_revision_requests
    WHERE id = pg_temp.s('rev2')::uuid), 'card: nothing opens before the money arrives');
-- #endregion

-- #region 3. The webhook settles it: credit, then the round's hold as the payer, then the round opens
SELECT pg_catalog.set_config('probe.b1', pg_temp.balance()::text, true);
SELECT finance.settle_card_payment('evt_probe_revision_1', 'pi_probe_revision_1', 5000, 'USD', false);
SELECT pg_temp.ok((SELECT lock_status = 'locked' AND locked_escrow_ids = ARRAY[(SELECT e.id FROM finance.escrows e
    WHERE e.revision_id = pg_temp.s('rev2')::uuid AND e.status = 'held')]
    FROM finance.inbound_payments WHERE id = pg_temp.s('pay')::uuid), 'settle: locked, naming the round''s escrow');
SELECT pg_temp.ok(pg_temp.balance() = pg_temp.s('b1')::bigint, 'settle: credited 5000 and held 5000 — the wallet is unchanged');
SELECT pg_temp.ok((SELECT status = 'open' FROM projects.stage_revision_requests WHERE id = pg_temp.s('rev2')::uuid)
    AND (SELECT status = 'revisions_requested' FROM projects.stage_submissions WHERE id = pg_temp.s('sub2')::uuid),
    'settle: round open, submission sent back');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM comms.notifications n WHERE n.user_id = pg_temp.s('assignee')::uuid
    AND n.entity_id = pg_temp.s('rev2')::uuid AND n.body = 'Paid revision, funded, you can start.'),
    'settle: the freelancer is told "Paid revision, funded, you can start."');
-- #endregion

ROLLBACK;
\echo 'paid_revision_direct probe: all checks passed (rolled back)'
