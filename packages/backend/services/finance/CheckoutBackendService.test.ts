import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
	availableProviders,
	type BasketItem,
	type BuyerDetails,
	type CardPaymentHandoff,
	type CheckoutResult,
	type CheckoutSessionContext,
	type CreateCheckout,
	formatMoney,
	type MoneyView,
	type SavedCard,
	type SpendLimitBlock,
} from "@projective/types/finance";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import {
	CheckoutBackendService,
	type CheckoutIo,
	payingWalletOf,
	setCheckoutIoForTesting,
	walletStandingOf,
} from "./CheckoutBackendService.ts";
import type { BasketQuery } from "./basket-query.ts";
import { type MoneyProjector, projectorFor } from "./commerce-money.ts";
import { payingWallets, type ResolvedOwner } from "./commerce-owner.ts";
import { type BasketView, PROMO_NOT_APPLICABLE, promoExcludedLine } from "./live-basket.ts";
import { PROCESSOR_ANSWERS } from "./PaymentBackendService.ts";

/**
 * The checkout service: "wallet covers" counts only the wallet that pays (FCA N7), and a payment
 * refuses before any money is touched (FINANCE_AUDIT CO8) — the charge the buyer was shown, in the
 * listings' own currency, is what the price check compares (C8), a promo beside an escrow line never
 * reaches Stripe, an attempt key replays the order it placed, and a card id resolves only in the
 * owner's own list. `create` runs over faked reads and writes (`setCheckoutIoForTesting`), so every
 * money call is a spy.
 */

// #region Wallet fixtures
/** An owner holding GBP 50 and EUR 100, reading the checkout in EUR. */
const WALLETS = payingWallets([
	{ owner_type: "user", currency: "GBP", balance_cents: 5_000 },
	{ owner_type: "user", currency: "EUR", balance_cents: 10_000 },
], "user");

const MONEY = projectorFor("EUR", {
	base: "EUR",
	rates: { EUR: 1, GBP: 1.15 },
	asOf: "2026-10-31T00:00:00.000Z",
	provider: "seed",
	stale: false,
});

/** A charge in the listing's own currency, as `chargeFor` answers it. */
function gbp(minor: number): MoneyView {
	return { minor, currency: "GBP", display: formatMoney(minor, "GBP"), origin: null };
}

function walletRoute(charge: MoneyView | null) {
	return availableProviders({
		ownerType: "user",
		actingIsMember: true,
		wallet: payingWalletOf(WALLETS, charge),
		savedCards: [],
		kybStatus: null,
		verificationTier: null,
	}).find((entry) => entry.provider === "wallet");
}
// #endregion

// #region Wallet covers (N7)
Deno.test("a GBP 80 item is not offered the wallet: the GBP wallet holds 50, and the EUR 100 never counts", () => {
	const route = walletRoute(gbp(8_000));
	assertEquals(route?.available, false);
	assert(route?.reason?.includes("GBP wallet") && !route.reason.includes("€"));
	const standing = walletStandingOf(payingWalletOf(WALLETS, gbp(8_000)), WALLETS, MONEY);
	assertEquals(
		[
			standing.available.minor,
			standing.shortfall.minor,
			standing.shortfall.currency,
			standing.covers,
		],
		[5_000, 3_000, "GBP", false],
	);
});

Deno.test("a GBP 40 item is offered the wallet, and the standing covers it", () => {
	assertEquals(walletRoute(gbp(4_000))?.available, true);
	const standing = walletStandingOf(payingWalletOf(WALLETS, gbp(4_000)), WALLETS, MONEY);
	assertEquals([standing.available.currency, standing.shortfall.minor, standing.covers], [
		"GBP",
		0,
		true,
	]);
});

Deno.test("an item in a currency with no wallet has nothing to pay from", () => {
	assertEquals(payingWalletOf(WALLETS, { ...gbp(100), currency: "USD" })?.availableMinor, 0);
});

Deno.test("lines in two currencies have no paying wallet: refused, and never read as covering", () => {
	assertEquals(payingWalletOf(WALLETS, null), null);
	assertEquals(walletRoute(null)?.available, false);
	const standing = walletStandingOf(null, WALLETS, MONEY);
	assertEquals([standing.available.minor, standing.available.currency, standing.covers], [
		10_000,
		"EUR",
		false,
	]);
});
// #endregion

