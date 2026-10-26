import {
	assert,
	assertEquals,
	assertExists,
	assertNotStrictEquals,
	assertStrictEquals,
} from "@std/assert";
import {
	announceCreated,
	announceDeleted,
	announceOvernight,
	bandLabel,
	ruleName,
} from "./announce.ts";
import { addMonths, monthMatrix, parseMinutes, startOfWeek, weekdayOf } from "./civil.ts";
import { dragOutcome } from "./drag.ts";
import { type KeyInput, keyToAction } from "./keymap.ts";
import { bucketByDate, explanationLines, summarise } from "./month.ts";
import { HISTORY_DEPTH, initialState, reduce, type SchedulerState } from "./reducer.ts";
import type { Preset, RuleDraft } from "./types.ts";

// #region Fixtures
const TODAY = "2026-10-14";

function weekly(
	id: string,
	days: number[],
	bands: [number, number][],
	extra: Partial<RuleDraft> = {},
): RuleDraft {
	return {
		id,
		layer: "working_hours",
		effect: "add",
		pattern: { type: "weekly", days, interval: 1 },
		condition: { unlessWeekdays: [] },
		bands: bands.map(([start, end]) => ({ start, end })),
		startsOn: "2026-10-12",
		endsOn: null,
		priority: 50,
		label: "",
		active: true,
		...extra,
	};
}

function preset(rules: RuleDraft[] = []): Preset {
	return {
		id: "p1",
		name: "Default",
		description: "",
		timezone: "UTC",
		isDefault: true,
		scope: "library",
		blueprintId: null,
		rules,
		archivedAt: null,
	};
}

function start(rules: RuleDraft[] = []): SchedulerState {
	return initialState(preset(rules), { today: TODAY, weekStartsOn: 1 });
}

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
	key: k,
	shiftKey: false,
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	...mods,
});
// #endregion

// #region Civil
Deno.test("civil: weekdays, week starts, month grid and time parsing", () => {
	assertEquals(weekdayOf(TODAY), 3);
	assertEquals(startOfWeek(TODAY, 1), "2026-10-12");
	assertEquals(startOfWeek(TODAY, 0), "2026-10-11");
	assertEquals(addMonths("2026-12", 1), "2027-01");
	assertEquals(addMonths("2026-01", -1), "2025-12");
	const grid = monthMatrix("2026-10", 1);
	assertEquals(grid.length, 42);
	assertEquals(grid[0], "2026-09-28");
	assertEquals(parseMinutes("24:00"), 1440);
	assertEquals(parseMinutes("24:15"), null);
	assertEquals(parseMinutes("09:3"), null);
});
// #endregion

// #region Reducer: create
Deno.test("reduce: create on a day with no weekly rule mints a weekly add rule", () => {
	const s = reduce(start(), { type: "createBand", day: 3, start: 360, end: 720 });
	assertEquals(s.draft.rules.length, 1);
	const [rule] = s.draft.rules;
	assertEquals(rule.pattern, { type: "weekly", days: [3], interval: 1 });
	assertEquals(rule.bands, [{ start: 360, end: 720 }]);
	assertEquals(rule.layer, "working_hours");
	assertEquals(rule.effect, "add");
	assertEquals(rule.startsOn, "2026-10-12");
	assertEquals(s.selection, { ruleId: rule.id, bandIndex: 0, day: 3 });
	assertEquals(s.past.length, 1);
	assertEquals(s.announcement, "Created Wednesday, 06:00 to 12:00, working hours.");
});

Deno.test("reduce: create on a day a weekly add rule covers adds the band to that rule", () => {
	const s = reduce(start([weekly("w", [1, 2, 3, 4, 5], [[540, 1050]])]), {
		type: "createBand",
		day: 3,
		start: 1080,
		end: 1140,
	});
	assertEquals(s.draft.rules.length, 1);
	assertEquals(s.draft.rules[0].bands, [{ start: 540, end: 1050 }, { start: 1080, end: 1140 }]);
	assertEquals(s.selection, { ruleId: "w", bandIndex: 1, day: 3 });
});

