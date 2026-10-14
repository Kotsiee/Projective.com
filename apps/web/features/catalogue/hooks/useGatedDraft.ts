import { type Signal, useSignal } from "@preact/signals";

/** A locally edited value that reaches the listing draft only while it would save. */
export interface GatedDraft<T, P> {
	/** What the seller is editing, including rows they are half-way through. */
	value: Signal<T>;
	/** Why {@link value} is not saved yet, or `null` when it was handed on. */
	problem: Signal<P | null>;
	/** Take an edit: keep it locally, and hand it on when it has no problem. */
	set(next: T): void;
}

/**
 * Edit `seed` locally and hand each edit to `commit` only when `check` finds no problem. An empty
 * name or an unanswerable question stays on the page with its reason instead of sending a save the
 * route would refuse, and the last valid value stays in the draft meanwhile. Seeded once: the Edit
 * canvas re-mounts its sections when the draft is replaced wholesale.
 */
export function useGatedDraft<T, P>(
	seed: T,
	check: (value: T) => P | null,
	commit: (value: T) => void,
): GatedDraft<T, P> {
	const value = useSignal<T>(seed);
	const problem = useSignal<P | null>(check(seed));
	return {
		value,
		problem,
		set(next: T) {
			value.value = next;
			const found = check(next);
			problem.value = found;
			if (found === null) commit(next);
		},
	};
}
