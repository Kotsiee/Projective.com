import {
	type WorkspaceCapability,
	workspaceHref,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { hubOf, hubsForViewer, type ModuleKey, type ViewerHub } from "./module-registry.tsx";
import { MEMBERS_CHART, subViewSearch, subViewsFor } from "./sub-views.ts";

/**
 * hub-tabs — the header band's tab strip for a multi-module hub (Decision #306, drawn as link tabs
 * since Decision #319).
 *
 * A hub gathers modules ("Members" is Members · Invitations · Roles); each keeps its own route and
 * gate, and the band draws the hub as ONE strip of link tabs, one per module. A module's sub-views are
 * not tabs here: they are the module's own business (Members draws its sections in the body and its
 * org chart in the footer rig). Every tab is a real address the server resolves and guards, so a tab
 * never switches state the URL does not carry.
 *
 * The Invitations module is the Members queue under a second address: where Members is offered, the
 * Members tab stands for it and is current on `/invitations`. A hub the viewer reaches only one module
 * of draws no hub strip.
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
	/**
	 * The reader's last reading of the Members people (`people` · `chart`), when the client knows it —
	 * the Members tab then returns them to the org chart they left. `null` on the server.
	 */
	reading?: string | null;
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
 * The hub strip for the module being rendered, or `null` when the hub would be a single tab: no hub,
 * or a hub of which the viewer may open one module only.
 */
export function hubTabs(input: HubTabsInput): HubTabStrip | null {
	const hub = viewerHubOf(input.kind, input.capabilities, input.module);
	if (!hub) return null;
	const modules = stripModules(hub);
	if (modules.length < 2) return null;

	const tabs: HubTab[] = modules.map((module) => {
		const base = workspaceHref(input.kind, input.handle, module);
		const label = hub.modules.find((m) => m.key === module)?.label ?? module;
		return { key: module, label, href: `${base}${readingSearch(input, module)}`, module };
	});

	return { title: hub.label, tabs, active: activeTab(tabs, input.module) };
}

/** The query a tab's address carries: the Members org chart the reader left, else nothing. */
function readingSearch(input: HubTabsInput, module: ModuleKey): string {
	if (module !== "members" || input.reading !== MEMBERS_CHART) return "";
	return subViewSearch("", subViewsFor("members", input.kind, input.capabilities), MEMBERS_CHART);
}

/** The current tab: the rendered module — `/invitations` reads as the Members tab. */
function activeTab(tabs: readonly HubTab[], module: ModuleKey): number {
	const aliased = module === "invitations" && tabs.some((t) => t.module === "members");
	const at = tabs.findIndex((t) => t.module === (aliased ? "members" : module));
	return at < 0 ? 0 : at;
}
// #endregion
