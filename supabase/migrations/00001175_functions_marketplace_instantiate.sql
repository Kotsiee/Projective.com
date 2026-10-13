-- ============================================================================
-- 00001175 functions marketplace — service instantiation ("Add to Projects")
--
-- The one write behind `POST /api/services/instantiate-pipeline` on the live path. A Pipeline
-- listing's blueprint becomes a DRAFT engagement in the buyer's own workspace — the project, one
-- stage per `stage_template` entry, one priced ticket per stage, every stage's room and the
-- project-wide Discussion room — in ONE transaction, so a buyer can never be navigated to a project
-- that has stages and no rooms, or a board with half its tickets.
--
-- No money moves and nothing is reserved (PRODUCT_SPEC.md §Creation & Purchasing Gate; Decision #80):
-- the tickets sit in the backlog, unassigned and unfunded, and no seat is minted — a seat is only
-- ever created by an accepted invitation or application (PRODUCT_MANAGEMENT.md §Stage assignment).
-- The seller is hired into the draft afterwards through the ordinary hire path.
--
-- Three doors, all signed-in only (grants in 00002510): `instantiate_service_blueprint` (the write),
-- `get_service_draft` (the listing CTA's read) and `archive_service_draft` ("Remove draft"). Each
-- answers with `fn_service_draft_json`, so the write, the read and the archive cannot describe a
-- draft three ways. Probe: `supabase/probes/service_instantiation.sql`.
-- ============================================================================

-- ---------------------------------------------------------------------------------------------
-- marketplace.fn_plain_text_html(text) -> text
--
-- The SQL twin of `plainTextToHtml` (`@projective/types/richtext/plain-text.ts`): escape the four
-- markup characters, split on blank lines into paragraphs, keep single newlines as <br>. A blueprint
-- stage's brief is plain text, while every `projects.project_stages.description` the app writes is
-- `{"html": …}` — so the copy has to be converted here, by the same rule, or the setup editor would
-- open on a stage brief whose ampersands render as markup.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marketplace.fn_plain_text_html (p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT COALESCE(pg_catalog.string_agg(
        '<p>' || pg_catalog.replace(
            pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
                block, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'),
            E'\n', '<br>'
        ) || '</p>',
        '' ORDER BY ord
    ), '')
    FROM (
        SELECT pg_catalog.btrim(part, E' \t\n') AS block, ord
        FROM pg_catalog.regexp_split_to_table(
            pg_catalog.regexp_replace(COALESCE(p_text, ''), E'\r\n?', E'\n', 'g'),
            E'\n{2,}'
        ) WITH ORDINALITY AS t (part, ord)
    ) blocks
    WHERE block <> '';
$$;

COMMENT ON FUNCTION marketplace.fn_plain_text_html (text) IS
'Plain text -> paragraph HTML, escaping & < > " — the SQL twin of plainTextToHtml in @projective/types/richtext.';

-- ---------------------------------------------------------------------------------------------
-- marketplace.fn_service_draft_json(uuid) -> jsonb
--
-- The draft projection BOTH doors below answer with, named once so "what a draft looks like to the
-- listing page" cannot drift between the write and the read. Keys are read by
-- `packages/backend/services/projects/live-instantiate.ts` (`toPipelineDraft`), whose test checks
-- them against this file.
--
-- `funded_stage_count` counts stages with ANY escrow row — the same evidence
-- `projects.fn_archive_stale_service_drafts` treats as "money moved", so the listing's "expires in N
-- days" and the sweep agree about which drafts are still in reach.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marketplace.fn_service_draft_json (p_project_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.jsonb_build_object(
        'project_id', p.id,
        'slug', p.slug,
        'title', p.title,
        'status', p.status,
        'source_blueprint_slug', sb.slug,
        'stage_count', (
            SELECT pg_catalog.count(*) FROM projects.project_stages ps
            WHERE ps.project_id = p.id AND ps.archived_at IS NULL
        ),
        'ticket_count', (
            SELECT pg_catalog.count(*) FROM projects.tickets t WHERE t.project_id = p.id
        ),
        'funded_stage_count', (
            SELECT pg_catalog.count(DISTINCT e.project_stage_id)
            FROM finance.escrows e
            JOIN projects.project_stages ps ON ps.id = e.project_stage_id
            WHERE ps.project_id = p.id
        ),
        'currency', p.currency,
        'created_at', p.created_at,
        'last_activity_at', p.last_activity_at
    )
    FROM projects.projects p
    LEFT JOIN marketplace.service_blueprints sb ON sb.id = p.source_blueprint_id
    WHERE p.id = p_project_id;
$$;

COMMENT ON FUNCTION marketplace.fn_service_draft_json (uuid) IS
'The instantiated-draft projection shared by instantiate_service_blueprint and get_service_draft. Internal: no client role may execute it.';

-- ---------------------------------------------------------------------------------------------
-- marketplace.get_service_draft(p_blueprint_id uuid) -> jsonb | NULL
--
-- The caller's own live draft of a listing — what flips the listing's primary control from "Add to
-- Projects" to "Open project →". `NULL` when there is none.
--
-- "Live" is `draft` or `active` in the caller's PERSONAL workspace, newest first, mirroring the
-- stub's `findDraft`: an archived draft is history and must not hold the CTA on "Open project" over
-- something the buyer can no longer work in, and a completed or cancelled engagement is not a draft.
-- The same predicate is the pair-dedupe inside the write below, so the control and the write cannot
-- disagree about whether a draft exists.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marketplace.get_service_draft (p_blueprint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner uuid := auth.uid();
    v_project uuid;
BEGIN
    IF v_owner IS NULL OR p_blueprint_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT p.id INTO v_project
    FROM projects.projects p
    WHERE p.owner_user_id = v_owner
        AND p.source_blueprint_id = p_blueprint_id
        AND p.status IN ('draft'::public.project_status, 'active'::public.project_status)
        AND p.owner_team_id IS NULL
        AND p.client_business_id IS NULL
        AND p.owner_organisation_id IS NULL
    ORDER BY p.created_at DESC, p.id
    LIMIT 1;
    IF v_project IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN marketplace.fn_service_draft_json(v_project) || pg_catalog.jsonb_build_object('created', false);
END;
$$;

COMMENT ON FUNCTION marketplace.get_service_draft (uuid) IS
'The caller''s own draft/active personal project instantiated from this blueprint (newest), as the shared draft projection, or NULL.';

-- ---------------------------------------------------------------------------------------------
-- marketplace.instantiate_service_blueprint(p_blueprint_id, p_intake, p_currency,
--                                           p_idempotency_key, p_title) -> jsonb
--
-- WHAT IT WRITES, in one transaction:
--   1. `projects.projects` — owner `auth.uid()`, personal workspace, `format = 'pipeline'`,
--      `status = 'draft'`, `visibility = 'unlisted'`, `source_blueprint_id`, the listing's brief and
--      currency;
--   2. one `projects.project_stages` row per `stage_template` entry, in order — name, brief (as
--      HTML), deliverables as the stage's default checklist and its milestone line, skills (resolved
--      to `org.skills` slugs where a label matches), and `unit_price_cents` = the stage's own STANDARD
--      price, else the listing's `ticket_price_cents`, else NULL ("priced on scope" — never a guessed
--      zero). The revision allotment arrives through `trg_stage_revision_terms`, which reads the
--      blueprint because `source_blueprint_id` is already set;
--   3. one `projects.tickets` row per stage — titled after it, its checklist seeded from the
--      deliverables, `current_stage_id`/`required_stages` = that stage, `unit_price_cents` = the
--      stage's price, `status = 'backlog'`, unassigned. `finance.fn_hold_ticket_escrow` holds
--      `COALESCE(ticket, stage)` price at claim, so the figure the board shows is the figure held;
--   4. each stage's room and the project-wide Discussion room
--      (`comms.get_or_create_project_channel`, the same calls `projects.create_project` makes);
--   5. `projects.service_instantiations` — the request: key, answers, currency.
--
-- IDEMPOTENT, in this order (all under one per-owner advisory lock, so two concurrent presses
-- serialise instead of racing to two projects):
--   a. the caller's `p_idempotency_key` already made a project → that project, `created: false`
--      (whatever its status since — a replay returns what the request did). The same key naming a
--      DIFFERENT listing is a client bug and is refused (22023), never silently answered;
--   b. the caller already has a live draft of this listing (`get_service_draft`'s predicate) → that
--      draft, `created: false` — the listing page offers "Open project" while one exists, so a second
--      instantiation could only come from a stale tab;
--   c. otherwise create.
--
-- CALLER CHECKS (it is SECURITY DEFINER, so every one of these is the gate, not a courtesy):
--   * signed in (28000);
--   * an adult — buying unlocks at 18 (`org.fn_assert_adult`, PM403); a minor's project would be
--     forced personal and stripped of every price, which is not the listing they chose;
--   * the listing exists and is PUBLISHED (P0002 — an unpublished listing is indistinguishable from
--     an absent one to a buyer);
--   * it is a Pipeline (22023) with at least one stage (22023);
--   * it is not the caller's own, nor their team's (PU422 — the basket's own-listing code);
--   * `p_currency`, when given, is the listing's currency (PC409). The seller's prices are a
--     commitment in their currency; converting them here would put an FX decision nobody took into
--     an escrow figure. NULL means "the listing's";
--   * `p_intake` is a JSON object (22023) of bounded size; it is reduced to the ids the listing's
--     intake declares. Required-field enforcement is the Zod SSOT's (`intakeRefusal`), applied — or
--     deliberately not, see Decision #209 — by the fat service.
--
-- RETURNS the shared draft projection plus `created`.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marketplace.instantiate_service_blueprint (
    p_blueprint_id uuid,
    p_intake jsonb DEFAULT '{}'::jsonb,
    p_currency text DEFAULT NULL,
    p_idempotency_key text DEFAULT NULL,
    p_title text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- Not '': the INSERT triggers on projects/stages/tickets inherit this path, and some of them name
-- types unqualified. The same path `projects.create_project` runs its inserts under.
SET search_path = public, projects, marketplace, org, comms, auth
AS $$
DECLARE
    v_owner uuid := auth.uid();
    v_key text := NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key, '')), '');
    v_bp marketplace.service_blueprints%ROWTYPE;
    v_existing record;
    v_currency text;
    v_answers jsonb;
    v_title text;
    v_project_id uuid := gen_random_uuid();
    v_slug text;
    v_attempt integer := 0;
    v_constraint text;
    v_stage jsonb;
    v_ord bigint;
    v_stage_id uuid;
    v_stage_name text;
    v_stage_text text;
    v_stage_html text;
    v_price bigint;
    v_deliverables text[];
    v_tasks jsonb;
    v_checklist jsonb;
BEGIN
    -- #region Identity and the request
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'Sign in to add this to your projects.' USING ERRCODE = '28000';
    END IF;
    IF v_key IS NULL OR pg_catalog.char_length(v_key) NOT BETWEEN 8 AND 120 THEN
        RAISE EXCEPTION 'This request is missing its retry key.' USING ERRCODE = '22023';
    END IF;
    IF p_blueprint_id IS NULL THEN
        RAISE EXCEPTION 'That service is not available.' USING ERRCODE = 'P0002';
    END IF;

    -- Every instantiation of one buyer runs one at a time. Without it, a double-press reaches the
    -- key lookup twice before either insert commits and mints two projects; the unique key would then
    -- refuse the second's bookkeeping row AFTER its project existed in the same transaction — rolled
    -- back, but answered to the client as a failure instead of as the first press's result.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('marketplace.instantiate:' || v_owner::text));

    -- (a) A replayed key answers with what it created.
    SELECT si.project_id, si.blueprint_id INTO v_existing
    FROM projects.service_instantiations si
    WHERE si.owner_user_id = v_owner AND si.idempotency_key = v_key;
    IF FOUND THEN
        IF v_existing.blueprint_id IS DISTINCT FROM p_blueprint_id THEN
            RAISE EXCEPTION 'This request key was already used for a different service.'
                USING ERRCODE = '22023';
        END IF;
        RETURN marketplace.fn_service_draft_json(v_existing.project_id)
            || pg_catalog.jsonb_build_object('created', false);
    END IF;
    -- #endregion

    -- #region The listing
    PERFORM org.fn_assert_adult(v_owner);

    SELECT * INTO v_bp FROM marketplace.service_blueprints sb WHERE sb.id = p_blueprint_id;
    IF NOT FOUND OR NOT v_bp.is_published THEN
        RAISE EXCEPTION 'That service is not available.' USING ERRCODE = 'P0002';
    END IF;
    IF v_bp.delivery_model <> 'pipeline'::marketplace.service_delivery_model THEN
        RAISE EXCEPTION 'Only a pipeline service can be added to your projects.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_bp.stage_template) <> 'array' OR jsonb_array_length(v_bp.stage_template) = 0 THEN
        RAISE EXCEPTION 'This service has no stages to add yet.' USING ERRCODE = '22023';
    END IF;
    IF v_bp.freelancer_profile_id = v_owner OR (
        v_bp.owner_team_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM org.team_members tm
            WHERE tm.team_id = v_bp.owner_team_id AND tm.user_id = v_owner AND tm.status = 'active'
        )
    ) THEN
        RAISE EXCEPTION 'You can''t add your own service to your projects.' USING ERRCODE = 'PU422';
    END IF;

    v_currency := pg_catalog.upper(v_bp.currency);
    IF NULLIF(pg_catalog.btrim(COALESCE(p_currency, '')), '') IS NOT NULL
       AND pg_catalog.upper(pg_catalog.btrim(p_currency)) <> v_currency THEN
        RAISE EXCEPTION 'This service is priced in %.', v_currency USING ERRCODE = 'PC409';
    END IF;

    IF p_intake IS NOT NULL AND jsonb_typeof(p_intake) <> 'object' THEN
        RAISE EXCEPTION 'The answers to this service''s questions are malformed.' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.pg_column_size(p_intake) > 32768 THEN
        RAISE EXCEPTION 'The answers to this service''s questions are too long.' USING ERRCODE = '22023';
    END IF;
    -- Only the ids the listing asks. An answer to a question the seller never wrote is not part of
    -- the brief, and keeping it would let a caller park arbitrary data on somebody else's listing.
    SELECT COALESCE(pg_catalog.jsonb_object_agg(a.key, a.value), '{}'::jsonb) INTO v_answers
    FROM jsonb_each(COALESCE(p_intake, '{}'::jsonb)) a
    WHERE a.key IN (
        SELECT f->>'id' FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(v_bp.intake_fields) = 'array' THEN v_bp.intake_fields ELSE '[]'::jsonb END
        ) f
    );
    -- #endregion

    -- #region (b) An existing live draft of this listing
    SELECT p.id INTO v_existing
    FROM projects.projects p
    WHERE p.owner_user_id = v_owner
        AND p.source_blueprint_id = v_bp.id
        AND p.status IN ('draft'::project_status, 'active'::project_status)
        AND p.owner_team_id IS NULL
        AND p.client_business_id IS NULL
        AND p.owner_organisation_id IS NULL
    ORDER BY p.created_at DESC, p.id
    LIMIT 1;
    IF FOUND THEN
        RETURN marketplace.fn_service_draft_json(v_existing.id)
            || pg_catalog.jsonb_build_object('created', false);
    END IF;
    -- #endregion

    -- #region (c) The project
    v_title := pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_title, '')), ''), v_bp.title), 200);

    -- The slug is minted by `trg_projects_slug` (`security.fn_slug_guard('prj')`); a collision on
    -- the minted address is retried with a fresh draw, exactly as `projects.create_project` does.
    LOOP
        BEGIN
            INSERT INTO projects.projects (
                id, owner_user_id, title, description, description_text,
                format, structure_variation, session_kind, status, visibility, currency,
                budget_type, budget_amount_cents, source_blueprint_id, last_activity_at
            ) VALUES (
                v_project_id, v_owner, v_title,
                COALESCE(v_bp.description, '{}'::jsonb), COALESCE(v_bp.description_text, ''),
                'pipeline'::project_format, 'standard'::projects.structure_variation, 'none',
                'draft'::project_status, 'unlisted'::visibility, v_currency,
                -- A pipeline is priced per ticket, on its stages; it has no engagement budget.
                'fixed_price'::budget_type, NULL, v_bp.id, now()
            )
            RETURNING slug INTO v_slug;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
            IF v_constraint IS DISTINCT FROM 'projects_slug_key' THEN
                RAISE;
            END IF;
            v_attempt := v_attempt + 1;
            IF v_attempt > 5 THEN
                RAISE EXCEPTION 'Could not find a free address for this project.' USING ERRCODE = '23505';
            END IF;
        END;
    END LOOP;
    -- #endregion

    -- #region Stages, their tickets and their rooms
    FOR v_stage, v_ord IN
        SELECT s.value, s.ord FROM jsonb_array_elements(v_bp.stage_template) WITH ORDINALITY AS s (value, ord)
    LOOP
        IF jsonb_typeof(v_stage) <> 'object' THEN
            v_stage := '{}'::jsonb;
        END IF;
        v_stage_id := gen_random_uuid();
        v_stage_name := pg_catalog.left(
            COALESCE(NULLIF(pg_catalog.btrim(COALESCE(v_stage->>'name', '')), ''), 'Stage ' || v_ord), 80);
        v_stage_text := pg_catalog.left(COALESCE(v_stage->>'description', ''), 600);
        v_stage_html := marketplace.fn_plain_text_html(v_stage_text);
        v_price := COALESCE(
            CASE
                WHEN jsonb_typeof(v_stage->'priceCents') = 'number' AND (v_stage->>'priceCents')::numeric >= 0
                THEN pg_catalog.trunc((v_stage->>'priceCents')::numeric)::bigint
            END,
            v_bp.ticket_price_cents
        );
        v_deliverables := ARRAY(
            SELECT pg_catalog.left(pg_catalog.btrim(d), 160)
            FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(v_stage->'deliverables') = 'array' THEN v_stage->'deliverables' ELSE '[]'::jsonb END
            ) WITH ORDINALITY AS x (d, n)
            WHERE pg_catalog.btrim(d) <> ''
            ORDER BY n
            LIMIT 12
        );
        -- One id per deliverable, shared by the stage's template entry and the ticket's own item, so a
        -- reader can tell which template line a ticket's checklist item came from.
        SELECT
            COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', i.id, 'text', i.text) ORDER BY i.n), '[]'::jsonb),
            COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', i.id, 'text', i.text, 'done', false, 'completed_by', '[]'::jsonb) ORDER BY i.n), '[]'::jsonb)
        INTO v_tasks, v_checklist
        FROM (
            SELECT gen_random_uuid() AS id, d AS text, n
            FROM pg_catalog.unnest(v_deliverables) WITH ORDINALITY AS u (d, n)
        ) i;

        INSERT INTO projects.project_stages (
            id, project_id, name, description, description_text, sort_order,
            unit_price_cents, milestone, file_upload_required, default_tasks, skills
        ) VALUES (
            v_stage_id, v_project_id, v_stage_name,
            pg_catalog.jsonb_build_object('html', v_stage_html), v_stage_text,
            (v_ord - 1)::integer,
            v_price,
            pg_catalog.left(pg_catalog.array_to_string(v_deliverables, ' · '), 400),
            -- TRUE, as every RPC-created stage is (Projects.md §4.1): a stage exists to produce a
            -- deliverable, and this one's deliverables are listed above.
            true,
            v_tasks,
            -- The seller wrote LABELS; projects store skill slugs where the taxonomy knows the label.
            ARRAY(
                SELECT COALESCE(
                    (SELECT sk.slug FROM org.skills sk WHERE pg_catalog.lower(sk.label) = pg_catalog.lower(pg_catalog.btrim(l)) LIMIT 1),
                    pg_catalog.btrim(l)
                )
                FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(v_stage->'skills') = 'array' THEN v_stage->'skills' ELSE '[]'::jsonb END
                ) WITH ORDINALITY AS k (l, n)
                WHERE pg_catalog.btrim(l) <> ''
                ORDER BY n
                LIMIT 12
            )
        );

        INSERT INTO projects.tickets (
            project_id, current_stage_id, owner_user_id, title, description, text_description,
            status, required_stages, tasks, unit_price_cents, sort_order
        ) VALUES (
            v_project_id, v_stage_id, v_owner, v_stage_name,
            pg_catalog.jsonb_build_object('html', v_stage_html), v_stage_text,
            'backlog'::ticket_status,
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('stage_id', v_stage_id, 'order', 0)),
            v_checklist,
            v_price,
            0
        );

        PERFORM comms.get_or_create_project_channel(v_project_id, v_stage_id, v_stage_name);
    END LOOP;

    PERFORM comms.get_or_create_project_channel(v_project_id, NULL, 'Discussion');
    -- #endregion

    INSERT INTO projects.service_instantiations (
        project_id, blueprint_id, owner_user_id, idempotency_key, intake_answers, currency
    ) VALUES (v_project_id, v_bp.id, v_owner, v_key, v_answers, v_currency);

    RETURN marketplace.fn_service_draft_json(v_project_id) || pg_catalog.jsonb_build_object('created', true);
