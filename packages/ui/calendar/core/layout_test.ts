/**
 * The placement engine's arithmetic.
 *
 * `core/layout.ts` decides where a card's box goes when several entries claim the same minutes, and
 * it is pure, total and deterministic — epoch milliseconds in, fractions and flags out. That makes it
 * exactly the kind of module this package pins by unit test: once a placement is pixels, a mistake
 * here does not throw and does not look broken. It looks like a calendar with one card silently
 * missing from the day, or with a review drawn as a rival half-column of the workshop it happens
 * inside. Nothing below touches the DOM, a canvas or Preact.
 *
 * The fixtures are hand-built and small, and every threshold test names the pixel it straddles rather
 * than hard-coding a number nobody could re-derive once the constant moves.
 */
import { assert, assertAlmostEquals, assertEquals, assertNotEquals } from "@std/assert";
import {
	allDayEvents,
	type DaySlot,
	DEFAULT_MAX_LANES,
	INSTANT_FOLD_PX,
	MAX_NEST_DEPTH,
	MIN_LANE_PX,
	NEST_HEADER_PX,
	NEST_INSET_FRAC,
	NEST_MIN_H,
	packDayEvents,
} from "./layout.ts";
import type { CalendarEvent } from "./types.ts";

// #region Fixtures
const HOUR = 3_600_000;
/** 2026-07-13T00:00Z — a Monday, so an offset below reads as the wall clock its name claims. */
const DAY = Date.UTC(2026, 6, 13);
/** A comfortable zoom: one hour is 48px, so every nest in these fixtures has room to be a nest. */
const PPH = 48;

/** Local wall clock → epoch ms, kept exact (a fractional hour would not land on a whole millisecond). */
function at(hour: number, minute = 0): number {
	return DAY + hour * HOUR + minute * 60_000;
}

function ev(
	id: string,
	start: number,
	end: number,
	part: Partial<CalendarEvent> = {},
): CalendarEvent {
	return { id, title: `Event ${id}`, kind: "sync", start, end, ...part };
}

/**
 * The slot for one event id.
 *
 * It throws rather than returning undefined because "the engine dropped it" is the one failure this
 * whole module exists to prevent, and a test that quietly read `undefined.mode` would report the
 * wrong thing.
 */
function slot(slots: DaySlot[], id: string): DaySlot {
	const found = slots.find((s) => s.event.id === id);
	if (!found) throw new Error(`packDayEvents dropped "${id}" — nothing may leave the day's data`);
	return found;
}

/**
 * The invariants that must hold for EVERY slot of EVERY fixture, whatever the placement resolved to.
 *
 * A band that escapes its column is a card drawn over the next day; `drawn` disagreeing with `folded`
 * is a card the paint pass and the accessible layer no longer agree about.
 */
function assertBandInvariants(slots: DaySlot[]): void {
	for (const s of slots) {
		const id = s.event.id;
		assert(s.insetStart >= 0, `${id}: band starts before the column (${s.insetStart})`);
		assert(s.insetWidth > 0, `${id}: band has no width (${s.insetWidth})`);
		assert(
			s.insetStart + s.insetWidth <= 1 + 1e-9,
			`${id}: band runs past the column (${s.insetStart} + ${s.insetWidth})`,
		);
		assertEquals(s.drawn, s.mode !== "folded", `${id}: drawn and mode disagree`);
		assertEquals(s.stackSize, s.clusterSize, `${id}: the cluster has two sizes`);
		assert(s.nestDepth <= MAX_NEST_DEPTH, `${id}: nested past the cap (${s.nestDepth})`);
	}
}
// #endregion

// #region Solo cards and the cluster sweep
Deno.test("packDayEvents — events that do not overlap are each a cluster of one at the full band", () => {
	const slots = packDayEvents([
		ev("a", at(9), at(10)),
		ev("b", at(10, 30), at(11, 30)),
		ev("c", at(12), at(13)),
	], { pxPerHour: PPH });
	assertEquals(slots.length, 3);
	for (const s of slots) {
		assertEquals(s.mode, "solo");
		assertEquals(s.insetStart, 0);
		assertEquals(s.insetWidth, 1);
		assertEquals(s.clusterSize, 1);
		assertEquals(s.stackDepth, 0);
		assertEquals(s.foldedCount, 0);
		assertEquals(s.childCount, 0);
		assertEquals(s.nestDepth, 0);
		assertEquals(s.parentId, null);
		assertEquals(s.drawn, true);
	}
	// Three clusters, not one — a cluster is a collision, and there is none here.
	assertEquals(new Set(slots.map((s) => s.clusterId)).size, 3);
});

