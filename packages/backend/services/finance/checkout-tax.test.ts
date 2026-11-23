import { assert, assertEquals } from "@std/assert";
import type { BasketItem, BuyerDetails } from "@projective/types/finance";
import { PRODUCT_TAX_CODES, SELLER_RESPONSIBLE_NOTE } from "@projective/types/finance";
import {
	type CheckoutTaxDeps,
	checkoutTaxFor,
	quoteOf,
	type TaxCalculationInput,
	taxIdOf,
	taxLinesOf,
} from "./checkout-tax.ts";

/**
 * Checkout tax (Decision #490, CK4): the platform collects through Stripe Tax on the kinds
 * `tax_collected_kinds` names, behind `tax_collection_enabled`. Switched off it asks nothing of
 * Stripe and adds nothing; switched on, a taxable line is sent at what the buyer pays for it, with
 * its #490 (C) product tax code, and the summary shows the tax Stripe returns.
 */

// #region Fixtures
const BASKET = "55ed9bd6-ec5d-4937-a473-6140d634d1e9";
const OWNER = { ownerType: "user" as const, ownerId: "6f1e3c2a-0d4b-4a8e-9c71-2b5d8e4f0a13" };

function line(id: string, minor: number, over: Partial<BasketItem> = {}): BasketItem {
	const money = { minor, currency: "GBP", display: `£${minor / 100}`, origin: null };
	return {
		id,
		itemType: "digital_product",
		itemId: `prod-${id}`,
		unitPrice: money,
		quantity: 1,
		discountAmount: { ...money, minor: 0 },
		lineTotal: money,
		isSelectedForCheckout: true,
		savedForLater: false,
		available: true,
		metadata: {},
		...over,
	} as unknown as BasketItem;
}

function buyer(
	kind: "personal" | "business",
	address: Partial<BuyerDetails["personal"]["address"]>,
	taxId = "",
): BuyerDetails {
	const full = {
		line1: "1 High St",
		line2: "",
		city: "London",
		state: "",
		postcode: "N1 9GU",
		country: "GB",
		...address,
	};
	return {
		contextId: kind === "business" ? "business:b1" : "personal",
		contextKind: kind,
		personal: { address: full },
		business: { address: full, taxId },
	} as unknown as BuyerDetails;
}

/** A Stripe Tax calculation as the API answers it, for one rate on every line. */
function calculation(input: TaxCalculationInput, rate: {
	percent: string;
	place: string;
	name: string;
	reason?: string;
}) {
	const pct = Number(rate.percent) / 100;
	const lines = input.lines.map((l) => ({
		reference: l.reference,
		amount: l.amountMinor,
		amount_tax: rate.reason === "reverse_charge" ? 0 : Math.round(l.amountMinor * pct),
		tax_breakdown: [{
			amount: rate.reason === "reverse_charge" ? 0 : Math.round(l.amountMinor * pct),
			jurisdiction: { display_name: rate.place, country: input.customer.country },
			taxability_reason: rate.reason ?? "standard_rated",
			tax_rate_details: { display_name: rate.name, percentage_decimal: rate.percent },
		}],
	}));
	const tax = lines.reduce((sum, l) => sum + l.amount_tax, 0);
	return {
		id: "taxcalc_test_1",
		currency: input.currency.toLowerCase(),
		tax_amount_exclusive: tax,
		expires_at: 1_800_000_000,
		customer_details: { tax_ids: input.customer.taxId ? [input.customer.taxId] : [] },
		line_items: { data: lines },
		tax_breakdown: [{ amount: tax, taxability_reason: rate.reason ?? "standard_rated" }],
	};
}

interface Spy {
	calculations: TaxCalculationInput[];
	recorded: number;
}

function deps(
	on: boolean,
	rate: Parameters<typeof calculation>[1] = {
		percent: "20.0",
		place: "United Kingdom",
		name: "VAT",
	},
	kinds: string[] = ["digital_product"],
): { deps: CheckoutTaxDeps; spy: Spy } {
	const spy: Spy = { calculations: [], recorded: 0 };
	return {
		spy,
		deps: {
			settings: () => Promise.resolve({ enabled: on, kinds: new Set(kinds) }),
			formats: (ids) => Promise.resolve(new Map(ids.map((id) => [id, "download"]))),
			cached: () => Promise.resolve(null),
			calculate: (input) => {
				spy.calculations.push(input);
				return Promise.resolve(quoteOf(calculation(input, rate) as never));
			},
			record: () => {
				spy.recorded++;
				return Promise.resolve();
			},
		},
	};
}

const base = (
	lines: BasketItem[],
	details: BuyerDetails,
	promo: { minor: number; covers: string[] } | null = null,
) => ({
	basketId: BASKET,
	owner: OWNER,
	currency: "GBP",
	lines,
	promo,
	buyer: details,
});
// #endregion

// #region Switch
Deno.test("CK4: switched off, a checkout asks Stripe nothing and adds no tax and no note", async () => {
	const { deps: d, spy } = deps(false);
	const tax = await checkoutTaxFor(base([line("a", 1_000)], buyer("personal", {})), d);
	assertEquals(tax, { quote: null, note: null });
	assertEquals([spy.calculations.length, spy.recorded], [0, 0]);
});
// #endregion

