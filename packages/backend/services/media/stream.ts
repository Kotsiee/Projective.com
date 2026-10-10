import type { FileObjectTier } from "@projective/types/files";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import { fetchStoredObject } from "../../core/storage-stream.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { isAssetId } from "../files/inspect-dto.ts";
import { inlineSafe, objectFor, type ObjectRef } from "../files/live-objects.ts";

/**
 * stream — the media proxy's fat half: may this caller have these bytes, and if so, stream them.
 *
 * The read decision is `objectFor`, unchanged (session RLS, the anonymous public rule, or a validated
 * share slug). Only the transport is new: the bytes come from storage as the service role and pass
 * through the app, so no storage host, bucket or object path ever reaches the browser. `Range` and the
 * conditional headers are forwarded so video seeks and revalidation work.
 *
 * The response carries an ALLOWLIST of upstream headers plus a policy of its own — never a copy of what
 * storage sent, which names its gateway and widens CORS. Every refusal is the same 404, so the proxy
 * cannot be used to learn that a file exists.
 */

// #region Types

/** One proxied read, as the thin route parsed it. */
export interface StreamRequest {
	method: "GET" | "HEAD";
	tier: FileObjectTier | null;
	share: string | null;
	download: boolean;
	range: string | null;
	ifRange: string | null;
	ifNoneMatch: string | null;
	ifModifiedSince: string | null;
	signal: AbortSignal;
}

/** What the route answers with: a status storage agreed to, headers from policy, and the byte stream. */
export interface StreamedAsset {
	status: 200 | 206 | 304 | 416;
	headers: Headers;
	body: ReadableStream<Uint8Array> | null;
}

// #endregion

// #region Header policy

const MIME_TOKEN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const TEXT_LIKE =
	/^(text\/.+|application\/(json|ld\+json|xml|xhtml\+xml|javascript|x-javascript|ecmascript|typescript|x-typescript|yaml|x-yaml|toml|x-toml|x-sh|sql|graphql|markdown|x-markdown|csv)|.+\/.+\+(json|xml))$/;
const TEXT_PLAIN = "text/plain; charset=utf-8";
const OCTET_STREAM = "application/octet-stream";
const SANDBOX = "default-src 'none'; sandbox";

/** Upstream headers the proxy forwards; everything else storage sends is dropped. */
const FORWARDED = [
	"content-length",
	"content-range",
	"accept-ranges",
	"etag",
	"last-modified",
] as const;
const VALIDATORS = ["etag", "last-modified"] as const;

function baseMime(mime: string): string {
	return mime.toLowerCase().split(";")[0].trim();
}

/**
 * The `content-type` the proxy serves for a stored type. Inline-safe media keep their own type, SVG keeps
 * its type for `<img>` (script never runs there, and the sandbox CSP covers a navigation), text-like types
 * become `text/plain`, and everything else is `application/octet-stream`. Never `text/html`.
 */
export function proxyContentType(mime: string): string {
	const m = baseMime(mime);
	if (!MIME_TOKEN.test(m)) return OCTET_STREAM;
	if (inlineSafe(m)) return m === "text/plain" ? TEXT_PLAIN : m;
	if (m === "image/svg+xml") return m;
	if (TEXT_LIKE.test(m)) return TEXT_PLAIN;
	return OCTET_STREAM;
}

