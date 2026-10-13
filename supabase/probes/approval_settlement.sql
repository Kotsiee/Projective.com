-- approval_settlement.sql — probe for approval settling the board and the money together (Decision #194).
--
-- Accepting a submission completes its ticket and releases that ticket's escrow; approve_stage completes
-- every ticket still holding escrow, reports only its own releases, and notifies the payees, every
-- team-split recipient and the client. Each escrow is credited exactly once (pending_releases, #191).
-- Seeded fixtures: a team stage on prj-xghufr2r5b and an individual stage. One transaction, ROLLED BACK.
-- Run after `deno task db:reset`:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/approval_settlement.sql
\set ON_ERROR_STOP on
\set QUIET on
\set stage '2756102c-7332-4015-a56f-147ee334fc4f'
\set project '7f930a97-cfa8-4784-a7d0-61c913c2f3ce'
\set owner '292e1827-f189-4f34-ab35-27c9f0320926'
\set sub '90f3f6a2-d375-42b5-ad62-1dbc6815571f'
\set t_review 'bf5e3149-b68d-4bae-acf5-c7576b0d386c'
\set t_progress 'c05e32dc-b98d-4067-a9f5-c29e6a0d36d9'
\set e_review '7db54224-7d35-488f-a6ea-faf62685e4a1'
\set e_progress '7cb54091-7a35-43d6-a9ea-ffaf2785e634'
\set freelancer '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd'

BEGIN;

CREATE FUNCTION pg_temp.credited(p_escrow uuid) RETURNS bigint LANGUAGE sql AS $f$
    SELECT (SELECT COALESCE(SUM(amount_cents), 0) FROM finance.pending_releases WHERE escrow_id = p_escrow)
         + (SELECT COALESCE(SUM(t.amount_cents), 0) FROM finance.transactions t
             WHERE t.direction = 'credit' AND t.ref_table = 'escrows' AND t.ref_id = p_escrow
               AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.transaction_id = t.id))
$f$;
CREATE FUNCTION pg_temp.net(p_escrow uuid) RETURNS bigint LANGUAGE sql AS $f$
    SELECT (amount_cents + COALESCE(deadline_bonus_cents, 0) - platform_fee_cents)::bigint
      FROM finance.escrows WHERE id = p_escrow
$f$;
CREATE FUNCTION pg_temp.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'ASSERT FAILED: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $f$;

SELECT pg_temp.check(pg_temp.credited(:'e_review') = 0 AND pg_temp.credited(:'e_progress') = 0, 'fixture: nothing credited yet');

-- ── A. accept one submission, then approve the stage ─────────────────────────────────────────────
SAVEPOINT a;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT projects.review_submission(:'sub', 'accept', NULL) AS accept_result \gset
RESET ROLE;

SELECT pg_temp.check((:'accept_result'::jsonb->>'status') = 'accepted', 'A accept: submission accepted');
SELECT pg_temp.check((:'accept_result'::jsonb->>'released_count')::int = 1, 'A accept: released_count = 1');
SELECT pg_temp.check((SELECT status = 'completed' AND payment_status = 'released' FROM projects.tickets WHERE id = :'t_review'),
    'A accept: accepted ticket completed / released');
SELECT pg_temp.check((SELECT status = 'released' FROM finance.escrows WHERE id = :'e_review'), 'A accept: its escrow released');
SELECT pg_temp.check((SELECT status = 'held' FROM finance.escrows WHERE id = :'e_progress'), 'A accept: other ticket escrow still held');
SELECT pg_temp.check(pg_temp.credited(:'e_review') = pg_temp.net(:'e_review'), 'A accept: payout credited exactly once (members + vault = net)');
SELECT pg_temp.check((SELECT count(DISTINCT user_id) = 3 FROM comms.notifications
                       WHERE entity_id = :'sub' AND type = 'submission.accepted'),
    'A accept: all 3 split recipients notified');
SELECT pg_temp.check((SELECT count(*) = 1 FROM projects.ticket_history
                       WHERE ticket_id = :'t_review' AND changes->>'reason' = 'submission_accepted'),
    'A accept: ticket_history row written');
SELECT pg_temp.check((SELECT status = 'in_progress' FROM projects.project_stages WHERE id = :'stage'), 'A accept: stage not settled by an acceptance');

SET LOCAL ROLE authenticated;
SELECT projects.approve_stage(:'project', :'stage') AS approve_result \gset
RESET ROLE;

SELECT pg_temp.check((:'approve_result'::jsonb->>'released_count')::int = 1, 'A approve: released_count = 1 (only the still-held ticket)');
SELECT pg_temp.check((:'approve_result'::jsonb->>'total_paid_cents')::bigint = pg_temp.net(:'e_progress'),
    'A approve: total_paid_cents = this call''s release only');
SELECT pg_temp.check(jsonb_array_length(:'approve_result'::jsonb->'splits') = 3, 'A approve: splits only for this call''s escrow');
SELECT pg_temp.check((SELECT bool_and(status = 'completed' AND payment_status = 'released') FROM projects.tickets
                       WHERE id IN (:'t_review', :'t_progress')), 'A approve: every ticket completed / released');
SELECT pg_temp.check((SELECT status = 'paid' FROM projects.project_stages WHERE id = :'stage'), 'A approve: stage paid');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM finance.escrows WHERE project_stage_id = :'stage' AND status = 'held'), 'A approve: nothing held');
SELECT pg_temp.check(pg_temp.credited(:'e_review') = pg_temp.net(:'e_review'), 'A approve: accepted ticket NOT credited again');
SELECT pg_temp.check(pg_temp.credited(:'e_progress') = pg_temp.net(:'e_progress'), 'A approve: remaining ticket credited exactly once');
SELECT pg_temp.check((SELECT count(DISTINCT user_id) = 3 FROM comms.notifications
                       WHERE entity_id = :'stage' AND type = 'stage.approved' AND user_id <> :'owner'),
    'A approve: all 3 split recipients notified');
