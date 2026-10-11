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
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { createScrollLock } from "./scroll-lock.ts";

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
	passive: boolean;
	setIsTop: (v: boolean) => void;
}

/** Currently-active overlays in claim order, top-most last. */
const stack: StackEntry[] = [];
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
	let top = stack.length - 1;
	while (top >= 0 && stack[top].passive) top--;
	for (let i = 0; i < stack.length; i++) stack[i].setIsTop(i === top);
}

/** How long a release waits when the double frame never comes (a backgrounded tab). */
const RELEASE_WATCHDOG_MS = 250;

/**
 * Reference-counted body scroll lock — compensates for the scrollbar to avoid layout shift.
 *
 * The release waits two frames (or the watchdog). A modal-stack frame swap unmounts the outgoing
 * overlay synchronously but the incoming one claims the lock in an effect flushed after the next
 * frame; releasing at once restored `overflow` and the scrollbar padding for that frame. The
 * watchdog hops one more task before releasing: after a long task both it and Preact's effect
 * flush are already due, and the hop queues the release behind the flush's own task.
 */
const bodyLock = createScrollLock({
	apply() {
		if (typeof document === "undefined") return;
		const body = document.body;
		const scrollbar = globalThis.innerWidth - document.documentElement.clientWidth;
		savedOverflow = body.style.overflow;
		savedPaddingInlineEnd = body.style.paddingInlineEnd;
		body.style.overflow = "hidden";
		// Logical, not `paddingRight`: under `dir="rtl"` the scrollbar sits on the left, and physical
		// compensation would shift the layout it is supposed to hold still.
		if (scrollbar > 0) body.style.paddingInlineEnd = `${scrollbar}px`;
	},
	release() {
		if (typeof document === "undefined") return;
		document.body.style.overflow = savedOverflow;
		document.body.style.paddingInlineEnd = savedPaddingInlineEnd;
	},
	defer(task) {
		let done = false;
		let raf = 0;
		let hop: ReturnType<typeof setTimeout> | undefined;
		const cancel = () => {
			done = true;
			cancelAnimationFrame(raf);
			clearTimeout(watchdog);
			clearTimeout(hop);
		};
		const run = () => {
			if (done) return;
			cancel();
			task();
		};
		raf = requestAnimationFrame(() => {
			raf = requestAnimationFrame(run);
		});
		const watchdog = setTimeout(() => {
			hop = setTimeout(run, 0);
		}, RELEASE_WATCHDOG_MS);
		return cancel;
	},
});
// #endregion

export interface OverlayStackOptions {
	active: boolean;
	/** Lock body scroll while active (modal dialogs/drawers). Default false. */
	lockScroll?: boolean;
	/** Stacking class this overlay belongs to (default `popover`). */
	layer?: OverlayLayer;
	/**
	 * Claim a z-slot but never `isTop` — for a persistent non-modal window (`DraggablePopover`). It
	 * still raises the ceiling, so a dropdown opened inside it steps above it, but a modal beside it
	 * keeps Escape ownership.
	 */
	passive?: boolean;
}

export interface OverlayStackState {
	/** z-index assigned to this overlay while active. */
	zIndex: number;
	/** True only for the top-most currently-active overlay (drives Escape ownership). */
	isTop: boolean;
	/** Move this claim to the top of the stack (a window touched to the front). No-op when closed. */
	raise: () => void;
}

export function useOverlayStack(opts: OverlayStackOptions): OverlayStackState {
	const { active, lockScroll = false, layer = "popover", passive = false } = opts;
	const base = LAYER_BASE[layer];
	const [zIndex, setZIndex] = useState(base);
	const [isTop, setIsTop] = useState(false);
	const entryRef = useRef<StackEntry | null>(null);

	useEffect(() => {
		if (!active) return;
		// Start from the class base, but never below an overlay that is already open — so a dropdown
		// inside a modal steps ABOVE it instead of falling back to the popover band.
		const mine = Math.max(base, currentTop() + Z_STEP);
		const entry: StackEntry = { z: mine, passive, setIsTop };
		entryRef.current = entry;
		stack.push(entry);
		setZIndex(mine);
		syncTop();

		return () => {
			// Drop this claim and let the ceiling fall out of what is still open. A running counter that
			// released only when it happened to be top leaked a step on every out-of-order teardown, and
			// in a shell that never full-page-navigates that drift eventually lifts a plain popover above
			// the draggable, toast and tooltip bands — inverting the class hierarchy this module promises.
			const i = stack.indexOf(entry);
			if (i >= 0) stack.splice(i, 1);
			entryRef.current = null;
			setIsTop(false);
			syncTop();
		};
	}, [active, base, passive]);

	const raise = () => {
		const entry = entryRef.current;
		if (!entry || stack[stack.length - 1] === entry) return;
		stack.splice(stack.indexOf(entry), 1);
		// Re-derived from live claims, like the first claim — raising never accumulates.
		entry.z = Math.max(base, currentTop() + Z_STEP);
		stack.push(entry);
		setZIndex(entry.z);
		syncTop();
	};

	// The lock is claimed in the commit that mounts the overlay, so a frame swap's incoming claim
	// lands in the same task as the outgoing release and cancels it, whatever runs before paint.
	useLayoutEffect(() => {
		if (!active || !lockScroll) return;
		bodyLock.acquire();
		return () => bodyLock.release();
	}, [active, lockScroll]);

	return { zIndex, isTop, raise };
}