// #region Checkout fixtures
const OWNER = "6f1e3c2a-0d4b-4a8e-9c71-2b5d8e4f0a13";
const BASKET = "55ed9bd6-ec5d-4937-a473-6140d634d1e9";
const ACTOR: ReadActor = {
	userId: OWNER,
	contextId: OWNER,
	contextType: "personal",
	accessToken: "test-access-token",
};
const QUERY: BasketQuery = {};

/** A line as the test states it: an amount in the listing's own currency, and what kind it is. */
interface Line {
	id: string;
	minor: number;
	currency: string;
	kind?: BasketItem["itemType"];
	ticketId?: string;
	selected?: boolean;
}

/** The facts one test's checkout reads; every money call it makes is recorded. */
interface World {
	lines: Line[];
	/** The code attached to the basket, as typed. */
	promoCode?: string | null;
	cards?: SavedCard[];
	/** The paying wallets' Available, per currency. */
	wallets?: Map<string, number>;
	/** The order an attempt key already placed. */
	prior?: {
		order_id: string;
		reference: string;
		charged_minor: number;
		currency: string;
		replayed: boolean;
	};
	chargeCard?: CheckoutIo["chargeCard"];
}

/** What a test's checkout did: each read of the basket, each standing asked for, each money call. */
interface Spy {
	reads: number;
	standings: string[];
	charges: Parameters<CheckoutIo["chargeCard"]>[0][];
	orders: { door: string; args: Record<string, unknown> }[];
}

/** USD per GBP, read at the moment each basket read is made — a test moves it to move the rate. */
let usdPerGbp = 1.25;

function projector(display: string): MoneyProjector {
	return projectorFor(display, {
		base: "GBP",
		rates: { GBP: 1, USD: usdPerGbp },
		asOf: "2026-10-31T00:00:00.000Z",
		provider: "seed",
		stale: false,
	});
}

function owner(display: string): ResolvedOwner {
	return {
		key: "personal",
		ownerType: "user",
		ownerId: OWNER,
		name: "Ada Lovelace",
		handle: null,
		avatar: null,
		actingIsMember: true,
		isMember: true,
		kybStatus: null,
		verificationTier: null,
		display,
		isEntity: false,
		invoicingMode: null,
		billingDay: null,
		billing: null,
		person: null,
		departments: [],
		platformFeeBp: 500,
	};
}

/** A line read in `money`'s display currency, converted the way the basket read converts it. */
function itemOf(money: MoneyProjector, line: Line): BasketItem {
	const unitPrice = money.price(line.minor, line.currency);
	return {
		id: line.id,
		basketId: BASKET,
		itemType: line.kind ?? "digital_product",
		itemId: line.id,
		stageId: line.ticketId ? "stg-design" : null,
		ticketId: line.ticketId ?? null,
		revisionId: null,
		title: line.ticketId ? "Logo ticket" : "Brush pack",
		subtitle: null,
		unitPrice,
		quantity: 1,
		discountCode: null,
		discountAmount: money.derived(0),
		lineTotal: money.derived(unitPrice.minor),
		isSelectedForCheckout: line.selected ?? true,
		savedForLater: false,
		destinationEmail: "ada@example.com",
		metadata: {},
		createdAt: "2026-10-30T09:00:00.000Z",
		updatedAt: "2026-10-30T09:00:00.000Z",
		thumbnail: null,
		sellerHandle: null,
		sellerName: null,
		href: null,
		originalPrice: null,
		licence: null,
		format: null,
		scheduledAt: null,
		scheduledLabel: null,
		timezone: null,
		stageLabel: null,
		seats: null,
		available: true,
		unavailableReason: null,
	};
}

/** `SAVE10` takes 10% off — except beside an escrow line, which no code discounts. */
function promoOf(code: string | null, lines: readonly BasketItem[], money: MoneyProjector) {
	if (!code) return null;
	if (promoExcludedLine(lines)) {
		return {
			code,
			label: code,
			valid: false,
			amount: money.derived(0),
			message: PROMO_NOT_APPLICABLE,
		};
	}
	const net = lines.reduce((sum, line) => sum + line.unitPrice.minor, 0);
	return {
		code,
		label: "Save 10%",
		valid: true,
		amount: money.derived(Math.round(net / 10)),
		message: null,
	};
}

