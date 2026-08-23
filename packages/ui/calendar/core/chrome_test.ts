/**
 * The lever scrollbar's physics.
 *
 * Worth testing for the reason every pure module in this engine is: a rate-based control cannot be
 * observed in this repo's preview harness at all — `requestAnimationFrame` never fires in a hidden
 * pane, so the loop that would reveal a wrong curve simply does not run — and a throttle whose ramp is
 * subtly wrong does not throw and does not look broken. It looks like a scrollbar that feels bad.
 *
 * Nothing here touches the DOM, a canvas, Preact, or a clock.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	GAUGE_MAX_RATIO,
	GAUGE_MIN,
	handleLength,
	joystickVelocity,
	LEVER_DEAD_ZONE_PX,
	LEVER_DT_CAP_MS,
	LEVER_FRAME_MS,
	LEVER_MAX_PX,
	LEVER_MAX_THROW_PX,
	LEVER_MAX_V,
	leverBall,
	leverScrollDelta,
	leverThrowPx,
} from "./chrome.ts";

// #region Throttle — the dead zone
Deno.test("joystickVelocity — nothing moves inside the dead zone, in either direction", () => {
	assertEquals(joystickVelocity(0), 0);
	assertEquals(joystickVelocity(LEVER_DEAD_ZONE_PX), 0);
	assertEquals(joystickVelocity(-LEVER_DEAD_ZONE_PX), 0);
	assertEquals(joystickVelocity(LEVER_DEAD_ZONE_PX / 2), 0);
	assertEquals(joystickVelocity(-LEVER_DEAD_ZONE_PX / 2), 0);
});

Deno.test("joystickVelocity — leaving the dead zone engages the throttle continuously, not with a jump", () => {
	const just = joystickVelocity(LEVER_DEAD_ZONE_PX + 0.001);
	assert(just > 0, "a lever past its dead zone must move something, or the drag reads as stuck");
	assert(
		just < LEVER_MAX_V * 0.01,
		`the ramp must start from zero at the dead zone's edge, not step to a finite speed; got ${just}`,
	);
});

Deno.test("joystickVelocity — the dead zone stays below the 5px `edgeHoldVelocity` already promises", () => {
	// `core/scene-build.ts`'s `edgeHoldVelocity` delegates here and its shipped test asserts that a
	// five-pixel overshoot scrolls. Widening the dead zone past that breaks a test in another module,
	// which is a confusing place to find out; this is where it should fail instead.
	assert(
		LEVER_DEAD_ZONE_PX < 5,
		`edgeHoldVelocity(5) must stay nonzero, so the dead zone must stay under 5px; got ${LEVER_DEAD_ZONE_PX}`,
	);
	assert(joystickVelocity(5) > 0);
});
// #endregion

// #region Throttle — the curve
Deno.test("joystickVelocity — monotone increasing all the way from the dead zone to saturation", () => {
	let previous = 0;
	for (let d = LEVER_DEAD_ZONE_PX + 1; d <= LEVER_MAX_PX; d += 1) {
		const v = joystickVelocity(d);
		assert(
			v > previous,
			`pushing further must never scroll slower: ${d}px gave ${v} after ${previous}`,
		);
		previous = v;
	}
});

Deno.test("joystickVelocity — saturates at a ceiling rather than climbing without bound", () => {
	assertAlmostEquals(joystickVelocity(LEVER_MAX_PX), LEVER_MAX_V, 1e-9);
	assertEquals(joystickVelocity(LEVER_MAX_PX * 5), LEVER_MAX_V);
	assertEquals(joystickVelocity(50_000), LEVER_MAX_V);
	assertEquals(joystickVelocity(-50_000), -LEVER_MAX_V);
});

Deno.test("joystickVelocity — exactly symmetric about zero", () => {
	for (const d of [1, 4, 5, 12, 40, 119, 120, 900]) {
		assertEquals(
			joystickVelocity(-d),
			-joystickVelocity(d),
			`pushing up and down by ${d}px must scroll at the same speed`,
		);
	}
});

Deno.test("joystickVelocity — QUADRATIC: doubling a small deflection more than doubles the speed", () => {
	// The near-origin response must stay gentle (the few pixels of travel a press already carries must
	// not read as a committed fast-scroll) while a clearly-pushed lever still reaches real speed. A
	// straight line cannot do both, which is the whole reason this is t squared rather than t.
	const small = joystickVelocity(10);
	const double = joystickVelocity(20);
	assert(double > small * 2, `expected super-linear growth, got ${small} -> ${double}`);
});

Deno.test("joystickVelocity — a non-finite deflection scrolls nothing", () => {
	assertEquals(joystickVelocity(Number.NaN), 0);
	assertEquals(joystickVelocity(Number.POSITIVE_INFINITY), 0);
	assertEquals(joystickVelocity(Number.NEGATIVE_INFINITY), 0);
});
// #endregion

// #region Throttle — per-frame integration
Deno.test("leverScrollDelta — one 60Hz frame moves exactly the per-frame velocity", () => {
	assertAlmostEquals(leverScrollDelta(LEVER_MAX_PX, LEVER_FRAME_MS), LEVER_MAX_V, 1e-9);
	assertAlmostEquals(leverScrollDelta(-LEVER_MAX_PX, LEVER_FRAME_MS), -LEVER_MAX_V, 1e-9);
});

Deno.test("leverScrollDelta — frame-rate independent: two half-frames equal one whole frame", () => {
	const whole = leverScrollDelta(60, LEVER_FRAME_MS);
	const half = leverScrollDelta(60, LEVER_FRAME_MS / 2);
	assertAlmostEquals(half * 2, whole, 1e-9);
});

Deno.test("leverScrollDelta — a resumed background tab is capped, never integrated in one jump", () => {
	const capped = leverScrollDelta(LEVER_MAX_PX, LEVER_DT_CAP_MS);
	assertEquals(
		leverScrollDelta(LEVER_MAX_PX, 4_000),
		capped,
		"a four-second rAF gap must not teleport four seconds of scrolling",
	);
	assertEquals(leverScrollDelta(LEVER_MAX_PX, 60_000), capped);
});

Deno.test("leverScrollDelta — the opening frame of a run, which has no elapsed time, moves nothing", () => {
	assertEquals(leverScrollDelta(LEVER_MAX_PX, 0), 0);
	assertEquals(leverScrollDelta(LEVER_MAX_PX, -16), 0);
	assertEquals(leverScrollDelta(LEVER_MAX_PX, Number.NaN), 0);
});
// #endregion

// #region Lever state
Deno.test("leverBall — displacement is signed from the grab, positive when the pointer is below it", () => {
	assertEquals(leverBall(200, 260, 1).displacement, 60);
	assertEquals(leverBall(200, 140, 1).displacement, -60);
	assertEquals(leverBall(200, 200, 1).displacement, 0);
});

Deno.test("leverBall — the grab origin passes through untouched, so the ball stays anchored", () => {
	assertEquals(leverBall(317.5, 900, 0.4).grabY, 317.5);
});

Deno.test("leverBall — morph is clamped, so an overshooting spring cannot paint a scale of 1.02", () => {
	assertEquals(leverBall(0, 0, 1.02).morph, 1);
	assertEquals(leverBall(0, 0, -0.3).morph, 0);
	assertEquals(leverBall(0, 0, 0.5).morph, 0.5);
	assertEquals(leverBall(0, 0, Number.NaN).morph, 0);
});

Deno.test("leverThrowPx — answers the first pixel of travel, then saturates well before the throttle", () => {
	assertEquals(leverThrowPx(0), 0);
	const first = leverThrowPx(1);
	assert(first > 0, "the stick must move on the first pixel, even inside the throttle's dead zone");
	assertEquals(leverThrowPx(LEVER_MAX_PX), LEVER_MAX_THROW_PX);
	assertEquals(leverThrowPx(LEVER_MAX_PX * 40), LEVER_MAX_THROW_PX);
	assertEquals(leverThrowPx(-LEVER_MAX_PX * 40), -LEVER_MAX_THROW_PX);
});

Deno.test("leverThrowPx — LINEAR in the deflection, unlike the velocity ramp", () => {
	// The stick's offset is a position, and a position that moved non-linearly with the pointer reads
	// as the control lagging the hand.
	assertAlmostEquals(leverThrowPx(20) * 2, leverThrowPx(40), 1e-9);
});
// #endregion

// #region Handle length
Deno.test("handleLength — a full period in view is far longer than a deep zoom", () => {
	const track = 600;
	const wholeDay = handleLength(track, 1);
	const oneHourOfADay = handleLength(track, 1 / 24);
	assert(
		wholeDay > oneHourOfADay,
		`viewport scale must be visible in the handle: ${wholeDay} vs ${oneHourOfADay}`,
	);
});

Deno.test("handleLength — capped at GAUGE_MAX_RATIO of the track, so the offset keeps room to travel", () => {
	const track = 600;
	assertEquals(handleLength(track, 1), track * GAUGE_MAX_RATIO);
	assertEquals(
		handleLength(track, 4),
		track * GAUGE_MAX_RATIO,
		"more than a period in view still caps",
	);
});

Deno.test("handleLength — floored at GAUGE_MIN, so the deepest zoom still leaves something to press", () => {
	assertEquals(handleLength(600, 0.001), GAUGE_MIN);
	assertEquals(handleLength(600, 0), GAUGE_MIN);
});

Deno.test("handleLength — moves continuously between the floor and the cap", () => {
	const track = 600;
	const mid = handleLength(track, 0.25);
	assertEquals(mid, 150);
	assert(mid > GAUGE_MIN && mid < track * GAUGE_MAX_RATIO);
});

Deno.test("handleLength — a track shorter than the floor is never overrun by it", () => {
	// A handle longer than its own track is not a floor being honoured, it is a handle drawn outside
	// the bar.
	assertEquals(handleLength(20, 1), 20);
	assertEquals(handleLength(20, 0.01), 20);
});

Deno.test("handleLength — a degenerate track or fraction draws nothing rather than guessing", () => {
	assertEquals(handleLength(0, 1), 0);
	assertEquals(handleLength(-40, 1), 0);
	assertEquals(handleLength(Number.NaN, 1), 0);
	assertEquals(handleLength(600, Number.NaN), GAUGE_MIN);
	assertEquals(handleLength(600, -2), GAUGE_MIN);
});
// #endregion
