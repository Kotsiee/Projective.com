/**
 * The scroll geometry behind "On this page" and the reading-progress bar.
 *
 * Both fail silently: a scroll-spy that picks the wrong heading still highlights SOMETHING, and a
 * progress bar that never reaches 100% still moves. So the edges are pinned — before the first
 * heading, a heading exactly on the line, the end of the page, a document too short to need a bar.
 */
import { assertEquals } from "@std/assert";
import type { TocEntry } from "@projective/types/content";
import { pickActiveHeading, readingLineFor, readingRatio, tocIds, tocText } from "./scroll-spy.ts";

const at = (line: number, atEnd = false) => ({ line, viewport: 800, atEnd });
const headings = [
	{ id: "a", top: 300 },
	{ id: "b", top: 900 },
	{ id: "c", top: 1500 },
];

// #region pickActiveHeading
Deno.test("nothing is current while the reader is above the first heading", () => {
	assertEquals(pickActiveHeading(headings, at(120)), null);
});

Deno.test("the last heading reached is current", () => {
	assertEquals(
		pickActiveHeading(
			[{ id: "a", top: -400 }, { id: "b", top: 100 }, { id: "c", top: 700 }],
			at(120),
		),
		"b",
	);
});

Deno.test("a heading sitting exactly on the line (where a jump lands it) is current", () => {
	assertEquals(pickActiveHeading([{ id: "a", top: -400 }, { id: "b", top: 120 }], at(120)), "b");
	assertEquals(pickActiveHeading([{ id: "a", top: -400 }, { id: "b", top: 120.6 }], at(120)), "b");
});

Deno.test("at the end of the page the last heading on screen wins", () => {
	const end = [{ id: "a", top: -900 }, { id: "b", top: 200 }, { id: "c", top: 650 }];
	assertEquals(pickActiveHeading(end, at(120)), "a", "neither b nor c reached the line");
	assertEquals(pickActiveHeading(end, at(120, true)), "c");
	assertEquals(
		pickActiveHeading([{ id: "a", top: -900 }, { id: "b", top: 1200 }], at(120, true)),
		"a",
	);
});

Deno.test("no headings, no current", () => {
	assertEquals(pickActiveHeading([], at(120, true)), null);
});

Deno.test("the reading line sits just below the landing position, bounded", () => {
	assertEquals(readingLineFor(92, 800), 172);
	assertEquals(readingLineFor(92, 120), 116, "never less than 24px below");
	assertEquals(readingLineFor(92, 3000), 188, "never more than 96px below");
});
// #endregion

// #region readingRatio
Deno.test("progress runs 0 → 1 across the article's travel and clamps at both ends", () => {
	const g = { height: 3000, viewport: 800, chrome: 68 };
	const travel = 3000 - (800 - 68);
	assertEquals(readingRatio({ ...g, top: 400 }), 0);
	assertEquals(readingRatio({ ...g, top: 68 }), 0);
	assertEquals(readingRatio({ ...g, top: 68 - travel / 2 }), 0.5);
	assertEquals(readingRatio({ ...g, top: 68 - travel }), 1);
	assertEquals(readingRatio({ ...g, top: -9000 }), 1);
});

Deno.test("an article that scrolls less than half a viewport needs no bar", () => {
	assertEquals(readingRatio({ top: 0, height: 900, viewport: 800, chrome: 68 }), null);
	assertEquals(readingRatio({ top: 0, height: 1200, viewport: 800, chrome: 68 }) !== null, true);
});
// #endregion

// #region TOC helpers
const tree: TocEntry[] = [
	{
		id: "a",
		text: "A",
		level: 2,
		number: "1",
		children: [{ id: "a-1", text: "A one", level: 3, number: "1.1", children: [] }],
	},
	{ id: "b", text: "B", level: 2, children: [] },
];

Deno.test("tocIds walks the tree in document order", () => {
	assertEquals(tocIds(tree), ["a", "a-1", "b"]);
});

Deno.test("tocText names an entry anywhere in the tree, with its clause number", () => {
	assertEquals(tocText(tree, "a-1"), "1.1 A one");
	assertEquals(tocText(tree, "b"), "B");
	assertEquals(tocText(tree, "zzz"), null);
	assertEquals(tocText(tree, null), null);
});
// #endregion
