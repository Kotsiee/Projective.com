import { assertEquals, assertStrictEquals } from "@std/assert";
import type { IsoDate } from "@projective/types/scheduling";
import { TIMELINE_STOPS } from "@ui/calendar/core/zoom.ts";
import {
	calendarAddressHref,
	type CalendarAddressSurface,
	dateFocus,
	focusDate,
	hiddenClassesFor,
	kindOfHidden,
	nextCalendarAddress,
	readCalendarAddress,
	timelineScaleOf,
	timelineStopOf,
	TimelineStopParam,
} from "./calendar-address.ts";

const at = (path: string) => new URL(path, "https://projective.test");
const read = (path: string, surface: CalendarAddressSurface = "personal") =>
	readCalendarAddress(at(path), surface);

// #region Reading
Deno.test("the bare calendar names nothing, and is canonical", () => {
	assertEquals(read("/calendar"), { address: {}, redirect: null });
});

Deno.test("every grid view reads, on every calendar", () => {
	for (const surface of ["personal", "project", "schedule"] as const) {
		for (const view of ["day", "week", "month", "timeline"] as const) {
			assertEquals(read(`/c?view=${view}`, surface), { address: { view }, redirect: null });
		}
	}
});

Deno.test("view=events is the bare agenda on /calendar, and view=availability its page (#376)", () => {
	assertEquals(read("/calendar?view=events"), { address: {}, redirect: null });
	assertEquals(read("/calendar?view=availability&preset=avp-x"), { address: {}, redirect: null });
});

Deno.test("the hub's page values are not grid views anywhere else", () => {
	assertEquals(
		read("/projects/prj-a/calendar?view=availability", "project").redirect,
		"/projects/prj-a/calendar",
	);
	assertEquals(read("/@juno/availability?view=events", "schedule").redirect, "/@juno/availability");
});

Deno.test("an unknown view is dropped by a redirect to the canonical address", () => {
	assertEquals(read("/calendar?view=bogus"), { address: {}, redirect: "/calendar" });
	assertEquals(read("/calendar?view=Week&date=2027-09-01"), {
		address: { date: "2027-09-01" as IsoDate },
		redirect: "/calendar?date=2027-09-01",
	});
});

Deno.test("a real day reads; a malformed or impossible one is dropped", () => {
	assertEquals(read("/calendar?view=month&date=2027-09-01"), {
		address: { view: "month", date: "2027-09-01" as IsoDate },
		redirect: null,
	});
	for (const bad of ["2027-02-30", "2027-9-1", "tomorrow", "1969-12-31", "12027-01-01"]) {
		assertEquals(read(`/calendar?view=month&date=${bad}`).redirect, "/calendar?view=month", bad);
	}
});

Deno.test("zoom names a Timeline stop beside view=timeline only", () => {
	for (const zoom of TIMELINE_STOPS) {
		assertEquals(read(`/calendar?view=timeline&zoom=${zoom}`), {
			address: { view: "timeline", zoom },
			redirect: null,
		});
	}
	assertEquals(read("/calendar?view=week&zoom=day").redirect, "/calendar?view=week");
	assertEquals(read("/calendar?zoom=year").redirect, "/calendar");
	assertEquals(read("/calendar?view=timeline&zoom=decade").redirect, "/calendar?view=timeline");
});

Deno.test("kind is Event · Reminder, on /calendar only", () => {
	assertEquals(read("/calendar?kind=reminder"), { address: { kind: "reminder" }, redirect: null });
	assertEquals(read("/calendar?kind=event"), { address: { kind: "event" }, redirect: null });
	assertEquals(read("/calendar?kind=session").redirect, "/calendar");
	assertEquals(
		read("/projects/prj-a/calendar?kind=event", "project").redirect,
		"/projects/prj-a/calendar",
	);
});

Deno.test("the availability page drops every grid parameter", () => {
	assertEquals(
		read("/calendar?view=availability&preset=avp-x&date=2027-09-01&zoom=year&kind=event").redirect,
		"/calendar?view=availability&preset=avp-x",
	);
});

Deno.test("a parameter given twice keeps its first value and is redirected once", () => {
	assertEquals(read("/calendar?view=week&view=month"), {
		address: { view: "week" },
		redirect: "/calendar?view=week",
	});
});

Deno.test("parameters the address does not own survive the redirect", () => {
	assertEquals(
		read("/calendar?event=e1&view=nope&filter=invitations").redirect,
		"/calendar?event=e1&filter=invitations",
	);
});
// #endregion