Deno.test("reduce: create merges an overlapping band and snaps to the grid", () => {
	const s = reduce(start([weekly("w", [3], [[540, 600]])]), {
		type: "createBand",
		day: 3,
		start: 592,
		end: 668,
	});
	assertEquals(s.draft.rules[0].bands, [{ start: 540, end: 675 }]);
});

Deno.test("reduce: create on the call layer never joins a working-hours rule", () => {
	let s = reduce(start([weekly("w", [3], [[540, 1020]])]), {
		type: "setLayer",
		layer: "call_window",
	});
	s = reduce(s, { type: "createBand", day: 3, start: 600, end: 660 });
	assertEquals(s.draft.rules.length, 2);
	assertEquals(s.draft.rules[1].layer, "call_window");
	assertEquals(s.draft.rules[0].bands, [{ start: 540, end: 1020 }]);
});

Deno.test("reduce: an overnight create is stored as two bands on two days", () => {
	const s = reduce(start(), { type: "createBand", day: 3, start: 1380, end: 60 });
	const wed = s.draft.rules.find((r) => r.pattern.type === "weekly" && r.pattern.days.includes(3));
	const thu = s.draft.rules.find((r) => r.pattern.type === "weekly" && r.pattern.days.includes(4));
	assertExists(wed);
	assertExists(thu);
	assertNotStrictEquals(wed.id, thu.id);
	assertEquals(wed.bands, [{ start: 1380, end: 1440 }]);
	assertEquals(thu.bands, [{ start: 0, end: 60 }]);
	assertEquals(s.past.length, 1);
	assertEquals(
		s.announcement,
		"Created Wednesday 23:00 to Thursday 01:00, working hours, stored as two bands.",
	);
});

Deno.test("reduce: an overnight create into a two-day rule keeps the selection on the first part", () => {
	const s = reduce(start([weekly("w", [3, 4], [[540, 600]])]), {
		type: "createBand",
		day: 3,
		start: 1380,
		end: 1500,
	});
	assertEquals(s.draft.rules[0].bands, [{ start: 0, end: 60 }, { start: 540, end: 600 }, {
		start: 1380,
		end: 1440,
	}]);
	assertEquals(s.selection, { ruleId: "w", bandIndex: 2, day: 3 });
});
// #endregion

// #region Reducer: move, resize, duplicate
Deno.test("reduce: move in time keeps the length and clamps to the day", () => {
	const base = start([weekly("w", [3], [[360, 720]])]);
	const s = reduce(base, {
		type: "moveBand",
		ruleId: "w",
		bandIndex: 0,
		day: 3,
		toDay: 3,
		minutes: 60,
	});
	assertEquals(s.draft.rules[0].bands, [{ start: 420, end: 780 }]);
	assertEquals(s.cursor, { day: 3, minute: 420 });
	assertEquals(s.announcement, "Moved to Wednesday, 07:00 to 13:00.");
	const late = reduce(base, {
		type: "moveBand",
		ruleId: "w",
		bandIndex: 0,
		day: 3,
		toDay: 3,
		minutes: 2000,
	});
	assertEquals(late.draft.rules[0].bands, [{ start: 1080, end: 1440 }]);
});

Deno.test("reduce: move across days shifts a one-band rule's days", () => {
	const s = reduce(start([weekly("w", [1, 3], [[540, 600]])]), {
		type: "moveBand",
		ruleId: "w",
		bandIndex: 0,
		day: 3,
		toDay: 4,
		minutes: 0,
	});
	assertEquals(s.draft.rules[0].pattern, { type: "weekly", days: [2, 4], interval: 1 });
	assertEquals(s.selection, { ruleId: "w", bandIndex: 0, day: 4 });
});

Deno.test("reduce: move across days forks one band out of a split-shift rule", () => {
	const s = reduce(start([weekly("w", [3], [[360, 720], [840, 1140]])]), {
		type: "moveBand",
		ruleId: "w",
		bandIndex: 1,
		day: 3,
		toDay: 4,
		minutes: 0,
	});
	assertEquals(s.draft.rules.length, 2);
	assertEquals(s.draft.rules[0].bands, [{ start: 360, end: 720 }]);
	const fork = s.draft.rules[1];
	assertEquals(fork.pattern, { type: "weekly", days: [4], interval: 1 });
	assertEquals(fork.bands, [{ start: 840, end: 1140 }]);
	assertEquals(s.selection, { ruleId: fork.id, bandIndex: 0, day: 4 });
});

