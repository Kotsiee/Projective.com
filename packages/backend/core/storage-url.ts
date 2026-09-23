import { serverEnv } from "./env.ts";

/**
 * storage-url.ts — the ONE place a browser-facing Supabase Storage URL is built.
 *
 * ## Why a module for a string template
 *
 * Every image on the platform is a `files.items` row: a BUCKET and an object PATH, never a URL. The
 * URL is a deployment fact — which host the browser reaches the storage API on — and the moment two
 * readers build it independently they disagree about it: one encodes a path segment and the other
 * does not, one trims a trailing slash off the host and the other doubles it, and the failure is a
 * broken image on one surface while the same asset renders on the next. So the host, the encoding
 * and the public/private split live here, once.
 *
 * ## Public buckets only, by construction
 *
 * A PUBLIC bucket's object is served at a stable, unauthenticated address, so it can be written into
 * server-rendered HTML and cached by the browser. A PRIVATE bucket's object is readable only through a
 * short-lived signed URL, which SSR would outlive and which costs a storage round trip per object —
 * that belongs to a download route, not to a list read. {@link publicObjectUrl} therefore answers
 * `null` for any bucket not in {@link PUBLIC_BUCKETS}: a caller that passes a private bucket gets an
 * absence it has to handle, rather than a well-formed URL that 400s in the browser.
 *
 * The bucket list mirrors `00005040_seed_storage_buckets.sql` (`public = true`). A bucket flipped to
 * public there and not here renders as absent — the safe direction to be wrong in.
 */

// #region Buckets

/** The storage buckets whose objects are served without authentication. */
export const PUBLIC_BUCKETS: ReadonlySet<string> = new Set([
	"avatars",
	"catalogue",
	"public_assets",
	"showcase",
]);

/** Whether objects in `bucket` may be linked directly from server-rendered HTML. */
export function isPublicBucket(bucket: string | null | undefined): boolean {
	return !!bucket && PUBLIC_BUCKETS.has(bucket);
}

// #endregion

// #region URLs

/**
 * The origin the browser reaches Supabase on, without a trailing slash, or `null` when the project is
 * not configured. `SUPABASE_PUBLIC_URL` wins over `SUPABASE_URL` (see `ServerEnv.supabasePublicUrl`).
 */
export function storagePublicBase(): string | null {
	const base = serverEnv().supabasePublicUrl;
	return base ? base.replace(/\/+$/, "") : null;
}

/**
 * Encode an object path for a URL, one segment at a time.
 *
 * Per segment rather than `encodeURI` over the whole path: an object name may legitimately contain
 * `#`, `?` or `%` (a filename a user chose), and `encodeURI` leaves those alone — so the browser
 * would read the rest of the name as a fragment or a query and request a different object. The `/`
 * separators are the only characters that must survive unencoded.
 */
function encodeObjectPath(path: string): string {
	return path.split("/").filter((s) => s.length > 0).map(encodeURIComponent).join("/");
}

/**
 * The public URL of one stored object, or `null` when it has none.
 *
 * `null` for a private bucket, a missing bucket or path, or an unconfigured project — every case in
 * which a URL would be a guess. Callers render the absence (an initials avatar, a placeholder tile),
 * which is the honest outcome; a fabricated URL renders as a broken image instead.
 */
export function publicObjectUrl(
	bucket: string | null | undefined,
	path: string | null | undefined,
): string | null {
	if (!isPublicBucket(bucket) || !path) return null;
	const base = storagePublicBase();
	if (!base) return null;
	const encoded = encodeObjectPath(path);
	if (!encoded) return null;
	return `${base}/storage/v1/object/public/${bucket}/${encoded}`;
}

/** The two facts a stored-object reference carries, as the database projects them. */
export interface StoredObjectRef {
	bucket_id?: string | null;
	storage_path?: string | null;
}

/** {@link publicObjectUrl} over a `files.items`-shaped row. */
export function objectUrlOf(ref: StoredObjectRef | null | undefined): string | null {
	return ref ? publicObjectUrl(ref.bucket_id, ref.storage_path) : null;
}

/**
 * The inverse of {@link publicObjectUrl}: the `{ bucket, path }` a public object URL of THIS project
 * names, or `null` for anything else — another host, a private bucket, a URL of any other shape. It is
 * how a URL a page hands back (a picked gallery image) becomes a stored-file reference again, so the
 * row keeps pointing at the file rather than at one rendering of its address.
 */
export function parsePublicObjectUrl(url: string | null | undefined): { bucket: string; path: string } | null {
	const base = storagePublicBase();
	if (!url || !base) return null;
	const prefix = `${base}/storage/v1/object/public/`;
	if (!url.startsWith(prefix)) return null;
	const rest = url.slice(prefix.length).split(/[?#]/)[0];
	const [bucket, ...segments] = rest.split("/");
	if (!isPublicBucket(bucket) || segments.length === 0) return null;
	try {
		const path = segments.map((s) => decodeURIComponent(s)).join("/");
		return path ? { bucket, path } : null;
	} catch {
		return null;
	}
}

// #endregion
