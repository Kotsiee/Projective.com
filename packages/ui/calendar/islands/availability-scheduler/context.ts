import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { type ReadonlySignal, type Signal, useSignal, useSignalEffect } from "@preact/signals";
import type { KeyCommand } from "./keymap.ts";
import type { SchedulerStore } from "./store.ts";
import type { SchedulerBlackout } from "./types.ts";

// #region Context
/** What every AvailabilityScheduler part reads from its Root. */
export interface SchedulerContextValue {
	store: SchedulerStore;
	timezone: string;
	locale: string;
	weekStartsOn: number;
	today: string;
	blackouts: readonly SchedulerBlackout[];
	/** The viewer owns the schedule, so private blackout labels show. */
	viewerOwns: boolean;
	/** Prefix for element ids, unique per Root. */
	idBase: string;
	/** Run a keyboard command (an action, or opening the shortcut sheet). */
	run(command: KeyCommand): void;
}

/** The Root's context; `null` outside a Root. */
export const SchedulerContext = createContext<SchedulerContextValue | null>(null);

/** The enclosing Root's context. Throws when a part is rendered outside `AvailabilityScheduler.Root`. */
export function useScheduler(): SchedulerContextValue {
	const ctx = useContext(SchedulerContext);
	if (!ctx) {
		throw new Error("AvailabilityScheduler parts must render inside AvailabilityScheduler.Root.");
	}
	return ctx;
}
// #endregion

// #region Option values
/** The option whose value a `SelectButton` emitted, typed back to its union. */
export function pickOption<T extends string>(
	options: readonly { value: T }[],
	emitted: string | string[],
): T | undefined {
	const value = Array.isArray(emitted) ? emitted[0] : emitted;
	return options.find((o) => o.value === value)?.value;
}
// #endregion

// #region Bound signals
/**
 * A writable local signal that follows `map(source)`, for controls whose `value` must be a `Signal`
 * to stay controlled while their writes go through a store action.
 */
export function useBound<T, U>(source: ReadonlySignal<T>, map: (value: T) => U): Signal<U> {
	const local = useSignal(map(source.peek()));
	useSignalEffect(() => {
		local.value = map(source.value);
	});
	return local;
}
// #endregion
