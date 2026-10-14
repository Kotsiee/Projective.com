/**
 * `catalogue` schema shapes — the seller-side product & service management surface (`/catalogue` +
 * `/catalogue/[id]`). The listing LIST + editable detail read projections, the light analytics
 * (`ListingMetrics`/`CatalogueStats`), and the create/update/publish mutation payloads, plus the shared
 * pure helpers (`resolveListingPricing`, `publishReadiness`, `money`). Pricing reuses the discovery /
 * Entity View shapes (`ServiceType`, `EntityPricing`) — never forked.
 *
 * The rebuild's contracts (Decision #217): the console + workspace URL contract (`url.ts`), the form
 * archetype matrix (`archetype.ts`), the six-slot media showcase (`media.ts`), the per-archetype offer
 * (`offer.ts`), SEO (`seo.ts`), analytics (`analytics.ts`), the client pipeline (`clients.ts`) and
 * batch actions (`batch.ts`).
 */
export * from "./catalogue.ts";
export * from "./archetype.ts";
export * from "./url.ts";
export * from "./media.ts";
export * from "./offer.ts";
export * from "./seo.ts";
export * from "./analytics.ts";
export * from "./clients.ts";
export * from "./batch.ts";
