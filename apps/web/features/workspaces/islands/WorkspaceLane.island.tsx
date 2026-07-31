import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/workspace.css";
import {
	LaneBar,
	LaneCollapseButton,
	LaneEmpty,
	LaneFooter,
	LaneHead,
	LaneIconButton,
	LaneList,
	LaneSearch,
	LaneSection,
	LaneSections,
	type LaneTabOption,
	LaneTabs,
	type LaneToggleOption,
	LaneToggleRow,
} from "@projective/ui/navigation";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import {
	type IncomingInvite,
	type KindCopy,
	kindCopy,
	roleLabel,
	type VerificationState,
	type WorkspaceDetail,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceRole,
	type WorkspaceRoster,
	type WorkspaceSummary,
} from "@projective/types/workspace";
import {
	type ModuleGroup,
	type ModuleKey,
	moduleSectionsForViewer,
	modulesForViewer,
} from "../core/module-registry.tsx";
import {
	activeModuleOf,
	applyRosterFilters,
	countLabel,
	filterRoster,
	pendingMembers,
	ROSTER_TABS,
	type RosterQuickFilter,
	type RosterTab,
	rosterTabCounts,
} from "../core/workspace-model.ts";
import { liveDetail, openCreate, openInvite } from "../core/workspace-state.ts";
import {
	BackGlyph,
	BellGlyph,
	ChartGlyph,
	cloneGlyph,
	DraftGlyph,
	FinanceGlyph,
	InviteGlyph,
	KebabGlyph,
	MembersGlyph,
	OverviewGlyph,
	PlusGlyph,
	SearchGlyph,
	SettingsGlyph,
	ShieldGlyph,
	SlidersGlyph,
	SwitchGlyph,
	WalletGlyph,
} from "../core/workspace-glyphs.tsx";
import { EntityMark } from "../components/EntityMark.tsx";
import {
	ContextSwitchControl,
	isActingEntity,
	resolveActingId,
} from "../components/ContextSwitchControl.tsx";
import { type ModuleSignals, WorkspaceRail } from "../components/WorkspaceRail.tsx";

/**
 * WorkspaceLane — the middle-nav lane for the whole workspace surface: **two lanes in one island**,
 * each with two presentations.
 *
 * ### The two lanes
 *  - **Index** (`/teams`, `/businesses`) — the viewer's entities as a navigable list, partitioned by
 *    the roster tabs, with the invitations awaiting them.
 *  - **Entity** (`/teams/[id]…`) — one entity's identity, its acting switch, and its module nav.
 *
 * They are one island rather than two because they occupy the same shell slot with the same chrome,
 * the same collapse behaviour and the same acting-marker rules. Splitting them would duplicate all
 * three and let them drift.
 *
 * ### Both presentations are always in the DOM
 * The expanded stack and {@link WorkspaceRail} render together and CSS reveals exactly one, keyed off
 * `.ui-splitter[data-mode="collapsed"]`. There is deliberately **no client width observer**: an
 * observer cannot know the density until after hydration, so it paints the wrong shape for at least
 * one frame on every single load. Letting CSS decide means SSR and the hydrated island agree on the
 * first frame, and the toggle is deterministic — the expanded footer button only collapses, the rail
 * button only expands, and each exists solely in its own state.
 *
 * ### The nav is derived, never written down
 * Every module row, every group heading and every rail square comes from
 * {@link modulesForViewer} / {@link moduleSectionsForViewer} over the **server-resolved**
 * `viewerCapabilities`. There is no hand-written list here to fall out of step with the routes, and a
 * capability the viewer lacks produces an absent row rather than a disabled one — offering an action
 * a member may never take is a lie about the roster.
 *
 * ### Why it reads the live-detail relay
 * A role change rewrites `viewerCapabilities`, which decides this lane's visible modules — and the
 * lane is not in the body's tree, so it cannot be re-rendered by props. It therefore consumes
 * {@link liveDetail}, but only when the published detail is **this** entity: a stale projection from
 * the previous workspace would briefly paint one entity's permissions under another's name.
 */

