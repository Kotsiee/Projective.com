import { type Signal, useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { LaneMode } from "../types/mod.ts";

export interface UseSplitterOptions {
	/** Minimum lane width (px). */
	min?: number;
	/** Maximum lane width (px). */
	max?: number;
	/** Initial lane width (px). */
	initial?: number;
	/** localStorage key to persist the width across sessions. */
	storageKey?: string;
	/** Width below which the lane is `collapsed`; between here and `compactMax` it is `compact`. */
	collapseBelow?: number;
	compactMax?: number;
	/**
	 * When set, the hook listens for this window `CustomEvent` and toggles the lane between its
	 * collapsed rail (`min`) and the last expanded width — the programmatic equivalent of dragging the
	 * handle shut, so a button elsewhere (e.g. the lane's own footer toggle) can collapse/expand it. A
	 * `detail.collapsed` boolean forces a direction; omit it to plain-toggle. Opt-in so the package
	 * stays portable and event-free by default.
	 */
	collapseEventName?: string;
	/**
	 * Which edge of the resized element carries the handle. `end` (default) is the lane's trailing
	 * edge — dragging toward inline-end widens it. `start` is a right-docked panel's leading edge, so
	 * the drag delta inverts: dragging toward inline-start widens it.
	 */
	edge?: "start" | "end";
	/** Arrow-key resize step (px) for the handle's {@link Splitter.onKeyDown}. */
	step?: number;
	/**
	 * Opt-in drag-to-close. While a drag would take the element below this width (the raw pointer
	 * width, before the `min` clamp) {@link Splitter.collapsePending} is set, and releasing there calls
	 * {@link onReleaseCollapse} instead of resizing — the width snaps back to where the drag started, so
	 * the element reopens at the width it had. Both must be set.
	 */
	releaseCollapseAt?: number;
	/** Called when a drag is released past {@link releaseCollapseAt}. */
	onReleaseCollapse?: () => void;
}

export interface Splitter {
	/** Current lane width in px (reactive). */
	width: Signal<number>;
	/** Density band derived from width (Part D.2): collapsed → compact → full. */
	mode: Signal<LaneMode>;
	/**
	 * Whether the handle is being actively dragged. Lets the view suppress the lane's width transition
	 * mid-drag (so the panel tracks the pointer 1:1) while keeping it smooth for programmatic
	 * collapse/expand.
	 */
	dragging: Signal<boolean>;
	onPointerDown: (e: PointerEvent) => void;
	onPointerMove: (e: PointerEvent) => void;
	onPointerUp: (e: PointerEvent) => void;
	/** Abandons a drag (`pointercancel`): keeps the width reached, never collapses. */
	onPointerCancel: (e: PointerEvent) => void;
	/** A drag is currently past `releaseCollapseAt` — releasing now closes the element. */
	collapsePending: Signal<boolean>;
	/**
	 * Keyboard resize for a focusable `role="separator"` handle: the arrow keys move the handle by
	 * `step` (so ArrowLeft widens a `start`-edge panel and narrows an `end`-edge lane), Home/End jump to
	 * the minimum/maximum. Persisted like a drag.
	 */
	onKeyDown: (e: KeyboardEvent) => void;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Drag-resize logic for the middle-nav Splitter (DESIGN_SYSTEM.md Part D.2). Signal-first; drag
 * bookkeeping lives in a ref so it survives re-renders. The derived `mode` lets the lane reflow
 * between icon-only (collapsed), icon-matrix (compact), and master-detail (full).
 */
export function useSplitter(opts: UseSplitterOptions = {}): Splitter {
	const {
		min = 56,
		max = 560,
		initial = 280,
		storageKey,
		collapseBelow = 96,
		compactMax = 200,
		collapseEventName,
		edge = "end",
		step = 16,
		releaseCollapseAt,
		onReleaseCollapse,
	} = opts;
	// A `start`-edge handle grows the element as the pointer moves toward inline-start.
	const sign = edge === "start" ? -1 : 1;

	const restore = (): number => {
		if (!storageKey || typeof localStorage === "undefined") return initial;
		try {
			const v = localStorage.getItem(storageKey);
			return v ? clamp(Number(v), min, max) : initial;
		} catch {
			return initial;
		}
	};

	const persist = (v: number) => {
		if (!storageKey || typeof localStorage === "undefined") return;
		try {
			localStorage.setItem(storageKey, String(v));
		} catch {
			/* storage unavailable — non-fatal */
		}
	};

	const width = useSignal(restore());
	const mode = useComputed<LaneMode>(() =>
		width.value < collapseBelow ? "collapsed" : width.value < compactMax ? "compact" : "full"
	);
	const dragging = useSignal(false);
	const collapsePending = useSignal(false);
	const drag = useRef({ active: false, startX: 0, startW: 0 });
	// The width to return to when expanding out of the collapsed rail (last non-collapsed width).
	const lastExpanded = useRef(width.value >= collapseBelow ? width.value : initial);

	const onPointerDown = (e: PointerEvent) => {
		drag.current = { active: true, startX: e.clientX, startW: width.value };
		dragging.value = true;
		(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
	};
	const onPointerMove = (e: PointerEvent) => {
		if (!drag.current.active) return;
		const raw = drag.current.startW + sign * (e.clientX - drag.current.startX);
		width.value = clamp(raw, min, max);
		collapsePending.value = !!onReleaseCollapse && releaseCollapseAt !== undefined &&
			raw < releaseCollapseAt;
	};
	const onPointerUp = () => {
		if (!drag.current.active) return;
		drag.current.active = false;
		dragging.value = false;
		if (collapsePending.value) {
			collapsePending.value = false;
			width.value = drag.current.startW;
			onReleaseCollapse?.();
			return;
		}
		if (width.value >= collapseBelow) lastExpanded.current = width.value;
		persist(width.value);
	};
	const onPointerCancel = () => {
		collapsePending.value = false;
		onPointerUp();
	};
	const onKeyDown = (e: KeyboardEvent) => {
		let next: number;
		if (e.key === "ArrowLeft") next = width.value - sign * step;
		else if (e.key === "ArrowRight") next = width.value + sign * step;
		else if (e.key === "Home") next = min;
		else if (e.key === "End") next = max;
		else return;
		e.preventDefault();
		width.value = clamp(next, min, max);
		if (width.value >= collapseBelow) lastExpanded.current = width.value;
		persist(width.value);
	};

	// Opt-in: collapse/expand via a window CustomEvent (a footer/toolbar toggle elsewhere).
	useEffect(() => {
		if (!collapseEventName || typeof globalThis.addEventListener !== "function") return;
		const onToggle = (e: Event) => {
			const detail = (e as CustomEvent).detail as { collapsed?: boolean } | undefined;
			const isCollapsed = width.value < collapseBelow;
			const wantCollapsed = detail?.collapsed ?? !isCollapsed;
			if (wantCollapsed === isCollapsed) return;
			if (wantCollapsed) {
				lastExpanded.current = width.value;
				width.value = min;
			} else {
				width.value = clamp(lastExpanded.current, collapseBelow, max);
			}
			persist(width.value);
		};
		globalThis.addEventListener(collapseEventName, onToggle);
		return () => globalThis.removeEventListener(collapseEventName, onToggle);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [collapseEventName]);

	return {
		width,
		mode,
		dragging,
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onPointerCancel,
		collapsePending,
		onKeyDown,
	};
}
