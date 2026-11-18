-- ============================================================================
-- 00001175 functions marketplace — service instantiation ("Add to Projects")
--
-- The one write behind `POST /api/services/instantiate-pipeline` on the live path. A Pipeline
-- listing's blueprint becomes a DRAFT engagement OWNED BY ITS SELLER, with the buyer recorded as its
-- client (`client_user_id`, Decision #427 — AMENDS #209, which put it in the buyer's own workspace):
-- the project, one stage per `stage_template` entry, the seller's seat on every stage, every stage's
-- room and the project-wide Discussion room — in ONE transaction, so a buyer can never be navigated
-- to a project that has stages and no rooms. It writes NO tickets: the seller architects the stages,
-- and the client creates the tickets on them (owner ruling, Decision #409).
--
-- No money moves and nothing is reserved (PRODUCT_SPEC.md §Creation & Purchasing Gate; Decision #80):
-- the stages wait unfunded. The seller's seat is the one seat this path mints, because the seller IS
-- the provider of what was bought — there is nobody to hire. It takes no money either: a claim still
-- needs the client's funded escrow (the work-start gate, #165).
--
-- Three doors, all signed-in only (grants in 00002510): `instantiate_service_blueprint` (the write),
-- `get_service_draft` (the listing CTA's read) and `archive_service_draft` ("Remove draft"). Each
-- answers with `fn_service_draft_json`, so the write, the read and the archive cannot describe a
-- draft three ways. Probe: `supabase/probes/service_instantiation.sql`.
--
-- A One-Off or a Task is different (Decision #457): it is scoped, then PAID at checkout, and the
-- payment creates it already funded — `fn_buy_scoped_service`, internal to
-- `finance.place_wallet_order`, writes the engagement, its one master ticket and its first escrow in
-- the order's transaction. Both paths write stages through `fn_write_blueprint_stages` and price them
-- through `fn_blueprint_stage_terms`. Probe: `supabase/probes/one_off_checkout.sql`.
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
-- "Live" is `draft` or `active`, bought by the caller as an individual (`client_user_id`, no paying
-- business or enterprise — Decision #427), newest first, mirroring the
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
    v_buyer uuid := auth.uid();
    v_project uuid;
BEGIN
    IF v_buyer IS NULL OR p_blueprint_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT p.id INTO v_project
    FROM projects.projects p
    WHERE p.client_user_id = v_buyer
        AND p.source_blueprint_id = p_blueprint_id
        AND p.status IN ('draft'::public.project_status, 'active'::public.project_status)
        AND p.client_business_id IS NULL
        AND p.owner_enterprise_id IS NULL
    ORDER BY p.created_at DESC, p.id
    LIMIT 1;
    IF v_project IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN marketplace.fn_service_draft_json(v_project) || pg_catalog.jsonb_build_object('created', false);
END;
$$;

COMMENT ON FUNCTION marketplace.get_service_draft (uuid) IS
'The draft/active engagement the caller bought from this blueprint as an individual (client_user_id, newest), as the shared draft projection, or NULL.';

-- ---------------------------------------------------------------------------------------------
-- marketplace.fn_blueprint_stage_terms(p_bp) -> SETOF (ord, stage, terms…, price)
--
-- The stages a blueprint instantiates into, in order, with the terms each `projects.project_stages`
-- row is written with, and `price`: what one ticket running the stage at its own intensity is held at
-- there, from `projects.fn_ticket_stage_price` — the one rule every escrow path prices by (Decision
-- #414) — applied to exactly those terms. So the checkout's charge, the escrow hold and the stage row
-- cannot disagree (Decision #457).
--
-- A Pipeline or One-Off stage is its `stage_template` entry: `unit_price_cents` is the stage's own
-- Standard price, else — a Pipeline only — the listing's `ticket_price_cents`, else NULL ("priced on
-- scope", as `/view` shows it — never a guessed zero, so `price` is NULL too). A fixed-intensity
-- Pipeline locks every stage at its `intensity`; a tiered one carries the seller's own Low / High
-- prices (Decision #417). A One-Off milestone is always locked at its own price, the figure the
-- configure dialog totals. A Direct Deliverable (a Task) is ONE stage at the listing's own price,
-- locked: its first template entry names and describes it when there is one.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marketplace.fn_blueprint_stage_terms (p_bp marketplace.service_blueprints)
RETURNS TABLE (
    ord integer,
    stage jsonb,
    unit_price_cents bigint,
    intensity text,
    intensity_locked boolean,
    low_price_cents bigint,
    high_price_cents bigint,
    price bigint
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    WITH raw AS (
        SELECT s.ord::integer AS ord,
               CASE WHEN pg_catalog.jsonb_typeof(s.value) = 'object' THEN s.value ELSE '{}'::jsonb END AS stage
          FROM pg_catalog.jsonb_array_elements(
                   CASE WHEN pg_catalog.jsonb_typeof(p_bp.stage_template) = 'array'
                        THEN p_bp.stage_template ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS s (value, ord)
         WHERE p_bp.delivery_model IN ('pipeline', 'one_off')
        UNION ALL
        SELECT 1,
               CASE WHEN pg_catalog.jsonb_typeof(p_bp.stage_template) = 'array'
                         AND pg_catalog.jsonb_typeof(p_bp.stage_template -> 0) = 'object'
                    THEN p_bp.stage_template -> 0 ELSE '{}'::jsonb END
         WHERE p_bp.delivery_model = 'direct_deliverable'
    ),
    terms AS (
        SELECT r.ord, r.stage,
               CASE WHEN p_bp.delivery_model = 'direct_deliverable' THEN p_bp.price_cents
                    ELSE COALESCE(
                        -- Nested CASEs: only a JSON number is cast, whatever order a WHEN's terms run in.
                        CASE WHEN pg_catalog.jsonb_typeof(r.stage -> 'priceCents') = 'number' THEN
                            CASE WHEN (r.stage ->> 'priceCents')::numeric >= 0
                                THEN pg_catalog.trunc((r.stage ->> 'priceCents')::numeric)::bigint END
                        END,
                        CASE WHEN p_bp.delivery_model = 'pipeline' THEN p_bp.ticket_price_cents END)
               END AS unit_price_cents,
               CASE WHEN p_bp.delivery_model = 'direct_deliverable' THEN 'standard'
                    WHEN r.stage ->> 'intensity' IN ('low', 'standard', 'high') THEN r.stage ->> 'intensity'
                    ELSE 'standard'
               END AS intensity,
               -- Tiering is a Pipeline's (Decision #417): a One-Off milestone takes no intensity control
               -- (#417 (b)), so it sells locked at the price its listing quotes.
               (p_bp.delivery_model <> 'pipeline' OR NOT COALESCE(p_bp.allow_tiered_intensity, false))
                   AS intensity_locked
          FROM raw r
    ),
    tiers AS (
        SELECT t.*,
               CASE WHEN NOT t.intensity_locked AND pg_catalog.jsonb_typeof(t.stage -> 'lowPriceCents') = 'number' THEN
                   CASE WHEN (t.stage ->> 'lowPriceCents')::numeric >= 0
                       THEN pg_catalog.trunc((t.stage ->> 'lowPriceCents')::numeric)::bigint END
               END AS low_price_cents,
               CASE WHEN NOT t.intensity_locked AND pg_catalog.jsonb_typeof(t.stage -> 'highPriceCents') = 'number' THEN
                   CASE WHEN (t.stage ->> 'highPriceCents')::numeric >= 0
                       THEN pg_catalog.trunc((t.stage ->> 'highPriceCents')::numeric)::bigint END
               END AS high_price_cents,
               pg_catalog.gen_random_uuid() AS probe_id
          FROM terms t
    )
    SELECT x.ord, x.stage, x.unit_price_cents, x.intensity, x.intensity_locked,
           x.low_price_cents, x.high_price_cents,
           projects.fn_ticket_stage_price(
               pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('stage_id', x.probe_id, 'intensity', x.intensity)),
               NULL,
               pg_catalog.jsonb_populate_record(NULL::projects.project_stages, pg_catalog.jsonb_build_object(
                   'id', x.probe_id,
                   'unit_price_cents', x.unit_price_cents,
                   'intensity_locked', x.intensity_locked,
                   'low_price_cents', x.low_price_cents,
                   'high_price_cents', x.high_price_cents
               ))
           )
      FROM tiers x
     ORDER BY x.ord;
$$;

COMMENT ON FUNCTION marketplace.fn_blueprint_stage_terms (marketplace.service_blueprints) IS
'The stages a blueprint instantiates into, in order, with each stage row''s terms and the price one ticket is held at there (projects.fn_ticket_stage_price on those terms). A Direct Deliverable is one locked stage at the listing price. Shared by fn_write_blueprint_stages and fn_scoped_service_price. Internal.';

-- ---------------------------------------------------------------------------------------------
-- marketplace.fn_write_blueprint_stages(p_project_id, p_bp, p_terms) -> uuid[]
--
-- Writes a blueprint's stages into a new engagement, in order, and returns their ids. The stages are
-- `p_terms` when given — a JSON array of rows in `fn_blueprint_stage_terms`' shape, the seam another
-- terms source (a priced quote) writes through — else the blueprint's own. For each stage:
--   * the `projects.project_stages` row — name, brief (as HTML), deliverables as the stage's default
--     checklist and its milestone line, skills (resolved to `org.skills` slugs where a label matches),
--     its price and intensity terms (frozen afterwards by `trg_stage_intensity_terms`), and its start
--     trigger as the seller authored it (`startTrigger` / `lagDays` / `chainReaction` →
--     `start_trigger_type`, the previous stage as `start_dependency_stage_id`,
--     `start_dependency_lag_days`, `chain_reaction`; Decision #217). The revision allotment arrives
--     through `trg_stage_revision_terms`, which reads the blueprint, so the project's
--     `source_blueprint_id` must already be set. Its CREATE category is the listing's
--     (`catalogue.listings.create_category`; a blueprint has none of its own), whatever priced the
--     stages, so every caller copies it — a label of the work, never a weight on W_i (#338 P4;
--     #417 (c));
--   * the seller's `accepted` seat — a freelancer seat, or the team's for a team listing — so the
--     seller claims the client's funded tickets with no hire step (Decision #427). Inserted here rather
--     than through `invite_to_project`: the seller sells one service to many buyers at once, so the hire
--     door's overlapping-stage refusal (`fn_assignee_slot_conflict`) does not apply, and the W_i cap
--     still bounds what they take on at claim;
--   * the stage's room (`comms.get_or_create_project_channel`, as `projects.create_project` opens it).
-- The project-wide Discussion room is the caller's. Internal: runs inside the instantiation doors.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marketplace.fn_write_blueprint_stages (
    p_project_id uuid,
    p_bp marketplace.service_blueprints,
    p_terms jsonb DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SET search_path = public, projects, marketplace, org, comms, auth
AS $$
DECLARE
    v_t record;
    v_ids uuid[] := '{}'::uuid[];
    v_stage_id uuid;
    v_prev_stage_id uuid;
    v_name text;
    v_text text;
    v_deliverables text[];
    v_tasks jsonb;
    v_trigger text;
    v_trigger_type start_trigger_type;
    v_dependency uuid;
    v_lag integer;
    v_chain boolean;
    v_category org.create_category;
BEGIN
    IF p_terms IS NULL THEN
        SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.ord) INTO p_terms
          FROM marketplace.fn_blueprint_stage_terms(p_bp) t;
    END IF;
    IF p_terms IS NULL OR jsonb_typeof(p_terms) <> 'array' OR jsonb_array_length(p_terms) = 0 THEN
        RAISE EXCEPTION 'This service has no stages to add yet.' USING ERRCODE = '22023';
    END IF;

    -- One listing publishes a blueprint; were there ever two, the published one, then the newest.
    SELECT l.create_category INTO v_category
      FROM catalogue.listings l
     WHERE l.service_blueprint_id = p_bp.id
     ORDER BY (l.status = 'published'::catalogue.listing_status) DESC,
              l.published_at DESC NULLS LAST, l.created_at DESC
     LIMIT 1;

    FOR v_t IN
        SELECT * FROM jsonb_to_recordset(p_terms) AS x (
            ord integer, stage jsonb, unit_price_cents bigint, intensity text,
            intensity_locked boolean, low_price_cents bigint, high_price_cents bigint
        )
        ORDER BY x.ord
    LOOP
        v_t.stage := CASE WHEN jsonb_typeof(v_t.stage) = 'object' THEN v_t.stage ELSE '{}'::jsonb END;
        v_stage_id := gen_random_uuid();
        v_name := pg_catalog.left(COALESCE(
            NULLIF(pg_catalog.btrim(COALESCE(v_t.stage->>'name', '')), ''),
            CASE WHEN p_bp.delivery_model = 'direct_deliverable' THEN 'Delivery' ELSE 'Stage ' || v_t.ord END
        ), 80);
        -- A Task's one stage IS the deliverable, so with no template brief it carries the listing's.
        v_text := pg_catalog.left(COALESCE(
            NULLIF(v_t.stage->>'description', ''),
            CASE WHEN p_bp.delivery_model = 'direct_deliverable' THEN p_bp.description_text END,
            ''
        ), 600);
        v_deliverables := ARRAY(
            SELECT pg_catalog.left(pg_catalog.btrim(d), 160)
            FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(v_t.stage->'deliverables') = 'array' THEN v_t.stage->'deliverables' ELSE '[]'::jsonb END
            ) WITH ORDINALITY AS x (d, n)
            WHERE pg_catalog.btrim(d) <> ''
            ORDER BY n
            LIMIT 12
        );
        -- One id per deliverable: the stage's default checklist, which a ticket on this stage starts from.
        SELECT
            COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', i.id, 'text', i.text) ORDER BY i.n), '[]'::jsonb)
        INTO v_tasks
        FROM (
            SELECT gen_random_uuid() AS id, d AS text, n
            FROM pg_catalog.unnest(v_deliverables) WITH ORDINALITY AS u (d, n)
        ) i;

        -- Mapped exactly as `stageTriggerToDb` maps it: the first stage starts with the project;
        -- `after_previous` depends on the previous stage, `fixed_offset` does too and adds `lagDays`. A
        -- missing or unknown trigger reads as the SSOT default, `after_previous`.
        v_trigger := COALESCE(v_t.stage->>'startTrigger', 'after_previous');
        IF v_t.ord = 1 OR v_trigger = 'on_project_start' THEN
            v_trigger_type := 'on_project_start';
            v_dependency := NULL;
            v_lag := 0;
        ELSE
            v_trigger_type := 'dependent_on_stage';
            v_dependency := v_prev_stage_id;
            v_lag := CASE
                WHEN v_trigger = 'fixed_offset' AND jsonb_typeof(v_t.stage->'lagDays') = 'number'
                THEN LEAST(GREATEST(pg_catalog.trunc((v_t.stage->>'lagDays')::numeric)::integer, 0), 90)
                ELSE 0
            END;
        END IF;
        v_chain := CASE WHEN jsonb_typeof(v_t.stage->'chainReaction') = 'boolean'
            THEN (v_t.stage->>'chainReaction')::boolean ELSE true END;

        INSERT INTO projects.project_stages (
            id, project_id, name, description, description_text, sort_order, status,
            unit_price_cents, milestone, file_upload_required, default_tasks, skills,
            start_trigger_type, start_dependency_stage_id, start_dependency_lag_days, chain_reaction,
            default_intensity, intensity_locked, low_price_cents, high_price_cents, create_category
        ) VALUES (
            v_stage_id, p_project_id, v_name,
            pg_catalog.jsonb_build_object('html', marketplace.fn_plain_text_html(v_text)), v_text,
            (v_t.ord - 1)::integer,
            -- Staffed from birth by the seller's seat below, as the hire path marks a filled stage.
            'assigned'::stage_status,
            v_t.unit_price_cents,
            pg_catalog.left(pg_catalog.array_to_string(v_deliverables, ' · '), 400),
            -- TRUE, as every RPC-created stage is (Projects.md §4.1): a stage exists to produce a
            -- deliverable.
            true,
            v_tasks,
            -- The seller wrote LABELS; projects store skill slugs where the taxonomy knows the label.
            ARRAY(
                SELECT COALESCE(
                    (SELECT sk.slug FROM org.skills sk WHERE pg_catalog.lower(sk.label) = pg_catalog.lower(pg_catalog.btrim(l)) LIMIT 1),
                    pg_catalog.btrim(l)
                )
                FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(v_t.stage->'skills') = 'array' THEN v_t.stage->'skills' ELSE '[]'::jsonb END
                ) WITH ORDINALITY AS k (l, n)
                WHERE pg_catalog.btrim(l) <> ''
                ORDER BY n
                LIMIT 12
            ),
            v_trigger_type, v_dependency, v_lag, v_chain,
            v_t.intensity, v_t.intensity_locked, v_t.low_price_cents, v_t.high_price_cents, v_category
        );

        -- `accepted`, the state a team payout split reads (`finance.fn_ticket_payee`), so a team listing
        -- pays the team as any accepted team seat does.
        INSERT INTO projects.stage_assignments (
            project_stage_id, assignee_type, freelancer_profile_id, team_id, assigned_by,
            is_client_managed, status
        ) VALUES (
            v_stage_id,
            CASE WHEN p_bp.owner_team_id IS NULL THEN 'freelancer' ELSE 'team' END::assignment_type,
            CASE WHEN p_bp.owner_team_id IS NULL THEN p_bp.freelancer_profile_id END,
            p_bp.owner_team_id,
            p_bp.freelancer_profile_id, false, 'accepted'
        );

        PERFORM comms.get_or_create_project_channel(p_project_id, v_stage_id, v_name);
        v_prev_stage_id := v_stage_id;
        v_ids := v_ids || v_stage_id;
    END LOOP;
    RETURN v_ids;
END;
$$;

COMMENT ON FUNCTION marketplace.fn_write_blueprint_stages (uuid, marketplace.service_blueprints, jsonb) IS
'Writes stages into a new engagement — p_terms (rows in fn_blueprint_stage_terms'' shape) or the blueprint''s own: each stage row, labelled with its listing''s CREATE category (#417 (c)), the seller''s accepted seat on it and its room. Returns the stage ids in order. Internal: called by instantiate_service_blueprint and fn_buy_scoped_service.';

-- ---------------------------------------------------------------------------------------------
-- marketplace.fn_scoped_service_price(p_blueprint_id, p_whole) -> bigint | NULL
--
-- What checkout charges for a One-Off or a Task (Decision #457): the first milestone's price, or every
-- milestone's under the buyer's whole-project prepay; a Task's one stage. NULL when the listing is not
-- a One-Off or Direct Deliverable or a charged milestone has no price — the line is then refused,
-- never charged a guess. `finance.place_wallet_order` checks the submitted unit against it, and
-- `fn_buy_scoped_service` holds exactly it.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marketplace.fn_scoped_service_price (p_blueprint_id uuid, p_whole boolean)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE WHEN pg_catalog.count(*) = 0 OR pg_catalog.bool_or(t.price IS NULL OR t.price <= 0) THEN NULL
                ELSE pg_catalog.sum(t.price)::bigint END
      FROM marketplace.service_blueprints sb
     CROSS JOIN LATERAL marketplace.fn_blueprint_stage_terms(sb) t
     WHERE sb.id = p_blueprint_id
       AND sb.delivery_model IN ('one_off', 'direct_deliverable')
       AND (t.ord = 1 OR COALESCE(p_whole, false));
$$;

COMMENT ON FUNCTION marketplace.fn_scoped_service_price (uuid, boolean) IS
'Checkout price of a One-Off (milestone 1, or every milestone when p_whole) or a Task (its one stage), from fn_blueprint_stage_terms; NULL when not scoped or unpriced. Internal.';

-- ---------------------------------------------------------------------------------------------
-- marketplace.fn_intake_answers(p_fields, p_intake) -> jsonb
--
-- A buyer's answers reduced to the questions the listing asks (`intake_fields` ids): an answer to a
-- question the seller never wrote is not part of the brief, and keeping it would let a caller park
-- arbitrary data on somebody else's listing. Refuses a non-object (22023) or one over 32 KB (22023).
-- Required-field enforcement is the Zod SSOT's (`intakeRefusal`), applied by the fat service.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marketplace.fn_intake_answers (p_fields jsonb, p_intake jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_answers jsonb;
BEGIN
    IF p_intake IS NOT NULL AND pg_catalog.jsonb_typeof(p_intake) <> 'object' THEN
        RAISE EXCEPTION 'The answers to this service''s questions are malformed.' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.pg_column_size(p_intake) > 32768 THEN
        RAISE EXCEPTION 'The answers to this service''s questions are too long.' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(pg_catalog.jsonb_object_agg(a.key, a.value), '{}'::jsonb) INTO v_answers
      FROM pg_catalog.jsonb_each(COALESCE(p_intake, '{}'::jsonb)) a
     WHERE a.key IN (
        SELECT f ->> 'id' FROM pg_catalog.jsonb_array_elements(
            CASE WHEN pg_catalog.jsonb_typeof(p_fields) = 'array' THEN p_fields ELSE '[]'::jsonb END
        ) f
     );
    RETURN v_answers;
END;
$$;

COMMENT ON FUNCTION marketplace.fn_intake_answers (jsonb, jsonb) IS
'A buyer''s intake answers reduced to the listing''s own question ids; refuses a non-object or an oversize payload (22023). Internal.';

-- ---------------------------------------------------------------------------------------------
-- marketplace.instantiate_service_blueprint(p_blueprint_id, p_intake, p_currency,
--                                           p_idempotency_key, p_title) -> jsonb
--
-- WHAT IT WRITES, in one transaction:
--   1. `projects.projects` — owner the listing's seller (`freelancer_profile_id`, filed under its
--      `owner_team_id` for a team listing), `client_user_id` = `auth.uid()` (Decision #427),
--      `format = 'pipeline'`, `status = 'draft'`, `visibility = 'unlisted'`, `source_blueprint_id`,
--      the listing's brief and currency;
--   2. one stage per `stage_template` entry, in order, with the seller's `accepted` seat and the
--      stage's room on each (`fn_write_blueprint_stages`, whose terms are `fn_blueprint_stage_terms`);
--   3. the project-wide Discussion room (`comms.get_or_create_project_channel`, as
--      `projects.create_project` opens it);
--   4. `projects.service_instantiations` — the request: key, answers (`fn_intake_answers`), currency.
--   No `projects.tickets` row: the client creates every ticket. A ticket created on a stage defaults
--   to that stage's price (`finance.fn_hold_ticket_escrow` holds `COALESCE(ticket, stage)` at claim).
--
-- IDEMPOTENT, in this order (all under one per-owner advisory lock, so two concurrent presses
-- serialise instead of racing to two projects):
--   a. the caller's `p_idempotency_key` already made a project → that project, `created: false`
--      (whatever its status since — a replay returns what the request did). The same key naming a
--      DIFFERENT listing is a client bug and is refused (22023), never silently answered;
--   b. the caller already bought a live draft of this listing (`get_service_draft`'s predicate) → that
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
--   * its seller is an adult (P0002 otherwise): the seller now owns the engagement, and a minor's
--     project is forced personal and stripped of every price;
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
    v_seller uuid;
    v_seller_team uuid;
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
    v_seller := v_bp.freelancer_profile_id;
    v_seller_team := v_bp.owner_team_id;
    IF org.fn_is_minor(v_seller) THEN
        RAISE EXCEPTION 'That service is not available.' USING ERRCODE = 'P0002';
    END IF;

    v_currency := pg_catalog.upper(v_bp.currency);
    IF NULLIF(pg_catalog.btrim(COALESCE(p_currency, '')), '') IS NOT NULL
       AND pg_catalog.upper(pg_catalog.btrim(p_currency)) <> v_currency THEN
        RAISE EXCEPTION 'This service is priced in %.', v_currency USING ERRCODE = 'PC409';
    END IF;

    v_answers := marketplace.fn_intake_answers(v_bp.intake_fields, p_intake);
    -- #endregion

    -- #region (b) An existing live draft of this listing
    -- A Pipeline draft only: a bought One-Off or Task of the same listing is its own engagement.
    SELECT p.id INTO v_existing
    FROM projects.projects p
    WHERE p.client_user_id = v_owner
        AND p.source_blueprint_id = v_bp.id
        AND p.format = 'pipeline'::project_format
        AND p.status IN ('draft'::project_status, 'active'::project_status)
        AND p.client_business_id IS NULL
        AND p.owner_enterprise_id IS NULL
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
                id, owner_user_id, owner_team_id, client_user_id, title, description, description_text,
                format, structure_variation, session_kind, status, visibility, currency,
                budget_type, budget_amount_cents, source_blueprint_id, last_activity_at
            ) VALUES (
                v_project_id, v_seller, v_seller_team, v_owner, v_title,
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

    -- #region Stages, the seller's seats and every room
    PERFORM marketplace.fn_write_blueprint_stages(v_project_id, v_bp);
    PERFORM comms.get_or_create_project_channel(v_project_id, NULL, 'Discussion');
    -- #endregion

    INSERT INTO projects.service_instantiations (
        project_id, blueprint_id, owner_user_id, idempotency_key, intake_answers, currency
    ) VALUES (v_project_id, v_bp.id, v_owner, v_key, v_answers, v_currency);

    RETURN marketplace.fn_service_draft_json(v_project_id) || pg_catalog.jsonb_build_object('created', true);
END;
$$;

COMMENT ON FUNCTION marketplace.instantiate_service_blueprint (uuid, jsonb, text, text, text) IS
'Add-to-Projects: copies a published Pipeline blueprint into a draft engagement owned by its seller with the caller as its client (client_user_id, Decision #427) — project, stages, the seller''s accepted seat on each, every room and the instantiation record — in one transaction. No tickets: the client creates them. Idempotent on (caller, key), then on the caller''s live draft of the listing. No escrow. Returns the draft projection plus created.';

-- ---------------------------------------------------------------------------------------------
-- marketplace.fn_buy_scoped_service(p_blueprint_id, p_brief, p_answers, p_target_date, p_whole,
--                                   p_idempotency_key, p_terms) -> jsonb
--
-- A One-Off or a Task paid at checkout becomes a funded engagement (Decision #457), inside the
-- order's own transaction and AS ITS BUYER (`auth.uid()`). `finance.place_wallet_order` calls it for
-- a `one_off_service` / `single_service_task` line once the line's price has been checked against
-- `fn_scoped_service_price`; any refusal here rolls the whole order back, so no engagement outlives a
-- failed payment and no payment outlives a failed engagement.
--
-- WHAT IT WRITES:
--   1. `projects.projects` — owned by the listing's seller (`owner_team_id` for a team listing), the
--      buyer its client (`client_user_id`, Decision #427), `format = 'one_off'` with
--      `structure_variation` `one_off` (milestones) or `single_task` (a Direct Deliverable), draft and
--      unlisted until step 5. `budget_amount_cents` is every stage's price, the one-off's escrow
--      budget. `allow_deadline_bonuses` is on only when the buyer chose a target date, because a due
--      date needs those terms (`fn_enforce_ticket_due_date`); the bonus stays 0 until it is held with
--      the escrow (`ck_escrows_bonus_unfunded`);
--   2. its stages, seats and rooms (`fn_write_blueprint_stages`, from `p_terms` or the listing's own)
--      and the project-wide Discussion room;
--   3. the ONE master ticket (`fn_enforce_structure_variation`), authored by the buyer: titled as the
--      listing, the brief as its description, running every stage in order at that stage's own
--      intensity (a One-Off's milestones take no intensity control, #417 (b)), the target date as the
--      final stage's due date; in New and unclaimed, so funding places it and the seller claims it;
--   4. `projects.service_instantiations` — key, answers, currency;
--   5. `projects.fund_ticket` as the buyer: the first stage is held; under the whole-project prepay
--      every later stage is reserved and held when the ticket arrives (Decision #430). Otherwise each
--      later stage locks when the previous one is approved (the Chain Reaction, Decision #210) or
--      waits as Needs funding. Then `projects.set_project_status(…, 'active')`.
--
-- CALLER CHECKS (SECURITY DEFINER and internal — no client role may execute it): signed in (28000),
-- an adult (PM403), a key of 8–120 characters (22023), a published (P0002) One-Off or Direct
-- Deliverable (22023) — any listing when `p_terms` is given, because a quote offer may answer a
-- Pipeline or a private cohort and is bought as a One-Off all the same (Decision #458 (a); CK7) —
-- with at least one priced stage (22023), not the buyer's own or their team's
-- (PU422), an adult seller (P0002), a brief (22023), a target date not in the past (22007).
--
-- RETURNS {project_id, project_slug, ticket_id, stage_ids, escrow_id, amount_cents, currency,
-- reserved_stage_ids, intake_answers}.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION marketplace.fn_buy_scoped_service (
    p_blueprint_id uuid,
    p_brief text,
    p_answers jsonb DEFAULT '{}'::jsonb,
    p_target_date date DEFAULT NULL,
    p_whole boolean DEFAULT false,
    p_idempotency_key text DEFAULT NULL,
    p_terms jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, marketplace, org, comms, auth
AS $$
DECLARE
    v_client uuid := auth.uid();
    v_key text := NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key, '')), '');
    v_brief text := pg_catalog.left(pg_catalog.btrim(COALESCE(p_brief, '')), 8000);
    v_bp marketplace.service_blueprints%ROWTYPE;
    v_terms jsonb;
    v_budget bigint;
    v_answers jsonb;
    v_currency text;
    v_project_id uuid := gen_random_uuid();
    v_slug text;
    v_attempt integer := 0;
    v_constraint text;
    v_stage_ids uuid[];
    v_ticket_id uuid;
    v_required jsonb;
    v_workload numeric;
    v_funded jsonb;
BEGIN
    -- #region The buyer and the listing
    IF v_client IS NULL THEN
        RAISE EXCEPTION 'Sign in to pay for this service.' USING ERRCODE = '28000';
    END IF;
    PERFORM org.fn_assert_adult(v_client);
    IF v_key IS NULL OR pg_catalog.char_length(v_key) NOT BETWEEN 8 AND 120 THEN
        RAISE EXCEPTION 'This purchase is missing its retry key.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_bp FROM marketplace.service_blueprints sb WHERE sb.id = p_blueprint_id;
    IF NOT FOUND OR NOT v_bp.is_published THEN
        RAISE EXCEPTION 'That service is not available.' USING ERRCODE = 'P0002';
    END IF;
    IF p_terms IS NULL AND v_bp.delivery_model NOT IN ('one_off'::marketplace.service_delivery_model,
                                                       'direct_deliverable'::marketplace.service_delivery_model) THEN
        RAISE EXCEPTION 'Only a One-Off or a Task is scoped and paid for at checkout.' USING ERRCODE = '22023';
    END IF;
    IF v_bp.freelancer_profile_id = v_client OR (
        v_bp.owner_team_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM org.team_members tm
            WHERE tm.team_id = v_bp.owner_team_id AND tm.user_id = v_client AND tm.status = 'active'
        )
    ) THEN
        RAISE EXCEPTION 'You can''t buy your own service.' USING ERRCODE = 'PU422';
    END IF;
    IF org.fn_is_minor(v_bp.freelancer_profile_id) THEN
        RAISE EXCEPTION 'That service is not available.' USING ERRCODE = 'P0002';
    END IF;
    IF v_brief = '' THEN
        RAISE EXCEPTION 'Describe what you need before paying for this service.' USING ERRCODE = '22023';
    END IF;
    IF p_target_date IS NOT NULL AND p_target_date < current_date THEN
        RAISE EXCEPTION 'Pick a target date that hasn''t passed.' USING ERRCODE = '22007';
    END IF;
    v_answers := marketplace.fn_intake_answers(v_bp.intake_fields, p_answers);
    v_currency := pg_catalog.upper(v_bp.currency);

    v_terms := COALESCE(p_terms, (
        SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.ord)
          FROM marketplace.fn_blueprint_stage_terms(v_bp) t
    ));
    SELECT CASE WHEN pg_catalog.bool_or(NULLIF(e->>'price', '') IS NULL OR (e->>'price')::bigint <= 0) THEN NULL
                ELSE pg_catalog.sum((e->>'price')::bigint)::bigint END
      INTO v_budget
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_terms) = 'array' THEN v_terms ELSE '[]'::jsonb END) e;
    IF v_budget IS NULL THEN
        RAISE EXCEPTION 'This service has no price for every stage yet, so it can''t be paid for here.'
            USING ERRCODE = '22023';
    END IF;
    -- #endregion

    -- #region The engagement
    -- The slug is minted by `trg_projects_slug`; a collision is retried with a fresh draw, as
    -- `instantiate_service_blueprint` and `projects.create_project` do.
    LOOP
        BEGIN
            INSERT INTO projects.projects (
                id, owner_user_id, owner_team_id, client_user_id, title, description, description_text,
                format, structure_variation, session_kind, status, visibility, currency,
                budget_type, budget_amount_cents, source_blueprint_id, allow_deadline_bonuses,
                last_activity_at
            ) VALUES (
                v_project_id, v_bp.freelancer_profile_id, v_bp.owner_team_id, v_client,
                pg_catalog.left(v_bp.title, 200),
                COALESCE(v_bp.description, '{}'::jsonb), COALESCE(v_bp.description_text, ''),
                'one_off'::project_format,
                CASE WHEN v_bp.delivery_model = 'direct_deliverable'::marketplace.service_delivery_model
                     THEN 'single_task' ELSE 'one_off' END::projects.structure_variation,
                'none', 'draft'::project_status, 'unlisted'::visibility, v_currency,
                'fixed_price'::budget_type, v_budget, v_bp.id, p_target_date IS NOT NULL, now()
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

    v_stage_ids := marketplace.fn_write_blueprint_stages(v_project_id, v_bp, v_terms);
    PERFORM comms.get_or_create_project_channel(v_project_id, NULL, 'Discussion');
    -- #endregion

    -- #region The master ticket
    -- `workload_intensity` sums each stage's $W_i$ (0.5 / 1 / 2, `WORKLOAD_MULTIPLIER`), as the
    -- ticket composer's `ticketWorkload` does.
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'stage_id', s.id,
               'order', s.n - 1,
               'intensity', ps.default_intensity,
               'due_at', CASE WHEN s.n = pg_catalog.cardinality(v_stage_ids)
                              THEN pg_catalog.to_char(p_target_date, 'YYYY-MM-DD') END
           ) ORDER BY s.n),
           LEAST(pg_catalog.sum(CASE ps.default_intensity WHEN 'low' THEN 0.5 WHEN 'high' THEN 2 ELSE 1 END), 99.99)
      INTO v_required, v_workload
      FROM pg_catalog.unnest(v_stage_ids) WITH ORDINALITY AS s (id, n)
      JOIN projects.project_stages ps ON ps.id = s.id;

    INSERT INTO projects.tickets (
        project_id, owner_user_id, title, description, text_description, status,
        required_stages, workload_intensity
    ) VALUES (
        v_project_id, v_client, pg_catalog.left(v_bp.title, 200),
        pg_catalog.jsonb_build_object('html', marketplace.fn_plain_text_html(v_brief)), v_brief,
        'backlog'::ticket_status, v_required, v_workload
    )
    RETURNING id INTO v_ticket_id;
    -- #endregion

    INSERT INTO projects.service_instantiations (
        project_id, blueprint_id, owner_user_id, idempotency_key, intake_answers, currency
    ) VALUES (v_project_id, v_bp.id, v_client, v_key, v_answers, v_currency);

    -- #region Funding and activation
    v_funded := projects.fund_ticket(
        v_project_id, v_ticket_id,
        CASE WHEN COALESCE(p_whole, false) THEN v_stage_ids END
    );
    PERFORM projects.set_project_status(v_project_id, 'active'::project_status, 'Paid at checkout');
    -- #endregion

    RETURN pg_catalog.jsonb_build_object(
        'project_id', v_project_id,
        'project_slug', v_slug,
        'ticket_id', v_ticket_id,
        'stage_ids', pg_catalog.to_jsonb(v_stage_ids),
        'escrow_id', v_funded->'escrow_id',
        'amount_cents', (v_funded->>'amount_cents')::bigint,
        'currency', v_currency,
        'reserved_stage_ids', COALESCE(v_funded->'reserved_stage_ids', '[]'::jsonb),
        'intake_answers', v_answers
    );
END;
$$;

COMMENT ON FUNCTION marketplace.fn_buy_scoped_service (uuid, text, jsonb, date, boolean, text, jsonb) IS
'A One-Off or Task paid at checkout becomes a funded engagement in the order''s transaction, as its buyer (Decision #457): the seller-owned project with the buyer as client, its stages, seats and rooms, the one master ticket, the instantiation record, projects.fund_ticket (first stage held; every stage under p_whole) and draft -> active. With p_terms (a quote offer''s, Decision #458 (a)) any listing the seller sells is bought as a One-Off on those terms. Internal: called by finance.place_wallet_order.';

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
-- against the caller (the client person, Decision #427). Refusals: not signed in 28000; no such
-- draft the caller bought (or not an
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
    WHERE p.slug = p_project_slug AND p.client_user_id = v_owner AND p.source_blueprint_id IS NOT NULL
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
