/**
 * @projective/ui/calendar — the Month view. A 6×7 matrix of day cells with a weekday header, event
 * chips (up to a MEASURED cap, then a "+N more" affordance), today + outside-month + blackout states,
 * and click-to-create on an empty cell (an all-day range for that day). Non-interactive cell separation
 * is a single hairline grid, never a four-sided box (§B.4); the interactive event chips carry the
 * accent.
 *
 * A DISCRETE MONTH ON A CONTINUOUS TRACK. The two halves of this view answer to different rules, and
 * keeping them apart is what lets it be fluid without ever being ambiguous.
 *
 * The month's IDENTITY stays discrete and stays SYNCHRONOUS. A month is a named unit, not a position
 * on a line: "half of March" answers no question anyone asks of a month grid, and the 42 day numbers
 * on screen must be the focused month's the instant `props.focusMs` says so, with no frame having
 * run. So `monthMatrix` is still recomputed straight from the prop in the render body, every path —
 * wheel, drag, Page Up/Down, the Now pill, and the header's own Prev/Next — still routes through the
 * SAME `onPage` callback the consumer already drives the header with, and a step is still a whole
 * month.
 *
 * What is CONTINUOUS is the GESTURE. Three pages are rendered — previous, current, next — on one
 * track, and wheel delta and pointer drag translate that track proportionally and in real time, so a
 * neighbour month is genuinely visible as you move rather than appearing all at once at the end. That
 * translation is pure decoration: it is `transform` and nothing else, and the committed month is
 * written SYNCHRONOUSLY the moment the gesture crosses the commit distance, not when any animation
 * finishes. On commit the track re-bases by exactly one page width in the opposite direction, so the
 * content the reader was dragging toward stays under their finger while the pages beneath it
 * re-render; the residual then springs back to centre on release, which is what carries the new month
 * the rest of the way in. Below the commit distance the residual springs back to centre and nothing
 * has changed.
 *
 * THE DEGRADATION PATH IS TO STEP DISCRETELY. Under `prefers-reduced-motion`, or while the document
 * is hidden, `prefersJumpToFinal()` reports true: the neighbour pages are not rendered at all, the
 * track is never translated, and the same accumulated gesture commits the same whole-month step with
 * no motion in between. This is the same gate, in the same order, that `scrollBehaviorFor()` applies
 * to a programmatic scroll — rAF, CSS transitions and CSS `@keyframes` are ALL frozen in a background
 * tab, so a value that needed a frame would never arrive, and a month grid would rather show the new
 * month with no transition than strand one mid-slide off-screen.
 *
 * THE TRACK IS THE ONLY TRANSITION, and deliberately so. There is no keyed remount-and-`@keyframes`
 * glide beside it, because a continuous track cannot also be a keyed remount: remounting the element
 * mid-drag throws away the very position the drag is expressing, and two animation clocks would then
 * have to be gated against a hidden tab separately. A step that arrives from somewhere OTHER than a
 * gesture — the header, a key, the Now pill — glides through the same track, by offsetting the
 * already-re-rendered pages one width and springing them home on the one integrator this package has
 * (`core/motion.ts`).
 */
