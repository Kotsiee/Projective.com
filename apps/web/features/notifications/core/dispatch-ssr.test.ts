import { assertEquals } from "@std/assert";
import type { DispatchTally } from "@projective/types/comms";
import { ok } from "@server/services/ServiceResult.ts";
import {
	answerDigestSweep,
	answerDispatch,
	answerDispatchSweep,
	type DigestDoorDeps,
	type DispatchDoorDeps,
} from "./dispatch-ssr.ts";

/** The dispatcher's two doors: a wrong bearer is a 404 before anything is read; the right one, 200 and a count. */

const SECRET = "s".repeat(40);
const NOTIFICATION = "6f3d2b0a-1c4e-4d8a-9b7f-0a1b2c3d4e5f";
const TALLY: DispatchTally = { claimed: 2, sent: 1, failed: 0, skipped: 1, suppressed: 0 };

function door(): DispatchDoorDeps & { calls: [string | null, number][] } {
	const calls: [string | null, number][] = [];
	return {
		calls,
		isAuthorised: (authorization) => authorization === `Bearer ${SECRET}`,
		dispatch: (notificationId, limit = 200) => {
			calls.push([notificationId, limit]);
			return Promise.resolve(ok(TALLY));
		},
	};
}

function post(path: string, bearer: string | null, body?: unknown): Request {
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (bearer) headers.authorization = `Bearer ${bearer}`;
	return new Request(`http://localhost:3000${path}`, {
		method: "POST",
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

Deno.test("POST /api/comms/dispatch — a wrong or missing bearer is a 404 and dispatches nothing", async () => {
	for (const bearer of [null, "t".repeat(40), "XXXX-XXXX"]) {
		const deps = door();
		const res = await answerDispatch(
			post("/api/comms/dispatch", bearer, { notification_id: NOTIFICATION }),
			deps,
		);
		assertEquals(res.status, 404, String(bearer));
		assertEquals(await res.text(), "");
		assertEquals(deps.calls.length, 0);
	}
});

Deno.test("POST /api/comms/dispatch — the right bearer: 200 with the counts, for that notification", async () => {
	const deps = door();
	const res = await answerDispatch(
		post("/api/comms/dispatch", SECRET, { notification_id: NOTIFICATION }),
		deps,
	);
	assertEquals(res.status, 200);
	const body = await res.json();
	assertEquals([body.ok, body.claimed, body.sent, body.skipped], [true, 2, 1, 1]);
	assertEquals(deps.calls, [[NOTIFICATION, 200]]);
});

Deno.test("POST /api/comms/dispatch — any body but { notification_id: uuid } is a 422", async () => {
	for (
		const body of [undefined, {}, { notification_id: "not-a-uuid" }, {
			notification_id: NOTIFICATION,
			user_id: NOTIFICATION,
		}]
	) {
		const deps = door();
		const res = await answerDispatch(post("/api/comms/dispatch", SECRET, body), deps);
		assertEquals(res.status, 422, JSON.stringify(body));
		assertEquals(deps.calls.length, 0);
	}
});

Deno.test("POST /api/comms/cron/dispatch — 404 without the bearer; with it, one bounded pass over everything due", async () => {
	const url = (q: string) => new URL(`http://localhost:3000/api/comms/cron/dispatch${q}`);
	const denied = door();
	assertEquals(
		(await answerDispatchSweep(post("/api/comms/cron/dispatch", null), url("?limit=200"), denied))
			.status,
		404,
	);
	assertEquals(denied.calls.length, 0);

	const deps = door();
	const res = await answerDispatchSweep(
		post("/api/comms/cron/dispatch", SECRET),
		url("?limit=200"),
		deps,
	);
	assertEquals(res.status, 200);
	assertEquals((await res.json()).claimed, 2);
	await answerDispatchSweep(post("/api/comms/cron/dispatch", SECRET), url("?limit=99999"), deps);
	await answerDispatchSweep(post("/api/comms/cron/dispatch", SECRET), url("?limit=nope"), deps);
	assertEquals(deps.calls, [[null, 200], [null, 500], [null, 200]]);
});

Deno.test("POST /api/comms/cron/digests — 404 without the bearer; with it, one pass bounded to 1–500, default 50", async () => {
	const url = (q: string) => new URL(`http://localhost:3000/api/comms/cron/digests${q}`);
	const calls: number[] = [];
	const deps: DigestDoorDeps = {
		isAuthorised: (authorization) => authorization === `Bearer ${SECRET}`,
		send: (limit) => {
			calls.push(limit);
			return Promise.resolve(ok(TALLY));
		},
	};
	for (const bearer of [null, "t".repeat(40), "XXXX-XXXX"]) {
		const res = await answerDigestSweep(
			post("/api/comms/cron/digests", bearer),
			url("?limit=50"),
			deps,
		);
		assertEquals(res.status, 404, String(bearer));
	}
	assertEquals(calls.length, 0);

	const res = await answerDigestSweep(
		post("/api/comms/cron/digests", SECRET),
		url("?limit=50"),
		deps,
	);
	assertEquals(res.status, 200);
	assertEquals((await res.json()).sent, 1);
	await answerDigestSweep(post("/api/comms/cron/digests", SECRET), url("?limit=99999"), deps);
	await answerDigestSweep(post("/api/comms/cron/digests", SECRET), url(""), deps);
	assertEquals(calls, [50, 500, 50]);
});
