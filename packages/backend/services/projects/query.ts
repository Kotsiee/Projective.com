import type {
	ProjectFeedParams,
	ProjectGroup,
	ProjectSummary,
	ProjectView,
	ScopeOption,
	ServiceOption,
} from "@projective/types/projects";
import { matchesInvolvement } from "@projective/types/projects";
import { allProjects, allScopes, allServices } from "./fixtures.ts";

/**
 * projects query — the pure, deterministic selectors behind the `/projects` feed. No RNG, no clock,
 * no DOM: identical on the server (SSR first paint) and as the fixture fallback for the live path, so
 * it swaps cleanly for the RLS-scoped `projects.*` ranking query later (mirrors `explore/query.ts`).
 */

// #region Scope order (stable grouping — personal → team → business → organisation)
const SCOPE_ORDER: Record<string, number> = {
	personal: 0,
	team: 1,
	business: 2,
	organisation: 3,
};
// #endregion

// #region View
/** Map the top-level view tab to the engagement kind it shows. */
function matchesView(row: ProjectSummary, view: ProjectView): boolean {
	return view === "engagements" ? row.kind === "service" : row.kind === "project";
}
// #endregion

// #region Filter
/** Apply the feed's view + scope + facet + quick + search filters to the corpus. */
function applyFilters(rows: readonly ProjectSummary[], p: ProjectFeedParams): ProjectSummary[] {
	const q = p.q.trim().toLowerCase();
	const roles = new Set(p.roles);
	const formats = new Set(p.formats);
	const statuses = new Set(p.statuses);
	const kinds = new Set(p.kinds);
	const quick = new Set(p.quick);

	// Activity-based selections (from the activity quick-filters AND the footer request toggles) narrow
	// on the single {@link ProjectActivity} axis, OR-combined: a row matches if its activity is any one
	// of them. `starred`/`unread` stay separate AND-narrowing boolean toggles.
	const activityWanted = new Set<string>([
		...p.quick.filter((k) => k !== "starred" && k !== "unread"),
		...p.requests,
	]);

	return rows.filter((row) => {
		// View tab (Projects vs Client Engagements).
		if (!matchesView(row, p.view)) return false;

		// Scope resolution: `global` spans everything; an explicit workspace selection (the popover's
		// tag-combo) narrows to that set; otherwise the single active context applies (Implicit User
		// Context). Precedence: global → explicit workspaces → active context.
		if (p.scope !== "global") {
			if (p.workspaces.length) {
				if (!p.workspaces.includes(row.scopeId)) return false;
			} else if (p.scopeId && row.scopeId !== p.scopeId) {
				return false;
			}
		}

		// Involvement (ownership) axis — owner/client/admin vs. worker/contributor (`all` = no narrowing).
		if (!matchesInvolvement(row.viewerRole, p.involvement)) return false;

		if (roles.size && !roles.has(row.viewerRole)) return false;
		if (formats.size && !formats.has(row.format)) return false;
		if (statuses.size && !statuses.has(row.status)) return false;
		if (kinds.size && !kinds.has(row.kind)) return false;

		// Sticky boolean quick-filters (AND — each narrows further).
		if (quick.has("starred") && !row.starred) return false;
		if (quick.has("unread") && !row.unread) return false;

		// Activity / request toggles (OR across the selected set).
		if (activityWanted.size && !activityWanted.has(row.activity ?? "")) return false;

		// Clients by service provider.
		if (p.serviceId && row.serviceId !== p.serviceId) return false;

		if (q) {
			const hay = `${row.title} ${row.counterparty?.name ?? ""} ${row.scopeLabel}`.toLowerCase();
			if (!hay.includes(q)) return false;
		}
		return true;
	});
}
// #endregion

// #region Incoming requests
/** Activities that represent an inbound request awaiting the viewer's acceptance. */
const INCOMING = new Set<string>(["client_invite", "service_request"]);

/**
 * Count engagements awaiting the viewer's acceptance in the current view + scope — independent of the
 * active facet/quick/request filters, so the footer's Incoming badge stays stable while the user
 * filters. Applies only the view tab and scope resolution (global → workspaces → active context).
 */
function countIncoming(rows: readonly ProjectSummary[], p: ProjectFeedParams): number {
	return rows.filter((row) => {
		if (!matchesView(row, p.view)) return false;
		if (p.scope !== "global") {
			if (p.workspaces.length) {
				if (!p.workspaces.includes(row.scopeId)) return false;
			} else if (p.scopeId && row.scopeId !== p.scopeId) {
				return false;
			}
		}
		return INCOMING.has(row.activity ?? "");
	}).length;
}
// #endregion

