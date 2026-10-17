/**
 * image-param.ts — the changelog lightbox's address: `?image=<entryId>:<n>` (P5, Decision #278).
 *
 * `entryId` is a release's anchor id on the page (`v0-12-0`) and `n` the picture's 1-based position
 * in that release's gallery, so `/changelog?image=v0-12-0:2#v0-12-0` is a shareable link to the
 * second picture of 0.12.0. Opening a picture pushes the parameter (Back closes it), stepping
 * replaces it, and closing from inside the page strips it; every other parameter and the fragment
 * are kept.
 *
 * Imports nothing, so the lightbox island can use it without carrying any schema into the client.
 */

// #region Parameter
/** The query parameter's name. */
export const IMAGE_PARAM = "image";

/** A parsed `?image=` value. */
export interface ImageRef {
	/** The release's anchor id (`v0-12-0`). */
	entry: string;
	/** The picture's 1-based position in that release's gallery. */
	index: number;
}

const IMAGE_VALUE = /^(v[0-9a-z]+(?:-[0-9a-z]+)*):([1-9][0-9]{0,2})$/;

/** Parse an `?image=` value; `null` when it is absent or not `<anchor>:<n>`. */
export function parseImageParam(value: string | null | undefined): ImageRef | null {
	if (!value) return null;
	const m = IMAGE_VALUE.exec(value);
	return m ? { entry: m[1], index: Number(m[2]) } : null;
}

/** The `?image=` value for picture `index` (1-based) of the release anchored at `entry`. */
export function formatImageParam(entry: string, index: number): string {
	return `${entry}:${index}`;
}

/**
 * `href` with `?image=` set to `value`, or removed when `value` is `null`. Other parameters keep
 * their order and the fragment is kept. Works on a path (`/changelog?page=2#v0-1-0`) or a full URL;
 * a path stays a path.
 */
export function withImageParam(href: string, value: string | null): string {
	const hashAt = href.indexOf("#");
	const hash = hashAt >= 0 ? href.slice(hashAt) : "";
	const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
	const queryAt = beforeHash.indexOf("?");
	const path = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
	const params = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "");
	if (value === null) params.delete(IMAGE_PARAM);
	else params.set(IMAGE_PARAM, value);
	const query = params.toString().replace(/%3A/gi, ":");
	return `${path}${query ? `?${query}` : ""}${hash}`;
}
// #endregion
