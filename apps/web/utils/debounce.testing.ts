import type { DebounceClock } from "./debounce.ts";

/** A {@link DebounceClock} a test drives by hand, plus the time it has reached. */
export interface FakeClock extends DebounceClock {
	/** Move time forward by `ms`, running every timer that comes due, earliest first. */
	advance(ms: number): void;
	/** The time reached so far, ms since the clock was made. */
	readonly now: number;
}

/**
 * A hand-driven clock for code built on `debounce`: a timer runs only when the test advances time past
 * it, so a test can type, wait and answer in an exact order with no real time passing.
 */
export function fakeClock(): FakeClock {
	let now = 0;
	let nextId = 1;
	const timers = new Map<number, { at: number; run: () => void }>();
	return {
		get now() {
			return now;
		},
		setTimeout(run, ms) {
			const id = nextId++;
			timers.set(id, { at: now + ms, run });
			return id;
		},
		clearTimeout(handle) {
			timers.delete(handle as number);
		},
		advance(ms) {
			now += ms;
			for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
				if (timer.at > now) continue;
				timers.delete(id);
				timer.run();
			}
		},
	};
}
