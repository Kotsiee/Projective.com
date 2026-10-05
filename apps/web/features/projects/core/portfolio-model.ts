import type {
	ProjectFormat,
	ProjectStatus,
	ProjectSummary,
	ProjectViewerRole,
} from "@projective/types/projects";

/**
 * portfolio-model — the pure projections behind the `/projects` portfolio index.
 *
 * Everything the page prints that is DERIVED — the status filter and its counts, each project's stage
 * burn and the portfolio's aggregate — is computed here from the same `ProjectSummary` rows the lane
 * renders, so the index and the lane beside it cannot disagree about a project. No JSX, no I/O.
 *
 * # What "stage burn" means here, and what it does not
 *
 * Burn is the share of a project's STAGES that are delivered: `completedStages / totalStages`. It is
 * the rate the engagement is working through its planned run. It is deliberately not a money figure —
 * the summary row carries no spend, and a "burn" computed from the budget label would be a number
 * nobody can stand behind (the catalogue's "never invent" rule). A project with no stage count (a
 * session, or a one-off whose row reports none) has no burn and is left out of the aggregate rather
 * than counted as 0%, which would drag the portfolio's figure down with work that has no stages to
 * burn through.
 */

// #region Status filter
/** The status filters the index offers, in reading order — `all` first, the lifecycle after. */
export const PORTFOLIO_FILTERS = ["all", "draft", "active", "on_hold", "completed"] as const;
export type PortfolioFilter = typeof PORTFOLIO_FILTERS[number];

/** The filter's visible label. */
export const PORTFOLIO_FILTER_LABEL: Record<PortfolioFilter, string> = {
	all: "All",
	draft: "Draft",
	active: "Active",
	on_hold: "On hold",
	completed: "Completed",
};

/**
 * The URL parameter the filter rides on. NOT `statuses`: that is the lane's own facet
 * (`projects-state.ts`), and sharing it would make filtering the index silently re-filter the lane.
 */
export const PORTFOLIO_PARAM = "status";

/** Parse the filter from the query string; anything unrecognised is `all`, never an error. */
export function parsePortfolioFilter(raw: string | null | undefined): PortfolioFilter {
	return (PORTFOLIO_FILTERS as readonly string[]).includes(raw ?? "")
		? raw as PortfolioFilter
		: "all";
}

/** The index URL for a filter — the bare `/projects` for `all`, so the default has one address. */
export function portfolioHref(filter: PortfolioFilter): string {
	return filter === "all" ? "/projects" : `/projects?${PORTFOLIO_PARAM}=${filter}`;
}

/** The rows a filter keeps. `all` keeps every row, including a cancelled one. */
export function filterPortfolio(
	items: readonly ProjectSummary[],
	filter: PortfolioFilter,
): ProjectSummary[] {
	return filter === "all" ? [...items] : items.filter((it) => it.status === filter);
}

/** How many rows each filter would keep — the counts printed on the filter controls. */
export function countByFilter(items: readonly ProjectSummary[]): Record<PortfolioFilter, number> {
	const counts: Record<PortfolioFilter, number> = {
		all: items.length,
		draft: 0,
		active: 0,
		on_hold: 0,
		completed: 0,
	};
	for (const it of items) {
		if (it.status !== "cancelled") counts[it.status]++;
	}
	return counts;
}
// #endregion

// #region Stage burn
/** Delivered stages against planned stages, with the ratio pre-computed (0–1). */
export interface StageBurn {
	completed: number;
	total: number;
	ratio: number;
}

/** One project's burn, or `null` when it has no stage count to burn through. */
export function stageBurnOf(item: ProjectSummary): StageBurn | null {
	const total = item.totalStages ?? 0;
	if (total <= 0) return null;
	const completed = Math.min(Math.max(item.completedStages ?? 0, 0), total);
	return { completed, total, ratio: completed / total };
}

/**
 * The portfolio's aggregate burn — delivered stages over planned stages, SUMMED across the staged
 * projects in view (not an average of per-project percentages, which would let a two-stage job weigh
 * as much as a twelve-stage one). `projects` is how many rows contributed. `null` when none did.
 */
export function aggregateBurn(
	items: readonly ProjectSummary[],
): (StageBurn & { projects: number }) | null {
	let completed = 0;
	let total = 0;
	let projects = 0;
	for (const it of items) {
		const burn = stageBurnOf(it);
		if (!burn) continue;
		completed += burn.completed;
		total += burn.total;
		projects++;
	}
	if (total === 0) return null;
	return { completed, total, ratio: completed / total, projects };
}

/** A ratio as a whole percentage, for display. */
export function burnPercent(burn: StageBurn): number {
	return Math.round(burn.ratio * 100);
}

/**
 * How many segments of a meter to fill. The meter is drawn as discrete segments (the §D.8.4 track
 * meter) so its geometry needs no inline style; above `max` segments it quantises, and the exact
 * figure is always printed beside it in words — a bar cannot be read aloud.
 */
export function meterSegments(burn: StageBurn, max = 20): { filled: number; total: number } {
	const total = Math.min(burn.total, max);
	const filled = burn.total <= max ? burn.completed : Math.round(burn.ratio * max);
	return { filled, total };
}
// #endregion

// #region Labels
/** A lifecycle status, in words. */
export const STATUS_LABEL: Record<ProjectStatus, string> = {
	draft: "Draft",
	active: "Active",
	on_hold: "On hold",
	completed: "Completed",
	cancelled: "Cancelled",
};

/** A work-flow format, in words. */
export const FORMAT_LABEL: Record<ProjectFormat, string> = {
	one_off: "One-off",
	pipeline: "Pipeline",
	session: "Session",
};

/** The viewer's role on a row, in words. */
export const ROLE_LABEL: Record<ProjectViewerRole, string> = {
	owner: "Owner",
	admin: "Admin",
	freelancer: "Freelancer",
	client: "Client",
	member: "Member",
};
// #endregion
