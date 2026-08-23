/**
 * @projective/ui/calendar — the Week grid: a CONTINUOUS, INFINITE, virtualized stack of blocks,
 * drawn as an IMMEDIATE-MODE CANVAS.
 *
 * The seven days of a week are laid out as COLUMNS, so one week occupies exactly 24 hours of vertical
 * axis. Scrolling past 24:00 therefore flows into the NEXT week's 00:00 and up past 00:00 into the
 * previous week's — endlessly, with no navigation click and no wall at either end (the axis spans
 * ±{@link WINDOW_BLOCKS} blocks, decades at any usable zoom). Only the blocks intersecting the
 * viewport are laid out at all, so the cost of a frame is a function of the VIEWPORT, never of the
 * axis or of how deep the reader has scrolled.
 *
 * WHAT IS INSIDE `.cal-tg__viewport`: one `<canvas>`, and nothing else. The hour scale, the day
 * columns, the working-hours bands, the blackout hatch, every event card, the current-time rule, the
 * drag preview, the period markers, the depth gauge and the return-to-present pill are all pixels
 * from ONE ordered pass ({@link paintScene}) over ONE {@link GridScene}. There is no scroll
 * container: the offset is a signal this component owns through {@link useCanvasViewport}, and every
 * gesture is resolved by mapping a pointer into scene coordinates and asking {@link hitTest} what is
 * there.
 *
 * WHAT IS BESIDE IT: the accessible layer — a real, focusable, screen-reader-visible list of the same
 * events, a live region naming what is on screen, and the return-to-present control. A canvas is
 * opaque to assistive technology and to the keyboard, so a pure-canvas viewport is only shippable
 * with a parallel layer that carries what pixels cannot: role, name, focus and activation. The canvas
 * is `aria-hidden` — it is the DRAWING; the layer beside it is the CONTENT.
 *
 * THE GESTURE MAP, unchanged where it existed and stated where it is new:
 *   - wheel — scroll · Ctrl/Meta + wheel — zoom (the island owns it, on an ancestor)
 *   - middle-drag, or Ctrl/Meta + left-drag — pan
 *   - one-finger TOUCH drag — scroll; a touch that does not travel is a tap, which opens the card
 *     under it or creates a slot. There is no scroll container for the browser to pan, so the finger
 *     has to be handled here or the grid does not scroll on a phone at all; two fingers stay with the
 *     browser so page pinch-zoom survives (WCAG 1.4.4).
 *   - plain drag on EMPTY grid — create a range (as before)
 *   - plain drag on a CARD — move it, and only when the host passes `onMoveEvent`; a press that does
 *     not travel is still a click, so opening an event is unchanged either way
 *
 * NO FRAME IS EVER REQUIRED. Measurement, centring and painting all happen in layout effects, which
 * Preact flushes synchronously at commit; `requestAnimationFrame` appears only as a coalescing
 * optimisation for pointer-rate input, and falls through to a synchronous draw wherever a frame may
 * never arrive. rAF, CSS transitions and CSS `@keyframes` are all frozen in a hidden or background
 * tab, and a grid that needed one would simply be blank there.
 */
import type { JSX, VNode } from "preact";
import type { Signal } from "@preact/signals";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type {
	CalendarAvailability,
	CalendarEvent,
	CalendarRange,
	WorkingWindow,
} from "../core/types.ts";
import type {
	GridRegion,
	GridScene,
	SceneEvent,
	SceneMarker,
	SceneNowLine,
	SceneRecede,
	SceneSelection,
} from "../core/grid-paint.ts";
import type { HitMetrics, Rect, SceneColumnSpec } from "../core/scene-build.ts";
import {
	buildSceneEvents,
	DRAFT_MIN_H,
	draftRect,
	eventAccessibleName,
	eventRect,
	hitTest,
	inRect,
	scrollbarHitRect,
	selectionRange,
	snapMinutes,
} from "../core/scene-build.ts";
import {
	addZonedDays,
	DAY,
	fmtDayLabel,
	fmtHourLabel,
	fmtTime,
	MIN,
	minutesFromDayStart,
	sameZonedDay,
	startOfDay,
	weekdayLabels,
	zonedDayNum,
	zonedWeekday,
} from "../core/time.ts";
import { scrollBehaviorFor } from "../hooks/useCalendarViewport.ts";
import { useCanvasViewport } from "../hooks/useCanvasViewport.ts";
import type { FrameStats } from "../core/scene-paint.ts";
import { hoverExpansionFor } from "../core/scene-paint.ts";
import { handleLength, leverBall, leverScrollDelta } from "../core/chrome.ts";
import { createSpring, SPRING_EXPRESSIVE_EXIT, SPRING_SNAPPY } from "../../core/motion.ts";
import type { GridCanvasApi } from "../hooks/useGridCanvas.ts";
import { useGridCanvas } from "../hooks/useGridCanvas.ts";
import { EventBlock } from "./EventBlock.tsx";
import { GridProbe } from "./GridProbe.tsx";
import type { EventPopoverAnchor, EventPopoverState } from "./EventPopoverLayer.tsx";

// #region Constants
/** One block is one calendar period tall on the axis; its days are laid out horizontally as columns. */
const BLOCK_MIN = 24 * 60;
/**
 * Half-window (blocks) each side of the mount block — ~19 years each way. The DOM grid had to keep
 * the axis inside the tightest engine's ~17.8M px element-height cap; a virtual offset has no such
 * element, so the only bound now is what stays exact in a double.
 */
const WINDOW_BLOCKS = 1000;
/** Drag-select and drag-move snapping (minutes). */
const SNAP = 15;
/** Blocks laid out beyond each viewport edge. */
const OVERSCAN_BLOCKS = 1;
/**
 * Hard ceiling on laid-out blocks. The window is derived from the measured viewport, so a degenerate
 * zoom (a standalone consumer passing a near-zero `pxPerHour`) could otherwise ask for thousands.
 * Virtualization makes the cost independent of the axis; a cap makes it independent of the inputs.
 */
const MAX_BLOCKS = 12;
/** How long the depth gauge stays revealed after the last scroll (ms). */
const BAR_IDLE_MS = 900;
/** Pointer travel (px) that turns a press into a drag rather than a click. */
const DRAG_THRESHOLD = 4;

/** Hit metrics for a scene drawn before the palette resolved — nothing is hit-testable yet. */
const NO_METRICS: HitMetrics = {
	barWidth: 0,
	barInset: 0,
	barHit: 0,
	pillW: 0,
	pillH: 0,
	pillInset: 0,
	badgeMinW: 0,
	badgeH: 0,
	draftGrab: 0,
	draftInsetStart: 0,
	draftInsetEnd: 0,
};
// #endregion

// #region Gestures
/**
 * The live gesture, or null.
 *
 * ONE state rather than three signals, because the gestures are mutually exclusive by construction
 * and three flags can express states that cannot happen — dragging a card while also dragging the
 * gauge — which then have to be defended against everywhere instead of nowhere.
 */
type Gesture =
	| {
		kind: "create";
		column: number;
		dayStart: number;
		blockIndex: number;
		/** Block-local minutes. */
		from: number;
		to: number;
	}
	| {
		kind: "move";
		card: SceneEvent;
		source: CalendarEvent;
		/** How far into the card the pointer grabbed, in minutes. */
		grabOffset: number;
		durationMin: number;
		/** The landing slot. */
		column: number;
		dayStart: number;
		blockIndex: number;
		startMin: number;
		/** Client y at pointer-down — a press that never travels this far stays a click. */
		originY: number;
		moved: boolean;
	}
	| {
		/**
		 * The live DRAFT block being repositioned — an event the reader has begun creating and has not
		 * committed, whose quick-create popover is open beside it.
		 *
		 * Its own gesture rather than a variant of `create`, because the two have opposite anchors:
		 * `create` grows from the minute the pointer went down and only its END moves, where a draft
		 * already has both edges and either one of them (or the whole block) is what is being moved.
		 * Folding them together would mean a flag inside every branch of the move handler.
		 */
		kind: "draft";
		edge: "start" | "end" | "body";
		/** Block-local minutes, live. */
		from: number;
		to: number;
		column: number;
		dayStart: number;
		blockIndex: number;
		/** How far into the block the pointer grabbed, in minutes — only a `body` drag uses it. */
		grabOffset: number;
	}
	| {
		kind: "bar";
		/** Canvas-space y the handle was grabbed at — the lever's ORIGIN, and the only fixed point. */
		grabY: number;
		/** Canvas-space y of the pointer right now. Its distance from `grabY` is the throttle. */
		pointerY: number;
		/** Handle length captured at grab time, so it cannot change under the cursor mid-drag. */
		frozen: number;
	};
// #endregion

