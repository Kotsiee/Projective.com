/**
 * The store's behaviour under the gestures that drive it — with the springs and the DOM stripped
 * away, which is the whole point: a zoom that drifts, a scroll that escapes its range or a fit that
 * lands a day off are all invisible in the preview harness and all visible here.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { signal } from "@preact/signals";
import { DAY } from "../../calendar/core/time.ts";
import { createGanttStore, ROW_SCALE_RANGE, ZOOM_ANCHOR_HOLD_MS } from "./gantt-store.ts";
import { PX_PER_DAY_MAX, PX_PER_DAY_MIN } from "./time-scale.ts";

const ORIGIN = Date.parse("2026-07-13T00:00:00Z");

function make(ppd = 40) {
	const store = createGanttStore({ originMs: ORIGIN, timezone: "UTC", pxPerDay: ppd, rowH: 40 });
	store.viewportW.value = 800;
	store.viewportH.value = 200;
	store.laneCount.value = 10;
	return store;
}

Deno.test("scrollTo / scrollBy — Y is clamped to the lane range, X is free", () => {
	const s = make();
	s.scrollTo(-5000, -10);
	assertEquals(s.scrollX.value, -5000);
	assertEquals(s.scrollY.value, 0);
	s.scrollTo(undefined, 10_000);
	assertEquals(s.scrollY.value, 200, "10 lanes × 40 − a 200px viewport");
	s.scrollBy(100, -50);
	assertEquals(s.scrollX.value, -4900);
	assertEquals(s.scrollY.value, 150);
});

Deno.test("centerOn / visibleRange — the instant lands mid-viewport", () => {
	const s = make(40);
	const target = ORIGIN + 30 * DAY;
	s.centerOn(target);
	const range = s.visibleRange.value;
	assertAlmostEquals((range.start + range.end) / 2, target, 1);
	assertAlmostEquals((range.end - range.start) / DAY, 20, 1e-9);
});

Deno.test("setZoom without an anchor — the viewport CENTRE holds still", () => {
	const s = make(40);
	s.centerOn(ORIGIN + 10 * DAY);
	const before = s.visibleRange.value;
	const centre = (before.start + before.end) / 2;
	s.setZoom(80);
	const after = s.visibleRange.value;
	assertAlmostEquals((after.start + after.end) / 2, centre, 1);
	assertAlmostEquals((after.end - after.start) / DAY, 10, 1e-9);
});

Deno.test("setZoom with a cursor anchor — the instant under the cursor holds still across a burst", () => {
	const s = make(40);
	s.centerOn(ORIGIN + 10 * DAY);
	const viewX = 150;
	const now = 1_000_000;
	s.setZoomAnchor(viewX, now);
	const held = s.msAtViewX(viewX);
	let ppd = 40;
	for (let i = 0; i < 12; i++) {
		ppd *= 1.12;
		s.setZoom(ppd, now + i * 10);
		assertAlmostEquals(s.msAtViewX(viewX), held, 1, `notch ${i}`);
	}
	// A lapsed anchor returns to centre-pinning.
	s.setZoom(40, now + ZOOM_ANCHOR_HOLD_MS * 4);
	assert(
		Math.abs(s.msAtViewX(viewX) - held) > 1,
		"after the hold lapses the cursor is no longer pinned",
	);
});

Deno.test("setZoomAnchor — a live anchor at the same place is EXTENDED, not re-derived", () => {
	const s = make(40);
	const now = 5_000;
	s.setZoomAnchor(100, now);
	const held = s.msAtViewX(100);
	s.setZoom(60, now + 5); // the scale moves; the offset re-pins
	s.setZoomAnchor(101, now + 10); // within the slop: keep the captured instant
	s.setZoom(90, now + 15);
	assertAlmostEquals(s.msAtViewX(100), held, 1);
});

Deno.test("setZoom / zoomBy — clamped to the zoom range", () => {
	const s = make(40);
	s.setZoom(1e9);
	assertEquals(s.pxPerDay.value, PX_PER_DAY_MAX);
	s.zoomBy(1e-9);
	assertEquals(s.pxPerDay.value, PX_PER_DAY_MIN);
});

Deno.test("fitRange — the range fills the viewport less the pad, centred", () => {
	const s = make(40);
	const range = { start: ORIGIN + 3 * DAY, end: ORIGIN + 43 * DAY };
	s.fitRange(range, 0.1);
	assertAlmostEquals(s.viewXOf(range.start), 80, 1e-6);
	assertAlmostEquals(s.viewXOf(range.end), 720, 1e-6);
});

Deno.test("a host-owned zoom signal is written back into, and respected on construction", () => {
	const zoom = signal(1e9);
	const s = createGanttStore({ originMs: ORIGIN, timezone: "UTC", pxPerDay: zoom });
	assertEquals(zoom.value, PX_PER_DAY_MAX, "clamped on construction");
	s.viewportW.value = 800;
	s.setZoom(50);
	assertEquals(zoom.value, 50);
	assertEquals(s.pxPerDay, zoom, "the store holds the host's signal, not a copy");
});

Deno.test("scaleRows — bounded, and the vertical offset stays inside the shorter content", () => {
	const s = make();
	s.scrollTo(undefined, 200);
	s.scaleRows(0.5);
	assertEquals(s.rowScale.value, ROW_SCALE_RANGE[0]);
	assert(s.scrollY.value <= s.maxScrollY.value);
	s.scaleRows(100);
	assertEquals(s.rowScale.value, ROW_SCALE_RANGE[1]);
});

Deno.test("revealX / revealLane — no-ops when in view, minimal moves when not", () => {
	const s = make(40);
	s.scrollTo(0, 0);
	s.revealX(100, 200);
	assertEquals(s.scrollX.value, 0);
	s.revealX(900, 1000);
	assertEquals(s.scrollX.value, 1000 - 800 + 24);
	s.revealX(-100, -50);
	assertEquals(s.scrollX.value, -124);
	s.revealLane(0);
	assertEquals(s.scrollY.value, 0);
	s.revealLane(9);
	assertEquals(s.scrollY.value, 200);
});

Deno.test("geometry — the hovered lane's expansion reaches contentH and maxScrollY", () => {
	const s = make();
	assertEquals(s.contentH.value, 400);
	s.hoverLane.value = 3;
	s.expandPx.value = 20;
	assertEquals(s.contentH.value, 420);
	assertEquals(s.maxScrollY.value, 220);
	assertEquals(s.geometry(), { rowH: 40, laneCount: 10, hoverLane: 3, expandPx: 20 });
});

Deno.test("endFly — clears fly mode and is idempotent", () => {
	const s = make();
	s.fly.value = { x: 10, y: 10 };
	s.endFly();
	assertEquals(s.fly.value, null);
	s.endFly();
	assertEquals(s.fly.value, null);
});
