import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { tierFor } from "../../gantt/core/time-scale.ts";
import {
	CALENDAR_STOPS,
	CALENDAR_ZOOM_DEFAULT,
	calendarStateAt,
	calendarZoomFor,
	DEFAULT_PPH,
	MAX_PPH,
	MIN_PPH,
	MONTH_WEEKS_MAX,
	MONTH_WEEKS_MIN,
	stopAt,
	TIMELINE_EDGES,
	timelinePxPerDayAt,
	timelineZoomFor,
	zoomMarks,
	zoomStep,
} from "./zoom.ts";

Deno.test("zoomMarks — two marks on the calendar axis, four on the timeline", () => {
	assertEquals(zoomMarks("calendar").length, 2);
	assertAlmostEquals(zoomMarks("calendar")[0], 1 / 3);
	assertAlmostEquals(zoomMarks("calendar")[1], 2 / 3);
	assertEquals(zoomMarks("timeline"), [0.2, 0.4, 0.6, 0.8]);
});

Deno.test("zoomStep — four steps cross a zone on either axis", () => {
	assertAlmostEquals(zoomStep("calendar") * 4, 1 / CALENDAR_STOPS.length);
	assertAlmostEquals(zoomStep("timeline") * 4, 1 / 5);
});

Deno.test("stopAt — the zones read widest to deepest, the far end inclusive", () => {
	assertEquals(stopAt("calendar", 0), "month");
	assertEquals(stopAt("calendar", 0.5), "week");
	assertEquals(stopAt("calendar", 1), "day");
	assertEquals(stopAt("timeline", 0), "year");
	assertEquals(stopAt("timeline", 0.3), "quarter");
	assertEquals(stopAt("timeline", 0.99), "day");
});

Deno.test("calendarStateAt — the month zone runs from ten weeks down to six", () => {
	const widest = calendarStateAt(0);
	assertEquals(widest.view, "month");
	assertEquals(widest.weeks, MONTH_WEEKS_MAX);
	const deep = calendarStateAt(1 / 3 - 1e-9);
	assertEquals(deep.view, "month");
	assertAlmostEquals(deep.weeks, MONTH_WEEKS_MIN, 1e-6);
});

Deno.test("calendarStateAt — a mark belongs to the deeper zone, at its shallowest scale", () => {
	const week = calendarStateAt(1 / 3);
	assertEquals(week.view, "week");
	assertAlmostEquals(week.pph, MIN_PPH);
	const day = calendarStateAt(2 / 3);
	assertEquals(day.view, "day");
	assertAlmostEquals(day.pph, MIN_PPH);
	assertAlmostEquals(calendarStateAt(1).pph, MAX_PPH);
});

Deno.test("calendarZoomFor — every view's deep end stays inside its own zone", () => {
	const monthDeep = calendarZoomFor({ view: "month", pph: MIN_PPH, weeks: MONTH_WEEKS_MIN });
	assertEquals(calendarStateAt(monthDeep).view, "month");
	const weekDeep = calendarZoomFor({ view: "week", pph: MAX_PPH, weeks: MONTH_WEEKS_MIN });
	assertEquals(calendarStateAt(weekDeep).view, "week");
	assertEquals(calendarZoomFor({ view: "day", pph: MAX_PPH, weeks: MONTH_WEEKS_MIN }), 1);
});

Deno.test("calendarZoomFor ∘ calendarStateAt — a position survives the round trip", () => {
	for (let u = 0; u <= 1; u += 0.0125) {
		const back = calendarZoomFor(calendarStateAt(u));
		assertAlmostEquals(back, u, 1e-5, `u=${u}`);
	}
});

Deno.test("calendarStateAt ∘ calendarZoomFor — a week scale survives the round trip", () => {
	for (const pph of [MIN_PPH, 30, DEFAULT_PPH, 90, MAX_PPH - 1]) {
		const state = calendarStateAt(calendarZoomFor({ view: "week", pph, weeks: 6 }));
		assertEquals(state.view, "week");
		assertAlmostEquals(state.pph, pph, 1e-3);
	}
});

Deno.test("CALENDAR_ZOOM_DEFAULT — opens on the Week view at the default hour scale", () => {
	const state = calendarStateAt(CALENDAR_ZOOM_DEFAULT);
	assertEquals(state.view, "week");
	assertAlmostEquals(state.pph, DEFAULT_PPH, 1e-6);
});

Deno.test("timelinePxPerDayAt — the ends are the engine's own clamp, the marks its edges", () => {
	assertAlmostEquals(timelinePxPerDayAt(0), TIMELINE_EDGES[0]);
	assertAlmostEquals(timelinePxPerDayAt(1), TIMELINE_EDGES[TIMELINE_EDGES.length - 1]);
	for (let i = 1; i < TIMELINE_EDGES.length - 1; i++) {
		assertAlmostEquals(timelinePxPerDayAt(i / 5), TIMELINE_EDGES[i], 1e-9);
	}
});

Deno.test("timelineZoomFor ∘ timelinePxPerDayAt — a position survives the round trip", () => {
	for (let u = 0; u <= 1; u += 0.02) {
		assertAlmostEquals(timelineZoomFor(timelinePxPerDayAt(u)), u, 1e-5, `u=${u}`);
	}
});

Deno.test("TIMELINE_EDGES — each mark is a scale at which the Gantt header changes tier", () => {
	for (let i = 1; i < TIMELINE_EDGES.length - 1; i++) {
		const edge = TIMELINE_EDGES[i];
		const below = tierFor(edge * 0.999);
		const at = tierFor(edge);
		assert(
			below.top !== at.top || below.bottom !== at.bottom,
			`the header should change tier at ${edge} px/day`,
		);
	}
});
