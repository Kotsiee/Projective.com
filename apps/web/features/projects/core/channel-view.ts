import type { ChannelKind, ProjectDetail } from "../types/projects-types.ts";

/**
 * channel-view — the pure, DOM-free model behind a project channel/chat view
 * (`/projects/[projectId]/[channelId]/…`). It owns two concerns the SSR layout and the contextual
 * {@link ChannelHeader} both read: the ordered set of view **tabs** (with URL-driven active resolution)
 * and the {@link resolveChannelMeta} lookup that turns a routed `channelId` into the header's identity
 * (title + sub-line + kind). Kept side-effect-free so route SSR and any island derive identical results.
 */

// #region Tabs
/** One channel view tab. `seg` is the sub-path after the channel base (`""` = the default Chat/index). */
export interface ChannelTab {
	key: string;
	label: string;
	seg: string;
}

/**
 * The channel view tabs, in display order. Chat is the default (its `seg` is empty so the bare channel
 * base resolves to it). Each maps 1:1 to a route file under `[channelId]/` — the tabs are real anchors,
 * so active state is URL-driven and deep-links land on the right view.
 */
export const CHANNEL_TABS: ChannelTab[] = [
	{ key: "chat", label: "Chat", seg: "" },
	{ key: "files", label: "Files", seg: "files" },
	{ key: "members", label: "Members", seg: "members" },
	{ key: "submissions", label: "Submissions", seg: "submissions" },
	{ key: "calendar", label: "Calendar", seg: "calendar" },
	{ key: "tasks", label: "Tasks", seg: "tasks" },
];

/**
 * The active tab key for a channel pathname given its base (`/projects/{projectId}/{channelId}`). The
 * bare base and any unknown trailing segment both resolve to `chat` (the default tab / index route).
 */
export function activeTabOf(pathname: string, base: string): string {
	if (!pathname.startsWith(base)) return "chat";
	const rest = pathname.slice(base.length).replace(/^\/+/, "").split("/")[0] ?? "";
	const match = CHANNEL_TABS.find((t) => t.seg === rest);
	return match ? match.key : "chat";
}
// #endregion

// #region Channel meta
/** The header identity for a resolved channel — its display title, context sub-line, and group kind. */
export interface ChannelMeta {
	/** The routed channel id (the tree key / route segment). */
	channelId: string;
	/** The channel name shown as the header title (e.g. "General", a stage name, a DM party name). */
	title: string;
	/** A short context sub-line under the title (the engagement it belongs to). */
	sub: string;
	/** Which of the four tree groups the channel belongs to (drives the leading mark glyph). */
	kind: ChannelKind;
}

/**
 * Resolve the header identity for a routed `channelId` within a {@link ProjectDetail}, or `null` when the
 * segment names no channel (e.g. a project-view path like `/projects/{slug}/board`, which is NOT a
 * channel and gets no channel header). The route-id convention mirrors {@link channelHref}/`ChannelTree`:
 * general + team channels key off `channel.id`, stages off `stage.id`, and DMs off the unified `chatId`.
 */
export function resolveChannelMeta(detail: ProjectDetail, channelId: string): ChannelMeta | null {
	const { general, stages, teams, dms } = detail.channels;

	for (const c of general) {
		if (c.id === channelId) return { channelId, title: c.name, sub: detail.title, kind: "general" };
	}
	for (const s of stages) {
		if (s.id === channelId) {
			return { channelId, title: s.name, sub: `${detail.title} · Stage`, kind: "stage" };
		}
	}
	for (const t of teams) {
		for (const c of t.channels) {
			if (c.id === channelId) return { channelId, title: c.name, sub: t.teamName, kind: "team" };
		}
	}
	for (const d of dms) {
		if (d.chatId === channelId) {
			return { channelId, title: d.party.name, sub: detail.title, kind: "dm" };
		}
	}
	return null;
}
// #endregion