Deno.test("reduce: resize moves one edge, never past the other", () => {
	const base = start([weekly("w", [3], [[360, 720]])]);
	const end = reduce(base, {
		type: "resizeBand",
		ruleId: "w",
		bandIndex: 0,
		day: 3,
		edge: "end",
		minutes: 15,
	});
	assertEquals(end.draft.rules[0].bands, [{ start: 360, end: 735 }]);
	assertEquals(end.announcement, "Resized to Wednesday, 06:00 to 12:15.");
	const startEdge = reduce(base, {
		type: "resizeBand",
		ruleId: "w",
		bandIndex: 0,
		day: 3,
		edge: "start",
		minutes: 1000,
	});
	assertEquals(startEdge.draft.rules[0].bands, [{ start: 705, end: 720 }]);
	const noop = reduce(base, {
		type: "resizeBand",
		ruleId: "w",
		bandIndex: 0,
		day: 3,
		edge: "start",
		minutes: -1000,
	});
	assertEquals(noop.draft.rules[0].bands, [{ start: 0, end: 720 }]);
});

Deno.test("reduce: resize that changes nothing returns the same state", () => {
	const base = start([weekly("w", [3], [[0, 720]])]);
	const s = reduce(base, {
		type: "resizeBand",
		ruleId: "w",
		bandIndex: 0,
		day: 3,
		edge: "start",
		minutes: -15,
	});
	assertStrictEquals(s, base);
});

Deno.test("reduce: duplicate to an uncovered day mints a rule there with the band's layer", () => {
	const base = start([weekly("c", [3], [[600, 660]], { layer: "call_window" })]);
	const s = reduce(base, { type: "duplicateBand", ruleId: "c", bandIndex: 0, day: 3, toDay: 5 });
	assertEquals(s.draft.rules.length, 2);
	const copy = s.draft.rules[1];
	assertEquals(copy.layer, "call_window");
	assertEquals(copy.pattern, { type: "weekly", days: [5], interval: 1 });
	assertEquals(copy.bands, [{ start: 600, end: 660 }]);
	assertEquals(s.announcement, "Duplicated to Friday, 10:00 to 11:00.");
});
// #endregion

// #region Reducer: delete, history, templates
Deno.test("reduce: deleting one of two bands keeps the rule", () => {
	const s = reduce(start([weekly("w", [3], [[360, 720], [840, 1140]])]), {
		type: "deleteBand",
		ruleId: "w",
		bandIndex: 0,
		day: 3,
	});
	assertEquals(s.draft.rules[0].bands, [{ start: 840, end: 1140 }]);
	assertEquals(s.selection, null);
});

Deno.test("reduce: deleting the last band removes the rule, and undo restores it", () => {
	let s = reduce(start([weekly("w", [3], [[360, 720]])]), { type: "edit", ruleId: "w" });
	s = reduce(s, { type: "deleteBand", ruleId: "w", bandIndex: 0, day: 3 });
	assertEquals(s.draft.rules, []);
	assertEquals(s.editing, null);
	assertEquals(
		s.announcement,
		"Deleted Wednesday, 06:00 to 12:00, working hours. Its rule was removed; undo to restore it.",
	);
	const back = reduce(s, { type: "undo" });
	assertEquals(back.draft.rules.map((r) => r.id), ["w"]);
	assertEquals(back.announcement, "Undone.");
});

Deno.test("reduce: undo and redo walk the history; a new edit clears redo", () => {
	const s0 = start();
	const s1 = reduce(s0, { type: "createBand", day: 1, start: 540, end: 600 });
	const s2 = reduce(s1, { type: "createBand", day: 2, start: 540, end: 600 });
	const u1 = reduce(s2, { type: "undo" });
	assertStrictEquals(u1.draft, s1.draft);
	const u2 = reduce(u1, { type: "undo" });
	assertStrictEquals(u2.draft, s0.draft);
	assertEquals(reduce(u2, { type: "undo" }).announcement, "Nothing to undo.");
	const r1 = reduce(u2, { type: "redo" });
	assertStrictEquals(r1.draft, s1.draft);
	const branched = reduce(r1, { type: "createBand", day: 4, start: 540, end: 600 });
	assertEquals(branched.future, []);
	assertEquals(reduce(branched, { type: "redo" }).announcement, "Nothing to redo.");
});

