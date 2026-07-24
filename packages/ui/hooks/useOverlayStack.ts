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
let topZ: number = LAYER_BASE.popover;
let lockCount = 0;
let savedOverflow = "";
let savedPaddingRight = "";

/** Reference-counted body scroll lock — compensates for the scrollbar to avoid layout shift. */
function lockBodyScroll(): void {
	if (typeof document === "undefined") return;
	if (lockCount === 0) {
		const body = document.body;
		const scrollbar = globalThis.innerWidth - document.documentElement.clientWidth;
		savedOverflow = body.style.overflow;
		savedPaddingRight = body.style.paddingRight;
		body.style.overflow = "hidden";
		if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
	}
	lockCount++;
}

function unlockBodyScroll(): void {
	if (typeof document === "undefined") return;
	lockCount = Math.max(0, lockCount - 1);
	if (lockCount === 0) {
		document.body.style.overflow = savedOverflow;
		document.body.style.paddingRight = savedPaddingRight;
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
		const mine = Math.max(base, topZ + Z_STEP);
		topZ = mine;
		setZIndex(mine);
		setIsTop(true);
		if (lockScroll) lockBodyScroll();

		return () => {
			if (lockScroll) unlockBodyScroll();
			// Release the ceiling only if we were the top overlay.
			if (topZ === mine) topZ = Math.max(LAYER_BASE.popover, mine - Z_STEP);
			setIsTop(false);
		};
	}, [active, lockScroll, base]);

	return { zIndex, isTop };
}
