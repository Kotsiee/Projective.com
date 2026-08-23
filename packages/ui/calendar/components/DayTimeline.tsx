/**
 * @projective/ui/calendar — the Day view's INFINITE, virtualized continuous timeline (§Part 1.2). Unlike
 * the Week grid (7 bounded time-of-day columns), the Day view is one continuous vertical column of
 * stacked days: scrolling down flows seamlessly past midnight into the next day, up into the previous —
 * endlessly (a ±WINDOW_DAYS elapsed-time axis, so the scroll never hits a wall). Only the days
 * intersecting the viewport (plus an overscan) are rendered, so DOM cost stays fixed at any scroll
 * depth. Everything is positioned by ELAPSED minutes from a fixed reference midnight, and each day's
 * boundaries/labels come from zoned day arithmetic (`addZonedDays`), so it is DST-correct. The centred
 * day is reported back (`onFocusDayChange`) so the header label + mini-map track the scroll.
 *
 * Like the Week grid, the LATTICE — hour rules, day boundaries, working-hours bands — is described as
 * a {@link GridScene} and painted by one canvas ({@link GridCanvas}) pinned over the viewport rather
 * than emitted as 24 elements per rendered day. The hour LABELS stay in the DOM gutter: canvas text
 * answers to none of the accessibility token overlays and is invisible to assistive tech.
 *
 * THE CARDS, THOUGH, ARE REAL HTML — and that is the whole difficulty of this file. The Week grid is
 * pure canvas; this view is HYBRID, so the same two events have to READ the same whichever view the
 * reader opened. Every placement decision therefore comes from the SAME pure engine the canvas asks
 * (`core/layout.ts` → `packDayEvents`), and every geometric constant that is not a token is imported
 * from `core/scene-build.ts` rather than restated: a card's minimum height, the 1px gap taken off its
 * bottom edge, and the pointer band a zero-height pin is pressed by. Nothing here re-derives a number
 * the canvas already has an answer for.
 *
 * WHAT THE PLACEMENT ENGINE HANDS BACK, AND WHAT THIS VIEW DOES WITH IT:
 *
 *  - `solo`   — full band. The resting grid carries no horizontal offsets at all, because a column is
 *               a time axis and width is the one cue on it that does not mean anything.
 *  - `nested` — drawn INSIDE its parent, at the fractional inset the engine composed. Not re-derived
 *               from `--cal-nest-inset` here: the engine's fractions COMPOSE across depth (each level
 *               multiplies into its parent's share), and a CSS percentage applied per level would
 *               drift from the canvas's answer at depth two.
 *  - `split`  — side-by-side lanes, again straight from the insets.
 *  - `folded` — draws no pixels, and is counted by the surviving card's `+N` chip. It is STILL in the
 *               accessible layer: removing a card from the paint pass may never remove it from the
 *               layer a keyboard reaches (the merge gate the `.cal-tg__a11y` list exists for).
 *
 * An INSTANT (`end === start`) is a deadline. It reaches this file as `slot.instant`, carries no
 * height, and is drawn as a PIN rather than a box — never with a fabricated minimum duration.
 */
