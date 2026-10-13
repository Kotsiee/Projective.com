/**
 * session.ts — the HTTP-layer session orchestrator (refresh-before-redirect).
 *
 * Sits between the raw cookie plumbing ({@link readCookies} / {@link sessionSetCookies}) and the fat
 * {@link AuthBackendService}: given a request, it decides whether a live session exists and, when the
 * short-lived access token has expired but a valid refresh token remains, **silently renews** the
 * session rather than treating it as signed-out. This is what stops an active user from being kicked
 * to `/login` roughly every hour (when the ~1h access cookie is dropped) while a 30-day refresh cookie
 * is still valid.
 *
 * Server-only glue — imported by `routes/(dashboard)/_middleware.ts` (and safe for any route/handler).
 * Islands never import it (it reaches the fat service). The renewal is a no-op for a normal session
 * whose access cookie verifies (the fast path, checked locally against cached keys), and never fires
 * for a guest (no refresh cookie), so it adds no network cost to the common case.
 */

import {
	readCookies,
	SB_ACCESS_COOKIE,
	SB_REFRESH_COOKIE,
	sessionClearCookies,
	sessionSetCookies,
} from "@web/utils/auth-cookies.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";
import { GUEST_CONTEXT, type UserContext } from "@projective/types/auth";
import { resolveRequestContext } from "@web/utils/user-context.ts";

/** The resolved session decision for a request. */
export interface SessionState {
	/** Whether the request carries (or was just renewed into) a live session. */
	authenticated: boolean;
	/** True when the access token was just renewed from the refresh token this request. */
	refreshed: boolean;
	/** The access token to scope this request to (the current cookie, or the freshly-minted one). */
	accessToken?: string;
	/** `Set-Cookie`s to append to a PROCEEDING response (the renewed session). Empty on the fast path. */
	setCookies: string[];
	/**
	 * `Set-Cookie`s to append to a BOUNCE response (clears a dead session). Empty unless the refresh
	 * was refused, or an invalid access cookie came with no refresh cookie.
	 */
	clearCookies: string[];
	/**
	 * True when the session could not be checked because GoTrue was unreachable or failing. The
	 * request is not authenticated, but nothing says it is signed out either.
	 */
	unavailable: boolean;
}

/**
 * What a request's `sb-access-token` cookie proves: `absent`; `valid` (verified, or a presence-trusted
 * dev stub session); `invalid` (tampered, expired, foreign); `unavailable` (the signing keys could not
 * be obtained, so nothing is known).
 */
export type AccessCookieStatus = "absent" | "valid" | "invalid" | "unavailable";

const accessChecks = new WeakMap<Request, Promise<AccessCookieStatus>>();

/**
 * Verify the request's access cookie via {@link AuthBackendService.verifyAccessToken}, once per
 * request: the global middleware and a group guard share the same check.
 */
export function verifyAccessCookie(req: Request): Promise<AccessCookieStatus> {
	let check = accessChecks.get(req);
	if (!check) {
		const token = readCookies(req)[SB_ACCESS_COOKIE];
		check = token
			? AuthBackendService.verifyAccessToken(token).then((result) =>
				result.ok ? "valid" : result.status === 503 ? "unavailable" : "invalid"
			)
			: Promise.resolve("absent");
		accessChecks.set(req, check);
	}
	return check;
}

/** Who a request is, as far as its access cookie alone proves. */
export interface RequestViewer {
	/** Whether the access cookie verified. */
	isAuthenticated: boolean;
	/** The chrome context from the verified token's claims, or the guest context. */
	userContext: UserContext;
}

/**
 * The site-wide viewer the global middleware stamps on every request: signed in only when the access
 * cookie verifies, so a tampered or expired cookie paints a guest. Never renews (see
 * {@link ensureSession} for that).
 */
export async function resolveRequestViewer(req: Request): Promise<RequestViewer> {
	const isAuthenticated = (await verifyAccessCookie(req)) === "valid";
	return {
		isAuthenticated,
		userContext: isAuthenticated ? resolveRequestContext(req) : GUEST_CONTEXT,
	};
}

/**
 * Resolve the request's session, renewing it in place when possible.
 *
 * 1. Access cookie verified ({@link verifyAccessCookie}) → authenticated (fast path, no network).
 * 2. Access cookie absent, or present but invalid or expired, with a refresh cookie → try
 *    {@link AuthBackendService.refreshSession}; on success return the renewed tokens as `setCookies`
 *    for the caller to mint; on a refused grant return `clearCookies` so the caller wipes the dead
 *    session as it bounces. An unreachable GoTrue leaves `clearCookies` empty: the caller still
 *    bounces, but the session survives the outage.
 * 3. An invalid access cookie and no refresh cookie → unauthenticated, with `clearCookies`.
 * 4. Neither cookie → unauthenticated.
 *
 * The signing keys being unobtainable is an outage too: `unavailable`, cookies kept.
 */
