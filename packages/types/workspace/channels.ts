import { z } from "zod";
import { WorkspaceKind } from "./common.ts";

/**
 * workspace/channels — a team's or business's named rooms (`# general`, `# delivery-sync`), Decision
 * #306. A channel is a `comms.dm_threads` row of kind `entity_channel` whose people are the entity's
 * active members, so the console lists it here and the `/messages` chat stack renders it.
 *
 * The name rule is `ck_dm_threads_channel_slug` (00000016) and `comms.create_entity_channel`'s refusal
 * (00001300), pinned to these constants by `workspace.contract.test.ts`.
 */

// #region Name rule
/** The shortest channel name. */
export const CHANNEL_NAME_MIN = 2;

/** The longest channel name. */
export const CHANNEL_NAME_MAX = 40;

/** Lowercase letters, digits and inner hyphens — never a hyphen at either end. */
export const CHANNEL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/** The channel every entity is created with, and the one that can never be archived. */
export const DEFAULT_CHANNEL_SLUG = "general";

/** How many live (not archived) channels one entity may hold. */
export const CHANNEL_LIVE_CAP = 30;

/** The longest display name — `ck_dm_threads_channel_title` (Decision #308). */
export const CHANNEL_TITLE_MAX = 60;

/** The longest topic — `ck_dm_threads_channel_topic`. */
export const CHANNEL_TOPIC_MAX = 200;

/** The longest emoji mark, in UTF-16 code units — `ck_dm_threads_channel_emoji` (Decision #308). */
export const CHANNEL_EMOJI_MAX = 16;

/**
 * What a typed name becomes as a slug — trimmed, a leading `#` dropped, lowercased: the TS twin of
 * `comms.fn_channel_slug`, so a form can show the name the server will store.
 */
export function channelSlugOf(name: string): string {
	return name.trim().replace(/^#+\s*/, "").toLowerCase();
}

/** Whether a slug satisfies the name rule. */
export function isChannelSlug(slug: string): boolean {
	return slug.length >= CHANNEL_NAME_MIN && slug.length <= CHANNEL_NAME_MAX &&
		CHANNEL_NAME_PATTERN.test(slug);
}
// #endregion

// #region Projection
/** One live channel as the console lists it — `get_workspace_detail`'s `channels`, per viewer. */
export const EntityChannelSchema = z.object({
	/** The `comms.dm_threads` id — the conversation the chat stack opens. */
	id: z.string().max(64),
	slug: z.string().min(CHANNEL_NAME_MIN).max(CHANNEL_NAME_MAX),
	topic: z.string().max(200).nullable(),
	isDefault: z.boolean(),
	/** Other people's messages after the viewer's read watermark (all of them when never opened). */
	unreadCount: z.number().int().min(0),
	/** ISO time of the newest message; `null` for a channel nobody has written in. */
	lastActivityAt: z.string().max(40).nullable(),
	/**
	 * The display name (`dm_threads.title`, Decision #308); absent or `null` reads as the slug. The
	 * slug stays the address however the channel is renamed.
	 */
	name: z.string().max(CHANNEL_TITLE_MAX).nullable().optional(),
	/** The emoji drawn in place of `#`; absent or `null` draws the `#`. */
	emoji: z.string().max(CHANNEL_EMOJI_MAX).nullable().optional(),
	/** The channel photo's URL, which wins over the emoji; absent or `null` when it has none. */
	avatar: z.string().max(400).nullable().optional(),
	/** The viewer's own star (`dm_participants.is_starred`). */
	starred: z.boolean().optional(),
	/** The viewer's own mute (`dm_participants.is_muted`). */
	muted: z.boolean().optional(),
	/** Whether the viewer may edit or archive it — its creator or a `manage_settings` holder. */
	canManage: z.boolean().optional(),
});
export type EntityChannel = z.infer<typeof EntityChannelSchema>;

/** What a channel is called on screen: its display name, else its slug. */
export function channelLabel(channel: Pick<EntityChannel, "slug" | "name">): string {
	return channel.name?.trim() || channel.slug;
}
// #endregion

// #region Inputs
/**
 * Add a channel to an entity the caller is an active member of. `name` is what was typed; the server
 * applies {@link channelSlugOf} and then the name rule, refusing on the `name` field.
 */
export const CreateChannelInputSchema = z.object({
	kind: WorkspaceKind,
	/** The entity's row id. */
	id: z.string().max(64),
	name: z.string().trim().min(1, "Name the channel.").max(64),
	topic: z.string().max(200).optional(),
});
export type CreateChannelInput = z.infer<typeof CreateChannelInputSchema>;

/** Archive one of an entity's channels (never deleted; the default channel is refused). */
export const ArchiveChannelInputSchema = z.object({
	kind: WorkspaceKind,
	/** The entity's row id. */
	id: z.string().max(64),
	channelId: z.string().max(64),
});
export type ArchiveChannelInput = z.infer<typeof ArchiveChannelInputSchema>;

/**
 * Edit a channel's display name, topic and emoji (`comms.update_entity_channel`, Decision #308). Every
 * field is replaced; an empty string clears it. The slug — the channel's address — never changes.
 */
export const UpdateChannelInputSchema = z.object({
	kind: WorkspaceKind,
	/** The entity's row id. */
	id: z.string().max(64),
	channelId: z.string().max(64),
	name: z.string().trim().max(
		CHANNEL_TITLE_MAX,
		`Keep the name to ${CHANNEL_TITLE_MAX} characters.`,
	),
	topic: z.string().trim().max(
		CHANNEL_TOPIC_MAX,
		`Keep the topic to ${CHANNEL_TOPIC_MAX} characters.`,
	),
	emoji: z.string().trim().max(CHANNEL_EMOJI_MAX, "Choose a single emoji."),
});
export type UpdateChannelInput = z.infer<typeof UpdateChannelInputSchema>;
// #endregion
