/**
 * chat-context — how a project's channel tree links to its conversation surfaces.
 *
 * Every channel (general / stage / team / DM) opens inside the project at
 * `/projects/[projectId]/[channelId]`, so the conversation is read in-context under the project's own
 * route rather than the standalone global inbox. The channel's unified `chatId` (still carried on each
 * channel) remains the shared thread identity the destination page loads — so a project DM and the
 * same person's global DM resolve to one continuous history (PRODUCT_SPEC §Unified Messaging); only
 * the entry point differs. Pure and DOM-free so route SSR and the island build identical links.
 */

// #region Link builder
/**
 * Build the in-project href for a channel: `/projects/{projectId}/{channelId}`. `projectId` is the
 * engagement's route slug; `channelId` is the channel's short route segment (e.g. `general`,
 * `stage-2`, `dm-mara`).
 */
export function channelHref(projectId: string, channelId: string): string {
	return `/projects/${encodeURIComponent(projectId)}/${encodeURIComponent(channelId)}`;
}

/**
 * Build a deep link to a specific message inside its channel chat:
 * `/projects/{projectId}/{channelId}/chat#m-{messageId}`. Routing to the channel's Chat tab is the
 * guaranteed behaviour; the `#m-` anchor lets the feed scroll to the message when it is mounted (a
 * best-effort target inside the window-virtualized stream).
 */
export function channelMessageHref(projectId: string, channelId: string, messageId: string): string {
	return `${channelHref(projectId, channelId)}/chat#m-${encodeURIComponent(messageId)}`;
}
// #endregion
