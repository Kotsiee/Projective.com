import { assertEquals } from "@std/assert";
import {
	DIRECT_DELIVERABLE_MILESTONES_MESSAGE,
	EXTRA_REVISION_CAP_MESSAGE,
	EXTRA_REVISION_UNPRICED_MESSAGE,
	extraRevisionCap,
	type ListingDetail,
	ListingDetailSchema,
	type ListingPricing,
	offerModelRefusal,
	publishReadiness,
	revisionBasePrice,
	revisionPriceRefusal,
	revisionsUnlimited,
	UpdateListingInputSchema,
} from "./catalogue.ts";
import { MilestoneSchema, type OneOffOffer, OneOffOfferSchema } from "./offer.ts";

const PRICING: ListingPricing = {
	amount: 0,
	ticketPrice: null,
	sessionPrice: null,
	seatsPerSession: null,
	freeRevisions: null,
	extraRevisionPrice: null,
};

function pricing(patch: Partial<ListingPricing>): ListingPricing {
	return { ...PRICING, ...patch };
}

function detail(overrides: Record<string, unknown> = {}): ListingDetail {
	return ListingDetailSchema.parse({
		id: "svc-23456789ab",
		ownerId: "maris",
		kind: "service",
		serviceType: "Pipeline",
		title: " ",
		category: "",
		status: "draft",
		currency: "GBP",
		cover: null,
		price: { mode: "quote", display: "Set a price" },
		metrics: {
			views: 0,
			orders: 0,
			revenue: 0,
			revenueLabel: "£0",
			avgRating: 0,
			ratingCount: 0,
			trend: [],
		},
		updatedAt: "2026-11-20T09:00:00.000Z",
		updatedLabel: "Edited today",
		promoted: false,
		needsAttention: false,
		owner: { handle: "maris", name: "Maris Okafor", avatar: "", kind: "freelancer" },
		description: "",
		descriptionText: "",
		media: [],
		skills: [],
		tags: [],
		pricing: PRICING,
		delivery: "",
		createCategory: null,
		offer: { archetype: "pipeline", stages: [], allowTieredIntensity: false, teamRoles: [] },
		seo: { seoTitle: "", seoDescription: "" },
		availabilityBinding: null,
		collections: [],
		...overrides,
	});
}

const ONE_OFF: OneOffOffer = {
	archetype: "one_off",
	milestones: [],
	turnaroundDays: 5,
	scope: [],
	teamRoles: [],
};

Deno.test("an extra round revises a Pipeline's ticket and a One-Off's fee", () => {
	const both = pricing({ amount: 300, ticketPrice: 120 });
	assertEquals(revisionBasePrice(both, "pipeline"), 120);
	assertEquals(revisionBasePrice(both, "one_off"), 300);
	assertEquals(revisionBasePrice(both, "session"), null);
	assertEquals(revisionBasePrice(both, null), 300);
	assertEquals(revisionBasePrice(PRICING, "one_off"), null);
});

Deno.test("the cap is half the price, floored to the currency's minor unit", () => {
	assertEquals(extraRevisionCap(pricing({ amount: 9.99 }), "one_off", "GBP"), 4.99);
	assertEquals(extraRevisionCap(pricing({ amount: 999 }), "one_off", "JPY"), 499);
	assertEquals(extraRevisionCap(pricing({ ticketPrice: 250 }), "pipeline", "USD"), 125);
	assertEquals(extraRevisionCap(PRICING, "one_off", "GBP"), null);
});

Deno.test("a positive extra-round price is at most half the price it revises", () => {
	const fee = (extra: number | null) => pricing({ amount: 9.99, extraRevisionPrice: extra });
	assertEquals(revisionPriceRefusal(fee(4.99), "one_off", "GBP"), null);
	assertEquals(revisionPriceRefusal(fee(5), "one_off", "GBP"), EXTRA_REVISION_CAP_MESSAGE);
	assertEquals(revisionPriceRefusal(fee(null), "one_off", "GBP"), null);
	assertEquals(revisionPriceRefusal(fee(0), "one_off", "GBP"), null);
	assertEquals(
		revisionPriceRefusal(pricing({ extraRevisionPrice: 10 }), "one_off", "GBP"),
		EXTRA_REVISION_UNPRICED_MESSAGE,
	);
	assertEquals(revisionPriceRefusal(pricing({ extraRevisionPrice: 0 }), "one_off", "GBP"), null);
	assertEquals(revisionPriceRefusal(pricing({ extraRevisionPrice: 10 }), "session", "GBP"), null);
	assertEquals(revisionPriceRefusal(pricing({ extraRevisionPrice: 10 }), "product", "GBP"), null);
});

