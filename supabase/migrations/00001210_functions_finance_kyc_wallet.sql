-- ============================================================================
-- 00001210 functions finance kyc wallet
-- Consolidated verbatim from: 20260723091000_finance_verification_kyc.sql, 20260723092000_finance_payment_methods_money_movement.sql, 20260723093000_finance_vault_governance.sql
-- ============================================================================

-- Stripe Connect account id (placeholder; no PII)
-- #endregion

-- #region 5. Gating predicates (the checks the hire/join/fund functions MUST enforce)
-- These are the in-DB gates. They are provided as pure, reusable predicates; wiring them INTO the
-- existing money-movement functions (projects.claim_ticket / finance.fn_hold_ticket_escrow /
-- projects.fund_stage and the hire/join RPCs) is a behavioural change to escrow/stage flow and is
-- FLAGGED for human sign-off (root CLAUDE.md §8) rather than applied here.

-- A freelancer may earn (land a gig / join a team) only when KYC-verified AND payout-ready.
CREATE OR REPLACE FUNCTION finance.fn_freelancer_payout_ready(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, public
AS $$
    SELECT COALESCE((
        SELECT fp.kyc_status = 'verified'::finance.kyc_status AND fp.payout_ready
        FROM org.freelancer_profiles fp
        WHERE fp.user_id = p_user
    ), false);
$$;

-- A pooled Business Wallet may be operated (funds spent/held) only once the business is KYB-verified.
CREATE OR REPLACE FUNCTION finance.fn_business_kyb_verified(p_business uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, public
AS $$
    SELECT COALESCE((
        SELECT bp.kyb_status = 'verified'::finance.kyc_status
        FROM org.business_profiles bp
        WHERE bp.id = p_business
    ), false);
$$;

-- =============================================================================================
-- 20260723092000_finance_payment_methods_money_movement.sql
-- Wallet & Finance foundation (3/5) — Payment methods (spend vs earn) + money-movement rules.
--
-- ADDITIVE ONLY. New enums, new finance tables, new SECURITY DEFINER wallet-visibility helpers, new
-- platform params. No existing object is altered. Authored, NOT applied to any live database.
--
-- Card data is Stripe-owned and NEVER stored here — only an opaque provider reference + safe display
-- fragments (brand, last4). See finance-model.md §Payment Methods and §Money-Movement Rules.
-- =============================================================================================

-- #region 1. Wallet-visibility helpers (reused by every wallet-scoped RLS policy in 3/4/5)
-- finance.wallets has no RLS policy (definer-only), so a SECURITY DEFINER helper can read it without
-- recursion and resolve "can this caller see/manage this owner's money" once, consistently.

-- Can the current user SEE this owner's finances? (owner scope → membership.)
CREATE OR REPLACE FUNCTION finance.fn_owner_visible(p_owner_type text, p_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
    SELECT
        security.is_admin ()
        OR (p_owner_type IN ('user', 'freelancer') AND p_owner_id = auth.uid ())
        OR (p_owner_type = 'business' AND org.is_active_business_member (p_owner_id))
        OR (p_owner_type = 'team' AND org.is_active_team_member (p_owner_id))
        OR (p_owner_type = 'organisation' AND org.is_organisation_member (p_owner_id));
$$;

-- Same question for a wallet id (resolves the wallet's owner, then defers to fn_owner_visible).
CREATE OR REPLACE FUNCTION finance.fn_can_view_wallet(p_wallet uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM finance.wallets w
        WHERE w.id = p_wallet
          AND finance.fn_owner_visible (w.owner_type, w.owner_id)
    );
$$;

-- In-DB capability check. SECURITY DEFINER so future money-movement RPCs can gate on it without RLS
-- recursion. An owner-level member (manage_members) implicitly has every capability.
CREATE OR REPLACE FUNCTION finance.fn_has_vault_capability(
    p_wallet uuid, p_user uuid, p_cap finance.vault_capability
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
    SELECT
        security.is_admin ()
        OR EXISTS (
            SELECT 1 FROM finance.vault_permissions vp
            WHERE vp.wallet_id = p_wallet
              AND vp.member_user_id = p_user
              AND (p_cap = ANY (vp.capabilities) OR 'manage_members'::finance.vault_capability = ANY (vp.capabilities))
        );
$$;

-- #endregion

-- #region 6. Basket & simulation gates (Basket, Wishlist & Saved Cards)
-- Both predicates COMPOSE the §1/§5 helpers above rather than restating membership logic — there is
-- exactly one answer in this schema to "may this caller reach that owner's money", and these narrow
-- it, never re-derive it.

-- May the caller WRITE this owner's basket? Reading a shared basket is ordinary membership
-- (fn_owner_visible); writing one is not, because every line in it is a spend the entity will be
-- asked to authorise. A shared basket therefore requires the `spend` vault capability on one of the
-- owner's wallets — the same grant that would let the member actually pay for the line.
--
-- ⚠️ FAILS CLOSED by design: an entity with no wallet yet, or with no vault_permissions rows,
-- has nobody who may write its basket. That is the correct posture for a spend surface (a silent
-- fallback to "any member" would make the capability decorative), but it means vault provisioning
-- must precede shared-basket use.
CREATE OR REPLACE FUNCTION finance.fn_can_manage_basket(p_owner_type text, p_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
    SELECT
        security.is_admin ()
        OR (p_owner_type IN ('user', 'freelancer') AND p_owner_id = auth.uid ())
        OR (
            p_owner_type IN ('business', 'team', 'organisation')
            AND finance.fn_owner_visible (p_owner_type, p_owner_id)
            AND EXISTS (
                SELECT 1 FROM finance.wallets w
                WHERE w.owner_type = p_owner_type
                  AND w.owner_id = p_owner_id
                  AND finance.fn_has_vault_capability (w.id, auth.uid (), 'spend'::finance.vault_capability)
            )
        );
$$;

-- May the caller move funds OUT OF (or INTO) this specific wallet? Strictly narrower than
-- fn_can_view_wallet: seeing a business's balance is ordinary membership, moving it is not.
-- A personal wallet is self-only; a shared wallet defers to the `spend` capability grant.
CREATE OR REPLACE FUNCTION finance.fn_can_move_wallet_funds(p_wallet uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM finance.wallets w
        WHERE w.id = p_wallet
          AND (
              (w.owner_type IN ('user', 'freelancer') AND w.owner_id = auth.uid ())
              OR (
                  w.owner_type IN ('business', 'team', 'organisation')
                  AND finance.fn_has_vault_capability (w.id, auth.uid (), 'spend'::finance.vault_capability)
              )
          )
    );
$$;

-- #endregion

-- #region 7. finance.simulate_wallet_transaction — the PARAM-GATED developer money simulator
--
-- ⚠️⚠️ THIS FUNCTION MOVES REAL MONEY. It is a debugging aid whose whole purpose is to exercise the
-- ledger, so it writes genuine finance.wallets balance changes and genuine finance.transactions
-- lines — there is no shadow ledger. Four independent gates stand in front of it, and every one of
-- them must hold:
--
--   1. `security.platform_params.finance_simulation_enabled` must be true. SEEDED FALSE, and
--      flipping it is a deliberate human decision requiring sign-off — never a side effect of
--      running a migration. This is the same discipline as `storage_quota_enforced` /
--      `proposal_allowance_enforced` (root CLAUDE.md §8, Decision #58), inverted: those fail OPEN
--      while off, this one fails CLOSED while off.
--   2. `auth.uid()` must be present. A service-role or cron context has no owner to check against,
--      so it is refused outright rather than trusted.
--   3. The caller must hold `finance.fn_can_move_wallet_funds` on EVERY wallet touched — both the
--      source AND the destination. The brief asked only for source ownership; requiring it on the
--      destination too is a deliberate widening, because a credit-only type (top_up,
--      escrow_release, refund) with no destination check would let any signed-in caller MINT
--      balance into a stranger's wallet.
--   4. EXECUTE is granted to `authenticated` only — never `anon`, and deliberately not
--      `service_role` (see 00002510).
--
-- Simulated lines are DISTINGUISHABLE FROM REAL ONES: `reason` is always `simulated_<type>` and
-- `ref_table` is always 'simulation', so a simulated movement can be found, audited and reversed
-- without forensics. Every touched wallet also gets a finance.ledger_audit row.
--
-- It never converts currency: both wallets must already be in `p_currency`. A simulator that
-- silently applied an FX rate would make the numbers it exists to explain unexplainable.
CREATE OR REPLACE FUNCTION finance.simulate_wallet_transaction(
    p_from_wallet_id uuid,
    p_to_wallet_id uuid,
    p_amount_minor bigint,
    p_currency text,
    p_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_enabled boolean;
    v_caller uuid;
    v_needs_source boolean;
    v_needs_dest boolean;
    v_action finance.vault_action;
    v_reason text;
    v_from record;
    v_to record;
    v_from_after bigint;
    v_to_after bigint;
    v_from_tx uuid;
    v_to_tx uuid;
    v_from_json jsonb := NULL;
    v_to_json jsonb := NULL;
BEGIN
    -- Gate 1: the kill switch.
    SELECT (p.value #>> '{}')::boolean INTO v_enabled
    FROM security.platform_params p
    WHERE p.key = 'finance_simulation_enabled';

    -- FAIL CLOSED: an absent param, a malformed param and an explicit false all mean "refuse".
    IF COALESCE(v_enabled, false) IS NOT TRUE THEN
        RAISE EXCEPTION
            'Wallet simulation is disabled (security.platform_params.finance_simulation_enabled).'
            USING ERRCODE = '42501';
    END IF;

    -- Gate 2: an authenticated caller with an owner identity to check.
    v_caller := auth.uid();
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Wallet simulation requires an authenticated caller.'
            USING ERRCODE = '42501';
    END IF;

    IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
        RAISE EXCEPTION 'Simulated amount must be a positive minor-unit value.'
            USING ERRCODE = '22023';
    END IF;

    IF p_currency IS NULL OR pg_catalog.length(p_currency) <> 3 THEN
        RAISE EXCEPTION 'Simulated currency must be a 3-letter ISO-4217 code.'
            USING ERRCODE = '22023';
    END IF;

    -- The direction matrix. Which side of a movement a type touches is not a caller decision.
    CASE p_type
        WHEN 'escrow_lock' THEN
            v_needs_source := true;  v_needs_dest := false; v_action := 'spend';
        WHEN 'escrow_release' THEN
            v_needs_source := false; v_needs_dest := true;  v_action := 'add_funds';
        WHEN 'platform_fee' THEN
            v_needs_source := true;  v_needs_dest := false; v_action := 'spend';
        WHEN 'split_payout' THEN
            v_needs_source := true;  v_needs_dest := true;  v_action := 'distribute';
        WHEN 'top_up' THEN
            v_needs_source := false; v_needs_dest := true;  v_action := 'add_funds';
        WHEN 'refund' THEN
            v_needs_source := false; v_needs_dest := true;  v_action := 'add_funds';
        ELSE
            RAISE EXCEPTION
                'Unknown simulation type %. Expected escrow_lock, escrow_release, platform_fee, split_payout, top_up or refund.',
                p_type USING ERRCODE = '22023';
    END CASE;

    IF v_needs_source AND p_from_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Simulation type % requires a source wallet.', p_type USING ERRCODE = '22023';
    END IF;

    IF v_needs_dest AND p_to_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Simulation type % requires a destination wallet.', p_type USING ERRCODE = '22023';
    END IF;

    IF p_from_wallet_id IS NULL AND p_to_wallet_id IS NULL THEN
        RAISE EXCEPTION 'A simulation must touch at least one wallet.' USING ERRCODE = '22023';
    END IF;

    IF p_from_wallet_id IS NOT NULL AND p_from_wallet_id = p_to_wallet_id THEN
        RAISE EXCEPTION 'Source and destination wallet must differ.' USING ERRCODE = '22023';
    END IF;

    -- Lock both rows in a deterministic order so two concurrent simulations cannot deadlock.
    PERFORM 1 FROM finance.wallets w
    WHERE w.id IN (p_from_wallet_id, p_to_wallet_id)
    ORDER BY w.id
    FOR UPDATE;

    -- Gate 3a: the source wallet — exists, matches currency, is the caller's to spend, and holds
    -- enough. The balance is checked explicitly so the caller gets a legible refusal rather than an
    -- opaque `balance_cents >= 0` check violation.
    IF p_from_wallet_id IS NOT NULL THEN
        SELECT w.id, w.owner_type, w.owner_id, w.currency, w.balance_cents
        INTO v_from
        FROM finance.wallets w
        WHERE w.id = p_from_wallet_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Source wallet % not found.', p_from_wallet_id USING ERRCODE = '23503';
        END IF;

        IF v_from.currency <> p_currency THEN
            RAISE EXCEPTION
                'Source wallet is in % but the simulation is in %. The simulator never converts.',
                v_from.currency, p_currency USING ERRCODE = '22023';
        END IF;

        IF NOT finance.fn_can_move_wallet_funds(v_from.id) THEN
            RAISE EXCEPTION 'Not authorised to move funds out of this wallet.' USING ERRCODE = '42501';
        END IF;

        IF v_from.balance_cents < p_amount_minor THEN
            RAISE EXCEPTION
                'Insufficient balance: % available, % requested.',
                v_from.balance_cents, p_amount_minor USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Gate 3b: the destination wallet. Checked with the same predicate, so a credit-only type can
    -- never mint balance into a wallet the caller does not control.
    IF p_to_wallet_id IS NOT NULL THEN
        SELECT w.id, w.owner_type, w.owner_id, w.currency, w.balance_cents
        INTO v_to
        FROM finance.wallets w
        WHERE w.id = p_to_wallet_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Destination wallet % not found.', p_to_wallet_id USING ERRCODE = '23503';
        END IF;

        IF v_to.currency <> p_currency THEN
            RAISE EXCEPTION
                'Destination wallet is in % but the simulation is in %. The simulator never converts.',
                v_to.currency, p_currency USING ERRCODE = '22023';
        END IF;

        IF NOT finance.fn_can_move_wallet_funds(v_to.id) THEN
            RAISE EXCEPTION 'Not authorised to move funds into this wallet.' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_reason := 'simulated_' || p_type;

    IF p_from_wallet_id IS NOT NULL THEN
        UPDATE finance.wallets
        SET balance_cents = balance_cents - p_amount_minor
        WHERE id = v_from.id
        RETURNING balance_cents INTO v_from_after;

        INSERT INTO finance.transactions (
            wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id, balance_after_cents
        )
        VALUES (
            v_from.id, 'debit', p_amount_minor, p_currency, v_reason, 'simulation', NULL, v_from_after
        )
        RETURNING id INTO v_from_tx;

        INSERT INTO finance.ledger_audit (
            wallet_id, actor_user_id, action, amount_cents, currency, ref_table, ref_id, metadata
        )
        VALUES (
            v_from.id, v_caller, v_action, -p_amount_minor, p_currency::char(3), 'simulation', v_from_tx,
            pg_catalog.jsonb_build_object('simulated', true, 'type', p_type, 'side', 'debit')
        );

        v_from_json := pg_catalog.jsonb_build_object(
            'wallet_id', v_from.id,
            'owner_type', v_from.owner_type,
            'owner_id', v_from.owner_id,
            'currency', v_from.currency,
            'balance_before_cents', v_from.balance_cents,
            'balance_after_cents', v_from_after,
            'transaction_id', v_from_tx
        );
    END IF;

    IF p_to_wallet_id IS NOT NULL THEN
        UPDATE finance.wallets
        SET balance_cents = balance_cents + p_amount_minor
        WHERE id = v_to.id
        RETURNING balance_cents INTO v_to_after;

        INSERT INTO finance.transactions (
            wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id, balance_after_cents
        )
        VALUES (
            v_to.id, 'credit', p_amount_minor, p_currency, v_reason, 'simulation', NULL, v_to_after
        )
        RETURNING id INTO v_to_tx;

        INSERT INTO finance.ledger_audit (
            wallet_id, actor_user_id, action, amount_cents, currency, ref_table, ref_id, metadata
        )
        VALUES (
            v_to.id, v_caller, v_action, p_amount_minor, p_currency::char(3), 'simulation', v_to_tx,
            pg_catalog.jsonb_build_object('simulated', true, 'type', p_type, 'side', 'credit')
        );

        v_to_json := pg_catalog.jsonb_build_object(
            'wallet_id', v_to.id,
            'owner_type', v_to.owner_type,
            'owner_id', v_to.owner_id,
            'currency', v_to.currency,
            'balance_before_cents', v_to.balance_cents,
            'balance_after_cents', v_to_after,
            'transaction_id', v_to_tx
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'simulated', true,
        'type', p_type,
        'amount_minor', p_amount_minor,
        'currency', p_currency,
        'executed_at', pg_catalog.now(),
        'from', v_from_json,
        'to', v_to_json
    );
END;
$$;

COMMENT ON FUNCTION finance.simulate_wallet_transaction(uuid, uuid, bigint, text, text) IS
'DEVELOPER SIMULATOR — moves REAL money. Refuses unless security.platform_params
finance_simulation_enabled is true (seeded false; flipping it needs human sign-off), refuses an
unauthenticated caller, and requires finance.fn_can_move_wallet_funds on every wallet touched.
Writes genuine finance.transactions lines tagged reason = simulated_<type>, ref_table = simulation.
Never converts currency. EXECUTE is granted to authenticated only.';
-- #endregion