Deno.test("packDayEvents — back-to-back is NOT concurrent: the sweep's comparison is strict", () => {
	// 09:00–10:00 then 10:00–11:00 share an instant of the clock and no minutes at all. Clustering them
	// would fold the second under the first and lose an hour of the day to a `+1` chip.
	const slots = packDayEvents([ev("a", at(9), at(10)), ev("b", at(10), at(11))], {
		pxPerHour: PPH,
	});
	assertEquals(slots.map((s) => s.clusterId), ["a", "b"]);
	assertEquals(slots.map((s) => s.clusterSize), [1, 1]);
	assertEquals(slots.map((s) => s.drawn), [true, true]);
});

Deno.test("packDayEvents — input order is irrelevant: a container is resolved before what it contains", () => {
	// Supplied child-first. The sort is start ascending then end DESCENDING precisely so the ancestor
	// stack can be built in one pass, and a caller handing events over unsorted must not defeat it.
	// `merge: false`, because the resting default collapses the pair to one card and re-roots both —
	// which would hide the very parentage this test exists to check.
	const slots = packDayEvents([ev("b", at(10), at(11)), ev("a", at(9), at(12))], {
		pxPerHour: PPH,
		merge: false,
	});
	assertEquals(slots.map((s) => s.event.id), ["a", "b"]);
	assertEquals(slot(slots, "b").parentId, "a");
});
// #endregion

// #region Straddles: the resting grid carries no horizontal offsets
Deno.test("packDayEvents — a plain straddle FOLDS at rest rather than splitting the column", () => {
	// Neither contains the other, so containment cannot express the overlap — but a straddle is not the
	// stated fallback either. The earlier card keeps the whole band and says there is one more.
	const slots = packDayEvents([ev("a", at(9), at(11)), ev("b", at(10), at(12))], {
		pxPerHour: PPH,
	});
	const a = slot(slots, "a");
	const b = slot(slots, "b");
	assertEquals(a.mode, "solo");
	assertEquals(a.drawn, true);
	assertEquals(a.insetStart, 0);
	assertEquals(a.insetWidth, 1);
	assertEquals(a.foldedCount, 1);
	assertEquals(b.mode, "folded");
	assertEquals(b.drawn, false);
	assertEquals(b.foldedCount, 0);
	assertEquals(a.clusterId, b.clusterId);
	assertEquals(a.clusterSize, 2);
	// Folded, but still in the day's data — the accessible layer is built from this list.
	assertEquals(slots.length, 2);
	assertBandInvariants(slots);
});

Deno.test("packDayEvents — a CONTAINED pair merges at rest, exactly as a straddle does", () => {
	// The resting contract is about OVERLAP, not about the relationship between two overlapping things.
	// Before the merge default, this pair drew two cards (nested) while a straddle drew one — two
	// different answers to "these collide", which is one too many for a reader to hold.
	const slots = packDayEvents([ev("a", at(9), at(12)), ev("b", at(10), at(11))], {
		pxPerHour: PPH,
	});
	assertEquals(slot(slots, "a").drawn, true);
	assertEquals(slot(slots, "b").drawn, false);
	assertEquals(slot(slots, "a").foldedCount, 1);
	// The survivor is a MERGED card, not a container: it claims the whole column and no nest band.
	assertEquals(slot(slots, "a").insetWidth, 1);
	assertEquals(slot(slots, "a").childCount, 0);
	// A merged card keeps its own text — it is standing in for everything underneath it.
	assertEquals(slot(slots, "a").bare, false);
	assertBandInvariants(slots);
});

Deno.test("packDayEvents — `+N` counts every entry the reader cannot see, contents included", () => {
	// One rival, and one child of the survivor. Both are hidden by the merge, so both are counted:
	// the chip and the list popover that opens with it must describe the same set, or the number is
	// promising something the list does not deliver.
	const slots = packDayEvents([
		ev("a", at(9), at(13)),
		ev("kid", at(10), at(11)), // properly inside the survivor
		ev("rival", at(12), at(14)), // straddles it
	], { pxPerHour: PPH });
	assertEquals(slots.filter((x) => x.drawn).length, 1);
	assertEquals(slot(slots, "a").foldedCount, 2);
	assertEquals(slot(slots, "a").clusterSize, 3);
	// NOTHING IS DROPPED — every member is still addressable by the accessible layer.
	assertEquals(slots.length, 3);
});

Deno.test("packDayEvents — back-to-back entries are not a cluster, so nothing merges", () => {
	// 09:00–10:00 then 10:00–11:00. They touch; they do not overlap. Merging them would collapse a
	// perfectly readable day into one card and hide an event behind a chip for no reason at all.
	const slots = packDayEvents([ev("a", at(9), at(10)), ev("b", at(10), at(11))], {
		pxPerHour: PPH,
	});
	assertEquals(slots.map((x) => x.drawn), [true, true]);
	assertEquals(slots.map((x) => x.foldedCount), [0, 0]);
	assertEquals(slots.map((x) => x.insetWidth), [1, 1]);
	assertEquals(slots.map((x) => x.bare), [false, false]);
});

