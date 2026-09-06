import { assertEquals } from "@std/assert";
import { fitViewNav, type ViewNavGeometry } from "./viewnav-fit.ts";

/**
 * The geometry MEASURED in a browser on `/projects/{id}/board` at a 280px lane: a 252px footer
 * content box, an 8px row gap, a 2px link gap, and 32px icon squares for the collapse toggle, each of
 * the five view links, and the kebab. Every case below is that geometry with one dimension moved, so
 * a failure names the dimension rather than a number nobody can place.
 */
const MEASURED: ViewNavGeometry = {
	containerW: 252,
	btn: [32, 32, 32, 32, 32],
	gapLinks: 2,
	gapRow: 8,
	collapse: 32,
	kebab: 32,
};

const at = (containerW: number, over: Partial<ViewNavGeometry> = {}) =>
	fitViewNav({ ...MEASURED, containerW, ...over });

Deno.test("a lane with room for every link renders no kebab at all", () => {
	// The whole point of the fold: the menu is not a fixture of the row. 5*32 + 4*2 = 168 of links,
	// plus 32 + 8 for the toggle and 2 of slack, is 210 — and the measured lane offers 252.
	assertEquals(fitViewNav(MEASURED), { visible: 5, folded: 0 });
	assertEquals(at(210), { visible: 5, folded: 0 }, "exactly enough is still enough");
});

Deno.test("links fold from the rightmost inward as the lane narrows", () => {
	assertEquals(at(209).visible, 3, "one pixel short of the whole row");
	assertEquals(at(176).visible, 3);
	assertEquals(at(175).visible, 2);
	assertEquals(at(142).visible, 2);
	assertEquals(at(141).visible, 1);
	assertEquals(at(108).visible, 1);
	assertEquals(at(107).visible, 0, "below one link the row is the toggle and the kebab");
});

Deno.test("the count skips four, because a kebab costs exactly one link's slot", () => {
	// Not a rounding artefact and not worth 'fixing': four links PLUS the kebab is five slots, the
	// same five slots the whole row needs. So the width that cannot hold the fifth link cannot hold
	// four-plus-a-kebab either, and the honest next step down is three.
	const counts = new Set<number>();
	for (let w = 0; w <= 400; w++) counts.add(at(w).visible);
	assertEquals([...counts].sort((a, b) => a - b), [0, 1, 2, 3, 5]);
});

Deno.test("folded and visible always account for every link", () => {
	for (let w = 0; w <= 320; w++) {
		const f = at(w);
		assertEquals(f.visible + f.folded, MEASURED.btn.length, `width ${w}`);
	}
});

Deno.test("the fold is monotone in width, so widening never hides a link", () => {
	let previous = 0;
	for (let w = 0; w <= 400; w++) {
		const { visible } = at(w);
		if (visible < previous) throw new Error(`width ${w} showed ${visible} after ${previous}`);
		previous = visible;
	}
});

Deno.test("a width is worth the same on the way back up as on the way down", () => {
	// The fit reads only the geometry it is handed, so a lane dragged narrow and back must land on
	// exactly the arrangement it started from — the restore half of the requirement, not just the fold.
	const widths = [252, 200, 160, 120, 80, 120, 160, 200, 252];
	assertEquals(widths.map((w) => at(w).visible), [5, 3, 2, 1, 0, 1, 2, 3, 5]);
});

Deno.test("the kebab is never reserved against a row that would not render one", () => {
	// 176px is the exact width of five links plus the toggle, gap and slack. Reserving a kebab here
	// would fold the fifth link away to make room for the button whose only job is to hold it.
	assertEquals(at(210), { visible: 5, folded: 0 });
	// One pixel less and the reserve is real, because the menu is genuinely going to be drawn.
	assertEquals(at(209).folded, 2);
});

Deno.test("the collapse toggle is subtracted, and never folds", () => {
	// Whatever the width, the fit only ever reports links — the toggle is not one of them, so a lane
	// too narrow for anything still leaves the control that gets it back.
	assertEquals(at(20).visible, 0);
	// Removing the toggle hands its 32px and the 8px row gap straight back to the links: 170px is
	// 168 of links plus the slack, so without the toggle the whole row fits and with it only two do.
	assertEquals(at(170).visible, 2);
	assertEquals(at(170, { collapse: 0 }), { visible: 5, folded: 0 });
});

Deno.test("a hidden or zero-width footer folds everything and never slices past the ends", () => {
	for (const w of [0, -1, -500]) {
		assertEquals(at(w), { visible: 0, folded: 5 }, `width ${w}`);
	}
});

Deno.test("a session engagement drops Submissions, so four links fit where five did not", () => {
	// 4*32 + 3*2 = 134, plus the 42 of chrome, is 176.
	const session = { btn: [32, 32, 32, 32] };
	assertEquals(at(176, session), { visible: 4, folded: 0 });
	assertEquals(at(175, session).visible, 2);
});

Deno.test("wider links are measured individually, not assumed uniform", () => {
	// Nothing in the row promises equal widths — a labelled control would be wider. The fit must stop
	// at the first link that does not clear the room, not at a count derived from an average.
	const mixed = { btn: [32, 96, 32, 32, 32] };
	// 210 of room: 32 + 2 + 96 + 2 + 32 + 2 + 32 = 198 fits, the fifth link's 34 does not. So the
	// kebab is reserved and the row re-fitted into 176: the fourth link no longer clears it either.
	assertEquals(at(252, mixed).visible, 3);
	assertEquals(at(120, mixed).visible, 1, "the 96px link alone no longer clears the room");
});
