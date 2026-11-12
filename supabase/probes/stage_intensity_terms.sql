-- =============================================================================================
-- Probe: a stage's intensity terms (Decision #417) — projects.fn_stage_intensity_terms on
-- projects.project_stages (`default_intensity`, `intensity_locked`, `low_price_cents`,
-- `high_price_cents`) and the copy marketplace.instantiate_service_blueprint makes of them.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/stage_intensity_terms.sql
--
-- Every expected refusal is asserted by its SQLSTATE; a clean run prints only PASS notices. Fixtures
-- are discovered from the seed (deno task db:reset) — no ids are hard-coded.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
-- A published freelancer pipeline with stages, sold at one fixed intensity; an adult buyer who sells
-- nothing of it and holds no draft of it; and the owner of a hand-built personal pipeline.
DO $$
DECLARE
    v_bp record;
    v_buyer uuid;
    v_own record;
BEGIN
    SELECT sb.id, sb.freelancer_profile_id AS seller INTO v_bp
    FROM marketplace.service_blueprints sb
    WHERE sb.delivery_model = 'pipeline' AND sb.is_published AND sb.owner_team_id IS NULL
        AND jsonb_array_length(sb.stage_template) > 0
    ORDER BY sb.slug LIMIT 1;
    IF v_bp.id IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no published freelancer pipeline in the seed'; END IF;

    SELECT u.user_id INTO v_buyer FROM org.users_public u
    WHERE u.user_id <> v_bp.seller
        AND NOT org.fn_is_minor(u.user_id)
        AND NOT EXISTS (SELECT 1 FROM projects.projects p WHERE p.owner_user_id = u.user_id AND p.source_blueprint_id = v_bp.id)
    ORDER BY u.user_id LIMIT 1;

    SELECT p.id, p.owner_user_id AS owner INTO v_own
    FROM projects.projects p
    WHERE p.source_blueprint_id IS NULL AND p.format = 'pipeline'
        AND p.structure_variation = 'standard'
        AND p.status IN ('draft', 'active')
        AND p.owner_team_id IS NULL AND p.client_business_id IS NULL AND p.owner_enterprise_id IS NULL
    ORDER BY p.slug LIMIT 1;

    IF v_buyer IS NULL OR v_own.id IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: buyer=% own=%', v_buyer, v_own.id;
    END IF;

    UPDATE marketplace.service_blueprints
       SET allow_tiered_intensity = false,
           stage_template = jsonb_set(stage_template, '{0,intensity}', '"high"')
     WHERE id = v_bp.id;

    PERFORM set_config('probe.bp', v_bp.id::text, true);
    PERFORM set_config('probe.buyer', v_buyer::text, true);
    PERFORM set_config('probe.own_project', v_own.id::text, true);
    PERFORM set_config('probe.owner', v_own.owner::text, true);
    RAISE NOTICE 'fixture bp=% buyer=% own_project=% owner=%', v_bp.id, v_buyer, v_own.id, v_own.owner;
END $$;
-- #endregion

-- #region 1. The buyer instantiates — the stages arrive locked at the seller's intensity
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.buyer'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_draft jsonb;
    v_stage uuid;
BEGIN
    v_draft := marketplace.instantiate_service_blueprint(current_setting('probe.bp')::uuid, '{}', NULL, 'probe-key-terms');
    PERFORM set_config('probe.project', v_draft->>'project_id', true);
    SELECT ps.id INTO v_stage FROM projects.project_stages ps
     WHERE ps.project_id = (v_draft->>'project_id')::uuid AND ps.sort_order = 0;
    PERFORM set_config('probe.stage', v_stage::text, true);
    IF NOT EXISTS (SELECT 1 FROM projects.project_stages ps
                   WHERE ps.id = v_stage AND ps.intensity_locked AND ps.default_intensity = 'high') THEN
        RAISE EXCEPTION 'FAIL the instantiated stage is not locked at High';
    END IF;
    RAISE NOTICE 'PASS the instantiated stage is locked at the seller''s High intensity';
END $$;
-- #endregion

