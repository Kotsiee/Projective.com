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

-- May the caller exercise a vault capability on behalf of an OWNER (rather than one wallet)? For the
-- owner-keyed settings a shared entity keeps once, not per wallet: its payout schedule (`withdraw` —
-- it decides when money leaves the vault) and its payment instruments (`manage_billing`). Seeing
-- them is ordinary membership (fn_owner_visible); changing them is not, or any member of a team could
-- re-route the team's payouts.
--
-- A personal owner is self-only, as everywhere in this schema. A shared owner qualifies when the
-- caller holds the capability on ANY of its wallets — capabilities are granted per wallet, and an
-- entity may hold one wallet per currency. FAILS CLOSED like fn_can_manage_basket: an entity with no
-- vault permissions has nobody who may change these settings.
CREATE OR REPLACE FUNCTION finance.fn_owner_capability(
    p_owner_type text,
    p_owner_id uuid,
    p_cap finance.vault_capability
)
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
                  AND finance.fn_has_vault_capability (w.id, auth.uid (), p_cap)
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

-- #region 8. Purchase owners — the checkout's identity read (2026-09-23)
-- A basket, a saved card and a checkout each spend ONE principal's money, and the checkout has to
-- say who that is: a name and a face, whether the caller may spend from it, its KYB state, its
-- invoicing terms, and the billing facts the Details form pre-fills. Those facts live on four tables
-- with four different read postures — and `org.business_profiles` carries no client SELECT policy at
-- all — so the web server either reads them with the service-role key or through one guarded door.
-- This is the door: SECURITY DEFINER, and it answers ONLY about the caller themselves and about the
-- entities the caller is an active member of. A non-member gets a team's or business's PUBLIC face
-- (the name and avatar the profile directory already shows) and nothing billable.
--
-- The object shape is the same for every kind so the application maps it once:
--   owner_type · owner_id · name · handle · avatar_bucket · avatar_path · is_member · can_spend ·
--   kyb_status · currency · invoicing_mode · billing_day · billing · person · departments
-- `billing` and `person` are NULL whenever the caller is not entitled to them.

