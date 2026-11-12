import { assert, assertEquals } from "@std/assert";
import { spanLoaded, viewSpan } from "./coverage.ts";
import { DAY } from "./time.ts";

const TZ = "Europe/London";
const WED = Date.parse("2027-09-01T12:00:00.000Z");

Deno.test("a day, a week and a month grid each span what they draw", () => {
	assertEquals(viewSpan("day", WED, TZ), {
		start: Date.parse("2027-08-31T23:00:00.000Z"),
		end: Date.parse("2027-09-01T23:00:00.000Z"),
	});
	const week = viewSpan("week", WED, TZ);
	assertEquals(week.start, Date.parse("2027-08-29T23:00:00.000Z"), "Monday, local midnight");
	assertEquals(Math.round((week.end - week.start) / DAY), 7);
	const month = viewSpan("month", WED, TZ);
	assertEquals(Math.round((month.end - month.start) / DAY), 42, "six weeks of rows");
	assert(month.start <= WED && WED < month.end);
	assertEquals(viewSpan("timeline", WED, TZ), week, "the Timeline's centred week");
});

Deno.test("a period is loaded only when the window holds all of it", () => {
	const week = viewSpan("week", WED, TZ);
	assert(spanLoaded(week, undefined), "a host that says nothing has everything");
	assert(spanLoaded(week, { start: week.start - DAY, end: week.end + DAY }));
	assert(spanLoaded(week, week), "edges are inclusive of the span");
	assert(!spanLoaded(week, { start: week.start + DAY, end: week.end + 30 * DAY }), "starts late");
	assert(!spanLoaded(week, { start: week.start - 30 * DAY, end: week.end - DAY }), "ends early");
	assert(!spanLoaded(week, { start: 0, end: week.start }), "wholly before");
});
