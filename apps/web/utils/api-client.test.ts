import { assertEquals } from "@std/assert";
import { apiFetch } from "./api-client.ts";

/**
 * api-client_test — the 401 → refresh → retry interceptor against a scripted `fetch` and a fake
 * `location`. The case that matters: a refresh the server could not ANSWER (503) must not send the
 * reader to `/login`, because their session may be perfectly good.
 */

// #region Harness
interface Scene {
	status: number;
	navigatedTo: string | null;
	calls: string[];
}

async function scene(refreshStatus: number, retryStatus = 200): Promise<Scene> {
	const g = globalThis as { location?: unknown };
	const hadLocation = "location" in g;
	const prevLocation = g.location;
	const realFetch = globalThis.fetch;
	const calls: string[] = [];
	let navigatedTo: string | null = null;
	let dataCalls = 0;

	g.location = {
		pathname: "/projects",
		search: "?tab=board",
		set href(value: string) {
			navigatedTo = value;
		},
	};
	globalThis.fetch = (input: string | URL | Request) => {
		const path = String(input);
		calls.push(path);
		if (path === "/api/auth/refresh") {
			return Promise.resolve(new Response(null, { status: refreshStatus }));
		}
		dataCalls += 1;
		return Promise.resolve(new Response(null, { status: dataCalls === 1 ? 401 : retryStatus }));
	};
	try {
		const res = await apiFetch("/api/projects/list");
		return { status: res.status, navigatedTo, calls };
	} finally {
		globalThis.fetch = realFetch;
		if (hadLocation) g.location = prevLocation;
		else delete g.location;
	}
}
// #endregion

Deno.test("apiFetch: a renewed session retries the original request", async () => {
	const { status, navigatedTo, calls } = await scene(200);
	assertEquals(status, 200);
	assertEquals(navigatedTo, null);
	assertEquals(calls, ["/api/projects/list", "/api/auth/refresh", "/api/projects/list"]);
});

Deno.test("apiFetch: a refused refresh routes to sign-in with the return path", async () => {
	const { status, navigatedTo } = await scene(401);
	assertEquals(status, 401);
	assertEquals(navigatedTo, `/login?redirectTo=${encodeURIComponent("/projects?tab=board")}`);
});

Deno.test("apiFetch: an unavailable refresh keeps the reader where they are", async () => {
	const { status, navigatedTo, calls } = await scene(503);
	assertEquals(status, 401);
	assertEquals(navigatedTo, null);
	assertEquals(calls, ["/api/projects/list", "/api/auth/refresh"]);
});
