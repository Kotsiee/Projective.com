import { assertEquals, assertRejects } from "@std/assert";
import type { CalendarEvent, CalendarPage } from "@projective/types/scheduling";
import { CalendarPageSchema } from "@projective/types/scheduling";
import { entityProjectIds, mapPooled, mergeEntityCalendar } from "./entity-calendar.ts";

/**
 * The entity calendar's pure half (Decision #308): which projects a team's or business's console
 * Calendar reads, and how their pages fold into the one page the console draws.
 */

// #region Fixtures
const NOW = Date.UTC(2026, 9, 20, 9);
const META = { ref: "northwind", title: "Northwind", timezone: "Europe/London", now: NOW };

function ev(id: string, start: number, extra: Partial<CalendarEvent> = {}): CalendarEvent {
	return { id, title: id, kind: "sync", start, end: start + 1_800_000, ...extra };
}

function page(projectId: string, events: CalendarEvent[], viewerIsClient = false): CalendarPage {
	return {
		scope: "project",
		projectId,
		channelId: null,
		title: `Project ${projectId}`,
		timezone: "Europe/London",
		viewerIsClient,
		canCreate: true,
		events,
		now: NOW,
	};
}
// #endregion

// #region entityProjectIds
Deno.test("entityProjectIds: trims, drops blanks and case-insensitive duplicates, keeps order", () => {
	assertEquals(
		entityProjectIds([" prj-a ", "prj-b", "", "PRJ-A", "prj-c", "prj-b"]),
		["prj-a", "prj-b", "prj-c"],
	);
});

Deno.test("entityProjectIds: caps the read", () => {
	assertEquals(entityProjectIds(["prj-a", "prj-b", "prj-c"], 2), ["prj-a", "prj-b"]);
});
// #endregion

// #region mapPooled
Deno.test("mapPooled: answers in input order with at most `limit` in flight", async () => {
	let inFlight = 0;
	let peak = 0;
	const out = await mapPooled([30, 10, 20, 0, 5], 2, async (ms) => {
		inFlight++;
		peak = Math.max(peak, inFlight);
		await new Promise((r) => setTimeout(r, ms));
		inFlight--;
		return ms * 2;
	});
	assertEquals(out, [60, 20, 40, 0, 10]);
	assertEquals(peak, 2);
});

Deno.test("mapPooled: an empty list reads nothing", async () => {
	assertEquals(await mapPooled([], 4, () => Promise.reject(new Error("read"))), []);
});

Deno.test("mapPooled: one failed read fails the whole map", async () => {
	await assertRejects(() =>
		mapPooled(["a", "b"], 2, (x) => x === "b" ? Promise.reject(new Error("b")) : Promise.resolve(x))
	);
});
// #endregion

// #region mergeEntityCalendar
Deno.test("mergeEntityCalendar: unions, sorts by start, keeps each event once", () => {
	const merged = mergeEntityCalendar([
		page("prj-a", [ev("m2", NOW + 2), ev("due-1", NOW)]),
		page("prj-b", [ev("m1", NOW + 1), ev("m2", NOW + 2)]),
	], META);
	assertEquals(merged.events.map((e) => e.id), ["due-1", "m1", "m2"]);
	assertEquals(merged.events.find((e) => e.id === "m2")?.projectId, "prj-a");
});

Deno.test("mergeEntityCalendar: stamps each event's project, link and project-led meta", () => {
	const merged = mergeEntityCalendar([
		page("prj-a", [
			ev("due-s", NOW, { kind: "deadline", meta: "Stage deadline", href: "/projects/prj-a/stg-x" }),
			ev("meet", NOW + 1),
		]),
	], META);
	const [due, meet] = merged.events;
	assertEquals(due.projectId, "prj-a");
	assertEquals(due.href, "/projects/prj-a/stg-x");
	assertEquals(due.meta, "Project prj-a · Stage deadline");
	assertEquals(meet.href, "/projects/prj-a/calendar");
	assertEquals(meet.meta, "Project prj-a");
});

Deno.test("mergeEntityCalendar: an entity page, read-only, valid against the SSOT", () => {
	const merged = mergeEntityCalendar([page("prj-a", [ev("m", NOW)])], META);
	assertEquals(merged.scope, "entity");
	assertEquals(merged.projectId, "northwind");
	assertEquals(merged.channelId, null);
	assertEquals(merged.canCreate, false);
	assertEquals(merged.timezone, "Europe/London");
	assertEquals(merged.now, NOW);
	assertEquals(CalendarPageSchema.safeParse(merged).success, true);
});

Deno.test("mergeEntityCalendar: the viewer is the client only of a page of client-side projects", () => {
	assertEquals(mergeEntityCalendar([], META).viewerIsClient, false);
	assertEquals(
		mergeEntityCalendar([page("prj-a", [], true), page("prj-b", [], true)], META).viewerIsClient,
		true,
	);
	assertEquals(
		mergeEntityCalendar([page("prj-a", [], true), page("prj-b", [], false)], META).viewerIsClient,
		false,
	);
});

Deno.test("mergeEntityCalendar: no visible project is an empty calendar, not a missing one", () => {
	const merged = mergeEntityCalendar([], META);
	assertEquals(merged.events, []);
	assertEquals(CalendarPageSchema.safeParse(merged).success, true);
});

Deno.test("mergeEntityCalendar: an over-long project title is clamped into the meta bound", () => {
	const long = {
		...page("prj-a", [ev("m", NOW, { meta: "x".repeat(150) })]),
		title: "T".repeat(150),
	};
	const merged = mergeEntityCalendar([long], META);
	assertEquals(merged.events[0].meta!.length, 160);
	assertEquals(CalendarPageSchema.safeParse(merged).success, true);
});
// #endregion
