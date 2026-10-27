import type { ComponentChildren, JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/workspace.css";
import {
	LaneBackLink,
	LaneBar,
	LaneCollapseButton,
	LaneCreateButton,
	LaneEmpty,
	LaneFooter,
	LaneFooterActions,
	LaneHead,
	LaneIconButton,
	LaneList,
	type LaneMode,
	LaneSearch,
	LaneSection,
	LaneSections,
	LaneTabs,
} from "@projective/ui/navigation";
import { MetaLine, Tag, VerificationStampBadge } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import {
	type IncomingInvite,
	kindCopy,
	type WorkspaceDetail,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceRoster,
	type WorkspaceSummary,
} from "@projective/types/workspace";
import { stampForVerifiedOwner } from "@projective/types/org";
import { mayViewModule, type ModuleKey } from "../core/module-registry.tsx";
import {
	activeModuleOf,
	isWithinPath,
	type RosterTab,
	rosterTabCounts,
	toRosterTab,
} from "../core/workspace-model.ts";
import {
	type ConsoleFooterZone,
	type ConsoleLaneZones,
	consoleSearch,
	type LaneContextZone,
	type LaneCreate,
	laneEntityMeta,
	type LaneFooterZone,
	laneInviteMeta,
	type LaneListingsRead,
	lanePartition,
	laneRosterList,
	laneSignals,
	type LaneZoneId,
	laneZoneOrder,
	laneZones,
	rosterFiltered,
	SEARCH_DEBOUNCE_MS,
	verificationWords,
} from "../core/lane-model.ts";
import { entityMenuPlan } from "../core/header-model.ts";
import {
	archiveRefusal,
	liveDetail,
	openCreate,
	openInvite,
	publishDetail,
	rosterFirstRun,
	rosterTab,
	selectRosterTab,
} from "../core/workspace-state.ts";
import { isFirstRun } from "../core/roster-model.ts";
import {
	CatalogueGlyph,
	ChannelGlyph,
	cloneGlyph,
	InviteGlyph,
	OperationsGlyph,
	PlusGlyph,
	SearchGlyph,
	SettingsGlyph,
} from "../core/workspace-glyphs.tsx";
import { EntityMark } from "../components/EntityMark.tsx";
import { EntityMenu } from "../components/EntityMenu.tsx";
import {
	ContextSwitchControl,
	isActingEntity,
	resolveActingId,
} from "../components/ContextSwitchControl.tsx";
import { type LaneCreateTarget, WorkspaceRail } from "../components/WorkspaceRail.tsx";
import { HubList } from "../components/lane/HubList.tsx";
import { ChannelAddButton, ChannelList } from "../components/lane/ChannelList.tsx";
import { CatalogueAddButton, CatalogueList } from "../components/lane/CatalogueList.tsx";
import { useLaneListings } from "../hooks/useLaneListings.ts";
import { LaneSearchResults } from "../components/lane/LaneSearchResults.tsx";
import { ChannelCreateDialog } from "../components/lane/ChannelCreateDialog.tsx";
import InviteModal from "./InviteModal.island.tsx";
import { screenHostsInvite } from "../core/rig-model.ts";

/**
 * WorkspaceLane — the middle-nav lane for the whole workspace surface (`/teams`, `/businesses` and
 * every console beneath them), built as **four zones** on `--surface-1` (Teams work order L1; the
 * console zones are Decision #306's, their order Decision #307's — the `/projects` lane's):
 *
 *   1. **Header strip** (`LaneHead`) — on the roster index the kind's title and a count line; inside a
 *      console Back, the entity's mark, name, verification crest, `@handle` and lifecycle `Tag`, its
 *      kebab ({@link EntityMenu}), and the verification state while it is not verified.
 *   2. **Context controls** — the find-in-lane `LaneSearch` FIRST, icon-first as `/projects` draws it;
 *      on the index the Invitations toggle beside it (an icon button, set apart from the partition)
 *      and the All · Owned · Member `LaneTabs` under it; inside a console the search alone (a
 *      view's readings are switched in its footer rig, Decision #319).
 *   3. **Views** — the viewer's entities (owned first) on the index; inside a console the
 *      `LaneSection`s Core operations (hub rows), a team's Catalogue (its title
 *      the console's link, its listings beneath and a "+" to create one — Decision #316) and Channels
 *      (the read's entity channels and a "+" to add one) LAST, as `/projects` closes its lane on its
 *      channel tree.
 *      While the search holds a query, its grouped hits replace the sections (debounced typeahead over
 *      views, channels, projects and people).
 *   4. **Docked footer rig** (`LaneFooter`) — the collapse toggle, then on the index at most ONE
 *      tier-2 `LaneCreateButton`; inside a console the acting switch as a compact pill and the
 *      circular icon-only Invite member and Settings (tier 5: aria-label + portal Tooltip + `.ui-hit`).
 *
 * Which zones exist and what they hold is {@link laneZones} — a pure function of the kind, the view
 * and the server-resolved capabilities, shared with the collapsed {@link WorkspaceRail} and pinned by
 * `lane-model.test.ts`. This island only renders it, in {@link laneZoneOrder}, which is also the Tab
 * order. Separation is the shared lane chrome's own: spacing and one hairline per boundary, no boxes.
 *
 * ### Both presentations are always in the DOM
 * The expanded zones and {@link WorkspaceRail} render together and CSS reveals exactly one, keyed off
 * `.ui-splitter[data-mode="collapsed"]`, so SSR and the hydrated island agree on the first frame.
 *
 * ### Shared state, SSR-safe
 * The roster partition is ONE value across roots (`rosterTab` in `workspace-state`), read through
 * {@link lanePartition} so the canvas-only Archived reads as All here. The roster's first run is shared
 * the same way (`rosterFirstRun`). The Members reading is the module's ONE sub-view state
 * (`moduleView`), which the header band's tabs and the footer rig's Org chart toggle also write.
 *
 * ### Why it reads the live-detail relay
 * A role change rewrites `viewerCapabilities`, which decides this lane's hubs and its footer — and the
 * lane is not in the body's tree, so it consumes {@link liveDetail}, but only when the published detail
 * is **this** entity.
 */

// #region Props
export interface WorkspaceLaneProps {
	kind: WorkspaceKind;
	/** Live pathname — drives the active hub row and the active entity row. */
	path: string;

	// --- Roster index ---
	/** The roster. Supplied on `/teams` and `/businesses`; omitted inside an entity. */
	roster?: WorkspaceRoster;
	/** The selected roster partition, resolved from `?view=` server-side so SSR and hydration agree. */
	tab?: RosterTab;

	// --- Console ---
	/** The console projection. Supplied on `/teams/[teamHandle]…`; its presence selects the console lane. */
	workspace?: WorkspaceDetail;
	/** The module being rendered, already corrected server-side. Falls back to the path. */
	activeModule?: ModuleKey | null;
	/** The channel being rendered (its name) on a `channels` route. */
	channel?: string | null;
	/** The listing being rendered (its slug) on a team `catalogue` route. */
	listing?: string | null;
	/** The Catalogue section's listings, read server-side on a team `catalogue` route only. */
	listings?: LaneListingsRead | null;
}

/** The collapse state both presentations share. */
interface LaneChrome {
	collapsed: boolean;
	onCollapse: (next: boolean) => void;
	/**
	 * The splitter's density, mirrored after hydration (`null` on the server and the first frame). CSS
	 * alone decides what the lane LOOKS like at each density; this only adds what CSS cannot — the
	 * Tooltip a create action needs once the compact lane has folded its words away (§B.6).
	 */
	mode: LaneMode | null;
}
// #endregion

// #region Island
export default function WorkspaceLane(props: WorkspaceLaneProps): JSX.Element {
	const collapsed = useSignal(false);
	const mode = useSignal<LaneMode | null>(null);

	useEffect(() => {
		// The splitter owns the width; the lane mirrors its state only so the toggle glyph is correct and
		// the compact create can name itself. A drag changes the density without any lane event, so the
		// attribute is watched rather than read once.
		const el = document.querySelector(".ui-splitter") as HTMLElement | null;
		if (!el) return;
		const read = () => {
			mode.value = (el.dataset.mode as LaneMode | undefined) ?? null;
		};
		read();
		collapsed.value = mode.value === "collapsed";
		const watch = new MutationObserver(read);
		watch.observe(el, { attributes: true, attributeFilter: ["data-mode"] });
		return () => watch.disconnect();
	}, []);

	const chrome: LaneChrome = {
		collapsed: collapsed.value,
		mode: mode.value,
		onCollapse: (next) => {
			collapsed.value = next;
			globalThis.dispatchEvent(
				new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
			);
		},
	};

	// Trust the relay only for THIS entity — see the module header.
	const published = liveDetail.value;
	const detail = props.workspace
		? (published && published.id === props.workspace.id ? published : props.workspace)
		: null;

	return detail
		? (
			<ConsoleLane
				kind={props.kind}
				detail={detail}
				path={props.path}
				activeModule={props.activeModule ?? activeModuleOf(props.path)}
				channel={props.channel ?? null}
				listing={props.listing ?? null}
				listings={props.listings ?? null}
				chrome={chrome}
			/>
		)
		: (
			<RosterLane
				kind={props.kind}
				roster={props.roster}
				tab={props.tab ?? "all"}
				path={props.path}
				chrome={chrome}
			/>
		);
}

/**
 * The roster's create action, as the props of its one `LaneCreateButton`: New entity opens the create
 * modal in place.
 */
function createTarget(kind: WorkspaceKind, create: LaneCreate | null): LaneCreateTarget | null {
	if (!create) return null;
	if (create.action === "create") return { onClick: () => openCreate(kind) };
	return { onClick: () => openInvite() };
}

/**
 * The console footer's Invite member: always a button that opens the invite modal in place — the
 * module's screen or this lane mounts it (`screenHostsInvite`, Decision #318).
 */
function inviteTarget(invite: ConsoleFooterZone["invite"]): LaneCreateTarget | null {
	return invite ? { onClick: () => openInvite() } : null;
}
// #endregion

// #region Roster index lane
interface RosterLaneProps {
	kind: WorkspaceKind;
	roster?: WorkspaceRoster;
	tab: RosterTab;
	path: string;
	chrome: LaneChrome;
}

/**
 * The roster index lane — the viewer's entities, partitioned by the same value the canvas shows, with a
 * find-in-lane search at the top of the context zone. The search filters this lane's own list in place;
 * the partition is shared.
 */
function RosterLane(props: RosterLaneProps): JSX.Element {
	const copy = kindCopy(props.kind);
	const items = props.roster?.items ?? [];
	const invitations = props.roster?.invitations ?? [];
	const actingId = props.roster ? resolveActingId(props.roster) : null;

	// This root's control, seeded from the URL and mirrored from the shared partition once it is set —
	// both read through `lanePartition`, so the canvas-only Archived shows here as All.
	const tab = useSignal<string>(lanePartition(props.tab));
	useSignalEffect(() => {
		const shared = rosterTab.value;
		if (shared !== null) tab.value = lanePartition(shared);
	});
	const search = useSignal("");
	const current = lanePartition(toRosterTab(tab.value));

	// First run moves the one structural create into the canvas's empty state. The canvas publishes
	// its reading once it has one; until then the same rule runs over this lane's SSR roster — and a
	// roster that failed to load is never first run, so the create stays where the reader can reach it.
	const firstRun = rosterFirstRun.value ?? (props.roster
		? isFirstRun({
			loaded: true,
			entityCount: items.length,
			invitationCount: invitations.length,
		})
		: false);
	const zones = laneZones({
		view: "roster",
		kind: props.kind,
		liveCount: rosterTabCounts(items, invitations).all,
		invitationCount: invitations.length,
		canCreate: props.roster?.canCreate ?? true,
		createBlockedReason: props.roster?.createBlockedReason,
		firstRun,
	});
	const list = laneRosterList(items, invitations, current, search.value);
	const create = createTarget(props.kind, zones.footer.create);

	const invitationsToggle = zones.context.invitations;
	const onInvitations = current === "invitations";

	const zone = (id: LaneZoneId): JSX.Element | null => {
		switch (id) {
			case "header":
				return (
					<LaneHead key={id}>
						<div class="wsp-lane__titleblock">
							<p class="wsp-lane__title">{zones.header.title}</p>
							<MetaLine items={zones.header.meta} size="xs" />
						</div>
					</LaneHead>
				);
			case "context":
				return (
					<ContextZone key={id} context={zones.context}>
						<div class="wsp-lane__search">
							<LaneBar>
								<LaneSearch
									value={search.value}
									placeholder={zones.context.search.placeholder}
									label={zones.context.search.label}
									icon={cloneGlyph(SearchGlyph)}
									onInput={(value) => {
										search.value = value;
									}}
								/>
								{invitationsToggle && (
									<LaneIconButton
										class="wsp-lane__invitations"
										icon={cloneGlyph(InviteGlyph)}
										label={invitationsToggle.waiting > 0
											? `${invitationsToggle.label} (${invitationsToggle.waiting} waiting)`
											: invitationsToggle.label}
										tooltip={invitationsToggle.label}
										active={onInvitations}
										pressed={onInvitations}
										dot={invitationsToggle.waiting > 0}
										onClick={() => selectRosterTab(onInvitations ? "all" : "invitations")}
									/>
								)}
							</LaneBar>
						</div>
						{zones.context.partition && (
							<LaneTabs
								label={zones.context.partition.label}
								class="wsp-lane__partition"
								value={tab.value}
								options={zones.context.partition.options}
								onSelect={(value) => selectRosterTab(toRosterTab(value))}
							/>
						)}
						{rosterFiltered(current, search.value) && (
							<Button
								variant="text"
								size="sm"
								label="Reset"
								class="wsp-lane__reset"
								onClick={(event) => {
									// Nothing is left to clear once this runs, so the Reset unmounts: hand focus
									// to the search field it just emptied first, so the keyboard path never
									// drops to <body>.
									event.currentTarget.closest(".wsp-lane")
										?.querySelector<HTMLInputElement>(".wsp-lane__search input")
										?.focus();
									search.value = "";
									selectRosterTab("all");
								}}
							/>
						)}
					</ContextZone>
				);
			case "views":
				return (
					<LaneList key={id} label={`Your ${copy.plural}`}>
						{list.mode === "invitations"
							? (list.rows.length === 0
								? (
									<LaneEmpty
										title={search.value ? "No matches" : "No invitations"}
										note={search.value
											? "Try a different name or handle."
											: `Nobody has invited you to a ${copy.noun}.`}
									/>
								)
								: list.rows.map((invite) => <InviteRow key={invite.id} invite={invite} />))
							: list.rows.length === 0
							? (
								<LaneEmpty
									title={search.value ? "No matches" : `No ${copy.plural} here`}
									note={search.value
										? "Try a different name or handle."
										: "Nothing in this partition yet."}
								/>
							)
							: list.rows.map((entity) => (
								<EntityRow
									key={entity.id}
									entity={entity}
									kind={props.kind}
									acting={isActingEntity(entity.id, actingId)}
									active={isWithinPath(props.path, workspaceHref(props.kind, entity.handle))}
								/>
							))}
					</LaneList>
				);
			case "footer":
				return (
					<LaneFooterRig
						key={id}
						footer={zones.footer}
						target={create}
						chrome={props.chrome}
					/>
				);
		}
	};

	return (
		<div class="wsp-lanewrap" data-kind={props.kind}>
			<WorkspaceRail
				kind={props.kind}
				path={props.path}
				zones={zones}
				createTarget={create}
				entities={items}
				actingId={actingId}
				onExpand={() => props.chrome.onCollapse(false)}
			/>
			<div class="wsp-lane">{laneZoneOrder(zones).map(zone)}</div>
		</div>
	);
}

/**
 * One entity row: mark, name and its facts as one MetaLine (`Owner · 4 members · Active`) — no chips
 * (§B.11). Acting is the reserved leading rule, decided ONLY by {@link isActingEntity}.
 */
function EntityRow(
	props: { entity: WorkspaceSummary; kind: WorkspaceKind; acting: boolean; active: boolean },
): JSX.Element {
	const { entity } = props;
	const noun = kindCopy(props.kind).noun;
	return (
		<a
			class="wsp-lane__entity"
			href={workspaceHref(props.kind, entity.handle)}
			data-acting={props.acting ? "true" : undefined}
			aria-current={props.active ? "page" : undefined}
		>
			<EntityMark
				name={entity.name}
				handle={entity.handle}
				kind={entity.kind}
				image={entity.avatar}
				size="sm"
			/>
			<span class="wsp-lane__entity-body">
				<span class="wsp-lane__entity-name">{entity.name}</span>
				<MetaLine as="span" size="xs" class="wsp-trunc" items={laneEntityMeta(entity)} />
			</span>
			{entity.hasUpdate && (
				<Tooltip content="Unseen activity">
					<span class="wsp-pulse" role="img" aria-label="Unseen activity" />
				</Tooltip>
			)}
			{props.acting && <span class="ui-visually-hidden">, acting as this {noun}</span>}
		</a>
	);
}

/**
 * One incoming invitation. It links to the entity's **public profile**, not to an accept action:
 * answering happens in the roster body's invitation strip, and a lane row that looked like a decision
 * point would put the same choice in two places.
 */
function InviteRow(props: { invite: IncomingInvite }): JSX.Element {
	const { invite } = props;
	return (
		<a
			class="wsp-lane__entity"
			// The canonical profile namespace is the wildcard `/@handle` (root CLAUDE.md Decision #3).
			href={`/@${invite.workspaceHandle}`}
			aria-label={`View ${invite.workspaceName}'s profile before answering`}
		>
			<EntityMark
				name={invite.workspaceName}
				handle={invite.workspaceHandle}
				kind={invite.kind}
				image={invite.workspaceAvatar}
				size="sm"
			/>
			<span class="wsp-lane__entity-body">
				<span class="wsp-lane__entity-name">{invite.workspaceName}</span>
				<MetaLine as="span" size="xs" class="wsp-trunc" items={laneInviteMeta(invite)} />
			</span>
		</a>
	);
}
// #endregion

// #region Console lane
interface ConsoleLaneProps {
	kind: WorkspaceKind;
	detail: WorkspaceDetail;
	path: string;
	activeModule: ModuleKey | null;
	channel: string | null;
	listing: string | null;
	listings: LaneListingsRead | null;
	chrome: LaneChrome;
}

/** The zones' sections; a reader may fold one away, or open a folded one, for this visit. */
type SectionId = "operations" | "catalogue" | "channels";

/** The section header glyphs. */
const SECTION_GLYPH = {
	operations: OperationsGlyph,
	catalogue: CatalogueGlyph,
	channels: ChannelGlyph,
} as const;

/** A section whose title is its own page, with the chevron as the separate toggle. */
interface SectionLink {
	href: string;
	current: boolean;
	toggleLabel: string;
}

/** One entity's lane — identity and kebab; its search and controls; its zoned views; its footer rig. */
function ConsoleLane(props: ConsoleLaneProps): JSX.Element {
	const { detail } = props;
	const zones: ConsoleLaneZones = laneZones({
		view: "console",
		kind: props.kind,
		name: detail.name,
		handle: detail.handle,
		status: detail.status,
		acting: detail.isActing,
		capabilities: detail.viewerCapabilities,
		module: props.activeModule,
		channel: props.channel,
		listing: props.listing,
	});
	const views = zones.views;
	const signals = laneSignals(detail);
	const identRef = useRef<HTMLDivElement>(null);
	const listings = useLaneListings(views.catalogue?.team ?? null, props.listings);

	const open = useSignal<Record<SectionId, boolean>>({
		operations: true,
		catalogue: views.catalogue?.row.active ?? false,
		channels: true,
	});
	const toggle = (id: SectionId) => {
		const next = !open.value[id];
		open.value = { ...open.value, [id]: next };
		if (id === "catalogue" && next) listings.ensure();
	};
	const creating = useSignal(false);

	// The typeahead: the field shows every keystroke, the hits follow once typing pauses.
	const query = useSignal("");
	const term = useSignal("");
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => () => {
		if (timer.current !== null) clearTimeout(timer.current);
	}, []);
	const onSearch = (value: string) => {
		query.value = value;
		if (timer.current !== null) clearTimeout(timer.current);
		if (!value.trim()) {
			term.value = "";
			return;
		}
		timer.current = setTimeout(() => {
			term.value = value;
		}, SEARCH_DEBOUNCE_MS);
	};

	const allRows = [
		...views.sections.flatMap((s) => s.rows),
		...(views.catalogue ? [views.catalogue.row] : []),
		...(zones.footer.settings ? [zones.footer.settings] : []),
	];
	const hits = consoleSearch(term.value, {
		rows: allRows,
		channels: detail.channels,
		channelBase: views.channels?.base ?? null,
		projects: detail.projects,
		people: detail.members.filter((m) => m.state === "active"),
		membersHref: mayViewModule("members", props.kind, detail.viewerCapabilities)
			? workspaceHref(props.kind, detail.handle, "members")
			: null,
	});

	const self = detail.members.find((m) => m.id === detail.viewerMemberId);
	const menuPlan = entityMenuPlan({
		kind: props.kind,
		module: props.activeModule ?? "overview",
		name: detail.name,
		handle: detail.handle,
		status: detail.status,
		owner: self?.rolePreset === "owner",
		capabilities: detail.viewerCapabilities,
		viewerCanArchive: detail.viewerCan?.archive ?? null,
		archiveBlocked: detail.archiveBlockers.length > 0 || archiveRefusal.value?.id === detail.id,
	});
	const stamp = stampForVerifiedOwner(detail.verification === "verified", props.kind);

	const section = (
		id: SectionId,
		label: string,
		body: ComponentChildren,
		action?: JSX.Element,
		link?: SectionLink,
	) => (
		<LaneSection
			key={id}
			id={`wsp-${id}-${props.kind}`}
			icon={cloneGlyph(SECTION_GLYPH[id])}
			label={label}
			open={open.value[id]}
			onToggle={() => toggle(id)}
			action={action}
			href={link?.href}
			current={link?.current}
			toggleLabel={link?.toggleLabel}
		>
			{body}
		</LaneSection>
	);

	const zone = (id: LaneZoneId): JSX.Element | null => {
		switch (id) {
			case "header":
				return (
					<LaneHead key={id}>
						<div class="wsp-lane__identblock" ref={identRef}>
							<div class="wsp-lane__toprow">
								<LaneBackLink href={zones.header.back.href} label={zones.header.back.label} />
								<EntityMenu
									workspace={detail}
									plan={menuPlan}
									label={zones.header.menuLabel}
									surface={identRef}
									class="ui-hit"
								/>
							</div>
							<div class="wsp-lane__ident" data-acting={detail.isActing ? "true" : undefined}>
								<EntityMark
									name={detail.name}
									handle={detail.handle}
									kind={props.kind}
									image={detail.avatar}
									size="md"
								/>
								<div class="wsp-lane__identbody">
									<p class="wsp-lane__name">
										<span class="wsp-lane__name-text">{detail.name}</span>
										<VerificationStampBadge stamp={stamp} size="sm" placement="bottom" />
									</p>
									<div class="wsp-lane__identmeta">
										<MetaLine
											as="span"
											size="xs"
											class="wsp-trunc"
											items={[`@${detail.handle}`]}
										/>
										<Tag
											value={zones.header.status.label}
											severity={zones.header.status.severity}
											variant="subtle"
											rounded
										/>
									</div>
								</div>
							</div>
						</div>
						{detail.verification !== "verified" && (
							<VerificationLine kind={props.kind} state={detail.verification} />
						)}
					</LaneHead>
				);
			case "context":
				return (
					<ContextZone key={id} context={zones.context}>
						<div class="wsp-lane__search">
							<LaneBar>
								<LaneSearch
									value={query.value}
									placeholder={zones.context.search.placeholder}
									label={zones.context.search.label}
									icon={cloneGlyph(SearchGlyph)}
									onInput={onSearch}
								/>
							</LaneBar>
						</div>
					</ContextZone>
				);
			case "views":
				return (
					<LaneList key={id}>
						<nav class="wsp-lane__nav" aria-label={`${detail.name} views`}>
							{hits ? <LaneSearchResults groups={hits} query={term.value} /> : (
								<LaneSections>
									{views.sections.map((s) =>
										section(s.id, s.label, <HubList rows={s.rows} signals={signals} />)
									)}
									{views.catalogue &&
										section(
											"catalogue",
											views.catalogue.row.label,
											<CatalogueList
												state={listings.state.value}
												zone={views.catalogue}
												onRetry={listings.reload}
											/>,
											views.catalogue.canCreate
												? <CatalogueAddButton zone={views.catalogue} />
												: undefined,
											{
												href: views.catalogue.row.href,
												current: views.catalogue.current,
												toggleLabel: `${views.catalogue.row.label} listings`,
											},
										)}
									{views.channels &&
										section(
											"channels",
											views.channels.label,
											<ChannelList channels={detail.channels} zone={views.channels} />,
											views.channels.canCreate
												? (
													<ChannelAddButton
														label={views.channels.createLabel}
														onClick={() => (creating.value = true)}
													/>
												)
												: undefined,
										)}
								</LaneSections>
							)}
						</nav>
						{views.channels && (
							<ChannelCreateDialog
								workspace={detail}
								visible={creating}
								base={views.channels.base}
							/>
						)}
					</LaneList>
				);
			case "footer":
				return (
					<ConsoleFooterRig
						key={id}
						kind={props.kind}
						detail={detail}
						footer={zones.footer}
						destination={workspaceHref(
							props.kind,
							detail.handle,
							props.activeModule ?? "overview",
						)}
						settingsSignal={signals.verification?.dot === true}
						chrome={props.chrome}
					/>
				);
		}
	};

	return (
		<div class="wsp-lanewrap" data-kind={props.kind}>
			<WorkspaceRail
				kind={props.kind}
				path={props.path}
				zones={zones}
				createTarget={null}
				inviteTarget={inviteTarget(zones.footer.invite)}
				entity={{
					id: detail.id,
					name: detail.name,
					handle: detail.handle,
					avatar: detail.avatar,
					verification: detail.verification,
					isActing: detail.isActing,
				}}
				signals={signals}
				onExpand={() => props.chrome.onCollapse(false)}
			/>
			<div class="wsp-lane">{laneZoneOrder(zones).map(zone)}</div>
			{
				/*
				 * The invite modal, where this module's screen does not mount its own — so Invite opens in
				 * place on every console page (Decision #318). Its writes reach the other roots through the
				 * live-detail relay.
				 */
			}
			{zones.footer.invite && !screenHostsInvite(props.kind, props.activeModule) && (
				<InviteModal workspace={detail} onUpdated={publishDetail} />
			)}
		</div>
	);
}