// #region Sort
/** Sort the matched rows by the chosen key (deterministic tie-break on id). */
function applySort(rows: ProjectSummary[], sort: ProjectFeedParams["sort"]): ProjectSummary[] {
	const byRecent = (a: ProjectSummary, b: ProjectSummary) =>
		b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);

	if (sort === "alphabetical") {
		return [...rows].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
	}
	if (sort === "priority") {
		const weight = (r: ProjectSummary) => (r.unread ? 0 : 2) + (r.status === "active" ? 0 : 1);
		return [...rows].sort((a, b) => weight(a) - weight(b) || byRecent(a, b));
	}
	return [...rows].sort(byRecent);
}
// #endregion

// #region Group
/**
 * Group the matched rows into context sections (display order: personal → team → business → org,
 * then by label). Returns an empty list when the feed resolves to a single scope — the island then
 * renders one flat list rather than a single redundant section header.
 */
function buildGroups(rows: ProjectSummary[]): ProjectGroup[] {
	const seen = new Map<string, ProjectGroup>();
	for (const row of rows) {
		if (seen.has(row.scopeId)) continue;
		seen.set(row.scopeId, {
			key: row.scopeId,
			title: row.scopeLabel,
			scopeType: row.scopeType,
			scopeId: row.scopeId,
		});
	}
	if (seen.size <= 1) return [];
	return [...seen.values()].sort((a, b) =>
		(SCOPE_ORDER[a.scopeType] ?? 9) - (SCOPE_ORDER[b.scopeType] ?? 9) ||
		a.title.localeCompare(b.title)
	);
}
// #endregion

// #region Scope resolvability (stub-mode guard)
/**
 * STUB-mode guard against a phantom scope pin. In stub mode the fixtures key their workspaces to fixed
 * placeholder ids (`u_ahmed`, `t_northwind`, …), but a real/opaque auth `contextId` (a Supabase UUID)
 * is what the feed pins the active context to — an id that names NO fixture workspace, so the scope
 * filter would drop every row and strand the lane empty. This drops any `scopeId`/`workspaces` that
 * names no known workspace, so the feed falls back to the acting account's full set instead of a false
 * empty. An EXPLICIT workspace pick (from the filter combo) is a real fixture id and survives untouched;
 * once the live RLS-scoped path lands the ids are always real workspaces, so this becomes a no-op (and
 * `ProjectBackendService.list` only calls it in stub mode anyway).
 */
export function withResolvableScope(params: ProjectFeedParams): ProjectFeedParams {
	const known = new Set(allScopes().map((s) => s.id));
	const scopeId = params.scopeId && known.has(params.scopeId) ? params.scopeId : "";
	const workspaces = params.workspaces.filter((w) => known.has(w));
	if (scopeId === params.scopeId && workspaces.length === params.workspaces.length) return params;
	return { ...params, scopeId, workspaces };
}
// #endregion

// #region Public selectors
/** Run the feed query: filter → sort. */
export function getFeed(params: ProjectFeedParams): ProjectSummary[] {
	return applySort(applyFilters(allProjects(), params), params.sort);
}

/** How many engagements in the current view + scope are inbound requests awaiting acceptance. */
export function incomingCount(params: ProjectFeedParams): number {
	return countIncoming(allProjects(), params);
}

/** The context sections for a matched set (empty when a single scope). */
export function groupFeed(rows: ProjectSummary[]): ProjectGroup[] {
	return buildGroups(rows);
}

/**
 * The workspaces the actor belongs to, with counts scoped to the active VIEW tab (but independent of
 * the other facets) so each workspace word shows how many items it holds in the current view.
 */
export function scopeOptions(view: ProjectView): ScopeOption[] {
	const rows = allProjects();
	return allScopes().map((scope) => ({
		...scope,
		count: rows.filter((r) => matchesView(r, view) && r.scopeId === scope.id).length,
	}));
}

/** The actor's provider services (for the client-by-service filter). */
export function serviceOptions(): ServiceOption[] {
	return [...allServices()];
}

/** Look up a single engagement by slug (deep-link prefetch / row focus). */
export function findProject(slug: string): ProjectSummary | undefined {
	return allProjects().find((p) => p.slug === slug);
}
// #endregion
