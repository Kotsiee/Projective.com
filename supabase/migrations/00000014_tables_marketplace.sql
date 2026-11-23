-- =============================================================================================
-- 00000014_tables_marketplace.sql — marketplace schema tables (Category 0).
-- Source: 0006_marketplace_tables.sql.
--
-- What a seller OFFERS. `marketplace.service_blueprints` is the source of truth for how a service is
-- delivered and priced; `catalogue.listings` (00000023) points at a blueprint to record that the
-- seller has put it up for sale, and does not restate its delivery model.
--
-- ---------------------------------------------------------------------------------------------
-- SCOPE SEAM WITH `catalogue` — FLAGGED, NOT SILENTLY RESOLVED
-- ---------------------------------------------------------------------------------------------
-- The discovery corpus browses eight entity formats, two of which — digital products and articles —
-- are modelled in `catalogue` (`catalogue.products`, `catalogue.articles`, 00000023). They are
-- deliberately NOT duplicated here under marketplace names. Two tables for one entity would give
-- `finance.basket_items.item_id` two candidate targets for the same `digital_product` item kind with
-- nothing to say which is authoritative, and `catalogue.listings.product_id` already carries a real
-- foreign key to the catalogue one. Whether products and articles ultimately belong beside services
-- in `marketplace` or beside the seller console in `catalogue` is a placement decision for a human;
-- what must not happen either way is both.
-- =============================================================================================

