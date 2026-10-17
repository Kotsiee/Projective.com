import type { ComponentChildren, JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/workspace.css";
import {
	LaneCollapseButton,
	LaneCreateButton,
	LaneEmpty,
	LaneFooter,
	LaneFooterActions,
	LaneHead,
	LaneIconButton,
	LaneList,
	LaneSearch,
	LaneSection,
	LaneSections,
	NavItem,
} from "@projective/ui/navigation";
import { MetaLine, Tag } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Button, SelectButton } from "@projective/ui/fields";
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
import type { ModuleKey, WorkspaceModule } from "../core/module-registry.tsx";
import {
	activeModuleOf,
	isWithinPath,
	type RosterTab,
	rosterTabCounts,
	toRosterTab,
} from "../core/workspace-model.ts";
import {
	type ConsoleLaneZones,
	groupHasSignal,
	initialMoreOpen,
	type LaneContextZone,
	type LaneCreate,
	laneEntityMeta,
	type LaneFooterZone,
	laneInviteMeta,
	laneMoreStorageKey,
	laneRosterList,
	laneSignals,
	type LaneZoneId,
	laneZoneOrder,
	laneZones,
	type ModuleSignals,
	parseMoreOpen,
	rosterFiltered,
	signalLabel,
} from "../core/lane-model.ts";
import {
	liveDetail,
	membersChart,
	openCreate,
	openInvite,
	rosterTab,
	selectRosterTab,
} from "../core/workspace-state.ts";
import {
	BackGlyph,
	cloneGlyph,
	InviteGlyph,
	MoreGlyph,
	PlusGlyph,
	SearchGlyph,
} from "../core/workspace-glyphs.tsx";
import { EntityMark } from "../components/EntityMark.tsx";
import {
	ContextSwitchControl,
	isActingEntity,
	resolveActingId,
} from "../components/ContextSwitchControl.tsx";
import { WorkspaceRail } from "../components/WorkspaceRail.tsx";

/**
 * WorkspaceLane — the middle-nav lane for the whole workspace surface (`/teams`, `/businesses` and
 * every console beneath them), built as **four zones** on `--surface-1` (Teams work order L1):
 *
 *   1. **Header strip** (`LaneHead`) — on the roster index the kind's title and a count line; inside
 *      a console Back, the entity's mark, name, `@handle` and lifecycle `Tag`, and the acting switch.
 *   2. **Primary views** — the viewer's entities (owned first) on the index; inside a console the
 *      registry's primary modules as `NavItem` rows, then "More" (collapsed until the viewer opens it,
 *      remembered per viewer) with every other module they may open.
 *   3. **Context controls** — a `SelectButton` (and on the index a `LaneSearch`) over the current view,
 *      only where the view has something to partition; otherwise the zone is not drawn.
 *   4. **Docked footer rig** (`LaneFooter`) — the collapse toggle and at most ONE tier-2
 *      `LaneCreateButton`: New team / New business on the index, Invite member inside a console for an
 *      `invite_members` holder, nothing for anybody else.
 *
 * Which zones exist and what they hold is {@link laneZones} — a pure function of the kind, the view
 * and the server-resolved capabilities, shared with the collapsed {@link WorkspaceRail} and pinned by
 * `lane-model.test.ts`. This island only renders it, in {@link laneZoneOrder}, which is also the Tab
 * order. Separation is the shared lane chrome's own: spacing and one hairline per boundary, no boxes.
 *
 * ### Both presentations are always in the DOM
 * The expanded zones and {@link WorkspaceRail} render together and CSS reveals exactly one, keyed off
 * `.ui-splitter[data-mode="collapsed"]`. There is deliberately **no client width observer**: an
 * observer cannot know the density until after hydration, so it paints the wrong shape for at least
 * one frame on every load. Letting CSS decide means SSR and the hydrated island agree on the first
 * frame, and the toggle is deterministic.
 *
 * ### Shared state, SSR-safe
 * The roster partition is ONE value across roots (`rosterTab` in `workspace-state`): the lane's
 * segmented control and the roster canvas both write it and both mirror it, and each falls back to its
 * server-resolved `?tab=` until something is picked. The Members reading is the existing
 * `membersChart` signal the Members screen already reads, so the lane's People · Org chart control
 * drives the body directly.
 *
 * ### Why it reads the live-detail relay
 * A role change rewrites `viewerCapabilities`, which decides this lane's visible modules and its
 * create action — and the lane is not in the body's tree, so it cannot be re-rendered by props. It
 * therefore consumes {@link liveDetail}, but only when the published detail is **this** entity: a
 * stale projection from the previous workspace would briefly paint one entity's permissions under
 * another's name.
 */

