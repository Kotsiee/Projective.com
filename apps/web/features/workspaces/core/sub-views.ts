import type { WorkspaceCapability, WorkspaceKind } from "@projective/types/workspace";

/**
 * sub-views — a console module's sub-views as DATA (Teams work order L2).
 *
 * A module that partitions its body into readings (Members: People · Invitations · Org chart) lists
 * them here, once. Every root that offers or honours a sub-view reads this table: the header band's
 * view toolbar, the lane's context control (Z2), the footer rig's Org chart toggle, the slot
 * resolvers that turn `?view=` into a value, and the body that renders it. A later module prompt only
 * adds or consumes an entry — there is no second list to keep in step.
 *
 * **One state.** The value lives in the URL as `?view=` (absent for the default) and, inside a
 * document, in the `moduleView` signal of `workspace-state`, which every control writes and every root
 * reads. There is never a per-root copy that could disagree with the others.
 *
 * **A tab is a control** (root CLAUDE.md §3 gate 11): an entry whose body does not read `?view=` yet is
 * recorded with `live: false` and is never drawn, so the table can carry a planned partition without
 * shipping a tab that reaches nothing. The prompt that builds the body flips it.
 *
 * Pure: no signals, no DOM, and no import of the module registry (whose glyphs import CSS), so a
 * `deno test` and an SSR slot resolver load it directly. Module keys are the registry's `ModuleKey`
 * strings.
 */

// #region Vocabulary
/** One sub-view of a module. */
export interface SubView {
	/** The `?view=` value. */
	value: string;
	/** Sentence-case words for the tab and any control that offers it. */
	label: string;
	/**
	 * The capability the viewer must hold for the view to be offered at all. A view whose data the
	 * server withholds from the viewer would render an empty queue under a live control.
	 */
	gate?: WorkspaceCapability;
}

/** A module's sub-views. */
export interface ModuleSubViews {
	/** The registry's module key. */
	module: string;
	/** The kinds whose module renders these views. */
	kinds: readonly WorkspaceKind[];
	/** The views in tab order. The first one the viewer may open is the default (the bare module URL). */
	views: readonly SubView[];
	/**
	 * Whether the module's body reads `?view=` today. `false` records a planned partition without
	 * drawing it — a tab over a body that ignores it would be a dead control.
	 */
	live: boolean;
}
// #endregion

// #region The table
/** The Members module's views, by value. */
export const MEMBERS_PEOPLE = "people";
/** The outgoing invitation queue. */
export const MEMBERS_QUEUE = "pending";
/** The org chart — a different reading of the same people. */
export const MEMBERS_CHART = "chart";

/** A team's Projects module: its live engagements (the default). */
export const PROJECTS_ACTIVE = "active";
/** A team's Projects module: the applications filed for it that await a client's answer. */
export const PROJECTS_PROPOSALS = "proposals";

const BOTH: readonly WorkspaceKind[] = ["team", "business"];
const TEAM: readonly WorkspaceKind[] = ["team"];

/**
 * Every module's sub-views. Members is live on both kinds and a team's Projects (Active · Proposals,
 * Teams C5) is live; Payouts (Split · Ledger, Teams C4) is recorded for the prompt that builds its body.
 */
export const SUB_VIEWS: readonly ModuleSubViews[] = [
	{
		module: "members",
		kinds: BOTH,
		live: true,
		views: [
			{ value: MEMBERS_PEOPLE, label: "People" },
			{ value: MEMBERS_QUEUE, label: "Invitations", gate: "invite_members" },
			{ value: MEMBERS_CHART, label: "Org chart" },
		],
	},
	{
		module: "payouts",
		kinds: TEAM,
		live: false,
		views: [
			{ value: "split", label: "Split" },
			{ value: "ledger", label: "Ledger" },
		],
	},
	{
		module: "projects",
		kinds: TEAM,
		live: true,
		views: [
			{ value: PROJECTS_ACTIVE, label: "Active" },
			{ value: PROJECTS_PROPOSALS, label: "Proposals" },
		],
	},
];
// #endregion

// #region Resolution
/**
 * The sub-views a viewer is offered on a module, in tab order — empty when the module has fewer than
 * two (a single view is not a choice) or its body does not honour them yet.
 */
export function subViewsFor(
	module: string | null,
	kind: WorkspaceKind,
	capabilities: readonly WorkspaceCapability[],
): SubView[] {
	const entry = SUB_VIEWS.find((e) => e.module === module);
	if (!entry || !entry.live || !entry.kinds.includes(kind)) return [];
	const views = entry.views.filter((v) => !v.gate || capabilities.includes(v.gate));
	return views.length > 1 ? views : [];
}

/**
 * A raw `?view=` value coerced against what the viewer is offered: the value itself when offered,
 * otherwise the default, and `null` when the module has no sub-views.
 */
export function resolveSubView(
	module: string | null,
	kind: WorkspaceKind,
	capabilities: readonly WorkspaceCapability[],
	raw: string | null,
): string | null {
	return pickSubView(subViewsFor(module, kind, capabilities), raw);
}

/** {@link resolveSubView} over an already-filtered list. */
export function pickSubView(views: readonly SubView[], raw: string | null): string | null {
	if (views.length === 0) return null;
	return views.some((v) => v.value === raw) ? raw : views[0].value;
}

/** The position of a value in the list, or `0` (the default) when it is not there. */
export function subViewIndex(views: readonly SubView[], value: string | null): number {
	const at = views.findIndex((v) => v.value === value);
	return at < 0 ? 0 : at;
}

/**
 * The query string that addresses a sub-view: `search` with `view` set, or removed for the default so
 * a module's landing view keeps its bare URL. Every other parameter is kept as it was.
 */
export function subViewSearch(search: string, views: readonly SubView[], value: string): string {
	const params = new URLSearchParams(search);
	if (views[0]?.value === value) params.delete("view");
	else params.set("view", value);
	const next = params.toString();
	return next ? `?${next}` : "";
}
// #endregion

// #region Members readings
/**
 * The readings of the people — every Members view but the invitation queue — which the lane's
 * context control and the footer rig's Org chart toggle offer. Their values are the sub-view values,
 * so every control writes the one state.
 */
export const MEMBERS_READINGS: readonly SubView[] =
	SUB_VIEWS.find((e) => e.module === "members")?.views.filter((v) => v.value !== MEMBERS_QUEUE) ??
		[];

/**
 * Whether a Members view is a reading of the people, and so carries the Org chart toggle (the People
 * reading also carries the zoom; the chart has no density to zoom).
 */
export function isPeopleReading(view: string | null): boolean {
	return view !== MEMBERS_QUEUE;
}
// #endregion

// #region Toolbar ↔ panel ids
/** The header band's view toolbar (Decision #307). */
export const SUB_VIEW_TOOLBAR_ID = "wsp-subviews";

/**
 * The body's one region the view toolbar controls (`aria-controls`). The body is another hydration
 * root, so it names itself by the current view's label ({@link subViewLabel}).
 */
export const SUB_VIEW_PANEL_ID = "wsp-subview-panel";

/** The current view's label — the panel's accessible name — or the first view's for an unknown value. */
export function subViewLabel(views: readonly SubView[], value: string | null): string {
	return views[subViewIndex(views, value)]?.label ?? "";
}
// #endregion
