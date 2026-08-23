import { assertEquals } from "@std/assert";
import {
	dragResidual,
	dragSteps,
	flickSteps,
	hourItems,
	meridiemItems,
	minuteItems,
	nearestIndex,
	quarterTurn,
	resolveMinutes,
	resolveTyped,
	wheelDeltaPx,
	wrapIndex,
} from "./tumbler.ts";
import { dayTimeBounds, formatTimeOfDay, withMinutes } from "./datetime.ts";

/**
 * Tests for the tumbler's reel model.
 *
 * These exist because of the background-tab rule: the drum's committed value is produced by pure
 * arithmetic on a synchronous pointer/wheel delta, precisely so it can be checked here without a
 * DOM, a frame, or a transition ever running. If any of this had been expressed as an animation
 * landing on a cell, none of it would be testable and none of it would work in a hidden tab.
 *
 * The cases deliberately cross the axes that produce off-by-one answers — a wrapping reel driven
 * from a NEGATIVE index, a bounded day, a 12-hour half whose first label is `12`, and a `min` that
 * does not sit on the minute grid — rather than sampling the happy path several times.
 */

// #region Reel arithmetic

Deno.test("wrapIndex — a reel is continuous in both directions", () => {
	assertEquals(wrapIndex(24, 24), 0, "23 → 00 is one step, not a stop");
	assertEquals(wrapIndex(-1, 24), 23, "dragging below the first cell reaches the last");
	// The trap: JS `%` keeps the sign of the dividend, so a bare `i % len` returns -1 here and every
	// caller indexes `undefined`. Dragging downward past the first cell is the ORDINARY case.
	assertEquals(wrapIndex(-25, 24), 23);
	assertEquals(wrapIndex(3, 0), 0, "an empty reel can never be indexed out of bounds");
});

Deno.test("dragSteps — dragging up increments, and a half cell has not moved yet", () => {
	assertEquals(dragSteps(-36, 36), 1, "one cell up = one step later");
	assertEquals(dragSteps(72, 36), -2, "two cells down = two steps earlier");
	assertEquals(dragSteps(-17, 36), 0, "under half a cell commits nothing");
	assertEquals(dragSteps(-100, 0), 0, "an unmeasured cell moves nothing rather than Infinity");
});

Deno.test("dragResidual — the transform only ever carries the sub-cell remainder", () => {
	// Whole cells are committed as VALUE, never as offset, so a frozen animation clock cannot leave
	// the reel resting between two numbers.
	assertEquals(dragResidual(-36, 36, dragSteps(-36, 36)), 0);
	// Exactly two and a half cells: `Math.round` breaks the tie toward `+∞`, so three whole steps are
	// committed and the reel is left half a cell BEHIND the finger rather than half a cell ahead.
	assertEquals(dragResidual(-90, 36, dragSteps(-90, 36)), 18);
	for (const dy of [-97, -90, -41, -18, 0, 5, 44, 121]) {
		const r = dragResidual(dy, 36, dragSteps(dy, 36));
		assertEquals(r > -18 && r <= 18, true, `residual ${r} escaped the half-cell band`);
	}
});

Deno.test("flickSteps — a release velocity resolves synchronously and is bounded", () => {
	assertEquals(flickSteps(0, 36), 0);
	// Upward flick (y decreasing) carries forward through later values.
	assertEquals(flickSteps(-1, 36) > 0, true);
	assertEquals(flickSteps(1, 36) < 0, true);
	// A stray fast sample must not spin most of a turn.
	assertEquals(flickSteps(-1000, 36), 12);
	assertEquals(flickSteps(1000, 36), -12);
	assertEquals(flickSteps(Number.NaN, 36), 0);
});

Deno.test("wheelDeltaPx — line and page deltas are not pixels", () => {
	assertEquals(wheelDeltaPx(3, 0, 36), 3, "a trackpad already reports pixels");
	assertEquals(wheelDeltaPx(3, 1, 36), 48, "a notched wheel reports lines");
	assertEquals(wheelDeltaPx(1, 2, 36), 108, "a page is three cells");
});

