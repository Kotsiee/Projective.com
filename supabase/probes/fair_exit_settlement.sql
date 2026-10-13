-- fair_exit_settlement.sql — probe for ending a stage under Fair Exit (Decision #198).
--
-- The preview and the door read one quote (projects.fn_fair_exit_quote), so the confirmation's figures
-- are exactly what settles; the exit pays the tier's share net of the fee, refunds the rest to the payer,
-- refunds a prepaid (unclaimed) ticket whole, closes the tickets left on the stage as `cancelled`, and
-- notifies both sides. Seeded fixture: the team stage on prj-xghufr2r5b — two held escrows of 2,250,000
-- USD minor at a 500 bp fee. One transaction, ROLLED BACK.
-- Run after `deno task db:reset`:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/fair_exit_settlement.sql
\set ON_ERROR_STOP on
\set QUIET on
\set stage '2756102c-7332-4015-a56f-147ee334fc4f'
\set project '7f930a97-cfa8-4784-a7d0-61c913c2f3ce'
\set owner '292e1827-f189-4f34-ab35-27c9f0320926'
\set t_review 'bf5e3149-b68d-4bae-acf5-c7576b0d386c'
\set t_progress 'c05e32dc-b98d-4067-a9f5-c29e6a0d36d9'
\set e_review '7db54224-7d35-488f-a6ea-faf62685e4a1'
\set e_progress '7cb54091-7a35-43d6-a9ea-ffaf2785e634'
\set assignee_a '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd'
\set assignee_b 'c7173d3f-8b15-4876-afbf-499d17513a44'

BEGIN;

CREATE FUNCTION pg_temp.credited(p_escrow uuid) RETURNS bigint LANGUAGE sql AS $f$
    SELECT (SELECT COALESCE(SUM(amount_cents), 0) FROM finance.pending_releases WHERE escrow_id = p_escrow)
         + (SELECT COALESCE(SUM(t.amount_cents), 0) FROM finance.transactions t
             WHERE t.direction = 'credit' AND t.ref_table = 'escrows' AND t.ref_id = p_escrow
               AND t.reason <> 'fair_exit_refund' AND t.reason <> 'escrow_refund'
               AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.transaction_id = t.id))
$f$;
CREATE FUNCTION pg_temp.refunded(p_escrow uuid) RETURNS bigint LANGUAGE sql AS $f$
    SELECT COALESCE(SUM(t.amount_cents), 0) FROM finance.transactions t
     WHERE t.direction = 'credit' AND t.ref_table = 'escrows' AND t.ref_id = p_escrow
       AND t.reason IN ('fair_exit_refund', 'escrow_refund')
$f$;
CREATE FUNCTION pg_temp.tier(p_preview jsonb, p_tier int) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT q FROM jsonb_array_elements(p_preview->'tiers') q WHERE (q->>'tier')::int = p_tier
$f$;
CREATE FUNCTION pg_temp.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'ASSERT FAILED: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $f$;

SELECT pg_temp.check((SELECT count(*) = 2 FROM finance.escrows WHERE project_stage_id = :'stage' AND status = 'held'
                       AND amount_cents = 2250000 AND payee_type = 'team'), 'fixture: two held team escrows of 2,250,000');
SELECT pg_temp.check((SELECT bool_and(finance.fn_escrow_fee_bp(payer_business_id, payer_user_id) = 500)
                        FROM finance.escrows WHERE project_stage_id = :'stage'), 'fixture: payer fee 500 bp');

-- ── S. the split arithmetic ──────────────────────────────────────────────────────────────────────
SELECT pg_temp.check((SELECT (share_cents, fee_cents, payout_cents, refund_cents) = (1125000::bigint, 56250::bigint, 1068750::bigint, 1125000::bigint)
                        FROM finance.fn_fair_exit_split(2250000, 5000, 500)), 'S split: 50% of 2,250,000 at 500 bp');
SELECT pg_temp.check((SELECT (share_cents, fee_cents, payout_cents, refund_cents) = (33::bigint, 1::bigint, 32::bigint, 100::bigint)
                        FROM finance.fn_fair_exit_split(133, 2500, 500)), 'S split: truncates (133 at 25% / 500 bp)');

-- ── A. preview, then exit at 50% ─────────────────────────────────────────────────────────────────
SAVEPOINT a;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT projects.preview_stage_fair_exit(:'project', :'stage') AS preview \gset
RESET ROLE;

SELECT pg_temp.check((:'preview'::jsonb->>'exitable')::boolean AND :'preview'::jsonb->'blocked' = 'null'::jsonb,
    'A preview: exitable, not blocked');
SELECT pg_temp.check((:'preview'::jsonb->>'held_cents')::bigint = 4500000 AND (:'preview'::jsonb->>'currency') = 'USD',
    'A preview: held 4,500,000 USD');
