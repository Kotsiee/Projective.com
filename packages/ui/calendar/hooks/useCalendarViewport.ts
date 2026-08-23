/**
 * @projective/ui/calendar — the day/week time-grid viewport engine (§Part 1.2). Owns the ONE vertical
 * scroll container shared by the time gutter + day columns and provides:
 *
 *  - **Virtualized time cells** — only the hour rows intersecting the viewport (plus an overscan band)
 *    are emitted, so a deeply-zoomed grid stays at a fixed DOM cost.
 *  - **Centered initial scroll** — the grid opens centered on the focus/now instant, so you scroll
 *    seamlessly up into the early hours and down past midnight (a padded −pad…24+pad range makes the
 *    midnight boundary reachable both ways — essential for cross-timezone scheduling).
 *  - **Zoom-anchored** — when `pxPerHour` (owned by the consumer) changes, the viewport re-pins so the
 *    grid scales IN PLACE: around the viewport centre by default, or around the timestamp under the
 *    pointer once {@link CalendarViewport.zoomAnchor} has been told where that pointer is.
 *  - **Interpolated zoom** — {@link CalendarViewport.zoomTo} springs `pxPerHour` toward a target and
 *    re-pins to the live anchor on every frame of the way, so the anchored instant does not slide.
 *  - **2D pan** — middle-mouse drag, or Ctrl + left-drag, pans both axes without triggering the
 *    browser's native middle-click autoscroll / text selection (the handlers `preventDefault`).
 *  - **Return-to-present** — `awayFromNow` reports whether the now-line has scrolled out of view, and
 *    `scrollToNow()` glides back.
 *
 * Positions are pixels in content space; time↔pixel is the linear map `y = (minute - rangeStartMin)/60
 * * pxPerHour`. The consumer maps its own events with the same constants.
 */