/**
 * The entity's verification state in the header strip while it is NOT verified: a state dot (each state
 * its own silhouette) and its words in the meta register. A verified entity shows the crest beside its
 * name instead; the collapsed rail rings the mark with the same state.
 */
function VerificationLine(
	props: { kind: WorkspaceKind; state: WorkspaceDetail["verification"] },
): JSX.Element {
	return (
		<p class="wsp-lane__verification">
			<span class="wsp-statedot" data-verify={props.state} aria-hidden="true" />
			<span class="wsp-lane__verification-text">{verificationWords(props.kind, props.state)}</span>
		</p>
	);
}
// #endregion

// #region Shared zones
/**
 * Zone 2 — the search, then the controls over the current view, closed by one hairline above the views.
 * The group is named for what it holds; the segmented control inside it carries the zone's own label.
 */
function ContextZone(
	props: { context: LaneContextZone; children: ComponentChildren },
): JSX.Element {
	return (
		<div
			class="wsp-lane__context"
			role="group"
			aria-label="View controls"
			data-control={props.context.partition?.control}
		>
			{props.children}
		</div>
	);
}

/**
 * Zone 4 on the roster index — the collapse toggle (it docks to the lane's corner) and the one create
 * action. A roster that withholds its create says why in the same place, as one line of meta text —
 * never a dead control. A compact splitter folds the action's words away, so there the glyph carries a
 * Tooltip naming it.
 */