Deno.test("packDayEvents — `merge: false` restores the pre-2026-08-22 resting layout", () => {
	const events = [ev("a", at(9), at(12)), ev("b", at(10), at(11))];
	assertEquals(slot(packDayEvents(events, { pxPerHour: PPH }), "b").drawn, false);
	const placed = packDayEvents(events, { pxPerHour: PPH, merge: false });
	assertEquals(slot(placed, "b").drawn, true);
	assertEquals(slot(placed, "b").mode, "nested");
});

Deno.test("packDayEvents — `bare` is set only on an EXPANDED cluster of more than one", () => {
	// A lone card has nothing to be separated from, so stripping its text would cost a reader the only
	// thing on it and buy nothing.
	const solo = packDayEvents([ev("a", at(9), at(10))], {
		pxPerHour: PPH,
		unfolded: new Set(["a"]),
	});
	assertEquals(solo[0].bare, false);

	const events = [ev("a", at(9), at(11)), ev("b", at(10), at(12))];
	const rest = packDayEvents(events, { pxPerHour: PPH });
	assertEquals(rest.map((x) => x.bare), [false, false]);
	const open = packDayEvents(events, { pxPerHour: PPH, unfolded: new Set([rest[0].clusterId]) });
	assertEquals(open.map((x) => x.bare), [true, true]);
	// And a bare card is still DRAWN and still in the list — `bare` is presentation, never reach.
	assertEquals(open.map((x) => x.drawn), [true, true]);
});

Deno.test("packDayEvents — an UNFOLDED straddle splits into disjoint lanes that fill the column exactly", () => {
	const events = [ev("a", at(9), at(11)), ev("b", at(10), at(12))];
	const rest = packDayEvents(events, { pxPerHour: PPH });
	const open = packDayEvents(events, {
		pxPerHour: PPH,
		unfolded: new Set([rest[0].clusterId]),
	});
	const a = slot(open, "a");
	const b = slot(open, "b");
	assertEquals(a.mode, "split");
	assertEquals(b.mode, "split");
	assert(a.drawn && b.drawn);
	assertEquals([a.insetStart, a.insetWidth], [0, 0.5]);
	assertEquals([b.insetStart, b.insetWidth], [0.5, 0.5]);
	// Disjoint and exactly the column: two halves, no gap and no overlap.
	assertEquals(a.insetStart + a.insetWidth, b.insetStart);
	assertEquals(b.insetStart + b.insetWidth, 1);
	assertEquals(a.foldedCount, 0);
	assertBandInvariants(open);
});

Deno.test("packDayEvents — lanes are REUSED once a card has ended, so three cards need only two", () => {
	// 09:00–10:30, 10:00–11:30, 11:00–12:30. The third starts after the first has finished, so the
	// greedy colouring gives it the first's lane back instead of minting a third sliver.
	const events = [
		ev("a", at(9), at(10, 30)),
		ev("b", at(10), at(11, 30)),
		ev("c", at(11), at(12, 30)),
	];
	const open = packDayEvents(events, { pxPerHour: PPH, unfolded: new Set(["a"]) });
	assertEquals(open.map((s) => s.insetWidth), [0.5, 0.5, 0.5]);
	assertEquals(slot(open, "a").insetStart, 0);
	assertEquals(slot(open, "b").insetStart, 0.5);
	assertEquals(slot(open, "c").insetStart, 0);
	assertBandInvariants(open);
});

Deno.test("packDayEvents — a whole crowd folds under ONE card, and the chip counts all of it", () => {
	const events = [
		ev("a", at(9), at(11)),
		ev("b", at(9, 30), at(11, 30)),
		ev("c", at(10), at(12)),
		ev("d", at(10, 30), at(12, 30)),
		ev("e", at(11), at(13)),
	];
	const slots = packDayEvents(events, { pxPerHour: PPH });
	// Five slivers nobody can read is strictly worse than one card that says there are five.
	assertEquals(slots.filter((s) => s.drawn).length, 1);
	assertEquals(slot(slots, "a").foldedCount, 4);
	// NOTHING IS DROPPED: every one of them is still addressable.
	assertEquals(slots.length, events.length);
	assertEquals(slots.map((s) => s.clusterSize), [5, 5, 5, 5, 5]);
	assertBandInvariants(slots);
});