import type { JSX, VNode } from "preact";
import { effect, useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import { createSpring, prefersJumpToFinal, SPRING_STANDARD } from "../../core/motion.ts";
import type { CalendarAvailability, CalendarEvent, CalendarRange } from "../core/types.ts";
import {
	addZonedMonths,
	DAY,
	fmtFullDate,
	monthMatrix,
	sameZonedDay,
	sameZonedMonth,
	weekdayLabels,
	zonedDayNum,
	zonedParts,
} from "../core/time.ts";
import { EventBlock } from "./EventBlock.tsx";
import { TodayIcon } from "./glyphs.tsx";

// #region Constants
/** Chips assumed to fit per cell until the first measurement lands (the pre-measurement estimate). */
const FALLBACK_CHIPS = 3;
/** Fallback chip height (px) when no chip has been rendered yet to measure. */
const FALLBACK_CHIP_H = 20;

/**
 * How far a gesture travels, as a fraction of ONE page's width, before the step commits.
 *
 * A fraction rather than a fixed distance because the commit point is a statement about the PAGE —
 * "you have pulled the next month a third of the way in" — and a fixed 200px means two thirds of a
 * narrow lane and a twentieth of a wide one.
 */
const COMMIT_FRACTION = 0.28;
/** Floor on the commit distance: a narrow grid must not change month on a twitch. */
const COMMIT_MIN_PX = 56;
/**
 * Ceiling on the commit distance.
 *
 * Without it a wide grid asks for a 400px pull, which a mouse wheel — whose smallest unit is a whole
 * notch — can only satisfy by being spun four times for one month. The cap is what keeps a wheel
 * roughly one deliberate notch per step while a trackpad still gets the full proportional travel.
 */
const COMMIT_MAX_PX = 180;
/** Pointer travel (px) after which a press is a drag rather than a click. */
const DRAG_SLOP = 6;
/**
 * Gain applied to normalised wheel delta.
 *
 * A wheel notch reports roughly 100px in every engine, but it is a discrete flick of the hand rather
 * than 100px of intent; at 1:1 a single notch would move the track a tenth of a page and one month
 * would cost four of them. The gain is what makes one notch read as one deliberate step while a
 * trackpad's fine-grained deltas still arrive proportionally.
 */
const WHEEL_GAIN = 2.2;
/**
 * Pixels per `DOM_DELTA_LINE` unit.
 *
 * Firefox reports a mouse wheel in LINES (a notch is ~3), not pixels, so an unnormalised accumulator
 * needs the wheel spun dozens of times there for a step that costs one notch elsewhere.
 */
const WHEEL_LINE_PX = 16;
/** Quiet time (ms) after the last wheel event before the residual settles back to centre. */
const WHEEL_IDLE_MS = 140;
// #endregion

// #region Pure helpers
/**
 * `year * 12 + monthIndex` — a total order over months, so the distance between two of them is a
 * subtraction and the Now pill can express "go to today" as a single `onPage` step.
 */
function monthOrdinal(ms: number, tz: string): number {
	const p = zonedParts(ms, tz);
	return p.year * 12 + (p.month - 1);
}

/** The travel a gesture must cover to commit one step, for a page `width` px wide. */
function commitDistance(width: number): number {
	return Math.min(COMMIT_MAX_PX, Math.max(COMMIT_MIN_PX, width * COMMIT_FRACTION));
}

/**
 * `+1` where the inline axis runs left-to-right, `-1` where it runs right-to-left.
 *
 * The track's offset is kept LOGICAL — positive always means "the previous month is coming into
 * view" — and this is the one place it is resolved to a physical direction, applied twice and
 * symmetrically: once to turn a pointer's rightward travel into logical travel, once to turn the
 * logical offset back into a `translate`. `translate` takes a physical offset and CSS has no logical
 * equivalent yet, the same two-step resolution `scene-paint.ts`'s `mapX` does for the canvas twin.
 *
 * Resolved from the LIVE computed style rather than a mount-time constant, because `dir` is a runtime
 * attribute in this product (the wallet toggles one) and a sign fixed at mount would silently invert.
 */
function inlineSign(el: HTMLElement): number {
	return globalThis.getComputedStyle?.(el).direction === "rtl" ? -1 : 1;
}

/**
 * Whether `ev` belongs in the cell for the day starting at `dayStart`.
 *
 * An INSTANT — `end === start`, a deadline — is a moment, so the usual half-open overlap test
 * (`end > dayStart`) rejects one that lands exactly on midnight: it has no extent to reach into the
 * day it belongs to. It is admitted by its start alone, matching `core/layout.ts`, which likewise
 * gives an instant a placement and no height rather than dropping it.
 */
function occursOn(ev: CalendarEvent, dayStart: number): boolean {
	if (ev.end === ev.start) return ev.start >= dayStart && ev.start < dayStart + DAY;
	return ev.start < dayStart + DAY && ev.end > dayStart;
}

/** One wheel axis in px, whatever unit the engine chose to report it in. */
function wheelPx(deltaMode: number, value: number, pageWidth: number): number {
	if (deltaMode === 1) return value * WHEEL_LINE_PX;
	if (deltaMode === 2) return value * pageWidth;
	return value;
}
// #endregion

// #region One page
interface MonthPageProps {
	focusMs: number;
	tz: string;
	hour12: boolean;
	events: CalendarEvent[];
	availability?: CalendarAvailability;
	/** Day-granular "today" (that day's midnight epoch), or null before mount. */
	todayMs: number | null;
	/** Chips this page may draw per cell before surrendering a slot to "+N more". */
	capacity: number;
	/** Which of the three track columns this page occupies. */
	slot: "prev" | "current" | "next";
	/**
	 * Whether this page is the one the reader is operating.
	 *
	 * A neighbour page is a PREVIEW — an edge of the next month peeking past the frame while a gesture
	 * is in flight — so it renders no controls at all: no chip buttons, no day-number buttons, no "+N
	 * more". That is not decoration, it is what keeps 84 off-screen buttons out of the tab order and
	 * out of the accessibility tree without depending on `inert`, and it is why the preview also costs
	 * a fraction of the interactive page to render.
	 */
	interactive: boolean;
	canCreate?: boolean;
	renderSource?: (source: string) => VNode | null;
	onSelectRange?: (range: CalendarRange) => void;
	onOpenEvent?: (event: CalendarEvent) => void;
	onOpenDay?: (dayStart: number) => void;
	/** True once the live pointer sequence has moved far enough to be a drag rather than a click. */
	dragged: () => boolean;
}

/**
 * One month's 42 cells.
 *
 * Split out of {@link MonthGrid} because the track renders three of them and the only difference
 * between the current page and its two neighbours is {@link MonthPageProps.interactive}; expressing
 * that as one flag on one component is what stops a preview drifting into a second, subtly different
 * month renderer.
 */
function MonthPage(props: MonthPageProps): JSX.Element {
	const { tz, hour12, todayMs, interactive } = props;
	const days = monthMatrix(props.focusMs, tz);

	/**
	 * Whether a chip on this page will render as a `<button>`.
	 *
	 * It decides which element owns the `listitem` role: `EventBlock` already declares one on the
	 * non-interactive branch it falls back to when no `onOpen` is given, and adding a second on the
	 * wrapper would nest a list item inside a list item, which announces a sublist that is not there.
	 */
	const chipIsButton = interactive && !!props.onOpenEvent;

	function isBlackout(dayStart: number): boolean {
		if (!props.availability) return false;
		const end = dayStart + DAY;
		return props.availability.blackouts.some((b) => b.start < end && b.end > dayStart);
	}

	return (
		<div
			class="cal-month__page"
			data-page={props.slot}
			data-preview={interactive ? undefined : "true"}
			aria-hidden={interactive ? undefined : "true"}
		>
			{days.map((d) => {
				const dayEvents = props.events
					.filter((e) => occursOn(e, d))
					.sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.start - b.start);
				const outside = !sameZonedMonth(d, props.focusMs, tz);
				const today = todayMs != null && sameZonedDay(d, todayMs, tz);
				// One slot is surrendered to the "+N more" button whenever there IS an overflow —
				// otherwise the affordance announcing the hidden chips would itself be the hidden chip.
				const cap = dayEvents.length > props.capacity
					? Math.max(1, props.capacity - 1)
					: props.capacity;
				const shown = dayEvents.slice(0, cap);
				const overflow = dayEvents.length - shown.length;
				return (
					<div
						key={d}
						class={cx(
							"cal-month__cell",
							outside && "cal-month__cell--outside",
							today && "cal-month__cell--today",
							isBlackout(d) && "cal-month__cell--blackout",
						)}
						onPointerUp={interactive && props.canCreate
							? (e) => {
								// On pointerUP, not pointerDOWN. The grid now reads a horizontal press as a
								// possible page drag, and creating on the press would open a draft under
								// every gesture that was only ever going to turn the page. `dragged()` is
								// what tells the two apart: a press that never exceeded the slop is a click
								// and creates; one that did is a drag and is already being handled by the
								// track. (A drag that took pointer capture never reaches this handler at
								// all — capture retargets the pointerup to the grid — so this is the guard
								// for the sub-slop case, not the main one.)
								if (props.dragged()) return;
								// Only the EMPTY surface creates. Every control inside the cell — an event
								// chip, the day number, the "+N more" affordance — already owns its own
								// meaning, and firing create underneath it would open a draft the reader
								// never asked for on top of the thing they did ask for. The `+N more`
								// button in particular is now common, because the chip cap is measured
								// and can legitimately resolve to one.
								if ((e.target as HTMLElement).closest(".cal-event, button")) return;
								props.onSelectRange?.({ start: d, end: d + DAY, allDay: true });
							}
							: undefined}
					>
						<div class="cal-month__cellhead">
							{interactive
								? (
									<button
										type="button"
										class="cal-month__daynum"
										onClick={() => props.onOpenDay?.(d)}
										// The full date, not the bare number: a month grid holds 42 of these and
										// six of them are another month's, so "Open 1" names three different days
										// in one view.
										aria-label={`Open ${fmtFullDate(d, tz)}`}
										aria-current={today ? "date" : undefined}
									>
										{zonedDayNum(d, tz)}
									</button>
								)
								: <span class="cal-month__daynum">{zonedDayNum(d, tz)}</span>}
						</div>
						<div class="cal-month__events" role={interactive ? "list" : undefined}>
							{shown.map((e) => (
								// The wrapper exists so the month can say something about a chip that the chip
								// itself does not carry: `EventBlock` takes no class, and an INSTANT — a
								// deadline, `end === start` — should read as a marker rather than a bar
								// spanning the day. It also restores the list/listitem pairing that a bare
								// `<button>` child of `role="list"` had broken.
								<div
									key={e.id}
									class={cx(
										"cal-month__chip",
										e.end === e.start && "cal-month__chip--instant",
									)}
									role={chipIsButton ? "listitem" : undefined}
								>
									<EventBlock
										event={e}
										tz={tz}
										hour12={hour12}
										compact
										renderSource={props.renderSource}
										onOpen={interactive ? props.onOpenEvent : undefined}
									/>
								</div>
							))}
							{overflow > 0
								? (
									<div class="cal-month__chip" role={interactive ? "listitem" : undefined}>
										{interactive
											? (
												<button
													type="button"
													class="cal-month__more"
													onClick={() => props.onOpenDay?.(d)}
												>
													+{overflow} more
												</button>
											)
											: <span class="cal-month__more">+{overflow} more</span>}
									</div>
								)
								: null}
						</div>
					</div>
				);
			})}
		</div>
	);
}
// #endregion

