/**
 * project-identity — the ONE answer to "does this route segment address a project?".
 *
 * Every `/projects` route addresses an engagement by its slug and by nothing else:
 * `/projects/prj-yfn996wztc`. The row's uuid does not route, and neither does any older
 * title-derived form. The format itself lives in `@projective/types/slugs`; this module is the
 * projects domain's guard over it.
 *
 * ## Why this is a guard and not a branch
 *
 * It used to be a branch. A segment could be a uuid OR a slug, so every resolver in this directory
 * had to test the shape and pick a column — and the two ways of getting that wrong are unequal.
 * `.eq("id", "aurora-rebrand")` on a `uuid` column is not a miss: PostgREST casts the operand and
 * raises `22P02`, a thrown page where the caller expected a 404. The opposite direction is quieter
 * and therefore worse: `projects.projects.slug` used to be CHECKed as `^[a-z0-9-]{1,96}$`, which a
 * lowercase uuid SATISFIES, so `.eq("slug", "<uuid>")` was a perfectly valid query matching nothing,
 * forever, with no error to log and no fault to find.
 *
 * Both failures are gone, and neither was fixed by being more careful. The slug's CHECK is now
 * `^prj-[…]{10}$`, so a uuid cannot satisfy it and the two namespaces cannot overlap; and with one
 * address there is no column left to choose between. What remains is a cheap shape test that turns a
 * malformed segment into a 404 before it costs a query — never an existence or access test, which
 * only the database and RLS answer.
 */

import { isSlug } from "@projective/types/slugs";

// #region Shape

/**
 * Whether a route segment is a well-formed project address.
 *
 * A SHAPE test. It says the string could name a project; it does not say one exists, and it decides
 * nothing about access. Resolvers call it to refuse a malformed segment without spending a round
 * trip, and to keep a stage or service slug — which is equally well-formed, in another namespace —
 * from being asked of the projects table.
 */
export function isProjectSlug(key: string): boolean {
	return isSlug(key, "project");
}

// #endregion

// #region Fixture matching

/**
 * Whether a fixture row is the project a route segment names.
 *
 * The fixture counterpart of the live lookup. It compares the slug alone, exactly as the live query
 * does, so the stub and live branches cannot disagree about what a URL resolves to — a fixture that
 * also answered to its uuid would make the gate-off path strictly more permissive than the gate-on
 * one, and every such divergence is found in production rather than in development.
 */
export function matchesProjectKey(row: { slug: string }, key: string): boolean {
	return row.slug === key;
}

// #endregion
