import { assert, assertEquals } from "@std/assert";
import { PublicMetricsSchema } from "@projective/types/marketing";
import { handler } from "@web/routes/api/public/metrics.ts";

/**
 * `GET | HEAD | OPTIONS /api/public/metrics` — the wire contract the landing page and `/about`
 * share (Decision #277). `USE_MOCKS` forces the frozen fixture, so the run never needs a database.
 */

type Handler = (ctx: unknown) => Promise<Response> | Response;

async function call(method: string, headers: Record<string, string> = {}): Promise<Response> {
	const url = new URL("https://app.example.test/api/public/metrics");
	const req = new Request(url, { method, headers });
	const fn = (handler as unknown as Record<string, Handler>)[method];
	return await fn({ req, url, params: {}, state: {} });
}

function withMocks<T>(run: () => Promise<T>): Promise<T> {
	const previous = Deno.env.get("USE_MOCKS");
	Deno.env.set("USE_MOCKS", "true");
	return run().finally(() => {
		if (previous === undefined) Deno.env.delete("USE_MOCKS");
		else Deno.env.set("USE_MOCKS", previous);
	});
}

Deno.test("GET /api/public/metrics: the PublicMetrics shape in the flat envelope, publicly cacheable", () =>
	withMocks(async () => {
		const res = await call("GET");
		assertEquals(res.status, 200);
		const body = await res.json();
		assertEquals(body.ok, true);
		const parsed = PublicMetricsSchema.safeParse(body);
		assert(parsed.success, JSON.stringify(body));
		assertEquals(parsed.data.platformFeeBp, 500);
		// The seed's figures rest on fewer than 10 rows each, so they are withheld, not padded.
		assertEquals(parsed.data.totalValueProtected, null);
		assertEquals(parsed.data.stagesDelivered, null);
		assertEquals(parsed.data.medianFundingToApprovalHours, null);
		assert(res.headers.get("Cache-Control")?.startsWith("public"));
		assert(res.headers.get("ETag"));
	}));

Deno.test("HEAD /api/public/metrics: GET's headers without the body; If-None-Match revalidates", () =>
	withMocks(async () => {
		const get = await call("GET");
		const head = await call("HEAD");
		assertEquals(head.status, 200);
		assertEquals(await head.text(), "");
		assertEquals(head.headers.get("Content-Length"), get.headers.get("Content-Length"));
		const etag = get.headers.get("ETag") ?? "";
		const again = await call("GET", { "If-None-Match": etag });
		assertEquals(again.status, 304);
	}));

Deno.test("OPTIONS /api/public/metrics: advertises the read verbs only", async () => {
	const res = await call("OPTIONS");
	assertEquals(res.status, 204);
	assertEquals(res.headers.get("Allow"), "GET, HEAD, OPTIONS");
});
