/**
 * `useVirtualScroll` — 1D windowed rendering for unbounded datasets (§C.5). Renders only the rows
 * intersecting the viewport plus an overscan band, so a million-row Table/DataView/Tree/Scroller
 * stays at a fixed DOM cost.
 *
 * Two scroll sources (the task's requirement): the list's **own scroll container** (`parentRef` +
 * default) or the **window/page** (`useWindow`). Item sizes may be a fixed number, a per-index
 * function (estimate), or measured at runtime via `measureElement` for variable heights — measured
 * sizes override estimates and the offset table recomputes with `@preact/signals` batching. An
 * `onReachEnd` fires near the tail for infinite/lazy loading.
 */
import { batch, signal } from "@preact/signals";
import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import type { RefObject } from "preact";

export interface VirtualItem {
	index: number;
	/** Offset from the start of the scroll content, px. */
	start: number;
	size: number;
}

export interface UseVirtualScrollOptions {
	/** Total number of items in the dataset. */
	count: number;
	/** Fixed row size, or an estimate per index (px). Cross-axis for `horizontal`. */
	itemSize: number | ((index: number) => number);
	/** Rows rendered beyond each edge to smooth fast scrolling (default 4). */
	overscan?: number;
	/** Scroll along the inline axis instead of the block axis (default false). */
	horizontal?: boolean;
	/** The scroll container (block that has `overflow:auto`). Required unless `useWindow`. */
	parentRef?: RefObject<HTMLElement>;
	/** Use the window/page as the scroll source; `parentRef` then measures the list's page offset. */
	useWindow?: boolean;
	/** Distance from the end (px) at which `onReachEnd` fires — for infinite scroll (default 240). */
	endThreshold?: number;
	/** Called once when the tail comes into view; debounced against re-fire until the range moves. */
	onReachEnd?: () => void;
}

export interface UseVirtualScrollResult {
	/** The items currently in the window (with absolute offsets). */
	virtualItems: VirtualItem[];
	/** Total scrollable size of all items, px — set on the inner sizer. */
	totalSize: number;
	range: { start: number; end: number };
	/** Ref callback for a rendered row (reads `data-index`) to record its real measured size. */
	measureElement: (el: HTMLElement | null) => void;
	/** Programmatically scroll a given index to the start of the viewport. */
	scrollToIndex: (index: number) => void;
}

export function useVirtualScroll(opts: UseVirtualScrollOptions): UseVirtualScrollResult {
	const {
		count,
		itemSize,
		overscan = 4,
		horizontal = false,
		parentRef,
		useWindow = false,
		endThreshold = 240,
		onReachEnd,
	} = opts;

	// Live scroll/viewport signals — writing them re-renders only the consuming component.
	const scrollOffset = useMemo(() => signal(0), []);
	const viewport = useMemo(() => signal(0), []);
	const measured = useRef<Map<number, number>>(new Map());
	const lastEndFired = useRef(-1);
	const versionRef = useRef(0);
	const version = useMemo(() => signal(0), []);

	const estimate = useCallback(
		(i: number) => (typeof itemSize === "function" ? itemSize(i) : itemSize),
		[itemSize],
	);

	// Prefix-sum offset table; recomputed when count, estimate, or a measurement changes.
	const offsets = useMemo(() => {
		version.value; // subscribe to remeasurements
		const arr = new Float64Array(count + 1);
		for (let i = 0; i < count; i++) {
			arr[i + 1] = arr[i] + (measured.current.get(i) ?? estimate(i));
		}
		return arr;
	}, [count, estimate, version.value]);

	const totalSize = offsets[count] ?? 0;

	// Binary search for the first item whose end passes `offset`.
	const findIndex = (offset: number): number => {
		let lo = 0;
		let hi = count - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (offsets[mid + 1] <= offset) lo = mid + 1;
			else hi = mid - 1;
		}
		return Math.min(count - 1, Math.max(0, lo));
	};

	const so = scrollOffset.value;
	const vp = viewport.value;
	const start = count === 0 ? 0 : Math.max(0, findIndex(so) - overscan);
	const end = count === 0 ? -1 : Math.min(count - 1, findIndex(so + vp) + overscan);

	const virtualItems: VirtualItem[] = [];
	for (let i = start; i <= end; i++) {
		virtualItems.push({ index: i, start: offsets[i], size: offsets[i + 1] - offsets[i] });
	}

	// #region Scroll wiring
	useEffect(() => {
		if (typeof window === "undefined") return;
		const parent = parentRef?.current;

		const read = () => {
			if (useWindow) {
				const rect = parent?.getBoundingClientRect();
				const listTop = (rect?.top ?? 0) + globalThis.scrollY;
				const listLeft = (rect?.left ?? 0) + globalThis.scrollX;
				batch(() => {
					scrollOffset.value = horizontal
						? Math.max(0, globalThis.scrollX - listLeft)
						: Math.max(0, globalThis.scrollY - listTop);
					viewport.value = horizontal ? globalThis.innerWidth : globalThis.innerHeight;
				});
			} else if (parent) {
				batch(() => {
					scrollOffset.value = horizontal ? parent.scrollLeft : parent.scrollTop;
					viewport.value = horizontal ? parent.clientWidth : parent.clientHeight;
				});
			}
		};

		read();
		const source: Window | HTMLElement | null = useWindow ? window : (parent ?? null);
		if (!source) return;
		const onScroll = () => read();
		source.addEventListener("scroll", onScroll, { passive: true });
		globalThis.addEventListener("resize", onScroll);
		return () => {
			source.removeEventListener("scroll", onScroll);
			globalThis.removeEventListener("resize", onScroll);
		};
	}, [parentRef, useWindow, horizontal]);
	// #endregion

	// #region Infinite-scroll tail
	useEffect(() => {
		if (!onReachEnd || count === 0) return;
		if (totalSize - (so + vp) <= endThreshold && lastEndFired.current !== count) {
			lastEndFired.current = count;
			onReachEnd();
		}
	}, [so, vp, totalSize, count, endThreshold, onReachEnd]);
	// #endregion

	const measureElement = useCallback((el: HTMLElement | null) => {
		if (!el) return;
		const idx = Number(el.dataset.index);
		if (Number.isNaN(idx)) return;
		const size = horizontal ? el.offsetWidth : el.offsetHeight;
		if (size > 0 && measured.current.get(idx) !== size) {
			measured.current.set(idx, size);
			versionRef.current++;
			version.value = versionRef.current;
		}
	}, [horizontal]);

	const scrollToIndex = useCallback((index: number) => {
		const target = offsets[Math.max(0, Math.min(count - 1, index))] ?? 0;
		if (useWindow) {
			const parent = parentRef?.current;
			const rect = parent?.getBoundingClientRect();
			const base = (rect?.top ?? 0) + globalThis.scrollY;
			globalThis.scrollTo({ top: base + target, behavior: "smooth" });
		} else if (parentRef?.current) {
			parentRef.current.scrollTo({ [horizontal ? "left" : "top"]: target, behavior: "smooth" });
		}
	}, [offsets, count, useWindow, parentRef, horizontal]);

	return { virtualItems, totalSize, range: { start, end }, measureElement, scrollToIndex };
}
