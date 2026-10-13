-- =============================================================================================
-- Probe: service instantiation ("Add to Projects") — marketplace.instantiate_service_blueprint,
-- marketplace.get_service_draft and projects.service_instantiations (00001175, Decision #209).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/service_instantiation.sql
--
-- Every expected refusal is asserted by its SQLSTATE: a call that succeeds where it must be refused,
-- or fails with a different code, raises `FAIL …` and aborts the run. A clean run prints only PASS
-- notices. Fixtures are discovered from the seed (deno task db:reset) — no ids are hard-coded.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
-- A published, freelancer-owned pipeline with stages; a second published pipeline; a published
-- listing that is NOT a pipeline; and an adult buyer who sells none of them, belongs to no team that
-- does, and holds no draft of the first.
DO $$
DECLARE
    v_bp record;
    v_other uuid;
    v_flat uuid;
    v_buyer uuid;
    v_stranger uuid;
BEGIN
    SELECT sb.id, sb.freelancer_profile_id AS seller INTO v_bp
    FROM marketplace.service_blueprints sb
    WHERE sb.delivery_model = 'pipeline' AND sb.is_published AND sb.owner_team_id IS NULL
        AND jsonb_array_length(sb.stage_template) > 0
    ORDER BY sb.slug LIMIT 1;
    IF v_bp.id IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no published freelancer pipeline in the seed'; END IF;

    SELECT sb.id INTO v_other FROM marketplace.service_blueprints sb
    WHERE sb.delivery_model = 'pipeline' AND sb.is_published AND sb.id <> v_bp.id ORDER BY sb.slug LIMIT 1;
    SELECT sb.id INTO v_flat FROM marketplace.service_blueprints sb
    WHERE sb.delivery_model <> 'pipeline' AND sb.is_published ORDER BY sb.slug LIMIT 1;

    SELECT u.user_id INTO v_buyer FROM org.users_public u
    WHERE u.user_id <> v_bp.seller
        AND NOT org.fn_is_minor(u.user_id)
        AND NOT EXISTS (SELECT 1 FROM projects.projects p WHERE p.owner_user_id = u.user_id AND p.source_blueprint_id = v_bp.id)
        AND NOT EXISTS (
            SELECT 1 FROM org.team_members tm JOIN marketplace.service_blueprints sb ON sb.owner_team_id = tm.team_id
            WHERE tm.user_id = u.user_id AND sb.id IN (v_bp.id, v_other)
        )
        AND NOT EXISTS (SELECT 1 FROM marketplace.service_blueprints sb WHERE sb.id = v_other AND sb.freelancer_profile_id = u.user_id)
    ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_stranger FROM org.users_public u
    WHERE u.user_id NOT IN (v_buyer, v_bp.seller) ORDER BY u.user_id LIMIT 1;

    IF v_other IS NULL OR v_flat IS NULL OR v_buyer IS NULL OR v_stranger IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: other=% flat=% buyer=% stranger=%', v_other, v_flat, v_buyer, v_stranger;
    END IF;

    PERFORM set_config('probe.bp', v_bp.id::text, true);
    PERFORM set_config('probe.seller', v_bp.seller::text, true);
    PERFORM set_config('probe.other', v_other::text, true);
    PERFORM set_config('probe.flat', v_flat::text, true);
    PERFORM set_config('probe.buyer', v_buyer::text, true);
    PERFORM set_config('probe.stranger', v_stranger::text, true);
    PERFORM set_config('probe.projects_before', (SELECT count(*) FROM projects.projects)::text, true);
    RAISE NOTICE 'fixture bp=% seller=% other=% flat=% buyer=% stranger=%', v_bp.id, v_bp.seller, v_other, v_flat, v_buyer, v_stranger;
END $$;

DO $$
BEGIN
    IF marketplace.fn_plain_text_html(E'a & <b>\r\n"c"\n\n\n  second  ') <> '<p>a &amp; &lt;b&gt;<br>&quot;c&quot;</p><p>second</p>' THEN
        RAISE EXCEPTION 'FAIL fn_plain_text_html: %', marketplace.fn_plain_text_html(E'a & <b>\r\n"c"\n\n\n  second  ');
    END IF;
    IF marketplace.fn_plain_text_html('') <> '' OR marketplace.fn_plain_text_html(NULL) <> '' THEN
        RAISE EXCEPTION 'FAIL fn_plain_text_html empty';
    END IF;
    RAISE NOTICE 'PASS fn_plain_text_html matches plainTextToHtml';
END $$;
-- #endregion

-- #region 1. anon — no EXECUTE on any door; nobody may call the projection
SET LOCAL ROLE anon;
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        format('SELECT marketplace.instantiate_service_blueprint(%L, ''{}'', NULL, ''probe-key-anon'')', current_setting('probe.bp')),
        format('SELECT marketplace.get_service_draft(%L)', current_setting('probe.bp')),
        format('SELECT marketplace.fn_service_draft_json(%L)', gen_random_uuid())
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL anon executed: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS anon refused: %', v_sql;
        END;
    END LOOP;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
DO $$
BEGIN
    BEGIN
        PERFORM marketplace.fn_service_draft_json(gen_random_uuid());
        RAISE EXCEPTION 'FAIL authenticated executed the internal projection';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS the projection is internal';
    END;
    BEGIN
        PERFORM marketplace.instantiate_service_blueprint(current_setting('probe.bp')::uuid, '{}', NULL, 'probe-key-nosub');
        RAISE EXCEPTION 'FAIL a subject-less caller instantiated';
    EXCEPTION WHEN SQLSTATE '28000' THEN
        RAISE NOTICE 'PASS no subject refused 28000';
    END;
    IF marketplace.get_service_draft(current_setting('probe.bp')::uuid) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL a subject-less caller read a draft';
    END IF;
END $$;
RESET ROLE;
-- #endregion

-- #region 2. The buyer — refusals first, then the happy path
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.buyer'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_bp uuid := current_setting('probe.bp')::uuid;
BEGIN
    BEGIN
        PERFORM marketplace.instantiate_service_blueprint(current_setting('probe.flat')::uuid, '{}', NULL, 'probe-key-flat');
        RAISE EXCEPTION 'FAIL a non-pipeline listing instantiated';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'PASS non-pipeline refused 22023 (%)', SQLERRM;
    END;
    BEGIN
        PERFORM marketplace.instantiate_service_blueprint(gen_random_uuid(), '{}', NULL, 'probe-key-none');
        RAISE EXCEPTION 'FAIL an unknown listing instantiated';
    EXCEPTION WHEN SQLSTATE 'P0002' THEN
        RAISE NOTICE 'PASS unknown listing refused P0002';
    END;
    BEGIN
        PERFORM marketplace.instantiate_service_blueprint(v_bp, '{}', 'JPY', 'probe-key-fx');
        RAISE EXCEPTION 'FAIL a foreign currency instantiated';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN
        RAISE NOTICE 'PASS currency mismatch refused PC409 (%)', SQLERRM;
    END;
    BEGIN
        PERFORM marketplace.instantiate_service_blueprint(v_bp, '[1]', NULL, 'probe-key-arr');
        RAISE EXCEPTION 'FAIL a non-object intake instantiated';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'PASS non-object intake refused 22023';
    END;
    BEGIN
        PERFORM marketplace.instantiate_service_blueprint(v_bp, '{}', NULL, 'short');
        RAISE EXCEPTION 'FAIL a short key instantiated';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'PASS short key refused 22023';
    END;
    IF marketplace.get_service_draft(v_bp) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL refusals left a draft behind';
    END IF;
END $$;

DO $$
DECLARE
    v_bp uuid := current_setting('probe.bp')::uuid;
    v_first jsonb;
    v_again jsonb;
    v_pair jsonb;
    v_read jsonb;
BEGIN
    v_first := marketplace.instantiate_service_blueprint(
        v_bp,
        jsonb_build_object('depth', 'deep', 'not_a_question', 'dropped'),
        'usd',
        'probe-key-0001',
        '  '
    );
    IF NOT (v_first->>'created')::boolean THEN RAISE EXCEPTION 'FAIL first press did not create: %', v_first; END IF;
    IF v_first->>'status' <> 'draft' OR v_first->>'slug' !~ '^prj-' THEN RAISE EXCEPTION 'FAIL draft shape: %', v_first; END IF;
    IF (v_first->>'funded_stage_count')::int <> 0 THEN RAISE EXCEPTION 'FAIL a fresh draft is funded: %', v_first; END IF;
    PERFORM set_config('probe.project', v_first->>'project_id', true);
    PERFORM set_config('probe.slug', v_first->>'slug', true);
    RAISE NOTICE 'PASS created %', v_first;

    v_again := marketplace.instantiate_service_blueprint(v_bp, '{}', NULL, 'probe-key-0001');
    IF (v_again->>'created')::boolean OR v_again->>'slug' <> v_first->>'slug' THEN
        RAISE EXCEPTION 'FAIL replayed key: %', v_again;
    END IF;
    RAISE NOTICE 'PASS replayed key returns the same draft, created=false';

    v_pair := marketplace.instantiate_service_blueprint(v_bp, '{}', NULL, 'probe-key-0002');
    IF (v_pair->>'created')::boolean OR v_pair->>'slug' <> v_first->>'slug' THEN
        RAISE EXCEPTION 'FAIL second key on a listing with a live draft: %', v_pair;
    END IF;
    RAISE NOTICE 'PASS a fresh key on a listing with a live draft returns that draft';

    BEGIN
        PERFORM marketplace.instantiate_service_blueprint(current_setting('probe.other')::uuid, '{}', NULL, 'probe-key-0001');
        RAISE EXCEPTION 'FAIL a key reused for another listing was answered';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'PASS key reused for another listing refused 22023';
    END;

    v_read := marketplace.get_service_draft(v_bp);
    IF v_read IS NULL OR v_read->>'slug' <> v_first->>'slug' OR (v_read->>'created')::boolean THEN
        RAISE EXCEPTION 'FAIL get_service_draft: %', v_read;
    END IF;
    RAISE NOTICE 'PASS get_service_draft reads the buyer''s draft';

    IF (SELECT count(*) FROM projects.service_instantiations) <> 1 THEN
        RAISE EXCEPTION 'FAIL the buyer should read exactly their one instantiation row';
    END IF;
    RAISE NOTICE 'PASS the buyer reads their own instantiation row';
END $$;
RESET ROLE;
-- #endregion

-- #region 3. What the transaction wrote (as postgres)
DO $$
DECLARE
    v_bp marketplace.service_blueprints%ROWTYPE;
    v_project projects.projects%ROWTYPE;
    v_template_len int;
    v_stage record;
    v_n int := 0;
    v_si projects.service_instantiations%ROWTYPE;
BEGIN
    SELECT * INTO v_bp FROM marketplace.service_blueprints WHERE id = current_setting('probe.bp')::uuid;
    SELECT * INTO v_project FROM projects.projects WHERE id = current_setting('probe.project')::uuid;
    v_template_len := jsonb_array_length(v_bp.stage_template);

    IF v_project.owner_user_id <> current_setting('probe.buyer')::uuid
        OR v_project.status <> 'draft' OR v_project.visibility <> 'unlisted'
        OR v_project.format <> 'pipeline' OR v_project.source_blueprint_id <> v_bp.id
        OR v_project.currency <> upper(v_bp.currency) OR v_project.title <> v_bp.title
        OR v_project.owner_team_id IS NOT NULL OR v_project.client_business_id IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL project row: %', row_to_json(v_project);
    END IF;
    RAISE NOTICE 'PASS project: draft · unlisted · pipeline · personal · listing currency · source_blueprint_id';

    IF (SELECT count(*) FROM projects.projects) <> current_setting('probe.projects_before')::int + 1 THEN
        RAISE EXCEPTION 'FAIL expected exactly one new project';
    END IF;
    RAISE NOTICE 'PASS three presses, one project';

    FOR v_stage IN
        SELECT ps.*, t.value AS tpl, t.ord
        FROM projects.project_stages ps
        JOIN jsonb_array_elements(v_bp.stage_template) WITH ORDINALITY AS t (value, ord) ON t.ord - 1 = ps.sort_order
        WHERE ps.project_id = v_project.id
        ORDER BY ps.sort_order
    LOOP
        v_n := v_n + 1;
        IF v_stage.name <> v_stage.tpl->>'name' THEN RAISE EXCEPTION 'FAIL stage % name', v_stage.ord; END IF;
        IF v_stage.unit_price_cents IS DISTINCT FROM COALESCE((v_stage.tpl->>'priceCents')::bigint, v_bp.ticket_price_cents) THEN
            RAISE EXCEPTION 'FAIL stage % price % vs template %', v_stage.ord, v_stage.unit_price_cents, v_stage.tpl->>'priceCents';
        END IF;
        IF v_stage.description->>'html' NOT LIKE '<p>%' THEN RAISE EXCEPTION 'FAIL stage % brief is not html', v_stage.ord; END IF;
        IF jsonb_array_length(v_stage.default_tasks) <> jsonb_array_length(COALESCE(v_stage.tpl->'deliverables', '[]')) THEN
            RAISE EXCEPTION 'FAIL stage % checklist template', v_stage.ord;
        END IF;
        IF v_stage.file_revisions_allowed IS DISTINCT FROM v_bp.free_revisions THEN
            RAISE EXCEPTION 'FAIL stage % revision terms % vs blueprint %', v_stage.ord, v_stage.file_revisions_allowed, v_bp.free_revisions;
        END IF;
        IF (SELECT count(*) FROM projects.tickets t
            WHERE t.current_stage_id = v_stage.id AND t.status = 'backlog' AND t.current_assignee_id IS NULL
                AND t.unit_price_cents IS NOT DISTINCT FROM v_stage.unit_price_cents
                AND t.title = v_stage.name
                AND jsonb_array_length(t.tasks) = jsonb_array_length(v_stage.default_tasks)
                AND t.required_stages = jsonb_build_array(jsonb_build_object('stage_id', v_stage.id, 'order', 0))) <> 1 THEN
            RAISE EXCEPTION 'FAIL stage % should hold exactly one priced backlog ticket', v_stage.ord;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM comms.project_channels c WHERE c.project_id = v_project.id AND c.stage_id = v_stage.id) THEN
            RAISE EXCEPTION 'FAIL stage % has no room', v_stage.ord;
        END IF;
    END LOOP;
    IF v_n <> v_template_len THEN RAISE EXCEPTION 'FAIL % stages for a % stage template', v_n, v_template_len; END IF;
    IF (SELECT count(*) FROM projects.tickets WHERE project_id = v_project.id) <> v_template_len THEN
        RAISE EXCEPTION 'FAIL ticket count';
    END IF;
    RAISE NOTICE 'PASS % stages, each with its price, brief, checklist, revision terms, one priced ticket and a room', v_n;

    IF NOT EXISTS (SELECT 1 FROM comms.project_channels c WHERE c.project_id = v_project.id AND c.stage_id IS NULL) THEN
        RAISE EXCEPTION 'FAIL no Discussion room';
    END IF;
    RAISE NOTICE 'PASS the project-wide Discussion room';

    IF EXISTS (SELECT 1 FROM projects.stage_assignments sa JOIN projects.project_stages ps ON ps.id = sa.project_stage_id WHERE ps.project_id = v_project.id)
        OR EXISTS (SELECT 1 FROM finance.escrows e JOIN projects.project_stages ps ON ps.id = e.project_stage_id WHERE ps.project_id = v_project.id) THEN
        RAISE EXCEPTION 'FAIL instantiation minted a seat or an escrow';
    END IF;
    RAISE NOTICE 'PASS no seat, no escrow';

    SELECT * INTO v_si FROM projects.service_instantiations WHERE project_id = v_project.id;
    IF v_si.idempotency_key <> 'probe-key-0001' OR v_si.intake_answers <> '{"depth": "deep"}'::jsonb
        OR v_si.currency <> upper(v_bp.currency) OR v_si.blueprint_id <> v_bp.id THEN
        RAISE EXCEPTION 'FAIL instantiation row: %', row_to_json(v_si);
    END IF;
    RAISE NOTICE 'PASS the request row keeps the key, the listing''s currency and only the answers it asks';
