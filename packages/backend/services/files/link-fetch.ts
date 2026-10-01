import { isFetchableUrl, isForbiddenAddress, isIpLiteral } from "./link-guards.ts";

/**
 * link-fetch — the SSRF-hardened GET behind link scanning. A URL a stranger chose is fetched by the
 * SERVER, so every rule in `link-scan.ts`'s module note is applied here, on every hop:
 *
 * - `https:` on the standard port only, no credentials, no local-only names (`isFetchableUrl`);
 * - DNS is resolved FIRST and the hop is refused if ANY answer is a forbidden address — a name that
 *   resolves to one public and one private address is a rebinding attempt;
 * - the connection is made to the ADDRESS THAT WAS CHECKED. `fetch()` would resolve the name a second
 *   time, so this opens TCP to the pinned IP and upgrades it with TLS verified against the original
 *   hostname (`Deno.startTls`), then speaks a minimal HTTP/1.1 `GET` with `Connection: close`;
 * - at most `MAX_REDIRECTS` redirects, each re-validated from scratch;
 * - one deadline for the whole operation, enforced by closing the socket;
 * - the body is capped by READING it — `Content-Length` is the origin's claim, and a chunked response
 *   has none — and no cookie, credential or Authorization header is ever sent.
 *
 * The transport is injectable so the redirect and rebinding rules are tested without a network.
 */

// #region Limits
/** Maximum redirect hops; each is re-validated from scratch. */
export const MAX_REDIRECTS = 2;

/** Hard ceiling on one scan, in milliseconds. */
export const FETCH_TIMEOUT_MS = 5_000;

/** Maximum body bytes read from an origin. */
export const MAX_RESPONSE_BYTES = 512 * 1024;

const MAX_HEAD_BYTES = 32 * 1024;
const USER_AGENT = "ProjectiveLinkScanner/1.0 (+link previews; no tracking)";
// #endregion

// #region Shapes
/** One HTTP response as read off the wire. */
export interface RawResponse {
	status: number;
	headers: Headers;
	body: Uint8Array;
	/** The body was cut at the byte cap. */
	truncated: boolean;
}

/** A completed fetch: the final URL after redirects and its response. */
export interface FetchedPage extends RawResponse {
	url: string;
}

/**
 * Why a fetch did not complete. `refused` is a guard saying no — the link points somewhere the
 * platform will not go, which is a fact about the LINK. `unreachable` is the network failing — a fact
 * about the moment, never evidence against the link.
 */
export type FetchFailure =
	| { kind: "refused"; reason: string }
	| { kind: "unreachable"; reason: string };

export type FetchOutcome = { ok: true; page: FetchedPage } | { ok: false; failure: FetchFailure };

/** The two network operations a fetch needs; the default speaks to the real network. */
export interface LinkTransport {
	resolve(hostname: string, deadline: number): Promise<string[]>;
	request(
		url: URL,
		address: string,
		deadline: number,
		maxBytes: number,
		accept: string,
	): Promise<RawResponse>;
}
// #endregion

// #region Wire format
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The request head for one GET. */
export function requestHead(url: URL, accept: string): string {
	return [
		`GET ${url.pathname || "/"}${url.search} HTTP/1.1`,
		`Host: ${url.host}`,
		`User-Agent: ${USER_AGENT}`,
		`Accept: ${accept}`,
		"Accept-Encoding: identity",
		"Connection: close",
		"",
		"",
	].join("\r\n");
}

function indexOfSequence(bytes: Uint8Array, seq: number[], from = 0): number {
	outer: for (let i = from; i <= bytes.length - seq.length; i++) {
		for (let j = 0; j < seq.length; j++) if (bytes[i + j] !== seq[j]) continue outer;
		return i;
	}
	return -1;
}

const CRLF = [13, 10];
const CRLFCRLF = [13, 10, 13, 10];

