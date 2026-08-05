import { z } from "zod";
import { AssetItemSchema, AssetVisibility } from "./assets.ts";

/**
 * files.sharing — the Zod SSOT for a share link: the read-only, revocable capability URL that lets
 * someone outside the platform open one asset or one folder.
 *
 * **A share link is READ-ONLY.** It grants viewing and downloading, and nothing else — no rename, no
 * replace, no upload into a shared folder. A URL is a bearer token that gets forwarded, screenshotted
 * and indexed, so anything it can do, anyone downstream of the person you sent it to can also do.
 *
 * **The slug is opaque, server-minted and high-entropy** ({@link SHARE_SLUG_BYTES} = 128 bits). It is
 * never derived from the filename, the owner or a sequential id: a guessable slug turns the share
 * route into an enumeration oracle over every private library on the platform. Minting is server-side
 * for the same reason — a client-chosen slug is a client-chosen entropy budget.
 *
 * **Every failure resolves identically.** {@link ShareResolution} distinguishes not-found from expired
 * from revoked from exhausted so the SERVICE can log and meter them, but the route maps all four to
 * the same 404 with the same body. Telling an anonymous caller "this link expired" instead of "no such
 * link" confirms that a link existed, which is exactly the fact a scanner is probing for.
 *
 * Only enum/array/string/number/boolean primitives are used so the module stays stable across Zod
 * majors.
 */

// #region Constants

/**
 * Entropy of a share slug, in bytes. 16 bytes = 128 bits, the floor below which an opaque capability
 * token stops being unguessable at internet scale. Rendered base64url this is a 22-character slug.
 */
export const SHARE_SLUG_BYTES = 16;

/** The canonical public share route base — the ONLY route a slug is ever resolvable through. */
export const SHARE_ROUTE_BASE = "/share";

// #endregion

// #region Link row

/**
 * One row of `files.share_links`.
 *
 * Exactly one of `itemId` / `folderId` is set, mirroring the table's
 * `CHECK (num_nonnulls(item_id, folder_id) = 1)` — a link points at one thing, and a link pointing at
 * both would have two different answers to "what does revoking this take away".
 */
export const ShareLinkSchema = z.object({
	/** The opaque, server-minted capability token. Never derived from anything about the asset. */
	slug: z.string().min(1).max(64),
	/** The shared asset, or `null` when this link shares a folder. */
	itemId: z.string().max(120).nullable(),
	/** The shared folder, or `null` when this link shares a single asset. */
	folderId: z.string().max(120).nullable(),
	/** The scope the link grants — `link` (anyone holding it) or `public` (world-readable). */
	visibility: AssetVisibility,
	/** ISO expiry; `null` = no time limit. */
	expiresAt: z.string().nullable(),
	/** ISO revocation timestamp; non-null is TERMINAL — a revoked slug is never re-armed. */
	revokedAt: z.string().nullable(),
	/** Maximum downloads before the link stops resolving; `null` = unlimited. */
	downloadLimit: z.number().int().min(1).nullable(),
	downloadCount: z.number().int().min(0),
	createdAt: z.string(),
	/** The user who minted it — the accountable party when a link leaks. */
	createdBy: z.string().min(1).max(80),
});
export type ShareLink = z.infer<typeof ShareLinkSchema>;

// #endregion

// #region Payloads

/**
 * Mint a share link. The slug, the creation timestamp and the creator are all server-side; a client
 * asks for a link over a subject and states its terms, and receives one.
 */
export const CreateShareSchema = z.object({
	itemId: z.string().max(120).nullable().optional(),
	folderId: z.string().max(120).nullable().optional(),
	/** `private` is refused — a private link is a contradiction, not a share. */
	visibility: z.enum(["link", "public"]),
	expiresAt: z.string().max(40).nullable().optional(),
	downloadLimit: z.number().int().min(1).max(100_000).nullable().optional(),
}).refine(
	(v) => (v.itemId ? 1 : 0) + (v.folderId ? 1 : 0) === 1,
	{ message: "A share link targets exactly one asset or one folder." },
);
export type CreateShare = z.infer<typeof CreateShareSchema>;

/** Revoke a share link. Terminal — re-sharing mints a NEW slug, so a leaked URL stays dead. */
export const RevokeShareSchema = z.object({
	slug: z.string().min(1).max(64),
});
export type RevokeShare = z.infer<typeof RevokeShareSchema>;

// #endregion

// #region Resolution

/**
 * The outcome of resolving a slug, discriminated on `state`.
 *
 * The four failure states exist for the SERVICE — so an owner's "your link was used after it expired"
 * audit line and the platform's abuse metering can tell them apart. The public route deliberately
 * collapses all four into one identical 404 (see the module note): a distinguishable failure confirms
 * that a slug was real, which is the only bit an enumeration attack needs.
 */
export const ShareResolutionSchema = z.discriminatedUnion("state", [
	z.object({ state: z.literal("ok"), asset: AssetItemSchema }),
	/** No such slug — or one the caller may not learn anything about. */
	z.object({ state: z.literal("not_found") }),
	/** Past `expiresAt`. */
	z.object({ state: z.literal("expired") }),
	/** `revokedAt` is set. */
	z.object({ state: z.literal("revoked") }),
	/** `downloadCount` reached `downloadLimit`. */
	z.object({ state: z.literal("exhausted") }),
]);
export type ShareResolution = z.infer<typeof ShareResolutionSchema>;

// #endregion

// #region Pure helpers

/**
 * The public URL for a slug.
 *
 * `userRef` is an OPAQUE, server-minted per-recipient reference used to attribute a download to the
 * copy of the link that was actually opened. It is never a handle, a user id or an email: a share URL
 * gets forwarded and pasted into public places, and personal data must never travel in a query string
 * (root CLAUDE.md §Privacy). Omit it and the download is recorded without attribution.
 */
export function shareHref(slug: string, userRef?: string | null): string {
	const base = `${SHARE_ROUTE_BASE}/${encodeURIComponent(slug)}`;
	return userRef ? `${base}?u=${encodeURIComponent(userRef)}` : base;
}

/**
 * Whether a link would resolve right now — not revoked, not expired, not exhausted.
 *
 * `nowIso` is a parameter rather than a `Date.now()` read so the function stays pure and SSR agrees
 * with the client refetch: a link expiring in the next second must not render as live on the server
 * and dead in the browser a moment later.
 *
 * An unparseable `expiresAt` is treated as EXPIRED. A malformed date is a broken record, and the safe
 * reading of a broken record on a capability token is "closed".
 */
export function isShareLive(link: ShareLink, nowIso: string): boolean {
	if (link.revokedAt !== null) return false;
	if (link.downloadLimit !== null && link.downloadCount >= link.downloadLimit) {
		return false;
	}
	if (link.expiresAt !== null) {
		const expires = Date.parse(link.expiresAt);
		if (!Number.isFinite(expires)) return false;
		const now = Date.parse(nowIso);
		if (!Number.isFinite(now)) return false;
		if (expires <= now) return false;
	}
	return true;
}

// #endregion