SELECT pg_temp.check((SELECT count(*) = 1 FROM comms.notifications
                       WHERE entity_id = :'stage' AND type = 'stage.approved' AND user_id = :'owner'),
    'A approve: client (owner) notified once');

SELECT pg_temp.check((SELECT count(*) FROM projects.stage_submissions WHERE project_stage_id = :'stage') > 0, 'A: setup for refusals');
SAVEPOINT a_refuse1;
DO $d$ BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM projects.approve_stage('7f930a97-cfa8-4784-a7d0-61c913c2f3ce', '2756102c-7332-4015-a56f-147ee334fc4f');
    RAISE EXCEPTION 'ASSERT FAILED: second approval was not refused';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
    RAISE NOTICE '%', ('ok  A refuse: second approval refused (' || SQLERRM || ')');
END $d$;
RESET ROLE;
ROLLBACK TO a_refuse1;

UPDATE projects.stage_submissions SET status = 'pending_review' WHERE id = '91f3f835-d275-4122-ae62-1f4f6715558c';
DO $d$ BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM projects.review_submission('91f3f835-d275-4122-ae62-1f4f6715558c', 'accept', NULL);
    RAISE EXCEPTION 'ASSERT FAILED: acceptance on a paid stage was not refused';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
    RAISE NOTICE '%', ('ok  A refuse: acceptance on a paid stage refused (' || SQLERRM || ')');
END $d$;
RESET ROLE;
ROLLBACK TO a;

-- ── B. approve straight away (no acceptance first) ───────────────────────────────────────────────
SAVEPOINT b;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT projects.approve_stage(:'project', :'stage') AS approve_b \gset
RESET ROLE;
SELECT pg_temp.check((:'approve_b'::jsonb->>'released_count')::int = 2, 'B approve: released_count = 2');
SELECT pg_temp.check((:'approve_b'::jsonb->>'total_paid_cents')::bigint = pg_temp.net(:'e_review') + pg_temp.net(:'e_progress'),
    'B approve: total = both nets');
SELECT pg_temp.check((SELECT bool_and(status = 'completed' AND payment_status = 'released') FROM projects.tickets
                       WHERE id IN (:'t_review', :'t_progress')), 'B approve: every ticket completed / released');