-- #region 2. The buyer may not move a seller's terms — and may still edit the rest of the stage
DO $$
DECLARE
    v_stage uuid := current_setting('probe.stage')::uuid;
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        format('UPDATE projects.project_stages SET default_intensity = %L WHERE id = %L', 'low', v_stage),
        format('UPDATE projects.project_stages SET intensity_locked = false WHERE id = %L', v_stage),
        format('UPDATE projects.project_stages SET low_price_cents = 100 WHERE id = %L', v_stage),
        format('UPDATE projects.project_stages SET high_price_cents = 99999 WHERE id = %L', v_stage)
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL the buyer moved a seller''s term: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS refused 42501: %', v_sql;
        END;
    END LOOP;

    UPDATE projects.project_stages SET name = 'Probe renamed' WHERE id = v_stage;
    IF NOT FOUND THEN RAISE EXCEPTION 'FAIL the buyer could not rename their own stage'; END IF;
    RAISE NOTICE 'PASS the buyer still renames the stage (its terms untouched)';

    BEGIN
        INSERT INTO projects.project_stages (project_id, name, sort_order, intensity_locked)
        VALUES (current_setting('probe.project')::uuid, 'Probe locked', 90, true);
        RAISE EXCEPTION 'FAIL the buyer created a locked stage';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a client cannot create a locked stage';
    END;

    INSERT INTO projects.project_stages (project_id, name, sort_order, default_intensity)
    VALUES (current_setting('probe.project')::uuid, 'Probe extra', 91, 'high');
    RAISE NOTICE 'PASS the buyer adds their own stage to the service project, unlocked';
    BEGIN
        UPDATE projects.project_stages SET default_intensity = 'low'
         WHERE project_id = current_setting('probe.project')::uuid AND name = 'Probe extra';
        RAISE EXCEPTION 'FAIL a stage term moved on an instantiated project';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS every stage of an instantiated project keeps its terms';
    END;
END $$;
RESET ROLE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM projects.project_stages ps
                   WHERE ps.id = current_setting('probe.stage')::uuid
                     AND ps.name = 'Probe renamed' AND ps.intensity_locked AND ps.default_intensity = 'high'
                     AND ps.low_price_cents IS NULL AND ps.high_price_cents IS NULL) THEN
        RAISE EXCEPTION 'FAIL the locked stage changed';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.project_stages ps
                   WHERE ps.project_id = current_setting('probe.project')::uuid AND ps.name = 'Probe extra'
                     AND NOT ps.intensity_locked AND ps.default_intensity = 'high') THEN
        RAISE EXCEPTION 'FAIL the client-created stage';
    END IF;
    RAISE NOTICE 'PASS what was written: the rename only, and an unlocked client stage';
END $$;
-- #endregion

-- #region 3. A hand-built project's stages are the client's own: a default, never a lock or tier prices
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_project uuid := current_setting('probe.own_project')::uuid;
    v_id uuid;
    v_sql text;
BEGIN
    INSERT INTO projects.project_stages (project_id, name, sort_order, default_intensity)
    VALUES (v_project, 'Probe own stage', 92, 'high')
    RETURNING id INTO v_id;
    UPDATE projects.project_stages SET default_intensity = 'low' WHERE id = v_id;
    RAISE NOTICE 'PASS the owner sets and changes their own stage''s default intensity';

    FOREACH v_sql IN ARRAY ARRAY[
        format('UPDATE projects.project_stages SET intensity_locked = true WHERE id = %L', v_id),
        format('UPDATE projects.project_stages SET low_price_cents = 100 WHERE id = %L', v_id),
        format('INSERT INTO projects.project_stages (project_id, name, sort_order, high_price_cents) VALUES (%L, %L, 93, 100)',
            v_project, 'Probe priced'),
        format('INSERT INTO projects.project_stages (project_id, name, sort_order, intensity_locked) VALUES (%L, %L, 94, true)',
            v_project, 'Probe locked')
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL a client locked or tier-priced a stage: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS refused 42501: %', v_sql;
        END;
    END LOOP;

    BEGIN
        UPDATE projects.project_stages SET default_intensity = 'extreme' WHERE id = v_id;
        RAISE EXCEPTION 'FAIL an unknown intensity was stored';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS an unknown intensity is refused by the column CHECK';
    END;
END $$;
RESET ROLE;
-- #endregion

-- #region 4. A definer door is not judged — the instantiation and operator paths write the terms
DO $$
BEGIN
    UPDATE projects.project_stages SET default_intensity = 'standard', high_price_cents = 4200
     WHERE id = current_setting('probe.stage')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'FAIL postgres could not write the terms'; END IF;
    RAISE NOTICE 'PASS a statement outside the client roles writes the terms';
END $$;
-- #endregion

ROLLBACK;
