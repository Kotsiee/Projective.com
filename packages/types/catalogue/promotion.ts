import { z } from "zod";

/**
 * Promoted placements (Decision #454) — a seller's plan-allocated, separately labelled "Promoted" slot
 * on Explore. Organic ranking is never for sale: the slot sits at a fixed position outside the ranked
 * order and never moves an organic result.
 */

// #region The ledger row
/** `marketplace.promoted_placements.surface` — every inventory slot the ledger accepts. */
export const PlacementSurfaceSchema = z.enum(["explore_home", "explore_results", "view_rail"]);
export type PlacementSurface = z.infer<typeof PlacementSurfaceSchema>;

/** `marketplace.promoted_placements.entity_type`. */
export const PlacementEntityTypeSchema = z.enum([
	"service",
	"product",
	"freelancer",
	"team",
	"project",
]);
export type PlacementEntityType = z.infer<typeof PlacementEntityTypeSchema>;

/** One `marketplace.promoted_placements` row. Written only by the `marketplace.*` promotion doors. */
export const PromotedPlacementRowSchema = z.object({
	id: z.string().uuid(),
	sponsor_user_id: z.string().uuid(),
	entity_type: PlacementEntityTypeSchema,
	entity_id: z.string().uuid(),
	surface: PlacementSurfaceSchema,
	starts_at: z.string(),
	ends_at: z.string(),
	cancelled_at: z.string().nullable(),
	spend_cents: z.number().int().nonnegative(),
	currency: z.string().regex(/^[A-Z]{3}$/),
	created_at: z.string(),
	updated_at: z.string(),
});
export type PromotedPlacementRow = z.infer<typeof PromotedPlacementRowSchema>;
// #endregion

// #region The seller's control
/** The surfaces a seller may promote a listing on (`marketplace.promote_listing`). */
export const PromotionSurfaceSchema = z.enum(["explore_home", "explore_results"]);
export type PromotionSurface = z.infer<typeof PromotionSurfaceSchema>;

/** The words a seller chooses a surface by. */
export const PROMOTION_SURFACE_LABEL: Record<PromotionSurface, string> = {
	explore_home: "Explore home",
	explore_results: "Search results",
};

/** A live placement on the listing the control is about. */
export const ListingPromotionLiveSchema = z.object({
	placementId: z.string().uuid(),
	surface: PromotionSurfaceSchema,
	startsAt: z.string(),
	endsAt: z.string(),
});
export type ListingPromotionLive = z.infer<typeof ListingPromotionLiveSchema>;

/** The seller's one live placement when it runs on another of their listings. */
export const ListingPromotionElsewhereSchema = z.object({
	slug: z.string(),
	title: z.string(),
	endsAt: z.string(),
});
export type ListingPromotionElsewhere = z.infer<typeof ListingPromotionElsewhereSchema>;

/** What the /catalogue Promote control shows for one listing (`marketplace.get_listing_promotion`). */
export const ListingPromotionSchema = z.object({
	/** The listing's `svc-` / `prd-` slug. */
	id: z.string(),
	/** Whether the owning subject's plan holds `promoted_placement`. */
	entitled: z.boolean(),
	/** Whose plan and whose one live slot: the team's for a team listing, else the person's. */
	subject: z.enum(["user", "team"]),
	published: z.boolean(),
	flightDays: z.number().int().positive(),
	live: ListingPromotionLiveSchema.nullable(),
	elsewhere: ListingPromotionElsewhereSchema.nullable(),
});
export type ListingPromotion = z.infer<typeof ListingPromotionSchema>;

/** `POST /api/catalogue/promotion` — start the listing's one flight on a surface. */
export const PromoteListingInputSchema = z.object({
	id: z.string().min(1).max(64),
	surface: PromotionSurfaceSchema,
});
export type PromoteListingInput = z.infer<typeof PromoteListingInputSchema>;

/** What the control is able to do now, derived from a {@link ListingPromotion}. */
export type PromotionState =
	| { kind: "unpublished" }
	| { kind: "not_entitled"; subject: ListingPromotion["subject"] }
	| { kind: "live"; live: ListingPromotionLive }
	| { kind: "elsewhere"; elsewhere: ListingPromotionElsewhere }
	| { kind: "available"; flightDays: number };

/**
 * The one state a promotion control renders, in priority order: a running flight always shows (so it
 * can be stopped even after a plan lapses), then the reasons it cannot start, then the offer.
 */
export function promotionStateOf(p: ListingPromotion): PromotionState {
	if (p.live) return { kind: "live", live: p.live };
	if (!p.published) return { kind: "unpublished" };
	if (!p.entitled) return { kind: "not_entitled", subject: p.subject };
	if (p.elsewhere) return { kind: "elsewhere", elsewhere: p.elsewhere };
	return { kind: "available", flightDays: p.flightDays };
}
// #endregion
