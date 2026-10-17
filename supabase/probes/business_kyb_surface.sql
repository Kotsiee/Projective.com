-- =============================================================================================
-- Probe: the business Verification module's server half (BU4 — BUSINESSES_AUDIT BF27, BF28;
-- Decisions #126, #230 (d), #238).
--
--   1. Who may start or resume KYB: `viewer_can.start_kyb` in `org.get_workspace_detail` and the
--      start door's own check (`finance.payout_account_for('business', …)`, which
--      `POST /api/finance/verify/kyb` calls BEFORE any Stripe request) agree — the owner yes, an
--      admin or member no (42501), an admin the owner granted the billing right yes.
--   2. What the read says is due, as the business's Connect account moves: no account →
--      `connect_account`; an account in review → `finish_onboarding`; restricted →
--      `provider_restricted`; a rejected KYB → `kyb_rejected`; verified → nothing.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing and calls no provider. Run against a
-- migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/business_kyb_surface.sql
--
-- Fixture (seeded): `heliafinance` (KYB verified) — owner `priyaraman`, admin `hannahcole`;
-- `atlaslabs` (KYB pending, no Connect account) — owner `danielokafor`, member `miguelsantos`.
-- A clean run prints only PASS.
-- =============================================================================================

BEGIN;

-- #region 0. Helpers (as postgres)
-- The two businesses' ids, resolved here: the start door takes an id, and a business row is not
-- every member's to read directly.
DO $$
BEGIN
    PERFORM set_config('probe.' || slug, id::text, true) FROM org.business_profiles
      WHERE slug IN ('heliafinance', 'atlaslabs');
