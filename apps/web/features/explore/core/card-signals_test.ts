import { assertEquals } from "@std/assert";
import {
	languageName,
	languageSummary,
	postedLabel,
	profileMetrics,
	profileSignals,
	relativeAge,
	serviceTypeLabel,
} from "./card-signals.ts";
import type { ProfileItem } from "../types/explore-types.ts";

/**
 * The card family's derivation rules, pinned.
 *
 * These are worth a test rather than a spot-check because every one of them is a CLAIM the product
 * makes to a reader — "Top rated", "Fast replies", "Posted 3 days ago" — and the failure mode is not a
 * broken layout but a confident, wrong statement. A threshold that silently drifts still renders
 * beautifully.
 */

/** A minimal profile item; each test overrides only the field under examination. */
function profile(over: Partial<ProfileItem> = {}): ProfileItem {
	return {
		id: "fl-test",
		type: "freelancers",
		title: "Test Person",
		owner: { handle: "@test", name: "Test Person", avatar: "", kind: "freelancer" },
		skills: [],
		summary: "",
		craft: "Designer",
		cover: "",
		delivered: 10,
		createdAt: "2026-01-01",
		...over,
	} as ProfileItem;
}

// #region Languages
Deno.test("languageName maps codes to full names and passes unknown codes through", () => {
	assertEquals(languageName("EN"), "English");
	assertEquals(languageName("de"), "German");
	// An unmapped code is printed as-is rather than dropped: a missing language is worse than a code.
	assertEquals(languageName("XX"), "XX");
});

Deno.test("languageSummary shows the first two names then a counted remainder", () => {
	assertEquals(languageSummary(["EN", "DE", "FR", "ES", "IT"]), "English, German, +3 more");
	assertEquals(languageSummary(["EN", "FR"]), "English, French");
	assertEquals(languageSummary(["EN"]), "English");
	assertEquals(languageSummary([]), "");
	assertEquals(languageSummary(undefined), "");
});
// #endregion

// #region Trust chips
Deno.test("profileSignals awards Top rated only above BOTH the score and sample thresholds", () => {
	const rated = (value: number, count: number) =>
		profile({ rating: { asHelper: { value, count } } });
	assertEquals(profileSignals(rated(4.9, 20))[0]?.id, "top-rated");
	assertEquals(profileSignals(rated(5.0, 61))[0]?.id, "top-rated");
	// A perfect score from three people is not a track record.
	assertEquals(profileSignals(rated(5.0, 3)).length, 0);
	// A large sample at a good-but-not-top score is not "top rated" either.
	assertEquals(profileSignals(rated(4.6, 500)).length, 0);
	assertEquals(profileSignals(profile()).length, 0);
});

Deno.test("profileSignals gates Fast replies on a measured response time, never on spare capacity", () => {
	assertEquals(profileSignals(profile({ responseMinutes: 35 }))[0]?.id, "fast-replies");
	assertEquals(profileSignals(profile({ responseMinutes: 60 }))[0]?.id, "fast-replies");
	// Slower than the threshold, and with no other signal, earns nothing.
	assertEquals(profileSignals(profile({ responseMinutes: 180 })).length, 0);

	// The critical case: an idle freelancer is AVAILABLE, which is not a promise about reply speed.
	const idle = profileSignals(profile({ workload: { level: 20, status: "Available now" } }));
	assertEquals(idle[0]?.id, "available");

	// A busy freelancer with no measured response time gets no chip at all.
	assertEquals(
		profileSignals(profile({ workload: { level: 92, status: "Fully booked" } })).length,
		0,
	);
});

Deno.test("profileSignals caps the stack at two chips", () => {
	const both = profileSignals(profile({
		rating: { asHelper: { value: 5, count: 100 } },
		responseMinutes: 10,
		workload: { level: 5, status: "Available now" },
	}));
	assertEquals(both.length, 2);
	assertEquals(both.map((s) => s.id), ["top-rated", "fast-replies"]);
});
// #endregion

// #region Metrics
Deno.test("profileMetrics counts a catalogue for people and a headcount for entities", () => {
	assertEquals(
		profileMetrics(profile({ servicePrices: [1, 2, 3], products: 12 })),
		[{ value: "3", label: "services" }, { value: "12", label: "products" }],
	);
	// A zero is omitted, not printed: "0 products" is weaker than the absence of the row.
	assertEquals(profileMetrics(profile({ servicePrices: [1], products: 0 })), [{
		value: "1",
		label: "service",
	}]);
	assertEquals(profileMetrics(profile({ type: "teams", members: 8 })), [{
		value: "8",
		label: "members",
	}]);
	assertEquals(profileMetrics(profile({ type: "businesses", members: 1 })), [{
		value: "1",
		label: "member",
	}]);
	assertEquals(profileMetrics(profile({ type: "teams" })), []);
});
// #endregion

// #region Relative time
Deno.test("relativeAge steps through the units", () => {
	const now = Date.parse("2026-08-21T12:00:00Z");
	const at = (iso: string) => relativeAge(iso, now);
	assertEquals(at("2026-08-21T11:58:00Z"), "2m");
	assertEquals(at("2026-08-21T09:00:00Z"), "3h");
	assertEquals(at("2026-08-18T12:00:00Z"), "3 days");
	assertEquals(at("2026-08-20T12:00:00Z"), "1 day");
	assertEquals(at("2026-06-21T12:00:00Z"), "2 months");
	assertEquals(at("2024-08-21T12:00:00Z"), "2 years");
});

Deno.test("relativeAge refuses a future or unparseable date rather than inventing one", () => {
	const now = Date.parse("2026-08-21T12:00:00Z");
	// A clock-skewed row must never render "in -1 days"; no timestamp is the honest output.
	assertEquals(relativeAge("2026-09-01T00:00:00Z", now), "");
	assertEquals(relativeAge("not-a-date", now), "");
	assertEquals(postedLabel("not-a-date", now), "");
	assertEquals(postedLabel("2026-08-18T12:00:00Z", now), "Posted 3 days ago");
});
// #endregion

// #region Service labels
Deno.test("serviceTypeLabel reads naturally for every delivery model", () => {
	assertEquals(serviceTypeLabel("Pipeline"), "Pipeline service");
	assertEquals(serviceTypeLabel("One-Off"), "One-off service");
	assertEquals(serviceTypeLabel("Direct Deliverable"), "Direct deliverable");
	assertEquals(serviceTypeLabel("Session"), "1:1 session");
	assertEquals(serviceTypeLabel("Group Session"), "Group session");
	// An unmapped model prints itself rather than an empty chip.
	assertEquals(serviceTypeLabel("Retainer"), "Retainer");
});
// #endregion
