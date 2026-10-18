import { z } from "zod";
import {
	EDITORIAL_ARTICLE_TOPICS,
	type EditorialArticleTopic,
	EditorialArticleTopicSchema,
} from "@projective/types/editorial";

/**
 * index-query.ts — the `/articles` URL contract (P6): `?topic=<slug>` (repeatable, any-of) and
 * `?page=<n>` (1-based). Pure, so the route's normalisation and every link the index renders agree
 * on one spelling of each state.
 *
 * The canonical spelling: topics are known slugs only, each once, in `EDITORIAL_ARTICLE_TOPICS`
 * order; `page` is omitted on page 1 and otherwise a plain positive integer. Any other parameter (a
 * campaign tag) is left alone. A request in another spelling is redirected to this one, so a filter
 * has exactly one address.
 */

// #region Types
/** What the index reads from its URL. */
export interface ArticleIndexQuery {
	/** Topics to filter by (any of), canonical order; empty = every topic. */
	topics: EditorialArticleTopic[];
	/** 1-based page. */
	page: number;
}

/** {@link ArticleIndexQuery} plus how the request's own spelling compares to the canonical one. */
export interface ParsedArticleIndexQuery extends ArticleIndexQuery {
	/** The canonical query string, `?…` or `""`, other parameters kept in their order. */
	search: string;
	/** Whether the request spelled its topics or page differently — the route redirects when so. */
	changed: boolean;
}
// #endregion

// #region Parsing
/** The largest page number accepted; beyond it a page is malformed rather than merely empty. */
const MAX_PAGE = 9999;

/**
 * One `?page=` value: a plain positive integer (no sign, no leading zero, no fraction) up to
 * {@link MAX_PAGE}. Anything else is malformed, read as page 1 and redirected.
 */
const PageParamSchema = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(
	z.number().int().max(MAX_PAGE),
);

/** Topics in canonical order: each value parsed by the SSOT topic schema, unknowns and repeats dropped. */
export function canonicalTopics(values: readonly string[]): EditorialArticleTopic[] {
	const wanted = new Set<EditorialArticleTopic>();
	for (const value of values) {
		const topic = EditorialArticleTopicSchema.safeParse(value);
		if (topic.success) wanted.add(topic.data);
	}
	return EDITORIAL_ARTICLE_TOPICS.filter((topic) => wanted.has(topic));
}

/** A `?page=` value as a page number: absent or malformed is page 1. */
function readPage(raw: string | null): number {
	if (raw === null) return 1;
	const page = PageParamSchema.safeParse(raw);
	return page.success ? page.data : 1;
}

/** Read `/articles`' query: topics, page, and the canonical spelling of both. */
export function parseArticleIndexQuery(params: URLSearchParams): ParsedArticleIndexQuery {
	const rawTopics = params.getAll("topic");
	const topics = canonicalTopics(rawTopics);
	const rawPage = params.get("page");
	const page = readPage(rawPage);
	const rest = [...params.entries()].filter(([key]) => key !== "topic" && key !== "page");
	const search = buildSearch(topics, page, rest);
	const pageSpelling = page === 1 ? null : String(page);
	const changed = rawTopics.length !== topics.length ||
		rawTopics.some((topic, i) => topic !== topics[i]) ||
		rawPage !== pageSpelling ||
		params.getAll("page").length > 1;
	return { topics, page, search, changed };
}

/** `?topic=a&topic=b&page=2&…rest`, or `""`. */
function buildSearch(
	topics: readonly EditorialArticleTopic[],
	page: number,
	rest: ReadonlyArray<[string, string]> = [],
): string {
	const out = new URLSearchParams();
	for (const topic of topics) out.append("topic", topic);
	if (page > 1) out.set("page", String(page));
	for (const [key, value] of rest) out.append(key, value);
	const text = out.toString();
	return text ? `?${text}` : "";
}
// #endregion

// #region Links
/** The index at `topics` (canonicalised) and `page`. */
export function articlesIndexHref(query: Partial<ArticleIndexQuery> = {}): string {
	return `/articles${buildSearch(canonicalTopics(query.topics ?? []), query.page ?? 1)}`;
}

/**
 * The index with `topic` toggled in or out of `current`, back on page 1 — a new filter is a new
 * list, so staying on page 4 of the old one would be meaningless.
 */
export function toggleTopicHref(
	current: readonly EditorialArticleTopic[],
	topic: EditorialArticleTopic,
): string {
	const next = current.includes(topic)
		? current.filter((each) => each !== topic)
		: [...current, topic];
	return articlesIndexHref({ topics: next });
}

/** One article's canonical address. */
export function articleHref(slug: string): string {
	return `/articles/${slug}`;
}

/** Whether a path segment can be an article slug at all (readable kebab-case, as stored). */
export function isArticleSlug(value: string): boolean {
	return value.length <= 96 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
// #endregion
