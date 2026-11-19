import { assert, assertEquals } from "@std/assert";
import type { ListingCohort, ListingCohorts } from "@projective/types/projects";
import {
	cancelAddress,
	cancelCohortPath,
	cancelConsequence,
	cohortForAddress,
	cohortSeatsLine,
	cohortsPath,
	cohortWhenLine,
	draftStarts,
	draftToInput,
	enrollingCohort,
	freshDraft,
} from "./cohort-model.ts";

const at = (iso: string) => iso.slice(0, 16).replace("T", " ");

function cohort(over: Partial<ListingCohort> = {}): ListingCohort {
	return {
		cohortId: "00000000-0000-4000-8000-000000000001",
		name: "Winter cohort",
		status: "enrolling",
		phase: "enrolling",
		maxSeats: 12,
		minSeats: 5,
		seatsPaid: 2,
		seatsHeld: 1,
		enrolmentClosesAt: "2026-12-07T18:00:00.000Z",
		cadence: "weekly",
		firstStartsAt: "2026-12-08T18:00:00.000Z",
		lastEndsAt: "2026-12-22T20:00:00.000Z",
		underFilled: false,
		canCancel: true,
		cancelReason: null,
		cancelledAt: null,
		projectSlug: null,
		sittings: [0, 1, 2].map((k) => ({
			id: `00000000-0000-4000-8000-00000000010${k}`,
			slug: `ssn-abcdefghj${k + 2}`,
			title: `Winter cohort — session ${k + 1} of 3`,
			startsAt: new Date(Date.parse("2026-12-08T18:00:00.000Z") + k * 7 * 86_400_000).toISOString(),
			endsAt: new Date(Date.parse("2026-12-08T20:00:00.000Z") + k * 7 * 86_400_000).toISOString(),
			status: "scheduled",
		})),
		...over,
	};
}

const DATA: ListingCohorts = {
	sessionCount: 3,
	sessionMinutes: 120,
	cohortSize: 12,
	cohorts: [cohort()],
};

Deno.test("the cohort reads and writes go to the catalogue routes, with the dev axis when set", () => {
	assertEquals(cohortsPath("svc-abcdefghjk"), "/api/catalogue/cohorts?listing=svc-abcdefghjk");
	assertEquals(
		cohortsPath("svc-abcdefghjk", "empty"),
		"/api/catalogue/cohorts?listing=svc-abcdefghjk&sim=empty",
	);
	assertEquals(
		cancelCohortPath("00000000-0000-4000-8000-000000000001"),
		"/api/catalogue/cohorts/00000000-0000-4000-8000-000000000001/cancel",
	);
});

Deno.test("a cancel is addressed by the cohort's first sitting, and only a cancellable one resolves", () => {
	assertEquals(cancelAddress(cohort()), "cancel:ssn-abcdefghj2");
	assertEquals(cohortForAddress(DATA, "cancel:ssn-abcdefghj2")?.cohortId, cohort().cohortId);
	assertEquals(cohortForAddress(DATA, "cancel:ssn-abcdefghj9"), null);
	assertEquals(cohortForAddress(DATA, "open"), null);
	assertEquals(
		cohortForAddress({ ...DATA, cohorts: [cohort({ canCancel: false })] }, "cancel:ssn-abcdefghj2"),
		null,
	);
	assertEquals(enrollingCohort(DATA)?.name, "Winter cohort");
	assertEquals(enrollingCohort({ ...DATA, cohorts: [cohort({ phase: "closed" })] }), null);
});

Deno.test("a cohort's lines state its start, cadence, seats against the minimum, and the refund", () => {
	assertEquals(cohortWhenLine(cohort(), at), "2026-12-08 18:00 · Weekly · 3 sessions");
	assertEquals(
		cohortSeatsLine(cohort()),
		"2 of 12 seats booked · 1 held while buyers pay · minimum 5",
	);
	assertEquals(cohortSeatsLine(cohort({ minSeats: null, seatsHeld: 0 })), "2 of 12 seats booked");
	assert(cancelConsequence(cohort()).startsWith("2 seats are refunded in full to their buyers."));
	assert(cancelConsequence(cohort({ seatsPaid: 0 })).startsWith("Nobody has booked a seat yet."));
});

Deno.test("a fresh draft proposes a week out, the listing's size, weekly, closing a day before", () => {
	const now = Date.parse("2026-11-18T10:00:00");
	const d = freshDraft(DATA, now);
	assertEquals(d.maxSeats, 12);
	assertEquals(d.cadence, "weekly");
	assertEquals(d.minSeats, null);
	assertEquals(d.laterStarts.length, 2);
	assertEquals(d.firstStart!.getHours(), 18);
	assertEquals(d.firstStart!.getTime() - d.closesAt!.getTime(), 24 * 3_600_000);
	const starts = draftStarts(d, 3);
	assertEquals(starts.length, 3);
	assertEquals(new Date(starts[1]).getHours(), 18);
});

Deno.test("the draft becomes the route's input, refused where the database would refuse it", () => {
	const now = Date.parse("2026-11-18T10:00:00");
	const ok = draftToInput("svc-abcdefghjk", freshDraft(DATA, now), 3);
	assert(ok.ok);
	if (ok.ok) {
		assertEquals(ok.input.cadence, "weekly");
		assertEquals(ok.input.laterStartsAt, []);
		assertEquals(ok.input.maxSeats, 12);
	}

	const first = new Date(Date.parse("2026-12-08T18:00:00"));
	const atFirst = draftToInput("svc-abcdefghjk", {
		...freshDraft(DATA, now),
		firstStart: first,
		minSeats: 4,
		closesAt: first,
	}, 3);
	assert(!atFirst.ok);
	if (!atFirst.ok) assert(atFirst.errors.enrolmentClosesAt.includes("before the first session"));

	const missing = draftToInput("svc-abcdefghjk", { ...freshDraft(DATA, now), cadence: "fixed" }, 3);
	assert(!missing.ok);
	if (!missing.ok) {
		assertEquals(missing.errors["laterStartsAt.0"], "Pick when session 2 starts.");
		assertEquals(missing.errors["laterStartsAt.1"], "Pick when session 3 starts.");
	}

	const single = draftToInput("svc-abcdefghjk", freshDraft({ ...DATA, sessionCount: 1 }, now), 1);
	assert(single.ok);
	if (single.ok) assertEquals(single.input.cadence, null);
});
