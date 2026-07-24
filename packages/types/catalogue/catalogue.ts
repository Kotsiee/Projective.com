import { z } from "zod";
import { ExploreOwnerSchema, ServiceType, SkillRefSchema } from "../explore/items.ts";
import { EntityPricingSchema } from "../explore/view.ts";

// Re-export the reused delivery-model enum so `@projective/types/catalogue` is self-sufficient for the
// service delivery model (the catalogue reuses `ServiceType` verbatim — never forked).
export { ServiceType } from "../explore/items.ts";

/**
 * catalogue — the Zod SSOT for the seller-side product & service management surface (`/catalogue` and
 * the per-item manage page `/catalogue/[id]`).
 *
 * This is the platform's FIRST write-oriented thin/fat surface: the read projections a seller browses
 * (the listing LIST + a single listing's editable detail + light analytics) plus the mutation payloads
 * that create / update / publish a listing. Like the other domains it is a READ+WRITE projection over
 * fixtures today — the fat {@link CatalogueBackendService} DERIVES the seller's catalogue from the
 * discovery corpus (re-owned to the acting seller) while `CATALOGUE_BACKEND_LIVE` is off, and stub
 * mutations echo an optimistic entity into an in-module session store; the RLS-scoped `catalogue.*`
 * tables + mutation policies are the deferred live path, slotting in behind the same gate with zero
 * shape churn.
 *
 * Pricing is NOT forked: the service delivery model reuses {@link ServiceType}, the display projection
 * reuses {@link EntityPricingSchema} (from the Entity View domain), and the numeric per-unit prices are
 * the same `ticketPrice`/`sessionPrice` fields the discovery `ServiceItem` carries. Only
 * enum/array/object/number/string/boolean primitives are used so the schema stays stable across Zod
 * majors (matching the sibling domains).
 */

// #region Kind + lifecycle
/** Whether a listing is a digital/physical **product** or a **service** offering. */
export const CatalogueKind = z.enum(["product", "service"]);
export type CatalogueKind = z.infer<typeof CatalogueKind>;

/**
 * A listing's lifecycle state. Nothing is ever hard-deleted (root CLAUDE.md §5) — a retired listing is
 * `archived`, never removed. `draft` is the pre-publish working state a create yields; `published` is
 * live on the marketplace; `paused` is temporarily delisted (recoverable); `archived` is retired.
 * These are presentation/visibility states of ONE listing entity, not a new lifecycle state-machine
 * (they do not gate escrow/stage transitions), so no `PRODUCT_MANAGEMENT.md` state-machine change.
 */
export const ListingStatus = z.enum(["draft", "published", "paused", "archived"]);
export type ListingStatus = z.infer<typeof ListingStatus>;

/** The type-segment filter the console + lane switch on (`?type=`). `all` = the combined catalogue. */
export const CatalogueTypeFilter = z.enum(["all", "product", "service"]);
export type CatalogueTypeFilter = z.infer<typeof CatalogueTypeFilter>;

/** The property the console sorts listings on. */
export const CatalogueSort = z.enum(["recent", "best-selling", "price", "rating", "status"]);
export type CatalogueSort = z.infer<typeof CatalogueSort>;

/** Sort direction (the `SortControl` asc/desc toggle). */
export const CatalogueSortDir = z.enum(["asc", "desc"]);
export type CatalogueSortDir = z.infer<typeof CatalogueSortDir>;
// #endregion

// #region Metrics (light inline analytics)
/**
 * The light per-listing analytics shown inline on the owner card + rolled up into the console's KPI
 * strip. Deliberately shallow — a few counters plus a small `trend` sparkline series — the deep
 * analytics dashboard is a separate future surface (the console links out to it, it is not built here).
 */
export const ListingMetricsSchema = z.object({
	/** Listing views in the trailing 30 days. */
	views30d: z.number().int().min(0),
	/** Completed orders (products) / bookings (sessions) / engagements (projects) to date. */
	orders: z.number().int().min(0),
	/** Gross revenue attributed to this listing (whole currency units). */
	revenue: z.number().min(0),
	/** Pre-formatted revenue label ("$1,240") so SSR and the client render identically. */
	revenueLabel: z.string().max(20),
	/** Average review score (0–5); `0` when there are no reviews yet. */
	avgRating: z.number().min(0).max(5),
	/** Number of reviews behind {@link avgRating}. */
	ratingCount: z.number().int().min(0),
	/** A short sparkline series (recent weekly views) — the inline trend chip. */
	trend: z.array(z.number()).max(24),
});
export type ListingMetrics = z.infer<typeof ListingMetricsSchema>;
// #endregion

