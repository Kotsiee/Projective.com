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
