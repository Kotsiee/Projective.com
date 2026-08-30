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
    -- renders a 0.5x-2.0x workload-intensity range around the ticket price, and a booked sitting or
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
    session_template_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_published boolean NOT NULL DEFAULT false,
    rating_average numeric(3,2) DEFAULT 0.0,
    rating_count integer DEFAULT 0,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),

    CONSTRAINT service_blueprints_pkey PRIMARY KEY (id),
    CONSTRAINT service_blueprints_freelancer_fkey FOREIGN KEY (freelancer_profile_id) REFERENCES org.freelancer_profiles(user_id),
    CONSTRAINT service_blueprints_owner_team_fkey FOREIGN KEY (owner_team_id) REFERENCES org.teams(id) ON DELETE CASCADE,
    CONSTRAINT service_blueprints_cover_fkey FOREIGN KEY (cover_file_id) REFERENCES files.items(id) ON DELETE SET NULL,
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

    -- Nothing is hard-deleted: a withdrawn request is a status, not a missing row.
    status text NOT NULL DEFAULT 'sent'::text,
    answered_at timestamp with time zone,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),

    CONSTRAINT quote_requests_pkey PRIMARY KEY (id),
    CONSTRAINT quote_requests_blueprint_fkey FOREIGN KEY (blueprint_id) REFERENCES marketplace.service_blueprints(id) ON DELETE CASCADE,
    CONSTRAINT quote_requests_host_fkey FOREIGN KEY (host_user_id) REFERENCES org.users_public(user_id) ON DELETE CASCADE,
    CONSTRAINT quote_requests_requester_fkey FOREIGN KEY (requester_user_id) REFERENCES org.users_public(user_id) ON DELETE CASCADE,
    CONSTRAINT quote_requests_status_check CHECK (status IN ('sent', 'answered', 'withdrawn')),
    CONSTRAINT quote_requests_budget_currency_check CHECK (budget_cents IS NULL OR currency IS NOT NULL),
    -- An answered request must carry the instant it was answered, the same pairing
    -- `catalogue.articles` uses for `published_at`: a row that claims to be answered while being
    -- unable to say when is a response time nobody can measure.
    CONSTRAINT quote_requests_answered_at_check CHECK (
        (status = 'answered'::text AND answered_at IS NOT NULL)
        OR (status <> 'answered'::text)
    )
);
-- #endregion
