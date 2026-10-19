-- BU1 review — org.get_workspace_roster('business') answers a business's 30-day spend (`money_30d`)
-- only to a member who may open Finance — contribute_funds · spend_funds · manage_finances, the
-- predicate org.get_workspace_detail answers `money_tiles` under (`v_sees_money`). Anybody else gets
-- JSON null (withheld), never `[]` (nothing moved), so the roster can drop the figure rather than
-- say nothing was spent. A team's earned money is untouched. Run on a reset DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/probes/business_roster_spend.sql
-- Everything runs in one transaction and is rolled back.
BEGIN;
-- Helia Finance (priyaraman owner, hannahcole admin; USD debits in the last 30 days in the seed).
-- Rolled back: noor joins on a custom Observer role (view_analytics only — the Teams C3 template),
-- theo as a plain Member (the preset holds contribute_funds), juno as a Member whose
-- contribute_funds is revoked, and one fresh USD debit so the figure is never seed-date dependent.
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

-- The viewer's roster row for one business: its `money_30d` exactly as the roster answers it.
CREATE FUNCTION pg_temp.spend(p_kind text, p_slug text) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT i->'money_30d' FROM jsonb_array_elements(org.get_workspace_roster(p_kind)->'items') i
     WHERE i->>'handle' = p_slug;
$f$;

-- Whether the viewer's roster carries a row for the business at all (a null figure is not a missing row).
CREATE FUNCTION pg_temp.has_row(p_kind text, p_slug text) RETURNS boolean LANGUAGE sql AS $f$
    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(org.get_workspace_roster(p_kind)->'items') i
                    WHERE i->>'handle' = p_slug);
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.act(text), pg_temp.check(boolean, text), pg_temp.spend(text, text),
    pg_temp.has_row(text, text) TO authenticated;

INSERT INTO org.business_roles (business_id, name, summary, preset, base_preset, capabilities)
SELECT b.id, 'Probe Observer', 'Reads analytics only', NULL, 'member', ARRAY['view_analytics']::org.workspace_capability[]
  FROM org.business_profiles b WHERE b.slug = 'heliafinance';
INSERT INTO org.business_members (business_id, user_id, role_id, role)
SELECT b.id, u.user_id, r.id, 'member'
  FROM org.business_profiles b JOIN org.business_roles r ON r.business_id = b.id AND r.name = 'Probe Observer'
  JOIN org.users_public u ON u.username = 'noor'
 WHERE b.slug = 'heliafinance';
INSERT INTO org.business_members (business_id, user_id, role_id, role)
SELECT b.id, u.user_id, r.id, 'member'
  FROM org.business_profiles b JOIN org.business_roles r ON r.business_id = b.id AND r.preset = 'member'
  JOIN org.users_public u ON u.username IN ('theo', 'juno')
 WHERE b.slug = 'heliafinance';
UPDATE org.business_members m SET revoked_capabilities = ARRAY['contribute_funds']::org.workspace_capability[]
  FROM org.users_public u, org.business_profiles b
 WHERE u.user_id = m.user_id AND u.username = 'juno' AND b.id = m.business_id AND b.slug = 'heliafinance';
INSERT INTO finance.transactions (wallet_id, direction, amount_cents, currency, reason, balance_after_cents)
SELECT w.id, 'debit', 12345, w.currency, 'probe_purchase', w.balance_cents
  FROM finance.wallets w JOIN org.business_profiles b ON b.id = w.owner_id AND w.owner_type = 'business'
 WHERE b.slug = 'heliafinance' AND upper(w.currency) = 'USD';

-- #region Viewers who may open Finance get the figures
SELECT pg_temp.act('priyaraman');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(jsonb_typeof(pg_temp.spend('business', 'heliafinance')) = 'array'
                     AND (SELECT (e->>'minor')::bigint >= 12345 FROM jsonb_array_elements(pg_temp.spend('business', 'heliafinance')) e
                           WHERE e->>'currency' = 'USD'),
                     'the owner reads Helia''s USD spend, the fresh debit included');
RESET ROLE;

SELECT pg_temp.act('hannahcole');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(jsonb_typeof(pg_temp.spend('business', 'heliafinance')) = 'array'
                     AND jsonb_array_length(pg_temp.spend('business', 'heliafinance')) >= 1,
                     'an admin (manage_finances) reads the spend');
RESET ROLE;

SELECT pg_temp.act('theo');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(jsonb_typeof(pg_temp.spend('business', 'heliafinance')) = 'array'
                     AND jsonb_array_length(pg_temp.spend('business', 'heliafinance')) >= 1,
                     'a plain Member (contribute_funds) reads the spend, as #248 lets them open Finance');
RESET ROLE;
-- #endregion

-- #region Viewers who may not open Finance get it withheld
SELECT pg_temp.act('noor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(pg_temp.has_row('business', 'heliafinance'), 'the Observer still sees Helia on the roster');
SELECT pg_temp.check(pg_temp.spend('business', 'heliafinance') = 'null'::jsonb,
                     'an Observer (view_analytics only) gets the spend withheld — null, not []');
SELECT pg_temp.check(NOT (org.get_workspace_detail('business', 'heliafinance')->'money_tiles' @> '[{"currency": "USD"}]'::jsonb),
                     'and the console withholds the same person''s money tiles — the two reads agree');
RESET ROLE;

SELECT pg_temp.act('juno');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(pg_temp.spend('business', 'heliafinance') = 'null'::jsonb,
                     'a Member whose contribute_funds is revoked gets the spend withheld (revocation wins)');
RESET ROLE;
-- #endregion

-- #region The other business and a team are unchanged
SELECT pg_temp.act('miguelsantos');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(jsonb_typeof(pg_temp.spend('business', 'atlaslabs')) = 'array',
                     'Atlas''s Member (contribute_funds + grants) reads Atlas''s spend');
RESET ROLE;

SELECT pg_temp.act((SELECT u.username FROM org.team_members m JOIN org.users_public u ON u.user_id = m.user_id
                     WHERE m.status = 'active' ORDER BY u.username LIMIT 1));
SET LOCAL ROLE authenticated;
SELECT pg_temp.check((SELECT bool_and(jsonb_typeof(i->'money_30d') = 'array')
                        FROM jsonb_array_elements(org.get_workspace_roster('team')->'items') i),
                     'a team''s earned money is still answered to every member as an array');
RESET ROLE;
-- #endregion
ROLLBACK;
