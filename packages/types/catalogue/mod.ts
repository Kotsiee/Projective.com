/**
 * `catalogue` schema shapes — the seller-side product & service management surface (`/catalogue` +
 * `/catalogue/[id]`). The listing LIST + editable detail read projections, the light analytics
 * (`ListingMetrics`/`CatalogueStats`), and the create/update/publish mutation payloads, plus the shared
 * pure helpers (`resolveListingPricing`, `publishReadiness`, `money`). Pricing reuses the discovery /
 * Entity View shapes (`ServiceType`, `EntityPricing`) — never forked.
 */
export * from "./catalogue.ts";
