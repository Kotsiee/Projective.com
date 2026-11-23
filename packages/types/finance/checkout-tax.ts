import { z } from "zod";
import type { ListingProductFormat } from "../catalogue/offer.ts";
import { currency, minorUnitsNonNeg, timestamp, uuid } from "./common.ts";

/**
 * Tax at checkout (Decision #490, MARKETPLACE_BUILD_PROMPTS CK4): the platform calculates and collects
 * tax through Stripe Tax only where it is the supplier, on top of the price (tax-exclusive), behind
 * `tax_collection_enabled` (a `security.platform_params` value, seeded off until counsel rules).
 */

// #region The split by kind
/** The platform param that switches checkout tax on (Decision #490). Off until counsel rules. */
export const TAX_COLLECTION_PARAM = "tax_collection_enabled";

/** The platform param naming the `finance.purchasable_item_kind` values the platform collects on. */
export const TAX_COLLECTED_KINDS_PARAM = "tax_collected_kinds";

/** What `tax_collected_kinds` holds as seeded (#490 (A)): digital products, which the platform supplies. */
export const DEFAULT_TAX_COLLECTED_KINDS: readonly string[] = ["digital_product"];

/**
 * The line every checkout carries while the switch is on and a line is of a kind the platform does not
 * collect on: a service or a session is a contract between the client and the seller (#490 (A)).
 */
export const SELLER_RESPONSIBLE_NOTE = "Sellers are responsible for any tax on their own work.";

/** The note while the buyer has no billing country to tax them in. */
export const TAX_NEEDS_ADDRESS_NOTE = "Tax is added once your billing address is saved.";
// #endregion

// #region Product tax codes (#490 (C))
/** A digital product's Stripe tax code by its delivery format (`catalogue.product_format`). */
export const PRODUCT_TAX_CODES = {
	download: "txcd_10000000",
	template: "txcd_10000000",
	preset: "txcd_10000000",
	font: "txcd_10000000",
	bundle: "txcd_10000000",
	source_code: "txcd_10202003",
	ebook: "txcd_10302000",
	course: "txcd_20060258",
} as const satisfies Record<ListingProductFormat, string>;

/**
 * The codes recorded for kinds the platform does not collect on today (#490 (C)), so widening
 * `tax_collected_kinds` needs no second ruling. A session line with no Educate or Advise CREATE
 * category has no code: #490 (e) says stop and ask rather than guess.
 */
export const SERVICE_TAX_CODE = "txcd_20030000";
export const SESSION_TAX_CODES = { educate: "txcd_20060045", advise: "txcd_20060048" } as const;
// #endregion

// #region finance.tax_calculations
/** One taxed line of a calculation: what the buyer pays for it, and its tax (integer minor units). */
export const TaxedLineSchema = z.object({
	amount: minorUnitsNonNeg,
	tax: minorUnitsNonNeg,
});
export type TaxedLine = z.infer<typeof TaxedLineSchema>;

/**
 * A Stripe Tax calculation the checkout recorded for a basket (`finance.tax_calculations`), which
 * `finance.place_wallet_order` takes the tax from. `lines` is keyed by basket line id.
 */
export const TaxCalculationSchema = z.object({
	id: uuid,
	calculationRef: z.string().regex(/^taxcalc_[A-Za-z0-9_]{1,250}$/),
	basketId: uuid,
	ownerType: z.enum(["user", "freelancer", "team", "business", "enterprise"]),
	ownerId: uuid,
	currency,
	inputHash: z.string().min(1).max(128),
	lines: z.record(uuid, TaxedLineSchema),
	taxableMinor: minorUnitsNonNeg,
	taxMinor: minorUnitsNonNeg,
	jurisdiction: z.string().max(160).nullable(),
	buyerTaxId: z.string().max(60).nullable(),
	reverseCharge: z.boolean(),
	expiresAt: timestamp,
	orderId: uuid.nullable(),
	createdAt: timestamp,
});
export type TaxCalculation = z.infer<typeof TaxCalculationSchema>;
// #endregion
