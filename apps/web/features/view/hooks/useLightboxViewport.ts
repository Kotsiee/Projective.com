import type { JSX, RefObject } from "preact";
import { type ReadonlySignal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
	fit,
	fitView,
	panBy,
	pinchDelta,
	type PinchFrame,
	pinchFrame,
	type Point,
	type Size,
	toCss,
	VIEWPORT_IDENTITY,
	type ViewportFrame,
	type ViewportState,
	wheelFactor,
	zoomAt,
	zoomLimits,
	zoomTo,
} from "@features/inspector/core/viewport.ts";
import {
	clickZoomTarget,
	LIGHTBOX_DRAG_SLOP_PX,
	LIGHTBOX_FIT_GUTTER,
	swipeStep,
} from "../core/lightbox-model.ts";

// #region Types
/** Options for {@link useLightboxViewport}. */
export interface LightboxViewportOptions {
	/** The drawn address; a change resets the view. */
	src: string;
	/** Page the gallery by one in either direction (a swipe on a fitted picture). */
	onStep: (delta: -1 | 1) => void;
	/** Close the lightbox (a click on the empty stage). */
	onDismiss: () => void;
}

/** What the stage binds: its refs, its pointer handlers and the zoom it exposes to the keyboard. */
export interface LightboxViewport {
	stageRef: RefObject<HTMLDivElement>;
	imgRef: RefObject<HTMLImageElement>;
	/** The picture is enlarged past its fit. */
	zoomed: ReadonlySignal<boolean>;
	/** The picture has decoded and been placed. */
	drawn: ReadonlySignal<boolean>;
	onLoad: () => void;
	stageHandlers: {
		onPointerDown: (e: JSX.TargetedPointerEvent<HTMLDivElement>) => void;
		onPointerMove: (e: JSX.TargetedPointerEvent<HTMLDivElement>) => void;
		onPointerUp: (e: JSX.TargetedPointerEvent<HTMLDivElement>) => void;
		onPointerCancel: (e: JSX.TargetedPointerEvent<HTMLDivElement>) => void;
		onClick: (e: JSX.TargetedMouseEvent<HTMLDivElement>) => void;
	};
	/** Scale about the stage centre by `factor`. */
	zoomBy: (factor: number) => void;
	/** Return to the fitted view. */
	reset: () => void;
}

interface Press {
	id: number;
	startX: number;
	startY: number;
	moved: boolean;
}
// #endregion

const ZOOMED_EPSILON = 1.001;
const SWIPE_FOLLOW = 0.5;
const INTERACTIVE = "button, a, video, input";

/**
 * The lightbox stage's fit, zoom and pan, measured against the stage — the full viewport above the
 * tray — rather than a frame inside it. The picture is laid out at natural size and drawn by one CSS
 * transform, using the inspector's pure viewport arithmetic. A click toggles fit ↔ enlarged about the
 * click point; the wheel and a pinch zoom about the pointer; a drag pans an enlarged picture and
 * swipes the gallery while fitted. The fit never upscales a bitmap and never zooms out past it.
 */
