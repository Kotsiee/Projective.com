import { z } from "zod";
import {
	checkDocAnchors,
	ContentAudience,
	type Doc,
	DocSectionSchema,
	IsoDateSchema,
} from "../content/mod.ts";
import { slug } from "./common.ts";

/**
 * editorial.help — the Zod SSOT for the help centre's content (P2, Decision #274): the rows of
 * `editorial.help_categories` and `editorial.help_articles` (`00000024`, region `[help]`), the
 * domain records the content source authors and the help service hands out, and the request and
 * response of `GET /api/help/search`.
 *
 * A row is the JSON PostgREST returns AND what a content record becomes before it is seeded
 * (`services/editorial/content/help.ts` → `deno task db:editorial:generate` → `00005071`), so every
 * CHECK on the tables is mirrored here and a record the generator accepts is one the database
 * accepts. Article bodies are P0's ContentNode sections (`@projective/types/content`).
 *
 * Slugs are READABLE and permanent (Decision #274 (k)): authored on their own, never derived from a
 * title, and frozen once the row exists by `editorial.fn_guard_slug_immutable`. A renamed article is
 * a new row plus a redirect, never a new slug on the old row.
 *
 * Every export is prefixed `HelpCentre…`: this module is re-exported by the root barrel, where
 * `HelpArticle` / `HelpArticleSchema` already name the Explore home's editorial promo link
 * (`explore/items.ts`).
 */

// #region Categories
/**
 * The registry glyph each category row draws (`@projective/ui/icons`). Closed so a category can never
 * name a glyph that does not exist; `features/help/core/help-core.test.ts` checks every value against the
 * registry, and the table's CHECK holds the same set.
 */
export const HELP_CENTRE_CATEGORY_ICONS = [
	"flag",
	"stages",
	"wallet",
	"submission",
	"shield",
	"arrow-up-right",
	"members",
	"lock",
] as const;

/** One category's glyph (see {@link HELP_CENTRE_CATEGORY_ICONS}). */
export const HelpCentreCategoryIcon = z.enum(HELP_CENTRE_CATEGORY_ICONS);
/** One category's glyph. */
export type HelpCentreCategoryIcon = z.infer<typeof HelpCentreCategoryIcon>;

/** The longest category title (`help_categories_title_length`). */
export const HELP_CENTRE_CATEGORY_TITLE_MAX = 60;
/** The longest category description — one line on the hub (`help_categories_description_length`). */
export const HELP_CENTRE_CATEGORY_DESCRIPTION_MAX = 200;

/** A row of `editorial.help_categories`. */
export const HelpCentreCategoryRowSchema = z.object({
	slug,
	position: z.number().int().min(0).max(32_767),
	title: z.string().min(1).max(HELP_CENTRE_CATEGORY_TITLE_MAX),
	description: z.string().min(1).max(HELP_CENTRE_CATEGORY_DESCRIPTION_MAX),
	icon: HelpCentreCategoryIcon,
});
/** A row of `editorial.help_categories`. */
export type HelpCentreCategoryRow = z.infer<typeof HelpCentreCategoryRowSchema>;

/**
 * A help category as the service hands it out: the hub's topic row and the category page's heading.
 * `position` orders the hub (ascending, unique).
 */
export interface HelpCentreCategory {
	slug: string;
	position: number;
	title: string;
	description: string;
	icon: HelpCentreCategoryIcon;
}
// #endregion

// #region Articles
/** The longest article title (`help_articles_title_length`). */
export const HELP_CENTRE_TITLE_MAX = 120;
/** The longest summary — the lead, the meta description and the FAQ answer (`help_articles_summary_length`). */
export const HELP_CENTRE_SUMMARY_MAX = 320;
/** The most related articles one article may name (`help_articles_related_size`). */
export const HELP_CENTRE_RELATED_MAX = 4;
/** How many questions the hub's FAQ holds; `faq_rank` runs 1…this (`help_articles_faq_rank_range`). */
export const HELP_CENTRE_FAQ_SIZE = 8;

/**
 * An article's place in the hub's FAQ: its rank (1 = asked most) and the question as a reader asks
 * it. The answer is the article's summary, followed by a link to the whole article. An article with
 * no FAQ entry is not in the hub's FAQ — that is the article's FAQ flag.
 */
export const HelpCentreFaqSchema = z.object({
	rank: z.number().int().min(1).max(HELP_CENTRE_FAQ_SIZE),
	question: z.string().min(1).max(160),
});
/** An article's FAQ entry. */
export type HelpCentreFaq = z.infer<typeof HelpCentreFaqSchema>;

/** The `roles` set: the product's own words, at least one, none twice (`help_articles_roles_check`). */
const roles = z.array(ContentAudience).min(1).refine((list) => new Set(list).size === list.length, {
	message: "A role is listed once.",
});

