import { assert, assertEquals } from "@std/assert";
import { isOnline } from "./network.ts";
import { installOfflineFetchGuard, refuseOfflineWrite } from "./offline-guards.ts";
import { lastWriteRefusal } from "./offline-state.ts";

/**
 * offline-guards_test — the fetch guard, exercised against a stubbed `location` and the shared
 * connectivity signal rather than a browser.
 *
 * The refcount test is the one that earns its keep: a boolean flag would restore the native `fetch`
 * the moment the FIRST installer let go, which under an HMR remount (the new island mounts before
 * the old one unmounts) leaves the page with no guard and no error.
 */

const ORIGIN = "https://app.example.test";

/** Give the module a `location` to read, and take it away again. */
function withLocation<T>(run: () => T): T {
	const g = globalThis as { location?: unknown };
	const had = "location" in g;
	const prev = g.location;
	g.location = { href: `${ORIGIN}/projects`, origin: ORIGIN };
	try {
		return run();
	} finally {
		if (had) g.location = prev;
		else delete g.location;
	}
}

Deno.test("refuseOfflineWrite — online: never refuses, records nothing", () => {
	isOnline.value = true;
	lastWriteRefusal.value = null;
	withLocation(() => {
		assertEquals(refuseOfflineWrite("/api/projects/create", { method: "POST" }), null);
	});
	assertEquals(lastWriteRefusal.value, null);
});

Deno.test("refuseOfflineWrite — offline: refuses a write with the envelope and reports it once", async () => {
	isOnline.value = false;
	lastWriteRefusal.value = null;
	try {
		const res = withLocation(() => refuseOfflineWrite("/api/projects/create", { method: "POST" }));
		assert(res, "a write is refused");
		assertEquals(res.status, 503);
		assertEquals((await res.json()).code, "offline");
		assert(lastWriteRefusal.value, "the refusal is recorded for the notice");

		// A read, a beacon and a cross-origin write all pass straight through.
		withLocation(() => {
			assertEquals(refuseOfflineWrite("/api/projects/list", undefined), null);
			assertEquals(
				refuseOfflineWrite("/api/logs", { method: "POST", keepalive: true }),
				null,
			);
			assertEquals(
				refuseOfflineWrite("https://storage.example.net/u", { method: "PUT" }),
				null,
			);
		});
	} finally {
		isOnline.value = true;
		lastWriteRefusal.value = null;
	}
});

Deno.test("refuseOfflineWrite — without a `location` there is nothing to compare against", () => {
	isOnline.value = false;
	try {
		assertEquals(refuseOfflineWrite("/api/projects/create", { method: "POST" }), null);
	} finally {
		isOnline.value = true;
	}
});

Deno.test("installOfflineFetchGuard — wraps once, refuses offline writes, restores on the last release", async () => {
	const native = globalThis.fetch;
	let calls = 0;
	// A stand-in native fetch that never touches the network.
	globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) => {
		calls += 1;
		return Promise.resolve(new Response("native", { status: 200 }));
	}) as typeof fetch;

	try {
		const releaseA = installOfflineFetchGuard();
		const wrapped = globalThis.fetch;
		const releaseB = installOfflineFetchGuard();
		assertEquals(globalThis.fetch, wrapped, "a second installer shares the one wrapper");

		isOnline.value = false;
		const refused = await withLocation(() =>
			globalThis.fetch("/api/projects/create", { method: "POST" })
		);
		assertEquals(refused.status, 503, "the write is answered locally");
		assertEquals(calls, 0, "…and the native fetch never saw it");

		const read = await withLocation(() => globalThis.fetch("/api/projects/list"));
		assertEquals(await read.text(), "native", "a read passes through");
		assertEquals(calls, 1);

		isOnline.value = true;
		const sent = await withLocation(() =>
			globalThis.fetch("/api/projects/create", { method: "POST" })
		);
		assertEquals(await sent.text(), "native", "online, the write is sent");

		releaseA();
		assertEquals(globalThis.fetch, wrapped, "the first release keeps the wrapper for the second");
		releaseB();
		assertEquals(calls, 2);
		assert(globalThis.fetch !== wrapped, "the last release restores the native function");
		releaseB();
		releaseA();
	} finally {
		isOnline.value = true;
		lastWriteRefusal.value = null;
		globalThis.fetch = native;
	}
});
