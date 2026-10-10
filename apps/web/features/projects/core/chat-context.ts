import {
	DISCUSSION_REF,
	discussionOf,
	type DiscussionRoom,
	type ProjectDetail,
} from "@projective/types/projects";

/**
 * chat-context — how a project's lane links to its conversation surfaces.
 *
 * Every channel (stage / team / DM) opens inside the project at `/projects/[projectId]/[channelId]`,
 * so the conversation is read in-context under the project's own route rather than the standalone
 * global inbox. The engagement's ONE primary conversation has a fixed address of its own,
 * `/projects/[projectId]/discussion` ({@link discussionHref}), on every archetype: a Task's stage room
 * or the project-wide room, decided by the server, never by the link. The channel's unified `chatId`
 * (still carried on each channel) remains the shared thread identity the destination page loads — so
 * a project DM and the same person's global DM resolve to one continuous history (PRODUCT_SPEC
 * §Unified Messaging); only the entry point differs. Pure and DOM-free so route SSR and the island
 * build identical links.
 */

// #region Link builder
/**
 * Build the in-project href for a channel: `/projects/{projectId}/{channelId}`. `projectId` is the
 * engagement's route slug.
 *
 * The second segment is POLYMORPHIC, and the caller decides which key it passes. A **stage** is
 * addressed by its own `stg-…` slug — never by the id of the room it opens, which is a
 * `comms.project_channels` uuid that says nothing about what it addresses and is provisioned lazily,
 * so a link built from it cannot exist until somebody has already been there. Everything else carries
 * its own channel id (`general`, a team room's id, a DM's unified `dm-mara`). The prefix is what keeps
 * the two apart with no lookup: a stage slug is not a legal uuid and a uuid is not a legal slug.
 */
export function channelHref(projectId: string, channelId: string): string {
	return `/projects/${encodeURIComponent(projectId)}/${encodeURIComponent(channelId)}`;
}

/**
 * The engagement's discussion: `/projects/{projectId}/discussion` — the same address on a Task, a
 * one-off, a pipeline and a session. Which room it opens is the server's question
 * (`resolveChannelRef` live, `expandChannelRef` in the fixtures), so a link never has to know.
 */
export function discussionHref(projectId: string): string {
	return channelHref(projectId, DISCUSSION_REF);
}

/** The lane's Discussion link — where it goes, and whether its room has unseen activity. */
export interface DiscussionLink {
	/** Always {@link DISCUSSION_REF}: what the link carries, never the room's own key. */
	ref: typeof DISCUSSION_REF;
	/** `/projects/{slug}/discussion`. */
	href: string;
	/** Unseen activity in the room (§D.1 — a dot, never a count). */
	unread: boolean;
	/** The room the address opens — a Task's stage, or the project-wide room. */
	room: DiscussionRoom;
}

/**
 * The lane's Discussion link, or `null` when the engagement has no room the address could open.
 *
 * The room is `discussionOf` — the one rule, shared with the live resolver and the fixtures — so the
 * link and the page behind it cannot disagree. `null` is a real answer, and the lane renders no entry
 * for it: a Discussion link that led to "no such channel" would be a control that renders and reaches
 * nothing (root CLAUDE.md §3 gate 11). On the live path that is a project created before its
 * project-wide room was provisioned at creation.
 */
export function discussionLinkOf(detail: ProjectDetail): DiscussionLink | null {
	const room = discussionOf(detail);
	if (!room) return null;
	return {
		ref: DISCUSSION_REF,
		href: discussionHref(detail.slug),
		unread: room.kind === "stage" ? room.stage.channel.unread : room.channel.unread,
		room,
	};
}

/**
 * The active channel's route segment for a `/projects/{projectId}/{channelId}[/tab]` pathname, or
 * `null` when the path is the project root / a project-level view (`/projects/{id}`,
 * `/projects/{id}/board`, …). Drives the channel tree's active-row highlight; kept pure so the island
 * can re-derive it whenever the URL changes under Partial navigation.
 */
export function activeChannelIdOf(pathname: string): string | null {
	const segs = pathname.split("/").filter(Boolean); // ["projects", projectId, channelId, ...tab]
	if (segs[0] !== "projects" || segs.length < 3) return null;
	// A project-level view segment (not a channel) rather than a channel id.
	const PROJECT_VIEWS = new Set([
		"board",
		"calendar",
		"timeline",
		"edit",
		"preview",
		"files",
		"attachments",
		"members",
		"submissions",
		"create",
	]);
	return PROJECT_VIEWS.has(segs[2]) ? null : segs[2];
}

/** The query parameter a chat address names the message to land on with. */
export const MESSAGE_ANCHOR_PARAM = "m";

/** The legacy fragment prefix (`#m-{id}`) older message links carry; read, never written. */
const LEGACY_MESSAGE_HASH = "#m-";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build a deep link to a specific message inside a project room's chat:
 * `/projects/{projectSlug}/{channelRef}/chat?m={messageId}`. The feed reads `m` on mount and
 * scrolls to the message, paging back for it when it is older than the first page.
 *
 * `null` when either segment is a uuid: rooms route by their `prj-…` / `stg-…` slugs or their
 * fixed words (`discussion`, `general`), never by a database id (Decision #88).
 */
export function channelMessageHref(
	projectSlug: string,
	channelRef: string,
	messageId: string,
): string | null {
	if (UUID.test(projectSlug) || UUID.test(channelRef)) return null;
	const query = new URLSearchParams({ [MESSAGE_ANCHOR_PARAM]: messageId });
	return `${channelHref(projectSlug, channelRef)}/chat?${query}`;
}

/** A deep link to a message in a conversation: `/messages/{conversationId}?m={messageId}`. */
export function conversationMessageHref(conversationId: string, messageId: string): string {
	const query = new URLSearchParams({ [MESSAGE_ANCHOR_PARAM]: messageId });
	return `/messages/${encodeURIComponent(conversationId)}?${query}`;
}

/**
 * The message id an address asks the feed to land on: the `?m=` parameter, else a legacy `#m-{id}`
 * fragment; `null` when it names none.
 */
export function messageAnchorOf(search: string, hash: string): string | null {
	const fromQuery = new URLSearchParams(search).get(MESSAGE_ANCHOR_PARAM)?.trim();
	if (fromQuery) return fromQuery;
	if (!hash.startsWith(LEGACY_MESSAGE_HASH)) return null;
	const raw = hash.slice(LEGACY_MESSAGE_HASH.length);
	try {
		const id = decodeURIComponent(raw).trim();
		return id === "" ? null : id;
	} catch {
		return null;
	}
}

/**
 * The same address without its message anchor (the `m` parameter and a legacy `#m-` fragment), so
 * a reload or a shared copy of the page opens at the newest message again.
 */
export function withoutMessageAnchor(pathname: string, search: string, hash: string): string {
	const params = new URLSearchParams(search);
	params.delete(MESSAGE_ANCHOR_PARAM);
	const query = params.toString();
	const fragment = hash.startsWith(LEGACY_MESSAGE_HASH) ? "" : hash;
	return `${pathname}${query ? `?${query}` : ""}${fragment}`;
}
// #endregion
