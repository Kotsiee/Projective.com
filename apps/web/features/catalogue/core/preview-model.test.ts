import { assert, assertEquals } from "@std/assert";
import {
	DESKTOP_FRAME_WIDTH,
	deviceSize,
	leavesFrame,
	MIN_PREVIEW_SCALE,
	MOBILE_BEZEL,
	MOBILE_VIEWPORT,
	previewScale,
	readScrollMessage,
	savedTransition,
	scrollMessage,
} from "./preview-model.ts";

const css = Deno.readTextFileSync(new URL("../styles/preview.css", import.meta.url));

// #region Scale
Deno.test("preview scale: desktop fits the 1280px frame by width and never magnifies", () => {
	assertEquals(previewScale("desktop", { width: 640, height: 400 }), 0.5);
	assertEquals(previewScale("desktop", { width: 960, height: 10 }), 0.75);
	assertEquals(previewScale("desktop", { width: 1280, height: 900 }), 1);
	assertEquals(previewScale("desktop", { width: 2560, height: 900 }), 1);
});

Deno.test("preview scale: mobile fits the whole device, bezel included, both ways", () => {
	const device = deviceSize("mobile");
	assertEquals(device, {
		width: MOBILE_VIEWPORT.width + 2 * MOBILE_BEZEL,
		height: MOBILE_VIEWPORT.height + 2 * MOBILE_BEZEL,
	});
	// Height-bound: a wide but short canvas.
	assertEquals(previewScale("mobile", { width: 2000, height: device.height / 2 }), 0.5);
	// Width-bound: a narrow canvas.
	assertEquals(previewScale("mobile", { width: device.width / 4, height: 4000 }), 0.25);
	assertEquals(previewScale("mobile", { width: 4000, height: 4000 }), 1);
});

Deno.test("preview scale: an unmeasured box draws at 1, and the floor holds", () => {
	assertEquals(previewScale("desktop", { width: 0, height: 0 }), 1);
	assertEquals(previewScale("mobile", { width: Number.NaN, height: -1 }), 1);
	assertEquals(previewScale("desktop", { width: 10, height: 10 }), MIN_PREVIEW_SCALE);
	const s = previewScale("desktop", { width: 1000, height: 10 });
	assert(s > 0 && s <= 1);
	assertEquals(s, Math.round((1000 / DESKTOP_FRAME_WIDTH) * 10_000) / 10_000);
});

Deno.test("preview scale: the model's device sizes are the stylesheet's", () => {
	assert(css.includes(`--cat-preview-bezel: ${MOBILE_BEZEL}px;`));
	assert(css.includes(`--cat-preview-desktop-w: ${DESKTOP_FRAME_WIDTH}px;`));
	assert(css.includes(`--cat-preview-mobile-vw: ${MOBILE_VIEWPORT.width}px;`));
	assert(css.includes(`--cat-preview-mobile-vh: ${MOBILE_VIEWPORT.height}px;`));
	assert(css.includes("transform: scale(var(--cat-preview-scale));"));
});
// #endregion

// #region Leaving the frame
Deno.test("preview frame: only a link to another document leaves the frame", () => {
	const here = new URL("https://app.example.test/catalogue/svc-abc/simulate");
	assertEquals(leavesFrame("#evp-reviews", here), false);
	assertEquals(leavesFrame("/catalogue/svc-abc/simulate#more", here), false);
	assertEquals(leavesFrame("/view/svc-abc/schedule", here), true);
	assertEquals(leavesFrame("/@ivy", here), true);
	assertEquals(leavesFrame("/catalogue/svc-abc/simulate?x=1", here), true);
	assertEquals(leavesFrame("https://elsewhere.example/", here), true);
	assertEquals(leavesFrame("mailto:ivy@example.test", here), false);
	assertEquals(leavesFrame("javascript:void(0)", here), false);
});
// #endregion

// #region Reload and scroll
Deno.test("preview reload: only a save landing (saving → saved) reloads the frame", () => {
	assertEquals(savedTransition("saving", "saved"), true);
	assertEquals(savedTransition("dirty", "saved"), false);
	assertEquals(savedTransition("saved", "saved"), false);
	assertEquals(savedTransition("saving", "error"), false);
	assertEquals(savedTransition("saving", "conflict"), false);
});

Deno.test("preview scroll: messages are built clamped and read defensively", () => {
	assertEquals(scrollMessage("report", 120.6), {
		type: "pj:preview-scroll",
		phase: "report",
		y: 121,
	});
	assertEquals(scrollMessage("restore", -5).y, 0);
	assertEquals(scrollMessage("ready").y, 0);
	assertEquals(readScrollMessage({ type: "pj:preview-scroll", phase: "restore", y: 40 })?.y, 40);
	assertEquals(readScrollMessage({ type: "pj:preview-scroll", phase: "nope", y: 40 }), null);
	assertEquals(readScrollMessage({ type: "other", phase: "report", y: 1 }), null);
	assertEquals(readScrollMessage("pj:preview-scroll"), null);
	assertEquals(readScrollMessage(null), null);
});
// #endregion
