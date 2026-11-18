import { assertEquals } from "@std/assert";
import { RESTRICTED_REFUSAL, type UserContext } from "@projective/types/auth";
import { handler as promotion } from "../routes/api/catalogue/promotion.ts";
import type { State } from "./state.ts";

/**
 * catalogue-promotion-routes_test — the HTTP contract of `/api/catalogue/promotion` (Decision #454):
 * a signed-out caller is a 401 on every verb, a missing id a 400, a refused body a 422 keyed by field,
 * and a restricted (13–17) account is refused at the door before anything is promoted. Tokenless
 * throughout, so nothing reaches the database; the entitlement refusal is the probe's
 * (`supabase/probes/promoted_placements.sql`).
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;
type Verb = "GET" | "POST" | "DELETE";

const ALICE = { userId: "u-alice", contextType: "personal", contextId: "u-alice" } as UserContext;
const signedIn: State = { userContext: ALICE };
const minor: State = { userContext: { ...ALICE, restricted: true } as UserContext };

async function call(
	verb: Verb,
	path: string,
	state: State = {},
	body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
	const url = new URL(`https://app.example.test${path}`);
	const req = new Request(url, {
		method: verb,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const res = await (promotion as Record<string, Handler>)[verb]({ req, url, params: {}, state });
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}
// #endregion

Deno.test("promotion route: signed out is a 401 on every verb", async () => {
	for (const verb of ["GET", "POST", "DELETE"] as const) {
		const body = verb === "POST" ? { id: "svc-x", surface: "explore_home" } : undefined;
		const { status } = await call(verb, "/api/catalogue/promotion?id=svc-x", {}, body);
		assertEquals(status, 401, verb);
	}
});

Deno.test("promotion route: a read or a stop without an id is a 400", async () => {
	for (const verb of ["GET", "DELETE"] as const) {
		assertEquals((await call(verb, "/api/catalogue/promotion", signedIn)).status, 400, verb);
	}
});

Deno.test("promotion route: a surface the doors do not sell is a 422 keyed by field", async () => {
	for (const surface of ["view_rail", "sidebar", null]) {
		const { status, body } = await call("POST", "/api/catalogue/promotion", signedIn, {
			id: "svc-x",
			surface,
		});
		assertEquals(status, 422, String(surface));
		assertEquals(Object.keys(body?.errors as object), ["surface"], String(surface));
	}
});

Deno.test("promotion route: a restricted account cannot promote", async () => {
	const { status, body } = await call("POST", "/api/catalogue/promotion", minor, {
		id: "svc-x",
		surface: "explore_home",
	});
	assertEquals(status, 403);
	assertEquals(body?.message, RESTRICTED_REFUSAL);
});
