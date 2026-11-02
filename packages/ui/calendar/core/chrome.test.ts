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
	LEVER_FALLBACK_PX_PER_S,
	LEVER_MAX_PX,
	LEVER_MAX_SCROLL_SPEED,
	LEVER_MAX_V,
	leverBall,
	leverDeflection,
	leverScrollDelta,
	leverSpeed,
	leverTravel,
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

// #region Lever travel
const TRACK_TRAVEL = leverTravel(0, 600, 20);

Deno.test("leverTravel — the ball's whole box stays on the track", () => {
	assertEquals(TRACK_TRAVEL, { min: 10, max: 590 });
	assertEquals(
		leverTravel(600, 0, 20),
		{ min: 10, max: 590 },
		"the ends may arrive in either order",
	);
});

Deno.test("leverTravel — a track shorter than the ball pins the centre to its midpoint", () => {
	assertEquals(leverTravel(100, 110, 20), { min: 105, max: 105 });
	assertEquals(leverTravel(0, 600, Number.NaN), { min: 0, max: 600 });
});
// #endregion

// #region Lever throttle — the normalised deflection
Deno.test("leverDeflection — the grab is the neutral origin, with a dead zone either side of it", () => {
	assertEquals(leverDeflection(300, 300, TRACK_TRAVEL), 0);
	assertEquals(leverDeflection(300, 300 + LEVER_DEAD_ZONE_PX, TRACK_TRAVEL), 0);
	assertEquals(leverDeflection(300, 300 - LEVER_DEAD_ZONE_PX, TRACK_TRAVEL), 0);
	assert(leverDeflection(300, 300 + LEVER_DEAD_ZONE_PX + 1, TRACK_TRAVEL) > 0);
	assert(leverDeflection(300, 300 - LEVER_DEAD_ZONE_PX - 1, TRACK_TRAVEL) < 0);
});

Deno.test("leverDeflection — ±1 at the ends of the track, ±0.5 half way, linear between", () => {
	// Grabbed at 300 on a 10..590 travel: 290px of reach either way.
	assertEquals(leverDeflection(300, 590, TRACK_TRAVEL), 1);
	assertEquals(leverDeflection(300, 10, TRACK_TRAVEL), -1);
	assertAlmostEquals(leverDeflection(300, 445, TRACK_TRAVEL), 0.5, 1e-9);
	assertAlmostEquals(leverDeflection(300, 155, TRACK_TRAVEL), -0.5, 1e-9);
	assertAlmostEquals(
		leverDeflection(300, 300 + 58, TRACK_TRAVEL) * 2,
		leverDeflection(300, 300 + 116, TRACK_TRAVEL),
		1e-9,
	);
});

Deno.test("leverDeflection — a pointer past the track is the ball pinned at its end, never past ±1", () => {
	assertEquals(leverDeflection(300, 5_000, TRACK_TRAVEL), 1);
	assertEquals(leverDeflection(300, -5_000, TRACK_TRAVEL), -1);
});

Deno.test("leverDeflection — each side is normalised against its own reach", () => {
	// Grabbed near the top: 90px of reach up, 490px down. Both ends are still full speed.
	assertAlmostEquals(leverDeflection(100, 55, TRACK_TRAVEL), -0.5, 1e-9);
	assertAlmostEquals(leverDeflection(100, 345, TRACK_TRAVEL), 0.5, 1e-9);
	assertEquals(leverDeflection(100, 10, TRACK_TRAVEL), -1);
	assertEquals(leverDeflection(100, 590, TRACK_TRAVEL), 1);
});

Deno.test("leverDeflection — a grab outside the travel is measured from the clamped origin", () => {
	// A press on the handle's very top edge, above where the ball's centre can sit.
	assertEquals(leverDeflection(2, 10, TRACK_TRAVEL), 0);
	assertAlmostEquals(leverDeflection(2, 300, TRACK_TRAVEL), 290 / 580, 1e-9);
});

Deno.test("leverDeflection — a non-finite input scrolls nothing", () => {
	assertEquals(leverDeflection(Number.NaN, 400, TRACK_TRAVEL), 0);
	assertEquals(leverDeflection(300, Number.POSITIVE_INFINITY, TRACK_TRAVEL), 0);
});
// #endregion

// #region Lever throttle — speed and integration
Deno.test("leverSpeed — full deflection is LEVER_MAX_SCROLL_SPEED periods per second", () => {
	assertEquals(leverSpeed(1_440), 1_440 * LEVER_MAX_SCROLL_SPEED);
	assertEquals(leverSpeed(10_080), 10_080 * LEVER_MAX_SCROLL_SPEED);
});