SELECT pg_temp.check((:'preview'::jsonb->>'tickets_to_cancel')::int = 2, 'A preview: 2 tickets to cancel');
SELECT pg_temp.check(jsonb_array_length(:'preview'::jsonb->'tiers') = 3, 'A preview: three tiers');
SELECT pg_temp.check((SELECT (q->>'freelancer_paid_cents')::bigint = 1068750 AND (q->>'fee_cents')::bigint = 56250
                             AND (q->>'client_refunded_cents')::bigint = 3375000
                        FROM pg_temp.tier(:'preview'::jsonb, 25) q), 'A preview: 25% → 1,068,750 / 56,250 / 3,375,000');
SELECT pg_temp.check((SELECT (q->>'freelancer_paid_cents')::bigint = 2137500 AND (q->>'fee_cents')::bigint = 112500
                             AND (q->>'client_refunded_cents')::bigint = 2250000
                        FROM pg_temp.tier(:'preview'::jsonb, 50) q), 'A preview: 50% → 2,137,500 / 112,500 / 2,250,000');
SELECT pg_temp.check((SELECT (q->>'freelancer_paid_cents')::bigint = 3206250 AND (q->>'fee_cents')::bigint = 168750
                             AND (q->>'client_refunded_cents')::bigint = 1125000
                        FROM pg_temp.tier(:'preview'::jsonb, 75) q), 'A preview: 75% → 3,206,250 / 168,750 / 1,125,000');
SELECT pg_temp.check((SELECT count(*) = 2 FROM finance.escrows WHERE project_stage_id = :'stage' AND status = 'held'),
    'A preview: moved nothing');

SET LOCAL ROLE authenticated;
SELECT projects.cancel_stage_fair_exit(:'project', :'stage', 50) AS exit_result \gset
RESET ROLE;

SELECT pg_temp.check((:'exit_result'::jsonb->>'freelancer_paid_cents') = (pg_temp.tier(:'preview'::jsonb, 50)->>'freelancer_paid_cents')
                 AND (:'exit_result'::jsonb->>'fee_cents') = (pg_temp.tier(:'preview'::jsonb, 50)->>'fee_cents')
                 AND (:'exit_result'::jsonb->>'client_refunded_cents') = (pg_temp.tier(:'preview'::jsonb, 50)->>'client_refunded_cents'),
    'A exit: reports exactly the previewed 50% figures');
SELECT pg_temp.check((:'exit_result'::jsonb->>'cancelled_count')::int = 2 AND (:'exit_result'::jsonb->>'tickets_cancelled')::int = 2,
    'A exit: 2 escrowed tickets settled, 2 tickets closed');
SELECT pg_temp.check(pg_temp.credited(:'e_review') = 1068750 AND pg_temp.credited(:'e_progress') = 1068750,
    'A exit: each escrow paid its net share once (members + vault, pending)');
SELECT pg_temp.check(pg_temp.refunded(:'e_review') = 1125000 AND pg_temp.refunded(:'e_progress') = 1125000,
    'A exit: each escrow refunded its unearned half to the payer');
SELECT pg_temp.check((SELECT status = 'cancelled' FROM projects.project_stages WHERE id = :'stage'), 'A exit: stage cancelled');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM finance.escrows WHERE project_stage_id = :'stage' AND status = 'held'), 'A exit: nothing held');
SELECT pg_temp.check((SELECT bool_and(status = 'cancelled') FROM projects.tickets WHERE id IN (:'t_review', :'t_progress')),
    'A exit: both tickets cancelled (terminal)');
SELECT pg_temp.check((SELECT bool_and(current_assignee_id IS NOT NULL) FROM projects.tickets WHERE id IN (:'t_review', :'t_progress')),
    'A exit: assignees kept for the record');
SELECT pg_temp.check((SELECT count(*) = 2 FROM projects.ticket_history
                       WHERE ticket_id IN (:'t_review', :'t_progress') AND changes->>'reason' = 'fair_exit'
                         AND new_status = 'cancelled'), 'A exit: ticket_history row per closed ticket');
SELECT pg_temp.check((SELECT count(DISTINCT user_id) >= 3 FROM comms.notifications
                       WHERE entity_id = :'stage' AND type = 'stage.cancelled' AND user_id <> :'owner'),
    'A exit: freelancer side notified (split recipients)');
SELECT pg_temp.check((SELECT count(DISTINCT user_id) = 2 FROM comms.notifications
                       WHERE entity_id = :'stage' AND type = 'stage.cancelled' AND user_id IN (:'assignee_a', :'assignee_b')),
    'A exit: both assignees notified');
SELECT pg_temp.check((SELECT count(*) = 1 FROM comms.notifications
                       WHERE entity_id = :'stage' AND type = 'stage.cancelled' AND user_id = :'owner'),
    'A exit: client (owner) notified once');

SET LOCAL ROLE authenticated;
SELECT projects.preview_stage_fair_exit(:'project', :'stage') AS after \gset
RESET ROLE;
SELECT pg_temp.check(NOT (:'after'::jsonb->>'exitable')::boolean AND (:'after'::jsonb->>'blocked') = 'settled',
    'A after: preview says settled');

