import { assert, assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import {
	assertBalancedSplit,
	boundaryAt,
	dragHandleTo,
	formatSplitPercent,
	handleLabel,
	handleRange,
	handleValueText,
	keyToSplit,
	nudgeHandle,
	setHandle,
	SPLIT_TOTAL_BP,
	type SplitSegment,
	splitTotal,
} from "./split-bar-model.ts";

/**
 * The split model is the only place `SplitBar` decides what a share becomes, so the invariant is
 * protected here rather than in a pointer handler: every output is integer basis points summing to
 * exactly 10 000, a handle only ever trades between its two neighbours, held segments never move, and
 * floors hold.
 */

// #region Fixtures
const seg = (key: string, bp: number, extra: Partial<SplitSegment> = {}): SplitSegment => ({
	key,
	label: key.toUpperCase(),
	bp,
	...extra,
});

const three = (): SplitSegment[] => [seg("a", 4250), seg("b", 4000), seg("c", 1750)];

/** A deterministic PRNG (mulberry32) so a failing random run reproduces. */
function rng(seed: number): () => number {
	let t = seed >>> 0;
	return () => {
		t = (t + 0x6d2b79f5) >>> 0;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}
// #endregion

// #region Invariant
Deno.test("sum stays exactly 10 000 over 10k random drags, nudges and keys", () => {
	const rand = rng(0x5b17);
	let split: readonly SplitSegment[] = [
		seg("a", 2000),
		seg("b", 2000, { min: 500 }),
		seg("c", 1500, { held: true }),
		seg("d", 2500),
		seg("e", 2000, { min: 1000 }),
	];
	const keys = [
		"ArrowLeft",
		"ArrowRight",
		"ArrowUp",
		"ArrowDown",
		"PageUp",
		"PageDown",
		"Home",
		"End",
	];
	for (let n = 0; n < 10_000; n++) {
		const index = Math.floor(rand() * (split.length - 1));
		const roll = rand();
		if (roll < 0.5) {
			split = dragHandleTo(split, index, rand() * 12_000 - 1_000);
		} else if (roll < 0.75) {
			split = nudgeHandle(split, index, Math.round(rand() * 6_000 - 3_000));
		} else {
			const key = keys[Math.floor(rand() * keys.length)];
			split = keyToSplit(split, index, { key, shiftKey: rand() < 0.3, rtl: rand() < 0.2 }) ?? split;
		}
		assertEquals(splitTotal(split), SPLIT_TOTAL_BP);
		for (const s of split) assert(Number.isInteger(s.bp) && s.bp >= (s.min ?? 0));
		assertEquals(split[2].bp, 1500, "held segment moved");
	}
});

Deno.test("assertBalancedSplit rejects drift, fractions and negatives", () => {
	assertBalancedSplit(three());
	assertThrows(() => assertBalancedSplit([seg("a", 5000), seg("b", 4999)]));
	assertThrows(() => assertBalancedSplit([seg("a", 5000.5), seg("b", 4999.5)]));
	assertThrows(() => assertBalancedSplit([seg("a", 10_100), seg("b", -100)]));
	assertThrows(() => assertBalancedSplit([]));
});

Deno.test("an unbalanced input (server drift) locks every handle rather than compounding it", () => {
	const drifted = [seg("a", 5000), seg("b", 4000)];
	assert(handleRange(drifted, 0).locked);
	assertStrictEquals(nudgeHandle(drifted, 0, 100), drifted);
});
// #endregion

// #region Neighbour-only moves
Deno.test("a handle trades only between its two neighbours", () => {
	const out = setHandle(three(), 0, 5000);
	assertEquals(out.map((s) => s.bp), [5000, 3250, 1750]);
	const out2 = setHandle(three(), 1, 1000);
	assertEquals(out2.map((s) => s.bp), [4250, 1000, 4750]);
});

Deno.test("dragHandleTo places the boundary absolutely and is idempotent", () => {
	const once = dragHandleTo(three(), 1, 9000);
	assertEquals(once.map((s) => s.bp), [4250, 4750, 1000]);
	assertEquals(boundaryAt(once, 1), 9000);
	const twice = dragHandleTo(once, 1, 9000);
	assertStrictEquals(twice, once);
	// Fractional pointer positions round to whole basis points.
	assertEquals(dragHandleTo(three(), 0, 3333.6).map((s) => s.bp), [3334, 4916, 1750]);
});

Deno.test("dragging past the pair clamps at the pair's ends", () => {
	assertEquals(dragHandleTo(three(), 0, -500).map((s) => s.bp), [0, 8250, 1750]);
	assertEquals(dragHandleTo(three(), 0, 99_999).map((s) => s.bp), [8250, 0, 1750]);
});
// #endregion

// #region Held + min
Deno.test("a held neighbour locks the handle on both sides and is never changed", () => {
	const split = [seg("a", 3000), seg("b", 3000, { held: true }), seg("c", 4000)];
	assert(handleRange(split, 0).locked);
	assert(handleRange(split, 1).locked);
	assertStrictEquals(setHandle(split, 0, 100), split);
	assertStrictEquals(dragHandleTo(split, 1, 9000), split);
	assertStrictEquals(keyToSplit(split, 0, { key: "End" }), split);
});

Deno.test("min floors clamp both neighbours", () => {
	const split = [seg("a", 5000, { min: 1000 }), seg("b", 5000, { min: 2500 })];
	const range = handleRange(split, 0);
	assertEquals([range.min, range.max, range.locked], [1000, 7500, false]);
	assertEquals(setHandle(split, 0, 0).map((s) => s.bp), [1000, 9000]);
	assertEquals(setHandle(split, 0, 10_000).map((s) => s.bp), [7500, 2500]);
});

Deno.test("floors that leave no room lock the handle", () => {
	const split = [seg("a", 5000, { min: 5000 }), seg("b", 5000, { min: 5000 })];
	assert(handleRange(split, 0).locked);
});
// #endregion

// #region Keyboard
Deno.test("arrows step 1%, Shift 0.1%, Page 10%, Home/End to the floor/ceiling", () => {
	const k = (key: string, shiftKey = false, rtl = false) =>
		keyToSplit(three(), 0, { key, shiftKey, rtl })?.map((s) => s.bp);
	assertEquals(k("ArrowRight"), [4350, 3900, 1750]);
	assertEquals(k("ArrowUp"), [4350, 3900, 1750]);
	assertEquals(k("ArrowLeft"), [4150, 4100, 1750]);
	assertEquals(k("ArrowDown"), [4150, 4100, 1750]);
	assertEquals(k("ArrowRight", true), [4260, 3990, 1750]);
	assertEquals(k("PageUp"), [5250, 3000, 1750]);
	assertEquals(k("PageDown"), [3250, 5000, 1750]);
	assertEquals(k("Home"), [0, 8250, 1750]);
	assertEquals(k("End"), [8250, 0, 1750]);
	assertEquals(keyToSplit(three(), 0, { key: "Tab" }), null);
});

Deno.test("horizontal arrows follow the reading direction under RTL; vertical ones do not", () => {
	const k = (key: string) => keyToSplit(three(), 0, { key, rtl: true })?.map((s) => s.bp);
	assertEquals(k("ArrowRight"), [4150, 4100, 1750]);
	assertEquals(k("ArrowLeft"), [4350, 3900, 1750]);
	assertEquals(k("ArrowUp"), [4350, 3900, 1750]);
});
// #endregion

// #region Text
Deno.test("value text and label name both neighbours with two-decimal percentages", () => {
	assertEquals(formatSplitPercent(4250), "42.50%");
	assertEquals(formatSplitPercent(1), "0.01%");
	assertEquals(handleValueText(three(), 1), "B 40.00% · C 17.50%");
	assertEquals(handleLabel(three(), 0), "Split between A and B");
	assertEquals(handleValueText(three(), 2), "");
});
// #endregion
