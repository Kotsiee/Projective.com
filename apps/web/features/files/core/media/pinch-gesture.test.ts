import { assertAlmostEquals, assertEquals } from "@std/assert";
import { pinchDelta, pinchFrame } from "./pinch-gesture.ts";

Deno.test("pinchFrame: midpoint, Euclidean spread and atan2 bearing", () => {
	const f = pinchFrame({ x: 0, y: 0 }, { x: 30, y: 40 });
	assertEquals([f.cx, f.cy], [15, 20]);
	assertEquals(f.distance, 50);
	assertAlmostEquals(f.angle, (Math.atan2(40, 30) * 180) / Math.PI);
});

Deno.test("pinchDelta: pan, pinch and twist together", () => {
	const prev = pinchFrame({ x: 100, y: 100 }, { x: 200, y: 100 });
	const next = pinchFrame({ x: 110, y: 120 }, { x: 110, y: 320 });
	const d = pinchDelta(prev, next);
	assertEquals([d.dx, d.dy], [-40, 120]);
	assertAlmostEquals(d.scale, 2);
	assertAlmostEquals(d.rotation, 90);
});

Deno.test("pinchDelta: a twist across the ±180° seam is the short way round", () => {
	const prev = pinchFrame({ x: 0, y: 0 }, { x: -100, y: 1 });
	const next = pinchFrame({ x: 0, y: 0 }, { x: -100, y: -1 });
	const d = pinchDelta(prev, next);
	assertAlmostEquals(Math.abs(d.rotation), 1.146, 1e-3);
});

Deno.test("pinchDelta: coincident fingers neither zoom nor spin", () => {
	const prev = pinchFrame({ x: 5, y: 5 }, { x: 5, y: 5 });
	const next = pinchFrame({ x: 5, y: 5 }, { x: 50, y: 5 });
	const d = pinchDelta(prev, next);
	assertEquals(d.scale, 1);
	assertEquals(d.rotation, 0);
});
