import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	aspectRatioLabel,
	canPan,
	clampPan,
	fit,
	fitView,
	flip,
	imageBounds,
	imageFlips,
	isFitted,
	panBy,
	pinchDelta,
	pinchFrame,
	quarterTurn,
	rotateBy,
	rotatedSize,
	sliderPosition,
	sliderZoom,
	snapTwist,
	thirdsBox,
	toCss,
	VIEWPORT_IDENTITY,
	type ViewportFrame,
	type ViewportState,
	wheelFactor,
	ZOOM_SLIDER_STEPS,
	zoomAt,
	zoomLimits,
	zoomPercent,
	zoomTo,
} from "./viewport.ts";

const STAGE = { width: 1000, height: 800 };
const PHOTO = { width: 4000, height: 2000 };

function frame(natural = PHOTO, container = STAGE): ViewportFrame {
	return { container, natural, limits: zoomLimits(fit(container, natural, 0)) };
}

function state(overrides: Partial<ViewportState> = {}): ViewportState {
	return { ...VIEWPORT_IDENTITY, ...overrides };
}

Deno.test("quarterTurn and rotatedSize reduce any accumulated turn", () => {
	assertEquals(quarterTurn(0), 0);
	assertEquals(quarterTurn(-90), 270);
	assertEquals(quarterTurn(450), 90);
	assertEquals(quarterTurn(Number.NaN), 0);
	assertEquals(rotatedSize(PHOTO, 90), { width: 2000, height: 4000 });
	assertEquals(rotatedSize(PHOTO, -180), PHOTO);
});

Deno.test("fit keeps a gutter, never upscales bitmaps, and upscales vectors on request", () => {
	assertAlmostEquals(fit(STAGE, PHOTO, 0), (1000 - 32) / 4000);
	assertAlmostEquals(fit(STAGE, PHOTO, 90), (800 - 32) / 4000);
	assertEquals(fit(STAGE, { width: 16, height: 16 }, 0), 1);
	assertAlmostEquals(fit(STAGE, { width: 16, height: 16 }, 0, { upscale: true }), 768 / 16);
	assertEquals(fit(STAGE, { width: 0, height: 10 }, 0), 1);
	assertEquals(fit({ width: 40, height: 40 }, { width: 80, height: 80 }, 0), 0.5);
});

Deno.test("zoomLimits always reach both the fit and 100%", () => {
	const big = zoomLimits(0.02);
	assert(big.min <= 0.02 && big.max >= 1);
	assertAlmostEquals(big.min, 0.001);
	assertEquals(big.max, 32);
	const vector = zoomLimits(20);
	assertEquals(vector.min, 0.05);
	assertEquals(vector.max, 640);
});

Deno.test("zoomAt keeps the point under the cursor fixed", () => {
	const f = frame();
	const start = state({ zoom: 1 });
	const point = { x: 700, y: 300 };
	const before = imageBounds(start, f.container, f.natural);
	const next = zoomAt(start, point, 2, f);
	const after = imageBounds(next, f.container, f.natural);
	const u = (point.x - before.left) / before.width;
	const v = (point.y - before.top) / before.height;
	assertAlmostEquals(after.left + u * after.width, point.x, 1e-6);
	assertAlmostEquals(after.top + v * after.height, point.y, 1e-6);
	assertEquals(next.zoom, 2);
});

Deno.test("zoomAt clamps to the limits and recentres a picture smaller than the stage", () => {
	const f = frame();
	const tiny = zoomAt(state({ zoom: 0.25 }), { x: 0, y: 0 }, 1e-6, f);
	assertEquals(tiny.zoom, f.limits.min);
	assertEquals([tiny.x, tiny.y], [0, 0]);
	assertEquals(zoomAt(state(), { x: 10, y: 10 }, 1e9, f).zoom, f.limits.max);
	assertEquals(zoomAt(state({ zoom: 2 }), { x: 10, y: 10 }, Number.NaN, f).zoom, 2);
});

Deno.test("zoomTo centres on the stage when no point is given", () => {
	const f = frame();
	const next = zoomTo(state({ zoom: 0.242 }), 1, null, f);
	assertEquals(next.zoom, 1);
	assertEquals([next.x, next.y], [0, 0]);
});