Deno.test("packDayEvents — folding a group hides the RIVALS, and everything they contained with them", () => {
	const slots = packDayEvents([
		ev("a", at(9), at(12)),
		ev("c", at(10), at(11)), // properly inside "a" — the survivor's own contents
		ev("b", at(11), at(14)), // straddles "a" — a rival root
		ev("d", at(12), at(13)), // properly inside "b" — hidden with its parent
	], { pxPerHour: PPH, merge: false });
	assertEquals(slot(slots, "a").drawn, true);
	assertEquals(slot(slots, "c").drawn, true);
	assertEquals(slot(slots, "c").mode, "nested");
	assertEquals(slot(slots, "b").drawn, false);
	assertEquals(slot(slots, "d").drawn, false);
	// The chip counts the rival AND what the rival was carrying — two cards genuinely went away.
	assertEquals(slot(slots, "a").foldedCount, 2);
	// "contains N" is a clause about what is DRAWN inside a card, so a folded child is not counted.
	assertEquals(slot(slots, "a").childCount, 1);
	assertEquals(slot(slots, "b").childCount, 0);
	// A folded card claims no placement at all: it is not drawn inside anything.
	assertEquals(slot(slots, "d").nestDepth, 0);
	assertEquals(slot(slots, "d").parentId, null);
	assertBandInvariants(slots);
});
// #endregion

/*
 * #region Containment
 *
 * EVERY TEST BELOW PASSES `merge: false`, and that is a statement about where the containment engine
 * now runs rather than a convenience.
 *
 * Since the 2026-08-22 interaction pass the RESTING grid merges every overlap cluster to one card
 * (`PackOptions.merge`, default `true`), so nesting, demotion and the lane caps are no longer what a
 * reader sees at rest — they are what the ENGINE still resolves, and what `merge: false` restores
 * wholesale. Keeping the coverage on the mode that exercises them is the only way these invariants
 * stay pinned; asserting them against the default would be asserting the merge, which the
 * "#region Folding" tests above already do.
 */
Deno.test("packDayEvents — proper containment NESTS the child inside its parent at nearly full width", () => {
	const slots = packDayEvents([ev("a", at(9), at(12)), ev("b", at(10), at(11))], {
		pxPerHour: PPH,
		merge: false,
	});
	const a = slot(slots, "a");
	const b = slot(slots, "b");
	assertEquals(a.mode, "solo");
	assertEquals(a.childCount, 1);
	assertEquals(a.foldedCount, 0);
	assertEquals(a.insetWidth, 1);
	assertEquals(b.mode, "nested");
	assertEquals(b.nestDepth, 1);
	assertEquals(b.parentId, "a");
	assertEquals(b.drawn, true);
	// Inset by NEST_INSET_FRAC of the band on EACH side — enough that the parent reads as a container,
	// little enough that the child is still a full-width card rather than a sibling shoved sideways.
	assertAlmostEquals(b.insetStart, NEST_INSET_FRAC);
	assertAlmostEquals(b.insetWidth, 1 - NEST_INSET_FRAC * 2);
	assert(b.insetStart > a.insetStart, "the child must sit strictly inside its parent's band");
	assert(b.insetStart + b.insetWidth < a.insetStart + a.insetWidth);
	assertBandInvariants(slots);
});

Deno.test("packDayEvents — IDENTICAL extents do not nest, because neither properly contains the other", () => {
	const events = [ev("a", at(9), at(11)), ev("b", at(9), at(11))];
	const rest = packDayEvents(events, { pxPerHour: PPH });
	// Containment is strict on at least one side, so this pair is the case `split` exists for. At rest
	// it still stacks — a straddle only earns lanes once the reader asks.
	assertEquals(slot(rest, "a").mode, "solo");
	assertEquals(slot(rest, "a").childCount, 0);
	assertEquals(slot(rest, "a").foldedCount, 1);
	assertEquals(slot(rest, "b").mode, "folded");

	const open = packDayEvents(events, { pxPerHour: PPH, unfolded: new Set([rest[0].clusterId]) });
	assertEquals(slot(open, "a").mode, "split");
	assertEquals(slot(open, "b").mode, "split");
	assertEquals(slot(open, "b").nestDepth, 0);
	assertEquals(slot(open, "b").parentId, null);
	assertEquals(slot(open, "b").insetStart, 0.5);
});

