import { assertEquals } from "@std/assert";
import type { UserContext } from "@projective/types/auth";
import { EmailsBackendService } from "@server/services/user/EmailsBackendService.ts";
import { handler } from "../routes/api/user/emails/verify.ts";
import { refuseCrossSiteWrite } from "./csrf.ts";

/**
 * `GET | POST /api/user/emails/verify` (PRD-C11): opening the mailed link spends nothing; the
 * person's press of Confirm on `/settings/account` spends it. A spy stands in for the fat service, so
 * every case runs with no network.
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;

const ORIGIN = "https://app.example.test";
const TOKEN = "a".repeat(64);
const ALICE = { userId: "u-alice", contextType: "personal", contextId: "u-alice" } as UserContext;

async function call(method: "GET" | "POST", query = "", body?: unknown): Promise<Response> {
	const url = new URL(`${ORIGIN}/api/user/emails/verify${query}`);
	return await (handler as Record<string, Handler>)[method]({
		req: new Request(url, {
			method,
			body: body === undefined ? undefined : JSON.stringify(body),
			headers: body === undefined ? undefined : { "content-type": "application/json" },
		}),
		url,
		params: {},
		state: { userContext: ALICE, accessToken: "token" },
	});
}

/** Count the service's redemptions while `fn` runs, answering each with `verified`. */
async function countingConfirm(fn: () => Promise<void>): Promise<string[]> {
	const original = EmailsBackendService.confirm;
	const spent: string[] = [];
	EmailsBackendService.confirm = (_actor, token) => {
		spent.push(token);
		return Promise.resolve({
			ok: true,
			status: 200,
			data: { outcome: "verified" as const },
			message: "Your address is confirmed.",
		});
	};
	try {
		await fn();
	} finally {
		EmailsBackendService.confirm = original;
	}
	return spent;
}
// #endregion

// #region Opening the link
Deno.test("email verify: opening the link spends nothing and hands the token to the settings page", async () => {
	let res: Response | null = null;
	const spent = await countingConfirm(async () => {
		res = await call("GET", `?token=${TOKEN}`);
		await call("GET", `?token=${TOKEN}`);
	});
	const opened = res as Response | null;
	assertEquals(spent, []);
	assertEquals(opened?.status, 303);
	assertEquals(opened?.headers.get("location"), `/settings/account?email-token=${TOKEN}#emails`);
	assertEquals(opened?.headers.get("cache-control"), "no-store");
	assertEquals(opened?.headers.get("referrer-policy"), "no-referrer");
});

Deno.test("email verify: a link with no usable token lands on the invalid outcome, unspent", async () => {
	const spent = await countingConfirm(async () => {
		for (const query of ["", "?token=", `?token=${"a".repeat(257)}`]) {
			const res = await call("GET", query);
			assertEquals(res.headers.get("location"), "/settings/account?email=invalid#emails", query);
		}
	});
	assertEquals(spent, []);
});

Deno.test("email verify: the token is carried as one encoded query value", async () => {
	const res = await call("GET", `?token=${encodeURIComponent("a&b=c#d")}`);
	assertEquals(res.headers.get("location"), "/settings/account?email-token=a%26b%3Dc%23d#emails");
});
// #endregion

// #region The press
Deno.test("email verify: the press spends the token once and answers the outcome", async () => {
	let res: Response | null = null;
	const spent = await countingConfirm(async () => {
		res = await call("POST", "", { token: TOKEN });
	});
	const pressed = res as Response | null;
	assertEquals(spent, [TOKEN]);
	assertEquals(pressed?.status, 200);
	const body = await pressed?.json();
	assertEquals(body.ok, true);
	assertEquals(body.outcome, "verified");
});

Deno.test("email verify: a press without a token is a 422 that reaches no service", async () => {
	const spent = await countingConfirm(async () => {
		for (const body of [{}, { token: "" }, { token: 42 }, null]) {
			assertEquals((await call("POST", "", body)).status, 422, JSON.stringify(body));
		}
	});
	assertEquals(spent, []);
});

Deno.test("email verify: a press from another site is refused by the origin guard", () => {
	const req = new Request(`${ORIGIN}/api/user/emails/verify`, {
		method: "POST",
		headers: { origin: "https://evil.example", "content-type": "application/json" },
		body: JSON.stringify({ token: TOKEN }),
	});
	assertEquals(refuseCrossSiteWrite(req)?.status, 403);
});
// #endregion
