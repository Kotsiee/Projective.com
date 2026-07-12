/**
 * `useOverlayStack` — the single coordinator for stacked overlays (§C.6 "dynamic stacking, elevation
 * index"). Every overlay that mounts while `active` claims the next z-index above `--z-overlay`, so
 * later overlays always render above earlier ones regardless of DOM order. It also reference-counts a
 * body scroll-lock so nested modals don't prematurely release it. Client-only; SSR returns the base.
 */
import { useEffect, useState } from "preact/hooks";

// #region Module-level shared state
const Z_BASE = 1100; // mirrors --z-overlay
const Z_STEP = 10;
let topZ = Z_BASE;
let lockCount = 0;
let savedOverflow = "";
let savedPaddingRight = "";

/** Reference-counted body scroll lock — compensates for the scrollbar to avoid layout shift. */
function lockBodyScroll(): void {
	if (typeof document === "undefined") return;
	if (lockCount === 0) {
		const body = document.body;
		const scrollbar = window.innerWidth - document.documentElement.clientWidth;
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
}

export interface OverlayStackState {
	/** z-index assigned to this overlay while active. */
	zIndex: number;
	/** True only for the top-most currently-active overlay (drives Escape ownership). */
	isTop: boolean;
}

export function useOverlayStack(opts: OverlayStackOptions): OverlayStackState {
	const { active, lockScroll = false } = opts;
	const [zIndex, setZIndex] = useState(Z_BASE);
	const [isTop, setIsTop] = useState(false);

	useEffect(() => {
		if (!active) return;
		topZ += Z_STEP;
		const mine = topZ;
		setZIndex(mine);
		setIsTop(true);
		if (lockScroll) lockBodyScroll();

		return () => {
			if (lockScroll) unlockBodyScroll();
			// Release the ceiling only if we were the top overlay.
			if (topZ === mine) topZ -= Z_STEP;
			setIsTop(false);
		};
	}, [active, lockScroll]);

	return { zIndex, isTop };
}
