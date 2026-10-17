-- =============================================================================================
-- Probe: a business's vault agrees with its modules (BB6 — BUSINESSES_AUDIT BF25, BF29, BF30,
-- BF39; Decision #230 (d), (d.1)).
--
--   1. A card top-up of the business wallet reaches the contribution ledger (`add_funds`, the payer,
--      what arrived) — the very read live-money.ts makes, as the payer.
--   2. A plain member reads only their own spend envelope and requests; an approver, the policy
--      editor and the owner read all of the wallet's.
--   3. business_roles answers a platform admin who is not a member (parity with the roster).
--   4. The owner-reserved rights: only the owner grants or takes them, the billing right goes only to
--      an admin seat and only with the typed CONFIRM, the co-owner set projects onto the vault, a
--      holder may give a grant up, nobody passes one on, no role carries one, and an ownership
--      transfer clears them all.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/business_vault_alignment.sql
--
-- Fixture (seeded, adjusted inside the transaction): business B `heliafinance` — owner O
-- `priyaraman`, admin H `hannahcole`. Seated here: M `theo` (member preset), A `noor` (a custom
-- approve-only role), X `marisdelacroix` (admin preset). P `lenamueller` is made a platform admin.
-- The Business Pro gates are switched off inside the transaction, so B's free plan refuses nothing.
-- A clean run prints only PASS.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_b uuid;
    v_wallet uuid;
    v_member_role uuid;
    v_admin_role uuid;
    v_approver_role uuid;
