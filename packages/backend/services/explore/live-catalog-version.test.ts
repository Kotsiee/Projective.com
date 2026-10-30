import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { setSharedKvForTesting } from "../../core/kv.ts";
import { type Catalog, CATALOG_TTL_MS, VERSION_WAIT_MS } from "./live-catalog.ts";

/**
 * live-catalog-version_test — the catalogue invalidates across isolates through its KV version key
 * (Decision #339, ruling N2), and falls back to its TTL with KV absent or hung.
 *
 * Each simulated isolate is a fresh instance of the module (`./live-catalog.ts?isolate=N`) reading a
 * fake corpus instead of Postgres. They share one stub Kv, and also `kv.ts` itself, so its 1 s version
 * memory is shared too: the window is waited out in real time, as `kv.test.ts` does.
 */

// #region Fakes
type CatalogModule = typeof import("./live-catalog.ts");

/** The database every isolate reads: the revision a corpus read sees, and how many reads ran. */
interface Db {
	rev: number;
	reads: number;
	/** Each read waits on this before it answers. */
	gate: Promise<void>;
}

function db(): Db {
	return { rev: 1, reads: 0, gate: Promise.resolve() };
}

let isolates = 0;

/** One simulated isolate: a fresh instance of the module whose corpus read is `source`. */
async function isolate(source: Db): Promise<CatalogModule> {
	const mod: CatalogModule = await import(`./live-catalog.ts?isolate=${++isolates}`);
	mod.setCatalogReaderForTesting(async () => {
		source.reads++;
		const rev = source.rev;
		await source.gate;
		return { loadedAt: rev } as unknown as Catalog;
	});
	return mod;
}

/** The revision a fake catalogue was read at. */
const revision = (catalog: Catalog) => catalog.loadedAt;

/** Just enough of `Deno.Kv` for the version keys: a map behind `get` / `set`, every call recorded. */
function stubKv() {
	const store = new Map<string, unknown>();
	const reads: Deno.KvKey[] = [];
	const writes: Deno.KvKey[] = [];
	const kv = {
		get: (key: Deno.KvKey) => {
			reads.push(key);
			const value = store.get(JSON.stringify(key)) ?? null;
			return Promise.resolve({ key, value, versionstamp: value === null ? null : "1" });
		},
		set: (key: Deno.KvKey, value: unknown) => {
			writes.push(key);
			store.set(JSON.stringify(key), value);
			return Promise.resolve({ ok: true, versionstamp: "1" });
		},
	};
	return { kv: kv as unknown as Deno.Kv, reads, writes };
}

