import { getProjects, postProjects } from "./api.ts";
import type { SessionWorkspace } from "@projective/types/projects";
import type { ProjectsResult } from "../types/results.ts";

/**
 * SessionService — the dumb client service for a session engagement's sidebar (Decision #171). It
 * builds the URL or the JSON body and calls the transport helpers, returning a soft
 * {@link ProjectsResult}; every rule (who may tick a lesson, what a cancel costs, whether a claim is
 * allowed, when a join URL exists) is the server's.
 */
export const SessionService = {
	/** The viewer's workspace — re-read when the join window opens. */
	workspace(slug: string): Promise<ProjectsResult<{ workspace: SessionWorkspace | null }>> {
		return getProjects(`/api/sessions/${encodeURIComponent(slug)}`);
	},

	/** Tick or un-tick a curriculum lesson. */
	setLesson(lessonId: string, done: boolean): Promise<ProjectsResult<{ lessonId: string; done: boolean }>> {
		return postProjects(`/api/sessions/lessons/${encodeURIComponent(lessonId)}`, { done });
	},

	/** Give up the viewer's seat under the late-cancel rule; the answer names what happened to the money. */
	cancelSeat(
		membershipId: string,
	): Promise<ProjectsResult<{ outcome: "refunded" | "forfeited"; amountMinor: number; currency: string | null }>> {
		return postProjects(`/api/sessions/memberships/${encodeURIComponent(membershipId)}/cancel`, {});
	},

	/** Claim the provider did not show for a sitting (holds the auto-release while it is reviewed). */
	claimNoShow(eventId: string, reason: string | null): Promise<ProjectsResult<{ disputeId: string }>> {
		return postProjects(`/api/sessions/sittings/${encodeURIComponent(eventId)}/no-show`, { reason });
	},
};
