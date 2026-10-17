import { defineEditorialSurface } from "../editorial-source.ts";

/**
 * The changelog's content source (P5, Decision #274) — every release, authored as domain records
 * and emitted into `00005072_seed_editorial_changelog.sql` by `deno task db:editorial:generate`.
 * Empty until P5 lands its table.
 *
 * To fill it: declare the release table with `defineEditorialTable` (its row schema from
 * `@projective/types/editorial/changelog`, keyed by version), author its records — real releases
 * reconstructed from git history and the decision log, never invented features — and list
 * `editorialContent(table, records)` here.
 */
export const CHANGELOG_CONTENT = defineEditorialSurface("changelog", []);
