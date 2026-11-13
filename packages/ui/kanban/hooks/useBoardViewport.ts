import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { effect, type ReadonlySignal, type Signal, useSignal } from "@preact/signals";
import { createSpring, SPRING_STANDARD } from "../../core/motion.ts";
import type { DndActive, DndPoint } from "../../dnd/core/types.ts";
import {
	boardWheelDelta,
	edgeScrollVelocity,
	PAN_THRESHOLD_PX,
	type SettleColumn,
	settleTarget,
	SNAP_IDLE_MS,
	snapTarget,
	wheelStaysInColumn,
} from "../core/viewport.ts";

const COLUMN = ".ui-kanban__column";
const COLUMN_BODY = ".ui-kanban__col-body";

/** The drag the board auto-scrolls under — read from the enclosing `DndContext`. */
export interface BoardViewportDrag {
	active: ReadonlySignal<DndActive | null>;
	/** The live pointer, client coordinates. */
	pointer: ReadonlySignal<DndPoint>;
	/** Re-run the drop hit-test after the board scrolled under a still pointer. */
	resample: () => void;
}

/** Options for {@link useBoardViewport}. */
export interface BoardViewportOptions {
	/** The horizontal scroller — `.ui-kanban__board`. */
	scrollerRef: RefObject<HTMLElement>;
	/** Whether a card or column drag is in flight; the board never settles under one. */
	isDragging: () => boolean;
	/** The drag to auto-scroll under; absent, a drag held at an edge does not scroll the board. */
	drag?: BoardViewportDrag;
}

/** What {@link useBoardViewport} exposes to the board's markup. */
export interface BoardViewport {
	/** A Ctrl/Meta + left-drag pan is in progress — drives `data-panning`. */
	panning: Signal<boolean>;
}

/**
 * The Kanban board's viewport gestures, in the calendar and Gantt vocabulary:
 *
 * - **Wheel** — a vertical turn or horizontal swipe moves the board sideways 1:1, so a burst glides
 *   continuously. A vertical turn over a column whose body can scroll stays in that column. Ctrl/Meta
 *   + wheel is left to the browser.
 * - **Pan** — Ctrl/Meta + left-drag pans the board 1:1 sideways and the column under the press
 *   vertically. The press is taken before a card sees it, so a pan never starts a card drag, and a
 *   pan that travelled swallows the click that follows. The middle button is the browser's own:
 *   its autoscroll runs untouched.
 * - **Edge auto-scroll** — a pointer drag held within `EDGE_ZONE_PX` of the board's left or
 *   right edge scrolls it that way, faster the nearer the edge, on a frame loop; each step re-runs the
 *   drop hit-test so the target follows the columns passing under the still pointer.
 * - **Settle** — only after the reader lets go: the wheel idle for {@link SNAP_IDLE_MS}, a pan,
 *   scrollbar or drag released, a touch fling run out; never while a drag is in flight. After
 *   leftward travel the leftmost column in view springs flush to the left edge, after rightward
 *   travel the rightmost one flush to the right ({@link settleTarget}); with no travel to read, the
 *   nearest column start. `SPRING_STANDARD`; under either reduced-motion channel it lands at once.
 *   Any new input stops a settle in flight, and so does any scroll the settle did not write (an
 *   autoscroll, a key).
 */
