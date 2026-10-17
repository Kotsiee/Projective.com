import type { MetaLineEntry } from "@ui/display/core/meta-line.tsx";
import {
	type IncomingInvite,
	kindCopy,
	roleLabel,
	type WorkspaceCapability,
	type WorkspaceDetail,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceStatus,
	type WorkspaceSummary,
} from "@projective/types/workspace";
import {
	type ModuleKey,
	primaryModules,
	secondaryModules,
	type WorkspaceModule,
} from "./module-registry.tsx";
import { countLabel, filterRoster, type RosterTab } from "./workspace-model.ts";

/**
 * lane-model — the workspace lane's composition as a pure function of what the viewer is looking at
 * (Teams work order L1).
 *
 * The lane has exactly four zones, top to bottom, and the same order is its Tab order:
 *
 *   1. **Header strip** — on the roster index the kind's title and a count line; inside a console the
 *      entity's mark, name, `@handle` and lifecycle `Tag`, and the acting switch.
 *   2. **Primary views** — the viewer's entities (owned first) on the index; inside a console the
 *      registry's primary modules in order, then a "More" section holding every other module the
 *      viewer may open.
 *   3. **Context controls** — only when the current view has something to partition; otherwise the
 *      zone does not exist, so the lane never draws an empty band.
 *   4. **Docked footer rig** — at most ONE create action (the tier-2 `LaneCreateButton`): "New team"
 *      on the index, "Invite member" inside a console for an `invite_members` holder, and nothing at
 *      all for anybody else — never a control that cannot act.
 *
 * Everything that decides those zones lives here and nowhere in the island, so the expanded lane, the
 * collapsed rail and the tests all read one answer. The capabilities are always the server-resolved
 * `viewerCapabilities`, and the module lists are the registry's own `primaryModules` /
 * `secondaryModules` — this file adds an order and a shape, never a second permission rule.
 *
 * Pure: no signals, no DOM, no storage access. Teams and Businesses share it (Decision #61); the only
 * kind-specific facts are the registry's primary sets (Decision #228 (C) · #232) and the copy table.
 */

// #region Vocabulary
/** The four zones in render — and therefore Tab — order. */
export type LaneZoneId = "header" | "views" | "context" | "footer";

/** One option of a zone's segmented control. */
export interface LaneOption {
	value: string;
	label: string;
}

/** Z1 on the roster index: the title register and a count line. */
export interface RosterHeaderZone {
	mode: "roster";
	/** The kind's plural ("Teams") — set in the title register. */
	title: string;
	/** `3 teams · 1 invitation` — every figure tabular; the invitation part only when one is waiting. */
	meta: MetaLineEntry[];
}

/** The lifecycle `Tag` in a console's header strip — the strip's one container (§B.11). */
export interface LaneStatusTag {
	label: string;
	severity: "warning" | "success" | "secondary";
}

/** What the acting switch says, in every state it can be in. */
export interface ContextSwitchCopy {
	/** `enter` acts as the entity; `exit` returns to acting personally. */
	action: "enter" | "exit";
	/** The visible label — "Act as team" / "Stop acting". */
	label: string;
	/**
	 * The accessible name: the visible label first (WCAG 2.5.3, label in name), then the entity the
	 * label leaves implicit.
	 */
	ariaLabel: string;
	/** What the control says while the switch is in flight — the destination, never the origin. */
	busyLabel: string;
}

/** Z1 inside a console. */
export interface ConsoleHeaderZone {
	mode: "console";
	/** The way back to the roster index. */
	back: { href: string; label: string };
	status: LaneStatusTag;
	switchControl: ContextSwitchCopy;
}

/** Z2 on the roster index — its rows come from {@link laneRosterList}. */
export interface RosterViewsZone {
	mode: "roster";
}

