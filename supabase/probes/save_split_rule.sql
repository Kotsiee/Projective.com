-- =============================================================================================
-- Probe: finance.save_split_rule — a team's split TEMPLATE is writable (Teams audit F11 / §4.4,
-- Decision #228 (F)).
--
-- Before this RPC `finance.split_rules` had no writer at all (only the seed inserted), so every
-- live-created team was co_op with no vault cut. The door must: refuse a caller without
-- `manage_finances`, an archived team, a finder who is not an active member, and cuts that together
-- exceed 100%; retire the previous active row (`active = false`, kept) rather than delete it; and keep
-- exactly one active row per team. Which templates a team's plan unlocks is data — one
-- `split_template_<type>` flag per template in finance.plan_entitlements (Decision #226 (d): co_op
-- free, finders_fee and benevolent_dictator Pro), refused PK402 `entitlement:` without it.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/save_split_rule.sql
--
-- Fixture (seeded data): a team T whose owner O holds manage_finances and every split_template_*
-- entitlement (Pro Team), with a second active member F; a team L with an active `lead` member LD (no
-- manage_finances); a freelancer X who belongs to neither team; and a team FR whose plan unlocks
-- co_op only (Team Free), whose owner FO holds manage_finances. On a database without the RPC the first call
-- fails with 42883. A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Every split rule of a team, oldest first: id, type, cuts and whether it is the active one.
CREATE FUNCTION pg_temp.rules(p_team uuid) RETURNS text LANGUAGE sql AS $$
    SELECT COALESCE(string_agg(format('%s %s v%s f%s/%s %s', r.id, r.rule_type, r.vault_bp, r.finder_user_id,
                                      r.finder_bp, CASE WHEN r.active THEN 'ACTIVE' ELSE 'retired' END),
                               ' | ' ORDER BY r.created_at, r.id), '(none)')
      FROM finance.split_rules r WHERE r.team_id = p_team;
$$;

