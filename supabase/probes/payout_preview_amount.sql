-- =============================================================================================
-- Probe: the Payouts module's Preview and its gates (Teams work order C4, Decision #234).
--
-- `finance.preview_team_split(team, gross_minor)` prices a release of ANY size through the plan the
-- release runs (`finance.fn_team_split_plan`): the platform's standard fee rate, truncated, then the
-- team's stored rule and stakes. Whatever the amount and the template, the ledger must conserve the
-- input exactly — fee + finder + vault cut + Σ members + dust = gross — and carry the active rule's
-- `finder_bp`. Without an amount the function still prices the team's oldest held escrow (or nothing).
-- An amount outside 1 … 10^12 minor units and a caller who is not a member are refused.
--
-- `org.get_workspace_detail`'s payout block also answers the templates the team's plan unlocks (one
-- `split_template_<type>` flag each) and every active member's vault capabilities
-- (`org.fn_vault_capabilities_for`), so the editor knows a locked template before it saves and shows
-- who can move money.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/payout_preview_amount.sql
--
-- Fixture (seeded data): a Pro Team team T (every split_template_* flag) whose owner O holds
-- manage_finances and which has a second active member F; a Team Free team FR (co_op only) with owner
-- FO; and a freelancer X who is not a member of T. On a database whose preview takes no amount, the
-- first priced call fails with 42883. A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;
-- @prelude

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Every minor unit of one preview, summed: fee + finder + vault cut + members + dust.
CREATE FUNCTION pg_temp.ledger_total(p_out jsonb) RETURNS bigint LANGUAGE sql AS $$
    SELECT (p_out ->> 'fee_minor')::bigint
         + (p_out -> 'plan' ->> 'finder_minor')::bigint
         + (p_out -> 'plan' ->> 'vault_minor')::bigint
         + COALESCE((SELECT sum((m ->> 'amount_minor')::bigint)
                       FROM jsonb_array_elements(p_out -> 'plan' -> 'members') m), 0)
         + (p_out -> 'plan' ->> 'dust_minor')::bigint;
$$;

