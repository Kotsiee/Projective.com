import { z } from "zod";
import { ExploreItemSchema, ExploreOwnerSchema, RatingTrackSchema } from "./items.ts";

/**
 * explore.view — the Zod SSOT for the public Entity View page (`/view/[id]`).
 *
 * The item detail page is a composed READ projection over the discovery corpus: the item itself plus
 * its derived media gallery, resolved pricing/trust facts, cross-sell rails ("more by this creator" /
 * "similar"), and its aggregated reviews. The fat {@link ExploreBackendService.viewPage} builds this
 * (deterministically, from fixtures today; from the discovery + reviews tables when they land — the
 * same schema validates both). Only primitive/enum/object/array/number/string forms are used so the
 * schema stays stable across Zod majors (matching the rest of this domain).
 */

// #region Media gallery
/** One media asset in the hero showcase gallery. */
export const EntityMediaSchema = z.object({
	/** Full-resolution source (opened in the lightbox). */
	src: z.string(),
	/** A smaller thumbnail crop of the same asset (the vertical strip + lightbox tray). */
	thumb: z.string(),
	/** Alt text — empty for purely decorative crops. */
	alt: z.string(),
	kind: z.enum(["image", "video"]),
});
export type EntityMedia = z.infer<typeof EntityMediaSchema>;
// #endregion

// #region Pricing
/**
 * The resolved price block shown in the sidebar action panel. `mode` drives the presentation:
 * `fixed` → `$X`; `pipeline` → `$Min – $Max / ticket`; `session` → `$X / session`. `display` is the
 * fully-formatted primary string; `caption` is an optional secondary line (e.g. the range basis).
 */
export const EntityPricingSchema = z.object({
	mode: z.enum(["fixed", "pipeline", "session", "quote"]),
	display: z.string(),
	caption: z.string().optional(),
	/** Numeric bounds (for a pipeline range) — presentation already formatted into `display`. */
	min: z.number().optional(),
	max: z.number().optional(),
});
export type EntityPricing = z.infer<typeof EntityPricingSchema>;
// #endregion

// #region Trust & operational meta
/** One trust/operational fact chip in the sidebar (response time, delivery guarantee, …). */
export const TrustFactSchema = z.object({
	/** Iconographic key the UI maps to a glyph. */
	icon: z.enum(["response", "delivery", "seller", "escrow", "revisions", "returns"]),
	label: z.string(),
	value: z.string(),
});
export type TrustFact = z.infer<typeof TrustFactSchema>;
// #endregion

// #region Reviews
/** The 1★–5★ histogram (index 0 = 1★ … index 4 = 5★). */
export const ReviewDistributionSchema = z.array(z.number()).length(5);
export type ReviewDistribution = z.infer<typeof ReviewDistributionSchema>;

/** The aggregate reputation for the item's creator, powering the breakdown chart + summary line. */
export const ReviewSummarySchema = z.object({
	average: z.number(),
	count: z.number(),
	distribution: ReviewDistributionSchema,
	/** Optional split reputation tracks (a freelancer/user carries both). */
	asHelper: RatingTrackSchema.optional(),
	asClient: RatingTrackSchema.optional(),
});
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;

/** A single client/freelancer review in the filterable list. */
export const EntityReviewSchema = z.object({
	id: z.string(),
	author: ExploreOwnerSchema,
	rating: z.number(),
	/** Which reputation track this review scores. */
	track: z.enum(["helper", "client"]),
	title: z.string(),
	body: z.string(),
	/** ISO date — drives the "recent" sort. */
	createdAt: z.string(),
	/** Human date label (`Jun 2026`). */
	dateLabel: z.string(),
	/** The reciprocal-review badge: both parties rated each other on the engagement. */
	reciprocal: z.boolean(),
	/** "Verified purchase / completed engagement" trust marker. */
	verifiedEngagement: z.boolean(),
});
export type EntityReview = z.infer<typeof EntityReviewSchema>;
// #endregion

// #region Composed page payload
/**
 * The full composed Entity View page — the payload {@link ExploreBackendService.viewPage} returns and
 * the `/view/[id]` route hands to the view feature. Everything the hero, the sidebar action panel, and
 * the lower recommendation/reviews sections need in one server-resolved shape.
 */
export const EntityViewSchema = z.object({
	item: ExploreItemSchema,
	gallery: z.array(EntityMediaSchema),
	pricing: EntityPricingSchema,
	trust: z.array(TrustFactSchema),
	/** Deliverables / key specifications rendered in the right details column. */
	deliverables: z.array(z.string()),
	/** Other items by the same creator (the "More by …" rail). */
	moreByOwner: z.array(ExploreItemSchema),
	/** Algorithmically-adjacent items in the same category (the "Similar" rail). */
	similar: z.array(ExploreItemSchema),
	reviews: z.object({
		summary: ReviewSummarySchema,
		list: z.array(EntityReviewSchema),
	}),
});
export type EntityView = z.infer<typeof EntityViewSchema>;
// #endregion
