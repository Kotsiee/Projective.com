import type { AccessTokenClaims } from "@projective/types/auth";

/**
 * OAuth pre-fill parsing.
 *
 * MVP auth supports Google OAuth (SYSTEM_ARCHITECTURE.md §Authentication). When a Google sign-in
 * succeeds but no Projective profile exists yet, the OAuth callback bounces the user to `/join`
 * with their Google-provided identity as query params, which we parse here to pre-fill the join
 * form. Values are untrusted URL input, so names are length-clamped and the avatar URL is
 * host-allowlisted to avoid pre-filling an arbitrary/hostile image source.
 */

/** Supported identity providers (MVP: Google only; Microsoft/GitHub/Apple are post-MVP). */
export type OAuthProvider = "google";

/** Identity fields a provider can pre-fill on the join form. */
export interface OAuthPrefill {
	provider: OAuthProvider;
	firstName?: string;
	lastName?: string;
	email?: string;
	avatar?: string;
}

/** Hosts we trust to render as a pre-filled avatar (provider CDNs + our media fallback registry). */
const AVATAR_HOST_ALLOWLIST = [
	"lh3.googleusercontent.com",
	"googleusercontent.com",
	"images.unsplash.com",
];

function clampName(value: string | null): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim().slice(0, 60);
	return trimmed.length > 0 ? trimmed : undefined;
}

/** Accept only an https URL whose host is allow-listed; otherwise drop it. */
export function safeAvatarUrl(raw: string | null | undefined): string | undefined {
	if (!raw) return undefined;
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:") return undefined;
		const ok = AVATAR_HOST_ALLOWLIST.some(
			(host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
		);
		return ok ? url.href : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Parse OAuth pre-fill from a URL's search params. Returns `null` when the `oauth` marker is absent
 * or names an unsupported provider (so the join form renders in its normal, blank state).
 */
export function parseOAuthPrefill(params: URLSearchParams): OAuthPrefill | null {
	if (params.get("oauth") !== "google") return null;
	return {
		provider: "google",
		firstName: clampName(params.get("firstName")),
		lastName: clampName(params.get("lastName")),
		email: clampName(params.get("email")),
		avatar: safeAvatarUrl(params.get("avatar")),
	};
}

/**
 * Build a pre-fill from an access token's decoded claims, or `null` when the identity did not come
 * from a supported provider.
 *
 * The same identity {@link AuthBackendService.exchangeOAuthCode} reads at the callback, taken from
 * the token instead of the exchange response — because the callback is not the only moment an
 * account can need it. A Google sign-up that abandons `/join` stays authenticated and profile-less,
 * and the app has to be able to send them back with the same pre-fill it sent them the first time,
 * from a middleware that holds a JWT and nothing else.
 *
 * `provider` comes from `app_metadata`, which GoTrue writes and a user cannot: the pre-fill decides
 * whether `/join` asks for a password, and reading that from user-controlled metadata would let a
 * password account present itself as federated. Every value is then put through the same clamps as
 * the URL path above, because a token this app decodes without verifying its signature is exactly
 * as untrusted as a query string.
 */
export function oauthPrefillFromClaims(
	claims: AccessTokenClaims | null | undefined,
): OAuthPrefill | null {
	const app = (claims?.app_metadata ?? {}) as Record<string, unknown>;
	const provider = typeof app.provider === "string" ? app.provider : "";
	if (provider !== "google") return null;

	const meta = (claims?.user_metadata ?? {}) as Record<string, unknown>;
	const text = (value: unknown) => (typeof value === "string" ? value : null);
	// Google returns `given_name`/`family_name` only sometimes; `full_name`/`name` is the field that
	// is always there, so the split is the fallback rather than the primary.
	const fullName = text(meta.full_name) ?? text(meta.name);
	const parts = fullName ? fullName.trim().split(/\s+/) : [];

	return {
		provider: "google",
		firstName: clampName(text(meta.given_name) ?? parts[0] ?? null),
		lastName: clampName(
			text(meta.family_name) ?? (parts.length > 1 ? parts.slice(1).join(" ") : null),
		),
		// The top-level claim is the fallback because /join renders this field READ-ONLY for an
		// already-authenticated account: an absent email there is a control nobody can complete.
		email: clampName(text(meta.email) ?? text(claims?.email)),
		avatar: safeAvatarUrl(text(meta.avatar_url) ?? text(meta.picture)),
	};
}
