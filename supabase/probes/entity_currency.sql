-- entity_currency.sql — an entity's currency comes from its owner's confirmed country, never the display
-- preference, and nothing is priced outside the settlement currencies (FINANCE DB9: FA C1, C16, C17;
-- FCA N37; Decision #337, ruling M5 (a), (b); #423 (B)).
--
-- Rolled back; writes nothing:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/entity_currency.sql
--   1. org.fn_currency_for_country: the country's currency when it settles, else the platform base
--      (GBP): DE → EUR, JP → JPY, US → USD, gb → GBP; IN, AE and NG (display-only) → GBP; none → GBP.
--   2. A team made by an owner whose confirmed country is DE gets an EUR wallet although their display
--      currency is USD; a business made by a CH owner is CHF (row and wallet); an owner with no country
--      gets GBP, and one in IN gets GBP.
--   3. A project with no currency takes its owner's: a JP person's personal project is JPY, a project of
--      the DE owner's team is EUR. A listing with no currency takes its owner's (EUR).
--   4. A project, listing, product or blueprint priced outside settlement_currencies is refused (22023),
--      through its door and by a direct write.
--   5. Sign-up: the confirmed country in the metadata lands in org.user_preferences.country, and an
--      enterprise's currency is its registered country's (JP → JPY).
--   6. No USD default is left on an entity's currency column.
--   7. The alert a Transfer refused for a short balance writes is the service role's to insert and a
--      money alert (MR4) carries it.
\set ON_ERROR_STOP on
\set QUIET on

BEGIN;

-- #region Helpers
CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- Runs one statement inside a subtransaction; returns its SQLSTATE, or 'accepted'.
CREATE OR REPLACE FUNCTION pg_temp.refusal(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
        RETURN v_state;
    END;
    RETURN 'accepted';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.uid(p_username text) RETURNS uuid LANGUAGE sql AS $$
    SELECT user_id FROM org.users_public WHERE username = p_username;
$$;

CREATE OR REPLACE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- The owner's confirmed country and a display currency that must not leak into anything.
CREATE OR REPLACE FUNCTION pg_temp.prefs(p_username text, p_country text, p_display text) RETURNS void
LANGUAGE sql AS $$
    UPDATE org.user_preferences SET country = p_country, preferred_display_currency = p_display
     WHERE user_id = pg_temp.uid(p_username);
$$;

CREATE OR REPLACE FUNCTION pg_temp.legal_stamp() RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'terms', org.fn_current_legal_version('terms'),
        'acceptable-use', org.fn_current_legal_version('acceptable-use'),
        'privacy', org.fn_current_legal_version('privacy'));
$$;
-- #endregion

-- #region 1. One country → currency map, clamped to the settlement currencies
SELECT pg_temp.ok(org.fn_currency_for_country('DE') = 'EUR', '1: DE → EUR');
SELECT pg_temp.ok(org.fn_currency_for_country('JP') = 'JPY', '1: JP → JPY');
SELECT pg_temp.ok(org.fn_currency_for_country('US') = 'USD', '1: US → USD');
SELECT pg_temp.ok(org.fn_currency_for_country(' gb ') = 'GBP', '1: a lower-case, padded code reads too');
SELECT pg_temp.ok(org.fn_currency_for_country('IN') = 'GBP', '1: IN (INR, display-only) → GBP');
SELECT pg_temp.ok(org.fn_currency_for_country('AE') = 'GBP', '1: AE (AED, display-only) → GBP');
SELECT pg_temp.ok(org.fn_currency_for_country('NG') = 'GBP', '1: NG (NGN, display-only) → GBP');
SELECT pg_temp.ok(org.fn_currency_for_country(NULL) = 'GBP', '1: no country → GBP');
SELECT pg_temp.ok(org.fn_currency_for_country('ZZ') = 'GBP', '1: an unknown country → GBP');
-- #endregion

-- #region 2. Team and business wallets from the owner's country
SELECT pg_temp.prefs('lenamueller', 'DE', 'USD');
SELECT pg_temp.prefs('hannahcole', 'CH', 'USD');
SELECT pg_temp.prefs('chloewinters', NULL, 'USD');
SELECT pg_temp.prefs('theo', 'IN', 'INR');
SELECT pg_temp.prefs('aikotanaka', 'JP', 'GBP');

CREATE TEMP TABLE made (k text PRIMARY KEY, id uuid);
DO $$
BEGIN
    PERFORM pg_temp.act(pg_temp.uid('lenamueller'));
    INSERT INTO made VALUES ('team', (org.create_workspace('team', 'Probe Euro Team', 'probe-db9-team') ->> 'id')::uuid);
    PERFORM pg_temp.act(pg_temp.uid('hannahcole'));
    INSERT INTO made VALUES ('chf', (org.create_workspace('business', 'Probe Franc Co', 'probe-db9-chf') ->> 'id')::uuid);
    PERFORM pg_temp.act(pg_temp.uid('chloewinters'));
    INSERT INTO made VALUES ('none', (org.create_workspace('business', 'Probe Nowhere Co', 'probe-db9-none') ->> 'id')::uuid);
    PERFORM pg_temp.act(pg_temp.uid('theo'));
    INSERT INTO made VALUES ('inr', (org.create_workspace('business', 'Probe Rupee Co', 'probe-db9-inr') ->> 'id')::uuid);
END $$;
RESET request.jwt.claims;

SELECT pg_temp.ok(
    (SELECT w.currency FROM org.teams t JOIN finance.wallets w ON w.id = t.treasury_wallet_id
      WHERE t.id = (SELECT id FROM made WHERE k = 'team')) = 'EUR',
    '2: a DE owner''s team wallet is EUR, not their USD display currency');
SELECT pg_temp.ok(
    (SELECT b.default_currency FROM org.business_profiles b WHERE b.id = (SELECT id FROM made WHERE k = 'chf')) = 'CHF'
    AND (SELECT array_agg(w.currency) FROM finance.wallets w
          WHERE w.owner_type = 'business' AND w.owner_id = (SELECT id FROM made WHERE k = 'chf')) = ARRAY['CHF'],
    '2: a CH owner''s business and its wallet are CHF');
SELECT pg_temp.ok(
    (SELECT b.default_currency FROM org.business_profiles b WHERE b.id = (SELECT id FROM made WHERE k = 'none')) = 'GBP',
    '2: an owner with no country gets GBP');
SELECT pg_temp.ok(
    (SELECT b.default_currency FROM org.business_profiles b WHERE b.id = (SELECT id FROM made WHERE k = 'inr')) = 'GBP',
    '2: an IN owner gets GBP (INR is display-only)');
-- #endregion

-- #region 3. A project and a listing default to their owner's currency
DO $$
BEGIN
    PERFORM pg_temp.act(pg_temp.uid('aikotanaka'));
    INSERT INTO made VALUES ('jp_project',
        (projects.create_project(jsonb_build_object('title', 'Probe yen project', 'is_personal', true)) ->> 'id')::uuid);
    PERFORM pg_temp.act(pg_temp.uid('lenamueller'));
    INSERT INTO made VALUES ('team_project', (projects.create_project(jsonb_build_object(
        'title', 'Probe team project', 'owner_team_id', (SELECT id FROM made WHERE k = 'team'))) ->> 'id')::uuid);
    INSERT INTO made VALUES ('listing',
        (catalogue.create_listing('product', 'Probe euro product') ->> 'listing_id')::uuid);
END $$;
RESET request.jwt.claims;

SELECT pg_temp.ok(
    (SELECT currency FROM projects.projects WHERE id = (SELECT id FROM made WHERE k = 'jp_project')) = 'JPY',
    '3: a JP owner''s new project is in JPY');
SELECT pg_temp.ok(
    (SELECT currency FROM projects.projects WHERE id = (SELECT id FROM made WHERE k = 'team_project')) = 'EUR',
    '3: a project of the DE owner''s team is in the team''s EUR');
SELECT pg_temp.ok(
    (SELECT l.currency = 'EUR' AND p.currency = 'EUR' FROM catalogue.listings l
       JOIN catalogue.products p ON p.id = l.product_id
      WHERE l.id = (SELECT id FROM made WHERE k = 'listing')),
    '3: a DE seller''s new listing and its product are in EUR');
-- #endregion

-- #region 4. Nothing is priced outside the settlement currencies
SELECT pg_temp.act(pg_temp.uid('lenamueller'));
SELECT pg_temp.ok(pg_temp.refusal($q$SELECT catalogue.create_listing('product', 'Probe rupee product', NULL, NULL, 'INR')$q$) = '22023',
    '4: create_listing in INR is refused (22023)');
SELECT pg_temp.ok(pg_temp.refusal($q$SELECT projects.create_project(jsonb_build_object('title', 'Probe naira', 'currency', 'NGN'))$q$) = '22023',
    '4: create_project in NGN is refused (22023)');
RESET request.jwt.claims;
SELECT pg_temp.ok(pg_temp.refusal(format('UPDATE catalogue.listings SET currency = %L WHERE id = %L', 'AED',
    (SELECT id FROM made WHERE k = 'listing'))) = '22023',
    '4: a direct write of a listing''s currency to AED is refused (22023), whoever writes it');
SELECT pg_temp.ok(pg_temp.refusal(format('UPDATE catalogue.products SET currency = %L WHERE id = (SELECT product_id FROM catalogue.listings WHERE id = %L)',
    'INR', (SELECT id FROM made WHERE k = 'listing'))) = '22023',
    '4: a direct write of a product''s currency to INR is refused (22023)');
SELECT pg_temp.ok(pg_temp.refusal(format('UPDATE marketplace.service_blueprints SET currency = %L WHERE id = (SELECT id FROM marketplace.service_blueprints LIMIT 1)',
    'NGN')) = '22023',
    '4: a direct write of a blueprint''s currency to NGN is refused (22023)');
SELECT pg_temp.ok(pg_temp.refusal(format('UPDATE projects.projects SET currency = %L WHERE id = %L', 'INR',
    (SELECT id FROM made WHERE k = 'jp_project'))) = '22023',
    '4: a direct write of a project''s currency to INR is refused (22023)');
SELECT pg_temp.ok(pg_temp.refusal(format('UPDATE projects.projects SET currency = %L WHERE id = %L', 'CHF',
    (SELECT id FROM made WHERE k = 'jp_project'))) = 'accepted',
    '4: a settlement currency (CHF) is accepted');
-- #endregion

-- #region 5. Sign-up records the confirmed country; an enterprise takes its registered country's currency
DO $$
DECLARE
    v_tag text := substr(md5(random()::text), 1, 8);
    v_owner uuid;
    v_ent uuid;
BEGIN
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'db9-probe-' || v_tag || '@projective.invalid', 'authenticated', 'authenticated',
            jsonb_build_object('objective', 'enterprise', 'locale', 'ja-JP', 'display_currency', 'USD', 'country', 'jp'))
    RETURNING id INTO v_owner;
    v_ent := public.create_enterprise(v_owner, jsonb_build_object(
        'legalAcceptance', pg_temp.legal_stamp(), 'legalName', 'DB9 Probe ' || v_tag || ' KK',
        'handle', 'db9-probe-' || v_tag, 'corporateEmail', 'db9-probe-' || v_tag || '@projective.invalid',
        'addressCountry', 'JP',
        'owner', jsonb_build_object('firstName', 'Ada', 'lastName', 'Probe', 'username', 'db9-ada-' || v_tag,
            'dob', (CURRENT_DATE - make_interval(years => 30))::date, 'timeZone', 'Asia/Tokyo')));
    INSERT INTO made VALUES ('ent_owner', v_owner), ('ent', v_ent);