function rfc5987(value: string): string {
	return encodeURIComponent(value).replace(
		/['()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

function isControl(char: string): boolean {
	const code = char.charCodeAt(0);
	return code < 0x20 || code === 0x7f;
}

/**
 * A `content-disposition` value naming the file by its display name — never its storage path — with a
 * plain-ASCII `filename` for old clients and the exact name as RFC 5987 `filename*`.
 */
export function contentDisposition(name: string, inline: boolean): string {
	const printable = Array.from(name.toWellFormed()).filter((char) => !isControl(char)).join("");
	const clean = printable.replace(/[\\/]/g, "_").trim() || "file";
	const ascii = clean.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\x20-\x7e]/g, "_")
		.replace(/["%]/g, "_");
	return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${
		rfc5987(clean)
	}`;
}

/** What shapes the proxy's own headers beyond the object itself. */
export interface ProxyHeaderOptions {
	/** The caller asked for an attachment. */
	download: boolean;
	/** The read was authorised by a share slug — the response must not outlive the link. */
	share: boolean;
}

/** The proxy's own response headers for one object. Nothing here names a host, bucket or path. */
export function proxyHeaders(
	ref: Pick<ObjectRef, "mime" | "name">,
	opts: ProxyHeaderOptions,
): Headers {
	const safe = inlineSafe(ref.mime);
	const headers = new Headers({
		"content-type": proxyContentType(ref.mime),
		"content-disposition": contentDisposition(ref.name, safe && !opts.download),
		"cache-control": opts.share ? "private, no-store" : "private, no-transform, max-age=3600",
		vary: "cookie",
		"x-content-type-options": "nosniff",
		"cross-origin-resource-policy": "same-origin",
		"x-robots-tag": "noindex, nofollow",
		"referrer-policy": "no-referrer",
	});
	if (!safe) headers.set("content-security-policy", SANDBOX);
	return headers;
}

/** Copy the allowlisted upstream headers onto the proxy's own; a 304 carries only the validators. */
export function forwardHeaders(target: Headers, upstream: Headers, status: number): void {
	for (const name of status === 304 ? VALIDATORS : FORWARDED) {
		const value = upstream.get(name);
		if (value !== null) target.set(name, value);
	}
}

// #endregion

// #region Status map

/** How an upstream status is answered. */
export type UpstreamOutcome =
	| { kind: "forward"; status: 200 | 206 | 304 }
	| { kind: "unsatisfiable" }
	| { kind: "missing" };

/**
 * Storage's status, mapped: 200/206/304 pass through, 416 becomes a bodiless 416, and everything else —
 * including storage's 400 for a missing object — is the proxy's one 404.
 */
export function upstreamOutcome(status: number): UpstreamOutcome {
	if (status === 200 || status === 206 || status === 304) return { kind: "forward", status };
	if (status === 416) return { kind: "unsatisfiable" };
	return { kind: "missing" };
}

/**
 * An object's complete length from a `content-range` total (`bytes 0-99/N`), or from `content-length`
 * when the response is the whole object.
 */
export function completeLength(headers: Headers, wholeObject: boolean): number | null {
	const range = headers.get("content-range")?.match(/\/(\d+)\s*$/);
	if (range) return Number(range[1]);
	if (!wholeObject) return null;
	const length = headers.get("content-length")?.trim();
	return length && /^\d+$/.test(length) ? Number(length) : null;
}

// #endregion

// #region Rate limit

const streamLimiter = new SlidingWindowLimiter({ max: 1200, windowMs: 60_000 });

/**
 * Whose allowance a read spends: the share slug when one authorised it (a forged session cannot spend
 * someone else's), else the signed-in user. Anonymous public reads are unkeyed.
 */
export function streamLimitKey(actor: ReadActor, share: string | null): string | null {
	if (share) return `s:${share}`;
	if (actor.userId) return `u:${actor.userId}`;
	return null;
}

/** Only a fresh read counts — a seek's follow-up ranges would otherwise exhaust a long video. */
export function countsTowardLimit(range: string | null): boolean {
	return range === null || /^\s*bytes\s*=\s*0\s*-/i.test(range);
}

// #endregion

// #region Stream

const NOT_FOUND = "Not found.";
const UNREACHABLE = "We couldn't reach this file just now. Try again in a moment.";

async function discard(response: Response): Promise<void> {
	if (response.body && !response.bodyUsed) await response.body.cancel();
}

async function probeLength(ref: ObjectRef, signal: AbortSignal): Promise<number | null> {
	const head = await fetchStoredObject(ref.bucket, ref.path, { method: "HEAD", signal });
	const length = head.status === 200 ? completeLength(head.headers, true) : null;
	await discard(head);
	return length;
}

async function settle(
	upstream: Response,
	ref: ObjectRef,
	request: StreamRequest,
): Promise<StreamedAsset | null> {
	const outcome = upstreamOutcome(upstream.status);
	if (outcome.kind === "missing") {
		await discard(upstream);
		return null;
	}
	const headers = proxyHeaders(ref, { download: request.download, share: request.share !== null });
	if (outcome.kind === "unsatisfiable") {
		const known = completeLength(upstream.headers, false);
		await discard(upstream);
		const size = known ?? await probeLength(ref, request.signal);
		headers.set("accept-ranges", "bytes");
		if (size !== null) headers.set("content-range", `bytes */${size}`);
		return { status: 416, headers, body: null };
	}
	forwardHeaders(headers, upstream.headers, outcome.status);
	if (outcome.status === 304 || request.method === "HEAD") {
		await discard(upstream);
		return { status: outcome.status, headers, body: null };
	}
	return { status: outcome.status, headers, body: upstream.body };
}

/**
 * Stream an asset's bytes to a caller who may read it. 404 for every refusal (a malformed id, no such
 * file, not theirs, a dead share link, an object storage no longer has), 429 past the per-identity
 * ceiling, 503 when storage or the database cannot be reached.
 */
export async function streamAssetFor(
	actor: ReadActor,
	fileId: string,
	request: StreamRequest,
): Promise<ServiceResult<StreamedAsset>> {
	if (!isAssetId(fileId)) return fail(404, { message: NOT_FOUND });
	try {
		const ref = await objectFor(actor, fileId, { tier: request.tier, share: request.share });
		if (!ref) return fail(404, { message: NOT_FOUND });

		const key = streamLimitKey(actor, request.share);
		if (key && countsTowardLimit(request.range)) {
			const decision = streamLimiter.take(key);
			if (!decision.allowed) {
				return fail(429, {
					message: "Too many requests for files just now. Try again shortly.",
					details: { retryAt: new Date(Date.now() + decision.retryAfterMs).toISOString() },
				});
			}
		}

		const upstream = await fetchStoredObject(ref.bucket, ref.path, {
			method: request.method,
			range: request.range,
			ifRange: request.ifRange,
			ifNoneMatch: request.ifNoneMatch,
			ifModifiedSince: request.ifModifiedSince,
			signal: request.signal,
		});
		const streamed = await settle(upstream, ref, request);
		return streamed ? ok(streamed, { status: streamed.status }) : fail(404, { message: NOT_FOUND });
	} catch (error) {
		if (!request.signal.aborted) {
			console.error("[media:stream]", error instanceof Error ? error.message : error);
		}
		return fail(503, { message: UNREACHABLE });
	}
}

// #endregion
