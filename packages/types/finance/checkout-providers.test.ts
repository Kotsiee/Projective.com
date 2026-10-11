import { assert, assertEquals } from "@std/assert";
import {
	availableProviders,
	PaymentProvider,
	type ProviderContext,
	type SavedCard,
} from "./checkout.ts";

/** A saved card with only the fields the offer reads changed from a neutral default. */
function card(over: Partial<SavedCard> = {}): SavedCard {
	return {
		id: "card_1",
		ownerType: "user",
		ownerId: "owner_1",
		paymentMethodId: null,
		stripePaymentMethodId: "pm_test_1",
		brand: "visa",
		last4: "4242",
		expMonth: 12,
		expYear: 2030,
		cardholderName: null,
		binNumber: null,
		isBusinessCard: false,
		isDefault: true,
		createdByUserId: null,
		createdAt: "2026-10-07T00:00:00.000Z",
		isExpired: false,
		...over,
	} as SavedCard;
}

const person: ProviderContext = {
	ownerType: "user",
	actingIsMember: true,
	walletAvailableMinor: 10_000,
	totalMinor: 8_010,
	currency: "USD",
	savedCards: [card()],
	kybStatus: null,
	verificationTier: null,
};

const offerOf = (ctx: ProviderContext) =>
	Object.fromEntries(availableProviders(ctx).map((entry) => [entry.provider, entry]));

Deno.test("the routes are card · wallet · express · invoice, in display order", () => {
	assertEquals([...PaymentProvider.options], ["card", "wallet", "express", "invoice"]);
	assertEquals(availableProviders(person).map((entry) => entry.provider), [
		...PaymentProvider.options,
	]);
});

Deno.test("an individual is offered a card and the express wallets", () => {
	const offer = offerOf(person);
	assert(offer.card.available);
	assert(offer.express.available);
	assertEquals(offer.express.reason, null);
	assert(!offer.invoice.available);
});

Deno.test("an entity never gets the express wallets — they are individual instruments", () => {
	const offer = offerOf({
		...person,
		ownerType: "business",
		kybStatus: "verified",
		verificationTier: 3,
	});
	assert(!offer.express.available);
	assert(offer.express.reason?.includes("business wallet or a business card"));
});

Deno.test("an entity pays by card only with a business card, and is told how to get one", () => {
	const entity = {
		...person,
		ownerType: "business" as const,
		kybStatus: "verified" as const,
		verificationTier: 3,
	};
	const without = offerOf(entity);
	assert(!without.card.available);
	assert(without.card.reason?.includes("Add a business card"));
	assert(offerOf({ ...entity, savedCards: [card({ isBusinessCard: true })] }).card.available);
	assert(
		!offerOf({ ...entity, savedCards: [card({ isBusinessCard: true, isExpired: true })] }).card
			.available,
	);
});

Deno.test("a non-member of an entity is refused every route", () => {
	const offer = availableProviders({ ...person, ownerType: "team", actingIsMember: false });
	assert(offer.every((entry) => !entry.available && entry.reason !== null));
});

Deno.test("a verified business pays by invoice only on monthly invoicing, with nothing overdue, inside its limit", () => {
	const business: ProviderContext = {
		...person,
		ownerType: "business",
		kybStatus: "verified",
		verificationTier: 3,
		onAccount: { monthly: true, overdue: false, headroomMinor: 10_000 },
	};
	assert(offerOf(business).invoice.available);
	const notMonthly = offerOf({ ...business, onAccount: { monthly: false, overdue: false, headroomMinor: 10_000 } });
	assert(!notMonthly.invoice.available);
	assert(notMonthly.invoice.reason?.includes("monthly invoicing"));
	const overdue = offerOf({ ...business, onAccount: { monthly: true, overdue: true, headroomMinor: 10_000 } });
	assert(overdue.invoice.reason?.includes("overdue"));
	const short = offerOf({ ...business, onAccount: { monthly: true, overdue: false, headroomMinor: 8_000 } });
	assert(!short.invoice.available);
	assert(short.invoice.reason?.includes("on-account limit"));
});