BEGIN
    SELECT id INTO STRICT v_b FROM org.business_profiles WHERE slug = 'heliafinance';
    SELECT id INTO STRICT v_wallet FROM finance.wallets
     WHERE owner_type = 'business' AND owner_id = v_b ORDER BY created_at LIMIT 1;
    SELECT id INTO STRICT v_member_role FROM org.business_roles WHERE business_id = v_b AND preset = 'member';
    SELECT id INTO STRICT v_admin_role FROM org.business_roles WHERE business_id = v_b AND preset = 'admin';
    INSERT INTO org.business_roles (business_id, name, summary, preset, base_preset, capabilities)
    VALUES (v_b, 'Probe approver', 'Approves spend, nothing else.', NULL, 'member', ARRAY['approve_spend']::org.workspace_capability[])
    RETURNING id INTO v_approver_role;

    INSERT INTO org.business_members (business_id, user_id, role_id, status)
    SELECT v_b, u.user_id, r.role_id, 'active'
      FROM (VALUES ('theo', v_member_role), ('noor', v_approver_role), ('marisdelacroix', v_admin_role)) AS r(username, role_id)
      JOIN org.users_public u ON u.username = r.username;
    INSERT INTO ops.admin_users (user_id)
    SELECT user_id FROM org.users_public WHERE username = 'lenamueller';
    -- The roster moves below are about reserved rights, not the plan: the Business Pro gates
    -- (business_plan_gates_enforced, Decision #230 (e)) are switched off for this transaction only.
    UPDATE security.platform_params SET value = 'false'::jsonb WHERE key = 'business_plan_gates_enforced';

    PERFORM set_config('probe.b', v_b::text, true);
    PERFORM set_config('probe.wallet', v_wallet::text, true);
    PERFORM set_config('probe.member_role', v_member_role::text, true);
    PERFORM set_config('probe.admin_role', v_admin_role::text, true);
END $$;

-- The user id of a seeded username.
CREATE FUNCTION pg_temp.uid(p_username text) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT user_id FROM org.users_public WHERE username = p_username;
$$;
-- A member's seat id on B.
CREATE FUNCTION pg_temp.seat(p_username text) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT m.id FROM org.business_members m
     WHERE m.business_id = current_setting('probe.b')::uuid AND m.user_id = pg_temp.uid(p_username) AND m.status = 'active';
$$;
-- Act as a user for the definer RPCs (auth.uid() reads this claim).
CREATE FUNCTION pg_temp.act(p_username text) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claim.sub', pg_temp.uid(p_username)::text, true);
$$;
-- A member's effective workspace capabilities and their vault projection on B's wallet.
CREATE FUNCTION pg_temp.caps(p_username text) RETURNS org.workspace_capability[] LANGUAGE sql STABLE AS $$
    SELECT org.fn_member_capabilities('business', current_setting('probe.b')::uuid, pg_temp.uid(p_username));
$$;
CREATE FUNCTION pg_temp.vault(p_username text) RETURNS finance.vault_capability[] LANGUAGE sql STABLE AS $$
    SELECT capabilities FROM finance.vault_permissions
     WHERE wallet_id = current_setting('probe.wallet')::uuid AND member_user_id = pg_temp.uid(p_username);
$$;
-- Run a member patch as p_actor and return the refusal's SQLSTATE + message ('ok' when it went through).
CREATE FUNCTION pg_temp.patch(p_actor text, p_target text, p_patch jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_actor);
    PERFORM org.update_workspace_member('business', pg_temp.seat(p_target), p_patch);
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END;
$$;
CREATE FUNCTION pg_temp.expect(p_label text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL %: %', p_label, COALESCE(p_detail, '(no detail)');
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END;
$$;
-- What each reader saw under RLS (the role switches below cannot reach pg_temp's functions).
CREATE TEMP TABLE probe_reads (who text, limits integer, own_limits integer, approvals integer, own_approvals integer);
GRANT ALL ON probe_reads TO authenticated;
-- #endregion

-- #region 1. A card top-up appears in the contribution ledger
DO $$
DECLARE
    v_pay uuid;
    v_out jsonb;
    v_row finance.ledger_audit;
BEGIN
    INSERT INTO finance.inbound_payments (
        purpose, wallet_id, amount_cents, currency, status, lock_status, provider, provider_ref,
        idempotency_key, created_by
    )
    SELECT 'wallet_topup', w.id, 4200, w.currency, 'processing', 'not_applicable', 'stripe',
           'pi_probe_bb6_topup', 'probe-bb6-topup', pg_temp.uid('theo')
      FROM finance.wallets w WHERE w.id = current_setting('probe.wallet')::uuid
    RETURNING id INTO v_pay;
    v_out := finance.settle_card_payment('evt_probe_bb6_topup', 'pi_probe_bb6_topup', 4200,
        (SELECT currency FROM finance.wallets WHERE id = current_setting('probe.wallet')::uuid), false);
    SELECT * INTO v_row FROM finance.ledger_audit WHERE ref_table = 'inbound_payments' AND ref_id = v_pay;
    PERFORM pg_temp.expect('1a settlement writes an add_funds row for the payer and the amount received',
        v_row.action = 'add_funds' AND v_row.actor_user_id = pg_temp.uid('theo') AND v_row.amount_cents = 4200
        AND v_row.wallet_id = current_setting('probe.wallet')::uuid AND v_row.metadata ->> 'kind' = 'card_topup',
        format('row %s, settle %s', to_jsonb(v_row), v_out));
    PERFORM pg_temp.expect('1b the credit and the ledger row are one settlement',
        (SELECT status FROM finance.inbound_payments WHERE id = v_pay) = 'succeeded', v_out::text);
    PERFORM set_config('probe.topup', v_pay::text, true);
END $$;

-- The read live-money.ts makes (ledger_audit, action add_funds), as the payer under RLS.
SELECT pg_temp.act('theo');
SET LOCAL ROLE authenticated;
INSERT INTO probe_reads SELECT 'ledger',
    (SELECT count(*) FROM finance.ledger_audit
      WHERE wallet_id = current_setting('probe.wallet')::uuid AND action = 'add_funds'
        AND ref_id = current_setting('probe.topup')::uuid), NULL, NULL, NULL;
RESET ROLE;
DO $$
BEGIN
    PERFORM pg_temp.expect('1c the payer''s ledger read lists the card top-up',
        (SELECT limits FROM probe_reads WHERE who = 'ledger') = 1);
END $$;
-- #endregion

-- #region 2. Envelopes and requests: one's own, or all of them for those who run the policy
DO $$
DECLARE
    v_wallet uuid := current_setting('probe.wallet')::uuid;
BEGIN
    INSERT INTO finance.spending_limits (wallet_id, member_user_id, cap_cents, period_interval)
    SELECT v_wallet, pg_temp.uid(u), 50000, 'monthly' FROM unnest(ARRAY['theo', 'noor', 'hannahcole']) u
    ON CONFLICT (wallet_id, member_user_id) DO NOTHING;
    INSERT INTO finance.spend_approvals (wallet_id, requested_by, amount_cents, currency, reason, ref_table, ref_id, status, expires_at)
    SELECT v_wallet, pg_temp.uid(u), 1000, w.currency, 'probe request', 'transfers', gen_random_uuid(), 'pending', now() + interval '1 day'
      FROM unnest(ARRAY['theo', 'hannahcole']) u CROSS JOIN finance.wallets w WHERE w.id = v_wallet;
END $$;

-- Each reader's view, under RLS.
SELECT pg_temp.act('theo');
SET LOCAL ROLE authenticated;
INSERT INTO probe_reads SELECT 'theo',
    (SELECT count(*) FROM finance.spending_limits WHERE wallet_id = current_setting('probe.wallet')::uuid),
    (SELECT count(*) FROM finance.spending_limits WHERE wallet_id = current_setting('probe.wallet')::uuid AND member_user_id = auth.uid()),
    (SELECT count(*) FROM finance.spend_approvals WHERE wallet_id = current_setting('probe.wallet')::uuid),
    (SELECT count(*) FROM finance.spend_approvals WHERE wallet_id = current_setting('probe.wallet')::uuid AND requested_by = auth.uid());
RESET ROLE;
SELECT pg_temp.act('noor');
SET LOCAL ROLE authenticated;
INSERT INTO probe_reads SELECT 'noor',
    (SELECT count(*) FROM finance.spending_limits WHERE wallet_id = current_setting('probe.wallet')::uuid), NULL,
    (SELECT count(*) FROM finance.spend_approvals WHERE wallet_id = current_setting('probe.wallet')::uuid), NULL;
RESET ROLE;
SELECT pg_temp.act('hannahcole');
SET LOCAL ROLE authenticated;
INSERT INTO probe_reads SELECT 'hannahcole',
    (SELECT count(*) FROM finance.spending_limits WHERE wallet_id = current_setting('probe.wallet')::uuid), NULL,
    (SELECT count(*) FROM finance.spend_approvals WHERE wallet_id = current_setting('probe.wallet')::uuid), NULL;
RESET ROLE;
SELECT pg_temp.act('priyaraman');
SET LOCAL ROLE authenticated;
INSERT INTO probe_reads SELECT 'priyaraman',
    (SELECT count(*) FROM finance.spending_limits WHERE wallet_id = current_setting('probe.wallet')::uuid), NULL,
    (SELECT count(*) FROM finance.spend_approvals WHERE wallet_id = current_setting('probe.wallet')::uuid), NULL;
RESET ROLE;

DO $$
DECLARE
    v_all_limits integer := (SELECT count(*) FROM finance.spending_limits WHERE wallet_id = current_setting('probe.wallet')::uuid);
    v_all_approvals integer := (SELECT count(*) FROM finance.spend_approvals WHERE wallet_id = current_setting('probe.wallet')::uuid);
    r probe_reads;
BEGIN
    SELECT * INTO r FROM probe_reads WHERE who = 'theo';
    PERFORM pg_temp.expect('2a a plain member reads only their own envelope',
        r.limits = 1 AND r.own_limits = 1, to_jsonb(r)::text);
    PERFORM pg_temp.expect('2b a plain member reads only their own requests',
        r.approvals = r.own_approvals AND r.approvals = 1, to_jsonb(r)::text);
    FOR r IN SELECT * FROM probe_reads WHERE who IN ('noor', 'hannahcole', 'priyaraman') LOOP
        PERFORM pg_temp.expect('2c ' || r.who || ' (approver / policy editor / owner) reads every envelope and request',
            r.limits = v_all_limits AND r.approvals = v_all_approvals AND v_all_limits >= 3 AND v_all_approvals >= 2,
            format('%s of %s limits, %s of %s requests', r.limits, v_all_limits, r.approvals, v_all_approvals));
    END LOOP;
END $$;
-- #endregion

-- #region 3. business_roles answers a platform admin (parity with the roster)
SELECT pg_temp.act('lenamueller');
SET LOCAL ROLE authenticated;
INSERT INTO probe_reads SELECT 'admin-roles',
    (SELECT count(*) FROM org.business_roles WHERE business_id = current_setting('probe.b')::uuid), NULL, NULL, NULL;
RESET ROLE;
DO $$
BEGIN
    PERFORM pg_temp.expect('3 a non-member platform admin reads the business''s roles',
        (SELECT limits FROM probe_reads WHERE who = 'admin-roles') >= 3);
END $$;
-- #endregion

-- #region 4. Owner-reserved rights
DO $$
DECLARE
    v_out text;
    v_role uuid;
BEGIN
    -- The admin preset is unchanged: it lacks exactly the reserved rights; the owner holds them.
    PERFORM pg_temp.expect('4a the admin preset holds no reserved right; the owner holds all three',
        NOT (pg_temp.caps('hannahcole') && org.fn_reserved_capabilities('business'))
        AND pg_temp.caps('priyaraman') @> org.fn_reserved_capabilities('business'),
        format('admin %s owner %s', pg_temp.caps('hannahcole'), pg_temp.caps('priyaraman')));

    -- A non-owner cannot grant the billing right (an admin does not hold it).
    v_out := pg_temp.patch('hannahcole', 'theo', '{"granted":["manage_billing"],"confirm":"CONFIRM"}');
    PERFORM pg_temp.expect('4b an admin cannot grant the billing right', v_out LIKE '42501%', v_out);

    -- The billing right goes only to an admin seat.
    v_out := pg_temp.patch('priyaraman', 'theo', '{"granted":["manage_billing"],"confirm":"CONFIRM"}');
    PERFORM pg_temp.expect('4c the billing right goes only to an admin', v_out LIKE '22023%only to an admin%', v_out);

    -- …and only with the typed confirmation.
    v_out := pg_temp.patch('priyaraman', 'hannahcole', '{"granted":["manage_billing"]}');
    PERFORM pg_temp.expect('4d a billing grant without CONFIRM is refused', v_out LIKE '22023 confirm:%', v_out);
    v_out := pg_temp.patch('priyaraman', 'hannahcole', '{"granted":["manage_billing"],"confirm":"confirm"}');
    PERFORM pg_temp.expect('4e the confirmation is the exact word', v_out LIKE '22023 confirm:%', v_out);

    v_out := pg_temp.patch('priyaraman', 'hannahcole', '{"granted":["manage_billing"],"confirm":"CONFIRM"}');
    PERFORM pg_temp.expect('4f the owner grants the billing right to a named admin', v_out = 'ok', v_out);
    PERFORM pg_temp.expect('4g the grant projects to the vault''s manage_billing (and nothing owner-level)',
        'manage_billing' = ANY (pg_temp.vault('hannahcole')) AND NOT ('manage_members' = ANY (pg_temp.vault('hannahcole'))),
        pg_temp.vault('hannahcole')::text);
    PERFORM pg_temp.act('hannahcole');
    PERFORM pg_temp.expect('4h the billing writes'' own check now answers yes for that admin',
        finance.fn_owner_capability('business', current_setting('probe.b')::uuid, 'manage_billing'::finance.vault_capability));

    -- Holding it is not handing it on (to a fellow admin the rank rule already refuses; 4m covers a
    -- member, where only the reserved-rights check stands in the way).
    v_out := pg_temp.patch('hannahcole', 'marisdelacroix', '{"granted":["manage_billing"],"confirm":"CONFIRM"}');
    PERFORM pg_temp.expect('4i a billing holder cannot grant it onward', v_out LIKE '42501%', v_out);

    -- The co-owner set: the owner's own permissions on an admin seat.
    v_out := pg_temp.patch('priyaraman', 'hannahcole',
        '{"granted":["manage_billing","withdraw_funds","archive_entity"],"confirm":"CONFIRM"}');
    PERFORM pg_temp.expect('4j the owner makes an admin a co-owner', v_out = 'ok', v_out);
    PERFORM pg_temp.expect('4k a co-owner holds the owner''s exact set, on an admin seat',
        pg_temp.caps('hannahcole') = pg_temp.caps('priyaraman')
        AND (SELECT role FROM org.business_members WHERE id = pg_temp.seat('hannahcole')) = 'admin',
        format('co-owner %s owner %s', pg_temp.caps('hannahcole'), pg_temp.caps('priyaraman')));
    PERFORM pg_temp.expect('4l the co-owner''s vault carries withdraw and manage_billing',
        pg_temp.vault('hannahcole') @> ARRAY['withdraw', 'manage_billing']::finance.vault_capability[],
        pg_temp.vault('hannahcole')::text);

    -- A co-owner passes nothing reserved on.
    v_out := pg_temp.patch('hannahcole', 'theo', '{"granted":["withdraw_funds"],"confirm":"CONFIRM"}');
    PERFORM pg_temp.expect('4m a co-owner cannot grant withdrawal onward', v_out LIKE '42501 reserved:%', v_out);

    -- Nobody but the owner takes a reserved grant away.
    v_out := pg_temp.patch('priyaraman', 'theo', '{"granted":["withdraw_funds"],"confirm":"CONFIRM"}');
    PERFORM pg_temp.expect('4n the owner may grant withdrawal to a member', v_out = 'ok', v_out);
    v_out := pg_temp.patch('marisdelacroix', 'theo', '{"granted":[]}');
    PERFORM pg_temp.expect('4o an admin cannot strip an owner''s reserved grant', v_out LIKE '42501 reserved:%', v_out);
    v_out := pg_temp.patch('priyaraman', 'theo', '{"granted":[]}');
    PERFORM pg_temp.expect('4p the owner revokes it (no confirmation needed to take away)', v_out = 'ok'
        AND NOT ('withdraw_funds' = ANY (pg_temp.caps('theo'))), v_out);

    -- The holder may give a grant up — only a reserved one, only their own.
    v_out := pg_temp.patch('hannahcole', 'hannahcole', '{"relinquish":["spend_funds"]}');
    PERFORM pg_temp.expect('4q only a reserved right is relinquished', v_out LIKE '22023 relinquish:%', v_out);
    v_out := pg_temp.patch('marisdelacroix', 'hannahcole', '{"relinquish":["archive_entity"]}');
    PERFORM pg_temp.expect('4r nobody relinquishes for someone else', v_out LIKE '42501 relinquish:%', v_out);
    v_out := pg_temp.patch('hannahcole', 'hannahcole', '{"relinquish":["archive_entity"]}');
    PERFORM pg_temp.expect('4s the holder gives up archiving and keeps the rest', v_out = 'ok'
        AND NOT ('archive_entity' = ANY (pg_temp.caps('hannahcole')))
        AND 'manage_billing' = ANY (pg_temp.caps('hannahcole')), v_out);

    -- No role carries a reserved right.
    PERFORM pg_temp.act('priyaraman');
    BEGIN
        PERFORM org.upsert_workspace_role('business', current_setting('probe.b')::uuid, NULL, 'Probe billing role', '',
            ARRAY['manage_billing']::org.workspace_capability[], 'admin');
        v_out := 'ok';
    EXCEPTION WHEN OTHERS THEN v_out := SQLSTATE || ' ' || SQLERRM;
    END;
    PERFORM pg_temp.expect('4t a role cannot carry the billing right', v_out LIKE '22023 capabilities:%', v_out);
    BEGIN
        PERFORM org.upsert_workspace_role('business', current_setting('probe.b')::uuid, NULL, 'Probe withdraw role', '',
            ARRAY['withdraw_funds']::org.workspace_capability[], 'member');
        v_out := 'ok';
    EXCEPTION WHEN OTHERS THEN v_out := SQLSTATE || ' ' || SQLERRM;
    END;
    PERFORM pg_temp.expect('4u a role cannot carry withdrawal', v_out LIKE '22023 capabilities:%', v_out);

    -- Moved off an admin seat, the billing right goes with the move.
    v_out := pg_temp.patch('priyaraman', 'marisdelacroix', '{"granted":["manage_billing"],"confirm":"CONFIRM"}');
    v_out := v_out || ' / ' || pg_temp.patch('priyaraman', 'marisdelacroix',
        jsonb_build_object('role_id', current_setting('probe.member_role')));
    PERFORM pg_temp.expect('4v a demoted admin loses the billing right',
        v_out = 'ok / ok' AND NOT ('manage_billing' = ANY (pg_temp.caps('marisdelacroix')))
        AND NOT ('manage_billing' = ANY (pg_temp.vault('marisdelacroix'))), v_out);

    -- A team renders no billing right to grant.
    PERFORM pg_temp.expect('4w a team''s kind has no manage_billing and reserves nothing',
        NOT ('manage_billing' = ANY (org.fn_kind_capabilities('team')))
        AND cardinality(org.fn_reserved_capabilities('team')) = 0);
END $$;

-- An ownership transfer clears every reserved grant; the single owner seat stands.
DO $$
DECLARE
    v_out text;
BEGIN
    v_out := pg_temp.patch('priyaraman', 'marisdelacroix', jsonb_build_object('role_id', current_setting('probe.admin_role')));
    v_out := v_out || ' / ' || pg_temp.patch('priyaraman', 'marisdelacroix', '{"granted":["manage_billing"],"confirm":"CONFIRM"}');
    PERFORM pg_temp.expect('4x fixture: a second billing admin', v_out = 'ok / ok', v_out);

    PERFORM pg_temp.act('priyaraman');
    PERFORM org.transfer_workspace_ownership('business', current_setting('probe.b')::uuid, pg_temp.seat('hannahcole'), false);
    PERFORM pg_temp.expect('4y after a transfer no member holds a reserved grant',
        NOT EXISTS (SELECT 1 FROM org.business_members m
                     WHERE m.business_id = current_setting('probe.b')::uuid AND m.status = 'active'
                       AND m.granted_capabilities && org.fn_reserved_capabilities('business')),
        (SELECT string_agg(m.granted_capabilities::text, ', ') FROM org.business_members m
          WHERE m.business_id = current_setting('probe.b')::uuid));
    PERFORM pg_temp.expect('4z the old owner is an admin without the reserved rights; the vault agrees',
        NOT (pg_temp.caps('priyaraman') && org.fn_reserved_capabilities('business'))
        AND NOT ('manage_billing' = ANY (pg_temp.vault('priyaraman')))
        AND NOT ('manage_billing' = ANY (pg_temp.vault('marisdelacroix')))
        AND (SELECT count(*) FROM org.business_members m
              WHERE m.business_id = current_setting('probe.b')::uuid AND m.status = 'active' AND m.role = 'owner') = 1,
        format('old owner %s vault %s', pg_temp.caps('priyaraman'), pg_temp.vault('priyaraman')));
END $$;
-- #endregion

ROLLBACK;
