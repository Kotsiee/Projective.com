import {
	canonicalSet,
	type CataloguePage,
	CONSOLE_DEFAULTS,
	ConsoleHighlight,
	consoleHref,
	type ConsoleUrlState,
	DEFAULT_CONSOLE_STATUSES,
	defaultSortDir,
	isDefaultStatuses,
	isTeamHandle,
	type ListingStatus,
	type ListingSummary,
	parseConsoleUrl,
	ServiceType,
} from "@projective/types/catalogue";
import { CreateCategory } from "@projective/types/org";

/**
 * lane-model — the pure half of the `/catalogue*` lane: the filter toggles its quick bar and filter
 * popover write, how many choices narrow the listings, and the lane memory that carries the filter,
 * the team selection and the open sections from `/catalogue` to `/catalogue/[id]` and back. The
 * memory is a cookie so the server paints the lane exactly as it was left.
 */

const ORIGIN = "https://catalogue.invalid";

// #region Filter toggles
/** Toggle one status; the last one is never released, since an empty set reads as the default. */
export function toggleStatus(
	current: readonly ListingStatus[],
	value: ListingStatus,
): ListingStatus[] {
	const next = current.includes(value) ? current.filter((s) => s !== value) : [...current, value];
	return next.length ? next : [...current];
}

/** Toggle one value of a facet, keeping the facet in its canonical order. */
export function toggleFacet<T>(order: readonly T[], current: readonly T[], value: T): T[] {
	const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
	return canonicalSet(order, next);
}

/** Toggle one highlight. */
export function toggleHighlight(
	current: readonly ConsoleHighlight[],
	value: ConsoleHighlight,
): ConsoleHighlight[] {
	return toggleFacet(ConsoleHighlight.options, current, value);
}

/** Toggle one delivery model. */
export function toggleModel(current: readonly ServiceType[], value: ServiceType): ServiceType[] {
	return toggleFacet(ServiceType.options, current, value);
}

/** Toggle one CREATE category. */
export function toggleCategory(
	current: readonly CreateCategory[],
	value: CreateCategory,
): CreateCategory[] {
	return toggleFacet(CreateCategory.options, current, value);
}

/**
 * How many choices narrow or reorder the listings: a status set other than the default once, each
 * highlight, delivery model and category once, and a sort other than the default once.
 */
export function activeFilterCount(state: ConsoleUrlState): number {
	const sorted = state.sort !== CONSOLE_DEFAULTS.sort || state.dir !== defaultSortDir(state.sort);
	return (isDefaultStatuses(state.status) ? 0 : 1) + state.highlights.length +
		state.model.length + state.create.length + (sorted ? 1 : 0);
}

/** The patch the filter popover's Reset writes: every facet and the sort at rest; search and type kept. */
export function resetFilterPatch(): Partial<ConsoleUrlState> {
	return {
		status: [...DEFAULT_CONSOLE_STATUSES],
		highlights: [],
		model: [],
		create: [],
		sort: CONSOLE_DEFAULTS.sort,
		dir: CONSOLE_DEFAULTS.dir,
	};
}
// #endregion

// #region Lane memory
/** The "Your listings" section's key. */
export const OWN_SECTION = "own";

/** A team section's key. */
export function teamSection(handle: string): string {
	return `team:${handle}`;
}

/** What the lane remembers between `/catalogue` and `/catalogue/[id]`. */
export interface CatalogueLaneMemory {
	/** The filter: facets, search, type and sort; every other console field at its default. */
	filter: ConsoleUrlState;
	/** The team sections chosen in the filter popover; empty shows every team. */
	teams: string[];
	/** The open sections ({@link OWN_SECTION}, {@link teamSection}). */
	open: string[];
}

/** The memory before anything is remembered: the console's resting filter, only Your listings open. */
export function defaultLaneMemory(): CatalogueLaneMemory {
	return { filter: { ...CONSOLE_DEFAULTS }, teams: [], open: [OWN_SECTION] };
}

/** A console state cut down to the part the lane keeps. */
export function laneFilterOf(state: ConsoleUrlState): ConsoleUrlState {
	return {
		...CONSOLE_DEFAULTS,
		type: state.type,
		status: [...state.status],
		model: [...state.model],
		create: [...state.create],
		highlights: [...state.highlights],
		search: state.search,
		sort: state.sort,
		dir: state.dir,
	};
}

function handles(raw: string | null): string[] {
	if (!raw) return [];
	return [...new Set(raw.split(",").map((h) => h.trim()).filter(isTeamHandle))];
}

function sections(raw: string): string[] {
	return [
		...new Set(
			raw.split(",").map((s) => s.trim()).filter((s) =>
				s === OWN_SECTION || (s.startsWith("team:") && isTeamHandle(s.slice(5)))
			),
		),
	];
}

/** Read the lane memory from its cookie value. Total: anything unreadable falls back to the default. */
export function parseLaneMemory(raw: string | null | undefined): CatalogueLaneMemory {
	if (!raw) return defaultLaneMemory();
	const q = new URLSearchParams(raw);
	const open = q.get("open");
	return {
		filter: laneFilterOf(parseConsoleUrl(new URL(`/catalogue?${q.get("f") ?? ""}`, ORIGIN))),
		teams: handles(q.get("teams")),
		open: open === null ? [OWN_SECTION] : sections(open),
	};
}

/** The lane memory as its cookie value: canonical, so equal memories serialise equally. */
export function serializeLaneMemory(memory: CatalogueLaneMemory): string {
	const filter = consoleHref({ ...laneFilterOf(memory.filter), team: undefined });
	const q = new URLSearchParams();
	const f = filter.split("?")[1];
	if (f) q.set("f", f);
	if (memory.teams.length) q.set("teams", memory.teams.join(","));
	q.set("open", memory.open.join(","));
	return q.toString();
}
// #endregion

// #region Reads
/** One section's listings, or why they could not be read. */
export type LaneListingsRead =
	| { ok: true; items: ListingSummary[]; total: number }
	| { ok: false; message: string };

/** A catalogue page as a lane read. */
export function laneReadOf(page: Pick<CataloguePage, "items" | "total">): LaneListingsRead {
	return { ok: true, items: page.items, total: page.total };
}

/** The teams whose sections the lane draws: the chosen ones, or every team when none is chosen. */
export function visibleTeams<T extends { handle: string }>(
	teams: readonly T[],
	chosen: readonly string[],
): T[] {
	return chosen.length ? teams.filter((t) => chosen.includes(t.handle)) : [...teams];
}
// #endregion
