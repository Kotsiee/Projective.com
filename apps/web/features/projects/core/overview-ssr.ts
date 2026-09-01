import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { ProjectOverview } from "../types/projects-types.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * overview-ssr — the SERVER-ONLY bootstrap for the member's dashboard on `/projects/[projectId]`,
 * the half of that route a viewer who is not the client sees.
 *
 * Calls the fat {@link ProjectBackendService.overview} directly (no HTTP hop), mirroring
 * {@link resolveProjectDetail} and {@link resolveBoardPage}. The finance block is the reason this is
 * server-resolved rather than fetched: every figure is a server-computed `MoneyView` scoped to the
 * person asking, so a client render that arrived later — or an island that added its own numbers up —
 * could disagree with the ledger about what somebody is owed. Never imported by an island.
 */

/** Everything the member dashboard needs to hydrate without a client round-trip. */
export interface ProjectOverviewBootstrap {
	/** The resolved dashboard read, or `null` when the slug matched nothing the viewer can see. */
	overview: ProjectOverview | null;
	/** The routed slug, echoed so a miss can still offer a Back link and a retry. */
	slug: string;
}

/** Resolve the member dashboard projection for a routed slug + the acting identity. */
export async function resolveProjectOverview(
	slug: string,
	actor: ReadActor,
): Promise<ProjectOverviewBootstrap> {
	const res = await ProjectBackendService.overview(slug, actor);
	return { overview: res.ok && res.data ? res.data.overview : null, slug };
}
