import { type Signal, useComputed, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
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
}

export interface Splitter {
	/** Current lane width in px (reactive). */
	width: Signal<number>;
	/** Density band derived from width (Part D.2): collapsed → compact → full. */
	mode: Signal<LaneMode>;
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

	const width = useSignal(restore());
	const mode = useComputed<LaneMode>(() =>
		width.value < collapseBelow ? "collapsed" : width.value < compactMax ? "compact" : "full"
	);
	const drag = useRef({ active: false, startX: 0, startW: 0 });

	const onPointerDown = (e: PointerEvent) => {
		drag.current = { active: true, startX: e.clientX, startW: width.value };
		(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
	};
	const onPointerMove = (e: PointerEvent) => {
		if (!drag.current.active) return;
		width.value = clamp(drag.current.startW + (e.clientX - drag.current.startX), min, max);
	};
	const onPointerUp = () => {
		if (!drag.current.active) return;
		drag.current.active = false;
		if (storageKey && typeof localStorage !== "undefined") {
			try {
				localStorage.setItem(storageKey, String(width.value));
			} catch {
				/* storage unavailable — non-fatal */
			}
		}
	};

	return { width, mode, onPointerDown, onPointerMove, onPointerUp };
}
