-- BU6 — the business Overview's setup facts. org.get_workspace_detail and org.get_workspace_roster
-- answer, for a business, `setup.funded` (money was ever added to its pooled wallet — any `add_funds`
-- ledger row, so the step never reopens once the wallet is spent) and `setup.limits_offered` (its
-- plan lets it set a threshold or member limits — the negation of the Spend editor's
-- `limits_plan_gated`); a team answers false for both. The roster and the detail agree, and a plain
-- member (contribute_funds only) is answered the money tiles — the Overview band's read.
-- Run on a reset DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/probes/business_overview_setup.sql
-- Everything runs in one transaction and is rolled back.
BEGIN;
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

-- The setup object of one entity in the caller's roster.
CREATE FUNCTION pg_temp.roster_setup(p_kind text, p_handle text) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT i->'setup' FROM jsonb_array_elements(org.get_workspace_roster(p_kind)->'items') i
     WHERE i->>'handle' = p_handle;
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.act(text), pg_temp.check(boolean, text),
    pg_temp.roster_setup(text, text) TO authenticated;

-- #region Helia — funded by the seed's opening top-up, on Business Free with the gates on
SELECT pg_temp.act('priyaraman');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(
    (SELECT (d->'setup'->>'funded')::boolean FROM (SELECT org.get_workspace_detail('business', 'heliafinance') d) x),
    'helia: the detail answers funded');
SELECT pg_temp.check(
    (SELECT NOT (d->'setup'->>'limits_offered')::boolean FROM (SELECT org.get_workspace_detail('business', 'heliafinance') d) x),
    'helia on Business Free with the gates on: limits are not offered');
SELECT pg_temp.check(
    (SELECT s->'funded' = 'true'::jsonb AND s->'limits_offered' = 'false'::jsonb
       FROM (SELECT pg_temp.roster_setup('business', 'heliafinance') s) x),
    'helia: the roster agrees with the detail');
RESET ROLE;
-- #endregion

-- #region The plan switch off — limits are offered to every business
UPDATE security.platform_params SET value = to_jsonb(false) WHERE key = 'business_plan_gates_enforced';
SELECT pg_temp.act('priyaraman');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(
    (SELECT (d->'setup'->>'limits_offered')::boolean FROM (SELECT org.get_workspace_detail('business', 'heliafinance') d) x),
    'gates off: the detail offers limits');
SELECT pg_temp.check(
    (SELECT (pg_temp.roster_setup('business', 'heliafinance')->>'limits_offered')::boolean),
    'gates off: the roster offers limits');
RESET ROLE;
UPDATE security.platform_params SET value = to_jsonb(true) WHERE key = 'business_plan_gates_enforced';
-- #endregion

-- #region A new draft business — unfunded until money is first added
SELECT pg_temp.act('theo');
SET LOCAL ROLE authenticated;
SELECT set_config('probe.biz',
    (org.create_workspace('business', 'Probe Overview', 'probe-bu6-overview')->>'id'), false);
SELECT pg_temp.check(
    (SELECT d->>'entity_status' = 'draft' AND NOT (d->'setup'->>'funded')::boolean
       FROM (SELECT org.get_workspace_detail('business', 'probe-bu6-overview') d) x),
    'a new draft business is not funded');
SELECT pg_temp.check(
    (SELECT s->'funded' = 'false'::jsonb FROM (SELECT pg_temp.roster_setup('business', 'probe-bu6-overview') s) x),
    'the roster agrees: not funded');
RESET ROLE;
INSERT INTO finance.ledger_audit (wallet_id, actor_user_id, action, amount_cents, currency)
SELECT w.id, u.user_id, 'add_funds', 2500, w.currency
  FROM finance.wallets w, org.users_public u
 WHERE w.owner_type = 'business' AND w.owner_id = current_setting('probe.biz')::uuid AND u.username = 'theo';
SELECT pg_temp.act('theo');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(
    (SELECT (d->'setup'->>'funded')::boolean FROM (SELECT org.get_workspace_detail('business', 'probe-bu6-overview') d) x),
    'once money is added, the detail answers funded');
SELECT pg_temp.check(
    (SELECT (pg_temp.roster_setup('business', 'probe-bu6-overview')->>'funded')::boolean),
    'the roster agrees: funded');
RESET ROLE;
-- Spending it all does not reopen the step: the fact is "money was added", not "money is there".
UPDATE finance.wallets SET balance_cents = 0
 WHERE owner_type = 'business' AND owner_id = current_setting('probe.biz')::uuid;
SELECT pg_temp.act('theo');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(
    (SELECT (d->'setup'->>'funded')::boolean FROM (SELECT org.get_workspace_detail('business', 'probe-bu6-overview') d) x),
    'an emptied wallet stays funded');
RESET ROLE;
-- #endregion

-- #region A team answers neither
SELECT pg_temp.act((SELECT u.username FROM org.teams t JOIN org.users_public u ON u.user_id = t.owner_user_id
                     ORDER BY t.slug LIMIT 1));
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(
    (SELECT d->>'status' = 'ok' AND d->'setup'->'funded' = 'false'::jsonb AND d->'setup'->'limits_offered' = 'false'::jsonb
       FROM (SELECT org.get_workspace_detail('team', (SELECT t.slug FROM org.teams t ORDER BY t.slug LIMIT 1)) d) x),
    'a team''s detail: funded and limits_offered are false');
SELECT pg_temp.check(
    (SELECT s->'funded' = 'false'::jsonb AND s->'limits_offered' = 'false'::jsonb
       FROM (SELECT pg_temp.roster_setup('team', (SELECT t.slug FROM org.teams t ORDER BY t.slug LIMIT 1)) s) x),
    'a team''s roster card: funded and limits_offered are false');
RESET ROLE;
-- #endregion

-- #region A plain member (contribute_funds) is answered the money band
INSERT INTO org.business_members (business_id, user_id, role_id, role)
SELECT b.id, u.user_id, r.id, 'member'
  FROM org.business_profiles b JOIN org.business_roles r ON r.business_id = b.id AND r.preset = 'member'
  JOIN org.users_public u ON u.username = 'noor'
 WHERE b.slug = 'heliafinance';
SELECT org.fn_sync_vault_permissions('business', b.id, NULL) FROM org.business_profiles b WHERE b.slug = 'heliafinance';
SELECT pg_temp.act('noor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(
    (SELECT jsonb_array_length(d->'money_tiles') >= 1 AND (d->'spend' = 'null'::jsonb OR d->'spend' IS NULL)
            AND d->'viewer'->'capabilities' ? 'contribute_funds'
            AND (d->'setup'->>'funded')::boolean
       FROM (SELECT org.get_workspace_detail('business', 'heliafinance') d) x),
    'plain member: the money tiles (Finance opens), no spend block, the same setup facts');
RESET ROLE;
-- #endregion
ROLLBACK;
