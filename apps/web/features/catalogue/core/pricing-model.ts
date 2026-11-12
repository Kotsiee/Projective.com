import { toMinorUnits } from "@projective/types/finance";
import type { FormArchetype, ListingPricing } from "@projective/types/catalogue";
import { INTENSITY_PRICE_MULTIPLIER } from "@projective/types/projects";

/**
 * pricing-model — the pure rules under the Pricing section and the revision fields. A listing's
 * pricing is stored in whole units of its currency, the units its money fields edit; the ticket range
 * is worked in minor units, converted here, exponent-aware (a JPY figure has no minor digits).
 */

// #region Units
/** A stored whole-unit price in minor units. */
export function minorOf(whole: number | null, currency: string): number | null {
	return toMinorUnits(whole, currency);
}

/** A picked currency as the ISO-4217 code a listing stores, or `null` when it is not one. */
export function currencyOf(code: unknown): string | null {
	if (typeof code !== "string") return null;
	const upper = code.trim().toUpperCase();
	return /^[A-Z]{3}$/.test(upper) ? upper : null;
}
// #endregion

// #region Fields
/** The price a form archetype asks for, by its `ListingPricing` key. */
export type PriceField = "amount" | "ticketPrice" | "sessionPrice";

/** What the Pricing section asks a seller for, per archetype. */
export interface PriceAsk {
	field: PriceField;
	label: string;
	hint: string;
}

/**
 * The price a form archetype is sold at: a fixed fee for a product or a One-Off, the baseline
 * ticket for a Pipeline (buyers see a range around it), a fee per session, or per seat for a cohort.
 */
export function priceAsk(archetype: FormArchetype): PriceAsk {
	switch (archetype) {
		case "pipeline":
			return {
				field: "ticketPrice",
				label: "Baseline ticket price",
				hint: "The price of one ticket. With tiered intensity it is the Standard price, and buyers pick Low (0.75×) to High (1.5×).",
			};
		case "session":
			return { field: "sessionPrice", label: "Price per session", hint: "What one sitting costs." };
		case "cohort":
			return {
				field: "sessionPrice",
				label: "Price per seat",
				hint: "What one attendee pays for one sitting.",
			};
		default:
			return { field: "amount", label: "Price", hint: "What the buyer pays, in full." };
	}
}

/** The asked price, in whole units; `0` reads as unpriced for the fixed fee, as it does on the card. */
export function askedPrice(pricing: ListingPricing, field: PriceField): number | null {
	if (field === "amount") return pricing.amount > 0 ? pricing.amount : null;
	return pricing[field];
}

/** `pricing` with the asked price set; clearing the fixed fee stores `0`, its unpriced value. */
export function withAskedPrice(
	pricing: ListingPricing,
	field: PriceField,
	whole: number | null,
): ListingPricing {
	if (field === "amount") return { ...pricing, amount: whole ?? 0 };
	return { ...pricing, [field]: whole };
}

/** The Pipeline range buyers see around a ticket price, in minor units: the Low to High multiplier. */
export function ticketRange(minor: number): { low: number; high: number } {
	return {
		low: Math.round(minor * INTENSITY_PRICE_MULTIPLIER.low),
		high: Math.round(minor * INTENSITY_PRICE_MULTIPLIER.high),
	};
}
// #endregion

// #region Revisions
/** The free revisions a newly declared allowance starts at. */
export const DEFAULT_FREE_REVISIONS = 2;

/**
 * `pricing` with its free revisions declared or withdrawn. Withdrawing stores `null`, meaning the
 * corpus default applies — not `0`, which is the distinct claim that no rounds are included.
 */
export function withRevisionsDeclared(pricing: ListingPricing, declared: boolean): ListingPricing {
	if (!declared) return { ...pricing, freeRevisions: null };
	return { ...pricing, freeRevisions: pricing.freeRevisions ?? DEFAULT_FREE_REVISIONS };
}
// #endregion
