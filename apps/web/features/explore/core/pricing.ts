import { toMinorUnits } from "@projective/types/finance";
import { INTENSITY_MULTIPLIER } from "@projective/types/projects";
import type { ProfileItem, ProjectItem, ServiceItem } from "../types/explore-types.ts";

/**
 * Explore — client-side price DISPLAY helpers.
 *
 * Every figure leaves here STRUCTURED — integer minor units plus the currency they are quoted in — so
 * the surface renders it through `MoneyView` and follows the viewer's display currency. Nothing here
 * formats a currency symbol for the reader: a figure printed in its origin money beside a converted one
 * is two prices for one thing.
 *
 * A freelancer has no stored rate: their floor is derived from their active linked-service prices,
 * with statistical outliers trimmed. The backend has its own numeric copy for sorting/filtering; both
 * derive the same fenced floor.
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

/** One structured money figure — integer minor units plus the currency it is quoted in. */
export interface PriceAmount {
	minor: number;
	currency: string;
}

/**
 * A freelancer's fenced floor as structured money, or `null` when they have no active services or
 * their services span more than one currency (`serviceCurrency` absent) — a floor across currencies
 * is not a price.
 */
export function freelancerFloorAmount(item: ProfileItem): PriceAmount | null {
	if (!item.servicePrices?.length || !item.serviceCurrency) return null;
	const low = lowestActivePrice(item.servicePrices);
	const minor = low === null ? null : toMinorUnits(low, item.serviceCurrency);
	return minor === null ? null : { minor, currency: item.serviceCurrency };
}

/** A project's escrow budget as structured money, or `null` when the brief carries none. */
export function projectBudgetAmount(item: ProjectItem): PriceAmount | null {
	return typeof item.budgetMinor === "number"
		? { minor: item.budgetMinor, currency: item.currency ?? "USD" }
		: null;
}

/**
 * A service's price resolved by engagement model, as STRUCTURED amounts:
 *
 * - **Pipeline** — billed per ticket at the client's chosen intensity (PRODUCT_SPEC §The Architect's
 *   Override), so `from` is the Low-intensity price and `to` the High-intensity one, unit `ticket`.
 * - **Session** — a per-session price, unit `session`.
 * - **Group Session** — a per-attendee price, unit `seat`.
 * - **One-Off / Direct Deliverable** — the fixed `priceMinor`, no `to`.
 *
 * `null` when the item carries no structured price (a fixture without `priceMinor`, a "Contact us"
 * listing) — the caller falls back to the formatted string rather than to a fabricated zero.
 */
export function servicePriceParts(
	item: ServiceItem,
): { from: PriceAmount; to: PriceAmount | null; unit?: string } | null {
	const currency = item.currency ?? "USD";
	// The per-unit prices are MAJOR units; scaling them by the currency's own exponent (never a fixed
	// `× 100`) is what keeps a yen or a dinar price from being a hundredfold or tenfold wrong.
	const minor = (major: number): number => toMinorUnits(major, currency) ?? 0;

	if (item.serviceType === "Pipeline" && item.ticketPrice) {
		return {
			from: { minor: minor(item.ticketPrice * INTENSITY_MULTIPLIER.low), currency },
			to: { minor: minor(item.ticketPrice * INTENSITY_MULTIPLIER.high), currency },
			unit: "ticket",
		};
	}
	if (item.serviceType === "Session" && item.sessionPrice) {
		return { from: { minor: minor(item.sessionPrice), currency }, to: null, unit: "session" };
	}
	if (item.serviceType === "Group Session" && item.sessionPrice) {
		return { from: { minor: minor(item.sessionPrice), currency }, to: null, unit: "seat" };
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

/** One service's price line: the starting figure, its unit, and whether the figure is a FLOOR. */
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
 * The STARTING rate a service displays — one figure, never a range. The card and the search drawer
 * both render this, so the two cannot disagree about what a service costs; the full Pipeline range
 * stays on `/view/[id]`, where the stage ledger explains what moves it.
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
