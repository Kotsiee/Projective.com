import { z } from "zod";
import { ContextType } from "../auth/mod.ts";
import {
	EngagementKind,
	ProjectFormat,
	ProjectStatus,
	type ProjectSummary,
	ProjectViewerRole,
} from "./summary.ts";

/**
 * projects.feed — the Zod SSOT for `/projects` middle-nav feed QUERY state and the shape of the
 * grouped, context-scoped payload the fat {@link ProjectBackendService} returns.
 *
 * `ProjectFeedParams` is the normalised query the route parser produces and the service consumes;
 * `ProjectFeedPayload` is the cross-boundary DTO the feed island renders. Kept here (not in the app
 * feature) so the app and the backend package share one definition (mirrors `explore/discovery.ts`).
 */

// #region Query state
/**
 * Feed scope. `context` shows only the actively-selected workspace's engagements (the Implicit User
 * Context rule); `global` is the Sovereign "Show My Global Involvement" escape hatch — every
 * engagement the underlying account touches, across all profiles.
 */
export const ProjectScope = z.enum(["context", "global"]);
export type ProjectScope = z.infer<typeof ProjectScope>;

/** Sort key for the feed. `priority` surfaces unread/active first; `recent` is the default. */
export const ProjectSort = z.enum(["recent", "priority", "alphabetical"]);
export type ProjectSort = z.infer<typeof ProjectSort>;

/**
 * The permanent high-frequency quick-filters in the utility row. `starred`/`unread` narrow on the
 * boolean flags; the three `*_ticket`/`*_requested`/`*_review` keys narrow on {@link ProjectActivity}
 * (OR-combined with each other and with {@link ProjectRequestFilter}).
 */
export const ProjectQuickFilter = z.enum([
	"starred",
	"unread",
	"new_ticket",
	"revision_requested",
	"pending_review",
]);
export type ProjectQuickFilter = z.infer<typeof ProjectQuickFilter>;

/**
 * Ingestion / request toggles (they live in the sidebar footer, not the utility row): surface
 * engagements awaiting the viewer's acceptance. `client_invite` = an incoming hire request from a
 * client; `service_request` = a paid service purchase awaiting the provider's vetting. Both narrow on
 * {@link ProjectActivity} and OR-combine with the activity quick-filters.
 */
export const ProjectRequestFilter = z.enum(["client_invite", "service_request"]);
export type ProjectRequestFilter = z.infer<typeof ProjectRequestFilter>;

/**
 * The top-level view split shown as tabs at the head of the feed: client-architected **projects**
 * vs. provider-side **client engagements**. Maps to {@link EngagementKind} (`projects` → `project`,
 * `engagements` → `service`); it is a view mode, not a filter, so it never counts toward "dirty".
 */
export const ProjectView = z.enum(["projects", "engagements"]);
export type ProjectView = z.infer<typeof ProjectView>;

/**
 * The normalised query behind the `/projects` feed. This whole object is what gets cached per
 * context id (client-side, partitioned) so filters reload exactly as the actor left them.
 */
export const ProjectFeedParamsSchema = z.object({
	/** Free-text search over title / counterparty / scope label. */
	q: z.string(),
	/** Top-level view tab — Projects vs Client Engagements. */
	view: ProjectView,
	sort: ProjectSort,
	scope: ProjectScope,
	/**
	 * When scoping to a SPECIFIC tenant (a Team/Business/Organisation toggle) rather than the active
	 * one, the chosen workspace. `null` = the actor's active context (scope `context`) or irrelevant
	 * (scope `global`).
	 */
	scopeType: ContextType.nullable(),
	/** The chosen workspace id paired with {@link scopeType}; `""` = active/all. */
	scopeId: z.string().max(64),
	/**
	 * Explicit multi-workspace selection — the ids chosen in the filter popover's workspace tag-combo.
	 * Empty (`[]`) falls back to {@link scope}/active-context resolution; when non-empty, the feed shows
	 * only these workspaces' engagements (and `scope` `global` still overrides to span everything).
	 */
	workspaces: z.array(z.string().max(64)),
	/** Role facet — restrict to engagements where the actor holds one of these roles. */
	roles: z.array(ProjectViewerRole),
	/** Work-flow facet (pipeline / one-off / session). */
	formats: z.array(ProjectFormat),
	/** Lifecycle facet. */
	statuses: z.array(ProjectStatus),
	/** Project vs service facet. */
	kinds: z.array(EngagementKind),
	/** Sticky high-frequency toggles (starred / unread / activity-based). */
	quick: z.array(ProjectQuickFilter),
	/** Ingestion toggles (incoming hire requests / paid service requests awaiting acceptance). */
	requests: z.array(ProjectRequestFilter),
	/**
	 * "Clients by Service Provider" — isolate the clients engaged through a single service. `""` = all.
	 * Freelancer-scope control (PRODUCT_SPEC §Projects & Services); ignored for non-provider actors.
	 */
	serviceId: z.string().max(64),
});
export type ProjectFeedParams = z.infer<typeof ProjectFeedParamsSchema>;
// #endregion

// #region Result grouping
/** One context-scoped section of the feed (the matrix groups rows by owning workspace). */
export const ProjectGroupSchema = z.object({
	key: z.string(),
	title: z.string(),
	scopeType: ContextType,
	scopeId: z.string().max(64),
});
export type ProjectGroup = z.infer<typeof ProjectGroupSchema>;
// #endregion

// #region Filter-panel option shapes (drive the scope/service dropdown matrices)
/**
 * A workspace the actor belongs to — one option in the context-scope matrix (the Team/Business/Org
 * toggles + "Show All"). Derived server-side from the actor's memberships.
 */
export interface ScopeOption {
	/** The context id (tenant id, or the user id for personal). */
	id: string;
	type: ContextType;
	label: string;
	handle: string | null;
	/** The actor's role in this workspace. */
	role: ProjectViewerRole;
	/** How many engagements the actor has in this workspace (a muted count next to the toggle). */
	count: number;
}

/** A service the actor provides — one option in the "Filter Clients for Service [X]" dropdown. */
export interface ServiceOption {
	id: string;
	name: string;
	/** Distinct clients engaged through this service. */
	clientCount: number;
}
// #endregion

// #region Transport payload (cross-boundary DTO)
/** The `/api/projects/list` payload — the grouped, context-scoped feed the island renders. */
export interface ProjectFeedPayload {
	/** Real match count (drives the "N engagements" line). */
	count: number;
	/**
	 * How many engagements in the current view + scope are awaiting the viewer's acceptance (activity
	 * `client_invite` or `service_request`) — the count badge on the footer's Incoming button. Computed
	 * independently of the active facet/quick/request filters so the badge is stable as the user filters.
	 */
	incomingCount: number;
	/** The matched rows (flat; the island groups by {@link ProjectFeedPayload.groups} when present). */
	items: ProjectSummary[];
	/** Context sections in display order; empty when a single scope is isolated. */
	groups: ProjectGroup[];
	/** Every workspace the actor belongs to, for the scope matrix. */
	scopes: ScopeOption[];
	/** The actor's provider services, for the client-by-service filter (empty for non-providers). */
	services: ServiceOption[];
}
// #endregion
