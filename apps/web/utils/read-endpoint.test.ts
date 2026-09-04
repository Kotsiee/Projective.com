import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { fail, ok, type ServiceResult } from "@server/services/ServiceResult.ts";
import {
	corsHeaders,
	defineReadRoute,
	ifNoneMatchSatisfied,
	methodNotAllowed,
	READ_METHODS,
	type ReadContext,
	readOptionsResponse,
} from "./read-endpoint.ts";

/**
 * read-endpoint_test — the HTTP semantics, proven by execution rather than by reading the RFC
 * alongside the code.
 *
 * The header-parity test is the one that matters most: it is the property the factory exists to
 * guarantee, and it is exactly the property that a hand-written pair of GET/HEAD handlers loses
 * silently the first time somebody edits one of them.
 */

// #region Harness

const ORIGIN = "https://app.example.test";

function ctxFor(
	init: { headers?: Record<string, string>; method?: string; path?: string } = {},
): ReadContext {
	const url = new URL(`${ORIGIN}${init.path ?? "/api/projects/list"}`);
	return {
		req: new Request(url, { method: init.method ?? "GET", headers: init.headers }),
		url,
		state: {},
		params: {},
	};
}

interface Payload {
	items: string[];
}

function routeReturning(result: ServiceResult<Payload>) {
	return defineReadRoute<Payload>({
		resolve: () => result,
		toBody: (r) => ({ ok: r.ok, message: r.message, errors: r.errors, data: r.data }),
	});
}

const OK_RESULT = ok<Payload>({ items: ["a", "b"] });

// #endregion

// #region If-None-Match parsing

Deno.test("ifNoneMatchSatisfied: absent header never matches", () => {
	assertEquals(ifNoneMatchSatisfied(null, '"abc"'), false);
	assertEquals(ifNoneMatchSatisfied("", '"abc"'), false);
});

Deno.test("ifNoneMatchSatisfied: star matches any representation", () => {
	assertEquals(ifNoneMatchSatisfied("*", '"abc"'), true);
});

Deno.test("ifNoneMatchSatisfied: exact and weak forms both match (weak comparison)", () => {
	assertEquals(ifNoneMatchSatisfied('"abc"', '"abc"'), true);
	assertEquals(ifNoneMatchSatisfied('W/"abc"', '"abc"'), true);
	assertEquals(ifNoneMatchSatisfied('"abc"', 'W/"abc"'), true);
});

Deno.test("ifNoneMatchSatisfied: checks every member of the list, not just the first", () => {
	assertEquals(ifNoneMatchSatisfied('"x", "y", "abc"', '"abc"'), true);
	assertEquals(ifNoneMatchSatisfied('"x", "y"', '"abc"'), false);
});

Deno.test("ifNoneMatchSatisfied: a different tag does not match", () => {
	assertEquals(ifNoneMatchSatisfied('"abd"', '"abc"'), false);
});

// #endregion

// #region GET

Deno.test("GET returns the JSON body with a strong ETag and an exact Content-Length", async () => {
	const route = routeReturning(OK_RESULT);
	const res = await route.GET(ctxFor());

	assertEquals(res.status, 200);
	assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");

	const text = await res.text();
	const declared = Number(res.headers.get("Content-Length"));
	assertEquals(
		declared,
		new TextEncoder().encode(text).byteLength,
		"Content-Length must be the UTF-8 byte length of the body",
	);

	const etag = res.headers.get("ETag");
	assert(etag && /^"[0-9a-f]{32}"$/.test(etag), `expected a strong hex ETag, got ${etag}`);
});

