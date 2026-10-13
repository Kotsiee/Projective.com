-- chain_reaction.sql — probe for the Pipeline Chain Reaction (PRODUCT_MANAGEMENT §3.6).
--
-- Approving a ticket's stage releases that stage's escrow and moves the ticket to its next required
-- stage. With the next stage's `chain_reaction` on (the default) its escrow is held at once from the
-- paying wallet's live balance; a refused hold leaves the ticket `todo` / Needs funding and tells the
-- client and the payee; with `chain_reaction` off it waits `todo` / Draft (`unpaid`) and can be funded
-- by hand. Each outcome writes one `chain_*` ticket_history row.
--
-- Fixture discovered from the seed: a ticket with a HELD individual-freelancer escrow whose project has
-- another open stage; its required_stages are rewritten in-transaction to [current, next]. One
-- transaction, ROLLED BACK. Run after `deno task db:reset`:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/chain_reaction.sql
\set ON_ERROR_STOP on
\set QUIET on

BEGIN;
-- @prelude (in-flight definitions are spliced here when probing before a reset)

CREATE FUNCTION pg_temp.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'ASSERT FAILED: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $f$;

-- ── Fixture ──────────────────────────────────────────────────────────────────────────────────────
SELECT t.id AS ticket, t.project_id AS project, e.project_stage_id AS stage, e.id AS escrow,
       t.current_assignee_id AS payee, p.owner_user_id AS owner, e.amount_cents AS amount,
       (SELECT s.id FROM projects.project_stages s
         WHERE s.project_id = p.id AND s.id <> e.project_stage_id AND s.archived_at IS NULL
           AND s.status IN ('open', 'assigned', 'in_progress')
         ORDER BY s.sort_order, s.id LIMIT 1) AS next_stage
  FROM finance.escrows e
  JOIN projects.tickets t ON t.id = e.ticket_id
  JOIN projects.projects p ON p.id = t.project_id
 WHERE e.status = 'held' AND e.revision_id IS NULL AND e.payee_type = 'freelancer'
   AND t.current_assignee_id <> p.owner_user_id
   AND EXISTS (SELECT 1 FROM projects.project_stages s
                WHERE s.project_id = p.id AND s.id <> e.project_stage_id AND s.archived_at IS NULL
                  AND s.status IN ('open', 'assigned', 'in_progress'))
 ORDER BY t.id
 LIMIT 1 \gset
SELECT set_config('probe.ticket', :'ticket', false) IS NOT NULL AS _probe \gset

UPDATE projects.tickets
   SET required_stages = jsonb_build_array(
           jsonb_build_object('stage_id', :'stage', 'order', 1),
           jsonb_build_object('stage_id', :'next_stage', 'order', 2))
 WHERE id = :'ticket';
SELECT pg_temp.check((SELECT chain_reaction FROM projects.project_stages WHERE id = :'next_stage'),
    'fixture: chain_reaction defaults on');

-- ── A. chain on, the wallet covers it → the next stage is held and work carries on ──────────────
SAVEPOINT a;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT projects.force_complete_stage(:'ticket') AS a_next \gset
RESET ROLE;
SELECT pg_temp.check(:'a_next'::uuid = :'next_stage'::uuid, 'A: returns the next stage');
SELECT pg_temp.check((SELECT status = 'released' FROM finance.escrows WHERE id = :'escrow'), 'A: approved stage released');
SELECT pg_temp.check((SELECT count(*) = 1 FROM finance.escrows
                       WHERE ticket_id = :'ticket' AND project_stage_id = :'next_stage' AND status = 'held'
                         AND payee_id = :'payee'), 'A: next stage escrow held for the same payee');
SELECT pg_temp.check((SELECT current_stage_id = :'next_stage' AND status = 'in_progress' AND payment_status = 'escrow_funded'
                        FROM projects.tickets WHERE id = :'ticket'), 'A: ticket in progress on the next stage, funded');
SELECT pg_temp.check((SELECT count(*) = 1 FROM projects.ticket_history
                       WHERE ticket_id = :'ticket' AND action_type = 'chain_held' AND new_stage_id = :'next_stage'),
    'A: chain_held history row');
SELECT pg_temp.check((SELECT count(*) = 1 FROM comms.notifications
                       WHERE user_id = :'payee' AND entity_id = :'ticket' AND type = 'escrow.funded'),
    'A: payee told "Funded — you can start"');
ROLLBACK TO a;

