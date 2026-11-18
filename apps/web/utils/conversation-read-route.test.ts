import { assert, assertEquals } from "@std/assert";
import type { UserContext } from "@projective/types/auth";
import { handler } from "../routes/api/messaging/conversations/[id]/read.ts";
import { refuseCrossSiteWrite } from "./csrf.ts";
import type { State } from "./state.ts";

/**
 * `POST /api/messaging/conversations/[id]/read` (PRD-C11, CAS M10): the read mark's one door. A
 * person's POST from this site's own page marks the thread; nothing else does. The live 404 for a
 * conversation the caller is not in needs the database and is checked against the seeded personas;
 * everything here runs on the fixture backend, with no network.
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;

const ORIGIN = "https://app.example.test";
const ALICE = { userId: "u-alice", contextType: "personal", contextId: "u-alice" } as UserContext;
const signedIn: State = { userContext: ALICE };

async function post(id: string, state: State = {}): Promise<Response> {
	const url = new URL(`${ORIGIN}/api/messaging/conversations/${encodeURIComponent(id)}/read`);
	return await (handler as Record<string, Handler>).POST({
		req: new Request(url, { method: "POST" }),
		url,
		params: { id },
		state,
	});
}

/** Run `fn` with `vars` applied, restoring the previous environment afterwards. */
async function withEnv(
	vars: Record<string, string | undefined>,
	fn: () => Promise<void>,
): Promise<void> {
	const prior = new Map<string, string | undefined>();
	for (const key of Object.keys(vars)) prior.set(key, Deno.env.get(key));
	try {
		for (const [key, value] of Object.entries(vars)) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
		await fn();
	} finally {
		for (const [key, value] of prior) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
	}
}

const LIVE = {
	SUPABASE_URL: "https://example.supabase.co",
	SUPABASE_ANON_KEY: "anon-key",
	USE_MOCKS: "false",
	VITE_USE_MOCKS: undefined,
	MESSAGING_BACKEND_LIVE: "true",
};
const FIXTURES = { ...LIVE, MESSAGING_BACKEND_LIVE: "false" };
// #endregion

// #region The route
Deno.test("conversation read: a GET is not a verb this route answers", () => {
	const verbs = Object.keys(handler as object);
	assertEquals(verbs, ["POST"]);
});

Deno.test("conversation read: signed out is a 401", async () => {
	const res = await post("dm-mara");
	assertEquals(res.status, 401);
	assertEquals((await res.json()).ok, false);
});

Deno.test("conversation read: an id no conversation can have is a 404 before any service runs", async () => {
	for (const id of ["", " dm-mara", "dm mara", "../x", "a".repeat(121)]) {
		assertEquals((await post(id, signedIn)).status, 404, JSON.stringify(id));
	}
});

Deno.test("conversation read: a mark is a bodiless, uncacheable 204, and repeating it is too", async () => {
	await withEnv(FIXTURES, async () => {
		for (let i = 0; i < 2; i++) {
			const res = await post("dm-mara", signedIn);
			assertEquals(res.status, 204);
			assertEquals(await res.text(), "");
			assertEquals(res.headers.get("cache-control"), "no-store");
		}
	});
});

Deno.test("conversation read: on the live backend a caller with no token is refused, not marked", async () => {
	await withEnv(LIVE, async () => {
		assertEquals((await post("dm-mara", signedIn)).status, 401);
	});
});
// #endregion

// #region The origin guard in front of it
const PATH = `${ORIGIN}/api/messaging/conversations/dm-mara/read`;

Deno.test("conversation read: a cross-site POST is refused with a 403", () => {
	const crossSite = new Request(PATH, {
		method: "POST",
		headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
	});
	assertEquals(refuseCrossSiteWrite(crossSite)?.status, 403);
	const noOrigin = new Request(PATH, {
		method: "POST",
		headers: { "sec-fetch-site": "cross-site" },
	});
	assertEquals(refuseCrossSiteWrite(noOrigin)?.status, 403);
});

Deno.test("conversation read: the page's own bodiless POST passes the guard", () => {
	const own = new Request(PATH, {
		method: "POST",
		headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "x-pj-background": "1" },
	});
	assert(refuseCrossSiteWrite(own) === null);
});
// #endregion
