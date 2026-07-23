import {
	EngagementKind,
	ProjectFormat,
	ProjectInvolvement,
	ProjectQuickFilter,
	ProjectRequestFilter,
	ProjectScope,
	ProjectSort,
	ProjectStatus,
	ProjectView,
	ProjectViewerRole,
} from "../types/projects-types.ts";
import type { ProjectFeedParams } from "../types/projects-types.ts";
import { ContextType } from "@projective/types/auth";

export type { ProjectFeedParams };

/**
 * Projects feed URL/query state — the single source of truth for how the middle-nav feed is scoped
 * and filtered. Pure and DOM-free so it runs identically on the server (route SSR) and the client
 * (the feed island reads/writes it, and the thin service builds the API query from it). No
 * module-scope `globalThis` access (mirrors `explore/core/explore-state.ts`).
 */

// #region Defaults
/** The default sort — most-recent activity first. */
export const DEFAULT_SORT: ProjectFeedParams["sort"] = "recent";

/**
 * The neutral starting query: the active context's engagements, most-recent first, no facets. The
 * route overrides `scopeId` with the actor's resolved active context (the Implicit User Context rule).
 */
export const DEFAULT_PROJECT_PARAMS: ProjectFeedParams = {
	q: "",
	view: "projects",
	involvement: "all",
	sort: DEFAULT_SORT,
	scope: "context",
	scopeType: null,
	scopeId: "",
	workspaces: [],
	roles: [],
	formats: [],
	statuses: [],
	kinds: [],
	quick: [],
	requests: [],
	serviceId: "",
};
// #endregion

// #region Parse helpers
/** Split a facet param (repeated keys or comma lists) and keep only values in `allowed`. */
function facet<T extends string>(
	sp: URLSearchParams,
	key: string,
	allowed: readonly T[],
): T[] {
	const set = new Set<string>(allowed);
	const out: T[] = [];
	for (const raw of sp.getAll(key)) {
		for (const v of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
			if (set.has(v) && !out.includes(v as T)) out.push(v as T);
		}
	}
	return out;
}

/** Coerce a single value against an allowed set, falling back to `fallback`. */
function one<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
	return raw && (allowed as readonly string[]).includes(raw) ? raw as T : fallback;
}

/** Split a free-form id param (repeated keys or comma lists) into a deduped, length-capped list. */
function idList(sp: URLSearchParams, key: string): string[] {
	const out: string[] = [];
	for (const raw of sp.getAll(key)) {
		for (const v of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
			if (v.length <= 64 && !out.includes(v)) out.push(v);
		}
	}
	return out;
}
// #endregion

// #region Parse
/** Parse a query string (or `URLSearchParams`) into normalised {@link ProjectFeedParams}. */
export function parseProjectParams(search: string | URLSearchParams): ProjectFeedParams {
	const sp = typeof search === "string" ? new URLSearchParams(search) : search;
	const scopeTypeRaw = sp.get("scopeType");
	return {
		q: (sp.get("q") ?? "").trim(),
		view: one(sp.get("view"), ProjectView.options, "projects"),
		involvement: one(sp.get("involvement"), ProjectInvolvement.options, "all"),
		sort: one(sp.get("sort"), ProjectSort.options, DEFAULT_SORT),
		scope: one(sp.get("scope"), ProjectScope.options, "context"),
		scopeType: scopeTypeRaw && (ContextType.options as readonly string[]).includes(scopeTypeRaw)
			? scopeTypeRaw as ProjectFeedParams["scopeType"]
			: null,
		scopeId: (sp.get("scopeId") ?? "").trim(),
		workspaces: idList(sp, "workspaces"),
		roles: facet(sp, "roles", ProjectViewerRole.options),
		formats: facet(sp, "formats", ProjectFormat.options),
		statuses: facet(sp, "statuses", ProjectStatus.options),
		kinds: facet(sp, "kinds", EngagementKind.options),
		quick: facet(sp, "quick", ProjectQuickFilter.options),
		requests: facet(sp, "requests", ProjectRequestFilter.options),
		serviceId: (sp.get("serviceId") ?? "").trim(),
	};
}
// #endregion

// #region Serialise
/** Build a canonical `URLSearchParams` from params (stable key order; defaults omitted). */
export function toSearchParams(p: ProjectFeedParams): URLSearchParams {
	const sp = new URLSearchParams();
	if (p.q) sp.set("q", p.q);
	if (p.view !== "projects") sp.set("view", p.view);
	if (p.involvement !== "all") sp.set("involvement", p.involvement);
	if (p.sort !== DEFAULT_SORT) sp.set("sort", p.sort);
	if (p.scope !== "context") sp.set("scope", p.scope);
	if (p.scopeType) sp.set("scopeType", p.scopeType);
	if (p.scopeId) sp.set("scopeId", p.scopeId);
	if (p.workspaces.length) sp.set("workspaces", p.workspaces.join(","));
	if (p.roles.length) sp.set("roles", p.roles.join(","));
	if (p.formats.length) sp.set("formats", p.formats.join(","));
	if (p.statuses.length) sp.set("statuses", p.statuses.join(","));
	if (p.kinds.length) sp.set("kinds", p.kinds.join(","));
	if (p.quick.length) sp.set("quick", p.quick.join(","));
	if (p.requests.length) sp.set("requests", p.requests.join(","));
	if (p.serviceId) sp.set("serviceId", p.serviceId);
	return sp;
}

/** Serialise params to a canonical `/projects?…` path (shareable, drives `history.pushState`). */
export function serializeProjectParams(p: ProjectFeedParams): string {
	const qs = toSearchParams(p).toString();
	return qs ? `/projects?${qs}` : "/projects";
}
// #endregion

// #region Derive
/**
 * Count the refinements that live inside the Smart Filter popover — workspaces, role/format/status,
 * clients-by-service, and a non-default sort. Drives the filter trigger's subtle active dot so the
 * user knows the feed is narrowed even while the popover is closed.
 */
export function popoverActiveCount(p: ProjectFeedParams): number {
	return p.workspaces.length +
		p.roles.length +
		p.formats.length +
		p.statuses.length +
		(p.serviceId ? 1 : 0) +
		(p.sort !== DEFAULT_SORT ? 1 : 0);
}

/**
 * Whether any filter is modifying the resting view — drives the "Clear all" affordance. The `view`
 * tab and the implicit active-context `scopeId` are resting state, not filters, so both are excluded;
 * an explicit workspace selection, a non-default sort, a search, a quick toggle, the global escape
 * hatch, or any popover facet all count.
 */
export function isFilterDirty(p: ProjectFeedParams): boolean {
	return (p.q ? 1 : 0) +
			(p.scope === "global" ? 1 : 0) +
			p.quick.length +
			p.requests.length +
			popoverActiveCount(p) > 0;
}
// #endregion
