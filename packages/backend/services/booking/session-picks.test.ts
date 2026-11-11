import { assertEquals } from "@std/assert";
import {
	sessionOutcomeSummary,
	slotCountRefusal,
	slotOverlapRefusal,
} from "./BookingBackendService.ts";

const HOUR = 3_600_000;
const at = (h: number) => ({ startsAt: h * HOUR, endsAt: h * HOUR + HOUR });

Deno.test("a single session takes exactly one time", () => {
	assertEquals(slotCountRefusal("session", 1, 1), null);
	assertEquals(slotCountRefusal("session", 1, 2)?.errors.slotIds, "expected_single_slot");
});

Deno.test("a block needs session 1 and takes up to its size, never more", () => {
	assertEquals(slotCountRefusal("set_session", 4, 0)?.errors.slotIds, "expected_first_slot");
	assertEquals(slotCountRefusal("set_session", 4, 1), null);
	assertEquals(slotCountRefusal("set_session", 4, 4), null);
	assertEquals(slotCountRefusal("set_session", 4, 5)?.errors.slotIds, "too_many_slots");
});

Deno.test("chosen times may touch but not overlap", () => {
	assertEquals(slotOverlapRefusal([at(9), at(10), at(14)]), null);
	assertEquals(
		slotOverlapRefusal([at(9), { startsAt: 9.5 * HOUR, endsAt: 10.5 * HOUR }])?.errors.slotIds,
		"overlapping_slots",
	);
});

Deno.test("the outcome says how many sessions have a time and what happens to the rest", () => {
	assertEquals(sessionOutcomeSummary(1, 1), "Time selected. Complete checkout to confirm.");
	assertEquals(
		sessionOutcomeSummary(1, 4),
		"First session selected. Complete checkout to confirm; the other 3 are booked later.",
	);
	assertEquals(
		sessionOutcomeSummary(3, 4),
		"3 of 4 sessions selected. Complete checkout to confirm; the other 1 is booked later.",
	);
	assertEquals(
		sessionOutcomeSummary(4, 4),
		"All 4 sessions selected. Complete checkout to confirm them.",
	);
});