const BUYER = {
	contextId: "personal",
	contextKind: "personal",
	delivery: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
	personal: {
		name: "Ada Lovelace",
		email: "ada@example.com",
		address: { line1: "1 Analytical Way", city: "London", postcode: "N1 9GU", country: "GB" },
	},
	business: {},
	invoicing: {},
	billingCurrency: "GBP",
	savedAt: "2026-10-30T09:00:00.000Z",
} as unknown as BuyerDetails;

const ALLOWED: SpendLimitBlock = {
	applies: false,
	verdict: "allowed",
	reason: null,
	cap: null,
	spent: gbp(0),
	remaining: null,
	periodLabel: null,
	gate: null,
	request: null,
	requestRef: null,
	approved: false,
};

function card(id: string, over: Partial<SavedCard> = {}): SavedCard {
	return {
		id,
		ownerType: "user",
		ownerId: OWNER,
		paymentMethodId: null,
		stripePaymentMethodId: `pm_${id}`,
		brand: "visa",
		last4: "4242",
		expMonth: 12,
		expYear: 2030,
		cardholderName: null,
		binNumber: null,
		isBusinessCard: false,
		isDefault: true,
		createdByUserId: OWNER,
		createdAt: "2026-10-01T00:00:00.000Z",
		isExpired: false,
		...over,
	};
}

/** The card rails' hand-off for a charge: a PaymentIntent the browser confirms. */
function handoff(
	input: Parameters<CheckoutIo["chargeCard"]>[0],
): ServiceResult<CardPaymentHandoff> {
	return ok({
		paymentId: "0d6c1f9a-6a7e-4f3b-8a52-3b1f0e9c7d21",
		purpose: "wallet_topup",
		status: "requires_payment",
		lockStatus: "not_applicable",
		amount: {
			minor: input.amountMinor,
			currency: input.currency,
			display: formatMoney(input.amountMinor, input.currency),
			origin: null,
		},
		providerRef: "pi_test_checkout",
		clientSecret: "pi_test_checkout_secret_test",
		publishableKey: "pk_test_XXXX",
		mode: "test",
		replayed: false,
		confirmation: "collect",
	}, { status: 201 });
}

/** Run `run` against a checkout reading `world`, every read and write faked; the live I/O comes back after. */
async function withCheckout(world: World, run: (spy: Spy) => Promise<void>): Promise<void> {
	const spy: Spy = { reads: 0, standings: [], charges: [], orders: [] };
	setCheckoutIoForTesting({
		readBasket: (query) => {
			spy.reads++;
			const money = projector((query.display ?? "GBP").toUpperCase());
			const items = world.lines.map((line) => itemOf(money, line));
			const view = {
				owner: owner(money.display),
				money,
				baskets: [],
				basket: { id: BASKET, items } as unknown as BasketView["basket"],
				promo: null,
				promoCode: world.promoCode ?? null,
				account: {} as BasketView["account"],
				resolvePromo: (code: string | null, lines: readonly BasketItem[]) =>
					Promise.resolve(promoOf(code, lines, money)),
				groupsFor: () => [],
			} as BasketView;
			return Promise.resolve({ ok: true as const, message: null, value: view });
		},
		listCards: () => Promise.resolve(world.cards ?? []),
		walletBalances: () =>
			Promise.resolve(world.wallets ?? new Map([["GBP", 100_000], ["USD", 100_000]])),
		onAccountStanding: (_owner, currency) => {
			spy.standings.push(currency);
			return Promise.resolve(null);
		},
		details: () =>
			Promise.resolve({ buyer: BUYER, billingContexts: [], invoicing: BUYER.invoicing }),
		spendLimit: () => Promise.resolve(ALLOWED),
		spendPosition: () => Promise.resolve({ spendLimit: ALLOWED, businessAccount: null }),
		placedOrder: () => Promise.resolve(world.prior ?? null),
		chargeCard: (input, actor) => {
			spy.charges.push(input);
			return world.chargeCard ? world.chargeCard(input, actor) : Promise.resolve(handoff(input));
		},
		placeOrder: (door, args) => {
			spy.orders.push({ door, args });
			return Promise.resolve({
				data: {
					order_id: "8a1d2c3b-4e5f-4a6b-9c7d-0e1f2a3b4c5d",
					reference: "PJ-1001",
					charged_minor: Number(args.p_expected_minor ?? args.p_amount),
					currency: String(args.p_currency),
					replayed: false,
				},
				error: null,
			});
		},
		processorConnected: () => true,
	});
	try {
		await run(spy);
	} finally {
		setCheckoutIoForTesting(null);
		usdPerGbp = 1.25;
	}
}