/** Z2 inside a console. */
export interface ConsoleViewsZone {
	mode: "console";
	/** The registry's primary views the viewer may open, in their order. */
	primary: WorkspaceModule[];
	/** Every other module the viewer may open, in registry order — the "More" section. */
	more: WorkspaceModule[];
	/** The module being rendered, or `null` when the path names none. */
	active: ModuleKey | null;
	/** Whether the active module sits in "More" — the section then opens so the reader can see where they are. */
	activeInMore: boolean;
}

/** Which view a Z3 control partitions. */
export type LaneContextControl = "roster" | "members";

/** Z3 — a segmented control (and, on the roster, a search field) over the current view. */
export interface LaneContextZone {
	control: LaneContextControl;
	/** The control's accessible name. */
	label: string;
	options: LaneOption[];
	/** Whether a `LaneSearch` rides with the control. */
	search: boolean;
}

/** The one create action Z4 can hold. */
export type LaneCreate =
	| { action: "create"; label: string }
	| {
		action: "invite";
		label: string;
		/**
		 * Whether the invite modal is mounted on this page (the Members screen mounts it), so the action
		 * is a button that opens it. Elsewhere the action is a LINK to Members with the modal open
		 * (`?invite=1`) — a destination is an `<a>`, never a button that assigns `location`.
		 */
		inPlace: boolean;
		/** Where the action links when it is not in place. */
		href: string;
	};

/** Z4 — the docked footer rig. The collapse toggle is always there; the create action may not be. */
export interface LaneFooterZone {
	create: LaneCreate | null;
}

/** The whole lane. */
export interface LaneZones {
	header: RosterHeaderZone | ConsoleHeaderZone;
	views: RosterViewsZone | ConsoleViewsZone;
	/** `null` when the view has no context controls — Z3 is then not drawn at all. */
	context: LaneContextZone | null;
	footer: LaneFooterZone;
}

/** The roster index's lane. */
export interface RosterLaneZones extends LaneZones {
	header: RosterHeaderZone;
	views: RosterViewsZone;
}

/** A console's lane. */
export interface ConsoleLaneZones extends LaneZones {
	header: ConsoleHeaderZone;
	views: ConsoleViewsZone;
}

/** The roster index's lane inputs. */
export interface RosterLaneInput {
	view: "roster";
	kind: WorkspaceKind;
	/** Entities that are not archived — what the count line counts. */
	liveCount: number;
	/** Invitations awaiting the viewer. */
	invitationCount: number;
	/** Whether the viewer may create another entity of this kind (the roster's `canCreate`). */
	canCreate: boolean;
}

/** A console's lane inputs. */
export interface ConsoleLaneInput {
	view: "console";
	kind: WorkspaceKind;
	name: string;
	handle: string;
	status: WorkspaceStatus;
	/** Whether the session is acting as this entity (`WorkspaceDetail.isActing`). */
	acting: boolean;
	/** The server-resolved effective capabilities (`WorkspaceDetail.viewerCapabilities`). */
	capabilities: readonly WorkspaceCapability[];
	/** The module being rendered. */
	module: ModuleKey | null;
	/** The module's resolved `?view=` sub-view, when it has one (Members: `all` · `pending`). */
	subView: string | null;
}
// #endregion

// #region Zone composition
/** The partitions the lane's roster control offers — the canvas's tab set minus Archived. */
export type LanePartition = Exclude<RosterTab, "archived">;

/** The roster partition control's segments — the canvas's tab set minus Archived, which stays a canvas tab. */
export const ROSTER_PARTITIONS: readonly LaneOption[] = [
	{ value: "all", label: "All" },
	{ value: "owned", label: "Owned" },
	{ value: "member", label: "Member" },
	{ value: "invitations", label: "Invitations" },
];

/**
 * The lane's reading of the shared roster partition. The partition is one value across the lane and
 * the canvas (`rosterTab`), and the canvas also offers **Archived**, which the lane's segmented control
 * does not: a lane that took Archived would list rows under a control with no segment selected and a
 * Reset for a filter it cannot show. Archived therefore reads as **All** here — the lane is the live
 * switcher, the canvas the place an archived entity is found — so the lane's list always matches a
 * visible segment, whichever root picked the partition or whatever `?tab=` the page loaded with.
 */