// #region Lane filter vocabulary
/**
 * The roster lane's icon-ONLY quick filters — the same permanent tag row `/projects` carries, in the
 * same position, built from the same shared {@link LaneToggleRow}. Each toggle is described by a
 * portal Tooltip and an `aria-label`; none carries a text label (§B.6 icon-first).
 */
const ROSTER_QUICK_TOGGLES: readonly LaneToggleOption<RosterQuickFilter>[] = [
	{ key: "acting", label: "Acting as", icon: cloneGlyph(SwitchGlyph) },
	{ key: "updates", label: "Unseen activity", icon: cloneGlyph(BellGlyph) },
	{ key: "draft", label: "Unfinished setup", icon: cloneGlyph(DraftGlyph) },
];

/**
 * The Filter popover's one facet. `lead` is omitted deliberately: it is a Team rank a Business never
 * issues, and a facet that is empty on half the surface teaches nothing.
 */
const ROLE_FACETS: readonly WorkspaceRole[] = ["owner", "admin", "member"];
// #endregion

// #region Props
export interface WorkspaceLaneProps {
	kind: WorkspaceKind;
	/** Live pathname — drives the active module row and the active entity row. */
	path: string;

	// --- Index mode ---
	/** The roster. Supplied on `/teams` and `/businesses`; omitted inside an entity. */
	roster?: WorkspaceRoster;
	/** The selected roster tab, resolved from `?tab=` server-side so SSR and hydration agree. */
	tab?: RosterTab;

	// --- Entity mode ---
	/** The console projection. Supplied on `/teams/[id]…`; its presence selects the entity lane. */
	workspace?: WorkspaceDetail;
	/** The module being rendered, already corrected server-side. Falls back to the path. */
	activeModule?: ModuleKey | null;
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

	const setCollapsed = (next: boolean) => {
		collapsed.value = next;
		globalThis.dispatchEvent(
			new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
		);
	};

	// Trust the relay only for THIS entity — see the module header.
	const published = liveDetail.value;
	const detail = props.workspace
		? (published && published.id === props.workspace.id ? published : props.workspace)
		: null;

	return (
		<div class="wsp-lanewrap" data-kind={props.kind}>
			{detail
				? (
					<>
						<WorkspaceRail
							kind={props.kind}
							path={props.path}
							entity={{
								id: detail.id,
								name: detail.name,
								handle: detail.handle,
								avatar: detail.avatar,
								verification: detail.verification,
								verificationPrompt: detail.verificationPrompt,
								isActing: detail.isActing,
							}}
							modules={modulesForViewer(props.kind, detail.viewerCapabilities)}
							activeModule={props.activeModule ?? activeModuleOf(props.path)}
							signals={moduleSignals(detail)}
							onExpand={() => setCollapsed(false)}
						/>
						<EntityLane
							kind={props.kind}
							detail={detail}
							path={props.path}
							activeModule={props.activeModule ?? activeModuleOf(props.path)}
							collapsed={collapsed.value}
							onToggle={() => setCollapsed(!collapsed.value)}
						/>
					</>
				)
				: (
					<>
						<WorkspaceRail
							kind={props.kind}
							path={props.path}
							entities={props.roster?.items ?? []}
							actingId={props.roster ? resolveActingId(props.roster) : null}
							canCreate={props.roster?.canCreate ?? true}
							onCreate={() => openCreate(props.kind)}
							onExpand={() => setCollapsed(false)}
						/>
						<IndexLane
							kind={props.kind}
							roster={props.roster}
							tab={props.tab ?? "all"}
							path={props.path}
							collapsed={collapsed.value}
							onToggle={() => setCollapsed(!collapsed.value)}
						/>
					</>
				)}
		</div>
	);
}
// #endregion

