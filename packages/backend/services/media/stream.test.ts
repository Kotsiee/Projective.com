import { assert, assertEquals, assertFalse } from "@std/assert";
import { ANONYMOUS_READER, type ReadActor } from "../read-actor.ts";
import {
	completeLength,
	contentDisposition,
	countsTowardLimit,
	forwardHeaders,
	proxyContentType,
	proxyHeaders,
	streamAssetFor,
	streamLimitKey,
	type StreamRequest,
	upstreamOutcome,
} from "./stream.ts";

/**
 * The media proxy's policy, pinned where a mistake is silent: a header that names storage, a markup type
 * served inline, a share read that outlives its link, a missing object that leaks as a 400.
 */

// #region Fixtures

const SIGNED_IN: ReadActor = {
	userId: "u-1",
	contextId: "u-1",
	contextType: "personal",
	accessToken: "t",
};

const OWN_HEADERS = [
	"cache-control",
	"content-disposition",
	"content-type",
	"cross-origin-resource-policy",
	"referrer-policy",
	"vary",
	"x-content-type-options",
	"x-robots-tag",
];

function names(headers: Headers): string[] {
	return [...headers.keys()].sort();
}

function request(overrides: Partial<StreamRequest> = {}): StreamRequest {
	return {
		method: "GET",
		tier: null,
		share: null,
		download: false,
		range: null,
		ifRange: null,
		ifNoneMatch: null,
		ifModifiedSince: null,
		signal: new AbortController().signal,
		...overrides,
	};
}

// #endregion

// #region Content type

Deno.test("proxyContentType keeps inline-safe media and never answers text/html", () => {
	assertEquals(proxyContentType("image/png"), "image/png");
	assertEquals(proxyContentType("IMAGE/JPEG; foo=bar"), "image/jpeg");
	assertEquals(proxyContentType("video/mp4"), "video/mp4");
	assertEquals(proxyContentType("audio/mpeg"), "audio/mpeg");
	assertEquals(proxyContentType("application/pdf"), "application/pdf");
	assertEquals(proxyContentType("text/plain"), "text/plain; charset=utf-8");
	assertEquals(proxyContentType("image/svg+xml"), "image/svg+xml");
	for (
		const textLike of [
			"text/html",
			"application/xhtml+xml",
			"text/markdown",
			"text/csv",
			"application/json",
			"application/javascript",
			"text/x-typescript",
			"application/x-yaml",
			"application/xml",
			"application/rss+xml",
		]
	) {
		assertEquals(proxyContentType(textLike), "text/plain; charset=utf-8", textLike);
	}
	for (
		const binary of [
			"model/gltf-binary",
			"font/woff2",
			"application/zip",
			"application/octet-stream",
			"",
			"audio/x y",
			"image/png\r\nx-evil: 1",
		]
	) {
		assertEquals(proxyContentType(binary), "application/octet-stream", binary);
	}
});

// #endregion

// #region Headers

Deno.test("proxyHeaders serves inline-safe media inline with no sandbox and a private cache", () => {
	const h = proxyHeaders({ mime: "image/png", name: "quadrants.png" }, {
		download: false,
		share: false,
	});
	assertEquals(names(h), OWN_HEADERS);
	assertEquals(
		h.get("content-disposition"),
		`inline; filename="quadrants.png"; filename*=UTF-8''quadrants.png`,
	);
	assertEquals(h.get("cache-control"), "private, no-transform, max-age=3600");
	assertEquals(h.get("vary"), "cookie");
	assertEquals(h.get("x-content-type-options"), "nosniff");
	assertEquals(h.get("cross-origin-resource-policy"), "same-origin");
	assertEquals(h.get("x-robots-tag"), "noindex, nofollow");
	assertEquals(h.get("referrer-policy"), "no-referrer");
});

Deno.test("proxyHeaders turns a download of a safe type into an attachment", () => {
	const h = proxyHeaders({ mime: "application/pdf", name: "brief.pdf" }, {
		download: true,
		share: false,
	});
	assert(h.get("content-disposition")?.startsWith("attachment;"));
	assertFalse(h.has("content-security-policy"));
});

Deno.test("proxyHeaders sandboxes and attaches every non-inline-safe type", () => {
	for (
		const [mime, type] of [
			["image/svg+xml", "image/svg+xml"],
			["text/html", "text/plain; charset=utf-8"],
			["application/zip", "application/octet-stream"],
		]
	) {
		const h = proxyHeaders({ mime, name: "x" }, { download: false, share: false });
		assertEquals(h.get("content-type"), type);
		assert(h.get("content-disposition")?.startsWith("attachment;"), mime);
		assertEquals(h.get("content-security-policy"), "default-src 'none'; sandbox");
	}
});

Deno.test("proxyHeaders never lets a share read be stored", () => {
	const h = proxyHeaders({ mime: "image/png", name: "x.png" }, { download: false, share: true });
	assertEquals(h.get("cache-control"), "private, no-store");
});

