import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	releaseVelocity,
	SHEET_EXPAND_PX,
	SHEET_STRETCH_PX,
	sheetDragOffset,
	sheetRelease,
} from "./sheet-gesture.ts";

Deno.test("sheetDragOffset follows a downward drag and resists an upward one", () => {
	assertEquals(sheetDragOffset("half", 0), 0);
	assertEquals(sheetDragOffset("half", 120), 120);
	assertEquals(sheetDragOffset("half", Number.NaN), 0);
	const up = sheetDragOffset("half", -48);
	assertAlmostEquals(up, -24);
	const far = sheetDragOffset("half", -10_000);
	assert(far < 0 && far > -SHEET_STRETCH_PX.half);
	assert(sheetDragOffset("full", -10_000) > -SHEET_STRETCH_PX.full);
});

Deno.test("releaseVelocity measures only the last 100 ms", () => {
	assertEquals(releaseVelocity([]), 0);
	assertEquals(releaseVelocity([{ t: 10, y: 5 }]), 0);
	const samples = [
		{ t: 0, y: 0 },
		{ t: 200, y: 0 },
		{ t: 250, y: 25 },
		{ t: 300, y: 50 },
	];
	assertAlmostEquals(releaseVelocity(samples), 0.5);
	assertAlmostEquals(releaseVelocity([{ t: 0, y: 100 }, { t: 50, y: 50 }]), -1);
});

Deno.test("sheetRelease snaps back on a short, slow drag", () => {
	const base = { snap: "half" as const, height: 400 };
	assertEquals(sheetRelease({ ...base, travel: 100, velocity: 0.1 }), "half");
	assertEquals(sheetRelease({ ...base, travel: 119, velocity: 0.49 }), "half");
	assertEquals(sheetRelease({ ...base, travel: 3, velocity: 2 }), "half");
});

Deno.test("sheetRelease dismisses a half sheet dragged 30% or flung down", () => {
	const base = { snap: "half" as const, height: 400 };
	assertEquals(sheetRelease({ ...base, travel: 120, velocity: 0 }), "dismiss");
	assertEquals(sheetRelease({ ...base, travel: 40, velocity: 0.8 }), "dismiss");
	assertEquals(sheetRelease({ ...base, travel: 40, velocity: Number.NaN }), "half");
});

Deno.test("sheetRelease drops a full sheet to half, and dismisses it only when dragged far", () => {
	const base = { snap: "full" as const, height: 800 };
	assertEquals(sheetRelease({ ...base, travel: 100, velocity: 0.1 }), "full");
	assertEquals(sheetRelease({ ...base, travel: 300, velocity: 0 }), "half");
	assertEquals(sheetRelease({ ...base, travel: 60, velocity: 1.2 }), "half");
	assertEquals(sheetRelease({ ...base, travel: 500, velocity: 0 }), "dismiss");
});

Deno.test("sheetRelease expands a half sheet dragged or flung up; a full sheet stays", () => {
	const half = { snap: "half" as const, height: 400 };
	assertEquals(sheetRelease({ ...half, travel: -SHEET_EXPAND_PX, velocity: 0 }), "full");
	assertEquals(sheetRelease({ ...half, travel: -10, velocity: -0.9 }), "full");
	assertEquals(sheetRelease({ ...half, travel: -20, velocity: -0.1 }), "half");
	assertEquals(sheetRelease({ snap: "full", height: 800, travel: -200, velocity: -2 }), "full");
});