// #region Index lane
interface IndexLaneProps {
	kind: WorkspaceKind;
	roster?: WorkspaceRoster;
	tab: RosterTab;
	path: string;
	collapsed: boolean;
	onToggle: () => void;
}

/**
 * The roster index lane — a switcher across the viewer's entities.
 *
 * The tab strip **writes the URL and navigates**, while search filters the lane's own list in place.
 * That split is deliberate: the tab is a partition the body's card grid must agree with, and the only
 * thing both roots can agree on without a client router is the address (`?tab=`, read back by
 * `toRosterTab`). Search is a find-in-lane affordance that changes nothing about the page, so paying
 * for a navigation would be gratuitous. The selected tab is held locally too, so the underline moves
 * on the click rather than after the load.
 */
function IndexLane(props: IndexLaneProps): JSX.Element {
	const copy = kindCopy(props.kind);
	const search = useSignal("");
	// Optimistic: the strip must respond to the press, not to the round-trip that follows it.
	const tab = useSignal<RosterTab>(props.tab);
	const quick = useSignal<RosterQuickFilter[]>([]);
	const roles = useSignal<WorkspaceRole[]>([]);
	const filterOpen = useSignal(false);

	const items = props.roster?.items ?? [];
	const invitations = props.roster?.invitations ?? [];
	const actingId = props.roster ? resolveActingId(props.roster) : null;
	const counts = rosterTabCounts(items, invitations);
	// Tab → search → quick/role, in that order: the tab is the partition, the search is find-in-lane and
	// the row narrows what is left, so a reader never sees a filter act on rows the tab excluded.
	const rows = applyRosterFilters(
		filterRoster(items, tab.value, search.value),
		quick.value,
		roles.value,
	);
	const canCreate = props.roster?.canCreate ?? true;
	const filterCount = roles.value.length;

	const onQuick = (key: RosterQuickFilter) => {
		quick.value = quick.value.includes(key)
			? quick.value.filter((k) => k !== key)
			: [...quick.value, key];
	};

	const onRole = (role: WorkspaceRole) => {
		roles.value = roles.value.includes(role)
			? roles.value.filter((r) => r !== role)
			: [...roles.value, role];
	};

	const options: LaneTabOption<RosterTab>[] = ROSTER_TABS.map((t) => ({
		value: t.value,
		label: counts[t.value] > 0 ? `${t.label} ${counts[t.value]}` : t.label,
	}));

	const selectTab = (next: RosterTab) => {
		tab.value = next;
		const href = next === "all" ? copy.base : `${copy.base}?tab=${next}`;
		globalThis.location.assign(href);
	};

	return (
		<div class="wsp-lane">
			<LaneHead class="wsp-lane__head">
				<div class="wsp-lane__headrow">
					<p class="wsp-label wsp-lane__title">{copy.Plural}</p>
					{invitations.length > 0 && (
						<Tooltip
							content={`${invitations.length} invitation${
								invitations.length === 1 ? "" : "s"
							} waiting`}
							placement="bottom"
						>
							<span
								class="wsp-pulse"
								role="status"
								aria-label={`${invitations.length} invitations waiting`}
							/>
						</Tooltip>
					)}
					<LaneIconButton
						icon={cloneGlyph(PlusGlyph)}
						label={`New ${copy.noun}`}
						tooltip={canCreate
							? `New ${copy.noun}`
							: (props.roster?.createBlockedReason ?? `${copy.Noun} limit reached`)}
						accent={canCreate}
						onClick={() => openCreate(props.kind)}
					/>
				</div>

				<LaneBar>
					<LaneSearch
						value={search.value}
						placeholder={`Find a ${copy.noun}…`}
						label={`Search ${copy.plural}`}
						icon={cloneGlyph(SearchGlyph)}
						onInput={(v) => {
							search.value = v;
						}}
					/>

					<Popover
						open={filterOpen}
						placement="bottom-end"
						avoid={[".ui-app-shell__sidebar"]}
						allowOverflow={["bottom"]}
						trigger={(api) => (
							<LaneIconButton
								triggerRef={api.ref as RefObject<HTMLElement>}
								icon={cloneGlyph(SlidersGlyph)}
								label={filterCount > 0 ? `Filters (${filterCount} active)` : "Filters"}
								tooltip="Filters"
								active={filterCount > 0}
								dot={filterCount > 0}
								ariaHasPopup="dialog"
								ariaExpanded={api.expanded}
								ariaControls={api.panelId}
								onClick={api.toggle}
							/>
						)}
					>
						<div class="wsp-lane__filter">
							<p class="wsp-lane__filter-label">Your rank</p>
							<div class="wsp-lane__filter-pills">
								{ROLE_FACETS.map((r) => (
									<button
										key={r}
										type="button"
										class="wsp-lane__filter-pill"
										data-on={roles.value.includes(r) ? "true" : undefined}
										aria-pressed={roles.value.includes(r)}
										onClick={() => onRole(r)}
									>
										{roleLabel(r)}
									</button>
								))}
							</div>
							{filterCount > 0 && (
								<button
									type="button"
									class="wsp-lane__filter-reset"
									onClick={() => {
										roles.value = [];
									}}
								>
									Clear
								</button>
							)}
						</div>
					</Popover>
				</LaneBar>

				<LaneToggleRow
					label="Quick filters"
					options={ROSTER_QUICK_TOGGLES}
					active={quick.value}
					onToggle={onQuick}
				/>

				{/* Five partitions never fit a lane's inline size, so the strip scrolls rather than clipping. */}
				<div class="wsp-lane__tabs">
					<LaneTabs<RosterTab>
						label={`${copy.Plural} partitions`}
						value={tab.value}
						options={options}
						onSelect={selectTab}
					/>
				</div>
			</LaneHead>

			<LaneList label={`Your ${copy.plural}`} class="wsp-lane__nav">
				{tab.value === "invitations"
					? (invitations.length === 0
						? (
							<LaneEmpty
								title="No invitations"
								note={`Nobody has invited you to a ${copy.noun}.`}
							/>
						)
						: invitations.map((invite) => (
							<InviteRow
								key={invite.id}
								invite={invite}
								copy={copy}
							/>
						)))
					: rows.length === 0
					? (
						<LaneEmpty
							title={search.value ? "No matches" : `No ${copy.plural} here`}
							note={search.value
								? "Try a different name or handle."
								: `Nothing in this partition yet.`}
						/>
					)
					: rows.map((entity) => (
						<EntityRow
							key={entity.id}
							entity={entity}
							kind={props.kind}
							copy={copy}
							acting={isActingEntity(entity.id, actingId)}
							active={props.path.startsWith(workspaceHref(props.kind, entity.id))}
						/>
					))}
			</LaneList>

			<LaneFooter>
				<LaneCollapseButton
					collapsed={props.collapsed}
					icon={<SidebarToggleIcon />}
					onToggle={props.onToggle}
				/>
				<span class="wsp-lane__note">{countLabel(props.kind, counts.all)}</span>
			</LaneFooter>
		</div>
	);
}