Deno.test("leverSpeed — a bar with no known period keeps the fallback pixel rate", () => {
	assertEquals(leverSpeed(), LEVER_FALLBACK_PX_PER_S);
	assertEquals(leverSpeed(0), LEVER_FALLBACK_PX_PER_S);
	assertEquals(leverSpeed(Number.NaN), LEVER_FALLBACK_PX_PER_S);
});

/** Sum one second of lever ticks at `hz`. */
function oneSecondAt(hz: number, deflection: number, pxPerSecond: number): number {
	let total = 0;
	for (let i = 0; i < hz; i++) total += leverScrollDelta(deflection, pxPerSecond, 1000 / hz);
	return total;
}

Deno.test("leverScrollDelta — a second at full deflection travels LEVER_MAX_SCROLL_SPEED periods", () => {
	const period = 1_440;
	assertAlmostEquals(
		oneSecondAt(60, 1, leverSpeed(period)),
		period * LEVER_MAX_SCROLL_SPEED,
		1e-6,
	);
	assertAlmostEquals(
		oneSecondAt(60, -1, leverSpeed(period)),
		-period * LEVER_MAX_SCROLL_SPEED,
		1e-6,
	);
});

Deno.test("leverScrollDelta — half deflection is half the speed, the origin is none", () => {
	assertAlmostEquals(oneSecondAt(60, 0.5, 1_000), 500, 1e-6);
	assertEquals(oneSecondAt(60, 0, 1_000), 0);
});

Deno.test("leverScrollDelta — frame-rate independent across 60, 120 and 144 Hz", () => {
	const at60 = oneSecondAt(60, 0.5, 1_000);
	assertAlmostEquals(oneSecondAt(120, 0.5, 1_000), at60, 1e-6);
	assertAlmostEquals(oneSecondAt(144, 0.5, 1_000), at60, 1e-6);
});

Deno.test("leverScrollDelta — a deflection past ±1 is clamped, never a faster scroll", () => {
	assertEquals(leverScrollDelta(3, 1_000, 16), leverScrollDelta(1, 1_000, 16));
	assertEquals(leverScrollDelta(-3, 1_000, 16), leverScrollDelta(-1, 1_000, 16));
});

Deno.test("leverScrollDelta — a resumed background tab is capped, never integrated in one jump", () => {
	const capped = leverScrollDelta(1, 1_000, LEVER_DT_CAP_MS);
	assertEquals(
		leverScrollDelta(1, 1_000, 4_000),
		capped,
		"a four-second rAF gap must not teleport four seconds of scrolling",
	);
	assertEquals(leverScrollDelta(1, 1_000, 60_000), capped);
});

Deno.test("leverScrollDelta — the opening frame of a run, which has no elapsed time, moves nothing", () => {
	assertEquals(leverScrollDelta(1, 1_000, 0), 0);
	assertEquals(leverScrollDelta(1, 1_000, -16), 0);
	assertEquals(leverScrollDelta(1, 1_000, Number.NaN), 0);
	assertEquals(leverScrollDelta(Number.NaN, 1_000, 16), 0);
});
// #endregion

// #region Lever state
Deno.test("leverBall — the ball follows the pointer, clamped so it never leaves the track", () => {
	assertEquals(leverBall(300, 420, 1, TRACK_TRAVEL).ballY, 420);
	assertEquals(leverBall(300, 5_000, 1, TRACK_TRAVEL).ballY, 590);
	assertEquals(leverBall(300, -5_000, 1, TRACK_TRAVEL).ballY, 10);
});

Deno.test("leverBall — carries the clamped origin and the same deflection leverDeflection reports", () => {
	const lever = leverBall(2, 300, 1, TRACK_TRAVEL);
	assertEquals(lever.grabY, 10);
	assertEquals(lever.deflection, leverDeflection(2, 300, TRACK_TRAVEL));
});

Deno.test("leverBall — a non-finite pointer leaves the ball at the origin", () => {
	const lever = leverBall(300, Number.NaN, 1, TRACK_TRAVEL);
	assertEquals(lever.ballY, 300);
	assertEquals(lever.deflection, 0);
});

Deno.test("leverBall — morph is clamped, so an overshooting spring cannot paint a scale of 1.02", () => {
	assertEquals(leverBall(0, 0, 1.02, TRACK_TRAVEL).morph, 1);
	assertEquals(leverBall(0, 0, -0.3, TRACK_TRAVEL).morph, 0);
	assertEquals(leverBall(0, 0, 0.5, TRACK_TRAVEL).morph, 0.5);
	assertEquals(leverBall(0, 0, Number.NaN, TRACK_TRAVEL).morph, 0);
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
