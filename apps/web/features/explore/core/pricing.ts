import type { ProfileItem } from "../types/explore-types.ts";

/**
 * Explore — client-side price DISPLAY helpers.
 *
 * A freelancer has no stored rate: their card shows a derived "from $…" floor computed from their
 * active linked-service prices, with statistical outliers trimmed. This is pure presentation (the
 * cards + detail panel render it), so it lives feature-side; the backend has its own numeric copy for
 * sorting/filtering. Both derive the same fenced floor.
 */

/**
 * Lowest active linked-service price with statistical outliers trimmed via the IQR fence
 * (below `Q1 − 1.5·IQR`). Returns `null` when there are no prices; with fewer than four samples the
 * spread is unreliable, so the raw minimum is used.
 */
export function lowestActivePrice(prices: number[]): number | null {
	if (prices.length === 0) return null;
	if (prices.length < 4) return Math.min(...prices);
	const s = [...prices].sort((a, b) => a - b);
	const quantile = (p: number): number => {
		const i = (s.length - 1) * p;
		const lo = Math.floor(i);
		const hi = Math.ceil(i);
		return s[lo] + (s[hi] - s[lo]) * (i - lo);
	};
	const q1 = quantile(0.25);
	const q3 = quantile(0.75);
	const fence = q1 - 1.5 * (q3 - q1);
	const kept = s.filter((v) => v >= fence);
	return kept.length ? kept[0] : s[0];
}

/** Format a whole-dollar amount, e.g. `95` → `"$95"`. */
export function money(n: number): string {
	return `$${n.toLocaleString("en-US")}`;
}

/** The "from $…" floor a freelancer card displays, or `null` when no active services. */
export function freelancerFloor(item: ProfileItem): string | null {
	if (!item.servicePrices?.length) return null;
	const low = lowestActivePrice(item.servicePrices);
	return low === null ? null : `from ${money(low)}`;
}
