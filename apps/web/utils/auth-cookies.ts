/**
 * auth-cookies.ts — the app's session-cookie plumbing (HTTP layer).
 *
 * Fat services are transport-agnostic: they return the raw GoTrue tokens in a `ServiceResult`, and
 * the thin route mints the cookies here. We set our own canonical `sb-access-token` /
 * `sb-refresh-token` HttpOnly cookies (the names the `(dashboard)` middleware checks) rather than
 * leaning on any client library's storage keys, so password, OTP, and OAuth flows all converge on
 * one session representation. Tokens are HttpOnly — never readable from JS, never in a JSON body.
 *
 * Every builder takes the request it answers: `Secure` follows the scheme the browser actually used
 * ({@link isSecureRequest}), and a renewal keeps the lifetime the sign-in chose ({@link SessionTokens}
 * `remember`, carried between requests by {@link SESSION_TRANSIENT_COOKIE}).
 */

import type { SessionTokens } from "@server/services/ServiceResult.ts";
import { isProductionEnv } from "@web/utils/app-env.ts";

export type { SessionTokens };

/** Canonical session cookie names (checked by `routes/(dashboard)/_middleware.ts`). */
export const SB_ACCESS_COOKIE = "sb-access-token";
export const SB_REFRESH_COOKIE = "sb-refresh-token";

/**
 * Present (HttpOnly, browser-session lifetime) while the signed-in session was started WITHOUT "Keep
 * me signed in". Its absence means a remembered session, so sessions minted before it existed keep
 * their 30-day refresh cookie.
 */
export const SESSION_TRANSIENT_COOKIE = "pj_session_transient";

/** Refresh-token lifetime for a remembered session (30 days). */
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;
/** Fallback access-token lifetime when GoTrue doesn't report `expires_in` (1 hour). */
const DEFAULT_ACCESS_MAX_AGE = 3600;

/**
 * Whether cookies minted for this request must carry `Secure`: always in production (`DENO_ENV`
 * unset included), otherwise whenever the browser reached us over HTTPS — directly, or through a
 * TLS-terminating proxy that reports it in `X-Forwarded-Proto` (first hop wins). Plain
 * `http://localhost` under `DENO_ENV=development` stays insecure.
 */
export function isSecureRequest(req: Request): boolean {
	if (isProductionEnv()) return true;
	if (new URL(req.url).protocol === "https:") return true;
	const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
	return forwarded === "https";
}

/**
 * Whether the request belongs to a remembered session (no {@link SESSION_TRANSIENT_COOKIE}) — the
 * lifetime a renewal re-mints when the tokens themselves don't say.
 */
export function isRememberedSession(req: Request): boolean {
	return !readCookies(req)[SESSION_TRANSIENT_COOKIE];
}

function attributes(secure: boolean, maxAge: number | null): string {
	const base = "Path=/; HttpOnly; SameSite=Lax";
	const lifetime = maxAge === null ? base : `${base}; Max-Age=${maxAge}`;
	return secure ? `${lifetime}; Secure` : lifetime;
}

/**
 * Build the `Set-Cookie` strings that establish (or renew) a session. A remembered session's refresh
 * cookie lives 30 days; otherwise it has no `Max-Age` and ends with the browser session, and the
 * transient flag is set beside it so the next renewal keeps it that way. `tokens.remember` decides
 * when present; a renewal leaves it unset and inherits the request's choice.
 */
export function sessionSetCookies(req: Request, tokens: SessionTokens): string[] {
	const secure = isSecureRequest(req);
	const remember = tokens.remember ?? isRememberedSession(req);
	const cookies = [
		`${SB_ACCESS_COOKIE}=${encodeURIComponent(tokens.accessToken)}; ${
			attributes(secure, tokens.expiresIn ?? DEFAULT_ACCESS_MAX_AGE)
		}`,
		`${SB_REFRESH_COOKIE}=${encodeURIComponent(tokens.refreshToken)}; ${
			attributes(secure, remember ? REFRESH_MAX_AGE : null)
		}`,
	];
	if (!remember) {
		cookies.push(`${SESSION_TRANSIENT_COOKIE}=1; ${attributes(secure, null)}`);
	} else if (!isRememberedSession(req)) {
		cookies.push(`${SESSION_TRANSIENT_COOKIE}=; ${attributes(secure, 0)}`);
	}
	return cookies;
}

/**
 * The signed pending-verification cookie (Decision #185) that binds `/verify`'s confirmation poll to
 * the browser that joined or signed in unconfirmed. Scoped to the auth API and `SameSite=Strict`: it
 * is only ever sent by the poll's same-origin fetch.
 */
export const PENDING_VERIFICATION_COOKIE = "pj_pending_verification";

/** Build the `Set-Cookie` string that stores a pending-verification token for `maxAge` seconds. */
export function pendingVerificationSetCookie(
	req: Request,
	token: string,
	maxAge: number,
): string {
	const base = `${PENDING_VERIFICATION_COOKIE}=${
		encodeURIComponent(token)
	}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
	return isSecureRequest(req) ? `${base}; Secure` : base;
}

/** Build the `Set-Cookie` strings that clear a session (sign-out), its transient flag included. */
export function sessionClearCookies(req: Request): string[] {
	const secure = isSecureRequest(req);
	const cookies = [
		`${SB_ACCESS_COOKIE}=; ${attributes(secure, 0)}`,
		`${SB_REFRESH_COOKIE}=; ${attributes(secure, 0)}`,
	];
	if (!isRememberedSession(req)) {
		cookies.push(`${SESSION_TRANSIENT_COOKIE}=; ${attributes(secure, 0)}`);
	}
	return cookies;
}

/**
 * Serialise a {@link CookieStore} diff into `Set-Cookie` strings — used to persist the transient PKCE
 * code-verifier across the OAuth round-trip. Entries whose value is `null` (removed) are emitted as
 * clears (`Max-Age=0`); present values are set with `maxAge`. HttpOnly + Lax like the session cookies.
 */
export function oauthStoreCookies(
	req: Request,
	diff: Array<{ key: string; value: string | null }>,
	maxAge: number,
): string[] {
	const secure = isSecureRequest(req);
	return diff.map(({ key, value }) =>
		value === null
			? `${key}=; ${attributes(secure, 0)}`
			: `${key}=${encodeURIComponent(value)}; ${attributes(secure, maxAge)}`
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
