import type { MetaLineEntry } from "@ui/display/core/meta-line.tsx";
import type { MenuItem } from "@ui/types/mod.ts";
import { composeMenu, linkActionItems } from "@ui/navigation/core/link-actions.ts";
import {
	kindCopy,
	type WorkspaceCapability,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceStatus,
} from "@projective/types/workspace";
import { type SubView, subViewIndex } from "./sub-views.ts";

/**
 * header-model — the workspace header band as a pure function of what the viewer is looking at
 * (Teams work order L2; Decision #220's three-region band).
 *
 * The band has three regions, start to end:
 *
 *   1. **Identity** — the module's title in the title register over one meta line (the entity's
 *      name and `@handle`, and the acting state), so whose console this is is never a guess.
 *   2. **Sub-views** — the module's `TabMenu`, centred, only when the module partitions its body
 *      (`sub-views.ts`).
 *   3. **Actions** — at most ONE filled control (the module's commit, which the module publishes
 *      through `workspace-state`), then the tier-4 utilities, then the kebab, which carries the rest.
 *
 * The Button Interaction Matrix (§B.8.1) is enforced here, not in the island: the commit is the only
 * action that can take a filled tier, so {@link headerFilledCount} can never exceed one. Archive is
 * offered only to an `archive_entity` holder and never on an archived entity — on a business, only
 * when the server says the archive would go through; nothing here deletes.
 *
 * Pure: no signals, no DOM, and no import of the module registry (the island passes the module's
 * label in), so `deno test` loads it directly. Teams and Businesses share it (Decision #61).
 */

// #region The Button Interaction Matrix
/**
 * A tier of the Button Interaction Matrix (§B.8.1): 1 amber money movement · 2 monochrome structural
 * creation · 3 primary workflow commit · 4 neutral outlined utility · 5 text escape hatch.
 */
export type ButtonTier = 1 | 2 | 3 | 4 | 5;

/** The tiers that fill — at most one of them per decision region. */
export type FilledTier = 1 | 2 | 3;

/** Whether a tier draws a filled button. */
export function isFilledTier(tier: ButtonTier): tier is FilledTier {
	return tier <= 3;
}
// #endregion

// #region Vocabulary
/**
 * A module's commit — the ONE filled action of the header band's end region ("Publish team" on a
 * draft's Settings). The module's own island publishes it through `workspace-state`, because the band
 * is a separate hydration root that cannot receive a callback from the body.
 */
export interface ModuleCommit {
	/** Stable key, for the rendered control. */
	key: string;
	/** The action, as words. */
	label: string;
	/** Its filled tier: 1 only for money movement, 2 for structural creation, 3 for a workflow commit. */
	tier: FilledTier;
	/** While the commit is in flight — the control shows progress and does not take a second press. */
	busy?: boolean;
	/** Refused for now — the control stays, so the path is discoverable, and does not activate. */
	disabled?: boolean;
	/** Run it. */
	run: () => void;
}

/** A tier-4 utility in the end region. */
export interface HeaderUtility {
	key: "share-profile";
	label: string;
	tier: 4;
	/** What the utility acts on — for Share profile, the public profile it shares. */
	href: string;
}

/** What the kebab carries, before it becomes menu rows. */
export interface HeaderMenuPlan {
	/** The entity's name — carried into the share sheet and the confirm. */
	name: string;
	/** The public profile, `/@handle`. */
	profileHref: string;
	/** The text Copy handle writes: `@handle`. */
	handleText: string;
	/**
	 * Where leaving (or, for the owner, handing the seat over) lives — the Members module — or `null`
	 * on Members itself, where the viewer's own row already offers it.
	 */
	members: { href: string; label: string } | null;
	/** Whether Archive… is offered. */
	archive: boolean;
}

/** The header band's inputs. */
export interface HeaderBandInput {
	kind: WorkspaceKind;
	/** The module's label, from the registry. */
	title: string;
	/** The module's key. */
	module: string;
	name: string;
	handle: string;
	status: WorkspaceStatus;
	/** Whether the session is acting as this entity. */
	acting: boolean;
	/** Whether the viewer holds the owner seat — the Members row then reads "Hand over ownership…". */
	owner: boolean;
	/** The server-resolved effective capabilities (`WorkspaceDetail.viewerCapabilities`). */
	capabilities: readonly WorkspaceCapability[];
	/**
	 * A business's server answer to "may the viewer archive it now" (`WorkspaceDetail.viewerCan.archive`:
	 * `archive_entity`, not archived, and no archive blocker). `null`/absent for a team, whose rule is
	 * the capability, the status and {@link archiveBlocked}.
	 */
	viewerCanArchive?: boolean | null;
	/**
	 * Whether the read lists anything that would refuse an archive now (`WorkspaceDetail.archiveBlockers`
	 * non-empty, Teams C6) — a team's Archive… is then withheld, and its Settings names what to clear
	 * instead. A business reads {@link viewerCanArchive}; its Settings is a placeholder (Decision #244 (d)).
	 */
	archiveBlocked?: boolean;
	/** The module's sub-views for this viewer (`subViewsFor`). */
	subViews: readonly SubView[];
	/** The current sub-view, or `null` when the module has none. */
	view: string | null;
	/** The commit the module published, if any. */
	commit: ModuleCommit | null;
}

