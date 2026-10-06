import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { ProjectWorkspace, WorkspaceViewer } from "@projective/types/projects";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * overview-ssr — the SERVER-ONLY bootstrap for the engagement's Overview, `/projects/[slug]`
 * (Decision #144).
 *
 * Calls the fat {@link ProjectBackendService.workspace} directly (no HTTP hop), mirroring
 * {@link resolveProjectDetail} and {@link resolveBoardPage}. Server-resolved because every figure on
 * the page is server-computed and scoped to the person asking — a stage's price for the owner, a ticket
 * count only on the stages a participant is seated on, and every money figure as a `MoneyView` — so a
 * client render that arrived later, or an island that added its own numbers up, could disagree with the
 * ledger. Never imported by an island.
 */

/** Everything the Overview needs to render without a client round-trip. */
export interface ProjectWorkspaceBootstrap {
	/** The composed Overview read, or `null` when the slug matched nothing the viewer can see. */
	workspace: ProjectWorkspace | null;
	/** The routed slug, echoed so a miss can still offer a Back link and a retry. */
	slug: string;
}

/** Resolve the Overview for a routed slug, drawn for `viewer`. */
export async function resolveProjectWorkspace(
	slug: string,
	actor: ReadActor,
	viewer: WorkspaceViewer,
): Promise<ProjectWorkspaceBootstrap> {
	const res = await ProjectBackendService.workspace(slug, actor, viewer);
	return { workspace: res.ok && res.data ? res.data.workspace : null, slug };
}
