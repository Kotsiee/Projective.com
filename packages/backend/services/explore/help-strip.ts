import type { EditorialPromo } from "@projective/types/explore";
import { readingMinutes } from "@projective/types/content/text";
import { HELP_ROOT, helpArticlePath, type HelpCentreLibrary } from "../editorial/help-library.ts";

/**
 * help-strip.ts — Explore Home's editorial break ("New here? Start with these", Decision #175), built
 * from the help centre (Decision #295). Pure: the Home feed hands it the library `HelpBackendService`
 * read, so the ordering rule is the help centre's own and is unit-tested here.
 *
 * The strip used to list the three newest MEMBER posts (`catalogue.articles`, at `/view/:id`) under a
 * heading that promises onboarding and a link to the help centre — two sources under one heading
 * (#279 (h)), and a duplicate of Home's own member-articles rail. It now lists the opening topic of the
 * help hub, in reading order: the hub orders its topics by `position`, and the first is the one a
 * newcomer is meant to start with ("Getting started" today). Reading the first topic rather than a
 * named slug keeps the strip correct if that topic is ever retitled or re-ordered.
 */

/** How many reads the strip lists. */
export const HELP_STRIP_SIZE = 3;

/**
 * The strip for `library`, or `null` when there is nothing to list — an unreadable help centre or one
 * with no visible article. Absent, the Home feed simply has no editorial break; it never shows an empty
 * one.
 */
export function helpStripFrom(library: HelpCentreLibrary | null): EditorialPromo | null {
	const opening = library?.topics[0];
	if (!opening || opening.articles.length === 0) return null;
	return {
		variant: "editorial",
		id: "ed-help",
		after: "products",
		lead: "New here?",
		tail: "Start with these",
		href: HELP_ROOT,
		hrefLabel: "All help articles",
		articles: opening.articles.slice(0, HELP_STRIP_SIZE).map((article) => ({
			id: article.slug,
			title: article.title,
			minutes: readingMinutes(article),
			href: helpArticlePath(article),
		})),
	};
}
