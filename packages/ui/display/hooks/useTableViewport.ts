/**
 * `useTableViewport` — the `DataTable` virtualizer. Windows the rows against the page or a scroll
 * container, keeps the viewer's place when rows change height (a measured row above the fold, or a
 * zoom step resizing every row), and fires `onReachEnd` near the tail for infinite scroll.
 *
 * The visible range is the only reactive output, and it is written only when it changes, so a
 * scroll that stays inside the overscan band re-renders nothing.
 */
import { signal } from "@preact/signals";
import type { RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import {
	fixedMetrics,
	rescaleScroll,
	type RowMetrics,
	VariableMetrics,
	visibleRange,
} from "../core/table-metrics.ts";

/** A fixed row height in px, or an estimate refined by measuring each rendered row. */
export type TableRowHeight = number | { estimate: number };

/** Options for {@link useTableViewport}. */
export interface TableViewportOptions {
	/** Stable row keys, in display order. */
	keys: readonly string[];
	rowHeight: TableRowHeight;
	/** `window` scrolls with the page; otherwise the element that scrolls. */
	scroll: "window" | RefObject<HTMLElement>;
	/** The element the rows are positioned in (its top is row 0's top). */
	listRef: RefObject<HTMLElement>;
	/** The sticky header, whose height is subtracted from the visible area when scrolling a row in. */
	headRef?: RefObject<HTMLElement>;
	overscan: number;
	/** Rows rendered before the viewport is known (server render and first paint). */
	initialRows: number;
	onReachEnd?: () => void;
	endThreshold: number;
}

/** What {@link useTableViewport} returns. */
export interface TableViewport {
	range: { start: number; end: number };
	metrics: RowMetrics;
	/** Ref callback for a rendered row carrying `data-key`; measures it in variable-height mode. */
	measureRow: (el: HTMLElement | null) => void;
	/** Scroll the least distance that brings row `index` fully into view. */
	scrollIntoView: (index: number) => void;
	/** How many rows fit in the visible area (PageUp / PageDown step). */
	pageRows: () => number;
}

interface Frame {
	/** Scroll position within the list, px (negative while the list starts below the viewport top). */
	offset: number;
	/** Visible height, px. */
	height: number;
}

function readFrame(
	scroll: TableViewportOptions["scroll"],
	list: HTMLElement | null,
): Frame | null {
	if (!list || typeof window === "undefined") return null;
	if (scroll === "window") {
		return { offset: -list.getBoundingClientRect().top, height: globalThis.innerHeight };
	}
	const scroller = scroll.current;
	if (!scroller) return null;
	const listTop = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
	return { offset: -listTop, height: scroller.clientHeight };
}

function scrollBy(scroll: TableViewportOptions["scroll"], delta: number): void {
	if (delta === 0 || typeof window === "undefined") return;
	if (scroll === "window") globalThis.scrollBy({ top: delta, behavior: "instant" });
	else if (scroll.current) scroll.current.scrollTop += delta;
}

export function useTableViewport(opts: TableViewportOptions): TableViewport {
	const { keys, rowHeight, scroll, listRef, headRef, overscan, initialRows } = opts;
	const count = keys.length;
	const fixed = typeof rowHeight === "number" ? rowHeight : null;
	const estimate = typeof rowHeight === "number" ? rowHeight : rowHeight.estimate;

	const measured = useRef(new Map<string, number>());
	const version = useMemo(() => signal(0), []);
	const range = useMemo(
		() => signal({ start: 0, end: Math.min(count, initialRows) - 1 }),
		[],
	);
	const reachEnd = useRef(opts.onReachEnd);
	reachEnd.current = opts.onReachEnd;
	const firedAt = useRef(-1);
	const frameRef = useRef(0);

	const metrics = useMemo<RowMetrics>(
		() =>
			fixed !== null
				? fixedMetrics(count, fixed)
				: new VariableMetrics(keys.map((k) => measured.current.get(k) ?? estimate)),
		[keys, fixed, estimate],
	);
	const metricsRef = useRef(metrics);
	metricsRef.current = metrics;
	version.value;

	const update = useCallback(() => {
		frameRef.current = 0;
		const frame = readFrame(scroll, listRef.current);
		if (!frame) return;
		const m = metricsRef.current;
		const top = Math.max(0, frame.offset);
		const visible = frame.height + Math.min(0, frame.offset);
		const next = visibleRange(m, top, visible, overscan);
		const prev = range.peek();
		if (next.start !== prev.start || next.end !== prev.end) range.value = next;

		const remaining = m.total() - (frame.offset + frame.height);
		if (reachEnd.current && remaining <= opts.endThreshold && firedAt.current !== m.count) {
			firedAt.current = m.count;
			reachEnd.current();
		}
	}, [scroll, listRef, overscan, opts.endThreshold]);

	const schedule = useCallback(() => {
		if (frameRef.current || typeof requestAnimationFrame === "undefined") return;
		frameRef.current = requestAnimationFrame(update);
	}, [update]);

	// #region Scroll + resize wiring
	useEffect(() => {
		if (typeof window === "undefined") return;
		const source: EventTarget | null = scroll === "window" ? window : scroll.current;
		source?.addEventListener("scroll", schedule, { passive: true });
		globalThis.addEventListener("resize", schedule);
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
		const list = listRef.current;
		if (observer && list?.parentElement) observer.observe(list.parentElement);
		if (observer && scroll !== "window" && scroll.current) observer.observe(scroll.current);
		return () => {
			source?.removeEventListener("scroll", schedule);
			globalThis.removeEventListener("resize", schedule);
			observer?.disconnect();
			if (frameRef.current) cancelAnimationFrame(frameRef.current);
			frameRef.current = 0;
		};
	}, [scroll, listRef, schedule]);

	useLayoutEffect(() => {
		update();
	}, [metrics, update]);
	// #endregion

	// #region Zoom: keep the top row in place when every row changes height
	const lastFixed = useRef(fixed);
	useLayoutEffect(() => {
		const from = lastFixed.current;
		lastFixed.current = fixed;
		if (from === null || fixed === null || from === fixed) return;
		const frame = readFrame(scroll, listRef.current);
		if (!frame || frame.offset <= 0) return;
		scrollBy(scroll, rescaleScroll(frame.offset, from, fixed) - frame.offset);
	}, [fixed, scroll, listRef]);
	// #endregion

	// #region Variable heights: measure, and hold the viewer's place when a row above them grows
	const observerRef = useRef<ResizeObserver | null>(null);
	const onResize = useCallback((entries: ResizeObserverEntry[]) => {
		const m = metricsRef.current;
		if (!(m instanceof VariableMetrics)) return;
		const frame = readFrame(scroll, listRef.current);
		const firstVisible = frame ? m.indexAt(Math.max(0, frame.offset)) : 0;
		let shift = 0;
		let changed = false;
		for (const entry of entries) {
			const el = entry.target as HTMLElement;
			if (!el.isConnected) {
				observerRef.current?.unobserve(el);
				continue;
			}
			const key = el.dataset.key;
			const index = Number(el.dataset.index);
			if (key === undefined || !Number.isInteger(index)) continue;
			const size = el.offsetHeight;
			if (size <= 0) continue;
			measured.current.set(key, size);
			const delta = m.setSize(index, size);
			if (delta === 0) continue;
			changed = true;
			if (index < firstVisible) shift += delta;
		}
		if (!changed) return;
		scrollBy(scroll, shift);
		version.value++;
		schedule();
	}, [scroll, listRef, schedule]);

	useEffect(() => () => observerRef.current?.disconnect(), []);

	const measureRow = useCallback((el: HTMLElement | null) => {
		if (!el || fixed !== null || typeof ResizeObserver === "undefined") return;
		observerRef.current ??= new ResizeObserver(onResize);
		observerRef.current.observe(el);
	}, [fixed, onResize]);
	// #endregion

	// #region Keyboard helpers
	const occluded = useCallback((): number => {
		if (scroll !== "window") return 0;
		const head = headRef?.current?.getBoundingClientRect();
		return head ? Math.max(0, head.bottom) : 0;
	}, [scroll, headRef]);

	const scrollIntoView = useCallback((index: number) => {
		const frame = readFrame(scroll, listRef.current);
		if (!frame) return;
		const m = metricsRef.current;
		const top = m.offsetOf(index);
		const bottom = top + m.sizeOf(index);
		const viewTop = frame.offset + occluded();
		const viewBottom = frame.offset + frame.height;
		if (top < viewTop) scrollBy(scroll, top - viewTop);
		else if (bottom > viewBottom) scrollBy(scroll, bottom - viewBottom);
		update();
	}, [scroll, listRef, occluded, update]);

	const pageRows = useCallback((): number => {
		const frame = readFrame(scroll, listRef.current);
		const m = metricsRef.current;
		if (!frame || m.count === 0) return 10;
		const visible = frame.height - occluded();
		return Math.max(
			1,
			Math.floor(visible / Math.max(1, m.sizeOf(m.indexAt(Math.max(0, frame.offset))))),
		);
	}, [scroll, listRef, occluded]);
	// #endregion

	const current = range.value;
	const clamped = {
		start: Math.min(current.start, Math.max(0, count - 1)),
		end: Math.min(current.end, count - 1),
	};
	return { range: clamped, metrics, measureRow, scrollIntoView, pageRows };
}