Deno.test("packDayEvents — rivals INSIDE a parent resolve within the parent's band, never the column", () => {
	// Two children properly contained by one parent, colliding with each other. Their contest is over
	// the parent's inset band; the column itself is not up for negotiation, and the parent keeps it.
	const events = [
		ev("parent", at(9), at(14)),
		ev("kid1", at(10), at(12)),
		ev("kid2", at(11), at(13)),
	];
	const rest = packDayEvents(events, { pxPerHour: PPH, merge: false });
	assertEquals(slot(rest, "parent").insetWidth, 1);
	assertEquals(slot(rest, "parent").childCount, 1);
	assertEquals(slot(rest, "parent").foldedCount, 0);
	// The `+N` belongs to the card that actually survived the contest, one level down.
	assertEquals(slot(rest, "kid1").foldedCount, 1);
	assertEquals(slot(rest, "kid1").drawn, true);
	assertEquals(slot(rest, "kid1").nestDepth, 1);
	assertEquals(slot(rest, "kid1").parentId, "parent");
	assertAlmostEquals(slot(rest, "kid1").insetStart, NEST_INSET_FRAC);
	assertAlmostEquals(slot(rest, "kid1").insetWidth, 1 - NEST_INSET_FRAC * 2);
	assertEquals(slot(rest, "kid2").mode, "folded");
	/*
	 * `kid1.mode` is deliberately not asserted. The engine reports `solo` for the survivor of a folded
	 * group without asking whether it has a parent, so this card claims `solo` while carrying
	 * `parentId: "parent"`, `nestDepth: 1` and a nested inset band — which the module's own vocabulary
	 * ("`solo` — no collision it has to yield to. Full band.") says it is not. Every fact a painter
	 * needs is in the geometry above and is pinned; the label is the contradiction, and it is reported
	 * rather than blessed here.
	 */
	assertBandInvariants(rest);

	/*
	 * EXPANDED, THE CLUSTER IS FLAT — containment is discarded and all three take equal lanes.
	 *
	 * This reverses the pre-2026-08-22 expanded layout, where the two children took lanes INSIDE the
	 * parent's band and the parent kept the full column. The reason is a measurement rather than a
	 * preference: `NEST_INSET_FRAC` is 0.06, so a nested child covers 88% of its parent and leaves it
	 * visible as two strips of 6% each — about 7px in a 120px column. An expanded member is drawn
	 * BARE (no title, no glyph), and a 7px strip of plain colour is not something a reader can
	 * identify or reliably point at; it is below the pointer-target floor on its own.
	 *
	 * The expansion exists precisely so every member is individually visible and individually
	 * reachable, and lanes are the only layout that delivers both. Containment still resolves the
	 * cluster at rest and under `merge: false` — it is not discarded, it is deferred.
	 */
	const open = packDayEvents(events, { pxPerHour: PPH, unfolded: new Set(["parent"]) });
	assertEquals(open.filter((s) => s.drawn).length, 3);
	assertEquals(open.map((s) => s.mode), ["split", "split", "split"]);
	assertEquals(open.map((s) => s.parentId), [null, null, null]);
	assertEquals(open.map((s) => s.nestDepth), [0, 0, 0]);
	// Three equal lanes across the WHOLE column, in start order.
	for (const id of ["parent", "kid1", "kid2"]) assertAlmostEquals(slot(open, id).insetWidth, 1 / 3);
	assertAlmostEquals(slot(open, "parent").insetStart, 0);
	assertAlmostEquals(slot(open, "kid1").insetStart, 1 / 3);
	assertAlmostEquals(slot(open, "kid2").insetStart, 2 / 3);
	// And every one of them is a plain colour block: the names are in the list popover that opened
	// with the expansion, where each has a full line rather than a third of a lane.
	assertEquals(open.map((s) => s.bare), [true, true, true]);
	assertBandInvariants(open);
});

Deno.test("packDayEvents — containment stops at MAX_NEST_DEPTH and the overflow becomes a sibling", () => {
	// Five concentric spans. The fifth would be depth 4, so it is pushed out to sit beside the fourth
	// inside the third — deeper than the cap stops being read as containment and starts being noise.
	const slots = packDayEvents([
		ev("a", at(8), at(20)),
		ev("b", at(9), at(19)),
		ev("c", at(10), at(18)),
		ev("d", at(11), at(17)),
		ev("e", at(12), at(16)),
	], { pxPerHour: PPH, merge: false });
	assertEquals(slot(slots, "a").nestDepth, 0);
	assertEquals(slot(slots, "b").nestDepth, 1);
	assertEquals(slot(slots, "c").nestDepth, 2);
	assertEquals(slot(slots, "d").nestDepth, MAX_NEST_DEPTH);
	assertEquals(slot(slots, "e").nestDepth, MAX_NEST_DEPTH);
	assertEquals(slot(slots, "e").parentId, "c");
	assertEquals(slot(slots, "c").childCount, 2);
	assertEquals(slot(slots, "d").childCount, 0);
	assertEquals(slots.filter((s) => s.drawn).length, 5);
	assertBandInvariants(slots);
});
// #endregion

