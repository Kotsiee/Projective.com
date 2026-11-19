# catalogue: Tables

The seller's **publication layer**: one row per thing a seller has listed for sale, plus the
showcase, taxonomy and collections the `/catalogue` console edits. A session's availability is not
here: it is a scheduling preset bound on the service blueprint
(`service_blueprints.availability_preset_id`, Decision #217(c)). Migration
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

Sellers are individuals and teams (businesses and enterprises are buyer-side, Decisions
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
| `licence`                        | `catalogue.product_licence` NOT NULL DEFAULT `personal` | `personal` · `commercial` · `extended` (Decision #217(i); the retired free-text `standard` became `personal`). The permission ledger the view page prints is platform policy (`licenceTerms` in `@projective/types/explore`), not seller text. |
| `attribution_required`           | boolean                  |                                                                                                   |
| `file_manifest`                  | jsonb                    | `[{ name, label, extension, bytes, fileId? }]` (`ProductManifestEntrySchema`; the workspace's `AttachmentRefSchema` adds `fileId`). `save_listing` refuses more than 24 entries and a `fileId` that is not the seller's file. The seller's **draft**: publishing freezes the entries that name a library file into `catalogue.product_versions` (below, Decision #488), and a buyer receives the frozen version, never this column. |
| `compatibility`                  | jsonb                    | `[{ label, supported }]` (`StoredProductCompatSchema`).                                           |
| `specs`                          | jsonb                    | The seller-declared specification ledger, `[{ label, value }]` (`StoredProductSpecSchema`). `ck_products_specs_shape`: an array of ≤ 24. Stored as written, never derived from the category. |
| `span`                           | smallint 1–3             | Masonry cell weight, seller-authored presentation.                                                |
| `rating_average` / `rating_count` | numeric / integer       | **Derived** — recomputed from `reviews.entity_reviews` by `reviews.recalculate_entity_rating`, and guarded against client writes (`trg_products_derived`, see [../security/Functions.md](../security/Functions.md)). |

A product has no status of its own: it is public exactly when a PUBLISHED listing offers it.

**No contact or payment details in public copy (Decision #147).** `catalogue.products.title` /
`description` / `specs` and `catalogue.listings.title` / `description` are permanently outside the
Projective Unlock (`PRODUCT_SPEC.md` §Messaging 1.B): no email, phone, messaging or off-platform
payment link, `$cashtag`, or bank/card detail. Checked at create/update time by the catalogue write
service and refused field-named, never masked; no CHECK or trigger enforces it. **Not yet
enforced.** Article bodies (`catalogue.articles.body`) are not yet covered — Decision #147 flag (a).

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

**Row schema:** `CatalogueListingRowSchema` (`@projective/types/catalogue`, `rows.ts`), every column
keyed by its own name, with each column's CHECK and `kind` / `status` / `create_category` from their
Zod enums. The seller console selects exactly its keys and parses each row once, at
`parseListingRow` (`packages/backend/services/catalogue/live-catalogue.ts`). Discovery reads
`DiscoveryListingRowSchema` and the console's Analytics and Clients scope reads
`ScopedListingRowSchema`, both picks of it, each selecting its own keys and parsing at its own read
(`listing-rows.ts`): discovery drops a row its schema refuses, with a warning, so one seller's row
never takes the storefront down; the console throws. `catalogue-tables.contract.test.ts` fails on a
column without a key (or a key without a column), on a reader selecting a column the table lacks, on
an enum out of step with its Postgres type, and on a derived column missing from
`LISTING_DERIVED_COLUMNS`. The two cross-column CHECKs stay the database's (MARKETPLACE SC1, PRD-I3,
#501).

| Column                                         | Notes                                                                              |
| :--------------------------------------------- | :--------------------------------------------------------------------------------- |
| `kind`                                         | `catalogue.listing_kind`: `product` · `service`.                                   |
| `status` / `published_at`                      | `catalogue.listing_status`: `draft` · `published` · `paused` · `archived`. Published ⇒ `published_at` set. Archiving is a status; the only hard delete is `catalogue.delete_listing`, for a listing no buyer has engaged with (Decision #221). |
| `service_blueprint_id` / `product_id`          | Exactly one, matching `kind`.                                                      |
| `title`, `description(_text)`, `category`, `delivery_label` |                                                                       |
| `seo_title` varchar(70), `seo_description` varchar(160) | Search-result overrides (Decision #217). NULL falls back to the title and description. |
| `create_category`                              | `org.create_category`, NULL until chosen: the CREATE category the listing counts towards in the seller's Standing. |
| `amount_cents`, `ticket_price_cents`, `session_price_cents`, `seats_per_session`, `currency` | Pricing config. The optional three are NULL for "not priced", never 0. |
| `free_revisions`, `extra_revision_price_cents` | NULL = undeclared; 0 is a stated offer.                                            |
| `promoted`                                     | A console hint, set by `marketplace.promote_listing` and cleared by `stop_listing_promotion` (Decision #454). The flag alone buys nothing and no reader trusts it: the console's "Promoted" state and the Explore slot both answer from a LIVE `marketplace.promoted_placements` row, and an organic card is never marked. |
| `view_count`, `order_count`, `rating_average`, `rating_count` | **Derived** console metrics, guarded against client writes (`trg_listings_derived`; `LISTING_DERIVED_COLUMNS` names the same four). `view_count` / `order_count` are written by `analytics.fn_rollup_listings` alone: the listing's `listing.views` / `listing.orders` summed over every rolled-up day, rewritten nightly for each listing the day touched (MARKETPLACE SC5, MK-43); the seed's corpus values are zeroed and re-derived by `13_analytics.sql`. The ratings are seed-only. The console counts orders from `get_listing_sales` and reads ratings from the blueprint or product. |

## Child tables

| Table                            | Holds                                                                                                     |
| :------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `catalogue.listing_media`        | The **six-slot showcase** (Decision #217(e)). `position` smallint 1–6; `file_id` NOT NULL (→ `files.items`, CASCADE) — there is no URL column, every slot is a managed file; `kind` `image` · `video`; `rendition_file_id` (the 16:10 showcase cut, SET NULL) and `poster_file_id` (a video's still, SET NULL); `alt_text` ≤ 200. `ck_listing_media_cover_is_image`: slot 1 is always an image, and `apply_listing_media` mirrors it onto `service_blueprints.cover_file_id`. `uq_listing_media_position` is DEFERRABLE so a reorder can swap positions in one transaction. |
| `catalogue.listing_skills`       | Join to the controlled `org.skills` vocabulary — the terms discovery filters on.                           |
| `catalogue.listing_tags`         | Free-text keywords (1–40 chars), deliberately separate from skills. **At most 10 per listing**: `trg_listing_tags_max` refuses the 11th with `PG422` `tags_max`. A change re-syncs the listing's search index row (`trg_listing_tags_touch`), where tags are weight B of the fts. |
| `catalogue.collections` / `catalogue.collection_listings` | A seller's private groupings; slug unique per owner.                              |

## Product versions and entitlements (Decision #488)

What a buyer receives is never the seller's working copy (ASSET_DELIVERY_ARCHITECTURE.md §10, ruling
A6). Publishing freezes the draft `file_manifest` into a numbered version; paying writes one
entitlement per product line. Zod: `ProductVersionRowSchema` / `ProductEntitlementRowSchema`
(`@projective/types/catalogue`, held to these tables by `entitlements.contract.test.ts`).

### `catalogue.product_versions`

| Column         | Type                     | Notes                                                                                                                                                                                                                                                      |
| :------------- | :----------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | uuid PK                  |                                                                                                                                                                                                                                                            |
| `product_id`   | uuid NOT NULL            | → `catalogue.products`, CASCADE.                                                                                                                                                                                                                          |
| `version`      | integer NOT NULL > 0     | 1, 2, … per product (`product_versions_number_key`).                                                                                                                                                                                                       |
| `manifest`     | jsonb NOT NULL           | `[{ fileId, name, label, extension, bytes, mime }]`, 1–24 entries (`ck_product_versions_manifest`), in the seller's order, one per library file. `bytes` and `mime` are the library file's own. **No storage address**: a file lives at `originals/{product_id}/{id}/{fileId}`, derived. |
| `published_at` | timestamptz              | When this version was frozen.                                                                                                                                                                                                                              |
| `ready_at`     | timestamptz NULL         | NULL until every file has been copied into `originals` (`catalogue.mark_product_version_ready`); until then the download route answers 503 + Retry-After.                                                                                                |
| `created_at`   | timestamptz              |                                                                                                                                                                                                                                                            |

### `catalogue.entitlements`

| Column                       | Type                                 | Notes                                                                                                                                                                       |
| :--------------------------- | :----------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                         | uuid PK                              |                                                                                                                                                                             |
| `slug`                       | text UNIQUE NOT NULL                 | `ent-` + 10 symbols, minted by `security.fn_slug_guard('ent')` (`trg_entitlements_slug`), permanent (`ck_entitlements_slug_shape`). The download address `/api/downloads/ent-…/{fileId}`. |
| `order_line_id`              | uuid UNIQUE NOT NULL                 | → `finance.order_lines` (no cascade: a receipt is never deleted).                                                                                                           |
| `product_id`                 | uuid NULL                            | → `catalogue.products`, SET NULL (a receipt outlives its product, ruling A11).                                                                                              |
| `version_id`                 | uuid NULL                            | → `catalogue.product_versions`, SET NULL. The newest version frozen when the line was bought; NULL when the product attached no library file.                               |
| `holder_type` / `holder_id`  | `files.owner_kind` / uuid            | The order's owner: the person (a freelancer's wallet is their person's), or the team, business or enterprise.                                                               |
| `licence`                    | `catalogue.product_licence`          | The product's licence when bought.                                                                                                                                          |
| `seats`                      | integer 1–999                        | The line's quantity.                                                                                                                                                        |
| `updates_until`              | timestamptz NULL                     | Reserved for the later-versions rule. Phase 0 always writes NULL and never reads it; an entitlement serves exactly `version_id`.                                             |
| `status`                     | `catalogue.entitlement_status`       | `active` · `refunded` · `revoked`. MONEY's refund doors write `refunded`; the download route answers anything but `active` with its one 404.                                |
| `delivery_terms_accepted_at` | timestamptz NULL                     | When the buyer ticked the A8 acknowledgement before Pay (`finance.basket_items.metadata.deliveryTermsAccepted`); NULL when the line had no file or was paid without it.        |
| `first_delivered_at`         | timestamptz NULL                     | **The A8 fact**: the first response that streamed a whole file of the line to its last byte (`catalogue.fn_record_delivery`). Each delivery is also a `files.download_events` row (`via = 'purchase'`). |
| `created_at` / `updated_at`  | timestamptz                          |                                                                                                                                                                             |

Indexes (`00004012`): `ix_entitlements_holder (holder_type, holder_id, created_at DESC)` for the
purchases view, plus `version_id` and `product_id` partial indexes. **`finance.order_lines.asset_id`
is reserved**: no door writes it and no reader reads it; a product line's files are reached through
its entitlement ([../finance/Tables.md](../finance/Tables.md)).

## Seed

`supabase/seeds/05_catalogue.sql` (generated — see [../Seed.md](../Seed.md)) writes 8 products, 5
articles and 17 listings with their showcases (at most 5 file-backed image slots each, positions from
1), skills, tags and paid placements. Seeded product licences are `personal` or `extended`. Every image is a
`files.items` row whose object is uploaded into the `catalogue` bucket by `db reset`.