/** A live pointer drag of the track. */
interface DragState {
	pointerId: number;
	width: number;
	startX: number;
	startY: number;
	/** Logical offset the pointer's own travel is measured FROM; re-based on every commit. */
	origin: number;
	/** Past the slop and owning the pointer. */
	active: boolean;
	/** Moved at all — the guard that stops a drag also creating an event. */
	moved: boolean;
}

/** A run of wheel events treated as one gesture, closed by {@link WHEEL_IDLE_MS} of silence. */
interface WheelState {
	/** Logical offset the burst's accumulator is measured FROM; re-based on every commit. */
	origin: number;
	/** Gained, normalised, direction-resolved travel so far. Positive advances the month. */
	acc: number;
	width: number;
	/**
	 * The idle timer, or `undefined` when no burst is in flight.
	 *
	 * `ReturnType<typeof setTimeout>` rather than `number`, matching `useOverlayScrollbar`: Deno types
	 * the handle as a `Timeout`, so the DOM's `number` does not hold here.
	 */
	timer: ReturnType<typeof setTimeout> | undefined;
}

export interface MonthGridProps {
	focusMs: number;
	tz: string;
	hour12: boolean;
	events: CalendarEvent[];
	availability?: CalendarAvailability;
	/** Day-granular "today" (that day's midnight epoch), or null before mount. */
	todayMs: number | null;
	canCreate?: boolean;
	/** Draw one of an event's sources (consumer-owned brand marks). */
	renderSource?: (source: string) => VNode | null;
	onSelectRange?: (range: CalendarRange) => void;
	onOpenEvent?: (event: CalendarEvent) => void;
	/** Open a specific day (e.g. switch to Day view) when its number is clicked. */
	onOpenDay?: (dayStart: number) => void;
	/** Step the month by `delta` — the SAME callback the header's Prev/Next drives. */
	onPage?: (delta: number) => void;
}

