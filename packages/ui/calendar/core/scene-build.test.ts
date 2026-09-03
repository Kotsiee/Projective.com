/**
 * The pure-canvas viewport's geometry.
 *
 * These are worth testing for the same reason the colour parser is: once an event card is pixels, an
 * arithmetic mistake does not throw and does not look broken — it looks like a calendar, drawn one
 * column or fifteen minutes out. Nothing here touches the DOM, a canvas, or Preact.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import type { GridScene, SceneEvent } from "./grid-paint.ts";
import { columnGeometry } from "./grid-paint.ts";
import {
	buildSceneEvents,
	edgeHoldVelocity,
	EVENT_GAP_INLINE,
	eventAccessibleName,
	eventRect,
	GAUGE_MIN,
	gaugeGeometry,
	type HitMetrics,
	hitTest,
	inRect,
	type SceneColumnSpec,
	scrollbarHitRect,
	scrollbarRect,
	selectionRange,
	snapMinutes,
} from "./scene-build.ts";
import type { CalendarEvent } from "./types.ts";

const TZ = "UTC";
const PPH = 48;
/** 2026-07-13T00:00Z — a Monday, so the week block starts where the fixtures expect. */
const MONDAY = Date.UTC(2026, 6, 13);
const HOUR = 3_600_000;

function ev(
	part: Partial<CalendarEvent> & { id: string; start: number; end: number },
): CalendarEvent {
	return { title: `Event ${part.id}`, kind: "sync", ...part };
}

/** A week's worth of column specs whose day-00:00 all sit at content y = `top`. */
function week(top = 0): SceneColumnSpec[] {
	return Array.from({ length: 7 }, (_, i) => ({
		column: i,
		dayStart: MONDAY + i * 24 * HOUR,
		top,
	}));
}

// #region Layout
Deno.test("buildSceneEvents — an event lands in its own day's column at its own hour", () => {
	const cards = buildSceneEvents(
		week(),
		[ev({
			id: "a",
			start: MONDAY + 2 * 24 * HOUR + 9 * HOUR,
			end: MONDAY + 2 * 24 * HOUR + 10 * HOUR,
		})],
		{ pxPerHour: PPH, tz: TZ, hour12: false },
	);
	assertEquals(cards.length, 1);
	assertEquals(cards[0].column, 2);
	assertEquals(cards[0].y, 9 * PPH);
	assertEquals(cards[0].h, PPH);
});

Deno.test("buildSceneEvents — a midnight-crossing event becomes one card per day, clipped at the seam", () => {
	// 23:00 Monday → 01:00 Tuesday. Two cards, neither of which may run past its own day.
	const cards = buildSceneEvents(
		week(),
		[ev({ id: "a", start: MONDAY + 23 * HOUR, end: MONDAY + 25 * HOUR })],
		{ pxPerHour: PPH, tz: TZ, hour12: false },
	);
	assertEquals(cards.length, 2);
	assertEquals(cards.map((c) => c.column), [0, 1]);
	// The Monday card starts at 23:00 and stops at midnight; the Tuesday card starts at 00:00.
	assertEquals(cards[0].y, 23 * PPH);
	assertEquals(cards[0].h, PPH);
	assertEquals(cards[1].y, 0);
	assertEquals(cards[1].h, PPH);
	// Both name the SAME source event, but they are two different cards — focus and hover key off the
	// card, so a shared id would make one of them unreachable.
	assertEquals(cards[0].eventId, cards[1].eventId);
	assert(cards[0].id !== cards[1].id);
});

Deno.test("buildSceneEvents — concurrent events form a STACK rather than side-by-side slivers", () => {
	const day = MONDAY;
	const cards = buildSceneEvents(
		week(),
		[
			ev({ id: "a", start: day + 9 * HOUR, end: day + 11 * HOUR }),
			ev({ id: "b", start: day + 10 * HOUR, end: day + 12 * HOUR }),
		],
		{ pxPerHour: PPH, tz: TZ, hour12: false },
	);
	assertEquals(cards.length, 2);
	assertEquals(cards.map((c) => c.clusterSize), [2, 2]);
	// Sorted by start, so "a" (09:00) is the one actually DRAWN, ahead of "b" (10:00) folded under it.
	assertEquals(cards.map((c) => c.drawn), [true, false]);
	// Both are still in the scene whether or not they are drawn — the accessible layer is built from
	// this list, and a card nobody can see must still be a card everybody can reach.
	assertEquals(cards.map((c) => c.eventId), ["a", "b"]);
	// No fractional split left to test — every member of a cluster renders at the SAME full column.
	assertEquals(cards[0].column, cards[1].column);
});