Deno.test("unlimited revisions are a free extra round, apart from an unpriced one", () => {
	assertEquals(revisionsUnlimited({ extraRevisionPrice: 0 }), true);
	assertEquals(revisionsUnlimited({ extraRevisionPrice: null }), false);
	assertEquals(revisionsUnlimited({ extraRevisionPrice: 15 }), false);
});

const WITH_MILESTONE: OneOffOffer = OneOffOfferSchema.parse({
	...ONE_OFF,
	milestones: [MilestoneSchema.parse({ name: "Concepts" })],
});

Deno.test("a Direct Deliverable carries no milestones; a One-Off may", () => {
	assertEquals(
		offerModelRefusal(WITH_MILESTONE, "Direct Deliverable"),
		DIRECT_DELIVERABLE_MILESTONES_MESSAGE,
	);
	assertEquals(offerModelRefusal(ONE_OFF, "Direct Deliverable"), null);
	assertEquals(offerModelRefusal(WITH_MILESTONE, "One-Off"), null);
});

Deno.test("the update schema refuses milestones on a Direct Deliverable it names", () => {
	const base = { id: "svc-23456789ab", expectedUpdatedAt: "2026-11-20T09:00:00.000Z" };
	const dd = { ...base, serviceType: "Direct Deliverable", offer: WITH_MILESTONE };
	assertEquals(UpdateListingInputSchema.safeParse(dd).success, false);
	assertEquals(UpdateListingInputSchema.safeParse({ ...dd, offer: ONE_OFF }).success, true);
	assertEquals(UpdateListingInputSchema.safeParse({ ...dd, serviceType: "One-Off" }).success, true);
});

Deno.test("the update schema refuses an extra round above half the price", () => {
	const base = { id: "svc-23456789ab", expectedUpdatedAt: "2026-11-20T09:00:00.000Z" };
	const over = { ...base, pricing: pricing({ amount: 100, extraRevisionPrice: 60 }) };
	const within = { ...base, pricing: pricing({ amount: 100, extraRevisionPrice: 50 }) };
	assertEquals(UpdateListingInputSchema.safeParse(over).success, false);
	assertEquals(UpdateListingInputSchema.safeParse(within).success, true);
});

Deno.test("publish readiness lists what is missing in the Edit page's order", () => {
	assertEquals(publishReadiness(detail()).missing, [
		"Add a title",
		"Add at least one stage",
		"Set a price",
		"Add a cover image",
	]);
	const session = detail({
		serviceType: "Session",
		offer: {
			archetype: "session",
			minutes: 60,
			count: 1,
			meetingProvider: null,
			plan: [],
			rolling: false,
		},
	});
	assertEquals(publishReadiness(session).missing, [
		"Add a title",
		"Set a price",
		"Choose availability",
		"Add a cover image",
	]);
});

Deno.test("a product publishes only with a library file to deliver (MK-60)", () => {
	const notes = { name: "Notes", label: "Notes", extension: ".txt", bytes: 1 };
	const product = (attachments: unknown[]) =>
		detail({
			id: "prd-23456789ab",
			kind: "product",
			serviceType: null,
			offer: {
				archetype: "product",
				format: "download",
				licence: "personal",
				attributionRequired: false,
				attachments,
			},
		});
	assertEquals(publishReadiness(product([notes])).missing, [
		"Add a title",
		"Attach a file to deliver",
		"Set a price",
		"Add a cover image",
	]);
	assertEquals(
		publishReadiness(product([{ ...notes, fileId: "7f1c3a52-0b6e-4c1d-9a7e-2d4b5c6e7f80" }]))
			.missing
			.includes("Attach a file to deliver"),
		false,
	);
});
