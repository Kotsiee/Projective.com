/**
 * optimistic — the write discipline every star / save control shares (Decision #180), kept free of the
 * dev seam so it is testable under `deno test`: show the new state at once, persist, put the old one
 * back if the server refuses, and drop a second press on the same key while the first is in flight.
 */

/** A toggle's outcome: whether it stuck, and what to announce. */
export interface ToggleOutcome {
	ok: boolean;
	message: string;
}

const inFlight = new Set<string>();

/**
 * Apply `next` through `apply`, run `send`, and re-apply `!next` when it fails. Answers the sentence to
 * announce — the server's on success or refusal, `fallback` when it said nothing.
 */
export async function optimistic(
	key: string,
	next: boolean,
	apply: (value: boolean) => void,
	send: () => Promise<{ ok: boolean; message: string }>,
	fallback: string,
): Promise<ToggleOutcome> {
	if (inFlight.has(key)) return { ok: false, message: "" };
	inFlight.add(key);
	apply(next);
	try {
		const res = await send();
		if (!res.ok) apply(!next);
		return { ok: res.ok, message: res.message || fallback };
	} finally {
		inFlight.delete(key);
	}
}
