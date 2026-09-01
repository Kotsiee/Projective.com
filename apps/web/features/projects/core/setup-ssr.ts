import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { ProjectSetup } from "../types/projects-types.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * setup-ssr — the SERVER-ONLY bootstrap for the owner's Details surface on `/projects/[projectId]`.
 *
 * Calls the fat {@link ProjectBackendService.setup} directly (no HTTP hop), exactly as
 * {@link resolveProjectDetail} and {@link resolveBoardPage} do, so the setup form and the header
 * band's progress bar both ship complete in the first byte.
 *
 * The bar in particular must not wait on a client fetch: `completeness` and `previewReady` are what
 * gate the Preview control, and painting a 0% bar beside an unlocked-then-relocked toggle tells the
 * owner two different things about the same project within one render. Never imported by an island
 * (it reaches `@server/services`); the island refines through the thin `ProjectSidebarService.setup`.
 */

/** Everything the Details surface needs to hydrate without a client round-trip. */
export interface ProjectSetupBootstrap {
	/** The resolved configuration, or `null` when the slug matched nothing or is not the viewer's. */
	setup: ProjectSetup | null;
	/** The routed slug, echoed so a miss can still offer a Back link and a retry. */
	slug: string;
}

/** Resolve the owner's editable configuration + its derived setup ladder for a routed slug. */
export async function resolveProjectSetup(
	slug: string,
	actor: ReadActor,
): Promise<ProjectSetupBootstrap> {
	const res = await ProjectBackendService.setup(slug, actor);
	return { setup: res.ok && res.data ? res.data.setup : null, slug };
}