/** One entity row. The acting marker is decided ONLY by {@link isActingEntity}, never by a raw flag. */
function EntityRow(
	props: {
		entity: WorkspaceSummary;
		kind: WorkspaceKind;
		copy: KindCopy;
		acting: boolean;
		active: boolean;
	},
): JSX.Element {
	const { entity, copy } = props;
	return (
		<a
			class="wsp-lane__entity"
			href={workspaceHref(props.kind, entity.id)}
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
				<span class="wsp-lane__entity-role wsp-trunc">@{entity.handle}</span>
			</span>

			{entity.status !== "active" && (
				<Tooltip content={entity.status === "draft" ? "Draft — finish setting up" : "Archived"}>
					<span
						class="wsp-statedot"
						data-state={entity.status}
						role="img"
						aria-label={entity.status === "draft" ? "Draft" : "Archived"}
					/>
				</Tooltip>
			)}

			{entity.hasUpdate && (
				<Tooltip content="Unseen activity">
					<span class="wsp-pulse" role="status" aria-label="Unseen activity" />
				</Tooltip>
			)}

			{
				/*
				 * Acting supersedes the role chip: which identity the session is wearing outranks what rank
				 * the viewer holds, and two trailing chips in a lane row is one too many.
				 */
			}
			{props.acting
				? (
					<span class="wsp-actingchip wsp-actingchip--quiet">
						<span class="wsp-actingchip__dot" aria-hidden="true" />
						Acting
					</span>
				)
				: <span class="wsp-chip">{roleLabel(entity.role)}</span>}
			<span class="ui-visually-hidden">{copy.Noun}</span>
		</a>
	);
}

