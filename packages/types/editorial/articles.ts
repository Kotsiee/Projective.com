import { z } from "zod";
import {
	checkDocAnchors,
	type ContentImage,
	type DocSection,
	DocSectionSchema,
} from "../content/doc.ts";
import { SafeHrefSchema, SafeImageSrcSchema } from "../content/nodes.ts";
import { slug, timestamp } from "./common.ts";

/**
 * editorial.articles — the Zod SSOT for Projective's own articles and their authors (P6, Decisions
 * #271 / #274).
 *
 * Projective's articles are rows of `editorial.articles`, canonical at `/articles/[slug]`; every one
 * names an `editorial.article_authors` row. Member-authored posts are NOT here: they stay
 * `catalogue.articles`, rendered at `/view` (owner ruling (b) as revised 2026-10-17 — no editorial
 * flag on that table and no redirect between the two).
 *
 * Two layers, as for every editorial table (`services/editorial/editorial-source.ts`):
 *
 *  - the ROW schemas below are the JSON PostgREST returns for one row of each table AND what the
 *    content source's records are pushed through before they are seeded or served as fixtures;
 *  - the DOMAIN records ({@link EditorialArticleRecord}, {@link EditorialArticleAuthor}) are what the
 *    content source authors and the service reads.
 *
 * An article's slug is READABLE and authored on its own, never derived from the title, and it is
 * permanent once the row exists (`editorial.fn_guard_slug_immutable`, Decision #274 (k)). Its body is
 * an array of P0 document sections (`@projective/types/content`): each section is one `h2` with its
 * own anchor id and a body of ContentNodes, so the reader's table of contents and its headings are
 * derived from the same data.
 *
 * Every export is prefixed `EditorialArticle…`: this module is re-exported by the root barrel, where
 * `Article…` names already exist.
 */

// #region Topics
/**
 * The topics an article can be filed under, in display order — the brief's five, as `?topic=` slugs.
 * The `articles_topics_check` CHECK of `editorial.articles` lists the same values (pinned by
 * `articles-sql.test.ts`).
 */
export const EDITORIAL_ARTICLE_TOPICS = [
	"async-collaboration",
	"agile-delivery",
	"team-structure",
	"value-pricing",
	"escrow-and-trust",
] as const;

/** One article topic. */
export const EditorialArticleTopicSchema = z.enum(EDITORIAL_ARTICLE_TOPICS);
/** One article topic. */
export type EditorialArticleTopic = z.infer<typeof EditorialArticleTopicSchema>;

/** The words a reader sees for each {@link EditorialArticleTopic}. */
export const EDITORIAL_ARTICLE_TOPIC_LABEL: Readonly<Record<EditorialArticleTopic, string>> = {
	"async-collaboration": "Asynchronous collaboration",
	"agile-delivery": "Agile delivery",
	"team-structure": "Team structure",
	"value-pricing": "Value pricing",
	"escrow-and-trust": "Escrow & trust",
};

/** Whether `value` names a topic. */
export function isEditorialArticleTopic(value: string): value is EditorialArticleTopic {
	return (EDITORIAL_ARTICLE_TOPICS as readonly string[]).includes(value);
}
// #endregion

// #region Lifecycle
/**
 * An article's lifecycle (PRODUCT_MANAGEMENT §3.5 "Editorial article"): `draft → published →
 * archived`. Only a `published` article whose `published_at` has passed is shown; `archived` is a
 * retraction — the row is kept (nothing is hard-deleted) and its address answers "not found".
 */
export const EDITORIAL_ARTICLE_STATUSES = ["draft", "published", "archived"] as const;

/** An article's lifecycle state. */
export const EditorialArticleStatusSchema = z.enum(EDITORIAL_ARTICLE_STATUSES);
/** An article's lifecycle state. */
export type EditorialArticleStatus = z.infer<typeof EditorialArticleStatusSchema>;

/** Who an author row stands for: a named person, or a team writing under one byline. */
export const EDITORIAL_ARTICLE_AUTHOR_KINDS = ["person", "team"] as const;

/** An author's kind. */
export const EditorialArticleAuthorKindSchema = z.enum(EDITORIAL_ARTICLE_AUTHOR_KINDS);
/** An author's kind. */
export type EditorialArticleAuthorKind = z.infer<typeof EditorialArticleAuthorKindSchema>;
// #endregion

// #region Rows
/** A timestamp a reader can order by: any string `Date.parse` understands. */
const instant = timestamp.refine((value) => !Number.isNaN(Date.parse(value)), {
	message: "Expected an ISO date-time.",
});

/** A positive pixel dimension. */
const pixels = z.number().int().positive();

