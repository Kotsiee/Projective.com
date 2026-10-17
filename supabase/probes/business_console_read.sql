-- BB9 — org.get_workspace_detail('business') is server-decided and narrowed per viewer; the draft
-- preview prices against the real spend. Run on a reset DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/probes/business_console_read.sql
-- Everything runs in one transaction and is rolled back.
BEGIN;
-- BB9 probe — run inside BEGIN … ROLLBACK. Helia Finance (active, KYB verified): priyaraman owner,
-- hannahcole admin; noor joins as a plain member and theo as a member granted spend_funds (both rolled
-- back). Atlas Labs (KYB pending): danielokafor owner, miguelsantos member +hire +manage_projects.
CREATE FUNCTION pg_temp.act(p_username text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
    SELECT u.user_id INTO v FROM org.users_public u WHERE u.username = p_username;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v::text, true);
END $f$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAILED: %', p_what; END IF;
    RAISE NOTICE 'ok — %', p_what;
END $f$;

GRANT EXECUTE ON FUNCTION pg_temp.act(text), pg_temp.check(boolean, text) TO authenticated;

INSERT INTO org.business_members (business_id, user_id, role_id, role)
SELECT b.id, u.user_id, r.id, 'member'
  FROM org.business_profiles b JOIN org.business_roles r ON r.business_id = b.id AND r.preset = 'member'
  JOIN org.users_public u ON u.username IN ('noor', 'theo')
 WHERE b.slug = 'heliafinance';
UPDATE org.business_members m SET granted_capabilities = ARRAY['spend_funds']::org.workspace_capability[]
  FROM org.users_public u, org.business_profiles b
 WHERE u.user_id = m.user_id AND u.username = 'theo' AND b.id = m.business_id AND b.slug = 'heliafinance';
SELECT org.fn_sync_vault_permissions('business', b.id, NULL) FROM org.business_profiles b WHERE b.slug = 'heliafinance';
-- theo: a 10 000 cap with 2 500 spent this month; a pending request of his.
INSERT INTO finance.spending_limits (wallet_id, member_user_id, cap_cents, per_transaction_cents, period_interval, spent_cents, resets_at)
SELECT w.id, u.user_id, 10000, NULL, 'monthly', 2500, now() + interval '5 days'
  FROM finance.wallets w JOIN org.business_profiles b ON b.id = w.owner_id AND w.owner_type = 'business'
  JOIN org.users_public u ON u.username = 'theo'
 WHERE b.slug = 'heliafinance' AND upper(w.currency) = 'USD';
INSERT INTO finance.spend_approvals (wallet_id, requested_by, amount_cents, currency, reason, ref_table, ref_id)
SELECT w.id, u.user_id, 700000, 'USD', 'Probe request', 'transfers', gen_random_uuid()
  FROM finance.wallets w JOIN org.business_profiles b ON b.id = w.owner_id AND w.owner_type = 'business'
  JOIN org.users_public u ON u.username = 'theo'
 WHERE b.slug = 'heliafinance' AND upper(w.currency) = 'USD';

-- #region Owner
SELECT set_config('probe.biz', (SELECT id::text FROM org.business_profiles WHERE slug = 'heliafinance'), false);
SELECT set_config('probe.theo', (SELECT m.id::text FROM org.business_members m JOIN org.users_public u ON u.user_id = m.user_id
                                  JOIN org.business_profiles b ON b.id = m.business_id
                                  WHERE u.username = 'theo' AND b.slug = 'heliafinance'), false);
SELECT pg_temp.act('priyaraman');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE d_owner ON COMMIT DROP AS SELECT org.get_workspace_detail('business', 'heliafinance') AS d;
SELECT pg_temp.check((SELECT d->>'status' FROM d_owner) = 'ok', 'owner reads the detail');
SELECT pg_temp.check((SELECT jsonb_array_length(d->'spend'->'limits') FROM d_owner) = 4, 'owner reads all four envelopes');
SELECT pg_temp.check((SELECT (d->'viewer_can'->>'pay_invoice')::boolean AND (d->'viewer_can'->>'start_kyb')::boolean
                             AND (d->'viewer_can'->>'decide')::boolean AND (d->'viewer_can'->>'edit_policy')::boolean
                             AND (d->'viewer_can'->>'purchase')::boolean FROM d_owner), 'owner: pay, kyb, decide, edit, purchase');
