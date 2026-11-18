import { assertEquals } from "@std/assert";
import { currentLegalVersions } from "@projective/types/legal";
import { LegalAcceptanceBackendService } from "./LegalAcceptanceBackendService.ts";

interface FakeCall {
	path: string;
	body: Record<string, unknown> | null;
	authorization: string | null;
}

type FakeAnswer = { status?: number; json: unknown };

const LIVE_ENV: Record<string, string> = {
	USE_MOCKS: "false",
	AUTH_BACKEND_LIVE: "true",
	SUPABASE_URL: "http://supabase.fake",
	SUPABASE_ANON_KEY: "XXXX-XXXX",
	SUPABASE_SERVICE_ROLE_KEY: "XXXX-XXXX",
};

const TOKEN = "person-access-token";

async function withFake(
	answer: FakeAnswer,
	body: (calls: FakeCall[]) => Promise<void>,
): Promise<void> {
	const calls: FakeCall[] = [];
	const realFetch = globalThis.fetch;
	const saved = Object.keys(LIVE_ENV).map((key) => [key, Deno.env.get(key)] as const);
	for (const [key, value] of Object.entries(LIVE_ENV)) Deno.env.set(key, value);
	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const text = await request.text();
		calls.push({
			path: new URL(request.url).pathname,
			body: text ? JSON.parse(text) : null,
			authorization: request.headers.get("authorization"),
		});
		return new Response(JSON.stringify(answer.json), {
			status: answer.status ?? 200,
			headers: { "content-type": "application/json" },
		});
	};
	try {
		await body(calls);
	} finally {
		globalThis.fetch = realFetch;
		for (const [key, value] of saved) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
	}
}

function reaccept(accessToken: string | null = TOKEN) {
	return LegalAcceptanceBackendService.reaccept({
		accessToken: accessToken ?? undefined,
		acceptTerms: true,
		redirectTo: "/projects",
	});
}

Deno.test("reaccept (live): today's versions go to accept_current_terms under the person's JWT", async () => {
	await withFake({ json: 2 }, async (calls) => {
		const result = await reaccept();
		assertEquals(result.ok, true);
		assertEquals(result.data, { redirectTo: "/projects", recorded: 2 });
		assertEquals(calls.map((c) => c.path), ["/rest/v1/rpc/accept_current_terms"]);
		assertEquals(calls[0].body, { p_legal: currentLegalVersions() });
		assertEquals(calls[0].authorization, `Bearer ${TOKEN}`);
	});
});

Deno.test("reaccept (live): a version published while the page was open is a 409, not a record", async () => {
	const stale = { status: 400, json: { code: "22023", message: "not the one in effect" } };
	await withFake(stale, async () => {
		const result = await reaccept();
		assertEquals(result.status, 409);
	});
});

Deno.test("reaccept (live): no session is a 401, and nothing is called", async () => {
	await withFake({ json: 0 }, async (calls) => {
		assertEquals((await reaccept(null)).status, 401);
		assertEquals(calls.length, 0);
	});
});

Deno.test("reaccept (live): any other refusal is a 503 the person can retry", async () => {
	await withFake({ status: 500, json: { code: "XX000", message: "boom" } }, async () => {
		assertEquals((await reaccept()).status, 503);
	});
});
