import { assert, assertEquals } from "@std/assert";
import { ListingCohortsSchema } from "@projective/types/projects";
import {
	fixtureListingCohorts,
	type RawListingCohort,
	toCohortCancellation,
	toListingCohorts,
} from "./cohorts-model.ts";

const NOW = Date.parse("2026-11-18T12:00:00.000Z");

Deno.test("the fixture world follows the clientPipeline axis and maps onto the SSOT", () => {
	const listing = { title: "Design systems workshop", cohortSize: 16, sessionCount: 3 };
	const empty = toListingCohorts(fixtureListingCohorts("empty", NOW, listing));
	assertEquals(empty.cohorts, []);
	assertEquals(empty.sessionCount, 3);

	const open = toListingCohorts(fixtureListingCohorts("auto", NOW, listing));
	assert(ListingCohortsSchema.safeParse(open).success);
	assertEquals(open.cohorts[0].phase, "enrolling");
	assertEquals(open.cohorts[0].sittings.length, 3);
	assertEquals(open.cohorts[0].cadence, "weekly");
	assert(Date.parse(open.cohorts[0].enrolmentClosesAt!) > NOW);

	const under = toListingCohorts(fixtureListingCohorts("action_required", NOW, listing));
	assert(ListingCohortsSchema.safeParse(under).success);
	assertEquals(under.cohorts[0].phase, "closed");
	assertEquals(under.cohorts[0].underFilled, true);
	assert(Date.parse(under.cohorts[0].enrolmentClosesAt!) < NOW);
	assert(under.cohorts[0].seatsPaid < under.cohorts[0].minSeats!);
});

Deno.test("a raw cohort the SSOT cannot read is dropped, and figures are clamped", () => {
	const raw = fixtureListingCohorts("auto", NOW, { title: "Workshop" });
	const good = raw.cohorts![0];
	const bad: RawListingCohort = { ...good, cohort_id: "x", status: "paused" };
	const mapped = toListingCohorts({
		...raw,
		cohorts: [bad, { ...good, min_seats: 900, seats_paid: -3 }],
	});
	assertEquals(mapped.cohorts.length, 1);
	assertEquals(mapped.cohorts[0].minSeats, mapped.cohorts[0].maxSeats);
	assertEquals(mapped.cohorts[0].seatsPaid, 0);
});

Deno.test("a cancellation maps its reason, refunds and the places it put back", () => {
	assertEquals(
		toCohortCancellation({
			cohort_id: "00000000-0000-4000-8000-000000000001",
			reason: "under_filled",
			seats_refunded: 2,
			refunded_minor: 18000,
			currency: "USD",
			places_restored: 2,
			waitlist_told: 1,
		}),
		{
			cohortId: "00000000-0000-4000-8000-000000000001",
			reason: "under_filled",
			seatsRefunded: 2,
			refundedMinor: 18000,
			currency: "USD",
			placesRestored: 2,
			waitlistTold: 1,
		},
	);
	assertEquals(
		toCohortCancellation({
			cohort_id: "00000000-0000-4000-8000-000000000001",
			reason: "nonsense",
			seats_refunded: 0,
			refunded_minor: 0,
			currency: null,
			places_restored: null,
			waitlist_told: null,
		}).reason,
		"provider",
	);
});
