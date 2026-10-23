import { assert, assertEquals } from "@std/assert";
import type { CalendarEvent } from "@projective/types/scheduling";
import { parseIcsCalendar } from "@projective/types/scheduling";
import {
	buildExportFile,
	customRangeError,
	type ExportCriteria,
	exportFacets,
	selectForExport,
} from "./calendar-export.ts";

const NOW = Date.UTC(2026, 9, 23, 12);
const H = 3_600_000;
const TZ = "Europe/London";

const EVENTS: CalendarEvent[] = [
	{
		id: "past",
		title: "Kickoff",
		kind: "sync",
		start: NOW - 48 * H,
		end: NOW - 47 * H,
		sources: ["projective", "google"],
		organiser: { name: "Inês Duarte", avatar: null, handle: "inesduarte" },
	},
	{
		id: "live",
		title: "Review",
		kind: "sync",
		status: "tentative",
		start: NOW - H,
		end: NOW + H,
		sources: ["google"],
		organiser: { name: "Ren Koda", avatar: null, handle: "renkoda" },
	},
	{
		id: "due",
		title: "Brand guide due",
		kind: "deadline",
		start: NOW + 72 * H,
		end: NOW + 72 * H,
		sources: ["projective"],
	},
	{ id: "file", title: "Dentist", kind: "general", start: NOW + 96 * H, end: NOW + 97 * H },
	{
		id: "masked",
		title: "Busy",
		kind: "busy",
		status: "busy",
		masked: true,
		start: NOW + 24 * H,
		end: NOW + 25 * H,
	},
];

const ALL: ExportCriteria = {
	range: "all",
	from: null,
	to: null,
	kinds: ["sync", "deadline", "general", "busy"],
	statuses: ["confirmed", "tentative", "busy"],
	sources: ["projective", "google"],
	organiser: null,
};

function ids(criteria: Partial<ExportCriteria>): string[] {
	return selectForExport(EVENTS, { ...ALL, ...criteria }, NOW).events.map((e) => e.id);
}

// #region Facets
Deno.test("facets list only what unmasked entries contain, in first-seen order", () => {
	const facets = exportFacets(EVENTS);
	assertEquals(facets.kinds, ["sync", "deadline", "general"]);
	assertEquals(facets.statuses, ["confirmed", "tentative"]);
	assertEquals(facets.sources, ["projective", "google"]);
	assertEquals(facets.organisers, [
		{ key: "inesduarte", name: "Inês Duarte" },
		{ key: "renkoda", name: "Ren Koda" },
	]);
});
// #endregion

// #region Selection
Deno.test("a masked block is never selected, only counted", () => {
	const all = selectForExport(EVENTS, ALL, NOW);
	assertEquals(all.events.map((e) => e.id), ["past", "live", "due", "file"]);
	assertEquals(all.withheld, 1);
});

Deno.test("upcoming includes what is in progress, and past is everything that has ended", () => {
	assertEquals(ids({ range: "upcoming" }), ["live", "due", "file"]);
	assertEquals(ids({ range: "past" }), ["past"]);
});

Deno.test("a custom range keeps entries that overlap it, instants included", () => {
	assertEquals(ids({ range: "custom", from: NOW + 72 * H, to: NOW + 72 * H }), ["due"]);
	assertEquals(ids({ range: "custom", from: NOW, to: NOW + 80 * H }), ["live", "due"]);
});

Deno.test("each filter narrows, and they combine", () => {
	assertEquals(ids({ kinds: ["sync"] }), ["past", "live"]);
	assertEquals(ids({ statuses: ["tentative"] }), ["live"]);
	assertEquals(ids({ organiser: "inesduarte" }), ["past"]);
	assertEquals(ids({ kinds: ["sync"], range: "upcoming" }), ["live"]);
});

Deno.test("the calendars filter is a layer switch and never drops an entry with no calendar", () => {
	assertEquals(ids({ sources: ["projective"] }), ["past", "due", "file"]);
	assertEquals(ids({ sources: [] }), ["file"]);
});

Deno.test("a custom range is usable only with both ends in order", () => {
	assertEquals(customRangeError(ALL), null);
	assertEquals(customRangeError({ ...ALL, range: "custom" }), "Choose both a start and an end.");
	assertEquals(
		customRangeError({ ...ALL, range: "custom", from: NOW, to: NOW - H }),
		"The start is after the end.",
	);
	assertEquals(customRangeError({ ...ALL, range: "custom", from: NOW, to: NOW }), null);
});
// #endregion

// #region Files
Deno.test("each format is named by the day and carries its own media type", () => {
	const chosen = selectForExport(EVENTS, ALL, NOW).events;
	const context = { timezone: TZ, now: NOW, origin: "https://projective.test" };

	const ics = buildExportFile("ics", chosen, context);
	assertEquals(ics.filename, "projective-calendar-2026-10-23.ics");
	assertEquals(parseIcsCalendar(ics.content).events.length, chosen.length);

	const jcal = buildExportFile("jcal", chosen, context);
	assertEquals(jcal.filename, "projective-calendar-2026-10-23.json");
	assert(jcal.mime.startsWith("application/calendar+json"));
	const tree = JSON.parse(jcal.content);
	assertEquals(tree[0], "vcalendar");
	assertEquals(tree[2].length, chosen.length);

	const csv = buildExportFile("csv", chosen, context);
	assertEquals(csv.filename, "projective-calendar-2026-10-23.csv");
	assert(csv.content.startsWith("﻿Subject,"));
	assertEquals(csv.content.trim().split("\r\n").length, chosen.length + 1);
});
// #endregion