export function lanePartition(tab: RosterTab): LanePartition {
	return tab === "archived" ? "all" : tab;
}

/** The Members view's readings: the people (cards or table, by zoom) or the org chart. */
export const MEMBERS_READINGS: readonly LaneOption[] = [
	{ value: "people", label: "People" },
	{ value: "chart", label: "Org chart" },
];

/**
 * The four zones for what the viewer is looking at. Total: every input yields a composition, and Z3 is
 * `null` rather than an empty band whenever the view has nothing to partition.
 */
export function laneZones(input: RosterLaneInput): RosterLaneZones;
export function laneZones(input: ConsoleLaneInput): ConsoleLaneZones;
export function laneZones(input: RosterLaneInput | ConsoleLaneInput): LaneZones;
export function laneZones(input: RosterLaneInput | ConsoleLaneInput): LaneZones {
	const copy = kindCopy(input.kind);

	if (input.view === "roster") {
		const meta: MetaLineEntry[] = [{
			text: countLabel(input.kind, input.liveCount),
			tabular: true,
		}];
		if (input.invitationCount > 0) {
			meta.push({
				text: `${input.invitationCount} invitation${input.invitationCount === 1 ? "" : "s"}`,
				tabular: true,
			});
		}
		return {
			header: { mode: "roster", title: copy.Plural, meta },
			views: { mode: "roster" },
			context: {
				control: "roster",
				label: `Show ${copy.plural}`,
				options: [...ROSTER_PARTITIONS],
				search: true,
			},
			footer: { create: input.canCreate ? { action: "create", label: `New ${copy.noun}` } : null },
		};
	}

	const primary = primaryModules(input.kind, input.capabilities);
	const more = secondaryModules(input.kind, input.capabilities);
	return {
		header: {
			mode: "console",
			back: { href: copy.base, label: `All ${copy.plural}` },
			status: statusTag(input.status),
			switchControl: contextSwitchCopy(input.kind, input.name, input.acting),
		},
		views: {
			mode: "console",
			primary,
			more,
			active: input.module,
			activeInMore: more.some((m) => m.key === input.module),
		},
		context: consoleContext(input),
		footer: { create: consoleCreate(input) },
	};
}

/**
 * The context controls a console view offers. Members partitions its people into two readings, so it
 * gets a segmented control — but only on the roster sub-view: the invitation queue (`?view=pending`)
 * has no org chart to switch to.
 *
 * Projects gets none yet: its body hands off to `/projects` and has no Active · Proposals partition of
 * its own, and a segmented control over a body that ignores it would reach nothing (§3.11). The entry
 * belongs here the day that body grows one.
 */
function consoleContext(input: ConsoleLaneInput): LaneContextZone | null {
	if (input.module === "members" && input.subView !== "pending") {
		return {
			control: "members",
			label: "Show members as",
			options: [...MEMBERS_READINGS],
			search: false,
		};
	}
	return null;
}

/** The console's one create action — Invite member, for an `invite_members` holder only. */
function consoleCreate(input: ConsoleLaneInput): LaneCreate | null {
	if (!input.capabilities.includes("invite_members")) return null;
	return {
		action: "invite",
		label: "Invite member",
		inPlace: input.module === "members" || input.module === "invitations",
		href: `${workspaceHref(input.kind, input.handle, "members")}?invite=1`,
	};
}

/** The lifecycle status as a `Tag`'s words and tone. */
export function statusTag(status: WorkspaceStatus): LaneStatusTag {
	if (status === "draft") return { label: "Draft", severity: "warning" };
	if (status === "archived") return { label: "Archived", severity: "secondary" };
	return { label: "Active", severity: "success" };
}

/**
 * The acting switch's copy. Entering a console is not acting as the entity, so the switch says which
 * of the two the press does, and while it is in flight it names the DESTINATION.
 */