SELECT pg_temp.check(pg_temp.credited(:'e_review') = pg_temp.net(:'e_review') AND pg_temp.credited(:'e_progress') = pg_temp.net(:'e_progress'),
    'B approve: each escrow credited exactly once');
ROLLBACK TO b;

-- ── C. every ticket accepted, then approve: settles with nothing left to release ─────────────────
SAVEPOINT c;
UPDATE projects.tickets SET status = 'in_review' WHERE id = :'t_progress';
SELECT id AS sub2 FROM projects.stage_submissions WHERE ticket_id = :'t_progress' AND status = 'pending_review' \gset
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT projects.review_submission(:'sub', 'accept', NULL) IS NOT NULL AS c1 \gset
SELECT projects.review_submission(:'sub2', 'accept', NULL) IS NOT NULL AS c2 \gset
SELECT projects.approve_stage(:'project', :'stage') AS approve_c \gset
RESET ROLE;
SELECT pg_temp.check((:'approve_c'::jsonb->>'released_count')::int = 0 AND (:'approve_c'::jsonb->>'total_paid_cents')::bigint = 0,
    'C approve: released 0 / paid 0 when acceptances already paid out');
SELECT pg_temp.check((SELECT status = 'paid' FROM projects.project_stages WHERE id = :'stage'), 'C approve: stage paid without error');
SELECT pg_temp.check(pg_temp.credited(:'e_review') = pg_temp.net(:'e_review') AND pg_temp.credited(:'e_progress') = pg_temp.net(:'e_progress'),
    'C: each escrow credited exactly once across accept + approve');
ROLLBACK TO c;

-- ── D. individual payee: acceptance releases to the freelancer's wallet ─────────────────────────
SAVEPOINT d;
SELECT set_config('request.jwt.claims', json_build_object('sub', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT projects.review_submission('d3022839-7267-476c-a5b3-a2af45fe55c2', 'accept', NULL) AS accept_d \gset
RESET ROLE;
SELECT pg_temp.check((:'accept_d'::jsonb->>'released_count')::int = 1, 'D accept: released_count = 1');
SELECT pg_temp.check((SELECT status = 'completed' AND payment_status = 'released' FROM projects.tickets
                       WHERE id = '1d760dab-1897-4fce-a303-8ae991eebddc'), 'D accept: ticket completed / released');
SELECT pg_temp.check(pg_temp.credited('d4e6f3c4-8a98-4bf1-a851-bea6553126b3') = pg_temp.net('d4e6f3c4-8a98-4bf1-a851-bea6553126b3')
    AND (SELECT count(*) = 1 FROM finance.pending_releases WHERE escrow_id = 'd4e6f3c4-8a98-4bf1-a851-bea6553126b3'),
    'D accept: one credit, the net payout');
SELECT pg_temp.check((SELECT count(*) = 1 FROM comms.notifications WHERE type = 'submission.accepted'
                       AND user_id = '6ce1906f-caab-4708-a19e-df3d8960666e'), 'D accept: freelancer notified once');
ROLLBACK TO d;

-- ── E. a freelancer cannot accept or approve ────────────────────────────────────────────────────
SAVEPOINT e;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'freelancer', 'role', 'authenticated')::text, true);
DO $d$ BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM projects.review_submission('90f3f6a2-d375-42b5-ad62-1dbc6815571f', 'accept', NULL);
    RAISE EXCEPTION 'ASSERT FAILED: freelancer accepted own submission';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '%', ('ok  E refuse: freelancer cannot accept');
END $d$;
RESET ROLE;
DO $d$ BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM projects.approve_stage('7f930a97-cfa8-4784-a7d0-61c913c2f3ce', '2756102c-7332-4015-a56f-147ee334fc4f');
    RAISE EXCEPTION 'ASSERT FAILED: freelancer approved stage';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '%', ('ok  E refuse: freelancer cannot approve');
END $d$;
RESET ROLE;
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'projects.fn_settle_ticket_stage(uuid,uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'projects.fn_notify_payees(uuid[],uuid[],text,text,text,text,uuid,uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'projects.fn_notify_payees(uuid[],uuid[],text,text,text,text,uuid,uuid,text)', 'EXECUTE'),
    'E grants: internal helpers not callable by clients');
ROLLBACK TO e;

ROLLBACK;
