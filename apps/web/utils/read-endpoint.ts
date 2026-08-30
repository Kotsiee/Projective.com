import type { ServiceResult } from "@server/services/ServiceResult.ts";
import type { State } from "./state.ts";

/**
 * read-endpoint — one resolver in, three HTTP verbs out (`GET`, `HEAD`, `OPTIONS`).
 *
 * ## Why a factory rather than three handlers
 *
 * `HEAD` is defined by RFC 9110 §9.3.2 as identical to `GET` minus the content — the header fields
 * "SHOULD be the same as the information sent in response to a GET". Two hand-written handlers
 * satisfy that on the day they are written and stop satisfying it the first time somebody adds a
 * header to one of them. Here both verbs are produced from ONE resolution of ONE payload, and the
 * only difference between the two responses is the body argument, so they cannot drift. That is the
 * whole reason this is a factory: the correctness property the task asks for is structural, not a
 * thing to remember.
 *
 * ## The ETag is over the exact bytes
 *
 * The body is serialised once, hashed, and the hash becomes a STRONG validator, because it is
 * computed over precisely the octets that will be transmitted rather than over the object they came
 * from. That matters: `JSON.stringify` is the only step where two logically-equal payloads could
 * serialise differently, and hashing after it removes the question. It also means `Content-Length`
 * is exact, since it is the byte length of the same buffer (`TextEncoder`, not `String.length` — a
 * project title with an emoji or an accented name is more bytes than characters, and a wrong
 * `Content-Length` on a `HEAD` is worse than none).
 *
 * ## What is revalidated, and what is never cached
 *
 * Only a SUCCESSFUL read gets a validator. A 404 or a 500 is sent `no-store`: a conditional request
 * that could be answered 304 from a cached failure would pin an error in front of a resource that
 * has since started existing.
 *
 * `Cache-Control: private, no-cache, must-revalidate` is the default and is not a contradiction —
 * `no-cache` permits STORING and forbids REUSE without revalidation, which is exactly the behaviour
 * that makes the ETag worth having: the client keeps the body, sends `If-None-Match`, and gets a
 * ~200-byte 304 instead of a fresh payload. `private` keeps it out of any shared cache, which for an
 * RLS-scoped read is the difference between a cache and a data leak.
 *
 * `Vary: Cookie` is sent on every response for the same reason. The session cookie is the entire
 * input to "whose rows are these", so a cache that ignored it would serve one tenant's projection to
 * the next. It is belt-and-braces alongside `private`, and it costs nothing.
 *
 * ## CORS: deliberately not permissive
 *
 * These endpoints are credentialed (cookie-authenticated) and tenant-scoped. `Access-Control-Allow-
 * Origin: *` is *invalid* with credentials and would, if a browser honoured it, hand a cross-origin
 * page another user's data. So the preflight advertises the methods and headers it accepts but only
 * ever echoes an origin that matches the request's OWN origin — same-origin callers, which is every
 * caller this app has. A genuine cross-origin consumer is a deliberate decision with an allow-list,
 * not something a helper should grant by default. See {@link corsHeaders}.
 */

// #region Context

/**
 * The slice of a Fresh route context these handlers need.
 *
 * Structural rather than an import of Fresh's `Context`, so the factory can be exercised in a unit
 * test with a plain object — a helper whose correctness depends on HTTP semantics should be testable
 * without booting a server. Fresh's real context is assignable to this.
 */
export interface ReadContext {
	req: Request;
	url: URL;
	state: State;
	params: Record<string, string>;
}

// #endregion

// #region Policy

/**
 * How a payload may be reused.
 *
 * - `private` — authenticated, tenant-scoped data. Stored only by the end client, never reused
 *   without revalidating. The default, and the right answer for all fourteen reads here.
 * - `public-metadata` — non-tenant reference data. Served `public` with a short freshness window and
 *   a `stale-while-revalidate` grace so a shared cache can answer instantly while it refreshes
 *   behind the request. Never select this for anything an RLS policy scopes.
 */
export type CachePolicy = "private" | "public-metadata";

/** Seconds a `public-metadata` payload is considered fresh. */
const PUBLIC_MAX_AGE_S = 60;
/** Seconds a `public-metadata` payload may be served stale while it refreshes. */
const PUBLIC_SWR_S = 300;

/** The `Cache-Control` value for a successful read under a given policy. */
function cacheControlFor(policy: CachePolicy): string {
	return policy === "public-metadata"
		? `public, max-age=${PUBLIC_MAX_AGE_S}, stale-while-revalidate=${PUBLIC_SWR_S}`
		: "private, no-cache, must-revalidate";
}

// #endregion

// #region Validators

const encoder = new TextEncoder();

/**
 * A strong `ETag` over the response bytes.
 *
 * SHA-256 truncated to 128 bits: collision-resistant far beyond what a cache validator needs, while
 * halving the header. Truncation is safe here because the hash is an equality check, not a
 * signature — an adversary gains nothing from a collision they cannot get a cache to store.
 */
async function etagFor(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
	const hex = Array.from(new Uint8Array(digest).slice(0, 16))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `"${hex}"`;
}

