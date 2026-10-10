import type { JSX } from "preact";
import { effect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
	canPan,
	imageBounds,
	pinchDelta,
	type PinchFrame,
	pinchFrame,
	type Point,
	type Size,
	sliderPosition,
	sliderZoom,
	snapTwist,
	thirdsBox,
	toCss,
	wheelFactor,
} from "../../../core/viewport.ts";
import type { ViewerProps } from "../viewer.ts";
import type { ImageTools } from "./image-tools.ts";
import { ImageZoomBar } from "./ImageZoomBar.tsx";

const DRAG_SLOP_PX = 4;
const TAP_GAP_MS = 350;
const TAP_SLOP_PX = 24;
const NUDGE_PX = 48;
const NUDGE_PX_LARGE = 192;
const SETTLE_MS = 180;
const PIXELATED_FROM = 3;
const SIZELESS_VECTOR_PX = 1024;

interface Press {
	id: number;
	startX: number;
	startY: number;
	moved: boolean;
}

interface Tap {
	time: number;
	x: number;
	y: number;
}

const SAFARI_GESTURES = ["gesturestart", "gesturechange", "gestureend"] as const;

interface SafariGesture extends UIEvent {
	readonly scale: number;
	readonly clientX: number;
	readonly clientY: number;
}

function isSafariGesture(e: Event): e is SafariGesture {
	return "scale" in e && typeof e.scale === "number" && Number.isFinite(e.scale) && e.scale > 0 &&
		"clientX" in e && typeof e.clientX === "number" && "clientY" in e &&
		typeof e.clientY === "number";
}

function naturalSize(img: HTMLImageElement, vector: boolean, hinted: Size | null): Size | null {
	if (img.naturalWidth > 0 && img.naturalHeight > 0) {
		return { width: img.naturalWidth, height: img.naturalHeight };
	}
	if (!vector) return null;
	if (hinted) return hinted;
	img.style.setProperty("--ins-image-w", `${SIZELESS_VECTOR_PX}px`);
	const height = img.getBoundingClientRect().height;
	img.style.removeProperty("--ins-image-w");
	return {
		width: SIZELESS_VECTOR_PX,
		height: height > 0 ? Math.round(height) : SIZELESS_VECTOR_PX,
	};
}

/**
 * The image canvas: the picture laid out at natural size and moved by one CSS transform, with
 * pointer pan, two-finger pinch, wheel zoom at the cursor, double-click fit ↔ 100% and keyboard
 * zoom/pan/rotate/flip on the focused stage.
 */