/** A Kv that never answers. */
function hungKv(): Deno.Kv {
	const hung = new Promise<never>(() => {});
	return { get: () => hung, set: () => hung } as unknown as Deno.Kv;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Whether `read` settles on microtasks alone, with no timer advanced. */
async function answersAtOnce(read: Promise<unknown>, time: FakeTime): Promise<boolean> {
	let settled = false;
	const settle = () => {
		settled = true;
	};
	read.then(settle, settle);
	await time.runMicrotasks();
	return settled;
}
// #endregion

Deno.test("version key — a write in one isolate refreshes the other on its next read, without blocking it", async () => {
	const { kv, reads, writes } = stubKv();
	setSharedKvForTesting(kv);
	try {
		const source = db();
		const writer = await isolate(source);
		const reader = await isolate(source);
		assertEquals(revision(await writer.loadCatalog()), 1);
		assertEquals(revision(await reader.loadCatalog()), 1);

		source.rev = 2;
		writer.invalidateCatalog();
		await tick();
		assertEquals(writes, [["cache", "v", "catalogue"]], "the write bumped the catalogue's version");
		assertEquals(revision(await writer.loadCatalog()), 2, "the writer reads its own write at once");
		assertEquals(source.reads, 3);

		await new Promise((resolve) => setTimeout(resolve, 1_100));
		const held = Promise.withResolvers<void>();
		source.gate = held.promise;
		const kvReads = reads.length;
		assertEquals(revision(await reader.loadCatalog()), 1, "the read that checks is served at once");
		await tick();
		assertEquals(reads.slice(kvReads), [["cache", "v", "catalogue"]], "its check read KV");
		assertEquals(source.reads, 4, "and the changed version started one background refresh");
		assertEquals(revision(await reader.loadCatalog()), 1, "served while the refresh runs");

		held.resolve();
		await tick();
		assertEquals(revision(await reader.loadCatalog()), 2);
		assertEquals(revision(await reader.loadCatalog()), 2);
		assertEquals(source.reads, 4, "one refresh, and the new version holds");
	} finally {
		setSharedKvForTesting(undefined);
	}
});

Deno.test("version key — without KV, a write elsewhere reaches the other isolate when its TTL lapses", async () => {
	setSharedKvForTesting(null);
	try {
		const source = db();
		const writer = await isolate(source);
		const reader = await isolate(source);
		using time = new FakeTime();
		assertEquals(revision(await reader.loadCatalog()), 1);

		source.rev = 2;
		writer.invalidateCatalog();
		assertEquals(revision(await writer.loadCatalog()), 2, "the writer still reads its own write");

		await time.tickAsync(CATALOG_TTL_MS - 1);
		assertEquals(revision(await reader.loadCatalog()), 1, "fresh until its TTL");
		await time.tickAsync(1);
		assertEquals(revision(await reader.loadCatalog()), 1, "expired: served while it refreshes");
		await time.runMicrotasks();
		assertEquals(revision(await reader.loadCatalog()), 2);
		assertEquals(source.reads, 3);
	} finally {
		setSharedKvForTesting(undefined);
	}
});

Deno.test("version key — a hung KV never stalls a read: a load waits its bound, then the TTL governs", async () => {
	setSharedKvForTesting(hungKv());
	try {
		const source = db();
		const reader = await isolate(source);
		using time = new FakeTime();

		const cold = reader.loadCatalog();
		await time.tickAsync(VERSION_WAIT_MS - 1);
		assertEquals(source.reads, 0, "the cold load waits on KV for the version…");
		await time.tickAsync(1);
		assertEquals(revision(await cold), 1, "…for its bound, then reads");

		const cachedRead = reader.loadCatalog();
		assertEquals(await answersAtOnce(cachedRead, time), true, "a cached read never waits on KV");
		assertEquals(revision(await cachedRead), 1);

		source.rev = 2;
		await time.tickAsync(CATALOG_TTL_MS);
		const expiredRead = reader.loadCatalog();
		assertEquals(await answersAtOnce(expiredRead, time), true, "an expired one is served at once");
		assertEquals(revision(await expiredRead), 1);
		await time.tickAsync(VERSION_WAIT_MS);
		await time.runMicrotasks();
		assertEquals(revision(await reader.loadCatalog()), 2, "and the TTL refreshed it");
		assertEquals(source.reads, 2);
	} finally {
		setSharedKvForTesting(undefined);
	}
});

Deno.test("version key — a KV that hangs after a load never stalls a cached read's version check", async () => {
	setSharedKvForTesting(stubKv().kv);
	try {
		const source = db();
		const reader = await isolate(source);
		using time = new FakeTime();
		assertEquals(revision(await reader.loadCatalog()), 1);

		setSharedKvForTesting(hungKv());
		for (const attempt of ["first", "second"]) {
			const read = reader.loadCatalog();
			assertEquals(await answersAtOnce(read, time), true, `the ${attempt} cached read answers`);
		}

		source.rev = 2;
		await time.tickAsync(CATALOG_TTL_MS);
		assertEquals(revision(await reader.loadCatalog()), 1, "expired: served while it refreshes");
		await time.tickAsync(VERSION_WAIT_MS);
		await time.runMicrotasks();
		assertEquals(revision(await reader.loadCatalog()), 2, "the TTL refreshed it past the hung KV");
		assertEquals(source.reads, 2);
	} finally {
		setSharedKvForTesting(undefined);
	}
});
