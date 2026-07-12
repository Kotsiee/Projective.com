-- =============================================================================
-- 0309_business_finance_overview.sql
-- US-008 · Business Administration & Financial Overview
--
-- Exposes the (otherwise hidden) `finance.*` ledger to the business admin dashboard through a small
-- set of SECURITY DEFINER read RPCs in the `org` schema (which IS in the PostgREST allow-list). The
-- dashboard reads live balances, transaction lines and escrow allocations straight from
-- finance.wallets / finance.transactions / finance.escrows — no seed data.
--
-- It also provisions every business wallet with a one-time opening platform credit so the internal
-- -wallet demo path is real: a business can fund a stage (debiting this credit → a live ledger
-- line) and watch escrow hold/release move the numbers. This "opening platform credit" is a
-- documented business rule (see documentation/business/brain.md · Internal Wallet).
-- =============================================================================

-- #region 1. Business wallet opening credit (provisioning)
-- Every business wallet is seeded once with a promotional platform credit so the internal-wallet
-- demo (fund → hold → release) has funds to move. Idempotent: only fires when the wallet has no
-- ledger history yet.
CREATE OR REPLACE FUNCTION finance.fn_seed_business_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public
AS $$
BEGIN
    IF NEW.owner_type = 'business'
       AND NOT EXISTS (SELECT 1 FROM finance.transactions WHERE wallet_id = NEW.id) THEN
        PERFORM finance.fn_wallet_credit(
            NEW.owner_id, 'business', NEW.currency, 2500000,
            'demo_opening_credit', NULL, NULL
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_business_wallet ON finance.wallets;
CREATE TRIGGER trg_seed_business_wallet
AFTER INSERT ON finance.wallets
FOR EACH ROW EXECUTE FUNCTION finance.fn_seed_business_wallet();

-- Backfill: ensure a wallet exists for every business (the INSERT fires the trigger → opening
-- credit), then seed any pre-existing zero-history business wallets.
INSERT INTO finance.wallets (owner_type, owner_id, currency, balance_cents)
SELECT 'business', bp.id, COALESCE(bp.default_currency, 'USD'), 0
FROM org.business_profiles bp
WHERE NOT EXISTS (
    SELECT 1 FROM finance.wallets w WHERE w.owner_type = 'business' AND w.owner_id = bp.id
)
ON CONFLICT (owner_type, owner_id, currency) DO NOTHING;

DO $$
DECLARE
    w record;
BEGIN
    FOR w IN
        SELECT id, owner_id, currency FROM finance.wallets WHERE owner_type = 'business'
    LOOP
        IF NOT EXISTS (SELECT 1 FROM finance.transactions WHERE wallet_id = w.id) THEN
            PERFORM finance.fn_wallet_credit(
                w.owner_id, 'business', w.currency, 2500000,
                'demo_opening_credit', NULL, NULL
            );
        END IF;
    END LOOP;
END $$;
-- #endregion

-- #region 2. org.get_business_finance — live balances + ledger + escrow allocations
CREATE OR REPLACE FUNCTION org.get_business_finance(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = org, finance, projects, public
AS $$
DECLARE
    v_wallet_id     uuid;
    v_currency      text;
    v_balance       bigint;
    v_transactions  jsonb;
    v_escrows       jsonb;
    v_in_escrow     bigint;
    v_pending       bigint;
    v_lifetime      bigint;
BEGIN
    IF NOT org.is_active_business_member(p_business_id) THEN
        RAISE EXCEPTION 'Not authorised for this business' USING ERRCODE = '42501';
    END IF;

    -- Resolve the business wallet (prefer the default-currency one); ensure it exists.
    v_currency := COALESCE((SELECT default_currency FROM org.business_profiles WHERE id = p_business_id), 'USD');

    SELECT id, balance_cents, currency INTO v_wallet_id, v_balance, v_currency
    FROM finance.wallets
    WHERE owner_type = 'business' AND owner_id = p_business_id
    ORDER BY (currency = v_currency) DESC, created_at ASC
    LIMIT 1;

    IF v_wallet_id IS NULL THEN
        INSERT INTO finance.wallets (owner_type, owner_id, currency, balance_cents)
        VALUES ('business', p_business_id, v_currency, 0)
        ON CONFLICT (owner_type, owner_id, currency) DO NOTHING;
        SELECT id, balance_cents INTO v_wallet_id, v_balance
        FROM finance.wallets
        WHERE owner_type = 'business' AND owner_id = p_business_id AND currency = v_currency;
    END IF;

    -- Capital committed to live escrows + funds locked in dispute.
    SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('funded', 'held')), 0),
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'disputed'), 0)
    INTO v_in_escrow, v_pending
    FROM finance.escrows
    WHERE payer_business_id = p_business_id;

    -- Lifetime gross outflow (everything this business has ever spent).
    SELECT COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'debit'), 0)
    INTO v_lifetime
    FROM finance.transactions
    WHERE wallet_id = v_wallet_id;

    -- Transaction lines (newest 100), shaped to the TransactionLedgerItem view-model.
    SELECT COALESCE(jsonb_agg(s.tx ORDER BY s.tx_created DESC), '[]'::jsonb)
    INTO v_transactions
    FROM (
        SELECT
            t.created_at AS tx_created,
            jsonb_build_object(
                'id', t.id,
                'date', t.created_at,
                'kind', CASE t.reason
                    WHEN 'escrow_hold' THEN 'escrow_hold'
                    WHEN 'fair_exit_refund' THEN 'refund'
                    WHEN 'demo_opening_credit' THEN 'topup'
                    ELSE CASE WHEN t.direction = 'credit' THEN 'topup' ELSE 'withdrawal' END
                END,
                'direction', t.direction,
                'description', CASE t.reason
                    WHEN 'escrow_hold' THEN 'Escrow funded' || COALESCE(' · ' || ctx.stage_name, '')
                    WHEN 'fair_exit_refund' THEN 'Stage cancellation refund'
                    WHEN 'demo_opening_credit' THEN 'Opening platform credit'
                    ELSE initcap(replace(t.reason, '_', ' '))
                END,
                'counterparty', COALESCE(ctx.payee_name, 'Projective'),
                'reference', COALESCE(left(t.ref_id::text, 8), ''),
                'project_label', ctx.project_title,
                'gross_cents', t.amount_cents,
                'fee_cents', 0,
                'net_cents', CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END,
                'balance_after_cents', t.balance_after_cents,
                'currency', t.currency,
                'status', CASE t.reason WHEN 'escrow_hold' THEN 'held' ELSE 'settled' END,
                'is_fee_line', false
            ) AS tx
        FROM finance.transactions t
        LEFT JOIN LATERAL (
            SELECT
                ps.name AS stage_name,
                p.title AS project_title,
                CASE es.payee_type
                    WHEN 'freelancer' THEN (
                        SELECT COALESCE(NULLIF(TRIM(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), ''), up.username)
                        FROM org.users_public up WHERE up.user_id = es.payee_id
                    )
                    WHEN 'team' THEN (SELECT tm.name FROM org.teams tm WHERE tm.id = es.payee_id)
                END AS payee_name
            FROM finance.escrows es
            JOIN projects.project_stages ps ON ps.id = es.project_stage_id
            JOIN projects.projects p ON p.id = ps.project_id
            WHERE t.ref_table = 'escrows' AND es.id = t.ref_id
        ) ctx ON TRUE
        WHERE t.wallet_id = v_wallet_id
        ORDER BY t.created_at DESC
        LIMIT 100
    ) s;

    -- Live escrow allocations (funds committed against stages), shaped to EscrowAllocation.
    SELECT COALESCE(jsonb_agg(a.alloc ORDER BY a.created_at DESC), '[]'::jsonb)
    INTO v_escrows
    FROM (
        SELECT
            e.created_at,
            jsonb_build_object(
                'id', e.id,
                'project_label', p.title,
                'stage_label', ps.name,
                'status', e.status,
                'amount_cents', e.amount_cents,
                'platform_fee_cents', e.platform_fee_cents,
                'release_at', e.created_at,
                'progress_pct', CASE e.status
                    WHEN 'funded' THEN 15
                    WHEN 'held' THEN 55
                    WHEN 'disputed' THEN 55
                    WHEN 'released' THEN 100
                    ELSE 0
                END,
                'payee_name', COALESCE(
                    CASE e.payee_type
                        WHEN 'freelancer' THEN (
                            SELECT COALESCE(NULLIF(TRIM(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), ''), up.username)
                            FROM org.users_public up WHERE up.user_id = e.payee_id
                        )
                        WHEN 'team' THEN (SELECT tm.name FROM org.teams tm WHERE tm.id = e.payee_id)
                    END, 'Unassigned'),
                'currency', e.currency
            ) AS alloc
        FROM finance.escrows e
        JOIN projects.project_stages ps ON ps.id = e.project_stage_id
        JOIN projects.projects p ON p.id = ps.project_id
        WHERE e.payer_business_id = p_business_id
          AND e.status IN ('funded', 'held', 'disputed')
        ORDER BY e.created_at DESC
        LIMIT 40
    ) a;

    RETURN jsonb_build_object(
        'currency', v_currency,
        'balances', jsonb_build_object(
            'available_cents', COALESCE(v_balance, 0),
            'in_escrow_cents', v_in_escrow,
            'pending_cents', v_pending,
            'lifetime_cents', v_lifetime,
            'currency', v_currency
        ),
        'transactions', v_transactions,
        'escrows', v_escrows,
        'stats', jsonb_build_object(
            'active_project_count', COALESCE((SELECT active_project_count FROM org.business_profiles WHERE id = p_business_id), 0),
            'total_project_count', COALESCE((SELECT total_project_count FROM org.business_profiles WHERE id = p_business_id), 0),
            'member_count', (SELECT COUNT(*) FROM org.business_members WHERE business_id = p_business_id AND status = 'active'),
            'active_escrow_count', (SELECT COUNT(*) FROM finance.escrows WHERE payer_business_id = p_business_id AND status IN ('funded', 'held'))
        )
    );
