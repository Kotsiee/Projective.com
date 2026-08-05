import type { AssetItem, CreateShare, ShareLink, ShareResolution } from "@projective/types/files";
import { isShareLive, SHARE_SLUG_BYTES } from "@projective/types/files";
import { findAsset, findFolder } from "./assets-fixtures.ts";

/**
 * files share fixtures — the mint / revoke / resolve half of the read-only capability URL, answering
 * while `FILES_BACKEND_LIVE` is off.
 *
 * **A share link is READ-ONLY.** Viewing and downloading, and nothing else — no rename, no replace, no
 * upload into a shared folder. A URL is a bearer token that gets forwarded, screenshotted and indexed,
 * so anything it can do, everyone downstream of the person you sent it to can also do.
 *
 * **The slug is opaque, server-minted and high-entropy.** Never derived from the filename, the owner or
 * a sequential id: a guessable slug turns the share route into an enumeration oracle over every private
 * library on the platform. See {@link mintSlug} for why the FIXTURE slug is deterministic and why the
 * live one must not be.
 *
 * **Every failure resolves identically at the route.** {@link resolveSlug} distinguishes not-found from
 * expired from revoked from exhausted so the SERVICE can log and meter them — an owner's "your link was
 * used after it expired" audit line needs the difference. The public route collapses all four into one
 * identical 404 with one identical body: telling an anonymous caller "this link expired" instead of "no
 * such link" confirms that a link existed, which is the only bit an enumeration attack needs.
 */

// #region Reference clock + slug minting

/** Fixed reference "now" (never `Date.now()`), matching every sibling fixture module. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const DAY = 86_400_000;

/** A tiny stable hash → non-negative int. Unsigned `>>>` (a signed `>>` goes negative past 2^31). */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * A base64url slug of {@link SHARE_SLUG_BYTES} bytes' width.
 *
 * **The fixture derivation is deterministic and the live one MUST NOT BE.** A stable slug is what lets
 * SSR and the client refetch agree and a demo link keep working across a restart — but determinism is
 * precisely the property that makes a capability token guessable. The live path mints from
 * `crypto.getRandomValues(new Uint8Array(SHARE_SLUG_BYTES))` (128 bits, the floor below which an opaque
 * token stops being unguessable at internet scale) and nothing about the asset may feed it.
 */
function mintSlug(seed: string): string {
	// 22 base64url characters ≈ 128 bits, matching the width the live minting produces.
	const chars = Math.ceil((SHARE_SLUG_BYTES * 8) / 6);
	let out = "";
	for (let i = 0; i < chars; i++) {
		out += B64URL[hash(`${seed}:${i}`) % B64URL.length];
	}
	return out;
}

// #endregion

// #region Store

/** Every minted link, keyed by slug. Mutable so mint → resolve → revoke round-trips with the gate off. */
const SHARES = new Map<string, ShareLink>();

/** Build one seeded link. */
function seedShare(opts: {
	slug: string;
	itemId?: string | null;
	folderId?: string | null;
	visibility: ShareLink["visibility"];
	expiresAt?: string | null;
	revokedAt?: string | null;
	downloadLimit?: number | null;
	downloadCount?: number;
	agoDays: number;
}): ShareLink {
	const created = NOW - opts.agoDays * DAY;
	return {
		slug: opts.slug,
		itemId: opts.itemId ?? null,
		folderId: opts.folderId ?? null,
		visibility: opts.visibility,
		expiresAt: opts.expiresAt ?? null,
		revokedAt: opts.revokedAt ?? null,
		downloadLimit: opts.downloadLimit ?? null,
		downloadCount: opts.downloadCount ?? 0,
		createdAt: new Date(created).toISOString(),
		// The accountable party when a link leaks.
		createdBy: "viewer",
	};
}

/**
 * The seed covers a live link plus all FOUR dead states, because each one is a distinct branch the
 * service has to log differently and the route has to render identically.
 */
for (
	const share of [
		seedShare({
			slug: mintSlug("share:brand-guide"),
			itemId: "as-brand-guide",
			visibility: "public",
			downloadCount: 34,
			agoDays: 12,
		}),
		seedShare({
			slug: mintSlug("share:logo-pack"),
			itemId: "as-logo-pack",
			visibility: "link",
			expiresAt: new Date(NOW + 14 * DAY).toISOString(),
			downloadLimit: 50,
			downloadCount: 6,
			agoDays: 3,
		}),
		seedShare({
			slug: mintSlug("share:expired"),
			itemId: "as-nw-msa",
			visibility: "link",
			expiresAt: new Date(NOW - 2 * DAY).toISOString(),
			agoDays: 30,
		}),
		seedShare({
			slug: mintSlug("share:revoked"),
			itemId: "as-mo-audit",
			visibility: "link",
			revokedAt: new Date(NOW - 5 * DAY).toISOString(),
			agoDays: 40,
		}),
		seedShare({
			slug: mintSlug("share:exhausted"),
			itemId: "as-reel",
			visibility: "link",
			downloadLimit: 5,
			downloadCount: 5,
			agoDays: 20,
		}),
		seedShare({
			slug: mintSlug("share:exports-folder"),
			folderId: "fld-brand-logos-exports",
			visibility: "link",
			agoDays: 8,
		}),
	]
) {
	SHARES.set(share.slug, share);
}

