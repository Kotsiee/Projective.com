import type { BasketItem, BuyerDetails } from "@projective/types/finance";
import {
	applyDiscounts,
	countryCodeOf,
	DEFAULT_TAX_COLLECTED_KINDS,
	PRODUCT_TAX_CODES,
	SELLER_RESPONSIBLE_NOTE,
	SERVICE_TAX_CODE,
	TAX_COLLECTED_KINDS_PARAM,
	TAX_COLLECTION_PARAM,
	TAX_NEEDS_ADDRESS_NOTE,
} from "@projective/types/finance";
import { getStripe, type Stripe, stripeIdempotencyKey } from "../../core/stripe.ts";
import { getServiceClient, getUserClient } from "../../core/supabase.ts";

/**
 * checkout-tax — tax at checkout through Stripe Tax (Decision #490, MARKETPLACE_BUILD_PROMPTS CK4).
 *
 * The platform collects only on the kinds `tax_collected_kinds` names (digital products, which it
 * supplies), on top of the price (tax-exclusive), behind `tax_collection_enabled` — a platform param
 * that stays OFF until the owner and counsel rule. Switched off, {@link checkoutTaxFor} reads the switch
 * and returns: no Stripe call, no tax, no note, so every checkout is exactly what it was.
 *
 * Switched on, a checkout preview sends Stripe each taxed line at what the buyer pays for it (the promo
 * shared exactly as `finance.place_wallet_order` shares it), with its #490 (C) product tax code and the
 * buyer's billing address (and a business buyer's VAT ID, for reverse charge). The answer is recorded
 * server-side (`finance.record_tax_calculation`, service role), because the order door takes the tax
 * from that record and never from its caller; the same basket, lines and address reuse it rather than
 * pay Stripe again. After commit the order's tax transaction is made from the calculation, and a
 * refunded line's tax is reversed, by {@link syncTaxRecords} — idempotent at Stripe on the order and the
 * line, and recorded once through the service role's doors.
 */

// #region Types
/** The switch and the kinds it covers, as `security.platform_params` holds them. */
export interface TaxSettings {
	enabled: boolean;
	kinds: ReadonlySet<string>;
}

/** One line sent to Stripe: its basket line id, what the buyer pays for it, and its tax code. */
export interface TaxLineInput {
	reference: string;
	amountMinor: number;
	taxCode: string;
}

/** The buyer as Stripe Tax locates them: the billing address, and a VAT ID when one is typed. */
export interface TaxCustomer {
	country: string;
	state: string;
	city: string;
	postcode: string;
	line1: string;
	taxId: { type: string; value: string } | null;
}

/** What {@link calculateTax} sends. */
export interface TaxCalculationInput {
	currency: string;
	lines: TaxLineInput[];
	customer: TaxCustomer;
}

/** What Stripe Tax answered, in the shape the checkout and the order door use. */
export interface TaxQuote {
	calculationRef: string;
	currency: string;
	taxMinor: number;
	taxableMinor: number;
	/** Per basket line id: what it was taxed on, and its tax. */
	lines: Record<string, { amount: number; tax: number }>;
	/** What the tax is ("United Kingdom VAT 20%"), as the checkout shows it; `null` when none is due. */
	jurisdiction: string | null;
	reverseCharge: boolean;
	buyerTaxId: string | null;
	expiresAt: string;
}

/** The checkout's tax: the quote (none while off, or with nothing to tax) and the summary's note. */
export interface CheckoutTax {
	quote: TaxQuote | null;
	note: string | null;
}

/** The answer while the switch is off: nothing at all. */
export const NO_TAX: CheckoutTax = Object.freeze({ quote: null, note: null }) as CheckoutTax;

/** What {@link checkoutTaxFor} asks of the database and Stripe; faked in tests. */
export interface CheckoutTaxDeps {
	settings(): Promise<TaxSettings>;
	/** `catalogue.products.format` for each product id. */
	formats(productIds: readonly string[]): Promise<Map<string, string>>;
	cached(basketId: string, hash: string): Promise<TaxQuote | null>;
	calculate(input: TaxCalculationInput): Promise<TaxQuote>;
	record(
		basketId: string,
		owner: { ownerType: string; ownerId: string },
		hash: string,
		quote: TaxQuote,
	): Promise<void>;
}

