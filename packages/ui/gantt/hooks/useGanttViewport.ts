/**
 * @projective/ui/gantt — the VIEWPORT hook: everything a native scroll container quietly provides,
 * re-implemented over the signal store, plus the gestures the brief names.
 *
 *  - **Wheel** — plain: the time axis (the primary, infinite one) · Shift: the lanes · Ctrl/Meta:
 *    zoom the time scale, anchored on the cursor · Ctrl+Shift: zoom the ROWS (lane density).
 *  - **Keyboard** — Left/Right scroll time (Shift: a page) · Ctrl+Up/Down scroll lanes ·
 *    Page Up/Down a screen of lanes. Up/Down alone belong to the ISLAND (item focus), which is why
 *    `handleKey` declines them.
 *  - **Pan** — Ctrl+left-drag, or middle-drag, is a 1:1 two-dimensional pan with release momentum.
 *  - **Fly mode** — a middle CLICK (a press that does not travel) enters it: the origin is marked and
 *    the viewport scrolls continuously at a velocity proportional to the pointer's distance from
 *    that origin, per axis, until the next press, Escape, a wheel or a blur. Ctrl+middle is a STRICT
 *    drag — it never enters fly mode even if it does not travel.
 *  - **Touch** — one finger pans (with momentum); two fingers pinch-zoom the time scale about their
 *    midpoint AND pan with it. The host sets `touch-action: none`, which is what hands both to us.
 *  - **Zoom interpolation** — a cursor-anchored spring the store re-pins through on every frame, so
 *    the instant under the pointer holds still for the whole journey.
 *
 * THE BACKGROUND-TAB RULE. Every rAF loop here (fling, fly, glide, the springs) caps its `dt` and
 * can be watchdogged, and every offset write is visible synchronously — a frozen animation clock
 * can strand a decoration, never a fact.
 */
