import type { UserContext } from "@projective/types/auth";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { ProjectDetail } from "../types/projects-types.ts";

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
}

/** Resolve the Project Details sidebar bootstrap for a routed slug + the acting user context. */
export function resolveProjectDetail(slug: string, _context: UserContext): ProjectDetailBootstrap {
	const res = ProjectBackendService.detail(slug);
	return { detail: res.ok && res.data ? res.data.detail : null, slug };
}
