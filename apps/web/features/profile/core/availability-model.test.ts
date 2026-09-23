import { assertEquals } from "@std/assert";
import type { OwnerAvailability } from "@projective/types/scheduling";
import { bandsFor, clockLabel, copyDay, dayOverlaps, endOptions, nextBand, withDayBands } from "./availability-model.ts";

const base: OwnerAvailability = {
	timezone: "Europe/London",
	published: true,
	bands: [
		{ weekday: 1, startMinute: 540, endMinute: 1020, kind: "working_hours" },
		{ weekday: 1, startMinute: 600, endMinute: 660, kind: "call_window" },
	],
	call: null,
};

Deno.test("clock labels and end choices stop at midnight", () => {
	assertEquals(clockLabel(540), "09:00");
	const ends = endOptions(1380);
	assertEquals(ends.map((o) => o.value), ["1410", "1440"]);
	assertEquals(ends[1].label, "24:00 (midnight)");
});

Deno.test("replacing a day's hours keeps its call windows and other days", () => {
	const next = withDayBands(base, 1, [{ weekday: 1, startMinute: 480, endMinute: 720, kind: "working_hours" }]);
	assertEquals(bandsFor(next, 1).map((b) => [b.startMinute, b.endMinute]), [[480, 720]]);
	assertEquals(next.bands.filter((b) => b.kind === "call_window").length, 1);
});

Deno.test("a new band starts after the last one, and a full day takes none", () => {
	assertEquals(nextBand([], 2), { weekday: 2, startMinute: 540, endMinute: 1020, kind: "working_hours" });
	assertEquals(nextBand(bandsFor(base, 1), 1)?.startMinute, 1020);
	assertEquals(nextBand([{ weekday: 3, startMinute: 0, endMinute: 1440, kind: "working_hours" }], 3), null);
});

Deno.test("copying a day re-days the bands", () => {
	const next = copyDay(base, 1, [2, 3]);
	assertEquals(bandsFor(next, 3).map((b) => [b.weekday, b.startMinute]), [[3, 540]]);
});

Deno.test("overlaps are detected within a day", () => {
	assertEquals(dayOverlaps([
		{ weekday: 1, startMinute: 540, endMinute: 720, kind: "working_hours" },
		{ weekday: 1, startMinute: 700, endMinute: 800, kind: "working_hours" },
	]), true);
	assertEquals(dayOverlaps(bandsFor(base, 1)), false);
});
