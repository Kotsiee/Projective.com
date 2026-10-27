import type { VNode } from "preact";
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
	type HubKey,
	hubOf,
	hubsForViewer,
	mayViewModule,
	type ModuleKey,
	type ViewerHub,
	type WorkspaceModule,
} from "./module-registry.tsx";
import {
	countLabel,
	filterRoster,
	isFiltered,
	type LifecycleTag,
	ROSTER_TABS,
	type RosterTab,
	statusTag,
} from "./roster-model.ts";
import {
	type CatalogueKind,
	type CatalogueListParams,
	type CataloguePage,
	consoleHref,
	DEFAULT_CONSOLE_STATUSES,
	type ListingStatus,
	workspaceHref as listingWorkspaceHref,
} from "@projective/types/catalogue";
import { rosterCreateNote } from "./rig-model.ts";

/**
 * lane-model — the workspace lane's composition as a pure function of what the viewer is looking at
 * (Teams work order L1; the console zones of Decision #306).
 *
 * The lane has exactly four zones, top to bottom, and the same order is its Tab order (Decision #307
 * put the context controls above the views, as `/projects` puts its search and filters above its list):
 *
 *   1. **Header strip** — on the roster index the kind's title and a count line; inside a console Back,
 *      the entity's mark, name, `@handle`, verification crest and lifecycle `Tag`, and its kebab
 *      (`ActionMenu`).
 *   2. **Context controls** — always drawn, the find-in-lane search FIRST: on the index it filters the
 *      lane's own list, beside it the Invitations toggle (the one partition that lists invitations
 *      rather than entities, so it is set apart from the segmented control), then the All · Owned ·
 *      Member segments; inside a console it searches views, channels, projects and members, and holds
 *      nothing else — a console view's readings are switched in its footer rig (Decision #319).
 *   3. **Views** — the viewer's entities (owned first) on the index; inside a console the registry's
 *      hubs in labelled sections: Core operations (Decision #332), then Channels (the read's entity
 *      channels and a create) last, as `/projects` closes its lane on its channel tree.
 *   4. **Docked footer rig** — on the index at most ONE create action (the tier-2 `LaneCreateButton`
 *      "New team"), never a control that cannot act; a roster the viewer may not add to says why in
 *      its place, as one line of meta text. In the roster's FIRST RUN the rig holds neither: the
 *      canvas's empty state carries the one structural create (Teams R1). Below `--bp-md` the frame
 *      hides the lane, and the roster's footer rig takes over this zone's create, or its reason
 *      (`rig-model.ts`, Decision #245 (k)). Inside a console the rig is the acting switch as a pill,
 *      then the circular icon-only Invite member (for an `invite_members` holder) and Settings (for a
 *      viewer who may open a Settings hub module).
 *
 * Everything that decides those zones lives here and nowhere in the island, so the expanded lane, the
 * collapsed rail and the tests all read one answer. The capabilities are always the server-resolved
 * `viewerCapabilities`, and the hubs are the registry's own `hubsForViewer` — this file adds an order
 * and a shape, never a second permission rule.
 *
 * Pure: no signals, no DOM, no storage access. Teams and Businesses share it (Decision #61); the only
 * kind-specific facts are the registry's hubs and the copy table.
 */

// #region Vocabulary
/** The four zones in render — and therefore Tab — order. */
export type LaneZoneId = "header" | "views" | "context" | "footer";

/** One option of a zone's segmented control. */
export interface LaneOption {
	value: string;
	label: string;
}

/** The find-in-lane field the header strip carries. */
export interface LaneSearchCopy {
	/** The field's accessible name. */
	label: string;
	placeholder: string;
}

/** Z1 on the roster index: the title register and a count line. */
export interface RosterHeaderZone {
	mode: "roster";
	/** The kind's plural ("Teams") — set in the title register. */
	title: string;
	/** `3 teams · 1 invitation` — every figure tabular; the invitation part only when one is waiting. */
	meta: MetaLineEntry[];
}

/**
 * The lifecycle `Tag` in a console's header strip — the strip's one container (§B.11). The roster's
 * own lifecycle vocabulary (`roster-model.ts`), so a card, a table row and the strip word a status
 * alike.
 */
