import { assert, assertEquals } from "@std/assert";
import {
	type EmbeddingSyncReport,
	flushReembedsForTesting,
	REEMBED_SETTLE_MS,
	reembedInBackground,
	setReembedDepsForTesting,
} from "./embedding-sync.ts";

// #region Harness
function report(considered: number): EmbeddingSyncReport {
	return { considered, skipped: 0, embedded: considered, missing: 0, failed: 0, tokens: 0 };
}

/** A fake clock holding one timer at a time, and a run that records each batch it is handed. */
function harness(options: { hold?: boolean } = {}) {
	const runs: string[][] = [];
	const releases: Array<() => void> = [];
	const timers = new Map<number, { fn: () => void; ms: number }>();
	let nextId = 1;
	setReembedDepsForTesting({
		isLive: () => true,
		run: (itemIds) => {
			runs.push([...itemIds]);
			if (!options.hold) return Promise.resolve(report(itemIds.length));
			return new Promise((resolve) => releases.push(() => resolve(report(itemIds.length))));
		},
		setTimer: (fn, ms) => {
			const id = nextId++;
			timers.set(id, { fn, ms });
			return () => void timers.delete(id);
		},
	});
	return {
		runs,
		timers,
		/** Let the pending timer fire, as the settle window ending would. */
		fire() {
			const pending = [...timers.entries()];
			assertEquals(pending.length, 1, "exactly one timer is armed");
			const [id, { fn }] = pending[0];
			timers.delete(id);
			fn();
		},
		releaseNext() {
			releases.shift()?.();
		},
	};
}

/** Settle the promise chain a fired timer or a released run started. */
async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}
// #endregion

// #region Settle window
Deno.test("reembedInBackground — three writes of one item in the window make one sync holding it once", async () => {
	const h = harness();
	try {
		reembedInBackground(["lst-a"], "a listing update");
		reembedInBackground(["lst-a"], "a listing update");
		reembedInBackground(["lst-a"], "a listing update");
		assertEquals(h.runs, []);
		assertEquals(h.timers.size, 1);
		assertEquals([...h.timers.values()][0].ms, REEMBED_SETTLE_MS);
		h.fire();
		await settle();
		assertEquals(h.runs, [["lst-a"]]);
		assertEquals(h.timers.size, 0);
	} finally {
		setReembedDepsForTesting(null);
	}
});

Deno.test("reembedInBackground — ids from two writes make one sync holding both", async () => {
	const h = harness();
	try {
		reembedInBackground(["lst-a"], "a listing update");
		reembedInBackground(["ada"], "a profile save");
		const flushed = await flushReembedsForTesting();
		assertEquals(h.runs, [["lst-a", "ada"]]);
		assertEquals(flushed?.considered, 2);
		assertEquals(h.timers.size, 0);
	} finally {
		setReembedDepsForTesting(null);
	}
});

Deno.test("reembedInBackground — nothing is queued while embeddings are off or the ids are empty", async () => {
	const h = harness();
	try {
		reembedInBackground([], "a listing update");
		assertEquals(h.timers.size, 0);
		setReembedDepsForTesting({ isLive: () => false });
		reembedInBackground(["lst-a"], "a listing update");
		assertEquals(await flushReembedsForTesting(), null);
	} finally {
		setReembedDepsForTesting(null);
	}
});
// #endregion

// #region One run per item
Deno.test("reembedInBackground — an id queued again while it runs gets a second sync after the first", async () => {
	const h = harness({ hold: true });
	try {
		reembedInBackground(["lst-a"], "a listing update");
		h.fire();
		await settle();
		assertEquals(h.runs, [["lst-a"]]);

		reembedInBackground(["lst-a"], "a listing status change");
		h.fire();
		await settle();
		assertEquals(h.runs.length, 1, "the running id is not handed to a second, overlapping sync");
		assertEquals(h.timers.size, 0);

		h.releaseNext();
		await settle();
		assertEquals(h.timers.size, 1, "a fresh timer is armed once the first sync finishes");
		h.fire();
		await settle();
		assertEquals(h.runs, [["lst-a"], ["lst-a"]]);
		h.releaseNext();
		await settle();
		assertEquals(h.timers.size, 0);
	} finally {
		setReembedDepsForTesting(null);
	}
});

Deno.test("reembedInBackground — a run that throws is logged once and never reaches the caller", async () => {
	const warnings: string[] = [];
	const warn = console.warn;
	console.warn = (message: string) => void warnings.push(message);
	setReembedDepsForTesting({
		isLive: () => true,
		run: () => Promise.reject(new Error("voyage down")),
		setTimer: () => () => {},
	});
	try {
		reembedInBackground(["lst-a"], "a listing update");
		reembedInBackground(["ada"], "a profile save");
		reembedInBackground(["ada"], "a profile save");
		assertEquals(await flushReembedsForTesting(), null);
		assertEquals(warnings.length, 1);
		assert(warnings[0].includes("a listing update, a profile save failed — voyage down"));
	} finally {
		console.warn = warn;
		setReembedDepsForTesting(null);
	}
});
// #endregion
