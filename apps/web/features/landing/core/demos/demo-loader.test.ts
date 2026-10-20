/**
 * demo-loader.test — the demo chunks' loader (`core/demos/demo-loader.ts`): one import per id at a
 * time, the arrived module kept, every caller on the in-flight import, and a failure forgotten.
 */
import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { createModuleLoader } from "./demo-loader.ts";

// #region Fixtures
/** A promise settled from outside, and how many times its import was called. */
function deferredImport<T>() {
	let calls = 0;
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const run = () => {
		calls += 1;
		return new Promise<T>((yes, no) => {
			resolve = yes;
			reject = no;
		});
	};
	return {
		run,
		calls: () => calls,
		resolve: (value: T) => resolve(value),
		reject: (reason: unknown) => reject(reason),
	};
}
// #endregion

Deno.test("one import per id while it is in flight; every caller gets the same promise", async () => {
	const board = deferredImport<string>();
	const loader = createModuleLoader({ board: board.run });
	const first = loader.load("board");
	const second = loader.load("board");
	assertStrictEquals(first, second);
	assertEquals(board.calls(), 1);
	assertEquals(loader.loaded("board"), undefined);
	board.resolve("BoardDemo");
	assertEquals(await first, "BoardDemo");
	assertEquals(loader.loaded("board"), "BoardDemo");
	assertEquals(await loader.load("board"), "BoardDemo");
	assertEquals(board.calls(), 1, "an arrived module is never imported again");
});

Deno.test("a press during a warm-up's import hears that import fail", async () => {
	const booking = deferredImport<string>();
	const loader = createModuleLoader({ booking: booking.run });
	const warmed: string[] = [];
	loader.load("booking").catch(() => warmed.push("warm-up failed"));
	const press = loader.load("booking");
	booking.reject(new TypeError("Failed to fetch dynamically imported module"));
	await assertRejects(() => press, TypeError);
	assertEquals(warmed, ["warm-up failed"]);
	assertEquals(booking.calls(), 1);
});

Deno.test("a failed import is forgotten: the next request imports again", async () => {
	const splits = deferredImport<string>();
	const loader = createModuleLoader({ splits: splits.run });
	const first = loader.load("splits");
	splits.reject(new Error("chunk 404"));
	await assertRejects(() => first);
	assertEquals(loader.loaded("splits"), undefined);
	const second = loader.load("splits");
	assertEquals(splits.calls(), 2);
	splits.resolve("TeamPayDemo");
	assertEquals(await second, "TeamPayDemo");
});
