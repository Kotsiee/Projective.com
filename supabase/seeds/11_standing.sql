-- =============================================================================================
-- 11_standing.sql — every seller's Standing, derived from the seeded record and computed by the
-- platform's own function.
--
-- Not generated: like 09_search.sql, every statement reads tables the earlier files created, so it
-- carries no data of its own and stays correct however the world in `gen/world.ts` changes.
--
-- `org.entity_standing` is a CACHE that a recompute sweep maintains (Decision #58(e)): its inputs are
-- aggregates of a seller's delivery record, and `org.fn_recompute_standing` turns them into the score,
-- the components and the rung. This file is that sweep's first run. Its inputs are backfilled from the
-- seeded projects, tickets, reviews, escrows and penalties — never typed in — so the rung the wallet,
-- the profile and the listing show is the one the seller's visible history actually earns.
--
-- The inputs, per subject (a freelancer by user id, a team by team id):
--
--   stages_completed      stage assignments the subject completed — the ladder's volume floor
--   completion_rate       delivered tickets ÷ (delivered + held tickets a workload report was filed on)
--   on_time_rate          delivered tickets whose accepted delivery arrived by the due date ÷ delivered
--                         (a ticket with no due date cannot be late; the client's later approval is
--                         not the freelancer's delay)
--   client_rating_avg     the average rating the subject was reviewed at (the platform's own cached
--                         `rating_average`, maintained from `reviews.entity_reviews`)
--   peer_rating_avg       peer reviews — the platform records none yet, so 0; the formula averages the
--                         two tracks, which a one-track record honestly halves
--   dispute_rate          disputed escrows ÷ escrows the subject was the payee of
--   workload_reliability  held tickets with no workload report ÷ held tickets
--   tenure_days           days since the account (or the team) was created
--   penalty_severity      active, unexpired penalties
--
-- A subject with no delivery history has 0 for every rate, which is what "New" means. The ladder has
-- TWO gates — a score and a completed-stage floor — so a seller whose score clears a rung their volume
-- has not reached is held at the lower rung; the wallet's Standing gauge draws exactly that.
-- =============================================================================================

WITH subjects AS (
    SELECT 'freelancer'::org.standing_subject AS subject_type,
           fp.user_id AS subject_id,
           up.created_at AS since,
           COALESCE(fp.rating_average, 0)::numeric AS rating
    FROM org.freelancer_profiles fp
    JOIN org.users_public up ON up.user_id = fp.user_id
    UNION ALL
    SELECT 'team'::org.standing_subject, t.id, t.created_at, COALESCE(t.rating_average, 0)::numeric
    FROM org.teams t
),
-- The tickets a subject has held: its own claims, or — for a team — work in a stage assigned to it.
held AS (
    SELECT s.subject_type, s.subject_id, tk.id AS ticket_id, tk.status::text AS status,
           tk.due_date, tk.updated_at, tk.workload_report_id
    FROM subjects s
    JOIN projects.tickets tk ON s.subject_type = 'freelancer' AND tk.current_assignee_id = s.subject_id
    WHERE tk.status::text IN ('claimed', 'in_progress', 'in_review', 'completed')
    UNION
    SELECT s.subject_type, s.subject_id, tk.id, tk.status::text, tk.due_date, tk.updated_at, tk.workload_report_id
    FROM subjects s
    JOIN projects.stage_assignments sa ON s.subject_type = 'team' AND sa.team_id = s.subject_id
    JOIN projects.tickets tk ON tk.current_stage_id = sa.project_stage_id
    WHERE tk.status::text IN ('claimed', 'in_progress', 'in_review', 'completed')
),
-- When each delivered ticket was DELIVERED: the accepted submission's arrival. The client's approval
-- (the move to `completed`) can come days later, and that wait is not the freelancer's lateness; it
-- stands in only for a ticket closed without a recorded submission.
delivered AS (
    SELECT h.subject_type, h.subject_id, h.ticket_id, h.due_date,
           COALESCE(
               (SELECT max(ss.created_at) FROM projects.stage_submissions ss
                 WHERE ss.ticket_id = h.ticket_id AND ss.status = 'accepted'),
               (SELECT max(th.created_at) FROM projects.ticket_history th
                 WHERE th.ticket_id = h.ticket_id AND th.new_status::text = 'completed'),
               h.updated_at
           ) AS delivered_at
    FROM held h
    WHERE h.status = 'completed'
),
record AS (
    SELECT
        s.subject_type,
        s.subject_id,
        s.rating,
        GREATEST(0, (now()::date - s.since::date))::integer AS tenure_days,
        (SELECT count(*) FROM projects.stage_assignments sa
          WHERE sa.status = 'completed'
            AND CASE WHEN s.subject_type = 'team' THEN sa.team_id = s.subject_id
                     ELSE sa.freelancer_profile_id = s.subject_id END)::integer AS stages_completed,
        (SELECT count(*) FROM held h
          WHERE h.subject_type = s.subject_type AND h.subject_id = s.subject_id)::numeric AS held_n,
        (SELECT count(*) FROM held h
          WHERE h.subject_type = s.subject_type AND h.subject_id = s.subject_id
            AND h.workload_report_id IS NOT NULL)::numeric AS reported_n,
        (SELECT count(*) FROM delivered d
          WHERE d.subject_type = s.subject_type AND d.subject_id = s.subject_id)::numeric AS delivered_n,
        (SELECT count(*) FROM delivered d
          WHERE d.subject_type = s.subject_type AND d.subject_id = s.subject_id
            AND (d.due_date IS NULL OR d.delivered_at <= d.due_date))::numeric AS on_time_n,
        (SELECT count(*) FROM finance.escrows e
          WHERE e.payee_type::text = s.subject_type::text AND e.payee_id = s.subject_id)::numeric AS escrows_n,
        (SELECT count(*) FROM finance.escrows e
          WHERE e.payee_type::text = s.subject_type::text AND e.payee_id = s.subject_id
            AND e.status = 'disputed')::numeric AS disputed_n,
        (SELECT COALESCE(sum(p.severity), 0) FROM security.penalties p
          WHERE p.subject_type = s.subject_type::text AND p.subject_id = s.subject_id
            AND p.status = 'active' AND (p.expires_at IS NULL OR p.expires_at > now()))::numeric AS penalty
    FROM subjects s
)
INSERT INTO org.entity_standing (
    subject_type, subject_id, stages_completed, completion_rate, on_time_rate,
    client_rating_avg, peer_rating_avg, dispute_rate, workload_reliability, tenure_days, penalty_severity
)
SELECT
    r.subject_type,
    r.subject_id,
    r.stages_completed,
    CASE WHEN r.delivered_n + r.reported_n > 0 THEN round(r.delivered_n / (r.delivered_n + r.reported_n), 4) ELSE 0 END,
    CASE WHEN r.delivered_n > 0 THEN round(r.on_time_n / r.delivered_n, 4) ELSE 0 END,
    LEAST(5, GREATEST(0, round(r.rating, 2))),
    0,
    CASE WHEN r.escrows_n > 0 THEN round(r.disputed_n / r.escrows_n, 4) ELSE 0 END,
    CASE WHEN r.held_n > 0 THEN round((r.held_n - r.reported_n) / r.held_n, 4) ELSE 0 END,
    r.tenure_days,
    r.penalty
FROM record r
ON CONFLICT (subject_type, subject_id) DO UPDATE SET
    stages_completed = EXCLUDED.stages_completed,
    completion_rate = EXCLUDED.completion_rate,
    on_time_rate = EXCLUDED.on_time_rate,
    client_rating_avg = EXCLUDED.client_rating_avg,
    peer_rating_avg = EXCLUDED.peer_rating_avg,
    dispute_rate = EXCLUDED.dispute_rate,
    workload_reliability = EXCLUDED.workload_reliability,
    tenure_days = EXCLUDED.tenure_days,
    penalty_severity = EXCLUDED.penalty_severity;

-- The score, the components and the rung are the platform's to compute, not this file's.
SELECT org.fn_recompute_standing(es.subject_type, es.subject_id)
FROM org.entity_standing es
ORDER BY es.subject_type, es.subject_id;
