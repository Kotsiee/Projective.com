import type { ExploreItem } from "@projective/types/explore";

/**
 * Explore — the numeric pricing primitives, server-side.
 *
 * The discovery corpus stores a price as a **formatted display string** (`"$4,800"`) plus, for the
 * models that are billed per unit, a numeric `ticketPrice` / `sessionPrice`. Three consumers need the
 * NUMBER behind that presentation — the sort key ({@link ExploreItem} ordering in `query.ts`), the
 * `/view/[id]` price block (`live-view.ts`), and now a basket line's unit price — so the parser lives
 * here exactly once, and a Pipeline's Low–High span (or its one fixed price) is the Zod SSOT's
 * `pipelineTicketSpan` everywhere (root CLAUDE.md §8 Decision #45 keeps these in parity).
 *
 * Everything here is in **major units** (whole dollars, the corpus's own unit). Converting to the
 * integer minor units every finance figure is expressed in is the caller's step.
 */

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
 * ticket (the Low floor, so the range's low end is what ranks), whereas a purchase charges the
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