/** Parse a status line + headers. Returns null until the head is complete. */
export function parseResponseHead(
	bytes: Uint8Array,
): { status: number; headers: Headers; bodyStart: number } | null {
	const end = indexOfSequence(bytes, CRLFCRLF);
	if (end < 0) return null;
	const lines = decoder.decode(bytes.subarray(0, end)).split("\r\n");
	const statusMatch = lines[0].match(/^HTTP\/1\.[01] (\d{3})/);
	if (!statusMatch) throw new Error("Malformed status line.");
	const headers = new Headers();
	for (const line of lines.slice(1)) {
		const colon = line.indexOf(":");
		if (colon <= 0) continue;
		try {
			headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
		} catch {
			continue;
		}
	}
	return { status: Number(statusMatch[1]), headers, bodyStart: end + 4 };
}

/**
 * Decode a chunked body as far as it goes. `complete` is true once the terminating zero-size chunk
 * has been seen; a body cut short simply decodes to what arrived.
 */
export function decodeChunked(
	bytes: Uint8Array,
	maxBytes: number,
): { body: Uint8Array; complete: boolean } {
	const parts: Uint8Array[] = [];
	let total = 0;
	let pos = 0;
	while (pos < bytes.length) {
		const lineEnd = indexOfSequence(bytes, CRLF, pos);
		if (lineEnd < 0) break;
		const size = parseInt(decoder.decode(bytes.subarray(pos, lineEnd)).split(";")[0].trim(), 16);
		if (!Number.isFinite(size) || size < 0) break;
		if (size === 0) return { body: concat(parts, total), complete: true };
		const start = lineEnd + 2;
		const take = Math.min(size, bytes.length - start, maxBytes - total);
		if (take > 0) {
			parts.push(bytes.subarray(start, start + take));
			total += take;
		}
		if (total >= maxBytes || start + size > bytes.length) break;
		pos = start + size + 2;
	}
	return { body: concat(parts, total), complete: false };
}

function concat(parts: Uint8Array[], total: number): Uint8Array {
	const out = new Uint8Array(total);
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

/** Whether a response's body has fully arrived, so reading can stop before the peer closes. */
function bodyComplete(headers: Headers, body: Uint8Array): boolean {
	if ((headers.get("transfer-encoding") ?? "").toLowerCase().includes("chunked")) {
		return indexOfSequence(body, [48, 13, 10, 13, 10]) >= 0 &&
			decodeChunked(body, Number.MAX_SAFE_INTEGER).complete;
	}
	const length = Number(headers.get("content-length"));
	return Number.isFinite(length) && headers.has("content-length") && body.length >= length;
}

/** Turn the raw bytes after the head into a capped body. */
export function finishBody(
	headers: Headers,
	raw: Uint8Array,
	maxBytes: number,
): { body: Uint8Array; truncated: boolean } {
	if ((headers.get("transfer-encoding") ?? "").toLowerCase().includes("chunked")) {
		const { body, complete } = decodeChunked(raw, maxBytes);
		return { body, truncated: !complete };
	}
	const declared = Number(headers.get("content-length"));
	const limit = headers.has("content-length") && Number.isFinite(declared)
		? Math.min(declared, maxBytes)
		: maxBytes;
	return { body: raw.slice(0, limit), truncated: raw.length > maxBytes };
}
// #endregion

// #region The real network
async function writeAll(conn: Deno.Conn, bytes: Uint8Array): Promise<void> {
	let written = 0;
	while (written < bytes.length) written += await conn.write(bytes.subarray(written));
}

/** Read one HTTP/1.1 response from a connection, at most `maxBytes` of body. */
async function readResponse(conn: Deno.Conn, maxBytes: number): Promise<RawResponse> {
	const chunk = new Uint8Array(16 * 1024);
	let buffer = new Uint8Array(0);
	let head: ReturnType<typeof parseResponseHead> = null;
	const slack = 64 * 1024;
	while (true) {
		const n = await conn.read(chunk);
		if (n === null) break;
		const next = new Uint8Array(buffer.length + n);
		next.set(buffer);
		next.set(chunk.subarray(0, n), buffer.length);
		buffer = next;
		if (!head) {
			head = parseResponseHead(buffer);
			if (!head && buffer.length > MAX_HEAD_BYTES) throw new Error("Response headers too large.");
			if (!head) continue;
		}
		const body = buffer.subarray(head.bodyStart);
		if (body.length >= maxBytes + slack || bodyComplete(head.headers, body)) break;
	}
	if (!head) head = parseResponseHead(buffer);
	if (!head) throw new Error("The connection closed before a response arrived.");
	const { body, truncated } = finishBody(head.headers, buffer.subarray(head.bodyStart), maxBytes);
	return { status: head.status, headers: head.headers, body, truncated };
}

/** The default transport: real DNS, real sockets. */
export const networkTransport: LinkTransport = {
	async resolve(hostname, deadline) {
		const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
		const [a, aaaa] = await Promise.allSettled([
			Deno.resolveDns(hostname, "A", { signal }),
			Deno.resolveDns(hostname, "AAAA", { signal }),
		]);
		return [
			...(a.status === "fulfilled" ? a.value : []),
			...(aaaa.status === "fulfilled" ? aaaa.value : []),
		];
	},
	async request(url, address, deadline, maxBytes, accept) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error("timed out");
		let conn: Deno.Conn | null = null;
		let closed = false;
		const close = () => {
			if (closed) return;
			closed = true;
			try {
				conn?.close();
			} catch {
				// Already closed by the peer.
			}
		};
		const timer = setTimeout(close, remaining);
		try {
			const tcp = await Deno.connect({ hostname: address, port: 443, transport: "tcp" });
			conn = tcp;
			if (closed) throw new Error("timed out");
			const tls = await Deno.startTls(tcp, { hostname: url.hostname });
			conn = tls;
			await writeAll(tls, encoder.encode(requestHead(url, accept)));
			return await readResponse(tls, maxBytes);
		} catch (error) {
			if (closed) throw new Error("timed out");
			throw error;
		} finally {
			clearTimeout(timer);
			close();
		}
	},
};

