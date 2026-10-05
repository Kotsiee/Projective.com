import { cloneElement, type JSX, type RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/channel-header.css";
import { Drawer, Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { CHANNEL_TABS, type ChannelMeta, visibleChannelTabKeys } from "../core/channel-view.ts";
import { readDevSeam, resolveViewer, watchDevSeam } from "../core/submission-access.ts";
import { liveSessionKind, type SessionKind } from "../core/session-model.ts";
import { isDiscussionRef, type ProjectFormat } from "@projective/types/projects";
import {
	BellIcon,
	BellOffIcon,
	CalendarIcon,
	DmIcon,
	HashIcon,
	InfoIcon,
	LinkIcon,
	MembersIcon,
	PinIcon,
	SettingsIcon,
	SubmissionsIcon,
	TimelineIcon,
} from "../components/detail-glyphs.tsx";
import { ChatIcon, FilesIcon, PanelIcon } from "../components/channel-glyphs.tsx";
import { KebabIcon, StarIcon, TicketIcon } from "../components/glyphs.tsx";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { openPopout } from "@web/features/messaging/core/popout-state.ts";
import { useMediaQuery } from "@projective/ui/navigation";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextPanelDocked,
	toggleContextPanel,
} from "@web/features/shell/core/context-panel-state.ts";
import {
	CHANNEL_PANEL_ID,
	ChannelDetailBody,
	type ChannelDetailInfo,
} from "../components/ChannelDetailBody.tsx";
import { ChannelTabStrip } from "../components/ChannelTabStrip.tsx";

/**
 * ChannelHeader — the contextual header for a project channel/chat engagement
 * (`/projects/[projectId]/[channelId]`). It is the content a route mounts into the middle-nav frame's
 * configurable header band (`.ui-middle-nav__header`, resolved per request by `channelHeaderFor` and
 * threaded through `UserShell`'s `middleNavHeader`). Because it renders INSIDE the frame it shares the
 * `--surface-1` band tone and reads as one strip with the lane header (DESIGN_SYSTEM.md §D.4).
 *
 * It is an ISLAND for three reasons now: (1) it bundles `channel-header.css` (the codebase bundles feature
 * CSS only through island imports); (2) its tab set live-updates from the dev Context Switcher; and (3)
 * its icon actions are interactive (task §1) — the Star toggle persists a per-channel preference, the
 * kebab opens a contextual menu, and the middle "details" control shows the channel's details — on
 * the Chat view from 1280px by toggling the middle-nav frame's docked right panel (`channelPanelFor`
 * registers it, the shell's `context-panel-state` carries the choice), everywhere else by opening a
 * right slide-over `Drawer` with the same {@link ChannelDetailBody}. Dumb island: no DB/Supabase, no `@server`; the star/mute/pin preferences persist optimistically
 * to `localStorage` until the live backend owns them.
 *
 * The three-region flow is a left identity block (flex 1) · centred underlined view tabs · right icon
 * actions (flex 1) so the tab strip stays visually centred. Tabs are real anchors — the active underline
 * is URL-driven (`data-active`), so it survives refresh and deep-links (§B.4 underlined tabs, no pills).
 * When the strip would meet the actions, {@link ChannelTabStrip} collapses it to the active tab between
 * circular prev/next chevrons (DESIGN_SYSTEM.md §D.4 "Compact tab strip").
 */

// #region Tab icons (mapped from the pure tab keys in channel-view.ts, which stays JSX-free)
// Each glyph is a shared inline-SVG VNode constant that other subtrees also reference (the ProjectSidebar
// island in the lane reuses Members/Submissions/Calendar/Star/Kebab). Reusing one VNode object in two
// render positions is the documented Preact reuse hazard, so every glyph is `cloneElement`-copied at its
// usage site (matching the Project Details rail, §8 Decision #25).
const TAB_ICONS: Record<string, JSX.Element> = {
	chat: ChatIcon,
	files: FilesIcon,
	members: MembersIcon,
	submissions: SubmissionsIcon,
	calendar: CalendarIcon,
	tasks: TicketIcon,
	// Not optional. Below the label tier `.chan-tab__label` is hidden and the glyph is the whole
	// control, and `cloneElement` throws on an absent entry — so a tab key with no icon here does not
	// degrade, it takes the header island down on every channel route the tab is visible on.
	details: SettingsIcon,
	timeline: TimelineIcon,
};
// #endregion

export type { ChannelDetailInfo } from "../components/ChannelDetailBody.tsx";

export interface ChannelHeaderProps {
	/** The channel base path — `/projects/{projectId}/{channelId}`. Tab hrefs hang off this. */
	base: string;
	/** The resolved channel identity (title · sub-line · kind). */
	meta: ChannelMeta;
	/** The active view tab key (from `activeTabOf`) — drives the underline. */
	activeTab: string;
	/** Whether the engagement is starred by the actor (drives the Star toggle's on-state). */
	starred?: boolean;
	/**
	 * The SSR-resolved visible tab keys (Stage Access + Session matrix) — rendered on first paint so it
	 * matches the server byte, then re-derived live from the dev Context Switcher after hydration.
	 */
	visibleTabs: string[];
	/** The real session's client/reviewer flag — the baseline the dev override layers onto. */
	viewerIsClient: boolean;
	/**
	 * Whether the REAL session may configure this engagement — its owner, or a platform admin.
	 *
	 * Resolved server-side and never re-derived here, because neither fact is in the seam's gift: the
	 * Dev Context Switcher can simulate which SIDE of the market somebody is on, but it cannot make a
	 * viewer the owner of a project they do not own. The seam still narrows it below — flipping to a
	 * freelancer persona correctly hides the tab — it simply cannot widen it.
	 */
	canConfigure: boolean;
	/** The SSR-resolved service archetype baseline — re-resolved live from the seam after hydration. */
	sessionKind: SessionKind;
	/**
	 * Whether the engagement is a Task — a stored fact, not a seam axis, so it is carried as-is into the
	 * live recompute and a persona flip can never bring back the Timeline or Calendar tab.
	 */
	isTask: boolean;
	/** The engagement's stored format — with `isTask` and the live session kind, its tab set's type. */
	format: ProjectFormat;
	/** The resolved summary for the details drawer. */
	detailInfo: ChannelDetailInfo;
}

/** The leading identity mark — a DM shows a chat bubble; every other channel reads as a `#` channel. */
function MarkGlyph({ kind }: { kind: ChannelMeta["kind"] }): JSX.Element {
	return cloneElement(kind === "dm" ? DmIcon : HashIcon);
}

// #region Channel preference persistence (star / mute / pin)
interface ChannelPref {
	starred?: boolean;
	muted?: boolean;
	pinned?: boolean;
}

/** Read the whole persisted per-channel preference map (client-only). */
function readPrefs(): Record<string, ChannelPref> {
	const raw = readStored("local", LocalKeys.PROJECT_CHANNEL_PREFS);
	if (!raw) return {};
	try {
		return JSON.parse(raw) as Record<string, ChannelPref>;
	} catch {
		return {};
	}
}

/** Merge one channel's preference back into the persisted map. */
function writePref(channelId: string, patch: ChannelPref): void {
	const all = readPrefs();
	all[channelId] = { ...all[channelId], ...patch };
	writeStored("local", LocalKeys.PROJECT_CHANNEL_PREFS, JSON.stringify(all));
}
// #endregion

export default function ChannelHeader(props: ChannelHeaderProps): JSX.Element {
	const {
		base,
		meta,
		activeTab,
		starred = false,
		visibleTabs,
		viewerIsClient,
		canConfigure,
		detailInfo,
	} = props;

	// Seed from the SSR-resolved set (no hydration mismatch), then track the dev Context Switcher so the
	// tab set live-updates when the developer flips persona / stage assignment / service type (task §2).
	const tabKeys = useSignal<string[]>(visibleTabs);
	// Interactive action state — the Star reflects the persisted preference (layered after hydration),
	// the details drawer opens on the middle control.
	const isStarred = useSignal<boolean>(starred);
	const isMuted = useSignal<boolean>(false);
	const isPinned = useSignal<boolean>(false);
	const detailsOpen = useSignal<boolean>(false);
	// The frame panel exists only on the Chat view (`channelPanelFor`), and docks only from 1280px.
	const inflow = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);
	const panelDocks = activeTab === "chat" && inflow;
	const menuOpen = useSignal<boolean>(false);
	const copied = useSignal<boolean>(false);

	useEffect(() => {
		const recompute = () => {
			const seam = readDevSeam();
			const viewer = resolveViewer(viewerIsClient, seam);
			tabKeys.value = visibleChannelTabKeys({
				channelKind: meta.kind,
				sessionKind: liveSessionKind(props.sessionKind, seam),
				...viewer,
				// The server's answer AND the seam's, because the two constrain different things and the
				// narrower one has to win. `canConfigure` is ownership, which the seam cannot grant;
				// `isReviewer` is which side of the market the viewer is simulating, and a simulated
				// freelancer must lose a tab that edits the terms they would be working under.
				canConfigure: canConfigure && viewer.isReviewer,
				isTask: props.isTask,
				format: props.format,
				isDiscussion: isDiscussionRef(meta.ref),
			});
		};
		recompute();
		return watchDevSeam(recompute);
	}, [
		meta.kind,
		meta.ref,
		viewerIsClient,
		canConfigure,
		props.sessionKind,
		props.isTask,
		props.format,
	]);

	// Layer the persisted star/mute/pin preference on after hydration (never during SSR).
	useEffect(() => {
		const pref = readPrefs()[meta.channelId];
		if (!pref) return;
		if (pref.starred !== undefined) isStarred.value = pref.starred;
		if (pref.muted !== undefined) isMuted.value = pref.muted;
		if (pref.pinned !== undefined) isPinned.value = pref.pinned;
	}, [meta.channelId]);

	const shownTabs = CHANNEL_TABS.filter((t) => tabKeys.value.includes(t.key));

	function toggleStar(): void {
		isStarred.value = !isStarred.value;
		writePref(meta.channelId, { starred: isStarred.value });
	}

	function toggleMute(): void {
		isMuted.value = !isMuted.value;
		writePref(meta.channelId, { muted: isMuted.value });
	}

	function togglePin(): void {
		isPinned.value = !isPinned.value;
		writePref(meta.channelId, { pinned: isPinned.value });
	}

	function copyLink(): void {
		const url = typeof location !== "undefined" ? `${location.origin}${base}` : base;
		try {
			navigator.clipboard?.writeText(url);
			copied.value = true;
			setTimeout(() => (copied.value = false), 1600);
		} catch { /* clipboard blocked — non-fatal */ }
	}

	/** Pop the active channel conversation out into the floating draggable chat popover (task §1). */
	function popOut(): void {
		const projectId = base.split("/")[2] ?? "";
		openPopout({
			scope: "project",
			projectId,
			channelId: meta.channelId,
			title: meta.title,
			href: base,
		});
	}

	/** Show the details: toggle the docked frame panel where one stands, else open the drawer. */
	function showDetails(): void {
		if (panelDocks) toggleContextPanel();
		else detailsOpen.value = true;
	}
	const detailsShown = panelDocks ? contextPanelDocked.value : detailsOpen.value;

	const isStage = meta.kind === "stage";
	const detailsLabel = props.isTask
		? "Task details"
		: isStage
		? "Stage details"
		: "Channel details";

	return (
		<header class="chan-header">
			{/* Left — channel identity */}
			<div class="chan-header__meta">
				<span class="chan-header__mark" aria-hidden="true">
					<MarkGlyph kind={meta.kind} />
				</span>
				<div class="chan-header__idblock">
					<h1 class="chan-header__title">{meta.title}</h1>
					<p class="chan-header__sub">{meta.sub}</p>
				</div>
			</div>

			{
				/* Centre — underlined view tabs (URL-driven active state; stage/session-gated set), collapsing
			    to a single stepped tab when the strip would meet the actions */
			}
			<ChannelTabStrip
				label="Channel views"
				activeKey={activeTab}
				tabs={shownTabs.map((tab) => ({
					key: tab.key,
					label: tab.label,
					href: tab.seg ? `${base}/${tab.seg}` : base,
					icon: TAB_ICONS[tab.key],
				}))}
			/>

			{/* Right — icon-only actions (§1: star toggle · details drawer · kebab menu) */}
			<div class="chan-header__actions">
				<button
					type="button"
					class="chan-action chan-action--star chan-action--desktop"
					data-on={isStarred.value ? "true" : undefined}
					aria-pressed={isStarred.value}
					aria-label={isStarred.value ? "Unstar channel" : "Star channel"}
					onClick={toggleStar}
				>
					{cloneElement(StarIcon)}
				</button>

				<Tooltip content="Pop out chat" placement="bottom">
					<button
						type="button"
						class="chan-action chan-action--desktop"
						aria-label="Pop out chat"
						onClick={popOut}
					>
						<Icon name="external-link" size="md" />
					</button>
				</Tooltip>

				<Tooltip content={detailsLabel} placement="bottom">
					<button
						type="button"
						class="chan-action"
						data-on={detailsShown ? "true" : undefined}
						aria-label={detailsLabel}
						aria-haspopup={panelDocks ? undefined : "dialog"}
						aria-expanded={detailsShown}
						aria-controls={panelDocks ? CHANNEL_PANEL_ID : undefined}
						onClick={showDetails}
					>
						{cloneElement(PanelIcon)}
					</button>
				</Tooltip>

				<Popover
					open={menuOpen}
					placement="bottom-end"
					class="chan-menu-pop"
					trigger={(api) => (
						<button
							type="button"
							ref={api.ref as RefObject<HTMLButtonElement>}
							class="chan-action"
							data-on={api.expanded ? "true" : undefined}
							aria-haspopup="menu"
							aria-label="More actions"
							aria-expanded={api.expanded}
							aria-controls={api.panelId}
							onClick={api.toggle}
						>
							{cloneElement(KebabIcon)}
						</button>
					)}
				>
					<div class="chan-menu" role="menu" aria-label="Channel actions">
						{
							/*
							 * Star and Pop-out live here only below `--bp-md`, where their dedicated buttons drop
							 * out of the trailing tray. Both copies are always in the DOM and the visible one is
							 * chosen by `@media` alone — no JS breakpoint, so there is no hydration mismatch and
							 * neither action is ever present twice (Part D.3).
							 */
						}
						<button
							type="button"
							role="menuitemcheckbox"
							aria-checked={isStarred.value}
							class="chan-menu__item chan-menu__item--mobile"
							onClick={() => {
								toggleStar();
								menuOpen.value = false;
							}}
						>
							<span class="chan-menu__icon" aria-hidden="true">{cloneElement(StarIcon)}</span>
							<span class="chan-menu__label">
								{isStarred.value ? "Unstar channel" : "Star channel"}
							</span>
						</button>
						<button
							type="button"
							role="menuitem"
							class="chan-menu__item chan-menu__item--mobile"
							onClick={() => {
								popOut();
								menuOpen.value = false;
							}}
						>
							<span class="chan-menu__icon" aria-hidden="true">
								<Icon name="external-link" />
							</span>
							<span class="chan-menu__label">Pop out chat</span>
						</button>
						<button
							type="button"
							role="menuitemcheckbox"
							aria-checked={isMuted.value}
							class="chan-menu__item"
							onClick={() => {
								toggleMute();
								menuOpen.value = false;
							}}
						>
							<span class="chan-menu__icon" aria-hidden="true">
								{cloneElement(isMuted.value ? BellIcon : BellOffIcon)}
							</span>
							<span class="chan-menu__label">
								{isMuted.value ? "Unmute notifications" : "Mute notifications"}
							</span>
						</button>
						<button
							type="button"
							role="menuitemcheckbox"
							aria-checked={isPinned.value}
							class="chan-menu__item"
							onClick={() => {
								togglePin();
								menuOpen.value = false;
							}}
						>
							<span class="chan-menu__icon" aria-hidden="true">{cloneElement(PinIcon)}</span>
							<span class="chan-menu__label">
								{isPinned.value ? "Unpin channel" : "Pin channel"}
							</span>
						</button>
						<button
							type="button"
							role="menuitem"
							class="chan-menu__item"
							onClick={() => {
								menuOpen.value = false;
								// "Channel info" only ever OPENS — on a docked view it never shuts the panel.
								if (!panelDocks) detailsOpen.value = true;
								else if (!contextPanelDocked.value) toggleContextPanel();
							}}
						>
							<span class="chan-menu__icon" aria-hidden="true">{cloneElement(InfoIcon)}</span>
							<span class="chan-menu__label">Channel info</span>
						</button>
						<button
							type="button"
							role="menuitem"
							class="chan-menu__item"
							onClick={() => {
								copyLink();
								menuOpen.value = false;
							}}
						>
							<span class="chan-menu__icon" aria-hidden="true">{cloneElement(LinkIcon)}</span>
							<span class="chan-menu__label">{copied.value ? "Link copied" : "Copy link"}</span>
						</button>
					</div>
				</Popover>
			</div>

			<Drawer
				visible={detailsOpen}
				position="right"
				size="21rem"
				header={detailsLabel}
				class="chan-detail-drawer"
			>
				<ChannelDetailBody title={meta.title} isStage={isStage} info={detailInfo} />
			</Drawer>
		</header>
	);
}
