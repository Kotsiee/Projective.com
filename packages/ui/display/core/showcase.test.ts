import { assertEquals } from "@std/assert";
import {
	addPositions,
	emptyPositions,
	legalMove,
	moveSlots,
	nextMoveTarget,
	reorderedPositions,
	type ShowcaseGridSlot,
} from "./showcase.ts";

const slot = (position: number, kind: "image" | "video" = "image"): ShowcaseGridSlot => ({
	position,
	kind,
	thumb: `t${position}`,
	alt: `a${position}`,
});

// #region legalMove
Deno.test("moving an image onto another filled slot is legal", () => {
	const slots = [slot(1), slot(2), slot(3)];
	assertEquals(legalMove(slots, 3, 1), { ok: true });
	assertEquals(legalMove(slots, 1, 2), { ok: true });
});

Deno.test("a video dropped on slot 1 is refused", () => {
	const slots = [slot(1), slot(2, "video"), slot(3)];
	assertEquals(legalMove(slots, 2, 1), { ok: false, reason: "video-cover" });
});

Deno.test("moving the cover away is refused when a video would slide into slot 1", () => {
	const slots = [slot(1), slot(2, "video"), slot(3)];
	assertEquals(legalMove(slots, 1, 3), { ok: false, reason: "video-cover" });
	assertEquals(legalMove([slot(1), slot(2), slot(3, "video")], 1, 3), { ok: true });
});

Deno.test("a video may move among slots 2–6", () => {
	const slots = [slot(1), slot(2, "video"), slot(4), slot(6, "video")];
	assertEquals(legalMove(slots, 2, 6), { ok: true });
	assertEquals(legalMove(slots, 6, 4), { ok: true });
});

Deno.test("empty, identical and out-of-range moves are refused", () => {
	const slots = [slot(1), slot(3)];
	assertEquals(legalMove(slots, 1, 2), { ok: false, reason: "empty" });
	assertEquals(legalMove(slots, 2, 3), { ok: false, reason: "empty" });
	assertEquals(legalMove(slots, 3, 3), { ok: false, reason: "same" });
	assertEquals(legalMove(slots, 0, 3), { ok: false, reason: "out-of-range" });
	assertEquals(legalMove(slots, 3, 7), { ok: false, reason: "out-of-range" });
});

Deno.test("without a filled slot 1 there is no cover to protect", () => {
	const slots = [slot(2, "video"), slot(3)];
	assertEquals(legalMove(slots, 3, 2), { ok: true });
});
// #endregion

// #region Reorder payload
Deno.test("a move re-inserts the item at the target's index; gaps stay gaps", () => {
	const slots = [slot(1), slot(3), slot(4), slot(6)];
	assertEquals(reorderedPositions(slots, 6, 1), [6, 1, 3, 4]);
	assertEquals(reorderedPositions(slots, 1, 4), [3, 4, 1, 6]);
	const moved = moveSlots(slots, 6, 1);
	assertEquals(moved.map((s) => [s.position, s.thumb]), [[1, "t6"], [3, "t1"], [4, "t3"], [
		6,
		"t4",
	]]);
});

Deno.test("an add fills the pressed slot first, then every other empty slot", () => {
	const slots = [slot(1), slot(4)];
	assertEquals(emptyPositions(slots), [2, 3, 5, 6]);
	assertEquals(addPositions(slots, 5), [5, 2, 3, 6]);
});
// #endregion

// #region Keyboard target
Deno.test("the lifted target steps through filled slots only and stops at the ends", () => {
	const filled = [1, 3, 4, 6];
	assertEquals(nextMoveTarget(filled, 3, "ArrowRight"), 4);
	assertEquals(nextMoveTarget(filled, 3, "ArrowLeft"), 1);
	assertEquals(nextMoveTarget(filled, 1, "ArrowUp"), 1);
	assertEquals(nextMoveTarget(filled, 6, "ArrowDown"), 6);
	assertEquals(nextMoveTarget(filled, 4, "Home"), 1);
	assertEquals(nextMoveTarget(filled, 3, "End"), 6);
	assertEquals(nextMoveTarget(filled, 3, "Enter"), null);
});
// #endregion
