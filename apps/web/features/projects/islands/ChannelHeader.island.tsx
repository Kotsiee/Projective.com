import { cloneElement, type JSX, type RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/channel-header.css";
import { Avatar } from "@projective/ui/display";
import { Drawer, Popover, Tooltip } from "@projective/ui/feedback";
import { CHANNEL_TABS, type ChannelMeta, visibleChannelTabKeys } from "../core/channel-view.ts";
import { readDevSeam, resolveViewer, watchDevSeam } from "../core/submission-access.ts";
import { liveSessionKind, type SessionKind } from "../core/session-model.ts";
import {
	BellIcon,
	BellOffIcon,
	CalendarIcon,
	ClockIcon,
	DmIcon,
	HashIcon,
	InfoIcon,
	LinkIcon,
	MembersIcon,
	PinIcon,
	SubmissionsIcon,
} from "../components/detail-glyphs.tsx";
import { ChatIcon, FilesIcon, PanelIcon } from "../components/channel-glyphs.tsx";
import { KebabIcon, StarIcon, TicketIcon } from "../components/glyphs.tsx";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { openPopout } from "@web/features/messaging/core/popout-state.ts";

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
 * kebab opens a contextual menu, and the middle "details" control opens a right-docked Stage Details
 * `Drawer`. Dumb island: no DB/Supabase, no `@server`; the star/mute/pin preferences persist optimistically
 * to `localStorage` until the live backend owns them.
 *
 * The three-region flow is a left identity block (flex 1) · centred underlined view tabs · right icon
 * actions (flex 1) so the tab strip stays visually centred. Tabs are real anchors — the active underline
 * is URL-driven (`data-active`), so it survives refresh and deep-links (§B.4 underlined tabs, no pills).
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
};
// #endregion

// #region Detail info (for the Stage Details / Channel Info drawer)
/**
 * The resolved summary the details drawer renders — computed server-side by `channelHeaderFor` and
 * threaded as a serializable prop, so the drawer paints the real (SSR-resolved) engagement facts.
 */
export interface ChannelDetailInfo {
	/** Human label for the channel group (e.g. "Stage", "General channel", "Direct message"). */
	kindLabel: string;
	/** The stage/engagement lifecycle status, when relevant. */
	statusLabel?: string;
	/** A pre-formatted deadline label (e.g. "Due Fri · Jul 25"); deterministic, no timezone drift. */
	deadlineLabel?: string;
	/** Completed vs total tasks for the progress meter (stage channels only). */
	progress?: { done: number; total: number };
	/** The assigned members shown as an avatar stack + count. */
	members: { name: string; avatar: string | null }[];
}
// #endregion

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
	/** The SSR-resolved service archetype baseline — re-resolved live from the seam after hydration. */
	sessionKind: SessionKind;
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
	const { base, meta, activeTab, starred = false, visibleTabs, viewerIsClient, detailInfo } = props;

	// Seed from the SSR-resolved set (no hydration mismatch), then track the dev Context Switcher so the
	// tab set live-updates when the developer flips persona / stage assignment / service type (task §2).
	const tabKeys = useSignal<string[]>(visibleTabs);
	// Interactive action state — the Star reflects the persisted preference (layered after hydration),
	// the details drawer opens on the middle control.
	const isStarred = useSignal<boolean>(starred);
	const isMuted = useSignal<boolean>(false);
	const isPinned = useSignal<boolean>(false);
	const detailsOpen = useSignal<boolean>(false);
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
			});
		};
		recompute();
		return watchDevSeam(recompute);
	}, [meta.kind, viewerIsClient, props.sessionKind]);

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

	const isStage = meta.kind === "stage";
	const detailsLabel = isStage ? "Stage details" : "Channel details";

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

			{/* Centre — underlined view tabs (URL-driven active state; stage/session-gated set) */}
			<nav class="chan-header__tabs" aria-label="Channel views">
				{shownTabs.map((tab) => {
					const href = tab.seg ? `${base}/${tab.seg}` : base;
					const active = tab.key === activeTab;
					return (
						<a
							key={tab.key}
							class="chan-tab"
							href={href}
							data-active={active ? "true" : undefined}
							aria-current={active ? "page" : undefined}
						>
							<span class="chan-tab__icon" aria-hidden="true">
								{cloneElement(TAB_ICONS[tab.key])}
							</span>
							<span class="chan-tab__label">{tab.label}</span>
						</a>
					);
				})}
			</nav>

			{/* Right — icon-only actions (§1: star toggle · details drawer · kebab menu) */}
			<div class="chan-header__actions">
				<button
					type="button"
					class="chan-action chan-action--star"
					data-on={isStarred.value ? "true" : undefined}
					aria-pressed={isStarred.value}
					aria-label={isStarred.value ? "Unstar channel" : "Star channel"}
					onClick={toggleStar}
				>
					{cloneElement(StarIcon)}
				</button>

				<Tooltip content="Pop out chat" placement="bottom">
					<button type="button" class="chan-action" aria-label="Pop out chat" onClick={popOut}>
						<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
							<path
								d="M14 4h6v6M20 4l-8 8"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
							<path
								d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>
				</Tooltip>

				<Tooltip content={detailsLabel} placement="bottom">
					<button
						type="button"
						class="chan-action"
						aria-label={detailsLabel}
						aria-haspopup="dialog"
						aria-expanded={detailsOpen.value}
						onClick={() => (detailsOpen.value = true)}
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
								detailsOpen.value = true;
								menuOpen.value = false;
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