Deno.test("reduce: rule actions add, replace and delete with history", () => {
	const base = {
		...start([weekly("w", [3], [[540, 600]])]),
		cursor: { day: 5 as const, minute: 0 },
	};
	const added = reduce(base, { type: "addRule" });
	const fresh = added.draft.rules[1];
	assertEquals(fresh.pattern, { type: "weekly", days: [5], interval: 1 });
	assertEquals(fresh.bands, [{ start: 540, end: 1020 }]);
	assertEquals(added.editing, fresh.id);
	const paused = reduce(added, { type: "upsertRule", rule: { ...fresh, active: false } });
	assertEquals(paused.draft.rules[1].active, false);
	assertEquals(paused.draft.rules.length, 2);
	const removed = reduce(paused, { type: "deleteRule", ruleId: fresh.id, name: "Fridays" });
	assertEquals(removed.draft.rules.map((r) => r.id), ["w"]);
	assertEquals(removed.editing, null);
	assertEquals(removed.announcement, "Deleted rule “Fridays”.");
	assertEquals(removed.past.length, 3);
	assertStrictEquals(reduce(removed, { type: "deleteRule", ruleId: "missing" }), removed);
});

Deno.test("reduce: history is capped at the plan's depth", () => {
	let s = start();
	for (let i = 0; i < HISTORY_DEPTH + 10; i++) {
		s = reduce(s, { type: "createBand", day: 1, start: 0, end: 15 + (i % 2) * 15 });
	}
	assertEquals(s.past.length, HISTORY_DEPTH);
});

Deno.test("reduce: view-only actions never enter the history", () => {
	let s = start([weekly("w", [3], [[540, 600]])]);
	s = reduce(s, { type: "setLayer", layer: "call_window" });
	s = reduce(s, { type: "setSnap", snap: 30 });
	s = reduce(s, { type: "setView", view: "month" });
	s = reduce(s, { type: "shiftMonth", months: 1 });
	assertEquals(s.past.length, 0);
	assertEquals(s.focusMonth, "2026-11");
	assertEquals(s.announcement, "November 2026.");
});

Deno.test("reduce: renaming and making default are undoable draft edits; a no-op is not", () => {
	let s = start();
	assertStrictEquals(reduce(s, { type: "setDetails", name: "Default" }), s);
	s = reduce(s, { type: "setDetails", name: "Evenings", isDefault: false });
	assertEquals([s.draft.name, s.draft.isDefault, s.past.length], ["Evenings", false, 1]);
	s = reduce(s, { type: "undo" });
	assertEquals([s.draft.name, s.draft.isDefault], ["Default", true]);
});

Deno.test("reduce: loading a template mints fresh ids and re-anchors to this week's Monday", () => {
	const s = reduce(start([weekly("rule-1", [1], [[0, 60]])]), {
		type: "loadTemplate",
		template: {
			key: "general",
			name: "General",
			description: "",
			rules: [
				{ ...weekly("general-work", [1, 2, 3, 4, 5], [[540, 1050]]), startsOn: "2026-01-05" },
				{
					...weekly("general-calls", [1, 2, 3, 4, 5], [[600, 720]], { layer: "call_window" }),
					startsOn: "2026-01-05",
				},
			],
		},
	});
	assertEquals(s.draft.rules.length, 2);
	assert(s.draft.rules.every((r) => r.id.startsWith("rule-") && r.id !== "rule-1"));
	assert(s.draft.rules.every((r) => r.startsOn === "2026-10-12"));
	assertEquals(new Set(s.draft.rules.map((r) => r.id)).size, 2);
	assertEquals(s.announcement, "Loaded General.");
});

