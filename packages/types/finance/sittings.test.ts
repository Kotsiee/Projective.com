import { assertEquals } from "@std/assert";
import {
	scheduledSittingStarts,
	type SittingSchedule,
	SittingScheduleSchema,
	sittingsLabel,
	sittingsLaterLabel,
} from "./sittings.ts";

const at = (day: number, hour = 14) => new Date(Date.UTC(2026, 11, day, hour)).toISOString();

function schedule(total: number, timed: number): SittingSchedule {
	return SittingScheduleSchema.parse({
		total,
		scheduled: Array.from(
			{ length: timed },
			(_, i) => ({ at: at(i + 1), label: `Sitting ${i + 1}` }),
		),
	});
}

Deno.test("sittingsLabel counts the timed sittings against the block", () => {
	assertEquals(sittingsLabel(schedule(6, 2)), "2 of 6 sittings scheduled");
	assertEquals(sittingsLabel(schedule(6, 1)), "1 of 6 sittings scheduled");
	assertEquals(sittingsLabel(schedule(4, 4)), "4 of 4 sittings scheduled");
});

Deno.test("sittingsLabel never claims more sittings than the block holds", () => {
	assertEquals(sittingsLabel(schedule(2, 5)), "2 of 2 sittings scheduled");
});

Deno.test("sittingsLaterLabel names the rest, and nothing once every sitting is timed", () => {
	assertEquals(sittingsLaterLabel(schedule(6, 2)), "4 booked later");
	assertEquals(sittingsLaterLabel(schedule(3, 3)), null);
});

Deno.test("scheduledSittingStarts is the first sitting, then each later start in order", () => {
	assertEquals(scheduledSittingStarts(at(1), [at(3), at(5)], 6), [at(1), at(3), at(5)]);
	assertEquals(scheduledSittingStarts(at(1), undefined, 6), [at(1)]);
	assertEquals(scheduledSittingStarts(at(1), [], 6), [at(1)]);
});

Deno.test("scheduledSittingStarts stops at a start the payment would refuse", () => {
	assertEquals(scheduledSittingStarts(at(4), [at(2), at(6)], 6), [at(4)]);
	assertEquals(scheduledSittingStarts(at(1), [at(1)], 6), [at(1)]);
	assertEquals(scheduledSittingStarts(at(1), ["soon", at(6)], 6), [at(1)]);
	assertEquals(scheduledSittingStarts(at(1), [42], 6), [at(1)]);
	assertEquals(scheduledSittingStarts(at(1), "not-a-list", 6), [at(1)]);
});

Deno.test("scheduledSittingStarts is capped at the block's size and needs a first sitting", () => {
	assertEquals(scheduledSittingStarts(at(1), [at(2), at(3), at(4)], 2), [at(1), at(2)]);
	assertEquals(scheduledSittingStarts(null, [at(2)], 6), []);
	assertEquals(scheduledSittingStarts("never", [at(2)], 6), []);
});
