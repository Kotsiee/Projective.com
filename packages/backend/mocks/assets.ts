/**
 * assets.ts — the ONE place a mock asset URL is built.
 *
 * ## Why this module exists
 *
 * Before consolidation the same two Unsplash URL builders were re-declared privately inside 21
 * separate fixture modules — `FACE`/`face`/`avatar` (a 96px face crop) and `SCENE`/`cover`/`unsplash`
 * (a landscape crop) — each with its own name and its own copy of the query string. One of them even
 * carried the comment "a self-contained copy — the backend cannot import the app's marketing helper",
 * which is true across the workspace boundary and was not true between two files in this package.
 *
 * Three costs came with that. A transform tweak had to be applied 21 times or the corpus drifted; the
 * duplication hid that two modules had silently diverged on `q=` (72 / 75 / 80) for the same kind of
 * image; and there was no single place to repoint if the asset host ever changes, which is exactly
 * what "consolidate the mocks" is supposed to buy.
 *
 * ## The prefix rule, and why normalisation is safe
 *
 * Callers disagree about whether a slug carries its `photo-` prefix: `explore/fixtures.ts` passed
 * `"1600880292203-757bb62b4baf"` into a builder that interpolated `photo-${id}`, while
 * `projects/detail-fixtures.ts` passed `"photo-1487412720507-e7ab37603c6f"` into one that did not.
 * {@link photoSlug} adds the prefix only when it is absent, so BOTH conventions produce the exact
 * byte-identical URL they produced before — this consolidation is a refactor, not a change of
 * behaviour, and `mocks/assets_test.ts` pins that claim rather than asserting it in a comment.
 *
 * Asset provenance is unchanged: Unsplash's open registry, per `DESIGN_SYSTEM.md` §C.4.
 */

/** The mock asset host. Repointing the whole corpus is a one-line change here. */
const UNSPLASH_HOST = "https://images.unsplash.com";

/**
 * Normalise an Unsplash slug to its canonical `photo-…` form.
 *
 * Accepts both conventions found across the fixture corpus and is idempotent, so a slug that already
 * carries the prefix is returned untouched rather than doubled.
 */
export function photoSlug(id: string): string {
	return id.startsWith("photo-") ? id : `photo-${id}`;
}

/** The crop mode Unsplash applies. `facearea` centres on a detected face; `crop` is a plain cover. */
export type UnsplashFit = "facearea" | "crop";

/** Transform options for {@link unsplashUrl}. */
export interface UnsplashOptions {
	/** Crop mode. Default `crop`. */
	fit?: UnsplashFit;
	/** Target width in px. */
	w?: number;
	/** Target height in px. Omitted entirely when undefined (Unsplash keeps the aspect ratio). */
	h?: number;
	/** JPEG quality, 1–100. Default 80. */
	q?: number;
	/** Padding multiplier around a detected face. Only meaningful with `fit: "facearea"`. */
	facepad?: number;
	/** Extra `crop=` directive (e.g. `"faces"`), appended verbatim when set. */
	crop?: string;
}

/**
 * Build an Unsplash URL with explicit transform parameters.
 *
 * Parameter ORDER is fixed and deliberate — `auto`, `fit`, `facepad`, `w`, `h`, `q`, `crop` — because
 * the pre-consolidation strings were written in that order and an image CDN response is cached per
 * exact URL. Re-ordering the query would produce a semantically identical URL that misses every warm
 * cache entry, which is a real (if invisible) regression.
 */
export function unsplashUrl(id: string, opts: UnsplashOptions = {}): string {
	const { fit = "crop", w, h, q = 80, facepad, crop } = opts;
	const parts = ["auto=format", `fit=${fit}`];
	if (facepad !== undefined) parts.push(`facepad=${facepad}`);
	if (w !== undefined) parts.push(`w=${w}`);
	if (h !== undefined) parts.push(`h=${h}`);
	parts.push(`q=${q}`);
	if (crop !== undefined) parts.push(`crop=${crop}`);
	return `${UNSPLASH_HOST}/${photoSlug(id)}?${parts.join("&")}`;
}

/**
 * A square face crop — the shared avatar convention (`DESIGN_SYSTEM.md` §C.4).
 *
 * This is the single most duplicated string in the corpus: thirteen modules declared it privately.
 * `size` is one number because an avatar is always square here; a non-square "avatar" would be a
 * different thing wearing the same name.
 */
export function mockAvatar(id: string, size = 96, q = 80): string {
	return unsplashUrl(id, { fit: "facearea", facepad: 3, w: size, h: size, q });
}

/**
 * A landscape crop for a cover, banner, thumbnail or scene.
 *
 * `q` defaults to 80 to match the majority of call sites. Two modules deliberately ship 72 (the
 * discovery corpus, where a grid paints many at once) and one ships 75 (the profile cover); those
 * pass their own value rather than being silently normalised, because dropping a module's chosen
 * quality would change the bytes the browser fetches.
 */
export function mockCover(id: string, w: number, h?: number, q = 80): string {
	return unsplashUrl(id, { fit: "crop", w, h, q });
}
