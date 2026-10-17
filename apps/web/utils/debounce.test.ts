import { assertEquals } from "@std/assert";
import { debounce } from "./debounce.ts";
import { fakeClock } from "./debounce.testing.ts";

Deno.test("debounce: a burst runs once, with the last call's arguments, after the quiet period", () => {
	const clock = fakeClock();
	const seen: string[] = [];
	const run = debounce((value: string) => seen.push(value), 400, clock);
	run("n");
	clock.advance(200);
	run("no");
	clock.advance(200);
	run("nor");
	assertEquals(seen, []);
	assertEquals(run.pending, true);
	clock.advance(399);
	assertEquals(seen, []);
	clock.advance(1);
	assertEquals(seen, ["nor"]);
	assertEquals(run.pending, false);
});

Deno.test("debounce: cancel drops the pending call; flush runs it now", () => {
	const clock = fakeClock();
	const seen: number[] = [];
	const run = debounce((value: number) => seen.push(value), 100, clock);
	run(1);
	run.cancel();
	clock.advance(500);
	assertEquals(seen, []);
	run(2);
	run.flush();
	assertEquals(seen, [2]);
	clock.advance(500);
	assertEquals(seen, [2], "a flushed call does not run again");
	run.flush();
	assertEquals(seen, [2], "flush with nothing pending is a no-op");
});
