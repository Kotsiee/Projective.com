import { assertEquals } from "jsr:@std/assert@^1";
import { railSlots, visibleRail } from "./media-rail.ts";

/**
 * The media rail's two claims, pinned.
 *
 * They are CLAIMS the interface makes to a reader — "these are all the images", "nothing is cut off"
 * — and the failure mode of getting them wrong is a confident wrong statement rather than a visibly
 * broken layout, which is exactly the kind that survives a look at the screen.
 */

Deno.test("railSlots — N slots fit when N*min + (N-1)*gap does", () => {
	// Five 80px cards with four 8px gaps = 432. One more card would need 520.
	assertEquals(railSlots(432, { min: 80, gap: 8 }), 5);
	assertEquals(railSlots(519, { min: 80, gap: 8 }), 5);
	assertEquals(railSlots(520, { min: 80, gap: 8 }), 6);
});

Deno.test("railSlots — the trailing gap that does not exist never costs a card", () => {
	// Exactly two cards and one gap. Without the `+ gap` term this floors to 1.
	assertEquals(railSlots(168, { min: 80, gap: 8 }), 2);
});

Deno.test("railSlots — never returns 0, so a momentarily zero-width rail is not emptied forever", () => {
	assertEquals(railSlots(0, { min: 80, gap: 8 }), 1);
	assertEquals(railSlots(10, { min: 80, gap: 8 }), 1);
	assertEquals(railSlots(Number.NaN, { min: 80, gap: 8 }), 1);
});

Deno.test("railSlots — an unreadable metric falls back rather than producing nonsense", () => {
	// `NaN` is what the island passes when a CSS length could not be resolved.
	assertEquals(railSlots(432, { min: Number.NaN, gap: Number.NaN }), 5);
	assertEquals(railSlots(432, {}), 5);
});

Deno.test("visibleRail — everything fits: the grid takes the ITEM count, not the slot count", () => {
	// Three images in a five-slot rail must not each be stretched to a fifth of the width.
	assertEquals(visibleRail(3, 5), { slots: 3, realCount: 3, overflow: 0 });
	assertEquals(visibleRail(5, 5), { slots: 5, realCount: 5, overflow: 0 });
});

Deno.test("visibleRail — the +N card counts its OWN image too", () => {
	// 7 images, 5 slots: 4 thumbnails + a card standing in front of the remaining 3.
	assertEquals(visibleRail(7, 5), { slots: 5, realCount: 4, overflow: 3 });
	// The overflow and the rendered cards must always account for every image.
	const plan = visibleRail(7, 5);
	assertEquals(plan.realCount + plan.overflow, 7);
});

Deno.test("visibleRail — a one-slot rail discloses everything behind one card", () => {
	assertEquals(visibleRail(6, 1), { slots: 1, realCount: 0, overflow: 6 });
});

Deno.test("visibleRail — the grid column count is always the slot count when overflowing", () => {
	// This is what makes a partial card unrepresentable: cards divide the rail, never truncate it.
	for (let total = 1; total <= 12; total++) {
		for (let slots = 1; slots <= 8; slots++) {
			const plan = visibleRail(total, slots);
			const rendered = plan.realCount + (plan.overflow > 0 ? 1 : 0);
			assertEquals(
				rendered,
				plan.slots,
				`total=${total} slots=${slots}: ${rendered} cards in ${plan.slots} columns`,
			);
			assertEquals(plan.realCount + plan.overflow, total);
		}
	}
});
