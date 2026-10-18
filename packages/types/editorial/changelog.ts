import { z } from "zod";
import {
	ContentImageSchema,
	type ContentNode,
	ContentNodeSchema,
	IsoDateSchema,
	SemverSchema,
} from "../content/mod.ts";

/**
 * editorial.changelog — the Zod SSOT for the changelog's releases (P5, Decisions #274 / #278).
 *
 * A release is one row of `editorial.changelog_releases` (`00000024`, region `[changelog]`), keyed by
 * its semantic version — a fixed identifier that is also its public address (`/changelog/0.12.0`).
 * Releases are authored as domain records in `services/editorial/content/changelog.ts`,
 * reconstructed from the real build history (never an invented feature), and emitted into
 * `00005072_seed_editorial_changelog.sql` by `deno task db:editorial:generate`.
 *
 * Two shapes, one mapping (`defineEditorialTable`):
 *
 *  - {@link ChangelogReleaseRowSchema} — the row as PostgREST returns it and as the generator writes
 *    it (snake_case, `released_on` a `YYYY-MM-DD` string).
 *  - {@link ChangelogRelease} — the record a content source authors and a service hands out.
 *
 * Every export is prefixed `Changelog…`: the root barrel re-exports this module.
 */

// #region Categories
/**
 * The closed set of release categories, in filter order. A category is what a release is ABOUT, so
 * on a release it renders as inline meta text; the feed's filter chips are the only control.
 * Adding one changes `changelog_releases_categories_known` in `00000024` in the same change.
 */
export const CHANGELOG_CATEGORIES = [
	"escrow",
	"projects",
	"discovery",
	"messaging",
	"workspaces",
	"ux",
	"security",
	"infrastructure",
] as const;

/** One release category (see {@link CHANGELOG_CATEGORIES}). */
export const ChangelogCategorySchema = z.enum(CHANGELOG_CATEGORIES);
/** One release category. */
export type ChangelogCategory = z.infer<typeof ChangelogCategorySchema>;

/** The display words for each {@link ChangelogCategory}, in the product's own vocabulary. */
export const CHANGELOG_CATEGORY_LABEL: Readonly<Record<ChangelogCategory, string>> = {
	escrow: "Escrow & payments",
	projects: "Projects & work",
	discovery: "Explore & profiles",
	messaging: "Messaging",
	workspaces: "Teams & businesses",
	ux: "Design & accessibility",
	security: "Security & safety",
	infrastructure: "Infrastructure",
};
// #endregion

// #region Version
/**
 * A release version: a semantic version (`0.12.0`, `1.0.0-beta.1`) in lower case and at most 64
 * characters. Lower case keeps one spelling per release, so `/changelog/1.0.0-RC.1` cannot name a
 * second page for `1.0.0-rc.1`.
 */
export const ChangelogVersionSchema = SemverSchema.max(64).refine(
	(version) => version === version.toLowerCase(),
	{ message: "A release version is written in lower case" },
);
// #endregion

// #region Images & body
/**
 * One picture in a release's gallery: a content image (`src`, `alt`, intrinsic `w` × `h`) and its
 * caption, shown under the thumbnail and in the lightbox. Every picture carries one, so a gallery's
 * tiles read evenly and the lightbox always has a description to announce.
 */
export const ChangelogImageSchema = ContentImageSchema.extend({
	caption: z.string().min(1).max(240),
});
/** One picture in a release's gallery. */
export type ChangelogImage = z.infer<typeof ChangelogImageSchema>;

/**
 * A release body: ContentNode blocks (`@projective/types/content`), with two rules a feed needs.
 *
 *  - No `image` node: a release's pictures are its gallery ({@link ChangelogImageSchema}), the one
 *    model the lightbox pages through.
 *  - No explicit `h3` id: a feed renders many bodies on one page and anchors them against one
 *    registry, which suffixes GENERATED ids but keeps explicit ones as written — two releases with
 *    the same explicit id would put one id on the page twice.
 */
export const ChangelogBodySchema = z.array(ContentNodeSchema).min(1).superRefine((nodes, ctx) => {
	nodes.forEach((node: ContentNode, i) => {
		if (node.type === "image") {
			ctx.addIssue({
				code: "custom",
				path: [i],
				message: "A release's pictures go in its images gallery, not its body",
			});
		}
		if (node.type === "h3" && node.id !== undefined) {
			ctx.addIssue({
				code: "custom",
				path: [i, "id"],
				message: "A release's sub-headings take generated ids (a feed renders many bodies)",
			});
		}
	});
});

/** No category listed twice. */
function distinct(categories: readonly string[]): boolean {
	return new Set(categories).size === categories.length;
}

const ChangelogCategoriesSchema = z.array(ChangelogCategorySchema).min(1).refine(distinct, {
	message: "A category is listed once",
});

/** A non-blank single line of copy, `min` to `max` characters. */
function line(max: number) {
	return z.string().min(1).max(max).regex(/\S/, { message: "Cannot be blank" });
}
// #endregion

// #region Row & record
/**
 * One row of `editorial.changelog_releases`, as PostgREST returns it and the generator writes it.
 * Every column is authored (the table has no database-filled column the reader needs).
 */
export const ChangelogReleaseRowSchema = z.object({
	/** The natural key and public address (`/changelog/<version>`). */
	version: ChangelogVersionSchema,
	/** The day the release shipped; a release dated after today is hidden until that day (UTC). */
	released_on: IsoDateSchema,
	title: line(120),
	/** One or two sentences: the feed's lead line, the RSS description and the meta description. */
	summary: line(320),
	categories: ChangelogCategoriesSchema,
	body: ChangelogBodySchema,
	images: z.array(ChangelogImageSchema).max(12),
	/** A retracted release: hidden from every reader, never deleted (the generator never prunes). */
	withdrawn: z.boolean(),
});
/** One `editorial.changelog_releases` row. */
export type ChangelogReleaseRow = z.infer<typeof ChangelogReleaseRowSchema>;

/** A release as a content source authors it and a service hands it out. */
export interface ChangelogRelease {
	/** The semantic version — the release's identity and address. */
	version: string;
	/** `YYYY-MM-DD`, the day it shipped. */
	releasedOn: string;
	title: string;
	summary: string;
	/** What it is about, in {@link CHANGELOG_CATEGORIES} order where authored so. */
	categories: ChangelogCategory[];
	body: ContentNode[];
	images: ChangelogImage[];
	/** Retracted: hidden from every reader (see {@link ChangelogReleaseRowSchema}). */
	withdrawn: boolean;
}
// #endregion
