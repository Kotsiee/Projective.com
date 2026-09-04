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
 * whose access cookie is still present (the fast path), and never fires for a guest (no refresh
 * cookie), so it adds no cost to the common case.
 */

import {
	readCookies,
	SB_ACCESS_COOKIE,
	SB_REFRESH_COOKIE,
	sessionClearCookies,
	sessionSetCookies,
} from "@web/utils/auth-cookies.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

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
	/** `Set-Cookie`s to append to a BOUNCE response (clears a dead session). Empty unless refresh failed. */
	clearCookies: string[];
}

/**
 * Resolve the request's session, renewing it in place when possible.
 *
 * 1. Access cookie present → authenticated (fast path, no work).
 * 2. Access cookie gone but a refresh cookie remains → try {@link AuthBackendService.refreshSession};
 *    on success return the renewed tokens as `setCookies` for the caller to mint; on failure return
 *    `clearCookies` so the caller wipes the dead session as it bounces.
 * 3. Neither cookie → unauthenticated.
 */
export async function ensureSession(req: Request): Promise<SessionState> {
	const cookies = readCookies(req);

	const access = cookies[SB_ACCESS_COOKIE];
	if (access) {
		return {
			authenticated: true,
			refreshed: false,
			accessToken: access,
			setCookies: [],
			clearCookies: [],
		};
	}

	const refresh = cookies[SB_REFRESH_COOKIE];
	if (!refresh) {
		return { authenticated: false, refreshed: false, setCookies: [], clearCookies: [] };
	}

	const result = await AuthBackendService.refreshSession(refresh);
	if (result.ok && result.session) {
		return {
			authenticated: true,
			refreshed: true,
			accessToken: result.session.accessToken,
			setCookies: sessionSetCookies(result.session),
			clearCookies: [],
		};
	}

	// Refresh token spent/invalid → clear both cookies so the browser stops presenting a dead session.
	return {
		authenticated: false,
		refreshed: false,
		setCookies: [],
		clearCookies: sessionClearCookies(),
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
		setCookies: sessionSetCookies(result.session),
		clearCookies: [],
	};
}
