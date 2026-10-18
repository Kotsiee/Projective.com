import type { EditorialSeedTarget } from "../content-sql.ts";
import type { EditorialSurface, EditorialSurfaceSource } from "../editorial-source.ts";
import { HELP_CONTENT } from "./help.ts";
import { CHANGELOG_CONTENT } from "./changelog.ts";
import { ARTICLES_CONTENT } from "./articles.ts";

/**
 * The editorial content registry (Decision #274): every surface's content source and the seed
 * migration it is generated into. `scripts/editorial-generate.ts` and the drift test iterate
 * {@link EDITORIAL_SEEDS}; a surface service reads its own source directly (`./help.ts`, …).
 *
 * A surface's work order edits only its own source module — never this file — so the three
 * surfaces' content lands on parallel branches without touching a shared line.
 */

/** Every surface's content source, by surface. */
export const EDITORIAL_SOURCES: Readonly<Record<EditorialSurface, EditorialSurfaceSource>> = Object
	.freeze({
		help: HELP_CONTENT,
		changelog: CHANGELOG_CONTENT,
		articles: ARTICLES_CONTENT,
	});

/** Each surface's generated seed migration (category 5), one file per surface. */
export const EDITORIAL_SEEDS: readonly EditorialSeedTarget[] = Object.freeze([
	{
		file: "00005071_seed_editorial_help.sql",
		sourcePath: "packages/backend/services/editorial/content/help.ts",
		source: HELP_CONTENT,
	},
	{
		file: "00005072_seed_editorial_changelog.sql",
		sourcePath: "packages/backend/services/editorial/content/changelog.ts",
		source: CHANGELOG_CONTENT,
	},
	{
		file: "00005073_seed_editorial_articles.sql",
		sourcePath: "packages/backend/services/editorial/content/articles.ts",
		source: ARTICLES_CONTENT,
	},
]);
