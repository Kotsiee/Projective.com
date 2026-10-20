import type {
	ArchiveChannelInput,
	CreateChannelInput,
	EntityChannel,
	UpdateChannelInput,
	WorkspaceDetail,
	WorkspaceKind,
} from "@projective/types/workspace";
import { channelSlugOf } from "@projective/types/workspace";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isMessagingBackendLive } from "../../core/supabase.ts";
import { fixtureChannelConversationId } from "../messaging/channel-ref.ts";
import { badId, callRpc, isUuid, type LiveActor } from "./live-support.ts";
import { readDetail } from "./live-detail.ts";

/**
 * live-channels — an entity's chat channels (Decision #306): add one, archive one, and resolve one to
 * the conversation the `/messages` chat stack opens.
 *
 * The two writes are `comms.create_entity_channel` / `comms.archive_entity_channel`, made as the caller,
 * and answer with the entity's RE-READ detail like every console write. The list itself is the
 * detail's `channels` — the console's one read (Decision #233) — so resolving a channel reuses it:
 * membership, liveness and the slug are decided by the same read the lane rendered from.
 */

// #region Writes

/** Add a channel; the caller must be an active member of a non-archived entity. */
export async function createChannel(
	input: CreateChannelInput,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail>> {
	if (!isUuid(input.id)) return badId("id", input.kind);
	const topic = input.topic?.trim() ?? "";
	const res = await callRpc(actor, "comms", "create_entity_channel", {
		p_entity_type: input.kind,
		p_entity_id: input.id,
		p_name: input.name,
		p_topic: topic.length > 0 ? topic : null,
	});
	if (!res.ok) return res.refusal;
	return readDetail(input.kind, input.id, actor, { fresh: true });
}

/** Archive a channel; its creator or a `manage_settings` holder. The default channel is refused. */
export async function archiveChannel(
	input: ArchiveChannelInput,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail>> {
	if (!isUuid(input.id)) return badId("id", input.kind);
	if (!isUuid(input.channelId)) return badId("channelId", "channel");
	const res = await callRpc(actor, "comms", "archive_entity_channel", {
		p_channel_id: input.channelId,
	});
	if (!res.ok) return res.refusal;
	return readDetail(input.kind, input.id, actor, { fresh: true });
}

/**
 * Edit a channel's display name, topic and emoji (Decision #308); its creator or a `manage_settings`
 * holder. Every field is replaced and a blank one cleared; the slug, and so the address, never moves.
 */
export async function updateChannel(
	input: UpdateChannelInput,
	actor: LiveActor,
): Promise<ServiceResult<WorkspaceDetail>> {
	if (!isUuid(input.id)) return badId("id", input.kind);
	if (!isUuid(input.channelId)) return badId("channelId", "channel");
	const res = await callRpc(actor, "comms", "update_entity_channel", {
		p_channel_id: input.channelId,
		p_name: input.name.length > 0 ? input.name : null,
		p_topic: input.topic.length > 0 ? input.topic : null,
		p_emoji: input.emoji.length > 0 ? input.emoji : null,
	});
	if (!res.ok) return res.refusal;
	return readDetail(input.kind, input.id, actor, { fresh: true });
}

// #endregion

// #region Resolve

/** The one answer for a channel the caller cannot open — unknown, archived, or not theirs. */
export const CHANNEL_NOT_FOUND = "That channel doesn't exist.";

/** A channel resolved for the chat stack: the console row, and the conversation id to open. */
export interface ChannelThread {
	channel: EntityChannel;
	conversationId: string;
}

/**
 * Resolve `/{teams|businesses}/{handle}` + a channel slug to its conversation. A non-member, an unknown
 * entity, and an unknown or archived slug are all the same `404`, so the address cannot be used to
 * learn which entities or channels exist. While messaging serves fixtures the conversation is the
 * channel's fixture address (`../messaging/channel-ref.ts`), which the fixture corpus renders.
 */
export async function channelThread(
	kind: WorkspaceKind,
	handle: string,
	slug: string,
	actor: LiveActor,
): Promise<ServiceResult<ChannelThread>> {
	const detail = await readDetail(kind, handle, actor);
	if (!detail.ok || !detail.data) {
		if (detail.status === 403 || detail.status === 404) {
			return fail(404, { message: CHANNEL_NOT_FOUND });
		}
		return fail(detail.status, { message: detail.message, details: detail.details });
	}
	const wanted = channelSlugOf(slug);
	const channel = detail.data.channels.find((c) => c.slug === wanted);
	if (!channel) return fail(404, { message: CHANNEL_NOT_FOUND });
	const conversationId = isMessagingBackendLive()
		? channel.id
		: fixtureChannelConversationId({ kind, handle: detail.data.handle, slug: channel.slug });
	return ok({ channel, conversationId });
}

// #endregion
