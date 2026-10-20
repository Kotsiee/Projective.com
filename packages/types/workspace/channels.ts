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
});
export type EntityChannel = z.infer<typeof EntityChannelSchema>;
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
// #endregion