/** One row of `editorial.article_authors` — a byline, never a foreign key onto a seeded profile. */
export const EditorialArticleAuthorRowSchema = z.object({
	slug,
	name: z.string().min(1).max(80),
	role: z.string().min(1).max(80),
	kind: EditorialArticleAuthorKindSchema,
	/** One or two sentences under the end-of-article byline. */
	bio: z.string().min(1).max(320),
	/** A static asset (`/logo.svg`, `/test_images/…`): editorial rows never name a storage object. */
	avatar_path: SafeImageSrcSchema,
	avatar_alt: z.string().min(1),
	avatar_w: pixels,
	avatar_h: pixels,
	/** The author's public page (`/@handle`) when they have one; a team byline has none. */
	profile_href: SafeHrefSchema.nullable(),
});
/** One `editorial.article_authors` row. */
export type EditorialArticleAuthorRow = z.infer<typeof EditorialArticleAuthorRowSchema>;

/** The sections of an article body, under the document anchor rule (`checkDocAnchors`). */
const ArticleBodySchema = z.array(DocSectionSchema).min(1).superRefine((sections, ctx) =>
	checkDocAnchors({ sections }, ctx)
);

/** One row of `editorial.articles`. */
export const EditorialArticleRowSchema = z.object({
	slug,
	title: z.string().min(1).max(140),
	/** The lead paragraph under the title — also the page's meta description. */
	standfirst: z.string().min(1).max(320),
	/** One to three topics, the first being the article's primary topic. */
	topics: z.array(EditorialArticleTopicSchema).min(1).max(3).refine(
		(topics) => new Set(topics).size === topics.length,
		{ message: "A topic is listed twice." },
	),
	/** The article's sections (P0 `DocSection[]`): ContentNode JSON in a `jsonb` column. */
	body: ArticleBodySchema,
	cover_path: SafeImageSrcSchema,
	cover_alt: z.string().min(1),
	cover_w: pixels,
	cover_h: pixels,
	author_slug: slug,
	status: EditorialArticleStatusSchema,
	published_at: instant,
	updated_at: instant,
}).refine((row) => Date.parse(row.updated_at) >= Date.parse(row.published_at), {
	message: "An article cannot be updated before it was published.",
	path: ["updated_at"],
});
/** One `editorial.articles` row. */
export type EditorialArticleRow = z.infer<typeof EditorialArticleRowSchema>;
// #endregion

// #region Domain records
/** An author as the content source writes it and the reader shows it. */
export interface EditorialArticleAuthor {
	slug: string;
	name: string;
	role: string;
	kind: EditorialArticleAuthorKind;
	bio: string;
	avatar: ContentImage;
	/** Their public page, or `null` (a team byline links nowhere). */
	href: string | null;
}

/** An article as the content source writes it and the service reads it. */
export interface EditorialArticleRecord {
	/** Readable, authored on its own, permanent once published. */
	slug: string;
	title: string;
	standfirst: string;
	/** The first is the primary topic (the eyebrow and the closing call to action). */
	topics: EditorialArticleTopic[];
	sections: DocSection[];
	cover: ContentImage;
	authorSlug: string;
	status: EditorialArticleStatus;
	/** ISO date-time; normalised to `toISOString()` form when read. */
	publishedAt: string;
	/** ISO date-time, never before {@link publishedAt}. */
	updatedAt: string;
}
// #endregion

// #region Read models
/** What an article tile shows — everything but the body. */
export interface EditorialArticleCard {
	slug: string;
	title: string;
	standfirst: string;
	topics: EditorialArticleTopic[];
	cover: ContentImage;
	publishedAt: string;
	updatedAt: string;
	/** Whole minutes to read, from the body's word count (server-side). */
	readMinutes: number;
	/** The byline's name. */
	authorName: string;
}

/** One page of the `/articles` index. */
export interface EditorialArticleIndex {
	/** The topics the index is filtered by (canonical order); empty = every topic. */
	topics: EditorialArticleTopic[];
	/** This page's articles, newest first. */
	items: EditorialArticleCard[];
	/** 1-based page number. */
	page: number;
	/** At least 1, even when nothing matches. */
	pageCount: number;
	/** Articles matching the filter, across every page. */
	total: number;
	/** Published articles per topic, unfiltered — the filter control's counts. */
	topicCounts: Readonly<Record<EditorialArticleTopic, number>>;
	/** Published articles in all, unfiltered — the "All topics" count. */
	publishedTotal: number;
}

/** An article with its body, as the reader renders it. */
export interface EditorialArticleView extends EditorialArticleCard {
	sections: DocSection[];
	/** Words in the title, standfirst and body — the reading time's input and the JSON-LD's. */
	wordCount: number;
}

/** Everything `/articles/[slug]` renders. */
export interface EditorialArticlePage {
	article: EditorialArticleView;
	author: EditorialArticleAuthor;
	/** Up to three other articles, closest topics first. */
	related: EditorialArticleCard[];
}
// #endregion
