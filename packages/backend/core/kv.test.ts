import { assertEquals, assertRejects } from "@std/assert";
import {
	bumpCacheVersion,
	cachedGlobal,
	cacheVersion,
	cacheVersionTag,
	setSharedKvForTesting,
} from "./kv.ts";

/**
 * kv_test — `cachedGlobal` and the version keys, with no KV (as `deno task test:unit` runs, without
 * `--unstable-kv`) and over a stub handle.
 */

/** Just enough of `Deno.Kv`: a map behind `get` / `set` that records every call. */
function stubKv(options: { holdWrites?: boolean } = {}) {
	const store = new Map<string, unknown>();
	const reads: Deno.KvKey[] = [];
	const writes: Array<{ key: Deno.KvKey; value: unknown; expireIn?: number }> = [];
	const kv = {
		get: (key: Deno.KvKey) => {
			reads.push(key);
			const value = store.get(JSON.stringify(key)) ?? null;
			return Promise.resolve({ key, value, versionstamp: value === null ? null : "1" });
		},
		set: (key: Deno.KvKey, value: unknown, opts?: { expireIn?: number }) => {
			writes.push({ key, value, expireIn: opts?.expireIn });
			store.set(JSON.stringify(key), value);
			return options.holdWrites
				? new Promise<never>(() => {})
				: Promise.resolve({ ok: true, versionstamp: "1" });
		},
	};
	return { kv: kv as unknown as Deno.Kv, store, reads, writes };
}

/** A fetch that counts its calls and answers `value`. */
function counting<T>(value: T) {
	const calls = { count: 0 };
	const fetch = () => {
		calls.count++;
		return Promise.resolve(value);
	};
	return { calls, fetch };
}

// #region cachedGlobal

Deno.test("cachedGlobal without KV — falsy answers are values, fetched once each", async () => {
	setSharedKvForTesting(null);
	for (const value of [null, false, 0, ""]) {
		const { calls, fetch } = counting(value);
		const key = ["test", "falsy", String(value)];
		assertEquals(await cachedGlobal(key, 60_000, fetch), value);
		assertEquals(await cachedGlobal(key, 60_000, fetch), value);
		assertEquals(calls.count, 1, `${JSON.stringify(value)} must be cached, not treated as a miss`);
	}
});

Deno.test("cachedGlobal — concurrent misses share one fetch; a rejection is never stored", async () => {
	setSharedKvForTesting(null);
	const pending = Promise.withResolvers<string>();
	let calls = 0;
	const fetch = () => (++calls === 1 ? pending.promise : Promise.resolve("second"));
	const first = cachedGlobal(["test", "flight"], 60_000, fetch);
	const second = cachedGlobal(["test", "flight"], 60_000, fetch);
	pending.reject(new Error("down"));
	await assertRejects(() => first, Error, "down");
	await assertRejects(() => second, Error, "down");
	assertEquals(calls, 1, "the second caller joined the first flight");
	assertEquals(await cachedGlobal(["test", "flight"], 60_000, fetch), "second");
	assertEquals(calls, 2, "the failure was not cached");
});

Deno.test("cachedGlobal — a miss answers before its KV write settles, then serves from memory", async () => {
	const { kv, writes, reads } = stubKv({ holdWrites: true });
	setSharedKvForTesting(kv);
	const { calls, fetch } = counting({ GBP: 0.79 });
	assertEquals(await cachedGlobal(["fx", "USD"], 900_000, fetch), { GBP: 0.79 });
	assertEquals(writes.length, 1);
	assertEquals(writes[0].expireIn, 900_000);
	assertEquals(await cachedGlobal(["fx", "USD"], 900_000, fetch), { GBP: 0.79 });
	assertEquals(calls.count, 1);
	assertEquals(reads.length, 1, "the second read is a memory hit");
});

Deno.test("cachedGlobal — a KV hit fills memory and skips the fetch; an expired one is a miss", async () => {
	const { kv, store, reads } = stubKv();
	setSharedKvForTesting(kv);
	store.set(JSON.stringify(["ref", "plans"]), { value: ["pro"], expiresAt: Date.now() + 60_000 });
	store.set(JSON.stringify(["ref", "old"]), { value: "stale", expiresAt: Date.now() - 1 });
	const { calls, fetch } = counting<unknown>("fresh");

	assertEquals(await cachedGlobal(["ref", "plans"], 60_000, fetch), ["pro"]);
	assertEquals(await cachedGlobal(["ref", "plans"], 60_000, fetch), ["pro"]);
	assertEquals(calls.count, 0, "another isolate's value is served without a fetch");
	assertEquals(reads.length, 1, "and then from this isolate's memory");

	assertEquals(await cachedGlobal(["ref", "old"], 60_000, fetch), "fresh");
	assertEquals(calls.count, 1);
});

Deno.test("cachedGlobal — a value over 60 KiB is served from memory and never written to KV", async () => {
	const { kv, writes } = stubKv();
	setSharedKvForTesting(kv);
	const { calls, fetch } = counting("x".repeat(70 * 1024));
	assertEquals((await cachedGlobal(["test", "big"], 60_000, fetch)).length, 70 * 1024);
	assertEquals((await cachedGlobal(["test", "big"], 60_000, fetch)).length, 70 * 1024);
	assertEquals(writes.length, 0);
	assertEquals(calls.count, 1);
});

// #endregion

// #region Version keys

Deno.test("version keys without KV — constant, and a bump neither throws nor changes them", async () => {
	setSharedKvForTesting(null);
	assertEquals(await cacheVersion(["catalogue"]), null);
	await bumpCacheVersion(["catalogue"]);
	assertEquals(await cacheVersion(["catalogue"]), null);
	assertEquals(await cacheVersionTag(["catalogue"]), "v0");
});

Deno.test("version keys — the writer's isolate sees its bump at once, under the scope's KV key", async () => {
	const { kv, writes } = stubKv();
	setSharedKvForTesting(kv);
	assertEquals(await cacheVersionTag(["messaging", "u1"]), "v0");
	await bumpCacheVersion(["messaging", "u1"]);
	assertEquals(writes[0].key, ["cache", "v", "messaging", "u1"]);
	const bumped = await cacheVersion(["messaging", "u1"]);
	assertEquals(bumped, writes[0].value);
	assertEquals(await cacheVersionTag(["messaging", "u1"]), bumped);
	assertEquals(await cacheVersion(["messaging", "u2"]), null, "scopes are independent");
});

Deno.test("version keys — another isolate's bump is read at most once a second", async () => {
	const { kv, store, reads } = stubKv();
	setSharedKvForTesting(kv);
	const scope = ["catalogue"];
	store.set(JSON.stringify(["cache", "v", ...scope]), "a");
	const [x, y] = await Promise.all([cacheVersion(scope), cacheVersion(scope)]);
	assertEquals([x, y], ["a", "a"]);

	store.set(JSON.stringify(["cache", "v", ...scope]), "b");
	assertEquals(await cacheVersion(scope), "a", "inside the window the isolate's read stands");
	assertEquals(reads.length, 1, "one KV read for every check inside the window");

	await new Promise((resolve) => setTimeout(resolve, 1_100));
	assertEquals(await cacheVersion(scope), "b", "past the window the bump is seen");
	assertEquals(reads.length, 2);
});

// #endregion
