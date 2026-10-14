import { assertEquals } from "@std/assert";
import { RESTRICTED_REFUSAL, type UserContext } from "@projective/types/auth";
import { handler as presets } from "../routes/api/scheduling/presets/index.ts";
import { handler as archive } from "../routes/api/scheduling/presets/archive.ts";
import { handler as availability } from "../routes/api/catalogue/availability.ts";
import { handler as horizon } from "../routes/api/scheduling/cron/horizon.ts";
import type { State } from "./state.ts";

/**
 * scheduling-preset-routes_test — the HTTP contract of the availability-preset routes (Decision
 * #217): a restricted (13–17) account is refused at every one before anything else (Decision #208),
 * a signed-out caller is a 401, a body the schema refuses is a 422 keyed by field path, and the
 * horizon cron answers 404 to anything but its bearer.
 *
 * Tokenless throughout, so nothing reaches the database.
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;

const ALICE = { userId: "u-alice", contextType: "personal", contextId: "u-alice" } as UserContext;
const signedIn: State = { userContext: ALICE };
const minor: State = { userContext: { ...ALICE, restricted: true } as UserContext };

async function call(
	handlers: unknown,
	method: string,
	path: string,
	options: { body?: unknown; state?: State; headers?: HeadersInit } = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> {
	const url = new URL(`https://app.example.test${path}`);
	const req = new Request(url, {
		method,
		headers: options.headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const res = await (handlers as Record<string, Handler>)[method]({
		req,
		url,
		params: {},
		state: options.state ?? {},
	});
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

const ROUTES: Array<[string, unknown, string]> = [
	["/api/scheduling/presets", presets, "GET"],
	["/api/scheduling/presets", presets, "PUT"],
	["/api/scheduling/presets/archive", archive, "POST"],
	["/api/catalogue/availability", availability, "POST"],
];
// #endregion

// #region Minors
Deno.test("preset routes: a restricted account is refused first, whatever the body", async () => {
	for (const [path, handlers, method] of ROUTES) {
		const { status, body } = await call(handlers, method, path, {
			body: method === "GET" ? undefined : { anything: true },
			state: minor,
		});
		assertEquals(status, 403, `${method} ${path}`);
		assertEquals(body?.message, RESTRICTED_REFUSAL, `${method} ${path}`);
	}
});
// #endregion

// #region 401
Deno.test("preset routes: signed out is a 401 on every route", async () => {
	for (const [path, handlers, method] of ROUTES) {
		const { status } = await call(handlers, method, path, {
			body: method === "GET" ? undefined : { anything: true },
		});
		assertEquals(status, 401, `${method} ${path}`);
	}
});
// #endregion

// #region 422
Deno.test("preset routes: a refused body is a 422 keyed by field path", async () => {
	const cases: Array<[string, unknown, string, unknown, string[]]> = [
		[
			"/api/scheduling/presets",
			presets,
			"PUT",
			{ name: "", timezone: "Europe/London", rules: [] },
			["name"],
		],
		["/api/scheduling/presets/archive", archive, "POST", {}, ["id"]],
		[
			"/api/catalogue/availability",
			availability,
			"POST",
			{ listingId: "svc-x", mode: "preset", presetId: null },
			["presetId"],
		],
	];
	for (const [path, handlers, method, body, keys] of cases) {
		const res = await call(handlers, method, path, { body, state: signedIn });
		assertEquals(res.status, 422, path);
		assertEquals(Object.keys(res.body?.errors as object).sort(), keys.sort(), path);
	}
});

Deno.test("preset routes: a rule whose recurrence RRULE cannot express is a 422 on that rule", async () => {
	const res = await call(presets, "PUT", "/api/scheduling/presets", {
		state: signedIn,
		body: {
			name: "Weekdays",
			timezone: "Europe/London",
			rules: [{
				id: "rule-1",
				layer: "working_hours",
				effect: "add",
				pattern: { type: "weekly", days: [1], interval: 1 },
				condition: { unlessWeekdays: [4] },
				bands: [{ start: 540, end: 1020 }],
				startsOn: "2026-01-05",
				endsOn: null,
			}],
		},
	});
	assertEquals(res.status, 422);
	assertEquals(Object.keys(res.body?.errors as object), ["rules.0.condition"]);
});
// #endregion

// #region Cron
Deno.test("horizon cron: no bearer, or the wrong one, is a 404", async () => {
	for (
		const headers of [{}, {
			authorization: "Bearer not-the-secret-not-the-secret-123",
		}] as HeadersInit[]
	) {
		const { status, body } = await call(horizon, "POST", "/api/scheduling/cron/horizon", {
			headers,
		});
		assertEquals(status, 404);
		assertEquals(body, null);
	}
});
// #endregion
