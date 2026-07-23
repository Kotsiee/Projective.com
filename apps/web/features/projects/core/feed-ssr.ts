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
	/**
	 * Whether the acting account can offer/deliver services (freelancer/seller capability). Drives
	 * whether the lane shows the Projects/Services tab split — hidden for client/business accounts,
	 * where every engagement is simply a project.
	 */
	canOfferServices: boolean;
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
	const canOfferServices = context.isFreelancer;

	// A client/business account has no provider-side services, so the `engagements` (Services) view is
	// meaningless there — pin the feed to `projects` so a stale/shared `?view=engagements` link (or a
	// converted-then-reverted account) never lands on an empty Services tab.
	const withView = (p: ProjectFeedParams): ProjectFeedParams =>
		canOfferServices || p.view === "projects" ? p : { ...p, view: "projects" };

	// Implicit User Context: with no explicit scope pinned, load the actor's active context.
	const scoped: ProjectFeedParams = parsed.scope === "context" && !parsed.scopeId && activeContextId
		? { ...parsed, scopeId: activeContextId }
		: parsed;
	let params = withView(scoped);

	// `ProjectBackendService.list` resolves the scope: in STUB mode a phantom pin (a real auth
	// `contextId` matching no fixture workspace) is dropped so the lane shows the acting account's feed
	// instead of stranding empty (see `query.withResolvableScope`) — this covers the thin refetch path
	// too. Mirror that here so the params we hand the island (cached + serialized) don't carry a scope id
	// that names no real workspace. The live path pins a real workspace, so this is a no-op there.
	const res = ProjectBackendService.list(params);
	const payload = res.ok && res.data ? res.data : EMPTY_PAYLOAD;
	if (params.scopeId && !payload.scopes.some((s) => s.id === params.scopeId)) {
		params = { ...params, scopeId: "" };
	}

	const activeContextLabel = payload.scopes.find((s) => s.id === activeContextId)?.label ??
		(context.handle ? `@${context.handle}` : "Personal");

	return { params, payload, activeContextId, activeContextLabel, canOfferServices };
}
