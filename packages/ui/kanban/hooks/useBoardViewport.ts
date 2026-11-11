import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { effect, type Signal, useSignal } from "@preact/signals";
import { createSpring, SPRING_STANDARD } from "../../core/motion.ts";
import {
	boardWheelDelta,
	PAN_THRESHOLD_PX,
	SNAP_IDLE_MS,
	snapTarget,
	wheelStaysInColumn,
} from "../core/viewport.ts";

const COLUMN = ".ui-kanban__column";
const COLUMN_BODY = ".ui-kanban__col-body";

/** Options for {@link useBoardViewport}. */
export interface BoardViewportOptions {
	/** The horizontal scroller — `.ui-kanban__board`. */
	scrollerRef: RefObject<HTMLElement>;
	/** Whether a card or column drag is in flight; the board never settles under one. */
	isDragging: () => boolean;
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
 * - **Settle** — only after the reader lets go: the wheel idle for {@link SNAP_IDLE_MS}, a pan or
 *   scrollbar released, a touch fling run out. The board springs to the nearest column start on
 *   `SPRING_STANDARD`; under either reduced-motion channel it lands there at once. Any new input
 *   stops a settle in flight, and so does any scroll the settle did not write (an autoscroll, a key).
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
			const target = snapTarget(el.scrollLeft, columnStarts(), min, max);
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
			if (held) scrolledWhileHeld = true;
			if (settling) {
				if (Math.abs(el.scrollLeft - lastWritten) <= 1) return;
				spring.stop();
				settling = false;
			}
			if (held || endPan || live.current.isDragging()) return;
			scheduleSettle(SNAP_IDLE_MS);
		};
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
			stopWrite();
			spring.dispose();
		};
	}, []);

	return { panning };
}
