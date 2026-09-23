import { assertEquals } from "@std/assert";
import { type ListingDetail, ListingDetailSchema } from "@projective/types/catalogue";
import type { ProductItem, ServiceItem } from "@projective/types/explore";
import { buildPreviewItem, halfOverHalf } from "./catalogue-model.ts";

// #region halfOverHalf
Deno.test("halfOverHalf — a rise from nothing has no percentage", () => {
	// The old first-bucket formula divided by 1 here and printed 49,900%.
	assertEquals(halfOverHalf([0, 0, 0, 0, 500]), null);
});

Deno.test("halfOverHalf — fewer than two weeks has no comparison", () => {
	assertEquals(halfOverHalf([]), null);
	assertEquals(halfOverHalf([120]), null);
});

Deno.test("halfOverHalf — compares the later half with the earlier half", () => {
	assertEquals(halfOverHalf([100, 100, 150, 150]), 50);
	assertEquals(halfOverHalf([200, 200, 100, 100]), -50);
	assertEquals(halfOverHalf([80, 80]), 0);
});

Deno.test("halfOverHalf — an odd series leaves the middle week out of both halves", () => {
	// Weeks 0–1 against weeks 3–4; the 9,000 in week 2 belongs to neither.
	assertEquals(halfOverHalf([100, 100, 9_000, 100, 100]), 0);
});
// #endregion

// #region buildPreviewItem
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
		availability: null,
		collections: [],
		...overrides,
	});
}

Deno.test("buildPreviewItem — the preview card is priced in the listing's own currency", () => {
	// Without these two fields the explore card fell back to its USD default, so a pound listing
	// previewed as dollars beside a console that said pounds.
	const item = buildPreviewItem(listing({})) as ServiceItem;
	assertEquals(item.currency, "GBP");
	assertEquals(item.priceMinor, 120_000);
});

Deno.test("buildPreviewItem — minor units follow the currency's exponent", () => {
	const item = buildPreviewItem(
		listing({
			kind: "product",
			serviceType: null,
			currency: "JPY",
			price: { mode: "fixed", display: "¥5,000" },
			pricing: {
				amount: 5000,
				ticketPrice: null,
				sessionPrice: null,
				seatsPerSession: null,
				freeRevisions: null,
				extraRevisionPrice: null,
			},
		}),
	) as ProductItem;
	assertEquals(item.currency, "JPY");
	assertEquals(item.priceMinor, 5000);
});

Deno.test("buildPreviewItem — an unpriced listing carries no figure rather than a zero", () => {
	const item = buildPreviewItem(
		listing({
			pricing: {
				amount: 0,
				ticketPrice: null,
				sessionPrice: null,
				seatsPerSession: null,
				freeRevisions: null,
				extraRevisionPrice: null,
			},
		}),
	) as ServiceItem;
	assertEquals(item.priceMinor, undefined);
});
// #endregion