END;
$$;

COMMENT ON FUNCTION marketplace.instantiate_service_blueprint (uuid, jsonb, text, text, text) IS
'Add-to-Projects: copies a published Pipeline blueprint into the caller''s personal workspace as a draft — project, stages, one priced backlog ticket per stage, every room and the instantiation record — in one transaction. Idempotent on (caller, key), then on the caller''s live draft of the listing. No escrow, no seat. Returns the draft projection plus created.';

-- ---------------------------------------------------------------------------------------------
-- marketplace.archive_service_draft(p_project_slug text, p_reason text) -> jsonb
--
-- "Remove draft" on a listing — the soft archive of an instantiated draft, refused once anything in
-- it was funded. ONE transaction for the check and the archive: a funded-check in the application
-- followed by a separate status write would let a stage be funded between the two, archiving a
-- project whose escrow then has nowhere to go (the recovery path for which is a support ticket).
--
-- The archive itself is `projects.set_project_status(…, 'archived')`, so it writes the same status
-- history and activity rows every other transition writes, and its own review-authority check runs
-- against the caller. Refusals: not signed in 28000; no such draft of the caller's (or not an
-- instantiated one) P0002 — a project somebody built by hand is archived from its own settings, not
-- from a listing; funded 23514. Archiving an already-archived draft returns it unchanged.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marketplace.archive_service_draft (p_project_slug text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, marketplace, org, comms, auth
AS $$
DECLARE
    v_owner uuid := auth.uid();
    v_project projects.projects%ROWTYPE;
BEGIN
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'Sign in to manage your drafts.' USING ERRCODE = '28000';
    END IF;
    SELECT * INTO v_project FROM projects.projects p
    WHERE p.slug = p_project_slug AND p.owner_user_id = v_owner AND p.source_blueprint_id IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That draft is no longer in your projects.' USING ERRCODE = 'P0002';
    END IF;
    IF v_project.status = 'archived'::project_status THEN
        RETURN marketplace.fn_service_draft_json(v_project.id) || pg_catalog.jsonb_build_object('created', false);
    END IF;
    -- The sweep's own evidence that money moved (`fn_archive_stale_service_drafts`), checked after
    -- locking the project and its stage rows, so a funding path that takes either lock waits for this.
    PERFORM 1 FROM projects.project_stages ps WHERE ps.project_id = v_project.id FOR UPDATE;
    IF EXISTS (
        SELECT 1 FROM finance.escrows e
        JOIN projects.project_stages ps ON ps.id = e.project_stage_id
        WHERE ps.project_id = v_project.id
    ) THEN
        RAISE EXCEPTION 'This project has funded work in it and cannot be archived from here.'
            USING ERRCODE = '23514';
    END IF;
    PERFORM projects.set_project_status(v_project.id, 'archived'::project_status,
        NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_reason, '')), 400), ''));
    RETURN marketplace.fn_service_draft_json(v_project.id) || pg_catalog.jsonb_build_object('created', false);
END;
$$;

COMMENT ON FUNCTION marketplace.archive_service_draft (text, text) IS
'Remove draft: soft-archives the caller''s own instantiated draft through set_project_status, refused (23514) once any stage holds an escrow row. Check and archive in one transaction. Returns the draft projection.';
