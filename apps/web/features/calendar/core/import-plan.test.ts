import { assert, assertEquals } from "@std/assert";
import {
	type CalendarEvent,
	ENTRY_BATCH_MAX,
	expandRRule,
	type IsoDate,
	parseRRule,
} from "@projective/types/scheduling";
import {
	agendaHtml,
	assignRoutine,
	AUTO_MERGE_MIN,
	buildImportPlan,
	entryFieldsOf,
	importBatches,
	type ImportItem,
	importRoomOf,
	inferRule,
	mergeGroups,
	normaliseRule,
	setIncluded,
	splitGroup,
	tallyPlan,
} from "./import-plan.ts";

const TZ = "Europe/London";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Monday 2 November 2026, 09:00 London (GMT). */
const MON = Date.UTC(2026, 10, 2, 9);

let n = 0;
function item(start: number, extra: Partial<ImportItem> = {}): ImportItem {
	return {
		key: `k${n++}`,
		uid: `u${n}`,
		title: "Standup",
		description: null,
		location: null,
		start,
		end: start + HOUR / 2,
		allDay: false,
		rrule: null,
		url: null,
		transparent: false,
		...extra,
	};
}

function plan(items: ImportItem[], existing: CalendarEvent[] = []) {
	return buildImportPlan({ items, cancelled: 0 }, existing, TZ);
}

// #region Rules
Deno.test("inferRule — daily, weekly on several days, every other week, monthly and yearly", () => {
	const at = (...days: number[]) => days.map((d) => ({ start: MON + d * DAY }));
	assertEquals(inferRule(at(0, 1, 2, 3), TZ), "FREQ=DAILY");
	assertEquals(inferRule(at(0, 2, 4, 7, 9, 11), TZ), "FREQ=WEEKLY;BYDAY=MO,WE,FR");
	assertEquals(inferRule(at(0, 14, 28), TZ), "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO");
	const monthly = [0, 1, 2].map((m) => ({ start: Date.UTC(2026, 10 + m, 5, 9) }));
	assertEquals(inferRule(monthly, TZ), "FREQ=MONTHLY;BYMONTHDAY=5");
	const yearly = [0, 1, 2].map((y) => ({ start: Date.UTC(2026 + y, 10, 5, 9) }));
	assertEquals(inferRule(yearly, TZ), "FREQ=YEARLY");
});

Deno.test("inferRule — refuses a set no one rule reproduces, and two entries on one day", () => {
	assertEquals(inferRule([0, 1, 9].map((d) => ({ start: MON + d * DAY })), TZ), null);
	assertEquals(inferRule([{ start: MON }, { start: MON + HOUR }], TZ), null);
	assertEquals(inferRule([{ start: MON }], TZ), null);
});

Deno.test("inferRule — an unprompted merge needs the pattern to recur, not just to fit one week", () => {
	const oneWeek = [0, 1, 5].map((d) => ({ start: MON + d * DAY }));
	assertEquals(inferRule(oneWeek, TZ), "FREQ=WEEKLY;BYDAY=MO,TU,SA");
	assertEquals(inferRule(oneWeek, TZ, { repeated: true }), null);
	const twoWeeks = [0, 1, 7, 8].map((d) => ({ start: MON + d * DAY }));
	assertEquals(inferRule(twoWeeks, TZ, { repeated: true }), "FREQ=WEEKLY;BYDAY=MO,TU");
});

Deno.test("inferRule — every rule it offers expands back to exactly the dates it was given", () => {
	const days = [0, 2, 7, 9, 14, 16];
	const rule = inferRule(days.map((d) => ({ start: MON + d * DAY })), TZ);
	assert(rule);
	const parsed = parseRRule(`${rule};UNTIL=20261118`);
	assert(parsed.ok);
	const from = "2026-11-02" as IsoDate;
	assertEquals(
		expandRRule(parsed.value, from, { from, to: "2026-11-18" as IsoDate }),
		["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11", "2026-11-16", "2026-11-18"],
	);
});

Deno.test("normaliseRule — drops the file's bound, keeps the platform grammar, refuses the rest", () => {
	assertEquals(normaliseRule("RRULE:FREQ=WEEKLY;COUNT=10;BYDAY=TU"), "FREQ=WEEKLY;BYDAY=TU");
	assertEquals(normaliseRule("FREQ=DAILY;UNTIL=20270101T000000Z"), "FREQ=DAILY");
	assertEquals(normaliseRule("FREQ=HOURLY"), null);
});
// #endregion