Deno.test("reduce: moving the cursor onto a band selects it, preferring the active layer", () => {
	const base = start([
		weekly("w", [3], [[540, 1020]]),
		weekly("c", [3], [[600, 660]], { layer: "call_window" }),
	]);
	const onWork = reduce({ ...base, cursor: { day: 3, minute: 585 } }, {
		type: "moveCursor",
		toDay: 3,
		minutes: 15,
	});
	assertEquals(onWork.selection, { ruleId: "w", bandIndex: 0, day: 3 });
	const calls = reduce(onWork, { type: "setLayer", layer: "call_window" });
	const onCall = reduce(calls, { type: "moveCursor", toDay: 3, minutes: 15 });
	assertEquals(onCall.selection, { ruleId: "c", bandIndex: 0, day: 3 });
	const empty = reduce(onCall, { type: "moveCursor", toDay: 4, minutes: 0 });
	assertEquals(empty.selection, null);
});
// #endregion

// #region Keyboard
Deno.test("keyToAction: arrows move the cursor by one snap step or one column", () => {
	const s = { ...start(), cursor: { day: 3 as const, minute: 540 } };
	assertEquals(keyToAction(key("ArrowDown"), s), { type: "moveCursor", toDay: 3, minutes: 15 });
	assertEquals(keyToAction(key("ArrowUp"), { ...s, snap: 30 }), {
		type: "moveCursor",
		toDay: 3,
		minutes: -30,
	});
	assertEquals(keyToAction(key("ArrowRight"), s), { type: "moveCursor", toDay: 4, minutes: 0 });
	assertEquals(keyToAction(key("ArrowLeft"), { ...s, cursor: { day: 1, minute: 0 } }), null);
	assertEquals(keyToAction(key("ArrowRight"), { ...s, cursor: { day: 0, minute: 0 } }), null);
});

Deno.test("keyToAction: Enter creates a one-hour band, or edits the selection", () => {
	const s = { ...start(), cursor: { day: 2 as const, minute: 600 } };
	assertEquals(keyToAction(key("Enter"), s), { type: "createBand", day: 2, start: 600, end: 660 });
	const sel = { ...s, selection: { ruleId: "w", bandIndex: 0, day: 2 as const } };
	assertEquals(keyToAction(key("Enter"), sel), { type: "edit", ruleId: "w" });
});

Deno.test("keyToAction: selection keys resize, move, duplicate and delete", () => {
	const sel = { ruleId: "w", bandIndex: 0, day: 3 as const };
	const s = { ...start(), selection: sel };
	assertEquals(keyToAction(key("ArrowDown", { shiftKey: true }), s), {
		type: "resizeBand",
		...sel,
		edge: "end",
		minutes: 15,
	});
	assertEquals(keyToAction(key("ArrowUp", { shiftKey: true, altKey: true }), s), {
		type: "resizeBand",
		...sel,
		edge: "start",
		minutes: -15,
	});
	assertEquals(keyToAction(key("ArrowUp", { altKey: true }), s), {
		type: "moveBand",
		...sel,
		toDay: 3,
		minutes: -15,
	});
	assertEquals(keyToAction(key("ArrowRight", { altKey: true }), s), {
		type: "moveBand",
		...sel,
		toDay: 4,
		minutes: 0,
	});
	assertEquals(keyToAction(key("d", { ctrlKey: true }), s), {
		type: "duplicateBand",
		...sel,
		toDay: 4,
	});
	assertEquals(keyToAction(key("D", { metaKey: true }), s), {
		type: "duplicateBand",
		...sel,
		toDay: 4,
	});
	assertEquals(keyToAction(key("Delete"), s), { type: "deleteBand", ...sel });
	assertEquals(keyToAction(key("Backspace"), s), { type: "deleteBand", ...sel });
	assertEquals(keyToAction(key("Escape"), s), { type: "select", selection: null });
	const none = start();
	assertEquals(keyToAction(key("Delete"), none), null);
	assertEquals(keyToAction(key("ArrowDown", { shiftKey: true }), none), null);
	assertEquals(keyToAction(key("Escape"), none), null);
});

