import { assertEquals } from "@std/assert";
import { refuseCrossSiteWrite } from "./csrf.ts";

/** The `/api` write guard (IW-M2): same-origin and JSON, or refused. */

const BASE = "http://localhost:3000";
const EVIL = "https://evil.test";

function req(path: string, init: RequestInit = {}): Request {
	return new Request(`${BASE}${path}`, { method: "POST", ...init });
}

function json(headers: Record<string, string> = {}): RequestInit {
	return { headers: { "content-type": "application/json", ...headers }, body: "{}" };
}

Deno.test("a same-origin JSON write passes", () => {
	assertEquals(refuseCrossSiteWrite(req("/api/auth/login", json({ origin: BASE }))), null);
	const charset = json({ origin: BASE, "content-type": "application/json; charset=utf-8" });
	assertEquals(refuseCrossSiteWrite(req("/api/auth/login", charset)), null);
});

Deno.test("reads and non-api paths are never checked", () => {
	assertEquals(refuseCrossSiteWrite(req("/api/auth/login", { method: "GET" })), null);
	assertEquals(refuseCrossSiteWrite(req("/login", { headers: { origin: EVIL } })), null);
});

Deno.test("a cross-site Origin is a 403, whatever the method or content type", () => {
	assertEquals(refuseCrossSiteWrite(req("/api/auth/login", json({ origin: EVIL })))?.status, 403);
	const opaque = { method: "DELETE", headers: { origin: "null" } };
	assertEquals(refuseCrossSiteWrite(req("/api/wallet/methods", opaque))?.status, 403);
});

Deno.test("no Origin: Sec-Fetch-Site same-origin stands in, anything else is refused", () => {
	const same = json({ "sec-fetch-site": "same-origin" });
	assertEquals(refuseCrossSiteWrite(req("/api/auth/login", same)), null);
	const cross = json({ "sec-fetch-site": "cross-site" });
	assertEquals(refuseCrossSiteWrite(req("/api/auth/login", cross))?.status, 403);
	assertEquals(refuseCrossSiteWrite(req("/api/auth/login", json()))?.status, 403);
});

Deno.test("APP_URL's origin is accepted behind a proxy", () => {
	const proxied = () => req("/api/auth/login", json({ origin: "https://projective.example" }));
	assertEquals(refuseCrossSiteWrite(proxied())?.status, 403);
	assertEquals(refuseCrossSiteWrite(proxied(), "https://projective.example/"), null);
});

Deno.test("a same-origin non-JSON body is a 415; a bodiless write passes", () => {
	const types = [
		"text/plain",
		"application/x-www-form-urlencoded",
		"multipart/form-data; boundary=x",
	];
	for (const type of types) {
		const init = { headers: { origin: BASE, "content-type": type }, body: "a=1" };
		assertEquals(refuseCrossSiteWrite(req("/api/auth/login", init))?.status, 415, type);
	}
	assertEquals(refuseCrossSiteWrite(req("/api/auth/logout", { headers: { origin: BASE } })), null);
});

Deno.test("the two no-JavaScript forms accept a same-origin form body, never a cross-site one", () => {
	const form = (origin: string) => ({
		headers: { origin, "content-type": "application/x-www-form-urlencoded" },
		body: "a=1",
	});
	assertEquals(refuseCrossSiteWrite(req("/api/contact", form(BASE))), null);
	assertEquals(refuseCrossSiteWrite(req("/api/help/feedback", form(BASE))), null);
	assertEquals(refuseCrossSiteWrite(req("/api/contact", form(EVIL)))?.status, 403);
});

Deno.test("webhooks and scheduler endpoints are exempt; a look-alike path is not", () => {
	const exempt = [
		"/api/finance/webhooks/stripe",
		"/api/sessions/webhooks/zoom",
		"/api/finance/cron/payouts",
		"/api/user/cron/erasures",
	];
	for (const path of exempt) assertEquals(refuseCrossSiteWrite(req(path, json())), null, path);
	assertEquals(refuseCrossSiteWrite(req("/api/cronjobs", json()))?.status, 403);
});
