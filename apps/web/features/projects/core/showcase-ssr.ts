import type { UserContext } from "@projective/types/auth";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import { buildProjectShowcase, type ProjectShowcase } from "./showcase-model.ts";
import type { ProjectDetail } from "../types/projects-types.ts";

/**
 * showcase-ssr — the SERVER-ONLY bootstrap for the `/projects/[projectId]` Preview body. It resolves
 * the deep {@link ProjectDetail} straight from the fat {@link ProjectBackendService} (no HTTP hop —
 * exactly as the Project Details sidebar SSRs its first paint), then projects it onto the shared
 * discovery showcase shapes via {@link buildProjectShowcase}. So the Preview paints the same
 * `/view/[id]?type=projects` layout on the first byte, and carries the server-derived `viewerIsClient`
 * capability flag the header/route use to gate the client-only Edit experience. Never imported by an
 * island (it reaches `@server/services`).
 */

/** Everything the Project Preview body + role-based header need without a client round-trip. */
export interface ProjectShowcaseBootstrap {
	/** The resolved engagement, or `null` when the slug matched nothing. */
	detail: ProjectDetail | null;
	/** The showcase projection (item + stage flow), or `null` on a miss. */
	showcase: ProjectShowcase | null;
	/** Whether the acting user is the client/creator — gates the Edit tab + editor (re-derived server-side). */
	viewerIsClient: boolean;
	/** The routed slug (echoed so a miss can still offer a way back). */
	slug: string;
}

/** Resolve the Project Preview showcase bootstrap for a routed slug + the acting user context. */
export function resolveProjectShowcase(
	slug: string,
	_context: UserContext,
): ProjectShowcaseBootstrap {
	const res = ProjectBackendService.detail(slug);
	const detail = res.ok && res.data ? res.data.detail : null;
	return {
		detail,
		showcase: detail ? buildProjectShowcase(detail) : null,
		viewerIsClient: detail?.viewerIsClient ?? false,
		slug,
	};
}
