import { assertEquals } from "@std/assert";
import type { CheckoutFxQuote, FundingCharge, MoneyView } from "@projective/types/finance";
import { fundingConversionOf } from "./funding-charge.ts";
import { stageFundingPlan } from "./stage-funding.ts";

const money = (minor: number, currency: string, display: string): MoneyView => ({
	minor,
	currency,
	display,
	origin: null,
});

const QUOTE: CheckoutFxQuote = {
	quoteId: "7b4e2f10-9c3d-4a5b-8e6f-1a2b3c4d5e6f",
	fromCurrency: "GBP",
	toCurrency: "EUR",
	principal: money(7_692, "GBP", "£76.92"),
	margin: money(115, "GBP", "£1.15"),
	marginBp: 150,
	midRate: 1.17,
	rateLabel: "1 GBP = 1.17 EUR",
	marginLabel: "1.5% conversion margin",
	asOf: "2026-11-17T00:00:00.000Z",
	asOfLabel: "17 Nov 2026 00:00 UTC",
	expiresAt: "2026-11-17T10:30:00.000Z",
};

function converted(over: Partial<FundingCharge> = {}): FundingCharge {
	return {
		charge: { ...money(7_807, "GBP", "£78.07"), quote: QUOTE },
		listed: money(9_000, "EUR", "€90.00"),
		payIn: { selected: "GBP", billing: "GBP", order: "EUR", conversion: true, reason: null },
		walletAvailableMinor: 10_000,
		cardQuoteId: "8c91e936-65a5-4066-93cf-a2789f660c29",
		...over,
	};
}

function listed(over: Partial<FundingCharge["payIn"]> = {}): FundingCharge {
	return {
		charge: { ...money(9_000, "EUR", "€90.00"), quote: null },
		listed: money(9_000, "EUR", "€90.00"),
		payIn: {
			selected: "EUR",
			billing: "EUR",
			order: "EUR",
			conversion: false,
			reason: null,
			...over,
		},
		walletAvailableMinor: 2_000,
		cardQuoteId: null,
	};
}

Deno.test("#436: a converted funding states what it is listed at, the margin and the other currency", () => {
	assertEquals(fundingConversionOf(converted()), {
		listed: "Listed at €90.00 EUR at 1 GBP = 1.17 EUR",
		margin: "Includes the 1.5% conversion margin: £1.15",
		switchTo: { currency: "EUR", label: "Pay in EUR instead" },
		reason: null,
	});
	const free = converted({
		charge: {
			...money(7_692, "GBP", "£76.92"),
			quote: { ...QUOTE, marginBp: 0, marginLabel: "No conversion margin" },
		},
	});
	assertEquals(fundingConversionOf(free).margin, "No conversion margin");
});

Deno.test("#436: paying in the project's currency offers the payer's own back; one currency offers nothing", () => {
	assertEquals(
		fundingConversionOf(listed({ billing: "GBP", conversion: true })).switchTo,
		{ currency: "GBP", label: "Pay in GBP instead" },
	);
	assertEquals(fundingConversionOf(listed()), {
		listed: null,
		margin: null,
		switchTo: null,
		reason: null,
	});
	assertEquals(
		fundingConversionOf(listed({ billing: "GBP", reason: "Today's rate isn't in yet." })).reason,
		"Today's rate isn't in yet.",
	);
});

Deno.test("#436: a converted stage is judged in the charge's currency, and its card needs its own quote", () => {
	const stage = {
		projectId: "00000000-0000-4000-8000-000000000001",
		stageId: "00000000-0000-4000-8000-000000000002",
		stageName: "Discovery",
		stageStatus: "open",
		fundable: true,
		ticketCount: 1,
		unpricedCount: 0,
		amountMinor: 9_000,
		currency: "EUR",
		payer: { scope: "personal" as const, id: "00000000-0000-4000-8000-000000000003" },
		walletBalanceMinor: 0,
	};
	const plan = stageFundingPlan(stage, converted());
	assertEquals([plan.amountLabel, plan.methods], ["£78.07", ["wallet", "card"]]);
	assertEquals(plan.walletLabel.includes("£100.00"), true);
	assertEquals(stageFundingPlan(stage, converted({ walletAvailableMinor: 7_806 })).methods, [
		"card",
	]);
	assertEquals(stageFundingPlan(stage, converted({ cardQuoteId: null })).methods, ["wallet"]);
	assertEquals(stageFundingPlan(stage, listed()).methods, ["card"]);
});
