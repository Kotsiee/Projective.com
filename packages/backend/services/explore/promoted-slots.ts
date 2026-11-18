import type {
	ExploreCategory,
	ExploreItem,
	ProductItem,
	ServiceItem,
	SponsoredPromo,
} from "@projective/types/explore";
import type { CatalogPlacement, PlacementSurface } from "./live-catalog.ts";

/**
 * promoted-slots — which promoted placements fill the labelled "Promoted" slots (Decision #454).
 *
 * Organic ranking is never for sale, so nothing here reads or reorders a ranked list: a slot is chosen
 * from the live ledger and returned BESIDE the organic sections, which the caller passes through
 * untouched. Each rail (services, products) has one fixed slot at its head; when several sellers hold
 * a live flight for it, the slot rotates between them by the hour, so the oldest flight never
 * monopolises it. Pure, so the rules are tested without a database.
 */

// #region Constants
/** The rails a promoted slot can head. */
export type PromotedRail = SponsoredPromo["rail"];

const RAILS: readonly PromotedRail[] = ["services", "products"];

/** How long one seller holds a contested slot before it rotates to the next. */
export const SLOT_ROTATION_MS = 60 * 60 * 1000;
// #endregion

// #region Slot building
/** The facts a slot is chosen from: the live placements and the published items they resolve to. */
export interface PlacementSource {
	placements: readonly CatalogPlacement[];
	byId: ReadonlyMap<string, ExploreItem>;
}

function isListing(item: ExploreItem | undefined): item is ServiceItem | ProductItem {
	return item?.type === "services" || item?.type === "products";
}

/** The slot a promoted listing renders as. */
export function promotedSlotOf(item: ServiceItem | ProductItem): SponsoredPromo {
	return {
		variant: "sponsored",
		id: `sp-${item.id}`,
		rail: item.type,
		itemId: item.id,
		title: item.title,
		body: item.summary,
		media: item.media ?? "",
		mediaPlaceholder: item.mediaPlaceholder,
		owner: item.owner,
		href: `/view/${item.id}`,
		cta: item.type === "services" ? "View service" : "View product",
	};
}

/** The distinct promoted listings on `surface` for one rail, oldest flight first. */
function candidatesFor(
	source: PlacementSource,
	surface: PlacementSurface,
	rail: PromotedRail,
	eligible: (item: ServiceItem | ProductItem) => boolean,
): Array<ServiceItem | ProductItem> {
	const seen = new Set<string>();
	const out: Array<ServiceItem | ProductItem> = [];
	for (const placement of source.placements) {
		if (placement.surface !== surface || seen.has(placement.itemId)) continue;
		const item = source.byId.get(placement.itemId);
		if (!isListing(item) || item.type !== rail || !eligible(item)) continue;
		seen.add(item.id);
		out.push(item);
	}
	return out;
}

/** One slot per rail, rotating among that rail's candidates by the hour. */
function slotsFor(
	source: PlacementSource,
	surface: PlacementSurface,
	rails: readonly PromotedRail[],
	now: number,
	eligible: (item: ServiceItem | ProductItem) => boolean = () => true,
): SponsoredPromo[] {
	const turn = Math.floor(now / SLOT_ROTATION_MS);
	return rails.flatMap((rail) => {
		const candidates = candidatesFor(source, surface, rail, eligible);
		return candidates.length === 0 ? [] : [promotedSlotOf(candidates[turn % candidates.length])];
	});
}
// #endregion

// #region Surfaces
/** The Explore Home's slots: at most one at the head of the services rail and one at the products rail. */
export function homePromotedSlots(source: PlacementSource, now: number): SponsoredPromo[] {
	return slotsFor(source, "explore_home", RAILS, now);
}

/**
 * A search's slots, drawn only from listings that already match it (`matched` is the organic result
 * set), so a promotion can never put an irrelevant listing into a search. The grouped feed gets one per
 * services / products rail; an isolated services or products feed gets one, before the feed; any other
 * category, and every page after the first, gets none.
 */
export function resultPromotedSlots(
	source: PlacementSource,
	matched: readonly ExploreItem[],
	category: ExploreCategory,
	offset: number,
	now: number,
): SponsoredPromo[] {
	if (offset > 0) return [];
	const rails = category === "all" ? RAILS : RAILS.filter((rail) => rail === category);
	if (rails.length === 0) return [];
	const matchedIds = new Set(matched.map((it) => it.id));
	return slotsFor(source, "explore_results", rails, now, (item) => matchedIds.has(item.id));
}
// #endregion