export type LaneStatusTag = LifecycleTag;

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
	/** The kebab's accessible name ("Team actions"). */
	menuLabel: string;
}

/** Z3 on the roster index — its rows come from {@link laneRosterList}. */
export interface RosterViewsZone {
	mode: "roster";
}

/** One hub as a lane row: where it links, whether it is current, and the modules its signal folds. */
export interface LaneHubRow {
	key: HubKey;
	label: string;
	glyph: VNode;
	/** The first module of the hub the viewer may open. */
	href: string;
	/** Whether the module being rendered belongs to it. */
	active: boolean;
	/** The modules the viewer may open in it — what {@link hubSignal} folds. */
	modules: readonly Pick<WorkspaceModule, "key">[];
	/** One line for the collapsed rail's tooltip. */
	blurb: string;
}

/** A labelled section of hub rows. */
export interface LaneHubSection {
	id: "operations";
	/** The section header, in the lane's section register. */
	label: string;
	rows: LaneHubRow[];
}

/** The Channels section: the entity's channels come from the read; the zone says where they live. */
export interface LaneChannelsZone {
	label: string;
	/** `/teams/:h/channels` — a channel's address is this plus `/<slug>`. */
	base: string;
	/** The channel being rendered, or `null`. */
	active: string | null;
	/** The create control's words — every active member of a live entity may add a channel. */
	createLabel: string;
	/** Whether a channel may be created here: not on an archived entity. */
	canCreate: boolean;
}

/**
 * The Catalogue section (a team's, Decision #316): its title is the Catalogue hub's link, its rows are
 * the team's listings from a catalogue read, and its "+" opens the create modal.
 */
export interface LaneCatalogueZone {
	/** The Catalogue hub as a row — the title's link, the collapsed rail's square and a search hit. */
	row: LaneHubRow;
	/** The team's handle — scopes the listings read and every listing's address. */
	team: string;
	/** The listing being rendered (its slug) on `/teams/:h/catalogue/:slug…`, else `null`. */
	listing: string | null;
	/** Whether the console itself is being rendered, so the title is the current page. */
	current: boolean;
	/** The create control's words. */
	createLabel: string;
	/** Whether the create modal is mounted on this page (the console), so "+" opens it in place. */
	createInPlace: boolean;
	/** Where "+" links from every other page: the console with the create modal open. */
	createHref: string;
	/** Whether a listing may be created here: not on an archived team. */
	canCreate: boolean;
}

/** Z3 inside a console. */
export interface ConsoleViewsZone {
	mode: "console";
	/** Core operations (Members · Wallet · Analytics included, Decision #332) — left out with no row. */
	sections: LaneHubSection[];
	/**
	 * The Catalogue section, drawn after Core operations and before Channels. `null` for a business and for
	 * a member without the catalogue gate (`catalogue-gate.ts`).
	 */
	catalogue: LaneCatalogueZone | null;
	/**
	 * The Channels section, drawn LAST, after Catalogue. `null` when the viewer may not open Channels
	 * (never, today — it is permissionless).
	 */
	channels: LaneChannelsZone | null;
	/** The hub being rendered, or `null` on a channel or a path naming none. */
	activeHub: HubKey | null;
}

/** Which view a Z2 segmented control partitions — the roster's alone (Decision #319). */
export type LaneContextControl = "roster";

/** A segmented control over the current view. */
export interface LanePartitionControl {
	control: LaneContextControl;
	/** The control's accessible name. */
	label: string;
	options: LaneOption[];
}

/**
 * The roster's Invitations partition as its own icon-first toggle beside the search — set apart from
 * the segmented control because it lists invitations addressed to the viewer, not entities.
 */
export interface LaneInvitationsToggle {
	/** The toggle's accessible name and tooltip. */
	label: string;
	/** Invitations waiting on the viewer — drawn as the toggle's dot, never a count (§D.1). */
	waiting: number;
}

/** Z2 — the search, first, then whatever the current view offers to narrow it. Always drawn. */
export interface LaneContextZone {
	search: LaneSearchCopy;
	/** The roster's segmented control; `null` inside a console. */
	partition: LanePartitionControl | null;
	/** The roster's Invitations toggle; `null` inside a console. */
	invitations: LaneInvitationsToggle | null;
}

