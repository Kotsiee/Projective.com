/**
 * debounced-writes — one pending write per key, merged until the key goes quiet (Decision #441).
 *
 * A colour, a behaviour or a routine is applied to the local copy the moment it is picked; only the
 * last of a quick run of picks reaches the door. Pure apart from the timer, which a test replaces.
 */

/** The timer seam, so a test can drive the clock: run `run` after `ms`, answering how to cancel it. */
export interface DebounceClock {
	after(run: () => void, ms: number): () => void;
}

/** Options for {@link debouncedWrites}. */
export interface DebouncedWritesOptions<T> {
	/** How long a key must stay quiet before its write is sent. */
	ms: number;
	/** Fold a newer change into the one still waiting. */
	merge: (waiting: T, next: T) => T;
	/** Send one key's merged change. */
	send: (key: string, change: T) => void;
	clock?: DebounceClock;
}

/** The pending writes of one kind, keyed by what they change. */
export interface DebouncedWrites<T> {
	/** Merge a change into the write waiting for `key`, and restart its wait. */
	schedule(key: string, change: T): void;
	/** Send the write waiting for `key` now, or every waiting write when no key is named. */
	flush(key?: string): void;
	/** Whether a write is waiting for `key`. */
	pending(key: string): boolean;
}

const REAL_CLOCK: DebounceClock = {
	after(run, ms) {
		const id = setTimeout(run, ms);
		return () => clearTimeout(id);
	},
};

/** Debounce writes per key: a change waits `ms`, merged with any that follow it, then is sent once. */
export function debouncedWrites<T>(opts: DebouncedWritesOptions<T>): DebouncedWrites<T> {
	const clock = opts.clock ?? REAL_CLOCK;
	const waiting = new Map<string, { change: T; cancel: () => void }>();

	function send(key: string): void {
		const entry = waiting.get(key);
		if (!entry) return;
		entry.cancel();
		waiting.delete(key);
		opts.send(key, entry.change);
	}

	return {
		schedule(key, change) {
			const entry = waiting.get(key);
			entry?.cancel();
			waiting.set(key, {
				change: entry ? opts.merge(entry.change, change) : change,
				cancel: clock.after(() => send(key), opts.ms),
			});
		},
		flush(key) {
			if (key !== undefined) {
				send(key);
				return;
			}
			for (const k of [...waiting.keys()]) send(k);
		},
		pending(key) {
			return waiting.has(key);
		},
	};
}