// #endregion

// #region Reads

/** Look up one link by slug. */
export function findShare(slug: string): ShareLink | null {
	return SHARES.get(slug) ?? null;
}

/** Every link an owner has minted over one subject — the "who can reach this" panel. */
export function sharesForSubject(subjectId: string): ShareLink[] {
	return [...SHARES.values()]
		.filter((s) => s.itemId === subjectId || s.folderId === subjectId)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Resolve a slug to what it grants.
 *
 * The four failure states are returned DISTINCTLY so the service can meter and audit them; the route
 * maps all four to one identical not-found (see the module note). The precedence is deliberate:
 * revocation is checked first because it is TERMINAL — a revoked link that is also expired is revoked,
 * and reporting the recoverable-sounding state would misdescribe an owner's deliberate act.
 */
export function resolveSlug(slug: string): ShareResolution {
	const link = SHARES.get(slug);
	if (!link) return { state: "not_found" };
	if (link.revokedAt !== null) return { state: "revoked" };
	if (link.downloadLimit !== null && link.downloadCount >= link.downloadLimit) {
		return { state: "exhausted" };
	}
	// `nowIso` is passed rather than read inside, so SSR and the client refetch cannot disagree about a
	// link that expires in the next second. An unparseable date is treated as expired: a broken record
	// on a capability token reads "closed".
	if (!isShareLive(link, new Date(NOW).toISOString())) return { state: "expired" };

	// A FOLDER link has no single asset to hand back. `ShareResolution.ok` carries exactly one asset, so
	// a folder resolves through the LIST path (scope `share`, subject = the slug) instead. Returning a
	// fabricated asset here would make the resolution lie about what the link points at.
	if (!link.itemId) return { state: "not_found" };

	// The asset was deleted out from under a live link. Not-found rather than an error: a deletion must
	// make a shared URL stop resolving, not 500.
	const asset = findAsset(link.itemId);
	if (!asset) return { state: "not_found" };

	return { state: "ok", asset: shareProjection(asset) };
}

/**
 * Narrow an asset to what a share recipient may see.
 *
 * A recipient is not the owner: they get the bytes and nothing about the owner's filing system. The
 * folder trail, the management right, the download ledger figure and any OTHER share token are all
 * stripped — a share link must never disclose that a second one exists.
 */
function shareProjection(asset: AssetItem): AssetItem {
	return {
		...asset,
		folderId: null,
		folderPath: [],
		canManage: false,
		downloadCount: 0,
		downloadedByViewer: false,
		shareSlug: null,
		contentHash: null,
	};
}

// #endregion

// #region Writes

/** Mint a link over exactly one asset or one folder. Returns `null` when the subject does not exist. */
export function createShareLink(input: CreateShare, createdBy: string): ShareLink | null {
	if (input.itemId && !findAsset(input.itemId)) return null;
	if (input.folderId && !findFolder(input.folderId)) return null;

	const subject = input.itemId ?? input.folderId ?? "";
	const link: ShareLink = {
		slug: mintSlug(`share:${subject}:${SHARES.size}`),
		itemId: input.itemId ?? null,
		folderId: input.folderId ?? null,
		visibility: input.visibility,
		expiresAt: input.expiresAt ?? null,
		downloadLimit: input.downloadLimit ?? null,
		revokedAt: null,
		downloadCount: 0,
		createdAt: new Date(NOW).toISOString(),
		createdBy,
	};
	SHARES.set(link.slug, link);
	return link;
}

/**
 * Revoke a link.
 *
 * Terminal, and never re-armed: re-sharing mints a NEW slug, so a URL that has already leaked stays
 * dead. Returns `false` for an unknown slug AND for one already revoked, so a caller cannot use the
 * response to probe whether a slug it does not hold exists.
 */
export function revokeShareLink(slug: string): boolean {
	const link = SHARES.get(slug);
	if (!link || link.revokedAt !== null) return false;
	SHARES.set(slug, { ...link, revokedAt: new Date(NOW).toISOString() });
	return true;
}

/** Count a download against a link's limit. Silently no-ops for an unknown slug. */
export function bumpShareDownload(slug: string): void {
	const link = SHARES.get(slug);
	if (!link) return;
	SHARES.set(slug, { ...link, downloadCount: link.downloadCount + 1 });
}

// #endregion
