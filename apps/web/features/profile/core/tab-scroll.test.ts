import { assertEquals } from "@std/assert";
import { tabScrollLanding } from "./tab-scroll.ts";

/**
 * The tab-switch landing rule, pinned at a fixed geometry: a tab bar whose natural top is at 1004
 * and pins at 104 (so it is exactly pinned at scrollY 900), over arriving documents of different
 * heights. Each case is a CLAIM about where a reader ends up after clicking a tab — the failure
 * mode is a page that jumps somewhere the reader did not ask to go, which a source-reading review
 * cannot see. The note carries a DISTANCE from the bar, never an absolute position.
 */

const barTop = 1004;
const pinned = 104;

Deno.test("a position still inside the arriving section is kept exactly", () => {
	// 1500 below the bar's natural top → 2504.
	assertEquals(
		tabScrollLanding({ offset: 1500 }, { barTop, pinned, maxScroll: 5000 }),
		{ top: 2504, mode: "keep" },
	);
	// Exactly the document's last scrollable pixel still counts as inside.
	assertEquals(
		tabScrollLanding({ offset: 3996 }, { barTop, pinned, maxScroll: 5000 }),
		{ top: 5000, mode: "keep" },
	);
});

Deno.test("a position above the tab bar is kept — nothing above it changed", () => {
	assertEquals(
		tabScrollLanding({ offset: -884 }, { barTop, pinned, maxScroll: 1400 }),
		{ top: 120, mode: "keep" },
	);
	assertEquals(
		tabScrollLanding({ offset: -1004 }, { barTop, pinned, maxScroll: 1400 }),
		{ top: 0, mode: "keep" },
	);
});

Deno.test("a shorter section anchors at the top of the tab container, settling from the page bottom", () => {
	assertEquals(
		tabScrollLanding({ offset: 2000 }, { barTop, pinned, maxScroll: 1400 }),
		{ top: 900, mode: "anchor", from: 1400 },
	);
});

Deno.test("a section too short to pin the bar anchors at the document's own bottom", () => {
	// The bar cannot reach its pinned line on a 600px-scroll page: the closest honest place is the
	// bottom, and the settle has nowhere to travel.
	assertEquals(
		tabScrollLanding({ offset: 2000 }, { barTop, pinned, maxScroll: 600 }),
		{ top: 600, mode: "anchor", from: 600 },
	);
	// A page with no scroll range at all lands at 0 either way.
	assertEquals(
		tabScrollLanding({ offset: 2000 }, { barTop, pinned, maxScroll: 0 }),
		{ top: 0, mode: "anchor", from: 0 },
	);
});

Deno.test("a distance that resolves above the document's top is treated as the top", () => {
	assertEquals(
		tabScrollLanding({ offset: -5000 }, { barTop, pinned, maxScroll: 1400 }),
		{ top: 0, mode: "keep" },
	);
});
