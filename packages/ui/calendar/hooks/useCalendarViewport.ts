/**
 * @projective/ui/calendar — the day/week time-grid viewport engine (§Part 1.2). Owns the ONE vertical
 * scroll container shared by the time gutter + day columns and provides:
 *
 *  - **Virtualized time cells** — only the hour rows intersecting the viewport (plus an overscan band)
 *    are emitted, so a deeply-zoomed grid stays at a fixed DOM cost.
 *  - **Centered initial scroll** — the grid opens centered on the focus/now instant, so you scroll
 *    seamlessly up into the early hours and down past midnight (a padded −pad…24+pad range makes the
 *    midnight boundary reachable both ways — essential for cross-timezone scheduling).
 *  - **Zoom-anchored** — when `pxPerHour` (owned by the consumer) changes, the viewport re-pins the
 *    time at the viewport centre so a Ctrl-wheel zoom scales in place.
 *  - **2D pan** — middle-mouse drag, or Ctrl + left-drag, pans both axes without triggering the
 *    browser's native middle-click autoscroll / text selection (the handlers `preventDefault`).
 *  - **Return-to-present** — `awayFromNow` reports whether the now-line has scrolled out of view, and
 *    `scrollToNow()` glides back.
 *
 * Positions are pixels in content space; time↔pixel is the linear map `y = (minute - rangeStartMin)/60
 * * pxPerHour`. The consumer maps its own events with the same constants.
 */
import { batch, type Signal, useComputed, useSignal } from "@preact/signals";
import { useCallback, useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";

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
	/** Smoothly scroll the now-line back to the viewport centre. */
	scrollToNow: (behavior?: ScrollBehavior) => void;
	/** Re-centre on the focus instant. */
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

	// The time (minute) currently at the viewport centre — kept live so a zoom re-pins in place.
	const centerMinute = useRef((rangeStartMin + rangeEndMin) / 2);
	const didCenter = useRef(false);
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

	const scrollToNow = useCallback((behavior: ScrollBehavior = "smooth") => {
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

	// Re-pin the centre time when the zoom ACTUALLY changes so the grid scales in place. Guarded against
	// the mount run (where `centerMinute` is still the pre-centering default) so it never clobbers the
	// initial centre — it only fires on a real `pxPerHour` change.
	const prevPph = useRef(pxPerHour.value);
	useEffect(() => {
		const el = scrollRef.current;
		if (!el || !didCenter.current || el.clientHeight <= 0 || prevPph.current === pxPerHour.value) {
			prevPph.current = pxPerHour.value;
			return;
		}
		const target = minuteToY(centerMinute.current) - el.clientHeight / 2;
		el.scrollTop = Math.max(0, target);
		syncRef.current();
		prevPph.current = pxPerHour.value;
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

	// #region 2D pan (middle-mouse / Ctrl + left-drag)
	const drag = useRef({ active: false, x: 0, y: 0, sl: 0, st: 0 });
	const onPanPointerDown = useCallback((e: PointerEvent) => {
		const isMiddle = e.button === 1;
		const isCtrlLeft = e.button === 0 && (e.ctrlKey || e.metaKey);
		if (!isMiddle && !isCtrlLeft) return;
		const el = scrollRef.current;
		if (!el) return;
		e.preventDefault(); // suppress middle-click autoscroll / text selection
		drag.current = {
			active: true,
			x: e.clientX,
			y: e.clientY,
			sl: el.scrollLeft,
			st: el.scrollTop,
		};
		panning.value = true;
		const move = (ev: PointerEvent) => {
			if (!drag.current.active) return;
			el.scrollLeft = drag.current.sl - (ev.clientX - drag.current.x);
			el.scrollTop = drag.current.st - (ev.clientY - drag.current.y);
		};
		const up = () => {
			drag.current.active = false;
			panning.value = false;
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", up);
		};
		globalThis.addEventListener("pointermove", move);
		globalThis.addEventListener("pointerup", up);
	}, []);
	// #endregion

	return {
		scrollRef,
		contentHeight,
		scrollTop,
		viewportH,
		rows,
		awayFromNow,
		panning,
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