export function MonthGrid(props: MonthGridProps): JSX.Element {
	const { tz, hour12, todayMs } = props;
	const pageable = !!props.onPage;

	const gridRef = useRef<HTMLDivElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);
	const capacity = useSignal(FALLBACK_CHIPS);
	/** The current page's width in px — the unit every gesture is measured in. */
	const pageW = useRef(0);
	/**
	 * The resolved inline direction, `+1` or `-1`.
	 *
	 * Cached rather than read where it is used, because both consumers are hot: the spring writes the
	 * transform once a frame, and reading `getComputedStyle().direction` there would force a style
	 * resolution immediately before writing a style on the same element, every frame. It is refreshed
	 * wherever the geometry is anyway — the resize measurement, and the start of each gesture — so a
	 * runtime `dir` flip (this product toggles one) is picked up without a listener of its own.
	 */
	const dirSign = useRef(1);
	/**
	 * The live `onPage`, held by ref because the wheel listener is bound ONCE (it needs
	 * `{ passive: false }`, which a JSX handler cannot ask for) and would otherwise call whichever
	 * callback the first render happened to close over.
	 */
	const pageRef = useRef(props.onPage);
	pageRef.current = props.onPage;

	// #region The track's offset
	/**
	 * The track's LOGICAL offset in px: positive means the previous month is coming into view.
	 *
	 * A spring rather than a CSS transition because a transition is a second animation clock this
	 * package would then have to gate separately, and because a drag has to be able to seize the value
	 * mid-settle and keep going from exactly where it is — `jump()` does that, a running transition
	 * does not. It drives ONE decorative `translate`; nothing a reader must trust depends on it, and
	 * `createSpring` writes it straight to its target under `prefersJumpToFinal()`.
	 */
	const offset = useMemo(() => createSpring(0, { config: SPRING_STANDARD }), []);
	useEffect(() => () => offset.dispose(), [offset]);

	/**
	 * Whether the fluid track is available at all.
	 *
	 * False renders ONE page and never translates, so a reduced-motion reader and a hidden tab get the
	 * same accumulate-then-step behaviour with no motion between the months — and, just as
	 * importantly, no neighbour pages sitting in the DOM for a transition that is never going to run.
	 * It starts false so the server renders exactly the current month.
	 */
	const fluid = useSignal(false);
	useLayoutEffect(() => {
		const mq = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
		const sync = (): void => {
			const next = !prefersJumpToFinal();
			if (next === fluid.value) return;
			fluid.value = next;
			// Losing the track mid-offset would leave a translated frame with nothing rendered beside
			// it, so the offset goes home in the same breath as the pages it was revealing.
			if (!next) offset.jump(0);
		};
		sync();
		document.addEventListener("visibilitychange", sync);
		mq?.addEventListener?.("change", sync);
		return () => {
			document.removeEventListener("visibilitychange", sync);
			mq?.removeEventListener?.("change", sync);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/**
	 * The one writer of the track's transform.
	 *
	 * Subscribed imperatively rather than read in the render body: reading a spring while rendering
	 * would re-render 126 cells on every animation frame to move a decorative offset. `effect` runs
	 * synchronously on each write, so the value on screen is always the resolved number and never an
	 * interpolation the browser is doing on its own.
	 */
	useLayoutEffect(() => {
		return effect(() => {
			const px = offset.value.value;
			const el = trackRef.current;
			if (!el) return;
			el.style.setProperty("--cal-month-dx", `${px * dirSign.current}px`);
		});
	}, [offset]);
	// #endregion

	// #region Measured chip capacity
	/**
	 * How many chips actually fit, rather than a fixed 3. The grid divides its height into six rows
	 * regardless of content, so at a short height a static cap silently cut chips AND the "+N more"
	 * button off with no scrollbar and no indication that anything was hidden. Measuring is stable —
	 * the cell height is set by the grid, not by the chips, so changing the cap cannot resize the cell
	 * and re-trigger the observer.
	 *
	 * The measured box is scoped to the CURRENT page. The three track pages are the same size by
	 * construction, so any of them would answer the same number today — but the cap is a claim about
	 * the page the reader is looking at, and an unscoped `querySelector` silently returns the PREVIOUS
	 * month's first cell, which is the wrong element to be right by accident. The chip whose height is
	 * sampled is deliberately NOT scoped: chip height is a CSS property, identical on every page, and
	 * insisting on one from the current month would strand the cap on its fallback for any month with
	 * no events in it.
	 */
	useEffect(() => {
		const grid = gridRef.current;
		if (!grid) return;
		const measure = () => {
			// Before the early return: every gesture is measured in page widths, and a gesture can
			// begin before a cell box has ever resolved.
			pageW.current = grid.clientWidth;
			dirSign.current = inlineSign(grid);
			const box = grid.querySelector('.cal-month__page[data-page="current"] .cal-month__events');
			if (!(box instanceof HTMLElement) || box.clientHeight <= 0) return;
			const chip = grid.querySelector(".cal-event");
			const chipH = chip instanceof HTMLElement && chip.offsetHeight > 0
				? chip.offsetHeight
				: FALLBACK_CHIP_H;
			const gap = parseFloat(getComputedStyle(box).rowGap) || 0;
			const fits = Math.floor((box.clientHeight + gap) / (chipH + gap));
			capacity.value = Math.max(1, fits);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(measure);
		ro.observe(grid);
		// Belt and braces alongside the observer, mirroring `useCalendarViewport`: a ResizeObserver
		// callback is delivered at the end of a frame, and a viewport with no frames (a hidden or
		// background tab) would leave the cap on whatever it last measured.
		globalThis.addEventListener("resize", measure);
		return () => {
			ro.disconnect();
			globalThis.removeEventListener("resize", measure);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	// #endregion

	// #region Committing a step
	/**
	 * Set by a gesture that has ALREADY re-based the track for the step it is committing, and consumed
	 * by the glide detector below.
	 *
	 * The distinction it draws is the whole reason both can coexist: a step committed mid-gesture must
	 * not glide, because the reader's own finger is already carrying the motion and a second offset
	 * would fight it; a step arriving from anywhere else — the header, a key, the Now pill — has no
	 * gesture behind it and is exactly what the glide is for.
	 */
	const gestureCommit = useRef(false);
	const glideDir = useRef(0);

	function commit(delta: number): void {
		if (!delta) return;
		gestureCommit.current = true;
		pageRef.current?.(delta);
	}

	/** A step with no gesture behind it: the header, a key, the Now pill. */
	function stepDiscrete(delta: number): void {
		if (!delta) return;
		pageRef.current?.(delta);
	}

	const monthKey = monthOrdinal(props.focusMs, tz);
	const prevMonthKey = useRef<number | null>(null);
	if (prevMonthKey.current !== null && prevMonthKey.current !== monthKey) {
		if (gestureCommit.current) {
			// Consumed rather than counted down: Preact coalesces the signal writes behind two
			// synchronous `onPage` calls into ONE render, so a count would be left holding a step that
			// no further render is coming for. The cost of the simplification is that an external focus
			// change landing in the same render as a gesture commit skips its glide, which is a missing
			// decoration on a month that is already correct.
			gestureCommit.current = false;
			glideDir.current = 0;
		} else {
			glideDir.current = monthKey > prevMonthKey.current ? 1 : -1;
		}
	}
	prevMonthKey.current = monthKey;

	/**
	 * The glide, for a step that arrived without a gesture.
	 *
	 * The new month is ALREADY rendered centred by the time this runs — that is the invariant the
	 * whole file is built on — so the glide works backwards: offset the track by a full page width so
	 * the month being left is still the one on screen, then spring home. Under `prefersJumpToFinal()`
	 * the spring finishes inside `set`, both writes land before paint, and the reader simply sees the
	 * new month.
	 */
	useLayoutEffect(() => {
		const dir = glideDir.current;
		glideDir.current = 0;
		if (!dir || !fluid.value || !pageable) return;
		const width = pageW.current || gridRef.current?.clientWidth || 0;
		if (width <= 0) return;
		offset.jump(dir * width);
		offset.set(0);
	});
	// #endregion

	// #region Continuous gestures
	const dragRef = useRef<DragState | null>(null);
	const wheelRef = useRef<WheelState>({ origin: 0, acc: 0, width: 0, timer: undefined });

	/**
	 * Take a logical offset, commit as many whole steps as it has travelled, and write what is left.
	 *
	 * The re-base (`origin ±= width` per commit) is what makes a commit invisible at the moment it
	 * happens: the pages re-render one month along, which moves every pixel of content by exactly one
	 * page width, and adding that same width back to the offset puts it all back where the reader last
	 * saw it. Everything after the crossing is then the residual settling, not the step.
	 *
	 * Clamped to ±one page because exactly one neighbour is rendered on each side; dragging past it
	 * would reveal the frame's own background and call it a month.
	 */
	function resolve(state: { origin: number; width: number }, travel: number): number {
		let logical = state.origin + travel;
		if (state.width <= 0) return 0;
		const distance = commitDistance(state.width);
		// Loops rather than a single test: one wheel event can legitimately carry more than a page.
		while (logical <= -distance) {
			commit(1);
			state.origin += state.width;
			logical += state.width;
		}
		while (logical >= distance) {
			commit(-1);
			state.origin -= state.width;
			logical -= state.width;
		}
		return Math.max(-state.width, Math.min(state.width, logical));
	}

	function onPointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (!pageable) return;
		if (e.pointerType === "mouse" && e.button !== 0) return;
		const grid = gridRef.current;
		if (!grid) return;
		const width = pageW.current || grid.clientWidth;
		if (width <= 0) return;
		dirSign.current = inlineSign(grid);
		// Cancel the settle rather than ignore it: a press mid-flight grabs the track where it visibly
		// is, so the offset it starts from is the CURRENT value, never the target it was heading for.
		offset.stop();
		dragRef.current = {
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			width,
			origin: fluid.value ? offset.value.peek() : 0,
			active: false,
			moved: false,
		};
	}

	function onPointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const d = dragRef.current;
		if (!d || e.pointerId !== d.pointerId) return;
		const dx = e.clientX - d.startX;
		const dy = e.clientY - d.startY;
		if (!d.active) {
			if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) d.moved = true;
			// Horizontal dominance, not merely horizontal distance: a mostly-vertical drag is a reader
			// changing their mind about a cell, and stealing it would turn the page under them.
			if (Math.abs(dx) <= DRAG_SLOP || Math.abs(dx) <= Math.abs(dy)) return;
			d.active = true;
			const grid = gridRef.current;
			// `setPointerCapture` throws `NotFoundError` when the pointer has already gone; letting that
			// escape would abort the handler and abandon the gesture it was in the middle of adopting.
			try {
				grid?.setPointerCapture(d.pointerId);
			} catch {
				// The pointer is gone; the gesture proceeds uncaptured and ends on the next up/cancel.
			}
			grid?.setAttribute("data-dragging", "true");
		}
		const logical = resolve(d, dx * dirSign.current);
		if (fluid.value) offset.jump(logical);
	}

	function endDrag(): void {
		const d = dragRef.current;
		dragRef.current = null;
		if (!d) return;
		const grid = gridRef.current;
		if (d.active) {
			try {
				grid?.releasePointerCapture(d.pointerId);
			} catch {
				// Already released with the pointer itself — nothing to undo.
			}
			grid?.removeAttribute("data-dragging");
		}
		offset.set(0);
	}

	useEffect(() => {
		const grid = gridRef.current;
		if (!grid) return;
		const onWheel = (e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) return; // Ctrl+wheel is the view/zoom continuum
			// Consumed unconditionally: the month grid is a fixed page, and an unconsumed wheel would
			// chain to whatever scrolls behind it.
			e.preventDefault();
			if (!pageRef.current) return;
			const width = pageW.current || grid.clientWidth;
			if (width <= 0) return;
			const w = wheelRef.current;
			if (w.timer === undefined) {
				// A fresh burst. Seeded from where the track visibly IS so a wheel that arrives during a
				// settle continues the same journey instead of teleporting to the last committed origin.
				offset.stop();
				dirSign.current = inlineSign(grid);
				w.width = width;
				w.origin = fluid.value ? offset.value.peek() : 0;
				w.acc = 0;
			}
			// The dominant axis, resolved separately: a wheel DOWN is the next month in either writing
			// direction, but a swipe RIGHT is the next month only where the inline axis runs that way.
			const advance = Math.abs(e.deltaX) > Math.abs(e.deltaY)
				? wheelPx(e.deltaMode, e.deltaX, w.width) * dirSign.current
				: wheelPx(e.deltaMode, e.deltaY, w.width);
			w.acc += advance * WHEEL_GAIN;
			const logical = resolve(w, -w.acc);
			if (fluid.value) offset.jump(logical);
			// A wheel has no release, so the burst is closed by silence. Restarted on every event, so a
			// trackpad's inertia tail is one continuous gesture rather than a run of tiny ones.
			clearTimeout(w.timer);
			w.timer = setTimeout(() => {
				w.timer = undefined;
				offset.set(0);
			}, WHEEL_IDLE_MS);
		};
		grid.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			grid.removeEventListener("wheel", onWheel);
			clearTimeout(wheelRef.current.timer);
			wheelRef.current.timer = undefined;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		if (e.key !== "PageUp" && e.key !== "PageDown") return;
		e.preventDefault();
		// No refractory period: that existed to absorb a trackpad's inertia, which a key press does not
		// have, and applying one here would silently swallow the second of two deliberate presses.
		stepDiscrete(e.key === "PageDown" ? 1 : -1);
	}
	// #endregion

	// #region Return to present
	/**
	 * How many whole months separate the focused month from today's — the pill's step, and its own
	 * visibility test.
	 *
	 * "Return to present" has to mean something different here than in Day and Week, which return a
	 * scroll offset to now: a month grid has no scroll offset, and every hour of the focused month is
	 * already on screen. The only thing left for it to return is the month itself, so the pill pages
	 * to the one containing today — through the same `onPage` the header uses, so the two can no more
	 * disagree about this than about anything else.
	 */
	const monthsToToday = todayMs == null ? 0 : monthOrdinal(todayMs, tz) - monthKey;
	// #endregion

	const showNeighbours = fluid.value && pageable;
	const cap = capacity.value;

	return (
		<div class="cal-month">
			<div class="cal-month__weekdays">
				{weekdayLabels().map((w) => <div key={w} class="cal-month__weekday">{w}</div>)}
			</div>
			<div
				ref={gridRef}
				class="cal-month__grid"
				role="group"
				aria-label="Month grid — Page Up and Page Down change month"
				tabIndex={0}
				onKeyDown={onKeyDown}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
			>
				{
					/*
					 * The track. It is never keyed and never remounted — the pages inside it change, the
					 * element carrying the offset does not — so a commit cannot throw away the very
					 * position the gesture is expressing, and `gridRef`'s listeners and the capacity
					 * observer keep their target across every step.
					 */
				}
				{
					/*
					 * Keyed by SLOT, not by month: a page's identity here is "the column of the track it
					 * occupies", so a commit re-props three surviving elements instead of unmounting and
					 * remounting them, and toggling the neighbours in or out never re-bases the current
					 * page onto a sibling's DOM by index.
					 */
				}
				<div ref={trackRef} class="cal-month__track">
					{showNeighbours
						? (
							<MonthPage
								focusMs={addZonedMonths(props.focusMs, -1, tz)}
								tz={tz}
								hour12={hour12}
								events={props.events}
								availability={props.availability}
								todayMs={todayMs}
								capacity={cap}
								key="prev"
								slot="prev"
								interactive={false}
								renderSource={props.renderSource}
								dragged={() => false}
							/>
						)
						: null}
					<MonthPage
						focusMs={props.focusMs}
						tz={tz}
						hour12={hour12}
						events={props.events}
						availability={props.availability}
						todayMs={todayMs}
						capacity={cap}
						key="current"
						slot="current"
						interactive
						canCreate={props.canCreate}
						renderSource={props.renderSource}
						onSelectRange={props.onSelectRange}
						onOpenEvent={props.onOpenEvent}
						onOpenDay={props.onOpenDay}
						dragged={() => dragRef.current?.moved === true}
					/>
					{showNeighbours
						? (
							<MonthPage
								focusMs={addZonedMonths(props.focusMs, 1, tz)}
								tz={tz}
								hour12={hour12}
								events={props.events}
								availability={props.availability}
								todayMs={todayMs}
								capacity={cap}
								key="next"
								slot="next"
								interactive={false}
								renderSource={props.renderSource}
								dragged={() => false}
							/>
						)
						: null}
				</div>

				{
					/*
					 * A sibling of the track, not a child: it answers to the viewport, and riding the
					 * offset would send the one control that says "come back" off-screen with everything
					 * else. Withheld entirely before mount, when `todayMs` is null — a pill that cannot
					 * yet know which month today is in has nothing to promise.
					 */
				}
				{pageable && monthsToToday !== 0
					? (
						<button
							type="button"
							class="cal-month__present"
							onClick={() => stepDiscrete(monthsToToday)}
						>
							<TodayIcon size={15} />
							<span>Now</span>
						</button>
					)
					: null}
			</div>
		</div>
	);
}