END;
$$;
-- #endregion

-- #region 3. org.get_business_members — roster with roles + seat state (AC5)
CREATE OR REPLACE FUNCTION org.get_business_members(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = org, public
AS $$
DECLARE
    v_members jsonb;
BEGIN
    IF NOT org.is_active_business_member(p_business_id) THEN
        RAISE EXCEPTION 'Not authorised for this business' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(m ORDER BY m_rank, m_joined ASC), '[]'::jsonb)
    INTO v_members
    FROM (
        SELECT
            bm.joined_at AS m_joined,
            CASE bm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END AS m_rank,
            jsonb_build_object(
                'user_id', bm.user_id,
                'name', COALESCE(NULLIF(TRIM(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), ''), up.username, 'Member'),
                'username', up.username,
                'avatar_file_id', up.avatar_file_id,
                'role', bm.role,
                'status', bm.status,
                'joined_at', bm.joined_at,
                'is_owner', (bp.owner_user_id = bm.user_id)
            ) AS m
        FROM org.business_members bm
        JOIN org.business_profiles bp ON bp.id = bm.business_id
        LEFT JOIN org.users_public up ON up.user_id = bm.user_id
        WHERE bm.business_id = p_business_id
    ) src;

    RETURN v_members;
END;
$$;
-- #endregion

