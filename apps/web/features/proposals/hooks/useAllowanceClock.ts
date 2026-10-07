import { useEffect } from "preact/hooks";
import { allowanceClock, retainAllowanceClock } from "../core/allowance-state.ts";

/**
 * The shared 1-second clock for a countdown, ticking only while a component that shows one is
 * mounted (and `active`). Returns the current instant; reading it subscribes the caller to each tick.
 *
 * A timer is an external effect, which is what `useEffect` is for here (root CLAUDE.md §3): the clock
 * itself is a signal, and the effect only retains and releases the one shared interval.
 */
export function useAllowanceClock(active = true): number {
	useEffect(() => (active ? retainAllowanceClock() : undefined), [active]);
	return allowanceClock.value;
}