export function contextSwitchCopy(
	kind: WorkspaceKind,
	name: string,
	acting: boolean,
): ContextSwitchCopy {
	const noun = kindCopy(kind).noun;
	return acting
		? {
			action: "exit",
			label: "Stop acting",
			ariaLabel: `Stop acting as ${name}`,
			busyLabel: "Switching back to you…",
		}
		: {
			action: "enter",
			label: `Act as ${noun}`,
			ariaLabel: `Act as ${noun}: ${name}`,
			busyLabel: `Switching to ${name}…`,
		};
}

/**
 * The zones a composition draws, in render order — Z3 only when it exists. The island renders exactly
 * this list as the lane's children, one zone per entry, so it is also the Tab order (the source scan in
 * `lane-model.test.ts` pins that each zone's controls live in its own entry).
 */
export function laneZoneOrder(zones: LaneZones): LaneZoneId[] {
	return zones.context ? ["header", "views", "context", "footer"] : ["header", "views", "footer"];
}
// #endregion

// #region Roster rows
/** What Z2 lists on the roster index for a partition. */
export type RosterList =
	| { mode: "entities"; rows: WorkspaceSummary[] }
	| { mode: "invitations"; rows: IncomingInvite[] };

/**
 * The roster lane's rows for a partition and a search term. Entities are the canvas's own partition
 * (`filterRoster`, so the lane and the cards never disagree), with the viewer's OWNED entities first —
 * each group keeps the server's order. The Invitations partition lists the invitations instead.
 */
export function laneRosterList(
	items: readonly WorkspaceSummary[],
	invitations: readonly IncomingInvite[],
	tab: RosterTab,
	search = "",
): RosterList {
	const needle = search.trim().toLowerCase();
	if (tab === "invitations") {
		return {
			mode: "invitations",
			rows: invitations.filter((invite) =>
				!needle ||
				invite.workspaceName.toLowerCase().includes(needle) ||
				invite.workspaceHandle.toLowerCase().includes(needle)
			),
		};
	}
	const rows = filterRoster(items, tab, search);
	return {
		mode: "entities",
		rows: [...rows.filter((r) => r.isOwner), ...rows.filter((r) => !r.isOwner)],
	};
}

/** The status as a word — a lane row's last fact (§B.11: metadata is text, not a chip). */
export function statusWord(status: WorkspaceStatus): string {
	return statusTag(status).label;
}

/** One entity row's facts: `Owner · 4 members · Active`, the count tabular. */
export function laneEntityMeta(entity: WorkspaceSummary): MetaLineEntry[] {
	return [
		roleLabel(entity.role),
		{
			text: `${entity.memberCount} member${entity.memberCount === 1 ? "" : "s"}`,
			tabular: true,
		},
		statusWord(entity.status),
	];
}

/** One invitation row's facts: the offered role and when it was sent. */
export function laneInviteMeta(invite: IncomingInvite): MetaLineEntry[] {
	return [`Invited as ${invite.roleLabel}`, invite.sentAt];
}

/**
 * The collapsed rail's entity marks on the roster index: the expanded list's order (owned first, then
 * the server's order) over the live entities, ignoring the partition and the search. Z3 folds away in
 * the rail, so a filter applied there would hide entities for a reason the reader cannot see — the rail
 * is the unfiltered switcher, in the same order as the expanded "All".
 */
export function laneRailEntities(items: readonly WorkspaceSummary[]): WorkspaceSummary[] {
	const list = laneRosterList(items, [], "all");
	return list.mode === "entities" ? list.rows : [];
}

/** Whether the roster's context controls hold anything the reset would clear. */
export function rosterFiltered(tab: LanePartition, search: string): boolean {
	return tab !== "all" || search.trim().length > 0;
}
// #endregion

// #region Module signals
/**
 * A per-module mark on its row. A **count** is a queue whose size is the useful fact (invitations to
 * answer, spend requests to decide); a **dot** is "something here wants you" where a number would
 * mislead (§B.6 · §D.1).
 */