// #region Listing summary (list row / card)
/**
 * One listing row in the console grid/table + the lane list. The `price` is the resolved display
 * projection (reusing {@link EntityPricingSchema}); the editable numeric config lives on
 * {@link ListingDetailSchema}. `needsAttention` flags a listing that wants the seller's eye (e.g. a
 * long-idle draft, or a published listing missing media) — surfaced iconographically, never as prose.
 */
export const ListingSummarySchema = z.object({
	id: z.string().min(1).max(120),
	/** The acting seller's `@handle` this listing is owned by (handle-scoped, RLS's eventual subject). */
	ownerId: z.string().max(40),
	kind: CatalogueKind,
	/** The service delivery model (services only); `null` for products. */
	serviceType: ServiceType.nullable(),
	title: z.string().min(1).max(200),
	category: z.string().max(80),
	status: ListingStatus,
	/** Cover thumbnail (the first media asset); `null` → the card renders a kind glyph. */
	cover: z.string().max(600).nullable(),
	/** The resolved display price block (fixed / pipeline range / per-session). */
	price: EntityPricingSchema,
	metrics: ListingMetricsSchema,
	/** ISO last-edited timestamp — the default `recent` sort key. */
	updatedAt: z.string(),
	/** Pre-formatted last-edited label ("Edited 2 days ago"). */
	updatedLabel: z.string().max(40),
	/** Whether the listing carries a promoted/sponsored placement. */
	promoted: z.boolean(),
	/** Whether the listing needs the seller's attention (idle draft / missing media / etc.). */
	needsAttention: z.boolean(),
});
export type ListingSummary = z.infer<typeof ListingSummarySchema>;
// #endregion

// #region Editable body
/**
 * The editable per-unit pricing config. Reuses the discovery `ServiceItem`'s numeric fields verbatim —
 * `amount` is the fixed engagement fee (One-Off / Direct Deliverable / product), `ticketPrice` the
 * per-ticket standard for a **Pipeline** (the card renders a 0.5×–2.0× range around it), `sessionPrice`
 * the per-slot fee for a **Session** / **Group Session**. The display projection is derived by
 * {@link resolveListingPricing}, mirroring the Entity View `servicePricing` helper so a listing agrees
 * with the card + `/view/[id]` it links to.
 */
export const ListingPricingSchema = z.object({
	amount: z.number().min(0),
	ticketPrice: z.number().min(0).nullable(),
	sessionPrice: z.number().min(0).nullable(),
	/** Group Session only — attendee cap per session (drives the `$X / seat` presentation). */
	seatsPerSession: z.number().int().min(1).max(500).nullable(),
});
export type ListingPricing = z.infer<typeof ListingPricingSchema>;

/**
 * A lightweight weekly availability window for Session / Group Session listings — the seat/slot rhythm
 * the manage-page calendar panel edits. Deliberately shallow (a timezone + offered weekdays + working
 * hours + a note); the full recurring-slot machinery is the scheduling domain's concern (Decision #37).
 */
export const ListingAvailabilitySchema = z.object({
	/** IANA timezone the hours are expressed in. */
	timezone: z.string().max(64),
	/** Offered weekdays (0 = Sunday … 6 = Saturday). */
	weekdays: z.array(z.number().int().min(0).max(6)).max(7),
	/** Working-hours window (24h) the slots fall within. */
	startHour: z.number().int().min(0).max(23),
	endHour: z.number().int().min(0).max(23),
	/** A free-text scheduling note ("Booked in 60-min blocks · 48h notice"). */
	note: z.string().max(400),
});
export type ListingAvailability = z.infer<typeof ListingAvailabilitySchema>;

/**
 * A single listing's full editable detail — the summary plus the deep body the manage page edits: the
 * rich description, media gallery, taxonomy (category + skills + tags), the pricing config, session
 * availability, and collection membership. `owner` is resolved for the live preview card (which renders
 * the REAL `ServiceCard`/`ProductCard`). It is the READ projection the editor seeds from and the WRITE
 * target updates fold into.
 */
