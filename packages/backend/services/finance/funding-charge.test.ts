import { assertEquals } from "@std/assert";
import type { BuyerDetails, FxConversionQuote } from "@projective/types/finance";
import type { ResolvedOwner } from "./commerce-owner.ts";
import type { LockOptions, QuoteLock, QuoteRequest } from "./fx-quotes.ts";
import { fundingChargeFor, type FundingRequest, setFundingIoForTesting } from "./funding-charge.ts";

const PAYER = "6ce1906f-caab-4708-a19e-df3d8960666e";
const STAGE = "0f0e0d0c-0b0a-4908-8706-050403020100";
const ACTOR = {
	userId: PAYER,
	accessToken: "token",
	contextId: PAYER,
	contextType: "personal" as const,
};

function quote(id: string, over: Partial<FxConversionQuote> = {}): FxConversionQuote {
	return {
		id,
		ownerType: "user",
		ownerId: PAYER,
		purpose: "funding",
		refTable: "project_stages",
		refId: STAGE,
		fromCurrency: "GBP",
		toCurrency: "EUR",
		toMinor: 9_000,
		principalMinor: 7_692,
		spreadBp: 150,
		spreadMinor: 115,
		fromMinor: 7_807,
		fromRate: 1,
		toRate: 1.17,
		midRate: 1.17,
		rateAsOf: "2026-11-17T00:00:00.000Z",
		rateProvider: "probe",
		createdBy: PAYER,
		createdAt: "2026-11-17T10:00:00.000Z",
		expiresAt: "2026-11-17T10:30:00.000Z",
		consumedAt: null,
		...over,
	};
}

const WALLET_QUOTE = "7b4e2f10-9c3d-4a5b-8e6f-1a2b3c4d5e6f";
const CARD_QUOTE = "8c91e936-65a5-4066-93cf-a2789f660c29";

interface World {
	owner?: Partial<ResolvedOwner> | null;
	billing?: string;
	wallets?: Map<string, number>;
	lock?: (request: QuoteRequest) => QuoteLock;
}

async function chargeIn(world: World, request: Partial<FundingRequest> = {}) {
	const locks: { request: QuoteRequest; options?: LockOptions }[] = [];
	setFundingIoForTesting({
		resolveOwner: () =>
			Promise.resolve(
				world.owner === null ? null : {
					key: "personal",
					ownerType: "user",
					ownerId: PAYER,
					actingIsMember: true,
					isEntity: false,
					...world.owner,
				} as ResolvedOwner,
			),
		buyerDetailsFor: () =>
			Promise.resolve({ billingCurrency: world.billing ?? "GBP" } as BuyerDetails),
		walletBalances: () =>
			Promise.resolve(world.wallets ?? new Map([["GBP", 10_000], ["EUR", 2_000]])),
		lockQuote: (_actor, lockRequest, options) => {
			locks.push({ request: lockRequest, options });
			return Promise.resolve(
				world.lock?.(lockRequest) ??
					{
						ok: true,
						quote: quote(lockRequest.purpose === "funding" ? WALLET_QUOTE : CARD_QUOTE, {
							purpose: lockRequest.purpose,
						}),
					},
			);
		},
	});
	try {
		const funding = await fundingChargeFor({
			payer: { scope: "personal", id: PAYER },
			listed: { minor: 9_000, currency: "EUR" },
			refTable: "project_stages",
			refId: STAGE,
			listedAvailableMinor: 2_000,
			...request,
		}, ACTOR);
		return { funding, locks };
	} finally {
		setFundingIoForTesting(undefined);
	}
}

Deno.test("#436: a GBP payer funding a EUR stage is charged the wallet quote in GBP, with a card quote beside it", async () => {
	const { funding, locks } = await chargeIn({});
	assertEquals([funding.charge.minor, funding.charge.currency, funding.charge.quote?.quoteId], [
		7_807,
		"GBP",
		WALLET_QUOTE,
	]);
	assertEquals([funding.listed.minor, funding.listed.currency], [9_000, "EUR"]);
	assertEquals(funding.payIn, {
		selected: "GBP",
		billing: "GBP",
		order: "EUR",
		conversion: true,
		reason: null,
	});
	assertEquals([funding.walletAvailableMinor, funding.cardQuoteId], [10_000, CARD_QUOTE]);
	assertEquals(locks.map((l) => [l.request.purpose, l.request.refTable, l.options?.reuse]), [
		["funding", "project_stages", undefined],
		["escrow_lock", "project_stages", false],
	]);
});

Deno.test("#436: a payer in the stage's own currency is charged its amount and nothing is quoted", async () => {
	const { funding, locks } = await chargeIn({ billing: "EUR" });
	assertEquals([funding.charge.minor, funding.charge.currency, funding.charge.quote], [
		9_000,
		"EUR",
		null,
	]);
	assertEquals([funding.payIn.conversion, funding.walletAvailableMinor, locks.length], [
		false,
		2_000,
		0,
	]);
});

Deno.test("#436: paying in the stage's currency instead keeps the conversion on offer and locks no card quote", async () => {
	const { funding, locks } = await chargeIn({}, { payIn: "eur" });
	assertEquals([funding.charge.currency, funding.charge.quote, funding.cardQuoteId], [
		"EUR",
		null,
		null,
	]);
	assertEquals(funding.payIn, {
		selected: "EUR",
		billing: "GBP",
		order: "EUR",
		conversion: true,
		reason: null,
	});
	assertEquals(locks.map((l) => l.request.purpose), ["funding"]);
});

Deno.test("#436: a refused quote leaves the stage's currency with the door's reason", async () => {
	const { funding } = await chargeIn({
		lock: () => ({ ok: false, reason: "Today's rate isn't in yet." }),
	});
	assertEquals([funding.charge.currency, funding.payIn.conversion, funding.payIn.reason], [
		"EUR",
		false,
		"Today's rate isn't in yet.",
	]);
});

Deno.test("#436: a card quote at another figure is not offered", async () => {
	const { funding } = await chargeIn({
		lock: (request) => ({
			ok: true,
			quote: request.purpose === "funding"
				? quote(WALLET_QUOTE)
				: quote(CARD_QUOTE, { purpose: "escrow_lock", fromMinor: 7_808 }),
		}),
	});
	assertEquals([funding.charge.quote?.quoteId, funding.cardQuoteId], [WALLET_QUOTE, null]);
});

Deno.test("#436: only the payer is quoted — anyone else, or a failed read, sees the stage's amount", async () => {
	for (
		const owner of [null, { ownerId: "2bdebf14-f7dc-40af-acd8-fe22cb9916fd" }, {
			actingIsMember: false,
		}]
	) {
		const { funding, locks } = await chargeIn({ owner });
		assertEquals([funding.charge.currency, funding.payIn.conversion, locks.length], [
			"EUR",
			false,
			0,
		]);
	}
	setFundingIoForTesting({ resolveOwner: () => Promise.reject(new Error("down")) });
	try {
		const funding = await fundingChargeFor({
			payer: { scope: "personal", id: PAYER },
			listed: { minor: 9_000, currency: "EUR" },
			refTable: "project_stages",
			refId: STAGE,
		}, ACTOR);
		assertEquals([funding.charge.minor, funding.charge.currency], [9_000, "EUR"]);
	} finally {
		setFundingIoForTesting(undefined);
	}
});