SELECT pg_temp.check((SELECT NOT (d->'viewer_can'->>'archive')::boolean AND jsonb_array_length(d->'archive_blockers') > 0 FROM d_owner),
                     'owner cannot archive a business with money in it, and is told why');
SELECT pg_temp.check((SELECT jsonb_array_length(d->'spend'->'approvals'->'pending') >= 1 FROM d_owner), 'owner sees theo''s pending request');
SELECT pg_temp.check((SELECT jsonb_array_length(d->'money_tiles') >= 1 AND (d->'money_tiles'->0->>'currency') = 'USD'
                             AND (d->'money_tiles'->0->>'awaiting_approval_minor')::bigint >= 700000 FROM d_owner),
                     'owner: USD tile first, the request is awaiting approval');
SELECT pg_temp.check((SELECT d->'kyb'->>'status' = 'verified' AND d->'kyb'->'requirements_due' = '[]'::jsonb FROM d_owner),
                     'verified business has nothing due');
SELECT pg_temp.check((SELECT e->>'spent_minor' = '2500' AND e->>'remaining_minor' = '7500' AND (e->>'used_fraction')::numeric = 0.25
                        FROM d_owner, jsonb_array_elements(d->'spend'->'limits') e
                        JOIN org.users_public u ON u.user_id = (e->>'user_id')::uuid WHERE u.username = 'theo'),
                     'theo''s envelope: 2 500 spent, 7 500 left, 25%');
SELECT d->'spend'->'limits' AS owner_limits, d->'money_tiles' AS tiles, d->'viewer_can' AS can, d->'kyb' AS kyb FROM d_owner;
-- The draft preview: lift theo's cap to 20 000 — 2 500 still spent, 17 500 left.
SELECT pg_temp.check((
    SELECT (e->>'limit_minor')::bigint = 20000 AND (e->>'remaining_minor')::bigint = 17500 AND (e->>'spent_minor')::bigint = 2500
      FROM jsonb_array_elements(finance.preview_spend_envelope(
               current_setting('probe.biz')::uuid,
               jsonb_build_object('limits', jsonb_build_array(jsonb_build_object(
                   'member_id', current_setting('probe.theo'),
                   'limit_minor', 20000))))->'limits') e
      JOIN org.users_public u ON u.user_id = (e->>'user_id')::uuid WHERE u.username = 'theo'),
    'preview prices a draft cap against the real spend');
SELECT pg_temp.check((finance.get_billing_settings(current_setting('probe.biz')::uuid)->>'can_pay')::boolean,
                     'billing view: the owner may pay');
RESET ROLE;
-- #endregion

-- #region Admin
SELECT pg_temp.act('hannahcole');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE d_admin ON COMMIT DROP AS SELECT org.get_workspace_detail('business', 'heliafinance') AS d;
SELECT pg_temp.check((SELECT jsonb_array_length(d->'spend'->'limits') = 4 FROM d_admin), 'admin reads every envelope');
SELECT pg_temp.check((SELECT (d->'viewer_can'->>'edit_policy')::boolean AND (d->'viewer_can'->>'decide')::boolean
                             AND NOT (d->'viewer_can'->>'pay_invoice')::boolean AND NOT (d->'viewer_can'->>'start_kyb')::boolean
                             AND d->'archive_blockers' = '[]'::jsonb FROM d_admin),
                     'admin: edit + decide, not pay / kyb, no blockers shown');
RESET ROLE;
-- #endregion