export interface TimeGridProps {
	/**
	 * Optional per-frame cost report — see `FrameStats`. Absent by default and free when absent, so
	 * measuring the renderer never becomes something production pays for.
	 */
	onFrame?: (stats: FrameStats) => void;
	/**
	 * The FOCUSED block's day-midnight epochs (7 for a week, 1 for a single-day column set). Their
	 * count fixes the block stride and must stay stable for the lifetime of the component — it is the
	 * axis geometry, not a render-time choice.
	 */
	days: number[];
	tz: string;
	hour12: boolean;
	events: CalendarEvent[];
	availability?: CalendarAvailability;
	/** Zoom (px per hour), owned by the Calendar island. */
	pxPerHour: Signal<number>;
	/**
	 * The live clock. Read ONLY at draw time and inside the return-to-present computed — never in this
	 * component's render body, so a minute tick repaints the current-time rule and mutates no DOM.
	 */
	now: Signal<number>;
	/** Whether the client has mounted (gates the now-line). */
	mounted: Signal<boolean>;
	/** Day-granular "today" (that day's midnight epoch), or null before mount. Changes at midnight. */
	todayMs: number | null;
	canCreate?: boolean;
	/** Draw one of an event's sources (consumer-owned brand marks) — the all-day lane only. */
	renderSource?: (source: string) => VNode | null;
	onSelectRange?: (range: CalendarRange) => void;
	onOpenEvent?: (event: CalendarEvent) => void;
	/**
	 * Move an existing event to a new slot. Supplying it is what ENABLES dragging a card: without a
	 * handler a plain drag would offer a rearrangement the host has no way to keep, so the gesture is
	 * not offered at all rather than offered and silently discarded.
	 */
	onMoveEvent?: (event: CalendarEvent, range: CalendarRange) => void;
	/** Fired as the scroll centre crosses into a new block, so the header + mini-map track it. */
	onFocusChange?: (dayStart: number) => void;
	/**
	 * Clusters the reader has unfolded, by `DaySlot.clusterId`.
	 *
	 * Owned by the ISLAND rather than by this component, because the Day timeline unfolds the same
	 * clusters and a fold the reader opened in one view has not closed itself by the time they switch
	 * to the other.
	 */
	unfolded?: ReadonlySet<string>;
	/** Toggle one cluster's fold. */
	onUnfold?: (clusterId: string) => void;
	/**
	 * The shared popover state the whole engine writes into, or absent to keep the old behaviour where
	 * a click goes straight to {@link onOpenEvent}.
	 *
	 * A signal rather than a callback pair because the drag-to-create popover has to TRACK a live
	 * gesture: its anchor is rewritten on every pointer move, and a callback would mean re-opening the
	 * same popover sixty times a second.
	 */
	popover?: Signal<EventPopoverState | null>;
	/**
	 * The EVENT the reader is pointing at from OUTSIDE the grid — a row in the overlap-list popover.
	 *
	 * A separate channel from the grid's own hover, and that separation is load-bearing: the popover
	 * is body-portalled, so moving the pointer off a card and into it fires this viewport's own
	 * `pointerleave` and clears `hoverId` — a single channel would collapse the highlight on the very
	 * card the row the reader just reached stands for.
	 */
	highlight?: Signal<string | null>;
	/**
	 * The live DRAFT — a range the reader has begun creating and has not committed, drawn as a dashed
	 * block they can still drag and resize while its quick-create popover is open.
	 *
	 * A signal rather than a prop because BOTH ends write it: this component moves it, and the popover
	 * beside it edits the same range through its own time fields. One fact, one owner, two editors.
	 */
	draft?: Signal<CalendarRange | null>;
	/**
	 * Raised by this component for the duration of a press that lands on the DRAFT BLOCK, so the
	 * popover beside it does not read that press as a click-away and close under the reader's finger.
	 *
	 * The block is painted pixels rather than an element, so the overlay-containment model cannot see
	 * it — this is the one fact only the grid's own hit test knows. See `EventPopoverLayer`'s
	 * `pointerGuard`, which reads it.
	 */
	pointerGuard?: Signal<boolean>;
	/**
	 * Step the zoom, anchored at a viewport y this component has already pinned.
	 *
	 * The zoom scale is the island's to own — it is persisted and it drives the view continuum — but
	 * only this component can map a pointer into its own scene, so the anchoring happens here and the
	 * scale change is asked for.
	 */
	onZoom?: (dir: "in" | "out") => void;
	/**
	 * Hand the island this viewport's own zoom INTERPOLATOR.
	 *
	 * The scale is the island's state; the journey between two scales belongs to whichever viewport is
	 * mounted, because only it knows where the cursor is anchored and can re-solve the offset from that
	 * anchor on every frame. Registration rather than a prop, because the function is created by a hook
	 * inside this component and cannot be lifted without lifting the viewport with it.
	 */
	registerZoom?: (
		run: (target: number, opts?: { onSettle?: () => void }) => () => void,
	) => void;
	/** The zoom bounds the island's continuum expects, so the spring and the pinch clamp where it does. */
	zoomRange?: readonly [number, number];
}