Deno.test("keyToAction: scheduler-wide keys work in either scope; arrows only on the canvas", () => {
	const s = start();
	const wide = { scope: "scheduler" as const, inTextInput: false };
	assertEquals(keyToAction(key("w"), s, wide), { type: "setLayer", layer: "working_hours" });
	assertEquals(keyToAction(key("C"), s, wide), { type: "setLayer", layer: "call_window" });
	assertEquals(keyToAction(key("C", { shiftKey: true }), s, wide), null);
	assertEquals(keyToAction(key("c"), s, wide), { type: "setLayer", layer: "call_window" });
	assertEquals(keyToAction(key("["), s, wide), { type: "shiftMonth", months: -1 });
	assertEquals(keyToAction(key("]"), s, wide), { type: "shiftMonth", months: 1 });
	assertEquals(keyToAction(key("z", { ctrlKey: true }), s, wide), { type: "undo" });
	assertEquals(keyToAction(key("Z", { ctrlKey: true, shiftKey: true }), s, wide), { type: "redo" });
	assertEquals(keyToAction(key("z", { metaKey: true, shiftKey: true }), s, wide), { type: "redo" });
	assertEquals(keyToAction(key("?", { shiftKey: true }), s, wide), { type: "openShortcuts" });
	assertEquals(keyToAction(key("ArrowDown"), s, wide), null);
	assertEquals(keyToAction(key("Enter"), s, wide), null);
});

Deno.test("keyToAction: every key belongs to a focused text input", () => {
	const s = start();
	const typing = { scope: "scheduler" as const, inTextInput: true };
	assertEquals(keyToAction(key("?", { shiftKey: true }), s, typing), null);
	assertEquals(keyToAction(key("w"), s, typing), null);
	assertEquals(keyToAction(key("z", { ctrlKey: true }), s, typing), null);
});
// #endregion

// #region Announcements + names
Deno.test("bandLabel: the plan §5.4 accessible name", () => {
	assertEquals(
		bandLabel(3, { start: 360, end: 720 }, "working_hours", "Every other Wednesday"),
		"Wednesday, 06:00 to 12:00, working hours, rule: Every other Wednesday",
	);
	assertEquals(
		bandLabel(0, { start: 600, end: 1440 }, "call_window", "Sundays"),
		"Sunday, 10:00 to 24:00, call window, rule: Sundays",
	);
});

Deno.test("ruleName: the label wins, else the recurrence segment of the sentence", () => {
	const describe = () => "Every other Wednesday from 6 Oct · 06:00–12:00 · working hours";
	assertEquals(ruleName(weekly("a", [3], [[0, 60]]), describe), "Every other Wednesday from 6 Oct");
	assertEquals(ruleName(weekly("a", [3], [[0, 60]], { label: "Mornings" }), describe), "Mornings");
});

Deno.test("announcements: create, overnight and delete sentences", () => {
	assertEquals(
		announceCreated(5, { start: 540, end: 1050 }, "call_window"),
		"Created Friday, 09:00 to 17:30, call window.",
	);
	assertEquals(
		announceOvernight(6, 1320, 0, 120, "working_hours"),
		"Created Saturday 22:00 to Sunday 02:00, working hours, stored as two bands.",
	);
	assertEquals(
		announceDeleted(1, { start: 0, end: 60 }, "working_hours", false),
		"Deleted Monday, 00:00 to 01:00, working hours.",
	);
});
// #endregion

// #region Drag
Deno.test("dragOutcome: dragging a new band into the next column is an overnight create", () => {
	const out = dragOutcome(
		{ kind: "create", origin: { day: 3, minute: 1382 }, layer: "working_hours" },
		{ day: 4, minute: 58 },
		15,
		1,
	);
	assertEquals(out.action, { type: "createBand", day: 3, start: 1380, end: 1500 });
	assertEquals(out.ghost.map((g) => [g.day, g.band]), [[3, { start: 1380, end: 1440 }], [4, {
		start: 0,
		end: 60,
	}]]);
	const reduced = reduce(start(), out.action ?? { type: "undo" });
	assertEquals(reduced.draft.rules.length, 2);
});