-- #region 4. org.get_business_admin_profile — settings-form prefill (AC2)
CREATE OR REPLACE FUNCTION org.get_business_admin_profile(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = org, public
AS $$
DECLARE
    v_profile jsonb;
BEGIN
    IF NOT org.is_active_business_member(p_business_id) THEN
        RAISE EXCEPTION 'Not authorised for this business' USING ERRCODE = '42501';
    END IF;

    SELECT jsonb_build_object(
        'id', bp.id,
        'name', bp.name,
        'slug', bp.slug,
        'legal_name', bp.legal_name,
        'billing_email', bp.billing_email,
        'default_currency', bp.default_currency,
        'logo_file_id', bp.logo_file_id,
        'can_manage', (bp.owner_user_id = auth.uid() OR EXISTS (
            SELECT 1 FROM org.business_members bm
            WHERE bm.business_id = bp.id AND bm.user_id = auth.uid()
              AND bm.status = 'active' AND bm.role IN ('owner', 'admin')
        ))
    )
    INTO v_profile
    FROM org.business_profiles bp
    WHERE bp.id = p_business_id;

    RETURN v_profile;
END;
$$;
-- #endregion

-- #region 5. org.update_business — legal name / billing email / logo (AC2)
CREATE OR REPLACE FUNCTION org.update_business(p_business_id uuid, payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = org, security, public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_can_manage boolean;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    SELECT (bp.owner_user_id = v_user_id OR EXISTS (
        SELECT 1 FROM org.business_members bm
        WHERE bm.business_id = bp.id AND bm.user_id = v_user_id
          AND bm.status = 'active' AND bm.role IN ('owner', 'admin')
    ))
    INTO v_can_manage
    FROM org.business_profiles bp
    WHERE bp.id = p_business_id;

    IF v_can_manage IS NULL THEN
        RAISE EXCEPTION 'Business not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT v_can_manage THEN
        RAISE EXCEPTION 'Only owners or admins can update business settings' USING ERRCODE = '42501';
    END IF;

    UPDATE org.business_profiles SET
        name          = COALESCE(NULLIF(payload->>'name', ''), name),
        legal_name    = CASE WHEN payload ? 'legal_name' THEN payload->>'legal_name' ELSE legal_name END,
        billing_email = COALESCE(NULLIF(payload->>'billing_email', ''), billing_email),
        logo_file_id  = CASE WHEN payload ? 'logo_file_id' THEN NULLIF(payload->>'logo_file_id', '')::uuid ELSE logo_file_id END,
        updated_at    = now()
    WHERE id = p_business_id;

    -- AC6-style immutable audit trail (audit_logs is definer-only).
    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata, actor_profile_id)
    VALUES (
        v_user_id, 'business.updated', 'org.business_profiles', p_business_id,
        jsonb_build_object('fields', to_jsonb(ARRAY(SELECT jsonb_object_keys(payload)))), p_business_id
    );

    RETURN jsonb_build_object(
        'id', p_business_id,
        'name', (SELECT name FROM org.business_profiles WHERE id = p_business_id),
        'legal_name', (SELECT legal_name FROM org.business_profiles WHERE id = p_business_id),
        'billing_email', (SELECT billing_email FROM org.business_profiles WHERE id = p_business_id),
        'logo_file_id', (SELECT logo_file_id FROM org.business_profiles WHERE id = p_business_id)
    );
END;
$$;
-- #endregion

-- #region 6. Grants — expose the read/update RPCs to authenticated callers.
GRANT EXECUTE ON FUNCTION org.get_business_finance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION org.get_business_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION org.get_business_admin_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION org.update_business(uuid, jsonb) TO authenticated;
-- #endregion