/** A charge for `world`'s lines, as a page that read them would send it. */
function payFor(world: World, over: Partial<CreateCheckout> = {}): CreateCheckout {
	return {
		basketId: BASKET,
		ownerType: "user",
		ownerId: OWNER,
		itemIds: world.lines.filter((line) => line.selected !== false).map((line) => line.id),
		provider: "wallet",
		cardId: null,
		promoCode: null,
		currency: "GBP",
		expectedCharge: null,
		processingContributionMinor: 0,
		idempotencyKey: "co_test_attempt_1",
		...over,
	};
}

async function sessionOf(): Promise<CheckoutSessionContext> {
	const read = await CheckoutBackendService.session(QUERY, ACTOR);
	assert(read.ok && read.data, read.message);
	return read.data.session;
}

async function create(
	input: CreateCheckout,
	dev: Parameters<typeof CheckoutBackendService.create>[3] = {},
): Promise<CheckoutResult> {
	const res = await CheckoutBackendService.create(input, QUERY, ACTOR, dev);
	assert(res.ok && res.data, res.message);
	return res.data.result;
}

const product = (id: string, minor: number, currency = "GBP"): Line => ({ id, minor, currency });
// #endregion

// #region The charge is what is checked (C8)
Deno.test("C8: a moved rate moves the display total, not the charge, and the charge the buyer saw still pays", async () => {
	const world: World = { lines: [product("line-usd", 5_000, "USD")] };
	await withCheckout(world, async (spy) => {
		const before = await sessionOf();
		assertEquals([before.charge?.minor, before.charge?.currency, before.totals.total.minor], [
			5_000,
			"USD",
			4_000,
		]);
		usdPerGbp = 1.4;
		const after = await sessionOf();
		assert(after.totals.total.minor !== before.totals.total.minor, "the display total moved");
		assertEquals(after.charge?.minor, before.charge?.minor);

		const result = await create(
			payFor(world, { expectedCharge: { minor: 5_000, currency: "USD" } }),
		);
		assertEquals(result.status, "succeeded");
		assertEquals(
			spy.orders.map(({ door, args }) => [door, args.p_currency, args.p_expected_minor]),
			[
				["place_wallet_order", "USD", 5_000],
			],
		);
	});
});

Deno.test("price_changed: a charge that moved since the buyer saw it is refused before any money call", async () => {
	const world: World = { lines: [product("line-usd", 5_500, "USD")] };
	await withCheckout(world, async (spy) => {
		const result = await create(
			payFor(world, { expectedCharge: { minor: 5_000, currency: "USD" } }),
		);
		assertEquals([result.status, result.blockers[0]?.code], ["failed", "price_changed"]);
		assertStringIncludes(result.message, formatMoney(5_500, "USD"));
		assertEquals([spy.orders.length, spy.charges.length], [0, 0]);
	});
});

Deno.test("price_changed: the same amount in another currency is not the charge the buyer saw", async () => {
	const world: World = { lines: [product("line-usd", 5_000, "USD")] };
	await withCheckout(world, async (spy) => {
		const result = await create(
			payFor(world, { expectedCharge: { minor: 5_000, currency: "GBP" } }),
		);
		assertEquals(result.blockers[0]?.code, "price_changed");
		assertEquals(spy.orders.length, 0);
	});
});

Deno.test("a page that sends no expected charge is told to reload, and is never charged", async () => {
	const world: World = { lines: [product("line-gbp", 4_000)] };
	await withCheckout(world, async (spy) => {
		const stale = payFor(world);
		delete stale.expectedCharge;
		const result = await create(stale);
		assertEquals([result.status, result.blockers[0]?.code], ["failed", "price_changed"]);
		assertStringIncludes(result.message, "Reload");
		assertEquals([spy.orders.length, spy.charges.length], [0, 0]);
	});
});

Deno.test("N23: the on-account standing is read in the charge's currency, never the display one", async () => {
	await withCheckout({ lines: [product("line-usd", 5_000, "USD")] }, async (spy) => {
		await sessionOf();
		assertEquals(spy.standings, ["USD"]);
	});
});
// #endregion

