-- =============================================================================================
-- 20260724113000_entitlements_allowances_enforcement.sql
-- Subscriptions, Standing & Gamification foundation (4/4) — resolution, metering & enforcement.
--
-- ADDITIVE ONLY. New finance tables, new resolver/metering functions, new PARAM-GATED triggers on
-- existing project tables. No existing table, column, FK, function or trigger is dropped or altered.
-- Authored, NOT applied to any live database.
--
-- ⚠️ ENFORCEMENT IS FAIL-OPEN BY DEFAULT. The two triggers below METER unconditionally (so the caps
-- can be tuned against real telemetry) but only BLOCK when their platform param is switched on —
-- `proposal_allowance_enforced` and `footprint_caps_enforced`, both seeded `false`. Turning either on
-- changes user-visible behaviour on a live marketplace and is a deliberate human decision, not a
-- side effect of running a migration.
--
-- ⚠️ KNOWN LIMIT of that design (verified by execution, documented rather than papered over): while a
-- param is OFF the `entitlement.denied` event is committed normally, but once it is ON the RAISE
-- aborts the transaction — which rolls back the analytics row that was written moments earlier.
-- Postgres has no autonomous transactions, so a denial under active enforcement must be recorded by
-- the APP layer (catch the `check_violation`, then call `analytics.fn_emit`) if the denial funnel is
-- to stay measurable after the switch is flipped.
--
-- ⚠️ EXECUTION CAPACITY IS NEVER METERED HERE. Nothing in this file limits how much work a freelancer
-- may hold — that stays with the $W_i$ concurrency caps (`projects.check_ticket_capacity`).
-- =============================================================================================

-- #region 1. Audience + active-plan resolution
-- Which plan catalogue does this subject shop from?
CREATE OR REPLACE FUNCTION finance.fn_audience_for(p_subject_type text)
RETURNS finance.plan_audience
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_subject_type
        WHEN 'user' THEN 'individual'
        WHEN 'freelancer' THEN 'individual'
        WHEN 'team' THEN 'team'
        WHEN 'business' THEN 'business'
        WHEN 'organisation' THEN 'organisation'
    END::finance.plan_audience;
$$;