// #region The pixel fallbacks
Deno.test("packDayEvents — a nest with no room for the parent's title is DEMOTED to a side-by-side pair", () => {
	const events = [ev("a", at(9), at(12)), ev("b", at(10), at(11))];
	// The child starts one hour below the parent, so the headroom in pixels IS the zoom. The two calls
	// differ only in `pxPerHour`, on either side of NEST_HEADER_PX.
	const roomy = packDayEvents(events, { pxPerHour: NEST_HEADER_PX, merge: false });
	const tight = packDayEvents(events, { pxPerHour: NEST_HEADER_PX - 1, merge: false });

	assertEquals(slot(roomy, "b").mode, "nested");
	assertEquals(slot(roomy, "b").parentId, "a");
	assertEquals(slot(roomy, "a").insetWidth, 1);

	// The demotion is the design's ONE stated fallback, and it is a statement about a PAIR: the former
	// parent gives up width too, or it would claim a full band the child is now standing in.
	assertEquals(slot(tight, "b").mode, "split");
	assertEquals(slot(tight, "b").parentId, null);
	assertEquals(slot(tight, "b").nestDepth, 0);
	assertEquals(slot(tight, "a").mode, "split");
	assertEquals([slot(tight, "a").insetStart, slot(tight, "a").insetWidth], [0, 0.5]);
	assertEquals([slot(tight, "b").insetStart, slot(tight, "b").insetWidth], [0.5, 0.5]);
	assert(slot(tight, "a").drawn && slot(tight, "b").drawn);
});

Deno.test("packDayEvents — a nested child too SHORT to carry a line of its own is demoted as well", () => {
	const parent = ev("a", at(9), at(12));
	// Both children start a full hour below the parent, so the headroom test passes either way and only
	// the child's own height moves: 15 minutes is 12px at this zoom, 30 minutes is 24px.
	assert(15 / 60 * PPH < NEST_MIN_H && 30 / 60 * PPH >= NEST_MIN_H, "fixture straddles NEST_MIN_H");
	const opts = { pxPerHour: PPH, merge: false };
	const short = packDayEvents([parent, ev("b", at(10), at(10, 15))], opts);
	const tall = packDayEvents([parent, ev("b", at(10), at(10, 30))], opts);
	assertEquals(slot(tall, "b").mode, "nested");
	assertEquals(slot(short, "b").mode, "split");
	assertEquals(slot(short, "b").parentId, null);
});

Deno.test("packDayEvents — lanes too NARROW to read fold instead, and a measured column decides how narrow", () => {
	const events = [ev("a", at(9), at(12)), ev("b", at(10), at(11))];
	// The nest is demoted at this zoom, so the pair MAY split — legibility is the only thing left to
	// overrule it, and it needs a measured column to have an opinion at all.
	const demoting = { pxPerHour: NEST_HEADER_PX - 1, merge: false };

	const wide = packDayEvents(events, { ...demoting, columnWidth: MIN_LANE_PX * 3 });
	assertEquals(slot(wide, "a").mode, "split");
	assertEquals(slot(wide, "b").drawn, true);

	const narrow = packDayEvents(events, { ...demoting, columnWidth: MIN_LANE_PX + 1 });
	assertEquals(slot(narrow, "a").mode, "solo");
	assertEquals(slot(narrow, "a").insetWidth, 1);
	assertEquals(slot(narrow, "a").foldedCount, 1);
	assertEquals(slot(narrow, "b").drawn, false);

	// An explicit unfold overrules even that: the reader asked to see them, and refusing on their
	// behalf because the result is cramped is deciding for them twice.
	const open = packDayEvents(events, {
		...demoting,
		columnWidth: MIN_LANE_PX + 1,
		unfolded: new Set(["a"]),
	});
	assert(slot(open, "a").drawn && slot(open, "b").drawn);
	assertEquals(slot(open, "b").mode, "split");
});

Deno.test("packDayEvents — with no measured column the lane count is capped at DEFAULT_MAX_LANES", () => {
	// One parent whose three would-be children all start too close beneath it to nest, so all three are
	// demoted to its siblings: four lanes, one more than an unmeasured column will allow.
	const events = [
		ev("p", at(9), at(15)),
		ev("c", at(9, 10), at(14)),
		ev("r1", at(9, 20), at(14, 30)),
		ev("r2", at(9, 30), at(14, 45)),
	];
	const capped = packDayEvents(events, { pxPerHour: PPH, merge: false });
	assertEquals(DEFAULT_MAX_LANES, 3);
	assertEquals(capped.filter((s) => s.drawn).length, 1);
	assertEquals(slot(capped, "p").mode, "solo");
	assertEquals(slot(capped, "p").foldedCount, 3);

	// Measure a column wide enough for four readable lanes and the same day splits instead.
	const measured = packDayEvents(events, {
		pxPerHour: PPH,
		columnWidth: MIN_LANE_PX * 4,
		merge: false,
	});
	assertEquals(measured.filter((s) => s.drawn).length, 4);
	assertEquals(measured.map((s) => s.insetWidth), [0.25, 0.25, 0.25, 0.25]);
	assertEquals(measured.map((s) => s.insetStart), [0, 0.25, 0.5, 0.75]);
	assertBandInvariants(measured);
});
// #endregion