/** A row of `editorial.help_articles`. */
export const HelpCentreArticleRowSchema = z.object({
	slug,
	category_slug: slug,
	position: z.number().int().min(0).max(32_767),
	title: z.string().min(1).max(HELP_CENTRE_TITLE_MAX),
	summary: z.string().min(1).max(HELP_CENTRE_SUMMARY_MAX),
	roles,
	start_here: z.array(ContentAudience),
	related: z.array(slug).max(HELP_CENTRE_RELATED_MAX),
	faq_rank: z.number().int().min(1).max(HELP_CENTRE_FAQ_SIZE).nullable(),
	faq_question: z.string().min(1).max(160).nullable(),
	sections: z.array(DocSectionSchema).min(1),
	updated_on: IsoDateSchema,
	published_on: IsoDateSchema,
	archived_on: IsoDateSchema.nullable(),
}).superRefine((row, ctx) => {
	checkDocAnchors(row, ctx);
	if ((row.faq_rank === null) !== (row.faq_question === null)) {
		ctx.addIssue({
			code: "custom",
			path: ["faq_question"],
			message: "An FAQ entry needs both a rank and a question.",
		});
	}
	if (row.start_here.some((role) => !row.roles.includes(role))) {
		ctx.addIssue({
			code: "custom",
			path: ["start_here"],
			message: "An article starts a role's reading only for a role it is written for.",
		});
	}
	if (new Set(row.start_here).size !== row.start_here.length) {
		ctx.addIssue({ code: "custom", path: ["start_here"], message: "A role is listed once." });
	}
	if (row.related.includes(row.slug)) {
		ctx.addIssue({
			code: "custom",
			path: ["related"],
			message: "An article cannot relate to itself.",
		});
	}
	if (new Set(row.related).size !== row.related.length) {
		ctx.addIssue({
			code: "custom",
			path: ["related"],
			message: "A related article is listed once.",
		});
	}
	if (row.published_on > row.updated_on) {
		ctx.addIssue({
			code: "custom",
			path: ["updated_on"],
			message: "An article cannot be updated before it is published.",
		});
	}
	if (row.archived_on !== null && row.archived_on < row.published_on) {
		ctx.addIssue({
			code: "custom",
			path: ["archived_on"],
			message: "An article cannot be archived before it is published.",
		});
	}
});
/** A row of `editorial.help_articles`. */
export type HelpCentreArticleRow = z.infer<typeof HelpCentreArticleRowSchema>;

/**
 * A help article as the content source authors it and the service hands it out: a P0 {@link Doc}
 * (so `DocumentPage` renders it unchanged) plus where it lives and who it is for.
 *
 * - `id` is the slug and `version` the date it last changed — both derived, never stored.
 * - `category` is its category's slug; `position` orders it inside the category.
 * - `roles` — who it is written for (Client · Freelancer · Team · Business).
 * - `startHere` — the roles (a subset of `roles`) whose "Start here by role" column on the hub lists
 *   it; a column reads in category, then article, order.
 * - `related` — up to {@link HELP_CENTRE_RELATED_MAX} other articles' slugs, in reading order.
 * - `faq` — its entry in the hub's FAQ, or `null`.
 * - `publishedOn` / `archivedOn` — visibility: shown from `publishedOn` (UTC) until `archivedOn`.
 */
export interface HelpCentreArticle extends Doc {
	category: string;
	position: number;
	roles: ContentAudience[];
	startHere: ContentAudience[];
	related: string[];
	faq: HelpCentreFaq | null;
	publishedOn: string;
	archivedOn: string | null;
}

/**
 * Whether an article is shown at `today` (`YYYY-MM-DD`, UTC): published on or before it, and not yet
 * archived. The table's SELECT policy states the same rule in SQL, never narrower
 * (`help_articles_select_published`).
 */
export function isHelpCentreArticleVisible(
	article: Pick<HelpCentreArticle, "publishedOn" | "archivedOn">,
	today: string,
): boolean {
	return article.publishedOn <= today &&
		(article.archivedOn === null || article.archivedOn > today);
}
// #endregion

// #region Search
/** The longest query the search accepts; longer input is cut, never refused. */
export const HELP_CENTRE_QUERY_MAX = 120;
/** How many results one search answers. */
export const HELP_CENTRE_RESULT_LIMIT = 20;

/** `GET /api/help/search?q=` — the query, trimmed and cut to {@link HELP_CENTRE_QUERY_MAX}. */
export const HelpCentreSearchQuerySchema = z.object({
	q: z.string().default("").transform((q) => q.trim().slice(0, HELP_CENTRE_QUERY_MAX)),
});
/** A parsed search request. */
export type HelpCentreSearchQuery = z.infer<typeof HelpCentreSearchQuerySchema>;

/** A highlighted run inside a string: `[start, end)` in UTF-16 code units. */
export const HelpCentreHighlightSchema = z.tuple([
	z.number().int().min(0),
	z.number().int().min(0),
]);
/** A highlighted run, `[start, end)`. */
export type HelpCentreHighlight = z.infer<typeof HelpCentreHighlightSchema>;

/** One search hit, grouped by its category in the overlay. */
export const HelpCentreSearchResultSchema = z.object({
	slug,
	title: z.string(),
	/** The category's slug. */
	category: slug,
	/** The category's title, for the group label. */
	categoryTitle: z.string(),
	/** The article's canonical path (`/help/<category>/<slug>`). */
	href: z.string().startsWith("/help/"),
	/** A sentence-sized excerpt around the first match (the summary when the match is elsewhere). */
	snippet: z.string(),
	/** The matched terms' runs, for `<mark>`. */
	highlights: z.object({
		title: z.array(HelpCentreHighlightSchema),
		snippet: z.array(HelpCentreHighlightSchema),
	}),
});
/** One search hit. */
export type HelpCentreSearchResult = z.infer<typeof HelpCentreSearchResultSchema>;

/** `GET /api/help/search` — what was searched for and the ranked hits. */
export const HelpCentreSearchResponseSchema = z.object({
	query: z.string(),
	results: z.array(HelpCentreSearchResultSchema),
});
/** The search response body's data. */
export type HelpCentreSearchResponse = z.infer<typeof HelpCentreSearchResponseSchema>;
// #endregion
