import { cloneElement, type JSX } from "preact";
import "../styles/channel-header.css";
import { CHANNEL_TABS, type ChannelMeta } from "../core/channel-view.ts";
import {
	CalendarIcon,
	DmIcon,
	HashIcon,
	MembersIcon,
	SubmissionsIcon,
} from "../components/detail-glyphs.tsx";
import { ChatIcon, FilesIcon, PanelIcon } from "../components/channel-glyphs.tsx";
import { KebabIcon, StarIcon, TicketIcon } from "../components/glyphs.tsx";

/**
 * ChannelHeader — the contextual header for a project channel/chat engagement
 * (`/projects/[projectId]/[channelId]`). It is the content a route mounts into the middle-nav content
 * pane's configurable header slot (`PageCanvas`'s `.ui-page-canvas__header`), resolved per request by
 * `channelHeaderFor` and threaded through `UserShell`'s `middleNavHeader`. Because it renders INSIDE
 * the Green `PageCanvas` ShellFrame, it shares that frame's `--surface` and rounded top-left corner —
 * reading as part of the content pane, like the lane/sidebar do — while the slot owns the sticky pin
 * (offset by `--shell-topbar-h`) within the native window scroll (DESIGN_SYSTEM.md Part D / §D.4).
 *
 * It is an ISLAND for two reasons: (1) it is the bundling site for `channel-header.css` (the codebase
 * bundles feature CSS only through island imports — server-component CSS imports are not collected by
 * the Vite build), and (2) its icon actions (star toggle, details drawer, kebab menu — all already
 * styled here) will hydrate as those surfaces land. Its props are fully serializable (strings/booleans),
 * so it hydrates cleanly wherever the SSR layout mounts it. Dumb island: no DB/Supabase, no @server.
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

export interface ChannelHeaderProps {
	/** The channel base path — `/projects/{projectId}/{channelId}`. Tab hrefs hang off this. */
	base: string;
	/** The resolved channel identity (title · sub-line · kind). */
	meta: ChannelMeta;
	/** The active view tab key (from `activeTabOf`) — drives the underline. */
	activeTab: string;
	/** Whether the engagement is starred by the actor (drives the Star toggle's on-state). */
	starred?: boolean;
}

/** The leading identity mark — a DM shows a chat bubble; every other channel reads as a `#` channel. */
function MarkGlyph({ kind }: { kind: ChannelMeta["kind"] }): JSX.Element {
	return cloneElement(kind === "dm" ? DmIcon : HashIcon);
}

export default function ChannelHeader(
	{ base, meta, activeTab, starred = false }: ChannelHeaderProps,
): JSX.Element {
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

			{/* Centre — underlined view tabs (URL-driven active state) */}
			<nav class="chan-header__tabs" aria-label="Channel views">
				{CHANNEL_TABS.map((tab) => {
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

			{/* Right — icon-only actions (interactive behaviours land with the channel surfaces) */}
			<div class="chan-header__actions">
				<button
					type="button"
					class="chan-action chan-action--star"
					data-on={starred ? "true" : undefined}
					aria-pressed={starred}
					aria-label={starred ? "Unstar channel" : "Star channel"}
				>
					{cloneElement(StarIcon)}
				</button>
				<button type="button" class="chan-action" aria-label="Channel details">
					{cloneElement(PanelIcon)}
				</button>
				<button type="button" class="chan-action" aria-haspopup="menu" aria-label="More actions">
					{cloneElement(KebabIcon)}
				</button>
			</div>
		</header>
	);
}
