import type { UserContext } from "@projective/types/auth";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { ProjectDetail } from "../types/projects-types.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * detail-ssr — the SERVER-ONLY bootstrap the `(dashboard)` layout uses to paint the Project Details
 * sidebar's first byte on `/projects/[projectId]`. It resolves the deep {@link ProjectDetail} for the
 * routed slug straight from the fat {@link ProjectBackendService} (no HTTP hop — exactly as the feed
 * SSRs its first paint), so the sidebar hydrates with zero client round-trip. Never imported by an
 * island (it reaches `@server/services`); the sidebar island refines via the thin `ProjectSidebarService`.
 */

/** Everything the Project Details sidebar island needs to hydrate without a client round-trip. */
export interface ProjectDetailBootstrap {
	/** The resolved engagement, or `null` when the slug matched nothing (the sidebar shows a stub). */
	detail: ProjectDetail | null;
	/** The routed slug (echoed so the sidebar can offer a Back link + retry even on a miss). */
	slug: string;
	/**
	 * Why the detail could not be READ — a lapsed session's `401`, an unreachable database's `503` —
	 * or `null`. A `404` is not a load error: the slug matched nothing. Set, the sidebar says the
	 * project can't be loaded, never "Project not found" (PRD-B1).
	 */
	loadError: string | null;
}

/** The sidebar's words for a detail read that failed without a message of its own. */
const DETAIL_UNAVAILABLE = "This project can't be loaded right now — please try again.";

/** Resolve the Project Details sidebar bootstrap for a routed slug + the acting user context. */
export async function resolveProjectDetail(
	slug: string,
	_context: UserContext,
	actor: ReadActor,
): Promise<ProjectDetailBootstrap> {
	const res = await ProjectBackendService.detail(slug, actor);
	return {
		detail: res.ok && res.data ? res.data.detail : null,
		slug,
		loadError: res.ok || res.status === 404 ? null : res.message ?? DETAIL_UNAVAILABLE,
	};
}