export async function ensureSession(req: Request): Promise<SessionState> {
	const cookies = readCookies(req);
	const access = await verifyAccessCookie(req);

	if (access === "valid") {
		return {
			authenticated: true,
			refreshed: false,
			accessToken: cookies[SB_ACCESS_COOKIE],
			setCookies: [],
			clearCookies: [],
			unavailable: false,
		};
	}

	if (access === "unavailable") {
		return {
			authenticated: false,
			refreshed: false,
			setCookies: [],
			clearCookies: [],
			unavailable: true,
		};
	}

	const refresh = cookies[SB_REFRESH_COOKIE];
	if (!refresh) {
		return {
			authenticated: false,
			refreshed: false,
			setCookies: [],
			clearCookies: access === "invalid" ? sessionClearCookies(req) : [],
			unavailable: false,
		};
	}

	const result = await AuthBackendService.refreshSession(refresh);
	if (result.ok && result.session) {
		return {
			authenticated: true,
			refreshed: true,
			accessToken: result.session.accessToken,
			setCookies: sessionSetCookies(req, result.session),
			clearCookies: [],
			unavailable: false,
		};
	}

	// Only a refused grant (401) proves the session dead; an outage keeps the cookies for the next try.
	const refused = result.status === 401;
	return {
		authenticated: false,
		refreshed: false,
		setCookies: [],
		clearCookies: refused ? sessionClearCookies(req) : [],
		unavailable: !refused,
	};
}

/**
 * Force a token renewal for a request that already has a live access cookie.
 *
 * {@link ensureSession} renews only when the access cookie is GONE, which is right for the question
 * it answers ("is there a session?"). This answers a different one: the token is valid but a CLAIM on
 * it is stale, and the only way to re-read a claim is to have GoTrue mint a new token — the
 * access-token hook re-runs on the refresh grant, so a claim that changed in the database since the
 * last issuance is picked up here and nowhere else.
 *
 * The caller that needs it is the onboarding gate. Completing `/join` writes `org.users_public` and
 * changes nothing about the token already in the browser, so without this the guard would read
 * `onboarded: false` off a token minted seconds earlier, bounce the user back to `/join`, and get
 * `User has already completed onboarding` — a loop with no exit. One renewal turns that into a single
 * extra round trip on the first request after onboarding.
 *
 * Returns `null` when there is nothing to renew from or the renewal failed, and deliberately does NOT
 * clear cookies in that case: the session presented is still perfectly valid, and signing someone out
 * because a claim could not be re-read would be a far worse answer than carrying on with the stale one.
 *
 * **Rotation makes minting the result mandatory.** A successful refresh spends the presented refresh
 * token, so a caller that drops `setCookies` leaves the browser holding one GoTrue will refuse.
 */
export async function renewSession(req: Request): Promise<SessionState | null> {
	const refresh = readCookies(req)[SB_REFRESH_COOKIE];
	if (!refresh) return null;

	const result = await AuthBackendService.refreshSession(refresh);
	if (!result.ok || !result.session) return null;

	return {
		authenticated: true,
		refreshed: true,
		accessToken: result.session.accessToken,
		setCookies: sessionSetCookies(req, result.session),
		clearCookies: [],
		unavailable: false,
	};
}

/**
 * Answer a mutation that changed the caller's token claims (an acting-context switch, a persona
 * unlock) with the session re-issued server-side.
 *
 * The access-token hook only re-reads claims on a refresh grant, so the mutation route renews the
 * session itself rather than trusting every caller to follow up with `POST /api/auth/refresh`. The
 * rotated cookies ride this response. When the renewal fails the old cookies are left untouched and
 * the body carries `claimsStale: true`: the mutation happened, but the token still holds the old
 * claims, and the caller decides how to say so.
 */
export async function respondWithReissuedSession<B extends object>(
	req: Request,
	body: B,
	status: number,
): Promise<Response> {
	const renewed = await renewSession(req);
	const res = Response.json({ ...body, claimsStale: renewed === null }, { status });
	for (const cookie of renewed?.setCookies ?? []) res.headers.append("set-cookie", cookie);
	return res;
}