Deno.test("buildSceneEvents — a five-minute event is still tall enough to hit", () => {
	const cards = buildSceneEvents(
		week(),
		[ev({ id: "a", start: MONDAY + 9 * HOUR, end: MONDAY + 9 * HOUR + 5 * 60_000 })],
		{ pxPerHour: 8, tz: TZ, hour12: false },
	);
	// 5 minutes at 8 px/hour is 0.67px. The floor is what keeps it clickable at all.
	assert(cards[0].h >= 14, `expected a hit-sized card, got ${cards[0].h}`);
});

Deno.test("buildSceneEvents — an all-day event is not laid out on the time axis", () => {
	const cards = buildSceneEvents(
		week(),
		[ev({ id: "a", allDay: true, start: MONDAY, end: MONDAY + 24 * HOUR })],
		{ pxPerHour: PPH, tz: TZ, hour12: false },
	);
	assertEquals(cards.length, 0);
});

Deno.test("buildSceneEvents — a NON-CONTIGUOUS column set still lays every column out", () => {
	/*
	 * The accessible layer holds a focused card's block in the layout window even after the reader has
	 * paged away from it, so the columns handed over can have a GAP. The bucketing walk finds each
	 * event's first column by bisection and stops at the first day that starts after it — both
	 * monotone in the sorted order, so a gap is fine — but a walk that assumed contiguity would drop
	 * everything past the hole, and a focused card would silently stop being announced.
	 */
	const far = MONDAY + 400 * 24 * HOUR;
	const columns: SceneColumnSpec[] = [
		{ column: 0, dayStart: MONDAY, top: 0 },
		{ column: 1, dayStart: MONDAY + 24 * HOUR, top: 0 },
		{ column: 2, dayStart: far, top: 5000 },
	];
	const cards = buildSceneEvents(
		columns,
		[
			ev({ id: "near", start: MONDAY + 9 * HOUR, end: MONDAY + 10 * HOUR }),
			ev({ id: "far", start: far + 9 * HOUR, end: far + 10 * HOUR }),
		],
		{ pxPerHour: PPH, tz: TZ, hour12: false },
	);
	assertEquals(cards.map((c) => c.eventId).sort(), ["far", "near"]);
	assertEquals(cards.find((c) => c.eventId === "far")?.column, 2);
});

Deno.test("buildSceneEvents — the bucketed walk agrees with a per-column filter, event for event", () => {
	/*
	 * The layout used to filter the whole corpus once per column, which is quadratic in disguise and
	 * re-ran on every scroll delta. This pins the REWRITE to the behaviour it replaced: same cards,
	 * same columns, same order, over a deliberately scrambled corpus with midnight crossings, an
	 * all-day row and an event entirely outside the window.
	 */
	const columns = week();
	const events = [
		ev({ id: "e0", start: MONDAY + 23 * HOUR, end: MONDAY + 26 * HOUR }),
		ev({ id: "e1", allDay: true, start: MONDAY, end: MONDAY + 24 * HOUR }),
		ev({ id: "e2", start: MONDAY - 5 * HOUR, end: MONDAY - 1 * HOUR }),
		ev({ id: "e3", start: MONDAY + 4 * 24 * HOUR, end: MONDAY + 4 * 24 * HOUR + HOUR }),
		ev({ id: "e4", start: MONDAY + 9 * HOUR, end: MONDAY + 11 * HOUR }),
		ev({ id: "e5", start: MONDAY + 10 * HOUR, end: MONDAY + 12 * HOUR }),
		ev({ id: "e6", start: MONDAY + 6 * 24 * HOUR, end: MONDAY + 8 * 24 * HOUR }),
	];
	const naive = columns.flatMap((spec) =>
		buildSceneEvents(
			[spec],
			events.filter((e) =>
				!e.allDay && e.start < spec.dayStart + 24 * HOUR && e.end > spec.dayStart
			),
			{ pxPerHour: PPH, tz: TZ, hour12: false },
		)
	);
	const actual = buildSceneEvents(columns, events, { pxPerHour: PPH, tz: TZ, hour12: false });
	assertEquals(
		actual.map((c) => `${c.id}@${c.column}:${c.y}:${c.nestDepth}/${c.clusterSize}`),
		naive.map(
			(c) => `${c.id}@${c.column}:${c.y}:${c.nestDepth}/${c.clusterSize}`,
		),
	);
	assert(actual.length > 0);
});
// #endregion

