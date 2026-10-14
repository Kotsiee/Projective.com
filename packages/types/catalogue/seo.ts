import { z } from "zod";

/**
 * catalogue.seo — how a listing reads in a search result, and the search tags it is found by.
 *
 * The meta fields are optional overrides: an empty `seoTitle` falls back to the listing's title and
 * an empty `seoDescription` to its plain-text description, so a seller who never opens the SEO
 * section still ships a sensible snippet.
 */

// #region Limits
/** The most search tags a listing carries (Decision #217(f)). */
export const LISTING_TAGS_MAX = 10;
/** The longest single search tag. */
export const LISTING_TAG_LENGTH_MAX = 40;
/** Where a result title is cut, near the width a search engine shows. */
export const SERP_TITLE_MAX = 60;
/** Where a result description is cut. */
export const SERP_DESCRIPTION_MAX = 155;
// #endregion

// #region Schemas
/** A listing's search tags (`catalogue.listing_tags`). */
export const ListingTagsSchema = z.array(z.string().trim().min(1).max(LISTING_TAG_LENGTH_MAX))
	.max(LISTING_TAGS_MAX, `Use at most ${LISTING_TAGS_MAX} tags.`);

/** A listing's meta overrides (`catalogue.listings.seo_title` / `seo_description`). Empty = fallback. */
export const ListingSeoSchema = z.object({
	seoTitle: z.string().max(70),
	seoDescription: z.string().max(160),
});
export type ListingSeo = z.infer<typeof ListingSeoSchema>;
// #endregion

// #region SERP snippet
/** What {@link serpSnippet} renders from. */
export interface SerpInput {
	slug: string;
	title: string;
	descriptionText: string;
	seo: ListingSeo;
}

/** A search-result preview, with which parts were cut to fit. */
export interface SerpSnippet {
	title: string;
	url: string;
	description: string;
	truncated: { title: boolean; description: boolean };
}

interface Cut {
	text: string;
	truncated: boolean;
}

/** Collapse whitespace, then cut on a word boundary so the result plus `…` fits `max`. */
export function truncateWords(raw: string, max: number): Cut {
	const text = raw.replace(/\s+/g, " ").trim();
	if (text.length <= max) return { text, truncated: false };
	const room = text.slice(0, max - 1);
	const space = room.lastIndexOf(" ");
	const head = space > 0 ? room.slice(0, space) : room;
	return { text: `${head.replace(/[\s,;:.\-–—]+$/, "")}…`, truncated: true };
}

/**
 * The search-result preview the SEO section shows: the title (override or listing title), the
 * listing's public URL, and the description (override or the start of the plain-text description),
 * each cut on a word boundary.
 */
export function serpSnippet(input: SerpInput): SerpSnippet {
	const title = truncateWords(input.seo.seoTitle.trim() || input.title, SERP_TITLE_MAX);
	const description = truncateWords(
		input.seo.seoDescription.trim() || input.descriptionText,
		SERP_DESCRIPTION_MAX,
	);
	return {
		title: title.text,
		url: `projective.com › view › ${input.slug}`,
		description: description.text,
		truncated: { title: title.truncated, description: description.truncated },
	};
}
// #endregion
