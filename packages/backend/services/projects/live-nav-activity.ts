import {
	type MarkViewSeenInput,
	type MarkViewSeenResult,
	type ProjectNavActivity,
	ProjectNavActivitySchema,
} from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { projectsDb } from "./live-support.ts";
import { refusalFrom, type WriteOutcome } from "./live-writes.ts";

/**
 * live-nav-activity — the two RPC doors behind the lane's activity marks.
 *
 * `projects.get_nav_activity` and `projects.mark_view_seen` are SECURITY INVOKER, so every figure is
 * taken under the caller's own RLS: the role split (a reviewer counts pending work, a submitter counts
 * verdicts; only the staffing side sees requests and invitations) is the database's, not this file's.
 * The read is parsed through {@link ProjectNavActivitySchema} so a drifted function body surfaces as a
 * thrown error the service logs, never as a malformed mark in the lane.
 */

// #region Read
/**
 * One viewer's activity across one engagement's lane views, or `null` when the slug resolves to
 * nothing the viewer can read. THROWS on an RPC failure or a payload outside the schema.
 */
export async function fetchNavActivity(
	actor: ReadActor & { accessToken: string },
	slug: string,
): Promise<ProjectNavActivity | null> {
	const { data, error } = await projectsDb(actor).rpc("get_nav_activity", { p_slug: slug });
	if (error) throw new Error(`projects.get_nav_activity failed: ${error.message}`);
	if (data === null || data === undefined) return null;
	const parsed = ProjectNavActivitySchema.safeParse(data);
	if (!parsed.success) {
		throw new Error(
			`projects.get_nav_activity returned an unexpected shape: ${parsed.error.message}`,
		);
	}
	return parsed.data;
}
// #endregion

// #region Write
/** Record that the viewer opened one lane view; `null` when the slug resolves to nothing readable. */
export async function markViewSeenRow(
	actor: ReadActor & { accessToken: string },
	input: MarkViewSeenInput,
): Promise<WriteOutcome<MarkViewSeenResult>> {
	const { data, error } = await projectsDb(actor).rpc("mark_view_seen", {
		p_slug: input.projectId,
		p_view: input.view,
	});
	if (error) return { refusal: refusalFrom(error.message, "view") };
	if (typeof data !== "string") return null;
	return { data: { view: input.view, seenAt: data } };
}
// #endregion
