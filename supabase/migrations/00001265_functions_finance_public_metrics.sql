-- =============================================================================================
-- 00001265_functions_finance_public_metrics.sql — the public site's live platform aggregates
-- (/about and the landing page's live numbers; Decision #277). Category 1, finance functions.
--
-- One SECURITY DEFINER aggregate, executable by the service role only (00002510): the backend's
-- PublicMetricsService calls it and caches the answer for an hour. It returns AGGREGATES ONLY —
-- counts, sums and a median over the whole platform — and applies the publication threshold
-- itself: each figure is gated by its OWN count, so one resting on fewer than
-- `public_metrics_min_n` rows is NULL here (a sum over one escrow is one escrow's amount, which is
-- row-level data). The per-currency parts of the protected total are gated by the total's count
-- only; they reach the service role alone, and the public sees them only folded into one
-- converted, coarsened total (Decision #277 (C)).
--
-- In its own file because no surface region of the shared finance files fits a public-site read;
-- a new file cannot collide with the parallel public-routes branches.
-- =============================================================================================

-- #region [about_metrics] finance.public_metrics
CREATE OR REPLACE FUNCTION finance.public_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_param jsonb;
    v_min_n integer;
    v_min_n_configured boolean := false;
    v_min_n_usable boolean;
    v_fee_bp integer;
    v_base text;
    v_protected_count integer;
    v_by_currency jsonb;
    v_delivered integer;
    v_approvals integer;
    v_median double precision;
BEGIN
    -- The threshold. A number >= 1 is used (floored, capped at int4); anything else — a missing
    -- row, a string, zero — falls back to 10, the literal PUBLIC_METRICS_DEFAULT_MIN_N mirrors, and
    -- says so through min_n_configured so the service can log it.
    -- CASE rather than AND: PostgreSQL does not promise to evaluate AND's operands in order, and the
    -- cast must never see a string.
    SELECT p.value INTO v_param FROM security.platform_params p WHERE p.key = 'public_metrics_min_n';
    v_min_n_usable := CASE WHEN pg_catalog.jsonb_typeof(v_param) = 'number'
                           THEN (v_param #>> '{}')::numeric >= 1
                           ELSE false END;
    IF v_min_n_usable THEN
        v_min_n := LEAST(pg_catalog.floor((v_param #>> '{}')::numeric), 2147483647)::integer;
        v_min_n_configured := true;
    ELSE
        v_min_n := 10;
    END IF;

    -- The public fee rate (Decision #2) — the platform param itself, never a negotiated rate.
    SELECT CASE WHEN pg_catalog.jsonb_typeof(p.value) = 'number'
                THEN CASE WHEN (p.value #>> '{}')::numeric BETWEEN 0 AND 10000
                               AND (p.value #>> '{}')::numeric
                                   = pg_catalog.floor((p.value #>> '{}')::numeric)
                          THEN (p.value #>> '{}')::integer END
           END
      INTO v_fee_bp
      FROM security.platform_params p WHERE p.key = 'platform_fee_bp';

    SELECT CASE WHEN pg_catalog.jsonb_typeof(p.value) = 'string'
                     AND (p.value #>> '{}') ~ '^[A-Za-z]{3}$'
                THEN pg_catalog.upper(p.value #>> '{}') END
      INTO v_base
      FROM security.platform_params p WHERE p.key = 'base_currency';

    -- Value protected: escrowed principal that has not been handed back (PROTECTED_ESCROW_STATUSES).
    -- Per currency — amounts are stored in their origin currency and are never summed across
    -- currencies here; the service converts for display, read-time (finance-model.md §11).
    SELECT pg_catalog.count(*)::integer INTO v_protected_count
      FROM finance.escrows e
     WHERE e.status IN ('funded', 'held', 'disputed', 'released');

    IF v_protected_count >= v_min_n THEN
        SELECT pg_catalog.jsonb_agg(
                   pg_catalog.jsonb_build_object('currency', c.currency, 'amount_minor', c.amount_minor)
                   ORDER BY c.currency)
          INTO v_by_currency
          FROM (
              SELECT pg_catalog.upper(e.currency) AS currency,
                     pg_catalog.sum(e.amount_cents)::bigint AS amount_minor
                FROM finance.escrows e
               WHERE e.status IN ('funded', 'held', 'disputed', 'released')
               GROUP BY pg_catalog.upper(e.currency)
          ) c;
    ELSE
        v_protected_count := NULL;
    END IF;

    -- Stages delivered: approved or paid out, all time (an archived stage that was delivered stays
    -- delivered) — and only with MONEY EVIDENCE. A project's owner may write its stages' `status`
    -- and `completed_at` ("Users can manage stages of own projects"), so the stage's own word is
    -- not enough: at least one of its escrows must have been released to a payee, which only the
    -- settlement doors write. A personal project moves no money (Decision #192) and never counts.
    SELECT pg_catalog.count(*)::integer INTO v_delivered
      FROM projects.project_stages s
      JOIN projects.projects p ON p.id = s.project_id
     WHERE s.status IN ('approved', 'paid')
       AND NOT p.is_personal
       AND EXISTS (
           SELECT 1
             FROM finance.escrows e
            WHERE e.project_stage_id = s.id
              AND e.status = 'released'
              AND e.payee_id IS NOT NULL
       );
    IF v_delivered < v_min_n THEN
        v_delivered := NULL;
    END IF;

    -- Funding to approval: for each delivered stage (the same evidence rule), hours from its first
    -- released escrow being created to its LAST release — `released_at`, stamped by the definer
    -- release doors (fn_release_ticket_escrow), never the owner-writable `completed_at`, which is
    -- only the fallback for a released escrow that carries no `released_at` (the seed's do not).
    SELECT pg_catalog.count(*)::integer,
           pg_catalog.percentile_cont(0.5) WITHIN GROUP (ORDER BY d.hours)
      INTO v_approvals, v_median
      FROM (
          SELECT EXTRACT(EPOCH FROM (f.approved_at - f.funded_at)) / 3600.0 AS hours
            FROM projects.project_stages s
            JOIN projects.projects p ON p.id = s.project_id
            JOIN LATERAL (
                SELECT pg_catalog.min(e.created_at) AS funded_at,
                       COALESCE(pg_catalog.max(e.released_at), s.completed_at) AS approved_at
                  FROM finance.escrows e
                 WHERE e.project_stage_id = s.id
                   AND e.status = 'released'
                   AND e.payee_id IS NOT NULL
            ) f ON f.funded_at IS NOT NULL
           WHERE s.status IN ('approved', 'paid')
             AND NOT p.is_personal
             AND f.approved_at IS NOT NULL
             AND f.approved_at >= f.funded_at
      ) d;
    IF v_approvals < v_min_n THEN
        v_approvals := NULL;
        v_median := NULL;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'as_of', pg_catalog.to_jsonb(pg_catalog.now()),
        'min_n', v_min_n,
        'min_n_configured', v_min_n_configured,
        'platform_fee_bp', v_fee_bp,
        'base_currency', v_base,
        'protected_count', v_protected_count,
        'protected_by_currency', v_by_currency,
        'stages_delivered', v_delivered,
        'approval_count', v_approvals,
        'median_funding_to_approval_hours', v_median
    );
END;
$$;

COMMENT ON FUNCTION finance.public_metrics() IS
'The public site''s live platform aggregates (Decision #277): escrowed principal per currency
(funded/held/disputed/released), stages delivered (approved/paid, non-personal, with at least one
escrow released to a payee) and the median hours from a delivered stage''s first released escrow''s
creation to its last release (released_at, else completed_at), plus the platform_fee_bp and
base_currency params. Every figure whose own underlying count is below public_metrics_min_n
(default 10) is NULL together with its count. SECURITY DEFINER, service role only; read by
PublicMetricsService.';
-- #endregion