Deno.test("quarterTurn — one gesture, every column", () => {
	assertEquals(quarterTurn(24), 6);
	assertEquals(quarterTurn(12), 3);
	assertEquals(quarterTurn(2), 1, "never zero, or PageUp would do nothing on a short reel");
	assertEquals(quarterTurn(0), 1);
});

Deno.test("nearestIndex — a narrowed domain lands on the closest offered value", () => {
	const items = [{ value: 0, label: "00" }, { value: 30, label: "30" }];
	assertEquals(nearestIndex(items, 45), 1);
	assertEquals(nearestIndex(items, 10), 0);
	// Ties go earlier, so a value trapped between two offered ones never drifts LATER than asked.
	assertEquals(nearestIndex(items, 15), 0);
	assertEquals(nearestIndex([], 5), -1);
});

// #endregion

// #region Column domains

Deno.test("hourItems — 24-hour mode offers every hour a bounded day allows", () => {
	assertEquals(hourItems(false, 0, 0, 1439).length, 24);
	// 09:00–17:00 → hours 9…17. Hour 17 survives because 17:00 is legal even though 17:59 is not.
	const bounded = hourItems(false, 0, 9 * 60, 17 * 60);
	assertEquals(bounded.map((i) => i.value), [9, 10, 11, 12, 13, 14, 15, 16, 17]);
	assertEquals(bounded[0].label, "09");
});

Deno.test("hourItems — a 12-hour half reads 12, 1, 2 … 11", () => {
	const am = hourItems(true, 0, 0, 1439);
	assertEquals(am.map((i) => i.label), [
		"12",
		"01",
		"02",
		"03",
		"04",
		"05",
		"06",
		"07",
		"08",
		"09",
		"10",
		"11",
	]);
	// Midnight is the trap: hour 0 prints `12`, and `h % 12` prints `0`.
	assertEquals(am[0].value, 0);
	const pm = hourItems(true, 1, 0, 1439);
	assertEquals(pm[0], { value: 12, label: "12" }, "noon prints 12 too, and is hour 12");
	assertEquals(pm.at(-1), { value: 23, label: "11" });
});

Deno.test("minuteItems — the grid, and only the grid, on an unbounded hour", () => {
	const m = minuteItems(10, 5, 0, 1439);
	assertEquals(m.length, 12);
	assertEquals(m[0].value, 0);
	assertEquals(m.at(-1)?.value, 55, "no stray :59 grows on an hour nothing constrains");
});