/** The one create action Z4 can hold. */
export type LaneCreate =
	| { action: "create"; label: string }
	| {
		/**
		 * Invite member — always a button that opens the invite modal in place: the module's screen or
		 * the lane mounts it on every console page (`screenHostsInvite`, Decision #318).
		 */
		action: "invite";
		label: string;
	};

/** Z4 — the docked footer rig. The collapse toggle is always there; the create action may not be. */
export interface LaneFooterZone {
	create: LaneCreate | null;
	/**
	 * Why the roster offers no create action — the plan's own reason — set exactly when the viewer may
	 * not add another entity. The button is withheld (never a dead control), so this line is the only
	 * place the lane says why; `null` whenever a create renders and everywhere inside a console.
	 */
	note: string | null;
}

/** Z4 inside a console: the acting switch, then the two circular utilities. */
export interface ConsoleFooterZone extends LaneFooterZone {
	/** The acting switch, drawn as a compact pill. */
	actAs: ContextSwitchCopy;
	/** Invite member, for an `invite_members` holder only. */
	invite: Extract<LaneCreate, { action: "invite" }> | null;
	/** The Settings hub, for a viewer who may open one of its modules. */
	settings: LaneHubRow | null;
}

/** The whole lane. */
export interface LaneZones {
	header: RosterHeaderZone | ConsoleHeaderZone;
	views: RosterViewsZone | ConsoleViewsZone;
	context: LaneContextZone;
	footer: LaneFooterZone | ConsoleFooterZone;
}

/** The roster index's lane. */
export interface RosterLaneZones extends LaneZones {
	header: RosterHeaderZone;
	views: RosterViewsZone;
	footer: LaneFooterZone;
}

/** A console's lane. */
export interface ConsoleLaneZones extends LaneZones {
	header: ConsoleHeaderZone;
	views: ConsoleViewsZone;
	footer: ConsoleFooterZone;
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
	/** The roster's `createBlockedReason` — the plan's words for why `canCreate` is false. */
	createBlockedReason?: string | null;
	/**
	 * The roster's first run (`roster-model.ts` `isFirstRun`): no entity of this kind and nothing to
	 * answer. The canvas's empty state then holds the create, so the rig holds none.
	 */
	firstRun?: boolean;
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
	/** The channel being rendered (its slug) on a `channels` route, else `null`/absent. */
	channel?: string | null;
	/** The listing being rendered (its slug) on a `catalogue` route, else `null`/absent. */
	listing?: string | null;
}
// #endregion

// #region Zone composition
/** The partitions the lane can show — the canvas's set minus Archived. */
export type LanePartition = Exclude<RosterTab, "archived">;

/**
 * The roster's segmented control — the canvas's own partitions (`ROSTER_TABS`) minus Archived, which
 * stays the canvas's, and minus Invitations, which the lane draws as its own toggle beside the search
 * ({@link LaneInvitationsToggle}). The words are the canvas's, so the two controls over the one
 * partition never disagree on a label.
 */
export const ROSTER_PARTITIONS: readonly LaneOption[] = ROSTER_TABS
	.filter((tab) => tab.value !== "archived" && tab.value !== "invitations")
	.map(({ value, label }) => ({ value, label }));

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

