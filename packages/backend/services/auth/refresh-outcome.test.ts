import { assertEquals } from "@std/assert";
import {
	AuthApiError,
	AuthRetryableFetchError,
	AuthSessionMissingError,
	AuthUnknownError,
} from "supabaseClient";
import { isRefreshRejection, refreshFailure } from "./refresh-outcome.ts";

/**
 * The refresh-error split, pinned against the error classes auth-js actually constructs: a refused
 * grant signs the user out (401), an outage keeps them signed in (503).
 */

// #region Refused grants
Deno.test("a spent or revoked refresh token is a definitive 401", () => {
	const refused = [
		new AuthApiError(
			"Invalid Refresh Token: Refresh Token Not Found",
			400,
			"refresh_token_not_found",
		),
		new AuthApiError("Invalid Refresh Token: Already Used", 400, "refresh_token_already_used"),
		new AuthApiError("invalid_grant", 400, undefined),
		new AuthApiError("User is banned", 403, "user_banned"),
		new AuthSessionMissingError(),
	];
	for (const error of refused) {
		assertEquals(isRefreshRejection(error), true, error.message);
		assertEquals(refreshFailure(error).status, 401, error.message);
	}
});
// #endregion

// #region Outages
Deno.test("a network failure, 5xx, rate limit or unreadable body is a 503", () => {
	const transient: unknown[] = [
		new AuthRetryableFetchError("Failed to fetch", 0),
		new AuthRetryableFetchError("Bad gateway", 502),
		new AuthRetryableFetchError("Service unavailable", 503),
		new AuthApiError("Internal server error", 500, "unexpected_failure"),
		new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"),
		new AuthUnknownError("Unexpected token <", new SyntaxError("Unexpected token <")),
		new TypeError("fetch failed"),
		null,
	];
	for (const error of transient) {
		assertEquals(isRefreshRejection(error), false, String(error));
		assertEquals(refreshFailure(error).status, 503, String(error));
	}
});
// #endregion