Deno.test("clampPan keeps an overflowing picture covering the stage", () => {
	const f = frame();
	const far = panBy(state({ zoom: 1 }), 5000, -5000, f);
	assertEquals(far.x, (4000 - 1000) / 2);
	assertEquals(far.y, -(2000 - 800) / 2);
	const fitted = fitView(state(), f.container, f.natural);
	assertEquals(panBy(fitted, 300, 300, f), fitted);
	const inside = state({ zoom: 1, x: 100, y: -50 });
	assertEquals(clampPan(inside, STAGE, PHOTO), inside);
	assertEquals(clampPan(state({ zoom: 0.1, x: 80, y: 80 }), STAGE, PHOTO), state({ zoom: 0.1 }));
	assert(canPan(state({ zoom: 1 }), STAGE, PHOTO));
	assert(!canPan(fitted, STAGE, PHOTO));
});

Deno.test("rotateBy turns the view on screen, the other way while mirrored once", () => {
	const cw = rotateBy(state({ x: 10, y: 0 }), 1);
	assertEquals(cw.rotation, 90);
	assertEquals([cw.x, cw.y], [0, 10]);
	assertEquals(rotateBy(cw, -1).rotation, 0);
	assertEquals(rotateBy(state({ flipX: true }), 1).rotation, -90);
	assertEquals(rotateBy(state({ flipX: true, flipY: true }), 1).rotation, 90);
	assertEquals(rotateBy(state({ rotation: 270 }), 1).rotation, 360);
});

Deno.test("flip mirrors on screen and maps to the picture's own axis after a quarter turn", () => {
	const h = flip(state({ x: 40 }), "horizontal");
	assertEquals([h.flipX, h.flipY, h.x], [true, false, -40]);
	assertEquals(imageFlips(h), { sx: -1, sy: 1 });
	const turned = flip(state({ rotation: 90 }), "horizontal");
	assertEquals(imageFlips(turned), { sx: 1, sy: -1 });
	assertEquals(flip(flip(state(), "vertical"), "vertical"), state());
});

Deno.test("toCss composes translate, rotate and a mirrored scale", () => {
	assertEquals(toCss(state()), "translate(0px, 0px) rotate(0deg) scale(1, 1)");
	assertEquals(
		toCss(state({ zoom: 0.5, x: 12.3456, y: -4, rotation: 90, flipX: true })),
		"translate(12.346px, -4px) rotate(90deg) scale(0.5, -0.5)",
	);
	assertEquals(toCss(state({ x: -0.0001 })), "translate(0px, 0px) rotate(0deg) scale(1, 1)");
});

Deno.test("wheelFactor is exponential, normalised for deltaMode and capped per event", () => {
	assertEquals(wheelFactor(0), 1);
	assert(wheelFactor(100) < 1 && wheelFactor(-100) > 1);
	assertAlmostEquals(wheelFactor(100) * wheelFactor(-100), 1, 1e-12);
	assertAlmostEquals(wheelFactor(3, 1), wheelFactor(48, 0), 1e-12);
	assertEquals(wheelFactor(5000), wheelFactor(200));
	assert(wheelFactor(10, 0, true) < wheelFactor(10, 0, false));
	assertEquals(wheelFactor(Number.NaN), 1);
});

Deno.test("pinch frames yield pan, spread ratio and wrapped twist", () => {
	const a = pinchFrame({ x: 0, y: 0 }, { x: 100, y: 0 });
	const b = pinchFrame({ x: 10, y: 10 }, { x: 10, y: 210 });
	const d = pinchDelta(a, b);
	assertEquals([d.dx, d.dy], [-40, 110]);
	assertEquals(d.scale, 2);
	assertEquals(d.rotation, 90);
	const flat = pinchDelta(pinchFrame({ x: 0, y: 0 }, { x: 0, y: 0 }), b);
	assertEquals([flat.scale, flat.rotation], [1, 0]);
	const wrap = pinchDelta(
		pinchFrame({ x: 0, y: 0 }, { x: -100, y: 1 }),
		pinchFrame({ x: 0, y: 0 }, { x: -100, y: -1 }),
	);
	assert(Math.abs(wrap.rotation) < 2);
});

