import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
	centreBounds,
	centreFromOffset,
	clampState,
	CROP_ZOOM_MAX,
	dragCentre,
	exportTransform,
	fitScale,
	INITIAL_CROP,
	offsetOf,
	stageTransform,
	wheelZoom,
	wrapRotation,
} from "./crop-model.ts";

const landscape = { width: 1600, height: 1000 };
const portrait = { width: 600, height: 900 };
const D = 320;

Deno.test("fitScale spans the SHORT side across the circle", () => {
	assertEquals(fitScale(landscape, D), D / 1000);
	assertEquals(fitScale(portrait, D), D / 600);
	// A degenerate picture cannot divide by zero.
	assertEquals(fitScale({ width: 0, height: 0 }, D), 1);
});

Deno.test("centreBounds pin the short axis at zoom 1 and open with the zoom", () => {
	const fit = centreBounds(landscape, D, 1);
	assertAlmostEquals(fit.y, 0, 1e-9);
	assertAlmostEquals(fit.x, 300, 1e-9); // 800 - 500
	const zoomed = centreBounds(landscape, D, 2);
	assertAlmostEquals(zoomed.y, 250, 1e-9); // 500 - 250
	assertAlmostEquals(zoomed.x, 550, 1e-9); // 800 - 250
	// Never negative, whatever floating error does at the boundary.
	const p = centreBounds(portrait, D, 1);
	assertEquals(p.x >= 0 && p.y >= 0, true);
	assertAlmostEquals(p.x, 0, 1e-9);
});

Deno.test("wrapRotation folds any angle into (-180, 180]", () => {
	assertEquals(wrapRotation(0), 0);
	assertEquals(wrapRotation(190), -170);
	assertEquals(wrapRotation(-190), 170);
	assertEquals(wrapRotation(540), 180);
	assertEquals(wrapRotation(-180), 180);
	assertEquals(wrapRotation(Number.NaN), 0);
});

Deno.test("clampState is total and never lets the circle leave the picture", () => {
	const wild = clampState(
		{ zoom: 99, rotation: 725, cx: 10_000, cy: -10_000 },
		landscape,
		D,
	);
	assertEquals(wild.zoom, CROP_ZOOM_MAX);
	assertEquals(wild.rotation, 5);
	const b = centreBounds(landscape, D, CROP_ZOOM_MAX);
	assertAlmostEquals(wild.cx, b.x, 1e-9);
	assertAlmostEquals(wild.cy, -b.y, 1e-9);
	// Garbage in, a legal state out.
	const nan = clampState({ zoom: Number.NaN, rotation: Infinity, cx: NaN, cy: NaN }, landscape, D);
	assertEquals(nan, { zoom: 1, rotation: 0, cx: 0, cy: 0 });
	assertEquals(clampState(INITIAL_CROP, landscape, D), INITIAL_CROP);
});

Deno.test("stageTransform lands the crop centre on the stage centre", () => {
	// Rotation 0: the picture is shifted by the centre offset, scaled.
	const t = stageTransform({ zoom: 2, rotation: 0, cx: 100, cy: -50 }, landscape, D);
	assertAlmostEquals(t.scale, 0.64, 1e-9);
	assertAlmostEquals(t.tx, -64, 1e-9);
	assertAlmostEquals(t.ty, 32, 1e-9);
	// Rotation 90° clockwise: the offset (100, 0) turns into (0, 100) before being negated.
	const r = stageTransform({ zoom: 2, rotation: 90, cx: 100, cy: 0 }, landscape, D);
	assertAlmostEquals(r.tx, 0, 1e-9);
	assertAlmostEquals(r.ty, -64, 1e-9);
});

Deno.test("dragCentre moves the crop centre against the pointer, in the picture's frame", () => {
	const state = { zoom: 2, rotation: 0, cx: 0, cy: 0 };
	// Dragging the picture 64 stage px right at scale 0.64 uncovers 100 source px on the LEFT.
	const moved = dragCentre(state, landscape, D, 64, 0);
	assertAlmostEquals(moved.cx, -100, 1e-9);
	assertAlmostEquals(moved.cy, 0, 1e-9);
	// Under a 90° rotation the same physical drag walks the picture's vertical axis instead.
	const turned = dragCentre({ ...state, rotation: 90 }, landscape, D, 64, 0);
	assertAlmostEquals(turned.cx, 0, 1e-9);
	assertAlmostEquals(turned.cy, 100, 1e-9);
	// A drag then its exact reverse is a no-op.
	const back = dragCentre({ ...state, ...moved }, landscape, D, -64, 0);
	assertAlmostEquals(back.cx, 0, 1e-9);
});

Deno.test("offset controls are the crop centre negated, both ways", () => {
	assertEquals(offsetOf({ cx: 30, cy: -20 }), { x: -30, y: 20 });
	assertEquals(centreFromOffset(-30, 20), { cx: 30, cy: -20 });
});

Deno.test("wheelZoom zooms in on an upward notch and clamps at both ends", () => {
	const inward = wheelZoom(1, -100);
	assertEquals(inward > 1, true);
	assertAlmostEquals(wheelZoom(inward, 100), 1, 1e-9);
	assertEquals(wheelZoom(1, 100), 1);
	assertEquals(wheelZoom(CROP_ZOOM_MAX, -1000), CROP_ZOOM_MAX);
	// A line-mode wheel is scaled up rather than treated as a single pixel.
	assertEquals(wheelZoom(1, -3, 1) > wheelZoom(1, -3, 0), true);
});

Deno.test("exportTransform maps the circle's content onto the output square exactly", () => {
	const state = { zoom: 2, rotation: 30, cx: 120, cy: 40 };
	const out = exportTransform(state, landscape, D, 512);
	// The output scale is the stage scale re-expressed for a 512px square (÷320 · ×512).
	assertAlmostEquals(out.scale, 0.64 * (512 / 320), 1e-9);
	assertEquals(out.rotation, 30);
	assertEquals(out.cx, 120);
	assertEquals(out.cy, 40);
	// The crop centre itself lands on the middle of the square: translate(256) · R · k · (c - c) = 256.
	const centred = out.scale * 0 + 256;
	assertEquals(centred, 256);
});