// #region Promo codes (CO8)
Deno.test("promo mismatch: a code that changed while the buyer paid is refused, never charged", async () => {
	const world: World = { lines: [product("line-gbp", 5_000)], promoCode: "SAVE10" };
	await withCheckout(world, async (spy) => {
		const session = await sessionOf();
		assertEquals([session.promo?.valid, session.charge?.minor], [true, 4_500]);
		const expectedCharge = { minor: 4_500, currency: "GBP" };

		const dropped = await create(payFor(world, { expectedCharge, promoCode: null }));
		assertEquals(dropped.blockers[0]?.code, "price_changed");
		assertStringIncludes(dropped.message, "promo code changed");
		assertEquals(spy.orders.length, 0);

		const applied = await create(payFor(world, { expectedCharge, promoCode: "save10" }));
		assertEquals(applied.status, "succeeded");
		assertEquals(spy.orders[0].args.p_promo_code, "SAVE10");
	});
});

Deno.test("CO8: a promo beside a ticket line is refused before Stripe is touched", async () => {
	const world: World = {
		lines: [{
			id: "line-ticket",
			minor: 8_000,
			currency: "GBP",
			kind: "project_ticket",
			ticketId: "tkt-logo",
		}],
		promoCode: "SAVE10",
	};
	await withCheckout(world, async (spy) => {
		const session = await sessionOf();
		assertEquals(session.promo?.valid, false);
		assertEquals(session.blockers.map((b) => b.code), ["promo_not_applicable"]);

		const result = await create(payFor(world, {
			provider: "card",
			expectedCharge: { minor: 8_000, currency: "GBP" },
		}));
		assertEquals([result.status, result.blockers[0]?.code], ["failed", "promo_not_applicable"]);
		assertEquals(result.message, PROMO_NOT_APPLICABLE);
		assertEquals(spy.charges.length, 0, "the card was never charged");
		assertEquals(spy.orders.length, 0);
	});

	// The same ticket with no code on the basket does reach the card rails.
	const clean: World = { ...world, promoCode: null };
	await withCheckout(clean, async (spy) => {
		const result = await create(payFor(clean, {
			provider: "card",
			expectedCharge: { minor: 8_000, currency: "GBP" },
		}));
		assertEquals(result.status, "requires_action");
		assertEquals(spy.charges.length, 1);
	});
});

Deno.test("promoExcludedLine: tickets, revisions, seats and sessions take no code; products do; unselected lines don't count", () => {
	const money = projector("GBP");
	const line = (over: Partial<Line>) =>
		itemOf(money, { id: "l", minor: 1_000, currency: "GBP", ...over });
	assertEquals(promoExcludedLine([line({})]), null);
	for (
		const kind of [
			"paid_revision",
			"course_group_session",
			"service_session",
			"set_session",
		] as const
	) {
		assert(promoExcludedLine([line({}), line({ kind })]), kind);
	}
	assert(promoExcludedLine([line({ kind: "project_ticket", ticketId: "tkt-1" })]));
	assertEquals(promoExcludedLine([line({ kind: "service_session", selected: false })]), null);
});
// #endregion

// #region Attempt keys, cards and currencies
Deno.test("a prior key replays the order it placed, before anything is read or charged", async () => {
	const world: World = {
		lines: [product("line-gbp", 4_000)],
		prior: {
			order_id: "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a99",
			reference: "PJ-2041",
			charged_minor: 4_000,
			currency: "GBP",
			replayed: true,
		},
	};
	await withCheckout(world, async (spy) => {
		const result = await create(payFor(world, { provider: "card", cardId: "card-a" }));
		assertEquals([result.status, result.orderId], [
			"succeeded",
			"3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a99",
		]);
		assertStringIncludes(result.message, "already made — order PJ-2041");
		assertEquals([spy.reads, spy.charges.length, spy.orders.length], [0, 0, 0]);
	});
});

Deno.test("card-id ownership: a card the owner does not hold is refused, never charged", async () => {
	const world: World = { lines: [product("line-gbp", 4_000)], cards: [card("card-a")] };
	await withCheckout(world, async (spy) => {
		const expectedCharge = { minor: 4_000, currency: "GBP" };
		const foreign = await create(
			payFor(world, { provider: "card", cardId: "card-of-someone-else", expectedCharge }),
		);
		assertEquals([foreign.status, foreign.blockers[0]?.code], ["failed", "no_provider"]);
		assertStringIncludes(foreign.message, "no longer on file");
		assertEquals(spy.charges.length, 0);

		const own = await create(payFor(world, { provider: "card", cardId: "card-a", expectedCharge }));
		assertEquals(own.status, "requires_action");
		assertEquals(spy.charges.map((charge) => [charge.savedCardRef, charge.amountMinor]), [[
			"pm_card-a",
			4_000,
		]]);
	});
});

