# catalogue: Functions

The `catalogue` schema defines no functions of its own. Its rows are maintained by functions and
triggers that live with the concern they implement:

| Trigger                                   | Function                              | Does                                                                                  |
| :---------------------------------------- | :------------------------------------ | :------------------------------------------------------------------------------------ |
| `trg_products_slug` / `trg_articles_slug` (`00001890`) | `security.fn_slug_guard('prd' \| 'art')` | Mints the permanent public address on insert; refuses any change to it.          |
| `trg_products_derived` / `trg_listings_derived` (`00001895`) | `security.fn_guard_derived_columns(...)` | Refuses client writes to ratings and console counters.                     |
| `trg_update_ratings` (`00001800`, on `reviews.entity_reviews`) | `reviews.recalculate_entity_rating()` | Recomputes `catalogue.products.rating_*` when a `product` review changes. |

See [../security/Functions.md](../security/Functions.md) and
[../reviews/Functions.md](../reviews/Functions.md).