export function ImageStage({ shell, tools }: ViewerProps<ImageTools>): JSX.Element {
	const { asset } = shell;
	const rootRef = useRef<HTMLDivElement>(null);
	const imgRef = useRef<HTMLImageElement>(null);
	const plateRef = useRef<HTMLSpanElement>(null);
	const thirdsRef = useRef<HTMLSpanElement>(null);
	const pointers = useRef(new Map<number, Point>());
	const press = useRef<Press | null>(null);
	const pinch = useRef<PinchFrame | null>(null);
	const twist = useRef(0);
	const lastTap = useRef<Tap | null>(null);
	const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const source = tools.source.value;
	const natural = tools.natural.value;
	const ready = tools.ready.value;

	function local(clientX: number, clientY: number): Point {
		const rect = rootRef.current?.getBoundingClientRect();
		return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: clientX, y: clientY };
	}

	function markMoving(): void {
		const root = rootRef.current;
		if (!root) return;
		root.dataset.moving = "true";
		if (settleTimer.current !== null) clearTimeout(settleTimer.current);
		settleTimer.current = setTimeout(() => {
			settleTimer.current = null;
			delete root.dataset.moving;
		}, SETTLE_MS);
	}

	// #region Measure
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		const measure = () => {
			const rect = root.getBoundingClientRect();
			tools.resize({ width: rect.width, height: rect.height });
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(root);
		return () => ro.disconnect();
	}, [tools]);
	// #endregion

	// #region Decode
	useEffect(() => {
		const img = imgRef.current;
		if (!img) return;
		let settled = false;
		const hinted = asset.width !== null && asset.height !== null
			? { width: asset.width, height: asset.height }
			: null;
		const settle = (ok: boolean) => {
			if (settled) return;
			settled = true;
			const exact = img.naturalWidth > 0 && img.naturalHeight > 0 || hinted !== null;
			const size = ok ? naturalSize(img, tools.vector, hinted) : null;
			if (size) tools.loaded(size, exact);
			else tools.failed();
		};
		const onLoad = () => {
			if (tools.vector) settle(true);
			else img.decode().then(() => settle(true), () => settle(img.naturalWidth > 0));
		};
		const onError = () => settle(false);
		img.addEventListener("load", onLoad);
		img.addEventListener("error", onError);
		if (img.complete) {
			if (img.naturalWidth > 0) settle(true);
			else img.decode().then(() => settle(true), () => settle(false));
		}
		return () => {
			settled = true;
			img.removeEventListener("load", onLoad);
			img.removeEventListener("error", onError);
			if (!img.complete) img.removeAttribute("src");
		};
	}, [source, tools]);
	// #endregion

	// #region Draw
	useEffect(() => {
		let raf = 0;
		const dispose = effect(() => {
			const view = tools.view.value;
			const box = tools.container.value;
			const size = tools.natural.value;
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				const root = rootRef.current;
				const img = imgRef.current;
				if (!root || !img) return;
				if (!size || box.width <= 0) {
					delete root.dataset.drawn;
					return;
				}
				root.dataset.transition = tools.motion.peek();
				img.style.transform = toCss(view);
				const b = imageBounds(view, box, size);
				const top = Math.max(0, b.top);
				const left = Math.max(0, b.left);
				const bottom = Math.max(0, box.height - b.top - b.height);
				const right = Math.max(0, box.width - b.left - b.width);
				plateRef.current?.style.setProperty(
					"clip-path",
					`inset(${top}px ${right}px ${bottom}px ${left}px)`,
				);
				const thirds = thirdsRef.current;
				const guide = thirdsBox(view, box, size);
				if (thirds && guide) {
					thirds.style.transform = `translate(${guide.left}px, ${guide.top}px)`;
					thirds.style.setProperty("--ins-thirds-w", `${guide.width}px`);
					thirds.style.setProperty("--ins-thirds-h", `${guide.height}px`);
				}
				root.dataset.pannable = canPan(view, box, size) ? "true" : "false";
				if (!tools.vector && view.zoom >= PIXELATED_FROM) root.dataset.pixels = "true";
				else delete root.dataset.pixels;
				root.dataset.drawn = "true";
			});
		});
		return () => {
			dispose();
			cancelAnimationFrame(raf);
			if (settleTimer.current !== null) clearTimeout(settleTimer.current);
		};
	}, [tools]);

	useEffect(() =>
		effect(() => {
			const position = tools.zoomSlider.value;
			const limits = tools.limits.peek();
			if (position !== sliderPosition(tools.view.peek().zoom, limits)) {
				tools.zoomToLevel(sliderZoom(position, limits));
			}
		}), [tools]);
	// #endregion

	// #region Wheel
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		const onWheel = (e: WheelEvent) => {
			if (!tools.ready.peek()) return;
			e.preventDefault();
			const pinching = e.ctrlKey || e.metaKey;
			tools.zoomAround(local(e.clientX, e.clientY), wheelFactor(e.deltaY, e.deltaMode, pinching));
			markMoving();
		};
		let gestureScale = 1;
		const onGesture = (e: Event) => {
			e.preventDefault();
			if (!isSafariGesture(e) || pointers.current.size > 0 || !tools.ready.peek()) return;
			if (e.type === "gesturestart") gestureScale = 1;
			const factor = e.scale / gestureScale;
			gestureScale = e.scale;
			if (e.type === "gesturechange") {
				tools.zoomAround(local(e.clientX, e.clientY), factor);
				markMoving();
			}
		};
		root.addEventListener("wheel", onWheel, { passive: false });
		for (const type of SAFARI_GESTURES) root.addEventListener(type, onGesture, { passive: false });
		return () => {
			root.removeEventListener("wheel", onWheel);
			for (const type of SAFARI_GESTURES) root.removeEventListener(type, onGesture);
		};
	}, [tools]);
	// #endregion

	// #region Keyboard
	useEffect(() => {
		const stage = rootRef.current?.closest<HTMLElement>(".ins-stage");
		if (!stage) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !tools.ready.peek()) return;
			const step = e.shiftKey ? NUDGE_PX_LARGE : NUDGE_PX;
			const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
			switch (key) {
				case "+":
				case "=":
					tools.zoomStep(1);
					break;
				case "-":
				case "_":
					tools.zoomStep(-1);
					break;
				case "0":
					tools.fitToStage();
					break;
				case "1":
					tools.actualSize();
					break;
				case "ArrowLeft":
					tools.pan(step, 0, "animate");
					break;
				case "ArrowRight":
					tools.pan(-step, 0, "animate");
					break;
				case "ArrowUp":
					tools.pan(0, step, "animate");
					break;
				case "ArrowDown":
					tools.pan(0, -step, "animate");
					break;
				case "r":
					tools.rotate(e.shiftKey ? -1 : 1);
					break;
				case "h":
					tools.flipAxis("horizontal");
					break;
				case "v":
					tools.flipAxis("vertical");
					break;
				case "g":
					tools.toggleGrid();
					break;
				default:
					return;
			}
			e.preventDefault();
		};
		stage.addEventListener("keydown", onKey);
		return () => stage.removeEventListener("keydown", onKey);
	}, [tools]);
	// #endregion

	// #region Pointer
	function currentPinch(): PinchFrame | null {
		const [a, b] = [...pointers.current.values()];
		return a && b ? pinchFrame(local(a.x, a.y), local(b.x, b.y)) : null;
	}

	function capture(el: HTMLElement, id: number): void {
		try {
			if (!el.hasPointerCapture(id)) el.setPointerCapture(id);
		} catch {
			pointers.current.delete(id);
		}
	}

	function onPointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (!tools.ready.peek()) return;
		if (e.pointerType === "mouse" && e.button !== 0) return;
		if (e.target instanceof Element && e.target.closest(".ins-image__bar")) return;
		if (pointers.current.size >= 2) return;
		e.preventDefault();
		e.currentTarget.closest<HTMLElement>(".ins-stage")?.focus({ preventScroll: true });
		pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pointers.current.size === 2) {
			for (const id of [...pointers.current.keys()]) capture(e.currentTarget, id);
			press.current = null;
			lastTap.current = null;
			pinch.current = currentPinch();
			twist.current = 0;
			return;
		}
		press.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
	}

	function onPointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const last = pointers.current.get(e.pointerId);
		if (!last) return;
		const prev = pinch.current;
		if (prev) {
			pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
			const next = currentPinch();
			if (!next) return;
			pinch.current = next;
			const d = pinchDelta(prev, next);
			twist.current += d.rotation;
			tools.zoomAround({ x: next.cx, y: next.cy }, d.scale);
			tools.pan(d.dx, d.dy);
			markMoving();
			return;
		}
		const held = press.current;
		if (!held || held.id !== e.pointerId) return;
		if (!held.moved) {
			const travel = Math.hypot(e.clientX - held.startX, e.clientY - held.startY);
			if (travel < DRAG_SLOP_PX) return;
			held.moved = true;
			lastTap.current = null;
			capture(e.currentTarget, e.pointerId);
			e.currentTarget.dataset.dragging = "true";
		}
		pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
		tools.pan(e.clientX - last.x, e.clientY - last.y);
		markMoving();
	}

	function onPointerUp(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (!pointers.current.delete(e.pointerId)) return;
		const el = e.currentTarget;
		if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
		if (pinch.current) {
			pinch.current = null;
			const turns = snapTwist(twist.current);
			twist.current = 0;
			for (let i = 0; i < Math.abs(turns); i++) tools.rotate(turns > 0 ? 1 : -1);
			const [rest] = [...pointers.current.entries()];
			press.current = rest
				? { id: rest[0], startX: rest[1].x, startY: rest[1].y, moved: true }
				: null;
			return;
		}
		const held = press.current;
		press.current = null;
		delete el.dataset.dragging;
		if (!held || held.id !== e.pointerId || held.moved || e.type !== "pointerup") return;
		const tap = lastTap.current;
		const now = e.timeStamp;
		if (
			tap && now - tap.time < TAP_GAP_MS &&
			Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < TAP_SLOP_PX
		) {
			lastTap.current = null;
			tools.toggleFit(local(e.clientX, e.clientY));
			return;
		}
		lastTap.current = { time: now, x: e.clientX, y: e.clientY };
	}
	// #endregion

	const imageStyle = natural
		? { "--ins-image-w": `${natural.width}px`, "--ins-image-h": `${natural.height}px` }
		: undefined;

	return (
		<div
			ref={rootRef}
			class={`ins-image${tools.vector ? " ins-image--vector" : ""}`}
			data-background={tools.background.value}
			data-grid={tools.grid.value ? "true" : undefined}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
		>
			<span ref={plateRef} class="ins-image__plate" aria-hidden="true" />
			<img
				ref={imgRef}
				key={source}
				class="ins-image__img"
				src={source}
				alt={asset.name}
				draggable={false}
				decoding="async"
				style={imageStyle}
			/>
			<span ref={thirdsRef} class="ins-image__thirds" aria-hidden="true">
				<span class="ins-image__third ins-image__third--v1" />
				<span class="ins-image__third ins-image__third--v2" />
				<span class="ins-image__third ins-image__third--h1" />
				<span class="ins-image__third ins-image__third--h2" />
			</span>
			{ready && !shell.options.embedded ? <ImageZoomBar shell={shell} tools={tools} /> : null}
		</div>
	);
}
