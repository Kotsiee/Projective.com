/**
 * `useOverlayStack` — the single coordinator for stacked overlays (§C.6 "dynamic stacking, elevation
 * index"). Every overlay that mounts while `active` claims a live z-index and releases it on unmount.
 * It also reference-counts a body scroll-lock so nested modals don't prematurely release it.
 * Client-only; SSR returns the layer's base.
 *
 * **Layered allocation.** Each overlay declares its {@link OverlayLayer} class, and the assigned
 * z-index is `max(layerBase, currentTop + step)`. That satisfies two rules at once:
 *
 *  1. **Class hierarchy** — an independently-opened modal always outranks an independently-opened
 *     popover, and a draggable window outranks both, because each class starts from its own base
 *     (mirrors the `--z-popover` / `--z-modal` / `--z-draggable` tokens in `styles/index.css`).
 *  2. **Nesting still works** — a dropdown opened INSIDE an open modal steps above the modal rather
 *     than dropping to the popover base, so it is never swallowed by its own parent surface.
 */
import { useEffect, useState } from "preact/hooks";

// #region Module-level shared state
/** The stacking class an overlay belongs to. */
export type OverlayLayer = "popover" | "modal" | "draggable";

/** Class bases — mirror the `--z-popover` / `--z-modal` / `--z-draggable` tokens. */
const LAYER_BASE: Record<OverlayLayer, number> = {
	popover: 1100,
	modal: 1300,
	draggable: 1500,
};

const Z_STEP = 10;

/** One live overlay's claim on the stack. */
interface StackEntry {
	z: number;
	setIsTop: (v: boolean) => void;
}

/** Currently-active overlays in claim order, top-most last. */
const stack: StackEntry[] = [];
let lockCount = 0;
let savedOverflow = "";
let savedPaddingInlineEnd = "";

/** The current ceiling — derived from live claims, never a running total that can drift. */
function currentTop(): number {
	let max = LAYER_BASE.popover;
	for (const e of stack) if (e.z > max) max = e.z;
	return max;
}

/** Push `isTop` to every live overlay so Escape ownership follows the real top, not mount order. */
function syncTop(): void {
	for (let i = 0; i < stack.length; i++) stack[i].setIsTop(i === stack.length - 1);
}

/** Reference-counted body scroll lock — compensates for the scrollbar to avoid layout shift. */
function lockBodyScroll(): void {
	if (typeof document === "undefined") return;
	if (lockCount === 0) {
		const body = document.body;
		const scrollbar = globalThis.innerWidth - document.documentElement.clientWidth;
		savedOverflow = body.style.overflow;
		savedPaddingInlineEnd = body.style.paddingInlineEnd;
		body.style.overflow = "hidden";
		// Logical, not `paddingRight`: under `dir="rtl"` the scrollbar sits on the left, and physical
		// compensation would shift the layout it is supposed to hold still.
		if (scrollbar > 0) body.style.paddingInlineEnd = `${scrollbar}px`;
	}
	lockCount++;
}

function unlockBodyScroll(): void {
	if (typeof document === "undefined") return;
	lockCount = Math.max(0, lockCount - 1);
	if (lockCount === 0) {
		document.body.style.overflow = savedOverflow;
		document.body.style.paddingInlineEnd = savedPaddingInlineEnd;
	}
}
// #endregion

export interface OverlayStackOptions {
	active: boolean;
	/** Lock body scroll while active (modal dialogs/drawers). Default false. */
	lockScroll?: boolean;
	/** Stacking class this overlay belongs to (default `popover`). */
	layer?: OverlayLayer;
}

export interface OverlayStackState {
	/** z-index assigned to this overlay while active. */
	zIndex: number;
	/** True only for the top-most currently-active overlay (drives Escape ownership). */
	isTop: boolean;
}

export function useOverlayStack(opts: OverlayStackOptions): OverlayStackState {
	const { active, lockScroll = false, layer = "popover" } = opts;
	const base = LAYER_BASE[layer];
	const [zIndex, setZIndex] = useState(base);
	const [isTop, setIsTop] = useState(false);

	useEffect(() => {
		if (!active) return;
		// Start from the class base, but never below an overlay that is already open — so a dropdown
		// inside a modal steps ABOVE it instead of falling back to the popover band.
		const mine = Math.max(base, currentTop() + Z_STEP);
		const entry: StackEntry = { z: mine, setIsTop };
		stack.push(entry);
		setZIndex(mine);
		syncTop();
		if (lockScroll) lockBodyScroll();

		return () => {
			if (lockScroll) unlockBodyScroll();
			// Drop this claim and let the ceiling fall out of what is still open. A running counter that
			// released only when it happened to be top leaked a step on every out-of-order teardown, and
			// in a shell that never full-page-navigates that drift eventually lifts a plain popover above
			// the draggable, toast and tooltip bands — inverting the class hierarchy this module promises.
			const i = stack.indexOf(entry);
			if (i >= 0) stack.splice(i, 1);
			setIsTop(false);
			syncTop();
		};
	}, [active, lockScroll, base]);

	return { zIndex, isTop };
}
