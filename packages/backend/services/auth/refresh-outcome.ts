import { fail, type ServiceResult } from "../ServiceResult.ts";

/**
 * refresh-outcome — tells a refresh grant GoTrue REFUSED from one it could not ANSWER.
 *
 * The difference decides whether a user is signed out. A refused grant (the refresh token is spent,
 * revoked, or its session is gone) is permanent, so the caller clears the cookies. Anything else — a
 * dropped connection, a 5xx, a rate limit, a body that would not parse — says nothing about the token,
 * which may still be perfectly good, so the caller keeps the cookies and the next request tries again.
 *
 * Read structurally from the auth-js error (`status`, `name`) rather than by class, so the rule does
 * not depend on which copy of `@supabase/auth-js` constructed it.
 */

/** HTTP statuses GoTrue answers a refresh grant with only when the token itself is unusable. */
const REJECTING_STATUSES = new Set([400, 401, 403]);

/** The message a refused grant carries to the caller. */
export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";

/**
 * Whether a refresh error is GoTrue's definitive refusal of the token (`invalid_grant`:
 * `refresh_token_not_found`, `refresh_token_already_used`, `session_not_found`, …).
 */
export function isRefreshRejection(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const { name, status } = error as { name?: unknown; status?: unknown };
	if (name === "AuthSessionMissingError") return true;
	return typeof status === "number" && REJECTING_STATUSES.has(status);
}

/**
 * The service result for a refresh that produced no session: `401` for a refused grant, `503` for
 * everything else (including a `null` error with no session, which proves nothing about the token).
 */
export function refreshFailure<T>(error: unknown): ServiceResult<T> {
	if (isRefreshRejection(error)) return fail(401, { message: SESSION_EXPIRED_MESSAGE });
	return fail(503, { message: "We couldn't renew your session right now. Try again in a moment." });
}
