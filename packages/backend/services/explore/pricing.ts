import type { ExploreItem } from "@projective/types/explore";

/**
 * Explore — the numeric pricing primitives, server-side.
 *
 * The discovery corpus stores a price as a **formatted display string** (`"$4,800"`) plus, for the
 * models that are billed per unit, a numeric `ticketPrice` / `sessionPrice`. Three consumers need the
 * NUMBER behind that presentation — the sort key ({@link ExploreItem} ordering in `query.ts`), the
 * `/view/[id]` price block (`view-fixtures.ts`), and now a basket line's unit price — so the
 * multipliers and the parser live here exactly once. A second copy is how a pipeline comes to be
 * bracketed `0.5×–2.0×` on the card and something else in the basket, and only one of those is what
 * the buyer is charged (root CLAUDE.md §8 Decision #45 keeps these in parity).
 *
 * Everything here is in **major units** (whole dollars, the corpus's own unit). Converting to the
 * integer minor units every finance figure is expressed in is the caller's step.
 */

// #region Workload-intensity multipliers
/**
 * The multipliers bracketing a Pipeline service's standard per-ticket price — the Architect's Override
 * (`PRODUCT_SPEC.md` §The Weighting Engine): Low `0.5×` · Standard `1.0×` · High `2.0×`. A card shows
 * the RANGE; a basket line shows the price of the intensity the buyer actually chose.
 */
export const PIPELINE_LOW = 0.5;
/** The high-intensity multiplier — see {@link PIPELINE_LOW}. */
export const PIPELINE_HIGH = 2.0;
// #endregion

// #region Parsing + unit price
/**
 * The number behind a formatted corpus price (`"$4,800"` → `4800`). Returns `0` when the string carries
 * no digits, so a malformed fixture sorts last rather than producing `NaN`.
 */
export function parsePriceMajor(price: string): number {
	return Number(price.replace(/[^0-9.]/g, "")) || 0;
}

/**
 * The price of ONE purchasable unit of an item, in major units, at **Standard** workload intensity.
 *
 * This is deliberately different from the sort key: a sort orders a pipeline by its cheapest possible
 * ticket (the `0.5×` floor, so the range's low end is what ranks), whereas a purchase charges the
 * standard ticket. Session and Group Session bill per slot / per seat, and everything else is its fixed
 * engagement price.
 */
export function unitPriceMajor(item: ExploreItem): number {
	switch (item.type) {
		case "services": {
			if (item.serviceType === "Pipeline" && item.ticketPrice) return item.ticketPrice;
			if (
				(item.serviceType === "Session" || item.serviceType === "Group Session") &&
				item.sessionPrice
			) return item.sessionPrice;
			return parsePriceMajor(item.price);
		}
		case "products":
			return parsePriceMajor(item.price);
		case "projects":
			return parsePriceMajor(item.budget);
		default:
			return 0;
	}
}
// #endregion