-- One owner's projection, as the CALLER may see it.
CREATE OR REPLACE FUNCTION finance.fn_purchase_owner_json(p_owner_type text, p_owner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
DECLARE
    v_member boolean := finance.fn_owner_visible (p_owner_type, p_owner_id);
    v_spend boolean := finance.fn_can_manage_basket (p_owner_type, p_owner_id);
    v_out jsonb;
BEGIN
    IF p_owner_type IN ('user', 'freelancer') THEN
        -- A person answers only about themselves: fn_owner_visible is self-or-admin for this kind.
        IF NOT v_member THEN
            RETURN NULL;
        END IF;
        SELECT pg_catalog.jsonb_build_object(
            'owner_type', 'user',
            'owner_id', up.user_id,
            'name', COALESCE(
                NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', up.first_name, up.last_name)), ''),
                up.username
            ),
            'handle', up.username,
            'avatar_bucket', av.bucket_id,
            'avatar_path', av.storage_path,
            'is_member', true,
            'can_spend', v_spend,
            'kyb_status', NULL,
            'currency', pr.preferred_display_currency,
            'invoicing_mode', NULL,
            'billing_day', NULL,
            'billing', NULL,
            'person', pg_catalog.jsonb_build_object(
                'first_name', up.first_name,
                'last_name', up.last_name,
                'email', em.email,
                'city', up.city,
                'country', up.country
            ),
            'departments', '[]'::jsonb
        )
        INTO v_out
        FROM org.users_public up
        LEFT JOIN files.items av ON av.id = up.avatar_file_id
        LEFT JOIN org.user_preferences pr ON pr.user_id = up.user_id
        LEFT JOIN LATERAL (
            SELECT ue.email FROM org.user_emails ue
            WHERE ue.user_id = up.user_id
            ORDER BY ue.is_primary DESC, ue.verified_at DESC NULLS LAST, ue.created_at
            LIMIT 1
        ) em ON true
        WHERE up.user_id = p_owner_id;
        RETURN v_out;
    END IF;

    IF p_owner_type = 'team' THEN
        SELECT pg_catalog.jsonb_build_object(
            'owner_type', 'team',
            'owner_id', t.id,
            'name', t.name,
            'handle', t.slug,
            'avatar_bucket', av.bucket_id,
            'avatar_path', av.storage_path,
            'is_member', v_member,
            'can_spend', v_spend,
            -- KYB is a BUSINESS gate (finance-model.md §KYC/KYB Gating); a team is not subject to it.
            'kyb_status', NULL,
            'currency', NULL,
            'invoicing_mode', NULL,
            'billing_day', NULL,
            'billing', NULL,
            'person', NULL,
            'departments', '[]'::jsonb
        )
        INTO v_out
        FROM org.teams t
        LEFT JOIN files.items av ON av.id = t.avatar_file_id
        WHERE t.id = p_owner_id;
        RETURN v_out;
    END IF;

    IF p_owner_type = 'business' THEN
        SELECT pg_catalog.jsonb_build_object(
            'owner_type', 'business',
            'owner_id', b.id,
            'name', b.name,
            'handle', b.slug,
            'avatar_bucket', av.bucket_id,
            'avatar_path', av.storage_path,
            'is_member', v_member,
            'can_spend', v_spend,
            'kyb_status', CASE WHEN v_member THEN b.kyb_status::text END,
            'currency', CASE WHEN v_member THEN b.default_currency END,
            'invoicing_mode', CASE WHEN v_member THEN b.invoicing_mode END,
            'billing_day', CASE WHEN v_member THEN b.billing_day END,
            'billing', CASE WHEN v_member THEN pg_catalog.jsonb_build_object(
                'legal_name', COALESCE(b.legal_name, b.name),
                'registration_number', NULL,
                'tax_id', b.tax_id,
                'email', b.billing_email,
                'phone', NULL,
                'address_line_1', b.address_line_1,
                'address_city', b.address_city,
                'address_postcode', b.address_zip,
                'address_country', b.country
            ) END,
            'person', NULL,
            'departments', '[]'::jsonb
        )
        INTO v_out
        FROM org.business_profiles b
        LEFT JOIN files.items av ON av.id = b.logo_file_id
        WHERE b.id = p_owner_id;
        RETURN v_out;
    END IF;

    IF p_owner_type = 'organisation' THEN
        -- An organisation has no public directory entry, so a non-member learns nothing — not even
        -- that the id exists.
        IF NOT v_member THEN
            RETURN NULL;
        END IF;
        SELECT pg_catalog.jsonb_build_object(
            'owner_type', 'organisation',
            'owner_id', o.id,
            'name', COALESCE(o.trading_name, o.legal_name),
            'handle', o.handle,
            'avatar_bucket', av.bucket_id,
            'avatar_path', av.storage_path,
            'is_member', true,
            'can_spend', v_spend,
            'kyb_status', CASE o.verification_level
                WHEN 'verified' THEN 'verified'
                WHEN 'kyb_pending' THEN 'pending'
                ELSE 'unverified'
            END,
            'currency', o.default_currency,
            'invoicing_mode', NULL,
            'billing_day', NULL,
            'billing', pg_catalog.jsonb_build_object(
                'legal_name', o.legal_name,
                'registration_number', o.registration_number,
                'tax_id', NULL,
                'email', COALESCE(o.billing_email, o.corporate_email),
                'phone', o.corporate_phone,
                'address_line_1', o.address_line_1,
                'address_city', o.address_city,
                'address_postcode', o.address_postcode,
                'address_country', o.address_country
            ),
            'person', NULL,
            'departments', pg_catalog.to_jsonb(COALESCE(o.departments, '{}'::text[]))
        )
        INTO v_out
        FROM org.organisations o
        LEFT JOIN files.items av ON av.id = o.logo_file_id
        WHERE o.id = p_owner_id;
        RETURN v_out;
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION finance.fn_purchase_owner_json(text, uuid) IS
'The checkout identity of one purchase owner, as the CALLER may see it: a person answers only about
themselves; a team or business answers its public face to anyone and its KYB, invoicing and billing
facts to members only; an organisation answers members only. NULL when there is nothing the caller
may know. The shape is identical for every kind.';

-- The owner a basket or checkout is scoped to.
CREATE OR REPLACE FUNCTION finance.get_purchase_owner(p_owner_type text, p_owner_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
    SELECT CASE
        WHEN auth.uid () IS NULL THEN NULL
        ELSE finance.fn_purchase_owner_json (p_owner_type, p_owner_id)
    END;
$$;

COMMENT ON FUNCTION finance.get_purchase_owner(text, uuid) IS
'One purchase owner''s checkout identity for the signed-in caller (see fn_purchase_owner_json).
NULL for an anonymous caller.';

-- Every identity the caller may buy or bill as: themselves first, then each team, business and
-- organisation they own or are an ACTIVE member of. The Details step's billing-identity switcher and
-- the checkout's account list read this one answer.
CREATE OR REPLACE FUNCTION finance.list_purchase_owners()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
    WITH me AS (SELECT auth.uid () AS uid),
    entities AS (
        SELECT 'team'::text AS owner_type, t.id AS owner_id, t.name AS label
        FROM org.teams t, me
        WHERE t.owner_user_id = me.uid
           OR EXISTS (SELECT 1 FROM org.team_members tm
                      WHERE tm.team_id = t.id AND tm.user_id = me.uid AND tm.status = 'active')
        UNION
        SELECT 'business', b.id, b.name
        FROM org.business_profiles b, me
        WHERE b.owner_user_id = me.uid
           OR EXISTS (SELECT 1 FROM org.business_members bm
                      WHERE bm.business_id = b.id AND bm.user_id = me.uid AND bm.status = 'active')
        UNION
        SELECT 'organisation', o.id, COALESCE(o.trading_name, o.legal_name)
        FROM org.organisations o, me
        WHERE o.owner_user_id = me.uid
           OR EXISTS (SELECT 1 FROM org.organisation_members om
                      WHERE om.organisation_id = o.id AND om.user_id = me.uid AND om.status = 'active')
    )
    SELECT CASE
        WHEN (SELECT uid FROM me) IS NULL THEN '[]'::jsonb
        ELSE COALESCE(
            (SELECT pg_catalog.jsonb_agg(ranked.owner ORDER BY ranked.rank, ranked.label)
             FROM (
                 SELECT finance.fn_purchase_owner_json ('user', (SELECT uid FROM me)) AS owner,
                        0 AS rank, '' AS label
                 UNION ALL
                 SELECT finance.fn_purchase_owner_json (e.owner_type, e.owner_id), 1, e.label
                 FROM entities e
             ) ranked
             WHERE ranked.owner IS NOT NULL),
            '[]'::jsonb
        )
    END;
$$;

COMMENT ON FUNCTION finance.list_purchase_owners() IS
'The caller''s purchase identities: themselves, then every team, business and organisation they own
or are an active member of — each in the fn_purchase_owner_json shape. Empty for an anonymous caller.';
-- #endregion

-- #region 9. Promo codes — what one code is worth, for the buyer who typed it (2026-09-23)
-- `finance.promo_codes` is definer-only (RLS on, no policy, no client grant): the table is the
-- platform's whole marketing book, and a client that could SELECT it could list every code. A buyer
-- only ever needs to know about the ONE code they typed, so this is the door: it answers for exactly
-- that code and nothing else. It does not redeem — `redemption_count` is only ever moved by checkout.
--
-- Returns `{ found, code, label, kind, value_bp, value_minor, currency, valid, reason }`. `reason` is
-- the buyer-facing sentence for a refusal, decided here once so the basket and the checkout cannot
-- word the same refusal two ways.
CREATE OR REPLACE FUNCTION finance.resolve_promo_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = finance, public
AS $$
DECLARE
    v_code text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_code, '')));
    v_row finance.promo_codes;
    v_reason text;
