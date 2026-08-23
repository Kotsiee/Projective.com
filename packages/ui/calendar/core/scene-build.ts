/**
 * @projective/ui/calendar — turning calendar data into a {@link GridScene}, and turning a pointer
 * back into the thing under it.
 *
 * This is the half of the pure-canvas viewport that has to be RIGHT rather than merely fast: once a
 * card is pixels, the only thing that can tell a click from a miss is arithmetic, so the arithmetic
 * lives here — with no DOM, no canvas and no Preact — and is unit-tested. The paint routine
 * ({@link paintScene}) and the hit test read the SAME geometry helpers, because a card the reader
 * clicks and the card the canvas drew must be one rectangle; two functions answering "where is
 * column 3" is how a grid ends up looking correct and behaving one column out.
 *
 * Everything here is in CONTENT space (the scrolling axis's own coordinates) except where a name
 * says CANVAS space — the pill and the depth gauge, which are pinned to the viewport and do not
 * scroll.
 */
import type { CalendarAttendee, CalendarEvent } from "./types.ts";
import type {
	ColumnGeometry,
	GridBox,
	GridScene,
	SceneEvent,
	SceneFace,
	SceneRecede,
} from "./grid-paint.ts";
import { columnGeometry } from "./grid-paint.ts";
import { CALENDAR_KIND_PATH, CALENDAR_KIND_SINGULAR, effectiveAccent, maskLabel } from "./kinds.ts";
import { joystickVelocity } from "./chrome.ts";
import { packDayEvents } from "./layout.ts";
import { DAY, fmtRange, MIN, minutesFromDayStart } from "./time.ts";

// #region Constants
/**
 * The shortest a card is ever drawn (px). A 5-minute event at the coarsest zoom is under two pixels
 * tall, which is a mark rather than a target; this is the floor that keeps it clickable, and it is
 * the same floor the DOM cards used.
 */
export const EVENT_MIN_H = 14;
/** Below this height a card has room for its title only — no time line, no location. */
export const EVENT_ROOMY_H = 40;
/**
 * The gutter (px) inset from a column's trailing edge — the DOM card's own `padding-inline-end`,
 * restated once. Subtracted inside {@link eventRect}, which both the paint routine and the hit test
 * call, so the rectangle a reader clicks and the rectangle the canvas drew are one rectangle.
 */
export const EVENT_GAP_INLINE = 3;
/**
 * The gutter (px) taken off a card's BOTTOM edge.
 *
 * The design asks for a strict minimum 1px gap between adjacent cards, and back-to-back events share
 * an edge exactly: a 10:00–11:00 followed by an 11:00–12:00 puts one card's bottom on the next card's
 * top, at which point two rounded fills touch and read as one shape. Taking it inside
 * {@link eventRect} rather than at the draw is what makes the gap unconditional — every path that
 * asks where a card is gets the gap, including the hit test, so the seam is never clickable by both.
 */
export const EVENT_GAP_BLOCK = 1;
/**
 * A pin's pointer target (px) along the scroll axis.
 *
 * An instant is drawn as a rule two pixels thick, and a two-pixel target is not a target. This is the
 * band centred on the moment that a press resolves against — the drawing stays thin, exactly as the
 * depth gauge's drawing stays thin while {@link scrollbarHitRect} widens what is hit.
 */
export const INSTANT_HIT_H = 20;
/** Faces drawn on the avatar stack before it collapses into a `+N` chip (§Part 2, "max 3 visible"). */
export const AVATAR_MAX = 3;
/** Shadow silhouettes drawn behind a stack's primary card, capped regardless of the true depth. */
export const STACK_SHADOW_MAX = 2;
/**
 * Shortest gauge handle (px) along the SCROLL axis.
 *
 * At maximum depth the handle stops shrinking here rather than vanishing. It is not on its own the
 * WCAG 2.2 SC 2.5.8 target floor — that floor is 24×24, and the gauge is drawn ~10px wide — so the
 * cross-axis half is met by {@link scrollbarHitRect}, which widens the TARGET without widening the
 * drawing.
 */
export const GAUGE_MIN = 24;
/**
 * Longest gauge handle, as a fraction of the track. Half a track reads unmistakably as "near the
 * start" while still leaving half the track as travel — a ratio of 1 would fill the track and leave
 * no drag room at the shallow end.
 */
export const GAUGE_MAX_RATIO = 0.5;
// #endregion