// #region Instants
Deno.test("packDayEvents — a point in time survives layout as an instant rather than being filtered out", () => {
	const slots = packDayEvents([ev("d", at(14), at(14), { kind: "deadline" })], { pxPerHour: PPH });
	assertEquals(slots.length, 1);
	assertEquals(slots[0].instant, true);
	assertEquals(slots[0].mode, "solo");
	assertEquals(slots[0].drawn, true);
	assertEquals(slots[0].insetStart, 0);
	assertEquals(slots[0].insetWidth, 1);
});

Deno.test("packDayEvents — a deadline inside a meeting nests, and takes no width from it", () => {
	const slots = packDayEvents([
		ev("a", at(9), at(12)),
		ev("d", at(10), at(10), { kind: "deadline" }),
	], { pxPerHour: PPH });
	const d = slot(slots, "d");
	assertEquals(d.instant, true);
	assertEquals(d.mode, "nested");
	assertEquals(d.nestDepth, 1);
	assertEquals(d.parentId, "a");
	// A pin is a mark ACROSS the band, so it spans the whole of it and its container keeps the column.
	assertAlmostEquals(d.insetStart, NEST_INSET_FRAC);
	assertAlmostEquals(d.insetWidth, 1 - NEST_INSET_FRAC * 2);
	assertEquals(slot(slots, "a").insetWidth, 1);
	assertEquals(slot(slots, "a").childCount, 1);
	assertBandInvariants(slots);
});

Deno.test("packDayEvents — instants a pixel row apart fold into one pin; instants apart both draw", () => {
	// A host span is what puts two deadlines in the same cluster at all — a zero-length entry cannot
	// extend a cluster past its own instant.
	const host = ev("a", at(9), at(12));
	assert(
		5 / 60 * PPH < INSTANT_FOLD_PX && 30 / 60 * PPH >= INSTANT_FOLD_PX,
		"fixture straddles INSTANT_FOLD_PX",
	);
	const near = packDayEvents([
		host,
		ev("p", at(10), at(10), { kind: "deadline" }),
		ev("q", at(10, 5), at(10, 5), { kind: "deadline" }),
	], { pxPerHour: PPH });
	assertEquals(slot(near, "p").drawn, true);
	assertEquals(slot(near, "p").mode, "nested");
	assertEquals(slot(near, "p").foldedCount, 1);
	assertEquals(slot(near, "q").mode, "folded");
	assertEquals(slot(near, "q").drawn, false);
	// Folded, never dropped — and the survivor is the earlier of the two.
	assertEquals(near.length, 3);
	assertEquals(slot(near, "a").childCount, 1);

	const apart = packDayEvents([
		host,
		ev("p", at(10), at(10), { kind: "deadline" }),
		ev("q", at(10, 30), at(10, 30), { kind: "deadline" }),
	], { pxPerHour: PPH });
	assert(slot(apart, "p").drawn && slot(apart, "q").drawn);
	assertEquals(slot(apart, "p").foldedCount, 0);
	assertEquals(slot(apart, "a").childCount, 2);
});

Deno.test("packDayEvents — an unfolded cluster stops crowding instants together, however close", () => {
	const events = [
		ev("a", at(9), at(12)),
		ev("p", at(10), at(10), { kind: "deadline" }),
		ev("q", at(10, 5), at(10, 5), { kind: "deadline" }),
	];
	const open = packDayEvents(events, { pxPerHour: PPH, unfolded: new Set(["a"]) });
	assert(slot(open, "p").drawn && slot(open, "q").drawn);
	assertEquals(slot(open, "p").foldedCount, 0);
});

Deno.test("packDayEvents — an all-day row and an inverted range are not laid out on the time axis", () => {
	const slots = packDayEvents([
		ev("a", at(9), at(10)),
		ev("all", DAY, DAY + 24 * HOUR, { allDay: true }),
		// end < start is not a point in time, it is a broken range, and there is no honest box for it.
		ev("bad", at(15), at(14)),
	], { pxPerHour: PPH });
	assertEquals(slots.map((s) => s.event.id), ["a"]);
});
// #endregion

