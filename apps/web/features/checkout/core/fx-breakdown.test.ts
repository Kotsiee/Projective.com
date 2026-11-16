import { assertEquals } from "@std/assert";
import {
	chargeWitness,
	conversionBreakdownLines,
	fxBreakdownLines,
	listedReference,
} from "./checkout-model.ts";
import type { BuyerCharge, CheckoutFxQuote, MoneyView } from "../types/checkout-types.ts";

const QUOTE = {
	rateLabel: "1 USD = 0.7874 GBP",
	asOfLabel: "1 Aug 2026 00:00 UTC",
	originCurrency: "USD",
} as const;

Deno.test("a converted charge states the exact figure, the locked rate and the bank caveat", () => {
	assertEquals(fxBreakdownLines("charged", { currency: "USD", display: "US$1,220.00" }, QUOTE), [
		"Charged in USD: US$1,220.00",
		"Rate: 1 USD = 0.7874 GBP (locked 1 Aug 2026 00:00 UTC)",
		"Your bank may apply its own conversion fee.",
	]);
});

Deno.test("a held balance states its own currency and no bank caveat", () => {
	assertEquals(fxBreakdownLines("held", { currency: "USD", display: "US$40.00" }, QUOTE), [
		"Held in USD: US$40.00",
		"Rate: 1 USD = 0.7874 GBP (locked 1 Aug 2026 00:00 UTC)",
	]);
});

Deno.test("a rate for another pair is never printed against this figure", () => {
	assertEquals(fxBreakdownLines("held", { currency: "EUR", display: "€40.00" }, QUOTE), [
		"Held in EUR: €40.00",
	]);
	assertEquals(
		fxBreakdownLines("charged", { currency: "USD", display: "US$5.00" }, {
			rateLabel: null,
			asOfLabel: null,
			originCurrency: null,
		}),
		["Charged in USD: US$5.00", "Your bank may apply its own conversion fee."],
	);
});

const money = (minor: number, currency: string, display: string): MoneyView => ({
	minor,
	currency,
	display,
	origin: null,
});

const CONVERSION: CheckoutFxQuote = {
	quoteId: "7b4e2f10-9c3d-4a5b-8e6f-1a2b3c4d5e6f",
	fromCurrency: "GBP",
	toCurrency: "EUR",
	principal: money(7_692, "GBP", "£76.92"),
	margin: money(115, "GBP", "£1.15"),
	marginBp: 150,
	midRate: 1.17,
	rateLabel: "1 GBP = 1.17 EUR",
	marginLabel: "1.5% conversion margin",
	asOf: "2026-08-01T00:00:00.000Z",
	asOfLabel: "1 Aug 2026 00:00 UTC",
	expiresAt: "2026-11-16T10:30:00.000Z",
};

const CHARGE: BuyerCharge = { ...money(7_807, "GBP", "£78.07"), quote: CONVERSION };
const LISTED = money(9_000, "EUR", "€90.00");

Deno.test("#435: a charge converted into the buyer's currency states the listing, the rate and the margin, not the bank caveat", () => {
	assertEquals(conversionBreakdownLines(CHARGE, LISTED, CONVERSION), [
		"Charged in GBP: £78.07",
		"Listed at €90.00 EUR",
		"Rate: 1 GBP = 1.17 EUR (locked 1 Aug 2026 00:00 UTC)",
		"1.5% conversion margin: £1.15",
	]);
	assertEquals(
		conversionBreakdownLines(CHARGE, LISTED, {
			...CONVERSION,
			marginBp: 0,
			marginLabel: "No conversion margin",
		})
			.at(-1),
		"No conversion margin",
	);
});

Deno.test("#435: the listed reference and the write's witness come from the session, never recomputed", () => {
	const session = { buyerCharge: CHARGE, originTotals: { currency: "EUR", total: LISTED } };
	assertEquals(listedReference(session), { value: LISTED, rateLabel: "1 GBP = 1.17 EUR" });
	assertEquals(chargeWitness(session), {
		expectedCharge: { minor: 7_807, currency: "GBP" },
		fxQuoteId: CONVERSION.quoteId,
	});
	const plain = {
		buyerCharge: { ...LISTED, quote: null },
		originTotals: { currency: "EUR", total: LISTED },
	};
	assertEquals(listedReference(plain), null);
	assertEquals(chargeWitness(plain), {
		expectedCharge: { minor: 9_000, currency: "EUR" },
		fxQuoteId: null,
	});
	assertEquals(chargeWitness({ buyerCharge: null }), { expectedCharge: null, fxQuoteId: null });
});
