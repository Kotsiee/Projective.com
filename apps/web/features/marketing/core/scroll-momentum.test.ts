import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	chooseRestTarget,
	glideDurationMs,
	glidePosition,
	MAX_VELOCITY,
	MOMENTUM_TAU_MS,
	type PointerSample,
	projectRest,
	releaseVelocity,
	SETTLE_EPSILON_PX,
} from "./scroll-momentum.ts";

const steady = (speed: number, from = 0, count = 8, step = 10): PointerSample[] =>
	Array.from({ length: count }, (_, i) => ({ t: from + i * step, x: i * step * speed }));

Deno.test("releaseVelocity reads the slope across the recent window", () => {
	const samples = steady(2);
	assertAlmostEquals(releaseVelocity(samples, 70), 2, 1e-9);
});

Deno.test("releaseVelocity ignores samples older than the window", () => {
	const old: PointerSample[] = [{ t: 0, x: 0 }, { t: 10, x: 900 }];
	const recent: PointerSample[] = [{ t: 200, x: 1000 }, { t: 250, x: 1050 }];
	assertAlmostEquals(releaseVelocity([...old, ...recent], 250), 1, 1e-9);
});

Deno.test("a pointer held still before release has no velocity", () => {
	assertEquals(releaseVelocity(steady(3), 70 + 61), 0);
});

Deno.test("releaseVelocity needs two samples and caps a noisy spike", () => {
	assertEquals(releaseVelocity([{ t: 0, x: 0 }], 0), 0);
	assertEquals(releaseVelocity([{ t: 0, x: 0 }, { t: 1, x: 500 }], 1), MAX_VELOCITY);
	assertEquals(releaseVelocity([{ t: 0, x: 500 }, { t: 1, x: 0 }], 1), -MAX_VELOCITY);
});

Deno.test("a harder throw projects further; a slow release stays put", () => {
	assertEquals(projectRest(100, 0.1), 100);
	assert(projectRest(100, 2) > projectRest(100, 1));
	assertEquals(projectRest(100, 1), 100 + MOMENTUM_TAU_MS);
});

Deno.test("a track that does not snap rests where the throw carries it, clamped", () => {
	assertEquals(chooseRestTarget({ position: 0, velocity: 1, points: [], min: 0, max: 1000 }), 325);
	assertEquals(
		chooseRestTarget({ position: 900, velocity: 3, points: [], min: 0, max: 1000 }),
		1000,
	);
	assertEquals(chooseRestTarget({ position: 50, velocity: -3, points: [], min: 0, max: 1000 }), 0);
});

Deno.test("a snapping track rests on the snap position nearest the projection", () => {
	const points = [0, 300, 600, 900];
	assertEquals(chooseRestTarget({ position: 0, velocity: 1, points, min: 0, max: 1200 }), 300);
	assertEquals(chooseRestTarget({ position: 0, velocity: 1.8, points, min: 0, max: 1200 }), 600);
});

Deno.test("a gentle release settles to the nearest snap position either way", () => {
	const points = [0, 300, 600];
	assertEquals(chooseRestTarget({ position: 120, velocity: 0, points, min: 0, max: 900 }), 0);
	assertEquals(chooseRestTarget({ position: 170, velocity: 0, points, min: 0, max: 900 }), 300);
});

Deno.test("a fling never settles behind the direction it was thrown", () => {
	const points = [0, 300, 600];
	// Projects to 140 → nearest overall is 0, but the reader threw forwards from 100.
	assertEquals(chooseRestTarget({ position: 100, velocity: 0.15, points, min: 0, max: 900 }), 300);
	assertEquals(chooseRestTarget({ position: 500, velocity: -0.15, points, min: 0, max: 900 }), 300);
});

Deno.test("snap positions past the range clamp to its ends", () => {
	const points = [0, 300, 600, 900, 1200];
	assertEquals(chooseRestTarget({ position: 700, velocity: 6, points, min: 0, max: 1000 }), 1000);
});

Deno.test("a right-to-left range is negative and clamps the same way", () => {
	const points = [0, -300, -600];
	assertEquals(chooseRestTarget({ position: 0, velocity: -1, points, min: -800, max: 0 }), -300);
	assertEquals(chooseRestTarget({ position: -700, velocity: -3, points, min: -800, max: 0 }), -800);
});

Deno.test("the glide leaves at the throw speed and never passes its target", () => {
	const initial = (glidePosition(0, 325, 1) - 0) / 1;
	assertAlmostEquals(initial, 1, 0.01);
	let prev = 0;
	for (let t = 0; t <= 5000; t += 16) {
		const x = glidePosition(0, 325, t);
		assert(x >= prev && x <= 325);
		prev = x;
	}
	assertEquals(glidePosition(40, 100, 0), 40);
});

Deno.test("a longer glide takes longer to settle", () => {
	assertEquals(glideDurationMs(SETTLE_EPSILON_PX / 2), 0);
	assert(glideDurationMs(1200) > glideDurationMs(300));
	assertAlmostEquals(glidePosition(0, 300, glideDurationMs(300)), 300 - SETTLE_EPSILON_PX, 1e-6);
});
