import type { ProfileItem, ServiceItem } from "../types/explore-types.ts";

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

/** Workload-intensity multipliers bracketing a Pipeline service's standard ticket price. */
const PIPELINE_LOW = 0.5;
const PIPELINE_HIGH = 2.0;

/**
 * The price a service card / detail panel displays, resolved by engagement model:
 *
 * - **Pipeline** — a per-ticket RANGE, not a single figure: the standard `ticketPrice` scaled by the
 *   low (`0.5×`) and high (`2.0×`) workload intensity, e.g. `$120 – $480` with the `ticket` unit.
 * - **Session** — a per-session price, e.g. `$180` with the `session` unit.
 * - **Group Session** — a per-attendee price, e.g. `$90` with the `seat` unit.
 * - **One-Off / Direct Deliverable** (or missing unit data) — the fixed `price` string as-is, no unit.
 *
 * `unit`, when present, is rendered as a muted `/ ticket` · `/ session` suffix by the caller.
 */
export function servicePricing(item: ServiceItem): { amount: string; unit?: string } {
	if (item.serviceType === "Pipeline" && item.ticketPrice) {
		const lo = money(Math.round(item.ticketPrice * PIPELINE_LOW));
		const hi = money(Math.round(item.ticketPrice * PIPELINE_HIGH));
		return { amount: `${lo} – ${hi}`, unit: "ticket" };
	}
	if (item.serviceType === "Session" && item.sessionPrice) {
		return { amount: money(item.sessionPrice), unit: "session" };
	}
	if (item.serviceType === "Group Session" && item.sessionPrice) {
		return { amount: money(item.sessionPrice), unit: "seat" };
	}
	return { amount: item.price };
}