function LaneFooterRig(
	props: { footer: LaneFooterZone; target: LaneCreateTarget | null; chrome: LaneChrome },
): JSX.Element {
	const create = props.footer.create;
	const button = create && props.target
		? (
			<LaneCreateButton
				label={create.label}
				icon={cloneGlyph(create.action === "invite" ? InviteGlyph : PlusGlyph)}
				{...props.target}
			/>
		)
		: null;
	return (
		<LaneFooter>
			<LaneCollapseButton
				collapsed={props.chrome.collapsed}
				icon={<SidebarToggleIcon />}
				onToggle={() => props.chrome.onCollapse(!props.chrome.collapsed)}
			/>
			{create && button && (
				<LaneFooterActions>
					{props.chrome.mode === "compact"
						? <Tooltip content={create.label} placement="top">{button}</Tooltip>
						: button}
				</LaneFooterActions>
			)}
			{props.footer.note && <p class="wsp-lane__createnote">{props.footer.note}</p>}
		</LaneFooter>
	);
}

/** The classes a circular tier-5 utility takes — the `Button` outlined neutral pill, icon-only. */
const FOOT_ICON_CLASS =
	"ui-button ui-button--neutral ui-button--outlined ui-button--size-sm ui-button--rounded ui-button--icon-only ui-hit wsp-lane__footicon";

