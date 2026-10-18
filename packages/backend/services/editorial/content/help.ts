import { defineEditorialSurface } from "../editorial-source.ts";

/**
 * The help centre's content source (P2, Decision #274) — every help category and article, authored
 * as domain records and emitted into `00005071_seed_editorial_help.sql` by
 * `deno task db:editorial:generate`. Empty until P2 lands its tables.
 *
 * To fill it: declare each table with `defineEditorialTable` (its row schema from
 * `@projective/types/editorial/help`, keyed by slug), author its records, and list
 * `editorialContent(table, records)` here in dependency order — categories before the articles that
 * name them. Split the articles across one module per category under `content/help/` and spread
 * them in here if this file grows long; this module stays the surface's single entry. Every article's
 * JSDoc cites the PRODUCT_SPEC section or decision it explains.
 */
export const HELP_CONTENT = defineEditorialSurface("help", []);