export interface ModuleSignal {
	dot?: boolean;
	count?: number;
}

/** Signals by module key. An absent key draws no mark. */
export type ModuleSignals = Partial<Record<ModuleKey, ModuleSignal>>;

/**
 * What needs attention, per module — computed once and shared by the expanded lane and the collapsed
 * rail so the two can never disagree. Nothing merely large gets a mark: a module is not "attention"
 * because it holds a lot.
 */
export function laneSignals(
	detail: Pick<WorkspaceDetail, "invites" | "spend" | "verification">,
): ModuleSignals {
	const out: ModuleSignals = {};
	if (detail.invites.length > 0) out.invitations = { count: detail.invites.length };
	const awaitingDecision = detail.spend?.approvals.pending.length ?? 0;
	if (awaitingDecision > 0) out.spend = { count: awaitingDecision };
	if (detail.verification !== "verified") out.verification = { dot: true };
	return out;
}

/**
 * The verification state's WORDS (`KYC needed`), so the meaning survives a colour-blind palette and
 * greyscale — the rail mark's ring colour alone is not a channel.
 */
export function verificationWords(
	kind: WorkspaceKind,
	state: WorkspaceDetail["verification"],
): string {
	const instrument = kindCopy(kind).verification;
	if (state === "verified") return `${instrument} verified`;
	if (state === "pending") return `${instrument} in review`;
	return `${instrument} needed`;
}

/** The words a module's mark stands for — folded into the row's accessible name. */
export function signalLabel(signal: ModuleSignal | undefined): string | null {
	if (!signal) return null;
	if (signal.count && signal.count > 0) return `${signal.count} waiting`;
	return signal.dot ? "needs attention" : null;
}

/** Whether any module in a group carries a mark — the collapsed "More" header shows a dot then. */
export function groupHasSignal(
	modules: readonly Pick<WorkspaceModule, "key">[],
	signals: ModuleSignals,
): boolean {
	return modules.some((m) => signalLabel(signals[m.key]) !== null);
}
// #endregion

// #region "More" open state
/**
 * The "More" memory is ONE `localStorage` value (`LocalKeys.WORKSPACE_LANE_MORE`) holding a JSON map
 * from a partition to `true` (open) or `false` (closed). The `StorageKey` union is closed, so a
 * per-viewer key literal cannot be minted; the partition lives inside the value instead (the projects
 * filter cache's pattern), and the island reads and writes it through the SSR-safe `readStored` /
 * `writeStored` accessors.
 */
type MoreMemory = Record<string, boolean>;

/**
 * The partition that remembers whether one viewer keeps "More" open on one kind's consoles. The viewer
 * is their `@handle` when the console carries it, else their member id.
 */
export function laneMorePartition(kind: WorkspaceKind, viewer: string): string {
	return `${kind}.${viewer}`;
}

/** The stored map, or an empty one for anything unset, unparsable or not a map of booleans. */
function readMoreMemory(raw: string | null): MoreMemory {
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const out: MoreMemory = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "boolean") out[key] = value;
		}
		return out;
	} catch {
		return {};
	}
}

/** One partition's remembered "More" state from the stored value: open, closed, or unknown (`null`). */
export function parseMoreOpen(raw: string | null, partition: string): boolean | null {
	return readMoreMemory(raw)[partition] ?? null;
}

/** The stored value with one partition's "More" state set — every other partition kept as it was. */
export function withMoreOpen(raw: string | null, partition: string, open: boolean): string {
	return JSON.stringify({ ...readMoreMemory(raw), [partition]: open });
}

/**
 * Whether "More" opens. Collapsed by default; a viewer's remembered choice wins; and it always opens
 * onto the module being rendered, so the current place is never hidden inside a closed section.
 */
export function initialMoreOpen(stored: boolean | null, activeInMore: boolean): boolean {
	return activeInMore || stored === true;
}
// #endregion