BEGIN
    IF auth.uid () IS NULL OR v_code = '' THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_row FROM finance.promo_codes WHERE code = v_code;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'found', false, 'code', pg_catalog.left(v_code, 40), 'valid', false,
            'reason', 'We don''t recognise that code.'
        );
    END IF;

    v_reason := CASE
        WHEN v_row.deactivated_at IS NOT NULL THEN 'This code is no longer active.'
        WHEN v_row.starts_at IS NOT NULL AND v_row.starts_at > pg_catalog.now () THEN
            'This code isn''t active yet.'
        WHEN v_row.expires_at IS NOT NULL AND v_row.expires_at <= pg_catalog.now () THEN
            'This code expired on ' || pg_catalog.to_char(v_row.expires_at AT TIME ZONE 'UTC', 'FMDD FMMonth YYYY') || '.'
        WHEN v_row.max_redemptions IS NOT NULL AND v_row.redemption_count >= v_row.max_redemptions THEN
            'This code has been fully redeemed.'
        ELSE NULL
    END;

    RETURN pg_catalog.jsonb_build_object(
        'found', true,
        'code', v_row.code,
        'label', v_row.label,
        'kind', v_row.kind,
        'value_bp', v_row.value_bp,
        'value_minor', v_row.value_minor,
        'currency', v_row.currency,
        'valid', v_reason IS NULL,
        'reason', v_reason
    );
END;
$$;