// #region Privacy
Deno.test("buildSceneEvents — a masked card leaks its title, kind and location through NO channel", () => {
	const build = (kind: CalendarEvent["kind"]) =>
		buildSceneEvents(
			week(),
			[
				ev({
					id: "a",
					kind,
					masked: true,
					status: "busy",
					title: "Oncology appointment",
					location: "St Thomas'",
					start: MONDAY + 9 * HOUR,
					end: MONDAY + 10 * HOUR,
				}),
			],
			{ pxPerHour: PPH, tz: TZ, hour12: false },
		)[0];
	const deadline = build("deadline");
	const general = build("general");
	assertEquals(deadline.title, "Busy");
	assertEquals(deadline.location, "");
	assertEquals(deadline.kindLabel, "Busy");
	// The glyph is a channel too (its own separate assertion would need a Path2D-capable harness), but
	// the ACCENT is the one this pass made status-driven: a masked card's fill must come from its
	// STATUS alone, so a deadline and a general event masked the same way must be indistinguishable —
	// proving the real kind cannot leak through the fill either.
	assertEquals(deadline.accent, general.accent);
	// 2026-08-22 palette pass: the value is the BUSY group rather than the old `--danger`. A masked
	// entry is never something the reader can act on, so an alarm colour on a block that says only
	// "Busy" asks for an attention it cannot repay — and red now means "deadline" on this grid, which
	// is the one thing a masked card must not be able to imply about itself.
	assertEquals(deadline.accent, "--cal-ev-busy");
	// And the same holds for the one sentence it announces — including the doubled mask word a naive
	// "kind: title" would produce, where both halves are the same privacy-safe label.
	assertEquals(eventAccessibleName(deadline, "Mon, Jul 13"), "Busy, 09:00 – 10:00, Mon, Jul 13");
});

Deno.test("buildSceneEvents — a masked card carries no provenance count either", () => {
	const card = buildSceneEvents(
		week(),
		[
			ev({
				id: "a",
				masked: true,
				status: "busy",
				title: "Oncology appointment",
				sources: ["google", "outlook", "internal"],
				start: MONDAY + 9 * HOUR,
				end: MONDAY + 10 * HOUR,
			}),
		],
		{ pxPerHour: PPH, tz: TZ, hour12: false },
	)[0];
	// §Part 1.4 allows a masked block ONE fact. Which of somebody's calendars a private appointment
	// lives on is not that fact, and `/[handle]/availability` is reachable by a stranger.
	assertEquals(card.sources, 0);
	assertEquals(eventAccessibleName(card, "Mon, Jul 13").includes("calendars"), false);
});

Deno.test("eventAccessibleName — announces how many calendars an occurrence is synced to", () => {
	const [one, many] = buildSceneEvents(
		week(),
		[
			ev({
				id: "one",
				title: "Solo",
				sources: ["google"],
				start: MONDAY + 9 * HOUR,
				end: MONDAY + 10 * HOUR,
			}),
			ev({
				id: "many",
				title: "Synced",
				sources: ["google", "outlook", "apple"],
				start: MONDAY + 24 * HOUR + 9 * HOUR,
				end: MONDAY + 24 * HOUR + 10 * HOUR,
			}),
		],
		{ pxPerHour: PPH, tz: TZ, hour12: false },
	);
	// One calendar is where every event lives, so saying so tells the listener nothing. Two or more is
	// the fact — "this is already synced" — and it is the same threshold the DOM card uses.
	assertEquals(one.sources, 1);
	assertEquals(eventAccessibleName(one, "Mon, Jul 13").includes("calendars"), false);
	assertEquals(many.sources, 3);
	assert(eventAccessibleName(many, "Tue, Jul 14").includes("on 3 calendars"));
});

