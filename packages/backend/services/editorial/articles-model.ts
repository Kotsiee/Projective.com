import { inlineText, nodesText, wordCount } from "@projective/types/content/text";
import {
	EDITORIAL_ARTICLE_TOPICS,
	type EditorialArticleCard,
	type EditorialArticleRecord,
	type EditorialArticleTopic,
	type EditorialArticleView,
} from "@projective/types/editorial";

/**
 * articles-model.ts — the pure rules behind Projective's article index and reader (P6, Decision
 * #271): reading time, ordering, the topic filter, pagination and related reading. No Supabase, no
 * environment and no clock of its own, so every rule is unit-tested and both reader roads (live and
 * fixture) share it through `EditorialArticlesBackendService`.
 */

// #region Constants
/** Articles per index page: a lead, two features and a grid of nine on the first page. */
export const ARTICLES_PAGE_SIZE = 12;

/** Reading speed for the reading-time estimate, in words per minute (P0's `readingMinutes` rate). */
export const ARTICLE_WORDS_PER_MINUTE = 230;

/** How many related articles the reader offers. */
export const RELATED_ARTICLES_LIMIT = 3;
// #endregion

// #region Reading time
/**
 * Words a reader reads in an article: its title, standfirst, every section heading, summary line and
 * body — the same projection P0's `docText` makes of a document.
 */
export function articleWordCount(
	article: Pick<EditorialArticleRecord, "title" | "standfirst" | "sections">,
): number {
	const parts = [
		article.title,
		article.standfirst,
		...article.sections.flatMap((section) => [
			section.heading,
			section.tldr ? inlineText(section.tldr) : "",
			nodesText(section.body),
		]),
	];
	return wordCount(parts.filter((part) => part.length > 0).join("\n\n"));
}

/** Whole minutes to read `words` at `wordsPerMinute`, rounded, never less than one. */
export function articleReadMinutes(
	words: number,
	wordsPerMinute: number = ARTICLE_WORDS_PER_MINUTE,
): number {
	if (!Number.isFinite(words) || words <= 0) return 1;
	return Math.max(1, Math.round(words / wordsPerMinute));
}
// #endregion

// #region Projections
/** An article as a tile: everything but the body, with its reading time computed. */
export function toArticleCard(
	article: EditorialArticleRecord,
	authorName: string,
	words: number = articleWordCount(article),
): EditorialArticleCard {
	return {
		slug: article.slug,
		title: article.title,
		standfirst: article.standfirst,
		topics: [...article.topics],
		cover: article.cover,
		publishedAt: article.publishedAt,
		updatedAt: article.updatedAt,
		readMinutes: articleReadMinutes(words),
		authorName,
	};
}

/** An article as the reader renders it: the tile plus its sections and word count. */
export function toArticleView(
	article: EditorialArticleRecord,
	authorName: string,
): EditorialArticleView {
	const words = articleWordCount(article);
	return {
		...toArticleCard(article, authorName, words),
		sections: article.sections,
		wordCount: words,
	};
}
// #endregion

// #region Ordering, filtering, pagination
/** Newest first by publication time; ties broken by slug so the order is total and stable. */
export function compareNewestFirst(
	a: Pick<EditorialArticleRecord, "publishedAt" | "slug">,
	b: Pick<EditorialArticleRecord, "publishedAt" | "slug">,
): number {
	const byTime = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
	if (byTime !== 0) return byTime;
	return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/**
 * The articles filed under ANY of `topics` (a topic filter is one facet, so its choices widen the
 * set); every article when `topics` is empty. Order is kept.
 */
export function filterByTopics<T extends { topics: readonly EditorialArticleTopic[] }>(
	articles: readonly T[],
	topics: readonly EditorialArticleTopic[],
): T[] {
	if (topics.length === 0) return [...articles];
	const wanted = new Set(topics);
	return articles.filter((article) => article.topics.some((topic) => wanted.has(topic)));
}

/** How many articles are filed under each topic (an article with two topics counts for both). */
export function countTopics(
	articles: readonly { topics: readonly EditorialArticleTopic[] }[],
): Record<EditorialArticleTopic, number> {
	const counts = Object.fromEntries(EDITORIAL_ARTICLE_TOPICS.map((topic) => [topic, 0])) as Record<
		EditorialArticleTopic,
		number
	>;
	for (const article of articles) {
		for (const topic of new Set(article.topics)) counts[topic] += 1;
	}
	return counts;
}

/** One page of a list. */
export interface ArticlePage<T> {
	items: T[];
	page: number;
	pageCount: number;
	total: number;
}

/**
 * Page `page` (1-based) of `items`, `size` per page. An empty list still has one (empty) page; a
 * page past the last, or not a positive integer, is `null` — the route answers it with a 404.
 */
export function paginate<T>(
	items: readonly T[],
	page: number,
	size: number = ARTICLES_PAGE_SIZE,
): ArticlePage<T> | null {
	if (!Number.isInteger(size) || size < 1) throw new RangeError("A page holds at least one item.");
	const total = items.length;
	const pageCount = Math.max(1, Math.ceil(total / size));
	if (!Number.isInteger(page) || page < 1 || page > pageCount) return null;
	const start = (page - 1) * size;
	return { items: items.slice(start, start + size), page, pageCount, total };
}
// #endregion

// #region Related reading
/**
 * Up to `limit` other articles to read next: those sharing the most topics first, then those
 * sharing the article's PRIMARY topic, then the newest. When fewer than `limit` share a topic the
 * list is topped up with the newest others, so the reader always ends on somewhere to go.
 */
export function relatedArticles<
	T extends Pick<EditorialArticleRecord, "slug" | "topics" | "publishedAt">,
>(
	article: Pick<EditorialArticleRecord, "slug" | "topics">,
	pool: readonly T[],
	limit: number = RELATED_ARTICLES_LIMIT,
): T[] {
	const mine = new Set(article.topics);
	const primary = article.topics[0];
	const scored = pool
		.filter((other) => other.slug !== article.slug)
		.map((other) => ({
			other,
			shared: other.topics.filter((topic) => mine.has(topic)).length,
			primary: other.topics.includes(primary) ? 1 : 0,
		}));
	scored.sort((a, b) =>
		(b.shared - a.shared) || (b.primary - a.primary) || compareNewestFirst(a.other, b.other)
	);
	return scored.slice(0, Math.max(0, limit)).map(({ other }) => other);
}
// #endregion