/**
 * Whether an `If-None-Match` header matches the current entity tag.
 *
 * Uses the WEAK comparison function, which RFC 9110 §8.8.3.2 requires for `If-None-Match`: the
 * `W/` prefix is stripped from both sides before comparing, so a validator that arrived weak still
 * matches the strong one we mint. `*` matches any existing representation. The header is a
 * comma-separated LIST — a client holding several cached variants sends all of them — so every
 * member is checked rather than only the first.
 */
export function ifNoneMatchSatisfied(header: string | null, etag: string): boolean {
	if (!header) return false;
	const trimmed = header.trim();
	if (trimmed === "*") return true;
	const normalise = (tag: string) => tag.trim().replace(/^W\//, "");
	const current = normalise(etag);
	return trimmed
		.split(",")
		.map(normalise)
		.some((candidate) => candidate.length > 0 && candidate === current);
}

// #endregion

// #region CORS

/**
 * The methods this factory serves, in the order `Allow` conventionally lists them.
 *
 * Exported because the 405 built by {@link methodNotAllowed} and the preflight must advertise the
 * identical set — two literals would be two places for them to disagree.
 */
export const READ_METHODS = "GET, HEAD, OPTIONS";

/**
 * Request headers a caller may send on a read.
 *
 * `If-None-Match` is the load-bearing one: without it in the allow-list a cross-origin conditional
 * request is stripped by the browser and every response is a full 200, which silently removes the
 * revalidation this module exists to provide.
 */
export const READ_ALLOWED_HEADERS = "Content-Type, Accept, If-None-Match, Authorization";

/** How long a preflight result may be reused, in seconds. */
const PREFLIGHT_MAX_AGE_S = 600;

/**
 * Same-origin-only CORS headers.
 *
 * An `Origin` that matches the request's own origin is echoed with `Allow-Credentials`; anything
 * else gets no `Access-Control-Allow-Origin` at all, which is what makes the browser refuse the
 * response. Returning nothing is the correct refusal — emitting the origin and hoping the credential
 * rules save us would be trusting the client with the decision.
 *
 * `Vary: Origin` is always sent, because the response genuinely differs by origin and a cache that
 * missed that would serve the echoed-origin variant to a stranger.
 */
export function corsHeaders(req: Request, url: URL): Record<string, string> {
	const headers: Record<string, string> = { Vary: "Origin" };
	const origin = req.headers.get("Origin");
	if (origin && origin === url.origin) {
		headers["Access-Control-Allow-Origin"] = origin;
		headers["Access-Control-Allow-Credentials"] = "true";
	}
	return headers;
}

// #endregion

// #region Responses

/** Merge `Vary` values without letting one overwrite another. */
function mergeVary(headers: Headers, value: string): void {
	const existing = headers.get("Vary");
	if (!existing) {
		headers.set("Vary", value);
		return;
	}
	const seen = new Set(existing.split(",").map((v) => v.trim()).filter(Boolean));
	for (const part of value.split(",").map((v) => v.trim()).filter(Boolean)) seen.add(part);
	headers.set("Vary", [...seen].join(", "));
}

/**
 * The method list a given route advertises.
 *
 * Two of the fifteen read routes (`/api/messaging/conversations` and `/api/messaging/settings`) also
 * serve `POST`. Advertising a bare `GET, HEAD, OPTIONS` on those tells a client that `POST` is not
 * allowed when it is — and `Allow` is not decoration: it is the authoritative answer to "what does
 * this resource accept", the thing a 405 is required to carry, and a browser's preflight gate for a
 * cross-origin write.
 */
function methodsFor(extra?: readonly string[]): string {
	if (!extra || extra.length === 0) return READ_METHODS;
	// De-duplicated and order-stable: a caller that redundantly passes "GET" must not produce
	// `GET, HEAD, OPTIONS, GET`.
	const seen = new Set(READ_METHODS.split(", "));
	for (const method of extra) seen.add(method.toUpperCase());
	return [...seen].join(", ");
}

/**
 * The `OPTIONS` response.
 *
 * `204` with no body, `Allow` for the plain-HTTP question and the `Access-Control-*` trio for the
 * CORS one. Both are sent unconditionally: `Allow` is meaningful to a non-browser client that never
 * sends `Origin`, and omitting it would make the endpoint's method set undiscoverable.
 */
export function readOptionsResponse(
	req: Request,
	url: URL,
	extraMethods?: readonly string[],
): Response {
	const allow = methodsFor(extraMethods);
	const headers = new Headers({
		Allow: allow,
		"Access-Control-Allow-Methods": allow,
		"Access-Control-Allow-Headers": READ_ALLOWED_HEADERS,
		"Access-Control-Max-Age": String(PREFLIGHT_MAX_AGE_S),
		// A preflight is about capability, not content; caching it against the session would be wrong.
		"Cache-Control": "no-store",
	});
	for (const [key, value] of Object.entries(corsHeaders(req, url))) {
		if (key === "Vary") mergeVary(headers, value);
		else headers.set(key, value);
	}
	return new Response(null, { status: 204, headers });
}

/**
 * A `405` that names what the resource does serve.
 *
 * RFC 9110 §15.5.6 requires `Allow` on a 405; without it a client is told "no" with no way to learn
 * what would have worked.
 */
export function methodNotAllowed(): Response {
	return new Response(null, {
		status: 405,
		headers: { Allow: READ_METHODS, "Cache-Control": "no-store" },
	});
}

// #endregion

// #region The factory

/** What a read route supplies to {@link defineReadRoute}. */
export interface ReadRouteConfig<T> {
	/**
	 * Resolve the payload. May return a `Response` directly to short-circuit — a param guard that
	 * wants to answer 400 does so here, and gets the same treatment on `GET` and `HEAD`.
	 */
	resolve(ctx: ReadContext): Promise<ServiceResult<T> | Response> | ServiceResult<T> | Response;
	/**
	 * Fold the service envelope into this domain's JSON body shape — `toProjectsResponse` /
	 * `toMessagingResponse` minus the `Response` construction, which this module owns so it can
	 * hash the bytes it is about to send.
	 */
	toBody(result: ServiceResult<T>): unknown;
	/** Reuse policy for a successful payload. Defaults to `private`. */
	policy?: CachePolicy;
	/**
	 * Verbs this route serves IN ADDITION to the three built here — e.g. `["POST"]` on the two
	 * messaging routes that also accept a write.
	 *
	 * It exists so `Allow` and `Access-Control-Allow-Methods` tell the truth. Without it a route that
	 * genuinely accepts `POST` advertises that it does not, which a browser honours by failing the
	 * preflight for a cross-origin write that would have succeeded.
	 */
	alsoAllows?: readonly string[];
}

/** The three handlers, ready to spread into `define.handlers`. */
export interface ReadHandlers {
	GET(ctx: ReadContext): Promise<Response>;
	HEAD(ctx: ReadContext): Promise<Response>;
	OPTIONS(ctx: ReadContext): Response;
}

/**
 * Build `GET` / `HEAD` / `OPTIONS` from one resolver.
 *
 * The `includeBody` flag is the ONLY difference between the two content verbs, and it is threaded
 * through a single code path rather than branching early, so every header is computed identically
 * for both by construction.
 */
export function defineReadRoute<T>(config: ReadRouteConfig<T>): ReadHandlers {
	const policy = config.policy ?? "private";

	async function respond(ctx: ReadContext, includeBody: boolean): Promise<Response> {
		const resolved = await config.resolve(ctx);

		// A short-circuit Response (a param guard). It is NOT returned as-is: its body is read first so
		// both verbs are built from the same bytes and the same explicit `Content-Length`.
		//
		// Returning it verbatim on GET and `new Response(null, …)` on HEAD looks equivalent and is not.
		// The runtime derives `Content-Length` from the body it is given, so the GET carried one and
		// the HEAD did not — breaking, on the one branch nobody looks at, exactly the parity this whole
		// module exists to guarantee. The original test caught neither, because it asserted the status
		// and the empty body without ever diffing the headers.
		if (resolved instanceof Response) {
			const guardText = await resolved.text();
			const guardBytes = encoder.encode(guardText);
			const guardHeaders = new Headers(resolved.headers);
			guardHeaders.set("Content-Length", String(guardBytes.byteLength));
			return new Response(includeBody ? guardText : null, {
				status: resolved.status,
				headers: guardHeaders,
			});
		}

		const status = resolved.status;
		const body = config.toBody(resolved);
		const text = JSON.stringify(body) ?? "null";
		const bytes = encoder.encode(text);

		const headers = new Headers({
			"Content-Type": "application/json; charset=utf-8",
			// Explicit rather than left to the runtime: on a HEAD there is no body to measure, and the
			// whole point of the verb is to learn this number without transferring it.
			"Content-Length": String(bytes.byteLength),
		});
		mergeVary(headers, "Cookie");
		for (const [key, value] of Object.entries(corsHeaders(ctx.req, ctx.url))) {
			if (key === "Vary") mergeVary(headers, value);
			else headers.set(key, value);
		}

		// Only a successful read is revalidatable. Anything else must not be pinned by a validator.
		if (!resolved.ok || status < 200 || status > 299) {
			headers.set("Cache-Control", "no-store");
			return new Response(includeBody ? text : null, { status, headers });
		}

		const etag = await etagFor(bytes);
		headers.set("ETag", etag);
		headers.set("Cache-Control", cacheControlFor(policy));

		if (ifNoneMatchSatisfied(ctx.req.headers.get("If-None-Match"), etag)) {
			// RFC 9110 §15.4.5: a 304 carries no content. `Content-Length` and `Content-Type` describe a
			// body that is not being sent, so they are dropped rather than left to describe nothing —
			// the validator and freshness headers are what the client came back for.
			headers.delete("Content-Length");
			headers.delete("Content-Type");
			return new Response(null, { status: 304, headers });
		}

		return new Response(includeBody ? text : null, { status, headers });
	}

	return {
		GET: (ctx) => respond(ctx, true),
		HEAD: (ctx) => respond(ctx, false),
		OPTIONS: (ctx) => readOptionsResponse(ctx.req, ctx.url, config.alsoAllows),
	};
}

// #endregion
