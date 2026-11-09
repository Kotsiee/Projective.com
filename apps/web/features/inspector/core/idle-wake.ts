import { type ReadonlySignal, signal } from "@preact/signals";

/**
 * idle-wake — when the canvas's floating toolbar shows. It wakes on any sign of a hand on the canvas
 * and sleeps once {@link TOOLBAR_IDLE_MS} pass without one, unless something is holding it up (the
 * pointer resting on it, focus inside it, a menu it opened). Pure: the clock is injected, so the
 * timing is testable without a DOM.
 */

// #region Contract
/** How long the canvas's toolbar stays after the pointer stops, ms. */
export const TOOLBAR_IDLE_MS = 1800;

/** The timer an {@link IdleWake} runs on; `setTimeout` in the browser. */
export interface IdleClock {
	set(run: () => void, ms: number): number;
	clear(handle: number): void;
}

/** Options for {@link createIdleWake}. */
export interface IdleWakeOptions {
	/** Idle time before sleeping, ms. Default {@link TOOLBAR_IDLE_MS}. */
	ms?: number;
	/** Asked when the time is up: `true` keeps the toolbar awake for another period. */
	hold?: () => boolean;
	clock?: IdleClock;
}

/** One toolbar's wake state. */
export interface IdleWake {
	readonly awake: ReadonlySignal<boolean>;
	/** A sign of activity: show now, and start the idle period again. */
	wake(): void;
	/** Stop the timer for good. */
	dispose(): void;
}
// #endregion

const BROWSER_CLOCK: IdleClock = {
	set: (run, ms) => Number(setTimeout(run, ms)),
	clear: (handle) => clearTimeout(handle),
};

/** Create the wake state for one toolbar. It starts awake, so a canvas opens with its tools in view. */
export function createIdleWake(options: IdleWakeOptions = {}): IdleWake {
	const ms = options.ms ?? TOOLBAR_IDLE_MS;
	const clock = options.clock ?? BROWSER_CLOCK;
	const awake = signal(true);
	let timer: number | null = null;
	let disposed = false;

	function arm(): void {
		if (timer !== null) clock.clear(timer);
		timer = clock.set(expire, ms);
	}

	function expire(): void {
		timer = null;
		if (disposed) return;
		if (options.hold?.()) {
			arm();
			return;
		}
		awake.value = false;
	}

	arm();
	return {
		awake,
		wake(): void {
			if (disposed) return;
			awake.value = true;
			arm();
		},
		dispose(): void {
			disposed = true;
			if (timer !== null) clock.clear(timer);
			timer = null;
		},
	};
}