/** The `Accept` a page fetch sends. */
export const PAGE_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1";
// #endregion

// #region Fetch
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Options for one guarded fetch. */
export interface GuardedFetchOptions {
	maxBytes?: number;
	/** Absolute deadline (epoch ms); defaults to now + {@link FETCH_TIMEOUT_MS}. */
	deadline?: number;
	/** The `Accept` header (an icon fetch asks for images). */
	accept?: string;
	transport?: LinkTransport;
}

/** GET a URL under every guard above. Never throws: every failure is a {@link FetchFailure}. */
export async function guardedFetch(
	raw: string,
	options: GuardedFetchOptions = {},
): Promise<FetchOutcome> {
	const transport = options.transport ?? networkTransport;
	const deadline = options.deadline ?? Date.now() + FETCH_TIMEOUT_MS;
	const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
	let current = raw;

	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		if (!isFetchableUrl(current)) {
			return {
				ok: false,
				failure: {
					kind: "refused",
					reason: hop === 0
						? "Only secure (https) links to public sites are checked."
						: "The link redirects somewhere the platform will not follow.",
				},
			};
		}
		const url = new URL(current);
		const host = url.hostname.replace(/^\[|\]$/g, "");

		let addresses: string[];
		try {
			addresses = isIpLiteral(host) ? [host] : await transport.resolve(host, deadline);
		} catch {
			return {
				ok: false,
				failure: { kind: "unreachable", reason: "The site could not be found." },
			};
		}
		if (addresses.length === 0) {
			return {
				ok: false,
				failure: { kind: "unreachable", reason: "The site could not be found." },
			};
		}
		if (addresses.some(isForbiddenAddress)) {
			return {
				ok: false,
				failure: { kind: "refused", reason: "The link resolves into a private network." },
			};
		}

		let response: RawResponse;
		try {
			response = await transport.request(
				url,
				addresses[0],
				deadline,
				maxBytes,
				options.accept ?? PAGE_ACCEPT,
			);
		} catch (error) {
			const reason = error instanceof Error && error.message === "timed out"
				? "The site took too long to answer."
				: "The site could not be reached.";
			return { ok: false, failure: { kind: "unreachable", reason } };
		}

		const location = response.headers.get("location");
		if (REDIRECTS.has(response.status) && location) {
			try {
				current = new URL(location, url).href;
			} catch {
				return {
					ok: false,
					failure: { kind: "unreachable", reason: "The site redirected nowhere." },
				};
			}
			continue;
		}
		return { ok: true, page: { ...response, url: url.href } };
	}
	return { ok: false, failure: { kind: "refused", reason: "The link redirects too many times." } };
}
// #endregion