COMMENT ON FUNCTION finance.resolve_promo_code(text) IS
'What ONE promotional code is worth, for the signed-in buyer who typed it: its label, kind and value,
and — when it cannot be used — the buyer-facing reason. Never lists codes and never redeems one.';
-- #endregion

-- #region 10. Invoicing terms — a business's monthly-statement setting (2026-09-23)
-- `org.business_profiles.invoicing_mode` / `billing_day` decide whether a verified business settles
-- each purchase as it happens or on one monthly statement. The checkout's Details step is where a
-- buyer meets that choice, but `business_profiles` carries no client write policy — so this is the one
-- door that changes it, and it asks the same question the platform asks of every other billing
-- setting: may the caller manage this account's billing (`manage_billing`)? Monthly settlement is
-- deferred payment, so it is offered only to a KYB-verified business, which is the same gate the
-- checkout's `invoice` provider applies.
CREATE OR REPLACE FUNCTION finance.set_invoicing_terms(
    p_owner_type text,
    p_owner_id uuid,
    p_mode text,
    p_billing_day integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
DECLARE
    v_kyb text;
BEGIN
    IF auth.uid () IS NULL THEN
        RAISE EXCEPTION 'Sign in to change invoicing' USING ERRCODE = '42501';
    END IF;
    IF p_owner_type IS DISTINCT FROM 'business' THEN
        RAISE EXCEPTION 'Monthly invoicing is only available to business accounts'
            USING ERRCODE = '22023';
    END IF;
    IF p_mode NOT IN ('per_transaction', 'intervaled_monthly') THEN
        RAISE EXCEPTION 'Unknown invoicing mode %', p_mode USING ERRCODE = '22023';
    END IF;
    IF p_billing_day IS NOT NULL AND (p_billing_day < 1 OR p_billing_day > 28) THEN
        RAISE EXCEPTION 'A statement day must be between 1 and 28' USING ERRCODE = '22023';
    END IF;
    IF NOT finance.fn_owner_capability ('business', p_owner_id, 'manage_billing'::finance.vault_capability) THEN
        RAISE EXCEPTION 'Only a member who manages this account''s billing can change its invoicing'
            USING ERRCODE = '42501';
    END IF;

    SELECT kyb_status::text INTO v_kyb FROM org.business_profiles WHERE id = p_owner_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Business not found' USING ERRCODE = 'P0002';
    END IF;
    IF p_mode = 'intervaled_monthly' AND v_kyb IS DISTINCT FROM 'verified' THEN
        RAISE EXCEPTION 'Complete business verification (KYB) to settle on a monthly statement'
            USING ERRCODE = '42501';
    END IF;

    UPDATE org.business_profiles
       SET invoicing_mode = p_mode,
           billing_day = COALESCE(p_billing_day, billing_day),
           updated_at = pg_catalog.now()
     WHERE id = p_owner_id;

    RETURN pg_catalog.jsonb_build_object(
        'invoicing_mode', p_mode,
        'billing_day', (SELECT billing_day FROM org.business_profiles WHERE id = p_owner_id)
    );
END;
$$;

COMMENT ON FUNCTION finance.set_invoicing_terms(text, uuid, text, integer) IS
'Set a business''s invoicing terms (per-transaction or a monthly statement on a day 1-28). Requires
manage_billing on the business; the monthly mode additionally requires KYB verification.';
-- #endregion

-- #region 11. Wallet orders — paying for a basket from the Projective wallet (2026-09-23)
-- The one checkout path that can settle without an external payment processor: the buyer's own
-- Projective wallet. Everything that moves money happens here, in ONE transaction, as the caller —
-- the lines are re-read, re-priced from the catalogue and re-totalled, the wallet is debited through
-- the ledger, each seller is credited, the order and its lines are written and the basket lines are
-- consumed. Nothing the client sends decides a price: the unit prices and the promo code the buyer
-- was shown are only ever COMPARED with what the catalogue says now, and any difference refuses.
--
-- Scope, stated rather than discovered:
--   * Digital products only. A service or session purchase needs escrow, and `finance.escrows`
--     requires a project stage and a business payer (root CLAUDE.md §8, #56(a)) — so those lines are
--     refused here rather than paid into nowhere.
--   * The charge is made in the lines' own currency, which must be one the paying wallet holds. The
--     display-currency figure the buyer saw is a conversion the application verifies separately; the
--     money that moves is integer minor units with no FX in it.
--   * The platform fee is the documented 5% (Decision #2, the rate the checkout displays), deducted
--     from each seller's credit. `security.platform_params.platform_fee_bp` is seeded 0 and governs
--     escrow releases; it is deliberately NOT read here — reconciling the two is flagged, not decided.
--     The fee is retained (debited from the buyer, not credited to a seller); the platform's own Fee
--     Collection wallet is not materialised yet (#54(i)).
--   * A sale credits the seller's AVAILABLE balance. `finance.pending_releases` is keyed to an escrow,
--     which a product sale does not have, so the 7-day pending window cannot hold it yet.
--   * A team-owned product credits the team's wallet; distributing it to members is the team's own
--     Distribute action.
CREATE OR REPLACE FUNCTION finance.place_wallet_order(
    p_basket_id uuid,
    p_item_ids uuid[],
    p_currency text,
    p_units jsonb,
    p_promo_code text,
    p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = finance, catalogue, org, security, public
AS $$
DECLARE
    c_fee_bp constant integer := 500;
    v_uid uuid := auth.uid();
    v_currency text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency, '')));
    v_wanted uuid[];
    v_basket finance.baskets;
    v_existing finance.orders;
    v_wallet finance.wallets;
    v_promo finance.promo_codes;
    v_order_id uuid := gen_random_uuid();
    v_reference text;
    v_subtotal bigint := 0;
    v_creator bigint := 0;
    v_promo_minor bigint := 0;
    v_net bigint;
    v_fee_total bigint := 0;
    v_remaining_promo bigint;
    v_eligible_base bigint;
    v_line record;
    v_lines jsonb := '[]'::jsonb;
    v_count integer;
    v_i integer := 0;
    v_share bigint;
    v_paid bigint;
    v_fee bigint;
    v_seller_type text;
    v_seller_id uuid;
    v_manifest jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to pay' USING ERRCODE = '42501';
    END IF;
    IF p_idempotency_key IS NULL OR pg_catalog.length(p_idempotency_key) < 8 OR pg_catalog.length(p_idempotency_key) > 120 THEN
        RAISE EXCEPTION 'A payment attempt needs a key between 8 and 120 characters' USING ERRCODE = '22023';
    END IF;

    -- A repeated attempt answers with the order it already placed rather than charging again.
    SELECT * INTO v_existing FROM finance.orders WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF NOT finance.fn_owner_visible (v_existing.owner_type, v_existing.owner_id) THEN
            RAISE EXCEPTION 'That payment key belongs to another account' USING ERRCODE = '42501';
        END IF;
        RETURN pg_catalog.jsonb_build_object(
            'order_id', v_existing.id, 'reference', v_existing.reference, 'status', v_existing.status,
            'charged_minor', v_existing.charged_minor, 'currency', v_existing.currency, 'replayed', true
        );
    END IF;

    SELECT * INTO v_basket FROM finance.baskets WHERE id = p_basket_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That basket no longer exists' USING ERRCODE = 'PB404';
    END IF;
    IF NOT finance.fn_can_manage_basket (v_basket.owner_type, v_basket.owner_id) THEN
        RAISE EXCEPTION 'Only a member who can spend from this account can pay from it'
            USING ERRCODE = '42501';
    END IF;
    IF v_basket.owner_type = 'business' AND NOT finance.fn_business_kyb_verified (v_basket.owner_id) THEN
        RAISE EXCEPTION 'Complete business verification (KYB) to pay from this account'
            USING ERRCODE = 'PK403';
    END IF;
    IF v_basket.owner_type = 'organisation' AND NOT EXISTS (
        SELECT 1 FROM org.organisations o
        WHERE o.id = v_basket.owner_id AND o.verification_level = 'verified'
    ) THEN
        RAISE EXCEPTION 'Complete business verification (KYB) to pay from this account'
            USING ERRCODE = 'PK403';
    END IF;

    -- The submitted lines, exactly: live, selected, not parked, in this basket. A basket changed in
    -- another tab cannot widen or narrow the charge.
    SELECT pg_catalog.array_agg(DISTINCT x) INTO v_wanted FROM pg_catalog.unnest(p_item_ids) AS x;
    IF v_wanted IS NULL OR pg_catalog.cardinality(v_wanted) = 0 THEN
        RAISE EXCEPTION 'Nothing is selected for checkout' USING ERRCODE = 'PC409';
    END IF;
    SELECT pg_catalog.count(*) INTO v_count
      FROM finance.basket_items bi
     WHERE bi.basket_id = v_basket.id
       AND bi.id = ANY (v_wanted)
       AND bi.removed_at IS NULL
       AND bi.purchased_at IS NULL
       AND bi.is_selected_for_checkout
       AND NOT bi.saved_for_later;
    IF v_count <> pg_catalog.cardinality(v_wanted) THEN
        RAISE EXCEPTION 'Your basket changed while you were paying — review it and try again'
            USING ERRCODE = 'PC409';
    END IF;

    -- Re-price every line from the catalogue as it stands now. The stored snapshot is never charged.
    FOR v_line IN
        SELECT bi.id, bi.item_type, bi.item_id, bi.quantity, bi.discount_amount_minor,
               bi.currency AS line_currency, bi.destination_email, bi.title, bi.position, bi.created_at,
               p.id AS product_id, p.title AS product_title, p.price_cents, p.currency AS product_currency,
               p.owner_user_id, p.owner_team_id, p.licence, p.format::text AS format, p.file_manifest
          FROM finance.basket_items bi
          LEFT JOIN catalogue.products p ON p.id = bi.item_id AND bi.item_type = 'digital_product'
         WHERE bi.basket_id = v_basket.id AND bi.id = ANY (v_wanted)
         ORDER BY bi.position, bi.created_at, bi.id
    LOOP
        IF v_line.item_type <> 'digital_product' THEN
            RAISE EXCEPTION 'Only digital products can be paid for from the wallet here'
                USING ERRCODE = 'PS501';
        END IF;
        IF v_line.product_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM catalogue.listings l
            WHERE l.product_id = v_line.product_id AND l.status = 'published'
        ) THEN
            RAISE EXCEPTION '% is no longer available', v_line.title USING ERRCODE = 'PC409';
        END IF;
        IF pg_catalog.upper(v_line.product_currency) <> v_currency THEN
            RAISE EXCEPTION 'This order is priced in %, not %', pg_catalog.upper(v_line.product_currency), v_currency
                USING ERRCODE = 'PC409';
        END IF;
        IF v_line.destination_email IS NULL THEN
            RAISE EXCEPTION 'Add the address % should be delivered to', v_line.title
                USING ERRCODE = 'PD422';
        END IF;
        IF v_line.owner_user_id = v_uid AND v_line.owner_team_id IS NULL THEN
            RAISE EXCEPTION 'You can''t buy your own listing' USING ERRCODE = 'PD422';
        END IF;
        -- The price the buyer was shown, per line, in the listing's own currency. A listing repriced
        -- between the page and the payment refuses rather than charging a figure nobody saw.
        IF p_units IS NULL OR (p_units ->> v_line.id::text) IS NULL
           OR (p_units ->> v_line.id::text)::bigint <> v_line.price_cents THEN
            RAISE EXCEPTION 'The price of % changed while you were paying — review the total and try again', v_line.title
                USING ERRCODE = 'PC409';
        END IF;

        v_subtotal := v_subtotal + v_line.price_cents * v_line.quantity;
        -- A creator discount is only ever written by a definer (the column is guarded), and it is in
        -- the line's own currency; one in another currency is not applied.
        v_creator := v_creator + CASE
            WHEN pg_catalog.upper(v_line.line_currency) = v_currency
                THEN LEAST(GREATEST(v_line.discount_amount_minor, 0), v_line.price_cents * v_line.quantity)
            ELSE 0
        END;
        v_lines := v_lines || pg_catalog.jsonb_build_object(
            'id', v_line.id,
            'item_id', v_line.item_id,
            'title', COALESCE(v_line.product_title, v_line.title),
            'quantity', v_line.quantity,
            'gross', v_line.price_cents * v_line.quantity,
            'creator', CASE
                WHEN pg_catalog.upper(v_line.line_currency) = v_currency
                    THEN LEAST(GREATEST(v_line.discount_amount_minor, 0), v_line.price_cents * v_line.quantity)
                ELSE 0
            END,
            'owner_user_id', v_line.owner_user_id,
            'owner_team_id', v_line.owner_team_id,
            'licence', v_line.licence,
            'format', v_line.format,
            'manifest', v_line.file_manifest
        );
    END LOOP;

    -- The basket-wide promo the buyer saw APPLIED, re-validated now. None was applied → none is: a code
    -- the page refused applies nothing here either, so a stale code on the basket never blocks a
    -- payment. One was → it must still be the basket's, still valid and still applicable to these
    -- lines, or the payment refuses rather than charging more than the buyer was shown.
    IF NULLIF(pg_catalog.btrim(COALESCE(p_promo_code, '')), '') IS NOT NULL THEN
        IF pg_catalog.upper(pg_catalog.btrim(p_promo_code))
           IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(COALESCE(v_basket.promo_code, ''))) THEN
            RAISE EXCEPTION 'Your promo code changed while you were paying — review the total and try again'
                USING ERRCODE = 'PC409';
        END IF;
        SELECT * INTO v_promo FROM finance.promo_codes
         WHERE code = pg_catalog.upper(pg_catalog.btrim(p_promo_code));
        IF NOT FOUND
           OR v_promo.deactivated_at IS NOT NULL
           OR (v_promo.starts_at IS NOT NULL AND v_promo.starts_at > pg_catalog.now())
           OR (v_promo.expires_at IS NOT NULL AND v_promo.expires_at <= pg_catalog.now())
           OR (v_promo.max_redemptions IS NOT NULL AND v_promo.redemption_count >= v_promo.max_redemptions)
        THEN
            RAISE EXCEPTION 'Your promo code is no longer valid — review the total and try again'
                USING ERRCODE = 'PC409';
        END IF;
        IF v_promo.kind = 'percent' THEN
            v_promo_minor := ((v_subtotal - v_creator) * v_promo.value_bp + 5000) / 10000;
        ELSIF v_promo.kind = 'flat' AND pg_catalog.upper(v_promo.currency) = v_currency THEN
            v_promo_minor := v_promo.value_minor;
        ELSE
            -- A flat saving is money in one currency; applied to another it would be a conversion the
            -- buyer never saw quoted.
            RAISE EXCEPTION 'That code can''t be applied to items priced in %', v_currency
                USING ERRCODE = 'PC409';
        END IF;
        v_promo_minor := LEAST(GREATEST(v_promo_minor, 0), v_subtotal - v_creator);
    END IF;

    v_net := v_subtotal - v_creator - v_promo_minor;

    -- The paying wallet: the account's wallet in the charge currency. A personal account's wallet may
    -- carry either personal type.
    SELECT w.* INTO v_wallet
      FROM finance.wallets w
     WHERE w.owner_id = v_basket.owner_id
       AND w.currency = v_currency
       AND (w.owner_type = v_basket.owner_type
            OR (v_basket.owner_type IN ('user', 'freelancer') AND w.owner_type IN ('user', 'freelancer')))
     ORDER BY (w.owner_type = v_basket.owner_type) DESC
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Your wallet holds no %', v_currency USING ERRCODE = 'PF402';
    END IF;
    IF v_wallet.balance_cents < v_net THEN
        RAISE EXCEPTION 'Your wallet balance doesn''t cover this order' USING ERRCODE = 'PF402';
    END IF;
    IF v_basket.owner_type IN ('business', 'team', 'organisation') THEN
        IF COALESCE(v_wallet.approval_threshold_cents, 0) > 0 AND v_net >= v_wallet.approval_threshold_cents THEN
            RAISE EXCEPTION 'This purchase needs approval before it can be paid for'
                USING ERRCODE = 'PA403';
        END IF;
        IF NOT finance.fn_check_spending_limit (v_wallet.id, v_uid, v_net) THEN
            RAISE EXCEPTION 'This purchase is over your spending limit for this account'
                USING ERRCODE = 'PA403';
        END IF;
    END IF;

    v_reference := 'PJ-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY') || '-' ||
        pg_catalog.upper(pg_catalog.substr(pg_catalog.md5(v_order_id::text), 1, 6));

    INSERT INTO finance.orders (
        id, reference, status, placed_at, owner_type, owner_id, basket_id, currency, subtotal_minor,
        creator_discount_minor, promo_discount_minor, platform_fee_minor, platform_fee_bp,
        platform_fee_mode, tax_minor, processing_contribution_minor, total_minor, charged_minor,
        payment_provider, payment_method_label, idempotency_key
    ) VALUES (
        v_order_id, v_reference, 'confirmed', pg_catalog.now(), v_basket.owner_type, v_basket.owner_id,
        v_basket.id, v_currency, v_subtotal, v_creator, v_promo_minor, 0, c_fee_bp, 'seller_deducted', 0,
        0, v_net, v_net, 'wallet', 'Projective wallet', p_idempotency_key
    );

    PERFORM finance.fn_wallet_debit (v_wallet.owner_id, v_wallet.owner_type, v_currency, v_net,
        'order_payment', 'orders', v_order_id);

    -- Each line: its share of the promo (pro rata by what the line costs after creator discounts, the
    -- remainder on the last line so the shares sum exactly), the fee on what was actually paid for it,
    -- and the seller's credit for the rest.
    v_remaining_promo := v_promo_minor;
    v_eligible_base := v_subtotal - v_creator;
    FOR v_line IN SELECT value AS l, ordinality AS n FROM pg_catalog.jsonb_array_elements(v_lines) WITH ORDINALITY
    LOOP
        v_i := v_line.n;
        IF v_i = pg_catalog.jsonb_array_length(v_lines) OR v_eligible_base = 0 THEN
            v_share := v_remaining_promo;
        ELSE
            v_share := (v_promo_minor * ((v_line.l ->> 'gross')::bigint - (v_line.l ->> 'creator')::bigint)) / v_eligible_base;
        END IF;
        v_remaining_promo := v_remaining_promo - v_share;
        v_paid := (v_line.l ->> 'gross')::bigint - (v_line.l ->> 'creator')::bigint - v_share;
        v_fee := (GREATEST(v_paid, 0) * c_fee_bp + 5000) / 10000;
        v_fee_total := v_fee_total + v_fee;

        IF v_line.l ->> 'owner_team_id' IS NOT NULL THEN
            v_seller_type := 'team';
            v_seller_id := (v_line.l ->> 'owner_team_id')::uuid;
        ELSE
            v_seller_id := (v_line.l ->> 'owner_user_id')::uuid;
            SELECT w.owner_type INTO v_seller_type FROM finance.wallets w
             WHERE w.owner_id = v_seller_id AND w.currency = v_currency AND w.owner_type IN ('freelancer', 'user')
             ORDER BY (w.owner_type = 'freelancer') DESC LIMIT 1;
            v_seller_type := COALESCE(v_seller_type, 'freelancer');
        END IF;
        -- A seller with no wallet in this currency gets one: `fn_wallet_credit` is a silent no-op on a
        -- missing wallet, and a sale must never vanish.
        INSERT INTO finance.wallets (owner_type, owner_id, currency)
        VALUES (v_seller_type, v_seller_id, v_currency)
        ON CONFLICT (owner_type, owner_id, currency) DO NOTHING;
        PERFORM finance.fn_wallet_credit (v_seller_id, v_seller_type, v_currency, v_paid - v_fee,
            'product_sale', 'orders', v_order_id);

        v_manifest := v_line.l -> 'manifest' -> 0;
        INSERT INTO finance.order_lines (
            order_id, basket_item_id, item_type, item_id, title, subtitle, quantity, line_total_minor,
            currency, fulfilment, download_name, download_bytes, download_format, licence, position
        ) VALUES (
            v_order_id, (v_line.l ->> 'id')::uuid, 'digital_product', (v_line.l ->> 'item_id')::uuid,
            v_line.l ->> 'title', 'Instant download', (v_line.l ->> 'quantity')::integer,
            (v_line.l ->> 'gross')::bigint - (v_line.l ->> 'creator')::bigint, v_currency, 'download',
            v_manifest ->> 'name',
            CASE WHEN pg_catalog.jsonb_typeof(v_manifest -> 'bytes') = 'number' THEN (v_manifest ->> 'bytes')::bigint END,
            v_line.l ->> 'format', v_line.l ->> 'licence', v_i - 1
        );

        UPDATE finance.basket_items
           SET purchased_at = pg_catalog.now(), updated_at = pg_catalog.now()
         WHERE id = (v_line.l ->> 'id')::uuid;
    END LOOP;

    UPDATE finance.orders SET platform_fee_minor = v_fee_total WHERE id = v_order_id;
    UPDATE finance.baskets SET updated_at = pg_catalog.now(), promo_code = NULL WHERE id = v_basket.id;
    IF v_promo.id IS NOT NULL AND v_promo_minor > 0 THEN
        UPDATE finance.promo_codes SET redemption_count = redemption_count + 1 WHERE id = v_promo.id;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'order_id', v_order_id, 'reference', v_reference, 'status', 'confirmed',
        'charged_minor', v_net, 'currency', v_currency, 'replayed', false
    );
END;
$$;

COMMENT ON FUNCTION finance.place_wallet_order(uuid, uuid[], text, jsonb, text, text) IS
'Pay for the submitted basket lines from the caller''s Projective wallet, atomically: re-price every
line from the catalogue against the unit price the buyer was shown, re-validate the promo code they saw,
debit the wallet, credit each seller
net of the 5% platform fee, write the order and its lines, consume the basket lines. Digital products
only (services and sessions need escrow, which requires a project stage). Idempotent on the key.
Refusal SQLSTATEs: 42501 not allowed · PK403 verification · PC409 basket/price changed · PD422 a line
needs attention · PS501 not payable here · PF402 wallet · PA403 spend limit/approval.';
-- #endregion
