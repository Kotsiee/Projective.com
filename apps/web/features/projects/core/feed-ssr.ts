import type { UserContext } from "@projective/types/auth";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import { parseProjectParams } from "./projects-state.ts";
import type { ProjectFeedParams, ProjectFeedPayload } from "../types/projects-types.ts";

/**
 * feed-ssr — the SERVER-ONLY bootstrap the `(dashboard)` layout uses to paint the projects lane's
 * first byte. It parses the request query, applies the Implicit User Context rule (default the feed
 * to the actor's active context when the URL pins no scope), and calls the fat
 * {@link ProjectBackendService} directly (no HTTP hop) — exactly as `/explore` SSRs its first paint.
 * Never imported by an island (it reaches `@server/services`); the island refines via the thin
 * `ProjectSidebarService` over `/api/projects/*`.
 */

/** Everything the {@link ProjectsLane} island needs to hydrate without a client round-trip. */
export interface FeedBootstrap {
	params: ProjectFeedParams;
	payload: ProjectFeedPayload;
	/** The actor's resolved active context id — the partition key for cached filters. */
	activeContextId: string;
	/** Human label of the active context (for the header + scope UI). */
	activeContextLabel: string;
}

const EMPTY_PAYLOAD: ProjectFeedPayload = {
	count: 0,
	incomingCount: 0,
	items: [],
	groups: [],
	scopes: [],
	services: [],
};

/** Resolve the projects feed for a request + the acting user context. */
export function resolveProjectsFeed(url: URL, context: UserContext): FeedBootstrap {
	const parsed = parseProjectParams(url.searchParams);
	const activeContextId = context.contextId;
	// Implicit User Context: with no explicit scope pinned, load the actor's active context.
	const params: ProjectFeedParams = parsed.scope === "context" && !parsed.scopeId && activeContextId
		? { ...parsed, scopeId: activeContextId }
		: parsed;

	const res = ProjectBackendService.list(params);
	const payload = res.ok && res.data ? res.data : EMPTY_PAYLOAD;
	const activeContextLabel = payload.scopes.find((s) => s.id === activeContextId)?.label ??
		(context.handle ? `@${context.handle}` : "Personal");

	return { params, payload, activeContextId, activeContextLabel };
}
