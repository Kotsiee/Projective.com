import { HttpError } from "fresh";
import { define } from "@web/utils/state.ts";
import { ensureSession, renewSession } from "@web/utils/session.ts";
import { decodeAccessClaims, resolveTokenContext } from "@web/utils/user-context.ts";
import { resolveOnboardingBounce } from "@features/auth/core/auth-routing.ts";
import { oauthPrefillFromClaims } from "@features/auth/core/oauth.ts";
import {
	isRestrictedPath,
	isTeamsPath,
	RESTRICTED_FALLBACK_PATH,
	TEAMS_PERSONA_FALLBACK,
} from "@features/shell/core/restricted-surfaces.ts";
import { isRestrictedRequest } from "@web/utils/age-gate.ts";
import { mayUseTeamsRequest } from "@web/utils/operator-mode.ts";

/**
 * Dashboard auth guard — scoped to the authenticated app (route group `(dashboard)`).
 *
 * Two gates, both answered from the session token.
 *
 * **1. Is there a session?** Gates on a verified Supabase session, but — crucially —
 * **attempts a silent token refresh before redirecting out**. When the short-lived access cookie has
 * expired yet a valid refresh cookie remains, {@link ensureSession} renews the session (fat
 * {@link AuthBackendService}) and we re-mint the `sb-*` cookies on the way out instead of bouncing the
 * user to `/login` — this is what keeps an active session (notably a Google-OAuth one, whose access
 * token is ~1h) alive across long-lived navigation like `/projects/…`. Only a genuinely dead session
 * (no cookies, or a spent/invalid refresh token) is redirected, capturing the **full** target path
 * (pathname + query) as `redirectTo` so the user returns exactly where they were after signing back in.
 * When GoTrue cannot answer the renewal, the request is a `503` in place (the error page offers a
 * retry of this URL) and the cookies are kept — an outage never signs anyone out (Decision #193).
 *
 * **2. Is there a profile to act as?** A federated sign-up is authenticated the moment the callback
 * returns and has no `org.users_public` row until `/join` calls `complete_onboarding` — GoTrue hands
 * `public.handle_new_user` neither a username nor a dob, and both columns are NOT NULL. The callback
 * routed them to `/join` once and nothing routed them back, so abandoning that form left an account
 * that reaches every surface in here and can finish no write on any of them: projects, tickets and
 * catalogue rows all key onto `org.users_public(user_id)`, so a create dies on a foreign key that
 * surfaces as a 500 against whichever field the writer happened to name. See
 * {@link resolveOnboardingBounce} for which accounts are sent back and which are deliberately not.
 *
 * **3. May this account see the page?** A restricted (13–17) account is sent home from every
 * surface {@link isRestrictedPath} names. Then `/teams*` is freelancer-only (Decision #228 (A)): a
 * client or an operator-mode account not acting as a team is sent home with `?notice=teams-freelancer`.
 *
 * Every gate reads the token and nothing else, so the common request stays network-free; the one
 * renewal each can trigger fires only on a request that would otherwise be answered wrongly.
 *
 * Gate 1 admits only a VERIFIED access token (`AuthBackendService.verifyAccessToken`: signature,
 * expiry, a user session's claims). A tampered or expired one with a refresh cookie takes the renewal
 * path; with none it is cleared and redirected. RLS is the backstop for what local verification cannot
 * see — a revoked session's token until its `exp`. Islands never run this — it is server-side,
 * pre-handler.
 */
export default define.middleware(async (ctx) => {
	const session = await ensureSession(ctx.req);

	// An outage proves nothing about the session: answer in place with the cookies untouched, so a
	// retry once GoTrue answers again carries on from this exact page.
	if (session.unavailable) throw new HttpError(503);

	if (!session.authenticated) {
		const dest = new URL("/login", ctx.url);
		// Preserve the exact target (including any query string) so the return trip is loss-free.
		dest.searchParams.set("redirectTo", ctx.url.pathname + ctx.url.search);
		const res = new Response(null, { status: 302, headers: { location: dest.href } });
		for (const cookie of session.clearCookies) res.headers.append("set-cookie", cookie);
		return res;
	}

	let accessToken = session.accessToken;
	// Accumulated across BOTH renewals below, because a refresh rotates the token it consumed: a
	// response that drops these leaves the browser holding a refresh token GoTrue will refuse.
	const setCookies = [...session.setCookies];

	ctx.state.isAuthenticated = true;
	ctx.state.accessToken = accessToken;
	// A just-renewed session's cookie is still stale on the request, so re-derive the chrome context
	// from the fresh token — otherwise the global middleware's guest read (from the dropped cookie)
	// would paint guest chrome for this one render.
	if (session.refreshed && accessToken) {
		ctx.state.userContext = resolveTokenContext(accessToken);
	}

	// A STALE `onboarded: false` is re-read before it is acted on, and that is what makes the gate
	// terminate. Finishing `/join` writes the profile row and changes nothing about the token already
	// in the browser, so acting on the claim as it stands would bounce someone straight back to the
	// form they just completed — where `complete_onboarding` answers "already completed". The
	// access-token hook re-runs on the refresh grant, so one renewal is the whole cure, and it is the
	// same refresh-before-redirect move gate 1 already makes. Skipped when this request already
	// refreshed (that token is as fresh as it gets) and never reached for an onboarded account.
	if (ctx.state.userContext?.onboarded === false && !session.refreshed) {
		const renewed = await renewSession(ctx.req);
		if (renewed?.accessToken) {
			accessToken = renewed.accessToken;
			setCookies.push(...renewed.setCookies);
			ctx.state.accessToken = accessToken;
			ctx.state.userContext = resolveTokenContext(accessToken);
		}
	}

	const onboarding = resolveOnboardingBounce(
		ctx.state.userContext,
		oauthPrefillFromClaims(decodeAccessClaims(accessToken)),
		ctx.url,
	);
	if (onboarding) {
		const res = new Response(null, {
			status: 302,
			headers: { location: new URL(onboarding, ctx.url).href },
		});
		for (const cookie of setCookies) res.headers.append("set-cookie", cookie);
		return res;
	}

	// **3. May this account see the page?** A restricted (13–17) account has no money, selling or
	// workspace surface (Decision #192); the chrome never links to one, and a typed or stale URL is
	// sent home rather than shown. A redirect, not a thrown 404: a throw would drop `setCookies`, and
	// a renewed session that loses its rotated refresh token is signed out.
	if (isRestrictedPath(ctx.url.pathname) && isRestrictedRequest(ctx.req, ctx.state.userContext)) {
		const res = new Response(null, {
			status: 303,
			headers: { location: new URL(RESTRICTED_FALLBACK_PATH, ctx.url).href },
		});
		for (const cookie of setCookies) res.headers.append("set-cookie", cookie);
		return res;
	}

	// Teams are the freelancer side of the market (Decision #228 (A)). The chrome never links a client
	// or an operator here; a typed URL is sent home with the reason, and the database refuses every team
	// write on its own (`org.fn_assert_team_persona`).
	if (isTeamsPath(ctx.url.pathname) && !mayUseTeamsRequest(ctx.req, ctx.state.userContext)) {
		const res = new Response(null, {
			status: 303,
			headers: { location: new URL(TEAMS_PERSONA_FALLBACK, ctx.url).href },
		});
		for (const cookie of setCookies) res.headers.append("set-cookie", cookie);
		return res;
	}

	const res = await ctx.next();
	// Mint the renewed session cookies onto the proceeding response (empty on the fast path).
	for (const cookie of setCookies) res.headers.append("set-cookie", cookie);
	return res;
});