/**
 * One incoming invitation. It links to the entity's **public profile**, not to an accept action:
 * answering happens in the roster body's invitation strip, and a lane row that looked like a decision
 * point would put the same choice in two places. Looking before answering is the useful move here.
 */
function InviteRow(props: { invite: IncomingInvite; copy: KindCopy }): JSX.Element {
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
				<span class="wsp-lane__entity-role wsp-trunc">
					{invite.roleLabel} · {invite.sentAt}
				</span>
			</span>
			<span class="wsp-chip" data-tone="muted">Invited</span>
		</a>
	);
}
// #endregion

// #region Entity lane
interface EntityLaneProps {
	kind: WorkspaceKind;
	detail: WorkspaceDetail;
	path: string;
	activeModule: ModuleKey | null;
	collapsed: boolean;
	onToggle: () => void;
}

/** One entity's lane — identity, the acting switch, and the registry-derived module nav. */
function EntityLane(props: EntityLaneProps): JSX.Element {
	const { detail } = props;
	const copy = kindCopy(props.kind);
	const menuOpen = useSignal(false);
	const menuRef = useRef<HTMLButtonElement>(null);
	// All five groups open by default: they are short, and a member hunting for Members should not have
	// to guess which heading hides it. Collapse is available for a long custom-role list.
	const closed = useSignal<Record<string, true>>({});

	const sections = moduleSectionsForViewer(props.kind, detail.viewerCapabilities);
	const signals = moduleSignals(detail);
	const canInvite = detail.viewerCapabilities.includes("invite_members");
	const verify = verifyLine(detail.verification, copy);

	const toggleGroup = (group: ModuleGroup) => {
		const next = { ...closed.value };
		if (next[group]) delete next[group];
		else next[group] = true;
		closed.value = next;
	};

	return (
		<div class="wsp-lane">
			<LaneHead class="wsp-lane__head">
				<div class="wsp-lane__headrow">
					<Tooltip content={`All ${copy.plural}`}>
						<a class="wsp-lane__back" href={copy.base} aria-label={`Back to all ${copy.plural}`}>
							<span class="wsp-icon--dir">{cloneGlyph(BackGlyph)}</span>
						</a>
					</Tooltip>

					{
						/* The identity block links OUT to the public page — the console edits it, `/@handle`
					presents it, and the console never forks that presentation. */
					}
					<a
						class="wsp-lane__switch"
						href={`/@${detail.handle}`}
						data-acting={detail.isActing ? "true" : undefined}
					>
						<EntityMark
							name={detail.name}
							handle={detail.handle}
							kind={props.kind}
							image={detail.avatar}
							size="md"
						/>
						<span class="wsp-lane__ident">
							<span class="wsp-lane__name">{detail.name}</span>
							<span class="wsp-lane__meta">
								<span class="wsp-trunc">@{detail.handle}</span>
								{detail.status !== "active" && (
									<span
										class="wsp-statedot"
										data-state={detail.status}
										role="img"
										aria-label={detail.status === "draft" ? "Draft" : "Archived"}
									/>
								)}
							</span>
						</span>
					</a>

					<LaneIconButton
						icon={cloneGlyph(KebabGlyph)}
						label={`${copy.Noun} options`}
						triggerRef={menuRef}
						ariaHasPopup="menu"
						ariaExpanded={menuOpen.value}
						onClick={() => {
							menuOpen.value = !menuOpen.value;
						}}
					/>
					<Popover
						open={menuOpen}
						targetRef={menuRef}
						placement="bottom-end"
						avoid={[".ui-app-shell__sidebar"]}
					>
						<div class="wsp-lane__entities" role="menu" data-kind={props.kind}>
							<a class="wsp-lane__entity" href={`/@${detail.handle}`} role="menuitem">
								<span class="wsp-lane__row-icon">{cloneGlyph(OverviewGlyph)}</span>
								<span class="wsp-lane__entity-body">
									<span class="wsp-lane__entity-name">View public page</span>
									<span class="wsp-lane__entity-role">@{detail.handle}</span>
								</span>
							</a>
							<a class="wsp-lane__entity" href={detail.finance.walletHref} role="menuitem">
								<span class="wsp-lane__row-icon">{cloneGlyph(WalletGlyph)}</span>
								<span class="wsp-lane__entity-body">
									<span class="wsp-lane__entity-name">Open {copy.moneyNoun}</span>
									<span class="wsp-lane__entity-role">In the wallet</span>
								</span>
							</a>
							{detail.viewerCapabilities.includes("manage_settings") && (
								<>
									<div class="wsp-lane__sep" role="separator" />
									<a
										class="wsp-lane__entity"
										href={workspaceHref(props.kind, detail.id, "settings")}
										role="menuitem"
									>
										<span class="wsp-lane__row-icon">{cloneGlyph(SettingsGlyph)}</span>
										<span class="wsp-lane__entity-body">
											<span class="wsp-lane__entity-name">{copy.Noun} settings</span>
											<span class="wsp-lane__entity-role">Handle, ownership, archiving</span>
										</span>
									</a>
								</>
							)}
						</div>
					</Popover>
				</div>

				{/* The prominent control: entering a console is not the same as acting as the entity. */}
				<ContextSwitchControl
					kind={props.kind}
					id={detail.id}
					name={detail.name}
					handle={detail.handle}
					acting={detail.isActing}
					destination={workspaceHref(props.kind, detail.id, props.activeModule ?? "overview")}
				/>
			</LaneHead>

			<LaneSections class="wsp-lane__nav">
				{sections.map((section) => (
					<LaneSection
						key={section.group}
						id={`wsp-${section.group.toLowerCase()}`}
						icon={cloneGlyph(GROUP_GLYPH[section.group])}
						label={section.group}
						open={!closed.value[section.group]}
						onToggle={() => toggleGroup(section.group)}
						action={section.group === "People" && canInvite
							? (
								<LaneIconButton
									icon={cloneGlyph(InviteGlyph)}
									label="Invite members"
									onClick={() => openInvite()}
								/>
							)
							: undefined}
					>
						{
							/*
							 * No tooltip on an expanded row: the label is already visible, and the module's blurb
							 * belongs to the COLLAPSED rail, where the label is not (the registry's own contract).
							 * Wrapping every nav row in a hover popup would also add a layer between the section
							 * body's flex column and the row it sizes.
							 */
						}
						{section.modules.map((module) => {
							const signal = signals[module.key];
							const active = module.key === props.activeModule;
							return (
								<a
									key={module.key}
									class="wsp-lane__row"
									href={workspaceHref(props.kind, detail.id, module.key)}
									data-active={active ? "true" : undefined}
									aria-current={active ? "page" : undefined}
								>
									<span class="wsp-lane__row-icon" aria-hidden="true">
										{cloneGlyph(module.glyph)}
									</span>
									<span class="wsp-lane__row-label">{module.label}</span>
									{signal?.count
										? (
											<span class="wsp-lane__row-count wsp-num">
												{signal.count}
												<span class="ui-visually-hidden">waiting</span>
											</span>
										)
										: signal?.dot
										? (
											<span
												class="wsp-lane__row-dot wsp-pulse"
												role="status"
												aria-label="Needs attention"
											/>
										)
										: null}
								</a>
							);
						})}
					</LaneSection>
				))}
			</LaneSections>

			{
				/*
				 * Ambient, never an alarm. The state is ALWAYS present so the path to getting verified stays
				 * discoverable; only the CTA is conditional. Hiding it once verified would make the surface
				 * silent about the single thing that decides whether this entity can be paid.
				 */
			}
			<div class="wsp-lane__foot">
				<div class="wsp-lane__verify" data-tone={verify.tone}>
					<span
						class="wsp-lane__verify-dot wsp-statedot"
						data-verify={detail.verification}
						aria-hidden="true"
					/>
					<span class="wsp-lane__verify-text">{verify.text}</span>
					{detail.verificationPrompt &&
						detail.viewerCapabilities.includes("manage_settings") && (
						<Tooltip content={detail.verificationPrompt}>
							<a
								class="wsp-lane__verify-link"
								href={workspaceHref(props.kind, detail.id, "verification")}
							>
								Finish
							</a>
						</Tooltip>
					)}
				</div>
			</div>

			<LaneFooter>
				<LaneCollapseButton
					collapsed={props.collapsed}
					icon={<SidebarToggleIcon />}
					onToggle={props.onToggle}
				/>
				{detail.standing && <span class="wsp-lane__note">{detail.standing}</span>}
			</LaneFooter>
		</div>
	);
}
// #endregion

