/**
 * user/avatar — the ONE resolution rule for a person's profile picture.
 *
 * Every surface that shows a person draws the same picture, chosen in the same order:
 *
 *  1. **The uploaded photo** — the person's own `avatar` rendition, at the tier the surface needs
 *     ({@link avatarTierFor}). The server turns the stored reference into a URL
 *     (`packages/backend/services/files/public-media.ts`); this module only ranks it.
 *  2. **The OAuth provider's picture** — Google's `picture` / `avatar_url`, read from the identity's
 *     user metadata. That metadata is WRITABLE by its own user, so it is accepted only as an https URL
 *     on a provider CDN ({@link safeOAuthAvatarUrl}); anything else is dropped, never rendered.
 *  3. **The default picture** — {@link DEFAULT_AVATAR_URL}, applied by the UI rather than the data:
 *     a projection still answers `null` for "this person has no picture", and `UserAvatar`
 *     (`apps/web/components/UserAvatar.tsx`) paints the default for a `null` AND for a photo that
 *     fails to load. Below the default sit the person's initials, should the default itself fail.
 *
 * Steps 1–2 run on the server (`profile/party-cards.ts`, `user/UserBackendService.ts`); step 3 runs
 * in the component. Nothing else in the codebase ranks avatar sources.
 */

// #region Sources

/**
 * Hosts whose images may be rendered as an OAuth-provided avatar: Google's profile-photo CDN, plus
 * the mock corpus host so the OAuth simulation (`MOCK_OAUTH_AVATAR`) renders while the auth backend
 * is gated off.
 */
export const OAUTH_AVATAR_HOSTS: readonly string[] = [
	"lh3.googleusercontent.com",
	"googleusercontent.com",
	"images.unsplash.com",
];

/**
 * An OAuth-provided avatar URL, or `undefined` when it is absent or not safe to render — anything
 * that is not https on an {@link OAUTH_AVATAR_HOSTS} host. The value comes from user-writable
 * metadata (or a query string), so it is treated as untrusted input.
 */
export function safeOAuthAvatarUrl(raw: string | null | undefined): string | undefined {
	if (!raw) return undefined;
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:") return undefined;
		const ok = OAUTH_AVATAR_HOSTS.some(
			(host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
		);
		return ok ? url.href : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The OAuth picture held in an identity's user metadata — Supabase writes Google's photo as
 * `avatar_url` and keeps the raw `picture` claim beside it — made safe by {@link safeOAuthAvatarUrl}.
 */
export function oauthAvatarFromMetadata(
	meta: Record<string, unknown> | null | undefined,
): string | undefined {
	if (!meta) return undefined;
	const text = (
		value: unknown,
	) => (typeof value === "string" && value.length > 0 ? value : undefined);
	return safeOAuthAvatarUrl(text(meta.avatar_url) ?? text(meta.picture));
}

/** The candidate pictures for one person, as the server holds them. */
export interface AvatarSources {
	/** The uploaded photo's URL at the wanted tier, or `null`/absent when there is none. */
	uploaded?: string | null;
	/** The OAuth provider's picture, raw — it is re-checked here. */
	oauth?: string | null;
}

/**
 * The picture a person is shown with: the uploaded photo, else the OAuth picture, else `null` (the UI
 * paints {@link DEFAULT_AVATAR_URL}). With `maxLength`, a candidate longer than it is skipped rather
 * than truncated — a shortened URL is a broken image, and the next candidate (or `null`) renders.
 */
export function resolveAvatarUrl(sources: AvatarSources, maxLength = Infinity): string | null {
	const candidates = [sources.uploaded?.trim() || undefined, safeOAuthAvatarUrl(sources.oauth)];
	return candidates.find((url) => url !== undefined && url.length <= maxLength) ?? null;
}

// #endregion

// #region Default

/**
 * The picture shown for a person with no uploaded or OAuth picture, and for one whose picture fails
 * to load. Served from `apps/web/static/test_images/profile_1.jpg`.
 *
 * TEMPORARY (Decision #127): a stock face stands in until a designed default exists. Repointing or
 * removing it is a one-line change here — with it gone, `UserAvatar` falls straight to initials.
 */
export const DEFAULT_AVATAR_URL = "/test_images/profile_1.jpg";

// #endregion

// #region Size tiers

/** The avatar rendition tiers (mirrors `files.variant_tier`; see `TIER_LONG_EDGE.avatar`). */
export type AvatarTier = "sm" | "md" | "lg";

/**
 * The rendition tier a disc of `size` needs, per the avatar tier plan (`TIER_LONG_EDGE.avatar`:
 * sm 96 · md 256 · lg 1024, each covering its range at 2x):
 *
 * - **`sm`** — up to 48px: navbars, comment threads, message rows, list rows, inline mentions.
 * - **`md`** — up to 128px: profile header disc, account settings, large member cards.
 * - **`lg`** — anything larger: the full-size lightbox.
 *
 * `size` is the `Avatar` ramp token (`sm`–`xl`, all ≤ 72px) or a pixel diameter.
 */
export function avatarTierFor(size: "sm" | "md" | "lg" | "xl" | number): AvatarTier {
	const px = typeof size === "number" ? size : { sm: 28, md: 40, lg: 52, xl: 72 }[size];
	if (px <= 48) return "sm";
	if (px <= 128) return "md";
	return "lg";
}

// #endregion
