import { assertEquals } from "@std/assert";
import type { UserContext } from "@projective/types/auth";
import { handler as analytics } from "../routes/api/catalogue/analytics.ts";
import { handler as clients } from "../routes/api/catalogue/clients/index.ts";
import { handler as client } from "../routes/api/catalogue/clients/[handle].ts";
import { clientKeyFromPath, parseReadQuery } from "@features/catalogue/core/read-query.ts";
import type { State } from "./state.ts";

/**
 * catalogue-read-routes_test — the HTTP contract of the catalogue's Analytics and Clients reads: a
 * signed-out caller is a 401 before anything is parsed, and a scope, period, listing or handle the
 * schemas refuse is a 422 keyed by parameter. Tokenless, so nothing reaches the database.
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;

const ALICE = { userId: "u-alice", contextType: "personal", contextId: "u-alice" } as UserContext;

async function get(
	handlers: unknown,
	path: string,
	state: State = {},
	params: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> {
	const url = new URL(`https://app.example.test${path}`);
	const req = new Request(url);
	const res = await (handlers as Record<string, Handler>).GET({ req, url, params, state });
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

const signedIn: State = { userContext: ALICE };
// #endregion

Deno.test("catalogue reads: signed out is a 401 on every route", async () => {
	for (
		const [path, handlers, params] of [
			["/api/catalogue/analytics", analytics, {}],
			["/api/catalogue/clients", clients, {}],
			["/api/catalogue/clients/ada_lin", client, { handle: "ada_lin" }],
		] as const
	) {
		const { status, body } = await get(handlers, path, {}, params);
		assertEquals(status, 401, path);
		assertEquals(body, { ok: false, message: "Sign in to manage your catalogue." }, path);
	}
});

Deno.test("catalogue reads: refused parameters are a 422 keyed by name", async () => {
	const bad = await get(
		analytics,
		"/api/catalogue/analytics?scope=listing:svc-x&period=1y&listing=prj-abc",
		signedIn,
	);
	assertEquals(bad.status, 422);
	assertEquals(Object.keys(bad.body?.errors as object).sort(), ["listing", "period", "scope"]);

	const board = await get(clients, "/api/catalogue/clients?scope=model:cohort", signedIn);
	assertEquals([board.status, Object.keys(board.body?.errors as object)], [422, ["scope"]]);

	const handle = await get(client, "/api/catalogue/clients/Not%20A%20Handle", signedIn, {
		handle: "Not%20A%20Handle",
	});
	assertEquals([handle.status, Object.keys(handle.body?.errors as object)], [422, ["handle"]]);
});

Deno.test("the read query defaults absent values and keeps the dev axis", () => {
	const parsed = parseReadQuery(new URLSearchParams("sim=sparse"));
	assertEquals(parsed, {
		ok: true,
		query: { listing: undefined, scope: "all", period: "30d", sim: "sparse" },
	});
	const scoped = parseReadQuery(
		new URLSearchParams("listing=svc-23456789ab&scope=collection:starter-kits&period=12m"),
	);
	assertEquals(scoped.ok && scoped.query.scope, "collection:starter-kits");
});

Deno.test("a path handle carries no @ and must be a client key", () => {
	assertEquals(clientKeyFromPath("ada_lin"), "@ada_lin");
	assertEquals(clientKeyFromPath("%40ada_lin"), "@ada_lin");
	assertEquals(clientKeyFromPath("x"), null);
	assertEquals(clientKeyFromPath(undefined), null);
});