DO $d$ BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM projects.cancel_stage_fair_exit('7f930a97-cfa8-4784-a7d0-61c913c2f3ce', '2756102c-7332-4015-a56f-147ee334fc4f', 50);
    RAISE EXCEPTION 'ASSERT FAILED: second exit was not refused';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
    RAISE NOTICE '%', ('ok  A refuse: second exit refused (' || SQLERRM || ')');
END $d$;
RESET ROLE;
ROLLBACK TO a;

-- ── B. a payee may neither preview nor exit ──────────────────────────────────────────────────────
SAVEPOINT b;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'assignee_a', 'role', 'authenticated')::text, true);
DO $d$ BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM projects.preview_stage_fair_exit('7f930a97-cfa8-4784-a7d0-61c913c2f3ce', '2756102c-7332-4015-a56f-147ee334fc4f');
    RAISE EXCEPTION 'ASSERT FAILED: payee preview was not refused';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '%', ('ok  B refuse: payee preview refused (' || SQLERRM || ')');
END $d$;
RESET ROLE;
DO $d$ BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM projects.cancel_stage_fair_exit('7f930a97-cfa8-4784-a7d0-61c913c2f3ce', '2756102c-7332-4015-a56f-147ee334fc4f', 75);
    RAISE EXCEPTION 'ASSERT FAILED: payee exit was not refused';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '%', ('ok  B refuse: payee exit refused (' || SQLERRM || ')');
END $d$;
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) = 2 FROM finance.escrows WHERE project_stage_id = :'stage' AND status = 'held'),
    'B: nothing moved');
ROLLBACK TO b;

-- ── C. a prepaid, unclaimed ticket is refunded whole at every tier ───────────────────────────────
SAVEPOINT c;
UPDATE finance.escrows SET payee_id = NULL, payee_type = NULL WHERE id = :'e_progress';
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT projects.preview_stage_fair_exit(:'project', :'stage') AS preview_c \gset
SELECT projects.cancel_stage_fair_exit(:'project', :'stage', 75) AS exit_c \gset
RESET ROLE;
SELECT pg_temp.check((SELECT (q->>'prepaid_cents')::bigint = 2250000 AND (q->>'freelancer_paid_cents')::bigint = 1603125
                             AND (q->>'client_refunded_cents')::bigint = 2812500
                        FROM pg_temp.tier(:'preview_c'::jsonb, 75) q), 'C preview: 75% pays only the claimed ticket, prepaid back whole');
SELECT pg_temp.check((:'exit_c'::jsonb->>'freelancer_paid_cents')::bigint = 1603125
                 AND (:'exit_c'::jsonb->>'client_refunded_cents')::bigint = 2812500, 'C exit: reports the previewed figures');
SELECT pg_temp.check((SELECT status = 'refunded' FROM finance.escrows WHERE id = :'e_progress')
                 AND pg_temp.refunded(:'e_progress') = 2250000 AND pg_temp.credited(:'e_progress') = 0,
    'C exit: prepaid escrow refunded whole, nobody paid');
SELECT pg_temp.check(pg_temp.credited(:'e_review') = 1603125 AND pg_temp.refunded(:'e_review') = 562500,
    'C exit: claimed escrow split 75/25 net of fee');
ROLLBACK TO c;

-- ── D. nothing held, and an invalid tier ─────────────────────────────────────────────────────────
SAVEPOINT d;
UPDATE finance.escrows SET status = 'refunded' WHERE project_stage_id = :'stage';
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT projects.preview_stage_fair_exit(:'project', :'stage') AS preview_d \gset
RESET ROLE;
SELECT pg_temp.check(NOT (:'preview_d'::jsonb->>'exitable')::boolean AND (:'preview_d'::jsonb->>'blocked') = 'nothing_held',
    'D preview: nothing held → blocked');
ROLLBACK TO d;

SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
DO $d$ BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM projects.cancel_stage_fair_exit('7f930a97-cfa8-4784-a7d0-61c913c2f3ce', '2756102c-7332-4015-a56f-147ee334fc4f', 40);
    RAISE EXCEPTION 'ASSERT FAILED: tier 40 was not refused';
EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE '%', ('ok  D refuse: tier 40 refused (' || SQLERRM || ')');
END $d$;
RESET ROLE;

-- ── G. grants ────────────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.check(has_function_privilege('authenticated', 'projects.preview_stage_fair_exit(uuid, uuid)', 'EXECUTE')
                 AND NOT has_function_privilege('anon', 'projects.preview_stage_fair_exit(uuid, uuid)', 'EXECUTE'),
    'G: preview executable by authenticated only');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'projects.fn_fair_exit_quote(uuid, integer)', 'EXECUTE')
                 AND NOT has_function_privilege('anon', 'projects.fn_fair_exit_quote(uuid, integer)', 'EXECUTE'),
    'G: quote is internal');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'finance.fn_fair_exit_split(bigint, integer, integer)', 'EXECUTE'),
    'G: split helper is internal');

ROLLBACK;