Deno.test("minuteItems — an off-grid boundary is always reachable", () => {
	// With a 5-minute step and a min of 09:07, the grid alone makes 09:10 the earliest reachable
	// time and 09:07 — the earliest LEGAL one — unreachable. That is a picker refusing the value its
	// own caller asked for.
	const m = minuteItems(9, 5, 9 * 60 + 7, 17 * 60);
	assertEquals(m[0].value, 7);
	assertEquals(m.slice(1).map((i) => i.value), [10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);

	// The closing boundary behaves the same way, and the column never comes back empty even when the
	// window is narrower than one step.
	const tail = minuteItems(17, 15, 0, 17 * 60 + 4);
	assertEquals(tail.map((i) => i.value), [0, 4]);
	assertEquals(minuteItems(9, 60, 9 * 60 + 10, 9 * 60 + 20).map((i) => i.value), [10, 20]);
});

Deno.test("minuteItems — an hour outside the window offers nothing", () => {
	assertEquals(minuteItems(8, 5, 9 * 60, 17 * 60), []);
});

Deno.test("meridiemItems — a half with no legal hour is not offered", () => {
	assertEquals(meridiemItems(0, 1439).map((i) => i.label), ["AM", "PM"]);
	assertEquals(meridiemItems(13 * 60, 1439).map((i) => i.label), ["PM"]);
	assertEquals(meridiemItems(0, 9 * 60).map((i) => i.label), ["AM"]);
});

// #endregion

// #region Typed entry

Deno.test("resolveTyped — numeric entry matches the printed label, not the value", () => {
	const pm = hourItems(true, 1, 0, 1439);
	// `12` on a PM reel is hour 12. Matching TumblerItem.value would refuse the only entry that makes
	// sense on screen, because the value there is 12 while on an AM reel the same key means hour 0.
	assertEquals(pm[resolveTyped(pm, "12", true)].value, 12);
	const am = hourItems(true, 0, 0, 1439);
	assertEquals(am[resolveTyped(am, "12", true)].value, 0);

	const mins = minuteItems(10, 5, 0, 1439);
	assertEquals(mins[resolveTyped(mins, "05", true)].value, 5);
	// Over-typing without selecting first: the reader sees "11", so "0911" resolves to 11.
	assertEquals(pm[resolveTyped(pm, "0911", true)].label, "11");
	assertEquals(resolveTyped(mins, "", true), -1);
	assertEquals(resolveTyped(mins, "7", true), -1, "7 is not on a 5-minute reel");
});

Deno.test("resolveTyped — a meridiem takes a letter", () => {
	const items = meridiemItems(0, 1439);
	assertEquals(resolveTyped(items, "p", false), 1);
	assertEquals(resolveTyped(items, "AM", false), 0);
	assertEquals(resolveTyped(items, "x", false), -1);
});

// #endregion

// #region Whole-value resolution

Deno.test("resolveMinutes — snaps to the grid without escaping the day", () => {
	assertEquals(resolveMinutes(9 * 60 + 3, 5, 0, 1439, false), 9 * 60 + 5);
	// 23:58 must not round up to 24:00, which is not a time this day has.
	assertEquals(resolveMinutes(23 * 60 + 58, 5, 0, 1439, false), 23 * 60 + 55);
	assertEquals(resolveMinutes(-90, 5, 0, 1439, false), 0);
});

Deno.test("resolveMinutes — a bounded day pulls an illegal time onto its boundary", () => {
	const lo = 9 * 60 + 7;
	const hi = 17 * 60;
	// This is the failure the brief names: choosing a legal DATE must not leave an illegal HOUR.
	assertEquals(resolveMinutes(3 * 60, 5, lo, hi, false), lo);
	assertEquals(resolveMinutes(22 * 60, 5, lo, hi, false), hi);
	assertEquals(resolveMinutes(11 * 60 + 2, 5, lo, hi, false), 11 * 60);
});

Deno.test("resolveMinutes — an afternoon-only window keeps a morning value in the offered half", () => {
	const lo = 13 * 60;
	const resolved = resolveMinutes(2 * 60, 5, lo, 1439, true);
	assertEquals(resolved, lo, "the AM half does not exist here, so 02:00 lands on 13:00");
});

// #endregion

// #region The date-time bridge

Deno.test("dayTimeBounds — a bound constrains only the day it falls on", () => {
	const min = new Date(2026, 7, 17, 9, 30);
	const max = new Date(2026, 7, 19, 17, 0);

	assertEquals(dayTimeBounds(new Date(2026, 7, 17), min, max), { lo: 570, hi: 1439 });
	assertEquals(dayTimeBounds(new Date(2026, 7, 18), min, max), { lo: 0, hi: 1439 });
	assertEquals(dayTimeBounds(new Date(2026, 7, 19), min, max), { lo: 0, hi: 1020 });
	assertEquals(dayTimeBounds(new Date(2026, 7, 20), min, max), { lo: 0, hi: 0 });
	assertEquals(dayTimeBounds(new Date(2026, 7, 17)), { lo: 0, hi: 1439 });
});

Deno.test("withMinutes — the day is kept, the clock is replaced", () => {
	const d = withMinutes(new Date(2026, 7, 17, 23, 59), 9 * 60 + 5);
	assertEquals([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 7, 17]);
	assertEquals([d.getHours(), d.getMinutes(), d.getSeconds()], [9, 5, 0]);
});

Deno.test("formatTimeOfDay — midnight and noon are the two a modulo gets wrong", () => {
	assertEquals(formatTimeOfDay(0, false), "00:00");
	assertEquals(formatTimeOfDay(0, true), "12:00 AM");
	assertEquals(formatTimeOfDay(12 * 60, true), "12:00 PM");
	assertEquals(formatTimeOfDay(13 * 60 + 5, true), "1:05 PM");
	assertEquals(formatTimeOfDay(13 * 60 + 5, false), "13:05");
});

// #endregion
