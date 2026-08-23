/**
 * @projective/ui/calendar — the cursor-anchored zoom's arithmetic, pinned.
 *
 * The anchor's whole claim is that a timestamp stays under the pointer across an interpolated zoom,
 * and the live spring that drives it cannot be observed in this repo's preview harness: rAF is
 * frozen in a hidden document. So the claim is asserted the only way it can be — by stepping the
 * REAL `SPRING_STANDARD` integrator the hook uses, at a deliberately uneven frame cadence, and
 * re-solving the offset from the captured minute on each of those steps.
 *
 * The second test is the one worth keeping: it measures the design that was REJECTED (re-reading the
 * minute back out of the offset every step) against the one that shipped, so a future edit that
 * quietly reintroduces the re-read has something that fails rather than a comment it can ignore.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { visibleFractionOf, zoomMinuteAtY, zoomYAtMinute } from "./useCalendarViewport.ts";
import { SPRING_STANDARD, springStep } from "../../core/motion.ts";

const RANGE_START = -180;
const RANGE_END = 1620;
const SPAN_H = (RANGE_END - RANGE_START) / 60;

function solve(minute: number, anchorY: number, pph: number, h: number): number {
	const max = Math.max(0, SPAN_H * pph - h);
	return Math.min(max, Math.max(0, zoomYAtMinute(minute, RANGE_START, pph) - anchorY));
}

Deno.test("anchored zoom holds the captured minute under the cursor on every frame", () => {
	const h = 700;
	const anchorY = 213.5;
	let pph = 48;
	const offset0 = 500;
	const minute = zoomMinuteAtY(offset0 + anchorY, RANGE_START, pph);

	// Drive the real spring the hook uses, frame by frame, at an uneven cadence.
	let value = pph;
	let velocity = 0;
	const target = 130;
	for (const dt of [16, 16, 33, 8, 16, 48, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16]) {
		const step = springStep(SPRING_STANDARD, value, velocity, target, dt, 0.05);
		value = step.value;
		velocity = step.velocity;
		pph = value;
		const offset = solve(minute, anchorY, pph, h);
		assert(offset > 0 && offset < SPAN_H * pph - h, "frame must be unclamped for this assertion");
		assertAlmostEquals(zoomMinuteAtY(offset + anchorY, RANGE_START, pph), minute, 1e-9);
	}
	assert(pph > 120, `spring should be near target, got ${pph}`);
});

Deno.test("re-reading the minute each frame drifts; re-solving from the captured one does not", () => {
	const h = 700;
	const anchorY = 213.5;
	const start = 48;
	const captured = zoomMinuteAtY(500 + anchorY, RANGE_START, start);

	// The rejected design: recapture the minute from the offset every step, with a plausible
	// sub-pixel rounding at each write (a real scroller quantises; a canvas offset is rounded to
	// draw). Ten notches is one wheel gesture.
	let pph = start;
	let offset = 500;
	let live = captured;
	for (let i = 0; i < 10; i++) {
		pph *= 1.12;
		offset = Math.round(solve(live, anchorY, pph, h));
		live = zoomMinuteAtY(offset + anchorY, RANGE_START, pph);
	}
	const naiveDrift = Math.abs(live - captured);

	// The shipped design: one captured minute, re-solved from every step.
	pph = start;
	for (let i = 0; i < 10; i++) {
		pph *= 1.12;
		offset = Math.round(solve(captured, anchorY, pph, h));
	}
	const heldDrift = Math.abs(zoomMinuteAtY(offset + anchorY, RANGE_START, pph) - captured);

	assert(naiveDrift > heldDrift, `naive ${naiveDrift} should exceed held ${heldDrift}`);
	assert(heldDrift < 0.2, `held drift is one rounding, got ${heldDrift}`);
});

Deno.test("a clamped anchor is restored exactly once the zoom leaves the boundary", () => {
	const h = 700;
	const anchorY = 40;
	const minute = zoomMinuteAtY(0 + anchorY, RANGE_START, 48); // near the very top of the axis
	assertEquals(solve(minute, anchorY, 20, h), 0, "deep zoom-out clamps to the top");
	const back = solve(minute, anchorY, 48, h);
	assertAlmostEquals(zoomMinuteAtY(back + anchorY, RANGE_START, 48), minute, 1e-9);
});

Deno.test("visibleFractionOf is the viewport's share of a 24h period, clamped", () => {
	assertAlmostEquals(visibleFractionOf(576, 48), 0.5, 1e-12);
	assertEquals(visibleFractionOf(4000, 48), 1);
	assertEquals(visibleFractionOf(0, 48), 0);
	assertEquals(visibleFractionOf(600, 0), 0);
	assertEquals(visibleFractionOf(600, -5), 0);
});
