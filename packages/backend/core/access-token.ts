import { verify } from "djwt";

/**
 * access-token — local verification of a Supabase (GoTrue) access token: signature, expiry and the
 * claims that make it a signed-in user's token rather than any project-signed JWT.
 *
 * Two key sources, chosen strictly by the token's `alg` so one can never stand in for the other:
 *  - asymmetric (`ES256` / `RS256`): the project's public JWKS at
 *    `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, matched by `kid`;
 *  - symmetric (`HS256`): the project's legacy JWT secret (`SUPABASE_JWT_SECRET`).
 *
 * The JWKS is cached for {@link JWKS_TTL_MS}. An unknown `kid` refetches at most once per
 * {@link JWKS_MIN_REFETCH_MS} (a rotation is picked up; a spray of made-up kids costs one fetch), and a
 * failed refetch keeps serving the keys already held. Only a verifier that has never obtained the
 * keys answers `unavailable` — an outage, not a verdict on the token.
 *
 * Local verification cannot see revocation: a signed-out session's token stays valid here until its
 * `exp`, and RLS (which re-verifies at PostgREST) remains the backstop.
 */

// #region Types
/** The decoded claims of a verified access token. */
export type AccessTokenPayload = Record<string, unknown>;

/** Why a token was refused. */
export type AccessTokenRejection =
	| "malformed"
	| "unsupported_alg"
	| "unknown_key"
	| "unconfigured"
	| "signature"
	| "expired"
	| "not_a_session";

/** The outcome of verifying one token. */
export type AccessTokenVerdict =
	| { status: "valid"; payload: AccessTokenPayload }
	| { status: "invalid"; reason: AccessTokenRejection }
	| { status: "unavailable" };

/** Where a verifier finds its keys. */
export interface AccessTokenVerifierOptions {
	/** The project JWKS URL; absent → asymmetric tokens are refused as `unconfigured`. */
	jwksUrl?: string;
	/** The legacy HS256 secret; absent or the `XXXX-XXXX` placeholder → HS256 tokens are refused. */
	hsSecret?: string;
	/** JWKS transport (tests inject one). Defaults to `fetch` with a {@link JWKS_TIMEOUT_MS} timeout. */
	fetchJwks?: (url: string) => Promise<Response>;
	/** Clock in epoch milliseconds (tests inject one). */
	now?: () => number;
}

/** Verifies access tokens against one project's keys. */
export interface AccessTokenVerifier {
	verify(token: string): Promise<AccessTokenVerdict>;
}
// #endregion

// #region Constants
/** How long a fetched JWKS is trusted before it is refetched (Supabase caches it for 10 minutes). */
export const JWKS_TTL_MS = 10 * 60 * 1000;
/** The floor between two refetches triggered by an unknown `kid`. */
export const JWKS_MIN_REFETCH_MS = 30 * 1000;
/** The cap on one JWKS fetch, so a hung auth server cannot hold a page render. */
export const JWKS_TIMEOUT_MS = 3000;
/** Clock skew tolerated on `exp`. */
export const EXP_LEEWAY_SECONDS = 30;

const PLACEHOLDER = "XXXX-XXXX";
const SESSION_AUDIENCE = "authenticated";

const ASYMMETRIC: Record<string, RsaHashedImportParams | EcKeyImportParams> = {
	ES256: { name: "ECDSA", namedCurve: "P-256" },
	RS256: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
};
// #endregion

// #region Helpers
interface Jwk extends JsonWebKey {
	kid?: string;
	use?: string;
}

function readHeader(token: string): { alg?: unknown; kid?: unknown } | null {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	try {
		const header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
		return header && typeof header === "object" ? header as { alg?: unknown; kid?: unknown } : null;
	} catch {
		return null;
	}
}

function hasAudience(aud: unknown): boolean {
	return aud === SESSION_AUDIENCE || (Array.isArray(aud) && aud.includes(SESSION_AUDIENCE));
}

function defaultFetch(url: string): Promise<Response> {
	return fetch(url, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) });
}