export function useLightboxViewport(
	{ src, onStep, onDismiss }: LightboxViewportOptions,
): LightboxViewport {
	const stageRef = useRef<HTMLDivElement>(null);
	const imgRef = useRef<HTMLImageElement>(null);
	const zoomed = useSignal(false);
	const drawn = useSignal(false);
	const view = useRef<ViewportState>({ ...VIEWPORT_IDENTITY });
	const natural = useRef<Size | null>(null);
	const container = useRef<Size>({ width: 0, height: 0 });
	const fitZoom = useRef(1);
	const pointers = useRef(new Map<number, Point>());
	const press = useRef<Press | null>(null);
	const pinch = useRef<PinchFrame | null>(null);
	const swallowClick = useRef(false);
	const callbacks = useRef({ onStep, onDismiss });
	callbacks.current = { onStep, onDismiss };

	// #region Drawing
	function frame(): ViewportFrame | null {
		const size = natural.current;
		if (!size) return null;
		const limits = zoomLimits(fitZoom.current);
		return {
			container: container.current,
			natural: size,
			limits: { min: fitZoom.current, max: limits.max },
		};
	}

	function measure(): void {
		const stage = stageRef.current;
		if (!stage) return;
		const rect = stage.getBoundingClientRect();
		container.current = { width: rect.width, height: rect.height };
		const size = natural.current;
		if (size) {
			fitZoom.current = fit(container.current, size, 0, { gutter: LIGHTBOX_FIT_GUTTER });
		}
	}

	function draw(animate: boolean, offsetX = 0): void {
		const stage = stageRef.current;
		const img = imgRef.current;
		if (!stage || !img) return;
		if (animate) stage.dataset.transition = "animate";
		else delete stage.dataset.transition;
		const state = view.current;
		img.style.transform = toCss(offsetX ? { ...state, x: state.x + offsetX } : state);
		zoomed.value = state.zoom > fitZoom.current * ZOOMED_EPSILON;
	}

	function refit(animate: boolean): void {
		const size = natural.current;
		if (!size) return;
		view.current = fitView(view.current, container.current, size, {
			gutter: LIGHTBOX_FIT_GUTTER,
		});
		draw(animate);
	}

	function local(clientX: number, clientY: number): Point {
		const rect = stageRef.current?.getBoundingClientRect();
		return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 };
	}

	function onLoad(): void {
		const img = imgRef.current;
		if (!img || !(img.naturalWidth > 0) || !(img.naturalHeight > 0)) return;
		natural.current = { width: img.naturalWidth, height: img.naturalHeight };
		img.style.setProperty("--vw-lb-w", `${img.naturalWidth}px`);
		img.style.setProperty("--vw-lb-h", `${img.naturalHeight}px`);
		measure();
		view.current = { ...VIEWPORT_IDENTITY };
		refit(false);
		drawn.value = true;
	}
	// #endregion

	// #region Lifecycle
	useEffect(() => {
		natural.current = null;
		view.current = { ...VIEWPORT_IDENTITY };
		drawn.value = false;
		zoomed.value = false;
		const img = imgRef.current;
		if (img?.complete) onLoad();
	}, [src]);

	useEffect(() => {
		const stage = stageRef.current;
		if (!stage) return;
		measure();
		const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
			measure();
			if (!natural.current) return;
			if (zoomed.peek()) {
				const f = frame();
				if (f) view.current = zoomTo(view.current, view.current.zoom, null, f);
				draw(false);
			} else refit(false);
		});
		ro?.observe(stage);

		const onWheel = (e: WheelEvent) => {
			const f = frame();
			if (!f) return;
			e.preventDefault();
			const factor = wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey || e.metaKey);
			view.current = zoomAt(view.current, local(e.clientX, e.clientY), factor, f);
			draw(false);
		};
		stage.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			ro?.disconnect();
			stage.removeEventListener("wheel", onWheel);
		};
	}, []);
	// #endregion

	// #region Pointer
	function capture(el: HTMLElement, id: number): void {
		try {
			if (!el.hasPointerCapture(id)) el.setPointerCapture(id);
		} catch {
			pointers.current.delete(id);
		}
	}

	function currentPinch(): PinchFrame | null {
		const [a, b] = [...pointers.current.values()];
		return a && b ? pinchFrame(local(a.x, a.y), local(b.x, b.y)) : null;
	}

	function onPointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		swallowClick.current = false;
		if (!natural.current) return;
		if (e.pointerType === "mouse" && e.button !== 0) return;
		if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
		if (pointers.current.size >= 2) return;
		pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pointers.current.size === 2) {
			for (const id of [...pointers.current.keys()]) capture(e.currentTarget, id);
			press.current = null;
			pinch.current = currentPinch();
			return;
		}
		press.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
	}

	function onPointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const last = pointers.current.get(e.pointerId);
		if (!last) return;
		const f = frame();
		if (!f) return;
		const prev = pinch.current;
		if (prev) {
			pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
			const next = currentPinch();
			if (!next) return;
			pinch.current = next;
			const d = pinchDelta(prev, next);
			view.current = panBy(
				zoomAt(view.current, { x: next.cx, y: next.cy }, d.scale, f),
				d.dx,
				d.dy,
				f,
			);
			draw(false);
			return;
		}
		const held = press.current;
		if (!held || held.id !== e.pointerId) return;
		if (!held.moved) {
			if (Math.hypot(e.clientX - held.startX, e.clientY - held.startY) < LIGHTBOX_DRAG_SLOP_PX) {
				return;
			}
			held.moved = true;
			capture(e.currentTarget, e.pointerId);
			e.currentTarget.dataset.dragging = "true";
		}
		pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (zoomed.peek()) {
			view.current = panBy(view.current, e.clientX - last.x, e.clientY - last.y, f);
			draw(false);
		} else draw(false, (e.clientX - held.startX) * SWIPE_FOLLOW);
	}

	function onPointerUp(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (!pointers.current.delete(e.pointerId)) return;
		const el = e.currentTarget;
		if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
		if (pinch.current) {
			pinch.current = null;
			swallowClick.current = true;
			const [rest] = [...pointers.current.entries()];
			press.current = rest
				? { id: rest[0], startX: rest[1].x, startY: rest[1].y, moved: true }
				: null;
			if (!zoomed.peek()) refit(true);
			return;
		}
		const held = press.current;
		press.current = null;
		delete el.dataset.dragging;
		if (!held || held.id !== e.pointerId || !held.moved) return;
		swallowClick.current = e.type === "pointerup";
		if (zoomed.peek() || e.type !== "pointerup") {
			if (!zoomed.peek()) draw(true);
			return;
		}
		const rtl = getComputedStyle(el).direction === "rtl";
		const step = swipeStep(
			e.clientX - held.startX,
			e.clientY - held.startY,
			container.current.width,
			rtl,
		);
		if (step !== 0) callbacks.current.onStep(step);
		else draw(true);
	}

	function onClick(e: JSX.TargetedMouseEvent<HTMLDivElement>): void {
		if (swallowClick.current) {
			swallowClick.current = false;
			return;
		}
		const target = e.target instanceof Element ? e.target : null;
		if (target?.closest(INTERACTIVE)) return;
		const img = imgRef.current;
		const f = frame();
		if (img && f && target === img) {
			if (zoomed.peek()) refit(true);
			else {
				view.current = zoomTo(
					view.current,
					clickZoomTarget(fitZoom.current),
					local(e.clientX, e.clientY),
					f,
				);
				draw(true);
			}
			return;
		}
		if (target === e.currentTarget) callbacks.current.onDismiss();
	}
	// #endregion

	function zoomBy(factor: number): void {
		const f = frame();
		if (!f) return;
		view.current = zoomTo(view.current, view.current.zoom * factor, null, f);
		draw(true);
	}

	return {
		stageRef,
		imgRef,
		zoomed,
		drawn,
		onLoad,
		stageHandlers: {
			onPointerDown,
			onPointerMove,
			onPointerUp,
			onPointerCancel: onPointerUp,
			onClick,
		},
		zoomBy,
		reset: () => refit(true),
	};
}
