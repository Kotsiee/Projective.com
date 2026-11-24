import { signal } from "@preact/signals";
import { isDiscussionRef } from "@projective/types/projects";
import type { ProjectChannel, ProjectChannels, ProjectDetail } from "../types/projects-types.ts";
import { MessagesService } from "./MessagesService.ts";

/**
 * chat-read-marks — how a project's tree learns that the chat on screen has been read (PROJECTS CH3;
 * PRD-E13, PRD-E17).
 *
 * A read is the person having seen the latest page (CAS M10), which the page's GET cannot know, so
 * the chat island posts the mark once the page has painted in a visible tab
 * (`useChatReadWhenSeen`; PRD-C11). The tree is rendered by the same request as the chat, before
 * that POST exists, so it paints the server's unread state; this tab's marks are layered over it
 * ({@link withChatReads}), the way the inbox's `read-marks` overlay clears its lane: set when the
 * mark is sent, rolled back if the server refuses it. The fat service drops the reader's cached
 * project reads when a mark moves, so the next tree read carries it on its own.
 *
 * Marks are keyed by the channel segment the chat was opened at — `discussion`, a `stg-…`, a room
 * id, a `cht-…` — because that is the one address both the chat and the tree row know.
 */

// #region Overlay
/** Channel segments this tab has marked read. */
export const chatReadMarks = signal<Readonly<Record<string, true>>>({});

/** A room row with this tab's marks applied: read when its own key or its routed segment was marked. */
function markRoom(
	c: ProjectChannel,
	keys: readonly string[],
	marks: Readonly<Record<string, true>>,
) {
	return c.unread && keys.some((k) => marks[k]) ? { ...c, unread: false } : c;
}

/**
 * The tree's channels with this tab's read marks applied. Pure: the same channels back when nothing
 * was marked, so a render with no marks costs nothing. A stage is marked by its `stg-` address or its
 * room id, the project-wide room by its id or the `discussion` address, a team room by its id and a
 * Private Messages row by its `cht-` ref.
 */
export function withChatReads(
	channels: ProjectChannels,
	marks: Readonly<Record<string, true>>,
): ProjectChannels {
	if (Object.keys(marks).length === 0) return channels;
	const discussion = Object.keys(marks).some((k) => isDiscussionRef(k));
	return {
		...channels,
		general: channels.general.map((c) =>
			markRoom(c, discussion ? [c.id, c.chatId, "discussion"] : [c.id, c.chatId], marks)
		),
		stages: channels.stages.map((s) => {
			const channel = markRoom(s.channel, [s.slug, s.channel.id], marks);
			return channel === s.channel ? s : { ...s, channel };
		}),
		teams: channels.teams.map((t) => ({
			...t,
			channels: t.channels.map((c) => markRoom(c, [c.id], marks)),
		})),
		dms: channels.dms.map((d) => (d.unread && marks[d.chatId] ? { ...d, unread: false } : d)),
	};
}

/** The detail with {@link withChatReads} applied to its tree; the same object when nothing was marked. */
export function detailWithChatReads(
	detail: ProjectDetail,
	marks: Readonly<Record<string, true>>,
): ProjectDetail {
	const channels = withChatReads(detail.channels, marks);
	return channels === detail.channels ? detail : { ...detail, channels };
}

/**
 * Mark the chat at `(projectId, channelId)` read: the tree drops its dot at once, and a refusal or a
 * network failure puts it back and says nothing, because unread is the safe direction. Resolves to
 * whether the server took the mark.
 */
export async function markChatSeen(projectId: string, channelId: string): Promise<boolean> {
	chatReadMarks.value = { ...chatReadMarks.value, [channelId]: true };
	const res = await MessagesService.markRead(projectId, channelId);
	if (res.ok) return true;
	const rest = { ...chatReadMarks.value };
	delete rest[channelId];
	chatReadMarks.value = rest;
	return false;
}
// #endregion
