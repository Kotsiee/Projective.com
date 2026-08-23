/**
 * @projective/ui/calendar — the calendar's own OVERLAY scrollbar engine (a Figma-style depth gauge
 * that a press turns into a joystick lever).
 *
 * Why a bespoke bar rather than the global native-styled one (`styles/index.css`): the calendar's two
 * time axes are effectively INFINITE (a ~4-year elapsed-minute axis in Day, a ~19-year stacked-block
 * axis in Week), so a thumb sized as `viewport / content` is a hair that means nothing and can never be
 * grabbed — and, more decisively, a drag that MAPS POSITION runs out of track almost immediately on an
 * axis that does not end. This bar therefore works two ways at once:
 *
 *  - **At rest it is a depth gauge.** The handle's OFFSET reports how far through the range the reader
 *    is, touching both ends of the track (`core/scene-build.ts` `gaugeGeometry` maps the near edge
 *    across `track − length`). Its LENGTH reports viewport scale against the current PERIOD — a whole
 *    day in view is a long handle, an hour zoomed to fill the viewport a short one (`core/chrome.ts`
 *    `handleLength`, given {@link UseOverlayScrollbarOptions.periodPx}). Without a period it falls back
 *    to the older depth-encoded length, so a consumer that has not been told the period keeps exactly
 *    the behaviour it had.
 *  - **Pressed it is a LEVER.** The pill morphs into a joystick ball anchored where the press landed,
 *    and dragging away from that origin opens a directional throttle: `core/chrome.ts`
 *    `leverScrollDelta` turns the deflection into pixels-per-elapsed-time and a rAF loop applies it for
 *    as long as the pointer is down. Because the deflection is measured from the GRAB, the gesture
 *    never runs out of track — this is the "infinite scroll" half of the design, and it is what
 *    replaced the old absolute mapping plus its bolt-on edge-hold mode. Under a rate-based lever there
 *    is no track edge left to overshoot, so "how far past the end are we" stopped describing the
 *    gesture at all; `core/scene-build.ts` `scrollbarRect` had already reached that conclusion for the
 *    canvas twin, and this is the DOM bar catching up to it.
 *  - **Frozen while grabbed.** The length is frozen on pointer-down and stays frozen until the pointer
 *    has BOTH released and left the handle, so the ball's box does not resize under a stationary cursor
 *    while the handle's offset travels beneath it.
 *
 * THE POINTER SAYS WHERE, THE CLOCK SAYS HOW FAR. Nothing scrolls in the `pointermove` handler; it only
 * records where the lever is pointing. Scrolling there instead would make the speed depend on how often
 * the OS happens to coalesce pointer events, so the same gesture would travel further on a 1000 Hz
 * mouse than on a trackpad.
 *
 * CORRECTNESS RULE (not a testing convenience): every value the reader must trust — the handle's
 * position and length — is written directly from a measurement, never interpolated by an animation.
 * `requestAnimationFrame`, CSS transitions and CSS animations are all frozen in a hidden/background
 * tab, so anything that depended on a frame would report a stale or zero geometry. The one animated
 * quantity here, the pill-to-ball `morph`, is a RESOLVED number driven by `packages/ui/core/motion.ts`'s
 * spring — which carries the mandatory synchronous jump-to-final path — and it is consumed as a
 * `transform`/`opacity` factor only.
 */