-- #region Plain member
SELECT pg_temp.act('noor');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE d_member ON COMMIT DROP AS SELECT org.get_workspace_detail('business', 'heliafinance') AS d;
SELECT pg_temp.check((SELECT d->'spend' = 'null'::jsonb OR d->'spend' IS NULL FROM d_member), 'plain member: no spend block');
SELECT pg_temp.check((SELECT jsonb_array_length(d->'money_tiles') >= 1 FROM d_member), 'plain member (contribute_funds) sees the tiles');
SELECT pg_temp.check((SELECT NOT EXISTS (SELECT 1 FROM jsonb_each(d->'viewer_can') f WHERE f.value = 'true'::jsonb) FROM d_member),
                     'plain member may do none of the money acts');
SELECT pg_temp.check(NOT (SELECT d::text LIKE '%Probe request%' FROM d_member), 'plain member never sees theo''s request');
DO $$ BEGIN
    PERFORM finance.preview_spend_envelope(current_setting('probe.biz')::uuid, '{}'::jsonb);
    RAISE EXCEPTION 'PROBE FAILED: a plain member previewed a policy';
EXCEPTION WHEN SQLSTATE '42501' THEN RAISE NOTICE 'ok — plain member cannot preview (42501)';
END $$;
RESET ROLE;
-- #endregion

-- #region Spender
SELECT pg_temp.act('theo');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE d_spender ON COMMIT DROP AS SELECT org.get_workspace_detail('business', 'heliafinance') AS d;
SELECT pg_temp.check((SELECT jsonb_array_length(d->'spend'->'limits') = 1 FROM d_spender), 'spender reads ONLY their own envelope');
SELECT pg_temp.check((SELECT (d->'viewer_can'->>'request_spend')::boolean AND NOT (d->'viewer_can'->>'decide')::boolean FROM d_spender),
                     'spender may request, not decide');
SELECT pg_temp.check((SELECT jsonb_array_length(d->'spend'->'approvals'->'pending') = 1 FROM d_spender), 'spender sees their own request');
RESET ROLE;
-- #endregion

-- #region Atlas (KYB pending)
SELECT pg_temp.act('danielokafor');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE d_atlas ON COMMIT DROP AS SELECT org.get_workspace_detail('business', 'atlaslabs') AS d;
SELECT pg_temp.check((SELECT NOT (d->'viewer_can'->>'pay_invoice')::boolean AND NOT (d->'viewer_can'->>'decide')::boolean
                             AND NOT (d->'viewer_can'->>'purchase')::boolean AND (d->'viewer_can'->>'start_kyb')::boolean FROM d_atlas),
                     'unverified business: no pay / decide / purchase, but KYB can start');
SELECT pg_temp.check((SELECT jsonb_array_length(d->'kyb'->'requirements_due') = 1 FROM d_atlas), 'unverified business has one thing due');
SELECT d->'kyb' AS atlas_kyb FROM d_atlas;
RESET ROLE;
SELECT pg_temp.act('miguelsantos');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE d_miguel ON COMMIT DROP AS SELECT org.get_workspace_detail('business', 'atlaslabs') AS d;
SELECT pg_temp.check((SELECT (d->'viewer_can'->>'hire')::boolean AND (d->'viewer_can'->>'manage_projects')::boolean
                             AND NOT (d->'viewer_can'->>'edit_policy')::boolean FROM d_miguel),
                     'miguel: hire + manage_projects from his grants, no policy');
RESET ROLE;
-- #endregion

-- #region Team unchanged
SELECT pg_temp.act((SELECT u.username FROM org.teams t JOIN org.users_public u ON u.user_id = t.owner_user_id
                     ORDER BY t.slug LIMIT 1));
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE d_team ON COMMIT DROP AS
SELECT org.get_workspace_detail('team', (SELECT t.slug FROM org.teams t ORDER BY t.slug LIMIT 1)) AS d;
SELECT pg_temp.check((SELECT d->>'status' = 'ok' AND d->'viewer_can' = 'null'::jsonb AND d->'kyb' = 'null'::jsonb
                             AND d->'spend' = 'null'::jsonb AND d->'money_tiles' = '[]'::jsonb AND d ? 'payout' FROM d_team),
                     'a team''s detail carries no business block');
RESET ROLE;
-- #endregion
ROLLBACK;
