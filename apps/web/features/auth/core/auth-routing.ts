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

	return joinCompletionTarget({
		provider: "google",
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada.lovelace@gmail.com",
		avatar: MOCK_OAUTH_AVATAR,
	}, redirectTo);
}

/**
 * The `/join` URL that lets an ALREADY-AUTHENTICATED federated identity finish creating its profile.
 *
 * One builder, three callers — the OAuth callback, the non-live simulation, and the un-onboarded
 * bounce below — because they are all asking for the same address and had begun to drift: the
 * callback omits an absent name, the simulation always had all four, and a third hand-rolled copy is
 * how the `oauth` marker eventually goes missing from one of them. That marker is not decoration.
 * `/join` reads it to decide the account is federated and must be completed in place rather than
 * signed up from scratch, and {@link resolveAuthScreenBounce} reads it to let an authenticated
 * visitor through a screen it otherwise bounces them off. Without it the user is thrown back to
 * wherever they came from, or asked to choose a password for an account that already exists.
 */
export function joinCompletionTarget(
	prefill: {
		provider?: string;
		firstName?: string;
		lastName?: string;
		email?: string;
		avatar?: string;
	} | null,
	redirectTo: string,
): string {
	const params = new URLSearchParams({ oauth: prefill?.provider ?? "google" });
	if (prefill?.firstName) params.set("firstName", prefill.firstName);
	if (prefill?.lastName) params.set("lastName", prefill.lastName);
	if (prefill?.email) params.set("email", prefill.email);
	if (prefill?.avatar) params.set("avatar", prefill.avatar);
	params.set("redirectTo", safeRedirect(redirectTo));
	return `/join?${params.toString()}`;
}

/**
 * Where an authenticated visitor whose account has no Projective profile should be sent, or `null`
 * to let the page render.
 *
 * ## The state this exists for
 *
 * A Google sign-up is authenticated the moment the callback returns and has NO `org.users_public`
 * row until `/join` calls `complete_onboarding` — `public.handle_new_user` cannot provision one,
 * because GoTrue hands it no username and no dob and the columns are NOT NULL. The callback routes
 * them to `/join` once. Nothing routed them there ever again, so abandoning that form (a
 * back-navigation, a bookmark, closing the tab) left an account that reaches every authenticated
 * surface and can complete no write on any of them: `projects.projects`, `projects.tickets` and the
 * catalogue tables all carry a foreign key onto `org.users_public(user_id)`, so a create fails on a
 * constraint deep in Postgres and surfaces as a 500 attributed to whichever field the writer happened
 * to name. The observed symptom was "Create project" reporting a server fault against the title.
 *
 * ## Only a CONFIRMED absence bounces
 *
 * `onboarded` is `false` only when the access-token hook looked and found no row; an absent claim —
 * a token minted before the claim existed, or one whose hook errored — resolves to `true`. Walking a
 * fully set-up user back through onboarding is far worse than letting an un-onboarded one reach a
 * page that will refuse them, and the write path refuses them in words either way.
 *
 * ## It bounces only what `/join` can actually finish
 *
 * A pre-fill is required, and that is a real constraint rather than a convenience. `/join` renders
 * the email field READ-ONLY for an already-authenticated account and seeds it from the pre-fill, so
 * sending someone there without one hands them a form they cannot complete — a dead end, which is
 * worse than the page they were refused. It also scopes the bounce to the identities this state is
 * actually produced for: a federated sign-up, which is the one path that reaches GoTrue with no
 * username and no dob.
 *
 * An ORGANISATION owner lands in the same profile-less state by a different door —
 * `provisionAccount` admin-creates them with only `objective: "organization"`, and
 * `create_organisation` writes the org and the membership without ever calling
 * `provision_user_profile`. That may well be deliberate (`org.organisations.owner_user_id`
 * references `auth.users`, not `org.users_public`, so the schema does not require the owner to have a
 * personal profile at all), and deciding whether they should be given one is a product question, not
 * a routing one. They are deliberately NOT bounced here; the write path refuses them in words
 * instead.
 *
 * The destination carries the pre-fill so the form is the one the callback would have shown, and the
 * captured path so finishing returns them to what they were trying to do. It is never `/join` itself
 * — {@link safeRedirect} rejects an auth path, so the return trip cannot loop.
 */
export function resolveOnboardingBounce(
	context: { onboarded?: boolean } | null | undefined,
	prefill: Parameters<typeof joinCompletionTarget>[0],
	url: URL,
): string | null {
	if (context?.onboarded !== false || !prefill) return null;
	return joinCompletionTarget(prefill, url.pathname + url.search);
}
