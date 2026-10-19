/**
 * contact-respond (Decision #276): the envelope every `/api/contact/*` route answers — the service's
 * status, `no-store` always, `Retry-After` on a 429 from `details.retryAt` — and the JSON road's
 * guards (an unreadable body, a body not declared as JSON) and the per-IP key.
 */
import { assert, assertEquals } from "@std/assert";
import type { ServiceResult } from "@server/services/ServiceResult.ts";
import {
	clientKey,
	isJsonRequest,
	toContactResponse,
	unreadableBody,
	unsupportedBody,
} from "./contact-respond.ts";

Deno.test("a receipt answers at the service's status, as the envelope, never cacheable", async () => {
	const result: ServiceResult<{ reference: string }> = {
		ok: true,
		status: 201,
		data: { reference: "CT-7K4Q-2M9X" },
	};
	const res = toContactResponse(result);
	assertEquals(res.status, 201);
	assertEquals(res.headers.get("cache-control"), "no-store");
	assertEquals(res.headers.get("retry-after"), null);
	const body = await res.json();
	assertEquals(body.ok, true);
	assertEquals(body.data, { reference: "CT-7K4Q-2M9X" });
});

Deno.test("a 429 carries Retry-After in whole seconds from details.retryAt", async () => {
	const retryAt = new Date(Date.now() + 90_500).toISOString();
	const res = toContactResponse({
		ok: false,
		status: 429,
		message: "That's a lot of requests in a short time.",
		details: { retryAt },
	});
	assertEquals(res.status, 429);
	assertEquals(res.headers.get("cache-control"), "no-store");
	const seconds = Number(res.headers.get("retry-after"));
	assert(seconds >= 90 && seconds <= 91, `retry-after ${seconds}`);
	assertEquals((await res.json()).details.retryAt, retryAt);
});

Deno.test("a 429 without a readable retryAt sets no Retry-After; field errors travel in the body", async () => {
	const limited = toContactResponse({ ok: false, status: 429, details: { retryAt: "soon" } });
	assertEquals(limited.headers.get("retry-after"), null);
	const invalid = toContactResponse({
		ok: false,
		status: 422,
		message: "Check the highlighted fields.",
		errors: { email: "Enter a valid email address." },
	});
	assertEquals(invalid.status, 422);
	assertEquals(invalid.headers.get("cache-control"), "no-store");
	assertEquals((await invalid.json()).errors, { email: "Enter a valid email address." });
});

Deno.test("an unreadable body is a 422, a body not declared as JSON a 415 — both no-store", async () => {
	const unreadable = unreadableBody();
	assertEquals(unreadable.status, 422);
	assertEquals(unreadable.headers.get("cache-control"), "no-store");
	assertEquals((await unreadable.json()).ok, false);
	const unsupported = unsupportedBody();
	assertEquals(unsupported.status, 415);
	assertEquals(unsupported.headers.get("cache-control"), "no-store");
});

Deno.test("isJsonRequest: only application/json (any parameters, any case) is the JSON road", () => {
	const post = (type: string | null) =>
		new Request("http://127.0.0.1/api/contact", {
			method: "POST",
			headers: type ? { "content-type": type } : {},
			body: "{}",
		});
	assert(isJsonRequest(post("application/json")));
	assert(isJsonRequest(post("Application/JSON; charset=utf-8")));
	// A cross-site form can send these without a preflight — they never reach the JSON parser.
	assertEquals(isJsonRequest(post("text/plain")), false);
	assertEquals(isJsonRequest(post("text/plain; charset=utf-8")), false);
	assertEquals(isJsonRequest(post("application/x-www-form-urlencoded")), false);
	assertEquals(
		isJsonRequest(new Request("http://127.0.0.1/api/contact", { method: "POST" })),
		false,
	);
});

Deno.test("clientKey: the hostname of a network address, the transport of a unix one", () => {
	assertEquals(
		clientKey({ transport: "tcp", hostname: "203.0.113.7", port: 51234 }),
		"203.0.113.7",
	);
	assertEquals(clientKey({ transport: "udp", hostname: "2001:db8::1", port: 443 }), "2001:db8::1");
	assertEquals(clientKey({ transport: "unix", path: "/tmp/app.sock" }), "unix");
});