// #region The three buyers
Deno.test("CK4: a GB consumer buying a digital product, switched on, sees the tax line Stripe returns", async () => {
	const { deps: d, spy } = deps(true);
	const tax = await checkoutTaxFor(base([line("a", 1_000)], buyer("personal", {})), d);
	assert(tax.quote, "a tax quote");
	assertEquals([tax.quote.taxMinor, tax.quote.taxableMinor, tax.quote.calculationRef], [
		200,
		1_000,
		"taxcalc_test_1",
	]);
	assertEquals(tax.quote.lines, { a: { amount: 1_000, tax: 200 } });
	assertEquals(tax.note, "United Kingdom VAT 20%");
	assertEquals(spy.calculations[0].lines, [{
		reference: "a",
		amountMinor: 1_000,
		taxCode: "txcd_10000000",
	}]);
	assertEquals([spy.calculations[0].customer.country, spy.calculations[0].customer.taxId], [
		"GB",
		null,
	]);
	assertEquals(spy.recorded, 1);
});

Deno.test("CK4: an EU business with a VAT ID is sent as eu_vat and gets Stripe's reverse charge", async () => {
	const { deps: d, spy } = deps(true, {
		percent: "0.0",
		place: "Germany",
		name: "VAT",
		reason: "reverse_charge",
	});
	const tax = await checkoutTaxFor(
		base(
			[line("a", 1_000)],
			buyer("business", { country: "DE", city: "Berlin", postcode: "10115" }, "DE123456789"),
		),
		d,
	);
	assertEquals(spy.calculations[0].customer.taxId, { type: "eu_vat", value: "DE123456789" });
	assertEquals([tax.quote?.taxMinor, tax.quote?.reverseCharge, tax.quote?.buyerTaxId], [
		0,
		true,
		"DE123456789",
	]);
	assertEquals(tax.note, "Reverse charge: you account for the VAT (Germany)");
});

Deno.test("CK4: a US buyer is sent with their state, and pays the rate Stripe returns", async () => {
	const { deps: d, spy } = deps(true, { percent: "6.25", place: "Texas", name: "Sales Tax" });
	const tax = await checkoutTaxFor(
		base(
			[line("a", 2_000)],
			buyer("personal", { country: "US", state: "TX", city: "Austin", postcode: "78701" }),
		),
		d,
	);
	assertEquals([spy.calculations[0].customer.country, spy.calculations[0].customer.state], [
		"US",
		"TX",
	]);
	assertEquals([tax.quote?.taxMinor, tax.note], [125, "Texas Sales Tax 6.25%"]);
});
// #endregion

// #region The split by kind
Deno.test("CK4: a service line is never taxed by the platform: its seller is responsible, and Stripe is not asked", async () => {
	const { deps: d, spy } = deps(true);
	const tax = await checkoutTaxFor(
		base([line("s", 5_000, { itemType: "one_off_service" })], buyer("personal", {})),
		d,
	);
	assertEquals([tax.quote, tax.note, spy.calculations.length], [null, SELLER_RESPONSIBLE_NOTE, 0]);
});

Deno.test("CK4: beside a taxed product, a service line adds the seller-responsible sentence to the note", async () => {
	const { deps: d, spy } = deps(true);
	const tax = await checkoutTaxFor(
		base(
			[line("a", 1_000), line("s", 5_000, { itemType: "one_off_service" })],
			buyer("personal", {}),
		),
		d,
	);
	assertEquals(spy.calculations[0].lines.map((l) => l.reference), ["a"]);
	assertEquals(tax.note, `United Kingdom VAT 20% · ${SELLER_RESPONSIBLE_NOTE}`);
});

Deno.test("CK4: no billing country yet, so nothing is calculated and the note says why", async () => {
	const { deps: d, spy } = deps(true);
	const tax = await checkoutTaxFor(base([line("a", 1_000)], buyer("personal", { country: "" })), d);
	assertEquals([tax.quote, spy.calculations.length], [null, 0]);
	assertEquals(tax.note, "Tax is added once your billing address is saved.");
});
// #endregion

// #region What each line is taxed on
Deno.test("CK4: a promo is shared over the lines it covers exactly as place_wallet_order shares it", () => {
	const lines = [line("a", 1_000), line("b", 2_001), line("c", 500)];
	const taxable = taxLinesOf(
		lines,
		{ minor: 301, covers: ["a", "b"] },
		new Map([
			["prod-a", "download"],
			["prod-b", "ebook"],
			["prod-c", "source_code"],
		]),
	);
	// a: 301 × 1000 / 3001 = 100; b takes the remainder, 201; c is not covered.
	assertEquals(taxable, [
		{ reference: "a", amountMinor: 900, taxCode: PRODUCT_TAX_CODES.download },
		{ reference: "b", amountMinor: 1_800, taxCode: PRODUCT_TAX_CODES.ebook },
		{ reference: "c", amountMinor: 500, taxCode: PRODUCT_TAX_CODES.source_code },
	]);
});

Deno.test("CK4: the #490 (C) product tax codes, by delivery format", () => {
	assertEquals(PRODUCT_TAX_CODES, {
		download: "txcd_10000000",
		template: "txcd_10000000",
		preset: "txcd_10000000",
		font: "txcd_10000000",
		bundle: "txcd_10000000",
		source_code: "txcd_10202003",
		ebook: "txcd_10302000",
		course: "txcd_20060258",
	});
});

Deno.test("CK4: a VAT ID is typed by its country; one from elsewhere, or none, is not sent", () => {
	assertEquals(taxIdOf("GB", " GB123456789 "), { type: "gb_vat", value: "GB123456789" });
	assertEquals(taxIdOf("FR", "FRXX123456789"), { type: "eu_vat", value: "FRXX123456789" });
	assertEquals(taxIdOf("US", "12-3456789"), null);
	assertEquals(taxIdOf("DE", ""), null);
});
// #endregion
