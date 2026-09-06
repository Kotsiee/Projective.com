/**
 * `useHoldRepeat` — press-and-hold that ramps into a repeat, for stepper-shaped controls.
 *
 * A short press fires exactly once. Holding past {@link HoldRepeatOptions.delayMs} starts repeating
 * on an interval until the pointer is released, and the ramp stops the moment the action stops
 * achieving anything (a stepper at its bound), so a held button at `max` is not still running a
 * timer nobody can see.
 *
 * The release listeners are on `window`, not on the button, and that is the point rather than a
 * convenience: a pointer released outside the element — off the button, off the window, on another
 * monitor — fires no event on the button at all, and an element-only teardown leaves the control
 * counting forever with nothing on screen to say so. The bound button may additionally be REMOVED or
 * `disabled` mid-hold (which is exactly what happens when a ramp reaches its limit), and a disabled
 * element dispatches no pointer events either.
 *
 * `blur` on `window` is in the same list for the same reason: alt-tabbing away mid-hold delivers no
 * pointerup, and background-tab timer clamping means the runaway would be slow rather than absent.
 */
import { useEffect, useMemo, useRef } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";

/** Delay before a held press starts repeating. Long enough that a normal click never ramps. */
const DEFAULT_DELAY_MS = 380;
/** Repeat period once the ramp is running. */
const DEFAULT_INTERVAL_MS = 60;

export interface HoldRepeatOptions {
	/**
	 * The action. Return `false` to stop the ramp — a stepper returns whether the value actually
	 * moved, so hitting a bound ends the repeat instead of spinning against the clamp.
	 *
	 * Receives the pointerdown that STARTED the hold, and receives that same event on every repeat.
	 * A repeat has no event of its own, so any modifier the gesture carries (`ctrlKey` for a
	 * fine-adjustment mode) is fixed at the moment the button went down — which is also the honest
	 * reading, since a key pressed halfway through a hold was not part of the request.
	 */
	onTick: (initiator: PointerEvent) => boolean | void;
	/** Milliseconds held before repeating begins (default `380`). */
	delayMs?: number;
	/** Milliseconds between repeats once running (default `60`). */
	intervalMs?: number;
	/** Ignore presses entirely. */
	disabled?: boolean;
}

export interface HoldRepeat {
	/** Spread onto the control that should hold-to-repeat. */
	handlers: {
		onPointerDown: (event: PointerEvent) => void;
		onPointerUp: () => void;
		onPointerLeave: () => void;
		onPointerCancel: () => void;
	};
	/** Whether a press is currently held — for a `data-` attribute or an active style. */
	holding: Signal<boolean>;
}

export function useHoldRepeat(options: HoldRepeatOptions): HoldRepeat {
	const { delayMs = DEFAULT_DELAY_MS, intervalMs = DEFAULT_INTERVAL_MS } = options;
	const holding = useSignal(false);

	// The latest callback and the latest `disabled`, read through refs so a running interval always
	// calls this render's closure rather than the one captured when the press began.
	const tickRef = useRef(options.onTick);
	tickRef.current = options.onTick;
	const disabledRef = useRef(options.disabled);
	disabledRef.current = options.disabled;

	// `ReturnType<typeof …>` rather than `number`: under Deno's type graph a timer id is an opaque
	// `Timeout`, and the browser's is a number.
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
	// One teardown, held in a ref, so every exit path — release, cancel, bound reached, unmount —
	// runs the same code and cannot forget one of the listeners.
	const stopRef = useRef<() => void>(() => {});

	/**
	 * The identity `addEventListener`/`removeEventListener` actually see — created once and never
	 * again, delegating to whatever `stopRef` currently holds.
	 *
	 * Registering `stopRef.current` directly does NOT work, and fails silently: a press changes the
	 * value, the value change re-renders, the re-render assigns a NEW closure to the ref, and the
	 * `removeEventListener` that then runs is handed a function that was never registered. Measured
	 * before this fix: three hold cycles added three window listeners and removed none.
	 */
	const release = useMemo(() => () => stopRef.current(), []);

	const stop = () => {
		if (timerRef.current !== undefined) clearTimeout(timerRef.current);
		if (intervalRef.current !== undefined) clearInterval(intervalRef.current);
		timerRef.current = undefined;
		intervalRef.current = undefined;
		if (holding.value) holding.value = false;
		globalThis.removeEventListener("pointerup", release);
		globalThis.removeEventListener("pointercancel", release);
		globalThis.removeEventListener("blur", release);
	};
	stopRef.current = stop;

	const start = (event: PointerEvent) => {
		if (disabledRef.current) return;
		// A secondary or middle button should not drive a value, and a context menu that opens over
		// the control would swallow the release.
		if (event.button !== undefined && event.button !== 0) return;

		// The action runs FIRST, before any listener wiring or capture attempt can throw. A press that
		// costs the reader their click because the plumbing failed is worse than a press that does not
		// ramp.
		const moved = tickRef.current(event);
		if (moved === false) return;

		stop();
		holding.value = true;
		globalThis.addEventListener("pointerup", release);
		globalThis.addEventListener("pointercancel", release);
		globalThis.addEventListener("blur", release);

		timerRef.current = setTimeout(() => {
			intervalRef.current = setInterval(() => {
				if (disabledRef.current || tickRef.current(event) === false) stopRef.current();
			}, intervalMs);
		}, delayMs);
	};

	// Unmount is just another exit path. Without this, a control removed while held (a stage deleted
	// mid-press, a modal closed) leaves an interval calling into a dead closure.
	useEffect(() => () => stopRef.current(), []);

	return {
		holding,
		handlers: {
			onPointerDown: start,
			onPointerUp: stop,
			onPointerLeave: stop,
			onPointerCancel: stop,
		},
	};
}
