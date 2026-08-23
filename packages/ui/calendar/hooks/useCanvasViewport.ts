/**
 * @projective/ui/calendar — the VIRTUAL viewport engine for the pure-canvas time grid.
 *
 * Its sibling {@link useCalendarViewport} instruments a real, natively-scrolling element: the
 * browser owns the offset, and the hook reads `el.scrollTop` back. A canvas viewport has no such
 * element — there is nothing inside it to overflow — so this hook owns the offset itself and every
 * behaviour the native scroller was quietly providing has to be re-implemented here or it is simply
 * gone:
 *
 *  - **Wheel** — including the three `deltaMode` units, which the platform normally resolves.
 *  - **Keyboard** — Arrow / Page / Home / End, which a focusable `overflow: auto` box gets free.
 *  - **Touch** — a one-finger drag. The host sets `touch-action: pinch-zoom`, which hands the finger
 *    to us (there is no scroll container for the browser to pan) while LEAVING the browser its
 *    pinch, so page zoom survives (WCAG 1.4.4). Without this the Week grid would simply not scroll
 *    on a phone, and `touch-action` would have swallowed the page's own scroll on the way past.
 *  - **Clamping** — a virtual offset can be driven anywhere, so the range is enforced on write.
 *  - **Reveal** — `scrollIntoView` has nothing to scroll into view; {@link CanvasViewport.reveal}
 *    is what the accessible layer calls when focus lands on a card that is off-screen.
 *  - **2D pan** and the zoom-anchored re-pin, sharing their engine with the native viewport.
 *
 * THE ZOOM ANCHOR. A zoom re-pins the viewport so the grid scales IN PLACE, and which instant is
 * held still is a choice: the viewport centre by default, or — once {@link CanvasViewport.zoomAnchor}
 * has been told where the pointer is — the timestamp under the cursor. The anchored minute is
 * captured ONCE and re-solved from in closed form on every subsequent zoom step, so a gesture that
 * spans a dozen frames holds the same instant under the cursor on all of them instead of walking it
 * a fraction of a minute at a time.
 *
 * WHAT IT GAINS BY OWNING THE OFFSET. The native path had a standing hazard this one does not: a
 * programmatic `scrollTo` dispatches its `scroll` event asynchronously, and a hidden or background
 * document defers it indefinitely — so the virtualized window could be left rendering the period the
 * grid had scrolled AWAY from, which is why the native engine carries an explicit re-sync after
 * every jump. Here the offset IS a signal, so a write is visible to everything downstream in the
 * same tick, with no event to wait for and nothing to re-sync.
 *
 * THE BACKGROUND-TAB RULE. A smooth scroll is a frame-driven animation and the offset is not
 * decoration — it decides WHICH period the grid draws — so smooth is attempted only where
 * {@link scrollBehaviorFor} says a frame is coming (not under `prefers-reduced-motion`, not in a
 * hidden document) and every other path writes the final offset immediately.
 */