async function importJwk(jwk: Jwk): Promise<[string, CryptoKey] | null> {
	const alg = jwk.alg ?? (jwk.kty === "EC" ? "ES256" : jwk.kty === "RSA" ? "RS256" : undefined);
	const params = alg ? ASYMMETRIC[alg] : undefined;
	if (!jwk.kid || !params || (jwk.use && jwk.use !== "sig")) return null;
	try {
		const { kid: _kid, use: _use, key_ops: _ops, ...material } = jwk;
		const key = await crypto.subtle.importKey("jwk", material, params, false, ["verify"]);
		return [`${alg}:${jwk.kid}`, key];
	} catch {
		return null;
	}
}
// #endregion

// #region Verifier
/** Build a verifier with its own JWKS cache. */
export function createAccessTokenVerifier(
	options: AccessTokenVerifierOptions,
): AccessTokenVerifier {
	const fetchJwks = options.fetchJwks ?? defaultFetch;
	const now = options.now ?? Date.now;
	const secret = options.hsSecret && options.hsSecret !== PLACEHOLDER
		? options.hsSecret
		: undefined;

	let keys: Map<string, CryptoKey> | null = null;
	let fetchedAt = 0;
	let attemptedAt = Number.NEGATIVE_INFINITY;
	let inflight: Promise<void> | null = null;
	let hmac: Promise<CryptoKey> | null = null;

	function refresh(url: string): Promise<void> {
		inflight ??= (async () => {
			attemptedAt = now();
			try {
				const res = await fetchJwks(url);
				if (!res.ok) {
					await res.body?.cancel();
					return;
				}
				const body = await res.json() as { keys?: Jwk[] };
				const imported = await Promise.all((body.keys ?? []).map(importJwk));
				keys = new Map(imported.filter((entry) => entry !== null));
				fetchedAt = now();
			} catch (error) {
				console.warn("[auth:jwks]", url, error instanceof Error ? error.message : error);
			}
		})().finally(() => {
			inflight = null;
		});
		return inflight;
	}

	async function asymmetricKey(alg: string, kid: unknown): Promise<CryptoKey | AccessTokenVerdict> {
		if (!options.jwksUrl) return { status: "invalid", reason: "unconfigured" };
		if (typeof kid !== "string" || !kid) return { status: "invalid", reason: "unknown_key" };
		if (!keys || now() - fetchedAt > JWKS_TTL_MS) await refresh(options.jwksUrl);
		const cacheKey = `${alg}:${kid}`;
		if (keys && !keys.has(cacheKey) && now() - attemptedAt > JWKS_MIN_REFETCH_MS) {
			await refresh(options.jwksUrl);
		}
		const current = keys as Map<string, CryptoKey> | null;
		if (!current) return { status: "unavailable" };
		return current.get(cacheKey) ?? { status: "invalid", reason: "unknown_key" };
	}

	function symmetricKey(): Promise<CryptoKey> | AccessTokenVerdict {
		if (!secret) return { status: "invalid", reason: "unconfigured" };
		hmac ??= crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["verify"],
		);
		return hmac;
	}

	return {
		async verify(token: string): Promise<AccessTokenVerdict> {
			const header = readHeader(token);
			if (!header) return { status: "invalid", reason: "malformed" };
			const alg = header.alg;

			let key: CryptoKey | AccessTokenVerdict;
			if (alg === "HS256") key = await symmetricKey();
			else if (typeof alg === "string" && alg in ASYMMETRIC) {
				key = await asymmetricKey(alg, header.kid);
			} else return { status: "invalid", reason: "unsupported_alg" };
			if (!(key instanceof CryptoKey)) return key;

			let payload: AccessTokenPayload;
			try {
				payload = await verify(token, key, { ignoreExp: true });
			} catch {
				return { status: "invalid", reason: "signature" };
			}

			if (typeof payload.exp !== "number") return { status: "invalid", reason: "malformed" };
			if (payload.exp + EXP_LEEWAY_SECONDS < now() / 1000) {
				return { status: "invalid", reason: "expired" };
			}
			if (typeof payload.sub !== "string" || !payload.sub || !hasAudience(payload.aud)) {
				return { status: "invalid", reason: "not_a_session" };
			}
			return { status: "valid", payload };
		},
	};
}

/** The JWKS URL of a Supabase project. */
export function jwksUrlFor(supabaseUrl: string): string {
	return `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`;
}
// #endregion