-- Run p_sql as p_actor; it must be refused with SQLSTATE p_state and a message starting p_prefix,
-- and the team's rules must not have moved.
CREATE FUNCTION pg_temp.expect_refused(
    p_label text, p_actor uuid, p_team uuid, p_sql text, p_state text, p_prefix text
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_before text := pg_temp.rules(p_team);
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
        RAISE EXCEPTION 'FAIL % — the save went through (%)', p_label, pg_temp.rules(p_team);
    END IF;
    IF v_state <> p_state OR v_msg NOT LIKE p_prefix || '%' THEN
        RAISE EXCEPTION 'FAIL % — refused % "%" (expected % %)', p_label, v_state, v_msg, p_state, p_prefix;
    END IF;
    IF pg_temp.rules(p_team) IS DISTINCT FROM v_before THEN
        RAISE EXCEPTION 'FAIL % — refused, yet the rules moved: % → %', p_label, v_before, pg_temp.rules(p_team);
    END IF;
    RAISE NOTICE 'PASS % (% %)', p_label, v_state, split_part(v_msg, ':', 1);
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_team uuid;
    v_owner uuid;
    v_finder uuid;
    v_lead_team uuid;
    v_lead uuid;
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

    SELECT t.id, m.user_id INTO v_lead_team, v_lead
      FROM org.teams t
      JOIN org.team_members m ON m.team_id = t.id AND m.status = 'active'
      JOIN org.team_roles r ON r.id = m.role_id AND r.base_preset = 'lead'
     WHERE t.status = 'active'
       AND NOT ('manage_finances' = ANY (org.fn_member_capabilities('team', t.id, m.user_id)))
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

    IF v_finder IS NULL OR v_lead IS NULL OR v_free_owner IS NULL OR v_stranger IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (pro team %, lead %, free team %, stranger %) — deno task db:reset',
            v_team, v_lead, v_free_team, v_stranger;
    END IF;

    INSERT INTO probe_ids (k, id) VALUES
        ('T', v_team), ('O', v_owner), ('F', v_finder), ('L', v_lead_team), ('LD', v_lead),
        ('FR', v_free_team), ('FO', v_free_owner), ('X', v_stranger);
    RAISE NOTICE 'fixture: pro team % (owner %, finder %), lead % on %, free team % (owner %), stranger %',
        v_team, v_owner, v_finder, v_lead, v_lead_team, v_free_team, v_free_owner, v_stranger;
END $$;
-- #endregion

-- #region 1. Grants — authenticated may call it, anon may not
DO $$
BEGIN
    IF NOT has_function_privilege('authenticated',
        'finance.save_split_rule(uuid, finance.split_rule_type, integer, uuid, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 1 authenticated cannot execute finance.save_split_rule';
    END IF;
    IF has_function_privilege('anon',
        'finance.save_split_rule(uuid, finance.split_rule_type, integer, uuid, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 1 anon can execute finance.save_split_rule';
    END IF;
    RAISE NOTICE 'PASS 1 grants (authenticated yes, anon no)';
END $$;
-- #endregion

-- #region 2. Authority and state
SELECT pg_temp.expect_refused('2a signed out is refused', NULL, pg_temp.id('T'),
    format($q$SELECT finance.save_split_rule(%L, 'co_op', 1000)$q$, pg_temp.id('T')), '42501', 'auth:');

SELECT pg_temp.expect_refused('2b a lead without manage_finances is refused', pg_temp.id('LD'), pg_temp.id('L'),
    format($q$SELECT finance.save_split_rule(%L, 'co_op', 1500)$q$, pg_temp.id('L')), '42501', 'rule:');

SELECT pg_temp.expect_refused('2c an outsider is refused', pg_temp.id('X'), pg_temp.id('T'),
    format($q$SELECT finance.save_split_rule(%L, 'co_op', 1500)$q$, pg_temp.id('T')), '42501', 'rule:');

SELECT pg_temp.expect_refused('2d an unknown team is not found', pg_temp.id('O'), pg_temp.id('T'),
    $q$SELECT finance.save_split_rule(gen_random_uuid(), 'co_op', 1500)$q$, 'P0002', 'workspace:');

DO $$
BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE org.teams SET status = 'archived' WHERE id = pg_temp.id('T');
    SET LOCAL session_replication_role = origin;
END $$;
SELECT pg_temp.expect_refused('2e an archived team is refused', pg_temp.id('O'), pg_temp.id('T'),
    format($q$SELECT finance.save_split_rule(%L, 'co_op', 1500)$q$, pg_temp.id('T')), '55000', 'workspace:');
DO $$
BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE org.teams SET status = 'active' WHERE id = pg_temp.id('T');
    SET LOCAL session_replication_role = origin;
END $$;
-- #endregion

-- #region 3. Validation
SELECT pg_temp.expect_refused('3a a vault cut above 100% is refused', pg_temp.id('O'), pg_temp.id('T'),
    format($q$SELECT finance.save_split_rule(%L, 'co_op', 10001)$q$, pg_temp.id('T')), '22023', 'vault_bp:');

SELECT pg_temp.expect_refused('3b a negative vault cut is refused', pg_temp.id('O'), pg_temp.id('T'),
    format($q$SELECT finance.save_split_rule(%L, 'co_op', -1)$q$, pg_temp.id('T')), '22023', 'vault_bp:');

SELECT pg_temp.expect_refused('3c a co_op rule naming a finder is refused', pg_temp.id('O'), pg_temp.id('T'),
    format($q$SELECT finance.save_split_rule(%L, 'co_op', 1000, %L, 500)$q$, pg_temp.id('T'), pg_temp.id('F')),
    '22023', 'finder_user_id:');

SELECT pg_temp.expect_refused('3d a benevolent_dictator rule naming a finder cut is refused', pg_temp.id('O'),
    pg_temp.id('T'),
    format($q$SELECT finance.save_split_rule(%L, 'benevolent_dictator', 10000, NULL, 500)$q$, pg_temp.id('T')),
    '22023', 'finder_bp:');

SELECT pg_temp.expect_refused('3e a finder who is not a member is refused', pg_temp.id('O'), pg_temp.id('T'),
    format($q$SELECT finance.save_split_rule(%L, 'finders_fee', 1000, %L, 500)$q$, pg_temp.id('T'), pg_temp.id('X')),
    '22023', 'finder_user_id:');

SELECT pg_temp.expect_refused('3f a finders_fee rule with no finder is refused', pg_temp.id('O'), pg_temp.id('T'),
    format($q$SELECT finance.save_split_rule(%L, 'finders_fee', 1000, NULL, 500)$q$, pg_temp.id('T')),
    '22023', 'finder_user_id:');

SELECT pg_temp.expect_refused('3g a finder cut of 0 is refused', pg_temp.id('O'), pg_temp.id('T'),
    format($q$SELECT finance.save_split_rule(%L, 'finders_fee', 1000, %L, 0)$q$, pg_temp.id('T'), pg_temp.id('F')),
    '22023', 'finder_bp:');

SELECT pg_temp.expect_refused('3h finder_bp + vault_bp above 100% is refused', pg_temp.id('O'), pg_temp.id('T'),
    format($q$SELECT finance.save_split_rule(%L, 'finders_fee', 6000, %L, 4001)$q$, pg_temp.id('T'), pg_temp.id('F')),
    '22023', 'finder_bp:');

DO $$
BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE org.team_members SET status = 'left', left_at = now()
     WHERE team_id = pg_temp.id('T') AND user_id = pg_temp.id('F');
    SET LOCAL session_replication_role = origin;
END $$;
SELECT pg_temp.expect_refused('3i a finder who has left is refused', pg_temp.id('O'), pg_temp.id('T'),
    format($q$SELECT finance.save_split_rule(%L, 'finders_fee', 1000, %L, 500)$q$, pg_temp.id('T'), pg_temp.id('F')),
    '22023', 'finder_user_id:');
DO $$
BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE org.team_members SET status = 'active', left_at = NULL
     WHERE team_id = pg_temp.id('T') AND user_id = pg_temp.id('F');
    SET LOCAL session_replication_role = origin;
END $$;
-- #endregion

-- #region 4. Two saves — one active row, the previous one retired and still present
DO $$
DECLARE
    v_before integer;
    v_first uuid;
    v_second uuid;
    v_audits integer;
    v_plan jsonb;
BEGIN
    SELECT count(*) INTO v_before FROM finance.split_rules WHERE team_id = pg_temp.id('T');
    SELECT count(*) INTO v_audits FROM security.audit_logs
     WHERE action = 'team.split_rule_changed' AND entity_id = pg_temp.id('T');

    PERFORM pg_temp.act(pg_temp.id('O'));
    v_first := finance.save_split_rule(pg_temp.id('T'), 'finders_fee', 1000, pg_temp.id('F'), 500);
    v_second := finance.save_split_rule(pg_temp.id('T'), 'co_op', 1500);

    IF (SELECT count(*) FROM finance.split_rules WHERE team_id = pg_temp.id('T')) <> v_before + 2 THEN
        RAISE EXCEPTION 'FAIL 4 a row was deleted or not written: %', pg_temp.rules(pg_temp.id('T'));
    END IF;
    IF (SELECT count(*) FROM finance.split_rules WHERE team_id = pg_temp.id('T') AND active) <> 1 THEN
        RAISE EXCEPTION 'FAIL 4 more or fewer than one active row: %', pg_temp.rules(pg_temp.id('T'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.split_rules WHERE id = v_second AND active
                     AND rule_type = 'co_op' AND vault_bp = 1500 AND finder_user_id IS NULL AND finder_bp IS NULL) THEN
        RAISE EXCEPTION 'FAIL 4 the second save is not the active co_op 1500 row: %', pg_temp.rules(pg_temp.id('T'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.split_rules WHERE id = v_first AND NOT active
                     AND rule_type = 'finders_fee' AND finder_user_id = pg_temp.id('F') AND finder_bp = 500) THEN
        RAISE EXCEPTION 'FAIL 4 the first save is not retired and kept: %', pg_temp.rules(pg_temp.id('T'));
    END IF;
    IF (SELECT count(*) FROM security.audit_logs
         WHERE action = 'team.split_rule_changed' AND entity_id = pg_temp.id('T')) <> v_audits + 2 THEN
        RAISE EXCEPTION 'FAIL 4 each save must write one team.split_rule_changed audit row';
    END IF;

    v_plan := finance.fn_team_split_plan(pg_temp.id('T'), 100000);
    IF (v_plan->>'rule_type') <> 'co_op' OR (v_plan->>'vault_bp')::int <> 1500 OR (v_plan->>'vault_minor')::bigint <> 15000 THEN
        RAISE EXCEPTION 'FAIL 4 the plan does not read the active rule: %', v_plan;
    END IF;
    RAISE NOTICE 'PASS 4 two saves: one active row, the previous retired and kept, two audit rows, the plan follows';
END $$;
-- #endregion

-- #region 5. Each template reaches the plan the release runs
DO $$
DECLARE
    v_id uuid;
    v_plan jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('O'));
    v_id := finance.save_split_rule(pg_temp.id('T'), 'finders_fee', 1000, pg_temp.id('F'), 500);
    v_plan := finance.fn_team_split_plan(pg_temp.id('T'), 100000);
    IF (v_plan->>'finder_user_id')::uuid IS DISTINCT FROM pg_temp.id('F')
       OR (v_plan->>'finder_minor')::bigint <> 5000 OR (v_plan->>'vault_minor')::bigint <> 9500 THEN
        RAISE EXCEPTION 'FAIL 5 finders_fee: finder 5%% of 100000 then vault 10%% of the rest — got %', v_plan;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.fn_team_shareholders(pg_temp.id('T')) s(uid) WHERE s.uid = pg_temp.id('F')) THEN
        RAISE EXCEPTION 'FAIL 5 finders_fee: the finder is not a shareholder';
    END IF;

    v_id := finance.save_split_rule(pg_temp.id('T'), 'benevolent_dictator', 0);
    IF NOT EXISTS (SELECT 1 FROM finance.split_rules WHERE id = v_id AND active AND vault_bp = 10000
                     AND finder_user_id IS NULL AND finder_bp IS NULL) THEN
        RAISE EXCEPTION 'FAIL 5 benevolent_dictator must store vault_bp 10000 and no finder: %', pg_temp.rules(pg_temp.id('T'));
    END IF;
    v_plan := finance.fn_team_split_plan(pg_temp.id('T'), 100000);
    IF (v_plan->>'vault_total_minor')::bigint <> 100000 OR jsonb_array_length(v_plan->'members') <> 0 THEN
        RAISE EXCEPTION 'FAIL 5 benevolent_dictator: everything to the vault — got %', v_plan;
    END IF;
    RAISE NOTICE 'PASS 5 finders_fee and benevolent_dictator reach fn_team_split_plan as stored';
END $$;
-- #endregion

-- #region 6. The plan gate — co_op free, finders_fee and benevolent_dictator Pro, read from the data
SELECT pg_temp.expect_refused('6a a free team cannot save finders_fee', pg_temp.id('FO'), pg_temp.id('FR'),
    format($q$SELECT finance.save_split_rule(%L, 'finders_fee', 1000, %L, 500)$q$, pg_temp.id('FR'), pg_temp.id('FO')),
    'PK402', 'entitlement:');

SELECT pg_temp.expect_refused('6b a free team cannot save benevolent_dictator', pg_temp.id('FO'), pg_temp.id('FR'),
    format($q$SELECT finance.save_split_rule(%L, 'benevolent_dictator', 10000)$q$, pg_temp.id('FR')),
    'PK402', 'entitlement:');

DO $$
DECLARE
    v_id uuid;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('FO'));
    v_id := finance.save_split_rule(pg_temp.id('FR'), 'co_op', 2000);
    IF NOT EXISTS (SELECT 1 FROM finance.split_rules WHERE id = v_id AND active AND vault_bp = 2000) THEN
        RAISE EXCEPTION 'FAIL 6c a free team saves co_op: %', pg_temp.rules(pg_temp.id('FR'));
    END IF;

    -- The answer is data: a grant of one template's flag unlocks that template alone.
    INSERT INTO finance.entitlement_grants (subject_type, subject_id, entitlement_key, flag_value, reason)
    VALUES ('team', pg_temp.id('FR'), 'split_template_finders_fee', true, 'probe');
    v_id := finance.save_split_rule(pg_temp.id('FR'), 'finders_fee', 1000, pg_temp.id('FO'), 500);
    IF NOT EXISTS (SELECT 1 FROM finance.split_rules WHERE id = v_id AND active AND rule_type = 'finders_fee') THEN
        RAISE EXCEPTION 'FAIL 6c a granted split_template_finders_fee flag unlocks finders_fee: %', pg_temp.rules(pg_temp.id('FR'));
    END IF;
    RAISE NOTICE 'PASS 6c a free team saves co_op; a grant of split_template_finders_fee unlocks finders_fee';
END $$;

SELECT pg_temp.expect_refused('6d the grant did not unlock benevolent_dictator', pg_temp.id('FO'), pg_temp.id('FR'),
    format($q$SELECT finance.save_split_rule(%L, 'benevolent_dictator', 10000)$q$, pg_temp.id('FR')),
    'PK402', 'entitlement:');

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM unnest(enum_range(NULL::finance.split_rule_type)) t(v)
         WHERE NOT ('split_template_' || t.v::text) = ANY (enum_range(NULL::finance.entitlement_key)::text[])
    ) THEN
        RAISE EXCEPTION 'FAIL 6e a split template has no split_template_* entitlement key';
    END IF;
    RAISE NOTICE 'PASS 6e every split template has its entitlement key';
END $$;
-- #endregion

-- #region 7. The writer is the RPC alone — no client role may write the table
DO $$
BEGIN
    IF has_table_privilege('authenticated', 'finance.split_rules', 'INSERT')
       OR has_table_privilege('authenticated', 'finance.split_rules', 'UPDATE')
       OR has_table_privilege('authenticated', 'finance.split_rules', 'DELETE') THEN
        RAISE EXCEPTION 'FAIL 7 authenticated holds a write privilege on finance.split_rules';
    END IF;
    RAISE NOTICE 'PASS 7 finance.split_rules is read-only to clients';
END $$;
-- #endregion

ROLLBACK;