/** What a checkout asks tax for: the order's lines, in its own currency, and who is paying. */
export interface CheckoutTaxInput {
	basketId: string;
	owner: { ownerType: string; ownerId: string };
	currency: string;
	lines: readonly BasketItem[];
	/** The applied promo, in the order's currency, and the basket lines it covers. */
	promo: { minor: number; covers: readonly string[] } | null;
	buyer: BuyerDetails;
}
// #endregion

// #region Pure helpers
/** EU member states, whose VAT IDs Stripe takes as `eu_vat` (Greece's prefix is EL, its code GR). */
const EU = new Set([
	"AT",
	"BE",
	"BG",
	"CY",
	"CZ",
	"DE",
	"DK",
	"EE",
	"ES",
	"FI",
	"FR",
	"GR",
	"HR",
	"HU",
	"IE",
	"IT",
	"LT",
	"LU",
	"LV",
	"MT",
	"NL",
	"PL",
	"PT",
	"RO",
	"SE",
	"SI",
	"SK",
]);

/**
 * A business buyer's VAT ID as Stripe Tax takes it, for reverse charge: `gb_vat` in the UK, `eu_vat` in
 * the EU. Anywhere else, or blank, `null` — shortcut: other registrations (CH, NO, AU…) are not sent;
 * add their types when the platform registers there.
 */
export function taxIdOf(
	country: string,
	value: string | null | undefined,
): { type: string; value: string } | null {
	const id = (value ?? "").replace(/\s+/g, "").toUpperCase();
	if (id === "") return null;
	if (country === "GB") return { type: "gb_vat", value: id };
	if (EU.has(country)) return { type: "eu_vat", value: id };
	return null;
}

/** A line's Stripe tax code (#490 (C)); `null` for a kind with no code (a session: #490 (e) asks). */
function taxCodeOf(item: BasketItem, formats: ReadonlyMap<string, string>): string | null {
	if (item.itemType === "digital_product") {
		const format = formats.get(item.itemId) as keyof typeof PRODUCT_TAX_CODES | undefined;
		return PRODUCT_TAX_CODES[format ?? "download"] ?? PRODUCT_TAX_CODES.download;
	}
	if (
		[
			"project_ticket",
			"one_off_project",
			"one_off_task",
			"service_ticket",
			"one_off_service",
			"single_service_task",
			"paid_revision",
		].includes(item.itemType)
	) {
		return SERVICE_TAX_CODE;
	}
	return null;
}

/** What the buyer pays for one line before any promo: its subtotal less its creator discount. */
function lineNet(item: BasketItem): number {
	return applyDiscounts([item], 0).netMinor;
}

/**
 * Each line as Stripe is sent it: what the buyer pays for it — the promo shared over the lines it
 * covers pro rata by what each costs after creator discounts, truncated, the remainder on the last
 * covered line — exactly as `finance.place_wallet_order` shares it, which re-checks every amount.
 * A line that costs nothing is not sent.
 */
export function taxLinesOf(
	lines: readonly BasketItem[],
	promo: { minor: number; covers: readonly string[] } | null,
	formats: ReadonlyMap<string, string>,
): TaxLineInput[] {
	const covers = new Set(promo?.covers ?? []);
	const covered = lines.filter((item) => covers.has(item.id));
	const base = covered.reduce((sum, item) => sum + lineNet(item), 0);
	let remaining = promo?.minor ?? 0;
	let left = covered.length;
	const out: TaxLineInput[] = [];
	for (const item of lines) {
		let share = 0;
		if (covers.has(item.id)) {
			left--;
			share = left === 0 || base === 0
				? remaining
				: Math.floor(((promo?.minor ?? 0) * lineNet(item)) / base);
			remaining -= share;
		}
		const amountMinor = lineNet(item) - share;
		const taxCode = taxCodeOf(item, formats);
		if (!taxCode) {
			throw new Error(
				`No tax code for a ${item.itemType} line (Decision #490 (e)): ask before taxing it.`,
			);
		}
		if (amountMinor > 0) out.push({ reference: item.id, amountMinor, taxCode });
	}
	return out;
}