// #region Cluster identity and completeness
Deno.test("packDayEvents — a clusterId is day-scoped and minted from the cluster's earliest member", () => {
	const a = ev("a", at(9), at(11));
	const b = ev("b", at(10), at(12));
	assertEquals(packDayEvents([a])[0].clusterId, "a");
	assertEquals(packDayEvents([a], { dayStart: DAY })[0].clusterId, `${DAY}:a`);
	// A card clipped at midnight becomes one card per day, and a cluster id that was not day-scoped
	// would name both halves the same thing.
	assertNotEquals(
		packDayEvents([a], { dayStart: DAY })[0].clusterId,
		packDayEvents([a], { dayStart: DAY + 24 * HOUR })[0].clusterId,
	);
	// A LATER member joining must not rename a cluster the reader may already have unfolded.
	assertEquals(packDayEvents([a, b], { dayStart: DAY }).map((s) => s.clusterId), [
		`${DAY}:a`,
		`${DAY}:a`,
	]);
});

Deno.test("packDayEvents — a cluster's members are emitted contiguously, stackDepth restarting at 0", () => {
	const slots = packDayEvents([
		ev("a", at(9), at(11)),
		ev("b", at(10), at(12)),
		ev("c", at(14), at(15)),
		ev("d", at(14, 30), at(15, 30)),
	], { pxPerHour: PPH });
	assertEquals(slots.map((s) => s.event.id), ["a", "b", "c", "d"]);
	assertEquals(slots.map((s) => s.clusterId), ["a", "a", "c", "c"]);
	assertEquals(slots.map((s) => s.stackDepth), [0, 1, 0, 1]);
	assertEquals(slots.map((s) => s.clusterSize), [2, 2, 2, 2]);
	assertBandInvariants(slots);
});

Deno.test("packDayEvents — nothing is dropped and no band escapes the column, at any zoom or fold state", () => {
	/*
	 * A deliberately nasty day: a five-deep concentric chain, a straddle across its tail, two deadlines
	 * a couple of minutes apart, and one child short enough to be demoted at every zoom. The zooms sit
	 * either side of both pixel thresholds, and each is packed at rest AND fully unfolded, so the fold,
	 * split, nest and demote paths are all exercised over the same corpus.
	 */
	const events = [
		ev("a", at(8), at(20)),
		ev("b", at(9), at(19)),
		ev("c", at(10), at(18)),
		ev("d", at(11), at(17)),
		ev("e", at(12), at(16)),
		ev("f", at(15), at(21)),
		ev("g", at(11, 10), at(11, 20)),
		ev("p", at(15, 5), at(15, 5), { kind: "deadline" }),
		ev("q", at(15, 7), at(15, 7), { kind: "deadline" }),
	];
	for (const pxPerHour of [8, 25, 26, 48, 200]) {
		for (const columnWidth of [undefined, 60, 100, 320, 900]) {
			const rest = packDayEvents(events, { pxPerHour, columnWidth });
			assertEquals(rest.length, events.length, `dropped a card at ${pxPerHour}px/h`);
			assertBandInvariants(rest);
			const open = packDayEvents(events, {
				pxPerHour,
				columnWidth,
				unfolded: new Set(rest.map((s) => s.clusterId)),
			});
			assertEquals(open.length, events.length, `dropped a card unfolded at ${pxPerHour}px/h`);
			assertBandInvariants(open);
			// Unfolding may never hide something that was visible while the cluster was folded.
			assert(
				open.filter((s) => s.drawn).length >= rest.filter((s) => s.drawn).length,
				`unfolding lost a card at ${pxPerHour}px/h`,
			);
		}
	}
});

Deno.test("packDayEvents — with no zoom supplied, containment is decided on time alone", () => {
	// The vertical-room tests are the only thing a pixel is needed for, so a caller with no zoom gets
	// the pure-time answer rather than an arbitrary one: a one-minute child still nests.
	const slots = packDayEvents([ev("a", at(9), at(12)), ev("b", at(10), at(10, 1))], {
		merge: false,
	});
	assertEquals(slot(slots, "b").mode, "nested");
	assertEquals(slot(slots, "b").parentId, "a");
});

Deno.test("packDayEvents — an empty day is an empty list, not a throw", () => {
	assertEquals(packDayEvents([]), []);
	assertEquals(packDayEvents([], { pxPerHour: PPH, columnWidth: 100 }), []);
});
// #endregion

// #region All-day lane
Deno.test("allDayEvents — keeps only the all-day rows, ordered by start and then by end", () => {
	const rows = allDayEvents([
		ev("late", DAY + 24 * HOUR, DAY + 48 * HOUR, { allDay: true }),
		ev("timed", at(9), at(10)),
		ev("longer", DAY, DAY + 72 * HOUR, { allDay: true }),
		ev("short", DAY, DAY + 24 * HOUR, { allDay: true }),
	]);
	// Same start, so the SHORTER span leads — the all-day lane stacks, and ordering by end keeps a
	// multi-day bar from being drawn over the single-day rows that share its first morning.
	assertEquals(rows.map((r) => r.id), ["short", "longer", "late"]);
});
// #endregion
