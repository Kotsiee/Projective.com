-- ============================================================================
-- 00001210 functions finance kyc wallet
-- Consolidated verbatim from: 20260723091000_finance_verification_kyc.sql, 20260723092000_finance_payment_methods_money_movement.sql, 20260723093000_finance_vault_governance.sql
-- ============================================================================

-- Stripe Connect account id (placeholder; no PII)
-- #endregion

-- #region 5. Gating predicates (the checks the hire/join/fund functions MUST enforce)
-- The earning gate is wired (Decision #196): every door that lands a gig or seats a team member calls
-- finance.fn_assert_payout_ready — apply_to_seat · apply_to_project · redeem_invite_link ·
-- assign_from_application · fn_apply_invitation_decision · fn_assign_ticket_core (claim, manual pin,
-- round-robin, parallel stream) · org.create_workspace (team) · org.respond_to_workspace_invitation
-- (team) · org.transfer_workspace_ownership (team successor). Withdrawing earnings from a `user` or `team` wallet needs it too (finance.begin_payout).

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

-- The people a team's release would pay a share to (finance.fn_team_split_plan): every active member
-- holding a contribution stake, plus the finder under a finders_fee rule. A benevolent_dictator team
-- pays only its vault, so it has none.
CREATE OR REPLACE FUNCTION finance.fn_team_shareholders(p_team uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT ca.member_user_id
      FROM finance.contribution_agreements ca
      JOIN org.team_members tm
        ON tm.team_id = ca.team_id AND tm.user_id = ca.member_user_id AND tm.status = 'active'
     WHERE ca.team_id = p_team AND ca.percent_bp > 0
       AND NOT EXISTS (
           SELECT 1 FROM finance.split_rules r
            WHERE r.team_id = p_team AND r.active AND r.rule_type = 'benevolent_dictator'
       )
    UNION
    SELECT r.finder_user_id
      FROM finance.split_rules r
     WHERE r.team_id = p_team AND r.active AND r.rule_type = 'finders_fee'
       AND r.finder_user_id IS NOT NULL AND COALESCE(r.finder_bp, 0) > 0;
$$;

-- The earning gate (Decision #196). A `freelancer` payee must hold both halves of
-- fn_freelancer_payout_ready; a `team` payee needs every shareholder to. Refuses with PK403 and a
-- `payout_not_ready:` message; HINT says who has to act — `self` (the caller, so the app offers
-- Settings → Verification), `other` (a named freelancer) or `team` (other shareholders). DETAIL lists
-- the unready shareholders' handles to a member who can commit the team to work, and is empty for
-- anyone else.
CREATE OR REPLACE FUNCTION finance.fn_assert_payout_ready(p_payee_type text, p_payee_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_unready uuid[];
    v_handles text;
BEGIN
    IF p_payee_type = 'team' THEN
        SELECT COALESCE(array_agg(s.uid), '{}') INTO v_unready
          FROM finance.fn_team_shareholders(p_payee_id) AS s(uid)
         WHERE NOT finance.fn_freelancer_payout_ready(s.uid);
        IF cardinality(v_unready) = 0 THEN
            RETURN;
        END IF;
        IF v_uid = ANY (v_unready) THEN
            RAISE EXCEPTION USING ERRCODE = 'PK403', HINT = 'self',
                MESSAGE = 'payout_not_ready: verify your identity and add a payout account — your team can take on paid work once everyone with a share has';
        END IF;
        IF org.is_team_lead(p_payee_id) THEN
            SELECT string_agg('@' || u.username, ', ' ORDER BY u.username) INTO v_handles
              FROM org.users_public u WHERE u.user_id = ANY (v_unready);
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'PK403', HINT = 'team', DETAIL = COALESCE(v_handles, ''),
            MESSAGE = 'payout_not_ready: ' || cardinality(v_unready)
                || CASE WHEN cardinality(v_unready) = 1 THEN ' member' ELSE ' members' END
                || ' of this team with a share of its earnings still need to verify their identity and add a payout account';
    END IF;

    IF finance.fn_freelancer_payout_ready(p_payee_id) THEN
        RETURN;
    END IF;
    IF p_payee_id = v_uid THEN
        RAISE EXCEPTION USING ERRCODE = 'PK403', HINT = 'self',
            MESSAGE = 'payout_not_ready: verify your identity and add a payout account before you take on paid work or join a team';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'PK403', HINT = 'other',
        MESSAGE = 'payout_not_ready: this freelancer needs to verify their identity and add a payout account before they can take on paid work';
END;
$$;

-- A wallet holds earnings once any credit to it has gone through the pending window (Decision #191):
-- an escrow release, a team share or vault cut, a finder's fee, a fair-exit payout or a product sale.
-- A top-up, refund or transfer never does.
CREATE OR REPLACE FUNCTION finance.fn_wallet_holds_earnings(p_wallet uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.wallet_id = p_wallet);
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

-- #region Business spend gate (BUSINESSES_AUDIT BF19, BF21, BF22)
-- The approval threshold that governs ONE vault: its own `approval_threshold_cents`, else the platform's
-- `vault_approval_threshold_cents`, else 0 (no threshold). A NULL on the wallet is "no local override"
-- (00000017), so every reader falls back the same way — the basket, the spend gate, a spend request
-- and the auto-fund drain read this, never the column.
CREATE OR REPLACE FUNCTION finance.fn_business_threshold(p_wallet uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT w.approval_threshold_cents FROM finance.wallets w WHERE w.id = p_wallet),
        (SELECT (pp.value #>> '{}')::bigint FROM security.platform_params pp
          WHERE pp.key = 'vault_approval_threshold_cents'),
        0
    );
$$;

-- The ONE gate every door that moves a business's pooled money calls, in the transaction that moves it:
-- the basket, paying on account, a transfer out, fund_stage / fund_ticket / fund_paid_revision, the card
-- escrow lock, and the escrow holds themselves. A wallet that is not a business's returns at once (team
-- and personal spending keep their own rules). Otherwise, in order:
--   (a) the business is published — org.fn_assert_business_active, else 55000 `business_not_active:`
--       (BB5): a draft or archived business spends nothing, on any door, counted or not.
--   (b) KYB — the business is verified, else PK403 `kyb_required:`.
--   (c) the ACTOR's envelope (never the project owner's) is counted by fn_check_spending_limit. Over the
--       cap or the per-transaction ceiling, an approved request for this ref may still carry it
--       (finance-model §14: over a member's cap queues for a second approver) — it is redeemed and the
--       spend counted past the cap; with none, PA403 `over_limit:` and the redeemer's DETAIL.
--   (d) the threshold (fn_business_threshold): at or above it, an approved request for this ref is
--       redeemed (finance.fn_redeem_spend_approval), else PA403 `needs_approval:`. One approval clears
--       (c) and (d) for one spend and is consumed once.
-- Counted ONCE. The earliest door the actor touches makes the full check and leaves a transaction-local
-- cover (`finance.spend_cover`, bound to this transaction's id) for the escrow holds beneath it: a
-- basket or a stage, which hold several escrows, opens a budget on the wallet that its door closes when
-- it is done (finance.fn_close_spend_cover); fund_ticket / fund_paid_revision leave their one ref for
-- the hold they call. A hold — or a ticket line of a basket — that the cover still pays for, for no
-- more than was counted, re-asserts KYB and passes without counting again, so a basket ticket line
-- counts once, against the buyer. A refused subtransaction rolls its cover back with it.
-- `p_count_envelope = false` is a CHECK, not a spend (the card escrow lock before anyone is charged):
-- KYB and the threshold are asserted, nothing is counted, consumed or covered; the settlement's
-- fund_stage / fund_ticket / fund_paid_revision run the real gate.
-- Refs name what an approval binds to: baskets · project_stages · tickets · revisions · transfers.
CREATE OR REPLACE FUNCTION finance.fn_assert_business_spend(
    p_wallet uuid,
    p_actor uuid,
    p_amount bigint,
    p_ref_table text,
    p_ref_id uuid,
    p_count_envelope boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_wallet finance.wallets;
    v_tx text := pg_catalog.pg_current_xact_id()::text;
    v_cover jsonb;
    v_ref text := p_wallet::text || '|' || COALESCE(p_ref_table, '') || ':' || COALESCE(p_ref_id::text, '');
    v_budget bigint;
    v_threshold bigint;
    v_redeemed boolean := false;
    v_detail text;
BEGIN
    SELECT * INTO v_wallet FROM finance.wallets w WHERE w.id = p_wallet;
    IF NOT FOUND OR v_wallet.owner_type <> 'business' OR p_amount IS NULL OR p_amount <= 0 THEN
        RETURN;
    END IF;

    PERFORM org.fn_assert_business_active(v_wallet.owner_id);

    IF NOT finance.fn_business_kyb_verified(v_wallet.owner_id) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'PK403',
            MESSAGE = 'kyb_required: complete business verification (KYB) before spending from this account',
            DETAIL = pg_catalog.jsonb_build_object('wallet_id', p_wallet, 'business_id', v_wallet.owner_id)::text;
    END IF;

    v_threshold := finance.fn_business_threshold(p_wallet);
    IF NOT p_count_envelope THEN
        IF v_threshold > 0 AND p_amount >= v_threshold THEN
            PERFORM finance.fn_redeem_spend_approval(p_wallet, p_actor, p_amount, p_ref_table, p_ref_id, false);
        END IF;
        RETURN;
    END IF;

    -- #region Already counted by an earlier door in this transaction
    v_cover := NULLIF(pg_catalog.current_setting('finance.spend_cover', true), '')::jsonb;
    IF v_cover IS NULL OR v_cover ->> 'tx' IS DISTINCT FROM v_tx THEN
        v_cover := pg_catalog.jsonb_build_object('tx', v_tx, 'budget', '{}'::jsonb, 'refs', '{}'::jsonb);
    END IF;
    IF (v_cover -> 'refs' ->> v_ref)::bigint >= p_amount THEN
        PERFORM pg_catalog.set_config('finance.spend_cover', (v_cover #- ARRAY['refs', v_ref])::text, true);
        RETURN;
    END IF;
    v_budget := COALESCE((v_cover -> 'budget' ->> p_wallet::text)::bigint, 0);
    IF v_budget >= p_amount THEN
        v_cover := pg_catalog.jsonb_set(v_cover, ARRAY['budget', p_wallet::text], pg_catalog.to_jsonb(v_budget - p_amount));
        v_cover := pg_catalog.jsonb_set(v_cover, ARRAY['refs', v_ref], pg_catalog.to_jsonb(p_amount));
        PERFORM pg_catalog.set_config('finance.spend_cover', v_cover::text, true);
        RETURN;
    END IF;
    -- #endregion

    -- #region (c) The actor's envelope
    IF NOT finance.fn_check_spending_limit(p_wallet, p_actor, p_amount) THEN
        BEGIN
            PERFORM finance.fn_redeem_spend_approval(p_wallet, p_actor, p_amount, p_ref_table, p_ref_id, true);
        EXCEPTION WHEN SQLSTATE 'PA403' THEN
            GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
            RAISE EXCEPTION USING
                ERRCODE = 'PA403',
                MESSAGE = 'over_limit: this is over your spending limit for this account',
                DETAIL = (COALESCE(NULLIF(v_detail, '')::jsonb, '{}'::jsonb)
                          || pg_catalog.jsonb_build_object('reason', 'over_limit'))::text;
        END;
        v_redeemed := true;
        -- The approved spend still counts: fn_check_spending_limit has already rolled the period.
        UPDATE finance.spending_limits sl
           SET spent_cents = sl.spent_cents + p_amount
         WHERE sl.wallet_id = p_wallet AND sl.member_user_id = p_actor;
    END IF;
    -- #endregion

    -- #region (d) The threshold
    IF NOT v_redeemed AND v_threshold > 0 AND p_amount >= v_threshold THEN
        PERFORM finance.fn_redeem_spend_approval(p_wallet, p_actor, p_amount, p_ref_table, p_ref_id, true);
    END IF;
    -- #endregion

    IF p_ref_table IN ('baskets', 'project_stages') THEN
        v_cover := pg_catalog.jsonb_set(v_cover, ARRAY['budget', p_wallet::text], pg_catalog.to_jsonb(v_budget + p_amount));
    ELSIF p_ref_table IN ('tickets', 'revisions') THEN
        v_cover := pg_catalog.jsonb_set(v_cover, ARRAY['refs', v_ref], pg_catalog.to_jsonb(p_amount));
    ELSE
        RETURN;
    END IF;
    PERFORM pg_catalog.set_config('finance.spend_cover', v_cover::text, true);
END;
$$;

COMMENT ON FUNCTION finance.fn_assert_business_spend(uuid, uuid, bigint, text, uuid, boolean) IS
'The business spend gate: KYB (PK403 kyb_required), the ACTOR''s envelope counted once per transaction
(PA403 over_limit unless an approval for the ref carries it) and the approval threshold with the platform
fallback (PA403 needs_approval unless an approval for the ref is redeemed). No-op for a non-business
wallet. p_count_envelope = false checks KYB and the threshold only, counting and consuming nothing.
Internal — called by the money doors and the escrow holds; not executable by clients.';

-- Close what a basket or stage door left of its cover on one wallet, once its holds are made: the
-- unspent budget and any ref a hold did not take. Nothing a later door in the same transaction does is
-- then waved through on this door's count.
CREATE OR REPLACE FUNCTION finance.fn_close_spend_cover(p_wallet uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cover jsonb := NULLIF(pg_catalog.current_setting('finance.spend_cover', true), '')::jsonb;
    v_key text;
BEGIN
    IF v_cover IS NULL OR p_wallet IS NULL THEN
        RETURN;
    END IF;
    v_cover := v_cover #- ARRAY['budget', p_wallet::text];
    FOR v_key IN SELECT k FROM pg_catalog.jsonb_object_keys(COALESCE(v_cover -> 'refs', '{}'::jsonb)) AS k
                  WHERE k LIKE p_wallet::text || '|%'
    LOOP
        v_cover := v_cover #- ARRAY['refs', v_key];
    END LOOP;
    PERFORM pg_catalog.set_config('finance.spend_cover', v_cover::text, true);
END;
$$;
-- #endregion

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
        OR (p_owner_type = 'enterprise' AND org.is_enterprise_member (p_owner_id));
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

-- In-DB capability check. SECURITY DEFINER so money-movement RPCs can gate on it without RLS
-- recursion. An owner-level member (manage_members) implicitly has every capability. The grant rows
-- are a projection of the workspace capabilities (org.fn_sync_vault_permissions), and the answer is
-- additionally conditioned on CURRENT membership of a team or business — so a row that outlived its
-- member for any reason (a direct write, a sync not yet run) authorises nothing. Internal: it answers
-- for an arbitrary user, so no client role may call it directly.
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
            SELECT 1
            FROM finance.vault_permissions vp
            JOIN finance.wallets w ON w.id = vp.wallet_id
            WHERE vp.wallet_id = p_wallet
              AND vp.member_user_id = p_user
              AND (p_cap = ANY (vp.capabilities) OR 'manage_members'::finance.vault_capability = ANY (vp.capabilities))
              AND (
                  w.owner_type NOT IN ('team', 'business')
                  OR EXISTS (SELECT 1 FROM org.fn_member_seat (w.owner_type, w.owner_id, p_user))
              )
        );
$$;

-- May the CALLER read every member's spend envelope and every spend request on this wallet, not
-- only their own? Those who run the policy or decide the queue: `distribute` (workspace
-- manage_finances) or `approve_spend` — and the owner, whose vault manage_members implies both. A
-- plain member reading every colleague's ceiling is a disclosure no screen intended (BUSINESSES_AUDIT
-- BF30). The spending_limits and spend_approvals SELECT policies ask it beside the reader's own rows;
-- definer reads that mirror those screens (org.get_workspace_detail) call it too.
CREATE OR REPLACE FUNCTION finance.fn_reads_wallet_envelopes(p_wallet uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
    SELECT finance.fn_has_vault_capability (p_wallet, auth.uid (), 'distribute'::finance.vault_capability)
        OR finance.fn_has_vault_capability (p_wallet, auth.uid (), 'approve_spend'::finance.vault_capability);
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
            p_owner_type IN ('business', 'team', 'enterprise')
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
                  w.owner_type IN ('business', 'team', 'enterprise')
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
            p_owner_type IN ('business', 'team', 'enterprise')
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

    IF p_owner_type = 'enterprise' THEN
        -- An enterprise has no public directory entry, so a non-member learns nothing — not even
        -- that the id exists.
        IF NOT v_member THEN
            RETURN NULL;
        END IF;
        SELECT pg_catalog.jsonb_build_object(
            'owner_type', 'enterprise',
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
        FROM org.enterprises o
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
facts to members only; an enterprise answers members only. NULL when there is nothing the caller
may know. The shape is identical for every kind.';

-- The owner a basket or checkout is scoped to, with the platform fee rate a payment from it is charged
-- (finance.fn_effective_platform_fee_bp, the rate place_wallet_order applies) — told only to a caller
-- who can see that owner's finances, since a negotiated rate is a commercial term. plpgsql, not sql:
-- the resolver is declared in a later file (00001220), and a sql body is validated at CREATE.
CREATE OR REPLACE FUNCTION finance.get_purchase_owner(p_owner_type text, p_owner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
DECLARE
    v_out jsonb;
BEGIN
    IF auth.uid () IS NULL THEN
        RETURN NULL;
    END IF;
    v_out := finance.fn_purchase_owner_json (p_owner_type, p_owner_id);
    IF v_out IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN v_out || pg_catalog.jsonb_build_object('platform_fee_bp',
        CASE WHEN finance.fn_owner_visible (p_owner_type, p_owner_id)
             THEN COALESCE(finance.fn_effective_platform_fee_bp (p_owner_type, p_owner_id), 0)
        END);
END;
$$;

COMMENT ON FUNCTION finance.get_purchase_owner(text, uuid) IS
'One purchase owner''s checkout identity for the signed-in caller (see fn_purchase_owner_json), plus
`platform_fee_bp`: the effective platform fee rate a payment from this owner is charged
(fn_effective_platform_fee_bp), or NULL when the caller cannot see the owner''s finances. NULL for an
anonymous caller.';

-- Every identity the caller may buy or bill as: themselves first, then each team, business and
-- enterprise they own or are an ACTIVE member of. The Details step's billing-identity switcher and
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
        SELECT 'enterprise', o.id, COALESCE(o.trading_name, o.legal_name)
        FROM org.enterprises o, me
        WHERE o.owner_user_id = me.uid
           OR EXISTS (SELECT 1 FROM org.enterprise_members om
                      WHERE om.enterprise_id = o.id AND om.user_id = me.uid AND om.status = 'active')
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
'The caller''s purchase identities: themselves, then every team, business and enterprise they own
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
    PERFORM org.fn_assert_business_active(p_owner_id);
    -- Monthly settlement is Business Pro's (`intervaled_invoicing`, Decision #230 (e)); going back to
    -- per-transaction never is.
    IF p_mode = 'intervaled_monthly' THEN
        PERFORM finance.fn_assert_business_entitlement(p_owner_id, 'intervaled_invoicing'::finance.entitlement_key);
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
manage_billing on the business and an active business (55000 business_not_active); the monthly mode
additionally requires the intervaled_invoicing entitlement (PK402, behind business_plan_gates_enforced)
and KYB verification.';
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
--   * Digital products, and ONE-TICKET project lines (Decision #166). A ticket line (a project kind
--     carrying `ticket_id`) is not a sale: it settles by holding that ticket's escrow from this same
--     wallet (projects.fund_ticket — no seller credit, no fee until release), so the order is its
--     receipt. The paying account must be the project's client, a promo never discounts an escrow, and
--     a card checkout reaches here through the #153 webhook exactly as a product order does. A
--     `paid_revision` line (Decision #167) settles the same way, through projects.fund_paid_revision,
--     priced from its round's snapshotted price. A `course_group_session` line (a seat, Decision #171)
--     settles the same way too: priced from its listing's session price × seats, it must carry the
--     buyer's live `metadata.holdId` (projects.reserve_seat), and projects.fn_confirm_seat turns the
--     hold into a membership and holds the seat's escrow from this wallet. A `service_session` or
--     `set_session` line (a 1-1 session or a block, Decision #211) settles the same way: priced from
--     its listing's session price (× session_count for a block) at the time the line carries
--     (`scheduled_at`, still ahead), and projects.fn_book_session_slot seats the buyer on a one-seat
--     cohort and holds ONE escrow PER SITTING from this wallet. Every other kind (a whole project, a
--     service) is still refused (PS501) rather than paid into nowhere.
--   * The charge is made in the lines' own currency, which must be one the paying wallet holds. The
--     display-currency figure the buyer saw is a conversion the application verifies separately; the
--     money that moves is integer minor units with no FX in it.
--   * The platform fee is the PAYER's effective rate (finance.fn_effective_platform_fee_bp for the
--     basket owner: an active negotiated rate, else `security.platform_params.platform_fee_bp`, 500 =
--     5%, Decision #2) — the same resolver an escrow release charges through fn_escrow_fee_bp
--     (Decision #187). It is charged per line on what was actually paid, truncated to the minor unit,
--     and deducted from each seller's credit. The fee is retained (debited from the buyer, not credited to a seller); the platform's own Fee
--     Collection wallet is not materialised yet (#54(i)).
--   * A sale credits the seller through the pending window (finance.fn_wallet_credit_pending, keyed to
--     the order): it reaches their Available balance `pending_release_days` later (Decision #191).
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
    v_fee_bp integer;
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
    v_escrow_total bigint := 0;
    v_rev record;
    v_seat record;
    v_seat_unit bigint;
    v_order_line uuid;
    v_sess record;
    v_sess_count integer;
    v_sess_unit bigint;
    v_booking jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to pay' USING ERRCODE = '42501';
    END IF;
    PERFORM org.fn_assert_adult(v_uid);
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
    -- Buying as the business is its own act (BUSINESSES_AUDIT §4.2, BB2): vault `spend` says whose
    -- money may move, the workspace `purchase` capability says who may buy with it.
    IF v_basket.owner_type = 'business'
        AND NOT security.is_admin ()
        AND NOT org.fn_member_can ('business', v_basket.owner_id, 'purchase') THEN
        RAISE EXCEPTION 'missing_permission: purchase'
            USING ERRCODE = 'PK403',
                  HINT = 'Ask the business owner or an admin for the "purchase" permission.';
    END IF;
    -- Only a published business buys (BB5); the spend gate asserts it again for every line it counts.
    IF v_basket.owner_type = 'business' THEN
        PERFORM org.fn_assert_business_active (v_basket.owner_id);
    END IF;
    IF v_basket.owner_type = 'business' AND NOT finance.fn_business_kyb_verified (v_basket.owner_id) THEN
        RAISE EXCEPTION 'Complete business verification (KYB) to pay from this account'
            USING ERRCODE = 'PK403';
    END IF;
    IF v_basket.owner_type = 'enterprise' AND NOT EXISTS (
        SELECT 1 FROM org.enterprises o
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
               p.owner_user_id, p.owner_team_id, p.licence, p.format::text AS format, p.file_manifest,
               bi.ticket_id, bi.stage_id AS line_stage_id, tk.project_id AS ticket_project_id,
               tk.title AS ticket_title, tk.current_stage_id AS ticket_stage_id,
               COALESCE(tk.unit_price_cents, ts.unit_price_cents) AS ticket_price,
               pr.currency AS project_currency, pr.client_business_id, pr.owner_user_id AS project_owner,
               bi.seats, bi.metadata, bi.scheduled_at, bi.timezone
          FROM finance.basket_items bi
          LEFT JOIN catalogue.products p ON p.id = bi.item_id AND bi.item_type = 'digital_product'
          LEFT JOIN projects.tickets tk ON tk.id = bi.ticket_id
          LEFT JOIN projects.project_stages ts ON ts.id = tk.current_stage_id
          LEFT JOIN projects.projects pr ON pr.id = tk.project_id
         WHERE bi.basket_id = v_basket.id AND bi.id = ANY (v_wanted)
         ORDER BY bi.position, bi.created_at, bi.id
    LOOP
        -- A paid revision line (Decision #167): priced from its round's snapshot and paid by the project's
        -- own client, held as escrow on the ticket by projects.fund_paid_revision below.
        IF v_line.item_type = 'paid_revision' THEN
            SELECT rv.status, rv.price_cents, pr.currency AS project_currency, pr.client_business_id,
                   pr.owner_user_id AS project_owner, ps.name AS stage_name
              INTO v_rev
              FROM projects.stage_revision_requests rv
              JOIN projects.project_stages ps ON ps.id = rv.project_stage_id
              JOIN projects.projects pr ON pr.id = ps.project_id
             WHERE rv.id = v_line.item_id;
            IF NOT FOUND OR v_rev.status <> 'awaiting_payment' THEN
                RAISE EXCEPTION '% is no longer waiting for payment', v_line.title USING ERRCODE = 'PC409';
            END IF;
            IF NOT (
                (v_basket.owner_type = 'business' AND v_rev.client_business_id = v_basket.owner_id)
                OR (v_basket.owner_type IN ('user', 'freelancer') AND v_rev.client_business_id IS NULL
                    AND v_rev.project_owner = v_basket.owner_id)
            ) THEN
                RAISE EXCEPTION 'Pay for % from the account that owns its project', v_line.title
                    USING ERRCODE = 'PU422';
            END IF;
            IF pg_catalog.upper(COALESCE(v_rev.project_currency, 'USD')) <> v_currency THEN
                RAISE EXCEPTION 'This order is priced in %, not %', pg_catalog.upper(COALESCE(v_rev.project_currency, 'USD')), v_currency
                    USING ERRCODE = 'PC409';
            END IF;
            IF p_units IS NULL OR (p_units ->> v_line.id::text) IS NULL
               OR (p_units ->> v_line.id::text)::bigint <> v_rev.price_cents THEN
                RAISE EXCEPTION 'The price of % changed while you were paying — review the total and try again', v_line.title
                    USING ERRCODE = 'PC409';
            END IF;
            v_subtotal := v_subtotal + v_rev.price_cents;
            v_escrow_total := v_escrow_total + v_rev.price_cents;
            v_lines := v_lines || pg_catalog.jsonb_build_object(
                'id', v_line.id,
                'item_id', v_line.item_id,
                'item_type', v_line.item_type,
                'title', v_line.title,
                'quantity', 1,
                'gross', v_rev.price_cents,
                'creator', 0,
                'revision_id', v_line.item_id
            );
            CONTINUE;
        END IF;
        -- A ticket line (Decision #166): priced from the ticket NOW and paid by the project's own client,
        -- whose wallet the hold debits; its gates (description, unpaid, payee) are fund_ticket's below.
        IF v_line.ticket_id IS NOT NULL THEN
            IF v_line.ticket_project_id IS DISTINCT FROM v_line.item_id
               OR (v_line.line_stage_id IS NOT NULL AND v_line.line_stage_id IS DISTINCT FROM v_line.ticket_stage_id) THEN
                RAISE EXCEPTION '% moved since you added it — review your basket and try again', v_line.title
                    USING ERRCODE = 'PC409';
            END IF;
            IF NOT (
                (v_basket.owner_type = 'business' AND v_line.client_business_id = v_basket.owner_id)
                OR (v_basket.owner_type IN ('user', 'freelancer') AND v_line.client_business_id IS NULL
                    AND v_line.project_owner = v_basket.owner_id)
            ) THEN
                RAISE EXCEPTION 'Pay for % from the account that owns its project', v_line.title
                    USING ERRCODE = 'PU422';
            END IF;
            IF pg_catalog.upper(COALESCE(v_line.project_currency, 'USD')) <> v_currency THEN
                RAISE EXCEPTION 'This order is priced in %, not %', pg_catalog.upper(COALESCE(v_line.project_currency, 'USD')), v_currency
                    USING ERRCODE = 'PC409';
            END IF;
            IF v_line.ticket_price IS NULL OR p_units IS NULL OR (p_units ->> v_line.id::text) IS NULL
               OR (p_units ->> v_line.id::text)::bigint <> v_line.ticket_price THEN
                RAISE EXCEPTION 'The price of % changed while you were paying — review the total and try again', v_line.title
                    USING ERRCODE = 'PC409';
            END IF;
            v_subtotal := v_subtotal + v_line.ticket_price;
            v_escrow_total := v_escrow_total + v_line.ticket_price;
            v_lines := v_lines || pg_catalog.jsonb_build_object(
                'id', v_line.id,
                'item_id', v_line.item_id,
                'item_type', v_line.item_type,
                'title', COALESCE(v_line.ticket_title, v_line.title),
                'quantity', 1,
                'gross', v_line.ticket_price,
                'creator', 0,
                'ticket_id', v_line.ticket_id,
                'stage_id', v_line.ticket_stage_id
            );
            CONTINUE;
        END IF;
        -- A cohort seat (Decision #171): priced from its listing NOW (session price × the held seats),
        -- and only against the buyer's own reservation on that listing's cohort. Its share leaves the
        -- wallet as the seat's escrow hold (projects.fn_confirm_seat below), never as a seller credit.
        IF v_line.item_type = 'course_group_session' THEN
            SELECT h.id AS hold_id, h.seats AS hold_seats, h.user_id, h.status, c.project_stage_id,
                   sb.id AS blueprint_id, sb.currency AS listing_currency,
                   COALESCE(sb.session_price_cents, sb.price_cents) AS session_price
              INTO v_seat
              FROM projects.cohort_seat_holds h
              JOIN projects.cohorts c ON c.id = h.cohort_id
              JOIN projects.projects sp ON sp.id = c.project_id
              JOIN marketplace.service_blueprints sb ON sb.id = sp.source_blueprint_id
             WHERE (v_line.metadata ->> 'holdId') ~ '^[0-9a-fA-F-]{36}$'
               AND h.id = (v_line.metadata ->> 'holdId')::uuid;
            IF NOT FOUND OR v_seat.user_id IS DISTINCT FROM v_uid OR v_seat.status <> 'held'
               OR v_seat.blueprint_id IS DISTINCT FROM v_line.item_id
               OR v_seat.hold_seats IS DISTINCT FROM COALESCE(v_line.seats, 1) THEN
                RAISE EXCEPTION 'Your seat reservation for % is no longer held — reserve the seat again', v_line.title
                    USING ERRCODE = 'PC409';
            END IF;
            IF pg_catalog.upper(v_seat.listing_currency) <> v_currency THEN
                RAISE EXCEPTION 'This order is priced in %, not %', pg_catalog.upper(v_seat.listing_currency), v_currency
                    USING ERRCODE = 'PC409';
            END IF;
            v_seat_unit := v_seat.session_price * v_seat.hold_seats;
            IF p_units IS NULL OR (p_units ->> v_line.id::text) IS NULL
               OR (p_units ->> v_line.id::text)::bigint <> v_seat_unit THEN
                RAISE EXCEPTION 'The price of % changed while you were paying — review the total and try again', v_line.title
                    USING ERRCODE = 'PC409';
            END IF;
            v_subtotal := v_subtotal + v_seat_unit;
            v_escrow_total := v_escrow_total + v_seat_unit;
            v_lines := v_lines || pg_catalog.jsonb_build_object(
                'id', v_line.id,
                'item_id', v_line.item_id,
                'item_type', v_line.item_type,
                'title', v_line.title,
                'quantity', 1,
                'gross', v_seat_unit,
                'creator', 0,
                'hold_id', v_seat.hold_id,
                'seats', v_seat.hold_seats,
                'seat_stage_id', v_seat.project_stage_id
            );
            CONTINUE;
        END IF;
        -- A 1-1 session or a set-session block (Decision #211): priced from its listing NOW — the session
        -- price, times the listing's session_count for a block — for the time the buyer picked, which
        -- must still lie ahead. Its share leaves the wallet as one escrow hold PER SITTING
        -- (projects.fn_book_session_slot below), never as a seller credit.
        IF v_line.item_type IN ('service_session', 'set_session') THEN
            SELECT sb.id, sb.currency AS listing_currency, sb.is_published,
                   sb.delivery_model::text AS model, sb.freelancer_profile_id, sb.owner_team_id,
                   sb.session_minutes,
                   COALESCE(sb.session_price_cents, sb.price_cents) AS session_price,
                   GREATEST(COALESCE(sb.session_count, 1), 1) AS session_count
              INTO v_sess
              FROM marketplace.service_blueprints sb
             WHERE sb.id = v_line.item_id;
            IF NOT FOUND OR NOT v_sess.is_published OR v_sess.model <> 'session' THEN
                RAISE EXCEPTION '% is no longer offered', v_line.title USING ERRCODE = 'PC409';
            END IF;
            IF v_sess.session_price IS NULL OR v_sess.session_price <= 0 THEN
                RAISE EXCEPTION '% has no price to hold in escrow', v_line.title USING ERRCODE = 'PS501';
            END IF;
            IF v_line.scheduled_at IS NULL OR v_line.scheduled_at <= pg_catalog.now() THEN
                RAISE EXCEPTION 'Pick a new time for % — the one you chose has passed', v_line.title
                    USING ERRCODE = 'PC409';
            END IF;
            IF v_sess.freelancer_profile_id = v_uid AND v_sess.owner_team_id IS NULL THEN
                RAISE EXCEPTION 'You can''t book your own session — remove % to pay for the rest', v_line.title
                    USING ERRCODE = 'PU422';
            END IF;
            IF pg_catalog.upper(v_sess.listing_currency) <> v_currency THEN
                RAISE EXCEPTION 'This order is priced in %, not %', pg_catalog.upper(v_sess.listing_currency), v_currency
                    USING ERRCODE = 'PC409';
            END IF;
            v_sess_count := CASE WHEN v_line.item_type = 'set_session' THEN v_sess.session_count ELSE 1 END;
            v_sess_unit := v_sess.session_price * v_sess_count;
            IF p_units IS NULL OR (p_units ->> v_line.id::text) IS NULL
               OR (p_units ->> v_line.id::text)::bigint <> v_sess_unit THEN
                RAISE EXCEPTION 'The price of % changed while you were paying — review the total and try again', v_line.title
                    USING ERRCODE = 'PC409';
            END IF;
            v_subtotal := v_subtotal + v_sess_unit;
            v_escrow_total := v_escrow_total + v_sess_unit;
            v_lines := v_lines || pg_catalog.jsonb_build_object(
                'id', v_line.id,
                'item_id', v_line.item_id,
                'item_type', v_line.item_type,
                'title', v_line.title,
                'quantity', 1,
                'gross', v_sess_unit,
                'creator', 0,
                'session_unit', v_sess.session_price,
                'session_count', v_sess_count,
                'scheduled_at', v_line.scheduled_at,
                'timezone', v_line.timezone,
                'duration_minutes', COALESCE(v_sess.session_minutes, 60)
            );
            CONTINUE;
        END IF;
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
            RAISE EXCEPTION 'You can''t buy your own listing — remove % to pay for the rest', v_line.title
                USING ERRCODE = 'PU422';
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
        -- An escrow is the freelancer's whole price; a promo would be a saving nobody funds.
        IF v_escrow_total > 0 THEN
            RAISE EXCEPTION 'Promo codes don''t apply to project tickets — remove the code to pay for them'
                USING ERRCODE = 'PC409';
        END IF;
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
    -- A business basket passes the spend gate once for the whole charge (BB3): KYB, the buyer's envelope,
    -- the threshold with the platform fallback, an approval bound to this basket. Its cover lets the
    -- ticket and revision lines below hold without counting the buyer — or anyone — again.
    IF v_basket.owner_type = 'business' THEN
        PERFORM finance.fn_assert_business_spend (v_wallet.id, v_uid, v_net, 'baskets', v_basket.id);
    ELSIF v_basket.owner_type IN ('team', 'enterprise') THEN
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
    v_fee_bp := COALESCE(finance.fn_effective_platform_fee_bp (v_basket.owner_type, v_basket.owner_id), 0);

    INSERT INTO finance.orders (
        id, reference, status, placed_at, owner_type, owner_id, basket_id, currency, subtotal_minor,
        creator_discount_minor, promo_discount_minor, platform_fee_minor, platform_fee_bp,
        platform_fee_mode, tax_minor, processing_contribution_minor, total_minor, charged_minor,
        payment_provider, payment_method_label, idempotency_key
    ) VALUES (
        v_order_id, v_reference, 'confirmed', pg_catalog.now(), v_basket.owner_type, v_basket.owner_id,
        v_basket.id, v_currency, v_subtotal, v_creator, v_promo_minor, 0, v_fee_bp, 'seller_deducted', 0,
        0, v_net, v_net, 'wallet', 'Projective wallet', p_idempotency_key
    );

    -- The products are paid here; each ticket line's share leaves the wallet as its escrow hold below.
    IF v_net - v_escrow_total > 0 THEN
        PERFORM finance.fn_wallet_debit (v_wallet.owner_id, v_wallet.owner_type, v_currency,
            v_net - v_escrow_total, 'order_payment', 'orders', v_order_id);
    END IF;

    -- Each line: its share of the promo (pro rata by what the line costs after creator discounts, the
    -- remainder on the last line so the shares sum exactly), the fee on what was actually paid for it,
    -- and the seller's credit for the rest.
    v_remaining_promo := v_promo_minor;
    v_eligible_base := v_subtotal - v_creator;
    FOR v_line IN SELECT value AS l, ordinality AS n FROM pg_catalog.jsonb_array_elements(v_lines) WITH ORDINALITY
    LOOP
        v_i := v_line.n;
        IF v_line.l ? 'revision_id' THEN
            PERFORM projects.fund_paid_revision((v_line.l ->> 'revision_id')::uuid);
            INSERT INTO finance.order_lines (
                order_id, basket_item_id, item_type, item_id, title, subtitle, quantity, line_total_minor,
                currency, fulfilment, position
            ) VALUES (
                v_order_id, (v_line.l ->> 'id')::uuid, 'paid_revision', (v_line.l ->> 'item_id')::uuid,
                v_line.l ->> 'title', 'Escrow held', 1, (v_line.l ->> 'gross')::bigint, v_currency,
                'engagement', v_i - 1
            );
            UPDATE finance.basket_items
               SET purchased_at = pg_catalog.now(), updated_at = pg_catalog.now()
             WHERE id = (v_line.l ->> 'id')::uuid;
            CONTINUE;
        END IF;
        IF v_line.l ? 'ticket_id' THEN
            PERFORM projects.fund_ticket((v_line.l ->> 'item_id')::uuid, (v_line.l ->> 'ticket_id')::uuid);
            INSERT INTO finance.order_lines (
                order_id, basket_item_id, item_type, item_id, title, subtitle, quantity, line_total_minor,
                currency, fulfilment, stage_id, ticket_id, position
            ) VALUES (
                v_order_id, (v_line.l ->> 'id')::uuid, (v_line.l ->> 'item_type')::finance.purchasable_item_kind,
                (v_line.l ->> 'item_id')::uuid, v_line.l ->> 'title', 'Escrow held', 1,
                (v_line.l ->> 'gross')::bigint, v_currency, 'engagement',
                (v_line.l ->> 'stage_id')::uuid, (v_line.l ->> 'ticket_id')::uuid, v_i - 1
            );
            UPDATE finance.basket_items
               SET purchased_at = pg_catalog.now(), updated_at = pg_catalog.now()
             WHERE id = (v_line.l ->> 'id')::uuid;
            CONTINUE;
        END IF;
        -- A 1-1 session or block: the order line is its receipt, written first so the seat can name it;
        -- the booking then names the stage the line fulfils.
        IF v_line.l ? 'session_count' THEN
            INSERT INTO finance.order_lines (
                order_id, basket_item_id, item_type, item_id, title, subtitle, quantity, line_total_minor,
                currency, fulfilment, scheduled_at, timezone, duration_minutes, seats, position
            ) VALUES (
                v_order_id, (v_line.l ->> 'id')::uuid, (v_line.l ->> 'item_type')::finance.purchasable_item_kind,
                (v_line.l ->> 'item_id')::uuid, v_line.l ->> 'title',
                CASE WHEN (v_line.l ->> 'session_count')::integer > 1
                     THEN 'Block booked · escrow held per session' ELSE 'Session booked · escrow held' END,
                1, (v_line.l ->> 'gross')::bigint, v_currency, 'session',
                (v_line.l ->> 'scheduled_at')::timestamptz, v_line.l ->> 'timezone',
                (v_line.l ->> 'duration_minutes')::integer, 1, v_i - 1
            )
            RETURNING id INTO v_order_line;
            v_booking := projects.fn_book_session_slot((v_line.l ->> 'item_id')::uuid, v_uid,
                v_wallet.owner_type, v_wallet.owner_id, (v_line.l ->> 'session_unit')::bigint,
                (v_line.l ->> 'session_count')::integer, v_currency,
                (v_line.l ->> 'scheduled_at')::timestamptz, v_order_line);
            UPDATE finance.order_lines SET stage_id = (v_booking ->> 'stage_id')::uuid WHERE id = v_order_line;
            UPDATE finance.basket_items
               SET purchased_at = pg_catalog.now(), updated_at = pg_catalog.now()
             WHERE id = (v_line.l ->> 'id')::uuid;
            CONTINUE;
        END IF;
        -- A seat: the order line is its receipt, written first so the membership can name it.
        IF v_line.l ? 'hold_id' THEN
            INSERT INTO finance.order_lines (
                order_id, basket_item_id, item_type, item_id, title, subtitle, quantity, line_total_minor,
                currency, fulfilment, stage_id, seats, position
            ) VALUES (
                v_order_id, (v_line.l ->> 'id')::uuid, 'course_group_session', (v_line.l ->> 'item_id')::uuid,
                v_line.l ->> 'title', 'Seat confirmed · escrow held', 1, (v_line.l ->> 'gross')::bigint,
                v_currency, 'session', (v_line.l ->> 'seat_stage_id')::uuid, (v_line.l ->> 'seats')::integer,
                v_i - 1
            )
            RETURNING id INTO v_order_line;
            PERFORM projects.fn_confirm_seat((v_line.l ->> 'hold_id')::uuid, v_uid, v_wallet.owner_type,
                v_wallet.owner_id, (v_line.l ->> 'gross')::bigint, v_currency, v_order_line);
            UPDATE finance.basket_items
               SET purchased_at = pg_catalog.now(), updated_at = pg_catalog.now()
             WHERE id = (v_line.l ->> 'id')::uuid;
            CONTINUE;
        END IF;
        IF v_i = pg_catalog.jsonb_array_length(v_lines) OR v_eligible_base = 0 THEN
            v_share := v_remaining_promo;
        ELSE
            v_share := (v_promo_minor * ((v_line.l ->> 'gross')::bigint - (v_line.l ->> 'creator')::bigint)) / v_eligible_base;
        END IF;
        v_remaining_promo := v_remaining_promo - v_share;
        v_paid := (v_line.l ->> 'gross')::bigint - (v_line.l ->> 'creator')::bigint - v_share;
        v_fee := (GREATEST(v_paid, 0) * v_fee_bp) / 10000;
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
        PERFORM finance.fn_wallet_credit_pending (v_seller_id, v_seller_type, v_currency, v_paid - v_fee,
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

    IF v_basket.owner_type = 'business' THEN
        PERFORM finance.fn_close_spend_cover (v_wallet.id);
    END IF;
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
line from the catalogue against the unit price the buyer was shown, re-validate the promo code they saw
applied (none sent → none applied), debit the wallet, credit each seller net of the payer''s effective platform fee (truncated),
write the order and its lines, consume the basket lines. Digital products, and one-ticket project lines
(Decision #166), which settle by holding that ticket''s escrow (projects.fund_ticket) instead of a
seller credit, and cohort seats (Decision #171), which settle through the buyer''s seat hold into a
membership and a seat escrow (projects.fn_confirm_seat), and 1-1 sessions and set-session blocks
(Decision #211), which settle into a one-seat cohort with one escrow per sitting
(projects.fn_book_session_slot); every other kind is refused. Idempotent on the key. Refusal
SQLSTATEs: 42501 not allowed · PK403 verification · PB404 basket gone · PC409 basket/price/promo/seat
hold changed, or a session time that passed · PD422 a line needs a delivery address · PU422 your own
listing, or a ticket not purchasable / not this account''s · PS409 the cohort filled or closed, or the
session time was taken · PS501 not payable here · PF402 wallet · PA403 spend limit/approval · 22023 bad
attempt key.';
-- #endregion

-- #region 12. Wallet movements — transfers, team distributions, spend decisions (2026-09-23)
-- The wallet surface's money moves that need no external processor. Each is a definer because the
-- ledger primitives it calls (`fn_wallet_debit` / `fn_wallet_credit`) check nothing about who is
-- asking; each therefore checks the caller itself — the capability on the wallet money leaves, and
-- membership of the wallet it lands in. Top-ups, withdrawals, recurring deposits and the Income
-- Smoother all need a payment processor and are deliberately NOT here: the application says so
-- rather than recording money that did not move.
--
-- Every movement is idempotent on a caller-minted attempt key (`finance.idempotency_keys`), scoped to
-- the caller and to the request it was first used for, so a retried request answers with what it
-- already did and a key cannot be replayed against a different movement.

-- Move money between two of the caller's OWN wallets: their personal wallet and the vaults they
-- belong to. Money leaves a personal wallet only for its owner and a vault only for a member who may
-- withdraw from it; it lands only in a wallet the caller already belongs to, so a transfer can never
-- be a payment to somebody else. Same currency only — a transfer is not a conversion.
CREATE OR REPLACE FUNCTION finance.transfer_funds(
    p_from_wallet uuid,
    p_to_wallet uuid,
    p_amount bigint,
    p_note text,
    p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_scope text;
    v_hash text;
    v_prior finance.idempotency_keys;
    v_from finance.wallets;
    v_to finance.wallets;
    v_note text := NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), '');
    v_result jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to move money' USING ERRCODE = '42501';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Enter an amount to transfer' USING ERRCODE = '22023';
    END IF;
    IF p_from_wallet IS NULL OR p_to_wallet IS NULL OR p_from_wallet = p_to_wallet THEN
        RAISE EXCEPTION 'Choose a different wallet to transfer to' USING ERRCODE = '22023';
    END IF;
    IF p_idempotency_key IS NULL OR pg_catalog.length(p_idempotency_key) < 8
       OR pg_catalog.length(p_idempotency_key) > 120 THEN
        RAISE EXCEPTION 'A transfer needs an attempt key between 8 and 120 characters' USING ERRCODE = '22023';
    END IF;

    v_scope := 'transfer:' || v_uid::text;
    v_hash := pg_catalog.md5(pg_catalog.concat_ws('|', p_from_wallet, p_to_wallet, p_amount));
    SELECT * INTO v_prior FROM finance.idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
        IF v_prior.scope <> v_scope OR v_prior.request_hash <> v_hash THEN
            RAISE EXCEPTION 'That attempt key was used for a different request' USING ERRCODE = '22023';
        END IF;
        RETURN v_prior.response || pg_catalog.jsonb_build_object('replayed', true);
    END IF;

    -- Both rows locked in id order, so two transfers crossing each other cannot deadlock.
    PERFORM 1 FROM finance.wallets WHERE id IN (p_from_wallet, p_to_wallet) ORDER BY id FOR UPDATE;
    SELECT * INTO v_from FROM finance.wallets WHERE id = p_from_wallet;
    SELECT * INTO v_to FROM finance.wallets WHERE id = p_to_wallet;
    IF v_from.id IS NULL OR v_to.id IS NULL THEN
        RAISE EXCEPTION 'That wallet no longer exists' USING ERRCODE = 'PB404';
    END IF;

    IF NOT (
        (v_from.owner_type IN ('user', 'freelancer') AND v_from.owner_id = v_uid)
        OR (v_from.owner_type IN ('team', 'business', 'enterprise')
            AND finance.fn_has_vault_capability (v_from.id, v_uid, 'withdraw'::finance.vault_capability))
    ) THEN
        RAISE EXCEPTION 'You can''t move money out of that wallet' USING ERRCODE = '42501';
    END IF;
    IF NOT (
        (v_to.owner_type IN ('user', 'freelancer') AND v_to.owner_id = v_uid)
        OR (v_to.owner_type IN ('team', 'business', 'enterprise')
            AND finance.fn_owner_visible (v_to.owner_type, v_to.owner_id))
    ) THEN
        RAISE EXCEPTION 'You can only transfer between your own wallets' USING ERRCODE = '42501';
    END IF;
    IF v_from.currency <> v_to.currency THEN
        RAISE EXCEPTION 'Both wallets must hold % — a transfer is not a currency conversion', v_from.currency
            USING ERRCODE = 'PX409';
    END IF;
    -- Money leaving a pooled business wallet passes the spend gate (BB3): KYB (finance-model.md §KYC/KYB
    -- Gating), the mover's envelope and the threshold, an approval bound to the destination wallet. A
    -- team or enterprise vault keeps its envelope only.
    IF v_from.owner_type = 'business' THEN
        PERFORM finance.fn_assert_business_spend (v_from.id, v_uid, p_amount, 'transfers', v_to.id);
    ELSIF v_from.owner_type IN ('team', 'enterprise')
       AND NOT finance.fn_check_spending_limit (v_from.id, v_uid, p_amount) THEN
        RAISE EXCEPTION 'That is over your spending limit on this account' USING ERRCODE = 'PA403';
    END IF;
    IF v_from.balance_cents < p_amount THEN
        RAISE EXCEPTION 'That wallet doesn''t hold enough for this transfer' USING ERRCODE = 'PF402';
    END IF;

    -- Each side's ledger line points at the OTHER wallet, so either reader can say where it went.
    PERFORM finance.fn_wallet_debit (v_from.owner_id, v_from.owner_type, v_from.currency, p_amount,
        'transfer_out', 'wallets', v_to.id);
    PERFORM finance.fn_wallet_credit (v_to.owner_id, v_to.owner_type, v_to.currency, p_amount,
        'transfer_in', 'wallets', v_from.id);

    IF v_from.owner_type IN ('team', 'business', 'enterprise') THEN
        INSERT INTO finance.ledger_audit (wallet_id, actor_user_id, action, amount_cents, currency, ref_table, ref_id, metadata)
        VALUES (v_from.id, v_uid, 'withdraw', p_amount, v_from.currency, 'wallets', v_to.id,
                pg_catalog.jsonb_build_object('kind', 'transfer_out', 'note', v_note));
    END IF;
    IF v_to.owner_type IN ('team', 'business', 'enterprise') THEN
        INSERT INTO finance.ledger_audit (wallet_id, actor_user_id, action, amount_cents, currency, ref_table, ref_id, metadata)
        VALUES (v_to.id, v_uid, 'add_funds', p_amount, v_to.currency, 'wallets', v_from.id,
                pg_catalog.jsonb_build_object('kind', 'transfer_in', 'note', v_note));
    END IF;

    v_result := pg_catalog.jsonb_build_object(
        'amount_minor', p_amount, 'currency', v_from.currency,
        'from_wallet', v_from.id, 'to_wallet', v_to.id, 'replayed', false
    );
    INSERT INTO finance.idempotency_keys (key, scope, request_hash, status, response, expires_at)
    VALUES (p_idempotency_key, v_scope, v_hash, 'succeeded', v_result, pg_catalog.now() + interval '7 days');
    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION finance.transfer_funds(uuid, uuid, bigint, text, text) IS
'Move money between two of the caller''s own wallets (their personal wallet and the vaults they belong
to), same currency only. Leaving a vault needs the withdraw capability and the member''s spending limit;
leaving a business wallet passes finance.fn_assert_business_spend (KYB, the envelope, the approval
threshold). Landing needs membership. Idempotent on the attempt key. Refusals: 42501 not allowed ·
22023 bad input or key · PB404 wallet gone · PX409 different currencies · PK403 KYB · PA403 spending
limit or approval · PF402 not enough.';

-- Distribute part of a TEAM vault to its members by their agreed stakes
-- (`finance.contribution_agreements.percent_bp`, active members only). Each share is floored to the
-- minor unit; whatever does not divide — and any stake the agreement leaves unallocated — stays in the
-- vault, so the vault is debited by exactly what was paid out. Needs the distribute capability. A
-- held stake is paid like any other: `held` only protects it from the split rebalancer.
CREATE OR REPLACE FUNCTION finance.distribute_vault(
    p_wallet uuid,
    p_amount bigint,
    p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_scope text;
    v_hash text;
    v_prior finance.idempotency_keys;
    v_vault finance.wallets;
    v_dist uuid := gen_random_uuid();
    m record;
    v_share bigint;
    v_paid bigint := 0;
    v_shares jsonb := '[]'::jsonb;
    v_member_type text;
    v_result jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to move money' USING ERRCODE = '42501';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Enter an amount to distribute' USING ERRCODE = '22023';
    END IF;
    IF p_idempotency_key IS NULL OR pg_catalog.length(p_idempotency_key) < 8
       OR pg_catalog.length(p_idempotency_key) > 120 THEN
        RAISE EXCEPTION 'A distribution needs an attempt key between 8 and 120 characters' USING ERRCODE = '22023';
    END IF;

    v_scope := 'distribute:' || v_uid::text;
    v_hash := pg_catalog.md5(pg_catalog.concat_ws('|', p_wallet, p_amount));
    SELECT * INTO v_prior FROM finance.idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
        IF v_prior.scope <> v_scope OR v_prior.request_hash <> v_hash THEN
            RAISE EXCEPTION 'That attempt key was used for a different request' USING ERRCODE = '22023';
        END IF;
        RETURN v_prior.response || pg_catalog.jsonb_build_object('replayed', true);
    END IF;

    SELECT * INTO v_vault FROM finance.wallets WHERE id = p_wallet FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That wallet no longer exists' USING ERRCODE = 'PB404';
    END IF;
    IF v_vault.owner_type <> 'team' THEN
        RAISE EXCEPTION 'Only a team vault distributes to its members' USING ERRCODE = '22023';
    END IF;
    IF NOT finance.fn_has_vault_capability (v_vault.id, v_uid, 'distribute'::finance.vault_capability) THEN
        RAISE EXCEPTION 'Only a member who may distribute can pay out this vault' USING ERRCODE = '42501';
    END IF;
    IF v_vault.balance_cents < p_amount THEN
        RAISE EXCEPTION 'The vault doesn''t hold enough for this distribution' USING ERRCODE = 'PF402';
    END IF;

    FOR m IN
        SELECT ca.member_user_id, ca.percent_bp, up.username
          FROM finance.contribution_agreements ca
          JOIN org.team_members tm
            ON tm.team_id = ca.team_id AND tm.user_id = ca.member_user_id AND tm.status = 'active'
          LEFT JOIN org.users_public up ON up.user_id = ca.member_user_id
         WHERE ca.team_id = v_vault.owner_id AND ca.percent_bp > 0
         ORDER BY ca.percent_bp DESC, ca.member_user_id
    LOOP
        v_share := (p_amount * m.percent_bp) / 10000;
        CONTINUE WHEN v_share <= 0;
        -- A member's personal wallet in the vault's currency; one is created if they have none, because
        -- `fn_wallet_credit` is a silent no-op on a missing wallet and a share must never vanish.
        SELECT w.owner_type INTO v_member_type
          FROM finance.wallets w
         WHERE w.owner_id = m.member_user_id AND w.currency = v_vault.currency
           AND w.owner_type IN ('freelancer', 'user')
         ORDER BY (w.owner_type = 'freelancer') DESC
         LIMIT 1;
        v_member_type := COALESCE(v_member_type, 'freelancer');
        INSERT INTO finance.wallets (owner_type, owner_id, currency)
        VALUES (v_member_type, m.member_user_id, v_vault.currency)
        ON CONFLICT (owner_type, owner_id, currency) DO NOTHING;
        PERFORM finance.fn_wallet_credit (m.member_user_id, v_member_type, v_vault.currency, v_share,
            'team_distribution', 'team_distribution', v_dist);
        v_paid := v_paid + v_share;
        v_shares := v_shares || pg_catalog.jsonb_build_object(
            'member_user_id', m.member_user_id, 'handle', m.username,
            'amount_minor', v_share, 'percent_bp', m.percent_bp
        );
    END LOOP;

    IF pg_catalog.jsonb_array_length(v_shares) = 0 THEN
        RAISE EXCEPTION 'Agree how this team splits its income before distributing' USING ERRCODE = 'PD422';
    END IF;

    PERFORM finance.fn_wallet_debit (v_vault.owner_id, 'team', v_vault.currency, v_paid,
        'team_distribution', 'team_distribution', v_dist);
    INSERT INTO finance.ledger_audit (wallet_id, actor_user_id, action, amount_cents, currency, ref_table, ref_id, metadata)
    VALUES (v_vault.id, v_uid, 'distribute', v_paid, v_vault.currency, 'team_distribution', v_dist,
            pg_catalog.jsonb_build_object('requested_minor', p_amount, 'shares', v_shares));

    v_result := pg_catalog.jsonb_build_object(
        'distribution_id', v_dist, 'distributed_minor', v_paid, 'requested_minor', p_amount,
        'currency', v_vault.currency, 'shares', v_shares, 'replayed', false
    );
    INSERT INTO finance.idempotency_keys (key, scope, request_hash, status, response, expires_at)
    VALUES (p_idempotency_key, v_scope, v_hash, 'succeeded', v_result, pg_catalog.now() + interval '7 days');
    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION finance.distribute_vault(uuid, bigint, text) IS
'Pay part of a team vault out to its active members by their agreed stakes (contribution_agreements),
flooring each share; what does not divide stays in the vault, which is debited by exactly what was paid.
Needs the distribute capability. Idempotent on the attempt key. Refusals: 42501 · 22023 · PB404 ·
PF402 not enough · PD422 no split agreed.';

-- Decide a queued over-cap spend request. The decider must hold `approve_spend` on the account (the
-- workspace capability of the same name, projected onto the vault — manage_members implies it) and
-- not be the person who asked: approving one's own over-cap spend would make the cap decorative. A
-- request past its expiry is marked expired rather than decided; a decided request — approved (spent
-- or not), rejected or expired — is never decided again. Approving does not move money: the spend is
-- made by the door it was filed for, which redeems it (finance.fn_redeem_spend_approval). An approved
-- ticket request is the one exception that is acted on at once — the auto-fund queue is retried.
CREATE OR REPLACE FUNCTION finance.decide_spend_approval(p_approval uuid, p_decision text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_row finance.spend_approvals;
    v_status finance.approval_status;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to decide spend requests' USING ERRCODE = '42501';
    END IF;
    IF p_decision IS NULL OR p_decision NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'A decision is approve or reject' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_row FROM finance.spend_approvals WHERE id = p_approval FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That request no longer exists' USING ERRCODE = 'PB404';
    END IF;
    IF v_row.requested_by = v_uid THEN
        RAISE EXCEPTION 'You can''t decide your own spend request' USING ERRCODE = '42501';
    END IF;
    IF NOT finance.fn_has_vault_capability (v_row.wallet_id, v_uid, 'approve_spend'::finance.vault_capability) THEN
        RAISE EXCEPTION 'Only a member who approves spend on this account can decide spend requests' USING ERRCODE = '42501';
    END IF;
    IF v_row.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION 'That request has already been spent' USING ERRCODE = 'PC409';
    END IF;
    IF v_row.status = 'expired'::finance.approval_status THEN
        RAISE EXCEPTION 'That request has expired' USING ERRCODE = 'PC409';
    END IF;
    IF v_row.status <> 'pending'::finance.approval_status THEN
        RAISE EXCEPTION 'That request has already been decided' USING ERRCODE = 'PC409';
    END IF;

    IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= pg_catalog.now() THEN
        v_status := 'expired';
        UPDATE finance.spend_approvals SET status = v_status WHERE id = v_row.id;
    ELSE
        v_status := CASE p_decision WHEN 'approve' THEN 'approved' ELSE 'rejected' END::finance.approval_status;
        UPDATE finance.spend_approvals
           SET status = v_status, approver_user_id = v_uid, decided_at = pg_catalog.now()
         WHERE id = v_row.id;
        PERFORM comms.fn_notify (
            v_row.requested_by,
            CASE v_status WHEN 'approved' THEN 'spend.approved' ELSE 'spend.rejected' END,
            CASE v_status WHEN 'approved' THEN 'Spend request approved' ELSE 'Spend request declined' END,
            pg_catalog.left(v_row.reason, 200),
            'spend_approvals',
            v_row.id
        );
        -- A queued ticket is funded now, not on the next credit; the drain redeems this approval.
        IF v_status = 'approved' AND v_row.ref_table = 'tickets' THEN
            PERFORM finance.fn_auto_fund_drain(v_row.wallet_id);
        END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object('id', v_row.id, 'status', v_status);
END;
$$;

COMMENT ON FUNCTION finance.decide_spend_approval(uuid, text) IS
'Approve or reject a pending over-cap spend request. The decider needs approve_spend on the account and
may not be the requester; an expired request is marked expired. Notifies the requester; an approved
ticket request retries the auto-fund queue. Refusals: 42501 · 22023 · PB404 · PC409 already decided,
spent or expired.';

-- Spend an approval: the one way an approved request lets money move (BUSINESSES_AUDIT BF20 / §4.3).
-- Called by the spend gate (finance.fn_assert_business_spend) on its over-cap and threshold paths,
-- inside the transaction that moves the money. It takes an approved, unexpired, unspent request for
-- this wallet and this exact ref whose amount covers the charge, filed by the actor — or by anyone for
-- a ticket, which automatic holds fund as the project owner — locks it, and stamps it spent. Smallest
-- covering approval first, so a larger one is kept for a larger charge. `p_consume = false` only
-- checks (a card payment's pre-check before the charge; the settle re-runs the gate and spends it).
-- Anything else is refused PA403 `needs_approval`, the ref in DETAIL (jsonb) so the app can offer
-- "Request approval" bound to exactly this.
CREATE OR REPLACE FUNCTION finance.fn_redeem_spend_approval(
    p_wallet uuid, p_actor uuid, p_amount bigint, p_ref_table text, p_ref_id uuid, p_consume boolean DEFAULT true
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_wallet IS NOT NULL AND p_actor IS NOT NULL AND p_amount > 0
       AND p_ref_table IS NOT NULL AND p_ref_id IS NOT NULL THEN
        SELECT sa.id INTO v_id
          FROM finance.spend_approvals sa
          JOIN finance.wallets w ON w.id = sa.wallet_id
         WHERE sa.wallet_id = p_wallet
           AND sa.ref_table = p_ref_table
           AND sa.ref_id = p_ref_id
           AND sa.status = 'approved'::finance.approval_status
           AND sa.consumed_at IS NULL
           AND (sa.expires_at IS NULL OR sa.expires_at > pg_catalog.now())
           AND sa.amount_cents >= p_amount
           AND sa.currency = w.currency
           AND (sa.requested_by = p_actor OR sa.ref_table = 'tickets')
         ORDER BY sa.amount_cents, sa.decided_at, sa.id
         LIMIT 1
           FOR UPDATE OF sa;
    END IF;

    IF v_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'PA403',
            MESSAGE = 'needs_approval: this spend needs an approval before it can be made',
            DETAIL = pg_catalog.jsonb_build_object(
                'wallet_id', p_wallet,
                'ref_table', p_ref_table,
                'ref_id', p_ref_id,
                'amount_minor', p_amount,
                'threshold_minor', finance.fn_business_threshold(p_wallet)
            )::text;
    END IF;

    IF p_consume THEN
        UPDATE finance.spend_approvals
           SET consumed_at = pg_catalog.now(), consumed_ref_table = p_ref_table, consumed_ref_id = p_ref_id
         WHERE id = v_id;
    END IF;
    RETURN true;
END;
$$;

COMMENT ON FUNCTION finance.fn_redeem_spend_approval(uuid, uuid, bigint, text, uuid, boolean) IS
'Spend one approved, unexpired, unspent request for (wallet, ref) covering the amount, filed by the actor
(any requester for tickets): locks it and stamps consumed_at + consumed_ref_* unless p_consume is false.
Returns true, else raises PA403 needs_approval with DETAIL {wallet_id, ref_table, ref_id, amount_minor,
threshold_minor}. Internal — called by the spend gate and the auto-fund drain; not executable by clients.';
-- #endregion

-- #region 13. Workspace money governance — the team split, the business spend policy, spend requests
-- The write side of the /teams and /businesses Money modules (Decision #122). Authority is the
-- WORKSPACE capability `manage_finances` (org.fn_member_can), the same answer the console renders
-- from; the vault projection that the money functions enforce is re-synced after every change.

-- A team's split, replaced whole. `p_stakes` is `[{member_id, share_bp, held}]` over ACTIVE members
-- and must total exactly 100%; an active member left out is written at 0, a departed member is
-- zeroed. Nothing is deleted.
CREATE OR REPLACE FUNCTION finance.save_team_split(p_team_id uuid, p_stakes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_total bigint := 0;
    s jsonb;
    v_member uuid;
    v_user uuid;
    v_bp integer;
    v_seen uuid[] := '{}';
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org.teams t WHERE t.id = p_team_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workspace: not found';
    END IF;
    IF NOT org.fn_member_can('team', p_team_id, 'manage_finances') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'stakes: you cannot change how this team splits its income';
    END IF;
    IF p_stakes IS NULL OR jsonb_typeof(p_stakes) <> 'array' OR jsonb_array_length(p_stakes) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'stakes: give every member a share';
    END IF;

    -- Validate the whole set before writing any of it.
    FOR s IN SELECT * FROM jsonb_array_elements(p_stakes) LOOP
        v_member := NULLIF(s->>'member_id', '')::uuid;
        v_bp := (s->>'share_bp')::integer;
        IF v_member IS NULL OR v_bp IS NULL OR v_bp < 0 OR v_bp > 10000 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'stakes: every share is a whole number of basis points from 0 to 10000';
        END IF;
        IF v_member = ANY (v_seen) THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'stakes: a member appears twice';
        END IF;
        v_seen := v_seen || v_member;
        IF NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.id = v_member AND m.team_id = p_team_id AND m.status = 'active') THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'stakes: every share must belong to an active member';
        END IF;
        v_total := v_total + v_bp;
    END LOOP;
    IF v_total <> 10000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'stakes: the split must total 100% (it is ' || CASE WHEN v_total > 10000 THEN 'over' ELSE 'under' END
                   || ' by ' || trim_scale(round(abs(v_total - 10000) / 100.0, 2))::text || '%)';
    END IF;

    -- Every agreement row of the team is rewritten: listed members to their share, everybody else to 0.
    UPDATE finance.contribution_agreements SET percent_bp = 0, held = false WHERE team_id = p_team_id;
    FOR s IN SELECT * FROM jsonb_array_elements(p_stakes) LOOP
        SELECT m.user_id INTO v_user FROM org.team_members m WHERE m.id = (s->>'member_id')::uuid;
        INSERT INTO finance.contribution_agreements (team_id, member_user_id, percent_bp, held)
        VALUES (p_team_id, v_user, (s->>'share_bp')::integer, COALESCE((s->>'held')::boolean, false))
        ON CONFLICT (team_id, member_user_id) DO UPDATE
            SET percent_bp = EXCLUDED.percent_bp, held = EXCLUDED.held;
    END LOOP;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, 'team.split_changed', 'org.teams', p_team_id, jsonb_build_object('stakes', p_stakes));
    RETURN jsonb_build_object('team_id', p_team_id, 'total_bp', v_total);
END;
$$;

-- A team's split TEMPLATE (finance-model.md §5, Decision #228 (F)) — the rule fn_team_split_plan reads
-- beside the stakes. The new template replaces the active one: under a per-team advisory lock the
-- current active row is retired (`active = false`, kept as history — never deleted) and the new row
-- inserted active, so uq_split_rules_team_active always holds exactly one. Cuts are basis points:
--   co_op                vault_bp 0–10000; no finder.
--   finders_fee          vault_bp 0–10000, plus an ACTIVE member as finder with finder_bp ≥ 1, and
--                        finder_bp + vault_bp ≤ 10000.
--   benevolent_dictator  everything to the vault — p_vault_bp is ignored and 10000 stored, the figure
--                        the plan reports for this template; no finder.
-- Needs `manage_finances`; an archived team must be restored first; the team's plan must carry the
-- template's `split_template_<type>` flag (PK402 `entitlement:` otherwise). Audits
-- `team.split_rule_changed`.
CREATE OR REPLACE FUNCTION finance.save_split_rule(
    p_team_id uuid,
    p_rule_type finance.split_rule_type,
    p_vault_bp integer,
    p_finder_user_id uuid DEFAULT NULL,
    p_finder_bp integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_status text;
    v_vault_bp integer := p_vault_bp;
    v_previous uuid;
    v_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    SELECT t.status INTO v_status FROM org.teams t WHERE t.id = p_team_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workspace: not found';
    END IF;
    IF NOT org.fn_member_can('team', p_team_id, 'manage_finances') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'rule: you cannot change how this team splits its income';
    END IF;
    IF v_status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'workspace: restore this team before changing its split';
    END IF;
    IF p_rule_type IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'rule_type: choose how the team splits its income';
    END IF;
    -- Which templates a team's plan unlocks is data: one `split_template_<type>` flag per template in
    -- finance.plan_entitlements (Decision #226 (d): co_op free, finders_fee and benevolent_dictator Pro).
    IF NOT finance.fn_has_entitlement('team', p_team_id,
        ('split_template_' || p_rule_type::text)::finance.entitlement_key) THEN
        RAISE EXCEPTION USING ERRCODE = 'PK402', HINT = 'split_template_' || p_rule_type::text,
            MESSAGE = 'entitlement: this split template is part of Pro Team — upgrade the team to use it';
    END IF;

    IF p_rule_type = 'benevolent_dictator' THEN
        v_vault_bp := 10000;
    ELSIF v_vault_bp IS NULL OR v_vault_bp < 0 OR v_vault_bp > 10000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'vault_bp: the vault''s cut is a whole number of basis points from 0 to 10000';
    END IF;

    IF p_rule_type = 'finders_fee' THEN
        IF p_finder_user_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM org.team_members m
             WHERE m.team_id = p_team_id AND m.user_id = p_finder_user_id AND m.status = 'active'
        ) THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'finder_user_id: the finder must be an active member of this team';
        END IF;
        IF p_finder_bp IS NULL OR p_finder_bp < 1 OR p_finder_bp > 10000 THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = 'finder_bp: the finder''s cut is a whole number of basis points from 1 to 10000';
        END IF;
        IF p_finder_bp + v_vault_bp > 10000 THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = 'finder_bp: the finder''s and the vault''s cuts together cannot exceed 100%';
        END IF;
    ELSE
        IF p_finder_user_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'finder_user_id: only a finder''s fee names a finder';
        END IF;
        IF p_finder_bp IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'finder_bp: only a finder''s fee takes a finder''s cut';
        END IF;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('split:' || p_team_id::text));
    UPDATE finance.split_rules SET active = false, updated_at = now()
     WHERE team_id = p_team_id AND active
    RETURNING id INTO v_previous;
    INSERT INTO finance.split_rules (team_id, rule_type, vault_bp, finder_user_id, finder_bp, active)
    VALUES (p_team_id, p_rule_type, v_vault_bp, p_finder_user_id, p_finder_bp, true)
    RETURNING id INTO v_id;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, 'team.split_rule_changed', 'org.teams', p_team_id, jsonb_build_object(
        'rule_id', v_id, 'previous_rule_id', v_previous, 'rule_type', p_rule_type,
        'vault_bp', v_vault_bp, 'finder_user_id', p_finder_user_id, 'finder_bp', p_finder_bp));
    RETURN v_id;
END;
$$;

-- What the team's NEXT release will pay, by the same plan the release runs (fn_team_split_plan). The
-- honest gross is the team's oldest escrow still held; a team with none has no projection (`gross`
-- NULL) rather than an invented one. The fee is that escrow's payer's rate (fn_escrow_fee_bp), the one
-- the release will charge, truncated as the release truncates (Decision #187).
--
-- With `p_gross_minor` (1 … 10^12 minor units) it prices a release of THAT size instead — the Payouts
-- module's Preview: the platform's standard fee rate (no payer, so no negotiated rate), truncated the
-- same way, then the team's stored rule and stakes through the same plan. Either answer carries the
-- active rule's `finder_bp` beside the plan, so every cut can be labelled with its rate.
--
-- Either answer exposes the split rule (the vault and finder cuts, the finder) and every stake, which
-- Decision #233 (b) answers only to a `manage_finances` holder — the detail's payout block, which calls
-- this, is built for nobody else — so a member without it is refused (`42501 payout:`).
CREATE OR REPLACE FUNCTION finance.preview_team_split(p_team_id uuid, p_gross_minor bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_escrow record;
    v_fee_bp integer;
    v_fee bigint;
    v_payout bigint;
    v_finder_bp integer;
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1 FROM org.fn_member_seat('team', p_team_id, auth.uid())
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'workspace: you are not a member of this team';
    END IF;
    IF NOT org.fn_member_can('team', p_team_id, 'manage_finances') THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'payout: only members who manage the team''s finances can preview its split';
    END IF;
    SELECT r.finder_bp INTO v_finder_bp
      FROM finance.split_rules r
     WHERE r.team_id = p_team_id AND r.active AND r.rule_type = 'finders_fee';
    IF p_gross_minor IS NOT NULL THEN
        IF p_gross_minor < 1 OR p_gross_minor > 1000000000000 THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = 'gross_minor: preview an amount from 1 to 1000000000000 minor units';
        END IF;
        v_fee_bp := finance.fn_escrow_fee_bp(NULL, NULL);
        v_fee := (p_gross_minor * v_fee_bp) / 10000;
        v_payout := GREATEST(p_gross_minor - v_fee, 0);
        RETURN jsonb_build_object(
            'escrow_id', NULL,
            'gross_minor', p_gross_minor,
            'currency', NULL,
            'fee_minor', v_fee,
            'fee_bp', v_fee_bp,
            'finder_bp', v_finder_bp,
            'plan', finance.fn_team_split_plan(p_team_id, v_payout)
        );
    END IF;
    SELECT e.id, e.amount_cents, COALESCE(e.deadline_bonus_cents, 0) AS bonus, e.currency,
           e.payer_business_id, e.payer_user_id
      INTO v_escrow
      FROM finance.escrows e
     WHERE e.payee_type = 'team' AND e.payee_id = p_team_id AND e.status = 'held'
     ORDER BY e.created_at, e.id
     LIMIT 1;
    IF v_escrow.id IS NULL THEN
        RETURN jsonb_build_object('gross_minor', NULL, 'currency', NULL, 'fee_minor', NULL, 'fee_bp', NULL,
            'finder_bp', v_finder_bp, 'plan', finance.fn_team_split_plan(p_team_id, 0));
    END IF;
    v_fee_bp := finance.fn_escrow_fee_bp(v_escrow.payer_business_id, v_escrow.payer_user_id);
    v_fee := (v_escrow.amount_cents * v_fee_bp) / 10000;
    v_payout := GREATEST(v_escrow.amount_cents + v_escrow.bonus - v_fee, 0);
    RETURN jsonb_build_object(
        'escrow_id', v_escrow.id,
        'gross_minor', v_escrow.amount_cents + v_escrow.bonus,
        'currency', v_escrow.currency,
        'fee_minor', v_fee,
        'fee_bp', v_fee_bp,
        'finder_bp', v_finder_bp,
        'plan', finance.fn_team_split_plan(p_team_id, v_payout)
    );
END;
$$;

-- A business's spend policy, as a patch — a key present is a change, so "absent" and "null" stay
-- distinguishable. Keys:
--   currency                   which of the business's wallets the threshold and limits apply to
--                              (default: its default currency);
--   approval_threshold_minor   NULL disables the threshold (0 is refused: "every spend needs a second
--                              approver" is expressed with a per-transaction ceiling of 0 instead);
--   approver_ids / contributor_ids   the members (by member id) who hold `approve_spend` /
--                              `contribute_funds` — everyone else does not;
--   limits  [{member_id, can_spend, limit_minor, per_transaction_minor}]
-- Every change to a member is subject to the same rules as the member drawer: never your own row,
-- never the owner's, only somebody you outrank, and never a capability you do not hold yourself.
CREATE OR REPLACE FUNCTION finance.save_spend_policy(p_business_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_owner uuid;
    v_currency text;
    v_wallet uuid;
    v_actor org.workspace_capability[];
    v_actor_rank integer;
    v_threshold bigint;
    r record;
    l jsonb;
    v_want boolean;
    v_has boolean;
    v_ids uuid[];
    v_cap org.workspace_capability;
    v_key text;
    v_limit bigint;
    v_per_tx bigint;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'patch: expected an object';
    END IF;
    SELECT b.owner_user_id, upper(COALESCE(NULLIF(p_patch->>'currency', ''), b.default_currency, 'USD'))
      INTO v_owner, v_currency
      FROM org.business_profiles b WHERE b.id = p_business_id;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workspace: not found';
    END IF;
    IF NOT org.fn_member_can('business', p_business_id, 'manage_finances') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'policy: you cannot change this business''s spend policy';
    END IF;
    v_actor := org.fn_member_capabilities('business', p_business_id, v_uid);
    SELECT s.rank INTO v_actor_rank FROM org.fn_member_seat('business', p_business_id, v_uid) s;
    v_wallet := finance.fn_ensure_wallet('business', p_business_id, v_currency);

    IF p_patch ? 'approval_threshold_minor' THEN
        v_threshold := NULLIF(p_patch->>'approval_threshold_minor', '')::bigint;
        IF v_threshold IS NOT NULL AND v_threshold < 1 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'approvalThresholdMinor: a threshold is at least one minor unit — clear it to turn approvals off';
        END IF;
        -- A threshold and per-member ceilings are the full pooled wallet, Business Pro's
        -- (`pooled_wallet_full`, Decision #230 (e); finance-model §16.1 — basic mode is the shared
        -- wallet without caps). Clearing either is never refused, so a downgraded business can lift them.
        IF v_threshold IS NOT NULL THEN
            PERFORM finance.fn_assert_business_entitlement(p_business_id, 'pooled_wallet_full'::finance.entitlement_key);
        END IF;
        UPDATE finance.wallets SET approval_threshold_cents = v_threshold WHERE id = v_wallet;
    END IF;

    -- Set-valued capability keys: approver_ids → approve_spend, contributor_ids → contribute_funds.
    FOREACH v_key IN ARRAY ARRAY['approver_ids', 'contributor_ids'] LOOP
        CONTINUE WHEN NOT (p_patch ? v_key);
        v_cap := CASE v_key WHEN 'approver_ids' THEN 'approve_spend' ELSE 'contribute_funds' END::org.workspace_capability;
        SELECT COALESCE(array_agg(x::uuid), '{}') INTO v_ids FROM jsonb_array_elements_text(p_patch->v_key) x;
        FOR r IN
            SELECT m.id, m.user_id, org.fn_preset_rank(m.role) AS rank
              FROM org.business_members m WHERE m.business_id = p_business_id AND m.status = 'active'
        LOOP
            -- The owner (who holds everything) and the caller (who cannot edit themselves) are fixed
            -- points of the set, not members of it: the list names everybody ELSE.
            CONTINUE WHEN r.user_id = v_owner OR r.user_id = v_uid;
            v_want := r.id = ANY (v_ids);
            v_has := v_cap = ANY (org.fn_member_capabilities('business', p_business_id, r.user_id));
            CONTINUE WHEN v_want = v_has;
            IF r.rank >= v_actor_rank THEN
                RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = replace(v_key, '_ids', 'Ids') || ': you cannot change that for this member';
            END IF;
            IF v_want AND NOT (v_cap = ANY (v_actor)) THEN
                RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = replace(v_key, '_ids', 'Ids') || ': you cannot grant a permission you do not hold';
            END IF;
            PERFORM org.fn_set_member_capability('business', r.id, v_cap, v_want);
        END LOOP;
    END LOOP;

    IF p_patch ? 'limits' THEN
        FOR l IN SELECT * FROM jsonb_array_elements(p_patch->'limits') LOOP
            SELECT m.id, m.user_id, org.fn_preset_rank(m.role) AS rank INTO r
              FROM org.business_members m
             WHERE m.id = NULLIF(l->>'member_id', '')::uuid AND m.business_id = p_business_id AND m.status = 'active';
            IF r.id IS NULL THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'limits: every limit must belong to an active member';
            END IF;
            IF r.user_id = v_owner OR r.user_id = v_uid OR r.rank >= v_actor_rank THEN
                RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'limits: you cannot change this member''s limit';
            END IF;
            IF l ? 'can_spend' THEN
                v_want := (l->>'can_spend')::boolean;
                IF v_want AND NOT ('spend_funds' = ANY (v_actor)) THEN
                    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'limits: you cannot grant a permission you do not hold';
                END IF;
                PERFORM org.fn_set_member_capability('business', r.id, 'spend_funds', v_want);
            END IF;
            IF l ? 'limit_minor' OR l ? 'per_transaction_minor' THEN
                v_limit := NULLIF(l->>'limit_minor', '')::bigint;
                v_per_tx := NULLIF(l->>'per_transaction_minor', '')::bigint;
                IF (v_limit IS NOT NULL AND v_limit < 0) OR (v_per_tx IS NOT NULL AND v_per_tx < 0) THEN
                    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'limits: a limit cannot be negative';
                END IF;
                IF v_limit IS NOT NULL OR v_per_tx IS NOT NULL THEN
                    PERFORM finance.fn_assert_business_entitlement(p_business_id, 'pooled_wallet_full'::finance.entitlement_key);
                END IF;
                INSERT INTO finance.spending_limits (wallet_id, member_user_id, cap_cents, per_transaction_cents)
                VALUES (v_wallet, r.user_id, v_limit, v_per_tx)
                ON CONFLICT (wallet_id, member_user_id) DO UPDATE
                    SET cap_cents = CASE WHEN l ? 'limit_minor' THEN EXCLUDED.cap_cents ELSE finance.spending_limits.cap_cents END,
                        per_transaction_cents = CASE WHEN l ? 'per_transaction_minor' THEN EXCLUDED.per_transaction_cents ELSE finance.spending_limits.per_transaction_cents END;
            END IF;
        END LOOP;
    END IF;

    PERFORM org.fn_sync_vault_permissions('business', p_business_id, NULL);
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, 'business.spend_policy_changed', 'org.business_profiles', p_business_id,
            jsonb_build_object('currency', v_currency, 'fields', to_jsonb(ARRAY(SELECT jsonb_object_keys(p_patch)))));
    RETURN jsonb_build_object('business_id', p_business_id, 'currency', v_currency);
END;
$$;

-- The spend envelopes of a business's members on ONE of its wallets, as the Spend module shows them and
-- as finance.fn_check_spending_limit would count them right now: `spent_minor` is 0 once a weekly or
-- monthly period has rolled (resets_at passed), `remaining_minor` is what is left of the cap (never
-- below 0; NULL with no cap), `used_fraction` the share of the cap consumed (0..1; 0 with no cap).
-- A member with no spending_limits row has no ceilings. `can_spend` is their effective `spend_funds`.
--
-- Narrowed to what the CALLER may read, exactly as the spending_limits SELECT policy narrows it (BB6):
-- their own envelope, and everybody's only when they read the wallet's envelopes
-- (finance.fn_reads_wallet_envelopes). With no wallet in that currency yet there are no stored rows,
-- and the same people — `manage_finances` or `approve_spend` holders — see every member's defaults.
--
-- `p_patch` is a finance.save_spend_policy patch (or NULL): its `limits` entries replace what they name
-- — `can_spend`, `limit_minor`, `per_transaction_minor`, each only when present — so a draft is priced
-- against the period's real spend. Read by org.get_workspace_detail and finance.preview_spend_envelope,
-- so the console and the draft preview cannot disagree. Internal.
CREATE OR REPLACE FUNCTION finance.fn_business_envelopes(p_business uuid, p_wallet uuid, p_patch jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_reads_all boolean;
BEGIN
    v_reads_all := CASE WHEN p_wallet IS NOT NULL THEN finance.fn_reads_wallet_envelopes(p_wallet)
        ELSE org.fn_member_can('business', p_business, 'manage_finances')
          OR org.fn_member_can('business', p_business, 'approve_spend') END;
    RETURN (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'member_id', e.member_id,
            'user_id', e.user_id,
            'can_spend', e.can_spend,
            'limit_minor', e.cap,
            'per_transaction_minor', e.per_tx,
            'period', e.period,
            'spent_minor', e.spent,
            'remaining_minor', CASE WHEN e.cap IS NULL THEN NULL ELSE GREATEST(e.cap - e.spent, 0) END,
            'used_fraction', CASE WHEN e.cap IS NULL OR e.cap <= 0 THEN 0
                ELSE LEAST(1, round(e.spent::numeric / e.cap, 4)) END
        ) ORDER BY e.rank DESC, e.joined_at), '[]'::jsonb)
        FROM (
            SELECT m.id AS member_id, m.user_id, org.fn_preset_rank(m.role) AS rank, m.joined_at,
                   CASE WHEN p.l ? 'can_spend' THEN (p.l->>'can_spend')::boolean
                        ELSE 'spend_funds' = ANY (org.fn_member_capabilities('business', p_business, m.user_id)) END
                       AS can_spend,
                   CASE WHEN p.l ? 'limit_minor' THEN NULLIF(p.l->>'limit_minor', '')::bigint ELSE sl.cap_cents END AS cap,
                   CASE WHEN p.l ? 'per_transaction_minor' THEN NULLIF(p.l->>'per_transaction_minor', '')::bigint
                        ELSE sl.per_transaction_cents END AS per_tx,
                   COALESCE(sl.period_interval, 'monthly') AS period,
                   CASE WHEN sl.id IS NULL THEN 0
                        WHEN sl.period_interval <> 'total' AND sl.resets_at IS NOT NULL AND sl.resets_at <= now() THEN 0
                        ELSE sl.spent_cents END AS spent
              FROM org.business_members m
              LEFT JOIN finance.spending_limits sl ON sl.wallet_id = p_wallet AND sl.member_user_id = m.user_id
              LEFT JOIN LATERAL (
                  SELECT x.l FROM jsonb_array_elements(
                      CASE WHEN jsonb_typeof(p_patch->'limits') = 'array' THEN p_patch->'limits' ELSE '[]'::jsonb END
                  ) x(l)
                   WHERE x.l->>'member_id' = m.id::text
                   LIMIT 1
              ) p ON true
             WHERE m.business_id = p_business AND m.status = 'active'
               AND (m.user_id = v_uid OR v_reads_all)
        ) e
    );
END;
$$;

COMMENT ON FUNCTION finance.fn_business_envelopes(uuid, uuid, jsonb) IS
'Every member''s spend envelope on one business wallet — can_spend, limit_minor, per_transaction_minor,
period, spent_minor (0 once the period rolled), remaining_minor, used_fraction — narrowed to the caller''s
own unless they read the wallet''s envelopes; a save_spend_policy patch''s limits applied on top. Read
by org.get_workspace_detail and finance.preview_spend_envelope. Internal.';

-- The envelopes a DRAFT spend policy would produce, so the editor never renders a draft ceiling
-- against the stored figures it is about to replace (BUSINESSES_AUDIT BD2). Same patch, same authority
-- (`manage_finances`) and the same validation of its limits as finance.save_spend_policy; writes
-- nothing — the wallet is looked up, never created (a currency with no wallet yet has spent nothing).
-- The rank rules (never your own row, the owner's, or someone you do not outrank) are the save's to
-- refuse: a preview only prices the draft.
CREATE OR REPLACE FUNCTION finance.preview_spend_envelope(p_business_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_currency text;
    v_exists boolean;
    v_wallet uuid;
    l jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'patch: expected an object';
    END IF;
    SELECT true, upper(COALESCE(NULLIF(p_patch->>'currency', ''), b.default_currency, 'USD'))
      INTO v_exists, v_currency
      FROM org.business_profiles b WHERE b.id = p_business_id;
    IF v_exists IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workspace: not found';
    END IF;
    IF NOT org.fn_member_can('business', p_business_id, 'manage_finances') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'policy: you cannot change this business''s spend policy';
    END IF;
    IF p_patch ? 'limits' THEN
        IF jsonb_typeof(p_patch->'limits') <> 'array' THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'limits: expected a list';
        END IF;
        FOR l IN SELECT * FROM jsonb_array_elements(p_patch->'limits') LOOP
            IF NOT EXISTS (SELECT 1 FROM org.business_members m
                            WHERE m.id::text = l->>'member_id' AND m.business_id = p_business_id AND m.status = 'active') THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'limits: every limit must belong to an active member';
            END IF;
            IF COALESCE(NULLIF(l->>'limit_minor', '')::bigint, 0) < 0
               OR COALESCE(NULLIF(l->>'per_transaction_minor', '')::bigint, 0) < 0 THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'limits: a limit cannot be negative';
            END IF;
        END LOOP;
    END IF;
    SELECT w.id INTO v_wallet FROM finance.wallets w
     WHERE w.owner_type = 'business' AND w.owner_id = p_business_id AND upper(w.currency) = v_currency;
    RETURN jsonb_build_object(
        'currency', v_currency,
        'limits', finance.fn_business_envelopes(p_business_id, v_wallet, p_patch)
    );
END;
$$;

COMMENT ON FUNCTION finance.preview_spend_envelope(uuid, jsonb) IS
'Read-only: the {currency, limits} a finance.save_spend_policy patch would produce (manage_finances; the
same limit validation), priced against the period''s real spend by finance.fn_business_envelopes. Backs
POST /api/workspace/spend/preview.';

-- Ask for approval of a spend the caller's envelope does not cover. Replaces the client INSERT policy
-- that let any member who could SEE a wallet file a request in any currency with any expiry: the
-- requester must hold `spend` on the wallet, the request must genuinely need approval (the SQL twin of
-- @projective/types/workspace `evaluateSpend` — over the per-transaction ceiling, over the remaining
-- cap, or at/above the threshold), and the currency and expiry are the server's. A request binds to
-- the one thing it approves (BUSINESSES_AUDIT §4.3): the ref is required, must name a row of the
-- wallet's business, and holds at most one open request — a pending one past its expiry is closed
-- first. Business wallets only: a team never holds `approve_spend` for anyone to decide with (BF44).
-- The expiry (7 days from filing) bounds the whole request — deciding and spending.
CREATE OR REPLACE FUNCTION finance.request_spend_approval(
    p_wallet uuid, p_amount bigint, p_reason text, p_ref_table text, p_ref_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_w finance.wallets;
    v_lim finance.spending_limits;
    v_reason text := btrim(COALESCE(p_reason, ''));
    v_needs boolean := false;
    v_threshold bigint;
    v_ref_ok boolean;
    v_id uuid;
    v_approver uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    SELECT * INTO v_w FROM finance.wallets WHERE id = p_wallet;
    IF NOT FOUND OR v_w.owner_type <> 'business' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'wallet: not found';
    END IF;
    IF NOT finance.fn_has_vault_capability(p_wallet, v_uid, 'spend'::finance.vault_capability) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'spend: you do not have permission to spend from this account';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'amountMinor: enter an amount';
    END IF;
    IF length(v_reason) < 1 OR length(v_reason) > 400 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reason: say what it is for, in up to 400 characters';
    END IF;
    IF p_ref_table IS NULL OR p_ref_id IS NULL
       OR p_ref_table NOT IN ('baskets', 'tickets', 'project_stages', 'revisions', 'invoices', 'transfers') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'refTable: say what the spend is for';
    END IF;

    -- The ref must be something this business could pay for from this wallet.
    v_ref_ok := CASE p_ref_table
        WHEN 'baskets' THEN EXISTS (
            SELECT 1 FROM finance.baskets b
             WHERE b.id = p_ref_id AND b.owner_type = 'business' AND b.owner_id = v_w.owner_id)
        WHEN 'tickets' THEN EXISTS (
            SELECT 1 FROM projects.tickets t JOIN projects.projects p ON p.id = t.project_id
             WHERE t.id = p_ref_id AND p.client_business_id = v_w.owner_id)
        WHEN 'project_stages' THEN EXISTS (
            SELECT 1 FROM projects.project_stages ps JOIN projects.projects p ON p.id = ps.project_id
             WHERE ps.id = p_ref_id AND p.client_business_id = v_w.owner_id)
        WHEN 'revisions' THEN EXISTS (
            SELECT 1 FROM projects.stage_revision_requests rv
              JOIN projects.project_stages ps ON ps.id = rv.project_stage_id
              JOIN projects.projects p ON p.id = ps.project_id
             WHERE rv.id = p_ref_id AND p.client_business_id = v_w.owner_id)
        WHEN 'invoices' THEN EXISTS (
            SELECT 1 FROM finance.invoices i WHERE i.id = p_ref_id AND i.issue_to_business_id = v_w.owner_id)
        WHEN 'transfers' THEN EXISTS (
            SELECT 1 FROM finance.wallets d WHERE d.id = p_ref_id AND d.id <> p_wallet)
        ELSE false
    END;
    IF NOT v_ref_ok THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'refId: that is not something this account pays for';
    END IF;

    SELECT * INTO v_lim FROM finance.spending_limits WHERE wallet_id = p_wallet AND member_user_id = v_uid;
    IF FOUND THEN
        v_needs := (v_lim.per_transaction_cents IS NOT NULL AND p_amount > v_lim.per_transaction_cents)
                OR (v_lim.cap_cents IS NOT NULL AND p_amount > v_lim.cap_cents - CASE
                        WHEN v_lim.period_interval <> 'total' AND v_lim.resets_at IS NOT NULL AND v_lim.resets_at <= now() THEN 0
                        ELSE v_lim.spent_cents END);
    END IF;
    v_threshold := finance.fn_business_threshold(p_wallet);
    v_needs := v_needs OR (v_threshold > 0 AND p_amount >= v_threshold);
    IF NOT v_needs THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'amountMinor: this spend is within your limits and needs no approval';
    END IF;

    UPDATE finance.spend_approvals
       SET status = 'expired'::finance.approval_status
     WHERE wallet_id = p_wallet AND ref_table = p_ref_table AND ref_id = p_ref_id
       AND status = 'pending'::finance.approval_status AND expires_at <= now();
    IF EXISTS (
        SELECT 1 FROM finance.spend_approvals
         WHERE wallet_id = p_wallet AND ref_table = p_ref_table AND ref_id = p_ref_id
           AND status = 'pending'::finance.approval_status
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'PC409', MESSAGE = 'refId: a request for this is already waiting for approval';
    END IF;

    BEGIN
        INSERT INTO finance.spend_approvals (wallet_id, requested_by, amount_cents, currency, reason, ref_table, ref_id, status, expires_at)
        VALUES (p_wallet, v_uid, p_amount, v_w.currency, v_reason, p_ref_table, p_ref_id, 'pending', now() + interval '7 days')
        RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'PC409', MESSAGE = 'refId: a request for this is already waiting for approval';
    END;

    FOR v_approver IN
        SELECT vp.member_user_id FROM finance.vault_permissions vp
         WHERE vp.wallet_id = p_wallet AND vp.member_user_id <> v_uid
           AND ('approve_spend'::finance.vault_capability = ANY (vp.capabilities)
                OR 'manage_members'::finance.vault_capability = ANY (vp.capabilities))
    LOOP
        PERFORM comms.fn_notify(
            v_approver, 'spend_approval.requested', 'A spend needs your approval', left(v_reason, 200),
            'spend_approvals', v_id, '{}'::jsonb, v_uid, v_w.owner_type, v_w.owner_id
        );
    END LOOP;
    RETURN jsonb_build_object('id', v_id, 'status', 'pending');
END;
$$;
-- #endregion

-- #region 14. The wallet ledger read — keyset pages and calendar buckets (Decision #150, 2026-10-06)
-- The `/wallet/transactions` ledger and the `/wallet/analytics` cash flow read through these functions
-- instead of pulling the most recent thousand lines into the web server and paging or summing them
-- there. All three are SECURITY INVOKER: `finance.transactions` answers only for wallets the caller may
-- view (`fn_can_view_wallet`), so a wallet id the caller cannot see contributes nothing rather than an
-- error, and every joined read below answers under the joined table's own policy — a search can only
-- ever match a name the caller could already read.

-- One page of a set of wallets' ledger, newest first, strictly older than the keyset position
-- `(p_after_at, p_after_id)` — the last line of the previous page. Keyset rather than offset: a line
-- written while the reader scrolls cannot move a page boundary, so nothing repeats or goes missing.
--
-- Filters (all optional, all ANDed): direction; a set of `reason` codes (the line-family selector,
-- mapped from families to codes by the application — `LEDGER_KIND_REASONS`); a half-open date range
-- `[p_from, p_to)`; and a text search. The search matches, case-insensitively and as a literal
-- substring (`%`, `_` and `\` in it are escaped), the project title or stage name an escrow line paid
-- for, either party of that escrow (a person's name or handle other than the caller, a team, or a
-- business's public face through `finance.get_purchase_owner`), an order's reference or line title —
-- plus two sets the application resolves from words the database cannot see: the reason codes whose
-- LABELS match (`p_search_reasons`, "escrow release") and the caller's own wallets whose owner name
-- matches (`p_search_wallets`, a transfer to "Atlas Labs"). Returns up to p_limit rows (1–201; the
-- application asks for one more than it shows, to learn whether another page exists).
CREATE OR REPLACE FUNCTION finance.list_ledger(
    p_wallet_ids uuid[],
    p_limit integer DEFAULT 41,
    p_after_at timestamptz DEFAULT NULL,
    p_after_id uuid DEFAULT NULL,
    p_direction text DEFAULT NULL,
    p_reasons text[] DEFAULT NULL,
    p_from timestamptz DEFAULT NULL,
    p_to timestamptz DEFAULT NULL,
    p_search text DEFAULT NULL,
    p_search_reasons text[] DEFAULT NULL,
    p_search_wallets uuid[] DEFAULT NULL
)
RETURNS SETOF finance.transactions
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT t.*
    FROM finance.transactions t
    CROSS JOIN LATERAL (
        SELECT CASE
            WHEN pg_catalog.btrim(COALESCE(p_search, '')) = '' THEN NULL
            ELSE '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
                pg_catalog.btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
        END AS pattern
    ) q
    WHERE t.wallet_id = ANY (p_wallet_ids)
      AND (p_direction IS NULL OR t.direction = p_direction)
      AND (p_reasons IS NULL OR t.reason = ANY (p_reasons))
      AND (p_from IS NULL OR t.created_at >= p_from)
      AND (p_to IS NULL OR t.created_at < p_to)
      AND (
          p_after_at IS NULL
          OR t.created_at < p_after_at
          OR (t.created_at = p_after_at AND p_after_id IS NOT NULL AND t.id < p_after_id)
      )
      AND (
          q.pattern IS NULL
          OR t.reason = ANY (COALESCE(p_search_reasons, '{}'::text[]))
          OR (t.ref_table = 'wallets' AND t.ref_id = ANY (COALESCE(p_search_wallets, '{}'::uuid[])))
          OR (t.ref_table = 'escrows' AND EXISTS (
              SELECT 1
              FROM finance.escrows e
              LEFT JOIN projects.project_stages s ON s.id = e.project_stage_id
              LEFT JOIN projects.projects p ON p.id = s.project_id
              WHERE e.id = t.ref_id
                AND (
                    p.title ILIKE q.pattern
                    OR s.name ILIKE q.pattern
                    OR EXISTS (
                        SELECT 1 FROM org.users_public u
                        WHERE u.user_id IN (e.payer_user_id, CASE WHEN e.payee_type = 'freelancer' THEN e.payee_id END)
                          AND u.user_id IS DISTINCT FROM auth.uid()
                          AND (u.username ILIKE q.pattern
                               OR pg_catalog.concat_ws(' ', u.first_name, u.last_name) ILIKE q.pattern)
                    )
                    OR (e.payee_type = 'team' AND EXISTS (
                        SELECT 1 FROM org.teams tm WHERE tm.id = e.payee_id AND tm.name ILIKE q.pattern
                    ))
                    OR (e.payer_business_id IS NOT NULL
                        AND (finance.get_purchase_owner('business', e.payer_business_id) ->> 'name') ILIKE q.pattern)
                )
          ))
          OR (t.ref_table = 'orders' AND EXISTS (
              SELECT 1 FROM finance.orders o WHERE o.id = t.ref_id AND o.reference ILIKE q.pattern
          ))
          OR (t.ref_table = 'order_lines' AND EXISTS (
              SELECT 1
              FROM finance.order_lines ol
              JOIN finance.orders o ON o.id = ol.order_id
              WHERE ol.id = t.ref_id AND (ol.title ILIKE q.pattern OR o.reference ILIKE q.pattern)
          ))
      )
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 41), 1), 201);
$$;

COMMENT ON FUNCTION finance.list_ledger(uuid[], integer, timestamptz, uuid, text, text[], timestamptz, timestamptz, text, text[], uuid[]) IS
'One keyset page of a set of wallets'' ledger as the CALLER may read it: newest first, strictly older
than (p_after_at, p_after_id), filtered by direction, reason codes, a half-open date range and a
literal-substring search over what the caller may read about each line. SECURITY INVOKER.';

-- Money in and out of a set of wallets, summed per CALENDAR bucket in the viewer's time zone:
-- `date_trunc(grain, created_at AT TIME ZONE tz)`, so a "5 Oct" bar holds exactly the movements of the
-- reader's own 5 October rather than a UTC day or an arbitrary 24-hour slice ending now. Grouped by
-- currency (the application converts each origin currency once), direction and reason (the application
-- folds reasons into line families), with the line count. `p_grain` is `day` · `week` (ISO, Monday) ·
-- `month`; anything else is `day`. `p_tz` must be an IANA zone name — the application validates it and
-- falls back to UTC, and an unknown name is an error here rather than a silent UTC.
CREATE OR REPLACE FUNCTION finance.ledger_flow(
    p_wallet_ids uuid[],
    p_from timestamptz DEFAULT NULL,
    p_to timestamptz DEFAULT NULL,
    p_tz text DEFAULT 'UTC',
    p_grain text DEFAULT 'day'
)
RETURNS TABLE (
    bucket date,
    currency text,
    direction text,
    reason text,
    total_cents bigint,
    line_count integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        pg_catalog.date_trunc(g.grain, t.created_at AT TIME ZONE g.tz)::date AS bucket,
        t.currency::text,
        t.direction,
        t.reason,
        pg_catalog.sum(t.amount_cents)::bigint AS total_cents,
        pg_catalog.count(*)::integer AS line_count
    FROM finance.transactions t
    CROSS JOIN LATERAL (
        SELECT
            CASE WHEN p_grain IN ('day', 'week', 'month') THEN p_grain ELSE 'day' END AS grain,
            COALESCE(NULLIF(pg_catalog.btrim(p_tz), ''), 'UTC') AS tz
    ) g
    WHERE t.wallet_id = ANY (p_wallet_ids)
      AND (p_from IS NULL OR t.created_at >= p_from)
      AND (p_to IS NULL OR t.created_at < p_to)
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2, 3, 4;
$$;

COMMENT ON FUNCTION finance.ledger_flow(uuid[], timestamptz, timestamptz, text, text) IS
'A set of wallets'' ledger summed per calendar bucket (day · ISO week · month) in the viewer''s time
zone, per currency, direction and reason, as the CALLER may read it. SECURITY INVOKER.';

-- The oldest movement of a set of wallets the caller may read — where an "all time" window starts.
CREATE OR REPLACE FUNCTION finance.ledger_first_at(p_wallet_ids uuid[])
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT pg_catalog.min(t.created_at) FROM finance.transactions t WHERE t.wallet_id = ANY (p_wallet_ids);
$$;

COMMENT ON FUNCTION finance.ledger_first_at(uuid[]) IS
'The earliest created_at among the given wallets'' ledger lines the caller may read; NULL when none.
SECURITY INVOKER.';
-- #endregion