Deno.test("eventAccessibleName — leads with the kind, because hue cannot be read aloud", () => {
	const card = buildSceneEvents(
		week(),
		[
			ev({
				id: "a",
				kind: "deadline",
				title: "Brand guidelines",
				start: MONDAY + 9 * HOUR,
				end: MONDAY + 10 * HOUR,
			}),
		],
		{ pxPerHour: PPH, tz: TZ, hour12: false },
	)[0];
	assertEquals(
		eventAccessibleName(card, "Mon, Jul 13"),
		"Deadline: Brand guidelines, 09:00 – 10:00, Mon, Jul 13",
	);
});
// #endregion

// #region Hit testing
const METRICS: HitMetrics = {
	draftGrab: 10,
	draftInsetStart: 2,
	draftInsetEnd: 3,
	barWidth: 10,
	barInset: 4,
	barHit: 24,
	pillW: 80,
	pillH: 32,
	pillInset: 16,
	badgeMinW: 26,
	badgeH: 16,
};
const BOX = { width: 756, height: 600 };

function sceneWith(events: SceneEvent[], extra: Partial<GridScene> = {}): GridScene {
	return {
		scrollTop: 0,
		columns: 7,
		gutter: 56,
		rules: [],
		bands: [],
		blackouts: [],
		events,
		...extra,
	};
}

Deno.test("hitTest — a click inside a card resolves to that card, and one pixel outside does not", () => {
	const cards = buildSceneEvents(
		week(),
		[ev({ id: "a", start: MONDAY + 9 * HOUR, end: MONDAY + 10 * HOUR })],
		{ pxPerHour: PPH, tz: TZ, hour12: false },
	);
	const scene = sceneWith(cards);
	const geo = columnGeometry(scene, BOX.width);
	const rect = eventRect(cards[0], geo, 0);
	// `colW` is (756 − 56) / 7 = 100, so the card runs x 56…153 (the inter-card gutter is the last
	// three), y 432…480.
	assertEquals(geo.colW, 100);
	assertEquals(rect.w, 100 - EVENT_GAP_INLINE);
	const hit = hitTest(scene, BOX, METRICS, rect.x + 5, rect.y + 5);
	assertEquals(hit.kind, "event");
	assert(hit.kind === "event" && hit.event.id === cards[0].id);

	const miss = hitTest(scene, BOX, METRICS, rect.x + 5, rect.y - 2);
	assertEquals(miss.kind, "grid");
});

Deno.test("hitTest — a stacked cluster resolves to its PRIMARY card; the rest are not pointer targets", () => {
	/*
	 * Side-by-side fractional columns are gone (2026-08-20): two overlapping events now form a STACK
	 * at the SAME full-width rect, and only the one that is `drawn` is ever painted or hit — see
	 * `core/layout.ts`. `eventRect` still resolves what is painted and what is hit from one function,
	 * so the two cannot come apart.
	 */
	const cards = buildSceneEvents(
		week(),
		[
			ev({ id: "left", start: MONDAY + 9 * HOUR, end: MONDAY + 11 * HOUR }),
			ev({ id: "right", start: MONDAY + 10 * HOUR, end: MONDAY + 12 * HOUR }),
		],
		{ pxPerHour: PPH, tz: TZ, hour12: false },
	);
	const scene = sceneWith(cards);
	const geo = columnGeometry(scene, BOX.width);
	const primary = cards.find((c) => c.drawn);
	assert(primary);
	const rect = eventRect(primary, geo, 0);
	const hit = hitTest(scene, BOX, METRICS, rect.x + 5, rect.y + 5);
	assert(hit.kind === "event" && hit.event.id === primary.id);
});

Deno.test("hitTest — a gauge the canvas has faded out is not grabbable", () => {
	/*
	 * A pointer device fades the gauge back in by hovering it; a finger gets no such warning, so an
	 * invisible handle would be a live 10px grab strip down the trailing edge that a reader can only
	 * find by pressing something they cannot see.
	 */
	const visible = sceneWith([], {
		scrollbar: { progress: 0, frozen: null, opacity: 1, active: false, lever: null },
	});
	assertEquals(hitTest(visible, BOX, METRICS, 747, 20).kind, "scrollbar");
	const faded = sceneWith([], {
		scrollbar: { progress: 0, frozen: null, opacity: 0, active: false, lever: null },
	});
	assertEquals(hitTest(faded, BOX, METRICS, 747, 20).kind, "grid");
});

