import { assertEquals } from "@std/assert";
import { RESTRICTED_REFUSAL, type UserContext } from "@projective/types/auth";
import { handler as media } from "../routes/api/catalogue/media.ts";
import { handler as mediaReorder } from "../routes/api/catalogue/media/reorder.ts";
import { handler as batch } from "../routes/api/catalogue/batch.ts";
import { handler as duplicate } from "../routes/api/catalogue/duplicate.ts";
import type { State } from "./state.ts";

/**
 * catalogue-routes_test — the HTTP contract of the catalogue writes added for the item workspace:
 * the showcase (`media`, `media/reorder`), the console's batch bar (`batch`) and `duplicate`. A
 * signed-out caller is a 401 before the body is read, a body the schema refuses is a 422 keyed by
 * field path, and a batch that publishes refuses a restricted (13–17) account at the door.
 *
 * Tokenless throughout, so nothing reaches the database.
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;

const ALICE = { userId: "u-alice", contextType: "personal", contextId: "u-alice" } as UserContext;

async function post(
	handlers: unknown,
	path: string,
	body: unknown,
	state: State = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> {
	const url = new URL(`https://app.example.test${path}`);
	const req = new Request(url, { method: "POST", body: JSON.stringify(body) });
	const res = await (handlers as Record<string, Handler>).POST({ req, url, params: {}, state });
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

const signedIn: State = { userContext: ALICE };
const minor: State = { userContext: { ...ALICE, restricted: true } as UserContext };

const ROUTES: Array<[string, unknown]> = [
	["/api/catalogue/media", media],
	["/api/catalogue/media/reorder", mediaReorder],
	["/api/catalogue/batch", batch],
	["/api/catalogue/duplicate", duplicate],
];
// #endregion

// #region 401
Deno.test("catalogue writes: signed out is a 401 on every new route, whatever the body", async () => {
	for (const [path, handlers] of ROUTES) {
		const { status, body } = await post(handlers, path, { anything: true });
		assertEquals(status, 401, path);
		assertEquals(body, { ok: false, message: "Sign in to manage your catalogue." }, path);
	}
});
// #endregion

// #region 422
Deno.test("catalogue writes: a refused body is a 422 keyed by field path", async () => {
	const cases: Array<[string, unknown, unknown, string[]]> = [
		[
			"/api/catalogue/media",
			media,
			{ listingId: "svc-x", choices: [{ sourceAssetId: "not-a-uuid", position: 9 }] },
			["choices.0.sourceAssetId", "choices.0.position"],
		],
		["/api/catalogue/media/reorder", mediaReorder, { listingId: "svc-x", order: [2, 2] }, [
			"order",
		]],
		["/api/catalogue/batch", batch, { ids: [], action: "status", status: "live" }, [
			"ids",
			"status",
		]],
		["/api/catalogue/duplicate", duplicate, {}, ["id"]],
	];
	for (const [path, handlers, sent, keys] of cases) {
		const { status, body } = await post(handlers, path, sent, signedIn);
		assertEquals(status, 422, path);
		assertEquals(body?.message, "Check the highlighted fields.", path);
		assertEquals(Object.keys(body?.errors as object).sort(), keys.sort(), path);
	}
});

Deno.test("catalogue writes: a body that is not JSON is a 422, not a crash", async () => {
	const url = new URL("https://app.example.test/api/catalogue/duplicate");
	const req = new Request(url, { method: "POST", body: "{not json" });
	const res = await (duplicate as Record<string, Handler>).POST({
		req,
		url,
		params: {},
		state: signedIn,
	});
	assertEquals(res.status, 422);
});
// #endregion

// #region Age gate
Deno.test("catalogue batch: publishing refuses a restricted account before the service", async () => {
	const { status, body } = await post(batch, "/api/catalogue/batch", {
		ids: ["svc-one", "prd-two"],
		action: "status",
		status: "published",
	}, minor);
	assertEquals(status, 403);
	assertEquals(body?.message, RESTRICTED_REFUSAL);
});

Deno.test("catalogue batch: a batch that does not publish is not age-gated", async () => {
	for (const action of [{ action: "status", status: "paused" }, { action: "duplicate" }]) {
		const { status } = await post(
			batch,
			"/api/catalogue/batch",
			{ ids: ["svc-one"], ...action },
			minor,
		);
		// Past the gate, the tokenless service answers 401: proof the gate let it through.
		assertEquals(status, 401, JSON.stringify(action));
	}
});
// #endregion
