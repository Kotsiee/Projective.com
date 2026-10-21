/**
 * sigv4 — AWS Signature Version 4, header-signed and pre-signed, on WebCrypto alone.
 *
 * The caller hands over the request ALREADY in canonical form: `canonicalPath` is the URI-encoded path
 * exactly as it will be sent, and the query is a list of raw pairs. Signing a `URL` object's
 * `pathname` instead would sign the WHATWG parser's encoding, which leaves `+`, `=`, `(` and `!` bare
 * where AWS's canonical form encodes them — and a key containing one would fail with
 * `SignatureDoesNotMatch` only in production. {@link encodeKeyPath} produces the matching path.
 *
 * Verified against the AWS SigV4 test suite vectors in `sigv4.test.ts`.
 */

// #region Shapes

/** A key pair, plus the session token a temporary (STS) credential carries. */
export interface SigV4Credentials {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken: string | null;
}

/** One request in canonical form. */
export interface SigV4Request {
	method: string;
	host: string;
	/** The URI-encoded path as sent, e.g. `/bucket/a%20b.txt`. */
	canonicalPath: string;
	/** Raw (unencoded) query pairs; order does not matter. */
	query: [string, string][];
	region: string;
	service: string;
	/** `YYYYMMDD'T'HHMMSS'Z'`. */
	amzDate: string;
}

/** A header-signed request: the headers to send, and the intermediate forms for inspection. */
export interface SignedHeaders {
	headers: Record<string, string>;
	canonicalRequest: string;
	stringToSign: string;
	signature: string;
}

// #endregion

// #region Encoding

const HEX = "0123456789abcdef";

function hex(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += HEX[b >> 4] + HEX[b & 15];
	return out;
}

/** RFC 3986 encoding as SigV4 defines it: everything but `A–Z a–z 0–9 - _ . ~` is percent-encoded. */
export function uriEncode(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

/** An object key as a canonical path: each segment encoded once, `/` separators kept. */
export function encodeKeyPath(key: string): string {
	return key.split("/").map(uriEncode).join("/");
}

/** The canonical query string: encoded names and values, sorted by name then value. */
export function canonicalQuery(query: readonly [string, string][]): string {
	return query
		.map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
		.sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
		.map(([k, v]) => `${k}=${v}`)
		.join("&");
}

/** `YYYYMMDD'T'HHMMSS'Z'` for an instant. */
export function amzDateOf(at: Date): string {
	return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// #endregion

// #region Crypto

const encoder = new TextEncoder();

/** Lower-case hex SHA-256 of a UTF-8 string. */
export async function sha256Hex(value: string): Promise<string> {
	return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function hmac(key: Uint8Array<ArrayBuffer>, value: string): Promise<Uint8Array<ArrayBuffer>> {
	const imported = await crypto.subtle.importKey(
		"raw",
		key,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(value)));
}

async function signingKey(
	secret: string,
	date: string,
	region: string,
	service: string,
): Promise<Uint8Array<ArrayBuffer>> {
	const kDate = await hmac(encoder.encode(`AWS4${secret}`), date);
	const kRegion = await hmac(kDate, region);
	const kService = await hmac(kRegion, service);
	return hmac(kService, "aws4_request");
}

// #endregion

// #region Signing

function scopeOf(req: SigV4Request): string {
	return `${req.amzDate.slice(0, 8)}/${req.region}/${req.service}/aws4_request`;
}

async function sign(
	req: SigV4Request,
	credentials: SigV4Credentials,
	query: readonly [string, string][],
	headers: Record<string, string>,
	payloadHash: string,
): Promise<Omit<SignedHeaders, "headers"> & { signedHeaders: string }> {
	const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
	const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
	const canonicalHeaders = names.map((h) => `${h}:${lower[h].trim().replace(/\s+/g, " ")}\n`).join(
		"",
	);
	const signedHeaders = names.join(";");
	const canonicalRequest = [
		req.method,
		req.canonicalPath,
		canonicalQuery(query),
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	].join("\n");
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		req.amzDate,
		scopeOf(req),
		await sha256Hex(canonicalRequest),
	].join("\n");
	const key = await signingKey(
		credentials.secretAccessKey,
		req.amzDate.slice(0, 8),
		req.region,
		req.service,
	);
	const signature = hex(await hmac(key, stringToSign));
	return { canonicalRequest, stringToSign, signature, signedHeaders };
}

/**
 * Sign a request in the `Authorization` header. `headers` are the extra headers to sign besides
 * `host` and `x-amz-date` (S3 also wants `x-amz-content-sha256`); a session token is signed as
 * `x-amz-security-token`.
 */
export async function signRequest(
	req: SigV4Request,
	credentials: SigV4Credentials,
	payloadHash: string,
	headers: Record<string, string> = {},
): Promise<SignedHeaders> {
	const sent: Record<string, string> = { ...headers, "x-amz-date": req.amzDate };
	if (credentials.sessionToken) sent["x-amz-security-token"] = credentials.sessionToken;
	const signed = await sign(req, credentials, req.query, { ...sent, host: req.host }, payloadHash);
	return {
		headers: {
			...sent,
			authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scopeOf(req)}, ` +
				`SignedHeaders=${signed.signedHeaders}, Signature=${signed.signature}`,
		},
		canonicalRequest: signed.canonicalRequest,
		stringToSign: signed.stringToSign,
		signature: signed.signature,
	};
}

/**
 * A pre-signed URL: the signature rides in the query, only `host` is signed and the payload is
 * `UNSIGNED-PAYLOAD`, so whoever holds the URL may make exactly this request until it expires.
 */
export async function presignUrl(
	req: SigV4Request,
	credentials: SigV4Credentials,
	expiresSeconds: number,
	origin: string,
): Promise<string> {
	const query: [string, string][] = [
		...req.query,
		["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
		["X-Amz-Credential", `${credentials.accessKeyId}/${scopeOf(req)}`],
		["X-Amz-Date", req.amzDate],
		["X-Amz-Expires", String(Math.max(1, Math.min(604_800, Math.floor(expiresSeconds))))],
		["X-Amz-SignedHeaders", "host"],
	];
	if (credentials.sessionToken) query.push(["X-Amz-Security-Token", credentials.sessionToken]);
	const signed = await sign(req, credentials, query, { host: req.host }, "UNSIGNED-PAYLOAD");
	return `${origin}${req.canonicalPath}?${
		canonicalQuery(query)
	}&X-Amz-Signature=${signed.signature}`;
}

// #endregion
