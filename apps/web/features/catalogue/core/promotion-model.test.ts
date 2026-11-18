import { assertEquals } from "@std/assert";
import { type ListingPromotion, promotionStateOf } from "@projective/types/catalogue";
import { promotionEndLabel, promotionPlanName, simulatePromotion } from "./promotion-model.ts";

const NOW = new Date("2026-11-18T12:00:00.000Z");

const REAL: ListingPromotion = {
	id: "prd-ygm4yd4t7h",
	entitled: false,
	subject: "user",
	published: false,
	flightDays: 7,
	live: null,
	elsewhere: null,
};

Deno.test("promotion state — a running flight shows first, then why it cannot start, then the offer", () => {
	const live = {
		placementId: "00000000-0000-4000-8000-000000000001",
		surface: "explore_results" as const,
		startsAt: "2026-11-16T12:00:00.000Z",
		endsAt: "2026-11-23T12:00:00.000Z",
	};
	assertEquals(
		promotionStateOf({ ...REAL, live }).kind,
		"live",
		"stoppable even after a plan lapses",
	);
	assertEquals(promotionStateOf(REAL).kind, "unpublished");
	assertEquals(promotionStateOf({ ...REAL, published: true }), {
		kind: "not_entitled",
		subject: "user",
	});
	assertEquals(
		promotionStateOf({
			...REAL,
			published: true,
			entitled: true,
			elsewhere: { slug: "svc-ruxa6p25af", title: "Workshop", endsAt: live.endsAt },
		}).kind,
		"elsewhere",
	);
	assertEquals(promotionStateOf({ ...REAL, published: true, entitled: true }), {
		kind: "available",
		flightDays: 7,
	});
});

Deno.test("simulation — auto is the server's answer, untouched", () => {
	assertEquals(simulatePromotion(REAL, "auto", NOW), REAL);
});

Deno.test("simulation — each forced state draws a published listing in that state", () => {
	assertEquals(promotionStateOf(simulatePromotion(REAL, "not_entitled", NOW)).kind, "not_entitled");
	assertEquals(promotionStateOf(simulatePromotion(REAL, "available", NOW)).kind, "available");
	const live = simulatePromotion(REAL, "live", NOW);
	assertEquals(promotionStateOf(live).kind, "live");
	assertEquals(
		live.live?.endsAt,
		"2026-11-25T12:00:00.000Z",
		"a simulated flight runs the flight length",
	);
	const elsewhere = simulatePromotion(REAL, "elsewhere", NOW);
	assertEquals(promotionStateOf(elsewhere).kind, "elsewhere");
	assertEquals(elsewhere.elsewhere?.slug, "", "a simulated elsewhere links nowhere");
});

Deno.test("words — the end date and the plan a seller needs", () => {
	assertEquals(promotionEndLabel("2026-11-25T12:00:00.000Z"), "25 Nov");
	assertEquals(promotionEndLabel("not a date"), "");
	assertEquals(promotionPlanName("team"), "Pro Team");
	assertEquals(promotionPlanName("user"), "Pro");
});
