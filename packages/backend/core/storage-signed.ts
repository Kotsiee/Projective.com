import { getServiceClient } from "./supabase.ts";
import { storagePublicBase } from "./storage-url.ts";
import { serverEnv } from "./env.ts";

/**
 * storage-signed.ts — the service-role door onto Supabase Storage, for the media pipeline.
 *
 * `storage-url.ts` builds the stable, unauthenticated URL of an object in a PUBLIC bucket. This is
 * everything else the pipeline needs, and all of it runs as the service role, server-side only:
 *
 *  - a SIGNED UPLOAD URL — a short-lived, single-object capability the browser PUTs its bytes to, so
 *    a 50 MB file never streams through an application request worker;
 *  - SIGNED READ URLs for a PRIVATE bucket (the picker's thumbnails of a person's own library);
 *  - download / upload / remove, for the quarantine → scan → promote step.
 *
 * Authorisation is NOT this module's job — it trusts its caller. Every function here is reached only
 * after the fat service has checked, under the caller's own JWT, that the row it is about to act on
 * is theirs (the `files.items` insert/read under RLS). Keep it that way: never call these with a
 * path a client supplied.
 */

// #region URL origin

/**
 * A signed URL minted by the server names the server's own Supabase origin (`SUPABASE_URL`), which
 * is not always the one the BROWSER reaches (`SUPABASE_PUBLIC_URL` — a container network name vs
 * `localhost`, an internal host vs the public one). Rewrite the origin to the public base so the URL
 * the browser receives is one it can use.
 */
function publicise(url: string): string {
	const pub = storagePublicBase();
	const internal = serverEnv().supabaseUrl?.replace(/\/+$/, "");
	if (!pub || !internal || pub === internal) return url;
	return url.startsWith(internal) ? pub + url.slice(internal.length) : url;
}

// #endregion

// #region Signed URLs

/** A single-object upload capability. */
export interface SignedUpload {
	/** The URL the browser PUTs the bytes to (already carries its token). */
	url: string;
	/** ISO instant the capability stops being accepted (Supabase signs upload URLs for two hours). */
	expiresAt: string;
}

/** Mint a signed upload URL for exactly `path` in `bucket`; `null` when storage refuses. */
export async function signedUploadUrl(bucket: string, path: string): Promise<SignedUpload | null> {
	const { data, error } = await getServiceClient().storage.from(bucket).createSignedUploadUrl(path);
	if (error || !data?.signedUrl) return null;
	return {
		url: publicise(data.signedUrl),
		expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
	};
}

/**
 * Signed READ URLs for several objects in one PRIVATE bucket, keyed by path. Paths storage refuses
 * are simply absent from the map — a caller renders the missing thumbnail, never a broken URL.
 */
export async function signedReadUrls(
	bucket: string,
	paths: readonly string[],
	expiresInSeconds = 60 * 30,
): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	const unique = [...new Set(paths.filter((p) => p.length > 0))];
	if (unique.length === 0) return out;
	const { data, error } = await getServiceClient().storage.from(bucket).createSignedUrls(unique, expiresInSeconds);
	if (error || !data) return out;
	for (const row of data) {
		if (row.path && row.signedUrl && !row.error) out.set(row.path, publicise(row.signedUrl));
	}
	return out;
}

/**
 * One signed READ URL for an object, optionally as an attachment saved under `download` — the private
 * object route's redirect target. Short-lived by design: the route is the stable address and mints a
 * fresh one per request. `null` when storage refuses (a missing object, a bucket that is gone).
 */
export async function signedObjectUrl(
	bucket: string,
	path: string,
	expiresInSeconds: number,
	download?: string | null,
): Promise<string | null> {
	const { data, error } = await getServiceClient().storage.from(bucket)
		.createSignedUrl(path, expiresInSeconds, download ? { download } : undefined);
	if (error || !data?.signedUrl) return null;
	return publicise(data.signedUrl);
}

// #endregion

// #region Object I/O

/** An object's bytes, or `null` when it does not exist (or storage refuses). */
export async function downloadObject(bucket: string, path: string): Promise<Uint8Array | null> {
	const { data, error } = await getServiceClient().storage.from(bucket).download(path);
	if (error || !data) return null;
	return new Uint8Array(await data.arrayBuffer());
}

/**
 * Write an object. `upsert` defaults to FALSE: every path the pipeline writes contains a fresh asset
 * id, so an existing object at that path means something already went wrong, and overwriting it
 * would hide that. Public renditions are immutable (their path changes whenever their bytes do), so
 * they are served with a year-long cache.
 */
export async function uploadObject(
	bucket: string,
	path: string,
	bytes: Uint8Array,
	contentType: string,
	options: { upsert?: boolean; immutable?: boolean } = {},
): Promise<boolean> {
	const { error } = await getServiceClient().storage.from(bucket).upload(path, bytes, {
		contentType,
		upsert: options.upsert ?? false,
		cacheControl: options.immutable ? "31536000" : "3600",
	});
	return !error;
}

/** Remove objects. Best-effort: a quarantine object that is already gone is not an error. */
export async function removeObjects(bucket: string, paths: readonly string[]): Promise<void> {
	if (paths.length === 0) return;
	try {
		await getServiceClient().storage.from(bucket).remove([...paths]);
	} catch { /* best-effort cleanup */ }
}

// #endregion