/**
 * The four zones for what the viewer is looking at. Total: every input yields a composition. Z2 always
 * carries the search; its segmented control is `null` whenever the view has nothing to partition.
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
			header: {
				mode: "roster",
				title: copy.Plural,
				meta,
			},
			views: { mode: "roster" },
			context: {
				search: { label: `Search ${copy.plural}`, placeholder: `Find a ${copy.noun}…` },
				partition: {
					control: "roster",
					label: `Show ${copy.plural}`,
					options: [...ROSTER_PARTITIONS],
				},
				invitations: { label: "Invitations", waiting: input.invitationCount },
			},
			footer: rosterFooter(input),
		};
	}

	const rows = hubRows(input);
	const sections: LaneHubSection[] = [
		{ id: "operations" as const, label: "Core operations", rows: rows.operations },
	].filter((s) => s.rows.length > 0);
	const onChannel = input.module === "channels";
	return {
		header: {
			mode: "console",
			back: { href: copy.base, label: `Back to all ${copy.plural}` },
			status: statusTag(input.status),
			menuLabel: `${copy.Noun} actions`,
		},
		views: {
			mode: "console",
			sections,
			catalogue: rows.catalogue ? catalogueZone(input, rows.catalogue) : null,
			channels: mayViewModule("channels", input.kind, input.capabilities)
				? {
					label: "Channels",
					base: workspaceHref(input.kind, input.handle, "channels"),
					active: onChannel ? (input.channel ?? null) : null,
					createLabel: "New channel",
					canCreate: input.status !== "archived",
				}
				: null,
			activeHub: onChannel ? null : hubOf(input.module)?.key ?? null,
		},
		context: {
			search: { label: `Search ${input.name}`, placeholder: "Find views, channels, people…" },
			partition: null,
			invitations: null,
		},
		footer: {
			create: null,
			note: null,
			actAs: contextSwitchCopy(input.kind, input.name, input.acting),
			invite: consoleInvite(input),
			settings: rows.settings,
		},
	};
}

/** The viewer's hubs as lane rows, split by zone; Catalogue and Settings are one hub each. */
function hubRows(
	input: ConsoleLaneInput,
): {
	operations: LaneHubRow[];
	catalogue: LaneHubRow | null;
	settings: LaneHubRow | null;
} {
	const active = input.module === "channels" ? null : hubOf(input.module)?.key ?? null;
	const toRow = (hub: ViewerHub): LaneHubRow => ({
		key: hub.hub.key,
		label: hub.label,
		glyph: hub.hub.glyph,
		href: workspaceHref(input.kind, input.handle, hub.modules[0].key),
		active: hub.hub.key === active,
		modules: hub.modules.map((m) => ({ key: m.key })),
		blurb: hub.hub.blurb,
	});
	const hubs = hubsForViewer(input.kind, input.capabilities);
	const catalogue = hubs.find((h) => h.hub.zone === "catalogue");
	const settings = hubs.find((h) => h.hub.zone === "footer");
	return {
		operations: hubs.filter((h) => h.hub.zone === "operations").map(toRow),
		catalogue: catalogue ? toRow(catalogue) : null,
		settings: settings ? toRow(settings) : null,
	};
}

/**
 * The Catalogue section for the hub row the viewer may open. "+" opens the create modal in place on
 * the console, where it is mounted, and links to the console with it open (`?create=1`) everywhere
 * else — a destination is an `<a>`, never a button that assigns `location`.
 */
function catalogueZone(input: ConsoleLaneInput, row: LaneHubRow): LaneCatalogueZone {
	const listing = input.module === "catalogue" ? input.listing ?? null : null;
	const current = input.module === "catalogue" && listing === null;
	return {
		row,
		team: input.handle,
		listing,
		current,
		createLabel: "New listing",
		createInPlace: current,
		createHref: consoleHref({ team: input.handle, createOpen: true }),
		canCreate: input.status !== "archived",
	};
}

/**
 * Z4 on the roster index: New entity while the plan admits one, else the plan's reason — and in first
 * run neither, because the canvas's empty state carries the one structural create (and that reason)
 * then; a second create beside it would put two structural commits on one page.
 */
function rosterFooter(input: RosterLaneInput): LaneFooterZone {
	if (input.firstRun) return { create: null, note: null };
	return input.canCreate
		? { create: { action: "create", label: `New ${kindCopy(input.kind).noun}` }, note: null }
		: { create: null, note: rosterCreateNote(input.kind, input.createBlockedReason) };
}

/** The footer's Invite member, for an `invite_members` holder only. */
function consoleInvite(input: ConsoleLaneInput): Extract<LaneCreate, { action: "invite" }> | null {
	if (!input.capabilities.includes("invite_members")) return null;
	return { action: "invite", label: "Invite member" };
}