Deno.test("scrollbarHitRect — the TARGET meets the 24px floor while the drawing stays a thin gauge", () => {
	const scene = sceneWith([], {
		scrollbar: { progress: 0, frozen: null, opacity: 1, active: false, lever: null },
	});
	const drawn = scrollbarRect(scene, BOX, METRICS);
	const target = scrollbarHitRect(scene, BOX, METRICS);
	assert(drawn && target);
	// WCAG 2.2 SC 2.5.8 is 24×24. The gauge is drawn 10 wide because a 24px one is a scrollbar rather
	// than a depth mark — so the target is widened INWARD and the two share a trailing edge.
	assertEquals(drawn.w, METRICS.barWidth);
	assertEquals(target.w, METRICS.barHit);
	assert(target.w >= 24 && target.h >= 24);
	assertEquals(target.x + target.w, drawn.x + drawn.w);
	assertEquals(target.y, drawn.y);
});

Deno.test("hitTest — of two fully-overlapping events, the earliest (first on a tie) is the PRIMARY", () => {
	const cards = buildSceneEvents(
		week(),
		[
			ev({ id: "under", start: MONDAY + 9 * HOUR, end: MONDAY + 11 * HOUR }),
			ev({ id: "over", start: MONDAY + 9 * HOUR, end: MONDAY + 11 * HOUR }),
		],
		{ pxPerHour: PPH, tz: TZ, hour12: false },
	);
	// A tied start/end resolves by encounter order (`packDayEvents`'s sort is stable) — "under" is
	// listed first, so it is the PRIMARY the stack actually draws and the click resolves to.
	const scene = sceneWith(cards);
	const hit = hitTest(scene, BOX, METRICS, 60, 9 * PPH + 5);
	assert(hit.kind === "event" && hit.event.eventId === "under");
});

Deno.test("hitTest — the pill and the gauge are hit BEFORE any card, because they are drawn over it", () => {
	const cards = buildSceneEvents(
		week(),
		// A card that covers the whole day, so it lies under both pieces of chrome.
		[ev({ id: "a", start: MONDAY, end: MONDAY + 24 * HOUR })],
		{ pxPerHour: 25, tz: TZ, hour12: false },
	);
	const scene = sceneWith(cards, {
		present: { direction: "down", text: "Now", hover: false, focused: false },
		scrollbar: { progress: 0, frozen: null, opacity: 1, active: false, lever: null },
	});
	// The pill is centred, 16px off the bottom edge: x 338…418, y 552…584.
	assertEquals(hitTest(scene, BOX, METRICS, 378, 560).kind, "present");
	// The gauge sits at the trailing edge: x 742…752.
	assertEquals(hitTest(scene, BOX, METRICS, 747, 20).kind, "scrollbar");
});

Deno.test("hitTest — the hour scale is not a grid slot, so a click there creates nothing", () => {
	const scene = sceneWith([]);
	assertEquals(hitTest(scene, BOX, METRICS, 20, 100).kind, "gutter");
	const grid = hitTest(scene, BOX, METRICS, 300, 100);
	assert(grid.kind === "grid" && grid.column === 2);
});

Deno.test("hitTest — the scroll offset moves the target with the card, not against it", () => {
	const cards = buildSceneEvents(
		week(),
		[ev({ id: "a", start: MONDAY + 9 * HOUR, end: MONDAY + 10 * HOUR })],
		{ pxPerHour: PPH, tz: TZ, hour12: false },
	);
	const scrolled = sceneWith(cards, { scrollTop: 400 });
	// Content y 432 is canvas y 32 once 400px have scrolled past.
	assertEquals(hitTest(scrolled, BOX, METRICS, 60, 35).kind, "event");
	assertEquals(hitTest(scrolled, BOX, METRICS, 60, 435).kind, "grid");
});

