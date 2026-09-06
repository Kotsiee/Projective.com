/**
 * `useEditorResize` — the event plumbing behind the editor's custom resize handles.
 *
 * The arithmetic lives in `core/resize.ts`, which is pure and therefore testable; everything here is
 * the part only a real pointer can exercise. The hook writes geometry STRAIGHT TO THE DOM rather than
 * through a signal and a re-render, for two reasons that are both about correctness rather than
 * speed. A pointermove fires at frame rate, and re-rendering the component that owns Quill's
 * container sixty times a second invites Preact to diff a subtree Quill owns and this component
 * deliberately mounts once. And a size that arrives via a render is a size that depends on a frame:
 * this repo has measured a preview pane that reports itself visible and composites nothing, so any
 * geometry routed through the render loop can freeze mid-drag with the box at the wrong height.
 *
 * ## The lock is applied before the bounds are read, and that ordering is the whole clamp
 *
 * Auto-expansion and manual resize have DIFFERENT bounds: growing on its own, the box is floored at
 * `defaultHeight` and ceilinged at `maxAutoHeight`; dragged by hand it is floored at `minHeight` and
 * ceilinged at `maxHeight`. Both pairs are declared in CSS, switched by the lock attribute — so the
 * hook stamps the lock FIRST and only then reads `getComputedStyle`, which by that point is reporting
 * the manual pair. That is also what lets a consumer express a bound in `rem`, `%` or `calc()`: the
 * engine resolves it to a used pixel value and the hook never parses a length itself.
 *
 * ## Every exit is the same exit
 *
 * Release, cancel, a window blur from alt-tabbing mid-drag, and unmount all run one teardown. A drag
 * that survives any of those is a control left live with nothing on screen to say so, and the pointer
 * that would end it is somewhere else. The document-level class that suppresses text selection is
 * removed there too — leaving it behind would make the whole page unselectable for the rest of the
 * session, which is the worst possible residue for a gesture nobody is performing any more.
 */
import { useEffect, useMemo, useRef } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import type { RefObject } from "preact";
import {
	availableInlineSize,
	clampSize,
	inlineDelta,
	keyResize,
	type ResizeAxis,
	usedPx,
} from "../core/resize.ts";

/**
 * Marks the document while a drag is live, so selection is suppressed page-wide and the cursor holds
 * its axis instead of flickering back to an I-beam every time the pointer crosses another element.
 */
const DRAGGING_CLASS = "ui-rte-resizing";
const AXIS_CLASS: Record<ResizeAxis, string> = {
	block: "ui-rte-resizing--block",
	inline: "ui-rte-resizing--inline",
	both: "ui-rte-resizing--both",
};

/** Floors used when the consumer named none. Small enough to be a real choice, big enough to grab. */
const FALLBACK_MIN_BLOCK = 40;
const FALLBACK_MIN_INLINE = 160;

export interface EditorResizeOptions {
	/** The control's root — carries the lock attributes, the width, and the resolved direction. */
	containerRef: RefObject<HTMLElement | null>;
	/** The sized editing region. Every height bound and the height itself apply to this element. */
	surfaceRef: RefObject<HTMLElement | null>;
	/** Whether the inline axis may be dragged at all. */
	horizontal: boolean;
}

export interface EditorResize {
	/** Whether a drag is in progress — for a cursor, a held-open handle, or a `data-` attribute. */
	dragging: Signal<boolean>;
	/** Begin a pointer drag on one handle. */
	start: (axis: ResizeAxis, event: PointerEvent) => void;
	/** Arrow-key resize for the same handle, so the gesture is not mouse-only. */
	onKeyDown: (axis: ResizeAxis, event: KeyboardEvent) => void;
}

interface DragState {
	axis: ResizeAxis;
	startX: number;
	startY: number;
	startBlock: number;
	startInline: number;
	minBlock: number;
	maxBlock: number;
	minInline: number;
	maxInline: number;
	rtl: boolean;
}

