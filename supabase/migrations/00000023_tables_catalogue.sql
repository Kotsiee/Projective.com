-- =============================================================================================
-- 00000023_tables_catalogue.sql — catalogue schema tables (Category 0).
--
-- The seller's PUBLICATION layer: one row per thing a seller has listed for sale, plus the gallery,
-- taxonomy, availability and collections the `/catalogue` console edits. It is the backing schema for
-- `@projective/types/catalogue`, whose Zod SSOT, deterministic fixtures and full two-page console all
-- shipped with no tables at all.
--
-- Verified absent before writing: `grep -rn "catalogue\." supabase/migrations/` returned only the
-- unrelated `analytics.event_catalogue`, a storage bucket named 'catalogue' and an OAuth scope
-- string. There was no `catalogue` schema.
--
-- ---------------------------------------------------------------------------------------------
-- THE SEAM WITH `marketplace` — WHAT LIVES WHERE, AND THE PART THAT NEEDS A HUMAN
-- ---------------------------------------------------------------------------------------------
-- A SERVICE already had a home: `marketplace.service_blueprints` owns how a service is delivered and
-- priced, and it is not duplicated here. A DIGITAL PRODUCT and an ARTICLE had none at all — grepping
-- `CREATE TABLE.*product` across every migration returns nothing, and the existing seed script says
-- so in its own header ("PRODUCTS ARE DELIBERATELY NOT SEEDED — the product entity is not fully
-- defined in the schema yet"). Both are created here.
--
-- So `catalogue.listings` POINTS AT its subject rather than restating it: `service_blueprint_id` for
-- a service, `product_id` for a product. That keeps one answer to "what does this cost" instead of a
-- marketplace row and a catalogue row that can disagree.
--
-- FLAGGED, NOT SILENTLY RESOLVED (root CLAUDE.md §8). Two placement judgements a human should confirm:
--
--   1. Products sit in `catalogue` rather than beside services in `marketplace`. The symmetry argument
--      for `marketplace.digital_products` is real. What settled it is that ONE table must own the
--      entity: `finance.basket_items.item_id` resolves a `digital_product` item kind polymorphically
--      and would otherwise have two candidate targets with nothing to say which is authoritative.
--      Either placement works; both at once does not.
--   2. An article is not sold, so `catalogue` is an imperfect fit. It is here because an article IS a
--      publishable item a profile owns, carrying the same draft/published lifecycle and appearing in
--      the same discovery corpus and profile-tab matrix as products. The alternative is a fifteenth
--      schema for one table, and `documentation/database/Schemas.md` is already out of step with the
--      real schema count (Decision #56(e)).
--
-- ---------------------------------------------------------------------------------------------
-- OWNERSHIP
-- ---------------------------------------------------------------------------------------------
-- Sellers are individuals and teams. Businesses and organisations are buyer-side entities
-- (Decisions #9/#10/#61), so they cannot own a listing, and the shape enforces that structurally:
-- `owner_user_id` is always the accountable human and `owner_team_id` is set only when the listing
-- belongs to a team.
--
-- This is deliberately NOT the `owner_type text` + `owner_id uuid` pattern `finance.wallets` uses.
-- That pattern cannot carry a foreign key, so a dangling owner is representable. Two real FKs cost
-- one nullable column and make it unrepresentable.
-- =============================================================================================

-- #region Products
-- The digital product entity. Referenced by the discovery corpus (`ProductItemSchema`), the
-- `/view/[id]` product template (`ProductViewSchema` — format, file manifest, spec ledger,
-- compatibility matrix, licence permissions) and the seller console.
CREATE TABLE catalogue.products (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL,
    owner_team_id uuid,

    title text NOT NULL,
    -- Rich body plus the flattened text used for search and card blurbs, mirroring the
    -- description/description_text pairing every other publishable table in this database uses.
    description jsonb NOT NULL DEFAULT '{}'::jsonb,
    description_text text NOT NULL DEFAULT ''::text,

    format catalogue.product_format NOT NULL DEFAULT 'download'::catalogue.product_format,
    category text NOT NULL DEFAULT ''::text,

    -- Money as integer minor units plus its ISO-4217 currency, the platform-wide pairing. Never a
    -- float, and never the pre-formatted string the discovery fixtures carry: parsing a localised
    -- currency string back into a number is how "$1,800" becomes 1.8.
    price_cents bigint NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    currency text NOT NULL DEFAULT 'USD'::text CHECK (currency ~ '^[A-Z]{3}$'),

    -- Licence terms the /view product template renders as its permission ledger.
    licence text NOT NULL DEFAULT 'standard'::text,
    attribution_required boolean NOT NULL DEFAULT false,
    -- Deliverable manifest: [{ name, mime, size_bytes }]. jsonb rather than a child table because it is
    -- authored by the seller as one document, read back whole, and never queried by member.
    file_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
    compatibility jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Masonry cell weight (1 short .. 3 tall), carried from ProductItemSchema.span. Presentation, but
    -- SELLER-AUTHORED presentation, so it belongs on the row rather than being re-derived per render
    -- where two surfaces could disagree about how tall the same card is.
    span smallint NOT NULL DEFAULT 1 CHECK (span BETWEEN 1 AND 3),

    rating_average numeric(3,2) NOT NULL DEFAULT 0.0 CHECK (rating_average >= 0 AND rating_average <= 5),
    rating_count integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT products_pkey PRIMARY KEY (id),
    CONSTRAINT products_owner_user_fkey FOREIGN KEY (owner_user_id) REFERENCES org.users_public(user_id) ON DELETE CASCADE,
    CONSTRAINT products_owner_team_fkey FOREIGN KEY (owner_team_id) REFERENCES org.teams(id) ON DELETE SET NULL
);
-- #endregion

-- #region Articles
-- Editorial content owned by a profile. Backs the discovery corpus `ArticleItemSchema` and the
-- `/view/[id]` article template (rich block body, derived table of contents, media assets, comments).
CREATE TABLE catalogue.articles (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL,
    owner_team_id uuid,

    slug text NOT NULL UNIQUE,
    title text NOT NULL,
    topic text NOT NULL DEFAULT ''::text,
    summary text NOT NULL DEFAULT ''::text,
    -- The ordered ArticleBlock[] the article view renders (headings, prose, lists, quotes, embeds).
    body jsonb NOT NULL DEFAULT '[]'::jsonb,
    body_text text NOT NULL DEFAULT ''::text,
    cover_file_id uuid,

    -- Stored rather than derived at read time: it is printed on every card in a feed, and recomputing
    -- it per row per request to render one label is work the write path can do once.
    read_minutes integer NOT NULL DEFAULT 1 CHECK (read_minutes > 0),

    status catalogue.listing_status NOT NULL DEFAULT 'draft'::catalogue.listing_status,
    published_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT articles_pkey PRIMARY KEY (id),
    CONSTRAINT articles_owner_user_fkey FOREIGN KEY (owner_user_id) REFERENCES org.users_public(user_id) ON DELETE CASCADE,
    CONSTRAINT articles_owner_team_fkey FOREIGN KEY (owner_team_id) REFERENCES org.teams(id) ON DELETE SET NULL,
    CONSTRAINT articles_cover_fkey FOREIGN KEY (cover_file_id) REFERENCES files.items(id) ON DELETE SET NULL,
    -- A published article must carry its publication instant, so a row cannot claim to be live while
    -- being unable to say since when.
    CONSTRAINT articles_published_at_check CHECK (
        status <> 'published'::catalogue.listing_status OR published_at IS NOT NULL
    )
);
-- #endregion

-- #region Listings
CREATE TABLE catalogue.listings (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL,
    owner_team_id uuid,

    kind catalogue.listing_kind NOT NULL,
    status catalogue.listing_status NOT NULL DEFAULT 'draft'::catalogue.listing_status,

    -- Exactly one subject, matching `kind`. The CHECK below makes the mismatched combinations
    -- unrepresentable rather than merely discouraged — a service listing carrying a product id is not
    -- a state any code should have to defend against.
    service_blueprint_id uuid,
    product_id uuid,

    title text NOT NULL,
    description jsonb NOT NULL DEFAULT '{}'::jsonb,
    description_text text NOT NULL DEFAULT ''::text,
    category text NOT NULL DEFAULT ''::text,
    -- Turnaround / delivery label ("5-day delivery", "60-minute session").
    delivery_label text NOT NULL DEFAULT ''::text,

    -- Pricing config, mirroring @projective/types/catalogue ListingPricingSchema field for field.
    -- `amount_cents` is the fixed engagement fee; `ticket_price_cents` the per-ticket standard for a
    -- Pipeline (the card renders a 0.5x-2.0x range around it); `session_price_cents` the per-slot fee.
    --
    -- The three optional ones are nullable rather than NOT NULL DEFAULT 0 because "not priced" and
    -- "priced at zero" are different claims, and a default of 0 would erase that difference on every
    -- draft — turning a seller who has not finished pricing into one offering free work.
    amount_cents bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    ticket_price_cents bigint CHECK (ticket_price_cents IS NULL OR ticket_price_cents >= 0),
    session_price_cents bigint CHECK (session_price_cents IS NULL OR session_price_cents >= 0),
    seats_per_session integer CHECK (seats_per_session IS NULL OR (seats_per_session BETWEEN 1 AND 500)),
    currency text NOT NULL DEFAULT 'USD'::text CHECK (currency ~ '^[A-Z]{3}$'),

    -- Revision policy. NULL free_revisions means the seller declared nothing and the corpus default
    -- applies; 0 is the distinct claim that no rounds are included.
    free_revisions integer CHECK (free_revisions IS NULL OR (free_revisions BETWEEN 0 AND 99)),
    extra_revision_price_cents bigint CHECK (extra_revision_price_cents IS NULL OR extra_revision_price_cents >= 0),

    promoted boolean NOT NULL DEFAULT false,

    -- Denormalised console metrics. Read on every row of the console grid and never joined against,
    -- so they live on the row rather than in a metrics table nothing else would use.
    view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
    order_count integer NOT NULL DEFAULT 0 CHECK (order_count >= 0),
    rating_average numeric(3,2) NOT NULL DEFAULT 0.0 CHECK (rating_average >= 0 AND rating_average <= 5),
    rating_count integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),

    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT listings_pkey PRIMARY KEY (id),
    CONSTRAINT listings_owner_user_fkey FOREIGN KEY (owner_user_id) REFERENCES org.users_public(user_id) ON DELETE CASCADE,
    CONSTRAINT listings_owner_team_fkey FOREIGN KEY (owner_team_id) REFERENCES org.teams(id) ON DELETE SET NULL,
    CONSTRAINT listings_blueprint_fkey FOREIGN KEY (service_blueprint_id) REFERENCES marketplace.service_blueprints(id) ON DELETE CASCADE,
    CONSTRAINT listings_product_fkey FOREIGN KEY (product_id) REFERENCES catalogue.products(id) ON DELETE CASCADE,
    CONSTRAINT listings_subject_matches_kind CHECK (
        (kind = 'service'::catalogue.listing_kind AND service_blueprint_id IS NOT NULL AND product_id IS NULL)
        OR (kind = 'product'::catalogue.listing_kind AND product_id IS NOT NULL AND service_blueprint_id IS NULL)
    ),
    -- A published listing must carry its publication instant. Pairing a status with its timestamp in a
    -- CHECK is the guard `projects.projects` already uses for `archived_at`, and it stops a row that
    -- claims to be live while being unable to say since when.
    CONSTRAINT listings_published_at_check CHECK (
        status <> 'published'::catalogue.listing_status OR published_at IS NOT NULL
    )
);
-- #endregion

-- #region Listing media, taxonomy and availability
-- The ordered gallery. `position` 0 is the cover, which is why ordering is stored rather than left to
-- insertion order: the seller reorders the gallery in the editor and the first image becomes the card
-- thumbnail everywhere, so "which one is the cover" is data, not an artefact of write sequence.
CREATE TABLE catalogue.listing_media (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    listing_id uuid NOT NULL,
    -- Either a managed asset or an external URL. Both are real: the editor's Asset Picker attaches a
    -- files.items row, while a seeded or imported listing may only have a URL.
    file_id uuid,
    url text,
    alt_text text NOT NULL DEFAULT ''::text,
    position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT listing_media_pkey PRIMARY KEY (id),
    CONSTRAINT listing_media_listing_fkey FOREIGN KEY (listing_id) REFERENCES catalogue.listings(id) ON DELETE CASCADE,
    CONSTRAINT listing_media_file_fkey FOREIGN KEY (file_id) REFERENCES files.items(id) ON DELETE CASCADE,
    CONSTRAINT listing_media_has_source CHECK (file_id IS NOT NULL OR url IS NOT NULL),
    -- DEFERRABLE because reordering a gallery swaps positions within one transaction, and a
    -- non-deferrable unique index would reject the intermediate state of every swap.
    CONSTRAINT uq_listing_media_position UNIQUE (listing_id, position) DEFERRABLE INITIALLY DEFERRED
);

-- Skills as a join to the controlled `org.skills` vocabulary, so a listing's skills are the same
-- entities discovery filters and matches on.
CREATE TABLE catalogue.listing_skills (
    listing_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    CONSTRAINT listing_skills_pkey PRIMARY KEY (listing_id, skill_id),
    CONSTRAINT listing_skills_listing_fkey FOREIGN KEY (listing_id) REFERENCES catalogue.listings(id) ON DELETE CASCADE,
    CONSTRAINT listing_skills_skill_fkey FOREIGN KEY (skill_id) REFERENCES org.skills(id) ON DELETE CASCADE
);

-- Free-text keywords. Deliberately NOT folded into listing_skills: a skill is a controlled term the
-- marketplace matches supply to demand on, a tag is whatever the seller typed. One table for both
-- would let an arbitrary string enter the matching vocabulary.
CREATE TABLE catalogue.listing_tags (
    listing_id uuid NOT NULL,
    tag text NOT NULL CHECK (char_length(tag) BETWEEN 1 AND 40),
    CONSTRAINT listing_tags_pkey PRIMARY KEY (listing_id, tag),
    CONSTRAINT listing_tags_listing_fkey FOREIGN KEY (listing_id) REFERENCES catalogue.listings(id) ON DELETE CASCADE
);

-- The lightweight weekly window a Session / Group Session listing offers. Deliberately shallow — the
-- full recurring-slot machinery is the `scheduling` schema's concern (Decision #37) and this must not
-- become a second copy of it that can disagree with the calendar the buyer actually books against.
CREATE TABLE catalogue.listing_availability (
    listing_id uuid NOT NULL,
    timezone text NOT NULL DEFAULT 'UTC'::text,
    -- 0 = Sunday .. 6 = Saturday.
    weekdays smallint[] NOT NULL DEFAULT '{}'::smallint[],
    start_hour smallint NOT NULL DEFAULT 9 CHECK (start_hour BETWEEN 0 AND 23),
    end_hour smallint NOT NULL DEFAULT 17 CHECK (end_hour BETWEEN 0 AND 23),
    note text NOT NULL DEFAULT ''::text,

    CONSTRAINT listing_availability_pkey PRIMARY KEY (listing_id),
    CONSTRAINT listing_availability_listing_fkey FOREIGN KEY (listing_id) REFERENCES catalogue.listings(id) ON DELETE CASCADE,
    -- Mirrors the scheduling schema's deliberate simplification (Decision #56(f)): a window may not
    -- cross local midnight, so 23:00-01:00 is expressed as two rows rather than one wrapping one.
    CONSTRAINT listing_availability_window CHECK (end_hour > start_hour)
);
-- #endregion

-- #region Collections
CREATE TABLE catalogue.collections (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL,
    owner_team_id uuid,
    name text NOT NULL,
    slug text NOT NULL,
    description_text text NOT NULL DEFAULT ''::text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT collections_pkey PRIMARY KEY (id),
    CONSTRAINT collections_owner_user_fkey FOREIGN KEY (owner_user_id) REFERENCES org.users_public(user_id) ON DELETE CASCADE,
    CONSTRAINT collections_owner_team_fkey FOREIGN KEY (owner_team_id) REFERENCES org.teams(id) ON DELETE SET NULL,
    -- Slugs are unique per seller, not globally: two sellers may both have a "Starter kits".
    CONSTRAINT uq_collection_owner_slug UNIQUE (owner_user_id, slug)
);

CREATE TABLE catalogue.collection_listings (
    collection_id uuid NOT NULL,
    listing_id uuid NOT NULL,
    position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    CONSTRAINT collection_listings_pkey PRIMARY KEY (collection_id, listing_id),
    CONSTRAINT collection_listings_collection_fkey FOREIGN KEY (collection_id) REFERENCES catalogue.collections(id) ON DELETE CASCADE,
    CONSTRAINT collection_listings_listing_fkey FOREIGN KEY (listing_id) REFERENCES catalogue.listings(id) ON DELETE CASCADE
);
-- #endregion
