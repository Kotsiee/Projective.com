import { assertEquals } from "@std/assert";
import type { OwnerBand } from "@projective/types/scheduling";
import { clockLabel, weekHours } from "./availability-model.ts";

const band = (weekday: number, start: number, end: number): OwnerBand => ({
	weekday,
	startMinute: start,
	endMinute: end,
	kind: "working_hours",
	feeAmountMinor: null,
	feeCurrency: null,
});

Deno.test("clock labels run to 24:00", () => {
	assertEquals(clockLabel(540), "09:00");
	assertEquals(clockLabel(1050), "17:30");
	assertEquals(clockLabel(1440), "24:00");
});

Deno.test("a working week reads as one line", () => {
	const week = [1, 2, 3, 4, 5].map((d) => band(d, 540, 1050));
	assertEquals(weekHours(week), [{ days: "Mon–Fri", times: "09:00–17:30" }]);
});

Deno.test("touching bands join and a gap is kept", () => {
	assertEquals(weekHours([band(1, 540, 720), band(1, 720, 1020)]), [
		{ days: "Mon", times: "09:00–17:00" },
	]);
	assertEquals(weekHours([band(1, 780, 1020), band(1, 540, 720)]), [
		{ days: "Mon", times: "09:00–12:00, 13:00–17:00" },
	]);
});

Deno.test("two days share a comma, a day off ends the run", () => {
	const bands = [1, 2, 4, 6, 0].map((d) => band(d, 600, 780));
	assertEquals(weekHours(bands), [
		{ days: "Mon, Tue", times: "10:00–13:00" },
		{ days: "Thu", times: "10:00–13:00" },
		{ days: "Sat, Sun", times: "10:00–13:00" },
	]);
});

Deno.test("the week is read from the owner's first weekday", () => {
	const bands = [band(0, 600, 780), band(1, 600, 780), band(2, 540, 1020)];
	assertEquals(weekHours(bands, 0), [
		{ days: "Sun, Mon", times: "10:00–13:00" },
		{ days: "Tue", times: "09:00–17:00" },
	]);
	assertEquals(weekHours([]), []);
});
