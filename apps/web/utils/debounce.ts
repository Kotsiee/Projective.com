/**
 * debounce — a trailing-edge debounce with an injectable clock.
 *
 * Several surfaces wait out a burst of keystrokes before asking the server something (a handle
 * probe, a typeahead, a search). Each used to own a private `setTimeout`/`clearTimeout` pair inside
 * an island body, which is exactly where a timer is hardest to test and easiest to leak. This is the
 * one shared shape: call it as often as you like, and the function runs once, with the LAST call's
 * arguments, `waitMs` after the calls stop.
 *
 * The clock is a parameter so a test can drive time by hand ({@link DebounceClock}); the app passes
 * nothing and gets the global timers.
 */

// #region Types
/** The two timer primitives a debounce needs — the globals by default, a fake in a test. */
export interface DebounceClock {
	setTimeout(run: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

/** A debounced function: call it freely; it runs once, `waitMs` after the last call. */
export interface Debounced<A extends unknown[]> {
	(...args: A): void;
	/** Drop the pending call, if any. */
	cancel(): void;
	/** Run the pending call now instead of waiting; a no-op when nothing is pending. */
	flush(): void;
	/** Whether a call is waiting to run. */
	readonly pending: boolean;
}
// #endregion

// #region Implementation
/** The global timers, wrapped so the handle type stays opaque. */
const GLOBAL_CLOCK: DebounceClock = {
	setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
};

/**
 * Debounce `fn` on the trailing edge.
 *
 * @param fn The function to run once the calls settle; it receives the last call's arguments.
 * @param waitMs The quiet period after the last call, in ms.
 * @param clock The timers to use — omit for the globals.
 */
export function debounce<A extends unknown[]>(
	fn: (...args: A) => void,
	waitMs: number,
	clock: DebounceClock = GLOBAL_CLOCK,
): Debounced<A> {
	let handle: unknown = null;
	let lastArgs: A | null = null;

	const fire = () => {
		const args = lastArgs;
		handle = null;
		lastArgs = null;
		if (args) fn(...args);
	};

	const debounced = ((...args: A) => {
		if (handle !== null) clock.clearTimeout(handle);
		lastArgs = args;
		handle = clock.setTimeout(fire, waitMs);
	}) as Debounced<A>;

	debounced.cancel = () => {
		if (handle !== null) clock.clearTimeout(handle);
		handle = null;
		lastArgs = null;
	};

	debounced.flush = () => {
		if (handle === null) return;
		clock.clearTimeout(handle);
		fire();
	};

	Object.defineProperty(debounced, "pending", { get: () => handle !== null });
	return debounced;
}
// #endregion