-- Price `p_amounts` for team `p_team` as `p_actor`; every preview must echo its gross, charge the
-- standard fee truncated, and conserve the input to the minor unit.
CREATE FUNCTION pg_temp.expect_conserved(p_label text, p_actor uuid, p_team uuid, p_amounts bigint[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_rate integer := finance.fn_escrow_fee_bp(NULL, NULL);
    v_amount bigint;
    v_out jsonb;
BEGIN
    PERFORM pg_temp.act(p_actor);
    FOREACH v_amount IN ARRAY p_amounts LOOP
        v_out := finance.preview_team_split(p_team, v_amount);
        IF (v_out ->> 'gross_minor')::bigint IS DISTINCT FROM v_amount THEN
            RAISE EXCEPTION 'FAIL % — gross % for an input of %', p_label, v_out ->> 'gross_minor', v_amount;
        END IF;
        IF (v_out ->> 'fee_bp')::integer IS DISTINCT FROM v_rate
           OR (v_out ->> 'fee_minor')::bigint IS DISTINCT FROM (v_amount * v_rate) / 10000 THEN
            RAISE EXCEPTION 'FAIL % — fee % at % bp on %, expected % at % bp', p_label,
                v_out ->> 'fee_minor', v_out ->> 'fee_bp', v_amount, (v_amount * v_rate) / 10000, v_rate;
        END IF;
        IF pg_temp.ledger_total(v_out) IS DISTINCT FROM v_amount THEN
            RAISE EXCEPTION 'FAIL % — the ledger totals % for an input of % (%)', p_label,
                pg_temp.ledger_total(v_out), v_amount, v_out;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS % (% amounts conserved at % bp)', p_label, cardinality(p_amounts), v_rate;
END $$;

-- Run p_sql as p_actor; it must be refused with SQLSTATE p_state and a message starting p_prefix.
CREATE FUNCTION pg_temp.expect_refused(p_label text, p_actor uuid, p_sql text, p_state text, p_prefix text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    PERFORM pg_temp.act(p_actor);
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_state IS NULL THEN
        RAISE EXCEPTION 'FAIL % — the preview answered', p_label;
    END IF;
    IF v_state <> p_state OR v_msg NOT LIKE p_prefix || '%' THEN
        RAISE EXCEPTION 'FAIL % — refused % "%" (expected % %)', p_label, v_state, v_msg, p_state, p_prefix;
    END IF;
    RAISE NOTICE 'PASS % (% %)', p_label, v_state, split_part(v_msg, ':', 1);
END $$;

CREATE TEMP TABLE probe_amounts (amounts bigint[]);
INSERT INTO probe_amounts VALUES (ARRAY[1, 7, 19, 99, 100, 101, 333, 100000, 123457, 999999, 31415926,
    999999999, 1000000000000]::bigint[]);
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_team uuid;
    v_owner uuid;
    v_finder uuid;
    v_free_team uuid;
    v_free_owner uuid;
    v_stranger uuid;
BEGIN
    SELECT t.id, t.owner_user_id, m.user_id INTO v_team, v_owner, v_finder
      FROM org.teams t
      JOIN org.team_members m ON m.team_id = t.id AND m.status = 'active' AND m.user_id <> t.owner_user_id
     WHERE t.status = 'active' AND finance.fn_has_entitlement('team', t.id, 'split_template_finders_fee')
       AND finance.fn_has_entitlement('team', t.id, 'split_template_benevolent_dictator')
     ORDER BY t.slug, m.user_id
     LIMIT 1;

    SELECT t.id, t.owner_user_id INTO v_free_team, v_free_owner
      FROM org.teams t
     WHERE t.status = 'active' AND finance.fn_has_entitlement('team', t.id, 'split_template_co_op')
       AND NOT finance.fn_has_entitlement('team', t.id, 'split_template_finders_fee')
       AND NOT finance.fn_has_entitlement('team', t.id, 'split_template_benevolent_dictator')
     ORDER BY t.slug
     LIMIT 1;

    SELECT fp.user_id INTO v_stranger
      FROM org.freelancer_profiles fp
     WHERE NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.user_id = fp.user_id AND m.team_id = v_team)
     ORDER BY fp.user_id
     LIMIT 1;

    IF v_finder IS NULL OR v_free_owner IS NULL OR v_stranger IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (pro team %, free team %, stranger %) — deno task db:reset',
            v_team, v_free_team, v_stranger;
    END IF;

    INSERT INTO probe_ids (k, id) VALUES
        ('T', v_team), ('O', v_owner), ('F', v_finder), ('FR', v_free_team), ('FO', v_free_owner),
        ('X', v_stranger);
    RAISE NOTICE 'fixture: pro team % (owner %, member %), free team % (owner %), stranger %',
        v_team, v_owner, v_finder, v_free_team, v_free_owner, v_stranger;
END $$;
-- #endregion

-- #region 1. Grants — authenticated may price a release, anon may not
DO $$
BEGIN
    IF NOT has_function_privilege('authenticated', 'finance.preview_team_split(uuid, bigint)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 1 authenticated cannot execute finance.preview_team_split(uuid, bigint)';
    END IF;
    IF has_function_privilege('anon', 'finance.preview_team_split(uuid, bigint)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 1 anon can execute finance.preview_team_split(uuid, bigint)';
    END IF;
    RAISE NOTICE 'PASS 1 grants (authenticated yes, anon no)';
END $$;
-- #endregion

-- #region 2. Every template conserves the input
SELECT pg_temp.act(pg_temp.id('O'));
SELECT finance.save_split_rule(pg_temp.id('T'), 'co_op', 1250);
SELECT pg_temp.expect_conserved('2a co_op with a 12.5% vault cut', pg_temp.id('O'), pg_temp.id('T'),
    (SELECT amounts FROM probe_amounts));

SELECT pg_temp.act(pg_temp.id('O'));
SELECT finance.save_split_rule(pg_temp.id('T'), 'finders_fee', 700, pg_temp.id('F'), 1100);
SELECT pg_temp.expect_conserved('2b finders_fee 11% + vault 7%', pg_temp.id('O'), pg_temp.id('T'),
    (SELECT amounts FROM probe_amounts));
DO $$
DECLARE
    v_out jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('O'));
    v_out := finance.preview_team_split(pg_temp.id('T'), 100000);
    IF (v_out ->> 'finder_bp')::integer IS DISTINCT FROM 1100
       OR (v_out -> 'plan' ->> 'finder_user_id')::uuid IS DISTINCT FROM pg_temp.id('F')
       OR (v_out -> 'plan' ->> 'finder_minor')::bigint <= 0 THEN
        RAISE EXCEPTION 'FAIL 2c the finder''s cut is not named: %', v_out;
    END IF;
    RAISE NOTICE 'PASS 2c the finder''s rate and cut travel with the preview (% minor)',
        v_out -> 'plan' ->> 'finder_minor';
END $$;

SELECT pg_temp.act(pg_temp.id('O'));
SELECT finance.save_split_rule(pg_temp.id('T'), 'benevolent_dictator', 10000);
SELECT pg_temp.expect_conserved('2d benevolent_dictator', pg_temp.id('O'), pg_temp.id('T'),
    (SELECT amounts FROM probe_amounts));
DO $$
DECLARE
    v_out jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('O'));
    v_out := finance.preview_team_split(pg_temp.id('T'), 100000);
    IF jsonb_array_length(v_out -> 'plan' -> 'members') <> 0
       OR (v_out -> 'plan' ->> 'vault_minor')::bigint <> (v_out -> 'plan' ->> 'payout_minor')::bigint
       OR v_out ->> 'finder_bp' IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL 2e benevolent_dictator pays somebody but the vault: %', v_out;
    END IF;
    RAISE NOTICE 'PASS 2e benevolent_dictator sends the whole payout to the vault';
END $$;

SELECT pg_temp.expect_conserved('2f a Team Free team (its stored rule)', pg_temp.id('FO'), pg_temp.id('FR'),
    (SELECT amounts FROM probe_amounts));
-- #endregion

-- #region 3. Refusals
SELECT pg_temp.expect_refused('3a an amount of 0 is refused', pg_temp.id('O'),
    format($q$SELECT finance.preview_team_split(%L, 0)$q$, pg_temp.id('T')), '22023', 'gross_minor:');
SELECT pg_temp.expect_refused('3b a negative amount is refused', pg_temp.id('O'),
    format($q$SELECT finance.preview_team_split(%L, -100)$q$, pg_temp.id('T')), '22023', 'gross_minor:');
SELECT pg_temp.expect_refused('3c an amount above 10^12 is refused', pg_temp.id('O'),
    format($q$SELECT finance.preview_team_split(%L, 1000000000001)$q$, pg_temp.id('T')), '22023', 'gross_minor:');
SELECT pg_temp.expect_refused('3d a non-member is refused', pg_temp.id('X'),
    format($q$SELECT finance.preview_team_split(%L, 100000)$q$, pg_temp.id('T')), '42501', 'workspace:');
SELECT pg_temp.expect_refused('3e signed out is refused', NULL,
    format($q$SELECT finance.preview_team_split(%L, 100000)$q$, pg_temp.id('T')), '42501', 'workspace:');
-- #endregion

-- #region 4. Without an amount the held escrow (or nothing) is still what is priced
DO $$
DECLARE
    v_out jsonb;
    v_held bigint;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('O'));
    v_out := finance.preview_team_split(pg_temp.id('T'));
    SELECT e.amount_cents + COALESCE(e.deadline_bonus_cents, 0) INTO v_held
      FROM finance.escrows e
     WHERE e.payee_type = 'team' AND e.payee_id = pg_temp.id('T') AND e.status = 'held'
     ORDER BY e.created_at, e.id
     LIMIT 1;
    IF (v_out ->> 'gross_minor')::bigint IS DISTINCT FROM v_held OR NOT (v_out ? 'finder_bp') THEN
        RAISE EXCEPTION 'FAIL 4 the one-argument preview priced % (held escrow %): %',
            v_out ->> 'gross_minor', v_held, v_out;
    END IF;
    RAISE NOTICE 'PASS 4 the one-argument preview prices the held escrow (%)', COALESCE(v_held::text, 'none held');
END $$;
-- #endregion

-- #region 5. The detail's payout block answers the unlocked templates and the vault capabilities
DO $$
DECLARE
    v_pro jsonb;
    v_free jsonb;
    v_caps jsonb;
    v_active integer;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('O'));
    v_pro := org.get_workspace_detail('team', pg_temp.id('T')::text) -> 'payout';
    IF v_pro -> 'unlocked_templates' IS DISTINCT FROM '["co_op", "finders_fee", "benevolent_dictator"]'::jsonb THEN
        RAISE EXCEPTION 'FAIL 5a a Pro Team team unlocks %', v_pro -> 'unlocked_templates';
    END IF;
    RAISE NOTICE 'PASS 5a a Pro Team team unlocks every template';

    PERFORM pg_temp.act(pg_temp.id('FO'));
    v_free := org.get_workspace_detail('team', pg_temp.id('FR')::text) -> 'payout';
    IF v_free -> 'unlocked_templates' IS DISTINCT FROM '["co_op"]'::jsonb THEN
        RAISE EXCEPTION 'FAIL 5b a Team Free team unlocks %', v_free -> 'unlocked_templates';
    END IF;
    RAISE NOTICE 'PASS 5b a Team Free team unlocks co_op only';

    SELECT count(*) INTO v_active FROM org.team_members m WHERE m.team_id = pg_temp.id('T') AND m.status = 'active';
    IF jsonb_array_length(v_pro -> 'vault_capabilities') <> v_active THEN
        RAISE EXCEPTION 'FAIL 5c % vault rows for % active members', jsonb_array_length(v_pro -> 'vault_capabilities'), v_active;
    END IF;
    SELECT r -> 'capabilities' INTO v_caps
      FROM jsonb_array_elements(v_pro -> 'vault_capabilities') r
     WHERE (r ->> 'user_id')::uuid = pg_temp.id('O');
    IF NOT (v_caps @> '["view", "distribute", "withdraw", "manage_members"]'::jsonb) THEN
        RAISE EXCEPTION 'FAIL 5d the owner projects %', v_caps;
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_pro -> 'vault_capabilities') r
         WHERE (r -> 'capabilities') IS DISTINCT FROM
               to_jsonb(org.fn_vault_capabilities_for('team', pg_temp.id('T'), (r ->> 'user_id')::uuid))
    ) THEN
        RAISE EXCEPTION 'FAIL 5e a member''s row is not the projection: %', v_pro -> 'vault_capabilities';
    END IF;
    RAISE NOTICE 'PASS 5c-e one row per active member, each the projection (owner %)', v_caps;
END $$;
-- #endregion

ROLLBACK;