// #region Details drawer body
function ChannelDetailBody(
	{ title, isStage, info }: { title: string; isStage: boolean; info: ChannelDetailInfo },
): JSX.Element {
	const pct = info.progress && info.progress.total > 0
		? Math.round((info.progress.done / info.progress.total) * 100)
		: null;

	return (
		<div class="chan-details">
			<dl class="chan-details__list">
				<div class="chan-details__row">
					<dt class="chan-details__term">Channel</dt>
					<dd class="chan-details__def">{info.kindLabel}</dd>
				</div>
				{info.statusLabel && (
					<div class="chan-details__row">
						<dt class="chan-details__term">Status</dt>
						<dd class="chan-details__def">{info.statusLabel}</dd>
					</div>
				)}
				{info.deadlineLabel && (
					<div class="chan-details__row">
						<dt class="chan-details__term">
							<span class="chan-details__termicon" aria-hidden="true">{cloneElement(ClockIcon)}</span>
							Deadline
						</dt>
						<dd class="chan-details__def">{info.deadlineLabel}</dd>
					</div>
				)}
			</dl>

			{isStage && pct !== null && (
				<div class="chan-progress" role="group" aria-label="Stage progress">
					<div class="chan-progress__head">
						<span class="chan-progress__label">Progress</span>
						<span class="chan-progress__value">
							{info.progress!.done}/{info.progress!.total} tasks · {pct}%
						</span>
					</div>
					<div
						class="chan-progress__track"
						role="progressbar"
						aria-valuenow={pct}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-label={`${title} progress`}
					>
						<span class="chan-progress__fill" style={`inline-size:${pct}%`} />
					</div>
				</div>
			)}

			{info.members.length > 0 && (
				<div class="chan-members">
					<div class="chan-members__head">
						<span class="chan-members__label">
							{isStage ? "Assigned members" : "Members"}
						</span>
						<span class="chan-members__count">{info.members.length}</span>
					</div>
					<ul class="chan-members__list">
						{info.members.map((m) => (
							<li key={m.name} class="chan-members__item">
								<Avatar image={m.avatar ?? undefined} label={m.name} size={26} shape="circle" />
								<span class="chan-members__name">{m.name}</span>
							</li>
						))}
					</ul>
				</div>
			)}

			<p class="chan-details__note">
				{isStage
					? "Deadlines, progress, and assignments will sync from the live stage once the backend is connected."
					: "Channel metadata will sync from the live backend once it is connected."}
			</p>
		</div>
	);
}
// #endregion
