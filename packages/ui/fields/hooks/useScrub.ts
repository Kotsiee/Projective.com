/**
 * `useScrub` — drag-a-handle-to-change-a-number, the gesture design tools use for numeric fields.
 *
 * Reports signed pointer travel along one axis together with the interval it took, and nothing else.
 * The hook deliberately knows no arithmetic: what a pixel is worth is `scrubDelta` in
 * `core/number-field.ts`, which is pure and therefore testable, while everything here is event
 * plumbing that only a real pointer can exercise.
 *
 * ## Pointer Lock, and what happens without it
 *
 * With the lock the OS cursor is hidden and `movementX`/`movementY` keep arriving no matter how far
 * the gesture travels, so the drag is genuinely unbounded — the reader can keep pulling right past
 * the edge of the screen and the value keeps climbing. The lock is requested but never depended on:
 * it needs a user gesture, it can be refused outright, and a browser will reject one attempted too
 * soon after an Escape released the last one.
 *
 * The fallback tracks `clientX`/`clientY` deltas on `window`. Because a mouse with a button held has
 * implicit capture, those coordinates keep arriving after the pointer leaves the element AND after
 * it leaves the window, so the usable range is the whole desktop rather than the viewport — but it
 * ends at the physical screen edge, where the OS stops the cursor and no further events are
 * generated. That limit is real and is NOT papered over by continuing to move the value on the last
 * known velocity: a figure that keeps changing while the pointer is stationary is a figure the
 * reader did not ask for, and on this surface those figures are prices.
 *
 * ## Every exit path is the same exit path
 *
 * Release, cancel, Escape (which the browser turns into a lock exit), a window blur from alt-tabbing
 * mid-drag, and unmount all run one teardown. A drag that survives any of those is a control stuck
 * live with nothing on screen to say so, and the pointer that would end it is somewhere else.
 */
import { useEffect, useMemo, useRef } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";

/** Which way the gesture runs. `x` reads rightwards as more; `y` reads upwards as more. */
export type ScrubAxis = "x" | "y";

export interface ScrubOptions {
	/**
	 * One sample of travel: signed pixels along the axis (positive means "increase"), the
	 * milliseconds since the previous sample, and the pointer event that produced them.
	 *
	 * The event is forwarded rather than any digest of it, because the hook has no business deciding
	 * which of its properties matter — a consumer reading `ctrlKey` for a fine-adjustment mode gets
	 * it live, per sample, so the modifier can be pressed and released mid-drag.
	 */
	onMove: (movementPx: number, elapsedMs: number, event: PointerEvent) => void;
	/** Gesture axis (default `x`). */
	axis?: ScrubAxis;
	/** Ignore presses entirely. */
	disabled?: boolean;
	/** Attempt Pointer Lock for unbounded travel (default `true`). */
	pointerLock?: boolean;
	/** Fired once when a drag begins. */
	onStart?: () => void;
	/** Fired once when a drag ends, however it ended. */
	onEnd?: () => void;
}

export interface Scrub {
	/** Spread onto the drag handle. */
	handlers: { onPointerDown: (event: PointerEvent) => void };
	/** Whether a drag is in progress — for a `data-` attribute or a cursor change. */
	active: Signal<boolean>;
}