import { batch, type ReadonlySignal, type Signal, useComputed, useSignal } from "@preact/signals";
import { useCallback, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";
import type { HourRow, ZoomAnchorState, ZoomToOptions } from "./useCalendarViewport.ts";
import {
	PINCH_MIN_DIST_PX,
	scrollBehaviorFor,
	visibleFractionOf,
	ZOOM_ANCHOR_HOLD_MS,
	ZOOM_ANCHOR_SLOP_PX,
	ZOOM_RANGE_DEFAULT,
	ZOOM_SETTLE_EPSILON,
	zoomMinuteAtY,
	zoomYAtMinute,
} from "./useCalendarViewport.ts";
import { createSpring, type Spring, SPRING_STANDARD } from "../../core/motion.ts";
import {
	MOMENTUM_DECAY,
	MOMENTUM_MIN_RELEASE_V,
	MOMENTUM_MIN_V,
	VELOCITY_WINDOW_MS,
} from "../core/scene-build.ts";

// #region Constants
/** A `deltaMode: line` wheel notch, in px — the conventional line box for a forwarded wheel delta. */
const WHEEL_LINE_PX = 16;
/** Arrow-key step (px). One notch of the same size a wheel line moves, so the two agree. */
const KEY_STEP_PX = 48;
/** How much of the viewport a Page key travels — a page, minus a sliver of context to land on. */
const PAGE_FRACTION = 0.9;
/** Breathing room (px) left around a card the accessible layer has just revealed. */
const REVEAL_PAD = 24;
/** Smooth-scroll duration (ms). Short enough to read as a move rather than as a journey. */
const GLIDE_MS = 240;
/**
 * Hard ceiling on hour rows resolved for one frame.
 *
 * The window is derived from the measured viewport and the caller's zoom, and `pxPerHour` is a
 * caller-owned signal on a PUBLIC component — so a standalone consumer passing a near-zero zoom
 * would otherwise ask for tens of thousands of rows, rebuilt on every scroll, to draw a lattice
 * whose lines are a hundredth of a pixel apart. Virtualization makes the cost independent of the
 * axis; this makes it independent of the inputs, exactly as `TimeGrid`'s block cap does. A 4,000px
 * viewport at the island's own floor of 26 px/hour asks for ~160.
 */
const MAX_ROWS = 400;
// #endregion

// #region Types
export interface UseCanvasViewportOptions {
	/** Pixels per hour — the zoom, owned by the consumer (a signal). */
	pxPerHour: Signal<number>;
	/** The vertical range's start, in minutes from the axis origin. */
	rangeStartMin: number;
	/** The vertical range's end, in minutes from the axis origin. */
	rangeEndMin: number;
	/** Content-space y of the live now-line, or null when it should not drive return-to-present. */
	nowY: () => number | null;
	/** Content-space y to centre on first layout. */
	focusY: () => number;
	/** Extra hour rows resolved beyond each viewport edge (default 2). */
	overscan?: number;
	/**
	 * Bounds `zoomTo` and the pinch gesture clamp `pxPerHour` into. Defaults to
	 * {@link ZOOM_RANGE_DEFAULT}, which is a degenerate-value guard rather than a design range — a
	 * consumer with its own zoom limits should pass them.
	 */
	zoomRange?: readonly [number, number];
	/**
	 * Handle a two-finger pinch as a calendar zoom. **Defaults to `false`, deliberately.**
	 *
	 * `styles/grid.css` sets `touch-action: pinch-zoom` on this viewport, which hands two-finger
	 * gestures to the BROWSER so that page zoom keeps working on a phone — a logged WCAG 1.4.4
	 * decision, and the same declaration that gives the one-finger drag to {@link CanvasViewport.beginPan}.
	 * Turning this on without also setting `touch-action: none` gives the gesture two owners: the
	 * browser zooms the page while the hook zooms the grid. Setting `touch-action: none` makes the
	 * hook the only owner and takes pinch-to-zoom away from the reader, which is the accessibility
	 * decision being reversed. That trade is a human's to make, so the gesture ships implemented and
	 * switched off.
	 */
	enablePinchZoom?: boolean;
}

export interface CanvasViewport {
	/** Attach to the element the canvas fills — it is measured, and it carries the input handlers. */
	hostRef: RefObject<HTMLDivElement>;
	/** The virtual scroll offset (px). Clamped to the range on every write. */
	scrollTop: Signal<number>;
	/** Measured viewport height (px). */
	viewportH: Signal<number>;
	/** Measured viewport width (px). */
	viewportW: Signal<number>;
	/**
	 * Measured hour-scale width (px) — the host's own `padding-inline-start`.
	 *
	 * Read from a real padding rather than from `--cal-gutter-w`, because a custom property computes
	 * to its authored token (`3.5rem`) and never to a length: a canvas needs the resolved pixel, and
	 * a padding is the one declaration that both reserves the space and reports it.
	 */
	gutter: Signal<number>;
	/** Total content height (px) at the current zoom. */
	contentHeight: Signal<number>;
	/** The deepest reachable offset (px). */
	maxScroll: Signal<number>;
	/** Whether the surface is mirrored, so a pointer's physical x can be read as a logical one. */
	rtl: Signal<boolean>;
	/** The hour rows currently in the window (virtualized). */
	rows: Signal<HourRow[]>;
	/** Whether — and which way — the now-line sits outside the viewport (`null` when in view). */
	awayFromNow: Signal<"up" | "down" | null>;
	/** Whether a pan drag is in progress. */
	panning: Signal<boolean>;
	/**
	 * The fraction of ONE PERIOD (a day for Day, the block for Week) currently visible, `0..1`.
	 *
	 * See {@link visibleFractionOf}. A scrollbar sizes its handle from this.
	 */
	visibleFraction: ReadonlySignal<number>;
	/**
	 * Pin the NEXT zoom change to a viewport y instead of to the centre.
	 *
	 * The minute currently under `viewportY` stays under it across the whole zoom, however many
	 * frames the interpolation takes. Pass `null` to return to centre-pinning.
	 *
	 * `viewportY` is measured from the host's own top edge — the same space {@link CanvasViewport.pointerAt}
	 * returns — so a caller forwards a cursor position without having to know the offset. The anchor
	 * also lapses on its own after {@link ZOOM_ANCHOR_HOLD_MS} of no zoom activity, so a caller that
	 * forgets to clear it degrades to centre-pinning rather than holding a minute the reader stopped
	 * caring about.
	 *
	 * AT THE ENDS OF THE AXIS the anchor cannot be honoured: the solved offset clamps, and the
	 * timestamp under the cursor necessarily moves. The clamp wins and no correction is attempted —
	 * fighting it would mean either scrolling past the range or silently re-capturing the minute,
	 * and re-capturing is exactly the drift the captured minute exists to avoid. Zooming back away
	 * from the boundary restores the anchor exactly, because the minute was never overwritten.
	 */
	zoomAnchor: (viewportY: number | null) => void;
	/**
	 * Interpolate `pxPerHour` toward `target`, re-pinning to the live anchor on every frame.
	 *
	 * `pxPerHour` is the CONSUMER's signal, so the hook cannot own the animation without owning the
	 * value; this is the machinery a caller drives instead. One over-damped `SPRING_STANDARD` per
	 * hook is re-targeted rather than replaced, so a stream of calls (a wheel burst, a pinch) carries
	 * its velocity through instead of restarting from rest on every event — which is what keeps a
	 * continuous gesture continuous rather than stepped.
	 *
	 * Snaps synchronously when `prefersJumpToFinal()` says so — a hidden tab or a reduced-motion
	 * preference — or when `requestAnimationFrame` is unavailable, so no caller ever waits on a frame
	 * that is not coming. Returns a disposer that stops the spring where it stands; it is inert once
	 * a later call has superseded this one.
	 */
	zoomTo: (target: number, opts?: ZoomToOptions) => () => void;
	/** Write the offset directly (clamped). `behavior` defaults to an instant jump. */
	scrollTo: (y: number, behavior?: ScrollBehavior) => void;
	/** Move the offset by a delta (clamped). */
	scrollBy: (dy: number) => void;
	/** Re-centre on the focus instant — the ONE way a consumer should perform a navigation jump. */
	scrollToFocus: (behavior?: ScrollBehavior) => void;
	/** Bring the now-line back to the viewport centre. */
	scrollToNow: (behavior?: ScrollBehavior) => void;
	/**
	 * Scroll a content-space band into view, doing nothing when it is already there. This is what
	 * replaces `scrollIntoView` for the accessible layer — a canvas has nothing to scroll into view.
	 */
	reveal: (y0: number, y1: number) => void;
	/** Start a pan if the pointer qualifies (middle button, or Ctrl/Meta + left). Returns whether it did. */
	beginPan: (e: PointerEvent) => boolean;
	/** Handle a scrolling key. Returns whether it consumed the event. */
	handleKey: (e: KeyboardEvent) => boolean;
	/** Pointer coordinates resolved to LOGICAL canvas space (x from the inline start). */
	pointerAt: (e: PointerEvent | MouseEvent) => { x: number; y: number };
}
// #endregion

export function useCanvasViewport(opts: UseCanvasViewportOptions): CanvasViewport {
	const { pxPerHour, rangeStartMin, rangeEndMin, nowY, focusY, overscan = 2 } = opts;

	const hostRef = useRef<HTMLDivElement>(null);
	const scrollTop = useSignal(0);
	const viewportH = useSignal(0);
	const viewportW = useSignal(0);
	const panning = useSignal(false);
	const rtl = useSignal(false);
	const gutter = useSignal(0);

	const spanHours = (rangeEndMin - rangeStartMin) / 60;
	const contentHeight = useComputed(() => spanHours * pxPerHour.value);
	const maxScroll = useComputed(() => Math.max(0, contentHeight.value - viewportH.value));
	const visibleFraction = useComputed(() => visibleFractionOf(viewportH.value, pxPerHour.value));

	/** The minute at the viewport centre — held so a zoom re-pins in place. */
	const centerMinute = useRef((rangeStartMin + rangeEndMin) / 2);
	const didCenter = useRef(false);
	// The cursor anchor a zoom pins to INSTEAD of the centre, when one is live. Declared up here with
	// the other pinning state because the re-pin reads it long before the gesture code that sets it.
	const zoomAnchorRef = useRef<ZoomAnchorState | null>(null);
	/** The in-flight glide, so a second scroll request cancels the first rather than fighting it. */
	const glide = useRef(0);

	// #region Time ⇄ pixels
	const yToMinute = useCallback(
		(y: number) => rangeStartMin + (y / pxPerHour.value) * 60,
		[pxPerHour, rangeStartMin],
	);
	const minuteToY = useCallback(
		(m: number) => ((m - rangeStartMin) / 60) * pxPerHour.value,
		[pxPerHour, rangeStartMin],
	);
	// #endregion

	// #region Offset
	const cancelGlide = useCallback(() => {
		if (glide.current) {
			globalThis.cancelAnimationFrame?.(glide.current);
			glide.current = 0;
		}
	}, []);

	/** Write the offset, clamped, and keep the centre minute honest for the next zoom. */
	const write = useCallback((y: number) => {
		const next = Math.min(maxScroll.value, Math.max(0, y));
		if (scrollTop.peek() === next) return;
		scrollTop.value = next;
		if (viewportH.peek() > 0) centerMinute.current = yToMinute(next + viewportH.peek() / 2);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [yToMinute]);

	const scrollTo = useCallback((y: number, behavior: ScrollBehavior = "auto") => {
		cancelGlide();
		const target = Math.min(maxScroll.value, Math.max(0, y));
		const raf = globalThis.requestAnimationFrame;
		if (behavior !== "smooth" || typeof raf !== "function") {
			write(target);
			return;
		}
		const from = scrollTop.peek();
		const startedAt = Date.now();
		const step = () => {
			// Elapsed WALL time, not a frame count: a throttled tab that delivers three frames a second
			// still lands on the target on schedule rather than crawling there.
			const t = Math.min(1, (Date.now() - startedAt) / GLIDE_MS);
			// Ease-out quint — the §B.5 over-damped curve, no overshoot.
			write(from + (target - from) * (1 - Math.pow(1 - t, 5)));
			glide.current = t < 1 ? raf(step) : 0;
		};
		glide.current = raf(step);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cancelGlide, write]);

	const scrollBy = useCallback((dy: number) => {
		cancelGlide();
		write(scrollTop.peek() + dy);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cancelGlide, write]);

	const scrollToFocus = useCallback((behavior: ScrollBehavior = "auto") => {
		scrollTo(focusY() - viewportH.peek() / 2, behavior);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [focusY, scrollTo]);

	const scrollToNow = useCallback((behavior: ScrollBehavior = scrollBehaviorFor()) => {
		const y = nowY();
		if (y == null) return;
		scrollTo(y - viewportH.peek() / 2, behavior);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [nowY, scrollTo]);

	const reveal = useCallback((y0: number, y1: number) => {
		const top = scrollTop.peek();
		const h = viewportH.peek();
		if (h <= 0) return;
		if (y0 < top + REVEAL_PAD) scrollTo(y0 - REVEAL_PAD);
		else if (y1 > top + h - REVEAL_PAD) scrollTo(y1 - h + REVEAL_PAD);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [scrollTo]);
	// #endregion

	// #region Measurement
	/*
	 * A LAYOUT effect, not a plain one. Preact defers `useEffect` behind a `requestAnimationFrame`
	 * racing a 100 ms timeout — so in a hidden or background document the viewport would go
	 * unmeasured, `viewportH` would stay 0, and a canvas that draws only what intersects its box
	 * would draw nothing at all. Everything the first frame depends on has to be measured
	 * synchronously at commit.
	 */
	useLayoutEffect(() => {
		const el = hostRef.current;
		if (!el || typeof window === "undefined") return;
		const read = () => {
			const rect = el.getBoundingClientRect();
			const cs = getComputedStyle(el);
			const isRtl = cs.direction === "rtl";
			const pad = cs.getPropertyValue("padding-inline-start") ||
				(isRtl ? cs.paddingRight : cs.paddingLeft);
			const padPx = parseFloat(pad);
			batch(() => {
				viewportH.value = rect.height;
				viewportW.value = rect.width;
				rtl.value = isRtl;
				gutter.value = Number.isFinite(padPx) ? padPx : 0;
			});
		};
		read();
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
		ro?.observe(el);
		globalThis.addEventListener("resize", read);
		return () => {
			ro?.disconnect();
			globalThis.removeEventListener("resize", read);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	// #endregion

	// #region Virtualized hour rows
	const rows = useComputed<HourRow[]>(() => {
		const pph = pxPerHour.value;
		if (pph <= 0) return [];
		const top = scrollTop.value;
		const h = viewportH.value || 1;
		const firstHour = Math.floor(rangeStartMin / 60);
		const lastHour = Math.ceil(rangeEndMin / 60);
		const visFirst = Math.floor(yToMinute(top) / 60) - overscan;
		const visLast = Math.ceil(yToMinute(top + h) / 60) + overscan;
		const out: HourRow[] = [];
		const from = Math.max(firstHour, visFirst);
		const to = Math.min(lastHour, visLast);
		for (let hr = from; hr <= to && out.length < MAX_ROWS; hr++) {
			const hourOfDay = ((hr % 24) + 24) % 24;
			out.push({ hour: hr, hourOfDay, y: minuteToY(hr * 60), dayBoundary: hourOfDay === 0 });
		}
		return out;
	});
	// #endregion

	// #region Centre on first layout + re-pin on zoom
	// Also a LAYOUT effect: the opening offset is not decoration but WHICH period the grid draws, and
	// a deferred centring would paint two decades ago for one frame before jumping to this week.
	useLayoutEffect(() => {
		if (didCenter.current || viewportH.value <= 0) return;
		didCenter.current = true;
		scrollToFocus("auto");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [viewportH.value]);

	/**
	 * Re-solve the offset for the CURRENT zoom — from the anchored minute when one is live, from the
	 * centre minute otherwise. Every zoom step routes through here, so the anchored and centred cases
	 * cannot answer differently about clamping, bookkeeping or ordering.
	 *
	 * Both branches write the offset STRAIGHT rather than through `write`, which would re-derive the
	 * centre minute from the offset it is in the middle of setting and drift a little further on every
	 * zoom step. `maxScroll` is recomputed inline from the peeked zoom for the same reason its siblings
	 * are peeked: this runs inside a layout effect during an interpolated zoom, and subscribing to a
	 * computed that depends on `pxPerHour` while writing `pxPerHour` upstream is a loop.
	 */
	const repinZoom = useCallback((): void => {
		const h = viewportH.peek();
		const pph = pxPerHour.peek();
		if (h <= 0 || !(pph > 0)) return;
		const max = Math.max(0, spanHours * pph - h);
		const now = Date.now();
		const anchor = zoomAnchorRef.current;
		if (anchor && now <= anchor.expiresAt) {
			const next = Math.min(
				max,
				Math.max(0, zoomYAtMinute(anchor.minute, rangeStartMin, pph) - anchor.y),
			);
			scrollTop.value = next;
			anchor.expiresAt = now + ZOOM_ANCHOR_HOLD_MS;
			// The centre genuinely moved, so the record of it is re-derived from where the offset landed
			// — including a clamp. The anchor's own minute is untouched by that, which is what lets a
			// zoom back away from the boundary restore it exactly.
			centerMinute.current = zoomMinuteAtY(next + h / 2, rangeStartMin, pph);
			return;
		}
		zoomAnchorRef.current = null;
		const pinned = centerMinute.current;
		scrollTop.value = Math.min(max, Math.max(0, zoomYAtMinute(pinned, rangeStartMin, pph) - h / 2));
		centerMinute.current = pinned;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [spanHours, rangeStartMin]);

	/*
	 * Re-pin when the zoom ACTUALLY changes, so the grid scales in place. Guarded against the mount
	 * run, where `centerMinute` is still the pre-centering default.
	 *
	 * A LAYOUT effect, matching its native twin: Preact defers `useEffect` behind a frame, so an
	 * interpolated zoom would re-pin one frame after the zoom it belongs to — and for a spring running
	 * over a dozen frames, a re-pin that is always one frame stale is a visible slide rather than a
	 * still anchor.
	 */
	const prevPph = useRef(pxPerHour.value);
	useLayoutEffect(() => {
		if (!didCenter.current || viewportH.peek() <= 0 || prevPph.current === pxPerHour.value) {
			prevPph.current = pxPerHour.value;
			return;
		}
		prevPph.current = pxPerHour.value;
		cancelGlide();
		repinZoom();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pxPerHour.value]);
	// #endregion

	// #region Return-to-present
	const awayFromNow = useComputed<"up" | "down" | null>(() => {
		const y = nowY();
		if (y == null) return null;
		const top = scrollTop.value;
		const h = viewportH.value;
		if (h <= 0) return null;
		if (y < top + h * 0.12) return "up";
		if (y > top + h * 0.88) return "down";
		return null;
	});
	// #endregion

	// #region Wheel
	useEffect(() => {
		const el = hostRef.current;
		if (!el || typeof window === "undefined") return;
		const onWheel = (e: WheelEvent) => {
			// Ctrl/Meta belongs to the zoom continuum, which the island owns on an ancestor. Letting it
			// bubble untouched is what keeps one gesture with one owner.
			if (e.ctrlKey || e.metaKey) return;
			// There is no scroll container here, so without this the gesture chains to the page and the
			// whole surface scrolls out from under the reader.
			e.preventDefault();
			const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? viewportH.peek() : 1;
			scrollBy(e.deltaY * unit);
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [scrollBy]);
	// #endregion

	// #region Keyboard
	const handleKey = useCallback((e: KeyboardEvent): boolean => {
		const h = viewportH.peek();
		const page = Math.max(KEY_STEP_PX, h * PAGE_FRACTION);
		switch (e.key) {
			case "ArrowDown":
				scrollBy(KEY_STEP_PX);
				break;
			case "ArrowUp":
				scrollBy(-KEY_STEP_PX);
				break;
			case "PageDown":
				scrollBy(page);
				break;
			case "PageUp":
				scrollBy(-page);
				break;
			case "Home":
				scrollTo(0);
				break;
			case "End":
				scrollTo(maxScroll.peek());
				break;
			default:
				return false;
		}
		e.preventDefault();
		return true;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [scrollBy, scrollTo]);
	// #endregion

	// #region Pan (middle-mouse / Ctrl + left-drag / one-finger touch) + release momentum
	const drag = useRef({ active: false, y: 0, st: 0 });
	/** Ends whatever pan is in flight and detaches its listeners. Null when none is. */
	const endPan = useRef<(() => void) | null>(null);
	/** A rolling window of recent `(time, y)` samples — the release velocity is measured from this,
	 *  not from a single last delta, which a single noisy pointer-move event could spike. */
	const velocitySamples = useRef<{ t: number; y: number }[]>([]);

	/**
	 * Momentum (§Part 4): decelerate `v` (px/ms) from `from`, writing the offset every frame until it
	 * drops below {@link MOMENTUM_MIN_V} or the range clamps it — reuses the SAME animation slot
	 * `scrollTo`'s glide owns (`cancelGlide`/`glide.current`), so a fling and a programmatic jump can
	 * never both be driving the offset at once.
	 */
	const fling = useCallback((from: number, v: number) => {
		const raf = globalThis.requestAnimationFrame;
		if (typeof raf !== "function") return;
		let velocity = v;
		let last = Date.now();
		let pos = from;
		const step = () => {
			const now = Date.now();
			// Clamped to a few frames' worth: `requestAnimationFrame` does not fire in a hidden/backgrounded
			// tab, so the gap since the last tick can be arbitrarily large on the frame a tab is
			// foregrounded again — integrating the STALE (not-yet-decayed) velocity across that whole gap
			// would fling the offset an enormous, unrelated distance in one jump. Capping `dt` is what
			// keeps a resumed fling merely a little SLOWER to settle rather than briefly wrong.
			const dt = Math.min(48, Math.max(1, now - last));
			last = now;
			const before = scrollTop.peek();
			pos += velocity * dt;
			write(pos);
			velocity *= Math.pow(MOMENTUM_DECAY, dt / 16.67);
			// Stopped BY THE CLAMP (a real boundary — the ±WINDOW range, still years away in practice) —
			// the honest thing is to stop the animation rather than keep computing a coast that can no
			// longer move anything; a hard boundary should feel like a wall, not a spring.
			const clamped = scrollTop.peek();
			if (Math.abs(velocity) < MOMENTUM_MIN_V || (clamped === before && clamped !== pos)) {
				glide.current = 0;
				return;
			}
			glide.current = raf(step);
		};
		glide.current = raf(step);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [write]);

	const beginPan = useCallback((e: PointerEvent): boolean => {
		const isMiddle = e.button === 1;
		const isCtrlLeft = e.button === 0 && (e.ctrlKey || e.metaKey);
		// A touch has no button and no modifier, so it would otherwise fall through to drag-to-create
		// and the grid could not be scrolled by any gesture on a phone. On touch the drag is the SCROLL
		// — a tap is what activates, which is how every calendar the reader has used behaves — and the
		// caller detects the tap itself, because only it knows what is under the finger.
		const isTouch = e.pointerType === "touch" && e.isPrimary !== false;
		if (!isMiddle && !isCtrlLeft && !isTouch) return false;
		// Not on touch: `preventDefault` on a touch pointerdown suppresses the click the tap is meant to
		// become, and `touch-action` has already told the browser this gesture is ours.
		if (!isTouch) e.preventDefault(); // suppress middle-click autoscroll / text selection
		cancelGlide();
		drag.current = { active: true, y: e.clientY, st: scrollTop.peek() };
		velocitySamples.current = [{ t: Date.now(), y: e.clientY }];
		panning.value = !isTouch;
		const move = (ev: PointerEvent) => {
			if (!drag.current.active) return;
			write(drag.current.st - (ev.clientY - drag.current.y));
			const now = Date.now();
			const samples = velocitySamples.current;
			samples.push({ t: now, y: ev.clientY });
			// Trim from the front — the window only needs to reach back `VELOCITY_WINDOW_MS`, not hold
			// the whole gesture (a long slow drag that ends in a fast flick must read as the flick).
			while (samples.length > 2 && now - samples[0].t > VELOCITY_WINDOW_MS) samples.shift();
		};
		const up = (ev: PointerEvent) => {
			drag.current.active = false;
			panning.value = false;
			endPan.current = null;
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", up);
			globalThis.removeEventListener("pointercancel", cancel);
			const samples = velocitySamples.current;
			const first = samples[0];
			const now = Date.now();
			// A pointer that sat still right before lifting has a stale first sample (older than the
			// window) — that IS the "this was a deliberate stop" signal, not noise to correct for.
			if (first && now - first.t <= VELOCITY_WINDOW_MS + 16 && now - first.t > 0) {
				const v = -(ev.clientY - first.y) / (now - first.t);
				if (Math.abs(v) >= MOMENTUM_MIN_RELEASE_V) fling(scrollTop.peek(), v);
			}
		};
		const cancel = () => {
			drag.current.active = false;
			panning.value = false;
			endPan.current = null;
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", up);
			globalThis.removeEventListener("pointercancel", cancel);
		};
		// The listeners live on `globalThis`, not on the host, so the pan survives the pointer leaving
		// the viewport — which is also why unmounting mid-drag does not take them with it, and why the
		// hook holds this handle for its own teardown below.
		endPan.current = cancel;
		globalThis.addEventListener("pointermove", move);
		globalThis.addEventListener("pointerup", up);
		globalThis.addEventListener("pointercancel", cancel);
		return true;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cancelGlide, fling, write]);

	// A pan in flight at unmount would otherwise leave three live `globalThis` listeners writing to a
	// signal nothing renders any more.
	useEffect(() => () => endPan.current?.(), []);
	// #endregion

	// #region Pointer mapping
	/**
	 * A pointer's position in LOGICAL canvas space.
	 *
	 * `offsetX`/`offsetY` are measured against the EVENT TARGET, which is only the host while nothing
	 * inside it can be hit; the host's own rect is the same measurement without that precondition, so
	 * it survives an overlay being added later. `offsetX` is also physical, so the mirror is undone
	 * here, once, and every consumer downstream reads x as growing from the inline start.
	 */
	const pointerAt = useCallback((e: PointerEvent | MouseEvent) => {
		const el = hostRef.current;
		if (!el) return { x: 0, y: 0 };
		const rect = el.getBoundingClientRect();
		const physical = e.clientX - rect.left;
		return {
			x: rtl.peek() ? rect.width - physical : physical,
			y: e.clientY - rect.top,
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	// #endregion

	// #region Cursor-anchored zoom
	const zoomSpring = useRef<Spring | null>(null);
	const zoomUnsubs = useRef<Array<() => void>>([]);
	const zoomSettle = useRef<(() => void) | null>(null);
	/**
	 * Bumped by every {@link zoomTo}, so the disposer a superseded call handed out can tell that the
	 * spring it would stop is no longer running its zoom.
	 */
	const zoomGen = useRef(0);
	/** The live zoom bounds, in a ref so a gesture closure can never hold a stale range. */
	const zoomRangeRef = useRef<readonly [number, number]>(ZOOM_RANGE_DEFAULT);
	zoomRangeRef.current = opts.zoomRange ?? ZOOM_RANGE_DEFAULT;

	const zoomAnchor = useCallback((viewportY: number | null): void => {
		const pph = pxPerHour.peek();
		if (viewportY == null || !Number.isFinite(viewportY) || !(pph > 0)) {
			zoomAnchorRef.current = null;
			return;
		}
		/*
		 * A LIVE anchor at the same place is EXTENDED, never re-derived.
		 *
		 * Re-deriving looks harmless and is not: the minute is solved from `scrollTop` and `pxPerHour`
		 * TOGETHER, and mid-gesture those two are momentarily out of step — the scale has been written
		 * but the offset that belongs to it is re-pinned in a layout effect that has not run yet. A
		 * wheel BURST (every trackpad emits them) therefore captures a minute against a mismatched
		 * pair, and because each notch re-captures against the last notch's error the drift compounds:
		 * measured, four synchronous notches walked the viewport about twenty-five weeks off target.
		 *
		 * Extending is also the more honest reading of the requirement. The timestamp under the cursor
		 * is fixed ONCE, when the gesture starts; a reader who has not moved the pointer has not
		 * changed their mind about which moment they are holding still.
		 */
		const live = zoomAnchorRef.current;
		if (
			live && live.expiresAt > Date.now() && Math.abs(live.y - viewportY) <= ZOOM_ANCHOR_SLOP_PX
		) {
			live.expiresAt = Date.now() + ZOOM_ANCHOR_HOLD_MS;
			return;
		}
		zoomAnchorRef.current = {
			y: viewportY,
			minute: zoomMinuteAtY(scrollTop.peek() + viewportY, rangeStartMin, pph),
			expiresAt: Date.now() + ZOOM_ANCHOR_HOLD_MS,
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rangeStartMin]);

	const zoomTo = useCallback((target: number, o?: ZoomToOptions): () => void => {
		const [lo, hi] = zoomRangeRef.current;
		const next = Math.min(hi, Math.max(lo, target));
		cancelGlide();
		// Any zoom INTENT keeps the anchor alive, not just a zoom that moves the axis: a pinch held at
		// the range's ceiling produces no `pxPerHour` change to refresh it, and letting the anchor
		// lapse there would snap the grid back to centre-pinning the moment the reader squeezed again.
		const live = zoomAnchorRef.current;
		if (live) live.expiresAt = Date.now() + ZOOM_ANCHOR_HOLD_MS;

		let spring = zoomSpring.current;
		if (!spring) {
			spring = createSpring(pxPerHour.peek(), {
				config: SPRING_STANDARD,
				epsilon: ZOOM_SETTLE_EPSILON,
			});
			// ONE subscription for the hook's life. `subscribe` runs its callback untracked, so writing
			// `pxPerHour` here registers no dependency and cannot feed back into the spring.
			zoomUnsubs.current.push(spring.value.subscribe((v) => {
				pxPerHour.value = v;
			}));
			zoomUnsubs.current.push(spring.settled.subscribe((settled) => {
				if (!settled) return;
				const done = zoomSettle.current;
				zoomSettle.current = null;
				done?.();
			}));
			zoomSpring.current = spring;
		}
		// The consumer owns `pxPerHour` and may write it directly (restoring a persisted zoom, a view
		// switch resetting to the default). Adopting that value before re-targeting is what stops the
		// spring from dragging the axis back to a number the consumer had already left behind.
		if (Math.abs(spring.value.peek() - pxPerHour.peek()) > ZOOM_SETTLE_EPSILON) {
			spring.jump(pxPerHour.peek());
		}

		const gen = ++zoomGen.current;
		zoomSettle.current = o?.onSettle ?? null;
		spring.set(next);
		// A jump-to-final `set` finishes a spring that was ALREADY settled, so `settled` never changes
		// and the subscription above never fires. The synchronous path has to be closed here or a
		// reduced-motion reader's `onSettle` would simply never run.
		if (spring.settled.peek()) {
			const done = zoomSettle.current;
			zoomSettle.current = null;
			done?.();
		}
		const owned = spring;
		return () => {
			if (zoomGen.current !== gen) return;
			zoomSettle.current = null;
			owned.stop();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cancelGlide]);

	useEffect(() => () => {
		for (const off of zoomUnsubs.current) off();
		zoomUnsubs.current = [];
		zoomSpring.current?.dispose();
		zoomSpring.current = null;
	}, []);
	// #endregion

	// #region Pinch zoom (opt-in — see UseCanvasViewportOptions.enablePinchZoom)
	/*
	 * Two touch points, one zoom. The gesture anchors at the midpoint the fingers started from and
	 * holds THAT minute for the whole squeeze: re-anchoring to a drifting midpoint would re-capture
	 * the minute every move and reintroduce exactly the accumulating slide the captured minute exists
	 * to prevent, so a two-finger drag zooms without also panning.
	 *
	 * The anchor is released on the settle of the final `zoomTo`, not on `pointerup`, because the
	 * spring is usually still travelling when the fingers leave and dropping the anchor mid-flight
	 * would hand the rest of the zoom back to the centre pin — a visible lurch on release.
	 */
	const pinch = useRef<
		{ ids: [number, number]; startDist: number; startPph: number; target: number } | null
	>(null);
	const touchPoints = useRef(new Map<number, { x: number; y: number }>());

	useEffect(() => {
		const el = hostRef.current;
		if (!el || !opts.enablePinchZoom || typeof window === "undefined") return;
		const points = touchPoints.current;
		const gap = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
			Math.hypot(a.x - b.x, a.y - b.y);

		const down = (e: PointerEvent): void => {
			if (e.pointerType !== "touch") return;
			points.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pinch.current || points.size !== 2) return;
			const [ia, ib] = Array.from(points.keys());
			const a = points.get(ia)!;
			const b = points.get(ib)!;
			const dist = gap(a, b);
			if (dist < PINCH_MIN_DIST_PX) return;
			// The first finger already started a one-finger pan (a touch has no button and no modifier,
			// so `beginPan` claims it). Left running it would keep writing the offset from a drag whose
			// second finger has just turned the gesture into something else.
			endPan.current?.();
			cancelGlide();
			const rect = el.getBoundingClientRect();
			zoomAnchor((a.y + b.y) / 2 - rect.top);
			const startPph = pxPerHour.peek();
			pinch.current = { ids: [ia, ib], startDist: dist, startPph, target: startPph };
		};

		const move = (e: PointerEvent): void => {
			const p = points.get(e.pointerId);
			if (!p) return;
			p.x = e.clientX;
			p.y = e.clientY;
			const g = pinch.current;
			if (!g) return;
			const a = points.get(g.ids[0]);
			const b = points.get(g.ids[1]);
			if (!a || !b) return;
			// Best-effort: under the shipped `touch-action: pinch-zoom` the browser has usually claimed
			// the gesture already and sends `pointercancel` instead, which is the conflict this option
			// is switched off for.
			if (e.cancelable) e.preventDefault();
			const dist = gap(a, b);
			if (dist < PINCH_MIN_DIST_PX) return;
			g.target = g.startPph * (dist / g.startDist);
			zoomTo(g.target);
		};

		const end = (e: PointerEvent): void => {
			points.delete(e.pointerId);
			const g = pinch.current;
			if (!g || (points.has(g.ids[0]) && points.has(g.ids[1]))) return;
			pinch.current = null;
			// Re-targeting to the value the gesture already asked for changes nothing about where the
			// zoom lands; it is how the release registers its settle callback on the live spring.
			zoomTo(g.target, { onSettle: () => zoomAnchor(null) });
		};

		el.addEventListener("pointerdown", down);
		globalThis.addEventListener("pointermove", move, { passive: false });
		globalThis.addEventListener("pointerup", end);
		globalThis.addEventListener("pointercancel", end);
		return () => {
			el.removeEventListener("pointerdown", down);
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", end);
			globalThis.removeEventListener("pointercancel", end);
			points.clear();
			pinch.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [opts.enablePinchZoom, cancelGlide, zoomAnchor, zoomTo]);
	// #endregion

	useEffect(() => cancelGlide, [cancelGlide]);

	return {
		hostRef,
		scrollTop,
		viewportH,
		viewportW,
		gutter,
		contentHeight,
		maxScroll,
		visibleFraction,
		rtl,
		rows,
		awayFromNow,
		panning,
		scrollTo,
		scrollBy,
		scrollToFocus,
		scrollToNow,
		reveal,
		zoomAnchor,
		zoomTo,
		beginPan,
		handleKey,
		pointerAt,
	};
}