Deno.test("dragOutcome: an upward drag creates the same band as a downward one", () => {
	const spec = {
		kind: "create" as const,
		origin: { day: 2 as const, minute: 720 },
		layer: "working_hours" as const,
	};
	assertEquals(dragOutcome(spec, { day: 2, minute: 540 }, 15, 1).action, {
		type: "createBand",
		day: 2,
		start: 540,
		end: 720,
	});
});

Deno.test("dragOutcome: move snaps the delta; copy needs another day; edges resize", () => {
	const sel = { ruleId: "w", bandIndex: 0, day: 3 as const };
	const band = { start: 540, end: 600 };
	const base = {
		origin: { day: 3 as const, minute: 560 },
		layer: "working_hours" as const,
		sel,
		band,
	};
	assertEquals(dragOutcome({ ...base, kind: "move" }, { day: 3, minute: 622 }, 15, 1).action, {
		type: "moveBand",
		...sel,
		toDay: 3,
		minutes: 60,
	});
	assertEquals(dragOutcome({ ...base, kind: "move" }, { day: 3, minute: 562 }, 15, 1).action, null);
	assertEquals(dragOutcome({ ...base, kind: "copy" }, { day: 3, minute: 900 }, 15, 1).action, null);
	assertEquals(dragOutcome({ ...base, kind: "copy" }, { day: 6, minute: 900 }, 15, 1).action, {
		type: "duplicateBand",
		...sel,
		toDay: 6,
	});
	assertEquals(dragOutcome({ ...base, kind: "end" }, { day: 3, minute: 661 }, 15, 1).action, {
		type: "resizeBand",
		...sel,
		edge: "end",
		minutes: 60,
	});
	assertEquals(dragOutcome({ ...base, kind: "start" }, { day: 3, minute: 700 }, 15, 1).action, {
		type: "resizeBand",
		...sel,
		edge: "start",
		minutes: 45,
	});
});
// #endregion

// #region Month
Deno.test("bucketByDate: splits a span across local midnight and summarises each date", () => {
	const at = (iso: string) => Date.parse(iso);
	const buckets = bucketByDate([
		{
			kind: "working_hours",
			startsAt: at("2026-10-14T22:00:00Z"),
			endsAt: at("2026-10-15T02:00:00Z"),
			ruleIds: [],
		},
		{
			kind: "working_hours",
			startsAt: at("2026-10-14T09:00:00Z"),
			endsAt: at("2026-10-14T12:00:00Z"),
			ruleIds: [],
		},
		{
			kind: "call_window",
			startsAt: at("2026-10-14T10:00:00Z"),
			endsAt: at("2026-10-14T11:30:00Z"),
			ruleIds: [],
		},
	], "UTC");
	assertEquals(buckets.get("2026-10-14")?.working, [{ start: 540, end: 720 }, {
		start: 1320,
		end: 1440,
	}]);
	assertEquals(buckets.get("2026-10-15")?.working, [{ start: 0, end: 120 }]);
	assertEquals(summarise(buckets.get("2026-10-14")), "5h · calls 1h 30m");
	assertEquals(summarise(undefined), "Off");
});

Deno.test("explanationLines: names overrides, removals and clipped call time", () => {
	const lines = explanationLines([
		{
			layer: "working_hours",
			bands: [{ start: 900, end: 1020 }],
			contributed: [{ ruleId: "w", label: "Weekdays", bands: [] }],
			replacedBy: { ruleId: "r", label: "", bands: [] },
			outranked: [],
			removedBy: [{
				ruleId: "s",
				label: "Skip the 12th",
				bands: [],
				removed: [{ start: 540, end: 600 }],
			}],
			clipped: [],
		},
		{
			layer: "call_window",
			bands: [],
			contributed: [],
			outranked: [],
			removedBy: [],
			clipped: [{ start: 1080, end: 1140 }],
		},
	], (id, label) => label || `rule ${id}`);
	assertEquals(lines, [
		"Working hours 15:00–17:00",
		"Override “rule r” replaced working hours",
		"Rule “Skip the 12th” removed 09:00–10:00",
		"No calls",
		"Not offered outside working hours: 18:00–19:00",
	]);
});
// #endregion
