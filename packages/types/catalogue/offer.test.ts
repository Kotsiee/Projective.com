import { assertEquals } from "@std/assert";
import {
	hasVariableSessionLengths,
	normaliseSessionPlan,
	SessionOfferSchema,
	sittingPriceMinor,
	sittingPricesMinor,
} from "./offer.ts";

// #region Fixtures
const offer = {
	archetype: "session" as const,
	minutes: 60,
	count: 3,
	meetingProvider: null,
	rolling: false,
	plan: [
		{ title: "Intro", description: "", durationMinutes: 90 },
		{ title: "Short", description: "", durationMinutes: 25 },
		{ title: "Close", description: "" },
	],
};
// #endregion

Deno.test("sittingPriceMinor floors a per-hour sitting and ignores the length per session (SC10)", () => {
	assertEquals(sittingPriceMinor(6000, "per_hour", 90), 9000);
	assertEquals(sittingPriceMinor(7001, "per_hour", 25), 2917);
	assertEquals(sittingPriceMinor(7001, "per_hour", 90), 10501);
	assertEquals(sittingPriceMinor(7001, "per_session", 25), 7001);
});

Deno.test("sittingPricesMinor prices each sitting at its own length, else the listing's", () => {
	assertEquals(sittingPricesMinor(7001, "per_hour", 60, offer.plan, 3), [10501, 2917, 7001]);
	assertEquals(sittingPricesMinor(7001, "per_session", 60, offer.plan, 3), [7001, 7001, 7001]);
	assertEquals(sittingPricesMinor(3000, "per_hour", 60, [], 2), [3000, 3000]);
});

Deno.test("a session offer whose sittings vary in length must be priced per hour", () => {
	assertEquals(hasVariableSessionLengths(offer), true);
	assertEquals(SessionOfferSchema.safeParse(offer).success, false);
	assertEquals(SessionOfferSchema.safeParse({ ...offer, pricingUnit: "per_hour" }).success, true);
	const uniform = {
		...offer,
		plan: offer.plan.map(({ title, description }) => ({ title, description })),
	};
	assertEquals(SessionOfferSchema.safeParse(uniform).success, true);
	// A length past the count is never sold, so it does not force per hour.
	assertEquals(hasVariableSessionLengths({ ...offer, count: 0 }), false);
});

Deno.test("normaliseSessionPlan keeps a sitting's own length and treats a length as content", () => {
	assertEquals(
		normaliseSessionPlan({
			count: 3,
			plan: [...offer.plan.slice(0, 2), { title: "", description: "", durationMinutes: 45 }],
		}),
		[
			{ title: "Intro", description: "", durationMinutes: 90 },
			{ title: "Short", description: "", durationMinutes: 25 },
			{ title: "", description: "", durationMinutes: 45 },
		],
	);
	assertEquals(normaliseSessionPlan({ count: 3, plan: offer.plan }).at(-1), {
		title: "Close",
		description: "",
	});
});
