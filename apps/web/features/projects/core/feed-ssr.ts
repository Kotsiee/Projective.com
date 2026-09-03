import type { UserContext } from "@projective/types/auth";
import { toDisplayCurrency } from "@projective/types/finance";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import { parseProjectParams } from "./projects-state.ts";
import type { ProjectFeedParams, ProjectFeedPayload } from "../types/projects-types.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

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
	/**
	 * The currency the Quick-Init modal seeds a new project in.
	 *
	 * Always a supported display currency: {@link toDisplayCurrency} narrows anything unknown or
	 * absent to the platform base rather than refusing, because a currency the client never typed is
	 * not a field they can correct — and never to a hardcoded code, which would price a project in a
	 * denomination nobody on the request ever chose.
	 */
	defaultCurrency: string;
}

const EMPTY_PAYLOAD: ProjectFeedPayload = {
	count: 0,
	incomingCount: 0,
	items: [],
	groups: [],
	scopes: [],
	services: [],
};

/**
 * Resolve the projects feed for a request + the acting user context.
 *
 * `displayCurrency` is the request's resolved money context — `ctx.state.currency?.displayCurrency`,
 * set site-wide by the global middleware. It is passed IN rather than read from `context` because
 * `UserContext.displayCurrency` is only populated from a session JWT, so it is null for a guest and
 * for any request whose claim predates the currency hook; the middleware's value is the one that is
 * always resolved. When the caller omits it the context claim is the fallback, and the platform base
 * the floor — never a hardcoded code.
 */
export async function resolveProjectsFeed(
	url: URL,
	context: UserContext,
	actor: ReadActor,
	displayCurrency?: string | null,
): Promise<FeedBootstrap> {
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
	const res = await ProjectBackendService.list(params, actor);
	const payload = res.ok && res.data ? res.data : EMPTY_PAYLOAD;
	if (params.scopeId && !payload.scopes.some((s) => s.id === params.scopeId)) {
		params = { ...params, scopeId: "" };
	}

	const activeContextLabel = payload.scopes.find((s) => s.id === activeContextId)?.label ??
		(context.handle ? `@${context.handle}` : "Personal");

	return {
		params,
		payload,
		activeContextId,
		activeContextLabel,
		canOfferServices,
		defaultCurrency: toDisplayCurrency(displayCurrency ?? context.displayCurrency),
	};
}
