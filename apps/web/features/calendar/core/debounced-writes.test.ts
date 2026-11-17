import { assert, assertEquals, assertFalse } from "@std/assert";
import { type DebounceClock, debouncedWrites } from "./debounced-writes.ts";

/** A clock that only moves when the test says so. */
function fakeClock(): DebounceClock & { advance(ms: number): void } {
	let now = 0;
	let seq = 0;
	const timers = new Map<number, { at: number; run: () => void }>();
	return {
		after(run, ms) {
			seq += 1;
			const id = seq;
			timers.set(id, { at: now + ms, run });
			return () => timers.delete(id);
		},
		advance(ms) {
			now += ms;
			for (const [id, t] of [...timers]) {
				if (t.at > now) continue;
				timers.delete(id);
				t.run();
			}
		},
	};
}

function harness() {
	const clock = fakeClock();
	const sent: [string, string[]][] = [];
	const writes = debouncedWrites<string[]>({
		ms: 500,
		merge: (a, b) => [...a, ...b],
		send: (key, change) => sent.push([key, change]),
		clock,
	});
	return { clock, sent, writes };
}

Deno.test("a quick run of changes to one key is sent once, merged, after the key goes quiet", () => {
	const { clock, sent, writes } = harness();
	writes.schedule("a", ["teal"]);
	clock.advance(300);
	writes.schedule("a", ["rose"]);
	clock.advance(300);
	writes.schedule("a", ["amber"]);
	assertEquals(sent, []);
	assert(writes.pending("a"));
	clock.advance(499);
	assertEquals(sent, []);
	clock.advance(1);
	assertEquals(sent, [["a", ["teal", "rose", "amber"]]]);
	assertFalse(writes.pending("a"));
});

Deno.test("each key waits on its own", () => {
	const { clock, sent, writes } = harness();
	writes.schedule("a", ["1"]);
	clock.advance(400);
	writes.schedule("b", ["2"]);
	clock.advance(100);
	assertEquals(sent, [["a", ["1"]]]);
	clock.advance(400);
	assertEquals(sent, [["a", ["1"]], ["b", ["2"]]]);
});

Deno.test("flush sends what is waiting now, and nothing twice", () => {
	const { clock, sent, writes } = harness();
	writes.schedule("a", ["1"]);
	writes.schedule("b", ["2"]);
	writes.flush("a");
	assertEquals(sent, [["a", ["1"]]]);
	writes.flush();
	assertEquals(sent, [["a", ["1"]], ["b", ["2"]]]);
	clock.advance(1_000);
	assertEquals(sent.length, 2);
	writes.flush("missing");
	assertEquals(sent.length, 2);
});

Deno.test("a change made after a send starts a new write", () => {
	const { clock, sent, writes } = harness();
	writes.schedule("a", ["1"]);
	clock.advance(500);
	writes.schedule("a", ["2"]);
	clock.advance(500);
	assertEquals(sent, [["a", ["1"]], ["a", ["2"]]]);
});
