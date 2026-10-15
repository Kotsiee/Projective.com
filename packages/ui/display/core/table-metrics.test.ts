import { assertEquals } from "@std/assert";
import { fixedMetrics, rescaleScroll, VariableMetrics, visibleRange } from "./table-metrics.ts";

// #region fixedMetrics
Deno.test("fixed rows place each row at index × height", () => {
	const m = fixedMetrics(100, 40);
	assertEquals(m.total(), 4000);
	assertEquals(m.offsetOf(3), 120);
	assertEquals(m.indexAt(119), 2);
	assertEquals(m.indexAt(120), 3);
	assertEquals(m.indexAt(99_999), 99);
});

Deno.test("an empty fixed list has no range", () => {
	assertEquals(visibleRange(fixedMetrics(0, 40), 0, 500, 4), { start: 0, end: -1 });
});
// #endregion

// #region VariableMetrics
Deno.test("variable rows sum their own heights", () => {
	const m = new VariableMetrics([10, 20, 30, 40, 50]);
	assertEquals(m.total(), 150);
	assertEquals(m.offsetOf(0), 0);
	assertEquals(m.offsetOf(3), 60);
	assertEquals(m.indexAt(0), 0);
	assertEquals(m.indexAt(29), 1);
	assertEquals(m.indexAt(30), 2);
	assertEquals(m.indexAt(149), 4);
	assertEquals(m.indexAt(10_000), 4);
});

Deno.test("a measurement shifts every later offset and reports its delta", () => {
	const m = new VariableMetrics(Array.from({ length: 1000 }, () => 48));
	assertEquals(m.setSize(10, 120), 72);
	assertEquals(m.offsetOf(10), 480);
	assertEquals(m.offsetOf(11), 600);
	assertEquals(m.total(), 1000 * 48 + 72);
	assertEquals(m.indexAt(599), 10);
	assertEquals(m.indexAt(600), 11);
	assertEquals(m.setSize(10, 120), 0);
});

Deno.test("variable lookups agree with a linear scan", () => {
	const sizes = Array.from({ length: 257 }, (_, i) => 20 + ((i * 37) % 61));
	const m = new VariableMetrics(sizes);
	let at = 0;
	for (let i = 0; i < sizes.length; i++) {
		assertEquals(m.offsetOf(i), at);
		assertEquals(m.indexAt(at), i);
		assertEquals(m.indexAt(at + sizes[i] - 1), i);
		at += sizes[i];
	}
});
// #endregion

// #region visibleRange + rescaleScroll
Deno.test("the range covers the viewport plus overscan, clamped to the list", () => {
	const m = fixedMetrics(100, 50);
	assertEquals(visibleRange(m, 0, 500, 3), { start: 0, end: 12 });
	assertEquals(visibleRange(m, 1000, 500, 3), { start: 17, end: 32 });
	assertEquals(visibleRange(m, 4800, 500, 3), { start: 93, end: 99 });
});

Deno.test("a zoom step keeps the same row under the top edge", () => {
	assertEquals(rescaleScroll(1000, 40, 60), 1500);
	assertEquals(rescaleScroll(0, 40, 60), 0);
	assertEquals(rescaleScroll(500, 0, 60), 500);
});
// #endregion
