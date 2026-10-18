import type { HelpCentreArticle, HelpCentreCategory } from "@projective/types/editorial";
import {
	HELP_ROOT,
	helpArticlePath,
	helpCategoryPath,
	type HelpCentreLibrary,
	type HelpCentreTopic,
} from "@server/services/editorial/help-library.ts";

/**
 * help-path.ts — how `/help/[...path]` dispatches (P2 work order §1). Pure: the route hands it the
 * request's path segments and the help library, and gets back what to render or where to send the
 * reader.
 *
 * | Path                              | Answer                                                   |
 * | :-------------------------------- | :------------------------------------------------------- |
 * | `/help`                           | the hub                                                  |
 * | `/help/<category>`                | that category's page                                     |
 * | `/help/<category>/<article>`      | the article, when it is in that category                 |
 * | `/help/<article>`                 | 308 to the article's canonical path (a guessed address)  |
 * | `/help/<old-category>/<article>`  | 308 to its canonical path (the article moved category)   |
 * | a canonical path in another case  | 308 to the lower-case path (`/help/Fees` → `/help/…/fees`) |
 * | anything else                     | not found (404)                                          |
 *
 * A redirect keeps the query string, so a shared `?q=` survives it. Slugs are permanent
 * (Decision #274 (k)), which is what makes the moved-category redirect safe to issue forever.
 */

// #region Types
/** What the help route renders, or where it sends the reader. */
export type HelpPathTarget =
	| { kind: "hub" }
	| { kind: "category"; topic: HelpCentreTopic }
	| { kind: "article"; article: HelpCentreArticle; category: HelpCentreCategory }
	| { kind: "redirect"; location: string }
	| { kind: "not-found" };
// #endregion

// #region Segments
/**
 * The `[...path]` parameter as decoded, lower-cased segments, or `null` when one cannot be a slug
 * (bad percent-encoding, a dot segment) — which is simply not found. Empty segments (a trailing
 * slash, a doubled one) are dropped.
 */
export function helpSegments(param: string | undefined): string[] | null {
	if (!param) return [];
	const out: string[] = [];
	for (const raw of param.split("/")) {
		if (raw.length === 0) continue;
		let segment: string;
		try {
			segment = decodeURIComponent(raw);
		} catch {
			return null;
		}
		if (segment === "." || segment === "..") return null;
		out.push(segment.toLowerCase());
	}
	return out;
}
// #endregion

// #region Resolution
/** The redirect to `canonical` — or `null` when the request is already there. */
function redirectTo(canonical: string, requestPath: string, search: string): HelpPathTarget | null {
	return canonical === requestPath ? null : { kind: "redirect", location: `${canonical}${search}` };
}

/**
 * Resolve a help path. `requestPath` is the URL's pathname as requested (for the canonical-case
 * check) and `search` its query string including the `?` (kept on a redirect).
 */
export function resolveHelpPath(
	segments: readonly string[] | null,
	library: HelpCentreLibrary,
	requestPath: string,
	search = "",
): HelpPathTarget {
	if (segments === null || segments.length > 2) return { kind: "not-found" };
	if (segments.length === 0) {
		return redirectTo(HELP_ROOT, requestPath.replace(/\/+$/, "") || HELP_ROOT, search) ??
			{ kind: "hub" };
	}

	if (segments.length === 1) {
		const topic = library.topic(segments[0]);
		if (topic) {
			return redirectTo(helpCategoryPath(topic.category.slug), requestPath, search) ??
				{ kind: "category", topic };
		}
		const article = library.article(segments[0]);
		return article
			? { kind: "redirect", location: `${helpArticlePath(article)}${search}` }
			: { kind: "not-found" };
	}

	const article = library.article(segments[1]);
	const category = article ? library.categoryOf(article) : null;
	if (!article || !category) return { kind: "not-found" };
	return redirectTo(helpArticlePath(article), requestPath, search) ??
		{ kind: "article", article, category };
}
// #endregion
