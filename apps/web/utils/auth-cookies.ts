/**
 * auth-cookies.ts — the app's session-cookie plumbing (HTTP layer).
 *
 * Fat services are transport-agnostic: they return the raw GoTrue tokens in a `ServiceResult`, and
 * the thin route mints the cookies here. We set our own canonical `sb-access-token` /
 * `sb-refresh-token` HttpOnly cookies (the names the `(dashboard)` middleware checks) rather than
 * leaning on any client library's storage keys, so password, OTP, and OAuth flows all converge on
 * one session representation. Tokens are HttpOnly — never readable from JS, never in a JSON body.
 */

/** Canonical session cookie names (checked by `routes/(dashboard)/_middleware.ts`). */
export const SB_ACCESS_COOKIE = "sb-access-token";
export const SB_REFRESH_COOKIE = "sb-refresh-token";

/** Refresh-token lifetime (30 days) — the access token is short-lived and refreshed against it. */
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;
/** Fallback access-token lifetime when GoTrue doesn't report `expires_in` (1 hour). */
const DEFAULT_ACCESS_MAX_AGE = 3600;

/** The GoTrue tokens a successful auth yields. */
export interface SessionTokens {
	accessToken: string;
	refreshToken: string;
	/** Seconds until the access token expires. */
	expiresIn?: number;
}

/** Whether we're in a production deployment (drives the `Secure` cookie attribute). */
function isProduction(): boolean {
	try {
		const env = (Deno.env.get("DENO_ENV") ?? "").toLowerCase();
		return env === "production";
	} catch {
		return false;
	}
}

function attributes(maxAge: number): string {
	const base = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
	return isProduction() ? `${base}; Secure` : base;
}

/** Build the `Set-Cookie` strings that establish a session. */
export function sessionSetCookies(tokens: SessionTokens): string[] {
	return [
		`${SB_ACCESS_COOKIE}=${encodeURIComponent(tokens.accessToken)}; ${
			attributes(tokens.expiresIn ?? DEFAULT_ACCESS_MAX_AGE)
		}`,
		`${SB_REFRESH_COOKIE}=${encodeURIComponent(tokens.refreshToken)}; ${
			attributes(REFRESH_MAX_AGE)
		}`,
	];
}

/** Build the `Set-Cookie` strings that clear a session (sign-out). */
export function sessionClearCookies(): string[] {
	return [
		`${SB_ACCESS_COOKIE}=; ${attributes(0)}`,
		`${SB_REFRESH_COOKIE}=; ${attributes(0)}`,
	];
}

/**
 * Serialise a {@link CookieStore} diff into `Set-Cookie` strings — used to persist the transient PKCE
 * code-verifier across the OAuth round-trip. Entries whose value is `null` (removed) are emitted as
 * clears (`Max-Age=0`); present values are set with `maxAge`. HttpOnly + Lax like the session cookies.
 */
export function oauthStoreCookies(
	diff: Array<{ key: string; value: string | null }>,
	maxAge: number,
): string[] {
	return diff.map(({ key, value }) =>
		value === null
			? `${key}=; ${attributes(0)}`
			: `${key}=${encodeURIComponent(value)}; ${attributes(maxAge)}`
	);
}

/** Parse a request's `Cookie` header into a plain record. */
export function readCookies(req: Request): Record<string, string> {
	const header = req.headers.get("cookie");
	const out: Record<string, string> = {};
	if (!header) return out;
	for (const part of header.split(";")) {
		const idx = part.indexOf("=");
		if (idx === -1) continue;
		const key = part.slice(0, idx).trim();
		if (key) out[key] = decodeURIComponent(part.slice(idx + 1).trim());
	}
	return out;
}
