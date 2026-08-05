-- ============================================================================
-- 00001220 functions finance billing entitlements
-- Consolidated verbatim from: 20260724112000_billing_plans_entitlements.sql, 20260724113000_entitlements_allowances_enforcement.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION finance.fn_sync_legacy_subscription_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = finance, public
AS $$
BEGIN
    IF NEW.plan_id IS NOT NULL THEN
        SELECT p.code INTO NEW.plan FROM finance.plans p WHERE p.id = NEW.plan_id;
    END IF;
    -- The legacy `profile_id` is NOT NULL with no default; NOT NULL is checked AFTER this BEFORE
    -- trigger, so mirroring the subject here keeps new subject-scoped rows insertable unchanged.
    NEW.profile_id := COALESCE(NEW.profile_id, NEW.subject_id);
    NEW.status := NEW.state::text;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

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

    ELSIF p_key = 'storage_megabytes' THEN
        -- Stored bytes, read from the materialised rollup rather than summed from files.items: this
        -- function is called on the upload path and a live sum over a growing library is exactly the
        -- cost that only appears once a tenant succeeds. files.fn_recompute_usage keeps it true.
        --
        -- UNITS: the rollup is BYTES (bigint, the honest unit for a byte total) and this function
        -- returns `integer` MEBIBYTES, because that is the unit the whole entitlement ladder is
        -- denominated in — 25 GB expressed in bytes is 26,843,545,600 and overflows int4. Integer
        -- division floors, so a subject is never reported as having consumed a MiB they have not.
        SELECT COALESCE((u.bytes_used / 1048576)::integer, 0) INTO v_count
        FROM files.storage_usage u
        WHERE u.owner_type = (
                CASE p_subject_type
                    WHEN 'freelancer' THEN 'user'
                    ELSE p_subject_type
                END
            )::files.owner_kind
          AND u.owner_id = p_subject_id;

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
