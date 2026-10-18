import { CONTENT_AUDIENCE_LABEL, type ContentAudience } from "@projective/types/content";
import {
	helpArticlePath,
	type HelpCentreLibrary,
} from "@server/services/editorial/help-library.ts";

/**
 * help-view.ts — small pure projections the help pages share (P2): what the search overlay offers
 * before anything is typed, and the article page's audience line.
 */

/** A common question the overlay offers while its field is empty. */
export interface HelpSuggestion {
	title: string;
	href: string;
	categoryTitle: string;
}

/** The hub's FAQ, as the overlay's "Common questions": each question, linked to its article. */
export function faqSuggestions(library: HelpCentreLibrary): HelpSuggestion[] {
	return library.faq().map((article) => ({
		title: article.faq?.question ?? article.title,
		href: helpArticlePath(article),
		categoryTitle: library.categoryOf(article)?.title ?? "",
	}));
}

/** Who an article is written for, in the product's words: `For Client, Business`. */
export function audienceLine(roles: readonly ContentAudience[]): string {
	return `For ${roles.map((role) => CONTENT_AUDIENCE_LABEL[role]).join(", ")}`;
}