// #region Rectangles
/** An axis-aligned box in canvas space, measured from the INLINE start. */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Whether a point falls inside a rect (edges inclusive). */
export function inRect(r: Rect, x: number, y: number): boolean {
	return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
// #endregion

// #region Event layout
/** One day column of the grid: which index it occupies, which day it is, and where its 00:00 sits. */
export interface SceneColumnSpec {
	/** 0-based column index across the whole canvas. */
	column: number;
	/** Local midnight of the day, epoch ms. */
	dayStart: number;
	/** Content-space y (px) of that day's 00:00. */
	top: number;
}

export interface BuildSceneEventsOptions {
	pxPerHour: number;
	/** IANA display timezone — the time labels are drawn through it. */
	tz: string;
	hour12: boolean;
	/**
	 * One column's drawn width (px), so the placement engine can decide whether a side-by-side split
	 * would still be legible or should fold instead. Absent → it falls back to a fixed lane cap.
	 */
	columnWidth?: number;
	/** Clusters the reader has unfolded, by `DaySlot.clusterId` — see `core/layout.ts`. */
	unfolded?: ReadonlySet<string>;
	/**
	 * Collapse every resting overlap cluster to ONE merged card. Defaults to `true` — see
	 * `PackOptions.merge` in `core/layout.ts` for what that supersedes and why.
	 */
	merge?: boolean;
	/** The card id currently expanded on hover, if any. */
	hoverCardId?: string | null;
	/**
	 * How far (px) that card is expanded RIGHT NOW — already resolved by the caller's spring.
	 *
	 * A number rather than a flag, and resolved rather than interpolated here, for the reason every
	 * animated quantity in this engine is: a frozen animation clock must not be able to strand a card
	 * mid-expansion, and the box that is DRAWN and the box that is HIT have to be the same box.
	 */
	hoverExpandPx?: number;
	/**
	 * The card id the reader is pointing at from OUTSIDE the grid — a row in the overlap-list popover.
	 *
	 * Distinct from {@link hoverCardId}, which the grid's own hit test writes and which the pointer
	 * LEAVING the grid clears. Moving the pointer from the grid into a body-portalled panel fires the
	 * viewport's own `pointerleave`, so a single hover channel would collapse the highlight on the
	 * very card the row the reader just reached stands for.
	 *
	 * It is an EVENT id rather than a card id, because the list names events and an event that runs
	 * past midnight is two cards — both of which should light up.
	 */
	highlightEventId?: string | null;
	/**
	 * How far every card that is NOT the subject of the current interaction steps back.
	 *
	 * Absent or `"none"` → nothing recedes. Which of the two depths applies is the CALLER's decision,
	 * because only the caller knows whether the reader is dragging something or looking for something;
	 * how faint each of them is, is the token layer's. See `SceneEvent.recede`.
	 */
	recede?: SceneRecede;
	/**
	 * The card id the reader is currently DRAGGING or RESIZING, if any — held at full strength while
	 * everything else recedes by {@link dim}.
	 */
	activeCardId?: string | null;
}

/**
 * Lay out every timed event that touches one of `columns`.
 *
 * THE WALK IS PER EVENT, NOT PER COLUMN × EVENT. The obvious shape — each column filtering the whole
 * corpus once — is what the DOM day columns did, and it is quadratic in disguise: a three-week window
 * is 21 columns, so a 2,000-event corpus is 42,000 comparisons for every frame, and this function runs
 * on every scroll delta. Instead the column days are sorted once and each event binary-searches the
 * first day it touches, then walks forward while it still does — so the cost is the corpus plus the
 * hits, not their product, and the window can be widened without the frame paying for it.
 *
 * Times are CLIPPED to their own day, exactly as the DOM columns clipped them, so an event that runs
 * past midnight ends at the seam and continues as a second card in the next column rather than
 * drawing over the block below it.
 */
export function buildSceneEvents(
	columns: SceneColumnSpec[],
	events: CalendarEvent[],
	opts: BuildSceneEventsOptions,
): SceneEvent[] {
	const { pxPerHour, tz, hour12 } = opts;
	// Sorted by day so an event can find its first column by bisection. A copy, because the caller's
	// array is the render's own and reordering it under them would be a side effect.
	const specs = columns.slice().sort((a, b) => a.dayStart - b.dayStart);
	const buckets: CalendarEvent[][] = specs.map(() => []);
	for (const e of events) {
		if (e.allDay) continue;
		// The first column whose day has not yet ENDED by the time the event starts. Both this
		// predicate and the loop's are MONOTONE in the sorted order, so the window stays exact even
		// when the caller's columns are not contiguous — which they are not while a focused card is
		// held in the layout from a block the reader has scrolled away from.
		let lo = 0;
		let hi = specs.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (specs[mid].dayStart + DAY <= e.start) lo = mid + 1;
			else hi = mid;
		}
		for (let i = lo; i < specs.length && specs[i].dayStart < e.end; i++) buckets[i].push(e);
	}

	/*
	 * THE ONE SUBJECT OF THE CURRENT INTERACTION, resolved once for the whole pass.
	 *
	 * A drag beats a list hover: the reader can only be doing one of the two, and if both are somehow
	 * live the one they are actively moving is the one they are looking at. Resolving it here rather
	 * than per card is what keeps "exactly one card is highlighted" a property of the scene instead of
	 * a coincidence of the inputs.
	 */
	const activeCardId = opts.activeCardId ?? null;
	// A card id is `${event.id}|${dayStart}` (see `cardId` below), so the event behind the active card
	// is recoverable without a lookup — and recovering it is what lights up BOTH halves of an event
	// that runs past midnight while one of them is being dragged.
	const activeEvent = activeCardId !== null && activeCardId.includes("|")
		? activeCardId.slice(0, activeCardId.lastIndexOf("|"))
		: activeCardId;
	const focusId = activeEvent ?? opts.highlightEventId ?? null;

	const out: SceneEvent[] = [];
	for (let i = 0; i < specs.length; i++) {
		const spec = specs[i];
		const dayEvents = buckets[i];
		if (dayEvents.length === 0) continue;
		const slots = packDayEvents(dayEvents, {
			dayStart: spec.dayStart,
			pxPerHour,
			columnWidth: opts.columnWidth,
			unfolded: opts.unfolded,
			merge: opts.merge,
		});
		for (const slot of slots) {
			const event = slot.event;
			const sMin = Math.max(0, minutesFromDayStart(event.start, spec.dayStart));
			const eMin = Math.min(24 * 60, minutesFromDayStart(event.end, spec.dayStart));
			const y = spec.top + (sMin / 60) * pxPerHour;
			/*
			 * An instant carries NO height. The 12-minute/`EVENT_MIN_H` floor below exists so a five-minute
			 * meeting stays a target rather than a hairline, and applying it to a point in time would
			 * fabricate exactly the span `CalendarEvent.end`'s contract forbids — a deadline drawn as a
			 * plausible twelve-minute meeting. The pin gets its pointer target from {@link eventRect}
			 * instead, which widens a zero-height card into a band without inventing a duration for it.
			 */
			const h = slot.instant
				? 0
				: Math.max(((Math.max(eMin - sMin, 12)) / 60) * pxPerHour, EVENT_MIN_H);
			const cardId = `${event.id}|${spec.dayStart}`;
			const masked = !!event.masked;
			/*
			 * A masked block must not leak its real kind through ANY channel, and the glyph is a
			 * channel. It falls back to the privacy-safe pair — an open slot when the status says
			 * available, otherwise the generic busy mark — exactly as the DOM card does.
			 */
			const shown = masked ? (event.status === "available" ? "availability" : "busy") : event.kind;
			out.push({
				// Keyed by event AND day: an event that runs past midnight is clipped into one card per
				// day, so its id alone would name two cards.
				id: cardId,
				eventId: event.id,
				dayStart: spec.dayStart,
				column: spec.column,
				y,
				h,
				// The placement engine's answer, carried through verbatim. This module resolves WHERE a
				// day's minutes land in pixels; `core/layout.ts` resolves how the day's collisions are
				// arranged. Neither re-derives the other's half.
				clusterId: slot.clusterId,
				clusterSize: slot.clusterSize,
				mode: slot.mode,
				nestDepth: slot.nestDepth,
				parentCardId: slot.parentId === null ? null : `${slot.parentId}|${spec.dayStart}`,
				childCount: slot.childCount,
				foldedCount: slot.foldedCount,
				bare: slot.bare,
				insetStart: slot.insetStart,
				insetWidth: slot.insetWidth,
				drawn: slot.drawn,
				instant: slot.instant,
				// Only the hovered card expands, and only by what the caller's spring has already reached.
				hoverExpandPx: opts.hoverCardId === cardId ? Math.max(0, opts.hoverExpandPx ?? 0) : 0,
				// The two focus channels. `highlighted` is the subject; `dim` recedes everything else, and
				// is resolved to 0 for the subject itself so a painter never has to ask twice.
				highlighted: focusId !== null && event.id === focusId,
				recede: focusId === null || event.id === focusId ? "none" : (opts.recede ?? "none"),
				faces: masked ? [] : facesFor(event.attendeeFaces),
				accent: event.accent ?? effectiveAccent(shown, event.status, masked, event.allDay),
				glyph: CALENDAR_KIND_PATH[shown],
				title: masked ? maskLabel(event.status) : event.title,
				time: event.allDay ? "All day" : fmtRange(event.start, event.end, tz, hour12),
				location: masked ? "" : (event.location ?? ""),
				attendees: masked || typeof event.attendees !== "number"
					? ""
					: `${event.attendees}${typeof event.capacity === "number" ? ` / ${event.capacity}` : ""}`,
				kindLabel: masked ? maskLabel(event.status) : CALENDAR_KIND_SINGULAR[shown],
				masked,
				cancelled: event.status === "cancelled",
				// A masked card draws none of them, for the same reason it draws no kind glyph: which
				// calendars a private appointment lives on is not one of the facts §Part 1.4 allows it,
				// and `/[handle]/availability` is guest-reachable.
				sources: masked ? 0 : (event.sources?.length ?? 0),
			});
		}
	}
	return out;
}