Deno.test("inRect — the edges belong to the rect, so a click on a border is not a miss", () => {
	const r = { x: 10, y: 10, w: 20, h: 20 };
	assert(inRect(r, 10, 10));
	assert(inRect(r, 30, 30));
	assert(!inRect(r, 30.5, 30));
});
// #endregion

// #region The depth gauge
Deno.test("gaugeGeometry — longest at the shallow end, at the floor at the deep end", () => {
	const track = 600;
	assertEquals(gaugeGeometry(0, track).length, 300);
	assertEquals(gaugeGeometry(1, track).length, GAUGE_MIN);
});

Deno.test("gaugeGeometry — the handle touches both ends of its track", () => {
	const track = 600;
	assertEquals(gaugeGeometry(0, track).offset, 0);
	const deep = gaugeGeometry(1, track);
	assertEquals(deep.offset + deep.length, track);
});

Deno.test("gaugeGeometry — a frozen length survives a depth change but never outgrows the track", () => {
	assertEquals(gaugeGeometry(0.9, 600, 200).length, 200);
	assertEquals(gaugeGeometry(0.5, 100, 400).length, 100);
});

Deno.test("gaugeGeometry — an out-of-range progress is clamped, never wrapped", () => {
	assertEquals(gaugeGeometry(-3, 600).offset, 0);
	const past = gaugeGeometry(4, 600);
	assertEquals(past.offset + past.length, 600);
});
// #endregion

// #region Edge-hold continuous scroll + release momentum (§Part 4) — pure, rAF-independent
Deno.test("edgeHoldVelocity — zero inside the track, positive and monotone increasing past it", () => {
	assertEquals(edgeHoldVelocity(0), 0);
	assertEquals(edgeHoldVelocity(-10), 0);
	const near = edgeHoldVelocity(5);
	const far = edgeHoldVelocity(60);
	assert(near > 0, "any overshoot at all must move something, or the drag reads as stuck");
	assert(far > near, "further past the edge must scroll faster, not the same speed throughout");
});

Deno.test("edgeHoldVelocity — saturates at a ceiling rather than climbing without bound", () => {
	const a = edgeHoldVelocity(500);
	const b = edgeHoldVelocity(50_000);
	assertEquals(a, b, "a handle dragged absurdly far off-screen must not scroll absurdly fast");
});

Deno.test("edgeHoldVelocity — QUADRATIC: doubling a small overshoot more than doubles the speed", () => {
	// The near-edge response must stay gentle (an accidental few-pixel overshoot should not already
	// read as a committed fast-scroll) while a clearly-held drag still reaches real speed — a straight
	// line cannot do both, which is the whole reason this is t² rather than t.
	const small = edgeHoldVelocity(10);
	const double = edgeHoldVelocity(20);
	assert(double > small * 2, `expected super-linear growth, got ${small} -> ${double}`);
});

// #endregion

// #region Selection
Deno.test("snapMinutes — rounds to the nearest step in both directions", () => {
	assertEquals(snapMinutes(7, 15), 0);
	assertEquals(snapMinutes(8, 15), 15);
	assertEquals(snapMinutes(-8, 15), -15);
});

Deno.test("selectionRange — a bare click opens the default slot rather than a zero-length event", () => {
	const r = selectionRange(MONDAY, 540, 540, 15);
	assertEquals(r.start, MONDAY + 540 * 60_000);
	assertEquals((r.end - r.start) / 60_000, 60);
});

Deno.test("selectionRange — a drag upward is the same range as the same drag downward", () => {
	const down = selectionRange(MONDAY, 540, 630, 15);
	const up = selectionRange(MONDAY, 630, 540, 15);
	assertEquals(down, up);
	assertEquals((down.end - down.start) / 60_000, 90);
});
// #endregion

// #region Column geometry
Deno.test("columnGeometry — the hour scale is taken off the width before the columns divide it", () => {
	const geo = columnGeometry(sceneWith([]), 756);
	assertEquals(geo.gutter, 56);
	assertEquals(geo.lattice, 700);
	assertEquals(geo.colW, 100);
});

Deno.test("columnGeometry — a canvas narrower than its own gutter yields no negative columns", () => {
	const geo = columnGeometry(sceneWith([]), 20);
	assertEquals(geo.lattice, 0);
	assertAlmostEquals(geo.colW, 0);
});
// #endregion