-- The subject's live plan, falling back to its audience's default free plan. Every subject therefore
-- ALWAYS resolves to a plan — there is no unentitled state.
CREATE OR REPLACE FUNCTION finance.fn_active_plan(p_subject_type text, p_subject_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, public
AS $$
    SELECT COALESCE(
        (SELECT s.plan_id
         FROM finance.subscriptions s
         WHERE s.subject_type = p_subject_type
           AND s.subject_id = p_subject_id
           AND s.plan_id IS NOT NULL
           AND s.state IN ('trialing', 'active', 'past_due')
           AND (s.current_period_end IS NULL OR s.current_period_end > now())
         ORDER BY s.created_at DESC
         LIMIT 1),
        (SELECT p.id FROM finance.plans p
         WHERE p.audience = finance.fn_audience_for (p_subject_type) AND p.is_default
         LIMIT 1)
    );
$$;

-- The subject's earned rung, for the two scaling modes. Business/organisation subjects do not carry
-- Standing (they are buyers, ranked by the separate Client Trust Score) → they resolve to rung 1.
CREATE OR REPLACE FUNCTION finance.fn_subject_standing_level(p_subject_type text, p_subject_id uuid)
RETURNS smallint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, public
AS $$
    SELECT CASE
        WHEN p_subject_type IN ('user', 'freelancer', 'team')
            THEN org.fn_standing_level (p_subject_type::org.standing_subject, p_subject_id)
        ELSE 1::smallint
    END;
$$;
-- #endregion

-- #region 2. finance.fn_effective_limit — plan × standing × grant
-- Returns the numeric ceiling for a limit-kind entitlement.
--   NULL  = UNLIMITED
--   0     = not granted by this subject's plan
-- A grant may only RAISE the result, never lower it — a misconfigured comp can never suffocate a
-- paying subject.
CREATE OR REPLACE FUNCTION finance.fn_effective_limit(
    p_subject_type text,
    p_subject_id uuid,
    p_key finance.entitlement_key
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = finance, org, public
AS $$
DECLARE
    v_plan uuid;
    v_ent finance.plan_entitlements%ROWTYPE;
    v_level smallint;
    v_lvl org.standing_levels%ROWTYPE;
    v_base integer;
    v_unlimited boolean := false;
    v_grant_unlimited boolean := false;
    v_grant integer;
BEGIN
    v_plan := finance.fn_active_plan (p_subject_type, p_subject_id);

    SELECT * INTO v_ent FROM finance.plan_entitlements e
    WHERE e.plan_id = v_plan AND e.entitlement_key = p_key;

    IF FOUND THEN
        IF v_ent.is_unlimited THEN
            v_unlimited := true;
        ELSE
            v_level := finance.fn_subject_standing_level (p_subject_type, p_subject_id);
            SELECT * INTO v_lvl FROM org.standing_levels l WHERE l.level = v_level;

            v_base := CASE v_ent.scaling
                WHEN 'standing_base'  THEN ((COALESCE(v_lvl.listing_base, 0)::numeric * v_ent.multiplier_bp) / 10000)::integer
                WHEN 'standing_bonus' THEN COALESCE(v_ent.limit_value, 0) + COALESCE(v_lvl.proposal_bonus, 0)
                ELSE COALESCE(v_ent.limit_value, 0)
            END;
        END IF;
    ELSE
        v_base := 0;   -- deny by default: an entitlement a plan does not name is not granted
    END IF;

    SELECT bool_or(g.is_unlimited), max(g.limit_value)
    INTO v_grant_unlimited, v_grant
    FROM finance.entitlement_grants g
    WHERE g.subject_type = p_subject_type
      AND g.subject_id = p_subject_id
      AND g.entitlement_key = p_key
      AND g.starts_at <= now()
      AND (g.expires_at IS NULL OR g.expires_at > now());

    IF v_unlimited OR COALESCE(v_grant_unlimited, false) THEN
        RETURN NULL;
    END IF;

    RETURN GREATEST(COALESCE(v_base, 0), COALESCE(v_grant, 0));
END;
$$;

-- Boolean capability resolution (flag-kind entitlements).
CREATE OR REPLACE FUNCTION finance.fn_has_entitlement(
    p_subject_type text,
    p_subject_id uuid,
    p_key finance.entitlement_key
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, public
AS $$
    SELECT COALESCE(
        (SELECT bool_or(g.flag_value)
         FROM finance.entitlement_grants g
         WHERE g.subject_type = p_subject_type AND g.subject_id = p_subject_id
           AND g.entitlement_key = p_key AND g.flag_value IS TRUE
           AND g.starts_at <= now() AND (g.expires_at IS NULL OR g.expires_at > now())),
        (SELECT e.flag_value FROM finance.plan_entitlements e
         WHERE e.plan_id = finance.fn_active_plan (p_subject_type, p_subject_id)
           AND e.entitlement_key = p_key),
        false
    );
$$;

GRANT EXECUTE ON FUNCTION finance.fn_audience_for(text) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.fn_active_plan(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.fn_subject_standing_level(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.fn_effective_limit(text, uuid, finance.entitlement_key) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.fn_has_entitlement(text, uuid, finance.entitlement_key) TO authenticated;
-- #endregion

-- #region 3. Effective rates — the earned commission taper + the negotiated fee flex
-- Marketplace commission tapers with the EARNED rung (finance-model.md §1.2, 8% → 6.5%).
CREATE OR REPLACE FUNCTION finance.fn_effective_commission_bp(p_subject_type text, p_subject_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, public
AS $$
    SELECT COALESCE(
        (SELECT n.marketplace_commission_bp FROM finance.negotiated_rates n
         WHERE n.subject_type = p_subject_type AND n.subject_id = p_subject_id
           AND n.status = 'active' AND n.starts_at <= now()
           AND (n.ends_at IS NULL OR n.ends_at > now())
           AND n.marketplace_commission_bp IS NOT NULL
         ORDER BY n.starts_at DESC LIMIT 1),
        (SELECT t.marketplace_commission_bp FROM finance.standing_commission_tiers t
         WHERE t.level = finance.fn_subject_standing_level (p_subject_type, p_subject_id)),
        800
    );
$$;

-- The 5% project service fee. It does NOT taper with Standing and is NOT sold with any plan; the only
-- sanctioned flex is an admin-approved `finance.negotiated_rates` row for an Organisation/Business
-- volume commitment (owner decision, 2026-07-24). Falls back to the platform param.
CREATE OR REPLACE FUNCTION finance.fn_effective_platform_fee_bp(p_subject_type text, p_subject_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, security, public
AS $$
    SELECT COALESCE(
        (SELECT n.platform_fee_bp FROM finance.negotiated_rates n
         WHERE n.subject_type = p_subject_type AND n.subject_id = p_subject_id
           AND n.status = 'active' AND n.starts_at <= now()
           AND (n.ends_at IS NULL OR n.ends_at > now())
         ORDER BY n.starts_at DESC LIMIT 1),
        (SELECT (value #>> '{}')::integer FROM security.platform_params WHERE key = 'platform_fee_bp'),
        0
    );
$$;

GRANT EXECUTE ON FUNCTION finance.fn_effective_commission_bp(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.fn_effective_platform_fee_bp(text, uuid) TO authenticated;
-- #endregion

-- #region 4. finance.allowance_periods — metered distribution
-- One live row per (subject, allowance key). `granted_units` is snapshotted at period roll so a
-- mid-week upgrade or promotion is visible as an explicit new grant rather than a silent drift.
--
-- THE BUFFER: `buffer_units` is the anti-burst drip (3 per 10h free / 5 per 10h Pro). Consumption
-- needs BOTH a buffer token and weekly headroom, so a subject cannot dump a whole week's allowance
-- into one hour of spam. The drip magnitude, the hold cap and the weekly ceiling are all TUNABLE
-- DIALS — `analytics.events` (`allowance.*`) is the substrate they get re-fitted against.
CREATE TABLE IF NOT EXISTS finance.allowance_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type text NOT NULL CHECK (subject_type IN ('user', 'freelancer', 'team', 'business', 'organisation')),
    subject_id uuid NOT NULL,
    entitlement_key finance.entitlement_key NOT NULL,
    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,
    granted_units integer NOT NULL DEFAULT 0 CHECK (granted_units >= 0),
    consumed_units integer NOT NULL DEFAULT 0 CHECK (consumed_units >= 0),
    -- Provenance of the grant, so the UI can say "50 base + 20 earned".
    base_units integer NOT NULL DEFAULT 0,
    standing_bonus_units integer NOT NULL DEFAULT 0,
    buffer_units integer NOT NULL DEFAULT 0 CHECK (buffer_units >= 0),
    buffer_cap integer NOT NULL DEFAULT 0 CHECK (buffer_cap >= 0),
    buffer_refreshed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_allowance_period UNIQUE (subject_type, subject_id, entitlement_key, period_start)
);

CREATE INDEX IF NOT EXISTS idx_allowance_periods_lookup
    ON finance.allowance_periods (subject_type, subject_id, entitlement_key, period_end DESC);
-- No partial predicate here: `now()` is only STABLE and is rejected in an index predicate. The sweep
-- filters on period_end at query time instead.
CREATE INDEX IF NOT EXISTS idx_allowance_periods_buffer_sweep
    ON finance.allowance_periods (period_end, buffer_refreshed_at);

ALTER TABLE finance.allowance_periods ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.allowance_periods TO authenticated;
GRANT ALL ON TABLE finance.allowance_periods TO service_role;

DROP POLICY IF EXISTS "View own allowances" ON finance.allowance_periods;
CREATE POLICY "View own allowances" ON finance.allowance_periods FOR
SELECT TO authenticated USING (finance.fn_owner_visible (subject_type, subject_id));

-- Append-only consumption record — the audit behind "42/50 used this week".
CREATE TABLE IF NOT EXISTS finance.allowance_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    period_id uuid NOT NULL REFERENCES finance.allowance_periods (id) ON DELETE CASCADE,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    entitlement_key finance.entitlement_key NOT NULL,
    units integer NOT NULL,                        -- negative = refund (a withdrawn proposal)
    reason text NOT NULL,
    ref_table text,
    ref_id uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_allowance_ledger_period ON finance.allowance_ledger (period_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_allowance_ledger_ref ON finance.allowance_ledger (ref_table, ref_id);

ALTER TABLE finance.allowance_ledger ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.allowance_ledger TO authenticated;
GRANT ALL ON TABLE finance.allowance_ledger TO service_role;

DROP POLICY IF EXISTS "View own allowance ledger" ON finance.allowance_ledger;
CREATE POLICY "View own allowance ledger" ON finance.allowance_ledger FOR
SELECT TO authenticated USING (finance.fn_owner_visible (subject_type, subject_id));
-- #endregion

-- #region 5. Allowance metering functions

-- Open (or roll) the current weekly period, applying the drip to the buffer. Returns the live row.
CREATE OR REPLACE FUNCTION finance.fn_current_allowance(
    p_subject_type text,
    p_subject_id uuid,
    p_key finance.entitlement_key DEFAULT 'weekly_proposals'
)
RETURNS finance.allowance_periods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, org, security, analytics, public
AS $$
DECLARE
    v_row finance.allowance_periods%ROWTYPE;
    v_start timestamptz := date_trunc('week', now());
    v_granted integer;
    v_base integer;
    v_bonus integer;
    v_drip integer;
    v_multiple integer;
    v_elapsed integer;
    v_plan uuid;
BEGIN
    SELECT * INTO v_row FROM finance.allowance_periods a
    WHERE a.subject_type = p_subject_type AND a.subject_id = p_subject_id
      AND a.entitlement_key = p_key AND a.period_start = v_start;

    IF NOT FOUND THEN
        v_granted := COALESCE(finance.fn_effective_limit (p_subject_type, p_subject_id, p_key), 2147483647);
        v_plan := finance.fn_active_plan (p_subject_type, p_subject_id);

        SELECT COALESCE(e.limit_value, 0) INTO v_base FROM finance.plan_entitlements e
        WHERE e.plan_id = v_plan AND e.entitlement_key = p_key;
        v_base := COALESCE(v_base, 0);
        v_bonus := GREATEST(v_granted - v_base, 0);

        v_drip := COALESCE(finance.fn_effective_limit (p_subject_type, p_subject_id, 'proposal_buffer_per_10h'), 0);
        SELECT (value #>> '{}')::integer INTO v_multiple
        FROM security.platform_params WHERE key = 'proposal_buffer_hold_multiple';
        v_multiple := COALESCE(v_multiple, 4);

        INSERT INTO finance.allowance_periods (
            subject_type, subject_id, entitlement_key, period_start, period_end,
            granted_units, base_units, standing_bonus_units, buffer_units, buffer_cap
        ) VALUES (
            p_subject_type, p_subject_id, p_key, v_start, v_start + interval '7 days',
            v_granted, v_base, v_bonus, v_drip * v_multiple, v_drip * v_multiple
        )
        ON CONFLICT (subject_type, subject_id, entitlement_key, period_start) DO NOTHING;

        SELECT * INTO v_row FROM finance.allowance_periods a
        WHERE a.subject_type = p_subject_type AND a.subject_id = p_subject_id
          AND a.entitlement_key = p_key AND a.period_start = v_start;

        PERFORM analytics.fn_emit (
            'allowance.period_rolled',
            CASE WHEN p_subject_type IN ('user', 'freelancer', 'team')
                 THEN p_subject_type::analytics.subject_kind ELSE 'user'::analytics.subject_kind END,
            p_subject_id,
            jsonb_build_object('key', p_key, 'granted', v_granted, 'base', v_base, 'standing_bonus', v_bonus),
            v_granted, NULL, 'allowance'
        );
    END IF;

    -- Lazy drip: top the buffer up for every whole replenish window elapsed since the last refresh.
    SELECT (value #>> '{}')::integer INTO v_elapsed
    FROM security.platform_params WHERE key = 'proposal_buffer_window_hours';
    v_elapsed := COALESCE(v_elapsed, 10);

    IF v_row.buffer_units < v_row.buffer_cap
        AND now() >= v_row.buffer_refreshed_at + make_interval(hours => v_elapsed) THEN

        v_drip := COALESCE(finance.fn_effective_limit (p_subject_type, p_subject_id, 'proposal_buffer_per_10h'), 0);

        UPDATE finance.allowance_periods a
        SET buffer_units = LEAST(
                a.buffer_cap,
                a.buffer_units + v_drip * GREATEST(1, floor(EXTRACT(EPOCH FROM (now() - a.buffer_refreshed_at)) / (v_elapsed * 3600))::integer)
            ),
            buffer_refreshed_at = now()
        WHERE a.id = v_row.id
        RETURNING * INTO v_row;

        PERFORM analytics.fn_emit (
            'allowance.buffer_replenished',
            CASE WHEN p_subject_type IN ('user', 'freelancer', 'team')
                 THEN p_subject_type::analytics.subject_kind ELSE 'user'::analytics.subject_kind END,
            p_subject_id,
            jsonb_build_object('key', p_key, 'units', v_row.buffer_units, 'buffer_cap', v_row.buffer_cap),
            v_row.buffer_units, NULL, 'allowance'
        );
    END IF;

    RETURN v_row;
END;
$$;

-- Spend allowance units. Returns TRUE when the spend was permitted. Records consumption either way so
-- the denial rate — the upgrade signal — is measurable.
CREATE OR REPLACE FUNCTION finance.fn_consume_allowance(
    p_subject_type text,
    p_subject_id uuid,
    p_units integer DEFAULT 1,
    p_key finance.entitlement_key DEFAULT 'weekly_proposals',
    p_reason text DEFAULT 'proposal',
    p_ref_table text DEFAULT NULL,
    p_ref_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, analytics, public
AS $$
DECLARE
    v_row finance.allowance_periods%ROWTYPE;
    v_kind analytics.subject_kind;
    v_remaining integer;
    v_from_buffer boolean;
BEGIN
    v_row := finance.fn_current_allowance (p_subject_type, p_subject_id, p_key);
    v_kind := CASE WHEN p_subject_type IN ('user', 'freelancer', 'team')
                   THEN p_subject_type::analytics.subject_kind ELSE 'user'::analytics.subject_kind END;

    v_remaining := v_row.granted_units - v_row.consumed_units;
    v_from_buffer := v_row.buffer_cap > 0;

    IF v_remaining < p_units OR (v_from_buffer AND v_row.buffer_units < p_units) THEN
        PERFORM analytics.fn_emit (
            'allowance.exhausted', v_kind, p_subject_id,
            jsonb_build_object('key', p_key, 'granted', v_row.granted_units, 'period_start', v_row.period_start),
            v_row.granted_units, NULL, 'allowance'
        );
        RETURN false;
    END IF;

    UPDATE finance.allowance_periods a
    SET consumed_units = a.consumed_units + p_units,
        buffer_units = CASE WHEN v_from_buffer THEN GREATEST(a.buffer_units - p_units, 0) ELSE a.buffer_units END
    WHERE a.id = v_row.id
    RETURNING * INTO v_row;

    INSERT INTO finance.allowance_ledger (period_id, subject_type, subject_id, entitlement_key, units, reason, ref_table, ref_id)
    VALUES (v_row.id, p_subject_type, p_subject_id, p_key, p_units, p_reason, p_ref_table, p_ref_id);

    PERFORM analytics.fn_emit (
        'allowance.consumed', v_kind, p_subject_id,
        jsonb_build_object(
            'key', p_key, 'units', p_units,
            'remaining', v_row.granted_units - v_row.consumed_units,
            'from_buffer', v_from_buffer, 'period_start', v_row.period_start
        ),
        p_units, NULL, 'allowance'
    );

    RETURN true;
END;
$$;

-- Return units to the current period (a withdrawn proposal should not cost the week's allowance).
CREATE OR REPLACE FUNCTION finance.fn_refund_allowance(
    p_subject_type text,
    p_subject_id uuid,
    p_units integer DEFAULT 1,
    p_key finance.entitlement_key DEFAULT 'weekly_proposals',
    p_reason text DEFAULT 'withdrawn',
    p_ref_table text DEFAULT NULL,
    p_ref_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public
AS $$
DECLARE
    v_row finance.allowance_periods%ROWTYPE;
BEGIN
    v_row := finance.fn_current_allowance (p_subject_type, p_subject_id, p_key);

    UPDATE finance.allowance_periods a
    SET consumed_units = GREATEST(a.consumed_units - p_units, 0)
    WHERE a.id = v_row.id;

    INSERT INTO finance.allowance_ledger (period_id, subject_type, subject_id, entitlement_key, units, reason, ref_table, ref_id)
    VALUES (v_row.id, p_subject_type, p_subject_id, p_key, -p_units, p_reason, p_ref_table, p_ref_id);

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION finance.fn_current_allowance(text, uuid, finance.entitlement_key) TO authenticated;
REVOKE ALL ON FUNCTION finance.fn_consume_allowance(text, uuid, integer, finance.entitlement_key, text, text, uuid) FROM public;
REVOKE ALL ON FUNCTION finance.fn_refund_allowance(text, uuid, integer, finance.entitlement_key, text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION finance.fn_consume_allowance(text, uuid, integer, finance.entitlement_key, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION finance.fn_refund_allowance(text, uuid, integer, finance.entitlement_key, text, text, uuid) TO service_role;
-- #endregion

-- #region 6. Footprint usage — live counts against the marketplace-footprint caps
-- Live public postings held by a subject. Drafts are NEVER counted: unlimited private drafting is the
-- baseline promise (the "Figma model" — you are never charged to think).
CREATE OR REPLACE FUNCTION finance.fn_footprint_usage(
    p_subject_type text,
    p_subject_id uuid,
    p_key finance.entitlement_key
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = finance, projects, org, public
AS $$
DECLARE
    v_count integer := 0;
BEGIN
    IF p_key IN ('active_public_projects', 'business_public_projects', 'team_public_projects') THEN
        SELECT count(*) INTO v_count
        FROM projects.projects p
        WHERE p.status IN ('active'::project_status, 'on_hold'::project_status)
          AND p.visibility = 'public'::visibility
          AND (
              (p_subject_type = 'business' AND p.client_business_id = p_subject_id)
              OR (p_subject_type IN ('user', 'freelancer') AND p.owner_user_id = p_subject_id AND p.client_business_id IS NULL)
          );

    ELSIF p_key = 'teams_owned' THEN
        SELECT count(*) INTO v_count FROM org.teams t WHERE t.owner_user_id = p_subject_id;

    ELSIF p_key = 'businesses_owned' THEN
        SELECT count(*) INTO v_count FROM org.business_profiles b WHERE b.owner_user_id = p_subject_id;

    ELSIF p_key = 'team_seats' THEN
        SELECT count(*) INTO v_count FROM org.team_members m
        WHERE m.team_id = p_subject_id AND m.status = 'active';

    ELSIF p_key = 'organisation_seats' THEN
        SELECT count(*) INTO v_count FROM org.organisation_members m
        WHERE m.organisation_id = p_subject_id AND m.status = 'active';

    ELSIF p_key = 'organisation_businesses' THEN
        -- Businesses are not yet FK-linked to an organisation (Phase 2); counted as 0 until they are.
        v_count := 0;

    -- `published_listings` intentionally returns 0: the catalogue.* listing tables are deferred
    -- (Decision #53 keeps /catalogue on fixtures). The cap RESOLVES today via fn_effective_limit;
    -- its live usage count lands with those tables.
    END IF;

    RETURN COALESCE(v_count, 0);
END;
$$;

-- Headroom left, or NULL when the entitlement is unlimited.
CREATE OR REPLACE FUNCTION finance.fn_footprint_remaining(
    p_subject_type text,
    p_subject_id uuid,
    p_key finance.entitlement_key
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = finance, public
AS $$
DECLARE
    v_limit integer;
BEGIN
    v_limit := finance.fn_effective_limit (p_subject_type, p_subject_id, p_key);
    IF v_limit IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN GREATEST(v_limit - finance.fn_footprint_usage (p_subject_type, p_subject_id, p_key), 0);
END;
$$;

GRANT EXECUTE ON FUNCTION finance.fn_footprint_usage(text, uuid, finance.entitlement_key) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.fn_footprint_remaining(text, uuid, finance.entitlement_key) TO authenticated;
-- #endregion

-- #region 7. Enforcement — metered always, blocking only when switched on

-- Proposals: one outbound application spends one allowance unit from the APPLICANT (the team when a
-- team applies, otherwise the user). Anti-spam, not a paywall — the ceiling exists on every tier.
CREATE OR REPLACE FUNCTION projects.fn_meter_application_allowance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = projects, finance, security, analytics, public
AS $$
DECLARE
    v_subject_type text;
    v_subject_id uuid;
    v_ok boolean;
    v_enforced boolean;
BEGIN
    IF NEW.applicant_type = 'team' THEN
        v_subject_type := 'team';
        v_subject_id := NEW.applicant_profile_id;
    ELSE
        v_subject_type := 'user';
        v_subject_id := NEW.applicant_user_id;
    END IF;

    v_ok := finance.fn_consume_allowance (
        v_subject_type, v_subject_id, 1, 'weekly_proposals', 'proposal',
        'projects.project_applications', NEW.id
    );

    IF NOT v_ok THEN
        PERFORM analytics.fn_emit (
            'entitlement.denied',
            CASE WHEN v_subject_type = 'team' THEN 'team'::analytics.subject_kind ELSE 'user'::analytics.subject_kind END,
            v_subject_id,
            jsonb_build_object('key', 'weekly_proposals', 'attempted', 1), 1, NEW.project_id, 'allowance'
        );

        SELECT COALESCE((value #>> '{}')::boolean, false) INTO v_enforced
        FROM security.platform_params WHERE key = 'proposal_allowance_enforced';

        IF COALESCE(v_enforced, false) THEN
            RAISE EXCEPTION 'Weekly proposal allowance exhausted. It refreshes each week, and a few come back every few hours.'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_meter_application_allowance ON projects.project_applications;
CREATE TRIGGER trg_meter_application_allowance
    AFTER INSERT ON projects.project_applications
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_meter_application_allowance ();

-- Withdrawing a proposal returns the unit — selectivity should never be punished twice.
CREATE OR REPLACE FUNCTION projects.fn_refund_withdrawn_application()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = projects, finance, public
AS $$
DECLARE
    v_subject_type text;
    v_subject_id uuid;
BEGIN
    IF NEW.status = 'withdrawn'::projects.application_status
        AND OLD.status IS DISTINCT FROM 'withdrawn'::projects.application_status THEN

        IF NEW.applicant_type = 'team' THEN
            v_subject_type := 'team';
            v_subject_id := NEW.applicant_profile_id;
        ELSE
            v_subject_type := 'user';
            v_subject_id := NEW.applicant_user_id;
        END IF;

        PERFORM finance.fn_refund_allowance (
            v_subject_type, v_subject_id, 1, 'weekly_proposals', 'withdrawn',
            'projects.project_applications', NEW.id
        );
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_refund_withdrawn_application ON projects.project_applications;
CREATE TRIGGER trg_refund_withdrawn_application
    AFTER UPDATE OF status ON projects.project_applications
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_refund_withdrawn_application ();

-- Footprint: going PUBLIC + ACTIVE is what consumes a slot. Drafting stays unlimited and free.
CREATE OR REPLACE FUNCTION projects.fn_check_public_project_footprint()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = projects, finance, security, analytics, public
AS $$
DECLARE
    v_subject_type text;
    v_subject_id uuid;
    v_key finance.entitlement_key;
    v_limit integer;
    v_usage integer;
    v_enforced boolean;
BEGIN
    IF NEW.status <> 'active'::project_status OR NEW.visibility <> 'public'::visibility THEN
        RETURN NEW;
    END IF;

    -- Nested (not short-circuited) so OLD is never referenced on an INSERT.
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'active'::project_status AND OLD.visibility = 'public'::visibility THEN
            RETURN NEW;   -- already counted; not a new slot
        END IF;
    END IF;

    IF NEW.client_business_id IS NOT NULL THEN
        v_subject_type := 'business';
        v_subject_id := NEW.client_business_id;
        v_key := 'business_public_projects';
    ELSE
        v_subject_type := 'user';
        v_subject_id := NEW.owner_user_id;
        v_key := 'active_public_projects';
    END IF;

    v_limit := finance.fn_effective_limit (v_subject_type, v_subject_id, v_key);

    IF v_limit IS NOT NULL THEN
        v_usage := finance.fn_footprint_usage (v_subject_type, v_subject_id, v_key);

        IF v_usage >= v_limit THEN
            PERFORM analytics.fn_emit (
                'entitlement.denied',
                CASE WHEN v_subject_type = 'business' THEN 'business'::analytics.subject_kind ELSE 'user'::analytics.subject_kind END,
                v_subject_id,
                jsonb_build_object('key', v_key, 'effective_limit', v_limit, 'attempted', v_usage + 1),
                v_usage + 1, NEW.id, 'allowance'
            );

            SELECT COALESCE((value #>> '{}')::boolean, false) INTO v_enforced
            FROM security.platform_params WHERE key = 'footprint_caps_enforced';

            IF COALESCE(v_enforced, false) THEN
                RAISE EXCEPTION 'You have % live public projects, the maximum for your plan. Archive or complete one, or upgrade for more.', v_limit
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_public_project_footprint ON projects.projects;
CREATE TRIGGER trg_check_public_project_footprint
    BEFORE INSERT OR UPDATE OF status, visibility ON projects.projects
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_check_public_project_footprint ();
-- #endregion

-- #region 8. Tunable parameters
INSERT INTO security.platform_params (key, value, description) VALUES
    ('proposal_allowance_enforced', 'false'::jsonb,
        'When false the proposal allowance is METERED but never blocks (fail-open). Flip to true only after the caps have been tuned against analytics.events.'),
    ('footprint_caps_enforced', 'false'::jsonb,
        'When false active-public-project caps are METERED but never block (fail-open). Same tuning discipline as proposal_allowance_enforced.'),
    ('proposal_buffer_window_hours', '10'::jsonb,
        'Rolling window over which buffered proposals are replenished (the "3 per 10 hours" drip).'),
    ('proposal_buffer_hold_multiple', '4'::jsonb,
        'Buffer hold cap as a multiple of the per-window drip — how many proposals may be banked for a burst.'),
    ('subscription_grace_days', '7'::jsonb,
        'Days a past_due subscription retains its paid entitlements before falling back to the free plan.')
ON CONFLICT (key) DO NOTHING;
-- #endregion