// #region Planning
Deno.test("buildImportPlan — a run of identical entries becomes one repeating entry", () => {
	const items = [0, 7, 14, 21].map((d) => item(MON + d * DAY));
	const p = plan(items);
	assertEquals(p.groups.length, 1);
	assertEquals(p.groups[0].origin, "detected");
	assertEquals(p.groups[0].rule, "FREQ=WEEKLY;BYDAY=MO");
	assertEquals(tallyPlan(p), { entries: 4, series: 1, singles: 0, routines: 0, onCalendar: 0 });
});

Deno.test("buildImportPlan — entries that differ in time, agenda or place stay apart", () => {
	const base = [0, 7].map((d) => item(MON + d * DAY));
	const late = item(MON + 14 * DAY + HOUR);
	const elsewhere = item(MON + 21 * DAY, { location: "Studio" });
	const p = plan([...base, late, elsewhere]);
	assertEquals(p.groups.every((g) => g.origin === "single"), true);
	assertEquals(p.groups.length, 4);
	assert(AUTO_MERGE_MIN > base.length, "two alike are not enough to merge unasked");
});

Deno.test("buildImportPlan — the file's own series is kept whole by UID with its rule", () => {
	const series = [0, 7, 14].map((d) =>
		item(MON + d * DAY, { uid: "s", rrule: "FREQ=WEEKLY;COUNT=3" })
	);
	const p = plan([...series, item(MON + 3 * DAY, { title: "Lunch" })]);
	const kept = p.groups.find((g) => g.origin === "file");
	assert(kept);
	assertEquals(kept.items.length, 3);
	assertEquals(kept.rule, "FREQ=WEEKLY");
});

Deno.test("buildImportPlan — what is already on the calendar, or twice in the file, is never written twice", () => {
	const a = item(MON);
	const copy = { ...item(MON), key: "copy" };
	const b = item(MON + DAY, { title: "Review" });
	const existing: CalendarEvent[] = [{
		id: "e1",
		title: "review ",
		kind: "sync",
		start: b.start,
		end: b.end,
	}];
	const p = plan([a, copy, b], existing);
	assertEquals(p.copies, 1);
	const onCal = p.groups.find((g) => g.items[0].key === b.key);
	assert(onCal);
	assertEquals(onCal.duplicates, 1);
	assertEquals(onCal.included, false);
	assertEquals(tallyPlan(p).entries, 1);
	const batches = importBatches(setIncluded(p, [onCal.id], true), TZ);
	assertEquals(batches.flatMap((x) => x.entries).map((e) => e.title), ["Standup"]);
});
// #endregion

// #region The reader's choices
Deno.test("mergeGroups — singles merge into a series, and a pattern that is not one is refused", () => {
	const p = plan([0, 2, 4].map((d) => item(MON + d * DAY, { title: `Run ${d}` })));
	const ids = p.groups.map((g) => g.id);
	const merged = mergeGroups(p, ids, TZ);
	assert(merged.ok);
	assertEquals(merged.plan.groups.length, 1);
	assertEquals(merged.plan.groups[0].rule, "FREQ=DAILY;INTERVAL=2");
	const odd = plan([0, 1, 9].map((d) => item(MON + d * DAY, { title: `X ${d}` })));
	const refused = mergeGroups(odd, odd.groups.map((g) => g.id), TZ);
	assert(!refused.ok && refused.message.includes("routine"));
});

Deno.test("splitGroup — a series goes back to single entries", () => {
	const p = plan([0, 7, 14].map((d) => item(MON + d * DAY)));
	const split = splitGroup(p, p.groups[0].id);
	assertEquals(split.groups.length, 3);
	assert(split.groups.every((g) => g.rule === null && g.items.length === 1));
});

Deno.test("assignRoutine — the chosen groups go into a new routine, created once", () => {
	const p = plan([item(MON, { title: "Gym" }), item(MON + 2 * DAY, { title: "Swim" })]);
	const ids = p.groups.map((g) => g.id);
	assertEquals(assignRoutine(p, ids, { name: "  ", behavior: "passive" }).ok, false);
	const done = assignRoutine(p, ids, { name: "Fitness", behavior: "passive" });
	assert(done.ok);
	assertEquals(done.plan.routines.map((r) => r.name), ["Fitness"]);
	const batches = importBatches(done.plan, TZ);
	assertEquals(batches.length, 1);
	assertEquals(batches[0].routine?.name, "Fitness");
	assertEquals(tallyPlan(done.plan).routines, 1);
	// Leaving every member out drops the routine too.
	const none = setIncluded(done.plan, ids, false);
	assertEquals(tallyPlan(none).routines, 0);
});
// #endregion