import type { JSX, VNode } from "preact";
import type { ReadonlySignal, Signal } from "@preact/signals";
import { batch, useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { Spring, SpringConfig } from "../../core/motion.ts";
import { createSpring, SPRING_EXPRESSIVE_EXIT, SPRING_SNAPPY } from "../../core/motion.ts";
import type { CalendarAvailability, CalendarEvent, CalendarRange } from "../core/types.ts";
import type { GridRegion, GridRule, GridScene, SceneRecede } from "../core/grid-paint.ts";
import type { EventPopoverState } from "./EventPopoverLayer.tsx";
import {
	addZonedDays,
	DAY,
	fmtDayLabel,
	fmtHourLabel,
	MIN,
	sameZonedDay,
	startOfDay,
	zonedWeekday,
} from "../core/time.ts";
import { edgeFor, effectiveAccent, onAccentFor } from "../core/kinds.ts";
import type { DaySlot } from "../core/layout.ts";
import { dayWindow, packDayEvents } from "../core/layout.ts";
import { EVENT_MIN_H, INSTANT_HIT_H, STACK_SHADOW_MAX } from "../core/scene-build.ts";
import { scrollBehaviorFor, useCalendarViewport } from "../hooks/useCalendarViewport.ts";
import { EventBlock } from "./EventBlock.tsx";
import { GridCanvas } from "./GridCanvas.tsx";
import { NowIndicator } from "./NowIndicator.tsx";
import { OverlayScrollbar } from "./OverlayScrollbar.tsx";
import { TodayIcon } from "./glyphs.tsx";

/** Half-window (days) each side of the mount-day — a ~4-year continuous axis; effectively infinite. */
const WINDOW_DAYS = 1500;
/**
 * Hard ceiling on rendered days. The window is derived from the measured viewport, so a degenerate
 * zoom (a standalone consumer passing a near-zero `pxPerHour`) could otherwise ask for thousands of
 * days. Virtualization exists to make DOM cost independent of the axis; a cap makes it independent of
 * the inputs too.
 */
const MAX_DAYS = 14;
/** Drag-select snapping (minutes). */
const SNAP = 15;

/**
 * The card hover EXIT spring, re-exported under the name this view's own tests address it by.
 *
 * It is DECLARED once, in `packages/ui/core/motion.ts`, so that "where can a bounce enter this
 * product" has exactly one answer — see {@link SPRING_EXPRESSIVE_EXIT} for the reasoning and the
 * scope of the exception.
 */
export const HOVER_EXIT_SPRING: SpringConfig = SPRING_EXPRESSIVE_EXIT;

// #region Hover controller
/**
 * The Day timeline's card-hover state, shared by every card and owned by exactly one of them at a time.
 *
 * `t` is a unitless progress rather than a pixel count so that a card with nothing to reveal still
 * gets the lift: the EXPANSION multiplies `t` by a measured target, while the scale and the ambient
 * shadow read `t` on its own. Both are RESOLVED numbers written into custom properties — never a CSS
 * transition — because a hidden or backgrounded tab freezes transitions, keyframes and rAF alike, and
 * a card's height is a fact rather than a decoration.
 */
interface CardHover {
	/** The `cardId` currently expanded, held through the exit until the spring has settled. */
	id: Signal<string | null>;
	/** Progress, `0` at rest and `1` fully expanded. May ring slightly below 0 on the way out. */
	t: ReadonlySignal<number>;
	/** How many pixels of clipped content the hovered card actually has to reveal. */
	target: Signal<number>;
	/** Take the hover, having measured how much this card has to show. */
	enter(cardId: string, targetPx: number): void;
	/** Release it. The card keeps `id` — and therefore its raised paint order — until the ring stops. */
	leave(): void;
}

function useCardHover(): CardHover {
	const id = useSignal<string | null>(null);
	const target = useSignal(0);
	const phase = useSignal<"idle" | "enter" | "exit">("idle");

	/*
	 * Two springs rather than one, because a spring's character is fixed at construction and the two
	 * directions have deliberately different ones. They hand off by POSITION: a re-entry mid-exit jumps
	 * the enter spring to wherever the exit spring had reached, so the card never teleports. Velocity is
	 * not carried across the handoff — the reversal is the reader's own gesture, and inheriting the
	 * outgoing speed would make a card the pointer came back to shoot past where it was asked to go.
	 */
	const springs = useRef<{ enter: Spring; exit: Spring } | null>(null);
	if (springs.current === null) {
		springs.current = {
			enter: createSpring(0, { config: SPRING_SNAPPY }),
			exit: createSpring(0, { config: HOVER_EXIT_SPRING, requireOverDamped: false }),
		};
	}
	const { enter, exit } = springs.current;

	// A spring holds a frame handle; leaving one running past unmount leaks a callback into a tree
	// that no longer exists.
	useEffect(() => () => {
		enter.dispose();
		exit.dispose();
	}, []);

	const t = useComputed(() => {
		const p = phase.value;
		if (p === "enter") return enter.value.value;
		if (p === "exit") return exit.value.value;
		return 0;
	});

	/*
	 * The exit's END is what releases the card's identity — not the pointer leaving it. Dropping `id`
	 * at `pointerleave` would drop the raised paint order and the ambient shadow one frame into a
	 * spring that is still visibly running, so the card would snap flat and then finish bouncing
	 * underneath its neighbours.
	 */
	useSignalEffect(() => {
		if (phase.value !== "exit" || !exit.settled.value) return;
		batch(() => {
			phase.value = "idle";
			id.value = null;
		});
	});

	return {
		id,
		t,
		target,
		enter(cardId: string, targetPx: number): void {
			const from = t.peek();
			// The outgoing spring is stopped rather than left to finish: nothing reads it once the phase
			// flips, so it would only be a frame loop running against a value the surface has stopped
			// looking at — and its eventual settle would fire the watcher above under a phase that is no
			// longer its own.
			exit.stop();
			enter.jump(from);
			/*
			 * BATCHED, and that is not tidiness. `id` selects which card the per-card computeds resolve
			 * against and `phase` selects which spring they read; written separately there is an instant
			 * where the NEW card is reading the OLD direction's value — and if the degradation gate is
			 * on, `enter.set` finishes synchronously and that instant is the one that paints.
			 */
			batch(() => {
				id.value = cardId;
				target.value = targetPx;
				phase.value = "enter";
			});
			enter.set(1);
		},
		leave(): void {
			const from = t.peek();
			enter.stop();
			// Ordered so the spring is already RUNNING before the phase flips: the settle watcher above
			// fires on any write while the phase is "exit", and a phase set first would be observed
			// against the `jump`'s momentarily-settled state and idle the card immediately.
			exit.jump(from);
			exit.set(0);
			phase.value = "exit";
		},
	};
}

/**
 * How many pixels of content this card is currently CLIPPING — the hover expansion's target.
 *
 * The natural height is assembled from the body's own `offsetHeight` plus the card's computed padding
 * and border, rather than read off `scrollHeight` or a bounding rect, for two independent reasons:
 * `offsetHeight` is immune to the ancestor transform a mid-flight hover may already have applied
 * (a rect would report the SCALED size and the target would grow every time the pointer re-entered),
 * and engines have never fully agreed on whether a flex container's `scrollHeight` includes its
 * bottom padding.
 *
 * The resting height is derived from the card's DATA and the gap token rather than measured, for the
 * same reason: measuring it while the spring is running would measure the expansion.
 */
function clippedHeightOf(wrapper: HTMLElement, card: HTMLElement, declaredH: number): number {
	const body = card.querySelector<HTMLElement>(".cal-event__body");
	if (!body || typeof globalThis.getComputedStyle !== "function") return 0;
	const cardStyle = globalThis.getComputedStyle(card);
	const gap = parseFloat(
		globalThis.getComputedStyle(wrapper).getPropertyValue("--cal-card-gap-block"),
	) || 0;
	const natural = (parseFloat(cardStyle.paddingBlockStart) || 0) +
		(parseFloat(cardStyle.borderBlockStartWidth) || 0) +
		body.offsetHeight +
		(parseFloat(cardStyle.paddingBlockEnd) || 0) +
		(parseFloat(cardStyle.borderBlockEndWidth) || 0);
	return Math.max(0, Math.round(natural - (declaredH - gap)));
}
// #endregion

// #region One drawn card
interface DayCardProps {
	/** Keyed by event AND day, matching the canvas's own card id: an event that runs past midnight is
	 *  clipped into one card per day, so its event id alone would name two of them. */
	cardId: string;
	slot: DaySlot;
	/** Content-space y (px) of the card's top edge — its START, the one edge that may never move. */
	top: number;
	/** The card's resting height (px) before any expansion. `INSTANT_HIT_H` for a pin. */
	height: number;
	/** Decorative silhouettes drawn behind a stack's surviving card. */
	shadows: number;
	tz: string;
	hour12: boolean;
	hover: CardHover;
	/** Whether this card carries the cluster's "show fewer" control (its cluster is unfolded). */
	collapse: boolean;
	/** The card is the subject of the current interaction — rung and held at full strength. */
	highlighted: boolean;
	/** Open this card — the popover if the host wired one, otherwise straight to the host. */
	onActivate: (slot: DaySlot, el: HTMLElement | null) => void;
	/** How far the card has stepped back behind the interaction. See `SceneEvent.recede`. */
	recede: SceneRecede;
	renderSource?: (source: string) => VNode | null;
	onOpen?: (event: CalendarEvent) => void;
	onUnfold?: (clusterId: string) => void;
}

function DayCard(props: DayCardProps): JSX.Element {
	const { slot, hover, cardId } = props;
	const event = slot.event;
	const ref = useRef<HTMLDivElement>(null);

	/*
	 * COMPUTEDS, not direct reads of the shared signals. A computed only notifies its subscribers when
	 * its OWN value changes, so a card that is not the hovered one resolves to a constant 0 and never
	 * re-renders — which matters because the hovered card re-renders on every frame of the spring, and
	 * a plain `hover.t.value` in this body would drag every other card in the window along with it.
	 */
	const t = useComputed(() => hover.id.value === cardId ? hover.t.value : 0);
	const expand = useComputed(() =>
		hover.id.value === cardId ? Math.max(0, hover.t.value) * hover.target.value : 0
	);
	const owned = useComputed(() => hover.id.value === cardId);

	const progress = t.value;
	const expandPx = expand.value;
	const isHovered = owned.value;
	// Safe as a `peek`: while this card owns the hover it re-renders on every frame of the spring, so
	// the value read here is never staler than the frame it is drawn in.
	const hasReveal = isHovered && hover.target.peek() > 0;

	/*
	 * Resolved here rather than left to `EventBlock`'s own copy, so the wrapper's DOM SIBLINGS — the
	 * stack silhouettes, the `+N` chip, the ambient shadow — can inherit the same custom properties.
	 * A sibling cannot read a `style` var declared only on the card beside it.
	 */
	const accentToken = event.accent ??
		effectiveAccent(event.kind, event.status, !!event.masked, event.allDay);
	const accentEdge = edgeFor(accentToken);

	function onEnter(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		// A tap fires `pointerenter` and never fires `pointerleave`, so a touch reader would strand a
		// card expanded with no way to release it. Touch opens the event instead; that is what a tap is.
		if (e.pointerType === "touch") return;
		const wrapper = ref.current;
		const card = wrapper?.querySelector<HTMLElement>(".cal-event");
		const targetPx = wrapper && card && !slot.instant
			? clippedHeightOf(wrapper, card, props.height)
			: 0;
		hover.enter(cardId, targetPx);
	}

	function onLeave(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (e.pointerType === "touch") return;
		hover.leave();
	}

	const foldChip = slot.foldedCount > 0
		? (props.onUnfold
			? (
				<button
					type="button"
					class="cal-daycol__stackbadge"
					/*
					 * The chip and the merged card it sits on are ONE control with one outcome: the cluster
					 * expands and its list opens together. Routing the chip to `onUnfold` alone would open a
					 * cluster with no list — and since the expansion is now derived FROM the list, it would
					 * open nothing at all.
					 */
					onClick={() => props.onActivate(slot, ref.current)}
					aria-label={`Show ${slot.foldedCount} more`}
				>
					+{slot.foldedCount}
				</button>
			)
			// No handler means no control: a chip that looks pressable and does nothing is worse than a
			// count. Every folded event is still reachable through the accessible layer either way.
			: <span class="cal-daycol__stackbadge" aria-hidden="true">+{slot.foldedCount}</span>)
		: props.collapse && props.onUnfold
		? (
			<button
				type="button"
				class="cal-daycol__stackbadge cal-daycol__stackbadge--collapse"
				onClick={() => props.onUnfold?.(slot.clusterId)}
				aria-label="Show fewer"
			>
				−
			</button>
		)
		: null;

	return (
		<div
			ref={ref}
			/*
			 * There is deliberately no `--split` modifier. A split lane is fully expressed by the insets
			 * the engine already handed back, and the trailing gutter every wrapper carries is what
			 * separates two lanes — so a class would be a hook with no rule behind it, which is the
			 * quiet kind of dead code that reads as an unfinished feature to the next person.
			 */
			class={cx(
				"cal-daycol__event",
				slot.instant && "cal-daycol__event--pin",
				slot.mode === "nested" && "cal-daycol__event--nested",
				isHovered && "cal-daycol__event--hover",
				props.highlighted && "cal-daycol__event--highlight",
			)}
			data-reveal={hasReveal ? "" : undefined}
			style={styleVars({
				"--cal-top": `${props.top}px`,
				"--cal-h": `${props.height + expandPx}px`,
				"--cal-inset-start": String(slot.insetStart),
				"--cal-inset-w": String(slot.insetWidth),
				"--cal-nest-depth": String(slot.nestDepth),
				// Four decimal places, because the value is written on every frame and a full-precision
				// float in a style attribute is a diff Preact has to serialise sixty times a second.
				"--cal-hover-t": progress.toFixed(4),
				"--cal-accent": `var(${accentToken})`,
				"--cal-accent-on": `var(${onAccentFor(accentToken)})`,
				// The accent's OPTIONAL border, on the WRAPPER alongside the fill so the card's siblings
				// — the stack silhouettes and the ambient shadow — inherit it too. Resolved through a
				// `var()` fallback, so five of the six groups write `transparent` at `0` and no modifier
				// class is needed for the one that does not.
				"--cal-accent-edge": accentEdge.colour
					? `var(${accentEdge.colour}, transparent)`
					: "transparent",
				"--cal-accent-edge-w": accentEdge.width ? `var(${accentEdge.width}, 0px)` : "0px",
				/*
				 * The recession, resolved by the TOKEN LAYER rather than by a number written here — the
				 * same two declarations the canvas reads back through its palette, so one card in two
				 * renderings recedes by one value. It is a state written directly, never a transition
				 * target: a hidden tab freezes transitions, and a card stranded half-receded is the
				 * least readable of the three states it could be in. `motion.css` may decorate the
				 * journey; it may not be what decides where the journey ends.
				 */
				"--cal-alpha": props.recede === "drag"
					? "var(--cal-dim-drag)"
					: props.recede === "focus"
					? "var(--cal-dim-focus)"
					: undefined,
			})}
			onPointerEnter={onEnter}
			onPointerLeave={onLeave}
		>
			{Array.from({ length: props.shadows }, (_, s) => (
				<span
					key={s}
					class="cal-daycol__eventshadow"
					style={styleVars({ "--cal-stack-depth": String(s + 1) })}
					aria-hidden="true"
				/>
			))}
			<EventBlock
				event={event}
				tz={props.tz}
				hour12={props.hour12}
				pin={slot.instant}
				bare={slot.bare}
				renderSource={props.renderSource}
				// Every activation routes through ONE entry point, exactly as the Week canvas's does: a
				// card standing for a whole cluster cannot honestly resolve to one of its members, so the
				// reader is asked which — and a keyboard reader must be asked the same question a pointer
				// reader is.
				onOpen={props.onOpen ? () => props.onActivate(slot, ref.current) : undefined}
			/>
			{foldChip}
		</div>
	);
}
// #endregion

export interface DayTimelineProps {
	tz: string;
	hour12: boolean;
	events: CalendarEvent[];
	availability?: CalendarAvailability;
	/** Zoom (px per hour), owned by the Calendar island. */
	pxPerHour: Signal<number>;
	/**
	 * The live clock. Passed down to the now-line leaf and read inside the return-to-present computed
	 * ONLY — never in this component's render body, so a minute tick cannot re-render the event tree.
	 */
	now: Signal<number>;
	/** Whether the client has mounted (gates the now-line). */
	mounted: Signal<boolean>;
	/** Day-granular "today" (that day's midnight epoch), or null before mount. Changes at midnight. */
	todayMs: number | null;
	/** The focused day (epoch ms) — drives nav jumps; reported back as the scroll centre moves. */
	focusMs: number;
	canCreate?: boolean;
	/**
	 * Overlap clusters the reader has opened out, by `DaySlot.clusterId`.
	 *
	 * The engine folds a resting cluster to one card plus a count; a cluster in this set is laid out in
	 * full instead. The SET is the consumer's, not this component's, because a fold survives a scroll
	 * that unmounts the day it was made on — state owned here would be forgotten by the virtualizer.
	 */
	unfolded?: ReadonlySet<string>;
	/**
	 * The EVENT the reader is pointing at from outside the grid — a row in the overlap-list popover.
	 *
	 * Deliberately separate from the card's own `:hover`: the popover is body-portalled, so moving the
	 * pointer from a card into it fires this column's `pointerleave` and would collapse the hover on
	 * the very card the row stands for. An event id rather than a card id, because the list names
	 * events and an event running past midnight is two cards — both of which should light up.
	 */
	highlightEventId?: string | null;
	/**
	 * How far every non-subject card steps back while one card is the subject. `"none"` → nothing does.
	 *
	 * The state, not an opacity: how faint each depth is, is a token decision (`--cal-dim-drag` /
	 * `--cal-dim-focus`), and this component resolves it in CSS rather than in TypeScript.
	 */
	recede?: SceneRecede;
	/**
	 * The shared popover state the whole engine writes into.
	 *
	 * The Day timeline needs it for the same reason the Week grid does, and specifically for the `+N`
	 * chip: since the expanded cluster is DERIVED from an open stack popover (see `Calendar.tsx`), a
	 * chip that only called `onUnfold` would have nothing to write to and the cluster would never open.
	 * One control, one outcome, in both views.
	 */
	popover?: Signal<EventPopoverState | null>;
	/**
	 * The reader asked to change a cluster's fold — from a `+N` chip, or from the collapse control the
	 * cluster carries once it is open. It is a TOGGLE request rather than a one-way "unfold", so a
	 * cluster the reader opened can be closed again; the consumer owns the set and decides.
	 */
	onUnfold?: (clusterId: string) => void;
	/** Draw one of an event's sources (consumer-owned brand marks). */
	renderSource?: (source: string) => VNode | null;
	onSelectRange?: (range: CalendarRange) => void;
	onOpenEvent?: (event: CalendarEvent) => void;
	/** Fired (day-granular) as the scroll centre crosses into a new day, so the header + mini-map track it. */
	onFocusDayChange?: (dayMs: number) => void;
	/**
	 * Step the zoom, anchored at a viewport y this component has already pinned.
	 *
	 * The Week grid's twin, and it has to exist here for the same reason: the scale is the island's to
	 * own, and only the mounted viewport can map a pointer into its own scroll space. Day and Week
	 * diverging on the zoom gesture is exactly the class of bug the two viewport hooks are kept as
	 * twins to prevent.
	 */
	onZoom?: (dir: "in" | "out") => void;
	/** Hand the island this viewport's own zoom interpolator — see the Week grid's twin. */
	registerZoom?: (
		run: (target: number, opts?: { onSettle?: () => void }) => () => void,
	) => void;
	/** The zoom bounds the island's continuum expects, so the spring and the pinch clamp where it does. */
	zoomRange?: readonly [number, number];
}

export function DayTimeline(props: DayTimelineProps): JSX.Element {
	const { tz, hour12, pxPerHour, todayMs } = props;

	// Fixed axis origin (index 0 = the day focused on MOUNT). NEVER re-based on scroll, so element
	// positions stay stable; nav/mini-map jumps scroll WITHIN the ±WINDOW_DAYS window (which spans years).
	const refMidnight = useRef(startOfDay(props.focusMs, tz)).current;
	const RANGE_START_MIN = -WINDOW_DAYS * 24 * 60;
	const RANGE_END_MIN = (WINDOW_DAYS + 1) * 24 * 60;

	const minuteOf = (ms: number) => (ms - refMidnight) / MIN;
	const dayIndexOf = (ms: number) => Math.round((startOfDay(ms, tz) - refMidnight) / DAY);

	const focusIsToday = todayMs != null && sameZonedDay(props.focusMs, todayMs, tz);

	const viewport = useCalendarViewport({
		zoomRange: props.zoomRange,
		pxPerHour,
		rangeStartMin: RANGE_START_MIN,
		rangeEndMin: RANGE_END_MIN,
		// Read through the SIGNAL so the return-to-present computed stays live without this component
		// re-rendering: a computed only notifies its subscribers when its own value changes.
		nowY: () =>
			todayMs == null
				? null
				: ((minuteOf(props.now.value) - RANGE_START_MIN) / 60) * pxPerHour.value,
		// The initial centre: the live time when the focus IS today, else the focus day's noon, so the
		// view opens on the same reference the rest of the calendar is built around. `peek()`, not
		// `.value` — this is called from a plain effect and must not subscribe anything to the tick.
		focusY: () => {
			const anchor = focusIsToday
				? minuteOf(props.now.peek())
				: minuteOf(startOfDay(props.focusMs, tz)) + 12 * 60;
			return ((anchor - RANGE_START_MIN) / 60) * pxPerHour.value;
		},
	});

	const pph = pxPerHour.value;
	const yFor = (m: number) => ((m - RANGE_START_MIN) / 60) * pph;
	const minAt = (y: number) => RANGE_START_MIN + (y / pph) * 60;

	// The last day we emitted / navigated to — breaks the focus↔scroll feedback loop.
	const lastDay = useRef(refMidnight);

	// #region Column width (the placement engine's lane budget)
	/*
	 * Measured, not assumed. `packDayEvents` decides whether a side-by-side split would still be
	 * legible from what a lane would ACTUALLY measure — so a wide Day column tolerates lanes a narrow
	 * one folds instead, and the answer changes with the lane splitter rather than with the viewport.
	 * It runs in `useLayoutEffect` because a plain effect is deferred behind a frame, and in a hidden
	 * document that frame never arrives: the first paint would then be laid out against a fallback.
	 */
	const colRef = useRef<HTMLDivElement>(null);
	const colW = useSignal(0);
	useLayoutEffect(() => {
		const el = colRef.current;
		if (!el) return;
		const read = () => {
			const w = el.clientWidth;
			if (w !== colW.peek()) colW.value = w;
		};
		read();
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
		ro?.observe(el);
		return () => ro?.disconnect();
	}, []);
	// #endregion

	const hover = useCardHover();

	/*
	 * #region Zoom wiring
	 *
	 * THESE TWO EFFECTS USED TO LIVE INSIDE THE `useSignalEffect` BELOW, AND THAT BROKE THE WHOLE VIEW.
	 *
	 * A `useSignalEffect` callback runs during the EFFECT flush — and re-runs on every scroll frame —
	 * so calling `useEffect` from inside it registered two more hooks against whichever component
	 * Preact happened to have current, advancing the hook cursor outside of a render. The visible
	 * result was that `refMidnight` (this component's FIRST hook, a `useRef` seeded from the focused
	 * day) read back `undefined`: every position derived from it became `NaN`, every day mark landed at
	 * `NaN px`, and the Day view rendered its hour scale and not one event. Nothing about the symptom
	 * pointed at the cause — the axis origin is nine hundred lines from the effect that corrupted it.
	 *
	 * Hooks are ordered by CALL POSITION IN THE RENDER BODY. There is no exception for a callback that
	 * happens to be defined inside the component, and a signal effect is not a render.
	 */
	useEffect(() => {
		props.registerZoom?.((target, opts) => viewport.zoomTo(target, opts));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [props.registerZoom]);

	/**
	 * Ctrl/Meta + wheel: zoom ANCHORED on the cursor — the Week grid's twin, for the same reason.
	 *
	 * The island still listens on an ancestor for the chrome outside the grid, so this stops the event
	 * once it has handled it; otherwise one notch would zoom twice.
	 */
	useEffect(() => {
		const el = viewport.scrollRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (!(e.ctrlKey || e.metaKey) || !props.onZoom) return;
			e.preventDefault();
			e.stopPropagation();
			viewport.zoomAnchor(e.clientY - el.getBoundingClientRect().top);
			props.onZoom(e.deltaY < 0 ? "in" : "out");
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [props.onZoom]);
	// #endregion

	// #region Centre-day tracking (scroll → header/mini-map)
	useSignalEffect(() => {
		const top = viewport.scrollTop.value;
		const h = viewport.viewportH.value;
		// `top <= 0` is the un-centred first read, not a destination: offset 0 on a ±4-year axis is
		// years ago, so reporting it would teleport the consumer's focus before the viewport has
		// positioned itself.
		if (h <= 0 || top <= 0) return;
		const centerMs = refMidnight + minAt(top + h / 2) * MIN;
		const day = startOfDay(centerMs, tz);
		if (day !== lastDay.current) {
			lastDay.current = day;
			props.onFocusDayChange?.(day);
		}
	});
	// #endregion

	// #region Nav jumps (focus changed externally → scroll to it; ignore our own echo)
	/*
	 * Routed through the engine's own `scrollToFocus` rather than a hand-rolled `el.scrollTo`, for two
	 * reasons. It resolves the SAME anchor this component already gave the hook as `focusY`, so there is
	 * one definition of "where the focused day sits" instead of two that can drift; and its instant path
	 * re-reads the container synchronously. That second point is load-bearing here: the rendered day
	 * window below is derived from `viewport.scrollTop`, which a programmatic scroll does not update on
	 * its own (no `scroll` event is dispatched for it in a frameless document), so a jump that skipped
	 * the re-read would leave the timeline on the previous day while the header showed the new one.
	 */
	useEffect(() => {
		if (!viewport.scrollRef.current) return;
		const targetDay = startOfDay(props.focusMs, tz);
		if (targetDay === lastDay.current) return; // our own centre echo, or unchanged
		lastDay.current = targetDay;
		viewport.scrollToFocus(scrollBehaviorFor());
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [props.focusMs]);
	// #endregion

	// #region Click / drag-to-select
	const sel = useSignal<{ a: number; b: number } | null>(null);
	function snapMs(ms: number): number {
		const step = SNAP * MIN;
		return Math.round(ms / step) * step;
	}
	function msAt(clientY: number): number {
		const el = viewport.scrollRef.current;
		if (!el) return refMidnight;
		const rect = el.getBoundingClientRect();
		return refMidnight + minAt(clientY - rect.top + el.scrollTop) * MIN;
	}
	/*
	 * THE CLICK-AWAY SHIELD (§2), the Day timeline's copy of the Week grid's.
	 *
	 * A press on empty grid while a popover is open dismisses it and does nothing else — without this,
	 * clicking past a panel to get rid of it also drew a selection and opened another one. It is a
	 * latch written from a document CAPTURE listener registered at MOUNT rather than a read inside the
	 * handler, because `useDismiss` also listens on `document` in capture and has already cleared the
	 * signal by the time a bubble-phase handler runs; two capture listeners on one node fire in
	 * registration order, and the popover layer's is registered only once a panel opens.
	 */
	const popoverWasOpen = useRef(false);
	useEffect(() => {
		if (typeof document === "undefined") return;
		const onDown = () => {
			popoverWasOpen.current = (props.popover?.peek() ?? null) !== null;
		};
		const onUp = () => {
			popoverWasOpen.current = false;
		};
		document.addEventListener("pointerdown", onDown, true);
		globalThis.addEventListener("pointerup", onUp);
		globalThis.addEventListener("pointercancel", onUp);
		return () => {
			document.removeEventListener("pointerdown", onDown, true);
			globalThis.removeEventListener("pointerup", onUp);
			globalThis.removeEventListener("pointercancel", onUp);
		};
	}, [props.popover]);

	function onCreatePointerDown(e: PointerEvent): void {
		if (!props.canCreate || e.button !== 0 || e.ctrlKey || e.metaKey) return;
		if (popoverWasOpen.current) return;
		const a = snapMs(msAt(e.clientY));
		sel.value = { a, b: a + 30 * MIN };
		const move = (ev: PointerEvent) => {
			if (sel.value) sel.value = { ...sel.value, b: snapMs(msAt(ev.clientY)) };
		};
		const up = () => {
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", up);
			const s = sel.value;
			sel.value = null;
			if (!s) return;
			const lo = Math.min(s.a, s.b);
			const hi = Math.max(s.a, s.b);
			const dur = hi - lo < SNAP * MIN ? 60 * MIN : hi - lo;
			props.onSelectRange?.({ start: lo, end: lo + dur });
		};
		globalThis.addEventListener("pointermove", move);
		globalThis.addEventListener("pointerup", up);
	}
	// #endregion

	/**
	 * The ONE place a card activation becomes a popover, mirroring the Week canvas's `openCard`.
	 *
	 * A card standing for a whole cluster opens the LIST first: it cannot honestly resolve to one of
	 * its members, so the reader is asked which. A card standing only for itself opens directly. A host
	 * that wired no popover keeps the older behaviour unchanged — the panel is an addition, never a
	 * toll gate.
	 *
	 * The anchor is the card's OWN rect, measured at the moment of the press. It is a snapshot, exactly
	 * as the canvas's is: a panel anchored to a card in a scrolling region has to be re-anchored by
	 * whoever scrolls it, and nothing here scrolls without the reader asking.
	 */
	function activateCard(slot: DaySlot, el: HTMLElement | null, daySlots: DaySlot[]): void {
		const layer = props.popover;
		if (!layer) {
			props.onOpenEvent?.(slot.event);
			return;
		}
		const box = el?.getBoundingClientRect();
		const anchor = box
			? { x: box.left, y: box.top, w: box.width, h: box.height }
			: { x: 0, y: 0, w: 0, h: 0 };
		if (slot.foldedCount > 0 && slot.clusterSize > 1) {
			// The cluster in START order, taken from the day's OWN slots — the same list the placement
			// engine built, so the popover and the `+N` chip describe exactly the same set. Filtering the
			// raw corpus instead would silently disagree the moment a filter narrowed one and not the
			// other.
			const members = daySlots
				.filter((x) => x.clusterId === slot.clusterId)
				.sort((a, b) => a.event.start - b.event.start)
				.map((x) => x.event);
			if (members.length > 1) {
				layer.value = { kind: "stack", events: members, anchor, clusterId: slot.clusterId };
				return;
			}
		}
		layer.value = { kind: "event", event: slot.event, anchor };
	}

	// #region Visible-day window
	const top = viewport.scrollTop.value;
	const h = viewport.viewportH.value;
	/*
	 * The window is only trustworthy once the container is a BOUNDED scroll viewport — the same test the
	 * engine's centering latch uses. It fails on SSR / the first client render (a scroll offset of 0 is
	 * the top of a ±4-year axis, not the top of the viewport) and on a host that does not cap the
	 * calendar's height (the scroller's client height becomes the whole axis, so every day is nominally
	 * in view). Both fall back to the FOCUSED day rather than rendering thousands of them.
	 */
	const bounded = h > 0 && viewport.contentHeight.value - h > 40;
	const focusIdx = dayIndexOf(props.focusMs);
	/*
	 * The window is clamped on BOTH sides of BOTH indices, and that is not belt-and-braces.
	 *
	 * `minAt` divides by `pxPerHour`, which is a caller-owned signal and is momentarily whatever the
	 * caller last wrote — a zoom mid-interpolation, a restored value, or on a degenerate host a zero.
	 * A one-sided clamp lets a non-finite or absurd quotient through on the OTHER side, and the pair
	 * then addresses days thousands of years off the axis, where `addZonedDays` hands
	 * `Intl.DateTimeFormat` a date outside the representable range and it throws `Invalid time value`
	 * — during RENDER, which takes this component and every child below it with it. That is how a
	 * scroll bar stopped appearing: not because it measured wrong, but because its parent never
	 * finished rendering.
	 *
	 * `dayWindow` is therefore total by construction: every input is coerced to a finite integer, both
	 * ends are held inside the axis, and the start can never exceed the end.
	 */
	const { startIdx, endIdx } = dayWindow(
		bounded,
		focusIdx,
		(minAt(top) * MIN) / DAY,
		(minAt(top + h) * MIN) / DAY,
		WINDOW_DAYS,
		MAX_DAYS,
	);
	const todayIdx = todayMs == null ? null : dayIndexOf(todayMs);

	const days: number[] = [];
	for (let i = startIdx; i <= endIdx; i++) days.push(i);
	// #endregion

	// #region Placement
	/*
	 * ONE pack per rendered day, feeding BOTH passes below. The drawn cards and the accessible layer
	 * are two views of the same `DaySlot[]` rather than two independent calls, which is what makes the
	 * merge gate structural: a card can only vanish from the paint pass by having `drawn === false`,
	 * and the very same predicate is what puts it in the accessible list.
	 */
	const columnWidth = colW.value > 0 ? colW.value : undefined;
	const packed = days.map((i) => {
		const dayStart = addZonedDays(refMidnight, i, tz);
		const nextDay = addZonedDays(dayStart, 1, tz);
		const dayEvents = props.events.filter((e) => {
			if (e.allDay || e.start >= nextDay) return false;
			// An INSTANT at exactly local midnight has `end === dayStart`, so the ordinary `end > dayStart`
			// overlap test rejects it and a midnight deadline would belong to no day at all. A point in
			// time is in the day that CONTAINS it, which is the half-open interval it starts in.
			return e.end === e.start ? e.start >= dayStart : e.end > dayStart;
		});
		const slots = packDayEvents(dayEvents, {
			dayStart,
			pxPerHour: pph,
			columnWidth,
			unfolded: props.unfolded,
		});
		/*
		 * Deeper cards LAST, so a nested child paints over the parent it sits inside. They are DOM
		 * siblings rather than a real tree — a nested card is positioned against the column, not against
		 * its parent's box — so document order is the only thing deciding which of two overlapping fills
		 * the reader sees.
		 */
		const drawn = slots.filter((s) => s.drawn).sort((a, b) =>
			a.nestDepth - b.nestDepth || a.event.start - b.event.start
		);
		return { i, dayStart, nextDay, slots, drawn };
	});
	// #endregion

	// #region Backdrop scene
	/*
	 * The lattice for the canvas, built from the same day walk the gutter labels use — one rule per
	 * hour of every rendered day, the midnight one emphasised, plus this weekday's working-hours
	 * bands. A single column, so there are no separators to draw.
	 */
	const rules: GridRule[] = [];
	const bands: GridRegion[] = [];
	for (const i of days) {
		const dayStart = addZonedDays(refMidnight, i, tz);
		const dayTop = yFor(minuteOf(dayStart));
		for (let hr = 0; hr < 24; hr++) rules.push({ y: dayTop + hr * pph, boundary: hr === 0 });
		if (!props.availability) continue;
		const wd = zonedWeekday(dayStart, tz);
		for (const r of props.availability.rules) {
			if (r.weekday !== wd || r.endMinute <= r.startMinute) continue;
			bands.push({
				column: 0,
				y: dayTop + (r.startMinute / 60) * pph,
				h: ((r.endMinute - r.startMinute) / 60) * pph,
			});
		}
	}
	const scene: GridScene = { scrollTop: top, columns: 1, rules, bands, blackouts: [] };
	// #endregion

	return (
		// The timeline has no header/all-day rows, so `.cal-tg` itself is already the scroller's box and
		// both the canvas backdrop and the overlay bar can be its siblings directly — no positioning
		// wrapper needed (the Week grid does need one, because its header rows sit above the scroller
		// inside the same block).
		<div class="cal-tg">
			{/* First, so the scroller and everything in it paints over it in document order. */}
			<GridCanvas scene={scene} />
			<div
				class={cx("cal-tg__scroll", viewport.panning.value && "cal-tg__scroll--panning")}
				ref={viewport.scrollRef}
				onPointerDown={viewport.onPanPointerDown}
				role="region"
				aria-label="Day timeline"
				tabIndex={0}
			>
				<div
					class="cal-tg__content"
					style={styleVars({ "--cal-content-h": `${viewport.contentHeight.value}px` })}
				>
					<div class="cal-tg__gutter" aria-hidden="true">
						{days.map((i) => {
							const dayStart = addZonedDays(refMidnight, i, tz);
							const dayTop = yFor(minuteOf(dayStart));
							return Array.from({ length: 24 }, (_, hr) => (
								<div
									key={`${i}-${hr}`}
									class="cal-tg__hour"
									style={styleVars({ "--cal-top": `${dayTop + hr * pph}px` })}
								>
									<span class="cal-tg__hour-label">{fmtHourLabel(hr, hour12)}</span>
								</div>
							));
						})}
					</div>

					<div class="cal-tg__cols" style={styleVars({ "--cal-cols": "minmax(0, 1fr)" })}>
						<div class="cal-tg__col" ref={colRef}>
							<div
								class="cal-daycol__hit"
								onPointerDown={(e) => onCreatePointerDown(e as unknown as PointerEvent)}
							/>

							{/* Day dividers + date labels */}
							{days.map((i) => {
								const dayStart = addZonedDays(refMidnight, i, tz);
								return (
									<div
										key={`d${i}`}
										class={cx(
											"cal-tg__daymark",
											i === todayIdx && "cal-tg__daymark--today",
										)}
										style={styleVars({ "--cal-top": `${yFor(minuteOf(dayStart))}px` })}
									>
										{fmtDayLabel(dayStart, tz)}
									</div>
								);
							})}

							{packed.flatMap(({ dayStart, nextDay, slots, drawn }) => {
								// One collapse control per open cluster, on whichever of its cards is drawn first.
								const collapsed = new Set<string>();
								// Resolved once per day rather than per card: "exactly one card is highlighted" is a
								// property of the frame, and re-deriving it in each card would let a future edit make
								// it a coincidence of the inputs instead.
								const focusId = props.highlightEventId ?? null;
								const recede: SceneRecede = props.recede ?? "none";
								return drawn.map((slot) => {
									const event = slot.event;
									const startMs = Math.max(event.start, dayStart);
									const cardTop = yFor(minuteOf(startMs));
									/*
									 * An instant occupies its POINTER BAND, not a height — the same
									 * `INSTANT_HIT_H` the canvas widens a zero-height card to, so a pin is the
									 * same size to press in either view. `EVENT_MIN_H` floors a real span so a
									 * five-minute meeting stays a target; applying it to a point in time would
									 * fabricate the very duration `CalendarEvent.end`'s contract forbids.
									 */
									const cardH = slot.instant ? INSTANT_HIT_H : Math.max(
										yFor(minuteOf(Math.min(event.end, nextDay))) - cardTop,
										EVENT_MIN_H,
									);
									const open = props.unfolded?.has(slot.clusterId) === true;
									const collapse = open && slot.clusterSize > 1 &&
										!collapsed.has(slot.clusterId);
									if (collapse) collapsed.add(slot.clusterId);
									return (
										<DayCard
											key={`${event.id}|${dayStart}`}
											cardId={`${event.id}|${dayStart}`}
											slot={slot}
											top={cardTop}
											height={cardH}
											shadows={slot.instant ? 0 : Math.min(STACK_SHADOW_MAX, slot.foldedCount)}
											tz={tz}
											hour12={hour12}
											hover={hover}
											collapse={collapse}
											highlighted={event.id === focusId}
											recede={focusId === null || event.id === focusId ? "none" : recede}
											renderSource={props.renderSource}
											onOpen={props.onOpenEvent}
											onActivate={(sl, el) => activateCard(sl, el, slots)}
											onUnfold={props.onUnfold}
										/>
									);
								});
							})}

							{
								/*
								 * THE ACCESSIBLE LAYER — the folded cards, the ones the paint pass spent no
								 * pixels on. Visually clipped to nothing (the same technique `TimeGrid`'s
								 * `.cal-tg__a11y` uses), so a screen reader or a Tab press still reaches an
								 * event the surface chose to stand behind a `+N` chip.
								 *
								 * It is built from the SAME `slots` array the drawn pass filtered, by the exact
								 * complement of its predicate — so the two partitions are provably a cover of
								 * the day, and an event cannot be dropped from both by a later edit to one.
								 */
							}
							<div class="cal-tg__a11y">
								{packed.flatMap(({ dayStart, slots }) =>
									slots.filter((s) => !s.drawn).map((s) => (
										<EventBlock
											key={`${s.event.id}|${dayStart}`}
											event={s.event}
											tz={tz}
											hour12={hour12}
											renderSource={props.renderSource}
											onOpen={props.onOpenEvent}
										/>
									))
								)}
							</div>

							{/* Drag-select preview */}
							{sel.value
								? (
									<div
										class="cal-tg__selection"
										style={styleVars({
											"--cal-top": `${yFor(minuteOf(Math.min(sel.value.a, sel.value.b)))}px`,
											"--cal-h": `${
												Math.max(
													yFor(minuteOf(Math.max(sel.value.a, sel.value.b))) -
														yFor(minuteOf(Math.min(sel.value.a, sel.value.b))),
													6,
												)
											}px`,
										})}
										aria-hidden="true"
									/>
								)
								: null}

							{/* Now-line — its own leaf, so the minute tick never reaches the event tree above. */}
							{todayIdx != null && todayIdx >= startIdx && todayIdx <= endIdx
								? (
									<NowIndicator
										now={props.now}
										mounted={props.mounted}
										pxPerHour={pxPerHour}
										rangeStartMin={RANGE_START_MIN}
										minuteAt={(ms) => minuteOf(ms)}
									/>
								)
								: null}
						</div>
					</div>
				</div>
			</div>

			<OverlayScrollbar
				scrollRef={viewport.scrollRef}
				revalidate={() => [viewport.scrollTop.value, viewport.contentHeight.value]}
				onPassthroughPointerDown={viewport.onPanPointerDown}
				/*
				 * ONE DAY's height at the live zoom — the denominator that makes the handle's LENGTH mean
				 * something. This axis spans about four years, so `viewport / content` would be a hair
				 * nobody could grab; `viewport / period` answers the question a reader of a day timeline
				 * actually has, which is how much of a day they can see at once.
				 */
				periodPx={24 * pxPerHour.value}
			/>

			{viewport.awayFromNow.value
				? (
					<button
						type="button"
						class="cal-tg__present"
						onClick={() => viewport.scrollToNow(scrollBehaviorFor())}
					>
						<TodayIcon size={15} />
						<span>Now</span>
					</button>
				)
				: null}
		</div>
	);
}
