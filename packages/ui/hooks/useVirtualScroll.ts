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
 *
 * Bottom-anchored lists (chat feeds, logs) are supported additively: `startAtEnd` positions the initial
 * scroll at the end; `onReachStart` fires near the HEAD (the load-older trigger); `scrollToEnd()`
 * re-pins to the bottom; and `getItemKey` keys measured heights by a STABLE id so PREPENDING older
 * items (which shifts every index) does not corrupt the offset table. All default to the prior
 * top-down, index-keyed, append-only behaviour, so existing consumers are unchanged.
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
	/** Distance from the start (px) at which `onReachStart` fires — for bottom-up load-older (default 240). */
	startThreshold?: number;
	/**
	 * Called when the HEAD comes into view — the load-older trigger for a bottom-anchored feed. Debounced
	 * per `count`, so it re-arms once older items are prepended (which grows `count`).
	 */
	onReachStart?: () => void;
	/**
	 * Position the initial scroll at the END on first layout (a chat feed opens at the newest message).
	 * Additive: defaults to the prior top-anchored behaviour.
	 */
	startAtEnd?: boolean;
	/**
	 * Stable key per index for the measured-size cache. Prepending older items shifts every index, so an
	 * index-keyed cache would misattribute heights and corrupt the offset table; keying by a stable id
	 * (e.g. the message id) keeps measurements correct across a prepend. Defaults to the index itself
	 * (unchanged top-down behaviour).
	 */
	getItemKey?: (index: number) => string | number;
}

export interface UseVirtualScrollResult {
	/** The items currently in the window (with absolute offsets). */
	virtualItems: VirtualItem[];
	/** Total scrollable size of all items, px — set on the inner sizer. */
	totalSize: number;
	range: { start: number; end: number };
	/** Ref callback for a rendered row (reads `data-index`) to record its real measured size. */
	measureElement: (el: HTMLElement | null) => void;
	/**
	 * Programmatically scroll a given index to the start of the viewport. `offset` (px) nudges the final
	 * position — pass a negative value to leave room for a sticky header above the target.
	 */
	scrollToIndex: (index: number, offset?: number) => void;
	/** Programmatically pin the scroll to the very END (bottom) — for a bottom-anchored feed. */
	scrollToEnd: (behavior?: ScrollBehavior) => void;
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
		startThreshold = 240,
		onReachStart,
		startAtEnd = false,
		getItemKey,
	} = opts;

	// Live scroll/viewport signals — writing them re-renders only the consuming component.
	const scrollOffset = useMemo(() => signal(0), []);
	const viewport = useMemo(() => signal(0), []);
	// Measured sizes keyed by a STABLE key (id) so a head-prepend doesn't misattribute heights.
	const measured = useRef<Map<string | number, number>>(new Map());
	const lastEndFired = useRef(-1);
	const lastStartFired = useRef(-1);
	const versionRef = useRef(0);
	const version = useMemo(() => signal(0), []);
	const didStartAtEnd = useRef(false);
	// The live scroll reader, published by the scroll effect so programmatic scrolls can re-sync
	// immediately (some environments — and a background/hidden tab — defer the async `scroll` event).
	const syncRef = useRef<() => void>(() => {});

	const estimate = useCallback(
		(i: number) => (typeof itemSize === "function" ? itemSize(i) : itemSize),
		[itemSize],
	);
	const keyOf = useCallback(
		(i: number): string | number => (getItemKey ? getItemKey(i) : i),
		[getItemKey],
	);

	// Prefix-sum offset table; recomputed when count, estimate, or a measurement changes.
	const offsets = useMemo(() => {
		version.value; // subscribe to remeasurements
		const arr = new Float64Array(count + 1);
		for (let i = 0; i < count; i++) {
			arr[i + 1] = arr[i] + (measured.current.get(keyOf(i)) ?? estimate(i));
		}
		return arr;
	}, [count, estimate, keyOf, version.value]);

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

		syncRef.current = read;
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

	// #region Infinite-scroll tail (onReachEnd) + head (onReachStart)
	useEffect(() => {
		if (!onReachEnd || count === 0) return;
		if (totalSize - (so + vp) <= endThreshold && lastEndFired.current !== count) {
			lastEndFired.current = count;
			onReachEnd();
		}
	}, [so, vp, totalSize, count, endThreshold, onReachEnd]);

	useEffect(() => {
		if (!onReachStart || count === 0) return;
		// Re-arms per `count`: once older items prepend (growing count) the head trigger can fire again.
		if (so <= startThreshold && lastStartFired.current !== count) {
			lastStartFired.current = count;
			onReachStart();
		}
	}, [so, count, startThreshold, onReachStart]);
	// #endregion

	// #region Scroll helpers
	const scrollToEnd = useCallback((behavior: ScrollBehavior = "auto") => {
		if (typeof window === "undefined") return;
		if (useWindow) {
			const doc = document.scrollingElement ?? document.documentElement;
			globalThis.scrollTo({ top: doc.scrollHeight, behavior });
		} else if (parentRef?.current) {
			const p = parentRef.current;
			p.scrollTo({
				[horizontal ? "left" : "top"]: horizontal ? p.scrollWidth : p.scrollHeight,
				behavior,
			});
		}
		// Reflect the programmatic scroll now (don't wait for the deferred `scroll` event).
		if (behavior === "auto") syncRef.current();
	}, [useWindow, parentRef, horizontal]);

	// Position at the end on first layout for a bottom-anchored feed (once).
	useEffect(() => {
		if (!startAtEnd || didStartAtEnd.current || count === 0) return;
		didStartAtEnd.current = true;
		scrollToEnd("auto");
	}, [startAtEnd, count, scrollToEnd]);
	// #endregion

	const measureElement = useCallback((el: HTMLElement | null) => {
		if (!el) return;
		const idx = Number(el.dataset.index);
		if (Number.isNaN(idx)) return;
		const key = keyOf(idx);
		const size = horizontal ? el.offsetWidth : el.offsetHeight;
		if (size > 0 && measured.current.get(key) !== size) {
			measured.current.set(key, size);
			versionRef.current++;
			version.value = versionRef.current;
		}
	}, [horizontal, keyOf]);

	const scrollToIndex = useCallback((index: number, offset = 0) => {
		const target = (offsets[Math.max(0, Math.min(count - 1, index))] ?? 0) + offset;
		if (useWindow) {
			const parent = parentRef?.current;
			const rect = parent?.getBoundingClientRect();
			const base = (rect?.top ?? 0) + globalThis.scrollY;
			globalThis.scrollTo({ top: base + target, behavior: "smooth" });
		} else if (parentRef?.current) {
			parentRef.current.scrollTo({ [horizontal ? "left" : "top"]: target, behavior: "smooth" });
		}
		// Re-sync the window even where the smooth-scroll event is deferred (keeps the target rendered).
		syncRef.current();
	}, [offsets, count, useWindow, parentRef, horizontal]);

	return {
		virtualItems,
		totalSize,
		range: { start, end },
		measureElement,
		scrollToIndex,
		scrollToEnd,
	};
}