// #region Laying it down
Deno.test("importBatches — a series is one master with its rule, bounded at its last date", () => {
	const p = plan([0, 7, 14].map((d) => item(MON + d * DAY)));
	const [batch] = importBatches(p, TZ);
	assertEquals(batch.entries.length, 3);
	assertEquals(batch.entries[0].recurrenceRule, "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261116");
	assert(batch.entries.slice(1).every((e) => e.recurrenceRule === undefined));
});

Deno.test("importBatches — a series past the door's cap is laid down in bounded batches, none lost", () => {
	const days = Array.from({ length: ENTRY_BATCH_MAX + 5 }, (_, i) => i);
	const p = plan(days.map((d) => item(MON + d * DAY)));
	const batches = importBatches(p, TZ);
	assertEquals(batches.length, 2);
	assertEquals(batches.flatMap((b) => b.entries).length, days.length);
	assert(batches.every((b) => b.entries.length <= ENTRY_BATCH_MAX));
	assert(batches.every((b) => b.entries[0].recurrenceRule?.startsWith("FREQ=DAILY;UNTIL=")));
});

Deno.test("importBatches — singles share a batch; one with a join link gets its own room", () => {
	const p = plan([
		item(MON, { title: "A" }),
		item(MON + DAY, { title: "B" }),
		item(MON + 2 * DAY, { title: "Call", url: "https://zoom.us/j/42" }),
	]);
	const batches = importBatches(p, TZ);
	assertEquals(batches.length, 2);
	const room = batches.find((b) => b.room);
	assertEquals(room?.room, { provider: "zoom", link: "https://zoom.us/j/42", passcode: null });
	assertEquals(batches.find((b) => !b.room)?.entries.length, 2);
});

Deno.test("entryFieldsOf — an Event, an all-day Event, or a Reminder, each holding its time", () => {
	const timed = entryFieldsOf(item(MON, { location: " Studio " }));
	assertEquals(timed.kind, "sync");
	assertEquals(timed.location, "Studio");
	assertEquals(timed.availabilityBehavior, "disruptive");
	const day = entryFieldsOf(item(MON, { allDay: true, end: MON + DAY }));
	assertEquals(day.allDay, true);
	const reminder = entryFieldsOf(item(MON, { end: MON }));
	assertEquals(reminder.kind, "general");
	assertEquals(entryFieldsOf(item(MON, { title: "   " })).title, "Untitled event");
	// A block the file marks free is imported Passive, so it never starts blocking bookings.
	assertEquals(entryFieldsOf(item(MON, { transparent: true })).availabilityBehavior, "passive");
});

Deno.test("buildImportPlan — free and busy copies of one entry are never merged together", () => {
	const items = [0, 7, 14].map((d) => item(MON + d * DAY, { transparent: d === 7 }));
	assert(plan(items).groups.every((g) => g.origin === "single"));
});

Deno.test("agendaHtml — plain text becomes escaped paragraphs; HTML passes to the sanitiser", () => {
	assertEquals(
		agendaHtml("Bring <notes>\nand coffee\n\nThanks"),
		"<p>Bring &lt;notes&gt;<br>and coffee</p><p>Thanks</p>",
	);
	assertEquals(agendaHtml("<p>Agenda</p>"), "<p>Agenda</p>");
	assertEquals(agendaHtml("   "), undefined);
	assert((agendaHtml("x".repeat(9000)) ?? "").length <= 8000);
});

Deno.test("importRoomOf — a named link on any host, a known provider in prose, nothing guessed", () => {
	assertEquals(
		importRoomOf({ url: null, location: "https://meet.example.com/x", description: null })
			?.provider,
		"custom",
	);
	assertEquals(
		importRoomOf({ url: null, location: null, description: "Join: https://zoom.us/j/1 thanks" })
			?.link,
		"https://zoom.us/j/1",
	);
	assertEquals(
		importRoomOf({ url: null, location: null, description: "Notes at https://example.com/doc" }),
		null,
	);
	assertEquals(
		importRoomOf({ url: "http://insecure.test", location: null, description: null }),
		null,
	);
});
// #endregion
