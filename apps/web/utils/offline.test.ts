import { assert, assertEquals } from "@std/assert";
import {
	BACKGROUND_HEADER,
	internalNavigationOf,
	isMutatingMethod,
	type NavigationClickFacts,
	offlineWriteResponse,
	readHeader,
	requestFacts,
	shouldRefuseWhileOffline,
} from "./offline.ts";

/**
 * offline_test — the two verdicts, pinned case by case.
 *
 * Each row is a CLAIM about what the guards will and will not touch, and the failure mode of getting
 * one wrong is silent in both directions: a navigation that should have gone native (open in a new
 * tab) is swallowed, or a telemetry beacon that should have stayed quiet puts a "You are offline"
 * notice in front of somebody who was only reading.
 */

const ORIGIN = "https://app.example.test";
const HERE = `${ORIGIN}/projects?tab=open`;

// #region Requests
Deno.test("isMutatingMethod — the four write verbs, any case; everything else is a read", () => {
	for (const m of ["POST", "post", "PUT", "PATCH", "delete"]) assert(isMutatingMethod(m), m);
	for (const m of ["GET", "get", "HEAD", "OPTIONS", undefined]) {
		assert(!isMutatingMethod(m), `${m}`);
	}
});

Deno.test("requestFacts — string, URL and Request inputs; init wins over the Request", () => {
	const a = requestFacts("/api/projects/create", { method: "post" }, HERE);
	assertEquals(a.url.href, `${ORIGIN}/api/projects/create`);
	assertEquals(a.method, "post");
	assertEquals(a.keepalive, false);

	const b = requestFacts(new URL(`${ORIGIN}/api/x`), undefined, HERE);
	assertEquals(b.method, "GET");

	const req = new Request(`${ORIGIN}/api/y`, {
		method: "PUT",
		keepalive: true,
		headers: { [BACKGROUND_HEADER]: "1" },
	});
	const c = requestFacts(req, undefined, HERE);
	assertEquals(c.method, "PUT");
	assertEquals(c.keepalive, true);
	assertEquals(c.backgroundHeader, "1");

	// `init` overrides the Request's own method and marker, which is fetch's own precedence.
	const d = requestFacts(req, { method: "GET", headers: { [BACKGROUND_HEADER]: "0" } }, HERE);
	assertEquals(d.method, "GET");
	assertEquals(d.backgroundHeader, "0");
});

Deno.test("readHeader — Headers, tuple list and record, case-insensitively", () => {
	assertEquals(readHeader(new Headers({ "X-Pj-Background": "1" }), BACKGROUND_HEADER), "1");
	assertEquals(readHeader([["X-PJ-BACKGROUND", "1"]], BACKGROUND_HEADER), "1");
	assertEquals(readHeader({ "X-Pj-Background": "1" }, BACKGROUND_HEADER), "1");
	assertEquals(readHeader({ accept: "application/json" }, BACKGROUND_HEADER), null);
	assertEquals(readHeader(undefined, BACKGROUND_HEADER), null);
});

Deno.test("shouldRefuseWhileOffline — a same-origin user-facing write, and only that", () => {
	const refuse = (input: string, init?: RequestInit) =>
		shouldRefuseWhileOffline(requestFacts(input, init, HERE), ORIGIN);

	assert(refuse("/api/projects/create", { method: "POST" }), "a same-origin POST");
	assert(refuse("/api/projects/prj-1", { method: "PATCH" }), "a same-origin PATCH");
	assert(refuse("/api/projects/prj-1", { method: "DELETE" }), "a same-origin DELETE");

	assert(!refuse("/api/projects/list"), "a read passes through");
	assert(!refuse("/api/projects/list", { method: "HEAD" }), "HEAD passes through");
	assert(!refuse("https://storage.example.net/u", { method: "PUT" }), "cross-origin is not ours");
	assert(!refuse("/api/logs", { method: "POST" }), "the log path is background");
	assert(!refuse("/api/logs/batch", { method: "POST" }), "…and so is anything under it");
	assert(!refuse("/api/telemetry", { method: "POST" }), "telemetry is background");
	assert(!refuse("/api/x", { method: "POST", keepalive: true }), "a keepalive send is a beacon");
	assert(
		!refuse("/api/x", { method: "POST", headers: { [BACKGROUND_HEADER]: "1" } }),
		"the explicit marker opts out",
	);
	assert(
		refuse("/api/x", { method: "POST", headers: { [BACKGROUND_HEADER]: "0" } }),
		'…but a literal "0" does not',
	);
});

Deno.test("offlineWriteResponse — a 503 carrying the app's own envelope, never cacheable", async () => {
	const res = offlineWriteResponse();
	assertEquals(res.status, 503);
	assertEquals(res.headers.get("cache-control"), "no-store");
	assertEquals(res.headers.get("x-pj-offline"), "1");
	assert(res.headers.get("content-type")?.startsWith("application/json"));
	const body = await res.json();
	assertEquals(body.ok, false);
	assertEquals(body.code, "offline");
	assert(typeof body.message === "string" && body.message.length > 0);
});
// #endregion

// #region Navigation
function click(over: Partial<NavigationClickFacts> = {}): NavigationClickFacts {
	return {
		href: "/explore",
		target: "",
		download: false,
		button: 0,
		modified: false,
		defaultPrevented: false,
		optedOut: false,
		...over,
	};
}

Deno.test("internalNavigationOf — a plain click on a different same-origin page", () => {
	const dest = internalNavigationOf(click(), HERE);
	assert(dest);
	assertEquals(dest.href, `${ORIGIN}/explore`);

	const abs = internalNavigationOf(click({ href: `${ORIGIN}/wallet?w=team:1` }), HERE);
	assertEquals(abs?.href, `${ORIGIN}/wallet?w=team:1`);
});

Deno.test("internalNavigationOf — everything the browser should keep is left alone", () => {
	const cases: [string, Partial<NavigationClickFacts>][] = [
		["a handler already prevented it", { defaultPrevented: true }],
		["the opt-out attribute", { optedOut: true }],
		["a middle click", { button: 1 }],
		["a modified click (new tab)", { modified: true }],
		["a download", { download: true }],
		["a new-tab target", { target: "_blank" }],
		["a named target", { target: "preview" }],
		["a cross-origin link", { href: "https://elsewhere.example/" }],
		["a mailto", { href: "mailto:a@b.c" }],
		["a fragment on this page", { href: "#reviews" }],
		["the current page itself", { href: "/projects?tab=open" }],
		["an API link", { href: "/api/files/download?id=1" }],
		["an unparseable href", { href: "http://[bad" }],
	];
	for (const [name, over] of cases) {
		assertEquals(internalNavigationOf(click(over), HERE), null, name);
	}
	// `_self` is the default target spelled out, not an opt-out.
	assert(internalNavigationOf(click({ target: "_self" }), HERE), "_self");
	// A different query on the same path IS a different document.
	assert(internalNavigationOf(click({ href: "/projects?tab=past" }), HERE), "query change");
});
// #endregion