Deno.test("contentDisposition encodes non-ASCII, quotes and RFC 5987 specials", () => {
	assertEquals(
		contentDisposition("Café — résumé.pdf", false),
		`attachment; filename="Cafe _ resume.pdf"; filename*=UTF-8''Caf%C3%A9%20%E2%80%94%20r%C3%A9sum%C3%A9.pdf`,
	);
	assertEquals(
		contentDisposition(`say "hi" 100%.txt`, true),
		`inline; filename="say _hi_ 100_.txt"; filename*=UTF-8''say%20%22hi%22%20100%25.txt`,
	);
	assertEquals(
		contentDisposition("it's (1)*.txt", true),
		`inline; filename="it's (1)*.txt"; filename*=UTF-8''it%27s%20%281%29%2A.txt`,
	);
	assertEquals(
		contentDisposition("a/b\\c\r\n.txt", true),
		`inline; filename="a_b_c.txt"; filename*=UTF-8''a_b_c.txt`,
	);
	assertEquals(
		contentDisposition("   ", false),
		`attachment; filename="file"; filename*=UTF-8''file`,
	);
	assert(contentDisposition("bad\uD800.txt", false).includes("%EF%BF%BD"));
});

Deno.test("forwardHeaders copies only the allowlist, and only validators on a 304", () => {
	const upstream = new Headers({
		"content-length": "100",
		"content-range": "bytes 0-99/9877",
		"accept-ranges": "bytes",
		etag: `"abc"`,
		"last-modified": "Wed, 01 Oct 2026 00:00:00 GMT",
		"content-type": "text/html",
		"cache-control": "max-age=3600",
		"access-control-allow-origin": "*",
		via: "kong/2.8.1",
		"x-kong-upstream-latency": "3",
		"content-location": "/storage/v1/object/personal/u/x.png",
		"x-robots-tag": "none",
	});
	const target = new Headers();
	forwardHeaders(target, upstream, 206);
	assertEquals(names(target), [
		"accept-ranges",
		"content-length",
		"content-range",
		"etag",
		"last-modified",
	]);

	const notModified = new Headers();
	forwardHeaders(notModified, upstream, 304);
	assertEquals(names(notModified), ["etag", "last-modified"]);
});

// #endregion

// #region Status map

Deno.test("upstreamOutcome passes 200/206/304, keeps 416, and turns everything else into a 404", () => {
	assertEquals(upstreamOutcome(200), { kind: "forward", status: 200 });
	assertEquals(upstreamOutcome(206), { kind: "forward", status: 206 });
	assertEquals(upstreamOutcome(304), { kind: "forward", status: 304 });
	assertEquals(upstreamOutcome(416), { kind: "unsatisfiable" });
	for (const status of [400, 401, 403, 404, 302, 500, 503]) {
		assertEquals(upstreamOutcome(status), { kind: "missing" }, String(status));
	}
});

Deno.test("completeLength reads a content-range total, or a whole object's length", () => {
	assertEquals(completeLength(new Headers({ "content-range": "bytes 0-99/9877" }), false), 9877);
	assertEquals(completeLength(new Headers({ "content-range": "bytes */9877" }), false), 9877);
	assertEquals(completeLength(new Headers({ "content-length": "57" }), false), null);
	assertEquals(completeLength(new Headers({ "content-length": "9877" }), true), 9877);
	assertEquals(completeLength(new Headers({ "content-range": "bytes 0-99/*" }), false), null);
	assertEquals(completeLength(new Headers(), true), null);
});

// #endregion

// #region Rate limit + gate

Deno.test("streamLimitKey keys a share by its slug, a session by its user, and leaves visitors unkeyed", () => {
	assertEquals(streamLimitKey(SIGNED_IN, "slug-1"), "s:slug-1");
	assertEquals(streamLimitKey(SIGNED_IN, null), "u:u-1");
	assertEquals(streamLimitKey(ANONYMOUS_READER, "slug-1"), "s:slug-1");
	assertEquals(streamLimitKey(ANONYMOUS_READER, null), null);
});

Deno.test("countsTowardLimit counts fresh reads and first-byte ranges, never a seek", () => {
	assert(countsTowardLimit(null));
	assert(countsTowardLimit("bytes=0-"));
	assert(countsTowardLimit("bytes=0-99"));
	assert(countsTowardLimit(" Bytes = 0-1023"));
	assertFalse(countsTowardLimit("bytes=100-"));
	assertFalse(countsTowardLimit("bytes=1048576-2097151"));
});

Deno.test("streamAssetFor refuses a malformed id before any read", async () => {
	for (
		const id of ["", "not-a-uuid", "6d43f88f-84c7-4454-a2e1-c3bd6a2839e2/../x", "../etc/passwd"]
	) {
		const result = await streamAssetFor(ANONYMOUS_READER, id, request());
		assertEquals(result.ok, false);
		assertEquals(result.status, 404);
	}
});

// #endregion
