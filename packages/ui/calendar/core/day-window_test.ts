/**
 * The Day timeline's virtualized day WINDOW.
 *
 * Pure arithmetic, tested without a DOM, for the reason the rest of this engine's geometry is: the
 * window decides which days are laid out at all, and a wrong answer here does not look wrong — it
 * throws inside `Intl.DateTimeFormat` during render and silently takes the whole subtree with it.
 */
import { assert, assertEquals } from "@std/assert";
import { dayWindow } from "./layout.ts";
import { addZonedDays, zonedParts } from "./time.ts";

/** The Day timeline's own axis + window budget, restated so the test reads as the view does. */
const WINDOW_DAYS = 1500;
const MAX_DAYS = 14;

// #region The day window (`components/DayTimeline.tsx`)
Deno.test("dayWindow — a nonsense viewport falls back to the focused day, never to the year 40,000", () => {
	/*
	 * `minAt` divides by a caller-owned zoom, so `NaN` and `Infinity` are values this really receives —
	 * a zoom mid-interpolation, a restored zero. Letting one through produced day indices thousands of
	 * years off the axis, `Intl.DateTimeFormat` threw `Invalid time value` DURING RENDER, and the
	 * component plus every child below it (including its scrollbar) stopped rendering entirely.
	 */
	for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
		const w = dayWindow(true, 12, bad, bad, WINDOW_DAYS, MAX_DAYS);
		assertEquals(w, { startIdx: 11, endIdx: 13 }, `fell back for ${bad}`);
	}
	assertEquals(
		dayWindow(false, 4, 0, 1, WINDOW_DAYS, MAX_DAYS),
		{ startIdx: 3, endIdx: 5 },
		"unbounded → the focused day",
	);
	assertEquals(
		dayWindow(true, Number.NaN, 0, 1, WINDOW_DAYS, MAX_DAYS).startIdx,
		-1,
		"even the focus may be nonsense",
	);
});

Deno.test("dayWindow — both ends stay inside the axis, and the start never passes the end", () => {
	const far = dayWindow(true, 0, 9e15, 9e15, WINDOW_DAYS, MAX_DAYS);
	assert(far.startIdx >= -WINDOW_DAYS && far.endIdx <= WINDOW_DAYS, "clamped into the axis");
	assert(far.startIdx <= far.endIdx, "a window that runs backwards lays out nothing at all");
	const back = dayWindow(true, 0, -9e15, -9e15, WINDOW_DAYS, MAX_DAYS);
	assert(back.startIdx >= -WINDOW_DAYS && back.endIdx <= WINDOW_DAYS);
	assert(back.startIdx <= back.endIdx);
});

Deno.test("dayWindow — an ordinary viewport spans what is on screen, capped at MAX_DAYS", () => {
	assertEquals(dayWindow(true, 0, 6.7, 7.6, WINDOW_DAYS, MAX_DAYS), { startIdx: 5, endIdx: 9 });
	// A shallow zoom that would put hundreds of days on screen is capped rather than honoured, and the
	// cap counts the days actually EMITTED — a budget that quietly laid out two more than it names
	// would be a virtualization budget nobody could reason about.
	const capped = dayWindow(true, 0, 0, 900, WINDOW_DAYS, MAX_DAYS);
	assertEquals(capped.endIdx - capped.startIdx + 1, MAX_DAYS);
});
// #endregion

// #region The instant clamp
Deno.test("zonedParts — a non-finite or out-of-range instant CLAMPS rather than throwing", () => {
	/*
	 * These helpers are called from a render body, so a throw does not degrade one label — it removes
	 * the component and every child below it from the tree. A day timeline lost its scrollbar this way:
	 * the bar measured correctly and its parent simply never finished rendering.
	 */
	for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 9e15, -9e15]) {
		const p = zonedParts(bad, "UTC");
		assert(Number.isFinite(p.year), `year was not a number for ${bad}`);
		assert(Number.isFinite(p.day) && Number.isFinite(p.hour));
	}
	// And the arithmetic built on it stays total too, which is the call that was actually crashing.
	assert(Number.isFinite(addZonedDays(Number.NaN, 3, "UTC")));
	assert(Number.isFinite(addZonedDays(9e15, 1500, "Europe/London")));
});

Deno.test("zonedParts — an ORDINARY instant is untouched by the clamp", () => {
	const p = zonedParts(Date.UTC(2026, 6, 13, 9, 30), "UTC");
	assertEquals([p.year, p.month, p.day, p.hour, p.minute], [2026, 7, 13, 9, 30]);
});
// #endregion