import type { RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { batch } from "@preact/signals";
import {
	createSpring,
	prefersJumpToFinal,
	type Spring,
	SPRING_STANDARD,
} from "../../core/motion.ts";
import { joystickVelocity, LEVER_DT_CAP_MS, LEVER_FRAME_MS } from "../../calendar/core/chrome.ts";
import {
	MOMENTUM_DECAY,
	MOMENTUM_MIN_RELEASE_V,
	MOMENTUM_MIN_V,
	VELOCITY_WINDOW_MS,
} from "../../calendar/core/scene-build.ts";
import type { GanttStore } from "../core/gantt-store.ts";
import { ROW_SCALE_STEP } from "../core/gantt-store.ts";
import { ZOOM_STEP } from "../core/time-scale.ts";

// #region Constants
/** A `deltaMode: line` wheel notch, in px. */
const WHEEL_LINE_PX = 16;
/** Arrow-key step (px) along the time axis, at least. */
const KEY_STEP_PX = 48;
/** How much of the viewport a Shift+Arrow / Page key travels. */
const PAGE_FRACTION = 0.9;
/** Pointer travel (px) that turns a middle press into a drag rather than a fly-mode click. */
const DRAG_THRESHOLD = 4;
/** Smooth-scroll duration (ms) for a programmatic glide. */
const GLIDE_MS = 240;
/** Below this separation (px) two touch points are too close for their ratio to mean anything. */
const PINCH_MIN_DIST_PX = 24;
/** Settle threshold for the zoom spring, in px/day. */
const ZOOM_SETTLE_EPSILON = 0.01;
// #endregion

// #region Types
export interface UseGanttViewportOptions {
	store: GanttStore;
	/** Called on every settled zoom with the new px-per-day. */
	onZoomSettle?: (pxPerDay: number) => void;
	/** Two-finger pinch zooms the time scale. Default `true` — the host declares `touch-action: none`. */
	enablePinch?: boolean;
}

export interface GanttViewport {
	/** Attach to the element the canvas fills — it is measured, and it carries the input handlers. */
	hostRef: RefObject<HTMLDivElement>;
	/** A pointer's position in LOGICAL viewport space (x from the inline start). */
	pointerAt: (e: PointerEvent | MouseEvent) => { x: number; y: number };
	/**
	 * Start a pan if the pointer qualifies (middle button, Ctrl/Meta+left, or a primary touch).
	 * Returns whether it did. A middle press that never travels enters FLY MODE on release.
	 */
	beginPan: (e: PointerEvent) => boolean;
	/** Handle a scrolling key. Returns whether it consumed the event. */
	handleKey: (e: KeyboardEvent) => boolean;
	/** Interpolate the zoom toward `target`, anchored at a viewport x (or the centre). */
	zoomTo: (target: number, anchorViewX?: number | null, onSettle?: () => void) => () => void;
	/** One zoom notch in or out, anchored at a viewport x. */
	zoomStep: (dir: "in" | "out", anchorViewX?: number | null) => void;
	/** Glide the time axis so that content x `x` lands at the viewport's inline start. */
	glideToX: (x: number) => void;
	/** Leave fly mode, if on. */
	endFly: () => void;
	/** Stop every animation in flight (a glide, a fling, fly mode). */
	cancelMotion: () => void;
}
// #endregion

export function useGanttViewport(opts: UseGanttViewportOptions): GanttViewport {
	const { store } = opts;
	const hostRef = useRef<HTMLDivElement>(null);
	/** The one animation slot: a glide, a fling and fly mode may never drive the offset at once. */
	const frame = useRef(0);
	const settleRef = useRef(opts.onZoomSettle);
	settleRef.current = opts.onZoomSettle;

	const cancelFrame = useCallback(() => {
		if (frame.current) {
			globalThis.cancelAnimationFrame?.(frame.current);
			frame.current = 0;
		}
	}, []);

	// #region Measurement
	/*
	 * A LAYOUT effect: Preact defers `useEffect` behind a frame, so in a hidden document the viewport
	 * would go unmeasured, the height would stay 0, and a canvas that draws only what intersects its
	 * box would draw nothing at all.
	 */
	useLayoutEffect(() => {
		const el = hostRef.current;
		if (!el || typeof window === "undefined") return;
		const read = () => {
			const rect = el.getBoundingClientRect();
			batch(() => {
				store.viewportW.value = rect.width;
				store.viewportH.value = rect.height;
				store.rtl.value = getComputedStyle(el).direction === "rtl";
			});
			// The content may have become shorter than the offset; the store clamps on write.
			store.scrollTo(undefined, store.scrollY.peek());
		};
		read();
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
		ro?.observe(el);
		globalThis.addEventListener("resize", read);
		return () => {
			ro?.disconnect();
			globalThis.removeEventListener("resize", read);
		};
	}, [store]);
	// #endregion

	// #region Pointer mapping
	const pointerAt = useCallback((e: PointerEvent | MouseEvent) => {
		const el = hostRef.current;
		if (!el) return { x: 0, y: 0 };
		const rect = el.getBoundingClientRect();
		const physical = e.clientX - rect.left;
		return {
			x: store.rtl.peek() ? rect.width - physical : physical,
			y: e.clientY - rect.top,
		};
	}, [store]);
	// #endregion

	// #region Glide + fling + fly
	const glideToX = useCallback((x: number) => {
		cancelFrame();
		const raf = globalThis.requestAnimationFrame;
		if (prefersJumpToFinal() || typeof raf !== "function") {
			store.scrollTo(x, undefined);
			return;
		}
		const from = store.scrollX.peek();
		const startedAt = Date.now();
		const step = () => {
			// Elapsed WALL time, not a frame count: a throttled tab still lands on schedule.
			const t = Math.min(1, (Date.now() - startedAt) / GLIDE_MS);
			store.scrollTo(from + (x - from) * (1 - Math.pow(1 - t, 5)), undefined);
			frame.current = t < 1 ? raf(step) : 0;
		};
		frame.current = raf(step);
	}, [cancelFrame, store]);

	/** Momentum: decelerate `(vx, vy)` (px/ms) until it drops below the floor or the range clamps it. */
	const fling = useCallback((vx: number, vy: number) => {
		const raf = globalThis.requestAnimationFrame;
		if (typeof raf !== "function") return;
		let velX = vx;
		let velY = vy;
		let last = Date.now();
		let x = store.scrollX.peek();
		let y = store.scrollY.peek();
		const step = () => {
			const now = Date.now();
			// Capped: rAF does not fire in a hidden tab, so the gap on return can be arbitrarily large,
			// and integrating a stale velocity across it would fling the offset an unrelated distance.
			const dt = Math.min(48, Math.max(1, now - last));
			last = now;
			x += velX * dt;
			y += velY * dt;
			store.scrollTo(x, y);
			const decay = Math.pow(MOMENTUM_DECAY, dt / 16.67);
			velX *= decay;
			velY *= decay;
			// The vertical range is bounded, so a fling into it stops dead rather than coasting
			// against the wall; the time axis is not, so it decays out on its own.
			if (Math.abs(store.scrollY.peek() - y) > 1) velY = 0;
			if (Math.abs(velX) < MOMENTUM_MIN_V && Math.abs(velY) < MOMENTUM_MIN_V) {
				frame.current = 0;
				return;
			}
			frame.current = raf(step);
		};
		frame.current = raf(step);
	}, [store]);

	/** The pointer's live position while fly mode is on, in viewport space. */
	const flyPointer = useRef<{ x: number; y: number } | null>(null);
	const flyAt = useRef(-1);

	const endFly = useCallback(() => {
		if (store.fly.peek() === null) return;
		store.fly.value = null;
		flyPointer.current = null;
		flyAt.current = -1;
		cancelFrame();
	}, [cancelFrame, store]);

	/**
	 * Fly mode's loop: every frame, scroll by the joystick velocity of the pointer's displacement from
	 * the origin, per axis. `joystickVelocity` is the calendar lever's own ramp — dead zone, quadratic
	 * rise, saturation — so a middle click held still does not drift, and a small accidental
	 * deflection is gentle rather than a committed fast-scroll.
	 */
	const enterFly = useCallback((origin: { x: number; y: number }) => {
		cancelFrame();
		store.fly.value = origin;
		flyPointer.current = origin;
		flyAt.current = -1;
		const raf = globalThis.requestAnimationFrame;
		if (typeof raf !== "function") return;
		const tick = (now: number) => {
			const o = store.fly.peek();
			if (!o) {
				frame.current = 0;
				return;
			}
			if (flyAt.current < 0) flyAt.current = now;
			const dt = Math.min(LEVER_DT_CAP_MS, Math.max(0, now - flyAt.current));
			flyAt.current = now;
			const p = flyPointer.current ?? o;
			const scale = dt / LEVER_FRAME_MS;
			const dx = joystickVelocity(p.x - o.x) * scale;
			const dy = joystickVelocity(p.y - o.y) * scale;
			if (dx !== 0 || dy !== 0) store.scrollBy(dx, dy);
			frame.current = raf(tick);
		};
		frame.current = raf(tick);
	}, [cancelFrame, store]);

	// Fly mode reads the pointer and exits on any press, Escape, wheel or blur — on the DOCUMENT, so
	// the pointer may roam anywhere on the page while the timeline keeps flying.
	useEffect(() => {
		if (typeof document === "undefined") return;
		const move = (e: PointerEvent) => {
			if (store.fly.peek() === null) return;
			flyPointer.current = pointerAt(e);
		};
		const exit = () => endFly();
		const key = (e: KeyboardEvent) => {
			if (e.key === "Escape") endFly();
		};
		document.addEventListener("pointermove", move);
		document.addEventListener("keydown", key, true);
		globalThis.addEventListener("blur", exit);
		return () => {
			document.removeEventListener("pointermove", move);
			document.removeEventListener("keydown", key, true);
			globalThis.removeEventListener("blur", exit);
		};
	}, [endFly, pointerAt, store]);
	// #endregion

	// #region Pan (middle / Ctrl+left / touch) + fly-mode entry
	/** Ends whatever pan is in flight and detaches its listeners; null when none is. */
	const endPan = useRef<(() => void) | null>(null);

	const beginPan = useCallback((e: PointerEvent): boolean => {
		const isMiddle = e.button === 1;
		const isCtrlLeft = e.button === 0 && (e.ctrlKey || e.metaKey);
		const isTouch = e.pointerType === "touch" && e.isPrimary !== false;
		if (!isMiddle && !isCtrlLeft && !isTouch) return false;
		// A press of any kind ends fly mode — and a middle press that ends it is spent on that alone.
		if (store.fly.peek() !== null) {
			endFly();
			if (!isTouch) e.preventDefault();
			return true;
		}
		// Not on touch: `preventDefault` on a touch pointerdown suppresses the click the tap becomes.
		if (!isTouch) e.preventDefault();
		cancelFrame();
		const origin = {
			cx: e.clientX,
			cy: e.clientY,
			sx: store.scrollX.peek(),
			sy: store.scrollY.peek(),
		};
		const originView = pointerAt(e);
		// A strict drag never enters fly mode: Ctrl+middle, and every non-middle pan.
		const mayFly = isMiddle && !(e.ctrlKey || e.metaKey);
		let moved = false;
		const samples: { t: number; x: number; y: number }[] = [{
			t: Date.now(),
			x: e.clientX,
			y: e.clientY,
		}];
		store.panning.value = !isTouch;
		const dirX = store.rtl.peek() ? -1 : 1;

		const move = (ev: PointerEvent) => {
			if (!moved && Math.hypot(ev.clientX - origin.cx, ev.clientY - origin.cy) < DRAG_THRESHOLD) {
				return;
			}
			moved = true;
			store.scrollTo(
				origin.sx - (ev.clientX - origin.cx) * dirX,
				origin.sy - (ev.clientY - origin.cy),
			);
			const now = Date.now();
			samples.push({ t: now, x: ev.clientX, y: ev.clientY });
			while (samples.length > 2 && now - samples[0].t > VELOCITY_WINDOW_MS) samples.shift();
		};
		const detach = () => {
			store.panning.value = false;
			endPan.current = null;
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", up);
			globalThis.removeEventListener("pointercancel", cancel);
		};
		const up = (ev: PointerEvent) => {
			detach();
			if (!moved) {
				if (mayFly) enterFly(originView);
				return;
			}
			const first = samples[0];
			const now = Date.now();
			if (first && now - first.t <= VELOCITY_WINDOW_MS + 16 && now - first.t > 0) {
				const vx = -((ev.clientX - first.x) / (now - first.t)) * dirX;
				const vy = -(ev.clientY - first.y) / (now - first.t);
				if (Math.hypot(vx, vy) >= MOMENTUM_MIN_RELEASE_V) fling(vx, vy);
			}
		};
		const cancel = () => detach();
		endPan.current = cancel;
		globalThis.addEventListener("pointermove", move);
		globalThis.addEventListener("pointerup", up);
		globalThis.addEventListener("pointercancel", cancel);
		return true;
	}, [cancelFrame, endFly, enterFly, fling, pointerAt, store]);

	useEffect(() => () => endPan.current?.(), []);
	// #endregion

	// #region Zoom (spring, cursor-anchored)
	const spring = useRef<Spring | null>(null);
	const unsubs = useRef<Array<() => void>>([]);
	const settleCb = useRef<(() => void) | null>(null);
	const zoomGen = useRef(0);

	const zoomTo = useCallback(
		(target: number, anchorViewX?: number | null, onSettle?: () => void): () => void => {
			cancelFrame();
			store.setZoomAnchor(anchorViewX ?? null);
			let s = spring.current;
			if (!s) {
				s = createSpring(store.pxPerDay.peek(), {
					config: SPRING_STANDARD,
					epsilon: ZOOM_SETTLE_EPSILON,
				});
				// `subscribe` runs untracked, so writing the zoom here registers no dependency.
				unsubs.current.push(s.value.subscribe((v) => store.setZoom(v)));
				unsubs.current.push(s.settled.subscribe((settled) => {
					if (!settled) return;
					const done = settleCb.current;
					settleCb.current = null;
					done?.();
					settleRef.current?.(store.pxPerDay.peek());
				}));
				spring.current = s;
			}
			// The store (or a host) may have written the zoom directly; adopt it before re-targeting.
			if (Math.abs(s.value.peek() - store.pxPerDay.peek()) > ZOOM_SETTLE_EPSILON) {
				s.jump(store.pxPerDay.peek());
			}
			const gen = ++zoomGen.current;
			settleCb.current = onSettle ?? null;
			const [lo, hi] = store.zoomRange;
			s.set(Math.min(hi, Math.max(lo, target)));
			if (s.settled.peek()) {
				const done = settleCb.current;
				settleCb.current = null;
				done?.();
				settleRef.current?.(store.pxPerDay.peek());
			}
			const owned = s;
			return () => {
				if (zoomGen.current !== gen) return;
				settleCb.current = null;
				owned.stop();
			};
		},
		[cancelFrame, store],
	);

	/** The scale the last notch AIMED at, so a trackpad burst compounds instead of collapsing. */
	const pendingZoom = useRef<number | null>(null);
	const zoomStep = useCallback((dir: "in" | "out", anchorViewX?: number | null) => {
		const cur = pendingZoom.current ?? store.pxPerDay.peek();
		const [lo, hi] = store.zoomRange;
		const next = Math.min(hi, Math.max(lo, dir === "in" ? cur * ZOOM_STEP : cur / ZOOM_STEP));
		pendingZoom.current = next;
		zoomTo(next, anchorViewX, () => {
			pendingZoom.current = null;
		});
	}, [store, zoomTo]);

	useEffect(() => () => {
		for (const off of unsubs.current) off();
		unsubs.current = [];
		spring.current?.dispose();
		spring.current = null;
	}, []);
	// #endregion

	// #region Wheel
	useEffect(() => {
		const el = hostRef.current;
		if (!el || typeof window === "undefined") return;
		const onWheel = (e: WheelEvent) => {
			endFly();
			const unit = e.deltaMode === 1
				? WHEEL_LINE_PX
				: e.deltaMode === 2
				? store.viewportH.peek()
				: 1;
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();
				// Stopped here so an ancestor that also zooms on Ctrl+wheel (the calendar island, on a
				// surface that hosts this engine as one of its views) does not zoom a second time.
				e.stopPropagation();
				if (e.shiftKey) {
					store.scaleRows(e.deltaY < 0 ? ROW_SCALE_STEP : 1 / ROW_SCALE_STEP);
					return;
				}
				zoomStep(e.deltaY < 0 ? "in" : "out", pointerAt(e).x);
				return;
			}
			e.preventDefault();
			cancelFrame();
			// Some platforms turn Shift+wheel into a horizontal delta; the larger axis is the intent.
			const dominant = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
			if (e.shiftKey) {
				store.scrollBy(0, dominant * unit);
				return;
			}
			// The time axis is the primary, infinite one: a vertical wheel AND a horizontal trackpad
			// swipe both travel it. The lanes are reached with Shift, the keys, or a drag.
			store.scrollBy((e.deltaX !== 0 ? e.deltaX : e.deltaY) * unit, 0);
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [cancelFrame, endFly, pointerAt, store, zoomStep]);
	// #endregion

	// #region Keyboard
	const handleKey = useCallback((e: KeyboardEvent): boolean => {
		const w = store.viewportW.peek();
		const h = store.viewportH.peek();
		const stepX = Math.max(KEY_STEP_PX, w * 0.125);
		const pageX = Math.max(KEY_STEP_PX, w * PAGE_FRACTION);
		const row = store.rowH.peek();
		const ctrl = e.ctrlKey || e.metaKey;
		endFly();
		switch (e.key) {
			case "ArrowRight":
				store.scrollBy(e.shiftKey ? pageX : stepX, 0);
				break;
			case "ArrowLeft":
				store.scrollBy(-(e.shiftKey ? pageX : stepX), 0);
				break;
			case "ArrowDown":
				if (!ctrl) return false;
				store.scrollBy(0, row);
				break;
			case "ArrowUp":
				if (!ctrl) return false;
				store.scrollBy(0, -row);
				break;
			case "PageDown":
				store.scrollBy(0, Math.max(row, h * PAGE_FRACTION));
				break;
			case "PageUp":
				store.scrollBy(0, -Math.max(row, h * PAGE_FRACTION));
				break;
			default:
				return false;
		}
		e.preventDefault();
		return true;
	}, [endFly, store]);
	// #endregion

	// #region Pinch (two fingers: zoom about the midpoint, and pan with it)
	const points = useRef(new Map<number, { x: number; y: number }>());
	const pinch = useRef<
		| { ids: [number, number]; startDist: number; startPpd: number; mid: { x: number; y: number } }
		| null
	>(null);
	useEffect(() => {
		const el = hostRef.current;
		if (!el || opts.enablePinch === false || typeof window === "undefined") return;
		const pts = points.current;
		const gap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
			Math.hypot(a.x - b.x, a.y - b.y);
		const midOf = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
			x: (a.x + b.x) / 2,
			y: (a.y + b.y) / 2,
		});
		const down = (e: PointerEvent) => {
			if (e.pointerType !== "touch") return;
			pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pinch.current || pts.size !== 2) return;
			const [ia, ib] = Array.from(pts.keys());
			const a = pts.get(ia)!;
			const b = pts.get(ib)!;
			const dist = gap(a, b);
			if (dist < PINCH_MIN_DIST_PX) return;
			// The first finger started a one-finger pan; a second finger turns the gesture into a pinch.
			endPan.current?.();
			cancelFrame();
			const rect = el.getBoundingClientRect();
			const mid = midOf(a, b);
			const viewX = store.rtl.peek() ? rect.width - (mid.x - rect.left) : mid.x - rect.left;
			store.setZoomAnchor(viewX);
			pinch.current = { ids: [ia, ib], startDist: dist, startPpd: store.pxPerDay.peek(), mid };
		};
		const move = (e: PointerEvent) => {
			const p = pts.get(e.pointerId);
			if (!p) return;
			const prevMid = pinch.current
				? midOf(pts.get(pinch.current.ids[0]) ?? p, pts.get(pinch.current.ids[1]) ?? p)
				: null;
			p.x = e.clientX;
			p.y = e.clientY;
			const g = pinch.current;
			if (!g) return;
			const a = pts.get(g.ids[0]);
			const b = pts.get(g.ids[1]);
			if (!a || !b) return;
			if (e.cancelable) e.preventDefault();
			const dist = gap(a, b);
			if (dist >= PINCH_MIN_DIST_PX) {
				// Written straight rather than sprung: two fingers ARE the interpolation.
				store.setZoom(g.startPpd * (dist / g.startDist));
			}
			const mid = midOf(a, b);
			if (prevMid) {
				const dirX = store.rtl.peek() ? -1 : 1;
				store.scrollBy(-(mid.x - prevMid.x) * dirX, -(mid.y - prevMid.y));
				// The anchor follows the fingers, so a two-finger pan re-pins where they now are.
				const rect = el.getBoundingClientRect();
				const viewX = store.rtl.peek() ? rect.width - (mid.x - rect.left) : mid.x - rect.left;
				store.setZoomAnchor(viewX);
			}
		};
		const end = (e: PointerEvent) => {
			pts.delete(e.pointerId);
			const g = pinch.current;
			if (!g || (pts.has(g.ids[0]) && pts.has(g.ids[1]))) return;
			pinch.current = null;
			store.setZoomAnchor(null);
			settleRef.current?.(store.pxPerDay.peek());
		};
		el.addEventListener("pointerdown", down);
		globalThis.addEventListener("pointermove", move, { passive: false });
		globalThis.addEventListener("pointerup", end);
		globalThis.addEventListener("pointercancel", end);
		return () => {
			el.removeEventListener("pointerdown", down);
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", end);
			globalThis.removeEventListener("pointercancel", end);
			pts.clear();
			pinch.current = null;
		};
	}, [cancelFrame, opts.enablePinch, store]);
	// #endregion

	const cancelMotion = useCallback(() => {
		cancelFrame();
		if (store.fly.peek() !== null) store.fly.value = null;
	}, [cancelFrame, store]);

	useEffect(() => cancelFrame, [cancelFrame]);

	return {
		hostRef,
		pointerAt,
		beginPan,
		handleKey,
		zoomTo,
		zoomStep,
		glideToX,
		endFly,
		cancelMotion,
	};
}