/** The buyer's billing address and VAT ID from the active block of their details; `null` with no country. */
function customerOf(buyer: BuyerDetails): TaxCustomer | null {
	const business = buyer.contextKind === "business";
	const address = business ? buyer.business.address : buyer.personal.address;
	const country = countryCodeOf(address?.country);
	if (!country) return null;
	return {
		country,
		state: address.state ?? "",
		city: address.city ?? "",
		postcode: address.postcode ?? "",
		line1: address.line1 ?? "",
		taxId: business ? taxIdOf(country, buyer.business.taxId) : null,
	};
}

/** "20.0" → "20", "6.250" → "6.25". */
function percent(decimal: string | null | undefined): string {
	return String(Number(decimal ?? "0"));
}

/** Map Stripe's calculation (line items expanded) to a {@link TaxQuote}. Pure; exported for tests. */
export function quoteOf(calc: Stripe.Tax.Calculation): TaxQuote {
	const lines: TaxQuote["lines"] = {};
	const names = new Set<string>();
	let reverseCharge = false;
	let reverseWhere: string | null = null;
	for (const item of calc.line_items?.data ?? []) {
		if (item.reference) lines[item.reference] = { amount: item.amount, tax: item.amount_tax };
		for (const part of item.tax_breakdown ?? []) {
			if (part.taxability_reason === "reverse_charge") {
				reverseCharge = true;
				reverseWhere ??= part.jurisdiction?.display_name ?? null;
			} else if (part.amount > 0 && part.tax_rate_details) {
				names.add(
					`${part.jurisdiction.display_name} ${part.tax_rate_details.display_name} ${
						percent(part.tax_rate_details.percentage_decimal)
					}%`,
				);
			}
		}
	}
	const jurisdiction = names.size > 0
		? [...names].join(" + ")
		: reverseCharge
		? `Reverse charge: you account for the VAT${reverseWhere ? ` (${reverseWhere})` : ""}`
		: null;
	const taxableMinor = Object.values(lines).reduce((sum, l) => sum + l.amount, 0);
	return {
		calculationRef: calc.id ?? "",
		currency: calc.currency.toUpperCase(),
		taxMinor: calc.tax_amount_exclusive,
		taxableMinor,
		lines,
		jurisdiction: jurisdiction ? jurisdiction.slice(0, 160) : null,
		reverseCharge,
		buyerTaxId: calc.customer_details?.tax_ids?.[0]?.value ?? null,
		expiresAt: new Date((calc.expires_at ?? Math.floor(Date.now() / 1000) + 86_400) * 1000)
			.toISOString(),
	};
}

/** A stable key for one request: the same lines, address and VAT ID reuse one calculation. */
async function hashOf(input: TaxCalculationInput): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(input));
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
	return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Join the parts of a note that exist; `null` with none. */
function noteOf(...parts: (string | null)[]): string | null {
	const note = parts.filter(Boolean).join(" · ");
	return note ? note.slice(0, 160) : null;
}
// #endregion

// #region The one calculation
/**
 * The ONE Stripe Tax calculation on this platform — a checkout preview's, and LEGAL LG8's fee line.
 * Tax-exclusive, the platform the liable party (its head office and registrations are the owner's, in
 * the Dashboard), the billing address the location. Throws on a Stripe failure; the caller decides.
 */
export async function calculateTax(stripe: Stripe, input: TaxCalculationInput): Promise<TaxQuote> {
	const { customer } = input;
	const calc = await stripe.tax.calculations.create({
		currency: input.currency.toLowerCase(),
		line_items: input.lines.map((line) => ({
			amount: line.amountMinor,
			reference: line.reference,
			tax_code: line.taxCode,
			tax_behavior: "exclusive",
		})),
		customer_details: {
			address: {
				country: customer.country,
				...(customer.state ? { state: customer.state } : {}),
				...(customer.city ? { city: customer.city } : {}),
				...(customer.postcode ? { postal_code: customer.postcode } : {}),
				...(customer.line1 ? { line1: customer.line1 } : {}),
			},
			address_source: "billing",
			...(customer.taxId
				? { tax_ids: [customer.taxId as Stripe.Tax.CalculationCreateParams.CustomerDetails.TaxId] }
				: {}),
		},
		expand: ["line_items"],
	});
	return quoteOf(calc);
}
// #endregion