Deno.test("lines in two currencies are refused by the session's blockers, before any route is tried", async () => {
	const world: World = { lines: [product("line-gbp", 4_000), product("line-usd", 5_000, "USD")] };
	await withCheckout(world, async (spy) => {
		const session = await sessionOf();
		assertEquals(session.charge, null);
		assertEquals(session.blockers.map((b) => b.code), ["no_provider"]);
		assertStringIncludes(session.blockers[0].message, "mixes currencies");

		const result = await create(payFor(world, { provider: "card" }));
		assertStringIncludes(result.message, "mixes currencies");
		assertEquals([spy.charges.length, spy.orders.length], [0, 0]);
	});
});

Deno.test("a live card payment the rails could not resume is payment_in_progress, the code that keeps the key", async () => {
	const world: World = {
		lines: [product("line-gbp", 4_000)],
		chargeCard: () =>
			Promise.resolve(fail<CardPaymentHandoff>(409, {
				message:
					"A payment for these items is already in progress — finish it or wait for it to end",
				details: {
					reason: "payment_in_progress",
					paymentId: "b3c4d5e6-f7a8-4b9c-8d0e-1f2a3b4c5d6e",
				},
			})),
	};
	await withCheckout(world, async () => {
		const result = await create(
			payFor(world, { provider: "card", expectedCharge: { minor: 4_000, currency: "GBP" } }),
		);
		assertEquals([result.status, result.blockers.map((b) => b.code)], ["failed", [
			"payment_in_progress",
		]]);
	});
});
// #endregion

// #region The checkoutPayment simulation (CO29)
Deno.test("checkoutPayment: each processor answer replaces the card charge, and nothing reaches the rails", async () => {
	const world: World = { lines: [product("line-gbp", 4_000)], cards: [card("card-a")] };
	await withCheckout(world, async (spy) => {
		const byCard = payFor(world, {
			provider: "card",
			cardId: "card-a",
			expectedCharge: { minor: 4_000, currency: "GBP" },
		});
		const declined = await create(byCard, { payment: "declined" });
		assertEquals([declined.status, declined.message], ["failed", PROCESSOR_ANSWERS.declined]);
		const timeout = await create(byCard, { payment: "timeout" });
		assertEquals(timeout.message, PROCESSOR_ANSWERS.unreachable);
		const challenged = await create(byCard, { payment: "authenticate" });
		assertEquals([challenged.status, challenged.payment?.confirmation], [
			"requires_action",
			"authenticate",
		]);
		const unapplied = await create(byCard, { payment: "unapplied" });
		assertEquals(unapplied.status, "failed");
		assertStringIncludes(unapplied.message, "reached your Projective wallet");
		assertEquals(spy.charges.length, 0);
	});
});

Deno.test("checkoutPayment: the door's PC409s replace the wallet order; the processor's leave it alone", async () => {
	const world: World = { lines: [product("line-gbp", 4_000)] };
	await withCheckout(world, async (spy) => {
		const byWallet = payFor(world, { expectedCharge: { minor: 4_000, currency: "GBP" } });
		assertEquals(
			(await create(byWallet, { payment: "price_changed" })).blockers[0]?.code,
			"price_changed",
		);
		assertEquals(
			(await create(byWallet, { payment: "promo_exhausted" })).blockers[0]?.code,
			"promo_exhausted",
		);
		assertEquals(spy.orders.length, 0);
		// A card's answer has no card to answer for here: the real order is placed.
		assertEquals((await create(byWallet, { payment: "declined" })).status, "succeeded");
		assertEquals(spy.orders.length, 1);
	});
});

Deno.test("checkoutPayment: a simulation never hides a real refusal", async () => {
	const world: World = { lines: [product("line-gbp", 4_500)] };
	await withCheckout(world, async () => {
		const stale = payFor(world, {
			provider: "card",
			expectedCharge: { minor: 4_000, currency: "GBP" },
		});
		assertEquals((await create(stale, { payment: "declined" })).blockers[0]?.code, "price_changed");
	});
});
// #endregion