export function useBoardViewport(opts: BoardViewportOptions): BoardViewport {
	const panning = useSignal(false);
	const live = useRef(opts);
	live.current = opts;

	useEffect(() => {
		const el = opts.scrollerRef.current;
		if (!el || typeof globalThis.addEventListener !== "function") return;

		const spring = createSpring(el.scrollLeft, { config: SPRING_STANDARD, epsilon: 0.5 });
		let settling = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let held = false;
		let scrolledWhileHeld = false;
		let endPan: (() => void) | null = null;
		let lastWritten = el.scrollLeft;
		let prevLeft = el.scrollLeft;
		let direction: -1 | 0 | 1 = 0;

		const stopWrite = effect(() => {
			const v = spring.value.value;
			if (settling) {
				el.scrollLeft = v;
				lastWritten = el.scrollLeft;
			}
			if (spring.settled.value) settling = false;
		});

		const rtl = () => getComputedStyle(el).direction === "rtl";

		const bounds = (): { min: number; max: number } => {
			const overflow = Math.max(0, el.scrollWidth - el.clientWidth);
			return rtl() ? { min: -overflow, max: 0 } : { min: 0, max: overflow };
		};

		const columnStarts = (): number[] => {
			const box = el.getBoundingClientRect();
			const style = getComputedStyle(el);
			const pad = parseFloat(style.paddingInlineStart) || 0;
			const isRtl = style.direction === "rtl";
			return Array.from(el.querySelectorAll<HTMLElement>(`:scope > ${COLUMN}`)).map((col) => {
				const r = col.getBoundingClientRect();
				return isRtl
					? el.scrollLeft - (box.right - pad - r.right)
					: el.scrollLeft + (r.left - box.left - pad);
			});
		};

		const measure = (): { columns: SettleColumn[]; view: number } => {
			const box = el.getBoundingClientRect();
			const style = getComputedStyle(el);
			const padLeft = parseFloat(style.paddingLeft) || 0;
			const padRight = parseFloat(style.paddingRight) || 0;
			const contentLeft = box.left + el.clientLeft + padLeft;
			const columns = Array.from(el.querySelectorAll<HTMLElement>(`:scope > ${COLUMN}`)).map(
				(col) => {
					const r = col.getBoundingClientRect();
					return { leftAt: el.scrollLeft + (r.left - contentLeft), width: r.width };
				},
			);
			return { columns, view: el.clientWidth - padLeft - padRight };
		};

		const stopSettle = () => {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			if (settling) {
				spring.stop();
				settling = false;
			}
		};

		const settle = () => {
			timer = undefined;
			if (held || endPan || live.current.isDragging()) return;
			const { min, max } = bounds();
			let target: number | null;
			if (direction === 0) target = snapTarget(el.scrollLeft, columnStarts(), min, max);
			else {
				const { columns, view } = measure();
				target = settleTarget(el.scrollLeft, columns, view, min, max, direction);
			}
			if (target === null) return;
			spring.jump(el.scrollLeft);
			settling = true;
			spring.set(target);
		};

		const scheduleSettle = (delay: number) => {
			if (timer !== undefined) clearTimeout(timer);
			timer = setTimeout(settle, delay);
		};

		// #region Wheel
		const onWheel = (e: WheelEvent) => {
			if (e.defaultPrevented || e.ctrlKey || e.metaKey) return;
			if (el.scrollWidth - el.clientWidth < 1) return;
			const target = e.target instanceof Element ? e.target : null;
			const body = target?.closest<HTMLElement>(COLUMN_BODY);
			const scrollable = !!body && el.contains(body) && body.scrollHeight > body.clientHeight + 1;
			if (wheelStaysInColumn(e, scrollable)) return;
			const delta = boardWheelDelta(e, el.clientWidth, rtl());
			if (delta === 0) return;
			e.preventDefault();
			stopSettle();
			el.scrollLeft += delta;
			scheduleSettle(SNAP_IDLE_MS);
		};
		// #endregion

		// #region Pan
		const swallowNextClick = () => {
			const swallow = (ev: MouseEvent) => {
				ev.preventDefault();
				ev.stopPropagation();
			};
			globalThis.addEventListener("click", swallow, { capture: true, once: true });
			globalThis.addEventListener("auxclick", swallow, { capture: true, once: true });
			setTimeout(() => {
				globalThis.removeEventListener("click", swallow, { capture: true });
				globalThis.removeEventListener("auxclick", swallow, { capture: true });
			}, 0);
		};

		const beginPan = (e: PointerEvent) => {
			e.preventDefault();
			e.stopPropagation();
			stopSettle();
			const origin = { x: e.clientX, y: e.clientY, left: el.scrollLeft };
			const target = e.target instanceof Element ? e.target : null;
			const body = target?.closest<HTMLElement>(COLUMN_BODY) ?? null;
			const top = body?.scrollTop ?? 0;
			let moved = false;
			panning.value = true;

			const move = (ev: PointerEvent) => {
				const dx = ev.clientX - origin.x;
				const dy = ev.clientY - origin.y;
				if (!moved && Math.hypot(dx, dy) < PAN_THRESHOLD_PX) return;
				moved = true;
				el.scrollLeft = origin.left - dx;
				if (body) body.scrollTop = top - dy;
			};
			const detach = () => {
				panning.value = false;
				endPan = null;
				globalThis.removeEventListener("pointermove", move);
				globalThis.removeEventListener("pointerup", up);
				globalThis.removeEventListener("pointercancel", cancel);
				globalThis.removeEventListener("blur", cancel);
			};
			const up = () => {
				detach();
				if (moved) swallowNextClick();
				scheduleSettle(0);
			};
			const cancel = () => {
				detach();
				scheduleSettle(0);
			};
			endPan = detach;
			globalThis.addEventListener("pointermove", move);
			globalThis.addEventListener("pointerup", up);
			globalThis.addEventListener("pointercancel", cancel);
			globalThis.addEventListener("blur", cancel);
		};

		const onPointerDown = (e: PointerEvent) => {
			const modLeft = e.button === 0 && (e.ctrlKey || e.metaKey);
			if (e.pointerType !== "touch" && modLeft) {
				beginPan(e);
				return;
			}
			stopSettle();
			if (e.pointerType !== "touch") {
				held = true;
				scrolledWhileHeld = false;
			}
		};
		const onPointerUp = (e: PointerEvent) => {
			if (e.pointerType === "touch" || !held) return;
			held = false;
			if (scrolledWhileHeld) scheduleSettle(SNAP_IDLE_MS);
		};
		const onMouseDown = (e: MouseEvent) => {
			if (e.button === 0 && (e.ctrlKey || e.metaKey)) e.preventDefault();
		};
		// #endregion

		// #region Touch + native scroll
		const onTouchStart = () => {
			held = true;
			scrolledWhileHeld = false;
			stopSettle();
		};
		const onTouchEnd = () => {
			held = false;
			if (scrolledWhileHeld) scheduleSettle(SNAP_IDLE_MS);
		};
		const onScroll = () => {
			const travelled = el.scrollLeft - prevLeft;
			prevLeft = el.scrollLeft;
			if (settling) {
				if (Math.abs(el.scrollLeft - lastWritten) <= 1) return;
				spring.stop();
				settling = false;
			}
			if (Math.abs(travelled) >= 0.5) direction = travelled > 0 ? 1 : -1;
			if (held) scrolledWhileHeld = true;
			if (held || endPan || live.current.isDragging()) return;
			scheduleSettle(SNAP_IDLE_MS);
		};
		// #endregion

		// #region Edge auto-scroll
		const drag = live.current.drag;
		let frame = 0;
		let lastFrame = 0;
		let carry = 0;

		const step = (now: number) => {
			frame = 0;
			const active = drag?.active.peek();
			if (!drag || !active || active.sensor !== "pointer") return;
			const dt = lastFrame ? Math.min(50, now - lastFrame) : 16;
			lastFrame = now;
			const p = drag.pointer.peek();
			const box = el.getBoundingClientRect();
			const v = p.y >= box.top && p.y <= box.bottom
				? edgeScrollVelocity(p.x, box.left, box.right)
				: 0;
			if (v === 0) carry = 0;
			else {
				carry += (v * dt) / 1000;
				const whole = Math.trunc(carry);
				if (whole !== 0) {
					carry -= whole;
					const before = el.scrollLeft;
					el.scrollLeft = before + whole;
					if (el.scrollLeft !== before) drag.resample();
				}
			}
			frame = requestAnimationFrame(step);
		};

		const stopAutoScroll = drag
			? effect(() => {
				const active = drag.active.value;
				if (active?.sensor === "pointer") {
					stopSettle();
					if (!frame) {
						lastFrame = 0;
						carry = 0;
						frame = requestAnimationFrame(step);
					}
				} else if (frame) {
					cancelAnimationFrame(frame);
					frame = 0;
				}
			})
			: () => {};
		// #endregion

		el.addEventListener("wheel", onWheel, { passive: false });
		el.addEventListener("pointerdown", onPointerDown, { capture: true });
		el.addEventListener("mousedown", onMouseDown, { capture: true });
		el.addEventListener("touchstart", onTouchStart, { passive: true });
		el.addEventListener("touchend", onTouchEnd, { passive: true });
		el.addEventListener("touchcancel", onTouchEnd, { passive: true });
		el.addEventListener("scroll", onScroll, { passive: true });
		globalThis.addEventListener("pointerup", onPointerUp);

		return () => {
			el.removeEventListener("wheel", onWheel);
			el.removeEventListener("pointerdown", onPointerDown, { capture: true });
			el.removeEventListener("mousedown", onMouseDown, { capture: true });
			el.removeEventListener("touchstart", onTouchStart);
			el.removeEventListener("touchend", onTouchEnd);
			el.removeEventListener("touchcancel", onTouchEnd);
			el.removeEventListener("scroll", onScroll);
			globalThis.removeEventListener("pointerup", onPointerUp);
			endPan?.();
			if (timer !== undefined) clearTimeout(timer);
			stopAutoScroll();
			if (frame) cancelAnimationFrame(frame);
			stopWrite();
			spring.dispose();
		};
	}, []);

	return { panning };
}
