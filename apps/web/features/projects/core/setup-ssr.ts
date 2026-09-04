import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { ProjectSetup } from "../types/projects-types.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * setup-ssr — the SERVER-ONLY bootstrap for the owner's Stage-2 workspace on `/projects/[projectId]`.
 *
 * Calls the fat {@link ProjectBackendService.setup} directly (no HTTP hop), exactly as
 * {@link resolveProjectDetail} and {@link resolveBoardPage} do, so the setup form, its section rail
 * and the header band's progress bar all ship complete in the first byte.
 *
 * The bar in particular must not wait on a client fetch: `completeness` and `previewReady` are what
 * gate the Preview control, and painting a 0% bar beside an unlocked-then-relocked toggle tells the
 * owner two different things about the same project within one render. Never imported by an island
 * (it reaches `@server/services`); the island refines through the thin `ProjectSidebarService.setup`.
 */

/** Everything the Stage-2 workspace needs to hydrate without a client round-trip. */
export interface ProjectSetupBootstrap {
	/**
	 * The resolved configuration, or `null` when the reference matched nothing or is not the viewer's.
	 *
	 * It carries its own canonical `id`, which is what every client-side write keys on. Nothing
	 * downstream re-uses the routed string as an identity: the two agree today only because the route
	 * happens to carry a uuid, and a readable-slug link is a legitimate way to arrive here.
	 */
	setup: ProjectSetup | null;
	/**
	 * The reference the route was asked for, echoed so a retry can address the same row.
	 *
	 * Deliberately NOT shown to the reader on a miss — a uuid quoted back at somebody is unactionable,
	 * and it dresses an ordinary "no such project" up as a system fault.
	 */
	slug: string;
}

/**
 * Resolve the owner's editable configuration + its derived setup ladder.
 *
 * `slug` keeps its name across the whole service surface while its MEANING has widened to
 * slug-or-uuid: the resolver accepts either and the fat service decides which it is. Renaming the
 * parameter here alone would only make the app and the service disagree about what to call one
 * string, which is worse than a name that has outgrown its origin.
 */
export async function resolveProjectSetup(
	slug: string,
	actor: ReadActor,
): Promise<ProjectSetupBootstrap> {
	const res = await ProjectBackendService.setup(slug, actor);
	return { setup: res.ok && res.data ? res.data.setup : null, slug };
}