END $$;
-- #endregion

-- #region 4. Other callers
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.stranger'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF marketplace.get_service_draft(current_setting('probe.bp')::uuid) IS NOT NULL
        AND marketplace.get_service_draft(current_setting('probe.bp')::uuid)->>'slug' = current_setting('probe.slug') THEN
        RAISE EXCEPTION 'FAIL a stranger read the buyer''s draft';
    END IF;
    IF EXISTS (SELECT 1 FROM projects.service_instantiations WHERE project_id = current_setting('probe.project')::uuid) THEN
        RAISE EXCEPTION 'FAIL a stranger read the buyer''s instantiation row';
    END IF;
    BEGIN
        PERFORM marketplace.instantiate_service_blueprint(current_setting('probe.other')::uuid, '{}', NULL, 'probe-key-0001');
        RAISE NOTICE 'PASS a stranger''s identical key is their own request';
    EXCEPTION WHEN SQLSTATE 'PU422' OR SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS (stranger cannot buy this listing: %) — key scoping not exercised', SQLERRM;
    END;
    BEGIN
        INSERT INTO projects.service_instantiations (project_id, owner_user_id, idempotency_key, currency)
        VALUES (current_setting('probe.project')::uuid, current_setting('probe.stranger')::uuid, 'probe-key-forge', 'USD');
        RAISE EXCEPTION 'FAIL a client wrote an instantiation row directly';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS no direct writes to service_instantiations';
    END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.seller'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    PERFORM marketplace.instantiate_service_blueprint(current_setting('probe.bp')::uuid, '{}', NULL, 'probe-key-self');
    RAISE EXCEPTION 'FAIL the seller instantiated their own listing';
