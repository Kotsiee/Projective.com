import type { HelpCentreArticle, HelpCentreFaq } from "@projective/types/editorial";

/**
 * The help centre's authoring helper (P2, Decision #274): one call per article, so each record in
 * `content/help/<category>.ts` states only what is particular to it.
 *
 * What it fills in, and why it is safe to:
 *
 *  - `id` is the slug — a readable editorial slug is permanent (#274 (k)), so it is a stable identity.
 *  - `version` is the date the article last changed; help articles are not versioned documents, and
 *    the reader's meta line shows the date, never a version label.
 *  - `publishedOn` defaults to {@link HELP_CENTRE_LAUNCH}: the centre opened with every article.
 *  - `faq` / `startHere` / `related` / `archivedOn` default to none.
 *
 * Validation is not done here: every record is pushed through the table's `toRow` and its Zod row
 * schema by the generator, the fixture road and `help-content.test.ts`, which also checks every
 * related slug and category resolves.
 */

/** The day the help centre opened — every launch article's publication date. */
export const HELP_CENTRE_LAUNCH = "2026-10-17";

/** What an article's source states (see the module docblock for what is derived). */
export type HelpArticleSpec =
	& Omit<
		HelpCentreArticle,
		| "id"
		| "version"
		| "faq"
		| "startHere"
		| "related"
		| "publishedOn"
		| "archivedOn"
		| "updatedAt"
	>
	& {
		/** The day its facts were last checked against the product (default {@link HELP_CENTRE_LAUNCH}). */
		updatedAt?: string;
		faq?: HelpCentreFaq;
		startHere?: HelpCentreArticle["startHere"];
		related?: string[];
		publishedOn?: string;
		archivedOn?: string | null;
	};

/** Author one help article. */
export function helpArticle(spec: HelpArticleSpec): HelpCentreArticle {
	const updatedAt = spec.updatedAt ?? HELP_CENTRE_LAUNCH;
	return {
		...spec,
		id: spec.slug,
		version: updatedAt,
		updatedAt,
		faq: spec.faq ?? null,
		startHere: spec.startHere ?? [],
		related: spec.related ?? [],
		publishedOn: spec.publishedOn ?? HELP_CENTRE_LAUNCH,
		archivedOn: spec.archivedOn ?? null,
	};
}