import { batch, type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import type { RefObject } from "preact";
import { GAUGE_MIN, gaugeGeometry } from "../core/scene-build.ts";
import { handleLength, leverScrollDelta, leverThrowPx } from "../core/chrome.ts";
import { createSpring, SPRING_SNAPPY } from "../../core/motion.ts";

// #region Constants
/** How long the bar stays revealed after the last scroll (ms). */
const DEFAULT_IDLE_MS = 900;
/** A `deltaMode: line` wheel notch, in px — the conventional line box for forwarded wheel deltas. */
const WHEEL_LINE_PX = 16;

/** Whether a pointer's client coordinates fall inside an element's box. */
function pointerIsInside(e: PointerEvent, el: Element | null): boolean {
	if (!el) return false;
	const r = el.getBoundingClientRect();
	return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

/**
 * Pointer capture is a convenience, never a precondition. `setPointerCapture` throws `NotFoundError`
 * for a pointer id the engine no longer tracks — a pointer that was already released, or a synthetic
 * event stream — and an unguarded call would abort the handler BEFORE the drag it was about to start.
 *
 * For the guard to mean anything the drag has to survive the failure, which is why the move/up
 * listeners are bound on `globalThis` for the drag's duration rather than on the handle: a handle-
 * bound listener only sees a pointer that is still OVER the handle, and a drag is precisely the
 * gesture that takes the pointer away from it. Capture merely spares the intermediate elements their
 * own boundary events.
 */
function tryCapture(el: HTMLElement | null, pointerId: number, release = false): void {
	try {
		if (release) el?.releasePointerCapture?.(pointerId);
		else el?.setPointerCapture?.(pointerId);
	} catch {
		/* the engine is not tracking this pointer — the drag proceeds uncaptured */
	}
}
// #endregion

// #region Types
export interface UseOverlayScrollbarOptions {
	/** The natively-scrolling container the bar mirrors and drives. */
	scrollRef: RefObject<HTMLElement>;
	/** The overlay track element — its measured length is the handle's travel range. */
	trackRef: RefObject<HTMLElement>;
	/**
	 * Read inside a signal effect: touch any signal whose change should re-measure the bar (a zoom that
	 * resizes the content, or a PROGRAMMATIC scroll whose `scroll` event a background tab defers).
	 */
	revalidate?: () => unknown;
	/**
	 * One PERIOD's height in content pixels — a day (`pxPerHour * 24`) on the Day timeline, a week on
	 * the Week grid — which is what makes the handle's length a live reflection of viewport scale.
	 *
	 * Optional, and the fallback is deliberate rather than defensive: a consumer that has not been told
	 * its period cannot be given a truthful scale, so it keeps the depth-encoded length it already had
	 * instead of being handed a number derived from an axis nineteen years long.
	 */
	periodPx?: number;
	/** Idle delay before the bar fades out (default {@link DEFAULT_IDLE_MS}). */
	idleMs?: number;
}

export interface OverlayScrollbarApi {
	/** Whether the container actually overflows — no overflow, no handle. */
	needed: Signal<boolean>;
	/** Whether the bar is currently revealed (drives an opacity-only transition). */
	visible: Signal<boolean>;
	/** Whether the handle is being dragged. */
	dragging: Signal<boolean>;
	/** Handle offset (px) from the track's leading edge. */
	offset: Signal<number>;
	/** Handle length (px) — viewport scale against the period, frozen while grabbed. */
	length: Signal<number>;
	/**
	 * 0..1 through the pill-to-ball morph — a RESOLVED spring value, written to CSS as a bare number
	 * and consumed as a `transform`/`opacity` factor. Never a CSS transition: a frozen animation clock
	 * must not be able to strand the handle between two shapes.
	 */
	morph: Signal<number>;
	/**
	 * The ball's drawn offset (px, signed) from the handle's centre — the joystick stick's throw. Purely
	 * decorative, but resolved on the pointer event rather than animated, so it can never point the
	 * wrong way.
	 */
	throwPx: Signal<number>;
	/** Re-read the container and rewrite the handle geometry. Safe to call from any event. */
	measure: () => void;
	/** Reveal the bar and re-arm the idle fade. */
	reveal: () => void;
	/**
	 * Start a lever drag. Move/up are then tracked on `globalThis` until release, so the gesture does
	 * not depend on the pointer staying over the handle (or on pointer capture having succeeded).
	 */
	onHandlePointerDown: (e: PointerEvent) => void;
	onHandlePointerEnter: () => void;
	onHandlePointerLeave: () => void;
}
// #endregion

/**
 * Instrument a natively-scrolling container with the overlay lever gauge. The container keeps every
 * native behaviour — wheel, touch, keyboard, and the middle-click gesture its own owner binds — because
 * nothing here calls `preventDefault` on anything but the handle drag itself.
 */
export function useOverlayScrollbar(opts: UseOverlayScrollbarOptions): OverlayScrollbarApi {
	const { scrollRef, trackRef, idleMs = DEFAULT_IDLE_MS } = opts;

	const needed = useSignal(false);
	const visible = useSignal(false);
	const dragging = useSignal(false);
	const offset = useSignal(0);
	const length = useSignal(GAUGE_MIN);
	const throwPx = useSignal(0);

	/**
	 * The pill-to-ball morph. `SPRING_SNAPPY` because this is a direct answer to a press and anything
	 * slower reads as the control hesitating; over-damped, so it settles into the ball without ringing.
	 * `createSpring` writes synchronously whenever `prefersJumpToFinal()` holds — a hidden tab or the
	 * reduced-motion preference — so the shape is never left half way by a clock that has stopped.
	 */
	const morphSpring = useMemo(() => createSpring(0, { config: SPRING_SNAPPY }), []);

	/** The frozen handle length, or null when the gauge is free to follow the viewport. */
	const frozen = useRef<number | null>(null);
	/** Set on release-over-handle: the freeze outlives pointerup until the pointer exits. */
	const holdUntilExit = useRef(false);
	const hovering = useRef(false);
	/** The pointer that owns the live drag, or `-1`. */
	const grabId = useRef(-1);
	/**
	 * The live lever: where the press landed and where the pointer is now. A ref rather than a signal
	 * because the rAF loop reads it every frame and nothing renders from it — the two values that DO
	 * render ({@link throwPx} and the scroll geometry) are written from it explicitly.
	 */
	const lever = useRef<{ grabY: number; pointerY: number } | null>(null);
	/** The in-flight lever animation frame, or `null` when no drag is running. */
	const leverRaf = useRef<number | null>(null);
	/** rAF's own timestamp origin for the current lever run, or `-1` before its first tick. */
	const leverLast = useRef(-1);
	/** `ReturnType<typeof setTimeout>` rather than `number`: Deno types the timer as a `Timeout`. */
	const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	/**
	 * Teardown for an in-flight drag. The drag's listeners live on `globalThis`, not on the handle, so
	 * unmounting mid-drag does not take them with it — this is what does.
	 */
	const endDrag = useRef<(() => void) | null>(null);
	/**
	 * The latest `periodPx`, kept in a ref because {@link measure} is a stable callback bound once and
	 * called from listeners that outlive any single render.
	 */
	const periodPx = useRef<number | undefined>(opts.periodPx);
	periodPx.current = opts.periodPx;

	// #region Geometry
	const measure = useCallback(() => {
		const el = scrollRef.current;
		const track = trackRef.current;
		if (!el || !track) return;
		const span = el.scrollHeight - el.clientHeight;
		const trackLen = track.clientHeight;
		if (span <= 1 || trackLen <= 0) {
			if (needed.value) needed.value = false;
			return;
		}
		// Viewport scale against the PERIOD the reader is reading, not against the whole nineteen-year
		// axis — see `core/chrome.ts` `handleLength` for why the denominator is the entire argument.
		const period = periodPx.current;
		const scaled = period !== undefined && period > 0
			? handleLength(trackLen, el.clientHeight / period)
			: null;
		// `gaugeGeometry`'s third argument means "use this length rather than deriving one from depth",
		// which is exactly what a frozen grab needs AND exactly what a period-relative length needs.
		// Routing both through it keeps ONE function computing the offset across `track − length`, so
		// the two length sources cannot disagree about where the handle then sits. The formula lives in
		// `core/scene-build.ts` because the pure-canvas Week viewport draws the same bar with no element
		// to hang a hook on, and two implementations of "how long is the handle" is two bars answering
		// the same depth differently.
		const gauge = gaugeGeometry(el.scrollTop / span, trackLen, frozen.current ?? scaled);
		batch(() => {
			needed.value = true;
			length.value = gauge.length;
			offset.value = gauge.offset;
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	// #endregion

	// #region Lever (rate-based continuous scroll)
	const stopLever = useCallback(() => {
		if (leverRaf.current != null) {
			globalThis.cancelAnimationFrame?.(leverRaf.current);
			leverRaf.current = null;
		}
		leverLast.current = -1;
		lever.current = null;
		if (throwPx.peek() !== 0) throwPx.value = 0;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/**
	 * The throttle loop: scroll by `leverScrollDelta(deflection, dt)` every frame for as long as the
	 * lever is held. `dt` is the real elapsed time (capped inside `leverScrollDelta`), so the rate is
	 * the same on a 60 Hz and a 120 Hz display and a resumed background tab cannot integrate a stale
	 * throttle across its whole absence in one jump.
	 */
	const tickLever = useCallback((now: number) => {
		leverRaf.current = null;
		const state = lever.current;
		const el = scrollRef.current;
		if (!state || !el) {
			leverLast.current = -1;
			return;
		}
		// The first callback of a run only ESTABLISHES the clock: it has no previous timestamp, and a
		// loop that read its own start as an elapsed time would open the throttle with a garbage delta
		// on its opening frame. `createSpring` seeds its clock the same way and for the same reason.
		if (leverLast.current < 0) {
			leverLast.current = now;
			leverRaf.current = globalThis.requestAnimationFrame?.(tickLever) ?? null;
			return;
		}
		const dt = now - leverLast.current;
		leverLast.current = now;
		const delta = leverScrollDelta(state.pointerY - state.grabY, dt);
		if (delta !== 0) el.scrollTop += delta;
		// Written from the container we just moved rather than waiting for its async `scroll` event — a
		// frameless document never dispatches one and the handle would stall.
		measure();
		leverRaf.current = globalThis.requestAnimationFrame?.(tickLever) ?? null;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [measure]);

	/**
	 * Where a rAF loop is genuinely absent (SSR, a frameless harness) the lever simply does not scroll,
	 * which is the honest outcome: a throttle is a rate, and without a clock there is no elapsed time
	 * to apply it over. The container's native wheel/keyboard scrolling is untouched either way.
	 */
	const startLever = useCallback(() => {
		if (leverRaf.current != null) return;
		leverLast.current = -1;
		leverRaf.current = globalThis.requestAnimationFrame?.(tickLever) ?? null;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tickLever]);
	// #endregion

	// #region Reveal / idle fade
	const scheduleHide = useCallback(() => {
		clearTimeout(idleTimer.current);
		idleTimer.current = setTimeout(() => {
			// A drag or a hover outlives the idle window: the bar must not fade out from under the cursor
			// that is holding it.
			if (dragging.peek() || hovering.current) return;
			visible.value = false;
		}, idleMs);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [idleMs]);

	const reveal = useCallback(() => {
		visible.value = true;
		scheduleHide();
	}, [scheduleHide]);
	// #endregion

	// #region Freeze lifecycle
	/**
	 * The freeze is released only when BOTH conditions hold: the button is up AND the pointer is off the
	 * handle. Releasing over the handle would otherwise resize it under a stationary cursor, which reads
	 * as the control moving on its own.
	 */
	const releaseFreeze = useCallback(() => {
		if (dragging.peek() || holdUntilExit.current) return;
		if (frozen.current == null) return;
		frozen.current = null;
		measure();
	}, [measure]);
	// #endregion

	// #region Drag
	const onHandlePointerDown = useCallback((e: PointerEvent) => {
		// Primary button only, and never with Ctrl/Meta: the container's own pan gesture owns those, and
		// a modifier-gated drag-and-drop is reserved on this surface (see the calendar's gesture map).
		if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
		const el = scrollRef.current;
		const track = trackRef.current;
		if (!el || !track) return;
		e.preventDefault();
		e.stopPropagation();
		const handle = e.currentTarget as HTMLElement | null;
		tryCapture(handle, e.pointerId);
		frozen.current = length.value;
		holdUntilExit.current = false;
		dragging.value = true;
		grabId.current = e.pointerId;
		// The origin the whole gesture is measured from. Every later reading is a deflection from HERE,
		// which is what lets the drag outlast the track.
		lever.current = { grabY: e.clientY, pointerY: e.clientY };
		throwPx.value = 0;
		morphSpring.set(1);
		reveal();
		startLever();

		const move = (ev: PointerEvent) => {
			if (ev.pointerId !== grabId.current || !dragging.peek()) return;
			const state = lever.current;
			if (!state) return;
			// The pointer's only job is to say where the lever is pointing; the loop above says how far
			// that has carried us. Scrolling here instead would tie the speed to how often the OS
			// coalesces pointer events.
			state.pointerY = ev.clientY;
			const next = leverThrowPx(ev.clientY - state.grabY);
			if (next !== throwPx.peek()) throwPx.value = next;
			reveal();
		};
		const detach = () => {
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", up);
			globalThis.removeEventListener("pointercancel", up);
			endDrag.current = null;
		};
		const up = (ev: PointerEvent) => {
			if (ev.pointerId !== grabId.current) return;
			detach();
			stopLever();
			// Unconditional, and before the `dragging` guard: the ball must collapse even on a release
			// path that finds the drag already ended, or the handle keeps a shape it is no longer in.
			morphSpring.set(0);
			grabId.current = -1;
			if (!dragging.peek()) return;
			tryCapture(handle, ev.pointerId, true);
			dragging.value = false;
			// Pointer capture suppresses boundary events for the duration of the drag, so containment is
			// decided from the release coordinates rather than from a `pointerleave` that may never
			// arrive. The freeze then outlives the release until the pointer actually leaves the handle.
			const stillOn = pointerIsInside(ev, handle);
			hovering.current = stillOn;
			holdUntilExit.current = stillOn;
			if (!stillOn) releaseFreeze();
			scheduleHide();
		};
		endDrag.current = detach;
		globalThis.addEventListener("pointermove", move);
		globalThis.addEventListener("pointerup", up);
		globalThis.addEventListener("pointercancel", up);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [morphSpring, releaseFreeze, reveal, scheduleHide, startLever, stopLever]);

	const onHandlePointerEnter = useCallback(() => {
		hovering.current = true;
		reveal();
	}, [reveal]);

	const onHandlePointerLeave = useCallback(() => {
		hovering.current = false;
		holdUntilExit.current = false;
		releaseFreeze();
		scheduleHide();
	}, [releaseFreeze, scheduleHide]);
	// #endregion

	// #region Container wiring
	useEffect(() => {
		const el = scrollRef.current;
		if (!el || typeof window === "undefined") return;
		const onScroll = () => {
			measure();
			reveal();
		};
		measure();
		el.addEventListener("scroll", onScroll, { passive: true });
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;
		ro?.observe(el);
		// The inner sizer's height is what a zoom changes; observing only the container would miss it.
		if (el.firstElementChild) ro?.observe(el.firstElementChild);
		globalThis.addEventListener("resize", measure);
		return () => {
			el.removeEventListener("scroll", onScroll);
			ro?.disconnect();
			globalThis.removeEventListener("resize", measure);
			clearTimeout(idleTimer.current);
			endDrag.current?.();
			if (leverRaf.current != null) globalThis.cancelAnimationFrame?.(leverRaf.current);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [measure, reveal]);

	/** The spring owns a frame handle of its own, and only its owner can release it. */
	useEffect(() => () => morphSpring.dispose(), [morphSpring]);

	/**
	 * A window-level exit guard for the release-over-handle case: the pointer may leave the handle
	 * without the element ever firing `pointerleave` (a synthetic pointer stream, or a handle that moved
	 * out from under a stationary cursor), and the freeze must not outlive the hover.
	 */
	useEffect(() => {
		if (typeof window === "undefined") return;
		const onMove = (e: PointerEvent) => {
			if (!holdUntilExit.current || dragging.peek()) return;
			const handle = trackRef.current?.firstElementChild ?? null;
			if (pointerIsInside(e, handle)) return;
			hovering.current = false;
			holdUntilExit.current = false;
			releaseFreeze();
			scheduleHide();
		};
		globalThis.addEventListener("pointermove", onMove);
		globalThis.addEventListener("pointercancel", onMove);
		return () => {
			globalThis.removeEventListener("pointermove", onMove);
			globalThis.removeEventListener("pointercancel", onMove);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [releaseFreeze, scheduleHide]);

	// Re-measure whenever the consumer's own scroll/zoom signals move (a programmatic scroll the
	// container performed itself, whose `scroll` event a hidden tab defers indefinitely).
	useSignalEffect(() => {
		opts.revalidate?.();
		measure();
		if (!dragging.peek()) reveal();
	});
	// #endregion

	return {
		needed,
		visible,
		dragging,
		offset,
		length,
		morph: morphSpring.value,
		throwPx,
		measure,
		reveal,
		onHandlePointerDown,
		onHandlePointerEnter,
		onHandlePointerLeave,
	};
}

/**
 * Forward a wheel event that landed on the overlay bar to the container underneath, so wheel scrolling
 * stays standard even over the handle. Without this the handle's own (empty) scroll ancestry would
 * chain the gesture to the page. Ctrl/Meta wheels are left alone — those are the zoom continuum's.
 */
export function forwardWheel(el: HTMLElement, e: WheelEvent): void {
	if (e.ctrlKey || e.metaKey) return;
	e.preventDefault();
	const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? el.clientHeight : 1;
	el.scrollTop += e.deltaY * unit;
}
