import { assertEquals } from "@std/assert";
import type { ServiceItem } from "../types/profile-types.ts";
import {
	ctaFor,
	estimatedSpendFor,
	isFastResponder,
	parseReviewStance,
	responseLabel,
	reviewsForStance,
	reviewStanceCounts,
	reviewStanceOf,
} from "./profile-model.ts";

Deno.test("ctaFor leads a seller with Hire and a buyer with Message", () => {
	assertEquals(ctaFor("freelancer", true), { layout: "hire", primary: "Hire", target: "services" });
	assertEquals(ctaFor("team", true), { layout: "hire", primary: "Hire", target: "services" });
	// A seller with nothing listed can only be hired by asking.
	assertEquals(ctaFor("freelancer", false), { layout: "hire", primary: "Hire", target: "message" });
	for (const kind of ["client", "business", "organisation"] as const) {
		assertEquals(ctaFor(kind, true), { layout: "message", primary: "Message", target: null });
	}
});

Deno.test("review stance is the author's role inverted", () => {
	// The author was the CLIENT → the profile was reviewed as a freelancer.
	assertEquals(reviewStanceOf({ role: "client" }), "freelancer");
	assertEquals(reviewStanceOf({ role: "freelancer" }), "client");

	const reviews = [
		{ id: "a", role: "client" as const },
		{ id: "b", role: "freelancer" as const },
		{ id: "c", role: "client" as const },
	];
	assertEquals(reviewsForStance(reviews, "all").map((r) => r.id), ["a", "b", "c"]);
	assertEquals(reviewsForStance(reviews, "freelancer").map((r) => r.id), ["a", "c"]);
	assertEquals(reviewsForStance(reviews, "client").map((r) => r.id), ["b"]);
	assertEquals(reviewStanceCounts(reviews), { all: 3, freelancer: 2, client: 1 });
});

Deno.test("parseReviewStance accepts only the two stances", () => {
	assertEquals(parseReviewStance("freelancer"), "freelancer");
	assertEquals(parseReviewStance("client"), "client");
	assertEquals(parseReviewStance("all"), "all");
	assertEquals(parseReviewStance("evil"), "all");
	assertEquals(parseReviewStance(null), "all");
});

Deno.test("responseLabel rounds to the unit a reader plans around", () => {
	assertEquals(responseLabel(45), "~45 min");
	assertEquals(responseLabel(60), "~1 hr");
	assertEquals(responseLabel(120), "~2 hrs");
	assertEquals(responseLabel(240), "~4 hrs");
	assertEquals(responseLabel(1440), "~1 day");
	assertEquals(responseLabel(4320), "~3 days");
});

Deno.test("isFastResponder is the card's threshold and never fires unmeasured", () => {
	assertEquals(isFastResponder(45), true);
	assertEquals(isFastResponder(60), true);
	assertEquals(isFastResponder(61), false);
	assertEquals(isFastResponder(null), false);
	assertEquals(isFastResponder(undefined), false);
});

const service = (over: Partial<ServiceItem>): ServiceItem => ({
	id: "sv-1",
	type: "services",
	title: "Service",
	owner: { handle: "@x", name: "X", avatar: "", kind: "freelancer" },
	price: "$500",
	delivery: "5 days",
	category: "design",
	serviceType: "One-Off",
	createdAt: "2026-01-01",
	...over,
} as ServiceItem);

Deno.test("estimatedSpendFor is the cheapest structured floor and its unit", () => {
	const spend = estimatedSpendFor([
		service({ id: "a", serviceType: "One-Off", priceMinor: 50_000, currency: "USD" }),
		service({
			id: "b",
			serviceType: "Pipeline",
			ticketPrice: 240,
			priceMinor: 24_000,
			currency: "USD",
		}),
		service({ id: "c", serviceType: "Session", sessionPrice: 180, currency: "USD" }),
	]);
	// The pipeline's floor is 0.5× its ticket price → $120 / ticket, the cheapest start.
	assertEquals(spend, { amount: { minor: 12_000, currency: "USD" }, unit: "ticket" });
});

Deno.test("estimatedSpendFor invents nothing for an unpriced catalogue", () => {
	assertEquals(estimatedSpendFor([]), null);
	assertEquals(estimatedSpendFor([service({ price: "Contact us" })]), null);
});