// #region Props
export interface WorkspaceLaneProps {
	kind: WorkspaceKind;
	/** Live pathname — drives the active module row and the active entity row. */
	path: string;

	// --- Roster index ---
	/** The roster. Supplied on `/teams` and `/businesses`; omitted inside an entity. */
	roster?: WorkspaceRoster;
	/** The selected roster partition, resolved from `?tab=` server-side so SSR and hydration agree. */
	tab?: RosterTab;

	// --- Console ---
	/** The console projection. Supplied on `/teams/[teamHandle]…`; its presence selects the console lane. */
	workspace?: WorkspaceDetail;
	/** The module being rendered, already corrected server-side. Falls back to the path. */
	activeModule?: ModuleKey | null;
	/** The module's resolved `?view=` sub-view (Members: `all` · `pending`), when it has one. */
	view?: string | null;
}

/** The collapse state both presentations share. */
interface LaneChrome {
	collapsed: boolean;
	onCollapse: (next: boolean) => void;
}
// #endregion

// #region Island
export default function WorkspaceLane(props: WorkspaceLaneProps): JSX.Element {
	const collapsed = useSignal(false);

	useEffect(() => {
		// The splitter owns the width; the lane mirrors its state only so the toggle glyph is correct.
		const el = document.querySelector(".ui-splitter") as HTMLElement | null;
		if (el) collapsed.value = el.dataset.mode === "collapsed";
	}, []);

	const chrome: LaneChrome = {
		collapsed: collapsed.value,
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
				view={props.view ?? null}
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
 * Run zone 4's create action. New entity opens the create modal; Invite member opens the invite modal
 * where the Members screen mounts it, and elsewhere lands on Members with it open (`?invite=1`) rather
 * than pressing into nothing.
 */
function runCreate(kind: WorkspaceKind, create: LaneCreate | null): void {
	if (!create) return;
	if (create.action === "create") openCreate(kind);
	else if (create.inPlace) openInvite();
	else globalThis.location.assign(create.href);
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
 * find-in-lane search. The search filters this lane's own list in place; the partition is shared.
 */
function RosterLane(props: RosterLaneProps): JSX.Element {
	const copy = kindCopy(props.kind);
	const items = props.roster?.items ?? [];
	const invitations = props.roster?.invitations ?? [];
	const actingId = props.roster ? resolveActingId(props.roster) : null;

	// This root's control, seeded from the URL and mirrored from the shared partition once it is set.
	const tab = useSignal<string>(props.tab);
	useSignalEffect(() => {
		const shared = rosterTab.value;
		if (shared !== null) tab.value = shared;
	});
	const search = useSignal("");
	const current = toRosterTab(tab.value);

	const zones = laneZones({
		view: "roster",
		kind: props.kind,
		liveCount: rosterTabCounts(items, invitations).all,
		invitationCount: invitations.length,
		canCreate: props.roster?.canCreate ?? true,
	});
	const list = laneRosterList(items, invitations, current, search.value);
	const onCreate = () => runCreate(props.kind, zones.footer.create);

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
			case "context":
				return zones.context
					? (
						<ContextZone key={id} context={zones.context}>
							<SelectButton
								options={zones.context.options}
								value={tab}
								onValueChange={(value) => selectRosterTab(toRosterTab(value as string))}
								size="sm"
								fluid
								aria-label={zones.context.label}
							/>
							<LaneSearch
								value={search.value}
								placeholder={`Find a ${copy.noun}…`}
								label={`Search ${copy.plural}`}
								icon={cloneGlyph(SearchGlyph)}
								onInput={(value) => {
									search.value = value;
								}}
							/>
							{rosterFiltered(current, search.value) && (
								<Button
									variant="text"
									size="sm"
									label="Reset"
									class="wsp-lane__reset"
									onClick={() => {
										search.value = "";
										selectRosterTab("all");
									}}
								/>
							)}
						</ContextZone>
					)
					: null;
			case "footer":
				return (
					<LaneFooterRig
						key={id}
						footer={zones.footer}
						chrome={props.chrome}
						onCreate={onCreate}
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
				entities={items}
				actingId={actingId}
				onCreate={onCreate}
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
 * point would put the same choice in two places. Looking before answering is the useful move here.
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
	view: string | null;
	chrome: LaneChrome;
}

/** One entity's lane — identity and the acting switch, its views, their controls, its one action. */
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
		subView: props.view,
	});
	const views = zones.views;
	const signals = laneSignals(detail);
	const onCreate = () => runCreate(props.kind, zones.footer.create);

	// "More": collapsed on the server (storage is unreadable there), then the viewer's remembered choice —
	// and always open onto the module being rendered.
	const viewer = detail.members.find((m) => m.id === detail.viewerMemberId)?.handle ??
		detail.viewerMemberId;
	const moreKey = laneMoreStorageKey(props.kind, viewer);
	const moreOpen = useSignal(initialMoreOpen(null, views.activeInMore));
	useEffect(() => {
		let stored: string | null = null;
		try {
			stored = globalThis.localStorage.getItem(moreKey);
		} catch {
			stored = null;
		}
		moreOpen.value = initialMoreOpen(parseMoreOpen(stored), views.activeInMore);
	}, [moreKey, views.activeInMore]);
	const toggleMore = () => {
		const next = !moreOpen.value;
		moreOpen.value = next;
		try {
			globalThis.localStorage.setItem(moreKey, next ? "1" : "0");
		} catch {
			// Storage unavailable — the choice holds for this page only.
		}
	};

	// The Members reading mirrors the signal the Members screen reads, whichever root last wrote it.
	const reading = useSignal<string>(membersChart.value ? "chart" : "people");
	useSignalEffect(() => {
		reading.value = membersChart.value ? "chart" : "people";
	});

	const zone = (id: LaneZoneId): JSX.Element | null => {
		switch (id) {
			case "header":
				return (
					<LaneHead key={id}>
						<div class="wsp-lane__identrow">
							<LaneIconButton
								href={zones.header.back.href}
								icon={<span class="wsp-icon--dir">{cloneGlyph(BackGlyph)}</span>}
								label={zones.header.back.label}
							/>
							<div class="wsp-lane__ident" data-acting={detail.isActing ? "true" : undefined}>
								<EntityMark
									name={detail.name}
									handle={detail.handle}
									kind={props.kind}
									image={detail.avatar}
									size="md"
								/>
								<div class="wsp-lane__identbody">
									<p class="wsp-lane__name">{detail.name}</p>
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
						<ContextSwitchControl
							kind={props.kind}
							id={detail.id}
							name={detail.name}
							handle={detail.handle}
							acting={detail.isActing}
							destination={workspaceHref(
								props.kind,
								detail.handle,
								props.activeModule ?? "overview",
							)}
						/>
					</LaneHead>
				);
			case "views":
				return (
					<LaneList key={id}>
						<nav class="wsp-lane__nav" aria-label={`${detail.name} views`}>
							<ModuleList
								modules={views.primary}
								kind={props.kind}
								handle={detail.handle}
								active={views.active}
								signals={signals}
							/>
							{views.more.length > 0 && (
								<LaneSections>
									<LaneSection
										id={`wsp-more-${props.kind}`}
										icon={cloneGlyph(MoreGlyph)}
										label="More"
										open={moreOpen.value}
										onToggle={toggleMore}
										hasUnread={!moreOpen.value && groupHasSignal(views.more, signals)}
									>
										<ModuleList
											modules={views.more}
											kind={props.kind}
											handle={detail.handle}
											active={views.active}
											signals={signals}
										/>
									</LaneSection>
								</LaneSections>
							)}
						</nav>
					</LaneList>
				);
			case "context":
				return zones.context
					? (
						<ContextZone key={id} context={zones.context}>
							<SelectButton
								options={zones.context.options}
								value={reading}
								onValueChange={(value) => {
									membersChart.value = value === "chart";
								}}
								size="sm"
								fluid
								aria-label={zones.context.label}
							/>
						</ContextZone>
					)
					: null;
			case "footer":
				return (
					<LaneFooterRig
						key={id}
						footer={zones.footer}
						chrome={props.chrome}
						onCreate={onCreate}
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
				entity={{
					id: detail.id,
					name: detail.name,
					handle: detail.handle,
					avatar: detail.avatar,
					verification: detail.verification,
					isActing: detail.isActing,
				}}
				signals={signals}
				onCreate={onCreate}
				onExpand={() => props.chrome.onCollapse(false)}
			/>
			<div class="wsp-lane">{laneZoneOrder(zones).map(zone)}</div>
		</div>
	);
}

/**
 * A module list — the registry's modules as `NavItem` rows (glyph + label), the rendered one marked
 * `aria-current="page"`. A queue's size sits at the row's end as plain tabular text; an attention mark
 * as a dot; both are folded into the row's accessible name (§B.6).
 */
function ModuleList(
	props: {
		modules: readonly WorkspaceModule[];
		kind: WorkspaceKind;
		handle: string;
		active: ModuleKey | null;
		signals: ModuleSignals;
	},
): JSX.Element {
	return (
		<ul class="wsp-lane__navlist" role="list">
			{props.modules.map((module) => {
				const signal = props.signals[module.key];
				const mark = signalLabel(signal);
				return (
					<li key={module.key}>
						<NavItem
							href={workspaceHref(props.kind, props.handle, module.key)}
							label={module.label}
							icon={cloneGlyph(module.glyph)}
							active={module.key === props.active}
							dot={mark !== null}
							dotLabel={mark ?? undefined}
							trailing={signal?.count
								? <span class="wsp-lane__navcount">{signal.count}</span>
								: signal?.dot
								? <span class="wsp-pulse" />
								: undefined}
						/>
					</li>
				);
			})}
		</ul>
	);
}
// #endregion

// #region Shared zones
/**
 * Zone 3 — the context controls over the current view, set off by one hairline. The group is named for
 * what it holds; the segmented control inside it carries the zone's own label.
 */
function ContextZone(
	props: { context: LaneContextZone; children: ComponentChildren },
): JSX.Element {
	return (
		<div
			class="wsp-lane__context"
			role="group"
			aria-label="View controls"
			data-control={props.context.control}
		>
			{props.children}
		</div>
	);
}

/** Zone 4 — the collapse toggle (it docks to the lane's corner) and the one create action. */
function LaneFooterRig(
	props: { footer: LaneFooterZone; chrome: LaneChrome; onCreate: () => void },
): JSX.Element {
	const create = props.footer.create;
	return (
		<LaneFooter>
			<LaneCollapseButton
				collapsed={props.chrome.collapsed}
				icon={<SidebarToggleIcon />}
				onToggle={() => props.chrome.onCollapse(!props.chrome.collapsed)}
			/>
			{create && (
				<LaneFooterActions>
					<LaneCreateButton
						label={create.label}
						icon={cloneGlyph(create.action === "invite" ? InviteGlyph : PlusGlyph)}
						onClick={props.onCreate}
					/>
				</LaneFooterActions>
			)}
		</LaneFooter>
	);
}
// #endregion