EXCEPTION WHEN SQLSTATE 'PU422' THEN
    RAISE NOTICE 'PASS the seller''s own listing refused PU422';
END $$;
RESET ROLE;
-- #endregion

-- #region 5. Remove draft — archive_service_draft
SET LOCAL ROLE anon;
DO $$
BEGIN
    PERFORM marketplace.archive_service_draft(current_setting('probe.slug'));
    RAISE EXCEPTION 'FAIL anon archived a draft';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS anon cannot reach archive_service_draft';
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.stranger'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    PERFORM marketplace.archive_service_draft(current_setting('probe.slug'));
    RAISE EXCEPTION 'FAIL a stranger archived the buyer''s draft';
EXCEPTION WHEN SQLSTATE 'P0002' THEN
    RAISE NOTICE 'PASS a stranger''s archive reads as not found';
END $$;
RESET ROLE;

-- A funded stage (an escrow row, as the sweep counts it — here a prepaid hold on its ticket, the
-- Decision #197 shape) blocks the archive.
SAVEPOINT funded;
INSERT INTO finance.escrows (project_stage_id, ticket_id, payer_user_id, amount_cents, currency, status)
SELECT ps.id, t.id, current_setting('probe.buyer')::uuid, COALESCE(ps.unit_price_cents, 100), 'USD', 'held'
FROM projects.project_stages ps JOIN projects.tickets t ON t.current_stage_id = ps.id
WHERE ps.project_id = current_setting('probe.project')::uuid
ORDER BY ps.sort_order LIMIT 1;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.buyer'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF (marketplace.get_service_draft(current_setting('probe.bp')::uuid)->>'funded_stage_count')::int <> 1 THEN
        RAISE EXCEPTION 'FAIL the projection does not count the funded stage';
    END IF;
    PERFORM marketplace.archive_service_draft(current_setting('probe.slug'));
    RAISE EXCEPTION 'FAIL a funded draft was archived';
EXCEPTION WHEN SQLSTATE '23514' THEN
    RAISE NOTICE 'PASS a funded draft refuses the archive 23514 (%)', SQLERRM;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT funded;

-- The owner archives; the listing is free for a fresh draft, and the archived key still replays.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.buyer'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_bp uuid := current_setting('probe.bp')::uuid;
    v_archived jsonb;
    v_again jsonb;
    v_replay jsonb;
    v_fresh jsonb;
BEGIN
    v_archived := marketplace.archive_service_draft(current_setting('probe.slug'), 'probe');
    IF v_archived->>'status' <> 'archived' THEN RAISE EXCEPTION 'FAIL archive: %', v_archived; END IF;
    v_again := marketplace.archive_service_draft(current_setting('probe.slug'));
    IF v_again->>'status' <> 'archived' THEN RAISE EXCEPTION 'FAIL second archive: %', v_again; END IF;
    RAISE NOTICE 'PASS the owner archives, idempotently';

    IF marketplace.get_service_draft(v_bp) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL an archived draft still holds the CTA';
    END IF;
    v_replay := marketplace.instantiate_service_blueprint(v_bp, '{}', NULL, 'probe-key-0001');
    IF (v_replay->>'created')::boolean OR v_replay->>'status' <> 'archived' THEN
        RAISE EXCEPTION 'FAIL archived replay: %', v_replay;
    END IF;
    v_fresh := marketplace.instantiate_service_blueprint(v_bp, '{}', NULL, 'probe-key-0003');
    IF NOT (v_fresh->>'created')::boolean OR v_fresh->>'slug' = current_setting('probe.slug') THEN
        RAISE EXCEPTION 'FAIL fresh draft after archive: %', v_fresh;
    END IF;
    RAISE NOTICE 'PASS archived key replays as archived; a fresh key after archive creates %', v_fresh->>'slug';
END $$;
RESET ROLE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM projects.project_status_history h
                   WHERE h.project_id = current_setting('probe.project')::uuid AND h.to_status = 'archived') THEN
        RAISE EXCEPTION 'FAIL the archive wrote no status history';
    END IF;
    RAISE NOTICE 'PASS the archive went through set_project_status (status history written)';
END $$;
-- #endregion

ROLLBACK;
