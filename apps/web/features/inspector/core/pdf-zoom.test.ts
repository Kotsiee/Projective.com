import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	anchorAt,
	anchorOffset,
	clampZoom,
	currentPage,
	displayRatio,
	displaySize,
	fitZoom,
	layoutPages,
	normalizeRotation,
	PDF_CSS_UNITS,
	PDF_ZOOM_MAX,
	PDF_ZOOM_MIN,
	type PdfPageBox,
	rescaleScroll,
	rotateBy,
	stepZoom,
	visiblePages,
	wheelZoom,
	zoomPercent,
} from "./pdf-zoom.ts";

const LETTER: PdfPageBox = { width: 612, height: 792, rotate: 0 };
const SPACING = { gap: 10, padding: 20 };

Deno.test("clampZoom and stepZoom stay in range and walk the stops", () => {
	assertEquals(clampZoom(100), PDF_ZOOM_MAX);
	assertEquals(clampZoom(0), PDF_ZOOM_MIN);
	assertEquals(clampZoom(Number.NaN), 1);
	assertEquals(stepZoom(1, 1), 1.1);
	assertEquals(stepZoom(1, -1), 0.9);
	assertEquals(stepZoom(1.17, 1), 1.25);
	assertEquals(stepZoom(1.17, -1), 1.1);
	assertEquals(stepZoom(PDF_ZOOM_MAX, 1), PDF_ZOOM_MAX);
	assertEquals(stepZoom(PDF_ZOOM_MIN, -1), PDF_ZOOM_MIN);
});

Deno.test("wheelZoom is exponential and normalised for deltaMode", () => {
	const down = wheelZoom(1, 360);
	assertAlmostEquals(down, 0.5);
	assertAlmostEquals(wheelZoom(1, -360), 2);
	assertAlmostEquals(wheelZoom(1, 22.5, 1), 0.5);
	assertEquals(wheelZoom(PDF_ZOOM_MAX, -1000), PDF_ZOOM_MAX);
});

Deno.test("zoomPercent rounds to a whole percent", () => {
	assertEquals(zoomPercent(1.254), "125%");
	assertEquals(zoomPercent(0.1), "10%");
});

Deno.test("rotation snaps to quarter turns and adds the page's own", () => {
	assertEquals(rotateBy(0, 1), 90);
	assertEquals(rotateBy(0, -1), 270);
	assertEquals(rotateBy(270, 1), 0);
	assertEquals(normalizeRotation(-450), 270);
	assertEquals(normalizeRotation(44), 0);
	assertEquals(normalizeRotation(46), 90);
	const size = displaySize({ ...LETTER, rotate: 90 }, 0, 1);
	assertAlmostEquals(size.width, 792 * PDF_CSS_UNITS);
	assertAlmostEquals(size.height, 612 * PDF_CSS_UNITS);
	const back = displaySize({ ...LETTER, rotate: 90 }, 270, 1);
	assertAlmostEquals(back.width, 612 * PDF_CSS_UNITS);
	assertAlmostEquals(displayRatio(LETTER, 90), 792 / 612);
});

Deno.test("fitZoom fits the width or the whole page inside the padding", () => {
	const viewport = { width: 856, height: 600 };
	const width = fitZoom("width", LETTER, 0, viewport, SPACING);
	assertAlmostEquals(width * 612 * PDF_CSS_UNITS, 816);
	const page = fitZoom("page", LETTER, 0, viewport, SPACING);
	assertAlmostEquals(page * 792 * PDF_CSS_UNITS, 560);
	const turned = fitZoom("width", LETTER, 90, viewport, SPACING);
	assertAlmostEquals(turned * 792 * PDF_CSS_UNITS, 816);
	assertEquals(fitZoom("width", LETTER, 0, { width: 0, height: 0 }, SPACING), PDF_ZOOM_MIN);
});

Deno.test("layoutPages stacks pages with gaps and padding", () => {
	const layout = layoutPages(
		[LETTER, LETTER, { width: 792, height: 612, rotate: 0 }],
		0,
		0.75,
		SPACING,
	);
	assertEquals(layout.tops[0], 20);
	assertEquals(layout.tops[1], 20 + 792 + 10);
	assertEquals(layout.tops[2], 20 + 792 + 10 + 792 + 10);
	assertEquals(layout.height, layout.tops[2] + 612 + 20);
	assertEquals(layout.width, 792 + 40);
});

Deno.test("visiblePages and currentPage read the scroll position", () => {
	const layout = layoutPages([LETTER, LETTER, LETTER, LETTER], 0, 0.75, SPACING);
	assertEquals(visiblePages(layout, 0, 500), { first: 0, last: 0 });
	assertEquals(visiblePages(layout, 700, 500), { first: 0, last: 1 });
	assertEquals(visiblePages(layout, 813, 10), { first: 1, last: 1 });
	assertEquals(visiblePages(layout, 0, 0), null);
	assertEquals(visiblePages(layoutPages([], 0, 1, SPACING), 0, 100), null);
	assertEquals(currentPage(layout, 700, 500), 1);
	assertEquals(currentPage(layout, 300, 500), 0);
	assertEquals(currentPage(layout, layout.height, 500), 3);
});

Deno.test("a scroll anchor survives a re-layout", () => {
	const before = layoutPages([LETTER, LETTER, LETTER], 0, 0.75, SPACING);
	const anchor = anchorAt(before, before.tops[1] + 396);
	assertEquals(anchor.page, 1);
	assertAlmostEquals(anchor.fraction, 0.5);
	const after = layoutPages([LETTER, LETTER, LETTER], 0, 1.5, SPACING);
	assertAlmostEquals(anchorOffset(after, anchor), after.tops[1] + after.sizes[1].height / 2);
	assertEquals(anchorAt(before, 0), { page: 0, fraction: 0 });
});

Deno.test("rescaleScroll keeps the pointer's content in place", () => {
	assertEquals(rescaleScroll(100, 50, 1000, 2000), 250);
	assertEquals(rescaleScroll(0, 0, 0, 100), 0);
	assert(rescaleScroll(0, 400, 1000, 500) >= 0);
});
