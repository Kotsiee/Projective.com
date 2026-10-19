/**
 * The legal library's share of the sitemap (PUBLIC_ROUTES P8, Decision #279). A legal document is
 * listed only once the version in effect has been reviewed (`reviewedAt` set): until then its page is
 * a `noindex` draft (owner ruling (e), Decision #270), and a sitemap must not ask a search engine to
 * index a page that tells it not to. The hub follows its own rule — indexable once ANY document in
 * effect is reviewed — so it is listed on the same terms. Today every document is a draft, so this
 * lists nothing.
 *
 * Pure over the families it is given; the sitemap route passes `LEGAL_LIBRARY`.
 *
 * @module
 */
import type { LegalDoc } from "@projective/types/content";
import type { SitemapEntry } from "@features/marketing/core/sitemap.ts";
import { currentVersion, type LegalFamily } from "./registry.ts";
import { LEGAL_HUB_HREF, legalDocumentHref } from "./versions.ts";

/** The latest of some `YYYY-MM-DD` dates (they sort as text). */
function latest(dates: readonly string[]): string | undefined {
	return dates.length === 0 ? undefined : [...dates].sort().at(-1);
}

/**
 * The legal pages a search engine may index on `today` (`YYYY-MM-DD`, UTC): each document whose
 * version in effect is reviewed, last modified on that version's `updatedAt`, and the hub when any
 * is, last modified on the latest of theirs.
 */
export function legalSitemapEntries(
	families: readonly LegalFamily[],
	today: string,
): SitemapEntry[] {
	const reviewed: Array<{ slug: string; doc: LegalDoc }> = families
		.map((family) => ({ slug: family.slug, doc: currentVersion(family, today) }))
		.filter(({ doc }) => doc.reviewedAt !== null);
	if (reviewed.length === 0) return [];
	return [
		{ path: LEGAL_HUB_HREF, lastmod: latest(reviewed.map(({ doc }) => doc.updatedAt)) },
		...reviewed.map(({ slug, doc }) => ({ path: legalDocumentHref(slug), lastmod: doc.updatedAt })),
	];
}
