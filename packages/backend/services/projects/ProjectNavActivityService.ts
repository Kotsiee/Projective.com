import {
	type MarkViewSeenInput,
	type MarkViewSeenResult,
	type ProjectNavActivity,
	QUIET_NAV_ACTIVITY,
} from "@projective/types/projects";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isProjectsBackendLive } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { ProjectBackendService } from "./ProjectBackendService.ts";
import { fetchNavActivity, markViewSeenRow } from "./live-nav-activity.ts";
import { fixtureNavActivity, recordFixtureSeen } from "./nav-activity-fixtures.ts";

/**
 * ProjectNavActivityService — the project lane's activity marks: what changed in each view since the
 * viewer last opened it, and the record of an opening.
 *
 * Live: `projects.get_nav_activity` / `projects.mark_view_seen` under the caller's RLS
 * (`live-nav-activity.ts`). Stub: facts the fixture detail already states, minus the views this
 * process has seen the viewer open (`nav-activity-fixtures.ts`).
 *
 * Never cached: a mark has to clear on the very next navigation after its view is opened, and a cached
 * read would hold it for the cache's lifetime.
 */
export class ProjectNavActivityService {
	/**
	 * One viewer's activity across the engagement's lane views. A guest, an unreadable slug or a
	 * failed live read all answer {@link QUIET_NAV_ACTIVITY}: a missing mark costs a reader nothing,
	 * and an invented one would send them looking for a change that never happened.
	 */
	static async activity(slug: string, actor: ReadActor): Promise<ProjectNavActivity> {
		if (actor.userId.length === 0) return QUIET_NAV_ACTIVITY;
		if (isProjectsBackendLive()) {
			if (!canReadLive(actor)) return QUIET_NAV_ACTIVITY;
			try {
				return (await fetchNavActivity(actor, slug)) ?? QUIET_NAV_ACTIVITY;
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				console.warn(`[ProjectNavActivityService.activity] live read failed: ${reason}`);
				return QUIET_NAV_ACTIVITY;
			}
		}
		const read = await ProjectBackendService.detail(slug, actor);
		if (!read.ok || !read.data) return QUIET_NAV_ACTIVITY;
		return fixtureNavActivity(read.data.detail, actor.userId);
	}

	/** Record that the viewer opened one lane view — `POST /api/projects/nav-seen`. */
	static async markSeen(
		input: MarkViewSeenInput,
		actor: ReadActor,
	): Promise<ServiceResult<MarkViewSeenResult>> {
		if (actor.userId.length === 0) {
			return fail(401, { message: "Sign in to keep track of what you have seen." });
		}
		if (isProjectsBackendLive()) {
			if (!canReadLive(actor)) {
				return fail(401, { message: "Your session has expired — sign in again." });
			}
			try {
				const outcome = await markViewSeenRow(actor, input);
				if (outcome === null) {
					return fail(404, { message: `No project found for "${input.projectId}".` });
				}
				if ("refusal" in outcome) {
					return fail(outcome.refusal.status, {
						message: outcome.refusal.message,
						errors: outcome.refusal.errors,
					});
				}
				return ok(outcome.data);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				console.warn(`[ProjectNavActivityService.markSeen] live write failed: ${reason}`);
				return fail(502, { message: "That could not be recorded — please try again." });
			}
		}
		const read = await ProjectBackendService.detail(input.projectId, actor);
		if (!read.ok || !read.data) {
			return fail(404, { message: `No project found for "${input.projectId}".` });
		}
		return ok(recordFixtureSeen(actor.userId, read.data.detail.slug, input.view));
	}
}
