import {
	type HelpCentreArticle,
	type HelpCentreArticleRow,
	HelpCentreArticleRowSchema,
	type HelpCentreCategory,
	type HelpCentreCategoryRow,
	HelpCentreCategoryRowSchema,
	isHelpCentreArticleVisible,
} from "@projective/types/editorial";
import {
	defineEditorialSurface,
	defineEditorialTable,
	editorialContent,
} from "../editorial-source.ts";
import { HELP_CATEGORIES } from "./help/categories.ts";
import { GETTING_STARTED_ARTICLES } from "./help/getting-started.ts";
import { PROJECTS_AND_STAGES_ARTICLES } from "./help/projects-and-stages.ts";
import { ESCROW_AND_PAYMENTS_ARTICLES } from "./help/escrow-and-payments.ts";
import { REVISIONS_AND_APPROVALS_ARTICLES } from "./help/revisions-and-approvals.ts";
import { DISPUTES_AND_FAIR_EXIT_ARTICLES } from "./help/disputes-and-fair-exit.ts";
import { PAYOUTS_AND_VERIFICATION_ARTICLES } from "./help/payouts-and-verification.ts";
import { TEAMS_AND_BUSINESSES_ARTICLES } from "./help/teams-and-businesses.ts";
import { ACCOUNT_AND_SECURITY_ARTICLES } from "./help/account-and-security.ts";

/**
 * The help centre's content source (P2, Decision #274) — every help category and article, authored
 * as domain records and emitted into `00005071_seed_editorial_help.sql` by
 * `deno task db:editorial:generate`. The same records are what `HelpBackendService` serves with
 * `EDITORIAL_BACKEND_LIVE` off, through the same row parse and mapping.
 *
 * The articles live one module per category under `./help/`; each article's JSDoc cites the
 * PRODUCT_SPEC section or decision it explains. To add an article, author it in its category's module
 * with `helpArticle` and give it the next free `position`; to retract one, set `archivedOn` (never
 * delete the record — the seed upserts and never prunes); to move one, change its `category` (its slug
 * stays, and the route redirects the old address).
 */

// #region Tables
/** `editorial.help_categories` — the hub's topics. Never hidden. */
export const HELP_CATEGORY_TABLE = defineEditorialTable<HelpCentreCategoryRow, HelpCentreCategory>({
	table: "editorial.help_categories",
	key: ["slug"],
	row: HelpCentreCategoryRowSchema,
	toRow: (category) => ({
		slug: category.slug,
		position: category.position,
		title: category.title,
		description: category.description,
		icon: category.icon,
	}),
	fromRow: (row) => ({
		slug: row.slug,
		position: row.position,
		title: row.title,
		description: row.description,
		icon: row.icon,
	}),
});

/**
 * `editorial.help_articles` — every article, shown from `publishedOn` until `archivedOn` (UTC dates;
 * `help_articles_select_published` states the same rule).
 */
export const HELP_ARTICLE_TABLE = defineEditorialTable<HelpCentreArticleRow, HelpCentreArticle>({
	table: "editorial.help_articles",
	key: ["slug"],
	row: HelpCentreArticleRowSchema,
	casts: {
		roles: "text[]",
		start_here: "text[]",
		related: "text[]",
		updated_on: "date",
		published_on: "date",
		archived_on: "date",
	},
	toRow: (article) => ({
		slug: article.slug,
		category_slug: article.category,
		position: article.position,
		title: article.title,
		summary: article.summary,
		roles: article.roles,
		start_here: article.startHere,
		related: article.related,
		faq_rank: article.faq?.rank ?? null,
		faq_question: article.faq?.question ?? null,
		sections: article.sections,
		updated_on: article.updatedAt,
		published_on: article.publishedOn,
		archived_on: article.archivedOn,
	}),
	fromRow: (row) => ({
		id: row.slug,
		slug: row.slug,
		title: row.title,
		summary: row.summary,
		updatedAt: row.updated_on,
		version: row.updated_on,
		sections: row.sections,
		category: row.category_slug,
		position: row.position,
		roles: row.roles,
		startHere: row.start_here,
		related: row.related,
		faq: row.faq_rank === null || row.faq_question === null
			? null
			: { rank: row.faq_rank, question: row.faq_question },
		publishedOn: row.published_on,
		archivedOn: row.archived_on,
	}),
	visible: (article, now) => isHelpCentreArticleVisible(article, now.toISOString().slice(0, 10)),
});
// #endregion

// #region Records
/** Every authored article, category by category. */
export const HELP_ARTICLES: readonly HelpCentreArticle[] = [
	...GETTING_STARTED_ARTICLES,
	...PROJECTS_AND_STAGES_ARTICLES,
	...ESCROW_AND_PAYMENTS_ARTICLES,
	...REVISIONS_AND_APPROVALS_ARTICLES,
	...DISPUTES_AND_FAIR_EXIT_ARTICLES,
	...PAYOUTS_AND_VERIFICATION_ARTICLES,
	...TEAMS_AND_BUSINESSES_ARTICLES,
	...ACCOUNT_AND_SECURITY_ARTICLES,
];

export { HELP_CATEGORIES };

/** The categories paired with their table — what `readEditorialTable` reads. */
export const HELP_CATEGORY_CONTENT = editorialContent(HELP_CATEGORY_TABLE, HELP_CATEGORIES);

/** The articles paired with their table. */
export const HELP_ARTICLE_CONTENT = editorialContent(HELP_ARTICLE_TABLE, HELP_ARTICLES);
// #endregion

/** The help surface: categories before the articles that reference them. */
export const HELP_CONTENT = defineEditorialSurface("help", [
	HELP_CATEGORY_CONTENT,
	HELP_ARTICLE_CONTENT,
]);
