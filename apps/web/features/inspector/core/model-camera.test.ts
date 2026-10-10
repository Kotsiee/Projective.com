import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	clipPlanes,
	easeOutCubic,
	fitDistance,
	normalize,
	orthoHalfExtents,
	presetDirection,
	presetForKey,
	slerpDirection,
	type Vec3,
	VIEW_PRESETS,
} from "./model-camera.ts";

function len(v: Vec3): number {
	return Math.hypot(v[0], v[1], v[2]);
}

Deno.test("presetDirection returns unit vectors pointing the named way", () => {
	for (const p of VIEW_PRESETS) assertAlmostEquals(len(presetDirection(p.id)), 1, 1e-9);
	assertEquals(presetDirection("front"), [0, 0, 1]);
	assertEquals(presetDirection("right"), [1, 0, 0]);
	const top = presetDirection("top");
	assert(top[1] > 0.999 && top[2] > 0, "top looks down from just in front of the pole");
	const iso = presetDirection("iso");
	assert(iso[0] > 0 && iso[1] > 0 && iso[2] > 0);
});

Deno.test("presetForKey maps the number row to views", () => {
	assertEquals(presetForKey("1"), "front");
	assertEquals(presetForKey("7"), "iso");
	assertEquals(presetForKey("9"), null);
});

Deno.test("fitDistance frames the sphere on the tighter axis", () => {
	const wide = fitDistance(1, 45, 2);
	const tall = fitDistance(1, 45, 0.5);
	assert(tall > wide, "a portrait view needs more distance");
	const halfV = (45 * Math.PI) / 360;
	assertAlmostEquals(wide, 1.15 / Math.sin(halfV), 1e-9);
	assert(Number.isFinite(fitDistance(0, 45, 0)), "degenerate input still yields a distance");
});

Deno.test("orthoHalfExtents keeps the sphere inside both axes", () => {
	assertEquals(orthoHalfExtents(1, 2), { halfWidth: 2.3, halfHeight: 1.15 });
	const tall = orthoHalfExtents(1, 0.5);
	assertAlmostEquals(tall.halfWidth, 1.15, 1e-9);
	assertAlmostEquals(tall.halfHeight, 2.3, 1e-9);
});

Deno.test("clipPlanes bracket the model", () => {
	const { near, far } = clipPlanes(10, 2);
	assert(near > 0 && near < 10 - 2);
	assert(far > 10 + 2);
});

Deno.test("easeOutCubic is clamped and monotonic", () => {
	assertEquals(easeOutCubic(-1), 0);
	assertEquals(easeOutCubic(2), 1);
	assert(easeOutCubic(0.5) > 0.5);
});

Deno.test("slerpDirection stays on the unit sphere and hits both ends", () => {
	const a: Vec3 = [1, 0, 0];
	const b: Vec3 = [0, 0, 1];
	assertEquals(slerpDirection(a, b, 0).map((n) => Math.round(n * 1e9) / 1e9), [1, 0, 0]);
	assertEquals(slerpDirection(a, b, 1).map((n) => Math.round(n * 1e9) / 1e9), [0, 0, 1]);
	const mid = slerpDirection(a, b, 0.5);
	assertAlmostEquals(len(mid), 1, 1e-9);
	assertAlmostEquals(mid[0], Math.SQRT1_2, 1e-9);
	const flip = slerpDirection([0, 0, 1], [0, 0, -1], 0.5);
	assertAlmostEquals(len(flip), 1, 1e-9);
	assertAlmostEquals(flip[2], 0, 1e-9);
	assertEquals(normalize([0, 0, 0]), [0, 0, 0]);
});
