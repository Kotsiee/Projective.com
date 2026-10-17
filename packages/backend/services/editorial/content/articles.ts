import { defineEditorialSurface } from "../editorial-source.ts";

/**
 * Projective's articles and their authors — the content source (P6, Decision #274), authored as
 * domain records and emitted into `00005073_seed_editorial_articles.sql` by
 * `deno task db:editorial:generate`. Empty until P6 lands its tables.
 *
 * To fill it: declare the author and article tables with `defineEditorialTable` (row schemas from
 * `@projective/types/editorial/articles`, keyed by slug), author their records, and list
 * `editorialContent(table, records)` here — authors before the articles that name them.
 *
 * This migration runs in EVERY environment, where the development personas do not exist: an author
 * is an editorial row of its own (name, role, avatar), never a foreign key onto a seeded
 * `org.users_public` row, and an image is a static asset, not a seeded storage object.
 */
export const ARTICLES_CONTENT = defineEditorialSurface("articles", []);