export const ListingDetailSchema = ListingSummarySchema.extend({
	/** The owner attribution the live preview card renders (resolved server-side). */
	owner: ExploreOwnerSchema,
	/** Rich description (semantic HTML from the editor). */
	description: z.string().max(20000),
	/** Plain-text description snippet (the card/summary blurb + SEO). */
	descriptionText: z.string().max(4000),
	/** Media asset URLs (the gallery; `media[0]` is the cover). */
	media: z.array(z.string().max(600)).max(24),
	skills: z.array(SkillRefSchema).max(24),
	/** Free-text keywords/tags. */
	tags: z.array(z.string().max(40)).max(24),
	pricing: ListingPricingSchema,
	/** Turnaround / delivery label ("5-day delivery", "60-minute session"). */
	delivery: z.string().max(120),
	/** Session availability (Session / Group Session only); `null` otherwise. */
	availability: ListingAvailabilitySchema.nullable(),
	/** Collections/bundles this listing belongs to (names). */
	collections: z.array(z.string().max(80)).max(24),
});
export type ListingDetail = z.infer<typeof ListingDetailSchema>;
// #endregion

// #region List params + page
/** The console/lane list query. */
export const CatalogueListParamsSchema = z.object({
	/** Type segment — `all` (default) / `product` / `service`. */
	type: CatalogueTypeFilter.optional(),
	/** Restrict to one lifecycle state (the lane's status sections). */
	status: ListingStatus.optional(),
	/** Restrict services to one delivery model (visible only when Services active). */
	model: ServiceType.optional(),
	/** Free-text search over title + category + tags. */
	search: z.string().max(160).optional(),
	sort: CatalogueSort.optional(),
	dir: CatalogueSortDir.optional(),
	/** Icon-only quick filters — needs-attention / promoted / best-selling. */
	needsAttention: z.boolean().optional(),
	promoted: z.boolean().optional(),
	/** Opaque paging cursor (the id of the last item of the previous page). */
	cursor: z.string().max(120).nullable().optional(),
	limit: z.number().int().min(1).max(200).optional(),
});
export type CatalogueListParams = z.infer<typeof CatalogueListParamsSchema>;

/** The rolled-up KPI figures for the console analytics strip (over the WHOLE catalogue, not the page). */
export const CatalogueStatsSchema = z.object({
	/** Published (live) listings. */
	activeListings: z.number().int().min(0),
	/** Every non-archived listing. */
	totalListings: z.number().int().min(0),
	views30d: z.number().int().min(0),
	orders: z.number().int().min(0),
	revenue: z.number().min(0),
	revenueLabel: z.string().max(20),
	avgRating: z.number().min(0).max(5),
	/** Aggregate weekly-views sparkline. */
	trend: z.array(z.number()).max(24),
});
export type CatalogueStats = z.infer<typeof CatalogueStatsSchema>;

/** Per-status presence — drives the lane section pulsing dots (never a count, §B.6/§D.1). */
export const CatalogueStatusCountsSchema = z.object({
	draft: z.number().int().min(0),
	published: z.number().int().min(0),
	paused: z.number().int().min(0),
	archived: z.number().int().min(0),
});
export type CatalogueStatusCounts = z.infer<typeof CatalogueStatusCountsSchema>;

/** A page of listings plus the rolled-up stats + per-status presence + acting-seller identity. */
export const CataloguePageSchema = z.object({
	items: z.array(ListingSummarySchema),
	hasMore: z.boolean(),
	nextCursor: z.string().max(120).nullable(),
	/** Total matched across all pages (drives the "N listings" caption). */
	total: z.number().int().min(0),
	statusCounts: CatalogueStatusCountsSchema,
	stats: CatalogueStatsSchema,
	/** The acting seller's `@handle` — the eventual RLS subject; chrome-only today. */
	viewerId: z.string().max(40),
});
export type CataloguePage = z.infer<typeof CataloguePageSchema>;
// #endregion

// #region Mutation payloads
/**
 * The Create-Listing payload — the lightweight modal's minimal fields. `serviceType` is required when
 * `kind === "service"` (the delivery model must be chosen up front); products carry no delivery model.
 * A create yields a Draft and routes to `/catalogue/[id]` for the deep edit.
 */
export const CreateListingInputSchema = z.object({
	title: z.string().min(1, "Name your listing.").max(200),
	kind: CatalogueKind,
	/** Required for services; omitted for products. */
	serviceType: ServiceType.optional(),
}).refine((v) => v.kind !== "service" || !!v.serviceType, {
	message: "Pick a delivery model.",
	path: ["serviceType"],
});
export type CreateListingInput = z.infer<typeof CreateListingInputSchema>;