Deno.test("snapTwist turns a finished twist into whole quarter turns", () => {
	assertEquals(snapTwist(44), 0);
	assertEquals(snapTwist(45), 1);
	assertEquals(snapTwist(-100), -1);
	assertEquals(snapTwist(170), 2);
	assertEquals(snapTwist(Number.NaN), 0);
});

Deno.test("isFitted recognises the fitted, centred state", () => {
	const f = frame();
	const fitZoom = fit(f.container, f.natural, 0);
	assert(isFitted(fitView(state({ zoom: 3, x: 50 }), f.container, f.natural), fitZoom));
	assert(!isFitted(state({ zoom: fitZoom, x: 3 }), fitZoom));
});

Deno.test("the zoom slider is logarithmic and round-trips", () => {
	const limits = zoomLimits(0.25);
	assertEquals(sliderPosition(limits.min, limits), 0);
	assertEquals(sliderPosition(limits.max, limits), ZOOM_SLIDER_STEPS);
	assertAlmostEquals(sliderZoom(0, limits), limits.min);
	assertAlmostEquals(sliderZoom(ZOOM_SLIDER_STEPS, limits), limits.max, 1e-9);
	const mid = sliderZoom(500, limits);
	assertAlmostEquals(mid, Math.sqrt(limits.min * limits.max), 1e-9);
	for (const pos of [0, 137, 500, 999]) {
		assertEquals(sliderPosition(sliderZoom(pos, limits), limits), pos);
	}
	assertEquals(sliderPosition(1, { min: 1, max: 1 }), 0);
});

Deno.test("labels: zoom percent and aspect ratio", () => {
	assertEquals(zoomPercent(1), "100%");
	assertEquals(zoomPercent(0.2423), "24%");
	assertEquals(zoomPercent(0.001), "1%");
	assertEquals(zoomPercent(Number.NaN), "0%");
	assertEquals(aspectRatioLabel(1920, 1080), "16:9");
	assertEquals(aspectRatioLabel(4000, 2000), "2:1");
	assertEquals(aspectRatioLabel(1200, 628), "1.91:1");
	assertEquals(aspectRatioLabel(0, 10), null);
});

Deno.test("thirdsBox follows the drawn picture: centred, panned, rotated", () => {
	const fitted = state({ zoom: 0.242 });
	assertEquals(thirdsBox(fitted, STAGE, PHOTO), { left: 16, top: 158, width: 968, height: 484 });
	const panned = state({ zoom: 0.242, x: 40.4, y: -10.6 });
	assertEquals(thirdsBox(panned, STAGE, PHOTO), { left: 56, top: 147, width: 968, height: 484 });
	const turned = state({ zoom: 0.192, rotation: 90 });
	assertEquals(thirdsBox(turned, STAGE, PHOTO), { left: 308, top: 16, width: 384, height: 768 });
});

Deno.test("thirdsBox overflows the stage when zoomed in and snaps to whole pixels", () => {
	const zoomed = state({ zoom: 1, x: 500, y: -200 });
	assertEquals(thirdsBox(zoomed, STAGE, PHOTO), {
		left: -1000,
		top: -800,
		width: 4000,
		height: 2000,
	});
	const box = thirdsBox(state({ zoom: 0.2501, x: 0.3 }), STAGE, PHOTO);
	assert(box !== null);
	assertEquals(Number.isInteger(box.left) && Number.isInteger(box.width), true);
	assertEquals(box.left + box.width, Math.round(500 + 0.3 + 500.2));
});

Deno.test("thirdsBox is null before anything is drawn", () => {
	assertEquals(thirdsBox(state(), STAGE, { width: 0, height: 10 }), null);
	assertEquals(thirdsBox(state(), { width: 0, height: 0 }, PHOTO), null);
	assertEquals(thirdsBox(state({ zoom: 1e-6 }), STAGE, PHOTO), null);
});