/** The header band. */
export interface HeaderBandModel {
	/** Set in the title register. */
	title: string;
	/** One meta line under the title. */
	meta: MetaLineEntry[];
	/** The centred TabMenu, or `null` when the module has nothing to partition. */
	tabs: { views: SubView[]; active: number } | null;
	/** The end region's one filled control. */
	commit: ModuleCommit | null;
	/** The tier-4 utilities, in order. */
	utilities: HeaderUtility[];
	/** What the kebab carries. */
	menu: HeaderMenuPlan;
	/** The kebab's (and the right-click menu's) accessible name. */
	menuLabel: string;
}
// #endregion

// #region Composition
/** The header band for what the viewer is looking at. Total: every input yields a model. */
export function headerBand(input: HeaderBandInput): HeaderBandModel {
	const copy = kindCopy(input.kind);
	const profileHref = `/@${input.handle}`;
	const meta: MetaLineEntry[] = [input.name, `@${input.handle}`];
	if (input.acting) meta.push(`Acting as ${copy.noun}`);

	return {
		title: input.title,
		meta,
		tabs: input.subViews.length > 1
			? { views: [...input.subViews], active: subViewIndex(input.subViews, input.view) }
			: null,
		commit: input.commit,
		utilities: [{ key: "share-profile", label: "Share profile", tier: 4, href: profileHref }],
		menu: {
			name: input.name,
			profileHref,
			handleText: `@${input.handle}`,
			members: input.module === "members" ? null : {
				href: workspaceHref(input.kind, input.handle, "members"),
				label: input.owner ? "Hand over ownership…" : `Leave ${copy.noun}…`,
			},
			archive: canArchive(input),
		},
		menuLabel: `${copy.Noun} actions`,
	};
}

/**
 * Whether Archive… is offered. A business asks the server, which already weighs the archive blockers
 * (a wallet balance, a held escrow) — offering a confirm the write door will refuse would promise
 * something that cannot happen. A team's rule is `archive_entity` on an entity not yet archived, with
 * nothing in the read's blocker list (a held escrow, a live assignment — Teams C6).
 */
function canArchive(input: HeaderBandInput): boolean {
	if (input.kind === "business") return input.viewerCanArchive === true;
	return input.capabilities.includes("archive_entity") && input.status !== "archived" &&
		input.archiveBlocked !== true;
}

/**
 * How many filled controls the band draws. The commit is the only action that may fill, so this is
 * never more than one (§B.8.1 — one filled button per decision region).
 */
export function headerFilledCount(model: HeaderBandModel): number {
	const commit = model.commit && isFilledTier(model.commit.tier) ? 1 : 0;
	return commit + model.utilities.filter((u) => isFilledTier(u.tier)).length;
}
// #endregion

// #region The kebab
/** What the kebab's rows do when chosen. */
export interface HeaderMenuHandlers {
	/** Write `@handle` to the clipboard. */
	copyHandle: () => void;
	/** Ask to archive — the island confirms before anything changes. */
	archive: () => void;
}

/**
 * The kebab's rows — the same rows a right-click, the ContextMenu key or Shift+F10 on the band opens
 * (Decision #222): the public profile (View, Open in new tab), Copy handle, the way to leave, and
 * Archive… for an `archive_entity` holder. The profile rows are the shared `linkActionItems`, so they
 * open, and open in a new tab, exactly as every other linkable entity's do.
 */
export function headerMenu(model: HeaderBandModel, handlers: HeaderMenuHandlers): MenuItem[] {
	const { menu } = model;
	const profile = linkActionItems({
		href: menu.profileHref,
		title: menu.name,
		include: ["open", "open-new-tab"],
	}).map((row) =>
		row.key === "link-open"
			? { ...row, key: "view-profile", label: "View public profile", icon: "user" }
			: row
	);
	return composeMenu(
		profile,
		[{
			key: "copy-handle",
			label: "Copy handle",
			hint: menu.handleText,
			icon: "copy",
			command: handlers.copyHandle,
		}],
		menu.members
			? [{ key: "members", label: menu.members.label, icon: "members", url: menu.members.href }]
			: [],
		menu.archive
			? [{
				key: "archive",
				label: "Archive…",
				hint: "Hidden from your roster; restorable",
				icon: "archive-box",
				danger: true,
				command: handlers.archive,
			}]
			: [],
	);
}
// #endregion
