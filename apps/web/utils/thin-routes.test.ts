import { assertEquals } from "@std/assert";
import type { UserContext } from "@projective/types/auth";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import { handler as projectById } from "../routes/api/projects/[id].ts";
import { handler as projectSetup } from "../routes/api/projects/setup.ts";
import { handler as projectCreate } from "../routes/api/projects/create.ts";
import { handler as filesList } from "../routes/api/files/list.ts";
import { handler as authJoin } from "../routes/api/auth/join.ts";
import { handler as walletAction } from "../routes/api/wallet/action.ts";
import type { State } from "./state.ts";

/**
 * thin-routes_test — the HTTP contract of the `/api/*` routes that delegate parsing, eligibility and
 * dispatch to a schema or a fat service. Each case pins a status + envelope a caller depends on, so
 * moving logic between the route and the service cannot change what goes over the wire.
 *
 * Everything runs tokenless, so every service answers from its stub branch.
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;

const ALICE = { userId: "u-alice", contextType: "personal", contextId: "u-alice" } as UserContext;

async function call(
	handlers: unknown,
	method: string,
	path: string,
	init: { body?: unknown; params?: Record<string, string>; state?: State } = {},
): Promise<{ status: number; body: Record<string, unknown> | null; res: Response }> {
	const url = new URL(`https://app.example.test${path}`);
	const req = new Request(url, {
		method,
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});
	const fn = (handlers as Record<string, Handler>)[method];
	const res = await fn({ req, url, params: init.params ?? {}, state: init.state ?? {} });
	const text = res.status === 204 ? "" : await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null, res };
}

const signedIn: State = { userContext: ALICE };
// #endregion

// #region /api/projects/:id + /api/projects/setup
Deno.test("projects/:id: a signed-out write is a 401 on every verb", async () => {
	for (const method of ["PUT", "PATCH", "DELETE"]) {
		const { status, body } = await call(projectById, method, "/api/projects/prj-x", {
			body: {},
			params: { id: "prj-x" },
		});
		assertEquals(status, 401, method);
		assertEquals(body, { ok: false, message: "Sign in to change this project." });
	}
});

Deno.test("projects/:id: a malformed edit is a field-keyed 422", async () => {
	const { status, body } = await call(projectById, "PATCH", "/api/projects/prj-x?sim=bogus", {
		body: { title: 42 },
		params: { id: "prj-x" },
		state: signedIn,
	});
	assertEquals(status, 422);
	assertEquals(body?.message, "Check the highlighted fields.");
	assertEquals(Object.keys(body?.errors as object), ["title"]);
});

Deno.test("projects/:id: an unknown sim value is dropped, not refused", async () => {
	const { status } = await call(projectById, "PATCH", "/api/projects/prj-none?sim=bogus", {
		body: { title: "Renamed" },
		params: { id: "prj-none" },
		state: signedIn,
	});
	assertEquals(status, 404);
});

Deno.test("projects/:id: OPTIONS advertises the write verbs only", async () => {
	const { status, res } = await call(projectById, "OPTIONS", "/api/projects/prj-x");
	assertEquals(status, 204);
	assertEquals(res.headers.get("Allow"), "PUT, PATCH, DELETE, OPTIONS");
});

Deno.test("projects/setup: a missing slug is a 400; an unknown sim is ignored", async () => {
	assertEquals((await call(projectSetup, "GET", "/api/projects/setup")).status, 400);
	assertEquals(
		(await call(projectSetup, "GET", "/api/projects/setup?slug=prj-none&sim=bogus")).status,
		404,
	);
});
// #endregion

// #region /api/projects/create
Deno.test("projects/create: 401 signed out, 422 keyed by control when malformed", async () => {
	assertEquals((await call(projectCreate, "POST", "/api/projects/create", { body: {} })).status, 401);
	const { status, body } = await call(projectCreate, "POST", "/api/projects/create", {
		body: { title: "Long enough title", format: "pipeline", currency: "Dollars" },
		state: signedIn,
	});
	assertEquals(status, 422);
	assertEquals(Object.keys(body?.errors as object), ["currency"]);
});

Deno.test("projects/create: an offered currency wins; an unoffered one falls back to the site currency", async () => {
	const state = (display: string): State => ({
		...signedIn,
		currency: { displayCurrency: display, locale: "en-GB", table: {} as never },
	});
	const currencyOf = async (sent: string, display: string) => {
		const { status, body } = await call(projectCreate, "POST", "/api/projects/create", {
			body: { title: `Currency ${sent}`, format: "pipeline", currency: sent },
			state: state(display),
		});
		assertEquals(status, 201);
		const slug = (body?.data as { slug: string }).slug;
		const read = await ProjectBackendService.setup(slug, {
			userId: "u-alice",
			contextType: "personal",
			contextId: "u-alice",
		});
		return read.data?.setup.budget.currency;
	};
	assertEquals(await currencyOf("EUR", "GBP"), "EUR");
	assertEquals(await currencyOf("ZZZ", "CAD"), "CAD");
	assertEquals(await currencyOf("ZZZ", "XXX"), "GBP");
});
// #endregion

// #region /api/files/list
Deno.test("files/list: a missing or unknown scope is the scope 400", async () => {
	for (const q of ["", "?scope=nope"]) {
		const { status, body } = await call(filesList, "GET", `/api/files/list${q}`);
		assertEquals(status, 400);
		assertEquals(body?.message, "Missing or unknown scope.");
	}
});

Deno.test("files/list: unknown filter values are dropped; an out-of-range one is refused", async () => {
	const dropped = await call(
		filesList,
		"GET",
		"/api/files/list?scope=hub&sort=nope&dir=up&kinds=nope,,&sources=x&visibility=y&limit=abc&cursor=",
	);
	assertEquals(dropped.status, 401);
	const refused = await call(filesList, "GET", "/api/files/list?scope=hub&limit=500");
	assertEquals(refused.status, 400);
	assertEquals(refused.body?.message, "That file query is not valid.");
});
// #endregion

// #region /api/auth/join
const INDIVIDUAL = {
	type: "individual",
	intent: "client",
	email: "kid@example.test",
	password: "long-enough",
	firstName: "Kid",
	lastName: "Example",
	username: "kidexample",
	dob: "2000-01-01",
};

Deno.test("auth/join: no body is a 400; a malformed one a 422", async () => {
	assertEquals((await call(authJoin, "POST", "/api/auth/join")).status, 400);
	assertEquals(
		(await call(authJoin, "POST", "/api/auth/join", { body: { type: "individual" } })).status,
		422,
	);
});

Deno.test("auth/join: the age gate and the password rule are enforced server-side", async () => {
	const young = new Date();
	young.setFullYear(young.getFullYear() - 10);
	const tooYoung = await call(authJoin, "POST", "/api/auth/join", {
		body: { ...INDIVIDUAL, dob: young.toISOString().slice(0, 10) },
	});
	assertEquals(tooYoung.status, 422);
	assertEquals(tooYoung.body, {
		ok: false,
		errors: { dob: "You need to be at least 13 to join Projective." },
	});

	const noPassword = await call(authJoin, "POST", "/api/auth/join", {
		body: { ...INDIVIDUAL, password: "short" },
	});
	assertEquals(noPassword.status, 422);
	assertEquals(noPassword.body, { ok: false, errors: { password: "Use at least 8 characters." } });

	const oauth = await call(authJoin, "POST", "/api/auth/join", {
		body: { ...INDIVIDUAL, password: undefined, oauth: true },
	});
	assertEquals(oauth.status, 200);
});
// #endregion

// #region /api/wallet/action
Deno.test("wallet/action: a missing action is a 400 before identity is checked", async () => {
	for (const body of [undefined, {}, { action: 5 }]) {
		const res = await call(walletAction, "POST", "/api/wallet/action", { body });
		assertEquals(res.status, 400);
		assertEquals(res.body?.message, "Missing action.");
	}
});

Deno.test("wallet/action: signed out is a 401, even for an unknown action", async () => {
	for (const action of ["top_up", "nope"]) {
		const res = await call(walletAction, "POST", "/api/wallet/action", { body: { action } });
		assertEquals(res.status, 401, action);
	}
});

Deno.test("wallet/action: an unknown action is a 400; a malformed known one a field-keyed 422", async () => {
	const unknown = await call(walletAction, "POST", "/api/wallet/action", {
		body: { action: "nope" },
		state: signedIn,
	});
	assertEquals(unknown.status, 400);
	assertEquals(unknown.body?.message, "Unknown action.");

	const malformed = await call(walletAction, "POST", "/api/wallet/action", {
		body: { action: "spend_decision", scope: "personal", contextId: "u-alice", approvalId: "a" },
		state: signedIn,
	});
	assertEquals(malformed.status, 422);
	assertEquals(malformed.body?.errors, { decision: "Invalid option: expected one of \"approve\"|\"reject\"" });
});
// #endregion
