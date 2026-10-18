import {
	type EditorialArticleAuthor,
	type EditorialArticleAuthorRow,
	EditorialArticleAuthorRowSchema,
	type EditorialArticleRecord,
	type EditorialArticleRow,
	EditorialArticleRowSchema,
} from "@projective/types/editorial";
import {
	defineEditorialSurface,
	defineEditorialTable,
	editorialContent,
} from "../editorial-source.ts";
import { ARTICLE_AUTHOR_RECORDS } from "./articles/authors.ts";
import { ASYNCHRONOUS_COLLABORATION_IN_STAGES } from "./articles/asynchronous-collaboration-in-stages.ts";
import { AGILE_DELIVERY_IN_STAGES } from "./articles/agile-delivery-in-stages.ts";
import { STRUCTURING_A_TEAM_THAT_SHARES_FAIRLY } from "./articles/structuring-a-team-that-shares-fairly.ts";
import { PRICE_THE_OUTCOME_NOT_THE_HOUR } from "./articles/price-the-outcome-not-the-hour.ts";
import { NO_HOLD_NO_WORK } from "./articles/no-hold-no-work.ts";
import { ENDING_A_STAGE_EARLY_FAIRLY } from "./articles/ending-a-stage-early-fairly.ts";

/**
 * Projective's articles and their authors — the content source (P6, Decisions #271 / #274),
 * authored as domain records and emitted into `00005073_seed_editorial_articles.sql` by
 * `deno task db:editorial:generate`. With `EDITORIAL_BACKEND_LIVE` off the same records are served
 * through the same row parse and mapping (`readEditorialTable`), so the two cannot drift.
 *
 * This migration runs in EVERY environment, where the development personas do not exist: an author
 * is an editorial row of its own (name, role, avatar), never a foreign key onto a seeded
 * `org.users_public` row, and an image is a static asset, not a seeded storage object.
 *
 * An article's slug is permanent once seeded (`editorial.fn_guard_slug_immutable`): to rename one,
 * author a NEW record under the new slug and retract the old one by setting its `status` to
 * `archived` — never edit the slug, never delete the record (the generated seed upserts and never
 * prunes).
 */

// #region Visibility
/**
 * Whether a reader may see an article at `now`: published, and its publication time has passed.
 * `articles_select_published` (00002021) states the same rule in SQL, so a direct PostgREST read and
 * both reader roads agree.
 */
export function isEditorialArticleVisible(record: EditorialArticleRecord, now: Date): boolean {
	return record.status === "published" && Date.parse(record.publishedAt) <= now.getTime();
}

/** An authored or returned timestamp in one spelling (`toISOString()`), so both roads compare alike. */
function instant(value: string): string {
	return new Date(value).toISOString();
}
// #endregion

// #region Tables
/** `editorial.article_authors` — bylines, never hidden. */
export const ARTICLE_AUTHORS_TABLE = defineEditorialTable<
	EditorialArticleAuthorRow,
	EditorialArticleAuthor
>({
	table: "editorial.article_authors",
	key: ["slug"],
	row: EditorialArticleAuthorRowSchema,
	toRow: (author) => ({
		slug: author.slug,
		name: author.name,
		role: author.role,
		kind: author.kind,
		bio: author.bio,
		avatar_path: author.avatar.src,
		avatar_alt: author.avatar.alt,
		avatar_w: author.avatar.w,
		avatar_h: author.avatar.h,
		profile_href: author.href,
	}),
	fromRow: (row) => ({
		slug: row.slug,
		name: row.name,
		role: row.role,
		kind: row.kind,
		bio: row.bio,
		avatar: { src: row.avatar_path, alt: row.avatar_alt, w: row.avatar_w, h: row.avatar_h },
		href: row.profile_href,
	}),
});

/** `editorial.articles` — shown while published and past its publication time. */
export const ARTICLES_TABLE = defineEditorialTable<EditorialArticleRow, EditorialArticleRecord>({
	table: "editorial.articles",
	key: ["slug"],
	row: EditorialArticleRowSchema,
	casts: { topics: "text[]", published_at: "timestamptz", updated_at: "timestamptz" },
	toRow: (article) => ({
		slug: article.slug,
		title: article.title,
		standfirst: article.standfirst,
		topics: article.topics,
		body: article.sections,
		cover_path: article.cover.src,
		cover_alt: article.cover.alt,
		cover_w: article.cover.w,
		cover_h: article.cover.h,
		author_slug: article.authorSlug,
		status: article.status,
		published_at: article.publishedAt,
		updated_at: article.updatedAt,
	}),
	fromRow: (row) => ({
		slug: row.slug,
		title: row.title,
		standfirst: row.standfirst,
		topics: row.topics,
		sections: row.body,
		cover: { src: row.cover_path, alt: row.cover_alt, w: row.cover_w, h: row.cover_h },
		authorSlug: row.author_slug,
		status: row.status,
		publishedAt: instant(row.published_at),
		updatedAt: instant(row.updated_at),
	}),
	visible: isEditorialArticleVisible,
});
// #endregion

// #region Content
/** Every author, before the articles that name them. */
export const ARTICLE_AUTHORS = editorialContent(ARTICLE_AUTHORS_TABLE, ARTICLE_AUTHOR_RECORDS);

/** Every article, oldest first (the order is the seed file's; the reader sorts its own). */
export const ARTICLES = editorialContent(ARTICLES_TABLE, [
	ASYNCHRONOUS_COLLABORATION_IN_STAGES,
	AGILE_DELIVERY_IN_STAGES,
	STRUCTURING_A_TEAM_THAT_SHARES_FAIRLY,
	PRICE_THE_OUTCOME_NOT_THE_HOUR,
	NO_HOLD_NO_WORK,
	ENDING_A_STAGE_EARLY_FAIRLY,
]);

/** The articles surface's content source, authors first (the articles reference them). */
export const ARTICLES_CONTENT = defineEditorialSurface("articles", [ARTICLE_AUTHORS, ARTICLES]);
// #endregion