export function useScrub(options: ScrubOptions): Scrub {
	const { axis = "x", pointerLock = true } = options;
	const active = useSignal(false);

	// Latest props behind refs, so a listener attached at pointerdown calls this render's callbacks.
	const moveRef = useRef(options.onMove);
	moveRef.current = options.onMove;
	const startRef = useRef(options.onStart);
	startRef.current = options.onStart;
	const endRef = useRef(options.onEnd);
	endRef.current = options.onEnd;
	const disabledRef = useRef(options.disabled);
	disabledRef.current = options.disabled;

	const handleRef = useRef<Element | null>(null);
	const lastRef = useRef({ x: 0, y: 0, t: 0 });
	// Whether the lock was ever actually granted for THIS drag. Without it, the single
	// `pointerlockchange` that fires on ACQUISITION is indistinguishable from the one that fires when
	// the reader presses Escape, and the drag would end the instant it succeeded.
	const heldLockRef = useRef(false);
	const stopRef = useRef<() => void>(() => {});
	const moveHandlerRef = useRef<(event: PointerEvent) => void>(() => {});
	const lockChangeRef = useRef<() => void>(() => {});

	/**
	 * The identities the event target actually sees. Created once and never again, each delegating to
	 * whatever its ref currently holds.
	 *
	 * A scrub re-renders its host on every sample, so registering `someRef.current` directly would
	 * hand `removeEventListener` a closure minted after the one that was registered — the removal is
	 * a silent no-op and the listener outlives the gesture. That failure was measured on the sibling
	 * `useHoldRepeat` before both were fixed: three press cycles, three listeners added, none removed.
	 */
	const onMoveStable = useMemo(() => (event: PointerEvent) => moveHandlerRef.current(event), []);
	const onStopStable = useMemo(() => () => stopRef.current(), []);
	const onLockChangeStable = useMemo(() => () => lockChangeRef.current(), []);

	const isLocked = (): boolean => {
		const doc = handleRef.current?.ownerDocument;
		return !!doc && doc.pointerLockElement === handleRef.current;
	};

	const stop = () => {
		const doc = handleRef.current?.ownerDocument;
		globalThis.removeEventListener("pointermove", onMoveStable);
		globalThis.removeEventListener("pointerup", onStopStable);
		globalThis.removeEventListener("pointercancel", onStopStable);
		globalThis.removeEventListener("blur", onStopStable);
		doc?.removeEventListener("pointerlockchange", onLockChangeStable);
		if (doc && doc.pointerLockElement === handleRef.current) {
			try {
				doc.exitPointerLock();
			} catch {
				// Already released, or the document went away underneath us. Nothing left to undo.
			}
		}
		heldLockRef.current = false;
		handleRef.current = null;
		if (active.value) {
			active.value = false;
			endRef.current?.();
		}
	};
	stopRef.current = stop;

	const onPointerMove = (event: PointerEvent) => {
		const locked = isLocked();
		// While locked the client coordinates are frozen, so the movement deltas are the only truth;
		// unlocked, they are the reliable measure across devices where `movementX` is scaled by DPR.
		const dx = locked ? (event.movementX ?? 0) : event.clientX - lastRef.current.x;
		const dy = locked ? (event.movementY ?? 0) : event.clientY - lastRef.current.y;
		if (!locked) {
			lastRef.current.x = event.clientX;
			lastRef.current.y = event.clientY;
			// Suppressing the default extends no selection across the page behind the drag. Under the
			// lock there is no selection to extend and no default worth cancelling.
			event.preventDefault();
		}
		const now = event.timeStamp || Date.now();
		const elapsed = now - lastRef.current.t;
		lastRef.current.t = now;
		// Screen Y grows downward; a number line does not. Up is more.
		moveRef.current(axis === "x" ? dx : -dy, elapsed, event);
	};
	moveHandlerRef.current = onPointerMove;

	const onLockChange = () => {
		if (isLocked()) {
			heldLockRef.current = true;
			return;
		}
		// Lost a lock we actually held: Escape, or the document taking it back. Escape reading as
		// "cancel this drag" is the behaviour the reader already expects from the key.
		if (heldLockRef.current) stopRef.current();
	};
	lockChangeRef.current = onLockChange;

	const start = (event: PointerEvent) => {
		if (disabledRef.current) return;
		if (event.button !== undefined && event.button !== 0) return;
		const handle = event.currentTarget as Element | null;
		if (!handle) return;

		// Stops the browser starting a text selection or a native image drag from the press. Done
		// before anything that can throw, because it is the part the reader sees if it is missed.
		event.preventDefault();

		stopRef.current();
		handleRef.current = handle;
		lastRef.current = { x: event.clientX, y: event.clientY, t: event.timeStamp || Date.now() };
		heldLockRef.current = false;
		active.value = true;

		// The fallback is armed FIRST and unconditionally. If the lock is granted these listeners
		// switch to reading movement deltas; if it is refused — silently, asynchronously, or by
		// throwing — the drag is already working and nothing was lost.
		globalThis.addEventListener("pointermove", onMoveStable);
		globalThis.addEventListener("pointerup", onStopStable);
		globalThis.addEventListener("pointercancel", onStopStable);
		globalThis.addEventListener("blur", onStopStable);
		handle.ownerDocument?.addEventListener("pointerlockchange", onLockChangeStable);
		startRef.current?.();

		if (!pointerLock) return;
		try {
			const request = (handle as Element & {
				requestPointerLock?: () => Promise<void> | undefined;
			}).requestPointerLock?.();
			// Chrome 111+ returns a promise; everything older returns undefined and reports failure via
			// a `pointerlockerror` event. An unhandled rejection here would be a console error on a
			// gesture that is working perfectly well without the lock.
			if (request && typeof request.then === "function") request.catch(() => {});
		} catch {
			// Refused outright — no user activation, or a re-lock attempted too soon after an Escape.
		}
	};

	useEffect(() => () => stopRef.current(), []);

	return { active, handlers: { onPointerDown: start } };
}