// #region Writing
Deno.test("writing an address replaces only its own parameters", () => {
	assertEquals(
		calendarAddressHref("/calendar", "?event=e1&view=week&date=2026-01-01", {
			view: "month",
			date: "2027-09-01" as IsoDate,
			kind: "reminder",
		}),
		"/calendar?event=e1&view=month&date=2027-09-01&kind=reminder",
	);
	assertEquals(calendarAddressHref("/calendar", "?view=week", {}), "/calendar");
});

Deno.test("zoom is never written beside a grid view", () => {
	assertEquals(
		calendarAddressHref("/calendar", "", { view: "week", zoom: "day" }),
		"/calendar?view=week",
	);
	assertEquals(
		calendarAddressHref("/calendar", "", { view: "timeline", zoom: "quarter" }),
		"/calendar?view=timeline&zoom=quarter",
	);
});

Deno.test("a written address reads back as itself", () => {
	const address = {
		view: "timeline",
		date: "2027-09-01" as IsoDate,
		zoom: "year",
		kind: "event",
	} as const;
	const href = calendarAddressHref("/calendar", "?event=e1", address);
	assertEquals(read(href), { address, redirect: null });
});
// #endregion

// #region Translating
Deno.test("the stop vocabulary is the engine's", () => {
	assertEquals(TimelineStopParam.options, [...TIMELINE_STOPS]);
});

Deno.test("a date opens on that day in the page's own zone, both sides of the date line", () => {
	for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Europe/London", "Asia/Kolkata"]) {
		assertStrictEquals(focusDate(dateFocus("2027-09-01" as IsoDate, tz), tz), "2027-09-01", tz);
	}
});

Deno.test("each Timeline stop's scale sits inside that stop", () => {
	for (const stop of TIMELINE_STOPS) {
		assertStrictEquals(timelineStopOf(timelineScaleOf(stop)), stop);
	}
});

// #region Following the reader
const TZ = "Europe/London";
const NOW = Date.parse("2026-11-12T09:30:00.000Z");
const MONDAY = Date.parse("2026-11-09T00:00:00.000Z");
const opened = { view: "week", focus: NOW, timelineStop: "month" } as const;
const state = (over: Partial<Parameters<typeof nextCalendarAddress>[1]> = {}) => ({
	view: "week" as const,
	focus: MONDAY,
	timelineScale: timelineScaleOf("month"),
	...over,
});

Deno.test("a calendar that has not moved writes nothing, though its Week reports its Monday", () => {
	assertEquals(nextCalendarAddress({}, state(), opened, TZ), {
		view: undefined,
		date: undefined,
		zoom: undefined,
		kind: undefined,
	});
});

Deno.test("changing the view writes it; moving to another week writes the day", () => {
	assertEquals(nextCalendarAddress({}, state({ view: "month" }), opened, TZ).view, "month");
	const next = Date.parse("2026-11-16T00:00:00.000Z");
	assertEquals(nextCalendarAddress({}, state({ focus: next }), opened, TZ).date, "2026-11-16");
});

Deno.test("an addressed day is kept while its period is on screen", () => {
	const current = { view: "month", date: "2027-09-01" as IsoDate } as const;
	const septFirstRow = Date.parse("2027-08-30T00:00:00.000Z");
	assertEquals(
		nextCalendarAddress(current, state({ view: "month", focus: septFirstRow }), opened, TZ).date,
		"2027-09-01",
	);
});

Deno.test("zoom is written only on the Timeline, once it leaves the stop it opened at", () => {
	const tl = (stop: "month" | "year") =>
		state({ view: "timeline", timelineScale: timelineScaleOf(stop) });
	assertEquals(nextCalendarAddress({}, tl("month"), opened, TZ).zoom, undefined);
	assertEquals(nextCalendarAddress({}, tl("year"), opened, TZ).zoom, "year");
	assertEquals(
		nextCalendarAddress({ view: "timeline", zoom: "year" }, tl("year"), opened, TZ).zoom,
		"year",
	);
});

Deno.test("kind follows the filter", () => {
	assertEquals(nextCalendarAddress({}, state({ kind: "reminder" }), opened, TZ).kind, "reminder");
});
// #endregion

Deno.test("kind and the Event · Reminder deny list are one fact", () => {
	assertEquals(hiddenClassesFor(undefined), []);
	assertEquals(hiddenClassesFor("event"), ["reminder"]);
	assertEquals(hiddenClassesFor("reminder"), ["event"]);
	assertEquals(kindOfHidden([]), undefined);
	assertEquals(kindOfHidden(["reminder"]), "event");
	assertEquals(kindOfHidden(["event"]), "reminder");
	assertEquals(kindOfHidden(["event", "reminder"]), undefined);
});
// #endregion
