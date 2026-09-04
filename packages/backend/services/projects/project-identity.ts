/**
 * project-identity — the ONE answer to "is this route segment a uuid or a slug?".
 *
 * Every `/projects` route addresses an engagement through an OPAQUE segment: the create modal
 * navigates to a `projects.projects.id`, while every link written before it — and every fixture in
 * this package — carries the readable `slug`. So a resolver cannot assume which it holds and must
 * branch on the shape of the string it was handed.
 *
 * ## Why the branch cannot be skipped, in either direction
 *
 * `.eq("id", "aurora-rebrand")` on a `uuid` column is not a miss. PostgREST casts the operand, so it
 * raises `22P02 invalid input syntax for type uuid` — a THROWN page read where the caller expected an
 * ordinary 404, which takes down a surface the fixtures could have rendered.
 *
 * The opposite direction is quieter and therefore worse. `projects.projects.slug` is CHECKed as
 * `^[a-z0-9-]{1,96}$` (`00000015_tables_projects.sql`), and a lowercase uuid SATISFIES that regex —
 * so `.eq("slug", "<uuid>")` is a perfectly valid query that matches nothing, forever. There is no
 * error to log and no fault to find: the project simply does not exist, on a URL the client just
 * navigated to from a successful create.
 *
 * ## Why one module
 *
 * The regex was copied into six sibling modules, each with its own name for the same constant and
 * its own half of the reasoning above. Six copies are six chances for one to be written `{12}` where
 * it meant `{4}`, in a mistake whose symptom is a clean 404 rather than a stack trace. It lives here
 * so the shape and the reason are stated once.
 */

// #region Shape
/**
 * The canonical uuid shape, matched case-insensitively.
 *
 * Deliberately NOT version-pinned to `4` in the third group. It has to accept whatever
 * `gen_random_uuid()` produced yesterday and whatever a future default produces tomorrow; the
 * question this regex answers is "will Postgres accept this as a uuid", not "which RFC variant is
 * it". A version-pinned pattern would reject a legitimate identifier as a slug and route it to a
 * column it can never match.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a route segment names a row by its primary key rather than by its readable address.
 *
 * The one predicate every live resolver branches on before choosing between `.eq("id", …)` and
 * `.eq("slug", …)`.
 */
export function isProjectKeyUuid(key: string): boolean {
	return UUID_RE.test(key);
}
// #endregion

// #region Fixture matching
/**
 * Whether a fixture row is the one an opaque route segment names.
 *
 * The fixture counterpart of the live shape branch, and it deliberately does NOT branch: an in-memory
 * comparison has no cast to raise and no CHECK to satisfy, so testing both fields is both cheaper and
 * safer than deciding which one to test. The uuid is checked first only because a create-minted URL
 * is the address the client most often arrives on.
 *
 * The corpus already carries a real uuid beside every slug, so this makes the whole fixture-backed
 * route set uuid-addressable without touching a single row of fixture DATA.
 */
export function matchesProjectKey(row: { id: string; slug: string }, key: string): boolean {
	return row.id === key || row.slug === key;
}
// #endregion