// #region Derived signals
/** The group headings' glyphs. Cloned at the point of use — three of the five are module glyphs too. */
const GROUP_GLYPH: Record<ModuleGroup, JSX.Element> = {
	Workspace: OverviewGlyph,
	People: MembersGlyph,
	Money: FinanceGlyph,
	Growth: ChartGlyph,
	Admin: ShieldGlyph,
};

/**
 * What needs attention, per module — computed once and shared with the collapsed rail so the two
 * presentations can never disagree.
 *
 * A **count** is a queue whose size is the useful fact (invitations to answer, spend requests to
 * decide). A **dot** is "something here wants you" where the number would mislead: a `3` beside
 * Members reads as a roster of three, not as three pending people, so pending membership is a dot and
 * its meaning lives in the row's tooltip (§B.6 · §D.1).
 *
 * Nothing merely large gets a marker. A module is not "attention" because it has a lot of content in
 * it, and a nav that decorates everything signals nothing.
 */
function moduleSignals(detail: WorkspaceDetail): ModuleSignals {
	const out: ModuleSignals = {};

	if (detail.invites.length > 0) out.invitations = { count: detail.invites.length };
	if (pendingMembers(detail.members).length > 0) out.members = { dot: true };

	const awaitingDecision = detail.spend?.requests.filter((r) => r.state === "pending").length ?? 0;
	if (awaitingDecision > 0) out.spend = { count: awaitingDecision };

	if (detail.verification !== "verified") out.verification = { dot: true };

	return out;
}

/**
 * The verification line. Each state carries its own WORDS as well as its tone, so the meaning survives
 * a colour-blind palette and a greyscale print — a dot colour on its own is not a channel.
 */
function verifyLine(state: VerificationState, copy: KindCopy): { tone: string; text: string } {
	if (state === "verified") return { tone: "ok", text: `${copy.verification} verified` };
	if (state === "pending") return { tone: "warn", text: `${copy.verification} in review` };
	return { tone: "warn", text: `${copy.verification} needed` };
}
// #endregion