// #region Checkout
/**
 * The checkout's tax for these lines (in the order's own currency). Off: {@link NO_TAX}, asking Stripe
 * nothing. On: the kinds the platform does not collect on add {@link SELLER_RESPONSIBLE_NOTE}; with a
 * taxed line and a billing country, the recorded (or reused) calculation and its note.
 */
export async function checkoutTaxFor(
	input: CheckoutTaxInput,
	deps: CheckoutTaxDeps,
): Promise<CheckoutTax> {
	const settings = await deps.settings();
	if (!settings.enabled) return NO_TAX;
	const taxable = input.lines.filter((item) => settings.kinds.has(item.itemType));
	const sellers = input.lines.some((item) => !settings.kinds.has(item.itemType))
		? SELLER_RESPONSIBLE_NOTE
		: null;
	if (taxable.length === 0) return { quote: null, note: sellers };
	const customer = customerOf(input.buyer);
	if (!customer) return { quote: null, note: noteOf(TAX_NEEDS_ADDRESS_NOTE, sellers) };
	const formats = await deps.formats(
		taxable.filter((item) => item.itemType === "digital_product").map((item) => item.itemId),
	);
	const lines = taxLinesOf(taxable, input.promo, formats);
	if (lines.length === 0) return { quote: null, note: sellers };
	const request: TaxCalculationInput = { currency: input.currency.toUpperCase(), lines, customer };
	const hash = await hashOf(request);
	let quote = await deps.cached(input.basketId, hash);
	if (!quote) {
		quote = await deps.calculate(request);
		await deps.record(input.basketId, input.owner, hash, quote);
	}
	return { quote, note: noteOf(quote.jurisdiction, sellers) };
}

/** The live answers {@link checkoutTaxFor} uses: the caller's reads, the server's record, Stripe. */
export function liveTaxDeps(accessToken: string): CheckoutTaxDeps {
	return {
		settings: () => taxSettings(accessToken),
		formats: async (ids) => {
			if (ids.length === 0) return new Map();
			const { data, error } = await getUserClient(accessToken).schema("catalogue").from("products")
				.select("id, format").in("id", [...ids]);
			if (error) throw new Error(`catalogue.products format read failed: ${error.message}`);
			return new Map((data ?? []).map((row) => [String(row.id), String(row.format)]));
		},
		cached: async (basketId, hash) => {
			const { data, error } = await getServiceClient().schema("finance")
				.rpc("tax_calculation_for", { p_basket_id: basketId, p_input_hash: hash }).maybeSingle();
			if (error) throw new Error(`finance.tax_calculation_for failed: ${error.message}`);
			return data ? quoteOfRow(data as TaxCalculationRow) : null;
		},
		calculate: (input) => calculateTax(getStripe(), input),
		record: async (basketId, owner, hash, quote) => {
			const { error } = await getServiceClient().schema("finance").rpc("record_tax_calculation", {
				p_calculation_ref: quote.calculationRef,
				p_basket_id: basketId,
				p_owner_type: owner.ownerType,
				p_owner_id: owner.ownerId,
				p_currency: quote.currency,
				p_input_hash: hash,
				p_lines: quote.lines,
				p_tax_minor: quote.taxMinor,
				p_jurisdiction: quote.jurisdiction,
				p_buyer_tax_id: quote.buyerTaxId,
				p_reverse_charge: quote.reverseCharge,
				p_expires_at: quote.expiresAt,
			});
			if (error) throw new Error(`finance.record_tax_calculation failed: ${error.message}`);
		},
	};
}

/** The switch and its kinds, read as the caller (any signed-in caller may read platform params). */
export async function taxSettings(accessToken: string): Promise<TaxSettings> {
	const { data, error } = await getUserClient(accessToken).schema("security").from(
		"platform_params",
	)
		.select("key, value").in("key", [TAX_COLLECTION_PARAM, TAX_COLLECTED_KINDS_PARAM]);
	if (error) throw new Error(`security.platform_params read failed: ${error.message}`);
	const value = (key: string) => (data ?? []).find((row) => row.key === key)?.value;
	const kinds = value(TAX_COLLECTED_KINDS_PARAM);
	return {
		enabled: value(TAX_COLLECTION_PARAM) === true,
		kinds: new Set(Array.isArray(kinds) ? kinds.map(String) : DEFAULT_TAX_COLLECTED_KINDS),
	};
}