-- ── B. chain on, the hold is refused → Needs funding, approval still pays ───────────────────────
SAVEPOINT b;
SELECT set_config('request.jwt.claims', '', true);
UPDATE projects.tickets SET unit_price_cents = 900000000000 WHERE id = :'ticket';
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT projects.force_complete_stage(:'ticket') AS b_next \gset
RESET ROLE;
SELECT pg_temp.check((SELECT status = 'released' FROM finance.escrows WHERE id = :'escrow'), 'B: approved stage still released');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = :'ticket' AND status = 'held'),
    'B: nothing held on the next stage');
SELECT pg_temp.check((SELECT current_stage_id = :'next_stage' AND status = 'todo' AND payment_status = 'needs_funding'
                        FROM projects.tickets WHERE id = :'ticket'), 'B: ticket waits todo / needs_funding on the next stage');
SELECT pg_temp.check((SELECT count(*) = 1 FROM projects.ticket_history
                       WHERE ticket_id = :'ticket' AND action_type = 'chain_needs_funding'), 'B: chain_needs_funding history row');
SELECT pg_temp.check((SELECT count(*) = 1 FROM comms.notifications
                       WHERE user_id = :'owner' AND entity_id = :'ticket' AND type = 'escrow.needs_funding'
                         AND payload->>'trigger' = 'chain_reaction'), 'B: client told, with the chain trigger');
SELECT pg_temp.check((SELECT count(*) = 1 FROM comms.notifications
                       WHERE user_id = :'payee' AND entity_id = :'ticket' AND type = 'ticket.awaiting_funding'),
    'B: payee told the next stage awaits funding');
ROLLBACK TO b;

-- ── C. chain off → Draft on the next stage, fundable by hand ────────────────────────────────────
SAVEPOINT c;
UPDATE projects.project_stages SET chain_reaction = false WHERE id = :'next_stage';
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT projects.force_complete_stage(:'ticket') AS c_next \gset
RESET ROLE;
SELECT pg_temp.check((SELECT status = 'released' FROM finance.escrows WHERE id = :'escrow'), 'C: approved stage released');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = :'ticket' AND status = 'held'),
    'C: nothing held on the next stage');
SELECT pg_temp.check((SELECT current_stage_id = :'next_stage' AND status = 'todo' AND payment_status = 'unpaid'
                        FROM projects.tickets WHERE id = :'ticket'), 'C: ticket waits todo / unpaid (Draft)');
SELECT pg_temp.check((SELECT count(*) = 1 FROM projects.ticket_history
                       WHERE ticket_id = :'ticket' AND action_type = 'chain_off'), 'C: chain_off history row');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM comms.notifications
                       WHERE user_id = :'owner' AND entity_id = :'ticket' AND type = 'escrow.needs_funding'),
    'C: no needs-funding notice — nothing was refused');
SELECT pg_temp.check((SELECT count(*) = 1 FROM comms.notifications
                       WHERE user_id = :'payee' AND entity_id = :'ticket' AND type = 'ticket.awaiting_funding'),
    'C: payee told the next stage awaits funding');
-- Work cannot start there until it is funded (the #165 gate), and funding it by hand holds it.
SAVEPOINT c_gate;
DO $d$ BEGIN
    UPDATE projects.tickets SET status = 'in_progress' WHERE id = current_setting('probe.ticket')::uuid;
    RAISE EXCEPTION 'ASSERT FAILED: work started on an unheld chained ticket';
EXCEPTION WHEN SQLSTATE 'PF402' THEN
    RAISE NOTICE 'ok  C: work-start gate refuses the unheld next stage';
END $d$;
ROLLBACK TO c_gate;
SET LOCAL ROLE authenticated;
SELECT projects.fund_ticket(:'project', :'ticket') AS c_fund \gset
RESET ROLE;
SELECT pg_temp.check((SELECT payment_status = 'escrow_funded' FROM projects.tickets WHERE id = :'ticket')
    AND EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = :'ticket' AND project_stage_id = :'next_stage'
                  AND status = 'held' AND payee_id = :'payee'), 'C: fund_ticket holds the next stage for the payee');
ROLLBACK TO c;

-- ── D. the stage-approval door chains too ───────────────────────────────────────────────────────
SAVEPOINT d;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT projects.approve_stage(:'project', :'stage') AS d_result \gset
RESET ROLE;
SELECT pg_temp.check((SELECT current_stage_id = :'next_stage' AND payment_status = 'escrow_funded'
                        FROM projects.tickets WHERE id = :'ticket'), 'D: approve_stage moved the ticket on, held');
SELECT pg_temp.check((SELECT count(*) = 1 FROM projects.ticket_history
                       WHERE ticket_id = :'ticket' AND action_type = 'chain_held'), 'D: chain_held history row');
ROLLBACK TO d;

ROLLBACK;
