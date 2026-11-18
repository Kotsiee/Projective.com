import { assertEquals } from "@std/assert";
import { refuseCrossSitePageWrite, refuseCrossSiteWrite } from "./csrf.ts";

/**
 * The same-origin write guard (IW-M2, PRD-C12): on `/api`, same-origin and JSON, or refused; on every
 * other route, same-origin with a form or JSON body, or refused.
 */

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

Deno.test("Origin null (a no-referrer page's form post): Sec-Fetch-Site decides", () => {
	const opaque = (site?: string) =>
		json(site ? { origin: "null", "sec-fetch-site": site } : { origin: "null" });
	assertEquals(refuseCrossSiteWrite(req("/api/auth/login", opaque("same-origin"))), null);
	assertEquals(refuseCrossSiteWrite(req("/api/auth/login", opaque("cross-site")))?.status, 403);
	assertEquals(refuseCrossSiteWrite(req("/api/auth/login", opaque("same-site")))?.status, 403);
	assertEquals(refuseCrossSiteWrite(req("/api/auth/login", opaque()))?.status, 403);
});

Deno.test("a real cross-site Origin is refused even beside Sec-Fetch-Site same-origin", () => {
	const forged = json({ origin: EVIL, "sec-fetch-site": "same-origin" });
	assertEquals(refuseCrossSiteWrite(req("/api/auth/login", forged))?.status, 403);
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

Deno.test("the plain HTML forms accept a same-origin form body, never a cross-site one", () => {
	const form = (origin: string, site?: string) => ({
		headers: {
			origin,
			"content-type": "application/x-www-form-urlencoded",
			...(site ? { "sec-fetch-site": site } : {}),
		},
		body: "a=1",
	});
	assertEquals(refuseCrossSiteWrite(req("/api/contact", form(BASE))), null);
	assertEquals(refuseCrossSiteWrite(req("/api/help/feedback", form(BASE))), null);
	assertEquals(refuseCrossSiteWrite(req("/api/auth/confirm", form("null", "same-origin"))), null);
	assertEquals(refuseCrossSiteWrite(req("/api/contact", form(EVIL)))?.status, 403);
	assertEquals(refuseCrossSiteWrite(req("/api/auth/confirm", form(EVIL)))?.status, 403);
	assertEquals(
		refuseCrossSiteWrite(req("/api/auth/confirm", form("null", "cross-site")))?.status,
		403,
	);
	assertEquals(refuseCrossSiteWrite(req("/api/auth/login", form(BASE)))?.status, 415);
});

Deno.test("webhooks and scheduler endpoints are exempt; a look-alike path is not", () => {
	const exempt = [
		"/api/finance/webhooks/stripe",
		"/api/sessions/webhooks/zoom",
		"/api/finance/cron/payouts",
		"/api/user/cron/erasures",
		"/api/comms/cron/dispatch",
		"/api/comms/dispatch",
	];
	for (const path of exempt) assertEquals(refuseCrossSiteWrite(req(path, json())), null, path);
	assertEquals(refuseCrossSiteWrite(req("/api/cronjobs", json()))?.status, 403);
	// The dispatcher's door is one exact path, not a prefix.
	assertEquals(refuseCrossSiteWrite(req("/api/comms/dispatcher", json()))?.status, 403);
	assertEquals(refuseCrossSiteWrite(req("/api/comms/dispatch/other", json()))?.status, 403);
});

// #region Page routes
const RSVP = "/rsvp/:token";

function form(headers: Record<string, string> = {}): RequestInit {
	return {
		headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
		body: "action=code",
	};
}

Deno.test("page write: a cross-site form is a 403 in plain text, whatever the method", async () => {
	for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
		const res = refuseCrossSitePageWrite(
			req("/rsvp/t", { ...form({ origin: EVIL }), method }),
			RSVP,
		);
		assertEquals(res?.status, 403, method);
		assertEquals(res?.headers.get("content-type"), "text/plain; charset=utf-8");
		assertEquals(res?.headers.get("cache-control"), "no-store");
		assertEquals(await res?.text(), "This form didn't come from Projective, so it was refused.");
	}
	const opaque = form({ origin: "null", "sec-fetch-site": "cross-site" });
	assertEquals(refuseCrossSitePageWrite(req("/rsvp/t", opaque), RSVP)?.status, 403);
	assertEquals(refuseCrossSitePageWrite(req("/rsvp/t", form()), RSVP)?.status, 403);
	const forged = form({ origin: EVIL, "sec-fetch-site": "same-origin" });
	assertEquals(refuseCrossSitePageWrite(req("/rsvp/t", forged), RSVP)?.status, 403);
});

Deno.test("page write: reads pass untouched, and so does a cross-site GET", () => {
	for (const method of ["GET", "HEAD", "OPTIONS"]) {
		const read = new Request(`${BASE}/rsvp/t`, { method, headers: { origin: EVIL } });
		assertEquals(refuseCrossSitePageWrite(read, RSVP), null, method);
	}
});

Deno.test("page write: the page's own form, JSON or a bodiless write passes; another body is a 415", () => {
	const own = { origin: "null", "sec-fetch-site": "same-origin" };
	assertEquals(refuseCrossSitePageWrite(req("/rsvp/t", form(own)), RSVP), null);
	assertEquals(refuseCrossSitePageWrite(req("/rsvp/t", form({ origin: BASE })), RSVP), null);
	const multipart = {
		headers: { origin: BASE, "content-type": "multipart/form-data; boundary=x" },
	};
	assertEquals(
		refuseCrossSitePageWrite(req("/rsvp/t", { ...multipart, body: "--x--" }), RSVP),
		null,
	);
	assertEquals(refuseCrossSitePageWrite(req("/rsvp/t", json({ origin: BASE })), RSVP), null);
	assertEquals(refuseCrossSitePageWrite(req("/rsvp/t", { headers: { origin: BASE } }), RSVP), null);
	const text = { headers: { origin: BASE, "content-type": "text/plain" }, body: "a=1" };
	assertEquals(refuseCrossSitePageWrite(req("/rsvp/t", text), RSVP)?.status, 415);
	const proxied = req("/rsvp/t", form({ origin: "https://projective.example" }));
	assertEquals(refuseCrossSitePageWrite(proxied, RSVP, "https://projective.example/"), null);
});

Deno.test("page write: an /api route is left to the /api guard, its exemptions included", () => {
	const cross = json({ origin: EVIL });
	assertEquals(refuseCrossSitePageWrite(req("/api/auth/login", cross), "/api/auth/login"), null);
	const stripe = req("/api/finance/webhooks/stripe", json());
	assertEquals(refuseCrossSitePageWrite(stripe, "/api/finance/webhooks/stripe"), null);
});

Deno.test("page write: an /api URL that falls through to a page pattern, or matches nothing, is guarded", () => {
	const cross = form({ origin: EVIL });
	assertEquals(refuseCrossSitePageWrite(req("/api/rsvp", cross), "/:handle/:tab")?.status, 403);
	assertEquals(refuseCrossSitePageWrite(req("/api/nowhere", cross), null)?.status, 403);
	assertEquals(refuseCrossSitePageWrite(req("/api", cross), "/:handle")?.status, 403);
	const webhookLookalike = req("/api/finance/webhooks/stripe", json());
	assertEquals(refuseCrossSitePageWrite(webhookLookalike, "/:handle/:tab/:x/:y")?.status, 403);
	assertEquals(refuseCrossSitePageWrite(req("/nowhere", cross), null)?.status, 403);
});
// #endregion
