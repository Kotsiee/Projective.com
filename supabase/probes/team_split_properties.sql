-- =============================================================================================
-- Probe: the team payout plan is deterministic and conserves every minor unit (TEAMS_AUDIT B9, B10).
-- finance.fn_team_split_plan is the ONE plan the release (fn_split_team_payout) and the console's
-- preview (preview_team_split) both run. Over 600 generated cases — 2..15 active members, random stakes
-- totalling 10000 bp (some zero), a gross payout in 1..10^9 minor units (half uniform, half
-- log-uniform, plus the edges 1, 19 and 10^9), every template (no rule · co_op · finders_fee ·
-- benevolent_dictator) with vault_bp / finder_bp inside the save_split_rule bounds — it asserts:
--   - Σ member cuts + finder + vault_total_minor = payout − platform fee, EXACTLY;
--   - each member cut = floor(pool × bp / 10000), in the plan's fixed order (bp desc, member id);
--   - dust = pool − Σ member cuts ∈ [0, members with a stake), and lands in vault_total_minor;
--   - benevolent_dictator → no member is cut anything and the vault takes the whole payout;
--   - the same inputs twice, and the same stakes written in the reverse order, give the same plan;
--   - every 10th case, against a held team escrow: preview_team_split shows that plan, and the
--     release credits each wallet exactly what the plan says (Σ credits = payout − fee).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/team_split_properties.sql
--
-- Fixture (seeded data, rewritten per case inside the transaction with triggers off): the seeded team
-- `studiofern`, whose roster, stakes and split rule are replaced by each generated case — owner L plus
-- members drawn from the seeded users — and a stage S that carries the cross-check escrow. The run is
-- seeded (setseed) so a failure reproduces; a clean run prints the case count and no FAIL notice.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);
CREATE TEMP TABLE probe_fails (label text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.fail(p_label text, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO probe_fails VALUES (p_label);
    RAISE NOTICE 'FAIL % — %', p_label, p_why;
END $$;

-- Replace the team's roster, stakes and rule with one case's, triggers off. Stakes are written in
-- index order, or in the reverse order when p_reverse.
CREATE FUNCTION pg_temp.write_case(
    p_users uuid[], p_bp integer[], p_rule text, p_vault_bp integer, p_finder uuid, p_finder_bp integer,
    p_reverse boolean
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_team uuid := pg_temp.id('team');
BEGIN
    SET LOCAL session_replication_role = replica;
    DELETE FROM finance.contribution_agreements WHERE team_id = v_team;
    DELETE FROM finance.split_rules WHERE team_id = v_team;
    DELETE FROM org.team_members WHERE team_id = v_team;
    INSERT INTO org.team_members (team_id, user_id, role_id, role, status)
    SELECT v_team, u,
           CASE WHEN u = pg_temp.id('lead') THEN pg_temp.id('owner_role') ELSE pg_temp.id('member_role') END,
           CASE WHEN u = pg_temp.id('lead') THEN 'owner' ELSE 'member' END,
           'active'
      FROM unnest(p_users) u;
    INSERT INTO finance.contribution_agreements (team_id, member_user_id, percent_bp)
    SELECT v_team, p_users[j], p_bp[j]
      FROM generate_series(1, cardinality(p_users)) j
     ORDER BY CASE WHEN p_reverse THEN -j ELSE j END;
    IF p_rule IS NOT NULL THEN
        INSERT INTO finance.split_rules (team_id, rule_type, vault_bp, finder_user_id, finder_bp, active)
        VALUES (v_team, p_rule::finance.split_rule_type, p_vault_bp, p_finder, p_finder_bp, true);
    END IF;
    SET LOCAL session_replication_role = origin;
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_team uuid;
    v_lead uuid;
    v_owner_role uuid;
    v_member_role uuid;
    v_stage uuid;
    v_payer uuid;
    v_others integer;
BEGIN
    SELECT t.id, t.owner_user_id INTO v_team, v_lead FROM org.teams t WHERE t.slug = 'studiofern';
    SELECT m.role_id INTO v_owner_role FROM org.team_members m WHERE m.team_id = v_team AND m.user_id = v_lead;
    SELECT r.id INTO v_member_role FROM org.team_roles r WHERE r.team_id = v_team AND r.preset = 'member';
    SELECT s.id INTO v_stage FROM projects.project_stages s ORDER BY s.id LIMIT 1;

    INSERT INTO probe_ids
    SELECT 'user_' || row_number() OVER (ORDER BY u.user_id), u.user_id
      FROM org.users_public u
      JOIN auth.users a ON a.id = u.user_id
     WHERE u.user_id <> v_lead;
    GET DIAGNOSTICS v_others = ROW_COUNT;
    -- The payer stands outside every roster when the seed allows it; the fee is the payer's rate.
    SELECT id INTO v_payer FROM probe_ids WHERE k = 'user_' || v_others;

    IF v_team IS NULL OR v_owner_role IS NULL OR v_member_role IS NULL OR v_stage IS NULL OR v_others < 15 THEN
        RAISE EXCEPTION 'FAIL no fixture (team %, owner role %, member role %, stage %, % other users) — deno task db:reset',
            v_team, v_owner_role, v_member_role, v_stage, v_others;
    END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows e WHERE e.status = 'held' AND e.payee_type = 'team' AND e.payee_id = v_team) THEN
        RAISE EXCEPTION 'FAIL fixture: studiofern already holds a team escrow, so the preview would read that one';
    END IF;

    INSERT INTO probe_ids VALUES
        ('team', v_team), ('lead', v_lead), ('owner_role', v_owner_role), ('member_role', v_member_role),
        ('stage', v_stage), ('payer', v_payer);

    -- Release credits pass the pending window: keep it open so each credit is one pending_releases row.
    UPDATE security.platform_params SET value = to_jsonb(7) WHERE key = 'pending_release_days';
END $$;
-- #endregion

-- #region Cases
DO $$
DECLARE
    c_cases constant integer := 600;
    c_seed constant double precision := 0.2026;
    v_team uuid := pg_temp.id('team');
    v_lead uuid := pg_temp.id('lead');
    v_fee_bp integer := finance.fn_escrow_fee_bp(NULL, pg_temp.id('payer'));
    v_others uuid[] := ARRAY(SELECT id FROM probe_ids WHERE k LIKE 'user_%' AND id <> pg_temp.id('payer') ORDER BY k);
    v_counts jsonb := '{}'::jsonb;
    v_checks integer := 0;
    v_errs text[];
    v_err text;
    i integer;
    j integer;
    v_n integer;
    v_users uuid[];
    v_w integer[];
    v_bp integer[];
    v_wsum integer;
    v_rem integer;
    v_tmpl text;
    v_rule text;
    v_vault_bp integer;
    v_finder uuid;
    v_finder_bp integer;
    v_gross bigint;
    v_fee bigint;
    v_net bigint;
    v_ef bigint;
    v_rest bigint;
    v_ev bigint;
    v_pool bigint;
    v_k integer;
    v_expected jsonb;
    v_paid bigint;
    v_dust bigint;
    v_plan jsonb;
    v_again jsonb;
    v_reversed jsonb;
    v_sum bigint;
    v_escrow uuid;
    v_preview jsonb;
    v_credits jsonb;
    v_owed jsonb;
    v_credit_sum bigint;
BEGIN
    PERFORM setseed(c_seed);
    IF v_fee_bp IS NULL OR v_fee_bp < 0 OR v_fee_bp > 10000 THEN
        RAISE EXCEPTION 'FAIL fixture: fee bp % from fn_escrow_fee_bp', v_fee_bp;
    END IF;

    FOR i IN 1..c_cases LOOP
        v_errs := '{}';

        -- #region Generate
        v_n := 2 + floor(random() * 14)::integer;
        v_users := ARRAY[v_lead] || ARRAY(SELECT u FROM unnest(v_others) u ORDER BY random() LIMIT v_n - 1);
        v_w := '{}';
        FOR j IN 1..v_n LOOP
            v_w := v_w || CASE WHEN j > 1 AND random() < 0.1 THEN 0 ELSE 1 + floor(random() * 1000)::integer END;
        END LOOP;
        v_wsum := (SELECT sum(w) FROM unnest(v_w) w);
        v_bp := ARRAY(SELECT (10000 * v_w[g]) / v_wsum FROM generate_series(1, v_n) g ORDER BY g);
        v_rem := 10000 - (SELECT sum(b) FROM unnest(v_bp) b);
        LOOP
            j := 1 + floor(random() * v_n)::integer;
            EXIT WHEN v_w[j] > 0;
        END LOOP;
        v_bp[j] := v_bp[j] + v_rem;

        v_tmpl := (ARRAY['none', 'co_op', 'finders_fee', 'benevolent_dictator'])[1 + (i % 4)];
        v_rule := NULLIF(v_tmpl, 'none');
        v_finder := NULL;
        v_finder_bp := NULL;
        v_vault_bp := CASE WHEN random() < 0.1 THEN 0 WHEN random() < 0.1 THEN 10000
                           ELSE floor(random() * 10001)::integer END;
        IF v_tmpl = 'finders_fee' THEN
            v_vault_bp := LEAST(v_vault_bp, 9999);
            v_finder := v_users[1 + floor(random() * v_n)::integer];
            v_finder_bp := CASE WHEN random() < 0.1 THEN 10000 - v_vault_bp
                                ELSE 1 + floor(random() * (10000 - v_vault_bp))::integer END;
        ELSIF v_tmpl = 'benevolent_dictator' THEN
            v_vault_bp := 10000;
        ELSIF v_tmpl = 'none' THEN
            v_vault_bp := 0;
        END IF;

        v_gross := CASE i WHEN 1 THEN 1 WHEN 2 THEN 1000000000 WHEN 3 THEN 19 ELSE
            CASE WHEN random() < 0.5 THEN 1 + floor(random() * 1000000000)::bigint
                 ELSE LEAST(1000000000, GREATEST(1, floor(exp(random() * ln(1000000000)))::bigint)) END
        END;
        v_fee := (v_gross * v_fee_bp) / 10000;
        v_net := v_gross - v_fee;
        v_counts := jsonb_set(v_counts, ARRAY[v_tmpl], to_jsonb(COALESCE((v_counts->>v_tmpl)::integer, 0) + 1));
        -- #endregion

        -- #region Expected
        IF (SELECT sum(b) FROM unnest(v_bp) b) <> 10000 THEN
            v_errs := v_errs || format('generator: stakes total %s', (SELECT sum(b) FROM unnest(v_bp) b));
        END IF;
        v_ef := CASE WHEN v_tmpl = 'finders_fee' THEN (v_net * v_finder_bp) / 10000 ELSE 0 END;
        v_rest := v_net - v_ef;
        v_ev := (v_rest * v_vault_bp) / 10000;
        v_pool := v_rest - v_ev;
        v_k := (SELECT count(*) FROM unnest(v_bp) b WHERE b > 0);
        v_expected := COALESCE((
            SELECT jsonb_agg(jsonb_build_object('member_user_id', x.u, 'percent_bp', x.b,
                                                'amount_minor', (v_pool * x.b) / 10000)
                             ORDER BY x.b DESC, x.u)
              FROM unnest(v_users, v_bp) AS x(u, b)
             WHERE x.b > 0
        ), '[]'::jsonb);
        v_paid := (SELECT COALESCE(sum((m->>'amount_minor')::bigint), 0) FROM jsonb_array_elements(v_expected) m);
        v_dust := v_pool - v_paid;
        -- #endregion

        -- #region Plan
        PERFORM pg_temp.write_case(v_users, v_bp, v_rule, v_vault_bp, v_finder, v_finder_bp, false);
        v_plan := finance.fn_team_split_plan(v_team, v_net);
        v_again := finance.fn_team_split_plan(v_team, v_net);
        PERFORM pg_temp.write_case(v_users, v_bp, v_rule, v_vault_bp, v_finder, v_finder_bp, true);
        v_reversed := finance.fn_team_split_plan(v_team, v_net);

        IF v_again IS DISTINCT FROM v_plan THEN
            v_errs := v_errs || 'the same inputs twice gave two plans'::text;
        END IF;
        IF v_reversed IS DISTINCT FROM v_plan THEN
            v_errs := v_errs || 'the same stakes written in reverse gave another plan'::text;
        END IF;

        v_sum := (SELECT COALESCE(sum((m->>'amount_minor')::bigint), 0) FROM jsonb_array_elements(v_plan->'members') m)
            + (v_plan->>'finder_minor')::bigint + (v_plan->>'vault_total_minor')::bigint;
        IF v_sum <> v_gross - v_fee OR (v_plan->>'payout_minor')::bigint <> v_net THEN
            v_errs := v_errs || format('conservation: members + finder + vault_total = %s, payout − fee = %s', v_sum, v_gross - v_fee);
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'members') m WHERE (m->>'amount_minor')::bigint < 0) THEN
            v_errs := v_errs || 'a member cut is negative'::text;
        END IF;
        IF (v_plan->>'rule_type') IS DISTINCT FROM COALESCE(v_rule, 'co_op') THEN
            v_errs := v_errs || format('rule_type %s (expected %s)', v_plan->>'rule_type', COALESCE(v_rule, 'co_op'));
        END IF;

        IF v_tmpl = 'benevolent_dictator' THEN
            IF v_plan->'members' <> '[]'::jsonb
                OR (v_plan->>'finder_minor')::bigint <> 0
                OR (v_plan->>'dust_minor')::bigint <> 0
                OR (v_plan->>'vault_minor')::bigint <> v_net
                OR (v_plan->>'vault_total_minor')::bigint <> v_net
                OR (v_plan->>'vault_bp')::integer <> 10000 THEN
                v_errs := v_errs || format('benevolent_dictator cut a member or kept something from the vault: %s', v_plan);
            END IF;
        ELSE
            IF v_plan->'members' IS DISTINCT FROM v_expected THEN
                v_errs := v_errs || format('member cuts %s (expected floor(pool %s × bp / 10000): %s)',
                    v_plan->'members', v_pool, v_expected);
            END IF;
            IF (v_plan->>'finder_minor')::bigint <> v_ef
                OR (v_plan->>'finder_user_id')::uuid IS DISTINCT FROM (CASE WHEN v_ef > 0 THEN v_finder END) THEN
                v_errs := v_errs || format('finder %s %s (expected %s %s)',
                    v_plan->>'finder_user_id', v_plan->>'finder_minor', v_finder, v_ef);
            END IF;
            IF (v_plan->>'vault_minor')::bigint <> v_ev OR (v_plan->>'vault_bp')::integer <> v_vault_bp THEN
                v_errs := v_errs || format('vault cut %s at %s bp (expected %s at %s bp)',
                    v_plan->>'vault_minor', v_plan->>'vault_bp', v_ev, v_vault_bp);
            END IF;
            IF v_dust < 0 OR v_dust >= v_k OR (v_plan->>'dust_minor')::bigint <> v_dust THEN
                v_errs := v_errs || format('dust %s (expected %s, in [0, %s))', v_plan->>'dust_minor', v_dust, v_k);
            END IF;
            IF (v_plan->>'vault_total_minor')::bigint <> v_ev + v_dust THEN
                v_errs := v_errs || format('vault_total %s ≠ vault cut %s + dust %s', v_plan->>'vault_total_minor', v_ev, v_dust);
            END IF;
        END IF;
        -- #endregion

        -- #region Preview and release, every 10th case
        IF i % 10 = 0 THEN
            v_checks := v_checks + 1;
            BEGIN
                SET LOCAL session_replication_role = replica;
                INSERT INTO finance.escrows (project_stage_id, payer_user_id, payee_type, payee_id,
                                             amount_cents, currency, status)
                VALUES (pg_temp.id('stage'), pg_temp.id('payer'), 'team', v_team, v_gross, 'USD', 'held')
                RETURNING id INTO v_escrow;
                SET LOCAL session_replication_role = origin;

                PERFORM pg_temp.act(v_lead);
                v_preview := finance.preview_team_split(v_team);
                IF v_preview->'plan' IS DISTINCT FROM v_plan
                    OR (v_preview->>'gross_minor')::bigint <> v_gross
                    OR (v_preview->>'fee_minor')::bigint <> v_fee THEN
                    v_errs := v_errs || format('preview shows gross %s fee %s plan %s (expected %s, %s, the release plan)',
                        v_preview->>'gross_minor', v_preview->>'fee_minor', v_preview->'plan', v_gross, v_fee);
                END IF;

                PERFORM finance.fn_split_team_payout(v_escrow, v_team, v_net, 'USD');
                SELECT COALESCE(jsonb_object_agg(s.owner_id, s.amount), '{}'::jsonb), COALESCE(sum(s.amount), 0)
                  INTO v_credits, v_credit_sum
                  FROM (SELECT w.owner_id::text AS owner_id, sum(pr.amount_cents)::bigint AS amount
                          FROM finance.pending_releases pr
                          JOIN finance.wallets w ON w.id = pr.wallet_id
                         WHERE pr.escrow_id = v_escrow
                         GROUP BY w.owner_id) s;
                SELECT COALESCE(jsonb_object_agg(o.owner_id, o.amount), '{}'::jsonb) INTO v_owed
                  FROM (SELECT x.owner_id, sum(x.amount)::bigint AS amount
                          FROM (SELECT m->>'member_user_id' AS owner_id, (m->>'amount_minor')::bigint AS amount
                                  FROM jsonb_array_elements(v_plan->'members') m
                                UNION ALL
                                SELECT v_plan->>'finder_user_id', (v_plan->>'finder_minor')::bigint
                                UNION ALL
                                SELECT v_team::text, (v_plan->>'vault_total_minor')::bigint) x
                         WHERE x.amount > 0
                         GROUP BY x.owner_id) o;
                IF v_credits IS DISTINCT FROM v_owed OR v_credit_sum <> v_net THEN
                    v_errs := v_errs || format('release credited %s (Σ %s), the plan owes %s (Σ %s)',
                        v_credits, v_credit_sum, v_owed, v_net);
                END IF;
                RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
            EXCEPTION
                WHEN SQLSTATE 'PX000' THEN NULL;
                WHEN OTHERS THEN v_errs := v_errs || format('preview/release raised %s %s', SQLSTATE, SQLERRM);
            END;
        END IF;
        -- #endregion

        FOREACH v_err IN ARRAY v_errs LOOP
            PERFORM pg_temp.fail(format('case %s (%s, %s members, gross %s, vault %s bp, finder %s bp)',
                i, v_tmpl, v_n, v_gross, v_vault_bp, COALESCE(v_finder_bp::text, '-')), v_err);
        END LOOP;
    END LOOP;

    RAISE NOTICE 'team_split_properties: % cases (seed %, fee % bp) — %; % preview + release cross-checks',
        c_cases, c_seed, v_fee_bp, v_counts, v_checks;
END $$;
-- #endregion

DO $$
DECLARE
    v_fails integer := (SELECT count(*) FROM probe_fails);
BEGIN
    IF v_fails > 0 THEN
        RAISE EXCEPTION 'FAIL % violation(s) in % case(s)', v_fails, (SELECT count(DISTINCT label) FROM probe_fails);
    END IF;
    RAISE NOTICE 'team_split_properties: zero violations — all cases PASS';
END $$;

ROLLBACK;
