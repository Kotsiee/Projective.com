import type { ContentAudience } from "@projective/types/content";
import type { HelpCentreArticle, HelpCentreCategory } from "@projective/types/editorial";

/**
 * help-library.ts — the help centre's records, organised for reading (P2). Pure and synchronous: the
 * help service builds one library from whatever `readEditorialTable` returned (live rows or the
 * content source), and the hub, category and article pages read every list they show from it, so the
 * ordering rules live in one place and are unit-tested.
 *
 * Ordering: categories by `position`; a category's articles by `position`; anything that spans
 * categories (a role's "Start here" column, the FAQ fallback) by category, then article. A category
 * with no visible article is left out of every list — an empty topic row would be a link to nothing.
 */

// #region Types
/** One category with the articles a reader can open in it, in reading order. */
export interface HelpCentreTopic {
	category: HelpCentreCategory;
	articles: HelpCentreArticle[];
}

/** An article's neighbours inside its category. */
export interface HelpCentreNeighbours {
	previous: HelpCentreArticle | null;
	next: HelpCentreArticle | null;
}

/** The organised help centre. Build it with {@link buildHelpLibrary}. */
export interface HelpCentreLibrary {
	/** The non-empty topics, in hub order. */
	readonly topics: readonly HelpCentreTopic[];
	/** Every visible article, in reading order (category, then article). */
	readonly articles: readonly HelpCentreArticle[];
	/** A topic by its category slug. */
	topic(slug: string): HelpCentreTopic | null;
	/** A visible article by its slug. */
	article(slug: string): HelpCentreArticle | null;
	/** The category an article belongs to. */
	categoryOf(article: HelpCentreArticle): HelpCentreCategory | null;
	/** The previous and next article in the same category. */
	neighbours(article: HelpCentreArticle): HelpCentreNeighbours;
	/** The article's related articles that a reader can open, in the authored order. */
	related(article: HelpCentreArticle): HelpCentreArticle[];
	/** The "Start here" column for one role, in reading order. */
	startHere(role: ContentAudience): HelpCentreArticle[];
	/** The hub's FAQ: the articles carrying an FAQ entry, by rank. */
	faq(): HelpCentreArticle[];
}
// #endregion

// #region Building
/** Order two articles by their categories' order, then their own. */
function byReadingOrder(
	categoryOrder: ReadonlyMap<string, number>,
): (a: HelpCentreArticle, b: HelpCentreArticle) => number {
	return (a, b) =>
		(categoryOrder.get(a.category) ?? Number.MAX_SAFE_INTEGER) -
			(categoryOrder.get(b.category) ?? Number.MAX_SAFE_INTEGER) ||
		a.position - b.position ||
		a.slug.localeCompare(b.slug);
}

/**
 * Organise categories and (already visible) articles for reading. An article whose category is
 * missing is left out, since no page could place it.
 */
export function buildHelpLibrary(
	categories: readonly HelpCentreCategory[],
	articles: readonly HelpCentreArticle[],
): HelpCentreLibrary {
	const sortedCategories = [...categories].sort((a, b) =>
		a.position - b.position || a.slug.localeCompare(b.slug)
	);
	const categoryOrder = new Map(sortedCategories.map((c, i) => [c.slug, i]));
	const categoryBySlug = new Map(sortedCategories.map((c) => [c.slug, c]));
	const placed = articles
		.filter((article) => categoryBySlug.has(article.category))
		.sort(byReadingOrder(categoryOrder));
	const articleBySlug = new Map(placed.map((a) => [a.slug, a]));

	const topics: HelpCentreTopic[] = sortedCategories
		.map((category) => ({
			category,
			articles: placed.filter((article) => article.category === category.slug),
		}))
		.filter((topic) => topic.articles.length > 0);
	const topicBySlug = new Map(topics.map((t) => [t.category.slug, t]));

	return Object.freeze({
		topics,
		articles: placed,
		topic: (slug: string) => topicBySlug.get(slug) ?? null,
		article: (slug: string) => articleBySlug.get(slug) ?? null,
		categoryOf: (article: HelpCentreArticle) => categoryBySlug.get(article.category) ?? null,
		neighbours: (article: HelpCentreArticle): HelpCentreNeighbours => {
			const list = topicBySlug.get(article.category)?.articles ?? [];
			const at = list.findIndex((a) => a.slug === article.slug);
			if (at < 0) return { previous: null, next: null };
			return { previous: list[at - 1] ?? null, next: list[at + 1] ?? null };
		},
		related: (article: HelpCentreArticle) =>
			article.related
				.map((slug) => articleBySlug.get(slug))
				.filter((a): a is HelpCentreArticle => a !== undefined && a.slug !== article.slug),
		startHere: (role: ContentAudience) => placed.filter((a) => a.startHere.includes(role)),
		faq: () =>
			placed
				.filter((a) => a.faq !== null)
				.sort((a, b) => (a.faq?.rank ?? 0) - (b.faq?.rank ?? 0)),
	});
}
// #endregion

// #region Addresses
/** The hub's path. */
export const HELP_ROOT = "/help";

/** A category page's canonical path. */
export function helpCategoryPath(category: string): string {
	return `${HELP_ROOT}/${category}`;
}

/** An article's canonical path. */
export function helpArticlePath(article: Pick<HelpCentreArticle, "category" | "slug">): string {
	return `${HELP_ROOT}/${article.category}/${article.slug}`;
}
// #endregion
