import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { TimelinePage } from "../types/projects-types.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * timeline-ssr — the server-only bootstrap for the Timeline / Gantt's first paint. Calls the fat
 * {@link ProjectBackendService.timeline} directly (no HTTP hop) so the page ships its lanes + items
 * in the initial byte; the island then refines via the thin {@link TimelineService}. Mirrors
 * {@link resolveBoardPage}. Never imported by an island. `channelId` set → one stage's timeline.
 */
export interface TimelineBootstrap {
	page: TimelinePage | null;
}

/** Resolve the initial timeline page. `channelId` set → the stage-scoped timeline. */
export async function resolveTimelinePage(
	projectId: string,
	actor: ReadActor,
	channelId?: string | null,
): Promise<TimelineBootstrap> {
	const res = await ProjectBackendService.timeline(
		{ projectId, channelId: channelId ?? null },
		actor,
	);
	return { page: res.ok && res.data ? res.data.page : null };
}
