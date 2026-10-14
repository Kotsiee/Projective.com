import { assertEquals } from "@std/assert";
import type { UserContext } from "@projective/types/auth";
import { handler as update } from "../routes/api/catalogue/update.ts";
import { handler as mediaSave } from "../routes/api/catalogue/media/save.ts";
import { handler as skills } from "../routes/api/catalogue/skills.ts";
import { handler as suggestTags } from "../routes/api/search/suggest-tags.ts";
import type { State } from "./state.ts";

/**
 * catalogue-workspace-routes_test — the HTTP contract of the routes the item workspace adds or
 * changes: the autosave (`update`, which also takes a beacon's `text/plain` body), the
 * whole-showcase save (`media/save`), the skills typeahead and the tag suggestions. Tokenless
 * throughout, so nothing reaches the database: a body that passes its schema stops at the service's
 * own 401.
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;

const ALICE = { userId: "u-alice", contextType: "personal", contextId: "u-alice" } as UserContext;
const signedIn: State = { userContext: ALICE };

async function call(
	handlers: unknown,
	method: "GET" | "POST",
	path: string,
	init: { body?: string; type?: string; state?: State } = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> {
	const url = new URL(`https://app.example.test${path}`);
	const headers = init.type ? { "content-type": init.type } : undefined;
	const req = new Request(url, { method, body: init.body, headers });
	const res = await (handlers as Record<string, Handler>)[method]({
		req,
		url,
		params: {},
		state: init.state ?? {},
	});
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

const PATCH = {
	id: "svc-23456789ab",
	expectedUpdatedAt: "2026-10-14T09:00:00.000Z",
	title: "Logo",
};
// #endregion

// #region update
Deno.test("update: signed out is a 401 before the body is read", async () => {
	const { status } = await call(update, "POST", "/api/catalogue/update", {
		body: JSON.stringify(PATCH),
	});
	assertEquals(status, 401);
});

Deno.test("update: a beacon's text/plain body is parsed as JSON", async () => {
	const refused = await call(update, "POST", "/api/catalogue/update", {
		body: JSON.stringify({ ...PATCH, title: "" }),
		type: "text/plain;charset=UTF-8",
		state: signedIn,
	});
	assertEquals(refused.status, 422);
	assertEquals(Object.keys(refused.body?.errors as object), ["title"]);

	const accepted = await call(update, "POST", "/api/catalogue/update", {
		body: JSON.stringify(PATCH),
		type: "text/plain;charset=UTF-8",
		state: signedIn,
	});
	assertEquals(accepted.status, 401);
	assertEquals(accepted.body?.message, "Sign in to manage your catalogue.");
});

Deno.test("update: a body that is not JSON is a 422, not a crash", async () => {
	const { status } = await call(update, "POST", "/api/catalogue/update", {
		body: "{not json",
		type: "text/plain",
		state: signedIn,
	});
	assertEquals(status, 422);
});
// #endregion

// #region media/save
Deno.test("media/save: signed out is a 401; a repeated file is a 422 keyed by path", async () => {
	const fileId = crypto.randomUUID();
	const body = JSON.stringify({
		listingId: "svc-23456789ab",
		slots: [{ position: 1, fileId, alt: "" }, { position: 2, fileId, alt: "" }],
	});
	assertEquals((await call(mediaSave, "POST", "/api/catalogue/media/save", { body })).status, 401);
	const refused = await call(mediaSave, "POST", "/api/catalogue/media/save", {
		body,
		state: signedIn,
	});
	assertEquals(refused.status, 422);
	assertEquals(Object.keys(refused.body?.errors as object), ["slots.1.fileId"]);
});
// #endregion

// #region Typeaheads
Deno.test("skills: signed out is a 401", async () => {
	assertEquals((await call(skills, "GET", "/api/catalogue/skills?q=des")).status, 401);
});

Deno.test("suggest-tags: nothing typed, or more than a tag, is a 422", async () => {
	assertEquals((await call(suggestTags, "GET", "/api/search/suggest-tags?q=")).status, 422);
	const long = "x".repeat(41);
	assertEquals((await call(suggestTags, "GET", `/api/search/suggest-tags?q=${long}`)).status, 422);
});
// #endregion
