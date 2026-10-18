import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import {
	EDITORIAL_ARTICLE_TOPICS,
	type EditorialArticleAuthor,
	type EditorialArticleIndex,
	type EditorialArticlePage,
	type EditorialArticleRecord,
	type EditorialArticleTopic,
} from "@projective/types/editorial";
import { type EditorialReadOptions, readEditorialTable } from "./editorial-source.ts";
import { ARTICLE_AUTHORS, ARTICLES } from "./content/articles.ts";
import {
	ARTICLES_PAGE_SIZE,
	compareNewestFirst,
	countTopics,
	filterByTopics,
	paginate,
	relatedArticles,
	toArticleCard,
	toArticleView,
} from "./articles-model.ts";

/**
 * EditorialArticlesBackendService — Projective's own articles (P6, Decisions #271 / #274), read from
 * `editorial.articles` and `editorial.article_authors` through the shared editorial reader: the anon
 * client when `EDITORIAL_BACKEND_LIVE` is on, the content source's own records through the same row
 * parse and mapping when it is off. Either way only VISIBLE articles reach this service (published
 * and past their publication time — `isEditorialArticleVisible`), so a draft, a future-dated article
 * and a retracted one answer exactly like a missing one.
 *
 * Both tables are small reference sets, read whole and ordered here; the rules themselves are the
 * pure `articles-model.ts`. Member-authored posts (`catalogue.articles`, `/view`) are not read here.
 */

// #region Types
/** The index query: topic filter (any of) and a 1-based page. */
export interface EditorialArticleIndexQuery {
	topics: readonly EditorialArticleTopic[];
	page: number;
}

/** What both reads return before they are shaped: every visible article, newest first, by author. */
interface ArticleCorpus {
	articles: EditorialArticleRecord[];
	authors: Map<string, EditorialArticleAuthor>;
}
// #endregion

// #region Reading
/**
 * Every visible article (newest first) and every author, or the read's failure. An article whose
 * author row is missing is a 500 naming it: the foreign key makes that impossible live, and the
 * content source's tests make it impossible in fixtures, so reaching it means the data drifted.
 */
async function readCorpus(options: EditorialReadOptions): Promise<ServiceResult<ArticleCorpus>> {
	const [authors, articles] = await Promise.all([
		readEditorialTable(ARTICLE_AUTHORS, options),
		readEditorialTable(ARTICLES, options),
	]);
	if (!authors.ok || !authors.data) {
		return fail(authors.status, { message: authors.message, details: authors.details });
	}
	if (!articles.ok || !articles.data) {
		return fail(articles.status, { message: articles.message, details: articles.details });
	}
	const byAuthor = new Map(authors.data.records.map((author) => [author.slug, author]));
	const orphan = articles.data.records.find((article) => !byAuthor.has(article.authorSlug));
	if (orphan) {
		return fail(500, {
			message: "This content could not be read.",
			details: { table: "editorial.articles", slug: orphan.slug, author: orphan.authorSlug },
		});
	}
	return ok({ articles: [...articles.data.records].sort(compareNewestFirst), authors: byAuthor });
}

/** The author's name for a corpus article (present by {@link readCorpus}'s check). */
function authorName(corpus: ArticleCorpus, article: EditorialArticleRecord): string {
	return corpus.authors.get(article.authorSlug)?.name ?? "";
}
// #endregion

// #region Service
export const EditorialArticlesBackendService = {
	/**
	 * One page of `/articles`: the visible articles filed under any of `query.topics` (all when
	 * empty), newest first, `ARTICLES_PAGE_SIZE` per page, with each topic's count across every visible
	 * article. Unknown topics are dropped and the rest put in canonical order. A page past the last is
	 * a 404; an empty result is page 1 of 1, so "nothing here yet" is an answer, not an error.
	 */
	async index(
		query: EditorialArticleIndexQuery,
		options: EditorialReadOptions = {},
	): Promise<ServiceResult<EditorialArticleIndex>> {
		const corpus = await readCorpus(options);
		if (!corpus.ok || !corpus.data) {
			return fail(corpus.status, { message: corpus.message, details: corpus.details });
		}
		const data = corpus.data;
		const topics = EDITORIAL_ARTICLE_TOPICS.filter((topic) => query.topics.includes(topic));
		const matching = filterByTopics(data.articles, topics);
		const slice = paginate(matching, query.page, ARTICLES_PAGE_SIZE);
		if (!slice) {
			return fail(404, {
				message: "That page of articles does not exist.",
				details: { page: query.page },
			});
		}
		return ok({
			topics,
			items: slice.items.map((article) => toArticleCard(article, authorName(data, article))),
			page: slice.page,
			pageCount: slice.pageCount,
			total: slice.total,
			topicCounts: countTopics(data.articles),
			publishedTotal: data.articles.length,
		});
	},

	/**
	 * `/articles/[slug]`: the visible article with that slug, its author and up to three related
	 * articles. A slug that names nothing visible is a 404 — whether it never existed, is a draft,
	 * is dated in the future or was retracted.
	 */
	async article(
		slug: string,
		options: EditorialReadOptions = {},
	): Promise<ServiceResult<EditorialArticlePage>> {
		const corpus = await readCorpus(options);
		if (!corpus.ok || !corpus.data) {
			return fail(corpus.status, { message: corpus.message, details: corpus.details });
		}
		const data = corpus.data;
		const article = data.articles.find((candidate) => candidate.slug === slug);
		if (!article) {
			return fail(404, { message: "That article does not exist.", details: { slug } });
		}
		const author = data.authors.get(article.authorSlug) as EditorialArticleAuthor;
		return ok({
			article: toArticleView(article, author.name),
			author,
			related: relatedArticles(article, data.articles).map((other) =>
				toArticleCard(other, authorName(data, other))
			),
		});
	},
};
// #endregion