import { batch, type ReadonlySignal, type Signal, useComputed, useSignal } from "@preact/signals";
import { useCallback, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";
import { createSpring, type Spring, SPRING_STANDARD } from "../../core/motion.ts";
import {
	MOMENTUM_DECAY,
	MOMENTUM_MIN_RELEASE_V,
	MOMENTUM_MIN_V,
	VELOCITY_WINDOW_MS,
} from "../core/scene-build.ts";

/**
 * The behaviour a PROGRAMMATIC scroll of this viewport may use.
 *
 * A smooth scroll is a frame-driven animation, and in this engine the scroll offset is not decoration
 * — both timed views derive their virtualized window from `scrollTop`, so the offset IS which period
 * the grid renders. It therefore degrades to an instant jump wherever a frame may never arrive:
 *
 *  - `prefers-reduced-motion: reduce` — the §B.5 jump-to-final rule. CSS cannot apply it to a JS
 *    `scrollTo`, so it has to be honoured here or not at all.
 *  - a hidden/background document, where the animation clock is paused. Measured: with the tab
 *    hidden, `scrollTo({ behavior: "smooth" })` never advances `scrollTop` at all, so the header,
 *    period label and mini-map moved to the next week while the grid stayed on the previous one.
 *
 * The instant path additionally re-reads the container synchronously (see `syncRef`), which the
 * smooth path cannot do because it has not arrived yet.
 */
export function scrollBehaviorFor(): ScrollBehavior {
	if (typeof document !== "undefined" && document.hidden) return "auto";
	return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

// #region Shared zoom vocabulary
/*
 * Declared HERE and imported by `useCanvasViewport.ts` rather than restated there. The two hooks are
 * deliberate twins — Day and Week diverging on a zoom is exactly the class of bug this engine keeps
 * having to log — and a constant copied into both files is a divergence waiting for one edit.
 */

/**
 * How long (ms) a zoom anchor survives without further zoom activity.
 *
 * An anchor is a claim about where the reader's attention is, and that claim goes stale: a wheel
 * gesture is a burst of notches milliseconds apart, but the NEXT zoom minutes later belongs to
 * whatever the reader is looking at then, which — with the pointer long since moved — is the centre.
 * Refreshed by every zoom step and by every {@link CalendarViewport.zoomTo} call, so a spring that
 * is still settling, or a pinch held motionless between two squeezes, keeps its anchor.
 */
export const ZOOM_ANCHOR_HOLD_MS = 600;
/**
 * How far (px) the cursor may drift and still count as the SAME anchor.
 *
 * Small, because it is not a tolerance for imprecision — it is the difference between "the reader is
 * still holding this moment still" and "the reader has moved to a different one". Two pixels covers
 * the sub-pixel jitter a high-resolution pointer reports without ever swallowing a deliberate move.
 */
export const ZOOM_ANCHOR_SLOP_PX = 2;

/**
 * Settle threshold for the zoom spring, in px/hour.
 *
 * A twentieth of a pixel per hour is far below the smallest change the grid can draw, so stopping
 * there ends the loop a frame or two earlier than the integrator's default without any visible
 * difference in where the zoom lands.
 */
export const ZOOM_SETTLE_EPSILON = 0.05;

/**
 * The zoom bounds {@link UseCalendarViewportOptions.zoomRange} falls back to.
 *
 * A guard against a degenerate axis, NOT a design decision: the consumer owns the real range (the
 * calendar island's own is 26–168 px/hour, and it also switches VIEW at those ends). This only stops
 * a pinch from driving `pxPerHour` to a value at which an hour is a hundredth of a pixel tall.
 */
export const ZOOM_RANGE_DEFAULT: readonly [number, number] = [8, 480];

/** Below this separation (px) two touch points are too close for their ratio to mean anything. */
export const PINCH_MIN_DIST_PX = 24;

/**
 * A live zoom anchor: a viewport y, the minute that sat under it when the anchor was set, and the
 * instant the hold lapses.
 *
 * The minute is captured ONCE. Every subsequent zoom step re-solves the offset from it in closed
 * form rather than re-reading the minute back out of the offset, because re-reading feeds each
 * step's own rounding into the next one — and a ten-notch wheel gesture would then walk the
 * timestamp out from under the cursor a fraction of a minute at a time. It is the same reason the
 * centre pin writes its offset directly instead of through the bookkeeping `write` path.
 */
export interface ZoomAnchorState {
	/** Viewport-relative y (px), measured from the scroll viewport's own top edge. */
	y: number;
	/** The minute the anchor holds still — captured at `zoomAnchor()`, never re-derived. */
	minute: number;
	/** Epoch ms after which the anchor is stale and the viewport returns to centre-pinning. */
	expiresAt: number;
}

/** Options for {@link CalendarViewport.zoomTo}. */
export interface ZoomToOptions {
	/**
	 * Run when the spring reaches its target. A call SUPERSEDED by a later `zoomTo` drops its
	 * callback rather than firing it, because that zoom did not settle — something else did.
	 */
	onSettle?: () => void;
}

/** Content-space y (px) of `minute`, at an EXPLICIT zoom rather than the ambient signal's. */
export function zoomYAtMinute(minute: number, rangeStartMin: number, pxPerHour: number): number {
	return ((minute - rangeStartMin) / 60) * pxPerHour;
}

/** The minute at content-space `y`, at an EXPLICIT zoom rather than the ambient signal's. */
export function zoomMinuteAtY(y: number, rangeStartMin: number, pxPerHour: number): number {
	return rangeStartMin + (y / pxPerHour) * 60;
}

/**
 * The fraction of one 24 h period a `viewportH`-tall window shows at `pxPerHour`, clamped to `0..1`.
 *
 * A period is `24 * pxPerHour` px tall, so this is the share of it in view — the size a scrollbar
 * handle takes of its track. Published from the hooks that hold both measurements rather than
 * re-derived by every consumer that wants it, so two handles on one surface cannot disagree.
 */
export function visibleFractionOf(viewportH: number, pxPerHour: number): number {
	const period = 24 * pxPerHour;
	if (!(period > 0) || !(viewportH > 0)) return 0;
	const f = viewportH / period;
	return f > 1 ? 1 : f;
}
// #endregion

export interface HourRow {
	/** The absolute hour index (may be negative in the top pad, or ≥ 24 in the bottom pad). */
	hour: number;
	/** The hour-of-day (0–23) for labelling. */
	hourOfDay: number;
	/** Content-space y (px) of this hour line. */
	y: number;
	/** Whether this row is the midnight boundary of a day (hourOfDay === 0). */
	dayBoundary: boolean;
}

export interface UseCalendarViewportOptions {
	/** Pixels per hour — the zoom, owned by the consumer (a signal). */
	pxPerHour: Signal<number>;
	/** The vertical range's start, in minutes from midnight (e.g. -180 for a 3h top pad). */
	rangeStartMin: number;
	/** The vertical range's end, in minutes from midnight (e.g. 1620 for a 3h bottom pad past 24h). */
	rangeEndMin: number;
	/** Content-space y of the live now-line, or null when it should not drive return-to-present. */
	nowY: () => number | null;
	/** Content-space y to centre on first layout. */
	focusY: () => number;
	/** Extra hour rows rendered beyond each viewport edge (default 2). */
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
	 * `styles/grid.css` sets `touch-action: pinch-zoom` on the grid viewport, which hands two-finger
	 * gestures to the BROWSER so that page zoom keeps working on a phone — a logged WCAG 1.4.4
	 * decision, not an oversight. Turning this on without also setting `touch-action: none` gives the
	 * gesture two owners: the browser zooms the page while the hook zooms the grid. Setting
	 * `touch-action: none` makes the hook the only owner and takes pinch-to-zoom away from the
	 * reader, which is the accessibility decision being reversed. That trade is a human's to make, so
	 * the gesture ships implemented and switched off.
	 */
	enablePinchZoom?: boolean;
}

export interface CalendarViewport {
	/** Attach to the scroll container. */
	scrollRef: RefObject<HTMLDivElement>;
	/** Total content height (px) for the inner sizer. */
	contentHeight: Signal<number>;
	/** Live scroll offset (px) of the container — for a consumer that virtualizes its own content (day timeline). */
	scrollTop: Signal<number>;
	/** Live viewport height (px) of the container. */
	viewportH: Signal<number>;
	/** The hour rows currently in the window (virtualized). */
	rows: Signal<HourRow[]>;
	/** Whether — and which way — the now-line sits outside the viewport (`null` when in view). */
	awayFromNow: Signal<"up" | "down" | null>;
	/** Whether a pan drag is in progress (suppresses transitions / sets the grabbing cursor). */
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
	 * `viewportY` is measured from the scroll viewport's own top edge — the same space a pointer's
	 * `clientY - containerRect.top` lands in — so a caller forwards a cursor position without having
	 * to know the offset. The anchor also lapses on its own after {@link ZOOM_ANCHOR_HOLD_MS} of no
	 * zoom activity, so a caller that forgets to clear it degrades to centre-pinning rather than
	 * holding a minute the reader stopped caring about.
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
	/** Scroll the now-line back to the viewport centre (default {@link scrollBehaviorFor}). */
	scrollToNow: (behavior?: ScrollBehavior) => void;
	/**
	 * Re-centre on the focus instant. This is the ONE way a consumer should perform a navigation jump:
	 * the `"auto"` path re-reads the container immediately, so a viewport that virtualizes off
	 * `scrollTop` cannot be left rendering the period it was showing before the jump.
	 */
	scrollToFocus: (behavior?: ScrollBehavior) => void;
	/** Pointer-down handler for the pan surface (middle-mouse, or Ctrl + left button). */
	onPanPointerDown: (e: PointerEvent) => void;
}

export function useCalendarViewport(opts: UseCalendarViewportOptions): CalendarViewport {
	const { pxPerHour, rangeStartMin, rangeEndMin, nowY, focusY, overscan = 2 } = opts;

	const scrollRef = useRef<HTMLDivElement>(null);
	const scrollTop = useSignal(0);
	const viewportH = useSignal(0);
	const panning = useSignal(false);

	const spanHours = (rangeEndMin - rangeStartMin) / 60;
	const contentHeight = useComputed(() => spanHours * pxPerHour.value);
	const visibleFraction = useComputed(() => visibleFractionOf(viewportH.value, pxPerHour.value));

	// The time (minute) currently at the viewport centre — kept live so a zoom re-pins in place.
	const centerMinute = useRef((rangeStartMin + rangeEndMin) / 2);
	const didCenter = useRef(false);
	// The cursor anchor a zoom pins to INSTEAD of the centre, when one is live. Declared up here with
	// the other pinning state because the re-pin reads it long before the gesture code that sets it.
	const zoomAnchorRef = useRef<ZoomAnchorState | null>(null);
	// The live scroll reader, published by the scroll effect so a PROGRAMMATIC scroll can re-sync the
	// scrollTop/viewport signals immediately — some environments (and a hidden/background tab) defer the
	// async `scroll` event, which would otherwise leave a day-timeline virtualizing the wrong window.
	const syncRef = useRef<() => void>(() => {});

	const yToMinute = useCallback(
		(y: number) => rangeStartMin + (y / pxPerHour.value) * 60,
		[pxPerHour, rangeStartMin],
	);
	const minuteToY = useCallback(
		(m: number) => ((m - rangeStartMin) / 60) * pxPerHour.value,
		[pxPerHour, rangeStartMin],
	);

	// #region Scroll + resize wiring
	useEffect(() => {
		const el = scrollRef.current;
		if (!el || typeof window === "undefined") return;
		const read = () => {
			batch(() => {
				scrollTop.value = el.scrollTop;
				viewportH.value = el.clientHeight;
			});
			if (el.clientHeight > 0) {
				centerMinute.current = yToMinute(el.scrollTop + el.clientHeight / 2);
			}
		};
		syncRef.current = read;
		read();
		el.addEventListener("scroll", read, { passive: true });
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
		ro?.observe(el);
		globalThis.addEventListener("resize", read);
		return () => {
			el.removeEventListener("scroll", read);
			ro?.disconnect();
			globalThis.removeEventListener("resize", read);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [yToMinute]);
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
		for (let hr = Math.max(firstHour, visFirst); hr <= Math.min(lastHour, visLast); hr++) {
			const hourOfDay = ((hr % 24) + 24) % 24;
			out.push({ hour: hr, hourOfDay, y: minuteToY(hr * 60), dayBoundary: hourOfDay === 0 });
		}
		return out;
	});
	// #endregion

	// #region Centre on first layout + re-pin on zoom
	const scrollToFocus = useCallback((behavior: ScrollBehavior = "auto") => {
		const el = scrollRef.current;
		if (!el) return;
		const target = focusY() - el.clientHeight / 2;
		el.scrollTo({ top: Math.max(0, target), behavior });
		// Reflect the programmatic scroll now (don't wait for the deferred `scroll` event) so a consumer
		// virtualizing off `scrollTop` renders the correct window immediately.
		if (behavior === "auto") syncRef.current();
	}, [focusY]);

	const scrollToNow = useCallback((behavior: ScrollBehavior = scrollBehaviorFor()) => {
		const el = scrollRef.current;
		const y = nowY();
		if (!el || y == null) return;
		el.scrollTo({ top: Math.max(0, y - el.clientHeight / 2), behavior });
		if (behavior === "auto") syncRef.current();
	}, [nowY]);

	useEffect(() => {
		if (didCenter.current) return;
		const el = scrollRef.current;
		if (!el || viewportH.value <= 0) return;
		// Wait until the container is a BOUNDED scroll viewport. On the first layout the height can be
		// transiently unbounded (≈ the content height, before the surface's height cap applies), which
		// would centre against the wrong viewport and latch to the top — so defer until it can scroll.
		if (el.scrollHeight - el.clientHeight < 40) return;
		didCenter.current = true;
		scrollToFocus("auto");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [viewportH.value, contentHeight.value]);

	/**
	 * Re-solve the offset for the CURRENT zoom — from the anchored minute when one is live, from the
	 * centre minute otherwise. Every zoom step routes through here, so the anchored and centred cases
	 * cannot answer differently about clamping, bookkeeping or ordering.
	 */
	const repinZoom = useCallback((): void => {
		const el = scrollRef.current;
		if (!el) return;
		const h = el.clientHeight;
		const pph = pxPerHour.peek();
		if (h <= 0 || !(pph > 0)) return;
		const max = Math.max(0, el.scrollHeight - h);
		const now = Date.now();
		const anchor = zoomAnchorRef.current;
		if (anchor && now <= anchor.expiresAt) {
			const y = zoomYAtMinute(anchor.minute, rangeStartMin, pph) - anchor.y;
			el.scrollTop = Math.min(max, Math.max(0, y));
			anchor.expiresAt = now + ZOOM_ANCHOR_HOLD_MS;
		} else {
			zoomAnchorRef.current = null;
			const y = zoomYAtMinute(centerMinute.current, rangeStartMin, pph) - h / 2;
			el.scrollTop = Math.min(max, Math.max(0, y));
		}
		// `read()` re-derives `centerMinute` from where the offset ACTUALLY landed, which is the honest
		// record in both branches: an anchored zoom genuinely moves the centre, and a clamped one lands
		// somewhere neither branch asked for. The anchor's own minute is untouched by it.
		syncRef.current();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rangeStartMin]);

	/*
	 * Re-pin when the zoom ACTUALLY changes so the grid scales in place. Guarded against the mount run
	 * (where `centerMinute` is still the pre-centering default) so it never clobbers the initial
	 * centre — it only fires on a real `pxPerHour` change.
	 *
	 * A LAYOUT effect, for two reasons a plain one cannot satisfy. The offset is clamped by the
	 * container's `scrollHeight`, which only carries the new zoom's content height once the sizer has
	 * been committed — a pre-commit write would be clamped by the OLD height, so zooming in near the
	 * bottom of the axis would silently land short. And Preact defers `useEffect` behind a frame, so
	 * an interpolated zoom would re-pin one frame after the zoom it belongs to, which for a spring
	 * running over a dozen frames is a visible slide rather than a still anchor.
	 */
	const prevPph = useRef(pxPerHour.value);
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (!el || !didCenter.current || el.clientHeight <= 0 || prevPph.current === pxPerHour.value) {
			prevPph.current = pxPerHour.value;
			return;
		}
		prevPph.current = pxPerHour.value;
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

	// #region 2D pan (middle-mouse / Ctrl + left-drag) + release momentum
	// A genuine one-finger TOUCH drag on this container is native — the browser already gives it real
	// OS momentum for free (`.cal-tg__scroll { touch-action: pan-y }`) — so momentum only needs adding
	// HERE, for the synthetic middle-mouse / Ctrl-drag pan, which has none of its own.
	const drag = useRef({ active: false, x: 0, y: 0, sl: 0, st: 0 });
	const flingRaf = useRef<number | null>(null);
	const velocitySamples = useRef<{ t: number; y: number }[]>([]);

	const cancelFling = useCallback(() => {
		if (flingRaf.current != null) {
			globalThis.cancelAnimationFrame?.(flingRaf.current);
			flingRaf.current = null;
		}
	}, []);

	/** Momentum (§Part 4) for the native scroller — writes `el.scrollTop` directly, decelerating from
	 *  release velocity `v` (px/ms); see `useCanvasViewport.ts`'s twin for the per-constant reasoning. */
	const fling = useCallback((v: number) => {
		const raf = globalThis.requestAnimationFrame;
		if (typeof raf !== "function") return;
		let velocity = v;
		let last = Date.now();
		const step = () => {
			const el = scrollRef.current;
			if (!el) {
				flingRaf.current = null;
				return;
			}
			const now = Date.now();
			// Capped for the same reason `useCanvasViewport.ts`'s fling caps it: a hidden-tab gap must
			// not integrate a stale velocity across the whole elapsed time in one jump.
			const dt = Math.min(48, Math.max(1, now - last));
			last = now;
			const before = el.scrollTop;
			el.scrollTop = before + velocity * dt;
			velocity *= Math.pow(MOMENTUM_DECAY, dt / 16.67);
			if (Math.abs(velocity) < MOMENTUM_MIN_V || el.scrollTop === before) {
				flingRaf.current = null;
				return;
			}
			flingRaf.current = raf(step);
		};
		flingRaf.current = raf(step);
	}, []);

	const onPanPointerDown = useCallback((e: PointerEvent) => {
		const isMiddle = e.button === 1;
		const isCtrlLeft = e.button === 0 && (e.ctrlKey || e.metaKey);
		if (!isMiddle && !isCtrlLeft) return;
		const el = scrollRef.current;
		if (!el) return;
		e.preventDefault(); // suppress middle-click autoscroll / text selection
		cancelFling();
		drag.current = {
			active: true,
			x: e.clientX,
			y: e.clientY,
			sl: el.scrollLeft,
			st: el.scrollTop,
		};
		velocitySamples.current = [{ t: Date.now(), y: e.clientY }];
		panning.value = true;
		const move = (ev: PointerEvent) => {
			if (!drag.current.active) return;
			el.scrollLeft = drag.current.sl - (ev.clientX - drag.current.x);
			el.scrollTop = drag.current.st - (ev.clientY - drag.current.y);
			const now = Date.now();
			const samples = velocitySamples.current;
			samples.push({ t: now, y: ev.clientY });
			while (samples.length > 2 && now - samples[0].t > VELOCITY_WINDOW_MS) samples.shift();
		};
		const up = (ev: PointerEvent) => {
			drag.current.active = false;
			panning.value = false;
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", up);
			const samples = velocitySamples.current;
			const first = samples[0];
			const now = Date.now();
			if (first && now - first.t <= VELOCITY_WINDOW_MS + 16 && now - first.t > 0) {
				const v = -(ev.clientY - first.y) / (now - first.t);
				if (Math.abs(v) >= MOMENTUM_MIN_RELEASE_V) fling(v);
			}
		};
		globalThis.addEventListener("pointermove", move);
		globalThis.addEventListener("pointerup", up);
	}, [cancelFling, fling]);

	useEffect(() => cancelFling, [cancelFling]);
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
		const el = scrollRef.current;
		const pph = pxPerHour.peek();
		if (viewportY == null || !Number.isFinite(viewportY) || !el || !(pph > 0)) {
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
			minute: zoomMinuteAtY(el.scrollTop + viewportY, rangeStartMin, pph),
			expiresAt: Date.now() + ZOOM_ANCHOR_HOLD_MS,
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rangeStartMin]);

	const zoomTo = useCallback((target: number, o?: ZoomToOptions): () => void => {
		const [lo, hi] = zoomRangeRef.current;
		const next = Math.min(hi, Math.max(lo, target));
		cancelFling();
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
	}, [cancelFling]);

	useEffect(() => () => {
		for (const off of zoomUnsubs.current) off();
		zoomUnsubs.current = [];
		zoomSpring.current?.dispose();
		zoomSpring.current = null;
	}, []);
	// #endregion

	// #region Pinch zoom (opt-in — see UseCalendarViewportOptions.enablePinchZoom)
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
		const el = scrollRef.current;
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
			cancelFling();
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
	}, [opts.enablePinchZoom, cancelFling, zoomAnchor, zoomTo]);
	// #endregion

	return {
		scrollRef,
		contentHeight,
		scrollTop,
		viewportH,
		visibleFraction,
		rows,
		awayFromNow,
		panning,
		zoomAnchor,
		zoomTo,
		scrollToNow,
		scrollToFocus,
		onPanPointerDown,
	};
}

/** The shared pixel/time constants a consumer needs to align its own event positions with the grid. */
export function gridGeometry(pxPerHour: number, rangeStartMin: number) {
	return {
		/** Content-space y (px) for an absolute minute-of-day. */
		yFor: (minute: number) => ((minute - rangeStartMin) / 60) * pxPerHour,
		/** Height (px) for a duration in minutes. */
		hFor: (minutes: number) => (minutes / 60) * pxPerHour,
	};
}
