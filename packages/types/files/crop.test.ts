import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	centreBounds,
	clampCrop,
	cropBox,
	type CropImage,
	type CropState,
	CropStateSchema,
	dragCentre,
	fitHeight,
	INITIAL_CROP,
	isAxisAligned,
	sourcePointFor,
	stageTransform,
	wheelZoom,
	wrapRotation,
} from "./crop.ts";

const LANDSCAPE: CropImage = { width: 4000, height: 3000 };
const PORTRAIT: CropImage = { width: 900, height: 1600 };

Deno.test("fitHeight: at 0° the tight axis decides, for a square and a 16:10 box", () => {
	assertAlmostEquals(fitHeight(LANDSCAPE, 1, 0), 3000);
	assertAlmostEquals(fitHeight(LANDSCAPE, 16 / 10, 0), 2500);
	assertAlmostEquals(fitHeight(PORTRAIT, 1, 0), 900);
});

Deno.test("fitHeight: at 90° the box's width runs along the picture's height", () => {
	assertAlmostEquals(fitHeight(LANDSCAPE, 1, 90), 3000);
	assertAlmostEquals(fitHeight(LANDSCAPE, 16 / 10, 90), 1875);
});

Deno.test("fitHeight: a rotated box shrinks so its bounding box still fits", () => {
	const at45 = fitHeight(LANDSCAPE, 1, 45);
	// A square rotated 45° has a bounding box √2 times its side.
	assertAlmostEquals(at45, 3000 / Math.SQRT2, 1e-6);
});

Deno.test("centreBounds: zero on the tight axis at zoom 1, and it grows with zoom", () => {
	const at1 = centreBounds({ zoom: 1, rotation: 0 }, LANDSCAPE, 1);
	assertAlmostEquals(at1.x, 500);
	assertAlmostEquals(at1.y, 0);
	const at2 = centreBounds({ zoom: 2, rotation: 0 }, LANDSCAPE, 1);
	assertAlmostEquals(at2.x, 1250);
	assertAlmostEquals(at2.y, 750);
});

Deno.test("clampCrop: pulls an out-of-range centre back to the boundary and wraps the angle", () => {
	const s = clampCrop({ zoom: 1, rotation: 190, cx: 99_999, cy: -99_999 }, LANDSCAPE, 1);
	assertEquals(s.rotation, -170);
	const b = centreBounds(s, LANDSCAPE, 1);
	assertAlmostEquals(s.cx, b.x);
	assertAlmostEquals(s.cy, -b.y);
});

Deno.test("clampCrop: non-finite input degrades to the initial state rather than throwing", () => {
	const s = clampCrop({ zoom: NaN, rotation: Infinity, cx: NaN, cy: NaN }, LANDSCAPE, 1);
	assertEquals(s, INITIAL_CROP);
});

/**
 * THE invariant: after clamping, every corner of the crop box — at any zoom, rotation and centre,
 * for any aspect — lies inside the picture. Swept deterministically rather than randomly so a
 * failure is reproducible.
 */
Deno.test("invariant: a clamped crop never leaves the picture", () => {
	const images: CropImage[] = [LANDSCAPE, PORTRAIT, { width: 1200, height: 1200 }, { width: 5000, height: 400 }];
	const aspects = [1, 16 / 10, 3 / 4, 7 / 2];
	for (const image of images) {
		for (const aspect of aspects) {
			for (let rot = -180; rot <= 180; rot += 15) {
				for (const zoom of [1, 1.3, 2.7, 6]) {
					for (const [cx, cy] of [[0, 0], [1e5, 1e5], [-1e5, 3e4], [-321, 17]]) {
						const s = clampCrop({ zoom, rotation: rot, cx, cy }, image, aspect);
						for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
							const p = sourcePointFor(s, image, aspect, u, v);
							const eps = 1e-6 * Math.max(image.width, image.height);
							assert(
								p.x >= -eps && p.x <= image.width + eps && p.y >= -eps && p.y <= image.height + eps,
								`corner (${u},${v}) at ${JSON.stringify(s)} on ${image.width}×${image.height} a=${aspect} → ${p.x},${p.y}`,
							);
						}
					}
				}
			}
		}
	}
});

