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
/** One structured money figure — integer minor units plus the currency it is quoted in. */
export interface PriceAmount {
	minor: number;
	currency: string;
}

/**
 * The same pricing decision as {@link servicePricing}, but resolved to STRUCTURED amounts so a card
 * can render `MoneyView` and follow the viewer's display currency.
 *
 * It deliberately mirrors `servicePricing`'s branches one-for-one rather than replacing it: the
 * string form is still what every not-yet-migrated surface renders, and two functions that disagree
 * about which figure a Pipeline service shows would be worse than one that is merely duplicated.
 * Both read the same fields and apply the same multipliers, so they resolve to the same money.
 *
 * `null` when the item carries no structured price (a fixture without `priceMinor`, a "Contact us"
 * listing) — the caller falls back to the formatted string rather than to a fabricated zero.
 */
export function servicePriceParts(
	item: ServiceItem,
): { from: PriceAmount; to: PriceAmount | null; unit?: string } | null {
	const currency = item.currency ?? "USD";

	if (item.serviceType === "Pipeline" && item.ticketPrice) {
		return {
			from: { minor: Math.round(item.ticketPrice * PIPELINE_LOW) * 100, currency },
			to: { minor: Math.round(item.ticketPrice * PIPELINE_HIGH) * 100, currency },
			unit: "ticket",
		};
	}
	if (item.serviceType === "Session" && item.sessionPrice) {
		return { from: { minor: item.sessionPrice * 100, currency }, to: null, unit: "session" };
	}
	if (item.serviceType === "Group Session" && item.sessionPrice) {
		return { from: { minor: item.sessionPrice * 100, currency }, to: null, unit: "seat" };
	}
	if (typeof item.priceMinor === "number") {
		return { from: { minor: item.priceMinor, currency }, to: null };
	}
	return null;
}

/**
 * The per-unit noun a service card prints under its figure — `/ ticket`, `/ session`, `/ seat`.
 *
 * Every delivery model gets one, including the two that quote a single total. A figure with no unit
 * beside it is read as "the price", and for a One-Off that is exactly right, so the unit says
 * `/ project` and confirms it rather than leaving the reader to infer it from the absence of a word.
 */
const SERVICE_UNITS: Record<string, string> = {
	"Pipeline": "ticket",
	"Session": "session",
	"Group Session": "seat",
	"One-Off": "project",
	"Direct Deliverable": "deliverable",
};

/** One service card's price line: the starting figure, its unit, and whether the figure is a FLOOR. */
export interface ServiceStartingPrice {
	/** The structured amount to render through `MoneyView`, or `null` for a listing with no figure. */
	amount: PriceAmount | null;
	/** The pre-formatted fallback string, for a listing that carries no structured minor units. */
	fallback: string;
	/** The per-unit noun, without the leading slash. */
	unit?: string;
	/**
	 * True when the underlying price is a RANGE and this is only its low end, so the figure must be
	 * announced as a floor ("From £120.00"). False when the figure is the whole price — a One-Off
	 * quoted at £150 is £150, and prefixing it with "From" would invent an open-ended cost the seller
	 * never offered.
	 */
	isFloor: boolean;
}

/**
 * The STARTING rate a service card displays — one figure, never a range.
 *
 * A card's job is to make listings comparable at a glance, and a range makes two listings hard to
 * compare because the reader has to decide which end to compare against. So the card shows the floor
 * and says so; the full Pipeline range still lives on `/view/[id]` and in the search drawer, where
 * there is room to explain what moves it (see {@link servicePricing}, which is unchanged and remains
 * what those surfaces render).
 *
 * This does NOT re-derive the price: it reads {@link servicePriceParts}, so a card and the page it
 * links to cannot disagree about what a service costs.
 */
export function serviceStartingPrice(item: ServiceItem): ServiceStartingPrice {
	const parts = servicePriceParts(item);
	const unit = SERVICE_UNITS[item.serviceType];
	return {
		amount: parts?.from ?? null,
		fallback: item.price,
		unit,
		isFloor: !!parts?.to,
	};
}

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