Deno.test("Content-Length counts BYTES, not characters, for non-ASCII payloads", async () => {
	// The bug this pins: `String.length` on "Café 🎨" is 7 while its UTF-8 encoding is 11 bytes. A
	// short Content-Length on a HEAD tells the client to expect a body that does not exist.
	const route = routeReturning(ok<Payload>({ items: ["Café 🎨 Ünicode"] }));
	const res = await route.GET(ctxFor());
	const text = await res.text();
	assert(new TextEncoder().encode(text).byteLength > text.length, "precondition: multibyte body");
	assertEquals(
		Number(res.headers.get("Content-Length")),
		new TextEncoder().encode(text).byteLength,
	);
});

Deno.test("GET marks the response private and revalidated, and varies on Cookie", async () => {
	const res = await routeReturning(OK_RESULT).GET(ctxFor());
	assertEquals(res.headers.get("Cache-Control"), "private, no-cache, must-revalidate");
	assert(res.headers.get("Vary")?.includes("Cookie"), "an RLS-scoped read must vary on Cookie");
});

Deno.test("public-metadata policy serves a shared cache with stale-while-revalidate", async () => {
	const route = defineReadRoute<Payload>({
		resolve: () => OK_RESULT,
		toBody: (r) => ({ ok: r.ok, data: r.data }),
		policy: "public-metadata",
	});
	const res = await route.GET(ctxFor());
	const cc = res.headers.get("Cache-Control") ?? "";
	assert(cc.startsWith("public,"), cc);
	assert(cc.includes("stale-while-revalidate="), cc);
});

Deno.test("the ETag changes when the payload changes and is stable when it does not", async () => {
	const first = await routeReturning(ok<Payload>({ items: ["a"] })).GET(ctxFor());
	const again = await routeReturning(ok<Payload>({ items: ["a"] })).GET(ctxFor());
	const different = await routeReturning(ok<Payload>({ items: ["b"] })).GET(ctxFor());

	assertEquals(first.headers.get("ETag"), again.headers.get("ETag"));
	assertNotEquals(first.headers.get("ETag"), different.headers.get("ETag"));
});

// #endregion

// #region HEAD parity — the property the factory exists for

Deno.test("HEAD returns zero bytes of body", async () => {
	const res = await routeReturning(OK_RESULT).HEAD(ctxFor({ method: "HEAD" }));
	assertEquals(res.body, null, "HEAD must carry no body stream at all");
	assertEquals((await res.arrayBuffer()).byteLength, 0);
});

Deno.test("HEAD headers are identical to GET's, field for field", async () => {
	const get = await routeReturning(OK_RESULT).GET(ctxFor());
	const head = await routeReturning(OK_RESULT).HEAD(ctxFor({ method: "HEAD" }));

	const dump = (res: Response) => [...res.headers].map(([k, v]) => `${k}: ${v}`).sort().join("\n");

	assertEquals(head.status, get.status);
	assertEquals(dump(head), dump(get));
});

Deno.test("HEAD still advertises the Content-Length the body would have had", async () => {
	const get = await routeReturning(OK_RESULT).GET(ctxFor());
	const head = await routeReturning(OK_RESULT).HEAD(ctxFor({ method: "HEAD" }));
	const bodyBytes = new TextEncoder().encode(await get.text()).byteLength;

	assertEquals(Number(head.headers.get("Content-Length")), bodyBytes);
	assert(bodyBytes > 0, "precondition: the GET body is non-empty");
});

Deno.test("HEAD on a failing read matches GET's status and headers, still with no body", async () => {
	const failure = fail<Payload>(404, { message: "No such project." });
	const get = await routeReturning(failure).GET(ctxFor());
	const head = await routeReturning(failure).HEAD(ctxFor({ method: "HEAD" }));

	assertEquals(head.status, 404);
	assertEquals(get.status, 404);
	assertEquals(head.headers.get("Cache-Control"), get.headers.get("Cache-Control"));
	assertEquals(head.body, null);
});

// #endregion

// #region Conditional requests

