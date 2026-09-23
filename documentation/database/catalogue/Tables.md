# catalogue: Tables

The seller's **publication layer**: one row per thing a seller has listed for sale, plus the
gallery, taxonomy, availability and collections the `/catalogue` console edits. Migration
[`00000023_tables_catalogue.sql`](../../../supabase/migrations/00000023_tables_catalogue.sql).

This is also what the discovery surfaces read LIVE — `/explore`, `/view/[id]` and the landing page
load the published catalogue through `packages/backend/services/explore/live-catalog.ts` with the
anon client, so every column below that a card or a view page prints is read straight from here.

## The seam with `marketplace`

A service already had a home: `marketplace.service_blueprints` owns how a service is delivered and
priced, and it is not duplicated here. A digital product and an article had none, so both are
created here. `catalogue.listings` POINTS AT its subject — `service_blueprint_id` for a service,
`product_id` for a product — rather than restating it, which keeps one answer to "what does this
cost".

Sellers are individuals and teams (businesses and organisations are buyer-side, Decisions
#9/#10/#61). Every table carries `owner_user_id` (the accountable human, FK → `org.users_public`)
and a nullable `owner_team_id` (FK → `org.teams`), never an untyped `owner_type` + `owner_id` pair
that could not carry a foreign key.

## `catalogue.products`

| Column                           | Type                     | Notes                                                                                             |
| :------------------------------- | :----------------------- | :------------------------------------------------------------------------------------------------ |
| `id`                             | uuid PK                  |                                                                                                   |
| `owner_user_id` / `owner_team_id` | uuid                    | See above.                                                                                        |
| `slug`                           | text UNIQUE NOT NULL     | **The public address** `/view/prd-…` — `prd-` + 10 symbols, minted by `security.fn_slug_guard('prd')`, permanent (`ck_products_slug_shape`). |
| `title`                          | text NOT NULL            |                                                                                                   |
| `description` / `description_text` | jsonb / text           | Rich body + its flattened text (search, card blurbs).                                             |
| `format`                         | `catalogue.product_format` | `download` · `template` · `preset` · `font` · `course` · `ebook` · `source_code` · `bundle`.    |
| `category`                       | text                     |                                                                                                   |
| `price_cents` / `currency`       | bigint / text            | Integer minor units + ISO-4217, never a formatted string.                                         |
| `licence`                        | text                     | `standard` · `extended` — the licence KEY. The permission ledger the view page prints is platform policy (`licenceTerms` in `@projective/types/explore`), not seller text; an unknown key resolves to the narrower terms. |
| `attribution_required`           | boolean                  |                                                                                                   |
| `file_manifest`                  | jsonb                    | `[{ name, label, extension, bytes }]` (`ProductManifestEntrySchema`).                            |
| `compatibility`                  | jsonb                    | `[{ label, supported }]` (`StoredProductCompatSchema`).                                           |
| `specs`                          | jsonb                    | The seller-declared specification ledger, `[{ label, value }]` (`StoredProductSpecSchema`). `ck_products_specs_shape`: an array of ≤ 24. Stored as written, never derived from the category. |
| `span`                           | smallint 1–3             | Masonry cell weight, seller-authored presentation.                                                |
| `rating_average` / `rating_count` | numeric / integer       | **Derived** — recomputed from `reviews.entity_reviews` by `reviews.recalculate_entity_rating`, and guarded against client writes (`trg_products_derived`, see [../security/Functions.md](../security/Functions.md)). |

A product has no status of its own: it is public exactly when a PUBLISHED listing offers it.

## `catalogue.articles`

| Column             | Type                        | Notes                                                                                         |
| :----------------- | :-------------------------- | :-------------------------------------------------------------------------------------------- |
| `slug`             | text UNIQUE NOT NULL        | `/view/art-…`, minted by `security.fn_slug_guard('art')`, permanent (`ck_articles_slug_shape`). |
| `title` / `topic` / `summary` | text             |                                                                                               |
| `body`             | jsonb                       | The ordered block list the article view renders (`StoredArticleBlockSchema`). An image block stores `{ bucket, path }` of a storage object — never an external URL. |
| `body_text`        | text                        | Flattened body for search.                                                                    |
| `cover_file_id`    | uuid → `files.items`        |                                                                                               |
| `read_minutes`     | integer > 0                 | Stored once at write time.                                                                    |
| `status` / `published_at` | `catalogue.listing_status` / timestamptz | `articles_published_at_check`: published ⇒ `published_at` set.                   |

## `catalogue.listings`

One row per listed service or product. `listings_subject_matches_kind` makes a service listing
carrying a product id (or neither) unrepresentable.

| Column                                         | Notes                                                                              |
| :--------------------------------------------- | :--------------------------------------------------------------------------------- |
| `kind`                                         | `catalogue.listing_kind`: `product` · `service`.                                   |
| `status` / `published_at`                      | `catalogue.listing_status`: `draft` · `published` · `paused` · `archived`. Published ⇒ `published_at` set. Nothing is hard-deleted; archiving is a status. |
| `service_blueprint_id` / `product_id`          | Exactly one, matching `kind`.                                                      |
| `title`, `description(_text)`, `category`, `delivery_label` |                                                                       |
| `amount_cents`, `ticket_price_cents`, `session_price_cents`, `seats_per_session`, `currency` | Pricing config. The optional three are NULL for "not priced", never 0. |
| `free_revisions`, `extra_revision_price_cents` | NULL = undeclared; 0 is a stated offer.                                            |
| `promoted`                                     | The seller's request to promote. A listing renders as sponsored only when an ACTIVE `marketplace.promoted_placements` row also exists for it — the flag alone buys nothing. |
| `view_count`, `order_count`, `rating_average`, `rating_count` | **Derived** console metrics, guarded against client writes (`trg_listings_derived`). |

## Child tables

| Table                            | Holds                                                                                                     |
| :------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `catalogue.listing_media`        | The ordered gallery; `position` 0 is the cover. `file_id` (→ `files.items`) or `url`; `uq_listing_media_position` is DEFERRABLE so a reorder can swap positions in one transaction. |
| `catalogue.listing_skills`       | Join to the controlled `org.skills` vocabulary — the terms discovery filters on.                           |
| `catalogue.listing_tags`         | Free-text keywords (1–40 chars), deliberately separate from skills.                                       |
| `catalogue.listing_availability` | A Session listing's shallow weekly window (weekdays, hours, timezone). The real slot machinery is `scheduling`. |
| `catalogue.collections` / `catalogue.collection_listings` | A seller's private groupings; slug unique per owner.                              |

## Seed

`supabase/seeds/05_catalogue.sql` (generated — see [../Seed.md](../Seed.md)) writes 8 products, 5
articles and 17 listings with their galleries, skills, tags and paid placements. Every image is a
`files.items` row whose object is uploaded into the `catalogue` bucket by `db reset`.
