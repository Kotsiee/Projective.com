/**
 * `useControllable` — the signal-first value contract for every field control.
 *
 * A control's `value` prop is a {@link Bindable}: either a raw `T` (uncontrolled — we own an internal
 * signal seeded from it) or a `Signal<T>` (controlled — we read/write the caller's signal directly,
 * so their state and ours never diverge). Callers may additionally pass `onValueChange` to observe
 * writes regardless of mode.
 *
 * Returns a `Signal<T>` to read/write plus a `set(next)` helper that writes the signal and fires the
 * callback. Reading `.value` in JSX subscribes the component, per signal-first (§C.2). A read-only
 * binding (a `computed`) is never assigned: `set` only fires the callback, and the owner moves the
 * source the binding derives from.
 */
import { Signal, signal } from "@preact/signals";
import { useMemo } from "preact/hooks";
import type { Bindable, ValueChange } from "../types/mod.ts";
import { isWritableSignal } from "../core/signal-binding.ts";

export interface Controllable<T> {
	/** The live signal — read `.value` in render to subscribe. */
	readonly signal: Signal<T>;
	/** Current value (non-subscribing convenience). */
	get: () => T;
	/** Write the value and notify `onValueChange`. */
	set: (next: T) => void;
}

/**
 * @param value Raw value or a `Signal<T>`.
 * @param fallback Default used when `value` is `undefined` and no signal was supplied.
 * @param onValueChange Optional observer fired on every `set`.
 */
export function useControllable<T>(
	value: Bindable<T> | undefined,
	fallback: T,
	onValueChange?: ValueChange<T>,
): Controllable<T> {
	// A controlled signal is used verbatim; otherwise we mint one internal signal for this instance.
	const controlled = value instanceof Signal ? (value as Signal<T>) : undefined;
	const internal = useMemo(
		() => signal<T>(controlled ? controlled.peek() : ((value as T) ?? fallback)),
		[],
	);
	const sig = controlled ?? internal;
	const writable = useMemo(() => isWritableSignal(sig), [sig]);

	return useMemo<Controllable<T>>(() => ({
		signal: sig,
		get: () => sig.peek(),
		set: (next: T) => {
			if (writable) sig.value = next;
			onValueChange?.(next);
		},
	}), [sig, writable, onValueChange]);
}
