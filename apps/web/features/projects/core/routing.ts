/**
 * projects routing — deep-link builders for the Project Details sidebar.
 *
 * Profile links resolve to the canonical wildcard handle namespace `/[handle]` (root CLAUDE.md §8
 * Decision #3 — the `@handle` entity identifier IS the route), NOT a `/profile/[handle]` path. Handles
 * are normalised to carry the leading `@` so a bare fixture handle (`"mara"`) and an already-prefixed
 * one (`"@mara"`) both resolve to `/@mara` (mirrors `explore/core/routing.ts` `profileHref`).
 */

/** A profile deep-link for a handle: `/@handle`. */
export function profileHref(handle: string): string {
	const h = handle.startsWith("@") ? handle : `@${handle}`;
	return `/${h}`;
}