/** The lifecycle status as a `Tag`'s words and tone (`roster-model.ts`). */
export { statusTag };

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
 * The zones a composition draws, in render order. The island renders exactly this list as the lane's
 * children, one zone per entry, so it is also the Tab order (the source scan in `lane-model.test.ts`
 * pins that each zone's controls live in its own entry).
 */
export function laneZoneOrder(_zones: LaneZones): LaneZoneId[] {
	return ["header", "context", "views", "footer"];
}
// #endregion

// #region Roster rows
/** What Z3 lists on the roster index for a partition. */
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
 * the server's order) over the live entities, ignoring the partition and the search. Z2 folds away in
 * the rail, so a filter applied there would hide entities for a reason the reader cannot see — the rail
 * is the unfiltered switcher, in the same order as the expanded "All".
 */
export function laneRailEntities(items: readonly WorkspaceSummary[]): WorkspaceSummary[] {
	const list = laneRosterList(items, [], "all");
	return list.mode === "entities" ? list.rows : [];
}

/**
 * Whether the roster's context controls hold anything the reset would clear — the canvas's own rule
 * (`isFiltered`), so the lane's Reset and the canvas's Clear filters appear over the same states.
 */
export function rosterFiltered(tab: LanePartition, search: string): boolean {
	return isFiltered(tab, search);
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

/** Whether any module in a group carries a mark. */
export function groupHasSignal(
	modules: readonly Pick<WorkspaceModule, "key">[],
	signals: ModuleSignals,
): boolean {
	return modules.some((m) => signalLabel(signals[m.key]) !== null);
}

/**
 * A hub row's mark — its modules' marks folded: the queues' counts summed, else a dot when any module
 * wants attention, else none.
 */
export function hubSignal(
	modules: readonly Pick<WorkspaceModule, "key">[],
	signals: ModuleSignals,
): ModuleSignal | undefined {
	const count = modules.reduce((sum, m) => sum + (signals[m.key]?.count ?? 0), 0);
	if (count > 0) return { count };
	return modules.some((m) => signals[m.key]?.dot) ? { dot: true } : undefined;
}

/** A channel's unread mark — a plain count, folded into the row's accessible name. */
export function channelUnreadLabel(unread: number): string | null {
	if (unread <= 0) return null;
	return `${unread} unread`;
}
// #endregion

// #region Catalogue listings
/** One listing as the Catalogue section lists it — the lane's projection of a `ListingSummary`. */
export interface LaneListing {
	/** The listing's `svc-…` / `prd-…` slug — its address. */
	id: string;
	title: string;
	kind: CatalogueKind;
	status: ListingStatus;
	cover: string | null;
	needsAttention: boolean;
}

/** The team's listings as the lane holds them: the first page, and how many the console lists. */
export interface LaneListings {
	items: LaneListing[];
	total: number;
}

/**
 * The Catalogue section's read. A failure is never drawn as an empty catalogue: "no listings yet" is a
 * claim about the team's work, and a false one when the truth is that it could not be read.
 */
export type LaneListingsRead =
	| { ok: true; listings: LaneListings }
	| { ok: false; message: string };

/** How many listings the section lists before it hands the rest to the console. */
export const LANE_LISTING_LIMIT = 20;

/**
 * The section's read: the console's resting statuses (everything but Archived), newest first, one
 * lane's worth — so its "View all" count is the count the console opens on.
 */
export const LANE_LISTING_PARAMS: CatalogueListParams = {
	type: "all",
	status: [...DEFAULT_CONSOLE_STATUSES],
	sort: "recent",
	limit: LANE_LISTING_LIMIT,
};

/** Project a catalogue page onto the section's listings, keeping the lane's first page. */
export function laneListingsOf(page: Pick<CataloguePage, "items" | "total">): LaneListings {
	return {
		items: page.items.slice(0, LANE_LISTING_LIMIT).map((l) => ({
			id: l.id,
			title: l.title,
			kind: l.kind,
			status: l.status,
			cover: l.cover,
			needsAttention: l.needsAttention,
		})),
		total: page.total,
	};
}

/** One listing row as the section draws it. */
export interface LaneListingRow extends LaneListing {
	href: string;
	/** Whether this listing is the one being rendered. */
	active: boolean;
	/** The lifecycle word for a listing that is not live ("Draft" · "Paused"), else `null`. */
	state: string | null;
}

/** The section's rows, and the console link that stands in for the listings it leaves out. */
export interface LaneListingRows {
	rows: LaneListingRow[];
	/** "View all 34 listings" when the console lists more than the lane, else `null`. */
	more: { label: string; href: string } | null;
}

const LISTING_STATE: Record<ListingStatus, string | null> = {
	published: null,
	draft: "Draft",
	paused: "Paused",
	archived: "Archived",
};

/** The section's rows for a read, each linking to its listing in the team's item workspace. */
export function laneListingRows(listings: LaneListings, zone: LaneCatalogueZone): LaneListingRows {
	const rows = listings.items.map((l) => ({
		...l,
		href: listingWorkspaceHref(l.id, { team: zone.team }),
		active: l.id === zone.listing,
		state: LISTING_STATE[l.status],
	}));
	const more = listings.total > rows.length
		? { label: `View all ${listings.total} listings`, href: zone.row.href }
		: null;
	return { rows, more };
}
// #endregion

// #region Console search
/** One search hit. */
export interface LaneSearchHit {
	key: string;
	label: string;
	/** One line of context in the meta register, or `null`. */
	meta: string | null;
	href: string;
}

/** The hits by kind, in lane order; a group with no hit is left out. */
export interface LaneSearchGroup {
	id: "views" | "channels" | "projects" | "people";
	label: string;
	hits: LaneSearchHit[];
}

/** What the console search reads — the lane's own rows and the console read's lists. */
export interface LaneSearchSources {
	rows: readonly Pick<LaneHubRow, "key" | "label" | "href" | "blurb">[];
	channels: readonly { slug: string; topic: string | null }[];
	channelBase: string | null;
	projects: readonly { id: string; title: string; href: string; counterparty: string }[];
	people: readonly { id: string; name: string; handle: string }[];
	/** The Members module, where a person's hit opens their drawer; `null` when not openable. */
	membersHref: string | null;
}

/** How many hits a group shows. */
export const SEARCH_GROUP_LIMIT = 5;

/** How long the typeahead waits after the last keystroke before it filters, in ms. */
export const SEARCH_DEBOUNCE_MS = 150;

/** Whether `needle` occurs in any of `fields`, ignoring case. */
function matches(needle: string, ...fields: (string | null | undefined)[]): boolean {
	return fields.some((f) => !!f && f.toLowerCase().includes(needle));
}

/**
 * The console search — views, channels, projects and people whose name (or handle, topic,
 * counterparty) contains the query, each group capped at {@link SEARCH_GROUP_LIMIT}. `null` while the
 * query is blank: the lane then shows its zones.
 */
export function consoleSearch(query: string, sources: LaneSearchSources): LaneSearchGroup[] | null {
	const needle = query.trim().toLowerCase();
	if (!needle) return null;
	const cap = <T>(list: T[]): T[] => list.slice(0, SEARCH_GROUP_LIMIT);
	const groups: LaneSearchGroup[] = [
		{
			id: "views",
			label: "Views",
			hits: cap(sources.rows.filter((r) => matches(needle, r.label, r.blurb))).map((r) => ({
				key: `view:${r.key}`,
				label: r.label,
				meta: null,
				href: r.href,
			})),
		},
		{
			id: "channels",
			label: "Channels",
			hits: sources.channelBase
				? cap(sources.channels.filter((c) => matches(needle, c.slug, c.topic))).map((c) => ({
					key: `channel:${c.slug}`,
					label: `# ${c.slug}`,
					meta: c.topic,
					href: `${sources.channelBase}/${encodeURIComponent(c.slug)}`,
				}))
				: [],
		},
		{
			id: "projects",
			label: "Projects",
			hits: cap(sources.projects.filter((p) => matches(needle, p.title, p.counterparty))).map((
				p,
			) => ({
				key: `project:${p.id}`,
				label: p.title,
				meta: p.counterparty || null,
				href: p.href,
			})),
		},
		{
			id: "people",
			label: "People",
			hits: sources.membersHref
				? cap(sources.people.filter((m) => matches(needle, m.name, m.handle))).map((m) => ({
					key: `person:${m.id}`,
					label: m.name,
					meta: `@${m.handle}`,
					href: `${sources.membersHref}?member=${encodeURIComponent(m.handle)}`,
				}))
				: [],
		},
	];
	return groups.filter((g) => g.hits.length > 0);
}
// #endregion
