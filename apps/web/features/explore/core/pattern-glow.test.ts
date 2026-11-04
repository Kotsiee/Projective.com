import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	GLOW_FALLOFF,
	GLOW_LIFE_MS,
	GLOW_RADIUS_END,
	GLOW_RADIUS_START,
	glowBounds,
	glowIntensity,
	glowRadius,
} from "./pattern-glow.ts";

Deno.test("a particle lives long enough to leave a trail, not a spot", () => {
	assert(GLOW_LIFE_MS >= 2000 && GLOW_LIFE_MS <= 2600);
});

Deno.test("the radius contracts from a wide wash to a small point, fastest at first", () => {
	assertEquals(glowRadius(0), GLOW_RADIUS_START);
	assertEquals(glowRadius(GLOW_LIFE_MS), GLOW_RADIUS_END);
	assert(GLOW_RADIUS_START >= 85 && GLOW_RADIUS_START <= 95);
	assert(GLOW_RADIUS_END >= 12 && GLOW_RADIUS_END <= 16);
	const half = glowRadius(GLOW_LIFE_MS / 2);
	assert(half < (GLOW_RADIUS_START + GLOW_RADIUS_END) / 2, "the (1 − t/τ)^1.6 ease front-loads it");
	assert(
		glowRadius(GLOW_LIFE_MS * 2) === GLOW_RADIUS_END,
		"an overdue particle never shrinks past",
	);
});

Deno.test("intensity peaks under the cursor and fades with age and distance", () => {
	assertEquals(glowIntensity(0, 0), 1);
	assertEquals(glowIntensity(GLOW_LIFE_MS, 0), 0);
	assertAlmostEquals(glowIntensity(0, Math.sqrt(1 / GLOW_FALLOFF)), 0.5, 1e-9);
	assert(glowIntensity(0, 150) > 0.6, "the path a sweep leaves stays lit, not just the cursor");
	assert(glowIntensity(400, 10) < glowIntensity(200, 10));
	assert(glowIntensity(200, 40) < glowIntensity(200, 10));
});

Deno.test("the lit box holds every disc whole, on whole pixels, so a clip to it cuts no light", () => {
	assertEquals(glowBounds([{ x: 10, y: 20, r: 5 }]), [5, 15, 10, 10]);
	assertEquals(
		glowBounds([{ x: 10.5, y: 20.5, r: 5.25 }, { x: 100, y: -40, r: 14 }]),
		[5, -54, 109, 80],
	);
});
