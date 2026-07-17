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
	} = opts;

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
		width.value = clamp(drag.current.startW + (e.clientX - drag.current.startX), min, max);
	};
	const onPointerUp = () => {
		if (!drag.current.active) return;
		drag.current.active = false;
		dragging.value = false;
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

	return { width, mode, dragging, onPointerDown, onPointerMove, onPointerUp };
}
