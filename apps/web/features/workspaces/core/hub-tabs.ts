import {
	type WorkspaceCapability,
	workspaceHref,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { hubOf, hubsForViewer, type ModuleKey, type ViewerHub } from "./module-registry.tsx";
import { MEMBERS_QUEUE, subViewSearch, subViewsFor } from "./sub-views.ts";

/**
 * hub-tabs — the header band's tab strip for a multi-module hub (Decision #306).
 *
 * A hub gathers modules ("Roster & members" is Members · Invitations · Roles); each keeps its own route
 * and gate, and the band draws the hub as ONE strip of link tabs: a module with sub-views contributes one
 * tab per sub-view (Members → People · Invitations · Org chart), any other module one tab of its own.
 * Every tab is a real address the server resolves and guards, so a tab never switches state the URL
 * does not carry.
 *
 * The Invitations module is the Members queue under a second address: where Members is offered, its
 * Invitations sub-view stands for it, and `/invitations` marks that tab. A hub the viewer reaches only
 * one module of draws no hub strip — the module's own in-place sub-view tabs stay (`sub-views.ts`).
 *
 * Pure: no signals, no DOM. It reaches the registry, so tests load it through `importWithoutGlyphs`.
 */

// #region Vocabulary
/** One link tab. */
export interface HubTab {
	key: string;
	label: string;
	href: string;
	module: ModuleKey;
	/** The sub-view the tab selects, or `null` for a module tab. */
	view: string | null;
}

/** A hub's strip and which tab is current. */
export interface HubTabStrip {
	/** The hub's label for this kind — the band's title over the strip. */
	title: string;
	tabs: HubTab[];
	active: number;
}

/** What the strip is resolved from. */
export interface HubTabsInput {
	kind: WorkspaceKind;
	handle: string;
	capabilities: readonly WorkspaceCapability[];
	module: ModuleKey;
	/** The module's resolved sub-view, or `null`. */
	view: string | null;
}
// #endregion

// #region Resolution
/** The viewer's hub for a module, or `null` when the module is in none or the viewer sees none of it. */
export function viewerHubOf(
	kind: WorkspaceKind,
	capabilities: readonly WorkspaceCapability[],
	module: ModuleKey | null,
): ViewerHub | null {
	const hub = hubOf(module);
	if (!hub) return null;
	return hubsForViewer(kind, capabilities).find((h) => h.hub.key === hub.key) ?? null;
}

/** The modules a hub's strip lists: the Invitations alias folds into Members where Members is listed. */
function stripModules(hub: ViewerHub): ModuleKey[] {
	const keys = hub.modules.map((m) => m.key);
	return keys.includes("members") ? keys.filter((k) => k !== "invitations") : keys;
}

/**
 * The hub strip for the module being rendered, or `null` when the band keeps the module's own sub-view
 * tabs: no hub, or a hub of which the viewer may open one module only.
 */
export function hubTabs(input: HubTabsInput): HubTabStrip | null {
	const hub = viewerHubOf(input.kind, input.capabilities, input.module);
	if (!hub) return null;
	const modules = stripModules(hub);
	if (modules.length < 2) return null;

	const tabs: HubTab[] = modules.flatMap((module): HubTab[] => {
		const base = workspaceHref(input.kind, input.handle, module);
		const views = subViewsFor(module, input.kind, input.capabilities);
		if (views.length === 0) {
			const label = hub.modules.find((m) => m.key === module)?.label ?? module;
			return [{ key: module, label, href: base, module, view: null }];
		}
		return views.map((v) => ({
			key: `${module}:${v.value}`,
			label: v.label,
			href: `${base}${subViewSearch("", views, v.value)}`,
			module,
			view: v.value,
		}));
	});

	return { title: hub.label, tabs, active: activeTab(tabs, input) };
}

/** The current tab: the rendered module at its sub-view — `/invitations` reads as the Members queue. */
function activeTab(tabs: readonly HubTab[], input: HubTabsInput): number {
	const aliased = input.module === "invitations" && tabs.some((t) => t.module === "members");
	const module = aliased ? "members" : input.module;
	const view = aliased ? MEMBERS_QUEUE : input.view;
	const own = tabs.map((t, i) => ({ t, i })).filter(({ t }) => t.module === module);
	if (own.length === 0) return 0;
	return (own.find(({ t }) => t.view === view) ?? own[0]).i;
}

/**
 * Whether the band draws a hub strip over `module` — the body then drops its `tabpanel` wiring, since a
 * strip of links names no panel.
 */
export function bandHasHubStrip(input: HubTabsInput): boolean {
	return hubTabs(input) !== null;
}
// #endregion
