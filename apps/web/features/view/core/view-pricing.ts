import type { EntityView } from "@projective/types/explore";
import { type PriceAmount, serviceStartingPrice } from "@features/explore/core/pricing.ts";

/**
 * View feature — the ONE headline-price resolver for the Entity View page.
 *
 * Both regions that can carry the offer read this: the conversion lane on desktop and the body-side
 * transactional block below `--bp-md`. They are mutually exclusive by `display`, but they are two
 * components, and two components deriving a price independently is how a surface comes to quote two
 * different numbers for one listing.
 *
 * It does **not** re-derive anything. It delegates to {@link serviceStartingPrice} — the same
 * function the Explore card that linked here reads, which in turn reads `servicePriceParts` — so the
 * card, this page and `/checkout` cannot disagree about what a listing costs (§8 Decision #45).
 *
 * Pure and client-safe (SSR == island).
 */

/** One resolved headline price, in the shape both transactional regions render. */
export interface HeadlinePrice {
	/** The structured figure for `MoneyView`, or `null` for a listing with no price ("Contact us"). */
	amount: PriceAmount | null;
	/** The pre-formatted fallback for a listing carrying no structured minor units. */
	fallback: string;
	/** The per-unit noun (`ticket`, `session`, `seat`), without the leading slash. */
	unit?: string;
	/**
	 * Whether the figure is only the LOW end of a range and must be announced as a floor.
	 *
	 * A One-Off quoted at £150 is £150 — prefixing it with "From" would invent an open-ended cost the
	 * seller never offered, which is the kind of small dishonesty that is very hard to notice and very
	 * expensive once someone does.
	 */
	isFloor: boolean;
}

/**
 * Resolve the headline price for a composed view payload.
 *
 * A **Pipeline** keeps its full range available through `servicePriceParts` (which the stage ledger
 * renders per stage), but the lane shows the floor with `isFloor` set: the lane is a decision
 * surface, and a reader comparing two listings has to pick one end of a range to compare against
 * anyway. The full range still renders per-stage in the ledger, where there is room to explain what
 * moves it.
 */
export function headlinePriceFor(view: EntityView): HeadlinePrice {
	const { item } = view;

	if (item.type === "services") {
		const resolved = serviceStartingPrice(item);
		return {
			amount: resolved.amount,
			fallback: resolved.fallback,
			unit: resolved.unit,
			isFloor: resolved.isFloor,
		};
	}

	if (item.type === "products") {
		return {
			amount: typeof item.priceMinor === "number"
				? { minor: item.priceMinor, currency: item.currency ?? "USD" }
				: null,
			fallback: item.price,
			unit: undefined,
			isFloor: false,
		};
	}

	// Projects and profile entities are not bought outright, so the lane falls back to the composed
	// pricing block's pre-formatted display string rather than inventing a figure.
	return { amount: null, fallback: view.pricing.display, isFloor: false };
}

/** Re-exported so a consumer needs one import rather than reaching across two feature folders. */
export type { PriceAmount };