/** A `finance.tax_calculations` row, as the cache read returns it. */
interface TaxCalculationRow {
	calculation_ref: string;
	currency: string;
	lines: Record<string, { amount: number; tax: number }>;
	taxable_minor: number;
	tax_minor: number;
	jurisdiction: string | null;
	buyer_tax_id: string | null;
	reverse_charge: boolean;
	expires_at: string;
}

function quoteOfRow(row: TaxCalculationRow): TaxQuote {
	return {
		calculationRef: row.calculation_ref,
		currency: row.currency,
		taxMinor: Number(row.tax_minor),
		taxableMinor: Number(row.taxable_minor),
		lines: row.lines,
		jurisdiction: row.jurisdiction,
		reverseCharge: row.reverse_charge,
		buyerTaxId: row.buyer_tax_id,
		expiresAt: row.expires_at,
	};
}
// #endregion

// #region After commit: transactions and reversals
/** One row of `finance.tax_records_due`. */
interface TaxRecordDue {
	kind: "transaction" | "reversal";
	order_id: string;
	line_id: string | null;
	reference: string;
	calculation_ref: string | null;
	transaction_ref: string | null;
	line_ref: string | null;
	amount_minor: number;
	tax_minor: number;
	currency: string;
}

/** What one sweep did. */
export interface TaxSync {
	transactions: number;
	reversals: number;
	failed: number;
}

/**
 * Make at Stripe what the ledger owes it, and record each once: a tax transaction from each order's
 * calculation (`reference` the order's), then a reversal of each refunded line's tax. Each call is
 * idempotent at Stripe on the order or the line, and each record is write-once (PX409 on a second
 * one), so a sweep that runs twice, or races the inline call after a placement, makes nothing twice.
 * A failure is counted and left for the next sweep.
 */
export async function syncTaxRecords(limit = 50, stripe: Stripe = getStripe()): Promise<TaxSync> {
	const db = getServiceClient().schema("finance");
	const { data, error } = await db.rpc("tax_records_due", { p_limit: limit });
	if (error) throw new Error(`finance.tax_records_due failed: ${error.message}`);
	const out: TaxSync = { transactions: 0, reversals: 0, failed: 0 };
	for (const due of (data ?? []) as TaxRecordDue[]) {
		try {
			if (due.kind === "transaction" && due.calculation_ref) {
				const txn = await stripe.tax.transactions.createFromCalculation({
					calculation: due.calculation_ref,
					reference: due.reference,
					expand: ["line_items"],
					metadata: { projective_order_id: due.order_id },
				}, { idempotencyKey: stripeIdempotencyKey("tax_transaction", due.order_id) });
				const lineRefs = Object.fromEntries(
					(txn.line_items?.data ?? []).map((item) => [item.reference, item.id]),
				);
				const recorded = await db.rpc("record_tax_transaction", {
					p_order_id: due.order_id,
					p_transaction_ref: txn.id,
					p_line_refs: lineRefs,
				});
				if (recorded.error) throw new Error(recorded.error.message);
				out.transactions++;
			} else if (due.kind === "reversal" && due.line_id && due.transaction_ref && due.line_ref) {
				const reversal = await stripe.tax.transactions.createReversal({
					mode: "partial",
					original_transaction: due.transaction_ref,
					reference: due.reference,
					line_items: [{
						original_line_item: due.line_ref,
						reference: due.line_id,
						amount: -Number(due.amount_minor),
						amount_tax: -Number(due.tax_minor),
					}],
					metadata: { projective_order_line_id: due.line_id },
				}, { idempotencyKey: stripeIdempotencyKey("tax_reversal", due.line_id) });
				const recorded = await db.rpc("record_tax_reversal", {
					p_line_id: due.line_id,
					p_reversal_ref: reversal.id,
				});
				if (recorded.error) throw new Error(recorded.error.message);
				out.reversals++;
			}
		} catch (failure) {
			out.failed++;
			console.error(
				"[tax:sync]",
				due.kind,
				due.order_id,
				failure instanceof Error ? failure.message : failure,
			);
		}
	}
	return out;
}
// #endregion