export function useEditorResize(options: EditorResizeOptions): EditorResize {
	const dragging = useSignal(false);

	const optionsRef = useRef(options);
	optionsRef.current = options;
	const dragRef = useRef<DragState | null>(null);
	const stopRef = useRef<() => void>(() => {});
	const moveRef = useRef<(event: PointerEvent) => void>(() => {});

	/**
	 * The identities the window actually sees. Created once and never again, each delegating to
	 * whatever its ref currently holds — registering `someRef.current` would hand `removeEventListener`
	 * a closure minted after the one that was registered, and the removal is then a silent no-op that
	 * leaves the listener outliving the gesture.
	 */
	const onMoveStable = useMemo(() => (event: PointerEvent) => moveRef.current(event), []);
	const onStopStable = useMemo(() => () => stopRef.current(), []);

	// #region Geometry writes
	/**
	 * Pin the current size and retire auto-expansion.
	 *
	 * Called before the first pixel of any drag, including a width-only one: once the reader has taken
	 * the box in hand, a later reflow silently changing its height under them is the surprise this
	 * prevents. The pin is seeded from the size on screen right now, so nothing jumps at the moment of
	 * the press.
	 */
	const lockBlock = (container: HTMLElement, surface: HTMLElement): number => {
		const current = surface.getBoundingClientRect().height;
		container.style.setProperty("--rte-h", `${Math.round(current)}px`);
		container.setAttribute("data-resized-y", "true");
		return current;
	};

	const lockInline = (container: HTMLElement): number => {
		const current = container.getBoundingClientRect().width;
		container.style.setProperty("--rte-w", `${Math.round(current)}px`);
		container.setAttribute("data-resized-x", "true");
		return current;
	};

	const applyBlock = (container: HTMLElement, px: number) => {
		container.style.setProperty("--rte-h", `${Math.round(px)}px`);
	};
	const applyInline = (container: HTMLElement, px: number) => {
		container.style.setProperty("--rte-w", `${Math.round(px)}px`);
	};
	// #endregion

	// #region Bounds
	/**
	 * Read the manual bounds. Must run AFTER the lock attributes are stamped — before that, the
	 * computed min/max are still the auto-expansion pair and a drag would clamp to the wrong numbers.
	 */
	const measureBounds = (
		container: HTMLElement,
		surface: HTMLElement,
	): Omit<DragState, "axis" | "startX" | "startY" | "startBlock" | "startInline"> => {
		const view = container.ownerDocument?.defaultView;
		const surfaceStyle = view?.getComputedStyle(surface);
		const containerStyle = view?.getComputedStyle(container);
		const parent = container.parentElement;
		const parentStyle = parent && view ? view.getComputedStyle(parent) : null;

		const maxInline = parent && parentStyle
			? availableInlineSize(
				parent.clientWidth,
				usedPx(parentStyle.paddingInlineStart, 0),
				usedPx(parentStyle.paddingInlineEnd, 0),
			)
			: Infinity;

		return {
			minBlock: usedPx(surfaceStyle?.minHeight, FALLBACK_MIN_BLOCK),
			maxBlock: usedPx(surfaceStyle?.maxHeight, Infinity),
			minInline: usedPx(containerStyle?.minWidth, FALLBACK_MIN_INLINE),
			maxInline,
			rtl: containerStyle?.direction === "rtl",
		};
	};
	// #endregion

	// #region Drag lifecycle
	const stop = () => {
		globalThis.removeEventListener("pointermove", onMoveStable);
		globalThis.removeEventListener("pointerup", onStopStable);
		globalThis.removeEventListener("pointercancel", onStopStable);
		globalThis.removeEventListener("blur", onStopStable);
		const container = optionsRef.current.containerRef.current;
		container?.removeAttribute("data-resizing");
		const root = container?.ownerDocument?.documentElement;
		root?.classList.remove(DRAGGING_CLASS, ...Object.values(AXIS_CLASS));
		dragRef.current = null;
		if (dragging.value) dragging.value = false;
	};
	stopRef.current = stop;

	const onPointerMove = (event: PointerEvent) => {
		const drag = dragRef.current;
		const container = optionsRef.current.containerRef.current;
		if (!drag || !container) return;
		// Suppressing the default stops the browser extending a text selection across the page behind
		// the drag, which the document-level class alone cannot prevent once a selection has begun.
		event.preventDefault();

		if (drag.axis !== "inline") {
			const next = drag.startBlock + (event.clientY - drag.startY);
			applyBlock(container, clampSize(next, drag.minBlock, drag.maxBlock));
		}
		if (drag.axis !== "block") {
			const next = drag.startInline + inlineDelta(event.clientX - drag.startX, drag.rtl);
			applyInline(container, clampSize(next, drag.minInline, drag.maxInline));
		}
	};
	moveRef.current = onPointerMove;

	const start = (axis: ResizeAxis, event: PointerEvent) => {
		if (event.button !== undefined && event.button !== 0) return;
		const container = optionsRef.current.containerRef.current;
		const surface = optionsRef.current.surfaceRef.current;
		if (!container || !surface) return;
		const wantsInline = axis !== "block" && optionsRef.current.horizontal;

		// Before anything that can throw: it is the part the reader sees if it is missed.
		event.preventDefault();
		stopRef.current();

		// Order matters — see the hook docblock. The lock switches CSS to the manual bounds, so the
		// bounds have to be read after it, not before.
		const startBlock = lockBlock(container, surface);
		const startInline = wantsInline
			? lockInline(container)
			: container.getBoundingClientRect().width;
		const bounds = measureBounds(container, surface);

		dragRef.current = {
			axis: wantsInline ? axis : "block",
			startX: event.clientX,
			startY: event.clientY,
			startBlock,
			startInline,
			...bounds,
		};
		dragging.value = true;
		container.setAttribute("data-resizing", "true");
		// Page-wide, not element-scoped: the pointer spends most of a drag outside the editor, and a
		// selection started out there would still tear across the document behind it.
		container.ownerDocument?.documentElement.classList.add(
			DRAGGING_CLASS,
			AXIS_CLASS[dragRef.current.axis],
		);

		globalThis.addEventListener("pointermove", onMoveStable);
		globalThis.addEventListener("pointerup", onStopStable);
		globalThis.addEventListener("pointercancel", onStopStable);
		globalThis.addEventListener("blur", onStopStable);
	};

	const onKeyDown = (axis: ResizeAxis, event: KeyboardEvent) => {
		const container = optionsRef.current.containerRef.current;
		const surface = optionsRef.current.surfaceRef.current;
		if (!container || !surface) return;
		const wantsInline = axis !== "block" && optionsRef.current.horizontal;
		const effective: ResizeAxis = wantsInline ? axis : "block";

		const view = container.ownerDocument?.defaultView;
		const rtl = view?.getComputedStyle(container).direction === "rtl";
		const step = keyResize(event.key, effective, { rtl, coarse: event.shiftKey });
		// `null` means this key is not ours: Tab, Escape and everything else keep their behaviour.
		if (!step) return;
		event.preventDefault();

		const startBlock = lockBlock(container, surface);
		const startInline = wantsInline ? lockInline(container) : 0;
		const bounds = measureBounds(container, surface);

		if (step.block !== 0) {
			applyBlock(container, clampSize(startBlock + step.block, bounds.minBlock, bounds.maxBlock));
		}
		if (step.inline !== 0 && wantsInline) {
			applyInline(
				container,
				clampSize(startInline + step.inline, bounds.minInline, bounds.maxInline),
			);
		}
	};
	// #endregion

	useEffect(() => () => stopRef.current(), []);

	return { dragging, start, onKeyDown };
}
