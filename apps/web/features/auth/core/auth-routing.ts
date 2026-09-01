/**
 * auth-routing.ts — the two post-authentication routing decisions, as pure functions.
 *
 * Both were previously inlined in a route handler, where they could only be exercised by driving a
 * real request through Fresh. They are the exact logic that decides whether a user lands on the page
 * they came from or on `/join`, so they are the logic most worth pinning by test — hence a module
 * that takes a `URL` and returns a destination, with the handlers reduced to HTTP plumbing around it.
 */

import { readRedirect, safeRedirect } from "./redirect.ts";
import { MOCK_OAUTH_AVATAR } from "@web/utils/mock-assets.ts";

/** Which screen a federated sign-in was started from. */
export type OAuthMode = "signin" | "signup";

/**
 * Where an ALREADY-AUTHENTICATED visitor to an auth screen should be sent, or `null` to let the page
 * render.
 *
 * The mirror image of the `(dashboard)` guard: that one bounces a signed-OUT visitor to `/login`
 * carrying their target; this returns a signed-IN visitor to that captured target instead of asking
 * them to authenticate again — or, on `/join`, walking them back through onboarding they have already
 * completed.
 *
 * **`/join` carrying an OAuth pre-fill returns `null`, and that exemption is load-bearing.** The OAuth
 * callback signs a brand-new Google identity IN and *then* sends them to `/join` to create their
 * Projective profile. Those users are authenticated by design, so bouncing them would make signing up
 * with Google impossible — the same loop, inverted.
 *
 * `/verify` and `/forgot-password` are deliberately not guarded: an authenticated user with an
 * unconfirmed email needs the first, and a signed-in user is entitled to reach the second.
 */
export function resolveAuthScreenBounce(url: URL, isAuthenticated: boolean): string | null {
	if (!isAuthenticated) return null;

	const pathname = url.pathname.replace(/\/+$/, "") || "/";
	const isSignIn = pathname === "/login";
	const isSignUp = pathname === "/join";
	if (!isSignIn && !isSignUp) return null;

	// A Google identity mid-signup is authenticated but has no profile yet — let them finish.
	if (isSignUp && url.searchParams.has("oauth")) return null;

	return readRedirect(url.searchParams);
}

/**
 * Where the NON-LIVE Google OAuth simulation should land.
 *
 * With `AUTH_BACKEND_LIVE` off there is no identity to look up, so the branch is taken from the
 * screen the user started on rather than from a profile read:
 *  - `signin` → an existing user, so return them to their captured path. Sending a returning user to
 *    `/join` is the redirect bug this parameter exists to prevent.
 *  - `signup` (or absent) → a brand-new identity, so pre-fill `/join` with a sample Google profile so
 *    the onboarding pre-fill UX stays exercisable without a wired Google client.
 *
 * The LIVE path never consults this: the callback resolves new-vs-returning from the database, which
 * outranks which button was pressed.
 */
export function oauthSimulationTarget(params: URLSearchParams): string {
	const redirectTo = safeRedirect(params.get("redirectTo"));
	if (params.get("mode") === "signin") return redirectTo;

	const prefill = new URLSearchParams({
		oauth: "google",
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada.lovelace@gmail.com",
		avatar: MOCK_OAUTH_AVATAR,
		redirectTo,
	});
	return `/join?${prefill.toString()}`;
}