export function TimeGrid(props: TimeGridProps): JSX.Element {
	const { days, tz, hour12, pxPerHour, todayMs } = props;

	// #region Axis
	// Fixed axis origin (index 0 = the block focused on MOUNT). Never re-based, so scene positions stay
	// stable across navigation; jumps scroll WITHIN the ±WINDOW_BLOCKS window.
	const blockDays = useRef(Math.max(1, days.length)).current;
	const refStart = useRef(startOfDay(days[0] ?? Date.now(), tz)).current;
	const RANGE_START_MIN = -WINDOW_BLOCKS * BLOCK_MIN;
	const RANGE_END_MIN = (WINDOW_BLOCKS + 1) * BLOCK_MIN;

	const blockStartOf = (i: number) => addZonedDays(refStart, i * blockDays, tz);
	/**
	 * Which block a day belongs to. Two steps, and both are load-bearing: the elapsed span is rounded
	 * to whole DAYS first, because a DST transition makes a day 23h or 25h and a direct division by
	 * the block span would land just off the integer; then the day offset is FLOORED by the stride,
	 * because a mid-block day (Thursday of a Monday-start week) must resolve to the block that
	 * contains it — rounding would push the back half of every block into the next one.
	 */
	const blockIndexOf = (ms: number) =>
		Math.floor(Math.round((startOfDay(ms, tz) - refStart) / DAY) / blockDays);

	const focusBlock = blockIndexOf(days[0] ?? refStart);
	const todayBlock = todayMs == null ? null : blockIndexOf(todayMs);
	// #endregion

	const gesture = useSignal<Gesture | null>(null);
	const hoverId = useSignal<string | null>(null);
	const focusId = useSignal<string | null>(null);
	/**
	 * The block a focused card lives in, held so the layout window cannot drop it.
	 *
	 * The region advertises Page Up / Page Down, and those keys bubble from a focused card's own
	 * button — so without this, scrolling two screens would unmount the element holding focus, focus
	 * would fall to `<body>`, and the very keys the reader was told about would stop scrolling the
	 * grid and start scrolling the page. A browser keeps focus on an element scrolled out of view;
	 * this is what lets a virtualized layer do the same.
	 */
	const focusBlockHeld = useSignal<number | null>(null);
	const pillFocus = useSignal(false);
	const regionFocus = useSignal(false);
	const pillHover = useSignal(false);
	const barOn = useSignal(false);
	const barActive = useSignal(false);
	const barIdle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	/** The in-flight lever throttle frame — the canvas twin of `useOverlayScrollbar`'s. */
	const barLeverRaf = useRef<number | null>(null);
	/** rAF's own timestamp origin for the throttle, or `-1` before the first tick establishes it. */
	const barLeverAt = useRef(-1);
	/** The canvas API, reachable from code that runs while `useGridCanvas` is still initialising. */
	const canvasApi = useRef<GridCanvasApi | null>(null);

	/**
	 * The hovered card's expansion, in px, driven by a spring.
	 *
	 * ONE spring rather than one per card, because exactly one card is hovered at a time: the value is
	 * always "how far the CURRENT hover has opened", and moving the pointer from one card to another
	 * retargets the same journey rather than starting a second one. It is read at DRAW time and at HIT
	 * time, never in the render body — a spring read in a render body would re-render this component
	 * and its whole accessible list on every animation frame to move a card's bottom edge.
	 */
	const hoverSpring = useMemo(
		() => createSpring(0, { config: SPRING_SNAPPY, requireOverDamped: false }),
		[],
	);
	/** The lever's pill-to-ball morph, 0..1. Resolved, never a transition — a frozen clock must not strand it. */
	const morphSpring = useMemo(() => createSpring(0, { config: SPRING_SNAPPY }), []);
	useEffect(() => () => {
		hoverSpring.dispose();
		morphSpring.dispose();
	}, [hoverSpring, morphSpring]);

	const viewport = useCanvasViewport({
		zoomRange: props.zoomRange,
		pxPerHour,
		rangeStartMin: RANGE_START_MIN,
		rangeEndMin: RANGE_END_MIN,
		// Read through the SIGNAL so the return-to-present computed stays live without this component
		// re-rendering: a computed only notifies its subscribers when its own value changes, so a tick
		// that leaves the pill in the same state is silent.
		nowY: () => {
			if (todayMs == null || todayBlock == null) return null;
			const m = todayBlock * BLOCK_MIN + minutesFromDayStart(props.now.value, todayMs);
			return ((m - RANGE_START_MIN) / 60) * pxPerHour.value;
		},
		// The initial centre: the live time when today is in the focused block, else that block's noon —
		// symmetric room to scroll up into the morning and down across midnight. `peek()` because this
		// runs inside an effect and must not subscribe anything to the clock.
		focusY: () => {
			const anchor = todayBlock === focusBlock && todayMs != null
				? focusBlock * BLOCK_MIN + minutesFromDayStart(props.now.peek(), todayMs)
				: focusBlock * BLOCK_MIN + 12 * 60;
			return ((anchor - RANGE_START_MIN) / 60) * pxPerHour.value;
		},
	});

	const pph = pxPerHour.value;
	const top = viewport.scrollTop.value;
	const viewH = viewport.viewportH.value;
	const gutterW = viewport.gutter.value;
	const yFor = (m: number) => ((m - RANGE_START_MIN) / 60) * pph;
	const minAt = (y: number) => RANGE_START_MIN + (y / pph) * 60;

	const canvasRef = useRef<HTMLCanvasElement>(null);
	const probeRef = useRef<HTMLDivElement>(null);
	/** The last block we emitted or navigated to — breaks the focus↔scroll feedback loop. */
	const lastBlock = useRef(focusBlock);

	// #region Centre-block tracking (scroll → header/mini-map)
	useSignalEffect(() => {
		const t = viewport.scrollTop.value;
		const h = viewport.viewportH.value;
		// `t <= 0` is the un-centred first read, not a destination: offset 0 on a ±19-year axis is two
		// decades ago, so reporting it would teleport the consumer's focus before the viewport has
		// positioned itself.
		if (h <= 0 || t <= 0) return;
		const i = Math.floor(minAt(t + h / 2) / BLOCK_MIN);
		if (i === lastBlock.current) return;
		lastBlock.current = i;
		props.onFocusChange?.(blockStartOf(i));
	});
	// #endregion

	// #region Nav jumps (focus changed externally → scroll to it; ignore our own echo)
	useEffect(() => {
		if (focusBlock === lastBlock.current) return;
		lastBlock.current = focusBlock;
		viewport.scrollToFocus(scrollBehaviorFor());
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [focusBlock]);
	// #endregion

	// #region Availability per day
	function windowsFor(dayStart: number): WorkingWindow[] {
		if (!props.availability) return [];
		const wd = zonedWeekday(dayStart, tz);
		return props.availability.rules
			.filter((r) => r.weekday === wd)
			.map((r) => ({ startMinute: r.startMinute, endMinute: r.endMinute }));
	}
	function isBlackout(dayStart: number): boolean {
		if (!props.availability) return false;
		const end = dayStart + DAY;
		return props.availability.blackouts.some((b) => b.start < end && b.end > dayStart);
	}
	// #endregion

	// #region Visible-block window
	/*
	 * The window is only trustworthy once the viewport has been MEASURED. Before that — SSR, and the
	 * first client render — a scroll offset of 0 is not "the top of the viewport" but the top of a
	 * two-decade axis, so it falls back to the FOCUSED block: the right week, simply without having
	 * scrolled to it yet.
	 *
	 * The DOM grid needed a second condition here (a host that did not cap the calendar's height made
	 * the scroller's client height the whole axis, so every block was nominally in view). A virtual
	 * viewport cannot fail that way: its height is its own measured box, never its content's.
	 */
	const measured = viewH > 0;
	const rawFirst = measured
		? Math.max(-WINDOW_BLOCKS, Math.floor(minAt(top) / BLOCK_MIN) - OVERSCAN_BLOCKS)
		: focusBlock - OVERSCAN_BLOCKS;
	const rawLast = measured
		? Math.min(WINDOW_BLOCKS, Math.floor(minAt(top + viewH) / BLOCK_MIN) + OVERSCAN_BLOCKS)
		: focusBlock + OVERSCAN_BLOCKS;
	const lastBlockIn = Math.min(rawLast, rawFirst + MAX_BLOCKS - 1);
	const blocks: number[] = [];
	const held = focusBlockHeld.value;
	// The held block is prepended or appended rather than merged into the run, so the window stays
	// sorted while being allowed a GAP — which `buildSceneEvents` handles, and which is the whole point
	// of holding it: the reader may have paged years away from the card they are focused on.
	if (held != null && held < rawFirst) blocks.push(held);
	for (let i = rawFirst; i <= lastBlockIn; i++) blocks.push(i);
	if (held != null && held > lastBlockIn) blocks.push(held);
	// #endregion

	// #region Scene
	const hourRows = viewport.rows.value;
	const bands: GridRegion[] = [];
	const blackouts: GridRegion[] = [];
	const columnSpecs: SceneColumnSpec[] = [];
	const markers: SceneMarker[] = [];
	for (const i of blocks) {
		const blockStart = blockStartOf(i);
		const blockTop = yFor(i * BLOCK_MIN);
		const blockEnd = addZonedDays(blockStart, blockDays - 1, tz);
		markers.push({
			y: blockTop,
			today: todayBlock === i,
			text: blockDays === 1
				? fmtDayLabel(blockStart, tz)
				: `${fmtDayLabel(blockStart, tz)} – ${fmtDayLabel(blockEnd, tz)}`,
		});
		for (let column = 0; column < blockDays; column++) {
			const day = addZonedDays(blockStart, column, tz);
			columnSpecs.push({ column, dayStart: day, top: blockTop });
			if (!props.availability) continue;
			if (isBlackout(day)) blackouts.push({ column, y: blockTop, h: (BLOCK_MIN / 60) * pph });
			for (const w of windowsFor(day)) {
				// Clamped to the block, so a window authored past midnight stops at the seam instead of
				// tinting the next period's column.
				const from = Math.max(0, w.startMinute);
				const to = Math.min(BLOCK_MIN, w.endMinute);
				if (to > from) {
					bands.push({ column, y: blockTop + (from / 60) * pph, h: ((to - from) / 60) * pph });
				}
			}
		}
	}

	/*
	 * The card layout is memoised across renders that cannot have changed it.
	 *
	 * This component re-renders on every scroll DELTA — the offset is a signal it reads in its render
	 * body — while the cards only move when the block window, the zoom or the corpus does. Without the
	 * memo a wheel gesture rebuilds the whole layout dozens of times a second for a result identical to
	 * the last one. `columnSpecs` is derived from exactly these inputs, which is why it is not itself a
	 * dependency: it is a fresh array on every render by construction.
	 */
	const blockKey = blocks.join(",");
	const colW = blockDays > 0 ? Math.max(0, viewport.viewportW.value - gutterW) / blockDays : 0;
	/*
	 * The unfolded set is a dependency but the HOVER is deliberately not: an expansion is applied to
	 * the memoised result at draw time (see `currentScene`) rather than re-run through it, because
	 * re-running the placement engine sixty times a second to move one card's bottom edge would make
	 * a hover cost what a corpus change costs.
	 */
	const unfoldKey = props.unfolded ? Array.from(props.unfolded).sort().join(",") : "";
	/*
	 * THE FOCUS CHANNELS, resolved in the render body rather than at draw time.
	 *
	 * Unlike the hover expansion — which is a spring and is patched into the memoised scene per frame
	 * so a hover costs a canvas repaint and no DOM work — these two change only when the reader starts
	 * or stops an interaction, which is a handful of times a second at most. Putting them in the memo
	 * key keeps `SceneEvent.recede` a property the scene actually carries, which is what lets the
	 * accessible layer and the hit test see the same scene the painter does.
	 */
	const highlightId = props.highlight?.value ?? null;
	const draftRange = props.draft?.value ?? null;
	const gestureNow = gesture.value;
	const dragging = gestureNow !== null && gestureNow.kind !== "bar";
	const activeCardId = gestureNow?.kind === "move" ? gestureNow.card.id : null;
	/*
	 * A DRAG beats a list hover. The reader can only be doing one of the two, and if both are somehow
	 * live the one they are actively moving is the one they are looking at — see `buildSceneEvents`,
	 * which resolves the same precedence for the subject itself.
	 */
	const recede: SceneRecede = dragging ? "drag" : highlightId !== null ? "focus" : "none";
	const cards = useMemo(
		() =>
			buildSceneEvents(columnSpecs, props.events, {
				pxPerHour: pph,
				tz,
				hour12,
				columnWidth: colW,
				unfolded: props.unfolded,
				highlightEventId: highlightId,
				activeCardId,
				recede,
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[
			blockKey,
			pph,
			tz,
			hour12,
			props.events,
			Math.round(colW),
			unfoldKey,
			highlightId,
			activeCardId,
			recede,
		],
	);
	const eventById = useMemo(() => new Map(props.events.map((e) => [e.id, e])), [props.events]);

	/** The accent tokens actually on screen — what the probe resolves card paints for. */
	const accentKey = useMemo(
		() => Array.from(new Set(cards.map((c) => c.accent))).sort().join(","),
		[cards],
	);
	const accents = useMemo(() => accentKey ? accentKey.split(",") : [], [accentKey]);

	const progress = viewport.maxScroll.value > 0 ? top / viewport.maxScroll.value : 0;
	const live = gestureNow;
	const scene: GridScene = {
		scrollTop: top,
		columns: blockDays,
		gutter: gutterW,
		rules: hourRows.map((r) => ({ y: r.y, boundary: r.dayBoundary })),
		hours: hourRows.map((r) => ({ y: r.y, text: fmtHourLabel(r.hourOfDay, hour12) })),
		bands,
		blackouts,
		markers,
		events: cards,
		eventsTotal: props.events.length,
		// A gesture in flight always wins: while the reader is dragging the draft, the live shape of
		// what their hand is doing is the only honest thing to draw. At rest the resting draft takes
		// over, so the block does not vanish the instant they let go of it.
		selection: previewFor(live, pph, tz, hour12, yFor) ??
			restingDraft(draftRange, columnSpecs, tz, hour12, pph),
		focusId: focusId.value,
		hoverId: hoverId.value,
		scrollbar: measured
			? {
				progress,
				// During a drag this is the length captured at the grab, so the handle cannot change size
				// under the cursor while the reader is holding it. At REST it is resolved by
				// `currentScene()` instead — the at-rest length is measured against the palette, and the
				// palette does not exist yet at this point in the render.
				frozen: live?.kind === "bar" ? live.frozen : null,
				opacity: barOn.value || barActive.value ? 1 : 0,
				active: barActive.value,
				// Patched in by `currentScene()` at draw/hit time rather than resolved here: the morph is a
				// spring, and reading it in this render body would re-render the component and its whole
				// accessible list on every animation frame to reshape one handle.
				lever: null,
			}
			: null,
		present: viewport.awayFromNow.value
			? {
				direction: viewport.awayFromNow.value,
				text: "Now",
				hover: pillHover.value,
				focused: pillFocus.value,
			}
			: null,
		focusRegion: regionFocus.value,
	};

	/*
	 * The scene the DRAW reads, refreshed during render.
	 *
	 * The current-time rule is added by the factory rather than by the render body on purpose: reading
	 * the minute signal here would make a tick re-render this component and its whole accessible list
	 * to move one rule. Peeked at draw time instead, with a signal effect below repainting the canvas
	 * on each tick, a minute now costs one canvas draw and zero DOM mutations.
	 */
	const sceneRef = useRef(scene);
	sceneRef.current = scene;

	/**
	 * The lever as it was when the drag ENDED, held so the ball can morph back into a pill.
	 *
	 * Without it the gesture's own disappearance would take the ball with it and the handle would snap
	 * rather than return — and "releasing returns the handle to normal" is a motion, not a jump cut.
	 */
	const lastLever = useRef<{ grabY: number; pointerY: number } | null>(null);

	/**
	 * The scene as it is RIGHT NOW, with every SPRUNG value applied.
	 *
	 * The draw and the hit test both read this and nothing else, which is what keeps an expanded card's
	 * drawn box and its pointer target one rectangle — if they came apart the pointer would oscillate
	 * on the expansion's own edge, expanding and collapsing the card under itself. The springs are
	 * PEEKED, never read reactively: they are repainted by the signal effect below, so a hover costs
	 * one canvas draw per frame and zero DOM mutations.
	 */
	function currentScene(): GridScene {
		const base = sceneRef.current;
		const expand = hoverSpring.value.peek();
		const morph = morphSpring.value.peek();
		const grip = lastLever.current;
		const bar = base.scrollbar;
		let next: GridScene = base;
		if (bar) {
			/*
			 * The handle's LENGTH at rest: the share of ONE PERIOD — a day, a week — the viewport can
			 * currently see. Deliberately NOT `viewport / content`: this axis spans about nineteen years,
			 * so a proportional thumb would be a hair nobody could grab, and changing the DENOMINATOR from
			 * the axis to the period is what makes the number mean something again. A drag keeps the
			 * length it grabbed.
			 */
			const track = Math.max(1, viewport.viewportH.peek() - metrics().barInset * 2);
			const frozen = bar.frozen ??
				handleLength(track, viewport.visibleFraction.peek());
			const lever = grip && morph > 0 ? leverBall(grip.grabY, grip.pointerY, morph) : null;
			next = { ...base, scrollbar: { ...bar, frozen, lever } };
		}
		const cards = next.events;
		if (!next.hoverId || expand <= 0 || !cards) return next;
		return {
			...next,
			events: cards.map((c) => (c.id === next.hoverId ? { ...c, hoverExpandPx: expand } : c)),
		};
	}
	const nowLineRef = useRef<() => SceneNowLine | null>(() => null);
	nowLineRef.current = () => {
		if (!props.mounted.peek() || todayMs == null || todayBlock == null) return null;
		const minute = todayBlock * BLOCK_MIN + minutesFromDayStart(props.now.peek(), todayMs);
		return {
			y: yFor(minute),
			// The rule is confined to TODAY's column on a multi-day block, and spans the single column
			// of a one-day one — where "today" is the only column there is.
			column: blockDays === 1
				? null
				: Math.round((startOfDay(todayMs, tz) - blockStartOf(todayBlock)) / DAY),
		};
	};
	const liveScene = (): GridScene => ({ ...currentScene(), now: nowLineRef.current() });

	const canvas = useGridCanvas({
		canvasRef,
		probeRef,
		scene: liveScene,
		accentKey: () => accentKey,
		onFrame: props.onFrame,
	});
	canvasApi.current = canvas;

	/*
	 * Repaints, through the REF rather than through the `canvas` binding.
	 *
	 * A signal effect re-runs SYNCHRONOUSLY the moment one of its dependencies changes, and that moment
	 * is not always after this function has finished: a re-render that is part-way through has not yet
	 * reached the `const canvas = useGridCanvas(...)` line, so the binding is in its temporal dead zone
	 * and reading it throws a `ReferenceError` that takes the whole island down. The ref is written
	 * beside that const and is never in a dead zone, so the worst case is a redraw asked for one frame
	 * before the canvas exists — which is a no-op, and which the very next paint corrects.
	 */
	// A minute tick repaints the rule and nothing else — no render, no DOM mutation.
	useSignalEffect(() => {
		props.now.value;
		if (props.mounted.value) canvasApi.current?.redraw();
	});
	// The two springs repaint the canvas the same way, for the same reason.
	useSignalEffect(() => {
		hoverSpring.value.value;
		morphSpring.value.value;
		canvasApi.current?.redraw();
	});
	// #endregion

	// #region Gauge reveal / idle fade
	useSignalEffect(() => {
		viewport.scrollTop.value;
		viewport.contentHeight.value;
		barOn.value = true;
		clearTimeout(barIdle.current);
		// A timer, not an animation: `setTimeout` still fires in a background tab (throttled), where a
		// CSS transition or a rAF tween is frozen outright. The gauge's opacity therefore arrives in the
		// scene as a resolved number and STEPS rather than fading — an honest step beats a stranded fade.
		barIdle.current = setTimeout(() => {
			if (!barActive.peek()) barOn.value = false;
		}, BAR_IDLE_MS);
	});
	useEffect(() => () => clearTimeout(barIdle.current), []);
	// #endregion

	// #region Pointer → scene
	function metrics(): HitMetrics {
		/*
		 * Read through the REF, not through the `canvas` binding.
		 *
		 * `useGridCanvas` evaluates the scene thunk it is handed while it is still initialising, and that
		 * thunk reaches here — so reading `canvas` would be reading the very `const` this call is in the
		 * middle of assigning, and a temporal-dead-zone `ReferenceError` takes the whole island down. The
		 * ref is written immediately after the hook returns, so every call that is not that first
		 * self-referential one sees the same object; the one that is sees `null`, which is exactly true —
		 * the palette has not been probed yet, and {@link NO_METRICS} already models "nothing is
		 * hit-testable".
		 */
		const p = canvasApi.current?.palette() ?? null;
		if (!p) return NO_METRICS;
		return {
			barWidth: p.barWidth,
			barInset: p.barInset,
			barHit: p.barHit,
			pillW: p.pillW,
			pillH: p.pillH,
			pillInset: p.pillInset,
			badgeMinW: p.badgeMinW,
			badgeH: p.badgeH,
			draftGrab: p.selectionGrab,
			draftInsetStart: p.selectionInsetStart,
			draftInsetEnd: p.selectionInsetEnd,
		};
	}
	function viewBox(): { width: number; height: number } {
		return { width: viewport.viewportW.peek(), height: viewport.viewportH.peek() };
	}
	function hitAt(e: PointerEvent) {
		const { x, y } = viewport.pointerAt(e);
		return { at: { x, y }, hit: hitTest(currentScene(), viewBox(), metrics(), x, y) };
	}
	/**
	 * The axis geometry as it is RIGHT NOW, peeked rather than closed over.
	 *
	 * A gesture's move handler outlives the render that started it, so reading `pph`/`gutterW`/`colW`
	 * from the render body would map the pointer through whatever scale was on screen at pointer-down
	 * — and a Ctrl+wheel zoom mid-drag re-scales the axis while the drag continues. The committed
	 * range would then be computed against a grid nobody is looking at.
	 */
	function liveGeo() {
		const p = pxPerHour.peek();
		const g = viewport.gutter.peek();
		const width = viewport.viewportW.peek();
		return { pph: p, gutter: g, colW: blockDays > 0 ? Math.max(0, width - g) / blockDays : 0 };
	}
	/** The axis minute under a canvas-space y, at the live zoom. */
	function axisMinuteAt(y: number): number {
		const p = pxPerHour.peek();
		const top = viewport.scrollTop.peek();
		return p > 0 ? RANGE_START_MIN + ((y + top) / p) * 60 : RANGE_START_MIN;
	}
	/**
	 * The absolute range a live draft gesture currently describes.
	 *
	 * The one place block-local minutes become epoch milliseconds for the draft, so the block the
	 * popover reads, the block the grid draws and the range the host is eventually handed cannot come
	 * apart. `selectionRange` applies the same `SNAP` floor a create commit does, so a draft dragged
	 * shorter than one step is still a real event rather than an instant nobody asked for.
	 */
	function draftRangeOf(g: Extract<Gesture, { kind: "draft" }>): CalendarRange {
		return selectionRange(g.dayStart, g.from, g.to, SNAP);
	}

	/**
	 * A live draft gesture's own canvas rect, for re-anchoring the popover beside it as it moves.
	 *
	 * Derived from `draftRect` — the SAME function the hit test resolves the draft through — rather
	 * than measured independently, so the panel points at the block the reader can actually grab.
	 */
	function hitRectOf(g: Extract<Gesture, { kind: "draft" }>): Rect {
		const geo = liveGeo();
		const m = metrics();
		const lo = Math.min(g.from, g.to);
		const hi = Math.max(g.from, g.to);
		const p = pxPerHour.peek();
		const y = yFor(g.blockIndex * BLOCK_MIN + lo) - viewport.scrollTop.peek();
		const start = m.draftInsetStart;
		return {
			x: geo.gutter + g.column * geo.colW + start,
			y,
			w: Math.max(0, geo.colW - start - m.draftInsetEnd),
			h: Math.max(((hi - lo) / 60) * p, DRAFT_MIN_H),
		};
	}

	/** Resolve a pointer to a grid slot, CLAMPED — a drag that leaves the columns still has a target. */
	function slotAt(x: number, y: number) {
		const geo = liveGeo();
		const w = geo.colW > 0 ? geo.colW : 1;
		const column = Math.min(blockDays - 1, Math.max(0, Math.floor((x - geo.gutter) / w)));
		const axisMinute = axisMinuteAt(y);
		const blockIndex = Math.floor(axisMinute / BLOCK_MIN);
		return {
			column,
			blockIndex,
			dayStart: addZonedDays(blockStartOf(blockIndex), column, tz),
			local: axisMinute - blockIndex * BLOCK_MIN,
		};
	}

	/**
	 * The lever's THROTTLE loop: while the handle is held, scroll by `joystickVelocity(deflection)`
	 * every frame, where the deflection is how far the pointer has travelled from where it grabbed.
	 *
	 * This is what makes the gesture rate-based rather than positional, and it is what makes it
	 * infinite: a position mapping runs out of track at the end of a finite bar, while a throttle held
	 * open keeps going for as long as it is held. The bar therefore no longer needs a separate
	 * "past the edge" mode — the whole gesture is the mode the edge used to be a special case of, and
	 * `core/chrome.ts` holds the one ramp both bars answer through.
	 */
	function tickLever(now: number): void {
		const cur = gesture.peek();
		if (!cur || cur.kind !== "bar") {
			barLeverRaf.current = null;
			barLeverAt.current = -1;
			return;
		}
		// The FIRST frame of a run only establishes the clock. Seeding it at scheduling time would mix
		// timestamp origins with rAF's and integrate a bogus opening step — the same reason
		// `createSpring` does this, restated because it is the same mistake.
		if (barLeverAt.current < 0) barLeverAt.current = now;
		const dt = now - barLeverAt.current;
		barLeverAt.current = now;
		// `leverScrollDelta` caps `dt` itself, so a tab resumed after a minute does not integrate the
		// whole gap in one jump.
		const delta = leverScrollDelta(cur.pointerY - cur.grabY, dt);
		if (delta !== 0) viewport.scrollBy(delta);
		barLeverRaf.current = globalThis.requestAnimationFrame?.(tickLever) ?? null;
	}
	function startLever(): void {
		if (barLeverRaf.current == null) {
			barLeverAt.current = -1;
			barLeverRaf.current = globalThis.requestAnimationFrame?.(tickLever) ?? null;
		}
	}
	function stopLever(): void {
		if (barLeverRaf.current != null) {
			globalThis.cancelAnimationFrame?.(barLeverRaf.current);
			barLeverRaf.current = null;
		}
		barLeverAt.current = -1;
	}

	/**
	 * Ctrl/Meta + wheel: zoom ANCHORED on the cursor.
	 *
	 * It lives here rather than on the island's ancestor element — which still owns the zoom SCALE and
	 * still listens, for the chrome outside the grid — because only this component can map a pointer
	 * into its own scene, and the whole point of the gesture is that the timestamp under the cursor
	 * does not move. The anchor is pinned first, then the scale change is asked for; the viewport
	 * re-solves the offset from the pinned minute on every frame of the interpolation, so the fixed
	 * point holds for the whole journey rather than only for its first and last frames.
	 */
	useEffect(() => {
		props.registerZoom?.((target, opts) => viewport.zoomTo(target, opts));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [props.registerZoom]);

	useEffect(() => {
		const el = viewport.hostRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (!(e.ctrlKey || e.metaKey) || !props.onZoom) return;
			e.preventDefault();
			// Stopped here so the island's own ancestor listener does not zoom a second time for one notch.
			e.stopPropagation();
			viewport.zoomAnchor(viewport.pointerAt(e).y);
			props.onZoom(e.deltaY < 0 ? "in" : "out");
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [props.onZoom]);

	/**
	 * A logical canvas rect as a VIEWPORT (client) rect — what the HTML popover layer anchors to.
	 *
	 * The mirror is re-applied here because logical x grows from the inline start while a client x
	 * grows from the left edge of the window, and `pointerAt` already undid the same mirror on the way
	 * in. Doing it in one place at each boundary is what keeps a right-to-left surface from needing a
	 * second set of geometry.
	 */
	function anchorFor(rect: { x: number; y: number; w: number; h: number }): EventPopoverAnchor {
		const el = viewport.hostRef.current;
		if (!el) return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
		const box = el.getBoundingClientRect();
		const physicalX = viewport.rtl.peek() ? box.width - rect.x - rect.w : rect.x;
		return { x: box.left + physicalX, y: box.top + rect.y, w: rect.w, h: rect.h };
	}

	/**
	 * A card's CURRENT canvas-space rect — what an anchor is derived from when the activation did not
	 * come from a pointer and so carries no coordinates of its own.
	 *
	 * The keyboard has no cursor, but the popover still has to point at something, and the card the
	 * reader just activated is the honest answer.
	 */
	function cardRect(card: SceneEvent): Rect {
		const gutter = viewport.gutter.peek();
		const width = viewport.viewportW.peek();
		const colW = blockDays > 0 ? Math.max(0, width - gutter) / blockDays : 0;
		return eventRect(card, { gutter, colW }, viewport.scrollTop.peek());
	}

	/** Every event in one cluster, in start order — what the stack popover lists. */
	function clusterEvents(clusterId: string): CalendarEvent[] {
		const seen = new Set<string>();
		const out: CalendarEvent[] = [];
		for (const card of sceneRef.current.events ?? []) {
			if (card.clusterId !== clusterId || seen.has(card.eventId)) continue;
			const source = eventById.get(card.eventId);
			if (!source) continue;
			seen.add(card.eventId);
			out.push(source);
		}
		return out.sort((a, b) => a.start - b.start);
	}

	/**
	 * Open the popover for a card, or fall through to {@link TimeGridProps.onOpenEvent}.
	 *
	 * A card standing for a whole cluster opens the LIST first: a click on a card that represents
	 * several events cannot honestly resolve to just one of them, so the reader is asked which. A card
	 * standing only for itself opens directly. A host that passes no popover signal keeps the older
	 * behaviour unchanged — the popover is an addition, not a toll gate.
	 */
	function openCard(card: SceneEvent, rect: { x: number; y: number; w: number; h: number }): void {
		const source = eventById.get(card.eventId);
		if (!source) return;
		const layer = props.popover;
		if (!layer) {
			props.onOpenEvent?.(source);
			return;
		}
		const anchor = anchorFor(rect);
		if (card.foldedCount > 0) {
			const events = clusterEvents(card.clusterId);
			if (events.length > 1) {
				layer.value = { kind: "stack", events, anchor, clusterId: card.clusterId };
				return;
			}
		}
		layer.value = { kind: "event", event: source, anchor };
	}

	/**
	 * Ends whatever gesture is in flight and detaches its listeners; null when none is.
	 *
	 * They live on `globalThis` so a drag survives the pointer leaving the viewport — which means an
	 * unmount mid-drag does not take them with it either. This handle is what does.
	 */
	const endGesture = useRef<(() => void) | null>(null);
	useEffect(() => {
		return () => {
			endGesture.current?.();
			stopLever();
		};
	}, []);

	/*
	 * KEEP THE COMPOSER ATTACHED TO THE DRAFT BLOCK.
	 *
	 * A popover anchor is a client-space SNAPSHOT taken when it opened, so anything that moves what it
	 * points at leaves it pointing at empty grid: scrolling, zooming, resizing the window, and — the
	 * reason this exists at all — a host RE-OPENING the composer after minimising its full surface,
	 * which cannot supply an anchor because only this component knows where the range currently lands.
	 *
	 * It re-anchors from `draftRect`, the same function the hit test resolves the block through, so the
	 * panel points at the box the reader can actually grab. A gesture in flight is skipped: the move
	 * handler is already publishing an anchor per pointer move, and two writers on one value fight.
	 */
	useSignalEffect(() => {
		const layer = props.popover;
		if (!layer) return;
		// Subscribed deliberately — these are what MOVE the block under a fixed anchor.
		viewport.scrollTop.value;
		viewport.viewportW.value;
		viewport.viewportH.value;
		pxPerHour.value;
		props.draft?.value;
		if (gesture.peek() !== null) return;
		const shown = layer.peek();
		if (shown?.kind !== "create") return;
		const rect = draftRect(currentScene(), viewBox(), metrics());
		if (!rect) return;
		const next = anchorFor(rect);
		const a = shown.anchor;
		if (a.x === next.x && a.y === next.y && a.w === next.w && a.h === next.h) return;
		layer.value = { ...shown, anchor: next };
	});

	/*
	 * WAS A POPOVER OPEN WHEN THIS PRESS STARTED? — the click-away shield's one input.
	 *
	 * It has to be a latch written from a CAPTURE listener rather than a read inside `onPointerDown`,
	 * because `useDismiss` also listens on `document` in the capture phase and has already cleared the
	 * signal by the time a bubble-phase JSX handler runs. Registration order decides between two
	 * capture listeners on the same node, and this one is registered at MOUNT while the layer's is
	 * registered only once a popover opens — so this always runs first, and always sees the truth.
	 *
	 * It is reset on `pointerup` rather than at the end of the press handler: `beginTouch`'s tap path
	 * resolves on release, and clearing it earlier would let a tap that dismissed a panel also create.
	 */
	const popoverWasOpen = useRef(false);
	useEffect(() => {
		if (typeof document === "undefined") return;
		const onDown = (e: PointerEvent) => {
			popoverWasOpen.current = (props.popover?.peek() ?? null) !== null;
			/*
			 * And, in the same pass, claim a press that lands on the DRAFT BLOCK.
			 *
			 * It has to be decided HERE for the ordering reason above: `useDismiss` runs on the next
			 * document capture listener and has to see the answer already. Only a press ON the viewport
			 * can qualify — a press in the panel itself is the panel's own business and the containment
			 * model already handles it.
			 */
			const guard = props.pointerGuard;
			if (!guard) return;
			const host = viewport.hostRef.current;
			const target = e.target as Node | null;
			if (!host || !target || !host.contains(target)) return;
			const { x, y } = viewport.pointerAt(e);
			guard.value = hitTest(currentScene(), viewBox(), metrics(), x, y).kind === "draft";
		};
		const onUp = () => {
			popoverWasOpen.current = false;
			if (props.pointerGuard) props.pointerGuard.value = false;
		};
		document.addEventListener("pointerdown", onDown, true);
		globalThis.addEventListener("pointerup", onUp);
		globalThis.addEventListener("pointercancel", onUp);
		return () => {
			document.removeEventListener("pointerdown", onDown, true);
			globalThis.removeEventListener("pointerup", onUp);
			globalThis.removeEventListener("pointercancel", onUp);
		};
	}, [props.popover, props.pointerGuard]);

	/** Track a gesture to its end on `globalThis`, so it survives the pointer leaving the viewport. */
	function trackGesture(commit: (g: Gesture) => void): void {
		const move = (ev: PointerEvent) => {
			const cur = gesture.peek();
			if (!cur) return;
			const { x, y } = viewport.pointerAt(ev);
			if (cur.kind === "create") {
				// Local to the block the drag STARTED in, and clamped to it: a drag that runs past midnight
				// extends to the seam rather than wrapping round to the next period's small hours.
				const local = axisMinuteAt(y) - cur.blockIndex * BLOCK_MIN;
				const to = snapMinutes(Math.max(0, Math.min(BLOCK_MIN, local)), SNAP);
				gesture.value = { ...cur, to };
				// The quick-create popover follows the selection rather than waiting for the release: the
				// reader is looking at where they are dragging, which is the only place it can usefully be.
				const layer = props.popover;
				if (layer && layer.peek()?.kind === "create") {
					layer.value = {
						kind: "create",
						range: selectionRange(cur.dayStart, cur.from, to, SNAP),
						anchor: anchorFor({ x, y, w: 1, h: 1 }),
					};
				}
			} else if (cur.kind === "move") {
				const slot = slotAt(x, y);
				gesture.value = {
					...cur,
					moved: cur.moved || Math.abs(ev.clientY - cur.originY) >= DRAG_THRESHOLD,
					column: slot.column,
					blockIndex: slot.blockIndex,
					dayStart: slot.dayStart,
					startMin: snapMinutes(Math.max(0, slot.local - cur.grabOffset), SNAP),
				};
			} else if (cur.kind === "draft") {
				/*
				 * The draft. Its two edges move independently and its body moves both at once, and every
				 * branch stays inside the block the draft started in — a drag past midnight stops at the
				 * seam rather than wrapping into the next period's small hours, exactly as `create` does.
				 */
				const local = axisMinuteAt(y) - cur.blockIndex * BLOCK_MIN;
				const at = snapMinutes(Math.max(0, Math.min(BLOCK_MIN, local)), SNAP);
				let next = cur;
				if (cur.edge === "body") {
					const span = cur.to - cur.from;
					// The START is clamped so the whole block stays inside the day; the end then follows it,
					// so a dragged draft keeps the duration the reader gave it instead of being squashed
					// against the seam.
					const from = Math.max(0, Math.min(BLOCK_MIN - span, at - cur.grabOffset));
					next = { ...cur, from: snapMinutes(from, SNAP), to: snapMinutes(from, SNAP) + span };
				} else if (cur.edge === "start") {
					// SNAP below the far edge, never at or past it: a zero-length draft is a deadline, and
					// resizing a range is not how the reader says they meant to create one.
					next = { ...cur, from: Math.min(at, cur.to - SNAP) };
				} else {
					next = { ...cur, to: Math.max(at, cur.from + SNAP) };
				}
				gesture.value = next;
				// The popover's own time fields read the SAME range, so they track the drag live rather
				// than catching up on release — which is what "keeping the timestamp inputs synced" means.
				props.draft && (props.draft.value = draftRangeOf(next));
				const layer = props.popover;
				if (layer && layer.peek()?.kind === "create") {
					const prev = layer.peek() as Extract<EventPopoverState, { kind: "create" }>;
					layer.value = { ...prev, range: draftRangeOf(next), anchor: anchorFor(hitRectOf(next)) };
				}
			} else {
				// The lever only ever records WHERE the pointer is. How fast that scrolls is `tickLever`'s
				// answer, once per frame — so the speed is a function of time held rather than of how many
				// pointer events the device happened to deliver.
				if (y !== cur.pointerY) {
					gesture.value = { ...cur, pointerY: y };
					lastLever.current = { grabY: cur.grabY, pointerY: y };
				}
			}
		};
		/**
		 * `keep` is what separates a release from an abort. A `pointercancel` — the browser claiming
		 * the gesture, most often a second finger arriving for a pinch — and an UNMOUNT are both
		 * aborts: committing either would hand the host a range the reader never finished asking for,
		 * or call `onSelectRange` on a component that no longer exists.
		 */
		const finish = (keep: boolean) => {
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", up);
			globalThis.removeEventListener("pointercancel", cancel);
			endGesture.current = null;
			stopLever();
			const cur = gesture.peek();
			gesture.value = null;
			barActive.value = false;
			if (cur && keep) commit(cur);
		};
		const up = () => finish(true);
		const cancel = () => finish(false);
		endGesture.current = cancel;
		globalThis.addEventListener("pointermove", move);
		globalThis.addEventListener("pointerup", up);
		globalThis.addEventListener("pointercancel", cancel);
	}

	/**
	 * A touch: the drag SCROLLS and a tap activates.
	 *
	 * The viewport has no scroll container, so a finger that fell through to drag-to-create would
	 * leave the Week grid unscrollable on every phone. Drag-to-create and drag-to-move stay
	 * pointer-device gestures — a touch surface has no way to distinguish "I meant to draw a range"
	 * from "I meant to scroll" at the moment the finger lands, and scrolling is the one that must
	 * never be guessed wrong.
	 */
	function beginTouch(ev: PointerEvent): void {
		viewport.beginPan(ev);
		const originY = ev.clientY;
		const originX = ev.clientX;
		const at = viewport.pointerAt(ev);
		const detach = () => {
			globalThis.removeEventListener("pointerup", up);
			globalThis.removeEventListener("pointercancel", cancel);
			endGesture.current = null;
		};
		const up = (e: PointerEvent) => {
			detach();
			const travelled = Math.hypot(e.clientX - originX, e.clientY - originY);
			if (travelled >= DRAG_THRESHOLD) return;
			// A tap. Resolved against the scene as it was when the finger LANDED, because the pan may
			// have moved the offset a pixel or two under it in the meantime.
			const hit = hitTest(currentScene(), viewBox(), metrics(), at.x, at.y);
			if (hit.kind === "present") viewport.scrollToNow(scrollBehaviorFor());
			// One target, one action: the chip and the merged card it sits on both expand the cluster
			// AND open its list. See the pointer path's own note.
			else if (hit.kind === "badge") openCard(hit.event, hit.rect);
			else if (hit.kind === "event") openCard(hit.event, hit.rect);
			// The click-away shield (§2), on the touch path too: a tap that dismisses an open popover
			// dismisses it and does nothing else. A card tap is deliberately still live — moving between
			// events is navigation, not a click-away, and blocking it would cost two taps per event.
			else if (popoverWasOpen.current) return;
			else if (hit.kind === "grid" && props.canCreate) {
				const slot = slotAt(at.x, at.y);
				const from = snapMinutes(Math.max(0, Math.min(BLOCK_MIN, slot.local)), SNAP);
				props.onSelectRange?.(selectionRange(slot.dayStart, from, from, SNAP));
			}
		};
		const cancel = () => detach();
		endGesture.current = cancel;
		globalThis.addEventListener("pointerup", up);
		globalThis.addEventListener("pointercancel", cancel);
	}

	function onPointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const ev = e as unknown as PointerEvent;
		if (ev.pointerType === "touch") {
			// Only the FIRST finger. A second one is the browser's — it is arriving for a pinch — and
			// tracking it here would register a second tap watcher whose release fires alongside the
			// first's, activating whatever the primary finger happened to be over twice.
			if (ev.isPrimary !== false) beginTouch(ev);
			return;
		}
		// Middle-button and Ctrl/Meta + left are the PAN gesture, unchanged — claimed before anything
		// else, so a pan started over a card is still a pan.
		if (viewport.beginPan(ev)) return;
		if (ev.button !== 0) return;
		const { at, hit } = hitAt(ev);

		if (hit.kind === "present") {
			viewport.scrollToNow(scrollBehaviorFor());
			return;
		}
		if (hit.kind === "scrollbar") {
			e.preventDefault();
			barActive.value = true;
			lastLever.current = { grabY: at.y, pointerY: at.y };
			gesture.value = { kind: "bar", grabY: at.y, pointerY: at.y, frozen: hit.rect.h };
			// The handle becomes a ball for as long as it is held, and the throttle runs from the moment
			// of the grab rather than from the first move — a lever held still is a lever at rest, which
			// `joystickVelocity` already reports as zero.
			morphSpring.set(1);
			startLever();
			trackGesture(() => {
				morphSpring.set(0);
			});
			return;
		}

		/*
		 * The `+N` chip. Drawn ON the card and hit BEFORE it, so a press meant to open a fold does not
		 * open whichever card happened to be on top of it.
		 *
		 * It routes through `openCard` rather than straight to `onUnfold`, so the chip and the merged
		 * card it sits on are ONE control with one outcome: the cluster expands and its list opens
		 * together. They were two — the chip expanded silently while the card opened a list that did
		 * not expand anything — which meant the reader had two ways to ask the same question and got a
		 * different half of the answer from each.
		 */
		if (hit.kind === "badge") {
			e.preventDefault();
			openCard(hit.event, hit.rect);
			return;
		}
		/*
		 * THE DRAFT. Hit after the cards and before the grid — a press inside a block the reader is
		 * still composing is never a request to start composing a second one.
		 */
		if (hit.kind === "draft" && props.draft) {
			const range = props.draft.peek();
			if (range) {
				e.preventDefault();
				const slot = slotAt(at.x, at.y);
				const from = Math.round((range.start - slot.dayStart) / MIN);
				const to = Math.round((range.end - slot.dayStart) / MIN);
				gesture.value = {
					kind: "draft",
					edge: hit.edge,
					from,
					to,
					column: slot.column,
					dayStart: slot.dayStart,
					blockIndex: slot.blockIndex,
					grabOffset: Math.max(0, slot.local - from),
				};
				trackGesture((cur) => {
					if (cur.kind !== "draft") return;
					// The draft SURVIVES the release. It is committed by the popover's own submit, not by
					// letting go of it — a reader adjusting the time twice before typing a title must not
					// have their event created out from under them on the first release.
					props.draft && (props.draft.value = draftRangeOf(cur));
				});
				return;
			}
		}

		if (hit.kind === "event") {
			const card = hit.event;
			const source = eventById.get(card.eventId);
			if (!source) return;
			e.preventDefault();
			const cardStart = minAt(card.y);
			const blockIndex = Math.floor(cardStart / BLOCK_MIN);
			gesture.value = {
				kind: "move",
				card,
				source,
				grabOffset: Math.max(0, axisMinuteAt(at.y) - cardStart),
				// A point in time keeps its zero length when it is moved. The `SNAP` floor below exists so
				// a five-minute meeting stays a target rather than a hairline; applying it to a deadline
				// would hand the host a fifteen-minute event where it gave the engine a moment, and the
				// host would be right to save it.
				durationMin: card.instant ? 0 : Math.max(SNAP, (source.end - source.start) / MIN),
				column: card.column,
				blockIndex,
				dayStart: card.dayStart,
				startMin: cardStart - blockIndex * BLOCK_MIN,
				originY: ev.clientY,
				moved: false,
			};
			trackGesture((cur) => {
				if (cur.kind !== "move") return;
				// A press that did not travel is a CLICK — the card opens, exactly as it did when it was a
				// button. Only a real drag rearranges, and only where the host gave it somewhere to land.
				if (!cur.moved || !props.onMoveEvent) {
					openCard(cur.card, hit.rect);
					return;
				}
				const start = cur.dayStart + cur.startMin * MIN;
				props.onMoveEvent(cur.source, { start, end: start + cur.durationMin * MIN });
			});
			return;
		}
		/*
		 * THE CLICK-AWAY SHIELD (§2).
		 *
		 * A press on empty grid while a popover is open DISMISSES it and does nothing else. Without
		 * this, dismissing a panel by clicking past it also drew a fresh selection and opened a
		 * quick-create — so "get this out of my way" produced another thing in the way, which is the
		 * worst possible answer to it.
		 *
		 * WHY A LATCH AND NOT A READ. `useDismiss` binds its outside-pointer listener on `document` in
		 * the CAPTURE phase, and this handler is a JSX handler on the viewport, which is the bubble
		 * phase — so by the time we run, the layer has already cleared the signal and reading it here
		 * would always report "nothing was open". `popoverWasOpen` is written by our OWN document
		 * capture listener, registered at MOUNT and therefore ahead of the layer's, which only
		 * registers once a popover actually opens. Two capture listeners on one node fire in
		 * registration order, so ours is always first and always sees the truth.
		 *
		 * Dismissal itself stays the layer's job — it is the single owner of that fact, and a second
		 * closer would be two owners fighting over one signal.
		 */
		if (popoverWasOpen.current) return;

		if (hit.kind === "grid" && props.canCreate) {
			e.preventDefault();
			const slot = slotAt(at.x, at.y);
			const from = snapMinutes(Math.max(0, Math.min(BLOCK_MIN, slot.local)), SNAP);
			gesture.value = {
				kind: "create",
				column: slot.column,
				dayStart: slot.dayStart,
				blockIndex: slot.blockIndex,
				from,
				to: from + 30,
			};
			if (props.popover) {
				props.popover.value = {
					kind: "create",
					range: selectionRange(slot.dayStart, from, from + 30, SNAP),
					anchor: anchorFor({ x: at.x, y: at.y, w: 1, h: 1 }),
				};
			}
			trackGesture((cur) => {
				if (cur.kind !== "create") return;
				const range = selectionRange(cur.dayStart, cur.from, cur.to, SNAP);
				/*
				 * THE DRAFT SURVIVES THE RELEASE. `scene.selection` is derived from the live gesture, so
				 * without this the block the reader just drew vanishes the instant they let go and the
				 * popover ends up pointing at empty grid. Publishing the range keeps the block on the
				 * grid — now dashed, now grabbable — until the popover commits it or is dismissed.
				 */
				if (props.draft) props.draft.value = range;
				// `onSelectRange` still fires on release exactly as it always did — a host that only wants
				// to be TOLD about a range keeps working unchanged, and a host that can create one inline
				// gets the popover's own submit as well.
				props.onSelectRange?.(range);
				const layer = props.popover;
				if (layer && layer.peek()?.kind === "create") {
					layer.value = { kind: "create", range, anchor: layer.peek()!.anchor };
				}
			});
		}
	}

	function onPointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		// Hover is not a state a finger has. Without this, a touch DRAG would leave a card stuck in its
		// hovered state under the moving finger — and the gauge-reveal below is a hover affordance whose
		// whole premise is a pointer that can rest somewhere without pressing.
		if ((e as unknown as PointerEvent).pointerType === "touch") return;
		if (gesture.peek()) return;
		const ev = e as unknown as PointerEvent;
		const { at, hit } = hitAt(ev);
		const next = hit.kind === "event" || hit.kind === "badge" ? hit.event.id : null;
		// Written only when the hovered CARD changes, not on every pointer move: hover is a property of
		// the card rather than of the cursor's exact position, so following the pointer would cost a
		// render per move to redraw an identical frame.
		if (next !== hoverId.peek()) {
			hoverId.value = next;
			retargetHover(next, hit.kind === "event" || hit.kind === "badge" ? hit.event : null);
		}
		// The gauge's own region, asked for directly rather than through the hit test: hovering it is
		// what fades it back IN, and the hit test deliberately reports nothing there while it is
		// invisible so a press cannot grab a handle the reader cannot see.
		const gauge = scrollbarHitRect(currentScene(), viewBox(), metrics());
		const overBar = !!gauge && inRect(gauge, at.x, at.y);
		if (overBar !== barActive.peek()) barActive.value = overBar;
		if ((hit.kind === "present") !== pillHover.peek()) pillHover.value = hit.kind === "present";
	}

	function onPointerLeave(): void {
		if (gesture.peek()) return;
		hoverId.value = null;
		retargetHover(null, null);
		barActive.value = false;
		pillHover.value = false;
	}

	/**
	 * Point the hover spring at whatever the cursor is now over.
	 *
	 * The EXPANSION is asked of the painter rather than guessed at here — `hoverExpansionFor` is
	 * derived from the same content ladder that decides what a card omits, so the card grows by
	 * exactly the height of what it was hiding and never by a round number that happens to look about
	 * right. A card hiding nothing expands by nothing, which is why a hover over a spacious card is
	 * still just a tint.
	 *
	 * Entering is {@link SPRING_SNAPPY} and arrives without overshoot. LEAVING is the one sanctioned
	 * bouncy spring in the product — see {@link HOVER_EXIT_SPRING}.
	 */
	function retargetHover(id: string | null, card: SceneEvent | null): void {
		if (!id || !card) {
			hoverSpring.set(0, SPRING_EXPRESSIVE_EXIT);
			return;
		}
		const palette = canvasApi.current?.palette() ?? null;
		hoverSpring.set(palette ? hoverExpansionFor(card, palette) : 0);
	}

	/**
	 * What the pointer is over, as a cursor. It is the only affordance a canvas can offer before a
	 * press — there are no elements to carry a `cursor` of their own.
	 */
	const cursor = live?.kind === "move"
		? "grabbing"
		: viewport.panning.value
		? "grabbing"
		: barActive.value || pillHover.value
		? "pointer"
		: hoverId.value
		? "pointer"
		: props.canCreate
		? "cell"
		: "default";
	// #endregion

	// #region The accessible layer
	function focusCard(card: SceneEvent): void {
		focusId.value = card.id;
		// HOLD the card's block in the layout window. The region's own instructions advertise Page Up /
		// Page Down, those keys bubble from this very button, and without the hold the first page would
		// unmount the element under focus — dropping focus to `<body>`, where the advertised keys scroll
		// the document instead of the grid.
		focusBlockHeld.value = Math.floor(minAt(card.y) / BLOCK_MIN);
		viewport.reveal(card.y, card.y + card.h);
	}
	function blurCard(): void {
		focusId.value = null;
		focusBlockHeld.value = null;
	}

	/**
	 * Create an event from the keyboard, at the top of what is on screen.
	 *
	 * Drag-to-create is a pointer gesture and has no keyboard equivalent — it was pointer-only before
	 * this viewport was pixels too, but a capability reachable by one input device only is the gap
	 * whether or not it predates the change. The slot is the first snapped quarter-hour in view, in
	 * the FOCUSED period's first column, so the host's own dialog opens on something the reader can
	 * see and adjust rather than on a guess about where they meant to point.
	 */
	function createFromKeyboard(): void {
		const slot = slotAt(gutterW + 1, 0);
		const from = snapMinutes(Math.max(0, Math.min(BLOCK_MIN, slot.local)), SNAP);
		props.onSelectRange?.(selectionRange(slot.dayStart, from, from, SNAP));
	}

	/**
	 * What is on screen, in words, quantised to the HOUR.
	 *
	 * A canvas viewport has no scroll container, so the implicit feedback a screen reader gets from
	 * scrolling one is gone. A computed only notifies when its VALUE changes, so this announces once
	 * per hour crossed rather than once per pixel.
	 */
	const visibleRange = useComputed(() => {
		const h = viewport.viewportH.value;
		if (h <= 0) return "";
		const t = viewport.scrollTop.value;
		const from = Math.floor(minAt(t) / 60) * 60;
		const to = Math.ceil(minAt(t + h) / 60) * 60;
		/*
		 * An axis minute is NOT elapsed time. One block is 24 hours of AXIS but a whole period of
		 * calendar — a week, laid out as columns — so `refStart + minutes` would report the second block
		 * as Tuesday when it is the following Monday. The block has to be resolved first and the
		 * remainder added inside it.
		 */
		const at = (m: number) => {
			const block = Math.floor(m / BLOCK_MIN);
			return blockStartOf(block) + (m - block * BLOCK_MIN) * MIN;
		};
		return `Showing ${fmtDayLabel(at(from), tz)} ${fmtTime(at(from), tz, hour12)} to ${
			fmtDayLabel(at(to), tz)
		} ${fmtTime(at(to), tz, hour12)}`;
	});
	// #endregion

	const hasAllDay = props.events.some((e) =>
		e.allDay && days.some((d) => e.start < d + DAY && e.end > d)
	);
	const colTemplate = `repeat(${blockDays}, minmax(0, 1fr))`;
	const first = days[0] ?? refStart;
	const last = days[days.length - 1] ?? refStart;
	const periodLabel = blockDays === 1
		? fmtDayLabel(first, tz)
		: `${fmtDayLabel(first, tz)} – ${fmtDayLabel(last, tz)}`;

	return (
		<div class="cal-tg">
			{/* Column header row — the FOCUSED block's days, tracked to the scroll centre. */}
			<div class="cal-tg__head">
				<div class="cal-tg__gutter-head" aria-hidden="true" />
				<div class="cal-tg__headcols" style={styleVars({ "--cal-cols": colTemplate })}>
					{days.map((d) => {
						const today = todayMs != null && sameZonedDay(d, todayMs, tz);
						return (
							<div key={d} class={cx("cal-tg__daycell", today && "cal-tg__daycell--today")}>
								<span class="cal-tg__daydow">{weekdayLabels()[(zonedWeekday(d, tz) + 6) % 7]}</span>
								<span class="cal-tg__daynum">{zonedDayNum(d, tz)}</span>
							</div>
						);
					})}
				</div>
			</div>

			{/* All-day lane — OUTSIDE the canvas viewport, so its chips stay real DOM cards. */}
			{hasAllDay
				? (
					<div class="cal-tg__allday">
						<div class="cal-tg__gutter-head cal-tg__allday-label">All-day</div>
						<div class="cal-tg__headcols" style={styleVars({ "--cal-cols": colTemplate })}>
							{days.map((d) => (
								<div key={d} class="cal-tg__allday-col">
									{props.events
										.filter((e) => e.allDay && e.start < d + DAY && e.end > d)
										.map((e) => (
											<EventBlock
												key={e.id}
												event={e}
												tz={tz}
												hour12={hour12}
												compact
												renderSource={props.renderSource}
												onOpen={props.onOpenEvent}
											/>
										))}
								</div>
							))}
						</div>
					</div>
				)
				: null}

			{
				/*
				 * The viewport. Its ONLY child is the canvas — no scroll container, no day columns, no
				 * event cards, no now-line element, no scrollbar track. The hour scale's width is a real
				 * `padding-inline-start`, which is both how the space is reserved and how it is MEASURED:
				 * a custom property computes to its authored token, never to a length.
				 */
			}
			<div
				class="cal-tg__viewport"
				data-cursor={cursor}
				ref={viewport.hostRef}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerLeave={onPointerLeave}
			>
				<canvas ref={canvasRef} class="cal-tg__canvas" aria-hidden="true" />
			</div>

			{/* The palette probe — a SIBLING, so the viewport above stays genuinely empty. */}
			<GridProbe probeRef={probeRef} accents={accents} scene />

			{
				/*
				 * THE ACCESSIBLE LAYER. Everything the canvas draws that a reader can act on, as real
				 * focusable elements: the same events, with the same names, firing the same handlers.
				 * Visually hidden, because the drawing is already on screen — a sighted keyboard reader is
				 * shown their position by the focus ring the canvas paints for `focusId`.
				 */
			}
			<div
				class="cal-tg__a11y"
				role="region"
				aria-label={`Time grid, ${periodLabel}`}
				tabIndex={0}
				onKeyDown={(e) => viewport.handleKey(e as unknown as KeyboardEvent)}
				// The region is a focus stop with no pixels of its own — it is clipped to 1px, so its own
				// `:focus-visible` outline is invisible — and it owns Arrow/Page/Home/End. The canvas
				// paints the ring instead, or a keyboard reader lands on the control that scrolls the
				// grid with nothing at all telling them they have (WCAG 2.4.7).
				onFocus={() => (regionFocus.value = true)}
				onBlur={() => (regionFocus.value = false)}
			>
				<p>
					Arrow keys scroll the grid, Page Up and Page Down move a screen at a time, Home and End
					jump to the ends of the range. Tab moves through the events on screen.
				</p>
				<p role="status" aria-live="polite">{visibleRange.value}</p>
				{
					/*
					 * The two grid-wide controls come BEFORE the event list. Placed after it they cost one
					 * Tab per card on screen — up to twenty — to reach a control that used to be a single
					 * visible button, which is a real ordering regression rather than a cosmetic one.
					 */
				}
				{viewport.awayFromNow.value
					? (
						<button
							type="button"
							class="cal-tg__a11yitem"
							onFocus={() => (pillFocus.value = true)}
							onBlur={() => (pillFocus.value = false)}
							onClick={() => viewport.scrollToNow(scrollBehaviorFor())}
						>
							Return to now
						</button>
					)
					: null}
				{props.canCreate && props.onSelectRange
					? (
						<button type="button" class="cal-tg__a11yitem" onClick={createFromKeyboard}>
							Create an event at the top of the visible range
						</button>
					)
					: null}
				<ul class="cal-tg__a11ylist">
					{cards.map((card) => {
						const name = eventAccessibleName(card, fmtDayLabel(card.dayStart, tz));
						const source = eventById.get(card.eventId);
						return (
							<li key={card.id}>
								{(props.onOpenEvent || props.popover) && source
									? (
										<button
											type="button"
											class="cal-tg__a11yitem"
											onFocus={() => focusCard(card)}
											onBlur={blurCard}
											// The SAME entry point the pointer uses, not a shortcut past it. A keyboard
											// reader who activates a stacked card must be asked which member they meant
											// for the same reason a pointer reader is — and if the two paths diverged the
											// accessible layer would stop being the canvas's content and start being a
											// second, quieter product.
											onClick={() => openCard(card, cardRect(card))}
										>
											{name}
										</button>
									)
									: <span>{name}</span>}
							</li>
						);
					})}
				</ul>
			</div>
		</div>
	);
}

// #region Scene helpers
/** The drag preview for whichever gesture is live, or null. */
function previewFor(
	g: Gesture | null,
	pph: number,
	tz: string,
	hour12: boolean,
	yFor: (m: number) => number,
): SceneSelection | null {
	if (!g) return null;
	if (g.kind === "create") {
		const lo = Math.min(g.from, g.to);
		const hi = Math.max(g.from, g.to);
		return {
			column: g.column,
			y: yFor(g.blockIndex * BLOCK_MIN + lo),
			h: Math.max(((hi - lo) / 60) * pph, 6),
			text: `${fmtTime(g.dayStart + lo * MIN, tz, hour12)} – ${
				fmtTime(g.dayStart + Math.max(hi, lo + SNAP) * MIN, tz, hour12)
			}`,
		};
	}
	if (g.kind === "move") {
		const start = g.dayStart + g.startMin * MIN;
		return {
			column: g.column,
			y: yFor(g.blockIndex * BLOCK_MIN + g.startMin),
			h: Math.max((g.durationMin / 60) * pph, DRAFT_MIN_H),
			text: `${fmtTime(start, tz, hour12)} – ${fmtTime(start + g.durationMin * MIN, tz, hour12)}`,
		};
	}
	if (g.kind === "draft") {
		// A draft in flight is NOT drawn dashed: it is the direct shape of what the reader's hand is
		// doing right now, and describing that as provisional would be describing the wrong thing.
		return draftPreview(g.dayStart, g.blockIndex, g.column, g.from, g.to, pph, tz, hour12, yFor);
	}
	return null;
}

/**
 * The resting DRAFT block — the dashed rectangle a quick-create leaves on the grid once the pointer
 * has been released, positioned from the range rather than from a gesture.
 *
 * `null` whenever the draft's day is not one of the blocks currently rendered, which is the honest
 * answer: the reader has scrolled the draft's day out of the virtualisation window, and drawing it
 * against some other day's column would put a block on a date the reader never picked.
 */
function restingDraft(
	range: CalendarRange | null,
	specs: SceneColumnSpec[],
	tz: string,
	hour12: boolean,
	pph: number,
): SceneSelection | null {
	if (!range) return null;
	const spec = specs.find((c) => range.start >= c.dayStart && range.start < c.dayStart + DAY);
	if (!spec) return null;
	const from = Math.round((range.start - spec.dayStart) / MIN);
	// Clamped to the day the block starts in: a draft dragged past midnight stops at the seam, exactly
	// as the create gesture does, rather than wrapping into a column it is not drawn in.
	const to = Math.min(BLOCK_MIN, Math.round((range.end - spec.dayStart) / MIN));
	const lo = Math.min(from, to);
	const hi = Math.max(from, to);
	return {
		column: spec.column,
		// From the SPEC's own top rather than from a block index, so a draft in a held block — one the
		// window is carrying across a gap because it holds focus — lands where its column actually is.
		y: spec.top + (lo / 60) * pph,
		h: Math.max(((hi - lo) / 60) * pph, DRAFT_MIN_H),
		text: `${fmtTime(spec.dayStart + lo * MIN, tz, hour12)} – ${
			fmtTime(spec.dayStart + Math.max(hi, lo + SNAP) * MIN, tz, hour12)
		}`,
		draft: true,
	};
}

/**
 * The DRAFT block's preview rectangle — one builder for both the live gesture and the resting block.
 *
 * A resting draft and a draft being dragged are the same rectangle in the same place; only the dashes
 * differ. Deriving them from one function is what keeps the block from jumping a pixel at the moment
 * the reader grabs it, which is exactly the kind of thing a second copy would introduce and nothing
 * would catch.
 */
function draftPreview(
	dayStart: number,
	blockIndex: number,
	column: number,
	from: number,
	to: number,
	pph: number,
	tz: string,
	hour12: boolean,
	yFor: (m: number) => number,
	draft = false,
): SceneSelection {
	const lo = Math.min(from, to);
	const hi = Math.max(from, to);
	return {
		column,
		y: yFor(blockIndex * BLOCK_MIN + lo),
		h: Math.max(((hi - lo) / 60) * pph, DRAFT_MIN_H),
		text: `${fmtTime(dayStart + lo * MIN, tz, hour12)} – ${
			fmtTime(dayStart + Math.max(hi, lo + SNAP) * MIN, tz, hour12)
		}`,
		draft,
	};
}

// #endregion