/** Initials from a display name — "Ivy Chen" → "IC", a bare "Ivy" → "I". Never empty for a non-empty name. */
export function initialsOf(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Resolve a card's attendee array into paint-ready {@link SceneFace}s — the host first, then the rest
 *  in the order given, so a reader scanning left-to-right meets the host before the crowd. */
function facesFor(attendees: CalendarAttendee[] | undefined): SceneFace[] {
	if (!attendees || attendees.length === 0) return [];
	return attendees
		.slice()
		.sort((a, b) => Number(!!b.isHost) - Number(!!a.isHost))
		.map((a) => ({
			id: a.id,
			initials: initialsOf(a.name),
			photoUrl: a.avatarUrl,
			isHost: !!a.isHost,
		}));
}

/**
 * The one sentence a card announces.
 *
 * It is assembled HERE, from the same {@link SceneEvent} the canvas paints, so the pixels and the
 * accessible layer cannot describe two different things. It leads with the KIND, because that is
 * exactly the fact hue was carrying and hue does not survive being read aloud; and it names the DAY,
 * which the visual reader gets free from the column header and a listener would otherwise have to
 * infer from position.
 */
export function eventAccessibleName(ev: SceneEvent, dayLabel: string): string {
	// A MASKED card's kind and title are the same privacy-safe word, so prefixing one with the other
	// announces "Available: Available" — a listener hears the mask twice and the time once.
	const lead = ev.kindLabel === ev.title ? ev.title : `${ev.kindLabel}: ${ev.title}`;
	const parts = [lead, ev.time, dayLabel];
	if (ev.location) parts.push(ev.location);
	if (ev.attendees) parts.push(`${ev.attendees} attending`);
	// The stack is a visual shorthand only — a listener gets the fact in words instead, on every
	// member of the cluster (not only the drawn primary), since that is the one the pixels withhold.
	if (ev.clusterSize > 1) {
		parts.push(`overlaps ${ev.clusterSize - 1} other event${ev.clusterSize > 2 ? "s" : ""}`);
	}
	// The provenance channel, in the register a listener can use. It is a COUNT rather than a list of
	// names because the engine holds no provider vocabulary — naming them would mean reading raw slugs
	// aloud — and "on 3 calendars" is the fact the reader is after: that this is already synced. The
	// DOM card says exactly this, from the same threshold.
	if (ev.sources > 1) parts.push(`on ${ev.sources} calendars`);
	if (ev.cancelled) parts.push("cancelled");
	return parts.join(", ");
}

/**
 * The canvas-space rect one laid-out card occupies for a given scroll offset and box.
 *
 * ONE function, called by the paint pass AND by {@link hitTest}, so what is drawn and what is
 * clicked cannot come apart. Three things resolve here rather than at the draw:
 *
 *  - **The placement band.** `insetStart`/`insetWidth` are fractions of ONE column (`0`/`1` for the
 *    overwhelming majority of cards), so a nested child sits inside its parent and a split lane takes
 *    its share, without either of them needing to know the column's pixel width.
 *  - **The inter-card gutter.** {@link EVENT_GAP_INLINE} off the trailing edge, and
 *    {@link EVENT_GAP_BLOCK} off the bottom — the latter is the strict minimum gap the design asks
 *    for between adjacent cards, and taking it here is what guarantees it survives every path.
 *  - **The hover expansion.** Added to the height, so the expanded box is both what is drawn and what
 *    is hit; if the two disagreed the pointer would oscillate on the expansion's own edge.
 *
 * An INSTANT has no height, so it would have no target. It gets {@link INSTANT_HIT_H} centred on its
 * moment instead — a band the reader can actually press, without a duration being invented for the
 * event itself (`ev.h` stays `0`, which is what tells the painter to draw a pin).
 */
export function eventRect(
	ev: SceneEvent,
	geo: Pick<ColumnGeometry, "gutter" | "colW">,
	scrollTop: number,
): Rect {
	const bandX = geo.gutter + (ev.column + ev.insetStart) * geo.colW;
	const bandW = Math.max(0, ev.insetWidth * geo.colW - EVENT_GAP_INLINE);
	const y = ev.y - scrollTop;
	if (ev.instant) return { x: bandX, y: y - INSTANT_HIT_H / 2, w: bandW, h: INSTANT_HIT_H };
	const h = Math.max(0, ev.h + ev.hoverExpandPx - EVENT_GAP_BLOCK);
	return { x: bandX, y, w: bandW, h };
}
// #endregion

// #region Chrome geometry (canvas space — pinned, does not scroll)
/**
 * The gauge handle's rect, or null when the scene carries no scrollbar (or the palette gave it no
 * width, which is how a consumer whose stylesheet lacks the swatch gets no gauge rather than a
 * one-pixel sliver it can never grab).
 */
export function scrollbarRect(
	scene: GridScene,
	box: { width: number; height: number },
	metrics: { barWidth: number; barInset: number },
): Rect | null {
	const bar = scene.scrollbar;
	if (!bar || metrics.barWidth <= 0) return null;
	const track = box.height - metrics.barInset * 2;
	if (track <= 0) return null;
	// The edge-hold overshoot this used to compress and edge-pin against is gone: a rate-based lever
	// measures from its GRAB ORIGIN, so there is no track edge left to overshoot and no signed
	// pressure to react to. The handle is its frozen length at its depth offset, and nothing else.
	const gauge = gaugeGeometry(bar.progress, track, bar.frozen);
	const y = metrics.barInset + gauge.offset;
	return {
		x: box.width - metrics.barInset - metrics.barWidth,
		y,
		w: metrics.barWidth,
		h: gauge.length,
	};
}

/**
 * The gauge's POINTER TARGET — {@link scrollbarRect} widened inward to `metrics.barHit`.
 *
 * The target and the drawing are deliberately different rectangles: WCAG 2.2 SC 2.5.8 asks for 24px
 * across, and a gauge drawn 24px wide is a scrollbar rather than the thin depth mark the design
 * calls for. Widening only what is HIT satisfies the floor without letting it redraw the design.
 *
 * It is geometry alone and says nothing about whether the gauge is currently visible — that gate
 * lives in {@link hitTest}, so a caller who wants the region for a HOVER (which is what fades the
 * gauge back in) can ask for it while a PRESS on an invisible one still misses.
 */
export function scrollbarHitRect(
	scene: GridScene,
	box: { width: number; height: number },
	metrics: { barWidth: number; barInset: number; barHit: number },
): Rect | null {
	const rect = scrollbarRect(scene, box, metrics);
	if (!rect) return null;
	const w = Math.max(rect.w, metrics.barHit);
	return { x: rect.x + rect.w - w, y: rect.y, w, h: rect.h };
}

/**
 * The return-to-present pill's rect, or null when the now-line is in view.
 *
 * Its size comes from the palette rather than from measuring its own text, which is what lets the
 * hit test be a pure function of the scene: a rect derived from `ctx.measureText` could only be
 * known inside the draw, and the click target would then depend on a frame having run.
 */
export function presentRect(
	scene: GridScene,
	box: { width: number; height: number },
	metrics: { pillW: number; pillH: number; pillInset: number },
): Rect | null {
	if (!scene.present) return null;
	return {
		x: (box.width - metrics.pillW) / 2,
		y: box.height - metrics.pillInset - metrics.pillH,
		w: metrics.pillW,
		h: metrics.pillH,
	};
}
// #endregion

// #region Hit testing
/** What sits under a pointer. */
export type SceneHit =
	| { kind: "present" }
	| { kind: "scrollbar"; rect: Rect }
	/** The `+N` chip on a folded cluster's primary card — a press here unfolds the cluster. */
	| { kind: "badge"; event: SceneEvent; rect: Rect }
	| { kind: "event"; event: SceneEvent; rect: Rect }
	/**
	 * The live DRAFT block. `edge` says which grab band the pointer landed in: `"start"` and `"end"`
	 * resize it from that edge, `"body"` moves the whole thing.
	 *
	 * It is hit BEFORE the grid but AFTER the cards, so a draft drawn over a real event does not
	 * swallow the press that opens it — the draft is transient and the event is not.
	 */
	| { kind: "draft"; edge: "start" | "end" | "body"; rect: Rect }
	| { kind: "gutter" }
	| { kind: "grid"; column: number; contentY: number }
	| { kind: "none" };

/**
 * The chrome measurements a hit test needs — the same numbers the paint pass draws with, plus the
 * one target floor ({@link barHit}) that is deliberately larger than what is drawn.
 */
export interface HitMetrics {
	barWidth: number;
	barInset: number;
	barHit: number;
	pillW: number;
	pillH: number;
	pillInset: number;
	/**
	 * How deep (px) each of the DRAFT block's two edge grab bands is.
	 *
	 * Capped at a third of the draft's own height by the hit test, so a very short draft still has a
	 * middle to drag by rather than being all edge — with no cap, a 20px draft would be two 12px
	 * resize bands overlapping and could never be moved.
	 */
	draftGrab: number;
	/** The draft's inline insets inside its column (px) — the same two the painter draws it with. */
	draftInsetStart: number;
	draftInsetEnd: number;
	/** The `+N` chip's box. From the palette, never from `measureText` — see {@link badgeRect}. */
	badgeMinW: number;
	badgeH: number;
}

/**
 * The `+N` chip's rect on a card, or null when that card carries no fold.
 *
 * Its size comes from the PALETTE rather than from measuring its own text, for the same reason
 * {@link presentRect}'s does: a rect derived from `ctx.measureText` could only be known inside the
 * draw, and the target would then depend on a frame having run. The chip is therefore a fixed box the
 * count is fitted INTO — which also means the reader's press target does not change size as a cluster
 * grows from `+9` to `+10`.
 *
 * Pinned to the card's top-trailing corner, inside the card's own box, and only where the card is
 * actually wide enough to hold it — a chip that overhung its card would be a target sitting on the
 * neighbouring column.
 */
export function badgeRect(
	ev: SceneEvent,
	cardRect: Rect,
	metrics: Pick<HitMetrics, "badgeMinW" | "badgeH">,
): Rect | null {
	if (ev.foldedCount <= 0 || metrics.badgeMinW <= 0 || metrics.badgeH <= 0) return null;
	const pad = BADGE_PAD;
	const w = metrics.badgeMinW;
	const h = metrics.badgeH;
	if (w + pad * 2 > cardRect.w || h + pad * 2 > cardRect.h) return null;
	return { x: cardRect.x + cardRect.w - w - pad, y: cardRect.y + pad, w, h };
}

/** The `+N` chip's inset from its card's corner (px) — the canvas's restatement of the card padding. */
export const BADGE_PAD = 4;

/**
 * The DRAFT block's box — the one rectangle both the painter and the hit test resolve it through.
 *
 * It is derived from `scene.selection` rather than stored, and it is derived HERE rather than inside
 * either caller, because a box computed in the painter and a box computed in the hit test are two
 * boxes: the reader would grab a resize edge a few pixels away from the one they can see, and nothing
 * would look wrong until they tried. It is the same discipline `eventRect` and `badgeRect` follow.
 *
 * `null` for a preview that is not a draft (a gesture in flight is already being dragged and needs no
 * target of its own) and for a draft scrolled clean out of the viewport.
 */
export function draftRect(
	scene: GridScene,
	box: Pick<GridBox, "width" | "height">,
	metrics: Pick<HitMetrics, "draftInsetStart" | "draftInsetEnd">,
): Rect | null {
	const sel = scene.selection;
	if (!sel || !sel.draft) return null;
	const geo = columnGeometry(scene, box.width);
	if (geo.colW <= 0) return null;
	const y = sel.y - scene.scrollTop;
	// The same 6px floor the painter applies, so a zero-length draft is still a grabbable band rather
	// than a hairline nobody can point at.
	const h = Math.max(sel.h, DRAFT_MIN_H);
	if (y + h < 0 || y > box.height) return null;
	const start = metrics.draftInsetStart;
	const w = Math.max(0, geo.colW - start - metrics.draftInsetEnd);
	if (w <= 0) return null;
	return { x: geo.gutter + sel.column * geo.colW + start, y, w, h };
}

/** The minimum drawn/grabbable height of a preview rectangle (px) — a floor, never a duration. */
export const DRAFT_MIN_H = 6;

/**
 * Resolve a pointer to what it is over, in the REVERSE of painting order — the pill and the gauge
 * are drawn last and so are hit first, and cards are walked backwards so the one drawn on top of an
 * overlap is the one that answers.
 *
 * `x`/`y` are LOGICAL canvas coordinates: x measured from the inline start, so a mirrored surface is
 * converted once by the caller rather than at every comparison here.
 */
export function hitTest(
	scene: GridScene,
	box: Pick<GridBox, "width" | "height">,
	metrics: HitMetrics,
	x: number,
	y: number,
): SceneHit {
	const pill = presentRect(scene, box, metrics);
	if (pill && inRect(pill, x, y)) return { kind: "present" };

	// A gauge the canvas has declined to draw must not stay a live grab strip along the trailing edge.
	// A pointer device reveals it by hovering first; a finger gets no such warning, so an invisible
	// handle would be a control the reader can only find by pressing something they cannot see.
	const bar = (scene.scrollbar?.opacity ?? 0) > 0 ? scrollbarHitRect(scene, box, metrics) : null;
	if (bar && inRect(bar, x, y)) return { kind: "scrollbar", rect: bar };

	const geo = columnGeometry(scene, box.width);

	/*
	 * THE DRAFT, hit before every card and after the chrome.
	 *
	 * WHILE YOU ARE COMPOSING, THE BLOCK IS YOURS. It first sat after the cards, on the reasoning that
	 * a draft is transient and an event is not — and that ordering made the draft's two resize edges
	 * unreachable in practice. They are ten pixels deep, and a deadline PIN carries a twenty-pixel hit
	 * band it draws no pixels for, so a pin anywhere near the draft's edge silently swallowed the grab
	 * and opened itself instead. Nothing looked wrong; the resize simply did not happen.
	 *
	 * One rule the reader can predict beats two they have to guess between: a press inside the draft
	 * moves or resizes it, and the event underneath is one Escape away and is not going anywhere. The
	 * draft only exists while its own composer is open, so the exception is bounded by a state the
	 * reader put the surface into and can leave at will.
	 */
	const draft = draftRect(scene, box, metrics);
	if (draft && inRect(draft, x, y)) {
		// Capped at a third of the height, so a short draft keeps a middle to move by rather than being
		// two overlapping resize bands that can only ever be resized.
		const grab = Math.min(metrics.draftGrab, draft.h / 3);
		if (grab > 0 && y < draft.y + grab) return { kind: "draft", edge: "start", rect: draft };
		if (grab > 0 && y > draft.y + draft.h - grab) {
			return { kind: "draft", edge: "end", rect: draft };
		}
		return { kind: "draft", edge: "body", rect: draft };
	}

	const events = scene.events ?? [];
	for (let i = events.length - 1; i >= 0; i--) {
		// A card that draws no pixels must not be a live target either — a click there would activate
		// something the reader cannot see and never saw drawn. `drawn` is the ONE flag the painter and
		// this walk both read, so the two cannot disagree about which cards exist.
		if (!events[i].drawn) continue;
		const rect = eventRect(events[i], geo, scene.scrollTop);
		// The chip is drawn ON the card and so is hit BEFORE it: a press meant to unfold a cluster must
		// not open the one card that happened to be on top of it.
		const badge = badgeRect(events[i], rect, metrics);
		if (badge && inRect(badge, x, y)) return { kind: "badge", event: events[i], rect: badge };
		if (inRect(rect, x, y)) return { kind: "event", event: events[i], rect };
	}

	if (x < geo.gutter) return { kind: "gutter" };
	if (geo.colW <= 0) return { kind: "none" };
	const column = Math.floor((x - geo.gutter) / geo.colW);
	if (column < 0 || column >= scene.columns) return { kind: "none" };
	return { kind: "grid", column, contentY: y + scene.scrollTop };
}
// #endregion

// #region Depth gauge
/**
 * The overlay scrollbar's DEPTH geometry: longest at the shallow end of the range, shrinking
 * linearly toward {@link GAUGE_MIN} at the deep end, with the near edge mapped across
 * `track − length` so the handle touches both ends of the track.
 *
 * A proportional thumb is meaningless on this surface — both timed axes are effectively infinite
 * (~19 years in Week), so `viewport / content` is a hair nobody can grab. This answers "how much
 * further can I go" instead.
 *
 * `frozen` is the length captured on pointer-down: a length that changed under the cursor mid-drag
 * would move the handle's own grab point, so it is held until the pointer both releases and leaves.
 */
export function gaugeGeometry(
	progress: number,
	trackLen: number,
	frozen?: number | null,
): { length: number; offset: number } {
	const p = Math.min(1, Math.max(0, progress));
	const longest = Math.max(GAUGE_MIN, trackLen * GAUGE_MAX_RATIO);
	const raw = frozen ?? (longest - (longest - GAUGE_MIN) * p);
	const length = Math.min(trackLen, Math.max(GAUGE_MIN, raw));
	return { length, offset: p * Math.max(0, trackLen - length) };
}
// #endregion

// #region Edge-hold continuous scroll
/**
 * How fast to scroll, per frame, for a handle held `overshootPx` beyond the track's own edge.
 *
 * It DELEGATES to `core/chrome.ts`'s {@link joystickVelocity}, and what that delegation says is that
 * edge-hold is no longer a mechanism of its own. The bars are rate controls now: a drag is a throttle
 * measured from where it grabbed, so there is no track edge left to overshoot and "past the edge" is
 * simply one deflection among all the others. Two ramps answering "how fast" is how a Day bar and a
 * Week bar come to coast at different speeds for the same gesture, so there is one.
 *
 * `0` for no overshoot, or for the wrong sign — a positive overshoot only drives scrolling in ITS OWN
 * direction, so a caller passes the signed distance past whichever edge is relevant and gets `0` back
 * for the other.
 */
export function edgeHoldVelocity(overshootPx: number): number {
	if (overshootPx <= 0) return 0;
	return joystickVelocity(overshootPx);
}

// #region Release momentum
/**
 * How much of a pan/fling's release velocity survives each animation frame (§Part 4). A PER-FRAME
 * factor, applied once per `requestAnimationFrame` tick rather than once per second — shared by the
 * virtual (`useCanvasViewport`) and native (`useCalendarViewport`) viewport hooks, so a fling started
 * on the Week grid and one started on the Day timeline coast at the same felt rate.
 */
export const MOMENTUM_DECAY = 0.95;
/** Below this speed (px/ms) the coast is imperceptible, so a fling animation simply stops. */
export const MOMENTUM_MIN_V = 0.02;
/** A release slower than this (px/ms) is a deliberate stop, not a flick — no fling starts at all. */
export const MOMENTUM_MIN_RELEASE_V = 0.12;
/** How far back (ms) the release-velocity sample looks — recent enough that a pause-then-release
 *  reads as a stop, long enough to smooth out one noisy pointer-move sample. */
export const VELOCITY_WINDOW_MS = 80;
// #endregion

// #endregion

// #region Selection
/** Snap a minute offset to the drag-select grid. */
export function snapMinutes(minute: number, step: number): number {
	return Math.round(minute / step) * step;
}

/** A drag-select range resolved to a real {@link CalendarRange}-shaped pair of instants. */
export function selectionRange(
	dayStart: number,
	a: number,
	b: number,
	step: number,
	fallbackMinutes = 60,
): { start: number; end: number } {
	const lo = Math.min(a, b);
	const hi = Math.max(a, b);
	// A bare click (no travel) is an intent to create, not a zero-length event — it opens the default
	// slot, which is what the DOM grid did and what every calendar the reader has used does.
	const dur = hi - lo < step ? fallbackMinutes : hi - lo;
	return { start: dayStart + lo * MIN, end: dayStart + (lo + dur) * MIN };
}
// #endregion