/** The Update-Listing payload — a partial patch over the editable body (every field optional but `id`). */
export const UpdateListingInputSchema = z.object({
	id: z.string().min(1).max(120),
	title: z.string().min(1).max(200).optional(),
	category: z.string().max(80).optional(),
	serviceType: ServiceType.optional(),
	description: z.string().max(20000).optional(),
	descriptionText: z.string().max(4000).optional(),
	media: z.array(z.string().max(600)).max(24).optional(),
	skills: z.array(SkillRefSchema).max(24).optional(),
	tags: z.array(z.string().max(40)).max(24).optional(),
	pricing: ListingPricingSchema.optional(),
	delivery: z.string().max(120).optional(),
	availability: ListingAvailabilitySchema.nullable().optional(),
	collections: z.array(z.string().max(80)).max(24).optional(),
});
export type UpdateListingInput = z.infer<typeof UpdateListingInputSchema>;

/** The Set-Status payload — the lifecycle transition (publish / pause / archive / restore). */
export const SetListingStatusInputSchema = z.object({
	id: z.string().min(1).max(120),
	status: ListingStatus,
});
export type SetListingStatusInput = z.infer<typeof SetListingStatusInputSchema>;

/** The Publish payload (a Set-Status to `published`, isolated so the publish gate is explicit). */
export const PublishListingInputSchema = z.object({
	id: z.string().min(1).max(120),
});
export type PublishListingInput = z.infer<typeof PublishListingInputSchema>;
// #endregion

// #region Pure helpers (shared client + server — no fork)
const PIPELINE_LOW = 0.5;
const PIPELINE_HIGH = 2.0;

/** `$1,240` — deterministic thousands grouping (no `toLocaleString`, so SSR == the client refetch). */
export function money(n: number): string {
	const r = Math.round(n);
	return `$${r.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/**
 * Resolve a listing's display price projection from its editable pricing config. Mirrors the Entity
 * View `servicePricing` helper (Decision #41/#45) so a catalogue card and the public `/view/[id]` show
 * the SAME figure: a **Pipeline** renders a 0.5×–2.0× per-ticket range, a **Session** `$X / session`, a
 * **Group Session** `$X / seat`, everything else the fixed `amount`. Pure — used by the fixtures, the
 * console list, and the manage-page preview.
 */
export function resolveListingPricing(
	input: { kind: CatalogueKind; serviceType: ServiceType | null; pricing: ListingPricing },
): z.infer<typeof EntityPricingSchema> {
	const { kind, serviceType, pricing } = input;
	if (kind === "service" && serviceType === "Pipeline" && pricing.ticketPrice) {
		const lo = Math.round(pricing.ticketPrice * PIPELINE_LOW);
		const hi = Math.round(pricing.ticketPrice * PIPELINE_HIGH);
		return {
			mode: "pipeline",
			display: `${money(lo)} – ${money(hi)}`,
			caption: "per ticket",
			min: lo,
			max: hi,
		};
	}
	if (kind === "service" && serviceType === "Session" && pricing.sessionPrice) {
		return { mode: "session", display: money(pricing.sessionPrice), caption: "per session" };
	}
	if (kind === "service" && serviceType === "Group Session" && pricing.sessionPrice) {
		return { mode: "session", display: money(pricing.sessionPrice), caption: "per seat" };
	}
	if (pricing.amount > 0) return { mode: "fixed", display: money(pricing.amount) };
	return { mode: "quote", display: "Set a price" };
}

/** The outcome of the publish-gate check — what (if anything) still blocks going live. */
export interface PublishReadiness {
	ready: boolean;
	/** Human labels of what is missing (e.g. `["a price", "at least one image"]`). */
	missing: string[];
}

/**
 * The publish gate — a listing may go live only with a title, a price, and at least one media item.
 * Shared by the client (to disable/enable the Publish action + explain what is missing) and the server
 * (defence in depth in {@link CatalogueBackendService.setStatus}). Mirrors the purchasing-gate
 * discipline used elsewhere.
 */
export function publishReadiness(detail: ListingDetail): PublishReadiness {
	const missing: string[] = [];
	if (!detail.title.trim()) missing.push("a title");
	const hasPrice = detail.pricing.amount > 0 ||
		(detail.pricing.ticketPrice ?? 0) > 0 ||
		(detail.pricing.sessionPrice ?? 0) > 0;
	if (!hasPrice) missing.push("a price");
	if (detail.media.length < 1) missing.push("at least one image");
	return { ready: missing.length === 0, missing };
}
// #endregion
