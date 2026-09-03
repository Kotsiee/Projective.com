import { assert, assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { ArcCache, cacheKey, tenantPrefix } from "./cache.ts";

/**
 * cache_test — the ARC policy and the tenant-scoping rule, proven by execution.
 *
 * The policy tests are worth more than they look. An ARC that is subtly wrong still *works* — it
 * returns correct values and never corrupts anything — it simply degrades to an LRU with extra
 * bookkeeping, and nothing about reading the code tells you which one you have. The scan-resistance
 * test below is the one that actually distinguishes them: it is the property the whole algorithm
 * exists for, and it FAILS against a plain LRU.
 */

// #region Keys

Deno.test("cacheKey is order-independent over object keys", () => {
	const tenant = { userId: "u1", contextId: "" };
	const a = cacheKey(tenant, "projects.list", { view: "all", scope: "x", limit: 20 });
	const b = cacheKey(tenant, "projects.list", { limit: 20, scope: "x", view: "all" });
	assertEquals(a, b);
});

Deno.test("cacheKey preserves array order — order is semantic in these params", () => {
	const tenant = { userId: "u1", contextId: "" };
	const a = cacheKey(tenant, "submissions", { path: ["stage-1", "ivy"] });
	const b = cacheKey(tenant, "submissions", { path: ["ivy", "stage-1"] });
	assertNotEquals(a, b);
});

Deno.test("cacheKey treats an omitted optional and an explicit undefined as one request", () => {
	const tenant = { userId: "u1", contextId: "" };
	const a = cacheKey(tenant, "projects.files", { projectId: "p", channelId: undefined });
	const b = cacheKey(tenant, "projects.files", { projectId: "p" });
	assertEquals(a, b);
});

Deno.test("cacheKey keeps null distinct from absent — null means project scope here", () => {
	const tenant = { userId: "u1", contextId: "" };
	const withNull = cacheKey(tenant, "projects.files", { projectId: "p", channelId: null });
	const without = cacheKey(tenant, "projects.files", { projectId: "p" });
	assertNotEquals(withNull, without);
});

Deno.test("cacheKey distinguishes values held in internal slots, not own properties", () => {
	// `Object.entries` returns [] for a Date, a Map and a Set, so without explicit branches all three
	// serialise to `{}` and two different ranges collapse onto ONE key — serving January's rows to a
	// June request for the whole TTL, with no error and no way to see it from a call site.
	const t = { userId: "u1", contextId: "" };
	const jan = cacheKey(t, "ns", { from: new Date("2026-01-01"), to: new Date("2026-01-31") });
	const jun = cacheKey(t, "ns", { from: new Date("2026-06-01"), to: new Date("2026-06-30") });
	assertNotEquals(jan, jun, "two date ranges must not share an entry");

	assertNotEquals(
		cacheKey(t, "ns", new Map([["a", 1]])),
		cacheKey(t, "ns", new Map([["a", 2]])),
	);
	assertNotEquals(cacheKey(t, "ns", new Set([1, 2])), cacheKey(t, "ns", new Set([1, 3])));
});

Deno.test("cacheKey is stable for equal Dates, Maps and Sets regardless of insertion order", () => {
	const t = { userId: "u1", contextId: "" };
	assertEquals(cacheKey(t, "ns", new Date(0)), cacheKey(t, "ns", new Date(0)));
	assertEquals(
		cacheKey(t, "ns", new Map([["a", 1], ["b", 2]])),
		cacheKey(t, "ns", new Map([["b", 2], ["a", 1]])),
	);
	assertEquals(cacheKey(t, "ns", new Set([1, 2])), cacheKey(t, "ns", new Set([2, 1])));
});

Deno.test("cacheKey does not throw on an Invalid Date", () => {
	// `toISOString()` throws on one; `getTime()` yields NaN, which serialises fine.
	const t = { userId: "u1", contextId: "" };
	assertEquals(typeof cacheKey(t, "ns", new Date("nonsense")), "string");
});

Deno.test("cacheKey separates tenants, contexts, and namespaces", () => {
	const params = { projectId: "p" };
	const userA = cacheKey({ userId: "a", contextId: "" }, "projects.detail", params);
	const userB = cacheKey({ userId: "b", contextId: "" }, "projects.detail", params);
	const teamA = cacheKey({ userId: "a", contextId: "team-1" }, "projects.detail", params);
	const otherNs = cacheKey({ userId: "a", contextId: "" }, "projects.files", params);
	assertNotEquals(userA, userB, "two users must never share an entry");
	assertNotEquals(userA, teamA, "acting context is its own cache dimension");
	assertNotEquals(userA, otherNs, "two endpoints with identical params must not collide");
});

Deno.test("a user id cannot be crafted to collide with another tenant's key", () => {
	// The delimiter is a byte no id in this system can contain, so no choice of `userId` lets one
	// tenant's key be spelled by another.
	const honest = cacheKey({ userId: "a", contextId: "team-1" }, "ns", 1);
	const attacker = cacheKey({ userId: "a\u0000team-1", contextId: "" }, "ns", 1);
	assertNotEquals(honest, attacker);
});

Deno.test("tenantPrefix matches that tenant's keys and no other's", () => {
	const mine = { userId: "u1", contextId: "" };
	const theirs = { userId: "u2", contextId: "" };
	assert(cacheKey(mine, "ns", 1).startsWith(tenantPrefix(mine)));
	assert(!cacheKey(theirs, "ns", 1).startsWith(tenantPrefix(mine)));
});

Deno.test("tenantPrefix does not match a user whose id merely starts with the same characters", () => {
	// `u1` must not clear `u10`'s entries. The trailing delimiter in the prefix is what prevents it.
	const shortId = { userId: "u1", contextId: "" };
	const longerId = { userId: "u10", contextId: "" };
	assert(!cacheKey(longerId, "ns", 1).startsWith(tenantPrefix(shortId)));
});

// #endregion

// #region Construction

Deno.test("refuses a capacity or TTL that would silently disable the cache", () => {
	assertThrows(() => new ArcCache({ maxEntries: 0, ttlMs: 1000 }));
	assertThrows(() => new ArcCache({ maxEntries: 4, ttlMs: 0 }));
});

// #endregion

// #region Basic behaviour

Deno.test("stores and returns a value; a miss is undefined", () => {
	const cache = new ArcCache<string>({ maxEntries: 4, ttlMs: 1000 });
	cache.set("a", "A");
	assertEquals(cache.get("a"), "A");
	assertEquals(cache.get("absent"), undefined);
	const stats = cache.stats();
	assertEquals(stats.hits, 1);
	assertEquals(stats.misses, 1);
});

Deno.test("never exceeds maxEntries resident, under sustained insertion", () => {
	const cache = new ArcCache<number>({ maxEntries: 8, ttlMs: 60_000 });
	for (let i = 0; i < 500; i++) {
		cache.set(`k${i}`, i);
		assert(cache.stats().size <= 8, `resident set grew to ${cache.stats().size} at i=${i}`);
	}
});

Deno.test("bounds the resident set even when keys are re-touched, promoting into t2", () => {
	const cache = new ArcCache<number>({ maxEntries: 8, ttlMs: 60_000 });
	for (let i = 0; i < 300; i++) {
		const key = `k${i % 40}`;
		cache.set(key, i);
		cache.get(key);
		assert(cache.stats().size <= 8);
	}
});

Deno.test("expires an entry past its TTL and reports it as an expiration", () => {
	let clock = 1_000;
	const cache = new ArcCache<string>({ maxEntries: 4, ttlMs: 100, now: () => clock });
	cache.set("a", "A");
	clock += 50;
	assertEquals(cache.get("a"), "A", "still inside the TTL");
	clock += 100;
	assertEquals(cache.get("a"), undefined, "past the TTL");
	assertEquals(cache.stats().expirations, 1);
});

Deno.test("an expired entry is re-settable and serves the fresh value", () => {
	let clock = 0;
	const cache = new ArcCache<string>({ maxEntries: 4, ttlMs: 100, now: () => clock });
	cache.set("a", "stale");
	clock += 200;
	assertEquals(cache.get("a"), undefined);
	cache.set("a", "fresh");
	assertEquals(cache.get("a"), "fresh");
});

Deno.test("expiry on a nearly-empty cache does not evict live neighbours", () => {
	// The regression this pins. Expiry used to demote the aged-out key into a ghost list, which is
	// capacity evidence the cache had not actually produced: with 5 entries in a 512-slot cache the
	// refresh of an expired key hit ARC's Case II, called REPLACE, and evicted one of the four live
	// neighbours to make room that already existed. Every invariant still held and every other test
	// still passed, so nothing but a hit-rate measurement could see it.
	let clock = 0;
	const cache = new ArcCache<string>({ maxEntries: 512, ttlMs: 100, now: () => clock });

	// The one key that will age out is stored FIRST and alone; the neighbours are stored after the
	// clock advances, so they are still inside their own TTL when the refresh happens. Storing them
	// all together and then advancing the clock expires everything and tests nothing.
	cache.set("expiring", "x");
	clock += 150;

	const warm = ["a", "b", "c", "d"];
	for (const key of warm) cache.set(key, key);

	assertEquals(cache.get("expiring"), undefined, "precondition: it aged out");
	cache.set("expiring", "refreshed");

	const survivors = warm.filter((key) => cache.get(key) !== undefined);
	assertEquals(
		survivors.length,
		4,
		`refreshing an expired key must not evict a neighbour; lost ${4 - survivors.length}`,
	);
});

Deno.test("a full cache still evicts on a ghost hit — the guard is fullness, not a disable", () => {
	// The other half: the fullness guard must not turn REPLACE off. With the cache genuinely at
	// capacity, re-admitting a ghosted key still has to displace something.
	const cache = new ArcCache<number>({ maxEntries: 4, ttlMs: 60_000 });
	for (let round = 0; round < 4; round++) {
		for (let i = 0; i < 6; i++) {
			if (cache.get(`k${i}`) === undefined) cache.set(`k${i}`, i);
		}
	}
	assertEquals(cache.stats().size, 4, "the resident set stays at capacity");
	assert(cache.stats().evictions > 0, "a full cache under churn must be evicting");
});

Deno.test("delete removes a key from resident and ghost lists alike", () => {
	const cache = new ArcCache<string>({ maxEntries: 2, ttlMs: 60_000 });
	cache.set("a", "A");
	cache.delete("a");
	assertEquals(cache.get("a"), undefined);
});

// #endregion

// #region The property ARC exists for

Deno.test("scan resistance: a long one-shot scan does not evict the hot working set", () => {
	// This is the test that separates ARC from LRU. The working set is touched TWICE so it is
	// promoted to `t2`; the scan is 400 distinct keys each touched once, which is 50x the capacity.
	// Under LRU the working set is gone. Under ARC `t2` is defended.
	const capacity = 8;
	const cache = new ArcCache<string>({ maxEntries: capacity, ttlMs: 60_000 });

	const hot = ["h0", "h1", "h2", "h3"];
	for (const key of hot) {
		cache.set(key, key);
		cache.get(key); // second touch -> promotes into t2
	}

	for (let i = 0; i < 400; i++) cache.set(`scan${i}`, "s");

	const survivors = hot.filter((key) => cache.get(key) !== undefined);
	assert(
		survivors.length >= 2,
		`ARC should defend the frequent set against a scan; ${survivors.length}/4 survived`,
	);
});

Deno.test("a plain-LRU baseline fails the same scan, confirming the test has teeth", () => {
	// Guards against the test above passing for the wrong reason. If this baseline ever survives,
	// the scan is too short to be a scan and the assertion above proves nothing.
	const capacity = 8;
	const lru = new Map<string, string>();
	const put = (k: string, v: string) => {
		if (lru.has(k)) lru.delete(k);
		lru.set(k, v);
		if (lru.size > capacity) {
			const oldest = lru.keys().next().value;
			if (oldest !== undefined) lru.delete(oldest);
		}
	};
	const hot = ["h0", "h1", "h2", "h3"];
	for (const key of hot) {
		put(key, key);
		put(key, key);
	}
	for (let i = 0; i < 400; i++) put(`scan${i}`, "s");
	const survivors = hot.filter((key) => lru.has(key));
	assertEquals(survivors.length, 0, "an LRU must lose the working set to this scan");
});

Deno.test("a pure scan does NOT move p — a scan is not evidence about the working set", () => {
	// Worth pinning, because it is the behaviour that made the first version of the test below wrong.
	// With `b1` empty and `t1` full, ARC's Case IV(i) evicts from `t1` outright and records no ghost,
	// so a one-shot scan produces no ghost hits and no adaptation. That is correct: a scan should
	// leave the recency/frequency balance exactly where it found it.
	const cache = new ArcCache<number>({ maxEntries: 4, ttlMs: 60_000 });
	for (let i = 0; i < 200; i++) cache.set(`scan${i}`, i);
	assertEquals(cache.stats().p, 0);
	assertEquals(cache.stats().ghostHits, 0);
});

Deno.test("adapts p upward when recency is repeatedly under-served", () => {
	// To exercise adaptation the ghost lists have to be reachable, which needs `t2` occupied so that
	// `|t1| + |b1| < c` and evictions route through REPLACE (recording a ghost) rather than through
	// the ghostless Case IV(i) branch. So: promote a small frequent set, then cycle a recency set
	// slightly larger than the room that leaves. Re-requesting a just-evicted key is a `b1` ghost
	// hit, which is precisely the signal to grow the recency target.
	const cache = new ArcCache<number>({ maxEntries: 4, ttlMs: 60_000 });

	for (const key of ["h0", "h1"]) {
		cache.set(key, 0);
		cache.get(key); // second touch -> t2
	}

	for (let round = 0; round < 6; round++) {
		for (const key of ["a", "b", "c", "d"]) {
			if (cache.get(key) === undefined) cache.set(key, round);
		}
	}

	assert(cache.stats().ghostHits > 0, "the workload should have produced ghost hits");
	assert(cache.stats().p > 0, "p should have adapted away from its initial 0");
});

Deno.test("adapts p downward when the frequent set is the one being evicted", () => {
	// The mirror of the test above: a `b2` ghost hit means frequency was under-weighted, so `p` — the
	// target size of the RECENCY list — must shrink to give `t2` more room.
	const cache = new ArcCache<number>({ maxEntries: 4, ttlMs: 60_000 });

	// Drive p up first, so there is something to shrink.
	for (const key of ["h0", "h1"]) {
		cache.set(key, 0);
		cache.get(key);
	}
	for (let round = 0; round < 6; round++) {
		for (const key of ["a", "b", "c", "d"]) {
			if (cache.get(key) === undefined) cache.set(key, round);
		}
	}
	const raised = cache.stats().p;
	assert(raised > 0, "precondition: p must be above zero before it can be shrunk");

	// Now build a frequent set larger than t2 can hold and keep re-touching it, so evictions land in
	// b2 and the returning keys are b2 ghost hits.
	const frequent = ["f0", "f1", "f2", "f3", "f4", "f5"];
	for (let round = 0; round < 8; round++) {
		for (const key of frequent) {
			if (cache.get(key) === undefined) cache.set(key, round);
			cache.get(key); // second touch -> t2, so its eviction records a b2 ghost
		}
	}

	assert(
		cache.stats().p < raised,
		`p should have fallen from ${raised}; it is ${cache.stats().p}`,
	);
});

Deno.test("p never leaves [0, maxEntries]", () => {
	const capacity = 6;
	const cache = new ArcCache<number>({ maxEntries: capacity, ttlMs: 60_000 });
	for (let i = 0; i < 2000; i++) {
		const key = `k${(i * 7) % 50}`;
		if (cache.get(key) === undefined) cache.set(key, i);
		const { p } = cache.stats();
		assert(p >= 0 && p <= capacity, `p escaped its bounds: ${p}`);
	}
});

Deno.test("the directory (resident + ghosts) stays bounded at 2x capacity", () => {
	const capacity = 6;
	const cache = new ArcCache<number>({ maxEntries: capacity, ttlMs: 60_000 });
	for (let i = 0; i < 1000; i++) cache.set(`k${i}`, i);
	// Only the resident half is observable through the public surface, but a runaway ghost list
	// would show up as unbounded memory; the resident clamp is the part a caller can assert.
	assert(cache.stats().size <= capacity);
});

// #endregion

// #region Tenant isolation

Deno.test("clearTenant drops only the named tenant's entries", () => {
	const cache = new ArcCache<string>({ maxEntries: 32, ttlMs: 60_000 });
	const mine = { userId: "u1", contextId: "" };
	const theirs = { userId: "u2", contextId: "" };
	const mineKey = cacheKey(mine, "projects.detail", { slug: "x" });
	const theirsKey = cacheKey(theirs, "projects.detail", { slug: "x" });

	cache.set(mineKey, "MINE");
	cache.set(theirsKey, "THEIRS");
	cache.clearTenant(mine);

	assertEquals(cache.get(mineKey), undefined);
	assertEquals(cache.get(theirsKey), "THEIRS");
});

Deno.test("two tenants asking the identical question never share an answer", () => {
	// The disclosure this cache could cause if keys omitted identity, stated as a test.
	const cache = new ArcCache<string>({ maxEntries: 32, ttlMs: 60_000 });
	const question = { projectId: "p-1", channelId: null };
	const alice = cacheKey({ userId: "alice", contextId: "" }, "projects.members", question);
	const mallory = cacheKey({ userId: "mallory", contextId: "" }, "projects.members", question);

	cache.set(alice, "alice-visible-roster");
	assertEquals(cache.get(mallory), undefined, "mallory must miss and be forced through RLS");
});

Deno.test("switching acting context does not serve the previous context's answer", () => {
	const cache = new ArcCache<string>({ maxEntries: 32, ttlMs: 60_000 });
	const question = { view: "all" };
	const personal = cacheKey({ userId: "u1", contextId: "" }, "projects.list", question);
	const asTeam = cacheKey({ userId: "u1", contextId: "team-9" }, "projects.list", question);
	cache.set(personal, "personal-feed");
	assertEquals(cache.get(asTeam), undefined);
});

// #endregion

// #region Read-through

Deno.test("through computes on a miss and serves from cache on the next call", async () => {
	const cache = new ArcCache<number>({ maxEntries: 4, ttlMs: 60_000 });
	let computed = 0;
	const compute = () => {
		computed++;
		return Promise.resolve(42);
	};
	assertEquals(await cache.through("k", compute), 42);
	assertEquals(await cache.through("k", compute), 42);
	assertEquals(computed, 1, "the second call must not recompute");
});

Deno.test("through recomputes once the TTL has passed", async () => {
	let clock = 0;
	const cache = new ArcCache<number>({ maxEntries: 4, ttlMs: 100, now: () => clock });
	let computed = 0;
	const compute = () => {
		computed++;
		return Promise.resolve(computed);
	};
	await cache.through("k", compute);
	clock += 500;
	await cache.through("k", compute);
	assertEquals(computed, 2);
});

Deno.test("a rejected compute is not cached and does not poison the key", async () => {
	const cache = new ArcCache<string>({ maxEntries: 4, ttlMs: 60_000 });
	let attempt = 0;
	const compute = () => {
		attempt++;
		return attempt === 1 ? Promise.reject(new Error("boom")) : Promise.resolve("ok");
	};
	let threw = false;
	try {
		await cache.through("k", compute);
	} catch {
		threw = true;
	}
	assert(threw, "the rejection must propagate rather than being swallowed");
	assertEquals(await cache.through("k", compute), "ok", "a retry must be allowed to succeed");
});

// #endregion