Deno.test("sourcePointFor: at 0° the box centre is the crop centre and corners are axis-aligned", () => {
	const s: CropState = clampCrop({ zoom: 2, rotation: 0, cx: 300, cy: -200 }, LANDSCAPE, 1);
	const c = sourcePointFor(s, LANDSCAPE, 1, 0.5, 0.5);
	assertAlmostEquals(c.x, 2000 + s.cx);
	assertAlmostEquals(c.y, 1500 + s.cy);
	const box = cropBox(s, LANDSCAPE, 1);
	const tl = sourcePointFor(s, LANDSCAPE, 1, 0, 0);
	assertAlmostEquals(tl.x, c.x - box.width / 2);
	assertAlmostEquals(tl.y, c.y - box.height / 2);
});

Deno.test("sourcePointFor: rotation turns the box against the picture (editor rotates the picture)", () => {
	// Picture rotated 90° clockwise on screen ⇒ the box's top edge reads the picture's LEFT edge.
	const s = clampCrop({ zoom: 1, rotation: 90, cx: 0, cy: 0 }, { width: 1000, height: 1000 }, 1);
	const topMid = sourcePointFor(s, { width: 1000, height: 1000 }, 1, 0.5, 0);
	assertAlmostEquals(topMid.x, 0, 1e-6);
	assertAlmostEquals(topMid.y, 500, 1e-6);
});

Deno.test("stageTransform: the crop centre lands on the stage centre", () => {
	const s = clampCrop({ zoom: 2, rotation: 30, cx: 120, cy: -80 }, LANDSCAPE, 16 / 10);
	const t = stageTransform(s, LANDSCAPE, 16 / 10, 640);
	// Apply the element transform to the picture point (cx, cy): T + R(r)·(s·p) must be the origin.
	const rad = (t.rotation * Math.PI) / 180;
	const x = t.tx + (s.cx * t.scale) * Math.cos(rad) - (s.cy * t.scale) * Math.sin(rad);
	const y = t.ty + (s.cx * t.scale) * Math.sin(rad) + (s.cy * t.scale) * Math.cos(rad);
	assertAlmostEquals(x, 0, 1e-9);
	assertAlmostEquals(y, 0, 1e-9);
	// …and the box fills the stage's width.
	assertAlmostEquals(cropBox(s, LANDSCAPE, 16 / 10).width * t.scale, 640, 1e-9);
});

Deno.test("dragCentre: a drag and its reverse cancel out", () => {
	const s = clampCrop({ zoom: 3, rotation: -40, cx: 10, cy: 20 }, LANDSCAPE, 1);
	const a = { ...s, ...dragCentre(s, LANDSCAPE, 1, 400, 37, -12) };
	const b = dragCentre(a, LANDSCAPE, 1, 400, -37, 12);
	assertAlmostEquals(b.cx, s.cx, 1e-9);
	assertAlmostEquals(b.cy, s.cy, 1e-9);
});

Deno.test("wheelZoom: up zooms in, down zooms out, both clamped", () => {
	assert(wheelZoom(1, -100) > 1);
	assertEquals(wheelZoom(1, 5000), 1);
	assertEquals(wheelZoom(6, -5000), 6);
});

Deno.test("wrapRotation + isAxisAligned", () => {
	assertEquals(wrapRotation(540), 180);
	assertEquals(wrapRotation(-180), 180);
	assert(isAxisAligned({ rotation: 0 }));
	assert(isAxisAligned({ rotation: 360 }));
	assert(!isAxisAligned({ rotation: 180 }));
	assert(!isAxisAligned({ rotation: 0.5 }));
});

Deno.test("CropStateSchema: accepts the editor's range and refuses absurd values", () => {
	assert(CropStateSchema.safeParse({ zoom: 1.5, rotation: -45, cx: 10, cy: 0 }).success);
	assert(!CropStateSchema.safeParse({ zoom: 0.5, rotation: 0, cx: 0, cy: 0 }).success);
	assert(!CropStateSchema.safeParse({ zoom: 1, rotation: 0, cx: 1e9, cy: 0 }).success);
});
