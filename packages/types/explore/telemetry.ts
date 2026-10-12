import { z } from "zod";
import { ExploreEntity } from "./items.ts";

/**
 * explore.telemetry — the Zod SSOT for the discovery-telemetry beacon.
 *
 * The `ImpressionTracker` island batches what a reader saw, opened and scrolled on a discovery
 * surface and posts it with `navigator.sendBeacon` to `POST /api/explore/events`; the fat
 * `InterestBackendService` resolves each card's public id to its database uuid and writes
 * `search.interest_events`. Event names are the `discovery.*` members of `KnownAnalyticsEvent`
 * (`@projective/types/analytics`) and are registered in `analytics.event_catalogue`.
 */

// #region Vocabulary
/** The `discovery.*` events the beacon carries (`discovery.search` is logged server-side). */
export const DiscoveryEventName = z.enum([
	"discovery.impression",
	"discovery.click",
	"discovery.rail_depth",
]);
export type DiscoveryEventName = z.infer<typeof DiscoveryEventName>;

/** The page a batch was produced on. */
export const DiscoverySurface = z.enum(["explore.home", "explore.results"]);
export type DiscoverySurface = z.infer<typeof DiscoverySurface>;
// #endregion

// #region Events
const RailId = z.string().min(1).max(64);

/** A card was ≥ 50% visible for 1 s, or its own link was opened. */
export const DiscoveryItemEventSchema = z.object({
	name: z.enum(["discovery.impression", "discovery.click"]),
	/** The card's public id (`data-item-id`: a slug or handle), resolved server-side. */
	itemId: z.string().min(1).max(160),
	/** The card's `data-item-type`. A hint only: the server trusts its own catalogue. */
	itemType: ExploreEntity,
	/** The rail the card sat in, when it sat in one. */
	rail: RailId.optional(),
	/** Zero-based slot within its rail or grid. */
	position: z.number().int().min(0).max(500).optional(),
	/** Epoch ms in the browser. */
	at: z.number(),
});
export type DiscoveryItemEvent = z.infer<typeof DiscoveryItemEventSchema>;

/** The furthest a reader scrolled one horizontal rail during this page view. */
export const DiscoveryRailDepthEventSchema = z.object({
	name: z.literal("discovery.rail_depth"),
	rail: RailId,
	/** `(scrollLeft + clientWidth) / scrollWidth`, 0–1. */
	depth: z.number().min(0).max(1),
	/** Cards in the rail. */
	items: z.number().int().min(0).max(500),
	at: z.number(),
});
export type DiscoveryRailDepthEvent = z.infer<typeof DiscoveryRailDepthEventSchema>;

export const DiscoveryEventSchema = z.discriminatedUnion("name", [
	DiscoveryItemEventSchema,
	DiscoveryRailDepthEventSchema,
]);
export type DiscoveryEvent = z.infer<typeof DiscoveryEventSchema>;
// #endregion

// #region Batch
/** Most events one beacon may carry. */
export const DISCOVERY_BATCH_MAX = 50;

/** The `POST /api/explore/events` body. */
export const DiscoveryEventBatchSchema = z.object({
	/** Per-tab anonymous key (`search.interest_events.session_id`). */
	sessionId: z.string().min(8).max(64),
	surface: DiscoverySurface,
	/** The active free-text query on a results page. */
	query: z.string().max(200).optional(),
	events: z.array(DiscoveryEventSchema).min(1).max(DISCOVERY_BATCH_MAX),
});
export type DiscoveryEventBatch = z.infer<typeof DiscoveryEventBatchSchema>;

/** The ingest outcome. */
export interface DiscoveryIngestResult {
	/** Events written (or acknowledged in stub mode). */
	accepted: number;
	/** Events dropped because their item is not in the public catalogue. */
	dropped: number;
}
// #endregion