Deno.test("a matching If-None-Match yields 304 with no body and no Content-Length", async () => {
	const route = routeReturning(OK_RESULT);
	const first = await route.GET(ctxFor());
	const etag = first.headers.get("ETag")!;
	await first.text();

	const second = await route.GET(ctxFor({ headers: { "If-None-Match": etag } }));

	assertEquals(second.status, 304);
	assertEquals(second.body, null);
	assertEquals(second.headers.get("Content-Length"), null, "a 304 sends no content to measure");
	assertEquals(second.headers.get("ETag"), etag, "the validator must still be present");
	assertEquals(second.headers.get("Cache-Control"), "private, no-cache, must-revalidate");
});

Deno.test("a stale If-None-Match yields a full 200", async () => {
	const res = await routeReturning(OK_RESULT).GET(
		ctxFor({ headers: { "If-None-Match": '"0000000000000000deadbeefdeadbeef"' } }),
	);
	assertEquals(res.status, 200);
	assert((await res.text()).length > 0);
});

Deno.test("HEAD honours If-None-Match exactly as GET does", async () => {
	const route = routeReturning(OK_RESULT);
	const etag = (await route.GET(ctxFor())).headers.get("ETag")!;
	const head = await route.HEAD(ctxFor({ method: "HEAD", headers: { "If-None-Match": etag } }));
	assertEquals(head.status, 304);
});

Deno.test("a FAILING read is never revalidatable — no ETag, and no-store", async () => {
	// Pins the rule that a 404 must not be pinned by a validator: the resource may start existing.
	const res = await routeReturning(fail<Payload>(404, { message: "gone" })).GET(
		ctxFor({ headers: { "If-None-Match": "*" } }),
	);
	assertEquals(res.status, 404, "a wildcard validator must not turn an error into a 304");
	assertEquals(res.headers.get("ETag"), null);
	assertEquals(res.headers.get("Cache-Control"), "no-store");
});

// #endregion

// #region OPTIONS and CORS

Deno.test("OPTIONS is a 204 that advertises exactly GET, HEAD, OPTIONS", async () => {
	const ctx = ctxFor({ method: "OPTIONS" });
	const res = routeReturning(OK_RESULT).OPTIONS(ctx);

	assertEquals(res.status, 204);
	assertEquals((await res.arrayBuffer()).byteLength, 0);
	assertEquals(res.headers.get("Allow"), READ_METHODS);
	assertEquals(res.headers.get("Access-Control-Allow-Methods"), READ_METHODS);
	assert(
		res.headers.get("Access-Control-Allow-Headers")?.includes("If-None-Match"),
		"If-None-Match must be allowed or cross-origin revalidation silently stops working",
	);
	assert(Number(res.headers.get("Access-Control-Max-Age")) > 0);
});