CREATE TABLE marketplace.service_blueprints (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    -- OWNERSHIP. A service is sold by an individual freelancer or by a team, and the discovery corpus
    -- already carries both (four of the nine seeded services are team-owned). `owner_type` is what a
    -- card credits; `freelancer_profile_id` stays NOT NULL as the accountable human behind either
    -- shape, so a listing can never be owned by nobody and the existing marketplace RLS policies —
    -- which all key on `freelancer_profile_id = auth.uid()` — keep working unchanged. The two are
    -- pinned to each other by `service_blueprints_owner_shape_check` below, so a row cannot claim to
    -- be team-owned while naming no team, nor name a team while claiming to be an individual's.
    owner_type text NOT NULL DEFAULT 'freelancer'::text,
    owner_team_id uuid,
    freelancer_profile_id uuid NOT NULL,
    title text NOT NULL,

    -- The service's public address, on the same contract as `projects.projects.slug`: opaque, derived
    -- from nothing, minted once and refused by `security.fn_slug_guard` on any later update.
    --
    -- It matters more here than anywhere else that it is title-independent. A seller renames a listing
    -- to reposition it — that is ordinary catalogue work, not a republication — and under a
    -- title-derived address every card, share link and search result pointing at it would die on the
    -- edit, silently, at exactly the moment the seller was trying to sell more of it.
    slug text NOT NULL,
    description jsonb NOT NULL DEFAULT '{}'::jsonb,
    description_text text NOT NULL DEFAULT ''::text,
    -- HOW the work is delivered, which is a different axis from `pricing_model` (how it is BILLED).
    -- The whole /view archetype dispatch, the `?model=` discovery facet and the booking flow all key
    -- on this one value, and none of them can be answered by flat_fee/per_seat/recurring_retainer.
    -- A real enum rather than text because it is shared member-for-member with the `ServiceType` Zod
    -- SSOT: the database and the types package are one vocabulary, not two that agree today.
    delivery_model marketplace.service_delivery_model NOT NULL DEFAULT 'one_off'::marketplace.service_delivery_model,
    pricing_model marketplace.pricing_model NOT NULL DEFAULT 'per_seat'::marketplace.pricing_model,
    -- `price_cents` is the headline engagement fee. The two below are the per-UNIT prices a Pipeline
    -- and a Session are actually bought at, and they are genuinely different figures — the card
    -- quotes a Pipeline sold at tiered intensity as a 0.75x-1.5x price range around the ticket price
    -- (one sold at a fixed intensity at that price alone), and a booked sitting or
    -- cohort seat is charged at the session price. Each is nullable because "not priced" and "priced
    -- at zero" are different claims, and a NOT NULL DEFAULT 0 would erase that difference on every
    -- blueprint that simply does not sell that way.
    price_cents bigint NOT NULL CHECK (price_cents >= 0),
    ticket_price_cents bigint CHECK (ticket_price_cents IS NULL OR ticket_price_cents >= 0),
    session_price_cents bigint CHECK (session_price_cents IS NULL OR session_price_cents >= 0),
    currency text NOT NULL DEFAULT 'USD'::text CHECK (currency ~ '^[A-Z]{3}$'),

    -- The discovery taxonomy the `?cat=` facet filters on and every card prints. Defaulted to the
    -- empty string rather than a literal like 'other': '' reads as "the seller has not categorised
    -- this", whereas 'other' would look like a taxonomy member while matching no facet value, so a
    -- listing carrying it would be silently unfindable.
    category text NOT NULL DEFAULT ''::text,

    -- The 16:10 hero of every card and the first frame of the /view gallery. Same shape as
    -- `org.users_public.avatar_file_id` / `banner_file_id`: an asset reference on the owning row,
    -- because `files.items` has no listing anchor of its own.
    cover_file_id uuid,

    -- REVISION POLICY — a commitment the seller declares, not a property derivable from the listing.
    -- Both stay nullable and 0 is meaningful on both: `free_revisions = 0` says no rounds are
    -- included, NULL says nothing was declared and the corpus default applies;
    -- `extra_revision_price_cents = 0` says unlimited revisions at no charge, NULL says unpriced.
    -- Collapsing either pair into one value would turn "unstated" into a stated offer.
    free_revisions integer CHECK (free_revisions IS NULL OR free_revisions >= 0),
    extra_revision_price_cents bigint CHECK (extra_revision_price_cents IS NULL OR extra_revision_price_cents >= 0),
    requires_upfront_escrow boolean NOT NULL DEFAULT true,
    max_seats_per_cohort integer NOT NULL DEFAULT 1,
    allow_continuous_enrollment boolean NOT NULL DEFAULT false,
    enrollment_window_days integer DEFAULT 7,
    -- A Group Session's ROLLING WEEKLY TEMPLATES (SC11): `{ "weekly": [{ "weekday", "startMinute" }, …] }`,
    -- one entry per sitting, read BY POSITION like `session_plan` (entry 0 is session 1). `weekday` is ISO
    -- (1 Monday … 7 Sunday) and `startMinute` the minutes after midnight in the seller's own zone. Read
    -- only under `group_schedule_mode = 'rolling_templates'`; written only by `projects.save_group_schedule`,
    -- which refuses a malformed or overlapping week (`projects.fn_weekly_templates_refusal`).
    session_template_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- How a Group Session's cohorts are opened (SC11). `fixed_cohorts`, the default: the seller opens each
    -- one by hand (`projects.open_cohort`, Decision #498). `rolling_templates`: every occurrence of session
    -- 1's template within `rolling_horizon_weeks` starts a chain whose session k is the next occurrence of
    -- template k after session k-1 ends, opened as an ordinary cohort (`projects.fn_open_template_cohorts`).
    group_schedule_mode text NOT NULL DEFAULT 'fixed_cohorts'
        CHECK (group_schedule_mode IN ('fixed_cohorts', 'rolling_templates')),
    -- The seller's own INTAKE: the questions a buyer answers on the way to purchase (Decision #108).
    -- An ORDERED array of `IntakeField` objects — text · textarea · number (optionally with a slider)
    -- · boolean · select · multiselect · radio · pills · checkboxes — whose element shape is owned by
    -- the Zod SSOT (`@projective/types/services/intake.ts`, `IntakeFieldSchema`) and validated by every
    -- fat service that writes or reads it. It is a jsonb DOCUMENT rather than a child table for the
    -- same reason `session_template_rules` is: the seller authors the list as one unit, every reader
    -- takes it whole, and nothing ever queries across listings by field. The CHECK below refuses only
    -- what no reader could interpret at all — a non-array, or more fields than the SSOT's cap
    -- (`INTAKE_FIELDS_MAX` = 12) — so a stray scalar cannot be stored while the real validation stays
    -- in one place. Answers never live here: they travel on the purchase (`finance.basket_items.metadata`
    -- under `answers`) or the invitation (`projects.project_invitations.answers`), keyed by field id.
    intake_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- THE STAGE TEMPLATE a Pipeline or One-Off service is delivered through — the showcase the /view
    -- service template renders and the stages "Add to projects" instantiates (Decision #80). An
    -- ORDERED array of `BlueprintStage` objects (`@projective/types/explore` `stored.ts` — name,
    -- description, deliverables, turnaround, the stage's price in minor units, skill labels, when
    -- the stage starts: `startTrigger` on_project_start · after_previous · fixed_offset, `lagDays`
    -- 0–90, `chainReaction`, and its intensity terms: `intensity` low · standard · high and the
    -- optional `lowPriceCents` / `highPriceCents` read under `allow_tiered_intensity`), owned by that
    -- Zod SSOT and validated by every reader.
    -- `catalogue.save_listing` checks each element's shape on the way in, and
    -- `marketplace.instantiate_service_blueprint` maps the trigger fields onto `project_stages`.
    --
    -- A jsonb DOCUMENT, not a child table, for the reason `intake_fields` is one: the seller authors
    -- the sequence as one unit and every reader takes it whole. Empty is meaningful — a Direct
    -- Deliverable or a Session has no stages, and a Pipeline whose seller has not written any is a
    -- listing the showcase simply omits rather than one it fills with invented phases.
    stage_template jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- How the stage template prices intensity (Decision #417). Off (the default for a productised
    -- service): each stage sells at ONE fixed intensity and price — its `intensity` and `priceCents` —
    -- and the instantiated stages are locked. On: the client picks Low · Standard · High per ticket,
    -- priced at each stage's `lowPriceCents` / `highPriceCents` where the seller set one, else at the
    -- platform's tier multiple of its `priceCents`.
    allow_tiered_intensity boolean NOT NULL DEFAULT false,
    -- A Direct Deliverable's TEAM: the named roles the engagement staffs (`ServiceRole` — name,
    -- summary, skill labels, headcount). Seller-declared, for the same reason the stage template is.
    team_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- What the buyer receives, as the seller states it: the "what you get" list on the listing page.
    -- For a staged service the stage template's per-stage deliverables are the fuller answer; this is
    -- the flat list a Direct Deliverable, a Session or a stage-less listing prints.
    deliverables text[] NOT NULL DEFAULT '{}'::text[],
    -- A Session's fixed sitting length and, for a set-session block, how many sittings one purchase
    -- commits to (`PRODUCT_SPEC.md` §Why Sessions are Fixed — the buyer never chooses the length).
    -- NULL on every non-session model, where a duration or a count would be meaningless rather than
    -- zero, and NULL on a session whose seller has not stated one — the booking layer then says so
    -- instead of assuming an hour.
    session_minutes integer CHECK (session_minutes IS NULL OR session_minutes BETWEEN 5 AND 600),
    session_count integer CHECK (session_count IS NULL OR session_count BETWEEN 1 AND 52),
    -- THE SESSION PLAN: what each sitting of a fixed-count Session or Group Session covers, as the
    -- seller writes it (Decision #411). An ORDERED array of `{ title, description, durationMinutes? }` objects
    -- (`@projective/types/explore` `stored.ts`, `BlueprintSessionPlanEntrySchema`) read BY POSITION —
    -- entry 0 is session 1 — so a blank entry keeps the numbers of the ones after it. A document for
    -- the reason `stage_template` is one. Readers take at most `session_count` entries.
    session_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- A 1-on-1 Session sold as an ONGOING relationship rather than a fixed block (Decision #411): every
    -- booking is one session and the buyer books again whenever they need another, so a rolling row has
    -- no count beyond one and no plan (`ck_service_blueprints_rolling_session`).
    session_rolling boolean NOT NULL DEFAULT false,
    -- How a Session or Group Session is priced (SC10). `per_session`, the default, sells each sitting at
    -- `session_price_cents`; `per_hour` reads that column as an hourly rate, and a sitting then costs
    -- ⌊rate × its minutes ÷ 60⌋, floored per sitting (`projects.fn_sitting_price`). A sitting's length is
    -- its plan entry's `durationMinutes`, else `session_minutes`. Only a per-hour listing may give its
    -- sittings lengths of their own (`ck_service_blueprints_session_lengths`), so one flat price never
    -- covers a 30-minute and a two-hour sitting alike.
    pricing_unit text NOT NULL DEFAULT 'per_session' CHECK (pricing_unit IN ('per_session', 'per_hour')),
    -- A One-Off's delivery time in days, as the seller commits to it (Decision #217). NULL until stated.
    turnaround_days smallint CHECK (turnaround_days IS NULL OR turnaround_days BETWEEN 1 AND 90),
    -- The room provider a Session or Group Session books into. NULL defers to the seller's connected
    -- default (`scheduling.fn_conferencing_provider`). The same set as `scheduling.events`.
    meeting_provider text CHECK (
        meeting_provider IS NULL
        OR meeting_provider IN ('google', 'outlook', 'zoom', 'microsoft_teams', 'discord', 'custom')
    ),
    -- The availability preset a Session books against (Decision #217(c)); NULL means the owner
    -- schedule's default. Its FK is in 00000031, because `scheduling.availability_presets` is created
    -- after this file.
    availability_preset_id uuid,
    is_published boolean NOT NULL DEFAULT false,
    rating_average numeric(3,2) DEFAULT 0.0,
    rating_count integer DEFAULT 0,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),

    CONSTRAINT service_blueprints_pkey PRIMARY KEY (id),
    CONSTRAINT service_blueprints_slug_key UNIQUE (slug),
    -- The exact shape `security.mint_slug('svc')` produces, and nothing else — the same contract, the
    -- same alphabet and the same cross-check as `ck_projects_slug_shape`.
    CONSTRAINT ck_service_blueprints_slug_shape
        CHECK (slug ~ '^svc-[23456789abcdefghjkmnopqrstuvwxyz]{10}$'),
    CONSTRAINT service_blueprints_freelancer_fkey FOREIGN KEY (freelancer_profile_id) REFERENCES org.freelancer_profiles(user_id),
    CONSTRAINT service_blueprints_owner_team_fkey FOREIGN KEY (owner_team_id) REFERENCES org.teams(id) ON DELETE CASCADE,
    CONSTRAINT service_blueprints_cover_fkey FOREIGN KEY (cover_file_id) REFERENCES files.items(id) ON DELETE SET NULL,
    CONSTRAINT ck_service_blueprints_intake_shape CHECK (
        jsonb_typeof(intake_fields) = 'array' AND jsonb_array_length(intake_fields) <= 12
    ),
    -- Refuse only what no reader could interpret — a non-array, or more entries than the SSOT allows.
    -- The element shape is validated in one place, the Zod SSOT, rather than restated here.
    CONSTRAINT ck_service_blueprints_stage_template_shape CHECK (
        jsonb_typeof(stage_template) = 'array' AND jsonb_array_length(stage_template) <= 12
    ),
    CONSTRAINT ck_service_blueprints_team_roles_shape CHECK (
        jsonb_typeof(team_roles) = 'array' AND jsonb_array_length(team_roles) <= 12
    ),
    CONSTRAINT ck_service_blueprints_session_plan_shape CHECK (
        jsonb_typeof(session_plan) = 'array' AND jsonb_array_length(session_plan) <= 52
    ),
    -- Settlement writes `session_count` sittings per purchase, so a rolling listing must be one sitting
    -- per booking, with no per-sitting plan to promise.
    CONSTRAINT ck_service_blueprints_rolling_session CHECK (
        NOT session_rolling
        OR (COALESCE(session_count, 1) = 1 AND jsonb_array_length(session_plan) = 0)
    ),
    CONSTRAINT ck_service_blueprints_session_lengths CHECK (
        pricing_unit = 'per_hour' OR NOT jsonb_path_exists(session_plan, '$[*].durationMinutes ? (@ != null)')
    ),
    -- The discriminator and the team reference must agree. Storing both without this constraint is
    -- how a row comes to say "team-owned" while pointing at no team, which a reader can only resolve
    -- by guessing which of the two fields to believe.
    CONSTRAINT service_blueprints_owner_shape_check CHECK (
        (owner_type = 'freelancer'::text AND owner_team_id IS NULL)
        OR (owner_type = 'team'::text AND owner_team_id IS NOT NULL)
    )
);

-- #region Promoted placements
-- The paid-placement LEDGER. `ExploreItem.sponsored` drives a visible "AD" disclosure on cards and a
-- reserved slot frame, and the search RPC already declares an `is_sponsored boolean` in its return
-- shape and hardcodes `false` in all three branches because nothing records a placement. The
-- `promoted_placement` plan entitlement says a subscriber MAY promote; it cannot say what is
-- promoted, where, until when, or what was charged — which is precisely what a paid disclosure has
-- to be answerable from.
--
-- `catalogue.listings.promoted` is a denormalised console flag ("is this row currently boosted");
-- this table is the record that flag should be derived from. Keeping the flag is fine; deriving it
-- from nothing is not.
CREATE TABLE marketplace.promoted_placements (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    sponsor_user_id uuid NOT NULL,

    -- Polymorphic by design and deliberately without a foreign key: the promotable set spans five
    -- tables across three schemas (service blueprints, catalogue products, users, teams, projects),
    -- two of which are created in LATER category-0 files, so a real reference is not expressible
    -- here at all. The CHECK keeps the discriminator closed so an unknown target type cannot be
    -- stored, and the resolving service is responsible for the join.
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,

    -- Where the placement is bought, not what it looks like. A surface is a commercial inventory
    -- slot, so it is priced and sold separately even when it renders the same card.
    surface text NOT NULL DEFAULT 'explore_home'::text,

    starts_at timestamp with time zone NOT NULL DEFAULT now(),
    ends_at timestamp with time zone NOT NULL,
    -- A placement stopped early is not deleted, and WHEN it stopped is the fact that settles what was
    -- owed for it — a boolean would answer "is it running" while destroying the only answer to "what
    -- did the sponsor actually receive". A live placement is one with no cancellation and a window
    -- that contains now().
    cancelled_at timestamp with time zone,

    -- What the sponsor has been charged so far, integer minor units plus its ISO-4217 currency, the
    -- platform-wide money pairing. Accrues over the window rather than being set once, because a
    -- placement cancelled mid-flight is billed for what it ran.
    spend_cents bigint NOT NULL DEFAULT 0 CHECK (spend_cents >= 0),
    currency text NOT NULL DEFAULT 'GBP'::text CHECK (currency ~ '^[A-Z]{3}$'),

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),

    CONSTRAINT promoted_placements_pkey PRIMARY KEY (id),
    CONSTRAINT promoted_placements_sponsor_fkey FOREIGN KEY (sponsor_user_id) REFERENCES org.users_public(user_id) ON DELETE CASCADE,
    CONSTRAINT promoted_placements_entity_type_check CHECK (
        entity_type IN ('service', 'product', 'freelancer', 'team', 'project')
    ),
    CONSTRAINT promoted_placements_surface_check CHECK (
        surface IN ('explore_home', 'explore_results', 'view_rail')
    ),
    -- A zero-length or reversed window is a placement that was never sellable; refusing it here means
    -- no reader has to decide what a negative flight duration means.
    CONSTRAINT promoted_placements_window_check CHECK (ends_at > starts_at),
    CONSTRAINT promoted_placements_cancelled_within_window_check CHECK (
        cancelled_at IS NULL OR cancelled_at >= starts_at
    )
);
-- #endregion

-- #region Quote requests
-- The "Request a custom quote" conversion path: a buyer describes a scope against a published service
-- blueprint and names a SOFT budget. It is not a booking and not a basket line — nothing is reserved,
-- charged or escrowed — which is why it lives beside the blueprint it is about rather than in
-- `finance`. The client-side stub it replaces says so in its own docstring: the live path is an
-- insert into a quote ledger.
CREATE TABLE marketplace.quote_requests (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    blueprint_id uuid NOT NULL,

    -- The seller who must answer, captured at request time rather than resolved through the
    -- blueprint on every read: ownership of a blueprint can change, and a request that silently
    -- re-targets itself to whoever owns the listing today would misattribute a conversation the
    -- original seller had.
    host_user_id uuid NOT NULL,
    requester_user_id uuid NOT NULL,

    scope text NOT NULL,

    -- A SOFT budget the buyer volunteers, so it is nullable in a way a price never is — and the
    -- currency travels with it, because a bare number is not money. The paired CHECK makes an
    -- amount with no currency unrepresentable rather than merely discouraged.
    budget_cents bigint CHECK (budget_cents IS NULL OR budget_cents >= 0),
    currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),

    -- Free text on purpose ("before the end of Q3", "no rush"). A buyer's stated timing at first
    -- contact is a sentence, and pinning it to a date would invent a precision they did not give.
    timeline text,

    -- The seller's own questions as the buyer answered them on the request (services/intake.ts,
    -- Decision #522), keyed by question id like a basket line's `answers`. Validated against the
    -- listing's questions by QuoteBackendService; `{}` when the listing asks none.
    answers jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Who opened it: the buyer asking (`buyer`, marketplace.request_quote), or the seller issuing a
    -- quote from a conversation the buyer started (`host`, marketplace.issue_quote, Decision #522).
    -- A host-issued request is born answered: its scope is the first offer's.
    origin text NOT NULL DEFAULT 'buyer'::text,

    -- Nothing is hard-deleted: a withdrawn request is a status, not a missing row. `sent` waits on the
    -- host; `answered` once they price it (`marketplace.quote_offers`); `accepted` once the buyer takes
    -- an offer; `declined` by the host, `withdrawn` by the buyer (Decision #458). Every move is a door
    -- in 00001177 — there is no client write.
    status text NOT NULL DEFAULT 'sent'::text,
    answered_at timestamp with time zone,
    -- When it reached `accepted`, `declined` or `withdrawn`, and the host's reason for a decline.
    closed_at timestamp with time zone,
    decline_reason text,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),

    CONSTRAINT quote_requests_pkey PRIMARY KEY (id),
    CONSTRAINT quote_requests_blueprint_fkey FOREIGN KEY (blueprint_id) REFERENCES marketplace.service_blueprints(id) ON DELETE CASCADE,
    CONSTRAINT quote_requests_host_fkey FOREIGN KEY (host_user_id) REFERENCES org.users_public(user_id) ON DELETE CASCADE,
    CONSTRAINT quote_requests_requester_fkey FOREIGN KEY (requester_user_id) REFERENCES org.users_public(user_id) ON DELETE CASCADE,
    CONSTRAINT quote_requests_status_check CHECK (status IN ('sent', 'answered', 'accepted', 'declined', 'withdrawn')),
    CONSTRAINT quote_requests_budget_currency_check CHECK (budget_cents IS NULL OR currency IS NOT NULL),
    CONSTRAINT quote_requests_answers_check CHECK (jsonb_typeof(answers) = 'object'),
    CONSTRAINT quote_requests_origin_check CHECK (origin IN ('buyer', 'host')),
    -- An answered request must carry the instant it was answered, the same pairing
    -- `catalogue.articles` uses for `published_at`: a row that claims to be answered while being
    -- unable to say when is a response time nobody can measure. An accepted one was answered first.
    CONSTRAINT quote_requests_answered_at_check CHECK (
        status NOT IN ('answered', 'accepted') OR answered_at IS NOT NULL
    ),
    CONSTRAINT quote_requests_closed_at_check CHECK (
        (status IN ('accepted', 'declined', 'withdrawn')) = (closed_at IS NOT NULL)
    ),
    CONSTRAINT quote_requests_decline_reason_check CHECK (
        decline_reason IS NULL OR (status = 'declined' AND char_length(decline_reason) <= 280)
    )
);
-- #endregion

-- #region Quote offers
-- The host's priced answer to a quote request (Decision #458): a scope, its deliverables as a
-- checklist, one price, a turnaround and an expiry. Accepting one puts exactly one `one_off_service`
-- line in the buyer's basket; money moves only at checkout, where the offer — never the line's
-- snapshot — is the price (`marketplace.fn_quote_offer_terms`). The deliverables are a checklist
-- inside ONE escrow, never separately funded stages.
--
-- One row per offer sent, so a revision is a new row and the history stays: sending a new offer
-- withdraws the pending one and points it at its successor (`superseded_by`). `expired` is derived,
-- never stored — a pending offer past `expires_at` — as the FX quote's is (PRODUCT_MANAGEMENT §3.5).
CREATE TABLE marketplace.quote_offers (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    quote_request_id uuid NOT NULL,
    -- The request's host at the moment they priced it. An offer is never re-addressed.
    author_user_id uuid NOT NULL,

    scope text NOT NULL,
    -- The same checklist shape as `service_blueprints.deliverables`, and the same bounds the stage
    -- writer copies into a stage (`fn_write_blueprint_stages`: 12 items of 160 characters).
    deliverables text[] NOT NULL DEFAULT '{}'::text[],

    -- The listing's own currency, set by the door from the blueprint and never by the caller: the
    -- escrow is held and paid in the seller's currency (Decision #435).
    price_cents bigint NOT NULL,
    currency text NOT NULL,
    turnaround_days smallint NOT NULL,
    expires_at timestamp with time zone NOT NULL,

    -- The SHA-256 of the terms above in canonical form (marketplace.fn_quote_terms, Decision #522),
    -- stamped by the door that sends the offer. The terms never change once written
    -- (trg_quote_offers_terms_frozen): a revision is a new row with its own hash, and the hash the
    -- buyer accepted is the one `marketplace.quote_events` records beside what checkout charged.
    terms_hash text NOT NULL,

    status text NOT NULL DEFAULT 'pending'::text,
    superseded_by uuid,
    -- When it left `pending`.
    decided_at timestamp with time zone,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),

    CONSTRAINT quote_offers_pkey PRIMARY KEY (id),
    CONSTRAINT quote_offers_request_fkey FOREIGN KEY (quote_request_id) REFERENCES marketplace.quote_requests(id) ON DELETE CASCADE,
    CONSTRAINT quote_offers_author_fkey FOREIGN KEY (author_user_id) REFERENCES org.users_public(user_id) ON DELETE CASCADE,
    CONSTRAINT quote_offers_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES marketplace.quote_offers(id) ON DELETE SET NULL,
    CONSTRAINT quote_offers_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
    CONSTRAINT quote_offers_scope_check CHECK (char_length(scope) BETWEEN 1 AND 4000),
    CONSTRAINT quote_offers_deliverables_check CHECK (cardinality(deliverables) <= 12),
    CONSTRAINT quote_offers_price_check CHECK (price_cents > 0),
    CONSTRAINT quote_offers_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT quote_offers_terms_hash_check CHECK (terms_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT quote_offers_turnaround_check CHECK (turnaround_days BETWEEN 1 AND 90),
    -- The host picks 3 to 30 days (owner ruling, Decision #458).
    CONSTRAINT quote_offers_expiry_window_check CHECK (
        expires_at >= created_at + interval '3 days' AND expires_at <= created_at + interval '30 days'
    ),
    CONSTRAINT quote_offers_decided_at_check CHECK ((status = 'pending') = (decided_at IS NULL)),
    CONSTRAINT quote_offers_superseded_check CHECK (superseded_by IS NULL OR status = 'withdrawn')
);
-- #endregion

-- #region Quote events
-- The append-only history of every quote request (Decision #522): one row per move, with who made it,
-- the offer it concerned, and that offer's canonical terms and hash as they stood. `issued` is a
-- seller's quote from a conversation, `offer_sent` / `offer_revised` an answer to a request, and
-- `paid` the checkout that funded the engagement (its order line, project and escrow in `detail`).
-- Written only by the doors in 00001177 and by finance.place_wallet_order; never updated, and never
-- deleted except by the cascade of an erased account (trg_quote_events_append_only). Each move also
-- posts a quote card into the pair's conversation (comms.dm_messages.quote_event_id). Read by its two
-- parties (00002018): the record either can point to in a dispute.
CREATE TABLE marketplace.quote_events (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    quote_request_id uuid NOT NULL,
    quote_offer_id uuid,
    actor_user_id uuid NOT NULL,
    kind text NOT NULL,
    terms jsonb,
    terms_hash text,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),

    CONSTRAINT quote_events_pkey PRIMARY KEY (id),
    CONSTRAINT quote_events_request_fkey FOREIGN KEY (quote_request_id) REFERENCES marketplace.quote_requests(id) ON DELETE CASCADE,
    CONSTRAINT quote_events_offer_fkey FOREIGN KEY (quote_offer_id) REFERENCES marketplace.quote_offers(id) ON DELETE CASCADE,
    CONSTRAINT quote_events_actor_fkey FOREIGN KEY (actor_user_id) REFERENCES org.users_public(user_id) ON DELETE CASCADE,
    CONSTRAINT quote_events_kind_check CHECK (kind IN (
        'requested', 'issued', 'offer_sent', 'offer_revised', 'offer_withdrawn', 'request_declined',
        'offer_accepted', 'offer_declined', 'request_withdrawn', 'paid'
    )),
    CONSTRAINT quote_events_terms_pair_check CHECK ((terms IS NULL) = (terms_hash IS NULL)),
    CONSTRAINT quote_events_terms_hash_check CHECK (terms_hash IS NULL OR terms_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT quote_events_terms_offer_check CHECK (terms IS NULL OR quote_offer_id IS NOT NULL),
    CONSTRAINT quote_events_terms_shape_check CHECK (terms IS NULL OR jsonb_typeof(terms) = 'object'),
    CONSTRAINT quote_events_detail_check CHECK (jsonb_typeof(detail) = 'object')
);
-- #endregion
