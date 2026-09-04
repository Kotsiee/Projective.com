/**
 * user-context.ts — resolves the request's {@link UserContext} for **User Context Hydration**.
 *
 * The HTTP-layer bridge between the session cookie and the pure `@projective/types/auth` resolver:
 * read the `sb-access-token` JWT, decode its payload, and map the claims to the chrome-only context
 * that layouts/islands render from. This is the same **presence-only / skeleton** philosophy as
 * {@link hasSessionCookie} — we decode the payload *without verifying the signature* because the
 * result decides chrome only (which shell + skeletons to paint), never access. RLS and the
 * `(dashboard)` guard remain the real gates; a forged token merely changes what the tamperer's own
 * browser draws. Real signature verification via `@server/services` is the TODO where any *access*
 * decision is made (SYSTEM_ARCHITECTURE §Security).
 *
 * Fully defensive: in skeleton/dev the cookie may be an opaque non-JWT value, so every failure path
 * degrades to {@link GUEST_CONTEXT} rather than throwing.
 */

import { decode } from "djwt";
import {
	type AccessTokenClaims,
	GUEST_CONTEXT,
	resolveUserContext,
	type UserContext,
} from "@projective/types/auth";
import { readCookies, SB_ACCESS_COOKIE } from "@web/utils/auth-cookies.ts";

/**
 * Decode (unverified) the access-token JWT into its claims payload, or `null` when there is no token,
 * it is not a well-formed JWT, or the payload is not a claims object. Never throws.
 *
 * Exported for the one consumer that needs a claim the chrome {@link UserContext} deliberately does
 * not carry: the dashboard guard reconstructs the Google pre-fill for an un-onboarded account out of
 * `user_metadata`, and folding provider identity into the chrome context to avoid that would put four
 * fields nothing else reads onto a shape every layout and island receives.
 */
export function decodeAccessClaims(token: string | undefined): AccessTokenClaims | null {
	if (!token) return null;
	try {
		// djwt `decode` splits + base64url-decodes the token into [header, payload, signature] WITHOUT
		// verifying the signature — exactly what we want for a chrome-only read.
		const [, payload] = decode(token);
		if (payload && typeof payload === "object") return payload as AccessTokenClaims;
		return null;
	} catch {
		// Not a JWT (opaque skeleton cookie), malformed, or bad base64 — treat as no context.
		return null;
	}
}

/**
 * Resolve the {@link UserContext} for a raw access token (unverified decode). Total: returns
 * {@link GUEST_CONTEXT} when the token is absent or not a claims-bearing JWT. Used both for the
 * request's cookie and — after the guard silently renews a session — for the freshly-minted token,
 * so the re-painted chrome reflects the new claims rather than the dropped cookie's absence.
 */
export function resolveTokenContext(token: string | undefined): UserContext {
	const claims = decodeAccessClaims(token);
	return claims ? resolveUserContext(claims) : GUEST_CONTEXT;
}

/**
 * Resolve the {@link UserContext} for a request from its session cookie. Total: returns
 * {@link GUEST_CONTEXT} whenever no valid session token is present.
 */
export function resolveRequestContext(req: Request): UserContext {
	return resolveTokenContext(readCookies(req)[SB_ACCESS_COOKIE]);
}