Deno.test("OPTIONS echoes a same-origin Origin with credentials", () => {
	const url = new URL(`${ORIGIN}/api/projects/list`);
	const req = new Request(url, { method: "OPTIONS", headers: { Origin: ORIGIN } });
	const res = readOptionsResponse(req, url);
	assertEquals(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
	assertEquals(res.headers.get("Access-Control-Allow-Credentials"), "true");
});

Deno.test("a cross-origin caller is refused — no ACAO, and never a wildcard", () => {
	// The security property: these reads are cookie-authenticated and tenant-scoped, so a wildcard
	// (which is in any case invalid with credentials) would be a cross-tenant disclosure.
	const url = new URL(`${ORIGIN}/api/projects/list`);
	const req = new Request(url, {
		method: "OPTIONS",
		headers: { Origin: "https://evil.example" },
	});
	const res = readOptionsResponse(req, url);
	assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
	assertNotEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("responses always vary on Origin, since they differ by it", () => {
	const url = new URL(`${ORIGIN}/api/projects/list`);
	const req = new Request(url, { headers: { Origin: ORIGIN } });
	assertEquals(corsHeaders(req, url).Vary, "Origin");
});

Deno.test("GET merges Vary rather than letting Origin overwrite Cookie", async () => {
	const url = new URL(`${ORIGIN}/api/projects/list`);
	const ctx: ReadContext = {
		req: new Request(url, { headers: { Origin: ORIGIN } }),
		url,
		state: {},
		params: {},
	};
	const vary = (await routeReturning(OK_RESULT).GET(ctx)).headers.get("Vary") ?? "";
	assert(vary.includes("Cookie"), vary);
	assert(vary.includes("Origin"), vary);
});

Deno.test("methodNotAllowed names the methods that would have worked", () => {
	const res = methodNotAllowed();
	assertEquals(res.status, 405);
	assertEquals(res.headers.get("Allow"), READ_METHODS);
});

// #endregion

// #region Short-circuit guards

function guardRoute() {
	return defineReadRoute<Payload>({
		resolve: () => Response.json({ ok: false, message: "Missing slug." }, { status: 400 }),
		toBody: (r) => r,
	});
}

Deno.test("a guard Response is returned on GET and stripped of its body on HEAD", async () => {
	const get = await guardRoute().GET(ctxFor());
	const head = await guardRoute().HEAD(ctxFor({ method: "HEAD" }));

	assertEquals(get.status, 400);
	assertEquals(head.status, 400);
	assert((await get.text()).includes("Missing slug"));
	assertEquals(head.body, null, "a guard must not leak a body through HEAD");
});

Deno.test("a guard's HEAD headers match its GET headers, field for field", async () => {
	// The regression this pins: the guard branch used to return the resolved Response verbatim on GET
	// and `new Response(null, …)` on HEAD. The runtime derives Content-Length from the body it is
	// given, so GET carried one and HEAD did not — a parity break on the one branch the original test
	// never diffed. It asserted status and an empty body and passed while the headers disagreed.
	const get = await guardRoute().GET(ctxFor());
	const head = await guardRoute().HEAD(ctxFor({ method: "HEAD" }));
	const dump = (res: Response) => [...res.headers].map(([k, v]) => `${k}: ${v}`).sort().join("\n");

	assertEquals(dump(head), dump(get));
});

Deno.test("a guard declares the byte length its body would have had", async () => {
	const get = await guardRoute().GET(ctxFor());
	const head = await guardRoute().HEAD(ctxFor({ method: "HEAD" }));
	const bytes = new TextEncoder().encode(await get.text()).byteLength;

	assert(bytes > 0, "precondition: the guard body is non-empty");
	assertEquals(Number(head.headers.get("Content-Length")), bytes);
});

Deno.test("alsoAllows advertises a route's write verb on OPTIONS and Allow", async () => {
	// Two of the fifteen read routes also serve POST. Advertising only the read verbs tells a client
	// POST is not allowed when it is — and a browser honours that by failing the preflight.
	const route = defineReadRoute<Payload>({
		resolve: () => OK_RESULT,
		toBody: (r) => ({ ok: r.ok, data: r.data }),
		alsoAllows: ["POST"],
	});
	const res = route.OPTIONS(ctxFor({ method: "OPTIONS" }));

	const allow = res.headers.get("Allow") ?? "";
	assert(allow.includes("POST"), allow);
	assert(allow.includes("GET") && allow.includes("HEAD") && allow.includes("OPTIONS"), allow);
	assertEquals(res.headers.get("Access-Control-Allow-Methods"), allow, "the two must agree");
	assertEquals((await res.arrayBuffer()).byteLength, 0);
});

Deno.test("alsoAllows does not duplicate a verb the read set already carries", () => {
	const route = defineReadRoute<Payload>({
		resolve: () => OK_RESULT,
		toBody: (r) => ({ ok: r.ok, data: r.data }),
		alsoAllows: ["GET", "post"],
	});
	const allow = route.OPTIONS(ctxFor({ method: "OPTIONS" })).headers.get("Allow") ?? "";
	assertEquals(allow.split(", ").filter((m) => m === "GET").length, 1, allow);
	assert(allow.includes("POST"), "a lower-case verb is normalised, not dropped");
});

// #endregion