END $$;
CREATE FUNCTION pg_temp.uid(p_username text) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT user_id FROM org.users_public WHERE username = p_username;
$$;
-- Act as a seeded user: auth.uid() reads these claims.
CREATE FUNCTION pg_temp.act(p_username text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', pg_temp.uid(p_username), 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', pg_temp.uid(p_username)::text, true);
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
-- The start door's verdict for the acting user: 'ok', or the refusal's SQLSTATE and message.
CREATE FUNCTION pg_temp.start_door(p_slug text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    PERFORM finance.payout_account_for('business', current_setting('probe.' || p_slug)::uuid);
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END;
$$;
-- The acting user's KYB block and start flag on a business, as the console reads them.
CREATE FUNCTION pg_temp.kyb(p_slug text) RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object('kyb', d->'kyb', 'start_kyb', d->'viewer_can'->'start_kyb')
      FROM (SELECT org.get_workspace_detail('business', p_slug) AS d) x;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.uid(text), pg_temp.act(text), pg_temp.expect(text, boolean, text),
    pg_temp.start_door(text), pg_temp.kyb(text) TO authenticated;
-- #endregion

-- #region 1. Who may start KYB
DO $$
DECLARE
    v jsonb;
BEGIN
    -- The owner of a verified business: nothing due, may still open the door (to update details).
    PERFORM pg_temp.act('priyaraman');
    SET LOCAL ROLE authenticated;
    v := pg_temp.kyb('heliafinance');
    PERFORM pg_temp.expect('1a helia owner: verified, nothing due, may start',
        v->'kyb'->>'status' = 'verified' AND v->'kyb'->'requirements_due' = '[]'::jsonb
            AND (v->>'start_kyb')::boolean AND v->'kyb'->>'verified_at' IS NOT NULL, v::text);
    PERFORM pg_temp.expect('1b helia owner: the start door opens', pg_temp.start_door('heliafinance') = 'ok',
        pg_temp.start_door('heliafinance'));
    RESET ROLE;

    -- The admin preset does not carry the billing right: no flag, and the door refuses before Stripe.
    PERFORM pg_temp.act('hannahcole');
    SET LOCAL ROLE authenticated;
    v := pg_temp.kyb('heliafinance');
    PERFORM pg_temp.expect('1c helia admin: may not start', NOT (v->>'start_kyb')::boolean, v::text);
    PERFORM pg_temp.expect('1d helia admin: the start door refuses (42501)',
        pg_temp.start_door('heliafinance') LIKE '42501 %', pg_temp.start_door('heliafinance'));
    RESET ROLE;

    -- The owner of an unverified business with no Connect account yet.
    PERFORM pg_temp.act('danielokafor');
    SET LOCAL ROLE authenticated;
    v := pg_temp.kyb('atlaslabs');
    PERFORM pg_temp.expect('1e atlas owner: pending, no account, connect_account due, may start',
        v->'kyb'->>'status' = 'pending' AND NOT (v->'kyb'->>'has_account')::boolean
            AND v->'kyb'->'requirements_due' = '["connect_account"]'::jsonb AND (v->>'start_kyb')::boolean,
        v::text);
    PERFORM pg_temp.expect('1f atlas owner: the start door opens', pg_temp.start_door('atlaslabs') = 'ok',
        pg_temp.start_door('atlaslabs'));
    RESET ROLE;

    -- A member with hiring grants still holds no billing right.
    PERFORM pg_temp.act('miguelsantos');
    SET LOCAL ROLE authenticated;
    v := pg_temp.kyb('atlaslabs');
    PERFORM pg_temp.expect('1g atlas member: may not start', NOT (v->>'start_kyb')::boolean, v::text);
    PERFORM pg_temp.expect('1h atlas member: the start door refuses (42501)',
        pg_temp.start_door('atlaslabs') LIKE '42501 %', pg_temp.start_door('atlaslabs'));
    RESET ROLE;
END $$;
-- #endregion

-- #region 2. What is due as the Connect account moves
DO $$
DECLARE
    v_atlas uuid := (SELECT id FROM org.business_profiles WHERE slug = 'atlaslabs');
    v jsonb;
BEGIN
    INSERT INTO finance.payout_accounts (owner_type, owner_id, provider, account_id, status)
    VALUES ('business', v_atlas, 'stripe', 'acct_probeatlaskyb', 'pending_verification');

    PERFORM pg_temp.act('danielokafor');
    SET LOCAL ROLE authenticated;
    v := pg_temp.kyb('atlaslabs');
    RESET ROLE;
    PERFORM pg_temp.expect('2a an account in review: finish_onboarding, has_account',
        (v->'kyb'->>'has_account')::boolean AND v->'kyb'->'requirements_due' = '["finish_onboarding"]'::jsonb,
        v::text);

    UPDATE finance.payout_accounts SET status = 'restricted', updated_at = now()
     WHERE account_id = 'acct_probeatlaskyb';
    SET LOCAL ROLE authenticated;
    v := pg_temp.kyb('atlaslabs');
    RESET ROLE;
    PERFORM pg_temp.expect('2b a restricted account: provider_restricted',
        v->'kyb'->'requirements_due' = '["provider_restricted"]'::jsonb, v::text);

    UPDATE org.business_profiles SET kyb_status = 'rejected' WHERE id = v_atlas;
    SET LOCAL ROLE authenticated;
    v := pg_temp.kyb('atlaslabs');
    RESET ROLE;
    PERFORM pg_temp.expect('2c a rejected KYB: kyb_rejected, read as not verified',
        v->'kyb'->'requirements_due' = '["kyb_rejected"]'::jsonb AND v->'kyb'->>'status' = 'rejected', v::text);

    UPDATE org.business_profiles SET kyb_status = 'verified', kyb_verified_at = now() WHERE id = v_atlas;
    SET LOCAL ROLE authenticated;
    v := pg_temp.kyb('atlaslabs');
    RESET ROLE;
    PERFORM pg_temp.expect('2d verified: nothing due', v->'kyb'->'requirements_due' = '[]'::jsonb, v::text);
END $$;
-- #endregion

-- #region 3. The owner's billing grant reaches KYB (Decision #238)
DO $$
DECLARE
    v jsonb;
BEGIN
    PERFORM pg_temp.act('priyaraman');
    PERFORM org.update_workspace_member('business',
        (SELECT m.id FROM org.business_members m JOIN org.business_profiles b ON b.id = m.business_id
          WHERE b.slug = 'heliafinance' AND m.user_id = pg_temp.uid('hannahcole') AND m.status = 'active'),
        '{"granted":["manage_billing"],"confirm":"CONFIRM"}'::jsonb);

    PERFORM pg_temp.act('hannahcole');
    SET LOCAL ROLE authenticated;
    v := pg_temp.kyb('heliafinance');
    PERFORM pg_temp.expect('3a a billing-granted admin may start', (v->>'start_kyb')::boolean, v::text);
    PERFORM pg_temp.expect('3b and the start door opens for them', pg_temp.start_door('heliafinance') = 'ok',
        pg_temp.start_door('heliafinance'));
    RESET ROLE;
END $$;
-- #endregion

ROLLBACK;
