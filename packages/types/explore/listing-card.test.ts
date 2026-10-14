import { assertEquals } from "@std/assert";
import { type ListingDetail, ListingDetailSchema } from "../catalogue/catalogue.ts";
import { listingCardItem } from "./listing-card.ts";

// #region Fixture
function listing(overrides: Record<string, unknown>): ListingDetail {
	return ListingDetailSchema.parse({
		id: "svc-previewtest",
		ownerId: "maris",
		kind: "service",
		serviceType: "One-Off",
		title: "Brand identity sprint",
		category: "branding",
		status: "draft",
		currency: "GBP",
		cover: null,
		price: { mode: "fixed", display: "£1,200" },
		metrics: {
			views: 0,
			orders: 0,
			revenue: 0,
			revenueLabel: "£0",
			avgRating: 0,
			ratingCount: 0,
			trend: [],
		},
		updatedAt: "2026-09-01T00:00:00.000Z",
		updatedLabel: "Edited today",
		promoted: false,
		needsAttention: false,
		owner: { handle: "maris", name: "Maris Okafor", avatar: "", kind: "freelancer" },
		description: "",
		descriptionText: "",
		media: [],
		skills: [],
		tags: [],
		pricing: {
			amount: 1200,
			ticketPrice: null,
			sessionPrice: null,
			seatsPerSession: null,
			freeRevisions: null,
			extraRevisionPrice: null,
		},
		delivery: "",
		createCategory: null,
		offer: { archetype: "one_off", milestones: [], turnaroundDays: null, scope: [], teamRoles: [] },
		seo: { seoTitle: "", seoDescription: "" },
		availabilityBinding: null,
		collections: [],
		...overrides,
	});
}

const NO_PRICE = {
	amount: 0,
	ticketPrice: null,
	sessionPrice: null,
	seatsPerSession: null,
	freeRevisions: null,
	extraRevisionPrice: null,
};

function slot(position: number, kind: "image" | "video", src: string, size?: [number, number]) {
	return {
		position,
		kind,
		fileId: crypto.randomUUID(),
		thumb: src,
		src,
		alt: "",
		...(size ? { width: size[0], height: size[1] } : {}),
	};
}
// #endregion

// #region Money
Deno.test("listingCardItem — the card is priced in the listing's own currency", () => {
	// Without these two fields the explore card fell back to its USD default, so a pound listing
	// previewed as dollars beside a console that said pounds.
	const item = listingCardItem(listing({}));
	assertEquals([item.currency, item.priceMinor, item.price], ["GBP", 120_000, "£1,200"]);
});

Deno.test("listingCardItem — minor units follow the currency's exponent", () => {
	const item = listingCardItem(listing({
		kind: "product",
		serviceType: null,
		currency: "JPY",
		pricing: { ...NO_PRICE, amount: 5000 },
	}));
	assertEquals([item.type, item.currency, item.priceMinor, item.price], [
		"products",
		"JPY",
		5000,
		"¥5,000",
	]);
});

Deno.test("listingCardItem — an unpriced listing carries no figure rather than a zero", () => {
	const item = listingCardItem(listing({ pricing: NO_PRICE }));
	assertEquals([item.priceMinor, item.price], [undefined, "Set a price"]);
});
// #endregion

// #region Media
Deno.test("listingCardItem — the card's media is the slot-1 cover still", () => {
	const covered = listingCardItem(
		listing({ media: [slot(2, "video", "/v.mp4"), slot(1, "image", "/cover.webp")] }),
	);
	assertEquals(covered.media, "/cover.webp");
	const uncovered = listingCardItem(listing({ media: [slot(2, "image", "/second.webp")] }));
	assertEquals(uncovered.media, undefined);
});

Deno.test("listingCardItem — a product tile is sized from its cover, and keeps its masonry weight", () => {
	const item = listingCardItem(listing({
		kind: "product",
		serviceType: null,
		span: 3,
		media: [slot(1, "image", "/kit.webp", [3000, 2400])],
	}));
	assertEquals(item.type === "products" && [item.span, item.mediaMeta], [3, {
		width: 3000,
		height: 2400,
		aspectRatio: 1.25,
	}]);
});
// #endregion

// #region Facts
Deno.test("listingCardItem — a rating appears only with reviews, at one decimal", () => {
	assertEquals(listingCardItem(listing({})).rating, undefined);
	const rated = listingCardItem(listing({
		metrics: {
			views: 0,
			orders: 0,
			revenue: 0,
			revenueLabel: "£0",
			avgRating: 4.8333,
			ratingCount: 6,
			trend: [],
		},
	}));
	assertEquals(rated.rating, { asHelper: { value: 4.8, count: 6 } });
});

Deno.test("listingCardItem — a service whose model is not chosen yet draws as a One-Off", () => {
	// A draft mid-edit: the title field has just been cleared.
	const item = listingCardItem({ ...listing({ serviceType: null }), title: "" });
	assertEquals(item.type === "services" && [item.serviceType, item.title], [
		"One-Off",
		"Untitled service",
	]);
});

Deno.test("listingCardItem — the Newest key is when it went live, else the last edit", () => {
	assertEquals(
		listingCardItem(listing({ listedAt: "2026-08-01T00:00:00Z" })).createdAt,
		"2026-08-01T00:00:00Z",
	);
	assertEquals(listingCardItem(listing({})).createdAt, "2026-09-01T00:00:00.000Z");
});
// #endregion
