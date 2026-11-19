import { assertEquals } from "@std/assert";
import { associationResponse, handler } from "./apple-pay-association.ts";

/**
 * Apple Pay's domain association path (CK6): the configured body verbatim as plain text, or a plain
 * 404 while none is configured — never a page, never a redirect.
 */

const ENV = "STRIPE_APPLE_PAY_DOMAIN_ASSOCIATION";
type Get = () => Response | Promise<Response>;

async function served(value: string | undefined): Promise<Response> {
	const before = Deno.env.get(ENV);
	if (value === undefined) Deno.env.delete(ENV);
	else Deno.env.set(ENV, value);
	try {
		return await (handler as unknown as { GET: Get }).GET();
	} finally {
		if (before === undefined) Deno.env.delete(ENV);
		else Deno.env.set(ENV, before);
	}
}

Deno.test("a configured file is served verbatim as plain text, cacheable, unsniffed", async () => {
	const res = await served("  7B227073704964223A2239373943\n");
	assertEquals(res.status, 200);
	assertEquals(res.headers.get("content-type"), "text/plain; charset=utf-8");
	assertEquals(res.headers.get("x-content-type-options"), "nosniff");
	assertEquals(res.headers.get("location"), null);
	assertEquals(await res.text(), "7B227073704964223A2239373943");
});

Deno.test("no file, or the placeholder, is a plain 404", async () => {
	for (const value of [undefined, "XXXX-XXXX"]) {
		const res = await served(value);
		assertEquals(res.status, 404);
		assertEquals(res.headers.get("content-type"), "text/plain; charset=utf-8");
		assertEquals(res.headers.get("cache-control"), "no-store");
		await res.body?.cancel();
	}
	assertEquals(associationResponse(null).status, 404);
});