END $$;
SELECT pg_temp.ok(
    (SELECT country FROM org.user_preferences WHERE user_id = (SELECT id FROM made WHERE k = 'ent_owner')) = 'JP',
    '5: the confirmed sign-up country lands in org.user_preferences.country, upper-cased');
SELECT pg_temp.ok(
    (SELECT default_currency FROM org.enterprises WHERE id = (SELECT id FROM made WHERE k = 'ent')) = 'JPY',
    '5: an enterprise registered in JP is JPY');
SELECT pg_temp.ok(pg_temp.refusal(format('UPDATE org.user_preferences SET country = %L WHERE user_id = %L', 'JPN',
    (SELECT id FROM made WHERE k = 'ent_owner'))) IN ('23514', '22001'),
    '5: a country is a two-letter code');
-- #endregion

-- #region 6. No USD default is left on an entity's currency
SELECT pg_temp.ok(count(*) = 0,
    '6: no entity currency column defaults to USD'
       || COALESCE(' (still: ' || string_agg(c.table_schema || '.' || c.table_name || '.' || c.column_name, ', ') || ')', ''))
  FROM information_schema.columns c
 WHERE (c.table_schema, c.table_name, c.column_name) IN (
           ('projects', 'projects', 'currency'), ('catalogue', 'listings', 'currency'),
           ('catalogue', 'products', 'currency'), ('marketplace', 'service_blueprints', 'currency'),
           ('org', 'business_profiles', 'default_currency'), ('org', 'enterprises', 'default_currency'))
   AND c.column_default LIKE '%USD%';
-- #endregion

-- #region 7. A Transfer refused for a short balance becomes a money alert
-- The row PaymentBackendService writes (alertSettlementBalance) after finance.fail_payout returned the
-- money: the service role may insert it, and an enabled `level` rule carries it to a person.
SET LOCAL ROLE service_role;
INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
VALUES ('payout:probe:balance_insufficient', 'error', 'probe', now(), 'server', 'finance.settlement_balance',
        '{"code": "balance_insufficient", "currency": "EUR"}'::jsonb);
RESET ROLE;
SELECT pg_temp.ok(
    EXISTS (SELECT 1 FROM ops.alert_rules r
             WHERE r.enabled AND r.kind = 'level' AND 'finance.settlement_balance' LIKE r.scope_pattern),
    '7: the service role writes a finance.settlement_balance error, and a money-alert rule matches it');
-- #endregion

ROLLBACK;
