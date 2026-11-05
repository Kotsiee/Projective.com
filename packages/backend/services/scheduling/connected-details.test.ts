import { assertEquals, assertFalse } from "@std/assert";
import type { CalendarEvent } from "@projective/types/scheduling";
import { applyOwnDetails, type OwnEventDetails } from "./connected-details.ts";

const DAY = 86_400_000;

function entry(id: string, start: number): CalendarEvent {
	return {
		id,
		title: "",
		kind: "busy",
		start,
		end: start + 900_000,
		masked: true,
		organiser: { name: "Unknown", avatar: null, handle: null },
	};
}

function own(eventId: string, patch: Partial<OwnEventDetails> = {}): [string, OwnEventDetails] {
	return [eventId, {
		event_id: eventId,
		title: "Skin Care",
		location: null,
		description: null,
		series_id: "series-1",
		recurrence_rule: "FREQ=DAILY",
		join_url: null,
		...patch,
	}];
}

Deno.test("a series reads as Projective's own: the first here is its master, whatever order they came in", () => {
	const events = [entry("c", 3 * DAY), entry("a", DAY), entry("b", 2 * DAY)];
	const [c, a, b] = applyOwnDetails(events, new Map([own("a"), own("b"), own("c")]));
	assertEquals(a.recurrenceRule, "FREQ=DAILY");
	assertEquals(a.recurrenceParentId, undefined);
	assertEquals([b.recurrenceParentId, c.recurrenceParentId], ["a", "a"]);
	assertEquals([b.recurrenceRule, c.recurrenceRule], [undefined, undefined]);
});

Deno.test("what the owner reads opens the entry to them, and it stays marked as a connected one", () => {
	const [named] = applyOwnDetails(
		[entry("a", DAY)],
		new Map([own("a", { location: "The clinic", description: "<p>Notes</p>", series_id: null })]),
	);
	assertEquals(named.title, "Skin Care");
	assertEquals(named.location, "The clinic");
	assertEquals(named.description, "<p>Notes</p>");
	assertEquals(named.connected, true);
	assertFalse("masked" in named);
	assertFalse("organiser" in named);
});

Deno.test("a meeting link becomes the entry's room, named by its host, and a bad one is no room", () => {
	const joined = (join_url: string) =>
		applyOwnDetails([entry("a", DAY)], new Map([own("a", { join_url })]))[0].meeting;
	assertEquals(joined("https://meet.google.com/abc-defg-hij"), {
		provider: "google",
		providerLabel: "Google Meet",
		joinUrl: "https://meet.google.com/abc-defg-hij",
		passcode: null,
		details: null,
		pending: false,
	});
	assertEquals(joined("https://us02web.zoom.us/j/123")?.provider, "zoom");
	assertEquals(joined("https://example.com/room")?.provider, "custom");
	assertEquals(joined("https://"), undefined);
});

Deno.test("an entry its owner has no details for is left masked, and one with no title reads Busy", () => {
	const [bare, untitled] = applyOwnDetails(
		[entry("bare", DAY), entry("untitled", DAY)],
		new Map([own("untitled", { title: null, series_id: null })]),
	);
	assertEquals(bare.masked, true);
	assertEquals(bare.connected, undefined);
	assertEquals(untitled.title, "Busy");
});

Deno.test("notes a series shares go once, and an occurrence's own stay on it", () => {
	const notes = { description: "Shared" };
	const [, same, changed] = applyOwnDetails(
		[entry("a", DAY), entry("b", 2 * DAY), entry("c", 3 * DAY)],
		new Map([own("a", notes), own("b", notes), own("c", { description: "Moved to the gym" })]),
	);
	assertEquals(same.description, undefined);
	assertEquals(changed.description, "Moved to the gym");
});

Deno.test("two series on one page stay two, and a series with no rule yet still lists once", () => {
	const [a, b, c] = applyOwnDetails(
		[entry("a", DAY), entry("b", 2 * DAY), entry("c", 2 * DAY)],
		new Map([
			own("a", { recurrence_rule: null }),
			own("b", { recurrence_rule: null }),
			own("c", { series_id: "series-2" }),
		]),
	);
	assertEquals(a.recurrenceRule, undefined);
	assertEquals(b.recurrenceParentId, "a");
	assertEquals(c.recurrenceRule, "FREQ=DAILY");
});
