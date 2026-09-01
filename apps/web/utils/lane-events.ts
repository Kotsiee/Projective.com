/**
 * Cross-island lane events — shared window `CustomEvent` names used to coordinate between the
 * middle-nav lane content (a feature island) and the shell's `MiddleNavSplitter` island that owns the
 * lane width. Kept in the app-shared `utils` layer so neither feature imports the other.
 */

/**
 * Dispatched on `window` when the lane's footer collapse/expand toggle is pressed. The
 * `MiddleNavSplitter` (via `useSplitter`'s `collapseEventName`) listens for it and toggles the lane
 * between its collapsed rail width and the last expanded width. Detail carries the desired state so a
 * source can force a direction; omit `detail` to plain-toggle.
 */
export const MIDDLE_LANE_TOGGLE_EVENT = "projective:middle-lane-toggle";

/** Optional `detail` payload for {@link MIDDLE_LANE_TOGGLE_EVENT}. */
export interface MiddleLaneToggleDetail {
	/** Force a direction; omit to toggle. */
	collapsed?: boolean;
}

/**
 * Dispatched on `window` when the chat composer has PERSISTED a message.
 *
 * The composer and the feed are two separate hydration roots — the composer lives in the middle-nav
 * footer band and the feed in the body — so neither can call the other. Without this the message
 * reached the database and the surface showed nothing until a full reload, which reads to the sender
 * as a send that failed.
 *
 * A window event rather than a shared module signal because the two are in different island bundles
 * and either may be mounted alone: the pop-out chat has a composer with no feed beside it, and a
 * non-Chat tab has neither. An event nobody is listening for is simply not heard.
 *
 * The detail carries the SERVER's message, not the draft — the row that exists, with its real id and
 * timestamp — so the feed appends what was actually stored rather than a hopeful copy of it.
 */
export const MESSAGE_SENT_EVENT = "projective:message-sent";

/** The `detail` payload for {@link MESSAGE_SENT_EVENT}. */
export interface MessageSentDetail {
	/** The channel (or conversation) the message belongs to — a feed ignores another channel's. */
	channelId: string;
	/** The persisted message, shaped as the feed already renders them. */
	message: unknown;
}
