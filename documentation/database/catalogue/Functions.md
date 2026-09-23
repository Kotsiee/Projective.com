# catalogue: Functions

## The seller console's write doors — [`00001170_functions_catalogue.sql`](../../../supabase/migrations/00001170_functions_catalogue.sql)

A listing is **two rows that must agree**: the `catalogue.listings` row the console edits, and the
subject it points at — a `catalogue.products` row or a `marketplace.service_blueprints` row. The
subject is what the rest of the platform reads: checkout re-prices a product from
`products.price_cents` (`finance.place_wallet_order`), and booking and discovery read a service's
delivery terms from its blueprint. Written as separate PostgREST requests, a save that failed
halfway would leave the card and the charge disagreeing about the price. So each operation is **one
function, and therefore one transaction**.

The three write doors are `SECURITY INVOKER` on purpose. The catalogue and marketplace policies
(`00002018`, `00002020`) already say who may write what, and running as the caller keeps them the
gate; a definer would have to restate them, and a restated rule can drift. Under RLS an UPDATE the
caller may not make does not raise, it matches nothing — so every subject UPDATE checks its row
count and raises rather than letting a save update the listing but not its product.

| Function                                                          | Security | Does                                                                                                                                                                                                                                                                                                                     |
| :---------------------------------------------------------------- | :------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_listing(p_kind, p_title, p_delivery_model?, p_team?)`     | INVOKER  | A new **draft** and its subject, unpriced and unpublished. Returns `{ listing_id, slug }`; the subject's `svc-`/`prd-` slug (minted by `security.fn_slug_guard`) is the listing's console AND public address. A service needs a delivery model and a `org.freelancer_profiles` row — a buyer account has nothing to deliver it from. `p_team` requires active membership. |
| `save_listing(p_listing, p_patch jsonb)`                          | INVOKER  | Applies an editor patch. Only keys **present** change (absent keeps, JSON `null` clears), so a partial autosave cannot wipe what it did not send. Mirrors title, description, category, price and terms onto the subject in the same transaction. The gallery (`media: [{ file_id?, url?, alt? }]`) and the tag, skill, collection and availability sets are replaced whole. |
| `set_listing_status(p_listing, p_status)`                         | INVOKER  | Moves a listing through `draft · published · paused · archived` (nothing is deleted). Publishing runs **the publish gate** — a title, a price, at least one image — here as well as on the page, so a hand-built request cannot publish what the console would refuse. A service's `is_published` follows the listing. |
| `get_listing_sales(p_listing_ids uuid[], p_since timestamptz?)`   | DEFINER  | Per listing, per currency, per week: completed (`confirmed` / `invoiced`) order lines and their gross. A definer because the order lines are the BUYERS' rows, which the seller's policies cannot read — and it answers only for listings the caller owns or whose owning team they actively belong to, so it discloses nothing about any other seller. `p_since` NULL is all time. |

Recognised `save_listing` keys: `title` · `category` · `description_html` · `description_text` ·
`delivery_label` · `amount_cents` · `ticket_price_cents` · `session_price_cents` ·
`seats_per_session` · `free_revisions` · `extra_revision_price_cents` · `delivery_model` (services) ·
`intake` (services) · `media` · `skills` (`org.skills` labels; an unknown label is dropped, not
invented) · `tags` · `availability` · `collections` (names). A gallery `file_id` must be an image the
caller can read under the `files` policies — another person's private file is not the seller's to
put on a public page.

**Refusal codes** (the thin route maps each to an HTTP status):

| SQLSTATE | Meaning                                                                                      | HTTP |
| :------- | :------------------------------------------------------------------------------------------- | :--- |
| `42501`  | Not signed in; not the seller who created the listing; not a freelancer (services); not a member of the team; the subject could not be updated with the listing; a gallery file that is not the caller's image. | 403  |
| `22023`  | A malformed request — a blank title, an unknown kind, status or delivery model, a gallery that is not an array of up to 24. | 422  |
| `PB404`  | No such listing (or one RLS hides from the caller).                                          | 404  |
| `PG422`  | The publish gate. `DETAIL` lists what is missing, separated by `\|` (`a price\|at least one image`), which the console names back to the seller. | 422  |

**Grants** ([`00002510_permissions_function_grants.sql`](../../../supabase/migrations/00002510_permissions_function_grants.sql)):
all four are `REVOKE`d from `public` and `anon` and `EXECUTE`-granted to `authenticated` and
`service_role` only.

**Known limit, by design of the policies:** a team-owned listing is VISIBLE to every active member of
the team but editable only by the member who created it (`owner_user_id = auth.uid()` in both
functions and in the UPDATE policy). Letting any member edit needs a team-permission rule, which is
a product decision.

## Maintained by triggers elsewhere

| Trigger                                                          | Function                                 | Does                                                                                  |
| :--------------------------------------------------------------- | :--------------------------------------- | :------------------------------------------------------------------------------------ |
| `trg_products_slug` / `trg_articles_slug` (`00001890`)           | `security.fn_slug_guard('prd' \| 'art')` | Mints the permanent public address on insert; refuses any change to it.              |
| `trg_products_derived` / `trg_listings_derived` (`00001895`)     | `security.fn_guard_derived_columns(...)` | Refuses client writes to ratings and console counters.                               |
| `trg_update_ratings` (`00001800`, on `reviews.entity_reviews`)   | `reviews.recalculate_entity_rating()`    | Recomputes `catalogue.products.rating_*` when a `product` review changes.            |

See [../security/Functions.md](../security/Functions.md) and
[../reviews/Functions.md](../reviews/Functions.md).
