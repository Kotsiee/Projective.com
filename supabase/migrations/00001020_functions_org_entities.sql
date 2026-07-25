-- ============================================================================
-- 00001020 functions org entities
-- Consolidated verbatim from: 0109_is_active_team_member.sql, 0111_business_helpers.sql, 0307_stage_staffing.sql, 0309_business_finance_overview.sql, 0313_freelancer_conversion.sql, 0314_organisations.sql, 20260709120000_business_teams_overhaul.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION org.is_active_team_member(_team_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = org, public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM org.team_members 
    WHERE team_id = _team_id 
    AND user_id = auth.uid() 
    AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION org.is_active_business_member(_business_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = org, public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM org.business_members 
    WHERE business_id = _business_id 
    AND user_id = auth.uid() 
    AND status = 'active'
  );
$$;

-- #endregion

-- #region 2. org.is_team_lead — AC3 team-application authority
-- A "team lead" is an active member holding an authority role (owner / lead / admin). Only a lead may
-- submit or bind the team to work. Guarded by auth.uid() to mirror org.is_active_team_member (0109).
CREATE OR REPLACE FUNCTION org.is_team_lead(_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, org, auth
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM org.teams t
        WHERE t.id = _team_id AND t.owner_user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1
        FROM org.team_members tm
        WHERE tm.team_id = _team_id
            AND tm.user_id = auth.uid()
            AND tm.status = 'active'
            AND tm.role IN ('owner', 'lead', 'admin')
    );
$$;

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

-- Post-onboarding persona expansion — "Become a Partner" (client/operator → freelancer)
--
-- US-001 provisions a freelancer profile only at signup (when objective = freelancer/seller,
-- see public.provision_user_profile in 0304). A user who onboarded as a client/operator had no
-- way to unlock a freelancer profile later. This RPC is that path: it is the mutation behind the
-- "Become a Partner" / "Unlock Freelancer Suite" CTAs on the /become-partner conversion page.
--
-- It is idempotent and self-serve (granted to `authenticated`, keyed off auth.uid()). Like the
-- onboarding provisioning it must run in a SECURITY DEFINER context because it writes
-- security.audit_logs, which is not granted to `authenticated` (see 0205 / 0304).

-- #region enable_freelancer_profile RPC
CREATE OR REPLACE FUNCTION org.enable_freelancer_profile(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, org, security, auth
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_skills text[];
    v_created boolean := false;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    -- Must be a fully-onboarded user (owns a public profile) before adding a persona.
    IF NOT EXISTS (SELECT 1 FROM org.users_public WHERE user_id = v_uid) THEN
        RAISE EXCEPTION 'Complete onboarding before unlocking a freelancer profile'
            USING ERRCODE = '42501';
    END IF;

    -- Optional starter skills carried from the CTA (mirrors provision_user_profile's contract).
    IF p_payload ? 'skills' AND jsonb_typeof(p_payload->'skills') = 'array' THEN
        SELECT ARRAY(SELECT jsonb_array_elements_text(p_payload->'skills')) INTO v_skills;
    ELSE
        v_skills := '{}'::text[];
    END IF;

    -- 1. Link the freelancer profile record to the account (idempotent — freelancer_profiles is
    --    keyed by user_id). FOUND is true only when a row was actually inserted (not on conflict).
    INSERT INTO org.freelancer_profiles (user_id, skills)
    VALUES (v_uid, v_skills)
    ON CONFLICT (user_id) DO NOTHING;
    v_created := FOUND;

    -- 2. Flip the denormalised persona flag consumed by getMe + the nav gates.
    UPDATE org.users_public
       SET is_freelancer = true, updated_at = now()
     WHERE user_id = v_uid;

    -- 3. Activate the freelancer persona immediately so the suite unlocks without a manual switch.
    --    Freelancer profiles are keyed by user_id, so the active profile id is the user id. Any
    --    active team context is left untouched.
    INSERT INTO security.session_context (
        user_id, active_profile_type, active_profile_id, updated_at
    ) VALUES (
        v_uid, 'freelancer', v_uid, now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
        active_profile_type = 'freelancer',
        active_profile_id = v_uid,
        updated_at = now();

    -- 4. Audit a genuine conversion only (definer context — audit_logs isn't granted to authenticated).
    IF v_created THEN
        INSERT INTO security.audit_logs (
            user_id, action, entity_table, entity_id, metadata, actor_profile_id
        ) VALUES (
            v_uid,
            'freelancer.unlocked',
            'org.freelancer_profiles',
            v_uid,
            jsonb_build_object(
                'source', 'become_partner',
                'skills_count', COALESCE(array_length(v_skills, 1), 0)
            ),
            v_uid
        );
    END IF;

    RETURN jsonb_build_object(
        'freelancer_profile_id', v_uid,
        'created', v_created,
        'is_freelancer', true
    );
END;
$$;

-- #endregion

-- #region Membership helper (SECURITY DEFINER — bypasses RLS so the policies below can't recurse)
CREATE OR REPLACE FUNCTION org.is_organisation_member(
    p_org uuid,
    p_min_role org.organisation_role DEFAULT 'member'
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = org, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM org.organisation_members m
        WHERE m.organisation_id = p_org
          AND m.user_id = auth.uid ()
          AND m.status = 'active'
          AND (
              p_min_role = 'member'
              OR (p_min_role = 'admin' AND m.role IN ('admin', 'owner'))
              OR (p_min_role = 'owner' AND m.role = 'owner')
          )
    );
$$;

-- Toggle helper so the flag is switchable at runtime (settings / testing).
CREATE OR REPLACE FUNCTION org.set_operator_mode(p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, org, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE org.users_public SET is_operator = p_enabled, updated_at = now()
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object('is_operator', p_enabled);
END;
$$;

-- #endregion

-- #region 3. Minimal create_business RPC (name + slug only)
CREATE OR REPLACE FUNCTION org.create_business(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, org, finance, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_new_business_id uuid;
  v_slug text;
  v_status text := COALESCE(NULLIF(payload->>'status', ''), 'draft');
  v_currency text := COALESCE(NULLIF(payload->>'default_currency', ''), 'USD');
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_slug := payload->>'slug';
  IF v_slug IS NULL OR length(v_slug) < 3 THEN RAISE EXCEPTION 'A valid handle is required'; END IF;
  IF EXISTS (SELECT 1 FROM org.business_profiles WHERE slug = v_slug) THEN
    RAISE EXCEPTION 'Business handle already taken' USING ERRCODE = '23505';
  END IF;

  -- Only name + slug are mandatory; all extended metadata is optional and can be
  -- filled in later on the (locked) settings page.
  INSERT INTO org.business_profiles (
    owner_user_id, name, slug, status, headline, bio,
    logo_file_id, banner_file_id, legal_name, billing_email,
    country, address_line_1, address_city, address_zip, tax_id, default_currency
  ) VALUES (
    v_user_id,
    payload->>'name',
    v_slug,
    v_status,
    COALESCE(payload->>'headline', ''),
    COALESCE(payload->'description', '{}'::jsonb),
    NULLIF(payload->>'logo_file_id', '')::uuid,
    NULLIF(payload->>'banner_file_id', '')::uuid,
    NULLIF(payload->>'legal_name', ''),
    NULLIF(payload->>'billing_email', ''),
    NULLIF(payload->>'country', ''),
    NULLIF(payload->>'address_line_1', ''),
    NULLIF(payload->>'address_city', ''),
    NULLIF(payload->>'address_zip', ''),
    NULLIF(payload->>'tax_id', ''),
    v_currency
  ) RETURNING id INTO v_new_business_id;

  INSERT INTO org.business_members (business_id, user_id, role, status)
  VALUES (v_new_business_id, v_user_id, 'owner', 'active');

  -- AC5: initialise the Business Wallet in the finance schema.
  INSERT INTO finance.wallets (owner_type, owner_id, currency, balance_cents)
  VALUES ('business', v_new_business_id, v_currency, 0);

  UPDATE org.users_public SET has_business = true WHERE user_id = v_user_id;

  INSERT INTO security.session_context (user_id, active_profile_type, active_profile_id, active_team_id, updated_at)
  VALUES (v_user_id, 'business', v_new_business_id, NULL, NOW())
  ON CONFLICT (user_id) DO UPDATE SET active_profile_type = 'business', active_profile_id = v_new_business_id, active_team_id = NULL, updated_at = NOW();

  -- AC6: immutable audit trail (SECURITY DEFINER only).
  INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata, actor_profile_id)
  VALUES (
    v_user_id, 'business.created', 'org.business_profiles', v_new_business_id,
    jsonb_build_object('slug', v_slug, 'name', payload->>'name', 'status', v_status),
    v_new_business_id
  );

  RETURN jsonb_build_object('business_id', v_new_business_id, 'slug', v_slug, 'status', v_status);
END;
$$;

-- #endregion

-- #region 4. Minimal create_team RPC (name + slug only)
CREATE OR REPLACE FUNCTION org.create_team(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = org, public
AS $$
DECLARE
  new_team_id uuid;
  new_team_slug text;
  invite_record jsonb;
  v_owner_id uuid;
  v_currency text;
  v_wallet_id uuid;
  v_status text := COALESCE(NULLIF(payload->>'status', ''), 'draft');
BEGIN
  new_team_id := COALESCE((payload->>'id')::uuid, gen_random_uuid());
  v_owner_id := COALESCE((payload->>'owner_id')::uuid, auth.uid());
  v_currency := COALESCE(NULLIF(payload->>'currency', ''), 'USD');

  IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF payload->>'slug' IS NULL OR length(payload->>'slug') < 3 THEN
    RAISE EXCEPTION 'A valid handle is required';
  END IF;

  INSERT INTO org.teams (
    id, owner_user_id, name, slug, status, headline, bio,
    avatar_file_id, banner_file_id, visibility, payout_model, default_payout_settings
  ) VALUES (
    new_team_id,
    v_owner_id,
    payload->>'name',
    payload->>'slug',
    v_status,
    COALESCE(payload->>'headline', ''),
    COALESCE(payload->'description', '{}'::jsonb),
    NULLIF(payload->>'avatar_file_id', '')::uuid,
    NULLIF(payload->>'banner_file_id', '')::uuid,
    COALESCE(NULLIF(payload->>'visibility', ''), 'invite_only'),
    COALESCE(NULLIF(payload->>'payout_model', ''), 'manager_discretion'),
    COALESCE(payload->'default_payout_settings', '{}'::jsonb)
  ) RETURNING id, slug INTO new_team_id, new_team_slug;

  INSERT INTO org.team_members (team_id, user_id, role, status)
  VALUES (new_team_id, v_owner_id, 'owner', 'active');

  -- AC5: initialise the Team Vault (finance.wallets) and link it as treasury.
  INSERT INTO finance.wallets (owner_type, owner_id, currency, balance_cents)
  VALUES ('team', new_team_id, v_currency, 0)
  RETURNING id INTO v_wallet_id;

  UPDATE org.teams SET treasury_wallet_id = v_wallet_id WHERE id = new_team_id;

  UPDATE org.users_public SET has_team = true WHERE user_id = v_owner_id;

  IF payload ? 'invites' AND jsonb_array_length(payload->'invites') > 0 THEN
    FOR invite_record IN SELECT * FROM jsonb_array_elements(payload->'invites')
    LOOP
      INSERT INTO org.org_invitations (inviter_user_id, target_email, team_id, token, status)
      VALUES (v_owner_id, invite_record->>'email', new_team_id, encode(gen_random_bytes(32), 'hex'), 'pending');
    END LOOP;
  END IF;

  -- AC6: immutable audit trail (SECURITY DEFINER only).
  INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata, actor_team_id)
  VALUES (
    v_owner_id, 'team.created', 'org.teams', new_team_id,
    jsonb_build_object('slug', new_team_slug, 'name', payload->>'name', 'status', v_status),
    new_team_id
  );

  RETURN jsonb_build_object('team_id', new_team_id, 'team_slug', new_team_slug, 'status', v_status);

EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Team handle already exists' USING ERRCODE = '23505';
END;
$$;

CREATE OR REPLACE FUNCTION org.get_dashboard_businesses(p_search_query text, p_sort_by text, p_sort_dir text, p_limit int, p_offset int)
RETURNS TABLE (
  id uuid, owner_user_id uuid, name text, slug text, logo jsonb, country text,
  default_currency text, status text, tier text, created_at timestamptz, total_count bigint
) LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH user_businesses AS (
    SELECT bp.id, bp.owner_user_id, bp.name, bp.slug, bp.logo_file_id, bp.country,
           bp.default_currency, bp.status, bp.plan, bp.created_at
    FROM org.business_profiles bp JOIN org.business_members bm ON bm.business_id = bp.id
    WHERE bm.user_id = auth.uid() AND bm.status = 'active'
      AND (p_search_query = '' OR bp.name ILIKE '%' || p_search_query || '%' OR bp.slug ILIKE '%' || p_search_query || '%')
  )
  SELECT ub.id, ub.owner_user_id, ub.name, ub.slug,
         (SELECT metadata->'variants' FROM files.items WHERE id = ub.logo_file_id) as logo,
         ub.country, ub.default_currency, ub.status, ub.plan as tier,
         ub.created_at, COUNT(*) OVER()::bigint as total_count
  FROM user_businesses ub
  ORDER BY
    CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'asc' THEN ub.created_at END ASC,
    CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'desc' THEN ub.created_at END DESC,
    CASE WHEN p_sort_by = 'name' AND p_sort_dir = 'asc' THEN ub.name END ASC,
    CASE WHEN p_sort_by = 'name' AND p_sort_dir = 'desc' THEN ub.name END DESC,
    ub.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION org.get_dashboard_teams(
  p_search_query text, p_role_filter text, p_sort_by text, p_sort_dir text, p_limit int, p_offset int
)
RETURNS TABLE (
  team_id uuid, name text, slug text, avatar_url text, banner_url text, description text,
  user_role text, member_count bigint, payout_model text, status text, tier text,
  created_at timestamptz, updated_at timestamptz, total_count bigint
)
LANGUAGE plpgsql SECURITY INVOKER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  RETURN QUERY
  WITH user_teams AS (
    SELECT
      t.id, t.name, t.slug, t.avatar_file_id, t.banner_file_id, t.bio,
      t.payout_model, t.status, t.subscription_tier, t.created_at, t.updated_at,
      tm.role as user_role,
      (SELECT COUNT(*) FROM org.team_members m WHERE m.team_id = t.id AND m.status = 'active') as member_count
    FROM org.teams t
    JOIN org.team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = v_user_id AND tm.status = 'active'
      AND (
        p_role_filter = 'all'
        OR (p_role_filter = 'owner' AND tm.role = 'owner')
        OR (p_role_filter = 'admin' AND tm.role = 'admin')
        OR (p_role_filter = 'member' AND tm.role != 'owner')
      )
      AND (p_search_query = '' OR t.name ILIKE '%' || p_search_query || '%' OR t.slug ILIKE '%' || p_search_query || '%')
  )
  SELECT
    ut.id as team_id, ut.name, ut.slug,
    NULL::text as avatar_url, NULL::text as banner_url,
    ut.bio::text as description,
    ut.user_role, ut.member_count, ut.payout_model, ut.status, ut.subscription_tier as tier,
    ut.created_at, ut.updated_at,
    COUNT(*) OVER() as total_count
  FROM user_teams ut
  ORDER BY
    CASE WHEN p_sort_by = 'name' AND p_sort_dir = 'asc' THEN ut.name END ASC,
    CASE WHEN p_sort_by = 'name' AND p_sort_dir = 'desc' THEN ut.name END DESC,
    CASE WHEN p_sort_by = 'member_count' AND p_sort_dir = 'asc' THEN ut.member_count END ASC,
    CASE WHEN p_sort_by = 'member_count' AND p_sort_dir = 'desc' THEN ut.member_count END DESC,
    CASE WHEN p_sort_by = 'last_updated' AND p_sort_dir = 'asc' THEN ut.updated_at END ASC,
    CASE WHEN p_sort_by = 'last_updated' AND p_sort_dir = 'desc' THEN ut.updated_at END DESC,
    ut.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