/**
 * Zone 4 inside a console (Decision #306) — the collapse toggle, the acting switch as a compact pill,
 * then the circular icon-only Invite member and Settings, each named by `aria-label` and a portal
 * Tooltip. Invite is a button where the invite modal is mounted, else a link to Members with it open;
 * Settings is a link to the Settings hub, marked while verification wants attention.
 */
function ConsoleFooterRig(
	props: {
		kind: WorkspaceKind;
		detail: WorkspaceDetail;
		footer: ConsoleFooterZone;
		destination: string;
		settingsSignal: boolean;
		chrome: LaneChrome;
	},
): JSX.Element {
	const { invite, settings } = props.footer;
	const target = inviteTarget(invite);
	const settingsLabel = settings
		? (props.settingsSignal ? `${settings.label} — needs attention` : settings.label)
		: "";
	return (
		<LaneFooter class="wsp-lane__footer">
			<LaneCollapseButton
				collapsed={props.chrome.collapsed}
				icon={<SidebarToggleIcon />}
				onToggle={() => props.chrome.onCollapse(!props.chrome.collapsed)}
			/>
			{(["pill", "icon"] as const).map((variant) => (
				<span
					key={variant}
					class={`wsp-lane__actas wsp-lane__actas--${variant === "pill" ? "wide" : "narrow"}`}
				>
					<ContextSwitchControl
						kind={props.kind}
						id={props.detail.id}
						name={props.detail.name}
						handle={props.detail.handle}
						acting={props.detail.isActing}
						destination={props.destination}
						variant={variant}
					/>
				</span>
			))}
			{(invite || settings) && (
				<LaneFooterActions>
					{invite && target && (
						<Tooltip content={invite.label} placement="top">
							{"href" in target
								? (
									<a class={FOOT_ICON_CLASS} href={target.href} aria-label={invite.label}>
										<span class="ui-button__icon">{cloneGlyph(InviteGlyph)}</span>
									</a>
								)
								: (
									<Button
										class="ui-hit wsp-lane__footicon"
										severity="neutral"
										variant="outlined"
										size="sm"
										rounded
										iconOnly
										icon={cloneGlyph(InviteGlyph)}
										aria-label={invite.label}
										aria-haspopup="dialog"
										onClick={target.onClick}
									/>
								)}
						</Tooltip>
					)}
					{settings && (
						<Tooltip content={settings.label} placement="top">
							<a
								class={FOOT_ICON_CLASS}
								href={settings.href}
								aria-label={settingsLabel}
								aria-current={settings.active ? "page" : undefined}
							>
								<span class="ui-button__icon">{cloneGlyph(SettingsGlyph)}</span>
								{props.settingsSignal && <span class="wsp-lane__footdot wsp-pulse" />}
							</a>
						</Tooltip>
					)}
				</LaneFooterActions>
			)}
		</LaneFooter>
	);
}
// #endregion
